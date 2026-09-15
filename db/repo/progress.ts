import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from '../client';
import { requireLearnerId } from '@/lib/auth/session';

export type LessonProgress = typeof schema.lessonProgress.$inferSelect;
export type LessonRow = typeof schema.lessons.$inferSelect;

export type ProgressStatus = 'not_started' | 'in_progress' | 'completed';

export async function getProgressMap(): Promise<Map<string, LessonProgress>> {
  const rows = await getDb()
    .select()
    .from(schema.lessonProgress)
    .where(eq(schema.lessonProgress.learnerId, (await requireLearnerId())));
  return new Map(rows.map((r) => [r.lessonId, r]));
}

export async function getProgress(lessonId: string): Promise<LessonProgress | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.lessonProgress)
    .where(
      and(
        eq(schema.lessonProgress.learnerId, (await requireLearnerId())),
        eq(schema.lessonProgress.lessonId, lessonId),
      ),
    );
  return row;
}

/**
 * Records that a section was opened. Idempotent under double-submit: the
 * section id is unioned into the array, and `started_at` is only set once.
 */
export async function markSectionSeen(lessonId: string, sectionId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(schema.lessonProgress)
    .values({
      learnerId: (await requireLearnerId()),
      lessonId,
      status: 'in_progress',
      sectionsSeen: [sectionId],
      startedAt: now,
      lastViewedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.lessonProgress.learnerId, schema.lessonProgress.lessonId],
      set: {
        sectionsSeen: sql`(
          select coalesce(array_agg(distinct s), '{}')
          from unnest(array_append(${schema.lessonProgress.sectionsSeen}, ${sectionId}::text)) as s
        )`,
        status: sql`case when ${schema.lessonProgress.status} = 'completed' then 'completed' else 'in_progress' end`,
        startedAt: sql`coalesce(${schema.lessonProgress.startedAt}, ${now.toISOString()}::timestamptz)`,
        lastViewedAt: now,
      },
    });
}

export async function addTimeSpent(lessonId: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const capped = Math.min(seconds, 900); // one heartbeat can never claim > 15 min
  const db = getDb();

  // Per-day total, for the daily goal and the recommender.
  const day = new Date();
  const localDay = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  await db
    .insert(schema.studyDays)
    .values({ learnerId: (await requireLearnerId()), day: localDay, seconds: capped })
    .onConflictDoUpdate({
      target: [schema.studyDays.learnerId, schema.studyDays.day],
      set: { seconds: sql`${schema.studyDays.seconds} + ${capped}` },
    });

  await db
    .insert(schema.lessonProgress)
    .values({
      learnerId: (await requireLearnerId()),
      lessonId,
      status: 'in_progress',
      timeSpentSeconds: capped,
      startedAt: new Date(),
      lastViewedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.lessonProgress.learnerId, schema.lessonProgress.lessonId],
      set: {
        timeSpentSeconds: sql`${schema.lessonProgress.timeSpentSeconds} + ${capped}`,
        lastViewedAt: new Date(),
      },
    });
}

/**
 * Completion is not "the page was opened". `lib/learning/mastery.ts` decides
 * eligibility; this only records the decision. Re-completing is a no-op, so a
 * double-submitted form cannot award XP twice.
 */
export async function completeLesson(lessonId: string): Promise<{ alreadyComplete: boolean }> {
  const db = getDb();
  const existing = await getProgress(lessonId);
  if (existing?.status === 'completed') return { alreadyComplete: true };

  const now = new Date();
  await db
    .insert(schema.lessonProgress)
    .values({
      learnerId: (await requireLearnerId()),
      lessonId,
      status: 'completed',
      startedAt: now,
      completedAt: now,
      lastViewedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.lessonProgress.learnerId, schema.lessonProgress.lessonId],
      set: { status: 'completed', completedAt: now, lastViewedAt: now },
    });

  await awardXp('lesson_complete', 40, lessonId);
  return { alreadyComplete: false };
}

export async function reopenLesson(lessonId: string): Promise<void> {
  await getDb()
    .update(schema.lessonProgress)
    .set({ status: 'in_progress', completedAt: null })
    .where(
      and(
        eq(schema.lessonProgress.learnerId, (await requireLearnerId())),
        eq(schema.lessonProgress.lessonId, lessonId),
      ),
    );
}

// ── XP ──────────────────────────────────────────────────────────────────────

export type XpKind =
  | 'lesson_complete'
  | 'quiz_pass'
  | 'quiz_perfect'
  | 'exercise_submit'
  | 'flashcard_review'
  | 'review_cleared'
  | 'interview_complete'
  | 'boss_cleared';

export async function awardXp(kind: XpKind, amount: number, ref?: string): Promise<void> {
  await getDb().insert(schema.xpEvents).values({
    id: randomUUID(),
    learnerId: (await requireLearnerId()),
    kind,
    amount,
    ref: ref ?? null,
  });
}

export async function minutesStudiedOn(day: Date): Promise<number> {
  const localDay = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const [row] = await getDb()
    .select()
    .from(schema.studyDays)
    .where(and(eq(schema.studyDays.learnerId, (await requireLearnerId())), eq(schema.studyDays.day, localDay)));
  return Math.round((row?.seconds ?? 0) / 60);
}

export type XpEvent = typeof schema.xpEvents.$inferSelect;

export async function getXpEvents(sinceDays = 400): Promise<XpEvent[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  return getDb()
    .select()
    .from(schema.xpEvents)
    .where(and(eq(schema.xpEvents.learnerId, (await requireLearnerId())), gte(schema.xpEvents.createdAt, since)))
    .orderBy(desc(schema.xpEvents.createdAt));
}

// ── Curriculum reads ────────────────────────────────────────────────────────

export async function listLessons(): Promise<LessonRow[]> {
  return getDb().select().from(schema.lessons).orderBy(asc(schema.lessons.position));
}

export async function listPhases() {
  return getDb().select().from(schema.phases).orderBy(asc(schema.phases.position));
}
