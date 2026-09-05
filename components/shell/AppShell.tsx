import Link from 'next/link';
import { NavRail } from './NavRail';
import { ThemeToggle } from './ThemeToggle';

/**
 * The plan sheet: a narrow persistent spine on the left, the sheet in the
 * middle. Lesson pages add their own right-hand margin rail.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
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

      <NavRail />

      <main id="sheet" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
