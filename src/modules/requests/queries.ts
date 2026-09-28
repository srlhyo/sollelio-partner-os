/**
 * Request reads. Commands live in ./commands.ts.
 *
 * Partner reads go through `partner_requests`, `request_fields` and `resources`, all
 * constrained by RLS to what this partner may see (05_DATA_MODEL_AND_API.md §12.3).
 * Staff reads use the base tables under staff-only policies. Nothing here writes.
 */
import { supabase } from '../../platform/supabase';
import type {
  ActivityEntry,
  InternalNote,
  InternalRequest,
  InternalReturnRecord,
  PartnerRequestRecord,
  PartnerReturnRecord,
  Priority,
  RequestFieldRecord,
  SubmissionRecord,
} from './types';

// ---- Partner ---------------------------------------------------------------

/** Published Requests awaiting this partner in one organization. */
export async function fetchPartnerAttention(organizationId: string): Promise<PartnerRequestRecord[]> {
  const { data, error } = await supabase
    .from('partner_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('partner_state', 'needs_you')
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('published_at', { ascending: false })
    .returns<PartnerRequestRecord[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** One Request as the partner may see it, or null — absent and forbidden look the same. */
export async function fetchPartnerRequest(id: string): Promise<PartnerRequestRecord | null> {
  const { data, error } = await supabase
    .from('partner_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle<PartnerRequestRecord>();

  if (error) throw new Error(error.message);
  return data;
}

/** Fields of one Request. RLS returns them only when the Request is visible. */
export async function fetchRequestFields(requestId: string): Promise<RequestFieldRecord[]> {
  const { data, error } = await supabase
    .from('request_fields')
    .select('*')
    .eq('request_id', requestId)
    .order('sort_order')
    .returns<RequestFieldRecord[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * What Sollelio asked when it returned this Request, oldest first
 * (`partner_request_returns`: only for a Request this partner may see).
 */
export async function fetchPartnerReturns(requestId: string): Promise<PartnerReturnRecord[]> {
  const { data, error } = await supabase
    .from('partner_request_returns')
    .select('id, request_id, response_type, message, created_at')
    .eq('request_id', requestId)
    .order('created_at')
    .returns<PartnerReturnRecord[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Which of these Requests were returned to the partner at least once. */
export async function fetchReturnedRequestIds(requestIds: string[]): Promise<Set<string>> {
  if (requestIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('partner_request_returns')
    .select('request_id')
    .in('request_id', requestIds)
    .returns<{ request_id: string }[]>();

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.request_id));
}

const SUBMISSION_COLUMNS =
  'id, request_id, submitted_by, return_id, response_text, response_decision, response_notes, created_at, ' +
  'request_answers(request_field_id, value)';

interface SubmissionRow extends Omit<SubmissionRecord, 'answers'> {
  request_answers: SubmissionRecord['answers'] | null;
}

/**
 * Submissions of one Request, oldest first, with their answers. RLS decides whose:
 * a partner gets only their own, staff get all of them.
 */
export async function fetchSubmissions(requestId: string): Promise<SubmissionRecord[]> {
  const { data, error } = await supabase
    .from('request_submissions')
    .select(SUBMISSION_COLUMNS)
    .eq('request_id', requestId)
    .order('created_at')
    .returns<SubmissionRow[]>();

  if (error) throw new Error(error.message);
  return (data ?? []).map(({ request_answers, ...row }) => ({ ...row, answers: request_answers ?? [] }));
}

// ---- Staff -----------------------------------------------------------------

interface RequestRow {
  id: string;
  organization_id: string;
  product_id: string | null;
  resource_id: string | null;
  type: InternalRequest['type'];
  status: InternalRequest['status'];
  next_actor: InternalRequest['nextActor'];
  title: string;
  context: string | null;
  requested_action: string;
  estimated_effort_minutes: number;
  assignee_profile_id: string;
  due_at: string | null;
  created_by: string;
  created_at: string;
  published_at: string | null;
  updated_at: string;
  revision: number;
  request_internal_details: InternalDetailsRow | InternalDetailsRow[] | null;
}

interface InternalDetailsRow {
  completion_criteria: string;
  internal_owner_profile_id: string | null;
  priority: Priority;
}

const REQUEST_COLUMNS =
  'id, organization_id, product_id, resource_id, type, status, next_actor, title, context, requested_action, ' +
  'estimated_effort_minutes, assignee_profile_id, due_at, created_by, created_at, published_at, updated_at, revision, ' +
  'request_internal_details(completion_criteria, internal_owner_profile_id, priority)';

function toInternal(row: RequestRow): InternalRequest {
  const details = Array.isArray(row.request_internal_details)
    ? (row.request_internal_details[0] ?? null)
    : row.request_internal_details;
  return {
    id: row.id,
    organizationId: row.organization_id,
    productId: row.product_id,
    resourceId: row.resource_id,
    type: row.type,
    status: row.status,
    nextActor: row.next_actor,
    title: row.title,
    context: row.context,
    requestedAction: row.requested_action,
    estimatedEffortMinutes: row.estimated_effort_minutes,
    assigneeProfileId: row.assignee_profile_id,
    dueAt: row.due_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    internal: details
      ? {
          completionCriteria: details.completion_criteria,
          internalOwnerProfileId: details.internal_owner_profile_id,
          priority: details.priority,
        }
      : null,
  };
}

export async function fetchOrganizationRequests(organizationId: string): Promise<InternalRequest[]> {
  const { data, error } = await supabase
    .from('requests')
    .select(REQUEST_COLUMNS)
    .eq('organization_id', organizationId)
    .returns<RequestRow[]>();

  if (error) throw new Error(error.message);
  return (data ?? []).map(toInternal);
}

export async function fetchInternalRequest(id: string): Promise<InternalRequest | null> {
  const { data, error } = await supabase
    .from('requests')
    .select(REQUEST_COLUMNS)
    .eq('id', id)
    .maybeSingle<RequestRow>();

  if (error) throw new Error(error.message);
  return data ? toInternal(data) : null;
}

/** The current aggregate revision alone, to confirm a multi-query read is one version. */
export async function fetchRequestRevision(id: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('requests')
    .select('revision')
    .eq('id', id)
    .maybeSingle<{ revision: number }>();

  if (error) throw new Error(error.message);
  return data?.revision ?? null;
}

export async function fetchInternalNotes(requestId: string): Promise<InternalNote[]> {
  const { data, error } = await supabase
    .from('request_internal_notes')
    .select('id, author_profile_id, content, created_at')
    .eq('request_id', requestId)
    .order('created_at')
    .returns<{ id: string; author_profile_id: string; content: string; created_at: string }[]>();

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    authorProfileId: row.author_profile_id,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function fetchRequestActivity(requestId: string): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from('activity_events')
    .select('id, event_type, actor_profile_id, created_at')
    .eq('object_type', 'request')
    .eq('object_id', requestId)
    .order('created_at', { ascending: false })
    .returns<{ id: string; event_type: string; actor_profile_id: string | null; created_at: string }[]>();

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    actorProfileId: row.actor_profile_id,
    createdAt: row.created_at,
  }));
}

/** Returns of one Request with who returned it, oldest first. Staff only (RLS). */
export async function fetchRequestReturns(requestId: string): Promise<InternalReturnRecord[]> {
  const { data, error } = await supabase
    .from('request_returns')
    .select('id, request_id, response_type, message, created_by, created_at')
    .eq('request_id', requestId)
    .order('created_at')
    .returns<InternalReturnRecord[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Sollelio staff, for the internal-owner choice. Staff may read every profile. */
export async function fetchStaffProfiles(): Promise<{ id: string; displayName: string }[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('is_sollelio_staff', true)
    .order('display_name')
    .returns<{ id: string; display_name: string }[]>();

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, displayName: row.display_name }));
}
