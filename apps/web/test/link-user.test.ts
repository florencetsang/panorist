import { beforeEach, describe, expect, it, vi } from 'vitest';

// Answers each tagged-template query in turn, recording its SQL. A
// transaction's queries are answered in order too.
const answers: unknown[][] = [];
const queries: string[] = [];
const sql = Object.assign(
  (strings: TemplateStringsArray) => {
    queries.push(strings.join('?'));
    return Promise.resolve(answers.shift() ?? []);
  },
  {
    transaction: async (build: (tx: typeof sql) => Promise<unknown>[]) => Promise.all(build(sql)),
  },
);
vi.mock('../lib/server/db/client.ts', () => ({ db: () => sql }));

const { deleteAccount, linkAppUser } = await import('../lib/server/db/users.ts');

const identity = (emailVerified: boolean) => ({
  authUserId: 'auth-new',
  email: 'Florence@Example.com',
  emailVerified,
});

describe('linkAppUser', () => {
  beforeEach(() => {
    answers.length = 0;
    queries.length = 0;
  });

  it('re-links a row left by a deleted auth user once the email is verified', async () => {
    answers.push([], [{ id: 'app-1', authUserId: 'auth-old' }], [{ id: 'app-1' }]);
    expect(await linkAppUser(identity(true), null)).toEqual({ status: 'linked', userId: 'app-1' });
    expect(queries[2]).toContain('UPDATE users SET auth_user_id');
  });

  it('refuses an unverified email that matches an existing row', async () => {
    answers.push([], [{ id: 'app-1', authUserId: 'auth-old' }]);
    expect(await linkAppUser(identity(false), null)).toEqual({ status: 'email-unverified' });
    expect(queries).toHaveLength(2);
  });

  it('creates a new user while the auth user exists', async () => {
    answers.push([], [], [{ authExists: true, id: 'app-2' }]);
    expect(await linkAppUser(identity(false), null)).toEqual({ status: 'linked', userId: 'app-2' });
    expect(queries[2]).toContain('neon_auth."user"');
  });

  it('does not recreate a deleted account from a still-valid JWT', async () => {
    answers.push([], [], [{ authExists: false, id: null }]);
    expect(await linkAppUser(identity(true), null)).toEqual({ status: 'gone' });
    expect(queries).toHaveLength(3);
  });
});

describe('deleteAccount', () => {
  beforeEach(() => {
    answers.length = 0;
    queries.length = 0;
  });

  it('deletes the app user and the auth user in one transaction', async () => {
    answers.push([{ id: 'app-1' }], [{ id: 'auth-1' }]);
    expect(await deleteAccount('app-1', 'auth-1')).toBe(true);
    expect(queries[0]).toContain('DELETE FROM users');
    expect(queries[1]).toContain('DELETE FROM neon_auth."user"');
  });

  it('reports false when neither row exists', async () => {
    expect(await deleteAccount('app-1', 'auth-1')).toBe(false);
  });
});
