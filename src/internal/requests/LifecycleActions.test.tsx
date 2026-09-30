/**
 * Staff next steps while a Request waits on Sollelio (C3): complete after an explicit
 * confirmation, or return with a required message and a response type. Both send the
 * revision being looked at; a return's uncertain outcome repeats the same attempt.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CommandsModule from '../../modules/requests/commands';
import type { InternalRequest } from '../../modules/requests/types';

const mocks = vi.hoisted(() => ({ ret: vi.fn(), complete: vi.fn() }));

vi.mock('../../modules/requests/commands', async () => {
  const actual = await vi.importActual<typeof CommandsModule>('../../modules/requests/commands');
  return { ...actual, returnRequestToPartner: mocks.ret, completeRequest: mocks.complete };
});

import { CommandError } from '../../modules/requests/commands';
import { LifecycleActions } from './LifecycleActions';

const request = {
  id: 'r1', organizationId: 'o1', productId: null, resourceId: null, type: 'question', status: 'needs_sollelio',
  nextActor: 'sollelio', title: 'Foi fácil?', context: null, requestedAction: 'Diga-nos.', estimatedEffortMinutes: 3,
  assigneeProfileId: 'p1', dueAt: null, createdBy: 's1', createdAt: 'x', publishedAt: 'x', updatedAt: 'x', revision: 9, cancelledAt: null, cancellationReason: null,
  internal: null,
} satisfies InternalRequest;

function renderActions() {
  const onDone = vi.fn();
  render(
    <MemoryRouter>
      <LifecycleActions request={request} assigneeName="Nádia" onDone={onDone} />
    </MemoryRouter>,
  );
  return { onDone };
}

beforeEach(() => {
  mocks.ret.mockReset();
  mocks.complete.mockReset();
});

describe('complete', () => {
  it('asks for confirmation, then completes at the revision being looked at', async () => {
    const user = userEvent.setup();
    mocks.complete.mockResolvedValue({});
    const { onDone } = renderActions();
    await user.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(mocks.complete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar conclusão' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Pedido concluído.'));
    expect(mocks.complete).toHaveBeenCalledWith('r1', 9);
  });

  it('a changed Request offers to reload instead of acting', async () => {
    const user = userEvent.setup();
    mocks.complete.mockRejectedValue(new CommandError('stale_revision', 409));
    renderActions();
    await user.click(screen.getByRole('button', { name: 'Concluir' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar conclusão' }));
    expect(await screen.findByText(/alterado entretanto/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recarregar o pedido' })).toBeDefined();
  });
});

describe('return to the partner', () => {
  it('requires a message and a response type; sends nothing vague', async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(screen.getByRole('button', { name: 'Devolver à parceira' }));
    await user.click(screen.getByRole('button', { name: 'Devolver a Nádia' }));
    expect(mocks.ret).not.toHaveBeenCalled();
    expect(screen.getByText('Escreva o que falta, para a parceira ler.')).toBeDefined();
    expect(screen.getByText('Escolha o tipo de resposta: texto ou aprovação.')).toBeDefined();
  });

  it('returns with the message, the type and the revision; an uncertain outcome repeats the same return', async () => {
    const user = userEvent.setup();
    mocks.ret.mockRejectedValueOnce(new CommandError('network', 0)).mockResolvedValueOnce({ replayed: true });
    const { onDone } = renderActions();
    await user.click(screen.getByRole('button', { name: 'Devolver à parceira' }));
    await user.type(screen.getByLabelText(/O que ainda falta/), '  Falta confirmar no telemóvel.  ');
    await user.click(screen.getByRole('radio', { name: 'Texto' }));
    await user.click(screen.getByRole('button', { name: 'Devolver a Nádia' }));

    expect(await screen.findByText('Não sabemos se a devolução chegou.')).toBeDefined();
    expect(screen.getByLabelText(/O que ainda falta/).matches(':disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Verificar e repetir' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    const [first, second] = mocks.ret.mock.calls as unknown[][];
    expect(first).toEqual(['r1', 9, expect.any(String), 'text', 'Falta confirmar no telemóvel.']);
    expect(second).toEqual(first); // same return id: the server replays, never a second return
  });
});
