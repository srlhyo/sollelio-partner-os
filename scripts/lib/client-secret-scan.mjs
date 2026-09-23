/**
 * Detecting privileged credentials in browser output.
 *
 * Kept separate from the file walker so the rules themselves can be tested against
 * plain strings, without building anything.
 *
 * Three tiers, because the two file kinds carry different risk:
 *
 *   VALUES     — an actual credential. A finding anywhere, source maps included,
 *                because a key embedded in a map is just as leaked.
 *   NAMES      — our own secret identifiers. Our code should never reference one,
 *                in any file.
 *   MENTIONS   — a weak textual signal, real in executable output but ordinary
 *                prose in vendor source. Emitted assets only.
 *
 * The distinction is not theoretical. `@supabase/supabase-js` ships its own guard,
 * `key.startsWith('sb_secret_')`, and documents `service_role` in comments — both
 * reach the bundle and its source map. Flagging those would train everyone to
 * ignore this check, so the value rules require a credential-shaped token body
 * (measured: vendor literals carry a zero-length body, real keys carry ~30 chars).
 */
import { Buffer } from 'node:buffer';

/** Roles that must never appear in a token the browser holds. */
const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin']);

const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}\b/g;

/**
 * Credential values. `{16,}` is what separates a key from the bare prefix that
 * vendor code contains as a string literal.
 */
const VALUES = [
  {
    pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/,
    why: 'Supabase secret API key (sb_secret_…) — server-side only',
  },
  {
    pattern: /\bsbp_[A-Za-z0-9]{32,}/,
    why: 'Supabase personal access token (sbp_…) — management API credential',
  },
  {
    pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i,
    why: 'PostgreSQL connection string carrying a password',
  },
];

/** Our own secret identifiers. Client code should never name one. */
const NAMES = [
  { pattern: /SUPABASE_SERVICE_ROLE_KEY/i, why: 'Supabase service-role key reference' },
  { pattern: /PARTNER_OS_INTEGRATION_SECRET/i, why: 'Events V1 integration secret reference' },
];

/** Weak signal: meaningful in executable output, ordinary prose in vendor sources. */
const MENTIONS = [{ pattern: /service_role/i, why: 'service_role credential reference' }];

/**
 * Browser-safe credentials, stated so the intent is explicit: these must never be
 * reported. `sb_publishable_…` and anon/authenticated JWTs are what the client is
 * supposed to carry.
 */
export const BROWSER_SAFE_PREFIXES = ['sb_publishable_'];

/** Rejects a JWT whose payload claims a privileged role. */
function privilegedJwts(contents) {
  const found = [];
  for (const match of contents.matchAll(JWT)) {
    try {
      const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (typeof claims?.role === 'string' && PRIVILEGED_ROLES.has(claims.role)) {
        found.push(`JWT carrying role "${claims.role}"`);
      }
    } catch {
      // Not a JWT payload we can read — the textual rules still apply.
    }
  }
  return found;
}

/**
 * Scan one file's contents.
 *
 * `kind` is 'emitted' for assets the browser executes, 'sourcemap' for maps, which
 * additionally embed third-party source.
 *
 * Returns an array of reasons; empty means clean.
 */
export function scanText(contents, kind = 'emitted') {
  const reasons = [];

  const rules = kind === 'sourcemap' ? [...VALUES, ...NAMES] : [...VALUES, ...NAMES, ...MENTIONS];

  for (const { pattern, why } of rules) {
    if (pattern.test(contents)) reasons.push(why);
  }

  reasons.push(...privilegedJwts(contents));

  return reasons;
}
