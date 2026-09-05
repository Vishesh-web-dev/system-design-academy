import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { getDb, schema } from '../client';
import { LEARNER_ID } from './learner';
import { schedule, type Grade, type SchedulingState } from '@/lib/learning/sm2';

export type ReviewItemRow = typeof schema.reviewItems.$inferSelect;
export type FlashcardRow = typeof schema.flashcards.$inferSelect;
export type FlashcardProgressRow = typeof schema.flashcardProgress.$inferSelect;

export type ReviewReason = 'quiz_miss' | 'flashcard_lapse' | 'interview_gap' | 'decay';

// ── Lesson-level review items ───────────────────────────────────────────────

/**
 * Queues a lesson for revision because questions were missed. Priority scales
 * with how many were missed, so a lesson answered 2/6 outranks one answered
 * 5/6 without needing a second table.
 */
export async function queueFromQuizMisses(lessonId: string, missCount: number): Promise<void> {
  if (missCount <= 0) return;
  await queueReview(lessonId, 'quiz_miss', 50 + missCount * 10);
}

export async function queueReview(
  lessonId: string,
  reason: ReviewReason,
  priority: number,
  dueAt: Date = new Date(),
): Promise<void> {
  await getDb()
    .insert(schema.reviewItems)
    .values({ learnerId: LEARNER_ID, lessonId, reason, priority, dueAt, intervalDays: 1 })
    .onConflictDoUpdate({
      target: [schema.reviewItems.learnerId, schema.reviewItems.lessonId],
      set: {
        // A fresh failure always resets the interval and takes the higher
        // priority; a queued item must never be quietly downgraded.
        reason,
        priority: sql`greatest(${schema.reviewItems.priority}, ${priority})`,
        dueAt: sql`least(${schema.reviewItems.dueAt}, ${dueAt.toISOString()}::timestamptz)`,
        intervalDays: 1,
      },
    });
}

export async function dueReviewItems(now: Date = new Date()) {
  return getDb()
    .select({
      lessonId: schema.reviewItems.lessonId,
      reason: schema.reviewItems.reason,
      priority: schema.reviewItems.priority,
      dueAt: schema.reviewItems.dueAt,
      intervalDays: schema.reviewItems.intervalDays,
      ease: schema.reviewItems.ease,
      title: schema.lessons.title,
      estimatedMinutes: schema.lessons.estimatedMinutes,
    })
    .from(schema.reviewItems)
    .innerJoin(schema.lessons, eq(schema.reviewItems.lessonId, schema.lessons.id))
    .where(and(eq(schema.reviewItems.learnerId, LEARNER_ID), lte(schema.reviewItems.dueAt, now)))
    .orderBy(asc(schema.reviewItems.dueAt));
}

export async function allReviewItems(): Promise<ReviewItemRow[]> {
  return getDb()
    .select()
    .from(schema.reviewItems)
    .where(eq(schema.reviewItems.learnerId, LEARNER_ID));
}

/** Clearing a review item pushes it out on the SM-2 curve rather than deleting it. */
export async function clearReviewItem(lessonId: string, grade: Grade): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.reviewItems)
    .where(
      and(eq(schema.reviewItems.learnerId, LEARNER_ID), eq(schema.reviewItems.lessonId, lessonId)),
    );
  if (!row) return;

  const state: SchedulingState = {
    ease: row.ease,
    intervalDays: row.intervalDays,
    repetitions: 0,
    lapses: 0,
  };
  const next = schedule(state, grade);

  await db
    .update(schema.reviewItems)
    .set({
      ease: next.ease,
      intervalDays: Math.max(1, next.intervalDays),
      dueAt: next.intervalDays > 0 ? next.dueAt : new Date(Date.now() + 86_400_000),
      lastReviewedAt: new Date(),
      priority: grade >= 4 ? 10 : row.priority,
    })
    .where(
      and(eq(schema.reviewItems.learnerId, LEARNER_ID), eq(schema.reviewItems.lessonId, lessonId)),
    );
}

// ── Flashcards ──────────────────────────────────────────────────────────────

