/** Origin of the web app, which serves the JSON API and the auth proxy. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);
