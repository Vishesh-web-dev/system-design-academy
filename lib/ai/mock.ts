import type { Problem } from './problems';
import { RUBRICS, type EvaluationOutput, type Mode } from './rubric';
import { PHASES, type Phase, type SessionState } from './session';

/**
 * The scripted interviewer.
 *
 * It exists so that the platform — and the E2E suite — never depends on a
 * network call or an API key. It is not a toy: it walks the same phase machine,
 * gates hints the same way, and produces a real scorecard, so a learner without
 * a key still gets a structured practice run. What it cannot do is react to the
 * *content* of an answer, and the UI says so.
 */

const PHASE_QUESTIONS: Record<Phase, string[]> = {
  clarify: [
    'Before any design: which requirements are functional and which are non-functional here? Give me the three that would change your architecture if I moved them.',
    'What is the read-to-write ratio, and how did you arrive at it? Assume you have to defend that number.',
  ],
  estimate: [
    'Give me the numbers out loud. Daily active users, requests per second at peak, and the storage this accumulates in a year. State your assumptions as you go.',
    'You have a storage figure. What does it imply about how many machines hold it, and what does that imply about your partition key?',
  ],
  design: [
    'Sketch the high-level architecture. For each component, tell me the pressure in the requirements that put it there — if you cannot name one, take it out.',
    'Walk me through the critical write path end to end. What happens between the client sending the request and the data being durable?',
  ],
  deepdive: [
    'Pick the component you think is hardest and go three levels deeper than you just did. I want the data structures and the failure behaviour, not the box.',
    'How is that component partitioned, and what happens to in-flight requests when you add capacity to it?',
  ],
  scale: [
    'Ten times the traffic arrives. What breaks first, and how do you know it is that and not something else?',
    'Which part of your design stops being correct — not just slow — as it grows? What would you change rather than scale?',
  ],
  failure: [
    'The datastore behind your busiest component becomes slow but not dead. Walk me through what the system does over the next five minutes, from the user backwards.',
    'How is that failure detected, who or what notices, and what stops it cascading into the components upstream?',
  ],
  wrapup: [
    'Last thing: pick the biggest decision you made and defend it against the alternative you rejected. What would have to be true for the other choice to win?',
  ],
};

const ACKS = [
  'Right.',
  'Okay.',
  'Understood.',
  'That is fair.',
  'Noted.',
];

const HINTS: Record<Phase, string> = {
  clarify:
    'A nudge: you have not said anything yet about how fresh the data has to be. That single choice usually decides half the architecture.',
  estimate:
    'A nudge: you are missing one of the three numbers that matter. Traffic, storage, and the ratio between reads and writes.',
  design:
    'A nudge: there is a pressure in the requirements that nothing in your design currently answers. Go back through them one at a time.',
  deepdive:
    'A nudge: the hard part is not the component you picked. Ask yourself which one holds state that two requests could touch at once.',
  scale:
    'A nudge: think about what is shared. The first thing to break at scale is almost always the thing every request has to touch.',
  failure:
    'A nudge: consider the difference between a dependency that is dead and one that is merely slow. Your system probably handles only one of those.',
  wrapup:
    'A nudge: name the alternative explicitly before defending against it. "It was simpler" is not a comparison.',
};

/** Deterministic: same session state and turn index always give the same turn. */
export function mockTurn(args: {
  state: SessionState;
  candidateTurns: number;
  hintRequested: boolean;
  finished: boolean;
}): string {
  if (args.hintRequested) return HINTS[args.state.phase];

  if (args.finished) {
    return 'That is time. Thanks — end the interview when you are ready and I will write up the scorecard.';
  }

  const questions = PHASE_QUESTIONS[args.state.phase];
  const q = questions[Math.min(args.candidateTurns, questions.length - 1)];
  const ack = ACKS[args.candidateTurns % ACKS.length];
  return `${ack} ${q}`;
}

/**
 * A scorecard built from what can be measured without understanding the
 * answers: coverage of the phases, length and specificity of responses, and
 * hint usage. It is honest about being a heuristic — the UI labels it.
 */
export function mockEvaluation(args: {
  problem: Problem;
  mode: Mode;
  transcript: Array<{ role: string; content: string }>;
  hintsUsed: number;
  reachedPhase: Phase;
  curriculumTopics: string[];
}): EvaluationOutput {
  const answers = args.transcript.filter((m) => m.role === 'candidate');
  const words = answers.reduce((a, m) => a + m.content.trim().split(/\s+/).length, 0);
  const phaseReach = (PHASES.indexOf(args.reachedPhase) + 1) / PHASES.length;

  // Specificity proxy: numbers, units and named mechanisms in the candidate's
  // own words. Crude, but it does distinguish "add a cache" from "cache the
  // 2% of keys serving 90% of reads, TTL 60s".
  const text = answers.map((a) => a.content).join(' ');
  const numbers = (text.match(/\b\d[\d,.]*\s*(ms|s|kb|mb|gb|tb|qps|rps|k|m|b|%)?\b/gi) ?? []).length;
  const specificity = Math.min(1, numbers / 12);

  const depth = Math.min(1, words / 700);
  const hintPenalty = Math.min(0.4, args.hintsUsed * 0.08);
  const base = Math.max(0, Math.min(1, phaseReach * 0.4 + depth * 0.3 + specificity * 0.3 - hintPenalty));

  const criteria = RUBRICS[args.mode].map((c) => ({
    key: c.key,
    score: Math.round(c.max * base * 10) / 10,
    evidence:
      answers.length === 0
        ? 'No answers were recorded for this criterion.'
        : `Scored from coverage rather than content: the scripted interviewer cannot read your answer. You reached the "${args.reachedPhase}" stage, wrote about ${words} words, and used ${args.hintsUsed} hint(s).`,
    improvement: c.description,
  }));

  const weakestTopics = args.curriculumTopics.slice(0, 4);

  return {
    overallSummary: `Scripted-interviewer run: this scorecard measures how far you got, how much you wrote, and how many numbers you used — not whether your answers were right. You reached the ${args.reachedPhase} stage with ${args.hintsUsed} hint(s). Set AI_PROVIDER and AI_API_KEY to have a model read and grade your actual reasoning.`,
    criteria,
    strengths:
      base > 0.5
        ? ['Worked through most of the interview stages within the time budget.']
        : ['Started the interview and engaged with the problem.'],
    weaknesses:
      specificity < 0.4
        ? ['Few concrete numbers. Estimation and trade-offs both need figures you state and then hold yourself to.']
        : ['Depth is hard to assess without a model reading the transcript.'],
    missedConcepts: [],
    recommendedTopics: weakestTopics,
  };
}
