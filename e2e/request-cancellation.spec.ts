/**
 * Slice 2 C4 — Request cancellation at the API boundary, against the real local stack:
 * real GoTrue sessions, the real `request-commands` and `partner-request-commands`
 * Edge Functions, real PostgREST and RLS. Races are genuine: a held row lock makes
 * two commands contend for one Request.
 *
 * Every person, organization and Request is synthetic and belongs to this run.
 */
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  command, createPerson, holdInTransaction, localAdmin, newId, partnerCommand, rest, runTag, sql, type Person,
} from './helpers/requests';
import { ANON_KEY } from './helpers/env';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseClient;
let tag: string;
let S: Person; // staff
let A: Person; // the assignee, active member of O1
let B: Person; // another active member of O1
let X: Person; // member of O2
let N: Person; // auth user without a profile
const org = { O1: '', O2: '' };

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select('id').single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as { id: string }).id;
}

const count = (statement: string) => Number(sql(statement));
const revision = (id: string) => Number(sql(`select revision from public.requests where id = '${id}'`));
const cancel = (token: string | null, id: string, expected: unknown, reason: unknown = 'O evento foi adiado.') =>
  command(token, 'cancel', { request_id: id, expected_revision: expected, reason });

/** A draft (C2 create), returning its id. */
async function draft(title: string): Promise<string> {
  const id = newId();
  const payload = {
    organization_id: org.O1, assignee_profile_id: A.profileId, type: 'task', title: `${title} ${tag}`,
    requested_action: 'Faça isto.', estimated_effort_minutes: 3, internal: { completion_criteria: 'Feito.' },
  };
  expect((await command(S.token, 'create', { request_id: id, payload })).status).toBe(200);
  return id;
}

/** A published task Request, waiting on the partner. */
async function published(title: string): Promise<string> {
  const id = await draft(title);
  const preview = await command(S.token, 'preview', { request_id: id });
  const publish = await command(S.token, 'publish', {
    request_id: id, expected_revision: preview.body.data?.revision, idempotency_key: newId(),
  });
  expect(publish.status, JSON.stringify(publish.body)).toBe(200);
  return id;
}

const submit = (id: string, submissionId = newId()) =>
  partnerCommand(A.token, 'submit', { request_id: id, submission_id: submissionId, expected_return_id: null, answers: [] });

const partnerRow = async (token: string, id: string) =>
  ((await rest(token, `partner_requests?select=*&id=eq.${id}`)).body as Record<string, unknown>[])[0];

test.beforeAll(async () => {
  admin = localAdmin();
  tag = runTag();
  org.O1 = await insert('organizations', { name: `${tag} org 1`, slug: `${tag}-org-1` });
  org.O2 = await insert('organizations', { name: `${tag} org 2`, slug: `${tag}-org-2` });
  S = await createPerson(admin, `${tag}-staff@example.test`, { staff: true, displayName: `${tag} staff` });
  A = await createPerson(admin, `${tag}-a@example.test`, { displayName: `${tag} A` });
  B = await createPerson(admin, `${tag}-b@example.test`, { displayName: `${tag} B` });
  X = await createPerson(admin, `${tag}-x@example.test`, { displayName: `${tag} X` });
  N = await createPerson(admin, `${tag}-n@example.test`, { profile: false, displayName: 'none' });
  await insert('organization_memberships', { organization_id: org.O1, profile_id: A.profileId });
  await insert('organization_memberships', { organization_id: org.O1, profile_id: B.profileId });
  await insert('organization_memberships', { organization_id: org.O2, profile_id: X.profileId });
});

test('only staff can cancel; nothing else reaches the cancellation', async () => {
  const id = await published('Gate');
  const rev = revision(id);
  expect((await cancel(null, id, rev)).status).toBe(401);
  expect((await cancel(ANON_KEY, id, rev)).status).toBe(401);
  expect((await cancel('not-a-token', id, rev)).status).toBe(401);
  const noProfile = await cancel(N.token, id, rev);
  expect([noProfile.status, noProfile.body.error?.code]).toEqual([403, 'no_profile']);
  for (const [who, person] of [['assignee', A], ['colleague', B], ['other organization', X]] as const) {
    const reply = await cancel(person.token, id, rev);
    expect([reply.status, reply.body.error?.code], who).toEqual([403, 'not_staff']);
  }
  // The partner function has no cancel.
  expect((await partnerCommand(A.token, 'cancel', { request_id: id, expected_revision: rev, reason: 'x' })).status).toBe(404);

  // No direct path: the row, the column and the SQL command are closed to API roles.
  for (const token of [A.token, S.token]) {
    const patch = await rest(token, `requests?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled', next_actor: 'none', cancelled_at: new Date().toISOString(), cancellation_reason: 'x' }),
    });
    expect([401, 403]).toContain(patch.status);
    const rpc = await rest(token, 'rpc/cmd_cancel_request', {
      method: 'POST', body: JSON.stringify({ p_actor: S.profileId, p_request_id: id, p_expected_revision: rev, p_reason: 'x' }),
    });
    expect([401, 403]).toContain(rpc.status);
    expect((rpc.body as { code?: string }).code).toBe('42501');
  }
  expect(sql(`select status from public.requests where id = '${id}'`)).toBe('needs_partner');
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.cancelled'`)).toBe(0);
});

