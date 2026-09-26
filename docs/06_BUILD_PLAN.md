# Build Plan — Sollelio Partner OS V0

## Delivery strategy

Build vertical slices that can be used in production as early as possible. Do not build the complete schema/backend first and postpone user validation until the end.

**Each slice owns exactly one migration wave.** The waves in `05_DATA_MODEL_AND_API.md §17` map one-to-one onto the slices below. Do not create a later wave's tables early, even when they are already specified.

## Phase 0 — Engineering foundation

### Scope

- repository/application foundation;
- React + TypeScript;
- Partner OS Supabase project;
- Netlify hosting for the SPA; Supabase Edge Functions for privileged server-side code;
- local/staging/production configuration;
- migrations structure;
- Edge Function deployment in the same versioned pipeline as migrations;
- generated database types where appropriate;
- lint/typecheck/test/build pipeline;
- baseline error handling;
- modular code structure.

### Done when

- local works;
- CI passes;
- staging deploys;
- production is deployable;
- migrations are reproducible;
- Edge Functions deploy reproducibly from version control.

No unnecessary product functionality. No schema beyond what Slice 1 needs.

## Slice 1 — Organizations, Products, Resources

### Goal

Create the minimum real partner environment and solve canonical-access confusion.

### Backend — migration wave 1

- profiles;
- organizations;
- organization_memberships;
- products;
- organization_products;
- resources;
- `app.is_staff()` SECURITY DEFINER helper;
- RLS enabled on every table, default deny, with the §12 policies for these tables;
- magic link / email OTP authentication.

### Production seed

People are created **invite-first**: invite the auth user through the Supabase Auth admin API, then create the profile bound to the returned `auth_user_id`. A profile never exists without its auth user.

- Do Luxo à Mesa;
- Nádia;
- Sollelio Events V1;
- Do Luxo à Mesa website;
- canonical Resources.

### Partner UI

Minimal Home with canonical Resources. Sign-in by magic link, including the "check your email" and expired-link states. Portuguese (pt-PT) copy, as on every surface.

### Internal UI

View organization, people and resources; create/edit resources as required.

### Definition of done

Nádia can sign in by magic link and reliably find the current Events, website and shared-file links.

## Slice 2 — Requests end-to-end

### Goal

Validate the core question: "What do I need to do now?"

### Backend — migration wave 2

- requests (five states: draft, needs_partner, needs_sollelio, completed, cancelled);
- request_internal_details;
- request_fields (long_text, single_choice, boolean, approval);
- request_submissions;
- request_answers;
- request_internal_notes;
- activity_events;
- the `partner_requests` projection;
- lifecycle commands, including `reassign_request`, the membership-deactivation guard and the organization-archival guard;
- `record_resource_opened`, writing `resource.opened` (needs `activity_events`, so it arrives here rather than in Slice 1);
- atomic server-side submission validation;
- RLS/security tests.

### Internal UI

- create Request (approval type generates its own response fields);
- Preview as Partner;
- publish;
- inspect response;
- return with precise clarification;
- reassign;
- complete/cancel.

### Partner UI

- Needs Attention Home section (Requests only at this slice);
- Request Detail, showing a human-readable deadline when `due_at` is set and no deadline UI at all when it is null;
- `<1 min` effort rendered as `<1 min`;
- response controls;
- submission success state.

### Checkpoints inside Slice 2

Slice 2 is delivered in checkpoints, each with its own review. C2 regroups creation, preview, publication and the partner read path into one checkpoint; the comment in the C1 migration that assigned lifecycle commands to "C3/C4" predates this and is superseded here (the migration itself is not edited).

- **C1 — persistence and authorization boundary** (`20260923120000`). Schema, RLS, `partner_requests`. Done: applied to staging and verified structurally and behaviourally.
- **C2 — authoring and publication** (`20260925160000`). Staff create, save and edit drafts; preview exactly what the partner will see; publish the previewed revision. The assigned partner sees the Request on Home ("Precisa de si") and in the detail, **read-only**: questions are listed, with no answer inputs and no submit control. Staff read the published Request with its internal details, notes (read-only) and activity. Commands `create_request`, `update_request_draft`, `preview_request`, `publish_request` (`05 §13`). Routes: `/app/organizations/:slug/requests`, `…/requests/new`, `…/requests/:id` (editor for a draft, detail otherwise), `…/requests/:id/preview`; `/partner`, `/partner/requests/:id`. A Request of another organization is "not found" inside an organization's routes; for the partner, a Request that does not exist and one she may not see look the same. Queue per organization only, no global queue. Ordering: Home by deadline (none last) then newest publication; internal queue by group (Sollelio, partner, drafts, closed), then deadline, then most recently updated. **C2 is a development/staging delivery: it is not ready for the pilot in production**, because the partner cannot respond yet.
- **Next checkpoints (scope to be confirmed at their review):** partner submission and return to the partner; reassignment, completion and cancellation; the membership-deactivation and organization-archival guards; post-publication edits; `record_resource_opened`. Production receives Slice 2 only once the partner can respond.

