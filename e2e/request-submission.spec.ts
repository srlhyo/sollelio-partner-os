/**
 * Slice 2 C3 — the response loop at the API boundary, against the real local stack:
 * real GoTrue sessions, the real `partner-request-commands` and `request-commands`
 * Edge Functions, real PostgREST and RLS. Concurrency here is genuine: parallel HTTP
 * requests racing on one Request.
 *
 * Every person, organization, product and Request is synthetic and belongs to this
 * run. Nothing touches the seeded pilot data.
 */
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { command, createPerson, localAdmin, newId, partnerCommand, rest, runTag, sql, type Person } from './helpers/requests';
import { ANON_KEY } from './helpers/env';

test.describe.configure({ mode: 'serial' });

let admin: SupabaseClient;
let tag: string;
let S: Person; // staff
let A: Person; // the assignee, active member of O1
let B: Person; // another active member of O1
let X: Person; // member of O2
let I: Person; // member of O1, deactivated after assignment
let N: Person; // auth user without a profile
const org = { O1: '', O2: '' };
let memberI = '';

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select('id').single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as { id: string }).id;
}

const count = (statement: string) => Number(sql(statement));

/** Creates and publishes a Request (C2 commands), returning its id and field ids by key. */
async function published(title: string, assignee: Person = A, type = 'question') {
  const id = newId();
  const payload = {
    organization_id: org.O1, assignee_profile_id: assignee.profileId, type, title: `${title} ${tag}`,
    requested_action: 'Faça isto.', estimated_effort_minutes: 3, internal: { completion_criteria: 'Respondido.' },
    fields: type === 'question'
      ? [{ label: 'O que achou?', type: 'long_text', required: true }, { label: 'Conseguiu?', type: 'boolean', required: true }]
      : [],
  };
  expect((await command(S.token, 'create', { request_id: id, payload })).status).toBe(200);
  const preview = await command(S.token, 'preview', { request_id: id });
  const publish = await command(S.token, 'publish', {
    request_id: id, expected_revision: preview.body.data?.revision, idempotency_key: newId(),
  });
  expect(publish.status, JSON.stringify(publish.body)).toBe(200);
  const fields = Object.fromEntries(
    sql(`select string_agg(key || '=' || id, ',') from public.request_fields where request_id = '${id}'`)
      .split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string]),
  );
  return { id, fields };
}

const answers = (fields: Record<string, string>, text = 'Correu bem.', ok: boolean = false) => ({
  answers: [{ field_id: fields.q1, value: text }, { field_id: fields.q2, value: ok }],
});

const submit = (token: string | null, id: string, submissionId: string, expected: string | null, body: object) =>
  partnerCommand(token, 'submit', { request_id: id, submission_id: submissionId, expected_return_id: expected, ...body });

const revision = (id: string) => Number(sql(`select revision from public.requests where id = '${id}'`));

test.beforeAll(async () => {
  admin = localAdmin();
  tag = runTag();
  org.O1 = await insert('organizations', { name: `${tag} org 1`, slug: `${tag}-org-1` });
  org.O2 = await insert('organizations', { name: `${tag} org 2`, slug: `${tag}-org-2` });
  S = await createPerson(admin, `${tag}-staff@example.test`, { staff: true, displayName: `${tag} staff` });
  A = await createPerson(admin, `${tag}-a@example.test`, { displayName: `${tag} A` });
  B = await createPerson(admin, `${tag}-b@example.test`, { displayName: `${tag} B` });
  X = await createPerson(admin, `${tag}-x@example.test`, { displayName: `${tag} X` });
  I = await createPerson(admin, `${tag}-i@example.test`, { displayName: `${tag} I` });
  N = await createPerson(admin, `${tag}-n@example.test`, { profile: false, displayName: 'none' });
  await insert('organization_memberships', { organization_id: org.O1, profile_id: A.profileId });
  await insert('organization_memberships', { organization_id: org.O1, profile_id: B.profileId });
  await insert('organization_memberships', { organization_id: org.O2, profile_id: X.profileId });
  memberI = await insert('organization_memberships', { organization_id: org.O1, profile_id: I.profileId });
});

