import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getLesson } from '@/lib/content/loader';
import { QuizRunner } from '@/components/quiz/QuizRunner';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lesson = await getLesson(slug);
  return { title: lesson ? `Quiz · ${lesson.title}` : 'Quiz' };
}

export default async function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lesson = await getLesson(slug);
  if (!lesson) notFound();

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 lg:px-10">
      <Link
        href={`/lesson/${slug}`}
        className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
      >
        <ArrowLeft size={14} /> {lesson.title}
      </Link>
      <QuizRunner lessonSlug={slug} lessonTitle={lesson.title} questions={lesson.quiz} />
    </div>
  );
}
