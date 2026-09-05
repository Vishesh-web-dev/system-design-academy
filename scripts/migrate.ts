import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from './env';

loadEnv();

const { getDb, getPool } = await import('../db/client');

async function main() {
  const target = process.env.DATABASE_URL?.replace(/:[^:@/]*@/, ':***@');
  console.log(`Applying migrations to ${target}`);
  await migrate(getDb(), { migrationsFolder: './db/migrations' });
  console.log('Migrations applied.');
  await getPool().end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
