import { describe, expect, it } from 'vitest';
import { compareQueue, comparePartnerAttention, queueGroupOf } from './order';
import type { InternalRequest, PartnerRequestRecord } from './types';

const partner = (id: string, due: string | null, published: string): PartnerRequestRecord => ({
  id, organization_id: 'o', product_id: null, product_name: null, type: 'task', title: id, context: null,
  requested_action: 'x', estimated_effort_minutes: 1, due_at: due, partner_state: 'needs_you',
  published_at: published, completed_at: null, cancelled_at: null, related_update_id: null, resource_id: null,
});

const internal = (id: string, status: InternalRequest['status'], due: string | null, updated: string): InternalRequest => ({
  id, organizationId: 'o', productId: null, resourceId: null, type: 'task', status, nextActor: 'none', title: id,
  context: null, requestedAction: 'x', estimatedEffortMinutes: 1, assigneeProfileId: 'p', dueAt: due, createdBy: 's',
  createdAt: updated, publishedAt: null, updatedAt: updated, revision: 1, internal: null,
});

describe('partner Home ordering', () => {
  it('puts the earliest deadline first, no deadline last, then the newest publication', () => {
    const list = [
      partner('none-old', null, '2026-09-01T10:00:00Z'),
      partner('due-late', '2026-10-10T10:00:00Z', '2026-09-02T10:00:00Z'),
      partner('none-new', null, '2026-09-20T10:00:00Z'),
      partner('due-soon', '2026-10-01T10:00:00Z', '2026-09-03T10:00:00Z'),
    ].sort(comparePartnerAttention);
    expect(list.map((r) => r.id)).toEqual(['due-soon', 'due-late', 'none-new', 'none-old']);
  });
});

describe('internal queue ordering', () => {
  it('groups Sollelio, partner, drafts, closed; then deadline, then most recently updated', () => {
    const list = [
      internal('closed', 'completed', null, '2026-09-25T10:00:00Z'),
      internal('draft', 'draft', null, '2026-09-25T10:00:00Z'),
      internal('partner-nodue', 'needs_partner', null, '2026-09-25T10:00:00Z'),
      internal('partner-due', 'needs_partner', '2026-10-01T10:00:00Z', '2026-09-01T10:00:00Z'),
      internal('sollelio', 'needs_sollelio', null, '2026-09-01T10:00:00Z'),
      internal('cancelled', 'cancelled', null, '2026-09-26T10:00:00Z'),
    ].sort(compareQueue);
    expect(list.map((r) => r.id)).toEqual(['sollelio', 'partner-due', 'partner-nodue', 'draft', 'cancelled', 'closed']);
  });
  it('maps every state to exactly one group', () => {
    expect(queueGroupOf('needs_sollelio')).toBe('sollelio');
    expect(queueGroupOf('needs_partner')).toBe('partner');
    expect(queueGroupOf('draft')).toBe('draft');
    expect(queueGroupOf('completed')).toBe('closed');
    expect(queueGroupOf('cancelled')).toBe('closed');
  });
});
