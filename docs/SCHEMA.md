# Database Schema

PostgreSQL only. One dialect, one Drizzle schema (`db/schema.ts`), one migration
system (`drizzle-kit` → `db/migrations/`), one driver (`pg` via
`drizzle-orm/node-postgres`). Local Docker Postgres and production Neon run the
identical schema; only `DATABASE_URL` differs.

## Two kinds of tables

**Curriculum projection** — `phases`, `modules`, `lessons`, `flashcards`,
`quiz_questions`, `exercises`, `interview_questions`, `resources`. These are
*derived* from `content/`. `npm run db:seed` reads the content modules and
upserts them. The files are the source of truth; the tables exist so that
progress rows can have real foreign keys and so the dashboard, revision queue
and search can be answered with SQL instead of loading 89 content modules.

Seeding is idempotent: it upserts by natural key and deletes rows whose
content-side id has disappeared.

**Learner state** — everything else. Never derived, never regenerated.

## Identity in V1

There is no authentication. A single row in `learners` with
`id = 'local'` owns all progress (`docs/PRODUCT.md` → Privacy model). Every
learner-state table still carries `learner_id` so that adding auth in V2 is a
data migration, not a schema rewrite.

---

## Curriculum projection

### `phases`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `text` PK | e.g. `phase-foundations` |
| `slug` | `text` unique | |
| `title` | `text` | |
| `position` | `integer` | ordering within the curriculum |
| `summary` | `text` | |
| `outcome` | `text` | what the learner can do after this phase |

### `modules`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `text` PK | |
| `phase_id` | `text` → `phases.id` cascade | |
| `slug`, `title`, `summary` | `text` | |
| `position` | `integer` | |

### `lessons`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `text` PK | equals the slug |
| `module_id` | `text` → `modules.id` cascade | |
| `slug` | `text` unique | |
| `title`, `summary` | `text` | |
| `position` | `integer` | global ordering |
| `kind` | `text` | `concept` \| `system-design` \| `machine-coding` \| `method` |
| `difficulty` | `text` | `intro` \| `core` \| `advanced` |
| `estimated_minutes` | `integer` | |
| `tags` | `text[]` | topic keys used by the mastery model |
| `prerequisites` | `text[]` | lesson slugs |
| `phase_id` | `text` | denormalised for dashboard queries; owner is the seeder |

`phase_id` on `lessons` is a deliberate denormalisation. Owner: `scripts/seed.ts`.
Rebuild path: re-run `db:seed`. Staleness budget: zero (single writer).

### `flashcards`
`id` PK · `lesson_id` FK cascade · `front` · `back` · `topic` · `position`

### `quiz_questions`
`id` PK · `lesson_id` FK cascade · `position` · `kind` (`single` \| `multi` \|
`scenario`) · `prompt` · `options jsonb` (`{id,label}[]`) · `correct text[]` ·
`explanation` · `difficulty` · `topic`

### `exercises`
`id` PK · `lesson_id` FK cascade · `position` · `kind` (`design` \| `modify` \|
`debug` \| `estimate` \| `implement` \| `explain`) · `title` · `prompt` ·
`rubric text[]` · `model_answer` (hidden until submission)

### `interview_questions`
`id` PK · `lesson_id` FK cascade · `position` · `level` (`basic` \|
`intermediate` \| `advanced` \| `followup`) · `question` · `guidance`

### `resources`
`key` PK · `type` · `title` · `url` · `publisher` · `verified boolean` ·
`verified_at timestamptz` · `topics text[]`

Seeded from `docs/resources.yaml`, which remains the allowlist of record.

---

## Learner state

### `learners`
`id text` PK (`local`) · `display_name` · `created_at`

### `user_settings`
`learner_id` PK FK · `start_date date` · `target_weeks integer` (default 14) ·
`daily_goal_minutes integer` (default 70) · `study_days text[]` ·
`theme text` · `unlock_mode text` (`strict` \| `free`) ·
`ai_provider text` · `updated_at`

### `lesson_progress`
PK (`learner_id`, `lesson_id`)

| Column | Type | Notes |
| --- | --- | --- |
| `status` | `text` | `not_started` \| `in_progress` \| `completed` |
| `sections_seen` | `text[]` | section ids the learner actually opened |
| `time_spent_seconds` | `integer` | |
| `started_at`, `completed_at`, `last_viewed_at` | `timestamptz` | |

