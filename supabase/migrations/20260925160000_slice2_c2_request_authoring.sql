-- Slice 2, Checkpoint C2 — Request authoring: draft, preview, publish.
--
-- 05_DATA_MODEL_AND_API.md §4, §12.3, §13; 06_BUILD_PLAN.md Slice 2 (checkpoints).
--
-- Additive to C1 (20260923120000), which stays byte-for-byte as committed:
--
--   1. `requests.revision` — an explicit aggregate version. Every change to the
--      Request row, its fields or its internal details increments it, by trigger,
--      so no writer can forget to and no two versions can share a number.
--   2. `requests.resource_id` — an explicit link to one canonical Resource. The URL
--      itself still lives only in `resources` (02_OPERATING_MODEL.md §11).
--   3. `app.partner_request_projection` — the single definition of the
--      partner-facing Request shape. `public.partner_requests` is now that
--      projection filtered by the unchanged predicate, and the staff preview reads
--      the same projection. There is no second mapping anywhere.
--   4. `request_command_receipts` — the minimum persistent support for replaying a
--      create or publish safely. Not a generic command log.
--   5. The four C2 commands as transactional SQL functions, executable only by
--      `service_role`, called from the `request-commands` Edge Function after it has
--      verified the caller (04_TECHNICAL_ARCHITECTURE.md §2).
--
-- Nothing here grants anon or authenticated any new write, and nothing here
-- changes a Slice 1 table, policy or grant.

-- ---------------------------------------------------------------------------
-- 0. Privileges the commands rely on, declared rather than inherited
-- ---------------------------------------------------------------------------
-- The commands run as `service_role` (SECURITY INVOKER). Supabase grants that role
-- these privileges by default already; stating them makes the dependency visible
-- and reviewable instead of implicit. None of these reaches anon or authenticated.
grant usage on schema app to service_role;

grant select on public.profiles, public.organizations, public.organization_memberships,
                public.products, public.organization_products, public.resources
  to service_role;

grant select, insert, update on public.requests to service_role;
grant select, insert, update on public.request_internal_details to service_role;
-- DELETE only because a draft's author-defined fields are replaced on each save.
-- A draft has no submissions, so no answer can reference a replaced field.
grant select, insert, update, delete on public.request_fields to service_role;
grant select, insert on public.activity_events to service_role;

-- ---------------------------------------------------------------------------
-- 1. Aggregate revision
-- ---------------------------------------------------------------------------
alter table public.requests
  add column revision integer not null default 1 check (revision >= 1);

comment on column public.requests.revision is
  'Aggregate version of the Request: the row, its request_fields and its '
  'request_internal_details. Incremented by trigger on every change to any of them, '
  'never set by a caller. Edits and publication must name the revision they expect.';

create or replace function app.bump_request_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Whatever a caller wrote into `revision` is ignored: the version only moves
  -- forward by one, so an edit can never collide with another edit's number.
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke execute on function app.bump_request_revision() from public, anon, authenticated;

create trigger requests_bump_revision
  before update on public.requests
  for each row execute function app.bump_request_revision();

-- A change to a field or to the internal details is a change to the Request. The
-- parent row is touched so the trigger above moves its revision.
create or replace function app.touch_parent_request()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    target := old.request_id;
  else
    target := new.request_id;
  end if;

  update public.requests set revision = revision where id = target;

  if tg_op = 'UPDATE' and old.request_id is distinct from new.request_id then
    update public.requests set revision = revision where id = old.request_id;
  end if;

  return null;
end;
$$;

revoke execute on function app.touch_parent_request() from public, anon, authenticated;

create trigger request_fields_touch_parent_request
  after insert or update or delete on public.request_fields
  for each row execute function app.touch_parent_request();

create trigger request_internal_details_touch_parent_request
  after insert or update or delete on public.request_internal_details
  for each row execute function app.touch_parent_request();

-- ---------------------------------------------------------------------------
-- 2. Explicit link to one canonical Resource
-- ---------------------------------------------------------------------------
alter table public.requests
  add column resource_id uuid references public.resources (id) on delete restrict;

comment on column public.requests.resource_id is
  'Optional canonical Resource the partner needs to act. The URL is read from '
  '`resources` at render time; a Resource that stops being active or partner-visible '
  'simply stops being shown.';

create index requests_resource_idx on public.requests (resource_id)
  where resource_id is not null;

-- Structural invariants of the link, whoever writes the row: the Resource belongs to
-- the Request's organization, and when both carry a product they agree. Whether the
-- Resource is currently active and visible is a publication rule, checked by
-- `cmd_publish_request`, because a draft may point at a link being prepared.
create or replace function app.assert_request_resource_coherent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  resource_org uuid;
  resource_product uuid;
begin
  if new.resource_id is null then
    return new;
  end if;

  select r.organization_id, r.product_id
    into resource_org, resource_product
    from public.resources r
   where r.id = new.resource_id;

  if resource_org is distinct from new.organization_id then
    raise exception 'Request resource must belong to the request organization.'
      using errcode = 'check_violation';
  end if;

  if new.product_id is not null and resource_product is not null
     and resource_product <> new.product_id then
    raise exception 'Request resource and request product disagree.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function app.assert_request_resource_coherent() from public, anon, authenticated;

