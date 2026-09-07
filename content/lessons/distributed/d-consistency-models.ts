import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-consistency-models',
  title: 'Linearizable → causal → eventual',
  summary:
    'The models form a lattice, not a dial, and consistency is a different axis from transaction isolation — which is why "serializable" and "linearizable" are neither synonyms nor comparable, and why the model you need is per-operation.',
  phase: 'distributed',
  module: 'data-at-scale',
  position: 27,
  kind: 'concept',
  difficulty: 'advanced',
  estimatedMinutes: 50,
  tags: ['consistency-models', 'linearizability', 'causal-consistency', 'isolation', 'session-guarantees'],
  prerequisites: ['d-cap-pacelc'],
  resources: [
    {
      key: 'jepsen-consistency',
      tier: 'must',
      note: 'The definitive map: every model, its precise definition, and which models imply which. Keep it open while reading this lesson — the relationships are the substance and this is where they are stated exactly.',
    },
    {
      key: 'postgres-transaction-iso',
      tier: 'must',
      note: 'Read this specifically to see that isolation levels are a separate axis. Serializable is the strongest isolation level and says nothing about whether reads see the latest committed write across replicas.',
    },
    {
      key: 'ddia-book',
      tier: 'must',
      note: 'Read the chapter on consistency and consensus, especially the sections distinguishing linearizability from serializability and the treatment of causality and total order.',
    },
    {
      key: 'spanner-paper',
      tier: 'good',
      note: 'Read the section on external consistency, which is linearizability plus serializability together — the combination most people mean when they say "strongly consistent".',
    },
    {
      key: 'crdt-tech',
      tier: 'good',
      note: 'Data types that converge without coordination. Read it as the answer to "what if I want availability and still want a defined result" — the model is strong eventual consistency.',
    },
    {
      key: 'postgres-explicit-locking',
      tier: 'advanced',
      note: 'Read the sections on row-level locks and on serialization failures. Useful for seeing what a database actually does to give you the isolation level you asked for, and what it costs.',
    },
  ],

  intuition: {
    body: `The previous lesson established that the consistency choice is per operation. This lesson is about **what you are choosing between**, precisely, because the vocabulary is where almost all confusion in this area lives.

Three ideas make the rest tractable.

**1. The models form a lattice, not a dial.** People picture a slider from "strong" to "weak". It is closer to a partial order: some models are strictly stronger than others, and some are **incomparable** — neither implies the other. Read-your-writes and monotonic reads are incomparable; you can have either, both, or neither. Knowing which pairs are incomparable is what lets you compose exactly the guarantees you need instead of over-buying.

**2. Consistency and isolation are different axes.** This is the single most useful distinction in the lesson.

- **Consistency models** (linearizable, causal, eventual) are about **single-object operations across replicas**: when I read this key, what values may I see?
- **Isolation levels** (read committed, snapshot, serializable) are about **multi-object transactions on one logical copy**: what can a transaction observe of other concurrent transactions?

They are orthogonal. A system can be **serializable but not linearizable** — a snapshot-isolated read replica gives a transactionally coherent view of a *stale* moment. And a system can be **linearizable but not serializable** — every individual key read is fresh, and two multi-key operations still interleave badly. "Strongly consistent" usually means both, and the term for both together is **strict serializability** (Spanner calls it external consistency).

**3. The interesting question is not "how strong" but "what anomaly am I preventing".** Each model exists because it forbids a specific observable behaviour. Reasoning from anomalies is concrete and reasoning from strength labels is not: "I need to prevent a user seeing their own edit vanish" leads directly to read-your-writes, while "I need strong consistency" leads to a distributed transaction you did not need.

The framing to carry: **name the anomaly you must forbid, find the weakest model that forbids it, and check whether you also need an isolation level — because those are two separate purchases.**`,
    analogyLimit:
      'The "strength dial" picture is the thing to discard. It implies every model is comparable, so you can always ask for "one notch weaker" — but read-your-writes and monotonic reads are incomparable, and choosing between them is a question about which anomaly you care about rather than about strength. The dial also hides the second axis entirely, which is why teams that have tuned a consistency level are still surprised by a write-skew bug that only an isolation level prevents.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team runs a serializable relational primary with a snapshot-isolated read replica. A doctor-scheduling feature enforces "at least one doctor must remain on call". Two doctors simultaneously go off call through requests handled by two different application servers. Both requests read the replica to check the invariant, then write to the primary. Both succeed and nobody is on call. Which model would have prevented this, and which would not?',
      answer: `**What happened, precisely.** This is **write skew**, and it needs both axes to explain.

Each request read the replica and saw two doctors on call, so removing one leaves one — the invariant holds. Each then wrote to the primary. The writes touch *different rows*, so nothing conflicts: no unique constraint, no row-level lock contention, no version conflict. Both commit. The invariant is now violated by a state neither transaction could observe.

The essential property: **the two transactions read a set of rows, made a decision based on the whole set, and wrote to disjoint rows.** No single-row mechanism catches that, because no single row was concurrently modified.

**Which models would NOT have prevented it, and why — this is the instructive part.**

**Linearizability would not.** Linearizability is a *single-object* property: every read of a key returns the most recent write to that key. Both transactions read fresh, correct values for every row they read. The failure is not a stale read; it is two decisions made on the same valid snapshot. **This is the most common misconception in this area** — reaching for linearizability against write skew.

**Read-your-writes would not.** Neither transaction is trying to observe its own write.

**Causal consistency would not.** The two transactions are genuinely concurrent with no causal relationship, so there is no causal order to violate.

**Reading the primary instead of the replica would not.** It would remove the staleness and leave the skew exactly as it is. If both requests had read the *primary* and seen two doctors on call, both would still have proceeded. This is worth stating plainly, because "read the primary" is the reflex fix and here it does nothing.

**What WOULD have prevented it.**

**Serializable isolation on the transaction that does the read and the write.** Under serializability the outcome must equal *some* sequential execution of the two transactions. In any sequential order, the second one sees one doctor remaining and must fail. A serializable engine detects this — via predicate locking or by detecting the read-write dependency cycle at commit — and aborts one transaction with a serialization failure.

**The critical detail the team missed: they had a serializable primary and did not use it.** Reading the replica put the read outside the transaction's serializable scope. The engine cannot detect a conflict on a read it never saw. **Serializability protects the reads and writes inside a transaction, not decisions made from data fetched elsewhere.**

**The cheaper alternatives, in ascending order of cost:**

1. **Materialise the conflict.** Keep a row \`on_call_count\` and have each transaction update it with a check. Now both transactions write the *same* row, so it becomes an ordinary write conflict that read-committed plus a conditional update catches. This is the standard technique for turning write skew into something a weak isolation level can handle, and it is usually the right answer.
2. **Explicitly lock the read set** — \`SELECT ... FOR UPDATE\` on the on-call doctors — so the second transaction blocks until the first commits and then re-reads.
3. **Serializable isolation**, with both the read and the write inside the transaction, and retry logic for serialization failures.

**The general lesson.** *Which axis is the anomaly on?* A stale read is a consistency-model problem. A decision made across several rows is an isolation problem. Write skew is on the isolation axis, so no consistency model at any strength prevents it — and a team that only knows the consistency vocabulary will tune replicas forever without fixing it.`,
    },
  body: `## The models, precisely, from strongest down

**Strict serializability (external consistency).** Transactions appear to execute in a single total order, and that order is consistent with real time. This is linearizability and serializability together, and it is what people usually mean by "strongly consistent". Spanner provides it globally; the cost is a commit wait and cross-region coordination.

**Linearizability.** A *single-object* property. Every operation appears to take effect atomically at some instant between its invocation and its response, and a read returns the value of the most recent completed write. Equivalent to "there appears to be one copy". Requires consensus or a quorum with \`R + W > N\`.

What it does **not** give you: anything about multi-object operations. Two linearizable single-key operations can still interleave to break a cross-key invariant.

**Sequential consistency.** All operations appear in *some* total order, and each process's operations appear in its own program order — but the total order need not match real time. So a write can become visible later than it happened, as long as everyone agrees on the order. Weaker than linearizability, and rarely offered as a product feature.

**Causal consistency.** If operation A causally precedes B, everyone observes A before B. Concurrent operations may be observed in different orders by different clients. This forbids the "reply before the comment" anomaly and permits a great deal of freedom otherwise.

The important property: **causal consistency is the strongest model available without sacrificing availability during a partition.** That is a real theoretical result and it is why causal consistency is the ceiling for genuinely AP systems.

**Session guarantees.** Per-client properties, and — crucially — **mutually incomparable**:

- **Read-your-writes**: a client's own writes are visible to its subsequent reads.
- **Monotonic reads**: a client never sees a value older than one it already saw.
- **Monotonic writes**: a client's writes are applied in the order it issued them.
- **Writes-follow-reads**: if a client reads a value then writes, the write is ordered after the value it read.

You can have any subset. **Causal consistency is exactly all four together**, which is a much more useful way to remember causal consistency than any abstract definition.

**Eventual consistency.** If writes stop, replicas converge. Nothing else.

**Strong eventual consistency.** Replicas that have received the same set of updates are in the same state, with **no conflict resolution required** — the merge is deterministic by construction. This is what CRDTs provide, and it is a genuinely different thing from eventual consistency: convergence is guaranteed by the data type's algebra rather than by a resolution policy someone has to write.

## The lattice: which models imply which

\`\`\`
strict serializability
  ├── linearizability (single-object)
  │     └── sequential consistency
  │           └── causal consistency
  │                 ├── read-your-writes      ─┐
  │                 ├── monotonic reads        │ mutually
  │                 ├── monotonic writes       │ incomparable
  │                 └── writes-follow-reads   ─┘
  │                       └── eventual consistency
  └── serializability (multi-object)
\`\`\`

Three things to read from this:

**Linearizability and serializability are siblings, not a hierarchy.** Neither implies the other. Strict serializability is their conjunction.

**The four session guarantees are incomparable.** You can have monotonic reads without read-your-writes. Choosing among them is a question about anomalies, not strength.

**Causal consistency is their conjunction**, and is the strongest available while staying available under partition.

## Isolation levels: the other axis

| Level | Prevents | Still permits |
| --- | --- | --- |
| Read uncommitted | Nothing much | Dirty reads |
| Read committed | Dirty reads | Non-repeatable reads, lost updates, write skew |
| Snapshot / repeatable read | Dirty and non-repeatable reads | **Write skew**, phantoms (implementation-dependent) |
| Serializable | Everything above | Nothing, at the cost of aborts or locking |

The anomalies worth being able to name:

**Dirty read.** Reading uncommitted data that may be rolled back.

**Non-repeatable read.** Reading the same row twice in one transaction and getting different values.

**Lost update.** Two transactions read a value, both compute a new one, the second overwrites the first. The remedy is an atomic operation or a conditional update, not a stronger isolation level — this is the read-modify-write problem from the Redis lesson.

**Write skew.** Two transactions read overlapping sets, decide based on the whole set, and write to *disjoint* rows. No row conflicts, so only serializable isolation or explicit locking catches it. **Snapshot isolation permits it**, and snapshot isolation is the default in several popular databases — which is why this anomaly is common in production.

**Phantom read.** A transaction's second query over a predicate returns rows the first did not, because another transaction inserted them.

The practical rule: **if a decision depends on the absence of something, or on the state of a set of rows, snapshot isolation is not enough.** That covers uniqueness checks, capacity checks, "at least one must remain" invariants, and non-overlapping booking constraints.

## Choosing: reason from anomalies

For each operation, ask what must not be observable:

| Anomaly you must forbid | The model that forbids it |
| --- | --- |
| A user not seeing their own edit | Read-your-writes |
| A value regressing between reads | Monotonic reads |
| A reply appearing before its comment | Causal consistency |
| Two clients disagreeing about the current value | Linearizability |
| Two concurrent operations both passing a check on a set | Serializable isolation |
| A read-modify-write losing an update | An atomic operation or a conditional write |
| Divergent replicas needing manual resolution | Strong eventual consistency (a CRDT) |

Then find the **weakest** model that forbids it, because strength costs latency and availability. Over-buying is the common error and it is invisible — nobody notices that a page is 40 ms slower than it needed to be.

Two implementation notes that matter:

**Read-your-writes is usually the only guarantee anyone actually needs**, and it is cheap. Route a session's reads to the primary, or to a replica that has reached the write's position, for a window after a write. Most "we need strong consistency" requirements are this requirement, stated imprecisely.

**Materialising a conflict converts an isolation problem into a cheap one.** If write skew comes from decisions over a set, add a row that both transactions must write — a counter, a version, a lock row. The conflict becomes an ordinary row conflict that read-committed plus a conditional update handles.

## How you find out what you actually have

Documentation is unreliable here, for two reasons: implementations have bugs, and vendors use the terms loosely. "Repeatable read" means different things in different engines.

Three practical approaches:

**Read the specific guarantees, not the label.** "Strongly consistent" is marketing. Ask: is it per key or across keys? Does it hold across a leader change? What happens during a partition?

**Look for adversarial test results.** Systematic fault-injection testing of consistency claims is a real discipline, and it has repeatedly found that systems do not provide what they advertise, especially under partition and leader change.

**Test your own critical paths.** Write a test that performs the operation concurrently and asserts the invariant. For write skew: two concurrent transactions, both passing the check, then assert the invariant. This is the only way to know what your configuration actually does, and it takes an hour.

## Where this framing misleads

**Anomalies are not equally bad.** A monotonic-read violation on a "last seen" timestamp is invisible; the same violation on an account balance is a support incident. Rank by consequence, not by the model's position in the lattice.

**Stronger is not safer if it makes you unavailable.** A linearizable operation that fails during a partition may be worse for the business than a stale read, and that is a product decision.

**The application can be the enforcement point.** Sometimes the cheapest correct answer is neither a consistency model nor an isolation level but an idempotency key, a unique constraint, or a reconciliation job. Those are the tools this vocabulary tends to make people forget.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'two-axes',
      title: 'Two axes, not one dial',
      caption:
        'The most useful diagram in the lesson. Linearizability and serializability are siblings — neither implies the other — and the four session guarantees are mutually incomparable, which is what lets you compose exactly what you need.',
      code: `flowchart TB
    SS["**Strict serializability**<br/>(external consistency)<br/>Spanner"]

    SS --> LIN["**Linearizability**<br/>single-object, real-time<br/>needs consensus or R+W>N"]
    SS --> SER["**Serializability**<br/>multi-object transactions<br/>prevents write skew"]

    LIN --> SEQ["Sequential consistency<br/>total order, not real-time"]
    SEQ --> CAU["**Causal consistency**<br/>= all four session guarantees<br/>strongest model still<br/>available under partition"]

    CAU --> RYW["Read-your-writes"]
    CAU --> MR["Monotonic reads"]
    CAU --> MW["Monotonic writes"]
    CAU --> WFR["Writes-follow-reads"]

    RYW --> EV["Eventual consistency<br/>converges if writes stop"]
    MR --> EV
    MW --> EV
    WFR --> EV

    EV --> SEC["Strong eventual consistency<br/>CRDTs — merge is deterministic,<br/>no resolution policy needed"]

    SER --> ISO["Snapshot isolation<br/>**permits write skew**<br/>— the common default"]
    ISO --> RC["Read committed"]

    style CAU fill:#17272a,stroke:#35897e
    style ISO fill:#2a1a1a,stroke:#a04848
    style RYW fill:#1c1814,stroke:#c99a4e
    style SEC fill:#231b2a,stroke:#7a5ea8`,
    },
    {
      kind: 'flow',
      id: 'write-skew',
      title: 'Write skew: the anomaly no consistency model prevents',
      caption:
        'Step through it. Every read is fresh and correct, both writes touch different rows, nothing conflicts, and the invariant breaks. This is why the axis matters more than the strength.',
      nodes: [
        { id: 'c1', label: 'Request A', kind: 'client', x: 0, y: 80, detail: 'Doctor 1 goes off call. Handled by application server A.' },
        { id: 'c2', label: 'Request B', kind: 'client', x: 0, y: 280, detail: 'Doctor 2 goes off call, at the same moment, handled by a different application server.' },
        { id: 'read', label: 'Check: ≥1 on call?', kind: 'service', x: 200, y: 180, detail: 'Both requests read the on-call set and both see two doctors. Both conclude that removing one leaves one, so the invariant holds. Both reads are fresh and correct.' },
        { id: 'w1', label: 'UPDATE doctor 1', kind: 'store', x: 430, y: 80, detail: 'Writes row 1. No lock contention, no version conflict, no unique constraint touched.' },
        { id: 'w2', label: 'UPDATE doctor 2', kind: 'store', x: 430, y: 280, detail: 'Writes row 2 — a DIFFERENT row. Nothing conflicts with the other write, so nothing detects a problem.' },
        { id: 'broken', label: 'Nobody on call', kind: 'note', x: 660, y: 180, detail: 'The invariant is violated by a state neither transaction could observe. Both decisions were correct given what each saw.' },
        { id: 'fix1', label: 'Materialise the conflict', kind: 'service', x: 430, y: 420, detail: 'Both transactions update one shared row — an on_call_count — so it becomes an ordinary write conflict that read-committed plus a conditional update catches. Usually the right answer.' },
        { id: 'fix2', label: 'Serializable + retry', kind: 'service', x: 660, y: 420, detail: 'The engine detects the read-write dependency cycle and aborts one transaction — but only if the read happened INSIDE the transaction. A read from a replica is invisible to it.' },
      ],
      edges: [
        { id: 's1', source: 'c1', target: 'read', kind: 'read' },
        { id: 's2', source: 'c2', target: 'read', kind: 'read' },
        { id: 's3', source: 'read', target: 'w1', kind: 'write' },
        { id: 's4', source: 'read', target: 'w2', kind: 'write' },
        { id: 's5', source: 'w1', target: 'broken', kind: 'control' },
        { id: 's6', source: 'w2', target: 'broken', kind: 'control' },
        { id: 's7', source: 'broken', target: 'fix1', kind: 'async' },
        { id: 's8', source: 'broken', target: 'fix2', kind: 'async' },
      ],
      steps: [
        {
          id: 'y1',
          title: 'Both reads are fresh and both are correct',
          description:
            'Two doctors are on call and both requests see exactly that. Linearizability would change nothing here — there is no stale read to fix, which is why reaching for it is the standard wrong move.',
          nodes: ['c1', 'c2', 'read'],
          edges: ['s1', 's2'],
        },
        {
          id: 'y2',
          title: 'Both writes touch different rows',
          description:
            'No row is concurrently modified, so no row-level mechanism fires: no lock wait, no version conflict, no constraint violation. Snapshot isolation permits this, and snapshot isolation is a common default.',
          nodes: ['w1', 'w2'],
          edges: ['s3', 's4'],
        },
        {
          id: 'y3',
          title: 'The invariant breaks on a state nobody saw',
          description:
            'Each decision was valid given its snapshot. The violated state is the combination, which neither transaction could observe — that is the definition of write skew.',
          nodes: ['broken'],
          edges: ['s5', 's6'],
        },
        {
          id: 'y4',
          title: 'Fix one: give them a row to fight over',
          description:
            'Have both transactions update a shared on_call_count with a conditional check. The write skew becomes an ordinary write conflict, catchable at read-committed. Cheapest correct answer.',
          nodes: ['fix1'],
          edges: ['s7'],
        },
        {
          id: 'y5',
          title: 'Fix two: serializable — and the read must be inside it',
          description:
            'A serializable engine detects the read-write dependency cycle and aborts one transaction. But it cannot detect a conflict on a read it never saw, so reading a replica puts the check outside its scope.',
          nodes: ['fix2'],
          edges: ['s8'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['google'],
    body: `Spanner is the useful production example here because it makes both axes explicit, and because what it costs shows exactly what each axis is worth.

**Spanner provides external consistency**, which is strict serializability: transactions appear in a single total order, and that order matches real time. Both axes at full strength, globally.

**How, and what each part costs.**

**Serializability** comes from two-phase locking within a transaction plus two-phase commit across the participating partitions. Standard, well-understood, and the cost is lock hold time and a commit round trip across every partition involved.

**Real-time ordering** is the harder half, and it comes from **TrueTime**: an API returning an *interval* that certainly contains the current time, backed by GPS receivers and atomic clocks in every datacentre. Uncertainty is typically single-digit milliseconds.

The mechanism is a **commit wait**. A transaction is assigned a timestamp, and before making it visible Spanner waits out the clock uncertainty — so any transaction starting later is guaranteed a later timestamp. That wait is why the ordering matches real time, and it is a latency cost paid on every write.

**Two things this makes possible that are worth naming.**

**Read-only transactions at a timestamp, with no locks.** Because timestamps are globally meaningful, a read-only transaction can be assigned a past timestamp and served from any sufficiently up-to-date replica without coordinating with writers. So the expensive coordination is confined to writes, and reads — the majority of traffic — are cheap and lock-free. **This is the design insight**: pay for a global time order once, and reads become free.

**Reasoning about "before" across regions.** Without synchronised time, "did A happen before B" has no answer across datacentres. With bounded uncertainty it does, and that is what upgrades serializability to *strict* serializability.

**The bill, stated plainly.** Specialised time infrastructure in every datacentre. A commit wait proportional to clock uncertainty on every write. Cross-region round trips for multi-region transactions — tens of milliseconds where an eventually-consistent store would be single-digit. And two-phase commit's coordination cost when a transaction spans partitions.

**The transferable lessons, which do not require Spanner.**

**Separating read and write costs is the move.** Spanner's reads are cheap because writes established a global order. Even without TrueTime, the pattern of "make writes carry ordering information so reads need no coordination" is broadly applicable — a monotonic version per entity, passed to readers, gets a similar effect at a much smaller scale.

**Ask which axis each operation needs.** Spanner's own guidance is to keep transactions small and to prefer single-partition transactions, because the cost is in the *span*, not in the strength. A single-partition serializable transaction is ordinary and cheap; a global one is expensive. **Most of the benefit comes from choosing the partition key so that transactions do not span partitions** — which is the partitioning lesson's conclusion arriving from a different direction.`,
  },

  tradeoffs: {
    intro:
      'Two separate purchases: a consistency model for single-object reads across replicas, and an isolation level for multi-object transactions. Rows cover both axes.',
    rows: [
      {
        option: 'Strict serializability (external consistency)',
        whenItWins:
          'Financial ledgers, anything where cross-key invariants and real-time ordering both matter and a wrong answer is unrecoverable.',
        whenItLoses:
          'High-volume operations, anything latency-critical, and anything that must remain available during a partition.',
        cost:
          'Coordination on every write, a commit wait, cross-region round trips, and specialised infrastructure for real-time ordering.',
      },
      {
        option: 'Linearizability (single-object)',
        whenItWins:
          'A single value everyone must agree on right now: a lock, a leader, a unique claim, a counter that gates something.',
        whenItLoses:
          'When the invariant spans keys — it provides nothing there — or when the coordination latency is unaffordable.',
        cost:
          'Consensus or a quorum with `R + W > N`, so a round trip to a majority on every operation.',
      },
      {
        option: 'Causal consistency',
        whenItWins:
          'Comment threads, collaborative documents, activity feeds — anywhere an effect appearing before its cause is confusing. And it is the strongest model still available under partition.',
        whenItLoses:
          'When two clients must agree on a current value, which causality does not provide.',
        cost:
          'Dependency metadata on operations and machinery to enforce ordering on delivery.',
      },
      {
        option: 'Read-your-writes only',
        whenItWins:
          'The most common real requirement, and cheap. A user must see their own edits; nobody else needs to see them instantly.',
        whenItLoses:
          'When values may regress between reads (that is monotonic reads) or two users must see each other\'s writes.',
        cost:
          'Session routing or a write position carried by the client, and reduced replica utilisation while pinned.',
      },
      {
        option: 'Monotonic reads only',
        whenItWins:
          'When a value visibly going backwards is the problem — a count decreasing, a status reverting. Very cheap.',
        whenItLoses:
          'When a client must see its own writes, which this does not provide. The two are incomparable.',
        cost:
          'Pinning a session to a replica, so uneven load and a discontinuity if that replica is lost.',
      },
      {
        option: 'Snapshot isolation',
        whenItWins:
          'Most transactional work. A coherent view with no read locks, so readers never block writers.',
        whenItLoses:
          'Any decision based on the state of a *set* of rows — capacity checks, "at least one must remain", non-overlapping bookings. It permits write skew.',
        cost:
          'Write skew, which is silent, and the version storage that snapshots require.',
      },
      {
        option: 'Serializable isolation',
        whenItWins:
          'Cross-row invariants: uniqueness, capacity, mutual exclusion, non-overlap. The only isolation level that prevents write skew.',
        whenItLoses:
          'Under high contention, where aborts or lock waits dominate — and it protects nothing if the read happens outside the transaction.',
        cost:
          'Serialization failures requiring retry logic, or lock contention, plus care that every relevant read is inside the transaction.',
      },
      {
        option: 'Materialising the conflict',
        whenItWins:
          'Very often the cheapest correct answer. Add a row both transactions must update, turning write skew into an ordinary write conflict.',
        whenItLoses:
          'When the conflict row becomes a contention hot spot for high-volume operations.',
        cost:
          'A denormalised row to maintain, and serialisation of everything that touches it.',
      },
      {
        option: 'Strong eventual consistency (CRDTs)',
        whenItWins:
          'Collaborative editing, offline-capable clients, counters and sets that must merge without coordination and without a resolution policy.',
        whenItLoses:
          'When the merge semantics do not match the business rule — a set union can resurrect a deleted item.',
        cost:
          'Metadata growth, restricted data types, and semantics dictated by the type\'s algebra rather than by the requirement.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Serializable and linearizable are basically the same thing — both mean strong consistency."',
      whyWeak:
        'They are on different axes and neither implies the other. Serializability is about multi-object transactions on one logical copy; linearizability is about single-object reads across replicas being real-time fresh. A snapshot read replica can be serializable and stale; a linearizable key-value store can have every read fresh and still permit write skew across keys.',
      strongAnswer:
        '"Different axes. Serializability constrains how multi-object transactions interleave; linearizability constrains what a single-object read may return relative to real time. Neither implies the other — their conjunction is strict serializability, which is what Spanner calls external consistency. Knowing which axis an anomaly is on is what tells you whether to tune replicas or tune isolation."',
    },
    {
      weakAnswer: '"We had a race where two requests both passed a check. We\'ll read from the primary instead of the replica."',
      whyWeak:
        'That removes staleness and leaves the race untouched. If both requests read the primary and both saw a state satisfying the check, both still proceed. Write skew is an isolation problem, and reading fresher data does not fix it.',
      strongAnswer:
        '"Reading the primary would not help — both reads were already correct, and the problem is two decisions made on the same valid state with writes to different rows. That is write skew, an isolation-axis problem. The cheapest fix is to materialise the conflict so both transactions update one shared row, making it an ordinary write conflict. The heavier fix is serializable isolation with the check inside the transaction."',
    },
    {
      weakAnswer: '"Our database is serializable, so we do not have concurrency bugs."',
      whyWeak:
        'Serializability protects reads and writes *inside* a transaction. If the application reads data outside the transaction — from a replica, from a cache, in an earlier request — the engine cannot detect a conflict on a read it never saw.',
      strongAnswer:
        '"Serializability only covers what the transaction actually did. If we check an invariant by reading a replica and then write inside a transaction, the engine has no record of the read and cannot detect the conflict. Every read the decision depends on has to be inside the transaction — which is also why a check performed in a previous HTTP request gives no protection at all."',
    },
    {
      weakAnswer: '"We need strong consistency so users see their changes immediately."',
      whyWeak:
        'That requirement is read-your-writes for one session, which is far weaker and far cheaper than linearizability. Buying linearizability for it adds coordination latency to every operation for a guarantee nobody asked for.',
      strongAnswer:
        '"That is read-your-writes, not linearizability. I would route a session\'s reads to the primary or to a replica confirmed to have reached the write\'s position, for a window after a write. Everyone else can read a lagging replica. Most \'we need strong consistency\' requirements are this requirement stated imprecisely — and the difference is a coordination round trip on every operation."',
    },
    {
      weakAnswer: '"We use repeatable read, which is the same across databases."',
      whyWeak:
        'The isolation-level names are used loosely and mean different things in different engines. What one engine calls repeatable read is snapshot isolation in another, and the anomalies each permits differ. Reasoning from the label rather than the behaviour produces bugs that only appear under concurrency.',
      strongAnswer:
        '"The names are not portable — what one engine calls repeatable read another implements as snapshot isolation, and the anomalies they permit differ. I would reason from anomalies instead: does this level permit write skew? Phantoms? And I would verify by writing a test that runs the two conflicting operations concurrently and asserts the invariant. That takes an hour and it is the only way to know what the configuration actually does."',
    },
    {
      weakAnswer: '"Eventual consistency is fine because CRDTs guarantee convergence."',
      whyWeak:
        'CRDTs guarantee that replicas with the same updates reach the same state — they do not guarantee that state is what the business wanted. A set union resurrects a deleted item; a last-write-wins register discards a concurrent update. The merge semantics come from the data type, not from the requirement.',
      strongAnswer:
        '"CRDTs give strong eventual consistency — convergence with no resolution policy needed — and the converged value is whatever the type\'s algebra produces. A set union will resurrect an item deleted concurrently, which is exactly Dynamo\'s shopping-cart behaviour. So the question is whether the type\'s merge matches the business rule. If it does, this is excellent; if it does not, converging on the wrong answer is not an improvement."',
    },
  ],

  flashcards: [
    {
      id: 'fc-cm-1',
      front: 'What are the two axes, and what does each constrain?',
      back: 'Consistency models constrain what a single-object read may return across replicas. Isolation levels constrain how multi-object transactions interleave on one logical copy.',
      topic: 'consistency-models',
    },
    {
      id: 'fc-cm-2',
      front: 'Do linearizability and serializability imply each other?',
      back: 'No — they are siblings on different axes. Their conjunction is strict serializability, which Spanner calls external consistency.',
      topic: 'linearizability',
    },
    {
      id: 'fc-cm-3',
      front: 'What exactly does linearizability guarantee?',
      back: 'Single-object: every operation appears to take effect atomically between its invocation and response, and a read returns the most recent completed write. It says nothing about multi-object operations.',
      topic: 'linearizability',
    },
    {
      id: 'fc-cm-4',
      front: 'What is causal consistency, expressed usefully?',
      back: 'Exactly the four session guarantees together: read-your-writes, monotonic reads, monotonic writes, writes-follow-reads. It forbids observing an effect before its cause.',
      topic: 'causal-consistency',
    },
    {
      id: 'fc-cm-5',
      front: 'Why does causal consistency matter theoretically?',
      back: 'It is the strongest consistency model achievable while remaining available during a network partition. It is the ceiling for genuinely AP systems.',
      topic: 'causal-consistency',
    },
    {
      id: 'fc-cm-6',
      front: 'Which pairs of session guarantees are incomparable?',
      back: 'All of them. You can have monotonic reads without read-your-writes, or either without the others. Choosing among them is about anomalies, not strength.',
      topic: 'session-guarantees',
    },
    {
      id: 'fc-cm-7',
      front: 'What is write skew?',
      back: 'Two transactions read overlapping sets, decide based on the whole set, and write to disjoint rows. Nothing conflicts, so only serializable isolation or explicit locking catches it.',
      topic: 'isolation',
    },
    {
      id: 'fc-cm-8',
      front: 'Why does linearizability not prevent write skew?',
      back: 'It is a single-object property. Every read in a write-skew scenario is fresh and correct — the failure is two decisions on the same valid state, which is an isolation problem.',
      topic: 'isolation',
    },
    {
      id: 'fc-cm-9',
      front: 'Why is snapshot isolation dangerous by default?',
      back: 'It permits write skew, and it is the default in several popular databases. Any decision based on the state of a set of rows is unprotected.',
      topic: 'isolation',
    },
    {
      id: 'fc-cm-10',
      front: 'What is the cheapest fix for write skew?',
      back: 'Materialise the conflict: add a row both transactions must update, turning it into an ordinary write conflict that read-committed plus a conditional update catches.',
      topic: 'isolation',
    },
    {
      id: 'fc-cm-11',
      front: 'When does serializable isolation fail to protect you?',
      back: 'When the read the decision depends on happens outside the transaction — from a replica, a cache, or a previous request. The engine cannot detect a conflict on a read it never saw.',
      topic: 'isolation',
    },
    {
      id: 'fc-cm-12',
      front: 'What is strong eventual consistency, and what does it not promise?',
      back: 'Replicas with the same updates reach the same state with no resolution policy — CRDTs. It does not promise the converged value is what the business wanted.',
      topic: 'consistency-models',
    },
    {
      id: 'fc-cm-13',
      front: 'What is the method for choosing a model?',
      back: 'Name the anomaly you must forbid, take the weakest model that forbids it, and check separately whether you also need an isolation level. Two purchases, not one.',
      topic: 'session-guarantees',
    },
    {
      id: 'fc-cm-14',
      front: 'Why can\'t you trust an isolation-level label?',
      back: 'The names are used loosely and differ between engines — one engine\'s repeatable read is another\'s snapshot isolation. Test the anomaly concurrently and assert the invariant.',
      topic: 'isolation',
    },
  ],

  quiz: [
    {
      id: 'q-cm-1',
      kind: 'scenario',
      prompt:
        'Two concurrent transactions each check "at least one doctor remains on call", both see two on call, and each removes a different doctor. Both commit. Which mechanism prevents this?',
      options: [
        { id: 'a', label: 'Serializable isolation with the check inside the transaction, or materialising the conflict into a shared row' },
        { id: 'b', label: 'Linearizable reads, so both transactions see the latest state' },
        { id: 'c', label: 'Reading from the primary rather than a replica' },
        { id: 'd', label: 'Causal consistency, so the writes are ordered' },
      ],
      correct: ['a'],
      explanation:
        'This is write skew, an isolation-axis anomaly. Both reads were already fresh and correct, so linearizability and reading the primary change nothing. The transactions are concurrent with no causal relationship, so causality does not apply. Only serializable isolation — or forcing both to write one shared row — detects the conflict.',
      difficulty: 'advanced',
      topic: 'isolation',
    },
    {
      id: 'q-cm-2',
      kind: 'single',
      prompt: 'A snapshot-isolated read replica of a serializable primary. What does it provide?',
      options: [
        { id: 'a', label: 'A transactionally coherent view of a possibly-stale moment — serializable but not linearizable' },
        { id: 'b', label: 'Strict serializability, since the primary is serializable' },
        { id: 'c', label: 'Linearizability but not serializability' },
        { id: 'd', label: 'Eventual consistency with no transactional guarantees' },
      ],
      correct: ['a'],
      explanation:
        'This is the cleanest illustration that the axes are independent. The replica gives a consistent snapshot — no torn reads across rows — of a point in the past. Transactionally coherent, and not real-time fresh. It is exactly the combination people assume is impossible when they treat the two terms as synonyms.',
      difficulty: 'advanced',
      topic: 'consistency-models',
    },
    {
      id: 'q-cm-3',
      kind: 'scenario',
      prompt:
        'A requirement states "users must see their changes immediately after saving". What is the weakest sufficient model, and what would over-buying cost?',
      options: [
        { id: 'a', label: 'Read-your-writes for that session; buying linearizability instead adds a coordination round trip to every operation for nobody\'s benefit' },
        { id: 'b', label: 'Linearizability, since the read must return the latest write' },
        { id: 'c', label: 'Causal consistency, since the read causally follows the write' },
        { id: 'd', label: 'Serializable isolation on the save transaction' },
      ],
      correct: ['a'],
      explanation:
        'The requirement is per-session, so read-your-writes is exactly sufficient: route that session\'s reads to the primary or to a replica confirmed past the write\'s position. Causal consistency would work and is strictly stronger than needed. Linearizability makes every other client\'s reads coordinate too, for a guarantee nobody requested.',
      difficulty: 'core',
      topic: 'session-guarantees',
    },
    {
      id: 'q-cm-4',
      kind: 'multi',
      prompt:
        'Which statements about session guarantees are correct? Select all that apply.',
      options: [
        { id: 'a', label: 'Read-your-writes and monotonic reads are incomparable — either can hold without the other' },
        { id: 'b', label: 'Causal consistency is equivalent to all four session guarantees together' },
        { id: 'c', label: 'Causal consistency is the strongest model still available during a partition' },
        { id: 'd', label: 'Eventual consistency implies monotonic reads' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the structurally important facts about this part of the lattice. The fourth is wrong and is the source of many bugs: eventual consistency promises only convergence if writes stop, so successive reads can absolutely regress — monotonic reads must be added deliberately.',
      difficulty: 'advanced',
      topic: 'session-guarantees',
    },
    {
      id: 'q-cm-5',
      kind: 'scenario',
      prompt:
        'A team runs serializable isolation and still hits a duplicate-signup bug: the code checks whether an email exists, then inserts. The check runs in a prior HTTP request. Why does serializability not help?',
      options: [
        { id: 'a', label: 'The read is outside the transaction, so the engine has no record of it and cannot detect a conflict — the fix is a unique constraint' },
        { id: 'b', label: 'Serializable isolation does not prevent phantoms' },
        { id: 'c', label: 'The isolation level should be strict serializability' },
        { id: 'd', label: 'Two inserts of the same email do not conflict under any isolation level' },
      ],
      correct: ['a'],
      explanation:
        'Serializability constrains what happens inside a transaction. A check performed in a previous request is invisible to the engine, so there is no read-write dependency to detect. A unique constraint is the right mechanism here — it makes the database enforce the invariant regardless of what the application checked or when.',
      difficulty: 'core',
      topic: 'isolation',
    },
    {
      id: 'q-cm-6',
      kind: 'scenario',
      prompt:
        'A collaborative task list uses a CRDT set so replicas converge without coordination. A user deletes a task on one device while another adds it back on a second device, offline. What is the outcome and is it correct?',
      options: [
        { id: 'a', label: 'The set union resurrects the task — convergence is guaranteed, and whether that is correct depends on whether union matches the business rule' },
        { id: 'b', label: 'The delete wins, since deletes take precedence in CRDTs' },
        { id: 'c', label: 'The replicas diverge permanently and need manual resolution' },
        { id: 'd', label: 'The later timestamp wins' },
      ],
      correct: ['a'],
      explanation:
        'CRDTs guarantee convergence, and the converged value follows the type\'s algebra. A grow-only or add-wins set resurrects the item — the same behaviour as Dynamo\'s shopping cart. That may be exactly right (do not lose a user\'s work) or exactly wrong (a deleted item reappears). The type must be chosen to match the requirement, not assumed to satisfy it.',
      difficulty: 'advanced',
      topic: 'consistency-models',
    },
  ],

  exercises: [
    {
      id: 'ex-cm-1',
      kind: 'design',
      title: 'Name the axis, then buy the minimum',
      estimatedMinutes: 30,
      prompt: `For each requirement below, state: **which axis** the anomaly is on (consistency model or isolation level), **the weakest mechanism** that satisfies it, and **one cheaper alternative** if there is one.

1. A user edits their bio and must see the change on the next page load.
2. A "seats remaining" figure must never go up when nothing was cancelled.
3. A meeting room must never be double-booked for overlapping times.
4. An email address must be unique across all accounts.
5. A comment reply must never render before the comment it answers.
6. A bank account balance must never go negative, with concurrent withdrawals.
7. A shared shopping list, edited offline on two phones, must merge sensibly.
8. Two admins viewing an audit log must see the same entries in the same order.

Then answer:

- Which of the eight is most often solved with the wrong axis, and what is the wrong fix?
- You inherit a system on snapshot isolation. What do you audit first?
- How would you actually verify requirement 3 holds?`,
      rubric: [
        'Correctly assigns each requirement to the consistency or isolation axis.',
        'Requirement 1: read-your-writes, not linearizability.',
        'Requirement 2: monotonic reads, and notes it is incomparable with read-your-writes.',
        'Requirements 3 and 6: isolation axis, write skew; proposes materialising the conflict or an exclusion constraint.',
        'Requirement 4: a unique constraint, and notes that check-then-insert fails regardless of isolation level.',
        'Requirement 5: causal consistency.',
        'Requirement 7: a CRDT, with the merge semantics questioned rather than assumed.',
        'Requirement 8: identifies that a shared total order is needed, not just freshness.',
        'Names write skew as the most commonly mis-axised anomaly, with "read the primary" as the wrong fix.',
        'Audit answer enumerates decisions made over sets of rows.',
        'Verification answer describes a concurrent test asserting the invariant.',
      ],
      modelAnswer: `**1. User sees their own bio edit — CONSISTENCY axis**

*Anomaly:* read-your-writes violated.

*Weakest mechanism:* route that session's reads to the primary — or to a replica confirmed to have reached the write's log position — for a window after the write, say 30 seconds.

*Cheaper alternative:* **return the new value in the write's response and have the client render it optimistically.** No routing logic, no primary load, and it covers the case the user actually notices. The next natural page load is usually seconds later, by which time the replica has caught up. This is genuinely the cheapest correct answer and it is routinely overlooked.

**2. Seats remaining must never increase spuriously — CONSISTENCY axis**

*Anomaly:* monotonic reads violated. Successive reads hitting differently-lagged replicas make the number move both ways.

*Weakest mechanism:* monotonic reads — pin the session to one replica, or have the client send the highest version it has seen and require the serving replica to have reached it.

*Note worth making:* this is **incomparable** with requirement 1. A session could have read-your-writes and still see a value regress, or have monotonic reads and not see its own write. They are separate purchases.

*Cheaper alternative:* have the client remember the lowest value it has displayed and never render a higher one without an explicit refresh. Client-side monotonicity, no server change. Slightly dishonest and adequate for a scarcity indicator.

**3. No double-booking of overlapping times — ISOLATION axis**

*Anomaly:* write skew. Two bookings each check for overlaps, each sees none, each inserts a row. Different rows, no conflict, overlapping bookings.

*Weakest mechanism:* **an exclusion constraint on the room and the time range**, if the database supports range types. The database then enforces non-overlap as a constraint, and the second insert fails regardless of isolation level or what the application checked. **This is the best answer** because it moves the invariant into the schema, where no code path can bypass it.

*If no exclusion constraint is available:* serializable isolation with the overlap check inside the transaction, plus retry on serialization failure. Or materialise the conflict — lock the room row with \`SELECT ... FOR UPDATE\` before checking — which serialises bookings per room and is easy to reason about.

*Cheaper alternative:* discretise time into fixed slots and make \`(room_id, slot)\` a unique key. A booking becomes N inserts, and any overlap violates uniqueness. This turns a hard range problem into a trivial one, at the cost of only supporting slot-aligned bookings — which is often acceptable and is a good example of a **requirement change being cheaper than a mechanism**.

**4. Unique email across accounts — ISOLATION axis, sort of**

*Anomaly:* a check-then-insert race. Two signups check, neither finds the email, both insert.

*Weakest mechanism:* **a unique constraint.** The database enforces it, the second insert fails with a duplicate-key error, and the application treats that error as "email taken".

*The important point:* this is **not fixed by any isolation level** if the check happens outside the transaction — and it usually does, in a validation step or a previous request. Serializable isolation cannot detect a conflict on a read it never saw. So the answer is not "raise the isolation level" but "let the database enforce it".

*No cheaper alternative — this is already the cheapest.* And it illustrates the general principle: an invariant enforced by a constraint cannot be bypassed by a code path that forgot to check.

**5. Reply never renders before its comment — CONSISTENCY axis**

*Anomaly:* causality violated. The reply and the comment replicated at different speeds, so a replica has one without the other.

*Weakest mechanism:* causal consistency, or the specific piece of it needed here — have the reply carry the comment's version, and have a reader that lacks the comment either wait or refetch.

*Cheaper alternative:* **make the reply's write depend on the comment's row**, so they land together — store replies as children of the comment record, or read both in one query keyed by the comment. If a reply cannot exist without its parent in the same read, the anomaly is structurally impossible. **Removing the possibility beats detecting it.**

**6. Balance must never go negative — ISOLATION axis**

*Anomaly:* it depends on the shape, and distinguishing the two shapes is the point.

If the withdrawal is \`UPDATE accounts SET balance = balance - 100 WHERE id = 1 AND balance >= 100\`, this is a **conditional atomic update on one row** and read-committed handles it correctly. The row lock serialises the two withdrawals, and the second fails its \`WHERE\` clause.

If the code reads the balance, checks it in the application, and then writes an absolute value, it is a **lost update** — and it is broken under read-committed and snapshot isolation alike.

*Weakest mechanism:* the conditional atomic update. One statement, no explicit transaction needed, correct under the weakest isolation level.

*Where it becomes write skew:* if the rule is "total across a customer's accounts must not go negative", the decision now spans rows and a conditional single-row update cannot express it. Then it is genuine write skew, and the fix is a materialised customer-level total that both transactions must update, or serializable isolation.

*Cheaper alternative:* append-only entries with a materialised balance, so a withdrawal is an insert plus a conditional update of the balance row. This also gives an audit trail — and the conflict is materialised as a side effect of a design chosen for other reasons.

**7. Offline shopping list merging — CONSISTENCY axis, and the merge is the real question**

*Anomaly:* divergent replicas after offline edits.

*Weakest mechanism:* a CRDT — an add-wins or observed-remove set. Strong eventual consistency: replicas with the same updates converge with no resolution policy.

*The question to ask rather than assume:* **does the type's merge match the business rule?** A grow-only or add-wins set will resurrect an item deleted on one device while re-added on another. For a shopping list that is arguably right — losing an item someone added is worse than an extra item. For a list of granted permissions it would be a security bug.

*Cheaper alternative:* last-write-wins per item, with a timestamp. Simple, and it silently discards concurrent edits. For a shopping list where items are independent, per-item LWW is often adequate and vastly simpler than a full CRDT — the items do not interact, so there is little to merge.

**8. Two admins see the same audit entries in the same order — CONSISTENCY axis, and it needs more than freshness**

*Anomaly:* two clients disagreeing about the sequence. This needs a **shared total order**, not merely fresh reads.

*Weakest mechanism:* read at a **specified position** — both admins read the log up to the same explicit sequence number or timestamp, which the server includes in the response and the client sends on subsequent requests. Then their views agree by construction, even if one is slightly behind.

*Why linearizability alone is not the answer:* linearizability makes each read fresh, and two admins reading at slightly different instants still see different sets. **The requirement is agreement, not freshness**, and those need different mechanisms — this distinction is what makes this requirement worth including.

*Cheaper alternative:* a monotonic sequence number on each entry, with the reader always fetching \`WHERE seq <= :watermark\` for an explicit watermark. Ordinary pagination, and it gives a shared order for free.

---

**Which is most often solved with the wrong axis?**

**Requirement 3, non-overlapping bookings — and write skew generally.** The wrong fix is almost always **"read from the primary instead of the replica"**, sometimes escalated to "we need a stronger consistency level".

Why the instinct is wrong: it assumes the failure was a stale read. It was not. Both transactions read correct current data and both decisions were valid given what each saw. Removing staleness removes nothing, and the bug persists with the same frequency — which then produces the conclusion that the consistency level needs raising further, and the team travels a long way down the wrong axis.

**The diagnostic question that gets it right first time:** *did the failing decision depend on the state of more than one row?* If yes, it is the isolation axis and no consistency model at any strength will help. If it depended on one row, it is the consistency axis or an atomic-operation problem.

**Inheriting a system on snapshot isolation: what to audit first**

Snapshot isolation permits write skew, so I would enumerate every place a decision is made over a *set* of rows. Concretely, I would search for:

1. **Any \`SELECT COUNT(...)\` or aggregate followed by a conditional insert or update.** Capacity checks, quota checks, "at most N per account". This is the single highest-yield pattern.
2. **Any existence or absence check followed by a write** — "no overlapping booking", "no active session", "no pending request". Decisions on absence are the classic write-skew shape.
3. **Any "at least one must remain" invariant** — the last admin, the last on-call doctor, the last payment method.
4. **Any check performed outside the transaction that later writes** — a validation step, a prior HTTP request, a read from a replica or cache. These are unprotected regardless of isolation level, which makes them worse than write skew rather than better.
5. **Any read-modify-write on a numeric column** that is not a conditional atomic update. Lost updates.

For each, the fix in order of preference: a database constraint (unique or exclusion), then a conditional atomic update, then materialising the conflict, then serializable isolation with retries. **Constraints first**, because they cannot be bypassed by a code path that forgot.

**How I would verify requirement 3 actually holds**

A concurrent test, because reasoning from documentation is unreliable here.

\`\`\`
1. Seed: room R, no bookings.
2. Open two connections at the production isolation level.
3. Both begin a transaction.
4. Both run the overlap check for 10:00–11:00. Assert both see zero overlaps.
5. Connection 1 inserts its booking. Do not commit.
6. Connection 2 inserts its booking. Observe: does it block, or return?
7. Commit connection 1, then connection 2.
8. Assert: exactly one booking exists for that range.
\`\`\`

**Step 6 is the informative one.** If connection 2 blocks, something is serialising — a lock or a constraint. If it returns immediately and both commit, write skew is permitted and the invariant is unprotected.

Two things I would add:

**Run it against the production isolation level and the production schema**, not a simplified reproduction. The whole point is to learn what *this* configuration does.

**Keep it as a regression test.** This class of bug is reintroduced by refactoring — someone moves a check out of a transaction, or adds a code path that bypasses the constraint — and the failure is invisible without concurrency. A test that runs the two operations concurrently and asserts the invariant is the only thing that catches it, and it costs an hour to write.

*And the higher-level point:* if the invariant is expressed as an exclusion constraint, this test verifies the database enforces it and no future code path can break it. If the invariant is expressed as application logic under serializable isolation, the test verifies today's code — and needs to be rerun against every change. **That is the strongest practical argument for pushing invariants into constraints wherever the schema can express them.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-cm-1',
      level: 'basic',
      question: 'What is the difference between linearizability and serializability?',
      guidance:
        'Different axes: single-object real-time freshness versus multi-object transaction interleaving. Look for the recognition that neither implies the other, and for strict serializability as their conjunction.',
    },
    {
      id: 'iq-cm-2',
      level: 'basic',
      question: 'What is eventual consistency, and what anomalies does it permit?',
      guidance:
        'Convergence if writes stop, nothing more. A strong answer names read-your-writes, monotonic-read and causality violations, and notes eventual consistency implies none of the session guarantees.',
    },
    {
      id: 'iq-cm-3',
      level: 'intermediate',
      question: 'What is write skew, and which mechanisms prevent it?',
      guidance:
        'Two transactions decide over overlapping sets and write disjoint rows. Prevented by serializable isolation, explicit locking, or materialising the conflict. Look for the point that no consistency model prevents it.',
    },
    {
      id: 'iq-cm-4',
      level: 'intermediate',
      question: 'A requirement says users must see their changes immediately. What do you build?',
      guidance:
        'Read-your-writes for that session. A strong answer names it as much weaker than linearizability and offers the cheapest version — return the new value in the write response and render optimistically.',
    },
    {
      id: 'iq-cm-5',
      level: 'advanced',
      question: 'Why is causal consistency significant?',
      guidance:
        'It is exactly the four session guarantees together, and the strongest model achievable while remaining available under partition. Excellent answers give a concrete anomaly it forbids and note the availability result.',
    },
    {
      id: 'iq-cm-6',
      level: 'advanced',
      question: 'You inherit a system on snapshot isolation. What do you audit?',
      guidance:
        'Every decision made over a set of rows: aggregate-then-write, existence checks before insert, "at least one must remain", and reads outside transactions. Excellent answers prefer constraints over isolation levels.',
    },
    {
      id: 'iq-cm-7',
      level: 'followup',
      question: 'You said serializable isolation. What if the check happened in a previous request?',
      guidance:
        'Then serializability protects nothing — the engine has no record of that read. The answer must be a constraint, or moving the read inside the transaction. This is the most common way a serializable system still has races.',
    },
    {
      id: 'iq-cm-8',
      level: 'followup',
      question: 'How would you verify a system actually provides the guarantee it claims?',
      guidance:
        'A concurrent test that runs the conflicting operations and asserts the invariant, against the production isolation level and schema. A strong answer notes the labels are not portable between engines and keeps the test as a regression guard.',
    },
  ],

  activeLearning: [
    {
      id: 'al-cm-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed a server-authoritative system. Now change one thing: clients are offline-capable and may accumulate hours of local edits before syncing. Which models survive, and what becomes the real design problem?',
      discussion: `Offline capability removes the option of coordinating before a write, which eliminates most of the lattice at a stroke.

**What becomes impossible.**

**Linearizability and strict serializability, immediately.** Both require coordination before a write is accepted, and an offline client has nobody to coordinate with. Any operation needing them must be *unavailable* offline — which is a legitimate design choice for some operations (do not let an offline client claim a username) and unacceptable for others.

**Any check-then-write invariant.** "Is this email taken", "is this seat free", "does the balance allow this" — none can be answered offline. So every such operation is either deferred until sync, or performed optimistically and possibly rejected on sync.

**What survives, and what becomes the ceiling.**

**Causal consistency survives**, which is the theoretical result from the lesson doing real work: it is the strongest model available without coordination. A client can track dependencies locally and the server can apply them in causal order.

**Session guarantees survive trivially** for the local client, because it reads its own store. Read-your-writes and monotonic reads are free offline — the local replica is authoritative for the client's own view.

**Strong eventual consistency survives, and becomes the natural target.** CRDTs are designed for exactly this: merge without coordination, converge deterministically. This is why collaborative editing tools are built on them.

**What the real design problem becomes, and it is not a consistency model.**

**It becomes conflict semantics, and they are a product decision.** Two hours of offline edits on two devices will conflict, and the question "what should the merged result be" has no technical answer. Options, each with a cost:

- **A CRDT whose algebra matches the intent.** An add-wins set for a shopping list, a sequence CRDT for text. Works when the data type's merge is the semantics you want.
- **Last-write-wins per field.** Simple, and it silently discards work. Acceptable for independent fields, terrible for anything a user laboured over.
- **Surface the conflict to the user.** Honest, and it puts a merge UI on your roadmap. Sometimes the only correct answer.
- **Reject on sync and make the client re-do it.** Acceptable for operations with a server-side invariant — a booking, a claim — and infuriating for content.

**And a second problem appears: rejected operations after the fact.** An offline client books a room, syncs three hours later, and the room is taken. There is no consistency model that prevents this — the client could not have known. What you need is a **compensation story**: notify, offer an alternative, or reserve provisionally. That is product design, and it is the part that gets discovered late.

**A third: causal order across devices.** A user edits on their laptop, then on their phone, then syncs the laptop. The phone's edits arrived first. Are they concurrent, or does the laptop's edit causally follow? The user thinks sequentially; the system sees concurrency. **Vector clocks tell you they are concurrent and cannot tell you what the user meant.**

**What I would actually do.** Split operations into three classes, and be explicit about which is which:

1. **Local-only, always available.** Notes, drafts, preferences, anything single-user. CRDT or per-field LWW, merged silently.
2. **Optimistic with server validation.** Comments, likes, edits to shared content. Applied locally, sent on sync, and the client must handle rejection visibly.
3. **Server-authoritative, unavailable offline.** Claims, bookings, payments, uniqueness. Queued as an *intent* rather than applied, with the UI honest that it is pending.

**The transferable point.** Offline-first does not weaken your consistency model so much as it forces you to have conflict *semantics*, which server-authoritative systems get to avoid by refusing conflicting writes. The consistency vocabulary tells you what is achievable; it does not tell you what the merged value should be. **That question is the actual work**, and no amount of the lattice answers it.`,
    },
    {
      id: 'al-cm-2',
      kind: 'debug',
      prompt:
        'An inventory system oversells about one item in 5,000 sales. The decrement is `UPDATE items SET stock = stock - 1 WHERE id = ? AND stock > 0`, run inside a serializable transaction, and the engine reports no serialization failures. Hypotheses?',
      discussion: `The statement looks correct: a conditional atomic decrement, inside serializable isolation, on one row. That combination should be safe, and one in 5,000 is a real rate rather than a fluke. So something in the described path is not what is happening.

**Hypothesis 1 — there is more than one code path, and the other one is a read-modify-write.** The described statement is safe. If a second path — a bulk import, an admin correction, an order-modification flow — reads the stock and writes an absolute value, it is a lost update and it can overwrite the decrement. One in 5,000 fits a rare secondary path.

*Why this is the leading candidate:* the described path cannot produce the symptom, so the symptom comes from a path not described. And a low, steady rate is characteristic of a rare code path rather than a race on the hot one.

*Check:* every statement that writes \`items.stock\`. Grep, not reasoning.

**Hypothesis 2 — the invariant spans rows and the check does not.** If overselling is defined across variants, warehouses, or bundles — "this item's stock is the sum of three warehouse rows" — then a per-row conditional update cannot express the invariant. Each row-level decrement succeeds and the aggregate goes negative. This is genuine write skew and serializable isolation *would* catch it, if the aggregate read were inside the transaction.

*Check:* whether stock is a single row per sellable unit, and whether any check reads an aggregate.

**Hypothesis 3 — the decrement is not in the same transaction as the sale, and one of them can fail.** If the decrement commits and the order later fails, stock is wrong in the safe direction. If the *order* commits and the decrement fails or is skipped — an exception swallowed, a retry that double-decrements or misses — stock is wrong in the overselling direction. One in 5,000 is a plausible rate for a swallowed error on a specific failure path.

*Check:* whether the decrement and the order insert are in one transaction, and whether the decrement's failure is checked. **Specifically: does the code inspect the affected-row count?** If the \`UPDATE\` matches zero rows because stock was already zero, the statement succeeds and updates nothing. If the application does not check the row count, it treats "no rows updated" as success and sells an item that was not decremented. **This is the single most likely concrete mechanism in the whole list**, because the statement is correct and its result is being ignored.

**Hypothesis 4 — a cached or replica read gates the sale before the decrement runs.** If the "in stock?" check that decides whether to show the buy button, or an earlier validation step, reads a cache or replica, then a sale can be initiated for an out-of-stock item. The decrement would then correctly match zero rows — returning us to hypothesis 3's row-count problem, which is what converts a harmless stale read into an oversell.

*Check:* the read path for the availability check, and whether a failed decrement actually aborts the sale.

**Hypothesis 5 — the isolation level is not what is believed.** A connection pool that resets the isolation level, a framework default that overrides it, or a read replica connection used for the write path. Serializable was configured somewhere and the transaction is running at something weaker.

*Check:* log the effective isolation level from inside a real production transaction. Configuration and effective behaviour diverge more often than anyone expects.

**What I would check first: whether the code checks the affected-row count of the decrement.** It is one line to inspect, and it is the mechanism by which a *correct* statement produces an *incorrect* outcome. The absence of serialization failures actively supports this — the statement is not conflicting, it is matching zero rows and being ignored.

**Then: every other writer of \`items.stock\`** (hypothesis 1), and **whether the invariant is per-row or aggregate** (hypothesis 2).

**What the evidence rules out.** "No serialization failures" is doing real work here. Under serializable isolation, genuine write skew or a conflicting read-write pattern would produce aborts. Their complete absence means **the transactions are not conflicting** — so the bug is not a concurrency race on the described path. That eliminates the entire class of explanation people reach for first, and points at either a different path or an ignored result.

**The structural fix regardless of which hypothesis wins.** \`stock >= 0\` as a **check constraint** on the column. Then no code path — described, undescribed, future, or written by someone who did not read this — can produce negative stock. The transaction fails loudly at the database rather than succeeding quietly at the application.

That is the general lesson worth extracting: **an invariant enforced by a constraint holds for every code path; an invariant enforced by a statement holds only for the paths that use that statement correctly.** This bug is one in 5,000 precisely because most paths are correct — and a constraint would have made the rare wrong path fail on its first execution in development rather than once per 5,000 sales in production.`,
    },
  ],

  revision: {
    bullets: [
      'The models form a lattice, not a dial. Some are strictly stronger; some are incomparable.',
      'Two axes: consistency models constrain single-object reads across replicas; isolation levels constrain multi-object transactions.',
      'Linearizability and serializability are siblings — neither implies the other. Their conjunction is strict serializability.',
      'Linearizability: every read returns the most recent completed write, per object. It says nothing across objects.',
      'Causal consistency is exactly the four session guarantees together.',
      'Causal consistency is the strongest model still available during a partition — the ceiling for AP systems.',
      'The four session guarantees are mutually incomparable, so you compose exactly what you need.',
      'Eventual consistency implies none of them: values can regress and your own write can be invisible.',
      'Strong eventual consistency (CRDTs) converges with no resolution policy — and the converged value follows the type\'s algebra, not your requirement.',
      'Write skew: two transactions decide over overlapping sets and write disjoint rows. Nothing conflicts.',
      'No consistency model prevents write skew. Reading the primary changes nothing.',
      'Snapshot isolation permits write skew and is a common default.',
      'Materialising the conflict — one shared row both transactions must update — is usually the cheapest fix.',
      'Serializability protects only reads and writes inside the transaction. A check in a prior request is unprotected.',
      'A constraint holds for every code path; a statement holds only for paths that use it correctly.',
      'Most "we need strong consistency" requirements are read-your-writes, stated imprecisely.',
      'Reason from the anomaly you must forbid, then buy the weakest model that forbids it.',
      'Isolation-level labels are not portable between engines. Test concurrently and assert the invariant.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A partial order of guarantees about what an operation may observe, on two independent axes: consistency models for single-object reads across replicas, and isolation levels for multi-object transactions.',
    whyItExists:
      'Because each model forbids a specific observable anomaly at a specific coordination cost, and buying more strength than the anomaly requires costs latency and availability for nothing.',
    whenToUse: [
      'Per operation, after naming the anomaly that must not be observable.',
      'To decide whether a bug is on the consistency axis or the isolation axis, which determines the whole remedy.',
      'To compose session guarantees instead of buying linearizability by default.',
    ],
    whenNotToUse: [
      'As a system-wide label — "we are strongly consistent" describes nothing useful.',
      'As a substitute for a database constraint, which holds for every code path.',
      'As a substitute for an idempotency key or a reconciliation process.',
      'By reading the isolation-level name rather than testing the behaviour.',
    ],
    alternatives: [
      'Database constraints — unique, exclusion, check — which cannot be bypassed.',
      'Conditional atomic updates, which make read-modify-write races impossible.',
      'Materialising the conflict into a shared row, converting write skew into an ordinary conflict.',
      'Discretising a continuous constraint so uniqueness can express it.',
      'Returning the new value in the write response, instead of building read-your-writes routing.',
    ],
    tradeoffs: [
      'Linearizability buys single-object agreement and costs a majority round trip per operation.',
      'Causal consistency buys ordering and availability under partition, and costs dependency metadata.',
      'Session guarantees buy the anomalies users notice and cost session routing.',
      'Serializable isolation buys cross-row invariants and costs aborts, retries or lock contention.',
      'Snapshot isolation buys non-blocking reads and costs write skew.',
      'A CRDT buys coordination-free convergence and costs metadata and fixed merge semantics.',
    ],
    failureModes: [
      'Write skew under snapshot isolation, silent until an invariant is checked.',
      'Reaching for linearizability against write skew, which changes nothing.',
      'Serializable isolation providing no protection because the check was outside the transaction.',
      'A conditional update matching zero rows and the application ignoring the row count.',
      'A lost update from a read-modify-write in a code path nobody audited.',
      'Assuming eventual consistency implies monotonic reads, so values regress unexpectedly.',
      'A CRDT converging on a value the business did not want — a deleted item resurrected.',
      'Buying linearizability for what was a read-your-writes requirement.',
      'Trusting an isolation-level label that means something different in this engine.',
      'A stale read gating a decision, so the safe write later fails silently.',
    ],
    followUpQuestions: [
      'Which anomaly must not be observable here, exactly?',
      'Is this anomaly on the consistency axis or the isolation axis?',
      'Did the failing decision depend on more than one row?',
      'Is every read the decision depends on inside the transaction?',
      'Could a constraint enforce this instead of application logic?',
      'Do you check the affected-row count of your conditional updates?',
      'Which session guarantees do you actually need, and for whom?',
      'Have you tested this invariant under real concurrency at the production isolation level?',
    ],
  },
});
