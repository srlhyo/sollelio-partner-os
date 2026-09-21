# Technical Architecture — Sollelio Partner OS V0

## 1. Architecture style

Use a **modular monolith**.

Do not introduce microservices, event buses, Kafka, Kubernetes, event sourcing or separate databases per organization in V0.

## 2. High-level stack

- Frontend: React + TypeScript.
- Hosting: Netlify, unless implementation uncovers a concrete blocker.
- Backend platform: dedicated Supabase project for Partner OS.
- Database: PostgreSQL.
- Authentication: Supabase Auth initially.
- Authorization: organization-aware server-side rules and RLS where applicable.
- Media: Supabase Storage for small/operational assets; external Resources such as Google Drive for large/shared libraries.
- Server-side integration/AI: Supabase Edge Functions and/or explicit server-side application functions/RPCs as appropriate.

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

## 5. Frontend structure

A single web application may contain two main surfaces:

- `/partner/*` — partner-facing;
- `/app/*` — Sollelio internal.

They share infrastructure and selected components but are separate user experiences and security surfaces.

## 6. Multi-tenancy

Model multi-tenancy from day one through Organizations and memberships. Do not hard-code Do Luxo à Mesa.

A profile should not be permanently owned by exactly one organization. Use memberships so future users can belong to more than one organization if necessary.

## 7. Authorization

Partner-visible and internal-only data must be separated at the data/API boundary, not merely hidden in the frontend.

Where the internal boundary is strong and stable, prefer separate internal tables/records (e.g. internal Issue details) over returning entire rows and relying on UI serializers.

The service-role credential must never reach the browser.

## 8. Domain commands

Lifecycle transitions should be explicit operations such as:

- publish request;
- submit request;
- complete request;
- publish update;
- acknowledge update;
- report issue;
- classify issue;
- resolve issue.

Do not allow arbitrary browser-side updates to lifecycle fields.

Commands should validate permissions/current state and write related Activity/notification intents consistently, transactionally where practical.

## 9. Events V1 integration

V0 integration is server-to-server where privileged trust is needed.

Initial capabilities:

1. Partner context / attention summary.
2. Contextual Issue reporting.
3. Later: contextual Updates.

Events should send product/user/context identifiers; Partner OS resolves them to its own internal identities.

## 10. Identity mapping

Do not require a universal Sollelio SSO migration before V0.

Use an external identity mapping layer that can associate one Partner OS Person/Profile with a user identity from Events V1.

Avoid making Partner OS depend on direct trust of another Supabase project's JWT without a deliberate identity architecture.

## 11. Media

Use private-by-default storage.

Operational media examples:

- screenshots;
- voice notes;
- short videos;
- thumbnails.

Large or long-lived reference libraries can remain in external systems and be surfaced through canonical Resource links.

## 12. AI boundary

Domain capabilities should not be named after vendors. Examples:

- TranscriptionService;
- IssueSummarizer;
- ClassificationAssistant;
- PartnerCopyAssistant.

AI provider/model may change without changing the domain model.

Store original evidence separately from AI-derived outputs. Track whether AI output was reviewed/accepted.

## 13. Suggested module boundaries

- organizations;
- people;
- products;
- resources;
- requests;
- updates;
- issues;
- activity;
- notifications;
- integrations;
- ai.

Avoid generic dumping grounds such as `utils/` or `services/` for domain behaviour.

## 14. Deployment environments

At minimum:

- local;
- staging;
- production.

Database migrations must be versioned and reproducible. Do not rely on manual dashboard-only schema edits.

## 15. CI/CD baseline

Before merge/deploy:

- lint;
- typecheck;
- tests;
- build.

Add database/RLS tests for critical tenant and internal/partner security boundaries.

## 16. Observability

V0 should log enough to diagnose:

- application errors;
- Edge Function/server errors;
- integration failures;
- AI processing failures;
- important object IDs/organization IDs where appropriate.

Avoid adding heavyweight enterprise observability before need exists.

## 17. Idempotency

Integration endpoints that may be retried, especially Issue creation and acknowledgements, should support idempotency to prevent duplicate operational objects.

## 18. Deletion/history

Prefer archive/cancel/close over silent destructive deletion for operational objects whose history matters.

Hard deletion should be reserved for deliberate privacy/compliance/admin workflows.

## 19. Time

Use `timestamptz` consistently in the database. Convert to user/local timezone only at presentation boundaries.
