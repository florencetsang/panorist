# Panorist (prototype)

Personalized news briefing: a cron job fires on each user's chosen frequency, asks a
search-enabled LLM for the most important news per subscribed category, stores the
result as a report, and sends a web push. The frontend lists past reports and edits
preferences.

Prototype goals: minimal code, near-zero fixed cost, scales to zero. We validate
demand, not cost-efficiency.

## Stack

- **Next.js 14+ (App Router, TypeScript)** on Vercel — Route Handlers under `app/api/*`
- **Neon serverless Postgres** via the `@neondatabase/serverless` driver (plain SQL, no ORM)
- **Vercel Cron** for scheduling, **Web Push (VAPID)** for notifications
- **Tailwind CSS**, LLM behind a single module `lib/llm.ts` (`generateReport(category, dateRange)`)

## Getting started

1. **Environment** — copy `.env.example` to `.env.local` and fill it in.
   `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`) come from `neon env pull`:

   ```bash
   npm i -g neon   # if you don't have the Neon CLI
   neon env pull   # writes DATABASE_URL + DATABASE_URL_UNPOOLED to .env.local
   ```

2. **Database setup** — apply `db/schema.sql` and `db/seed.sql`:

   ```bash
   npm run db:setup
   ```

   This creates the three prototype tables (`users`, `preferences`, `reports`) with
   their indexes, and seeds a test user (`test@example.com`, daily 08:00 Hong Kong
   time, categories `hong_kong`, `world`, `economics`). The script is idempotent —
   safe to re-run.

   It prefers `DATABASE_URL_UNPOOLED` (Neon's direct connection) because DDL belongs
   on the direct endpoint; the pooled `-pooler` URL is reserved for app query
   traffic. It falls back to `DATABASE_URL` if the unpooled URL isn't configured.

3. **Typecheck** — `npm run typecheck`

## Database

| Table | Columns |
| --- | --- |
| `users` | `id uuid pk` (gen_random_uuid), `email` (unique), `timezone` (default `Asia/Hong_Kong`), `created_at` |
| `preferences` | `user_id uuid pk fk→users`, `frequency` (`daily`\|`weekly`), `delivery_hour` (local hour 0–23, default 8), `categories text[]`, `push_subscription jsonb`, `updated_at` |
| `reports` | `id bigserial pk`, `user_id fk→users`, `kind`, `frequency` (`daily`\|`weekly`), `period_start`, `period_end`, `content jsonb` (array of cache pointers `{category, frequency, to}`), `created_at` |
| `markdown_cache` | `(category, frequency, to_date)` pk, `markdown text`, `created_at` — one LLM markdown per (category, frequency, window end); frequency implies the window length, so a from date would be redundant. Users sharing category+window+frequency read the same row instead of each paying for an LLM call |

The earliest prototype stored topics as `{category, headline, body, sources}`;
rows in that legacy shape are best wiped from an existing database:
`UPDATE reports SET content = '[]'::jsonb;` To add the `frequency` column to
an existing database, backfill it from `kind` (which held it until now) — see
the migration SQL in the commit notes.

Indexes: `reports(user_id, created_at DESC)` for the report list, and
`preferences(frequency, delivery_hour)` for "who is due now" lookups.

The data-access layer is split in two: `lib/types.ts` holds the shared types and
`CATEGORY_SLUGS` (pure — safe to import from client components), while `lib/db.ts`
holds the typed helpers (plain SQL through the Neon HTTP driver) and starts with
`import 'server-only'`, so any accidental client import fails the build with a
clear error. Scheduling semantics: a user is due when the **local** hour in
their IANA timezone matches `delivery_hour` — the timezone conversion is done by
Postgres (`AT TIME ZONE`) so DST and half-hour zones are handled for us. Weekly
users are due on Mondays, local time.

## LLM

`lib/llm.ts` turns a category + to-date + frequency into a markdown string via a
web-search-grounded Gemini chat model. The provider seam is ONE function
(`postChatCompletion`): a POST to Google's native
`{LLM_BASE_URL}/models/{LLM_MODEL}:generateContent` with the `google_search`
tool. (Google's OpenAI-compatible `/chat/completions` cannot enable search
grounding — prompted to "search the web" without the tool, Gemini 3 emits a
malformed pseudo-search call and returns an empty `MALFORMED_FUNCTION_CALL`
response or an HTTP 400.) The model's own markdown IS the report body — no
JSON schema is enforced on the model, only an empty-response check — and each
network call has a 90s timeout with at most 2 retries. `generateReport` runs
categories with concurrency 3 and, per category, first consults an injected
`MarkdownCache` (lib/db.ts implements it over the `markdown_cache` table):
a hit skips the LLM entirely, a miss is generated once and cached under its
exact prompt inputs `{category, frequency, from, to}`. The stored report is a
list of those pointers — the frontend hydrates them with
`getReportMarkdown` — and any category whose cache/LLM call fails is skipped
with a log line (a key is only stored after its markdown is).
Swapping providers means rewriting that one function plus the LLM_* env vars.

## Scheduling (Vercel Cron)

`vercel.json` registers a single cron: `{ "crons": [{ "path": "/api/cron", "schedule": "0 0 * * *" }] }`
— daily at 00:00 UTC. That is exactly **8am Asia/Hong_Kong**, which is where
all current users sit (daily reports, `delivery_hour` = 8, timezone default
`Asia/Hong_Kong`), so one daily cron covers the whole user base — and a
daily cadence is what the Hobby plan allows (it caps cron invocations at once
per day). The route still matches users by **local** hour: it asks the
database "whose local hour is it right now?" and Postgres does the
`AT TIME ZONE` conversion (DST and half-hour zones included). So when a
multi-timezone user base eventually needs hourly scans, only the schedule
in `vercel.json` changes — the code doesn't. (Hourly `0 * * * *` requires
the Pro plan; JSON forbids comments, so this rationale also lives in the
route's header comment.)

The route is guarded: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
automatically, and anything else gets a 401. For each due user it POSTs to
`/api/generate` (guarded separately by `x-cron-secret`) with limited
concurrency and per-user error isolation, then returns
`{processed, succeeded, failed}`.

### Setting `CRON_SECRET` in Vercel

1. Generate a secret, e.g. `openssl rand -base64 32`.
2. In the Vercel dashboard: **Project → Settings → Environment Variables →
   Add** — name `CRON_SECRET`, value the secret, environments Production (and
   Preview if you want to test there). (Or `vercel env add CRON_SECRET
   production`.)
3. **Redeploy** — cron invocations use the env values from the deployment
   they were scheduled on, so an added variable alone isn't picked up until
   the next deploy (`vercel deploy --prod`).

### Testing the cron locally

With `next dev` running (and `CRON_SECRET` in `.env.local`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

Replace `$CRON_SECRET` with the literal value if your shell doesn't have it
exported. You should get `{"processed":N,"succeeded":N,"failed":0}` and, if
the seeded test user is due, a new report plus push in the logs. Omitting or
mistyping the header returns 401.

## Web push (VAPID)

One keypair per deployment, generated locally with `npm run vapid:generate`
(wraps `web-push generate-vapid-keys`). Paste it into `.env.local` **and**
the Vercel dashboard — same drill as `CRON_SECRET`: set the env vars, then
redeploy, because deployed functions never read `.env.local`.

The flow, end to end:

1. **Subscribe** — `subscribeUser(userId)` (`lib/push-client.ts`) registers
   `public/sw.js`, asks notification permission, subscribes via
   `PushManager.subscribe` with the public VAPID key, and POSTs the
   subscription to `/api/push/subscribe`, which stores it in
   `preferences.push_subscription`. The key itself is fetched from
   `GET /api/push/subscribe` (Next only inlines `NEXT_PUBLIC_*` vars into
   client bundles, so the server hands over the public key instead of
   duplicating it into a second env var). Denied permission returns
   `{ok: false, reason: 'denied'}` — nothing subscribed; the UI can hint at
   browser settings.
2. **Send** — after saving a report, the generate route calls
   `sendPush(subscription, {title, body, url})` (`lib/push.ts`). Payloads are
   encrypted per-subscription but capped near 4KB, so the push is a tiny
   "something is ready" pointer; the client fetches the report itself.
3. **Show** — `public/sw.js` (vanilla JS — it runs without the app bundle)
   listens for `push`, shows the `{title, body}` notification, and on
   `notificationclick` focuses a tab already open on the report or opens
   `url`.

Expired subscriptions: the push service answers 404/410 when a subscription
is gone. `sendPush` logs the dead endpoint and returns `'expired'`, and the
caller nulls `preferences.push_subscription` out so future cron ticks stop
retrying it. Push requires a secure context — HTTPS on Vercel, with the
browser's localhost exemption during `npm run dev`.

## Project layout

```
db/schema.sql        CREATE TABLE + indexes (idempotent)
db/seed.sql         one test user + preferences (idempotent)
scripts/db-setup.mjs runs schema.sql then seed.sql (npm run db:setup)
scripts/smoke.ts    exercises every lib/db.ts helper
                    (node --env-file=.env.local --conditions react-server scripts/smoke.ts —
                    the condition resolves `server-only` to its empty module in plain Node)
lib/types.ts         shared types + CATEGORY_SLUGS (pure, client-safe)
lib/db.ts            typed data-access layer (Neon serverless driver, server-only)
lib/llm.ts           LLM abstraction: generateCategoryMarkdown / generateReport
                     (provider seam + web-search notes in postChatCompletion)
lib/push.ts          web-push helper: sendPush(subscription, {title, body, url})
                     → 'sent' | 'expired' (404/410 = subscription gone), VAPID-signed
lib/push-client.ts   client half: registerServiceWorker() + subscribeUser(userId) —
                     permission prompt, PushManager subscribe, POST to the server
public/sw.js         service worker (vanilla JS, scope '/'): 'push' → showNotification,
                     'notificationclick' → focus/open the report url
app/api/_lib/validate.ts  request-shape helpers shared by the routes
                     (uuid / JSON body / push-subscription checks, jsonError)
app/api/reports/route.ts          GET ?userId — recent reports, newest first
app/api/preferences/route.ts      GET ?userId · PATCH {userId, patch} — read/update prefs
app/api/push/subscribe/route.ts  GET — VAPID public key for the client ·
                     POST {userId, subscription} — store web-push sub (204)
app/api/generate/route.ts         POST {userId, kind} — the report worker: guarded by
                     `x-cron-secret` === CRON_SECRET, runs the LLM (with the markdown
                     cache), saves the report, sends a push, returns {reportId}
app/api/cron/route.ts             GET — scheduler entry point (Vercel Cron sends
                     `Authorization: Bearer ${CRON_SECRET}`); finds due users via
                     getUsersDueForReport and fans out to /api/generate with bounded
                     concurrency, returning {processed, succeeded, failed}
vercel.json          registers the daily cron (0 0 * * * = 8am HKT) hitting /api/cron
scripts/llm-smoke.ts offline stubbed-fetch tests + optional live round-trip
                     (node --env-file=.env.local --conditions react-server scripts/llm-smoke.ts)
```

## Status

Schema, seed, data-access layer, the LLM abstraction (`lib/llm.ts`), the API
routes (`app/api/*`), scheduled report generation (`app/api/cron/route.ts` +
the daily Vercel Cron in `vercel.json`), and web push end to end (server:
`lib/push.ts`; client: `lib/push-client.ts` + `public/sw.js`) are done. The
frontend is the next milestone — it will call `subscribeUser()` and render
the reports the pushes point at.
