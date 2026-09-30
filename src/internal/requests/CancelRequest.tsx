/**
 * "Cancelar pedido" (03_UX_SPEC.md §15, C4): a secondary, destructive action that is
 * never one click. It opens a small panel that says the cancellation is final, asks
 * for the reason (required; the partner reads it when the Request was published) and
 * needs an explicit confirmation. It sends the revision on screen.
 *
 * No key: an uncertain outcome is settled by reading the Request again, as for
 * complete (05_DATA_MODEL_AND_API.md §13, C4).
 */
import { useState, type FormEvent } from 'react';
import { Icon } from '../../platform/ui/Icon';
import { CommandError, cancelErrorMessage, cancelRequest } from '../../modules/requests/commands';
import { LIMITS, isCancellable, type RequestStatus } from '../../modules/requests/types';
import { SessionExpiredNotice } from './SessionExpiredNotice';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string; reload: boolean }
  | { kind: 'session' };

export function CancelRequest({
  requestId,
  status,
  revision,
  assigneeName,
  disabled = false,
  onDone,
}: {
  requestId: string;
  status: RequestStatus;
  /** The revision on screen; null while unknown (e.g. an unsettled save). */
  revision: number | null;
  assigneeName: string;
  /** True while something else on the page must settle first (e.g. a draft save). */
  disabled?: boolean;
  /** Called with a flash message; the page then reads the Request again. */
  onDone: (flash: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const busy = outcome.kind === 'busy';

  if (!isCancellable(status)) return null;
  const published = status !== 'draft';

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    if (busy || revision === null) return;
    const text = reason.trim();
    if (!text) return setError('Escreva o motivo do cancelamento.');
    if (text.length > LIMITS.cancellationReason) return setError(`No máximo ${LIMITS.cancellationReason} caracteres.`);
    setError(null);
    setOutcome({ kind: 'busy' });
    try {
      await cancelRequest(requestId, revision, text);
      onDone('Pedido cancelado.');
    } catch (cause) {
      if (cause instanceof CommandError && cause.ambiguous) {
        return onDone('Não tivemos confirmação: mostramos o estado actual do pedido.');
      }
      if (cause instanceof CommandError && cause.code === 'unauthenticated') return setOutcome({ kind: 'session' });
      const reload = cause instanceof CommandError && (cause.code === 'invalid_state' || cause.code === 'stale_revision');
      setOutcome({ kind: 'error', message: cancelErrorMessage(cause), reload });
    }
  }

  return (
    <section className="panel" aria-labelledby={`cancel-${requestId}`}>
      <div className="panel__head">
        <h2 id={`cancel-${requestId}`}>Cancelar</h2>
      </div>
      <div className="panel__body">
        {!open ? (
          <div className="actions-row">
            <button type="button" className="btn btn--danger-quiet" onClick={() => setOpen(true)} disabled={disabled}>
              Cancelar pedido
            </button>
          </div>
        ) : (
          <form className="confirm confirm--danger" onSubmit={onConfirm} noValidate aria-labelledby={`cancel-title-${requestId}`}>
            <span className="banner__title" id={`cancel-title-${requestId}`}>
              Cancelar este pedido?
            </span>
            <p className="sub">
              O cancelamento é definitivo: o pedido não pode ser reaberto nem editado.{' '}
              {published
                ? `${assigneeName} deixa de o ver em “Precisa de si” e lê o motivo que escrever aqui.`
                : 'Este rascunho nunca foi publicado; a parceira não o vê.'}
            </p>
            <fieldset className="form-lock" disabled={busy}>
              <div className="field">
                <label htmlFor={`cancel-reason-${requestId}`}>Motivo do cancelamento</label>
                <textarea
                  id={`cancel-reason-${requestId}`}
                  value={reason}
                  maxLength={LIMITS.cancellationReason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setError(null);
                  }}
                  {...(error ? { 'aria-invalid': true, 'aria-describedby': `cancel-reason-${requestId}-error` } : {})}
                />
                {error ? (
                  <span className="field__error" id={`cancel-reason-${requestId}-error`}>
                    {error}
                  </span>
                ) : null}
              </div>
            </fieldset>

            {outcome.kind === 'session' ? <SessionExpiredNotice unsavedWork={reason.trim() !== ''} /> : null}
            {outcome.kind === 'error' ? (
              <div className="banner banner--error" role="alert">
                <Icon name="alert" size={20} />
                <div>
                  <p>{outcome.message}</p>
                  {outcome.reload ? (
                    <p style={{ marginTop: 8 }}>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => onDone('')}>
                        Recarregar o pedido
                      </button>
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="actions-row">
              <button type="submit" className="btn btn--danger" disabled={busy || revision === null}>
                {busy ? 'A cancelar…' : 'Confirmar cancelamento'}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setOutcome({ kind: 'idle' });
                  setError(null);
                }}
              >
                Manter pedido
              </button>
            </div>
          </form>
        )}
        <p className="visually-hidden" role="status" aria-live="polite">
          {busy ? 'A cancelar o pedido.' : ''}
        </p>
      </div>
    </section>
  );
}
