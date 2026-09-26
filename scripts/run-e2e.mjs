#!/usr/bin/env node
/**
 * Runs the browser suite against the local Supabase stack.
 *
 * Reads the stack's keys from `supabase status` rather than asking anyone to paste
 * them, so `npm run e2e` works with no arguments once `npx supabase start` is up.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';

function stackEnv() {
  let raw;
  try {
    raw = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    console.error('The local Supabase stack is not running. Start it with:\n\n  npx supabase start\n');
    process.exit(1);
  }

  const values = {};
  for (const line of raw.split('\n')) {
    const match = /^([A-Z0-9_]+)="?([^"]*)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const status = stackEnv();
const required = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'];
const missing = required.filter((key) => !status[key]);
if (missing.length > 0) {
  console.error(`supabase status did not report ${missing.join(', ')}.`);
  process.exit(1);
}

const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_SUPABASE_URL: status.API_URL,
    E2E_SUPABASE_ANON_KEY: status.ANON_KEY,
    E2E_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    E2E_MAIL_URL: status.MAILPIT_URL ?? status.INBUCKET_URL ?? 'http://127.0.0.1:54424',
    // Local database, for the Request suites that hold row locks or set states no C2
    // command can reach yet. Never a remote URL: the helpers refuse anything else.
    E2E_DB_URL: status.DB_URL ?? '',
  },
});

process.exit(result.status ?? 1);
