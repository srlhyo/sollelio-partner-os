-- Slice 2, Checkpoint C4 — Request cancellation.
--
-- 05_DATA_MODEL_AND_API.md §4 (Cancellation), §12.3, §13 (C4 contract);
-- 02_OPERATING_MODEL.md §16; 03_UX_SPEC.md §5, §15.
--
-- Additive to C1–C3, which stay byte-for-byte as committed:
--
--   1. `requests.cancellation_reason` — a first-class, partner-facing column, present
--      exactly when the Request is cancelled (check constraint), written only by
--      `cancel_request`, never changed afterwards (trigger, every role). Trimmed by
--      `app.request_trim`, which removes every whitespace character at the ends.
--   2. The partner projection gains it: `app.partner_request_projection` and
--      `public.partner_requests` append it (seventeenth public column). Nothing else in
--      the partner shape changes; views are replaced in place, so grants, ownership,
--      options and the policies that reference `partner_requests` are preserved.
--   3. `cmd_cancel_request` — staff only, executable only by `service_role`.
--
-- Nothing here grants anon or authenticated any write, and no existing row changes:
-- a non-cancelled Request has no reason, which the new constraint requires.

-- ---------------------------------------------------------------------------
-- 1. The reason, tied to the cancelled state
-- ---------------------------------------------------------------------------
-- Trims every whitespace character a person can type or paste at either end (line
-- breaks, tabs, no-break and other Unicode spaces), as the client's String.trim()
-- does. btrim() with no characters argument trims only the ASCII space, which would
-- let a reason made only of line breaks through.
create or replace function app.request_trim(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select btrim(p_text, E' \t\n\r\u000B\f\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006'
                       || E'\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')
$$;

revoke execute on function app.request_trim(text) from public, anon, authenticated;
grant execute on function app.request_trim(text) to service_role;

alter table public.requests
  add column cancellation_reason text,
  add constraint requests_cancellation_reason_shape check (
    cancellation_reason is null
    or (cancellation_reason = app.request_trim(cancellation_reason)
        and length(cancellation_reason) between 1 and 2000)),
  add constraint requests_cancellation_reason_state check (
    (status = 'cancelled') = (cancellation_reason is not null));

comment on column public.requests.cancellation_reason is
  'Why Sollelio cancelled the Request (C4). Present exactly when status = cancelled; '
  'written only by cancel_request; partner-facing; never changed after cancellation.';

-- Cancellation is terminal: a cancelled Request never leaves that state, and its date
-- and reason never change — for every role, not only the API ones. Other columns
-- (e.g. the revision a child-row touch moves) are not frozen here.
create or replace function app.assert_cancelled_request_is_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cancelled'
     and (new.status is distinct from old.status
          or new.cancelled_at is distinct from old.cancelled_at
          or new.cancellation_reason is distinct from old.cancellation_reason) then
    raise exception 'A cancelled Request is final: its state, date and reason never change.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function app.assert_cancelled_request_is_final() from public, anon, authenticated;

create trigger requests_cancelled_is_final
  before update on public.requests
  for each row execute function app.assert_cancelled_request_is_final();

-- ---------------------------------------------------------------------------
-- 2. The partner projection, extended by one column
-- ---------------------------------------------------------------------------
-- `create or replace view` may only append columns: the internal projection keeps its
-- C2 columns in order (assignee_profile_id included) and appends the reason; the
-- public view keeps its sixteen columns and appends it as the seventeenth.
create or replace view app.partner_request_projection
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
  r.assignee_profile_id,
  r.cancellation_reason
from public.requests r
left join public.products p on p.id = r.product_id;

comment on view app.partner_request_projection is
  'The single partner-facing Request shape (05_DATA_MODEL_AND_API.md §12.3). '
  'Read by public.partner_requests (with the partner predicate) and by '
  'cmd_preview_request (staff only). assignee_profile_id is predicate support; '
  'cancellation_reason was appended in C4.';

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
  pr.resource_id,
  pr.cancellation_reason
from app.partner_request_projection pr
where pr.published_at is not null
  and pr.assignee_profile_id = app.current_profile_id()
  and app.has_active_membership(pr.organization_id);

comment on view public.partner_requests is
  'The only Request shape a partner may read: app.partner_request_projection filtered '
  'to published Requests assigned to the caller while their membership is active. '
  'Seventeen columns (cancellation_reason appended in C4). Excludes status, '
  'next_actor, assignee_profile_id, created_by, revision and everything in '
  'request_internal_details.';

-- ---------------------------------------------------------------------------
-- 3. cancel_request
-- ---------------------------------------------------------------------------
-- Lock: the Request row only (FOR UPDATE), taken first like every Request command.
-- Cancellation never needs the organization, a membership or a Resource, so it stays
-- possible after the assignee left or the organization became inactive.
-- No key: a retry after success is `invalid_state`; the client settles an ambiguous
-- outcome by reading the Request (as for complete).
create or replace function public.cmd_cancel_request(
  p_actor uuid, p_request_id uuid, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  req record;
  reason text := app.request_trim(coalesce(p_reason, ''));
  cancelled timestamptz;
  rev integer;
begin
  perform app.request_require_staff(p_actor);

  select id, organization_id, status, revision
    into req from public.requests where id = p_request_id for update;
  if not found then
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'request'));
  end if;
  if req.status not in ('draft', 'needs_partner', 'needs_sollelio') then
    perform app.request_fail('RQ009', 'invalid_state', jsonb_build_object('status', req.status));
  end if;
  if p_expected_revision is null or req.revision <> p_expected_revision then
    perform app.request_fail('RQ008', 'stale_revision', jsonb_build_object('current_revision', req.revision));
  end if;

  if reason = '' then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', jsonb_build_array(
      app.request_err('reason', 'required', 'Escreva o motivo do cancelamento.'))));
  elsif length(reason) > 2000 then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', jsonb_build_array(
      app.request_err('reason', 'too_long', 'No máximo 2000 caracteres.'))));
  end if;

  cancelled := now();
  update public.requests
     set status = 'cancelled', next_actor = 'none', cancelled_at = cancelled, cancellation_reason = reason
   where id = p_request_id;
  select revision into rev from public.requests where id = p_request_id;

  insert into public.activity_events (organization_id, actor_profile_id, event_type, object_type, object_id, metadata)
  values (req.organization_id, p_actor, 'request.cancelled', 'request', p_request_id,
          jsonb_build_object('revision', rev, 'previous_status', req.status));

  return jsonb_build_object('request_id', p_request_id, 'status', 'cancelled', 'revision', rev,
                            'cancelled_at', cancelled);
end;
$$;

revoke execute on function public.cmd_cancel_request(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.cmd_cancel_request(uuid, uuid, integer, text) to service_role;
