/**
 * Organization overview — Slice 1.
 *
 * Canonical resources first, because in this slice they are the whole collaboration
 * surface. Products and people sit below as reference, not as metrics: this is not a
 * dashboard (03_UX_SPEC.md §13).
 */
import { Link } from 'react-router-dom';
import { useAsync } from '../platform/useAsync';
import { ErrorState, LoadingBlock, EmptyState } from '../platform/ui/States';
import type { Organization } from '../modules/organizations/types';
import { fetchAllResources } from '../modules/resources/queries';
import { fetchOrganizationProducts } from '../modules/products/queries';
import { fetchOrganizationMembers } from '../modules/people/queries';
import { resourceHost } from '../modules/resources/types';

export function OrganizationOverview({ organization }: { organization: Organization }) {
  const resources = useAsync(() => fetchAllResources(organization.id), [organization.id]);
  const products = useAsync(() => fetchOrganizationProducts(organization.id), [organization.id]);
  const people = useAsync(() => fetchOrganizationMembers(organization.id), [organization.id]);

  const activeResources =
    resources.status === 'ready'
      ? resources.data.filter((resource) => resource.status === 'active' && resource.partnerVisible)
      : [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 20, alignItems: 'start' }}>
      <div style={{ gridColumn: 'span 3', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <section className="panel">
          <div className="panel__head">
            <h2>Recursos canónicos</h2>
            <Link to={`/app/organizations/${organization.slug}/resources`} style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Gerir
            </Link>
          </div>

          {resources.status === 'loading' ? (
            <div style={{ padding: 16 }}>
              <LoadingBlock label="A carregar recursos" />
            </div>
          ) : null}

          {resources.status === 'error' ? (
            <div style={{ padding: 16 }}>
              <ErrorState onRetry={resources.reload}>Não foi possível carregar os recursos.</ErrorState>
            </div>
          ) : null}

          {resources.status === 'ready' && activeResources.length === 0 ? (
            <div style={{ padding: 16 }}>
              <EmptyState title="Sem recursos ativos." tone="warn">
                A parceira ainda não tem nenhum endereço canónico para abrir.
              </EmptyState>
            </div>
          ) : null}

          {activeResources.map((resource) => (
            <div key={resource.id} className="row">
              <span className="row__text">
                <span className="row__title">{resource.name}</span>
                <span className="row__meta">{resourceHost(resource.url)}</span>
              </span>
              <span className="chip chip--green">Ativo</span>
            </div>
          ))}
        </section>
      </div>

      <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <section className="panel">
          <div className="panel__head">
            <h2>Produtos</h2>
          </div>
          {products.status === 'loading' ? (
            <div style={{ padding: 16 }}>
              <LoadingBlock label="A carregar produtos" />
            </div>
          ) : null}
          {products.status === 'error' ? (
            <div style={{ padding: 16 }}>
              <ErrorState onRetry={products.reload}>Não foi possível carregar os produtos.</ErrorState>
            </div>
          ) : null}
          {products.status === 'ready' && products.data.length === 0 ? (
            <div className="row" style={{ color: 'var(--ink-2)', fontSize: 14 }}>
              Nenhum produto ligado a esta organização.
            </div>
          ) : null}
          {products.status === 'ready'
            ? products.data.map((link) => (
                <div key={link.id} className="row">
                  <span className="row__text">
                    <span className="row__title">{link.product.name}</span>
                    <span className="row__meta">{link.product.key}</span>
                  </span>
                  <span className={`chip chip--${link.status === 'active' ? 'green' : 'neutral'}`}>
                    {link.status === 'active' ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              ))
            : null}
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>Pessoas</h2>
            <Link to={`/app/organizations/${organization.slug}/people`} style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Ver todas
            </Link>
          </div>
          {people.status === 'ready'
            ? people.data
                .filter((member) => member.membershipStatus === 'active')
                .map((member) => (
                  <div key={member.profile.id} className="row">
                    <span className="row__text">
                      <span className="row__title">{member.profile.displayName}</span>
                      <span className="row__meta">Membro ativo</span>
                    </span>
                  </div>
                ))
            : null}
          {people.status === 'loading' ? (
            <div style={{ padding: 16 }}>
              <LoadingBlock label="A carregar pessoas" />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
