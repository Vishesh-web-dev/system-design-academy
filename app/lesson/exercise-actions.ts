'use server';

import { z } from 'zod';
import { ensureLearner } from '@/db/repo/learner';
import { exerciseExists, hasPriorAttempt, saveAttempt } from '@/db/repo/exercises';
import { awardXp } from '@/db/repo/progress';

const Input = z.object({
  exerciseId: z.string().min(1),
  response: z.string().min(1).max(20_000),
  rubricHits: z.array(z.string().max(400)).max(20),
  selfRating: z.number().int().min(1).max(5).nullable(),
});

export type SubmitResult = { ok: true } | { ok: false; error: string };

export async function submitExercise(input: unknown): Promise<SubmitResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That submission was not in a shape we can store.' };

  const { exerciseId, response, rubricHits, selfRating } = parsed.data;

  // Trust boundary: the exercise id comes from the client.
  if (!(await exerciseExists(exerciseId))) {
    return { ok: false, error: 'Unknown exercise.' };
  }

  const words = response.trim().split(/\s+/).filter(Boolean).length;
  if (words < 25) {
    return { ok: false, error: 'Write at least a few sentences before submitting.' };
  }

  await ensureLearner();

  // XP once per exercise, on the first submission. Editing an answer or
  // ticking rubric boxes must not mint XP, or the counter stops meaning
  // anything (docs/PRODUCT.md → Gamification rules).
  const isFirst = !(await hasPriorAttempt(exerciseId));
  await saveAttempt({ exerciseId, response, rubricHits, selfRating });
  if (isFirst) await awardXp('exercise_submit', 35, exerciseId);

  return { ok: true };
}
