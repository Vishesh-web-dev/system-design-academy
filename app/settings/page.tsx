import { ensureLearner } from '@/db/repo/learner';
import { saveSettings } from './actions';
import { Sheet } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · System Design Academy' };

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export default async function SettingsPage() {
  const s = await ensureLearner();
  const aiConfigured = Boolean(process.env.AI_API_KEY) && process.env.AI_PROVIDER !== 'mock';

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 lg:px-10">
      <header className="border-b border-[var(--rule)] pb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-[62ch] text-sm text-[var(--text-dim)]">
          These numbers drive the pace projection and the daily recommendation. Set them to what you
          will actually do, not to what you would like to be true.
        </p>
      </header>

      <form action={saveSettings} className="mt-8 space-y-6">
        <Sheet className="space-y-5">
          <div>
            <label htmlFor="startDate" className="text-sm font-medium">Start date</label>
            <p className="mb-1.5 text-xs text-[var(--text-faint)]">Week 1 of the plan begins here.</p>
            <input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={s.startDate}
              className="w-full rounded-[3px] border border-[var(--rule-strong)] bg-[var(--ground)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-signal-600"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="targetWeeks" className="text-sm font-medium">Target weeks</label>
              <p className="mb-1.5 text-xs text-[var(--text-faint)]">The curriculum is designed for 14.</p>
              <input
                id="targetWeeks"
                name="targetWeeks"
                type="number"
                min={8}
                max={24}
                defaultValue={s.targetWeeks}
                className="w-full rounded-[3px] border border-[var(--rule-strong)] bg-[var(--ground)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-signal-600"
              />
            </div>
            <div>
              <label htmlFor="dailyGoalMinutes" className="text-sm font-medium">Daily goal (minutes)</label>
              <p className="mb-1.5 text-xs text-[var(--text-faint)]">Realistic beats ambitious.</p>
              <input
                id="dailyGoalMinutes"
                name="dailyGoalMinutes"
                type="number"
                min={15}
                max={360}
                step={5}
                defaultValue={s.dailyGoalMinutes}
                className="w-full rounded-[3px] border border-[var(--rule-strong)] bg-[var(--ground)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-signal-600"
              />
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Study days</legend>
            <p className="mb-2 text-xs text-[var(--text-faint)]">Used to convert the daily goal into weekly capacity.</p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <label key={d} className="flex cursor-pointer items-center gap-1.5 rounded-[3px] border border-[var(--rule-strong)] px-2.5 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="studyDays"
                    value={d}
                    defaultChecked={s.studyDays.includes(d)}
                    className="h-3.5 w-3.5 accent-[var(--color-signal-500)]"
                  />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Lesson unlocking</legend>
            <p className="mb-2 text-xs text-[var(--text-faint)]">
              Strict enforces the dependency graph. Free lets you jump anywhere — useful if you
              already know a phase, risky if you do not.
            </p>
            <div className="flex gap-4">
              {(['strict', 'free'] as const).map((mode) => (
                <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="unlockMode" value={mode} defaultChecked={s.unlockMode === mode} className="accent-[var(--color-signal-500)]" />
                  {mode}
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            className="rounded-[3px] bg-signal-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-signal-400"
          >
            Save settings
          </button>
        </Sheet>
      </form>

      <Sheet className="mt-6">
        <h2 className="text-sm font-semibold">Interview simulator</h2>
        <p className="mt-1.5 text-sm text-[var(--text-dim)]">
          {aiConfigured
            ? `Configured with the ${process.env.AI_PROVIDER ?? 'google'} provider. The key is read on the server only and never reaches the browser.`
            : 'Running the scripted interviewer. Set AI_PROVIDER and AI_API_KEY in .env.local for a live model. Everything else in the platform works either way.'}
        </p>
      </Sheet>

      <Sheet className="mt-6">
        <h2 className="text-sm font-semibold">Privacy</h2>
        <p className="mt-1.5 text-sm text-[var(--text-dim)]">
          There is no authentication in V1 and no second learner. If you deploy this publicly, turn
          on your host&apos;s deployment protection — otherwise anyone with the URL can read and
          change your progress.
        </p>
      </Sheet>
    </div>
  );
}
