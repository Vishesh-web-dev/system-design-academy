/**
 * XP, levels and streaks (docs/PRODUCT.md → Gamification rules).
 *
 * The rule that shapes this file: XP follows *retrieval and reasoning*, never
 * page views. There is no XP event for opening a lesson, and no login bonus.
 */

export const XP_VALUES = {
  lesson_complete: 40,
  quiz_pass: 25,
  quiz_perfect: 40,
  exercise_submit: 35,
  flashcard_review: 2,
  review_cleared: 8,
  interview_complete: 120,
  boss_cleared: 250,
} as const;

export type XpKind = keyof typeof XP_VALUES;

export const XP_REASON: Record<XpKind, string> = {
  lesson_complete: 'Finished a lesson and passed its quiz',
  quiz_pass: 'Passed a quiz',
  quiz_perfect: 'Perfect quiz',
  exercise_submit: 'Submitted an exercise',
  flashcard_review: 'Reviewed a card',
  review_cleared: 'Cleared a review item',
  interview_complete: 'Completed a mock interview',
  boss_cleared: 'Cleared Boss Mode',
};

/**
 * Level curve: each level costs 15% more than the last, starting at 250 XP.
 * Slow enough that levels mean something over 14 weeks, fast enough that the
 * first few arrive during week one.
 */
export function levelFromXp(totalXp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let cost = 250;
  let remaining = totalXp;
  while (remaining >= cost) {
    remaining -= cost;
    level += 1;
    cost = Math.round(cost * 1.15);
  }
  return { level, into: remaining, needed: cost };
}

export interface DayActivity {
  /** Local date, YYYY-MM-DD. */
  date: string;
  xp: number;
}

/** Groups XP events into local days. */
export function toDailyActivity(events: Array<{ createdAt: Date; amount: number }>): DayActivity[] {
  const byDay = new Map<string, number>();
  for (const e of events) {
    const key = localDate(e.createdAt);
    byDay.set(key, (byDay.get(key) ?? 0) + e.amount);
  }
  return [...byDay.entries()]
    .map(([date, xp]) => ({ date, xp }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Current streak in days. Today not yet studied does not break the streak
 * until tomorrow — otherwise the counter would punish the learner at 00:01.
 */
export function currentStreak(activity: DayActivity[], today: Date = new Date()): number {
  const active = new Set(activity.filter((a) => a.xp > 0).map((a) => a.date));
  let streak = 0;
  const cursor = new Date(today);
  if (!active.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (active.has(localDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function longestStreak(activity: DayActivity[]): number {
  const dates = activity
    .filter((a) => a.xp > 0)
    .map((a) => a.date)
    .sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const d of dates) {
    const cur = new Date(`${d}T00:00:00`);
    if (prev && (cur.getTime() - prev.getTime()) / 86_400_000 === 1) run += 1;
    else run = 1;
    best = Math.max(best, run);
    prev = cur;
  }
  return best;
}
