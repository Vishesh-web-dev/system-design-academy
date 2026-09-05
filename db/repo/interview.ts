import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../client';
import { LEARNER_ID } from './learner';
import type { InterviewSignal } from '@/lib/learning/mastery';

export type MockInterviewRow = typeof schema.mockInterviews.$inferSelect;
export type MessageRow = typeof schema.mockInterviewMessages.$inferSelect;
export type EvaluationRow = typeof schema.mockInterviewEvaluations.$inferSelect;

export type InterviewMode = 'hld' | 'lld' | 'backend' | 'distributed' | 'ai' | 'boss';

export async function createInterview(args: {
  mode: InterviewMode;
  problemKey: string;
  companyStyle: string | null;
  difficulty: string;
  timeBudgetSeconds: number;
}): Promise<MockInterviewRow> {
  const [row] = await getDb()
    .insert(schema.mockInterviews)
    .values({
      id: randomUUID(),
      learnerId: LEARNER_ID,
      mode: args.mode,
      problemKey: args.problemKey,
      companyStyle: args.companyStyle,
      difficulty: args.difficulty,
      timeBudgetSeconds: args.timeBudgetSeconds,
    })
    .returning();
  return row;
}

export async function getInterview(id: string): Promise<MockInterviewRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.mockInterviews)
    .where(and(eq(schema.mockInterviews.id, id), eq(schema.mockInterviews.learnerId, LEARNER_ID)));
  return row;
}

export async function listInterviews(limit = 20): Promise<MockInterviewRow[]> {
  return getDb()
    .select()
    .from(schema.mockInterviews)
    .where(eq(schema.mockInterviews.learnerId, LEARNER_ID))
    .orderBy(desc(schema.mockInterviews.startedAt))
    .limit(limit);
}

export async function getMessages(interviewId: string): Promise<MessageRow[]> {
  return getDb()
    .select()
    .from(schema.mockInterviewMessages)
    .where(eq(schema.mockInterviewMessages.interviewId, interviewId))
    .orderBy(asc(schema.mockInterviewMessages.position));
}

/**
 * Appends a turn. Position is derived inside the statement so two concurrent
 * appends cannot collide on the unique (interview_id, position) index — the
 * loser gets a constraint violation rather than silently overwriting a turn.
 */
export async function appendMessage(args: {
  interviewId: string;
  role: 'interviewer' | 'candidate' | 'system';
  content: string;
  meta?: Record<string, unknown>;
}): Promise<MessageRow> {
  const [row] = await getDb()
    .insert(schema.mockInterviewMessages)
    .values({
      id: randomUUID(),
      interviewId: args.interviewId,
      position: sql`(select coalesce(max(position), 0) + 1 from ${schema.mockInterviewMessages} where interview_id = ${args.interviewId})`,
      role: args.role,
      content: args.content,
      meta: args.meta ?? {},
    })
    .returning();
  return row;
}

export async function updateInterview(
  id: string,
  patch: Partial<typeof schema.mockInterviews.$inferInsert>,
): Promise<void> {
  await getDb()
    .update(schema.mockInterviews)
    .set(patch)
    .where(and(eq(schema.mockInterviews.id, id), eq(schema.mockInterviews.learnerId, LEARNER_ID)));
}

export async function recordHint(id: string): Promise<void> {
  await getDb()
    .update(schema.mockInterviews)
    .set({ hintsUsed: sql`${schema.mockInterviews.hintsUsed} + 1` })
    .where(and(eq(schema.mockInterviews.id, id), eq(schema.mockInterviews.learnerId, LEARNER_ID)));
}

export async function saveEvaluation(args: {
  interviewId: string;
  overallScore: number;
  rubric: EvaluationRow['rubric'];
  strengths: string[];
  weaknesses: string[];
  missedConcepts: string[];
  recommendedLessons: string[];
  summary: string;
}): Promise<EvaluationRow> {
  const [row] = await getDb()
    .insert(schema.mockInterviewEvaluations)
    .values({ id: randomUUID(), ...args })
    .onConflictDoUpdate({
      target: schema.mockInterviewEvaluations.interviewId,
      set: {
        overallScore: args.overallScore,
        rubric: args.rubric,
        strengths: args.strengths,
        weaknesses: args.weaknesses,
        missedConcepts: args.missedConcepts,
        recommendedLessons: args.recommendedLessons,
        summary: args.summary,
      },
    })
    .returning();
  return row;
}

export async function getEvaluation(interviewId: string): Promise<EvaluationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.mockInterviewEvaluations)
    .where(eq(schema.mockInterviewEvaluations.interviewId, interviewId));
  return row;
}

export async function lastInterviewAt(): Promise<Date | null> {
  const [row] = await getDb()
    .select({ endedAt: schema.mockInterviews.endedAt, startedAt: schema.mockInterviews.startedAt })
    .from(schema.mockInterviews)
    .where(
      and(
        eq(schema.mockInterviews.learnerId, LEARNER_ID),
        eq(schema.mockInterviews.status, 'complete'),
      ),
    )
    .orderBy(desc(schema.mockInterviews.startedAt))
    .limit(1);
  return row?.endedAt ?? row?.startedAt ?? null;
}

/**
 * Rubric criteria are named after curriculum topics where they overlap
 * (estimation, data-modeling, consistency, …), so an interview score feeds the
 * same mastery model as a quiz answer.
 */
export async function interviewSignals(): Promise<InterviewSignal[]> {
  const rows = await getDb()
    .select({
      rubric: schema.mockInterviewEvaluations.rubric,
      createdAt: schema.mockInterviewEvaluations.createdAt,
    })
    .from(schema.mockInterviewEvaluations)
    .innerJoin(
      schema.mockInterviews,
      eq(schema.mockInterviewEvaluations.interviewId, schema.mockInterviews.id),
    )
    .where(eq(schema.mockInterviews.learnerId, LEARNER_ID))
    .orderBy(desc(schema.mockInterviewEvaluations.createdAt));

  return rows.flatMap((r) =>
    r.rubric
      .filter((c) => c.max > 0)
      .map((c) => ({
        topic: c.criterion
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        score: Math.max(0, Math.min(1, c.score / c.max)),
        at: r.createdAt,
      })),
  );
}
