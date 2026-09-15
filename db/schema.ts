import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * The single Drizzle schema. PostgreSQL only — identical against local Docker
 * Postgres and production Neon. See docs/SCHEMA.md for the reasoning behind
 * each table, and which tables are derived from content/ versus owned by the
 * learner.
 */

// ── Curriculum projection (derived from content/, rebuilt by db:seed) ───────

export const phases = pgTable('phases', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
  summary: text('summary').notNull(),
  outcome: text('outcome').notNull(),
  weeks: text('weeks').notNull(),
});

export const modules = pgTable(
  'modules',
  {
    id: text('id').primaryKey(),
    phaseId: text('phase_id')
      .notNull()
      .references(() => phases.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('modules_phase_pos_idx').on(t.phaseId, t.position)],
);

export const lessons = pgTable(
  'lessons',
  {
    id: text('id').primaryKey(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    // Denormalised for dashboard queries. Owner: scripts/seed.ts.
    phaseId: text('phase_id')
      .notNull()
      .references(() => phases.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    difficulty: text('difficulty').notNull(),
    estimatedMinutes: integer('estimated_minutes').notNull(),
    tags: text('tags').array().notNull().default([]),
    prerequisites: text('prerequisites').array().notNull().default([]),
  },
  (t) => [
    index('lessons_position_idx').on(t.position),
    index('lessons_phase_pos_idx').on(t.phaseId, t.position),
  ],
);

export const flashcards = pgTable(
  'flashcards',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    front: text('front').notNull(),
    back: text('back').notNull(),
    topic: text('topic').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('flashcards_lesson_idx').on(t.lessonId)],
);

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<Array<{ id: string; label: string }>>().notNull(),
    correct: text('correct').array().notNull(),
    explanation: text('explanation').notNull(),
    difficulty: text('difficulty').notNull(),
    topic: text('topic').notNull(),
  },
  (t) => [index('quiz_lesson_pos_idx').on(t.lessonId, t.position)],
);

export const exercises = pgTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    rubric: text('rubric').array().notNull(),
    modelAnswer: text('model_answer').notNull(),
    estimatedMinutes: integer('estimated_minutes').notNull(),
  },
  (t) => [index('exercises_lesson_idx').on(t.lessonId)],
);

export const interviewQuestions = pgTable(
  'interview_questions',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    level: text('level').notNull(),
    question: text('question').notNull(),
    guidance: text('guidance').notNull(),
  },
  (t) => [index('iq_lesson_idx').on(t.lessonId)],
);

export const resources = pgTable('resources', {
  key: text('key').primaryKey(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  section: text('section'),
  publisher: text('publisher').notNull(),
  url: text('url').notNull(),
  verified: boolean('verified').notNull().default(false),
  verifiedAt: date('verified_at'),
  topics: text('topics').array().notNull().default([]),
});

// ── Learner state ───────────────────────────────────────────────────────────

export const learners = pgTable(
  'learners',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    // Nullable so the legacy/dev "local" row and any pre-auth data remain valid;
    // every account created through signup carries both. Email is unique among
    // the rows that have one (Postgres treats NULLs as distinct).
    email: text('email'),
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('learners_email_idx').on(t.email)],
);

/**
 * Database-backed sessions. The cookie holds an opaque random token; only its
 * SHA-256 hash is stored here as the primary key, so a database leak yields no
 * usable session. Expired rows are ignored on read and swept opportunistically.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256(token)
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_learner_idx').on(t.learnerId), index('sessions_expiry_idx').on(t.expiresAt)],
);

export const userSettings = pgTable('user_settings', {
  learnerId: text('learner_id')
    .primaryKey()
    .references(() => learners.id, { onDelete: 'cascade' }),
  startDate: date('start_date').notNull(),
  targetWeeks: integer('target_weeks').notNull().default(14),
  dailyGoalMinutes: integer('daily_goal_minutes').notNull().default(70),
  studyDays: text('study_days').array().notNull().default(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']),
  theme: text('theme').notNull().default('system'),
  unlockMode: text('unlock_mode').notNull().default('strict'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const lessonProgress = pgTable(
  'lesson_progress',
  {
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('not_started'),
    sectionsSeen: text('sections_seen').array().notNull().default([]),
    timeSpentSeconds: integer('time_spent_seconds').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.lessonId] }),
    index('lesson_progress_status_idx').on(t.learnerId, t.status),
  ],
);

/**
 * Minutes studied per local day. lesson_progress.time_spent_seconds is a
 * lifetime total per lesson and cannot answer "how long did I study today",
 * which is the number the daily goal and the recommender both need.
 */
