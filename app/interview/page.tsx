import Link from 'next/link';
import { ensureLearner } from '@/db/repo/learner';
import { listInterviews } from '@/db/repo/interview';
import { PROBLEMS, COMPANY_STYLES } from '@/lib/ai/problems';
import { providerStatus } from '@/lib/ai/provider';
import { startInterview } from './actions';
import { Sheet, Tag } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Interview · System Design Academy' };

const MODE_LABEL = {
  hld: 'High level design',
  lld: 'Low level design',
  backend: 'Backend',
  distributed: 'Distributed systems',
  ai: 'AI systems',
  boss: 'Boss Mode',
} as const;

const MODE_BLURB = {
  hld: 'Derive an architecture under time pressure and defend it.',
  lld: 'Requirements to classes, with the hard part actually written.',
  backend: 'Schema, indexes, transactions, caching and failure handling.',
  distributed: 'Partitioning, replication, consistency and overload behaviour.',
  ai: 'Retrieval, agent loops, durability, evaluation and security.',
  boss: 'A system that appears nowhere in the curriculum. Tests transfer, not recall.',
} as const;

export default async function InterviewHub() {
  await ensureLearner();
  const [history, ai] = [await listInterviews(10), providerStatus()];

  const modes = ['hld', 'lld', 'backend', 'distributed', 'ai', 'boss'] as const;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 lg:px-10">
      <header className="border-b border-[var(--rule)] pb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Interview</h1>
        <p className="mt-2 max-w-[66ch] text-sm text-[var(--text-dim)]">
          A timed interview with follow-ups. The interviewer will not show you the answer, and hints
          are counted against you — that is the point. You get a scorecard with evidence at the end,
          and the topics it flags go into your review queue.
        </p>
        <p className="mt-3 font-mono text-xs text-[var(--text-faint)]">
          {ai.live
            ? `Live interviewer · ${ai.provider} · ${ai.model}`
            : 'Scripted interviewer — set AI_PROVIDER and AI_API_KEY for a model that reads your answers'}
        </p>
      </header>

      <form action={startInterview} className="mt-8 space-y-8">
        {modes.map((mode) => {
          const problems = PROBLEMS.filter((p) => p.mode === mode);
          if (!problems.length) return null;
          return (
            <section key={mode}>
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-semibold tracking-tight">{MODE_LABEL[mode]}</h2>
                {mode === 'boss' ? <Tag tone="brass">final boss</Tag> : null}
              </div>
              <p className="mt-1 max-w-[66ch] text-sm text-[var(--text-dim)]">{MODE_BLURB[mode]}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {problems.map((p) => (
                  <label
                    key={p.key}
                    className="flex cursor-pointer items-start gap-3 rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--rule-strong)] has-[:checked]:border-signal-600"
                  >
                    <input
                      type="radio"
                      name="problemKey"
                      value={p.key}
                      className="mt-1 accent-[var(--color-signal-500)]"
                      required
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{p.title}</span>
                      <span className="mt-0.5 block font-mono text-xs text-[var(--text-faint)]">
                        {p.minutes} min
                      </span>
                      {p.transferNote ? (
                        <span className="mt-1 block text-xs text-[var(--text-dim)]">
                          {p.transferNote}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          );
        })}

        <Sheet>
          <h2 className="text-sm font-semibold">Interviewer emphasis</h2>
          <p className="mt-1 max-w-[66ch] text-sm text-[var(--text-dim)]">
            These change what the interviewer pushes hardest on. They are emphasis profiles drawn
            from public engineering writing — not claims about any company&apos;s actual interview
            process.
          </p>
          <div className="mt-3 space-y-2">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input type="radio" name="companyStyle" value="none" defaultChecked className="mt-1 accent-[var(--color-signal-500)]" />
              <span>Balanced — cover every criterion evenly.</span>
            </label>
            {COMPANY_STYLES.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="radio" name="companyStyle" value={s.key} className="mt-1 accent-[var(--color-signal-500)]" />
                <span>
                  <span className="font-medium">{s.label}</span>
                  <span className="text-[var(--text-dim)]"> — {s.emphasis}</span>
                </span>
              </label>
            ))}
          </div>
          <button
            type="submit"
            className="mt-5 rounded-[3px] bg-signal-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-signal-400"
          >
            Start interview
          </button>
        </Sheet>
      </form>

      {history.length ? (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Past interviews</h2>
          <ul className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/interview/${h.id}`} className="flex flex-wrap items-center gap-3 px-2 py-3 hover:bg-[var(--surface)]">
                  <span className="font-mono text-xs text-[var(--text-faint)]">
                    {h.startedAt.toLocaleDateString()}
                  </span>
                  <span className="text-sm font-medium">
                    {PROBLEMS.find((p) => p.key === h.problemKey)?.title ?? h.problemKey}
                  </span>
                  <Tag tone={h.status === 'complete' ? 'signal' : 'neutral'}>{h.status}</Tag>
                  <span className="ml-auto font-mono text-xs text-[var(--text-faint)]">
                    {Math.round(h.durationSeconds / 60)} min · {h.hintsUsed} hint
                    {h.hintsUsed === 1 ? '' : 's'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
