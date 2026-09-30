-- Slice 2, C4 — cancellation: schema, privileges, command behaviour, reads. NOT a migration.
--
-- Runs `cmd_cancel_request` the way the Edge Function does (as `service_role`, actor
-- passed in), on Requests created, published, answered and returned through the C2/C3
-- commands. Reads are checked the way PostgREST runs them (`authenticated` + JWT
-- claims). Builds on the 91 fixtures and runs last, with its own people and Requests.
--
-- Concurrency needs two sessions and is exercised against the real local stack by the
-- E2E API suite (e2e/request-cancellation.spec.ts). This file proves the sequential
-- outcomes of every race: whichever command commits first, the other one's re-check.

-- ---- Helpers (as in 98) ------------------------------------------------------------
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

create or replace function pg_temp.value_as(claims text, query text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';
  execute query into v;
  reset role;
  return v;
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

/* Asserts a direct statement (as the table owner) fails with check_violation. */
create or replace function pg_temp.must_violate(statement text, what text)
returns void
language plpgsql
as $$
begin
  begin
    execute statement;
  exception when check_violation then return;
  end;
  raise exception 'Invariant not enforced: %', what;
end;
$$;

create or replace function pg_temp.cancel_sql(actor uuid, req uuid, rev integer, reason text)
returns text language sql as $$
  select format('select public.cmd_cancel_request(%L::uuid, %L::uuid, %s, %L)', actor, req, coalesce(rev::text, 'null'), reason);
$$;

create or replace function pg_temp.submit_sql(actor uuid, req uuid, sub uuid, expected uuid, payload jsonb)
returns text language sql as $$
  select format('select public.cmd_submit_request(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::jsonb)', actor, req, sub, expected, payload);
$$;

create or replace function pg_temp.rev(id uuid)
returns integer language sql as $$ select revision from public.requests where id = $1; $$;

create or replace function pg_temp.state(id uuid)
returns text language sql as $$
  select status || '/' || next_actor || '/' || (cancelled_at is not null) || '/' || coalesce(cancellation_reason, '∅')
    from public.requests where id = $1;
$$;

create or replace function pg_temp.events(id uuid, kind text)
returns bigint language sql as $$
  select count(*) from public.activity_events where object_id = $1 and event_type = $2;
$$;

create or replace function pg_temp.history_hash(req uuid)
returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(md5(row_to_json(s)::text), ',' order by s.id) from public.request_submissions s where s.request_id = req),
    (select string_agg(md5(row_to_json(a)::text), ',' order by a.id) from public.request_answers a
       join public.request_submissions s on s.id = a.submission_id where s.request_id = req),
    (select string_agg(md5(row_to_json(r)::text), ',' order by r.id) from public.request_returns r where r.request_id = req),
    (select string_agg(md5(row_to_json(f)::text), ',' order by f.id) from public.request_fields f where f.request_id = req),
    (select md5(concat_ws('|', title, context, requested_action, estimated_effort_minutes, type, due_at, published_at))
       from public.requests where id = req)));
$$;

/* A draft through C2, as staff; published unless asked not to. */
create or replace function pg_temp.request(title text, publish boolean default true, assignee uuid default 'aaaaaaaa-0000-0000-0000-000000000001')
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
      'type', 'question', 'title', title, 'requested_action', 'Faça isto.', 'estimated_effort_minutes', 3,
      'internal', jsonb_build_object('completion_criteria', 'Respondido.'),
      'fields', jsonb_build_array(jsonb_build_object('label', 'Correu bem?', 'type', 'boolean', 'required', true)))));
  if publish then
    pv := pg_temp.svc(format('select public.cmd_preview_request(%L::uuid, %L::uuid)', staff, id));
    perform pg_temp.svc(format('select public.cmd_publish_request(%L::uuid, %L::uuid, %s, %L::uuid)',
      staff, id, (pv ->> 'revision')::integer, gen_random_uuid()));
  end if;
  return id;
end;
$$;

