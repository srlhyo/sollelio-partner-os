-- Slice 2, C1 — release-blocking authorization assertions. NOT a migration.
--
-- Each block impersonates a real caller the way PostgREST does: `set role
-- authenticated` plus the request's JWT claims. No policy is weakened to make a
-- case pass; every negative is a real denial.

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

/* Expects the statement to be refused. `what` names the attempt for the message. */
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
      -- An RLS WITH CHECK failure is also a refusal.
      if sqlstate <> '42501' and sqlerrm not like '%row-level security%' then
        raise exception 'Refused for the wrong reason (% / %) on: %', sqlstate, sqlerrm, what;
      end if;
  end;
end;
$$;

do $$
declare
  nadia  text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  other  text := '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  helio  text := '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
  susp   text := '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
  n bigint;
begin
  -- ---- Partner cannot reach the internal Request tables -------------------
  n := pg_temp.count_as(nadia, 'select id from public.requests');
  if n <> 0 then raise exception 'Partner read the requests base table, saw % row(s)', n; end if;

  n := pg_temp.count_as(nadia, 'select request_id from public.request_internal_details');
  if n <> 0 then raise exception 'Partner read request_internal_details.'; end if;

  n := pg_temp.count_as(nadia, 'select id from public.request_internal_notes');
  if n <> 0 then raise exception 'Partner read request_internal_notes.'; end if;

  n := pg_temp.count_as(nadia, 'select id from public.activity_events');
  if n <> 0 then raise exception 'Partner read activity_events.'; end if;

  -- ---- Partner sees exactly their own published Requests ------------------
  -- Fixtures: 4 published and assigned to Nádia (needs_partner, needs_sollelio,
  -- completed, cancelled); excluded are her draft, another org's, and one assigned
  -- to somebody else.
  n := pg_temp.count_as(nadia, 'select id from public.partner_requests');
  if n <> 4 then raise exception 'Nádia should see 4 Requests, saw %', n; end if;

  n := pg_temp.count_as(nadia,
    'select id from public.partner_requests where id = ''eeeeeeee-0000-0000-0000-000000000002''');
  if n <> 0 then raise exception 'A draft reached the partner.'; end if;

  n := pg_temp.count_as(nadia,
    'select id from public.partner_requests where organization_id <> ''bbbbbbbb-0000-0000-0000-000000000001''');
  if n <> 0 then raise exception 'Another organization''s Request reached the partner.'; end if;

  n := pg_temp.count_as(nadia,
    'select id from public.partner_requests where id = ''eeeeeeee-0000-0000-0000-000000000004''');
  if n <> 0 then raise exception 'A Request assigned to someone else reached the partner.'; end if;

  -- The other partner sees only their own organization's.
  n := pg_temp.count_as(other, 'select id from public.partner_requests');
  if n <> 1 then raise exception 'The other partner should see 1 Request, saw %', n; end if;

  -- ---- Losing the membership loses the Request ----------------------------
  n := pg_temp.count_as(susp, 'select id from public.partner_requests');
  if n <> 0 then
    raise exception 'A deactivated member still sees a Request assigned to them, saw %', n;
  end if;

  -- ---- Lifecycle vocabulary is translated, never exposed ------------------
  n := pg_temp.count_as(nadia,
    'select id from public.partner_requests where partner_state = ''needs_you''');
  if n <> 1 then raise exception 'Expected exactly 1 needs_you Request, saw %', n; end if;

  n := pg_temp.count_as(nadia,
    'select id from public.partner_requests where partner_state = ''with_sollelio''');
  if n <> 1 then raise exception 'Expected exactly 1 with_sollelio Request, saw %', n; end if;

  n := pg_temp.count_as(nadia,
    'select id from public.partner_requests where partner_state in (''done'',''cancelled'')');
  if n <> 2 then raise exception 'Expected done and cancelled to be visible, saw %', n; end if;

  -- ---- Fields, submissions and answers ------------------------------------
  -- Only the fields of Requests she can see: 2 on her visible Request, never the
  -- field belonging to the other organization's Request.
  n := pg_temp.count_as(nadia, 'select id from public.request_fields');
  if n <> 2 then raise exception 'Nádia should see 2 request_fields, saw %', n; end if;

  n := pg_temp.count_as(nadia,
    'select id from public.request_fields where id = ''ffffffff-0000-0000-0000-000000000003''');
  if n <> 0 then raise exception 'A field from another organization reached the partner.'; end if;

  n := pg_temp.count_as(nadia, 'select id from public.request_submissions');
  if n <> 1 then raise exception 'Nádia should see only her own submission, saw %', n; end if;

  n := pg_temp.count_as(nadia, 'select id from public.request_answers');
  if n <> 1 then raise exception 'Nádia should see only her own answer, saw %', n; end if;

  n := pg_temp.count_as(other, 'select id from public.request_answers');
  if n <> 1 then raise exception 'The other partner should see only their answer, saw %', n; end if;

  -- ---- Staff, global and without membership -------------------------------
  n := pg_temp.count_as(helio, 'select id from public.requests');
  if n <> (select count(*) from public.requests) then
    raise exception 'Staff should see every Request, saw %', n;
  end if;

  n := pg_temp.count_as(helio, 'select request_id from public.request_internal_details');
  if n <> (select count(*) from public.request_internal_details) then
    raise exception 'Staff should see internal details.';
  end if;

  n := pg_temp.count_as(helio, 'select id from public.request_internal_notes');
  if n <> (select count(*) from public.request_internal_notes) then
    raise exception 'Staff should see internal notes.';
  end if;

  n := pg_temp.count_as(helio, 'select id from public.activity_events');
  if n <> (select count(*) from public.activity_events) then
    raise exception 'Staff should see activity events.';
  end if;

  n := pg_temp.count_as(helio, 'select id from public.request_fields');
  if n <> (select count(*) from public.request_fields) then
    raise exception 'Staff should see every field.';
  end if;

  -- Staff reach all of that holding no membership at all.
  if exists (select 1 from public.organization_memberships
              where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003') then
    raise exception 'Staff must not be modelled as a member of a partner organization.';
  end if;

  -- Staff hold no partner projection of their own: it is assignee-scoped.
  n := pg_temp.count_as(helio, 'select id from public.partner_requests');
  if n <> 0 then raise exception 'partner_requests returned rows for staff, saw %', n; end if;

  -- ---- Anonymous callers reach nothing ------------------------------------
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  begin
    perform 1 from public.partner_requests;
    reset role;
    raise exception 'anon can query partner_requests.';
  exception
    when insufficient_privilege then reset role;
  end;
end
$$;

-- ---- No partner may write any Request-domain table ------------------------
do $$
declare
  nadia text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
begin
  perform pg_temp.must_refuse(nadia,
    'insert into public.requests (organization_id, type, status, next_actor, title,
       requested_action, estimated_effort_minutes, assignee_profile_id, created_by)
     values (''bbbbbbbb-0000-0000-0000-000000000001'', ''task'', ''draft'', ''none'',
       ''forjado'', ''forjado'', 1, ''aaaaaaaa-0000-0000-0000-000000000001'',
       ''aaaaaaaa-0000-0000-0000-000000000001'')',
    'partner INSERT into requests');

  perform pg_temp.must_refuse(nadia,
    'update public.requests set status = ''completed'' where id = ''eeeeeeee-0000-0000-0000-000000000001''',
    'partner UPDATE of a Request lifecycle');

  perform pg_temp.must_refuse(nadia,
    'delete from public.requests where id = ''eeeeeeee-0000-0000-0000-000000000001''',
    'partner DELETE of a Request');

  perform pg_temp.must_refuse(nadia,
    'insert into public.request_submissions (request_id, submitted_by)
     values (''eeeeeeee-0000-0000-0000-000000000001'', ''aaaaaaaa-0000-0000-0000-000000000001'')',
    'partner INSERT into request_submissions');

  perform pg_temp.must_refuse(nadia,
    'insert into public.request_answers (submission_id, request_field_id, value)
     values (''dddddddd-1111-0000-0000-000000000001'', ''ffffffff-0000-0000-0000-000000000001'', ''true''::jsonb)',
    'partner INSERT into request_answers');

  perform pg_temp.must_refuse(nadia,
    'insert into public.request_internal_notes (request_id, author_profile_id, content)
     values (''eeeeeeee-0000-0000-0000-000000000001'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''x'')',
    'partner INSERT into request_internal_notes');

  perform pg_temp.must_refuse(nadia,
    'insert into public.activity_events (organization_id, event_type, object_type, object_id)
     values (''bbbbbbbb-0000-0000-0000-000000000001'', ''request.completed'', ''request'',
             ''eeeeeeee-0000-0000-0000-000000000001'')',
    'partner INSERT into activity_events');

  perform pg_temp.must_refuse(nadia,
    'insert into public.request_fields (request_id, key, label, type)
     values (''eeeeeeee-0000-0000-0000-000000000001'', ''forjado'', ''Forjado'', ''long_text'')',
    'partner INSERT into request_fields');
end
$$;

-- ---- No lifecycle write reaches the API, for staff either -----------------
-- Lifecycle mutation belongs to the commands of C3/C4, so no API role holds an
-- INSERT or UPDATE grant on `requests` in this checkpoint.
do $$
declare
  helio text := '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
begin
  perform pg_temp.must_refuse(helio,
    'update public.requests set status = ''completed'', completed_at = now(), next_actor = ''none''
      where id = ''eeeeeeee-0000-0000-0000-000000000001''',
    'staff UPDATE of a Request lifecycle through the API');

  perform pg_temp.must_refuse(helio,
    'insert into public.activity_events (organization_id, event_type, object_type, object_id)
     values (''bbbbbbbb-0000-0000-0000-000000000001'', ''request.completed'', ''request'',
             ''eeeeeeee-0000-0000-0000-000000000001'')',
    'staff INSERT into activity_events through the API');
end
$$;

-- ---- An authenticated caller with no profile row -------------------------
-- Invite-first onboarding opens a real window where the auth user exists and the
-- profile does not. `app.current_profile_id()` returns NULL there, and the
-- projection predicate compares a column to NULL — which is never true, so the
-- caller fails closed. This proves that empirically rather than by reading it.
do $$
declare
  ghost text := '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
  pid uuid;
  n bigint;
begin
  -- The identity exists at the auth layer...
  if not exists (select 1 from auth.users where id = '66666666-6666-6666-6666-666666666666') then
    raise exception 'Fixture missing: the no-profile auth user does not exist.';
  end if;

  -- ...and deliberately has no profile.
  if exists (select 1 from public.profiles
              where auth_user_id = '66666666-6666-6666-6666-666666666666') then
    raise exception 'Fixture wrong: the no-profile caller has a profile row.';
  end if;

  perform set_config('request.jwt.claims', ghost, true);
  set local role authenticated;
  select app.current_profile_id() into pid;
  reset role;

  if pid is not null then
    raise exception 'A caller with no profile resolved to profile %', pid;
  end if;

  n := pg_temp.count_as(ghost, 'select id from public.partner_requests');
  if n <> 0 then raise exception 'A caller with no profile saw % Request(s).', n; end if;

  -- And nothing else of the Request domain becomes visible either.
  for n in
    select pg_temp.count_as(ghost, 'select 1 from public.' || t)
      from unnest(array['requests', 'request_internal_details', 'request_internal_notes',
                        'request_fields', 'request_submissions', 'request_answers',
                        'activity_events']) t
  loop
    if n <> 0 then
      raise exception 'A caller with no profile read % row(s) of Request data.', n;
    end if;
  end loop;
end
$$;

-- ---- An authenticated caller whose claims are absent ----------------------
-- `set_config(..., NULL, ...)` leaves an empty string once the GUC has been set.
-- Production `auth.uid()` returns NULL there; the harness now matches, so this case
-- is a clean zero rather than a JSON parse error.
do $$
declare
  n bigint;
  pid uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  select app.current_profile_id() into pid;
  select count(*) from public.partner_requests into n;
  reset role;

  if pid is not null then
    raise exception 'Empty claims resolved to profile %', pid;
  end if;
  if n <> 0 then
    raise exception 'Empty claims returned % Request(s).', n;
  end if;
end
$$;

select 'slice 2 authorization verified' as result;
