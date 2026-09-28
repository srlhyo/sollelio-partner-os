import { describe, expect, it } from 'vitest';
import { currentRound } from './rounds';
import type { PartnerReturnRecord, SubmissionRecord } from './types';

const ret = (id: string, at: string): PartnerReturnRecord => ({
  id, request_id: 'r1', response_type: 'text', message: `m-${id}`, created_at: at,
});
const sub = (id: string, returnId: string | null): SubmissionRecord => ({
  id, request_id: 'r1', submitted_by: 'p', return_id: returnId, response_text: null, response_decision: null,
  response_notes: null, created_at: '2026-09-28T10:00:00Z', answers: [],
});

describe('currentRound', () => {
  it('is the initial round while nothing was returned', () => {
    expect(currentRound([], [])).toEqual({ kind: 'initial' });
  });

  it('is the return not answered yet — never the original form again', () => {
    const r1 = ret('a', '2026-09-28T10:00:00Z');
    const r2 = ret('b', '2026-09-28T11:00:00Z');
    expect(currentRound([r1], [sub('s1', null)])).toEqual({ kind: 'returned', ret: r1 });
    expect(currentRound([r1, r2], [sub('s1', null), sub('s2', 'a')])).toEqual({ kind: 'returned', ret: r2 });
  });
});
