import type { MasteryScore } from './mastery';

/**
 * "What should I study today?" — the dashboard's first job.
 *
 * Deterministic given its input, so it can be unit-tested against a fixed
 * state fixture (docs/MILESTONES.md → M13). It never returns more than a
 * day's worth of work: a list of 30 things is a list of zero things.
 */

export type ActionKind =
  | 'review-due'
  | 'flashcards-due'
  | 'weak-topic'
  | 'next-lesson'
  | 'mock-interview'
  | 'boss-mode'
  | 'rest';

export interface Recommendation {
  kind: ActionKind;
  title: string;
  /** Why this, right now. Shown under the title — never a bare instruction. */
  reason: string;
  href: string;
  estimatedMinutes: number;
  priority: number;
}

export interface RecommendInput {
  dailyGoalMinutes: number;
  minutesStudiedToday: number;
  dueReviewItems: Array<{ lessonId: string; title: string; reason: string }>;
  dueFlashcards: number;
  /** Lessons unlocked by prerequisites and not yet completed, in curriculum order. */
  nextLessons: Array<{ slug: string; title: string; estimatedMinutes: number }>;
  weakTopics: MasteryScore[];
  /** Lessons whose weak topic can be revised, keyed by topic. */
  lessonsByTopic: Map<string, { slug: string; title: string }>;
  lessonsCompleted: number;
  daysSinceLastInterview: number | null;
  phaseComplete: boolean;
  curriculumComplete: boolean;
}

const REVIEW_REASON: Record<string, string> = {
  quiz_miss: 'you got questions on this wrong',
  flashcard_lapse: 'cards from this lesson keep lapsing',
  interview_gap: 'a mock interview exposed a gap here',
  decay: 'it has been long enough that recall is fading',
};

export function recommend(input: RecommendInput): Recommendation[] {
  const out: Recommendation[] = [];
  const budget = Math.max(0, input.dailyGoalMinutes - input.minutesStudiedToday);

  // 1. Review always comes before new material. Forgetting is more expensive
  //    than not-yet-learning.
  if (input.dueFlashcards > 0) {
    out.push({
      kind: 'flashcards-due',
      title: `Review ${input.dueFlashcards} card${input.dueFlashcards === 1 ? '' : 's'}`,
      reason: 'These are due today. Clearing them keeps the intervals growing instead of resetting.',
      href: '/review',
      estimatedMinutes: Math.max(3, Math.round(input.dueFlashcards * 0.4)),
      priority: 100,
    });
  }

  for (const item of input.dueReviewItems.slice(0, 3)) {
    out.push({
      kind: 'review-due',
      title: `Revisit ${item.title}`,
      reason: `Queued because ${REVIEW_REASON[item.reason] ?? 'it needs another pass'}.`,
      href: `/lesson/${item.lessonId}?mode=revision`,
      estimatedMinutes: 8,
      priority: 90,
    });
  }

  // 2. A weak topic that has an owning lesson is worth more than the next new
  //    lesson, because interviews probe depth, not coverage.
  for (const topic of input.weakTopics.slice(0, 2)) {
    const lesson = input.lessonsByTopic.get(topic.topic);
    if (!lesson) continue;
    out.push({
      kind: 'weak-topic',
      title: `Strengthen ${topic.topic.replace(/-/g, ' ')}`,
      reason:
        topic.explanation[0] ??
        'Your retrieval on this topic is below the rest of the curriculum.',
      href: `/lesson/${lesson.slug}`,
      estimatedMinutes: 15,
      priority: 80,
    });
  }

  // 3. New material, in dependency order.
  let spent = 0;
  for (const lesson of input.nextLessons) {
    if (spent >= budget && out.length > 0) break;
    out.push({
      kind: 'next-lesson',
      title: lesson.title,
      reason: 'Next in the curriculum, and its prerequisites are done.',
      href: `/lesson/${lesson.slug}`,
      estimatedMinutes: lesson.estimatedMinutes,
      priority: 70 - spent / 100,
    });
    spent += lesson.estimatedMinutes;
    if (out.filter((o) => o.kind === 'next-lesson').length >= 2) break;
  }

  // 4. Practice under pressure. Weekly, or after finishing a phase.
  const interviewOverdue = input.daysSinceLastInterview === null
    ? input.lessonsCompleted >= 6
    : input.daysSinceLastInterview >= 7;

  if (input.phaseComplete || interviewOverdue) {
    out.push({
      kind: 'mock-interview',
      title: input.phaseComplete ? 'Weekly boss interview' : 'Run a mock interview',
      reason: input.phaseComplete
        ? 'You finished a phase. The only way to know it stuck is to be questioned on it.'
        : input.daysSinceLastInterview === null
          ? 'You have not been interviewed yet. Reading builds recognition; interviews build recall.'
          : `Last interview was ${input.daysSinceLastInterview} days ago.`,
      href: '/interview',
      estimatedMinutes: 45,
      priority: input.phaseComplete ? 85 : 60,
    });
  }

  if (input.curriculumComplete) {
    out.push({
      kind: 'boss-mode',
      title: 'Boss Mode: an unfamiliar system',
      reason: 'The curriculum is done. What matters now is whether it transfers to a system you have never seen.',
      href: '/interview/boss',
      estimatedMinutes: 50,
      priority: 95,
    });
  }

  if (!out.length) {
    out.push({
      kind: 'rest',
      title: 'Nothing is due',
      reason:
        'No cards due, no review items, and the daily goal is met. Stopping here is the correct move — spacing is doing the work now.',
      href: '/curriculum',
      estimatedMinutes: 0,
      priority: 0,
    });
  }

  return out.sort((a, b) => b.priority - a.priority).slice(0, 5);
}

/** Topics ranked weakest-first, ignoring topics with no evidence at all. */
export function weakestTopics(scores: MasteryScore[], limit = 5): MasteryScore[] {
  return scores
    .filter((s) => Object.keys(s.signals).length > 0 && s.score < 0.65)
    .sort((a, b) => a.score - b.score || b.confidence - a.confidence)
    .slice(0, limit);
}
