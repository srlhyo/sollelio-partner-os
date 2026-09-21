/**
 * Partner Home — Slice 1.
 *
 * Home's job is "what do I need to do now?". Until Requests exist there is nothing
 * that can need doing, so this slice answers the other half of the promise: the
 * canonical links, always current, always here. There is deliberately no attention
 * block and no Report a problem control — showing either would advertise a feature
 * that does not exist (06_BUILD_PLAN.md, Slice 1 Partner UI).
 */
import { Link, useSearchParams } from 'react-router-dom';
import { useAsync } from '../platform/useAsync';
import { Icon } from '../platform/ui/Icon';
import { EmptyState, ErrorState, LoadingBlock } from '../platform/ui/States';
import { useSession } from '../platform/session-context';
import { fetchCurrentProfile } from '../modules/people/queries';
import { fetchPartnerResources } from '../modules/resources/queries';
import { useOrganizationContext } from '../modules/organizations/useOrganizationContext';
import { PartnerShell } from './PartnerShell';
import { ResourceList } from './ResourceList';
import { OrganizationChooser, NoMembership } from './OrganizationStates';

export function PartnerHome() {
  const session = useSession();
  const authUserId = session.status === 'signed-in' ? session.session.user.id : null;
  const [params] = useSearchParams();
  const context = useOrganizationContext(params.get('org') ?? undefined);

  const profile = useAsync(
    () => (authUserId ? fetchCurrentProfile(authUserId) : Promise.resolve(null)),
    [authUserId],
  );

  const organizationId = context.state === 'ready' ? context.organization.id : null;
  const resources = useAsync(
    () => (organizationId ? fetchPartnerResources(organizationId) : Promise.resolve([])),
    [organizationId],
  );

  if (context.state === 'loading') {
    return (
      <PartnerShell>
        <div className="partner__body">
          <LoadingBlock label="A carregar o seu espaço" />
        </div>
      </PartnerShell>
    );
  }

  if (context.state === 'error') {
    return (
      <PartnerShell>
        <div className="partner__body">
          <ErrorState onRetry={context.reload}>
            Não conseguimos carregar o seu espaço. Verifique a ligação e tente novamente.
          </ErrorState>
        </div>
      </PartnerShell>
    );
  }

  if (context.state === 'none') return <NoMembership />;
  if (context.state === 'choose') return <OrganizationChooser organizations={context.organizations} />;

  const firstName =
    profile.status === 'ready' && profile.data
      ? profile.data.displayName.split(' ')[0]
      : null;

  return (
    <PartnerShell>
      <div className="partner__body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="partner__eyebrow">O seu espaço · {context.organization.name}</span>
          <h1 className="partner__greeting">{firstName ? `Olá, ${firstName}` : 'Olá'}</h1>
        </div>

        <section className="section" aria-labelledby="quick-access">
          <h2 className="section__label" id="quick-access">
            Acesso rápido
          </h2>

          {resources.status === 'loading' ? <LoadingBlock label="A carregar os recursos" /> : null}

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
              <ResourceList resources={resources.data.slice(0, 3)} />
              {/*
                Always offered, not only when the list is truncated: Resources is a
                destination of its own, and hiding the link at exactly three made the
                page unreachable by navigation.
              */}
              <Link
                to="/partner/resources"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, textDecoration: 'none', minHeight: 44 }}
              >
                Ver todos os recursos
                <Icon name="arrow" size={16} />
              </Link>
            </>
          ) : null}
        </section>
      </div>
    </PartnerShell>
  );
}
