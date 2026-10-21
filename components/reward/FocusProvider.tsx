'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * The "one rep" focus session (docs/STATE.md → frozen decision 14).
 *
 * Temporal discounting loses to a near, concrete finish line. A focus session
 * picks ONE action, puts a visible countdown on it, and calls finishing that
 * action a rep. State is per-tab (sessionStorage) so the timer survives
 * navigation to the lesson/review page where the actual work happens.
 */

export interface FocusTarget {
  title: string;
  href: string;
}

interface FocusSession {
  target: FocusTarget;
  totalSeconds: number;
  /** Epoch ms when the countdown hits zero (while running). */
  endsAt: number;
  paused: boolean;
  /** Seconds left at the moment of pausing. */
  pausedRemaining: number;
  /** A real XP event landed during this session — the rep counted. */
  productive: boolean;
}

interface FocusApi {
  session: FocusSession | null;
  remaining: number;
  timeUp: boolean;
  start: (target: FocusTarget, minutes: number) => void;
  stop: () => void;
  togglePause: () => void;
  markProductive: () => void;
}

const KEY = 'sda-focus';

const FocusContext = createContext<FocusApi>({
  session: null,
  remaining: 0,
  timeUp: false,
  start: () => {},
  stop: () => {},
  togglePause: () => {},
  markProductive: () => {},
});

export const useFocus = () => useContext(FocusContext);

function read(): FocusSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FocusSession) : null;
  } catch {
    return null;
  }
}

function write(session: FocusSession | null) {
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode or blocked storage — the timer just won't persist. */
  }
}

function remainingOf(session: FocusSession | null): number {
  if (!session) return 0;
  if (session.paused) return Math.max(0, Math.round(session.pausedRemaining));
  return Math.max(0, Math.round((session.endsAt - Date.now()) / 1000));
}

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [remaining, setRemaining] = useState(0);
  const sessionRef = useRef<FocusSession | null>(null);
  sessionRef.current = session;

  // Hydrate from the tab's storage after mount (keeps SSR output stable).
  useEffect(() => {
    const existing = read();
    if (existing) {
      setSession(existing);
      setRemaining(remainingOf(existing));
    }
  }, []);

  // One ticking clock, derived from endsAt, so it stays correct across tabs
  // sleeping or the component remounting.
  useEffect(() => {
    const id = setInterval(() => setRemaining(remainingOf(sessionRef.current)), 1000);
    return () => clearInterval(id);
  }, []);

  const persist = useCallback((next: FocusSession | null) => {
    setSession(next);
    setRemaining(remainingOf(next));
    write(next);
  }, []);

  const start = useCallback(
    (target: FocusTarget, minutes: number) => {
      const seconds = Math.max(60, Math.round(minutes * 60));
      persist({
        target,
        totalSeconds: seconds,
        endsAt: Date.now() + seconds * 1000,
        paused: false,
        pausedRemaining: seconds,
        productive: false,
      });
    },
    [persist],
  );

  const stop = useCallback(() => persist(null), [persist]);

  const togglePause = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.paused) {
      persist({ ...s, paused: false, endsAt: Date.now() + s.pausedRemaining * 1000 });
    } else {
      persist({ ...s, paused: true, pausedRemaining: remainingOf(s) });
    }
  }, [persist]);

  const markProductive = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.productive) return;
    persist({ ...s, productive: true });
  }, [persist]);

  return (
    <FocusContext.Provider
      value={{ session, remaining, timeUp: Boolean(session) && remaining === 0, start, stop, togglePause, markProductive }}
    >
      {children}
    </FocusContext.Provider>
  );
}
