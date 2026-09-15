import { and, eq, gt, lt } from 'drizzle-orm';
import { getDb, schema } from '../client';

/**
 * Data access for accounts and sessions. Pure database operations — the cookie
 * handling, hashing and redirects live in lib/auth, which calls these. Keeping
 * the DB layer free of next/headers means these functions are testable and
 * usable from scripts (the seed creates the dev account this way).
 */

export type Learner = typeof schema.learners.$inferSelect;

export async function findUserByEmail(email: string): Promise<Learner | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.learners)
    .where(eq(schema.learners.email, email.toLowerCase()));
  return row;
}

export async function findUserById(id: string): Promise<Learner | undefined> {
  const [row] = await getDb().select().from(schema.learners).where(eq(schema.learners.id, id));
  return row;
}

export async function createUser(args: {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<Learner> {
  const [row] = await getDb()
    .insert(schema.learners)
    .values({
      id: args.id,
      email: args.email.toLowerCase(),
      passwordHash: args.passwordHash,
      displayName: args.displayName,
    })
    .returning();
  return row;
}

export async function createSessionRow(args: {
  id: string;
  learnerId: string;
  expiresAt: Date;
}): Promise<void> {
  await getDb().insert(schema.sessions).values(args);
}

/** Returns the learner id for a live (unexpired) session token hash, or null. */
export async function findLearnerForSession(sessionId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ learnerId: schema.sessions.learnerId })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), gt(schema.sessions.expiresAt, new Date())));
  return row?.learnerId ?? null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await getDb().delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

export async function deleteExpiredSessions(): Promise<void> {
  await getDb().delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}