test('only the assigned partner, with an active membership, can submit; everyone else sees nothing', async () => {
  const { id, fields } = await published('Gate');
  const body = answers(fields);
  expect((await submit(null, id, newId(), null, body)).status).toBe(401);
  expect((await submit(ANON_KEY, id, newId(), null, body)).status).toBe(401);
  expect((await submit('not-a-token', id, newId(), null, body)).status).toBe(401);
  const noProfile = await submit(N.token, id, newId(), null, body);
  expect([noProfile.status, noProfile.body.error?.code]).toEqual([403, 'no_profile']);
  for (const [who, person] of [['staff', S], ['colleague', B], ['other organization', X]] as const) {
    const reply = await submit(person.token, id, newId(), null, body);
    expect([reply.status, reply.body.error?.code], who).toEqual([404, 'not_found']);
  }
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(0);

  const leaverRequest = await published('Leaver', I, 'task');
  sql(`update public.organization_memberships set status = 'inactive' where id = '${memberI}'`);
  const leaver = await submit(I.token, leaverRequest.id, newId(), null, { answers: [] });
  expect([leaver.status, leaver.body.error?.code]).toEqual([404, 'not_found']);

  const mine = await submit(A.token, id, newId(), null, body);
  expect(mine.status, JSON.stringify(mine.body)).toBe(200);
  expect(sql(`select status || '/' || next_actor from public.requests where id = '${id}'`)).toBe('needs_sollelio/sollelio');
});

test('the partner cannot return or complete, and nothing is writable outside the commands', async () => {
  const { id, fields } = await published('Separação');
  expect((await submit(A.token, id, newId(), null, answers(fields))).status).toBe(200);
  const rev = revision(id);

  const ret = await command(A.token, 'return', { request_id: id, expected_revision: rev, return_id: newId(), response_type: 'text', message: 'x' });
  expect([ret.status, ret.body.error?.code]).toEqual([403, 'not_staff']);
  const done = await command(A.token, 'complete', { request_id: id, expected_revision: rev });
  expect([done.status, done.body.error?.code]).toEqual([403, 'not_staff']);

  for (const token of [A.token, S.token]) {
    const insertSubmission = await rest(token, 'request_submissions', {
      method: 'POST', body: JSON.stringify({ request_id: id, submitted_by: A.profileId }),
    });
    expect([401, 403]).toContain(insertSubmission.status);
    const insertReturn = await rest(token, 'request_returns', {
      method: 'POST', body: JSON.stringify({ id: newId(), request_id: id, response_type: 'text', message: 'x', created_by: S.profileId }),
    });
    expect([401, 403]).toContain(insertReturn.status);
    const lifecycle = await rest(token, `requests?id=eq.${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'completed', next_actor: 'none', completed_at: new Date().toISOString() }),
    });
    expect([401, 403]).toContain(lifecycle.status);
    const rpc = await rest(token, 'rpc/cmd_submit_request', {
      method: 'POST',
      body: JSON.stringify({ p_actor: A.profileId, p_request_id: id, p_submission_id: newId(), p_expected_return_id: null, p_payload: { answers: [] } }),
    });
    expect([401, 403]).toContain(rpc.status);
    expect((rpc.body as { code?: string }).code).toBe('42501');
  }
  expect(sql(`select status from public.requests where id = '${id}'`)).toBe('needs_sollelio');
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(1);
});

test('a rejected submission is rejected in full and names the problem', async () => {
  const { id, fields } = await published('Validação');
  const reply = await submit(A.token, id, newId(), null, { answers: [{ field_id: fields.q2, value: 'false' }] });
  expect([reply.status, reply.body.error?.code]).toEqual([422, 'validation_failed']);
  const codes = (reply.body.error?.details?.errors ?? []).map((e) => `${e.field}:${e.code}`).sort();
  expect(codes).toEqual([`answers.${fields.q1}:required`, `answers.${fields.q2}:invalid_type`].sort());
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(0);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.submitted'`)).toBe(0);
  expect(sql(`select status from public.requests where id = '${id}'`)).toBe('needs_partner');
});

test('a lost answer: repeating the same attempt replays it — one submission, one event', async () => {
  const { id, fields } = await published('Resposta perdida');
  const submissionId = newId();
  const first = await submit(A.token, id, submissionId, null, answers(fields));
  expect(first.body.data?.replayed).toBe(false);
  // The client never saw `first`: it repeats the attempt exactly.
  const again = await submit(A.token, id, submissionId, null, answers(fields));
  expect(again.status).toBe(200);
  expect(again.body.data?.replayed).toBe(true);
  expect(again.body.data?.revision).toBe(first.body.data?.revision);
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(1);
  expect(count(`select count(*) from public.request_answers a join public.request_submissions s on s.id = a.submission_id where s.request_id = '${id}'`)).toBe(2);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.submitted'`)).toBe(1);

  const changed = await submit(A.token, id, submissionId, null, answers(fields, 'Outra coisa.'));
  expect([changed.status, changed.body.error?.code]).toEqual([409, 'idempotency_conflict']);
});

