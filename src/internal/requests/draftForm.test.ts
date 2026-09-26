/**
 * Recognising our own write after a lost response. The internal owner left blank is
 * filled by the server with the attempt's authenticated actor — so that actor, and
 * never the owner a later read finds, is what our write must have produced.
 */
import { describe, expect, it } from 'vitest';
import { aggregateMatches, initialState, toPayload } from './draftForm';
import type { EditableAggregate } from './draftForm';

const stored = (owner: string | null, criteria: string | null = 'Feito.'): EditableAggregate => ({
  request: {
    id: 'r1', organizationId: 'o1', productId: null, resourceId: null, type: 'task', status: 'draft', nextActor: 'none',
    title: 'Título', context: null, requestedAction: 'Faça isto.', estimatedEffortMinutes: 3, assigneeProfileId: 'p-nadia',
    dueAt: null, createdBy: 's-helio', createdAt: '2026-09-25T10:00:00Z', publishedAt: null,
    updatedAt: '2026-09-25T10:00:00Z', revision: 6,
    internal: criteria ? { completionCriteria: criteria, internalOwnerProfileId: owner, priority: 'normal' } : null,
  },
  fields: [],
});

/** What the editor sent: same content, criterion filled, owner left as "Eu" (blank). */
const sentWithDefaultOwner = () => {
  const form = initialState(stored(null, null));
  return toPayload({ ...form, criteria: 'Feito.', ownerId: '' }, null);
};

describe('aggregateMatches and the default internal owner', () => {
  it('recognises our own write: the server stored the attempt’s actor as owner', () => {
    expect(aggregateMatches(stored('s-helio'), sentWithDefaultOwner(), 's-helio')).toBe(true);
  });

  it('a concurrent change to the owner alone is not our write', () => {
    // Everything else identical; another session set a different owner.
    expect(aggregateMatches(stored('s-other'), sentWithDefaultOwner(), 's-helio')).toBe(false);
  });

  it('never adopts the owner found by the later read as the expected one', () => {
    // Whatever owner is stored, it must equal the attempt's actor to match.
    for (const owner of ['s-other', 's-third']) {
      expect(aggregateMatches(stored(owner), sentWithDefaultOwner(), 's-helio')).toBe(false);
    }
  });

  it('without a known actor a default-owner write cannot be confirmed', () => {
    expect(aggregateMatches(stored('s-helio'), sentWithDefaultOwner(), null)).toBe(false);
  });

  it('an explicit owner is compared as sent, whoever the actor was', () => {
    const form = initialState(stored(null, null));
    const sent = toPayload({ ...form, criteria: 'Feito.', ownerId: 's-other' }, null);
    expect(aggregateMatches(stored('s-other'), sent, 's-helio')).toBe(true);
    expect(aggregateMatches(stored('s-helio'), sent, 's-helio')).toBe(false);
  });

  it('with no criterion there is no internal row and no owner to fill', () => {
    const form = initialState(stored(null, null));
    expect(aggregateMatches(stored(null, null), toPayload(form, null), null)).toBe(true);
  });
});
