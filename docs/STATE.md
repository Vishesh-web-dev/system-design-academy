# Execution State

Read this first. Resume from `NEXT`. Never revisit anything under Frozen
decisions.

    LAST_COMPLETED: 16 (V1 verification)
    NEXT: none — V1 Definition of Done fully met
    STATUS: V1 COMPLETE — `npm run verify` passes all 17 requirements
            (docs/V1_VERIFICATION.md, commit recorded there). All 89
            lessons Complete; every gate green; live-provider path
            verified against a real key.

    ## Content progress
    **89 of 89 lessons Complete — ALL CURRICULUM CONTENT AUTHORED.**
    **Phase 1 (Foundations) finished: 18/18.**
    **Phase 2 (Distributed) finished: 19/19.**
    **Phase 3 module 3.1 (method) finished: 3/3.**
    **Phase 3 module 3.2 (core designs) finished: 8/8** — h-url-shortener (41,
    canonical), h-rate-limiter (42), h-notifications (43), h-blob-storage (44),
    h-google-drive (45), h-whatsapp (46), h-instagram-feed (47), h-youtube (48).
    Plus the canonical a-retrieval (Phase 5).
    **Phase 3 (HLD) finished: 18/18** — module 3.3 completed with
    h-media-streaming (49), h-uber (50), h-google-docs (51), h-gmail (52),
    h-ecommerce (53), h-food-delivery (54), h-payments (55).
    **Phase 4 module 4.1 (oo-foundations) finished: 5/5** — l-object-design
    (56), l-solid (57), l-lld-framework (58), l-uml (59), l-patterns (60).
    **Phase 4 (LLD) finished: 14/14** — module 4.2 completed with
    l-lru-cache (61), l-rate-limiter-lld (62), l-logger (63),
    l-pubsub (64), l-parking-lot (65), l-splitwise (66),
    l-bookmyshow (67), l-elevator (68), l-games (69).
    **Phase 5 module 5.1 (llm-apps) finished: 3/3** —
    a-llm-app-architecture (70), a-model-selection (71),
    a-structured-outputs (72). a-retrieval (75) was already the
    canonical lesson.
    **Phase 5 module 5.2 (retrieval) finished: 4/4** —
    a-embeddings (73), a-chunking-indexing (74), a-retrieval (75,
    canonical, already authored), a-rag-evaluation (76).
    **Phase 5 module 5.3 (agents) finished: 4/4** —
    a-tool-calling (77), a-agent-loops (78), a-agent-memory (79),
    a-multi-agent (80).
    **Phase 5 module 5.4 (workflows, safety, evaluation) finished: 5/5** —
    a-durable-execution (81), a-mcp (82), a-human-in-the-loop (83),
    a-ai-security (84), a-ai-evaluation (85).
    **Phase 5 module 5.5 (AI system designs) finished: 4/4** —
    a-rag-assistant (86), a-support-agent (87), a-chatgpt-app (88),
    a-coding-agent (89). All five phases and all 89 lessons complete.
    Next: V1 verification — write scripts/verify-v1.ts and
    docs/V1_VERIFICATION.md, then the remaining M8/M10-M16 UI/affordance
    milestones and the live-provider interview-path check.

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
| `npm test` | PASS — 95 unit tests, 5 files |
| `npm run test:e2e` | PASS — 11 Playwright tests |
| `npm run build` | PASS |
| `npm run content:validate` | PASS — 89 complete, 0 planned |
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

- 44 lessons remain `Planned`. Author them module by module, in curriculum
  order. After each batch, run in this order:
  `python3 scripts/escape-content-backticks.py <new files>`, then
  `npm run content:index`, `npx tsc --noEmit`, `npm run content:validate`.
  The escaping step is not optional — lesson prose lives in TypeScript
  template literals, and an unescaped backtick from an inline code span
  terminates the literal and produces parse errors pointing at the wrong line.
- Content-driven visuals for Phase 2 (M9) are authored inside each lesson as
  `flow` diagrams; there is no separate visual library to build.
- Schema caps and rules to respect when authoring, learned by hitting them:
  `revision.bullets` max 18, `flashcards` max 14, `intuition.analogyLimit` max 500
  characters, `intuition.body` 120-480 words, `deepExplanation.body` 650-3000 words
  (the 90-minute design lessons run close to the ceiling — keep step sections tight). Prose must not contain the words
  TODO/FIXME/XXX/TBD/placeholder/WIP or any raw `http(s)://` URL outside the
  RFC 2606 documentation domains. Item id prefixes must be globally unique across
  lessons — `d-retries-timeouts` collided with `f-realtime-transports` on `rt-`
  and was renamed to `rto-`; check with
  `grep -rho "id: 'fc-[a-z]*-" content/lessons/ | sort -u` before choosing one.
- LLD lesson gotchas learned while authoring module 4.1: the `predict` block
  needs its own closing `    },` before `  body:` (omitting it produces a single
  TS1005 at the final line of the file, which is very hard to localise — the
  fastest diagnostic is a brace-balance scan that skips string literals).
  `intuition.analogyLimit` is capped at 500 characters. The phrase "to be
  written" trips the PLACEHOLDER regex via `to be written`. Module ids for
  Phase 4 are `oo-foundations` and `machine-coding` (see `content/curriculum.ts`,
  which is the authority the validator checks against).
- Lesson files written with the Write tool land on disk with interior backticks
  already escaped as `\``. So any later `python`/`sed` edit whose match string
  contains a backtick must escape it the same way (e.g.
  `a = a.replace('`', '\\`')` before matching), or the replacement silently
  misses. `scripts/escape-content-backticks.py` then reports "0 line(s) escaped",
  which is expected rather than a failure.
- The 90-minute design lessons land 200-350 words over the 3000-word
  `deepExplanation.body` ceiling on the first pass. Budget ~300 words per Step
  section and condense the "N decisions worth defending" paragraphs first —
  they trim without losing an argument.
- `git` has no configured identity in this environment. Commit with
  `git -c user.name="Vishesh Shrivastava" -c user.email="vishesh.shrivastava@rapidops.com" commit ...`
- RESOLVED: `scripts/verify-v1.ts` and `docs/V1_VERIFICATION.md` are written
  (M16). `npm run verify` runs the 17 V1 DoD checks — content checks re-derived
  from `content/` + the five gate subprocesses (lint, typecheck, test, e2e,
  build) run for real — and writes the report. Full run 2026-09-15 (commit
  d67c63e): all 17 PASS.
- RESOLVED: the live-provider interview path is verified. `scripts/check-live-
  provider.ts` (a network+key script, out of the standard gates like verify-
  resources) makes one real interviewer turn and writes `docs/live-provider-
  check.json`, which verify-v1 embeds. Recorded PASS: google/gemini-3.6-flash.
- Provider-model drift fixed: the configured Google key rejected the former
  `gemini-2.5-flash` default ("no longer available, use gemini-3.6-flash"), so
  `lib/ai/provider.ts` DEFAULT_MODELS.google now points at `gemini-3.6-flash`
  (main and fast; the fast tier has no caller today). Anthropic defaults left
  untouched — that provider is not configured here and cannot be verified
  without its key. `scripts/check-live-provider.ts` mirrors the google `main`
  default by hand (it can't import the `server-only` provider), so keep the two
  in sync if the default changes again.
