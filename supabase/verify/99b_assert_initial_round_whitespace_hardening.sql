-- Initial-round whitespace canonicalization (20261003120000). NOT a migration.
--
-- Named 99b so the existing harness (files starting with 9, in name order) runs it
-- after 99a. Proves that initial-round long_text and single_choice answers trim every
-- whitespace character at either end through `app.request_trim`; that single_choice
-- still matches an option exactly first (C2 stores options btrim()-trimmed, so they are
-- not guaranteed canonical) and stores the configured option; that the replay identity
-- (app.request_submission_hash, on btrim) is unchanged — including its stricter
-- boundary; and that the returned-round hardening is intact. Runs the commands as
-- `service_role` with the actor passed in, like the Edge Functions, on the 91 fixtures
-- (staff aaaa…03, Nádia aaaa…01, organization bbbb…01).

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

/* Runs `q` as service_role; fails unless it raises `want_state` with field error `want_field:want_code`. */
create or replace function pg_temp.expect_fail(label text, q text, want_state text, want_field text default null, want_code text default null)
returns void
language plpgsql
as $$
declare
  st text;
  det text;
begin
  execute 'set local role service_role';
  begin
    execute q;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, det = pg_exception_detail;
    execute 'reset role';
    if st is distinct from want_state then
      raise exception '% — expected %, got % (%)', label, want_state, st, det;
    end if;
    if want_code is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(nullif(det, '')::jsonb -> 'errors', '[]'::jsonb)) e
       where e ->> 'code' = want_code and (want_field is null or e ->> 'field' = want_field)) then
      raise exception '% — expected field error %:%, got %', label, want_field, want_code, det;
    end if;
    return;
  end;
  execute 'reset role';
  raise exception '% — expected %, but it succeeded', label, want_state;
end;
$$;

create or replace function pg_temp.submit_sql(req uuid, sub uuid, expected uuid, payload jsonb)
returns text language sql as $$
  select format('select public.cmd_submit_request(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::jsonb)',
                'aaaaaaaa-0000-0000-0000-000000000001', req, sub, expected, payload);
$$;

create or replace function pg_temp.fid(req uuid, k text)
returns uuid language sql as $$ select id from public.request_fields where request_id = req and key = k; $$;

/* The initial answer of `req` to field `k`, or NULL when there is no answer row. */
create or replace function pg_temp.answer(req uuid, k text)
returns jsonb language sql as $$
  select a.value from public.request_answers a join public.request_submissions s on s.id = a.submission_id
   where s.request_id = req and s.return_id is null and a.request_field_id = pg_temp.fid(req, k);
$$;

create or replace function pg_temp.writes(req uuid)
returns text language sql as $$
  select (select count(*) from public.request_submissions where request_id = req) || '/'
      || (select count(*) from public.request_answers a join public.request_submissions s on s.id = a.submission_id where s.request_id = req) || '/'
      || (select count(*) from public.activity_events where object_id = req and event_type = 'request.submitted');
$$;

/*
 * A published Request (C2 commands). 'question': q1 long_text required, q2 long_text
 * optional, q3 single_choice required ('Confirmado', 'Não confirmado'), q4 single_choice
 * optional with options C2 stores as authored after btrim() — 'Sim', 'Sim' + NBSP and a
 * lone NBSP — i.e. not canonical under app.request_trim. 'approval': the system fields.
 */
create or replace function pg_temp.published(title text, kind text default 'question')
returns uuid
language plpgsql
as $$
declare
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  rid uuid := gen_random_uuid();
  pv jsonb;
begin
  perform pg_temp.svc(format('select public.cmd_create_request(%L::uuid, %L::uuid, %L::jsonb)', staff, rid,
    jsonb_build_object(
      'organization_id', 'bbbbbbbb-0000-0000-0000-000000000001', 'assignee_profile_id', 'aaaaaaaa-0000-0000-0000-000000000001',
      'type', kind, 'title', title, 'requested_action', 'Faça isto.', 'estimated_effort_minutes', 3,
      'internal', jsonb_build_object('completion_criteria', 'Respondido.'),
      'fields', case when kind = 'question' then jsonb_build_array(
        jsonb_build_object('label', 'O que correu mal?', 'type', 'long_text', 'required', true),
        jsonb_build_object('label', 'Algo mais?', 'type', 'long_text', 'required', false),
        jsonb_build_object('label', 'Está confirmado?', 'type', 'single_choice', 'required', true,
                           'options', jsonb_build_array('Confirmado', 'Não confirmado')),
        jsonb_build_object('label', 'Concorda?', 'type', 'single_choice', 'required', false,
                           'options', jsonb_build_array('Sim', E'Sim\u00a0', E'\u00a0')))
        else '[]'::jsonb end)));
  pv := pg_temp.svc(format('select public.cmd_preview_request(%L::uuid, %L::uuid)', staff, rid));
  perform pg_temp.svc(format('select public.cmd_publish_request(%L::uuid, %L::uuid, %s, %L::uuid)',
    staff, rid, (pv ->> 'revision')::integer, gen_random_uuid()));
  return rid;
