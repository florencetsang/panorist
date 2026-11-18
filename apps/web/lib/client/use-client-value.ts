import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/**
 * A value that only the browser knows (clock, locale, device time zone):
 * `fallback` during SSR and hydration, then `read()` — without a mismatch.
 */
export function useClientValue<T>(read: () => T, fallback: T): T {
  return useSyncExternalStore(noop, read, () => fallback);
}
