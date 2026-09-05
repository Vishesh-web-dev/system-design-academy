import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ensureLearner } from '@/db/repo/learner';
import { getEvaluation, getInterview, getMessages } from '@/db/repo/interview';
import { getProblem } from '@/lib/ai/problems';
import { isLive } from '@/lib/ai/provider';
import { RUBRICS, type Mode } from '@/lib/ai/rubric';
import type { Phase } from '@/lib/ai/session';
import { InterviewSession } from '@/components/interview/InterviewSession';
import { Scorecard } from '@/components/interview/Scorecard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Interview session · System Design Academy' };

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureLearner();

  const interview = await getInterview(id);
  if (!interview) notFound();

  const problem = getProblem(interview.problemKey);
  const [messages, evaluation] = await Promise.all([getMessages(id), getEvaluation(id)]);

  const criteria = RUBRICS[interview.mode as Mode];
  const labels = new Map(criteria.map((c) => [c.key, c.label]));

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 lg:px-10">
      <Link
        href="/interview"
        className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
      >
        <ArrowLeft size={14} /> All interviews
      </Link>

      <header className="border-b border-[var(--rule)] pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{problem?.title ?? interview.problemKey}</h1>
        <p className="mt-1.5 max-w-[66ch] text-sm text-[var(--text-dim)]">{problem?.prompt}</p>
      </header>

      <div className="mt-6">
        {evaluation ? (
          <Scorecard
            score={evaluation.overallScore}
            summary={evaluation.summary}
            rubric={evaluation.rubric.map((r) => ({ ...r, label: labels.get(r.criterion) ?? r.criterion }))}
            strengths={evaluation.strengths}
            weaknesses={evaluation.weaknesses}
            missedConcepts={evaluation.missedConcepts}
            recommendedLessons={evaluation.recommendedLessons}
            transcript={messages.map((m) => ({
              id: m.id,
              role: m.role as 'interviewer' | 'candidate' | 'system',
              content: m.content,
            }))}
          />
        ) : (
          <InterviewSession
            interviewId={id}
            turns={messages.map((m) => ({
              id: m.id,
              role: m.role as 'interviewer' | 'candidate' | 'system',
              content: m.content,
              hint: Boolean((m.meta as { hint?: boolean }).hint),
            }))}
            startedAtIso={interview.startedAt.toISOString()}
            timeBudgetSeconds={interview.timeBudgetSeconds}
            phase={interview.phase as Phase}
            hintsUsed={interview.hintsUsed}
            status={interview.status}
            live={isLive()}
          />
        )}
      </div>
    </div>
  );
}
