'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HelpCircle, Send } from 'lucide-react';
import { Button, Meter, Tag } from '../ui/primitives';
import { PHASES, PHASE_LABEL, formatClock, type Phase } from '@/lib/ai/session';
import { finishInterview, submitAnswer } from '@/app/interview/actions';
import { cn } from '@/lib/utils';

export interface TurnView {
  id: string;
  role: 'interviewer' | 'candidate' | 'system';
  content: string;
  hint: boolean;
}

/**
 * The interview surface. Two rules shape it:
 *
 * 1. The clock is always visible and always running, because managing 45
 *    minutes is part of what is being practised.
 * 2. The hint button is a separate, deliberate action with a visible counter.
 *    A hint you did not notice taking is a hint that teaches you nothing.
 */
export function InterviewSession({
  interviewId,
  turns,
  startedAtIso,
  timeBudgetSeconds,
  phase,
  hintsUsed,
  status,
  live,
}: {
  interviewId: string;
  turns: TurnView[];
  startedAtIso: string;
  timeBudgetSeconds: number;
  phase: Phase;
  hintsUsed: number;
  status: string;
  live: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const started = new Date(startedAtIso).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAtIso]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  const remaining = Math.max(0, timeBudgetSeconds - elapsed);
  const overtime = remaining === 0;
  const active = status === 'active';

  function send(hintRequested: boolean) {
    const content = hintRequested ? draft.trim() || 'Can I get a hint?' : draft.trim();
    if (!content) return;
    startTransition(async () => {
      const result = await submitAnswer({ interviewId, content, hintRequested });
      if (result.ok) {
        setDraft('');
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--rule)] bg-[var(--ground)] px-1 py-3">
        <span
          className={cn(
            'font-mono text-lg tabular-nums',
            overtime ? 'text-alert-400' : remaining < 300 ? 'text-brass-400' : 'text-[var(--text)]',
          )}
          data-testid="interview-clock"
        >
          {formatClock(remaining)}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {PHASES.map((p) => (
            <span
              key={p}
              className={cn(
                'rounded-[2px] border px-1.5 py-0.5 text-[0.6875rem] leading-none',
                p === phase
                  ? 'border-signal-500 text-signal-400'
                  : PHASES.indexOf(p) < PHASES.indexOf(phase)
                    ? 'border-[var(--rule-strong)] text-[var(--text-faint)]'
                    : 'border-[var(--rule)] text-[var(--text-faint)] opacity-50',
              )}
            >
              {PHASE_LABEL[p]}
            </span>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs text-[var(--text-faint)]">
          {hintsUsed} hint{hintsUsed === 1 ? '' : 's'}
        </span>
      </div>

      <Meter value={Math.min(elapsed, timeBudgetSeconds)} max={timeBudgetSeconds} tone={overtime ? 'alert' : 'signal'} label="Time used" />

      {!live ? (
        <p className="rounded-[3px] border border-brass-500/40 bg-[var(--surface)] p-3 text-xs text-[var(--text-dim)]">
          Scripted interviewer: it walks the same stages and gates hints the same way, but it cannot
          react to what you write. Set <code className="font-mono">AI_PROVIDER</code> and{' '}
          <code className="font-mono">AI_API_KEY</code> for an interviewer that reads your answers.
        </p>
      ) : null}

      <div className="space-y-5" data-testid="transcript">
        {turns.map((t) => (
          <div
            key={t.id}
            className={cn(
              'max-w-[70ch]',
              t.role === 'candidate' ? 'ml-auto border-r-2 border-[var(--rule-strong)] pr-4 text-right' : 'border-l-2 border-signal-600 pl-4',
            )}
          >
            <p className="mb-1 font-mono text-[0.6875rem] uppercase tracking-wide text-[var(--text-faint)]">
              {t.role === 'candidate' ? 'you' : 'interviewer'}
              {t.hint ? ' · hint' : ''}
            </p>
            <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{t.content}</p>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {active ? (
        <div className="border-t border-[var(--rule)] pt-4">
          <label htmlFor="answer" className="sr-only">
            Your answer
          </label>
          <textarea
            id="answer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder="Think out loud. Numbers, assumptions, and the reason for every component."
            className="w-full resize-y rounded-[3px] border border-[var(--rule-strong)] bg-[var(--ground)] p-3 text-sm leading-relaxed outline-none placeholder:text-[var(--text-faint)] focus-visible:border-signal-600"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(false);
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => send(false)} disabled={pending || !draft.trim()} data-testid="send-answer">
              <Send size={14} /> {pending ? 'Thinking…' : 'Send'}
            </Button>
            <Button variant="ghost" onClick={() => send(true)} disabled={pending} title="Counted against you in the scorecard">
              <HelpCircle size={14} /> Ask for a hint
            </Button>
            <span className="text-xs text-[var(--text-faint)]">⌘/Ctrl + Enter to send</span>
            <form
              className="ml-auto"
              action={async () => {
                await finishInterview(interviewId);
              }}
            >
              <Button type="submit" variant="secondary" data-testid="end-interview">
                End and get scorecard
              </Button>
            </form>
          </div>
          {error ? <p className="mt-2 text-xs text-alert-400">{error}</p> : null}
          {overtime ? (
            <p className="mt-2 text-xs text-alert-400">
              Over time. In a real interview this is where you would be cut off — wrap up and end it.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="border-t border-[var(--rule)] pt-4">
          <Tag tone="neutral">{status}</Tag>
        </div>
      )}
    </div>
  );
}
