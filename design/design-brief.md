# Claude Code /design Brief — Sollelio Partner OS V0

## Instruction

Read `CLAUDE.md` and all canonical documents in `/docs` before designing.

Understand the complete Partner OS V0, but design only the first usable delivery surfaces. Do not add product capabilities that are not in the specification.

## Design objective

Create a coherent visual/product system that can later expand to Updates and Issues while making the initial Resources + Requests experience production-ready.

The Partner experience must not resemble a ticket-management system. It should feel calm, clear, premium, lightweight and human.

The internal Sollelio experience should feel precise, operational and fast, with greater information density where it helps work.

## Primary users

Partner: Nádia / future Design Partner members. Mobile-first.

Internal: Sollelio operator. Desktop-first.

## Design these Partner surfaces

1. Partner Home
   - Needs Your Attention as highest priority.
   - total estimated effort.
   - Request cards.
   - minimal Quick Resources.
   - Report Problem entry point can be visible as future/system affordance, but do not invent the full Issue flow in this first design slice unless needed to establish the system language.

2. Request Detail
   - why;
   - exact requested action;
   - effort;
   - external deep link where needed;
   - structured response;
   - mobile-first.

3. Request Submitted / success state
   - explicit closure;
   - “now it is with Sollelio” semantics;
   - optional next pending item.

4. Resources
   - canonical Events V1 link;
   - canonical website;
   - shared files.

5. Key empty/loading/error states for the above.

## Design these internal surfaces

1. Organization Overview — Do Luxo à Mesa.
2. Create Request.
3. Request Detail with explicit separation between partner-facing content and internal-only context.
4. Preview as Partner state.

## Responsive priorities

Partner: design from approximately 375–430 px mobile first, then scale upward.

Internal: optimize for approximately 1280–1440 px desktop while remaining usable on smaller laptops/tablets.

## Product constraints

- No generic notification inbox.
- No large sidebar for the mobile Partner experience.
- No internal jargon on Partner surfaces.
- No ticket IDs, priority, triage or owner metadata shown to Partner.
- No analytics vanity dashboard.
- Do not create an onboarding wizard.
- Do not design a project-management system.
- Preserve clear room for future Updates and Issues without designing them in full now.

## Important interaction principles

- Partner Home answers “What do I need to do now?” within seconds.
- Every partner action must make the next state clear.
- Empty states should be human and reassuring, e.g. “Everything is handled”, not “0 records”.
- Preview as Partner is a first-class internal design feature.
- The same Sollelio visual family should support both Partner and Internal surfaces, but they should not have identical density.

## Deliverable expectation

Produce a coherent design direction and the requested screens/states. Explain important UX/design decisions where they materially affect implementation. Do not change the product specification without explicitly flagging a conflict.

## Brand assets and hierarchy

Before designing, inspect `design/brand/README.md`, `design/brand/sollelio-brand-guidelines.md`, and the assets under `design/brand/`.

Use **Sollelio Partner OS** as a Sollelio product lockup, not as an independent brand. The Sollelio master symbol must remain unchanged.

The supplied Partner OS lockups are the current working product identity references:

- `design/brand/partner-os/sollelio-partner-os-primary.png`
- `design/brand/partner-os/sollelio-partner-os-reverse.png`
- `design/brand/partner-os/sollelio-partner-os-compact.png`

The Do Luxo à Mesa logo is available at `design/brand/partner-brands/do-luxo-a-mesa-logo-transparent.png`. Treat it strictly as tenant content. Do **not** derive the Partner OS visual language from Do Luxo à Mesa's gold/black/luxury identity.

Preserve the Sollelio visual identity without allowing branding to dominate usability. The brand palette is a foundation; the Partner experience should still feel calm, clear, lightweight, premium and high-trust.
