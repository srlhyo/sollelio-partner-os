/**
 * Client environment, validated once at startup.
 *
 * Only `VITE_*` variables exist here, and every one of them is public: Vite inlines
 * them into the browser bundle. The service-role credential and the Events V1
 * integration secret must never reach the browser
 * (04_TECHNICAL_ARCHITECTURE.md §7, §15) and therefore never appear in this file.
 */

export type AppEnvironment = 'local' | 'staging' | 'production';

export interface ClientEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appEnv: AppEnvironment;
}

export class EnvConfigError extends Error {
  override readonly name = 'EnvConfigError';
}

const APP_ENVIRONMENTS: readonly AppEnvironment[] = ['local', 'staging', 'production'];

function isAppEnvironment(value: string): value is AppEnvironment {
  return (APP_ENVIRONMENTS as readonly string[]).includes(value);
}

function required(raw: Record<string, string | undefined>, key: string): string {
  const value = raw[key];
  if (value === undefined || value.trim() === '') {
    throw new EnvConfigError(
      `Missing ${key}. Copy .env.example to .env.local and fill in the Partner OS project values.`,
    );
  }
  return value.trim();
}

export function readClientEnv(raw: Record<string, string | undefined>): ClientEnv {
  const appEnv = required(raw, 'VITE_APP_ENV');
  if (!isAppEnvironment(appEnv)) {
    throw new EnvConfigError(
      `VITE_APP_ENV must be one of ${APP_ENVIRONMENTS.join(', ')} — received "${appEnv}".`,
    );
  }

  const supabaseUrl = required(raw, 'VITE_SUPABASE_URL');
  try {
    new URL(supabaseUrl);
  } catch {
    throw new EnvConfigError(`VITE_SUPABASE_URL is not a valid URL — received "${supabaseUrl}".`);
  }

  return {
    supabaseUrl,
    supabaseAnonKey: required(raw, 'VITE_SUPABASE_ANON_KEY'),
    appEnv,
  };
}

export const env: ClientEnv = readClientEnv(
  import.meta.env as unknown as Record<string, string | undefined>,
);
