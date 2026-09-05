import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { eq, inArray, notInArray, sql } from 'drizzle-orm';
import { loadEnv } from './env';
import { curriculum, lessonOrder } from '../content/curriculum';
import { Lesson, ResourceFile } from '../content/schema';
import { findLessonFiles, slugFromFile } from './build-content-index';

loadEnv();

const { getDb, getPool, schema } = await import('../db/client');
const db = getDb();

const DEMO = process.argv.includes('--demo');
const LEARNER = 'local';

/**
 * Projects content/ into the curriculum tables and ensures the single local
 * learner exists. Idempotent: upsert by natural key, then delete rows whose
 * content-side id has disappeared (docs/SCHEMA.md -> Curriculum projection).
 */
async function seedCurriculum() {
  const files = findLessonFiles();
  const lessons = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as { default: unknown };
    const parsed = Lesson.safeParse(mod.default);
    if (!parsed.success) {
      throw new Error(`${slugFromFile(file)} failed validation; run npm run content:validate`);
    }
    lessons.push(parsed.data);
  }
  lessons.sort((a, b) => a.position - b.position);

  const phaseRows = curriculum.phases.map((p, i) => ({
    id: p.id,
    slug: p.id,
    title: p.title,
    position: i + 1,
    summary: p.summary,
    outcome: p.outcome,
    weeks: p.weeks,
  }));
  await db
    .insert(schema.phases)
    .values(phaseRows)
    .onConflictDoUpdate({
      target: schema.phases.id,
      set: {
        title: sql`excluded.title`,
        position: sql`excluded.position`,
        summary: sql`excluded.summary`,
        outcome: sql`excluded.outcome`,
        weeks: sql`excluded.weeks`,
      },
    });

  const moduleRows = curriculum.phases.flatMap((p, pi) =>
    p.modules.map((m, mi) => ({
      id: `${p.id}/${m.id}`,
      phaseId: p.id,
      slug: m.id,
      title: m.title,
      summary: m.summary,
      position: pi * 100 + mi + 1,
    })),
  );
  await db
    .insert(schema.modules)
    .values(moduleRows)
    .onConflictDoUpdate({
      target: schema.modules.id,
      set: {
        phaseId: sql`excluded.phase_id`,
        title: sql`excluded.title`,
        summary: sql`excluded.summary`,
        position: sql`excluded.position`,
      },
    });

  if (lessons.length) {
    await db
      .insert(schema.lessons)
      .values(
        lessons.map((l) => ({
          id: l.slug,
          moduleId: `${l.phase}/${l.module}`,
          phaseId: l.phase,
          slug: l.slug,
          title: l.title,
          summary: l.summary,
          position: l.position,
          kind: l.kind,
          difficulty: l.difficulty,
          estimatedMinutes: l.estimatedMinutes,
          tags: l.tags,
          prerequisites: l.prerequisites,
        })),
      )
      .onConflictDoUpdate({
        target: schema.lessons.id,
        set: {
          moduleId: sql`excluded.module_id`,
          phaseId: sql`excluded.phase_id`,
          title: sql`excluded.title`,
          summary: sql`excluded.summary`,
          position: sql`excluded.position`,
          kind: sql`excluded.kind`,
          difficulty: sql`excluded.difficulty`,
          estimatedMinutes: sql`excluded.estimated_minutes`,
          tags: sql`excluded.tags`,
          prerequisites: sql`excluded.prerequisites`,
        },
      });
  }

  // Children are content-derived. Upsert rather than delete-all so that
  // flashcard review history is not cascaded away on every seed; then remove
  // only the ids that no longer exist in content/.
  const cards = lessons.flatMap((l) =>
    l.flashcards.map((f, i) => ({ ...f, lessonId: l.slug, position: i + 1 })),
  );
  if (cards.length) {
    await db
      .insert(schema.flashcards)
      .values(
        cards.map((c) => ({
          id: c.id,
          lessonId: c.lessonId,
          front: c.front,
          back: c.back,
          topic: c.topic,
          position: c.position,
        })),
      )
      .onConflictDoUpdate({
        target: schema.flashcards.id,
        set: {
          front: sql`excluded.front`,
          back: sql`excluded.back`,
          topic: sql`excluded.topic`,
          position: sql`excluded.position`,
          lessonId: sql`excluded.lesson_id`,
        },
      });
    await db.delete(schema.flashcards).where(
      notInArray(
        schema.flashcards.id,
        cards.map((c) => c.id),
      ),
    );
  }

  const questions = lessons.flatMap((l) =>
    l.quiz.map((q, i) => ({ ...q, lessonId: l.slug, position: i + 1 })),
  );
  if (questions.length) {
    await db
      .insert(schema.quizQuestions)
      .values(
        questions.map((q) => ({
          id: q.id,
          lessonId: q.lessonId,
          position: q.position,
          kind: q.kind,
          prompt: q.prompt,
          options: q.options,
          correct: q.correct,
          explanation: q.explanation,
          difficulty: q.difficulty,
          topic: q.topic,
        })),
      )
      .onConflictDoUpdate({
        target: schema.quizQuestions.id,
        set: {
          lessonId: sql`excluded.lesson_id`,
          position: sql`excluded.position`,
          kind: sql`excluded.kind`,
          prompt: sql`excluded.prompt`,
          options: sql`excluded.options`,
          correct: sql`excluded.correct`,
          explanation: sql`excluded.explanation`,
          difficulty: sql`excluded.difficulty`,
          topic: sql`excluded.topic`,
        },
      });
    await db.delete(schema.quizQuestions).where(
      notInArray(
        schema.quizQuestions.id,
        questions.map((q) => q.id),
      ),
    );
  }

  const exs = lessons.flatMap((l) =>
    l.exercises.map((e, i) => ({ ...e, lessonId: l.slug, position: i + 1 })),
  );
  if (exs.length) {
    await db
      .insert(schema.exercises)
      .values(
        exs.map((e) => ({
          id: e.id,
          lessonId: e.lessonId,
          position: e.position,
          kind: e.kind,
          title: e.title,
          prompt: e.prompt,
          rubric: e.rubric,
          modelAnswer: e.modelAnswer,
          estimatedMinutes: e.estimatedMinutes,
        })),
      )
      .onConflictDoUpdate({
        target: schema.exercises.id,
        set: {
          lessonId: sql`excluded.lesson_id`,
          position: sql`excluded.position`,
          kind: sql`excluded.kind`,
          title: sql`excluded.title`,
          prompt: sql`excluded.prompt`,
          rubric: sql`excluded.rubric`,
          modelAnswer: sql`excluded.model_answer`,
          estimatedMinutes: sql`excluded.estimated_minutes`,
        },
      });
    await db.delete(schema.exercises).where(
      notInArray(
        schema.exercises.id,
        exs.map((e) => e.id),
      ),
    );
  }

  const iqs = lessons.flatMap((l) =>
    l.interviewQuestions.map((q, i) => ({ ...q, lessonId: l.slug, position: i + 1 })),
  );
  if (iqs.length) {
    await db
      .insert(schema.interviewQuestions)
      .values(
        iqs.map((q) => ({
          id: q.id,
          lessonId: q.lessonId,
          position: q.position,
          level: q.level,
          question: q.question,
          guidance: q.guidance,
        })),
      )
      .onConflictDoUpdate({
        target: schema.interviewQuestions.id,
        set: {
          lessonId: sql`excluded.lesson_id`,
          position: sql`excluded.position`,
          level: sql`excluded.level`,
          question: sql`excluded.question`,
          guidance: sql`excluded.guidance`,
        },
      });
    await db.delete(schema.interviewQuestions).where(
      notInArray(
        schema.interviewQuestions.id,
        iqs.map((q) => q.id),
      ),
    );
  }

  // Lessons removed from content/ entirely.
  if (lessons.length) {
    await db.delete(schema.lessons).where(
      notInArray(
        schema.lessons.id,
        lessons.map((l) => l.slug),
      ),
    );
  }

  return lessons;
}