create trigger requests_assert_resource_coherent
  before insert or update of resource_id, organization_id, product_id on public.requests
  for each row execute function app.assert_request_resource_coherent();

-- ---------------------------------------------------------------------------
-- 3. One partner-facing projection
-- ---------------------------------------------------------------------------
-- The partner-facing shape is defined here, once. It carries the columns the
-- authorization predicate needs (`assignee_profile_id`) and nothing else internal.
-- It lives in `app`, which PostgREST does not expose, and neither anon nor
-- authenticated may read it.
create view app.partner_request_projection
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
  r.related_update_id,
  r.resource_id,
  -- Predicate support only. Never part of the public view's column list.
  r.assignee_profile_id
from public.requests r
left join public.products p on p.id = r.product_id;

comment on view app.partner_request_projection is
  'The single partner-facing Request shape (05_DATA_MODEL_AND_API.md §12.3). '
  'Read by public.partner_requests (with the partner predicate) and by '
  'cmd_preview_request (staff only). assignee_profile_id is predicate support.';

revoke all on app.partner_request_projection from public, anon, authenticated, service_role;
grant select on app.partner_request_projection to service_role;

-- The public view keeps its owner, security_barrier, grant and predicate. Its first
-- fifteen columns are unchanged in name, type and order; `resource_id` is appended
-- as the sixteenth. The column list is written out, never `*`.
create or replace view public.partner_requests
with (security_barrier = true)
as
select
  pr.id,
  pr.organization_id,
  pr.product_id,
  pr.product_name,
  pr.type,
  pr.title,
  pr.context,
  pr.requested_action,
  pr.estimated_effort_minutes,
  pr.due_at,
  pr.partner_state,
  pr.published_at,
  pr.completed_at,
  pr.cancelled_at,
  pr.related_update_id,
  pr.resource_id
from app.partner_request_projection pr
where pr.published_at is not null
  and pr.assignee_profile_id = app.current_profile_id()
  and app.has_active_membership(pr.organization_id);

comment on view public.partner_requests is
  'The only Request shape a partner may read: app.partner_request_projection filtered '
  'to published Requests assigned to the caller while their membership is active. '
  'Excludes status, next_actor, assignee_profile_id, created_by, revision and '
  'everything in request_internal_details.';

revoke all on public.partner_requests from public, anon;
grant select on public.partner_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Command receipts — safe replay of create and publish
-- ---------------------------------------------------------------------------
-- One row per accepted create or publish, keyed by the caller-supplied idempotency
-- key (for create, the client-generated Request id). The hash is of the ORIGINAL
-- payload, so a replay is recognised even after the draft has since been edited, and
-- a different payload under the same key is a conflict, never a silent success.
create type public.request_command_name as enum ('create_request', 'publish_request');

create table public.request_command_receipts (
  command public.request_command_name not null,
  idempotency_key uuid not null,
  actor_profile_id uuid not null references public.profiles (id) on delete restrict,
  request_id uuid not null
    references public.requests (id) on delete cascade deferrable initially deferred,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{32}$'),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (command, idempotency_key)
);

comment on table public.request_command_receipts is
  'Replay support for create_request and publish_request only (05 §13). Written and '
  'read exclusively by the command functions. No API role may read or write it.';

alter table public.request_command_receipts enable row level security;
revoke all on public.request_command_receipts from public, anon, authenticated, service_role;
grant select, insert, update on public.request_command_receipts to service_role;

