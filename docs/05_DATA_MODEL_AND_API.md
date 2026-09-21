# Data Model & API Contract — Sollelio Partner OS V0

This document defines the intended V0 model. Implement incrementally by delivery slice; do not create every table in the first migration merely because it is specified here. Section 17 maps every structure to the slice that introduces it.

Identifiers, enum values, table names, command names, code and this documentation are English. All user-facing copy — partner **and** internal — is Portuguese (pt-PT). See `03_UX_SPEC.md §1`.

## 1. Identity and tenancy

### profiles

- id uuid PK
- auth_user_id uuid UNIQUE NOT NULL
- display_name text NOT NULL
- is_sollelio_staff boolean NOT NULL DEFAULT false
- created_at timestamptz
- updated_at timestamptz

A profile cannot exist before its auth user. People are created by inviting the auth user first (Supabase Auth admin invite), then creating the profile bound to the returned `auth_user_id`. This applies to production seeding as well as later onboarding.

`is_sollelio_staff` is never client-writable. See §12.2.

### organizations

- id uuid PK
- name text NOT NULL
- slug text UNIQUE NOT NULL
- status enum(active, inactive, archived)
- created_at
- updated_at
- archived_at nullable

**Archival rule.** Archiving an organization is rejected while it has any Request in `draft`, `needs_partner` or `needs_sollelio`, or any Issue not yet `closed`. Archival never cancels or closes operational work on the organization's behalf: Sollelio must first complete, cancel or close each open item deliberately. Archiving is a statement that the collaboration is finished, not a way to make pending work disappear.

### organization_memberships

- id uuid PK
- organization_id FK
- profile_id FK
- role enum(partner_member) for initial V0
- status enum(active, inactive)
- created_at
- UNIQUE(organization_id, profile_id)

Sollelio staff identity is global and should not be modelled as pretending to belong to every partner organization.

**V0 membership assumption.** The model permits a person to belong to several organizations, and that structure is kept from day one. V0 operationally assumes exactly **one active membership** per partner person. If a partner ever holds more than one, the partner application must present an explicit organization chooser; it must never silently pick one (`03_UX_SPEC.md §2`).

**Deactivation rule.** Setting a membership to `inactive` requires that the person holds no open Requests in that organization. Open Requests must first be reassigned (`reassign_request`) or cancelled (`cancel_request`). The deactivation command rejects the change otherwise, so a `needs_partner` Request can never become invisible to every partner while still counting as pending.

## 2. Products and organization access

### products

- id uuid PK
- key text UNIQUE NOT NULL
- name text NOT NULL
- type enum(application, website, service, other)
- status enum(active, inactive, archived)
- created_at

### organization_products

- id uuid PK
- organization_id FK
- product_id FK
- status enum(active, inactive)
- external_tenant_id nullable
- created_at
- UNIQUE(organization_id, product_id)

`external_tenant_id` is the identifier the integrated product uses for this organization. It is integration data, not partner-facing, and is used for external identity resolution (§14).

There is no `canonical_url` here. Partner-facing canonical URLs live only in `resources` (§3). This table never competes with `resources` as a source of truth for links shown to partners.

## 3. Resources

### resources

- id uuid PK
- organization_id FK NOT NULL
- product_id FK nullable
- name text NOT NULL
- type enum(product, website, folder, document, prototype, other)
- url text NOT NULL
- status enum(active, superseded, archived)
- partner_visible boolean default true
- sort_order integer default 0
- created_by FK profile
- created_at
- updated_at
- archived_at nullable

`resources` is the single source of truth for partner-facing canonical URLs.

Partner queries return only `status = active` AND `partner_visible = true` resources within an organization the partner belongs to.

## 4. Requests

### requests

Internal base table. Partners never select from it (§12.3).

- id uuid PK
- organization_id FK NOT NULL
- product_id FK nullable
- type enum(review, approval, question, test, task)
- status enum(draft, needs_partner, needs_sollelio, completed, cancelled)
- next_actor enum(partner, sollelio, none)
- title text NOT NULL
- context text nullable
- requested_action text NOT NULL
- estimated_effort_minutes integer NOT NULL
- assignee_profile_id FK NOT NULL
- due_at nullable
- related_update_id nullable
- related_issue_id nullable
- created_by FK NOT NULL
- created_at
- published_at nullable
- completed_at nullable
- cancelled_at nullable
- updated_at

