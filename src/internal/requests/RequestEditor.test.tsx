/**
 * The draft editor under slow and lost responses. The data boundary is mocked; the
 * editor's own logic — locking, one save at a time, settling an unknown outcome,
 * recognising its own write, refusing to overwrite someone else's — is real.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CommandsModule from '../../modules/requests/commands';
import type { DraftPayload } from '../../modules/requests/commands';
import type { EditableAggregate } from '../../modules/requests/consistent';
import type { Organization } from '../../modules/organizations/types';
import { RequestEditor } from './RequestEditor';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  load: vi.fn(),
}));

vi.mock('../../modules/requests/commands', async () => {
  const actual = await vi.importActual<typeof CommandsModule>('../../modules/requests/commands');
  return { ...actual, createRequestDraft: mocks.create, updateRequestDraft: mocks.update };
});
vi.mock('../../modules/requests/consistent', async () => {
  const actual = await vi.importActual<object>('../../modules/requests/consistent');
  return { ...actual, loadEditableAggregate: mocks.load };
});
vi.mock('../../modules/people/queries', () => ({
  fetchOrganizationMembers: async () => [
    { profile: { id: 'p-nadia', authUserId: 'a', displayName: 'Nádia', isSollelioStaff: false }, membershipStatus: 'active', role: 'partner_member' },
  ],
}));
vi.mock('../../modules/requests/queries', () => ({
  fetchStaffProfiles: async () => [{ id: 's-helio', displayName: 'Hélio' }],
  fetchInternalRequest: async () => null,
  fetchRequestFields: async () => [],
  fetchRequestRevision: async () => null,
}));
vi.mock('../../modules/products/queries', () => ({ fetchOrganizationProducts: async () => [] }));
// The signed-in operator: the actor the server will derive from this session.
vi.mock('../useCurrentProfile', () => ({
  useCurrentProfile: () => ({ id: 's-helio', authUserId: 'a-helio', displayName: 'Hélio', isSollelioStaff: true }),
}));
vi.mock('../../modules/resources/queries', () => ({ fetchAllResources: async () => [] }));

const { CommandError } = await vi.importActual<typeof CommandsModule>('../../modules/requests/commands');

const org: Organization = { id: 'o1', name: 'Do Luxo à Mesa', slug: 'dlm', status: 'active' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const aggregate = (
  revision: number,
  title: string,
  internal: EditableAggregate['request']['internal'] = null,
): EditableAggregate => ({
  request: {
    id: 'r1', organizationId: 'o1', productId: null, resourceId: null, type: 'task', status: 'draft', nextActor: 'none',
    title, context: null, requestedAction: 'Faça isto.', estimatedEffortMinutes: 3, assigneeProfileId: 'p-nadia',
    dueAt: null, createdBy: 's-helio', createdAt: '2026-09-25T10:00:00Z', publishedAt: null,
    updatedAt: '2026-09-25T10:00:00Z', revision, internal,
  },
  fields: [],
});

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/app/organizations/dlm/requests/new']}>
      <Routes>
        <Route path="/app/organizations/dlm/requests/new" element={<RequestEditor organization={org} existing={null} />} />
        <Route path="/app/organizations/dlm/requests/:id" element={<p>Rascunho aberto</p>} />
        <Route path="/partner/sign-in" element={<p>Página de entrada</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderExisting(existing: EditableAggregate, onReload = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/app/organizations/dlm/requests/r1']}>
      <Routes>
        <Route
          path="/app/organizations/dlm/requests/r1"
          element={<RequestEditor organization={org} existing={existing} onReload={onReload} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return onReload;
}

async function fillMinimum(user: ReturnType<typeof userEvent.setup>, title: string) {
  await screen.findByLabelText('Para quem');
  await user.selectOptions(screen.getByLabelText('Para quem'), 'p-nadia');
  await user.selectOptions(screen.getByLabelText('Tipo'), 'task');
  await user.type(screen.getByLabelText('Título'), title);
  await user.type(screen.getByLabelText('O que precisamos que faça'), 'Faça isto.');
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.load.mockReset();
});

describe('saving is one locked attempt at a time', () => {
  it('locks the whole form while the server has not answered, and ignores a second submit', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ request_id: string; revision: number; status: 'draft'; replayed: boolean }>();
    mocks.create.mockReturnValue(pending.promise);
    const { container } = renderNew();
    await fillMinimum(user, 'Primeiro título');

    await user.click(screen.getByRole('button', { name: 'Guardar rascunho' }));

    const title = screen.getByLabelText('Título') as HTMLInputElement;
    // Disabled through the enclosing fieldset: the control is actually disabled (:disabled).
    await waitFor(() => expect(title.matches(':disabled')).toBe(true));
    expect(screen.getByRole('status').textContent).toContain('A guardar o rascunho');
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    // Nothing typed now can be lost behind the navigation that follows the answer.
    await user.type(title, ' alterado');
    expect(title.value).toBe('Primeiro título');
    expect(screen.getByLabelText('O que precisamos que faça').matches(':disabled')).toBe(true);
    for (const button of screen.getAllByRole('button')) expect(button.matches(':disabled')).toBe(true);
    // A second submission — e.g. Enter — does not start a second save.
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(mocks.create).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ request_id: 'new-id', revision: 1, status: 'draft', replayed: false }));
    expect(await screen.findByText('Rascunho aberto')).toBeDefined();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe('a response lost after the server acted', () => {
  it('create: repeats the SAME attempt first, then saves what changed since, as an update', async () => {
    const user = userEvent.setup();
    mocks.create.mockRejectedValueOnce(new CommandError('network', 0));
    renderNew();
    await fillMinimum(user, 'Título enviado');
    await user.click(screen.getByRole('button', { name: 'Guardar rascunho' }));

    expect(await screen.findByText('Não sabemos se a última gravação chegou ao servidor.')).toBeDefined();
    const [firstId, firstPayload] = mocks.create.mock.calls[0] as [string, DraftPayload];

    // The operator keeps working; the lost attempt stays as it was.
    const title = screen.getByLabelText('Título');
    await user.clear(title);
    await user.type(title, 'Título mais recente');

    mocks.create.mockResolvedValueOnce({ request_id: firstId, revision: 1, status: 'draft', replayed: true });
    mocks.load.mockResolvedValueOnce(aggregate(1, 'Título enviado'));
    mocks.update.mockResolvedValueOnce({ request_id: firstId, revision: 2, status: 'draft', replayed: false });
    await user.click(screen.getByRole('button', { name: 'Verificar e guardar' }));

    expect(await screen.findByText('Rascunho aberto')).toBeDefined();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    // Same key, same payload: a repetition, never the same key with newer content.
    expect(mocks.create.mock.calls[1]).toEqual([firstId, firstPayload]);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const [updateId, expected, updatePayload] = mocks.update.mock.calls[0] as [string, number, DraftPayload];
    expect([updateId, expected, updatePayload.title]).toEqual([firstId, 1, 'Título mais recente']);
  });

  it('update: recognises its own write at a newer revision and does not send it again', async () => {
    const user = userEvent.setup();
    renderExisting(aggregate(5, 'Antes'));
    const title = await screen.findByLabelText('Título');
    await user.clear(title);
    await user.type(title, 'Depois');
    mocks.update.mockRejectedValueOnce(new CommandError('internal_error', 504));
    await user.click(screen.getByRole('button', { name: 'Guardar rascunho' }));
    expect(await screen.findByText('Não sabemos se a última gravação chegou ao servidor.')).toBeDefined();

    mocks.load.mockResolvedValueOnce(aggregate(6, 'Depois')); // it had landed
    await user.click(screen.getByRole('button', { name: 'Verificar e guardar' }));

    expect(await screen.findByText('Rascunho guardado.')).toBeDefined();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('update: another session’s change is a conflict, never overwritten without a choice', async () => {
    const user = userEvent.setup();
    const onReload = renderExisting(aggregate(5, 'Antes'));
    const title = await screen.findByLabelText('Título');
    await user.clear(title);
    await user.type(title, 'A minha versão');
    mocks.update.mockRejectedValueOnce(new CommandError('network', 0));
    await user.click(screen.getByRole('button', { name: 'Guardar rascunho' }));
    await screen.findByText('Não sabemos se a última gravação chegou ao servidor.');

    mocks.load.mockResolvedValueOnce(aggregate(6, 'Versão de outra pessoa'));
    await user.click(screen.getByRole('button', { name: 'Verificar e guardar' }));

    const alert = await screen.findByText('Este rascunho foi alterado noutra sessão.');
    expect(alert).toBeDefined();
    expect(mocks.update).toHaveBeenCalledTimes(1); // nothing written automatically
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('A minha versão'); // local work kept

    await user.click(screen.getByRole('button', { name: 'Ver a versão guardada (descarta este formulário)' }));
    expect(onReload).toHaveBeenCalledTimes(1);

    mocks.update.mockResolvedValueOnce({ request_id: 'r1', revision: 7, status: 'draft', replayed: false });
    await user.click(screen.getByRole('button', { name: 'Substituir pela minha versão' }));
    await screen.findByText('Rascunho guardado.');
    const [, expected, payload] = mocks.update.mock.calls[1] as [string, number, DraftPayload];
    expect([expected, payload.title]).toEqual([6, 'A minha versão']);
  });
});

describe('an ended session', () => {
  it('offers the sign-in flow back to this page and says unsaved work would be lost', async () => {
    const user = userEvent.setup();
    mocks.create.mockRejectedValueOnce(new CommandError('unauthenticated', 401));
    renderNew();
    await fillMinimum(user, 'Título');
    await user.click(screen.getByRole('button', { name: 'Guardar rascunho' }));

    const alert = await screen.findByText('A sua sessão terminou.');
    const banner = alert.closest('.banner') as HTMLElement;
    expect(within(banner).getByText(/perdem-se ao sair desta página/)).toBeDefined();
    const link = within(banner).getByRole('link', { name: 'Entrar de novo' });
    expect(link.getAttribute('href')).toBe(
      `/partner/sign-in?redirectTo=${encodeURIComponent('/app/organizations/dlm/requests/new')}`,
    );
  });
});

describe('the default internal owner when settling a lost update', () => {
  const withOwner = (owner: string) => ({ completionCriteria: 'Feito.', internalOwnerProfileId: owner, priority: 'normal' as const });

  async function loseUpdateWithDefaultOwner(user: ReturnType<typeof userEvent.setup>) {
    // A draft with no internal details; the operator adds a criterion and leaves the
    // owner as "Eu", so the server fills it with the actor of this session.
    const onReload = renderExisting(aggregate(5, 'Antes'));
    await user.type(await screen.findByLabelText('Critério de conclusão'), 'Feito.');
    mocks.update.mockRejectedValueOnce(new CommandError('network', 0));
    await user.click(screen.getByRole('button', { name: 'Guardar rascunho' }));
    await screen.findByText('Não sabemos se a última gravação chegou ao servidor.');
    return onReload;
  }

  it('recognises its own write when the stored owner is this attempt’s actor', async () => {
    const user = userEvent.setup();
    await loseUpdateWithDefaultOwner(user);
    mocks.load.mockResolvedValueOnce(aggregate(6, 'Antes', withOwner('s-helio')));
    await user.click(screen.getByRole('button', { name: 'Verificar e guardar' }));
    expect(await screen.findByText('Rascunho guardado.')).toBeDefined();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('a concurrent change to the owner alone is a conflict, and later local edits do not overwrite it without a choice', async () => {
    const user = userEvent.setup();
    await loseUpdateWithDefaultOwner(user);
    // Same content, but another session set a different internal owner.
    mocks.load.mockResolvedValueOnce(aggregate(6, 'Antes', withOwner('s-other')));
    await user.click(screen.getByRole('button', { name: 'Verificar e guardar' }));
    expect(await screen.findByText('Este rascunho foi alterado noutra sessão.')).toBeDefined();
    expect(mocks.update).toHaveBeenCalledTimes(1);

    // The operator keeps editing and saves normally: it goes out at the revision the
    // form was based on, which the server refuses — the other owner is not replaced.
    const title = screen.getByLabelText('Título');
    await user.clear(title);
    await user.type(title, 'Depois');
    mocks.update.mockRejectedValueOnce(new CommandError('stale_revision', 409, { current_revision: 6 }));
    await user.click(screen.getByRole('button', { name: 'Guardar rascunho' }));
    expect(await screen.findByText('Este rascunho foi alterado noutra sessão.')).toBeDefined();
    const beforeChoice = mocks.update.mock.calls.map((call) => call[1] as number);
    expect(beforeChoice).toEqual([5, 5]); // never the current revision without a choice

    // Only the explicit choice writes at the server's current revision.
    mocks.update.mockResolvedValueOnce({ request_id: 'r1', revision: 7, status: 'draft', replayed: false });
    await user.click(screen.getByRole('button', { name: 'Substituir pela minha versão' }));
    await screen.findByText('Rascunho guardado.');
    const [, expected, payload] = mocks.update.mock.calls[2] as [string, number, DraftPayload];
    expect([expected, payload.title]).toEqual([6, 'Depois']);
  });
});
