-- C3 whitespace canonicalization hardening (20260930160000). NOT a migration.
--
-- Named 99a so the existing harness (files starting with 9, in name order) runs it
-- after 99. Proves that the three C3 values the hardening covers — the return message,
-- the returned-round text and the returned-round notes — trim every whitespace
-- character at either end through `app.request_trim`, in the commands and in the
-- database backstop; that replay identity is unchanged; that the deliberately
-- untouched parts stayed untouched; and that no stored row needed rewriting.
-- Runs the commands as `service_role` with the actor passed in, like the Edge Functions,
-- on Requests of the 91 fixtures (staff aaaa…03, Nádia aaaa…01, organization bbbb…01).

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

/* Runs `q` as service_role; fails unless it raises `want_state` (and field error `want_code`). */
create or replace function pg_temp.expect_fail(label text, q text, want_state text, want_code text default null)
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
       where e ->> 'code' = want_code) then
      raise exception '% — expected field error %, got %', label, want_code, det;
    end if;
    return;
  end;
  execute 'reset role';
  raise exception '% — expected %, but it succeeded', label, want_state;
end;
$$;

/* A direct write that bypasses the commands must be refused by the named check constraint. */
create or replace function pg_temp.must_violate(statement text, want_constraint text, what text)
returns void
language plpgsql
as $$
declare
  got text;
begin
  begin
    execute statement;
  exception
    when check_violation then
      get stacked diagnostics got = constraint_name;
      if got is distinct from want_constraint then
        raise exception 'Rejected by % instead of %: %', coalesce(got, sqlerrm), want_constraint, what;
      end if;
      return;
  end;
  raise exception 'Not rejected by a check constraint: %', what;
end;
$$;

/* A direct write that must be accepted; rolled back so the append-only history is untouched. */
create or replace function pg_temp.must_accept(statement text, what text)
returns void
language plpgsql
as $$
begin
  begin
    execute statement;
    raise exception using errcode = 'P0B00', message = 'probe accepted';
  exception
    when sqlstate 'P0B00' then return;
    when others then raise exception 'Canonical row rejected (% / %): %', sqlstate, sqlerrm, what;
  end;
end;
$$;

create or replace function pg_temp.submit_sql(req uuid, sub uuid, expected uuid, payload jsonb)
returns text language sql as $$
  select format('select public.cmd_submit_request(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::jsonb)',
                'aaaaaaaa-0000-0000-0000-000000000001', req, sub, expected, payload);
$$;

create or replace function pg_temp.return_sql(req uuid, ret uuid, kind text, msg text)
returns text language sql as $$
  select format('select public.cmd_return_request_to_partner(%L::uuid, %L::uuid, %L::uuid, %s, %L, %L)',
                'aaaaaaaa-0000-0000-0000-000000000003', req, ret,
                (select revision from public.requests where id = req), kind, msg);
$$;

create or replace function pg_temp.events(id uuid, kind text)
returns bigint language sql as $$
  select count(*) from public.activity_events where object_id = $1 and event_type = $2;
$$;

/* Created, published and answered in its initial round (C2/C3 commands): waits on Sollelio. */
create or replace function pg_temp.answered(title text)
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
      'type', 'question', 'title', title, 'requested_action', 'Faça isto.', 'estimated_effort_minutes', 3,
      'internal', jsonb_build_object('completion_criteria', 'Respondido.'),
      'fields', jsonb_build_array(jsonb_build_object('label', 'Correu bem?', 'type', 'boolean', 'required', true)))));
  pv := pg_temp.svc(format('select public.cmd_preview_request(%L::uuid, %L::uuid)', staff, rid));
  perform pg_temp.svc(format('select public.cmd_publish_request(%L::uuid, %L::uuid, %s, %L::uuid)',
    staff, rid, (pv ->> 'revision')::integer, gen_random_uuid()));
  perform pg_temp.svc(pg_temp.submit_sql(rid, gen_random_uuid(), null, jsonb_build_object('answers', jsonb_build_array(
    jsonb_build_object('field_id', (select f.id from public.request_fields f where f.request_id = rid and f.key = 'q1'), 'value', false)))));
  return rid;
