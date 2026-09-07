import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-replication-basics',
  title: 'Replication and read scaling',
  summary:
    'Read replicas move the problem rather than solving it: you trade a capacity limit for replication lag, and lag is now your correctness problem rather than the database vendor\'s.',
  phase: 'foundations',
  module: 'databases',
  position: 18,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['replication', 'replication-lag', 'read-scaling', 'failover', 'availability'],
  prerequisites: ['f-transactions'],
  resources: [
    {
      key: 'postgres-replication',
      tier: 'must',
      note: 'Chapter 26 covers streaming replication, synchronous options and failover mechanics. Read the synchronous-commit settings closely — they are the dial this whole lesson turns on.',
    },
    {
      key: 'ddia-book',
      tier: 'must',
      note: 'The replication chapter, particularly read-your-writes, monotonic reads and consistent prefix reads. Those three names give you vocabulary for anomalies you have almost certainly shipped.',
    },
    {
      key: 'aws-well-architected-reliability',
      tier: 'good',
      note: 'The failover and recovery-objective sections. Useful for connecting a replication topology to an RPO and RTO you can state as numbers.',
    },
    {
      key: 'sqlite-wal',
      tier: 'good',
      note: 'A short, clear account of write-ahead logging — the mechanism every replication scheme is built on. Worth reading because it makes "the log is the source of truth" concrete.',
    },
    {
      key: 'jepsen-consistency',
      tier: 'advanced',
      note: 'Where read-after-write and monotonic reads sit in the formal hierarchy. Read once you can name the anomalies informally.',
    },
  ],

  intuition: {
    body: `Reads outgrow one machine long before writes do, and the standard fix is to copy the data: one primary takes all writes and streams its changes to replicas that serve reads.

It works. It also introduces one new fact that changes how you must write application code: **a replica is always behind.**

Usually by milliseconds. Sometimes by seconds. Occasionally, under load or during a long transaction on the primary, by minutes. And the moment that is true, a whole class of bug becomes available that did not exist before:

A user updates their profile, the write goes to the primary, the page reloads, the read goes to a replica that has not caught up, and they see their old name. Nothing errored. The write succeeded. The database is working exactly as designed.

That is the trade, stated plainly: **you have exchanged a capacity limit for a consistency problem, and the consistency problem is now yours.** The database will not tell you when a read was stale, because from its point of view it answered correctly from the data it had.

Which produces the rule that governs everything else here: **routing a query to a replica is an application-level decision about staleness tolerance, not an infrastructure detail.** "Send reads to replicas" is not a configuration setting you can apply globally and forget — it is a per-query judgement about whether this particular reader can tolerate being seconds behind.

The second thing replicas buy is availability: if the primary dies, a replica can be promoted. That is a different benefit with a different set of problems, and conflating the two is how designs go wrong.`,
    analogyLimit:
      'Thinking of a replica as "a slightly out-of-date copy" is right for reads and misleading for failover. During promotion the question is not how stale the copy is but whether it holds every acknowledged write — and with asynchronous replication it may not, which means promotion can silently lose transactions the application was told had committed. Staleness is a read problem; data loss is a failover problem, and they have different answers.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team routes all reads to replicas and all writes to the primary. Name three user-visible bugs this produces, give each its standard name, and say which one is hardest to fix.',
      answer: `**1. Read-after-write violation.** A user changes their display name, the page reloads, and the read hits a lagging replica showing the old value. The user concludes the save failed and does it again. *Standard name: read-your-writes (or read-after-write) consistency.*

**2. Monotonic read violation.** A user refreshes twice. The first read hits a replica 100 ms behind and shows a new comment; the second hits a replica 3 seconds behind and the comment is gone. Time appears to move backwards. *Standard name: monotonic reads.* This happens specifically because reads are load-balanced across replicas with different lag.

**3. Causal or consistent-prefix violation.** Two related writes — a post and its comment — are read from different replicas, or replayed out of order across shards, so a reply appears before the message it replies to. *Standard name: consistent prefix reads.*

**Which is hardest: the causal one.**

Read-your-writes has a clean fix: after a write, route that user's reads to the primary for a bounded window, or carry the write's log position and require the replica to have reached it. Mechanical, and it works.

Monotonic reads has a clean fix too: pin a session to one replica, so lag may be large but never goes backwards. Sticky routing, and it works.

Causal consistency has no local fix. It requires either ordering guarantees across every replica for related writes, or tracking causal dependencies explicitly and waiting for them — and in a system where related data lives on different shards, no amount of routing solves it. You either accept it, or you keep causally related reads on the primary, or you move to a store that offers causal consistency as a guarantee.

**The design conclusion:** the first two are fixed by routing policy, and the third is fixed by not splitting causally related reads in the first place. Which is why "which queries may go to a replica" is a question about the *data*, not just about the reader.`,
    },
  body: `## The mechanism: a log, shipped

Every replication scheme is built on the same foundation. The primary writes changes to a write-ahead log before applying them — that is how durability works — and a replica receives that log and applies the same changes in the same order.

Consequences worth knowing:

**Replicas are eventually identical, not approximately similar.** They apply the same operations in the same order, so a caught-up replica is byte-equivalent, not merely close.

**Replication lag is the distance between the primary's log position and the replica's.** It is measurable, and it should be a monitored metric with an alert. A team that cannot state their current replication lag cannot reason about any of this.

**A long transaction on the primary delays replication.** The log cannot be applied past a transaction that has not committed, so one slow write blocks the stream for everyone.

## Synchronous versus asynchronous, which is the real dial

**Asynchronous.** The primary commits and acknowledges the client immediately; the log ships in the background. Fast writes, and if the primary dies before the log reaches a replica, **the acknowledged write is gone.** Promotion silently loses transactions the application was told had committed.

**Synchronous.** The primary waits for at least one replica to confirm receipt before acknowledging. No acknowledged write can be lost. Every write now costs a round trip to a replica, and if the replica is unavailable the primary either blocks or falls back to asynchronous — and which of those it does is a configuration decision with very different failure behaviour.

**Semi-synchronous / quorum.** Wait for *k* of *n* replicas. The usual compromise: tolerate one replica being slow without either blocking writes or risking loss.

The number that decides this is your **recovery point objective** — how much data you can afford to lose. If the answer is "none", you need synchronous replication and you must accept the write latency. If the answer is "up to a few seconds", asynchronous is fine and much faster. Most teams have never stated the number, which means they have chosen asynchronous by default and have not decided that losing seconds of writes is acceptable.

## Reading from replicas: a per-query decision

The useful framing is a staleness budget per query, exactly as with derived data.

| Query | Tolerable staleness | Route to |
| --- | --- | --- |
| A user's own profile immediately after editing it | zero | primary |
| Account balance before a withdrawal | zero | primary |
| A public product page | seconds | replica |
| Search results | seconds | replica |
| A monthly report | minutes or hours | replica, or a dedicated analytics replica |
| Anything that decides a write | zero | primary |

That last row is the one to internalise: **any read whose result determines a subsequent write must come from the primary.** Checking stock on a replica and then writing an order to the primary is a read-check-write across two machines with lag between them — every concurrency problem from the transactions lesson, plus staleness.

Three mechanisms for read-after-write, in ascending sophistication:

**Route by recency.** After a user writes, send that user's reads to the primary for N seconds. Simple, effective, and it sends more traffic to the primary than strictly necessary.

**Carry the log position.** The write returns the primary's log position; the client sends it with subsequent reads; the router picks a replica that has reached it, or waits briefly, or falls back to the primary. Precise, and it requires the position to be threaded through the application.

**Sticky sessions per replica.** Pin a session to one replica. Fixes monotonic reads well and read-after-write not at all, since the pinned replica may still be behind the primary.

## Failover: a separate problem

Replicas give you availability as well as read capacity, and the failover story has its own questions.

**Who decides the primary is dead?** Automatic failover risks **split brain**: a primary that is merely unreachable, not dead, continues accepting writes while a replica is promoted. Two primaries, divergent histories, and a manual reconciliation. Preventing this needs fencing — the old primary must be reliably stopped or isolated before promotion completes.

**Which replica is promoted?** The most caught-up one, to minimise loss. With asynchronous replication, "most caught-up" still may not have every acknowledged write.

**How long does it take?** That is your **recovery time objective**. Detection plus promotion plus client reconnection, and clients need to discover the new primary — usually through a stable endpoint rather than by changing DNS, for the TTL reasons from the networking lesson.

**What happens to the old primary?** It must not rejoin as a primary, and it may hold writes the new primary does not. Reconciling those is a manual operation, and it is why fencing matters more than fast promotion.

## The limits of read replicas

Replicas scale reads and only reads. Worth being precise about what they do not do:

**They do not scale writes.** Every replica applies every write, so write throughput is capped by one machine regardless of replica count. That is what partitioning is for.

**They add write cost.** More replicas means more log shipping, and with synchronous replication more latency.

**They do not reduce storage.** Every replica holds the whole dataset.

**They do not help a write-heavy workload at all.** If the bottleneck is writes, replicas make it slightly worse.

So the decision tree is short: reads are the bottleneck and staleness is tolerable, add replicas. Writes are the bottleneck, or the dataset exceeds one machine, partition instead — and that is the next phase of the curriculum.

## The practical rules

1. **Monitor lag, and alert on it.** With a threshold derived from the staleness budget of the queries you route to replicas.
2. **Choose read routing per query**, not globally. Default to the primary and move queries to replicas deliberately.
3. **Never read from a replica to decide a write.**
4. **State your RPO before choosing asynchronous replication**, because asynchronous is a decision to accept losing acknowledged writes.
5. **Test failover.** An untested failover procedure is a hypothesis, and the day you need it is the worst possible time to discover a mistake in it.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'lag-anomalies',
      title: 'Three anomalies replication makes possible',
      caption:
        'Note that no error occurs in any of the three. Each replica answered correctly from the data it had, which is why these are application-level bugs rather than database faults.',
      code: `sequenceDiagram
    participant U as User
    participant P as Primary
    participant R1 as Replica (100 ms behind)
    participant R2 as Replica (3 s behind)

    rect rgb(42,29,29)
    Note over U,R2: Read-after-write violation
    U->>P: UPDATE name = 'Alex'
    P-->>U: 200 OK
    U->>R1: GET profile
    R1-->>U: name = 'Alexandra'  (old)
    end

    rect rgb(42,29,29)
    Note over U,R2: Monotonic read violation
    U->>R1: GET comments
    R1-->>U: [c1, c2, c3]
    U->>R2: GET comments (refresh)
    R2-->>U: [c1, c2]  — time moved backwards
    end

    rect rgb(42,29,29)
    Note over U,R2: Consistent prefix violation
    U->>P: POST message
    U->>P: POST reply to that message
    U->>R1: GET thread
    R1-->>U: reply present, message missing
    end`,
    },
    {
      kind: 'flow',
      id: 'routing-decision',
      title: 'Routing one query, and what each choice commits you to',
      caption:
        'Step through it. The rule that catches most bugs is the second one: any read whose result determines a write must come from the primary, because otherwise it is a read-check-write with lag in the middle.',
      nodes: [
        { id: 'query', label: 'A read query', kind: 'client', x: 0, y: 150, detail: 'Every read is a separate routing decision. "Send reads to replicas" as a global setting is how read-after-write bugs get shipped.' },
        { id: 'decides', label: 'Does it decide a write?', kind: 'note', x: 200, y: 30, detail: 'Stock check before an order, balance check before a withdrawal, uniqueness check before an insert. On a replica this is a read-check-write with replication lag inserted into the gap.' },
        { id: 'own', label: 'Is it the reader\'s own write?', kind: 'note', x: 200, y: 160, detail: 'A user who just saved something and reloads. The classic read-after-write case, and the one users interpret as "the save did not work".' },
        { id: 'primary', label: 'Primary', kind: 'store', x: 440, y: 60, detail: 'Zero staleness, and every query sent here consumes the capacity replicas were added to relieve. Default here and move queries away deliberately.' },
        { id: 'recency', label: 'Recency routing', kind: 'service', x: 440, y: 180, detail: 'Send this user\'s reads to the primary for N seconds after their write. Simple and effective, and sends more traffic to the primary than strictly needed.' },
        { id: 'lsn', label: 'Log-position routing', kind: 'service', x: 440, y: 300, detail: 'The write returns the primary\'s log position; reads carry it; the router picks a replica that has reached it or waits briefly. Precise, and the position must be threaded through the application.' },
        { id: 'replica', label: 'Replica', kind: 'store', x: 680, y: 200, detail: 'Seconds of staleness, and load-balanced reads across replicas with different lag also break monotonic reads — which is why a session should stick to one.' },
        { id: 'analytics', label: 'Analytics replica', kind: 'store', x: 680, y: 330, detail: 'A dedicated replica for long reports, so an hour-long query does not hold a snapshot on a replica serving users — and does not delay its replication.' },
      ],
      edges: [
        { id: 'r1', source: 'query', target: 'decides', kind: 'control' },
        { id: 'r2', source: 'query', target: 'own', kind: 'control' },
        { id: 'r3', source: 'decides', target: 'primary', label: 'yes → always', kind: 'read' },
        { id: 'r4', source: 'own', target: 'recency', label: 'yes', kind: 'control' },
        { id: 'r5', source: 'own', target: 'lsn', label: 'yes, precisely', kind: 'control' },
        { id: 'r6', source: 'recency', target: 'primary', kind: 'read' },
        { id: 'r7', source: 'lsn', target: 'replica', kind: 'read' },
        { id: 'r8', source: 'query', target: 'replica', label: 'staleness tolerable', kind: 'read' },
        { id: 'r9', source: 'query', target: 'analytics', label: 'long report', kind: 'read' },
      ],
      steps: [
        {
          id: 'q1',
          title: 'A read that decides a write always goes to the primary',
          description:
            'Checking stock on a replica and then inserting an order on the primary is a read-check-write with replication lag in the gap — every concurrency problem from the transactions lesson, plus staleness on top.',
          nodes: ['query', 'decides', 'primary'],
          edges: ['r1', 'r3'],
        },
        {
          id: 'q2',
          title: 'A reader\'s own write needs read-after-write consistency',
          description:
            'Recency routing sends that user to the primary for a window: simple and slightly wasteful. Log-position routing is precise and requires threading the position through the application. Either is a real mechanism; hoping is not.',
          nodes: ['own', 'recency', 'lsn'],
          edges: ['r2', 'r4', 'r5', 'r6', 'r7'],
        },
        {
          id: 'q3',
          title: 'Everything else goes to a replica, with a stated budget',
          description:
            'Public pages, search results, anything nobody just wrote. And a session should stick to one replica, because load-balancing across replicas with different lag makes time appear to move backwards.',
          nodes: ['query', 'replica'],
          edges: ['r8'],
        },
        {
          id: 'q4',
          title: 'Long reports get their own replica',
          description:
            'An hour-long analytical query holds a snapshot open, which prevents cleanup and delays replication on the replica running it. Isolating it protects both the users reading from other replicas and the replication stream itself.',
          nodes: ['analytics'],
          edges: ['r9'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The most instructive production pattern here is the incident that follows adopting read replicas, because it is nearly universal and the mechanism is always the same.

A team adds replicas and routes reads to them through a connection-level setting — one line of configuration, applied globally. Latency improves, primary load drops, everyone is pleased.

Then support tickets arrive, and they are strange:

**"I updated my details and they did not save."** They did save. The subsequent read hit a lagging replica. The user often saves again, producing duplicate side effects and a support conversation that finds nothing wrong.

**"The page keeps changing back."** Reads are load-balanced across replicas with different lag, so consecutive refreshes see different states. This one is particularly corrosive because it looks like a caching bug and every cache is innocent.

**"We sold more than we had."** The stock check ran on a replica. This is the expensive one — it is not a display glitch, it is a read-check-write with replication lag inserted into the gap, so the check was made against a value that was already wrong when it was read.

What makes this pattern worth studying is that the configuration change was *correct in isolation* and wrong as a blanket policy. Replicas are a legitimate and important tool; applying them globally is what fails.

Systems that get this right share three properties:

**Reads default to the primary and are moved to replicas deliberately, per query.** The opposite default — replicas by default, primary by exception — means the exceptions are discovered by users.

**Replication lag is a monitored metric with an alert**, and the threshold comes from the staleness budget of the queries actually routed to replicas. A team that cannot state their current lag cannot reason about any of the anomalies above.

**Sessions stick to one replica.** Lag may be large but it never goes backwards, which eliminates the monotonic-read class entirely for a small amount of routing logic.

Two transferable lessons:

**Replication turns an infrastructure decision into an application-code concern**, and the handover is silent. Nothing in the database or the connection pool tells you that a query needed fresh data.

**"Reads go to replicas" is not a configuration setting.** It is a per-query staleness judgement, and treating it as infrastructure is how a capacity improvement becomes a correctness regression.`,
  },

  tradeoffs: {
    intro:
      'Two independent decisions are bundled here: how writes are acknowledged, and where reads are routed. Rows cover both because in practice they are chosen together.',
    rows: [
      {
        option: 'Single primary, no replicas',
        whenItWins:
          'Until reads genuinely exceed one machine. No lag, no routing decisions, no anomalies, no failover complexity.',
        whenItLoses:
          'When read capacity is the bottleneck, or when a single instance failure is an unacceptable outage.',
        cost:
          'A read ceiling, and an availability floor set by one machine plus restore time from backups.',
      },
      {
        option: 'Asynchronous replicas, reads on the primary',
        whenItWins:
          'When replicas exist for availability and disaster recovery rather than for read capacity. No staleness anomalies at all.',
        whenItLoses:
          'When read load is the actual problem, since the replicas sit idle.',
        cost:
          'Replicas you pay for and do not read from, and an RPO of however far behind they are when the primary dies.',
      },
      {
        option: 'Asynchronous replicas, reads routed per query',
        whenItWins:
          'The standard read-scaling design. Most reads served from replicas, with reads that need freshness kept on the primary deliberately.',
        whenItLoses:
          'When almost every read needs freshness, in which case you have added complexity for little relief.',
        cost:
          'Per-query routing decisions, read-after-write mechanisms, sticky sessions, lag monitoring, and acknowledged writes lost on failover.',
      },
      {
        option: 'Synchronous replication to at least one replica',
        whenItWins:
          'When the RPO is zero — money, medical records, anything where losing an acknowledged write is unacceptable.',
        whenItLoses:
          'Latency-sensitive write paths, and any topology where a replica is far away.',
        cost:
          'A round trip to a replica on every commit, and a decision about whether the primary blocks or degrades to asynchronous when the replica is unavailable.',
      },
      {
        option: 'A dedicated analytics replica',
        whenItWins:
          'Long reports and ad-hoc analytical queries, kept away from replicas serving users.',
        whenItLoses:
          'When the analytical need is large enough to want a different storage shape, at which point a warehouse fed by change events is the answer.',
        cost:
          'Another full copy of the data, and a replica whose replication may lag badly because of the queries running on it.',
      },
      {
        option: 'Partitioning instead',
        whenItWins:
          'When writes are the bottleneck, or the dataset exceeds one machine. Replicas cannot help with either.',
        whenItLoses:
          'When reads are the only problem — partitioning is substantially more complexity for a problem replicas solve.',
        cost:
          'Cross-partition queries, a partition key that constrains atomicity, and a resharding operation in your future.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We route all reads to replicas, which takes the load off the primary."',
      whyWeak:
        'Applied globally, this ships read-after-write bugs and monotonic-read bugs to users. A user who saves and reloads sees stale data and concludes the save failed; consecutive refreshes across replicas with different lag make the page appear to change back.',
      strongAnswer:
        '"Routing is a per-query decision about staleness tolerance. I would default reads to the primary and move queries to replicas deliberately, keep a user\'s reads on the primary for a window after they write, and pin a session to one replica so lag never goes backwards."',
    },
    {
      weakAnswer: '"We check stock on a replica to reduce primary load, then write the order to the primary."',
      whyWeak:
        'That is a read-check-write with replication lag inserted into the gap. The stock value was potentially already wrong when read, so the check protects nothing — and this is how overselling happens. It is a correctness bug rather than a performance trade.',
      strongAnswer:
        '"Any read whose result determines a write has to come from the primary, and inside the same transaction. Reading stock on a replica means checking a value that was stale before I saw it, which is the transactions lesson\'s read-check-write problem with an extra source of staleness."',
    },
    {
      weakAnswer: '"Replication is asynchronous, which is fine because the lag is only a few hundred milliseconds."',
      whyWeak:
        'It conflates staleness with data loss. A few hundred milliseconds of lag is a read-freshness question. The failover question is different: if the primary dies, every write in that window was acknowledged to the client and is gone. That is an RPO of a few hundred milliseconds, and it needs to be a decision rather than a default.',
      strongAnswer:
        '"Lag governs read staleness; the failover question is what RPO we accept. Asynchronous means acknowledged writes can be lost on promotion — fine for a content site, not for payments. If the RPO is zero I need synchronous replication to at least one replica and I accept the write-latency cost."',
    },
    {
      weakAnswer: '"Automatic failover means we recover from a primary failure without human involvement."',
      whyWeak:
        'It also means you can get split brain: a primary that is unreachable rather than dead keeps accepting writes while a replica is promoted. Two primaries with divergent histories, and reconciliation is manual and painful. Speed of promotion is not the hard part — fencing is.',
      strongAnswer:
        '"Automatic failover needs fencing: the old primary must be reliably stopped or isolated before promotion completes, or a network partition gives us two primaries. I would also make sure clients discover the new primary through a stable endpoint rather than a DNS change, since DNS TTLs put a floor on recovery time."',
    },
    {
      weakAnswer: '"Adding more replicas will help with our write throughput problem."',
      whyWeak:
        'Every replica applies every write, so write throughput is capped by a single machine no matter how many replicas exist. More replicas means more log shipping, so it makes a write bottleneck marginally worse.',
      strongAnswer:
        '"Replicas scale reads only — each one replays the full write stream, so writes are still limited by one machine. If writes are the bottleneck the answer is partitioning, which is a much larger change: a partition key that constrains what can be atomic, cross-partition queries, and a resharding operation eventually."',
    },
    {
      weakAnswer: '"We run the nightly analytics job against a read replica so it does not affect production."',
      whyWeak:
        'It does affect production if that replica also serves users: a long analytical query holds a snapshot open, which prevents cleanup and delays replication on that replica — so it falls further behind exactly while users are reading from it.',
      strongAnswer:
        '"Long analytical queries get a dedicated replica, isolated from the ones serving users, because holding a snapshot open delays replication and bloats that instance. If the analytical need grows beyond that, the answer is a warehouse fed by change events rather than a bigger replica."',
    },
  ],

  flashcards: [
    {
      id: 'fc-rep-1',
      front: 'What do read replicas actually trade?',
      back: 'A read-capacity limit for a consistency problem. The lag is now your correctness concern, and the database will never tell you a read was stale.',
      topic: 'replication',
    },
    {
      id: 'fc-rep-2',
      front: 'What is a read-after-write violation, and how is it fixed?',
      back: 'A user reads their own write from a lagging replica and sees the old value. Fixed by recency routing (primary for N seconds after a write) or by carrying the write\'s log position.',
      topic: 'replication-lag',
    },
    {
      id: 'fc-rep-3',
      front: 'What causes a monotonic-read violation, and what fixes it?',
      back: 'Load-balancing reads across replicas with different lag, so consecutive reads appear to move backwards in time. Fixed by pinning a session to one replica.',
      topic: 'replication-lag',
    },
    {
      id: 'fc-rep-4',
      front: 'Why is causal consistency the hardest of the three anomalies?',
      back: 'It cannot be fixed by routing to one replica or one machine. It needs ordering guarantees across replicas, or explicit dependency tracking — or keeping causally related reads on the primary.',
      topic: 'replication-lag',
    },
    {
      id: 'fc-rep-5',
      front: 'What is the difference between replication lag and RPO?',
      back: 'Lag governs how stale a read can be. RPO is how much acknowledged data you lose if the primary dies before shipping its log — a failover question, not a read question.',
      topic: 'failover',
    },
    {
      id: 'fc-rep-6',
      front: 'What does synchronous replication buy and cost?',
      back: 'Buys: no acknowledged write can be lost on failover. Costs: a round trip to a replica on every commit, plus a decision about whether the primary blocks or degrades when the replica is unavailable.',
      topic: 'replication',
    },
    {
      id: 'fc-rep-7',
      front: 'Which reads must always come from the primary?',
      back: 'Any read whose result determines a subsequent write. On a replica that is a read-check-write with replication lag inserted into the gap.',
      topic: 'read-scaling',
    },
    {
      id: 'fc-rep-8',
      front: 'What is split brain and what prevents it?',
      back: 'A primary that is unreachable rather than dead keeps accepting writes while a replica is promoted, producing two divergent primaries. Prevented by fencing — reliably stopping or isolating the old primary before promotion completes.',
      topic: 'failover',
    },
    {
      id: 'fc-rep-9',
      front: 'Why do replicas not help with write throughput?',
      back: 'Every replica applies every write, so writes are capped by one machine. More replicas means more log shipping, making a write bottleneck slightly worse.',
      topic: 'read-scaling',
    },
    {
      id: 'fc-rep-10',
      front: 'Why does a long transaction on the primary delay replication?',
      back: 'The log cannot be applied past an uncommitted transaction, so one slow write blocks the stream for every replica.',
      topic: 'replication',
    },
    {
      id: 'fc-rep-11',
      front: 'Why should long analytical queries get a dedicated replica?',
      back: 'They hold a snapshot open, which prevents cleanup and delays replication on the instance running them — so a shared replica falls further behind exactly while users read from it.',
      topic: 'read-scaling',
    },
    {
      id: 'fc-rep-12',
      front: 'What should the default read routing be, and why?',
      back: 'The primary, with queries moved to replicas deliberately. The opposite default means the exceptions that needed freshness are discovered by users.',
      topic: 'read-scaling',
    },
    {
      id: 'fc-rep-13',
      front: 'Why does failover recovery time depend on how clients find the primary?',
      back: 'If discovery is by DNS change, the TTL is a floor on recovery time and clients cache beyond it. A stable endpoint with traffic moved behind it takes effect in seconds.',
      topic: 'failover',
    },
  ],

  quiz: [
    {
      id: 'q-rep-1',
      kind: 'scenario',
      prompt:
        'After enabling replica reads globally, support reports users saying "my profile update did not save" — though the data is correct in the database. What is happening and what is the narrowest fix?',
      options: [
        { id: 'a', label: 'Read-after-write violation; route that user\'s reads to the primary for a window after their write' },
        { id: 'b', label: 'The write is failing silently and needs error handling' },
        { id: 'c', label: 'The application cache needs invalidating on write' },
        { id: 'd', label: 'Replication should be made synchronous' },
      ],
      correct: ['a'],
      explanation:
        'The write succeeded and the subsequent read hit a lagging replica. Recency routing is the narrowest fix — log-position routing is more precise but requires threading the position through the application. Synchronous replication would help but is a far heavier change that also slows every write.',
      difficulty: 'core',
      topic: 'replication-lag',
    },
    {
      id: 'q-rep-2',
      kind: 'scenario',
      prompt:
        'A stock check runs against a read replica; the order insert goes to the primary. Overselling occurs during a flash sale. What is the precise defect?',
      options: [
        { id: 'a', label: 'It is a read-check-write with replication lag in the gap — the checked value was potentially already stale when read' },
        { id: 'b', label: 'The replica was too far behind and needs better hardware' },
        { id: 'c', label: 'The insert needed a higher isolation level' },
        { id: 'd', label: 'The stock table needed an index' },
      ],
      correct: ['a'],
      explanation:
        'Any read that determines a write must come from the primary, and inside the same transaction. Reading from a replica adds staleness on top of the concurrency problem, so the check protects nothing. Faster hardware reduces lag without removing the defect, and isolation levels cannot help a read taken on a different machine.',
      difficulty: 'core',
      topic: 'read-scaling',
    },
    {
      id: 'q-rep-3',
      kind: 'single',
      prompt: 'With asynchronous replication, what happens to writes acknowledged just before the primary dies?',
      options: [
        { id: 'a', label: 'They may be lost, because the log had not reached any replica' },
        { id: 'b', label: 'They are recovered when the old primary rejoins' },
        { id: 'c', label: 'They are preserved, since acknowledgement implies durability on a replica' },
        { id: 'd', label: 'They are replayed automatically by the promoted replica' },
      ],
      correct: ['a'],
      explanation:
        'Asynchronous means the primary acknowledges before shipping the log, so acknowledged writes can exist only on the dead machine. The old primary may hold them, and reconciling them into a promoted primary is a manual operation — which is why the RPO must be a stated decision rather than a default.',
      difficulty: 'intro',
      topic: 'failover',
    },
    {
      id: 'q-rep-4',
      kind: 'scenario',
      prompt:
        'Users report a page "flickering between two versions" on refresh. Reads are load-balanced across three replicas. What is the anomaly and the fix?',
      options: [
        { id: 'a', label: 'Monotonic-read violation from replicas at different lag; pin a session to one replica' },
        { id: 'b', label: 'A caching bug; add cache-busting query parameters' },
        { id: 'c', label: 'Read-after-write violation; route reads to the primary' },
        { id: 'd', label: 'Clock skew between the replicas' },
      ],
      correct: ['a'],
      explanation:
        'Consecutive reads landing on replicas with different lag make time appear to move backwards. Sticky routing per session means lag may be large but is at least consistent. It is not read-after-write — no write by this user is involved — and every cache is innocent, which is what makes this bug so often misdiagnosed.',
      difficulty: 'advanced',
      topic: 'replication-lag',
    },
    {
      id: 'q-rep-5',
      kind: 'scenario',
      prompt:
        'During a network partition, automatic failover promotes a replica while the old primary is still reachable by some clients and still accepting writes. What is the consequence?',
      options: [
        { id: 'a', label: 'Split brain — two primaries with divergent histories, requiring manual reconciliation' },
        { id: 'b', label: 'The old primary automatically becomes a replica of the new one' },
        { id: 'c', label: 'Writes to the old primary are queued and applied after the partition heals' },
        { id: 'd', label: 'Clients are rejected by the old primary because it lost quorum' },
      ],
      correct: ['a'],
      explanation:
        'Without fencing, promotion does not stop the old primary. Both accept writes and their histories diverge, and merging them is a manual data-recovery exercise. Option (d) describes what a quorum-based system would do — which is exactly why fencing matters more than promotion speed.',
      difficulty: 'advanced',
      topic: 'failover',
    },
    {
      id: 'q-rep-6',
      kind: 'multi',
      prompt: 'Which of these are things read replicas do *not* solve? Select all that apply.',
      options: [
        { id: 'a', label: 'Write throughput exceeding one machine' },
        { id: 'b', label: 'A dataset larger than one machine\'s storage' },
        { id: 'c', label: 'Reads that must reflect the caller\'s own just-committed write' },
        { id: 'd', label: 'Read capacity for queries that tolerate seconds of staleness' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Replicas replay every write, so they help with neither write throughput nor storage — both need partitioning. And a read requiring the caller\'s own write must go to the primary or use log-position routing. Stale-tolerant read capacity is exactly what replicas are for, which is the one thing they do solve.',
      difficulty: 'core',
      topic: 'read-scaling',
    },
  ],

  exercises: [
    {
      id: 'ex-rep-1',
      kind: 'design',
      title: 'Route every read, and state your recovery objectives',
      estimatedMinutes: 22,
      prompt: `A booking platform runs one primary and three asynchronous replicas. Current lag: p50 80 ms, p99 1.4 s, worst observed 40 s during a nightly bulk import.

Read queries, with volumes:

1. Public event page — event details, remaining capacity shown as "12 seats left". 6,000/s
2. My bookings list, loaded immediately after booking. 200/s
3. Seat availability check, immediately before inserting a booking. 400/s
4. Admin dashboard — bookings in the last hour. 2/s
5. Monthly revenue report — aggregates over two years. 1/hour
6. Search across events. 1,200/s

Produce:
1. A routing decision for each query, with the staleness budget as a number.
2. The read-after-write mechanism you would use, and why that one.
3. Your RPO and RTO, and what topology change each implies.
4. What you would change about the nightly bulk import, and why.`,
      rubric: [
        'Assigns a numeric staleness budget per query and routes accordingly, rather than a blanket policy.',
        'Query 3 goes to the primary, identified as a read that determines a write.',
        'Query 2 uses a read-after-write mechanism rather than a plain replica read.',
        'Query 1 goes to a replica but flags "12 seats left" as a display value that must not be treated as authoritative.',
        'Query 5 gets a dedicated analytics replica, with the snapshot-holding and replication-delay reasoning.',
        'States RPO and RTO as numbers and derives the topology implication — synchronous replication for a low RPO.',
        'Identifies the bulk import as the cause of 40 s lag and proposes batching with pauses or running it against a schedule that accounts for lag.',
      ],
      modelAnswer: `**1. Routing per query**

| # | Query | Budget | Route |
| --- | --- | --- | --- |
| 1 | Public event page | 5 s | Replica, sticky per session |
| 2 | My bookings, after booking | 0 | Read-after-write mechanism |
| 3 | Seat availability before insert | 0 | **Primary, in the same transaction** |
| 4 | Admin dashboard, last hour | 30 s | Replica |
| 5 | Monthly revenue report | 1 hour | **Dedicated analytics replica** |
| 6 | Event search | 10 s | Replica, sticky per session |

Notes on the two interesting ones:

**Query 1 — the "12 seats left" number.** A replica read is fine for *display*, and I would be explicit in the design that this number is advisory. A user seeing "12 seats left" when 11 remain is acceptable; the booking flow must not trust it. I would round or bucket it ("a few seats left" below a threshold) so the UI does not imply precision the value does not have.

**Query 3 — the one that must not move.** This is a read whose result determines a write. On a replica it is a read-check-write with up to 40 seconds of lag in the gap, which means the check protects nothing during exactly the period when contention is highest. It goes to the primary, inside the booking transaction, with a lock on the event row or a capacity counter with a \`CHECK\` — the mechanism from the transactions lesson.

**2. Read-after-write mechanism: recency routing.**

After a user writes, route *that user's* reads to the primary for 5 seconds — comfortably above p99 lag of 1.4 s.

Why this rather than log-position routing: query 2 is 200/s, which is 3% of total read volume. Sending it to the primary for a few seconds after a booking costs almost nothing, and recency routing needs one piece of session state rather than threading a log position through every read path.

Why not sticky-to-a-replica for this: pinning fixes monotonic reads and does nothing for read-after-write, because the pinned replica may still be behind the primary.

I *would* revisit this if the worst-case lag of 40 s persisted — a 5-second window is useless during the import, so the fix for that is in part 4.

For queries 1 and 6 I would additionally pin a session to one replica, so a user refreshing does not see the page move backwards.

**3. Recovery objectives**

**RPO: 0 for bookings.** A confirmed booking that vanishes is a customer who arrives at a venue with no seat — commercially and reputationally worse than a failed booking attempt. Asynchronous replication cannot give this: writes acknowledged in the window before shipping are lost on promotion.

*Implication:* **synchronous replication to one of the three replicas**, with the other two asynchronous. Every commit costs a round trip to that replica. At 400 booking writes/second that is acceptable if the synchronous replica is in the same region — I would place it accordingly and measure the added commit latency before committing to it.

I would also configure explicitly what happens when the synchronous replica is unavailable. Blocking writes means a replica failure becomes a full outage; degrading to asynchronous means silently giving up the RPO. Given that the RPO exists for booking integrity, I would **block and alert**, and accept that as a deliberate availability trade rather than discovering it during an incident.

**RTO: 60 seconds.**

*Implications:*
- **Automatic failover with fencing.** The old primary must be reliably isolated before promotion completes, or a partition gives us two primaries taking bookings — which is worse than the outage.
- **Clients discover the primary through a stable endpoint**, not a DNS change. A DNS TTL puts a floor on recovery time and clients cache beyond it.
- **Promote the synchronous replica**, since it is guaranteed to hold every acknowledged write.
- **Failover must be tested on a schedule.** An untested procedure is a hypothesis, and this one has a 60-second budget.

**4. The nightly bulk import**

The 40-second worst-case lag is the most damaging fact in the brief, and it is caused by the import — a long transaction or a large batch that the replicas cannot apply past.

Two problems it creates: the 5-second read-after-write window becomes useless, and any replica-served read is up to 40 seconds stale while it runs.

*Changes:*

- **Batch it with commits between batches**, a few thousand rows at a time, so no single transaction blocks the replication stream. This is the main fix and it is usually straightforward.
- **Pause between batches** and monitor replica lag, backing off if it exceeds a threshold. That makes the import self-limiting rather than requiring someone to notice.
- **Widen the read-after-write window dynamically** based on observed lag, rather than hard-coding 5 seconds. Then a lag spike degrades gracefully — more traffic to the primary — instead of producing stale reads.
- **Schedule it against traffic**, and if bookings genuinely happen overnight, treat that as a reason to fix the batching rather than to hope.

The general point worth stating: **replication lag is not a property of the replicas, it is a property of the write pattern on the primary.** Adding replica capacity would not have reduced that 40 seconds by a millisecond, and a team that had not measured lag would have reached for exactly that.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-rep-1',
      level: 'basic',
      question: 'Why would you add a read replica, and what does it cost?',
      guidance:
        'Read capacity and availability. The cost is replication lag, which becomes an application-level correctness concern. A strong answer immediately separates the read-scaling benefit from the failover benefit, since they have different problems.',
    },
    {
      id: 'iq-rep-2',
      level: 'basic',
      question: 'What is replication lag and what breaks because of it?',
      guidance:
        'The distance between the primary\'s and replica\'s log positions. Look for the three named anomalies — read-after-write, monotonic reads, consistent prefix — and the observation that none of them produce an error.',
    },
    {
      id: 'iq-rep-3',
      level: 'intermediate',
      question: 'How do you decide which reads go to a replica?',
      guidance:
        'Per query, from a staleness budget. Look for the rule that any read determining a write goes to the primary, and for defaulting to the primary and moving queries away deliberately rather than the reverse.',
    },
    {
      id: 'iq-rep-4',
      level: 'intermediate',
      question: 'How do you give a user read-after-write consistency?',
      guidance:
        'Recency routing to the primary after a write, or carrying the write\'s log position so the router picks a caught-up replica. A strong answer notes that sticky sessions fix monotonic reads and not this, and picks between the two mechanisms with a reason.',
    },
    {
      id: 'iq-rep-5',
      level: 'advanced',
      question: 'Walk me through a primary failover. What can go wrong?',
      guidance:
        'Detection, fencing, promotion of the most caught-up replica, client rediscovery, and reconciling the old primary. Look for split brain named explicitly and for fencing prioritised over promotion speed. Excellent answers note that asynchronous replication means promotion can lose acknowledged writes.',
    },
    {
      id: 'iq-rep-6',
      level: 'advanced',
      question: 'Synchronous or asynchronous replication — how do you choose?',
      guidance:
        'From the RPO. Zero data loss requires synchronous and costs a round trip per commit. A strong answer also decides what happens when the synchronous replica is unavailable — block and alert, or degrade to asynchronous — and treats that as a deliberate availability trade.',
    },
    {
      id: 'iq-rep-7',
      level: 'followup',
      question: 'Replication lag spiked to 40 seconds. Where do you look?',
      guidance:
        'The write pattern on the primary — a long transaction or a large batch that the replica cannot apply past — before looking at replica resources. A strong answer notes that lag is a property of the primary\'s workload, so adding replica capacity would not help.',
    },
    {
      id: 'iq-rep-8',
      level: 'followup',
      question: 'Your write throughput has hit the ceiling. Do more replicas help?',
      guidance:
        'No — every replica applies every write, so writes are capped by one machine and more replicas add log-shipping load. The answer is partitioning, and a strong response names what that costs: a partition key that constrains atomicity, cross-partition queries, and eventual resharding.',
    },
  ],

  activeLearning: [
    {
      id: 'al-rep-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson assumed one primary taking all writes. Now change it: the topology is multi-primary, with two datacentres each accepting writes and replicating to the other. What problem does that solve, what new problem appears, and what is the honest recommendation?',
      discussion: `It solves write availability and write latency across regions, and it introduces the one problem single-primary replication does not have: **two nodes can modify the same row at the same time, and someone has to decide which change wins.**

**What it genuinely buys:**

*Local write latency.* A user in Europe writes to the European primary rather than paying a transatlantic round trip. For a write-heavy interactive application this can be the difference between usable and not.

*Write availability during a regional outage.* Either datacentre can accept writes with no promotion needed, so there is no failover window and no fencing problem.

**The new problem: conflicts.**

Two primaries accept conflicting writes to the same row, and both are already committed and acknowledged. Unlike single-primary replication, there is no ordering that makes one of them the loser by construction. The resolution options are all unsatisfying:

*Last-write-wins by timestamp.* Simple, and it **silently discards data**. It also depends on clock synchronisation across datacentres, so a clock skew of a few hundred milliseconds means the wrong write wins. This is the default in many systems and it is the source of "my change disappeared" reports that nobody can reproduce.

*Application-level merge.* Keep both versions and let the application reconcile — the shopping-cart-union approach. Correct where the data type has a sensible merge, and most data does not. There is no correct merge of two different values for "account balance".

*Conflict-free replicated data types.* Structures mathematically guaranteed to converge — counters, sets, sequences. Genuinely solves the problem for the types they cover, and most business data does not fit them.

*Avoid conflicts by partitioning writes.* Each row has a home region, and writes for it go there. This is the answer that works, and note what it is: **single-primary replication per partition**, with the partitioning done geographically. The multi-primary topology is preserved for availability while the conflict problem is designed away.

**What else breaks:**

*Uniqueness constraints stop working.* Two primaries can each accept a registration for the same email address, and both succeed locally. There is no cross-primary constraint, so uniqueness becomes an application concern with an eventual-detection-and-repair story.

*Auto-increment identifiers collide.* Requiring either disjoint ranges per primary or globally unique ids — which returns you to the identifier design from the URL-shortener lesson.

*Transactions cannot span primaries.* So any invariant involving rows homed in different regions is not enforceable atomically.

**The honest recommendation:** avoid multi-primary unless you have a specific requirement that forces it — regulatory data residency, or write latency that genuinely cannot tolerate a cross-region round trip. And if you do adopt it, **partition writes by home region so that conflicts are structurally impossible**, rather than adopting a conflict-resolution strategy and hoping the data merges cleanly.

**Transferable:** when a topology removes a bottleneck by removing a single point of coordination, check what that coordination was providing. Here it was providing a total order on writes, which was quietly underwriting uniqueness, identifier generation, and every cross-row invariant. Removing the bottleneck removed all of those too.`,
    },
    {
      id: 'al-rep-2',
      kind: 'debug',
      prompt:
        'A team reports that roughly one booking in ten thousand is confirmed to the user but absent from the database afterwards. Replication is asynchronous with three replicas. There have been two brief primary failovers this month. What is your leading hypothesis, and how would you confirm and fix it?',
      discussion: `Confirmed to the user and absent afterwards, with asynchronous replication and recent failovers. That combination has one dominant explanation.

**Leading hypothesis: writes lost during failover.**

The sequence: the primary commits a booking and acknowledges it to the application, which confirms to the user. Those log records have not yet reached any replica. The primary fails. A replica is promoted, and it does not have the booking. The write was acknowledged and is gone.

The rate fits: two brief failovers in a month, each losing however many writes were in flight in the final moments. At 400 bookings/second and a lag of even 100 ms, a failover can lose tens of bookings — which against a monthly volume is roughly one in ten thousand.

This is not a bug. It is asynchronous replication working exactly as specified, and the defect is that nobody stated an RPO and decided that losing acknowledged bookings was acceptable.

**How to confirm:**

1. **Correlate the missing bookings' timestamps against the failover times.** If they cluster in the seconds before each promotion, the hypothesis is confirmed. This is decisive and takes one query.
2. **Check whether the old primary's log contains them.** If the failed instance's storage survived, the lost writes are recoverable — which both confirms the diagnosis and offers immediate remediation for the affected customers.
3. **Look at the write-acknowledgement path** for anything that confirms to the user before the database commit returns. A worth-ruling-out alternative: if the application acknowledges optimistically and the commit later fails, you get the same symptom with a different cause and a different fix.

**Second hypothesis worth holding: an application-level acknowledgement before commit.** If the confirmation is sent from a queue consumer or a fire-and-forget path, a rollback after the user has been told produces exactly this. Distinguished from failover loss by whether the missing bookings cluster around the failover windows or are spread evenly.

**Fixes, in order:**

**Synchronous replication to at least one replica.** For a booking system the RPO should be zero: a confirmed booking that vanishes means a customer arriving at a venue with no seat. Every commit then costs a round trip to that replica, and I would measure the added latency before committing to it — but this is the fix that makes the class of bug impossible rather than rarer.

**Decide what happens when the synchronous replica is unavailable.** Block and alert, or degrade to asynchronous. Degrading silently reintroduces the bug at exactly the moment things are already going wrong, so for bookings I would block — and accept that a replica failure becomes a write outage, deliberately.

**Promote the synchronous replica specifically**, since it is the one guaranteed to hold every acknowledged write.

**Fence the old primary**, so a partition cannot produce two primaries both taking bookings — a worse failure than the one being fixed.

**And a process fix: state the RPO.** The root cause here is not technical. Asynchronous replication was chosen by default, which is a decision to lose acknowledged writes, and nobody made that decision explicitly. Writing down "RPO for bookings: zero" is what turns this from a mysterious defect into a specified requirement with a known implementation cost.

**Transferable:** when a symptom is rare, spread over time, and involves data that was definitely acknowledged, look for an event that resets state rather than a bug in the steady-state path. Failovers, deploys, and cache flushes all produce low-rate anomalies that no amount of reading the request path will explain.`,
    },
  ],

  revision: {
    bullets: [
      'One primary takes writes and streams its log to replicas that serve reads. A replica is always behind.',
      'You trade a read-capacity limit for a consistency problem, and the consistency problem is now the application\'s.',
      'The database never tells you a read was stale — it answered correctly from the data it had.',
      'Three named anomalies: read-after-write, monotonic reads, consistent prefix. None of them error.',
      'Read-after-write is fixed by recency routing or by carrying the write\'s log position.',
      'Monotonic reads are fixed by pinning a session to one replica.',
      'Causal consistency has no routing fix — keep causally related reads on the primary or accept the anomaly.',
      'Lag governs read staleness; RPO governs how much acknowledged data a failover loses. Different questions.',
      'Asynchronous replication is a decision to lose acknowledged writes on promotion. State the RPO before choosing it.',
      'Synchronous replication costs a round trip per commit, and you must decide whether the primary blocks or degrades when the replica is gone.',
      'Any read whose result determines a write must come from the primary, inside the transaction.',
      'Default reads to the primary and move queries to replicas deliberately, per query, with a stated budget.',
      'Split brain is prevented by fencing, not by fast promotion.',
      'Failover recovery time depends on how clients discover the primary — a DNS TTL is a floor.',
      'Replicas scale reads only. Every replica applies every write, so writes are capped by one machine.',
      'Replication lag is a property of the primary\'s write pattern, not of the replicas.',
      'Long analytical queries get a dedicated replica: they hold a snapshot open and delay replication on the instance running them.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Copying a database\'s write-ahead log to additional instances, so that reads can be served from several machines and a replica can be promoted if the primary fails.',
    whyItExists:
      'Reads outgrow one machine before writes do, and a single instance is a single point of failure. Replication addresses both, and it introduces lag.',
    whenToUse: [
      'When read capacity is the bottleneck and a stated staleness budget is acceptable for most queries.',
      'For availability and disaster recovery, even if replicas serve no reads at all.',
      'A dedicated replica for long analytical queries, isolated from the ones serving users.',
    ],
    whenNotToUse: [
      'When writes are the bottleneck, or the dataset exceeds one machine — those need partitioning.',
      'As a global read-routing setting; routing is a per-query staleness decision.',
      'For any read whose result determines a subsequent write.',
    ],
    alternatives: [
      'Partitioning, when writes or storage rather than reads are the constraint.',
      'A cache, which reduces read load without adding a full copy or a failover story.',
      'A warehouse fed by change events, when the analytical need wants a different storage shape.',
      'Multi-primary with writes partitioned by home region, when cross-region write latency genuinely forces it.',
    ],
    tradeoffs: [
      'Replicas buy read capacity and cost replication lag as an application concern.',
      'Asynchronous replication buys write latency and costs acknowledged writes on failover.',
      'Synchronous replication buys a zero RPO and costs a round trip per commit plus an availability decision.',
      'Sticky sessions buy monotonic reads and cost uneven replica load.',
    ],
    failureModes: [
      'Read-after-write: a user sees their own write missing and repeats it.',
      'Monotonic reads: a page appears to move backwards across refreshes.',
      'Consistent prefix: a reply visible before the message it replies to.',
      'Overselling from a stock check on a replica followed by a write on the primary.',
      'Acknowledged writes lost during failover under asynchronous replication.',
      'Split brain from promotion without fencing.',
      'Replication lag spiking because of a long transaction or bulk import on the primary.',
      'A long analytical query on a shared replica delaying its replication while users read from it.',
    ],
    followUpQuestions: [
      'What is your current replication lag, and what alerts on it?',
      'What is the staleness budget for this specific query?',
      'Does any read here determine a subsequent write?',
      'What is your RPO, and does your replication mode deliver it?',
      'What stops the old primary accepting writes after promotion?',
      'When did you last test failover?',
    ],
  },
});
