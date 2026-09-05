import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { Lesson, ResourceFile, type Resource, type Lesson as LessonType } from '../content/schema';
import { curriculum, lessonOrder, phaseOf, moduleOf } from '../content/curriculum';
import { findLessonFiles, slugFromFile, renderIndex } from './build-content-index';

/**
 * The content gate. Everything docs/CONTENT_STYLE.md can check mechanically is
 * checked here. Also rewrites docs/CONTENT_STATUS.md, so lesson status is
 * derived from the content rather than asserted by hand.
 */

type Status = 'Planned' | 'Drafting' | 'Reviewed' | 'Complete';

const errors: string[] = [];
const statuses = new Map<string, { status: Status; note: string }>();
const err = (m: string) => errors.push(m);

// ── Resource allowlist ──────────────────────────────────────────────────────

let resourcesByKey = new Map<string, Resource>();
try {
  const parsed = ResourceFile.parse(parse(readFileSync(join('docs', 'resources.yaml'), 'utf8')));
  resourcesByKey = new Map(parsed.resources.map((r) => [r.key, r]));
  const dupes = parsed.resources.length - resourcesByKey.size;
  if (dupes > 0) err(`docs/resources.yaml has ${dupes} duplicate key(s)`);
} catch (e) {
  err(`docs/resources.yaml is invalid: ${e instanceof Error ? e.message : String(e)}`);
}

// ── Generated index freshness ───────────────────────────────────────────────

const files = findLessonFiles();
const indexPath = join('content', 'index.generated.ts');
if (!existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== renderIndex(files)) {
  err('content/index.generated.ts is stale — run `npm run content:index`');
}

// ── Curriculum ↔ files ↔ prose doc ──────────────────────────────────────────

const fileSlugs = new Set(files.map(slugFromFile));
const curriculumSlugs = new Set(lessonOrder);

for (const slug of fileSlugs) {
  if (!curriculumSlugs.has(slug)) err(`content/lessons has "${slug}" which is not in content/curriculum.ts`);
}

const prose = readFileSync(join('docs', 'CURRICULUM.md'), 'utf8');
for (const slug of curriculumSlugs) {
  if (!prose.includes(slug)) err(`docs/CURRICULUM.md does not mention "${slug}"`);
}

// ── Per-lesson validation ───────────────────────────────────────────────────

const loaded = new Map<string, LessonType>();

