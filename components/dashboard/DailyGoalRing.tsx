import { Check } from 'lucide-react';

/**
 * The daily goal as a ring plus a finite rep tally. Minutes answer "have I put
 * the time in"; reps answer "did I do real, finishable work" — the concrete,
 * countable target that makes tonight feel worth starting.
 */
export function DailyGoalRing({
  minutes,
  goalMinutes,
  reps,
  repTarget,
}: {
  minutes: number;
  goalMinutes: number;
  reps: number;
  repTarget: number;
}) {
  const pct = goalMinutes > 0 ? Math.max(0, Math.min(1, minutes / goalMinutes)) : 0;
  const met = minutes >= goalMinutes && goalMinutes > 0;
  const r = 26;
  const c = 2 * Math.PI * r;

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--rule)" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={met ? 'var(--color-signal-500)' : 'var(--color-signal-400)'}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {met ? (
            <Check size={20} className="text-signal-400" />
          ) : (
            <span className="font-mono text-sm tabular-nums">{minutes}</span>
          )}
        </div>
      </div>
      <div>
        <div className="text-xs text-[var(--text-dim)]">
          {met ? 'daily goal met' : `${minutes}/${goalMinutes} min today`}
        </div>
        <div className="mt-1.5 flex items-center gap-1" aria-label={`${reps} of ${repTarget} reps done`}>
          {Array.from({ length: repTarget }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 w-4 rounded-full ${i < reps ? 'bg-signal-500' : 'bg-[var(--rule)]'}`}
              aria-hidden
            />
          ))}
          <span className="ml-1.5 font-mono text-xs text-[var(--text-faint)]">
            {reps}/{repTarget} reps
          </span>
        </div>
      </div>
    </div>
  );
}
