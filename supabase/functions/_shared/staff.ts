/**
 * Resolves the Sollelio staff member behind a request, or refuses it.
 *
 * The bearer token is validated by the Auth server (`auth.getUser`), never merely
 * decoded here, and the profile is looked up from the user id that validation
 * returns. Nothing in the request body can name the actor. The SQL command then
 * checks again that the profile exists and is staff.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type StaffResolution =
  | { ok: true; profileId: string }
  | { ok: false; status: 401 | 403 | 500; code: string; message: string };

export async function resolveStaff(admin: SupabaseClient, authorization: string | null): Promise<StaffResolution> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
  if (!token) {
    return { ok: false, status: 401, code: 'unauthenticated', message: 'Sign-in required.' };
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return { ok: false, status: 401, code: 'unauthenticated', message: 'Session is not valid.' };
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, is_sollelio_staff')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle<{ id: string; is_sollelio_staff: boolean }>();

  if (profileError) {
    return { ok: false, status: 500, code: 'internal_error', message: 'Could not resolve the caller.' };
  }
  if (!profile) {
    return { ok: false, status: 403, code: 'no_profile', message: 'No profile for this account.' };
  }
  if (!profile.is_sollelio_staff) {
    return { ok: false, status: 403, code: 'not_staff', message: 'Only Sollelio staff may run this command.' };
  }
  return { ok: true, profileId: profile.id };
}
