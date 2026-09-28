/**
 * partner-request-commands — the partner's Request commands (05_DATA_MODEL_AND_API.md §13, C3).
 *
 *   POST /partner-request-commands/submit
 *     { request_id, submission_id, expected_return_id, answers }   — initial round
 *     { request_id, submission_id, expected_return_id, response }  — returned round
 *
 * Separate from the staff `request-commands` so that function keeps its staff gate
 * unchanged. This one resolves any profile from the verified session and passes it
 * to `public.cmd_submit_request`, which authorizes it as the Request's assignee with
 * an active membership. Actor, organization and assignee are never read from the
 * body. The deep validation of answers lives in SQL, atomically.
 */
import { createClient } from '@supabase/supabase-js';
import { failure, json, requireSecret } from '../_shared/http.ts';
import { resolveProfile } from '../_shared/partner.ts';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '600',
};

/** Technical limit on the request body, as in C2. The SQL layer enforces per-answer limits. */
const MAX_BODY_BYTES = 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUBMIT_KEYS = ['request_id', 'submission_id', 'expected_return_id', 'answers', 'response'] as const;

/** SQLSTATE raised by the command → HTTP status and stable code. */
const SQL_ERRORS: Record<string, [number, string]> = {
  RQ002: [404, 'not_found'],
  RQ003: [422, 'validation_failed'],
  RQ009: [409, 'invalid_state'],
  RQ010: [409, 'idempotency_conflict'],
  RQ012: [409, 'stale_round'],
  // A database invariant caught a race the command's own checks did not see.
  '23514': [409, 'conflict'],
  '23503': [409, 'conflict'],
  '23505': [409, 'conflict'],
  '40001': [503, 'busy'],
  '40P01': [503, 'busy'],
  '55P03': [503, 'busy'],
};

function fieldError(field: string, code: string, message: string) {
  return { errors: [{ field, code, message }] };
}

function validateSubmit(body: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; details: unknown } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, details: fieldError('body', 'invalid', 'O corpo do pedido tem de ser um objecto JSON.') };
  }
  const value = body as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!(SUBMIT_KEYS as readonly string[]).includes(key)) {
      return { ok: false, details: fieldError(key, 'unknown_field', 'Campo não reconhecido.') };
    }
  }
  if (typeof value.request_id !== 'string' || !UUID.test(value.request_id)) {
    return { ok: false, details: fieldError('request_id', 'invalid', 'Identificador de pedido inválido.') };
  }
  if (typeof value.submission_id !== 'string' || !UUID.test(value.submission_id)) {
    return { ok: false, details: fieldError('submission_id', 'invalid', 'Identificador da resposta inválido.') };
  }
  // Always present: null names the initial round, a return id names a returned one.
  if (!('expected_return_id' in value) ||
      (value.expected_return_id !== null &&
       (typeof value.expected_return_id !== 'string' || !UUID.test(value.expected_return_id)))) {
    return { ok: false, details: fieldError('expected_return_id', 'invalid', 'Ronda esperada inválida.') };
  }
  return { ok: true, value };
}

function parseDetails(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return failure('method_not_allowed', 'Use POST.', 405, CORS);

  const action = new URL(request.url).pathname.split('/').filter(Boolean).pop();
  if (action !== 'submit') return failure('not_found', 'Unknown command.', 404, CORS);

  const admin = createClient(requireSecret('SUPABASE_URL'), requireSecret('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const actor = await resolveProfile(admin, request.headers.get('authorization'));
  if (!actor.ok) return failure(actor.code, actor.message, actor.status, CORS);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return failure('payload_too_large', 'O pedido excede 64 KB.', 413, CORS);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return failure('validation_failed', 'JSON inválido.', 422, CORS, fieldError('body', 'invalid', 'JSON inválido.'));
  }

  const checked = validateSubmit(body);
  if (!checked.ok) return failure('validation_failed', 'Dados inválidos.', 422, CORS, checked.details);
  const input = checked.value;

  // The payload is what the SQL command validates: `answers` or `response`, as sent.
  const payload: Record<string, unknown> = {};
  if ('answers' in input) payload.answers = input.answers;
  if ('response' in input) payload.response = input.response;

  const { data, error } = await admin.rpc('cmd_submit_request', {
    p_actor: actor.profileId,
    p_request_id: input.request_id,
    p_submission_id: input.submission_id,
    p_expected_return_id: input.expected_return_id,
    p_payload: payload,
  });
  if (error) {
    const mapped = error.code ? SQL_ERRORS[error.code] : undefined;
    if (mapped) {
      const [status, code] = mapped;
      return failure(code, code, status, CORS, parseDetails(error.details));
    }
    // Never echo database internals to the client; keep enough to diagnose.
    console.error(JSON.stringify({ fn: 'partner-request-commands', action, sqlstate: error.code ?? null }));
    return failure('internal_error', 'Unexpected error.', 500, CORS);
  }

  return json({ data }, 200, CORS);
});
