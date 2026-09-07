import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-denormalization',
  title: 'Denormalisation and derived data',
  summary:
    'Every derived copy needs an owner, a rebuild path and a staleness budget — and if you are unwilling to write the reconciliation job, that is evidence you should not create the copy.',
  phase: 'foundations',
  module: 'databases',
  position: 17,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 40,
  tags: ['denormalization', 'derived-data', 'read-models', 'caching', 'consistency'],
  prerequisites: ['f-nosql-models'],
  resources: [
    {
      key: 'fowler-cqrs',
      tier: 'must',
      note: 'The idea that read and write models can be separate structures. Read it for the argument, not as an instruction — most systems need one derived table, not a full CQRS architecture.',
    },
    {
      key: 'martin-fowler-event-sourcing',
      tier: 'must',
      note: 'The most rigorous version of "derive everything from an immutable log". Useful even if you never adopt it, because it clarifies what a rebuild path actually is.',
    },
    {
      key: 'microservices-outbox',
      tier: 'good',
      note: 'The mechanism for updating a derived copy in another system without a dual-write. Directly applicable the moment a derived value lives outside the transaction that produced it.',
    },
    {
      key: 'aws-caching-challenges',
      tier: 'good',
      note: 'A cache is derived data with a very short staleness budget, and this covers the invalidation problems that follow. The same three obligations apply.',
    },
    {
      key: 'debezium-docs',
      tier: 'advanced',
      note: 'Change data capture as a rebuild and propagation mechanism. Relevant once the derived copy is in a different store and you need the pipeline to be replayable.',
    },
  ],

  intuition: {
    body: `Denormalisation is storing the same fact in more than one place so that a read is cheaper. It always works, and it always creates the same problem: **now two places can disagree, and neither of them errors.**

That is the entire subject. Everything else is a way of managing it.

Three obligations come with every derived copy, and they are not optional extras — they are what separates a managed optimisation from an unowned liability:

1. **An owner.** Exactly one code path is allowed to write it. If two are, they will eventually disagree about what it should be.
2. **A rebuild path.** A way to recompute the value from the source of truth, because it *will* drift. Not might. Will.
3. **A staleness budget.** How wrong it is allowed to be, and for how long. "Always correct" is not a budget; it is a wish, and it is usually false the moment the copy exists.

The useful test, and it is a good one to apply in an interview: **if you are unwilling to write the reconciliation job, that is evidence you should not create the copy.** Not because the job is the hard part, but because refusing it means you do not actually believe the copy will drift — and that belief is always wrong.

One clarification that prevents a whole category of confusion. A **snapshot** is not denormalisation. The price on an invoice line, the address an order shipped to — those are recordings of what happened, and they are *supposed* not to track their source. No owner, no rebuild path, no staleness budget, because there is nothing to keep in sync. The distinction is whether the copy is meant to follow the original.`,
    analogyLimit:
      'Calling this "caching in the database" is close and hides the important difference: a cache has a TTL, so it is wrong for a bounded time and then self-corrects. A denormalised column has no expiry — it stays wrong forever unless something notices. That absence of automatic correction is precisely why the rebuild job is the load-bearing part.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team adds `comment_count` to the `posts` table, incremented when a comment is inserted. Six months later the counts are wrong on about 2% of posts. List the mechanisms that could have caused the drift, and say which one you would expect to dominate.',
      answer: `**Mechanisms, all plausible:**

1. **A second writer.** An admin tool, a moderation script, a GDPR deletion job, or a bulk import that inserts or deletes comments directly without touching the counter. This is the classic failure of a copy without a single owner.
2. **A non-transactional update.** The insert and the increment happen in separate transactions, so a crash or an error between them leaves them inconsistent.
3. **Soft deletes.** Comments are marked deleted rather than removed, and the counter was decremented in one code path and not another — or the definition of "count" changed and the counter did not.
4. **Cascading deletes.** Deleting a post cascades to comments, and deleting a *user* cascades to their comments — but the cascade is a database operation and the counter lives in application code, so it is not updated.
5. **A concurrency bug.** \`count = count + 1\` is safe; \`SELECT count\` then \`UPDATE SET count = $n+1\` is a lost update under concurrent inserts.

**Which dominates: cascading deletes and second writers, roughly in that order.**

Cascades are the most insidious because they are invisible in application code. Nobody wrote "delete these comments" — a foreign key did, and no application-level counter update accompanied it. A GDPR deletion of one user silently decrements nothing across every post they commented on.

**What would have prevented it, in order of strength:**

- **A trigger** as the owner, so the counter is maintained by the database and therefore participates in cascades and in any code path including manual SQL.
- **A nightly reconciliation job** that recomputes and reports mismatches — which would have caught it in week one instead of month six.
- **Not storing it.** \`SELECT count(*) FROM comments WHERE post_id = $1\` with an index on \`post_id\` is fast. The counter was probably premature.

The last one is the answer most often correct and least often chosen.`,
    },
    body: `## The four places derived data lives

Derived data is a spectrum, not a technique, and the four points on it have genuinely different properties.

**A column on the same row.** \`orders.total_minor\`, \`posts.comment_count\`. Cheapest to read, and it can be maintained in the same transaction as its source, which means it can be *exactly* consistent. That transactional coupling is the strongest guarantee available and it is what makes this the right default when it fits.

**A separate derived table.** A daily aggregates table, a materialised search index, a per-user feed. Updated by a job or by triggers. Cannot be transactional with every write, so it lags — and the lag is measurable, which makes it manageable.

**A different store.** A search engine, an analytical warehouse, a read replica shaped differently. Now you have a pipeline, and pipelines fail quietly. Requires change capture, ordering, replay and lag monitoring.

**A cache.** Derived data with a TTL. Distinguished by self-correction: it is wrong for a bounded time and then refreshes. That single property makes it the easiest kind of derived data to live with, and it is why "add a cache" is often better advice than "add a column".

Notice the progression: as the copy moves further from the transaction that produced it, the guarantee weakens and the machinery grows.

## Choosing the owner

The owner is whichever mechanism sees *every* write to the source. That is a stronger requirement than it sounds, and it eliminates the obvious answer in most cases.

**Application code as owner.** Works only if all writes go through it. The moment there is a second service, an admin tool, a migration script or a cascading delete, application code is not the owner — it merely thinks it is. This is the most common mistake in this area.

**A database trigger as owner.** Sees every write, including cascades, manual SQL and other services. This is the correct choice for a same-row derived value, and the reason people avoid it — triggers are invisible, hard to test, and surprising in a stack trace — is a real cost worth weighing against silent drift.

**A change-event consumer as owner.** For a copy in another store: every change to the source emits an event, and one consumer applies it. The pipeline sees every committed write, which makes it a genuine owner, and it introduces lag plus a replay requirement.

**A periodic recompute as owner.** No incremental updates at all — just recompute from scratch on a schedule. Dramatically simpler than incremental maintenance, and the right answer far more often than it is chosen, because the staleness budget for most aggregates is generous.

## The dual-write problem

The most common way derived data breaks across systems:

\`\`\`
BEGIN;
UPDATE orders SET status = 'shipped' WHERE id = $1;
COMMIT;
searchIndex.update(orderId, { status: 'shipped' });   -- separate system
\`\`\`

If the second call fails, the index is stale forever. If the process crashes between them, the same. If you reverse the order, you can index something that was never committed. **There is no ordering of two independent writes that is safe**, and this is worth recognising as a structural fact rather than a bug to be careful about.

The two standard resolutions:

**Transactional outbox.** Write the change to an \`outbox\` table *in the same transaction* as the data. A separate process reads the outbox and publishes. Either both happen or neither does, and the publisher retries independently. The derived copy lags by the publisher's interval and cannot be lost.

**Change data capture.** Read the database's replication log and derive events from it. Nothing to write in the application at all, and it captures every committed change including those from other services and manual SQL — so it is a genuine owner in a way application-level publishing is not.

Both convert "two writes that might disagree" into "one write plus a replayable stream", which is the move that makes the problem tractable.

## Rebuild paths, concretely

A rebuild path is not a document describing how you would recompute. It is a runnable job, tested, that has been executed at least once against production-scale data.

Three properties it needs:

**Idempotent.** Running it twice produces the same result as running it once, so a partial failure can simply be re-run.

**Incremental or resumable.** A rebuild over 200 million rows cannot be a single transaction. It must checkpoint, and it must be safe to stop and resume.

**Runnable without downtime**, or with a downtime you have actually measured. A rebuild path you cannot execute because it would lock the table for four hours is not a rebuild path.

And it should do double duty: the same job that rebuilds should be able to run in **compare mode**, reporting divergence without fixing it. That is your drift detector, and it costs almost nothing once the rebuild exists.

## Staleness budgets

State the budget as a number, because the number determines the mechanism.

| Budget | Mechanism |
| --- | --- |
| Zero — must be exact | Same transaction, on the same row. Nothing else qualifies. |
| Seconds | Change events or triggers, with lag monitoring. |
| Minutes | A periodic job. Simplest thing that works. |
| Hours | A nightly recompute. Often the right answer. |
| Explicitly unbounded | A cache with a TTL, where staleness is visible and self-correcting. |

The mistake is not choosing a wrong budget. It is not choosing one — which means nobody knows whether a five-minute lag is a problem, so nobody monitors it, so a broken consumer goes unnoticed for a month.

## When not to denormalise

**Before measuring.** An indexed aggregate over a small related set — an order's own line items, a post's own comments — is usually fast. Denormalising it optimises a query that was never slow, and buys a permanent drift risk.

**When the read is rare.** An hourly report does not justify a column paid for on every write. Move the query, do not pre-compute it.

**When a cache would do.** If a bounded staleness is acceptable, a cache self-corrects and a column does not. That difference is large and frequently ignored.

**When the aggregate is the whole feature.** If the entire product is aggregate queries, the answer is a read model or an analytical store, not a scattering of columns on operational tables.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'derived-decision',
      title: 'Deciding whether — and how — to derive',
      caption:
        'Notice that three of the branches never create a persistent copy. The rebuild-job question at the bottom is the honest gate: refusing it means you do not believe drift will happen, and that belief is always wrong.',
      code: `flowchart TD
    A[A read is too slow] --> B{Measured, or assumed?}
    B -->|Assumed| C["Measure first.<br/>An indexed aggregate over a<br/>small related set is usually fast."]
    B -->|Measured| D{Would an index or a<br/>different query shape fix it?}

    D -->|Yes| E[Do that. No copy created.]
    D -->|No| F{Is bounded staleness<br/>acceptable?}

    F -->|Yes, seconds to minutes| G["A cache with a TTL.<br/>Wrong for a bounded time,<br/>then self-corrects."]
    F -->|Must be exact| H{Can it be maintained in the<br/>same transaction, same row?}

    H -->|Yes| I["A column, owned by a trigger<br/>so cascades and manual SQL<br/>cannot bypass it"]
    H -->|No| J{Is it in another store?}

    J -->|Yes| K["Outbox or change data capture.<br/>Never a dual write."]
    J -->|No| L["A derived table, rebuilt<br/>periodically or by events"]

    I --> M{Will you write the<br/>reconciliation job?}
    K --> M
    L --> M
    M -->|No| N["Then do not create the copy.<br/>Refusing the job means you do<br/>not believe it will drift."]
    M -->|Yes| O["Owner, rebuild path,<br/>staleness budget. Ship it."]

    style C fill:#17272a,stroke:#35897e
    style E fill:#17272a,stroke:#35897e
    style G fill:#1c1814,stroke:#c99a4e
    style N fill:#2a1d1d,stroke:#b8383b
    style O fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'outbox-vs-dualwrite',
      title: 'Why a dual write cannot be made safe',
      caption:
        'Step through both. The point is structural rather than a matter of care: no ordering of two independent writes is safe, and the fix is to make it one write plus a replayable stream.',
      nodes: [
        { id: 'app', label: 'Application', kind: 'service', x: 0, y: 150, detail: 'Wants a change reflected in both the database and a search index. There is no ordering of two independent writes that survives a crash between them.' },
        { id: 'db', label: 'Primary database', kind: 'store', x: 210, y: 40, detail: 'The source of truth. Its transaction can only cover writes to itself, which is exactly why the second system is the problem.' },
        { id: 'idx', label: 'Search index', kind: 'external', x: 460, y: 30, detail: 'A separate system. A failed update here leaves it stale forever — nothing retries, and nothing notices, because the database transaction succeeded.' },
        { id: 'outbox', label: 'Outbox table', kind: 'store', x: 210, y: 250, detail: 'Written in the same transaction as the data, so either both land or neither does. This is the move that turns two independent writes into one.' },
        { id: 'pub', label: 'Publisher', kind: 'service', x: 440, y: 250, detail: 'Reads unpublished outbox rows and delivers them, retrying independently. Delivery is at-least-once, so the consumer must be idempotent.' },
        { id: 'cdc', label: 'Change data capture', kind: 'service', x: 440, y: 380, detail: 'Reads the replication log instead. Requires nothing from the application and captures every committed change — including from other services and manual SQL — so it is a genuine owner.' },
        { id: 'consumer', label: 'Index consumer', kind: 'service', x: 670, y: 300, detail: 'Applies changes to the index idempotently, and exposes lag as a metric. A consumer falling behind is the failure mode that hurts, because it is silent.' },
      ],
      edges: [
        { id: 'd1', source: 'app', target: 'db', label: 'UPDATE, COMMIT', kind: 'write' },
        { id: 'd2', source: 'app', target: 'idx', label: 'then update index', kind: 'write' },
        { id: 'd3', source: 'app', target: 'outbox', label: 'same transaction', kind: 'write' },
        { id: 'd4', source: 'outbox', target: 'pub', label: 'poll unpublished', kind: 'read' },
        { id: 'd5', source: 'pub', target: 'consumer', kind: 'async' },
        { id: 'd6', source: 'db', target: 'cdc', label: 'replication log', kind: 'read' },
        { id: 'd7', source: 'cdc', target: 'consumer', kind: 'async' },
        { id: 'd8', source: 'consumer', target: 'idx', label: 'idempotent apply', kind: 'write' },
      ],
      steps: [
        {
          id: 'w1',
          title: 'The dual write, and why care does not fix it',
          description:
            'Commit the row, then update the index. A crash between them leaves the index permanently stale. Reverse the order and you can index something never committed. There is no third ordering — the problem is that two systems cannot share one transaction.',
          nodes: ['app', 'db', 'idx'],
          edges: ['d1', 'd2'],
        },
        {
          id: 'w2',
          title: 'The outbox makes it one write',
          description:
            'The change record goes into an outbox table inside the same transaction as the data, so they cannot disagree. A separate publisher drains it and retries on its own schedule — the index now lags rather than diverging.',
          nodes: ['app', 'outbox', 'pub'],
          edges: ['d3', 'd4'],
        },
        {
          id: 'w3',
          title: 'Change data capture needs nothing from the application',
          description:
            'Reading the replication log captures every committed change, including ones made by other services or by hand. That makes it a genuine owner in a way application-level publishing is not — nothing can bypass it.',
          nodes: ['db', 'cdc'],
          edges: ['d6'],
        },
        {
          id: 'w4',
          title: 'And the consumer carries two obligations',
          description:
            'Delivery is at-least-once, so applying a change must be idempotent. And lag must be a monitored metric with an alert — a consumer stalled for hours leaves the index quietly wrong rather than obviously broken.',
          nodes: ['pub', 'cdc', 'consumer', 'idx'],
          edges: ['d5', 'd7', 'd8'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The clearest production illustration is the counter — a comment count, a follower count, an unread badge — because it is the smallest possible piece of derived data and it still exhibits every failure in this lesson.

The naive version increments in application code alongside the insert. It works, and over months it drifts, and the drift comes from places nobody wrote code for:

**Cascading deletes.** A user is deleted for privacy reasons and a foreign key removes their comments. No application code ran, so no counter decremented. Every post they commented on is now over-counted, permanently.

**Bulk operations.** A moderation script removes spam directly in SQL. A data migration backfills historical rows. An import loads a partner's data. None of these go through the code path that owns the counter.

**Soft-delete semantics changing.** Comments become soft-deleted rather than removed, and the definition of "count" quietly becomes ambiguous — does the badge include deleted ones? The counter was written under one definition and read under another.

**Concurrency.** \`SELECT count\` followed by \`UPDATE SET count = $n + 1\` loses updates under concurrent inserts. The relative form is safe; the read-modify-write form is not, and both look correct in review.

Systems that get this right do one of three things, and the third is the most common in practice:

**Make the database the owner.** A trigger maintains the counter, so it participates in cascades, bulk SQL and every service. The cost is that the mechanism is invisible in the application, which people dislike for real reasons.

**Do not store it.** \`SELECT count(*) WHERE post_id = $1\` with an index on \`post_id\` is a fast, bounded query for a post's own comments, and it cannot drift. Most counters that exist should not.

**Store it and reconcile it nightly.** Accept drift, detect it within a day, correct it. This is the pragmatic answer at scale, and the important detail is that the reconciliation job must exist *from the start* — a counter added without one is a counter that will be wrong for six months before anyone notices.

Two transferable lessons:

**The writes you did not write are what break derived data.** Cascades, migrations, admin tools and other services all bypass application-level ownership. Which is why "we update it whenever we insert" is a statement about one code path and not about the system.

**A counter is the cheapest possible test of whether you are ready to own derived data.** If a single integer drifts, a materialised read model in a separate store certainly will.`,
  },

  tradeoffs: {
    intro:
      'Ordered by how far the copy sits from the transaction that produced it. Guarantees weaken and machinery grows as you move down.',
    rows: [
      {
        option: 'Do not derive: compute on read',
        whenItWins:
          'Aggregates over a small related set with a supporting index — an order\'s lines, a post\'s comments. Cannot drift, nothing to own.',
        whenItLoses:
          'Aggregates over large or unbounded sets, or a read hot enough that the repeated computation is measurable.',
        cost:
          'Query time on every read, and a query plan that can degrade as the related set grows.',
      },
      {
        option: 'A cache with a TTL',
        whenItWins:
          'When bounded staleness is acceptable. Uniquely among these options it self-corrects, so a bug produces temporary wrongness rather than permanent.',
        whenItLoses:
          'When the value must be exact, or when a cold cache would produce a load spike the source cannot absorb.',
        cost:
          'Staleness within the TTL, invalidation decisions, and a cold-start cost that sizes the source.',
      },
      {
        option: 'A derived column, owned by a trigger',
        whenItWins:
          'Same-row aggregates needing exact consistency. Maintained in the same transaction and unbypassable by cascades, bulk SQL or other services.',
        whenItLoses:
          'When the logic is complex enough that a trigger becomes hard to reason about, or when the team will not accept invisible mechanisms.',
        cost:
          'A mechanism absent from application code, harder to test, and surprising when it appears in a stack trace.',
      },
      {
        option: 'A derived table, rebuilt periodically',
        whenItWins:
          'Aggregates with a staleness budget of minutes or hours. By far the simplest correct option — no incremental logic, no ordering concerns.',
        whenItLoses:
          'When the budget is seconds, or when a full recompute becomes too expensive to run on schedule.',
        cost:
          'Bounded staleness, and a recompute whose cost grows with the data.',
      },
      {
        option: 'A copy in another store, via outbox or CDC',
        whenItWins:
          'Search indexes, analytical read models, cross-service projections. The only correct way to keep two systems in step.',
        whenItLoses:
          'When one store would serve both workloads. A pipeline is a system with its own silent failure modes.',
        cost:
          'Change capture, ordering, idempotent apply, replay capability, and lag monitoring with an alert.',
      },
      {
        option: 'A dual write',
        whenItWins:
          'Never. There is no ordering of two independent writes that survives a crash between them.',
        whenItLoses:
          'Always, eventually — and silently, because the database transaction succeeded.',
        cost:
          'Permanent divergence with no detection, presented as an optimisation.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We increment the counter in the same code path that inserts the row, so it stays accurate."',
      whyWeak:
        'That is a statement about one code path, not about the system. Cascading deletes, migrations, admin tools, bulk SQL and any second service all bypass it — and none of them will look like a bug, because no application code ran.',
      strongAnswer:
        '"Application code is only the owner if every write goes through it, and cascades and bulk operations mean it does not. For a same-row counter I would make a trigger the owner so it participates in every write path, and add a nightly job that recomputes and reports mismatches — or I would not store it at all, since counting a post\'s own comments with an index is fast."',
    },
    {
      weakAnswer: '"We update the database and then the search index. If the index update fails we log it and retry later."',
      whyWeak:
        'A dual write cannot be made safe by ordering or by logging. If the process dies between the two, there is nothing left to retry, and the database transaction already succeeded so nothing indicates a problem. Reversing the order lets you index uncommitted data instead.',
      strongAnswer:
        '"Two independent writes cannot be made atomic, so I would write a change record to an outbox table in the same transaction as the data and have a separate publisher deliver it with retries. Or use change data capture off the replication log, which additionally covers writes made by other services and by hand."',
    },
    {
      weakAnswer: '"The derived table is correct because the job that maintains it has no bugs."',
      whyWeak:
        'That is a claim about the current code, not about the six months during which schemas change, new writers appear and the job is modified. Derived data drifts, and the only question is whether you find out in a day or in a quarter.',
      strongAnswer:
        '"I assume it will drift and design for detection: the same job runs in compare mode nightly and reports divergence without fixing it. That is nearly free once the rebuild exists, and it turns a six-month silent problem into a next-morning alert."',
    },
    {
      weakAnswer: '"We denormalised the aggregate because the query was slow."',
      whyWeak:
        'Possibly right and unverifiable as stated. Slow compared with what, and was an index or a different query shape tried first? Denormalising an aggregate over a small related set optimises something that was probably fast and buys permanent drift risk.',
      strongAnswer:
        '"I measured it at 340 ms at p99 with an index on the join column, against a 50 ms budget on a page loaded 4,000 times a second. The order service owns the column, a nightly job recomputes and reports mismatches, and the tolerance is zero because it is money — so it is maintained in the same transaction."',
    },
    {
      weakAnswer: '"The read model lags by a few seconds, which is fine for our use case."',
      whyWeak:
        'Probably true and unmonitored. Without lag as a metric and an alert, "a few seconds" and "eleven hours because the consumer crashed on a malformed event" look identical from the outside — and the second one is discovered by a customer.',
      strongAnswer:
        '"A few seconds is the budget, so I would expose consumer lag as a first-class metric with an alert above that budget, and make the apply idempotent so replay is safe. Choosing a budget is what makes the lag monitorable — without a number, nobody knows whether the current lag is a problem."',
    },
    {
      weakAnswer: '"We store the product name on the order line so we do not need a join."',
      whyWeak:
        'The conclusion may be right and the reasoning is wrong, which matters because someone will later "fix" it by joining. If the copy is meant to record what was ordered, it is a snapshot and must not track the product. If it is meant to show the current name, it is denormalisation and needs an owner.',
      strongAnswer:
        '"The order line records the product name as it was at purchase, because an invoice must not change when a product is renamed. That is a snapshot, not denormalisation — it has no owner or rebuild path because it is deliberately not tracking anything. Avoiding the join is incidental."',
    },
  ],

  flashcards: [
    {
      id: 'fc-den-1',
      front: 'What are the three obligations of every derived copy?',
      back: 'An owner (exactly one writer), a rebuild path (recompute from the source), and a staleness budget (how wrong, for how long).',
      topic: 'derived-data',
    },
    {
      id: 'fc-den-2',
      front: 'What is the honest test for whether to create a derived copy?',
      back: 'Whether you will write the reconciliation job. Refusing it means you do not believe the copy will drift, and that belief is always wrong.',
      topic: 'derived-data',
    },
    {
      id: 'fc-den-3',
      front: 'How is a snapshot different from denormalisation?',
      back: 'A snapshot records what happened and is supposed not to track its source, so it needs no owner, rebuild path or staleness budget. Denormalisation is a copy meant to follow the original.',
      topic: 'denormalization',
    },
    {
      id: 'fc-den-4',
      front: 'Why is application code usually not the owner of a derived value?',
      back: 'Because cascading deletes, migrations, admin tools, bulk SQL and other services all write the source without going through it.',
      topic: 'derived-data',
    },
    {
      id: 'fc-den-5',
      front: 'What makes a database trigger a genuine owner?',
      back: 'It sees every write, including cascades, manual SQL and writes from other services. The cost is a mechanism invisible in application code.',
      topic: 'consistency',
    },
    {
      id: 'fc-den-6',
      front: 'Why can a dual write never be made safe?',
      back: 'Two independent writes cannot share a transaction, so a crash between them leaves them inconsistent — and no ordering avoids it, only swaps which failure you get.',
      topic: 'consistency',
    },
    {
      id: 'fc-den-7',
      front: 'How does a transactional outbox fix the dual-write problem?',
      back: 'The change record is written in the same transaction as the data, so either both land or neither. A separate publisher delivers it with retries, so the copy lags rather than diverging.',
      topic: 'consistency',
    },
    {
      id: 'fc-den-8',
      front: 'What does change data capture give you that application-level publishing does not?',
      back: 'It reads the replication log, so it captures every committed change including those from other services and manual SQL — nothing can bypass it.',
      topic: 'consistency',
    },
    {
      id: 'fc-den-9',
      front: 'What three properties does a real rebuild path need?',
      back: 'Idempotent so a partial failure can be re-run, resumable with checkpoints because it cannot be one transaction, and actually runnable — with measured downtime if any.',
      topic: 'derived-data',
    },
    {
      id: 'fc-den-10',
      front: 'What is the cheap dual use of a rebuild job?',
      back: 'Run it in compare mode: recompute and report divergence without fixing it. That is your drift detector, and it costs almost nothing once the rebuild exists.',
      topic: 'derived-data',
    },
    {
      id: 'fc-den-11',
      front: 'What makes a cache the easiest kind of derived data to live with?',
      back: 'It self-corrects. A bug produces wrongness for a bounded time and then refreshes, where a denormalised column stays wrong forever unless something notices.',
      topic: 'caching',
    },
    {
      id: 'fc-den-12',
      front: 'Why does the staleness budget determine the mechanism?',
      back: 'Zero means same transaction on the same row. Seconds means change events with lag monitoring. Minutes or hours means a periodic recompute — the simplest thing that works.',
      topic: 'read-models',
    },
    {
      id: 'fc-den-13',
      front: 'What is the real cost of not choosing a staleness budget?',
      back: 'Nobody knows whether the current lag is a problem, so nobody monitors it, so a stalled consumer goes unnoticed for weeks.',
      topic: 'read-models',
    },
  ],

  quiz: [
    {
      id: 'q-den-1',
      kind: 'scenario',
      prompt:
        'A `follower_count` column is incremented and decremented in the follow and unfollow endpoints. After a GDPR deletion job removes a user and cascades their follow rows, counts are wrong across hundreds of profiles. What was the design error?',
      options: [
        { id: 'a', label: 'Application code was treated as the owner, but a cascading delete writes the source without going through it' },
        { id: 'b', label: 'The counter should have used a bigger integer type' },
        { id: 'c', label: 'The deletion job should have been run during a maintenance window' },
        { id: 'd', label: 'The follow rows should not have had a foreign key' },
      ],
      correct: ['a'],
      explanation:
        'A cascade is a database operation, so no application code runs and no counter updates. This is the defining failure of application-level ownership: it is a claim about one code path, not about the system. A trigger would participate in the cascade; a reconciliation job would have caught it within a day.',
      difficulty: 'core',
      topic: 'derived-data',
    },
    {
      id: 'q-den-2',
      kind: 'scenario',
      prompt:
        'A service commits an order then calls the search index. Occasionally an order is missing from search. A colleague proposes calling the index first, then committing. What happens?',
      options: [
        { id: 'a', label: 'You trade missing entries for indexing orders that were never committed — the problem is that two systems cannot share a transaction' },
        { id: 'b', label: 'It fixes the problem, since the index is now updated first' },
        { id: 'c', label: 'It fixes the problem only if the index supports transactions' },
        { id: 'd', label: 'It has no effect either way' },
      ],
      correct: ['a'],
      explanation:
        'Reversing a dual write swaps the failure mode rather than removing it: now a rollback after a successful index update leaves a phantom entry. No ordering is safe, which is why the resolution is structural — an outbox written in the same transaction, or change data capture.',
      difficulty: 'core',
      topic: 'consistency',
    },
    {
      id: 'q-den-3',
      kind: 'single',
      prompt: 'Which of these is a snapshot rather than denormalisation?',
      options: [
        { id: 'a', label: '`order_lines.unit_price_at_purchase`' },
        { id: 'b', label: '`posts.comment_count`' },
        { id: 'c', label: '`users.current_plan_name` copied from the plans table' },
        { id: 'd', label: '`customers.total_lifetime_spend`' },
      ],
      correct: ['a'],
      explanation:
        'The price at purchase records what happened and must not change when the product price does — no owner, no rebuild path, nothing to keep in sync. The other three are copies meant to track their sources, so each needs an owner, a rebuild path and a staleness budget.',
      difficulty: 'intro',
      topic: 'denormalization',
    },
    {
      id: 'q-den-4',
      kind: 'scenario',
      prompt:
        'A read model in a search engine is fed by change events. It has been stale for nine hours because the consumer crashed on a malformed event. Nobody noticed. What was missing?',
      options: [
        { id: 'a', label: 'A stated staleness budget with consumer lag exposed as a metric and alerted above it' },
        { id: 'b', label: 'A larger consumer instance' },
        { id: 'c', label: 'Ordering guarantees on the event stream' },
        { id: 'd', label: 'A schema registry on the events' },
      ],
      correct: ['a'],
      explanation:
        'Without a number, "a few seconds of lag" and "nine hours" are indistinguishable from outside, so nothing alerts. A schema registry would have prevented the malformed event and is a second, complementary fix — but the reason nobody noticed is the absent budget and the missing lag metric.',
      difficulty: 'advanced',
      topic: 'read-models',
    },
    {
      id: 'q-den-5',
      kind: 'scenario',
      prompt:
        'A team wants to denormalise "number of comments" onto posts. Comments per post average 8, with a maximum of about 500, and there is an index on `comments(post_id)`. What is the strongest response?',
      options: [
        { id: 'a', label: 'Measure the count query first — an indexed count over at most 500 rows is likely fast, and the column buys permanent drift risk' },
        { id: 'b', label: 'Agree, and maintain it in application code' },
        { id: 'c', label: 'Agree, and maintain it with a trigger' },
        { id: 'd', label: 'Agree, but only if a reconciliation job is added' },
      ],
      correct: ['a'],
      explanation:
        'An indexed count over a bounded, small related set is usually a sub-millisecond index-only scan. Denormalising it optimises a query that was probably never slow while creating a value that will drift through cascades and bulk operations. Options (c) and (d) are the right way to do it *if* measurement justifies it — the error is skipping the measurement.',
      difficulty: 'core',
      topic: 'denormalization',
    },
    {
      id: 'q-den-6',
      kind: 'multi',
      prompt:
        'Which of these are mechanisms that can legitimately own a derived value? Select all that apply.',
      options: [
        { id: 'a', label: 'A database trigger, because it sees cascades and manual SQL' },
        { id: 'b', label: 'A change-event consumer reading the replication log' },
        { id: 'c', label: 'A periodic job that recomputes from scratch' },
        { id: 'd', label: 'Application code, when all current writers go through it' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three see every write, or recompute from the source so bypassed writes do not matter. Application code fails the test not because it is wrong today but because "all current writers" excludes cascades, migrations, admin tools and the service someone adds next quarter.',
      difficulty: 'core',
      topic: 'derived-data',
    },
  ],

  exercises: [
    {
      id: 'ex-den-1',
      kind: 'design',
      title: 'Own four derived values properly',
      estimatedMinutes: 22,
      prompt: `A marketplace has four derived values, all currently maintained in application code with no reconciliation:

1. \`sellers.active_listing_count\` — shown on every seller profile.
2. \`orders.total_minor\` — the sum of order line amounts. Used by finance.
3. A search index of listings in a separate search engine — the main browse experience.
4. \`sellers.average_rating\` — shown in listings, computed from reviews.

Facts: listings are deleted by cascade when a seller is removed; a nightly import creates orders in bulk via SQL; reviews can be edited and soft-deleted; the search engine is queried 8,000 times/second; finance reconciles order totals against payments monthly.

For each value produce: the staleness budget as a number with justification, the owner, the rebuild path, and how drift is detected. Then say which one you would fix first and why.`,
      rubric: [
        'Assigns a numeric staleness budget per value, justified by who reads it and what a wrong value costs.',
        'orders.total_minor: budget zero, maintained in the same transaction, because finance reconciles it against money.',
        'active_listing_count: identifies the cascade as bypassing application code and prescribes a trigger or periodic recompute.',
        'Search index: identifies the dual write, prescribes outbox or CDC, and requires idempotent apply plus lag monitoring.',
        'average_rating: notices edits and soft deletes make incremental maintenance fragile and prefers periodic recompute.',
        'Every value has a concrete rebuild path plus a compare mode for drift detection.',
        'Prioritises orders.total_minor with reasoning about money and reconciliation rather than by listing order.',
      ],
      modelAnswer: `**1. \`sellers.active_listing_count\`**

*Budget: 5 minutes.* It is a display number on a profile. A seller seeing "11 listings" for a few minutes after publishing a twelfth is invisible; nothing downstream makes a decision on it.

*Owner:* a periodic recompute, every 5 minutes, over sellers whose listings changed. **Not** application code, because listings are cascade-deleted when a seller is removed and no application code runs for that. A trigger would also work and is more machinery than a 5-minute budget needs.

*Rebuild path:* the same job with no incremental filter — recompute for all sellers. At marketplace scale this is a single grouped aggregate, so it runs in seconds and is trivially idempotent.

*Drift detection:* the recompute *is* the correction, so drift is bounded by construction. I would still log the number of rows it changed: a sudden spike means a new writer appeared.

**2. \`orders.total_minor\`**

*Budget: zero.* Finance reconciles it against payments monthly. A wrong total is a financial discrepancy, and discovering it a month later means a reconciliation investigation.

*Owner:* maintained in the **same transaction** as line insertion, and enforced by a trigger rather than application code — because the nightly bulk SQL import bypasses the application entirely. Plus a \`CHECK\` that the total is non-negative as a backstop.

*Rebuild path:* recompute from \`order_lines\` grouped by \`order_id\`, in batches by id range with checkpoints. It must be resumable: this is the largest table involved and a single transaction is not viable.

*Drift detection:* the rebuild job in **compare mode**, nightly, reporting every order where the stored total disagrees with the computed sum. Zero tolerance — any mismatch pages someone, because it is money.

**3. The search index**

*Budget: 30 seconds.* It is the main browse experience, so a newly published listing appearing within half a minute is acceptable; several minutes would produce "my listing is missing" support tickets.

*Owner:* a change-event consumer. Right now this is a dual write and it is losing updates silently. I would use **change data capture** off the replication log rather than an application-level outbox, specifically because the nightly bulk SQL import writes listings without going through the application — CDC captures those and an outbox would not.

*Rebuild path:* a full reindex from the primary, written to a new index alias and swapped atomically. This must be run and timed before it is needed; a reindex you have never executed is not a rebuild path.

*Drift detection:* consumer lag as a first-class metric, alerting above 30 seconds. Plus a nightly count comparison between primary and index, and a sampled field-level comparison — lag monitoring catches a stalled consumer, and only comparison catches a consumer that is running and applying changes wrongly.

*Apply must be idempotent*, because CDC delivery is at-least-once and a replay after a restart will re-deliver.

**4. \`sellers.average_rating\`**

*Budget: 1 hour.* It is a display value; ratings move slowly and an hour-old average is indistinguishable to a buyer.

*Owner:* a periodic recompute, hourly. Incremental maintenance is a poor fit here and it is worth saying why: reviews can be **edited** and **soft-deleted**, so an incremental update would need to know the previous value to adjust the average correctly, and the soft-delete semantics make "which reviews count" a definition that will change. A recompute is immune to all of that — it simply reads the current truth.

*Rebuild path:* the same job over all sellers.

*Drift detection:* bounded by the recompute, as with the listing count. I would also store the review count alongside the average, so a rating with a suspiciously low count is visible in the UI rather than presenting "5.0 from one review" as equivalent to "4.8 from four hundred".

**Which I would fix first: \`orders.total_minor\`.**

Two reasons that compound. It is the only one where a wrong value is a **financial discrepancy** rather than a cosmetic one — the others produce a slightly wrong number on a page, and this one produces a reconciliation failure that someone has to investigate manually. And the bulk SQL import means it is **actively drifting right now** in a way nobody is measuring, so the longer it waits, the larger the backlog of wrong orders that a future rebuild has to correct.

Second would be the search index, because a dual write is silently losing updates on the main browse experience and CDC plus lag monitoring converts that into something observable. The two counters are last: their budgets are generous, a recompute fixes them by construction, and the fix is a scheduled job rather than an architectural change.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-den-1',
      level: 'basic',
      question: 'When would you denormalise?',
      guidance:
        'After measuring, when an index or query change will not fix it, and only with an owner, a rebuild path and a staleness budget. A candidate who answers "when reads are slow" without the three obligations has described the optimisation and not the commitment.',
    },
    {
      id: 'iq-den-2',
      level: 'basic',
      question: 'What is the difference between a snapshot and a denormalised copy?',
      guidance:
        'A snapshot records what happened and is meant not to track its source, so it needs no owner or rebuild path. A denormalised copy is meant to follow the original. A strong answer gives an example of each and notes that confusing them leads someone to "fix" a snapshot by joining.',
    },
    {
      id: 'iq-den-3',
      level: 'intermediate',
      question: 'You need a search index kept in step with your database. How?',
      guidance:
        'Outbox or change data capture, never a dual write. Look for the reasoning that two writes cannot share a transaction so no ordering is safe. Strong answers prefer CDC when other services or bulk SQL also write the source, and require idempotent apply plus lag monitoring.',
    },
    {
      id: 'iq-den-4',
      level: 'intermediate',
      question: 'Who should own a derived counter?',
      guidance:
        'Whichever mechanism sees every write. A strong answer rules out application code by naming cascades, migrations, bulk SQL and other services, then chooses a trigger or a periodic recompute depending on the staleness budget.',
    },
    {
      id: 'iq-den-5',
      level: 'advanced',
      question: 'A derived value has been wrong for six months. How would you have found it sooner?',
      guidance:
        'A rebuild job running nightly in compare mode, reporting divergence. Excellent answers note this is nearly free once the rebuild exists, and that its absence means nobody believed the value would drift — which is the actual design error.',
    },
    {
      id: 'iq-den-6',
      level: 'advanced',
      question: 'How do you decide the mechanism for maintaining derived data?',
      guidance:
        'From the staleness budget: zero means same transaction on the same row; seconds means change events with lag monitoring; minutes or hours means a periodic recompute. Excellent answers note that a periodic recompute is far more often correct than chosen, because it is immune to edits, soft deletes and definition changes.',
    },
    {
      id: 'iq-den-7',
      level: 'followup',
      question: 'You said a rebuild path is required. What makes one real?',
      guidance:
        'Idempotent, resumable with checkpoints, and actually executed at production scale at least once. A strong answer points out that a rebuild you cannot run — because it would lock a table for hours — is not a rebuild path, and that the same job should support compare mode.',
    },
    {
      id: 'iq-den-8',
      level: 'followup',
      question: 'Why is a cache easier to live with than a denormalised column?',
      guidance:
        'It self-corrects: a bug produces bounded wrongness that a TTL clears, whereas a column stays wrong until something notices. A strong answer notes the trade — a cold cache produces a load spike that sizes the source — so it is easier to live with rather than strictly better.',
    },
  ],

  activeLearning: [
    {
      id: 'al-den-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson treated the normalised tables as the source of truth and derived copies as secondary. Now invert it: an append-only event log is the source of truth, and *every* queryable table is a projection derived from it. What gets easier, what gets harder, and what obligation does not go away?',
      discussion: `This is event sourcing, and inverting the direction changes which problems are structural.

**What gets easier:**

*Rebuild paths become free and universal.* Every projection is defined as a function of the log, so rebuilding any of them is replaying events. You no longer have to write a bespoke recompute per derived value — you have one mechanism, exercised constantly, which is the opposite of a rebuild job nobody has ever run.

*New projections are cheap and retrospective.* A reporting question that arrives two years late can be answered by building a new projection and replaying history through it. In the normalised world, the data needed to answer it may simply not have been recorded.

*Ownership is unambiguous.* Exactly one thing writes the log; everything else derives. The "who owns this copy" question that dominates this lesson largely dissolves — there is one writer by construction.

*Audit and debugging improve substantially.* You can reconstruct the state at any past moment, which turns "how did this row end up like this" from archaeology into a query.

**What gets harder:**

*Every read is eventually consistent.* A command appends an event; the projection updates asynchronously. A user who acts and immediately reads may not see their own write. This is the largest practical cost and it must be designed around — usually by reading from the command side, or by having the client hold the expected version.

*The log's schema is permanent.* An event once written cannot be changed, and every future projection must handle every historical event shape. Versioned events and upcasting are ongoing work, and a badly designed event is permanent in a way a badly designed column is not.

*Replay cost grows without bound.* Rebuilding from the beginning gets slower forever. Snapshots — periodic checkpoints of projection state — become necessary, and now you have derived data with the same three obligations, one level up.

*Reasoning becomes harder for everyone.* "Where does this number come from" requires understanding the log and the projection, not reading a table. This is a real team cost and it is frequently underestimated.

**The obligation that does not go away: staleness budgets and lag monitoring.**

Every projection lags. The mechanism is now uniform rather than bespoke, which is an improvement — but a stalled projection consumer is exactly the same silent failure as a stalled search-index consumer. You still need a budget per projection and an alert on lag, and you now need it for *every* queryable surface rather than a handful of derived columns.

And drift detection does not disappear either. A projection can be *running* and applying events *incorrectly* — a bug in the fold function — and lag monitoring will not notice. Comparing a projection against a fresh replay is the equivalent of compare mode, and it is still work.

**Transferable:** inverting the direction of derivation makes rebuilds universal and consistency universal too. It trades bespoke per-value machinery for one uniform mechanism plus permanent event-schema obligations. Which is a good trade for domains where history is the product — ledgers, audit, anything regulated — and a poor one where the read is simple and the team is small.`,
    },
    {
      id: 'al-den-2',
      kind: 'debug',
      prompt:
        'A search index fed by change data capture is reported as "missing recent listings". Consumer lag is 200 ms and stable. The primary database has the listings. The reindex job, run manually, fixes it — and a week later the same listings are missing again. What is your hypothesis?',
      discussion: `Lag is healthy and a full reindex fixes it, so the consumer is keeping up with the stream and getting these particular records wrong. That combination points at the *content* of the change, not at the pipeline's throughput.

**Leading hypothesis: the consumer is silently dropping a class of event.**

Something about these listings makes the apply fail or skip, and the consumer swallows it. Candidates, in order of likelihood:

- **An unhandled event type.** Perhaps these listings are created by a path that produces an \`INSERT\` on a different table, or a bulk operation that CDC reports differently, and the consumer's switch statement has no branch for it — so it acknowledges and moves on.
- **A field that fails validation or serialisation.** A null in an unexpected place, an out-of-range value, a character the index rejects. If the consumer catches the exception per-record and continues, lag stays perfect and records vanish.
- **A filter that is wrong.** The consumer may skip records it considers irrelevant — inactive, draft, missing a category — and the predicate does not match what the browse experience actually shows.

The reindex fixes it because a full rebuild reads from the primary and does not go through the event-shaped path, so it does not hit the same branch.

**Second hypothesis: an ordering or delete/re-create race.** If a listing is created, immediately updated, and CDC delivers those out of order — or if a delete for a reused id arrives after the insert — the consumer may apply them in an order that leaves the record absent. Plausible if the events are partitioned by something other than the listing id.

**Third hypothesis: index-side TTL or eviction.** Some search configurations expire documents. Worth ruling out cheaply.

**What I would measure:**

1. **Per-record apply outcomes.** The consumer almost certainly logs errors somewhere and almost certainly does not *count* them as a metric. A counter of skipped and failed applies, by reason, is the decisive instrument — and its absence is why this bug survived a week.
2. **Take one missing listing and trace it end to end:** find its change event in the log, and confirm whether the consumer received it, what branch it took, and what it did. One record traced beats any amount of aggregate reasoning.
3. **Whether the missing listings share a property** — creation path, category, a null field, a character set. That will name the branch.

**The structural fixes, and both matter:**

**Never swallow an apply failure.** A record that cannot be indexed goes to a dead-letter store with its reason, and the dead-letter depth is a monitored metric. Silently continuing is what converted a handled error into a week-long invisible bug.

**Add drift detection that lag monitoring cannot provide.** A nightly count comparison between primary and index, plus a sampled field-level comparison. This is the compare-mode idea: lag tells you the consumer is *running*, and only comparison tells you it is *correct*. This incident is precisely the gap between those two, and it is the most common blind spot in change-event pipelines.

**Transferable:** healthy lag is not evidence of a healthy projection. A consumer can be perfectly current and perfectly wrong, and the two require different instruments — throughput monitoring for the pipeline, content comparison for the result.`,
    },
  ],

  revision: {
    bullets: [
      'Denormalisation always works and always creates the same problem: two places can disagree and neither errors.',
      'Three obligations per copy: an owner, a rebuild path, a staleness budget.',
      'The honest test: if you will not write the reconciliation job, do not create the copy.',
      'A snapshot is not denormalisation — it records what happened and is meant not to track its source.',
      'Four places derived data lives: same-row column, derived table, another store, a cache. Guarantees weaken as it moves further from the transaction.',
      'The owner is whatever sees every write. Application code does not, because of cascades, migrations, bulk SQL and other services.',
      'A trigger is a genuine owner and costs a mechanism invisible in application code.',
      'Change data capture is a genuine owner too, and covers writes made by other services and by hand.',
      'A dual write cannot be made safe: two writes cannot share a transaction, and reversing the order only swaps the failure.',
      'A transactional outbox makes it one write plus a replayable stream.',
      'A rebuild path must be idempotent, resumable, and actually executed at production scale.',
      'Run the rebuild in compare mode nightly — that is your drift detector, and it is nearly free.',
      'The staleness budget determines the mechanism: zero means same transaction, seconds means change events, minutes means a periodic recompute.',
      'A periodic recompute is correct far more often than it is chosen, and it is immune to edits, soft deletes and definition changes.',
      'A cache is the easiest derived data to live with because it self-corrects; a column stays wrong forever.',
      'Not choosing a budget means nobody monitors lag, so a stalled consumer goes unnoticed for weeks.',
      'Healthy lag is not evidence of a healthy projection — a consumer can be current and wrong, and only comparison catches that.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Storing a fact in more than one place, or in a shape optimised for reading, so that a query becomes cheaper — at the cost of the copies being able to disagree.',
    whyItExists:
      'Some read patterns cost more than the system can pay, and precomputing the answer moves that cost to write time where it can be amortised.',
    whenToUse: [
      'After measuring a read cost that an index or query change will not fix.',
      'Read models in another store for search or analytics, where the operational shape cannot serve the query at all.',
      'Snapshots for anything recording an event — which is correctness, not optimisation.',
    ],
    whenNotToUse: [
      'Before measuring, especially for aggregates over small indexed related sets.',
      'For rare reads, where moving the query beats pre-computing it.',
      'When a cache with a TTL would do, since it self-corrects and a column does not.',
      'When you will not write the reconciliation job.',
    ],
    alternatives: [
      'An index or a different query shape, which creates no copy at all.',
      'A cache with a TTL: bounded staleness that self-corrects.',
      'A periodic full recompute: no incremental logic, immune to edits and definition changes.',
      'Event sourcing, where every queryable table is a projection and rebuild is replay.',
    ],
    tradeoffs: [
      'A same-row column buys exact consistency in-transaction and costs a trigger or a drift risk.',
      'A derived table buys simplicity and costs bounded staleness.',
      'A copy in another store buys query capability the source cannot provide and costs a pipeline that fails quietly.',
      'A cache buys self-correction and costs a cold-start load spike on the source.',
    ],
    failureModes: [
      'A cascading delete or bulk SQL bypassing application-level ownership.',
      'A dual write losing an update silently because the database transaction succeeded.',
      'A read-modify-write counter losing increments under concurrency.',
      'A change-event consumer stalled for hours with no lag alert.',
      'A consumer perfectly current and silently dropping a class of event.',
      'A rebuild path that has never been run and cannot be, because it would lock the table.',
      'A staleness budget never chosen, so nothing is monitored.',
    ],
    followUpQuestions: [
      'Who owns this value, and does that mechanism see cascades and bulk SQL?',
      'What is the rebuild path, and when was it last run?',
      'What is the staleness budget, as a number, and what alerts above it?',
      'How would you find out that this copy has drifted?',
      'Is this a snapshot of what happened, or a copy meant to track its source?',
      'Did you measure the query before pre-computing it?',
    ],
  },
});
