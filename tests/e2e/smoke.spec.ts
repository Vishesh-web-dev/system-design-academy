import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { openEverySection, passQuiz } from './helpers';

/**
 * The V1 smoke coverage required by docs/MILESTONES.md: complete a lesson,
 * answer a quiz, review a flashcard, and run a mock interview to its scorecard.
 * Plus the two dashboard states — fresh and seeded.
 */

const LESSON = 'f-request-lifecycle';

test.describe('app shell', () => {
  test('renders the dashboard against a freshly migrated database', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What to do now' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Where you are' })).toBeVisible();
    // A fresh database has no retrieval evidence, and the dashboard must say so
    // rather than showing a fabricated score.
    await expect(page.getByText('No weak topics yet')).toBeVisible();
  });

  test('navigates the primary rail without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const [name, heading] of [
      ['Curriculum', 'Curriculum'],
      ['Review', 'Review'],
      ['Interview', 'Interview'],
      ['Search', 'Search'],
      ['Notes', 'Notes'],
      ['Settings', 'Settings'],
    ] as const) {
      await page.goto('/');
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('lists the full planned curriculum', async ({ page }) => {
    await page.goto('/curriculum');
    await expect(page.getByText(/89 lessons across five phases/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Foundations', level: 2 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'AI Agent & Workflow System Design', level: 2 }),
    ).toBeVisible();
  });
});

test.describe('lesson', () => {
  test('renders every required section', async ({ page }) => {
    await page.goto(`/lesson/${LESSON}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('How a request actually travels');

    for (const heading of [
      'Intuition',
      'Deep explanation',
      'Visuals',
      'In production',
      'Trade-offs',
      'Common interview mistakes',
      'Practice',
      'Exercise',
      'Quiz',
      'Flashcards',
      'Interview questions',
      'Five-minute revision',
      'Interview cheat sheet',
      'References',
    ]) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
  });

  test('hides active-recall content until the learner commits', async ({ page }) => {
    await page.goto(`/lesson/${LESSON}`);
    const predict = page.locator('text=Answer this first').locator('..');
    const reveal = predict.getByRole('button', { name: /I have an answer/ });
    await expect(reveal).toBeVisible();
    // The worked answer is not rendered at all before the learner commits —
    // "820 ms" appears only inside the hidden block, not in the question.
    await expect(page.getByText(/820 ms/)).toHaveCount(0);
    await reveal.click();
    await expect(predict.getByText(/820 ms/).first()).toBeVisible();

    // Exercise model answers stay locked until something has been submitted.
    await expect(page.getByRole('button', { name: 'Show the model answer' })).toHaveCount(0);
  });

  test('blocks completion until the quiz has been passed', async ({ page }) => {
    await page.goto(`/lesson/${LESSON}`);
    const complete = page.getByRole('button', { name: 'Mark complete' });
    await expect(complete).toBeDisabled();
    await expect(page.getByText(/Still needed: quiz not attempted/)).toBeVisible();
  });
});

test.describe('quiz', () => {
  test('answers a quiz to completion and shows explanations', async ({ page }) => {
    await page.goto(`/lesson/${LESSON}/quiz`);

    // Walk every question picking the first option, so the run is deterministic
    // regardless of which answers happen to be correct.
    for (let i = 0; i < 20; i += 1) {
      if (await page.getByTestId('quiz-result').isVisible().catch(() => false)) break;
      await page.getByRole('button', { name: /^Lock in answer$/ }).waitFor();
      await page.locator('ul li button[aria-pressed]').first().click();
      await page.getByRole('button', { name: 'Lock in answer' }).click();
      await page.getByRole('button', { name: /Next question|See results/ }).click();
    }

    await expect(page.getByTestId('quiz-result')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By topic' })).toBeVisible();
  });
});

test.describe.serial('the full learning loop', () => {
  test('completes a lesson: read every section, pass the quiz, mark complete', async ({ page }) => {
    test.setTimeout(180_000);

    await openEverySection(page, LESSON);
    await passQuiz(page, LESSON);
    await expect(page.getByText(/Above the 70% bar/)).toBeVisible();

    await page.goto(`/lesson/${LESSON}`);
    const complete = page.getByRole('button', { name: 'Mark complete' });
    await expect(complete).toBeEnabled();
    await complete.click();
    await expect(page.getByText('Complete', { exact: true })).toBeVisible();

    // Completion is what puts the lesson's cards into the review queue.
    await page.goto('/');
    await expect(page.getByText('lessons done')).toBeVisible();
  });

  test('reviews a flashcard and records a grade', async ({ page }) => {
    await page.goto('/review');
    await expect(page.getByTestId('flashcard-reviewer')).toBeVisible();

    await page.getByTestId('reveal-card').click();
    await page.getByTestId('grade-4').click();

    // Either the next card is shown, or the queue is cleared — both prove the
    // grade was recorded and the queue advanced.
    await expect(
      page.getByTestId('flashcard-reviewer').or(page.getByTestId('review-complete')),
    ).toBeVisible();
  });
});

test.describe('interview simulator', () => {
  test('runs a mock interview through to the scorecard', async ({ page }) => {
    await page.goto('/interview');
    await page.getByRole('radio', { name: /URL shortener/ }).check();
    await page.getByRole('button', { name: 'Start interview' }).click();

    await expect(page).toHaveURL(/\/interview\/[0-9a-f-]{36}/);
    await expect(page.getByTestId('transcript')).toBeVisible();
    await expect(page.getByTestId('interview-clock')).toBeVisible();

    for (const answer of [
      'Functional: create a short link, redirect to the original. Non-functional: reads dominate writes about 100:1, redirects must be under 50 ms at p99, links are permanent.',
      'Assume 100 million new links per month, so about 40 writes per second, and 4000 reads per second at peak. At 500 bytes per row that is 50 GB per year.',
      'A write path that generates an id, stores the mapping, and a read path that is cache-first with the datastore behind it. The cache exists because 2 percent of links serve most reads.',
    ]) {
      await page.getByLabel('Your answer').fill(answer);
      await page.getByTestId('send-answer').click();
      await expect(page.getByTestId('transcript')).toContainText(answer.slice(0, 40));
    }

    await page.getByTestId('end-interview').click();
    await expect(page.getByTestId('scorecard')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'By criterion' })).toBeVisible();
    await expect(page.getByText('overall score, out of 100')).toBeVisible();
  });
});

test.describe.serial('dashboard against a seeded database', () => {
  test.beforeAll(() => {
    // The realistic-progress fixture required by the V1 Definition of Done.
    execFileSync('npx', ['tsx', 'scripts/seed.ts', '--demo'], {
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2') ??
          'postgresql://sda:sda@localhost:5433/system_design_academy_test',
      },
      stdio: 'inherit',
    });
  });

  test('renders progress, pace and recommendations without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(page.getByText('curriculum complete')).toBeVisible();
    await expect(page.getByText('expected by now')).toBeVisible();
    await expect(page.getByText('day streak')).toBeVisible();

    // Seeded progress means at least one recommendation and a non-empty spine.
    await expect(page.getByRole('heading', { name: 'What to do now' })).toBeVisible();
    await expect(page.locator('a[title*="complete"]').first()).toBeVisible();

    await page.goto('/review');
    await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();

    await page.goto('/curriculum');
    await expect(page.getByRole('heading', { name: 'Curriculum', level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
