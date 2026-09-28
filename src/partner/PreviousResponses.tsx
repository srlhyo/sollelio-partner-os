/**
 * What the partner already sent, read-only, oldest first (03_UX_SPEC.md §5).
 *
 * Each returned round shows what Sollelio asked and what the partner answered. It
 * reads only the partner's own submissions (RLS) and the partner-facing returns; the
 * return still waiting for an answer is shown by the follow-up, not here.
 */
import { formatAnswer } from '../modules/requests/answers';
import { formatDateTime } from '../modules/requests/format';
import {
  APPROVAL_DECISION_LABELS,
  type PartnerReturnRecord,
  type RequestFieldRecord,
  type SubmissionRecord,
} from '../modules/requests/types';

export function PreviousResponses({
  title,
  submissions,
  returns,
  fields,
}: {
  title: string;
  submissions: SubmissionRecord[];
  returns: PartnerReturnRecord[];
  fields: RequestFieldRecord[];
}) {
  if (submissions.length === 0) return null;
  const byId = new Map(fields.map((field) => [field.id, field]));
  const returnsById = new Map(returns.map((ret) => [ret.id, ret]));
  const ordered = [...fields].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <section className="dt__block prev" aria-label={title}>
      <span className="dt__label">{title}</span>
      <ol className="prev__list">
        {submissions.map((submission) => {
          const ret = submission.return_id ? returnsById.get(submission.return_id) : undefined;
          return (
            <li key={submission.id} className="prev__item">
              {ret ? (
                <div className="prev__asked">
                  <span className="prev__meta">A Sollelio pediu · {formatDateTime(ret.created_at)}</span>
                  <p className="dt__text">{ret.message}</p>
                </div>
              ) : null}
              <span className="prev__meta">Enviou · {formatDateTime(submission.created_at)}</span>
              {submission.return_id === null ? (
                <dl className="prev__answers">
                  {ordered.map((field) => {
                    const answer = submission.answers.find((a) => a.request_field_id === field.id);
                    if (!answer && !field.required) return null;
                    return (
                      <div key={field.id}>
                        <dt>{field.label}</dt>
                        <dd>{answer ? formatAnswer(byId.get(field.id), answer.value) : 'Sem resposta'}</dd>
                      </div>
                    );
                  })}
                  {submission.answers.length === 0 && ordered.length === 0 ? (
                    <div>
                      <dd>Marcou como feito.</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <div className="prev__answers">
                  {submission.response_text ? <p className="dt__text">{submission.response_text}</p> : null}
                  {submission.response_decision ? (
                    <p className="dt__text">
                      <strong>{APPROVAL_DECISION_LABELS[submission.response_decision]}</strong>
                      {submission.response_notes ? ` — ${submission.response_notes}` : ''}
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
