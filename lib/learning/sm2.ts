/**
 * SM-2 spaced repetition, used for flashcards and for lesson-level review
 * items. Pure functions so the scheduling rules are unit-testable without a
 * database (docs/MILESTONES.md → M5, M6).
 *
 * Grades follow the original SM-2 scale:
 *   0 blackout · 1 wrong, familiar · 2 wrong, easy to recall once shown
 *   3 correct with serious difficulty · 4 correct after hesitation · 5 instant
 *
 * The UI only exposes 1 (again), 3 (hard), 4 (good), 5 (easy) because a
 * four-button choice is one a tired learner can make honestly at 11pm.
 */

export type Grade = 0 | 1 | 2 | 3 | 4 | 5;

export interface SchedulingState {
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export interface Scheduled extends SchedulingState {
  dueAt: Date;
}

export const INITIAL_STATE: SchedulingState = {
  ease: 2.5,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
};

const MIN_EASE = 1.3;
const DAY_MS = 86_400_000;

/** Grades below 3 are failures: the card returns to the front of the queue. */
export function isLapse(grade: Grade): boolean {
  return grade < 3;
}

export function schedule(state: SchedulingState, grade: Grade, now: Date = new Date()): Scheduled {
  const ease = Math.max(
    MIN_EASE,
    state.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)),
  );

  if (isLapse(grade)) {
    // Reset the interval but keep the (now lower) ease. A lapsed card is worth
    // less than a new card: it has proved it can be forgotten.
    return {
      ease,
      intervalDays: 0,
      repetitions: 0,
      lapses: state.lapses + 1,
      dueAt: new Date(now.getTime() + 10 * 60_000),
    };
  }

  const repetitions = state.repetitions + 1;
  let intervalDays: number;
  if (repetitions === 1) intervalDays = 1;
  else if (repetitions === 2) intervalDays = 6;
  else intervalDays = Math.round(state.intervalDays * ease);

  // Long intervals are capped: this curriculum runs for 14 weeks, and a card
  // scheduled 9 months out is a card that never gets reviewed before the
  // interviews it was written for.
  intervalDays = Math.min(intervalDays, 120);

  return {
    ease,
    intervalDays,
    repetitions,
    lapses: state.lapses,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
  };
}

/**
 * Retrievability estimate for ordering the queue and for mastery decay.
 * An exponential forgetting curve whose half-life is the current interval:
 * a card 1 interval past its last review sits at ~0.5.
 */
export function retrievability(
  intervalDays: number,
  lastReviewedAt: Date | null,
  now: Date = new Date(),
): number {
  if (!lastReviewedAt || intervalDays <= 0) return 0;
  const elapsedDays = (now.getTime() - lastReviewedAt.getTime()) / DAY_MS;
  if (elapsedDays <= 0) return 1;
  return Math.pow(0.5, elapsedDays / intervalDays);
}

/** The four buttons the reviewer shows, in order. */
export const REVIEW_GRADES: Array<{ grade: Grade; label: string; hint: string }> = [
  { grade: 1, label: 'Again', hint: 'Could not recall it' },
  { grade: 3, label: 'Hard', hint: 'Recalled it, but it was a struggle' },
  { grade: 4, label: 'Good', hint: 'Recalled it after a pause' },
  { grade: 5, label: 'Easy', hint: 'Instant' },
];
