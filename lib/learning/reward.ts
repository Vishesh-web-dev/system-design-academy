/**
 * The reward payload (docs/PRODUCT.md → Gamification rules, frozen decision 14).
 *
 * The anti-dopamine substance is unchanged: XP is still minted only for real
 * retrieval and reasoning. What this adds is *visibility* — when a mutation
 * mints XP, it returns this so the client can show the learner, immediately,
 * what their effort earned. Delayed, invisible rewards are exactly what loses
 * to temporal discounting; this is the fix.
 *
 * Pure and dependency-free, so a server action can build it and a client
 * component can read it.
 */

import type { AchievementCode, AchievementDef } from './achievements';

export interface UnlockedAchievement extends AchievementDef {
  code: AchievementCode;
}

export interface RewardPayload {
  /** XP minted by this action. Always > 0 when a payload is returned. */
  xpAwarded: number;
  /** Human reason, e.g. "Passed a quiz" (from XP_REASON). */
  reason: string;
  newTotalXp: number;
  levelBefore: number;
  levelAfter: number;
  streakBefore: number;
  streakAfter: number;
  unlockedAchievements: UnlockedAchievement[];
}

/** Streak lengths worth a loud moment rather than a silent increment. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100] as const;

/** The milestone just crossed by going from `before` to `after`, or null. */
export function streakMilestoneReached(before: number, after: number): number | null {
  for (const m of STREAK_MILESTONES) {
    if (before < m && after >= m) return m;
  }
  return null;
}

export function leveledUp(p: RewardPayload): boolean {
  return p.levelAfter > p.levelBefore;
}

/**
 * Significant = worth a loud celebration rather than a quiet XP chip. High-
 * frequency callers (flashcards, 2 XP each) surface only significant payloads,
 * so a deck review does not fire forty toasts.
 */
export function isSignificant(p: RewardPayload): boolean {
  return (
    leveledUp(p) ||
    p.unlockedAchievements.length > 0 ||
    streakMilestoneReached(p.streakBefore, p.streakAfter) !== null
  );
}
