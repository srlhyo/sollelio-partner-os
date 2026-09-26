/**
 * Ordering rules (06_BUILD_PLAN.md Slice 2, C2).
 *
 * Partner Home: earliest deadline first, no deadline last, then newest publication.
 * Internal queue: groups Sollelio → partner → drafts → closed; inside a group,
 * earliest deadline first (none last), then most recently updated.
 */
import type { InternalRequest, PartnerRequestRecord, RequestStatus } from './types';

function byDueThen(aDue: string | null, bDue: string | null): number {
  if (aDue && bDue) return new Date(aDue).getTime() - new Date(bDue).getTime();
  if (aDue) return -1;
  if (bDue) return 1;
  return 0;
}

export function comparePartnerAttention(a: PartnerRequestRecord, b: PartnerRequestRecord): number {
  return (
    byDueThen(a.due_at, b.due_at) ||
    new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime()
  );
}

export type QueueGroup = 'sollelio' | 'partner' | 'draft' | 'closed';

export const QUEUE_GROUPS: QueueGroup[] = ['sollelio', 'partner', 'draft', 'closed'];

export const QUEUE_GROUP_LABELS: Record<QueueGroup, string> = {
  sollelio: 'Esperam pela Sollelio',
  partner: 'Esperam pela parceira',
  draft: 'Rascunhos',
  closed: 'Concluídos ou cancelados',
};

export function queueGroupOf(status: RequestStatus): QueueGroup {
  switch (status) {
    case 'needs_sollelio':
      return 'sollelio';
    case 'needs_partner':
      return 'partner';
    case 'draft':
      return 'draft';
    default:
      return 'closed';
  }
}

export function compareQueue(a: InternalRequest, b: InternalRequest): number {
  const group = QUEUE_GROUPS.indexOf(queueGroupOf(a.status)) - QUEUE_GROUPS.indexOf(queueGroupOf(b.status));
  return (
    group ||
    byDueThen(a.dueAt, b.dueAt) ||
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}
