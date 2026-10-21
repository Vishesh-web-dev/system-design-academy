import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from '../client';
import { requireLearnerId } from '@/lib/auth/session';
import {
  XP_REASON,
  XP_VALUES,
  currentStreak,
  levelFromXp,
  toDailyActivity,
  type XpKind,
} from '@/lib/learning/xp';
import { ACHIEVEMENTS, evaluateAchievements } from '@/lib/learning/achievements';
import type { RewardPayload } from '@/lib/learning/reward';

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
export async function completeLesson(
  lessonId: string,
): Promise<{ alreadyComplete: boolean; reward?: RewardPayload }> {
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

  const reward = await mintXp('lesson_complete', XP_VALUES.lesson_complete, lessonId);
  return { alreadyComplete: false, reward };
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

/** Low-level insert into the XP ledger. Prefer `mintXp`, which also returns the
 *  reward feedback the UI needs; this stays for callers that do not surface it. */
export async function awardXp(kind: XpKind, amount: number, ref?: string): Promise<void> {
  await getDb().insert(schema.xpEvents).values({
    id: randomUUID(),
    learnerId: (await requireLearnerId()),
    kind,
    amount,
    ref: ref ?? null,
  });
}

/**
 * Mints XP and returns everything the client needs to reward the learner
 * immediately: the amount, the new level, the new streak, and any achievements
 * this action just unlocked. The anti-dopamine rule is unchanged — callers mint
 * only for genuine retrieval/reasoning — this just makes the payoff visible
 * instead of silent (docs/STATE.md → frozen decision 14).
 */
export async function mintXp(kind: XpKind, amount: number, ref?: string): Promise<RewardPayload> {
  const db = getDb();
  const learnerId = await requireLearnerId();
  const now = new Date();

  // Snapshot the ledger before the new event so level and streak deltas are exact.
  const before = await db
    .select({
      kind: schema.xpEvents.kind,
      amount: schema.xpEvents.amount,
      createdAt: schema.xpEvents.createdAt,
    })
    .from(schema.xpEvents)
    .where(eq(schema.xpEvents.learnerId, learnerId));

  await db.insert(schema.xpEvents).values({ id: randomUUID(), learnerId, kind, amount, ref: ref ?? null, createdAt: now });

  const after = [...before, { kind, amount, createdAt: now }];
  const totalBefore = before.reduce((a, e) => a + e.amount, 0);
  const totalAfter = totalBefore + amount;
  const streakBefore = currentStreak(toDailyActivity(before), now);
  const streakAfter = currentStreak(toDailyActivity(after), now);

  // Diff newly-satisfied achievements against what is already unlocked.
  const existing = await db
    .select({ code: schema.achievements.code })
    .from(schema.achievements)
    .where(eq(schema.achievements.learnerId, learnerId));
  const have = new Set(existing.map((r) => r.code));
  const unlocked = evaluateAchievements({ events: after, streak: streakAfter }).filter((c) => !have.has(c));
  if (unlocked.length) {
    await db
      .insert(schema.achievements)
      .values(unlocked.map((code) => ({ learnerId, code, unlockedAt: now })))
      .onConflictDoNothing();
  }

  return {
    xpAwarded: amount,
    reason: XP_REASON[kind],
    newTotalXp: totalAfter,
    levelBefore: levelFromXp(totalBefore).level,
    levelAfter: levelFromXp(totalAfter).level,
    streakBefore,
    streakAfter,
    unlockedAchievements: unlocked.map((code) => ({ code, ...ACHIEVEMENTS[code] })),
  };
}

/** Achievement codes this learner has unlocked, newest first. */
export async function listAchievements(): Promise<Array<{ code: string; unlockedAt: Date }>> {
  const learnerId = await requireLearnerId();
  return getDb()
    .select({ code: schema.achievements.code, unlockedAt: schema.achievements.unlockedAt })
    .from(schema.achievements)
    .where(eq(schema.achievements.learnerId, learnerId))
    .orderBy(desc(schema.achievements.unlockedAt));
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
