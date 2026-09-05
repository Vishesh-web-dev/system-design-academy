import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';

/**
 * Recreates the E2E database from empty, then migrates and seeds it.
 *
 * Runs as part of Playwright's webServer command rather than globalSetup,
 * because Playwright starts the server before globalSetup — and the server
 * connects on its first request. Doing it here also proves that migrations
 * apply to a completely clean database (V1 DoD item 13).
 */
async function prepare() {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) config({ path: file, override: false, quiet: true });
  }

  const target =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2') ??
    'postgresql://sda:sda@localhost:5433/system_design_academy_test';

  const url = new URL(target);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(target);
  adminUrl.pathname = '/postgres';

  const { Client } = await import('pg');
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  // Recreate from scratch: every run starts from an empty database.
  await admin.query(`drop database if exists "${dbName}" with (force)`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();

  const env = { ...process.env, DATABASE_URL: target, AI_PROVIDER: 'mock' };
  execFileSync('npx', ['tsx', 'scripts/migrate.ts'], { env, stdio: 'inherit' });
  execFileSync('npx', ['tsx', 'scripts/seed.ts'], { env, stdio: 'inherit' });

  console.log(`E2E database ready: ${dbName}`);
}

prepare().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