export const studyDays = pgTable(
  'study_days',
  {
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    seconds: integer('seconds').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.day] })],
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    score: integer('score').notNull().default(0),
    total: integer('total').notNull().default(0),
    answers: jsonb('answers')
      .$type<Array<{ questionId: string; chosen: string[]; correct: boolean; topic: string; scenario: boolean }>>()
      .notNull()
      .default([]),
  },
  (t) => [index('quiz_attempts_lesson_idx').on(t.learnerId, t.lessonId, t.completedAt)],
);

export const flashcardProgress = pgTable(
  'flashcard_progress',
  {
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    flashcardId: text('flashcard_id')
      .notNull()
      .references(() => flashcards.id, { onDelete: 'cascade' }),
    ease: real('ease').notNull().default(2.5),
    intervalDays: integer('interval_days').notNull().default(0),
    repetitions: integer('repetitions').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    lastGrade: integer('last_grade'),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.flashcardId] }),
    index('flashcard_due_idx').on(t.learnerId, t.dueAt),
  ],
);

export const exerciseAttempts = pgTable(
  'exercise_attempts',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    response: text('response').notNull(),
    selfRating: integer('self_rating'),
    rubricHits: text('rubric_hits').array().notNull().default([]),
    aiFeedback: jsonb('ai_feedback').$type<Record<string, unknown> | null>(),
  },
  (t) => [index('exercise_attempts_idx').on(t.learnerId, t.exerciseId)],
);

export const reviewItems = pgTable(
  'review_items',
  {
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    intervalDays: integer('interval_days').notNull().default(1),
    ease: real('ease').notNull().default(2.5),
    reason: text('reason').notNull(),
    priority: integer('priority').notNull().default(0),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.lessonId] }),
    index('review_due_idx').on(t.learnerId, t.dueAt, t.priority),
  ],
);

export const topicMastery = pgTable(
  'topic_mastery',
  {
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    score: real('score').notNull().default(0),
    confidence: real('confidence').notNull().default(0),
    // Per-source contributions, so the UI can explain the number.
    signals: jsonb('signals').$type<Record<string, number>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.topic] })],
);

export const xpEvents = pgTable(
  'xp_events',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    amount: integer('amount').notNull(),
    ref: text('ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('xp_learner_time_idx').on(t.learnerId, t.createdAt)],
);

export const achievements = pgTable(
  'achievements',
  {
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.code] })],
);

export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id').references(() => lessons.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notes_lesson_idx').on(t.learnerId, t.lessonId)],
);

// ── Interview simulator ─────────────────────────────────────────────────────

export const mockInterviews = pgTable(
  'mock_interviews',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    problemKey: text('problem_key').notNull(),
    companyStyle: text('company_style'),
    difficulty: text('difficulty').notNull().default('core'),
    status: text('status').notNull().default('active'),
    phase: text('phase').notNull().default('clarify'),
    hintsUsed: integer('hints_used').notNull().default(0),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    timeBudgetSeconds: integer('time_budget_seconds').notNull().default(2700),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('mock_learner_started_idx').on(t.learnerId, t.startedAt)],
);

export const mockInterviewMessages = pgTable(
  'mock_interview_messages',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id')
      .notNull()
      .references(() => mockInterviews.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mock_msg_pos_idx').on(t.interviewId, t.position)],
);

export const mockInterviewEvaluations = pgTable('mock_interview_evaluations', {
  id: text('id').primaryKey(),
  interviewId: text('interview_id')
    .notNull()
    .unique()
    .references(() => mockInterviews.id, { onDelete: 'cascade' }),
  overallScore: integer('overall_score').notNull(),
  rubric: jsonb('rubric')
    .$type<Array<{ criterion: string; score: number; max: number; evidence: string; improvement: string }>>()
    .notNull(),
  strengths: text('strengths').array().notNull().default([]),
  weaknesses: text('weaknesses').array().notNull().default([]),
  missedConcepts: text('missed_concepts').array().notNull().default([]),
  recommendedLessons: text('recommended_lessons').array().notNull().default([]),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