create or replace function pg_temp.answer(req uuid)
returns jsonb language sql as $$
  select jsonb_build_object('answers', jsonb_build_array(jsonb_build_object(
    'field_id', (select id from public.request_fields where request_id = req and key = 'q1'), 'value', false)));
$$;

-- A colleague of Nádia in the same organization (not the assignee), and a partner of
-- another organization (the 91 fixture's aaaa…02).
insert into auth.users (id, email) values ('c4c4c4c4-0000-0000-0000-000000000001', 'c4-colega@example.test');
insert into public.profiles (id, auth_user_id, display_name, is_sollelio_staff)
values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'c4c4c4c4-0000-0000-0000-000000000001', 'Colega C4', false);
insert into public.organization_memberships (organization_id, profile_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'active');

create table pg_temp.c4 (name text primary key, id uuid not null);

-- 1. Schema and privileges -----------------------------------------------------------
do $$
declare
  got text[];
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'requests'
                  and column_name = 'cancellation_reason' and data_type = 'text' and is_nullable = 'YES') then
    raise exception 'requests.cancellation_reason missing or not nullable text.';
  end if;
  select array_agg(conname::text order by conname) into got from pg_constraint
   where conrelid = 'public.requests'::regclass and conname like 'requests_cancellation_reason_%';
  if got is distinct from array['requests_cancellation_reason_shape', 'requests_cancellation_reason_state'] then
    raise exception 'cancellation constraints are %', got;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'requests_cancelled_is_final' and tgrelid = 'public.requests'::regclass) then
    raise exception 'requests_cancelled_is_final trigger missing.';
  end if;

  select array_agg(column_name::text order by ordinal_position) into got
    from information_schema.columns where table_schema = 'public' and table_name = 'partner_requests';
  if array_length(got, 1) <> 17 or got[17] <> 'cancellation_reason' then
    raise exception 'partner_requests should append cancellation_reason as its seventeenth column: %', got;
  end if;

  if has_function_privilege('anon', 'public.cmd_cancel_request(uuid, uuid, integer, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cmd_cancel_request(uuid, uuid, integer, text)', 'EXECUTE')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = 'public.cmd_cancel_request(uuid, uuid, integer, text)'::regprocedure and a.grantee = 0)
     or not has_function_privilege('service_role', 'public.cmd_cancel_request(uuid, uuid, integer, text)', 'EXECUTE') then
    raise exception 'cmd_cancel_request must be executable by service_role only.';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.cmd_cancel_request(uuid, uuid, integer, text)'::regprocedure) then
    raise exception 'cmd_cancel_request is SECURITY DEFINER.';
  end if;

  -- The trim helper the reason's constraint and the command share: service_role only.
  if has_function_privilege('anon', 'app.request_trim(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app.request_trim(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'app.request_trim(text)', 'EXECUTE') then
    raise exception 'app.request_trim must be executable by service_role only.';
  end if;
  if app.request_trim(E'\n\t \u00A0\u2003 O evento\nfoi adiado. \r\n\u3000\uFEFF') <> E'O evento\nfoi adiado.'
     or app.request_trim(E' \n\t\r\u00A0\u2028 ') <> '' then
    raise exception 'app.request_trim does not trim every whitespace character a person can type or paste.';
  end if;

  -- Every Request command keeps the same posture: service_role only, INVOKER.
  select array_agg(p.proname::text order by p.proname) into got
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'cmd\_%' escape '\'
     and not p.prosecdef
     and has_function_privilege('service_role', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE');
  if got is distinct from array['cmd_cancel_request', 'cmd_complete_request', 'cmd_create_request', 'cmd_preview_request',
                                'cmd_publish_request', 'cmd_return_request_to_partner', 'cmd_submit_request',
                                'cmd_update_request_draft'] then
    raise exception 'Request command posture changed: %', got;
  end if;
end
$$;

-- 2. Cancelling a draft ------------------------------------------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  nadia text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  d uuid := pg_temp.request('C4 rascunho', false);
  rev0 integer := pg_temp.rev(d);
  r jsonb;
begin
  -- The draft editor never accepts the reason: it is not editable content.
  perform pg_temp.expect_fail('draft update with a reason', format(
    'select public.cmd_update_request_draft(%L::uuid, %L::uuid, %s, %L::jsonb)', staff, d, rev0,
    jsonb_build_object('assignee_profile_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'type', 'task', 'title', 'x',
                       'requested_action', 'y', 'estimated_effort_minutes', 1, 'cancellation_reason', 'z')), 'RQ003', 'unknown_field');

  r := pg_temp.svc(pg_temp.cancel_sql(staff, d, rev0, '   Já não é preciso.   '));
  perform pg_temp.expect('draft cancelled', pg_temp.state(d), 'cancelled/none/true/Já não é preciso.');
  perform pg_temp.expect('draft stays unpublished', (select published_at from public.requests where id = d), null::timestamptz);
  perform pg_temp.expect('revision moved once', pg_temp.rev(d), rev0 + 1);
  perform pg_temp.expect('result revision', (r ->> 'revision')::integer, rev0 + 1);
  perform pg_temp.expect('one cancelled event', pg_temp.events(d, 'request.cancelled'), 1::bigint);
  perform pg_temp.expect('event metadata', (select metadata from public.activity_events where object_id = d and event_type = 'request.cancelled'),
    jsonb_build_object('revision', rev0 + 1, 'previous_status', 'draft'));
  perform pg_temp.expect('event carries no reason', (select metadata::text like '%preciso%' from public.activity_events
    where object_id = d and event_type = 'request.cancelled'), false);
  perform pg_temp.expect('cancelled draft invisible to the assignee', pg_temp.count_as(nadia,
    format('select id from public.partner_requests where id = %L', d)), 0::bigint);
  perform pg_temp.expect_fail('a cancelled draft cannot be edited', format(
    'select public.cmd_update_request_draft(%L::uuid, %L::uuid, %s, %L::jsonb)', staff, d, pg_temp.rev(d),
    jsonb_build_object('assignee_profile_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'type', 'task', 'title', 'x',
                       'requested_action', 'y', 'estimated_effort_minutes', 1)), 'RQ009');
  perform pg_temp.expect_fail('a cancelled draft cannot be published', format(
    'select public.cmd_publish_request(%L::uuid, %L::uuid, %s, %L::uuid)', staff, d, pg_temp.rev(d), gen_random_uuid()), 'RQ009');
end
$$;

-- 3. Rejections write nothing -----------------------------------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  p uuid := pg_temp.request('C4 rejeições');
  before text;
begin
  before := pg_temp.state(p) || pg_temp.rev(p);
  perform pg_temp.expect_fail('partner cannot cancel', pg_temp.cancel_sql(nadia, p, pg_temp.rev(p), 'x'), 'RQ001');
  perform pg_temp.expect_fail('unknown actor cannot cancel', pg_temp.cancel_sql('99999999-9999-9999-9999-999999999999', p, pg_temp.rev(p), 'x'), 'RQ001');
  perform pg_temp.expect_fail('unknown Request', pg_temp.cancel_sql(staff, gen_random_uuid(), 1, 'x'), 'RQ002');
  perform pg_temp.expect_fail('stale revision', pg_temp.cancel_sql(staff, p, pg_temp.rev(p) - 1, 'x'), 'RQ008');
  perform pg_temp.expect_fail('no revision', pg_temp.cancel_sql(staff, p, null, 'x'), 'RQ008');
  perform pg_temp.expect_fail('blank reason', pg_temp.cancel_sql(staff, p, pg_temp.rev(p), '   '), 'RQ003', 'required');
  perform pg_temp.expect_fail('line breaks only', pg_temp.cancel_sql(staff, p, pg_temp.rev(p), E' \n\r\n\t '), 'RQ003', 'required');
  perform pg_temp.expect_fail('no-break spaces only', pg_temp.cancel_sql(staff, p, pg_temp.rev(p), E'\u00A0\u3000\u2003'), 'RQ003', 'required');
  perform pg_temp.expect_fail('no reason', pg_temp.cancel_sql(staff, p, pg_temp.rev(p), null), 'RQ003', 'required');
  perform pg_temp.expect_fail('reason too long', pg_temp.cancel_sql(staff, p, pg_temp.rev(p), repeat('x', 2001)), 'RQ003', 'too_long');
  perform pg_temp.expect('nothing changed', pg_temp.state(p) || pg_temp.rev(p), before);
  perform pg_temp.expect('no cancelled event', pg_temp.events(p, 'request.cancelled'), 0::bigint);
  -- Exactly 2000 characters is accepted.
  perform pg_temp.svc(pg_temp.cancel_sql(staff, p, pg_temp.rev(p), repeat('y', 2000)));
  perform pg_temp.expect('2000 characters accepted', length((select cancellation_reason from public.requests where id = p)), 2000);
  -- Cancelled is final: cancelling again is never a silent success, even with the new revision.
  perform pg_temp.expect_fail('cancel twice', pg_temp.cancel_sql(staff, p, pg_temp.rev(p), 'outra vez'), 'RQ009');
  perform pg_temp.expect('still one event', pg_temp.events(p, 'request.cancelled'), 1::bigint);
end
$$;

-- 4. Cancelling a published Request the partner has not answered -------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  nadia text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  other text := '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  colleague text := '{"sub":"c4c4c4c4-0000-0000-0000-000000000001","role":"authenticated"}';
  p uuid := pg_temp.request('C4 com a parceira');
  q text;
begin
  insert into pg_temp.c4 values ('published', p);
  q := format('select id from public.partner_requests where id = %L and partner_state = ''needs_you''', p);
  perform pg_temp.expect('in attention before', pg_temp.count_as(nadia, q), 1::bigint);
  perform pg_temp.svc(pg_temp.cancel_sql(staff, p, pg_temp.rev(p), 'O lançamento foi adiado.'));
  perform pg_temp.expect('state', pg_temp.state(p), 'cancelled/none/true/O lançamento foi adiado.');
  perform pg_temp.expect('out of attention', pg_temp.count_as(nadia, q), 0::bigint);
  perform pg_temp.expect('assignee reads the reason',
    pg_temp.value_as(nadia, format('select partner_state || ''|'' || cancellation_reason from public.partner_requests where id = %L', p)),
    'cancelled|O lançamento foi adiado.');
  perform pg_temp.expect('other organization reads nothing', pg_temp.count_as(other,
    format('select cancellation_reason from public.partner_requests where id = %L', p)), 0::bigint);
  perform pg_temp.expect('colleague reads nothing', pg_temp.count_as(colleague,
    format('select cancellation_reason from public.partner_requests where id = %L', p)), 0::bigint);
  perform pg_temp.expect('base table stays closed to the partner', pg_temp.count_as(nadia,
    format('select id from public.requests where id = %L', p)), 0::bigint);
  -- A fresh submission after the cancellation is refused and writes nothing.
  perform pg_temp.expect_fail('fresh submission after cancel', pg_temp.submit_sql('aaaaaaaa-0000-0000-0000-000000000001', p,
    gen_random_uuid(), null, pg_temp.answer(p)), 'RQ009');
  perform pg_temp.expect('no submission', (select count(*) from public.request_submissions where request_id = p), 0::bigint);
end
$$;

-- 5. Cancelling after answers and a return: history untouched; races resolved -----------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  nadia_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  nadia text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  p uuid := pg_temp.request('C4 com a Sollelio');
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  ret uuid := gen_random_uuid();
  published_rev integer;
  hist text;
  r jsonb;
begin
  published_rev := pg_temp.rev(p);
  perform pg_temp.svc(pg_temp.submit_sql(nadia_id, p, s1, null, pg_temp.answer(p)));
  -- Submit won first: a cancellation at the revision seen before is stale.
  perform pg_temp.expect_fail('cancel at the pre-submission revision', pg_temp.cancel_sql(staff, p, published_rev, 'x'), 'RQ008');
  perform pg_temp.svc(format('select public.cmd_return_request_to_partner(%L::uuid, %L::uuid, %L::uuid, %s, ''text'', ''Falta isto.'')',
    staff, p, ret, pg_temp.rev(p)));
  perform pg_temp.svc(pg_temp.submit_sql(nadia_id, p, s2, ret, '{"response": {"text": "Aqui está."}}'));
  perform pg_temp.expect('with Sollelio', split_part(pg_temp.state(p), '/', 1), 'needs_sollelio');

  hist := pg_temp.history_hash(p);
  r := pg_temp.svc(pg_temp.cancel_sql(staff, p, pg_temp.rev(p), 'Resolvido por outra via.'));
  perform pg_temp.expect('cancelled from needs_sollelio', pg_temp.state(p), 'cancelled/none/true/Resolvido por outra via.');
  perform pg_temp.expect('event previous_status', (select metadata ->> 'previous_status' from public.activity_events
    where object_id = p and event_type = 'request.cancelled'), 'needs_sollelio');
  perform pg_temp.expect('submissions, answers, returns, fields and content untouched', pg_temp.history_hash(p), hist);
  perform pg_temp.expect('earlier events untouched', (select string_agg(event_type || '=' || n, ',' order by event_type) from (
    select event_type, count(*) n from public.activity_events where object_id = p group by event_type) x),
    'request.cancelled=1,request.created=1,request.published=1,request.returned_to_partner=1,request.submitted=2');
  perform pg_temp.expect('partner still reads her submissions', pg_temp.count_as(nadia,
    format('select id from public.request_submissions where request_id = %L', p)), 2::bigint);
  -- C3 replay: the same successful attempt, repeated after cancellation, replays.
  r := pg_temp.svc(pg_temp.submit_sql(nadia_id, p, s2, ret, '{"response": {"text": "Aqui está."}}'));
  perform pg_temp.expect('earlier submission replays after cancel', r ->> 'replayed', 'true');
  perform pg_temp.expect('replay wrote nothing', pg_temp.history_hash(p), hist);
  -- Nothing else moves a cancelled Request.
  perform pg_temp.expect_fail('complete after cancel', format('select public.cmd_complete_request(%L::uuid, %L::uuid, %s)', staff, p, pg_temp.rev(p)), 'RQ009');
  perform pg_temp.expect_fail('return after cancel', format(
    'select public.cmd_return_request_to_partner(%L::uuid, %L::uuid, %L::uuid, %s, ''text'', ''x'')', staff, p, gen_random_uuid(), pg_temp.rev(p)), 'RQ009');
end
$$;

-- 6. Complete and cancel never both succeed on one revision --------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  nadia_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  a uuid := pg_temp.request('C4 corrida A');
  b uuid := pg_temp.request('C4 corrida B');
  ra integer;
  rb integer;
begin
  perform pg_temp.svc(pg_temp.submit_sql(nadia_id, a, gen_random_uuid(), null, pg_temp.answer(a)));
  perform pg_temp.svc(pg_temp.submit_sql(nadia_id, b, gen_random_uuid(), null, pg_temp.answer(b)));
  ra := pg_temp.rev(a); rb := pg_temp.rev(b);
  perform pg_temp.svc(format('select public.cmd_complete_request(%L::uuid, %L::uuid, %s)', staff, a, ra));
  perform pg_temp.expect_fail('cancel after complete on that revision', pg_temp.cancel_sql(staff, a, ra, 'x'), 'RQ009');
  perform pg_temp.expect('completed stays completed', split_part(pg_temp.state(a), '/', 1), 'completed');
  perform pg_temp.svc(pg_temp.cancel_sql(staff, b, rb, 'Deixou de fazer sentido.'));
  perform pg_temp.expect_fail('complete after cancel on that revision',
    format('select public.cmd_complete_request(%L::uuid, %L::uuid, %s)', staff, b, rb), 'RQ009');
  perform pg_temp.expect('cancelled stays cancelled', split_part(pg_temp.state(b), '/', 1), 'cancelled');
end
$$;

-- 7. Database invariants, for every role --------------------------------------------------
do $$
declare
  p uuid := (select id from pg_temp.c4 where name = 'published');
  org uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  who uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  author uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
begin
  perform pg_temp.must_violate(format('update public.requests set cancellation_reason = ''reescrito'' where id = %L', p), 'reason rewritten');
  perform pg_temp.must_violate(format('update public.requests set cancelled_at = now() - interval ''1 day'' where id = %L', p), 'cancelled_at rewritten');
  perform pg_temp.must_violate(format(
    'update public.requests set status = ''needs_partner'', next_actor = ''partner'', cancelled_at = null, cancellation_reason = null where id = %L', p),
    'cancelled Request reopened');
  perform pg_temp.must_violate(format(
    'insert into public.requests (organization_id, type, status, next_actor, title, requested_action, estimated_effort_minutes, assignee_profile_id, created_by, cancelled_at)
     values (%L, ''task'', ''cancelled'', ''none'', ''sem motivo'', ''x'', 1, %L, %L, now())', org, who, author), 'cancelled without a reason');
  perform pg_temp.must_violate(format(
    'insert into public.requests (organization_id, type, status, next_actor, title, requested_action, estimated_effort_minutes, assignee_profile_id, created_by, cancellation_reason)
     values (%L, ''task'', ''draft'', ''none'', ''motivo sem cancelamento'', ''x'', 1, %L, %L, ''x'')', org, who, author), 'reason on a draft');
  perform pg_temp.must_violate(format(
    'insert into public.requests (organization_id, type, status, next_actor, title, requested_action, estimated_effort_minutes, assignee_profile_id, created_by, cancelled_at, cancellation_reason)
     values (%L, ''task'', ''cancelled'', ''none'', ''motivo por aparar'', ''x'', 1, %L, %L, now(), '' espaços '')', org, who, author), 'untrimmed reason');
  perform pg_temp.must_violate(format(
    'insert into public.requests (organization_id, type, status, next_actor, title, requested_action, estimated_effort_minutes, assignee_profile_id, created_by, cancelled_at, cancellation_reason)
     values (%L, ''task'', ''cancelled'', ''none'', ''motivo com quebra'', ''x'', 1, %L, %L, now(), E''\nmotivo'')', org, who, author), 'reason starting with a line break');
end
$$;

-- 8. No direct path for the API roles -------------------------------------------------------
do $$
declare
  nadia text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  helio text := '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
  p uuid := pg_temp.request('C4 sem atalhos');
begin
  perform pg_temp.must_refuse(nadia, format('select public.cmd_cancel_request(''aaaaaaaa-0000-0000-0000-000000000003'', %L, 1, ''x'')', p),
    'partner calling cmd_cancel_request');
  perform pg_temp.must_refuse(helio, format('select public.cmd_cancel_request(''aaaaaaaa-0000-0000-0000-000000000003'', %L, 1, ''x'')', p),
    'staff calling cmd_cancel_request directly');
  perform pg_temp.must_refuse(helio, format(
    'update public.requests set status = ''cancelled'', next_actor = ''none'', cancelled_at = now(), cancellation_reason = ''x'' where id = %L', p),
    'staff cancelling through a direct UPDATE');
  perform pg_temp.must_refuse(nadia, format(
    'update public.requests set status = ''cancelled'', next_actor = ''none'', cancelled_at = now(), cancellation_reason = ''x'' where id = %L', p),
    'partner cancelling through a direct UPDATE');
  perform set_config('request.jwt.claims', '', true);
  begin
    execute 'set local role anon';
    perform public.cmd_cancel_request('aaaaaaaa-0000-0000-0000-000000000003', p, 1, 'x');
    reset role;
    raise exception 'anon can execute cmd_cancel_request';
  exception when insufficient_privilege then reset role;
  end;
  perform pg_temp.expect('still with the partner', split_part(pg_temp.state(p), '/', 1), 'needs_partner');
end
$$;

select 'slice 2 C4 cancellation verified' as result;
