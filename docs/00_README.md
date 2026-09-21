# Sollelio Partner OS V0

## Purpose

Sollelio Partner OS is the internal operating platform through which Sollelio collaborates with Design Partners and other partner organizations. It makes partner attention explicit, communicates product changes, structures issue intake and resolution, preserves operational context, and integrates contextually with Sollelio products.

The first real organization is **Do Luxo à Mesa**, with Nádia as the first partner user. The first integrated Sollelio product is **Sollelio Events V1**.

## Current phase

V0 — first production validation.

## Canonical documents

Read in this order:

1. `01_PRODUCT_SPEC.md` — what the product is and why it exists.
2. `02_OPERATING_MODEL.md` — how Sollelio and partners should work through it.
3. `03_UX_SPEC.md` — partner-facing, internal, and embedded product experience.
4. `04_TECHNICAL_ARCHITECTURE.md` — system boundaries and platform choices.
5. `05_DATA_MODEL_AND_API.md` — implementable data and integration contracts.
6. `06_BUILD_PLAN.md` — delivery order and definition of done.
7. `07_DO_LUXO_A_MESA_PILOT.md` — first production tenant and validation plan.

## Core product objects

V0 revolves around three operational objects:

- **Request** — “We need you to do something.”
- **Update** — “Something changed and you may need to know.”
- **Issue** — “Something may be wrong or confusing.”

Supporting concepts include Organization, Person, Product, Resource, Activity, media, and integration context.

## Fixed V0 decisions

These are settled. Do not re-open them during implementation; the canonical document for each is in brackets.

- **All user-facing surfaces are Portuguese (pt-PT)** — partner and internal. No i18n framework. Code, schema and domain terminology stay English. [`01 §13`, `04 §21`]
- Partner sign-in is **magic link / email OTP**. People are created invite-first: auth user, then profile. [`04 §20`]
- **“Needs your attention”** = Requests where `next_actor = partner` + Issues where `status = needs_partner`. Nothing else. Effort totals come from Requests only. [`01 §8`, `03 §3`]
- Requests have **five states**: draft, needs_partner, needs_sollelio, completed, cancelled. [`01 §5`, `05 §4`]
- Partners **never read the `requests`, `issues` or `updates` base tables**. They read explicit partner projections. RLS is on everywhere, default deny. [`04 §7`, `05 §12`]
- **Issue visibility is reporter-only** in V0. Closing and reopening are manual Sollelio actions; a partner reply after resolution raises an internal signal, never an auto-reopen. [`01 §5`, `02 §7`]
- `resources` is the **single source of truth** for partner-facing canonical URLs. [`02 §11`, `05 §3`]
- Netlify hosts the SPA. **All privileged server-side code and every `/v1/*` endpoint runs in Supabase Edge Functions.** [`04 §2`]
- Events V1 integration is server-to-server with a shared secret in environment variables, and `/v1/partner-context` **fails open**. [`04 §4`, `05 §15`]
- **Each delivery slice owns exactly one migration wave.** [`05 §17`, `06`]
- A partner has **one active organization** in V0; more than one requires an explicit chooser, never a silent pick. [`03 §2`, `04 §6`]
- **Deadlines are shown when they exist and absent otherwise** — no placeholder. Effort `<1 min` stores as 1 and renders as `<1 min`. [`02 §2`, `03 §4`]
- **Archiving an organization is rejected while work is open.** Nothing is cancelled or closed implicitly. [`02 §16`, `05 §1`]
- Contextual Issue reporting is **text, image and audio**. Video is deferred until clarification friction proves it necessary. [`03 §19`, `05 §14`]
- `resource.opened` is the **only** partner behaviour V0 instruments. No generic view tracking. [`05 §8`]
- **Media retention is deferred for the pilot** and must be defined before a second Design Partner. [`04 §11`, `07 §16`]

## Scope discipline

Do not add functionality because it is elegant or generally useful. A V0 feature must solve an observed problem or be essential to validating the operating model with real Design Partners.

The Partner OS should reduce coordination work, not create administrative work.

## Brand assets

Before design work, read `design/brand/README.md` and `design/brand/sollelio-brand-guidelines.md`. The Partner OS product lockups and the first tenant logo are already included in the repository handoff.
