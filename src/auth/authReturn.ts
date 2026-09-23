/**
 * What happened on the way back from an email authentication link.
 *
 * Supabase reports the outcome of `/auth/v1/verify` in the redirect itself, as
 * machine-readable parameters — a consumed or expired link comes back as
 * `#error=access_denied&error_code=otp_expired`, alongside a human
 * `error_description` we deliberately ignore. Classification reads `error_code`,
 * never the prose: the codes are the contract, the sentence is not.
 *
 * The parameters live in the hash for the implicit flow and in the query string for
 * PKCE, so both are read.
 *
 * Timing matters. The Supabase client consumes the URL and rewrites it via
 * `history.replaceState` as soon as it is constructed, so this module snapshots the
 * location at import and `platform/supabase.ts` imports it first — ES modules
 * guarantee this body runs before that client is created.
 */

export type AuthReturn =
  /** This page load did not come back from an authentication link. */
  | { kind: 'none' }
  /** The link carried credentials; a session is expected to follow. */
  | { kind: 'pending'; via: 'code' | 'token' }
  /** The link itself is unusable: expired, already used, or not verifiable here. */
  | { kind: 'link-failure'; reason: string }
  /** Something else went wrong; not the link's fault. */
  | { kind: 'other-failure'; reason: string };

/**
 * Error codes that mean "this email link cannot be used".
 *
 * `otp_expired` covers both expiry and reuse — Supabase does not distinguish them,
 * which is why the screen must not promise which one happened. The `flow_state_*`
 * and `bad_code_verifier` codes are the PKCE equivalents, raised when a link is
 * opened somewhere other than the browser that asked for it.
 */
const LINK_FAILURE_CODES = new Set([
  'otp_expired',
  'otp_disabled',
  'email_link_invalid',
  'access_denied',
  'flow_state_not_found',
  'flow_state_expired',
  'bad_code_verifier',
  'pkce_grant_code_exchange_failed',
]);

function paramsOf(search: string, hash: string): URLSearchParams {
  const merged = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const [key, value] of new URLSearchParams(fragment)) merged.set(key, value);
  return merged;
}

export function classifyAuthReturn(search: string, hash: string): AuthReturn {
  const params = paramsOf(search, hash);

  const error = params.get('error');
  const errorCode = params.get('error_code');

  if (error || errorCode) {
    // Prefer the specific code; fall back to the OAuth-level error.
    const reason = errorCode ?? error ?? 'unknown';
    const known = LINK_FAILURE_CODES.has(reason) || (error !== null && LINK_FAILURE_CODES.has(error));
    return known ? { kind: 'link-failure', reason } : { kind: 'other-failure', reason };
  }

  if (params.get('code')) return { kind: 'pending', via: 'code' };
  if (params.get('access_token')) return { kind: 'pending', via: 'token' };

  return { kind: 'none' };
}

/**
 * Whether this page load failed because of the link it arrived on.
 *
 * Two shapes count. Supabase may say so outright, or it may hand back a code that
 * cannot be redeemed here — a link opened in a different browser than the one that
 * requested it carries a valid code and no verifier to match it, so the exchange
 * quietly produces no session. Both leave the person with an unusable link, and
 * neither is a network or application fault.
 */
export function isAuthLinkFailure(authReturn: AuthReturn, signedOut: boolean): boolean {
  if (authReturn.kind === 'link-failure') return true;
  if (authReturn.kind === 'pending' && signedOut) return true;
  return false;
}

const snapshot: AuthReturn =
  typeof window === 'undefined'
    ? { kind: 'none' }
    : classifyAuthReturn(window.location.search, window.location.hash);

/**
 * Whether a session was ever established during this page load.
 *
 * Once one has been, the link plainly worked, and nothing that happens afterwards —
 * signing out, above all — may be blamed on it. Without this, arriving by magic link
 * and then choosing Sair would be reported as a broken link, because the snapshot
 * still says a code arrived and the person is once again signed out.
 */
let resolved = false;

export function markAuthReturnResolved(): void {
  resolved = true;
}

/** The outcome captured for this page load, before the client rewrote the URL. */
export function getAuthReturn(): AuthReturn {
  return resolved ? { kind: 'none' } : snapshot;
}
