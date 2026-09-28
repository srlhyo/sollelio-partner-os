-- Slice 2, C3 — response loop behaviour. NOT a migration.
--
-- Runs the C3 commands the way the Edge Functions do: as `service_role`, with the
-- actor passed in, on Requests created and published through the C2 commands. Reads
-- are checked the way PostgREST runs them: `authenticated` plus JWT claims. Builds on
-- the 91 fixtures and runs last, so it adds its own people and Requests without
-- disturbing the counts earlier files assert.
--
-- Concurrency needs two sessions and is exercised against the real local stack by
-- the E2E API suite (e2e/request-submission.spec.ts). This file proves the
-- sequential contract: authorization, validation, rounds, replay, history, reads.

-- ---- Helpers -------------------------------------------------------------------
create or replace function pg_temp.svc(q text)
returns jsonb
language plpgsql
as $$
declare
  r jsonb;
begin
  execute 'set local role service_role';
  execute q into r;
  execute 'reset role';
  return r;
end;
$$;

create or replace function pg_temp.svc_err(q text)
returns jsonb
language plpgsql
as $$
declare
  st text;
  msg text;
  det text;
begin
  execute 'set local role service_role';
  begin
    execute q;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text, det = pg_exception_detail;
    execute 'reset role';
    return jsonb_build_object('state', st, 'message', msg, 'detail', nullif(det, '')::jsonb);
  end;
  execute 'reset role';
  return jsonb_build_object('state', 'OK');
end;
$$;

create or replace function pg_temp.expect(label text, got anyelement, want anyelement)
returns void
language plpgsql
as $$
begin
  if got is distinct from want then
    raise exception '% — expected %, got %', label, want, got;
  end if;
end;
$$;

create or replace function pg_temp.expect_fail(label text, q text, want_state text, want_code text default null)
returns void
language plpgsql
as $$
declare
  r jsonb := pg_temp.svc_err(q);
begin
  if r ->> 'state' is distinct from want_state then
    raise exception '% — expected %, got % (%)', label, want_state, r ->> 'state', r;
  end if;
  if want_code is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(r #> '{detail,errors}', '[]'::jsonb)) e
     where e ->> 'code' = want_code) then
    raise exception '% — expected field error %, got %', label, want_code, r;
  end if;
end;
$$;

/* Counts rows as an authenticated caller, the way PostgREST runs a query. */
create or replace function pg_temp.count_as(claims text, query text)
returns bigint
language plpgsql
as $$
declare
  total bigint;
begin
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';
  execute format('select count(*) from (%s) probe', query) into total;
  reset role;
  return total;
end;
$$;

create or replace function pg_temp.must_refuse(claims text, statement text, what text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';
  begin
    execute statement;
    reset role;
    raise exception 'Not refused: %', what;
  exception
    when insufficient_privilege then reset role;
    when others then
      reset role;
      if sqlstate = 'P0001' and sqlerrm like 'Not refused:%' then raise; end if;
      if sqlstate <> '42501' and sqlerrm not like '%row-level security%' then
        raise exception 'Refused for the wrong reason (% / %) on: %', sqlstate, sqlerrm, what;
      end if;
  end;
end;
$$;

create or replace function pg_temp.submit_sql(actor uuid, req uuid, sub uuid, expected uuid, payload jsonb)
returns text language sql as $$
  select format('select public.cmd_submit_request(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::jsonb)',
                actor, req, sub, expected, payload);
$$;

create or replace function pg_temp.return_sql(actor uuid, req uuid, ret uuid, rev integer, kind text, msg text)
returns text language sql as $$
  select format('select public.cmd_return_request_to_partner(%L::uuid, %L::uuid, %L::uuid, %s, %L, %L)',
                actor, req, ret, coalesce(rev::text, 'null'), kind, msg);
$$;

create or replace function pg_temp.complete_sql(actor uuid, req uuid, rev integer)
returns text language sql as $$
  select format('select public.cmd_complete_request(%L::uuid, %L::uuid, %s)', actor, req, coalesce(rev::text, 'null'));
$$;

create or replace function pg_temp.rev(id uuid)
returns integer language sql as $$ select revision from public.requests where id = $1; $$;

create or replace function pg_temp.events(id uuid, kind text)
returns bigint language sql as $$
  select count(*) from public.activity_events where object_id = $1 and event_type = $2;
$$;

create or replace function pg_temp.fid(req uuid, k text)
returns uuid language sql as $$ select id from public.request_fields where request_id = req and key = k; $$;

create or replace function pg_temp.row_hash(tbl text, id uuid)
returns text
language plpgsql
as $$
declare
  h text;
begin
  execute format('select md5(row_to_json(t)::text) from public.%I t where id = $1', tbl) into h using id;
  return h;
end;
$$;

/* Creates and publishes a Request through the C2 commands, as staff. */
create or replace function pg_temp.published(title text, kind text, fields jsonb, assignee uuid)
returns uuid
language plpgsql
as $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  id uuid := gen_random_uuid();
  pv jsonb;
begin
  perform pg_temp.svc(format('select public.cmd_create_request(%L::uuid, %L::uuid, %L::jsonb)', staff, id,
    jsonb_build_object(
      'organization_id', 'bbbbbbbb-0000-0000-0000-000000000001', 'assignee_profile_id', assignee,
      'type', kind, 'title', title, 'requested_action', 'Faça isto.', 'estimated_effort_minutes', 3,
      'internal', jsonb_build_object('completion_criteria', 'Respondido.'),
      'fields', fields)));
  pv := pg_temp.svc(format('select public.cmd_preview_request(%L::uuid, %L::uuid)', staff, id));
  perform pg_temp.svc(format('select public.cmd_publish_request(%L::uuid, %L::uuid, %s, %L::uuid)',
    staff, id, (pv ->> 'revision')::integer, gen_random_uuid()));
  return id;
end;
$$;

-- ---- People of this file -----------------------------------------------------------
-- Staff Hélio aaaa…03; Nádia aaaa…01 (org 1); other organization aaaa…02 (org 2);
-- former member aaaa…04 (inactive in org 1). Added here: a colleague of Nádia (c1)
-- and two members who will lose their membership after being assigned (c2, c4).
insert into auth.users (id, email) values
  ('c3c3c3c3-0000-0000-0000-000000000001', 'c3-colega@example.test'),
  ('c3c3c3c3-0000-0000-0000-000000000002', 'c3-sai@example.test'),
  ('c3c3c3c3-0000-0000-0000-000000000004', 'c3-sai-dois@example.test');
insert into public.profiles (id, auth_user_id, display_name, is_sollelio_staff) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'c3c3c3c3-0000-0000-0000-000000000001', 'Colega C3', false),
  ('aaaaaaaa-0000-0000-0000-0000000000c2', 'c3c3c3c3-0000-0000-0000-000000000002', 'Sai C3', false),
  ('aaaaaaaa-0000-0000-0000-0000000000c4', 'c3c3c3c3-0000-0000-0000-000000000004', 'Sai C3 dois', false);
