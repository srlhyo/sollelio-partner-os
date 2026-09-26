# `src/modules` — domain modules

Each module arrives with the slice that needs it (`06_BUILD_PLAN.md`), one directory
per bounded area from `04_TECHNICAL_ARCHITECTURE.md` §13:

| Module | Arrives in | Status |
| --- | --- | --- |
| `organizations`, `people`, `products`, `resources` | Slice 1 | present |
| `requests` | Slice 2 | present (C2: reads, commands, formatting, ordering) |
| `activity` | Slice 2 | read inside `requests` for now |
| `updates` | Slice 3 | not yet |
| `issues` | Slice 4 | not yet |
| `integrations` | Slice 5 | not yet |
| `ai` | Slice 7 | not yet |

`notifications` becomes a module only when a real reminder/delivery workflow
exists; it is not a V0 module.

A module owns its types, its data access and its domain behaviour. Privileged
lifecycle commands are Edge Functions under `supabase/functions/`, not client code:
partners never write lifecycle state directly
(`04_TECHNICAL_ARCHITECTURE.md` §8).
