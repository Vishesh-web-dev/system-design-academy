import { test, expect } from '@playwright/test';

/**
 * Authentication: route protection, signup, and logout. These run logged out
 * (overriding the shared session), unlike the rest of the suite which runs as
 * the seeded account.
 */
test.describe('authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('protects the app and redirects anonymous visitors to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await page.goto('/notes');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signs up a new account into an empty dashboard, then logs out', async ({ page }) => {
    const email = `e2e-${Date.now()}@sda.test`;

    await page.goto('/signup');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'a-strong-password');
    await page.click('button[type="submit"]');

    // Lands on the dashboard, and a brand-new account has no progress.
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(page.getByText('No weak topics yet')).toBeVisible();

    // Log out returns to the login page and re-protects the app.
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });
});
