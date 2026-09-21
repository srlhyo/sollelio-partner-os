import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

// The shells read the session; Phase 0 tests routing, not authentication.
vi.mock('./platform/session-context', () => ({
  useSession: () => ({ status: 'signed-out' as const }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('surface routing', () => {
  it('serves the partner surface at /partner', () => {
    renderAt('/partner');
    expect(screen.getByRole('heading', { name: /Superfície Parceira/i })).toBeDefined();
  });

  it('serves the internal surface at /app', () => {
    renderAt('/app');
    expect(screen.getByRole('heading', { name: /Superfície Sollelio/i })).toBeDefined();
  });

  it('keeps the two surfaces separate', () => {
    renderAt('/partner');
    expect(screen.queryByRole('heading', { name: /Superfície Sollelio/i })).toBeNull();
  });

  it('redirects the root to the partner surface', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: /Superfície Parceira/i })).toBeDefined();
  });

  it('shows a way back on an unknown route', () => {
    renderAt('/nada-aqui');
    expect(screen.getByRole('link', { name: /Voltar ao início/i })).toBeDefined();
  });
});
