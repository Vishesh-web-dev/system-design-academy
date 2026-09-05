import { curriculum, lessonOrder } from '@/content/curriculum';
import { authoredSlugs } from '@/lib/content/loader';
import { ensureLearner } from '@/db/repo/learner';
import { getProgressMap, getXpEvents, listLessons, minutesStudiedOn } from '@/db/repo/progress';
import { allAttempts } from '@/db/repo/quiz';
import { allExerciseAttempts } from '@/db/repo/exercises';
import { countDueFlashcards, dueReviewItems, flashcardProgressForMastery } from '@/db/repo/review';
import { interviewSignals, lastInterviewAt } from '@/db/repo/interview';
import {
  computeMastery,
  type ExerciseSignal,
  type FlashcardSignal,
  type InterviewSignal,
  type MasteryScore,
  type QuizSignal,
} from './mastery';
import { computePace, type Pace } from './pace';
import { recommend, weakestTopics, type Recommendation } from './recommend';
import { currentStreak, levelFromXp, longestStreak, toDailyActivity } from './xp';

export type LessonState = 'locked' | 'available' | 'in_progress' | 'completed' | 'unwritten';

export interface LessonNode {
  slug: string;
  title: string;
  phase: string;
  module: string;
  position: number;
  estimatedMinutes: number;
  state: LessonState;
  prerequisites: string[];
  /** Prerequisites that are not yet complete — why this lesson is locked. */
  blockedBy: string[];
}

export interface DashboardData {
  lessons: LessonNode[];
  phases: typeof curriculum.phases;
  recommendations: Recommendation[];
  mastery: MasteryScore[];
  weak: MasteryScore[];
  pace: Pace;
  xp: { total: number; level: number; into: number; needed: number };
  streak: { current: number; longest: number };
  counts: {
    completed: number;
    authored: number;
    planned: number;
    dueFlashcards: number;
    dueReviews: number;
    minutesToday: number;
  };
  dueReviews: Array<{ lessonId: string; title: string; reason: string }>;
}

