/**
 * Web-push (VAPID) helper: send one notification to a stored subscription.
 *
 * Deliberately DB-free — callers load the subscription from `preferences`
 * and decide what failure means (the generate route, for example, clears
 * subscriptions that the push service reports as gone). web-push is Node-only
 * (https + crypto), so any route importing this module must export
 * `runtime = 'nodejs'`.
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
 * Send `payload` to one subscription; objects are JSON-stringified.
 *
 * Rejects on failure. web-push rejects with a WebPushError carrying a
 * `statusCode` from the push service — 404/410 mean the subscription is
 * gone and the caller should stop using it.
 */
export async function sendPush(subscription: PushSubscriptionJSON, payload: unknown): Promise<void> {
  ensureVapid();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error(`push payload is ${Buffer.byteLength(body)} bytes — push services cap it near 4KB`);
  }
  await webpush.sendNotification(subscription, body);
}
