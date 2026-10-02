// Runs db/schema.sql then db/seed.sql against the Neon database.
// Usage: npm run db:setup
//
// Uses DATABASE_URL_UNPOOLED (direct connection) when available: DDL belongs on Neon's
// direct endpoint, while the pooled (-pooler) URL is reserved for app query traffic.
// Falls back to DATABASE_URL when the unpooled string isn't configured (e.g. on Vercel).

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

// Minimal dotenv loader (no dependency): .env.local takes precedence over .env,
// real environment variables take precedence over both.
function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // file missing — skip
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

// Splits a .sql file into single statements. Our SQL files contain no string literals
// with semicolons and no $$ function bodies, so comment-stripping + semicolon split is
// sufficient (the HTTP driver runs one statement per query).
function splitStatements(sqlText) {
  return sqlText
    .replace(/--[^\n]*/g, '') // strip line comments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error(
    'No database URL found. Set DATABASE_URL (or DATABASE_URL_UNPOOLED) in the environment or .env.local.',
  );
  process.exit(1);
}
console.log(
  process.env.DATABASE_URL_UNPOOLED
    ? 'Using DATABASE_URL_UNPOOLED (direct connection, for DDL).'
    : 'Using DATABASE_URL (no unpooled URL found — direct URL is preferred for DDL).',
);

const sql = neon(dbUrl);

for (const file of ['db/schema.sql', 'db/seed.sql']) {
  console.log(`Applying ${file} ...`);
  for (const statement of splitStatements(readFileSync(file, 'utf8'))) {
    await sql.query(statement);
  }
  console.log(`  ok`);
}
console.log('Database ready.');
