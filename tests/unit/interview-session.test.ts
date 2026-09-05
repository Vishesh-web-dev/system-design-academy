import { describe, expect, it } from 'vitest';
import {
  PHASES,
  adaptDifficulty,
  expectedPhase,
  formatClock,
  isOver,
  nextPhase,
  shouldAdvance,
  type SessionState,
} from '@/lib/ai/session';
import { RUBRICS, maxScore, EvaluationSchema } from '@/lib/ai/rubric';
import { buildSystemPrompt, openingTurn } from '@/lib/ai/interviewer';
import { mockEvaluation, mockTurn } from '@/lib/ai/mock';
import { PROBLEMS, getProblem } from '@/lib/ai/problems';

const base: SessionState = {
  phase: 'clarify',
  elapsedSeconds: 0,
  timeBudgetSeconds: 2700,
  hintsUsed: 0,
  candidateTurns: 0,
  difficulty: 'core',
};

describe('interview session state machine', () => {
  it('maps elapsed time onto the phase the clock expects', () => {
    expect(expectedPhase(0, 2700)).toBe('clarify');
    expect(expectedPhase(2700 * 0.3, 2700)).toBe('design');
    expect(expectedPhase(2700 * 0.75, 2700)).toBe('scale');
    expect(expectedPhase(2700, 2700)).toBe('wrapup');
    expect(expectedPhase(9999, 2700)).toBe('wrapup');
  });

  it('advances a candidate who has overrun a stage', () => {
    expect(shouldAdvance({ ...base, elapsedSeconds: 60 })).toBe(false);
    expect(shouldAdvance({ ...base, elapsedSeconds: 2700 * 0.4 })).toBe(true);
  });

  it('never advances past wrap-up', () => {
    expect(nextPhase('wrapup')).toBe('wrapup');
    expect(nextPhase(PHASES[0])).toBe(PHASES[1]);
  });

  it('ends only at wrap-up with the clock expired', () => {
    expect(isOver({ ...base, phase: 'wrapup', elapsedSeconds: 2700 })).toBe(true);
    expect(isOver({ ...base, phase: 'scale', elapsedSeconds: 9999 })).toBe(false);
  });

  it('lowers difficulty when hints are being leaned on', () => {
    const struggling: SessionState = {
      ...base,
      candidateTurns: 5,
      hintsUsed: 3,
      difficulty: 'advanced',
      elapsedSeconds: 600,
    };
    expect(adaptDifficulty(struggling, true)).toBe('core');
  });

  it('raises difficulty for a candidate ahead of the clock without hints', () => {
    const strong: SessionState = {
      ...base,
      phase: 'scale',
      candidateTurns: 6,
      hintsUsed: 0,
      elapsedSeconds: 300,
      difficulty: 'core',
    };
    expect(adaptDifficulty(strong, false)).toBe('advanced');
  });

  it('does not move difficulty on thin evidence', () => {
    expect(adaptDifficulty({ ...base, candidateTurns: 1 }, false)).toBe('core');
  });

  it('formats the clock as minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(2700)).toBe('45:00');
  });
});

describe('interviewer prompt', () => {
  const problem = getProblem('hld-url-shortener')!;

  it('forbids revealing the solution', () => {
    const p = buildSystemPrompt({
      problem,
      mode: 'hld',
      companyStyle: null,
      state: base,
      hintRequested: false,
    });
    expect(p).toMatch(/never present the solution/i);
    expect(p).toMatch(/Do not offer one/);
  });

  it('gates hints on an explicit request', () => {
    const withHint = buildSystemPrompt({
      problem,
      mode: 'hld',
      companyStyle: null,
      state: base,
      hintRequested: true,
    });
    expect(withHint).toMatch(/smallest possible nudge/);
    expect(withHint).toMatch(/never the component that resolves it/);
  });

  it('carries the company emphasis when one is chosen', () => {
    const styled = buildSystemPrompt({
      problem,
      mode: 'hld',
      companyStyle: 'correctness',
      state: base,
      hintRequested: false,
    });
    expect(styled).toMatch(/Emphasis for this session/);
    expect(styled).toMatch(/idempotency/i);
  });

  it('tells the interviewer to move on when the stage has overrun', () => {
    const late = buildSystemPrompt({
      problem,
      mode: 'hld',
      companyStyle: null,
      state: { ...base, elapsedSeconds: 2700 * 0.45 },
      hintRequested: false,
    });
    expect(late).toMatch(/Move the candidate on/);
  });

  it('opens without leaking an approach', () => {
    const opening = openingTurn(problem, 'hld');
    expect(opening).toContain(problem.prompt);
    expect(opening).not.toMatch(/cache|shard|database/i);
  });

  it('frames boss mode as a transfer test', () => {
    const boss = getProblem('boss-warehouse-robots')!;
    expect(openingTurn(boss, 'boss')).toMatch(/outside anything you have studied/);
  });
});

