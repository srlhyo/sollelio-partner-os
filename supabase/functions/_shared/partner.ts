/**
 * Resolves the person behind a partner command, or refuses the request.
 *
 * The bearer token is validated by the Auth server (`auth.getUser`), never merely
 * decoded here, and the profile is looked up from the user id that validation
 * returns. Nothing in the request body can name the actor. Being resolved grants
 * nothing by itself: the SQL command decides whether this profile may act on the
 * Request (assignee, active membership), because `auth.uid()` is empty in the
 * service-role call that follows (04_TECHNICAL_ARCHITECTURE.md §8).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProfileResolution =
  | { ok: true; profileId: string }
  | { ok: false; status: 401 | 403 | 500; code: string; message: string };

export async function resolveProfile(admin: SupabaseClient, authorization: string | null): Promise<ProfileResolution> {
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
    .select('id')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle<{ id: string }>();

  if (profileError) {
    return { ok: false, status: 500, code: 'internal_error', message: 'Could not resolve the caller.' };
  }
  if (!profile) {
    return { ok: false, status: 403, code: 'no_profile', message: 'No profile for this account.' };
  }
  return { ok: true, profileId: profile.id };
}
