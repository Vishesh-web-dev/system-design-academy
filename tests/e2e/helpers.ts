import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { Lesson, type Lesson as LessonType } from '../../content/schema';
import { lessonModules } from '../../content/index.generated';

/**
 * Answering the quiz correctly needs the answer key, and the answer key lives
 * in content/. Importing it here keeps the E2E flow deterministic without
 * writing to the database behind the UI's back — the test still clicks through
 * the real interface.
 */
export async function loadLesson(slug: string): Promise<LessonType> {
  const mod = await lessonModules[slug]();
  return Lesson.parse(mod.default);
}

/** Walks the quiz, choosing the correct options. Leaves the page on results. */
export async function passQuiz(page: Page, slug: string): Promise<void> {
  const lesson = await loadLesson(slug);
  await page.goto(`/lesson/${slug}/quiz`);

  for (const question of lesson.quiz) {
    await page.getByRole('button', { name: 'Lock in answer' }).waitFor();
    for (const optionId of question.correct) {
      const label = question.options.find((o) => o.id === optionId)!.label;
      await page.locator('button[aria-pressed]', { hasText: label }).first().click();
    }
    await page.getByRole('button', { name: 'Lock in answer' }).click();
    await page.getByRole('button', { name: /Next question|See results/ }).click();
  }

  await expect(page.getByTestId('quiz-result')).toBeVisible();
}

/** Scrolls each section into view long enough for the rail to mark it seen. */
export async function openEverySection(page: Page, slug: string): Promise<void> {
  await page.goto(`/lesson/${slug}`);
  const sections = page.locator('[data-section]');
  const count = await sections.count();
  for (let i = 0; i < count; i += 1) {
    await sections.nth(i).scrollIntoViewIfNeeded();
    // The rail requires two seconds of dwell before counting a section as read.
    await page.waitForTimeout(2300);
  }
}
