'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ensureLearner } from '@/db/repo/learner';
import {
  appendMessage,
  createInterview,
  getInterview,
  getMessages,
  recordHint,
  saveEvaluation,
  updateInterview,
} from '@/db/repo/interview';
import { listLessons, mintXp } from '@/db/repo/progress';
import { queueReview } from '@/db/repo/review';
import { XP_VALUES } from '@/lib/learning/xp';
import type { RewardPayload } from '@/lib/learning/reward';
import { getProblem } from '@/lib/ai/problems';
import { openingTurn } from '@/lib/ai/interviewer';
import { evaluateInterview, nextInterviewerTurn } from '@/lib/ai/engine';
import {
  adaptDifficulty,
  nextPhase,
  shouldAdvance,
  type Phase,
  type SessionState,
} from '@/lib/ai/session';
import type { Mode } from '@/lib/ai/rubric';

const StartInput = z.object({
  problemKey: z.string().min(1),
  companyStyle: z.string().min(1).nullable(),
});

export async function startInterview(formData: FormData) {
  const parsed = StartInput.safeParse({
    problemKey: formData.get('problemKey'),
    companyStyle: formData.get('companyStyle') || null,
  });
  if (!parsed.success) return;

  const problem = getProblem(parsed.data.problemKey);
  if (!problem) return;

  await ensureLearner();
  const interview = await createInterview({
    mode: problem.mode,
    problemKey: problem.key,
    companyStyle: parsed.data.companyStyle === 'none' ? null : parsed.data.companyStyle,
    difficulty: 'core',
    timeBudgetSeconds: problem.minutes * 60,
  });

  await appendMessage({
    interviewId: interview.id,
    role: 'interviewer',
    content: openingTurn(problem, problem.mode),
    meta: { phase: 'clarify' },
  });

  redirect(`/interview/${interview.id}`);
}

const AnswerInput = z.object({
  interviewId: z.string().min(1),
  content: z.string().trim().min(1).max(8000),
  hintRequested: z.boolean(),
});

export type AnswerResult = { ok: true } | { ok: false; error: string };

export async function submitAnswer(input: unknown): Promise<AnswerResult> {
  const parsed = AnswerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That answer could not be recorded.' };

  const { interviewId, content, hintRequested } = parsed.data;
  const interview = await getInterview(interviewId);
  if (!interview) return { ok: false, error: 'Unknown interview.' };
  if (interview.status !== 'active') return { ok: false, error: 'This interview is already finished.' };

  const problem = getProblem(interview.problemKey);
  if (!problem) return { ok: false, error: 'Unknown problem.' };

  await appendMessage({ interviewId, role: 'candidate', content, meta: { hintRequested } });
  if (hintRequested) await recordHint(interviewId);

  const transcript = await getMessages(interviewId);
  const candidateTurns = transcript.filter((m) => m.role === 'candidate').length;
  const elapsedSeconds = Math.round((Date.now() - interview.startedAt.getTime()) / 1000);

  const state: SessionState = {
    phase: interview.phase as Phase,
    elapsedSeconds,
    timeBudgetSeconds: interview.timeBudgetSeconds,
    hintsUsed: interview.hintsUsed + (hintRequested ? 1 : 0),
    candidateTurns,
    difficulty: interview.difficulty as SessionState['difficulty'],
  };

  const advanced = shouldAdvance(state) ? nextPhase(state.phase) : state.phase;
  const difficulty = adaptDifficulty(state, hintRequested);
  const finished = elapsedSeconds >= interview.timeBudgetSeconds;

  const reply = await nextInterviewerTurn({
    ctx: {
      problem,
      mode: interview.mode as Mode,
      companyStyle: interview.companyStyle,
      state: { ...state, phase: advanced, difficulty },
      hintRequested,
    },
    transcript: transcript.map((m) => ({
      role: m.role as 'interviewer' | 'candidate' | 'system',
      content: m.content,
    })),
    finished,
  });

  await appendMessage({
    interviewId,
    role: 'interviewer',
    content: reply,
    meta: { phase: advanced, hint: hintRequested },
  });

  await updateInterview(interviewId, {
    phase: advanced,
    difficulty,
    durationSeconds: elapsedSeconds,
  });

  revalidatePath(`/interview/${interviewId}`);
  return { ok: true };
}

export async function finishInterview(interviewId: string): Promise<RewardPayload | null> {
  const interview = await getInterview(interviewId);
  if (!interview) return null;

  const problem = getProblem(interview.problemKey);
  if (!problem) return null;

  if (interview.status === 'complete') {
    revalidatePath(`/interview/${interviewId}`);
    return null;
  }

  await updateInterview(interviewId, { status: 'evaluating', endedAt: new Date() });

  const [transcript, lessons] = await Promise.all([getMessages(interviewId), listLessons()]);
  const curriculumTopics = [...new Set(lessons.flatMap((l) => l.tags))];
  const durationSeconds = Math.round((Date.now() - interview.startedAt.getTime()) / 1000);

  const card = await evaluateInterview({
    problem,
    mode: interview.mode as Mode,
    transcript: transcript.map((m) => ({
      role: m.role as 'interviewer' | 'candidate' | 'system',
      content: m.content,
    })),
    hintsUsed: interview.hintsUsed,
    durationSeconds,
    reachedPhase: interview.phase as Phase,
    curriculumTopics,
  });

  // Topics the scorecard flags become review items, so a bad interview changes
  // tomorrow's study plan (docs/SCHEMA.md → mock_interview_evaluations).
  const topicToLesson = new Map<string, string>();
  for (const l of lessons) {
    for (const t of l.tags) if (!topicToLesson.has(t)) topicToLesson.set(t, l.slug);
  }
  const recommendedLessons = [
    ...new Set(card.recommendedTopics.flatMap((t) => (topicToLesson.has(t) ? [topicToLesson.get(t)!] : []))),
  ];

  await saveEvaluation({
    interviewId,
    overallScore: card.overallScore,
    rubric: card.rubric,
    strengths: card.strengths,
    weaknesses: card.weaknesses,
    missedConcepts: card.missedConcepts,
    recommendedLessons,
    summary: card.summary,
  });

  for (const slug of recommendedLessons) {
    await queueReview(slug, 'interview_gap', 70);
  }

  await updateInterview(interviewId, {
    status: 'complete',
    endedAt: new Date(),
    durationSeconds,
  });

  const reward =
    interview.mode === 'boss'
      ? await mintXp('boss_cleared', XP_VALUES.boss_cleared, interviewId)
      : await mintXp('interview_complete', XP_VALUES.interview_complete, interviewId);

  revalidatePath(`/interview/${interviewId}`);
  revalidatePath('/interview');
  revalidatePath('/');
  revalidatePath('/review');
  return reward;
}

export async function abandonInterview(interviewId: string): Promise<void> {
  await updateInterview(interviewId, { status: 'abandoned', endedAt: new Date() });
  revalidatePath('/interview');
}

