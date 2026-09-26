/**
 * Request commands — calls to the `request-commands` Edge Function.
 *
 * The browser never writes Request tables: it holds no grant to. It sends the
 * signed-in user's access token and the function decides, after verifying that
 * session and resolving a staff profile (05_DATA_MODEL_AND_API.md §13).
 */
import { env } from '../../platform/env';
import { supabase } from '../../platform/supabase';
import type { Priority, RequestPreview, RequestStatus, RequestType } from './types';

export interface FieldErrorItem {
  field: string;
  code: string;
  message: string;
}

export type CommandErrorCode =
  | 'unauthenticated'
  | 'no_profile'
  | 'not_staff'
  | 'not_found'
  | 'validation_failed'
  | 'organization_not_active'
  | 'assignee_not_active_member'
  | 'product_not_linked'
  | 'resource_not_available'
  | 'stale_revision'
  | 'invalid_state'
  | 'idempotency_conflict'
  | 'publish_requirements'
  | 'conflict'
  | 'busy'
  | 'payload_too_large'
  | 'network'
  | 'internal_error';

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly status: number;
  readonly fieldErrors: FieldErrorItem[];
  readonly details: unknown;

  constructor(code: CommandErrorCode, status: number, details?: unknown) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
    const errors = (details as { errors?: unknown } | undefined)?.errors;
    this.fieldErrors = Array.isArray(errors) ? (errors as FieldErrorItem[]) : [];
  }

  /**
   * The request may or may not have been applied: the connection failed after
   * sending, or the server/gateway failed without a definitive domain answer. The
   * only safe next step is to repeat the SAME attempt, or to read what happened.
   */
  get ambiguous(): boolean {
    return this.code === 'network' || this.status >= 500;
  }
}

export interface DraftFieldInput {
  label: string;
  help_text: string | null;
  type: 'long_text' | 'single_choice' | 'boolean';
  required: boolean;
  options?: string[];
}

/** The editable content of a Request, as `app.request_normalize` accepts it. */
export interface DraftPayload {
  organization_id?: string;
  assignee_profile_id: string;
  type: RequestType;
  title: string;
  context: string | null;
  requested_action: string;
  estimated_effort_minutes: number;
  due_at: string | null;
  product_id: string | null;
  resource_id: string | null;
  internal: {
    completion_criteria: string | null;
    internal_owner_profile_id: string | null;
    priority: Priority;
  };
  fields: DraftFieldInput[];
}

export interface CommandResult {
  request_id: string;
  revision: number;
  status: RequestStatus;
  replayed: boolean;
  published_at?: string;
}

async function call<T>(action: 'create' | 'update' | 'preview' | 'publish', body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CommandError('unauthenticated', 401);

  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/functions/v1/request-commands/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.supabaseAnonKey,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CommandError('network', 0);
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  // A 401 is an authentication failure whoever sent it: the Edge Function's
  // `{ error: { code } }`, the gateway's own `{ msg }`/`{ message }`, or no body.
  if (response.status === 401) throw new CommandError('unauthenticated', 401);

  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; details?: unknown } } | null)?.error;
    throw new CommandError((error?.code as CommandErrorCode | undefined) ?? 'internal_error', response.status, error?.details);
  }
  if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
    // A 2xx without the function's envelope is not a confirmation of anything.
    throw new CommandError('internal_error', 502);
  }
  return (parsed as { data: T }).data;
}

/** `requestId` is generated once per new draft and makes a retry harmless. */
export function createRequestDraft(requestId: string, payload: DraftPayload): Promise<CommandResult> {
  return call('create', { request_id: requestId, payload });
}

export function updateRequestDraft(
  requestId: string,
  expectedRevision: number,
  payload: DraftPayload,
): Promise<CommandResult> {
  return call('update', { request_id: requestId, expected_revision: expectedRevision, payload });
}

export function previewRequest(requestId: string): Promise<RequestPreview> {
  return call('preview', { request_id: requestId });
}

/** `idempotencyKey` identifies one publication attempt; reuse it only to retry that attempt. */
export function publishRequest(requestId: string, expectedRevision: number, idempotencyKey: string): Promise<CommandResult> {
  return call('publish', { request_id: requestId, expected_revision: expectedRevision, idempotency_key: idempotencyKey });
}

/** pt-PT copy for command failures that are not field errors. */
export function commandErrorMessage(error: unknown): string {
  if (!(error instanceof CommandError)) return 'Não foi possível concluir. Tente novamente.';
  switch (error.code) {
    case 'unauthenticated':
      return 'A sua sessão terminou. Entre de novo para continuar.';
    case 'no_profile':
    case 'not_staff':
      return 'Esta acção é só para a equipa Sollelio.';
    case 'not_found':
      return 'Não encontrámos este pedido ou um elemento associado.';
    case 'validation_failed':
      return 'Há campos a corrigir.';
    case 'organization_not_active':
      return 'A organização não está activa. Não é possível criar, editar ou publicar pedidos.';
    case 'assignee_not_active_member':
      return 'A pessoa escolhida já não é membro activo desta organização.';
    case 'product_not_linked':
      return 'O produto escolhido não está activo para esta organização.';
    case 'resource_not_available':
      return 'O recurso escolhido não está disponível para a parceira. Escolha outro ou retire-o.';
    case 'stale_revision':
      return 'Este pedido foi alterado entretanto. Recarregue para ver a versão actual antes de continuar.';
    case 'invalid_state':
      return 'Este pedido já não é um rascunho.';
    case 'idempotency_conflict':
      return 'Esta operação já foi feita com outros dados. Recarregue o pedido.';
    case 'publish_requirements':
      return 'Falta completar o pedido antes de o publicar.';
    case 'conflict':
    case 'busy':
      return 'Houve uma alteração ao mesmo tempo. Tente novamente.';
    case 'payload_too_large':
      return 'O pedido é demasiado grande.';
    case 'network':
      return 'Não conseguimos contactar o servidor. Verifique a ligação e tente novamente.';
    default:
      return 'Não foi possível concluir. Tente novamente.';
  }
}