### Pilot checkpoint

Use with Nádia immediately:

1. "Explore the new space" Request — this also carries the framing message about how collaboration now works, since Updates do not exist yet;
2. one real operational Request.

Observe whether clarification is still needed via WhatsApp.

## Design checkpoint — Claude Code /design

Before final visual implementation of the first production-facing slices, use `/design` with full system context but ask it to design only the system foundation plus Slice 1/Slice 2 surfaces.

Initial design surfaces:

Partner:
- Home;
- Request Detail;
- Request Submitted;
- Resources;
- sign-in / check-your-email;
- key mobile/empty states.

Internal:
- Organization Overview;
- Create Request;
- Request Detail.

Partner copy is Portuguese. Use the official Sollelio SVG assets; the Partner OS PNG lockups are design references, not production masters.

Use Fable 5.1 for this high-leverage design direction if budget allows. Use the current Opus model for routine implementation.

## Slice 3 — Updates

### Goal

Validate structured product communication and micro-update formats.

### Backend — migration wave 3

- updates;
- update_audiences;
- update_receipts;
- media_assets with explicit ownership + update_media;
- private storage with signed-URL access;
- the `partner_updates` projection;
- publish/seen/acknowledge lifecycle;
- `profiles.last_seen_at` / `previous_seen_at` and `record_partner_visit`.

### Internal UI

- create;
- audience;
- media;
- Preview;
- publish;
- seen/acknowledgement visibility.

### Partner UI

- What's New Home section;
- Since last visit Home block (arrives here, not earlier);
- Updates list/detail;
- Important Update acknowledgement.

Acknowledgement-required Updates appear in the Updates indicator, never in the attention count.

### Pilot checkpoint

Publish a real recent Events/website change. Attach externally produced short video only if it genuinely makes the change easier to understand. Evaluate whether additional explanation is still required.

## Slice 4 — Issues

### Goal

Create the full structured support/learning loop.

### Backend — migration wave 4

- issues;
- issue_contexts;
- issue_messages (append-only; source of truth for the original report and resolution);
- issue_internal_details;
- issue_media, request_media;
- the `partner_issues` projection;
- triage/classification/lifecycle commands, including `submit_issue_clarification`, `acknowledge_issue_followup`, `reopen_issue` and manual `close_issue`;
- the partner-followup signal on resolved Issues.

### Partner UI

- Report Issue (text, image, audio);
- Issues list;
- Issue Detail;
- clarification — an Issue awaiting the partner appears in Needs Your Attention;
- resolution, and the ability to reply after it.

### Internal UI

- Issues queue;
- triage;
- classification;
- investigation notes;
- partner-facing resolution;
- reopen, acknowledge-followup and close controls, with reopen never subordinate to acknowledge;
- visible signal for partner replies after resolution.

### Pilot checkpoint

Run a real Issue through report → triage → resolution → partner closure.

## Slice 5 — Events V1 contextual Issue integration

### Goal

Allow a user already inside Events V1 to report a problem without moving between tools or manually describing technical context.

### Backend — migration wave 5

- external_identities;
- `issues.idempotency_key` with its scoped partial unique index;
- `/v1/issues`, `/v1/partner-context` and the media upload-URL endpoints as Supabase Edge Functions;
- shared-secret integration authentication from environment variables.

### Required flow

Events user → Report Problem → text/image/audio → Events backend → Partner OS API → Issue created with correct user/org/product/context.

Media is uploaded to short-lived signed upload URLs issued by Partner OS. Events V1 never holds Partner OS storage credentials.

Video and screen recording are deferred and are not designed or built in this slice. They are reconsidered only when a real case shows text, image and audio causing material clarification friction.

### Definition of done

