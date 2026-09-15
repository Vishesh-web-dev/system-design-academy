import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../client';
import { requireLearnerId } from '@/lib/auth/session';

export type QuizQuestionRow = typeof schema.quizQuestions.$inferSelect;
export type QuizAttemptRow = typeof schema.quizAttempts.$inferSelect;
export type QuizAnswer = {
  questionId: string;
  chosen: string[];
  correct: boolean;
  topic: string;
  /** Scenario questions weigh double in the mastery model. */
  scenario: boolean;
};

export async function getQuestions(lessonId: string): Promise<QuizQuestionRow[]> {
  return getDb()
    .select()
    .from(schema.quizQuestions)
    .where(eq(schema.quizQuestions.lessonId, lessonId))
    .orderBy(asc(schema.quizQuestions.position));
}

export async function getAttempts(lessonId: string): Promise<QuizAttemptRow[]> {
  return getDb()
    .select()
    .from(schema.quizAttempts)
    .where(
      and(eq(schema.quizAttempts.learnerId, (await requireLearnerId())), eq(schema.quizAttempts.lessonId, lessonId)),
    )
    .orderBy(desc(schema.quizAttempts.completedAt));
}

/** Best score ratio across all attempts, or null if never attempted. */
export async function bestQuizRatio(lessonId: string): Promise<number | null> {
  const attempts = await getAttempts(lessonId);
  const scored = attempts.filter((a) => a.total > 0);
  if (!scored.length) return null;
  return Math.max(...scored.map((a) => a.score / a.total));
}

export async function recordAttempt(args: {
  lessonId: string;
  answers: QuizAnswer[];
  startedAt: Date;
}): Promise<QuizAttemptRow> {
  const score = args.answers.filter((a) => a.correct).length;
  const [row] = await getDb()
    .insert(schema.quizAttempts)
    .values({
      id: randomUUID(),
      learnerId: (await requireLearnerId()),
      lessonId: args.lessonId,
      startedAt: args.startedAt,
      completedAt: new Date(),
      score,
      total: args.answers.length,
      answers: args.answers,
    })
    .returning();
  return row;
}

/** Every attempt across the curriculum, newest first — the mastery signal. */
export async function allAttempts(): Promise<QuizAttemptRow[]> {
  return getDb()
    .select()
    .from(schema.quizAttempts)
    .where(eq(schema.quizAttempts.learnerId, (await requireLearnerId())))
    .orderBy(desc(schema.quizAttempts.completedAt));
}

export async function questionsByIds(ids: string[]): Promise<QuizQuestionRow[]> {
  if (!ids.length) return [];
  return getDb().select().from(schema.quizQuestions).where(inArray(schema.quizQuestions.id, ids));
}