insert into public.organization_memberships (organization_id, profile_id, status) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000c2', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000c4', 'active');

create table pg_temp.c3 (name text primary key, id uuid not null);

-- 1. Initial round: authorization and validation, all-or-nothing --------------------
do $$
declare
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  r1 uuid;
  draft uuid := gen_random_uuid();
  s1 uuid := 'c3000000-0000-0000-0000-000000000001';
  q1 uuid; q2 uuid; q3 uuid; q4 uuid;
  good jsonb;
begin
  r1 := pg_temp.published('C3 pergunta', 'question', jsonb_build_array(
    jsonb_build_object('label', 'O que achou?', 'type', 'long_text', 'required', true),
    jsonb_build_object('label', 'Como foi?', 'type', 'single_choice', 'required', true,
                       'options', jsonb_build_array('Mais fácil', 'Igual')),
    jsonb_build_object('label', 'Conseguiu?', 'type', 'boolean', 'required', true),
    jsonb_build_object('label', 'Mais alguma coisa?', 'type', 'long_text', 'required', false)), nadia);
  insert into pg_temp.c3 values ('r1', r1);
  q1 := pg_temp.fid(r1, 'q1'); q2 := pg_temp.fid(r1, 'q2'); q3 := pg_temp.fid(r1, 'q3'); q4 := pg_temp.fid(r1, 'q4');

  -- `false` is a real answer to a required boolean; the optional q4 is left out.
  good := jsonb_build_object('answers', jsonb_build_array(
    jsonb_build_object('field_id', q1, 'value', '  Correu bem.  '),
    jsonb_build_object('field_id', q2, 'value', 'Igual'),
    jsonb_build_object('field_id', q3, 'value', false)));

  -- Only the assigned partner with an active membership: everyone else is "not found".
  perform pg_temp.expect_fail('other organization', pg_temp.submit_sql('aaaaaaaa-0000-0000-0000-000000000002', r1, s1, null, good), 'RQ002');
  perform pg_temp.expect_fail('colleague in the same organization', pg_temp.submit_sql('aaaaaaaa-0000-0000-0000-0000000000c1', r1, s1, null, good), 'RQ002');
  perform pg_temp.expect_fail('former member', pg_temp.submit_sql('aaaaaaaa-0000-0000-0000-000000000004', r1, s1, null, good), 'RQ002');
  perform pg_temp.expect_fail('staff as the partner', pg_temp.submit_sql(staff, r1, s1, null, good), 'RQ002');
  perform pg_temp.expect_fail('unknown actor', pg_temp.submit_sql('99999999-9999-9999-9999-999999999999', r1, s1, null, good), 'RQ002');
  perform pg_temp.expect_fail('no actor', pg_temp.submit_sql(null, r1, s1, null, good), 'RQ002');
  perform pg_temp.expect_fail('unknown Request', pg_temp.submit_sql(nadia, gen_random_uuid(), s1, null, good), 'RQ002');

  perform pg_temp.svc(format('select public.cmd_create_request(%L::uuid, %L::uuid, %L::jsonb)', staff, draft,
    jsonb_build_object('organization_id', 'bbbbbbbb-0000-0000-0000-000000000001', 'assignee_profile_id', nadia,
      'type', 'task', 'title', 'Rascunho C3', 'requested_action', 'Ainda não.', 'estimated_effort_minutes', 1)));
  perform pg_temp.expect_fail('draft', pg_temp.submit_sql(nadia, draft, s1, null, jsonb_build_object('answers', '[]'::jsonb)), 'RQ002');

  perform pg_temp.expect_fail('initial round claimed as a return', pg_temp.submit_sql(nadia, r1, s1, gen_random_uuid(), good), 'RQ012');

  perform pg_temp.expect_fail('required missing', pg_temp.submit_sql(nadia, r1, s1, null, jsonb_build_object('answers', jsonb_build_array(
    jsonb_build_object('field_id', q2, 'value', 'Igual'), jsonb_build_object('field_id', q3, 'value', true)))), 'RQ003', 'required');
  perform pg_temp.expect_fail('whitespace is not an answer', pg_temp.submit_sql(nadia, r1, s1, null, jsonb_build_object('answers', jsonb_build_array(
    jsonb_build_object('field_id', q1, 'value', '   '), jsonb_build_object('field_id', q2, 'value', 'Igual'),
    jsonb_build_object('field_id', q3, 'value', true)))), 'RQ003', 'required');
  perform pg_temp.expect_fail('boolean as a string', pg_temp.submit_sql(nadia, r1, s1, null, jsonb_set(good, '{answers,2,value}', '"false"')), 'RQ003', 'invalid_type');
  perform pg_temp.expect_fail('text as a number', pg_temp.submit_sql(nadia, r1, s1, null, jsonb_set(good, '{answers,0,value}', '42')), 'RQ003', 'invalid_type');
  perform pg_temp.expect_fail('choice not an option', pg_temp.submit_sql(nadia, r1, s1, null, jsonb_set(good, '{answers,1,value}', '"Pior"')), 'RQ003', 'invalid_option');
  perform pg_temp.expect_fail('field of another Request', pg_temp.submit_sql(nadia, r1, s1, null,
    jsonb_set(good, '{answers}', (good -> 'answers') || jsonb_build_array(
      jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000001', 'value', true)))), 'RQ003', 'unknown_field');
  perform pg_temp.expect_fail('same field twice', pg_temp.submit_sql(nadia, r1, s1, null,
    jsonb_set(good, '{answers}', (good -> 'answers') || jsonb_build_array(
      jsonb_build_object('field_id', q1, 'value', 'Outra vez.')))), 'RQ003', 'duplicate');
  perform pg_temp.expect_fail('unknown key in an answer', pg_temp.submit_sql(nadia, r1, s1, null,
    jsonb_set(good, '{answers,0}', (good #> '{answers,0}') || '{"label": "x"}')), 'RQ003', 'unknown_field');
  perform pg_temp.expect_fail('unknown top-level key', pg_temp.submit_sql(nadia, r1, s1, null, good || '{"status": "completed"}'), 'RQ003', 'unknown_field');
  perform pg_temp.expect_fail('text over the limit', pg_temp.submit_sql(nadia, r1, s1, null,
    jsonb_set(good, '{answers,0,value}', to_jsonb(repeat('x', 4001)))), 'RQ003', 'too_long');
  perform pg_temp.expect_fail('returned-round response in the initial round', pg_temp.submit_sql(nadia, r1, s1, null,
    good || '{"response": {"text": "x"}}'), 'RQ003', 'not_allowed');
  perform pg_temp.expect_fail('answers not a list', pg_temp.submit_sql(nadia, r1, s1, null, '{"answers": {}}'), 'RQ003', 'invalid');
  perform pg_temp.expect_fail('malformed field id', pg_temp.submit_sql(nadia, r1, s1, null,
    '{"answers": [{"field_id": "q1", "value": "x"}]}'), 'RQ003', 'invalid');

  -- Every rejection wrote nothing.
  perform pg_temp.expect('no submission after rejections', (select count(*) from public.request_submissions where request_id = r1), 0::bigint);
  perform pg_temp.expect('no answer after rejections', (select count(*) from public.request_answers where submission_id = s1), 0::bigint);
  perform pg_temp.expect('no event after rejections', pg_temp.events(r1, 'request.submitted'), 0::bigint);
  perform pg_temp.expect('still with the partner', (select status::text from public.requests where id = r1), 'needs_partner');
end
$$;

-- 2. Initial round: submission, replay, conflict, one per round -------------------------
do $$
declare
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  r1 uuid := (select id from pg_temp.c3 where name = 'r1');
  s1 uuid := 'c3000000-0000-0000-0000-000000000001';
  good jsonb := jsonb_build_object('answers', jsonb_build_array(
    jsonb_build_object('field_id', pg_temp.fid(r1, 'q1'), 'value', '  Correu bem.  '),
    jsonb_build_object('field_id', pg_temp.fid(r1, 'q2'), 'value', 'Igual'),
    jsonb_build_object('field_id', pg_temp.fid(r1, 'q3'), 'value', false)));
  r jsonb;
  before_hash text;
begin
  r := pg_temp.svc(pg_temp.submit_sql(nadia, r1, s1, null, good));
  perform pg_temp.expect('submit replayed', r ->> 'replayed', 'false');
  perform pg_temp.expect('submit return_id', r ->> 'return_id', null::text);
  perform pg_temp.expect('now with Sollelio', (select status || '/' || next_actor from public.requests where id = r1), 'needs_sollelio/sollelio');
  perform pg_temp.expect('one submission', (select count(*) from public.request_submissions where request_id = r1), 1::bigint);
  perform pg_temp.expect('initial round', (select return_id from public.request_submissions where id = s1), null::uuid);
  perform pg_temp.expect('submitted by Nádia', (select submitted_by from public.request_submissions where id = s1), nadia);
  perform pg_temp.expect('three answers, optional omitted', (select count(*) from public.request_answers where submission_id = s1), 3::bigint);
  perform pg_temp.expect('text trimmed', (select value from public.request_answers
    where submission_id = s1 and request_field_id = pg_temp.fid(r1, 'q1')), '"Correu bem."'::jsonb);
  perform pg_temp.expect('false stored as false', (select value from public.request_answers
    where submission_id = s1 and request_field_id = pg_temp.fid(r1, 'q3')), 'false'::jsonb);
  perform pg_temp.expect('one submitted event', pg_temp.events(r1, 'request.submitted'), 1::bigint);
  perform pg_temp.expect('event actor', (select actor_profile_id from public.activity_events
    where object_id = r1 and event_type = 'request.submitted'), nadia);
  perform pg_temp.expect('event has no response text', (select metadata ? 'answers' or metadata::text like '%Correu%'
    from public.activity_events where object_id = r1 and event_type = 'request.submitted'), false);
  perform pg_temp.expect('revision returned', (r ->> 'revision')::integer, pg_temp.rev(r1));

  -- The same attempt again replays, although the Request has moved on.
  before_hash := pg_temp.row_hash('request_submissions', s1);
  r := pg_temp.svc(pg_temp.submit_sql(nadia, r1, s1, null, good));
  perform pg_temp.expect('replay flagged', r ->> 'replayed', 'true');
  perform pg_temp.expect('replay same revision', (r ->> 'revision')::integer, pg_temp.rev(r1));
  perform pg_temp.expect('replay: still one submission', (select count(*) from public.request_submissions where request_id = r1), 1::bigint);
  perform pg_temp.expect('replay: still three answers', (select count(*) from public.request_answers where submission_id = s1), 3::bigint);
  perform pg_temp.expect('replay: still one event', pg_temp.events(r1, 'request.submitted'), 1::bigint);
  perform pg_temp.expect('replay: row untouched', pg_temp.row_hash('request_submissions', s1), before_hash);

  perform pg_temp.expect_fail('same id, other answers', pg_temp.submit_sql(nadia, r1, s1, null,
    jsonb_set(good, '{answers,2,value}', 'true')), 'RQ010');
  perform pg_temp.expect_fail('same id, other actor', pg_temp.submit_sql('aaaaaaaa-0000-0000-0000-0000000000c1', r1, s1, null, good), 'RQ010');
  perform pg_temp.expect_fail('another attempt for an answered round', pg_temp.submit_sql(nadia, r1, gen_random_uuid(), null, good), 'RQ009');

  -- The database itself refuses a second submission for the round, and any rewrite.
  begin
    insert into public.request_submissions (request_id, submitted_by) values (r1, nadia);
    raise exception 'a second initial-round submission was accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.request_submissions set source = 'internal_capture' where id = s1;
    raise exception 'a submission was updated';
  exception when check_violation then null;
  end;
  begin
    update public.request_answers set value = 'true' where submission_id = s1;
    raise exception 'an answer was updated';
  exception when check_violation then null;
  end;
  perform pg_temp.expect('submission intact', pg_temp.row_hash('request_submissions', s1), before_hash);
end
$$;

-- 3. Return and complete: staff only, from needs_sollelio, at the reviewed revision --------
do $$
declare
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  r1 uuid := (select id from pg_temp.c3 where name = 'r1');
  open_r uuid;
  ret1 uuid := 'c3000000-0000-0000-0000-0000000000e1';
  content_before text;
  fields_before text;
  sub_before text;
  r jsonb;
  rev integer;
begin
  open_r := pg_temp.published('C3 ainda com a parceira', 'task', '[]'::jsonb, nadia);
  perform pg_temp.expect_fail('partner cannot return', pg_temp.return_sql(nadia, r1, ret1, pg_temp.rev(r1), 'text', 'x'), 'RQ001');
  perform pg_temp.expect_fail('partner cannot complete', pg_temp.complete_sql(nadia, r1, pg_temp.rev(r1)), 'RQ001');
  perform pg_temp.expect_fail('return while with the partner', pg_temp.return_sql(staff, open_r, ret1, pg_temp.rev(open_r), 'text', 'x'), 'RQ009');
  perform pg_temp.expect_fail('complete while with the partner', pg_temp.complete_sql(staff, open_r, pg_temp.rev(open_r)), 'RQ009');
  perform pg_temp.expect_fail('return at an old revision', pg_temp.return_sql(staff, r1, ret1, pg_temp.rev(r1) - 1, 'text', 'x'), 'RQ008');
  perform pg_temp.expect_fail('complete at an old revision', pg_temp.complete_sql(staff, r1, pg_temp.rev(r1) - 1), 'RQ008');
  perform pg_temp.expect_fail('return without a message', pg_temp.return_sql(staff, r1, ret1, pg_temp.rev(r1), 'text', '   '), 'RQ003', 'required');
  perform pg_temp.expect_fail('return message too long', pg_temp.return_sql(staff, r1, ret1, pg_temp.rev(r1), 'text', repeat('x', 2001)), 'RQ003', 'too_long');
  perform pg_temp.expect_fail('return with another response type', pg_temp.return_sql(staff, r1, ret1, pg_temp.rev(r1), 'single_choice', 'x'), 'RQ003', 'required');
  perform pg_temp.expect_fail('return of an unknown Request', pg_temp.return_sql(staff, gen_random_uuid(), ret1, 1, 'text', 'x'), 'RQ002');
  perform pg_temp.expect('no return after rejections', (select count(*) from public.request_returns where request_id = r1), 0::bigint);
  perform pg_temp.expect('no return event after rejections', pg_temp.events(r1, 'request.returned_to_partner'), 0::bigint);

  content_before := (select md5(concat_ws('|', title, context, requested_action, estimated_effort_minutes, type))
                       from public.requests where id = r1);
  fields_before := (select md5(string_agg(row_to_json(f)::text, ',' order by f.id)) from public.request_fields f where request_id = r1);
  sub_before := pg_temp.row_hash('request_submissions', 'c3000000-0000-0000-0000-000000000001');

  rev := pg_temp.rev(r1);
  r := pg_temp.svc(pg_temp.return_sql(staff, r1, ret1, rev, 'text',
    '  Falta só confirmar se isto também acontece no telemóvel.  '));
  perform pg_temp.expect('return replayed', r ->> 'replayed', 'false');
  perform pg_temp.expect('back with the partner', (select status || '/' || next_actor from public.requests where id = r1), 'needs_partner/partner');
  perform pg_temp.expect('one return', (select count(*) from public.request_returns where request_id = r1), 1::bigint);
  perform pg_temp.expect('message trimmed', (select message from public.request_returns where id = ret1),
    'Falta só confirmar se isto também acontece no telemóvel.');
  perform pg_temp.expect('returned by staff', (select created_by from public.request_returns where id = ret1), staff);
  perform pg_temp.expect('one return event', pg_temp.events(r1, 'request.returned_to_partner'), 1::bigint);
  perform pg_temp.expect('published content untouched', (select md5(concat_ws('|', title, context, requested_action,
    estimated_effort_minutes, type)) from public.requests where id = r1), content_before);
  perform pg_temp.expect('original fields untouched (no return_reply)',
    (select md5(string_agg(row_to_json(f)::text, ',' order by f.id)) from public.request_fields f where request_id = r1), fields_before);
  perform pg_temp.expect('initial submission untouched', pg_temp.row_hash('request_submissions', 'c3000000-0000-0000-0000-000000000001'), sub_before);

  r := pg_temp.svc(pg_temp.return_sql(staff, r1, ret1, rev, 'text', 'Falta só confirmar se isto também acontece no telemóvel.'));
  perform pg_temp.expect('return replay flagged', r ->> 'replayed', 'true');
  perform pg_temp.expect('return replay: one return', (select count(*) from public.request_returns where request_id = r1), 1::bigint);
  perform pg_temp.expect('return replay: one event', pg_temp.events(r1, 'request.returned_to_partner'), 1::bigint);
  perform pg_temp.expect_fail('same return id, other message', pg_temp.return_sql(staff, r1, ret1, rev, 'text', 'Outra coisa.'), 'RQ010');
  perform pg_temp.expect_fail('same return id, other type', pg_temp.return_sql(staff, r1, ret1, rev, 'approval',
    'Falta só confirmar se isto também acontece no telemóvel.'), 'RQ010');

  begin
    update public.request_returns set message = 'reescrita' where id = ret1;
    raise exception 'a return was updated';
  exception when check_violation then null;
  end;
end
$$;

-- 4. Returned text round -----------------------------------------------------------
do $$
declare
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  r1 uuid := (select id from pg_temp.c3 where name = 'r1');
  ret1 uuid := 'c3000000-0000-0000-0000-0000000000e1';
  s2 uuid := 'c3000000-0000-0000-0000-000000000002';
  initial_hash text := pg_temp.row_hash('request_submissions', 'c3000000-0000-0000-0000-000000000001');
  r jsonb;
begin
  perform pg_temp.expect_fail('answering the initial round again', pg_temp.submit_sql(nadia, r1, s2, null,
    '{"answers": []}'), 'RQ012');
  perform pg_temp.expect_fail('original answers in a returned round', pg_temp.submit_sql(nadia, r1, s2, ret1,
    jsonb_build_object('answers', jsonb_build_array(jsonb_build_object('field_id', pg_temp.fid(r1, 'q3'), 'value', true)),
                       'response', jsonb_build_object('text', 'Sim.'))), 'RQ003', 'not_allowed');
  perform pg_temp.expect_fail('empty returned text', pg_temp.submit_sql(nadia, r1, s2, ret1, '{"response": {"text": "  "}}'), 'RQ003', 'required');
  perform pg_temp.expect_fail('no response', pg_temp.submit_sql(nadia, r1, s2, ret1, '{}'), 'RQ003', 'invalid');
  perform pg_temp.expect_fail('text as a number', pg_temp.submit_sql(nadia, r1, s2, ret1, '{"response": {"text": 3}}'), 'RQ003', 'required');
  perform pg_temp.expect_fail('decision in a text round', pg_temp.submit_sql(nadia, r1, s2, ret1,
    '{"response": {"text": "Sim.", "decision": "approve"}}'), 'RQ003', 'unknown_field');
  perform pg_temp.expect_fail('returned text over the limit', pg_temp.submit_sql(nadia, r1, s2, ret1,
    jsonb_build_object('response', jsonb_build_object('text', repeat('x', 4001)))), 'RQ003', 'too_long');
  perform pg_temp.expect('no returned submission after rejections', (select count(*) from public.request_submissions where id = s2), 0::bigint);

  r := pg_temp.svc(pg_temp.submit_sql(nadia, r1, s2, ret1, '{"response": {"text": "  Sim, também no telemóvel.  "}}'));
  perform pg_temp.expect('returned round replayed', r ->> 'replayed', 'false');
  perform pg_temp.expect('returned round id', (r ->> 'return_id')::uuid, ret1);
  perform pg_temp.expect('stored in the round', (select return_id || '|' || response_text from public.request_submissions where id = s2),
    ret1 || '|Sim, também no telemóvel.');
  perform pg_temp.expect('no original answers in the round', (select count(*) from public.request_answers where submission_id = s2), 0::bigint);
  perform pg_temp.expect('with Sollelio again', (select status::text from public.requests where id = r1), 'needs_sollelio');
  perform pg_temp.expect('two submissions', (select count(*) from public.request_submissions where request_id = r1), 2::bigint);
  perform pg_temp.expect('two submitted events', pg_temp.events(r1, 'request.submitted'), 2::bigint);
  perform pg_temp.expect('initial submission still intact', pg_temp.row_hash('request_submissions', 'c3000000-0000-0000-0000-000000000001'), initial_hash);

  r := pg_temp.svc(pg_temp.submit_sql(nadia, r1, s2, ret1, '{"response": {"text": "  Sim, também no telemóvel.  "}}'));
  perform pg_temp.expect('returned round replay', r ->> 'replayed', 'true');
  perform pg_temp.expect_fail('returned round, same id, other text', pg_temp.submit_sql(nadia, r1, s2, ret1,
    '{"response": {"text": "Não."}}'), 'RQ010');

  -- Structural backstops: a returned-round submission never carries original answers,
  -- and a round's response must match what the return asked for.
  begin
    insert into public.request_answers (submission_id, request_field_id, value) values (s2, pg_temp.fid(r1, 'q3'), 'true');
    raise exception 'an answer was attached to a returned round';
  exception when check_violation then null;
  end;
end
$$;

-- 5. Approval rounds, stale round across a new return ------------------------------------
do $$
declare
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  r1 uuid := (select id from pg_temp.c3 where name = 'r1');
  ret1 uuid := 'c3000000-0000-0000-0000-0000000000e1';
  ret2 uuid := 'c3000000-0000-0000-0000-0000000000e2';
  ret3 uuid := 'c3000000-0000-0000-0000-0000000000e3';
  s3 uuid := 'c3000000-0000-0000-0000-000000000003';
  s4 uuid := 'c3000000-0000-0000-0000-000000000004';
  r jsonb;
begin
  perform pg_temp.svc(pg_temp.return_sql(staff, r1, ret2, pg_temp.rev(r1), 'approval', 'Corrigimos o texto. Pode aprovar?'));

  -- The partner still looking at the previous round is told it changed.
  perform pg_temp.expect_fail('stale round', pg_temp.submit_sql(nadia, r1, s3, ret1, '{"response": {"text": "x"}}'), 'RQ012');
  perform pg_temp.expect('stale round wrote nothing', (select count(*) from public.request_submissions where id = s3), 0::bigint);

  perform pg_temp.expect_fail('text in an approval round', pg_temp.submit_sql(nadia, r1, s3, ret2, '{"response": {"text": "Sim"}}'), 'RQ003', 'unknown_field');
  perform pg_temp.expect_fail('invalid decision', pg_temp.submit_sql(nadia, r1, s3, ret2, '{"response": {"decision": "talvez"}}'), 'RQ003', 'required');
  perform pg_temp.expect_fail('missing decision', pg_temp.submit_sql(nadia, r1, s3, ret2, '{"response": {"notes": "x"}}'), 'RQ003', 'required');
  perform pg_temp.expect_fail('notes with approve', pg_temp.submit_sql(nadia, r1, s3, ret2,
    '{"response": {"decision": "approve", "notes": "Mudem a cor."}}'), 'RQ003', 'notes_not_allowed');
  perform pg_temp.expect_fail('notes not text', pg_temp.submit_sql(nadia, r1, s3, ret2,
    '{"response": {"decision": "needs_changes", "notes": 5}}'), 'RQ003', 'invalid_type');

  r := pg_temp.svc(pg_temp.submit_sql(nadia, r1, s3, ret2, '{"response": {"decision": "needs_changes", "notes": "  Falta o logótipo.  "}}'));
  perform pg_temp.expect('approval round stored', (select response_decision || '|' || response_notes from public.request_submissions where id = s3),
    'needs_changes|Falta o logótipo.');

  perform pg_temp.svc(pg_temp.return_sql(staff, r1, ret3, pg_temp.rev(r1), 'approval', 'Já está o logótipo. Pode aprovar?'));
  r := pg_temp.svc(pg_temp.submit_sql(nadia, r1, s4, ret3, '{"response": {"decision": "approve", "notes": null}}'));
  perform pg_temp.expect('approve without notes', (select response_decision || '|' || coalesce(response_notes, '∅')
    from public.request_submissions where id = s4), 'approve|∅');
end
$$;

-- 6. Completion, and the history of the whole loop --------------------------------------
do $$
declare
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  r1 uuid := (select id from pg_temp.c3 where name = 'r1');
  r jsonb;
begin
  r := pg_temp.svc(pg_temp.complete_sql(staff, r1, pg_temp.rev(r1)));
  perform pg_temp.expect('completed', (select status || '/' || next_actor || '/' || (completed_at is not null)
    from public.requests where id = r1), 'completed/none/true');
  perform pg_temp.expect('one completed event', pg_temp.events(r1, 'request.completed'), 1::bigint);
  perform pg_temp.expect_fail('complete twice', pg_temp.complete_sql(staff, r1, pg_temp.rev(r1)), 'RQ009');
  perform pg_temp.expect_fail('return after completion', pg_temp.return_sql(staff, r1, gen_random_uuid(), pg_temp.rev(r1), 'text', 'x'), 'RQ009');
  perform pg_temp.expect_fail('submit after completion', pg_temp.submit_sql(nadia, r1, gen_random_uuid(), null, '{"answers": []}'), 'RQ009');

  -- Four rounds, three returns, each answered once, in order, nothing rewritten.
  perform pg_temp.expect('rounds', (select string_agg(coalesce(return_id::text, 'initial'), ',' order by created_at)
    from public.request_submissions where request_id = r1),
    'initial,c3000000-0000-0000-0000-0000000000e1,c3000000-0000-0000-0000-0000000000e2,c3000000-0000-0000-0000-0000000000e3');
  perform pg_temp.expect('returns in order', (select string_agg(id::text, ',' order by created_at)
    from public.request_returns where request_id = r1),
    'c3000000-0000-0000-0000-0000000000e1,c3000000-0000-0000-0000-0000000000e2,c3000000-0000-0000-0000-0000000000e3');
  -- Several commands share one transaction here, so events are counted, not ordered.
  perform pg_temp.expect('events', (select string_agg(event_type || '=' || n, ',' order by event_type) from (
      select event_type, count(*) n from public.activity_events where object_id = r1 group by event_type) x),
    'request.completed=1,request.created=1,request.published=1,request.returned_to_partner=3,request.submitted=4');
end
$$;

-- 7. Approval Requests and Requests without fields, initial round ----------------------
do $$
declare
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  ra uuid;
  rt uuid;
  a uuid; n uuid;
  r jsonb;
begin
  ra := pg_temp.published('C3 aprovação', 'approval', '[]'::jsonb, nadia);
  a := pg_temp.fid(ra, 'approval'); n := pg_temp.fid(ra, 'approval_notes');
  perform pg_temp.expect_fail('approval notes with approve', pg_temp.submit_sql(nadia, ra, gen_random_uuid(), null,
    jsonb_build_object('answers', jsonb_build_array(jsonb_build_object('field_id', a, 'value', 'approve'),
                                                    jsonb_build_object('field_id', n, 'value', 'Mudem.')))), 'RQ003', 'notes_not_allowed');
  perform pg_temp.expect_fail('approval not a decision', pg_temp.submit_sql(nadia, ra, gen_random_uuid(), null,
    jsonb_build_object('answers', jsonb_build_array(jsonb_build_object('field_id', a, 'value', 'sim')))), 'RQ003', 'invalid_option');
  perform pg_temp.expect_fail('approval as a boolean', pg_temp.submit_sql(nadia, ra, gen_random_uuid(), null,
    jsonb_build_object('answers', jsonb_build_array(jsonb_build_object('field_id', a, 'value', true)))), 'RQ003', 'invalid_type');
  perform pg_temp.expect_fail('approval missing', pg_temp.submit_sql(nadia, ra, gen_random_uuid(), null, '{"answers": []}'), 'RQ003', 'required');

  r := pg_temp.svc(pg_temp.submit_sql(nadia, ra, gen_random_uuid(), null,
    jsonb_build_object('answers', jsonb_build_array(jsonb_build_object('field_id', a, 'value', 'needs_changes'),
                                                    jsonb_build_object('field_id', n, 'value', 'Falta o logótipo.')))));
  perform pg_temp.expect('needs changes with notes', (select count(*) from public.request_answers ans
    join public.request_submissions s on s.id = ans.submission_id where s.request_id = ra), 2::bigint);

  -- A task may have no fields: an empty list of answers is a complete response.
  rt := pg_temp.published('C3 tarefa', 'task', '[]'::jsonb, nadia);
  r := pg_temp.svc(pg_temp.submit_sql(nadia, rt, gen_random_uuid(), null, '{"answers": []}'));
  perform pg_temp.expect('task submitted', (select status::text from public.requests where id = rt), 'needs_sollelio');
end
$$;

-- 8. A membership that ends after assignment ---------------------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  leaver uuid := 'aaaaaaaa-0000-0000-0000-0000000000c2';
  leaver2 uuid := 'aaaaaaaa-0000-0000-0000-0000000000c4';
  rl uuid;
  rl2 uuid;
begin
  rl := pg_temp.published('C3 quem sai', 'task', '[]'::jsonb, leaver);
  insert into pg_temp.c3 values ('rl', rl);
  update public.organization_memberships set status = 'inactive'
   where profile_id = leaver and organization_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  perform pg_temp.expect_fail('inactive member cannot submit', pg_temp.submit_sql(leaver, rl, gen_random_uuid(), null, '{"answers": []}'), 'RQ002');

  rl2 := pg_temp.published('C3 quem sai depois', 'task', '[]'::jsonb, leaver2);
  perform pg_temp.svc(pg_temp.submit_sql(leaver2, rl2, gen_random_uuid(), null, '{"answers": []}'));
  update public.organization_memberships set status = 'inactive'
   where profile_id = leaver2 and organization_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  perform pg_temp.expect_fail('no return to a former member', pg_temp.return_sql(staff, rl2, gen_random_uuid(), pg_temp.rev(rl2), 'text', 'Mais uma coisa.'), 'RQ005');
  perform pg_temp.expect('still with Sollelio', (select status::text from public.requests where id = rl2), 'needs_sollelio');
end
$$;

-- 9. Reads: tenant isolation, own data only, no internal columns, no writes -------------
do $$
declare
  nadia   text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  other   text := '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  helio   text := '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
  colleague text := '{"sub":"c3c3c3c3-0000-0000-0000-000000000001","role":"authenticated"}';
  leaver  text := '{"sub":"c3c3c3c3-0000-0000-0000-000000000002","role":"authenticated"}';
  noprof  text := '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
  r1 uuid := (select id from pg_temp.c3 where name = 'r1');
  rl uuid := (select id from pg_temp.c3 where name = 'rl');
  q text;
begin
  q := format('select * from public.partner_request_returns where request_id = %L', r1);
  perform pg_temp.expect('Nádia reads the returns of her Request', pg_temp.count_as(nadia, q), 3::bigint);
  perform pg_temp.expect('other organization reads none', pg_temp.count_as(other, q), 0::bigint);
  perform pg_temp.expect('colleague reads none', pg_temp.count_as(colleague, q), 0::bigint);
  perform pg_temp.expect('no-profile caller reads none', pg_temp.count_as(noprof, q), 0::bigint);
  perform pg_temp.expect('staff has no partner projection rows', pg_temp.count_as(helio, q), 0::bigint);

  q := format('select id from public.request_returns where request_id = %L', r1);
  perform pg_temp.expect('Nádia cannot read the returns table', pg_temp.count_as(nadia, q), 0::bigint);
  perform pg_temp.expect('staff reads the returns table', pg_temp.count_as(helio, q), 3::bigint);

  q := format('select id, return_id, response_text, response_decision, response_notes from public.request_submissions where request_id = %L', r1);
  perform pg_temp.expect('Nádia reads her four submissions', pg_temp.count_as(nadia, q), 4::bigint);
  perform pg_temp.expect('other organization reads no submission', pg_temp.count_as(other, q), 0::bigint);
  perform pg_temp.expect('colleague reads no submission', pg_temp.count_as(colleague, q), 0::bigint);
  perform pg_temp.expect('staff reads all four', pg_temp.count_as(helio, q), 4::bigint);

  q := format('select a.id from public.request_answers a join public.request_submissions s on s.id = a.submission_id where s.request_id = %L', r1);
  perform pg_temp.expect('Nádia reads her answers', pg_temp.count_as(nadia, q), 3::bigint);
  perform pg_temp.expect('colleague reads no answer', pg_temp.count_as(colleague, q), 0::bigint);

  -- A member who lost the membership loses the Request and its returns.
  perform pg_temp.expect('former member reads nothing', pg_temp.count_as(leaver,
    format('select * from public.partner_requests where id = %L', rl)), 0::bigint);

  -- created_by is not part of the partner shape (asserted in 97); anon reads nothing.
  perform set_config('request.jwt.claims', '', true);
  begin
    execute 'set local role anon';
    perform count(*) from public.partner_request_returns;
    reset role;
    raise exception 'anon can read partner_request_returns';
  exception when insufficient_privilege then reset role;
  end;

  -- No write path outside the commands: not for the partner, not for staff.
  perform pg_temp.must_refuse(nadia, format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (gen_random_uuid(), %L, ''text'', ''x'', ''aaaaaaaa-0000-0000-0000-000000000001'')', r1),
    'partner INSERT into request_returns');
  perform pg_temp.must_refuse(helio, format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (gen_random_uuid(), %L, ''text'', ''x'', ''aaaaaaaa-0000-0000-0000-000000000003'')', r1),
    'staff INSERT into request_returns');
  perform pg_temp.must_refuse(nadia, format(
    'insert into public.request_submissions (request_id, submitted_by, return_id, response_text) values (%L, ''aaaaaaaa-0000-0000-0000-000000000001'', ''c3000000-0000-0000-0000-0000000000e1'', ''x'')', r1),
    'partner INSERT of a returned-round submission');
  perform pg_temp.must_refuse(nadia, format('update public.requests set status = ''needs_sollelio'', next_actor = ''sollelio'' where id = %L', r1),
    'partner lifecycle UPDATE');
  perform pg_temp.must_refuse(helio, format('update public.requests set status = ''completed'', next_actor = ''none'', completed_at = now() where id = %L', r1),
    'staff lifecycle UPDATE outside a command');
  perform pg_temp.must_refuse(nadia, 'update public.request_submissions set response_text = ''x''', 'partner UPDATE of a submission');
  perform pg_temp.must_refuse(nadia, 'delete from public.request_returns', 'partner DELETE of a return');

  -- The C3 commands are not reachable by the API roles.
  perform pg_temp.must_refuse(nadia, format(
    'select public.cmd_submit_request(''aaaaaaaa-0000-0000-0000-000000000001'', %L, gen_random_uuid(), null, ''{"answers": []}'')', r1),
    'partner calling cmd_submit_request directly');
  perform pg_temp.must_refuse(helio, format('select public.cmd_complete_request(''aaaaaaaa-0000-0000-0000-000000000003'', %L, 1)', r1),
    'staff calling cmd_complete_request directly');
  perform pg_temp.must_refuse(helio, format(
    'select public.cmd_return_request_to_partner(''aaaaaaaa-0000-0000-0000-000000000003'', %L, gen_random_uuid(), 1, ''text'', ''x'')', r1),
    'staff calling cmd_return_request_to_partner directly');
end
$$;

select 'slice 2 C3 commands verified' as result;
