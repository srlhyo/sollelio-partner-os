/**
 * Organization detail — Slice 1 tabs only.
 *
 * The documented sub-navigation also carries Pedidos, Problemas, Atualizações and
 * Atividade (01_PRODUCT_SPEC.md §9). Those tabs appear when their slices do; listing
 * them now would promise screens that do not exist.
 *
 * No queues and no Request counts here: the overview becomes a work queue in
 * Slice 2, when there is work to queue.
 */
import { NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAsync } from '../platform/useAsync';
import { ErrorState, LoadingBlock, EmptyState } from '../platform/ui/States';
import { fetchOrganizationBySlug } from '../modules/organizations/queries';
import type { Organization } from '../modules/organizations/types';
import { InternalShell, ScopeBar } from './InternalShell';
import { OrganizationOverview } from './OrganizationOverview';
import { OrganizationResources } from './OrganizationResources';
import { OrganizationPeople } from './OrganizationPeople';

/**
 * Tab targets are absolute, built from the slug.
 *
 * Relative targets look tidier and are wrong here: from
 * `/app/organizations/:slug/resources`, `to="resources"` resolves to
 * `…/resources/resources` and the tabs stop working the moment you use them.
 */
const TABS = [
  { segment: '', label: 'Visão geral' },
  { segment: 'resources', label: 'Recursos' },
  { segment: 'people', label: 'Pessoas' },
];

export function OrganizationDetail() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const organization = useAsync(
    () => (slug ? fetchOrganizationBySlug(slug) : Promise.resolve(null)),
    [slug],
  );

  if (organization.status === 'loading') {
    return (
      <InternalShell>
        <LoadingBlock label="A carregar a organização" />
      </InternalShell>
    );
  }

  if (organization.status === 'error') {
    return (
      <InternalShell>
        <ErrorState onRetry={organization.reload}>
          Não foi possível carregar esta organização.
        </ErrorState>
      </InternalShell>
    );
  }

  if (!organization.data) {
    return (
      <InternalShell>
        <EmptyState title="Não encontrámos esta organização." tone="warn">
          Verifique o endereço ou volte à lista de organizações.
        </EmptyState>
      </InternalShell>
    );
  }

  const found: Organization = organization.data;
  const base = `/app/organizations/${found.slug}`;
  const activeSection = TABS.find(
    (tab) => tab.segment !== '' && location.pathname.startsWith(`${base}/${tab.segment}`),
  )?.label;

  return (
    <InternalShell>
      <ScopeBar name={found.name} section={activeSection} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 26 }}>{found.name}</h1>
        <span className={`chip chip--${found.status === 'active' ? 'green' : 'neutral'}`}>
          {found.status === 'active' ? 'Ativa' : found.status === 'inactive' ? 'Inativa' : 'Arquivada'}
        </span>
      </div>

      <nav className="tabs" aria-label="Secções da organização">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.segment ? `${base}/${tab.segment}` : base}
            end={tab.segment === ''}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<OrganizationOverview organization={found} />} />
        <Route path="resources" element={<OrganizationResources organization={found} />} />
        <Route path="people" element={<OrganizationPeople organization={found} />} />
      </Routes>
    </InternalShell>
  );
}
