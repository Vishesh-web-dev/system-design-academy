import { ensureLearner } from '@/db/repo/learner';
import { listNotes } from '@/db/repo/notes';
import { NotesBoard } from '@/components/notes/NotesBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notes · System Design Academy' };

export default async function NotesPage() {
  await ensureLearner();
  const notes = await listNotes();

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 lg:px-10">
      <header className="border-b border-[var(--rule)] pb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Notes</h1>
        <p className="mt-2 max-w-[64ch] text-sm text-[var(--text-dim)]">
          Your own words. Writing an explanation you have not read anywhere is the strongest test of
          whether you actually understand it — stronger than any quiz in this product.
        </p>
      </header>
      <div className="mt-8">
        <NotesBoard
          notes={notes.map((n) => ({
            id: n.id,
            body: n.body,
            lessonId: n.lessonId,
            lessonTitle: n.lessonTitle,
            updatedAt: n.updatedAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
