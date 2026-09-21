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
    const redirectTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/partner/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`} replace />;
  }

  return <>{children}</>;
}
