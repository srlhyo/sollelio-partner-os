-- Security-test fixture — NOT a migration, and NOT a seed.
--
-- Loaded only by the plain-PostgreSQL verification harness, on top of
-- 00_supabase_like_roles.sql, which emulates auth.users as a two-column table.
-- Never load this into a real Supabase project: the bare auth.users rows below
-- omit columns GoTrue requires, which leaves real auth unable to create users.
-- For real local Supabase, replay migrations and create users via the Admin API
-- (see the E2E global setup).
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

-- ---------------------------------------------------------------------------
-- Slice 2 fixtures — Requests, fields, submissions, notes and activity
-- ---------------------------------------------------------------------------

-- A fifth person, active today, suspended at the end of this file. Deactivating a
-- membership after assignment is exactly how a partner loses access in life, and the
-- assignee trigger only guards assignment, so this models the real sequence.
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'suspenso@example.test');

insert into public.profiles (id, auth_user_id, display_name, is_sollelio_staff) values
  ('aaaaaaaa-0000-0000-0000-000000000005', '55555555-5555-5555-5555-555555555555', 'Membro Suspenso', false);

insert into public.organization_memberships (organization_id, profile_id, status) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000005', 'active');

insert into public.requests (
  id, organization_id, product_id, type, status, next_actor, title, context,
  requested_action, estimated_effort_minutes, assignee_profile_id, due_at,
  created_by, published_at, completed_at, cancelled_at
) values
  -- Visible to Nádia, awaiting her.
  ('eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'test', 'needs_partner', 'partner',
   'Testar a nova lista de convidados', 'Mudámos a forma de adicionar convidados.',
   'Abra o evento e adicione dois convidados.', 5,
   'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '3 days',
   'aaaaaaaa-0000-0000-0000-000000000003', now() - interval '2 days', null, null),

  -- Draft: never visible to anyone but Sollelio, whatever the assignee says.
  ('eeeeeeee-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
   null, 'task', 'draft', 'none', 'Rascunho por publicar', null,
   'Ainda em preparação.', 2,
   'aaaaaaaa-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000003', null, null, null),

  -- Another organization entirely.
  ('eeeeeeee-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002',
   null, 'question', 'needs_partner', 'partner', 'Pergunta de outra organização', null,
   'Responda quando puder.', 2,
   'aaaaaaaa-0000-0000-0000-000000000002', null,
   'aaaaaaaa-0000-0000-0000-000000000003', now() - interval '1 day', null, null),

  -- Same organization, assigned to somebody else.
  ('eeeeeeee-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001',
   null, 'task', 'needs_partner', 'partner', 'Atribuído a outra pessoa', null,
   'Não é da Nádia.', 2,
   'aaaaaaaa-0000-0000-0000-000000000005', null,
   'aaaaaaaa-0000-0000-0000-000000000003', now() - interval '1 day', null, null),

  -- Terminal and intermediate states, to prove the partner_state translation.
  ('eeeeeeee-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000001',
   null, 'review', 'needs_sollelio', 'sollelio', 'Já respondida', null,
   'Respondida, à espera da Sollelio.', 2,
   'aaaaaaaa-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000003', now() - interval '5 days', null, null),

  ('eeeeeeee-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-000000000001',
   null, 'task', 'completed', 'none', 'Concluída', null,
   'Já está feita.', 2,
   'aaaaaaaa-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000003', now() - interval '9 days', now() - interval '8 days', null),

  ('eeeeeeee-0000-0000-0000-000000000007', 'bbbbbbbb-0000-0000-0000-000000000001',
   null, 'task', 'cancelled', 'none', 'Cancelada', null,
   'Deixou de fazer sentido.', 2,
   'aaaaaaaa-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000003', now() - interval '9 days', null, now() - interval '7 days');

insert into public.request_internal_details (request_id, completion_criteria, internal_owner_profile_id, priority) values
  ('eeeeeeee-0000-0000-0000-000000000001',
   'As três perguntas respondidas.', 'aaaaaaaa-0000-0000-0000-000000000003', 'important');

insert into public.request_internal_notes (request_id, author_profile_id, content) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003',
   'Hipótese interna: o botão de guardar está abaixo do fold.');

insert into public.request_fields (id, request_id, key, label, type, required, options, sort_order) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
   'conseguiu', 'Conseguiu adicionar os dois convidados?', 'boolean', true, null, 1),
  ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001',
   'comparacao', 'Em comparação com antes, foi…', 'single_choice', true,
   '["Mais fácil","Igual","Mais difícil"]'::jsonb, 2),
  -- A field on a Request Nádia may not see.
  ('ffffffff-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000003',
   'resposta', 'Resposta', 'long_text', false, null, 1);

insert into public.request_submissions (id, request_id, submitted_by, source) values
  ('dddddddd-1111-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005',
   'aaaaaaaa-0000-0000-0000-000000000001', 'partner_os'),
  -- Another partner's submission, on their own organization's Request.
  ('dddddddd-1111-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000002', 'partner_os');

insert into public.request_answers (submission_id, request_field_id, value) values
  ('dddddddd-1111-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'true'::jsonb),
  ('dddddddd-1111-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000003', '"outra"'::jsonb);

insert into public.activity_events (organization_id, actor_profile_id, event_type, object_type, object_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003',
   'request.published', 'request', 'eeeeeeee-0000-0000-0000-000000000001');

-- Suspended only now, after assignment: the trigger guards assignment, and losing a
-- membership must remove access to a Request already assigned.
update public.organization_memberships
   set status = 'inactive'
 where profile_id = 'aaaaaaaa-0000-0000-0000-000000000005';

-- An authenticated identity that never completed onboarding: the auth user exists,
-- the profile does not. People are created invite-first, so this window is real.
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'sem-perfil@example.test');
