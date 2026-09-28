/**
 * Aprovar / Precisa de alterações, with optional notes revealed only after
 * "Precisa de alterações" (03_UX_SPEC.md §6). The one approval control, used by an
 * approval Request and by a returned approval round alike.
 */
import type { ApprovalDecision } from '../modules/requests/types';
import { LIMITS } from '../modules/requests/types';

export function ApprovalChoice({
  name,
  legend,
  decision,
  notes,
  onDecision,
  onNotes,
  disabled,
  decisionError,
  notesError,
}: {
  name: string;
  legend: string;
  decision: ApprovalDecision | null;
  notes: string;
  onDecision: (decision: ApprovalDecision) => void;
  onNotes: (notes: string) => void;
  disabled?: boolean | undefined;
  decisionError?: string | undefined;
  notesError?: string | undefined;
}) {
  const errorId = `${name}-error`;
  return (
    <div className="answer">
      <fieldset className="answer__set" aria-describedby={decisionError ? errorId : undefined}>
        <legend className="answer__label">{legend}</legend>
        <div className="choices choices--decision">
          <label>
            <input
              type="radio"
              name={name}
              value="approve"
              checked={decision === 'approve'}
              onChange={() => onDecision('approve')}
              disabled={disabled}
            />
            Aprovar
          </label>
          <label>
            <input
              type="radio"
              name={name}
              value="needs_changes"
              checked={decision === 'needs_changes'}
              onChange={() => onDecision('needs_changes')}
              disabled={disabled}
            />
            Precisa de alterações
          </label>
        </div>
        {decisionError ? (
          <span className="field__error" id={errorId}>
            {decisionError}
          </span>
        ) : null}
      </fieldset>

      {decision === 'needs_changes' ? (
        <div className="field">
          <label htmlFor={`${name}-notes`}>
            O que deve mudar?<span className="field__optional"> (opcional)</span>
          </label>
          <textarea
            id={`${name}-notes`}
            value={notes}
            maxLength={LIMITS.answer}
            onChange={(e) => onNotes(e.target.value)}
            disabled={disabled}
            {...(notesError ? { 'aria-invalid': true, 'aria-describedby': `${name}-notes-error` } : {})}
          />
          {notesError ? (
            <span className="field__error" id={`${name}-notes-error`}>
              {notesError}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
