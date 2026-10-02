-- C3 whitespace canonicalization hardening (after Slice 2 C4).
--
-- 05_DATA_MODEL_AND_API.md §4, §13 (C3 contracts: "after trimming"); C4 introduced the
-- canonical helper `app.request_trim` (20260928180000), which trims every whitespace
-- character at either end, as the client's String.trim() does.
--
-- C3 trimmed three stored, partner- or staff-authored values with plain btrim(), which
-- strips only the ASCII space: a message or response made of line breaks passed as
-- "non-empty", and boundary tabs, line breaks or no-break spaces were stored. This
-- migration moves exactly those three to `app.request_trim`:
--
--   1. request_returns.message                          (cmd_return_request_to_partner)
--   2. request_submissions.response_text, returned round (cmd_submit_request)
--   3. request_submissions.response_notes, returned round (cmd_submit_request)
--
-- Each check constraint is replaced under its existing name and VALIDATED against the
-- rows already stored: nothing is rewritten. A stored row with exotic boundary
-- whitespace makes this migration fail (and roll back) instead of being "cleaned".
-- The two command bodies are the applied C3 definitions with only those three
-- expressions changed; CREATE OR REPLACE keeps their owner, grants and signatures.
--
-- Deliberately unchanged:
--   * app.request_submission_hash — the replay identity of stored submissions. Its
--     btrim() canonicalization is stricter than app.request_trim, never looser, so it
--     never replays a semantically different payload; changing it would change the
--     identity of submissions already stored (append-only history).
--   * initial-round answer normalization (long_text, single_choice) — not part of this
--     checkpoint.
--   * the replay comparison of a return (`existing.message = msg`): for every stored
--     message that satisfies the new constraint, app.request_trim of the original input
--     equals the stored value, so replays keep replaying.
--
-- No grant, no table-data UPDATE, no trigger change, no C3/C4 file edited.

-- ---------------------------------------------------------------------------
-- 1. The database backstop: canonical shape for the three values
-- ---------------------------------------------------------------------------
alter table public.request_returns
  drop constraint request_returns_message_check,
  add constraint request_returns_message_check
    check (message = app.request_trim(message) and length(message) between 1 and 2000);

alter table public.request_submissions
  drop constraint request_submissions_response_text_length,
  add constraint request_submissions_response_text_length check (
    response_text is null
    or (response_text = app.request_trim(response_text) and length(response_text) between 1 and 4000)),
  drop constraint request_submissions_response_notes_length,
  add constraint request_submissions_response_notes_length check (
    response_notes is null
    or (response_notes = app.request_trim(response_notes) and length(response_notes) between 1 and 4000));

