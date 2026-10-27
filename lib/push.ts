/**
 * Web-push (VAPID) helper: send one notification to a stored subscription.
 *
 * Deliberately DB-free — and it has to be: this module only knows the
 * subscription endpoint, not the user behind it, so it can't null an expired
 * subscription out of `preferences` itself. Instead sendPush() reports
 * 'expired' and the caller clears the row (app/api/generate does exactly
 * that). web-push is Node-only (https + crypto), so any route importing this
 * module must export `runtime = 'nodejs'`.
 */

import 'server-only';

import webpush from 'web-push';
import type { PushSubscriptionJSON } from './types.ts';

/**
 * Push payloads are encrypted per-subscription and push services cap them
 * near 4KB — so notifications must stay tiny "something is ready" pointers
 * and let the client fetch the actual content.
 */
const MAX_PAYLOAD_BYTES = 4096;

/**
 * What one notification shows. `url` is where 'notificationclick' lands —
 * an app-relative path (e.g. /reports/42) that public/sw.js resolves against
 * the origin, keeping the payload small.
 */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/** 'expired' = that stored subscription is unusable: the push service said 404/410, or its keys can't encrypt. */
export type PushResult = 'sent' | 'expired';

let vapidConfigured = false;

/** Register the VAPID identity once per process (idempotent). */
function ensureVapid(): void {
  if (vapidConfigured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  // Fail loudly once on misconfiguration rather than erroring per request.
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not set — see .env.example',
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

/**
 * Mirrors web-push's own encryption gate (src/encryption-helper.js): p256dh
 * must decode to the 65-byte uncompressed P-256 point (0x04 ‖ X ‖ Y) and
 * auth to ≥16 bytes (RFC 8291). Keys failing that throw synchronously inside
 * sendNotification() — before the push service is even contacted — so a
 * stored row of junk (e.g. an API example payload) would fail every send,
 * forever. Deliberately Buffer-based rather than a charset regex: this is
 * exactly what web-push checks, and it also accepts base64 variants that
 * still decode to the right lengths. Extra typeof guards because the value
 * comes from a jsonb column whose runtime shape the static type
 * over-promises.
 */
function isEncryptable(subscription: PushSubscriptionJSON): boolean {
  const { keys } = subscription;
  if (keys === null || typeof keys !== 'object') return false;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return false;
  return (
    Buffer.from(p256dh, 'base64url').length === 65 &&
    Buffer.from(auth, 'base64url').length >= 16
  );
}

/**
 * Send `payload` to one subscription; the object is JSON-stringified for the
 * service worker (public/sw.js reads {title, body, url}).
 *
 * Two dead-subscription cases are logged and returned as 'expired' so the
 * caller can null the stored copy out via db:
 *   • the push service answers 404/410 (unsubscribed or lapsed), or
 *   • the stored keys can't encrypt at all — see isEncryptable().
 * Every other failure (network, VAPID auth, payload too large, …) still
 * rejects — those may be transient.
 */
export async function sendPush(
  subscription: PushSubscriptionJSON,
  payload: PushPayload,
): Promise<PushResult> {
  ensureVapid();
  if (!isEncryptable(subscription)) {
    console.warn(
      `[push] subscription keys can't encrypt (p256dh must decode to 65 bytes, auth to ≥16) — treating as expired: ${subscription.endpoint}`,
    );
    return 'expired';
  }
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error(`push payload is ${Buffer.byteLength(body)} bytes — push services cap it near 4KB`);
  }
  try {
    await webpush.sendNotification(subscription, body);
    return 'sent';
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      console.warn(
        `[push] subscription expired (push service answered ${statusCode}): ${subscription.endpoint}`,
      );
      return 'expired';
    }
    throw err;
  }
}
