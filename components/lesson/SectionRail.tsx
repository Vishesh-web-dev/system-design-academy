'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Meter } from '../ui/primitives';
import { recordSectionSeen, recordTimeSpent } from '@/app/lesson/actions';

/**
 * The margin rail: where you are in the lesson, what you have opened, and how
 * long you have spent.
 *
 * "Seen" is recorded when a section has been in view for two seconds — long
 * enough that scrolling past does not count, short enough that reading does.
 * Time is flushed on a slow heartbeat and again on unload, and the server caps
 * any single flush, so a tab left open overnight cannot claim eight hours of
 * study (db/repo/progress.ts → addTimeSpent).
 */
export function SectionRail({
  lessonId,
  sections,
  initiallySeen,
  quizPassed,
}: {
  lessonId: string;
  sections: Array<{ id: string; label: string }>;
  initiallySeen: string[];
  quizPassed: boolean;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const [seen, setSeen] = useState<Set<string>>(new Set(initiallySeen));
  const seenRef = useRef(seen);
  seenRef.current = seen;

  // Scroll-spy plus dwell-based "seen" marking.
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-section');
          if (!id) continue;

          if (entry.isIntersecting) {
            setActive(id);
            if (!seenRef.current.has(id) && !timers.has(id)) {
              timers.set(
                id,
                setTimeout(() => {
                  timers.delete(id);
                  setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
                  void recordSectionSeen(lessonId, id);
                }, 2000),
              );
            }
          } else {
            const t = timers.get(id);
            if (t) {
              clearTimeout(t);
              timers.delete(id);
            }
          }
        }
      },
      { rootMargin: '-25% 0px -55% 0px', threshold: 0 },
    );

    for (const s of sections) {
      const el = document.querySelector(`[data-section="${s.id}"]`);
      if (el) observer.observe(el);
    }

    return () => {
      observer.disconnect();
      for (const t of timers.values()) clearTimeout(t);
    };
  }, [lessonId, sections]);

  // Time on task, only while the tab is visible.
  useEffect(() => {
    let accrued = 0;
    let last = Date.now();

    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible') accrued += (now - last) / 1000;
      last = now;
      if (accrued >= 60) {
        const seconds = Math.round(accrued);
        accrued = 0;
        void recordTimeSpent(lessonId, seconds);
      }
    };

    const interval = setInterval(tick, 15_000);
    const flush = () => {
      tick();
      if (accrued >= 5) {
        void recordTimeSpent(lessonId, Math.round(accrued));
        accrued = 0;
      }
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [lessonId]);

  const done = sections.filter((s) => seen.has(s.id)).length;

  // Progress toward the real completion gate (all sections opened + quiz ≥ 70%),
  // so the bar is a true finish line, not just how far you scrolled.
  const steps = sections.length + 1;
  const doneSteps = done + (quizPassed ? 1 : 0);
  const ready = doneSteps >= steps;

  return (
    <nav aria-label="Lesson sections" className="text-sm">
      <div className="mb-3">
        <p className="mb-2 font-mono text-xs text-[var(--text-faint)]">
          {done}/{sections.length} sections opened
        </p>
        <Meter value={doneSteps} max={steps} tone={ready ? 'brass' : 'signal'} label="Lesson completion" />
        <p className="mt-1.5 text-xs text-[var(--text-faint)]">
          {ready
            ? 'Finish line reached — mark it complete.'
            : quizPassed
              ? 'Quiz passed. Open the remaining sections.'
              : 'Open every section and pass the quiz.'}
        </p>
      </div>
      <ol className="space-y-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? 'true' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-[2px] py-1 pl-2.5 pr-2 text-[0.8125rem] transition-colors',
                active === s.id
                  ? 'bg-[var(--surface-raised)] text-[var(--text)]'
                  : 'text-[var(--text-dim)] hover:text-[var(--text)]',
              )}
            >
              <span
                className={cn(
                  'h-1 w-1 shrink-0 rounded-full',
                  seen.has(s.id) ? 'bg-signal-500' : 'bg-[var(--rule-strong)]',
                )}
                aria-hidden
              />
              {s.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
