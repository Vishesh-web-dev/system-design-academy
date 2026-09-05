'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ensureLearner } from '@/db/repo/learner';
import { createNote, deleteNote, updateNote } from '@/db/repo/notes';

const Body = z.string().trim().min(1).max(20_000);

export async function saveNote(input: { id?: string; body: string; lessonId?: string | null }) {
  const parsed = Body.safeParse(input.body);
  if (!parsed.success) return { ok: false as const, error: 'A note needs some text.' };

  await ensureLearner();
  if (input.id) await updateNote(input.id, parsed.data);
  else await createNote(parsed.data, input.lessonId ?? null);

  revalidatePath('/notes');
  return { ok: true as const };
}

export async function removeNote(id: string) {
  await ensureLearner();
  await deleteNote(id);
  revalidatePath('/notes');
}
