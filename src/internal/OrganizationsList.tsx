/**
 * Organizations — the one global destination in Slice 1.
 */
import { Link } from 'react-router-dom';
import { useAsync } from '../platform/useAsync';
import { Icon } from '../platform/ui/Icon';
import { EmptyState, ErrorState, LoadingBlock } from '../platform/ui/States';
import { fetchAllOrganizations } from '../modules/organizations/queries';
import { InternalShell } from './InternalShell';

const STATUS_LABELS = { active: 'Ativa', inactive: 'Inativa', archived: 'Arquivada' } as const;
const STATUS_TONES = { active: 'green', inactive: 'neutral', archived: 'neutral' } as const;

export function OrganizationsList() {
  const organizations = useAsync(fetchAllOrganizations, []);

  return (
    <InternalShell>
      <h1 style={{ fontSize: 26 }}>Organizações</h1>

      {organizations.status === 'loading' ? <LoadingBlock label="A carregar organizações" /> : null}

      {organizations.status === 'error' ? (
        <ErrorState onRetry={organizations.reload}>
          Não foi possível carregar as organizações.
        </ErrorState>
      ) : null}

      {organizations.status === 'ready' && organizations.data.length === 0 ? (
        <EmptyState title="Ainda não há organizações." tone="warn">
          A primeira organização parceira é criada durante o arranque do piloto.
        </EmptyState>
      ) : null}

      {organizations.status === 'ready' && organizations.data.length > 0 ? (
        <section className="panel">
          <div className="panel__head">
            <h2>Parceiras</h2>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {organizations.data.length}
            </span>
          </div>
          {organizations.data.map((organization) => (
            <Link
              key={organization.id}
              to={`/app/organizations/${organization.slug}`}
              className="row"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <span className="row__text">
                <span className="row__title">{organization.name}</span>
                <span className="row__meta">{organization.slug}</span>
              </span>
              <span className={`chip chip--${STATUS_TONES[organization.status]}`}>
                {STATUS_LABELS[organization.status]}
              </span>
              <Icon name="arrow" size={16} />
            </Link>
          ))}
        </section>
      ) : null}
    </InternalShell>
  );
}
