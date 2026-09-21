Use Claude Code `/design` for this task.

Read `CLAUDE.md`, all files under `/docs`, and `design/design-brief.md` before producing design work.

The complete Partner OS V0 specification is context, not permission to design the whole product now.

Design only the first production-facing system foundation and the Slice 1 + Slice 2 experience.

## Partner experience — mobile-first

Design:

1. Partner Home
   - Needs Your Attention is the dominant section.
   - Show number of pending items and honest total estimated effort.
   - Include clear Request cards.
   - Include minimal Quick Resources for Sollelio Events V1, the Do Luxo à Mesa website and shared files.
   - Leave a natural place for future Updates and Report Problem without turning this first slice into a complete future UI.

2. Request Detail
   - Why Sollelio is asking.
   - Exactly what the partner should do.
   - Estimated effort.
   - Relevant link/media.
   - Structured response controls.
   - Clear primary action.

3. Request Submitted
   - Make completion unmistakable.
   - Communicate that the next action is now with Sollelio.
   - If other work remains, allow the partner to continue without making the experience feel like an aggressive checklist.

4. Resources
   - Canonical, obvious and easy to scan.

5. Key empty, loading and failure states.

## Sollelio internal experience — desktop-first

Design:

1. Do Luxo à Mesa Organization Overview.
2. Create Request.
3. Request Detail.
4. Preview as Partner.

The internal Request Detail must make partner-facing content and internal-only context visually unmistakable.

## Design principles

- The Partner experience must not look or feel like a ticketing system.
- It should feel calm, lightweight, premium, trustworthy and obvious.
- Reduce cognitive load before adding visual decoration.
- Use human language on Partner surfaces; never expose internal status jargon simply because it exists in the data model.
- The internal experience can be denser and more operational, but should remain clean and fast.
- Partner and Internal should clearly belong to the same Sollelio product family without having identical information density.
- Do not add a generic notifications inbox.
- Do not add a multi-step onboarding wizard.
- Do not introduce project-management, CRM, chat or roadmap capabilities.
- Do not redesign product requirements. If you discover a genuine specification conflict, flag it explicitly instead of silently solving it through new scope.

## Future awareness

Understand that later slices will add Updates, Issues and contextual integration with Sollelio Events V1. Establish a design language capable of extending to those areas, but do not fully design those later slices now.

## Output

Produce the strongest coherent design direction you can for the requested surfaces, including responsive behaviour and the key states required for implementation. Explain only the design decisions that materially affect product behaviour or engineering.

## Brand source of truth

Before designing, inspect all files under `design/brand/` and follow `design/brand/sollelio-brand-guidelines.md`.

Use the supplied Sollelio Partner OS lockups as the current product identity. Do not redesign the Sollelio symbol or invent a separate Partner OS symbol.

The Do Luxo à Mesa logo is tenant content only. It may be used in organization context where helpful, but its visual identity must not influence the Partner OS platform design.

Do not add gradients, shadows, glow, 3D logo effects or decorative alterations to the Sollelio mark. Brand expression should support the UX, not overpower it.
