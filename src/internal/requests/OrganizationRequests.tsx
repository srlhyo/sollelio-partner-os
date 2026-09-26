/**
 * The organization's Request queue (`/app/organizations/:slug/requests`).
 *
 * A work queue, not a dashboard: what waits on Sollelio, what waits on the partner,
 * drafts, and what is closed (03_UX_SPEC.md §13–§14). No global queue in C2.
 */
import { Link } from 'react-router-dom';
import { useAsync } from '../../platform/useAsync';
import { Icon } from '../../platform/ui/Icon';
import { EmptyState, ErrorState, LoadingBlock } from '../../platform/ui/States';
import type { Organization } from '../../modules/organizations/types';
import { fetchOrganizationMembers } from '../../modules/people/queries';
import { fetchOrganizationRequests } from '../../modules/requests/queries';
import { compareQueue, QUEUE_GROUP_LABELS, QUEUE_GROUPS, queueGroupOf } from '../../modules/requests/order';
import { formatDueShort, formatEffort } from '../../modules/requests/format';
import { PRIORITY_LABELS, REQUEST_TYPE_LABELS, STATUS_LABELS, STATUS_TONES } from '../../modules/requests/types';

export function OrganizationRequests({ organization }: { organization: Organization }) {
  const requests = useAsync(() => fetchOrganizationRequests(organization.id), [organization.id]);
  const members = useAsync(() => fetchOrganizationMembers(organization.id), [organization.id]);
  const base = `/app/organizations/${organization.slug}/requests`;

  const nameOf = (profileId: string) =>
    members.status === 'ready'
      ? (members.data.find((m) => m.profile.id === profileId)?.profile.displayName ?? '—')
      : '…';

  const sorted = requests.status === 'ready' ? [...requests.data].sort(compareQueue) : [];

  return (
    <>
      <div className="head-line" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 20 }}>Pedidos</h2>
        {organization.status === 'active' ? (
          <Link className="btn btn--primary btn--sm" to={`${base}/new`}>
            <Icon name="plus" size={18} />
            Novo pedido
          </Link>
        ) : null}
      </div>

      {organization.status !== 'active' ? (
        <div className="banner banner--warn" role="status">
          <Icon name="alert" size={20} />
          <p>Esta organização não está activa. Não é possível criar, editar ou publicar pedidos.</p>
        </div>
      ) : null}

      {requests.status === 'loading' ? <LoadingBlock label="A carregar os pedidos" /> : null}
      {requests.status === 'error' ? (
        <ErrorState onRetry={requests.reload}>Não foi possível carregar os pedidos.</ErrorState>
      ) : null}

      {requests.status === 'ready' ? (
        <div className="queue" role="list" aria-label="Resumo dos pedidos">
          {QUEUE_GROUPS.map((group) => (
            <div key={group} role="listitem" className={`queue__tile queue__tile--${group}`}>
              <span className="queue__n">{sorted.filter((r) => queueGroupOf(r.status) === group).length}</span>
              <span className="queue__l">{QUEUE_GROUP_LABELS[group]}</span>
            </div>
          ))}
        </div>
      ) : null}

      {requests.status === 'ready' && sorted.length === 0 ? (
        <EmptyState title="Ainda não há pedidos para esta organização." tone="warn">
          Crie o primeiro com «Novo pedido». Um pedido só existe quando há uma acção concreta para a parceira.
        </EmptyState>
      ) : null}

      {QUEUE_GROUPS.map((group) => {
        const items = sorted.filter((r) => queueGroupOf(r.status) === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="panel" aria-labelledby={`queue-${group}`}>
            <div className="panel__head">
              <h2 id={`queue-${group}`}>{QUEUE_GROUP_LABELS[group]}</h2>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{items.length}</span>
            </div>
            {items.map((request) => (
              <Link key={request.id} className="row" to={`${base}/${request.id}`}>
                <span className="row__text">
                  <span className="row__title">{request.title}</span>
                  <span className="row__meta">
                    {[
                      REQUEST_TYPE_LABELS[request.type],
                      nameOf(request.assigneeProfileId),
                      formatEffort(request.estimatedEffortMinutes),
                      request.dueAt ? formatDueShort(request.dueAt) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="row__side">
                  <span className={`chip chip--${STATUS_TONES[request.status]}`}>
                    <span className="chip__dot" aria-hidden="true" />
                    {STATUS_LABELS[request.status]}
                  </span>
                  {request.internal && request.internal.priority !== 'normal' ? (
                    <span className={`chip chip--${request.internal.priority === 'urgent' ? 'red' : 'amber'}`}>
                      {PRIORITY_LABELS[request.internal.priority]}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
          </section>
        );
      })}
    </>
  );
}
