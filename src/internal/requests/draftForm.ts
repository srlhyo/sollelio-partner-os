/**
 * The draft form, as pure functions: state, client validation (mirror of
 * `app.request_normalize`), the payload sent to `request-commands`, and the
 * normalised comparison used to recognise our own write when a response was lost.
 */
import { resolveDueForSave, toDateInput } from '../../modules/requests/format';
import type { DraftPayload } from '../../modules/requests/commands';
import type { EditableAggregate } from '../../modules/requests/consistent';
import { EFFORT_PRESETS, LIMITS, type Priority, type RequestType } from '../../modules/requests/types';

export type { EditableAggregate };

export type AuthorFieldType = 'long_text' | 'single_choice' | 'boolean';

export interface QuestionDraft {
  localId: string;
  label: string;
  helpText: string;
  type: AuthorFieldType;
  required: boolean;
  options: string[];
}

export interface FormState {
  assignee: string;
  type: RequestType;
  title: string;
  context: string;
  requestedAction: string;
  effort: number | 'other';
  effortOther: string;
  due: string;
  /** The stored deadline, kept exactly when the day is not changed. */
  dueOriginal: string | null;
  productId: string;
  resourceId: string;
  criteria: string;
  ownerId: string;
  priority: Priority;
  questions: QuestionDraft[];
}

export type Errors = Record<string, string>;

export const newQuestion = (): QuestionDraft => ({
  localId: crypto.randomUUID(),
  label: '',
  helpText: '',
  type: 'long_text',
  required: true,
  options: [],
});

export function initialState(existing: EditableAggregate | null): FormState {
  if (!existing) {
    return {
      assignee: '',
      type: 'question',
      title: '',
      context: '',
      requestedAction: '',
      effort: 3,
      effortOther: '',
      due: '',
      dueOriginal: null,
      productId: '',
      resourceId: '',
      criteria: '',
      ownerId: '',
      priority: 'normal',
      questions: [],
    };
  }
  const { request, fields } = existing;
  const minutes = request.estimatedEffortMinutes;
  const isPreset = (EFFORT_PRESETS as readonly number[]).includes(minutes);
  return {
    assignee: request.assigneeProfileId,
    type: request.type,
    title: request.title,
    context: request.context ?? '',
    requestedAction: request.requestedAction,
    effort: isPreset ? minutes : 'other',
    effortOther: isPreset ? '' : String(minutes),
    due: toDateInput(request.dueAt),
    dueOriginal: request.dueAt,
    productId: request.productId ?? '',
    resourceId: request.resourceId ?? '',
    criteria: request.internal?.completionCriteria ?? '',
    ownerId: request.internal?.internalOwnerProfileId ?? '',
    priority: request.internal?.priority ?? 'normal',
    questions: fields
      .filter((f) => !f.system_generated && f.type !== 'approval')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => ({
        localId: f.id,
        label: f.label,
        helpText: f.help_text ?? '',
        type: f.type as AuthorFieldType,
        required: f.required,
        options: f.options ?? [],
      })),
  };
}

