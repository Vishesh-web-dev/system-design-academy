# Architecture

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 15 App Router | Server Components keep lesson bodies off the client; route handlers keep the AI key server-side. |
| Language | TypeScript, `strict: true` | Content shape errors become compile errors. |
| Styling | Tailwind CSS v4 + shadcn/ui primitives (Radix) | No bespoke design system to maintain. |
| Motion | Framer Motion | Reveal/hide interactions for active recall. |
| Diagrams | Mermaid (static) + React Flow (`@xyflow/react`, interactive) | Mermaid for flows/sequences; React Flow only where the learner manipulates the diagram. |
| ORM | Drizzle ORM + `drizzle-orm/node-postgres` | One dialect, one schema, one migration system. |
| Driver | `pg` | Identical local and production driver. |
| Database | PostgreSQL (Docker locally, Neon in production) | Postgres only. No SQLite. No Edge DB layer. |
| AI | Vercel AI SDK (`ai`) behind an internal provider abstraction | Streaming + structured output; provider swappable. |
| Unit tests | Vitest | |
| E2E | Playwright | |
| Deploy | Vercel, Node.js serverless runtime | `pg` needs Node, not Edge. |

## Repository layout

```
app/                      Next.js App Router routes
  (learn)/                Learner-facing shell: dashboard, lessons, review, search
  interview/              Interview simulator + Boss Mode
  api/                    Route handlers (AI streaming, progress mutations)
components/
  ui/                     shadcn/ui primitives
  lesson/                 Lesson player, section nav, reveal blocks
  viz/                    Mermaid + React Flow visual components
  quiz/  flashcards/  interview/  dashboard/
content/
  lessons/<phase>/*.ts    Lesson source of truth (typed modules)
  curriculum.ts           Phase → module → lesson ordering + dependency graph
  index.generated.ts      Slug → dynamic import map (generated, committed)
  schema.ts               Zod schemas + inferred TS types for all content
db/
  schema.ts               Drizzle table definitions (single schema)
  migrations/             drizzle-kit output
  client.ts               Pool + drizzle instance
  repo/                   Data-access layer (one module per aggregate)
lib/
  ai/                     Provider abstraction, prompts, rubrics, evaluation
  learning/               Mastery model, SM-2 scheduler, XP, recommendations
  content/                Loader, validation, search index
docs/                     This documentation
scripts/                  migrate / seed / validate / verify / content index
tests/unit/               Vitest
tests/e2e/                Playwright
```

## Layering rules

```
app/ (routes, RSC)
   ↓ may import
components/            lib/            db/repo/
   ↓                     ↓                ↓
                       lib/*           db/schema.ts, db/client.ts
                         ↓
                     content/
```

- Routes and components **never** import `db/client.ts` or `db/schema.ts`
  directly; they go through `db/repo/*`.
- `lib/ai/*` is imported only from route handlers and server actions. It is
  never imported from a Client Component, so the key cannot leak into a bundle.
- `content/` has zero imports from `app/`, `components/`, `db/` or `lib/`. It is
  a leaf. This is what makes content authorable independently of the app.
- No React component contains lesson prose. Enforced by a validation script that
  fails on long string literals in `components/` matching lesson-body patterns.

## Server / client boundary

Server Components by default. `"use client"` is allowed only for:

- reveal/hide interactions (`components/lesson/RevealBlock.tsx`)
- quiz and flashcard interaction state
- Mermaid and React Flow rendering (both need the DOM)
- the interview transcript stream
- anything holding local UI state (tabs, section scroll-spy, timers)

Lesson prose, cheat sheets, interview question lists and resource lists render
on the server as static markup.

## Content pipeline

```
content/lessons/**.ts
   │  (typed module, default-exports a Lesson object)
   ├─→ tsc --noEmit          structural correctness at build time
   ├─→ content:validate      Zod + rules: sections present, resource keys exist,
   │                         no raw URLs, no placeholder markers
   ├─→ content:index         regenerates content/index.generated.ts
   └─→ db:seed               projects curriculum + quiz + flashcards into Postgres
```

`content:validate` is also executed as a Vitest test, so `npm test` fails on
malformed content. Malformed content can never be marked Complete.

Lesson bodies are markdown strings inside typed modules. They are rendered with
`react-markdown` + `remark-gfm` + `rehype-highlight` in a Server Component.
Mermaid blocks are extracted from fenced ```mermaid code and handed to the
client-only Mermaid renderer.

### Why typed modules and not MDX

- `strict` TypeScript catches a missing `cheatSheet.whenNotToUse` at
  `npm run typecheck` time; MDX frontmatter does not.
- Quizzes, flashcards, exercises and interview questions are *data*, not prose.
  Keeping them as typed data avoids an MDX component protocol.
- Dynamic `import()` per slug gives per-lesson code splitting for free.

## Database access

`db/client.ts` creates one `pg.Pool`, memoised on `globalThis` so Next's dev
hot-reload and serverless warm invocations do not leak connections. Pool size is
small (`DB_POOL_MAX`, default 5) because Vercel serverless multiplies instances;
Neon's pooler endpoint absorbs the fan-out.

The same code runs against local Docker Postgres and Neon. Only `DATABASE_URL`
differs. `db/client.ts` enables TLS when the connection string is not
`localhost`.

Every route that touches the database declares `export const runtime = 'nodejs'`
implicitly by never opting into Edge. No `@neondatabase/serverless`, no Edge
database layer.

## AI interviewer architecture

Four separated concerns, so none of them leak into React:

```
lib/ai/provider.ts       model selection, key handling, streaming (server only)
lib/ai/interviewer.ts    interviewer behaviour: system prompt built from
                         (mode, problem, difficulty, elapsed time, hints used)
lib/ai/session.ts        candidate session state machine: phase transitions,
                         time budget, hint accounting, difficulty adaptation
lib/ai/rubric.ts         structured scoring criteria per mode
lib/ai/evaluate.ts       final evaluation: score, strengths, weaknesses,
                         missed concepts, recommended lessons (Zod-validated)
```

- The key lives in `AI_API_KEY` (server env only). It is read inside
  `lib/ai/provider.ts` and nowhere else.
- `app/api/interview/turn/route.ts` streams interviewer turns.
- `app/api/interview/[id]/evaluate/route.ts` returns a structured, schema-
  validated scorecard, persisted to `mock_interview_evaluations`.
- Provider is chosen by `AI_PROVIDER` (`google` | `anthropic`) so the model can
  be swapped without touching prompts or UI.
- The interviewer prompt forbids revealing the reference solution before the
  session ends, and gates hints behind an explicit learner request that is
  counted.

## Failure behaviour when AI is unavailable

The learning platform must remain fully usable without an AI key. If `AI_API_KEY`
is absent:

- Lessons, quizzes, flashcards, exercises, revision, dashboard, search and notes
  all work unchanged.
- Interview simulator routes return a clear "AI provider not configured" state
  instead of throwing, and the UI explains what to set.

This keeps `npm run build` and E2E tests independent of network access; E2E runs
against a deterministic scripted interviewer (`AI_PROVIDER=mock`).

## Performance notes

- Lesson pages are Server Components with `dynamic = 'force-static'` where they
  do not read progress; progress badges are streamed in a Suspense boundary.
- Mermaid and React Flow are `next/dynamic` with `ssr: false` so they do not
  inflate the initial payload.
- The search index is built at module load from `content/` metadata (titles,
  summaries, tags, cheat-sheet lines) — no external search service.
