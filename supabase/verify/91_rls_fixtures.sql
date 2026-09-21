-- Security-test fixture — NOT a migration.
--
-- Two partner organizations and one staff member, so tenant isolation is tested
-- against a real second tenant rather than an absence.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'nadia@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'other-partner@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'helio@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'former-member@example.test');

insert into public.profiles (id, auth_user_id, display_name, is_sollelio_staff) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Nádia', false),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Outra Parceira', false),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Hélio', true),
  ('aaaaaaaa-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'Ex-Membro', false);

insert into public.organizations (id, name, slug) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Do Luxo à Mesa', 'do-luxo-a-mesa'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Outra Organização', 'outra-organizacao');

insert into public.organization_memberships (organization_id, profile_id, status) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'active'),
  -- Membership revoked: must lose access without the row being destroyed.
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004', 'inactive');

insert into public.products (id, key, name, type) values
  ('cccccccc-0000-0000-0000-000000000001', 'sollelio-events-v1', 'Sollelio Events', 'application'),
  ('cccccccc-0000-0000-0000-000000000002', 'do-luxo-a-mesa-website', 'Site Do Luxo à Mesa', 'website');

insert into public.organization_products (organization_id, product_id, external_tenant_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'evt-tenant-secret-001');

insert into public.resources (id, organization_id, product_id, name, type, url, status, partner_visible, sort_order) values
  -- Visible to Nádia.
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'Sollelio Events', 'product', 'https://events.sollelio.test/dlm', 'active', true, 1),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002', 'Site Do Luxo à Mesa', 'website', 'https://doluxoamesa.test', 'active', true, 2),
  -- Superseded: kept for internal history, never offered to the partner.
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
   null, 'Events (endereço antigo)', 'product', 'https://old.events.sollelio.test', 'superseded', true, 3),
  -- Internal-only resource in the partner's own organization.
  ('dddddddd-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001',
   null, 'Notas internas de lançamento', 'document', 'https://internal.sollelio.test/notes', 'active', false, 4),
  -- Another tenant's resource.
  ('dddddddd-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000002',
   null, 'Recurso de outra organização', 'website', 'https://outra.test', 'active', true, 1);
