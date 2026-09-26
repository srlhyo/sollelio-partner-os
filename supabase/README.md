# Supabase — the Partner OS project

Partner OS has its **own** Supabase project, separate from Sollelio Events V1. Never
place Partner OS tables in the Events database, and never point this project's
configuration at it (`docs/04_TECHNICAL_ARCHITECTURE.md` §3).

```
config.toml    local stack configuration
migrations/    versioned schema — the only way schema ever changes
functions/     Edge Functions — all privileged server-side code
verify/        fixtures and assertions used by `npm run db:verify`
```

## Migrations

One file per change, named `<14-digit UTC timestamp>_<snake_case>.sql`, applied in
filename order. `npm run db:verify` enforces the convention, rejects duplicate
timestamps, applies every migration to an empty database and then asserts the
security posture still holds.

**Each delivery slice owns exactly one migration wave**
(`docs/05_DATA_MODEL_AND_API.md` §17). Do not create a later wave's tables early.

| Migration | Wave |
| --- | --- |
| `…120000_baseline_security_posture` | Phase 0 — no domain tables |
| `…130000_slice1_organizations_products_resources` | Wave 1 — Slice 1 |
| `20260923120000_slice2_requests_and_activity` | Wave 2 — Slice 2, C1 (Requests persistence and RLS) |
| `20260925160000_slice2_c2_request_authoring` | Wave 2 — Slice 2, C2 (revision, resource link, one partner projection, command receipts, the C2 commands) |

Migrations are never edited once committed; a checkpoint that evolves an earlier
object adds a new migration (C2 redefines `partner_requests` on top of
`app.partner_request_projection` without touching the C1 file).

The C2 commands are SQL functions executable only by `service_role` and are called
by the `request-commands` Edge Function (`05_DATA_MODEL_AND_API.md` §13). Locally,
`supabase start` serves the function; if the stack was started before the function
existed, run `npx supabase functions serve`.

One thing Slice 1 carries that is not domain schema: every function it creates
revokes EXECUTE from PUBLIC explicitly. PostgreSQL grants EXECUTE on new functions to
PUBLIC, and no `ALTER DEFAULT PRIVILEGES` setting can take that back — verified
empirically on PostgreSQL 15. `verify/90_assert_posture.sql` therefore fails the
build if any function in `app` is left without that revoke.

What Phase 0 does establish is the posture every later wave inherits: the `app`
schema for privileged helpers, closed to the API roles, and default privileges
revoked so a new table is unreachable by `anon` and `authenticated` before anyone
writes a policy. That makes a forgotten `enable row level security` fail closed
instead of open. `verify/99_assert_posture.sql` proves it with a probe table on
every run.

## Edge Functions

All privileged server-side logic runs here — the domain commands that need
elevation, and every `/v1/*` integration endpoint (§2). Netlify runs none of it, so
the service-role key and the Events V1 integration secret live in exactly one
runtime.

`health/` is deployment plumbing: it verifies the function pipeline and reports
whether configuration is present, never what it contains. It reads no table and
exposes no domain data.

Secrets are set per project and never committed:

```bash
supabase secrets set PARTNER_OS_INTEGRATION_SECRET=... --project-ref <ref>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

## Local stack

```bash
npx supabase start          # Postgres, Auth, Storage, Edge Runtime
npx supabase db reset       # replay every migration from scratch
npx supabase functions serve
```

Local ports are in the 544xx range, not Supabase's 543xx defaults, so this stack
coexists with other local Supabase projects instead of fighting them for 54321/54322.
The API is on 54421, the database on 54422, Studio on 54423 and the mail catcher on
54424.

One config subtlety worth knowing: `[auth.email] enable_signup` is the email
*provider* switch, not a signup-only one. Setting it false returns
"Email logins are disabled" and breaks the only way into Partner OS. Self-signup is
prevented by `[auth] enable_signup = false` and by the client passing
`shouldCreateUser: false`, so people still arrive invite-first.

Sign-in is magic link / email OTP only; there is no password anywhere
(§20). Locally, Inbucket at http://127.0.0.1:54324 catches the emails. Signup is
disabled: people are created invite-first — the auth user through the admin API,
then the profile bound to the returned `auth_user_id` (Slice 1).
