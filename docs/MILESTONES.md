# Milestone Plan

16 milestones. Each has a **Definition of Done** that is mechanically checkable.
A milestone is complete only when every DoD line passes — not when the code
looks right.

Standard gates, run at the end of every milestone:

```
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e        # from M1 onward
npm run content:validate # from M2 onward
```

Progress is recorded in `docs/STATE.md` after every milestone.

---

## M1 — Foundation: repo, shell, database, routing, design system, tests

**Scope.** Next.js 15 App Router + TS strict + Tailwind v4 + shadcn/ui
primitives. `docker-compose.yml` for local Postgres. Drizzle schema and first
migration. `db/client.ts` pool. App shell: sidebar, header, theme, route
skeletons for dashboard / phases / lesson / review / interview / search /
settings. Vitest and Playwright wired with the exact npm scripts from
`docs/PRODUCT.md`. `.env.example`.

**DoD**
- All eight required npm scripts exist and exit 0.
- `docker compose up -d` then `npm run db:migrate` succeeds against an empty DB.
- `npm run db:migrate` succeeds twice in a row (idempotent).
- Playwright smoke test loads `/` and asserts the shell renders.
- No secret committed; `.gitignore` covers `.env*` except `.env.example`.

---

## M2 — Content model, engine, validation, three canonical lessons

**Scope.** `content/schema.ts` (Zod + inferred types for all 12 lesson
sections). `content/curriculum.ts` (phases, modules, ordering, dependency
edges). Loader + generated index. `scripts/validate-content.ts`. `scripts/seed.ts`.
Then the three canonical lessons at full quality:
`f-request-lifecycle`, `h-url-shortener`, `a-retrieval`.

**DoD**
- `npm run content:validate` passes and *fails* on a deliberately broken fixture.
- Three canonical lessons contain all 12 required sections, non-placeholder.
- `npm run db:seed` populates curriculum tables from content; re-running is a
  no-op diff.
- Unit tests cover: schema rejection cases, resource-key resolution, raw-URL
  detection, index/file drift.
- **Freeze** the database schema and content model in `docs/STATE.md`.

---

## M3 — Lesson player

**Scope.** Section navigation with scroll-spy, markdown rendering, Mermaid and
React Flow visual components, reveal-before-answer blocks, prediction prompts,
exercise rendering with hidden model answers, cheat sheet, 5-minute revision
view, per-section "seen" tracking.

**DoD**
- All three canonical lessons render every section correctly.
- Reveal blocks hide content until interaction (asserted in E2E).
- Mermaid and React Flow are client-only and do not appear in the server payload.
- E2E: open a lesson, walk all sections, mark complete.

---

## M4 — Progress tracking and dashboard

**Scope.** `db/repo/progress.ts`, server actions for progress mutations, XP
events, streak derivation, the dashboard that answers the six questions in
`docs/PRODUCT.md`, pace-vs-target-weeks projection, fresh-DB empty states.

**DoD**
- Dashboard renders correctly against a *fresh* database (no crash, useful empty
  state) — E2E asserted.
- Dashboard renders correctly against a seeded database with realistic simulated
  progress (`npm run db:seed -- --demo`) — E2E asserted.
- Progress writes are idempotent under double-submit.

---

## M5 — Quiz engine and flashcards

**Scope.** Quiz runner (single/multi/scenario), immediate explanation, attempt
persistence, per-topic result breakdown. Flashcard reviewer with SM-2 grading,
keyboard-driven.

**DoD**
- E2E: answer a quiz to completion, see score and explanations.
- E2E: review a flashcard and record a grade.
- Unit tests for SM-2 transitions including lapse handling.

---

## M6 — Spaced repetition and revision

**Scope.** `lib/learning/scheduler.ts`, `review_items` generation from quiz
misses, flashcard lapses, decay and interview gaps. The daily review queue with
prioritisation and an explanation of *why* each item is queued.

**DoD**
- Unit tests: a wrong quiz answer creates a review item for its topic; a passed
  review pushes the interval out; decay resurfaces an untouched lesson.
- Review queue page works on a fresh DB (empty state) and a seeded DB.

---

## M7 — HLD experience + Phase 3 content

**Scope.** HLD-specific lesson affordances: requirements checklist, estimation
worksheet with live arithmetic, architecture walkthrough stepper, trade-off
tables, follow-up drill. Author all 18 Phase 3 lessons.

**DoD**
- 18/18 Phase 3 lessons `Complete` in `docs/CONTENT_STATUS.md`.
- Estimation worksheet arithmetic unit-tested.
- Content review pass recorded (see `docs/CONTENT_STYLE.md` review checklist).

---

## M8 — LLD experience + Phase 4 content

**Scope.** Class-diagram rendering, code-block presentation for TypeScript
reference implementations, "implement then compare" exercise mode. Author all 14
Phase 4 lessons.

**DoD**
- 14/14 Phase 4 lessons `Complete`.
- Every reference implementation in Phase 4 content is type-checked by
  `npm run typecheck` (they live in typed content modules, not fenced strings
  only — see `docs/CONTENT_STYLE.md`).

