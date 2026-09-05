import { eq } from 'drizzle-orm';
import { getDb, schema } from '../client';

/**
 * V1 has no authentication (docs/PRODUCT.md → Privacy model). One learner row
 * owns everything. Every table still carries learner_id so adding auth later
 * is a data migration rather than a schema rewrite.
 */
export const LEARNER_ID = 'local';

export type Settings = typeof schema.userSettings.$inferSelect;

/** Creates the local learner and default settings on first use. */
export async function ensureLearner(): Promise<Settings> {
  const db = getDb();
  await db
    .insert(schema.learners)
    .values({ id: LEARNER_ID, displayName: 'Learner' })
    .onConflictDoNothing();

  const [existing] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.learnerId, LEARNER_ID));
  if (existing) return existing;

  const [created] = await db
    .insert(schema.userSettings)
    .values({ learnerId: LEARNER_ID, startDate: new Date().toISOString().slice(0, 10) })
    .onConflictDoUpdate({
      target: schema.userSettings.learnerId,
      set: { updatedAt: new Date() },
    })
    .returning();
  return created;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const db = getDb();
  await ensureLearner();
  const [row] = await db
    .update(schema.userSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.userSettings.learnerId, LEARNER_ID))
    .returning();
  return row;
}
