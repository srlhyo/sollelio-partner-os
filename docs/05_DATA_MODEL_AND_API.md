# Data Model & API Contract — Sollelio Partner OS V0

This document defines the intended V0 model. Implement incrementally by delivery slice; do not create every table in the first migration merely because it is specified here.

## 1. Identity and tenancy

### profiles

- id uuid PK
- auth_user_id uuid UNIQUE NOT NULL
- display_name text NOT NULL
- is_sollelio_staff boolean NOT NULL DEFAULT false
- created_at timestamptz
- updated_at timestamptz

### organizations

- id uuid PK
- name text NOT NULL
- slug text UNIQUE NOT NULL
- status enum(active, inactive, archived)
- created_at
- updated_at
- archived_at nullable

### organization_memberships

- id uuid PK
- organization_id FK
- profile_id FK
- role enum(partner_member) for initial V0
- status enum(active, inactive)
- created_at
- UNIQUE(organization_id, profile_id)

Sollelio staff identity is global and should not be modelled as pretending to belong to every partner organization.

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
- canonical_url nullable
- external_tenant_id nullable
- created_at
- UNIQUE(organization_id, product_id)

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

Partner queries return only active + partner-visible resources.

## 4. Requests

### requests

- id uuid PK
- organization_id FK NOT NULL
- product_id FK nullable
- type enum(review, approval, question, test, task)
- status enum(draft, needs_partner, in_progress, needs_sollelio, blocked, completed, cancelled)
- next_actor enum(partner, sollelio, none)
- title text NOT NULL
- context text nullable
- requested_action text NOT NULL
- estimated_effort_minutes integer NOT NULL
- completion_criteria text NOT NULL
- assignee_profile_id FK NOT NULL
- internal_owner_profile_id FK nullable
- priority enum(normal, important, urgent) default normal
- due_at nullable
- related_update_id nullable
- related_issue_id nullable
- created_by FK NOT NULL
- created_at
- published_at nullable
- completed_at nullable
- cancelled_at nullable
- updated_at

Important consistency rules:

- completed/cancelled => next_actor = none;
- needs_partner => next_actor = partner;
- needs_sollelio => next_actor = sollelio;
- completed => completed_at set.

### request_fields

- id uuid PK
- request_id FK
- key text
- label text
- help_text nullable
- type enum(short_text, long_text, single_choice, multi_choice, boolean, approval, rating)
- required boolean
- options jsonb nullable
- sort_order integer
- created_at
- UNIQUE(request_id, key)

### request_submissions

- id uuid PK
- request_id FK
- submitted_by FK profile
- source enum(partner_os, whatsapp_capture, internal_capture, integration)
- supersedes_submission_id nullable
- created_at

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

Acknowledged implies Seen.

A single Update may have separate related Requests per partner through `requests.related_update_id`.

## 6. Issues

### issues

- id uuid PK
- organization_id FK NOT NULL
- product_id FK nullable
- reporter_profile_id FK NOT NULL
- status enum(reported, triaging, investigating, needs_partner, resolved, closed)
- classification enum(unknown, bug, ux_confusion, data_issue, feature_request, expected_behaviour, outdated_url_or_version, already_resolved, other)
- priority enum(normal, important, urgent)
- source enum(partner_os, sollelio_events_v1, whatsapp_capture, internal_capture, other_integration)
- title nullable
- raw_report_text nullable
- internal_owner_profile_id nullable
- partner_visible_resolution nullable
- reported_at
- resolved_at nullable
- closed_at nullable
- updated_at

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

Metadata must not become a dumping ground for copied sensitive product data.

### issue_messages

- id uuid PK
- issue_id FK
- author_profile_id nullable
- visibility enum(partner, internal)
- type enum(report, reply, clarification_request, clarification_response, resolution, system)
- content nullable
- created_at

Partner access requires accessible Issue + visibility=partner.

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
- organization_id FK
- storage_bucket
- storage_path
- type enum(image, audio, video, file)
- mime_type
- size_bytes
- duration_seconds nullable
- width nullable
- height nullable
- uploaded_by nullable
- created_at

Link tables:

