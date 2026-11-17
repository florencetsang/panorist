# Panorist (prototype)

Personalized news briefings. Each user picks categories for a **daily** report
and, separately, a **weekly** (local Monday) report. At their chosen local
hour a cron job asks a search-grounded LLM for the news in each category,
stores the report, and sends a web push. The frontend lists past reports and
edits preferences.

Prototype goals: minimal code, near-zero fixed cost, scales to zero.

**Stack:** Next.js (App Router, TypeScript) on Vercel · Neon serverless
Postgres (plain SQL, no ORM) · Gemini with Google Search grounding · Vercel
Cron · Web Push (VAPID) · Tailwind CSS.

How it works and why it's built this way: [ARCHITECTURE.md](ARCHITECTURE.md).

## Getting started

Requires Node 24+ (scripts are TypeScript run directly by Node).

1. **Environment** — copy `.env.example` to `.env.local` and fill it in.
   `DATABASE_URL` / `DATABASE_URL_UNPOOLED` come from `neon env pull`.
2. **Database** — `npm run db:setup` applies pending migrations and seeds a
   test user (`test@example.com`, 08:00 Asia/Hong_Kong, daily: world +
   economics, weekly: hong_kong).
3. **Run** — `npm run dev`, then open http://localhost:3000. Pages act as the
   `?userId=<uuid>` user, defaulting to the seeded one (there is no real auth
   yet).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | Generates Next route types, then runs `tsc` (TypeScript 7) |
| `npm run lint` | ESLint (`eslint-config-next`) |
| `npm run format` / `format:check` | Prettier |
| `npm test` / `test:watch` | Vitest unit tests (`test/`) — no database or network |
| `npm run db:migrate` | Apply pending `db/migrations/*.sql` |
| `npm run db:setup` | `db:migrate` + `db/seed.sql` |
| `npm run vapid:generate` | New VAPID keypair for web push |
| `npm run icons:generate` | Regenerate favicon and app icons from `scripts/generate-icons.ts` |

Manual checks against real services (both need `.env.local`):

```bash
# Every DB helper against the configured database (non-destructive).
node --env-file=.env.local --conditions react-server scripts/smoke.ts
# One live LLM call per category; prints the markdown, stores nothing.
node --env-file=.env.local --conditions react-server scripts/llm-live.ts hong_kong sport
```

(`--conditions react-server` makes the `server-only` marker importable
outside Next.js.)

To exercise the HTTP API by hand, import
`postman/panorist.postman_collection.json` into Postman and set the
`baseUrl`, `userId` and `cronSecret` collection variables.

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
`0003_add_read_status.sql`) — never edit an applied one. The runner prefers
`DATABASE_URL_UNPOOLED`, since DDL belongs on Neon's direct endpoint.

Databases created by the old `db/schema.sql` are adopted automatically: if the
tables exist but `schema_migrations` doesn't, the baseline is marked as
applied. (Databases older than the per-frequency preferences shape must first
run the legacy script: `git show a711bcf:db/schema.sql`.)

## Operations

### Scheduling

`vercel.json` runs `/api/cron` daily at 00:00 UTC — 08:00 in Hong Kong, where
all current users are (the Hobby plan allows one cron per day). The route
matches users by **local** hour, so moving to hourly (`0 * * * *`, Pro plan)
needs only a schedule change.

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
  (the tick's hour doesn't match any user's `delivery_hour`), or the error.

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

Generate one keypair per deployment with `npm run vapid:generate`, then set
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in `.env.local`
**and** in the Vercel dashboard (then redeploy). Push needs HTTPS; browsers
exempt localhost.

## Project layout

```
app/                    Next.js pages and route handlers (thin: validate → service → HTTP)
  api/cron/             GET — Vercel Cron entry point; fans out to /api/generate
  api/generate/         POST {userId} — per-user report worker (x-cron-secret)
  api/preferences/      GET / PATCH a user's preferences
  api/push/subscribe/   GET VAPID public key · POST a push subscription
  api/reports/          GET a user's reports (?hydrate=1 adds rendered topics)
  page.tsx, reports-list.tsx, preferences/, nav.tsx, layout.tsx
components/             presentational React components (report card, markdown, …)
lib/
  shared/               isomorphic: types, categories, validation, markdown parser, user id
  client/               browser-only: typed API client, web-push subscribe flow
  server/               server-only (import 'server-only')
    env.ts              all environment access, read lazily
    auth.ts, http.ts    cron-secret guard, JSON error helpers
    db/                 data access per table (plain SQL via the Neon HTTP driver)
    llm/                LlmProvider interface, Gemini implementation, retrying transport
    reports/            report periods, prompts, generation, "due now" orchestration
    cron/               dispatch to workers, tick logger, cron_runs tracing
    push.ts             web-push sender
db/migrations/          numbered schema migrations · db/seed.sql
scripts/                migrate.ts, smoke.ts, llm-live.ts
test/                   Vitest unit tests
public/sw.js            service worker (push → notification → open app)
public/icons/           manifest + notification icons (generated; app/icon.svg, favicon.ico, apple-icon.png too)
```

## Known limitations

- **No authentication.** Identity is the `?userId=` query parameter, so anyone
  can read or edit any user's data. `lib/shared/user-id.ts` is the seam to
  replace; do this before any public launch.
- Report dates render in the visitor's timezone, not the user's stored one.
- The weekly report day (Monday) is hard-coded.
