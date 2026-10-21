'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Trophy } from 'lucide-react';
import type { RewardPayload } from '@/lib/learning/reward';
import { leveledUp, streakMilestoneReached } from '@/lib/learning/reward';
import { useFocus } from './FocusProvider';

/**
 * Immediate, visible reward feedback (docs/STATE.md → frozen decision 14).
 *
 * When a mutation mints XP it returns a RewardPayload; the client calls
 * `show()` and the effort is acknowledged *now* — an XP chip for the ordinary
 * case, a louder moment for a level-up, a streak milestone or an unlocked
 * achievement. This is the visibility the anti-dopamine V1 left out; the
 * substance (XP only for real retrieval) is unchanged.
 */

type Toast =
  | { id: string; kind: 'xp'; amount: number; reason: string }
  | { id: string; kind: 'level'; level: number }
  | { id: string; kind: 'streak'; days: number }
  | { id: string; kind: 'achievement'; name: string; icon: string; description: string };

interface RewardApi {
  show: (payload: RewardPayload | null | undefined) => void;
}

const RewardContext = createContext<RewardApi>({ show: () => {} });

export const useReward = () => useContext(RewardContext);

let counter = 0;
const nextId = () => `r${Date.now()}-${(counter += 1)}`;

function beep() {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    /* audio blocked or unsupported — silent is fine. */
  }
}

export function RewardProvider({
  animations = true,
  sound = false,
  children,
}: {
  animations?: boolean;
  sound?: boolean;
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prefersReduced = useReducedMotion();
  const motionOn = animations && !prefersReduced;
  const focus = useFocus();
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const remove = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (payload: RewardPayload | null | undefined) => {
      if (!payload) return;

      // A reward means real work landed — if a focus session is running, this
      // is the rep completing.
      focusRef.current.markProductive();

      const batch: Toast[] = [];
      if (payload.xpAwarded > 0) {
        batch.push({ id: nextId(), kind: 'xp', amount: payload.xpAwarded, reason: payload.reason });
      }
      if (leveledUp(payload)) {
        batch.push({ id: nextId(), kind: 'level', level: payload.levelAfter });
      }
      const milestone = streakMilestoneReached(payload.streakBefore, payload.streakAfter);
      if (milestone) {
        batch.push({ id: nextId(), kind: 'streak', days: milestone });
      }
      for (const a of payload.unlockedAchievements) {
        batch.push({ id: nextId(), kind: 'achievement', name: a.name, icon: a.icon, description: a.description });
      }

      if (!batch.length) return;
      setToasts((prev) => [...prev.slice(-4), ...batch]);
      if (sound && batch.some((t) => t.kind !== 'xp')) beep();
    },
    [sound],
  );

  return (
    <RewardContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} motionOn={motionOn} onDone={() => remove(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </RewardContext.Provider>
  );
}

function ToastItem({ toast, motionOn, onDone }: { toast: Toast; motionOn: boolean; onDone: () => void }) {
  useEffect(() => {
    const ms = toast.kind === 'xp' ? 3200 : 5200;
    const id = setTimeout(onDone, ms);
    return () => clearTimeout(id);
  }, [toast, onDone]);

  const anim = motionOn
    ? {
        initial: { opacity: 0, y: 12, scale: 0.96 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, x: 24, transition: { duration: 0.18 } },
        transition: { type: 'spring' as const, stiffness: 420, damping: 30 },
      }
    : { initial: false as const, animate: {}, exit: { opacity: 0 } };

  return (
    <motion.div
      {...anim}
      layout={motionOn}
      data-testid="reward-toast"
      data-reward-kind={toast.kind}
      className="pointer-events-auto rounded-[4px] border border-[var(--rule-strong)] bg-[var(--surface-raised)] px-3.5 py-2.5 shadow-lg shadow-black/20"
    >
      {toast.kind === 'xp' ? (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-base font-semibold tabular-nums text-signal-400">+{toast.amount} XP</span>
          <span className="text-xs text-[var(--text-dim)]">{toast.reason}</span>
        </div>
      ) : toast.kind === 'level' ? (
        <div className="flex items-center gap-2.5">
          <span className="text-lg">⬆️</span>
          <div>
            <p className="text-sm font-semibold">Level {toast.level}</p>
            <p className="text-xs text-[var(--text-dim)]">New level reached — the curve just got steeper.</p>
          </div>
        </div>
      ) : toast.kind === 'streak' ? (
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🔥</span>
          <div>
            <p className="text-sm font-semibold">{toast.days}-day streak</p>
            <p className="text-xs text-[var(--text-dim)]">Keep it alive — show up tomorrow.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <span className="text-lg" aria-hidden>
            {toast.icon}
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Trophy size={13} className="text-brass-400" /> {toast.name}
            </p>
            <p className="text-xs text-[var(--text-dim)]">{toast.description}</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
