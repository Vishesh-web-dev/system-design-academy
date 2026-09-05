import Link from 'next/link';
import { ensureLearner } from '@/db/repo/learner';
import { dueFlashcards, dueReviewItems } from '@/db/repo/review';
import { FlashcardReviewer, type ReviewCard } from '@/components/flashcards/FlashcardReviewer';
import { ReviewItemList } from '@/components/flashcards/ReviewItemList';
import { Button, EmptyState } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review · System Design Academy' };

export default async function ReviewPage() {
  await ensureLearner();
  const [rows, items] = await Promise.all([dueFlashcards(40), dueReviewItems()]);

  const cards: ReviewCard[] = rows.map((r) => ({
    id: r.card.id,
    front: r.card.front,
    back: r.card.back,
    topic: r.card.topic,
    lessonTitle: r.lessonTitle,
  }));

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 lg:px-10">
      <header className="border-b border-[var(--rule)] pb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
        <p className="mt-2 max-w-[64ch] text-sm text-[var(--text-dim)]">
          Driven by what you got wrong and how long ago you last retrieved it — not by a calendar.
          Cards enter the queue once their lesson is complete.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          Cards {cards.length > 0 ? <span className="font-mono text-sm text-[var(--text-faint)]">({cards.length} due)</span> : null}
        </h2>
        {cards.length ? (
          <FlashcardReviewer cards={cards} />
        ) : (
          <EmptyState
            title="No cards due"
            body="Either nothing has been scheduled yet, or the intervals have not elapsed. Reviewing early does not help — the spacing is what makes it stick."
            action={
              <Link href="/curriculum">
                <Button variant="secondary">Go to the curriculum</Button>
              </Link>
            }
          />
        )}
      </section>

      <section className="mt-12">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Lessons to revisit</h2>
        <p className="mb-4 max-w-[64ch] text-sm text-[var(--text-dim)]">
          Each of these is here for a reason the platform can name. Reread the relevant section, then
          grade how well it came back.
        </p>
        {items.length ? (
          <ReviewItemList
            items={items.map((i) => ({
              lessonId: i.lessonId,
              title: i.title,
              reason: i.reason,
              estimatedMinutes: i.estimatedMinutes,
            }))}
          />
        ) : (
          <EmptyState
            title="Nothing queued"
            body="Lessons land here after a missed quiz question, a repeatedly lapsed card, or a gap exposed in a mock interview."
          />
        )}
      </section>
    </div>
  );
}
