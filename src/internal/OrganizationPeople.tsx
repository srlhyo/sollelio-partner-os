/**
 * People in an organization.
 *
 * Sollelio staff never appear here: staff identity is global and is not modelled as
 * membership of every partner organization (05_DATA_MODEL_AND_API.md §1).
 *
 * Inviting and deactivating people arrive later — deactivation is gated on a person
 * holding no open Requests, which cannot be checked until Requests exist.
 */
import { useAsync } from '../platform/useAsync';
import { EmptyState, ErrorState, LoadingBlock } from '../platform/ui/States';
import { fetchOrganizationMembers } from '../modules/people/queries';
import type { Organization } from '../modules/organizations/types';

export function OrganizationPeople({ organization }: { organization: Organization }) {
  const people = useAsync(() => fetchOrganizationMembers(organization.id), [organization.id]);

  return (
    <>
      {people.status === 'loading' ? <LoadingBlock label="A carregar pessoas" /> : null}

      {people.status === 'error' ? (
        <ErrorState onRetry={people.reload}>Não foi possível carregar as pessoas.</ErrorState>
      ) : null}

      {people.status === 'ready' && people.data.length === 0 ? (
        <EmptyState title="Sem pessoas nesta organização." tone="warn">
          Convide a primeira pessoa para que possa entrar no espaço de parceira.
        </EmptyState>
      ) : null}

      {people.status === 'ready' && people.data.length > 0 ? (
        <section className="panel">
          <div className="panel__head">
            <h2>Membros</h2>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {people.data.filter((member) => member.membershipStatus === 'active').length} ativos
            </span>
          </div>
          {people.data.map((member) => (
            <div key={member.profile.id} className="row">
              <span className="row__text">
                <span className="row__title">{member.profile.displayName}</span>
                <span className="row__meta">Parceira</span>
              </span>
              <span
                className={`chip chip--${member.membershipStatus === 'active' ? 'green' : 'neutral'}`}
              >
                {member.membershipStatus === 'active' ? 'Ativa' : 'Inativa'}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
