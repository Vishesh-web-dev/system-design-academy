'use client';

import Link from 'next/link';
import { Check, Pause, Play, Target, X } from 'lucide-react';
import { useFocus } from './FocusProvider';

/**
 * The floating focus pill. Visible across navigation whenever a rep is running,
 * so the countdown and the one chosen action follow the learner to the page
 * where the work happens. Finishing the action (which mints XP) flips it to
 * "rep done".
 */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function FocusTimer() {
  const { session, remaining, timeUp, togglePause, stop } = useFocus();
  if (!session) return null;

  const done = session.productive;

  return (
    <div className="fixed bottom-4 left-4 z-[55] w-[min(17rem,calc(100vw-2rem))]">
      <div
        className="rounded-[5px] border border-[var(--rule-strong)] bg-[var(--surface-raised)] p-3 shadow-lg shadow-black/25"
        data-testid="focus-timer"
      >
        <div className="flex items-center gap-2">
          <span
            className={done ? 'text-signal-400' : timeUp ? 'text-brass-400' : 'text-[var(--text-dim)]'}
            aria-hidden
          >
            {done ? <Check size={15} /> : <Target size={15} />}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            {done ? 'Rep done' : timeUp ? "Time's up" : 'Focus rep'}
          </span>
          <span
            className={`ml-auto font-mono text-sm tabular-nums ${timeUp && !done ? 'text-brass-400' : 'text-[var(--text)]'}`}
          >
            {clock(remaining)}
          </span>
        </div>

        <Link
          href={session.target.href}
          className="mt-2 block truncate text-sm font-medium hover:underline"
          title={session.target.title}
        >
          {session.target.title}
        </Link>

        <p className="mt-1 text-xs text-[var(--text-faint)]">
          {done
            ? 'Nice — one concrete thing, finished. Stop here or line up another.'
            : timeUp
              ? 'The box is up. Wrap the thought and log the rep.'
              : 'One thing. Finish it before the clock.'}
        </p>

        <div className="mt-2.5 flex items-center gap-1.5">
          {!done ? (
            <button
              type="button"
              onClick={togglePause}
              className="inline-flex h-7 items-center gap-1.5 rounded-[3px] border border-[var(--rule-strong)] px-2 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              {session.paused ? <Play size={12} /> : <Pause size={12} />}
              {session.paused ? 'Resume' : 'Pause'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={stop}
            className="inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2 text-xs text-[var(--text-faint)] hover:text-[var(--text)]"
            data-testid="focus-stop"
          >
            <X size={12} /> {done ? 'Done' : 'End rep'}
          </button>
        </div>
      </div>
    </div>
  );
}
