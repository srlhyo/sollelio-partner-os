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
Phase 0 introduces no domain tables at all — the first wave belongs to Slice 1.

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
supabase start              # Postgres, Auth, Storage, Edge Runtime
supabase db reset           # replay every migration from scratch
supabase functions serve    # Edge Functions locally
```

Sign-in is magic link / email OTP only; there is no password anywhere
(§20). Locally, Inbucket at http://127.0.0.1:54324 catches the emails. Signup is
disabled: people are created invite-first — the auth user through the admin API,
then the profile bound to the returned `auth_user_id` (Slice 1).
