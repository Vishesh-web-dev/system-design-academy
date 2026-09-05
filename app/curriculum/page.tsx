import Link from 'next/link';
import { Lock, CircleCheck, CircleDot, Circle } from 'lucide-react';
import { loadDashboard, type LessonNode } from '@/lib/learning/dashboard';
import { Meter, Tag } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Curriculum · System Design Academy' };

const ICON = {
  completed: CircleCheck,
  in_progress: CircleDot,
  available: Circle,
  locked: Lock,
  unwritten: Circle,
} as const;

function LessonRow({ lesson, titleById }: { lesson: LessonNode; titleById: Map<string, string> }) {
  const Icon = ICON[lesson.state];
  const interactive = lesson.state !== 'unwritten' && lesson.state !== 'locked';

  const body = (
    <div className="flex items-start gap-3 py-2">
      <Icon
        size={15}
        strokeWidth={1.75}
        className={cn(
          'mt-0.5 shrink-0',
          lesson.state === 'completed' && 'text-signal-500',
          lesson.state === 'in_progress' && 'text-signal-400',
          lesson.state === 'available' && 'text-[var(--text-dim)]',
          (lesson.state === 'locked' || lesson.state === 'unwritten') && 'text-[var(--text-faint)]',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-xs text-[var(--text-faint)]">
            {String(lesson.position).padStart(2, '0')}
          </span>
          <span
            className={cn(
              'text-sm',
              lesson.state === 'unwritten' ? 'text-[var(--text-faint)]' : 'font-medium',
            )}
          >
            {lesson.title}
          </span>
          <span className="font-mono text-xs text-[var(--text-faint)]">
            {lesson.estimatedMinutes}m
          </span>
          {lesson.state === 'unwritten' ? <Tag>not written</Tag> : null}
        </div>
        {lesson.blockedBy.length ? (
          <p className="mt-0.5 text-xs text-[var(--text-faint)]">
            Needs first: {lesson.blockedBy.map((b) => titleById.get(b) ?? b).join(', ')}
          </p>
        ) : null}
      </div>
    </div>
  );

  return interactive ? (
    <Link href={`/lesson/${lesson.slug}`} className="block rounded-[2px] px-2 hover:bg-[var(--surface)]">
      {body}
    </Link>
  ) : (
    <div className="px-2 opacity-70">{body}</div>
  );
}

export default async function CurriculumPage() {
  const d = await loadDashboard();
  const titleById = new Map(d.lessons.map((l) => [l.slug, l.title]));

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 lg:px-10">
      <header className="border-b border-[var(--rule)] pb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Curriculum</h1>
        <p className="mt-2 max-w-[64ch] text-sm text-[var(--text-dim)]">
          {d.counts.planned} lessons across five phases, ordered so nothing arrives before the thing
          it depends on. Lessons unlock when their prerequisites are complete — switch that off in
          settings if you would rather jump around.
        </p>
      </header>

      <div className="mt-8 space-y-12">
        {d.phases.map((phase) => {
          const inPhase = d.lessons.filter((l) => l.phase === phase.id);
          const done = inPhase.filter((l) => l.state === 'completed').length;

          return (
            <section key={phase.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-xl font-semibold tracking-tight">{phase.title}</h2>
                <span className="font-mono text-xs text-[var(--text-faint)]">
                  weeks {phase.weeks} · {done}/{inPhase.length}
                </span>
              </div>
              <p className="mt-2 max-w-[66ch] text-sm text-[var(--text-dim)]">{phase.summary}</p>
              <p className="mt-2 max-w-[66ch] border-l-2 border-signal-600 pl-3 text-sm text-[var(--text-dim)]">
                <span className="font-medium text-signal-400">After this phase: </span>
                {phase.outcome}
              </p>
              <Meter className="mt-4" value={done} max={inPhase.length} label={`${phase.title} progress`} />

              <div className="mt-6 space-y-6">
                {phase.modules.map((mod) => (
                  <div key={mod.id}>
                    <h3 className="text-sm font-semibold">{mod.title}</h3>
                    <p className="mt-0.5 max-w-[66ch] text-sm text-[var(--text-dim)]">{mod.summary}</p>
                    <div className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                      {mod.lessons.map((slug) => {
                        const lesson = d.lessons.find((l) => l.slug === slug);
                        return lesson ? (
                          <LessonRow key={slug} lesson={lesson} titleById={titleById} />
                        ) : null;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
