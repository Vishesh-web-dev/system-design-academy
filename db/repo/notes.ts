import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '../client';
import { LEARNER_ID } from './learner';

export type NoteRow = typeof schema.notes.$inferSelect;

export async function listNotes(): Promise<Array<NoteRow & { lessonTitle: string | null }>> {
  const rows = await getDb()
    .select({ note: schema.notes, lessonTitle: schema.lessons.title })
    .from(schema.notes)
    .leftJoin(schema.lessons, eq(schema.notes.lessonId, schema.lessons.id))
    .where(eq(schema.notes.learnerId, LEARNER_ID))
    .orderBy(desc(schema.notes.updatedAt));
  return rows.map((r) => ({ ...r.note, lessonTitle: r.lessonTitle }));
}

export async function createNote(body: string, lessonId: string | null): Promise<NoteRow> {
  const [row] = await getDb()
    .insert(schema.notes)
    .values({ id: randomUUID(), learnerId: LEARNER_ID, lessonId, body })
    .returning();
  return row;
}

export async function updateNote(id: string, body: string): Promise<void> {
  await getDb()
    .update(schema.notes)
    .set({ body, updatedAt: new Date() })
    .where(and(eq(schema.notes.id, id), eq(schema.notes.learnerId, LEARNER_ID)));
}

export async function deleteNote(id: string): Promise<void> {
  await getDb()
    .delete(schema.notes)
    .where(and(eq(schema.notes.id, id), eq(schema.notes.learnerId, LEARNER_ID)));
}