-- ---------------------------------------------------------------------------
-- 5. Command helpers (internal; service_role only)
-- ---------------------------------------------------------------------------
-- Errors carry a five-character SQLSTATE in class RQ, a stable machine name as the
-- message, and a JSON detail. The Edge Function maps them to HTTP; the client maps
-- them to pt-PT copy.
--   RQ001 not_staff            RQ007 resource_not_available
--   RQ002 not_found            RQ008 stale_revision
--   RQ003 validation_failed    RQ009 invalid_state
--   RQ004 organization_not_active   RQ010 idempotency_conflict
--   RQ005 assignee_not_active_member RQ011 publish_requirements
--   RQ006 product_not_linked
create or replace function app.request_fail(p_code text, p_name text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = p_code, message = p_name, detail = coalesce(p_detail, '{}'::jsonb)::text;
end;
$$;

-- The actor is resolved from a verified session by the Edge Function. It is checked
-- again here: an actor that is not an existing staff profile never gets further.
create or replace function app.request_require_staff(p_actor uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.profiles where id = p_actor and is_sollelio_staff)
  then
    perform app.request_fail('RQ001', 'not_staff');
  end if;
end;
$$;

create or replace function app.request_err(p_field text, p_code text, p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('field', p_field, 'code', p_code, 'message', p_message);
$$;

-- Technical limits (new, C2): they protect the endpoint and are mirrored exactly by
-- the client. Text is never truncated: over-long input is rejected with a field error.
--   title 200 · context / requested_action / completion_criteria 4000
--   fields per request 20 · field label 300 · help_text 1000
--   options per single_choice 20 · option 200
-- Whitespace at either end is trimmed; an optional text that is empty after
-- trimming is stored as NULL.
create or replace function app.request_normalize(p_payload jsonb, p_mode text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  errs jsonb := '[]'::jsonb;
  v jsonb := '{}'::jsonb;
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  allowed constant text[] := array['organization_id', 'assignee_profile_id', 'type', 'title', 'context',
    'requested_action', 'estimated_effort_minutes', 'due_at', 'product_id', 'resource_id', 'internal', 'fields'];
  k text;
  j jsonb;
  s text;
  n numeric;
  internal jsonb;
  fields jsonb;
  f jsonb;
  fo jsonb;
  opt jsonb;
  opts jsonb;
  idx integer;
  oidx integer;
  fields_out jsonb := '[]'::jsonb;
  req_type text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('errors', jsonb_build_array(
      app.request_err('payload', 'invalid', 'O pedido tem de ser um objecto JSON.')), 'value', null);
  end if;

  for k in select jsonb_object_keys(p_payload) loop
    if not (k = any (allowed)) then
      errs := errs || app.request_err(k, 'unknown_field', 'Campo não reconhecido.');
    end if;
  end loop;

  -- organization: required on create, immutable afterwards
  if p_mode = 'create' then
    j := p_payload -> 'organization_id';
    if jsonb_typeof(j) = 'string' and (j #>> '{}') ~ uuid_re then
      v := v || jsonb_build_object('organization_id', lower(j #>> '{}'));
    else
      errs := errs || app.request_err('organization_id', 'required', 'Indique a organização.');
    end if;
  elsif p_payload ? 'organization_id' then
    errs := errs || app.request_err('organization_id', 'immutable', 'A organização de um pedido não muda.');
  end if;

  j := p_payload -> 'assignee_profile_id';
  if jsonb_typeof(j) = 'string' and (j #>> '{}') ~ uuid_re then
    v := v || jsonb_build_object('assignee_profile_id', lower(j #>> '{}'));
  else
    errs := errs || app.request_err('assignee_profile_id', 'required', 'Escolha a pessoa a quem o pedido se dirige.');
  end if;

  j := p_payload -> 'type';
  if jsonb_typeof(j) = 'string' and (j #>> '{}') in ('review', 'approval', 'question', 'test', 'task') then
    req_type := j #>> '{}';
    v := v || jsonb_build_object('type', req_type);
  else
    errs := errs || app.request_err('type', 'required', 'Escolha o tipo de pedido.');
  end if;

  -- required texts
  j := p_payload -> 'title';
  s := case when jsonb_typeof(j) = 'string' then btrim(j #>> '{}') end;
  if s is null or s = '' then
    errs := errs || app.request_err('title', 'required', 'Escreva um título.');
  elsif length(s) > 200 then
    errs := errs || app.request_err('title', 'too_long', 'O título tem no máximo 200 caracteres.');
  else
    v := v || jsonb_build_object('title', s);
  end if;

  j := p_payload -> 'requested_action';
  s := case when jsonb_typeof(j) = 'string' then btrim(j #>> '{}') end;
  if s is null or s = '' then
    errs := errs || app.request_err('requested_action', 'required', 'Descreva o que precisa que a parceira faça.');
  elsif length(s) > 4000 then
    errs := errs || app.request_err('requested_action', 'too_long', 'No máximo 4000 caracteres.');
  else
    v := v || jsonb_build_object('requested_action', s);
  end if;

  -- optional text
  j := p_payload -> 'context';
  if j is null or jsonb_typeof(j) = 'null' then
    v := v || jsonb_build_object('context', null);
  elsif jsonb_typeof(j) <> 'string' then
    errs := errs || app.request_err('context', 'invalid', 'Texto inválido.');
  else
    s := nullif(btrim(j #>> '{}'), '');
    if length(s) > 4000 then
      errs := errs || app.request_err('context', 'too_long', 'No máximo 4000 caracteres.');
    else
      v := v || jsonb_build_object('context', s);
    end if;
  end if;

  -- effort: a positive integer; 1 is rendered "<1 min"
  j := p_payload -> 'estimated_effort_minutes';
  if jsonb_typeof(j) = 'number' then
    n := (j #>> '{}')::numeric;
    if n <> trunc(n) or n < 1 or n > 2147483647 then
      errs := errs || app.request_err('estimated_effort_minutes', 'invalid', 'O esforço é um número inteiro de minutos, pelo menos 1.');
    else
      v := v || jsonb_build_object('estimated_effort_minutes', n::integer);
    end if;
  else
    errs := errs || app.request_err('estimated_effort_minutes', 'required', 'Indique o esforço estimado.');
  end if;

  -- deadline: optional; a past deadline is accepted (the UI warns)
  j := p_payload -> 'due_at';
  if j is null or jsonb_typeof(j) = 'null' then
    v := v || jsonb_build_object('due_at', null);
  elsif jsonb_typeof(j) = 'string' then
    begin
      v := v || jsonb_build_object('due_at', (j #>> '{}')::timestamptz);
    exception when others then
      errs := errs || app.request_err('due_at', 'invalid', 'Data inválida.');
    end;
  else
    errs := errs || app.request_err('due_at', 'invalid', 'Data inválida.');
  end if;

  foreach k in array array['product_id', 'resource_id'] loop
    j := p_payload -> k;
    if j is null or jsonb_typeof(j) = 'null' then
      v := v || jsonb_build_object(k, null);
    elsif jsonb_typeof(j) = 'string' and (j #>> '{}') ~ uuid_re then
      v := v || jsonb_build_object(k, lower(j #>> '{}'));
    else
      errs := errs || app.request_err(k, 'invalid', 'Identificador inválido.');
    end if;
  end loop;

  -- internal details
  internal := p_payload -> 'internal';
  if internal is null or jsonb_typeof(internal) = 'null' then
    v := v || jsonb_build_object('internal', jsonb_build_object(
      'completion_criteria', null, 'internal_owner_profile_id', null, 'priority', 'normal'));
  elsif jsonb_typeof(internal) <> 'object' then
    errs := errs || app.request_err('internal', 'invalid', 'Detalhes internos inválidos.');
  else
    for k in select jsonb_object_keys(internal) loop
      if not (k = any (array['completion_criteria', 'internal_owner_profile_id', 'priority'])) then
        errs := errs || app.request_err('internal.' || k, 'unknown_field', 'Campo não reconhecido.');
      end if;
    end loop;

    fo := jsonb_build_object('completion_criteria', null, 'internal_owner_profile_id', null, 'priority', 'normal');

    j := internal -> 'completion_criteria';
    if j is not null and jsonb_typeof(j) <> 'null' then
      if jsonb_typeof(j) <> 'string' then
        errs := errs || app.request_err('internal.completion_criteria', 'invalid', 'Texto inválido.');
      else
        s := nullif(btrim(j #>> '{}'), '');
        if length(s) > 4000 then
          errs := errs || app.request_err('internal.completion_criteria', 'too_long', 'No máximo 4000 caracteres.');
        else
          fo := fo || jsonb_build_object('completion_criteria', s);
        end if;
      end if;
    end if;

    j := internal -> 'internal_owner_profile_id';
    if j is not null and jsonb_typeof(j) <> 'null' then
      if jsonb_typeof(j) = 'string' and (j #>> '{}') ~ uuid_re then
        fo := fo || jsonb_build_object('internal_owner_profile_id', lower(j #>> '{}'));
      else
        errs := errs || app.request_err('internal.internal_owner_profile_id', 'invalid', 'Identificador inválido.');
      end if;
    end if;

    j := internal -> 'priority';
    if j is not null and jsonb_typeof(j) <> 'null' then
      if jsonb_typeof(j) = 'string' and (j #>> '{}') in ('normal', 'important', 'urgent') then
        fo := fo || jsonb_build_object('priority', j #>> '{}');
      else
        errs := errs || app.request_err('internal.priority', 'invalid', 'Prioridade inválida.');
      end if;
    end if;

    -- Internal details are one row with a required completion criterion. Priority
    -- or owner without a criterion has nowhere honest to live.
    if fo ->> 'completion_criteria' is null
       and (fo ->> 'internal_owner_profile_id' is not null or fo ->> 'priority' <> 'normal') then
      errs := errs || app.request_err('internal.completion_criteria', 'required_for_internal',
        'Escreva o critério de conclusão para guardar a prioridade ou o responsável.');
    end if;

    v := v || jsonb_build_object('internal', fo);
  end if;

  -- fields (author-defined; approval fields are generated by the system)
  fields := p_payload -> 'fields';
  if fields is null or jsonb_typeof(fields) = 'null' then
    fields := '[]'::jsonb;
  end if;

  if jsonb_typeof(fields) <> 'array' then
    errs := errs || app.request_err('fields', 'invalid', 'Perguntas inválidas.');
  elsif jsonb_array_length(fields) > 20 then
    errs := errs || app.request_err('fields', 'too_many', 'No máximo 20 perguntas.');
  elsif req_type = 'approval' and jsonb_array_length(fields) > 0 then
    errs := errs || app.request_err('fields', 'approval_fields_system',
      'Num pedido de aprovação as perguntas são geradas pelo sistema.');
  else
    idx := 0;
    for f in select value from jsonb_array_elements(fields) loop
      if jsonb_typeof(f) <> 'object' then
        errs := errs || app.request_err(format('fields[%s]', idx), 'invalid', 'Pergunta inválida.');
        idx := idx + 1;
        continue;
      end if;

      for k in select jsonb_object_keys(f) loop
        if not (k = any (array['label', 'help_text', 'type', 'required', 'options'])) then
          errs := errs || app.request_err(format('fields[%s].%s', idx, k), 'unknown_field', 'Campo não reconhecido.');
        end if;
      end loop;

      fo := '{}'::jsonb;

      j := f -> 'label';
      s := case when jsonb_typeof(j) = 'string' then btrim(j #>> '{}') end;
      if s is null or s = '' then
        errs := errs || app.request_err(format('fields[%s].label', idx), 'required', 'Escreva a pergunta.');
      elsif length(s) > 300 then
        errs := errs || app.request_err(format('fields[%s].label', idx), 'too_long', 'No máximo 300 caracteres.');
      else
        fo := fo || jsonb_build_object('label', s);
      end if;

      j := f -> 'help_text';
      if j is null or jsonb_typeof(j) = 'null' then
        fo := fo || jsonb_build_object('help_text', null);
      elsif jsonb_typeof(j) <> 'string' then
        errs := errs || app.request_err(format('fields[%s].help_text', idx), 'invalid', 'Texto inválido.');
      else
        s := nullif(btrim(j #>> '{}'), '');
        if length(s) > 1000 then
          errs := errs || app.request_err(format('fields[%s].help_text', idx), 'too_long', 'No máximo 1000 caracteres.');
        else
          fo := fo || jsonb_build_object('help_text', s);
        end if;
      end if;

      j := f -> 'type';
      if jsonb_typeof(j) = 'string' and (j #>> '{}') in ('long_text', 'single_choice', 'boolean') then
        fo := fo || jsonb_build_object('type', j #>> '{}');
      elsif jsonb_typeof(j) = 'string' and (j #>> '{}') = 'approval' then
        errs := errs || app.request_err(format('fields[%s].type', idx), 'system_type',
          'A decisão de aprovação é gerada pelo sistema.');
      else
        errs := errs || app.request_err(format('fields[%s].type', idx), 'required', 'Escolha o tipo de resposta.');
      end if;

      j := f -> 'required';
      if j is null or jsonb_typeof(j) = 'null' then
        fo := fo || jsonb_build_object('required', false);
      elsif jsonb_typeof(j) = 'boolean' then
        fo := fo || jsonb_build_object('required', j);
      else
        errs := errs || app.request_err(format('fields[%s].required', idx), 'invalid', 'Valor inválido.');
      end if;

      opts := f -> 'options';
      if fo ->> 'type' = 'single_choice' then
        if opts is null or jsonb_typeof(opts) = 'null' then
          fo := fo || jsonb_build_object('options', '[]'::jsonb);
        elsif jsonb_typeof(opts) <> 'array' then
          errs := errs || app.request_err(format('fields[%s].options', idx), 'invalid', 'Opções inválidas.');
        elsif jsonb_array_length(opts) > 20 then
          errs := errs || app.request_err(format('fields[%s].options', idx), 'too_many', 'No máximo 20 opções.');
        else
          oidx := 0;
          fo := fo || jsonb_build_object('options', '[]'::jsonb);
          for opt in select value from jsonb_array_elements(opts) loop
            s := case when jsonb_typeof(opt) = 'string' then btrim(opt #>> '{}') end;
            if s is null or s = '' then
              errs := errs || app.request_err(format('fields[%s].options[%s]', idx, oidx), 'required', 'Escreva a opção.');
            elsif length(s) > 200 then
              errs := errs || app.request_err(format('fields[%s].options[%s]', idx, oidx), 'too_long', 'No máximo 200 caracteres.');
            else
              fo := jsonb_set(fo, '{options}', (fo -> 'options') || to_jsonb(s));
            end if;
            oidx := oidx + 1;
          end loop;
        end if;
      elsif opts is not null and jsonb_typeof(opts) <> 'null' then
        errs := errs || app.request_err(format('fields[%s].options', idx), 'not_applicable',
          'Só as perguntas de escolha única têm opções.');
      else
        fo := fo || jsonb_build_object('options', null);
      end if;

      fields_out := fields_out || jsonb_build_array(fo);
      idx := idx + 1;
    end loop;
    v := v || jsonb_build_object('fields', fields_out);
  end if;

  return jsonb_build_object('errors', errs, 'value', v);
end;
$$;

-- Referential checks shared by create and update. Locks are taken in the fixed order
-- organization → membership → organization_products/product → resource, after the
-- Request row (update/publish lock the Request first). Every C2 command follows it.
create or replace function app.request_check_references(p_org uuid, p_value jsonb, p_for_publish boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  org_status public.organization_status;
  assignee uuid := (p_value ->> 'assignee_profile_id')::uuid;
  product uuid := (p_value ->> 'product_id')::uuid;
  resource uuid := (p_value ->> 'resource_id')::uuid;
  owner_id uuid := (p_value #>> '{internal,internal_owner_profile_id}')::uuid;
  link_status public.organization_product_status;
  prod_status public.product_status;
  res record;
begin
  select o.status into org_status from public.organizations o where o.id = p_org for share;
  if not found then
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'organization'));
  end if;
  if org_status <> 'active' then
    perform app.request_fail('RQ004', 'organization_not_active', jsonb_build_object('status', org_status));
  end if;

  perform 1 from public.organization_memberships m
   where m.organization_id = p_org and m.profile_id = assignee and m.status = 'active'
   for share;
  if not found then
    perform app.request_fail('RQ005', 'assignee_not_active_member');
  end if;

  if product is not null then
    select op.status into link_status from public.organization_products op
     where op.organization_id = p_org and op.product_id = product
     for share;
    select p.status into prod_status from public.products p where p.id = product for share;
    if link_status is distinct from 'active' or prod_status is distinct from 'active' then
      perform app.request_fail('RQ006', 'product_not_linked');
    end if;
  end if;

  if resource is not null then
    select r.organization_id, r.product_id, r.status, r.partner_visible
      into res from public.resources r where r.id = resource for share;
    if not found or res.organization_id <> p_org then
      perform app.request_fail('RQ007', 'resource_not_available', jsonb_build_object('reason', 'not_in_organization'));
    end if;
    if product is not null and res.product_id is not null and res.product_id <> product then
      perform app.request_fail('RQ007', 'resource_not_available', jsonb_build_object('reason', 'product_mismatch'));
    end if;
    if p_for_publish and (res.status <> 'active' or not res.partner_visible) then
      perform app.request_fail('RQ007', 'resource_not_available', jsonb_build_object('reason', 'not_active_or_not_visible'));
    end if;
  end if;

  if owner_id is not null and not exists (
    select 1 from public.profiles where id = owner_id and is_sollelio_staff) then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', jsonb_build_array(
      app.request_err('internal.internal_owner_profile_id', 'not_staff', 'O responsável interno tem de ser da Sollelio.'))));
  end if;
end;
$$;

-- Writes the editable content of a Request: its author fields (replaced), the
-- system approval fields (kept exactly when the type is approval, removed
-- otherwise) and its internal details. Only ever called on a draft.
create or replace function app.request_write_content(p_request uuid, p_actor uuid, p_value jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  f jsonb;
  pos integer := 0;
  criteria text := p_value #>> '{internal,completion_criteria}';
begin
  delete from public.request_fields where request_id = p_request and not system_generated;

  if p_value ->> 'type' = 'approval' then
    insert into public.request_fields (request_id, key, label, type, required, options, sort_order, system_generated)
    values
      (p_request, 'approval', 'A sua decisão', 'approval', true, '["approve", "needs_changes"]'::jsonb, 1, true),
      (p_request, 'approval_notes', 'O que deve mudar?', 'long_text', false, null, 2, true)
    on conflict (request_id, key) do nothing;
  else
    delete from public.request_fields where request_id = p_request and system_generated;
    for f in select value from jsonb_array_elements(coalesce(p_value -> 'fields', '[]'::jsonb)) loop
      pos := pos + 1;
      insert into public.request_fields (request_id, key, label, help_text, type, required, options, sort_order)
      values (p_request, 'q' || pos, f ->> 'label', f ->> 'help_text', (f ->> 'type')::public.request_field_type,
              (f ->> 'required')::boolean,
              case when f ->> 'type' = 'single_choice' then f -> 'options' end, pos);
    end loop;
  end if;

  if criteria is null then
    delete from public.request_internal_details where request_id = p_request;
  else
    insert into public.request_internal_details (request_id, completion_criteria, internal_owner_profile_id, priority, updated_by)
    values (p_request, criteria,
            coalesce((p_value #>> '{internal,internal_owner_profile_id}')::uuid, p_actor),
            (p_value #>> '{internal,priority}')::public.request_priority, p_actor)
    on conflict (request_id) do update
      set completion_criteria = excluded.completion_criteria,
          internal_owner_profile_id = excluded.internal_owner_profile_id,
          priority = excluded.priority,
          updated_by = excluded.updated_by;
  end if;
end;
$$;

revoke execute on function app.request_fail(text, text, jsonb) from public, anon, authenticated;
revoke execute on function app.request_require_staff(uuid) from public, anon, authenticated;
revoke execute on function app.request_err(text, text, text) from public, anon, authenticated;
revoke execute on function app.request_normalize(jsonb, text) from public, anon, authenticated;
revoke execute on function app.request_check_references(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function app.request_write_content(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.request_fail(text, text, jsonb) to service_role;
grant execute on function app.request_require_staff(uuid) to service_role;
grant execute on function app.request_err(text, text, text) to service_role;
grant execute on function app.request_normalize(jsonb, text) to service_role;
grant execute on function app.request_check_references(uuid, jsonb, boolean) to service_role;
grant execute on function app.request_write_content(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The C2 commands (public, SECURITY INVOKER, service_role only)
-- ---------------------------------------------------------------------------
-- create_request. The Request id is generated by the client and doubles as the
-- idempotency key. The receipt row is claimed first: a concurrent duplicate waits
-- on its primary key and then replays or conflicts, it never creates a second row.
create or replace function public.cmd_create_request(p_actor uuid, p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  hash text := md5(coalesce(p_payload, 'null'::jsonb)::text);
  receipt record;
  norm jsonb;
  v jsonb;
  org uuid;
  rev integer;
  v_result jsonb;
begin
  perform app.request_require_staff(p_actor);

  if p_request_id is null then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', jsonb_build_array(
      app.request_err('request_id', 'required', 'Falta o identificador do pedido.'))));
  end if;

  insert into public.request_command_receipts (command, idempotency_key, actor_profile_id, request_id, payload_hash)
  values ('create_request', p_request_id, p_actor, p_request_id, hash)
  on conflict do nothing;

  if not found then
    select * into receipt from public.request_command_receipts
     where command = 'create_request' and idempotency_key = p_request_id;
    if receipt.actor_profile_id = p_actor and receipt.payload_hash = hash and receipt.result is not null then
      return receipt.result || jsonb_build_object('replayed', true);
    end if;
    perform app.request_fail('RQ010', 'idempotency_conflict');
  end if;

  if exists (select 1 from public.requests where id = p_request_id) then
    perform app.request_fail('RQ010', 'idempotency_conflict');
  end if;

  norm := app.request_normalize(p_payload, 'create');
  if jsonb_array_length(norm -> 'errors') > 0 then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', norm -> 'errors'));
  end if;
  v := norm -> 'value';
  org := (v ->> 'organization_id')::uuid;

  perform app.request_check_references(org, v, false);

  insert into public.requests (
    id, organization_id, product_id, resource_id, type, status, next_actor, title, context,
    requested_action, estimated_effort_minutes, assignee_profile_id, due_at, created_by)
  values (
    p_request_id, org, (v ->> 'product_id')::uuid, (v ->> 'resource_id')::uuid,
    (v ->> 'type')::public.request_type, 'draft', 'none', v ->> 'title', v ->> 'context',
    v ->> 'requested_action', (v ->> 'estimated_effort_minutes')::integer,
    (v ->> 'assignee_profile_id')::uuid, (v ->> 'due_at')::timestamptz, p_actor);

  perform app.request_write_content(p_request_id, p_actor, v);

  select revision into rev from public.requests where id = p_request_id;

  insert into public.activity_events (organization_id, actor_profile_id, event_type, object_type, object_id, metadata)
  values (org, p_actor, 'request.created', 'request', p_request_id, jsonb_build_object('revision', rev));

  v_result := jsonb_build_object('request_id', p_request_id, 'revision', rev, 'status', 'draft');
  update public.request_command_receipts set result = v_result
   where command = 'create_request' and idempotency_key = p_request_id;

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

-- update_request_draft. Full replacement of the editable content of a draft, at the
-- revision the caller last read. The organization never changes.
create or replace function public.cmd_update_request_draft(
  p_actor uuid, p_request_id uuid, p_expected_revision integer, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  req record;
  norm jsonb;
  v jsonb;
  rev integer;
begin
  perform app.request_require_staff(p_actor);

  select id, organization_id, status, revision into req
    from public.requests where id = p_request_id for update;
  if not found then
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'request'));
  end if;
  if req.status <> 'draft' then
    perform app.request_fail('RQ009', 'invalid_state', jsonb_build_object('status', req.status));
  end if;
  if p_expected_revision is null or req.revision <> p_expected_revision then
    perform app.request_fail('RQ008', 'stale_revision', jsonb_build_object('current_revision', req.revision));
  end if;

  norm := app.request_normalize(p_payload, 'update');
  if jsonb_array_length(norm -> 'errors') > 0 then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', norm -> 'errors'));
  end if;
  v := norm -> 'value';

  perform app.request_check_references(req.organization_id, v, false);

  update public.requests
     set product_id = (v ->> 'product_id')::uuid,
         resource_id = (v ->> 'resource_id')::uuid,
         type = (v ->> 'type')::public.request_type,
         title = v ->> 'title',
         context = v ->> 'context',
         requested_action = v ->> 'requested_action',
         estimated_effort_minutes = (v ->> 'estimated_effort_minutes')::integer,
         assignee_profile_id = (v ->> 'assignee_profile_id')::uuid,
         due_at = (v ->> 'due_at')::timestamptz
   where id = p_request_id;

  perform app.request_write_content(p_request_id, p_actor, v);

  select revision into rev from public.requests where id = p_request_id;
  return jsonb_build_object('request_id', p_request_id, 'revision', rev, 'status', 'draft');
end;
$$;

-- preview_request. One statement, so the Request, its fields and its Resource come
-- from a single snapshot, together with the revision that snapshot represents. The
-- partner shape is the projection row itself; nothing here re-derives it. A draft is
-- shown as it will appear once published, and says so.
create or replace function public.cmd_preview_request(p_actor uuid, p_request_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform app.request_require_staff(p_actor);

  select jsonb_build_object(
           'request_id', r.id,
           'organization_id', r.organization_id,
           'revision', r.revision,
           'status', r.status,
           'simulated_publication', r.status = 'draft',
           'request', (to_jsonb(pr) - 'assignee_profile_id')
                      || case when r.status = 'draft'
                              then jsonb_build_object('partner_state', 'needs_you')
                              else '{}'::jsonb end,
           'fields', coalesce((
              select jsonb_agg(to_jsonb(f) order by f.sort_order, f.key)
                from public.request_fields f where f.request_id = r.id), '[]'::jsonb),
           -- Exactly what the partner could read through `resources` RLS: the row, if
           -- it is the Request's organization's, active and partner-visible.
           'resource', (
              select to_jsonb(res) from public.resources res
               where res.id = r.resource_id and res.organization_id = r.organization_id
                 and res.status = 'active' and res.partner_visible),
           'resource_unavailable', r.resource_id is not null and not exists (
              select 1 from public.resources res
               where res.id = r.resource_id and res.organization_id = r.organization_id
                 and res.status = 'active' and res.partner_visible))
    into v_out
    from public.requests r
    join app.partner_request_projection pr on pr.id = r.id
   where r.id = p_request_id;

  if v_out is null then
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'request'));
  end if;
  return v_out;
end;
$$;

-- publish_request. Publishes exactly the revision the caller previewed. Replays of
-- the same attempt (same idempotency key, same request, same revision) return the
-- original outcome and write nothing; any other attempt on a published Request is
-- `invalid_state`, never a silent success.
--
-- Lock order: receipt key → Request (FOR UPDATE) → organization → assignee
-- membership → organization_products/product → resource (all FOR SHARE). A
-- concurrent change to any dependency either commits first, and is seen, or waits
-- until this publication commits.
create or replace function public.cmd_publish_request(
  p_actor uuid, p_request_id uuid, p_expected_revision integer, p_idempotency_key uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  hash text := md5(jsonb_build_object('request_id', p_request_id, 'expected_revision', p_expected_revision)::text);
  receipt record;
  req record;
  missing jsonb := '[]'::jsonb;
  f record;
  published timestamptz;
  rev integer;
  v_result jsonb;
begin
  perform app.request_require_staff(p_actor);

  if p_idempotency_key is null then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', jsonb_build_array(
      app.request_err('idempotency_key', 'required', 'Falta a chave da operação.'))));
  end if;

  insert into public.request_command_receipts (command, idempotency_key, actor_profile_id, request_id, payload_hash)
  select 'publish_request', p_idempotency_key, p_actor, p_request_id, hash
   where exists (select 1 from public.requests where id = p_request_id)
  on conflict do nothing;

  if not found then
    select * into receipt from public.request_command_receipts
     where command = 'publish_request' and idempotency_key = p_idempotency_key;
    if found then
      if receipt.actor_profile_id = p_actor and receipt.payload_hash = hash and receipt.result is not null then
        return receipt.result || jsonb_build_object('replayed', true);
      end if;
      perform app.request_fail('RQ010', 'idempotency_conflict');
    end if;
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'request'));
  end if;

  select id, organization_id, product_id, resource_id, type, status, revision, assignee_profile_id
    into req from public.requests where id = p_request_id for update;
  if req.status <> 'draft' then
    perform app.request_fail('RQ009', 'invalid_state', jsonb_build_object('status', req.status));
  end if;
  if p_expected_revision is null or req.revision <> p_expected_revision then
    perform app.request_fail('RQ008', 'stale_revision', jsonb_build_object('current_revision', req.revision));
  end if;

  perform app.request_check_references(
    req.organization_id,
    jsonb_build_object('assignee_profile_id', req.assignee_profile_id, 'product_id', req.product_id,
                       'resource_id', req.resource_id, 'internal', '{}'::jsonb),
    true);

  -- Publication requirements (05 §4, 02 §4, 03 §6/§16).
  if not exists (select 1 from public.request_internal_details where request_id = p_request_id) then
    missing := missing || app.request_err('internal.completion_criteria', 'required', 'Falta o critério de conclusão.');
  end if;

  if req.type in ('question', 'review', 'test') and not exists (
    select 1 from public.request_fields where request_id = p_request_id and not system_generated) then
    missing := missing || app.request_err('fields', 'required', 'Este tipo de pedido precisa de pelo menos uma pergunta.');
  end if;

  if req.type = 'approval' and (
    select count(*) from public.request_fields
     where request_id = p_request_id and system_generated and key in ('approval', 'approval_notes')) <> 2 then
    missing := missing || app.request_err('fields', 'approval_fields_missing', 'Faltam os campos de aprovação do sistema.');
  end if;

  for f in select key, sort_order, options from public.request_fields
            where request_id = p_request_id and type = 'single_choice' and not system_generated loop
    if f.options is null or jsonb_typeof(f.options) <> 'array' or jsonb_array_length(f.options) < 2
       or (select count(distinct lower(btrim(o))) from jsonb_array_elements_text(f.options) o)
          <> jsonb_array_length(f.options)
       or exists (select 1 from jsonb_array_elements_text(f.options) o where btrim(o) = '') then
      missing := missing || app.request_err(format('fields[%s].options', f.sort_order - 1), 'invalid_options',
        'Uma pergunta de escolha única precisa de pelo menos duas opções diferentes.');
    end if;
  end loop;

  if jsonb_array_length(missing) > 0 then
    perform app.request_fail('RQ011', 'publish_requirements', jsonb_build_object('errors', missing));
  end if;

  published := now();
  update public.requests
     set status = 'needs_partner', next_actor = 'partner', published_at = published
   where id = p_request_id;

  select revision into rev from public.requests where id = p_request_id;

  insert into public.activity_events (organization_id, actor_profile_id, event_type, object_type, object_id, metadata)
  values (req.organization_id, p_actor, 'request.published', 'request', p_request_id,
          jsonb_build_object('revision', rev, 'published_revision', p_expected_revision));

  v_result := jsonb_build_object('request_id', p_request_id, 'revision', rev, 'status', 'needs_partner',
                                 'published_at', published);
  update public.request_command_receipts set result = v_result
   where command = 'publish_request' and idempotency_key = p_idempotency_key;

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke execute on function public.cmd_create_request(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.cmd_update_request_draft(uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.cmd_preview_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cmd_publish_request(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.cmd_create_request(uuid, uuid, jsonb) to service_role;
grant execute on function public.cmd_update_request_draft(uuid, uuid, integer, jsonb) to service_role;
grant execute on function public.cmd_preview_request(uuid, uuid) to service_role;
grant execute on function public.cmd_publish_request(uuid, uuid, integer, uuid) to service_role;