test('double click: the same attempt five times in parallel is one submission', async () => {
  const { id, fields } = await published('Duplo clique');
  const submissionId = newId();
  const replies = await Promise.all(Array.from({ length: 5 }, () => submit(A.token, id, submissionId, null, answers(fields))));
  expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
  expect(replies.filter((r) => r.body.data?.replayed === false)).toHaveLength(1);
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(1);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.submitted'`)).toBe(1);
});

test('different attempts racing on one round: exactly one wins, the rest are refused', async () => {
  const { id, fields } = await published('Corrida');
  const replies = await Promise.all(Array.from({ length: 4 }, (_, i) => submit(A.token, id, newId(), null, answers(fields, `Tentativa ${i}`))));
  expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
  expect(replies.filter((r) => r.status === 409).map((r) => r.body.error?.code)).toEqual(['invalid_state', 'invalid_state', 'invalid_state']);
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(1);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.submitted'`)).toBe(1);
});

test('the whole loop: return with text, answer, return for approval, stale round, approve, complete', async () => {
  const { id, fields } = await published('Ciclo');
  expect((await submit(A.token, id, newId(), null, answers(fields))).status).toBe(200);

  // Staff act only from needs_sollelio, at the revision they reviewed.
  const stale = await command(S.token, 'return', { request_id: id, expected_revision: revision(id) - 1, return_id: newId(), response_type: 'text', message: 'x' });
  expect([stale.status, stale.body.error?.code]).toEqual([409, 'stale_revision']);

  const ret1 = newId();
  const returned = await command(S.token, 'return', {
    request_id: id, expected_revision: revision(id), return_id: ret1, response_type: 'text', message: 'Acontece também no telemóvel?',
  });
  expect(returned.status, JSON.stringify(returned.body)).toBe(200);
  const replay = await command(S.token, 'return', {
    request_id: id, expected_revision: revision(id), return_id: ret1, response_type: 'text', message: 'Acontece também no telemóvel?',
  });
  expect(replay.body.data?.replayed).toBe(true);
  expect(count(`select count(*) from public.request_returns where request_id = '${id}'`)).toBe(1);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.returned_to_partner'`)).toBe(1);

  const notYet = await command(S.token, 'complete', { request_id: id, expected_revision: revision(id) });
  expect([notYet.status, notYet.body.error?.code]).toEqual([409, 'invalid_state']);

  // The returned round answers only its question.
  const withOriginal = await submit(A.token, id, newId(), ret1, answers(fields));
  expect([withOriginal.status, withOriginal.body.error?.code]).toEqual([422, 'validation_failed']);
  expect((await submit(A.token, id, newId(), ret1, { response: { text: 'Sim, também.' } })).status).toBe(200);

  const ret2 = newId();
  expect((await command(S.token, 'return', {
    request_id: id, expected_revision: revision(id), return_id: ret2, response_type: 'approval', message: 'Corrigimos. Pode aprovar?',
  })).status).toBe(200);

  // A page still showing the previous round is told it changed, and nothing is written.
  const staleRound = await submit(A.token, id, newId(), ret1, { response: { text: 'Resposta antiga.' } });
  expect([staleRound.status, staleRound.body.error?.code]).toEqual([409, 'stale_round']);
  const notesWithApprove = await submit(A.token, id, newId(), ret2, { response: { decision: 'approve', notes: 'Mudem a cor.' } });
  expect([notesWithApprove.status, notesWithApprove.body.error?.code]).toEqual([422, 'validation_failed']);
  expect((await submit(A.token, id, newId(), ret2, { response: { decision: 'approve', notes: null } })).status).toBe(200);

  const completed = await command(S.token, 'complete', { request_id: id, expected_revision: revision(id) });
  expect(completed.status, JSON.stringify(completed.body)).toBe(200);
  expect(sql(`select status || '/' || next_actor || '/' || (completed_at is not null) from public.requests where id = '${id}'`)).toBe('completed/none/true');
  expect(sql(`select string_agg(coalesce(return_id::text, 'initial'), ',' order by created_at) from public.request_submissions where request_id = '${id}'`))
    .toBe(`initial,${ret1},${ret2}`);

  // Reads: the assignee sees her rounds and the partner-facing returns; nobody else sees anything.
  const partnerReturns = await rest(A.token, `partner_request_returns?select=*&request_id=eq.${id}&order=created_at`);
  expect((partnerReturns.body as { message: string }[]).map((r) => r.message)).toEqual(['Acontece também no telemóvel?', 'Corrigimos. Pode aprovar?']);
  expect(Object.keys((partnerReturns.body as object[])[0] ?? {}).sort()).toEqual(['created_at', 'id', 'message', 'request_id', 'response_type']);
  expect((await rest(A.token, `partner_request_returns?select=created_by&request_id=eq.${id}`)).status).toBeGreaterThanOrEqual(400);
  expect((await rest(A.token, `request_returns?select=*&request_id=eq.${id}`)).body).toEqual([]);
  expect(((await rest(A.token, `request_submissions?select=id&request_id=eq.${id}`)).body as unknown[]).length).toBe(3);
  for (const [who, person] of [['colleague', B], ['other organization', X]] as const) {
    expect((await rest(person.token, `partner_request_returns?select=id&request_id=eq.${id}`)).body, who).toEqual([]);
    expect((await rest(person.token, `request_submissions?select=id&request_id=eq.${id}`)).body, who).toEqual([]);
  }
  expect([401, 403]).toContain((await rest(null, `partner_request_returns?select=id&request_id=eq.${id}`)).status);

  // The partner projection kept exactly its columns (seventeen from C4: cancellation_reason).
  const row = ((await rest(A.token, `partner_requests?select=*&id=eq.${id}`)).body as Record<string, unknown>[])[0] ?? {};
  expect(Object.keys(row)).toHaveLength(17);
  expect(row.cancellation_reason).toBeNull();
  expect(row.partner_state).toBe('done');
});

