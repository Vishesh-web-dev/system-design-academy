import Link from 'next/link';
import { ArrowUpRight, Flame } from 'lucide-react';
import { loadDashboard } from '@/lib/learning/dashboard';
import { CurriculumSpine } from '@/components/dashboard/CurriculumSpine';
import { Button, EmptyState, Figure, Meter, Sheet, Tag } from '@/components/ui/primitives';
import { BAND_LABEL, band } from '@/lib/learning/mastery';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Today · System Design Academy' };

const PACE_TONE = {
  ahead: 'signal',
  'on-track': 'signal',
  behind: 'alert',
  'not-started': 'neutral',
} as const;

export default async function Dashboard() {
  const d = await loadDashboard();
  const nothingWritten = d.counts.authored === 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--rule)] pb-7">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
          <p className="mt-2 max-w-[58ch] text-sm text-[var(--text-dim)]">{d.pace.message}</p>
        </div>
        <div className="flex gap-8">
          <Figure
            value={d.streak.current}
            label={d.streak.current === 1 ? 'day streak' : 'day streak'}
            tone={d.streak.current > 0 ? 'brass' : 'neutral'}
            sub={d.streak.longest > d.streak.current ? `best ${d.streak.longest}` : undefined}
          />
          <Figure value={`L${d.xp.level}`} label="level" sub={`${d.xp.into}/${d.xp.needed} XP`} />
          <Figure
            value={`${d.counts.completed}/${d.counts.authored || d.counts.planned}`}
            label="lessons done"
            tone="signal"
          />
        </div>
      </header>

      {/* What should I do today — the page's first job. */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">What to do now</h2>
          <span className="font-mono text-xs text-[var(--text-faint)]">
            {d.counts.minutesToday} min studied today
          </span>
        </div>

        {nothingWritten ? (
          <div className="mt-4">
            <EmptyState
              title="No lessons are written yet"
              body="The curriculum is planned and the dependency graph is in place, but no lesson content has been authored. Run the content pipeline, then come back here."
              action={
                <Link href="/curriculum">
                  <Button variant="secondary">See the plan</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {d.recommendations.map((r) => (
              <li key={`${r.kind}-${r.href}-${r.title}`}>
                <Link
                  href={r.href}
                  className="group flex items-start gap-4 rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--rule-strong)]"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{r.title}</span>
                      {r.estimatedMinutes > 0 ? (
                        <span className="font-mono text-xs text-[var(--text-faint)]">
                          ~{r.estimatedMinutes} min
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block max-w-[70ch] text-sm text-[var(--text-dim)]">
                      {r.reason}
                    </span>
                  </span>
                  <ArrowUpRight
                    size={15}
                    className="mt-0.5 shrink-0 text-[var(--text-faint)] transition-colors group-hover:text-[var(--text)]"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Where am I */}
      <section className="mt-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Where you are</h2>
          <Link href="/curriculum" className="text-sm text-signal-400 hover:underline">
            Open the curriculum
          </Link>
        </div>
        <CurriculumSpine lessons={d.lessons} phases={d.phases} />
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {/* What am I weak at */}
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">What you are weak at</h2>
          {d.weak.length === 0 ? (
            <EmptyState
              title="No weak topics yet"
              body="Mastery only moves on retrieval — quizzes, exercises, flashcards and mock interviews. Opening a lesson contributes nothing, deliberately."
            />
          ) : (
            <ul className="space-y-3">
              {d.weak.map((m) => (
                <li key={m.topic} className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{m.topic.replace(/-/g, ' ')}</span>
                    <Tag tone={m.score < 0.45 ? 'alert' : 'neutral'}>{BAND_LABEL[band(m)]}</Tag>
                  </div>
                  <Meter
                    className="mt-2.5"
                    value={m.score}
                    tone={m.score < 0.45 ? 'alert' : 'signal'}
                    label={`${m.topic} mastery`}
                  />
                  <ul className="mt-2 space-y-0.5">
                    {m.explanation.map((e, i) => (
                      <li key={i} className="text-xs text-[var(--text-faint)]">
                        {e}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Am I on track */}
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Pace</h2>
          <Sheet>
            <div className="flex flex-wrap gap-8">
              <Figure
                value={`${Math.round(d.pace.percentComplete * 100)}%`}
                label="curriculum complete"
                tone={PACE_TONE[d.pace.status]}
              />
              <Figure
                value={`${Math.round(d.pace.expectedPercent * 100)}%`}
                label="expected by now"
              />
              <Figure
                value={`${Math.round(d.pace.minutesRemaining / 60)}h`}
                label="work remaining"
                sub={`${d.pace.weeksNeeded.toFixed(1)} weeks at your capacity`}
              />
            </div>
            <div className="relative mt-5">
              <Meter value={d.pace.percentComplete} tone={PACE_TONE[d.pace.status] === 'alert' ? 'alert' : 'signal'} label="Curriculum progress" />
              <span
                className="absolute -top-1 h-3 w-px bg-brass-400"
                style={{ left: `${d.pace.expectedPercent * 100}%` }}
                aria-hidden
              />
            </div>
            <p className="mt-2 text-xs text-[var(--text-faint)]">
              The brass mark is where you would be to finish in {Math.round(d.pace.weeksRemaining + d.pace.weeksElapsed)} weeks.
            </p>
          </Sheet>

          <Sheet className="mt-4">
            <h3 className="text-sm font-semibold">Due now</h3>
            <div className="mt-3 flex flex-wrap gap-8">
              <Figure
                value={d.counts.dueFlashcards}
                label="cards due"
                tone={d.counts.dueFlashcards > 0 ? 'alert' : 'neutral'}
              />
              <Figure
                value={d.counts.dueReviews}
                label="lessons to revisit"
                tone={d.counts.dueReviews > 0 ? 'alert' : 'neutral'}
              />
            </div>
            {d.counts.dueFlashcards + d.counts.dueReviews > 0 ? (
              <Link href="/review" className="mt-4 inline-block">
                <Button variant="primary" size="sm">
                  <Flame size={14} /> Start review
                </Button>
              </Link>
            ) : (
              <p className="mt-3 text-sm text-[var(--text-dim)]">
                Nothing is due. Spacing only works if you let the intervals run.
              </p>
            )}
          </Sheet>
        </section>
      </div>
    </div>
  );
}