async function seedResources() {
  const parsed = ResourceFile.parse(parse(readFileSync(join('docs', 'resources.yaml'), 'utf8')));
  await db
    .insert(schema.resources)
    .values(
      parsed.resources.map((r) => ({
        key: r.key,
        type: r.type,
        title: r.title,
        section: r.section ?? null,
        publisher: r.publisher,
        url: r.url,
        verified: r.verified,
        verifiedAt: r.verifiedAt,
        topics: r.topics,
      })),
    )
    .onConflictDoUpdate({
      target: schema.resources.key,
      set: {
        type: sql`excluded.type`,
        title: sql`excluded.title`,
        section: sql`excluded.section`,
        publisher: sql`excluded.publisher`,
        url: sql`excluded.url`,
        verified: sql`excluded.verified`,
        verifiedAt: sql`excluded.verified_at`,
        topics: sql`excluded.topics`,
      },
    });
  await db.delete(schema.resources).where(
    notInArray(
      schema.resources.key,
      parsed.resources.map((r) => r.key),
    ),
  );
  return parsed.resources.length;
}

async function seedLearner() {
  await db.insert(schema.learners).values({ id: LEARNER, displayName: 'Learner' }).onConflictDoNothing();
  await db
    .insert(schema.userSettings)
    .values({ learnerId: LEARNER, startDate: new Date().toISOString().slice(0, 10) })
    .onConflictDoNothing();
}

/**
 * Realistic simulated progress, used to prove the dashboard works against a
 * populated database (V1 DoD item 12). Deterministic so E2E can assert on it.
 */
