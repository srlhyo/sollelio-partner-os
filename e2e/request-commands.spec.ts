/**
 * Slice 2 C2 — the Request commands and the partner boundary, against the real local
 * stack: real GoTrue sessions, the real Edge Function, real PostgREST and RLS.
 *
 * Every person, organization, product and resource here is synthetic and belongs to
 * this run. Nothing touches the seeded pilot data.
 */
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  command,
  createPerson,
  holdInTransaction,
  localAdmin,
  newId,
  rest,
  runTag,
  sql,
  type Person,
} from './helpers/requests';
import { ANON_KEY } from './helpers/env';

test.describe.configure({ mode: 'serial' });

const PARTNER_COLUMNS = [
  'id', 'organization_id', 'product_id', 'product_name', 'type', 'title', 'context', 'requested_action',
  'estimated_effort_minutes', 'due_at', 'partner_state', 'published_at', 'completed_at', 'cancelled_at',
  'related_update_id', 'resource_id',
];

let admin: SupabaseClient;
let tag: string;
let S: Person; // staff
let A: Person; // active member of O1, the usual assignee
let B: Person; // another active member of O1
let X: Person; // member of O2
let I: Person; // member of O1, deactivated later
let N: Person; // auth user without a profile
const org: Record<'O1' | 'O2' | 'O3', string> = { O1: '', O2: '', O3: '' };
const product: Record<'P1' | 'P2', string> = { P1: '', P2: '' };
const resource: Record<'R1' | 'Rhidden' | 'Rother' | 'Rlock', string> = { R1: '', Rhidden: '', Rother: '', Rlock: '' };
let memberI = '';

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select('id').single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as { id: string }).id;
}

const draft = (patch: Record<string, unknown> = {}) => ({
  organization_id: org.O1,
  assignee_profile_id: A.profileId,
  type: 'task',
  title: `Tarefa ${tag}`,
  requested_action: 'Faça isto.',
  estimated_effort_minutes: 3,
  internal: { completion_criteria: 'Feito.' },
  ...patch,
});

const without = (value: Record<string, unknown>, key: string) => {
  const copy = { ...value };
  delete copy[key];
  return copy;
};

async function createDraft(patch: Record<string, unknown> = {}) {
  const id = newId();
  const reply = await command(S.token, 'create', { request_id: id, payload: draft(patch) });
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return { id, revision: reply.body.data?.revision as number };
}

async function preview(id: string) {
  const reply = await command(S.token, 'preview', { request_id: id });
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return reply.body.data as unknown as { revision: number; request: Record<string, unknown>; fields: unknown[] };
}

async function publish(id: string, revision: number, key = newId()) {
  return command(S.token, 'publish', { request_id: id, expected_revision: revision, idempotency_key: key });
}

const count = (statement: string) => Number(sql(statement));

test.beforeAll(async () => {
  admin = localAdmin();
  tag = runTag();

  org.O1 = await insert('organizations', { name: `${tag} org 1`, slug: `${tag}-org-1` });
  org.O2 = await insert('organizations', { name: `${tag} org 2`, slug: `${tag}-org-2` });
  org.O3 = await insert('organizations', { name: `${tag} inactive`, slug: `${tag}-org-3`, status: 'inactive' });
  product.P1 = await insert('products', { key: `${tag}-p1`, name: `${tag} produto 1`, type: 'application' });
  product.P2 = await insert('products', { key: `${tag}-p2`, name: `${tag} produto 2`, type: 'website' });
  await insert('organization_products', { organization_id: org.O1, product_id: product.P1 });

  S = await createPerson(admin, `${tag}-staff@example.test`, { staff: true, displayName: `${tag} staff` });
  A = await createPerson(admin, `${tag}-a@example.test`, { displayName: `${tag} A` });
  B = await createPerson(admin, `${tag}-b@example.test`, { displayName: `${tag} B` });
  X = await createPerson(admin, `${tag}-x@example.test`, { displayName: `${tag} X` });
  I = await createPerson(admin, `${tag}-i@example.test`, { displayName: `${tag} I` });
  N = await createPerson(admin, `${tag}-n@example.test`, { profile: false, displayName: 'none' });

  await insert('organization_memberships', { organization_id: org.O1, profile_id: A.profileId });
  await insert('organization_memberships', { organization_id: org.O1, profile_id: B.profileId });
  await insert('organization_memberships', { organization_id: org.O2, profile_id: X.profileId });
  await insert('organization_memberships', { organization_id: org.O3, profile_id: A.profileId });
  memberI = await insert('organization_memberships', { organization_id: org.O1, profile_id: I.profileId });

  resource.R1 = await insert('resources', {
    organization_id: org.O1, product_id: product.P1, name: 'Events sintético', type: 'product', url: 'https://events.example.test/c2',
  });
  resource.Rhidden = await insert('resources', {
    organization_id: org.O1, name: 'Interno', type: 'document', url: 'https://internal.example.test/c2', partner_visible: false,
  });
  resource.Rother = await insert('resources', {
    organization_id: org.O2, name: 'Outra org', type: 'website', url: 'https://outra.example.test/c2',
  });
  resource.Rlock = await insert('resources', {
    organization_id: org.O1, name: 'Para substituir', type: 'website', url: 'https://lock.example.test/c2',
  });
});

