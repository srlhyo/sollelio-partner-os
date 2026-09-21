-- Slice 1 — Organizations, Products, Resources (migration wave 1).
--
-- 05_DATA_MODEL_AND_API.md §17, wave 1: profiles, organizations,
-- organization_memberships, products, organization_products, resources, and the
-- app.is_staff() helper, with RLS enabled and default deny throughout.
--
-- Nothing belonging to a later wave appears here. There is no requests, updates or
-- issues schema, and no partner projection view: those arrive with their slices.

-- ---------------------------------------------------------------------------
-- 1. Enumerated domain vocabulary
-- ---------------------------------------------------------------------------
create type public.organization_status as enum ('active', 'inactive', 'archived');
create type public.membership_role as enum ('partner_member');
create type public.membership_status as enum ('active', 'inactive');
create type public.product_type as enum ('application', 'website', 'service', 'other');
create type public.product_status as enum ('active', 'inactive', 'archived');
create type public.organization_product_status as enum ('active', 'inactive');
create type public.resource_type as enum ('product', 'website', 'folder', 'document', 'prototype', 'other');
create type public.resource_status as enum ('active', 'superseded', 'archived');

-- ---------------------------------------------------------------------------
-- 2. Shared trigger helper
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

-- profiles ------------------------------------------------------------------
-- A profile cannot exist before its auth user: people are created invite-first,
-- the auth user through the admin API and then the profile bound to the returned
-- id (04_TECHNICAL_ARCHITECTURE.md §20). The foreign key makes that structural
-- rather than a convention.
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) > 0),
  is_sollelio_staff boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.is_sollelio_staff is
  'Global Sollelio staff identity. Never client-writable: set only by privileged '
  'administration. Staff are not modelled as members of partner organizations.';

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- organizations -------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.organization_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint organizations_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null))
);

create trigger organizations_touch_updated_at
  before update on public.organizations
  for each row execute function app.touch_updated_at();

-- organization_memberships --------------------------------------------------
-- The model permits several organizations per person and keeps that structure from
-- day one. V0 operationally assumes exactly one active membership; where a person
-- has more, the partner application asks rather than guessing
-- (05_DATA_MODEL_AND_API.md §1).
create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  role public.membership_role not null default 'partner_member',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create index organization_memberships_profile_active_idx
  on public.organization_memberships (profile_id)
  where status = 'active';

-- products ------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  type public.product_type not null,
  status public.product_status not null default 'active',
  created_at timestamptz not null default now()
);

-- organization_products -----------------------------------------------------
-- No canonical_url column. Partner-facing canonical URLs live only in `resources`
-- (05_DATA_MODEL_AND_API.md §2): a link that exists in two places will eventually
-- disagree with itself, which is the exact problem Partner OS exists to solve.
create table public.organization_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  status public.organization_product_status not null default 'active',
  external_tenant_id text,
  created_at timestamptz not null default now(),
  unique (organization_id, product_id)
);

comment on column public.organization_products.external_tenant_id is
  'How the integrated product identifies this organization. Integration data, never '
  'partner-facing; used for external identity resolution from Slice 5.';

-- resources -----------------------------------------------------------------
-- The single source of truth for partner-facing canonical URLs
-- (05_DATA_MODEL_AND_API.md §3).
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  product_id uuid references public.products (id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  type public.resource_type not null,
  url text not null check (url ~ '^https?://'),
  status public.resource_status not null default 'active',
  partner_visible boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint resources_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null))
);

create index resources_partner_lookup_idx
  on public.resources (organization_id, sort_order)
  where status = 'active' and partner_visible;

create trigger resources_touch_updated_at
  before update on public.resources
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Authorization helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER with a pinned search_path. Definer rights are what let these
-- read `profiles` without re-entering its own policy, which is why policies call
-- these instead of subquerying profiles directly
-- (04_TECHNICAL_ARCHITECTURE.md §7, 05_DATA_MODEL_AND_API.md §12.1).

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_sollelio_staff
       from public.profiles p
      where p.auth_user_id = (select auth.uid())),
    false);
$$;

comment on function app.is_staff() is
  'The single staff-resolution mechanism. Sollelio staff identity is global: staff '
  'are never modelled as members of partner organizations.';

create or replace function app.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.auth_user_id = (select auth.uid());
$$;

create or replace function app.has_active_membership(organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organization_memberships m
      join public.profiles p on p.id = m.profile_id
     where m.organization_id = organization
       and m.status = 'active'
       and p.auth_user_id = (select auth.uid()));
$$;

