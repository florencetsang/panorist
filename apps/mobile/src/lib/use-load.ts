import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

type LoadState<T> =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T; refreshing: boolean };

/**
 * Loads data whenever the screen gains focus (so returning from the reader
 * shows fresh read state), with pull-to-refresh. Keeps showing the last data
 * while reloading.
 */
export function useFocusLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async (pull: boolean) => {
    setState((s) => (s.status === 'ready' ? { ...s, refreshing: pull } : s));
    try {
      const data = await loadRef.current();
      setState({ status: 'ready', data, refreshing: false });
    } catch (err) {
      console.warn('[load] failed', err);
      setState((s) => (s.status === 'ready' ? { ...s, refreshing: false } : { status: 'error' }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  return { state, setState, refresh: () => run(true) };
}
