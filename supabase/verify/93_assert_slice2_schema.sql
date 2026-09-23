-- Slice 2, C1 — structural assertions. NOT a migration.
--
-- Proves the wave-2 objects exist in the shape the canonical model specifies, and
-- that the invariants are enforced by the database rather than trusted to a caller.

-- 1. The seven wave-2 tables exist, with RLS enabled ------------------------
do $$
declare
  expected text[] := array[
    'requests', 'request_internal_details', 'request_fields', 'request_submissions',
    'request_answers', 'request_internal_notes', 'activity_events'];
  missing text;
  unprotected text;
begin
  select string_agg(t, ', ') into missing
    from unnest(expected) t
   where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Wave 2 table(s) missing: %', missing;
  end if;

  select string_agg(c.relname, ', ') into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = any (expected)
     and not c.relrowsecurity;
  if unprotected is not null then
    raise exception 'RLS not enabled on: %', unprotected;
  end if;
end
$$;

-- 2. The enumerated vocabulary is exactly as specified ----------------------
do $$
declare
  spec record;
  got text[];
begin
  for spec in
    select * from (values
      ('request_status',        array['draft','needs_partner','needs_sollelio','completed','cancelled']),
      ('request_type',          array['review','approval','question','test','task']),
      ('request_next_actor',    array['partner','sollelio','none']),
      ('request_field_type',    array['long_text','single_choice','boolean','approval']),
      ('partner_request_state', array['needs_you','with_sollelio','done','cancelled']),
      ('request_priority',      array['normal','important','urgent']),
      ('activity_object_type',  array['request','update','issue','resource','organization'])
    ) as t(name, want)
  loop
    select array_agg(e.enumlabel order by e.enumsortorder) into got
      from pg_enum e where e.enumtypid = ('public.' || spec.name)::regtype;

    if got is distinct from spec.want then
      raise exception 'Enum % is %, expected %', spec.name, got, spec.want;
    end if;
  end loop;
end
$$;

-- 3. `partner_requests` is a security-barrier view with exactly the contract --
do $$
declare
  want text[] := array[
    'id', 'organization_id', 'product_id', 'product_name', 'type', 'title', 'context',
    'requested_action', 'estimated_effort_minutes', 'due_at', 'partner_state',
    'published_at', 'completed_at', 'cancelled_at', 'related_update_id'];
  got text[];
  leaked text[];
  barrier boolean;
begin
  if to_regclass('public.partner_requests') is null then
    raise exception 'partner_requests does not exist.';
  end if;

  select array_agg(column_name::text order by ordinal_position) into got
    from information_schema.columns
   where table_schema = 'public' and table_name = 'partner_requests';

  if got is distinct from want then
    raise exception 'partner_requests columns are %, expected %', got, want;
  end if;

  -- Named individually, so that widening the view is a visible act rather than a
  -- silent one. These are the columns §12.3 excludes.
  select array_agg(c) into leaked
    from unnest(array['status', 'next_actor', 'assignee_profile_id', 'created_by',
                      'completion_criteria', 'internal_owner_profile_id', 'priority']) c
   where c = any (got);
  if leaked is not null then
    raise exception 'Internal column(s) leaked into partner_requests: %', leaked;
  end if;

  select (c.reloptions @> array['security_barrier=true']) into barrier
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'partner_requests';
  if not coalesce(barrier, false) then
    raise exception 'partner_requests is not a security_barrier view.';
  end if;

  -- `security_invoker` must stay off. Turning it on would silently move enforcement
  -- from the view's own predicate to the caller's RLS on the base table — a
  -- different authorization model reached by a one-word change.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'partner_requests'
       and c.reloptions @> array['security_invoker=true'])
  then
    raise exception 'partner_requests has security_invoker enabled; enforcement model changed.';
  end if;
end
$$;

-- 4. The status/next_actor invariants are enforced, not merely documented ----
do $$
declare
  org uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  who uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  author uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  bad record;
begin
  for bad in
    select * from (values
      -- Each row is a state the model forbids.
      ('needs_partner', 'none',     null::timestamptz, 'actionable with no actor'),
      ('needs_partner', 'sollelio', now(),             'partner state, Sollelio actor'),
      ('draft',         'partner',  null,              'draft with an actor'),
      ('needs_sollelio','sollelio', null,              'published state, never published'),
      ('completed',     'none',     now(),             'completed without completed_at'),
      ('cancelled',     'none',     now(),             'cancelled without cancelled_at')
    ) as t(st, na, pub, label)
  loop
    begin
      insert into public.requests (
        organization_id, type, status, next_actor, title, requested_action,
        estimated_effort_minutes, assignee_profile_id, created_by, published_at)
      values (org, 'task', bad.st::public.request_status, bad.na::public.request_next_actor,
              'invariant probe', 'probe', 1, who, author, bad.pub);
      raise exception 'Invariant not enforced: % was accepted', bad.label;
    exception
      when check_violation then null;  -- expected
    end;
  end loop;
end
$$;

-- 5. Effort, and the assignee membership invariant --------------------------
do $$
begin
  begin
    insert into public.requests (
      organization_id, type, status, next_actor, title, requested_action,
      estimated_effort_minutes, assignee_profile_id, created_by)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'task', 'draft', 'none',
            'zero effort', 'probe', 0,
            'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003');
    raise exception 'Zero effort was accepted; the smallest honest estimate is 1.';
  exception when check_violation then null;
  end;

  -- Assignee must hold an ACTIVE membership in the Request's organization.
  begin
    insert into public.requests (
      organization_id, type, status, next_actor, title, requested_action,
      estimated_effort_minutes, assignee_profile_id, created_by)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'task', 'draft', 'none',
            'wrong org assignee', 'probe', 1,
            'aaaaaaaa-0000-0000-0000-000000000002',  -- belongs to the other organization
            'aaaaaaaa-0000-0000-0000-000000000003');
    raise exception 'A Request was assigned to a non-member.';
  exception when check_violation then null;
  end;

  -- Staff hold no memberships, so staff can never be an assignee either.
  begin
    insert into public.requests (
      organization_id, type, status, next_actor, title, requested_action,
      estimated_effort_minutes, assignee_profile_id, created_by)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'task', 'draft', 'none',
            'staff assignee', 'probe', 1,
            'aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003');
    raise exception 'A Request was assigned to Sollelio staff.';
  exception when check_violation then null;
  end;
end
$$;

-- 6. Field identity and ordering -------------------------------------------
do $$
begin
  begin
    insert into public.request_fields (request_id, key, label, type)
    values ('eeeeeeee-0000-0000-0000-000000000001', 'conseguiu', 'Duplicada', 'long_text');
    raise exception 'A duplicate field key was accepted within one Request.';
  exception when unique_violation then null;
  end;

  if not exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indrelid
     where c.relname = 'request_fields'
       and pg_get_indexdef(i.indexrelid) like '%sort_order%')
  then
    raise exception 'request_fields has no index supporting ordered reads.';
  end if;
end
$$;

select 'slice 2 schema and invariants verified' as result;
