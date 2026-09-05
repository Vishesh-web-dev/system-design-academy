# Content Style Guide

The reader is an experienced programmer who ships production code and is **not**
fluent in distributed-systems reasoning. Never explain what a function is. Never
assume they know what a quorum is.

## Voice

- Second person, present tense, direct. "You add a cache. Now you own two copies
  of the truth."
- Short sentences carry the load-bearing claims. Long sentences are for nuance.
- No hype, no "simply", no "just", no "obviously". If it were obvious the lesson
  would not exist.
- Concrete numbers over adjectives. Not "slow" — "an extra 80 ms per request,
  which at p99 means…".
- Name the trade-off out loud every single time. A paragraph that introduces a
  component without naming its cost is not finished.

## The rule that matters most

> Never teach a recipe. Teach the pressure that makes the recipe appear.

Bad: "Use Redis to cache hot keys."
Good: "Reads outnumber writes 100:1 and every read hits the same 2 % of rows.
That ratio is the reason a cache helps here. If reads were uniform across 400 GB
of rows, a cache would buy you almost nothing and you would have added a second
source of truth for free."

Every component introduction must answer, in the prose itself:

1. Why does it exist?
2. What problem does it solve?
3. What simpler alternative exists, and when is the simpler thing correct?
4. When does it become necessary?
5. What does it cost — money, latency, operational burden, cognitive load?
6. What does it break?
7. What trade-off does it introduce?

## Required sections

Every lesson has exactly these 12, in this order. All are required; none may be
empty. Enforced by `content/schema.ts` and `npm run content:validate`.

| # | Section | Length | Rules |
| --- | --- | --- | --- |
| 1 | `intuition` | 150–350 words | One mental model, one analogy at most. The analogy must be *retired* explicitly before the deep explanation ("the analogy breaks down because…"). |
| 2 | `deepExplanation` | 700–2000 words | Technically rigorous. Mechanisms, not vocabulary. Must include at least one concrete numeric example. |
| 3 | `visual` | 1–3 diagrams | Mermaid or a React Flow spec. Must *show a mechanism*, not decorate. A box-and-arrow diagram that restates the prose is rejected. |
| 4 | `productionExample` | 200–600 words | A real system, described from public engineering material. If it cannot be sourced to a verified resource key, describe the *pattern* generically instead of naming a company. |
| 5 | `tradeoffs` | ≥ 3 rows | Table: option · when it wins · when it loses · what it costs. Must include the "do nothing / simplest thing" option. |
| 6 | `commonMistakes` | 3–6 items | Each is a *weak interview answer* quoted, then why it is weak, then the stronger version. |
| 7 | `flashcards` | 5–12 | Atomic. One fact per card. Prefer "why/when" cards over "what" cards. |
| 8 | `quiz` | 4–8 questions | At least half must be `scenario` kind: given a situation, choose and justify. No trivia. |
| 9 | `exercise` | 1–2 | Reasoning, design, modification, debugging or estimation. Has a rubric and a model answer that stays hidden until submission. |
| 10 | `interviewQuestions` | ≥ 6 | Spread across `basic`, `intermediate`, `advanced`, `followup`. Each carries `guidance`: what a strong answer contains. |
| 11 | `revision` | 120–250 words | Five-minute recall material. Bullets, no prose paragraphs. |
| 12 | `cheatSheet` | all 8 fields | `whatItIs`, `whyItExists`, `whenToUse`, `whenNotToUse`, `alternatives`, `tradeoffs`, `failureModes`, `followUpQuestions`. |

## Active learning requirements

At least two of these per lesson, expressed as content fields the player can
render:

- **Predict** — a question posed *before* the explanation that reveals the
  answer only after the learner commits (`predictPrompt` on a section).
- **What changes if…** — a variant of the scenario with one parameter moved.
- **Modify the architecture** — a change request against the design just built.
- **Debug** — a broken design or symptom; find the cause.
- **Explain it yourself** — a prompt to write the explanation before reading it.

Hidden-until-revealed is the default for anything that would let the learner
skip thinking.

## Diagrams

- Mermaid for sequence, flow and state diagrams.
- React Flow only when the learner manipulates the diagram (change a parameter,
  kill a node, move a shard).
- Every diagram has a caption stating what the reader should notice. A diagram
  without a caption is rejected.
- Never a diagram that is a picture of the words next to it.

## Code in content

TypeScript unless the concept is language-specific. Reference implementations
for LLD lessons live in typed content fields and are exercised by unit tests
where the logic is non-trivial, so `npm run typecheck` and `npm test` protect
them from rot. Illustrative snippets may be markdown fences.

No pseudocode where real code is shorter.

## References

- Only keys from `docs/resources.yaml`. Never a raw URL in lesson content. The
  one exception, enforced in `content/schema.ts`, is the documentation domains
  reserved by RFC 2606 (`example.com`, `localhost`) inside code examples: those
  are illustrative strings, not citations, so they cannot rot or be invented.
- Referenced in content as `resource_key: <key>` or via the `resources` field.
- Priority tiers per lesson:
  - **⭐ Must read** — max 3.
  - **📚 Good to read** — optional depth.
  - **🧠 Advanced** — papers and deep material.
- Never cite page numbers or video timestamps. Cite chapter titles, article
  titles, paper titles, repository sections.
- If a resource cannot be verified, it is omitted. Never invent a replacement.

## Banned

- TODO, FIXME, XXX, "coming soon", "placeholder", lorem ipsum, "..." as content.
- "In this lesson we will learn about X." Start with the problem.
- Bullet lists of definitions with no reasoning attached.
- The claim that a technology is "web scale", "blazing fast", or "battle tested".
- Company-specific interview claims without a verified source.
- Microservices / Kafka / Redis / Kubernetes as a default answer.
- Forcing a design pattern into an LLD problem that does not need one. Lessons
  must sometimes conclude "no pattern here; a plain class is correct."

## Review checklist

Applied to every batch before it is marked `Complete`:

- [ ] **Correct** — every technical claim is accurate and defensible.
- [ ] **Deep** — explains mechanism and reasoning, not vocabulary.
- [ ] **Transferable** — the reasoning applies to a system not named in the lesson.
- [ ] **Interview-grade** — survives three levels of follow-up.
- [ ] **Clear** — an experienced programmer new to system design can follow it.
- [ ] **Trade-offs** — alternatives and limits stated, including "do nothing".
- [ ] **Failure modes** — what breaks, how it is detected, how it is contained.
- [ ] **Non-redundant** — does not restate another lesson; cross-links instead.
- [ ] **Referenced** — every resource key resolves and is `verified: true`.
- [ ] **Active** — at least two active-learning elements present.
- [ ] **Sized** — matches its `estimatedMinutes` within ±30 %.

Reject weak content. Do not lower the bar to make progress look faster.
