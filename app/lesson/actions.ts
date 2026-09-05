'use server';

import { revalidatePath } from 'next/cache';
import {
  addTimeSpent,
  completeLesson,
  markSectionSeen,
  reopenLesson,
  getProgress,
} from '@/db/repo/progress';
import { bestQuizRatio } from '@/db/repo/quiz';
import { getLesson } from '@/lib/content/loader';
import { sectionsFor } from '@/lib/content/sections';
import { canCompleteLesson } from '@/lib/learning/mastery';
import { ensureLearner } from '@/db/repo/learner';

/**
 * Server actions for the lesson player. All database access goes through
 * db/repo/* (docs/ARCHITECTURE.md → Layering rules); nothing here imports
 * db/schema.ts directly.
 */

export async function recordSectionSeen(lessonId: string, sectionId: string): Promise<void> {
  await ensureLearner();
  await markSectionSeen(lessonId, sectionId);
}

export async function recordTimeSpent(lessonId: string, seconds: number): Promise<void> {
  await ensureLearner();
  await addTimeSpent(lessonId, seconds);
}

export type CompletionResult =
  | { ok: true; alreadyComplete: boolean }
  | { ok: false; missing: string[] };

/**
 * Completing a lesson is not "I read it". The rule lives in
 * lib/learning/mastery.ts and is enforced here, on the server, so the button
 * cannot be bypassed from the client.
 */
export async function markLessonComplete(lessonId: string): Promise<CompletionResult> {
  await ensureLearner();
  const lesson = await getLesson(lessonId);
  if (!lesson) return { ok: false, missing: ['lesson not found'] };

  const [progress, ratio] = await Promise.all([getProgress(lessonId), bestQuizRatio(lessonId)]);

  const check = canCompleteLesson({
    sectionsSeen: progress?.sectionsSeen ?? [],
    requiredSections: sectionsFor(lesson).map((s) => s.id),
    bestQuizRatio: ratio,
  });

  if (!check.allowed) return { ok: false, missing: check.missing };

  const { alreadyComplete } = await completeLesson(lessonId);
  revalidatePath('/');
  revalidatePath(`/lesson/${lessonId}`);
  return { ok: true, alreadyComplete };
}

export async function markLessonIncomplete(lessonId: string): Promise<void> {
  await ensureLearner();
  await reopenLesson(lessonId);
  revalidatePath('/');
  revalidatePath(`/lesson/${lessonId}`);
}
