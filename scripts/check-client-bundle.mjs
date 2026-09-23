#!/usr/bin/env node
/**
 * Fails the build if a privileged credential reached the browser bundle.
 *
 * "The service-role credential must never reach the browser"
 * (04_TECHNICAL_ARCHITECTURE.md §7) and integration secrets are never shipped to
 * the Events browser (05_DATA_MODEL_AND_API.md §15). Those stay review rules until
 * something checks them, so this runs after every build, locally and in CI — and,
 * because netlify.toml builds with `npm run build && npm run check:client-bundle`,
 * inside the deploy itself.
 *
 * The rules live in lib/client-secret-scan.mjs so they can be tested directly.
 * This file is the walker: which files are read, and what the exit code is.
 *
 * Usage: check-client-bundle.mjs [directory]   (default: dist)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import process from 'node:process';
import { scanText } from './lib/client-secret-scan.mjs';

const target = process.argv[2] ?? 'dist';

/** Assets the browser executes. */
const EMITTED = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json']);

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
  for await (const file of walk(target)) {
    const ext = extname(file);
    const isEmitted = EMITTED.has(ext);
    const isMap = ext === '.map';
    if (!isEmitted && !isMap) continue;

    scanned += 1;
    const contents = await readFile(file, 'utf8');

    for (const why of scanText(contents, isMap ? 'sourcemap' : 'emitted')) {
      findings.push({ file, why });
    }
  }
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error(`No ${target}/ directory. Run "npm run build" first.`);
    process.exit(1);
  }
  throw error;
}

if (findings.length > 0) {
  console.error('Privileged credentials found in the client bundle:\n');
  for (const { file, why } of findings) console.error(`  ${file} — ${why}`);
  console.error('\nPrivileged credentials belong to Supabase Edge Functions only.');
  console.error('If this is a deploy, check the browser key configured for this environment.');
  process.exit(1);
}

console.log(`Client bundle clean — ${scanned} file(s) scanned, no privileged credentials.`);
