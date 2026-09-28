/**
 * The operational history of the response loop (03_UX_SPEC.md §15): every
 * submission and every return, oldest first, exactly as stored. Not a chat: each
 * entry is a round — what the partner sent, or what Sollelio asked next.
 */
import { formatAnswer } from '../../modules/requests/answers';
import { formatDateTime } from '../../modules/requests/format';
import {
  APPROVAL_DECISION_LABELS,
  RETURN_RESPONSE_TYPE_LABELS,
  type InternalReturnRecord,
  type RequestFieldRecord,
  type SubmissionRecord,
} from '../../modules/requests/types';

type Entry =
  | { kind: 'submission'; at: string; submission: SubmissionRecord; round: number }
  | { kind: 'return'; at: string; ret: InternalReturnRecord };

export function ResponseHistory({
  submissions,
  returns,
  fields,
  nameOf,
}: {
  submissions: SubmissionRecord[];
  returns: InternalReturnRecord[];
  fields: RequestFieldRecord[];
  nameOf: (profileId: string | null) => string;
}) {
  const ordered = [...fields].sort((a, b) => a.sort_order - b.sort_order);
  const entries: Entry[] = [
    ...submissions.map((submission, i) => ({ kind: 'submission' as const, at: submission.created_at, submission, round: i + 1 })),
    ...returns.map((ret) => ({ kind: 'return' as const, at: ret.created_at, ret })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (entries.length === 0) {
    return <p className="sub">Ainda sem resposta da parceira.</p>;
  }

  return (
    <ol className="loop">
      {entries.map((entry) =>
        entry.kind === 'return' ? (
          <li key={entry.ret.id} className="loop__item loop__item--return">
            <span className="loop__head">
              <strong>Devolvido à parceira</strong> · {formatDateTime(entry.ret.created_at)} · por {nameOf(entry.ret.created_by)} ·
              resposta: {RETURN_RESPONSE_TYPE_LABELS[entry.ret.response_type].toLowerCase()}
            </span>
            <blockquote className="loop__quote">{entry.ret.message}</blockquote>
          </li>
        ) : (
          <li key={entry.submission.id} className="loop__item">
            <span className="loop__head">
              <strong>Resposta de {nameOf(entry.submission.submitted_by)}</strong> · {formatDateTime(entry.submission.created_at)} ·
              submissão {entry.round} de {submissions.length}
            </span>
            {entry.submission.return_id === null ? (
              ordered.length === 0 ? (
                <p className="loop__text">Confirmou que fez o que foi pedido.</p>
              ) : (
                <dl className="kv">
                  {ordered.map((field) => {
                    const answer = entry.submission.answers.find((a) => a.request_field_id === field.id);
                    return (
                      <div key={field.id} className="kv__row">
                        <dt>{field.label}</dt>
                        <dd>{answer ? formatAnswer(field, answer.value) : <span className="sub">Sem resposta</span>}</dd>
                      </div>
                    );
                  })}
                </dl>
              )
            ) : entry.submission.response_decision ? (
              <p className="loop__text">
                <strong>{APPROVAL_DECISION_LABELS[entry.submission.response_decision]}</strong>
                {entry.submission.response_notes ? ` — ${entry.submission.response_notes}` : ''}
              </p>
            ) : (
              <p className="loop__text">{entry.submission.response_text}</p>
            )}
          </li>
        ),
      )}
    </ol>
  );
}