end;
$$;

/* An initial-round payload for a 'question' Request. */
create or replace function pg_temp.answers(req uuid, q1 jsonb, q2 jsonb, q3 jsonb, q4 jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('answers', jsonb_build_array(
    jsonb_build_object('field_id', pg_temp.fid(req, 'q1'), 'value', q1),
    jsonb_build_object('field_id', pg_temp.fid(req, 'q2'), 'value', q2),
    jsonb_build_object('field_id', pg_temp.fid(req, 'q3'), 'value', q3),
    jsonb_build_object('field_id', pg_temp.fid(req, 'q4'), 'value', q4)));
$$;

-- 1. Structure and posture -------------------------------------------------------------
do $$
declare
  src text := (select prosrc from pg_proc where oid = 'public.cmd_submit_request(uuid, uuid, uuid, uuid, jsonb)'::regprocedure);
  fn text;
begin
  if src not like '%s := app.request_trim(val #>> ''{}'');%' then
    raise exception 'Initial-round long_text is not trimmed through app.request_trim.';
  end if;
  if src not like '%where o = btrim(val #>> ''{}'')%'
     or src not like '%where app.request_trim(o) = app.request_trim(val #>> ''{}'')%'
     or src not like '%app.request_trim(val #>> ''{}'') <> ''''%'
     or src not like '%to_jsonb(choice)%'
     or src like '%to_jsonb(btrim(val%' then
    raise exception 'Initial-round single_choice is not the exact-then-canonical match storing the configured option.';
  end if;
  if (length(src) - length(replace(src, 'btrim(val #>> ''{}'')', ''))) / length('btrim(val #>> ''{}'')') <> 1 then
    raise exception 'cmd_submit_request should keep exactly one btrim(val) — the exact single_choice match.';
  end if;
  -- Returned-round hardening (20260930160000) intact.
  if src not like '%r_text := app.request_trim(resp ->> ''text'');%'
     or src not like '%r_notes := nullif(app.request_trim(resp ->> ''notes''), '''');%' then
    raise exception 'Returned-round canonicalization changed in cmd_submit_request.';
  end if;
  -- Replay identity unchanged: the hash still canonicalizes strings with btrim().
  src := (select prosrc from pg_proc where oid = 'app.request_submission_hash(uuid, jsonb)'::regprocedure);
  if src not like '%to_jsonb(btrim(e ->> ''value''))%' or src not like '%to_jsonb(btrim(kv.value #>> ''{}''))%' or src like '%request_trim%' then
    raise exception 'app.request_submission_hash changed: the replay identity of stored submissions must not move.';
  end if;

  foreach fn in array array['public.cmd_submit_request(uuid, uuid, uuid, uuid, jsonb)', 'app.request_submission_hash(uuid, jsonb)']
  loop
    if (select prosecdef from pg_proc where oid = fn::regprocedure)
       or (select proconfig from pg_proc where oid = fn::regprocedure) is distinct from array['search_path=""']
       or has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = fn::regprocedure and a.grantee = 0)
       or not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '% must be INVOKER, search_path "", executable by service_role only.', fn;
    end if;
  end loop;
end
$$;

create table pg_temp.ib (name text primary key, id uuid not null);

-- 2. long_text and single_choice refusals write nothing ------------------------------------
do $$
declare
  r uuid := pg_temp.published('Inicial — recusas');
  q1 text := 'answers.' || pg_temp.fid(r, 'q1');
  q3 text := 'answers.' || pg_temp.fid(r, 'q3');
  q4 text := 'answers.' || pg_temp.fid(r, 'q4');
  blank text;
