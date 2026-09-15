'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { login, signup, type AuthState } from './actions';

/**
 * Shared login/signup form. The server action redirects on success, so the
 * only client state is the validation/credential error surfaced by the action.
 */
export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const action = mode === 'login' ? login : signup;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {});

  const isLogin = mode === 'login';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">
        {isLogin ? 'Log in' : 'Create your account'}
      </h1>
      <p className="mt-1 text-sm text-[var(--text-dim)]">
        {isLogin
          ? 'Welcome back to System Design Academy.'
          : 'Your progress, notes and interviews are private to your account.'}
      </p>

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        {!isLogin && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-[var(--text-dim)]">Display name (optional)</span>
            <input
              name="displayName"
              type="text"
              autoComplete="name"
              maxLength={60}
              className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--signal)]"
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-[var(--text-dim)]">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--signal)]"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-[var(--text-dim)]">Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--signal)]"
          />
          {!isLogin && (
            <span className="text-xs text-[var(--text-dim)]">At least 8 characters.</span>
          )}
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-[var(--alert)]">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-[3px] bg-[var(--signal)] px-3 py-2 text-sm font-medium text-[var(--ground)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Please wait…' : isLogin ? 'Log in' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-[var(--text-dim)]">
        {isLogin ? (
          <>
            No account?{' '}
            <Link href="/signup" className="text-[var(--text)] underline underline-offset-2">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link href="/login" className="text-[var(--text)] underline underline-offset-2">
              Log in
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
