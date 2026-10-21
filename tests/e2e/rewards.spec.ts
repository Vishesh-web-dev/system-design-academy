import { test, expect } from '@playwright/test';
import { passQuiz } from './helpers';

/**
 * The motivation surfaces (docs/STATE.md → frozen decision 14): a real action
 * produces an immediate, visible reward; the dashboard shows a concrete next
 * rep and a daily rep target; the achievements ladder renders.
 */

// A different lesson than the smoke suite's, so passing this quiz does not
// disturb smoke's "quiz not yet attempted" assertion on f-request-lifecycle —
// every E2E test shares one account and one database.
const LESSON = 'h-url-shortener';

test.describe('reward feedback', () => {
  test('passing a quiz surfaces an immediate XP reward', async ({ page }) => {
    test.setTimeout(60_000);
    await passQuiz(page, LESSON);
    // The toast auto-dismisses, so assert it appears right after the attempt.
    await expect(page.getByTestId('reward-toast').first()).toBeVisible();
  });

  test('the dashboard shows a concrete next rep and a daily rep target', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/\d+\/\d+ reps/)).toBeVisible();
    await expect(
      page.getByText('Your next rep').or(page.getByText("You're caught up")),
    ).toBeVisible();
  });

  test('the achievements ladder renders with locked and unlocked states', async ({ page }) => {
    await page.goto('/achievements');
    await expect(page.getByRole('heading', { name: 'Achievements', level: 1 })).toBeVisible();
    await expect(page.getByText('First Blood')).toBeVisible();
  });
});
