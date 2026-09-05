'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ensureLearner } from '@/db/repo/learner';
import { clearReviewItem, gradeFlashcard } from '@/db/repo/review';
import { awardXp } from '@/db/repo/progress';
import { isLapse, type Grade } from '@/lib/learning/sm2';

const GradeInput = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export async function gradeCard(flashcardId: string, grade: number): Promise<void> {
  const parsed = GradeInput.safeParse(grade);
  if (!parsed.success) return;

  await ensureLearner();
  await gradeFlashcard(flashcardId, parsed.data as Grade);

  // XP for a successful recall only. Paying for failures would reward
  // clicking "Again" through a deck.
  if (!isLapse(parsed.data as Grade)) await awardXp('flashcard_review', 2, flashcardId);

  revalidatePath('/review');
  revalidatePath('/');
}

export async function clearReview(lessonId: string, grade: number): Promise<void> {
  const parsed = GradeInput.safeParse(grade);
  if (!parsed.success) return;

  await ensureLearner();
  await clearReviewItem(lessonId, parsed.data as Grade);
  if (!isLapse(parsed.data as Grade)) await awardXp('review_cleared', 8, lessonId);

  revalidatePath('/review');
  revalidatePath('/');
}
