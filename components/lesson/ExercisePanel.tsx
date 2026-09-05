'use client';

import { useState, useTransition } from 'react';
import type { Exercise } from '@/content/schema';
import { Button, Tag } from '../ui/primitives';
import { RevealBlock } from './RevealBlock';
import { Markdown } from './Markdown';
import { submitExercise } from '@/app/lesson/exercise-actions';

/**
 * Write-then-compare. The model answer stays locked until something has been
 * submitted, because reading a model answer before attempting one teaches
 * recognition rather than production (docs/CONTENT_STYLE.md → Active learning).
 *
 * Self-assessment against the rubric is the grading mechanism: an LLM grade
 * here would be a worse signal than an honest engineer checking their own work
 * against explicit criteria, and it would cost a model call per exercise.
 */
export function ExercisePanel({
  exercise,
  previous,
}: {
  exercise: Exercise;
  previous: { response: string; selfRating: number | null; rubricHits: string[] } | null;
}) {
  const [response, setResponse] = useState(previous?.response ?? '');
  const [submitted, setSubmitted] = useState(Boolean(previous));
  const [hits, setHits] = useState<string[]>(previous?.rubricHits ?? []);
  const [rating, setRating] = useState<number | null>(previous?.selfRating ?? null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const tooShort = response.trim().split(/\s+/).filter(Boolean).length < 25;

  function save(nextHits = hits, nextRating = rating) {
    startTransition(async () => {
      const result = await submitExercise({
        exerciseId: exercise.id,
        response,
        rubricHits: nextHits,
        selfRating: nextRating,
      });
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        setSubmitted(true);
      }
    });
  }

  return (
    <div className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="signal">{exercise.kind}</Tag>
        <span className="font-mono text-xs text-[var(--text-faint)]">
          ~{exercise.estimatedMinutes} min
        </span>
      </div>
      <h3 className="mt-3 text-base font-semibold">{exercise.title}</h3>
      <Markdown className="mt-3 text-sm">{exercise.prompt}</Markdown>

      <div className="mt-5">
        <label htmlFor={`ex-${exercise.id}`} className="text-xs font-semibold text-[var(--text-faint)]">
          Your answer
        </label>
        <textarea
          id={`ex-${exercise.id}`}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          rows={10}
          placeholder="Work it out here. Numbers, tables and rough diagrams in text are all fine — what matters is that you produce the reasoning before you read anyone else's."
          className="mt-1.5 w-full resize-y rounded-[3px] border border-[var(--rule-strong)] bg-[var(--ground)] p-3 font-mono text-[0.8125rem] leading-relaxed outline-none placeholder:text-[var(--text-faint)] focus-visible:border-signal-600"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => save()} disabled={tooShort || pending}>
            {pending ? 'Saving…' : submitted ? 'Update answer' : 'Submit answer'}
          </Button>
          {tooShort ? (
            <span className="text-xs text-[var(--text-faint)]">
              Write at least a few sentences — the model answer unlocks after you have attempted it.
            </span>
          ) : null}
          {error ? <span className="text-xs text-alert-400">{error}</span> : null}
        </div>
      </div>

      {submitted ? (
        <div className="mt-6 border-t border-[var(--rule)] pt-5">
          <p className="text-xs font-semibold text-[var(--text-faint)]">
            Check your answer against the rubric — honestly
          </p>
          <ul className="mt-2 space-y-1.5">
            {exercise.rubric.map((r) => {
              const checked = hits.includes(r);
              return (
                <li key={r}>
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked ? hits.filter((h) => h !== r) : [...hits, r];
                        setHits(next);
                        save(next, rating);
                      }}
                      className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--color-signal-500)]"
                    />
                    <span className={checked ? '' : 'text-[var(--text-dim)]'}>{r}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-faint)]">How did that go?</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={rating === n ? 'primary' : 'ghost'}
                onClick={() => {
                  setRating(n);
                  save(hits, n);
                }}
                aria-label={`Self rating ${n} of 5`}
              >
                {n}
              </Button>
            ))}
            <span className="text-xs text-[var(--text-faint)]">1 = lost · 5 = would defend it</span>
          </div>

          <div className="mt-5">
            <RevealBlock label="Show the model answer" hint="Compare, do not copy.">
              <Markdown className="text-sm">{exercise.modelAnswer}</Markdown>
            </RevealBlock>
          </div>
        </div>
      ) : null}
    </div>
  );
}
