Read `CLAUDE.md` and every canonical document under `/docs` before modifying the repository.

Implement **Phase 0 — Engineering Foundation only** from `docs/06_BUILD_PLAN.md`.

Do not implement Slice 1, Requests, Updates, Issues, Events integration or AI functionality yet.

## Required outcome

Establish the smallest production-quality engineering foundation needed for the subsequent vertical slices:

- React + TypeScript application foundation;
- clear modular source structure consistent with the Technical Architecture;
- dedicated Partner OS Supabase project configuration/integration points;
- versioned migration structure;
- local, staging and production environment conventions;
- environment-variable handling with no privileged secrets exposed client-side;
- baseline auth/application shell wiring only where needed for the foundation;
- lint;
- typecheck;
- test runner;
- build;
- CI configuration appropriate to the repository;
- baseline application/error handling.

## Constraints

- Do not create the entire future schema.
- Do not build generic infrastructure for hypothetical future requirements.
- Do not introduce microservices, queues, event sourcing, complex RBAC or a generic repository/service framework.
- Do not couple Partner OS to the Sollelio Events V1 database.
- Keep the architecture a modular monolith.
- Any schema introduced must be versioned through migrations, not only dashboard configuration.

## Verification

Before finishing:

1. run lint;
2. run typecheck;
3. run tests;
4. run production build;
5. verify migrations/configuration are reproducible;
6. report any deviation from the canonical specification and why it was necessary.

Do not proceed to Slice 1 in this task.
