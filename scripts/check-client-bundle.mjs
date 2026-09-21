#!/usr/bin/env node
/**
 * Fails the build if a privileged credential reached the browser bundle.
 *
 * "The service-role credential must never reach the browser"
 * (04_TECHNICAL_ARCHITECTURE.md §7) and integration secrets are never shipped to
 * the Events browser (05_DATA_MODEL_AND_API.md §15). Those stay review rules until
 * something checks them, so this runs after every build, locally and in CI.
 *
 * Two tiers, because the two file kinds carry different risk:
 *
 *   Emitted assets (.js/.css/.html/.json) are what the browser executes. Any
 *   mention of a privileged credential here is a real finding — our code should
 *   never reference one, even by name.
 *
 *   Source maps additionally embed third-party source, where `service_role` appears
 *   in prose: @supabase/supabase-js documents its own API with it, including the
 *   line "Never expose your `service_role` key in the browser." Flagging vendor
 *   documentation would train everyone to ignore this check, so maps are scanned
 *   for actual credentials and for our own secret names only.
 *
 * Any JWT found anywhere is decoded and rejected if it carries a privileged role
 * claim — that catches a real key pasted into source regardless of how it is
 * formatted.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const DIST = 'dist';

/** Named secrets. Our code must never reference these, in any file. */
const NAMED_SECRETS = [
  { pattern: /SUPABASE_SERVICE_ROLE_KEY/i, why: 'Supabase service-role key reference' },
  { pattern: /PARTNER_OS_INTEGRATION_SECRET/i, why: 'Events V1 integration secret reference' },
];

/** Weaker signals: real in executable output, ordinary prose in vendor sources. */
const EMITTED_ONLY = [{ pattern: /service_role/i, why: 'service_role credential reference' }];

const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin']);
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}\b/g;

const EMITTED = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json']);

/** Rejects a JWT whose payload claims a privileged role. */
function privilegedJwts(contents) {
  const found = [];
  for (const match of contents.matchAll(JWT)) {
    const payload = match[1];
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof claims?.role === 'string' && PRIVILEGED_ROLES.has(claims.role)) {
        found.push(`JWT carrying role "${claims.role}"`);
      }
    } catch {
      // Not a JWT payload we can read — the textual rules still apply.
    }
  }
  return found;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const findings = [];
let scanned = 0;

try {
  for await (const file of walk(DIST)) {
    const ext = extname(file);
    const isEmitted = EMITTED.has(ext);
    const isMap = ext === '.map';
    if (!isEmitted && !isMap) continue;

    scanned += 1;
    const contents = await readFile(file, 'utf8');
    const rules = isEmitted ? [...NAMED_SECRETS, ...EMITTED_ONLY] : NAMED_SECRETS;

    for (const { pattern, why } of rules) {
      if (pattern.test(contents)) findings.push({ file, why });
    }
    for (const why of privilegedJwts(contents)) {
      findings.push({ file, why });
    }
  }
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error(`No ${DIST}/ directory. Run "npm run build" first.`);
    process.exit(1);
  }
  throw error;
}

if (findings.length > 0) {
  console.error('Privileged credentials found in the client bundle:\n');
  for (const { file, why } of findings) console.error(`  ${file} — ${why}`);
  console.error('\nPrivileged credentials belong to Supabase Edge Functions only.');
  process.exit(1);
}

console.log(`Client bundle clean — ${scanned} file(s) scanned, no privileged credentials.`);
