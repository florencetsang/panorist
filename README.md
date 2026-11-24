# Panorist (prototype)

Personalized news briefings. Each user picks categories for a **daily** report
and, separately, a **weekly** (Monday) report. Every day at 07:00 Hong Kong
time a cron job asks a search-grounded LLM for the news in each category,
stores the report, and sends a web push. Readers sign in on the web or in the
iOS/Android app to read past reports (with read/unread status) and edit
preferences.

Prototype goals: minimal code, near-zero fixed cost, scales to zero.

**Stack:** Next.js (App Router, TypeScript) on Vercel · Neon serverless
Postgres (plain SQL, no ORM) · Neon Auth (managed Better Auth) · Gemini with
Google Search grounding · Vercel Cron · Web Push (VAPID) · Tailwind CSS ·
Expo / React Native for mobile.

An npm-workspaces monorepo:

| Workspace | What |
| --- | --- |
| `apps/web` (`@panorist/web`) | Next.js site **and** the JSON API, auth proxy, cron and workers |
| `apps/mobile` (`@panorist/mobile`) | Expo (React Native) app for iOS and Android; talks to `apps/web`'s API |
| `packages/core` (`@panorist/core`) | Shared TypeScript: types, API client, validation, markdown parser, formatting, design tokens |

How it works and why it's built this way: [ARCHITECTURE.md](ARCHITECTURE.md).

## Getting started

Requires Node 24+ (scripts are TypeScript run directly by Node). Run every
command from the repository root; `npm install` installs all workspaces.

1. **Environment** — copy `apps/web/.env.example` to `apps/web/.env.local`
   and fill it in. `DATABASE_URL` / `DATABASE_URL_UNPOOLED` come from
   `neon env pull`.