test('only a verified staff session reaches the commands', async () => {
  const body = { request_id: newId() };
  expect((await command(null, 'preview', body)).status).toBe(401);
  expect((await command(ANON_KEY, 'preview', body)).status).toBe(401);
  expect((await command('not-a-token', 'preview', body)).status).toBe(401);

  const partner = await command(A.token, 'preview', body);
  expect(partner.status).toBe(403);
  expect(partner.body.error?.code).toBe('not_staff');

  const noProfile = await command(N.token, 'preview', body);
  expect(noProfile.status).toBe(403);
  expect(noProfile.body.error?.code).toBe('no_profile');

  const staff = await command(S.token, 'preview', body);
  expect(staff.status).toBe(404);
});

test('the privileged SQL commands and their support objects are not reachable through the API', async () => {
  for (const token of [S.token, A.token, null]) {
    const rpc = await rest(token, 'rpc/cmd_create_request', {
      method: 'POST',
      body: JSON.stringify({ p_actor: S.profileId, p_request_id: newId(), p_payload: draft() }),
    });
    expect([401, 403]).toContain(rpc.status);
    expect((rpc.body as { code?: string }).code).toBe('42501');

    const receipts = await rest(token, 'request_command_receipts?select=*');
    expect([401, 403]).toContain(receipts.status);
  }
  // The internal projection lives in a schema PostgREST does not expose.
  const projection = await rest(S.token, 'partner_request_projection?select=*', { headers: { 'Accept-Profile': 'app' } });
  expect(projection.status).toBeGreaterThanOrEqual(400);
});

test('create: exact replay creates nothing, a different payload conflicts, even after an edit', async () => {
  const id = newId();
  const payload = draft({ title: `Replay ${tag}` });

  const first = await command(S.token, 'create', { request_id: id, payload });
  expect(first.status).toBe(200);
  expect(first.body.data?.replayed).toBe(false);

  const again = await command(S.token, 'create', { request_id: id, payload });
  expect(again.status).toBe(200);
  expect(again.body.data?.replayed).toBe(true);

  const other = await command(S.token, 'create', { request_id: id, payload: { ...payload, title: 'Outro' } });
  expect(other.status).toBe(409);
  expect(other.body.error?.code).toBe('idempotency_conflict');

  // Edit the draft, then replay the original create: still recognised as the same
  // operation, because the comparison is against the original payload.
  const edited = await command(S.token, 'update', {
    request_id: id, expected_revision: first.body.data?.revision, payload: without({ ...payload, title: 'Editado' }, 'organization_id'),
  });
  expect(edited.status).toBe(200);
  const replayAfterEdit = await command(S.token, 'create', { request_id: id, payload });
  expect(replayAfterEdit.status).toBe(200);
  expect(replayAfterEdit.body.data?.replayed).toBe(true);

  expect(count(`select count(*) from public.requests where id = '${id}'`)).toBe(1);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.created'`)).toBe(1);
});

test('rejections are atomic and name what is wrong', async () => {
  const id = newId();
  const bad = await command(S.token, 'create', { request_id: id, payload: draft({ resource_id: resource.Rother }) });
  expect(bad.status).toBe(422);
  expect(bad.body.error?.code).toBe('resource_not_available');

  const missing = await command(S.token, 'create', { request_id: id, payload: without(draft(), 'title') });
  expect(missing.status).toBe(422);
  expect(missing.body.error?.details?.errors?.map((e) => e.field)).toContain('title');

  const tooBig = await command(S.token, 'create', JSON.stringify({ request_id: id, payload: draft({ context: 'x'.repeat(70_000) }) }));
  expect(tooBig.status).toBe(413);

  expect(count(`select count(*) from public.requests where id = '${id}'`)).toBe(0);
  expect(count(`select count(*) from public.request_command_receipts where idempotency_key = '${id}'`)).toBe(0);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}'`)).toBe(0);
});