end;
$$;

-- 1. Structure: the three constraints and the two commands use app.request_trim ------
do $$
declare
  def text;
  src text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.request_returns'::regclass and conname = 'request_returns_message_check';
  if def is null or def not like '%app.request_trim(message)%' or def like '%btrim%' or def not like '%2000%' then
    raise exception 'request_returns_message_check is %', def;
  end if;
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.request_submissions'::regclass and conname = 'request_submissions_response_text_length';
  if def is null or def not like '%app.request_trim(response_text)%' or def like '%btrim%' or def not like '%4000%' then
    raise exception 'request_submissions_response_text_length is %', def;
  end if;
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.request_submissions'::regclass and conname = 'request_submissions_response_notes_length';
  if def is null or def not like '%app.request_trim(response_notes)%' or def like '%btrim%' or def not like '%4000%' then
    raise exception 'request_submissions_response_notes_length is %', def;
  end if;
  if exists (select 1 from pg_constraint
              where conrelid in ('public.request_returns'::regclass, 'public.request_submissions'::regclass)
                and contype = 'c' and not convalidated) then
    raise exception 'A C3 check constraint is NOT VALID: stored rows were not validated.';
  end if;

  src := (select prosrc from pg_proc where oid = 'public.cmd_return_request_to_partner(uuid, uuid, uuid, integer, text, text)'::regprocedure);
  if src not like '%msg text := app.request_trim(coalesce(p_message, ''''));%' or src like '%btrim%' then
    raise exception 'cmd_return_request_to_partner does not trim the message through app.request_trim.';
  end if;
  src := (select prosrc from pg_proc where oid = 'public.cmd_submit_request(uuid, uuid, uuid, uuid, jsonb)'::regprocedure);
  if src not like '%r_text := app.request_trim(resp ->> ''text'');%'
     or src not like '%r_notes := nullif(app.request_trim(resp ->> ''notes''), '''');%'
     or src like '%btrim(resp%' then
    raise exception 'cmd_submit_request does not trim the returned-round text and notes through app.request_trim.';
  end if;
  -- Deliberately unchanged: initial-round normalization (three btrim) and the replay hash.
  if (length(src) - length(replace(src, 'btrim(val #>> ''{}'')', ''))) / length('btrim(val #>> ''{}'')') <> 3 then
    raise exception 'Initial-round normalization changed in cmd_submit_request.';
  end if;
  src := (select prosrc from pg_proc where oid = 'app.request_submission_hash(uuid, jsonb)'::regprocedure);
  if src not like '%to_jsonb(btrim(e ->> ''value''))%' or src not like '%to_jsonb(btrim(kv.value #>> ''{}''))%' or src like '%request_trim%' then
    raise exception 'app.request_submission_hash changed: the replay identity of stored submissions must not move.';
  end if;
end
$$;

-- 2. Posture: signatures, INVOKER, empty search_path, service_role only -------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.cmd_submit_request(uuid, uuid, uuid, uuid, jsonb)',
    'public.cmd_return_request_to_partner(uuid, uuid, uuid, integer, text, text)',
    'public.cmd_cancel_request(uuid, uuid, integer, text)',
    'app.request_trim(text)']
  loop
    if (select prosecdef from pg_proc where oid = fn::regprocedure) then
      raise exception '% is SECURITY DEFINER.', fn;
    end if;
    if (select proconfig from pg_proc where oid = fn::regprocedure) is distinct from array['search_path=""'] then
      raise exception '% search_path is %', fn, (select proconfig from pg_proc where oid = fn::regprocedure);
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = fn::regprocedure and a.grantee = 0)
       or not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '% must be executable by service_role only.', fn;
    end if;
  end loop;
  -- Append-only history keeps its guards.
  if (select count(*) from pg_trigger where not tgisinternal and tgname in
       ('request_returns_append_only', 'request_submissions_append_only', 'request_answers_append_only')) <> 3 then
    raise exception 'An append-only trigger is missing.';
  end if;
end
$$;