-- Closing a gap the Phase 0 posture test found once real functions existed.
--
-- PostgreSQL grants EXECUTE on every new function to PUBLIC, and PUBLIC is not a
-- role, so Phase 0's role-scoped `alter default privileges ... revoke ... from anon,
-- authenticated` never touched it: a helper added to `app` would be callable by any
-- authenticated request.
--
-- ALTER DEFAULT PRIVILEGES cannot fix this. Revoking EXECUTE from PUBLIC there
-- records nothing when no default ACL entry exists, and even after one is created
-- the new function still carries the built-in default. Verified empirically on
-- PostgreSQL 15.
--
-- So every function this project creates revokes EXECUTE from PUBLIC explicitly, and
-- `90_assert_posture.sql` fails the build if any function in `app` is ever left
-- without that revoke. The guarantee is a checked invariant rather than a default.
revoke execute on function app.is_staff() from public;
revoke execute on function app.current_profile_id() from public;
revoke execute on function app.has_active_membership(uuid) from public;
revoke execute on function app.touch_updated_at() from public;

-- `authenticated` needs USAGE on the schema to resolve the helpers its policies
-- call. `anon` still has none, and each helper is granted EXECUTE one at a time, so
-- schema access alone reaches nothing.
grant usage on schema app to authenticated;
grant execute on function app.is_staff() to authenticated;
grant execute on function app.current_profile_id() to authenticated;
grant execute on function app.has_active_membership(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-escalation guard
-- ---------------------------------------------------------------------------
-- The column-limited UPDATE grant below already stops a partner from writing
-- is_sollelio_staff. This trigger is the structural backstop: if a later migration
-- ever widens that grant by accident, escalation through the API still fails.
create or replace function app.reject_staff_flag_change_from_api()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_sollelio_staff is distinct from old.is_sollelio_staff
     and current_user in ('anon', 'authenticated') then
    raise exception 'is_sollelio_staff cannot be changed through the API.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function app.reject_staff_flag_change_from_api() from public;

create trigger profiles_reject_staff_flag_change_from_api
  before update on public.profiles
  for each row execute function app.reject_staff_flag_change_from_api();

-- ---------------------------------------------------------------------------
-- 6. Row level security — enabled everywhere, default deny
-- ---------------------------------------------------------------------------
-- Phase 0 revoked default table privileges from the API roles, so each grant below
-- is deliberate. Staff and partners both arrive as `authenticated`; the policies,
-- not the role, tell them apart.

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.products enable row level security;
alter table public.organization_products enable row level security;
alter table public.resources enable row level security;

-- profiles: own row, plus staff. UPDATE is column-limited to display_name, so no
-- table-wide UPDATE grant exists (05_DATA_MODEL_AND_API.md §12.2).
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy profiles_select_staff on public.profiles
  for select to authenticated
  using (app.is_staff());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- organizations: an active membership, or staff.
grant select on public.organizations to authenticated;

create policy organizations_select_member on public.organizations
  for select to authenticated
  using (app.has_active_membership(id));

create policy organizations_select_staff on public.organizations
  for select to authenticated
  using (app.is_staff());

-- organization_memberships: own rows only, plus staff.
grant select on public.organization_memberships to authenticated;

create policy organization_memberships_select_own on public.organization_memberships
  for select to authenticated
  using (profile_id = app.current_profile_id());

create policy organization_memberships_select_staff on public.organization_memberships
  for select to authenticated
  using (app.is_staff());

-- products and organization_products: no partner access at all. Staff only.
-- organization_products additionally carries external_tenant_id, which is
-- integration data and never partner-facing.
grant select on public.products to authenticated;
grant select on public.organization_products to authenticated;

create policy products_select_staff on public.products
  for select to authenticated
  using (app.is_staff());

create policy organization_products_select_staff on public.organization_products
  for select to authenticated
  using (app.is_staff());

-- resources: partners see active, partner-visible resources of an organization they
-- actively belong to. Staff see and manage everything.
grant select on public.resources to authenticated;
grant insert, update on public.resources to authenticated;

create policy resources_select_partner on public.resources
  for select to authenticated
  using (
    status = 'active'
    and partner_visible
    and app.has_active_membership(organization_id)
  );

create policy resources_select_staff on public.resources
  for select to authenticated
  using (app.is_staff());

create policy resources_insert_staff on public.resources
  for insert to authenticated
  with check (app.is_staff());

create policy resources_update_staff on public.resources
  for update to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- No DELETE grant and no DELETE policy anywhere in this wave: operational history is
-- preserved by archiving, never by silent destruction
-- (04_TECHNICAL_ARCHITECTURE.md §18).
