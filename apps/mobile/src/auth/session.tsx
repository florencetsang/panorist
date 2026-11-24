/** App-wide sign-in state and the authenticated API client. */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { createApi, type Api } from '@panorist/core/api';
import { deviceTimeZone } from '@panorist/core/timezones';
import { API_URL } from '../lib/config.ts';
import {
  AuthError,
  getJwt,
  invalidateJwt,
  loadSession,
  refreshSession,
  signOut as endSession,
  type StoredSession,
} from './client.ts';

type Status = 'loading' | 'signed-out' | 'signed-in';

interface SessionContextValue {
  status: Status;
  session: StoredSession | null;
  api: Api;
  /** Adopt a session from a completed sign-in flow. */
  setSession: (session: StoredSession) => void;
  signOut: () => Promise<void>;
  /** Permanently delete the account, then drop the local session. Throws on failure. */
  deleteAccount: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSessionState] = useState<StoredSession | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);

  const adopt = (next: StoredSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
    setStatus(next ? 'signed-in' : 'signed-out');
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      if (!stored) return !cancelled && adopt(null);
      try {
        const fresh = await refreshSession(stored);
        if (!cancelled) adopt(fresh);
      } catch (err) {
        // Offline or the server is down: keep the stored session; API calls retry later.
        if (cancelled) return;
        adopt(err instanceof AuthError && err.status === 401 ? null : stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo(
    () =>
      createApi({
        baseUrl: API_URL,
        getAuthHeaders: async () => {
          const current = sessionRef.current;
          const token = current ? await getJwt(current).catch(() => null) : null;
          return {
            'x-timezone': deviceTimeZone(),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          };
        },
        onUnauthorized: () => {
          invalidateJwt();
          const current = sessionRef.current;
          if (!current) return;
          // Re-check the session; only sign out if it's really gone.
          refreshSession(current).then(
            (fresh) => !fresh && adopt(null),
            () => {},
          );
        },
      }),
    [],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      api,
      setSession: adopt,
      signOut: async () => {
        await endSession(sessionRef.current);
        adopt(null);
      },
      deleteAccount: async () => {
        await api.deleteAccount();
        // The server session went with the account: only clear the local one.
        await endSession(null);
        invalidateJwt();
        adopt(null);
      },
    }),
    [status, session, api],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
