/**
 * Achievements (docs/PRODUCT.md → Gamification rules).
 *
 * The rule that shapes this file is the same one that shapes XP: an achievement
 * rewards *retrieval and reasoning*, never page views or logging in. Every
 * unlock condition is mechanical and derivable from the XP ledger plus the
 * current streak, so each one is unit-testable (docs/MILESTONES.md → M12).
 *
 * This module is pure — no database, no `server-only` — so both the server
 * (when minting XP) and the client (the achievements page) can import it.
 */

export interface AchievementDef {
  name: string;
  /** One short sentence, past tense: what you did to earn it. */
  description: string;
  /** A single emoji. Plain signifier, never a brand. */
  icon: string;
  /** The mechanical unlock condition, in words, shown on the locked card. */
  criteria: string;
}

export const ACHIEVEMENTS = {
  'first-lesson': {
    name: 'Shipped One',
    description: 'Completed your first lesson end to end.',
    icon: '🚀',
    criteria: 'Complete 1 lesson',
  },
  'lessons-10': {
    name: 'Momentum',
    description: 'Completed ten lessons.',
    icon: '📚',
    criteria: 'Complete 10 lessons',
  },
  'first-quiz': {
    name: 'First Blood',
    description: 'Passed your first quiz.',
    icon: '🎯',
    criteria: 'Pass 1 quiz (70% or better)',
  },
  'quiz-10': {
    name: 'Quiz Master',
    description: 'Passed ten quizzes.',
    icon: '🧠',
    criteria: 'Pass 10 quizzes',
  },
  'perfect-quiz': {
    name: 'Flawless',
    description: 'Scored a perfect quiz.',
    icon: '💯',
    criteria: 'Get 100% on a quiz',
  },
  'exercise-10': {
    name: 'Deep Diver',
    description: 'Submitted ten exercises.',
    icon: '✍️',
    criteria: 'Submit 10 exercises',
  },
  'cards-50': {
    name: 'Spaced Out',
    description: 'Cleared fifty flashcard reviews.',
    icon: '🗂️',
    criteria: 'Review 50 flashcards',
  },
  'first-interview': {
    name: 'Under Pressure',
    description: 'Finished your first mock interview.',
    icon: '🎙️',
    criteria: 'Finish 1 mock interview',
  },
  boss: {
    name: 'Boss Slayer',
    description: 'Cleared Boss Mode on an unfamiliar system.',
    icon: '👑',
    criteria: 'Clear Boss Mode',
  },
  'streak-7': {
    name: 'Steady',
    description: 'Studied seven days in a row.',
    icon: '🔥',
    criteria: '7-day streak',
  },
  'streak-30': {
    name: 'Relentless',
    description: 'Studied thirty days in a row.',
    icon: '⚡',
    criteria: '30-day streak',
  },
} as const satisfies Record<string, AchievementDef>;

export type AchievementCode = keyof typeof ACHIEVEMENTS;

/** Display order: easiest-first, so the page reads as a ladder. */
export const ACHIEVEMENT_ORDER: AchievementCode[] = [
  'first-lesson',
  'first-quiz',
  'perfect-quiz',
  'first-interview',
  'streak-7',
  'lessons-10',
  'quiz-10',
  'exercise-10',
  'cards-50',
  'boss',
  'streak-30',
];

export interface AchievementState {
  /** The learner's XP ledger — only `kind` is read. */
  events: Array<{ kind: string }>;
  /** Current streak in days. */
  streak: number;
}

/**
 * Every achievement code whose condition the given state satisfies. Minting
 * code diffs this against what is already unlocked to find what is *new*.
 */
export function evaluateAchievements(state: AchievementState): AchievementCode[] {
  const count = (kinds: string[]) => state.events.filter((e) => kinds.includes(e.kind)).length;
  const quizPasses = count(['quiz_pass', 'quiz_perfect']);
  const lessons = count(['lesson_complete']);

  const out: AchievementCode[] = [];
  if (lessons >= 1) out.push('first-lesson');
  if (lessons >= 10) out.push('lessons-10');
  if (quizPasses >= 1) out.push('first-quiz');
  if (quizPasses >= 10) out.push('quiz-10');
  if (count(['quiz_perfect']) >= 1) out.push('perfect-quiz');
  if (count(['exercise_submit']) >= 10) out.push('exercise-10');
  if (count(['flashcard_review']) >= 50) out.push('cards-50');
  if (count(['interview_complete', 'boss_cleared']) >= 1) out.push('first-interview');
  if (count(['boss_cleared']) >= 1) out.push('boss');
  if (state.streak >= 7) out.push('streak-7');
  if (state.streak >= 30) out.push('streak-30');
  return out;
}
