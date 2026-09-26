/**
 * The local stack's coordinates. `npx supabase status -o env` prints these; the
 * defaults match supabase/config.toml so the suite runs with no arguments.
 */
export const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54421';
export const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? '';
export const SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? '';
export const MAIL_URL = process.env.E2E_MAIL_URL ?? 'http://127.0.0.1:54424';
export const DB_URL = process.env.E2E_DB_URL ?? '';

export const PARTNER_EMAIL = 'nadia@example.test';
export const STAFF_EMAIL = 'helio@example.test';
export const ORGANIZATION_NAME = 'Do Luxo à Mesa';

/** Seeded canonical resources the partner must see. */
export const VISIBLE_RESOURCES = ['Sollelio Events', 'Site Do Luxo à Mesa', 'Ficheiros partilhados'];

/** Seeded resources the partner must never see. */
export const HIDDEN_RESOURCES = ['Events (endereço antigo)', 'Notas internas'];
