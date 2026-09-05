# Execution State

Read this first. Resume from `NEXT`. Never revisit anything under Frozen
decisions.

    LAST_COMPLETED: 5
    NEXT: 7
    STATUS: clean

Milestone 6 (spaced repetition and revision) was completed inside M5's work:
the SM-2 scheduler, `review_items` generation from quiz misses and flashcard
lapses, and the review queue with per-item reasons are all implemented and
tested. Milestone 4 (progress and dashboard) and part of M12–M14 (mastery, XP,
recommender, interview simulator with scripted provider) also landed early
because the canonical lesson needed the full player, and the player needed the
progress and completion rules to be real rather than stubbed.

## Gate results (last run)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 93 unit tests, 5 files |
| `npm run test:e2e` | PASS — 11 Playwright tests |
| `npm run build` | PASS |
| `npm run content:validate` | PASS — 1 complete, 88 planned |
| `npm run db:migrate` (twice, from empty) | PASS |

## Frozen decisions — DO NOT REVISIT

Append-only. Each entry is settled.

1. **Curriculum size and shape.** 89 lessons, 5 phases, 14 weeks. Phase counts:
   foundations 18, distributed 19, hld 18, lld 14, ai 20. `content/curriculum.ts`
   is the machine source; `docs/CURRICULUM.md` is the prose version and the
   validator fails if a slug appears in one and not the other.
2. **Content model.** `content/schema.ts` — twelve required sections, Zod-
   validated, authored as typed TS modules that default-export
   `defineLesson({...})`. Not MDX. Frozen: adding an optional field is allowed;
   renaming or removing a required section is not.
3. **Database schema.** `db/schema.ts` as of migration `0001_study_days`.
   Additive migrations remain allowed; renames and redesigns do not.
   Curriculum tables are a projection of `content/`, rebuilt idempotently by
   `npm run db:seed`. Learner state is never derived.
4. **Single learner.** `learners.id = 'local'`. Every learner-state table still
   carries `learner_id` so adding auth in V2 is a data migration.
5. **Postgres only.** `pg` + `drizzle-orm/node-postgres`, one dialect, one
   migration system. No SQLite, no `@neondatabase/serverless`, no Edge DB layer.
6. **Resource allowlist.** `docs/resources.yaml`, 218 entries, every one fetched
   and title-confirmed on 2026-09-05. Candidates that returned a non-200 or a
   bot-challenge page were dropped rather than replaced with a guess. Raw URLs
   are forbidden in content except RFC 2606 documentation domains
   (`example.com`, `localhost`) inside code examples.
7. **Completion rule.** A lesson is `completed` only when every rendered section
   has been opened **and** a quiz attempt scored ≥ 70%. Enforced server-side in
   `app/lesson/actions.ts`, not just in the button.
8. **XP rules.** XP follows retrieval and reasoning only. No XP for opening a
   lesson, no login bonus, no XP for a failed flashcard grade, and exercise XP
   is awarded once per exercise on first submission.
9. **Mastery model.** `lib/learning/mastery.ts`. Weights: scenario quiz 0.30,
   recall quiz 0.20, interview 0.20, flashcards 0.15, exercises 0.15,
   renormalised over the sources that have evidence. Opening a lesson
   contributes nothing. Every score carries its own explanation.
10. **AI provider abstraction.** `lib/ai/provider.ts` is the only file that
    reads `AI_API_KEY`, and it imports `server-only`. Absent key ⇒ `mock`
    provider ⇒ the scripted interviewer, so the platform and the whole test
    suite work with no network access.
11. **Design language.** Blueprint-slate ground (`--color-ink-*`), serif
    reading column at 66ch for lesson prose, grotesque for app chrome, mono with
    tabular figures for every number. Signal teal = progress/correct, alert red
    = attention, brass = earned/expected. The dashboard's centrepiece is the
    curriculum spine, not stat tiles.
12. **E2E database.** Playwright recreates `<db>_test` from empty inside its
    `webServer` command (`scripts/e2e-db.ts`), because Playwright starts the web
    server before `globalSetup`. This also proves migrations apply cleanly.

## Open issues for next run

- 88 lessons remain `Planned`. Author them module by module, running
  `npm run content:index && npm run content:validate` after each batch.
- Content-driven visuals for Phase 2 (M9) are authored inside each lesson as
  `flow` diagrams; there is no separate visual library to build.
- `docs/V1_VERIFICATION.md` and `scripts/verify-v1.ts` are not written yet (M16).
- The live-provider interview path has not been exercised against a real key;
  record that check in `docs/V1_VERIFICATION.md` when it is.
