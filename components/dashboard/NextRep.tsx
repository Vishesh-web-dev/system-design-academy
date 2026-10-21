import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import type { Recommendation } from '@/lib/learning/recommend';
import { Button } from '@/components/ui/primitives';
import { NextRepActions } from './NextRepActions';

/**
 * The "one rep" hero (docs/STATE.md → frozen decision 14).
 *
 * The whole page used to open with the full roadmap. This opens with a single,
 * concrete, finishable action — the near finish line that beats temporal
 * discounting. It is the top recommendation, promoted into a thing you start
 * right now, timed or not.
 */
export function NextRep({ rep, focusMinutes }: { rep: Recommendation | null; focusMinutes: number }) {
  if (!rep || rep.kind === 'rest') {
    return (
      <div className="rounded-[4px] border border-[var(--rule)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-signal-400">
          <Check size={16} /> You&apos;re caught up
        </div>
        <p className="mt-1.5 max-w-[60ch] text-sm text-[var(--text-dim)]">
          {rep?.reason ??
            'Nothing is due. Stopping here is the correct move — spacing is doing the work now.'}
        </p>
      </div>
    );
  }

  const minutes = rep.estimatedMinutes > 0 ? Math.min(rep.estimatedMinutes, focusMinutes) : focusMinutes;

  return (
    <div className="rounded-[4px] border border-signal-600/40 bg-signal-500/[0.04] p-5">
      <p className="font-mono text-xs uppercase tracking-wide text-signal-400">Your next rep</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{rep.title}</h2>
        {rep.estimatedMinutes > 0 ? (
          <span className="font-mono text-xs text-[var(--text-faint)]">~{rep.estimatedMinutes} min</span>
        ) : null}
      </div>
      <p className="mt-1.5 max-w-[68ch] text-sm text-[var(--text-dim)]">{rep.reason}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Link href={rep.href}>
          <Button variant="primary" size="lg">
            Start <ArrowRight size={15} />
          </Button>
        </Link>
        <NextRepActions title={rep.title} href={rep.href} minutes={minutes} />
        <span className="text-xs text-[var(--text-faint)]">One thing, one finish line.</span>
      </div>
    </div>
  );
}
