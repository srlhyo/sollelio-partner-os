-- Slice 2, Checkpoint C1 — Requests persistence and authorization boundary.
--
-- 05_DATA_MODEL_AND_API.md §17, wave 2: requests, request_internal_details,
-- request_fields, request_submissions, request_answers, request_internal_notes,
-- activity_events, and the `partner_requests` projection.
--
-- This checkpoint is schema and authorization only. No lifecycle command exists yet
-- (§13), so nothing here grants an API role the ability to move a Request through
-- its lifecycle. Those grants arrive with the commands that own them.
--
-- Additive throughout: no Slice 1 table, policy or grant is altered.

-- ---------------------------------------------------------------------------
-- 1. Enumerated domain vocabulary
-- ---------------------------------------------------------------------------
create type public.request_type as enum ('review', 'approval', 'question', 'test', 'task');

-- Five states, deliberately. `in_progress` and `blocked` are not V0 states: every
-- additional state invites an ambiguous next actor (02_OPERATING_MODEL.md §3).
create type public.request_status as enum (
  'draft', 'needs_partner', 'needs_sollelio', 'completed', 'cancelled');

create type public.request_next_actor as enum ('partner', 'sollelio', 'none');

-- Only what the partner surfaces actually render (03_UX_SPEC.md §5–§7). Partner OS
-- is not a form builder; adding a type is a product decision.
create type public.request_field_type as enum (
  'long_text', 'single_choice', 'boolean', 'approval');

create type public.request_submission_source as enum (
  'partner_os', 'whatsapp_capture', 'internal_capture', 'integration');

create type public.request_priority as enum ('normal', 'important', 'urgent');

-- What the partner is allowed to know about a Request's state: lifecycle vocabulary
-- translated at the boundary, never exposed raw (05_DATA_MODEL_AND_API.md §12.3).
create type public.partner_request_state as enum (
  'needs_you', 'with_sollelio', 'done', 'cancelled');

create type public.activity_object_type as enum (
  'request', 'update', 'issue', 'resource', 'organization');

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- requests -----------------------------------------------------------------
-- Internal base table. Partners never select from it: RLS is row-level, not
-- column-level, so a SELECT grant here would expose internal columns whatever the
-- policy predicate said (§12.3). Partner reads go through `partner_requests`.
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  product_id uuid references public.products (id) on delete restrict,
  type public.request_type not null,
  status public.request_status not null default 'draft',
  next_actor public.request_next_actor not null default 'none',
  title text not null check (length(btrim(title)) > 0),
  context text,
  requested_action text not null check (length(btrim(requested_action)) > 0),
  estimated_effort_minutes integer not null check (estimated_effort_minutes >= 1),
  assignee_profile_id uuid not null references public.profiles (id) on delete restrict,
  due_at timestamptz,
  -- Plain columns, not foreign keys: `updates` and `issues` arrive in later waves.
  related_update_id uuid,
  related_issue_id uuid,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),

  -- The status/next-actor invariants from §4, enforced in the database rather than
  -- trusted to the command layer alone. A Request that is actionable always has one
  -- unambiguous responsible actor; draft, completed and cancelled have none.
  constraint requests_status_invariants check (
    case status
      when 'draft'          then next_actor = 'none'     and published_at is null
      when 'needs_partner'  then next_actor = 'partner'  and published_at is not null
      when 'needs_sollelio' then next_actor = 'sollelio' and published_at is not null
      when 'completed'      then next_actor = 'none'     and completed_at is not null
      when 'cancelled'      then next_actor = 'none'     and cancelled_at is not null
    end
  )
);

comment on column public.requests.estimated_effort_minutes is
  'Honest human-scale estimate. The `<1 min` scale is stored as 1 and rendered as '
  '"<1 min", never "1 min" (02_OPERATING_MODEL.md §2). Zero is not valid.';

comment on column public.requests.due_at is
  'Only for a real dependency, launch, meeting or expiry. A deadline that exists is '
  'always shown to the partner; most Requests have none.';

create trigger requests_touch_updated_at
  before update on public.requests
  for each row execute function app.touch_updated_at();

-- The partner's own list: published Requests assigned to them, in the order Home
-- and the projection read them.
create index requests_partner_lookup_idx
  on public.requests (assignee_profile_id, published_at desc)
  where published_at is not null;

-- The internal queues: what is waiting on whom, per organization.
create index requests_organization_status_idx
  on public.requests (organization_id, status);

