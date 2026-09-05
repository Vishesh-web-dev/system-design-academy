import Link from 'next/link';
import { Figure, Meter, Sheet, Tag } from '../ui/primitives';

/**
 * The scorecard. Every criterion carries the evidence it was scored from and
 * one concrete action, because "improve your estimation" is not feedback a
 * learner can act on tomorrow morning.
 */
export function Scorecard({
  score,
  summary,
  rubric,
  strengths,
  weaknesses,
  missedConcepts,
  recommendedLessons,
  transcript,
}: {
  score: number;
  summary: string;
  rubric: Array<{ label: string; score: number; max: number; evidence: string; improvement: string }>;
  strengths: string[];
  weaknesses: string[];
  missedConcepts: string[];
  recommendedLessons: string[];
  transcript: Array<{ id: string; role: string; content: string }>;
}) {
  const tone = score >= 70 ? 'signal' : score >= 50 ? 'brass' : 'alert';

  return (
    <div className="space-y-8" data-testid="scorecard">
      <Sheet>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <Figure value={`${score}`} label="overall score, out of 100" tone={tone} />
          <p className="max-w-[52ch] text-sm text-[var(--text-dim)]">{summary}</p>
        </div>
        <Meter className="mt-5" value={score} max={100} tone={tone === 'brass' ? 'brass' : tone} label="Overall score" />
      </Sheet>

      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">By criterion</h2>
        <ul className="space-y-4">
          {rubric.map((r) => (
            <li key={r.label} className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{r.label}</span>
                <span className="font-mono text-sm tabular-nums text-[var(--text-dim)]">
                  {r.score}
                  <span className="text-[var(--text-faint)]">/{r.max}</span>
                </span>
              </div>
              <Meter
                className="mt-2"
                value={r.score}
                max={r.max}
                tone={r.score / r.max >= 0.7 ? 'signal' : 'alert'}
                label={`${r.label} score`}
              />
              <p className="mt-3 max-w-[70ch] text-sm text-[var(--text-dim)]">
                <span className="font-medium text-[var(--text)]">Evidence: </span>
                {r.evidence}
              </p>
              <p className="mt-1.5 max-w-[70ch] text-sm text-[var(--text-dim)]">
                <span className="font-medium text-signal-400">Do this next time: </span>
                {r.improvement}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold">Strengths</h2>
          <ul className="space-y-2">
            {strengths.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="mt-2 h-px w-3 shrink-0 bg-signal-600" aria-hidden />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold">Weaknesses</h2>
          <ul className="space-y-2">
            {weaknesses.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="mt-2 h-px w-3 shrink-0 bg-alert-600" aria-hidden />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {missedConcepts.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Never raised, but the problem needed it</h2>
          <div className="flex flex-wrap gap-1.5">
            {missedConcepts.map((c) => (
              <Tag key={c} tone="alert">
                {c}
              </Tag>
            ))}
          </div>
        </section>
      ) : null}

      {recommendedLessons.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Queued for review</h2>
          <p className="mb-3 max-w-[66ch] text-sm text-[var(--text-dim)]">
            These lessons are now in your review queue, so a bad interview changes tomorrow&apos;s
            study plan rather than just producing a number.
          </p>
          <ul className="space-y-1.5">
            {recommendedLessons.map((slug) => (
              <li key={slug}>
                <Link href={`/lesson/${slug}`} className="text-sm text-signal-400 hover:underline">
                  {slug}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer text-sm font-medium">Full transcript</summary>
        <div className="mt-4 space-y-4">
          {transcript.map((t) => (
            <div key={t.id} className="max-w-[70ch]">
              <p className="mb-1 font-mono text-[0.6875rem] uppercase tracking-wide text-[var(--text-faint)]">
                {t.role === 'candidate' ? 'you' : 'interviewer'}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-dim)]">
                {t.content}
              </p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
