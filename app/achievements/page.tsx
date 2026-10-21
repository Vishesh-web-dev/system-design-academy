import { ensureLearner } from '@/db/repo/learner';
import { listAchievements } from '@/db/repo/progress';
import { ACHIEVEMENTS, ACHIEVEMENT_ORDER } from '@/lib/learning/achievements';
import { Tag } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Achievements · System Design Academy' };

export default async function AchievementsPage() {
  await ensureLearner();
  const unlocked = await listAchievements();
  const byCode = new Map(unlocked.map((a) => [a.code, a.unlockedAt]));

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 lg:px-10">
      <header className="border-b border-[var(--rule)] pb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Achievements</h1>
        <p className="mt-2 max-w-[62ch] text-sm text-[var(--text-dim)]">
          Each one is earned for retrieval and reasoning — passing quizzes, submitting exercises,
          surviving interviews, showing up day after day. None of them reward reading a page or
          logging in. {unlocked.length} of {ACHIEVEMENT_ORDER.length} unlocked.
        </p>
      </header>

      <ul className="mt-8 space-y-2.5">
        {ACHIEVEMENT_ORDER.map((code) => {
          const a = ACHIEVEMENTS[code];
          const at = byCode.get(code);
          const isUnlocked = Boolean(at);
          return (
            <li
              key={code}
              className={`flex items-start gap-3.5 rounded-[3px] border p-4 ${
                isUnlocked ? 'border-brass-500/40 bg-[var(--surface)]' : 'border-[var(--rule)]'
              }`}
            >
              <span className={`mt-0.5 text-2xl ${isUnlocked ? '' : 'opacity-40 grayscale'}`} aria-hidden>
                {a.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-semibold ${isUnlocked ? '' : 'text-[var(--text-dim)]'}`}>
                    {a.name}
                  </span>
                  {isUnlocked ? (
                    <Tag tone="brass">unlocked</Tag>
                  ) : (
                    <Tag tone="neutral">{a.criteria}</Tag>
                  )}
                </div>
                <p className="mt-1 text-sm text-[var(--text-dim)]">
                  {isUnlocked ? a.description : `Locked — ${a.criteria.toLowerCase()}.`}
                </p>
                {at ? (
                  <p className="mt-1 font-mono text-xs text-[var(--text-faint)]">
                    {new Date(at).toLocaleDateString()}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
