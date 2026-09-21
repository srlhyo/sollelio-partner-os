/**
 * `/partner/*` — the partner-facing surface.
 *
 * The header carries the platform, not the tenant: the Sollelio symbol with
 * "Partner OS". The organization appears as workspace context above the greeting,
 * so it can never be mistaken for a Do Luxo à Mesa lockup.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, SollelioSymbol } from '../platform/ui/Icon';

export function PartnerShell({
  children,
  back,
}: {
  children: ReactNode;
  back?: { to: string; label: string } | undefined;
}) {
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
      </header>
      {children}
    </div>
  );
}
