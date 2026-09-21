/**
 * Staff-only route guard — user experience, not security.
 *
 * Every internal read is already limited by RLS to `app.is_staff()`. This exists so
 * a partner who follows an internal link sees an explanation instead of a screen of
 * empty panels.
 */
import type { ReactNode } from 'react';
import { useAsync } from '../platform/useAsync';
import { useSession } from '../platform/session-context';
import { fetchCurrentProfile } from '../modules/people/queries';
import { EmptyState, ErrorState, LoadingBlock } from '../platform/ui/States';

export function RequireStaff({ children }: { children: ReactNode }) {
  const session = useSession();
  const authUserId = session.status === 'signed-in' ? session.session.user.id : null;

  const profile = useAsync(
    () => (authUserId ? fetchCurrentProfile(authUserId) : Promise.resolve(null)),
    [authUserId],
  );

  if (profile.status === 'loading') {
    return (
      <div style={{ padding: 24, maxWidth: 520 }}>
        <LoadingBlock label="A verificar o acesso" />
      </div>
    );
  }

  if (profile.status === 'error') {
    return (
      <div style={{ padding: 24, maxWidth: 520 }}>
        <ErrorState onRetry={profile.reload}>Não conseguimos verificar o seu acesso.</ErrorState>
      </div>
    );
  }

  if (!profile.data?.isSollelioStaff) {
    return (
      <div style={{ padding: 24, maxWidth: 520 }}>
        <EmptyState title="Esta área é da equipa Sollelio." tone="warn">
          O seu espaço de parceira está em <a href="/partner">/partner</a>.
        </EmptyState>
      </div>
    );
  }

  return <>{children}</>;
}
