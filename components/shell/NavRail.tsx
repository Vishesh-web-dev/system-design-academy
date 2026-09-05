'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Library,
  RefreshCcw,
  MessagesSquare,
  Search,
  NotebookPen,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';

const links = [
  { href: '/', label: 'Today', icon: LayoutDashboard },
  { href: '/curriculum', label: 'Curriculum', icon: Library },
  { href: '/review', label: 'Review', icon: RefreshCcw },
  { href: '/interview', label: 'Interview', icon: MessagesSquare },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/notes', label: 'Notes', icon: NotebookPen },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function NavRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 z-30 flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--rule)] bg-[var(--ground)] px-3 py-2 lg:h-dvh lg:w-[13.5rem] lg:flex-col lg:gap-0 lg:overflow-visible lg:border-b-0 lg:border-r lg:px-3 lg:py-5"
    >
      <Link
        href="/"
        className="hidden shrink-0 px-2 pb-6 lg:block"
      >
        <span className="block text-[0.9375rem] font-semibold leading-tight tracking-tight">
          System Design
          <br />
          Academy
        </span>
      </Link>

      {links.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-[3px] px-2.5 py-2 text-sm transition-colors',
              active
                ? 'bg-[var(--surface-raised)] text-[var(--text)]'
                : 'text-[var(--text-dim)] hover:bg-[var(--surface)] hover:text-[var(--text)]',
            )}
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden />
            {label}
          </Link>
        );
      })}

      <div className="mt-auto hidden lg:block">
        <ThemeToggle />
      </div>
    </nav>
  );
}
