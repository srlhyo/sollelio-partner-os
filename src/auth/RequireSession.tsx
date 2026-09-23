/**
 * Route guard — a user-experience concern only.
 *
 * Security is enforced by RLS and, from Slice 2, by domain commands. This decides
 * what to render, never what a request may read
 * (04_TECHNICAL_ARCHITECTURE.md §5).
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../platform/session-context';
import { LoadingBlock } from '../platform/ui/States';
import { getAuthReturn, isAuthLinkFailure } from './authReturn';

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (session.status === 'loading') {
    return (
      <main className="partner">
        <div className="partner__body">
          <LoadingBlock label="A verificar a sessão" />
        </div>
      </main>
    );
  }

  if (session.status === 'signed-out') {
    // Arriving here with no session is ordinary — unless this page load came back
    // from an email link that could not be used. Then silently showing the sign-in
    // form explains nothing: say what happened instead.
    if (isAuthLinkFailure(getAuthReturn(), true) && location.pathname !== '/partner/link-expired') {
      return <Navigate to="/partner/link-expired" replace />;
    }

    const redirectTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/partner/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`} replace />;
  }

  return <>{children}</>;
}
