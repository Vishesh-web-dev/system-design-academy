'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ensureLearner } from '@/db/repo/learner';
import { getQuestions, recordAttempt } from '@/db/repo/quiz';
import { awardXp } from '@/db/repo/progress';
import { queueFromQuizMisses } from '@/db/repo/review';

const Input = z.object({
  lessonId: z.string().min(1),
  startedAt: z.string(),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        chosen: z.array(z.string()).max(6),
        correct: z.boolean(),
        topic: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

export type QuizSubmitResult =
  | { ok: true; score: number; total: number }
  | { ok: false; error: string };

/**
 * The client reports which options it chose; the server decides whether they
 * were right. Trusting the client's `correct` flag would make the mastery model
 * a record of what the learner claimed rather than what they did.
 */
export async function submitQuizAttempt(input: unknown): Promise<QuizSubmitResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That attempt was not in a shape we can store.' };

  const { lessonId, startedAt, answers } = parsed.data;
  const questions = await getQuestions(lessonId);
  if (!questions.length) return { ok: false, error: 'Unknown lesson.' };

  const byId = new Map(questions.map((q) => [q.id, q]));
  const graded = answers.flatMap((a) => {
    const q = byId.get(a.questionId);
    if (!q) return [];
    const expected = new Set(q.correct);
    const chosen = new Set(a.chosen);
    const correct =
      expected.size === chosen.size && [...expected].every((e) => chosen.has(e));
    return [{ questionId: q.id, chosen: a.chosen, correct, topic: q.topic, scenario: q.kind === 'scenario' }];
  });

  if (!graded.length) return { ok: false, error: 'No recognisable answers in that attempt.' };

  await ensureLearner();
  const attempt = await recordAttempt({ lessonId, answers: graded, startedAt: new Date(startedAt) });

  const ratio = attempt.total ? attempt.score / attempt.total : 0;
  if (ratio === 1) await awardXp('quiz_perfect', 40, lessonId);
  else if (ratio >= 0.7) await awardXp('quiz_pass', 25, lessonId);

  // A wrong answer is the strongest signal the platform gets. It goes straight
  // into the review queue (docs/PRODUCT.md → Spaced repetition).
  await queueFromQuizMisses(lessonId, graded.filter((g) => !g.correct).length);

  revalidatePath('/');
  revalidatePath('/review');
  revalidatePath(`/lesson/${lessonId}`);
  return { ok: true, score: attempt.score, total: attempt.total };
}
