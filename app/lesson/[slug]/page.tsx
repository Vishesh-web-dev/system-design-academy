import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { getLesson, authoredSlugs } from '@/lib/content/loader';
import { resolveResources } from '@/lib/content/resources';
import { sectionsFor } from '@/lib/content/sections';
import { curriculum, lessonOrder } from '@/content/curriculum';
import { LessonPlayer } from '@/components/lesson/LessonPlayer';
import { SectionRail } from '@/components/lesson/SectionRail';
import { CompleteButton } from '@/components/lesson/CompleteButton';
import { Tag } from '@/components/ui/primitives';
import { ensureLearner } from '@/db/repo/learner';
import { getProgress } from '@/db/repo/progress';
import { bestQuizRatio, getAttempts } from '@/db/repo/quiz';
import { latestAttemptsForLesson } from '@/db/repo/exercises';
import { canCompleteLesson } from '@/lib/learning/mastery';

// Progress is read per request, so this page is rendered on demand rather than
// prerendered. Content is static; only the learner state is dynamic.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lesson = await getLesson(slug);
  return { title: lesson ? `${lesson.title} · System Design Academy` : 'Lesson not found' };
}

function neighbours(slug: string) {
  const authored = new Set(authoredSlugs());
  const i = lessonOrder.indexOf(slug);
  const back = lessonOrder.slice(0, i).reverse().find((s) => authored.has(s));
  const next = lessonOrder.slice(i + 1).find((s) => authored.has(s));
  return { back, next };
}

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lesson = await getLesson(slug);
  if (!lesson) notFound();

  await ensureLearner();
  const [progress, ratio, attempts, exerciseAttempts] = await Promise.all([
    getProgress(slug),
    bestQuizRatio(slug),
    getAttempts(slug),
    latestAttemptsForLesson(slug),
  ]);

  const sections = sectionsFor(lesson);
  const check = canCompleteLesson({
    sectionsSeen: progress?.sectionsSeen ?? [],
    requiredSections: sections.map((s) => s.id),
    bestQuizRatio: ratio,
  });

  const phase = curriculum.phases.find((p) => p.id === lesson.phase);
  const moduleTitle = phase?.modules.find((m) => m.id === lesson.module)?.title;
  const { back, next } = neighbours(slug);

  const resources = lesson.resources.flatMap((r) => {
    const [resource] = resolveResources([r.key]);
    return resource ? [{ resource, tier: r.tier, note: r.note }] : [];
  });

  return (
    <div className="mx-auto flex max-w-[92rem] gap-10 px-5 py-8 lg:px-10">
      <article className="min-w-0 flex-1 pb-24">
        <header className="border-b border-[var(--rule)] pb-7">
          <p className="font-mono text-xs text-[var(--text-faint)]">
            {phase?.title} · {moduleTitle} · lesson {lesson.position} of {lessonOrder.length}
          </p>
          <h1 className="mt-3 max-w-[22ch] text-3xl font-semibold leading-[1.12] tracking-tight">
            {lesson.title}
          </h1>
          <p className="mt-3 max-w-[62ch] font-serif text-[1.0625rem] leading-relaxed text-[var(--text-dim)]">
            {lesson.summary}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Tag>{lesson.kind.replace('-', ' ')}</Tag>
            <Tag tone={lesson.difficulty === 'advanced' ? 'alert' : 'neutral'}>
              {lesson.difficulty}
            </Tag>
            <span className="font-mono text-xs text-[var(--text-faint)]">
              ~{lesson.estimatedMinutes} min
            </span>
            {lesson.tags.map((t) => (
              <Tag key={t} tone="neutral">
                {t.replace(/-/g, ' ')}
              </Tag>
            ))}
          </div>
        </header>

        <div className="mt-8">
          <LessonPlayer
            lesson={lesson}
            resources={resources}
            quizSummary={{ attempts: attempts.length, best: ratio, total: lesson.quiz.length }}
            exerciseAttempts={
              new Map(
                [...exerciseAttempts].map(([id, a]) => [
                  id,
                  { response: a.response, selfRating: a.selfRating, rubricHits: a.rubricHits },
                ]),
              )
            }
          />
        </div>

        <footer className="mt-12 border-t border-[var(--rule)] pt-6">
          <CompleteButton
            lessonId={slug}
            complete={progress?.status === 'completed'}
            blockers={check.missing}
          />
          <nav className="mt-8 flex flex-wrap justify-between gap-4 text-sm">
            {back ? (
              <Link
                href={`/lesson/${back}`}
                className="flex items-center gap-2 text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                <ArrowLeft size={14} /> Previous lesson
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`/lesson/${next}`}
                className="flex items-center gap-2 text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                Next lesson <ArrowRight size={14} />
              </Link>
            ) : null}
          </nav>
        </footer>
      </article>

      <aside className="sticky top-8 hidden h-fit w-52 shrink-0 xl:block">
        <SectionRail
          lessonId={slug}
          sections={sections}
          initiallySeen={progress?.sectionsSeen ?? []}
        />
      </aside>
    </div>
  );
}
