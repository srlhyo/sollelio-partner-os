/**
 * What Sollelio can do while a Request waits on it (03_UX_SPEC.md §15, C3): complete
 * it, or return it to the partner with one precise new question or action.
 *
 * Both send the revision the operator is looking at. A return keeps its `return_id`
 * for the attempt, so an uncertain outcome is settled by repeating it (the server
 * replays); an uncertain completion is settled by reading the Request again.
 */
import { useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../platform/ui/Icon';
import {
  CommandError,
  completeRequest,
  lifecycleErrorMessage,
  returnRequestToPartner,
} from '../../modules/requests/commands';
import { LIMITS, type InternalRequest, type ReturnResponseType } from '../../modules/requests/types';
import { SessionExpiredNotice } from './SessionExpiredNotice';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string; reload: boolean }
  | { kind: 'uncertain-return' }
  | { kind: 'session' };

export function LifecycleActions({
  request,
  assigneeName,
  onDone,
}: {
  request: InternalRequest;
  assigneeName: string;
  onDone: (flash: string) => void;
}) {
  const [open, setOpen] = useState<'none' | 'complete' | 'return'>('none');
  const [message, setMessage] = useState('');
  const [responseType, setResponseType] = useState<ReturnResponseType | null>(null);
  const [errors, setErrors] = useState<{ message?: string; responseType?: string }>({});
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const attempt = useRef<{ returnId: string; message: string; responseType: ReturnResponseType } | null>(null);
  const busy = outcome.kind === 'busy';

  function fail(error: unknown) {
    if (error instanceof CommandError && error.code === 'unauthenticated') return setOutcome({ kind: 'session' });
    const reload = error instanceof CommandError && (error.code === 'invalid_state' || error.code === 'stale_revision');
    setOutcome({ kind: 'error', message: lifecycleErrorMessage(error), reload });
  }

  async function sendReturn(current: { returnId: string; message: string; responseType: ReturnResponseType }) {
    setOutcome({ kind: 'busy' });
    try {
      await returnRequestToPartner(request.id, request.revision, current.returnId, current.responseType, current.message);
      attempt.current = null;
      onDone(`Devolvido a ${assigneeName}. Volta a aparecer em “Precisa de si”.`);
    } catch (error) {
      if (error instanceof CommandError && error.ambiguous) return setOutcome({ kind: 'uncertain-return' });
      attempt.current = null;
      fail(error);
    }
  }

  function onReturn(event: FormEvent) {
    event.preventDefault();
    if (busy || attempt.current) return;
    const found: typeof errors = {};
    const text = message.trim();
    if (!text) found.message = 'Escreva o que falta, para a parceira ler.';
    else if (text.length > LIMITS.returnMessage) found.message = `No máximo ${LIMITS.returnMessage} caracteres.`;
    if (!responseType) found.responseType = 'Escolha o tipo de resposta: texto ou aprovação.';
    setErrors(found);
    if (Object.keys(found).length > 0 || !responseType) return;
    attempt.current = { returnId: crypto.randomUUID(), message: text, responseType };
    void sendReturn(attempt.current);
  }

  async function onComplete() {
    if (busy) return;
    setOutcome({ kind: 'busy' });
    try {
      await completeRequest(request.id, request.revision);
      onDone('Pedido concluído.');
    } catch (error) {
      // An uncertain completion is settled by reading the Request again.
      if (error instanceof CommandError && error.ambiguous) return onDone('Não tivemos confirmação: mostramos o estado actual do pedido.');
      fail(error);
    }
  }

  return (
    <section className="panel" aria-labelledby="next-step">
      <div className="panel__head">
        <h2 id="next-step">Próximo passo</h2>
      </div>
      <div className="panel__body">
        <p className="sub">
          {assigneeName} já respondeu. Conclua quando o critério de conclusão estiver cumprido, ou devolva com uma
          pergunta ou acção precisa.
        </p>

        {outcome.kind === 'session' ? <SessionExpiredNotice unsavedWork={open === 'return'} /> : null}
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

        {open === 'none' ? (
          <div className="actions-row">
            <button type="button" className="btn btn--primary" onClick={() => setOpen('complete')}>
              <Icon name="check" size={18} />
              Concluir
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setOpen('return')}>
              Devolver à parceira
            </button>
          </div>
        ) : null}

        {open === 'complete' ? (
          <div className="confirm" role="group" aria-labelledby="complete-title">
            <span className="banner__title" id="complete-title">
              Concluir este pedido?
            </span>
            <p className="sub">{assigneeName} vê-o como concluído. Nada é apagado.</p>
            <div className="actions-row">
              <button type="button" className="btn btn--primary" onClick={() => void onComplete()} disabled={busy}>
                {busy ? 'A concluir…' : 'Confirmar conclusão'}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setOpen('none')} disabled={busy}>
                Manter aberto
              </button>
            </div>
          </div>
        ) : null}

        {open === 'return' ? (
          <form className="confirm" onSubmit={onReturn} noValidate aria-labelledby="return-title">
            <span className="banner__title" id="return-title">
              Devolver à parceira
            </span>
            <fieldset className="form-lock" disabled={busy || outcome.kind === 'uncertain-return'}>
              <div className="field">
                <label htmlFor="return-message">O que ainda falta ({assigneeName} lê isto)</label>
                <span className="field__hint" id="return-message-hint">
                  Peça a peça mais pequena de informação que falta. Nunca “pode explicar melhor?”.
                </span>
                <textarea
                  id="return-message"
                  value={message}
                  maxLength={LIMITS.returnMessage}
                  onChange={(e) => setMessage(e.target.value)}
                  aria-describedby={errors.message ? 'return-message-hint return-message-error' : 'return-message-hint'}
                  {...(errors.message ? { 'aria-invalid': true } : {})}
                />
                {errors.message ? (
                  <span className="field__error" id="return-message-error">
                    {errors.message}
                  </span>
                ) : null}
              </div>
              <fieldset className="answer__set" aria-describedby={errors.responseType ? 'return-type-error' : undefined}>
                <legend className="answer__label">O que a parceira responde</legend>
                <div className="choices">
                  <label>
                    <input type="radio" name="return-type" checked={responseType === 'text'} onChange={() => setResponseType('text')} />
                    Texto
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="return-type"
                      checked={responseType === 'approval'}
                      onChange={() => setResponseType('approval')}
                    />
                    Aprovação
                  </label>
                </div>
                {errors.responseType ? (
                  <span className="field__error" id="return-type-error">
                    {errors.responseType}
                  </span>
                ) : null}
              </fieldset>
            </fieldset>

            {outcome.kind === 'uncertain-return' ? (
              <div className="banner banner--warn" role="alert">
                <Icon name="alert" size={20} />
                <div>
                  <span className="banner__title">Não sabemos se a devolução chegou.</span>
                  <p>Tentar de novo repete exactamente a mesma devolução; nunca a cria duas vezes.</p>
                  <p style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => attempt.current && void sendReturn(attempt.current)}
                    >
                      Verificar e repetir
                    </button>
                  </p>
                </div>
              </div>
            ) : (
              <div className="actions-row">
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  {busy ? 'A devolver…' : `Devolver a ${assigneeName}`}
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setOpen('none')} disabled={busy}>
                  Não devolver
                </button>
              </div>
            )}
          </form>
        ) : null}
        <p className="visually-hidden" role="status" aria-live="polite">
          {busy ? 'A enviar.' : ''}
        </p>
      </div>
    </section>
  );
}
