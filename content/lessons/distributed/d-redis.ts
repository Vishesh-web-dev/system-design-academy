import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-redis',
  title: 'Redis in practice',
  summary:
    'Redis is a data-structure server, not a cache with extra features — the structure you choose is the design, and it decides what is atomic, what is cheap, and what will block the single thread.',
  phase: 'distributed',
  module: 'serving',
  position: 20,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['redis', 'data-structures', 'atomicity', 'persistence', 'caching'],
  prerequisites: ['d-caching'],
  resources: [
    {
      key: 'redis-data-types',
      tier: 'must',
      note: 'Read this as a catalogue of designs rather than of types. Each structure comes with a set of atomic operations, and those operations are what you are actually choosing between.',
    },
    {
      key: 'redis-persistence',
      tier: 'must',
      note: 'Snapshotting versus append-only, and precisely what each can lose. Read it before treating Redis as durable, because the default configuration can lose the last seconds of writes.',
    },
    {
      key: 'redis-expire',
      tier: 'must',
      note: 'Expiry is lazy plus a background sampler, so an expired key can still occupy memory and a mass expiry is not instantaneous. This explains several surprising memory behaviours.',
    },
    {
      key: 'redis-cluster-spec',
      tier: 'good',
      note: 'Hash slots, resharding, and the rule that a multi-key operation must stay within one slot. That constraint is what makes cluster mode a modelling decision rather than a deployment detail.',
    },
    {
      key: 'redis-streams',
      tier: 'good',
      note: 'Consumer groups with acknowledgement and a pending-entries list. Worth reading to see where Redis stops being a cache and starts being a log.',
    },
    {
      key: 'redis-pubsub',
      tier: 'advanced',
      note: 'Read it specifically for what it does not guarantee: fire-and-forget with no persistence, so a disconnected subscriber loses messages permanently.',
    },
  ],

  intuition: {
    body: `Most people meet Redis as "a fast key-value cache" and never revise that model. It is a genuinely limiting way to think about it, because it hides where all the leverage is.

Redis is a **data-structure server**. It holds strings, hashes, lists, sets, sorted sets, bitmaps, HyperLogLogs and streams — in memory, on a single thread — and exposes atomic operations on each. The interesting consequence is that many problems people solve with a read-modify-write cycle against a cache are instead **one atomic command** against the right structure.

A rate limiter is not "read the count, check it, write it back". It is \`INCR\` plus \`EXPIRE\`. A leaderboard is not "fetch all scores and sort". It is a sorted set and \`ZREVRANGE\`. A job queue is not "poll for work". It is \`BLPOP\`. In each case the structure eliminates a concurrency problem rather than requiring you to manage it.

Two properties make that work, and both are worth internalising because they also explain Redis's failure modes:

**It is single-threaded for command execution.** So every command is atomic with respect to every other command — no locks, no transactions needed for a single operation. And a slow command blocks *everything*, which is the source of most Redis incidents.

**It is in memory.** So operations are sub-millisecond, and your data is bounded by RAM, and persistence is a configurable afterthought rather than a guarantee.

The framing to carry: **when you reach for Redis, the question is not "what key" but "which structure".** Choosing correctly usually collapses a design problem into one command.`,
    analogyLimit:
      'Calling Redis "a fast dictionary" is the model to discard. A dictionary has no atomic compound operations, no ordering, no expiry, no blocking reads and no set algebra — and those are precisely the features that make Redis the answer to problems a dictionary cannot solve. The single-threaded execution model is also the opposite of what people assume about a high-performance server, and it is why one badly chosen command can stall an entire cluster node.',
  },

  deepExplanation: {
    predict: {
      question:
        'A service needs a per-user rate limit of 100 requests per minute. A developer implements it as: `GET count:user:42`, check it against 100, then `SET count:user:42 <n+1> EX 60`. Name three defects, and give the correct implementation as commands.',
      answer: `**Defect 1 — a lost update.** Two concurrent requests both \`GET\` the same value, both compute \`n+1\`, both \`SET\`. One increment is discarded, so the limiter under-counts and lets more traffic through than it should. This is the read-modify-write race, and it is the whole reason \`INCR\` exists.

**Defect 2 — the window resets on every request.** \`SET ... EX 60\` rewrites the expiry each time, so a user making a request every 30 seconds never has their counter expire. The window is not "per minute" — it is "since the last 60-second gap in their traffic", which is a completely different and much more permissive limit.

**Defect 3 — three round trips per request.** \`GET\`, then application logic, then \`SET\`. On a rate limiter that runs before every request, that is three round trips of overhead on the hot path, and the logic is not atomic across them.

**The correct implementation:**

\`\`\`
INCR  count:user:42        → returns the new value
EXPIRE count:user:42 60 NX   → set expiry only if none exists
\`\`\`

\`INCR\` is atomic and returns the post-increment value, so the check happens in the application against a value that cannot be stale. \`EXPIRE ... NX\` sets the TTL only when the key has none — so the first request of a window starts the clock and subsequent ones do not extend it.

Both commands can be pipelined, or wrapped in a small Lua script to make the pair atomic. The script version is what you want if you need the increment and the expiry to be inseparable — for instance to guarantee a key can never exist without a TTL and leak memory forever.

**The general lesson:** the read-modify-write pattern is a signal that you have chosen the wrong structure or the wrong command. Redis almost always has an atomic operation that does what the cycle was approximating, and using it removes the concurrency problem rather than managing it.`,
    },
  body: `## The structures, and the problems they collapse

| Structure | Atomic operations that matter | What it collapses |
| --- | --- | --- |
| String | \`INCR\`, \`SETNX\`, \`SET ... EX NX\`, \`GETSET\` | Counters, locks, rate limits, feature flags |
| Hash | \`HINCRBY\`, \`HSET\`, \`HGETALL\` | An object with independently updatable fields |
| List | \`LPUSH\`, \`BRPOP\`, \`LRANGE\` | Queues, capped recent-activity feeds |
| Set | \`SADD\`, \`SISMEMBER\`, \`SINTER\` | Membership, deduplication, tag intersection |
| Sorted set | \`ZADD\`, \`ZREVRANGE\`, \`ZRANGEBYSCORE\`, \`ZREMRANGEBYSCORE\` | Leaderboards, priority queues, sliding windows, time-ordered indexes |
| Bitmap | \`SETBIT\`, \`BITCOUNT\` | Dense per-user flags, daily-active tracking |
| HyperLogLog | \`PFADD\`, \`PFCOUNT\` | Approximate distinct counts in ~12 KB regardless of cardinality |
| Stream | \`XADD\`, \`XREADGROUP\`, \`XACK\` | An append-only log with consumer groups and acknowledgement |

Two entries repay attention because they are the ones most often reinvented badly.

**The sorted set is the most versatile structure here.** Score by timestamp and it is a time index you can range over; score by points and it is a leaderboard with \`O(log n)\` rank queries; score by expiry and \`ZREMRANGEBYSCORE\` becomes a sliding-window prune. A very large fraction of "I need to keep the last N things, ordered" problems are one sorted set.

**HyperLogLog trades exactness for a constant memory footprint.** Counting distinct visitors with a set costs memory proportional to visitors; with HyperLogLog it costs about 12 KB with roughly 0.8% error, forever. When the answer is a dashboard number, that is an excellent trade, and knowing it exists is what stops someone storing ten million user ids in a set.

## Single-threaded execution: the property that explains the incidents

Redis executes commands one at a time. Two consequences pull in opposite directions.

**The good one:** every command is atomic against every other. No locks, no transactions, no read-modify-write races — for a single command. This is why \`INCR\` is a complete rate-limiter primitive rather than a building block.

**The bad one:** a slow command blocks every other client. And several commands are slow in ways that look innocent:

- \`KEYS *\` scans the entire keyspace. On a million keys this stalls the server for seconds. **Never run it in production**; use \`SCAN\`, which is cursor-based and yields between batches.
- \`FLUSHALL\` and \`FLUSHDB\` on a large dataset block while freeing memory.
- \`SMEMBERS\` or \`HGETALL\` on a structure with a million elements transfers and serialises all of it while nothing else runs.
- Deleting one enormous key blocks proportionally to its size. \`UNLINK\` frees it in a background thread instead.
- A Lua script runs to completion atomically, so a slow script is a stall you wrote yourself.

The operational rule that follows: **big keys are dangerous, and the danger is latency for everyone else.** A single hash with ten million fields is not a storage problem — it is a per-command stall for every other client.

## Persistence: what Redis can lose

Redis is in memory. Durability is configurable and the defaults are weaker than most people assume.

**RDB snapshots.** A point-in-time fork-and-dump on an interval. Compact, fast to restore, and **you lose everything since the last snapshot** — which by default can be minutes.

**AOF (append-only file).** Every write appended to a log. With \`everysec\` fsync — the usual setting — you lose up to one second of writes. With \`always\` you lose nothing and pay an fsync per write, which costs a great deal of throughput.

**Both together** is the common production choice: AOF for recency, RDB for fast restarts.

The honest framing: **treat Redis as a cache or as a store with an explicit, accepted data-loss window.** Using it as the source of truth for anything you cannot regenerate requires \`always\` fsync plus replication, at which point you have built a slow database and should ask whether you wanted a database.

Two related surprises:

**Replication is asynchronous by default.** A failover can lose acknowledged writes, exactly as in the replication lesson. \`WAIT\` lets a client block until N replicas have the write, which converts this into a latency cost you choose per operation.

**Expiry is lazy plus sampled.** A key is removed when accessed after expiry, or when a background cycle happens to sample it. So an expired key can occupy memory for a while, and a mass expiry does not free memory instantly — which explains memory graphs that do not drop when you expect.

## Eviction, and the setting that causes outages

When \`maxmemory\` is reached, the eviction policy decides what happens. The default in many builds is \`noeviction\`, which means **writes start failing** rather than data being discarded.

For a cache that is exactly wrong: you want \`allkeys-lru\` or \`allkeys-lfu\`, so the cache sheds cold data and keeps serving. For a store where every key matters, \`noeviction\` is correct and you must monitor memory as a hard limit.

The failure mode worth recognising: a Redis used as a cache with \`noeviction\` fills up, writes begin failing, and the application — which treats cache writes as best-effort — logs errors nobody reads while the hit rate silently decays to zero.

## Cluster mode and the multi-key constraint

Redis Cluster shards the keyspace across nodes by hash slot. One rule dominates the design: **a multi-key operation must have all its keys in the same slot.**

So \`SINTER user:1:tags user:2:tags\` fails across nodes, and a Lua script touching two keys requires both to be co-located. The mechanism is **hash tags**: only the part of the key inside braces is hashed, so \`{user:42}:profile\` and \`{user:42}:sessions\` land together deliberately.

This makes key naming a partitioning decision, exactly as in the NoSQL lesson — and it means adopting cluster mode can break working code that assumed multi-key atomicity.

## Where Redis is the wrong tool

**As a durable source of truth**, unless you have accepted a loss window and configured for it.
**As a queue with delivery guarantees** — lists are fire-and-forget on the consumer side, and pub/sub loses messages for any disconnected subscriber. Streams with consumer groups are the right structure if you stay within Redis, and a real broker is the right answer if guarantees matter.
**For datasets far larger than RAM.** There is no spill-to-disk in the way a database has.
**For complex queries.** No joins, no ad-hoc filtering, no planner. It answers the questions your key and structure design anticipated.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'structure-choice',
      title: 'Choosing a structure collapses the problem',
      caption:
        'Read the right-hand column. In every case the structure turns a read-modify-write cycle into one atomic command — so a concurrency problem is removed rather than managed.',
      code: `flowchart LR
    A["A number that goes up"] --> A1["String + INCR<br/>atomic, no race"]
    B["A number per minute"] --> B1["INCR + EXPIRE NX<br/>window does not extend"]
    C["Top N by score"] --> C1["Sorted set + ZREVRANGE<br/>O(log n) rank"]
    D["Last N events, ordered"] --> D1["Sorted set scored by time<br/>ZREMRANGEBYSCORE to prune"]
    E["Is X a member?"] --> E1["Set + SISMEMBER<br/>O(1)"]
    F["How many distinct?"] --> F1["HyperLogLog + PFCOUNT<br/>~12 KB, 0.8% error"]
    G["Work handed to a worker"] --> G1["List + BRPOP<br/>blocking, no polling"]
    H["Work with acknowledgement"] --> H1["Stream + XREADGROUP/XACK<br/>pending list survives a crash"]
    I["Object with independent fields"] --> I1["Hash + HINCRBY / HSET"]

    style A1 fill:#17272a,stroke:#35897e
    style B1 fill:#17272a,stroke:#35897e
    style C1 fill:#17272a,stroke:#35897e
    style D1 fill:#17272a,stroke:#35897e
    style F1 fill:#1c1814,stroke:#c99a4e
    style H1 fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'single-thread',
      title: 'One thread, and the four ways to stall it',
      caption:
        'Step through it. Every stall shown is self-inflicted and avoidable, and each one affects every other client — which is why "big keys are dangerous" is a latency statement rather than a storage one.',
      nodes: [
        { id: 'clients', label: 'Many clients', kind: 'client', x: 0, y: 150, detail: 'Thousands of connections, all served by one command-execution thread. Throughput is high because each command is tiny — which is the assumption a slow command violates.' },
        { id: 'thread', label: 'Command thread', kind: 'service', x: 200, y: 150, detail: 'Executes one command at a time to completion. This is what makes every command atomic against every other, and it is why one slow command is everyone\'s latency.' },
        { id: 'keys', label: 'KEYS *', kind: 'note', x: 420, y: 20, detail: 'Scans the entire keyspace. Seconds of full stall on a million keys. Use SCAN, which is cursor-based and yields between batches.' },
        { id: 'bigkey', label: 'HGETALL on a huge hash', kind: 'note', x: 420, y: 110, detail: 'Transfers and serialises every field while nothing else runs. The fix is modelling: split the structure, or page through it with HSCAN.' },
        { id: 'del', label: 'DEL on a huge key', kind: 'note', x: 420, y: 200, detail: 'Frees memory synchronously, proportional to size. UNLINK does it in a background thread and returns immediately.' },
        { id: 'lua', label: 'A slow Lua script', kind: 'note', x: 420, y: 290, detail: 'Runs atomically to completion, so a loop over ten thousand keys is a stall you authored. Scripts should be short by construction.' },
        { id: 'mem', label: 'maxmemory reached', kind: 'store', x: 650, y: 150, detail: 'With noeviction — a common default — writes begin failing. For a cache that is exactly wrong: allkeys-lru sheds cold data and keeps serving.' },
        { id: 'persist', label: 'Persistence', kind: 'store', x: 650, y: 290, detail: 'RDB loses everything since the last snapshot; AOF with everysec loses up to a second. Neither default makes Redis a source of truth.' },
      ],
      edges: [
        { id: 'r1', source: 'clients', target: 'thread', kind: 'sync' },
        { id: 'r2', source: 'thread', target: 'keys', kind: 'control' },
        { id: 'r3', source: 'thread', target: 'bigkey', kind: 'control' },
        { id: 'r4', source: 'thread', target: 'del', kind: 'control' },
        { id: 'r5', source: 'thread', target: 'lua', kind: 'control' },
        { id: 'r6', source: 'thread', target: 'mem', kind: 'write' },
        { id: 'r7', source: 'mem', target: 'persist', kind: 'async' },
      ],
      steps: [
        {
          id: 't1',
          title: 'One thread is why atomicity is free',
          description:
            'Commands execute one at a time to completion, so no two operations interleave. That is what makes INCR a complete rate-limiter primitive and removes the need for locks around single operations.',
          nodes: ['clients', 'thread'],
          edges: ['r1'],
        },
        {
          id: 't2',
          title: 'And why one slow command is everyone\'s problem',
          description:
            'KEYS scans the keyspace; HGETALL on a million-field hash serialises all of it; DEL on a huge key frees memory synchronously. Each blocks every other client for the duration.',
          nodes: ['keys', 'bigkey', 'del'],
          edges: ['r2', 'r3', 'r4'],
        },
        {
          id: 't3',
          title: 'A Lua script is a stall you authored',
          description:
            'Scripts run atomically to completion, which is exactly why they are useful for compound operations — and it means a loop over many keys inside a script blocks the server. Keep them short by construction.',
          nodes: ['lua'],
          edges: ['r5'],
        },
        {
          id: 't4',
          title: 'Then the two settings that cause outages',
          description:
            'noeviction on a cache means writes fail when memory fills, while the application logs best-effort errors nobody reads. And the persistence defaults mean a restart or failover can lose seconds of writes.',
          nodes: ['mem', 'persist'],
          edges: ['r6', 'r7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The most instructive production pattern is the sliding-window rate limiter, because it shows a structure choice eliminating a problem that would otherwise need careful concurrency work.

The naive approach is a fixed window: \`INCR\` a key named for the current minute, with a 60-second expiry. Simple, atomic, and it has a well-known defect — a client can send 100 requests in the last second of one window and 100 in the first second of the next, so the effective limit is double the intended rate over a two-second span.

A sliding window fixes it, and a sorted set makes it three commands:

1. \`ZREMRANGEBYSCORE key 0 <now - 60s>\` — drop entries older than the window.
2. \`ZADD key <now> <unique-request-id>\` — record this request, scored by timestamp.
3. \`ZCARD key\` — count what remains.

Wrapped in a Lua script or a transaction, the three are atomic. There is no read-modify-write, no lock, and no race — the structure's ordering gives you the window for free, and the atomic prune replaces what would otherwise be a background cleanup job.

Two costs worth naming, because a design that only lists benefits is incomplete:

**Memory is proportional to requests, not to users.** A fixed-window counter is one integer per user; the sliding window stores one entry per request in the window. At high volume that matters, and the mitigation is either accepting the fixed-window inaccuracy or using an approximate sliding window that interpolates between two fixed counters.

**The key must carry a TTL.** If the prune is the only cleanup, a user who stops sending requests leaves a key forever. Setting an expiry alongside the \`ZADD\` is the fix, and forgetting it is a slow memory leak that only appears months later.

Two transferable lessons:

**The structure is the design.** The difference between a broken fixed-window limiter and a correct sliding-window one is which Redis type you chose, not how carefully you wrote the application logic.

**Every Redis key needs an answer to "when does this go away".** The most common Redis memory incident is not a burst of traffic — it is a key pattern created without a TTL that accumulates for months.`,
  },

  tradeoffs: {
    intro:
      'Two decisions bundled: which structure solves the problem, and how much durability you are buying. Rows cover both.',
    rows: [
      {
        option: 'Plain strings with GET/SET',
        whenItWins:
          'Simple caching of serialised values, feature flags, session blobs. Nothing to learn and nothing to get wrong.',
        whenItLoses:
          'Anything involving a counter, ordering, membership or partial update — where it forces a read-modify-write cycle and its races.',
        cost:
          'Read-modify-write concurrency bugs, and transferring a whole value to change one field.',
      },
      {
        option: 'The right specialised structure',
        whenItWins:
          'Almost always. INCR for counters, sorted sets for anything ordered or windowed, sets for membership, hashes for partial updates. One atomic command replaces a cycle.',
        whenItLoses:
          'When it tempts you to keep growing one structure — a million-element set is a per-command stall for every client.',
        cost:
          'Learning the command set, and modelling discipline to keep individual structures small.',
      },
      {
        option: 'Redis as a cache, with allkeys-lru and no persistence',
        whenItWins:
          'The default and correct configuration for a cache. Sheds cold data under pressure and keeps serving; a restart costs a cold start rather than data.',
        whenItLoses:
          'When the data cannot be regenerated, or when a cold start would overwhelm the source.',
        cost:
          'Everything is lost on restart, so the source must survive cold-cache load.',
      },
      {
        option: 'Redis as a store, with AOF everysec and replication',
        whenItWins:
          'Rate-limit state, session data, ephemeral job state — things where losing a second is acceptable and regenerating is not.',
        whenItLoses:
          'Anything requiring zero loss. Asynchronous replication plus everysec fsync is an explicit loss window.',
        cost:
          'An accepted data-loss window, plus fsync overhead and memory for AOF rewrites.',
      },
      {
        option: 'Redis Streams with consumer groups',
        whenItWins:
          'Work queues needing acknowledgement and crash recovery, when you already run Redis and the volume is modest.',
        whenItLoses:
          'When you need a real broker\'s retention, replay across days, or cross-datacentre durability.',
        cost:
          'Consumer-group state to manage, a pending-entries list to monitor, and memory proportional to retained entries.',
      },
      {
        option: 'Pub/sub for messaging',
        whenItWins:
          'Fire-and-forget fan-out where losing messages is acceptable: cache-invalidation broadcasts, presence pings.',
        whenItLoses:
          'Anything that must be delivered. A subscriber that is disconnected for a moment loses every message sent in that moment, permanently.',
        cost:
          'No persistence, no acknowledgement, no replay. It is a broadcast, not a queue.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We read the counter, check the limit, then write it back with a new expiry."',
      whyWeak:
        'Two defects at once. The read-modify-write loses concurrent increments, so the limiter under-counts. And rewriting the expiry on every request means the window never closes for an active client — the limit becomes "since your last 60-second gap" rather than per minute.',
      strongAnswer:
        '"`INCR` returns the new value atomically, so there is no race and no separate read. Then `EXPIRE key 60 NX` sets the TTL only if none exists, so the first request of a window starts the clock and later ones do not extend it. If the pair must be inseparable I would wrap them in a short Lua script."',
    },
    {
      weakAnswer: '"We run `KEYS session:*` to find active sessions."',
      whyWeak:
        'KEYS scans the entire keyspace and Redis is single-threaded, so on a million keys this stalls every other client for seconds. It is one of the few commands that is genuinely dangerous in production regardless of how carefully it is used.',
      strongAnswer:
        '"`SCAN` with a match pattern, which is cursor-based and yields between batches so other commands interleave. Better still, if I need to enumerate a set of things I would maintain that set explicitly — a Redis set of active session ids — rather than deriving it by scanning the keyspace."',
    },
    {
      weakAnswer: '"Redis persists to disk, so we use it as our session store and sessions survive restarts."',
      whyWeak:
        'Persistence is configurable and the defaults lose data. RDB snapshots lose everything since the last snapshot, which can be minutes; AOF with the usual `everysec` fsync loses up to a second. Replication is asynchronous, so a failover can lose acknowledged writes too.',
      strongAnswer:
        '"Sessions are a reasonable fit *if* we accept a loss window and configure for it — AOF with everysec means up to a second of new sessions lost on a hard failure, and a failover can lose more because replication is async. I would state that as the accepted RPO. If losing any session is unacceptable, that is a database."',
    },
    {
      weakAnswer: '"We store all user ids who visited today in a set so we can count them."',
      whyWeak:
        'Memory grows with visitors, and a set with ten million members is both large and a per-command hazard — `SMEMBERS` or `SCARD` on it stalls the single thread. If the requirement is a count rather than membership, the set is storing far more than is needed.',
      strongAnswer:
        '"If I only need the count, HyperLogLog gives it in about 12 KB regardless of cardinality, with roughly 0.8% error — an excellent trade for a dashboard number. I would keep a set only if I need to ask whether a *specific* user visited, and then I would consider a bitmap keyed by a dense user index instead."',
    },
    {
      weakAnswer: '"We use a Redis list as our job queue — `LPUSH` to enqueue, `BRPOP` to consume."',
      whyWeak:
        'Once a worker pops a job, the job is gone from Redis. If that worker crashes mid-processing, the job is lost with no record and no retry. Lists give you a queue with no delivery guarantee.',
      strongAnswer:
        '"Lists are fire-and-forget once popped. If losing a job on a worker crash is unacceptable I would use Streams with consumer groups: `XREADGROUP` assigns an entry and keeps it in a pending list until `XACK`, so a crashed consumer\'s work can be claimed by another. If I need retention and replay across days, that is a real broker rather than Redis."',
    },
    {
      weakAnswer: '"We broadcast cache invalidations over pub/sub, so every instance stays in sync."',
      whyWeak:
        'Pub/sub is fire-and-forget with no persistence. An instance that is restarting, briefly disconnected, or slow to read misses those messages permanently — and then holds a stale in-process cache entry with nothing to correct it.',
      strongAnswer:
        '"Pub/sub is fine as an optimisation and cannot be the correctness mechanism, because a disconnected subscriber loses messages permanently. I would pair it with a short TTL on the in-process cache so a missed invalidation is bounded rather than forever, or use Streams so a reconnecting instance can read what it missed."',
    },
  ],

  flashcards: [
    {
      id: 'fc-redis-1',
      front: 'What is the framing that makes Redis useful rather than "a fast cache"?',
      back: 'It is a data-structure server. The question is not "what key" but "which structure" — and the right structure usually collapses a read-modify-write cycle into one atomic command.',
      topic: 'redis',
    },
    {
      id: 'fc-redis-2',
      front: 'What does single-threaded execution buy and cost?',
      back: 'Buys atomicity of every command against every other, so no locks are needed for single operations. Costs: one slow command blocks every other client.',
      topic: 'atomicity',
    },
    {
      id: 'fc-redis-3',
      front: 'What is wrong with `SET count <n+1> EX 60` as a rate limiter?',
      back: 'The read-modify-write loses concurrent increments, and rewriting the expiry each time means the window never closes for an active client. Use `INCR` plus `EXPIRE ... NX`.',
      topic: 'atomicity',
    },
    {
      id: 'fc-redis-4',
      front: 'Why is the sorted set the most versatile Redis structure?',
      back: 'Score by timestamp for a time index, by points for a leaderboard, by expiry for a sliding window. Range queries and `ZREMRANGEBYSCORE` pruning come free.',
      topic: 'data-structures',
    },
    {
      id: 'fc-redis-5',
      front: 'What does HyperLogLog trade, and what does it buy?',
      back: 'Exactness for constant memory: distinct counts in about 12 KB with roughly 0.8% error, regardless of cardinality.',
      topic: 'data-structures',
    },
    {
      id: 'fc-redis-6',
      front: 'Why must you never run `KEYS` in production?',
      back: 'It scans the whole keyspace on a single-threaded server, stalling every client for seconds. `SCAN` is cursor-based and yields between batches.',
      topic: 'redis',
    },
    {
      id: 'fc-redis-7',
      front: 'Why are big keys dangerous, and what is the danger exactly?',
      back: 'Latency for everyone else. `HGETALL` or `SMEMBERS` on a million-element structure serialises all of it while nothing else runs, and `DEL` frees it synchronously — use `UNLINK` instead.',
      topic: 'redis',
    },
    {
      id: 'fc-redis-8',
      front: 'What can Redis lose under each persistence mode?',
      back: 'RDB: everything since the last snapshot, potentially minutes. AOF with everysec: up to one second. AOF with always: nothing, at a large throughput cost.',
      topic: 'persistence',
    },
    {
      id: 'fc-redis-9',
      front: 'Why does `noeviction` cause outages on a cache?',
      back: 'When maxmemory is reached, writes start failing rather than cold data being shed. The application treats cache writes as best-effort, so errors go unread while the hit rate decays to zero.',
      topic: 'persistence',
    },
    {
      id: 'fc-redis-10',
      front: 'Why can expired keys still occupy memory?',
      back: 'Expiry is lazy plus sampled: a key is removed when accessed after expiry or when a background cycle samples it. So a mass expiry does not free memory instantly.',
      topic: 'persistence',
    },
    {
      id: 'fc-redis-11',
      front: 'What is the one rule that dominates Redis Cluster design?',
      back: 'A multi-key operation must have all keys in the same hash slot. Hash tags — `{user:42}:profile` — force co-location, which makes key naming a partitioning decision.',
      topic: 'redis',
    },
    {
      id: 'fc-redis-12',
      front: 'Why is a Redis list a queue with no delivery guarantee?',
      back: 'Once a worker pops a job it is gone from Redis, so a crash mid-processing loses it. Streams with consumer groups keep entries in a pending list until acknowledged.',
      topic: 'data-structures',
    },
    {
      id: 'fc-redis-13',
      front: 'Why can pub/sub not be a correctness mechanism?',
      back: 'It is fire-and-forget with no persistence, so a subscriber that is disconnected or restarting loses those messages permanently — with nothing to correct the resulting stale state.',
      topic: 'data-structures',
    },
    {
      id: 'fc-redis-14',
      front: 'What question must every Redis key pattern answer?',
      back: '"When does this go away?" The commonest Redis memory incident is a key pattern created without a TTL that accumulates for months.',
      topic: 'caching',
    },
  ],

  quiz: [
    {
      id: 'q-redis-1',
      kind: 'scenario',
      prompt:
        'A rate limiter uses `GET`, then application-side check, then `SET key <n+1> EX 60`. Under load it lets roughly 130 requests through against a limit of 100, and an always-active client is never limited at all. Explain both symptoms.',
      options: [
        { id: 'a', label: 'Read-modify-write loses concurrent increments (under-counting), and rewriting EX on every request means the window never expires for an active client' },
        { id: 'b', label: 'The expiry is too short and should be 120 seconds' },
        { id: 'c', label: 'Redis is evicting the counter under memory pressure' },
        { id: 'd', label: 'The client clock is skewed relative to the server' },
      ],
      correct: ['a'],
      explanation:
        'Two independent defects producing two symptoms. Concurrent GETs read the same value so increments are lost, letting extra requests through. And `SET ... EX 60` resets the TTL each time, so a client sending a request every 30 seconds keeps the counter alive indefinitely — though that counter also keeps growing, which is why the never-limited symptom depends on the under-count. `INCR` plus `EXPIRE ... NX` fixes both.',
      difficulty: 'core',
      topic: 'atomicity',
    },
    {
      id: 'q-redis-2',
      kind: 'scenario',
      prompt:
        'p99 latency across every Redis operation spikes to 900 ms for two seconds, several times an hour, affecting all clients simultaneously. CPU is moderate and memory is stable. What is the leading hypothesis?',
      options: [
        { id: 'a', label: 'A slow command is blocking the single execution thread — a KEYS scan, a large HGETALL, a big DEL, or a slow Lua script' },
        { id: 'b', label: 'Network congestion between clients and Redis' },
        { id: 'c', label: 'The eviction policy is thrashing' },
        { id: 'd', label: 'AOF rewrites are saturating disk I/O' },
      ],
      correct: ['a'],
      explanation:
        'Every client affected simultaneously, for a bounded period, with moderate CPU, is the signature of head-of-line blocking on the command thread. Network congestion would not align so precisely across all clients, and stable memory rules out eviction thrashing. The slow-log is the diagnostic, and AOF rewrites are a plausible secondary cause worth checking after the slow-log.',
      difficulty: 'advanced',
      topic: 'redis',
    },
    {
      id: 'q-redis-3',
      kind: 'single',
      prompt: 'Which structure serves "the top 50 players by score, plus a given player\'s rank"?',
      options: [
        { id: 'a', label: 'A sorted set — ZREVRANGE for the top N, ZREVRANK for a rank, both O(log n)' },
        { id: 'b', label: 'A hash of player to score, sorted in the application' },
        { id: 'c', label: 'A list, kept in score order on insert' },
        { id: 'd', label: 'A set of player ids with scores stored as separate strings' },
      ],
      correct: ['a'],
      explanation:
        'A sorted set maintains order on write and answers both queries in logarithmic time. Sorting a hash in the application transfers every score on every request. A list has no efficient ordered insert or rank query. Separate strings require fetching all of them and sorting.',
      difficulty: 'intro',
      topic: 'data-structures',
    },
    {
      id: 'q-redis-4',
      kind: 'scenario',
      prompt:
        'Redis is used as a cache with `maxmemory` set and the default `noeviction` policy. Memory fills. What happens?',
      options: [
        { id: 'a', label: 'Writes begin failing while reads continue, so the hit rate silently decays as data ages out and nothing new is cached' },
        { id: 'b', label: 'Redis evicts the least recently used keys automatically' },
        { id: 'c', label: 'Redis begins spilling data to disk' },
        { id: 'd', label: 'Redis restarts and loads from its last snapshot' },
      ],
      correct: ['a'],
      explanation:
        'With `noeviction`, writes are rejected once maxmemory is reached. Because applications typically treat cache writes as best-effort, the errors are logged and ignored while the cache slowly stops being useful. For a cache the correct policy is `allkeys-lru` or `allkeys-lfu`, which shed cold data and keep serving.',
      difficulty: 'core',
      topic: 'persistence',
    },
    {
      id: 'q-redis-5',
      kind: 'scenario',
      prompt:
        'A job queue uses `LPUSH`/`BRPOP`. A worker pops a job, begins a 30-second external call, and its process is killed. What happens to the job?',
      options: [
        { id: 'a', label: 'It is lost — once popped, the entry no longer exists in Redis and there is no record of assignment' },
        { id: 'b', label: 'It is returned to the list after a visibility timeout' },
        { id: 'c', label: 'It remains in a pending list until acknowledged' },
        { id: 'd', label: 'Another worker picks it up when the connection drops' },
      ],
      correct: ['a'],
      explanation:
        'A list pop is destructive and unacknowledged, so nothing knows the job existed. Visibility timeouts and pending lists are features of Streams with consumer groups (or a real broker) — `XREADGROUP` retains the entry until `XACK`, so a crashed consumer\'s work can be claimed by another.',
      difficulty: 'core',
      topic: 'data-structures',
    },
    {
      id: 'q-redis-6',
      kind: 'multi',
      prompt:
        'Which of these are true of Redis Cluster? Select all that apply.',
      options: [
        { id: 'a', label: 'A multi-key command requires all its keys in the same hash slot' },
        { id: 'b', label: 'Hash tags let you force related keys onto the same slot' },
        { id: 'c', label: 'Adopting cluster mode can break working code that relied on multi-key atomicity' },
        { id: 'd', label: 'Cluster mode makes single-key operations transactional across nodes' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The same-slot rule is the constraint that makes key naming a partitioning decision, hash tags are the mechanism for controlling it, and code written against a single instance can break on migration. Nothing about cluster mode adds cross-node transactions — if anything it removes the atomicity guarantees a single instance provided.',
      difficulty: 'advanced',
      topic: 'redis',
    },
  ],

  exercises: [
    {
      id: 'ex-redis-1',
      kind: 'design',
      title: 'Pick the structure, then find what breaks it',
      estimatedMinutes: 25,
      prompt: `Design the Redis usage for five features of a live-events platform. For each: the structure, the commands, the key naming, the TTL, and one thing that would break it at scale.

1. **Per-user rate limit** — 200 requests per minute, accurate enough that a burst across a window boundary does not double the effective limit.
2. **Live leaderboard** — top 100 by score for an event, plus "your rank", updated continuously. 50,000 participants per event.
3. **Unique viewers today** — a dashboard number, per event. Up to 2 million viewers.
4. **"Recently viewed events"** — the last 20 per user, most recent first, no duplicates.
5. **Cache-invalidation broadcast** — when an event's details change, every application instance must drop its in-process copy.

Then answer: the platform runs Redis Cluster. Which of your five designs needs attention, and why?`,
      rubric: [
        'Rate limit: sorted set sliding window with ZREMRANGEBYSCORE/ZADD/ZCARD, or an explicit acknowledgement of fixed-window inaccuracy, plus a TTL.',
        'Leaderboard: sorted set with ZADD, ZREVRANGE for the top N and ZREVRANK for a rank; notes ZREVRANGE over 50,000 is fine but returning all of them is not.',
        'Unique viewers: HyperLogLog with PFADD/PFCOUNT, justified by it being a count rather than a membership question.',
        'Recently viewed: sorted set scored by timestamp (giving dedup for free), or a list with LREM; explains why the sorted set is better.',
        'Invalidation: pub/sub as an optimisation with a short in-process TTL as the correctness mechanism, because pub/sub loses messages for disconnected subscribers.',
        'Every design has an explicit TTL or a stated reason it does not need one.',
        'Names a specific scale hazard per feature — big-key stalls, memory proportional to requests, or unbounded growth.',
        'Cluster answer identifies the multi-key operations and proposes hash tags or per-key redesign.',
      ],
      modelAnswer: `**1. Per-user rate limit — sorted set sliding window**

\`\`\`
Key: rl:{user:42}
ZREMRANGEBYSCORE rl:{user:42} 0 <now_ms - 60000>
ZADD             rl:{user:42} <now_ms> <request_uuid>
ZCARD            rl:{user:42}
EXPIRE           rl:{user:42} 120
\`\`\`

Wrapped in a Lua script so the four are atomic. The sorted set's ordering gives the sliding window directly, and the prune replaces a cleanup job.

*TTL:* 120 seconds — twice the window, so an inactive user's key disappears rather than leaking.

*What breaks it at scale:* **memory is proportional to requests, not users.** At 200 requests/minute × 100,000 active users that is 20 million entries in the window. A fixed-window counter would be 100,000 integers. If memory became the constraint I would switch to an approximate sliding window — two fixed counters interpolated by position in the window — which is far less accurate at boundaries and constant in memory. That is a trade I would want to make deliberately rather than discover.

**2. Live leaderboard — sorted set**

\`\`\`
Key: lb:{event:88}
ZADD      lb:{event:88} <score> <user_id>       -- on score change
ZREVRANGE lb:{event:88} 0 99 WITHSCORES         -- top 100
ZREVRANK  lb:{event:88} <user_id>               -- your rank
\`\`\`

*TTL:* set on the key at event end plus a retention period — say 7 days — so finished events age out. Without this, every event ever run stays in memory forever.

*What breaks it at scale:* **not the 50,000 members** — a sorted set of that size is unremarkable, and both queries are logarithmic. What breaks it is somebody adding a "download full leaderboard" feature that calls \`ZREVRANGE key 0 -1\`, serialising 50,000 members while every other client waits. The mitigation is refusing to expose that command path, and paginating with \`ZREVRANGE key <start> <start+99>\` instead.

**3. Unique viewers today — HyperLogLog**

\`\`\`
Key: uv:{event:88}:2026-09-07
PFADD   uv:{event:88}:2026-09-07 <user_id>
PFCOUNT uv:{event:88}:2026-09-07
\`\`\`

*Why:* the requirement is a **count**, not membership. A set of 2 million user ids is roughly 100+ MB per event per day; HyperLogLog is about 12 KB with ~0.8% error. For a dashboard number that error is invisible and the memory difference is four orders of magnitude.

*TTL:* 90 days, matching the reporting window.

*What breaks it at scale:* nothing, which is the point — memory is constant regardless of cardinality. The thing that would break it is a **requirement change**: "did *this* user view the event?" cannot be answered by a HyperLogLog. If that arrives, the answer is a bitmap keyed by a dense user index, not a set of ids.

**4. Recently viewed — sorted set scored by timestamp**

\`\`\`
Key: rv:{user:42}
ZADD            rv:{user:42} <now> <event_id>
ZREMRANGEBYRANK rv:{user:42} 0 -21          -- keep the newest 20
ZREVRANGE       rv:{user:42} 0 19
\`\`\`

*Why a sorted set rather than a list:* \`ZADD\` on an existing member **updates its score instead of adding a duplicate**, so deduplication is free. With a list I would need \`LREM\` before \`LPUSH\`, which is an O(n) scan and two commands.

*TTL:* 90 days of inactivity, refreshed on write. This is a case where refreshing the TTL on every write is correct — the opposite of the rate limiter, because here the intent genuinely is "since last activity".

*What breaks it at scale:* forgetting \`ZREMRANGEBYRANK\`. Without the trim, a heavy user's key grows without bound and eventually becomes a big-key stall.

**5. Cache-invalidation broadcast — pub/sub, with a TTL as the actual correctness mechanism**

\`\`\`
PUBLISH cache:invalidate:events <event_id>
\`\`\`

Every instance subscribes and drops its in-process copy on receipt.

*Why this is an optimisation and not the mechanism:* pub/sub is fire-and-forget. An instance that is starting up, briefly disconnected, or slow to read misses the message **permanently**, and then holds a stale in-process entry with nothing to correct it.

*The correctness mechanism is a 30-second TTL on the in-process cache.* Pub/sub makes invalidation usually-instant; the TTL makes a missed message bounded rather than forever. If 30 seconds were too long I would use a Stream instead, so a reconnecting instance can read what it missed from its last position.

*TTL:* not applicable to pub/sub itself, which stores nothing.

**Which designs need attention under Redis Cluster**

The rule is that a multi-key command needs all keys in one hash slot. Reviewing each:

- **Rate limit, leaderboard, recently viewed, unique viewers:** all single-key operations, or multi-command sequences against *one* key. I have written each key with a hash tag — \`rl:{user:42}\`, \`lb:{event:88}\` — so the Lua script for the rate limiter touches one slot and is valid. **These are fine, and the hash tags are why.**
- **Pub/sub:** works in cluster mode, and with a caveat worth knowing — in older versions a message published to one node is broadcast across the cluster, which is expensive at high publish rates. Sharded pub/sub confines it to one shard and requires subscribers to connect to the right one.
- **The design that would need attention if I had written it differently:** any cross-entity operation. If I had wanted "intersect this user's recently-viewed with an event's leaderboard participants", those two keys are on different slots and the command fails. The fix would be doing the intersection in the application, or co-locating the keys under a shared hash tag — which is only possible if they genuinely belong to the same entity.

The general point: **key naming is a partitioning decision, and hash tags are the mechanism.** Deciding them up front is cheap; discovering the constraint during a migration to cluster mode means rewriting working code.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-redis-1',
      level: 'basic',
      question: 'What is Redis, beyond "a fast cache"?',
      guidance:
        'A single-threaded in-memory data-structure server with atomic operations per structure. A strong answer gives an example of a structure collapsing a problem — INCR for counters, a sorted set for a leaderboard — rather than listing types.',
    },
    {
      id: 'iq-redis-2',
      level: 'basic',
      question: 'How would you implement a rate limiter in Redis?',
      guidance:
        'INCR plus EXPIRE NX for a fixed window, or a sorted set for a sliding window. Look for the recognition that read-modify-write is wrong, and that EXPIRE without NX makes the window never close for an active client.',
    },
    {
      id: 'iq-redis-3',
      level: 'intermediate',
      question: 'Redis is single-threaded. Why is that good, and what does it cost?',
      guidance:
        'Atomicity of every command without locks; and one slow command blocks everyone. A strong answer names specific hazards — KEYS, HGETALL on a big structure, DEL on a huge key, a slow Lua script — and reaches for SCAN and UNLINK.',
    },
    {
      id: 'iq-redis-4',
      level: 'intermediate',
      question: 'Can Redis be your source of truth?',
      guidance:
        'Only with an explicitly accepted loss window: RDB loses since the last snapshot, AOF everysec loses a second, and async replication can lose acknowledged writes on failover. A strong answer says that configuring for zero loss produces a slow database and asks whether a database was wanted.',
    },
    {
      id: 'iq-redis-5',
      level: 'advanced',
      question: 'Every Redis operation spikes to 900 ms for two seconds, repeatedly. Diagnose it.',
      guidance:
        'Head-of-line blocking on the command thread — all clients affected simultaneously is the signature. Look for the slow-log as the diagnostic and for named culprits. Excellent answers also consider AOF rewrite I/O and large key deletions.',
    },
    {
      id: 'iq-redis-6',
      level: 'advanced',
      question: 'How does Redis Cluster change how you design keys?',
      guidance:
        'Multi-key operations must share a hash slot, so hash tags make key naming a partitioning decision. Excellent answers note that adopting cluster mode can break code that assumed multi-key atomicity, and that Lua scripts are subject to the same constraint.',
    },
    {
      id: 'iq-redis-7',
      level: 'followup',
      question: 'You suggested pub/sub for cache invalidation. What happens when an instance is restarting?',
      guidance:
        'It misses those messages permanently and then serves stale data with nothing to correct it. A strong answer treats pub/sub as an optimisation with a short in-process TTL as the correctness mechanism, or reaches for Streams so a reconnecting consumer can read from its last position.',
    },
    {
      id: 'iq-redis-8',
      level: 'followup',
      question: 'What is the most common Redis memory incident you would expect to find?',
      guidance:
        'A key pattern created without a TTL that accumulates for months — not a traffic burst. A strong answer states the rule that every key pattern must answer "when does this go away", and notes that expiry is lazy plus sampled so memory does not drop instantly even when TTLs are set.',
    },
  ],

  activeLearning: [
    {
      id: 'al-redis-1',
      kind: 'what-changes-if',
      prompt:
        'Everything here assumed one Redis instance with all data in RAM. Now change one thing: the dataset is 400 GB and does not fit in memory on any instance you can afford. What are the options, and which of this lesson\'s advantages survive each?',
      discussion: `Redis's core assumption is that data is in memory, so exceeding it forces a genuine architectural choice rather than a configuration change.

**Option 1 — Redis Cluster, sharding across many nodes.** 400 GB across, say, 16 nodes is 25 GB each, which is affordable.

*Survives:* per-key latency, all the structures, atomicity within a key.
*Lost:* multi-key operations across slots, so any command or Lua script touching two entities breaks unless hash tags co-locate them. And the memory cost is real — 400 GB of RAM across a cluster is expensive, which is usually what motivated the question.

**Option 2 — reduce what is stored.** Frequently the right answer and the one nobody considers first. Concretely: shorter TTLs so only the working set is resident; HyperLogLog instead of sets where the question is a count; bitmaps instead of sets where user ids are dense; and checking for the key pattern with no TTL that is holding months of dead data. In practice a 400 GB Redis often contains 40 GB of working set and 360 GB of things nobody reads.

*Survives:* everything, which is why this is worth exhausting first.

**Option 3 — a different store with the same interface.** Several systems speak the Redis protocol and keep cold data on disk, holding hot data in memory.

*Survives:* the command vocabulary and most of the structures, so application code may need no changes.
*Lost:* the latency guarantee — a miss now costs a disk read, so p99 becomes bimodal. And the single-threaded atomicity model may differ, which means the atomicity assumptions this lesson leans on need re-verifying against the specific implementation rather than assumed.

**Option 4 — accept that this is a database.** If 400 GB must be queryable and durable, the honest question is whether Redis was ever the right tool. A relational or key-value database holds 400 GB comfortably on disk, and a small Redis in front of it holds the working set.

*Survives:* Redis for the hot path, with all its advantages, at 20 GB rather than 400.
*Lost:* nothing that was real. What was lost was the belief that everything belonged in Redis.

**Which I would do: option 2, then option 4.** Measure what is actually read — the key-space analysis tools make this straightforward — and I would expect to find that the working set is a small fraction. Then Redis holds the working set and something disk-based holds the rest.

**The transferable point.** "It does not fit in memory" is usually two problems wearing one coat: a working set that does fit, and a large volume of data that should never have been in memory. Sharding treats the symptom at considerable cost. Separating the two treats the cause, and the resulting architecture — a modest cache in front of a durable store — is the one the caching lesson described in the first place.`,
    },
    {
      id: 'al-redis-2',
      kind: 'debug',
      prompt:
        'A Redis instance used for session storage has memory growing steadily by about 1 GB per week for six months, despite every session being written with a 24-hour TTL. Session volume is flat. What are your hypotheses?',
      discussion: `Every session has a TTL and memory grows anyway. That combination narrows it sharply: either something is stored without a TTL, or the TTL is not doing what is assumed.

**Hypothesis 1 — a second key pattern with no TTL.** The most likely. Sessions have TTLs; something adjacent does not. Candidates: an index of session ids per user built with \`SADD\` and never trimmed; a "last seen" hash keyed by user with \`HSET\` and no expiry; an audit or metrics key. The volume being flat while memory grows linearly is the signature of an append-only structure.

*Check:* sample the keyspace by pattern and by size. Most Redis tooling can report memory by key prefix, and this is usually a five-minute answer.

**Hypothesis 2 — a TTL being reset or removed.** \`SET key value\` **without** \`KEEPTTL\` removes an existing expiry. So if any code path updates a session with a plain \`SET\`, that session becomes immortal. Only a fraction of sessions would be affected — whichever ones took that path — which fits slow steady growth rather than a cliff.

*Check:* count keys matching the session pattern that have no TTL (\`TTL\` returning -1). If a subset has none, this is it.

**Hypothesis 3 — a growing structure inside a session.** If a session is a hash and something appends to it — a list of visited pages, a set of permissions checked — then each session is bounded in count but growing in size. The TTL works perfectly and each expiring session is simply bigger than the last.

*Check:* the distribution of session sizes over time, specifically the maximum rather than the mean.

**Hypothesis 4 — fragmentation rather than data.** Redis memory can grow while the logical dataset does not, because the allocator does not return freed pages to the OS. This shows as a gap between used memory and the sum of key sizes.

*Check:* the fragmentation ratio. If the logical dataset is flat and process memory is growing, this is the answer, and the fix is activating defragmentation or a scheduled restart — a different class of problem entirely.

**What I would check first: memory by key prefix.** One command, and it distinguishes hypotheses 1 and 3 from 2 and 4 immediately by showing whether the growth is in the session pattern or somewhere else.

**Then:** count session keys with no TTL (hypothesis 2), and check the fragmentation ratio (hypothesis 4).

**The structural fix regardless of the answer.** Every key pattern needs a documented answer to "when does this go away", and that should be enforceable: a code review rule, a wrapper that refuses to write without an expiry, or a scheduled job that reports keys with no TTL grouped by prefix. The reason this incident ran for six months is that nothing was watching for the absence of a TTL — and the absence of a thing is much harder to notice than its presence.

**Transferable:** in any store where cleanup is a policy rather than a guarantee, the failure mode is always the thing nobody set a policy for. Monitoring should therefore look for *missing* policy, not just for growing usage.`,
    },
  ],

  revision: {
    bullets: [
      'Redis is a data-structure server. The design question is "which structure", not "what key".',
      'The right structure collapses a read-modify-write cycle into one atomic command.',
      'Single-threaded execution makes every command atomic against every other with no locks — and means one slow command blocks every client, the source of most Redis incidents.',
      'Never `KEYS` in production; use `SCAN`. Never `DEL` a huge key; use `UNLINK`.',
      'Big keys are a latency hazard for everyone, not a storage problem.',
      '`INCR` plus `EXPIRE ... NX` is a correct fixed-window rate limiter; a sorted set gives a sliding one.',
      '`SET ... EX` on every request means the window never closes for an active client.',
      'A sorted set is the most versatile structure: time index, leaderboard, sliding window, priority queue.',
      '`ZADD` on an existing member updates its score rather than duplicating — deduplication for free.',
      'HyperLogLog gives distinct counts in ~12 KB with ~0.8% error, regardless of cardinality.',
      'Persistence defaults lose data: RDB since the last snapshot, AOF everysec up to a second.',
      'Replication is asynchronous, so a failover can lose acknowledged writes. `WAIT` converts that into latency.',
      '`noeviction` on a cache means writes fail when memory fills, and the hit rate silently decays.',
      'Expiry is lazy plus sampled, so expired keys can still occupy memory.',
      'In Redis Cluster a multi-key operation must share a hash slot; hash tags force co-location.',
      'Lists are queues with no delivery guarantee; Streams with consumer groups keep entries until acknowledged.',
      'Pub/sub loses messages for any disconnected subscriber, so it cannot be a correctness mechanism.',
      'Every key pattern must answer "when does this go away" — the commonest memory incident is a missing TTL.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A single-threaded in-memory data-structure server exposing atomic operations on strings, hashes, lists, sets, sorted sets, bitmaps, HyperLogLogs and streams.',
    whyItExists:
      'Many problems need a compound operation to be atomic and fast. Purpose-built structures with atomic commands remove concurrency handling from the application entirely.',
    whenToUse: [
      'Caching, where a cold start is acceptable and the source can absorb it.',
      'Counters, rate limits, leaderboards, sliding windows, membership and deduplication.',
      'Ephemeral state with an accepted loss window: sessions, locks, job progress.',
    ],
    whenNotToUse: [
      'As a durable source of truth without an explicitly accepted loss window.',
      'As a queue with delivery guarantees, unless using Streams — and a real broker if retention matters.',
      'For datasets far larger than affordable RAM, or for ad-hoc queries and joins.',
    ],
    alternatives: [
      'Memcached, when you want only a cache and value operational simplicity.',
      'A relational or key-value database, when the data must be durable and larger than memory.',
      'A real message broker, when delivery guarantees, retention and replay matter.',
      'A Redis-protocol store with disk tiering, when the command set matters more than the latency guarantee.',
    ],
    tradeoffs: [
      'Single-threaded execution buys free atomicity and costs head-of-line blocking.',
      'In-memory storage buys sub-millisecond latency and costs a hard capacity limit and weak durability.',
      'A sliding-window limiter buys accuracy and costs memory proportional to requests rather than users.',
      'HyperLogLog buys constant memory and costs exactness and any membership query.',
      'Cluster mode buys capacity and costs multi-key atomicity across slots.',
    ],
    failureModes: [
      'A slow command stalling every client — KEYS, HGETALL on a large structure, DEL on a huge key, a slow script.',
      'Read-modify-write losing concurrent updates where an atomic command existed.',
      'A rate-limit window that never closes because the TTL is rewritten on every request.',
      'noeviction on a cache: writes fail and the hit rate decays unnoticed.',
      'A key pattern with no TTL growing for months.',
      'A job lost because a list pop is destructive and unacknowledged.',
      'A missed pub/sub message leaving an in-process cache permanently stale.',
      'Acknowledged writes lost on failover under asynchronous replication.',
    ],
    followUpQuestions: [
      'Which structure does this problem actually want?',
      'Is there an atomic command that replaces this read-modify-write?',
      'When does this key go away, and what enforces that?',
      'What is the largest single key in your keyspace, and what command touches it?',
      'What is your accepted loss window, and does your persistence configuration deliver it?',
      'If you moved to cluster mode, which of your operations would break?',
    ],
  },
});