-- ---------------------------------------------------------------------------
-- 2. submit_request — returned-round text and notes through app.request_trim
-- ---------------------------------------------------------------------------
create or replace function public.cmd_submit_request(
  p_actor uuid, p_request_id uuid, p_submission_id uuid, p_expected_return_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  req record;
  existing record;
  cur record;
  errs jsonb := '[]'::jsonb;
  norm jsonb := '[]'::jsonb;
  item jsonb;
  resp jsonb;
  val jsonb;
  f record;
  idx integer := 0;
  seen uuid[] := '{}';
  fid uuid;
  k text;
  s text;
  path text;
  decision text;
  r_text text;
  r_decision text;
  r_notes text;
  hash text;
  submitted timestamptz;
  rev integer;
begin
  if p_submission_id is null then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', jsonb_build_array(
      app.request_err('submission_id', 'required', 'Falta o identificador da resposta.'))));
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', jsonb_build_array(
      app.request_err('payload', 'invalid', 'Resposta inválida.'))));
  end if;

  select id, organization_id, status, assignee_profile_id, published_at
    into req from public.requests where id = p_request_id for update;
  if not found then
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'request'));
  end if;

  -- Identity first: the same attempt replays its original outcome, whatever the
  -- Request's state is now. Anything else under this id is a conflict.
  select id, request_id, submitted_by, return_id, payload_hash, created_at
    into existing from public.request_submissions where id = p_submission_id;
  if found then
    if existing.request_id = p_request_id and existing.submitted_by = p_actor
       and existing.payload_hash = app.request_submission_hash(p_expected_return_id, p_payload) then
      select (e.metadata ->> 'revision')::integer into rev
        from public.activity_events e
       where e.object_type = 'request' and e.object_id = p_request_id
         and e.event_type = 'request.submitted' and e.metadata ->> 'submission_id' = p_submission_id::text;
      return jsonb_build_object('request_id', p_request_id, 'submission_id', p_submission_id,
                                'return_id', existing.return_id, 'status', 'needs_sollelio',
                                'revision', rev, 'submitted_at', existing.created_at, 'replayed', true);
    end if;
    perform app.request_fail('RQ010', 'idempotency_conflict');
  end if;

  -- Authorization of the supplied actor. Everything the partner may not see looks
  -- the same: not found.
  if p_actor is null or req.published_at is null or req.assignee_profile_id is distinct from p_actor then
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'request'));
  end if;
  perform 1 from public.organization_memberships m
   where m.organization_id = req.organization_id and m.profile_id = p_actor and m.status = 'active'
   for share;
  if not found then
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'request'));
  end if;

  if req.status <> 'needs_partner' then
    perform app.request_fail('RQ009', 'invalid_state');
  end if;

  select c.id, c.response_type into cur from app.request_current_return(p_request_id) c;
  if cur.id is distinct from p_expected_return_id then
    perform app.request_fail('RQ012', 'stale_round', jsonb_build_object('current_return_id', cur.id));
  end if;

  for k in select jsonb_object_keys(p_payload) loop
    if not (k = any (array['answers', 'response'])) then
      errs := errs || app.request_err(k, 'unknown_field', 'Campo não reconhecido.');
    end if;
  end loop;

  if cur.id is null then
    -- Initial round: the original fields, validated as a whole.
    if p_payload ? 'response' then
      errs := errs || app.request_err('response', 'not_allowed', 'Esta resposta é às perguntas do pedido.');
    end if;
    if jsonb_typeof(p_payload -> 'answers') is distinct from 'array' then
      errs := errs || app.request_err('answers', 'invalid', 'Respostas inválidas.');
    else
      for item in select value from jsonb_array_elements(p_payload -> 'answers') loop
        path := format('answers[%s]', idx);
        idx := idx + 1;
        if jsonb_typeof(item) <> 'object' then
          errs := errs || app.request_err(path, 'invalid', 'Resposta inválida.');
          continue;
        end if;
        for k in select jsonb_object_keys(item) loop
          if not (k = any (array['field_id', 'value'])) then
            errs := errs || app.request_err(path || '.' || k, 'unknown_field', 'Campo não reconhecido.');
          end if;
        end loop;

        fid := null;
        if jsonb_typeof(item -> 'field_id') = 'string'
           and (item ->> 'field_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          fid := (item ->> 'field_id')::uuid;
        end if;
        if fid is null then
          errs := errs || app.request_err(path || '.field_id', 'invalid', 'Pergunta inválida.');
          continue;
        end if;

        select id, type, options, key, system_generated into f
          from public.request_fields where id = fid and request_id = p_request_id;
        if not found then
          errs := errs || app.request_err('answers.' || fid, 'unknown_field', 'Esta pergunta não pertence a este pedido.');
          continue;
        end if;
        if fid = any (seen) then
          errs := errs || app.request_err('answers.' || fid, 'duplicate', 'Esta pergunta foi respondida mais de uma vez.');
          continue;
        end if;
        seen := seen || fid;

        path := 'answers.' || fid;
        val := item -> 'value';
        if val is null or jsonb_typeof(val) = 'null' then
          continue;  -- not answered
        end if;

        case f.type
          when 'long_text' then
            if jsonb_typeof(val) <> 'string' then
              errs := errs || app.request_err(path, 'invalid_type', 'Escreva a resposta em texto.');
            else
              s := btrim(val #>> '{}');
              if s = '' then
                continue;  -- empty after trimming: not answered
              elsif length(s) > 4000 then
                errs := errs || app.request_err(path, 'too_long', 'No máximo 4000 caracteres.');
              else
                norm := norm || jsonb_build_array(jsonb_build_object('field_id', fid, 'value', to_jsonb(s)));
              end if;
            end if;
          when 'boolean' then
            if jsonb_typeof(val) <> 'boolean' then
              errs := errs || app.request_err(path, 'invalid_type', 'Responda sim ou não.');
            else
              norm := norm || jsonb_build_array(jsonb_build_object('field_id', fid, 'value', val));
            end if;
          when 'single_choice' then
            if jsonb_typeof(val) <> 'string' then
              errs := errs || app.request_err(path, 'invalid_type', 'Escolha uma das opções.');
            elsif not exists (select 1 from jsonb_array_elements_text(coalesce(f.options, '[]'::jsonb)) o
                               where o = btrim(val #>> '{}')) then
              errs := errs || app.request_err(path, 'invalid_option', 'Escolha uma das opções.');
            else
              norm := norm || jsonb_build_array(jsonb_build_object('field_id', fid, 'value', to_jsonb(btrim(val #>> '{}'))));
            end if;
          when 'approval' then
            if jsonb_typeof(val) <> 'string' then
              errs := errs || app.request_err(path, 'invalid_type', 'Escolha Aprovar ou Precisa de alterações.');
            elsif (val #>> '{}') not in ('approve', 'needs_changes') then
              errs := errs || app.request_err(path, 'invalid_option', 'Escolha Aprovar ou Precisa de alterações.');
            else
              decision := val #>> '{}';
              norm := norm || jsonb_build_array(jsonb_build_object('field_id', fid, 'value', val));
            end if;
        end case;
      end loop;

      -- Every required field answered. `false` is an answer.
      for f in select id from public.request_fields
                where request_id = p_request_id and required order by sort_order loop
        if not exists (select 1 from jsonb_array_elements(norm) e where e ->> 'field_id' = f.id::text)
           and not exists (select 1 from jsonb_array_elements(errs) x where x ->> 'field' = 'answers.' || f.id) then
          errs := errs || app.request_err('answers.' || f.id, 'required', 'Responda a esta pergunta.');
        end if;
      end loop;

      -- Change notes belong to "needs changes" only.
      if decision = 'approve' then
        for f in select id from public.request_fields
                  where request_id = p_request_id and system_generated and key = 'approval_notes' loop
          if exists (select 1 from jsonb_array_elements(norm) e where e ->> 'field_id' = f.id::text) then
            errs := errs || app.request_err('answers.' || f.id, 'notes_not_allowed',
              'As notas de alteração só se enviam com “Precisa de alterações”.');
          end if;
        end loop;
      end if;
    end if;
  else
    -- Returned round: only the return's own question.
    if p_payload ? 'answers' then
      errs := errs || app.request_err('answers', 'not_allowed', 'Esta resposta é só à pergunta da Sollelio.');
    end if;
    resp := p_payload -> 'response';
    if jsonb_typeof(resp) is distinct from 'object' then
      errs := errs || app.request_err('response', 'invalid', 'Resposta inválida.');
    elsif cur.response_type = 'text' then
      for k in select jsonb_object_keys(resp) loop
        if k <> 'text' then
          errs := errs || app.request_err('response.' || k, 'unknown_field', 'Campo não reconhecido.');
        end if;
      end loop;
      if jsonb_typeof(resp -> 'text') is distinct from 'string' then
        errs := errs || app.request_err('response.text', 'required', 'Escreva a sua resposta.');
      else
        r_text := app.request_trim(resp ->> 'text');
        if r_text = '' then
          errs := errs || app.request_err('response.text', 'required', 'Escreva a sua resposta.');
        elsif length(r_text) > 4000 then
          errs := errs || app.request_err('response.text', 'too_long', 'No máximo 4000 caracteres.');
        end if;
      end if;
    else
      for k in select jsonb_object_keys(resp) loop
        if not (k = any (array['decision', 'notes'])) then
          errs := errs || app.request_err('response.' || k, 'unknown_field', 'Campo não reconhecido.');
        end if;
      end loop;
      if jsonb_typeof(resp -> 'decision') is distinct from 'string'
         or (resp ->> 'decision') not in ('approve', 'needs_changes') then
        errs := errs || app.request_err('response.decision', 'required', 'Escolha Aprovar ou Precisa de alterações.');
      else
        r_decision := resp ->> 'decision';
      end if;
      if resp ? 'notes' and jsonb_typeof(resp -> 'notes') <> 'null' then
        if jsonb_typeof(resp -> 'notes') <> 'string' then
          errs := errs || app.request_err('response.notes', 'invalid_type', 'Escreva as notas em texto.');
        else
          r_notes := nullif(app.request_trim(resp ->> 'notes'), '');
          if length(r_notes) > 4000 then
            errs := errs || app.request_err('response.notes', 'too_long', 'No máximo 4000 caracteres.');
          elsif r_notes is not null and r_decision = 'approve' then
            errs := errs || app.request_err('response.notes', 'notes_not_allowed',
              'As notas de alteração só se enviam com “Precisa de alterações”.');
          end if;
        end if;
      end if;
    end if;
  end if;

  if jsonb_array_length(errs) > 0 then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', errs));
  end if;

  hash := app.request_submission_hash(p_expected_return_id, p_payload);
  submitted := clock_timestamp();

  insert into public.request_submissions
    (id, request_id, submitted_by, source, return_id, response_text, response_decision, response_notes,
     payload_hash, created_at)
  values
    (p_submission_id, p_request_id, p_actor, 'partner_os', cur.id, r_text,
     r_decision::public.request_approval_decision, r_notes, hash, submitted);

  insert into public.request_answers (submission_id, request_field_id, value)
  select p_submission_id, (e ->> 'field_id')::uuid, e -> 'value'
    from jsonb_array_elements(norm) e;

  update public.requests set status = 'needs_sollelio', next_actor = 'sollelio' where id = p_request_id;
  select revision into rev from public.requests where id = p_request_id;

  insert into public.activity_events (organization_id, actor_profile_id, event_type, object_type, object_id, metadata)
  values (req.organization_id, p_actor, 'request.submitted', 'request', p_request_id,
          jsonb_build_object('submission_id', p_submission_id, 'return_id', cur.id, 'revision', rev));

  return jsonb_build_object('request_id', p_request_id, 'submission_id', p_submission_id, 'return_id', cur.id,
                            'status', 'needs_sollelio', 'revision', rev, 'submitted_at', submitted,
                            'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. return_request_to_partner — the message through app.request_trim
-- ---------------------------------------------------------------------------
create or replace function public.cmd_return_request_to_partner(
  p_actor uuid, p_request_id uuid, p_return_id uuid, p_expected_revision integer,
  p_response_type text, p_message text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  req record;
  existing record;
  errs jsonb := '[]'::jsonb;
  msg text := app.request_trim(coalesce(p_message, ''));
  org_status public.organization_status;
  returned timestamptz;
  rev integer;
begin
  perform app.request_require_staff(p_actor);

  if p_return_id is null then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', jsonb_build_array(
      app.request_err('return_id', 'required', 'Falta o identificador da devolução.'))));
  end if;

  select id, organization_id, status, revision, assignee_profile_id
    into req from public.requests where id = p_request_id for update;
  if not found then
    perform app.request_fail('RQ002', 'not_found', jsonb_build_object('entity', 'request'));
  end if;

  select id, request_id, response_type, message, created_by, created_at
    into existing from public.request_returns where id = p_return_id;
  if found then
    if existing.request_id = p_request_id and existing.created_by = p_actor
       and existing.response_type::text = p_response_type and existing.message = msg then
      select (e.metadata ->> 'revision')::integer into rev
        from public.activity_events e
       where e.object_type = 'request' and e.object_id = p_request_id
         and e.event_type = 'request.returned_to_partner' and e.metadata ->> 'return_id' = p_return_id::text;
      return jsonb_build_object('request_id', p_request_id, 'return_id', p_return_id,
                                'response_type', existing.response_type, 'status', 'needs_partner',
                                'revision', rev, 'returned_at', existing.created_at, 'replayed', true);
    end if;
    perform app.request_fail('RQ010', 'idempotency_conflict');
  end if;

  if req.status <> 'needs_sollelio' then
    perform app.request_fail('RQ009', 'invalid_state', jsonb_build_object('status', req.status));
  end if;
  if p_expected_revision is null or req.revision <> p_expected_revision then
    perform app.request_fail('RQ008', 'stale_revision', jsonb_build_object('current_revision', req.revision));
  end if;

  if p_response_type is null or p_response_type not in ('text', 'approval') then
    errs := errs || app.request_err('response_type', 'required', 'Escolha o tipo de resposta: texto ou aprovação.');
  end if;
  if msg = '' then
    errs := errs || app.request_err('message', 'required', 'Escreva o que falta, para a parceira ler.');
  elsif length(msg) > 2000 then
    errs := errs || app.request_err('message', 'too_long', 'No máximo 2000 caracteres.');
  end if;
  if jsonb_array_length(errs) > 0 then
    perform app.request_fail('RQ003', 'validation_failed', jsonb_build_object('errors', errs));
  end if;

  -- A Request never waits on nobody: the organization and the assignee's
  -- membership must still be active.
  select o.status into org_status from public.organizations o where o.id = req.organization_id for share;
  if org_status is distinct from 'active' then
    perform app.request_fail('RQ004', 'organization_not_active', jsonb_build_object('status', org_status));
  end if;
  perform 1 from public.organization_memberships m
   where m.organization_id = req.organization_id and m.profile_id = req.assignee_profile_id
     and m.status = 'active'
   for share;
  if not found then
    perform app.request_fail('RQ005', 'assignee_not_active_member');
  end if;

  returned := clock_timestamp();
  insert into public.request_returns (id, request_id, response_type, message, created_by, created_at)
  values (p_return_id, p_request_id, p_response_type::public.request_return_response_type, msg, p_actor, returned);

  update public.requests set status = 'needs_partner', next_actor = 'partner' where id = p_request_id;
  select revision into rev from public.requests where id = p_request_id;

  insert into public.activity_events (organization_id, actor_profile_id, event_type, object_type, object_id, metadata)
  values (req.organization_id, p_actor, 'request.returned_to_partner', 'request', p_request_id,
          jsonb_build_object('return_id', p_return_id, 'response_type', p_response_type, 'revision', rev));

  return jsonb_build_object('request_id', p_request_id, 'return_id', p_return_id,
                            'response_type', p_response_type, 'status', 'needs_partner',
                            'revision', rev, 'returned_at', returned, 'replayed', false);
end;
$$;
