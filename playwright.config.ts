import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests.
 *
 * These run against the **real local Supabase stack** — real GoTrue, real PostgREST,
 * real RLS — not a mocked boundary. Sign-in is the genuine magic-link flow: the
 * suite types an email into the real form, reads the resulting message out of the
 * local mail catcher, and follows the link, exactly as Nádia will.
 *
 * Prerequisite: `npx supabase start`. `npm run e2e` does the rest.
 *
 * The port is not incidental: Supabase only redirects to allow-listed URLs, so this
 * port must appear in `additional_redirect_urls` (supabase/config.toml). 4173 is the
 * preview port and is kept separate from 5173, which a dev server may be holding.
 */
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${APP_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  globalSetup: './e2e/global-setup.ts',

  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'signed-out',
      testMatch: /signed-out\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'partner',
      testMatch: /partner\.spec\.ts/,
      dependencies: ['setup'],
      // The partner experience is mobile-first (03_UX_SPEC.md §24).
      use: { ...devices['Pixel 7'], storageState: '.auth/partner.json' },
    },
    {
      name: 'internal',
      testMatch: /internal\.spec\.ts/,
      dependencies: ['setup'],
      // The internal experience is desktop-first.
      use: { ...devices['Desktop Chrome'], storageState: '.auth/staff.json' },
    },
    {
      name: 'partner-boundary',
      testMatch: /boundary\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: '.auth/partner.json' },
    },
  ],

  webServer: {
    // Built, then served: `vite preview` serves a prebuilt bundle, and VITE_* values
    // are baked in at build time — so the build has to happen inside this command
    // with the stack's configuration, not merely be present in the environment.
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54421',
      VITE_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? '',
      VITE_APP_ENV: 'local',
    },
  },
});