-- request_internal_details -------------------------------------------------
-- Internal-only 1:1 extension. Completion criteria, internal ownership and priority
-- are operational judgements, kept structurally outside the partner-readable shape
-- rather than filtered out by a serializer (§4).
create table public.request_internal_details (
  request_id uuid primary key references public.requests (id) on delete cascade,
  completion_criteria text not null check (length(btrim(completion_criteria)) > 0),
  internal_owner_profile_id uuid references public.profiles (id) on delete restrict,
  priority public.request_priority not null default 'normal',
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create trigger request_internal_details_touch_updated_at
  before update on public.request_internal_details
  for each row execute function app.touch_updated_at();

-- request_fields -----------------------------------------------------------
create table public.request_fields (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  help_text text,
  type public.request_field_type not null,
  required boolean not null default false,
  options jsonb,
  sort_order integer not null default 0,
  -- Approval Requests receive their approval field from `create_request`, never from
  -- an author building one by hand (§4, 03_UX_SPEC.md §16). This marks those.
  system_generated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (request_id, key)
);

create index request_fields_order_idx on public.request_fields (request_id, sort_order);

-- request_submissions ------------------------------------------------------
-- Append-only, ordered by created_at. A Request returned to the partner produces a
-- new submission; earlier submissions are never modified (§4).
create table public.request_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  source public.request_submission_source not null default 'partner_os',
  created_at timestamptz not null default now()
);

create index request_submissions_request_idx
  on public.request_submissions (request_id, created_at);

-- request_answers ----------------------------------------------------------
create table public.request_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.request_submissions (id) on delete cascade,
  request_field_id uuid not null references public.request_fields (id) on delete restrict,
  value jsonb not null,
  created_at timestamptz not null default now(),
  unique (submission_id, request_field_id)
);

create index request_answers_submission_idx on public.request_answers (submission_id);

-- request_internal_notes ---------------------------------------------------
create table public.request_internal_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  author_profile_id uuid not null references public.profiles (id) on delete restrict,
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index request_internal_notes_request_idx
  on public.request_internal_notes (request_id, created_at);

create trigger request_internal_notes_touch_updated_at
  before update on public.request_internal_notes
  for each row execute function app.touch_updated_at();

-- activity_events ----------------------------------------------------------
-- History and audit support: not event sourcing, not the primary state store (§8).
-- Append-only. Every row is written server-side by a domain command; no API role
-- holds an INSERT grant, in this checkpoint or later.
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_profile_id uuid references public.profiles (id) on delete restrict,
  event_type text not null check (length(btrim(event_type)) > 0),
  object_type public.activity_object_type not null,
  object_id uuid not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on column public.activity_events.event_type is
  'One of the documented V0 event types (05_DATA_MODEL_AND_API.md §8). Left as text '
  'rather than an enum so the list can grow with its slice; the documented list is '
  'authoritative. `request.viewed` and `update.viewed` are deliberately not V0 types.';

create index activity_events_organization_idx
  on public.activity_events (organization_id, created_at desc);

create index activity_events_object_idx
  on public.activity_events (object_type, object_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. The assignee invariant
-- ---------------------------------------------------------------------------
-- "`assignee_profile_id` must be a profile with an **active** membership in
-- `organization_id`" (§4). A CHECK constraint cannot consult another table, so the
-- database-level form of this invariant is a trigger. It states only the invariant:
-- what happens when a membership is later deactivated belongs to
-- `deactivate_membership` (§1), a later checkpoint.
create or replace function app.assert_request_assignee_is_active_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.organization_memberships m
     where m.profile_id = new.assignee_profile_id
       and m.organization_id = new.organization_id
       and m.status = 'active')
  then
    raise exception
      'Request assignee must hold an active membership in the request organization.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function app.assert_request_assignee_is_active_member() from public;

create trigger requests_assert_assignee_is_active_member
  before insert or update of assignee_profile_id, organization_id on public.requests
  for each row execute function app.assert_request_assignee_is_active_member();