V0 has no `in_progress` and no `blocked` state. Every non-terminal state has exactly one unambiguous next actor, as required by `01_PRODUCT_SPEC.md §5` and `02_OPERATING_MODEL.md §3`. Reintroduce additional states only when a real pilot Request cannot be represented.

Consistency rules (enforced by check constraints and by the domain commands):

- `draft` => `next_actor = none` AND `published_at IS NULL`;
- `needs_partner` => `next_actor = partner` AND `published_at IS NOT NULL`;
- `needs_sollelio` => `next_actor = sollelio` AND `published_at IS NOT NULL`;
- `completed` => `next_actor = none` AND `completed_at IS NOT NULL`;
- `cancelled` => `next_actor = none` AND `cancelled_at IS NOT NULL`;
- `assignee_profile_id` must be a profile with an **active** membership in `organization_id`.

**Effort storage.** `estimated_effort_minutes` is an integer. The `<1 min` scale from `02_OPERATING_MODEL.md §2` is stored as `1` and rendered as `<1 min`, never as `1 min`. Zero is not a valid value.

### request_internal_details

Internal-only 1:1 extension. No partner access, in any form.

- request_id PK/FK
- completion_criteria text NOT NULL
- internal_owner_profile_id FK nullable
- priority enum(normal, important, urgent) NOT NULL default normal
- updated_by FK nullable
- updated_at

Completion criteria, internal ownership and priority are operational judgements. They are structurally outside the partner-readable shape rather than filtered out by a serializer.

### request_fields

- id uuid PK
- request_id FK
- key text
- label text
- help_text nullable
- type enum(long_text, single_choice, boolean, approval)
- required boolean
- options jsonb nullable
- sort_order integer
- system_generated boolean NOT NULL default false
- created_at
- UNIQUE(request_id, key)

V0 field types are limited to what the partner UX actually renders (`03_UX_SPEC.md §5–7`). `short_text`, `multi_choice` and `rating` are not V0 types; add one only when a concrete Request needs it.

**Approval Requests.** `create_request` with `type = approval` generates two system fields automatically:

- `approval` — type `approval`, required, options `approve` / `needs_changes`;
- `approval_notes` — type `long_text`, not required, revealed by the UI only after `needs_changes`.

Authors do not hand-build approval fields. There is exactly one approval mechanism.

### request_submissions

- id uuid PK
- request_id FK
- submitted_by FK profile
- source enum(partner_os, whatsapp_capture, internal_capture, integration)
- created_at

Submissions are append-only and ordered by `created_at`. A Request returned to the partner produces a new submission; earlier submissions are never modified.

### request_answers

- id uuid PK
- submission_id FK
- request_field_id FK
- value jsonb NOT NULL
- created_at

### request_internal_notes

- id uuid PK
- request_id FK
- author_profile_id FK
- content text
- created_at
- updated_at

No partner access.

## 5. Updates

### updates

- id uuid PK
- product_id FK nullable
- type enum(new, improved, fixed, changed, important_notice)
- status enum(draft, published, archived)
- impact enum(no_action, action_recommended, action_required)
- title text NOT NULL
- partner_summary text NOT NULL
- partner_details text nullable
- requires_acknowledgement boolean default false
- created_by FK
- created_at
- published_at nullable
- archived_at nullable

An Update has no `organization_id`. Audience is expressed only through `update_audiences`.

### update_audiences

- id uuid PK
- update_id FK
- organization_id FK
- UNIQUE(update_id, organization_id)

### update_receipts

- id uuid PK
- update_id FK
- profile_id FK
- seen_at nullable
- acknowledged_at nullable
- UNIQUE(update_id, profile_id)

Acknowledged implies Seen. The uniqueness constraint makes `mark_update_seen` and `acknowledge_update` naturally idempotent; no additional idempotency mechanism is required for them.

A single Update may have separate related Requests per partner through `requests.related_update_id`.

Acknowledgement-required Updates belong to the Updates indicator. They are never counted in the attention count (§12.3, `03_UX_SPEC.md §19`).

