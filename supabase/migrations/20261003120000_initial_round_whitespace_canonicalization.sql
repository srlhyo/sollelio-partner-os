-- Initial-round whitespace canonicalization (follow-up to 20260930160000).
--
-- 05_DATA_MODEL_AND_API.md §13 (submit_request, initial round). The previous hardening
-- moved the returned-round values to `app.request_trim` (C4's canonical helper, which
-- trims every whitespace character at either end, as the client's String.trim() does)
-- and left the initial round on plain btrim(), which strips only the ASCII space. This
-- migration redefines `cmd_submit_request` with only the initial-round changes:
--
--   1. long_text — trimmed with app.request_trim: a value of only line breaks, tabs,
--      no-break or other Unicode spaces is not an answer (required → `required`;
--      optional → no answer row); padded text is stored canonical; the 4000 limit
--      applies to the trimmed value.
--   2. single_choice — the option is found first exactly as in C3 (equal to the value
--      trimmed of spaces), then, only if none is, as the single option equal to the
--      value under app.request_trim (never for a whitespace-only value). The stored
--      value is the configured option. Options are stored btrim()-trimmed by C2, so
--      they are not guaranteed canonical under app.request_trim; matching exactly
--      first keeps every answer accepted today accepted, with the same stored value.
--
-- Deliberately unchanged: app.request_submission_hash (the replay identity of stored
-- submissions — btrim() is stricter than app.request_trim, never looser, so it never
-- replays a semantically different payload); the approval field; the returned round;
-- option authoring. CREATE OR REPLACE keeps the owner, grants and signature. No
-- table-data UPDATE: stored submissions and answers are not rewritten.

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
  choice text;
  matches integer;
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
              s := app.request_trim(val #>> '{}');
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
            else
              -- The option the answer names: the one equal to the value trimmed of
              -- spaces (as in C3), else the single option equal to it under
              -- app.request_trim, when that is not empty. Stored as configured.
              choice := (select min(o) from jsonb_array_elements_text(coalesce(f.options, '[]'::jsonb)) o
                          where o = btrim(val #>> '{}'));
              if choice is null and app.request_trim(val #>> '{}') <> '' then
                select min(o), count(*) into choice, matches
                  from jsonb_array_elements_text(coalesce(f.options, '[]'::jsonb)) o
                 where app.request_trim(o) = app.request_trim(val #>> '{}');
                if matches <> 1 then
                  choice := null;
                end if;
              end if;
              if choice is null then
                errs := errs || app.request_err(path, 'invalid_option', 'Escolha uma das opções.');
              else
                norm := norm || jsonb_build_array(jsonb_build_object('field_id', fid, 'value', to_jsonb(choice)));
              end if;
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
