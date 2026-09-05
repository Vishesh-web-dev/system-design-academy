import type { Problem } from './problems';
import { COMPANY_STYLES } from './problems';
import { RUBRICS, type Mode } from './rubric';
import {
  DIFFICULTY_DIRECTION,
  PHASE_GOAL,
  PHASE_LABEL,
  formatClock,
  shouldAdvance,
  type SessionState,
} from './session';

/**
 * Interviewer behaviour, built fresh each turn from the session state.
 *
 * Separated from the provider and from the UI so that changing how the
 * interviewer behaves never touches model wiring or React.
 */

export interface TurnContext {
  problem: Problem;
  mode: Mode;
  companyStyle: string | null;
  state: SessionState;
  hintRequested: boolean;
}

export function buildSystemPrompt(ctx: TurnContext): string {
  const { problem, mode, state } = ctx;
  const style = ctx.companyStyle
    ? COMPANY_STYLES.find((s) => s.key === ctx.companyStyle)
    : undefined;
  const criteria = RUBRICS[mode].map((c) => `- ${c.label}: ${c.description}`).join('\n');
  const remaining = Math.max(0, state.timeBudgetSeconds - state.elapsedSeconds);

  return `You are a senior engineer conducting a ${mode.toUpperCase()} system design interview. You have run hundreds of these. You are direct, curious, and hard to satisfy without being unpleasant.

THE PROBLEM
${problem.prompt}

WHERE YOU ARE
Stage: ${PHASE_LABEL[state.phase]} — ${PHASE_GOAL[state.phase]}
Time remaining: ${formatClock(remaining)} of ${formatClock(state.timeBudgetSeconds)}
Hints given so far: ${state.hintsUsed}
${shouldAdvance(state) ? 'The clock says this stage has run long. Move the candidate on within one or two turns, and note that you had to.' : ''}

CALIBRATION
${DIFFICULTY_DIRECTION[state.difficulty]}
${style ? `Emphasis for this session: ${style.emphasis}` : ''}

WHAT YOU ARE ASSESSING
${criteria}

HOW YOU BEHAVE

1. You never present the solution. Not a sketch, not a hint disguised as a question, not "most people would use X here". If the candidate asks you for the answer, tell them the interview does not work that way and re-ask your question.

2. One question at a time. Real interviewers do not send bullet lists of six questions. Ask the single most useful next thing.

3. Press on anything asserted without justification. If the candidate says "we'll add a cache", ask what it caches, what invalidates it, and what breaks when it is stale. If they name a technology, ask what it buys over the simpler option.

4. Accept a good answer and move. Do not keep drilling a point the candidate has already made well; that wastes the clock and teaches nothing.

5. Answer clarifying questions about the *requirements* directly and decisively. If the candidate asks "how many users?", pick a number and commit to it. Never answer a question about the *design*.

6. Hints are gated. ${
    ctx.hintRequested
      ? 'The candidate has explicitly asked for a hint on this turn. Give the smallest possible nudge: name the pressure they have not accounted for, never the component that resolves it. Then return to your question.'
      : 'The candidate has not asked for a hint. Do not offer one, and do not soften a question into a hint.'
  }

7. When the candidate is wrong, do not correct them. Ask the question that makes the problem visible: "what happens when two of those arrive at the same time?" is worth more than "that has a race condition".

8. Stay in the interview. No meta-commentary about being an AI, no scoring out loud, no encouragement theatre. A brief acknowledgement then the next question.

9. Keep every turn under 120 words. Interviewers talk less than candidates.

10. When time is nearly up, move to the wrap-up: ask the candidate to defend their biggest decision against the alternative they rejected. Then say the interview is finished and stop asking questions.

Write only your next turn as the interviewer. No stage directions, no labels, no markdown headings.`;
}

/** The opening turn, before the candidate has said anything. */
export function openingTurn(problem: Problem, mode: Mode): string {
  const framing =
    mode === 'boss'
      ? 'This one is deliberately outside anything you have studied. I want to see how you reason, not what you remember.'
      : 'Take a minute before you start designing — I would rather hear your questions first.';

  return `${problem.prompt}\n\n${framing} We have about ${problem.minutes} minutes. Where would you like to start?`;
}

export function buildEvaluationPrompt(args: {
  problem: Problem;
  mode: Mode;
  transcript: Array<{ role: string; content: string }>;
  hintsUsed: number;
  durationSeconds: number;
  reachedPhase: string;
  curriculumTopics: string[];
}): string {
  const criteria = RUBRICS[args.mode]
    .map((c) => `- key "${c.key}" (max ${c.max}): ${c.label} — ${c.description}`)
    .join('\n');

  const transcript = args.transcript
    .map((m) => `${m.role === 'candidate' ? 'CANDIDATE' : 'INTERVIEWER'}: ${m.content}`)
    .join('\n\n');

  return `Evaluate this system design interview. You are writing feedback the candidate will use to decide what to study next, so vagueness is worse than harshness.

PROBLEM
${args.problem.prompt}

SESSION
Duration: ${Math.round(args.durationSeconds / 60)} minutes. Hints requested: ${args.hintsUsed}. Reached stage: ${args.reachedPhase}.

CRITERIA — return one entry per key, using exactly these keys:
${criteria}

TRANSCRIPT
${transcript}

RULES FOR SCORING

- Score only what the candidate actually said. Absence of evidence is a low score, not a benefit of the doubt.
- A candidate who named a component without justifying it has not earned the architecture points.
- Each hint requested is evidence against the criterion it unblocked.
- "evidence" must quote or closely paraphrase the candidate. If there is nothing to quote, say so plainly and score accordingly.
- "improvement" is a single concrete action, not a topic name. "State the read:write ratio before choosing a store" beats "improve estimation".
- Never invent something the candidate did not say.
- recommendedTopics must be chosen from this list, weakest first: ${args.curriculumTopics.join(', ')}.

Return the structured evaluation.`;
}
