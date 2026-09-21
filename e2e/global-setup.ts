/**
 * Puts the local project into a known state before the browser suite runs.
 *
 * Idempotent: it seeds the pilot organization if it is not there, and makes sure the
 * two negative cases exist — a superseded link and an internal-only one — so
 * "the partner sees only what she should" is a claim with something to exclude.
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import {
  ANON_KEY,
  HIDDEN_RESOURCES,
  PARTNER_EMAIL,
  SERVICE_ROLE_KEY,
  STAFF_EMAIL,
  SUPABASE_URL,
} from './helpers/env';

export default async function globalSetup() {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error(
      'E2E needs the local stack keys. Run `npx supabase start`, then `npm run e2e` ' +
        '(which exports them), or set E2E_SUPABASE_ANON_KEY and ' +
        'E2E_SUPABASE_SERVICE_ROLE_KEY yourself.',
    );
  }

  execFileSync('node', ['scripts/seed-organization.mjs', '--local'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      SEED_PARTNER_EMAIL: PARTNER_EMAIL,
      SEED_STAFF_EMAIL: STAFF_EMAIL,
      SEED_EVENTS_URL: 'https://events.example.test/do-luxo-a-mesa',
      SEED_WEBSITE_URL: 'https://doluxoamesa.example.test',
      SEED_DRIVE_URL: 'https://drive.example.test/do-luxo-a-mesa',
    },
  });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: organization } = await admin
    .from('organizations')
    .select('id')
    .eq('slug', 'do-luxo-a-mesa')
    .single();

  if (!organization) throw new Error('Seeding did not produce the pilot organization.');

  const negatives = [
    {
      name: HIDDEN_RESOURCES[0],
      type: 'product',
      url: 'https://old.events.example.test',
      status: 'superseded',
      partner_visible: true,
      sort_order: 90,
    },
    {
      name: HIDDEN_RESOURCES[1],
      type: 'document',
      url: 'https://internal.example.test/notas',
      status: 'active',
      partner_visible: false,
      sort_order: 91,
    },
  ];

  for (const negative of negatives) {
    const { data: existing } = await admin
      .from('resources')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('name', negative.name)
      .maybeSingle();

    if (!existing) {
      const { error } = await admin
        .from('resources')
        .insert({ organization_id: organization.id, ...negative });
      if (error) throw new Error(`Could not create the "${negative.name}" fixture: ${error.message}`);
    }
  }
}
