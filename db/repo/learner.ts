import { eq } from 'drizzle-orm';
import { getDb, schema } from '../client';
import { requireLearnerId } from '@/lib/auth/session';

/**
 * Per-account settings. The account itself is created at signup
 * (lib/auth + db/repo/auth); this ensures and updates the settings row for the
 * currently authenticated learner. `requireLearnerId` redirects to /login if
 * the session is missing, so these never run for an anonymous request.
 */

export type Settings = typeof schema.userSettings.$inferSelect;

/** Ensures the current learner has a settings row, creating defaults on first use. */
export async function ensureLearner(): Promise<Settings> {
  const learnerId = await requireLearnerId();
  const db = getDb();

  const [existing] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.learnerId, learnerId));
  if (existing) return existing;

  const [created] = await db
    .insert(schema.userSettings)
    .values({ learnerId, startDate: new Date().toISOString().slice(0, 10) })
    .onConflictDoUpdate({
      target: schema.userSettings.learnerId,
      set: { updatedAt: new Date() },
    })
    .returning();
  return created;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const learnerId = await requireLearnerId();
  const db = getDb();
  await ensureLearner();
  const [row] = await db
    .update(schema.userSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.userSettings.learnerId, learnerId))
    .returning();
  return row;
}
