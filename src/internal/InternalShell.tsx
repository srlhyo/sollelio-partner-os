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
 *
 * Signing out reuses the same `useSignOut` the partner surface uses: one session
 * boundary, one error contract, one place to change.
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, SollelioSymbol } from '../platform/ui/Icon';
import { useSignOut } from '../auth/useSignOut';
import { useCurrentProfile } from './useCurrentProfile';

export function InternalShell({ children }: { children: ReactNode }) {
  const profile = useCurrentProfile();
  const { signOut, pending, error } = useSignOut();

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

        {/*
          The account area the shell already had. The one session control an operator
          needs goes here, beside their own name — chrome, not operational content,
          and out of the way of the work in the main column.
        */}
        <div className="internal__account">
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
          <span className="internal__account-text">
            <span className="internal__account-name">{profile?.displayName ?? '—'}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Sollelio</span>
          </span>
          <button
            type="button"
            className="signout internal__signout"
            onClick={() => void signOut()}
            disabled={pending}
          >
            {pending ? 'A sair\u2026' : 'Sair'}
          </button>
        </div>

        {error ? (
          <p className="signout-error internal__signout-error" role="alert">
            {error}
          </p>
        ) : null}
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
