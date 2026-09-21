/**
 * Minimal async state for data reads.
 *
 * Deliberately small: a loading/ready/error union and a reload handle. Partner OS
 * does not need a caching layer in V0, and a generic data framework is exactly the
 * premature abstraction the architecture warns against.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; data: T };

export function useAsync<T>(
  run: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(run);
  latest.current = run;

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });

    latest
      .current()
      .then((data) => {
        if (active) setState({ status: 'ready', data });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          error: cause instanceof Error ? cause : new Error(String(cause)),
        });
      });

    return () => {
      active = false;
    };
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, reload };
}
