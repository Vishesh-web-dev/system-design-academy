'use client';

import { useRouter } from 'next/navigation';
import { Timer } from 'lucide-react';
import { useFocus } from '@/components/reward/FocusProvider';

/**
 * The timed half of the "one rep" controls. Starting a focus session arms the
 * countdown and then sends the learner to the action, so the clock is already
 * running when they arrive at the work.
 */
export function NextRepActions({
  title,
  href,
  minutes,
}: {
  title: string;
  href: string;
  minutes: number;
}) {
  const { start } = useFocus();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        start({ title, href }, minutes);
        router.push(href);
      }}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[3px] border border-[var(--rule-strong)] px-3.5 text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-raised)]"
    >
      <Timer size={14} /> Start {minutes}-min focus
    </button>
  );
}
