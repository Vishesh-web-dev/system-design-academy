import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3111);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Log in once as the seeded dev account; every test reuses the session.
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: 'tests/e2e/.auth/state.json',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build once, then serve: the production build is what V1 ships, and it
    // catches server/client boundary mistakes that `next dev` tolerates.
    command: `npx tsx scripts/e2e-db.ts && npm run build && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    // scripts/e2e-db.ts recreates this database before the server starts.
    env: {
      AI_PROVIDER: 'mock',
      AI_API_KEY: '',
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2') ??
        'postgresql://sda:sda@localhost:5433/system_design_academy_test',
    },
  },
});