// C3 whitespace canonicalization hardening (20260930160000): the return message and the
// returned-round text and notes trim every whitespace character at either end, as
// String.trim() does — line breaks, tabs, no-break and other Unicode spaces.
test('boundary whitespace of every kind is trimmed; whitespace-only is empty; replay is unchanged', async () => {
  const WS = '\u00a0\u2003\u3000\ufeff';
  const { id, fields } = await published('Espaços');
  expect((await submit(A.token, id, newId(), null, answers(fields))).status).toBe(200);

  const errorsOf = (r: Awaited<ReturnType<typeof command>>) =>
    [r.status, r.body.error?.code, ...(r.body.error?.details?.errors ?? []).map((e) => `${e.field}:${e.code}`)];
  const blankReturn = await command(S.token, 'return', {
    request_id: id, expected_revision: revision(id), return_id: newId(), response_type: 'text', message: `\n\t\r\n${WS}`,
  });
  expect(errorsOf(blankReturn)).toEqual([422, 'validation_failed', 'message:required']);

  const ret1 = newId();
  const returnBody = { request_id: id, expected_revision: revision(id), return_id: ret1, response_type: 'text', message: `\n\t${WS} Acontece no telemóvel? \r\n\u00a0` };
  expect((await command(S.token, 'return', returnBody)).status).toBe(200);
  expect(sql(`select message from public.request_returns where id = '${ret1}'`)).toBe('Acontece no telemóvel?');
  expect((await command(S.token, 'return', returnBody)).body.data?.replayed).toBe(true);

  const blankText = await submit(A.token, id, newId(), ret1, { response: { text: `\n\t${WS}\r\n` } });
  expect(errorsOf(blankText)).toEqual([422, 'validation_failed', 'response.text:required']);
  const k = newId();
  const textBody = { response: { text: `\u00a0\n Sim, também. \t\u3000` } };
  const first = await submit(A.token, id, k, ret1, textBody);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(sql(`select response_text from public.request_submissions where id = '${k}'`)).toBe('Sim, também.');
  // Replay identity is unchanged: the same attempt replays, a changed one conflicts.
  const again = await submit(A.token, id, k, ret1, textBody);
  expect([again.status, again.body.data?.replayed, again.body.data?.revision]).toEqual([200, true, first.body.data?.revision]);
  expect((await submit(A.token, id, k, ret1, { response: { text: 'Não.' } })).body.error?.code).toBe('idempotency_conflict');
  expect(count(`select count(*) from public.request_submissions where return_id = '${ret1}'`)).toBe(1);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.submitted'`)).toBe(2);

  // Approval round: padded notes stored canonical; whitespace-only notes are no notes.
  const ret2 = newId();
  expect((await command(S.token, 'return', {
    request_id: id, expected_revision: revision(id), return_id: ret2, response_type: 'approval', message: 'Pode aprovar?',
  })).status).toBe(200);
  const withNotes = newId();
  expect((await submit(A.token, id, withNotes, ret2, { response: { decision: 'needs_changes', notes: `\n\t Mudem a cor. ${WS}` } })).status).toBe(200);
  expect(sql(`select response_notes from public.request_submissions where id = '${withNotes}'`)).toBe('Mudem a cor.');

  const { id: id2, fields: fields2 } = await published('Espaços aprovar');
  expect((await submit(A.token, id2, newId(), null, answers(fields2))).status).toBe(200);
  const ret3 = newId();
  expect((await command(S.token, 'return', {
    request_id: id2, expected_revision: revision(id2), return_id: ret3, response_type: 'approval', message: 'Pode aprovar?',
  })).status).toBe(200);
  const approve = newId();
  const approved = await submit(A.token, id2, approve, ret3, { response: { decision: 'approve', notes: `\u00a0\r\n${WS}` } });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  expect(sql(`select response_decision || '/' || coalesce(response_notes, 'NULL') from public.request_submissions where id = '${approve}'`)).toBe('approve/NULL');
});