## 6. Issues

### issues

Internal base table. Partners never select from it (§12.3).

- id uuid PK
- organization_id FK NOT NULL
- product_id FK nullable
- reporter_profile_id FK NOT NULL
- status enum(reported, triaging, investigating, needs_partner, resolved, closed)
- classification enum(unknown, bug, ux_confusion, data_issue, feature_request, expected_behaviour, outdated_url_or_version, already_resolved, other)
- priority enum(normal, important, urgent)
- source enum(partner_os, sollelio_events_v1, whatsapp_capture, internal_capture, other_integration)
- internal_owner_profile_id nullable
- idempotency_key text nullable
- partner_followup_at timestamptz nullable
- reported_at
- resolved_at nullable
- closed_at nullable
- updated_at

There is no `title`, no `raw_report_text` and no `partner_visible_resolution` column. The original report and the partner-facing resolution live in `issue_messages` (below), which is the append-only source of truth for both. Internal Issue lists scan on the first report message, truncated.

`classification` and `priority` are internal triage judgements and are never exposed to the partner (`01_PRODUCT_SPEC.md §7`).

`reporter_profile_id` is the person whose experience is being reported, not necessarily the person who typed it. For `source = whatsapp_capture` it is the partner who reported the problem; the Sollelio staff member performing the capture is recorded in `activity_events.actor_profile_id`. The reporter need not be a member of the organization (Sollelio-originated `internal_capture`), so no membership constraint is placed on this column.

`idempotency_key` is set only by integration-created Issues. Constraint: `UNIQUE (source, idempotency_key)` as a partial index `WHERE idempotency_key IS NOT NULL`. V0 introduces no general idempotency table.

`partner_followup_at` is the visible internal signal described in §13: it is set when a partner replies to an Issue that is already `resolved` or `closed`. It does not change `status`. It is cleared by `reopen_issue`, by `close_issue`, or by `acknowledge_issue_followup` — the last being the case where Sollelio has read the reply and answered it, and no further investigation is warranted.

### issue_contexts

- id uuid PK
- issue_id FK UNIQUE
- route nullable
- url nullable
- environment nullable
- client_version nullable
- external_context_type nullable
- external_context_id nullable
- external_context_url nullable
- metadata jsonb nullable
- created_at

No partner access. Metadata must not become a dumping ground for copied sensitive product data.

### issue_messages

Append-only. Source of truth for the original report and for all resolution communication.

- id uuid PK
- issue_id FK
- author_profile_id nullable
- visibility enum(partner, internal)
- type enum(report, reply, clarification_request, clarification_response, resolution, system)
- content nullable
- created_at

Rules:

- exactly one message of `type = report` per Issue, written by `report_issue`, `visibility = partner`, never edited or deleted;
- the partner-facing resolution is the most recent `type = resolution`, `visibility = partner` message;
- partner access requires an accessible Issue AND `visibility = partner` (§12.3).

### issue_internal_details

- issue_id PK/FK
- reproduction_notes nullable
- root_cause nullable
- internal_resolution nullable
- product_implication nullable
- updated_by nullable
- updated_at

No partner access.

## 7. Media

### media_assets

- id uuid PK
- owner_scope enum(organization, sollelio) NOT NULL
- organization_id FK nullable
- storage_bucket
- storage_path
- status enum(pending, ready) NOT NULL default pending
- type enum(image, audio, video, file)
- mime_type
- size_bytes nullable
- duration_seconds nullable
- width nullable
- height nullable
- uploaded_by nullable
- created_at

Ownership is explicit:

- `owner_scope = organization` => `organization_id` NOT NULL. Partner-originated evidence (screenshots, voice notes) and organization-specific media.
- `owner_scope = sollelio` => `organization_id` NULL. Sollelio-produced media, including Update assets shared by several organizations.

**Authorization rule.** Access is never granted by matching `media_assets.organization_id` alone. An asset is readable by a partner when it is linked to an object that partner can access:

- `request_media` => the linked Request is partner-accessible;
- `issue_media` => the linked Issue is partner-accessible;
- `update_media` => the linked Update is published AND its `update_audiences` includes an organization the partner belongs to.

