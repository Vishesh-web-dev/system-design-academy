import { getAllLessons } from './loader';

/**
 * Search over lesson metadata, cheat sheets, flashcards and interview
 * questions. Built once per process from content/ — no external search
 * service, because the corpus is 89 lessons and fits in memory many times over.
 *
 * Scoring is deliberately simple and explainable: field weight × term
 * coverage, with a bonus for phrase matches. Ranking quality is asserted
 * against fixture queries in tests/unit/search.test.ts.
 */

export type SearchKind = 'lesson' | 'cheatsheet' | 'flashcard' | 'interview-question';

export interface SearchDoc {
  id: string;
  lessonSlug: string;
  lessonTitle: string;
  kind: SearchKind;
  title: string;
  body: string;
  tags: string[];
  weight: number;
}

export interface SearchHit extends SearchDoc {
  score: number;
}

let index: SearchDoc[] | undefined;

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'how', 'what',
  'why', 'when', 'do', 'does', 'i', 'it', 'that', 'this', 'be',
]);

export function tokenize(s: string): string[] {
  return (
    s
      .toLowerCase()
      .split(/[^a-z0-9+]+/)
      // Single digits are kept: "HTTP/2" and "HTTP/3" are real queries, and
      // dropping the version number makes them indistinguishable.
      .filter((t) => (t.length > 1 || /\d/.test(t)) && !STOP.has(t))
  );
}

export async function buildIndex(): Promise<SearchDoc[]> {
  if (index) return index;
  const lessons = await getAllLessons();

  const docs: SearchDoc[] = [];
  for (const l of lessons) {
    docs.push({
      id: `lesson:${l.slug}`,
      lessonSlug: l.slug,
      lessonTitle: l.title,
      kind: 'lesson',
      title: l.title,
      body: `${l.summary} ${l.tags.join(' ')} ${l.intuition.body.slice(0, 600)}`,
      tags: l.tags,
      weight: 3,
    });

    docs.push({
      id: `cheat:${l.slug}`,
      lessonSlug: l.slug,
      lessonTitle: l.title,
      kind: 'cheatsheet',
      title: `${l.title} — cheat sheet`,
      body: [
        l.cheatSheet.whatItIs,
        l.cheatSheet.whyItExists,
        ...l.cheatSheet.whenToUse,
        ...l.cheatSheet.whenNotToUse,
        ...l.cheatSheet.alternatives,
        ...l.cheatSheet.tradeoffs,
        ...l.cheatSheet.failureModes,
      ].join(' '),
      tags: l.tags,
      weight: 2,
    });

    for (const f of l.flashcards) {
      docs.push({
        id: `card:${f.id}`,
        lessonSlug: l.slug,
        lessonTitle: l.title,
        kind: 'flashcard',
        title: f.front,
        body: f.back,
        tags: [f.topic],
        weight: 1.5,
      });
    }

    for (const q of l.interviewQuestions) {
      docs.push({
        id: `iq:${q.id}`,
        lessonSlug: l.slug,
        lessonTitle: l.title,
        kind: 'interview-question',
        title: q.question,
        body: q.guidance,
        tags: l.tags,
        weight: 1.5,
      });
    }
  }

  index = docs;
  return docs;
}

export function scoreDoc(doc: SearchDoc, terms: string[], phrase: string): number {
  const title = doc.title.toLowerCase();
  const body = doc.body.toLowerCase();
  const tags = doc.tags.join(' ').toLowerCase();

  let matched = 0;
  let score = 0;

  for (const t of terms) {
    let termScore = 0;
    if (title.includes(t)) termScore += 6;
    if (tags.includes(t)) termScore += 4;
    if (body.includes(t)) termScore += 2;
    if (termScore > 0) matched += 1;
    score += termScore;
  }

  // A document that matched one term out of three is noise, not a result:
  // "kubernetes operator crd" should not surface a TLS card because the word
  // "operator" appears in it. Require at least half the terms.
  const required = Math.ceil(terms.length / 2);
  if (matched < required) return 0;

  // Beyond that floor, every term present is worth much more than one term
  // present many times.
  const coverage = matched / terms.length;
  score *= 0.4 + 0.6 * coverage;

  if (phrase.length > 3 && (title.includes(phrase) || body.includes(phrase))) score += 8;

  return score * doc.weight;
}

export async function search(query: string, limit = 20): Promise<SearchHit[]> {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const phrase = query.trim().toLowerCase();
  const docs = await buildIndex();

  return docs
    .map((doc) => ({ ...doc, score: scoreDoc(doc, terms, phrase) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.lessonSlug.localeCompare(b.lessonSlug))
    .slice(0, limit);
}
