# Architecture

How Panorist works, and the reasoning behind the non-obvious choices. For
setup and operations see [README.md](README.md).

## Overview

```
Vercel Cron ──► GET /api/cron ──(per due user, bounded pool)──► POST /api/generate
                    │                                               │
                    ├─ users due now (Postgres tz math)             ├─ due frequencies (daily / Monday weekly)
                    └─ cron_runs trace                              ├─ per category: markdown_cache hit, or LLM → cache
                                                                    ├─ save report (idempotent)
                                                                    └─ web push (only for a newly created report)

Browser (cookie session) ─┐
                           ├─► requireUser ─► /api/reports (GET, PATCH read), /api/reports/[id],
Mobile app (bearer JWT) ───┘                  /api/preferences, /api/push/subscribe
Both ──► /api/auth/* ──► Neon Auth (managed Better Auth, neon_auth schema)
```

Paths below are relative to `apps/web` unless they start with `apps/` or
`packages/`.

### Layers

| Layer | Location | Rule |
| --- | --- | --- |
| Routes | `app/api/**/route.ts` | Parse and validate input, call one service, map the result to HTTP. No SQL or business logic. |
| Services | `lib/server/reports`, `lib/server/cron` | Business logic. Dependencies (LLM, cache, fetch, clock) are passed in, so it can be unit-tested. |
| Adapters | `lib/server/db`, `lib/server/llm`, `lib/server/push.ts` | One module per table or external service. |
| Config | `lib/server/env.ts` | The only place that reads `process.env` on the server. Lazy, so imports never fail. |
| Shared | `packages/core` | Pure and isomorphic, used by server, web and mobile: types, validation, categories, markdown parsing, the typed API client, formatting, design tokens. |
| Client | `lib/client`, `components`, `app/**/*.tsx`, `apps/mobile` | Screens call the API only through `createApi` from `@panorist/core/api`. |

`packages/core` ships TypeScript source (its `exports` point at `.ts`
files): Next transpiles it (`transpilePackages`), Metro bundles it, and Node
type-strips it for scripts and tests. It must stay free of DOM, React Native
and Node-only APIs.

`lib/server/**` starts with `import 'server-only'`, so a client import of
server code fails the build.

## Authentication

Accounts are **Neon Auth** (managed Better Auth): users and sessions live in
the branch's `neon_auth` schema, so auth state branches with the data.
Methods: email + password (verified with an emailed code) and Google.

- **Web.** `app/api/auth/[...path]` proxies Better Auth endpoints to Neon
  Auth; the browser uses `@neondatabase/auth`'s client (`lib/client/auth.ts`).
  The session is an HTTP-only `__Secure-neon-auth.*` cookie. `proxy.ts`
  sends signed-out visitors of app pages to `/sign-in` and completes the
  OAuth callback. The instance is created lazily (`lib/server/auth/neon.ts`)
  so builds don't need auth env vars.
- **Mobile.** The browser SDK relies on cookies, popups and BroadcastChannel,
  so `apps/mobile/src/auth/client.ts` calls the same `/api/auth/*` endpoints
  over HTTP:
  - Email sign-in returns a session token, stored in the keychain
    (SecureStore). Neon Auth only accepts the session as a cookie, so the
    proxy bridges it (`lib/server/auth/mobile-session.ts`): it copies the
    session cookie into a `set-auth-token` response header, and turns
    `Authorization: Bearer <session token>` back into the cookie.
  - `get-session` with that token returns a 15-minute **JWT** in the
    `set-auth-jwt` header. The JWT, not the session token, authenticates
    Panorist's API, and is renewed shortly before it expires.
  - **Google** runs on the web: the app opens `/mobile/sign-in?redirect=panorist://auth`
    in a system browser session. After OAuth, `/mobile/handoff` redirects to
    the app's URL scheme with the session token. Only the configured scheme
    (`MOBILE_APP_SCHEME`, plus `exp://` in development) may receive it.
- **API routes** call `requireUser(request)` (`lib/server/auth/require-user.ts`).
  A `Bearer` JWT is verified against the Neon Auth JWKS
  (`lib/server/auth/bearer.ts`); otherwise the cookie session is read. A
  bearer token never falls back to the cookie. Identity never comes from
  request input, and every query is scoped to the resolved user.
