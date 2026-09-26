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
