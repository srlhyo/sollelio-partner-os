-- Phase 0 — baseline security posture.
--
-- Partner OS introduces no domain tables in Phase 0: the first schema wave belongs
-- to Slice 1 (05_DATA_MODEL_AND_API.md §17). What this migration does establish is
-- the posture every later wave inherits, so "default deny" is a property of the
-- database rather than a convention someone has to remember.
--
-- 05_DATA_MODEL_AND_API.md §12.1: RLS is enabled on every table and the default is
-- deny. Access exists only where a policy grants it.

-- 1. The `app` schema: the namespace for privileged helper functions. It stays
--    closed to API roles; only SECURITY DEFINER functions inside it are granted
--    EXECUTE individually, as `app.is_staff()` will be in Slice 1.
create schema if not exists app;

revoke all on schema app from public;
revoke all on schema app from anon, authenticated;

comment on schema app is
  'Privileged helpers for Partner OS domain authorization. Closed to API roles; '
  'individual SECURITY DEFINER functions are granted EXECUTE one at a time.';

-- 2. Stop the API roles from reaching anything new by accident.
--
--    Supabase grants `anon` and `authenticated` usage on `public` so PostgREST can
--    introspect it. Table privileges are what matter: without them a new table is
--    unreachable even before anyone writes a policy, which means forgetting
--    `enable row level security` fails closed instead of open.
--
--    Default privileges are recorded per (grantor role, schema). Migrations run as
--    `postgres`, so this covers every table a migration creates — which is every
--    table Partner OS has, since schema only ever arrives through migrations.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

alter default privileges in schema app
  revoke all on tables from anon, authenticated;
alter default privileges in schema app
  revoke all on functions from anon, authenticated;

-- 3. Nothing exists yet that could already be exposed, but revoking here keeps the
--    migration correct if it is ever replayed onto a non-empty database.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
