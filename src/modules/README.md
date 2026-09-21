# `src/modules` — domain modules

Empty in Phase 0 by design. Each module arrives with the slice that needs it
(`06_BUILD_PLAN.md`), one directory per bounded area from
`04_TECHNICAL_ARCHITECTURE.md` §13:

| Module | Arrives in |
| --- | --- |
| `organizations`, `people`, `products`, `resources` | Slice 1 |
| `requests`, `activity` | Slice 2 |
| `updates` | Slice 3 |
| `issues` | Slice 4 |
| `integrations` | Slice 5 |
| `ai` | Slice 7 |

`notifications` becomes a module only when a real reminder/delivery workflow
exists; it is not a V0 module.

A module owns its types, its data access and its domain behaviour. Privileged
lifecycle commands are Edge Functions under `supabase/functions/`, not client code:
partners never write lifecycle state directly
(`04_TECHNICAL_ARCHITECTURE.md` §8).