test('the body is checked: shape, revision and a real reason', async () => {
  const id = await published('Validação');
  const rev = revision(id);
  const errors = (reply: Awaited<ReturnType<typeof cancel>>) =>
    [reply.status, reply.body.error?.code, ...(reply.body.error?.details?.errors ?? []).map((e) => `${e.field}:${e.code}`)];

  expect(errors(await command(S.token, 'cancel', { request_id: id, expected_revision: rev }))).toEqual([422, 'validation_failed', 'reason:required']);
  expect(errors(await cancel(S.token, id, rev, '   \n '))).toEqual([422, 'validation_failed', 'reason:required']);
  expect(errors(await cancel(S.token, id, rev, '\r\n\t\u00a0\u3000'))).toEqual([422, 'validation_failed', 'reason:required']);
  expect(errors(await cancel(S.token, id, rev, 42))).toEqual([422, 'validation_failed', 'reason:required']);
  expect(errors(await cancel(S.token, id, rev, 'x'.repeat(2001)))).toEqual([422, 'validation_failed', 'reason:too_long']);
  expect(errors(await cancel(S.token, id, 'um'))).toEqual([422, 'validation_failed', 'expected_revision:invalid']);
  expect(errors(await command(S.token, 'cancel', { request_id: id, expected_revision: rev, reason: 'x', idempotency_key: newId() })))
    .toEqual([422, 'validation_failed', 'idempotency_key:unknown_field']);
  expect(errors(await cancel(S.token, newId(), 1))).toEqual([404, 'not_found']);
  expect(errors(await cancel(S.token, id, rev - 1))).toEqual([409, 'stale_revision']);
  expect(sql(`select status from public.requests where id = '${id}'`)).toBe('needs_partner');

  // 2000 characters is the limit, after trimming every kind of whitespace at the ends.
  const ok = await cancel(S.token, id, rev, `\n\t \u00a0${'y'.repeat(2000)}\r\n  `);
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.data?.status).toBe('cancelled');
  expect(ok.body.data?.revision).toBe(rev + 1);
  expect(count(`select length(cancellation_reason) from public.requests where id = '${id}'`)).toBe(2000);
});

test('a draft is cancelled without ever reaching the partner, and nothing edits it afterwards', async () => {
  const id = await draft('Rascunho');
  const reply = await cancel(S.token, id, revision(id), 'Afinal não é preciso.');
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  expect(sql(`select status || '/' || next_actor || '/' || (cancelled_at is not null) || '/' || (published_at is null) from public.requests where id = '${id}'`))
    .toBe('cancelled/none/true/true');
  expect(await partnerRow(A.token, id)).toBeUndefined();

  const update = await command(S.token, 'update', { request_id: id, expected_revision: revision(id), payload: { title: `Outro ${tag}` } });
  expect([update.status, update.body.error?.code]).toEqual([409, 'invalid_state']);
  const publish = await command(S.token, 'publish', { request_id: id, expected_revision: revision(id), idempotency_key: newId() });
  expect([publish.status, publish.body.error?.code]).toEqual([409, 'invalid_state']);
  const again = await cancel(S.token, id, revision(id), 'Outra vez.');
  expect([again.status, again.body.error?.code]).toEqual([409, 'invalid_state']);
  expect(sql(`select cancellation_reason from public.requests where id = '${id}'`)).toBe('Afinal não é preciso.');
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.cancelled'`)).toBe(1);
});

