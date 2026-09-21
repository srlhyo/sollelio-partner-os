#!/usr/bin/env node
/**
 * Seeds the first real partner organization.
 *
 * Runs server-side only, with the service-role key. Never in a browser, never in the
 * SPA build (04_TECHNICAL_ARCHITECTURE.md §7).
 *
 * People are created invite-first, in the documented order
 * (04_TECHNICAL_ARCHITECTURE.md §20):
 *   1. invite/create the Supabase Auth user;
 *   2. create the profile bound to the returned auth_user_id;
 *   3. create the active organization membership.
 *
 * `profiles.auth_user_id` is NOT NULL with a foreign key to auth.users, so that
 * order is enforced by the database rather than by this script remembering it.
 *
 * Idempotent: re-running adopts whatever already exists instead of duplicating it.
 *
 * Every identity and URL is required — see requireValue below. Nothing is guessed.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   SEED_PARTNER_EMAIL=... SEED_STAFF_EMAIL=... \
 *   SEED_EVENTS_URL=... SEED_WEBSITE_URL=... SEED_DRIVE_URL=... npm run seed
 *
 * Add --local to create confirmed users directly instead of emailing invitations,
 * which is what you want against a local stack.
 */
import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const local = process.argv.includes('--local');

if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. This script never runs in a browser.');
  process.exit(1);
}

const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

/**
 * Identities and canonical URLs are required, never guessed.
 *
 * This script invites real people by email and publishes the links a partner is told
 * to trust. A wrong default would either email a stranger or point Nádia at an
 * address that is not ours, so there are no defaults: supply them explicitly.
 */