test('dependencies: organization, membership, product and resource are enforced', async () => {
  const inactiveOrg = await command(S.token, 'create', { request_id: newId(), payload: draft({ organization_id: org.O3 }) });
  expect(inactiveOrg.body.error?.code).toBe('organization_not_active');

  const outsider = await command(S.token, 'create', { request_id: newId(), payload: draft({ assignee_profile_id: X.profileId }) });
  expect(outsider.body.error?.code).toBe('assignee_not_active_member');

  const staffAssignee = await command(S.token, 'create', { request_id: newId(), payload: draft({ assignee_profile_id: S.profileId }) });
  expect(staffAssignee.body.error?.code).toBe('assignee_not_active_member');

  const unlinked = await command(S.token, 'create', { request_id: newId(), payload: draft({ product_id: product.P2 }) });
  expect(unlinked.body.error?.code).toBe('product_not_linked');
});

test('a preview names its revision; any later edit makes it stale for publication', async () => {
  const { id } = await createDraft({ title: `Stale ${tag}` });
  const seen = await preview(id);

  const edit = await command(S.token, 'update', {
    request_id: id, expected_revision: seen.revision, payload: without(draft({ title: `Stale editado ${tag}` }), 'organization_id'),
  });
  expect(edit.status).toBe(200);

  const stale = await publish(id, seen.revision);
  expect(stale.status).toBe(409);
  expect(stale.body.error?.code).toBe('stale_revision');

  const fresh = await preview(id);
  expect(fresh.request.title).toBe(`Stale editado ${tag}`);
  const ok = await publish(id, fresh.revision);
  expect(ok.status).toBe(200);
  expect(sql(`select status || '/' || next_actor || '/' || (published_at is not null) from public.requests where id = '${id}'`))
    .toBe('needs_partner/partner/true');
});

test('the partner sees exactly her published Requests, with the sixteen-column projection', async () => {
  const drafted = await createDraft({ title: `Rascunho ${tag}`, type: 'question', fields: [{ label: 'Oculta?', type: 'boolean', required: true }] });
  const published = await createDraft({
    title: `Publicado ${tag}`, type: 'question', product_id: product.P1, resource_id: resource.R1,
    fields: [{ label: 'Foi fácil?', type: 'boolean', required: true }],
  });
  const seen = await preview(published.id);
  expect((await publish(published.id, seen.revision)).status).toBe(200);

  const filter = `partner_requests?select=*&id=in.(${drafted.id},${published.id})`;
  const mine = await rest(A.token, filter);
  expect(mine.status).toBe(200);
  const rows = mine.body as Record<string, unknown>[];
  expect(rows.map((r) => r.id)).toEqual([published.id]);
  expect(Object.keys(rows[0] ?? {}).sort()).toEqual([...PARTNER_COLUMNS].sort());
  expect(rows[0]?.partner_state).toBe('needs_you');
  expect(rows[0]?.resource_id).toBe(resource.R1);

  // The preview is the same projection: same keys, same values, apart from nothing.
  const previewed = await preview(published.id);
  expect(previewed.request).toEqual(rows[0]);

  const fields = await rest(A.token, `request_fields?select=id&request_id=in.(${drafted.id},${published.id})`);
  expect((fields.body as unknown[]).length).toBe(1);

  for (const [who, token] of [['B', B.token], ['X', X.token], ['S', S.token], ['N', N.token]] as const) {
    const other = await rest(token, filter);
    expect(other.status, who).toBe(200);
    expect(other.body, who).toEqual([]);
    const otherFields = await rest(token, `request_fields?select=id&request_id=eq.${published.id}`);
    // Staff reads fields through its own policy; partners never through another's Request.
    if (who !== 'S') expect(otherFields.body, who).toEqual([]);
  }
  const anon = await rest(null, filter);
  expect([401, 403]).toContain(anon.status);

  // The internal zone never reaches the partner.
  for (const table of ['request_internal_details?select=*', 'request_internal_notes?select=*', 'requests?select=id', 'activity_events?select=id']) {
    const probe = await rest(A.token, `${table}`);
    expect(probe.body, table).toEqual([]);
  }
});