A cross-organization Update therefore authorizes its media through audience, not by pretending the asset belongs to one tenant.

Link tables:

- request_media(request_id, media_asset_id, purpose)
- update_media(update_id, media_asset_id, purpose)
- issue_media(issue_id, media_asset_id, purpose)

### Storage convention

Private bucket, no public objects, no anonymous access. Clients never read or write storage directly; all access is through short-lived signed URLs issued by a server-side command after the authorization check above.

Path convention:

- organization-owned: `org/{organization_id}/{yyyy}/{uuid}`
- Sollelio-owned: `sollelio/{yyyy}/{uuid}`

Media may be uploaded before the object it will be attached to exists (audio recorded before an Issue is submitted). Such assets remain `status = ready` with no link row. Orphaned pre-submit uploads are acceptable in V0; no cleanup job is required yet.

## 8. Activity

### activity_events

- id uuid PK
- organization_id FK
- actor_profile_id nullable
- event_type text
- object_type enum(request, update, issue, resource, organization)
- object_id uuid
- metadata jsonb nullable
- created_at

Activity is history/audit support, not event sourcing and not the primary state store. Every row is written server-side by a domain command. No client inserts rows, and partners have no access to this table.

Publishing an Update writes one row per audience organization.

V0 event types:

- request.created
- request.published
- request.submitted
- request.returned_to_partner
- request.reassigned
- request.completed
- request.cancelled
- update.published
- update.seen
- update.acknowledged
- issue.reported
- issue.classified
- issue.status_changed
- issue.clarification_requested
- issue.clarification_received
- issue.resolved
- issue.reopened
- issue.closed
- issue.partner_followup
- resource.created
- resource.superseded
- resource.opened
- issue.followup_acknowledged
- organization.archived

`resource.opened` is written by the narrow `record_resource_opened` command (§13). It exists because “are the canonical links actually being used?” is a pilot question we cannot answer any other way (`07_DO_LUXO_A_MESA_PILOT.md §14`).

`request.viewed` and `update.viewed` are **not** V0 event types. No command writes them. Generic per-object view tracking is not reintroduced: it produces volume without answering a question anyone is asking.

## 9. Notifications

`notification_intents` is deferred in V0. See §16.

## 10. AI operations

`ai_runs` is deferred to Slice 7. See §16.

## 11. External identities

Introduced in Slice 5, not before.

### external_identities

- id uuid PK
- profile_id FK
- product_id FK
- provider text
- external_subject text
- created_at
- UNIQUE(product_id, provider, external_subject)

Maps an Events V1 user to the same Partner OS person without requiring immediate universal SSO.

## 12. Authorization contract

### 12.1 Baseline

- RLS is **enabled on every table** in the schema. The default is **deny**.
- The only partner-reachable paths are the policies and projections listed in this section. Anything not listed here has **no partner access**.
- Staff checks in policies use a single `SECURITY DEFINER STABLE` helper, `app.is_staff()`, which resolves the calling auth user to a profile and returns `is_sollelio_staff`. Policies never subquery `profiles` directly, which would recurse on the `profiles` policy itself and would re-evaluate per row.
- `app.is_staff()` is owned by a privileged role, has a pinned `search_path`, and is the only staff-resolution mechanism.
- The service-role credential never reaches the browser.

### 12.2 profiles

- Partner may SELECT their own profile row only.
- Partner may UPDATE their own row through a column-limited grant covering `display_name` only. `GRANT UPDATE (display_name) ON profiles`; no table-wide UPDATE grant exists.
- `is_sollelio_staff` is settable only by a staff-only command or by direct privileged administration. Self-escalation must be impossible even with a crafted request. This has a release-blocking security test (`06_BUILD_PLAN.md`).

### 12.3 Partner read projections

Partners **never** SELECT the `requests`, `issues` or `updates` base tables. RLS in PostgreSQL is row-level, not column-level: granting SELECT on those tables would expose internal columns regardless of policy predicates.

Partner reads go through explicit projections — PostgreSQL views created `WITH (security_barrier = true)`, owned by a privileged role, with `security_invoker` left off so the view's own predicate governs access. Each view carries its own membership/assignment predicate, and `SELECT` is granted on the view, not on the base table. An equivalent server-side read model (Edge Function returning the same shape) is acceptable; the column set is the contract, not the transport.

