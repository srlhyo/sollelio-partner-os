-- Slice 2, C2 — command behaviour. NOT a migration.
--
-- Runs every C2 command the way the Edge Function does: as `service_role`, with the
-- actor passed in. Builds on the 91 fixtures (Do Luxo à Mesa, Nádia, Hélio, a former
-- member, a second organization, two products, five resources) and runs after 94, so
-- it adds its own Requests without disturbing the counts 94 asserts.
--
-- Concurrency needs two sessions and is exercised against the real local stack by
-- the E2E API suite (e2e/request-commands.spec.ts). This file proves the sequential
-- contract: validation, dependencies, revision, preview, publication, replay, grants.

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

/* Runs q as service_role and returns {state, message, detail}; state 'OK' on success. */
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

/* Asserts q fails with the given SQLSTATE and, optionally, a field error code. */
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

create or replace function pg_temp.create_sql(actor uuid, id uuid, payload jsonb)
returns text language sql as $$
  select format('select public.cmd_create_request(%L::uuid, %L::uuid, %L::jsonb)', actor, id, payload);
$$;

create or replace function pg_temp.update_sql(actor uuid, id uuid, rev integer, payload jsonb)
returns text language sql as $$
  select format('select public.cmd_update_request_draft(%L::uuid, %L::uuid, %s, %L::jsonb)', actor, id, rev, payload);
$$;

create or replace function pg_temp.publish_sql(actor uuid, id uuid, rev integer, key uuid)
returns text language sql as $$
  select format('select public.cmd_publish_request(%L::uuid, %L::uuid, %s, %L::uuid)', actor, id, rev, key);
$$;

create or replace function pg_temp.preview_sql(actor uuid, id uuid)
returns text language sql as $$
  select format('select public.cmd_preview_request(%L::uuid, %L::uuid)', actor, id);
$$;

create or replace function pg_temp.rev(id uuid)
returns integer language sql as $$ select revision from public.requests where id = $1; $$;

create or replace function pg_temp.events(id uuid, kind text)
returns bigint language sql as $$
  select count(*) from public.activity_events where object_id = $1 and event_type = $2;
$$;

-- ---- Constants --------------------------------------------------------------
-- Staff Hélio aaaa…03, partner Nádia aaaa…01 (active in org 1), former member
-- aaaa…04 (inactive in org 1), other partner aaaa…02 (org 2).
create or replace function pg_temp.base(title text default 'Tarefa C2')
returns jsonb language sql as $$
  select jsonb_build_object(
    'organization_id', 'bbbbbbbb-0000-0000-0000-000000000001',
    'assignee_profile_id', 'aaaaaaaa-0000-0000-0000-000000000001',
    'type', 'task', 'title', title, 'requested_action', 'Faça isto.', 'estimated_effort_minutes', 1);
$$;

-- 1. Create, replay, conflict, actor --------------------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  ra uuid := 'c2000000-0000-0000-0000-00000000000a';
  r jsonb;
