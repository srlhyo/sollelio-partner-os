-- Slice 2, C3 — structural and privilege assertions. NOT a migration.
--
-- Proves the C3 objects exist in the shape 05_DATA_MODEL_AND_API.md §4, §12 and §13
-- specify, that no API role gained a write, and that `partner_requests` kept its
-- sixteen-column contract (seventeen from C4, which appends `cancellation_reason`).

-- 1. Returns and rounds ---------------------------------------------------------
do $$
declare
  got text[];
begin
  select array_agg(column_name::text order by ordinal_position) into got
    from information_schema.columns where table_schema = 'public' and table_name = 'request_returns';
  if got is distinct from array['id', 'request_id', 'response_type', 'message', 'created_by', 'created_at'] then
    raise exception 'request_returns columns are %', got;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder) into got
    from pg_enum e where e.enumtypid = 'public.request_return_response_type'::regtype;
  if got is distinct from array['text', 'approval'] then
    raise exception 'request_return_response_type is %, expected exactly text, approval', got;
  end if;

  select array_agg(e.enumlabel order by e.enumsortorder) into got
    from pg_enum e where e.enumtypid = 'public.request_approval_decision'::regtype;
  if got is distinct from array['approve', 'needs_changes'] then
    raise exception 'request_approval_decision is %', got;
  end if;

  select array_agg(column_name::text order by column_name) into got
    from information_schema.columns
   where table_schema = 'public' and table_name = 'request_submissions'
     and column_name in ('return_id', 'response_text', 'response_decision', 'response_notes', 'payload_hash');
  if got is distinct from array['payload_hash', 'response_decision', 'response_notes', 'response_text', 'return_id'] then
    raise exception 'request_submissions round columns are %', got;
  end if;

  -- One submission per round, the initial round (NULL) included.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'request_submissions'
       and indexname = 'request_submissions_one_per_round_idx'
       and indexdef ilike '%unique%' and indexdef ilike '%(request_id, return_id)%'
       and indexdef ilike '%nulls not distinct%') then
    raise exception 'The one-submission-per-round unique index is missing or not NULLS NOT DISTINCT.';
  end if;

  -- No return_reply (or any other extra field) is modelled on request_fields.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'request_fields'
                and column_name not in ('id', 'request_id', 'key', 'label', 'help_text', 'type', 'required',
                                        'options', 'sort_order', 'system_generated', 'created_at')) then
    raise exception 'request_fields gained a column in C3.';
  end if;

  -- Append-only triggers and round backstops exist.
  select array_agg(tgname::text order by tgname) into got
    from pg_trigger
   where not tgisinternal
     and tgrelid in ('public.request_returns'::regclass, 'public.request_submissions'::regclass,
                     'public.request_answers'::regclass);
  if got is distinct from array['request_answers_append_only', 'request_answers_assert_initial_round',
                                'request_returns_append_only', 'request_submissions_append_only',
                                'request_submissions_assert_round'] then
    raise exception 'C3 triggers are %', got;
  end if;
end
$$;

-- 2. partner_requests is unchanged; partner_request_returns is a real projection --
do $$
declare
  got text[];
begin
  select array_agg(column_name::text order by ordinal_position) into got
    from information_schema.columns where table_schema = 'public' and table_name = 'partner_requests';
  if got is distinct from array[
    'id', 'organization_id', 'product_id', 'product_name', 'type', 'title', 'context', 'requested_action',
    'estimated_effort_minutes', 'due_at', 'partner_state', 'published_at', 'completed_at', 'cancelled_at',
    'related_update_id', 'resource_id', 'cancellation_reason'] then
    raise exception 'partner_requests is no longer its contract (seventeen columns from C4): %', got;
  end if;

  select array_agg(column_name::text order by ordinal_position) into got
    from information_schema.columns where table_schema = 'public' and table_name = 'partner_request_returns';
  if got is distinct from array['id', 'request_id', 'response_type', 'message', 'created_at'] then
    raise exception 'partner_request_returns columns are %', got;
  end if;

  if not exists (select 1 from pg_class c where c.oid = 'public.partner_request_returns'::regclass
                  and c.relowner = 'postgres'::regrole and c.reloptions @> array['security_barrier=true'])
     or exists (select 1 from pg_class c where c.oid = 'public.partner_request_returns'::regclass
                 and (c.reloptions @> array['security_invoker=true'] or c.reloptions @> array['security_invoker=on'])) then
    raise exception 'partner_request_returns owner/security options are wrong.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.request_returns'::regclass) then
    raise exception 'request_returns has RLS disabled.';
  end if;
  select array_agg(policyname::text order by policyname) into got
    from pg_policies where schemaname = 'public' and tablename = 'request_returns';
  if got is distinct from array['request_returns_select_staff'] then
    raise exception 'request_returns policies are %, expected the staff read only', got;
  end if;
end
$$;

-- 3. Privileges -------------------------------------------------------------------
do $$
declare
  fn text;
  got text[];
begin
  foreach fn in array array[
    'public.cmd_submit_request(uuid, uuid, uuid, uuid, jsonb)',
    'public.cmd_return_request_to_partner(uuid, uuid, uuid, integer, text, text)',
    'public.cmd_complete_request(uuid, uuid, integer)',
    'app.request_submission_hash(uuid, jsonb)',
    'app.request_current_return(uuid)']
  loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '% is executable by an API role.', fn;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = fn::regprocedure and a.grantee = 0) then
      raise exception '% is executable by PUBLIC.', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '% is not executable by service_role.', fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc where proname in ('cmd_submit_request', 'cmd_return_request_to_partner',
                                                      'cmd_complete_request') and prosecdef) then
    raise exception 'A C3 command is SECURITY DEFINER.';
  end if;

  -- The API roles' grants on the whole Request domain, C3 included: reads only,
  -- plus the C1 internal-notes writes for staff.
  select array_agg(g order by g) into got from (
  select format('%s:%s:%s', c.relname, a.grantee::regrole, a.privilege_type) as g
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('requests', 'request_internal_details', 'request_fields', 'request_submissions',
                       'request_answers', 'request_internal_notes', 'activity_events', 'partner_requests',
                       'request_command_receipts', 'request_returns', 'partner_request_returns')
     and a.grantee <> 0 and a.grantee::regrole::text in ('anon', 'authenticated')) x;

  if got is distinct from array[
    'activity_events:authenticated:SELECT', 'partner_request_returns:authenticated:SELECT',
    'partner_requests:authenticated:SELECT', 'request_answers:authenticated:SELECT',
    'request_fields:authenticated:SELECT', 'request_internal_details:authenticated:SELECT',
    'request_internal_notes:authenticated:INSERT', 'request_internal_notes:authenticated:SELECT',
    'request_internal_notes:authenticated:UPDATE', 'request_returns:authenticated:SELECT',
    'request_submissions:authenticated:SELECT', 'requests:authenticated:SELECT'] then
    raise exception 'API role grants on the Request domain changed: %', got;
  end if;

  if has_table_privilege('anon', 'public.partner_request_returns', 'SELECT') then
    raise exception 'anon can read partner_request_returns.';
  end if;
end
$$;

select 'slice 2 C3 schema and privileges verified' as result;
