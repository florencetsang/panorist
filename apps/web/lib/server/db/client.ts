/**
 * Neon serverless (HTTP) client. One HTTPS request per query, no connection
 * state — a good fit for serverless functions. Driver decoding:
 *   - timestamptz → Date, jsonb → parsed value, bigint → string.
 */

import 'server-only';

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

import { env } from '../env.ts';

let client: NeonQueryFunction<false, false> | null = null;

/** The shared query function, created on first use. */
export function db(): NeonQueryFunction<false, false> {
  client ??= neon(env.databaseUrl());
  return client;
}
