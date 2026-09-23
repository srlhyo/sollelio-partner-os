/**
 * `/partner/*` — the partner-facing surface.
 *
 * The header carries the platform, not the tenant: the Sollelio symbol with
 * "Partner OS". The organization appears as workspace context above the greeting,
 * so it can never be mistaken for a Do Luxo à Mesa lockup.
 *
 * The trailing slot is where the approved design puts the compact menu affordance
 * (03_UX_SPEC.md §2). In Slice 1 there is no navigation to gather there — Resources
 * is reached from Home — so the slot holds the one session action a partner needs:
 * a way out. Quiet grey, not the indigo reserved for her actual work.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, SollelioSymbol } from '../platform/ui/Icon';
import { useSession } from '../platform/session-context';
import { useSignOut } from '../auth/useSignOut';

export function PartnerShell({
  children,
  back,
}: {
  children: ReactNode;
  back?: { to: string; label: string } | undefined;
}) {
  const session = useSession();
  const { signOut, pending, error } = useSignOut();

  return (
    <div className="partner">
      <header className="partner__bar">
        {back ? (
          <Link
            to={back.to}
            className="btn btn--ghost"
            style={{ marginLeft: -8, minHeight: 44 }}
          >
            <Icon name="back" size={20} />
            {back.label}
          </Link>
        ) : (
          <span className="partner__brand">
            <SollelioSymbol size={26} />
            <span>
              <strong>Sollelio</strong> Partner OS
            </span>
          </span>
        )}

        {session.status === 'signed-in' ? (
          <button
            type="button"
            className="signout partner__signout"
            onClick={() => void signOut()}
            disabled={pending}
          >
            {pending ? 'A sair\u2026' : 'Sair'}
          </button>
        ) : (
          <span />
        )}
      </header>

      {error ? (
        <p className="signout-error partner__signout-error" role="alert">
          {error}
        </p>
      ) : null}

      {children}
    </div>
  );
}
