/**
 * Web-push (VAPID) sender. Node-only (https + crypto): routes importing this
 * must export `runtime = 'nodejs'`.
 */

import 'server-only';

import webpush from 'web-push';

import type { PushSubscriptionJSON } from '../shared/types.ts';
import { env } from './env.ts';

/** Push services cap encrypted payloads near 4KB — send pointers, not content. */
const MAX_PAYLOAD_BYTES = 4096;

/** Read by public/sw.js; `url` is app-relative and opened on notification click. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/** 'expired' = the subscription is unusable and should be cleared. */
export type PushResult = 'sent' | 'expired';

let vapidConfigured = false;

function ensureVapid(): void {
  if (vapidConfigured) return;
  const { subject, publicKey, privateKey } = env.vapid();
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

/**
 * Mirrors web-push's own encryption precondition (RFC 8291 key sizes).
 * Stored jsonb may not match its static type, hence the defensive checks.
 */
export function isEncryptable(subscription: PushSubscriptionJSON): boolean {
  const keys = subscription.keys as { p256dh?: unknown; auth?: unknown } | null | undefined;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return false;
  return (
    Buffer.from(keys.p256dh, 'base64url').length === 65 &&
    Buffer.from(keys.auth, 'base64url').length >= 16
  );
}

/**
 * Returns 'expired' when the push service answers 404/410 or the keys can't
 * encrypt. Other failures (network, VAPID, payload size) throw — they may be
 * transient.
 */
export async function sendPush(
  subscription: PushSubscriptionJSON,
  payload: PushPayload,
): Promise<PushResult> {
  ensureVapid();
  if (!isEncryptable(subscription)) {
    console.warn(
      `[push] subscription keys can't encrypt — treating as expired: ${subscription.endpoint}`,
    );
    return 'expired';
  }
  const body = JSON.stringify(payload);
  const size = Buffer.byteLength(body, 'utf8');
  if (size > MAX_PAYLOAD_BYTES)
    throw new Error(`push payload is ${size} bytes (max ${MAX_PAYLOAD_BYTES})`);
  try {
    await webpush.sendNotification(subscription, body);
    return 'sent';
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      console.warn(`[push] subscription expired (HTTP ${statusCode}): ${subscription.endpoint}`);
      return 'expired';
    }
    throw err;
  }
}
