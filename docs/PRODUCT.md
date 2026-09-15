# System Design Academy — Product Definition

## One-line

A private, single-learner training platform that turns an experienced programmer
into someone who can derive an architecture for an unfamiliar system under
interview pressure — in 12–16 weeks.

## The single success condition

The learner moves from

> "I don't know how to approach this system"

to

> "Give me an unfamiliar system and I can clarify requirements, estimate scale,
> derive an architecture, reason about data and distributed components, identify
> bottlenecks and failure modes, explain trade-offs, and defend my decisions
> under interviewer follow-up."

Everything in this product is judged against that sentence. Page counts, lesson
counts, component counts and badge counts are **not** success metrics.

## Who it is for

One user: an experienced TypeScript/frontend-strong engineer moving toward
senior full-stack + AI application engineering, targeting product-company
interviews (HLD, LLD, backend, distributed systems, AI system design).

Assumed baseline: comfortable writing production code, comfortable with HTTP and
SQL at a working level, **not** yet fluent in distributed-systems reasoning or
architecture derivation.

## Non-goals for V1

- Not a multi-tenant SaaS. Single-learner, private deployment.
- Not a general software-engineering course (no Docker/K8s/CI-CD/cloud-cert
  tracks — see `docs/MILESTONES.md` V2 notes).
- Not a passive article reader.
- Not a content farm. A smaller set of exceptional lessons beats a large shallow
  catalog.

## Learning philosophy

```
Understand → Visualize → Reason → Practice → Recall → Explain → Interview
```

Every concept is taught as an answer to a problem, never as a recipe. For each
component the learner must be able to state:

1. Why it exists.
2. What problem it solves.
3. What simpler alternative exists.
4. When it becomes necessary.
5. What it costs.
6. What it breaks.
7. What trade-off it introduces.

Explicitly rejected framing: *"big system = microservices + Kafka + Redis +
Kubernetes."* A lesson that cannot say when **not** to use its subject is
incomplete.

### Difficult-concept ladder

1. Establish intuition.
2. Give the simple mental model.
3. Explain what actually happens technically.
4. Show a production example.
5. Explore failure modes.
6. Compare alternatives.
7. Test with a scenario.
8. Connect it back to system design.

## The interview framework (taught repeatedly, never as a script)

| Step | Question the learner must answer |
| --- | --- |
| Understand | What is actually being asked? |
| Clarify | Which assumptions change the design? |
| Estimate | How large is this system? |
| Model | What entities and data exist? |
| Design | Which components should exist, and why each one? |
| Deep dive | What is the genuinely hard part here? |
| Scale | What breaks at 10×? |
| Fail | What happens when a component dies? |
| Defend | Why this design and not the alternative? |

The product's job is to make this loop automatic, not memorised.

## Core surfaces

| Surface | Purpose |
| --- | --- |
| Dashboard | Answer "what should I do today?" in one screen. |
| Lesson player | Understand → visualize → reason, with active recall built in. |
| Quiz engine | Conceptual and scenario questions; expose shallow understanding. |
| Flashcards | Spaced-repetition recall of high-value interview facts. |
| Exercises | Design/modify/debug/estimate work with hidden model answers. |
| Revision queue | Performance-driven review, not calendar-driven busywork. |
| Interview simulator | LLM interviewer across HLD / LLD / backend / distributed / AI modes. |
| Boss Mode | Unfamiliar system, no solution revealed, graded on transfer. |
| Search & notes | Retrieval of what was learned; the learner's own words. |
| Mastery & gamification | Reward reasoning, not page views. |

## Mastery model (explainable, not scientific)

Mastery per topic is a weighted blend of observable signals:

- quiz accuracy (weighted to scenario questions over recall questions)
- exercise self-assessment and model-answer comparison
- flashcard recall strength (SM-2-style ease/interval)
- repeated-error patterns on the same concept
- mock-interview rubric scores for that topic
- decay since last successful retrieval

"Lesson opened" contributes nothing. The UI always shows *why* a mastery number
is what it is, and the model is presented as a useful heuristic, not a
measurement.

## Gamification rules

XP is awarded for actions that create learning: answering quiz questions,
submitting exercises, clearing review items, completing mock interviews,
surviving Boss Mode. Reading a page earns little. No point inflation, no badge
for logging in.

## Privacy model

**V1 (shipped):** no authentication; a single `local` learner row held all
progress.

**Post-V1 (added at the user's direction):** email+password authentication with
per-account isolation. Each account sees only its own progress, notes, quiz
attempts, reviews, XP, streaks and interviews — every read and write is scoped
to the session's learner id, enforced in the data layer, not the UI. Signup is
open to anyone with the URL; there is no cross-account visibility. Auth is
custom and dependency-free (Node scrypt hashing, database-backed sessions, an
httpOnly cookie); the AI key handling is unchanged. `local` is now the seeded
dev/E2E account rather than the only learner. See STATE.md frozen decision 13.
For a personal deployment, Vercel Deployment Protection is still recommended as
defence in depth.

## Honesty constraints

- No unsupported claims about a specific company's interview process. Company
  interview *styles* in the simulator are presented as emphasis profiles derived
  from public engineering material, and labelled as such.
- No invented URLs, citations, page numbers or video timestamps. Every external
  reference is a verified key in `docs/resources.yaml`.
- The mastery model and readiness estimate are labelled heuristics.