---

## M9 — Distributed-systems visuals + Phase 1 & 2 content

**Scope.** Interactive React Flow visualisations: replication lag, sharding and
resharding, consistent-hash ring, Kafka partitions and consumer groups, cache
invalidation, queue backpressure, distributed lock with fencing. Author all 37
Phase 1 + Phase 2 lessons.

**DoD**
- 37/37 Phase 1–2 lessons `Complete`.
- Each interactive visual has a unit test on its state-transition logic.

---

## M10 — AI fundamentals and RAG content

**Scope.** Phase 5 modules 5.1 and 5.2 (7 lessons) plus RAG pipeline
visualisation.

**DoD** — 7/7 lessons `Complete`; pipeline visual tested.

---

## M11 — Agents and workflow content

**Scope.** Phase 5 modules 5.3, 5.4, 5.5 (13 lessons) plus agent-loop and
workflow-state visualisations.

**DoD** — 13/13 lessons `Complete`; 89/89 lessons authored.

---

## M12 — Gamification and mastery

**Scope.** `lib/learning/mastery.ts` with explainable per-topic scores, XP/level
curve, streaks, achievements tied to reasoning actions, weekly boss interview
unlock, topic mastery map.

**DoD**
- Mastery unit tests: opening a lesson moves nothing; quiz and exercise and
  interview signals move the score with documented weights.
- Every achievement has a mechanical unlock condition and a test.

---

## M13 — Search, notes, recommendations

**Scope.** In-process search index over lesson metadata, cheat sheets and
interview questions. Per-lesson notes. "What should I study today?" recommender
combining the review queue, curriculum order and weakest topics.

**DoD**
- Search returns the expected lesson for 20 fixture queries (unit test).
- Recommender is deterministic given a fixed state fixture (unit test).

---

## M14 — AI interview simulator and evaluation

**Scope.** `lib/ai/*` (provider, interviewer, session, rubric, evaluate),
streaming turn route, transcript UI, timer, hint accounting, difficulty
adaptation, structured scorecard persisted and linked into the revision queue.
Mock provider for tests. Boss Mode.

**DoD**
- E2E: run a mock interview end to end and reach the scorecard (mock provider).
- Evaluation output is Zod-validated; malformed model output is retried then
  degraded gracefully.
- No `AI_API_KEY` reference exists in any client bundle (asserted by a build-
  output grep test).
- Interview works with a real provider when `AI_API_KEY` is set (manual check
  recorded in `docs/V1_VERIFICATION.md`).

---

## M15 — Content completion and quality review

**Scope.** Full technical-correctness review of all 89 lessons against the
`docs/CONTENT_STYLE.md` checklist. Resource verification sweep. Redundancy pass.
Fix everything found.

**DoD**
- 89/89 `Complete` in `docs/CONTENT_STATUS.md`.
- Zero unresolved resource keys; zero raw URLs in `content/`.
- Zero placeholder markers anywhere in `content/`.

---

## M16 — Final UX, a11y, performance, reliability, security, V1 verification

**Scope.** Keyboard navigation, focus management, contrast, reduced-motion,
error boundaries, loading states, secret-handling audit, the final learning
audit from `docs/PRODUCT.md`, then `scripts/verify-v1.ts` and
`docs/V1_VERIFICATION.md`.

**DoD** — every line of the V1 Definition of Done below passes mechanically.

---

## V1 Definition of Done

Checked by `npm run verify`, which writes `docs/V1_VERIFICATION.md`.

1. Every lesson in `docs/CURRICULUM.md` is `Complete` in `docs/CONTENT_STATUS.md`.
2. Every completed lesson has all 12 required sections, each non-empty.
3. Zero references in `content/` resolve to a key absent from `docs/resources.yaml`.
4. Zero raw external URLs inside lesson content.
5. `npm run lint` passes.
6. `npm run typecheck` passes.
7. `npm test` passes.
8. `npm run test:e2e` passes.
9. `npm run build` passes from a clean checkout.
10. Playwright smoke covers: complete a lesson · answer a quiz · review a
    flashcard · run a mock interview to the scorecard.
11. Dashboard renders against a fresh database.
12. Dashboard renders against a seeded database with realistic progress.
13. Migrations apply to a clean database.
14. Local Docker Postgres setup works.
15. Vercel + Neon architecture is build-compatible (Node runtime, `pg`, no Edge
    DB access, no `@neondatabase/serverless`).
16. No TODO / FIXME / placeholder / lorem ipsum / "coming soon" in `content/`.
17. `docs/V1_VERIFICATION.md` exists with per-requirement evidence.

---

## V2 candidates (explicitly not V1)

Multi-user auth · Docker/K8s/CI-CD tracks · cloud certification tracks · data
engineering track · generic frontend track · competitive programming ·
voice mock interviews · whiteboard/diagram capture and grading · shared or
public progress · mobile app.