**`partner_requests`** — predicate: `published_at IS NOT NULL` AND `assignee_profile_id` = calling profile AND active membership in `organization_id`. Columns:

- id, organization_id, product_id, product_name
- type, title, context, requested_action
- estimated_effort_minutes, due_at
- partner_state enum(needs_you, with_sollelio, done, cancelled) derived from `status`
- published_at, completed_at, cancelled_at
- related_update_id

Excluded: `status`, `next_actor`, `assignee_profile_id`, `created_by`, and everything in `request_internal_details`.

**`partner_issues`** — predicate: `reporter_profile_id` = calling profile AND active membership in `organization_id`. Columns:

- id, organization_id, product_id, product_name
- partner_state enum(checking, needs_you, resolved, closed) derived from `status`
- reported_at, resolved_at, closed_at

Excluded: `classification`, `priority`, `internal_owner_profile_id`, `source`, `idempotency_key`, `partner_followup_at`, `reporter_profile_id`.

**`partner_updates`** — predicate: `status = published` AND `update_audiences` includes an organization the partner has an active membership in. Columns:

- id, product_id, product_name
- type, impact, title, partner_summary, partner_details
- requires_acknowledgement, published_at

Excluded: `status`, `created_by`, `archived_at`, audience composition.

### 12.4 Table-by-table partner access

| Table | Partner access |
| --- | --- |
| profiles | SELECT own row; UPDATE `display_name` only (§12.2) |
| organizations | SELECT where the partner has an active membership |
| organization_memberships | SELECT own rows only |
| products | **No access.** Product name is projected into the partner views |
| organization_products | **No access** (contains `external_tenant_id`) |
| resources | SELECT where active membership AND `status = active` AND `partner_visible = true` |
| requests | **No access.** Read via `partner_requests` |
| request_internal_details | **No access** |
| request_fields | SELECT where the parent Request is visible through `partner_requests` |
| request_submissions | SELECT own submissions on a Request visible through `partner_requests` |
| request_answers | SELECT where the parent submission is accessible |
| request_internal_notes | **No access** |
| updates | **No access.** Read via `partner_updates` |
| update_audiences | **No access** |
| update_receipts | SELECT own rows. Writes only via commands |
| issues | **No access.** Read via `partner_issues` |
| issue_contexts | **No access** |
| issue_messages | SELECT where the Issue is visible through `partner_issues` AND `visibility = partner`. Writes only via commands |
| issue_internal_details | **No access** |
| media_assets | **No direct access.** Reads are short-lived signed URLs issued by a command after the §7 authorization check |
| request_media / update_media / issue_media | **No direct access** |
| activity_events | **No direct access.** The only partner-initiated write is `record_resource_opened`, executed server-side |
| external_identities | **No access** |
| storage objects | **No direct access.** Private bucket, signed URLs only |

Deferred structures (`notification_intents`, `ai_runs`) inherit the same baseline when introduced: RLS enabled, no partner access.

### 12.5 Lifecycle writes

Partners do not update lifecycle columns on any object. Every partner-initiated state change goes through a domain command (§13). This has a release-blocking security test.

### 12.6 Issue visibility scope

V0 Issue visibility is **reporter-only**: a partner sees the Issues they reported, not those reported by colleagues in the same organization. Expand to organization-wide visibility only if real use requires it.

## 13. Domain commands

Commands validate the caller's permission and the object's current state, write the resulting Activity, and are transactional where practical. Privileged commands run in Supabase Edge Functions (`04_TECHNICAL_ARCHITECTURE.md §2`).

### Request commands

- `create_request` — for `type = approval`, generates the system approval fields (§4).
- `publish_request` — draft => needs_partner.
- `submit_request` — needs_partner => needs_sollelio. **Validates the whole submission atomically server-side**: every required field answered, each answer's shape matching its `request_fields.type`, and every `single_choice` value a member of that field's `options`. A submission that fails any check is rejected in full; no partial answers are written.
- `return_request_to_partner` — needs_sollelio => needs_partner. Requires a new question or action.
- `reassign_request` — changes `assignee_profile_id`. Target must hold an active membership in the Request's organization.
- `complete_request` — => completed.
- `cancel_request` — => cancelled.