-- ---------------------------------------------------------------------------
-- 4. The partner projection
-- ---------------------------------------------------------------------------
-- `partner_requests` is a security boundary, not a convenience query. It is a
-- security-barrier view owned by a privileged role with `security_invoker` left off,
-- so the view's own predicate governs access and the caller needs no grant on the
-- base table (§12.3).
--
-- The column list is the contract. It is written out in full — never `select *` —
-- so widening it is a visible, reviewable act. `90`/`93` assert it.
create view public.partner_requests
with (security_barrier = true)
as
select
  r.id,
  r.organization_id,
  r.product_id,
  p.name                                as product_name,
  r.type,
  r.title,
  r.context,
  r.requested_action,
  r.estimated_effort_minutes,
  r.due_at,
  (case r.status
     when 'needs_partner'  then 'needs_you'
     when 'needs_sollelio' then 'with_sollelio'
     when 'completed'      then 'done'
     when 'cancelled'      then 'cancelled'
   end)::public.partner_request_state    as partner_state,
  r.published_at,
  r.completed_at,
  r.cancelled_at,
  r.related_update_id
from public.requests r
left join public.products p on p.id = r.product_id
where r.published_at is not null
  and r.assignee_profile_id = app.current_profile_id()
  and app.has_active_membership(r.organization_id);

comment on view public.partner_requests is
  'The only Request shape a partner may read. Excludes status, next_actor, '
  'assignee_profile_id, created_by and everything in request_internal_details. '
  'A draft is never visible: the predicate requires published_at.';

-- ---------------------------------------------------------------------------
-- 5. Row level security — enabled everywhere, default deny
-- ---------------------------------------------------------------------------
alter table public.requests enable row level security;
alter table public.request_internal_details enable row level security;
alter table public.request_fields enable row level security;
alter table public.request_submissions enable row level security;
alter table public.request_answers enable row level security;
alter table public.request_internal_notes enable row level security;
alter table public.activity_events enable row level security;

-- requests: no partner grant of any kind. Partners read `partner_requests`.
grant select on public.requests to authenticated;
create policy requests_select_staff on public.requests
  for select to authenticated
  using (app.is_staff());

grant select on public.partner_requests to authenticated;

-- request_internal_details and request_internal_notes: internal, entirely.
grant select on public.request_internal_details to authenticated;
create policy request_internal_details_select_staff on public.request_internal_details
  for select to authenticated
  using (app.is_staff());

grant select, insert, update on public.request_internal_notes to authenticated;

create policy request_internal_notes_select_staff on public.request_internal_notes
  for select to authenticated
  using (app.is_staff());

-- Notes carry no lifecycle meaning — they are internal writing, the one Request
-- table an operator edits directly rather than through a command (03_UX_SPEC.md §15).
create policy request_internal_notes_insert_staff on public.request_internal_notes
  for insert to authenticated
  with check (app.is_staff());

create policy request_internal_notes_update_staff on public.request_internal_notes
  for update to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- request_fields: readable when the parent Request is visible through the
-- projection, which carries the published/assignee/membership predicate itself.
grant select on public.request_fields to authenticated;

create policy request_fields_select_partner on public.request_fields
  for select to authenticated
  using (exists (select 1 from public.partner_requests pr where pr.id = request_id));

create policy request_fields_select_staff on public.request_fields
  for select to authenticated
  using (app.is_staff());

-- request_submissions: a partner reads their own, on a Request they can see.
grant select on public.request_submissions to authenticated;

create policy request_submissions_select_own on public.request_submissions
  for select to authenticated
  using (
    submitted_by = app.current_profile_id()
    and exists (select 1 from public.partner_requests pr where pr.id = request_id)
  );

create policy request_submissions_select_staff on public.request_submissions
  for select to authenticated
  using (app.is_staff());

-- request_answers: readable when the parent submission is.
grant select on public.request_answers to authenticated;

create policy request_answers_select_own on public.request_answers
  for select to authenticated
  using (exists (
    select 1 from public.request_submissions s
     where s.id = submission_id
       and s.submitted_by = app.current_profile_id()));

create policy request_answers_select_staff on public.request_answers
  for select to authenticated
  using (app.is_staff());

-- activity_events: nobody writes it through the API, in this checkpoint or later.
-- Every row comes from a domain command running server-side (§8).
grant select on public.activity_events to authenticated;

create policy activity_events_select_staff on public.activity_events
  for select to authenticated
  using (app.is_staff());

-- No INSERT, UPDATE or DELETE grant exists on any table in this wave except the
-- internal notes above. Lifecycle mutation belongs to the commands of C3/C4
-- (04_TECHNICAL_ARCHITECTURE.md §8), and history is archived, never destroyed (§18).
