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
| `reports` | `id bigserial pk`, `user_id fk→users`, `kind`, `period_start`, `period_end`, `content jsonb` (array of topics), `created_at` |

Indexes: `reports(user_id, created_at DESC)` for the report list, and
`preferences(frequency, delivery_hour)` for "who is due now" lookups.

The data-access layer lives in `lib/db.ts` (typed helpers, plain SQL through the
Neon HTTP driver). Scheduling semantics: a user is due when the **local** hour in
their IANA timezone matches `delivery_hour` — the timezone conversion is done by
Postgres (`AT TIME ZONE`) so DST and half-hour zones are handled for us. Weekly
users are due on Mondays, local time.

## Project layout

```
db/schema.sql        CREATE TABLE + indexes (idempotent)
db/seed.sql         one test user + preferences (idempotent)
scripts/db-setup.mjs runs schema.sql then seed.sql (npm run db:setup)
scripts/smoke.ts    exercises every lib/db.ts helper (node --env-file=.env.local scripts/smoke.ts)
lib/db.ts            typed data-access layer (Neon serverless driver)
```

## Status

Schema, seed, and data-access layer are done. API routes, the cron job, web push,
and the frontend are the next milestones.
