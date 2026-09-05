import { cn } from '@/lib/utils';

/**
 * The whole primitive set. Deliberately small: this product needs surfaces,
 * rules and one button, not a component library. Anything genuinely
 * interactive lives in its own client component.
 */

export function Sheet({
  className,
  as: Tag = 'section',
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'aside' }) {
  return (
    <Tag
      className={cn(
        'rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-5',
        className,
      )}
      {...props}
    />
  );
}

const buttonVariants = {
  primary:
    'bg-signal-500 text-ink-950 hover:bg-signal-400 font-medium disabled:bg-[var(--rule-strong)] disabled:text-[var(--text-faint)]',
  secondary:
    'border border-[var(--rule-strong)] text-[var(--text)] hover:bg-[var(--surface-raised)] disabled:text-[var(--text-faint)]',
  ghost: 'text-[var(--text-dim)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]',
  danger: 'border border-alert-600 text-alert-400 hover:bg-alert-600/15',
} as const;

const buttonSizes = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-5 text-sm',
} as const;

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}) {
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-[3px] transition-colors disabled:cursor-not-allowed',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Tag({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'signal' | 'alert' | 'brass';
}) {
  const tones = {
    neutral: 'border-[var(--rule-strong)] text-[var(--text-dim)]',
    signal: 'border-signal-600 text-signal-400',
    alert: 'border-alert-600 text-alert-400',
    brass: 'border-brass-500 text-brass-400',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-xs leading-none',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** A labelled figure. All numbers in this product are mono and tabular. */
export function Figure({
  value,
  label,
  tone = 'neutral',
  sub,
}: {
  value: string | number;
  label: string;
  tone?: 'neutral' | 'signal' | 'alert' | 'brass';
  sub?: string;
}) {
  const tones = {
    neutral: 'text-[var(--text)]',
    signal: 'text-signal-400',
    alert: 'text-alert-400',
    brass: 'text-brass-400',
  };
  return (
    <div>
      <div className={cn('font-mono text-2xl leading-none tabular-nums', tones[tone])}>{value}</div>
      <div className="mt-1.5 text-xs text-[var(--text-dim)]">{label}</div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--text-faint)]">{sub}</div> : null}
    </div>
  );
}

export function Meter({
  value,
  max = 1,
  tone = 'signal',
  className,
  label,
}: {
  value: number;
  max?: number;
  tone?: 'signal' | 'alert' | 'brass';
  className?: string;
  label?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const tones = { signal: 'bg-signal-500', alert: 'bg-alert-500', brass: 'bg-brass-500' };
  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-[var(--rule)]', className)}
      role="meter"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <div className={cn('h-full rounded-full transition-[width]', tones[tone])} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

/** Section heading used across app chrome (never inside lesson prose). */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold tracking-tight text-[var(--text)]">{children}</h2>;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-[3px] border border-dashed border-[var(--rule-strong)] px-5 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--text-dim)]">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
