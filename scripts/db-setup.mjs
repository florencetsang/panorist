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

// Splits a .sql file into single statements. The HTTP driver runs ONE statement
// per query, so semicolons inside a $$-quoted body (the schema.sql migration
// DO blocks) must NOT split it. The scanner tracks the constructs our SQL files
// use — -- line comments, /* block comments */, 'single-quoted strings', and
// $tag$ dollar-quoted bodies — and ends a statement at each unquoted `;`.
function splitStatements(sqlText) {
  const statements = [];
  let current = '';
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inQuote = false;
  let dollarTag = null; // e.g. '$$' or '$fn$' while inside a dollar-quoted body
  const DOLLAR_START = /\$[A-Za-z_0-9]*\$/;

  const endStatement = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = '';
  };

  while (i < sqlText.length) {
    const char = sqlText[i];
    const rest = sqlText.slice(i);
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        current += char; // keep the newline: line structure stays intact
      }
      i += 1;
    } else if (inBlockComment) {
      if (rest.startsWith('*/')) {
        inBlockComment = false;
        i += 2;
      } else {
        i += 1;
      }
    } else if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        current += dollarTag; // keep the closing tag in the statement
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += char;
        i += 1;
      }
    } else if (inQuote) {
      if (rest.startsWith("''")) {
        current += "''"; // SQL-escaped quote stays part of the literal
        i += 2;
      } else {
        if (char === "'") inQuote = false;
        current += char;
        i += 1;
      }
    } else if (rest.startsWith('--')) {
      inLineComment = true;
      i += 2;
    } else if (rest.startsWith('/*')) {
      inBlockComment = true;
      i += 2;
    } else if (rest.match(DOLLAR_START)?.index === 0) {
      // Enter a dollar-quoted body ($$, $fn$, …): everything until the same
      // tag again is raw text — comments, quotes and semicolons included.
      dollarTag = rest.match(DOLLAR_START)[0];
      current += dollarTag;
      i += dollarTag.length;
    } else if (char === "'") {
      inQuote = true;
      current += char;
      i += 1;
    } else if (char === ';') {
      endStatement();
      i += 1;
    } else {
      current += char;
      i += 1;
    }
  }
  endStatement(); // tail of the file (no trailing `;` required)
  return statements;
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