describe('rubrics', () => {
  it('gives every mode a rubric that sums to a usable maximum', () => {
    for (const mode of Object.keys(RUBRICS) as Array<keyof typeof RUBRICS>) {
      expect(maxScore(mode), mode).toBeGreaterThan(50);
      expect(new Set(RUBRICS[mode].map((c) => c.key)).size).toBe(RUBRICS[mode].length);
    }
  });

  it('grades boss mode on transfer as well as design', () => {
    expect(RUBRICS.boss.some((c) => c.key === 'transfer')).toBe(true);
  });

  it('validates a well-formed evaluation and rejects an empty one', () => {
    expect(
      EvaluationSchema.safeParse({
        overallSummary: 'x'.repeat(100),
        criteria: [{ key: 'requirements', score: 8, evidence: 'y'.repeat(30), improvement: 'z'.repeat(30) }],
        strengths: ['Solid estimation work throughout.'],
        weaknesses: ['Never named a partition key.'],
        missedConcepts: [],
        recommendedTopics: [],
      }).success,
    ).toBe(true);

    expect(EvaluationSchema.safeParse({ overallSummary: 'too short' }).success).toBe(false);
  });
});

describe('scripted interviewer', () => {
  it('is deterministic for a given state', () => {
    const args = { state: base, candidateTurns: 1, hintRequested: false, finished: false };
    expect(mockTurn(args)).toBe(mockTurn(args));
  });

  it('gives a nudge, not a component, when a hint is requested', () => {
    const hint = mockTurn({ state: { ...base, phase: 'design' }, candidateTurns: 2, hintRequested: true, finished: false });
    expect(hint).toMatch(/nudge/);
    expect(hint).not.toMatch(/\b(Redis|Kafka|CDN|load balancer)\b/i);
  });

  it('produces a scorecard whose scores stay inside the rubric maxima', () => {
    const problem = PROBLEMS[0];
    const out = mockEvaluation({
      problem,
      mode: 'hld',
      transcript: [
        { role: 'interviewer', content: 'Where would you like to start?' },
        { role: 'candidate', content: 'About 10M DAU, 200 QPS peak, 500 GB per year of storage. '.repeat(8) },
      ],
      hintsUsed: 1,
      reachedPhase: 'scale',
      curriculumTopics: ['caching', 'partitioning', 'estimation'],
    });

    for (const c of out.criteria) {
      const def = RUBRICS.hld.find((r) => r.key === c.key)!;
      expect(c.score).toBeLessThanOrEqual(def.max);
      expect(c.score).toBeGreaterThanOrEqual(0);
    }
    expect(out.recommendedTopics.every((t) => ['caching', 'partitioning', 'estimation'].includes(t))).toBe(true);
  });

  it('says plainly that it did not read the answers', () => {
    const out = mockEvaluation({
      problem: PROBLEMS[0],
      mode: 'hld',
      transcript: [],
      hintsUsed: 0,
      reachedPhase: 'clarify',
      curriculumTopics: [],
    });
    expect(out.overallSummary).toMatch(/cannot read|Scripted-interviewer/i);
  });
});

describe('problem bank', () => {
  it('has unique keys and a rubric for every mode used', () => {
    const keys = PROBLEMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PROBLEMS) expect(RUBRICS[p.mode], p.key).toBeDefined();
  });

  it('gives every boss problem a transfer note explaining why it resists recall', () => {
    for (const p of PROBLEMS.filter((x) => x.mode === 'boss')) {
      expect(p.transferNote, p.key).toBeTruthy();
    }
  });

  it('keeps boss problems out of the curriculum', async () => {
    const { lessonOrder } = await import('@/content/curriculum');
    for (const p of PROBLEMS.filter((x) => x.mode === 'boss')) {
      const stem = p.key.replace(/^boss-/, '');
      expect(lessonOrder.some((s) => s.includes(stem)), p.key).toBe(false);
    }
  });
});
