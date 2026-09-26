/**
 * request-commands — the C2 Request commands (05_DATA_MODEL_AND_API.md §13).
 *
 *   POST /request-commands/create   { request_id, payload }
 *   POST /request-commands/update   { request_id, expected_revision, payload }
 *   POST /request-commands/preview  { request_id }
 *   POST /request-commands/publish  { request_id, expected_revision, idempotency_key }
 *
 * This function verifies the caller and the shape of the body; the transactional
 * rules live in the SQL functions it calls (`public.cmd_*`), which only
 * `service_role` may execute. The actor always comes from the verified session.
 */
import { createClient } from '@supabase/supabase-js';
import { failure, json, requireSecret } from '../_shared/http.ts';
import { resolveStaff } from '../_shared/staff.ts';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '600',
};

/** Technical limit on the request body (C2). The SQL layer enforces per-field limits. */
const MAX_BODY_BYTES = 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Action = 'create' | 'update' | 'preview' | 'publish';

const SHAPES: Record<Action, readonly string[]> = {
  create: ['request_id', 'payload'],
  update: ['request_id', 'expected_revision', 'payload'],
  preview: ['request_id'],
  publish: ['request_id', 'expected_revision', 'idempotency_key'],
};

/** SQLSTATE raised by the command functions → HTTP status and stable code. */
const SQL_ERRORS: Record<string, [number, string]> = {
  RQ001: [403, 'not_staff'],
  RQ002: [404, 'not_found'],
  RQ003: [422, 'validation_failed'],
  RQ004: [422, 'organization_not_active'],
  RQ005: [422, 'assignee_not_active_member'],
  RQ006: [422, 'product_not_linked'],
  RQ007: [422, 'resource_not_available'],
  RQ008: [409, 'stale_revision'],
  RQ009: [409, 'invalid_state'],
  RQ010: [409, 'idempotency_conflict'],
  RQ011: [422, 'publish_requirements'],
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

function validateBody(action: Action, body: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; details: unknown } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, details: fieldError('body', 'invalid', 'O corpo do pedido tem de ser um objecto JSON.') };
  }
  const value = body as Record<string, unknown>;
  const allowed = SHAPES[action];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return { ok: false, details: fieldError(key, 'unknown_field', 'Campo não reconhecido.') };
  }
  if (typeof value.request_id !== 'string' || !UUID.test(value.request_id)) {
    return { ok: false, details: fieldError('request_id', 'invalid', 'Identificador de pedido inválido.') };
  }
  if ((action === 'create' || action === 'update') &&
      (typeof value.payload !== 'object' || value.payload === null || Array.isArray(value.payload))) {
    return { ok: false, details: fieldError('payload', 'invalid', 'Conteúdo do pedido inválido.') };
  }
  if ((action === 'update' || action === 'publish') &&
      (typeof value.expected_revision !== 'number' || !Number.isInteger(value.expected_revision) || value.expected_revision < 1)) {
    return { ok: false, details: fieldError('expected_revision', 'invalid', 'Versão esperada inválida.') };
  }
  if (action === 'publish' && (typeof value.idempotency_key !== 'string' || !UUID.test(value.idempotency_key))) {
    return { ok: false, details: fieldError('idempotency_key', 'invalid', 'Chave da operação inválida.') };
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

  const action = new URL(request.url).pathname.split('/').filter(Boolean).pop() as Action | undefined;
  if (!action || !(action in SHAPES)) return failure('not_found', 'Unknown command.', 404, CORS);

  const admin = createClient(requireSecret('SUPABASE_URL'), requireSecret('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const staff = await resolveStaff(admin, request.headers.get('authorization'));
  if (!staff.ok) return failure(staff.code, staff.message, staff.status, CORS);

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

  const checked = validateBody(action, body);
  if (!checked.ok) return failure('validation_failed', 'Dados inválidos.', 422, CORS, checked.details);
  const input = checked.value;

  const call = {
    create: () => admin.rpc('cmd_create_request', { p_actor: staff.profileId, p_request_id: input.request_id, p_payload: input.payload }),
    update: () => admin.rpc('cmd_update_request_draft', {
      p_actor: staff.profileId, p_request_id: input.request_id, p_expected_revision: input.expected_revision, p_payload: input.payload }),
    preview: () => admin.rpc('cmd_preview_request', { p_actor: staff.profileId, p_request_id: input.request_id }),
    publish: () => admin.rpc('cmd_publish_request', {
      p_actor: staff.profileId, p_request_id: input.request_id, p_expected_revision: input.expected_revision,
      p_idempotency_key: input.idempotency_key }),
  }[action];

  const { data, error } = await call();
  if (error) {
    const mapped = error.code ? SQL_ERRORS[error.code] : undefined;
    if (mapped) {
      const [status, code] = mapped;
      return failure(code, code, status, CORS, parseDetails(error.details));
    }
    // Never echo database internals to the client; keep enough to diagnose.
    console.error(JSON.stringify({ fn: 'request-commands', action, sqlstate: error.code ?? null }));
    return failure('internal_error', 'Unexpected error.', 500, CORS);
  }

  return json({ data }, 200, CORS);
});
