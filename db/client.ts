import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * One pg Pool per process, memoised on globalThis so Next's dev hot-reload and
 * warm serverless invocations reuse it instead of leaking connections.
 *
 * The same code runs against local Docker Postgres and production Neon — only
 * DATABASE_URL differs (docs/ARCHITECTURE.md → Database access).
 */

declare global {
  var __sdaPool: Pool | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and start Postgres with `docker compose up -d`.');
  }
  return url;
}

export function getPool(): Pool {
  if (!globalThis.__sdaPool) {
    const url = connectionString();
    const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
    globalThis.__sdaPool = new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      // Neon and other managed providers require TLS; local Docker does not.
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalThis.__sdaPool;
}

let _db: NodePgDatabase<typeof schema> | undefined;

/**
 * Lazy so that importing this module (during `next build`, or in a unit test)
 * never requires DATABASE_URL to be present.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}

export type Db = NodePgDatabase<typeof schema>;
export { schema };
