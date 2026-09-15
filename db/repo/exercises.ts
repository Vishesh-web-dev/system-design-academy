import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../client';
import { requireLearnerId } from '@/lib/auth/session';

export type ExerciseAttemptRow = typeof schema.exerciseAttempts.$inferSelect;

export async function latestAttemptsForLesson(lessonId: string) {
  const db = getDb();
  const exercises = await db
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(eq(schema.exercises.lessonId, lessonId));
  if (!exercises.length) return new Map<string, ExerciseAttemptRow>();

  const rows = await db
    .select()
    .from(schema.exerciseAttempts)
    .where(
      and(
        eq(schema.exerciseAttempts.learnerId, (await requireLearnerId())),
        inArray(
          schema.exerciseAttempts.exerciseId,
          exercises.map((e) => e.id),
        ),
      ),
    )
    .orderBy(desc(schema.exerciseAttempts.submittedAt));

  // Newest first, so the first row seen per exercise is the latest.
  const latest = new Map<string, ExerciseAttemptRow>();
  for (const r of rows) if (!latest.has(r.exerciseId)) latest.set(r.exerciseId, r);
  return latest;
}

export async function hasPriorAttempt(exerciseId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.exerciseAttempts.id })
    .from(schema.exerciseAttempts)
    .where(
      and(
        eq(schema.exerciseAttempts.learnerId, (await requireLearnerId())),
        eq(schema.exerciseAttempts.exerciseId, exerciseId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function exerciseExists(exerciseId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(eq(schema.exercises.id, exerciseId));
  return Boolean(row);
}

/**
 * One row per submission, append-only: the history of how an answer improved is
 * a mastery signal, and overwriting it would delete that.
 */
export async function saveAttempt(args: {
  exerciseId: string;
  response: string;
  rubricHits: string[];
  selfRating: number | null;
}): Promise<ExerciseAttemptRow> {
  const [row] = await getDb()
    .insert(schema.exerciseAttempts)
    .values({
      id: randomUUID(),
      learnerId: (await requireLearnerId()),
      exerciseId: args.exerciseId,
      response: args.response,
      rubricHits: args.rubricHits,
      selfRating: args.selfRating,
    })
    .returning();
  return row;
}

export async function allExerciseAttempts(): Promise<
  Array<ExerciseAttemptRow & { lessonId: string; topicSource: string[] }>
> {
  const rows = await getDb()
    .select({
      attempt: schema.exerciseAttempts,
      lessonId: schema.exercises.lessonId,
      tags: schema.lessons.tags,
    })
    .from(schema.exerciseAttempts)
    .innerJoin(schema.exercises, eq(schema.exerciseAttempts.exerciseId, schema.exercises.id))
    .innerJoin(schema.lessons, eq(schema.exercises.lessonId, schema.lessons.id))
    .where(eq(schema.exerciseAttempts.learnerId, (await requireLearnerId())))
    .orderBy(desc(schema.exerciseAttempts.submittedAt));

  return rows.map((r) => ({ ...r.attempt, lessonId: r.lessonId, topicSource: r.tags }));
}
