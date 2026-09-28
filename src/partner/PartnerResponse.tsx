/**
 * The part of a Request the partner acts on: the round they answer now
 * (03_UX_SPEC.md §5–§6, 05_DATA_MODEL_AND_API.md §13).
 *
 * - Initial round: the controls of the published fields.
 * - Returned round: only the return's question — one text answer, or a new
 *   Aprovar / Precisa de alterações decision. The original form is never offered again.
 *
 * Answers stay in component state until the server confirms. Sending locks the form;
 * an uncertain outcome offers only to repeat the same attempt.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../platform/ui/Icon';
import {
  EMPTY_RETURNED_DRAFT,
  initialBody,
  returnedBody,
  serverAnswerErrors,
  validateInitial,
  validateReturned,
  type AnswerDraft,
  type ReturnedDraft,
} from '../modules/requests/answers';
import { submissionErrorMessage, type SubmitResult } from '../modules/requests/commands';
import { LIMITS, type CurrentRound, type PartnerRequestRecord, type RequestFieldRecord } from '../modules/requests/types';
import { ApprovalChoice } from './ApprovalChoice';
import { InitialResponseFields } from './InitialResponseFields';
import { SessionEndedNotice } from './SessionEndedNotice';
import { useSubmission } from './useSubmission';

export function PartnerResponse({
  request,
  fields,
  round,
  onDone,
  onChanged,
}: {
  request: PartnerRequestRecord;
  fields: RequestFieldRecord[];
  round: CurrentRound;
  onDone: (result: SubmitResult) => void;
  onChanged: () => void;
}) {
  const expectedReturnId = round.kind === 'returned' ? round.ret.id : null;
  const { phase, submit, retry, locked } = useSubmission(request.id, expectedReturnId);
  const [draft, setDraft] = useState<AnswerDraft>({});
  const [returned, setReturned] = useState<ReturnedDraft>(EMPTY_RETURNED_DRAFT);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  // Settled outcomes are handed to the page, which re-reads the Request from the server.
  const handlers = useRef({ onDone, onChanged });
  handlers.current = { onDone, onChanged };
  useEffect(() => {
    if (phase.kind === 'done') handlers.current.onDone(phase.result);
    else if (phase.kind === 'changed' || phase.kind === 'gone') handlers.current.onChanged();
  }, [phase]);

  const clearError = (key: string) =>
    setLocalErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });

  const serverErrors = phase.kind === 'rejected' ? serverAnswerErrors(phase.fieldErrors) : {};
  const errors = { ...serverErrors, ...localErrors };

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const found = round.kind === 'initial' ? validateInitial(fields, draft) : validateReturned(round.ret.response_type, returned);
    setLocalErrors(found);
    if (Object.keys(found).length > 0) return;
    submit(round.kind === 'initial' ? initialBody(fields, draft) : returnedBody(round.ret.response_type, returned));
  }

  const isApproval = round.kind === 'initial' ? request.type === 'approval' : round.ret.response_type === 'approval';
  const label = phase.kind === 'sending' ? 'A enviar…' : isApproval ? 'Enviar decisão' : 'Enviar resposta';
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form className="respond" onSubmit={onSubmit} noValidate aria-labelledby={`respond-${request.id}`}>
      {round.kind === 'returned' ? (
        <div className="followup">
          <span className="followup__title" id={`respond-${request.id}`}>
            <Icon name="alert" size={18} />
            Falta só isto
          </span>
          <p className="followup__message">{round.ret.message}</p>
        </div>
      ) : (
        <span className="dt__label" id={`respond-${request.id}`}>
          A sua resposta
        </span>
      )}

      <fieldset className="form-lock" disabled={locked}>
        {round.kind === 'initial' && fields.length === 0 ? (
          <p className="respond__note">Confirme quando tiver feito o que pedimos.</p>
        ) : round.kind === 'initial' ? (
          <InitialResponseFields
            fields={fields}
            draft={draft}
            onChange={(fieldId, value) => {
              setDraft((d) => ({ ...d, [fieldId]: value }));
              clearError(fieldId);
            }}
            errors={errors}
            idPrefix={`answer-${request.id}`}
          />
        ) : round.ret.response_type === 'text' ? (
          <div className="field answer">
            <label htmlFor={`reply-${round.ret.id}`}>A sua resposta</label>
            <textarea
              id={`reply-${round.ret.id}`}
              value={returned.text}
              maxLength={LIMITS.answer}
              onChange={(e) => {
                setReturned((r) => ({ ...r, text: e.target.value }));
                clearError('text');
              }}
              {...(errors.text ? { 'aria-invalid': true, 'aria-describedby': `reply-${round.ret.id}-error` } : {})}
            />
            {errors.text ? (
              <span className="field__error" id={`reply-${round.ret.id}-error`}>
                {errors.text}
              </span>
            ) : null}
          </div>
        ) : (
          <ApprovalChoice
            name={`decision-${round.ret.id}`}
            legend="A sua decisão"
            decision={returned.decision}
            notes={returned.notes}
            onDecision={(decision) => {
              setReturned((r) => ({ ...r, decision }));
              clearError('decision');
            }}
            onNotes={(notes) => setReturned((r) => ({ ...r, notes }))}
            decisionError={errors.decision}
            notesError={errors.notes}
          />
        )}
      </fieldset>

      {phase.kind === 'rejected' || (hasErrors && phase.kind !== 'uncertain') ? (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" size={20} />
          <p>{phase.kind === 'rejected' && !phase.fieldErrors.length ? submissionErrorMessage(phase.error) : 'Falta completar ou corrigir algumas respostas.'}</p>
        </div>
      ) : null}

      {phase.kind === 'uncertain' ? (
        <div className="banner banner--warn" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <span className="banner__title">Não sabemos se a sua resposta chegou.</span>
            <p>
              A ligação falhou antes de termos confirmação. As suas respostas continuam aqui. Tentar de novo envia
              exactamente a mesma resposta — nunca conta duas vezes.
            </p>
            <p style={{ marginTop: 8 }}>
              <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>
                Tentar enviar de novo
              </button>
            </p>
          </div>
        </div>
      ) : null}

      {phase.kind === 'session' ? <SessionEndedNotice /> : null}

      {phase.kind !== 'uncertain' && phase.kind !== 'session' ? (
        <div className="respond__actions">
          <button type="submit" className="btn btn--primary btn--block" disabled={locked}>
            {label}
          </button>
          <p className="respond__note">Depois de enviar, fica com a Sollelio. Não precisa de fazer mais nada.</p>
        </div>
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {phase.kind === 'sending' ? 'A enviar a sua resposta.' : ''}
      </p>
    </form>
  );
}
