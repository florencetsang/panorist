/**
 * Client-side web push: service-worker registration and the subscribe flow.
 * Call from client components / event handlers (it's all browser APIs).
 *
 * Web push needs a secure context: HTTPS in production (Vercel serves HTTPS
 * by default) — browsers exempt localhost, so `npm run dev` works without a
 * local cert. Push payloads are encrypted per-subscription but capped near
 * 4KB (lib/push.ts), so notifications are small {title, body, url} pointers
 * and the report itself is fetched in the app.
 */

/** Outcome so the UI can react to "user denied" vs a real failure. */
export type SubscribeResult =
  | { ok: true; subscription: PushSubscription }
  | { ok: false; reason: 'unsupported' | 'no-service-worker' | 'denied' | 'failed' };

/**
 * applicationServerKey must be raw bytes, but the VAPID key is base64url
 * text — restore the padding its generator omits, translate the url-safe
 * alphabet, then decode. (Annotated ArrayBuffer-backed because
 * PushManager.subscribe wants a BufferSource — TS distinguishes that from
 * SharedArrayBuffer-backed views.)
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Register /sw.js at scope '/' (idempotent — re-registering is a no-op). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  // Guard against a stray server-side import; this only runs in a browser.
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.error('[push-client] service worker registration failed:', err);
    return null;
  }
}

/** The public VAPID key, fetched from the server (see GET /api/push/subscribe). */
async function fetchVapidPublicKey(): Promise<string> {
  const res = await fetch('/api/push/subscribe');
  if (!res.ok) throw new Error(`GET /api/push/subscribe answered ${res.status}`);
  const { publicKey } = (await res.json()) as { publicKey?: string };
  if (!publicKey) throw new Error('response contained no publicKey');
  return publicKey;
}

/**
 * Turn notifications on for one user: ask permission, subscribe this browser
 * via PushManager with the public VAPID key, and hand the subscription to
 * the server for storage (POST /api/push/subscribe).
 *
 * 'denied' is graceful by design: the user said no in the browser prompt (or
 * previously blocked the site), nothing was subscribed, and the UI can show
 * a "re-enable in browser settings" hint instead of an error.
 */
export async function subscribeUser(userId: string): Promise<SubscribeResult> {
  // No web push at all (e.g. iOS < 16.4, or iOS 16.4+ outside an installed
  // PWA, where PushManager is absent on plain pages): nothing to do.
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  // Already blocked in browser settings — requestPermission() can't undo
  // that, so don't show a prompt that can never succeed.
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };

  if (!(await registerServiceWorker())) return { ok: false, reason: 'no-service-worker' };
  // ready resolves only once the worker is ACTIVE — push events are not
  // delivered to one still installing.
  const registration = await navigator.serviceWorker.ready;

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    // 'denied' (explicit no) or dismissed-both land here: nothing granted.
    if (permission !== 'granted') return { ok: false, reason: 'denied' };
  }

  try {
    // Reuse a subscription the browser still holds (double-subscribing
    // throws InvalidStateError); re-POSTing it also heals a server copy
    // lost to, say, a db reset.
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Chrome requires this promise: every push we send shows a notification.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(await fetchVapidPublicKey()),
      }));

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // toJSON() is exactly the {endpoint, keys:{p256dh, auth}} shape the
      // route validates and preferences.push_subscription stores.
      body: JSON.stringify({ userId, subscription: subscription.toJSON() }),
    });
    if (!res.ok) throw new Error(`POST /api/push/subscribe answered ${res.status}`);
    return { ok: true, subscription };
  } catch (err) {
    console.error('[push-client] subscribe failed:', err);
    return { ok: false, reason: 'failed' };
  }
}