-- 3. Stored history needed no rewrite ---------------------------------------------
do $$
begin
  perform pg_temp.expect('returns with a non-canonical message',
    (select count(*) from public.request_returns where message <> app.request_trim(message)), 0::bigint);
  perform pg_temp.expect('submissions with non-canonical text or notes',
    (select count(*) from public.request_submissions
      where response_text <> app.request_trim(response_text) or response_notes <> app.request_trim(response_notes)), 0::bigint);
end
$$;

create table pg_temp.ws (name text primary key, id uuid not null);

-- 4. The return message ---------------------------------------------------------------
do $$
declare
  r uuid := pg_temp.answered('Hardening — devolução em texto');
  ret uuid := gen_random_uuid();
  raw text := E'\n\t\u00a0 Acontece também no telemóvel? \u3000\r\n';
  rev0 integer := (select revision from public.requests where id = r);
  res jsonb;
begin
  insert into pg_temp.ws values ('text', r), ('text-return', ret);
  perform pg_temp.expect_fail('message of line breaks and tabs', pg_temp.return_sql(r, gen_random_uuid(), 'text', E' \n\t\r\n '), 'RQ003', 'required');
  perform pg_temp.expect_fail('message of Unicode spaces', pg_temp.return_sql(r, gen_random_uuid(), 'text', E'\u00a0\u2003\u3000\ufeff\u2028'), 'RQ003', 'required');
  perform pg_temp.expect_fail('message over 2000 after trimming', pg_temp.return_sql(r, gen_random_uuid(), 'text', E'\n' || repeat('m', 2001) || E'\u00a0'), 'RQ003', 'too_long');
  perform pg_temp.expect('refused messages wrote nothing',
    (select count(*) from public.request_returns where request_id = r) || '/' || (select revision from public.requests where id = r), '0/' || rev0);

  res := pg_temp.svc(pg_temp.return_sql(r, ret, 'text', raw));
  perform pg_temp.expect('return accepted', res ->> 'replayed', 'false');
  perform pg_temp.expect('message stored canonical', (select message from public.request_returns where id = ret), 'Acontece também no telemóvel?');
  -- Replay: the same attempt, and the same canonical message differently padded, replay.
  perform pg_temp.expect('exact replay', pg_temp.svc(pg_temp.return_sql(r, ret, 'text', raw)) ->> 'replayed', 'true');
  perform pg_temp.expect('canonical-equal replay', pg_temp.svc(pg_temp.return_sql(r, ret, 'text', E'\u00a0Acontece também no telemóvel?\t')) ->> 'replayed', 'true');
  perform pg_temp.expect_fail('changed message under the same id', pg_temp.return_sql(r, ret, 'text', 'Outra pergunta?'), 'RQ010');
  perform pg_temp.expect('one return, one event', (select count(*) from public.request_returns where request_id = r) || '/' || pg_temp.events(r, 'request.returned_to_partner'), '1/1');
end
$$;

-- 5. The returned-round text response ----------------------------------------------------
do $$
declare
  r uuid := (select id from pg_temp.ws where name = 'text');
  ret uuid := (select id from pg_temp.ws where name = 'text-return');
  sub uuid := gen_random_uuid();
  payload jsonb := jsonb_build_object('response', jsonb_build_object('text', E'\u00a0\n Sim, também no telemóvel. \t\u2003'));
  r1 jsonb;
  r2 jsonb;
