import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-url-shortener',
  title: 'Design a URL shortener',
  summary:
    'The smallest system whose every decision is forced by a number: key-space arithmetic, a 100:1 read skew, and a redirect that must never be wrong.',
  phase: 'hld',
  module: 'core-designs',
  position: 41,
  kind: 'system-design',
  difficulty: 'core',
  estimatedMinutes: 90,
  tags: ['id-generation', 'caching', 'partitioning', 'estimation', 'api-design', 'availability'],
  prerequisites: ['h-framework', 'h-requirements', 'h-estimation'],
  resources: [
    {
      key: 'system-design-primer',
      tier: 'must',
      note: 'Read the "Design Pastebin.com / Bit.ly" exercise after you have done this lesson, not before. Comparing your derivation against another one is useful; copying a derivation is not.',
    },
    {
      key: 'snowflake-repo',
      tier: 'must',
      note: 'The README is short and is the primary source for the bit layout. Read it as the answer to "how do I generate unique ids without a coordinator on the hot path", which is this lesson\'s deep dive.',
    },
    {
      key: 'aws-caching-challenges',
      tier: 'must',
      note: 'The section on cache stampedes and on what happens when the cache is cold is the failure mode this design is most exposed to, because a redirect service is almost entirely cache.',
    },
    {
      key: 'dynamodb-partition-key-design',
      tier: 'good',
      note: 'Concrete rules for choosing a partition key and the hot-partition symptoms to look for. Applies to any partitioned store, not just DynamoDB.',
    },
    {
      key: 'rfc-9110-http-semantics',
      tier: 'good',
      note: 'Sections on 301 and 302 semantics. The choice between them changes whether you ever see a second request from the same browser, which changes your analytics and your cache design.',
    },
    {
      key: 'birthday-problem',
      tier: 'good',
      note: 'The arithmetic behind "collisions start at the square root of the key space". Read the approximation section only; it is the part you will use in an estimate out loud.',
    },
    {
      key: 'fpe-nist-sp800-38g',
      tier: 'advanced',
      note: 'The standard behind the format-preserving encryption option in the exercise: a keyed bijection over a fixed alphabet, which gives unguessable codes with no collision check at all.',
    },
    {
      key: 'dynamodb-best-practices',
      tier: 'advanced',
      note: 'Access-pattern-first modelling taken to its conclusion. Useful once you can already justify why a key-value store fits this workload.',
    },
  ],

  intuition: {
    body: `A URL shortener looks like a hash map with a web server in front of it. Two functions: put a long URL in, get a short one out; give the short one back, get redirected.

That is genuinely all it does. Which is exactly why it is the first system design problem worth doing properly — there is nowhere to hide. You cannot wave at "a microservice" to make the hard part go away, because there is only one hard part and it is arithmetic.

Here is the shape of it. Every decision in this design is forced by one of three numbers:

1. **How many URLs will ever exist?** This decides how long the short code is, which decides whether your scheme even works.
2. **What is the read-to-write ratio?** This decides whether you cache, and what your cache actually has to hold.
3. **How wrong can a redirect be?** This decides your consistency model and your failure behaviour.

Get those three numbers on the table and the architecture almost writes itself. Skip them and you end up with a design that sounds sophisticated and cannot answer "why?" for any component in it.

The trap in this problem is that it is easy to *state* an answer — "use base62 over an auto-increment id, put Redis in front, shard by hash" — in about fifteen seconds. Interviewers know that answer. What they are testing is whether you can derive it, notice where it breaks, and say what you would do instead.`,
    analogyLimit:
      'The hash-map picture breaks the moment you ask what happens when the map is bigger than one machine, when two machines try to write the same key, or when the machine holding the map restarts. Every interesting decision here lives in exactly those three places, and a hash map has none of them.',
  },

  deepExplanation: {
    predict: {
      question:
        'Before reading on: you need short codes for 100 billion distinct URLs, using the alphabet [A-Za-z0-9]. How many characters does the code need to be? And if instead you generated codes randomly from that alphabet at 7 characters, roughly how many URLs would you have to store before collisions became a routine occurrence rather than a rarity?',
      answer: `**Length.** The alphabet has 62 symbols, so an *n*-character code addresses 62ⁿ values.

| n | 62ⁿ | Enough for 100 billion? |
| --- | --- | --- |
| 5 | ≈ 916 million | No |
| 6 | ≈ 56.8 billion | No |
| 7 | ≈ 3.52 trillion | Yes, with 35× headroom |
| 8 | ≈ 218 trillion | Yes, with far more than you need |

So **7 characters**. That is the number to say out loud, and the 35× headroom is the number to say immediately after it, because headroom is what makes the answer defensible.

**Collisions.** This is the birthday problem. Collisions stop being rare at roughly √N drawings from a space of size N:

√(3.52 × 10¹²) ≈ **1.9 million**

Which is the uncomfortable part. If you generate random 7-character codes, you will start seeing collisions after about *two million* URLs — not after three trillion. At 100 billion stored URLs the probability that a fresh random code is already taken is roughly 100 × 10⁹ ÷ 3.52 × 10¹² ≈ **2.8%**, so about one write in thirty-six needs a retry.

That is survivable, but it means **random generation requires a uniqueness check on every write**, which means a read before every write, which means your write path now depends on a strongly consistent lookup. That single consequence is the reason the sequential-id approach exists, and it is the thing most candidates miss when they say "just generate a random string".`,
    },
    body: `## Step 1 — Requirements

Ask, decide, and write down. The three questions that change the architecture:

**Is the short code allowed to be guessable?** If yes, a sequential scheme is fine. If no — because links leak private documents — you need randomness or encryption, and the design changes. Assume *guessable is acceptable, but custom aliases are supported*.

**Do links expire?** If yes, you have a deletion path, a reclamation policy for codes, and a background job. If no, storage grows forever. Assume *optional TTL, default never*.

**What is the analytics requirement?** "Count clicks" and "count clicks, broken down by country, in real time" are different systems. Assume *click counts, eventually consistent, minutes of lag acceptable*.

Then the non-functional requirements, which are the ones that actually shape the design:

| Requirement | Value | What it forces |
| --- | --- | --- |
| Redirect latency | p99 under 50 ms | Cache-first read path |
| Availability of redirects | 99.99% | Redirects must survive the write path being down |
| Availability of shortening | 99.9% | The write path may be less available than the read path |
| Durability | No lost mappings | Replicated storage, write acknowledged before response |
| Scale | 100 M new links/month | See estimation |

Notice the split between the two availability numbers. Deciding that **reads and writes have different availability targets** is the single most useful thing you can say in the first five minutes, because it licenses you to design two paths that fail independently.

## Step 2 — Estimation

State assumptions, then multiply. Out loud.

- 100 million new links per month ⇒ 100 × 10⁶ ÷ (30 × 86,400) ≈ **40 writes/second** average.
- Read:write ratio 100:1 ⇒ **4,000 reads/second** average.
- Peak is roughly 3× average ⇒ **120 writes/s, 12,000 reads/s**.
- Storage per row: short code (7 B) + long URL (~200 B average, capped at 2 KB) + owner id (8 B) + timestamps (16 B) + counters ⇒ call it **500 B/row**.
- 100 M rows/month × 500 B ⇒ **50 GB/month**, **600 GB/year**, **3 TB over five years**.
- Cache: the top 20% of links serve roughly 80% of reads. One month of links is 100 M rows; 20% is 20 M rows at ~250 B of cached payload ⇒ **5 GB**. That fits in memory on a single large instance, and comfortably on a small cluster.

Three conclusions fall out immediately, and each one is a design decision you have now *earned*:

1. **12,000 reads/second is not a lot.** This does not need an exotic architecture. Say so.
2. **3 TB fits on one machine.** You do not need to shard for capacity in year one. You may still want to for availability and blast radius — that is a different argument, and you should make it explicitly rather than pretending it was capacity.
3. **The working set fits in memory.** That is what makes a cache-first read path viable, and it is why this system can hit 50 ms p99 without heroics.

## Step 3 — API design

Two endpoints. Resist adding more.

\`\`\`
POST /v1/links
  { "url": "https://example.com/a/very/long/path", "alias": "launch", "ttlDays": 90 }
  → 201 { "code": "launch", "shortUrl": "https://short.example/launch", "expiresAt": "..." }
  → 409 if the alias is taken

GET /{code}
  → 302 Found, Location: <long url>
  → 404 if unknown, 410 if expired
\`\`\`

Three things worth defending here:

**Idempotency on create.** Without it, a client that times out and retries creates two short codes for one URL. Accept an \`Idempotency-Key\` header, store it alongside the created row with a dedup window, and return the original response on replay. This is the same mechanism you met in the idempotency lesson, and this is its most common real use.

**301 versus 302.** A 301 (permanent) lets browsers and intermediaries cache the redirect forever — which is fast and free, and means you will never see that user's second click. A 302 (found) sends every click through you, which costs traffic and buys analytics and the ability to change or revoke the target. **Choose 302 unless analytics is explicitly out of scope**, and say why. Candidates who pick 301 for speed without noticing they just deleted their own click counts get caught by exactly that follow-up.

**Validation is a security boundary, not a nicety.** You are being asked to store an arbitrary URL and later redirect users to it. Reject non-HTTP(S) schemes (\`javascript:\`, \`data:\`), and be aware you are running an open redirector that phishing campaigns will find within days of launch. Rate limiting and abuse scanning on the write path are part of the design, not an afterthought.

## Step 4 — Data model

The access patterns are: *lookup by code* (12,000/s) and *insert by code* (120/s). There is one more: *list links by owner*, which is low volume.

That is a key-value workload with a secondary index. A relational database handles it perfectly well at this scale; so does a key-value store. The honest answer is **either works, and the choice is driven by operational familiarity, not by the workload** — say that, then pick one and commit.

\`\`\`
links
  code          text primary key      -- 7 chars, or a custom alias
  long_url      text not null
  owner_id      text
  created_at    timestamptz not null
  expires_at    timestamptz           -- null = never

index links_owner_created on links (owner_id, created_at desc)
\`\`\`

Click counts do **not** go in this table. A counter column on the hottest row in your database means every read path also writes, and every popular link becomes a contention hotspot. Counts go through an asynchronous path (Step 6).

## Step 5 — Short code generation: the deep dive

This is where the interview actually happens. There are four families, and the right answer depends on requirements you established in Step 1.

**Hash the URL and truncate.** Take SHA-256 of the long URL, base62-encode, take the first 7 characters. Deterministic, so the same URL always maps to the same code — which is either a feature or a privacy leak depending on whether users should be able to discover that someone else shortened the same URL. Truncated hashes collide at the birthday bound, so you still need a uniqueness check and a retry-with-salt loop. **Verdict: fine, but the collision handling is the whole cost and you have not avoided the read-before-write.**

**Random generation with a uniqueness check.** As computed in the prediction above: about 2.8% of writes collide at 100 billion rows. Requires a strongly consistent read before every write, which couples your write availability to your primary store. **Verdict: acceptable, and mandatory if codes must be unguessable.**

**Sequential id, base62-encoded.** A monotonically increasing integer, encoded. No collisions by construction, no read-before-write, dense use of the key space. But you now need a source of unique integers, which is a distributed systems problem, and the codes are trivially enumerable — anyone can walk your entire link set. **Verdict: the default when guessability is acceptable.**

**Pre-generated key pool.** A background service generates unused codes into a table; the write path claims one atomically. Turns a coordination problem into a queue-consumption problem and makes the write path a single fast operation. **Verdict: the most operationally boring option, and boring is a compliment here.**

If you take the sequential route, you need unique integers without a single coordinator on the hot path. The standard answer is a **Snowflake-style layout**: a 64-bit integer partitioned into timestamp, machine id, and per-millisecond sequence.

\`\`\`
 63           22        12        0
 ┌────────────┬─────────┬─────────┐
 │ timestamp  │ machine │ sequence│
 │  41 bits   │ 10 bits │ 12 bits │
 └────────────┴─────────┴─────────┘
   ~69 years    1024 nodes  4096/ms/node
\`\`\`

Each node generates ids locally with no network call. Uniqueness comes from the machine id being unique, which is the only thing that needs coordination — and it needs it once, at startup, not per request.

Two failure modes you must name, because they are the follow-up:

- **Clock skew backwards.** If a node's clock jumps back, it can reissue timestamps it has already used, and with the same sequence numbers it will produce duplicate ids. The mitigation is to refuse to issue ids until the clock catches up to the last-issued timestamp — the node stalls rather than corrupting.
- **Machine id reuse.** Two nodes with the same machine id will collide. This is why machine ids come from a coordination service (or from a stable, unique property of the deployment) rather than from configuration a human types.

A 64-bit Snowflake id base62-encodes to about 11 characters, which is longer than the 7 we derived. Options: use fewer bits (shorter epoch, fewer machines), or accept 11 characters, or use the pre-generated pool instead. **Notice that the arithmetic in Step 2 now constrains the choice in Step 5.** That is what it means for a design to be derived rather than recalled.

## Step 6 — Architecture and the two paths

\`\`\`
WRITE (120/s peak)
  client → API → validate & rate limit → allocate code → write to primary store
                                                       → invalidate/populate cache
                                                       → 201

READ (12,000/s peak)
  client → edge → redirect service → cache
                                      ├─ hit  → 302 (about 95% of requests)
                                      └─ miss → primary store → populate cache → 302

ANALYTICS (12,000/s, off the critical path)
  redirect service → append click event to a queue → consumer → aggregate → counts store
\`\`\`

The click event is fired *after* the 302 is written to the socket, and it is fire-and-forget into a local buffer that batches to the queue. If the analytics pipeline is completely down, redirects keep working and you lose counts. That is the correct trade: **a redirect failing is a broken product; a click count being wrong is an inconvenience.** Saying that ordering out loud is worth more than any component you could name.

## Step 7 — What breaks at 10×

At 120,000 reads/second:

- **The cache tier, not the database.** A single cache node maxes out on network long before it maxes out on memory. You partition the cache by code, and now you have to think about what happens when a node is added: consistent hashing so that adding a node moves 1/N of the keys instead of all of them.
- **Hot keys.** One viral link can pull 30% of your total traffic to a single cache partition. Partitioning by code does not help — every request for that code hashes to the same node. The fix is a small local (in-process) cache in front of the shared cache for the top few hundred codes, which turns the hottest keys into zero network hops. This is the answer interviewers are fishing for when they say "what if one link goes viral?"
- **Write path** at 1,200/s is still unremarkable. It stays boring, which is the point of having chosen a generation scheme with no read-before-write.

## Step 8 — Failure

| Failure | What happens | What you do about it |
| --- | --- | --- |
| Cache node dies | Its share of reads falls through to the primary store — a 20× traffic spike on that partition | Request coalescing on miss, so a thousand concurrent misses for one key make one database call |
| Cache tier entirely cold (restart) | All 12,000 reads/s hit the database at once | Staggered warm-up, and a database that can survive the cold-start load; this is the number that sizes your primary store, not the steady state |
| Primary store leader fails | Writes stop; reads served from cache continue | Accept it. Shortening at 99.9% and redirecting at 99.99% was an explicit choice in Step 1 |
| Analytics queue backs up | Counts lag | Bounded local buffer that drops oldest on overflow. Never block a redirect on a counter |
| A code is created but the cache holds a stale negative entry | User sees 404 for a link that exists | Do not cache negatives, or cache them for seconds not minutes |

The cold-cache row is the one to volunteer unprompted. A design that is 95% cache hits in steady state is a design whose true capacity requirement is set by the moment the cache is empty.

## Step 9 — Defending it

The decision worth defending is *sequential ids with a pre-generated pool, 302 redirects, cache-first reads, no counter column*. The alternative worth naming is *random codes with a uniqueness check*: it wins the moment "codes must not be enumerable" becomes a requirement, and it costs you a strongly consistent read on every write. Say which requirement would flip you, and you have demonstrated the thing the whole interview is testing.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'shortener-arch',
      title: 'The two paths, and why they fail independently',
      caption:
        'Walk the steps. The point to notice is that the read path and the write path share only the primary store, and the analytics path shares nothing on the critical path at all — that separation is what lets redirects be more available than shortening.',
      nodes: [
        { id: 'client', label: 'Client', kind: 'client', x: 0, y: 140 },
        { id: 'edge', label: 'Edge / LB', kind: 'edge', x: 150, y: 140, detail: 'Terminates TLS near the user and spreads connections. Redirects are tiny responses, so the round trip dominates and edge termination is most of the latency win.' },
        { id: 'api', label: 'Write API', kind: 'service', x: 330, y: 30, detail: 'Validates the URL, enforces rate limits and abuse checks, claims a code, writes the row. 120 requests/second at peak — deliberately unremarkable.' },
        { id: 'redirect', label: 'Redirect service', kind: 'service', x: 330, y: 220, detail: 'Stateless. Reads the mapping and returns 302. Holds a small in-process cache for the hottest few hundred codes so a viral link never reaches the shared cache.' },
        { id: 'pool', label: 'Code pool', kind: 'store', x: 520, y: 30, detail: 'Pre-generated unused codes. Turns "coordinate to allocate a unique id" into "consume from a queue", which is a solved problem with no read-before-write on the hot path.' },
        { id: 'cache', label: 'Shared cache', kind: 'cache', x: 520, y: 220, detail: 'Holds the ~20 million codes serving most traffic, about 5 GB. Around 95% hit rate in steady state; the design must survive 0% during a cold start.' },
        { id: 'store', label: 'Primary store', kind: 'store', x: 720, y: 130, detail: 'The durable mapping, ~3 TB over five years. Replicated. The only component both paths depend on, which is exactly why its availability sets the floor.' },
        { id: 'queue', label: 'Click events', kind: 'queue', x: 520, y: 350, detail: 'Fire-and-forget after the response is written. A full or dead queue costs you counts, never redirects.' },
        { id: 'counts', label: 'Counts store', kind: 'store', x: 720, y: 350, detail: 'Aggregated asynchronously. Minutes of lag were accepted in the requirements, which is what allows this whole path to be off the critical one.' },
      ],
      edges: [
        { id: 'e1', source: 'client', target: 'edge', kind: 'sync' },
        { id: 'e2', source: 'edge', target: 'api', label: 'POST /v1/links', kind: 'write' },
        { id: 'e3', source: 'edge', target: 'redirect', label: 'GET /{code}', kind: 'read' },
        { id: 'e4', source: 'api', target: 'pool', label: 'claim code', kind: 'sync' },
        { id: 'e5', source: 'api', target: 'store', label: 'insert', kind: 'write' },
        { id: 'e6', source: 'redirect', target: 'cache', label: 'get', kind: 'read' },
        { id: 'e7', source: 'cache', target: 'store', label: 'on miss', kind: 'read' },
        { id: 'e8', source: 'redirect', target: 'queue', label: 'after response', kind: 'async' },
        { id: 'e9', source: 'queue', target: 'counts', label: 'aggregate', kind: 'async' },
      ],
      steps: [
        {
          id: 's1',
          title: 'Write: 120 requests per second, and nothing clever',
          description:
            'Validate, rate-limit, claim a pre-generated code, insert, respond. There is no read-before-write because the code pool removed the need for a uniqueness check. That single choice is what keeps this path boring at any scale in the estimate.',
          nodes: ['client', 'edge', 'api', 'pool', 'store'],
          edges: ['e1', 'e2', 'e4', 'e5'],
        },
        {
          id: 's2',
          title: 'Read: cache-first, and about 95% of requests stop at the cache',
          description:
            'The working set is roughly 5 GB, which is why this works. A redirect that hits the cache never touches the primary store, so the store is sized for misses and cold starts rather than for steady-state traffic.',
          nodes: ['client', 'edge', 'redirect', 'cache'],
          edges: ['e1', 'e3', 'e6'],
        },
        {
          id: 's3',
          title: 'The miss path is the one that sizes your database',
          description:
            'In steady state 5% of 12,000 reads per second is 600 queries per second. After a cache restart it is 12,000. Provision for the restart, not the average — and add request coalescing so a thousand simultaneous misses on one key become one query.',
          nodes: ['cache', 'store'],
          edges: ['e7'],
        },
        {
          id: 's4',
          title: 'Analytics never touches the critical path',
          description:
            'The click event is emitted after the 302 is written, into a bounded local buffer. If the queue is full or the consumer is dead, counts are lost and redirects are unaffected. Naming that priority explicitly is worth more than the component itself.',
          nodes: ['redirect', 'queue', 'counts'],
          edges: ['e8', 'e9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'code-generation',
      title: 'Choosing a code generation scheme',
      caption:
        'Follow the branches: every leaf is a legitimate answer under some requirement. What the interviewer is testing is whether you can name which requirement put you on that branch — not which leaf you landed on.',
      code: `flowchart TD
    A[Need a short code] --> B{Must codes be<br/>unguessable?}
    B -->|Yes| C[Random or encrypted]
    B -->|No| D{Can you tolerate<br/>coordination at write time?}

    C --> C1[Uniqueness check<br/>on every write]
    C1 --> C2["≈2.8% retry rate at 10^11 rows<br/>Write path needs a strongly<br/>consistent read"]

    D -->|Yes| E[Sequential id from<br/>a counter service]
    D -->|No| F[Snowflake-style<br/>local generation]
    D -->|Prefer neither| G[Pre-generated<br/>code pool]

    E --> E1[Single coordinator<br/>on the hot path]
    F --> F1["64-bit id ≈ 11 base62 chars<br/>Clock skew must stall,<br/>not wrap"]
    G --> G1[Write path is one<br/>atomic claim, no read]

    style G fill:#17272a,stroke:#35897e
    style G1 fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['Twitter Snowflake'],
    body: `Snowflake was built at Twitter to solve exactly the problem Step 5 arrives at, and its source is public.

The constraint was this: tweet ids had to be unique across many machines, roughly sortable by time, and generatable without a network round trip on every insert. A central sequence service would have been simple and would have put one machine on the critical path of every write in the system. Waiting on that machine — or losing it — was not acceptable.

The answer packs three fields into a 64-bit integer: a timestamp in milliseconds since a custom epoch, a worker identifier, and a per-millisecond sequence counter. Because the worker id is part of the value, two machines generating simultaneously can never collide. Because the timestamp occupies the high-order bits, ids sort roughly by creation time, which makes range scans and cursor pagination cheap.

Three transferable lessons, none of which require you to ever use this exact layout:

**Coordination is not binary; the question is where it happens.** The choice is not "central coordinator" versus "hope". Snowflake coordinates once, when a worker is assigned its id at startup, and never again. A pre-generated code pool coordinates in a background process. A database sequence coordinates on every insert. Moving coordination off the hot path is a design move that applies to almost any allocation problem — codes, booking references, invoice numbers, device identifiers.

**Structure in an identifier is simultaneously a feature and a leak.** Time-sortable ids give you cheap ordering. They also tell anyone holding two ids how far apart in time they were created and, with the sequence bits, roughly how many were created in between. For a tweet id that is fine — tweets are public and timestamped anyway. For a URL shortener handing codes to strangers, "how many links has this service created this week" may be precisely what you did not want to publish. Whether structure is acceptable depends on a requirement, and you established that requirement in Step 1.

**Bits are a budget, and every allocation is a decision you can move.** 41 bits of millisecond timestamp buys about 69 years from your chosen epoch. 10 bits of worker id buys 1,024 concurrent generators. 12 bits of sequence buys 4,096 ids per millisecond per generator. When an interviewer asks "what if you need more than 1,024 workers?", the answer is not "add bits" — the integer is fixed at 64. The answer is "take them from the epoch or the sequence, and here is exactly what that costs": a shorter epoch means an earlier forced migration; fewer sequence bits means a lower per-node ceiling before the generator has to stall.

That last move — being able to say what you would give up, in units, to get what was asked for — is the whole skill this lesson is training.`,
  },

  tradeoffs: {
    intro:
      'The trade-off that matters in this design is how short codes are generated. Everything else follows from the numbers. The rows are ordered by how much machinery they require.',
    rows: [
      {
        option: 'Sequential id from a single counter, base62-encoded',
        whenItWins:
          'Low write volume, one region, and an existing database that can hand out a sequence cheaply. The simplest thing that is correct.',
        whenItLoses:
          'When the counter is on the hot path of every write across regions, or when enumerable codes are unacceptable.',
        cost:
          'A coordination point on the write path, and codes that let anyone walk your entire link set and infer your growth rate.',
      },
      {
        option: 'Pre-generated code pool consumed by writers',
        whenItWins:
          'Almost always, when guessability is acceptable. The write path becomes a single atomic claim with no read-before-write and no clock dependency.',
        whenItLoses:
          'When you cannot tolerate a background process, or when the pool can be drained faster than it refills during a traffic spike.',
        cost:
          'A second service to operate, a pool-depth alarm, and codes that are still enumerable unless the pool is shuffled.',
      },
      {
        option: 'Snowflake-style locally generated 64-bit ids',
        whenItWins:
          'High write volume across many nodes and regions, where any per-write coordination is unacceptable and time-sortable ids are useful.',
        whenItLoses:
          'When the code must stay short — 64 bits is about 11 base62 characters — or when you cannot guarantee unique machine ids.',
        cost:
          'Clock-skew handling that stalls rather than wraps, a machine-id assignment mechanism, and longer codes than the arithmetic asked for.',
      },
      {
        option: 'Random codes with a uniqueness check',
        whenItWins:
          'When codes must not be guessable or enumerable — private document links, unlisted shares.',
        whenItLoses:
          'When write availability matters more than unguessability, because every write now depends on a strongly consistent read.',
        cost:
          'A read-before-write on the hot path, a retry loop, and a collision rate that rises as the key space fills (≈2.8% at 10¹¹ rows in 62⁷).',
      },
      {
        option: 'Truncated hash of the long URL',
        whenItWins:
          'When identical URLs should deduplicate to one code and storage matters more than privacy.',
        whenItLoses:
          'When two users must not be able to discover that they shortened the same URL, which is a real privacy leak.',
        cost:
          'Collision handling at the birthday bound anyway, plus a salt-and-retry loop that breaks the determinism you chose it for.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"I would generate a random 6-character string and check if it exists."',
      whyWeak:
        'Two problems, and the interviewer will find both. 62⁶ is 56.8 billion, which is under the 100 billion the requirements asked for — the scheme does not fit the key space. And "check if it exists" is a read-before-write on the hot path, which couples write availability to a strongly consistent lookup. Neither is fatal; not noticing either is.',
      strongAnswer:
        '"62⁶ is 56.8 billion, which is short of the 100 billion we need, so 7 characters. If I generate randomly I need a uniqueness check on every write — at 10¹¹ rows in a 3.5 × 10¹² space that is about a 2.8% retry rate, and it puts a consistent read on the write path. I would rather pre-generate a pool of unused codes so the write is a single atomic claim, unless codes need to be unguessable, in which case random plus the check is the right cost to pay."',
    },
    {
      weakAnswer: '"Reads are heavy, so I would put Redis in front of the database."',
      whyWeak:
        'Correct conclusion, no reasoning, and it skips the two questions that follow. What does the cache hold, and how big is it? What happens when it is empty? A design that is 95% cache hits in steady state has its real capacity requirement set by the cold-start moment, and a candidate who has not computed the working set cannot answer that.',
      strongAnswer:
        '"The working set is about 20 million hot codes at roughly 250 bytes each — around 5 GB, which fits comfortably in memory. That is what makes cache-first viable. The number I would actually provision the database against is the cold-cache case: 12,000 reads per second all missing at once after a restart. I would also add request coalescing on miss so a thousand concurrent lookups of one key make one query."',
    },
    {
      weakAnswer: '"I would add a clicks column and increment it on each redirect."',
      whyWeak:
        'It turns every read into a write, on the single hottest row in the system. A viral link then serialises all its traffic on one row lock, and your redirect latency — the one number the requirements pinned at 50 ms — is now bounded by write contention on a counter nobody urgently needs to be accurate.',
      strongAnswer:
        '"Counts go off the critical path. The redirect service emits a click event after the response is written, into a bounded local buffer that batches to a queue, and a consumer aggregates. The requirements accepted minutes of lag on analytics, which is exactly what licenses this. If the analytics pipeline is down we lose counts and redirects are unaffected — that is the correct priority."',
    },
    {
      weakAnswer: '"I would shard the database from day one so it scales."',
      whyWeak:
        'The estimate is 3 TB over five years and 12,000 reads per second, most of which never reach the database. Sharding for capacity you do not have buys cross-shard queries, a resharding project, and a much more complicated failure story, in exchange for nothing. It also signals that the candidate did not use their own arithmetic.',
      strongAnswer:
        '"3 TB and 12,000 reads per second do not require sharding for capacity — one replicated primary handles this. I would partition later, and if I did it early it would be for blast radius rather than throughput: a single store means a single failure takes out all writes. That is a real argument, but it is an availability argument, and I would rather make it explicitly than dress it up as scale."',
    },
    {
      weakAnswer: '"I would use 301 redirects because they are faster."',
      whyWeak:
        'A 301 is cached by browsers and intermediaries, often permanently. It is faster, and it means the second click from that user never reaches you — so your click counts are wrong, and you can never change or revoke the destination. The candidate has silently deleted two requirements to win a few milliseconds on a request that was already going to be fast.',
      strongAnswer:
        '"302, because we committed to click analytics and to being able to revoke a link. 301 would be faster and cheaper, and it is the right choice if analytics is out of scope and links are truly immutable — but then I would say out loud that we have given up revocation, which matters because we are running what is effectively an open redirector."',
    },
    {
      weakAnswer: '"Validation is just checking the URL parses."',
      whyWeak:
        'This system takes an arbitrary destination from an anonymous user and later redirects other users to it under your domain. Without scheme restrictions it will happily store `javascript:` payloads, and without abuse controls it becomes phishing infrastructure with your brand attached, usually within days of launch.',
      strongAnswer:
        '"Validation is a security boundary here. Allow only http and https schemes, resolve and reject internal addresses to avoid being used as an SSRF pivot, rate-limit creation per account and per IP, and run destinations against a reputation check asynchronously with the ability to disable a code after the fact. Being an open redirector is inherent to the product; the controls are what stop it being a liability."',
    },
  ],

  flashcards: [
    {
      id: 'fc-url-1',
      front: 'How many base62 characters are needed for 100 billion distinct short codes, and what is the headroom?',
      back: '7 characters. 62⁷ ≈ 3.52 trillion, roughly 35× headroom. 62⁶ ≈ 56.8 billion is not enough.',
      topic: 'estimation',
    },
    {
      id: 'fc-url-2',
      front: 'Why does random code generation force a read-before-write?',
      back: 'Collisions follow the birthday bound — they become routine around √N drawings. In 62⁷ that is about 1.9 million codes, so every write must check uniqueness and retry, coupling write availability to a strongly consistent read.',
      topic: 'id-generation',
    },
    {
      id: 'fc-url-3',
      front: 'What does a pre-generated code pool buy over generating codes at write time?',
      back: 'The write path becomes a single atomic claim: no read-before-write, no coordinator, no clock dependency. Coordination moves to a background process where latency does not matter.',
      topic: 'id-generation',
    },
    {
      id: 'fc-url-4',
      front: 'What are the three fields of a Snowflake-style id, and what does each buy?',
      back: 'Timestamp (41 bits ≈ 69 years, gives time-sortability), machine id (10 bits = 1024 nodes, gives collision-free concurrency), sequence (12 bits = 4096 ids/ms/node). Bits are a budget: more of one means fewer of another.',
      topic: 'id-generation',
    },
    {
      id: 'fc-url-5',
      front: 'What must a Snowflake generator do if its clock jumps backwards?',
      back: 'Stall until the clock catches up to the last issued timestamp. Reissuing a timestamp with the same sequence numbers produces duplicate ids, which silently corrupts data.',
      topic: 'id-generation',
    },
    {
      id: 'fc-url-6',
      front: 'Which number should size the primary store in a cache-first redirect service?',
      back: 'The cold-cache load, not the steady-state miss rate. At 95% hit rate the store sees 600 QPS normally and 12,000 QPS the moment the cache restarts.',
      topic: 'caching',
    },
    {
      id: 'fc-url-7',
      front: 'Why does partitioning the cache by code not solve the viral-link problem?',
      back: 'Every request for that one code hashes to the same partition, so all its traffic lands on one node. The fix is a small in-process cache in front of the shared cache for the hottest few hundred keys.',
      topic: 'caching',
    },
    {
      id: 'fc-url-8',
      front: 'Why should click counts not be a column on the links row?',
      back: 'It turns every read into a write on the hottest row in the system, so a viral link serialises on one row lock and redirect latency becomes bound by counter contention.',
      topic: 'partitioning',
    },
    {
      id: 'fc-url-9',
      front: '301 or 302 for a URL shortener, and what does the choice cost?',
      back: '302, unless analytics and revocation are out of scope. 301 is cached by browsers so subsequent clicks never reach you — faster, but you lose click counts and the ability to change or disable the destination.',
      topic: 'api-design',
    },
    {
      id: 'fc-url-10',
      front: 'Why give redirects a higher availability target than shortening?',
      back: 'A failed redirect breaks every link already in the wild; a failed create is a retry. Splitting the targets licenses a design where the read path survives the write path being down.',
      topic: 'availability',
    },
    {
      id: 'fc-url-11',
      front: 'What is request coalescing, and why does a redirect service need it?',
      back: 'Collapsing concurrent misses for the same key into one downstream call. Without it, one hot key expiring sends thousands of simultaneous queries for the same row to the database.',
      topic: 'caching',
    },
    {
      id: 'fc-url-12',
      front: 'Why is URL validation a security boundary in this system?',
      back: 'You store an attacker-supplied destination and redirect other users to it under your domain. Restrict schemes to http/https, block internal addresses to avoid an SSRF pivot, rate-limit creation, and keep the ability to disable a code after the fact.',
      topic: 'api-design',
    },
  ],

  quiz: [
    {
      id: 'q-url-1',
      kind: 'single',
      prompt:
        'You need 100 billion distinct short codes using [A-Za-z0-9]. What is the minimum code length?',
      options: [
        { id: 'a', label: '5 characters' },
        { id: 'b', label: '6 characters' },
        { id: 'c', label: '7 characters' },
        { id: 'd', label: '9 characters' },
      ],
      correct: ['c'],
      explanation:
        '62⁶ ≈ 56.8 billion, which is short of 100 billion. 62⁷ ≈ 3.52 trillion, which covers it with about 35× headroom. Being able to state the headroom as well as the length is what makes the answer defensible under follow-up.',
      difficulty: 'intro',
      topic: 'estimation',
    },
    {
      id: 'q-url-2',
      kind: 'scenario',
      prompt:
        'Your team ships random 7-character codes with a uniqueness check. Six months in, at about 2 million stored links, engineers start seeing occasional collision retries and want to know if something is broken. What do you tell them?',
      options: [
        { id: 'a', label: 'Nothing is broken — collisions become routine around √N ≈ 1.9 million codes, by the birthday bound' },
        { id: 'b', label: 'The random number generator is biased and should be replaced' },
        { id: 'c', label: 'The key space is exhausted and codes must be lengthened immediately' },
        { id: 'd', label: 'The uniqueness check is racing and needs a stronger isolation level' },
      ],
      correct: ['a'],
      explanation:
        'Collisions in a space of size N become common around √N drawings, not around N. √(62⁷) ≈ 1.9 million, so retries at 2 million stored links are exactly what the mathematics predicts. The key space is nowhere near exhausted — at 100 billion rows the retry rate would still only be about 2.8%.',
      difficulty: 'core',
      topic: 'id-generation',
    },
    {
      id: 'q-url-3',
      kind: 'scenario',
      prompt:
        'Steady state is 12,000 redirects/second with a 95% cache hit rate. Your database is provisioned for 1,000 queries/second, which comfortably covers the 600 QPS of misses. One night the cache tier is restarted for a security patch. What happens, and what is the fix?',
      options: [
        { id: 'a', label: 'All 12,000 reads/s hit the database at once and it falls over; provision against cold-cache load and warm the cache in stages' },
        { id: 'b', label: 'Nothing — the cache repopulates transparently on demand' },
        { id: 'c', label: 'Reads fail immediately and clients retry, so it self-heals' },
        { id: 'd', label: 'The database is fine; the cache tier is the bottleneck' },
      ],
      correct: ['a'],
      explanation:
        'An empty cache means a 0% hit rate, so the full 12,000 QPS lands on a database sized for 1,000. This is why the number that sizes the primary store is the cold-start load, not the steady-state miss rate. Staggered restarts, request coalescing and a pre-warm pass are the standard mitigations.',
      difficulty: 'advanced',
      topic: 'caching',
    },
    {
      id: 'q-url-4',
      kind: 'scenario',
      prompt:
        'A single short code goes viral and now accounts for 30% of all redirect traffic. Your cache is partitioned by code across 20 nodes. What actually helps?',
      options: [
        { id: 'a', label: 'A small in-process cache in the redirect service for the hottest few hundred codes' },
        { id: 'b', label: 'Adding more cache nodes so the key space is spread wider' },
        { id: 'c', label: 'Switching the cache partitioning from hash to range' },
        { id: 'd', label: 'Increasing the TTL on that code' },
      ],
      correct: ['a'],
      explanation:
        'Partitioning distributes distinct keys, not requests for one key — every lookup of that code hashes to the same node no matter how many nodes exist. Serving it from process memory in the redirect tier removes the network hop entirely and spreads the load across every redirect instance.',
      difficulty: 'advanced',
      topic: 'caching',
    },
    {
      id: 'q-url-5',
      kind: 'scenario',
      prompt:
        'Product asks for links that "cannot be guessed" so people can share private documents. You currently use a pre-generated pool of sequential base62 codes. What changes?',
      options: [
        { id: 'a', label: 'Move to random or encrypted codes and accept a uniqueness check on the write path' },
        { id: 'b', label: 'Keep sequential codes but make them longer' },
        { id: 'c', label: 'Keep sequential codes and add rate limiting on 404s' },
        { id: 'd', label: 'Nothing — pool-allocated codes are already unpredictable' },
      ],
      correct: ['a'],
      explanation:
        'Sequential codes are enumerable regardless of length: an attacker walks the space in order. A shuffled pool helps only until the shuffling is inferred. Unguessability requires randomness (or format-preserving encryption of the sequence), and the price is the uniqueness check the pool was chosen to avoid — a requirement change that flips a design decision is exactly what the ninth step of the framework is for.',
      difficulty: 'core',
      topic: 'id-generation',
    },
    {
      id: 'q-url-6',
      kind: 'multi',
      prompt:
        'Which of these are genuine consequences of choosing 301 (permanent) over 302 (found)? Select all that apply.',
      options: [
        { id: 'a', label: 'Subsequent clicks from the same browser may never reach your service' },
        { id: 'b', label: 'Click counts become incomplete' },
        { id: 'c', label: 'You lose the practical ability to revoke or change a destination' },
        { id: 'd', label: 'The mapping no longer needs to be stored durably' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'A 301 is cached aggressively by browsers and intermediaries, which is exactly why it is faster — and why the second click never arrives, the counts are wrong, and a cached redirect keeps sending users to a destination you have since disabled. The mapping still has to be stored: new clients have never seen the redirect.',
      difficulty: 'core',
      topic: 'api-design',
    },
    {
      id: 'q-url-7',
      kind: 'scenario',
      prompt:
        'Your estimate came to 3 TB over five years and 12,000 reads per second, 95% of which are served from cache. A colleague proposes sharding the primary store across 16 nodes from launch. What is the strongest response?',
      options: [
        { id: 'a', label: 'Ask what the sharding buys: capacity is not the constraint, so the argument must be blast radius — and that argument should be made explicitly' },
        { id: 'b', label: 'Agree, because sharding early is always cheaper than sharding later' },
        { id: 'c', label: 'Refuse, because sharding is never justified below 10 TB' },
        { id: 'd', label: 'Agree, because 12,000 reads per second exceeds what one node can serve' },
      ],
      correct: ['a'],
      explanation:
        'Neither 3 TB nor 600 QPS of cache misses requires 16 shards. There is a legitimate availability argument — one store means one failure stops all writes — and it should be stated as such rather than disguised as a capacity argument. Blanket rules in either direction ("always shard early", "never below 10 TB") are not reasoning.',
      difficulty: 'advanced',
      topic: 'partitioning',
    },
    {
      id: 'q-url-8',
      kind: 'single',
      prompt:
        'A Snowflake-style generator detects that the system clock has moved backwards by 200 ms. What is the correct behaviour?',
      options: [
        { id: 'a', label: 'Stall until the clock passes the last issued timestamp' },
        { id: 'b', label: 'Continue with the new time and rely on the sequence bits to avoid collisions' },
        { id: 'c', label: 'Increment the machine id to stay unique' },
        { id: 'd', label: 'Fall back to random ids for the affected window' },
      ],
      correct: ['a'],
      explanation:
        'Going backwards lets the generator reissue timestamp-and-sequence combinations it has already used, producing duplicate ids that corrupt data silently. Refusing to issue until the clock catches up trades a short availability blip for correctness — the right trade for an identifier. Changing the machine id would collide with whichever node actually owns it.',
      difficulty: 'advanced',
      topic: 'id-generation',
    },
  ],

  exercises: [
    {
      id: 'ex-url-1',
      kind: 'design',
      title: 'Change one requirement and rederive',
      estimatedMinutes: 25,
      prompt: `Keep everything from the lesson, but change exactly one requirement:

> **Links are private. Short codes must not be guessable or enumerable, and a user must not be able to discover that another user shortened the same URL.**

Work through the consequences. Specifically:

1. Which generation schemes are now disqualified, and why — including the truncated-hash scheme, which fails for a reason unrelated to guessability.
2. What the write path looks like now, and which component's availability the write path has become coupled to.
3. What the collision retry rate is at 10 billion stored links with 7-character codes, and whether you would change the code length.
4. One option that preserves unguessability *without* a read-before-write. (Hint: you do not have to generate the randomness at write time, and you do not have to store a random value to produce one.)
5. What you would tell the interviewer if they then asked "does this change your availability targets?"

Write it as you would say it out loud in an interview: assumptions stated, arithmetic shown.`,
      rubric: [
        'Disqualifies sequential ids and Snowflake ids as enumerable, and states that a pre-generated pool is only as unguessable as its shuffling.',
        'Disqualifies the truncated-hash scheme specifically because determinism leaks that two users shortened the same URL — the requirement that is not about guessing.',
        'Describes the write path as: generate random code → check uniqueness → insert, and names the coupling to a strongly consistent read on the primary store.',
        'Computes the collision probability as roughly stored ÷ key space: 10¹⁰ ÷ 3.52 × 10¹² ≈ 0.28%, i.e. about one write in 350 retries.',
        'Decides on code length with an argument rather than a reflex — 7 characters is defensible at 0.28%; lengthening to 8 or 9 buys margin at the cost of usability.',
        'Offers a no-read-before-write option: either a pre-generated pool of random codes (uniqueness enforced once, offline), or format-preserving encryption of a sequential counter, which is bijective and therefore collision-free by construction.',
        'Answers the availability question by noting the write path is now coupled to a consistent read, so the 99.9% shortening target either drops or requires more from the primary store — and that redirect availability is unaffected.',
      ],
      modelAnswer: `**1. What is disqualified**

*Sequential base62 ids* and *Snowflake ids* are out immediately: both are enumerable by construction. An attacker who obtains one code can walk forwards and backwards through the space, and with Snowflake ids the timestamp bits additionally reveal creation time and creation rate.

*A pre-generated pool of sequential codes* is out for the same reason — the pool changes when coordination happens, not what the codes look like. A pool of *shuffled* codes is better but still finite: an attacker who collects enough samples can characterise the shuffle. It is not a security property you would want to defend.

*Truncated hash of the URL* fails for a different and more interesting reason. It is deterministic, so shortening \`https://example.com/secret-doc\` always yields the same code. Any user who guesses or already knows the URL can compute its code and confirm that someone else shortened it — and can then watch its click count. The stated requirement is not only "hard to guess", it is "must not reveal that two users shortened the same URL", and determinism violates that directly even if the hash output is perfectly unpredictable.

**2. The write path**

\`\`\`
POST /v1/links
  → generate 7 random base62 characters from a CSPRNG
  → INSERT ... ON CONFLICT DO NOTHING
  → if 0 rows inserted, regenerate and retry
  → 201
\`\`\`

The important structural change: the write is now a *conditional* write that must observe the current state of the key space. Whether it is expressed as a read-then-write or as an atomic conditional insert, the write path is coupled to a strongly consistent view of the primary store. It can no longer be served by a replica, and it cannot proceed while the primary is unavailable for writes.

Using \`INSERT ... ON CONFLICT DO NOTHING\` rather than \`SELECT\` then \`INSERT\` is worth saying out loud: it collapses the check and the write into one atomic operation and removes a race that a naive read-then-write would have.

**3. Collision rate at 10¹⁰ links**

The probability that a freshly generated code is already taken is (occupied ÷ space):

10 × 10⁹ ÷ 3.52 × 10¹² ≈ **0.28%**

So roughly one write in 350 retries once, and the probability of two consecutive collisions is about one in 125,000. At 120 writes/second peak that is about one retry every three seconds — entirely unremarkable.

**Would I lengthen the code?** No, not at this occupancy. 7 characters at 0.28% is comfortable, and every extra character is one the user has to copy, read aloud, or fit into a message. I would set an alarm on the retry rate rather than pre-emptively lengthening: the retry rate *is* the occupancy metric, and when it crosses about 5% I would issue 8-character codes for new links while continuing to serve the existing 7-character ones. Mixed-length codes are fine because the code is a primary key, not a fixed-width field.

**4. Unguessable without a read-before-write**

Two options, and the second is the more interesting one.

*Pre-generated pool of random codes.* Uniqueness is enforced once, offline, when the pool is generated — the generator can afford a uniqueness check because it is not on anyone's critical path. The write path then claims a pool entry atomically, exactly as in the original design. This keeps every property of the original write path and adds unguessability. The cost is that the pool is now sensitive data: if it leaks, future codes are known in advance.

*Format-preserving encryption of a sequential counter.* Keep the sequential counter, and publish \`E_k(n)\` rather than \`n\`, where \`E_k\` is a keyed bijection over the 62⁷ space. Because it is a bijection, distinct counters map to distinct codes: **collisions are impossible by construction**, so there is no uniqueness check at all. Without the key, output is indistinguishable from random, so codes are not enumerable. Decoding is a local computation.

The trade is that the scheme's security rests entirely on the key: if it leaks, every past and future code is derivable, and rotating the key would change the mapping for existing links, so it cannot be rotated without a migration. That is a real cost and worth stating — but for this requirement it is the cleanest answer, because it gets unguessability for free without giving up the boring write path.

**5. Does this change the availability targets?**

Redirect availability is untouched: reads still go cache-first against an immutable mapping, and nothing about the read path changed.

Shortening availability is the one affected, and only under the random-with-check scheme, because the write now needs a consistent view of the primary. Either I accept that 99.9% shortening now depends on primary-write availability, or I choose the pool or the encryption scheme, both of which restore the original decoupling. That is the honest answer: **the requirement change costs write availability unless I spend design effort to avoid it, and the encryption approach is that effort.**`,
    },
    {
      id: 'ex-url-2',
      kind: 'estimate',
      title: 'Size the cache honestly',
      estimatedMinutes: 15,
      prompt: `The lesson asserted a 5 GB cache working set without much justification. Redo it properly, and then answer a harder question.

Assumptions to work from:

- 100 million links created per month, retained forever
- After 3 years the service holds 3.6 billion links
- Click distribution is heavily skewed: roughly 80% of clicks go to links created in the last 30 days, and within any cohort the top 5% of links take about 70% of that cohort's clicks
- Cached value: the long URL (~200 bytes) plus overhead (~50 bytes)
- Total 12,000 redirects/second at peak

Compute:

1. The size of a cache that holds the last 30 days of links in full.
2. The size of a cache that holds only the top 5% of the last 30 days plus the top 5% of everything older.
3. The approximate hit rate each option gives you, and which one you would ship.
4. What changes about your answer if links are given a 90-day TTL by default.`,
      rubric: [
        'Computes option 1 as 100 M × 250 B = 25 GB, not the 5 GB the lesson asserted.',
        'Computes option 2 as roughly (5% of 100 M) + (5% of 3.5 B) ≈ 5 M + 175 M entries — and notices that the older tier dominates and is far larger than 5 GB.',
        'Reasons about hit rate from the stated skew rather than guessing a number: option 1 captures ~80% of clicks; option 2 captures roughly 0.8 × 0.7 + 0.2 × 0.7 ≈ 70%.',
        'Notices that the lesson\'s 5 GB figure was optimistic and says so, rather than reproducing it.',
        'Chooses an option with a stated reason, and considers a two-tier design (small in-process cache for the very hottest, shared cache for the recent cohort).',
        'Handles the TTL question: a 90-day TTL bounds total links to ~300 M, which caps the cache at ~75 GB in full and makes "cache everything live" a real option.',
      ],
      modelAnswer: `**1. Last 30 days in full**

100 million links × 250 bytes = **25 GB**.

That is five times the figure the lesson asserted, and the lesson was wrong to hand-wave it. 25 GB is still perfectly cacheable — it is a handful of instances, or one large one — but it is a materially different provisioning conversation, and it is exactly the kind of number an interviewer will ask you to produce rather than accept.

**2. Top 5% of recent, plus top 5% of the archive**

- Recent tier: 5% of 100 M = 5 M entries × 250 B = **1.25 GB**
- Archive tier: total links after 3 years ≈ 3.6 B, of which ~3.5 B are older than 30 days. 5% of that is 175 M entries × 250 B = **~44 GB**

Total ≈ **45 GB**, which is *larger* than caching the whole recent cohort. The archive tier dominates because the archive is 35× the size of one month, and 5% of a very large number is still a large number.

This is the useful surprise in the exercise: "cache only the hot ones" sounds cheaper than "cache everything recent", and here it is not. Skew that is strong *within* a cohort does not save you when the cohorts keep accumulating.

**3. Hit rates**

- **Option 1** captures 80% of clicks by construction (all clicks to links from the last 30 days), so ≈ **80% hit rate** for 25 GB.
- **Option 2** captures 70% of the recent 80% plus 70% of the older 20%: 0.8 × 0.7 + 0.2 × 0.7 = **70% hit rate** for 45 GB.

Option 1 is both smaller and better. Ship option 1.

But the honest answer is a **two-tier cache**, because the two tiers are solving different problems:

- An in-process cache in each redirect instance holding a few thousand entries. It costs megabytes, absorbs the viral-link case entirely, and removes a network hop for the very hottest keys.
- A shared cache holding the last 30 days at 25 GB, taking the ~80% bulk.

Together that gets you above 80% while making the hot-key failure mode disappear, which no single-tier design does.

**4. With a 90-day default TTL**

A TTL changes the shape of the problem more than any cache tuning does. Steady state becomes about 3 × 100 M = **300 million live links**, and it stops growing — the arrival rate and the expiry rate balance.

- Caching *every live link* is 300 M × 250 B = **75 GB**, which is a modest cluster and gives a hit rate approaching 100% minus cold-start effects.
- The primary store also stops growing without bound: it holds ~150 GB rather than heading for 3 TB.
- New work appears: expiry has to actually happen, and there is a reclamation question — do expired codes go back into the pool for reuse? Reusing them is efficient and dangerous, because an old link in the wild would suddenly resolve to someone else's destination. I would not reuse codes; the key space has 3.5 trillion entries and reclaiming them buys nothing worth that risk.

The transferable point: a retention policy is a capacity decision disguised as a product decision, and it is usually the cheapest lever available. Asking "do these expire?" in Step 1 is not box-ticking.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-url-1',
      level: 'basic',
      question: 'Design a URL shortener.',
      guidance:
        'A strong answer spends the first three to five minutes on requirements and arithmetic, not on components. Look for: functional versus non-functional split, the read:write ratio stated as a number, code length derived from the key space, and separate availability targets for redirects and creation. A candidate who opens with "I would use Redis and a NoSQL database" has skipped the part being assessed.',
    },
    {
      id: 'iq-url-2',
      level: 'basic',
      question: 'How long should the short code be, and how did you get that number?',
      guidance:
        'The number is 7 for 100 billion URLs over a 62-symbol alphabet, and the reasoning is 62ⁿ ≥ N. A strong answer also states the headroom (35×) and notices that headroom is what makes the choice defensible if the estimate was wrong by an order of magnitude.',
    },
    {
      id: 'iq-url-3',
      level: 'intermediate',
      question: 'How do you generate the codes, and what does your scheme cost you?',
      guidance:
        'Any of the four families is acceptable; what matters is naming the cost. Sequential: enumerable, and a coordinator. Random: read-before-write and a retry rate. Snowflake: 11 characters and clock-skew handling. Pool: a background service and a depth alarm. A strong answer also names the requirement that would flip the choice.',
    },
    {
      id: 'iq-url-4',
      level: 'intermediate',
      question: 'Walk me through what happens on a redirect, from the client to the response.',
      guidance:
        'Look for the cache-first path, the miss path, and the analytics emission happening *after* the response rather than before it. A strong answer volunteers the hit rate and what the miss rate implies for database provisioning. An answer that puts the click-count write in the request path has mis-prioritised the one latency requirement that was pinned.',
    },
    {
      id: 'iq-url-5',
      level: 'advanced',
      question: 'One link goes viral and takes 30% of your traffic. What happens and what do you do?',
      guidance:
        'The key insight is that partitioning distributes keys, not requests for one key, so adding cache nodes does nothing. Strong answers reach for an in-process cache in the redirect tier. Excellent answers also mention request coalescing so that the moment that hot key expires does not produce a thundering herd on the database.',
    },
    {
      id: 'iq-url-6',
      level: 'advanced',
      question: 'Your cache tier restarts and comes back empty. Walk me through the next sixty seconds.',
      guidance:
        'The candidate should recognise that hit rate goes to zero and full read traffic lands on a store sized for the miss rate. Strong answers name staggered restarts, request coalescing, and provisioning the store against cold-start rather than steady-state load. Excellent answers note this is the number that actually sizes the database, and that it is why "we are 95% cache hits" is not a capacity plan.',
    },
    {
      id: 'iq-url-7',
      level: 'advanced',
      question: 'This service is an open redirector. What are you doing about that?',
      guidance:
        'A candidate who has not thought about abuse is designing half a system. Look for scheme allowlisting, blocking internal address ranges to prevent an SSRF pivot, per-account and per-IP creation rate limits, asynchronous reputation scanning, and the ability to disable a code after creation — which, note, is only possible because the design chose 302 over 301.',
    },
    {
      id: 'iq-url-8',
      level: 'followup',
      question: 'You said 302 for analytics. Now suppose analytics is dropped from scope. Does anything change?',
      guidance:
        'A good answer says 301 becomes viable and would cut load substantially, then immediately names what is given up: revocation, destination changes, and any future analytics. An excellent answer notes that once 301s are in browser caches they cannot be recalled, so this choice is much harder to reverse than it looks — and that for a system whose whole risk profile is abusive destinations, keeping revocation may be worth the traffic.',
    },
    {
      id: 'iq-url-9',
      level: 'followup',
      question: 'You chose not to shard. At what point would you change your mind, and what would you shard on?',
      guidance:
        'Look for a trigger expressed as a measurement, not a milestone: write throughput approaching what one primary sustains, storage approaching what one instance holds comfortably, or a blast-radius requirement. The shard key is the code, because that is the only key the read path uses; sharding by owner would make the hot path a scatter-gather. Excellent answers mention that consistent hashing keeps a resharding event from moving every key.',
    },
    {
      id: 'iq-url-10',
      level: 'followup',
      question: 'How would you delete a link, and what makes that harder than it looks?',
      guidance:
        'Deleting the row is trivial; the cache is the problem. The candidate must address invalidation across every cache node and every in-process cache, and decide what a deleted code returns (410 rather than 404 conveys "existed, now gone"). Strong answers note that in-process caches are the hardest to invalidate — they need short TTLs or a pub/sub invalidation channel — and that this cost is the price of the tier that solved the viral-link problem.',
    },
  ],

  activeLearning: [
    {
      id: 'al-url-1',
      kind: 'modify-architecture',
      prompt:
        'The design serves 12,000 redirects/second from one region. Product now wants links to resolve fast for users worldwide, and the business wants the service to keep redirecting even if the primary region is entirely offline for an hour. Sketch what changes. Be specific about what happens to writes during that hour, and what the user of the shortening API experiences.',
      discussion: `The key realisation is that **the read path and the write path have completely different multi-region requirements**, and treating them as one problem produces a much harder design than necessary.

**Reads are almost trivial to make global.** The mapping is immutable after creation — a code's destination changes only on the rare edit or revocation. Immutable data is the easiest thing in distributed systems to replicate: put a full read replica plus a cache tier in each region, and have redirects served entirely locally. There is no consistency problem worth solving here, because there is no concurrent mutation to reconcile. The only staleness window that matters is between creating a link and it becoming resolvable in a distant region — typically seconds, and a link that is a second old has usually not been clicked yet. If that matters, the create response can hold until the link is confirmed present in a quorum of regions.

**Writes are where the decision is.** Two credible options:

*Single write region.* All creates go to one region; other regions proxy. Simple, no conflicts, no coordination. During a regional outage, **creation stops entirely** and redirects keep working from replicas. The API returns 503 with a Retry-After, and clients back off. Given that the requirements set shortening at 99.9% and redirects at 99.99%, this is not a compromise — it is exactly the design the requirements asked for.

*Region-partitioned code space.* Give each region a disjoint slice of the key space — a distinct machine-id range in a Snowflake scheme, or region-specific pool segments. Now every region can create links locally with no cross-region coordination, because two regions can never produce the same code. During an outage, the surviving regions keep creating. The cost is that the code now encodes its origin region (visible to anyone who studies the codes), and that a permanently lost region's slice is stranded.

**What the API user experiences during the hour**, under each option:

- Single write region: \`POST /v1/links\` returns 503 with \`Retry-After\`. Every existing link resolves normally. The failure is visible, bounded, and exactly the one the availability targets predicted.
- Partitioned key space: creates succeed against a nearby region. Users notice nothing.

**The transferable point.** "Make it multi-region" is not one decision. Ask which operations must survive a region loss, and you will usually find that reads are easy and writes are the only real problem — after which the question becomes how to make writes not need coordination, which is a key-space partitioning problem rather than a consensus problem. Reaching for global consensus before asking whether the write can be partitioned is the most common way to make this design ten times harder than it needs to be.`,
    },
    {
      id: 'al-url-2',
      kind: 'debug',
      prompt:
        'A URL shortener in production reports: redirect p50 is 8 ms, p99 is 2.1 seconds. Cache hit rate is a healthy 96%. The database shows low average CPU and no slow queries in its log. Error rate is zero — every request eventually succeeds. What is your leading hypothesis, and what would you measure to confirm it?',
      discussion: `A 250× gap between p50 and p99, with a *healthy* hit rate, no errors and an idle database, is a very specific signature. It says the slow requests are not doing more work — they are **waiting** for something that the fast requests never touch.

**Leading hypothesis: a thundering herd on individual hot keys at expiry.**

Here is the mechanism. A popular code sits in the cache with a TTL. When that TTL expires, every in-flight request for that code misses simultaneously. If there is no request coalescing, all of them independently query the database for the same row. The database handles it — one row, indexed lookup, low CPU, no slow query — but the *requests* queue behind connection-pool limits and each other, and every one of them pays the full miss latency plus queueing.

This produces exactly the observed numbers:

- The 96% hit rate is unaffected, because the herd is a small fraction of total requests.
- Average database CPU stays low, because a burst of identical point lookups is cheap work.
- No individual query is slow, so nothing appears in the slow-query log.
- No errors, because everything eventually completes.
- Only the few hundred requests caught in each herd are slow — which is precisely the p99 tail.

**What to measure, in order:**

1. **Cache miss latency distribution, separated from hit latency.** If misses have their own long tail, the problem is downstream of the miss, not in the cache. If misses are uniformly fast, the hypothesis is wrong.
2. **Miss rate over time at second granularity, per key.** A herd is visible as periodic spikes correlated with TTL boundaries — a sawtooth, not a flat line. Averages over a minute will hide it completely, which is why nobody has noticed.
3. **Connection pool wait time on the redirect service.** This is the metric that usually confirms it: requests are not slow in the database, they are slow waiting for a connection to the database. Pool saturation with an idle database is the fingerprint.
4. **Correlate slow requests with the code being requested.** If the p99 requests cluster on a handful of codes, it is a hot-key problem. If they are spread uniformly, look elsewhere — probably at garbage collection pauses or connection churn.

**The fixes, roughly in order of effort:**

- **Request coalescing** on miss, so N concurrent misses for one key make one downstream call and the rest wait on its result. This is the direct fix and usually eliminates the tail entirely.
- **Jittered TTLs**, so a cohort of keys written together does not expire together.
- **Serve-stale-while-revalidating**: return the expired value immediately and refresh in the background. Perfectly acceptable here, because a mapping that was correct one second ago is almost certainly still correct.
- **An in-process cache** for the hottest keys, which is the same fix the viral-link problem needed. Two symptoms, one remedy — worth noticing.

**The transferable lesson:** when p50 is excellent and p99 is catastrophic, stop looking at resource utilisation. Utilisation metrics are averages, and averages are exactly where queueing hides. Look for a queue.`,
    },
  ],

  revision: {
    bullets: [
      'Three numbers drive the whole design: how many URLs ever (code length), read:write ratio (caching), how wrong a redirect can be (consistency and failure).',
      'Key space: 62ⁿ ≥ N. 62⁶ ≈ 56.8 B, 62⁷ ≈ 3.52 T. Seven characters for 100 billion, with 35× headroom.',
      'Collisions follow the birthday bound: routine at √N ≈ 1.9 M codes, not at N. Random generation therefore needs a uniqueness check on every write.',
      'Estimation: 100 M links/month ⇒ 40 writes/s average, 4,000 reads/s at 100:1, ~3× at peak, ~500 B/row, ~3 TB over five years.',
      'That scale does not need sharding for capacity. If you shard, say it is for blast radius, not throughput.',
      'Give redirects a higher availability target than creation. That split licenses two paths that fail independently.',
      'Code generation families: sequential (enumerable, coordinator), random (read-before-write), Snowflake (11 chars, clock skew), pre-generated pool (boring, and boring wins).',
      'Snowflake bits are a budget: 41 timestamp / 10 machine / 12 sequence. Clock going backwards must stall, never wrap.',
      '302 not 301, unless analytics and revocation are out of scope — a cached 301 cannot be recalled.',
      'Click counts never go in the links row. Emit an event after the response into a bounded buffer; losing counts beats losing redirects.',
      'Size the primary store against the cold-cache load, not the steady-state miss rate.',
      'Partitioning spreads keys, not requests for one key. A viral link needs an in-process cache, plus request coalescing for the moment it expires.',
      'Validation is a security boundary: scheme allowlist, block internal addresses, rate-limit creation, keep the ability to disable a code.',
      'The defence: sequential-from-a-pool, 302, cache-first, no counter column — and "unguessable codes" is the requirement that would flip it.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A service that maps short codes to long URLs and redirects on lookup: a read-dominated key-value system where the only genuinely hard decision is how codes are allocated.',
    whyItExists:
      'It is the smallest system design problem in which every component can be justified by arithmetic, which makes it the standard test of whether a candidate derives designs or recalls them.',
    whenToUse: [
      'As the first HLD problem to practise the full nine-step loop, because the loop is visible end to end in 45 minutes.',
      'As a reference for any allocate-a-unique-identifier problem: booking references, invite codes, invoice numbers, device ids.',
      'As a reference for any read-dominated system where a cache carries almost all traffic.',
    ],
    whenNotToUse: [
      'As a template for write-heavy or transactional systems — nothing here handles contention, because there is none.',
      'As a template for systems where the mapping is mutable and hot; this design leans hard on the destination being effectively immutable.',
    ],
    alternatives: [
      'Format-preserving encryption of a counter: unguessable and collision-free by construction, at the cost of a key you can never rotate without a migration.',
      'A managed key-value store with a global secondary index: less to operate, less control over the hot-key behaviour.',
      'For an internal-only tool, one Postgres table and no cache at all. At a few hundred requests per second that is the entire correct design.',
    ],
    tradeoffs: [
      'Sequential codes are dense and coordination-cheap but enumerable; random codes are unguessable but put a consistent read on every write.',
      '302 costs traffic and buys analytics and revocation; 301 is faster and permanently uncontrollable.',
      'A cache tier buys latency and a cold-start capacity cliff that then sizes your database.',
      'Sharding early buys blast-radius isolation and costs cross-shard operations and a resharding project you did not need.',
    ],
    failureModes: [
      'Cold cache after a restart: hit rate to zero, full read traffic on a store provisioned for the miss rate.',
      'Hot key: one viral code saturates a single cache partition regardless of how many partitions exist.',
      'Thundering herd at TTL expiry: p50 stays fast, p99 collapses, database looks idle because the queue is in the connection pool.',
      'Snowflake clock skew backwards: duplicate ids, silently.',
      'Analytics backpressure leaking into the redirect path if the click emit is not bounded and fire-and-forget.',
      'Abuse: an open redirector under your domain, found by phishing operations within days of launch.',
    ],
    followUpQuestions: [
      'How long is the code, and what happens when your traffic estimate was wrong by 10×?',
      'What is your collision rate, and what does the write path do when a collision happens?',
      'Your cache just restarted empty. Walk me through the next sixty seconds.',
      'One link is 30% of your traffic. What breaks, and why does adding cache nodes not help?',
      'Codes must now be unguessable. What changes, and what does it cost you?',
      'How do you revoke a link, and which of your earlier decisions made that possible?',
      'Where does the click count live, and why is it not on the row?',
    ],
  },
});
