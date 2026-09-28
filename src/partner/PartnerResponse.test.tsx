/**
 * The partner's response (C3): real controls, one attempt at a time, the same attempt
 * repeated when the outcome is uncertain, and nothing kept outside memory.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CommandsModule from '../modules/requests/commands';
import type { PartnerRequestRecord, RequestFieldRecord, CurrentRound } from '../modules/requests/types';

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock('../modules/requests/commands', async () => {
  const actual = await vi.importActual<typeof CommandsModule>('../modules/requests/commands');
  return { ...actual, submitRequest: mocks.submit };
});

import { CommandError } from '../modules/requests/commands';
import { PartnerResponse } from './PartnerResponse';

const request: PartnerRequestRecord = {
  id: 'r1', organization_id: 'o1', product_id: null, product_name: null, type: 'question', title: 'Foi fácil?',
  context: null, requested_action: 'Diga-nos.', estimated_effort_minutes: 3, due_at: null, partner_state: 'needs_you',
  published_at: '2026-09-28T10:00:00Z', completed_at: null, cancelled_at: null, related_update_id: null, resource_id: null,
};

const field = (patch: Partial<RequestFieldRecord>): RequestFieldRecord => ({
  id: patch.key ?? 'f', request_id: 'r1', key: 'q1', label: 'Pergunta', help_text: null, type: 'long_text',
  required: true, options: null, sort_order: 1, system_generated: false, ...patch,
});

const fields = [
  field({ id: 'f-text', key: 'q1', label: 'O que achou?', type: 'long_text' }),
  field({ id: 'f-bool', key: 'q2', label: 'Conseguiu?', type: 'boolean', sort_order: 2 }),
];

const ok = { request_id: 'r1', submission_id: 'x', return_id: null, status: 'needs_sollelio', revision: 3, submitted_at: 'now', replayed: false };

function renderResponse(props: { round?: CurrentRound; fields?: RequestFieldRecord[]; req?: PartnerRequestRecord } = {}) {
  const onDone = vi.fn();
  const onChanged = vi.fn();
  render(
    <MemoryRouter initialEntries={['/partner/requests/r1']}>
      <PartnerResponse
        request={props.req ?? request}
        fields={props.fields ?? fields}
        round={props.round ?? { kind: 'initial' }}
        onDone={onDone}
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );
  return { onDone, onChanged };
}

let storageWrites: string[] = [];
beforeEach(() => {
  mocks.submit.mockReset();
  storageWrites = [];
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
    storageWrites.push(key);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  // Answers are never written to browser storage, whatever happened.
  expect(storageWrites).toEqual([]);
});

describe('initial round', () => {
  it('renders one real control per field and names what is missing before sending anything', async () => {
    const user = userEvent.setup();
    renderResponse();
    expect(screen.getByLabelText('O que achou?')).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Sim' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByText('Escreva a sua resposta.')).toBeDefined();
    expect(screen.getByText('Escolha uma opção.')).toBeDefined();
  });

  it('sends false as an answer, locks the form while sending, and ignores a second click', async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    mocks.submit.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { onDone } = renderResponse();
    await user.type(screen.getByLabelText('O que achou?'), '  Bem.  ');
    await user.click(screen.getByRole('radio', { name: 'Não' }));
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    expect(screen.getByRole('button', { name: 'A enviar…' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('O que achou?').matches(':disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'A enviar…' }));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const [requestId, submissionId, expectedReturnId, body] = mocks.submit.mock.calls[0] as unknown[];
    expect(requestId).toBe('r1');
    expect(typeof submissionId).toBe('string');
    expect(expectedReturnId).toBeNull();
    expect(body).toEqual({ answers: [{ field_id: 'f-text', value: 'Bem.' }, { field_id: 'f-bool', value: false }] });

    await act(async () => resolve(ok));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(ok));
  });

  it('an uncertain outcome keeps the answers and repeats exactly the same attempt', async () => {
    const user = userEvent.setup();
    mocks.submit.mockRejectedValueOnce(new CommandError('network', 0)).mockResolvedValueOnce({ ...ok, replayed: true });
    const { onDone } = renderResponse();
    await user.type(screen.getByLabelText('O que achou?'), 'Bem.');
    await user.click(screen.getByRole('radio', { name: 'Sim' }));
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    expect(await screen.findByText('Não sabemos se a sua resposta chegou.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Enviar resposta' })).toBeNull();
    expect((screen.getByLabelText('O que achou?') as HTMLTextAreaElement).value).toBe('Bem.');
    expect(screen.getByLabelText('O que achou?').matches(':disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Tentar enviar de novo' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [first, second] = mocks.submit.mock.calls as unknown[][];
    expect(second).toEqual(first); // same id, same round, same body
  });

  it('a rejection keeps the answers and shows the server’s field errors', async () => {
    const user = userEvent.setup();
    mocks.submit.mockRejectedValueOnce(new CommandError('validation_failed', 422, {
      errors: [{ field: 'answers.f-text', code: 'too_long', message: 'No máximo 4000 caracteres.' }],
    }));
    renderResponse();
    await user.type(screen.getByLabelText('O que achou?'), 'Bem.');
    await user.click(screen.getByRole('radio', { name: 'Sim' }));
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    expect(await screen.findByText('No máximo 4000 caracteres.')).toBeDefined();
    expect((screen.getByLabelText('O que achou?') as HTMLTextAreaElement).value).toBe('Bem.');
    expect(screen.getByRole('button', { name: 'Enviar resposta' })).toHaveProperty('disabled', false);
  });

  it('a changed Request (stale round) is handed back to the page to reload', async () => {
    const user = userEvent.setup();
    mocks.submit.mockRejectedValueOnce(new CommandError('stale_round', 409));
    const { onChanged } = renderResponse({ fields: [] });
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('an ended session is explained, with no redirect, and says unsent answers are lost on leaving', async () => {
    const user = userEvent.setup();
    mocks.submit.mockRejectedValueOnce(new CommandError('unauthenticated', 401));
    renderResponse();
    await user.type(screen.getByLabelText('O que achou?'), 'Bem.');
    await user.click(screen.getByRole('radio', { name: 'Sim' }));
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    expect(await screen.findByText('A sua sessão terminou.')).toBeDefined();
    expect(screen.getByText(/perdem-se ao sair desta página/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Entrar de novo' }).getAttribute('href')).toBe(
      `/partner/sign-in?redirectTo=${encodeURIComponent('/partner/requests/r1')}`,
    );
    expect((screen.getByLabelText('O que achou?') as HTMLTextAreaElement).value).toBe('Bem.');
  });

  it('approval: notes appear only after “Precisa de alterações” and are not sent with “Aprovar”', async () => {
    const user = userEvent.setup();
    mocks.submit.mockResolvedValue(ok);
    renderResponse({
      req: { ...request, type: 'approval' },
      fields: [
        field({ id: 'ap', key: 'approval', label: 'A sua decisão', type: 'approval', system_generated: true, options: ['approve', 'needs_changes'] }),
        field({ id: 'nt', key: 'approval_notes', label: 'O que deve mudar?', system_generated: true, required: false, sort_order: 2 }),
      ],
    });
    expect(screen.queryByLabelText(/O que deve mudar/)).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Precisa de alterações' }));
    await user.type(screen.getByLabelText(/O que deve mudar/), 'Mudem a cor.');
    await user.click(screen.getByRole('radio', { name: 'Aprovar' }));
    expect(screen.queryByLabelText(/O que deve mudar/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Enviar decisão' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[3]).toEqual({ answers: [{ field_id: 'ap', value: 'approve' }] });
  });
});

describe('returned round', () => {
  const ret = { id: 'ret-1', request_id: 'r1', response_type: 'text' as const, message: 'Falta confirmar no telemóvel.', created_at: 'x' };

  it('asks only the new question — “Falta só isto” — never the original form', async () => {
    const user = userEvent.setup();
    mocks.submit.mockResolvedValue(ok);
    renderResponse({ round: { kind: 'returned', ret } });
    expect(screen.getByText('Falta só isto')).toBeDefined();
    expect(screen.getByText('Falta confirmar no telemóvel.')).toBeDefined();
    expect(screen.queryByLabelText('O que achou?')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByText('Escreva a sua resposta.')).toBeDefined();

    await user.type(screen.getByLabelText('A sua resposta'), '  Sim, também.  ');
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    const [, , expectedReturnId, body] = mocks.submit.mock.calls[0] as unknown[];
    expect(expectedReturnId).toBe('ret-1');
    expect(body).toEqual({ response: { text: 'Sim, também.' } });
  });

  it('a returned approval round asks for a new decision, notes only with “Precisa de alterações”', async () => {
    const user = userEvent.setup();
    mocks.submit.mockResolvedValue(ok);
    renderResponse({ round: { kind: 'returned', ret: { ...ret, response_type: 'approval', message: 'Corrigido. Pode aprovar?' } } });
    await user.click(screen.getByRole('radio', { name: 'Precisa de alterações' }));
    await user.type(screen.getByLabelText(/O que deve mudar/), 'Ainda falta o logótipo.');
    await user.click(screen.getByRole('button', { name: 'Enviar decisão' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[3]).toEqual({ response: { decision: 'needs_changes', notes: 'Ainda falta o logótipo.' } });
  });
});
