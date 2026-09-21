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

## Scope discipline

Do not add functionality because it is elegant or generally useful. A V0 feature must solve an observed problem or be essential to validating the operating model with real Design Partners.

The Partner OS should reduce coordination work, not create administrative work.

## Brand assets

Before design work, read `design/brand/README.md` and `design/brand/sollelio-brand-guidelines.md`. The Partner OS product lockups and the first tenant logo are already included in the repository handoff.
