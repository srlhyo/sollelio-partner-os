/**
 * Loading, empty and error states.
 *
 * Every surface needs all three. Copy is pt-PT, human, and never a dead end:
 * an error always offers the way out (03_UX_SPEC.md §1, §21).
 */
import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Skeleton({ width = '100%', height = 16 }: { width?: string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="state" aria-busy="true" aria-live="polite" style={{ gap: 12 }}>
      <span className="visually-hidden">{label}</span>
      <Skeleton width="60%" height={20} />
      <Skeleton height={14} />
      <Skeleton width="80%" height={14} />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  tone = 'ok',
}: {
  title: string;
  children: ReactNode;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className="state">
      <span className={`state__icon state__icon--${tone}`}>
        <Icon name={tone === 'ok' ? 'check' : 'alert'} size={24} />
      </span>
      <p className="state__title">{title}</p>
      <p className="state__body">{children}</p>
    </div>
  );
}

export function ErrorState({
  title = 'Não foi possível carregar.',
  children,
  onRetry,
}: {
  title?: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="state" role="alert">
      <span className="state__icon state__icon--error">
        <Icon name="alert" size={24} />
      </span>
      <p className="state__title">{title}</p>
      <p className="state__body">
        {children ?? 'Verifique a ligação à internet e tente novamente.'}
      </p>
      {onRetry ? (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          <Icon name="refresh" size={18} />
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}
