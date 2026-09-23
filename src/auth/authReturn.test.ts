import { describe, expect, it, vi } from 'vitest';
import { classifyAuthReturn, isAuthLinkFailure } from './authReturn';

/** What Supabase actually sends back, observed against the real stack. */
const CONSUMED_LINK_HASH =
  '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=';

describe('classifyAuthReturn', () => {
  it('sees nothing on an ordinary page load', () => {
    expect(classifyAuthReturn('', '')).toEqual({ kind: 'none' });
    expect(classifyAuthReturn('?org=do-luxo-a-mesa', '')).toEqual({ kind: 'none' });
  });

  it('recognises a link that carried credentials', () => {
    expect(classifyAuthReturn('?code=abc123', '')).toEqual({ kind: 'pending', via: 'code' });
    expect(classifyAuthReturn('', '#access_token=xyz&token_type=bearer')).toEqual({
      kind: 'pending',
      via: 'token',
    });
  });

  it('classifies a consumed or expired link from its error code, not its prose', () => {
    expect(classifyAuthReturn('', CONSUMED_LINK_HASH)).toEqual({
      kind: 'link-failure',
      reason: 'otp_expired',
    });
  });

  it('reads the parameters from the query string too', () => {
    expect(classifyAuthReturn('?error=access_denied&error_code=otp_expired', '')).toEqual({
      kind: 'link-failure',
      reason: 'otp_expired',
    });
  });

  it('treats the PKCE failures of a link opened elsewhere as link failures', () => {
    for (const code of ['flow_state_not_found', 'flow_state_expired', 'bad_code_verifier']) {
      expect(classifyAuthReturn(`?error=invalid_request&error_code=${code}`, '')).toEqual({
        kind: 'link-failure',
        reason: code,
      });
    }
  });

  it('does not claim unrelated failures are the link', () => {
    for (const code of ['server_error', 'unexpected_failure', 'validation_failed', 'over_email_send_rate_limit']) {
      expect(classifyAuthReturn(`?error=server_error&error_code=${code}`, '')).toEqual({
        kind: 'other-failure',
        reason: code,
      });
    }
  });

  it('falls back to the OAuth-level error when no specific code is given', () => {
    expect(classifyAuthReturn('?error=access_denied', '')).toEqual({
      kind: 'link-failure',
      reason: 'access_denied',
    });
    expect(classifyAuthReturn('?error=server_error', '')).toEqual({
      kind: 'other-failure',
      reason: 'server_error',
    });
  });
});

describe('isAuthLinkFailure', () => {
  it('is true when Supabase said the link is unusable', () => {
    expect(isAuthLinkFailure(classifyAuthReturn('', CONSUMED_LINK_HASH), true)).toBe(true);
  });

  it('is true when a code came back but no session could be made from it', () => {
    // A link opened in a different browser: the code is valid, the verifier is not here.
    expect(isAuthLinkFailure({ kind: 'pending', via: 'code' }, true)).toBe(true);
  });

  it('is false while that same code is still being exchanged successfully', () => {
    expect(isAuthLinkFailure({ kind: 'pending', via: 'code' }, false)).toBe(false);
  });

  it('is false for an ordinary signed-out visit', () => {
    expect(isAuthLinkFailure({ kind: 'none' }, true)).toBe(false);
  });

  it('is false for failures that are not the link', () => {
    expect(isAuthLinkFailure({ kind: 'other-failure', reason: 'server_error' }, true)).toBe(false);
  });
});

describe('once a session has existed on this page load', () => {
  it('stops blaming the link for anything that happens next', async () => {
    // Re-imported in isolation so the module-level flag starts clean.
    vi.resetModules();
    const mod = await import('./authReturn');

    expect(mod.isAuthLinkFailure({ kind: 'pending', via: 'code' }, true)).toBe(true);

    mod.markAuthReturnResolved();

    // Arriving by magic link and then signing out is not a broken link.
    expect(mod.getAuthReturn()).toEqual({ kind: 'none' });
    expect(mod.isAuthLinkFailure(mod.getAuthReturn(), true)).toBe(false);
  });
});