begin
  perform pg_temp.expect_fail('text of line breaks and tabs',
    pg_temp.submit_sql(r, gen_random_uuid(), ret, jsonb_build_object('response', jsonb_build_object('text', E'\n\t\r\n'))), 'RQ003', 'required');
  perform pg_temp.expect_fail('text of Unicode spaces',
    pg_temp.submit_sql(r, gen_random_uuid(), ret, jsonb_build_object('response', jsonb_build_object('text', E'\u00a0\u3000\u205f\ufeff'))), 'RQ003', 'required');
  perform pg_temp.expect_fail('text over 4000 after trimming',
    pg_temp.submit_sql(r, gen_random_uuid(), ret, jsonb_build_object('response', jsonb_build_object('text', E'\t' || repeat('t', 4001)))), 'RQ003', 'too_long');
  perform pg_temp.expect('refused texts wrote nothing', (select count(*) from public.request_submissions where return_id = ret), 0::bigint);

  r1 := pg_temp.svc(pg_temp.submit_sql(r, sub, ret, payload));
  perform pg_temp.expect('text accepted', (r1 ->> 'replayed') || '/' || (select status from public.requests where id = r), 'false/needs_sollelio');
  perform pg_temp.expect('text stored canonical', (select response_text from public.request_submissions where id = sub), 'Sim, também no telemóvel.');

  -- Replay identity is the unchanged payload hash: the exact attempt replays, a changed one conflicts.
  r2 := pg_temp.svc(pg_temp.submit_sql(r, sub, ret, payload));
  perform pg_temp.expect('exact replay', (r2 ->> 'replayed') || '/' || (r2 ->> 'revision'), 'true/' || (r1 ->> 'revision'));
  perform pg_temp.expect_fail('changed text under the same id',
    pg_temp.submit_sql(r, sub, ret, jsonb_build_object('response', jsonb_build_object('text', 'Não.'))), 'RQ010');
  perform pg_temp.expect('one round submission, one event, state moved once',
    (select count(*) from public.request_submissions where return_id = ret) || '/' || pg_temp.events(r, 'request.submitted')
      || '/' || (select revision from public.requests where id = r),
    '1/2/' || (r1 ->> 'revision'));
end
$$;

-- 6. The returned-round approval notes -----------------------------------------------------
do $$
declare
  r uuid;
  ret uuid;
  sub uuid;
begin
  -- Needs changes, padded notes: stored canonical.
  r := pg_temp.answered('Hardening — notas com alterações');
  ret := gen_random_uuid();
  perform pg_temp.svc(pg_temp.return_sql(r, ret, 'approval', E'Corrigimos. Pode aprovar?\n'));
  perform pg_temp.expect('approval message stored canonical', (select message from public.request_returns where id = ret), 'Corrigimos. Pode aprovar?');
  perform pg_temp.expect_fail('notes over 4000 after trimming',
    pg_temp.submit_sql(r, gen_random_uuid(), ret, jsonb_build_object('response', jsonb_build_object(
      'decision', 'needs_changes', 'notes', E'\u00a0' || repeat('n', 4001)))), 'RQ003', 'too_long');
  sub := gen_random_uuid();
  perform pg_temp.svc(pg_temp.submit_sql(r, sub, ret, jsonb_build_object('response', jsonb_build_object(
    'decision', 'needs_changes', 'notes', E'\n\t Mudem a cor do botão. \u00a0\r\n'))));
  perform pg_temp.expect('notes stored canonical',
    (select response_decision || '/' || response_notes from public.request_submissions where id = sub), 'needs_changes/Mudem a cor do botão.');

  -- Needs changes, whitespace-only notes: no notes (NULL), as C3 intends for blank notes.
  r := pg_temp.answered('Hardening — notas em branco');
  ret := gen_random_uuid();
  perform pg_temp.svc(pg_temp.return_sql(r, ret, 'approval', 'Pode aprovar?'));
  sub := gen_random_uuid();
  perform pg_temp.svc(pg_temp.submit_sql(r, sub, ret, jsonb_build_object('response', jsonb_build_object(
    'decision', 'needs_changes', 'notes', E'\n\u00a0\t\u3000'))));
  perform pg_temp.expect('blank notes stored as NULL',
    (select response_decision || '/' || coalesce(response_notes, '∅') from public.request_submissions where id = sub), 'needs_changes/∅');

  -- Approve with whitespace-only notes: blank notes are no notes, so approve is accepted
  -- (before, U+00A0 or a line break counted as notes and approve was refused).
  r := pg_temp.answered('Hardening — aprovar com notas em branco');
  ret := gen_random_uuid();
  perform pg_temp.svc(pg_temp.return_sql(r, ret, 'approval', 'Pode aprovar?'));
  sub := gen_random_uuid();
  perform pg_temp.svc(pg_temp.submit_sql(r, sub, ret, jsonb_build_object('response', jsonb_build_object(
    'decision', 'approve', 'notes', E'\u00a0\r\n'))));
  perform pg_temp.expect('approve with blank notes',
    (select response_decision || '/' || coalesce(response_notes, '∅') from public.request_submissions where id = sub), 'approve/∅');
  -- Real notes with approve stay refused (the decision rule is unchanged).
  r := pg_temp.answered('Hardening — aprovar com notas');
  ret := gen_random_uuid();
  perform pg_temp.svc(pg_temp.return_sql(r, ret, 'approval', 'Pode aprovar?'));
  perform pg_temp.expect_fail('approve with real notes',
    pg_temp.submit_sql(r, gen_random_uuid(), ret, jsonb_build_object('response', jsonb_build_object(
      'decision', 'approve', 'notes', E'\u00a0Mudem.\n'))), 'RQ003', 'notes_not_allowed');
