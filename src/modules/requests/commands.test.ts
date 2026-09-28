import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } },
}));

import { CommandError, previewRequest } from './commands';

function respond(status: number, body: string | null) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } })));
}

async function failure(): Promise<CommandError> {
  try {
    await previewRequest('00000000-0000-0000-0000-000000000000');
  } catch (error) {
    if (error instanceof CommandError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

afterEach(() => vi.unstubAllGlobals());

describe('command client — authentication failures', () => {
  it('treats the gateway’s own 401 (not the function’s error shape) as an ended session', async () => {
    respond(401, JSON.stringify({ msg: 'Invalid JWT' }));
    const error = await failure();
    expect(error.code).toBe('unauthenticated');
    expect(error.ambiguous).toBe(false);
  });

  it('treats a 401 with no body as an ended session', async () => {
    respond(401, null);
    expect((await failure()).code).toBe('unauthenticated');
  });

  it('treats the function’s 401 as an ended session', async () => {
    respond(401, JSON.stringify({ error: { code: 'unauthenticated', message: 'Session is not valid.' } }));
    expect((await failure()).code).toBe('unauthenticated');
  });
});

describe('command client — definitive vs ambiguous outcomes', () => {
  it('a domain refusal is definitive and keeps its details', async () => {
    respond(409, JSON.stringify({ error: { code: 'stale_revision', details: { current_revision: 7 } } }));
    const error = await failure();
    expect(error.code).toBe('stale_revision');
    expect(error.ambiguous).toBe(false);
    expect(error.details).toEqual({ current_revision: 7 });
  });

  it('a lost connection is ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await failure();
    expect(error.code).toBe('network');
    expect(error.ambiguous).toBe(true);
  });

  it('a gateway 5xx without the function’s envelope is ambiguous', async () => {
    respond(504, 'upstream timed out');
    const error = await failure();
    expect(error.ambiguous).toBe(true);
  });

  it('a 2xx without the function’s envelope confirms nothing', async () => {
    respond(200, JSON.stringify({ unexpected: true }));
    expect((await failure()).ambiguous).toBe(true);
  });
});

describe('command client — C3 routes and bodies', () => {
  it('sends a submission to the partner function, with the round and the attempt id, never an actor', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { replayed: false } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { submitRequest } = await import('./commands');
    await submitRequest('r-1', 's-1', null, { answers: [{ field_id: 'f-1', value: false }] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/partner-request-commands\/submit$/);
    expect(JSON.parse(String(init.body))).toEqual({
      request_id: 'r-1', submission_id: 's-1', expected_return_id: null, answers: [{ field_id: 'f-1', value: false }],
    });
  });

  it('sends return and complete to the staff function with the reviewed revision', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { returnRequestToPartner, completeRequest } = await import('./commands');
    await returnRequestToPartner('r-1', 7, 'ret-1', 'text', 'Falta só isto.');
    await completeRequest('r-1', 8);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toMatch(/\/functions\/v1\/request-commands\/return$/);
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({
      request_id: 'r-1', expected_revision: 7, return_id: 'ret-1', response_type: 'text', message: 'Falta só isto.',
    });
    expect(calls[1]?.[0]).toMatch(/\/functions\/v1\/request-commands\/complete$/);
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({ request_id: 'r-1', expected_revision: 8 });
  });

  it('carries stale_round as a definitive answer, not an uncertain one', async () => {
    respond(409, JSON.stringify({ error: { code: 'stale_round', message: 'stale_round', details: { current_return_id: 'x' } } }));
    const error = await failure();
    expect(error.code).toBe('stale_round');
    expect(error.ambiguous).toBe(false);
  });
});