There is no `start_request`.

### Update commands

- `create_update`
- `publish_update`
- `mark_update_seen`
- `acknowledge_update`
- `archive_update`

### Issue commands

- `report_issue` — requires at least report text **or** at least one attached media asset. An Issue with neither is rejected. Writes the single `type = report` message.
- `start_triage`
- `classify_issue`
- `request_issue_clarification` — => needs_partner; writes a `clarification_request` message.
- `submit_issue_clarification` — partner-callable. needs_partner => investigating; writes a `clarification_response` message.
- `reply_to_issue` — appends a message without changing status. When the caller is the partner and the Issue is `resolved` or `closed`, it additionally sets `partner_followup_at` and writes `issue.partner_followup`. It never auto-reopens.
- `start_investigation`
- `resolve_issue` — => resolved; writes the partner-facing `resolution` message.
- `acknowledge_issue_followup` — **staff only**. Clears `partner_followup_at` without changing `status`, for the case where the partner's reply has been read and answered and no further investigation is warranted. Writes `issue.followup_acknowledged`. It is not a substitute for reopening.
- `reopen_issue` — **staff only**. resolved | closed => investigating; clears `partner_followup_at`. This remains the explicit path whenever investigation must actually resume.
- `close_issue` — **staff only**, manual. There is no auto-close in V0. Clears `partner_followup_at`.

### Resource commands

- `record_resource_opened(resource_id)` — partner-callable, narrow by design. Verifies the Resource is visible to the caller and writes one `resource.opened` Activity row. It takes no other payload and touches no other object. This is the only partner-initiated Activity write in V0.

### Media commands

- `create_media_upload_url` — authorizes the caller, creates a `media_assets` row with `status = pending` and the §7 path, returns a short-lived signed upload URL.
- `confirm_media_upload` — marks the asset `ready` and records size/duration/dimensions.

### Organization and membership commands

- `archive_organization` — rejects the change while the organization has any Request in `draft`, `needs_partner` or `needs_sollelio`, or any Issue not `closed`. It never cancels or closes work implicitly (§1). Writes `organization.archived`.
- `deactivate_membership` — rejects the change while the person holds open Requests in that organization (§1).

## 14. Events V1 API contract

All `/v1/*` endpoints run in Supabase Edge Functions and are server-to-server only.

### GET /v1/partner-context

Purpose: return the minimal embedded state needed by Events V1.

Request parameters: `externalUserId`, `externalOrganizationId`, `productKey`.

Response:

```json
{
  "attentionCount": 2,
  "newUpdatesCount": 1,
  "partnerHubUrl": "https://..."
}
```

- `attentionCount` = open Requests with `next_actor = partner` **plus** Issues with `status = needs_partner`, for the resolved person.
- `newUpdatesCount` is a separate indicator. Acknowledgement-required Updates are counted here, never in `attentionCount`.
- Partner effort totals are a Partner OS Home concern and are calculated from Requests only; this endpoint does not return an effort total.

**Availability contract.** Events calls this with a short timeout (approximately 1 second) and **fails open**: on timeout, error or any non-200, Events renders without the indicators and logs the failure. The response may be cached for approximately 60 seconds. This call must never sit on a blocking path for core Events functionality (`04_TECHNICAL_ARCHITECTURE.md §4`).

### POST /v1/issues

Purpose: create a contextual Partner OS Issue from Events V1.

```json
{
  "externalUserId": "...",
  "externalOrganizationId": "...",
  "productKey": "sollelio-events-v1",
  "message": "...",
  "context": {
    "route": "/events/123",
    "externalContextType": "event",
    "externalContextId": "123",
    "url": "...",
    "clientVersion": "..."
  },
  "idempotencyKey": "..."
}
```

**External identity resolution.** Partner OS performs, in order:

1. resolve the product by `productKey`;
2. resolve the person: `external_identities` on `(product_id, provider, external_subject = externalUserId)`;
3. resolve the organization: `organization_products` on `(product_id, external_tenant_id = externalOrganizationId)`, with `status = active`;
4. verify the resolved person holds an **active** membership in the resolved organization.

