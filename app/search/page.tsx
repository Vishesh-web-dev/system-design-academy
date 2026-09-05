import Link from 'next/link';
import { search } from '@/lib/content/search';
import { EmptyState, Tag } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search · System Design Academy' };

const KIND_LABEL = {
  lesson: 'lesson',
  cheatsheet: 'cheat sheet',
  flashcard: 'card',
  'interview-question': 'interview question',
} as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const hits = q.trim() ? await search(q, 30) : [];

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 lg:px-10">
      <header className="border-b border-[var(--rule)] pb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
        <p className="mt-2 max-w-[64ch] text-sm text-[var(--text-dim)]">
          Across lessons, cheat sheets, flashcards and interview questions. Useful when you half
          remember a concept and need the lesson that owns it.
        </p>
        <form action="/search" className="mt-5 flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="quorum, cache invalidation, idempotency key…"
            aria-label="Search the curriculum"
            className="w-full rounded-[3px] border border-[var(--rule-strong)] bg-[var(--ground)] px-3 py-2 text-sm outline-none placeholder:text-[var(--text-faint)] focus-visible:border-signal-600"
          />
          <button
            type="submit"
            className="shrink-0 rounded-[3px] bg-signal-500 px-4 text-sm font-medium text-ink-950 hover:bg-signal-400"
          >
            Search
          </button>
        </form>
      </header>

      <div className="mt-8">
        {!q.trim() ? (
          <EmptyState title="Type a query" body="Concepts, failure modes, component names — anything you would say out loud in an interview." />
        ) : hits.length === 0 ? (
          <EmptyState
            title={`Nothing matches “${q}”`}
            body="Either the topic is not in the V1 curriculum, or the lesson that covers it has not been written yet. The curriculum page lists everything that is planned."
          />
        ) : (
          <>
            <p className="mb-4 font-mono text-xs text-[var(--text-faint)]">
              {hits.length} result{hits.length === 1 ? '' : 's'}
            </p>
            <ul className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
              {hits.map((h) => (
                <li key={h.id}>
                  <Link href={`/lesson/${h.lessonSlug}`} className="block px-2 py-3.5 hover:bg-[var(--surface)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag tone={h.kind === 'lesson' ? 'signal' : 'neutral'}>{KIND_LABEL[h.kind]}</Tag>
                      <span className="text-xs text-[var(--text-faint)]">{h.lessonTitle}</span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium">{h.title}</p>
                    <p className="mt-0.5 line-clamp-2 max-w-[70ch] text-sm text-[var(--text-dim)]">
                      {h.body}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
