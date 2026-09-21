#!/usr/bin/env node
/**
 * Verifies the complete Slice 1 operational path against a real Supabase project.
 *
 * Works unchanged against the local stack and against staging: point it at a project
 * and it exercises the whole pilot path end to end —
 *
 *   organization, membership, products and canonical resources exist;
 *   the partner signs in through a real magic-link exchange;
 *   with her own session she sees exactly her organization and exactly the
 *     active, partner-visible resources, and nothing belonging to anyone else;
 *   integration data stays invisible to her;
 *   she cannot escalate herself to Sollelio staff;
 *   a Sollelio operator can reach the organization surface.
 *
 * The magic link is minted with `auth.admin.generateLink`, which returns the token
 * without sending an email, so this runs without mailbox access. The link is then
 * redeemed with the **anon** key, so every assertion below runs as the partner
 * herself, under RLS. The service-role key is used only to mint the link and to read
 * back ground truth — never to stand in for the partner, and never in a browser.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   PARTNER_EMAIL=... STAFF_EMAIL=... ORGANIZATION_SLUG=do-luxo-a-mesa \
 *   node scripts/verify-pilot-path.mjs
 */
import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

function required(name, hint) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name} — ${hint}`);
    process.exit(1);
  }
  return value;
}

const url = required('SUPABASE_URL', 'the Partner OS project URL for this environment');
const anonKey = required('SUPABASE_ANON_KEY', 'the anon key; the partner acts with this');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY', 'used only to mint links and read ground truth');
const partnerEmail = required('PARTNER_EMAIL', "the partner's email address");
const staffEmail = required('STAFF_EMAIL', 'the Sollelio operator email address');
const slug = process.env.ORGANIZATION_SLUG?.trim() || 'do-luxo-a-mesa';

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** Redeem a real magic link and return a client acting as that person. */
async function signInAs(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`Could not mint a magic link for ${email}: ${error.message}`);

  const asUser = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: session, error: verifyError } = await asUser.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyError) throw new Error(`Magic-link exchange failed for ${email}: ${verifyError.message}`);
  if (!session.session) throw new Error(`No session returned for ${email}.`);

  return asUser;
}

console.log(`Verifying the Slice 1 pilot path against ${url}\n`);

// --- Ground truth -----------------------------------------------------------
console.log('Seeded state:');
const { data: org } = await admin.from('organizations').select('id, name, status').eq('slug', slug).maybeSingle();
check(`organization "${slug}" exists`, Boolean(org), org?.name);
if (!org) {
  console.error('\nNothing further can be verified. Run the seed first.');
  process.exit(1);
}

const { data: members } = await admin
  .from('organization_memberships')
  .select('status, profiles(display_name, is_sollelio_staff)')
  .eq('organization_id', org.id);
const activeMembers = (members ?? []).filter((m) => m.status === 'active');
check('has at least one active membership', activeMembers.length > 0, `${activeMembers.length} active`);
check(
  'no Sollelio staff is modelled as a member',
  !(members ?? []).some((m) => m.profiles?.is_sollelio_staff),
);

const { data: orgProducts } = await admin
  .from('organization_products')
  .select('id, products(key, name)')
  .eq('organization_id', org.id);
check('products are linked', (orgProducts ?? []).length >= 2, (orgProducts ?? []).map((p) => p.products?.key).join(', '));

const { data: allResources } = await admin.from('resources').select('id, name, status, partner_visible').eq('organization_id', org.id);
const expectedVisible = (allResources ?? []).filter((r) => r.status === 'active' && r.partner_visible);
check('canonical resources exist', expectedVisible.length >= 3, `${expectedVisible.length} active and partner-visible`);

// --- The partner, through a real magic-link sign-in -------------------------
console.log('\nPartner, signed in with a real magic link:');
const partner = await signInAs(partnerEmail);
check('magic-link sign-in succeeded', true, partnerEmail);

const { data: partnerOrgs } = await partner.from('organizations').select('id, slug');
check('sees exactly one organization', (partnerOrgs ?? []).length === 1, (partnerOrgs ?? []).map((o) => o.slug).join(', '));
check('and it is the right one', partnerOrgs?.[0]?.id === org.id);

const { data: partnerResources } = await partner.from('resources').select('id, name, status, partner_visible');
check(
  'sees only active, partner-visible resources',
  (partnerResources ?? []).length === expectedVisible.length,
  `${(partnerResources ?? []).length} of ${(allResources ?? []).length} total`,
);
check(
  'no superseded or internal-only resource leaked',
  (partnerResources ?? []).every((r) => r.status === 'active' && r.partner_visible),
);

const { data: partnerProducts } = await partner.from('products').select('id');
check('cannot read products', (partnerProducts ?? []).length === 0);

const { data: partnerOrgProducts } = await partner.from('organization_products').select('id');
check('cannot read organization_products (external_tenant_id)', (partnerOrgProducts ?? []).length === 0);

const { data: partnerProfiles } = await partner.from('profiles').select('id');
check('sees only her own profile', (partnerProfiles ?? []).length === 1, `${(partnerProfiles ?? []).length} row(s)`);

const { error: escalation } = await partner
  .from('profiles')
  .update({ is_sollelio_staff: true })
  .eq('auth_user_id', (await partner.auth.getUser()).data.user?.id ?? '');
check('cannot escalate herself to Sollelio staff', Boolean(escalation), escalation?.message ?? 'the update succeeded');

const { error: writeAttempt } = await partner
  .from('resources')
  .insert({ organization_id: org.id, name: 'Falso', type: 'other', url: 'https://mau.test' });
check('cannot create a canonical resource', Boolean(writeAttempt), writeAttempt?.message ?? 'the insert succeeded');

// --- The Sollelio operator --------------------------------------------------
console.log('\nSollelio operator:');
const staff = await signInAs(staffEmail);
check('magic-link sign-in succeeded', true, staffEmail);

const { data: staffOrgs } = await staff.from('organizations').select('id');
check('reaches the organization surface', (staffOrgs ?? []).length >= 1, `${(staffOrgs ?? []).length} organization(s)`);

const { data: staffResources } = await staff.from('resources').select('id').eq('organization_id', org.id);
check('sees every resource, including superseded', (staffResources ?? []).length === (allResources ?? []).length);

const { data: staffOrgProducts } = await staff.from('organization_products').select('id').eq('organization_id', org.id);
check('sees the product links', (staffOrgProducts ?? []).length === (orgProducts ?? []).length);

const { data: staffMembers } = await staff.from('organization_memberships').select('id').eq('organization_id', org.id);
check('sees the organization members', (staffMembers ?? []).length === (members ?? []).length);

console.log(
  failures === 0
    ? '\nThe Slice 1 pilot path holds end to end.'
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
