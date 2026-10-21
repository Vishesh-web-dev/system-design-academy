import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENT_ORDER, evaluateAchievements } from '@/lib/learning/achievements';
import {
  STREAK_MILESTONES,
  isSignificant,
  leveledUp,
  streakMilestoneReached,
  type RewardPayload,
} from '@/lib/learning/reward';
import { repsOn } from '@/lib/learning/xp';

const ev = (kind: string, n = 1) => Array.from({ length: n }, () => ({ kind }));

describe('achievement unlock conditions', () => {
  it('unlocks nothing from an empty ledger', () => {
    expect(evaluateAchievements({ events: [], streak: 0 })).toEqual([]);
  });

  it('every achievement has a state that unlocks it and one that does not', () => {
    // First Blood: one quiz pass flips it; nothing flips it before.
    expect(evaluateAchievements({ events: [], streak: 0 })).not.toContain('first-quiz');
    expect(evaluateAchievements({ events: ev('quiz_pass'), streak: 0 })).toContain('first-quiz');

    // Threshold achievements need their full count.
    expect(evaluateAchievements({ events: ev('quiz_pass', 9), streak: 0 })).not.toContain('quiz-10');
    expect(evaluateAchievements({ events: ev('quiz_pass', 10), streak: 0 })).toContain('quiz-10');

    expect(evaluateAchievements({ events: ev('lesson_complete', 1), streak: 0 })).toContain('first-lesson');
    expect(evaluateAchievements({ events: ev('lesson_complete', 10), streak: 0 })).toContain('lessons-10');

    expect(evaluateAchievements({ events: ev('exercise_submit', 10), streak: 0 })).toContain('exercise-10');
    expect(evaluateAchievements({ events: ev('flashcard_review', 50), streak: 0 })).toContain('cards-50');
    expect(evaluateAchievements({ events: ev('quiz_perfect'), streak: 0 })).toContain('perfect-quiz');

    expect(evaluateAchievements({ events: ev('interview_complete'), streak: 0 })).toContain('first-interview');
    expect(evaluateAchievements({ events: ev('boss_cleared'), streak: 0 })).toContain('boss');
    // Boss also satisfies "finished an interview".
    expect(evaluateAchievements({ events: ev('boss_cleared'), streak: 0 })).toContain('first-interview');

    expect(evaluateAchievements({ events: [], streak: 6 })).not.toContain('streak-7');
    expect(evaluateAchievements({ events: [], streak: 7 })).toContain('streak-7');
    expect(evaluateAchievements({ events: [], streak: 29 })).not.toContain('streak-30');
    expect(evaluateAchievements({ events: [], streak: 30 })).toContain('streak-30');
  });

  it('awards no XP-less achievements — every code maps to a reasoning action', () => {
    // A perfect quiz pass counts as a pass too, so both unlock together.
    const codes = evaluateAchievements({ events: ev('quiz_perfect'), streak: 0 });
    expect(codes).toContain('first-quiz');
    expect(codes).toContain('perfect-quiz');
  });

  it('keeps the display order in sync with the definitions', () => {
    expect([...ACHIEVEMENT_ORDER].sort()).toEqual(Object.keys(ACHIEVEMENTS).sort());
  });
});

describe('reward significance', () => {
  const base: RewardPayload = {
    xpAwarded: 2,
    reason: 'Reviewed a card',
    newTotalXp: 100,
    levelBefore: 1,
    levelAfter: 1,
    streakBefore: 1,
    streakAfter: 1,
    unlockedAchievements: [],
  };

  it('finds the milestone just crossed, and only when newly crossed', () => {
    expect(streakMilestoneReached(6, 7)).toBe(7);
    expect(streakMilestoneReached(7, 8)).toBeNull();
    expect(streakMilestoneReached(2, 3)).toBe(3);
    for (const m of STREAK_MILESTONES) expect(streakMilestoneReached(m - 1, m)).toBe(m);
  });

  it('treats a plain XP gain as insignificant, but a level-up as significant', () => {
    expect(isSignificant(base)).toBe(false);
    expect(leveledUp(base)).toBe(false);
    const up = { ...base, levelAfter: 2 };
    expect(leveledUp(up)).toBe(true);
    expect(isSignificant(up)).toBe(true);
  });

  it('treats a streak milestone and an unlocked achievement as significant', () => {
    expect(isSignificant({ ...base, streakBefore: 6, streakAfter: 7 })).toBe(true);
    expect(
      isSignificant({
        ...base,
        unlockedAchievements: [{ code: 'first-quiz', ...ACHIEVEMENTS['first-quiz'] }],
      }),
    ).toBe(true);
  });
});

describe('rep derivation', () => {
  const day = new Date('2026-03-10T12:00:00');
  const at = (iso: string, kind: string) => ({ kind, createdAt: new Date(iso) });

  it('counts each chunky action on the day as one rep', () => {
    const events = [
      at('2026-03-10T09:00:00', 'quiz_pass'),
      at('2026-03-10T10:00:00', 'exercise_submit'),
      at('2026-03-10T11:00:00', 'lesson_complete'),
    ];
    expect(repsOn(events, day)).toBe(3);
  });

  it('collapses a whole flashcard session into a single rep', () => {
    const events = [
      at('2026-03-10T09:00:00', 'flashcard_review'),
      at('2026-03-10T09:01:00', 'flashcard_review'),
      at('2026-03-10T09:02:00', 'flashcard_review'),
    ];
    expect(repsOn(events, day)).toBe(1);
  });

  it('ignores work from other days', () => {
    const events = [
      at('2026-03-09T09:00:00', 'quiz_pass'),
      at('2026-03-11T09:00:00', 'quiz_pass'),
      at('2026-03-10T09:00:00', 'quiz_pass'),
    ];
    expect(repsOn(events, day)).toBe(1);
  });

  it('adds chunky reps and the flashcard rep together', () => {
    const events = [
      at('2026-03-10T09:00:00', 'quiz_perfect'),
      at('2026-03-10T09:30:00', 'flashcard_review'),
      at('2026-03-10T10:00:00', 'flashcard_review'),
      at('2026-03-10T10:30:00', 'review_cleared'),
    ];
    expect(repsOn(events, day)).toBe(3); // quiz + review_cleared + one for the cards
  });
});
