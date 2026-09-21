Read `CLAUDE.md` and every document under `/docs`.

Do not modify code and do not implement anything yet.

Perform an independent specification review of Sollelio Partner OS V0. Look specifically for:

- contradictions between Product Spec, Operating Model, UX Spec, Technical Architecture, Data Model/API and Build Plan;
- tenant-isolation or authorization risks;
- accidental exposure of internal-only information;
- lifecycle contradictions or impossible states;
- missing constraints or missing failure cases;
- overengineering or premature abstraction;
- places where the data model does not support the UX/workflow cleanly;
- integration coupling that could make Sollelio Events V1 depend on Partner OS availability;
- anything that violates the stated V0 scope/non-goals.

Return findings grouped by severity:

1. Must fix before implementation.
2. Should clarify before implementation.
3. Safe simplifications.
4. No-action observations.

For every finding, cite the relevant file/section and propose the smallest correction consistent with the existing product intent.

Do not invent new product scope.
