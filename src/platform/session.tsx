/**
 * Keeps the Supabase session in sync with React state.
 *
 * Route guards built on this are a user-experience concern only. Security is
 * enforced by RLS, partner projections and domain commands
 * (04_TECHNICAL_ARCHITECTURE.md §5, §7).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { logger } from './logger';
import { SessionContext, type SessionState } from './session-context';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) logger.warn('Could not read the stored session', { error: error.message });
        setState(
          data.session ? { status: 'signed-in', session: data.session } : { status: 'signed-out' },
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        logger.error('Session lookup failed', { error: String(error) });
        setState({ status: 'signed-out' });
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setState(session ? { status: 'signed-in', session } : { status: 'signed-out' });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext value={state}>{children}</SessionContext>;
}
