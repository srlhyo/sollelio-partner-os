# Build Plan — Sollelio Partner OS V0

## Delivery strategy

Build vertical slices that can be used in production as early as possible. Do not build the complete schema/backend first and postpone user validation until the end.

## Phase 0 — Engineering foundation

### Scope

- repository/application foundation;
- React + TypeScript;
- Partner OS Supabase project;
- local/staging/production configuration;
- migrations structure;
- generated database types where appropriate;
- lint/typecheck/test/build pipeline;
- baseline error handling;
- modular code structure.

### Done when

- local works;
- CI passes;
- staging deploys;
- production is deployable;
- migrations are reproducible.

No unnecessary product functionality.

## Slice 1 — Organizations, Products, Resources

### Goal

Create the minimum real partner environment and solve canonical-access confusion.

### Backend

Implement:

- profiles;
- organizations;
- memberships;
- products;
- organization_products;
- resources;
- basic authorization/RLS.

### Production seed

- Do Luxo à Mesa;
- Nádia;
- Sollelio Events V1;
- Do Luxo à Mesa website;
- canonical Resources.

### Partner UI

Minimal Home with canonical Resources.

### Internal UI

View organization, people and resources; create/edit resources as required.

### Definition of done

Nádia can open the Partner experience and reliably find the current Events, website and shared-file links.

## Slice 2 — Requests end-to-end

### Goal

Validate the core question: “What do I need to do now?”

### Backend

- requests;
- request_fields;
- request_submissions;
- request_answers;
- request_internal_notes;
- activity events;
- lifecycle commands;
- RLS/security tests.

### Internal UI

- create Request;
- Preview as Partner;
- publish;
- inspect response;
- return with precise clarification;
- complete/cancel.

### Partner UI

- Needs Attention Home section;
- Request Detail;
- response controls;
- submission success state.

### Pilot checkpoint

Use with Nádia immediately:

1. “Explore the new space” Request;
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
- key mobile/empty states.

Internal:
- Organization Overview;
- Create Request;
- Request Detail.

Use Fable 5.1 for this high-leverage design direction if budget allows. Use the current Opus model for routine implementation.

## Slice 3 — Updates

### Goal

Validate structured product communication and micro-update formats.

### Backend

- updates;
- update_audiences;
- update_receipts;
- media support required by Updates;
- publish/seen/acknowledge lifecycle.

### Internal UI

- create;
- audience;
- media;
- Preview;
- publish;
- seen/acknowledgement visibility.

### Partner UI

- What’s New Home section;
- Updates list/detail;
- Important Update acknowledgement.

### Pilot checkpoint

Publish a real recent Events/website change. Attach externally produced short video only if it genuinely makes the change easier to understand. Evaluate whether additional explanation is still required.

## Slice 4 — Issues

### Goal

Create the full structured support/learning loop.

### Backend

- issues;
- issue_contexts;
- issue_messages;
- issue_internal_details;
- issue media;
- triage/classification/lifecycle commands.

### Partner UI

- Report Issue;
- Issues list;
- Issue Detail;
- clarification;
- resolution.

### Internal UI

- Issues queue;
- triage;
- classification;
- investigation notes;
- partner-facing resolution.

### Pilot checkpoint

Run a real Issue through report → triage → resolution → partner closure.

## Slice 5 — Events V1 contextual Issue integration

### Goal

Allow a user already inside Events V1 to report a problem without moving between tools or manually describing technical context.

### Required flow

Events user → Report Problem → text/audio/media → Events backend → Partner OS API → Issue created with correct user/org/product/context.

### Definition of done

- no Partner OS re-login interaction needed for the embedded report flow;
- correct identity/org/context captured;
- Issue appears internally;
- later partner status is accessible;
- Events core remains operational if Partner OS is down.

## Slice 6 — Events V1 attention + What’s New

### Goal

Expose minimal Partner OS context where the partner already works.

Add:

- actionable attention count;
- separate Updates count;
- drawer/panel with small preview and deep links;
- contextual Update where clearly useful.

Do not embed the entire Partner Portal.

## Slice 7 — AI assistance

Only after real data reveals repetitive work.

Likely first candidates:

- audio transcription;
- Issue summary suggestion;
- classification suggestion.

Human confirms output before consequential actions.

## Slice 8+ — Evidence-driven evolution

Potential additions only when justified by observed friction:

- better filters/activity;
- partner health signals;
- improved reminder workflow;
- Insight entity;
- Decision entity;
- meeting extraction;
- notification automation;
- deeper embedded Request actions;
- native AI media generation.

## Test strategy

### Unit

- lifecycle rules;
- next-actor logic;
- aggregation/helpers;
- domain validation.

### Database/integration

- RLS;
- tenant isolation;
- internal/partner separation;
- domain command transitions.

### E2E critical flows

1. Admin creates Request → partner responds → admin completes.
2. Admin publishes Update → partner sees/acknowledges.
3. Partner reports Issue → admin resolves → partner sees resolution.
4. Events creates contextual Issue → Partner OS receives correct context.

## Release-blocking security tests

- Partner A cannot access Organization B.
- Partner cannot access internal Request notes.
- Partner cannot access Issue internal details.
- Partner cannot arbitrarily change lifecycle state.
- Partner cannot spoof organization/reporter identity.
- Events integration cannot create Issues for arbitrary users/orgs.
- private media requires authorization.

## Seed strategy

Use rich demo/staging fixtures to exercise states. Production contains only real production data, starting with Do Luxo à Mesa.

## Definition of done for every slice

A slice is done only when:

- Product: the intended job works end-to-end;
- UX: happy, empty, loading and failure states exist where relevant;
- Engineering: schema/types/auth/error handling are correct;
- Tests: critical behaviour/security are covered;
- Operational: the slice is realistically usable with Do Luxo à Mesa.
