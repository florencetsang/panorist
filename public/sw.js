/**
 * Panorist service worker — the web-push client.
 *
 * Deliberately framework-free vanilla JS: it's served straight from /sw.js
 * (scope: the whole origin) and must run without any app bundle. Web push
 * requires a secure context — HTTPS on Vercel; browsers exempt localhost so
 * `npm run dev` works without a local cert (see lib/push-client.ts).
 */

// Payload contract (lib/push.ts): {title, body, url} — tiny on purpose,
// since push services cap encrypted payloads near 4KB.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Undecodable payload: fall through to a generic notification — a push
    // event must still show one (userVisibleOnly was promised at subscribe).
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Panorist', {
      body: data.body || 'Your briefing is ready',
      // One tag per briefing: a newer push replaces the stale notification
      // instead of stacking duplicates in the tray.
      tag: 'panorist-briefing',
      // data survives until 'notificationclick' below.
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // url arrives app-relative (e.g. /reports/42) — resolve it against this
  // worker's origin so openWindow/focus always get an absolute URL.
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      // Prefer focusing a tab that's already open on the report…
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      // …otherwise open a new one. openWindow is missing in a few embedded
      // contexts (e.g. an iframe without the link); failing silently there
      // is fine for the prototype.
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