- no Partner OS re-login interaction needed for the embedded report flow;
- correct identity/org/context captured;
- an unresolvable user or a user/organization mismatch returns 403 and writes nothing;
- a retried request with the same idempotency key returns the original Issue;
- Issue appears internally;
- later partner status is accessible;
- Events core remains operational if Partner OS is down.

## Slice 6 — Events V1 attention + What's New

### Goal

Expose minimal Partner OS context where the partner already works.

Add:

- actionable attention count (Requests needing the partner, plus Issues needing the partner);
- separate Updates count;
- drawer/panel with small preview and deep links;
- contextual Update where clearly useful.

`/v1/partner-context` is called with a short timeout and fails open. It must never block core Events functionality.

Do not embed the entire Partner Portal.

## Slice 7 — AI assistance

Only after real data reveals repetitive work. Introduces `ai_runs`.

Likely first candidates:

- audio transcription;
- Issue summary suggestion;
- classification suggestion.

Human confirms output before consequential actions.

## Slice 8+ — Evidence-driven evolution

Potential additions only when justified by observed friction:

- better filters/activity;
- notification intent tracking and reminder workflow;
- partner health signals;
- Insight entity;
- Decision entity;
- meeting extraction;
- notification automation;
- organization-wide Issue visibility;
- video/screen recording in contextual Issue reporting, if clarification friction proves it necessary;
- media retention, deletion and privacy workflow (required before a second Design Partner — see below);
- deeper embedded Request actions;
- native AI media generation.

## Test strategy

### Unit

- lifecycle rules and state/next-actor invariants;
- next-actor logic;
- submission validation (required fields, types, option membership);
- aggregation/helpers;
- domain validation.

### Database/integration

- RLS;
- tenant isolation;
- internal/partner separation, including the partner projections;
- domain command transitions;
- identity resolution and rejection paths;
- idempotent Issue creation.

### E2E critical flows

1. Admin creates Request → partner responds → admin completes.
2. Admin publishes Update → partner sees/acknowledges.
3. Partner reports Issue → admin resolves → partner sees resolution.
4. Events creates contextual Issue → Partner OS receives correct context.

## Release-blocking security tests

- Partner A cannot access Organization B.
- Partner cannot SELECT the `requests`, `issues` or `updates` base tables at all.
- The partner projections expose no internal column — asserted against the documented column list, so a later `SELECT *` cannot widen them silently.
- Partner cannot access internal Request details, including completion criteria and priority.
- Partner cannot access Issue internal details, classification or priority.
- Partner cannot set `is_sollelio_staff` on their own profile, or on any profile, by any route.
- Partner cannot arbitrarily change lifecycle state.
- Partner cannot spoof organization/reporter identity.
- Partner cannot read Issues reported by another person.
- A partner holding two active memberships is never silently scoped to one organization.
- Archiving an organization with open Requests or unclosed Issues is rejected, and nothing is cancelled or closed as a side effect.
- Events integration cannot create Issues for arbitrary users/orgs; an unresolved identity or org mismatch returns 403 and writes nothing.
- A repeated integration call with the same idempotency key creates exactly one Issue.
- Private media requires authorization; a signed URL cannot be obtained for another organization's asset.
- Update media is authorized through Update audience, and a partner in a non-audience organization cannot obtain it.
- RLS is enabled on every table; a new table without policies is inaccessible rather than open.

## Checkpoint before a second Design Partner

Do not onboard a second Design Partner before these are settled. The pilot is allowed to defer them; a two-tenant system is not.

1. **Media retention, deletion and privacy.** Define what happens to partner audio, images and other evidence: how long it is kept, who can delete it, what a partner can ask to have removed, and what leaves the system when an organization is archived. No formal workflow is required for Do Luxo à Mesa.
2. **Issue visibility scope.** Re-confirm reporter-only, or move to organization-wide, now that an organization may realistically have several people.
3. **Organization chooser.** Verify the multi-membership path actually works rather than remaining theoretical.

## Seed strategy

Use rich demo/staging fixtures to exercise states. Production contains only real production data, starting with Do Luxo à Mesa.

## Definition of done for every slice

A slice is done only when:

- Product: the intended job works end-to-end;
- UX: happy, empty, loading and failure states exist where relevant, in Portuguese (pt-PT) on every surface, partner and internal;
- Engineering: schema/types/auth/error handling are correct, and the slice added only its own migration wave;
- Tests: critical behaviour/security are covered;
- Operational: the slice is realistically usable with Do Luxo à Mesa.