test('a published Request: the assignee reads the reason; no one else reads anything', async () => {
  const id = await published('Publicado');
  expect(((await rest(A.token, 'partner_requests?select=id&partner_state=eq.needs_you')).body as { id: string }[]).map((r) => r.id)).toContain(id);

  expect((await cancel(S.token, id, revision(id), '  O evento foi adiado.  ')).status).toBe(200);

  const row = await partnerRow(A.token, id);
  expect(Object.keys(row ?? {})).toHaveLength(17);
  expect(row?.partner_state).toBe('cancelled');
  expect(row?.cancellation_reason).toBe('O evento foi adiado.');
  expect(row?.cancelled_at).not.toBeNull();
  expect(((await rest(A.token, 'partner_requests?select=id&partner_state=eq.needs_you')).body as { id: string }[]).map((r) => r.id)).not.toContain(id);
  for (const [who, person] of [['colleague', B], ['other organization', X]] as const) {
    expect((await rest(person.token, `partner_requests?select=id,cancellation_reason&id=eq.${id}`)).body, who).toEqual([]);
  }
  expect([401, 403]).toContain((await rest(null, `partner_requests?select=id&id=eq.${id}`)).status);

  // The partner cannot answer a cancelled Request.
  const late = await submit(id);
  expect([late.status, late.body.error?.code]).toEqual([409, 'invalid_state']);
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(0);
});

test('after the partner answered: cancel keeps the answer; a replay of that answer still replays', async () => {
  const id = await published('Respondido');
  const submissionId = newId();
  const first = await submit(id, submissionId);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const before = sql(`select string_agg(id::text || created_at::text || payload_hash, ',') from public.request_submissions where request_id = '${id}'`);

  expect((await cancel(S.token, id, revision(id) - 1)).body.error?.code).toBe('stale_revision');
  expect((await cancel(S.token, id, revision(id), 'Já não é necessário.')).status).toBe(200);
  expect(sql(`select string_agg(id::text || created_at::text || payload_hash, ',') from public.request_submissions where request_id = '${id}'`)).toBe(before);

  // The partner's lost response is answered by the recorded outcome, not re-executed.
  const replay = await submit(id, submissionId);
  expect(replay.status).toBe(200);
  expect(replay.body.data?.replayed).toBe(true);
  expect(sql(`select status from public.requests where id = '${id}'`)).toBe('cancelled');

  const done = await command(S.token, 'complete', { request_id: id, expected_revision: revision(id) });
  expect([done.status, done.body.error?.code]).toEqual([409, 'invalid_state']);
  const ret = await command(S.token, 'return', { request_id: id, expected_revision: revision(id), return_id: newId(), response_type: 'text', message: 'x' });
  expect([ret.status, ret.body.error?.code]).toEqual([409, 'invalid_state']);
});

test('cancel racing a partner submission on one Request: exactly one wins', async () => {
  for (let round = 0; round < 3; round += 1) {
    const id = await published(`Corrida envio ${round}`);
    const rev = revision(id);
    const lock = await holdInTransaction(`select id from public.requests where id = '${id}' for update`);
    const racing = Promise.all([submit(id), cancel(S.token, id, rev)]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await lock.release();
    const [submitted, cancelled] = await racing;

    const wins = [submitted, cancelled].filter((r) => r.status === 200);
    expect(wins, JSON.stringify([submitted.body, cancelled.body])).toHaveLength(1);
    if (cancelled.status === 200) {
      expect([submitted.status, submitted.body.error?.code]).toEqual([409, 'invalid_state']);
      expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(0);
    } else {
      expect([cancelled.status, cancelled.body.error?.code]).toEqual([409, 'stale_revision']);
      expect(sql(`select status from public.requests where id = '${id}'`)).toBe('needs_sollelio');
    }
    expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type in ('request.cancelled', 'request.submitted')`)).toBe(1);
  }
});

test('cancel racing complete at the same revision: exactly one wins', async () => {
  const id = await published('Corrida conclusão');
  expect((await submit(id)).status).toBe(200);
  const rev = revision(id);
  const lock = await holdInTransaction(`select id from public.requests where id = '${id}' for update`);
  const racing = Promise.all([command(S.token, 'complete', { request_id: id, expected_revision: rev }), cancel(S.token, id, rev)]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await lock.release();
  const replies = await racing;

  expect(replies.filter((r) => r.status === 200), JSON.stringify(replies.map((r) => r.body))).toHaveLength(1);
  expect(replies.filter((r) => r.status === 409)).toHaveLength(1);
  const final = sql(`select status from public.requests where id = '${id}'`);
  expect(['completed', 'cancelled']).toContain(final);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type in ('request.cancelled', 'request.completed')`)).toBe(1);
  expect(sql(`select (cancellation_reason is null)::text from public.requests where id = '${id}'`)).toBe(final === 'completed' ? 'true' : 'false');
});