- **App users.** Our `users` row (timezone, preferences, reports) links to
  the auth user through `users.auth_user_id` (`0004`). `linkAppUser` creates
  the row and default preferences on first sight (timezone from the
  `x-timezone` header). An existing unlinked row with the same email (e.g. the
  seed user) is adopted only when the email is **verified**; otherwise the
  API answers 409, so an unverified sign-up can't claim someone else's data.
- New accounts start with no topics (paused); the UI prompts to choose some.
- Sign-out ends the session. An already-issued mobile JWT stays valid until
  it expires (at most 15 minutes).

## Design system

Editorial: warm paper, near-black ink, one vermilion accent, Newsreader
(serif) for headlines and reading, Inter for UI. Tokens live in
`packages/core/src/design.ts`; the web mirrors them as CSS variables in
`app/globals.css` (light and dark, following the OS unless the reader picks a
theme), and mobile reads them directly through `useTheme()`.

## Scheduling and time zones

- A user is **due** when the local hour in their IANA timezone equals
  `delivery_hour` **and** at least one list wants a report: `daily_categories`
  every day, or `weekly_categories` on their local Monday. Both lists empty
  means paused, and a paused user is never due.
- Postgres does the timezone conversion (`AT TIME ZONE`), so DST and
  half-hour zones are handled without date maths in app code.
  `getUsersDueForReport(instant)` truncates the instant to the hour, which
  keeps a late-firing cron on the correct hour.
- On the user's local Monday they get **two separate reports**, daily and
  weekly, both at the same hour. A failure in one does not block the other.
- **Report windows** (`lib/server/reports/period.ts`):
  - daily covers the local date;
  - weekly covers the 7 days ending on the local date, inclusive.
  - Both are stored as whole UTC calendar days in `period_start`/`period_end`.

## Report generation and the markdown cache

- The LLM output is cached per `(category, frequency, to_date)` in
  `markdown_cache`, so users who share a category and window share one LLM
  call. The window length follows from `frequency`, so no `from` date is
  needed.
- A report stores **pointers** (`[{category, frequency, to}]`), not markdown.
  The cache row is always written before the pointer, so a stored report
  never points at a missing row.
- Cache writes are first-writer-wins (`ON CONFLICT DO NOTHING`). This keeps
  concurrent workers safe.
- Each category is best-effort: a failure is logged and the category is
  skipped. If every category fails, nothing is stored and `/api/generate`
  answers 502.
- `GET /api/reports?hydrate=1` resolves the pointers in **one query**
  (`jsonb_array_elements … LEFT JOIN markdown_cache`).
- **Idempotency:** `reports` has a unique index on
  `(user_id, frequency, period_start, period_end)`.
  - `saveReport` returns `{id, created}`.
  - A retried run gets the existing report back and sends **no second push**.

## LLM provider

- `LlmProvider` (`lib/server/llm/provider.ts`) has one method:
  `complete({system, user}) → markdown`.
- Gemini is the only implementation. It calls the **native**
  `models/{model}:generateContent` API with the `google_search` tool.
  - Google's OpenAI-compatible endpoint can't enable search grounding: any
    tool spelling returns a 400.
  - Prompting the model to "search the web" without the tool returns empty
    `MALFORMED_FUNCTION_CALL` responses.
- The model's markdown **is** the report body. No JSON schema is enforced;
  only an empty response counts as an error.
- **Transport** (`transport.ts`):
  - 90 s timeout per attempt.
  - Up to 2 retries with backoff for 429, 5xx and network errors.
  - Other HTTP errors fail immediately.
  - Timeouts are not retried, because they would only use up the caller's
    time budget.
- To add a provider, implement `LlmProvider` and pick it in
  `lib/server/llm/index.ts`.

## Cron fan-out

- `/api/cron` makes one HTTP call to `/api/generate` per due user. Each user
  then gets their own function time budget and failure isolation.
- **Concurrency:** a worker pool keeps at most 3 calls in flight (`mapLimit`).
- **Deadline:** dispatch stops starting new calls 20 s before the cron's
  `maxDuration`. Each in-flight call is cut off at that deadline too. Users
  not dispatched are counted as `skipped`. Because saving a report is
  idempotent, a re-run is always safe.
