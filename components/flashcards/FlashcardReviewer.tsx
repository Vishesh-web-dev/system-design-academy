'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Meter, Sheet } from '../ui/primitives';
import { REVIEW_GRADES, type Grade } from '@/lib/learning/sm2';
import { useReward } from '@/components/reward/RewardProvider';
import { isSignificant } from '@/lib/learning/reward';
import { gradeCard } from '@/app/review/actions';

export interface ReviewCard {
  id: string;
  front: string;
  back: string;
  topic: string;
  lessonTitle: string;
}

/**
 * Keyboard-first: space reveals, 1–4 grade. A review session is dozens of
 * repetitions, and reaching for a mouse each time is why people stop doing
 * them.
 */
export function FlashcardReviewer({ cards }: { cards: ReviewCard[] }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(0);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const reward = useReward();

  const card = cards[index];
  const done = index >= cards.length;

  const submit = useCallback(
    (grade: Grade) => {
      if (!card) return;
      const id = card.id;
      startTransition(async () => {
        const r = await gradeCard(id, grade);
        // A deck is dozens of +2 XP cards; only surface the moments that matter
        // (a level-up, a streak milestone, an unlocked achievement).
        if (r && isSignificant(r)) reward.show(r);
      });
      setGraded((g) => g + 1);
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [card, reward],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (done) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed) return;
      const n = Number(e.key);
      if (n >= 1 && n <= REVIEW_GRADES.length) {
        e.preventDefault();
        submit(REVIEW_GRADES[n - 1].grade);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, done, submit]);

  if (done) {
    return (
      <Sheet data-testid="review-complete">
        <p className="font-mono text-3xl leading-none tabular-nums">{graded}</p>
        <p className="mt-2 text-sm text-[var(--text-dim)]">
          {graded === 0
            ? 'Nothing was due.'
            : `Cards reviewed. Anything you graded "Again" comes back in ten minutes; the rest moved further out.`}
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => router.refresh()}>
          Refresh queue
        </Button>
      </Sheet>
    );
  }

  return (
    <div className="space-y-4" data-testid="flashcard-reviewer">
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-xs text-[var(--text-faint)]">
          {index + 1} of {cards.length} · {card.lessonTitle}
        </span>
        <span className="font-mono text-xs text-[var(--text-faint)]">{card.topic.replace(/-/g, ' ')}</span>
      </div>
      <Meter value={index} max={cards.length} label="Review progress" />

      <Sheet className="min-h-[14rem]">
        <p className="max-w-[60ch] font-serif text-xl leading-snug">{card.front}</p>

        {revealed ? (
          <div className="mt-6 border-t border-[var(--rule)] pt-5">
            <p className="max-w-[66ch] text-[0.9375rem] leading-relaxed text-[var(--text-dim)]">
              {card.back}
            </p>
          </div>
        ) : null}
      </Sheet>

      {!revealed ? (
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => setRevealed(true)} data-testid="reveal-card">
            Show answer
          </Button>
          <span className="text-xs text-[var(--text-faint)]">
            Say it out loud first. Press <kbd className="font-mono">space</kbd>.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {REVIEW_GRADES.map((g, i) => (
            <Button
              key={g.grade}
              variant={g.grade === 1 ? 'danger' : g.grade >= 4 ? 'primary' : 'secondary'}
              onClick={() => submit(g.grade)}
              title={g.hint}
              data-testid={`grade-${g.grade}`}
            >
              <span className="font-mono text-xs opacity-60">{i + 1}</span>
              {g.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
