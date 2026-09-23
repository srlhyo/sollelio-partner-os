/**
 * The browser Supabase client for the Partner OS project.
 *
 * This client carries the anon key and the signed-in user's JWT, so every request
 * it makes is subject to RLS. It is the only Supabase client in the browser; the
 * service-role client exists solely inside Edge Functions
 * (04_TECHNICAL_ARCHITECTURE.md §2, §7).
 */
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
// Imported for its side effect as much as anything: this module snapshots the
// authentication outcome in the URL, and must run before the client below consumes
// and rewrites it. ES module evaluation order guarantees that.
import '../auth/authReturn';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    // Magic link / email OTP: the session arrives in the URL and is persisted here
    // (04_TECHNICAL_ARCHITECTURE.md §20).
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});
