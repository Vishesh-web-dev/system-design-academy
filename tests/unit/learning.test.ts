import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, isLapse, retrievability, schedule } from '@/lib/learning/sm2';
import { canCompleteLesson, computeMastery, band } from '@/lib/learning/mastery';
import { computePace } from '@/lib/learning/pace';
import { recommend, weakestTopics } from '@/lib/learning/recommend';
import { currentStreak, levelFromXp, longestStreak, toDailyActivity } from '@/lib/learning/xp';

const NOW = new Date('2026-03-10T09:00:00Z');
const DAY = 86_400_000;

describe('sm2 scheduler', () => {
  it('grows the interval 1 → 6 → ease-scaled on successful reviews', () => {
    const first = schedule(INITIAL_STATE, 4, NOW);
    expect(first.intervalDays).toBe(1);

    const second = schedule(first, 4, NOW);
    expect(second.intervalDays).toBe(6);

    const third = schedule(second, 4, NOW);
    expect(third.intervalDays).toBeGreaterThan(6);
    expect(third.repetitions).toBe(3);
  });

  it('treats a grade below 3 as a lapse: interval resets, lapse count rises', () => {
    const grown = schedule(schedule(schedule(INITIAL_STATE, 5, NOW), 5, NOW), 5, NOW);
    expect(grown.intervalDays).toBeGreaterThan(6);

    const lapsed = schedule(grown, 1, NOW);
    expect(isLapse(1)).toBe(true);
    expect(lapsed.intervalDays).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.repetitions).toBe(0);
    // Comes back in minutes, not days.
    expect(lapsed.dueAt.getTime() - NOW.getTime()).toBeLessThan(DAY);
  });

  it('keeps the reduced ease after a lapse, so a repeatedly failed card grows slower', () => {
    const lapsed = schedule(INITIAL_STATE, 1, NOW);
    expect(lapsed.ease).toBeLessThan(INITIAL_STATE.ease);
    expect(lapsed.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('never lets ease fall below 1.3', () => {
    let s = INITIAL_STATE;
    for (let i = 0; i < 20; i += 1) s = schedule(s, 0, NOW);
    expect(s.ease).toBe(1.3);
  });

  it('caps the interval so nothing is scheduled past the interview horizon', () => {
    let s = { ...INITIAL_STATE, intervalDays: 90, repetitions: 8 };
    s = schedule(s, 5, NOW);
    expect(s.intervalDays).toBeLessThanOrEqual(120);
  });

  it('models forgetting: retrievability halves after one interval', () => {
    const reviewed = new Date(NOW.getTime() - 7 * DAY);
    expect(retrievability(7, reviewed, NOW)).toBeCloseTo(0.5, 2);
    expect(retrievability(7, null, NOW)).toBe(0);
    expect(retrievability(0, reviewed, NOW)).toBe(0);
  });
});

describe('mastery model', () => {
  it('gives no score at all without retrieval evidence', () => {
    const m = computeMastery({ topic: 'caching', now: NOW });
    expect(m.score).toBe(0);
    expect(band(m)).toBe('unknown');
    expect(m.explanation.join(' ')).toMatch(/opening a lesson does not count/);
  });

  it('weighs scenario questions above recall questions', () => {
    const recallOnly = computeMastery({
      topic: 'caching',
      quiz: [
        { topic: 'caching', correct: true, scenario: false, recencyRank: 0 },
        { topic: 'caching', correct: true, scenario: false, recencyRank: 0 },
      ],
      now: NOW,
    });
    const mixedFailingScenarios = computeMastery({
      topic: 'caching',
      quiz: [
        { topic: 'caching', correct: true, scenario: false, recencyRank: 0 },
        { topic: 'caching', correct: true, scenario: false, recencyRank: 0 },
        { topic: 'caching', correct: false, scenario: true, recencyRank: 0 },
        { topic: 'caching', correct: false, scenario: true, recencyRank: 0 },
      ],
      now: NOW,
    });
    expect(mixedFailingScenarios.score).toBeLessThan(recallOnly.score);
    // Scenario weight is 0.3 vs 0.2, so failing them should drag below half.
    expect(mixedFailingScenarios.score).toBeLessThan(0.45);
  });

  it('weights recent attempts more than old ones', () => {
    const improving = computeMastery({
      topic: 'caching',
      quiz: [
        { topic: 'caching', correct: true, scenario: true, recencyRank: 0 },
        { topic: 'caching', correct: false, scenario: true, recencyRank: 3 },
      ],
      now: NOW,
    });
    const declining = computeMastery({
      topic: 'caching',
      quiz: [
        { topic: 'caching', correct: false, scenario: true, recencyRank: 0 },
        { topic: 'caching', correct: true, scenario: true, recencyRank: 3 },
      ],
      now: NOW,
    });
    expect(improving.score).toBeGreaterThan(declining.score);
  });

  it('penalises repeatedly lapsed flashcards even when freshly reviewed', () => {
    const clean = computeMastery({
      topic: 'caching',
      flashcards: [{ topic: 'caching', intervalDays: 10, lastReviewedAt: NOW, lapses: 0 }],
      now: NOW,
    });
    const lapsed = computeMastery({
      topic: 'caching',
      flashcards: [{ topic: 'caching', intervalDays: 10, lastReviewedAt: NOW, lapses: 4 }],
      now: NOW,
    });
    expect(lapsed.score).toBeLessThan(clean.score);
  });

  it('reports low confidence on thin evidence and explains itself', () => {
    const thin = computeMastery({
      topic: 'caching',
      quiz: [{ topic: 'caching', correct: true, scenario: true, recencyRank: 0 }],
      now: NOW,
    });
    expect(thin.confidence).toBeLessThan(0.5);
    expect(thin.explanation.join(' ')).toMatch(/Low confidence/);
  });

  it('reaches interview-ready only with broad, strong evidence', () => {
    const strong = computeMastery({
      topic: 'caching',
      quiz: Array.from({ length: 8 }, (_, i) => ({
        topic: 'caching',
        correct: true,
        scenario: i % 2 === 0,
        recencyRank: 0,
      })),
      flashcards: Array.from({ length: 6 }, () => ({
        topic: 'caching',
        intervalDays: 14,
        lastReviewedAt: NOW,
        lapses: 0,
      })),
      exercises: [{ topic: 'caching', selfRating: 5, rubricHitRatio: 1 }],
      interviews: [{ topic: 'caching', score: 0.95, at: NOW }],
      now: NOW,
    });
    expect(band(strong)).toBe('interview-ready');
  });
});

describe('lesson completion rule', () => {
  it('refuses completion when sections are unopened', () => {
    const r = canCompleteLesson({
      sectionsSeen: ['intuition'],
      requiredSections: ['intuition', 'deep', 'quiz'],
      bestQuizRatio: 1,
    });
    expect(r.allowed).toBe(false);
    expect(r.missing.join(' ')).toMatch(/2 sections not opened/);
  });

  it('refuses completion without a quiz attempt', () => {
    const r = canCompleteLesson({
      sectionsSeen: ['a', 'b'],
      requiredSections: ['a', 'b'],
      bestQuizRatio: null,
    });
    expect(r.allowed).toBe(false);
    expect(r.missing.join(' ')).toMatch(/quiz not attempted/);
  });

  it('refuses completion below 70 percent', () => {
    const r = canCompleteLesson({
      sectionsSeen: ['a'],
      requiredSections: ['a'],
      bestQuizRatio: 0.5,
    });
    expect(r.allowed).toBe(false);
    expect(r.missing.join(' ')).toMatch(/50% \(need 70%\)/);
  });

  it('allows completion when both conditions hold', () => {
    expect(
      canCompleteLesson({ sectionsSeen: ['a'], requiredSections: ['a'], bestQuizRatio: 0.7 }).allowed,
    ).toBe(true);
  });
});

describe('pace projection', () => {
  const base = {
    startDate: new Date('2026-01-01T00:00:00Z'),
    targetWeeks: 14,
    dailyGoalMinutes: 70,
    studyDaysPerWeek: 6,
    totalMinutes: 5000,
  };

  it('reports not-started with an honest estimate', () => {
    const p = computePace({ ...base, completedMinutes: 0, now: new Date('2026-01-02T00:00:00Z') });
    expect(p.status).toBe('not-started');
    expect(p.message).toMatch(/takes about \d+ weeks/);
  });

  it('detects being behind and says what capacity would be needed', () => {
    const p = computePace({
      ...base,
      completedMinutes: 500,
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(p.status).toBe('behind');
    expect(p.message).toMatch(/needs about \d+ h\/week/);
  });

  it('detects being ahead and redirects effort to interviews', () => {
    const p = computePace({
      ...base,
      completedMinutes: 4000,
      now: new Date('2026-02-01T00:00:00Z'),
    });
    expect(p.status).toBe('ahead');
    expect(p.message).toMatch(/mock interviews/);
  });
});

describe('recommender', () => {
  const empty = {
    dailyGoalMinutes: 70,
    minutesStudiedToday: 0,
    dueReviewItems: [],
    dueFlashcards: 0,
    nextLessons: [],
    weakTopics: [],
    lessonsByTopic: new Map(),
    lessonsCompleted: 0,
    daysSinceLastInterview: null,
    phaseComplete: false,
    curriculumComplete: false,
  };

  it('puts due review above new material', () => {
    const out = recommend({
      ...empty,
      dueFlashcards: 12,
      nextLessons: [{ slug: 'f-tcp-latency', title: 'TCP', estimatedMinutes: 40 }],
    });
    expect(out[0].kind).toBe('flashcards-due');
  });

  it('explains why each review item is queued', () => {
    const out = recommend({
      ...empty,
      dueReviewItems: [{ lessonId: 'f-indexes', title: 'Indexes', reason: 'quiz_miss' }],
    });
    const item = out.find((o) => o.kind === 'review-due');
    expect(item?.reason).toMatch(/you got questions on this wrong/);
  });

  it('tells the learner to stop when nothing is due', () => {
    const out = recommend({ ...empty, minutesStudiedToday: 90 });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('rest');
    expect(out[0].reason).toMatch(/Stopping here is the correct move/);
  });

  it('promotes the boss interview once the curriculum is complete', () => {
    const out = recommend({ ...empty, curriculumComplete: true, lessonsCompleted: 89 });
    expect(out[0].kind).toBe('boss-mode');
  });

  it('is deterministic for a fixed state', () => {
    const input = {
      ...empty,
      dueFlashcards: 5,
      nextLessons: [
        { slug: 'a', title: 'A', estimatedMinutes: 30 },
        { slug: 'b', title: 'B', estimatedMinutes: 30 },
      ],
    };
    expect(recommend(input)).toEqual(recommend(input));
  });

  it('ignores topics with no evidence when ranking weakness', () => {
    const scored = weakestTopics([
      { topic: 'untested', score: 0, confidence: 0, signals: {}, explanation: [] },
      { topic: 'weak', score: 0.3, confidence: 0.6, signals: { quiz: 0.3 }, explanation: [] },
      { topic: 'strong', score: 0.9, confidence: 0.8, signals: { quiz: 0.9 }, explanation: [] },
    ]);
    expect(scored.map((s) => s.topic)).toEqual(['weak']);
  });
});

describe('xp, levels and streaks', () => {
  it('needs more xp for each successive level', () => {
    const l1 = levelFromXp(0);
    const l2 = levelFromXp(250);
    expect(l1.level).toBe(1);
    expect(l2.level).toBe(2);
    expect(l2.needed).toBeGreaterThan(l1.needed);
  });

  it('counts a streak backwards from today, and does not break it before midnight passes', () => {
    const days = [
      { date: '2026-03-08', xp: 40 },
      { date: '2026-03-09', xp: 40 },
    ];
    // Nothing yet today: yesterday still counts.
    expect(currentStreak(days, new Date('2026-03-10T09:00:00'))).toBe(2);
    // Two days of silence breaks it.
    expect(currentStreak(days, new Date('2026-03-12T09:00:00'))).toBe(0);
  });

  it('finds the longest historical streak', () => {
    const days = [
      { date: '2026-01-01', xp: 10 },
      { date: '2026-01-02', xp: 10 },
      { date: '2026-01-03', xp: 10 },
      { date: '2026-01-09', xp: 10 },
    ];
    expect(longestStreak(days)).toBe(3);
  });

  it('groups xp events into local days', () => {
    const events = [
      { createdAt: new Date('2026-03-10T09:00:00'), amount: 40 },
      { createdAt: new Date('2026-03-10T21:00:00'), amount: 25 },
    ];
    const activity = toDailyActivity(events);
    expect(activity).toHaveLength(1);
    expect(activity[0].xp).toBe(65);
  });
});
