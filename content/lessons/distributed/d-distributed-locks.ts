import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-distributed-locks',
  title: 'Distributed locks and leases',
  summary:
    'A lock is a lease on a belief, and the belief expires while the holder is not looking. This lesson is the arithmetic of lease renewal, the clock assumptions each lock service actually makes, and the three ways to avoid needing a lock at all.',
  phase: 'distributed',
  module: 'resilience',
  position: 33,
  kind: 'concept',
  difficulty: 'advanced',
  estimatedMinutes: 45,
  tags: ['locks', 'leases', 'fencing', 'clock-skew', 'ownership'],
  prerequisites: ['d-consensus'],
  resources: [
    {
      key: 'kleppmann-redlock',
      tier: 'must',
      note: 'The critique that clarifies the whole subject. Read it for the argument that a lock protecting a resource needs the resource to participate, and for the timing assumptions it makes explicit.',
    },
    {
      key: 'redis-distlock',
      tier: 'must',
      note: 'The algorithm being critiqued, described by its authors. Read both this and the critique — the disagreement is about which assumptions are acceptable, and seeing both sides is how you learn to ask the right question.',
    },
    {
      key: 'chubby-paper',
      tier: 'must',
      note: 'Read the sections on lock delay and on sequencers. Chubby shipped both mechanisms specifically because the authors knew a lease alone was unsafe, which is the strongest evidence for this lesson\'s central claim.',
    },
    {
      key: 'zookeeper-paper',
      tier: 'good',
      note: 'Read the material on ephemeral nodes and on the ordering guarantees. Session-based lock release is a genuinely different mechanism from a TTL and worth understanding on its own terms.',
    },
    {
      key: 'postgres-explicit-locking',
      tier: 'good',
      note: 'Read the advisory-lock and row-lock sections. A database you already run is often the right lock service, and knowing exactly what it offers prevents adopting a second system unnecessarily.',
    },
    {
      key: 'raft-paper',
      tier: 'advanced',
      note: 'Read the leader-election and term sections again with locks in mind. A lease with a fencing token and a Raft term are the same mechanism, and seeing that equivalence is what makes both make sense.',
    },
  ],

  intuition: {
    body: `The consensus lesson established that a lock plus a TTL is not mutual exclusion, and that fencing tokens are the fix. This lesson is about what that actually costs to build, and about the three ways to not need it.

Start with the honest definition. **A distributed lock is a lease: permission to act, valid until a deadline.** And the essential property is that **the holder cannot be told when the lease expires**, because expiry is an event at the lock service and the holder may be paused, partitioned, or descheduled at that moment.

So a lock holder never knows it holds the lock. It knows it *held* the lock at some point in the past, and it is extrapolating. Every safe design follows from taking that seriously.

Three consequences worth having as reflexes:

**The useful question is not "do I hold the lock" but "will my write be accepted".** Those differ, and only the second is answerable at the moment it matters. A holder that asks the lock service "am I still the holder?" and then writes has learned nothing — the pause can land between the two.

**Lease renewal is arithmetic, not a background thread you add and forget.** If the lease is 30 seconds and you renew every 10, you are betting that no pause exceeds 30 seconds and that renewal latency stays well under the remaining margin. Both are bets about tail latency, and both are usually made implicitly.

**The clock assumptions differ between lock services, and they are the real distinction.** A consensus-backed lock service ties the lease to a session heartbeat, so expiry is decided by the service and not by comparing clocks. A TTL-based lock in a data store relies on the store's clock and the client's estimate of elapsed time. Those are different safety properties, and choosing between lock services is mostly choosing between them.

And then the observation that resolves most real cases: **most lock requirements are ownership requirements or idempotency requirements.** If each worker owns a disjoint set of keys, nothing needs excluding. If repeating the work is harmless, nothing needs excluding. **A lock is what you reach for when neither is available**, and it is worth spending real effort establishing that before building one.

The framing to carry: **a lock is a lease on a belief; make the resource arbitrate, do the renewal arithmetic explicitly, and check first whether ownership or idempotency removes the need.**`,
    analogyLimit:
      'A mutex is the analogy to abandon. A mutex is enforced by the runtime, so a thread that holds it genuinely holds it and cannot be bypassed. A distributed lock is advisory and time-bounded: the holder can be paused past expiry with no notification, and nothing stops a second holder from writing. The mutex analogy also hides that renewal is the design — a mutex has no lease to extend and no tail-latency bet to get wrong.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team implements leader election with a 15-second lease renewed every 5 seconds. The leader writes to a shared database. During a network blip, renewal fails once, then succeeds. Later, a 20-second GC pause causes two renewals to be missed and a new leader is elected. The old leader resumes and writes. Work out the exact timing windows, and say what safe lease arithmetic would look like.',
      answer: `**First, the timing during the ordinary blip.**

\`\`\`
t=0   lease acquired, expires t=15
t=5   renewal succeeds → expires t=20
t=10  renewal FAILS (network blip)
t=15  renewal succeeds → expires t=30
\`\`\`

At \`t=10\` the leader still holds a lease valid until \`t=20\`, so a single failed renewal is survivable — that is the point of renewing at one third of the lease duration. **The margin after one failure is 10 seconds**, which is the amount of tail latency the design tolerates. Nobody wrote that number down, and it is the design.

**Now the pause.**

\`\`\`
t=15  renewal succeeds → expires t=30
t=16  GC pause begins
t=21  renewal at t=20 does not happen (paused)
t=26  renewal at t=25 does not happen (paused)
t=30  LEASE EXPIRES at the lock service
t=31  new leader elected, begins writing
t=36  pause ends; old leader resumes
\`\`\`

At \`t=36\` the old leader's last knowledge is "my lease is valid until \`t=30\`". If it checks the clock it can discover that \`t=36 > t=30\` and stand down — **and only if it checks before every write, and only if its clock is trustworthy, and only if a pause cannot occur between the check and the write.** All three are required and the third is not achievable.

So: **two writers between \`t=31\` and whenever the old leader notices.** And if it does not check, indefinitely.

**What safe lease arithmetic looks like.**

The renewal design has four quantities and they must satisfy one inequality:

\`\`\`
lease_duration  >  renewal_interval + max_renewal_latency + max_pause_tolerated
\`\`\`

With a 15-second lease, a 5-second interval, a 1-second renewal round trip, that leaves **9 seconds of pause tolerance.** A 20-second GC pause is far outside it.

Two ways to widen the margin, both with costs:

**Lengthen the lease.** A 60-second lease renewed every 5 seconds tolerates a ~54-second pause. The cost is **failover time**: when a leader genuinely dies, nothing happens for up to 60 seconds. So lease duration is a direct trade between pause tolerance and failover latency, and it should be chosen from the measured p99.9 pause, not from a default.

**Remove the pauses.** Tune garbage collection, use dedicated hosts to eliminate hypervisor steal time, keep the leader's work off the same process as anything that allocates heavily. This attacks the cause, and it is the more durable fix.

**But neither makes it safe, and this is the point.** Any finite lease can be exceeded by a sufficiently long pause. Lengthening the lease reduces the probability and worsens failover; it does not change the argument.

**The three things that make it actually safe.**

**1. A fencing token enforced at the resource.** The lease grant carries a monotonically increasing number; the database rejects writes bearing a lower one than it has seen. The old leader's write at \`t=36\` fails because the new leader's token is higher. This is the mechanism from the consensus lesson and it is the only one that closes the window rather than narrowing it. Note that a Raft term is exactly this — same idea, one layer down.

**2. A lock delay at the service.** After a lease expires without a clean release, the service refuses to grant it to anyone for a further period — Chubby does this. If the delay exceeds the maximum pause, the old holder has noticed before a new one exists. It **narrows** the window substantially and rests on a bound on pauses, so it complements fencing rather than replacing it.

**3. A hard stop in the holder.** A watchdog that terminates the process if a renewal has not succeeded within the lease duration. A paused process cannot run its watchdog during the pause — but on resuming, the watchdog fires before application code proceeds. Cheap, effective, and still not a substitute for fencing.

**The general lesson.** The team's mistake was treating renewal as a background detail rather than as the safety argument. **Writing the inequality down forces you to state your pause tolerance**, and stating it immediately reveals that a 15-second lease tolerates 9 seconds of pause while your JVM has 20-second pauses in the p99.9. That is a five-minute calculation that would have prevented the incident, and it is skipped almost universally.`,
    },
  body: `## Lease renewal, as arithmetic

Four quantities, one inequality:

\`\`\`
lease_duration > renewal_interval + max_renewal_latency + pause_tolerance
\`\`\`

Pick three and the fourth is determined. In practice:

- **Renewal interval** at one third of the lease duration, so two consecutive failures are survivable.
- **Renewal latency** from the measured p99.9 of the round trip to the lock service, not the mean.
- **Pause tolerance** from the measured p99.9 of process pauses — garbage collection, page faults, hypervisor steal.
- **Lease duration** falls out, and it is also your **failover time**: when a holder dies, nothing can proceed for up to that long.

So the trade is explicit: **a longer lease tolerates longer pauses and makes genuine failures slower to detect.** A 5-second lease means fast failover and almost no pause tolerance; a 60-second lease means the opposite. Choosing without doing this arithmetic means the number is a guess.

Two refinements worth knowing:

**Measure pauses, do not assume them.** Runtimes expose pause durations, and hypervisor steal time is a distinct metric. A team that believes its p99.9 pause is 200 ms and measures 4 seconds has learned the most important input to this calculation.

**A watchdog that self-terminates on renewal failure.** If a renewal has not succeeded within the lease duration, kill the process. It cannot run during a pause, and it runs before application code on resume — which converts "silently continue as a stale holder" into "crash and restart". Cheap and worth having.

## What each lock service actually assumes

The differences between lock services are almost entirely about **whose clock decides expiry**.

**Consensus-backed with session heartbeats** (ZooKeeper-style, Chubby-style). The client maintains a session with periodic heartbeats. If heartbeats stop, the service expires the session and releases anything held. An ephemeral lock node disappears with the session.

*Clock assumption:* the **service** measures the heartbeat gap. The client does not compare clocks, so client clock skew is irrelevant. This is the strongest position available.
*Cost:* a consensus cluster to operate, and the failure mode that its unavailability stops lock acquisition — which is correct, since consensus stops rather than being wrong.

**TTL in a single data store** (a Redis \`SET NX EX\`, a database row with an expiry). Set a key if absent with an expiry; delete it to release.

*Clock assumption:* the **store's** clock for expiry, plus the client's estimate of how much of its lease remains. A client whose clock jumps, or which mis-estimates elapsed time across a pause, can believe it holds an expired lease.
*Cost:* simple and dependent on one store's availability. And with asynchronous replication, a failover can lose the lock record entirely — so two clients can hold the "same" lock across a failover, which is not a subtle failure.

**Multi-store quorum TTL** (the Redlock shape). Acquire the lock on a majority of independent stores, each with a TTL, and treat the lock as held if a majority granted it within a bounded time.

*Clock assumption:* this is the contested part. It requires bounded clock drift across the stores and bounded delays for the validity argument to hold. **The critique is that those are timing assumptions rather than failure assumptions**, and a system whose safety depends on bounded message delay is not safe in an asynchronous network.
*Where it sits:* better than a single store for availability; not a substitute for fencing. Its authors and its critics agree it is unsafe without a fencing mechanism at the resource, and disagree about how acceptable the timing assumptions are.

**A database row with a conditional update.** \`UPDATE locks SET holder = ?, token = token + 1 WHERE name = ? AND (holder IS NULL OR expires_at < now())\`.

*Clock assumption:* the database's clock, used consistently by all clients — so no cross-clock comparison.
*Why this is underrated:* it is transactional with your other writes, it gives you a **monotonic token for free** (the incremented column), and you already run the database. For a moderate lock rate this is frequently the right answer, and reaching for a separate lock service before considering it is common over-engineering.

The selection question: **can the resource you are protecting accept a fencing token?** If yes, the lock service's job is only liveness — grant fairly and expire promptly — and a simple one suffices. If no, no lock service is safe and the answer is idempotency.

## Fencing: what the resource must support

The consensus lesson established that fencing must be enforced at the resource. What that requires concretely:

**A monotonically increasing token per grant.** A Raft term, a ZooKeeper node version, an incremented database column. It must increase on every grant, including grants after an expiry.

**The resource must persist the highest token it has seen and reject lower ones.** Concretely:

| Resource | Fencing mechanism |
| --- | --- |
| Relational database | A \`token\` column with \`WHERE token < ?\`, or a version check |
| Object store | A conditional put on an ETag or a generation number |
| A service you own | Pass the token; the service tracks the highest per resource |
| A filesystem | **None available.** Cannot be fenced |
| A third-party API | Usually none. Sometimes an idempotency key substitutes |

The last two rows are the important ones. **If the resource cannot reject a stale token, no lock makes the operation safe**, and the honest response is to make the operation idempotent rather than to claim exclusion you do not have.

A detail that matters: the token must be checked **atomically with the write**, not before it. A read of the current token followed by a write reproduces the original problem one level down.

## The three ways to not need a lock

Worth exhausting before building any of the above.

**1. Idempotency.** If performing the work twice has the same effect as once, two holders are wasteful rather than incorrect. This dissolves the problem, works with resources that cannot be fenced, and is the technique from the delivery-semantics lesson applied here.

**2. Partitioned ownership.** Assign each worker a disjoint set of keys — by consistent hashing, or by an explicit assignment. No two workers ever touch the same item, so exclusion is structural. **This is what most "we need a lock per item" requirements actually want**, and it scales better because there is no lock service on the hot path.

The caveat: ownership *reassignment* during a failure needs coordination, so you have moved the coordination from per-item to per-rebalance. That is a very good trade — thousands of lock acquisitions become one membership decision.

**3. A conditional update on the resource.** \`UPDATE ... WHERE version = ?\` gives mutual exclusion enforced where the effect happens, with no lock at all. If the operation is a single-resource state transition, this is strictly better than a lock: fewer components, no lease arithmetic, and enforcement at the point of effect by construction.

**And a fourth that is often the real answer: question the requirement.** "Only one worker should process this" is sometimes a performance preference rather than a correctness requirement. Two workers doing the same idempotent work costs CPU, not correctness, and CPU is cheaper than a lock service.

## Practical hazards

**Lock granularity.** One coarse lock is simple and serialises everything; a lock per item is parallel and multiplies lock-service load. The usual answer is a lock per natural ownership unit — per tenant, per shard, per aggregate — which is coarse enough to be cheap and fine enough to be parallel.

**Reentrancy.** A distributed lock is usually not reentrant. Code that acquires a lock and then calls something that acquires the same lock deadlocks against its own lease. Track holder identity if reentrancy is needed, and prefer not to need it.

**Lock ordering.** Acquiring two locks in different orders in different code paths deadlocks. If several locks are ever held together, define a global order and acquire in it. Better: design so only one lock is ever held.

**Releasing someone else's lock.** A holder whose lease expired must not blindly \`DELETE\` the lock key on completion — a new holder may own it. Release must be conditional on the holder identity or token, and an unconditional release is a real and common bug.

**The unlock-failure path.** If release fails, the lock is held until expiry. That is correct and it means the lease duration is also your worst-case delay after a crash — another reason not to make it long carelessly.

## Where a lock is genuinely the right answer

**Coarse, long-held leadership.** "I am the primary for this shard", held for hours. Consensus grants it, a fencing token makes it safe, and the acquisition rate is low enough that the lock service is not on the hot path. **This is the case locks are good at**, and it is what Chubby's authors observed their users actually needed.

**Serialising a non-idempotent, non-partitionable operation** over a fenceable resource. A schema migration, a one-off reconciliation, an exclusive maintenance task.

**Preventing wasteful duplicate work** where correctness does not depend on it. A best-effort lock that usually prevents two workers doing the same expensive job is fine, provided the design is correct when it fails — and stating that it is best-effort is what keeps the design honest.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'lease-timeline',
      title: 'The lease arithmetic, and where it runs out',
      caption:
        'Step through it. Every quantity here is a bet about tail latency, and the inequality at the end is the safety argument nobody writes down.',
      nodes: [
        { id: 'acq', label: 't=0 acquire', kind: 'client', x: 0, y: 170, detail: 'Lease granted for 15 seconds, expiring at t=15, with fencing token 33. The holder now knows it held the lock at t=0 and is extrapolating from there.' },
        { id: 'r1', label: 't=5 renew ✓', kind: 'service', x: 150, y: 90, detail: 'Renewal at one third of the lease duration. Expiry moves to t=20, so the holder now has 15 seconds of margin.' },
        { id: 'r2', label: 't=10 renew ✗', kind: 'note', x: 150, y: 250, detail: 'A network blip. Survivable precisely because the lease still runs to t=20 — the margin after one failure is 10 seconds, and that number IS the design.' },
        { id: 'r3', label: 't=15 renew ✓', kind: 'service', x: 310, y: 170, detail: 'Recovered. Expiry moves to t=30. Everything so far is the design working as intended.' },
        { id: 'pause', label: 't=16–36 pause', kind: 'note', x: 470, y: 90, detail: 'A 20-second GC pause. Renewals at t=20 and t=25 never happen, because the process is not running. Nothing can notify it.' },
        { id: 'exp', label: 't=30 lease expires', kind: 'store', x: 470, y: 250, detail: 'The lock service expires the lease. It has no way to tell the holder, and the holder has no way to notice.' },
        { id: 'new', label: 't=31 new holder, token 34', kind: 'client', x: 660, y: 250, detail: 'A legitimate new holder begins writing. Two processes now believe they hold the lock, and neither has done anything wrong.' },
        { id: 'stale', label: 't=36 old holder writes', kind: 'client', x: 660, y: 90, detail: 'Resumes with token 33 and its last knowledge being "valid until t=30". Checking the clock could reveal the problem, and a pause can land between the check and the write.' },
        { id: 'fence', label: 'Resource rejects 33', kind: 'store', x: 850, y: 170, detail: 'The only mechanism that closes the window rather than narrowing it: the resource has seen 34 and rejects 33 atomically with the write.' },
      ],
      edges: [
        { id: 'l1', source: 'acq', target: 'r1', kind: 'control' },
        { id: 'l2', source: 'r1', target: 'r2', kind: 'control' },
        { id: 'l3', source: 'r2', target: 'r3', kind: 'control' },
        { id: 'l4', source: 'r3', target: 'pause', kind: 'control' },
        { id: 'l5', source: 'pause', target: 'exp', kind: 'async' },
        { id: 'l6', source: 'exp', target: 'new', kind: 'control' },
        { id: 'l7', source: 'pause', target: 'stale', kind: 'control' },
        { id: 'l8', source: 'new', target: 'fence', kind: 'write' },
        { id: 'l9', source: 'stale', target: 'fence', kind: 'write' },
      ],
      steps: [
        {
          id: 'ls1',
          title: 'Renewal at one third buys two failures of margin',
          description:
            'Renewing every 5 seconds on a 15-second lease means one failed renewal leaves 10 seconds of margin. That margin is the pause tolerance, and it is the number the design rests on.',
          nodes: ['acq', 'r1', 'r2', 'r3'],
          edges: ['l1', 'l2', 'l3'],
        },
        {
          id: 'ls2',
          title: 'A pause longer than the margin ends it',
          description:
            'A 20-second pause against 9 seconds of tolerance. The renewals do not happen because the process is not running, and no mechanism can inform it.',
          nodes: ['pause', 'exp'],
          edges: ['l4', 'l5'],
        },
        {
          id: 'ls3',
          title: 'A second holder appears, legitimately',
          description:
            'The lease expired, so granting it again is correct. Two holders now exist and the lock service has behaved perfectly throughout — which is why this cannot be fixed at the lock service.',
          nodes: ['new'],
          edges: ['l6'],
        },
        {
          id: 'ls4',
          title: 'The old holder resumes with stale knowledge',
          description:
            'Its last fact is "valid until t=30". A clock check could catch it, and requires a trustworthy clock and no pause between the check and the write — so it narrows the window rather than closing it.',
          nodes: ['stale'],
          edges: ['l7'],
        },
        {
          id: 'ls5',
          title: 'Only the resource can arbitrate',
          description:
            'Token 33 is rejected because 34 has been seen, checked atomically with the write. If the resource cannot do this, no lock service makes the operation safe and the answer is idempotency.',
          nodes: ['fence'],
          edges: ['l8', 'l9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'avoid-lock',
      title: 'Three ways to not need a lock, and when you actually do',
      caption:
        'Work down the left column before reaching the bottom. Most "we need a distributed lock" requirements are answered by one of the first three, and each removes the lease arithmetic entirely.',
      code: `flowchart TB
    Q1["Is repeating the work harmless?"] -->|Yes| A1["**Idempotency**<br/>Two holders is wasteful,<br/>not incorrect.<br/>Works even on resources<br/>that cannot be fenced"]
    Q1 -->|No| Q2["Can work be split so each<br/>worker owns disjoint keys?"]
    Q2 -->|Yes| A2["**Partitioned ownership**<br/>Exclusion is structural.<br/>Coordination moves from<br/>per-item to per-rebalance"]
    Q2 -->|No| Q3["Is it a single-resource<br/>state transition?"]
    Q3 -->|Yes| A3["**Conditional update**<br/>UPDATE ... WHERE version = ?<br/>Enforced at the point of<br/>effect, no lock service"]
    Q3 -->|No| Q4["Can the resource reject<br/>a stale fencing token?"]
    Q4 -->|No| A4["**No lock is safe.**<br/>Make it idempotent,<br/>or accept the risk<br/>explicitly"]
    Q4 -->|Yes| A5["**Lock + fencing**<br/>Do the lease arithmetic.<br/>Prefer coarse, long-held<br/>leadership over<br/>fine-grained locking"]

    style A1 fill:#17272a,stroke:#35897e
    style A2 fill:#17272a,stroke:#35897e
    style A3 fill:#17272a,stroke:#35897e
    style A4 fill:#2a1a1a,stroke:#a04848
    style A5 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: ['google'],
    body: `Chubby is the strongest available evidence for this lesson's central claim, because its authors shipped two separate mechanisms specifically because they knew a lease alone was unsafe — and then documented what users actually did with it.

**Mechanism one: sequencers.** A lock holder can request an opaque **sequencer** describing the lock's state, including a generation number. It passes the sequencer to the resource it is acting on, and the resource validates it — either against Chubby or against a cached view of the lock state.

That is a fencing token, and its existence in the original design tells you the authors did not consider a lease sufficient. **The paper is explicit that the mechanism exists because a client can be paused past its lease.**

**Mechanism two: lock delay.** If a lock holder's session ends abnormally rather than through a clean release, Chubby refuses to grant that lock to anyone for a configurable further period — up to a minute. The reasoning is direct: a holder that lost its session may not yet know, and a delay gives it time to notice before a replacement exists.

Two properties worth extracting: it is a **complement** to fencing, not a substitute, because it rests on a bound on how long a holder can be unaware; and it applies only to abnormal termination, so a clean release is immediate and the delay costs nothing in the normal case.

**Mechanism three, which is really a design choice: sessions rather than TTLs.** A Chubby lock is tied to a client session maintained by keep-alives. Expiry is decided by the **service** observing missing keep-alives, so no client clock is compared to any other. That removes clock skew from the safety argument entirely, which is the substantive difference from a TTL in a data store.

**And what users actually did with it — the most useful finding.** The paper reports that despite being built as a lock service, the dominant use was as a **name service**: small amounts of critical configuration, read constantly, cached by clients with invalidation. Locking, where used, was **coarse-grained and long-held** — "I am the primary" rather than "I am modifying this record".

**The transferable lessons.**

**If you build a lock service, build the fencing mechanism with it.** Adding it later means every existing caller is unsafe and nobody knows which.

**Session-based expiry is safer than TTL-based expiry**, because it removes clock comparison from the argument. That is the reason to prefer a consensus-backed coordination service over a TTL in a data store when safety matters.

**Coarse and long-held is the shape locks are good at.** Fine-grained locking puts consensus on the hot path and generates load proportional to application traffic. Coarse locks generate load proportional to failures.

**Where the model does not transfer.** Chubby assumes a consensus cluster you operate and clients that maintain sessions. For a moderate lock rate over a database you already run, a conditional update on a lock row gives you a monotonic token for free and is transactional with your other writes — simpler, and frequently the better engineering choice.`,
  },

  tradeoffs: {
    intro:
      'Two decisions: whether to need a lock at all, and if so which service. Rows are ordered roughly from "no lock" upward, which is the order to consider them.',
    rows: [
      {
        option: 'Idempotency instead of a lock',
        whenItWins:
          'Whenever repeating the work is harmless. No lock service, no lease arithmetic, and it works on resources that cannot be fenced at all.',
        whenItLoses:
          'When the effect is inherently non-repeatable — a sent message, a dispatched vehicle.',
        cost:
          'Designing the operation to be repeatable, plus wasted duplicate work when two workers proceed.',
      },
      {
        option: 'Partitioned ownership',
        whenItWins:
          'When work divides into disjoint keys. Exclusion is structural, and coordination moves from per-item to per-rebalance — thousands of acquisitions become one membership decision.',
        whenItLoses:
          'When work cannot be partitioned, or when a single item genuinely needs several workers.',
        cost:
          'A partitioning scheme, and reassignment on failure which still needs coordination.',
      },
      {
        option: 'Conditional update on the resource',
        whenItWins:
          'Single-resource state transitions. Enforcement at the point of effect by construction, with no lock service and no lease.',
        whenItLoses:
          'When exclusion must span several resources, or the resource offers no conditional write.',
        cost:
          'Retry on conflict, a version column, and checking the affected-row count.',
      },
      {
        option: 'Database lock row with a conditional update',
        whenItWins:
          'Moderate lock rates over a database you already run. Transactional with your other writes, and the incremented column is a fencing token for free.',
        whenItLoses:
          'At high acquisition rates, where row contention and polling become the bottleneck.',
        cost:
          'Load on the database, a cleanup concern, and lock availability tied to database availability.',
      },
      {
        option: 'Consensus-backed lock service with sessions',
        whenItWins:
          'When safety matters. Expiry is decided by the service observing heartbeats, so client clock skew is out of the safety argument.',
        whenItLoses:
          'When operating a consensus cluster is out of reach, or when its unavailability blocking acquisition is unacceptable.',
        cost:
          'A consensus cluster to run, and acquisition stops when it loses a majority — correctly.',
      },
      {
        option: 'TTL lock in a single data store',
        whenItWins:
          'Best-effort deduplication of expensive work, where a rare double-execution is tolerable and simplicity is worth a lot.',
        whenItLoses:
          'When correctness depends on it. Asynchronous replication means a store failover can lose the lock record entirely, giving two holders.',
        cost:
          'Reliance on the store\'s clock and the client\'s elapsed-time estimate, plus loss of the lock on failover.',
      },
      {
        option: 'Multi-store quorum TTL',
        whenItWins:
          'Better availability than a single store for a best-effort lock, when you have several independent stores anyway.',
        whenItLoses:
          'As a safety mechanism. Its validity argument requires bounded clock drift and bounded message delay, which are timing rather than failure assumptions.',
        cost:
          'Several stores to operate, contested timing assumptions, and still no substitute for fencing.',
      },
      {
        option: 'Lock delay after abnormal release',
        whenItWins:
          'As a complement to fencing. It gives a holder that lost its session time to notice before a replacement exists, at no cost on clean release.',
        whenItLoses:
          'As a substitute for fencing, since it rests on a bound on how long a holder can be unaware.',
        cost:
          'Failover is delayed by the configured period after an abnormal termination.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We renew the lease in a background thread every third of the lease duration, so it never expires."',
      whyWeak:
        'Renewal only runs while the process runs. A pause longer than the remaining margin means renewals do not happen and the lease expires with the holder unaware. And "one third" without stating the resulting pause tolerance means the safety argument is a number nobody computed.',
      strongAnswer:
        '"Renewal is arithmetic: lease duration must exceed the renewal interval plus worst-case renewal latency plus the pause I intend to tolerate. With a 15-second lease renewed every 5 and a 1-second round trip, I tolerate 9 seconds of pause — so I would check that against the measured p99.9 GC pause rather than assume it. And I would add a watchdog that terminates the process if a renewal has not succeeded within the lease duration."',
    },
    {
      weakAnswer: '"Before writing, the holder checks that it still owns the lock."',
      whyWeak:
        'The check and the write are not atomic, so a pause between them reproduces the problem. It also relies on the holder\'s clock, and a paused process has no reliable sense of elapsed time. The useful question is not "do I hold the lock" but "will my write be accepted".',
      strongAnswer:
        '"Checking before writing narrows the window and cannot close it — a pause can land between the check and the write. The safe form is a fencing token passed with the write and validated atomically by the resource, so the holder discovers it lost the lock at the moment that matters. If the resource cannot validate a token, no check makes it safe and the answer is idempotency."',
    },
    {
      weakAnswer: '"We use Redis with `SET key value NX EX 30` for our distributed lock."',
      whyWeak:
        'Fine as a best-effort deduplicator and unsafe as a correctness mechanism. It relies on the store\'s clock and the client\'s elapsed-time estimate, and because replication is asynchronous, a store failover can lose the lock record entirely — so two clients hold the same lock with no pause involved at all.',
      strongAnswer:
        '"That is a reasonable best-effort lock to avoid duplicate expensive work, and I would not rely on it for correctness. Two specific problems: the client estimates its own remaining lease against a pause it cannot measure, and asynchronous replication means a failover can lose the key so two clients hold it. If correctness matters I want session-based expiry from a consensus-backed service, plus fencing at the resource."',
    },
    {
      weakAnswer: '"On completion, the worker deletes the lock key to release it."',
      whyWeak:
        'If the lease expired and someone else acquired the lock, an unconditional delete releases *their* lock. So a slow worker finishing late can hand the lock to a third party while the second holder is still working — turning one bug into two.',
      strongAnswer:
        '"Release must be conditional on holder identity or token — delete only if the stored value is still mine, atomically. An unconditional delete can release a lock a new holder acquired, which is a second bug on top of the expiry. And if the release fails, the lock is held until expiry, which is another reason the lease duration is also a worst-case delay."',
    },
    {
      weakAnswer: '"We take a lock per record so workers can process different records in parallel."',
      whyWeak:
        'It puts a lock acquisition on the hot path, so lock-service load grows with application traffic. It also usually indicates the requirement is really ownership: if each worker handled a disjoint set of records, no two would ever contend and no lock would be needed.',
      strongAnswer:
        '"Per-record locking generates coordination load proportional to traffic, which is what makes lock services expensive. I would partition instead — assign each worker a set of keys by consistent hashing — so exclusion is structural and the only coordination is on rebalance. That turns thousands of acquisitions into one membership decision, and it is what most per-item lock requirements actually want."',
    },
    {
      weakAnswer: '"Making the lease longer removes the risk of a pause exceeding it."',
      whyWeak:
        'It reduces the probability and worsens failover: when a holder genuinely dies, nothing can proceed for up to the full lease duration. And any finite lease can be exceeded by a sufficiently long pause, so the argument is unchanged — only the odds move.',
      strongAnswer:
        '"A longer lease trades pause tolerance against failover time — a 60-second lease tolerates a long pause and means a dead leader blocks progress for a minute. It changes the probability rather than the argument, since any finite lease can be exceeded. So I would set it from measured pause data and rely on fencing for safety, while also attacking the pauses themselves through GC tuning and dedicated hosts."',
    },
  ],

  flashcards: [
    {
      id: 'fc-dl-1',
      front: 'What is a distributed lock, stated honestly?',
      back: 'A lease: permission to act until a deadline. The holder cannot be told when it expires, so it never knows it holds the lock — it knows it held it and is extrapolating.',
      topic: 'leases',
    },
    {
      id: 'fc-dl-2',
      front: 'What is the useful question instead of "do I hold the lock"?',
      back: '"Will my write be accepted." Only the second is answerable at the moment it matters, because a pause can land between a check and a write.',
      topic: 'fencing',
    },
    {
      id: 'fc-dl-3',
      front: 'What is the lease-renewal inequality?',
      back: '`lease_duration > renewal_interval + max_renewal_latency + pause_tolerance`. Pick three and the fourth is determined.',
      topic: 'leases',
    },
    {
      id: 'fc-dl-4',
      front: 'What else is the lease duration, besides pause tolerance?',
      back: 'Your failover time. When a holder dies, nothing can proceed for up to the full lease duration — so it is a direct trade.',
      topic: 'leases',
    },
    {
      id: 'fc-dl-5',
      front: 'Where should renewal interval and pause tolerance come from?',
      back: 'Measured p99.9 values — renewal round-trip latency and process pause duration, including hypervisor steal time. Not defaults or assumptions.',
      topic: 'clock-skew',
    },
    {
      id: 'fc-dl-6',
      front: 'What does a watchdog on renewal failure buy?',
      back: 'It cannot run during a pause, and it runs before application code on resume — converting "silently continue as a stale holder" into "crash and restart".',
      topic: 'leases',
    },
    {
      id: 'fc-dl-7',
      front: 'Why is session-based expiry safer than TTL-based?',
      back: 'The service decides expiry by observing missing heartbeats, so no client clock is compared to any other — clock skew leaves the safety argument entirely.',
      topic: 'clock-skew',
    },
    {
      id: 'fc-dl-8',
      front: 'Why can a store failover give two lock holders with no pause involved?',
      back: 'Asynchronous replication can lose the lock record on failover, so the key vanishes and a second client acquires it while the first still holds its lease.',
      topic: 'locks',
    },
    {
      id: 'fc-dl-9',
      front: 'What is the objection to a multi-store quorum TTL lock?',
      back: 'Its validity argument requires bounded clock drift and bounded message delay — timing assumptions rather than failure assumptions — and it is not a substitute for fencing.',
      topic: 'clock-skew',
    },
    {
      id: 'fc-dl-10',
      front: 'What is a lock delay, and what does it complement?',
      back: 'Refusing to grant a lock for a period after an abnormal session end, so a holder that lost its session can notice first. It complements fencing and rests on a bound on unawareness.',
      topic: 'fencing',
    },
    {
      id: 'fc-dl-11',
      front: 'Which resources cannot be fenced?',
      back: 'Anything with no conditional write on a monotonic token — a plain filesystem, most third-party APIs. Then no lock makes the operation safe; the answer is idempotency.',
      topic: 'fencing',
    },
    {
      id: 'fc-dl-12',
      front: 'Why is a database lock row underrated?',
      back: 'It is transactional with your other writes, the incremented column is a fencing token for free, and you already run the database.',
      topic: 'locks',
    },
    {
      id: 'fc-dl-13',
      front: 'What does partitioned ownership do to coordination cost?',
      back: 'Moves it from per-item to per-rebalance. Thousands of lock acquisitions become one membership decision, and exclusion becomes structural.',
      topic: 'ownership',
    },
    {
      id: 'fc-dl-14',
      front: 'Why must release be conditional?',
      back: 'An unconditional delete can release a lock a new holder acquired after your lease expired — turning one bug into two.',
      topic: 'locks',
    },
  ],

  quiz: [
    {
      id: 'q-dl-1',
      kind: 'scenario',
      prompt:
        'A 15-second lease is renewed every 5 seconds, with a 1-second renewal round trip. How long a process pause does this design tolerate?',
      options: [
        { id: 'a', label: 'About 9 seconds — lease duration minus the renewal interval minus the renewal latency' },
        { id: 'b', label: '15 seconds, the full lease duration' },
        { id: 'c', label: '5 seconds, the renewal interval' },
        { id: 'd', label: 'Unbounded, since renewal runs in a background thread' },
      ],
      correct: ['a'],
      explanation:
        'The margin is what remains of the lease after the last successful renewal plus the time needed for the next one to complete. Writing this inequality down is the whole point: it forces you to compare 9 seconds against your measured p99.9 pause, which is where a 20-second GC pause becomes visible as a design flaw rather than a surprise.',
      difficulty: 'core',
      topic: 'leases',
    },
    {
      id: 'q-dl-2',
      kind: 'scenario',
      prompt:
        'A lock holder checks with the lock service that it is still the holder immediately before writing. Is this safe?',
      options: [
        { id: 'a', label: 'No — the check and the write are not atomic, so a pause between them reproduces the problem; only the resource validating a token atomically with the write is safe' },
        { id: 'b', label: 'Yes, provided the check is within the lease period' },
        { id: 'c', label: 'Yes, if the clocks are synchronised via NTP' },
        { id: 'd', label: 'Yes, provided the check uses a strongly consistent read' },
      ],
      correct: ['a'],
      explanation:
        'A check-then-write is not atomic, and a pause can land between them regardless of how strongly consistent the check was. Clock synchronisation does not help because the problem is elapsed time during a pause the process cannot measure. The question to answer is "will my write be accepted", and only the resource can answer it.',
      difficulty: 'core',
      topic: 'fencing',
    },
    {
      id: 'q-dl-3',
      kind: 'scenario',
      prompt:
        'A lock is implemented as a Redis key with `SET NX EX 30`, on a primary with an asynchronous replica. The primary fails over. What can happen with no pause involved?',
      options: [
        { id: 'a', label: 'The lock key may not have replicated, so it vanishes and a second client acquires it while the first still holds its lease' },
        { id: 'b', label: 'Nothing — the lock is re-created on the new primary' },
        { id: 'c', label: 'The lock is held indefinitely because the TTL is lost' },
        { id: 'd', label: 'The failover blocks until all locks are released' },
      ],
      correct: ['a'],
      explanation:
        'Asynchronous replication means a recently-set key may not exist on the promoted replica. This gives two holders without any process pause, garbage collection, or clock issue — it is a plain consequence of the replication model, and it is why a TTL lock in a single store is best-effort rather than safe.',
      difficulty: 'advanced',
      topic: 'locks',
    },
    {
      id: 'q-dl-4',
      kind: 'scenario',
      prompt:
        'A worker finishes late, after its lease expired and a second worker acquired the lock. It runs `DEL lock:job42` to release. What happens?',
      options: [
        { id: 'a', label: 'It releases the second worker\'s lock, so a third worker can acquire it while the second is still working' },
        { id: 'b', label: 'Nothing, since the key it set has already expired' },
        { id: 'c', label: 'The delete fails because it no longer owns the key' },
        { id: 'd', label: 'The second worker is notified that its lock was released' },
      ],
      correct: ['a'],
      explanation:
        'An unconditional delete removes whatever key is there, including one a new holder set. This turns one bug into two, and nothing notifies the second holder. Release must be conditional on the stored holder identity or token, checked atomically with the delete.',
      difficulty: 'core',
      topic: 'locks',
    },
    {
      id: 'q-dl-5',
      kind: 'scenario',
      prompt:
        'A team needs to ensure each of a million records is processed by one worker. They propose a lock per record. What is the better approach and why?',
      options: [
        { id: 'a', label: 'Partitioned ownership — assign each worker a disjoint key range, so exclusion is structural and coordination happens only on rebalance' },
        { id: 'b', label: 'One coarse lock over all records, held by a single worker' },
        { id: 'c', label: 'A lock per record, but with a longer lease to reduce contention' },
        { id: 'd', label: 'Two-phase commit across the workers' },
      ],
      correct: ['a'],
      explanation:
        'Per-record locking generates coordination load proportional to application traffic, which is what makes lock services expensive and fragile. Partitioning makes exclusion a property of the assignment rather than of a runtime check, and the only coordination left is the rebalance — one decision instead of a million.',
      difficulty: 'core',
      topic: 'ownership',
    },
    {
      id: 'q-dl-6',
      kind: 'multi',
      prompt:
        'Which statements about lengthening the lease duration are correct? Select all that apply.',
      options: [
        { id: 'a', label: 'It increases pause tolerance' },
        { id: 'b', label: 'It increases failover time when a holder genuinely dies' },
        { id: 'c', label: 'It increases the worst-case delay when a release fails' },
        { id: 'd', label: 'It makes the design safe, since a long enough lease cannot be exceeded' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the real consequences, and they are why lease duration should come from measured pause data rather than a default. The fourth is the error: any finite lease can be exceeded by a sufficiently long pause, so lengthening it changes the probability and not the argument. Safety requires fencing.',
      difficulty: 'core',
      topic: 'leases',
    },
  ],

  exercises: [
    {
      id: 'ex-dl-1',
      kind: 'design',
      title: 'Do the arithmetic, then remove the lock',
      estimatedMinutes: 30,
      prompt: `Five requirements. For each: decide whether a lock is needed, and if so specify the lock service, the lease arithmetic with concrete numbers, and the fencing mechanism. If not, say what replaces it.

1. One instance must be the schema-migration coordinator. Migrations take up to 20 minutes.
2. A nightly aggregation job must not run twice concurrently. It takes 40 minutes and writes to a database.
3. A million user records must each be reprocessed exactly once by a fleet of 30 workers.
4. A file in an object store must be updated by one writer at a time. Updates take 2 seconds.
5. An expensive report — 90 seconds of CPU — should not be generated twice if two users request it simultaneously.

Then answer:

- Which of the five is genuinely unsafe with any lock, and what do you do?
- Your JVM's p99.9 GC pause is measured at 4 seconds. How does that change your numbers?
- Requirement 1's lease must cover a 20-minute migration. What are the consequences?
- Where would you accept a best-effort lock and say so explicitly?`,
      rubric: [
        'Requirement 1: consensus-backed lock with fencing on the schema-version table; addresses the long lease.',
        'Requirement 2: identifies that a long-running job needs renewal, not a long lease, plus fencing or idempotency.',
        'Requirement 3: partitioned ownership rather than per-record locks.',
        'Requirement 4: conditional put on a generation number or ETag — no lock service.',
        'Requirement 5: best-effort lock, stated as such, with correctness independent of it.',
        'Lease arithmetic given with concrete numbers, not just the formula.',
        'Identifies which resources can and cannot be fenced.',
        'GC-pause answer recomputes at least one lease from the 4-second figure.',
        'Long-lease answer names failover time and release-failure delay as the costs.',
        'Best-effort answer states what makes the design correct when the lock fails.',
      ],
      modelAnswer: `**1. Schema-migration coordinator — LOCK NEEDED, consensus-backed, with fencing**

*Why a lock:* two coordinators running conflicting DDL is close to unrecoverable, and migrations are the least idempotent thing in most systems. This is the case locks are genuinely for: coarse, rare, long-held leadership.

*Lock service:* a consensus-backed coordination service with **session-based expiry**. I want the service to decide expiry by observing missing heartbeats rather than comparing clocks, because the stakes here justify removing clock skew from the safety argument entirely.

*Lease arithmetic:*

\`\`\`
renewal_interval        = 5 s
max_renewal_latency     = 1 s   (p99.9 round trip)
pause_tolerance         = 9 s   (see the GC question below)
lease_duration          = 5 + 1 + 9 = 15 s
\`\`\`

**Crucially, the lease is 15 seconds and the migration takes 20 minutes.** Those are different things, and conflating them is the mistake I would expect. The lease is renewed continuously throughout the migration; it does not need to cover its duration. What must cover the duration is **continuous successful renewal**, and a renewal failure mid-migration is an event the design must handle.

*Fencing:* the coordinator's term is written to a \`schema_migrations\` row, and every DDL step is preceded by a conditional update:

\`\`\`sql
UPDATE schema_state SET coordinator_term = :term
 WHERE coordinator_term <= :term;
-- if 0 rows updated, a newer coordinator exists: abort immediately
\`\`\`

*What happens on renewal failure mid-migration:* the watchdog terminates the process. A half-applied migration is bad and a **concurrently-applied** migration is worse, so aborting is correct. This means migrations must be written to be resumable or safely re-runnable from a recorded step, which is a requirement the lock design imposes on the migration tooling — worth stating explicitly rather than discovering.

**2. Nightly aggregation, 40 minutes — LOCK, and the interesting part is what the lock does not do**

*Why a lock:* running the aggregation twice concurrently would double database load and, depending on the writes, could produce wrong results.

*Lock service:* a **database lock row**, which I prefer here for three reasons: the job already talks to this database, the row's incremented column gives me a fencing token for free, and the lock is transactional with the job's own writes.

\`\`\`sql
UPDATE job_locks
   SET holder = :instance, token = token + 1, expires_at = now() + interval '30 seconds'
 WHERE name = 'nightly_aggregation'
   AND (holder IS NULL OR expires_at < now())
RETURNING token;
-- 0 rows: someone else holds it
\`\`\`

*Lease arithmetic:* 30-second lease, renewed every 10 seconds, so ~19 seconds of pause tolerance. Renewal is an \`UPDATE ... WHERE holder = :instance\` that also extends \`expires_at\`.

*Fencing:* the aggregation's output writes carry the token, and the target tables reject a lower one. Concretely, the aggregation writes to \`daily_aggregates\` with a \`writer_token\` column and a \`WHERE writer_token <= :token\` guard.

*But the more important design decision:* **make the aggregation idempotent regardless.** Write each day's aggregate with a natural key \`(date, metric)\` and a unique constraint, so a second run overwrites identical values rather than double-counting. Then the lock is preventing *wasted work*, not preventing *incorrectness* — and a lock failure costs CPU rather than data.

That reframing is what I would want to be judged on. **A 40-minute job under a lease is a long exposure**, and building idempotency means a lease failure is not an incident.

**3. A million records, 30 workers, exactly once — NO LOCK. Partitioned ownership.**

*Why not locks:* a lock per record means a million acquisitions, so coordination load is proportional to the work rather than to failures. It would make the lock service the bottleneck and the most fragile component in the design.

*What replaces it:*

\`\`\`
worker i processes records where hash(user_id) % 30 == i
\`\`\`

Exclusion is structural: no two workers ever consider the same record, so there is nothing to exclude.

*The coordination that remains:* worker membership. Which workers are alive, and therefore what the divisor and each worker's index are. That is **one** consensus decision per membership change, and it is exactly the shape from the consensus lesson — use consensus to decide who decides.

*The failure to design for:* a worker dies mid-range and its records are unprocessed. Options: rebalance to 29 workers and reprocess its range (needs the work to be idempotent, or a per-record completion marker), or leave the range for a subsequent pass.

**I would do both: a per-record completion marker plus rebalancing.** \`UPDATE records SET processed_at = now() WHERE id = ? AND processed_at IS NULL\` means reprocessing is safe and the marker makes progress visible. Then a rebalance is trivially correct because already-processed records are skipped.

*Note what happened:* the "exactly once per record" requirement was met with **no lock and no lock service** — a partition function plus a conditional update. That is the outcome the decision tree is designed to reach.

**4. Object-store file, single writer — NO LOCK. Conditional put.**

*Why not a lock:* the resource itself supports conditional writes. An object store's conditional put on an ETag or generation number *is* mutual exclusion, enforced at the point of effect, with no lease and no lock service.

\`\`\`
read object → ETag "abc123"
modify locally
PUT with If-Match: "abc123"
  → 200: you won
  → 412: someone else wrote; re-read and retry
\`\`\`

*Why this is strictly better than a lock:* fewer components, no lease arithmetic, no clock assumptions, and no window at all. A paused writer that resumes and puts with a stale ETag is rejected — **which is fencing, provided natively by the resource.**

*What it does not give you:* fairness or queuing. Under heavy contention, writers retry and one may be starved. If that mattered I would add a queue in front — but with 2-second updates and presumably low contention, optimistic retry is correct and simple.

**5. Expensive report, 90 seconds — BEST-EFFORT LOCK, stated as such**

*Why a lock at all:* generating the same report twice wastes 90 seconds of CPU. Worth avoiding, and not worth much complexity.

*Why best-effort is correct:* the consequence of the lock failing is **duplicate work**, not incorrectness — provided the output is written to a deterministic address, \`reports/{report_id}.pdf\`, so a duplicate overwrites identical content.

*So the design:*

\`\`\`
1. Check whether reports/{id}.pdf exists → serve it
2. Try to acquire a TTL lock on report:{id}, 150 seconds
   - acquired  → generate, write to the deterministic key, release
   - not acquired → poll for the object, or return "generating"
\`\`\`

*Lock service:* a plain TTL in a data store. Simple, and its failure modes — a lost key on failover, a pause past the TTL — cost a duplicate generation.

*What I would say out loud:* **"this lock is best-effort; correctness comes from the deterministic output key."** That sentence is the difference between a considered design and an unsafe one, because it states which component is load-bearing. If someone later changes the output to a random filename, they have broken the correctness argument, and the comment is what tells them.

---

**Which requirement is genuinely unsafe with any lock?**

**None of them, as designed — and that is the point of working through them.** Every one was resolved into something safe:

- 1 and 2: fenceable, because the resource is a database with a token column.
- 3: no exclusion needed; partitioning plus a conditional update.
- 4: the resource fences itself natively.
- 5: idempotent output, so the lock is an optimisation.

**The requirement that *would* be unsafe** is any variant where the effect is irreversible and unfenceable. Concretely: if requirement 2's aggregation also **sent an email summary**, that email is neither fenceable nor idempotent. A lock would not make it safe, because the paused holder can resume and send after a second holder already did.

*What I would do there:* a dedup record for the email keyed \`(date, 'summary')\`, written transactionally with the aggregation and checked before sending. That is the delivery-semantics lesson's mechanism, and it is the answer whenever the resource cannot participate. **The lock is not made safe; the effect is made idempotent instead.**

**A measured 4-second p99.9 GC pause changes the numbers**

My original 9-second pause tolerance was a guess. With a measured 4-second p99.9, the honest position is that **p99.9 is not the tail I should design to** — a p99.99 or p99.999 pause could be far longer, and a pause that occurs once in ten thousand renewals will occur within days at a 5-second interval.

So I would size for meaningfully above the measured p99.9:

\`\`\`
Requirement 1 (migration coordinator):
  pause_tolerance    = 20 s        (5× the measured p99.9)
  renewal_interval   = 5 s
  renewal_latency    = 1 s
  lease_duration     = 26 s  →  round to 30 s

Requirement 2 (aggregation):
  pause_tolerance    = 20 s
  renewal_interval   = 10 s
  renewal_latency    = 1 s
  lease_duration     = 31 s  →  round to 45 s
\`\`\`

*The consequence to state:* failover for the migration coordinator is now up to 30 seconds instead of 15. **That is an acceptable price for a role that changes hands a few times a year**, and it would be a bad price for something needing fast failover — which is exactly the trade the arithmetic makes visible.

*And the more valuable response:* **attack the pauses.** A 4-second p99.9 pause is high. Options: tune the collector, reduce heap pressure in the coordinator process specifically, run the coordinator on a dedicated host to eliminate hypervisor steal time, or move the coordinator to a runtime without stop-the-world pauses. Halving the pause halves the lease and therefore halves the failover time — **improving both sides of the trade at once**, which lengthening the lease cannot do.

**Requirement 1's lease covering a 20-minute migration**

This is the misconception I flagged earlier, and it is worth being explicit about because it produces bad designs.

**The lease does not need to cover the migration.** It needs to be *continuously renewed* for the migration's duration. A 30-second lease renewed every 5 seconds covers 20 minutes perfectly well — it just requires 240 successful renewals.

*What if someone did set a 20-minute lease?* Three costs, all bad:

**Failover becomes 20 minutes.** If the coordinator dies one minute in, nothing can happen for 19 more minutes. During a migration window that is likely to be an incident.

**A failed release means a 20-minute wait.** If the process crashes after finishing without releasing cleanly, the lock is held until expiry.

**Pause tolerance becomes enormous and useless.** Tolerating a 20-minute pause protects against nothing real, because a process paused for 20 minutes should be terminated rather than allowed to resume.

*So: short lease, continuous renewal, and a watchdog.* The migration's length affects the **exposure** — 240 renewals is 240 chances for one to fail — which is the real consequence and the reason migrations must be resumable.

*One thing I would add for a 20-minute operation:* a **lock delay** after abnormal release, of say 60 seconds. If the coordinator dies mid-migration, giving the old process a minute to notice and exit before a replacement starts substantially reduces the overlap window. It complements the fencing rather than replacing it, and for an operation this consequential I want both.

**Where I accept a best-effort lock, and say so**

**Requirement 5, the report**, as designed above — and the discipline is in the saying.

The pattern I would follow anywhere a best-effort lock is used:

1. **A comment at the lock site** naming what makes the design correct without the lock: *"best-effort; correctness comes from the deterministic output key at reports/{id}.pdf"*.
2. **A test that passes with the lock disabled.** If the correctness argument is real, the test proves it — and it prevents someone later depending on the lock for correctness.
3. **A metric on duplicate executions**, so if the lock is failing more than expected I find out. A best-effort lock failing 40% of the time is a different situation from one failing 0.1% of the time, and only a metric distinguishes them.

*Where I would refuse a best-effort lock:* anywhere the failure is unrecoverable — a charge, a migration, a dispatch. **"Best-effort" is only acceptable when you can state the cost of it failing in one sentence**, and if that sentence is uncomfortable, the answer is fencing or idempotency rather than a longer lease.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-dl-1',
      level: 'basic',
      question: 'What is a distributed lock, and why is it harder than a mutex?',
      guidance:
        'A lease with a deadline, where the holder cannot be told of expiry. Look for the recognition that it is advisory and time-bounded, rather than enforced by a runtime.',
    },
    {
      id: 'iq-dl-2',
      level: 'basic',
      question: 'How would you set a lease duration and renewal interval?',
      guidance:
        'The inequality: lease exceeds renewal interval plus renewal latency plus pause tolerance. A strong answer sources pause tolerance from measured data and notes the lease is also the failover time.',
    },
    {
      id: 'iq-dl-3',
      level: 'intermediate',
      question: 'Why do lock services differ in safety, and what is the axis?',
      guidance:
        'Whose clock decides expiry. Session heartbeats let the service decide with no clock comparison; a TTL relies on the store\'s clock plus the client\'s elapsed-time estimate. Strong answers also name asynchronous replication losing a lock on failover.',
    },
    {
      id: 'iq-dl-4',
      level: 'intermediate',
      question: 'What must a resource support for fencing to work?',
      guidance:
        'A persisted highest-seen monotonic token, checked atomically with the write. A strong answer names resources that cannot do this and concludes that idempotency is the answer there.',
    },
    {
      id: 'iq-dl-5',
      level: 'advanced',
      question: 'A team wants a lock per record across a million records. What do you propose?',
      guidance:
        'Partitioned ownership, so exclusion is structural and coordination moves from per-item to per-rebalance. Excellent answers add a per-record completion marker so rebalancing is safe.',
    },
    {
      id: 'iq-dl-6',
      level: 'advanced',
      question: 'Your job takes 40 minutes. How long is the lease?',
      guidance:
        'Short — 30 to 45 seconds — with continuous renewal. The lease need not cover the job. Excellent answers name the three costs of a long lease and make the job idempotent so a lease failure is not an incident.',
    },
    {
      id: 'iq-dl-7',
      level: 'followup',
      question: 'You measured a 4-second p99.9 pause. Now what?',
      guidance:
        'Size well above it, since a p99.99 pause will occur within days at a 5-second renewal interval. And attack the pauses — halving them halves both the lease and the failover time, which lengthening the lease cannot do.',
    },
    {
      id: 'iq-dl-8',
      level: 'followup',
      question: 'When is a best-effort lock acceptable, and how do you keep it honest?',
      guidance:
        'When you can state the cost of its failure in one sentence. Keep it honest with a comment naming what provides correctness, a test that passes with the lock disabled, and a metric on duplicate executions.',
    },
  ],

  activeLearning: [
    {
      id: 'al-dl-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed the lock protects a resource you can reach. Now change one thing: the lock protects a physical action — a robot arm, a valve, a printer. What survives, and what has to be designed completely differently?',
      discussion: `This is where the lesson's assumptions become visible, because the physical world does not implement conditional writes.

**What survives unchanged.**

**The lease arithmetic.** Renewal interval, renewal latency and pause tolerance combine exactly as before, and the lease duration is still also the failover time. If anything it matters more, because a stale holder here does something physical.

**The preference for coarse, long-held leases.** One controller per machine, held for hours, is the right shape.

**The watchdog.** Terminating on renewal failure is *more* valuable here, because a controller that cannot confirm its authority should stop commanding hardware.

**What has to be designed completely differently.**

**Fencing does not exist, and cannot be retrofitted.** A robot arm has no highest-seen-token register. It receives a command and moves. A stale controller's command is executed, and there is no equivalent of a 412 response. **The single mechanism this lesson identified as the only safe one is unavailable.**

**Idempotency is a different concept physically.** "Move to position X" is idempotent in a useful sense: executing it twice leaves the arm at X. "Move 10 cm right" is not, and executing it twice is a collision. **So absolute commands rather than relative ones is not a stylistic preference here — it is the safety property**, and it is the direct analogue of the absolute-state-plus-version technique from the delivery-semantics lesson.

**The resource needs its own safety interlock.** Since it cannot fence, it must protect itself: a hardware watchdog that halts if it has not received a valid heartbeat within a short window. Then a stale controller's commands stop being executed because the hardware has already stopped — the protection moves into the device, which is the same principle as fencing at the resource, implemented in the only way physics allows.

**Failure is not reversible.** A rejected database write costs nothing. A collision costs a machine. So the acceptable probability of two holders is orders of magnitude lower, which changes the arithmetic: a lease sized for a p99.9 pause is nowhere near adequate when the failure is destructive.

**And a new mechanism appears: the physical interlock.** Two controllers cannot both actuate a valve if the valve is behind a single hardware permissive that only one holds. This is exclusion enforced by physics rather than by software, and where available it is stronger than anything in this lesson — because it does not depend on any timing assumption.

**What I would actually design.**

1. **A hardware watchdog on the device**, with a short timeout — hundreds of milliseconds. This is the real safety mechanism, and everything else is a convenience layer above it.
2. **Absolute commands only.** No relative motion, ever, so a duplicated command is harmless.
3. **A consensus-backed lease with session heartbeats** for controller leadership, sized well above measured pauses, with a watchdog that halts the controller.
4. **A physical interlock** where the mechanism allows.
5. **Explicit acceptance that software alone is insufficient**, stated in the design document rather than implied.

**The transferable point, which applies well beyond robots.** This lesson's conclusion — enforcement must be at the resource — is not a software pattern. It is a general principle about where authority is checked, and its software form (a fencing token) is one implementation. When the resource cannot check, you either give it the ability to protect itself, or you make the action harmless to repeat. **Those are the only two options, and a lock is never one of them.**`,
    },
    {
      id: 'al-dl-2',
      kind: 'debug',
      prompt:
        'A leader-elected service shows leadership changing hands roughly every 20 minutes. The consensus cluster is healthy, network monitoring shows no loss, and each transition takes about 15 seconds during which writes fail. Hypotheses?',
      discussion: `Leadership changes every 20 minutes with a healthy cluster means the lease is expiring without the leader dying. So either renewals are not being sent, are not arriving, or are not being processed in time — and the ~20-minute periodicity is the strongest clue, because it suggests something scheduled or accumulating.

**Hypothesis 1 — process pauses exceeding the renewal margin.** A garbage-collection pause, or hypervisor steal time, longer than the lease's remaining margin. A 20-minute period is consistent with a major collection cycle on a heap that fills at a steady rate.

*Why it fits:* the cluster is healthy because nothing is wrong with it — the leader simply stopped executing. And the periodicity tracks allocation rate rather than anything about the cluster.

*Check:* per-process pause durations against the computed renewal margin, and whether transition timestamps fall inside pauses on the outgoing leader. **Check the outgoing leader, not the current one** — the failing process is the one that lost leadership, and looking at the current leader is the mistake that makes this take a day.

**Hypothesis 2 — the renewal margin is far smaller than anyone thinks.** If the lease is 10 seconds, renewal is every 5, and the p99.9 round trip to the cluster is 2 seconds, the margin is 3 seconds. Any pause or latency spike above 3 seconds loses leadership. This is not a bug in anything; it is arithmetic nobody did.

*Why it fits:* it explains why a "healthy" cluster still loses leases — health is measured as availability, not as p99.9 latency.

*Check:* compute the inequality with measured numbers. If the margin is single-digit seconds and the p99.9 pause is comparable, this is the answer and it needs no further investigation.

**Hypothesis 3 — the renewal is on the same thread or event loop as request handling.** If a burst of slow requests blocks the loop, renewals queue behind them. Periodicity would then follow traffic patterns rather than anything internal.

*Why it fits:* it explains transitions with a healthy cluster and no pauses, and it is a very common implementation error — renewal placed in application code rather than on a dedicated thread.

*Check:* whether the renewal path shares a thread pool or event loop with request handling, and whether transitions correlate with request-latency spikes.

**Hypothesis 4 — a 20-minute scheduled task on the leader.** A periodic flush, a metrics aggregation, a certificate reload, a log rotation — something that runs every 20 minutes on the leader and blocks it. The exact periodicity points strongly at a schedule rather than at accumulation.

*Why it fits best:* 20 minutes is a suspiciously round interval. Accumulating pressure gives a drifting period; a schedule gives a fixed one. **If the interval is consistently 20 minutes rather than roughly 20, this is the leading hypothesis.**

*Check:* the leader's scheduled tasks, and whether transitions align to a clock boundary.

**Hypothesis 5 — the transitions are not failures at all, but a rebalancer.** Some systems deliberately move leadership for load distribution. Then a 15-second write outage per transition is a configuration problem rather than a fault.

*Check:* whether the consensus layer or an operator has leadership rebalancing enabled.

**What I would check first: the exact intervals between transitions.** If they are tightly clustered at 20 minutes, this is a schedule (hypothesis 4). If they vary between 12 and 30 minutes, it is accumulation (hypothesis 1). **One query over the transition log, and it splits the space decisively** — this is a case where the shape of the timing is more informative than any single metric.

**Then: compute the renewal inequality with measured p99.9 numbers** (hypothesis 2), because it is arithmetic rather than investigation and it frequently turns out to be the whole answer.

**The 15-second transition, which is a second finding.** Even if the leases were expiring for a good reason, 15 seconds of failed writes per transition is worth attacking separately:

- **The lease duration sets a floor on it.** A 15-second transition suggests a lease around 15 seconds, since a new leader cannot be elected until the old lease expires.
- **A clean handoff would avoid most of it.** If the outgoing leader releases explicitly rather than letting the lease lapse, the successor can take over in a round trip instead of a lease duration. Worth building specifically because it also makes planned restarts cheap.
- **Writes need not fail during the gap.** Buffering briefly, or returning a retryable error with a short \`Retry-After\`, converts a hard failure into a delay. Whether that is acceptable depends on the operation.

**The fixes, in order.**

**Compute the inequality and fix the numbers**, with pause tolerance sized well above the measured p99.9 rather than at it.

**Move renewal to a dedicated thread** that does nothing else, so application load cannot delay it.

**Add a watchdog** that terminates on renewal failure. This does not prevent the transitions and it prevents the much worse failure the transitions are currently risking — a stale leader that resumes and writes.

**Verify fencing actually works.** Twenty transitions a day means twenty windows where two processes believe they lead. If fencing is absent or untested, this incident has probably already produced silent data problems, and **the transitions are the symptom that matters least.** I would check the fencing before optimising the lease.

**Transferable:** frequent leader elections in a healthy cluster are nearly always the renewal margin being smaller than the environment's tail latency — and the margin is a number that exists only if someone computed it. **The generalisation is the one from the load-balancing lesson: every timeout in a distributed system is a bet about tail latency, and a bet nobody wrote down is a bet nobody sized.**`,
    },
  ],

  revision: {
    bullets: [
      'A distributed lock is a lease: permission until a deadline, and the holder cannot be told when it expires.',
      'A holder never knows it holds the lock — it knows it held it and is extrapolating.',
      'The useful question is "will my write be accepted", not "do I hold the lock".',
      '`lease_duration > renewal_interval + max_renewal_latency + pause_tolerance`. Pick three; the fourth follows.',
      'The lease duration is also your failover time and your worst-case delay after a failed release.',
      'Size pause tolerance well above the measured p99.9 pause, including hypervisor steal time.',
      'Attacking pauses improves both sides of the trade; lengthening the lease only moves the odds.',
      'A watchdog that terminates on renewal failure converts a stale holder into a restart.',
      'Session-based expiry is safer than TTL-based: the service decides, so no clocks are compared.',
      'Asynchronous replication can lose a lock on failover, giving two holders with no pause involved.',
      'A multi-store quorum TTL rests on bounded clock drift and message delay — timing, not failure, assumptions.',
      'A lock delay after abnormal release complements fencing; it rests on a bound on unawareness.',
      'A database lock row is underrated: transactional with your writes, and a fencing token for free.',
      'Release must be conditional on holder identity, or you release a new holder\'s lock.',
      'A resource that cannot reject a stale token cannot be fenced; then the answer is idempotency.',
      'Partitioned ownership moves coordination from per-item to per-rebalance and makes exclusion structural.',
      'A long-running job needs continuous renewal, not a long lease.',
      'Locks are good at coarse, long-held leadership; fine-grained locking puts coordination on the hot path.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A time-bounded lease granting permission to act, renewed by the holder and expired by the service — advisory unless the protected resource validates a monotonic token issued with the grant.',
    whyItExists:
      'Because some operations are neither idempotent nor partitionable, and a single actor must be designated — which requires a mechanism that survives the designated actor becoming unreachable.',
    whenToUse: [
      'Coarse, long-held leadership: "I am the primary for this shard", held for hours.',
      'Serialising a non-idempotent, non-partitionable operation over a fenceable resource.',
      'Preventing wasteful duplicate work, when correctness does not depend on it.',
    ],
    whenNotToUse: [
      'When repeating the work is harmless — use idempotency.',
      'When work divides into disjoint keys — use partitioned ownership.',
      'For single-resource state transitions — use a conditional update.',
      'When the resource cannot reject a stale token, since no lock is safe there.',
      'Per-item at high rates, which puts coordination load proportional to traffic on the hot path.',
    ],
    alternatives: [
      'Idempotency, which dissolves the requirement.',
      'Partitioned ownership by consistent hashing or explicit assignment.',
      'A conditional update or conditional put, enforcing exclusion at the point of effect.',
      'A completion marker per item, making reprocessing safe and progress visible.',
      'A physical or hardware interlock, where the resource is not software.',
    ],
    tradeoffs: [
      'A longer lease buys pause tolerance and costs failover time and post-crash delay.',
      'Session-based expiry buys freedom from clock skew and costs a consensus cluster.',
      'A TTL in a data store buys simplicity and costs safety on failover and under pauses.',
      'Fine-grained locks buy parallelism and cost coordination load proportional to traffic.',
      'A lock delay buys a narrower overlap window and costs slower failover after abnormal termination.',
      'A best-effort lock buys simplicity and requires correctness to come from somewhere else.',
    ],
    failureModes: [
      'A pause exceeding the renewal margin, producing two holders with no fault anywhere.',
      'A renewal margin smaller than the environment\'s tail latency, causing frequent leadership churn.',
      'Renewal sharing a thread or event loop with request handling, so load delays it.',
      'A check-then-write, where a pause lands between the check and the write.',
      'An unconditional release deleting a new holder\'s lock.',
      'A store failover losing the lock record under asynchronous replication.',
      'A long lease set to cover a long job, making failover as long as the job.',
      'A resource with no token validation, making the lock advisory in fact while treated as safe.',
      'Fencing added after callers exist, so nobody knows which callers are unsafe.',
      'Per-item locking making the lock service the system\'s bottleneck.',
    ],
    followUpQuestions: [
      'Could idempotency, partitioned ownership, or a conditional update remove this lock?',
      'What is your lease duration, renewal interval, renewal latency, and therefore pause tolerance?',
      'What is your measured p99.9 process pause, including hypervisor steal?',
      'Is renewal on a dedicated thread, or can application load delay it?',
      'Can the protected resource reject a stale token, atomically with the write?',
      'Is release conditional on holder identity?',
      'Whose clock decides expiry — the service\'s, or a comparison between clients?',
      'What happens to the lock when the lock store fails over?',
      'If this lock is best-effort, what provides correctness, and is there a test for it?',
    ],
  },
});
