// Applies pending db/migrations/*.sql in filename order, each in its own
// transaction, recording them in schema_migrations. `--seed` also applies
// db/seed.sql afterwards.
//
// Usage: npm run db:migrate  |  npm run db:setup  (= migrate + seed)
//        npm run db:migrate:prod  |  npm run db:setup:prod  (read .env.prod)
//
// Prefers DATABASE_URL_UNPOOLED: DDL belongs on Neon's direct endpoint.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

import { loadEnvFile } from './lib/env-file.ts';
import { splitStatements } from './lib/sql-split.ts';

const MIGRATIONS_DIR = 'db/migrations';
const SEED_FILE = 'db/seed.sql';
const BASELINE = '0001_baseline';

type Sql = NeonQueryFunction<false, false>;

async function exists(sql: Sql, table: string, column?: string): Promise<boolean> {
  const rows = column
    ? await sql`SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}`
    : await sql`SELECT 1 FROM information_schema.tables
                WHERE table_schema = current_schema() AND table_name = ${table}`;
  return rows.length > 0;
}

/**
 * A database set up by the old db/schema.sql has tables but no
 * schema_migrations. If it has the current shape, record the baseline as
 * applied instead of re-running it.
 */
async function adoptLegacyDatabase(sql: Sql): Promise<void> {
  if (!(await exists(sql, 'users'))) return;
  const current =
    (await exists(sql, 'preferences', 'daily_categories')) &&
    (await exists(sql, 'cron_runs', 'logs'));
  if (!current) {
    throw new Error(
      'Existing database predates the per-frequency schema. Apply the legacy ' +
        'db/schema.sql from git history (`git show a711bcf:db/schema.sql`) first, then re-run.',
    );
  }
  await sql`INSERT INTO schema_migrations (version) VALUES (${BASELINE})`;
  console.log(`Existing schema detected — marked ${BASELINE} as applied.`);
}

async function main() {
  const prod = process.argv.includes('--prod');
  const envFiles = prod ? ['.env.prod'] : ['.env.local', '.env'];
  if (prod && !existsSync(envFiles[0])) throw new Error('--prod given but .env.prod not found.');
  envFiles.forEach(loadEnvFile);
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      `Set DATABASE_URL (or DATABASE_URL_UNPOOLED) in the environment or ${envFiles[0]}.`,
    );
  if (prod) console.log(`Using .env.prod → ${new URL(url).host}`);
  const sql: Sql = neon(url);

  const firstRun = !(await exists(sql, 'schema_migrations'));
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  if (firstRun) await adoptLegacyDatabase(sql);

  const applied = new Set(
    ((await sql`SELECT version FROM schema_migrations`) as { version: string }[]).map(
      (r) => r.version,
    ),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    await sql.transaction([
      ...statements.map((s) => sql.query(s)),
      sql`INSERT INTO schema_migrations (version) VALUES (${version})`,
    ]);
    console.log(`Applied ${file}`);
    count++;
  }
  console.log(count ? `${count} migration(s) applied.` : 'Schema up to date.');

  if (process.argv.includes('--seed')) {
    for (const statement of splitStatements(readFileSync(SEED_FILE, 'utf8'))) {
      await sql.query(statement);
    }
    console.log(`Applied ${SEED_FILE}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
