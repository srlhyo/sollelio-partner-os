/**
 * The client-bundle gate, tested against the credential classes it exists to stop.
 *
 * Every value here is synthetic. No real credential appears in this repository.
 *
 * The case that motivated this file: a production deploy was built with a
 * `sb_secret_…` key in the browser configuration. The gate passed, and the failure
 * surfaced in production as "Forbidden use of secret API key in browser".
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { scanText } from './lib/client-secret-scan.mjs';

/** A syntactically real JWT with the given role, and a signature that is not one. */
function syntheticJwt(role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role, exp: 2000000000 })}.c3ludGhldGljLXNpZ25hdHVyZQ`;
}

const SECRET_KEY = 'sb_secret_SYNTHETIC0000NOTAREALKEY00';
const PUBLISHABLE_KEY = 'sb_publishable_SYNTHETIC0000NOTAREALKEY00';

describe('credentials that must never reach the browser', () => {
  it('1. rejects a Supabase secret API key', () => {
    const reasons = scanText(`const k="${SECRET_KEY}";`);
    expect(reasons.join(' ')).toMatch(/sb_secret_/);
  });

  it('2. rejects a service-role JWT', () => {
    const reasons = scanText(`const k="${syntheticJwt('service_role')}";`);
    expect(reasons.join(' ')).toMatch(/service_role/);
  });

  it('also rejects a supabase_admin JWT', () => {
    expect(scanText(`const k="${syntheticJwt('supabase_admin')}";`).length).toBeGreaterThan(0);
  });

  it('also rejects a personal access token and a password-bearing DB URL', () => {
    expect(scanText(`const t="sbp_${'a'.repeat(40)}";`).length).toBeGreaterThan(0);
    expect(
      scanText('const u="postgresql://postgres.abc:hunter2@aws-1.pooler.supabase.com:5432/postgres";')
        .length,
    ).toBeGreaterThan(0);
  });

  it('rejects our own secret identifiers being referenced at all', () => {
    expect(scanText('process.env.SUPABASE_SERVICE_ROLE_KEY').length).toBeGreaterThan(0);
    expect(scanText('PARTNER_OS_INTEGRATION_SECRET').length).toBeGreaterThan(0);
  });

  it('rejects a secret value even inside a source map', () => {
    // A key embedded in a map is just as leaked as one in the bundle.
    expect(scanText(`{"sourcesContent":["const k='${SECRET_KEY}'"]}`, 'sourcemap').length)
      .toBeGreaterThan(0);
  });
});

describe('credentials the browser is supposed to carry', () => {
  it('3. accepts a publishable key', () => {
    expect(scanText(`const k="${PUBLISHABLE_KEY}";`)).toEqual([]);
  });

  it('4. accepts an anon JWT, and an authenticated one', () => {
    expect(scanText(`const k="${syntheticJwt('anon')}";`)).toEqual([]);
    expect(scanText(`const k="${syntheticJwt('authenticated')}";`)).toEqual([]);
  });
});

describe('vendor source, which legitimately names these things', () => {
  it('does not flag supabase-js own guard, in the bundle or the map', () => {
    // @supabase/supabase-js ships `key.startsWith('sb_secret_')`; it reaches both.
    const vendor = "const isNewFormat = key.startsWith('sb_publishable_') || key.startsWith('sb_secret_')";
    expect(scanText(vendor, 'emitted')).toEqual([]);
    expect(scanText(vendor, 'sourcemap')).toEqual([]);
  });

  it('does not flag service_role documented in vendor prose inside a map', () => {
    const prose = '/** Never expose your `service_role` key in the browser. */';
    expect(scanText(prose, 'sourcemap')).toEqual([]);
    // In executable output the same string is a real signal.
    expect(scanText(prose, 'emitted').length).toBeGreaterThan(0);
  });
});

describe('the checker end to end, on a directory', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function runCheckerOn(contents) {
    dir = mkdtempSync(join(tmpdir(), 'bundle-check-'));
    writeFileSync(join(dir, 'index.js'), contents);
    try {
      execFileSync('node', ['scripts/check-client-bundle.mjs', dir], { encoding: 'utf8' });
      return { code: 0 };
    } catch (error) {
      return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  }

  it('exits non-zero on a bundle carrying a secret key', () => {
    const result = runCheckerOn(`const k="${SECRET_KEY}";`);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/sb_secret_/);
  });

  it('5. exits zero on a bundle carrying only browser-safe credentials', () => {
    expect(runCheckerOn(`const k="${PUBLISHABLE_KEY}";const j="${syntheticJwt('anon')}";`).code)
      .toBe(0);
  });
});
