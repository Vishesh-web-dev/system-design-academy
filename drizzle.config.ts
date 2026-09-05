import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://sda:sda@localhost:5433/system_design_academy',
  },
  strict: true,
  verbose: true,
});