If any step fails, return **403** and **write nothing** — no Issue, no context, no Activity row, no partial state. The endpoint never creates an Issue for an unmapped user or for an organization the user does not belong to.

On success Partner OS creates the Issue (`source = sollelio_events_v1`, `reporter_profile_id` = the resolved person), the `issue_contexts` row, the `type = report` message and the Activity row, then returns:

```json
{
  "issueId": "...",
  "status": "reported",
  "partnerMessage": "Recebemos. Vamos verificar."
}
```

`idempotencyKey` is stored on the Issue (§6). A repeat with the same key returns the original `issueId` without creating a second Issue.

### POST /v1/issues/{issueId}/media-upload-url

Slice 5 contextual reporting supports **text, screenshot/image and audio**.

Video and screen recording are deferred. The trigger for adding them is evidence, not preference: a real case where the supported formats caused material clarification friction — an exchange that needed several rounds because the partner could not show movement. Until that happens, `media_assets.type = video` exists for Sollelio-produced Update media only.

Request: `contentType`, `sizeBytes`, `type` (`image` | `audio`).

Response: `mediaAssetId`, `uploadUrl` (short-lived signed URL), `expiresAt`.

The client uploads the bytes directly to the signed URL, then Events calls `POST /v1/issues/{issueId}/media/{mediaAssetId}/confirm` to mark the asset ready and link it.

Events V1 never holds Partner OS storage credentials and never receives a service-role key. Short-lived signed upload URLs are the only write path into Partner OS Storage from outside.

### GET /v1/updates/contextual

Later V0 capability for contextual Updates. Not required before core Issue integration works.

## 15. Integration authentication

V0 uses a **server-side shared secret** presented as a bearer token by the Events V1 backend on every `/v1/*` call.

- The secret is stored only in environment variables, per environment, on the Partner OS Edge Function side and the Events backend side.
- It is never shipped to any browser and never placed in client configuration.
- Rotation is performed by changing the environment variable in both systems.
- V0 introduces no integration-credential table; there is exactly one integration.

## 16. Deferred structures

Not built in V0 until the stated trigger:

- **`notification_intents`** — deferred until a real reminder or delivery workflow exists. No V0 surface reads it (`03_UX_SPEC.md §12–13` has no notifications surface, and a generic notification inbox is excluded by the design brief). Writing a table nothing reads is administrative work, which `02_OPERATING_MODEL.md §17` tells us to avoid.
- **`ai_runs`** — deferred to Slice 7, with the AI capability it supports.
- **`external_identities`** — defined in §11, introduced in Slice 5, not before.

## 17. Migration waves aligned to delivery slices

Each wave corresponds exactly to one slice in `06_BUILD_PLAN.md`. Do not create a later wave's tables early.

### Wave 1 — Slice 1 (Organizations, Products, Resources)

- profiles
- organizations
- organization_memberships
- products
- organization_products
- resources
- `app.is_staff()` helper; RLS enabled with default deny on all of the above

### Wave 2 — Slice 2 (Requests end-to-end)

- requests
- request_internal_details
- request_fields
- request_submissions
- request_answers
- request_internal_notes
- activity_events
- `partner_requests` projection
- `record_resource_opened` — canonical-resource instrumentation begins here, since it needs `activity_events`. Resources themselves ship in Slice 1; their open-tracking starts one slice later.

### Wave 3 — Slice 3 (Updates)

- updates
- update_audiences
- update_receipts
- media_assets + update_media
- `partner_updates` projection
- `profiles.last_seen_at` and `profiles.previous_seen_at` with the `record_partner_visit` command, introduced with the Home "Since last visit" block (`03_UX_SPEC.md §11`)

### Wave 4 — Slice 4 (Issues)

- issues
- issue_contexts
- issue_messages
- issue_internal_details
- issue_media, request_media
- `partner_issues` projection

### Wave 5 — Slice 5 (Events V1 contextual Issue integration)

- external_identities
- `issues.idempotency_key` partial unique index

### Later

- notification_intents — when a reminder/delivery workflow exists
- ai_runs — Slice 7
