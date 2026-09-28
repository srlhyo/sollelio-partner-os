/**
 * The partner's response, as the browser prepares it (05_DATA_MODEL_AND_API.md §4, §13).
 *
 * Pure functions: they build the exact body `submit_request` receives and warn about
 * what the server would reject. The server stays authoritative and validates the
 * whole submission again, atomically; this only lets the partner fix things before
 * sending. Nothing here touches browser storage.
 */
import type { FieldErrorItem, SubmissionBody } from './commands';
import type { ApprovalDecision, RequestFieldRecord, ReturnResponseType } from './types';
import { LIMITS } from './types';

/** A value being answered: text, a choice, Sim/Não, an approval decision, or nothing yet. */
export type AnswerValue = string | boolean | null;

/** Draft answers of the initial round, by field id. */
export type AnswerDraft = Record<string, AnswerValue>;

/** Draft of a returned round's single answer. */
export interface ReturnedDraft {
  text: string;
  decision: ApprovalDecision | null;
  notes: string;
}

export const EMPTY_RETURNED_DRAFT: ReturnedDraft = { text: '', decision: null, notes: '' };

export const isApprovalField = (field: RequestFieldRecord) => field.system_generated && field.key === 'approval';
export const isApprovalNotesField = (field: RequestFieldRecord) => field.system_generated && field.key === 'approval_notes';

const ordered = (fields: RequestFieldRecord[]) => [...fields].sort((a, b) => a.sort_order - b.sort_order);

/** The approval decision in a draft, when the Request has an approval field. */
export function draftDecision(fields: RequestFieldRecord[], draft: AnswerDraft): ApprovalDecision | null {
  const approval = fields.find(isApprovalField);
  const value = approval ? draft[approval.id] : null;
  return value === 'approve' || value === 'needs_changes' ? value : null;
}

function answered(value: AnswerValue): value is string | boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/**
 * The initial-round body: one answer per answered field, in field order, strings
 * trimmed. Unanswered optional fields are left out; change notes are sent only with
 * "Precisa de alterações".
 */
export function initialBody(fields: RequestFieldRecord[], draft: AnswerDraft): SubmissionBody {
  const decision = draftDecision(fields, draft);
  const answers: { field_id: string; value: string | boolean }[] = [];
  for (const field of ordered(fields)) {
    if (isApprovalNotesField(field) && decision !== 'needs_changes') continue;
    const value = draft[field.id] ?? null;
    if (!answered(value)) continue;
    answers.push({ field_id: field.id, value: typeof value === 'string' ? value.trim() : value });
  }
  return { answers };
}

/** What the server would reject in the initial round, by field id, in pt-PT. */
export function validateInitial(fields: RequestFieldRecord[], draft: AnswerDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of ordered(fields)) {
    const value = draft[field.id] ?? null;
    if (isApprovalNotesField(field) && draftDecision(fields, draft) !== 'needs_changes') continue;
    if (field.required && !answered(value)) {
      errors[field.id] = isApprovalField(field)
        ? 'Escolha Aprovar ou Precisa de alterações.'
        : field.type === 'long_text'
          ? 'Escreva a sua resposta.'
          : 'Escolha uma opção.';
      continue;
    }
    if (typeof value === 'string' && value.trim().length > LIMITS.answer) {
      errors[field.id] = `No máximo ${LIMITS.answer} caracteres.`;
    }
  }
  return errors;
}

/** The body of a returned round: the text, or the new decision (notes only with "Precisa de alterações"). */
export function returnedBody(type: ReturnResponseType, draft: ReturnedDraft): SubmissionBody {
  if (type === 'text') return { response: { text: draft.text.trim() } };
  const notes = draft.decision === 'needs_changes' ? draft.notes.trim() : '';
  return { response: { decision: draft.decision ?? 'approve', notes: notes === '' ? null : notes } };
}

/** What the server would reject in a returned round, keyed `text` / `decision` / `notes`. */
export function validateReturned(type: ReturnResponseType, draft: ReturnedDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (type === 'text') {
    if (draft.text.trim() === '') errors.text = 'Escreva a sua resposta.';
    else if (draft.text.trim().length > LIMITS.answer) errors.text = `No máximo ${LIMITS.answer} caracteres.`;
  } else {
    if (!draft.decision) errors.decision = 'Escolha Aprovar ou Precisa de alterações.';
    if (draft.decision === 'needs_changes' && draft.notes.trim().length > LIMITS.answer) {
      errors.notes = `No máximo ${LIMITS.answer} caracteres.`;
    }
  }
  return errors;
}

/**
 * The server's field errors, keyed like the drafts: a field id for the initial round
 * (`answers.<id>`), or `text` / `decision` / `notes` for a returned one.
 */
export function serverAnswerErrors(items: FieldErrorItem[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const item of items) {
    const key = item.field.startsWith('answers.')
      ? item.field.slice('answers.'.length)
      : item.field.startsWith('response.')
        ? item.field.slice('response.'.length)
        : '_form';
    errors[key] ??= item.message;
  }
  return errors;
}

/** How a stored answer reads, in pt-PT (read-only history, partner and staff). */
export function formatAnswer(field: RequestFieldRecord | undefined, value: unknown): string {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  if (field && isApprovalField(field)) {
    if (value === 'approve') return 'Aprovar';
    if (value === 'needs_changes') return 'Precisa de alterações';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}