begin
  r := pg_temp.svc(pg_temp.create_sql(staff, ra, pg_temp.base()));
  perform pg_temp.expect('create replayed', r ->> 'replayed', 'false');
  perform pg_temp.expect('create status', (select status::text from public.requests where id = ra), 'draft');
  perform pg_temp.expect('create next_actor', (select next_actor::text from public.requests where id = ra), 'none');
  perform pg_temp.expect('create created_by', (select created_by from public.requests where id = ra), staff);
  perform pg_temp.expect('create revision returned', (r ->> 'revision')::integer, pg_temp.rev(ra));
  perform pg_temp.expect('create event', pg_temp.events(ra, 'request.created'), 1::bigint);
  perform pg_temp.expect('effort 1 stored as 1', (select estimated_effort_minutes from public.requests where id = ra), 1);

  -- An exact replay creates nothing and says so.
  r := pg_temp.svc(pg_temp.create_sql(staff, ra, pg_temp.base()));
  perform pg_temp.expect('replay flagged', r ->> 'replayed', 'true');
  perform pg_temp.expect('replay single row', (select count(*) from public.requests where id = ra), 1::bigint);
  perform pg_temp.expect('replay single event', pg_temp.events(ra, 'request.created'), 1::bigint);

  -- Same key, different payload.
  perform pg_temp.expect_fail('same id other payload', pg_temp.create_sql(staff, ra, pg_temp.base('Outro título')), 'RQ010');

  -- Only an existing staff profile may act.
  perform pg_temp.expect_fail('partner actor', pg_temp.create_sql('aaaaaaaa-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-0000000000f1', pg_temp.base()), 'RQ001');
  perform pg_temp.expect_fail('unknown actor', pg_temp.create_sql('99999999-9999-9999-9999-999999999999',
    'c2000000-0000-0000-0000-0000000000f2', pg_temp.base()), 'RQ001');
end
$$;

-- 2. Validation, atomically rejected -------------------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  rb uuid := 'c2000000-0000-0000-0000-00000000000b';
begin
  perform pg_temp.expect_fail('missing title', pg_temp.create_sql(staff, rb, pg_temp.base() - 'title'), 'RQ003', 'required');
  perform pg_temp.expect_fail('title too long', pg_temp.create_sql(staff, rb, pg_temp.base(repeat('x', 201))), 'RQ003', 'too_long');
  perform pg_temp.expect_fail('effort zero', pg_temp.create_sql(staff, rb,
    pg_temp.base() || jsonb_build_object('estimated_effort_minutes', 0)), 'RQ003', 'invalid');
  perform pg_temp.expect_fail('effort fractional', pg_temp.create_sql(staff, rb,
    pg_temp.base() || jsonb_build_object('estimated_effort_minutes', 1.5)), 'RQ003', 'invalid');
  perform pg_temp.expect_fail('unknown key', pg_temp.create_sql(staff, rb,
    pg_temp.base() || jsonb_build_object('status', 'needs_partner')), 'RQ003', 'unknown_field');
  perform pg_temp.expect_fail('author approval field', pg_temp.create_sql(staff, rb,
    pg_temp.base() || jsonb_build_object('type', 'question', 'fields',
      jsonb_build_array(jsonb_build_object('label', 'Aprova?', 'type', 'approval')))), 'RQ003', 'system_type');
  perform pg_temp.expect_fail('fields on approval', pg_temp.create_sql(staff, rb,
    pg_temp.base() || jsonb_build_object('type', 'approval', 'fields',
      jsonb_build_array(jsonb_build_object('label', 'Extra', 'type', 'long_text')))), 'RQ003', 'approval_fields_system');
  perform pg_temp.expect_fail('priority without criteria', pg_temp.create_sql(staff, rb,
    pg_temp.base() || jsonb_build_object('internal', jsonb_build_object('priority', 'urgent'))), 'RQ003', 'required_for_internal');
  perform pg_temp.expect_fail('options on boolean', pg_temp.create_sql(staff, rb,
    pg_temp.base() || jsonb_build_object('fields', jsonb_build_array(
      jsonb_build_object('label', 'Sim?', 'type', 'boolean', 'options', jsonb_build_array('a'))))), 'RQ003', 'not_applicable');

  -- Nothing half-written survives a rejection.
  perform pg_temp.expect('no request after rejection', (select count(*) from public.requests where id = rb), 0::bigint);
  perform pg_temp.expect('no receipt after rejection',
    (select count(*) from public.request_command_receipts where idempotency_key = rb), 0::bigint);
  perform pg_temp.expect('no event after rejection', pg_temp.events(rb, 'request.created'), 0::bigint);
end
$$;

