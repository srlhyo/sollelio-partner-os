/**
 * "Cancelar pedido" (C4): available only for open Requests, never one click, a required
 * reason, the revision on screen, and the page reads the Request again afterwards.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CommandsModule from '../../modules/requests/commands';
import type { RequestStatus } from '../../modules/requests/types';

const mocks = vi.hoisted(() => ({ cancel: vi.fn() }));

vi.mock('../../modules/requests/commands', async () => {
  const actual = await vi.importActual<typeof CommandsModule>('../../modules/requests/commands');
  return { ...actual, cancelRequest: mocks.cancel };
});

import { CommandError } from '../../modules/requests/commands';
import { isCancellable } from '../../modules/requests/types';
import { CancelRequest } from './CancelRequest';

function renderCancel(status: RequestStatus, revision: number | null = 4) {
  const onDone = vi.fn();
  render(
    <MemoryRouter>
      <CancelRequest requestId="r1" status={status} revision={revision} assigneeName="Nádia" onDone={onDone} />
    </MemoryRouter>,
  );
  return { onDone };
}

beforeEach(() => {
  mocks.cancel.mockReset();
});

describe('availability', () => {
  it.each([
    ['draft', true], ['needs_partner', true], ['needs_sollelio', true], ['completed', false], ['cancelled', false],
  ] as const)('%s → cancellable: %s', (status, can) => {
    expect(isCancellable(status)).toBe(can);
    renderCancel(status);
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' }) !== null).toBe(can);
  });
});

describe('confirmation', () => {
  it('is never one click: it opens a panel that says it is final and names what the partner will read', async () => {
    const user = userEvent.setup();
    renderCancel('needs_partner');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido' }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(screen.getByText(/O cancelamento é definitivo/)).toBeDefined();
    expect(screen.getByText(/Nádia deixa de o ver em “Precisa de si” e lê o motivo/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Manter pedido' }));
    expect(screen.getByRole('button', { name: 'Cancelar pedido' })).toBeDefined();
  });

  it('requires a reason and sends it trimmed, with the revision on screen', async () => {
    const user = userEvent.setup();
    mocks.cancel.mockResolvedValue({ request_id: 'r1', revision: 5, status: 'cancelled', replayed: false });
    const { onDone } = renderCancel('needs_sollelio');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));
    expect(screen.getByText('Escreva o motivo do cancelamento.')).toBeDefined();
    expect(mocks.cancel).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Motivo do cancelamento'), '  O evento foi adiado.  ');
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Pedido cancelado.'));
    expect(mocks.cancel).toHaveBeenCalledWith('r1', 4, 'O evento foi adiado.');
  });

  it('a Request that changed meanwhile is not cancelled blindly: it offers to reload', async () => {
    const user = userEvent.setup();
    mocks.cancel.mockImplementation(async () => {
      throw new CommandError('stale_revision', 409);
    });
    const { onDone } = renderCancel('needs_partner');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido' }));
    await user.type(screen.getByLabelText('Motivo do cancelamento'), 'x');
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));
    expect(await screen.findByText(/alterado entretanto/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Recarregar o pedido' }));
    expect(onDone).toHaveBeenCalledWith('');
  });

  it('an uncertain outcome is settled by reading the Request again, never by sending twice', async () => {
    const user = userEvent.setup();
    mocks.cancel.mockImplementation(async () => {
      throw new CommandError('network', 0);
    });
    const { onDone } = renderCancel('needs_partner');
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido' }));
    await user.type(screen.getByLabelText('Motivo do cancelamento'), 'x');
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Não tivemos confirmação: mostramos o estado actual do pedido.'));
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it('cannot confirm without a known revision', async () => {
    const user = userEvent.setup();
    renderCancel('draft', null);
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido' }));
    expect(screen.getByRole('button', { name: 'Confirmar cancelamento' })).toHaveProperty('disabled', true);
  });
});
