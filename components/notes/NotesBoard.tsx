'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button, EmptyState } from '../ui/primitives';
import { removeNote, saveNote } from '@/app/notes/actions';

export interface NoteView {
  id: string;
  body: string;
  lessonId: string | null;
  lessonTitle: string | null;
  updatedAt: string;
}

export function NotesBoard({ notes }: { notes: NoteView[] }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function add() {
    startTransition(async () => {
      const result = await saveNote({ body: draft });
      if (result.ok) {
        setDraft('');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <label htmlFor="new-note" className="text-xs font-semibold text-[var(--text-faint)]">
          Explain something in your own words
        </label>
        <textarea
          id="new-note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          placeholder="Why does a quorum need R + W > N? Write it as if explaining to someone who has not read the lesson."
          className="mt-1.5 w-full resize-y rounded-[3px] border border-[var(--rule-strong)] bg-[var(--ground)] p-3 text-sm leading-relaxed outline-none placeholder:text-[var(--text-faint)] focus-visible:border-signal-600"
        />
        <Button className="mt-2" variant="primary" onClick={add} disabled={!draft.trim() || pending}>
          {pending ? 'Saving…' : 'Save note'}
        </Button>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          title="No notes yet"
          body="A note written before you look at the lesson again is worth ten highlights."
        />
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-[var(--text-faint)]">
                  {new Date(n.updatedAt).toLocaleDateString()}
                  {n.lessonId ? (
                    <>
                      {' · '}
                      <Link href={`/lesson/${n.lessonId}`} className="text-signal-400 hover:underline">
                        {n.lessonTitle ?? n.lessonId}
                      </Link>
                    </>
                  ) : null}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(editing === n.id ? null : n.id);
                      setEditBody(n.body);
                    }}
                  >
                    {editing === n.id ? 'Cancel' : 'Edit'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete note"
                    onClick={() =>
                      startTransition(async () => {
                        await removeNote(n.id);
                        router.refresh();
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>

              {editing === n.id ? (
                <div className="mt-3">
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={6}
                    className="w-full resize-y rounded-[3px] border border-[var(--rule-strong)] bg-[var(--ground)] p-3 text-sm outline-none focus-visible:border-signal-600"
                  />
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="primary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await saveNote({ id: n.id, body: editBody });
                        setEditing(null);
                        router.refresh();
                      })
                    }
                  >
                    Save changes
                  </Button>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{n.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
