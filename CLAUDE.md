# System Design Academy

A private, single-learner platform that trains system-design interview ability
in 12–16 weeks. Read `docs/PRODUCT.md` before changing anything user-facing.

## Stack
Next.js 15 App Router · TypeScript strict · Tailwind v4 · shadcn/ui ·
Framer Motion · Drizzle ORM + `pg` · PostgreSQL · React Flow (`@xyflow/react`) ·
Mermaid · Vercel AI SDK · Vitest · Playwright.

## Database
- Local: PostgreSQL in Docker (`docker compose up -d`).
- Production: Neon PostgreSQL.
- Driver: `pg`. Drizzle adapter: `drizzle-orm/node-postgres`.
- PostgreSQL only. One schema (`db/schema.ts`), one migration system.
- No SQLite. No `@neondatabase/serverless`. No Edge-runtime database access.

## Deployment
Vercel, Node.js serverless runtime, + Neon. Env: `DATABASE_URL`, `AI_API_KEY`.
Secrets live in `.env.local` locally and Vercel Environment Variables in prod.

## Commands
```
npm run dev          npm run lint         npm run typecheck
npm test             npm run test:e2e     npm run build
npm run db:generate  npm run db:migrate   npm run db:seed
npm run content:validate                  npm run verify
```

## Repository
```
app/  components/  content/  db/  lib/  docs/  scripts/  tests/
```

## Rules
- Lesson content lives in `content/`. Never put lesson prose in a React component.
- `content/` is a leaf: it imports nothing from `app/`, `components/`, `db/`, `lib/`.
- Routes and components reach the database only through `db/repo/*`.
- `lib/ai/*` is server-only. The AI key is read in `lib/ai/provider.ts` and nowhere else.
- Server Components by default; `"use client"` only where interaction requires it.
- `docs/resources.yaml` is the only external-reference allowlist. Never invent a
  reference, URL, page number or timestamp. Unverifiable → omit it.
- Build only the current milestone's scope (`docs/MILESTONES.md`).
- A milestone is done only when its Definition of Done passes mechanically.
- Read `docs/STATE.md` first; never revisit anything under Frozen decisions.

## Detail
`docs/ARCHITECTURE.md` · `docs/SCHEMA.md` · `docs/CURRICULUM.md` ·
`docs/CONTENT_STYLE.md` · `docs/CONTENT_STATUS.md` · `docs/MILESTONES.md`
