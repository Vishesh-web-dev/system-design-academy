/**
 * Candidate session state: which stage of the interview we are in, how much
 * time is left, how many hints were spent, and whether difficulty should move.
 *
 * Pure functions, no I/O, so the progression rules are unit-testable without a
 * model or a database (docs/ARCHITECTURE.md → AI interviewer architecture).
 */

export const PHASES = [
  'clarify',
  'estimate',
  'design',
  'deepdive',
  'scale',
  'failure',
  'wrapup',
] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  clarify: 'Clarify',
  estimate: 'Estimate',
  design: 'Design',
  deepdive: 'Deep dive',
  scale: 'Scale',
  failure: 'Failure',
  wrapup: 'Wrap up',
};

/** Fraction of the time budget each phase should have consumed by its end. */
const PHASE_BUDGET: Record<Phase, number> = {
  clarify: 0.12,
  estimate: 0.22,
  design: 0.5,
  deepdive: 0.7,
  scale: 0.82,
  failure: 0.94,
  wrapup: 1,
};

export const PHASE_GOAL: Record<Phase, string> = {
  clarify:
    'Get the candidate to separate functional from non-functional requirements and state the scope they are designing to.',
  estimate:
    'Get the candidate to derive traffic, storage and bandwidth from assumptions they state out loud.',
  design:
    'Get a high-level architecture with each component justified by a pressure already established.',
  deepdive:
    'Pick the genuinely hard component and go three levels deeper than the candidate volunteered.',
  scale:
    'Establish what breaks first at ten times the load, and whether the candidate changes the design or just adds machines.',
  failure:
    'Establish concrete failure modes, how each is detected, and how it is contained.',
  wrapup:
    'Ask the candidate to defend the biggest decision against the alternative they rejected.',
};

export interface SessionState {
  phase: Phase;
  elapsedSeconds: number;
  timeBudgetSeconds: number;
  hintsUsed: number;
  candidateTurns: number;
  difficulty: 'intro' | 'core' | 'advanced';
}

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

/** The phase the clock says we should be in. */
export function expectedPhase(elapsedSeconds: number, budgetSeconds: number): Phase {
  const fraction = budgetSeconds > 0 ? elapsedSeconds / budgetSeconds : 0;
  for (const p of PHASES) {
    if (fraction <= PHASE_BUDGET[p]) return p;
  }
  return 'wrapup';
}

/**
 * Whether the interviewer should move the candidate on. Real interviewers do
 * this: a candidate who spends 20 minutes clarifying has already failed the
 * time-management part, and the interview is more useful if it advances.
 */
export function shouldAdvance(state: SessionState): boolean {
  const expected = expectedPhase(state.elapsedSeconds, state.timeBudgetSeconds);
  return phaseIndex(expected) > phaseIndex(state.phase);
}

export function nextPhase(phase: Phase): Phase {
  const i = phaseIndex(phase);
  return PHASES[Math.min(i + 1, PHASES.length - 1)];
}

export function isOver(state: SessionState): boolean {
  return state.phase === 'wrapup' && state.elapsedSeconds >= state.timeBudgetSeconds;
}

/**
 * Difficulty adaptation.
 *
 * Moves on evidence, not on vibes: hints are the strongest negative signal a
 * text interview produces, and progress relative to the clock is the strongest
 * positive one. Deliberately conservative — an interview that swings difficulty
 * every turn tells the learner nothing.
 */
export function adaptDifficulty(state: SessionState, hintJustUsed: boolean): SessionState['difficulty'] {
  const hintRate = state.candidateTurns > 0 ? state.hintsUsed / state.candidateTurns : 0;
  const ahead = phaseIndex(state.phase) > phaseIndex(expectedPhase(state.elapsedSeconds, state.timeBudgetSeconds));

  if (hintJustUsed && hintRate >= 0.4) {
    return state.difficulty === 'advanced' ? 'core' : 'intro';
  }
  if (ahead && hintRate < 0.15 && state.candidateTurns >= 4) {
    return state.difficulty === 'intro' ? 'core' : 'advanced';
  }
  return state.difficulty;
}

export const DIFFICULTY_DIRECTION: Record<SessionState['difficulty'], string> = {
  intro:
    'The candidate is struggling. Ask narrower questions with one concept each, and accept a partial answer before moving on.',
  core:
    'Standard depth. One follow-up per answer, and press once on anything asserted without justification.',
  advanced:
    'The candidate is comfortable. Attack the weakest assumption in their design, introduce a constraint they did not plan for, and ask them to defend a decision against a specific alternative.',
};

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
