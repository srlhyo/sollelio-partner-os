/**
 * Which round the partner answers now (05_DATA_MODEL_AND_API.md §4, "Rounds").
 *
 * Mirrors the server's rule: the current round of a Request waiting on the partner
 * is its return that has no submission yet, or the initial round when there is none.
 * The server remains the authority — a stale guess is answered with `stale_round`.
 */
import type { CurrentRound, PartnerReturnRecord, SubmissionRecord } from './types';

export function currentRound(returns: PartnerReturnRecord[], submissions: SubmissionRecord[]): CurrentRound {
  const answered = new Set(submissions.map((s) => s.return_id).filter((id): id is string => id !== null));
  const open = [...returns].reverse().find((ret) => !answered.has(ret.id)) ?? returns[returns.length - 1];
  return open ? { kind: 'returned', ret: open } : { kind: 'initial' };
}
