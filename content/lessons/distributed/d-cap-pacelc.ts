import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-cap-pacelc',
  title: 'CAP, PACELC, and what "consistency" means',
  summary:
    'CAP describes behaviour during a network partition and nothing else. PACELC adds the question that actually governs your design: what do you trade when the network is fine, which is 99.9% of the time.',
  phase: 'distributed',
  module: 'data-at-scale',
  position: 26,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['cap', 'pacelc', 'consistency', 'availability', 'partitions'],
  prerequisites: ['f-replication-basics'],
  resources: [
    {
      key: 'brewer-cap-12-years',
      tier: 'must',
      note: 'Brewer\'s own retrospective, correcting the popular misreading of his theorem. Read it first — it dismantles "pick two" more effectively than any secondary source.',
    },
    {
      key: 'abadi-pacelc',
      tier: 'must',
      note: 'The paper that adds the else-latency clause. Read it for the argument that the partition case is the rare one and the normal-operation trade-off is what actually characterises a system.',
    },
    {
      key: 'jepsen-consistency',
      tier: 'must',
      note: 'The map of consistency models with their real definitions and relationships. Read it as a reference for what each term precisely means, since almost all confusion here is terminological.',
    },
    {
      key: 'aws-s3-consistency',
      tier: 'good',
      note: 'A system that publicly moved from eventual to strong read-after-write consistency. Read it as evidence that the trade-off is an engineering choice rather than a law.',
    },
    {
      key: 'spanner-paper',
      tier: 'good',
      note: 'Read the sections on TrueTime and on the commit protocol. Spanner is the strongest counterexample to "you must give up consistency at scale" — and it shows exactly what that costs.',
    },
    {
      key: 'dynamo-paper',
      tier: 'advanced',
      note: 'Read the sections on tunable consistency and conflict resolution. It is the other pole: a system that chose availability and made the consequences the application\'s problem.',
    },
  ],

  intuition: {
    body: `CAP is the most quoted and least understood result in distributed systems, and the misunderstanding is specific: **"pick two of three" is wrong.**

Here is the actual statement. In the presence of a **network partition** — some nodes cannot reach others — a distributed system must choose between:

- **Consistency**: every read returns the most recent write, or an error.
- **Availability**: every request receives a response, possibly stale.

That is it. CAP says nothing about the case where the network is working. And **partition tolerance is not a choice** — networks partition, so P is a fact about the world, not an option you decline. There is no "CA system" in a distributed setting; that phrase describes a single machine.

So CAP is really: *when the network splits, do you refuse to serve, or do you serve possibly-wrong data?* A genuinely important question, and it applies to the small fraction of time when a partition is occurring.

**PACELC is the more useful frame.** It reads:

> **If** there is a **P**artition, choose **A**vailability or **C**onsistency. **E**lse — when the network is fine — choose **L**atency or **C**onsistency.

The second clause is the one that governs your design, because the network is fine almost always. And the trade-off there is unavoidable in a different way: **if a write must be acknowledged by replicas in three regions before it returns, it costs a cross-region round trip.** No cleverness removes that; it is the speed of light plus a protocol.

So the two questions to hold, in order of how often they matter:

**Normally: how much latency will you pay for consistency?** Every write, every day. This determines your p99 and it is where the real trade lives.

**During a partition: refuse, or serve stale?** Rare, and it determines your worst-case behaviour.

The third thing to internalise is that **"consistency" in CAP is not "consistency" in ACID.** CAP's C means *linearizable* — reads see the latest write, as though there were one copy. ACID's C means *the database's invariants hold*. A system can be fully ACID on a single node and non-linearizable across replicas. The word doing double duty causes an enormous amount of confusion, and noticing it is half of understanding this topic.

The framing to carry: **CAP is a statement about partition behaviour, PACELC is a statement about your architecture, and neither is a property of a database — it is a property of each operation.**`,
    analogyLimit:
      '"Pick two of CAP" is not a simplification but an error, and it produces bad decisions: teams conclude they have chosen "AP" and stop asking what their normal-operation latency cost is, which is the trade they actually pay every day. The framing also implies the choice is made once for a whole database, when in practice a payment write and a view-count increment in the same system want opposite answers.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team says "we chose AP because availability matters more than consistency for us". Their system: a single PostgreSQL primary in one region with two synchronous replicas in the same region, plus an async replica in another region for reads. What is wrong with their description, and what have they actually chosen?',
      answer: `**Almost everything about the description is wrong, and the errors are instructive.**

**Error 1 — a single primary is not an AP system.** If the primary is unreachable, writes stop. There is no partition scenario in which this system continues accepting writes without a primary, so it does not choose availability during a partition. It chooses **consistency**: refuse rather than serve wrong.

**Error 2 — "AP" and "CP" are not properties of a database, they are properties of a configuration and an operation.** The same PostgreSQL cluster is CP for writes to the primary, and something else entirely for reads from the async cross-region replica — those reads are available during a partition and can return stale data. **The system is CP for writes and AP for reads, simultaneously.** That is not a contradiction; it is what per-operation choice looks like, and it is the normal case.

**Error 3 — the description ignores the clause that matters.** Synchronous replicas in the same region mean every write waits for at least one replica to acknowledge. That is roughly a millisecond of same-region round trip added to every write. **That is their EL choice: they chose consistency over latency**, and it is a cost they pay on every write, forever, unlike the partition scenario which may never occur.

**What they have actually chosen, stated properly in PACELC terms:**

- **PC** for writes: during a partition that isolates the primary, writes fail. They chose consistency.
- **EC** for writes: synchronous replication means writes wait for acknowledgement. They chose consistency over latency.
- **PA / EL** for reads served from the async cross-region replica: those reads remain available during a partition and are fast, and they can be arbitrarily stale.

So the honest summary is: **"we are PC/EC for writes, PA/EL for cross-region reads."** That sentence tells you what happens in every case, which "we chose AP" does not.

**Why the mislabel matters practically.** A team that believes it is "AP" will not have asked the questions that follow from being CP:

- What is the failover time when the primary is lost, and does a client see errors or a timeout during it? (This is their real availability number, and it is the one to measure.)
- Does the application handle write failures, or does it surface a 500?
- How stale can the cross-region read replica be, and does any code path write to the primary and then read from that replica? (That path is broken, and it is the most common bug this configuration produces.)

And they will not have asked the question that follows from being EC: **is the synchronous replica in the same availability zone?** If it is, they pay ~1 ms and survive a machine failure but not a zone failure. If it is in a different zone, they pay ~2–5 ms and survive a zone failure. That is a real, quantifiable trade between latency and durability, and it is invisible under the "AP" label.

**The general lesson.** "We chose AP" is not a design statement; it is a way of avoiding one. The useful statement names, per operation, what happens during a partition and what latency is paid normally. Once you write that down, the design questions are obvious — and until you do, they are invisible.`,
    },
  body: `## What each word actually means

**Consistency (CAP's C) = linearizability.** There appears to be a single copy of the data, and every read sees the most recent completed write. Operations appear to take effect in some total order consistent with real time.

This is a strong property. It is *not* what most databases give you by default across replicas, and it is not what "consistent" means in ACID.

**Availability (CAP's A) = every request to a non-failed node receives a non-error response.** Note how strict this is: a system that returns an error during a partition is *not* available in CAP's sense, even if it recovers in two seconds. CAP availability is a formal property, not an uptime percentage — and conflating the two is why "we need five nines so we must be AP" is a non-sequitur.

**Partition tolerance = the system continues to operate despite messages between nodes being lost or delayed.** Not optional. Networks drop packets, switches fail, cables get cut, and a sufficiently slow network is indistinguishable from a partition.

**Consistency (ACID's C) = the database's declared invariants hold** — constraints, foreign keys, application-level rules enforced by transactions. Entirely different property, same word.

The tell that someone has conflated the two: "PostgreSQL is CP because it is ACID." ACID is about transactions on one node's data; CAP is about agreement across nodes. A single-node ACID database is not a distributed system and CAP does not apply to it.

## PACELC, and why the else clause dominates

| | Partition | Else (normal operation) |
| --- | --- | --- |
| Choose consistency | **PC** — refuse to serve rather than serve stale | **EC** — wait for replicas to acknowledge |
| Choose the other | **PA** — serve possibly-stale data | **EL** — return as soon as one node has it |

Four combinations, and real systems occupy all of them:

**PC/EC.** Strong consistency always, at the cost of latency always. Spanner, and a single-primary relational database with synchronous replication. Every write pays a coordination round trip.

**PA/EL.** Available and fast, eventually consistent. Dynamo-style stores with low read and write quorums, Cassandra with \`ONE\`. Writes return as soon as one replica has them.

**PC/EL.** Consistent during a partition, fast normally. Common in practice: a single-primary system with asynchronous replication refuses writes if the primary is unreachable (PC) but does not wait for replicas normally (EL). **This is what most relational deployments actually are**, and it is the quadrant people fail to name.

**PA/EC.** Rare and it does exist: systems that wait for a quorum normally (paying latency for consistency) but relax during a partition to stay available.

The reason the else clause dominates: **you pay it on every operation.** A cross-region synchronous write costs 50–150 ms of round trip. A same-region one costs 1–5 ms. That is the difference between a 200 ms p99 and a 20 ms p99, every day, for the life of the system. The partition case might occur a few times a year.

So the question that characterises a system is not "what do you do in a partition" but **"what is the coordination cost of a normal write, and did you choose it deliberately?"**

## The choice is per-operation, not per-database

The most common failure in applying this material is treating it as a database-selection question. It is not. Within one system:

- **A payment authorisation** must be linearizable. Double-charging is unacceptable; refusing during a partition is fine.
- **A view counter** should never block. Losing a few counts during a partition is invisible; making the page slow is not.
- **A user's own profile edit** needs read-your-writes for that user, and nobody else needs to see it instantly.
- **A "last seen" timestamp** can be seconds stale with no consequence.
- **An inventory decrement** needs linearizability *if* overselling is unacceptable — and many businesses accept overselling and reconcile, which converts a hard consistency requirement into a business process.

Same database, five different answers. Modern stores support this explicitly: per-query consistency levels, per-transaction isolation, a strongly-consistent read option alongside a fast one.

The method: **for each operation, ask what a stale or lost result costs, and how much latency the operation can afford.** Choose per operation, and be able to say why.

## What "eventual consistency" actually promises

"Eventual consistency" says: **if writes stop, all replicas will eventually agree.** That is a weak promise, and two things it does not say are where the trouble is.

**It does not bound "eventually."** Usually milliseconds, and during a partition it can be as long as the partition.

**It does not say what a client observes in the meantime.** This is the important part, because the observable anomalies have names and a client can hit any of them:

- **Reading your own write and not seeing it.** You update your profile, the read goes to a different replica, and you see the old value.
- **Monotonic reads violated.** You see a new value, then an older one, because successive reads hit different replicas. Time appears to go backwards.
- **Causality violated.** You see a reply to a comment before the comment.

These are not exotic. They are the default behaviour of a system with asynchronous replication and no session guarantees, and they surface as bug reports that are hard to reproduce because they depend on which replica served the request.

**The remedies are session guarantees**, and they are much cheaper than full linearizability:

- **Read-your-writes**: route a client's reads to a replica known to have their writes, or to the primary, for a window after a write. Often implemented by pinning a session or by passing a write timestamp the replica must have reached.
- **Monotonic reads**: pin a client to one replica, so it never moves backwards.
- **Causal consistency**: track dependencies so a read never observes an effect before its cause.

**This is the practical middle ground and it is where most good designs live.** Full linearizability is expensive; raw eventual consistency produces confusing bugs; session guarantees give each *client* a coherent view without global coordination. Being able to reach for them is more valuable than being able to recite CAP.

## The trade-offs are not fixed by physics

Two corrections to the fatalism this topic attracts.

**Consistency at scale is possible; it costs latency and money.** Spanner provides externally-consistent distributed transactions globally, using synchronised clocks with bounded uncertainty and a commit protocol that waits out that uncertainty. The cost is real — a commit wait, specialised time infrastructure, and cross-region round trips — but the claim "you cannot have consistency at global scale" is false.

**Systems change quadrant.** S3 was famously eventually consistent for years, then moved to strong read-after-write consistency for all operations. Nothing in physics changed; the engineering trade was re-made. So "eventually consistent" is a design decision that can be revisited, not an intrinsic property of distributed storage.

What is genuinely fixed: **coordination requires communication, and communication takes time.** If a write must be acknowledged in three regions, it costs a cross-region round trip. That is the floor, and everything else is engineering.

## Where this framing is the wrong tool

**For a single-node system.** CAP does not apply. A single PostgreSQL instance with no replicas has no partition scenario for its own data.

**For choosing a database.** "We need AP so we will use Cassandra" is backwards. Ask what each operation needs, then find a store that can express those needs — most modern stores span several quadrants by configuration.

**As a substitute for measuring.** "We are eventually consistent" is not a specification. *How* stale, at p50 and p99? What happens to a read-after-write path? Those are measurable, and the measurement is the useful artefact.

**For availability planning.** CAP's A is a formal property, not an SLO. Most real unavailability comes from bad deploys, capacity exhaustion and dependency failures, not from network partitions.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'pacelc-quadrants',
      title: 'The four quadrants, with real systems in each',
      caption:
        'Read the bottom row first. The else clause is paid on every operation for the system\'s life; the partition clause is paid a few times a year — which is why PC/EL is where most relational deployments actually sit, and why nobody says so.',
      code: `flowchart TB
    Q["PACELC:<br/>if Partition → A or C<br/>else → L or C"]

    Q --> PC["**PC** during a partition<br/>Refuse rather than serve stale"]
    Q --> PA["**PA** during a partition<br/>Serve possibly-stale data"]

    PC --> PCEC["**PC / EC**<br/>Spanner · sync-replicated primary<br/>Consistent always,<br/>latency always"]
    PC --> PCEL["**PC / EL**<br/>Single primary, async replicas<br/>Most relational deployments —<br/>the unnamed quadrant"]

    PA --> PAEL["**PA / EL**<br/>Dynamo-style, quorum ONE<br/>Fast and available,<br/>eventually consistent"]
    PA --> PAEC["**PA / EC**<br/>Quorum normally,<br/>relax during a partition<br/>Rare but real"]

    style PCEC fill:#17272a,stroke:#35897e
    style PCEL fill:#1c1814,stroke:#c99a4e
    style PAEL fill:#17272a,stroke:#35897e
    style PAEC fill:#231b2a,stroke:#7a5ea8`,
    },
    {
      kind: 'flow',
      id: 'anomaly-walk',
      title: 'What a client actually observes under eventual consistency',
      caption:
        'Step through it. Each anomaly is the default behaviour of async replication without session guarantees — and each has a remedy far cheaper than full linearizability.',
      nodes: [
        { id: 'client', label: 'Client', kind: 'client', x: 0, y: 180, detail: 'One user, several requests. Nothing pins them to a replica, so successive reads can land anywhere.' },
        { id: 'primary', label: 'Primary', kind: 'store', x: 210, y: 60, detail: 'Accepts the write and acknowledges immediately (EL). Replication proceeds in the background.' },
        { id: 'r1', label: 'Replica A', kind: 'store', x: 210, y: 180, detail: 'Has the write after a few milliseconds. A read here returns the new value.' },
        { id: 'r2', label: 'Replica B', kind: 'store', x: 210, y: 300, detail: 'Lagging — GC pause, slow disk, or a partition. A read here returns the old value, with nothing marking it as stale.' },
        { id: 'a1', label: 'Read-your-writes violated', kind: 'note', x: 440, y: 60, detail: 'Update your profile, read from Replica B, see the old name. The most user-visible anomaly and the one that generates support tickets.' },
        { id: 'a2', label: 'Monotonic reads violated', kind: 'note', x: 440, y: 180, detail: 'Read from A (new value), then from B (old value). Time appears to go backwards, and it depends on which replica served each request.' },
        { id: 'a3', label: 'Causality violated', kind: 'note', x: 440, y: 300, detail: 'A reply arrives on a replica that has the reply but not the comment it answers. The UI shows an effect before its cause.' },
        { id: 'fix', label: 'Session guarantees', kind: 'service', x: 660, y: 180, detail: 'Pin the session, or pass a write timestamp the replica must have reached. Gives this client a coherent view without global coordination — far cheaper than linearizability.' },
      ],
      edges: [
        { id: 'a-1', source: 'client', target: 'primary', kind: 'write' },
        { id: 'a-2', source: 'primary', target: 'r1', kind: 'async' },
        { id: 'a-3', source: 'primary', target: 'r2', kind: 'async' },
        { id: 'a-4', source: 'r2', target: 'a1', kind: 'control' },
        { id: 'a-5', source: 'r1', target: 'a2', kind: 'control' },
        { id: 'a-6', source: 'r2', target: 'a2', kind: 'control' },
        { id: 'a-7', source: 'r2', target: 'a3', kind: 'control' },
        { id: 'a-8', source: 'a2', target: 'fix', kind: 'async' },
      ],
      steps: [
        {
          id: 'x1',
          title: 'The write returns before the replicas have it',
          description:
            'This is the EL choice: acknowledge as soon as the primary has it. Fast, and it opens the window in which every anomaly below is possible.',
          nodes: ['client', 'primary', 'r1', 'r2'],
          edges: ['a-1', 'a-2', 'a-3'],
        },
        {
          id: 'x2',
          title: 'Read your own write and it is not there',
          description:
            'The read lands on the lagging replica and returns the old value, with nothing indicating it is stale. The user just changed this and sees the old version — the anomaly that produces support tickets.',
          nodes: ['a1', 'r2'],
          edges: ['a-4'],
        },
        {
          id: 'x3',
          title: 'Then time appears to go backwards',
          description:
            'One read hits the up-to-date replica, the next hits the lagging one. The value regresses. This is unreproducible from the user\'s description because it depends on routing.',
          nodes: ['a2', 'r1', 'r2'],
          edges: ['a-5', 'a-6'],
        },
        {
          id: 'x4',
          title: 'And causality breaks',
          description:
            'A replica can have a reply without the comment it answers, if the two writes replicated at different speeds. The interface shows an effect before its cause.',
          nodes: ['a3'],
          edges: ['a-7'],
        },
        {
          id: 'x5',
          title: 'Session guarantees fix all three, cheaply',
          description:
            'Pin the client to a replica, or pass a write timestamp the replica must have reached before serving. Each client gets a coherent view without any global coordination.',
          nodes: ['fix'],
          edges: ['a-8'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['amazon', 'google'],
    body: `Two systems at opposite poles, plus one that changed poles — together they show the trade is engineering rather than physics.

**Dynamo: PA/EL, and the cost pushed to the application.**

Amazon's shopping-cart requirement was that a customer must always be able to add to their cart, even during a datacentre partition. A rejected write is a lost sale, so availability was non-negotiable.

The consequences accepted: writes go to whichever replicas are reachable, conflicting versions can exist, and **the application must resolve them.** For a shopping cart the resolution is merging the item sets — union rather than last-write-wins — which means a partition might resurrect a removed item. That was judged strictly better than refusing the write.

The insight worth keeping: **choosing availability does not remove the consistency problem, it relocates it into your application code.** Dynamo's tunable quorums (\`R + W > N\` for strong reads) also mean the same store spans quadrants by configuration.

**Spanner: PC/EC, and the cost paid in latency and infrastructure.**

Google needed globally-distributed transactions with real consistency for advertising data, where inconsistency has direct financial consequences.

Spanner provides externally-consistent transactions across regions using **TrueTime** — an API returning an interval that certainly contains the current time, backed by GPS and atomic clocks — plus a commit protocol that waits out the clock uncertainty before making a transaction visible.

The costs, stated plainly: a commit wait proportional to clock uncertainty, cross-region round trips for multi-region transactions, and specialised time infrastructure in every datacentre. Write latency is tens of milliseconds where an eventually-consistent store would be single-digit.

The insight: **"you cannot have consistency at global scale" is false. You can, and here is the bill.**

**S3: a system that changed quadrant.**

S3 was eventually consistent for overwrites and deletes for years, and developers built elaborate workarounds — retry loops, external consistency layers, naming schemes that avoided overwrites. Then it moved to strong read-after-write consistency for all operations, at no additional cost to users.

Nothing about physics changed. The engineering trade was re-made, presumably because the aggregate cost borne by every application working around eventual consistency exceeded the cost of providing it centrally.

**The transferable conclusion.** These are three points on a spectrum, chosen for three different requirements. The question is never "which quadrant is correct" but **"what does each of my operations need, and what am I willing to pay for it?"** — and the S3 case is the reminder that an answer given years ago is not necessarily still the right one.`,
  },

  tradeoffs: {
    intro:
      'The decision is per operation, not per system. Rows are the positions available for a given operation, with what each actually costs.',
    rows: [
      {
        option: 'Linearizable reads and writes (PC/EC)',
        whenItWins:
          'Payments, inventory where overselling is unacceptable, uniqueness constraints, anything where a stale read causes a financial or safety consequence.',
        whenItLoses:
          'High-volume operations where latency matters, and anything that must keep working during a partition.',
        cost:
          'A coordination round trip on every operation — single-digit ms same-region, tens of ms cross-region — and unavailability during a partition.',
      },
      {
        option: 'Quorum reads and writes (`R + W > N`)',
        whenItWins:
          'When you want strong reads without a single primary. Tune R and W per operation: `W=N, R=1` for read-heavy, `W=1, R=N` for write-heavy.',
        whenItLoses:
          'When a partition makes the quorum unreachable, or when the latency of the slowest quorum member is unacceptable.',
        cost:
          'Latency of the slowest node in the quorum, and unavailability when a quorum cannot be formed.',
      },
      {
        option: 'Read-your-writes for the writing session',
        whenItWins:
          'The most common real requirement. A user must see their own edits; nobody else needs to see them instantly. Cheap, and it removes the anomaly users actually report.',
        whenItLoses:
          'When two users must see each other\'s writes immediately, which this does not provide.',
        cost:
          'Session routing or write-timestamp tracking, and reduced replica utilisation while a session is pinned.',
      },
      {
        option: 'Monotonic reads (pin a session to one replica)',
        whenItWins:
          'When values regressing is the visible problem — a count going down, a status reverting. Very cheap to implement.',
        whenItLoses:
          'When the pinned replica falls far behind, or fails and the session must move.',
        cost:
          'Uneven replica load, and a discontinuity when a pinned replica is lost.',
      },
      {
        option: 'Causal consistency',
        whenItWins:
          'Comment threads, collaborative editing, anything where showing an effect before its cause is confusing or wrong.',
        whenItLoses:
          'When operations are genuinely independent, making the dependency tracking pure overhead.',
        cost:
          'Dependency metadata on every operation, and machinery to enforce ordering.',
      },
      {
        option: 'Eventual consistency (PA/EL)',
        whenItWins:
          'Counters, analytics, activity feeds, cached projections — where a lost or stale value costs nothing and availability and latency are what matter.',
        whenItLoses:
          'Anywhere a user notices. Read-your-writes and monotonic-read violations are confusing bugs that are hard to reproduce.',
        cost:
          'Conflict resolution becomes the application\'s problem, and anomalies surface as unreproducible reports.',
      },
      {
        option: 'Accept the inconsistency and reconcile as a business process',
        whenItWins:
          'Overselling that is resolved with an apology and a refund, or a ledger reconciled nightly. Often the cheapest correct answer.',
        whenItLoses:
          'When the inconsistency cannot be reversed — a dispatched order, a sent message, a granted permission.',
        cost:
          'A reconciliation process, and occasional customer-facing remediation.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"CAP says pick two of consistency, availability and partition tolerance."',
      whyWeak:
        'Partition tolerance is not a choice — networks partition, so it is a fact about the world. The theorem says that *during a partition* you must choose between consistency and availability. "Pick two" implies a "CA" option that does not exist for a distributed system.',
      strongAnswer:
        '"CAP is about behaviour during a partition: refuse to serve, or serve possibly-stale data. Partition tolerance is not optional since networks fail. And the more useful frame is PACELC, which adds what you trade when the network is *fine* — latency or consistency — because that is the cost you pay on every operation rather than a few times a year."',
    },
    {
      weakAnswer: '"We chose AP because we need high availability."',
      whyWeak:
        'It conflates CAP\'s formal availability with an uptime SLO, and it treats the choice as system-wide. Most real unavailability comes from bad deploys, capacity exhaustion and dependency failures rather than network partitions, so "AP" buys very little of the uptime being asked for.',
      strongAnswer:
        '"CAP availability is a formal property about partition behaviour, not an SLO — choosing PA does little for the uptime that bad deploys and capacity exhaustion actually cost us. And the choice is per operation: a payment should refuse rather than risk a double charge, while a view counter should never block. I would state it as PC or PA per operation, plus what latency each pays normally."',
    },
    {
      weakAnswer: '"PostgreSQL is CP because it is ACID."',
      whyWeak:
        'Two different meanings of "consistency". ACID\'s C is about the database\'s invariants holding within a transaction; CAP\'s C is linearizability across replicas. A single-node ACID database is not a distributed system, so CAP does not apply to it at all.',
      strongAnswer:
        '"Those are different properties sharing a word. ACID consistency means the declared invariants hold; CAP consistency means linearizability across replicas. A single PostgreSQL instance is fully ACID and CAP does not apply to it. A replicated deployment is usually PC/EL — it refuses writes without a primary, and it does not wait for async replicas normally."',
    },
    {
      weakAnswer: '"We are eventually consistent, so replicas converge quickly."',
      whyWeak:
        'It is not a specification. Eventual consistency promises that replicas agree *if writes stop*, with no bound on when, and says nothing about what a client observes meanwhile — which is where the actual bugs are.',
      strongAnswer:
        '"Eventual consistency only promises convergence if writes stop. What matters is what a client observes in the window: reading your own write and not seeing it, values regressing between reads, an effect appearing before its cause. I would measure replication lag at p50 and p99, and add session guarantees — read-your-writes and monotonic reads — which fix the user-visible anomalies far more cheaply than linearizability."',
    },
    {
      weakAnswer: '"You cannot have strong consistency at global scale."',
      whyWeak:
        'Demonstrably false. Spanner provides externally-consistent distributed transactions across regions, and S3 moved from eventual to strong read-after-write consistency without charging more. What is fixed is that coordination costs a round trip — not that it is impossible.',
      strongAnswer:
        '"You can — Spanner does it with synchronised clocks and a commit wait, and S3 moved from eventual to strong read-after-write consistency. What is genuinely fixed is that coordination requires communication, so a write acknowledged in three regions costs a cross-region round trip. That is a cost to decide about, not an impossibility. The interesting question is which operations are worth paying it for."',
    },
    {
      weakAnswer: '"We use a strongly consistent database, so we do not have these problems."',
      whyWeak:
        'A store can be linearizable and still be read through caches, replicas and derived projections — each of which reintroduces staleness. And "strongly consistent" often means linearizable per key while offering nothing across keys, so cross-entity invariants are still not protected.',
      strongAnswer:
        '"That covers the store and not the system. Any cache, read replica, search index or materialised view in front of it reintroduces staleness, and a linearizable store usually guarantees linearizability per key rather than across keys — so a cross-entity invariant still needs a transaction. I would trace each read path and ask what it can actually observe, rather than reasoning from the store\'s label."',
    },
  ],

  flashcards: [
    {
      id: 'fc-cap-1',
      front: 'What does CAP actually say?',
      back: 'During a network partition, choose consistency (refuse or error) or availability (serve possibly-stale data). Partition tolerance is not a choice — networks partition.',
      topic: 'cap',
    },
    {
      id: 'fc-cap-2',
      front: 'Why is "pick two of CAP" wrong?',
      back: 'P is not optional, so there is no "CA" distributed system. The choice is between C and A, and only during a partition.',
      topic: 'cap',
    },
    {
      id: 'fc-cap-3',
      front: 'What does PACELC add?',
      back: 'The else clause: when there is no partition, choose latency or consistency. That is the trade paid on every operation, so it governs the design.',
      topic: 'pacelc',
    },
    {
      id: 'fc-cap-4',
      front: 'What is the quadrant nobody names, and who is in it?',
      back: 'PC/EL — refuse writes without a primary, but do not wait for replicas normally. Most single-primary relational deployments with async replicas.',
      topic: 'pacelc',
    },
    {
      id: 'fc-cap-5',
      front: 'What does CAP\'s "consistency" mean precisely?',
      back: 'Linearizability: there appears to be one copy, and every read sees the most recent completed write. Not ACID\'s C, which is about invariants holding.',
      topic: 'consistency',
    },
    {
      id: 'fc-cap-6',
      front: 'Why is "PostgreSQL is CP because it is ACID" wrong?',
      back: 'Different properties sharing a word. ACID C is invariants within a transaction; CAP C is linearizability across replicas. CAP does not apply to a single node.',
      topic: 'consistency',
    },
    {
      id: 'fc-cap-7',
      front: 'Why is CAP availability not an SLO?',
      back: 'It is a formal property — every request to a non-failed node gets a non-error response. Real unavailability mostly comes from deploys, capacity and dependencies, not partitions.',
      topic: 'availability',
    },
    {
      id: 'fc-cap-8',
      front: 'At what granularity is the consistency choice made?',
      back: 'Per operation. A payment needs linearizability; a view counter must never block. Same database, different answers, expressed through per-query consistency levels.',
      topic: 'consistency',
    },
    {
      id: 'fc-cap-9',
      front: 'What does eventual consistency actually promise?',
      back: 'If writes stop, replicas eventually agree. It bounds nothing about when, and says nothing about what a client observes meanwhile.',
      topic: 'consistency',
    },
    {
      id: 'fc-cap-10',
      front: 'Name the three anomalies a client hits under eventual consistency.',
      back: 'Read-your-writes violated (your own edit missing), monotonic reads violated (values regress), causality violated (an effect before its cause).',
      topic: 'consistency',
    },
    {
      id: 'fc-cap-11',
      front: 'What are session guarantees, and why do they matter?',
      back: 'Read-your-writes, monotonic reads and causal consistency — each client gets a coherent view without global coordination. Far cheaper than linearizability and they fix the anomalies users report.',
      topic: 'consistency',
    },
    {
      id: 'fc-cap-12',
      front: 'What did choosing availability cost Dynamo?',
      back: 'Conflict resolution moved into the application — shopping carts merge item sets, so a partition can resurrect a removed item. Choosing A relocates the consistency problem rather than removing it.',
      topic: 'partitions',
    },
    {
      id: 'fc-cap-13',
      front: 'What does Spanner prove, and at what price?',
      back: 'That global strong consistency is possible. The price is a commit wait proportional to clock uncertainty, cross-region round trips, and specialised time infrastructure.',
      topic: 'partitions',
    },
    {
      id: 'fc-cap-14',
      front: 'What is genuinely fixed by physics here?',
      back: 'Coordination requires communication, and communication takes time. A write acknowledged in three regions costs a cross-region round trip. Everything else is engineering.',
      topic: 'availability',
    },
  ],

  quiz: [
    {
      id: 'q-cap-1',
      kind: 'scenario',
      prompt:
        'A team describes their single-primary PostgreSQL cluster with synchronous same-region replicas and an async cross-region read replica as "an AP system". What is the accurate description?',
      options: [
        { id: 'a', label: 'PC/EC for writes (they refuse without a primary and wait for sync replicas), and PA/EL for reads served from the async replica' },
        { id: 'b', label: 'AP, since the read replica remains available during a partition' },
        { id: 'c', label: 'CP, since PostgreSQL is ACID' },
        { id: 'd', label: 'CA, since the cluster is within controlled infrastructure' },
      ],
      correct: ['a'],
      explanation:
        'Writes stop without a primary, so writes are PC; synchronous replicas mean writes wait, so writes are EC. Cross-region async reads stay available and can be stale, so those reads are PA/EL. The system occupies different quadrants per operation, which is normal. ACID is a separate property, and "CA" does not exist for a distributed system.',
      difficulty: 'advanced',
      topic: 'pacelc',
    },
    {
      id: 'q-cap-2',
      kind: 'scenario',
      prompt:
        'A user updates their display name and immediately reloads the page. The old name appears. Reloading again shows the new one. What is happening and what is the cheapest fix?',
      options: [
        { id: 'a', label: 'Read-your-writes violated by a lagging replica; fix by routing that session\'s reads to the primary or to a replica known to have their write, for a window after the write' },
        { id: 'b', label: 'A caching bug requiring cache invalidation' },
        { id: 'c', label: 'The database needs to be switched to a strongly consistent store' },
        { id: 'd', label: 'The write was lost and succeeded on retry' },
      ],
      correct: ['a'],
      explanation:
        'The classic read-your-writes anomaly: the write went to the primary and the read landed on a replica that had not received it. Session-scoped routing — or passing a write timestamp the replica must have reached — fixes it without global coordination. Switching to a linearizable store solves it at vastly higher cost, and a cache is not implicated here.',
      difficulty: 'core',
      topic: 'consistency',
    },
    {
      id: 'q-cap-3',
      kind: 'scenario',
      prompt:
        'Which of these operations in a single e-commerce system should be linearizable, and which should not block during a partition?',
      options: [
        { id: 'a', label: 'Payment authorisation linearizable; product page view count must not block — the choice is per operation' },
        { id: 'b', label: 'All of them linearizable, since it is one database' },
        { id: 'c', label: 'None of them, since availability matters most for commerce' },
        { id: 'd', label: 'It depends only on which database was selected' },
      ],
      correct: ['a'],
      explanation:
        'This is the central practical point: the consistency choice is per operation, not per database. A double charge is unacceptable and refusing during a partition is fine; a lost view count is invisible and a slow page is not. Modern stores express this with per-query consistency levels.',
      difficulty: 'core',
      topic: 'consistency',
    },
    {
      id: 'q-cap-4',
      kind: 'single',
      prompt: 'What does "eventually consistent" guarantee?',
      options: [
        { id: 'a', label: 'That if writes stop, replicas will eventually agree — with no bound on when, and no statement about what a client observes meanwhile' },
        { id: 'b', label: 'That replicas converge within a few hundred milliseconds' },
        { id: 'c', label: 'That reads never return values older than the previous read' },
        { id: 'd', label: 'That a client always sees its own writes' },
      ],
      correct: ['a'],
      explanation:
        'It is a convergence promise conditional on writes stopping, with no time bound and no client-observable guarantees. Options c and d are monotonic reads and read-your-writes — session guarantees that must be added deliberately and are not implied by eventual consistency.',
      difficulty: 'core',
      topic: 'consistency',
    },
    {
      id: 'q-cap-5',
      kind: 'scenario',
      prompt:
        'A design review asserts "you cannot have strong consistency across regions". What is the accurate response?',
      options: [
        { id: 'a', label: 'You can — Spanner does it with synchronised clocks and a commit wait; what is fixed is that coordination costs a cross-region round trip' },
        { id: 'b', label: 'Correct, CAP forbids it' },
        { id: 'c', label: 'Correct, unless all regions are in the same continent' },
        { id: 'd', label: 'You can, and it costs nothing extra with modern databases' },
      ],
      correct: ['a'],
      explanation:
        'Spanner provides externally-consistent cross-region transactions, and S3 moved from eventual to strong read-after-write consistency. CAP forbids consistency *and* availability during a partition, not consistency itself. The real constraint is that coordination requires communication, which has a latency floor — so it is a cost to decide about, not an impossibility.',
      difficulty: 'advanced',
      topic: 'partitions',
    },
    {
      id: 'q-cap-6',
      kind: 'multi',
      prompt:
        'A store is described as "strongly consistent". Which concerns still apply? Select all that apply.',
      options: [
        { id: 'a', label: 'Caches, read replicas, search indexes and materialised views in front of it reintroduce staleness' },
        { id: 'b', label: 'The guarantee may be per key, so cross-entity invariants still need a transaction' },
        { id: 'c', label: 'Reads through those derived paths must be traced individually to know what they can observe' },
        { id: 'd', label: 'The application no longer needs to handle write failures' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'A store\'s label describes the store, not the system. Every derived read path reintroduces staleness, and per-key linearizability protects nothing across keys. Write failures still occur — during failover, under partition if the store is PC, and from ordinary timeouts — so the application must handle them regardless.',
      difficulty: 'advanced',
      topic: 'consistency',
    },
  ],

  exercises: [
    {
      id: 'ex-cap-1',
      kind: 'design',
      title: 'Classify every operation, then state the bill',
      estimatedMinutes: 30,
      prompt: `A ride-hailing platform runs in three regions. For each operation below, specify: the consistency requirement, the PACELC position (PC or PA, EC or EL), the mechanism, and the cost of getting it wrong.

1. Charge a rider's card at trip end.
2. Assign a driver to a ride request.
3. Update the driver's live location, every 4 seconds.
4. Show a rider their trip history.
5. Apply a promo code that can be used exactly once per rider.
6. Increment a "trips completed" counter on the driver's profile.
7. A driver toggles themselves offline.

Then answer:

- Which operation is hardest, and why?
- Region B is partitioned from A and C for 90 seconds. What happens to each operation?
- A rider changes their payment method and immediately starts a trip. What must be true?
- Where would you deliberately accept inconsistency and reconcile afterwards?`,
      rubric: [
        'Payment classified as linearizable with idempotency, PC/EC, and the double-charge cost named.',
        'Driver assignment identified as requiring mutual exclusion — one driver cannot take two rides.',
        'Location updates classified as PA/EL with loss explicitly acceptable.',
        'Trip history classified as tolerating staleness, with a read-your-writes carve-out for a just-completed trip.',
        'Promo code identified as a uniqueness constraint requiring linearizability or a compensating check.',
        'Counter classified as PA/EL, with a note that it should not be the source of truth.',
        'Offline toggle identified as needing read-your-writes for the driver and speed for others.',
        'Partition answer is per-operation and specific about which region can do what.',
        'Payment-method answer identifies the read-your-writes path across services.',
        'Names at least one place where business-process reconciliation beats technical consistency.',
      ],
      modelAnswer: `**1. Charge a rider's card — linearizable, PC/EC**

*Requirement:* exactly-once effect. A double charge is a financial error with a support cost and a trust cost.

*Position:* **PC** — if I cannot reach the authoritative payment state, I refuse and retry later rather than risk charging twice. **EC** — I wait for the write to be durable and acknowledged before considering the charge recorded.

*Mechanism:* an idempotency key derived from the trip id, with the payment record written in the same transaction as the charge attempt. The payment processor also enforces idempotency on that key. The charge is triggered from a durable queue so a failure retries with the same key.

*Cost of getting it wrong:* a double charge, or a charge with no corresponding trip record — which is worse, because it is invisible until the customer complains.

*Note:* this operation does not need to be synchronous with trip end. A trip can complete and the charge can happen seconds later from a queue, which converts a latency-sensitive consistent operation into a latency-insensitive one. **That reframing is the most valuable move available here**, and it is available far more often than people use it.

**2. Assign a driver to a ride request — linearizable, PC/EC**

*Requirement:* mutual exclusion. One driver must not be assigned two rides, and one ride must not get two drivers.

*Position:* **PC** — if I cannot establish exclusive assignment, I must not assign. Assigning twice is worse than a delayed match. **EC** — the assignment must be confirmed before the rider is told.

*Mechanism:* a conditional write on the driver's assignment record — compare-and-set from \`available\` to \`assigned:<ride_id>\` — which fails if another assignment won. The matching service can propose optimistically; the conditional write is the arbiter. This is a per-key linearizable operation, which most stores provide cheaply, rather than a distributed transaction.

*Cost of getting it wrong:* two riders expecting the same driver. Very visible, and it damages trust in the platform's core promise.

*Latency:* this is on the critical path and users are waiting, so the coordination must be regional rather than global — which is fine, because a driver and a rider are in the same region by definition.

**3. Driver live location every 4 seconds — eventual, PA/EL**

*Requirement:* none beyond freshness. A location 4 seconds stale is fine; a location 60 seconds stale is not.

*Position:* **PA** — during a partition, keep accepting location updates and keep serving whatever is known. **EL** — acknowledge immediately, replicate in the background.

*Mechanism:* write to a regional in-memory store (a Redis geospatial index or sorted set) with a short TTL. No cross-region replication of individual updates — a rider in region A does not need a driver's location in region C.

*Cost of getting it wrong:* a slightly stale marker on a map. Invisible. **The real risk is the opposite mistake:** making this consistent would add coordination to the highest-volume write in the system, at thousands per second per region, for no benefit.

*Note the volume asymmetry:* this is by far the most frequent operation and the one with the weakest requirement. That correlation is common and worth exploiting — the operations you do most are usually the ones that need the least.

**4. Trip history — eventual, PA/EL, with one carve-out**

*Requirement:* staleness of seconds is fine for old trips.

*Position:* **PA/EL** — serve from a regional read replica, fast and always available.

*Carve-out that matters:* **a rider who just completed a trip expects to see it.** That is read-your-writes, and it is the anomaly that generates support tickets. Mechanism: after a trip completes, that rider's session reads from the primary (or from a replica confirmed to have reached the trip's write timestamp) for the next 30 seconds.

*Cost of getting it wrong:* "where is my trip? did I get charged for nothing?" — a support contact caused entirely by replication lag, and one that is hard to reproduce because it depends on which replica served the request.

**5. Promo code, once per rider — linearizable, PC/EC**

*Requirement:* a uniqueness constraint. Exactly one successful redemption per (rider, code).

*Position:* **PC** — if I cannot verify uniqueness, refuse. **EC** — the redemption record must be committed before the discount applies.

*Mechanism:* a unique constraint on \`(rider_id, promo_code)\` in a single authoritative store, with the insert as the redemption. The insert succeeding *is* the redemption; a duplicate-key error *is* the rejection. No read-then-write, no race.

*The subtlety worth naming:* if the promo store and the trip store are different services, then "apply discount" and "record redemption" span two systems. Options: record the redemption first and let a failed trip leave an unused-but-consumed code (annoying, safe), or use a saga with compensation. **I would consume first**, because a rider losing a promo code to a failed trip is a support conversation while a rider using a code ten times is a financial loss.

*Cost of getting it wrong:* a code with a global limit gets used far more than intended. This is a well-known and repeatedly-exploited class of bug.

**6. Trips-completed counter — eventual, PA/EL**

*Requirement:* approximately right. Nobody notices if it is off by one for a minute.

*Position:* **PA/EL** — increment locally, converge in the background.

*Mechanism:* a per-region counter aggregated periodically, or a CRDT counter that merges without coordination. **It must not be the source of truth** — the authoritative count is derivable from the trips table, and this is a cached projection.

*Cost of getting it wrong:* almost nothing, **unless the counter drives something that matters.** If driver bonuses are paid at 100 trips, the counter is suddenly financial and needs to be computed from the trips table at payout time rather than read from the projection. That distinction — display value versus payout value — is exactly the kind of requirement that arrives later and quietly breaks the original classification.

**7. Driver toggles offline — read-your-writes for the driver, PA/EL for everyone else**

*Requirement:* the driver must see themselves as offline immediately, and must stop receiving ride requests promptly. Other parties can learn a second later.

*Position:* **PA/EL** for propagation, with read-your-writes for the driver's own session.

*Mechanism:* write to the regional store, acknowledge, and update the driver's app optimistically. The matching service reads the same regional store, so it sees the change within its next poll or push.

*The failure mode worth designing for:* the driver toggles offline and immediately receives a ride request because the matcher had already selected them. **That is not a consistency bug to eliminate — it is a race to handle**, and the handling is that the driver can decline without penalty and the matcher reassigns. Trying to make this race impossible would require coordination on the hottest path in the system.

*Cost of getting it wrong:* a driver receiving requests after going offline, which is a real irritation and a common complaint about such platforms.

**Which operation is hardest?**

**Driver assignment**, and not because of the consistency requirement — a conditional write handles that. It is hardest because it is the only operation that is *simultaneously* linearizable and latency-critical and contended.

- Payments are linearizable but not latency-critical (they can be queued).
- Promo codes are linearizable but rarely contended.
- Location updates are latency-critical but need no consistency.
- Assignment is all three at once: a rider is waiting, several requests may target the same driver, and getting it wrong is highly visible.

The mitigation is that contention is naturally regional — a driver and a rider are co-located — so the coordination is regional rather than global. **If the design required global coordination for assignment, this operation would be the thing that made the system infeasible.** Recognising which single operation is load-bearing is the useful output of this exercise.

**Region B partitioned from A and C for 90 seconds**

Assuming each region has its own authoritative store for regional data, with cross-region replication for global data (riders, drivers, payment methods, promo codes):

| Operation | Within region B | Riders in A/C needing B's data |
| --- | --- | --- |
| 1. Charge card | **Fails or queues** — payment authority is global. Queue and retry after; trips complete uncharged for 90 s. | Unaffected. |
| 2. Driver assignment | **Works** — driver and rider are both in B, and the assignment store is regional. | Unaffected; no cross-region matching. |
| 3. Location updates | **Works** — regional store, PA. | Unaffected. |
| 4. Trip history | **Works for B trips**; **stale or unavailable for trips taken in A/C.** Degraded, not broken. | Unaffected. |
| 5. Promo code | **Fails** — uniqueness needs global authority. Riders in B cannot redeem for 90 s. | Unaffected. |
| 6. Counter | **Works**, diverges, converges after. | Unaffected. |
| 7. Offline toggle | **Works** — regional. | Unaffected. |

**The summary that matters: rides keep happening in region B. Money and global uniqueness pause.** That is the correct degradation, and it is a direct consequence of putting regional operations on regional authority and global operations on global authority.

**One thing I would add: the charge queue must be durable and must survive the partition.** If trips complete for 90 seconds and the charge attempts are held in memory, a process restart during the partition loses revenue with no record. The queue is what makes "PC for payments" acceptable rather than lossy — and it is the detail that turns a plausible answer into a correct one.

**Rider changes payment method, then immediately starts a trip**

This is a **read-your-writes requirement crossing a service boundary**, which is the case that breaks most often.

What must be true: when the trip-completion charge reads the rider's payment method, it must see the *new* one — not the old one, and not a version that is 200 ms stale.

Why this breaks in practice: the payment-method write goes to a global authoritative store. The charge happens seconds later, from a queue, possibly in a different region, reading a *replica* of that store. If that replica is lagging, the charge uses the old card — which may be the one the rider just removed because it was declining.

*The fix:* carry the payment-method version or timestamp on the trip record at trip start, and have the charge require a replica that has reached at least that version — or read the primary. **Passing the required version forward with the work item** is the general pattern for read-your-writes across an asynchronous boundary, and it is much more robust than hoping replication is fast.

*The cheaper alternative:* resolve the payment method at trip *start* and record the resolved token on the trip. Then the charge reads the trip, not the rider. That removes the cross-service read-your-writes requirement entirely — and removing a requirement is always better than satisfying it.

**Where I would deliberately accept inconsistency and reconcile**

**Trips completed during a payment partition.** Rather than blocking trip completion on a chargeable payment, complete the trip and queue the charge. Some charges will fail permanently — an expired card, a closed account — and those go to a collections process, not to a technical retry. The alternative, refusing to end trips because payment authority is unreachable, is far worse for the business.

**Driver bonus thresholds.** Rather than making the counter linearizable, compute payouts from the trips table on a schedule. The counter can be wrong all week as long as the payout is right. **This is the general move: separate the display value from the money value**, and only the money value needs to be correct.

**Promo code global limits.** A code limited to 10,000 uses can plausibly be allowed to reach 10,050 during a partition, because the marketing cost of 50 extra discounts is less than the cost of refusing valid redemptions for 90 seconds. Per-rider uniqueness must stay strict; the global cap can be approximate. **Two limits on the same feature with different consistency requirements** — and noticing that is the kind of distinction that separates a real design from a label.

**Where I would not accept it:** the charge itself, per-rider promo uniqueness, and driver assignment. Each has an irreversible or highly visible consequence, and for each the coordination cost is affordable because the operation is either infrequent or naturally regional.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-cap-1',
      level: 'basic',
      question: 'What does the CAP theorem say?',
      guidance:
        'During a partition, choose consistency or availability. Look specifically for the rejection of "pick two" and the recognition that P is not optional. A strong answer moves straight to PACELC.',
    },
    {
      id: 'iq-cap-2',
      level: 'basic',
      question: 'What does "eventually consistent" guarantee?',
      guidance:
        'Convergence if writes stop, with no time bound and nothing about client observations. A strong answer names the anomalies — read-your-writes, monotonic reads, causality — as the thing that actually matters.',
    },
    {
      id: 'iq-cap-3',
      level: 'intermediate',
      question: 'What is PACELC and why is the else clause more important?',
      guidance:
        'Because you pay it on every operation rather than a few times a year. Look for concrete latency numbers — single-digit ms same-region, tens of ms cross-region — and for naming PC/EL as the common unlabelled quadrant.',
    },
    {
      id: 'iq-cap-4',
      level: 'intermediate',
      question: 'A user updates their profile and does not see the change. Diagnose and fix it.',
      guidance:
        'Read-your-writes violated by a lagging replica. The fix is session-scoped routing or passing a write timestamp — not switching to a linearizable store, which is a vastly more expensive answer to the same problem.',
    },
    {
      id: 'iq-cap-5',
      level: 'advanced',
      question: 'Walk me through the consistency requirements of an e-commerce checkout.',
      guidance:
        'Per-operation classification: payment linearizable, inventory depends on whether overselling is acceptable, view counts eventual. Excellent answers note that queueing a payment converts a latency-sensitive consistent operation into a latency-insensitive one.',
    },
    {
      id: 'iq-cap-6',
      level: 'advanced',
      question: 'Someone says strong consistency is impossible across regions. Respond.',
      guidance:
        'Spanner and the S3 change disprove it. What is fixed is that coordination costs a round trip. Excellent answers name the actual bill — commit wait, clock infrastructure, cross-region latency — rather than just asserting it is possible.',
    },
    {
      id: 'iq-cap-7',
      level: 'followup',
      question: 'You said the store is strongly consistent. What still worries you?',
      guidance:
        'Every derived read path — cache, replica, search index, materialised view — reintroduces staleness, and per-key linearizability protects nothing across keys. A strong answer traces read paths rather than reasoning from the store\'s label.',
    },
    {
      id: 'iq-cap-8',
      level: 'followup',
      question: 'Where would you deliberately accept inconsistency and reconcile in a business process?',
      guidance:
        'Overselling with an apology, a nightly ledger reconciliation, an approximate global promo cap alongside a strict per-user one. Look for the distinction between a display value and a money value.',
    },
  ],

  activeLearning: [
    {
      id: 'al-cap-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed a partition is a rare, discrete event. Now change one thing: the network is not partitioned but is intermittently very slow — 5% of messages take over 2 seconds. What does CAP say, and what actually breaks?',
      discussion: `This is the case CAP handles poorly and that dominates real operations, so it is worth being precise.

**What CAP says: this is a partition.** A message delayed beyond your timeout is indistinguishable from a lost message. A node cannot tell "slow" from "dead", so from the algorithm's perspective an intermittently slow network *is* an intermittent partition. Formally, nothing new.

**What actually breaks, and it is worse than a clean partition.**

**A clean partition is easy to detect and reason about.** Nodes are unreachable, failure detectors fire, a leader election happens, the system settles into a degraded but coherent state. There is a clear before and after.

**Intermittent slowness produces flapping.** Failure detectors fire and clear. Leaders are elected and re-elected. Replicas are marked down and brought back. Each transition has a cost — a leader election pauses writes, a replica rejoining triggers catch-up traffic — and the transitions arrive continuously. **The system spends its time reacting rather than serving**, and this is far more damaging than a stable partition of the same duration.

**Timeouts become the whole design.** With 5% of messages over 2 seconds, a 1-second timeout makes 5% of operations fail spuriously. A 5-second timeout means a genuinely dead node takes 5 seconds to detect, and every operation that hits the bad path adds 5 seconds of latency to something upstream. **There is no good value**, which is the defining feature of this regime.

**Quorum systems degrade in a specific way.** A quorum needs a majority to respond. With 5% of messages slow, the probability that at least one of three quorum members is slow is about 14%. So 14% of operations wait on the slow path — the tail latency of the quorum is much worse than the tail latency of one node. **Coordination amplifies tail latency**, and that is the single most practically important fact in this discussion.

**And the anomalies from the eventual-consistency section become intermittent and unreproducible.** Replication lag spikes to seconds at random, so read-your-writes violations occur in 5% of cases with no pattern. These are the bug reports that cannot be reproduced.

**What actually helps, in order.**

**Hedged requests.** Send to a second replica if the first has not responded within, say, the p95 latency. Costs a little extra load and cuts the tail dramatically, because you only need one of two slow paths to be fast. This is the highest-value single technique for this regime.

**Aggressive per-attempt timeouts with retries and jitter**, plus a retry budget so retries cannot amplify load. Short timeout, quick retry elsewhere.

**Failure-detector hysteresis.** Require several consecutive failures to mark a node down and several successes to bring it back — the asymmetric thresholds from the load-balancing lesson. This converts flapping into a stable decision.

**Choosing EL where you can.** A system that does not wait for replicas normally is far less exposed to tail latency, because there is one path rather than a quorum of paths.

**Measuring at p99, not p50.** In this regime the mean tells you nothing. p50 is fine and p99 is catastrophic, and only one of those is what users experience on a page with twenty requests.

**The transferable point.** CAP frames the world as partitioned or not. The operational reality is a continuum of degradation, and the interesting engineering lives in the middle: how do you behave when the network is *bad* rather than *broken*? That question is not answered by choosing a quadrant. It is answered by timeouts, hedging, hysteresis and tail-latency measurement — which is why teams that can recite CAP still have incidents, and teams that instrument p99 do not.`,
    },
    {
      id: 'al-cap-2',
      kind: 'debug',
      prompt:
        'A social app shows a comment count of 12 on a post, but only 9 comments render. Some users see 12/12, some see 12/9, and one user reports seeing the count go from 12 down to 11. Nobody deleted anything. Hypotheses?',
      discussion: `Three distinct symptoms — a count that disagrees with the list, disagreement between users, and a count going backwards. A single cause should explain all three, and the third is the most diagnostic because a count decreasing without a deletion is a strong constraint.

**Hypothesis 1 — the count and the comments are read from paths with different lag.** If the count is a denormalised field on the post and the comments are a separate query, they can be served by replicas at different positions in the replication stream. 12 comes from a replica that has 12 comments; the list comes from one that has 9.

*Why the decrease fits:* successive reads landing on differently-lagged replicas make the count appear to move in both directions. This is a monotonic-reads violation, and it is the only listed hypothesis that naturally produces a *decrease*.

*Check:* whether the count and the list are read from the same connection or replica within one request. If not, this is almost certainly it.

**Hypothesis 2 — the count is a cached projection with a different invalidation path.** If the count comes from a cache updated by an async consumer and the list from the database, the two are consistent only when the consumer is caught up. Consumer lag produces exactly this.

*Why the decrease fits:* less naturally. A cache would usually be stale in one direction. It fits if the cache is per-region and the user's requests move between regions — a region behind sees a lower count.

*Check:* consumer lag on whatever updates the count, and whether the count cache is regional.

**Hypothesis 3 — the count includes comments the list filters out.** Deleted, hidden, spam-flagged, or from blocked users. The count is over all rows; the list applies a visibility filter. This produces a persistent 12/9 disagreement.

*Why it fails to explain everything:* it does not explain user-to-user disagreement of the *count*, and it does not explain the decrease. But it might be a *second*, coexisting bug — and the 12 versus 9 gap of three is suspiciously stable for a pure lag explanation.

*Check:* whether the 3 missing comments exist with a status the list excludes. Cheap and worth doing regardless.

**Hypothesis 4 — the counter is a non-idempotent increment that has drifted.** If the count is incremented by a consumer with at-least-once delivery and no idempotency, retries over-count. Persistent over-count and it never self-corrects.

*Why the decrease fits:* only if something periodically recomputes the count from the source and corrects it downward — which is a plausible reconciliation job, and would produce exactly one observed decrease.

*Check:* compare the stored count against a count over the comments table for several posts. Systematic over-counting confirms it; and if a reconciliation job exists, its run times should correlate with observed decreases.

**Hypothesis 5 — pagination or a limit in the list query.** If the list fetches with a limit and the client renders what it received, 9 could be a page. Simple and common.

*Check:* the list query's limit and whether the client paginates. Should be eliminated first because it is trivial.

**What I would check first: whether the count and the list are read from the same replica within a single request.** It is the one hypothesis that explains all three symptoms — the disagreement, the per-user variation, and the decrease — and it is answerable by reading the request path.

**Then: pagination** (trivial to eliminate) and **stored count versus computed count** across a sample of posts, which distinguishes a lag problem from a drift problem definitively.

**The structural fix, whatever the answer.** **Read the count and the list from the same snapshot.** Either derive the count from the returned list, or read both in one transaction or from one pinned replica. A denormalised count read independently of the data it counts will *always* be able to disagree with it — that is not a bug to fix once, it is a property of the design.

And if the count must be denormalised for performance, it needs to be idempotent (computed from a set rather than incremented), reconciled on a schedule, and read from the same place as the list.

**Transferable:** two values that must agree should be read from one snapshot. Any time a derived value and its source are fetched independently, users will eventually see them disagree, and the report will be unreproducible because it depends on which replica served each half. **The design question is not "how do I keep them in sync" but "why are these two reads?"** — and the answer is usually that they need not be.`,
    },
  ],

  revision: {
    bullets: [
      'CAP: during a partition, choose consistency (refuse) or availability (serve possibly-stale). That is all it says.',
      'Partition tolerance is not a choice. "Pick two" is wrong, and there is no CA distributed system.',
      'PACELC adds the else clause: with no partition, choose latency or consistency. That is paid on every operation.',
      'PC/EL is the quadrant nobody names — most single-primary relational deployments with async replicas.',
      'CAP\'s consistency is linearizability. ACID\'s is invariants holding. Same word, different properties.',
      'CAP\'s availability is a formal property, not an SLO. Most downtime comes from deploys and capacity, not partitions.',
      'The choice is per operation, not per database. A payment and a view counter want opposite answers.',
      'Eventual consistency promises convergence if writes stop. No time bound, nothing about client observations.',
      'The three anomalies: read-your-writes violated, monotonic reads violated, causality violated.',
      'Session guarantees fix all three per client, far more cheaply than linearizability.',
      'Choosing availability relocates the consistency problem into the application, as Dynamo\'s cart merge shows.',
      'Spanner proves global strong consistency is possible; the bill is commit wait, clock infrastructure and round trips.',
      'S3 moved from eventual to strong read-after-write consistency, so the trade is revisitable engineering.',
      'What is genuinely fixed: coordination requires communication, and communication takes time.',
      'A "strongly consistent" store says nothing about the caches, replicas and indexes in front of it.',
      'Per-key linearizability protects nothing across keys; cross-entity invariants still need a transaction.',
      'Coordination amplifies tail latency: with 5% slow messages, a three-node quorum is slow ~14% of the time.',
      'Two values that must agree should be read from one snapshot — a denormalised count read separately will disagree.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'CAP: during a network partition a distributed system must choose between linearizable consistency and answering every request. PACELC extends it with the trade made during normal operation — latency or consistency.',
    whyItExists:
      'Because coordination requires communication, so agreeing on a value across nodes costs time when the network works and becomes impossible when it does not.',
    whenToUse: [
      'To classify each operation: what does a stale or lost result cost, and what latency can it afford?',
      'To state a system\'s behaviour precisely — PC or PA, EC or EL, per operation.',
      'To decide where session guarantees suffice instead of linearizability.',
    ],
    whenNotToUse: [
      'For a single-node system, where there is no partition scenario.',
      'To choose a database — most stores span quadrants by configuration.',
      'As an availability SLO, which CAP\'s A is not.',
      'As a substitute for measuring replication lag at p50 and p99.',
    ],
    alternatives: [
      'Session guarantees — read-your-writes, monotonic reads, causal — for a coherent per-client view.',
      'Quorum tuning (`R + W > N`) for per-operation strength without a single primary.',
      'CRDTs, for values that must merge without coordination.',
      'Business-process reconciliation, when accepting and correcting is cheaper than preventing.',
    ],
    tradeoffs: [
      'Linearizability buys correctness and costs a coordination round trip on every operation.',
      'Eventual consistency buys latency and availability and costs application-level conflict resolution.',
      'Session guarantees buy the anomalies users notice and cost session routing plus replica utilisation.',
      'PC buys never serving wrong data and costs unavailability during a partition.',
      'PA buys staying up and costs divergence you must reconcile.',
    ],
    failureModes: [
      'Reading your own write and not seeing it, because the read hit a lagging replica.',
      'Values regressing between successive reads, from unpinned replica selection.',
      'An effect observed before its cause, from independently-replicated writes.',
      'A denormalised count disagreeing with the list it counts, read from different replicas.',
      'A read-after-write path across services depending on replication speed.',
      'Double charges or duplicate effects when a linearizable operation was assumed to be one.',
      'A uniqueness constraint enforced by read-then-write, losing to a concurrent writer.',
      'Flapping failure detectors under intermittent slowness, causing continuous re-election.',
      'Quorum tail latency far exceeding single-node tail latency.',
      'A team believing "we chose AP" and never examining their normal-operation latency cost.',
    ],
    followUpQuestions: [
      'For this specific operation, what does a stale result cost, and what latency can it afford?',
      'What is your PACELC position per operation, not per database?',
      'What is your replication lag at p50 and p99, measured?',
      'Which read paths can violate read-your-writes, and for whom?',
      'Do the count and the list come from the same snapshot?',
      'Which of your invariants span keys, and what enforces them?',
      'What happens during a partition — per operation, per region?',
      'Which inconsistencies would you rather reconcile as a business process than prevent?',
    ],
  },
});
