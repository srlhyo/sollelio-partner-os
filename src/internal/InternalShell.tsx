/**
 * `/app/*` — the Sollelio internal surface.
 *
 * The sidebar is global: it lists what exists across all of Sollelio. Anything
 * scoped to one organization says so, with a scope bar carrying the tenant's name,
 * so global and organization views are never mistaken for each other.
 *
 * In Slice 1 the only global destination is Organizations. Pedidos, Problemas,
 * Atualizações and Atividade arrive with their slices and are not listed while they
 * do not exist.
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, SollelioSymbol } from '../platform/ui/Icon';
import { useCurrentProfile } from './useCurrentProfile';

export function InternalShell({ children }: { children: ReactNode }) {
  const profile = useCurrentProfile();

  return (
    <div className="internal">
      <nav className="internal__nav" aria-label="Navegação Sollelio">
        <span className="internal__brand">
          <SollelioSymbol size={28} />
          <span>
            <strong style={{ fontWeight: 600 }}>Sollelio</strong>{' '}
            <span style={{ color: 'var(--ink-2)' }}>Partner OS</span>
          </span>
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="internal__scope-label">Toda a Sollelio</span>
          <NavLink to="/app/organizations">
            <Icon name="org" size={18} />
            Organizações
          </NavLink>
        </div>

        <div style={{ flexGrow: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 999,
              background: 'var(--midnight)',
              color: '#fff',
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {profile?.displayName.slice(0, 1).toUpperCase() ?? '·'}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{profile?.displayName ?? '—'}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Sollelio</span>
          </span>
        </div>
      </nav>

      <main className="internal__main">{children}</main>
    </div>
  );
}

/** Marks a view as scoped to one organization rather than to all of Sollelio. */
export function ScopeBar({ name, section }: { name: string; section?: string | undefined }) {
  return (
    <div className="scope-bar">
      <span className="scope-bar__logo" aria-hidden="true">
        <Icon name="org" size={16} />
      </span>
      <span className="scope-bar__tag">Espaço da organização</span>
      <strong>{name}</strong>
      {section ? (
        <>
          <span style={{ color: 'var(--ink-3)' }}>/</span>
          <span style={{ fontWeight: 600 }}>{section}</span>
        </>
      ) : null}
    </div>
  );
}
