import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-consensus',
  title: 'Consensus, leader election, quorums',
  summary:
    'Quorum arithmetic (`R + W > N`) is the cheap tool and consensus is the expensive one — and the whole skill is keeping consensus off the hot path by using it to decide *who decides*, not to decide every write.',
  phase: 'distributed',
  module: 'data-at-scale',
  position: 28,
  kind: 'concept',
  difficulty: 'advanced',
  estimatedMinutes: 50,
  tags: ['consensus', 'quorums', 'leader-election', 'raft', 'fencing'],
  prerequisites: ['d-consistency-models'],
  resources: [
    {
      key: 'raft-paper',
      tier: 'must',
      note: 'Read the sections on leader election, log replication and safety. Raft was designed to be understandable, and reading it directly is faster than reading explanations of it.',
    },
    {
      key: 'sre-book-distributed-consensus',
      tier: 'must',
      note: 'The operational view: what consensus systems cost to run, how many nodes to deploy, and why the number of replicas is a latency decision as much as a durability one.',
    },
    {
      key: 'kleppmann-redlock',
      tier: 'must',
      note: 'The clearest treatment anywhere of why a lock without fencing is unsafe, regardless of the lock service. Read it for the fencing-token argument, which generalises far beyond the specific system being critiqued.',
    },
    {
      key: 'chubby-paper',
      tier: 'good',
      note: 'Read the sections on the lock service interface and on how clients actually used it. Its central lesson is that most users wanted a name service and a coarse lock, not fine-grained locking.',
    },
    {
      key: 'zookeeper-paper',
      tier: 'good',
      note: 'A coordination primitive built on consensus, with the ordering guarantees stated precisely. Useful for seeing what a consensus system offers as an API rather than as an algorithm.',
    },
    {
      key: 'raft-site',
      tier: 'advanced',
      note: 'Visualisations and the extended treatment, including membership changes. Read the membership-change material — it is the part most implementations get wrong.',
    },
  ],

  intuition: {
    body: `Consensus answers one question: **how do several machines agree on a value when any of them may fail and the network may delay or drop messages?**

It is the foundation under leader election, distributed locks, configuration that must not be ambiguous, and linearizable writes. And it is expensive enough that the central skill in using it is **using it as little as possible.**

Start with the cheap tool, because it covers more than people expect.

**Quorums.** With N replicas, require W of them to acknowledge a write and R of them to answer a read. If **\`R + W > N\`**, the read set and the write set must overlap in at least one replica, so a read is guaranteed to see the latest acknowledged write.

The arithmetic is the whole idea, and the tuning is where the value is:

- \`N=3, W=3, R=1\`: writes are slow and fragile, reads are fast. Good for read-heavy data.
- \`N=3, W=1, R=3\`: writes are fast, reads are slow. Good for write-heavy data.
- \`N=3, W=2, R=2\`: balanced, and it tolerates one node failure for both reads and writes. **The usual default.**
- \`N=3, W=1, R=1\`: \`R + W = 2 ≤ 3\`, so no overlap. Fast, available, eventually consistent.

What a quorum gives you is **freshness for a single value**. What it does not give you is agreement on an *order of operations*, which is what you need for a leader, a lock, or a sequence.

**Consensus.** Stronger and more expensive: a set of nodes agrees on an ordered *log* of values, such that everyone who reads the log sees the same sequence. Raft and Paxos do this by electing a leader who sequences proposals and replicating each entry to a majority before committing it.

The cost, concretely: **every committed decision requires a round trip to a majority.** In one datacentre that is a millisecond or two. Across regions it is tens or hundreds of milliseconds. And a leader failure costs an election, during which nothing commits — typically hundreds of milliseconds to a few seconds.

So the design pattern that matters:

> **Use consensus to decide who decides, then let that node decide at local speed.**

Elect a leader by consensus — a rare operation — and then let the leader sequence writes without a consensus round per write, or with a cheaper replication scheme. This is what every practical system does, and recognising it is more useful than being able to recite Raft.

The framing to carry: **quorums for value freshness, consensus for ordering, and consensus applied to membership rather than to traffic.**`,
    analogyLimit:
      '"Consensus is voting" is the analogy to distrust. Voting assumes participants who all respond; consensus\'s difficulty is that a node may be dead, slow, or partitioned and you cannot tell which — which is why a majority is required rather than everyone. It also hides that consensus agrees on a *sequence* of decisions, and that an elected leader may not know it has been replaced, which is the source of every split-brain bug.',
  },

  deepExplanation: {
    predict: {
      question:
        'A job scheduler uses a distributed lock so only one worker processes a queue. Worker A acquires the lock with a 30-second TTL, then suffers a 45-second garbage-collection pause. Meanwhile the lock expires and worker B acquires it and starts processing. Worker A resumes, believes it still holds the lock, and writes. Two workers processed the same jobs. Whose fault is this, and what fixes it?',
      answer: `**Nobody's fault, in the sense that matters: this is unavoidable with a lock alone, no matter how good the lock service is.**

That is the important claim, so work through why. The lock service did everything correctly — it granted the lock, the TTL expired, it granted the lock to B. A did nothing wrong either: it acquired the lock, was paused by circumstances outside its control, and resumed. There is no bug in either component.

The flaw is structural. **A lock tells a client "you hold the lock" at the moment of acquisition. It cannot tell the client "you no longer hold it" at the moment of expiry**, because the client is not running. And when A resumes, it has no way to know that 45 seconds passed rather than 45 milliseconds — a paused process has no reliable sense of elapsed time, and checking the clock after the fact does not help because the check-then-write is itself not atomic.

Making the TTL longer does not fix it; it makes the window rarer and longer-lasting when it occurs. Making the client check the lock before writing does not fix it either — the pause can land between the check and the write.

**What actually fixes it: fencing tokens.**

The lock service returns a **monotonically increasing token** with each grant. A gets token 33; the lock expires; B gets token 34.

Now the critical requirement: **the resource being protected must reject any write with a token lower than the highest it has seen.**

- A resumes and writes with token 33.
- The storage system has already seen token 34 from B.
- **The write is rejected.**

A discovers it lost the lock at the moment it tries to use it, which is the only moment when discovery is useful.

**Why this is the general answer, and worth internalising.** The protection moves from the *lock service* to the *resource*. A lock is advisory — it is a request that others stay away. A fencing token is enforced at the point of effect. **Any mutual-exclusion scheme without enforcement at the resource is advisory, and advisory locks are broken by pauses, network delays and clock skew.**

Note what this requires: the resource must support conditional writes on a monotonic token. A database can do this with a version column. An object store can do it with a conditional-put precondition. A filesystem or an external API that offers no such mechanism **cannot be safely fenced**, and for those the honest answer is not a better lock — it is idempotency.

**The alternative when fencing is impossible: make the operation idempotent.** If processing a job twice has the same effect as processing it once, the whole problem dissolves. Two workers doing the same idempotent work is wasteful, not incorrect. **This is usually the cheaper and more robust answer**, and reaching for it before reaching for a lock is a sign of experience.

**The general lesson.** "Use a distributed lock" is an incomplete design. The complete version is: a lock plus fencing tokens enforced at the resource, or idempotent operations that make exclusion unnecessary. A lock on its own buys you a smaller window, not correctness — and a smaller window means the bug is rarer, harder to reproduce, and still there.`,
    },
  body: `## Quorums: the arithmetic and its limits

With N replicas, W acknowledgements for a write and R for a read:

**\`R + W > N\` guarantees overlap**, so a read touches at least one replica holding the latest acknowledged write.

Choosing the values:

| N | W | R | Tolerates | Good for |
| --- | --- | --- | --- | --- |
| 3 | 2 | 2 | 1 node down | The default; balanced |
| 3 | 3 | 1 | 0 nodes down for writes | Read-heavy, write-rare |
| 3 | 1 | 3 | 0 nodes down for reads | Write-heavy, read-rare |
| 5 | 3 | 3 | 2 nodes down | Higher durability, more latency |
| 3 | 1 | 1 | 2 nodes down | Fast, eventually consistent |

Three things the arithmetic does not tell you:

**Latency is the *slowest* member of the quorum.** \`W=2\` of 3 means waiting for the second-fastest, so your write latency is a p50 of the second-order statistic — which has a much worse tail than any single node. Coordination amplifies tail latency, which is why hedging and adaptive replica selection matter in practice.

**Overlap guarantees freshness, not ordering.** A quorum read sees the latest acknowledged write to *that key*. It says nothing about the order of operations across keys, and nothing about two concurrent writes to the same key — which is why quorum systems still need conflict resolution.

**Sloppy quorums break the arithmetic deliberately.** If W acknowledgements may come from *any* W reachable nodes rather than the W designated replicas — Dynamo's hinted handoff — then availability improves and \`R + W > N\` no longer guarantees overlap. Worth knowing, because a system can advertise quorum consistency and use sloppy quorums under failure.

## Consensus: what it actually provides

Consensus gives an **ordered, replicated log** on which all correct nodes agree. Three properties:

**Agreement.** No two nodes commit different values at the same log position.
**Validity.** A committed value was proposed by some node.
**Termination.** The protocol eventually decides, provided a majority is up and can communicate.

That last clause is the fundamental limitation: **consensus requires a majority.** With 3 nodes you tolerate 1 failure; with 5, two. Lose a majority and the system stops — it does not serve wrong answers, it stops. That is a deliberate choice of consistency over availability.

**Raft in the amount you need.**

*Leader election.* Nodes are followers. A follower that hears nothing from a leader for its election timeout becomes a candidate, increments the **term**, and requests votes. A candidate winning a majority becomes leader. Randomised election timeouts prevent repeated split votes.

*Log replication.* Clients send writes to the leader. The leader appends to its log and sends the entry to followers. Once a majority has it, the entry is **committed** and applied.

*Safety.* A candidate can only win if its log is at least as up to date as the majority that votes for it, which guarantees a new leader has every committed entry.

**Terms are the mechanism that makes stale leaders safe.** Every message carries a term. A node receiving a message from an older term rejects it; a node receiving a message from a newer term steps down. So a partitioned old leader that returns cannot commit anything — its term is stale and followers reject it.

**This is the same idea as a fencing token**, one level down. Recognising that terms and fencing tokens are the same mechanism is one of the more useful connections in distributed systems.

## The pattern: consensus for membership, not for traffic

Every practical system uses consensus sparingly. The shape:

1. **Consensus elects a leader** — rare, and expensive when it happens.
2. **The leader sequences operations** at local speed, with no consensus round per operation.
3. **Replication to followers** uses a cheaper scheme — a log stream, a quorum ack.
4. **Consensus is consulted again** only when membership changes.

Concretely: a single-primary database with a consensus-based failover controller. Writes go to the primary at local speed. The controller uses consensus to decide *who is primary*, and that decision is made a handful of times a year.

**Why this matters for design.** "We need strong consistency, so we need consensus on every write" produces a system with a majority round trip per write. In one region that is a millisecond or two — often acceptable. Across regions it is tens to hundreds of milliseconds — usually not. The way out is almost always to elect a regional leader by consensus and write to it locally, accepting that a regional failover costs an election.

## Node counts, and why odd numbers

Majority of N: 2 of 3, 3 of 5, 4 of 7.

**Odd numbers, always.** A 4-node cluster needs 3 for a majority, so it tolerates one failure — exactly the same as 3 nodes, at higher cost and worse latency. 4 is strictly worse than 3.

**More nodes is more durability and worse latency.** 5 nodes tolerate two failures and require 3 acknowledgements, so every commit waits for the third-fastest of five. Beyond 5 the latency cost usually dominates, and 7 is rare outside systems that genuinely need to survive two simultaneous failures plus maintenance.

**Two-node clusters cannot do consensus.** A majority of 2 is 2, so either node failing stops the system. This is worse than one node, and it is a configuration people reach by adding a second node "for redundancy".

**Learners and non-voting members** let you have extra copies for reads or geography without enlarging the voting set — so latency stays at a 3-node majority while durability and read locality improve. This is the right tool when someone asks for a copy in another region.

## Distributed locks, and why they are usually wrong

A lock built on consensus is correct about *granting*, and grants are not the hard part.

**The three problems.**

**A lock plus a TTL is not mutual exclusion.** Any pause longer than the TTL — GC, page fault, a suspended VM, an overloaded host — means two holders. This is unavoidable without fencing.

**Fencing tokens are mandatory, and they require support at the resource.** A monotonic token per grant, and the resource must reject lower tokens. If the protected resource cannot do conditional writes on a version, it cannot be fenced.

**Clocks are not trustworthy.** A TTL relies on time, and time can jump, drift, or be stepped by an administrator. Any lock argument resting on clock accuracy is fragile.

**The alternatives, in order of preference:**

**Idempotency.** If doing the work twice is harmless, exclusion is unnecessary. This dissolves the problem instead of managing it, and it is right far more often than people expect.

**Partition the work.** If each worker owns a disjoint set of keys — by consistent hashing or an assigned range — no two workers ever touch the same item and no lock is needed. Ownership replaces exclusion.

**A conditional update on the resource.** \`UPDATE ... WHERE version = ?\` gives mutual exclusion enforced where the effect happens, with no separate lock service at all.

**A lock plus fencing**, when you genuinely need exclusion over something that cannot be made idempotent or partitioned.

The honest ordering: **most distributed-lock requirements are idempotency requirements or partitioning requirements in disguise.**

## Two-phase commit, and how it differs

2PC is not consensus, and the distinction is worth being precise about.

A coordinator asks every participant to prepare; if all vote yes it tells everyone to commit. It gives atomic commit across participants — either all commit or none.

**Its weakness: the coordinator is a single point of failure at exactly the wrong moment.** If the coordinator dies after participants have voted yes but before delivering the decision, participants are **blocked** — they have promised to commit and may not unilaterally abort, and they do not know the decision. They hold locks until the coordinator returns.

Consensus does not have this property: a leader failure triggers an election and the log continues.

The practical consequence: 2PC across services is avoided in favour of **sagas** — a sequence of local transactions with compensating actions — precisely because a blocked participant holding locks is worse than a compensation you have to write. 2PC remains reasonable *within* a system where the coordinator is itself consensus-replicated, which is what distributed databases do internally.

## Where consensus is the wrong tool

**On the hot path.** A majority round trip per operation is affordable within a region and rarely across regions. Use it for who-decides, not for what-happens.

**For high-volume data.** A consensus log is not a database. Systems built on it hold configuration, membership and locks — kilobytes to megabytes — not application data at scale.

**When a majority is unavailable.** Consensus stops rather than serving wrong answers. If your requirement is to keep serving during a partition, consensus is the wrong tool by construction.

**For mutual exclusion without fencing.** Covered above: a correct lock service plus an unfenced resource is still broken.

**When idempotency would do.** The most common misapplication.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'quorum-arithmetic',
      title: 'R + W > N, and what each tuning buys',
      caption:
        'The arithmetic is trivial; the tuning is the design. Note the bottom row — R + W = N means no overlap, which is the eventual-consistency configuration many systems run by default.',
      code: `flowchart LR
    N["N = 3 replicas"] --> A["W=2, R=2<br/>R+W=4 > 3 ✓"] --> A2["Balanced.<br/>Survives 1 failure<br/>for reads AND writes.<br/>**The default**"]
    N --> B["W=3, R=1<br/>R+W=4 > 3 ✓"] --> B2["Fast reads,<br/>fragile writes:<br/>any node down<br/>blocks writes"]
    N --> C["W=1, R=3<br/>R+W=4 > 3 ✓"] --> C2["Fast writes,<br/>fragile reads:<br/>any node down<br/>blocks reads"]
    N --> D["W=1, R=1<br/>R+W=2 ≤ 3 ✗"] --> D2["No overlap.<br/>Fast, available,<br/>**eventually consistent**"]

    A2 --> L["Latency is the SLOWEST<br/>quorum member —<br/>coordination amplifies<br/>the tail"]
    A2 --> O["Overlap gives freshness<br/>per key, NOT ordering<br/>across operations"]

    style A2 fill:#17272a,stroke:#35897e
    style D2 fill:#1c1814,stroke:#c99a4e
    style L fill:#2a1a1a,stroke:#a04848
    style O fill:#2a1a1a,stroke:#a04848`,
    },
    {
      kind: 'flow',
      id: 'fencing',
      title: 'Why a lock needs a fencing token',
      caption:
        'Step through it. Nothing in this sequence is a bug in the lock service — which is exactly the point. The protection has to live at the resource, not at the lock.',
      nodes: [
        { id: 'lock', label: 'Lock service', kind: 'service', x: 0, y: 180, detail: 'Consensus-backed and behaving correctly throughout. It grants the lock, the TTL expires, it grants the lock again. No bug here.' },
        { id: 'a1', label: 'Worker A acquires', kind: 'client', x: 210, y: 60, detail: 'Gets the lock with a 30-second TTL and fencing token 33. Begins work.' },
        { id: 'pause', label: 'A pauses 45 s', kind: 'note', x: 210, y: 160, detail: 'Garbage collection, a page fault, a suspended VM. A is not running and cannot be told the lock expired — and on resuming it has no reliable sense of how long it was gone.' },
        { id: 'b1', label: 'Worker B acquires', kind: 'client', x: 210, y: 280, detail: 'The TTL expired, so the lock is free. B gets it, with token 34. Two workers now believe they hold the lock.' },
        { id: 'res', label: 'Resource', kind: 'store', x: 470, y: 180, detail: 'The point of effect. It tracks the highest fencing token it has seen and rejects anything lower. This is where mutual exclusion is actually enforced.' },
        { id: 'w34', label: 'B writes, token 34', kind: 'note', x: 470, y: 290, detail: 'Accepted. The resource records 34 as the highest token seen.' },
        { id: 'w33', label: 'A writes, token 33', kind: 'note', x: 470, y: 70, detail: 'Rejected — 33 < 34. A learns it lost the lock at the only moment when learning is useful: when it tries to have an effect.' },
        { id: 'alt', label: 'Or: make it idempotent', kind: 'service', x: 700, y: 180, detail: 'If doing the work twice has the same effect as once, exclusion is unnecessary. Usually cheaper and more robust than fencing — and it works with resources that cannot be fenced at all.' },
      ],
      edges: [
        { id: 'f1', source: 'lock', target: 'a1', kind: 'control' },
        { id: 'f2', source: 'a1', target: 'pause', kind: 'async' },
        { id: 'f3', source: 'lock', target: 'b1', kind: 'control' },
        { id: 'f4', source: 'b1', target: 'w34', kind: 'write' },
        { id: 'f5', source: 'w34', target: 'res', kind: 'write' },
        { id: 'f6', source: 'pause', target: 'w33', kind: 'write' },
        { id: 'f7', source: 'w33', target: 'res', kind: 'write' },
        { id: 'f8', source: 'res', target: 'alt', kind: 'async' },
      ],
      steps: [
        {
          id: 'z1',
          title: 'A holds the lock, then stops running',
          description:
            'A 45-second pause against a 30-second TTL. A cannot be notified of expiry because it is not executing, and a longer TTL only makes the window rarer and longer when it occurs.',
          nodes: ['lock', 'a1', 'pause'],
          edges: ['f1', 'f2'],
        },
        {
          id: 'z2',
          title: 'B legitimately acquires the same lock',
          description:
            'The lock service is correct: the TTL expired, so the lock was free. Two workers now believe they hold it, and neither has done anything wrong.',
          nodes: ['b1'],
          edges: ['f3'],
        },
        {
          id: 'z3',
          title: 'B writes with the higher token',
          description:
            'The resource records 34 as the highest token it has seen. This is the state that makes A\'s later write detectably stale.',
          nodes: ['w34', 'res'],
          edges: ['f4', 'f5'],
        },
        {
          id: 'z4',
          title: 'A resumes and is rejected at the resource',
          description:
            'Token 33 is lower than 34, so the write fails. Enforcement lives at the point of effect — which is why a correct lock service plus an unfenced resource is still broken.',
          nodes: ['w33'],
          edges: ['f6', 'f7'],
        },
        {
          id: 'z5',
          title: 'And the cheaper answer is often no lock at all',
          description:
            'If the work is idempotent, two workers doing it is wasteful rather than wrong. That also covers resources that offer no conditional write to fence with.',
          nodes: ['alt'],
          edges: ['f8'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['google'],
    body: `Chubby is the most instructive consensus system to study, because Google published what its users actually did with it — and that turned out to be different from what it was built for.

**What it is.** A consensus-replicated lock service, typically five replicas, exposing a small filesystem-like namespace with files that can hold data and be locked. Built on Paxos.

**What it was intended for:** coarse-grained locking, particularly electing a primary among a set of replicas.

**What people actually used it for, in order of volume: a name service.** Clients stored small configuration values in it and read them constantly. The insight the paper draws out is that a highly-available, strongly-consistent store for *small amounts of critical data* is more broadly useful than a lock service — because the hard problem most systems have is not "who holds the lock" but "what is the current authoritative answer".

Three transferable lessons.

**1. Consensus is for metadata, and the volume difference is enormous.** Chubby holds configuration, membership and lock state — kilobytes. Application data lives elsewhere. The paper is explicit that Chubby is not a database, and this is the design rule: **consensus decides who decides and what the configuration is; it does not carry traffic.**

**2. Coarse locks, held for hours, not fine locks held for milliseconds.** Fine-grained locking would put consensus on the hot path and generate load proportional to application traffic. Coarse locks — "I am the primary for this shard" — are acquired rarely and held long, so consensus load is independent of application load. That decoupling is the whole reason the design scales.

**3. Client caching, with invalidation, is what made the read volume affordable.** Clients cache values and hold a lease; the master invalidates caches before allowing a modification. So reads are served locally at zero consensus cost, and the strong consistency is preserved by the master blocking on invalidation before it commits a change. **A consensus system that answered every read from the consensus log would be a bottleneck**, and this is how that is avoided.

**And a fourth, from the operational sections: the failure mode was clients, not the service.** Applications assumed Chubby was always available and had no fallback for a Chubby outage, so a brief unavailability of the coordination service cascaded into widespread application failure. Google's response included deliberately limiting availability so developers would not build on an assumption of perfection.

**The transferable question:** what does your system do when the coordination service is unavailable for 30 seconds? If the honest answer is "everything stops", you have built a hard dependency on a component whose whole purpose is to stop rather than be wrong.`,
  },

  tradeoffs: {
    intro:
      'The decision is which coordination primitive to use, and the ordering below is roughly cheapest to most expensive. Prefer the top of the list.',
    rows: [
      {
        option: 'Idempotency instead of coordination',
        whenItWins:
          'Whenever repeating the work is harmless. It dissolves the problem — duplicate work becomes wasteful rather than incorrect — and needs no coordination service at all.',
        whenItLoses:
          'When the effect is inherently non-repeatable: sending a message, charging a card without a key, dispatching a vehicle.',
        cost:
          'Designing operations to be repeatable, usually via an idempotency key and a deduplication record.',
      },
      {
        option: 'Partitioned ownership',
        whenItWins:
          'When work can be divided so each worker owns disjoint keys. No two workers touch the same item, so exclusion is structural rather than enforced.',
        whenItLoses:
          'When work cannot be partitioned, or when ownership reassignment during a failure needs coordination anyway.',
        cost:
          'A partitioning scheme, and a mechanism to reassign ownership on failure — which usually needs consensus, but rarely.',
      },
      {
        option: 'Conditional update on the resource',
        whenItWins:
          'Single-resource mutual exclusion. `UPDATE ... WHERE version = ?` enforces exclusion where the effect happens, with no lock service.',
        whenItLoses:
          'When exclusion must span several resources, or the resource offers no conditional write.',
        cost:
          'Retry logic on conflict, and a version column to maintain.',
      },
      {
        option: 'Quorum reads and writes (`R + W > N`)',
        whenItWins:
          'Per-key freshness without a leader. Tunable per operation: `W=N, R=1` for read-heavy, `W=1, R=N` for write-heavy, `W=R=2` of 3 as the default.',
        whenItLoses:
          'When you need ordering across operations, or when the tail latency of the slowest quorum member is unaffordable.',
        cost:
          'Latency of the slowest quorum member, unavailability when a quorum cannot form, and conflict resolution for concurrent writes.',
      },
      {
        option: 'Consensus for leader election, then local writes',
        whenItWins:
          'Almost every strong-consistency requirement. Consensus runs rarely — on failover — and writes proceed at local speed under the elected leader.',
        whenItLoses:
          'When a leader failover\'s unavailability window is unacceptable, or when there is no natural single writer.',
        cost:
          'An election on failover, during which writes stop; plus a consensus cluster to operate.',
      },
      {
        option: 'Consensus on every write',
        whenItWins:
          'When every write must be linearizable and ordered, and a majority round trip is affordable — same-region, moderate volume.',
        whenItLoses:
          'Cross-region, or at volume. A majority round trip per write is milliseconds locally and tens to hundreds of milliseconds across regions.',
        cost:
          'A majority round trip per operation, and a hard stop when a majority is unavailable.',
      },
      {
        option: 'Distributed lock with fencing tokens',
        whenItWins:
          'Genuine exclusion over something that cannot be made idempotent or partitioned — and only when the resource can reject stale tokens.',
        whenItLoses:
          'When the protected resource offers no conditional write on a monotonic token. Then it cannot be fenced and the lock is advisory.',
        cost:
          'Token plumbing through every write path, and resource-side enforcement.',
      },
      {
        option: 'Two-phase commit',
        whenItWins:
          'Atomic commit across partitions inside one system, where the coordinator is itself consensus-replicated.',
        whenItLoses:
          'Across services. A coordinator failure after the prepare phase blocks participants holding locks, with no way to decide unilaterally.',
        cost:
          'Blocking on coordinator failure, held locks, and latency proportional to the slowest participant.',
      },
      {
        option: 'Sagas with compensation',
        whenItWins:
          'Multi-service workflows where blocking is unacceptable. Local transactions plus compensating actions.',
        whenItLoses:
          'When intermediate states are observable and unacceptable, or when compensation is impossible.',
        cost:
          'A compensating action per step, and visible intermediate states.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We use a distributed lock so only one worker processes each job."',
      whyWeak:
        'A lock plus a TTL is not mutual exclusion. Any pause longer than the TTL — garbage collection, a page fault, a suspended VM — means two holders, and the paused process cannot be told it lost the lock. Making the TTL longer only makes the window rarer.',
      strongAnswer:
        '"A lock alone gives a smaller window, not correctness. I would first ask whether the work can be made idempotent, in which case two workers is wasteful rather than wrong, or partitioned so each worker owns disjoint keys. If genuine exclusion is needed, the lock must issue monotonic fencing tokens and the *resource* must reject lower ones — enforcement has to be at the point of effect, not at the lock service."',
    },
    {
      weakAnswer: '"We need strong consistency, so every write goes through Raft."',
      whyWeak:
        'That puts a majority round trip on every write. Within a region it is a millisecond or two and often fine; across regions it is tens to hundreds of milliseconds, which is usually unacceptable. And a consensus log is not a database — it is for kilobytes of metadata, not application data at volume.',
      strongAnswer:
        '"I would use consensus to decide *who decides*: elect a leader, then let it sequence writes at local speed with cheaper replication to followers. Consensus then runs on failover — a handful of times a year — rather than per write. That is what every practical system does, including consensus-backed databases: the log carries membership and configuration, not traffic."',
    },
    {
      weakAnswer: '"We run four nodes so we can tolerate a failure."',
      whyWeak:
        'A majority of 4 is 3, so it tolerates exactly one failure — the same as 3 nodes, at higher cost and worse commit latency, because every commit waits for the third-fastest of four. Even node counts are strictly worse than the odd number below them.',
      strongAnswer:
        '"Always odd. Three tolerates one failure, five tolerates two. Four tolerates one, like three, while making every commit wait for one more acknowledgement. If I wanted extra copies for read locality or geography I would add non-voting learners, which keeps the voting majority at three so latency does not degrade."',
    },
    {
      weakAnswer: '"Two-phase commit gives us distributed transactions across our services."',
      whyWeak:
        'It gives atomicity and a blocking failure mode. If the coordinator dies after participants vote yes, they cannot unilaterally decide and must hold their locks until it returns. Across service boundaries, with independent deploy cycles, that is a serious operational hazard.',
      strongAnswer:
        '"2PC blocks participants if the coordinator fails after the prepare phase — they have promised to commit, cannot abort, and hold locks until it returns. That is why cross-service workflows use sagas: local transactions with compensating actions, so nothing blocks. 2PC is reasonable *within* a system where the coordinator is itself consensus-replicated, which is what distributed databases do internally."',
    },
    {
      weakAnswer: '"With R + W > N we get strong consistency."',
      whyWeak:
        'It gives per-key freshness — a read sees the latest acknowledged write to that key. It gives no ordering across operations, no protection for cross-key invariants, and nothing about concurrent writes to the same key, which still need conflict resolution.',
      strongAnswer:
        '"`R + W > N` guarantees the read and write sets overlap, so a read sees the latest acknowledged write *to that key*. It does not give ordering across operations, so it is not linearizability for anything multi-key, and concurrent writes to one key still produce conflicting versions to resolve. I would also note that the write latency is the slowest quorum member\'s, which has a much worse tail than a single node."',
    },
    {
      weakAnswer: '"Our coordination service is consensus-backed, so it is highly available."',
      whyWeak:
        'Consensus requires a majority and *stops* rather than serving wrong answers. That is a deliberate choice of consistency over availability, so a consensus service is precisely the thing that will be unavailable rather than incorrect — and applications that assume it is always up cascade when it is not.',
      strongAnswer:
        '"Consensus stops when it loses a majority; that is the guarantee, not a defect. So the question is what my system does when coordination is unavailable for 30 seconds. Chubby\'s published experience was that client applications had no fallback and cascaded — the response included deliberately limiting availability so nobody built on an assumption of perfection. I would want each dependent path to degrade explicitly."',
    },
  ],

  flashcards: [
    {
      id: 'fc-cons-1',
      front: 'What does `R + W > N` guarantee, and what does it not?',
      back: 'The read and write sets overlap, so a read sees the latest acknowledged write to that key. It gives no ordering across operations and no cross-key guarantees.',
      topic: 'quorums',
    },
    {
      id: 'fc-cons-2',
      front: 'What is the usual quorum default and why?',
      back: '`N=3, W=2, R=2`. It satisfies `R + W > N` and tolerates one node failure for both reads and writes — the only 3-node tuning that does.',
      topic: 'quorums',
    },
    {
      id: 'fc-cons-3',
      front: 'What is a quorum write\'s latency?',
      back: 'The slowest member of the quorum. `W=2` of 3 waits for the second-fastest, so the tail is much worse than any single node — coordination amplifies tail latency.',
      topic: 'quorums',
    },
    {
      id: 'fc-cons-4',
      front: 'What does consensus provide that a quorum does not?',
      back: 'An ordered replicated log that all correct nodes agree on. Quorums give per-key freshness; consensus gives agreement on a sequence.',
      topic: 'consensus',
    },
    {
      id: 'fc-cons-5',
      front: 'What is consensus\'s fundamental limitation?',
      back: 'It requires a majority. With 3 nodes it tolerates 1 failure; lose a majority and it stops rather than serving wrong answers.',
      topic: 'consensus',
    },
    {
      id: 'fc-cons-6',
      front: 'Why must consensus node counts be odd?',
      back: 'A majority of 4 is 3, so 4 nodes tolerate one failure just like 3 — at higher cost and worse commit latency. Even counts are strictly worse.',
      topic: 'consensus',
    },
    {
      id: 'fc-cons-7',
      front: 'What are Raft terms for?',
      back: 'Every message carries a term; older terms are rejected and newer terms cause a step-down. This makes a returning partitioned leader unable to commit — the same mechanism as a fencing token.',
      topic: 'raft',
    },
    {
      id: 'fc-cons-8',
      front: 'The central pattern for using consensus affordably?',
      back: 'Use it to decide *who decides*. Elect a leader by consensus — rare — then let the leader sequence operations at local speed without a consensus round per write.',
      topic: 'leader-election',
    },
    {
      id: 'fc-cons-9',
      front: 'Why is a lock with a TTL not mutual exclusion?',
      back: 'A pause longer than the TTL means two holders, and the paused process cannot be told it lost the lock. A longer TTL makes the window rarer, not absent.',
      topic: 'fencing',
    },
    {
      id: 'fc-cons-10',
      front: 'What is a fencing token and where is it enforced?',
      back: 'A monotonic number issued with each lock grant. The *resource* rejects any write with a lower token than the highest it has seen. Enforcement is at the point of effect, not at the lock.',
      topic: 'fencing',
    },
    {
      id: 'fc-cons-11',
      front: 'When can a resource not be fenced?',
      back: 'When it offers no conditional write on a monotonic token — a filesystem, an external API. Then the honest answer is idempotency, not a better lock.',
      topic: 'fencing',
    },
    {
      id: 'fc-cons-12',
      front: 'What are most distributed-lock requirements actually?',
      back: 'Idempotency or partitioning requirements in disguise. If repeating the work is harmless, or each worker owns disjoint keys, no lock is needed.',
      topic: 'fencing',
    },
    {
      id: 'fc-cons-13',
      front: 'How does 2PC differ from consensus?',
      back: 'A coordinator failure after the prepare phase blocks participants: they have promised to commit, cannot abort, and hold locks. Consensus elects a new leader and continues.',
      topic: 'consensus',
    },
    {
      id: 'fc-cons-14',
      front: 'What is a learner or non-voting member for?',
      back: 'Extra copies for read locality or geography without enlarging the voting set, so commit latency stays at a 3-node majority.',
      topic: 'leader-election',
    },
  ],

  quiz: [
    {
      id: 'q-cons-1',
      kind: 'scenario',
      prompt:
        'A worker acquires a lock with a 30-second TTL, pauses for 45 seconds in garbage collection, and resumes believing it still holds the lock. Another worker has since acquired it. What fixes this?',
      options: [
        { id: 'a', label: 'Fencing tokens: the lock issues a monotonic number and the resource rejects writes carrying a lower one than it has seen' },
        { id: 'b', label: 'A longer TTL, so the pause cannot exceed it' },
        { id: 'c', label: 'The worker re-checking the lock immediately before writing' },
        { id: 'd', label: 'A consensus-backed lock service instead of the current one' },
      ],
      correct: ['a'],
      explanation:
        'A longer TTL makes the window rarer and longer-lasting when it occurs. Re-checking does not help because the pause can land between the check and the write. A better lock service does not help either — the lock service behaved correctly throughout. Only enforcement at the resource, via a monotonic token, is safe.',
      difficulty: 'advanced',
      topic: 'fencing',
    },
    {
      id: 'q-cons-2',
      kind: 'single',
      prompt: 'With N=3, which tuning tolerates one node failure for both reads and writes?',
      options: [
        { id: 'a', label: 'W=2, R=2' },
        { id: 'b', label: 'W=3, R=1' },
        { id: 'c', label: 'W=1, R=3' },
        { id: 'd', label: 'W=1, R=1' },
      ],
      correct: ['a'],
      explanation:
        'W=2, R=2 satisfies R+W > N and needs only two of three nodes for either operation. W=3 blocks writes if any node is down; R=3 blocks reads if any node is down. W=1, R=1 tolerates two failures and violates the overlap condition, so it is eventually consistent.',
      difficulty: 'core',
      topic: 'quorums',
    },
    {
      id: 'q-cons-3',
      kind: 'scenario',
      prompt:
        'A team needs linearizable writes across three regions. Their proposal: run Raft with one node per region and commit every write through it. What is the problem and the alternative?',
      options: [
        { id: 'a', label: 'Every write needs a majority acknowledgement, so each pays a cross-region round trip; instead elect a regional leader by consensus and write to it locally' },
        { id: 'b', label: 'Raft cannot span regions' },
        { id: 'c', label: 'Three nodes is too few for cross-region deployment' },
        { id: 'd', label: 'Nothing — this is the standard design' },
      ],
      correct: ['a'],
      explanation:
        'With one node per region, a majority means at least one remote acknowledgement, so every write costs tens to hundreds of milliseconds. Raft works fine across regions; the cost is the problem. The standard remedy is consensus for leadership and local writes under the elected leader, accepting that a regional failover costs an election.',
      difficulty: 'advanced',
      topic: 'consensus',
    },
    {
      id: 'q-cons-4',
      kind: 'scenario',
      prompt:
        'A 2PC coordinator dies after all participants voted to commit but before delivering the decision. What is the state of the participants?',
      options: [
        { id: 'a', label: 'Blocked — they promised to commit, cannot unilaterally abort, and hold their locks until the coordinator returns' },
        { id: 'b', label: 'They abort after a timeout, since no commit arrived' },
        { id: 'c', label: 'They commit after a timeout, since they voted yes' },
        { id: 'd', label: 'They elect a new coordinator and continue' },
      ],
      correct: ['a'],
      explanation:
        'This is 2PC\'s defining weakness. A participant that voted yes must honour that vote and cannot know whether others voted yes, so it can neither commit nor abort — it blocks holding locks. Consensus does not have this property, which is why 2PC across services is avoided in favour of sagas.',
      difficulty: 'advanced',
      topic: 'consensus',
    },
    {
      id: 'q-cons-5',
      kind: 'scenario',
      prompt:
        'A team wants exactly one worker to process each job in a queue. Which approach should they consider first?',
      options: [
        { id: 'a', label: 'Make job processing idempotent, so two workers doing the same job is wasteful rather than incorrect' },
        { id: 'b', label: 'A consensus-backed distributed lock per job' },
        { id: 'c', label: 'A single worker, to avoid the problem entirely' },
        { id: 'd', label: 'Two-phase commit across the workers' },
      ],
      correct: ['a'],
      explanation:
        'Most distributed-lock requirements are idempotency or partitioning requirements in disguise. Idempotency dissolves the problem rather than managing it, and it works even where the resource cannot be fenced. A per-job lock puts coordination on the hot path and is still unsafe without fencing; a single worker removes parallelism entirely.',
      difficulty: 'core',
      topic: 'fencing',
    },
    {
      id: 'q-cons-6',
      kind: 'multi',
      prompt:
        'Which statements about consensus systems are correct? Select all that apply.',
      options: [
        { id: 'a', label: 'They stop rather than serve wrong answers when a majority is unavailable' },
        { id: 'b', label: 'They are intended for small amounts of critical metadata, not application data at volume' },
        { id: 'c', label: 'Client-side caching with invalidation is how read volume is made affordable' },
        { id: 'd', label: 'Being consensus-backed makes a service more available than a single node' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the operational reality — consensus trades availability for consistency, holds kilobytes of metadata, and relies on client caching with master-side invalidation for read scale. The fourth inverts the guarantee: consensus is precisely the component that will be unavailable rather than wrong, so dependents need explicit degradation.',
      difficulty: 'advanced',
      topic: 'consensus',
    },
  ],

  exercises: [
    {
      id: 'ex-cons-1',
      kind: 'design',
      title: 'Reach for the cheapest primitive that works',
      estimatedMinutes: 30,
      prompt: `For each requirement, choose the cheapest sufficient coordination primitive from: idempotency, partitioned ownership, conditional update, quorum, consensus-elected leader, lock with fencing, 2PC, saga. Justify, and name what breaks if you choose one level weaker.

1. A nightly billing job must not run twice, and it takes 40 minutes.
2. A username must be claimed by exactly one account.
3. One node in a cluster of 12 must be the schema-migration coordinator.
4. A webhook must be delivered to a customer endpoint at least once.
5. A seat on a flight must be sold to exactly one passenger.
6. A counter of total signups, read on a dashboard.
7. An order must result in a charge, a stock decrement, and a shipment — across three services.
8. A cluster's list of active shards must be unambiguous to every node.

Then answer:

- Which requirement is most often over-engineered, and to what?
- Your consensus cluster is unavailable for 60 seconds. Which of the eight break, and how badly?
- How many nodes for the consensus cluster in requirement 8, and where do you put them?`,
      rubric: [
        'Billing job: consensus-elected leader or lock with fencing, with idempotency considered first and its limits stated.',
        'Username: a unique constraint, not a lock — identifies that the database enforces it.',
        'Migration coordinator: consensus-elected leader, with fencing on the migration target.',
        'Webhook: idempotency at the receiver plus at-least-once delivery, no coordination.',
        'Flight seat: conditional update on the seat row; notes it is single-resource.',
        'Counter: no coordination; eventual, and not the source of truth.',
        'Cross-service order: saga with compensation, with 2PC explicitly rejected and why.',
        'Shard list: consensus, as the canonical use — small critical metadata.',
        'Names distributed locks as the common over-engineering.',
        'Outage answer is per-requirement and distinguishes degradation from failure.',
        'Node count answer says odd, gives a number, addresses placement and learners.',
      ],
      modelAnswer: `**1. Nightly billing job, must not run twice, 40 minutes — CONSENSUS-ELECTED LEADER plus fencing**

*First, the cheaper option:* can billing be idempotent? Partly. If each invoice line is written with a natural key — \`(customer_id, billing_period, line_type)\` — then re-running produces no duplicates. **I would build that regardless**, because it protects against retries, partial failures and human re-runs, and it is the only protection that survives every other mechanism failing.

*Why idempotency alone is not enough here:* a 40-minute job run twice concurrently doubles load on the billing database and on the payment processor, and it may send duplicate emails or webhooks — effects with no natural key. So I want exclusion as well as idempotency.

*The primitive:* a consensus-elected leader for the billing role, or a lock with a TTL well above 40 minutes plus a heartbeat that extends it. **Plus fencing**: the job's writes carry the leadership term, and the billing tables reject writes from a stale term.

*What breaks one level weaker* (a lock with a TTL and no fencing): a 40-minute job has enormous exposure to a pause or a network partition exceeding the TTL. Two runs proceed, the idempotent line writes are safe, and the non-idempotent side effects — emails, payment attempts without keys — duplicate. **The failure is partial and therefore hard to detect**, which is worse than a clean double-run.

**2. Username claimed by exactly one account — CONDITIONAL UPDATE, specifically a UNIQUE CONSTRAINT**

*The primitive:* a unique index on \`lower(username)\`. The insert either succeeds or fails with a duplicate-key error, which the application maps to "username taken".

*Why not a lock:* a lock protects a check-then-insert, and a unique constraint makes the check unnecessary. Fewer moving parts, no lock service dependency, and — critically — **it cannot be bypassed by a code path that forgot to take the lock.**

*What breaks one level weaker* (check-then-insert with no constraint): a classic race. Two signups check, neither finds the name, both insert. And as the consistency-models lesson established, **no isolation level saves you if the check happened in a previous request**, which in a signup flow it almost always did.

**3. One of 12 nodes is the schema-migration coordinator — CONSENSUS-ELECTED LEADER plus fencing**

*The primitive:* consensus leader election. This is the canonical use: an infrequent decision that must be unambiguous, where two coordinators would be actively dangerous.

*Plus fencing, and here it is not optional.* The elected coordinator carries its term, and the migration target — a schema-version table — rejects writes from a stale term. Two coordinators running conflicting DDL is close to unrecoverable.

*What breaks one level weaker* (a lock with a TTL): a partitioned old coordinator resumes mid-migration and applies steps out of order against a schema another coordinator has already changed. **Migrations are the least idempotent thing in most systems**, so this is precisely the case where advisory exclusion is unacceptable.

**4. Webhook delivered at least once — IDEMPOTENCY, no coordination at all**

*The primitive:* at-least-once delivery from a durable queue with retries and exponential backoff, plus an idempotency key on the webhook so the *receiver* can deduplicate.

*Why no coordination:* the requirement says at-least-once. Duplicates are explicitly permitted, so there is nothing to exclude. Adding a lock would reduce throughput and add a failure mode for no benefit.

*What the design must include instead:* a stable event id in the payload, documented for the customer, so their handler can dedupe. **The coordination burden is moved to the receiver by contract**, which is the correct place for it — and it is what every mature webhook API does.

*What breaks if you attempt exactly-once:* you cannot have it across a network boundary you do not control. Pursuing it produces a complex design that still delivers duplicates in the failure cases, plus a false belief that it does not.

**5. Flight seat sold to exactly one passenger — CONDITIONAL UPDATE**

*The primitive:* \`UPDATE seats SET passenger_id = ? WHERE flight_id = ? AND seat = ? AND passenger_id IS NULL\`, then check the affected-row count. One row matched means sold to you; zero means someone else got it.

*Why this is sufficient:* the invariant is about **one row**. Exclusion is enforced by the row lock the update takes, at read-committed isolation, with no lock service and no consensus.

*The detail that matters:* **checking the affected-row count.** An update matching zero rows succeeds as a statement. Ignoring the count is the mechanism from the previous lesson's debugging exercise, and it is how a correct statement produces an oversell.

*What breaks one level weaker* (read the seat, check it is free, then write): a lost update. Two passengers read \`NULL\`, both write, the second overwrites the first, and one passenger silently loses their seat.

*Where this stops being enough:* "no more than 180 seats sold" across rows is write skew and needs a materialised count or serializable isolation. **Per-seat exclusive assignment is a single-row problem; capacity is a multi-row problem.** Same feature, two different mechanisms.

**6. Total signups counter on a dashboard — NO COORDINATION**

*The primitive:* an eventually-consistent counter — per-region increments aggregated periodically, or a CRDT counter.

*Why nothing stronger:* nobody notices if a dashboard number is off by three for a minute. Coordinating the highest-volume increment in the system for a display value is a pure cost.

*The rule to state:* **it is not the source of truth.** The authoritative count is \`SELECT count(*) FROM accounts\`. The counter is a cached projection.

*What breaks if you make it consistent:* every signup pays a coordination round trip, and the counter becomes a contention hot spot on the registration path — a single row every signup must serialise on. **Making this consistent would make signups slower and less available**, in exchange for a dashboard being briefly right.

**7. Charge, stock decrement, shipment across three services — SAGA**

*The primitive:* a saga. Reserve stock → charge → create shipment, each a local transaction, each with a compensating action (release the reservation, refund the charge, cancel the shipment), orchestrated by a durable workflow.

*Why not 2PC:* a coordinator failure after all three prepare leaves all three **blocked holding locks**, unable to commit or abort until it returns. Across three independently-deployed services with their own release cycles, that is a serious hazard — and it means a coordinator deploy can freeze order processing.

*What the saga costs, honestly:* intermediate states are observable. A customer can be charged while the shipment is still being created. That must be reflected in the UI and in support tooling — "payment taken, preparing shipment" is a real state, not a transient one to hide.

*Ordering choice worth defending:* reserve stock **before** charging. A failed charge releases a reservation, which is cheap and invisible. A successful charge followed by no stock requires a refund, which is expensive and visible. **Order saga steps so the cheapest compensation is the most likely one.**

*What breaks one level weaker* (three independent calls with no compensation): a partial failure leaves a charge with no shipment, discovered by the customer rather than by you.

**8. Unambiguous active-shard list — CONSENSUS**

*The primitive:* a consensus-replicated store holding the shard map. This is exactly what consensus is for: small, critical, must-be-unambiguous metadata, changing rarely.

*Why not a quorum:* a quorum gives per-key freshness, and I need every node to agree on **one consistent version** of the whole map. Two nodes reading different quorums could see different maps mid-change, and a shard map read inconsistently means two nodes believing they own the same shard.

*Read scaling:* nodes **cache** the map and hold a lease; the consensus master invalidates caches before committing a change. This is Chubby's mechanism, and it is what makes the read volume affordable — reads are local, and consistency is preserved because the master blocks on invalidation before committing.

*Fencing:* the map carries a version, and shard operations carry that version so a node acting on a stale map is rejected at the resource.

*What breaks one level weaker* (gossip or eventual propagation): during a change, two nodes disagree about ownership and both serve the same shard, or neither does. Split-brain over data, which is the failure this primitive exists to prevent.

---

**Which requirement is most often over-engineered, and to what?**

**Requirement 4, the webhook — over-engineered into an exactly-once delivery scheme.** And requirement 5, the seat, over-engineered into a distributed lock.

The pattern: **reaching for a distributed lock when a conditional update or idempotency would do.** It happens because "only one thing at a time" sounds like a lock, and the lock is the most familiar-sounding primitive. But a lock adds a service dependency, a TTL to tune, a fencing requirement most people skip, and a new failure mode — while a conditional update needs none of that and enforces the invariant where the effect happens.

**The diagnostic question:** *is there a single row or key whose state expresses the exclusion?* If yes, a conditional update on it is sufficient and superior. A lock is only needed when the exclusion spans resources or protects something with no conditional write.

**Consensus cluster unavailable for 60 seconds — what breaks?**

| # | Requirement | Impact |
| --- | --- | --- |
| 1 | Billing job | **Degraded.** If it holds leadership, it continues — leadership was already granted. It cannot *renew*, so if the lease expires mid-job it must stop safely. If it was due to start, it does not start. Acceptable: billing is not time-critical to the minute. |
| 2 | Username | **Unaffected.** A database constraint, no consensus involved. |
| 3 | Migration coordinator | **Blocked**, correctly. No new migrations start. This is the right behaviour — a migration is exactly what you do not want proceeding under uncertainty. |
| 4 | Webhooks | **Unaffected.** Queue plus retries, no coordination. |
| 5 | Flight seats | **Unaffected.** A conditional update on a database row. |
| 6 | Counter | **Unaffected.** |
| 7 | Order saga | **Unaffected**, if the workflow state is in a database rather than the consensus store. Worth designing for deliberately. |
| 8 | Shard map | **Degraded, not broken** — *provided* nodes cache the map and fail open. They keep serving with the last known map. New shard changes cannot be committed. |

**The summary: two of eight are affected, both degrade rather than fail, and both are operations that should not proceed under uncertainty.** That is a good outcome and it is not accidental — it is the result of choosing the cheapest primitive for each requirement, which naturally minimises the number of things depending on consensus.

**The design rule this illustrates**, and it is Chubby's published lesson: **every consumer of the coordination service must degrade explicitly.** Google found that applications had no fallback and cascaded, and responded by deliberately limiting Chubby's availability so nobody built on an assumption of perfection. Requirement 8's cache-and-fail-open behaviour is precisely that lesson applied.

**Consensus cluster: how many nodes and where?**

**Five voting members, one per availability zone across three zones, distributed 2-2-1.**

*Why five rather than three:* five tolerates two simultaneous failures, which matters because I need to survive **a node failure during maintenance on another node**. With three, taking one down for an upgrade leaves no fault tolerance at all — and upgrades are frequent while zone failures are rare, so this is the failure combination that actually occurs.

*Why not seven:* every commit would wait for the fourth-fastest of seven. The marginal durability is not worth the latency, and seven is only justified when surviving two failures plus maintenance is a hard requirement.

*Why odd:* six needs four for a majority, tolerating two failures like five, while making every commit wait for one more acknowledgement. Strictly worse.

*Zone distribution 2-2-1, and why not 2-2-2 or one-per-zone:* with three zones I cannot place five nodes evenly. 2-2-1 means **losing any single zone leaves at least three nodes — still a majority.** Losing the 2-zone leaves 3, which is a majority; losing the 1-zone leaves 4. So a zone failure is survivable in every case. With 2-2-1 the risk to avoid is placing 3 in one zone, which would make that zone's loss fatal.

*All in one region:* commit latency is intra-region, single-digit milliseconds. **I would not put voting members in another region** — that would put a cross-region round trip on every commit, and consensus is on the path for every leadership and configuration change.

*For other regions: non-voting learners.* They receive the log and serve local reads, so a node in another region can read the shard map locally without enlarging the voting set. Commit latency stays at a 3-of-5 intra-region majority. **This is the specific answer to "we need a copy in Europe"** — a learner, not a voter.

*Two operational requirements:* the members must not share a failure domain below the zone level — no two on the same host, rack, or power supply, or the zone-tolerance argument is void. And **membership changes must use the protocol's joint-consensus mechanism** rather than a stop-and-reconfigure, because a naive membership change can transiently create two disjoint majorities. That is the part most implementations get wrong, and it is worth reading the extended Raft material specifically for it.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-cons-1',
      level: 'basic',
      question: 'What does `R + W > N` mean and why does it work?',
      guidance:
        'The read and write sets must overlap in at least one replica, so a read sees the latest acknowledged write. A strong answer gives the useful tunings and notes that overlap gives freshness per key, not ordering.',
    },
    {
      id: 'iq-cons-2',
      level: 'basic',
      question: 'What problem does consensus solve, and what does it require?',
      guidance:
        'Agreement on an ordered log despite failures, requiring a majority. Look for the recognition that losing a majority stops the system rather than making it wrong.',
    },
    {
      id: 'iq-cons-3',
      level: 'intermediate',
      question: 'How would you use consensus without putting it on the hot path?',
      guidance:
        'Elect a leader by consensus, then let the leader sequence operations at local speed. A strong answer notes this is what consensus-backed databases do internally, and gives the cross-region latency numbers that motivate it.',
    },
    {
      id: 'iq-cons-4',
      level: 'intermediate',
      question: 'Why is a distributed lock with a TTL not mutual exclusion?',
      guidance:
        'A pause exceeding the TTL gives two holders, and the paused process cannot be told. Look for fencing tokens enforced at the resource, and for idempotency and partitioning being considered first.',
    },
    {
      id: 'iq-cons-5',
      level: 'advanced',
      question: 'How many nodes in a consensus cluster, and where do you place them?',
      guidance:
        'Odd; five to survive a failure during maintenance; distributed so no single zone holds a majority; voting members in one region with learners elsewhere. Excellent answers name joint consensus for membership changes.',
    },
    {
      id: 'iq-cons-6',
      level: 'advanced',
      question: 'Why avoid 2PC across services, and what do you use instead?',
      guidance:
        'A coordinator failure after prepare blocks participants holding locks. Sagas with compensation instead. Excellent answers order saga steps so the cheapest compensation is the most likely, and acknowledge observable intermediate states.',
    },
    {
      id: 'iq-cons-7',
      level: 'followup',
      question: 'Your coordination service is unavailable for a minute. What happens?',
      guidance:
        'Should be a per-consumer answer with explicit degradation — cached configuration and fail open, operations that should not proceed under uncertainty correctly blocked. A strong answer cites Chubby\'s finding that clients had no fallback and cascaded.',
    },
    {
      id: 'iq-cons-8',
      level: 'followup',
      question: 'You said fencing tokens. What if the resource cannot check them?',
      guidance:
        'Then it cannot be safely fenced, and the answer is idempotency rather than a better lock. Look for the willingness to say a lock is advisory here, rather than claiming exclusion that does not exist.',
    },
  ],

  activeLearning: [
    {
      id: 'al-cons-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed nodes fail by crashing or being unreachable. Now change one thing: a node may behave arbitrarily — send contradictory messages, lie about its log, or be actively malicious. What breaks, and what does fixing it cost?',
      discussion: `This is the Byzantine fault model, and the shift is larger than it first appears.

**What breaks in Raft and Paxos.** Both assume **crash faults**: a node either follows the protocol or stops. Neither tolerates a node that lies. Concretely:

- A malicious leader could send different log entries to different followers, so the replicas diverge while each believes it is consistent.
- A malicious node could vote for two candidates in the same term, enabling two leaders.
- A malicious node could claim its log is more up to date than it is, winning an election it should have lost and truncating committed entries.

Nothing in the protocol detects any of these, because nothing verifies that a peer's claims are truthful — the safety arguments all assume honest participants.

**What fixing it costs.**

**More nodes: 3f + 1 to tolerate f faults**, rather than 2f + 1. Tolerating one Byzantine node needs four nodes, not three; two needs seven, not five. That is a substantial increase in both machines and commit latency.

**More messages.** Byzantine protocols typically need multiple rounds of all-to-all communication per decision, so message complexity is O(N²) rather than O(N). At small N that is tolerable; it is why Byzantine systems stay small.

**Cryptographic signatures on messages**, so a node cannot forge another's vote or claim a peer said something it did not. Signing and verifying every message is real CPU cost on the hot path.

**Much greater implementation complexity**, and complexity is itself a source of faults — which is a genuine argument against adopting the stronger model without a clear need.

**When it is actually needed.**

**Mutually distrusting parties.** Blockchains are the canonical case: participants have financial incentives to cheat and no shared administrator. Byzantine tolerance is the requirement, not a precaution.

**Regulatory or adversarial settings** where several organisations run nodes and none will accept another's word.

**When it is not needed, which is almost always in ordinary infrastructure.** Within one organisation's datacentres, nodes are not adversarial. The realistic faults are crashes, network partitions, disk corruption and bugs — and crash-fault consensus plus checksums covers those.

**The nuance worth adding, because it is where the model leaks.** Some real faults look Byzantine without malice:

- **Silent disk corruption** makes a node serve wrong data while believing it correct. Mitigated with checksums, not Byzantine consensus.
- **A bug in one node's implementation** can produce arbitrary behaviour. Mitigated by running the same implementation everywhere, so a bug is consistent rather than divergent — which is a real argument against heterogeneous implementations of one protocol.
- **A misconfigured node** can claim a wrong identity or term. Mitigated with configuration validation.

So the practical position: **use crash-fault consensus and defend against Byzantine-looking faults with targeted mechanisms** — checksums for corruption, identical implementations for bug consistency, configuration validation for identity. That is far cheaper than 3f + 1 with signatures on every message.

**The transferable point.** The fault model is an assumption, and every safety argument rests on it. Raft is safe *under crash faults*. When someone asks "is this safe", the useful counter-question is "against which faults" — and the answer determines both the protocol and its cost. A team that has not stated its fault model has not stated its guarantee.`,
    },
    {
      id: 'al-cons-2',
      kind: 'debug',
      prompt:
        'A 5-node Raft cluster holding cluster configuration shows a leader election roughly every 40 seconds. The cluster is healthy — no node has crashed, network monitoring shows no packet loss, and CPU is under 30% everywhere. Each election takes about 700 ms during which writes fail. Hypotheses?',
      discussion: `Elections happen when a follower does not hear from the leader within its election timeout. So either the leader is not sending heartbeats on time, or the heartbeats are not arriving on time, or a follower is not processing them on time. Every hypothesis is a variant of one of those three.

**Hypothesis 1 — garbage collection pauses on the leader exceeding the election timeout.** A stop-the-world pause of, say, 600 ms with a 500 ms election timeout means followers time out and elect a new leader. The old leader resumes, discovers a newer term, and steps down. Then the *new* leader does the same thing 40 seconds later, and the pattern is a rotation.

*Why this fits best:* the ~40-second period is suggestive of a GC cycle, CPU is moderate (a pause is not busy CPU across the window), and the cluster is otherwise healthy. **This is the classic cause of exactly this symptom.**

*Check:* per-node GC pause durations against the election timeout, and whether election timestamps correlate with pauses on the then-leader.

**Hypothesis 2 — fsync latency on the leader.** Raft requires appending to a durable log before acknowledging. If disk fsync latency spikes — a noisy neighbour on shared storage, a filesystem flush, an SSD garbage-collection cycle — the leader cannot send heartbeats promptly because it is blocked on the log write.

*Why it fits:* moderate CPU (blocked on I/O, not computing) and a periodic pattern consistent with storage-level background work.

*Check:* fsync duration at p99 on each node, correlated with election times. This is a metric consensus systems expose and almost nobody graphs.

**Hypothesis 3 — an election timeout set too aggressively for the environment.** If the timeout is 150 ms — a common default from the paper's LAN assumptions — and the actual network round trip is 40 ms with occasional 200 ms spikes, elections are inevitable. The cluster is "healthy" by monitoring that measures averages.

*Why it fits:* no packet loss and still elections. **Loss is not the relevant metric; tail latency is.** Monitoring that reports 0% loss says nothing about whether 1% of packets take 300 ms.

*Check:* the configured election timeout against measured p99.9 round-trip time between members. The rule of thumb is an election timeout an order of magnitude above the p99.9 RTT.

**Hypothesis 4 — a heartbeat interval too close to the election timeout.** If heartbeats are every 400 ms with a 500 ms timeout, a single dropped or delayed heartbeat triggers an election. There is no margin for one missed message.

*Check:* the ratio. Heartbeat interval should be a small fraction of the election timeout — commonly a tenth — so several consecutive heartbeats must be lost before a timeout.

**Hypothesis 5 — the log has grown and snapshotting blocks the leader.** If the leader periodically writes a snapshot and that blocks its main loop, heartbeats stop for its duration. Periodic by construction, and the period would track log-growth rate.

*Check:* whether election times align with snapshot operations, and whether snapshotting is on the critical path or a background thread.

**Hypothesis 6 — clock or virtualisation issues.** A VM that is descheduled by its hypervisor experiences a pause indistinguishable from GC from the inside. Steal time is the metric, and it is invisible in guest CPU utilisation — which is precisely why "CPU under 30%" does not eliminate it.

*Check:* CPU steal time on each node.

**What I would check first: GC pause duration against the election timeout.** It is one metric, it is the most common cause of this exact symptom, and it explains the periodicity naturally. **And I would check it on the node that was leader at each election**, not the current leader — the failing node is the one that lost leadership, and looking at the current leader is the mistake that makes this take a day.

**Then: fsync p99 and the timeout-to-RTT ratio**, which together cover the two other realistic causes and are both cheap to measure.

**Why this matters more than the 700 ms suggests.** Elections every 40 seconds means roughly 1.75% of the time has no leader, so 1.75% of configuration writes fail. Worse, in a system where the shard map lives here, every consumer sees intermittent write failures with no clear cause — and consumers that do not degrade gracefully turn this into user-visible errors. **A flapping consensus cluster is more damaging than a briefly-down one**, because intermittent failure is harder to reason about than absence.

**The structural fixes, in order.**

**Tune the timeouts to the environment.** Election timeout at least ten times the p99.9 RTT, heartbeat interval a tenth of the election timeout. Defaults from a paper assume a LAN and a language runtime that may not match yours.

**Remove the pauses.** GC tuning, dedicated hosts to eliminate steal time, local NVMe rather than network storage for the log. These attack the cause rather than the symptom.

**Alert on election rate.** An election is a normal event; an election *rate* above a few per day is an incident. This is the metric that would have caught it on day one, and it is almost never configured — teams alert on the cluster being down and not on it being unstable.

**Transferable:** in any system with a failure detector, the detector's timeouts are a configuration that must match the environment's tail latency. Timeouts tuned for a LAN and deployed on shared virtualised infrastructure produce exactly this: a healthy cluster that constantly believes it is failing. **The pattern generalises to health checks, retry timeouts and lock TTLs — every one of them is a bet about tail latency, and every one of them should be checked against a measured p99.9 rather than a default.**`,
    },
  ],

  revision: {
    bullets: [
      '`R + W > N` makes read and write sets overlap, so a read sees the latest acknowledged write to that key.',
      'Quorums give per-key freshness, not ordering across operations and nothing across keys.',
      '`N=3, W=2, R=2` is the default: the only 3-node tuning that survives one failure for both reads and writes.',
      'Quorum latency is the slowest member\'s, so coordination amplifies the tail far beyond a single node.',
      'Consensus gives an ordered replicated log all correct nodes agree on, and requires a majority.',
      'Losing a majority stops consensus rather than making it wrong — that is the guarantee, not a defect.',
      'Node counts must be odd: 4 tolerates one failure like 3, at worse latency.',
      'Five nodes, not three, if you must survive a failure during maintenance on another node.',
      'Learners give extra copies for read locality without enlarging the voting set or the commit latency.',
      'Raft terms make a returning stale leader harmless — the same mechanism as a fencing token.',
      'The central pattern: use consensus to decide who decides, then let the leader sequence at local speed.',
      'A consensus log is for kilobytes of critical metadata, not application data at volume.',
      'Client caching with master-side invalidation is what makes consensus read volume affordable.',
      'A lock with a TTL is not mutual exclusion: any pause exceeding the TTL gives two holders.',
      'Fencing tokens must be enforced at the resource — a correct lock service plus an unfenced resource is broken.',
      'If the resource cannot check a monotonic token, it cannot be fenced; the answer is idempotency.',
      'Most distributed-lock requirements are idempotency or partitioning requirements in disguise.',
      '2PC blocks participants holding locks if the coordinator fails after prepare; sagas do not.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A family of coordination primitives: quorums, which guarantee a read sees the latest acknowledged write to a key, and consensus, which gives an ordered replicated log agreed by a majority of nodes.',
    whyItExists:
      'Because agreement across machines that may crash, be slow, or be partitioned requires a majority — and a majority round trip is the irreducible cost of an unambiguous decision.',
    whenToUse: [
      'Consensus for leader election, membership, and configuration that must not be ambiguous.',
      'Quorums for per-key freshness without a leader, tuned per operation.',
      'Consensus-elected leadership plus local writes, for strong consistency at affordable latency.',
    ],
    whenNotToUse: [
      'On the hot path, or across regions per operation.',
      'For application data at volume — a consensus log is not a database.',
      'When your requirement is to keep serving during a partition; consensus stops instead.',
      'For mutual exclusion without fencing enforced at the resource.',
      'When idempotency or partitioned ownership would remove the need entirely.',
    ],
    alternatives: [
      'Idempotency, which dissolves most exclusion requirements.',
      'Partitioned ownership, which makes exclusion structural.',
      'A conditional update or unique constraint, enforcing exclusion where the effect happens.',
      'Sagas with compensation, instead of 2PC across services.',
      'Non-voting learners, instead of adding voting members for geography.',
    ],
    tradeoffs: [
      'A quorum buys per-key freshness and costs the slowest member\'s latency plus conflict resolution.',
      'Consensus buys unambiguous ordering and costs a majority round trip plus stopping without a majority.',
      'More voting members buy durability and cost commit latency.',
      'Consensus-for-leadership buys local write speed and costs an unavailability window on failover.',
      'A lock with fencing buys real exclusion and costs token plumbing plus resource-side enforcement.',
      'A saga buys non-blocking multi-service atomicity and costs compensations and observable intermediate states.',
    ],
    failureModes: [
      'A lock holder pausing beyond its TTL, producing two holders.',
      'A correct lock service protecting a resource that cannot reject stale tokens.',
      'An even node count tolerating no more failures than the odd number below it.',
      'A two-node cluster where either failure stops the system.',
      'Consensus on the write path across regions, adding a cross-region round trip per write.',
      'Election flapping from timeouts tuned for a LAN, or from GC and fsync pauses.',
      'A 2PC coordinator failing after prepare, blocking participants holding locks.',
      'Clients with no fallback for coordination-service unavailability, cascading a brief outage.',
      'A membership change made without joint consensus, transiently creating two majorities.',
      'A conditional update matching zero rows and the application ignoring the count.',
    ],
    followUpQuestions: [
      'Could idempotency or partitioned ownership remove this coordination entirely?',
      'Is there a single row whose state expresses the exclusion you need?',
      'Does your lock issue fencing tokens, and does the resource actually check them?',
      'Is consensus on your write path, or only on your leadership decision?',
      'How many voting members, and could a single zone loss remove a majority?',
      'What is your election timeout relative to measured p99.9 round-trip time?',
      'What is your election rate, and do you alert on it?',
      'What does each consumer do when the coordination service is unavailable for a minute?',
    ],
  },
});
