import { retrievability } from './sm2';

/**
 * The mastery model (docs/PRODUCT.md → Mastery model).
 *
 * Two rules govern this file:
 *   1. Opening a lesson contributes nothing. Only retrieval and reasoning move
 *      a score.
 *   2. Every number is explainable. `MasteryScore.signals` carries the
 *      per-source contribution so the UI can show why a topic sits at 0.42,
 *      and the model is presented as a useful heuristic, not a measurement.
 */

export type SignalSource =
  | 'quiz'
  | 'scenarioQuiz'
  | 'flashcards'
  | 'exercises'
  | 'interview'
  | 'decay';

/** Weights sum to 1 before decay is applied. Scenario quiz counts double a
 *  recall quiz because a recall question can be passed by memory alone. */
export const WEIGHTS: Record<Exclude<SignalSource, 'decay'>, number> = {
  quiz: 0.2,
  scenarioQuiz: 0.3,
  flashcards: 0.15,
  exercises: 0.15,
  interview: 0.2,
};

export interface QuizSignal {
  topic: string;
  correct: boolean;
  scenario: boolean;
  /** Most recent attempts weigh more; index 0 is the newest. */
  recencyRank: number;
}

export interface FlashcardSignal {
  topic: string;
  intervalDays: number;
  lastReviewedAt: Date | null;
  lapses: number;
}

export interface ExerciseSignal {
  topic: string;
  /** Learner's own 1–5 rating against the rubric. */
  selfRating: number;
  rubricHitRatio: number;
}

export interface InterviewSignal {
  topic: string;
  /** 0–1, from the mock interview rubric criterion covering this topic. */
  score: number;
  at: Date;
}

export interface MasteryScore {
  topic: string;
  /** 0–1. */
  score: number;
  /** 0–1: how much evidence this score rests on. Low confidence, loud caveat. */
  confidence: number;
  signals: Partial<Record<SignalSource, number>>;
  /** Human-readable reasons, rendered directly in the UI. */
  explanation: string[];
}

/** Newest attempt counts fully; each older one counts less. */
function recencyWeight(rank: number): number {
  return Math.pow(0.6, rank);
}

function weightedRatio(items: Array<{ hit: boolean; weight: number }>): number | undefined {
  if (!items.length) return undefined;
  const total = items.reduce((a, i) => a + i.weight, 0);
  if (total === 0) return undefined;
  return items.reduce((a, i) => a + (i.hit ? i.weight : 0), 0) / total;
}

export interface MasteryInput {
  topic: string;
  quiz?: QuizSignal[];
  flashcards?: FlashcardSignal[];
  exercises?: ExerciseSignal[];
  interviews?: InterviewSignal[];
  now?: Date;
}

