'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('sda-theme', next);
    } catch {
      /* storage unavailable; the toggle still works for this page view */
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-2.5 rounded-[3px] px-2.5 py-2 text-sm text-[var(--text-dim)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
    >
      {theme === 'dark' ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
      <span className="hidden lg:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
      <span className="sr-only lg:hidden">Switch theme</span>
    </button>
  );
}