begin
  insert into pg_temp.ib values ('main', r);
  foreach blank in array array['   ', E'\t\n\r\n', E'\u00a0\u00a0', E'\u2003\u3000\ufeff\u2028', E' \n\u00a0\t\u205f ']
  loop
    perform pg_temp.expect_fail('required long_text of whitespace ' || md5(blank),
      pg_temp.submit_sql(r, gen_random_uuid(), null, pg_temp.answers(r, to_jsonb(blank), 'null', '"Confirmado"', 'null')), 'RQ003', q1, 'required');
  end loop;
  perform pg_temp.expect_fail('long_text over 4000 after trimming',
    pg_temp.submit_sql(r, gen_random_uuid(), null, pg_temp.answers(r, to_jsonb(E'\u00a0' || repeat('x', 4001) || E'\n'), 'null', '"Confirmado"', 'null')), 'RQ003', q1, 'too_long');
  perform pg_temp.expect_fail('single_choice that is no option',
    pg_temp.submit_sql(r, gen_random_uuid(), null, pg_temp.answers(r, '"Texto."', 'null', '"Talvez"', 'null')), 'RQ003', q3, 'invalid_option');
  perform pg_temp.expect_fail('single_choice of whitespace only',
    pg_temp.submit_sql(r, gen_random_uuid(), null, pg_temp.answers(r, '"Texto."', 'null', to_jsonb(E'\u3000\u00a0'::text), 'null')), 'RQ003', q3, 'invalid_option');
  -- A whitespace-only answer never matches a whitespace-only option canonically.
  perform pg_temp.expect_fail('whitespace answer vs a lone NBSP option',
    pg_temp.submit_sql(r, gen_random_uuid(), null, pg_temp.answers(r, '"Texto."', 'null', '"Confirmado"', to_jsonb(E'\u3000'::text))), 'RQ003', q4, 'invalid_option');
  -- Two options equal under app.request_trim ('Sim', 'Sim' + NBSP): no exact match, no guess.
  perform pg_temp.expect_fail('canonical match that is ambiguous',
    pg_temp.submit_sql(r, gen_random_uuid(), null, pg_temp.answers(r, '"Texto."', 'null', '"Confirmado"', to_jsonb(E'\u2003Sim'::text))), 'RQ003', q4, 'invalid_option');
  perform pg_temp.expect('refusals wrote nothing (submissions/answers/events)', pg_temp.writes(r), '0/0/0');
end
$$;

-- 3. Accepted: canonical storage, optional blank, exact and canonical option matches -----
do $$
declare
  r uuid := (select id from pg_temp.ib where name = 'main');
  sub uuid := gen_random_uuid();
  payload jsonb;
  res jsonb;
begin
  payload := pg_temp.answers(r, to_jsonb(E'\u00a0\n Texto real \t\u3000'::text), to_jsonb(E'\n\t\u00a0'::text),
                             to_jsonb(E'\u00a0Confirmado\u3000'::text), to_jsonb(E'Sim\u00a0'::text));
  res := pg_temp.svc(pg_temp.submit_sql(r, sub, null, payload));
  perform pg_temp.expect('accepted', res ->> 'replayed', 'false');
  perform pg_temp.expect('padded long_text stored canonical', pg_temp.answer(r, 'q1'), '"Texto real"'::jsonb);
  perform pg_temp.expect('optional long_text of whitespace: no answer row', pg_temp.answer(r, 'q2'), null::jsonb);
  perform pg_temp.expect('Unicode-padded option stored as the option', pg_temp.answer(r, 'q3'), '"Confirmado"'::jsonb);
  -- C2 stores options btrim()-trimmed; an answer equal to such an option still matches
  -- exactly and is stored as configured, as before this hardening.
  perform pg_temp.expect('exact match of a non-canonical option', pg_temp.answer(r, 'q4'), to_jsonb(E'Sim\u00a0'::text));
  perform pg_temp.expect('one submission, three answers, one event', pg_temp.writes(r), '1/3/1');
  insert into pg_temp.ib values ('main-sub', sub);

  -- 4. Replay: identity is the unchanged btrim()-based payload hash.
  perform pg_temp.expect('exact replay', pg_temp.svc(pg_temp.submit_sql(r, sub, null, payload)) ->> 'replayed', 'true');
  perform pg_temp.expect('replay returns the original revision',
    (pg_temp.svc(pg_temp.submit_sql(r, sub, null, payload)) ->> 'revision'), res ->> 'revision');
  -- ASCII spaces around the same values hash the same (btrim): still the same attempt.
  perform pg_temp.expect('ASCII-padded retry replays',
    pg_temp.svc(pg_temp.submit_sql(r, sub, null, pg_temp.answers(r, to_jsonb(E'  \u00a0\n Texto real \t\u3000  '::text), to_jsonb(E'\n\t\u00a0'::text),
                                                                to_jsonb(E' \u00a0Confirmado\u3000 '::text), to_jsonb(E'Sim\u00a0'::text)))) ->> 'replayed', 'true');
  perform pg_temp.expect_fail('changed answer under the same id',
    pg_temp.submit_sql(r, sub, null, pg_temp.answers(r, '"Outro texto"', 'null', '"Confirmado"', 'null')), 'RQ010');
  -- Stricter-hash boundary (documented): the same canonical answers padded with other
  -- than ASCII spaces hash differently, so under the same id they are a conflict, not a
  -- replay. Stored meaning never diverges; only that retry is refused.
  perform pg_temp.expect_fail('canonical-equal, differently padded retry under the same id',
    pg_temp.submit_sql(r, sub, null, pg_temp.answers(r, '"Texto real"', 'null', '"Confirmado"', to_jsonb(E'Sim\u00a0'::text))), 'RQ010');
  perform pg_temp.expect('no duplicate submission, answers or event', pg_temp.writes(r), '1/3/1');
  perform pg_temp.expect('state moved once', (select status || '/' || revision from public.requests where id = r), 'needs_sollelio/' || (res ->> 'revision'));
