/**
 * "Am I on track for 12–16 weeks?" — one of the six questions the dashboard
 * must answer (docs/PRODUCT.md → Core surfaces).
 *
 * Deliberately simple and honest: minutes of curriculum remaining, divided by
 * the learner's own weekly capacity. No predictive modelling dressed up as
 * certainty.
 */

export interface PaceInput {
  startDate: Date;
  targetWeeks: number;
  dailyGoalMinutes: number;
  studyDaysPerWeek: number;
  /** Estimated minutes for every lesson in the curriculum. */
  totalMinutes: number;
  /** Estimated minutes for lessons already completed. */
  completedMinutes: number;
  now?: Date;
}

export interface Pace {
  weeksElapsed: number;
  weeksRemaining: number;
  percentComplete: number;
  /** Where completion should be by now to finish on target, 0–1. */
  expectedPercent: number;
  minutesRemaining: number;
  weeklyCapacityMinutes: number;
  /** Weeks the remaining work will take at the learner's stated capacity. */
  weeksNeeded: number;
  status: 'ahead' | 'on-track' | 'behind' | 'not-started';
  /** One sentence, shown verbatim in the UI. */
  message: string;
}

export function computePace(input: PaceInput): Pace {
  const now = input.now ?? new Date();
  const msPerWeek = 7 * 86_400_000;
  const weeksElapsed = Math.max(0, (now.getTime() - input.startDate.getTime()) / msPerWeek);
  const weeksRemaining = Math.max(0, input.targetWeeks - weeksElapsed);

  const percentComplete = input.totalMinutes ? input.completedMinutes / input.totalMinutes : 0;
  const expectedPercent = Math.min(1, input.targetWeeks ? weeksElapsed / input.targetWeeks : 0);
  const minutesRemaining = Math.max(0, input.totalMinutes - input.completedMinutes);
  const weeklyCapacityMinutes = Math.max(1, input.dailyGoalMinutes * input.studyDaysPerWeek);
  const weeksNeeded = minutesRemaining / weeklyCapacityMinutes;

  let status: Pace['status'];
  let message: string;

  if (input.completedMinutes === 0) {
    status = 'not-started';
    message = `Nothing completed yet. At ${input.dailyGoalMinutes} min on ${input.studyDaysPerWeek} days a week, the curriculum takes about ${Math.ceil(weeksNeeded)} weeks.`;
  } else if (percentComplete >= expectedPercent + 0.05) {
    status = 'ahead';
    message = `${Math.round(percentComplete * 100)}% done against ${Math.round(expectedPercent * 100)}% expected by week ${Math.ceil(weeksElapsed)}. You have slack — spend it on mock interviews, not new lessons.`;
  } else if (percentComplete >= expectedPercent - 0.07) {
    status = 'on-track';
    message = `${Math.round(percentComplete * 100)}% done in week ${Math.max(1, Math.ceil(weeksElapsed))} of ${input.targetWeeks}. About ${Math.ceil(weeksNeeded)} weeks of work left at your current capacity.`;
  } else {
    status = 'behind';
    const needPerWeek = weeksRemaining > 0 ? minutesRemaining / weeksRemaining : minutesRemaining;
    message = `${Math.round(percentComplete * 100)}% done against ${Math.round(expectedPercent * 100)}% expected. Finishing in ${input.targetWeeks} weeks needs about ${Math.round(needPerWeek / 60)} h/week — either raise the goal or extend the target.`;
  }

  return {
    weeksElapsed: Number(weeksElapsed.toFixed(2)),
    weeksRemaining: Number(weeksRemaining.toFixed(2)),
    percentComplete: Number(percentComplete.toFixed(4)),
    expectedPercent: Number(expectedPercent.toFixed(4)),
    minutesRemaining: Math.round(minutesRemaining),
    weeklyCapacityMinutes,
    weeksNeeded: Number(weeksNeeded.toFixed(2)),
    status,
    message,
  };
}
