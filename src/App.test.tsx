/**
 * Flow coverage for Slice 1.
 *
 * Renders the real application — routing, guards, shells and screens — against a
 * mocked data layer, so a regression in any of those fails here. The database rules
 * these screens depend on are proved separately, in SQL, by
 * `supabase/verify/92_assert_rls.sql`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Organization } from './modules/organizations/types';
import type { Profile } from './modules/people/types';
import type { Resource } from './modules/resources/types';

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  profile: null as Profile | null,
  organizations: [] as Organization[],
  resources: [] as Resource[],
  allOrganizations: [] as Organization[],
  signInCalls: [] as string[],
}));

vi.mock('./platform/session-context', () => ({
  useSession: () =>
    state.session ? { status: 'signed-in' as const, session: state.session } : { status: 'signed-out' as const },
}));

vi.mock('./platform/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: async ({ email }: { email: string }) => {
        state.signInCalls.push(email);
        return { error: null };
      },
    },
  },
}));

vi.mock('./modules/people/queries', () => ({
  fetchCurrentProfile: async () => state.profile,
  fetchOrganizationMembers: async () => [],
}));

vi.mock('./modules/organizations/queries', () => ({
  fetchMyActiveOrganizations: async () => state.organizations,
  fetchAllOrganizations: async () => state.allOrganizations,
  fetchOrganizationBySlug: async (slug: string) =>
    state.allOrganizations.find((organization) => organization.slug === slug) ?? null,
}));

vi.mock('./modules/resources/queries', () => ({
  fetchPartnerResources: async () => state.resources,
  fetchAllResources: async () => state.resources,
}));

vi.mock('./modules/products/queries', () => ({
  fetchOrganizationProducts: async () => [],
}));

const doLuxo: Organization = {
  id: 'org-1',
  name: 'Do Luxo à Mesa',
  slug: 'do-luxo-a-mesa',
  status: 'active',
};

const otherOrg: Organization = {
  id: 'org-2',
  name: 'Outra Organização',
  slug: 'outra-organizacao',
  status: 'active',
};

const nadia: Profile = {
  id: 'profile-1',
  authUserId: 'auth-1',
  displayName: 'Nádia Ferreira',
  isSollelioStaff: false,
};

const helio: Profile = {
  id: 'profile-2',
  authUserId: 'auth-2',
  displayName: 'Hélio Schultz',
  isSollelioStaff: true,
};

function resource(overrides: Partial<Resource> & { id: string; name: string; url: string }): Resource {
  return {
    organizationId: 'org-1',
    productId: null,
    type: 'product',
    status: 'active',
    partnerVisible: true,
    sortOrder: 0,
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.session = null;
  state.profile = null;
  state.organizations = [];
  state.resources = [];
  state.allOrganizations = [];
  state.signInCalls = [];
});

describe('signing in', () => {
  it('sends a signed-out partner to sign-in and keeps the destination', async () => {
    renderAt('/partner/resources');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeDefined();
    expect(screen.queryByLabelText(/palavra-passe/i)).toBeNull();
  });

  it('asks for the email and confirms it was sent', async () => {
    const user = userEvent.setup();
    renderAt('/partner/sign-in');

    await user.type(await screen.findByLabelText('Email'), 'nadia@doluxoamesa.pt');
    await user.click(screen.getByRole('button', { name: /Enviar link de acesso/i }));

    expect(await screen.findByRole('heading', { name: /Veja o seu email/i })).toBeDefined();
    expect(state.signInCalls).toEqual(['nadia@doluxoamesa.pt']);
  });

  it('refuses to send without an email', async () => {
    const user = userEvent.setup();
    renderAt('/partner/sign-in');

    await user.click(await screen.findByRole('button', { name: /Enviar link de acesso/i }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(state.signInCalls).toEqual([]);
  });

  it('offers a way back from an expired link', async () => {
    renderAt('/partner/link-expired');
    expect(await screen.findByRole('heading', { name: /Este link já expirou/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Pedir novo link/i })).toBeDefined();
  });
});

describe('partner home', () => {
  beforeEach(() => {
    state.session = { user: { id: 'auth-1' } };
    state.profile = nadia;
    state.organizations = [doLuxo];
  });

  it('greets the partner and names the workspace without a tenant lockup', async () => {
    state.resources = [resource({ id: 'r1', name: 'Sollelio Events', url: 'https://events.sollelio.com/dlm' })];
    renderAt('/partner');

    expect(await screen.findByRole('heading', { name: 'Olá, Nádia' })).toBeDefined();
    expect(screen.getByText('O seu espaço · Do Luxo à Mesa')).toBeDefined();
    // The header carries the platform, not the tenant.
    expect(screen.getByText('Partner OS')).toBeDefined();
  });

  it('shows the canonical resources', async () => {
    state.resources = [
      resource({ id: 'r1', name: 'Sollelio Events', url: 'https://events.sollelio.com/dlm' }),
      resource({ id: 'r2', name: 'Site Do Luxo à Mesa', url: 'https://doluxoamesa.pt', type: 'website' }),
    ];
    renderAt('/partner');

    const events = await screen.findByRole('link', { name: /Sollelio Events/ });
    expect(events.getAttribute('href')).toBe('https://events.sollelio.com/dlm');
    expect(events.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('doluxoamesa.pt')).toBeDefined();
  });

  it('does not advertise Requests, Updates or Issues before they exist', async () => {
    state.resources = [resource({ id: 'r1', name: 'Sollelio Events', url: 'https://events.sollelio.com' })];
    renderAt('/partner');

    await screen.findByRole('heading', { name: 'Olá, Nádia' });
    expect(screen.queryByText(/Precisa da sua atenção/i)).toBeNull();
    expect(screen.queryByText(/Reportar um problema/i)).toBeNull();
    expect(screen.queryByText(/novidades/i)).toBeNull();
  });

  it('is honest when there are no resources yet', async () => {
    renderAt('/partner');
    expect(await screen.findByText(/Ainda não há recursos aqui/i)).toBeDefined();
  });

  it('opens the full resources page', async () => {
    state.resources = [
      resource({ id: 'r1', name: 'Um', url: 'https://a.test' }),
      resource({ id: 'r2', name: 'Dois', url: 'https://b.test' }),
      resource({ id: 'r3', name: 'Três', url: 'https://c.test' }),
      resource({ id: 'r4', name: 'Quatro', url: 'https://d.test' }),
    ];
    const user = userEvent.setup();
    renderAt('/partner');

    await user.click(await screen.findByRole('link', { name: /Ver todos os recursos/i }));
    expect(await screen.findByRole('heading', { name: 'Recursos' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Quatro/ })).toBeDefined();
  });
});

describe('organization context', () => {
  beforeEach(() => {
    state.session = { user: { id: 'auth-1' } };
    state.profile = nadia;
  });

  it('never picks silently when there is more than one active membership', async () => {
    state.organizations = [doLuxo, otherOrg];
    renderAt('/partner');

    expect(await screen.findByRole('heading', { name: /Em que espaço quer entrar/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Do Luxo à Mesa/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Outra Organização/ })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Olá, Nádia' })).toBeNull();
  });

  it('explains when the account belongs to no organization', async () => {
    state.organizations = [];
    renderAt('/partner');
    expect(await screen.findByText(/ainda não está ligada a uma organização/i)).toBeDefined();
  });
});

describe('internal surface', () => {
  it('keeps a partner out of the Sollelio area', async () => {
    state.session = { user: { id: 'auth-1' } };
    state.profile = nadia;
    renderAt('/app/organizations');

    expect(await screen.findByText(/Esta área é da equipa Sollelio/i)).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Organizações' })).toBeNull();
  });

  it('lists organizations for staff and opens one', async () => {
    state.session = { user: { id: 'auth-2' } };
    state.profile = helio;
    state.allOrganizations = [doLuxo];
    state.resources = [resource({ id: 'r1', name: 'Sollelio Events', url: 'https://events.sollelio.com' })];

    const user = userEvent.setup();
    renderAt('/app/organizations');

    await user.click(await screen.findByRole('link', { name: /Do Luxo à Mesa/ }));

    await waitFor(() => {
      expect(screen.getByText('Espaço da organização')).toBeDefined();
    });
    expect(screen.getByRole('link', { name: 'Recursos' })).toBeDefined();
  });

  it('shows only the tabs whose slices exist', async () => {
    state.session = { user: { id: 'auth-2' } };
    state.profile = helio;
    state.allOrganizations = [doLuxo];
    renderAt('/app/organizations/do-luxo-a-mesa');

    await screen.findByText('Espaço da organização');
    for (const absent of ['Pedidos', 'Problemas', 'Atualizações', 'Atividade']) {
      expect(screen.queryByRole('link', { name: absent })).toBeNull();
    }
  });
});

describe('unknown routes', () => {
  it('offers a way back', async () => {
    renderAt('/nada-aqui');
    expect(await screen.findByRole('link', { name: /Voltar ao início/i })).toBeDefined();
  });
});
