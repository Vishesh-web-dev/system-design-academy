'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { updateSettings } from '@/db/repo/learner';

const Input = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetWeeks: z.coerce.number().int().min(8).max(24),
  dailyGoalMinutes: z.coerce.number().int().min(15).max(360),
  studyDays: z.array(z.string()).min(1).max(7),
  unlockMode: z.enum(['strict', 'free']),
});

export async function saveSettings(formData: FormData) {
  const parsed = Input.safeParse({
    startDate: formData.get('startDate'),
    targetWeeks: formData.get('targetWeeks'),
    dailyGoalMinutes: formData.get('dailyGoalMinutes'),
    studyDays: formData.getAll('studyDays').map(String),
    unlockMode: formData.get('unlockMode'),
  });
  if (!parsed.success) return;

  await updateSettings(parsed.data);
  revalidatePath('/settings');
  revalidatePath('/');
}
