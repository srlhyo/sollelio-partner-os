/**
 * Resources — the canonical links, in full.
 */
import { useSearchParams } from 'react-router-dom';
import { useAsync } from '../platform/useAsync';
import { Icon } from '../platform/ui/Icon';
import { EmptyState, ErrorState, LoadingBlock } from '../platform/ui/States';
import { fetchPartnerResources } from '../modules/resources/queries';
import { useOrganizationContext } from '../modules/organizations/useOrganizationContext';
import { PartnerShell } from './PartnerShell';
import { ResourceList } from './ResourceList';
import { NoMembership, OrganizationChooser } from './OrganizationStates';

export function PartnerResources() {
  const [params] = useSearchParams();
  const context = useOrganizationContext(params.get('org') ?? undefined);
  const organizationId = context.state === 'ready' ? context.organization.id : null;

  const resources = useAsync(
    () => (organizationId ? fetchPartnerResources(organizationId) : Promise.resolve([])),
    [organizationId],
  );

  if (context.state === 'none') return <NoMembership />;
  if (context.state === 'choose') return <OrganizationChooser organizations={context.organizations} />;

  return (
    <PartnerShell back={{ to: '/partner', label: 'Início' }}>
      <div className="partner__body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 28, lineHeight: 1.2 }}>Recursos</h1>
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>Os endereços certos, sempre atuais.</p>
        </div>

        {context.state === 'loading' || resources.status === 'loading' ? (
          <LoadingBlock label="A carregar os recursos" />
        ) : null}

        {context.state === 'error' ? (
          <ErrorState onRetry={context.reload}>Não conseguimos carregar o seu espaço.</ErrorState>
        ) : null}

        {resources.status === 'error' ? (
          <ErrorState onRetry={resources.reload}>
            Não conseguimos carregar os seus recursos agora.
          </ErrorState>
        ) : null}

        {resources.status === 'ready' && resources.data.length === 0 ? (
          <EmptyState title="Ainda não há recursos aqui.">
            Assim que a Sollelio publicar os endereços de acesso, aparecem neste espaço.
          </EmptyState>
        ) : null}

        {resources.status === 'ready' && resources.data.length > 0 ? (
          <>
            <ResourceList resources={resources.data} />
            <p
              className="field__hint"
              style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'flex-start' }}
            >
              <Icon name="lock" size={18} />
              <span>
                Se um endereço mudar, é aqui que aparece o novo. Os antigos deixam de aparecer.
              </span>
            </p>
          </>
        ) : null}
      </div>
    </PartnerShell>
  );
}
