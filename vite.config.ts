import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Partner OS SPA build.
 *
 * Only `VITE_*` variables are exposed to client code (Vite's default). Privileged
 * secrets — the Supabase service-role key, the Events V1 integration secret — live
 * exclusively in Edge Function environments and must never be prefixed `VITE_`.
 * `scripts/check-client-bundle.mjs` enforces this against the built output.
 */

/** Client configuration required for the app to run at all. */
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_APP_ENV'] as const;

export default defineConfig(({ command, mode }) => {
  // A production build missing its configuration would deploy and then fail in the
  // partner's browser. Fail here instead, where someone is watching.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const missing = REQUIRED.filter((key) => !env[key]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `Cannot build without ${missing.join(', ')}. ` +
          'Set them for this deploy context (see .env.example and netlify.toml).',
      );
    }
  }

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    server: {
      port: 5173,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['e2e/**'],
      // Placeholder client configuration. Tests never contact a real project.
      env: {
        VITE_SUPABASE_URL: 'https://partner-os-test.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test-anon-key',
        VITE_APP_ENV: 'local',
      },
    },
  };
});