-- 3. Dependencies -------------------------------------------------------------
insert into public.organizations (id, name, slug, status)
values ('bbbbbbbb-0000-0000-0000-0000000000c2', 'Organização inactiva C2', 'org-inactiva-c2', 'inactive');
insert into public.organization_memberships (organization_id, profile_id, status)
values ('bbbbbbbb-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'active');

do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  rx uuid := 'c2000000-0000-0000-0000-0000000000c0';
begin
  perform pg_temp.expect_fail('organization not active', pg_temp.create_sql(staff, rx,
    pg_temp.base() || jsonb_build_object('organization_id', 'bbbbbbbb-0000-0000-0000-0000000000c2')), 'RQ004');
  perform pg_temp.expect_fail('assignee of another organization', pg_temp.create_sql(staff, rx,
    pg_temp.base() || jsonb_build_object('organization_id', 'bbbbbbbb-0000-0000-0000-000000000002')), 'RQ005');
  perform pg_temp.expect_fail('inactive member', pg_temp.create_sql(staff, rx,
    pg_temp.base() || jsonb_build_object('assignee_profile_id', 'aaaaaaaa-0000-0000-0000-000000000004')), 'RQ005');
  perform pg_temp.expect_fail('staff as assignee', pg_temp.create_sql(staff, rx,
    pg_temp.base() || jsonb_build_object('assignee_profile_id', staff)), 'RQ005');
  perform pg_temp.expect_fail('product not linked', pg_temp.create_sql(staff, rx,
    pg_temp.base() || jsonb_build_object('product_id', 'cccccccc-0000-0000-0000-000000000002')), 'RQ006');
  perform pg_temp.expect_fail('resource of another organization', pg_temp.create_sql(staff, rx,
    pg_temp.base() || jsonb_build_object('resource_id', 'dddddddd-0000-0000-0000-000000000005')), 'RQ007');
  perform pg_temp.expect_fail('resource and product disagree', pg_temp.create_sql(staff, rx,
    pg_temp.base() || jsonb_build_object('product_id', 'cccccccc-0000-0000-0000-000000000001',
                                         'resource_id', 'dddddddd-0000-0000-0000-000000000002')), 'RQ007');
  perform pg_temp.expect_fail('internal owner not staff', pg_temp.create_sql(staff, rx,
    pg_temp.base() || jsonb_build_object('internal', jsonb_build_object(
      'completion_criteria', 'x', 'internal_owner_profile_id', 'aaaaaaaa-0000-0000-0000-000000000001'))), 'RQ003', 'not_staff');
end
$$;

-- 4. Draft edition and the aggregate revision ------------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  ra uuid := 'c2000000-0000-0000-0000-00000000000a';
  r0 integer := pg_temp.rev('c2000000-0000-0000-0000-00000000000a');
  r1 integer;
  r jsonb;
  payload jsonb;
begin
  payload := pg_temp.base() - 'organization_id' || jsonb_build_object(
    'type', 'question', 'title', 'Pergunta C2', 'context', 'Porque sim.',
    'product_id', 'cccccccc-0000-0000-0000-000000000001', 'resource_id', 'dddddddd-0000-0000-0000-000000000001',
    'internal', jsonb_build_object('completion_criteria', 'Respondida.', 'priority', 'important'),
    'fields', jsonb_build_array(
      jsonb_build_object('label', 'Qual prefere?', 'type', 'single_choice', 'required', true, 'options', jsonb_build_array('Sim')),
      jsonb_build_object('label', 'Comentários', 'type', 'long_text')));

  perform pg_temp.expect_fail('stale revision', pg_temp.update_sql(staff, ra, r0 + 100, payload), 'RQ008');
  perform pg_temp.expect_fail('organization immutable', pg_temp.update_sql(staff, ra, r0,
    payload || jsonb_build_object('organization_id', 'bbbbbbbb-0000-0000-0000-000000000002')), 'RQ003', 'immutable');

  r := pg_temp.svc(pg_temp.update_sql(staff, ra, r0, payload));
  r1 := (r ->> 'revision')::integer;
  perform pg_temp.expect('revision moved forward', r1 > r0, true);
  perform pg_temp.expect('revision returned is current', r1, pg_temp.rev(ra));
  perform pg_temp.expect('fields replaced', (select string_agg(key, ',' order by sort_order) from public.request_fields where request_id = ra), 'q1,q2');
  perform pg_temp.expect('internal details written',
    (select completion_criteria || '/' || priority || '/' || internal_owner_profile_id from public.request_internal_details where request_id = ra),
    'Respondida./important/' || staff);

  -- The revision the caller used is gone.
  perform pg_temp.expect_fail('replayed edit is stale', pg_temp.update_sql(staff, ra, r0, payload), 'RQ008');

  -- Any change to a part of the aggregate moves the revision, whoever makes it.
  update public.request_internal_details set priority = 'urgent' where request_id = ra;
  perform pg_temp.expect('internal details bump', pg_temp.rev(ra), r1 + 1);
  update public.request_fields set help_text = 'Ajuda' where request_id = ra and key = 'q2';
  perform pg_temp.expect('field bump', pg_temp.rev(ra), r1 + 2);
  update public.requests set revision = 1 where id = ra;
  perform pg_temp.expect('revision cannot be set back', pg_temp.rev(ra), r1 + 3);
end
$$;

-- 5. Preview: the partner projection, staff only -------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  ra uuid := 'c2000000-0000-0000-0000-00000000000a';
  p jsonb;
  want text[];
  got text[];
begin
  p := pg_temp.svc(pg_temp.preview_sql(staff, ra));

  select array_agg(column_name::text order by column_name) into want
    from information_schema.columns where table_schema = 'public' and table_name = 'partner_requests';
  select array_agg(k order by k) into got from jsonb_object_keys(p -> 'request') k;
  perform pg_temp.expect('preview keys are the partner contract', got, want);

  perform pg_temp.expect('draft simulated as needs_you', p #>> '{request,partner_state}', 'needs_you');
  perform pg_temp.expect('simulation flagged', p ->> 'simulated_publication', 'true');
  perform pg_temp.expect('preview revision', (p ->> 'revision')::integer, pg_temp.rev(ra));
  perform pg_temp.expect('preview fields', jsonb_array_length(p -> 'fields'), 2);
  perform pg_temp.expect('preview resource', p #>> '{resource,id}', 'dddddddd-0000-0000-0000-000000000001');
  -- The Request shape and its fields carry nothing internal. (The resource row is
  -- exactly what `resources` RLS already lets the partner read.)
  perform pg_temp.expect('no internal leakage',
    ((p -> 'request')::text || (p -> 'fields')::text) ~ '(completion_criteria|internal_owner|"priority"|assignee_profile_id|created_by|"revision"|next_actor|"status")', false);

  perform pg_temp.expect_fail('partner cannot preview', pg_temp.preview_sql('aaaaaaaa-0000-0000-0000-000000000001', ra), 'RQ001');
  perform pg_temp.expect_fail('preview unknown request', pg_temp.preview_sql(staff, 'c2000000-0000-0000-0000-0000000000ff'), 'RQ002');
end
$$;

-- 6. Publication: requirements, exact revision, replay -------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  ra uuid := 'c2000000-0000-0000-0000-00000000000a';
  k1 uuid := 'c2000000-0000-0000-0000-0000000000a1';
  k2 uuid := 'c2000000-0000-0000-0000-0000000000a2';
  rev integer;
  r jsonb;
  payload jsonb;
begin
  -- One option only.
  perform pg_temp.expect_fail('single_choice with one option', pg_temp.publish_sql(staff, ra, pg_temp.rev(ra), k1),
    'RQ011', 'invalid_options');

  payload := pg_temp.base() - 'organization_id' || jsonb_build_object(
    'type', 'question', 'title', 'Pergunta C2', 'product_id', 'cccccccc-0000-0000-0000-000000000001',
    'resource_id', 'dddddddd-0000-0000-0000-000000000001',
    'internal', jsonb_build_object('completion_criteria', 'Respondida.'),
    'fields', jsonb_build_array(
      jsonb_build_object('label', 'Qual prefere?', 'type', 'single_choice', 'required', true, 'options', jsonb_build_array('Sim', ' sim '))));
  perform pg_temp.svc(pg_temp.update_sql(staff, ra, pg_temp.rev(ra), payload));
  perform pg_temp.expect_fail('duplicate options', pg_temp.publish_sql(staff, ra, pg_temp.rev(ra), k1), 'RQ011', 'invalid_options');

  payload := jsonb_set(payload, '{fields,0,options}', jsonb_build_array('Sim', 'Não'));
  perform pg_temp.svc(pg_temp.update_sql(staff, ra, pg_temp.rev(ra), payload));
  rev := (pg_temp.svc(pg_temp.preview_sql(staff, ra)) ->> 'revision')::integer;

  perform pg_temp.expect_fail('publish stale', pg_temp.publish_sql(staff, ra, rev - 1, k1), 'RQ008');
  perform pg_temp.expect_fail('publish as partner', pg_temp.publish_sql('aaaaaaaa-0000-0000-0000-000000000001', ra, rev, k1), 'RQ001');

  r := pg_temp.svc(pg_temp.publish_sql(staff, ra, rev, k1));
  perform pg_temp.expect('published replayed flag', r ->> 'replayed', 'false');
  perform pg_temp.expect('published status', (select status::text || '/' || next_actor::text from public.requests where id = ra), 'needs_partner/partner');
  perform pg_temp.expect('published_at set', (select published_at is not null from public.requests where id = ra), true);
  perform pg_temp.expect('published event', pg_temp.events(ra, 'request.published'), 1::bigint);

  -- The same attempt again: the original outcome, nothing new.
  r := pg_temp.svc(pg_temp.publish_sql(staff, ra, rev, k1));
  perform pg_temp.expect('publish replay flagged', r ->> 'replayed', 'true');
  perform pg_temp.expect('publish replay single event', pg_temp.events(ra, 'request.published'), 1::bigint);

  -- A different attempt on a published Request is not a success.
  perform pg_temp.expect_fail('second publish attempt', pg_temp.publish_sql(staff, ra, rev, k2), 'RQ009');
  -- The same key with a different revision is a conflict.
  perform pg_temp.expect_fail('key reused for other revision', pg_temp.publish_sql(staff, ra, rev + 1, k1), 'RQ010');
  -- Published content is not editable in C2.
  perform pg_temp.expect_fail('edit after publish', pg_temp.update_sql(staff, ra, pg_temp.rev(ra), payload), 'RQ009');
end
$$;

-- 7. Approval, criteria, resource availability ----------------------------------
do $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  rc uuid := 'c2000000-0000-0000-0000-00000000000c';
  rd uuid := 'c2000000-0000-0000-0000-00000000000d';
  re uuid := 'c2000000-0000-0000-0000-00000000000e';
  p jsonb;
begin
  perform pg_temp.svc(pg_temp.create_sql(staff, rc, pg_temp.base('Aprovação C2') || jsonb_build_object(
    'type', 'approval', 'internal', jsonb_build_object('completion_criteria', 'Decidida.'))));
  perform pg_temp.expect('system approval fields',
    (select string_agg(key || ':' || type || ':' || required || ':' || system_generated, ',' order by sort_order)
       from public.request_fields where request_id = rc),
    'approval:approval:true:true,approval_notes:long_text:false:true');
  perform pg_temp.expect('approval options',
    (select options from public.request_fields where request_id = rc and key = 'approval'), '["approve", "needs_changes"]'::jsonb);
  perform pg_temp.svc(pg_temp.publish_sql(staff, rc, pg_temp.rev(rc), 'c2000000-0000-0000-0000-0000000000c1'));

  -- A task needs no question, but every Request needs a completion criterion.
  perform pg_temp.svc(pg_temp.create_sql(staff, rd, pg_temp.base('Sem critério')));
  perform pg_temp.expect_fail('publish without criteria', pg_temp.publish_sql(staff, rd, pg_temp.rev(rd),
    'c2000000-0000-0000-0000-0000000000d1'), 'RQ011', 'required');

  -- A question needs a question.
  perform pg_temp.svc(pg_temp.create_sql(staff, 'c2000000-0000-0000-0000-00000000000f', pg_temp.base('Pergunta vazia')
    || jsonb_build_object('type', 'question', 'internal', jsonb_build_object('completion_criteria', 'x'))));
  perform pg_temp.expect_fail('question without fields', pg_temp.publish_sql(staff, 'c2000000-0000-0000-0000-00000000000f',
    pg_temp.rev('c2000000-0000-0000-0000-00000000000f'), 'c2000000-0000-0000-0000-0000000000f3'), 'RQ011', 'required');

  -- A draft may point at a hidden link; the preview says so and publication refuses.
  perform pg_temp.svc(pg_temp.create_sql(staff, re, pg_temp.base('Recurso oculto') || jsonb_build_object(
    'resource_id', 'dddddddd-0000-0000-0000-000000000004', 'internal', jsonb_build_object('completion_criteria', 'x'))));
  p := pg_temp.svc(pg_temp.preview_sql(staff, re));
  perform pg_temp.expect('hidden resource not previewed', p -> 'resource', 'null'::jsonb);
  perform pg_temp.expect('hidden resource flagged', p ->> 'resource_unavailable', 'true');
  perform pg_temp.expect_fail('publish with hidden resource', pg_temp.publish_sql(staff, re, pg_temp.rev(re),
    'c2000000-0000-0000-0000-0000000000e1'), 'RQ007');

  -- The structural link invariant holds for any writer.
  begin
    update public.requests set resource_id = 'dddddddd-0000-0000-0000-000000000005' where id = re;
    raise exception 'A resource of another organization was linked directly.';
  exception when check_violation then null;
  end;
end
$$;

-- 8. What the partner then sees, and what nobody else may call ---------------------
do $$
declare
  n bigint;
  keys integer;
  st text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.partner_requests where id in (
    'c2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000c',
    'c2000000-0000-0000-0000-00000000000d', 'c2000000-0000-0000-0000-00000000000e');
  select count(*) into keys from public.partner_requests pr, jsonb_object_keys(to_jsonb(pr)) k
   where pr.id = 'c2000000-0000-0000-0000-00000000000a';
  reset role;
  -- The two published ones only; the drafts stay invisible.
  perform pg_temp.expect('partner sees published only', n, 2::bigint);
  perform pg_temp.expect('partner row has 16 keys', keys, 16);

  -- The commands are not reachable by the API roles, whatever the payload.
  foreach st in array array['authenticated', 'anon'] loop
    begin
      execute format('set local role %I', st);
      perform public.cmd_create_request('aaaaaaaa-0000-0000-0000-000000000003',
        'c2000000-0000-0000-0000-0000000000aa', pg_temp.base());
      reset role;
      raise exception 'cmd_create_request callable by %', st;
    exception when insufficient_privilege then reset role;
    end;
    begin
      execute format('set local role %I', st);
      perform count(*) from public.request_command_receipts;
      reset role;
      raise exception 'request_command_receipts readable by %', st;
    exception when insufficient_privilege then reset role;
    end;
    begin
      execute format('set local role %I', st);
      perform count(*) from app.partner_request_projection;
      reset role;
      raise exception 'app.partner_request_projection readable by %', st;
    exception when insufficient_privilege then reset role;
    end;
  end loop;
end
$$;

select 'slice 2 C2 commands verified' as result;