end
$$;

-- 5. Limits and plain cases on a second Request ---------------------------------------------
do $$
declare
  r uuid := pg_temp.published('Inicial — limites');
begin
  perform pg_temp.svc(pg_temp.submit_sql(r, gen_random_uuid(), null, pg_temp.answers(r,
    to_jsonb(E'\u2003\n' || repeat('y', 4000) || E'\t\u00a0'), to_jsonb(E'\t Nada mais. \u3000'::text), '"  Não confirmado "', '"Sim"')));
  perform pg_temp.expect('4000 characters after trimming accepted', length(pg_temp.answer(r, 'q1') #>> '{}'), 4000);
  perform pg_temp.expect('optional long_text padded stored canonical', pg_temp.answer(r, 'q2'), '"Nada mais."'::jsonb);
  perform pg_temp.expect('ASCII-padded option (as in C3)', pg_temp.answer(r, 'q3'), '"Não confirmado"'::jsonb);
  perform pg_temp.expect('exact canonical option', pg_temp.answer(r, 'q4'), '"Sim"'::jsonb);
end
$$;

-- 6. Approval notes (initial round, a system long_text): blank notes are no notes ----------
do $$
declare
  r uuid := pg_temp.published('Inicial — aprovação', 'approval');
begin
  perform pg_temp.expect_fail('approve with real notes',
    pg_temp.submit_sql(r, gen_random_uuid(), null, jsonb_build_object('answers', jsonb_build_array(
      jsonb_build_object('field_id', pg_temp.fid(r, 'approval'), 'value', 'approve'),
      jsonb_build_object('field_id', pg_temp.fid(r, 'approval_notes'), 'value', E'\u00a0Mudem.\n')))), 'RQ003', null, 'notes_not_allowed');
  perform pg_temp.svc(pg_temp.submit_sql(r, gen_random_uuid(), null, jsonb_build_object('answers', jsonb_build_array(
    jsonb_build_object('field_id', pg_temp.fid(r, 'approval'), 'value', 'approve'),
    jsonb_build_object('field_id', pg_temp.fid(r, 'approval_notes'), 'value', E'\u00a0\r\n\u3000')))));
  perform pg_temp.expect('approve with whitespace-only notes: accepted, no notes answer',
    (pg_temp.answer(r, 'approval') #>> '{}') || '/' || coalesce(pg_temp.answer(r, 'approval_notes') #>> '{}', '∅'), 'approve/∅');
end
$$;

-- 7. Returned round (20260930160000) still canonical -----------------------------------------
do $$
declare
  r uuid := (select id from pg_temp.ib where name = 'main');
  ret uuid := gen_random_uuid();
  sub uuid := gen_random_uuid();
begin
  perform pg_temp.svc(format('select public.cmd_return_request_to_partner(%L::uuid, %L::uuid, %L::uuid, %s, %L, %L)',
    'aaaaaaaa-0000-0000-0000-000000000003', r, ret, (select revision from public.requests where id = r), 'text', E'\n\t Falta isto? \u3000'));
  perform pg_temp.expect('return message canonical', (select message from public.request_returns where id = ret), 'Falta isto?');
  perform pg_temp.svc(pg_temp.submit_sql(r, sub, ret, jsonb_build_object('response', jsonb_build_object('text', E'\u00a0 Sim. \t'))));
  perform pg_temp.expect('returned text canonical', (select response_text from public.request_submissions where id = sub), 'Sim.');
  perform pg_temp.expect('returned-round replay', pg_temp.svc(pg_temp.submit_sql(r, sub, ret,
    jsonb_build_object('response', jsonb_build_object('text', E'\u00a0 Sim. \t')))) ->> 'replayed', 'true');
end
$$;

select 'initial-round whitespace canonicalization verified' as result;
