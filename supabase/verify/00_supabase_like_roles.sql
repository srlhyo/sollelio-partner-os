-- Verification fixture — NOT a migration, never applied to a real project.
--
-- Recreates the parts of a Supabase database that migrations assume exist, so the
-- migration set can be replayed against a plain PostgreSQL container. It
-- deliberately reproduces Supabase's permissive default privileges, so that
-- verifying the baseline posture proves our migration actually removes them rather
-- than passing on an empty database that never had them.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase's stock defaults: everything new is readable by the API roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- The `auth` schema, reduced to what Partner OS actually depends on: the users
-- table profiles references, and the uid() helper policies call. GoTrue owns these
-- in a real project.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
