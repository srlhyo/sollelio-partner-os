/**
 * Requests — domain types and pt-PT vocabulary (05_DATA_MODEL_AND_API.md §4).
 *
 * Enum values stay English: they are domain terminology. Everything a person reads
 * goes through the label maps below, so no raw state ever reaches a screen
 * (01_PRODUCT_SPEC.md §13).
 */
export type RequestType = 'review' | 'approval' | 'question' | 'test' | 'task';
export type RequestStatus = 'draft' | 'needs_partner' | 'needs_sollelio' | 'completed' | 'cancelled';
export type NextActor = 'partner' | 'sollelio' | 'none';
export type PartnerState = 'needs_you' | 'with_sollelio' | 'done' | 'cancelled';
export type FieldType = 'long_text' | 'single_choice' | 'boolean' | 'approval';
export type Priority = 'normal' | 'important' | 'urgent';

/**
 * One row of `partner_requests` — the partner-facing projection, exactly as the
 * database returns it. The staff preview returns the same shape from the same
 * server-side projection; the client never assembles it.
 */
export interface PartnerRequestRecord {
  id: string;
  organization_id: string;
  product_id: string | null;
  product_name: string | null;
  type: RequestType;
  title: string;
  context: string | null;
  requested_action: string;
  estimated_effort_minutes: number;
  due_at: string | null;
  partner_state: PartnerState;
  published_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  related_update_id: string | null;
  resource_id: string | null;
}

/** One row of `request_fields`, as the partner (and the preview) reads it. */
export interface RequestFieldRecord {
  id: string;
  request_id: string;
  key: string;
  label: string;
  help_text: string | null;
  type: FieldType;
  required: boolean;
  options: string[] | null;
  sort_order: number;
  system_generated: boolean;
}

/** What `preview_request` returns. */
export interface RequestPreview {
  request_id: string;
  organization_id: string;
  revision: number;
  status: RequestStatus;
  simulated_publication: boolean;
  request: PartnerRequestRecord;
  fields: RequestFieldRecord[];
  resource: Record<string, unknown> | null;
  resource_unavailable: boolean;
}

/** Internal (staff) view of a Request row. */
export interface InternalRequest {
  id: string;
  organizationId: string;
  productId: string | null;
  resourceId: string | null;
  type: RequestType;
  status: RequestStatus;
  nextActor: NextActor;
  title: string;
  context: string | null;
  requestedAction: string;
  estimatedEffortMinutes: number;
  assigneeProfileId: string;
  dueAt: string | null;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
  revision: number;
  internal: {
    completionCriteria: string;
    internalOwnerProfileId: string | null;
    priority: Priority;
  } | null;
}

export interface InternalNote {
  id: string;
  authorProfileId: string;
  content: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  eventType: string;
  actorProfileId: string | null;
  createdAt: string;
}

// ---- Response loop (C3, 05_DATA_MODEL_AND_API.md §4, §13) ----------------------

export type ReturnResponseType = 'text' | 'approval';
export type ApprovalDecision = 'approve' | 'needs_changes';

/** One row of `partner_request_returns`: what Sollelio asked when it returned the Request. */
export interface PartnerReturnRecord {
  id: string;
  request_id: string;
  response_type: ReturnResponseType;
  message: string;
  created_at: string;
}

/** A return as staff read it, with who returned it. */
export interface InternalReturnRecord extends PartnerReturnRecord {
  created_by: string;
}

/** One answer to an original field (initial round only). */
export interface AnswerRecord {
  request_field_id: string;
  value: unknown;
}

/**
 * One submission, as its author (RLS: own only) or staff read it. `return_id` null is
 * the initial round, answered in `answers`; otherwise the round's own response.
 */
export interface SubmissionRecord {
  id: string;
  request_id: string;
  submitted_by: string;
  return_id: string | null;
  response_text: string | null;
  response_decision: ApprovalDecision | null;
  response_notes: string | null;
  created_at: string;
  answers: AnswerRecord[];
}

/** The round the partner answers now: the initial one, or the current return. */
export type CurrentRound = { kind: 'initial' } | { kind: 'returned'; ret: PartnerReturnRecord };

export const RETURN_RESPONSE_TYPE_LABELS: Record<ReturnResponseType, string> = {
  text: 'Texto',
  approval: 'Aprovação',
};

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  approve: 'Aprovar',
  needs_changes: 'Precisa de alterações',
};

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  review: 'Revisão',
  approval: 'Aprovação',
  question: 'Pergunta',
  test: 'Teste',
  task: 'Tarefa',
};

export const REQUEST_TYPES: RequestType[] = ['question', 'review', 'approval', 'test', 'task'];

export const PARTNER_STATE_LABELS: Record<PartnerState, string> = {
  needs_you: 'Precisa de si',
  with_sollelio: 'Com a Sollelio',
  done: 'Concluído',
  cancelled: 'Cancelado',
};

/** Internal chips name the next responsible party, which is what the operator asks. */
export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Rascunho',
  needs_partner: 'Espera pela parceira',
  needs_sollelio: 'Espera pela Sollelio',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export const STATUS_TONES: Record<RequestStatus, 'neutral' | 'amber' | 'indigo' | 'green'> = {
  draft: 'neutral',
  needs_partner: 'amber',
  needs_sollelio: 'indigo',
  completed: 'green',
  cancelled: 'neutral',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  normal: 'Normal',
  important: 'Importante',
  urgent: 'Urgente',
};

export const FIELD_TYPE_LABELS: Record<Exclude<FieldType, 'approval'>, string> = {
  long_text: 'Texto',
  single_choice: 'Escolha única',
  boolean: 'Sim / Não',
};

export const ACTIVITY_LABELS: Record<string, string> = {
  'request.created': 'Criou o pedido',
  'request.published': 'Publicou o pedido',
  'request.submitted': 'Respondeu ao pedido',
  'request.returned_to_partner': 'Devolveu à parceira',
  'request.completed': 'Concluiu o pedido',
};

/**
 * Technical limits introduced in C2 (05 §13). Mirrors `app.request_normalize`
 * exactly; the server is authoritative and the client only warns earlier.
 */
export const LIMITS = {
  title: 200,
  longText: 4000,
  fields: 20,
  fieldLabel: 300,
  helpText: 1000,
  options: 20,
  option: 200,
  /** C3: a text answer, a returned-round reply, approval notes. */
  answer: 4000,
  /** C3: the message of a return. */
  returnMessage: 2000,
} as const;

/** Effort presets offered in the editor. `~3` is the onboarding baseline (07 §9). */
export const EFFORT_PRESETS = [1, 2, 3, 5, 10, 15] as const;
