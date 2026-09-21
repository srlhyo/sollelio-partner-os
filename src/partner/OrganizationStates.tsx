/**
 * The two organization-context states that are not "one active membership".
 *
 * V0 assumes a single active membership. Both of these exist so the assumption is
 * handled honestly instead of encoded as a silent `LIMIT 1`.
 */
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../platform/ui/Icon';
import { EmptyState } from '../platform/ui/States';
import type { Organization } from '../modules/organizations/types';
import { PartnerShell } from './PartnerShell';

/** Signed in, but no active membership: onboarding is incomplete or access ended. */
export function NoMembership() {
  return (
    <PartnerShell>
      <div className="partner__body">
        <EmptyState title="Ainda não há nada por aqui." tone="warn">
          A sua conta ainda não está ligada a uma organização. Avise a Sollelio e tratamos disso.
        </EmptyState>
      </div>
    </PartnerShell>
  );
}

/**
 * More than one active membership. Never pick one silently — a partner acting inside
 * the wrong organization is worse than an extra tap.
 */
export function OrganizationChooser({ organizations }: { organizations: Organization[] }) {
  const [, setParams] = useSearchParams();

  return (
    <PartnerShell>
      <div className="partner__body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 26, lineHeight: 1.2 }}>Em que espaço quer entrar?</h1>
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>
            Tem acesso a mais do que uma organização. Escolha uma para continuar.
          </p>
        </div>

        <ul className="resources">
          {organizations.map((organization) => (
            <li key={organization.id}>
              <button
                type="button"
                className="resource"
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => setParams({ org: organization.slug })}
              >
                <span className="resource__icon">
                  <Icon name="org" size={20} />
                </span>
                <span className="resource__text">
                  <span className="resource__name">{organization.name}</span>
                </span>
                <Icon name="arrow" size={18} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </PartnerShell>
  );
}
