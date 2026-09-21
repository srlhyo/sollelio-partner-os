#!/usr/bin/env node
/**
 * Proves the migration set is reproducible.
 *
 * Applies every migration, in filename order, to an empty database and then runs
 * the posture assertions. "Database migrations must be versioned and reproducible.
 * Do not rely on manual dashboard-only schema edits"
 * (04_TECHNICAL_ARCHITECTURE.md §14).
 *
 * With DATABASE_URL set (CI), it uses that database. Without one, it starts a
 * throwaway PostgreSQL container and removes it afterwards.
 */
import { execFileSync, execSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import process from 'node:process';

const MIGRATIONS = 'supabase/migrations';
const VERIFY = 'supabase/verify';
const IMAGE = 'postgres:15-alpine';
const CONTAINER = 'partner-os-migration-check';

/**
 * Files under supabase/verify/ run in filename order: `0x` before the migrations
 * (the Supabase-shaped scaffolding they assume), `9x` after (fixtures, then the
 * assertions that must hold once everything is applied).
 */
async function verifyFiles(prefix) {
  return (await readdir(VERIFY))
    .filter((f) => f.endsWith('.sql') && f.startsWith(prefix))
    .sort()
    .map((f) => `${VERIFY}/${f}`);
}

function psql(url, file) {
  execFileSync('psql', ['--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-f', file, url], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

async function migrationFiles() {
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();

  const seen = new Map();
  for (const file of files) {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file);
    if (!match) {
      throw new Error(
        `Migration "${file}" does not follow <14-digit timestamp>_<snake_case>.sql. ` +
          'Ordering depends on the convention.',
      );
    }
    const stamp = match[1];
    if (seen.has(stamp)) {
      throw new Error(`Duplicate migration timestamp ${stamp}: ${seen.get(stamp)} and ${file}.`);
    }
    seen.set(stamp, file);
  }
  return files;
}

function startContainer() {
  console.log(`Starting ${IMAGE}…`);
  execSync(`docker rm -f ${CONTAINER} >/dev/null 2>&1 || true`, { stdio: 'ignore' });
  execSync(
    `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -p 55432:5432 ${IMAGE}`,
    { stdio: 'ignore' },
  );
  const url = 'postgresql://postgres:postgres@127.0.0.1:55432/postgres';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      execFileSync('psql', ['--quiet', '-c', 'select 1', url], { stdio: 'ignore' });
      return url;
    } catch {
      execSync('sleep 1');
    }
  }
  throw new Error('PostgreSQL container did not become ready.');
}

function stopContainer() {
  execSync(`docker rm -f ${CONTAINER} >/dev/null 2>&1 || true`, { stdio: 'ignore' });
}

const files = await migrationFiles();
console.log(`${files.length} migration(s) in order:`);
for (const file of files) console.log(`  ${file}`);

const external = process.env.DATABASE_URL;
const url = external ?? startContainer();

try {
  for (const file of await verifyFiles('0')) {
    console.log(`Scaffolding ${file}`);
    psql(url, file);
  }

  for (const file of files) {
    console.log(`Applying ${file}`);
    psql(url, `${MIGRATIONS}/${file}`);
  }

  for (const file of await verifyFiles('9')) {
    console.log(`Checking ${file}`);
    psql(url, file);
  }

  console.log('\nMigrations applied cleanly; posture and authorization hold.');
} finally {
  if (!external) stopContainer();
}
