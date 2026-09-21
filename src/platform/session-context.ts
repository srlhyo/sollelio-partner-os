/**
 * Session state shared across both surfaces.
 *
 * Magic link / email OTP is the only authentication method
 * (04_TECHNICAL_ARCHITECTURE.md §20). Phase 0 exposes the state; the sign-in screen
 * and deep-link preservation are Slice 1 work.
 */
import type { Session } from '@supabase/supabase-js';
import { createContext, use } from 'react';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: Session };

export const SessionContext = createContext<SessionState>({ status: 'loading' });

export function useSession(): SessionState {
  return use(SessionContext);
}