export async function dueFlashcards(limit = 40, now: Date = new Date()) {
  const db = getDb();
  // Cards the learner has seen and that are due.
  const seen = await db
    .select({
      card: schema.flashcards,
      progress: schema.flashcardProgress,
      lessonTitle: schema.lessons.title,
    })
    .from(schema.flashcardProgress)
    .innerJoin(schema.flashcards, eq(schema.flashcardProgress.flashcardId, schema.flashcards.id))
    .innerJoin(schema.lessons, eq(schema.flashcards.lessonId, schema.lessons.id))
    .where(
      and(
        eq(schema.flashcardProgress.learnerId, LEARNER_ID),
        lte(schema.flashcardProgress.dueAt, now),
      ),
    )
    .orderBy(asc(schema.flashcardProgress.dueAt))
    .limit(limit);

  if (seen.length >= limit) return seen;

  // Cards from completed lessons that have never been reviewed. They enter the
  // queue only once the lesson is complete, so unfinished material does not
  // flood the daily review.
  const fresh = await db
    .select({ card: schema.flashcards, lessonTitle: schema.lessons.title })
    .from(schema.flashcards)
    .innerJoin(schema.lessons, eq(schema.flashcards.lessonId, schema.lessons.id))
    .innerJoin(
      schema.lessonProgress,
      and(
        eq(schema.lessonProgress.lessonId, schema.lessons.id),
        eq(schema.lessonProgress.learnerId, LEARNER_ID),
      ),
    )
    .where(
      and(
        eq(schema.lessonProgress.status, 'completed'),
        sql`not exists (
          select 1 from ${schema.flashcardProgress} fp
          where fp.flashcard_id = ${schema.flashcards.id}
            and fp.learner_id = ${LEARNER_ID}
        )`,
      ),
    )
    .orderBy(asc(schema.flashcards.lessonId), asc(schema.flashcards.position))
    .limit(limit - seen.length);

  return [...seen, ...fresh.map((f) => ({ ...f, progress: null }))];
}

export async function countDueFlashcards(now: Date = new Date()): Promise<number> {
  const cards = await dueFlashcards(200, now);
  return cards.length;
}

export async function gradeFlashcard(flashcardId: string, grade: Grade): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.flashcardProgress)
    .where(
      and(
        eq(schema.flashcardProgress.learnerId, LEARNER_ID),
        eq(schema.flashcardProgress.flashcardId, flashcardId),
      ),
    );

  const state: SchedulingState = existing
    ? {
        ease: existing.ease,
        intervalDays: existing.intervalDays,
        repetitions: existing.repetitions,
        lapses: existing.lapses,
      }
    : { ease: 2.5, intervalDays: 0, repetitions: 0, lapses: 0 };

  const next = schedule(state, grade);

  await db
    .insert(schema.flashcardProgress)
    .values({
      learnerId: LEARNER_ID,
      flashcardId,
      ease: next.ease,
      intervalDays: next.intervalDays,
      repetitions: next.repetitions,
      lapses: next.lapses,
      dueAt: next.dueAt,
      lastGrade: grade,
      lastReviewedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.flashcardProgress.learnerId, schema.flashcardProgress.flashcardId],
      set: {
        ease: next.ease,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        dueAt: next.dueAt,
        lastGrade: grade,
        lastReviewedAt: new Date(),
      },
    });

  // Repeated lapses on a lesson's cards mean the lesson itself needs another
  // pass, not just more card drilling.
  if (next.lapses >= 3) {
    const [card] = await db
      .select({ lessonId: schema.flashcards.lessonId })
      .from(schema.flashcards)
      .where(eq(schema.flashcards.id, flashcardId));
    if (card) await queueReview(card.lessonId, 'flashcard_lapse', 60);
  }
}

export async function flashcardProgressForMastery() {
  return getDb()
    .select({
      topic: schema.flashcards.topic,
      intervalDays: schema.flashcardProgress.intervalDays,
      lastReviewedAt: schema.flashcardProgress.lastReviewedAt,
      lapses: schema.flashcardProgress.lapses,
    })
    .from(schema.flashcardProgress)
    .innerJoin(schema.flashcards, eq(schema.flashcardProgress.flashcardId, schema.flashcards.id))
    .where(eq(schema.flashcardProgress.learnerId, LEARNER_ID));
}
