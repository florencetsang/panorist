/** The signed-in person as the auth provider knows them (not yet our `users` row). */
export interface AuthIdentity {
  authUserId: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

/** An authenticated request's user: our `users.id` plus the auth identity. */
export interface AppUser extends AuthIdentity {
  id: string;
}