for (const file of files) {
  const slug = slugFromFile(file);
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (!mod.default) {
    err(`${file}: no default export`);
    statuses.set(slug, { status: 'Drafting', note: 'no default export' });
    continue;
  }

  const result = Lesson.safeParse(mod.default);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`);
    err(`${slug}: ${issues.join(' | ')}${result.error.issues.length > 6 ? ` (+${result.error.issues.length - 6} more)` : ''}`);
    statuses.set(slug, { status: 'Drafting', note: `${result.error.issues.length} schema issue(s)` });
    continue;
  }

  const lesson = result.data;
  loaded.set(slug, lesson);
  const problems: string[] = [];

  if (lesson.slug !== slug) problems.push(`slug "${lesson.slug}" does not match filename "${slug}"`);
  if (lesson.phase !== phaseOf(slug)) problems.push(`phase "${lesson.phase}" disagrees with curriculum "${phaseOf(slug)}"`);
  if (lesson.module !== moduleOf(slug)) problems.push(`module "${lesson.module}" disagrees with curriculum "${moduleOf(slug)}"`);

  const expectedPosition = lessonOrder.indexOf(slug) + 1;
  if (lesson.position !== expectedPosition) problems.push(`position ${lesson.position} should be ${expectedPosition}`);

  for (const p of lesson.prerequisites) {
    if (!curriculumSlugs.has(p)) problems.push(`unknown prerequisite "${p}"`);
    else if (lessonOrder.indexOf(p) >= expectedPosition - 1) problems.push(`prerequisite "${p}" comes later in the curriculum`);
  }

  const unresolved = lesson.resources.filter((r) => !resourcesByKey.has(r.key));
  const unverified = lesson.resources.filter((r) => resourcesByKey.get(r.key)?.verified === false);

  for (const r of unresolved) problems.push(`resource key "${r.key}" is not in docs/resources.yaml`);
  for (const r of unverified) problems.push(`resource key "${r.key}" is not verified`);

  if (problems.length) {
    for (const p of problems) err(`${slug}: ${p}`);
    statuses.set(slug, { status: 'Drafting', note: problems[0] });
    continue;
  }

  if (lesson.resources.length === 0) {
    statuses.set(slug, { status: 'Reviewed', note: 'no references attached yet' });
  } else {
    statuses.set(slug, { status: 'Complete', note: '' });
  }
}

for (const slug of curriculumSlugs) {
  if (!statuses.has(slug)) statuses.set(slug, { status: 'Planned', note: 'not authored' });
}

// ── Dependency graph must be a DAG ──────────────────────────────────────────

{
  const seen = new Map<string, number>(); // 0 = visiting, 1 = done
  const visit = (slug: string, trail: string[]): void => {
    const state = seen.get(slug);
    if (state === 1) return;
    if (state === 0) {
      err(`prerequisite cycle: ${[...trail, slug].join(' → ')}`);
      return;
    }
    seen.set(slug, 0);
    for (const p of loaded.get(slug)?.prerequisites ?? []) visit(p, [...trail, slug]);
    seen.set(slug, 1);
  };
  for (const slug of loaded.keys()) visit(slug, []);
}

// ── Cross-lesson uniqueness of ids that become primary keys ─────────────────

{
  const seen = new Map<string, string>();
  for (const [slug, lesson] of loaded) {
    const ids = [
      ...lesson.flashcards.map((f) => `flashcard:${f.id}`),
      ...lesson.quiz.map((q) => `quiz:${q.id}`),
      ...lesson.exercises.map((e) => `exercise:${e.id}`),
      ...lesson.interviewQuestions.map((q) => `iq:${q.id}`),
    ];
    for (const id of ids) {
      const owner = seen.get(id);
      if (owner) err(`id "${id}" is used by both ${owner} and ${slug}`);
      else seen.set(id, slug);
    }
  }
}

// ── Unused resource keys are dead weight, not an error ──────────────────────

const usedKeys = new Set([...loaded.values()].flatMap((l) => l.resources.map((r) => r.key)));
const unused = [...resourcesByKey.keys()].filter((k) => !usedKeys.has(k));

// ── docs/CONTENT_STATUS.md ──────────────────────────────────────────────────

const counts: Record<Status, number> = { Planned: 0, Drafting: 0, Reviewed: 0, Complete: 0 };
for (const { status } of statuses.values()) counts[status] += 1;

const rows: string[] = [];
for (const phase of curriculum.phases) {
  rows.push(`\n### ${phase.title} · weeks ${phase.weeks}\n`);
  rows.push('| # | Lesson | Status | Note |');
  rows.push('| --- | --- | --- | --- |');
  for (const mod of phase.modules) {
    for (const slug of mod.lessons) {
      const s = statuses.get(slug)!;
      const n = lessonOrder.indexOf(slug) + 1;
      const title = loaded.get(slug)?.title ?? '—';
      rows.push(`| ${n} | \`${slug}\` — ${title} | ${s.status} | ${s.note} |`);
    }
  }
}

writeFileSync(
  join('docs', 'CONTENT_STATUS.md'),
  `# Content Status

Generated by \`npm run content:validate\`. Do not edit by hand — status is
derived from the content itself, never asserted.

**${counts.Complete} Complete · ${counts.Reviewed} Reviewed · ${counts.Drafting} Drafting · ${counts.Planned} Planned** of ${statuses.size} lessons.

## What each status means

| Status | Mechanical criterion |
| --- | --- |
| Planned | No file in \`content/lessons/\`. |
| Drafting | A file exists but fails \`content/schema.ts\` or a cross-check (slug, phase, position, prerequisite, resource key). |
| Reviewed | Passes every schema and cross-check, but has no verified references attached. |
| Complete | Passes every check **and** every attached resource key resolves to a \`verified: true\` entry in \`docs/resources.yaml\`. |

"Complete" is the criterion referenced by the V1 Definition of Done in
\`docs/MILESTONES.md\`.
${rows.join('\n')}

## Resource allowlist

${resourcesByKey.size} resources, ${usedKeys.size} referenced by at least one lesson.
${unused.length ? `\nNot yet referenced: ${unused.map((k) => `\`${k}\``).join(', ')}` : ''}
`,
);

// ── Report ──────────────────────────────────────────────────────────────────

console.log(
  `Content: ${counts.Complete} complete, ${counts.Reviewed} reviewed, ${counts.Drafting} drafting, ${counts.Planned} planned (of ${statuses.size}).`,
);
console.log(`Resources: ${resourcesByKey.size} allowlisted, ${usedKeys.size} referenced.`);

if (errors.length) {
  console.error(`\n${errors.length} content error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('Content validation passed.');