function requireValue(name, hint) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name} — ${hint}`);
    console.error('\nNothing was written. Set every required value and run again.');
    process.exit(1);
  }
  return value;
}

/** The pilot, as documented in 07_DO_LUXO_A_MESA_PILOT.md. */
const ORGANIZATION = { name: 'Do Luxo à Mesa', slug: 'do-luxo-a-mesa' };

const PEOPLE = [
  {
    email: requireValue('SEED_PARTNER_EMAIL', "the partner's real email address; she is invited at it"),
    displayName: process.env.SEED_PARTNER_NAME?.trim() || 'Nádia',
    staff: false,
    member: true,
  },
  {
    email: requireValue('SEED_STAFF_EMAIL', 'the Sollelio operator email address'),
    displayName: process.env.SEED_STAFF_NAME?.trim() || 'Hélio Schultz',
    staff: true,
    member: false,
  },
];

const PRODUCTS = [
  { key: 'sollelio-events-v1', name: 'Sollelio Events', type: 'application' },
  { key: 'do-luxo-a-mesa-website', name: 'Site Do Luxo à Mesa', type: 'website' },
];

const RESOURCES = [
  {
    name: 'Sollelio Events',
    type: 'product',
    productKey: 'sollelio-events-v1',
    url: requireValue('SEED_EVENTS_URL', 'the current Sollelio Events address for this organization'),
    sortOrder: 1,
  },
  {
    name: 'Site Do Luxo à Mesa',
    type: 'website',
    productKey: 'do-luxo-a-mesa-website',
    url: requireValue('SEED_WEBSITE_URL', 'the current Do Luxo à Mesa website address'),
    sortOrder: 2,
  },
  {
    name: 'Ficheiros partilhados',
    type: 'folder',
    productKey: null,
    url: requireValue('SEED_DRIVE_URL', 'the shared files location for this organization'),
    sortOrder: 3,
  },
];

function fail(step, error) {
  console.error(`\n${step} failed: ${error.message ?? error}`);
  process.exit(1);
}

/** Step 1 — the auth user must exist before any profile can reference it. */
async function ensureAuthUser({ email, displayName }) {
  const { data: existing, error: listError } = await db.auth.admin.listUsers({ perPage: 200 });
  if (listError) fail('Listing auth users', listError);

  const found = existing.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (found) {
    console.log(`  auth user exists       ${email}`);
    return found.id;
  }

  if (local) {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error) fail(`Creating auth user ${email}`, error);
    console.log(`  auth user created      ${email}`);
    return data.user.id;
  }

  const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
  });
  if (error) fail(`Inviting ${email}`, error);
  console.log(`  auth user invited      ${email}`);
  return data.user.id;
}

/** Step 2 — the profile, bound to the auth user just created. */
async function ensureProfile(authUserId, { displayName, staff }) {
  const { data: existing, error: readError } = await db
    .from('profiles')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (readError) fail('Reading profile', readError);

  if (existing) {
    console.log(`  profile exists         ${displayName}`);
    return existing.id;
  }

  const { data, error } = await db
    .from('profiles')
    .insert({ auth_user_id: authUserId, display_name: displayName, is_sollelio_staff: staff })
    .select('id')
    .single();
  if (error) fail(`Creating profile for ${displayName}`, error);
  console.log(`  profile created        ${displayName}${staff ? ' (Sollelio)' : ''}`);
  return data.id;
}

async function ensureRow(table, match, insert, label) {
  const query = db.from(table).select('id');
  for (const [column, value] of Object.entries(match)) query.eq(column, value);

  const { data: existing, error: readError } = await query.maybeSingle();
  if (readError) fail(`Reading ${table}`, readError);
  if (existing) {
    console.log(`  ${label} exists`.padEnd(40) + JSON.stringify(match));
    return existing.id;
  }

  const { data, error } = await db.from(table).insert(insert).select('id').single();
  if (error) fail(`Creating ${table}`, error);
  console.log(`  ${label} created`.padEnd(40) + JSON.stringify(match));
  return data.id;
}

console.log(`Seeding ${ORGANIZATION.name} into ${url}${local ? ' (local mode)' : ''}\n`);

console.log('People (invite-first):');
const profiles = new Map();
for (const person of PEOPLE) {
  const authUserId = await ensureAuthUser(person);
  const profileId = await ensureProfile(authUserId, person);
  profiles.set(person.email, { profileId, person });
}

console.log('\nOrganization:');
const organizationId = await ensureRow(
  'organizations',
  { slug: ORGANIZATION.slug },
  { name: ORGANIZATION.name, slug: ORGANIZATION.slug, status: 'active' },
  'organization',
);

console.log('\nMemberships:');
for (const { profileId, person } of profiles.values()) {
  if (!person.member) continue;
  await ensureRow(
    'organization_memberships',
    { organization_id: organizationId, profile_id: profileId },
    { organization_id: organizationId, profile_id: profileId, role: 'partner_member', status: 'active' },
    'membership',
  );
}

console.log('\nProducts:');
const productIds = new Map();
for (const product of PRODUCTS) {
  const id = await ensureRow(
    'products',
    { key: product.key },
    { key: product.key, name: product.name, type: product.type, status: 'active' },
    'product',
  );
  productIds.set(product.key, id);

  await ensureRow(
    'organization_products',
    { organization_id: organizationId, product_id: id },
    { organization_id: organizationId, product_id: id, status: 'active' },
    'organization_product',
  );
}

console.log('\nCanonical resources:');
const staffProfileId = [...profiles.values()].find((entry) => entry.person.staff)?.profileId ?? null;
for (const resource of RESOURCES) {
  await ensureRow(
    'resources',
    { organization_id: organizationId, name: resource.name },
    {
      organization_id: organizationId,
      product_id: resource.productKey ? productIds.get(resource.productKey) : null,
      name: resource.name,
      type: resource.type,
      url: resource.url,
      status: 'active',
      partner_visible: true,
      sort_order: resource.sortOrder,
      created_by: staffProfileId,
    },
    'resource',
  );
}

console.log('\nDone. The partner signs in with a magic link; there is no password to set.');
