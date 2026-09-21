# Technical Architecture — Sollelio Partner OS V0

## 1. Architecture style

Use a **modular monolith**.

Do not introduce microservices, event buses, Kafka, Kubernetes, event sourcing or separate databases per organization in V0.

## 2. High-level stack

- Frontend: React + TypeScript.
- Hosting: Netlify hosts the SPA only, unless implementation uncovers a concrete blocker.
- Backend platform: dedicated Supabase project for Partner OS.
- Database: PostgreSQL.
- Authentication: Supabase Auth, magic link / email OTP (§20).
- Authorization: organization-aware server-side rules, RLS enabled everywhere with default deny, and explicit partner projections (§7).
- Media: private Supabase Storage for small/operational assets; external Resources such as Google Drive for large/shared libraries.
- Server-side execution: **Supabase Edge Functions**.

### Where server-side code runs

All privileged server-side logic runs in Supabase Edge Functions:

- every domain command that requires elevation beyond the caller's own RLS reach;
- every `/v1/*` integration endpoint.

Netlify serves the static SPA and nothing else. Partner OS does not run privileged logic in Netlify Functions.

Trade-off, stated deliberately: Edge Functions need their own deploy step in CI and a second runtime context, whereas Netlify Functions would live inside the same build. We accept that cost so that the service-role credential and the integration shared secret exist in exactly one place, and so that integration URLs stay stable independently of the frontend host.

## 3. Product boundary

Partner OS is its own system and Supabase project.

Do not place Partner OS tables inside the Sollelio Events V1 database.

Sollelio Events V1 integrates with Partner OS through an explicit API/application boundary and must not query Partner OS tables directly.

## 4. Availability boundary

Sollelio Events V1 remains independently operational if Partner OS is unavailable.

Partner OS downtime may temporarily affect:

- partner attention indicators;
- partner Updates;
- Partner OS issue reporting.

It must not prevent core Events operations such as event/client/payment management.

**Fail-open requirement.** `GET /v1/partner-context` is called with a short timeout (approximately 1 second) and fails open: on timeout or error, Events renders without the indicators and logs the failure. No Partner OS call may sit on a blocking path for core Events functionality. Where Partner OS issue reporting is unavailable, Events shows a human fallback rather than a broken action.

## 5. Frontend structure

A single web application may contain two main surfaces:

- `/partner/*` — partner-facing;
- `/app/*` — Sollelio internal.

They share infrastructure and selected components but are separate user experiences and security surfaces.

Route guards are a user-experience concern only. Security is enforced by RLS, partner projections and domain commands, never by the router.

## 6. Multi-tenancy

Model multi-tenancy from day one through Organizations and memberships. Do not hard-code Do Luxo à Mesa.

A profile should not be permanently owned by exactly one organization. Use memberships so future users can belong to more than one organization if necessary.

V0 operationally assumes one active membership per partner person. The application must not encode that assumption as a silent `LIMIT 1`: if a partner ever holds more than one active membership, it presents an explicit organization chooser. Guessing which tenant a person meant is the kind of bug that leaks across a boundary.

## 7. Authorization

Partner-visible and internal-only data must be separated at the data/API boundary, not merely hidden in the frontend.

Three rules make this concrete:

1. **RLS is enabled on every table and the default is deny.** Access exists only where `05_DATA_MODEL_AND_API.md §12` grants it.
2. **Partners never select the `requests`, `issues` or `updates` base tables.** RLS is row-level, not column-level: a SELECT grant on those tables would expose internal columns whatever the policy predicate says. Partner reads go through explicit projections (security-barrier views with their own predicate, or equivalent server-side read models). The column set is the contract, not the transport.
3. **Strong, stable internal boundaries are structural.** Internal detail lives in separate tables — `request_internal_details`, `request_internal_notes`, `issue_internal_details` — rather than in columns filtered out by a serializer. Completion criteria, internal ownership, priority, classification and triage notes are internal.

Staff checks in policies use a single `SECURITY DEFINER STABLE` helper, `app.is_staff()`, with a pinned `search_path`. Policies must not subquery `profiles` directly: that recurses on the `profiles` policy and re-evaluates per row.

`profiles.is_sollelio_staff` is never client-writable. Profile self-service uses a column-limited grant (`display_name` only); the staff flag is set by a staff-only command or privileged administration. Self-escalation must be impossible, and it is release-blocking to prove it.

The service-role credential must never reach the browser.

## 8. Domain commands

Lifecycle transitions should be explicit operations such as:

- publish request;
- submit request;
- reassign request;
- record resource opened;
- complete request;
- publish update;
- acknowledge update;
- report issue;
- classify issue;
- resolve issue;
- acknowledge issue followup;
- reopen issue;
- close issue;
- archive organization.

Do not allow arbitrary browser-side updates to lifecycle fields.

Commands validate permissions, current state and payload shape, and write related Activity consistently, transactionally where practical. Submission validation is server-side and atomic: a submission that fails any field rule is rejected in full.

The canonical command list is `05_DATA_MODEL_AND_API.md §13`.

## 9. Events V1 integration

V0 integration is server-to-server.

Initial capabilities:

1. Partner context / attention summary.
2. Contextual Issue reporting, supporting text, screenshot/image and audio. Video and screen recording are deferred until a real case shows the supported formats causing material clarification friction.
3. Later: contextual Updates.

Events sends product/user/context identifiers; Partner OS resolves them to its own internal identities and rejects anything it cannot resolve.

