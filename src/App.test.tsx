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
import type * as AuthReturnModule from './auth/authReturn';

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  profile: null as Profile | null,
  organizations: [] as Organization[],
  resources: [] as Resource[],
  allOrganizations: [] as Organization[],
  signInCalls: [] as string[],
  signOutCalls: 0,
  signOutError: null as { message: string } | null,
  profileFails: false,
  authReturn: { kind: 'none' } as { kind: string; reason?: string; via?: string },
}));

// The outcome of an email authentication link is captured at page load; tests set it
// here rather than fabricating a URL the Supabase client would have already rewritten.
vi.mock('./auth/authReturn', async () => {
  const actual = await vi.importActual<typeof AuthReturnModule>('./auth/authReturn');
  return { ...actual, getAuthReturn: () => state.authReturn };
});

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
      signOut: async () => {
        state.signOutCalls += 1;
        return { error: state.signOutError };
      },
    },
  },
}));

vi.mock('./modules/people/queries', () => ({
  fetchCurrentProfile: async () => {
    if (state.profileFails) throw new Error('profile unreachable');
    return state.profile;
  },
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
  state.signOutCalls = 0;
  state.signOutError = null;
  state.profileFails = false;
  state.authReturn = { kind: 'none' };
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
    expect(await screen.findByRole('heading', { name: /Este link já não funciona/i })).toBeDefined();
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

describe('signing out', () => {
  beforeEach(() => {
    state.session = { user: { id: 'auth-1' } };
    state.profile = nadia;
    state.organizations = [doLuxo];
    state.resources = [resource({ id: 'r1', name: 'Sollelio Events', url: 'https://events.test' })];
  });

  it('offers Sair on the partner surface', async () => {
    renderAt('/partner');
    expect(await screen.findByRole('button', { name: 'Sair' })).toBeDefined();
  });

  it('offers Sair on Resources too, alongside the way back', async () => {
    renderAt('/partner/resources');
    expect(await screen.findByRole('button', { name: 'Sair' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Início/ })).toBeDefined();
  });

  it('terminates the Supabase session and lands on sign-in', async () => {
    const user = userEvent.setup();
    renderAt('/partner');

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    await waitFor(() => expect(state.signOutCalls).toBe(1));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeDefined();
  });

  it('does not pretend to succeed when Supabase refuses', async () => {
    state.signOutError = { message: 'network unreachable' };
    const user = userEvent.setup();
    renderAt('/partner');

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Não foi possível sair');
    // Still on the authenticated screen, because the session is still real.
    expect(screen.getByRole('heading', { name: 'Olá, Nádia' })).toBeDefined();
    // And nothing internal leaked into the message.
    expect(alert.textContent).not.toContain('network unreachable');
  });

  it('is not offered to a signed-out visitor', async () => {
    state.session = null;
    renderAt('/partner');

    await screen.findByRole('heading', { name: 'Entrar' });
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull();
  });
});

describe('signing out of the Sollelio internal surface', () => {
  function asStaff() {
    state.session = { user: { id: 'auth-2' } };
    state.profile = helio;
    state.allOrganizations = [doLuxo];
  }

  it('1. an authenticated operator sees Sair in the shell', async () => {
    asStaff();
    renderAt('/app/organizations');

    await screen.findByRole('heading', { name: 'Organizações' });
    expect(screen.getByRole('button', { name: 'Sair' })).toBeDefined();
  });

  it('1b. and on an organization page too, since it lives in the shell', async () => {
    asStaff();
    renderAt('/app/organizations/do-luxo-a-mesa');

    await screen.findByText('Espaço da organização');
    expect(screen.getByRole('button', { name: 'Sair' })).toBeDefined();
  });

  it('2. an unauthenticated visitor sees no internal session control', async () => {
    state.session = null;
    renderAt('/app/organizations');

    await screen.findByRole('heading', { name: 'Entrar' });
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull();
  });

  it('3 and 4. activating Sair signs out and reaches the sign-in flow', async () => {
    asStaff();
    const user = userEvent.setup();
    renderAt('/app/organizations');

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    // The same sign-out path the partner surface uses — one implementation.
    await waitFor(() => expect(state.signOutCalls).toBe(1));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Organizações' })).toBeNull();
  });

  it('5 and 6. a failure keeps the session coherent and leaks nothing', async () => {
    asStaff();
    state.signOutError = { message: 'gotrue refused: token 0xdeadbeef' };
    const user = userEvent.setup();
    renderAt('/app/organizations');

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Não foi possível sair');
    // Still inside the internal surface, because the session is still real.
    expect(screen.getByRole('heading', { name: 'Organizações' })).toBeDefined();
    // Nothing from Supabase reached the DOM.
    expect(document.body.textContent).not.toContain('gotrue');
    expect(document.body.textContent).not.toContain('0xdeadbeef');
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

describe('returning from an email authentication link', () => {
  it('1. a valid return continues into the authenticated experience', async () => {
    state.session = { user: { id: 'auth-1' } };
    state.profile = nadia;
    state.organizations = [doLuxo];
    state.authReturn = { kind: 'pending', via: 'code' };

    renderAt('/partner');

    expect(await screen.findByRole('heading', { name: 'Olá, Nádia' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: /já não funciona/i })).toBeNull();
  });

  it('2. an expired or already-used link explains itself', async () => {
    state.session = null;
    state.authReturn = { kind: 'link-failure', reason: 'otp_expired' };

    renderAt('/partner');

    expect(await screen.findByRole('heading', { name: /Este link já não funciona/i })).toBeDefined();
    expect(screen.getByText(/já foi usado ou entretanto expirou/i)).toBeDefined();
    expect(screen.getByRole('link', { name: /Pedir novo link/i })).toBeDefined();
  });

  it('2b. including on a deep link into a protected page', async () => {
    state.session = null;
    state.authReturn = { kind: 'link-failure', reason: 'otp_expired' };

    renderAt('/partner/resources');

    expect(await screen.findByRole('heading', { name: /Este link já não funciona/i })).toBeDefined();
  });

  it('2c. and on the internal surface, which uses the same guard', async () => {
    state.session = null;
    state.authReturn = { kind: 'link-failure', reason: 'otp_expired' };

    renderAt('/app/organizations');

    expect(await screen.findByRole('heading', { name: /Este link já não funciona/i })).toBeDefined();
  });

  it('2d. a code that could not be exchanged here is treated the same way', async () => {
    // A link opened in a different browser than the one that requested it.
    state.session = null;
    state.authReturn = { kind: 'pending', via: 'code' };

    renderAt('/partner');

    expect(await screen.findByRole('heading', { name: /Este link já não funciona/i })).toBeDefined();
  });

  it('3. a failed link creates no authenticated state', async () => {
    state.session = null;
    state.authReturn = { kind: 'link-failure', reason: 'otp_expired' };

    renderAt('/partner');

    await screen.findByRole('heading', { name: /Este link já não funciona/i });
    expect(screen.queryByRole('heading', { name: /Olá/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Sollelio Events/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull();
  });

  it('4. an unrelated failure is not dressed up as an expired link', async () => {
    state.session = null;
    state.authReturn = { kind: 'other-failure', reason: 'server_error' };

    renderAt('/partner');

    // The ordinary signed-out path, unchanged.
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: /já não funciona/i })).toBeNull();
  });

  it('4b. an ordinary signed-out visit still reaches sign-in', async () => {
    state.session = null;
    state.authReturn = { kind: 'none' };

    renderAt('/partner/resources');

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: /já não funciona/i })).toBeNull();
  });

  it('5. nothing from Supabase reaches the screen', async () => {
    state.session = null;
    state.authReturn = { kind: 'link-failure', reason: 'otp_expired' };

    renderAt('/partner');
    await screen.findByRole('heading', { name: /Este link já não funciona/i });

    const shown = document.body.textContent ?? '';
    for (const leak of ['otp_expired', 'access_denied', 'error_code', 'Email link is invalid', 'code=', '403', '401']) {
      expect(shown).not.toContain(leak);
    }
  });
});

describe('post-authentication routing', () => {
  function asPartner() {
    state.session = { user: { id: 'auth-1' } };
    state.profile = nadia;
    state.organizations = [doLuxo];
    state.resources = [resource({ id: 'r1', name: 'Sollelio Events', url: 'https://events.test' })];
  }

  function asStaff() {
    state.session = { user: { id: 'auth-2' } };
    state.profile = helio;
    state.allOrganizations = [doLuxo];
  }

  it('1. a partner with no requested destination lands on the partner home', async () => {
    asPartner();
    renderAt('/partner');
    expect(await screen.findByRole('heading', { name: 'Olá, Nádia' })).toBeDefined();
  });

  it('2. staff landing on the partner surface are sent to the internal home', async () => {
    // This is the staging defect: the magic link landed staff in Partner UX.
    asStaff();
    renderAt('/partner');

    expect(await screen.findByRole('heading', { name: 'Organizações' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: /Olá/ })).toBeNull();
  });

  it('3. a partner keeps a valid partner destination', async () => {
    asPartner();
    renderAt('/partner/resources');
    expect(await screen.findByRole('heading', { name: 'Recursos' })).toBeDefined();
  });

  it('4. staff keep a valid internal destination', async () => {
    asStaff();
    renderAt('/app/organizations/do-luxo-a-mesa');
    expect(await screen.findByText('Espaço da organização')).toBeDefined();
  });

  it('5. staff asked for a partner page are sent to the internal home instead', async () => {
    asStaff();
    renderAt('/partner/resources');

    expect(await screen.findByRole('heading', { name: 'Organizações' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Recursos' })).toBeNull();
  });

  it('6. a partner asked for an internal page is sent to the partner home instead', async () => {
    asPartner();
    renderAt('/app/organizations');

    expect(await screen.findByRole('heading', { name: 'Olá, Nádia' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Organizações' })).toBeNull();
  });

  it('7. a signed-out visitor is still sent to sign in, whatever was requested', async () => {
    state.session = null;
    renderAt('/app/organizations/do-luxo-a-mesa/people');

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeDefined();
  });

  it('waits rather than guessing a surface while the profile is loading', async () => {
    asStaff();
    renderAt('/partner');
    // Before the profile resolves, neither surface is rendered.
    expect(screen.queryByRole('heading', { name: /Olá/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Organizações' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Organizações' })).toBeDefined();
  });

  it('says so, and offers a retry, when the profile cannot be read', async () => {
    asStaff();
    state.profileFails = true;
    renderAt('/app/organizations');

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Organizações' })).toBeNull();
  });

  it('treats a session with no profile as a partner, never as staff', async () => {
    state.session = { user: { id: 'auth-9' } };
    state.profile = null;
    state.organizations = [];
    renderAt('/app/organizations');

    expect(await screen.findByText(/ainda não está ligada a uma organização/i)).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Organizações' })).toBeNull();
  });
});

describe('internal surface', () => {

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
