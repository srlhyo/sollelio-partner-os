/**
 * Shared HTTP helpers for Partner OS Edge Functions.
 *
 * Every privileged server-side operation and every `/v1/*` integration endpoint runs
 * here, not in Netlify (04_TECHNICAL_ARCHITECTURE.md §2). Keeping the service-role
 * credential and the Events V1 integration secret in one runtime is the whole point.
 */

export interface ErrorBody {
  error: { code: string; message: string };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function failure(code: string, message: string, status: number): Response {
  const body: ErrorBody = { error: { code, message } };
  return json(body, status);
}

/** Reads a required secret, failing loudly rather than running half-configured. */
export function requireSecret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing Edge Function secret ${name}.`);
  return value;
}
