import Link from 'next/link';
import { NavRail } from './NavRail';
import { ThemeToggle } from './ThemeToggle';
import { getCurrentUser } from '@/lib/auth/session';

/**
 * The plan sheet: a narrow persistent spine on the left, the sheet in the
 * middle. Lesson pages add their own right-hand margin rail.
 *
 * Unauthenticated requests (the /login and /signup pages) get a bare frame —
 * the auth form provides its own full-screen layout — so the nav only appears
 * once someone is signed in.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    return <div className="min-h-dvh">{children}</div>;
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <a
        href="#sheet"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--surface-raised)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="flex items-center justify-between border-b border-[var(--rule)] px-4 py-3 lg:hidden">
        <Link href="/" className="font-semibold tracking-tight">
          System Design Academy
        </Link>
        <ThemeToggle />
      </header>

      <NavRail account={{ displayName: user.displayName, email: user.email }} />

      <main id="sheet" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