export function computeMastery(input: MasteryInput): MasteryScore {
  const now = input.now ?? new Date();
  const explanation: string[] = [];
  const signals: Partial<Record<SignalSource, number>> = {};

  const quizAll = input.quiz ?? [];
  const recall = quizAll.filter((q) => !q.scenario);
  const scenario = quizAll.filter((q) => q.scenario);

  const recallScore = weightedRatio(
    recall.map((q) => ({ hit: q.correct, weight: recencyWeight(q.recencyRank) })),
  );
  if (recallScore !== undefined) {
    signals.quiz = recallScore;
    explanation.push(
      `${Math.round(recallScore * 100)}% on ${recall.length} recall question${recall.length === 1 ? '' : 's'}`,
    );
  }

  const scenarioScore = weightedRatio(
    scenario.map((q) => ({ hit: q.correct, weight: recencyWeight(q.recencyRank) })),
  );
  if (scenarioScore !== undefined) {
    signals.scenarioQuiz = scenarioScore;
    explanation.push(
      `${Math.round(scenarioScore * 100)}% on ${scenario.length} scenario question${scenario.length === 1 ? '' : 's'}`,
    );
  }

  const cards = input.flashcards ?? [];
  if (cards.length) {
    const strength =
      cards.reduce((a, c) => {
        const r = retrievability(c.intervalDays, c.lastReviewedAt, now);
        // A card that has lapsed repeatedly is weak even when freshly reviewed.
        const lapsePenalty = Math.max(0, 1 - c.lapses * 0.15);
        return a + r * lapsePenalty;
      }, 0) / cards.length;
    signals.flashcards = strength;
    explanation.push(`Recall strength ${Math.round(strength * 100)}% across ${cards.length} cards`);
  }

  const exs = input.exercises ?? [];
  if (exs.length) {
    const value =
      exs.reduce((a, e) => a + (0.5 * ((e.selfRating - 1) / 4) + 0.5 * e.rubricHitRatio), 0) /
      exs.length;
    signals.exercises = value;
    explanation.push(`${exs.length} exercise submission${exs.length === 1 ? '' : 's'}`);
  }

  const ivs = input.interviews ?? [];
  if (ivs.length) {
    const sorted = [...ivs].sort((a, b) => b.at.getTime() - a.at.getTime());
    const value = weightedRatio(
      sorted.flatMap((iv, i) => [
        { hit: true, weight: recencyWeight(i) * iv.score },
        { hit: false, weight: recencyWeight(i) * (1 - iv.score) },
      ]),
    );
    if (value !== undefined) {
      signals.interview = value;
      explanation.push(`Mock interview rubric across ${ivs.length} session${ivs.length === 1 ? '' : 's'}`);
    }
  }

  // Renormalise over the sources that actually produced evidence, so a topic
  // with only quiz data is not punished for lacking an interview signal.
  const present = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).filter(
    (k) => signals[k] !== undefined,
  );
  const totalWeight = present.reduce((a, k) => a + WEIGHTS[k], 0);
  const raw = totalWeight
    ? present.reduce((a, k) => a + WEIGHTS[k] * (signals[k] as number), 0) / totalWeight
    : 0;

  // Confidence is about the breadth and volume of evidence, not the score.
  const volume = quizAll.length + cards.length + exs.length * 2 + ivs.length * 3;
  const breadth = present.length / Object.keys(WEIGHTS).length;
  const confidence = Math.min(1, (volume / 12) * 0.6 + breadth * 0.4);

  if (!present.length) {
    explanation.push('No retrieval evidence yet — opening a lesson does not count.');
  }
  if (confidence < 0.35 && present.length) {
    explanation.push('Low confidence: too few data points to trust this number yet.');
  }

  return {
    topic: input.topic,
    score: Number(raw.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    signals,
    explanation,
  };
}

export type MasteryBand = 'unknown' | 'shaky' | 'working' | 'solid' | 'interview-ready';

export function band(m: MasteryScore): MasteryBand {
  if (!Object.keys(m.signals).length) return 'unknown';
  if (m.score < 0.45) return 'shaky';
  if (m.score < 0.65) return 'working';
  if (m.score < 0.85 || m.confidence < 0.5) return 'solid';
  return 'interview-ready';
}

export const BAND_LABEL: Record<MasteryBand, string> = {
  unknown: 'Not tested',
  shaky: 'Shaky',
  working: 'Working',
  solid: 'Solid',
  'interview-ready': 'Interview-ready',
};

/**
 * Whether a lesson may be marked complete. Deliberately stricter than "I read
 * it": all sections opened, and a quiz attempt at 70% or better.
 */
export function canCompleteLesson(args: {
  sectionsSeen: string[];
  requiredSections: string[];
  bestQuizRatio: number | null;
}): { allowed: boolean; missing: string[] } {
  const missing: string[] = [];
  const unseen = args.requiredSections.filter((s) => !args.sectionsSeen.includes(s));
  if (unseen.length) missing.push(`${unseen.length} section${unseen.length === 1 ? '' : 's'} not opened`);
  if (args.bestQuizRatio === null) missing.push('quiz not attempted');
  else if (args.bestQuizRatio < 0.7) missing.push(`best quiz score ${Math.round(args.bestQuizRatio * 100)}% (need 70%)`);
  return { allowed: missing.length === 0, missing };
}