test('a membership deactivated after publication loses the Request', async () => {
  const { id } = await createDraft({ title: `Inactivo ${tag}`, assignee_profile_id: I.profileId });
  expect((await publish(id, (await preview(id)).revision)).status).toBe(200);
  expect((await rest(I.token, `partner_requests?select=id&id=eq.${id}`)).body).toEqual([{ id }]);

  sql(`update public.organization_memberships set status = 'inactive' where id = '${memberI}'`);
  expect((await rest(I.token, `partner_requests?select=id&id=eq.${id}`)).body).toEqual([]);
  expect((await rest(I.token, `request_fields?select=id&request_id=eq.${id}`)).body).toEqual([]);
});

test('approval Requests carry the system decision and optional notes, and nothing else', async () => {
  const rejected = await command(S.token, 'create', {
    request_id: newId(), payload: draft({ type: 'approval', fields: [{ label: 'Extra', type: 'long_text' }] }),
  });
  expect(rejected.body.error?.details?.errors?.map((e) => e.code)).toContain('approval_fields_system');

  const { id } = await createDraft({ type: 'approval', title: `Aprovação ${tag}` });
  const seen = await preview(id);
  const fields = seen.fields as { key: string; type: string; required: boolean; system_generated: boolean; options: string[] | null }[];
  expect(fields.map((f) => `${f.key}:${f.type}:${f.required}:${f.system_generated}`)).toEqual([
    'approval:approval:true:true',
    'approval_notes:long_text:false:true',
  ]);
  expect(fields[0]?.options).toEqual(['approve', 'needs_changes']);
  expect((await publish(id, seen.revision)).status).toBe(200);
});

test('publication requirements are the server’s', async () => {
  const noCriteria = await createDraft({ internal: null, title: `Sem critério ${tag}` });
  const r1 = await publish(noCriteria.id, (await preview(noCriteria.id)).revision);
  expect(r1.body.error?.code).toBe('publish_requirements');

  const noQuestion = await createDraft({ type: 'question', title: `Sem pergunta ${tag}` });
  const r2 = await publish(noQuestion.id, (await preview(noQuestion.id)).revision);
  expect(r2.body.error?.code).toBe('publish_requirements');

  const oneOption = await createDraft({
    type: 'question', title: `Uma opção ${tag}`, fields: [{ label: 'Qual?', type: 'single_choice', required: true, options: ['Só esta'] }],
  });
  const r3 = await publish(oneOption.id, (await preview(oneOption.id)).revision);
  expect(r3.body.error?.code).toBe('publish_requirements');

  const hidden = await createDraft({ title: `Recurso oculto ${tag}`, resource_id: resource.Rhidden });
  const hiddenPreview = await command(S.token, 'preview', { request_id: hidden.id });
  expect(hiddenPreview.body.data?.resource).toBeNull();
  expect(hiddenPreview.body.data?.resource_unavailable).toBe(true);
  const r4 = await publish(hidden.id, (hiddenPreview.body.data?.revision as number) ?? 0);
  expect(r4.body.error?.code).toBe('resource_not_available');

  // A deadline in the past is not a new publication rule.
  const past = await createDraft({ title: `Prazo passado ${tag}`, due_at: '2020-01-01T10:00:00Z' });
  expect((await publish(past.id, (await preview(past.id)).revision)).status).toBe(200);
});

test('states no C2 command reaches yet render in the partner projection', async () => {
  const { id } = await createDraft({ title: `Estados ${tag}` });
  expect((await publish(id, (await preview(id)).revision)).status).toBe(200);

  // Privileged transitions stand in for the C3/C4 commands on this synthetic Request.
  const state = async () => ((await rest(A.token, `partner_requests?select=partner_state&id=eq.${id}`)).body as { partner_state: string }[])[0]?.partner_state;
  sql(`update public.requests set status = 'needs_sollelio', next_actor = 'sollelio' where id = '${id}'`);
  expect(await state()).toBe('with_sollelio');
  sql(`update public.requests set status = 'completed', next_actor = 'none', completed_at = now() where id = '${id}'`);
  expect(await state()).toBe('done');
  sql(`update public.requests set status = 'cancelled', next_actor = 'none', cancelled_at = now() where id = '${id}'`);
  expect(await state()).toBe('cancelled');
});

