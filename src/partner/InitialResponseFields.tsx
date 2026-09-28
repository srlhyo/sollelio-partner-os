/**
 * The response controls of a published Request: one real input per `request_fields`
 * row, in order (03_UX_SPEC.md §5). Long text → text area; single choice → one of the
 * options; boolean → Sim / Não; approval → Aprovar / Precisa de alterações.
 *
 * `preview` renders exactly the same controls, but none of them can be used: the
 * staff "Pré-visualizar como parceira" shows what the partner will receive, and
 * sends nothing (03 §16).
 */
import { isApprovalField, isApprovalNotesField, type AnswerDraft, type AnswerValue } from '../modules/requests/answers';
import type { RequestFieldRecord } from '../modules/requests/types';
import { LIMITS } from '../modules/requests/types';
import { ApprovalChoice } from './ApprovalChoice';

function Optional({ required }: { required: boolean }) {
  return required ? null : <span className="field__optional"> (opcional)</span>;
}

export function InitialResponseFields({
  fields,
  draft,
  onChange,
  errors = {},
  disabled = false,
  idPrefix,
}: {
  fields: RequestFieldRecord[];
  draft: AnswerDraft;
  onChange: (fieldId: string, value: AnswerValue) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  idPrefix: string;
}) {
  const ordered = [...fields].sort((a, b) => a.sort_order - b.sort_order);
  const notesField = ordered.find(isApprovalNotesField);

  return (
    <div className="answers">
      {ordered.map((field) => {
        if (isApprovalNotesField(field)) return null; // rendered with the decision
        const id = `${idPrefix}-${field.id}`;
        const error = errors[field.id];
        const errorId = `${id}-error`;
        const value = draft[field.id] ?? null;
        const invalid = error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {};

        if (isApprovalField(field)) {
          return (
            <ApprovalChoice
              key={field.id}
              name={id}
              legend={field.label}
              decision={value === 'approve' || value === 'needs_changes' ? value : null}
              notes={notesField ? String(draft[notesField.id] ?? '') : ''}
              onDecision={(decision) => onChange(field.id, decision)}
              onNotes={(notes) => (notesField ? onChange(notesField.id, notes) : undefined)}
              disabled={disabled}
              decisionError={error}
              notesError={notesField ? errors[notesField.id] : undefined}
            />
          );
        }

        if (field.type === 'long_text') {
          return (
            <div className="field answer" key={field.id}>
              <label htmlFor={id}>
                {field.label}
                <Optional required={field.required} />
              </label>
              {field.help_text ? <span className="field__hint">{field.help_text}</span> : null}
              <textarea
                id={id}
                value={typeof value === 'string' ? value : ''}
                maxLength={LIMITS.answer}
                onChange={(e) => onChange(field.id, e.target.value)}
                disabled={disabled}
                {...invalid}
              />
              {error ? <span className="field__error" id={errorId}>{error}</span> : null}
            </div>
          );
        }

        const choices: { label: string; value: string | boolean }[] =
          field.type === 'boolean'
            ? [{ label: 'Sim', value: true }, { label: 'Não', value: false }]
            : (field.options ?? []).map((option) => ({ label: option, value: option }));

        return (
          <fieldset className="answer answer__set" key={field.id} {...(error ? { 'aria-describedby': errorId } : {})}>
            <legend className="answer__label">
              {field.label}
              <Optional required={field.required} />
            </legend>
            {field.help_text ? <span className="field__hint">{field.help_text}</span> : null}
            <div className="choices">
              {choices.map((choice) => (
                <label key={String(choice.value)}>
                  <input
                    type="radio"
                    name={id}
                    checked={value === choice.value}
                    onChange={() => onChange(field.id, choice.value)}
                    disabled={disabled}
                  />
                  {choice.label}
                </label>
              ))}
            </div>
            {error ? <span className="field__error" id={errorId}>{error}</span> : null}
          </fieldset>
        );
      })}
    </div>
  );
}
