import { config } from 'dotenv';
import { existsSync } from 'node:fs';

/** Scripts load .env.local first (developer machine), then .env. */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) config({ path: file, override: false, quiet: true });
  }
}