// Initial-round whitespace canonicalization (20261003120000): long_text and single_choice
// answers trim every whitespace character at either end; the replay identity is the
// unchanged btrim()-based payload hash, so only ASCII-space padding replays.
test('initial round: whitespace-only is unanswered, padded answers are canonical, replay identity is unchanged', async () => {
  const WS = '\u00a0\u2003\u3000\ufeff';
  const id = newId();
  const payload = {
    organization_id: org.O1, assignee_profile_id: A.profileId, type: 'question', title: `Espaços iniciais ${tag}`,
    requested_action: 'Faça isto.', estimated_effort_minutes: 3, internal: { completion_criteria: 'Respondido.' },
    fields: [
      { label: 'O que correu mal?', type: 'long_text', required: true },
      { label: 'Algo mais?', type: 'long_text', required: false },
      { label: 'Está confirmado?', type: 'single_choice', required: true, options: ['Confirmado', 'Não confirmado'] },
    ],
  };
  expect((await command(S.token, 'create', { request_id: id, payload })).status).toBe(200);
  const preview = await command(S.token, 'preview', { request_id: id });
  expect((await command(S.token, 'publish', { request_id: id, expected_revision: preview.body.data?.revision, idempotency_key: newId() })).status).toBe(200);
  const f = Object.fromEntries(sql(`select string_agg(key || '=' || id, ',') from public.request_fields where request_id = '${id}'`)
    .split(',').map((kv) => kv.split('=') as [string, string]));
  const body = (q1: unknown, q2: unknown, q3: unknown) =>
    ({ answers: [{ field_id: f.q1, value: q1 }, { field_id: f.q2, value: q2 }, { field_id: f.q3, value: q3 }] });
  const errorsOf = (r: Awaited<ReturnType<typeof submit>>) =>
    [r.status, ...(r.body.error?.details?.errors ?? []).map((e) => `${e.field}:${e.code}`)];

  expect(errorsOf(await submit(A.token, id, newId(), null, body(`\n\t${WS}\r\n`, null, 'Confirmado')))).toEqual([422, `answers.${f.q1}:required`]);
  expect(errorsOf(await submit(A.token, id, newId(), null, body('Texto.', null, 'Talvez')))).toEqual([422, `answers.${f.q3}:invalid_option`]);
  expect(errorsOf(await submit(A.token, id, newId(), null, body('Texto.', null, `${WS}`)))).toEqual([422, `answers.${f.q3}:invalid_option`]);
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(0);

  const k = newId();
  const answersBody = body(`\u00a0\n Texto real \t\u3000`, `\n\t\u00a0`, `\u00a0Confirmado\u3000`);
  const first = await submit(A.token, id, k, null, answersBody);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const stored = (key: string) => sql(`select coalesce((select value #>> '{}' from public.request_answers where submission_id = '${k}' and request_field_id = '${f[key]}'), 'NONE')`);
  expect([stored('q1'), stored('q2'), stored('q3')]).toEqual(['Texto real', 'NONE', 'Confirmado']);

  // Replay identity: the exact attempt and ASCII-space padding replay; a changed answer,
  // or the same canonical answers padded otherwise, is a conflict under the same id.
  const again = await submit(A.token, id, k, null, answersBody);
  expect([again.status, again.body.data?.replayed, again.body.data?.revision]).toEqual([200, true, first.body.data?.revision]);
  expect((await submit(A.token, id, k, null, body(`  \u00a0\n Texto real \t\u3000  `, `\n\t\u00a0`, ` \u00a0Confirmado\u3000 `))).body.data?.replayed).toBe(true);
  expect((await submit(A.token, id, k, null, body('Outro texto', null, 'Confirmado'))).body.error?.code).toBe('idempotency_conflict');
  expect((await submit(A.token, id, k, null, body('Texto real', null, 'Confirmado'))).body.error?.code).toBe('idempotency_conflict');
  expect(count(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe(1);
  expect(count(`select count(*) from public.request_answers where submission_id = '${k}'`)).toBe(2);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.submitted'`)).toBe(1);
});
