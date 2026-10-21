'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import type { QuizQuestion } from '@/content/schema';
import { Button, Meter, Sheet, Tag } from '../ui/primitives';
import { useReward } from '@/components/reward/RewardProvider';
import { submitQuizAttempt } from '@/app/lesson/quiz-actions';
import { cn } from '@/lib/utils';

/**
 * One question at a time, answer locked in before the explanation appears.
 *
 * Showing the explanation only after a commitment is the entire pedagogical
 * value: a learner who reads the explanation alongside the options is testing
 * recognition, and recognition is what fails under interview pressure.
 */
export function QuizRunner({
  lessonSlug,
  lessonTitle,
  questions,
}: {
  lessonSlug: string;
  lessonTitle: string;
  questions: QuizQuestion[];
}) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [answers, setAnswers] = useState<
    Array<{ questionId: string; chosen: string[]; correct: boolean; topic: string }>
  >([]);
  const [finished, setFinished] = useState(false);
  const [pending, startTransition] = useTransition();
  const startedAt = useRef(new Date().toISOString());
  const router = useRouter();
  const reward = useReward();

  const q = questions[index];
  const isMulti = q?.kind === 'multi';
  const correctSet = useMemo(() => new Set(q?.correct ?? []), [q]);

  if (!q && !finished) {
    return <p className="text-sm text-[var(--text-dim)]">This lesson has no quiz questions.</p>;
  }

  function toggle(id: string) {
    if (locked) return;
    setChosen((prev) =>
      isMulti ? (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]) : [id],
    );
  }

  function lockIn() {
    const correct =
      chosen.length === correctSet.size && chosen.every((c) => correctSet.has(c));
    setLocked(true);
    setAnswers((prev) => [...prev, { questionId: q.id, chosen, correct, topic: q.topic }]);
  }

  function advance() {
    if (index + 1 < questions.length) {
      setIndex((i) => i + 1);
      setChosen([]);
      setLocked(false);
      return;
    }
    setFinished(true);
    startTransition(async () => {
      const res = await submitQuizAttempt({
        lessonId: lessonSlug,
        startedAt: startedAt.current,
        answers,
      });
      if (res.ok) reward.show(res.reward);
      router.refresh();
    });
  }

  if (finished) {
    const score = answers.filter((a) => a.correct).length;
    const ratio = answers.length ? score / answers.length : 0;
    const wrong = answers.filter((a) => !a.correct);
    const byTopic = new Map<string, { right: number; total: number }>();
    for (const a of answers) {
      const t = byTopic.get(a.topic) ?? { right: 0, total: 0 };
      t.total += 1;
      if (a.correct) t.right += 1;
      byTopic.set(a.topic, t);
    }

    return (
      <div className="space-y-6" data-testid="quiz-result">
        <Sheet>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-4xl leading-none tabular-nums">
                {score}
                <span className="text-[var(--text-faint)]">/{answers.length}</span>
              </p>
              <p className="mt-2 text-sm text-[var(--text-dim)]">
                {ratio >= 0.7
                  ? 'Above the 70% bar — this lesson can be marked complete.'
                  : 'Below the 70% bar. Reread the sections behind the misses, then retake.'}
              </p>
            </div>
            <div className="flex gap-2">
              <Link href={`/lesson/${lessonSlug}`}>
                <Button variant="secondary">Back to lesson</Button>
              </Link>
              <Button
                variant="primary"
                onClick={() => {
                  setIndex(0);
                  setChosen([]);
                  setLocked(false);
                  setAnswers([]);
                  setFinished(false);
                  startedAt.current = new Date().toISOString();
                }}
              >
                Retake
              </Button>
            </div>
          </div>
          <Meter className="mt-5" value={ratio} tone={ratio >= 0.7 ? 'signal' : 'alert'} label="Quiz score" />
        </Sheet>

        <div>
          <h2 className="text-sm font-semibold">By topic</h2>
          <ul className="mt-3 space-y-2">
            {[...byTopic.entries()].map(([topic, t]) => (
              <li key={topic} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 text-[var(--text-dim)]">{topic.replace(/-/g, ' ')}</span>
                <Meter value={t.right} max={t.total} tone={t.right === t.total ? 'signal' : 'alert'} />
                <span className="w-12 shrink-0 text-right font-mono text-xs text-[var(--text-faint)]">
                  {t.right}/{t.total}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {wrong.length ? (
          <div>
            <h2 className="text-sm font-semibold">What you missed</h2>
            <p className="mt-1 text-sm text-[var(--text-dim)]">
              These topics are now queued for review — the queue is driven by what you actually got
              wrong, not by a calendar.
            </p>
            <div className="mt-4 space-y-5">
              {wrong.map((a) => {
                const question = questions.find((x) => x.id === a.questionId)!;
                return (
                  <div key={a.questionId} className="border-l-2 border-alert-600 pl-4">
                    <p className="max-w-[66ch] text-sm font-medium">{question.prompt}</p>
                    <p className="mt-1.5 max-w-[66ch] text-sm text-[var(--text-dim)]">
                      {question.explanation}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {pending ? <p className="text-xs text-[var(--text-faint)]">Saving attempt…</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-xs text-[var(--text-faint)]">
          {lessonTitle} · question {index + 1} of {questions.length}
        </p>
        <Tag tone={q.kind === 'scenario' ? 'brass' : 'neutral'}>
          {q.kind === 'scenario' ? 'scenario' : q.kind === 'multi' ? 'select all' : 'single answer'}
        </Tag>
      </div>
      <Meter value={index} max={questions.length} label="Quiz progress" />

      <Sheet>
        <p className="max-w-[70ch] whitespace-pre-line text-[0.9375rem] leading-relaxed">{q.prompt}</p>

        <ul className="mt-5 space-y-2">
          {q.options.map((o) => {
            const picked = chosen.includes(o.id);
            const isCorrect = correctSet.has(o.id);
            const showState = locked && (picked || isCorrect);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => toggle(o.id)}
                  disabled={locked}
                  aria-pressed={picked}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-[3px] border p-3 text-left text-sm transition-colors',
                    !locked && 'hover:border-[var(--rule-strong)] hover:bg-[var(--surface-raised)]',
                    picked && !locked && 'border-signal-600 bg-[var(--surface-raised)]',
                    !picked && !showState && 'border-[var(--rule)]',
                    showState && isCorrect && 'border-signal-600 bg-signal-600/10',
                    showState && !isCorrect && picked && 'border-alert-600 bg-alert-600/10',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border text-[10px]',
                      isMulti ? 'rounded-[2px]' : 'rounded-full',
                      picked ? 'border-signal-500 text-signal-400' : 'border-[var(--rule-strong)]',
                    )}
                  >
                    {locked && isCorrect ? <Check size={11} /> : null}
                    {locked && picked && !isCorrect ? <X size={11} /> : null}
                    {!locked && picked ? '•' : null}
                  </span>
                  <span>{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {locked ? (
          <div className="mt-5 border-t border-[var(--rule)] pt-4">
            <p className="max-w-[70ch] text-sm text-[var(--text-dim)]">{q.explanation}</p>
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-3">
          {!locked ? (
            <Button variant="primary" onClick={lockIn} disabled={chosen.length === 0}>
              Lock in answer
            </Button>
          ) : (
            <Button variant="primary" onClick={advance}>
              {index + 1 < questions.length ? 'Next question' : 'See results'}
            </Button>
          )}
          {!locked && isMulti ? (
            <span className="text-xs text-[var(--text-faint)]">More than one answer is correct.</span>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