export async function loadDashboard(now: Date = new Date()): Promise<DashboardData> {
  const settings = await ensureLearner();

  const [
    lessonRows,
    progress,
    quizAttempts,
    exerciseAttempts,
    cardProgress,
    dueCards,
    reviews,
    xpEvents,
    ivSignals,
    lastInterview,
    minutesToday,
  ] = await Promise.all([
    listLessons(),
    getProgressMap(),
    allAttempts(),
    allExerciseAttempts(),
    flashcardProgressForMastery(),
    countDueFlashcards(now),
    dueReviewItems(now),
    getXpEvents(),
    interviewSignals(),
    lastInterviewAt(),
    minutesStudiedOn(now),
  ]);

  const written = new Set(authoredSlugs());
  const bySlug = new Map(lessonRows.map((l) => [l.slug, l]));

  // ── Lesson states and unlocking ───────────────────────────────────────────
  const lessons: LessonNode[] = lessonOrder.map((slug) => {
    const row = bySlug.get(slug);
    const p = progress.get(slug);

    if (!row || !written.has(slug)) {
      return {
        slug,
        title: row?.title ?? slug,
        phase: phaseIdFor(slug),
        module: moduleIdFor(slug),
        position: lessonOrder.indexOf(slug) + 1,
        estimatedMinutes: row?.estimatedMinutes ?? 45,
        state: 'unwritten' as const,
        prerequisites: row?.prerequisites ?? [],
        blockedBy: [],
      };
    }

    const blockedBy =
      settings.unlockMode === 'free'
        ? []
        : row.prerequisites.filter((pre) => progress.get(pre)?.status !== 'completed');

    const state: LessonState =
      p?.status === 'completed'
        ? 'completed'
        : blockedBy.length
          ? 'locked'
          : p?.status === 'in_progress'
            ? 'in_progress'
            : 'available';

    return {
      slug,
      title: row.title,
      phase: row.phaseId,
      module: row.moduleId.split('/')[1] ?? '',
      position: row.position,
      estimatedMinutes: row.estimatedMinutes,
      state,
      prerequisites: row.prerequisites,
      blockedBy,
    };
  });

  // ── Mastery per topic ─────────────────────────────────────────────────────
  const topics = new Set(lessonRows.flatMap((l) => l.tags));

  const quizByTopic = new Map<string, QuizSignal[]>();
  quizAttempts.forEach((attempt, attemptRank) => {
    for (const a of attempt.answers) {
      const list = quizByTopic.get(a.topic) ?? [];
      list.push({
        topic: a.topic,
        correct: a.correct,
        scenario: a.scenario,
        recencyRank: attemptRank,
      });
      quizByTopic.set(a.topic, list);
    }
  });

  const cardsByTopic = new Map<string, FlashcardSignal[]>();
  for (const c of cardProgress) {
    const list = cardsByTopic.get(c.topic) ?? [];
    list.push({
      topic: c.topic,
      intervalDays: c.intervalDays,
      lastReviewedAt: c.lastReviewedAt,
      lapses: c.lapses,
    });
    cardsByTopic.set(c.topic, list);
  }

  const exByTopic = new Map<string, ExerciseSignal[]>();
  for (const a of exerciseAttempts) {
    const lesson = bySlug.get(a.lessonId);
    const rubricHitRatio = a.rubricHits.length ? Math.min(1, a.rubricHits.length / 5) : 0;
    for (const topic of lesson?.tags ?? []) {
      const list = exByTopic.get(topic) ?? [];
      list.push({ topic, selfRating: a.selfRating ?? 3, rubricHitRatio });
      exByTopic.set(topic, list);
    }
  }

  const ivByTopic = new Map<string, InterviewSignal[]>();
  for (const s of ivSignals) {
    const list = ivByTopic.get(s.topic) ?? [];
    list.push(s);
    ivByTopic.set(s.topic, list);
  }

  const mastery = [...topics]
    .map((topic) =>
      computeMastery({
        topic,
        quiz: quizByTopic.get(topic),
        flashcards: cardsByTopic.get(topic),
        exercises: exByTopic.get(topic),
        interviews: ivByTopic.get(topic),
        now,
      }),
    )
    .sort((a, b) => a.score - b.score);

  const weak = weakestTopics(mastery);

  // ── Pace ──────────────────────────────────────────────────────────────────
  const totalMinutes = lessonOrder.reduce(
    (a, slug) => a + (bySlug.get(slug)?.estimatedMinutes ?? 45),
    0,
  );
  const completedMinutes = lessons
    .filter((l) => l.state === 'completed')
    .reduce((a, l) => a + l.estimatedMinutes, 0);

  const pace = computePace({
    startDate: new Date(`${settings.startDate}T00:00:00`),
    targetWeeks: settings.targetWeeks,
    dailyGoalMinutes: settings.dailyGoalMinutes,
    studyDaysPerWeek: settings.studyDays.length || 6,
    totalMinutes,
    completedMinutes,
    now,
  });

  // ── XP, level, streak ─────────────────────────────────────────────────────
  const activity = toDailyActivity(xpEvents);
  const totalXp = xpEvents.reduce((a, e) => a + e.amount, 0);
  const level = levelFromXp(totalXp);

  // ── Recommendations ───────────────────────────────────────────────────────
  const lessonsByTopic = new Map<string, { slug: string; title: string }>();
  for (const l of lessonRows) {
    for (const t of l.tags) {
      if (!lessonsByTopic.has(t)) lessonsByTopic.set(t, { slug: l.slug, title: l.title });
    }
  }

  const completedCount = lessons.filter((l) => l.state === 'completed').length;
  const phaseComplete = curriculum.phases.some((p) => {
    const inPhase = lessons.filter((l) => l.phase === p.id && l.state !== 'unwritten');
    return inPhase.length > 0 && inPhase.every((l) => l.state === 'completed');
  });

  const recommendations = recommend({
    dailyGoalMinutes: settings.dailyGoalMinutes,
    minutesStudiedToday: minutesToday,
    dueReviewItems: reviews.map((r) => ({ lessonId: r.lessonId, title: r.title, reason: r.reason })),
    dueFlashcards: dueCards,
    nextLessons: lessons
      .filter((l) => l.state === 'available' || l.state === 'in_progress')
      .slice(0, 4)
      .map((l) => ({ slug: l.slug, title: l.title, estimatedMinutes: l.estimatedMinutes })),
    weakTopics: weak,
    lessonsByTopic,
    lessonsCompleted: completedCount,
    daysSinceLastInterview: lastInterview
      ? Math.floor((now.getTime() - lastInterview.getTime()) / 86_400_000)
      : null,
    phaseComplete,
    curriculumComplete: written.size > 0 && completedCount === written.size,
  });

  return {
    lessons,
    phases: curriculum.phases,
    recommendations,
    mastery,
    weak,
    pace,
    xp: { total: totalXp, ...level },
    streak: { current: currentStreak(activity, now), longest: longestStreak(activity) },
    counts: {
      completed: completedCount,
      authored: written.size,
      planned: lessonOrder.length,
      dueFlashcards: dueCards,
      dueReviews: reviews.length,
      minutesToday,
    },
    dueReviews: reviews.map((r) => ({ lessonId: r.lessonId, title: r.title, reason: r.reason })),
  };
}

function phaseIdFor(slug: string): string {
  for (const p of curriculum.phases) {
    for (const m of p.modules) if (m.lessons.includes(slug)) return p.id;
  }
  return '';
}

function moduleIdFor(slug: string): string {
  for (const p of curriculum.phases) {
    for (const m of p.modules) if (m.lessons.includes(slug)) return m.id;
  }
  return '';
}