end
$$;

-- 7. The database backstop: direct writes that bypass the commands -------------------------
do $$
declare
  r uuid := pg_temp.answered('Hardening — escrita directa');
  staff uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  nadia uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  ret uuid := gen_random_uuid();
begin
  perform pg_temp.must_violate(format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (%L, %L, ''text'', %L, %L)',
    gen_random_uuid(), r, E'\nMensagem', staff), 'request_returns_message_check', 'return message with a leading line break');
  perform pg_temp.must_violate(format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (%L, %L, ''text'', %L, %L)',
    gen_random_uuid(), r, E'Mensagem\u00a0', staff), 'request_returns_message_check', 'return message with a trailing no-break space');
  perform pg_temp.must_violate(format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (%L, %L, ''text'', %L, %L)',
    gen_random_uuid(), r, E'\u3000', staff), 'request_returns_message_check', 'return message of one ideographic space');
  perform pg_temp.must_accept(format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (%L, %L, ''text'', %L, %L)',
    gen_random_uuid(), r, E'Linha um\nLinha dois', staff), 'canonical message with an inner line break');

  -- Submissions need their return in the same probe; the whole probe is rolled back.
  perform pg_temp.must_violate(format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (%1$L, %2$L, ''text'', ''Pergunta?'', %3$L);
     insert into public.request_submissions (id, request_id, submitted_by, source, return_id, response_text, payload_hash)
     values (gen_random_uuid(), %2$L, %4$L, ''partner_os'', %1$L, %5$L, md5(''x''))',
    ret, r, staff, nadia, E'Texto\t'), 'request_submissions_response_text_length', 'response text with a trailing tab');
  perform pg_temp.must_violate(format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (%1$L, %2$L, ''approval'', ''Aprova?'', %3$L);
     insert into public.request_submissions (id, request_id, submitted_by, source, return_id, response_decision, response_notes, payload_hash)
     values (gen_random_uuid(), %2$L, %4$L, ''partner_os'', %1$L, ''needs_changes'', %5$L, md5(''x''))',
    ret, r, staff, nadia, E'\u2003Notas'), 'request_submissions_response_notes_length', 'response notes with a leading em space');
  perform pg_temp.must_accept(format(
    'insert into public.request_returns (id, request_id, response_type, message, created_by) values (%1$L, %2$L, ''approval'', ''Aprova?'', %3$L);
     insert into public.request_submissions (id, request_id, submitted_by, source, return_id, response_decision, response_notes, payload_hash)
     values (gen_random_uuid(), %2$L, %4$L, ''partner_os'', %1$L, ''needs_changes'', ''Notas'', md5(''x''))',
    ret, r, staff, nadia), 'canonical notes');
  perform pg_temp.expect('probes left no rows', (select count(*) from public.request_returns where request_id = r), 0::bigint);
end
$$;

-- 8. C4 is untouched: the cancellation reason still trims through app.request_trim ---------
do $$
declare
  r uuid := pg_temp.answered('Hardening — C4 intacto');
begin
  perform pg_temp.svc(format('select public.cmd_cancel_request(%L::uuid, %L::uuid, %s, %L)',
    'aaaaaaaa-0000-0000-0000-000000000003', r, (select revision from public.requests where id = r), E'\u00a0\n O evento foi adiado. \t'));
  perform pg_temp.expect('cancellation reason canonical', (select cancellation_reason from public.requests where id = r), 'O evento foi adiado.');
end
$$;

select 'C3 whitespace canonicalization hardening verified' as result;
