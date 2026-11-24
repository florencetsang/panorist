'use client';

/** Permanently delete the account, after typing DELETE to confirm. */

import { useState } from 'react';

import { api } from '../lib/client/api.ts';
import { authClient } from '../lib/client/auth.ts';
import { Button, Field, Notice } from './ui.tsx';

const CONFIRM_WORD = 'DELETE';

type Status = 'idle' | 'confirming' | 'deleting' | 'error';

export function DeleteAccount() {
  const [status, setStatus] = useState<Status>('idle');
  const [typed, setTyped] = useState('');

  async function remove() {
    setStatus('deleting');
    try {
      await api.deleteAccount();
    } catch (err) {
      console.error('[account] delete failed', err);
      setStatus('error');
      return;
    }
    // The server session is already gone; this only clears the cookie.
    await authClient.signOut().catch(() => {});
    // A full navigation drops all client state of the deleted account.
    location.replace('/sign-in');
  }

  return (
    <section className="mt-16 border-t border-danger pt-6">
      <h2 className="font-serif text-2xl font-medium">Delete account</h2>
      <p className="mt-1 text-ink-muted">
        Permanently delete your account, preferences and every briefing. This can’t be undone.
      </p>

      {status === 'idle' ? (
        <Button variant="secondary" className="mt-5" onClick={() => setStatus('confirming')}>
          Delete account…
        </Button>
      ) : (
        <form
          className="mt-5 max-w-sm space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed === CONFIRM_WORD) void remove();
          }}
        >
          <Field
            name="confirm-delete"
            label={`Type ${CONFIRM_WORD} to confirm`}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {status === 'error' && <Notice>We couldn’t delete your account. Try again.</Notice>}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="danger"
              disabled={typed !== CONFIRM_WORD}
              busy={status === 'deleting'}
            >
              Delete forever
            </Button>
            <Button
              variant="ghost"
              disabled={status === 'deleting'}
              onClick={() => {
                setTyped('');
                setStatus('idle');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
