# `src/platform` — infrastructure only

Cross-cutting technical concerns: environment validation, the browser Supabase
client, session plumbing, logging and error handling.

**No domain behaviour lives here.** Organizations, people, products, resources,
requests, updates, issues, activity, integrations and AI each get their own module
under `src/modules/` as their slice arrives
(`04_TECHNICAL_ARCHITECTURE.md` §13). This directory must never become the
`utils/` or `services/` dumping ground that document warns against.

The rule of thumb: if removing Partner OS's product meaning would leave the file
unchanged, it belongs here. Otherwise it belongs in a module.