export function effortValue(form: FormState): number | null {
  if (form.effort !== 'other') return form.effort;
  const n = Number(form.effortOther);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** The client mirror of `app.request_normalize`: same limits, earlier feedback. */
export function validate(form: FormState): Errors {
  const e: Errors = {};
  if (!form.assignee) e.assignee_profile_id = 'Escolha a pessoa a quem o pedido se dirige.';
  if (!form.title.trim()) e.title = 'Escreva um título.';
  else if (form.title.trim().length > LIMITS.title) e.title = `O título tem no máximo ${LIMITS.title} caracteres.`;
  if (!form.requestedAction.trim()) e.requested_action = 'Descreva o que precisa que a parceira faça.';
  else if (form.requestedAction.trim().length > LIMITS.longText) e.requested_action = `No máximo ${LIMITS.longText} caracteres.`;
  if (form.context.trim().length > LIMITS.longText) e.context = `No máximo ${LIMITS.longText} caracteres.`;
  if (effortValue(form) === null) e.estimated_effort_minutes = 'O esforço é um número inteiro de minutos, pelo menos 1.';
  if (form.due && resolveDueForSave(form.due, form.dueOriginal) === null) e.due_at = 'Data inválida.';
  if (form.criteria.trim().length > LIMITS.longText) e['internal.completion_criteria'] = `No máximo ${LIMITS.longText} caracteres.`;
  if (!form.criteria.trim() && (form.ownerId || form.priority !== 'normal')) {
    e['internal.completion_criteria'] = 'Escreva o critério de conclusão para guardar a prioridade ou o responsável.';
  }
  if (form.type !== 'approval') {
    if (form.questions.length > LIMITS.fields) e.fields = `No máximo ${LIMITS.fields} perguntas.`;
    form.questions.forEach((q, i) => {
      if (!q.label.trim()) e[`fields[${i}].label`] = 'Escreva a pergunta.';
      else if (q.label.trim().length > LIMITS.fieldLabel) e[`fields[${i}].label`] = `No máximo ${LIMITS.fieldLabel} caracteres.`;
      if (q.helpText.trim().length > LIMITS.helpText) e[`fields[${i}].help_text`] = `No máximo ${LIMITS.helpText} caracteres.`;
      if (q.type === 'single_choice') {
        if (q.options.length > LIMITS.options) e[`fields[${i}].options`] = `No máximo ${LIMITS.options} opções.`;
        q.options.forEach((o, j) => {
          if (!o.trim()) e[`fields[${i}].options[${j}]`] = 'Escreva a opção ou retire-a.';
          else if (o.trim().length > LIMITS.option) e[`fields[${i}].options[${j}]`] = `No máximo ${LIMITS.option} caracteres.`;
        });
      }
    });
  }
  return e;
}

export function toPayload(form: FormState, organizationId: string | null): DraftPayload {
  const payload: DraftPayload = {
    assignee_profile_id: form.assignee,
    type: form.type,
    title: form.title,
    context: form.context.trim() ? form.context : null,
    requested_action: form.requestedAction,
    estimated_effort_minutes: effortValue(form) ?? 0,
    due_at: resolveDueForSave(form.due, form.dueOriginal),
    product_id: form.productId || null,
    resource_id: form.resourceId || null,
    internal: {
      completion_criteria: form.criteria.trim() ? form.criteria : null,
      internal_owner_profile_id: form.ownerId || null,
      priority: form.priority,
    },
    fields:
      form.type === 'approval'
        ? []
        : form.questions.map((q) => ({
            label: q.label,
            help_text: q.helpText.trim() ? q.helpText : null,
            type: q.type,
            required: q.required,
            ...(q.type === 'single_choice' ? { options: q.options } : {}),
          })),
  };
  if (organizationId) payload.organization_id = organizationId;
  return payload;
}

/** The payload as the server stores it: trimmed, empty optionals as null, instants compared. */
function canonical(payload: DraftPayload) {
  const text = (value: string | null) => {
    const trimmed = (value ?? '').trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    assignee: payload.assignee_profile_id,
    type: payload.type,
    title: payload.title.trim(),
    context: text(payload.context),
    requestedAction: payload.requested_action.trim(),
    effort: payload.estimated_effort_minutes,
    due: payload.due_at ? new Date(payload.due_at).getTime() : null,
    product: payload.product_id,
    resource: payload.resource_id,
    criteria: text(payload.internal.completion_criteria),
    owner: payload.internal.internal_owner_profile_id,
    priority: payload.internal.priority,
    fields: payload.type === 'approval'
      ? []
      : payload.fields.map((f) => ({
          label: f.label.trim(),
          help: text(f.help_text),
          type: f.type,
          required: f.required,
          options: f.type === 'single_choice' ? (f.options ?? []).map((o) => o.trim()) : null,
        })),
  };
}

/**
 * Whether a stored aggregate carries exactly what the server would have written for
 * the attempt `sent`. Used after a lost response to tell "our write landed" from
 * "someone else changed it".
 *
 * An internal owner left blank (with a completion criterion) is filled by the server
 * with the authenticated actor of that attempt, so the expected owner is that actor
 * — `actorProfileId`, recorded when the attempt was sent — and never whatever owner
 * the later read happens to find. If the actor is not known, a match is not
 * confirmed: an unconfirmed match must fall back to the conflict path.
 */
export function aggregateMatches(
  stored: EditableAggregate,
  sent: DraftPayload,
  actorProfileId: string | null,
): boolean {
  const a = canonical(toPayload(initialState(stored), null));
  const b = canonical(sent);
  if (b.owner === null && b.criteria !== null) {
    if (!actorProfileId) return false;
    b.owner = actorProfileId;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether two payloads describe the same content (ignores the organization on create). */
export function samePayload(a: DraftPayload, b: DraftPayload): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
