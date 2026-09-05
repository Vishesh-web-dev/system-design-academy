import { loadEnv } from './env';

loadEnv();

const { getPool } = await import('../db/client');

/** Drops and recreates the public schema. Used to prove migrations run clean. */
async function main() {
  const pool = getPool();
  await pool.query('drop schema if exists drizzle cascade');
  await pool.query('drop schema public cascade');
  await pool.query('create schema public');
  console.log('Database reset to empty.');
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