Completion requires more than opening the page — see `lib/learning/mastery.ts`:
a lesson becomes `completed` when all sections are seen **and** a quiz attempt
exists with ≥ 70 %.

### `quiz_attempts`
`id` PK · `learner_id` · `lesson_id` · `started_at` · `completed_at` ·
`score integer` · `total integer` · `answers jsonb` (`{questionId, chosen[],
correct boolean, topic}[]`)

Attempts are append-only. History is the signal for the mastery model.

### `flashcard_progress`
PK (`learner_id`, `flashcard_id`) — SM-2 state.

`ease real` (default 2.5) · `interval_days integer` · `repetitions integer` ·
`lapses integer` · `due_at timestamptz` · `last_grade integer` (0–5) ·
`last_reviewed_at`

### `exercise_attempts`
`id` PK · `learner_id` · `exercise_id` · `submitted_at` · `response text` ·
`self_rating integer` (1–5) · `rubric_hits text[]` · `ai_feedback jsonb` (nullable)

### `review_items`
Lesson-level spaced repetition, distinct from flashcards.

PK (`learner_id`, `lesson_id`) · `due_at` · `interval_days` · `ease` ·
`reason text` (`quiz_miss` \| `flashcard_lapse` \| `interview_gap` \| `decay`) ·
`priority integer` · `last_reviewed_at`

### `topic_mastery`
PK (`learner_id`, `topic`)

`score real` (0–1) · `confidence real` · `signals jsonb` (the per-source
contributions, so the UI can explain the number) · `updated_at`

### `xp_events`
`id` PK · `learner_id` · `kind` · `amount integer` · `ref text` · `created_at`

Append-only. Total XP, level and streak are derived, never stored as mutable
counters.

### `achievements`
PK (`learner_id`, `code`) · `unlocked_at` · `meta jsonb`

### `notes`
`id` PK · `learner_id` · `lesson_id` (nullable) · `body text` · `created_at` ·
`updated_at`

### `mock_interviews`
`id` PK · `learner_id` · `mode` (`hld` \| `lld` \| `backend` \| `distributed` \|
`ai` \| `boss`) · `problem_key text` · `company_style text` (nullable) ·
`difficulty text` · `status` (`active` \| `evaluating` \| `complete` \|
`abandoned`) · `phase text` (current interview stage) · `hints_used integer` ·
`duration_seconds integer` · `started_at` · `ended_at`

### `mock_interview_messages`
`id` PK · `interview_id` FK cascade · `position integer` · `role`
(`interviewer` \| `candidate` \| `system`) · `content text` ·
`meta jsonb` (hint flag, phase, token usage) · `created_at`

### `mock_interview_evaluations`
`id` PK · `interview_id` FK unique cascade · `overall_score integer` (0–100) ·
`rubric jsonb` (per-criterion `{score, max, evidence, improvement}`) ·
`strengths text[]` · `weaknesses text[]` · `missed_concepts text[]` ·
`recommended_lessons text[]` · `summary text` · `created_at`

`recommended_lessons` holds lesson slugs, which the revision queue converts into
`review_items`. This is the loop that makes a bad interview change tomorrow's
study plan.

---

## Indexes

| Index | Reason |
| --- | --- |
| `lessons(position)` | curriculum ordering |
| `lessons(phase_id, position)` | phase pages, dashboard progress bars |
| `quiz_questions(lesson_id, position)` | quiz load |
| `flashcards(lesson_id)` | seeding a lesson's cards |
| `flashcard_progress(learner_id, due_at)` | the daily review query |
| `review_items(learner_id, due_at, priority desc)` | the daily review query |
| `quiz_attempts(learner_id, lesson_id, completed_at desc)` | mastery signals |
| `xp_events(learner_id, created_at)` | streak and level derivation |
| `mock_interview_messages(interview_id, position)` | transcript load |

## Migration policy

- `npm run db:generate` writes SQL to `db/migrations/`. Migrations are committed.
- `npm run db:migrate` applies them with Drizzle's `migrate()` over a `pg` pool.
- Migrations must apply cleanly to an empty database. `tests/unit/migrations`
  and the Playwright global setup both exercise this.
- No destructive edit to an existing migration file; add a new one.

## Frozen after milestone 2

Once milestone 2 passes, the table set and column semantics above are frozen in
`docs/STATE.md`. Additive migrations remain allowed; renames and redesigns do not.
