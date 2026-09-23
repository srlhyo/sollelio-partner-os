-- Release-blocking security assertions — NOT a migration.
--
-- Covers the Slice 1 rows of 06_BUILD_PLAN.md's release-blocking list: tenant
-- isolation, no partner access to integration data, no self-escalation, and
-- archive-not-delete. Each block impersonates a real caller the way PostgREST does:
-- `set role authenticated` plus the request's JWT claims.

create or replace function pg_temp.count_as(claims text, query text)
returns bigint
language plpgsql
as $$
declare
  total bigint;
begin
  perform set_config('request.jwt.claims', claims, true);
  execute format('set local role authenticated');
  execute format('select count(*) from (%s) probe', query) into total;
  reset role;
  return total;
end;
$$;

do $$
declare
  nadia text := '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  other text := '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  helio text := '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
  former text := '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
  n bigint;
begin
  -- Partner A cannot access Organization B ---------------------------------
  n := pg_temp.count_as(nadia, 'select id from public.organizations');
  if n <> 1 then raise exception 'Nádia should see exactly her own organization, saw %', n; end if;

  n := pg_temp.count_as(nadia,
    'select id from public.organizations where slug = ''outra-organizacao''');
  if n <> 0 then raise exception 'Tenant isolation broken: Nádia can see another organization.'; end if;

  n := pg_temp.count_as(other, 'select id from public.resources');
  if n <> 1 then raise exception 'The other partner should see only their own resource, saw %', n; end if;

  -- Resources: active + partner_visible + active membership only -----------
  n := pg_temp.count_as(nadia, 'select id from public.resources');
  if n <> 2 then
    raise exception 'Nádia should see exactly 2 canonical resources, saw %', n;
  end if;

  n := pg_temp.count_as(nadia, 'select id from public.resources where status = ''superseded''');
  if n <> 0 then raise exception 'A superseded resource reached the partner.'; end if;

  n := pg_temp.count_as(nadia, 'select id from public.resources where not partner_visible');
  if n <> 0 then raise exception 'An internal-only resource reached the partner.'; end if;

  -- An inactive membership grants nothing ----------------------------------
  n := pg_temp.count_as(former, 'select id from public.resources');
  if n <> 0 then raise exception 'A deactivated member still sees resources.'; end if;

  n := pg_temp.count_as(former, 'select id from public.organizations');
  if n <> 0 then raise exception 'A deactivated member still sees the organization.'; end if;

  -- Integration data is never partner-facing -------------------------------
  n := pg_temp.count_as(nadia, 'select id from public.products');
  if n <> 0 then raise exception 'Partner can read products.'; end if;

  n := pg_temp.count_as(nadia, 'select id from public.organization_products');
  if n <> 0 then raise exception 'Partner can read organization_products (external_tenant_id).'; end if;

  -- Profiles: own row only --------------------------------------------------
  n := pg_temp.count_as(nadia, 'select id from public.profiles');
  if n <> 1 then raise exception 'Nádia should see only her own profile, saw %', n; end if;

  n := pg_temp.count_as(nadia,
    'select id from public.organization_memberships');
  if n <> 1 then raise exception 'Nádia should see only her own membership, saw %', n; end if;

  -- Staff identity is global, without membership rows ----------------------
  n := pg_temp.count_as(helio, 'select id from public.organizations');
  if n <> 2 then raise exception 'Staff should see every organization, saw %', n; end if;

  n := pg_temp.count_as(helio, 'select id from public.resources');
  if n <> 5 then raise exception 'Staff should see every resource, saw %', n; end if;

  n := pg_temp.count_as(helio, 'select id from public.organization_products');
  if n <> 1 then raise exception 'Staff should see organization_products, saw %', n; end if;

  -- Compared against the real total rather than a fixed number: the property is
  -- "staff see every membership", and a magic count breaks whenever a later slice
  -- adds a fixture without weakening anything.
  n := pg_temp.count_as(helio, 'select id from public.organization_memberships');
  if n <> (select count(*) from public.organization_memberships) then
    raise exception 'Staff should see every membership, saw % of %',
      n, (select count(*) from public.organization_memberships);
  end if;

  -- Staff hold no membership rows of their own.
  if exists (
    select 1 from public.organization_memberships
     where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003') then
    raise exception 'Staff must not be modelled as members of partner organizations.';
  end if;

  -- Anonymous callers see nothing ------------------------------------------
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  begin
    perform 1 from public.resources;
    reset role;
    raise exception 'anon can query resources.';
  exception
    when insufficient_privilege then reset role;
  end;
end
$$;

-- Self-escalation is impossible, by grant and by trigger -------------------
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  begin
    update public.profiles set is_sollelio_staff = true
     where auth_user_id = '11111111-1111-1111-1111-111111111111';
    reset role;
    raise exception 'A partner escalated themselves to Sollelio staff.';
  exception
    when insufficient_privilege then reset role;
  end;
end
$$;

-- The column-limited grant still allows the one write a partner may make.
do $$
declare
  renamed text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  update public.profiles set display_name = 'Nádia M.'
   where auth_user_id = '11111111-1111-1111-1111-111111111111';
  reset role;

  select display_name into renamed from public.profiles
   where auth_user_id = '11111111-1111-1111-1111-111111111111';
  if renamed <> 'Nádia M.' then
    raise exception 'A partner cannot rename themselves; display_name stayed %', renamed;
  end if;
end
$$;

-- Partners cannot write canonical resources; staff can ---------------------
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  begin
    insert into public.resources (organization_id, name, type, url)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'Falso', 'other', 'https://mau.test');
    reset role;
    raise exception 'A partner created a canonical resource.';
  exception
    when insufficient_privilege then reset role;
  end;
end
$$;

do $$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  insert into public.resources (organization_id, name, type, url, sort_order)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Ficheiros partilhados', 'folder',
          'https://drive.example.test/dlm', 3);
  reset role;

  select count(*) into n from public.resources
   where organization_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if n <> 5 then raise exception 'Staff insert did not land, count %', n; end if;
end
$$;

select 'slice 1 authorization verified' as result;
