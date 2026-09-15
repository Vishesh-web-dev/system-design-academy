'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createUser, findUserByEmail } from '@/db/repo/auth';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { startSession, endSession } from '@/lib/auth/session';

export type AuthState = { error?: string };

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'at least 8 characters').max(200),
});

const SignupInput = Credentials.extend({
  displayName: z.string().trim().min(1).max(60).optional(),
});

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = SignupInput.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    displayName: (formData.get('displayName') as string) || undefined,
  });
  if (!parsed.success) {
    return { error: 'Enter a valid email and a password of at least 8 characters.' };
  }

  const { email, password } = parsed.data;
  if (await findUserByEmail(email)) {
    return { error: 'An account with that email already exists. Try logging in.' };
  }

  const passwordHash = await hashPassword(password);
  const displayName = parsed.data.displayName ?? email.split('@')[0];

  let userId: string;
  try {
    const user = await createUser({ id: randomUUID(), email, passwordHash, displayName });
    userId = user.id;
  } catch (e) {
    // Unique-violation race: someone registered the same email between the
    // check and the insert.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505') {
      return { error: 'An account with that email already exists. Try logging in.' };
    }
    throw e;
  }

  await startSession(userId);
  redirect('/');
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Enter your email and password.' };

  const user = await findUserByEmail(parsed.data.email);
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash);
  if (!user || !ok) return { error: 'Incorrect email or password.' };

  await startSession(user.id);
  redirect('/');
}

export async function logout(): Promise<void> {
  await endSession();
  redirect('/login');
}
