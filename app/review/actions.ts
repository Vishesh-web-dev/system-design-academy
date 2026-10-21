'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ensureLearner } from '@/db/repo/learner';
import { clearReviewItem, gradeFlashcard } from '@/db/repo/review';
import { mintXp } from '@/db/repo/progress';
import { XP_VALUES } from '@/lib/learning/xp';
import type { RewardPayload } from '@/lib/learning/reward';
import { isLapse, type Grade } from '@/lib/learning/sm2';

const GradeInput = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export async function gradeCard(flashcardId: string, grade: number): Promise<RewardPayload | null> {
  const parsed = GradeInput.safeParse(grade);
  if (!parsed.success) return null;

  await ensureLearner();
  await gradeFlashcard(flashcardId, parsed.data as Grade);

  // XP for a successful recall only. Paying for failures would reward
  // clicking "Again" through a deck.
  const reward = !isLapse(parsed.data as Grade)
    ? await mintXp('flashcard_review', XP_VALUES.flashcard_review, flashcardId)
    : null;

  revalidatePath('/review');
  revalidatePath('/');
  return reward;
}

export async function clearReview(lessonId: string, grade: number): Promise<RewardPayload | null> {
  const parsed = GradeInput.safeParse(grade);
  if (!parsed.success) return null;

  await ensureLearner();
  await clearReviewItem(lessonId, parsed.data as Grade);
  const reward = !isLapse(parsed.data as Grade)
    ? await mintXp('review_cleared', XP_VALUES.review_cleared, lessonId)
    : null;

  revalidatePath('/review');
  revalidatePath('/');
  return reward;
}
