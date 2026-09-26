/**
 * Helpers for the Slice 2 C2 suites, against the LOCAL stack only.
 *
 * Synthetic people are created through the Admin API with a random password, and
 * sessions come from the real Auth password grant — nothing is decoded or forged.
 * `psql` reaches the local database for the two things no C2 command can do yet:
 * holding a row lock across a publication, and moving a synthetic Request into the
 * states C3/C4 will own. It refuses any URL that is not 127.0.0.1.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { ANON_KEY, DB_URL, SERVICE_ROLE_KEY, SUPABASE_URL } from './env';

function assertLocal(url: string, what: string) {
  const host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`${what} is not local (${host}). These suites only run against the local stack.`);
  }
}

export function localAdmin(): SupabaseClient {
  assertLocal(SUPABASE_URL, 'The Supabase API');
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const runTag = () => `c2e2e${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

export interface Person {
  email: string;
  password: string;
  authUserId: string;
  profileId: string | null;
  token: string;
}

export async function createPerson(
  admin: SupabaseClient,
  email: string,
  options: { staff?: boolean; profile?: boolean; displayName: string },
): Promise<Person> {
  const password = `${randomBytes(18).toString('base64url')}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  let profileId: string | null = null;
  if (options.profile !== false) {
    const { data: row, error: profileError } = await admin
      .from('profiles')
      .insert({ auth_user_id: data.user.id, display_name: options.displayName, is_sollelio_staff: options.staff ?? false })
      .select('id')
      .single();
    if (profileError) throw new Error(`profile ${email}: ${profileError.message}`);
    profileId = row.id;
  }
  const token = await passwordToken(email, password);
  return { email, password, authUserId: data.user.id, profileId, token };
}

export async function passwordToken(email: string, password: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`No session for ${email} (HTTP ${response.status}).`);
  return body.access_token;
}

export interface Reply {
  status: number;
  body: { data?: Record<string, unknown>; error?: { code: string; details?: { errors?: { field: string; code: string }[] } } } & Record<string, unknown>;
}

export async function command(token: string | null, action: string, body: unknown): Promise<Reply> {
  const headers: Record<string, string> = { apikey: ANON_KEY, 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${SUPABASE_URL}/functions/v1/request-commands/${action}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  let parsed: unknown = {};
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  return { status: response.status, body: parsed as Reply['body'] };
}

/** A PostgREST call as a person (or anon when token is null). */
export async function rest(token: string | null, path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { apikey: ANON_KEY, 'content-type': 'application/json', ...(init.headers as Record<string, string>) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body: body as unknown };
}

/** One statement against the local database, as the local superuser. */
export function sql(statement: string): string {
  assertLocal(DB_URL, 'The database');
  const result = spawnSync('psql', [DB_URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`psql: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Opens a transaction, runs `statement` inside it and keeps it open, holding its
 * row locks, until `release()` commits.
 */
export async function holdInTransaction(statement: string): Promise<{ release: () => Promise<void> }> {
  assertLocal(DB_URL, 'The database');
  const child = spawn('psql', [DB_URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const marker = `held-${randomUUID()}`;
  await new Promise<void>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes(marker)) resolve();
    });
    child.stderr.on('data', (chunk: Buffer) => reject(new Error(chunk.toString())));
    child.stdin.write(`begin;\n${statement};\nselect '${marker}';\n`);
  });
  return {
    release: () =>
      new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
        child.stdin.write('commit;\n\\q\n');
      }),
  };
}

export const newId = () => randomUUID();