- request_media(request_id, media_asset_id, purpose)
- update_media(update_id, media_asset_id, purpose)
- issue_media(issue_id, media_asset_id, purpose)

Prefer private storage and authorized/signed access.

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

Activity is history/audit support, not event sourcing and not the primary state store.

Example events:

- request.created
- request.published
- request.viewed
- request.submitted
- request.completed
- update.published
- update.viewed
- update.acknowledged
- issue.reported
- issue.classified
- issue.status_changed
- issue.resolved
- resource.opened

## 9. Notifications

### notification_intents

- id uuid PK
- organization_id FK
- recipient_profile_id FK
- type
- priority
- object_type
- object_id
- status enum(pending, sent_manual, dismissed)
- created_at
- sent_at nullable

This stores notification intent even while WhatsApp delivery remains manual.

## 10. AI operations

### ai_runs

- id uuid PK
- organization_id FK
- operation enum(transcription, issue_summary, issue_classification, request_copy, update_copy)
- source_object_type
- source_object_id
- provider
- model
- status
- input_reference jsonb nullable
- output jsonb nullable
- reviewed_by nullable
- reviewed_at nullable
- created_at
- completed_at nullable

Original evidence remains separate.

## 11. External identities

### external_identities

- id uuid PK
- profile_id FK
- product_id FK
- provider text
- external_subject text
- created_at
- UNIQUE(product_id, provider, external_subject)

Used to map an Events V1 user to the same Partner OS person without requiring immediate universal SSO.

## 12. RLS / authorization contract

### Organizations

Partner may select only organizations where they have an active membership.

### Requests

Partner may select only published/non-draft Requests assigned to them within an organization they belong to.

Partner does not directly update lifecycle columns; submission goes through a domain command.

### Request internal notes

No partner access.

### Updates

Partner may select only published Updates whose audience includes an organization they belong to.

### Issues

Initial V0 default: partner may select Issues they reported within an organization they belong to. Expand to organization-wide visibility only if real use requires it.

### Issue messages

Partner may select only partner-visible messages on an accessible Issue.

### Issue internal details

No partner access.

## 13. Domain commands

Request commands:

- create_request
- publish_request
- start_request
- submit_request
- return_request_to_partner
- complete_request
- cancel_request

Update commands:

- create_update
- publish_update
- mark_update_seen
- acknowledge_update
- archive_update

Issue commands:

- report_issue
- start_triage
- classify_issue
- request_issue_clarification
- reply_to_issue
- start_investigation
- resolve_issue
- close_issue

These may be implemented as application services, RPCs or Edge/server functions. The contract matters more than the transport.

## 14. Events V1 API contract

### GET /v1/partner-context

Purpose: return the minimal embedded state needed by Events V1.

Response shape:

```json
{
  "attentionCount": 2,
  "newUpdatesCount": 1,
  "partnerHubUrl": "https://..."
}
```

Optionally include up to a small number of actionable preview items if useful.

### POST /v1/issues

Purpose: create a contextual Partner OS Issue from Events V1.

Conceptual request:

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

Partner OS authenticates the integration, resolves external identity/organization, validates the relationship, creates the Issue + context + Activity and returns:

```json
{
  "issueId": "...",
  "status": "reported",
  "partnerMessage": "Received. We’ll check this."
}
```

### GET /v1/updates/contextual

Later V0 capability for contextual Updates. Not required before core Issue integration works.

## 15. Integration authentication

Privileged integration calls should be server-to-server. Do not ship Partner OS integration secrets to the Events browser.

## 16. Idempotency

Integration-facing create/acknowledge operations should support idempotency keys so network retries do not create duplicate Issues or acknowledgements.

## 17. Incremental migration order

### First functional schema

- profiles
- organizations
- organization_memberships
- products
- organization_products
- resources
- requests
- request_fields
- request_submissions
- request_answers
- request_internal_notes
- activity_events

### Second

- updates
- update_audiences
- update_receipts
- update_media/media support

### Third

- issues
- issue_contexts
- issue_messages
- issue_internal_details
- issue_media
- external_identities

Create later tables only when the active delivery slice needs them.
