-- Verification assertions — NOT a migration.
--
-- Proves the baseline security posture holds after every migration has been
-- applied. Any failure raises and fails the run.

-- 1. The privileged helper namespace exists, and stays shut to anonymous callers.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'app') then
    raise exception 'Expected schema "app" to exist.';
  end if;

  if has_schema_privilege('anon', 'app', 'USAGE') then
    raise exception 'anon must not have USAGE on schema app.';
  end if;
end
$$;

-- 2. Every function in `app` withholds EXECUTE from PUBLIC.
--
--    PostgreSQL grants EXECUTE on new functions to PUBLIC and no default-privilege
--    setting can take that back, so each migration must revoke it explicitly. A NULL
--    proacl means the built-in default is in force — that is the failure this looks
--    for. Forgetting the revoke on a future helper fails the build here.
do $$
declare
  leaky text;
begin
  select string_agg(p.proname, ', ')
    into leaky
    from pg_proc p
   where p.pronamespace = 'app'::regnamespace
     and (p.proacl is null or 'public' = any (select (aclexplode(p.proacl)).grantee::regrole::text));

  if leaky is not null then
    raise exception 'EXECUTE is public on app function(s): %', leaky;
  end if;
end
$$;

--    The helpers policies call are reachable by `authenticated` and by nobody else.
do $$
begin
  if not has_function_privilege('authenticated', 'app.is_staff()', 'EXECUTE') then
    raise exception 'authenticated must be able to execute app.is_staff().';
  end if;

  if has_function_privilege('anon', 'app.is_staff()', 'EXECUTE') then
    raise exception 'anon must not be able to execute app.is_staff().';
  end if;

  if has_function_privilege('anon', 'app.current_profile_id()', 'EXECUTE') then
    raise exception 'anon must not be able to execute app.current_profile_id().';
  end if;
end
$$;

-- 3. Default deny is real: a table created the way a migration creates one must be
--    unreachable by the API roles before any policy is written.
create table public.__posture_probe (id integer primary key);

do $$
begin
  if has_table_privilege('anon', 'public.__posture_probe', 'SELECT') then
    raise exception 'Default deny broken: anon can SELECT a newly created table.';
  end if;

  if has_table_privilege('authenticated', 'public.__posture_probe', 'SELECT') then
    raise exception 'Default deny broken: authenticated can SELECT a newly created table.';
  end if;

  if has_table_privilege('authenticated', 'public.__posture_probe', 'INSERT') then
    raise exception 'Default deny broken: authenticated can INSERT into a newly created table.';
  end if;
end
$$;

drop table public.__posture_probe;

-- 4. Every table in `public` has RLS enabled (05_DATA_MODEL_AND_API.md §12.1).
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
    into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'RLS is not enabled on: %', unprotected;
  end if;
end
$$;

-- 5. No table grants DELETE to the API roles: history is archived, never destroyed.
do $$
declare
  deletable text;
begin
  select string_agg(format('%s (%s)', table_name, grantee), ', ')
    into deletable
    from information_schema.role_table_grants
   where table_schema = 'public'
     and privilege_type = 'DELETE'
     and grantee in ('anon', 'authenticated');

  if deletable is not null then
    raise exception 'DELETE granted to an API role on: %', deletable;
  end if;
end
$$;

select 'baseline security posture verified' as result;
