/**
 * One partner submission attempt at a time (03_UX_SPEC.md §5, 05_DATA_MODEL_AND_API.md §13).
 *
 * - Each attempt gets its own `submission_id`, generated once.
 * - While it is in flight nothing else can start.
 * - If the outcome is uncertain (connection failed, 5xx, a 2xx without the envelope)
 *   the attempt is kept exactly as sent and the only way on is to repeat it: same id,
 *   same round, same body. The server replays it if it had already landed, so one
 *   click can never count twice.
 * - A definitive rejection wrote nothing, so the next attempt is a new one.
 *
 * The attempt lives in a ref, in memory only: never in browser storage (04 §17).
 */
import { useCallback, useRef, useState } from 'react';
import { CommandError, submitRequest, type FieldErrorItem, type SubmissionBody, type SubmitResult } from '../modules/requests/commands';

export type SubmissionPhase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'rejected'; error: CommandError | null; fieldErrors: FieldErrorItem[] }
  | { kind: 'uncertain' }
  | { kind: 'changed' }
  | { kind: 'session' }
  | { kind: 'gone' }
  | { kind: 'done'; result: SubmitResult };

interface Attempt {
  submissionId: string;
  expectedReturnId: string | null;
  body: SubmissionBody;
}

export function useSubmission(requestId: string, expectedReturnId: string | null) {
  const [phase, setPhase] = useState<SubmissionPhase>({ kind: 'idle' });
  const attempt = useRef<Attempt | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (current: Attempt) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPhase({ kind: 'sending' });
      try {
        const result = await submitRequest(requestId, current.submissionId, current.expectedReturnId, current.body);
        attempt.current = null;
        setPhase({ kind: 'done', result });
      } catch (error) {
        if (error instanceof CommandError && error.ambiguous) {
          setPhase({ kind: 'uncertain' }); // keep `attempt.current` exactly as sent
        } else {
          attempt.current = null;
          if (error instanceof CommandError && error.code === 'unauthenticated') setPhase({ kind: 'session' });
          else if (error instanceof CommandError && (error.code === 'stale_round' || error.code === 'invalid_state' ||
                   error.code === 'idempotency_conflict')) setPhase({ kind: 'changed' });
          else if (error instanceof CommandError && (error.code === 'not_found' || error.code === 'no_profile')) setPhase({ kind: 'gone' });
          else setPhase({
            kind: 'rejected',
            error: error instanceof CommandError ? error : null,
            fieldErrors: error instanceof CommandError ? error.fieldErrors : [],
          });
        }
      } finally {
        inFlight.current = false;
      }
    },
    [requestId],
  );

  /** Starts a new attempt with this body. Refused while one is in flight or unsettled. */
  const submit = useCallback(
    (body: SubmissionBody) => {
      if (inFlight.current || attempt.current) return;
      attempt.current = { submissionId: crypto.randomUUID(), expectedReturnId, body };
      void run(attempt.current);
    },
    [expectedReturnId, run],
  );

  /** Repeats the unsettled attempt exactly as it was sent. */
  const retry = useCallback(() => {
    if (attempt.current) void run(attempt.current);
  }, [run]);

  return {
    phase,
    submit,
    retry,
    /** True while the answers must not change: sending, or an attempt not yet settled. */
    locked: phase.kind === 'sending' || phase.kind === 'uncertain',
  };
}
