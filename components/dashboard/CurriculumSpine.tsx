import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { LessonNode } from '@/lib/learning/dashboard';
import type { curriculum } from '@/content/curriculum';

/**
 * The whole curriculum in one glance: 89 cells, grouped by phase, coloured by
 * state. This is the dashboard's centrepiece rather than a row of stat tiles,
 * because "where am I, what is open, what is still locked" is the question a
 * learner actually opens this page to answer.
 *
 * Server-rendered. No JavaScript is needed to read it.
 */

const STATE_STYLE: Record<LessonNode['state'], string> = {
  completed: 'bg-signal-500 border-signal-500',
  in_progress: 'bg-signal-600/40 border-signal-500',
  available: 'border-paper-400 bg-transparent',
  locked: 'border-[var(--rule)] bg-transparent',
  unwritten: 'border-[var(--rule)] bg-[repeating-linear-gradient(45deg,var(--rule),var(--rule)_1px,transparent_1px,transparent_3px)]',
};

const STATE_LABEL: Record<LessonNode['state'], string> = {
  completed: 'complete',
  in_progress: 'in progress',
  available: 'open',
  locked: 'locked',
  unwritten: 'not written yet',
};

export function CurriculumSpine({
  lessons,
  phases,
}: {
  lessons: LessonNode[];
  phases: typeof curriculum.phases;
}) {
  return (
    <div className="plan-grid rounded-[3px] border border-[var(--rule)] p-5">
      <div className="flex flex-wrap gap-x-8 gap-y-6">
        {phases.map((phase) => {
          const inPhase = lessons.filter((l) => l.phase === phase.id);
          const done = inPhase.filter((l) => l.state === 'completed').length;
          const written = inPhase.filter((l) => l.state !== 'unwritten').length;

          return (
            <div key={phase.id} className="min-w-[10rem] flex-1">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="text-[0.8125rem] font-semibold tracking-tight">{phase.title}</h3>
                <span className="font-mono text-xs tabular-nums text-[var(--text-faint)]">
                  {done}/{inPhase.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {inPhase.map((l) =>
                  l.state === 'unwritten' ? (
                    <span
                      key={l.slug}
                      title={`${l.title} — not written yet`}
                      className={cn('h-3.5 w-3.5 rounded-[1px] border', STATE_STYLE[l.state])}
                    />
                  ) : (
                    <Link
                      key={l.slug}
                      href={`/lesson/${l.slug}`}
                      title={`${l.position}. ${l.title} — ${STATE_LABEL[l.state]}`}
                      aria-label={`${l.title}, ${STATE_LABEL[l.state]}`}
                      className={cn(
                        'h-3.5 w-3.5 rounded-[1px] border transition-transform hover:scale-125',
                        STATE_STYLE[l.state],
                      )}
                    />
                  ),
                )}
              </div>
              <p className="mt-2 font-mono text-[0.6875rem] text-[var(--text-faint)]">
                week {phase.weeks} · {written} written
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--rule)] pt-4 text-xs text-[var(--text-faint)]">
        {(['completed', 'in_progress', 'available', 'locked', 'unwritten'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-[1px] border', STATE_STYLE[s])} />
            {STATE_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
