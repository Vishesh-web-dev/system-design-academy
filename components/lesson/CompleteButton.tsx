'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck } from 'lucide-react';
import { Button } from '../ui/primitives';
import { useReward } from '@/components/reward/RewardProvider';
import { markLessonComplete, markLessonIncomplete } from '@/app/lesson/actions';

/**
 * The completion gate. The server re-checks the rule, so this button is a
 * convenience rather than the authority — but it explains *why* it is disabled,
 * which is the part that teaches the learner what completion means here.
 */
export function CompleteButton({
  lessonId,
  complete,
  blockers,
}: {
  lessonId: string;
  complete: boolean;
  blockers: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string[] | null>(null);
  const router = useRouter();
  const reward = useReward();

  if (complete) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm text-signal-400">
          <CircleCheck size={15} strokeWidth={1.75} /> Complete
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await markLessonIncomplete(lessonId);
              router.refresh();
            })
          }
        >
          Reopen
        </Button>
      </div>
    );
  }

  const blocked = blockers.length > 0;

  return (
    <div>
      <Button
        variant="primary"
        disabled={pending || blocked}
        onClick={() =>
          startTransition(async () => {
            const result = await markLessonComplete(lessonId);
            if (result.ok) {
              setMessage(null);
              reward.show(result.reward);
              router.refresh();
            } else {
              setMessage(result.missing);
            }
          })
        }
      >
        {pending ? 'Saving…' : 'Mark complete'}
      </Button>
      {blocked || message ? (
        <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-faint)]">
          {(message ?? blockers).map((m) => (
            <li key={m}>Still needed: {m}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-signal-400">
          <span className="h-1.5 w-1.5 rounded-full bg-signal-500 motion-safe:animate-pulse" aria-hidden />
          Ready — you&apos;ve met the bar.
        </p>
      )}
    </div>
  );
}