test('concurrent creates with one id: one Request, one event, the rest replays', async () => {
  const id = newId();
  const payload = draft({ title: `Concorrente ${tag}` });
  const replies = await Promise.all(Array.from({ length: 5 }, () => command(S.token, 'create', { request_id: id, payload })));
  expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
  expect(replies.filter((r) => r.body.data?.replayed === false)).toHaveLength(1);
  expect(count(`select count(*) from public.requests where id = '${id}'`)).toBe(1);
  expect(count(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.created'`)).toBe(1);

  const other = newId();
  const split = await Promise.all([
    command(S.token, 'create', { request_id: other, payload: draft({ title: 'Um' }) }),
    command(S.token, 'create', { request_id: other, payload: draft({ title: 'Dois' }) }),
  ]);
  expect(split.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(count(`select count(*) from public.requests where id = '${other}'`)).toBe(1);
});

test('concurrent publications: different attempts yield one publication; the same attempt replays', async () => {
  const a = await createDraft({ title: `Publicar A ${tag}` });
  const ra = (await preview(a.id)).revision;
  const attempts = await Promise.all([publish(a.id, ra), publish(a.id, ra), publish(a.id, ra)]);
  expect(attempts.filter((r) => r.status === 200)).toHaveLength(1);
  expect(attempts.filter((r) => r.status === 409).map((r) => r.body.error?.code)).toEqual(['invalid_state', 'invalid_state']);
  expect(count(`select count(*) from public.activity_events where object_id = '${a.id}' and event_type = 'request.published'`)).toBe(1);

  const b = await createDraft({ title: `Publicar B ${tag}` });
  const rb = (await preview(b.id)).revision;
  const key = newId();
  const same = await Promise.all([publish(b.id, rb, key), publish(b.id, rb, key), publish(b.id, rb, key)]);
  expect(same.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(same.filter((r) => r.body.data?.replayed === false)).toHaveLength(1);
  expect(count(`select count(*) from public.activity_events where object_id = '${b.id}' and event_type = 'request.published'`)).toBe(1);
});

test('an edit and a publication racing on one revision: exactly one wins, consistently', async () => {
  const { id } = await createDraft({ title: `Corrida ${tag}` });
  const r = (await preview(id)).revision;
  const [edit, pub] = await Promise.all([
    command(S.token, 'update', { request_id: id, expected_revision: r, payload: without(draft({ title: `Corrida editada ${tag}` }), 'organization_id') }),
    publish(id, r),
  ]);
  expect([edit.status, pub.status].filter((s) => s === 200)).toHaveLength(1);
  const row = sql(`select status || '|' || title from public.requests where id = '${id}'`);
  if (pub.status === 200) {
    expect(edit.body.error?.code).toBe('invalid_state');
    expect(row).toBe(`needs_partner|Corrida ${tag}`);
  } else {
    expect(pub.body.error?.code).toBe('stale_revision');
    expect(row).toBe(`draft|Corrida editada ${tag}`);
  }
});

test('a dependency changing during publication is either seen or waits: never slips through', async () => {
  // Membership: the deactivation holds its row lock; publication waits on it, then sees it.
  const { id } = await createDraft({ title: `Lock membership ${tag}`, assignee_profile_id: B.profileId });
  const rev = (await preview(id)).revision;
  const lock = await holdInTransaction(
    `update public.organization_memberships set status = 'inactive' where organization_id = '${org.O1}' and profile_id = '${B.profileId}'`,
  );
  let settled = false;
  const pending = publish(id, rev).then((reply) => {
    settled = true;
    return reply;
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(settled).toBe(false);
  await lock.release();
  const reply = await pending;
  expect(reply.status).toBe(422);
  expect(reply.body.error?.code).toBe('assignee_not_active_member');
  expect(sql(`select status from public.requests where id = '${id}'`)).toBe('draft');
  sql(`update public.organization_memberships set status = 'active' where organization_id = '${org.O1}' and profile_id = '${B.profileId}'`);

  // Resource: superseding holds the resource row; publication waits, then refuses.
  const withLink = await createDraft({ title: `Lock resource ${tag}`, resource_id: resource.Rlock });
  const rev2 = (await preview(withLink.id)).revision;
  const lock2 = await holdInTransaction(`update public.resources set status = 'superseded' where id = '${resource.Rlock}'`);
  let settled2 = false;
  const pending2 = publish(withLink.id, rev2).then((r) => {
    settled2 = true;
    return r;
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(settled2).toBe(false);
  await lock2.release();
  const reply2 = await pending2;
  expect(reply2.body.error?.code).toBe('resource_not_available');
  expect(sql(`select status from public.requests where id = '${withLink.id}'`)).toBe('draft');
});