2. **Auth** — enable Neon Auth on the branch (see [Sign-in](#sign-in-neon-auth)),
   then set `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET`.
3. **Database** — `npm run db:setup` applies pending migrations and seeds a
   test user (`test@example.com`, 08:00 Asia/Hong_Kong, daily: world +
   economics, weekly: hong_kong). Signing up with that email (verified)
   claims the seeded user.
4. **Run** — `npm run dev`, then open http://localhost:3000 and create an
   account. New accounts start with no topics; pick some under Preferences.

### Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env   # EXPO_PUBLIC_API_URL → your web app
npm run dev                                     # the API, in one terminal
npm run dev:mobile                              # Expo, in another; press i / a, or scan with Expo Go
```

On a physical device `EXPO_PUBLIC_API_URL` must be reachable from the phone
(your machine's LAN IP, or a deployed URL). Google sign-in additionally needs
HTTPS (the session cookie is `__Secure-`): run an HTTPS tunnel such as
`cloudflared tunnel --url http://localhost:3000`, use its URL as
`EXPO_PUBLIC_API_URL`, add it as a Neon Auth trusted domain, and restart with
`npx expo start --clear`. Store builds use
[EAS](https://docs.expo.dev/build/introduction/): `npx eas build` from
`apps/mobile` (profiles in `eas.json`; set `EXPO_PUBLIC_API_URL` per profile).
Change `ios.bundleIdentifier` / `android.package` in `app.json` before the
first store build.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` | Next.js (`apps/web`) |
| `npm run dev:mobile` | Expo dev server (`apps/mobile`) |
| `npm run typecheck` | Every workspace: Next route types, then `tsc` (TypeScript 7) |
| `npm run lint` | ESLint (`eslint-config-next`, `apps/web`) |
| `npm run format` / `format:check` | Prettier, whole repo |
| `npm test` | Vitest unit tests (`apps/web/test`, `packages/core/test`) — no database or network |
| `npm run db:migrate` | Apply pending `apps/web/db/migrations/*.sql` |
| `npm run db:setup` | `db:migrate` + `db/seed.sql` |
| `npm run db:migrate:prod` / `db:setup:prod` | Same, against the database in `apps/web/.env.prod` |
| `npm run vapid:generate -w @panorist/web` | New VAPID keypair for web push |
| `npm run icons:generate -w @panorist/web` | Regenerate favicon, web and mobile app icons |
| `npx expo export -p ios -p android` (in `apps/mobile`) | Bundle the app, to check it builds |

Manual checks against real services (run in `apps/web`; both need `.env.local`):

```bash
# Every DB helper against the configured database (non-destructive).
node --env-file=.env.local --conditions react-server scripts/smoke.ts
# One live LLM call per category; prints the markdown, stores nothing.
node --env-file=.env.local --conditions react-server scripts/llm-live.ts hong_kong sport
```

(`--conditions react-server` makes the `server-only` marker importable
outside Next.js.)

To exercise the HTTP API by hand, import
`apps/web/postman/panorist.postman_collection.json` into Postman and set the
`baseUrl`, `sessionToken` and `cronSecret` collection variables.

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, tests and
build on every push and pull request.

### Tooling note: TypeScript 6 and 7 side by side

The project type-checks with TypeScript 7 (native), but typescript-eslint
still needs the TypeScript 6 JS API. `package.json` therefore aliases
`typescript` to `@typescript/typescript6` (for ESLint and Next's tooling) and
installs TypeScript 7 as `typescript-native`; `npm run typecheck` calls the
latter directly. Remove the alias once typescript-eslint supports TS 7.

## Database migrations

Schema changes are numbered SQL files in `db/migrations/`, applied in order by
`scripts/migrate.ts`, each in a transaction, and recorded in
`schema_migrations`. To change the schema, add the next file (e.g.
`0004_add_bookmarks.sql`) — never edit an applied one. The runner prefers
`DATABASE_URL_UNPOOLED`, since DDL belongs on Neon's direct endpoint.

Databases created by the old `db/schema.sql` are adopted automatically: if the
tables exist but `schema_migrations` doesn't, the baseline is marked as
applied. (Databases older than the per-frequency preferences shape must first
run the legacy script: `git show a711bcf:db/schema.sql`.)

## Operations

### Scheduling

`vercel.json` runs `/api/cron` daily at 23:00 UTC — 07:00 in Hong Kong (the
Hobby plan allows one cron per day). Delivery is fixed for everyone at
07:00 HKT (`packages/core/src/delivery.ts`), and the delivery time and time
zone pickers are hidden; the stored `delivery_hour` and `timezone` are kept
but not used for scheduling. Changing the time means updating both the
constant and the schedule.

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
exported. You should get `{"processed":N,"succeeded":N,"failed":0,"skipped":0}` and, if
the seeded test user is due, a new report plus push in the logs. Omitting or
mistyping the header returns 401.

### Verifying cron invocations (no runtime logs on Hobby)

Every `/api/cron` invocation — authorized or not — leaves a trace row in
`cron_runs` (created by the migrations).
After the scheduled time, check the newest rows:

```sql
SELECT id, created_at, auth_ok, detail FROM cron_runs ORDER BY id DESC;
```

How to read it:

- **No new row** → Vercel never invoked the function: the deployed cron
  schedule/deployment is stale (cron config is frozen per deployment — a
  `vercel.json` change needs a new production deploy), or the scheduled
  time hasn't passed yet.
- **`auth_ok = false`** → the invocation reached the route but was rejected;
  `detail` says why (`CRON_SECRET` missing on the deployment → set the env
  var and redeploy, or a token mismatch).
- **`auth_ok = true`** → the tick ran; `detail` reports the outcome —
  `processed=N succeeded=M failed=K skipped=S`, `no users due (utcHour=N)`
  (the tick isn't at 07:00 HKT, or every user is paused), or the error.

Note an authorized trace row is stamped only when the tick finishes — if
the function is killed before then, the row stays with a null `detail`,
which is itself a useful signal. Users not dispatched before the cron's
deadline are counted as `skipped`.

### Capturing the tick's logs: the `CRON_DB_LOGS` flag

With `CRON_DB_LOGS=1` (or `true`) set on the deployment — dashboard env var
plus a redeploy, same drill as `CRON_SECRET` — the `/api/cron` route mirrors
its log lines (due-user counts, per-user generate calls, failures) into the
same row's `logs` column, one `HH:MM:SS.mmm <message>` line per entry. Console
output still happens either way; the flag only adds the DB capture.

Scope note: this captures the `/api/cron` route's own logs. The
`/api/generate` worker runs as a separate function invocation, so ITS
internal logs (LLM failures etc.) stay console-only — they surface here
through the `failed` counter and the error lines the cron route records
when a worker call fails.

### Web push

Generate one keypair per deployment with `npm run vapid:generate -w @panorist/web`, then set
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in `.env.local`
**and** in the Vercel dashboard (then redeploy). Push needs HTTPS; browsers
exempt localhost.

### Sign-in (Neon Auth)

Accounts are [Neon Auth](https://neon.com/docs/auth/overview) (managed Better
Auth): users and sessions live in the branch's `neon_auth` schema, and each
Neon branch has its own Auth URL. Sign-in methods: email + password (with an
emailed verification code) and Google.

1. Enable it: `neon.ts` declares `auth: true`, so `neon deploy` turns it on
   (or Console → Auth). `neon neon-auth status` shows the Auth URL →
   `NEON_AUTH_BASE_URL`.
2. `NEON_AUTH_COOKIE_SECRET`: `openssl rand -base64 32`.
3. **Trusted domains:** add every deployed origin, e.g.
   `neon neon-auth domain add https://panorist.example`. Localhost is allowed
   by default.
4. **Google:** the shared development credentials work out of the box. For
   production, create your own Google OAuth client with the redirect URI
   `{NEON_AUTH_BASE_URL}/callback/google` and configure it in Neon.
5. **Email:** verification codes go out via Neon's shared sender. Configure
   custom SMTP before launch (Neon's production checklist).
6. Set the same variables in Vercel, then redeploy.

The mobile app uses the same accounts via the web app (`/api/auth/*` and
`/mobile/*`); see ARCHITECTURE.md.

### Deploying to Vercel

The Next.js app lives in `apps/web`: set the Vercel project's **Root
Directory** to `apps/web` (Vercel installs the workspace from the repo root).
`apps/web/vercel.json` holds the cron schedule.

## Project layout

```
apps/web/
  app/
    (auth)/             sign-in, sign-up (editorial cover + form)
    (app)/              signed-in pages: briefings (/), reports/[id] reader, preferences
    mobile/             sign-in (Google, for the app) and handoff (session → app)
    api/auth/[...path]  Neon Auth proxy (Better Auth endpoints)
    api/cron/           GET — Vercel Cron entry point; fans out to /api/generate
    api/generate/       POST {userId} — per-user report worker (x-cron-secret)
    api/preferences/    GET / PATCH the signed-in user's preferences
    api/push/subscribe/ GET VAPID public key · POST a push subscription
    api/reports/        GET reports (?hydrate=1) · PATCH read state · [id] GET one, rendered
  proxy.ts              redirects signed-out visitors to /sign-in; completes OAuth
  components/           UI (design-system primitives, header, briefings, reader, …)
  lib/
    client/             browser-only: API client, auth client, web push, theme
    server/             server-only (import 'server-only')
      auth/             Neon Auth instance, requireUser (cookie or bearer JWT), app-user link
      env.ts            all environment access, read lazily
      cron-secret.ts    cron/worker guard · http.ts JSON error helpers
      db/               data access per table (plain SQL via the Neon HTTP driver)
      llm/              LlmProvider interface, Gemini implementation, retrying transport
      reports/          report periods, prompts, generation, "due now" orchestration
      cron/             dispatch to workers, tick logger, cron_runs tracing
      push.ts           web-push sender
  db/migrations/        numbered schema migrations · db/seed.sql
  scripts/              migrate.ts, smoke.ts, llm-live.ts
  test/                 Vitest unit tests
  public/sw.js          service worker (push → notification → open report)
apps/mobile/
  app/                  expo-router routes: (auth) sign-in/up, (app) tabs + reports/[id]
  src/auth/             native Neon Auth client (SecureStore session, JWT) and session context
  src/screens/          briefings, reader, preferences, account, auth
  src/ui/               theme (from core tokens), primitives, native markdown renderer
packages/core/src/      types, api (typed client), validation, categories, markdown,
                        format, timezones, design (palette, type scale)
```

## Known limitations

- The mobile app has no push notifications yet (web push only); it shows new
  briefings when opened.
- Sign-out ends the session, but a mobile JWT already issued stays valid until
  it expires (15 minutes).
- Report dates render in the visitor's timezone, not the user's stored one.
- The weekly report day (Monday) is hard-coded.
