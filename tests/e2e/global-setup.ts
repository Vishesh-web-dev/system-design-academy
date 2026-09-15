import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Logs in once as the seeded dev account and saves the session cookie as
 * storage state, which every test reuses (playwright.config `use.storageState`).
 * The account is created by scripts/seed.ts, which the E2E webServer runs
 * before this. Real users sign up their own accounts; this is the fixture one.
 */

export const STORAGE_STATE = 'tests/e2e/.auth/state.json';
const EMAIL = process.env.DEV_ACCOUNT_EMAIL ?? 'local@sda.test';
const PASSWORD = process.env.DEV_ACCOUNT_PASSWORD ?? 'local-password-123';

export default async function globalSetup() {
  const port = Number(process.env.E2E_PORT ?? 3111);
  const baseURL = `http://127.0.0.1:${port}`;

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/');
  await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