- **Self-call origin:** inside a Vercel function, `request.url` is the
  deployment's *unique* URL. Deployment Protection guards that URL even in
  production, so a call to it returns a 401 SSO page.
  - The cron therefore calls the production alias
    (`VERCEL_PROJECT_PRODUCTION_URL`).
  - It falls back to the request origin only locally.
  - Never scope Vercel Authentication to "All Deployments", or this call
    breaks.
- **Tracing:** the Hobby plan has no runtime logs.
  - Every invocation writes a `cron_runs` row, rejected ones included.
  - With `CRON_DB_LOGS` on, the tick's log lines are stored with it.
  - Tracing is best-effort and never fails the tick.

## Web push

1. `lib/client/push.ts` registers `public/sw.js`, asks for permission,
   subscribes with the VAPID public key (served by `GET /api/push/subscribe`),
   and stores the subscription.
2. After a **new** report is saved, `sendPush` sends a small
   `{title, body, url}` payload. Payloads are capped near 4 KB, so the push
   only says a report is ready and links to the app.
3. `sw.js` shows the notification. Clicking it opens that report.
4. If the push service answers 404 or 410, the subscription is gone and is
   cleared from `preferences`.

## Data model

See `db/migrations/0001_baseline.sql` and later migrations.
- **Read status** is `reports.read_at` (`0003`): null means unread.
  - Reports belong to one user, so a column is enough; no join table.
  - `PATCH /api/reports {reportId, read}` sets or clears it, scoped to the
    signed-in user (another user's report gets a 404).
  - Marking read keeps the first `read_at`.
  - The reader (web and mobile) marks a report read when it is opened;
    readers can mark it unread again.
- Category slugs are enforced by CHECK constraints and must match
  `CATEGORY_SLUGS` (`packages/core/src/categories.ts`). A unit test keeps the two in
  sync, so adding a category means a migration **and** a code change.
- The Neon HTTP driver returns `timestamptz` as `Date`, `jsonb` as parsed
  values and `bigint` as `string`. Report ids are therefore strings
  end-to-end.

## Testing strategy

| Kind | Where | Covers |
| --- | --- | --- |
| Unit (Vitest) | `test/`, `packages/core/test/` | Validation, periods and time zones, prompts, Gemini parsing, retries, report generation with an in-memory cache and a stub LLM, due-report orchestration (DB and push mocked), cron dispatch and deadline, `requireUser` (cookie vs bearer, 401/409) and the app-redirect allowlist, API client, formatting, markdown parser, SQL splitter, category ↔ migration parity |
| Mobile build | `npx expo export` in `apps/mobile` | The app bundles for iOS and Android; `tsc` checks it |
| DB smoke | `scripts/smoke.ts` | Every DB helper against a real database, without destroying data |
| Live LLM | `scripts/llm-live.ts` | One real provider round-trip |

## Recommendations for the roadmap

The current seams were chosen with the planned features in mind:

- **RSS and news-API ingestion, clustering, own summarization.**
  - Add an `articles` table, with ingestion jobs as their own cron routes
    (`lib/server/ingest/*`).
  - Summarization becomes another `LlmProvider` consumer.
  - `generateReport` already takes a cache and a provider. Swapping "web
    search" for "summarize clustered articles" means changing what fills the
    cache, not the report shape.
- **Freemium.**
  - Add a `plan` column (or a `subscriptions` table).
  - Enforce limits (category count, delivery options) in
    `parsePreferencesPatch` and the services, not in the UI.
  - Custom cron time and timezone already work per user. Hourly scheduling
    only needs the Vercel Pro schedule.
- **Email delivery.** Add a `Notifier` interface beside `sendPush` and pick
  channels per user in `notifyReportReady`.
- **Mobile notifications.**
  - Register Expo push tokens (APNs/FCM) from the app and store them in a
    `devices` table instead of the single `push_subscription` column.
  - `notifyReportReady` then fans out to web push and native push.
- **Scale.**
  - Beyond a few hundred users per tick, replace HTTP fan-out with a queue,
    such as Vercel Queues or QStash.
  - Consider a pooled `pg` client for the worker if query counts grow.
