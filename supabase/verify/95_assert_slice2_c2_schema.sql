-- Slice 2, C2 — structural and privilege assertions. NOT a migration.
--
-- Proves the C2 objects exist in the shape 05_DATA_MODEL_AND_API.md §4, §12.3 and §13
-- specify, and that the partner-facing projection is defined once.

-- 1. Revision and resource link ----------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'requests'
                    and column_name = 'revision' and is_nullable = 'NO' and data_type = 'integer') then
    raise exception 'requests.revision missing or not an integer NOT NULL.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'requests'
                    and column_name = 'resource_id' and is_nullable = 'YES') then
    raise exception 'requests.resource_id missing or not nullable.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.requests'::regclass and contype = 'f'
       and confrelid = 'public.resources'::regclass
       and conkey = array[(select attnum from pg_attribute where attrelid = 'public.requests'::regclass and attname = 'resource_id')])
  then
    raise exception 'requests.resource_id has no foreign key to resources.';
  end if;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and t.tgname in (
         'requests_bump_revision', 'requests_assert_resource_coherent',
         'request_fields_touch_parent_request', 'request_internal_details_touch_parent_request')) <> 4 then
    raise exception 'C2 triggers missing.';
  end if;
end
$$;

-- 2. One projection: the public view is the internal one, filtered -----------
do $$
declare
  proj text[];
  pub text[];
  def text;
begin
  if to_regclass('app.partner_request_projection') is null then
    raise exception 'app.partner_request_projection does not exist.';
  end if;

  select array_agg(column_name::text order by ordinal_position) into proj
    from information_schema.columns where table_schema = 'app' and table_name = 'partner_request_projection';
  select array_agg(column_name::text order by ordinal_position) into pub
    from information_schema.columns where table_schema = 'public' and table_name = 'partner_requests';

  if proj is distinct from pub || array['assignee_profile_id'] then
    raise exception 'Projection % is not the public contract % plus assignee_profile_id.', proj, pub;
  end if;

  -- The public view reads the projection and nothing else.
  if exists (
    select 1 from pg_depend d join pg_rewrite rw on rw.oid = d.objid
      join pg_class rc on rc.oid = d.refobjid
     where rw.ev_class = 'public.partner_requests'::regclass
       and d.refobjid <> rw.ev_class and rc.relkind in ('r', 'v', 'm')
       and rc.oid <> 'app.partner_request_projection'::regclass)
  then
    raise exception 'public.partner_requests reads something other than app.partner_request_projection.';
  end if;

  -- PostgreSQL 15 prints the membership argument as pr.organization_id; 17 drops the
  -- alias of a single-relation view. Only that alias is optional.
  def := pg_get_viewdef('public.partner_requests'::regclass, true);
  if def !~ 'published_at IS NOT NULL' or def !~ 'assignee_profile_id = app\.current_profile_id\(\)'
     or def !~ 'app\.has_active_membership\((pr\.)?organization_id\)' then
    raise exception 'public.partner_requests predicate changed: %', def;
  end if;

  if not exists (select 1 from pg_class c where c.oid = 'public.partner_requests'::regclass
                  and c.relowner = 'postgres'::regrole and c.reloptions @> array['security_barrier=true'])
     or exists (select 1 from pg_class c where c.oid = 'public.partner_requests'::regclass
                  and (c.reloptions @> array['security_invoker=true'] or c.reloptions @> array['security_invoker=on'])) then
    raise exception 'public.partner_requests owner/security options changed.';
  end if;
end
$$;

-- 3. Privileges of the new objects -------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.cmd_create_request(uuid, uuid, jsonb)',
    'public.cmd_update_request_draft(uuid, uuid, integer, jsonb)',
    'public.cmd_preview_request(uuid, uuid)',
    'public.cmd_publish_request(uuid, uuid, integer, uuid)',
    'app.request_normalize(jsonb, text)',
    'app.request_check_references(uuid, jsonb, boolean)',
    'app.request_write_content(uuid, uuid, jsonb)',
    'app.request_require_staff(uuid)',
    'app.request_fail(text, text, jsonb)',
    'app.request_err(text, text, text)']
  loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '% is executable by an API role.', fn;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = fn::regprocedure and a.grantee = 0) then
      raise exception '% is executable by PUBLIC.', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '% is not executable by service_role.', fn;
    end if;
  end loop;

  -- Every C2 command runs as its caller; none is SECURITY DEFINER.
  if exists (select 1 from pg_proc where proname like 'cmd\_%' escape '\' and prosecdef) then
    raise exception 'A C2 command is SECURITY DEFINER.';
  end if;

  if has_table_privilege('anon', 'app.partner_request_projection', 'SELECT')
     or has_table_privilege('authenticated', 'app.partner_request_projection', 'SELECT') then
    raise exception 'An API role can read the internal projection.';
  end if;
  if not has_table_privilege('service_role', 'app.partner_request_projection', 'SELECT') then
    raise exception 'service_role cannot read the projection the preview needs.';
  end if;

  if has_table_privilege('anon', 'public.request_command_receipts', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.request_command_receipts', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'An API role can reach request_command_receipts.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.request_command_receipts'::regclass) then
    raise exception 'request_command_receipts has RLS disabled.';
  end if;
  if exists (select 1 from pg_policies where tablename = 'request_command_receipts') then
    raise exception 'request_command_receipts must have no policies.';
  end if;
end
$$;

-- 4. No new direct write reaches the API ---------------------------------------
do $$
declare
  got text[];
begin
  select array_agg(g order by g) into got from (
  select format('%s:%s:%s', c.relname, a.grantee::regrole, a.privilege_type) as g
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('requests', 'request_internal_details', 'request_fields', 'request_submissions',
                       'request_answers', 'request_internal_notes', 'activity_events', 'partner_requests',
                       'request_command_receipts')
     and a.grantee <> 0 and a.grantee::regrole::text in ('anon', 'authenticated')) x;

  if got is distinct from array[
    'activity_events:authenticated:SELECT', 'partner_requests:authenticated:SELECT',
    'request_answers:authenticated:SELECT', 'request_fields:authenticated:SELECT',
    'request_internal_details:authenticated:SELECT', 'request_internal_notes:authenticated:INSERT',
    'request_internal_notes:authenticated:SELECT', 'request_internal_notes:authenticated:UPDATE',
    'request_submissions:authenticated:SELECT', 'requests:authenticated:SELECT'] then
    raise exception 'API role grants on the Request domain changed: %', got;
  end if;
end
$$;

select 'slice 2 C2 schema and privileges verified' as result;
