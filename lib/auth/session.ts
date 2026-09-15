import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { createSessionRow, deleteSession, findLearnerForSession, findUserById } from '@/db/repo/auth';
import { SESSION_COOKIE } from './cookie';

/**
 * Session lifecycle. The cookie carries an opaque 256-bit token; the database
 * stores only sha256(token), so the DB never holds a usable credential. Reads
 * are memoised per request with React `cache`, so threading the current learner
 * through every repo call costs one cookie read and one query per request.
 */

export { SESSION_COOKIE };
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Issues a new session for a learner and sets the cookie. */
export async function startSession(learnerId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await createSessionRow({ id: hashToken(token), learnerId, expiresAt });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/** Clears the current session, deleting the row and the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(hashToken(token));
  jar.delete(SESSION_COOKIE);
}

/**
 * The current learner id, or null. Memoised per request. An invalid or expired
 * cookie resolves to null (the page then redirects to /login); the cookie is
 * left for a subsequent action or the login page to clear, since a Server
 * Component render cannot mutate cookies.
 */
export const getLearnerId = cache(async (): Promise<string | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findLearnerForSession(hashToken(token));
});

/** The current learner id, or a redirect to /login. Use in protected code. */
export async function requireLearnerId(): Promise<string> {
  const id = await getLearnerId();
  if (!id) redirect('/login');
  return id;
}

export type CurrentUser = { id: string; email: string | null; displayName: string };

/** The current account for display (nav, settings), or null. Memoised. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const id = await getLearnerId();
  if (!id) return null;
  const row = await findUserById(id);
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.displayName };
});
