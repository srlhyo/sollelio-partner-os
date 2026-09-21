/**
 * Which organization the partner is acting in.
 *
 * V0 assumes exactly one active membership. When there is more than one, this
 * reports `choose` and the application asks — it never picks silently, because a
 * partner acting inside the wrong organization is worse than an extra tap
 * (05_DATA_MODEL_AND_API.md §1, 03_UX_SPEC.md §2).
 */
import { useAsync } from '../../platform/useAsync';
import { fetchMyActiveOrganizations } from './queries';
import type { Organization } from './types';

export type OrganizationContext =
  | { state: 'loading' }
  | { state: 'error'; error: Error; reload: () => void }
  | { state: 'none' }
  | { state: 'choose'; organizations: Organization[] }
  | { state: 'ready'; organization: Organization };

export function useOrganizationContext(preferredSlug?: string | undefined): OrganizationContext {
  const result = useAsync(fetchMyActiveOrganizations, []);

  if (result.status === 'loading') return { state: 'loading' };
  if (result.status === 'error') {
    return { state: 'error', error: result.error, reload: result.reload };
  }

  const organizations = result.data;
  if (organizations.length === 0) return { state: 'none' };

  const only = organizations[0];
  if (organizations.length === 1 && only) return { state: 'ready', organization: only };

  const preferred = preferredSlug
    ? organizations.find((organization) => organization.slug === preferredSlug)
    : undefined;

  if (preferred) return { state: 'ready', organization: preferred };
  return { state: 'choose', organizations };
}
