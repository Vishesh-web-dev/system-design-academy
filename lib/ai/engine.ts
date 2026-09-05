import 'server-only';
import { generateObject, generateText } from 'ai';
import { getModel, isLive } from './provider';
import { buildEvaluationPrompt, buildSystemPrompt, type TurnContext } from './interviewer';
import { EvaluationSchema, RUBRICS, maxScore, type EvaluationOutput, type Mode } from './rubric';
import { mockEvaluation, mockTurn } from './mock';
import type { Problem } from './problems';
import type { Phase, SessionState } from './session';

/**
 * The boundary between the interview logic and whichever model is configured.
 * Everything above this file is provider-agnostic; everything below is the
 * Vercel AI SDK.
 */

export interface TranscriptMessage {
  role: 'interviewer' | 'candidate' | 'system';
  content: string;
}

export async function nextInterviewerTurn(args: {
  ctx: TurnContext;
  transcript: TranscriptMessage[];
  finished: boolean;
}): Promise<string> {
  const model = await getModel('main');

  if (!model) {
    return mockTurn({
      state: args.ctx.state,
      candidateTurns: args.ctx.state.candidateTurns,
      hintRequested: args.ctx.hintRequested,
      finished: args.finished,
    });
  }

  try {
    const { text } = await generateText({
      model,
      system: buildSystemPrompt(args.ctx),
      messages: args.transcript
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'candidate' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
      temperature: 0.7,
      maxTokens: 400,
    });
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  } catch {
    // A provider failure must not lose the session. Fall through to the
    // scripted interviewer and let the learner keep going.
  }

  return mockTurn({
    state: args.ctx.state,
    candidateTurns: args.ctx.state.candidateTurns,
    hintRequested: args.ctx.hintRequested,
    finished: args.finished,
  });
}

export interface Scorecard {
  overallScore: number;
  rubric: Array<{
    criterion: string;
    score: number;
    max: number;
    evidence: string;
    improvement: string;
  }>;
  strengths: string[];
  weaknesses: string[];
  missedConcepts: string[];
  recommendedTopics: string[];
  summary: string;
  generatedBy: 'model' | 'scripted';
}

/**
 * Produces the final scorecard. The model's output is schema-validated before
 * anything is persisted; a malformed response is retried once and then
 * degraded to the scripted evaluation rather than surfacing an error to a
 * learner who just spent 45 minutes.
 */
export async function evaluateInterview(args: {
  problem: Problem;
  mode: Mode;
  transcript: TranscriptMessage[];
  hintsUsed: number;
  durationSeconds: number;
  reachedPhase: Phase;
  curriculumTopics: string[];
}): Promise<Scorecard> {
  const criteria = RUBRICS[args.mode];
  const byKey = new Map(criteria.map((c) => [c.key, c]));

  const toScorecard = (out: EvaluationOutput, generatedBy: Scorecard['generatedBy']): Scorecard => {
    const rubric = criteria.map((c) => {
      const found = out.criteria.find((x) => x.key === c.key);
      return {
        criterion: c.key,
        score: Math.max(0, Math.min(c.max, found?.score ?? 0)),
        max: c.max,
        evidence: found?.evidence ?? 'Not addressed during the interview.',
        improvement: found?.improvement ?? c.description,
      };
    });
    const total = rubric.reduce((a, r) => a + r.score, 0);
    return {
      overallScore: Math.round((total / maxScore(args.mode)) * 100),
      rubric,
      strengths: out.strengths,
      weaknesses: out.weaknesses,
      missedConcepts: out.missedConcepts,
      recommendedTopics: out.recommendedTopics.filter((t) => args.curriculumTopics.includes(t)),
      summary: out.overallSummary,
      generatedBy,
    };
  };

  const model = isLive() ? await getModel('main') : null;

  if (model) {
    const prompt = buildEvaluationPrompt({
      problem: args.problem,
      mode: args.mode,
      transcript: args.transcript.filter((m) => m.role !== 'system'),
      hintsUsed: args.hintsUsed,
      durationSeconds: args.durationSeconds,
      reachedPhase: args.reachedPhase,
      curriculumTopics: args.curriculumTopics,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { object } = await generateObject({
          model,
          schema: EvaluationSchema,
          prompt,
          temperature: 0.2,
        });
        // Reject scores outside the rubric's range rather than clamping
        // silently on the first attempt — a model that invents a 40/10 has
        // probably misread the criteria and is worth re-asking.
        const outOfRange = object.criteria.some((c) => {
          const def = byKey.get(c.key);
          return !def || c.score < 0 || c.score > def.max;
        });
        if (outOfRange && attempt === 0) continue;
        return toScorecard(object, 'model');
      } catch {
        // Retry once, then degrade.
      }
    }
  }

  return toScorecard(
    mockEvaluation({
      problem: args.problem,
      mode: args.mode,
      transcript: args.transcript,
      hintsUsed: args.hintsUsed,
      reachedPhase: args.reachedPhase,
      curriculumTopics: args.curriculumTopics,
    }),
    'scripted',
  );
}

export type { SessionState };
