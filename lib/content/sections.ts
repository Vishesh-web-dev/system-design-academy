import type { Lesson } from '@/content/schema';

/**
 * The rendered section list. Shared by the player, the section rail and the
 * completion rule, so "all sections seen" means the same thing everywhere.
 */
export const SECTIONS = [
  { id: 'intuition', label: 'Intuition' },
  { id: 'deep', label: 'Deep explanation' },
  { id: 'visual', label: 'Visuals' },
  { id: 'production', label: 'In production' },
  { id: 'tradeoffs', label: 'Trade-offs' },
  { id: 'mistakes', label: 'Common mistakes' },
  { id: 'practice', label: 'Practice' },
  { id: 'exercise', label: 'Exercise' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'interview', label: 'Interview questions' },
  { id: 'revision', label: 'Five-minute revision' },
  { id: 'cheatsheet', label: 'Cheat sheet' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** Sections that exist for a given lesson (practice is optional). */
export function sectionsFor(lesson: Lesson): Array<{ id: SectionId; label: string }> {
  return SECTIONS.filter((s) => s.id !== 'practice' || lesson.activeLearning.length > 0).map((s) => ({
    id: s.id,
    label: s.label,
  }));
}
