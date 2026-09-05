import Link from 'next/link';
import { CircleCheck, CircleDashed } from 'lucide-react';
import type { Lesson } from '@/content/schema';
import type { Resource } from '@/content/schema';
import { Markdown } from './Markdown';
import { RevealBlock } from './RevealBlock';
import { MermaidBlock } from '../viz/MermaidBlock';
import { FlowDiagramLazy } from '../viz/FlowDiagramLazy';
import { ExercisePanel } from './ExercisePanel';
import { Button, Sheet, Tag } from '../ui/primitives';
import { sectionsFor } from '@/lib/content/sections';

const TIER_LABEL = { must: '⭐ Must read', good: '📚 Good to read', advanced: '🧠 Advanced' } as const;

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-section={id} className="scroll-mt-20 border-t border-[var(--rule)] pt-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm text-[var(--text-dim)]">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function LessonPlayer({
  lesson,
  resources,
  quizSummary,
  exerciseAttempts,
}: {
  lesson: Lesson;
  resources: Array<{ resource: Resource; tier: 'must' | 'good' | 'advanced'; note: string }>;
  quizSummary: { attempts: number; best: number | null; total: number };
  exerciseAttempts: Map<string, { response: string; selfRating: number | null; rubricHits: string[] }>;
}) {
  const sections = sectionsFor(lesson);
  const has = (id: string) => sections.some((s) => s.id === id);

  return (
    <div className="space-y-8">
      {/* 1 — Intuition */}
      <section id="intuition" data-section="intuition" className="scroll-mt-20">
        <h2 className="text-lg font-semibold tracking-tight">Intuition</h2>
        <div className="mt-4">
          <Markdown>{lesson.intuition.body}</Markdown>
          <p className="mt-5 max-w-[66ch] border-l-2 border-brass-500 py-1 pl-4 text-sm text-[var(--text-dim)]">
            <span className="font-medium text-brass-400">Where the analogy breaks: </span>
            {lesson.intuition.analogyLimit}
          </p>
        </div>
      </section>

      {/* 2 — Deep explanation */}
      <Section id="deep" title="Deep explanation">
        {lesson.deepExplanation.predict ? (
          <div className="mb-7 rounded-[3px] border border-signal-600/50 bg-[var(--surface)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-signal-400">
              Answer this first
            </p>
            <p className="mt-2 max-w-[66ch] text-sm">{lesson.deepExplanation.predict.question}</p>
            <RevealBlock
              label="I have an answer — show me"
              hint="Commit to a number before you look. Recognising the right answer is not the same as producing it."
            >
              <Markdown className="text-sm">{lesson.deepExplanation.predict.answer}</Markdown>
            </RevealBlock>
          </div>
        ) : null}
        <Markdown>{lesson.deepExplanation.body}</Markdown>
      </Section>

      {/* 3 — Visuals */}
      <Section id="visual" title="Visuals">
        {lesson.visuals.map((v) =>
          v.kind === 'flow' ? (
            <FlowDiagramLazy key={v.id} spec={v} />
          ) : (
            <figure key={v.id} className="my-7">
              <figcaption className="mb-2">
                <span className="text-sm font-semibold">{v.title}</span>
                <p className="mt-1 max-w-[70ch] text-sm text-[var(--text-dim)]">{v.caption}</p>
              </figcaption>
              <MermaidBlock code={v.code} />
            </figure>
          ),
        )}
      </Section>

      {/* 4 — Production example */}
      <Section id="production" title="In production">
        {lesson.productionExample.systems.length ? (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {lesson.productionExample.systems.map((s) => (
              <Tag key={s} tone="brass">
                {s}
              </Tag>
            ))}
          </div>
        ) : null}
        <Markdown>{lesson.productionExample.body}</Markdown>
      </Section>

      {/* 5 — Trade-offs */}
      <Section
        id="tradeoffs"
        title="Trade-offs"
        subtitle="Including the simplest option, which is often the correct one."
      >
        {lesson.tradeoffs.intro ? <Markdown className="mb-4">{lesson.tradeoffs.intro}</Markdown> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--rule-strong)] text-left text-xs text-[var(--text-dim)]">
                <th className="py-2 pr-4 font-medium">Option</th>
                <th className="py-2 pr-4 font-medium">Wins when</th>
                <th className="py-2 pr-4 font-medium">Loses when</th>
                <th className="py-2 font-medium">Costs</th>
              </tr>
            </thead>
            <tbody>
              {lesson.tradeoffs.rows.map((r) => (
                <tr key={r.option} className="border-b border-[var(--rule)] align-top">
                  <td className="py-3 pr-4 font-medium">{r.option}</td>
                  <td className="py-3 pr-4 text-[var(--text-dim)]">{r.whenItWins}</td>
                  <td className="py-3 pr-4 text-[var(--text-dim)]">{r.whenItLoses}</td>
                  <td className="py-3 text-[var(--text-dim)]">{r.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 6 — Common mistakes */}
      <Section
        id="mistakes"
        title="Common interview mistakes"
        subtitle="Each one is a real answer that sounds fine and does not survive a follow-up."
      >
        <div className="space-y-6">
          {lesson.commonMistakes.map((m, i) => (
            <div key={i} className="border-l-2 border-alert-600 pl-4">
              <p className="max-w-[66ch] font-serif text-[1.0625rem] italic text-[var(--text-dim)]">
                {m.weakAnswer}
              </p>
              <p className="mt-2 max-w-[66ch] text-sm">
                <span className="font-medium text-alert-400">Why it fails: </span>
                {m.whyWeak}
              </p>
              <p className="mt-2 max-w-[66ch] text-sm">
                <span className="font-medium text-signal-400">Stronger: </span>
                {m.strongAnswer}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* 7 — Active practice */}
      {has('practice') ? (
        <Section
          id="practice"
          title="Practice"
          subtitle="Work these before revealing the discussion. Producing the answer is the point."
        >
          <div className="space-y-6">
            {lesson.activeLearning.map((a) => (
              <div key={a.id} className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-4">
                <Tag tone="signal">{a.kind.replace(/-/g, ' ')}</Tag>
                <p className="mt-3 max-w-[66ch] text-sm">{a.prompt}</p>
                <RevealBlock label="Show the discussion">
                  <Markdown className="text-sm">{a.discussion}</Markdown>
                </RevealBlock>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* 8 — Exercise */}
      <Section id="exercise" title="Exercise">
        <div className="space-y-6">
          {lesson.exercises.map((e) => (
            <ExercisePanel
              key={e.id}
              exercise={e}
              previous={exerciseAttempts.get(e.id) ?? null}
            />
          ))}
        </div>
      </Section>

      {/* 9 — Quiz */}
      <Section
        id="quiz"
        title="Quiz"
        subtitle="Half of these are scenario questions. Getting one wrong queues the topic for review."
      >
        <Sheet className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm">
              {quizSummary.total} question{quizSummary.total === 1 ? '' : 's'}
              {quizSummary.attempts > 0 ? (
                <span className="text-[var(--text-dim)]">
                  {' · '}
                  {quizSummary.attempts} attempt{quizSummary.attempts === 1 ? '' : 's'}, best{' '}
                  <span className="font-mono">{Math.round((quizSummary.best ?? 0) * 100)}%</span>
                </span>
              ) : (
                <span className="text-[var(--text-dim)]"> · not attempted</span>
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--text-faint)]">
              A lesson counts as complete at 70% or better.
            </p>
          </div>
          <Link href={`/lesson/${lesson.slug}/quiz`}>
            <Button variant="primary">
              {quizSummary.attempts > 0 ? 'Retake quiz' : 'Start quiz'}
            </Button>
          </Link>
        </Sheet>
      </Section>

      {/* 10 — Flashcards */}
      <Section
        id="flashcards"
        title="Flashcards"
        subtitle="These enter the spaced-repetition queue once the lesson is complete."
      >
        <ul className="space-y-2">
          {lesson.flashcards.map((f) => (
            <li key={f.id} className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-3">
              <p className="text-sm font-medium">{f.front}</p>
              <RevealBlock label="Show">
                <p className="max-w-[66ch] text-sm text-[var(--text-dim)]">{f.back}</p>
              </RevealBlock>
            </li>
          ))}
        </ul>
      </Section>

      {/* 11 — Interview questions */}
      <Section
        id="interview"
        title="Interview questions"
        subtitle="Answer out loud before reading what a strong answer contains."
      >
        <div className="space-y-5">
          {(['basic', 'intermediate', 'advanced', 'followup'] as const).map((level) => {
            const qs = lesson.interviewQuestions.filter((q) => q.level === level);
            if (!qs.length) return null;
            return (
              <div key={level}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                  {level === 'followup' ? 'Follow-ups' : level}
                </h3>
                <div className="space-y-3">
                  {qs.map((q) => (
                    <div key={q.id} className="border-l border-[var(--rule-strong)] pl-4">
                      <p className="max-w-[66ch] text-sm font-medium">{q.question}</p>
                      <RevealBlock label="What a strong answer contains">
                        <p className="max-w-[66ch] text-sm text-[var(--text-dim)]">{q.guidance}</p>
                      </RevealBlock>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 12 — Revision */}
      <Section id="revision" title="Five-minute revision">
        <ul className="max-w-[70ch] space-y-2">
          {lesson.revision.bullets.map((b, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="mt-2 h-px w-3 shrink-0 bg-signal-600" aria-hidden />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* 13 — Cheat sheet */}
      <Section id="cheatsheet" title="Interview cheat sheet">
        <div className="grid gap-px overflow-hidden rounded-[3px] border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2">
          <CheatCell title="What it is" body={lesson.cheatSheet.whatItIs} />
          <CheatCell title="Why it exists" body={lesson.cheatSheet.whyItExists} />
          <CheatList title="When to use" items={lesson.cheatSheet.whenToUse} tone="signal" />
          <CheatList title="When not to use" items={lesson.cheatSheet.whenNotToUse} tone="alert" />
          <CheatList title="Alternatives" items={lesson.cheatSheet.alternatives} />
          <CheatList title="Trade-offs" items={lesson.cheatSheet.tradeoffs} />
          <CheatList title="Failure modes" items={lesson.cheatSheet.failureModes} tone="alert" />
          <CheatList title="Expect these follow-ups" items={lesson.cheatSheet.followUpQuestions} tone="brass" />
        </div>
      </Section>

      {/* References */}
      {resources.length ? (
        <section id="references" className="scroll-mt-20 border-t border-[var(--rule)] pt-8">
          <h2 className="text-lg font-semibold tracking-tight">References</h2>
          <p className="mt-1 text-sm text-[var(--text-dim)]">
            Every link below was fetched and its title confirmed. Read the starred ones; the rest are
            there when you want depth, not homework.
          </p>
          <div className="mt-4 space-y-5">
            {(['must', 'good', 'advanced'] as const).map((tier) => {
              const items = resources.filter((r) => r.tier === tier);
              if (!items.length) return null;
              return (
                <div key={tier}>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--text-faint)]">
                    {TIER_LABEL[tier]}
                  </h3>
                  <ul className="space-y-3">
                    {items.map(({ resource, note }) => (
                      <li key={resource.key}>
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-sm font-medium text-signal-400 underline underline-offset-2"
                        >
                          {resource.title}
                        </a>
                        <span className="text-xs text-[var(--text-faint)]">
                          {' — '}
                          {resource.publisher}
                          {resource.section ? ` · ${resource.section}` : ''}
                        </span>
                        <p className="mt-0.5 max-w-[66ch] text-sm text-[var(--text-dim)]">{note}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CheatCell({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-[var(--surface)] p-4">
      <p className="text-xs font-semibold text-[var(--text-faint)]">{title}</p>
      <p className="mt-1.5 text-sm">{body}</p>
    </div>
  );
}

function CheatList({
  title,
  items,
  tone = 'neutral',
}: {
  title: string;
  items: string[];
  tone?: 'neutral' | 'signal' | 'alert' | 'brass';
}) {
  const marks = {
    neutral: 'bg-[var(--rule-strong)]',
    signal: 'bg-signal-600',
    alert: 'bg-alert-600',
    brass: 'bg-brass-500',
  };
  return (
    <div className="bg-[var(--surface)] p-4">
      <p className="text-xs font-semibold text-[var(--text-faint)]">{title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((i, idx) => (
          <li key={idx} className="flex gap-2.5 text-sm">
            <span className={`mt-2 h-px w-2.5 shrink-0 ${marks[tone]}`} aria-hidden />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CompletionChecklist({
  missing,
  complete,
}: {
  missing: string[];
  complete: boolean;
}) {
  if (complete) {
    return (
      <p className="flex items-center gap-2 text-sm text-signal-400">
        <CircleCheck size={15} strokeWidth={1.75} /> Complete
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-sm text-[var(--text-dim)]">
      {missing.map((m) => (
        <li key={m} className="flex items-center gap-2">
          <CircleDashed size={14} strokeWidth={1.75} className="shrink-0 text-[var(--text-faint)]" />
          {m}
        </li>
      ))}
    </ul>
  );
}