async function seedDemoProgress(authored: string[]) {
  await db.delete(schema.xpEvents).where(eq(schema.xpEvents.learnerId, LEARNER));
  await db.delete(schema.quizAttempts).where(eq(schema.quizAttempts.learnerId, LEARNER));
  await db.delete(schema.lessonProgress).where(eq(schema.lessonProgress.learnerId, LEARNER));
  await db.delete(schema.reviewItems).where(eq(schema.reviewItems.learnerId, LEARNER));

  const inOrder = lessonOrder.filter((s) => authored.includes(s));
  const completed = inOrder.slice(0, Math.ceil(inOrder.length * 0.55));
  const inProgress = inOrder.slice(completed.length, completed.length + 1);
  const now = Date.now();
  const day = 86_400_000;

  if (completed.length) {
    await db.insert(schema.lessonProgress).values(
      completed.map((slug, i) => ({
        learnerId: LEARNER,
        lessonId: slug,
        status: 'completed',
        sectionsSeen: [
          'intuition',
          'deep',
          'visual',
          'production',
          'tradeoffs',
          'mistakes',
          'quiz',
          'exercise',
          'revision',
          'cheatsheet',
        ],
        timeSpentSeconds: 1800 + (i % 7) * 300,
        startedAt: new Date(now - (completed.length - i) * day),
        completedAt: new Date(now - (completed.length - i) * day + 3600_000),
        lastViewedAt: new Date(now - (completed.length - i) * day + 3600_000),
      })),
    );
  }

  if (inProgress.length) {
    await db.insert(schema.lessonProgress).values(
      inProgress.map((slug) => ({
        learnerId: LEARNER,
        lessonId: slug,
        status: 'in_progress',
        sectionsSeen: ['intuition', 'deep'],
        timeSpentSeconds: 600,
        startedAt: new Date(now - day),
        lastViewedAt: new Date(now - 3600_000),
      })),
    );
  }

  const scope = completed.length ? completed : ['__none__'];

  const cards = await db.select().from(schema.flashcards).where(inArray(schema.flashcards.lessonId, scope));
  if (cards.length) {
    await db
      .insert(schema.flashcardProgress)
      .values(
        cards.map((c, i) => ({
          learnerId: LEARNER,
          flashcardId: c.id,
          ease: 2.5 - (i % 4) * 0.15,
          intervalDays: [1, 3, 7, 14][i % 4],
          repetitions: (i % 4) + 1,
          lapses: i % 5 === 0 ? 1 : 0,
          // A third of the deck is due now, so the review queue is non-empty.
          dueAt: new Date(now + (i % 3 === 0 ? -day : (i % 7) * day)),
          lastGrade: i % 5 === 0 ? 2 : 4,
          lastReviewedAt: new Date(now - (i % 9) * day),
        })),
      )
      .onConflictDoNothing();
  }

  const questions = await db
    .select()
    .from(schema.quizQuestions)
    .where(inArray(schema.quizQuestions.lessonId, scope));
  const byLesson = new Map<string, typeof questions>();
  for (const q of questions) {
    const list = byLesson.get(q.lessonId) ?? [];
    list.push(q);
    byLesson.set(q.lessonId, list);
  }

  const attempts = [...byLesson.entries()].map(([lessonId, qs], i) => {
    // A deterministic weak streak, so the dashboard has something to recommend.
    const wrongCount = i % 4 === 0 ? Math.min(2, qs.length) : 0;
    return {
      id: randomUUID(),
      learnerId: LEARNER,
      lessonId,
      startedAt: new Date(now - (byLesson.size - i) * day),
      completedAt: new Date(now - (byLesson.size - i) * day + 600_000),
      score: qs.length - wrongCount,
      total: qs.length,
      answers: qs.map((q, qi) => ({
        questionId: q.id,
        chosen: qi < wrongCount ? [q.options[0]?.id ?? ''] : q.correct,
        correct: qi >= wrongCount,
        topic: q.topic,
        scenario: q.kind === 'scenario',
      })),
    };
  });
  if (attempts.length) await db.insert(schema.quizAttempts).values(attempts);

  const weak = attempts.filter((a) => a.score < a.total).map((a) => a.lessonId);
  if (weak.length) {
    await db
      .insert(schema.reviewItems)
      .values(
        weak.map((lessonId, i) => ({
          learnerId: LEARNER,
          lessonId,
          dueAt: new Date(now - (i % 2) * day),
          intervalDays: 1,
          reason: 'quiz_miss',
          priority: 10 - i,
        })),
      )
      .onConflictDoNothing();
  }

  if (completed.length) {
    await db.insert(schema.xpEvents).values(
      completed.flatMap((slug, i) => [
        {
          id: randomUUID(),
          learnerId: LEARNER,
          kind: 'lesson_complete',
          amount: 40,
          ref: slug,
          createdAt: new Date(now - (completed.length - i) * day),
        },
        {
          id: randomUUID(),
          learnerId: LEARNER,
          kind: 'quiz_pass',
          amount: 25,
          ref: slug,
          createdAt: new Date(now - (completed.length - i) * day),
        },
      ]),
    );
  }

  return { completed: completed.length, inProgress: inProgress.length, attempts: attempts.length };
}

async function main() {
  const lessons = await seedCurriculum();
  const resourceCount = await seedResources();
  await seedLearner();
  console.log(
    `Seeded ${curriculum.phases.length} phases, ${lessons.length} lessons, ${resourceCount} resources.`,
  );

  if (DEMO) {
    const stats = await seedDemoProgress(lessons.map((l) => l.slug));
    console.log(
      `Demo progress: ${stats.completed} completed, ${stats.inProgress} in progress, ${stats.attempts} quiz attempts.`,
    );
  }

  await getPool().end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
