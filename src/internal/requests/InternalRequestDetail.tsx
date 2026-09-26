/**
 * A published Request, internally (03_UX_SPEC.md §15). Read-only in C2: lifecycle
 * actions (return, reassign, complete, cancel) and note writing arrive later.
 *
 * Partner-facing and internal-only content are visibly separate zones; the internal
 * zone comes from records no partner projection reads.
 */
import { Link, useLocation } from 'react-router-dom';
import { useAsync } from '../../platform/useAsync';
import { Icon } from '../../platform/ui/Icon';
import { ErrorState, LoadingBlock } from '../../platform/ui/States';
import type { Organization } from '../../modules/organizations/types';
import { fetchOrganizationMembers } from '../../modules/people/queries';
import { fetchAllResources } from '../../modules/resources/queries';
import { fetchInternalNotes, fetchRequestActivity, fetchStaffProfiles } from '../../modules/requests/queries';
import { formatDateTime, formatDueLong, formatEffort } from '../../modules/requests/format';
import {
  ACTIVITY_LABELS,
  PRIORITY_LABELS,
  REQUEST_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  type InternalRequest,
  type RequestFieldRecord,
} from '../../modules/requests/types';
import { resourceHost } from '../../modules/resources/types';

export function InternalRequestDetail({
  organization,
  request,
  fields,
}: {
  organization: Organization;
  request: InternalRequest;
  fields: RequestFieldRecord[];
}) {
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash;
  const base = `/app/organizations/${organization.slug}/requests`;
  const extra = useAsync(
    () =>
      Promise.all([
        fetchOrganizationMembers(organization.id),
        fetchStaffProfiles(),
        fetchAllResources(organization.id),
        fetchInternalNotes(request.id),
        fetchRequestActivity(request.id),
      ]),
    [organization.id, request.id],
  );

  if (extra.status === 'loading') return <LoadingBlock label="A carregar o pedido" />;
  if (extra.status === 'error') return <ErrorState onRetry={extra.reload}>Não foi possível carregar este pedido.</ErrorState>;

  const [members, staff, resources, notes, activity] = extra.data;
  const nameOf = (id: string | null) =>
    (id && (members.find((m) => m.profile.id === id)?.profile.displayName ?? staff.find((s) => s.id === id)?.displayName)) || '—';
  const resource = request.resourceId ? resources.find((r) => r.id === request.resourceId) : undefined;
  const ordered = [...fields].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <>
      <div className="head-line">
        <Link className="btn btn--ghost btn--sm" to={base} style={{ marginLeft: -8 }}>
          <Icon name="back" size={18} />
          Pedidos
        </Link>
      </div>

      {flash ? (
        <div className="banner banner--ok" role="status">
          <Icon name="check" size={20} />
          <p>{flash}</p>
        </div>
      ) : null}

      <div className="page-head">
        <div className="head-line">
          <h1>{request.title}</h1>
          <span className={`chip chip--${STATUS_TONES[request.status]}`}>
            <span className="chip__dot" aria-hidden="true" />
            {STATUS_LABELS[request.status]}
          </span>
        </div>
        <p className="sub">
          {REQUEST_TYPE_LABELS[request.type]} · para <strong>{nameOf(request.assigneeProfileId)}</strong> ·{' '}
          {formatEffort(request.estimatedEffortMinutes)}
          {request.dueAt ? ` · ${formatDueLong(request.dueAt)}` : ''}
          {request.publishedAt ? ` · publicado ${formatDateTime(request.publishedAt)}` : ''}
        </p>
      </div>

      <div className="split">
        <div className="zone">
          <span className="zone__tag zone__tag--partner">
            <Icon name="eye" size={16} />
            Visível para a parceira
          </span>
          <section className="panel" aria-labelledby="as-partner">
            <div className="panel__head">
              <h2 id="as-partner">O pedido, como a parceira o lê</h2>
              <Link className="btn btn--quiet btn--sm" to={`${base}/${request.id}/preview`}>
                <Icon name="eye" size={16} />
                Ver como a parceira
              </Link>
            </div>
            <div className="panel__body">
              <dl className="kv">
                {request.context ? (
                  <>
                    <dt>Porque pedimos</dt>
                    <dd>{request.context}</dd>
                  </>
                ) : null}
                <dt>O que pedimos</dt>
                <dd>{request.requestedAction}</dd>
                <dt>Recurso associado</dt>
                <dd>{resource ? `${resource.name} · ${resourceHost(resource.url)}` : 'Nenhum'}</dd>
                <dt>Perguntas</dt>
                <dd>
                  {ordered.length === 0
                    ? 'Nenhuma'
                    : ordered.map((f) => `${f.label}${f.required ? '' : ' (opcional)'}`).join('\n')}
                </dd>
              </dl>
            </div>
          </section>
        </div>

        <div className="zone zone--internal">
          <span className="zone__tag zone__tag--internal">
            <Icon name="lock" size={16} />
            Só Sollelio
          </span>
          <section className="panel" aria-labelledby="internal-details">
            <div className="panel__head">
              <h2 id="internal-details">Detalhes internos</h2>
            </div>
            <div className="panel__body">
              {request.internal ? (
                <dl className="kv">
                  <dt>Critério de conclusão</dt>
                  <dd>{request.internal.completionCriteria}</dd>
                  <dt>Responsável</dt>
                  <dd>{nameOf(request.internal.internalOwnerProfileId)}</dd>
                  <dt>Prioridade</dt>
                  <dd>{PRIORITY_LABELS[request.internal.priority]}</dd>
                </dl>
              ) : (
                <p className="sub">Sem detalhes internos.</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="internal-notes">
            <div className="panel__head">
              <h2 id="internal-notes">Notas internas</h2>
            </div>
            {notes.length === 0 ? (
              <div className="panel__body">
                <p className="sub">Sem notas internas.</p>
              </div>
            ) : (
              <ul className="history">
                {notes.map((note) => (
                  <li key={note.id}>
                    <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
                    <span>
                      <strong>{nameOf(note.authorProfileId)}</strong>: {note.content}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="activity">
            <div className="panel__head">
              <h2 id="activity">Atividade</h2>
            </div>
            <ul className="history">
              {activity.map((entry) => (
                <li key={entry.id}>
                  <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  <span>
                    {nameOf(entry.actorProfileId)} · {ACTIVITY_LABELS[entry.eventType] ?? entry.eventType}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
