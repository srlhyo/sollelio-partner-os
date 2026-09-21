# Sollelio Partner OS

The platform through which Sollelio collaborates with Design Partners. Read
[`docs/00_README.md`](docs/00_README.md) and the canonical documents it lists before
making product, architecture, data-model, UX or implementation decisions.

**Current state: Phase 0 — engineering foundation.** There is no product
functionality yet. Organizations, Resources, Requests, Updates, Issues, the Events
V1 integration and AI each arrive with their own slice
([`docs/06_BUILD_PLAN.md`](docs/06_BUILD_PLAN.md)).

## Running it

```bash
npm install
cp .env.example .env.local   # fill in the local Supabase values
npm run dev                  # http://127.0.0.1:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run check:client-bundle` | Fails if a privileged credential reached the bundle |
| `npm run db:verify` | Applies every migration to an empty database and asserts the security posture |
| `npm run verify` | Everything CI runs for the app |

## Layout

```
src/
  App.tsx            route map: /partner/* and /app/*
  platform/          infrastructure only — env, Supabase client, session, logging, errors
  partner/           /partner/*  — partner-facing surface
  internal/          /app/*      — Sollelio internal surface
  modules/           domain modules, one per slice (empty in Phase 0)
supabase/
  migrations/        versioned schema; the only way schema changes
  functions/         Edge Functions — all privileged server-side code
  verify/            fixtures and assertions for `npm run db:verify`
scripts/             build and database verification
```

Two surfaces, one application. They share infrastructure but are separate user
experiences and separate security surfaces
([`docs/04_TECHNICAL_ARCHITECTURE.md`](docs/04_TECHNICAL_ARCHITECTURE.md) §5). Route
guards are a UX concern; security is enforced by RLS, partner projections and domain
commands — never by the router.

`src/platform/` holds only technical concerns. Domain behaviour belongs in
`src/modules/<module>/`, never in a `utils/` or `services/` catch-all (§13).

## Environments

Three: `local`, `staging`, `production`. Each has its own Supabase project and its
own Netlify context.

Client configuration is public — Vite inlines `VITE_*` into the browser bundle:

| Variable | Meaning |
| --- | --- |
| `VITE_SUPABASE_URL` | This environment's Partner OS Supabase project |
| `VITE_SUPABASE_ANON_KEY` | Anon key; every request it makes is subject to RLS |
| `VITE_APP_ENV` | `local` \| `staging` \| `production` |

Privileged secrets — the service-role key, the Events V1 integration secret — are
**never** prefixed `VITE_` and exist only as Edge Function secrets. Three things
enforce that rather than trusting review: an ESLint rule bans reading them from
client code, the build fails when required client configuration is missing, and
`check:client-bundle` scans the built output (including source maps) for credential
references and decodes any JWT it finds to reject privileged role claims.

## Deployment

Netlify builds and hosts the SPA from Git. It runs no server-side logic: every
privileged operation and every `/v1/*` integration endpoint is a Supabase Edge
Function (§2).

Database migrations and Edge Functions ship together through
`.github/workflows/deploy-supabase.yml`. Schema is never edited in the dashboard
(§14).

## CI

`.github/workflows/ci.yml` runs three jobs: the app (lint, typecheck, test, build,
bundle scan), migration reproducibility against a real PostgreSQL instance, and a
Deno typecheck of the Edge Functions.
