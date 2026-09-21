-- Verification assertions — NOT a migration.
--
-- Proves the Phase 0 baseline actually holds after every migration has been
-- applied. Any failure raises and fails the run.

-- 1. The privileged helper namespace exists and is closed to API roles.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'app') then
    raise exception 'Expected schema "app" to exist.';
  end if;

  if has_schema_privilege('anon', 'app', 'USAGE') then
    raise exception 'anon must not have USAGE on schema app.';
  end if;

  if has_schema_privilege('authenticated', 'app', 'USAGE') then
    raise exception 'authenticated must not have USAGE on schema app.';
  end if;
end
$$;

-- 2. Default deny is real: a table created the way a migration creates one must be
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

select 'baseline security posture verified' as result;
