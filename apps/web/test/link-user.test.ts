import { beforeEach, describe, expect, it, vi } from 'vitest';

// Answers each tagged-template query in turn, recording its SQL.
const answers: unknown[][] = [];
const queries: string[] = [];
const sql = (strings: TemplateStringsArray) => {
  queries.push(strings.join('?'));
  return Promise.resolve(answers.shift() ?? []);
};
vi.mock('../lib/server/db/client.ts', () => ({ db: () => sql }));

const { linkAppUser } = await import('../lib/server/db/users.ts');

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
});
