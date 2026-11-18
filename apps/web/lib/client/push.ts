/**
 * Browser-side web push: service-worker registration and the subscribe flow.
 *
 * Needs a secure context (HTTPS; browsers exempt localhost). Payloads are
 * capped near 4KB, so notifications are small {title, body, url} pointers.
 */

import { api } from './api.ts';
import type { PushSubscriptionJSON } from '@panorist/core/types';

export type SubscribeResult =
  { ok: true } | { ok: false; reason: 'unsupported' | 'no-service-worker' | 'denied' | 'failed' };

/** VAPID keys are unpadded base64url; PushManager wants raw bytes. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

/** True if this browser already holds a live push subscription for the app. */
export async function hasPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return Boolean(await registration?.pushManager.getSubscription());
}

async function registerServiceWorker(): Promise<boolean> {
  try {
    await navigator.serviceWorker.register('/sw.js');
    return true;
  } catch (err) {
    console.error('[push] service worker registration failed:', err);
    return false;
  }
}

/**
 * Ask permission, subscribe this browser, and store the subscription
 * server-side. Idempotent: an existing subscription is reused and re-posted
 * (which also heals a server copy lost to a db reset).
 */
export async function subscribeUser(): Promise<SubscribeResult> {
  // e.g. iOS Safari outside an installed PWA has no PushManager.
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  // requestPermission() can't undo a block, so don't prompt.
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };

  if (!(await registerServiceWorker())) return { ok: false, reason: 'no-service-worker' };
  // Resolves only once the worker is active; push isn't delivered before that.
  const registration = await navigator.serviceWorker.ready;

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };
  }

  try {
    // Subscribing twice throws InvalidStateError, so reuse what's there.
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(await api.getVapidPublicKey()),
      }));
    await api.savePushSubscription(subscription.toJSON() as PushSubscriptionJSON);
    return { ok: true };
  } catch (err) {
    console.error('[push] subscribe failed:', err);
    return { ok: false, reason: 'failed' };
  }
}
