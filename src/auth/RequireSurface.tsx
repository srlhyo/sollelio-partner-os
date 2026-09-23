/**
 * Guards one security surface, role-aware.
 *
 * A session alone is not enough to decide where someone belongs: Sollelio staff and
 * partners authenticate identically, and the surface each may use comes from the
 * profile, not from the URL they asked for. This resolves the profile once the
 * session exists and sends anyone standing on the wrong surface to their own home.
 *
 * This is a routing concern layered on top of the real boundary, not a replacement
 * for it: RLS still decides what any request may read, whatever renders here
 * (04_TECHNICAL_ARCHITECTURE.md §5, §7).
 */
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAsync } from '../platform/useAsync';
import { useSession } from '../platform/session-context';
import { fetchCurrentProfile } from '../modules/people/queries';
import { ErrorState, LoadingBlock } from '../platform/ui/States';
import { RequireSession } from './RequireSession';
import { homeFor, roleOf, surfaceForRole, type Surface } from './destination';

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="partner">
      <div className="partner__body" style={{ paddingTop: 32 }}>
        {children}
      </div>
    </main>
  );
}

function SurfaceGate({ surface, children }: { surface: Surface; children: ReactNode }) {
  const session = useSession();
  const authUserId = session.status === 'signed-in' ? session.session.user.id : null;

  const profile = useAsync(
    () => (authUserId ? fetchCurrentProfile(authUserId) : Promise.resolve(null)),
    [authUserId],
  );

  if (profile.status === 'loading') {
    return (
      <Frame>
        <LoadingBlock label="A preparar o seu espaço" />
      </Frame>
    );
  }

  // A session without a readable profile is not a role we can act on. Say so and
  // offer the way forward, rather than guessing a surface.
  if (profile.status === 'error') {
    return (
      <Frame>
        <ErrorState onRetry={profile.reload}>
          Não conseguimos confirmar o seu acesso. Verifique a ligação e tente novamente.
        </ErrorState>
      </Frame>
    );
  }

  const role = roleOf(profile.data);
  if (surfaceForRole(role) !== surface) {
    return <Navigate to={homeFor(role)} replace />;
  }

  return <>{children}</>;
}

export function RequireSurface({ surface, children }: { surface: Surface; children: ReactNode }) {
  return (
    <RequireSession>
      <SurfaceGate surface={surface}>{children}</SurfaceGate>
    </RequireSession>
  );
}
