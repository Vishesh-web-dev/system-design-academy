'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/primitives';
import { REVIEW_GRADES } from '@/lib/learning/sm2';
import { clearReview } from '@/app/review/actions';

const REASON_TEXT: Record<string, string> = {
  quiz_miss: 'You missed questions on this.',
  flashcard_lapse: 'Cards from this lesson keep lapsing.',
  interview_gap: 'A mock interview exposed a gap here.',
  decay: 'It has been long enough that recall is fading.',
};

export function ReviewItemList({
  items,
}: {
  items: Array<{ lessonId: string; title: string; reason: string; estimatedMinutes: number }>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.lessonId} className="rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Link href={`/lesson/${item.lessonId}`} className="text-sm font-medium hover:underline">
              {item.title}
            </Link>
            <span className="font-mono text-xs text-[var(--text-faint)]">
              ~{Math.round(item.estimatedMinutes / 4)} min to revise
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--text-dim)]">
            {REASON_TEXT[item.reason] ?? 'Queued for another pass.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-faint)]">How well did it come back?</span>
            {REVIEW_GRADES.map((g) => (
              <Button
                key={g.grade}
                size="sm"
                variant={g.grade === 1 ? 'danger' : g.grade >= 4 ? 'primary' : 'secondary'}
                disabled={pending}
                title={g.hint}
                onClick={() =>
                  startTransition(async () => {
                    await clearReview(item.lessonId, g.grade);
                    router.refresh();
                  })
                }
              >
                {g.label}
              </Button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
