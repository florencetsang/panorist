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

/** 'expired' = the push service says that subscription is gone (404/410). */
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
 * Send `payload` to one subscription; the object is JSON-stringified for the
 * service worker (public/sw.js reads {title, body, url}).
 *
 * A 404/410 from the push service means the subscription was unsubscribed or
 * lapsed: that endpoint is logged and 'expired' is returned so the caller can
 * null the stored copy out via db. Every other failure (network, VAPID
 * auth, payload too large, …) still rejects — those may be transient.
 */
export async function sendPush(
  subscription: PushSubscriptionJSON,
  payload: PushPayload,
): Promise<PushResult> {
  ensureVapid();
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
