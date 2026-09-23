/**
 * Signing out.
 *
 * Uses the existing auth boundary directly — `supabase.auth.signOut()`, the mirror
 * of how `SignIn` calls `signInWithOtp` — rather than introducing a second auth
 * abstraction. Application session state needs no manual clearing: `SessionProvider`
 * already listens to `onAuthStateChange`, so the one source of truth updates itself.
 *
 * What this hook adds is the UI state that call needs: pending, and a failure that
 * must not be mistaken for success.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../platform/supabase';
import { logger } from '../platform/logger';

export interface SignOut {
  signOut: () => Promise<void>;
  pending: boolean;
  error: string | null;
}

export function useSignOut(): SignOut {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    setError(null);
    setPending(true);

    const { error: failure } = await supabase.auth.signOut();

    setPending(false);

    if (failure) {
      // The session is still real, so the application must keep saying so. Never
      // navigate away on failure: that would show a signed-out screen over a live
      // session. The reason is logged, never shown — no tokens, no raw errors.
      logger.warn('Sign-out failed', { reason: failure.message });
      setError('Não foi possível sair. Tente novamente.');
      return;
    }

    // Replace, not push: the authenticated screen must not stay in history as the
    // place Back returns to.
    navigate('/partner/sign-in', { replace: true });
  }, [navigate]);

  return { signOut, pending, error };
}
