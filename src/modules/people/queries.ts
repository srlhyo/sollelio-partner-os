/**
 * People — profile reads.
 *
 * A partner may read their own profile row only; Sollelio staff may read any.
 * RLS enforces that, not this file (05_DATA_MODEL_AND_API.md §12.2).
 */
import { supabase } from '../../platform/supabase';
import type { Profile } from './types';

interface ProfileRow {
  id: string;
  auth_user_id: string;
  display_name: string;
  is_sollelio_staff: boolean;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    isSollelioStaff: row.is_sollelio_staff,
  };
}

/**
 * The signed-in person's profile, or null when the auth user has no profile yet.
 *
 * People are created invite-first — auth user, then profile — so a signed-in user
 * without a profile means onboarding is incomplete, not that something broke.
 */
export async function fetchCurrentProfile(authUserId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, auth_user_id, display_name, is_sollelio_staff')
    .eq('auth_user_id', authUserId)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(error.message);
  return data ? toProfile(data) : null;
}

export interface OrganizationMember {
  profile: Profile;
  membershipStatus: 'active' | 'inactive';
  role: 'partner_member';
}

interface MemberRow {
  role: 'partner_member';
  status: 'active' | 'inactive';
  profiles: ProfileRow | null;
}

/** Staff view of who belongs to an organization. */
export async function fetchOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMember[]> {
  const { data, error } = await supabase
    .from('organization_memberships')
    .select('role, status, profiles(id, auth_user_id, display_name, is_sollelio_staff)')
    .eq('organization_id', organizationId)
    .returns<MemberRow[]>();

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row): row is MemberRow & { profiles: ProfileRow } => row.profiles !== null)
    .map((row) => ({
      profile: toProfile(row.profiles),
      membershipStatus: row.status,
      role: row.role,
    }));
}
