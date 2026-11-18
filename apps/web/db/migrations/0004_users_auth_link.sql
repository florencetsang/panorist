-- Link app users to Neon Auth (Better Auth) users. The auth side lives in the
-- neon_auth schema on the same branch; this column is the only coupling, so
-- the app never depends on that schema's layout.
--
-- Null for rows created before auth (e.g. the dev seed); such a row is
-- adopted by the first sign-in with a verified matching email
-- (lib/server/db/users.ts linkAppUser).

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id text UNIQUE;

-- Sign-in matches emails case-insensitively.
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
