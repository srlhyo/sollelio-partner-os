/**
 * Where an authenticated person belongs.
 *
 * Partner OS has two security surfaces (04_TECHNICAL_ARCHITECTURE.md §5), and a
 * magic link is minted before anyone knows which one the person belongs to: the
 * profile that carries `is_sollelio_staff` is unreadable until the session exists.
 * So the requested destination is a *request*, never a grant — it is validated
 * against the authenticated role on arrival.
 *
 * These rules are pure and exhaustively tested; the guards apply them.
 */

export type Role = 'partner' | 'staff';
export type Surface = 'partner' | 'internal';

export const PARTNER_HOME = '/partner';
export const INTERNAL_HOME = '/app/organizations';

/** Auth screens are steps in the flow, never somewhere to land — landing on one loops. */
const AUTH_PATHS = ['/partner/sign-in', '/partner/check-email', '/partner/link-expired'];

/** A missing profile is not staff. Unknown resolves to the lesser privilege. */
export function roleOf(profile: { isSollelioStaff: boolean } | null | undefined): Role {
  return profile?.isSollelioStaff ? 'staff' : 'partner';
}

export function surfaceForRole(role: Role): Surface {
  return role === 'staff' ? 'internal' : 'partner';
}

export function homeFor(role: Role): string {
  return role === 'staff' ? INTERNAL_HOME : PARTNER_HOME;
}

/**
 * Whether a value is a path inside this application.
 *
 * Rejects anything that could leave the origin — an absolute URL, a scheme, or the
 * protocol-relative `//host` form that a browser treats as another site. A
 * `redirectTo` arrives from the query string, so it is attacker-controllable.
 */
export function isSafeAppPath(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  // Backslashes and control characters are normalised by some browsers into forms
  // that escape the origin.
  if (value.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return true;
}

/** Which surface a path belongs to, or null when it is neither. */
export function surfaceOfPath(path: string): Surface | null {
  const [pathname] = path.split(/[?#]/) as [string, ...string[]];

  if (AUTH_PATHS.includes(pathname)) return null;
  if (pathname === '/app' || pathname.startsWith('/app/')) return 'internal';
  if (pathname === '/partner' || pathname.startsWith('/partner/')) return 'partner';
  return null;
}

/**
 * The destination an authenticated person should actually reach.
 *
 * A requested destination is honoured only when it is a safe in-app path on the
 * surface that role is allowed to use. Anything else — missing, malformed, or
 * pointing across the boundary — falls back to that role's home.
 */
export function resolveDestination(role: Role, requested: string | null | undefined): string {
  if (!isSafeAppPath(requested)) return homeFor(role);
  if (surfaceOfPath(requested) !== surfaceForRole(role)) return homeFor(role);
  return requested;
}
