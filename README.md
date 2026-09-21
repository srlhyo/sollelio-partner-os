# Sollelio Partner OS

The platform through which Sollelio collaborates with Design Partners. Read
[`docs/00_README.md`](docs/00_README.md) and the canonical documents it lists before
making product, architecture, data-model, UX or implementation decisions.

**Current state: Slice 1 — Organizations, Products, Resources.** A partner signs in
with a magic link and finds the current canonical links; Sollelio manages those links
and sees who belongs to an organization. Requests, Updates, Issues, the Events V1
integration and AI each arrive with their own slice
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
| `npm run e2e` | Browser E2E against the local Supabase stack |
| `npm run seed` | Seeds the first organization, invite-first (server-side, service-role) |
| `npm run verify:pilot` | Verifies the whole operational path against a real project |

## Routes

| Route | Surface | What it is |
| --- | --- | --- |
| `/partner` | Partner | Home — greeting and canonical quick access |
| `/partner/resources` | Partner | Every canonical link for the organization |
| `/partner/sign-in` | Partner | Magic link request; no password field exists |
| `/partner/check-email` | Partner | "We sent you a link", a designed screen |
| `/partner/link-expired` | Partner | Expired or used link, with the way back |
| `/app/organizations` | Internal | Every partner organization (global scope) |
| `/app/organizations/:slug` | Internal | Organization overview (organization scope) |
| `/app/organizations/:slug/resources` | Internal | Manage canonical resources |
| `/app/organizations/:slug/people` | Internal | Who belongs to the organization |

Paths stay English because they are identifiers, like table and command names.
Everything a person reads is Portuguese (pt-PT).

## Layout

```
src/
  App.tsx            route map: /partner/* and /app/*
  platform/          infrastructure only — env, Supabase client, session, logging, errors
  partner/           /partner/*  — partner-facing surface
  internal/          /app/*      — Sollelio internal surface
  auth/              magic-link sign-in, session guard
  modules/           domain modules, one per slice
    organizations/   organizations and the partner's active-membership context
    people/          profiles and organization members
    products/        products linked to an organization (staff only)
    resources/       canonical URLs — reads and Sollelio-side operations
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

## Seeding the pilot

People are created invite-first — auth user, then profile, then membership — because
`profiles.auth_user_id` is NOT NULL with a foreign key to `auth.users`. The order is
enforced by the database, not by remembering it.

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed          # invites by email
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed -- --local  # local stack
```

Re-running adopts what already exists rather than duplicating it.

## Testing

Three layers, each proving something the others cannot:

| Layer | Runs against | Proves |
| --- | --- | --- |
| `npm test` (Vitest) | Mocked data boundary | Routing, guards and rendering logic, fast |
| `npm run db:verify` (SQL) | Real PostgreSQL | Migrations replay; RLS holds for impersonated callers |
| `npm run e2e` (Playwright) | **Real Supabase stack** | The whole thing, in a browser, with real auth |

The browser suite is not mocked. It types an email into the real form, reads the
message Supabase actually sent out of the local mail catcher, follows the link, and
lands with a real session — the same path Nádia takes. Start the stack first:

```bash
npx supabase start   # local ports are 544xx, so other local projects keep 543xx
npm run e2e
```

`npm run verify:pilot` exercises the operational path — seeded state, a real
magic-link exchange, then every visibility rule asserted as the partner herself under
RLS. It works unchanged against the local stack and against staging.

## CI

`.github/workflows/ci.yml` runs four jobs: the app (lint, typecheck, test, build,
bundle scan); the database, which replays every migration onto an empty PostgreSQL
instance and then runs the baseline posture checks and the release-blocking
authorization assertions; a Deno typecheck of the Edge Functions; and the browser
E2E suite against a Supabase stack started in the runner.

The authorization assertions in `supabase/verify/92_assert_rls.sql` impersonate real
callers the way PostgREST does — `set role authenticated` plus the request's JWT
claims — and cover tenant isolation, resource visibility, integration data staying
internal, staff identity being global, and self-escalation being impossible.