**Identity resolution is validated, not trusted.** Partner OS resolves the person through `external_identities`, resolves the organization through `organization_products.external_tenant_id`, and verifies an active membership joining the two. On any mismatch it returns 403 and writes nothing. The full algorithm is in `05_DATA_MODEL_AND_API.md §14`.

## 10. Identity mapping

Do not require a universal Sollelio SSO migration before V0.

Use an external identity mapping layer (`external_identities`, introduced in Slice 5) that associates one Partner OS Person/Profile with a user identity from Events V1.

Avoid making Partner OS depend on direct trust of another Supabase project's JWT without a deliberate identity architecture.

## 11. Media

Storage is private by default. There are no public objects and no anonymous access. Clients never read or write storage directly.

All access is through short-lived signed URLs issued server-side after an authorization check. Events V1 never holds Partner OS storage credentials: contextual report media is uploaded to a short-lived signed upload URL that Partner OS issues per asset.

Media ownership is explicit. An asset is either organization-owned or Sollelio-owned, and authorization follows the object the asset is linked to — a cross-organization Update authorizes its media through the Update audience, never by attributing the asset to a single tenant. See `05_DATA_MODEL_AND_API.md §7`.

Operational media examples:

- screenshots;
- voice notes;
- short videos;
- thumbnails.

Media may be uploaded before the object it will be attached to exists. Orphaned pre-submit uploads are acceptable in V0; no cleanup job is required yet.

**Retention.** No formal retention, deletion or privacy workflow is required for the Do Luxo à Mesa pilot. This is a deliberate deferral for a single-partner validation, not an oversight, and it expires: retention and deletion expectations for partner audio, images and other evidence must be defined **before a second Design Partner is onboarded** (`07_DO_LUXO_A_MESA_PILOT.md §16`).

Large or long-lived reference libraries can remain in external systems and be surfaced through canonical Resource links.

## 12. AI boundary

Domain capabilities should not be named after vendors. Examples:

- TranscriptionService;
- IssueSummarizer;
- ClassificationAssistant;
- PartnerCopyAssistant.

AI provider/model may change without changing the domain model.

Store original evidence separately from AI-derived outputs. Track whether AI output was reviewed/accepted. AI persistence (`ai_runs`) is deferred to Slice 7.

## 13. Suggested module boundaries

- organizations;
- people;
- products;
- resources;
- requests;
- updates;
- issues;
- activity;
- integrations;
- ai.

Avoid generic dumping grounds such as `utils/` or `services/` for domain behaviour.

`notifications` becomes a module when a real reminder/delivery workflow exists; it is not a V0 module.

## 14. Deployment environments

At minimum:

- local;
- staging;
- production.

Database migrations must be versioned and reproducible. Do not rely on manual dashboard-only schema edits. Migration waves map one-to-one onto delivery slices (`05_DATA_MODEL_AND_API.md §17`).

Edge Function deployment is part of the same versioned pipeline as migrations, not a manual dashboard action.

## 15. CI/CD baseline

Before merge/deploy:

- lint;
- typecheck;
- tests;
- build.

Add database/RLS tests for critical tenant and internal/partner security boundaries, including the partner projections and the staff-escalation guard.

## 16. Observability

V0 should log enough to diagnose:

- application errors;
- Edge Function/server errors;
- integration failures, including 403 identity-resolution rejections;
- AI processing failures;
- important object IDs/organization IDs where appropriate.

Avoid adding heavyweight enterprise observability before need exists.

## 17. Idempotency

Integration endpoints that may be retried must not create duplicate operational objects.

- **Issue creation** carries an `idempotency_key` stored directly on the Issue, with a scoped unique constraint. A repeat returns the original Issue. V0 adds no general idempotency table.
- **Acknowledgements and seen-marks** are already idempotent through `UNIQUE(update_id, profile_id)` on `update_receipts`; they need no additional mechanism.

## 18. Deletion/history

Prefer archive/cancel/close over silent destructive deletion for operational objects whose history matters.

`issue_messages` is append-only: the original report and every resolution message are never edited or deleted.

Hard deletion should be reserved for deliberate privacy/compliance/admin workflows.

## 19. Time

Use `timestamptz` consistently in the database. Convert to user/local timezone only at presentation boundaries.

## 20. Authentication

Partner authentication uses **Supabase Auth magic link / email OTP**. Partners have no password to manage, which suits a mobile-first, non-technical partner audience.

People are created **invite-first**: the auth user is invited/created through the Supabase Auth admin API, then the `profiles` row is created bound to the returned `auth_user_id`. A profile never exists without its auth user. This applies to production seeding as well as later onboarding.

Deep links must survive authentication: the requested URL is preserved through login and the user lands on the exact object, not on Home (`03_UX_SPEC.md §20`).

## 21. Language

**All user-facing surfaces are Portuguese (pt-PT) in V0 — partner and internal alike.** There is no i18n framework, no locale column, no message catalogue and no translation tooling. Copy is written directly in Portuguese in the components.

**Code, schema, domain terminology, logs, commit messages and technical documentation remain English.** Enum values such as `needs_partner` and `ux_confusion` are domain terminology, not copy: they stay English in the database and are rendered into Portuguese at the presentation boundary, exactly as timestamps are rendered into local time.

The absence of an i18n framework is deliberate, and it has one practical consequence worth stating: Portuguese strings sit inline in components. If a second language ever becomes real, that is a refactor, and it is the right trade for a single-tenant pilot with one operator and one partner.
