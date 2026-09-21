/**
 * The signed-in Sollelio operator's profile.
 */
import { useAsync } from '../platform/useAsync';
import { useSession } from '../platform/session-context';
import { fetchCurrentProfile } from '../modules/people/queries';
import type { Profile } from '../modules/people/types';

export function useCurrentProfile(): Profile | null {
  const session = useSession();
  const authUserId = session.status === 'signed-in' ? session.session.user.id : null;

  const result = useAsync(
    () => (authUserId ? fetchCurrentProfile(authUserId) : Promise.resolve(null)),
    [authUserId],
  );

  return result.status === 'ready' ? result.data : null;
}
