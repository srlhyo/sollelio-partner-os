/**
 * Deployment health check.
 *
 * Exists to verify that the Edge Function pipeline deploys and that the function
 * environment is configured — nothing more. It exposes no domain data, reads no
 * table, and never returns a secret value: only whether one is present.
 */
import { failure, json } from '../_shared/http.ts';

Deno.serve((request: Request): Response => {
  if (request.method !== 'GET') {
    return failure('method_not_allowed', 'Use GET.', 405);
  }

  return json({
    service: 'sollelio-partner-os',
    status: 'ok',
    at: new Date().toISOString(),
    // Presence only. The values never leave this runtime.
    configured: {
      supabaseUrl: Boolean(Deno.env.get('SUPABASE_URL')),
      serviceRoleKey: Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
    },
  });
});
