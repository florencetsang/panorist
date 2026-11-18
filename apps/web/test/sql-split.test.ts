import { describe, expect, it } from 'vitest';

import { splitStatements } from '../scripts/lib/sql-split.ts';

describe('splitStatements', () => {
  it('splits on top-level semicolons only', () => {
    const sql = `
      -- comment; not a split
      CREATE TABLE t (a text DEFAULT 'x;y''z'); /* block; comment */
      DO $$ BEGIN PERFORM 1; END $$;
      SELECT $tag$ ; $tag$
    `;
    expect(splitStatements(sql)).toEqual([
      "CREATE TABLE t (a text DEFAULT 'x;y''z')",
      'DO $$ BEGIN PERFORM 1; END $$',
      'SELECT $tag$ ; $tag$',
    ]);
  });
});
