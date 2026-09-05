import { Lesson, type Lesson as LessonType } from '@/content/schema';
import { lessonModules, lessonSlugs } from '@/content/index.generated';
import { curriculum, lessonOrder, canonicalLessons } from '@/content/curriculum';

/**
 * Loads and validates lesson content. Parsing on read means a lesson that
 * slipped past `npm run content:validate` still cannot render half-formed.
 * Results are memoised per process.
 */

const cache = new Map<string, LessonType>();

export async function getLesson(slug: string): Promise<LessonType | undefined> {
  const cached = cache.get(slug);
  if (cached) return cached;

  const load = lessonModules[slug];
  if (!load) return undefined;

  const mod = await load();
  const parsed = Lesson.safeParse(mod.default);
  if (!parsed.success) {
    throw new Error(`Lesson "${slug}" failed validation: ${parsed.error.issues[0]?.message}`);
  }
  cache.set(slug, parsed.data);
  return parsed.data;
}

export async function getAllLessons(): Promise<LessonType[]> {
  const all = await Promise.all(lessonSlugs.map((s) => getLesson(s)));
  return all.filter((l): l is LessonType => Boolean(l)).sort((a, b) => a.position - b.position);
}

/** Slugs that have content, in curriculum order. */
export function authoredSlugs(): string[] {
  return lessonOrder.filter((s) => s in lessonModules);
}

export function hasLesson(slug: string): boolean {
  return slug in lessonModules;
}

export { curriculum, lessonOrder, canonicalLessons };
