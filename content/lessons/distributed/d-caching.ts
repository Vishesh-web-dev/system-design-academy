import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-caching',
  title: 'Caching: where, what, and invalidation',
  summary:
    'Cache placement decides your failure mode and invalidation decides your correctness — and the number that sizes your database is the cold-cache load, not the steady-state miss rate.',
  phase: 'distributed',
  module: 'serving',
  position: 19,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['caching', 'invalidation', 'stampede', 'hit-rate', 'consistency'],
  prerequisites: ['f-indexes', 'f-denormalization'],
  resources: [
    {
      key: 'aws-caching-challenges',
      tier: 'must',
      note: 'The best short treatment of what goes wrong: stampedes, cold starts, and the observation that a cache changes your failure mode rather than only your latency. Read it before adding any cache.',
    },
    {
      key: 'facebook-memcache',
      tier: 'must',
      note: 'A production caching layer at extreme scale. The leases mechanism for stampede prevention and the discussion of stale sets are the two ideas most worth extracting.',
    },
    {
      key: 'mdn-http-caching',
      tier: 'must',
      note: 'Read the sections on Cache-Control, ETag and stale-while-revalidate. HTTP already implements most of what people rebuild in application code.',
    },
    {
      key: 'caffeine-cache-wiki',
      tier: 'good',
      note: 'Why LRU is not the best eviction policy, and what admission policies buy. Useful for understanding that hit rate is a property of the policy, not only of the size.',
    },
    {
      key: 'redis-expire',
      tier: 'good',
      note: 'How expiry actually works — lazily plus a background sampler — which matters because it means an expired key can still occupy memory.',
    },
  ],

  intuition: {
    body: `A cache is a copy of an answer, kept somewhere cheaper to reach. That is all, and everything difficult about caching follows from the word *copy*.

Two questions decide a caching design, and they decide different things:

**Where does the copy live?** This determines your failure mode. A copy in the browser cannot be invalidated. A copy at the CDN edge can be, slowly. A copy in a shared cache can be, immediately. A copy in process memory is invisible to everyone else, so nothing can invalidate it at all.

**When does the copy become wrong, and what happens then?** This determines your correctness. Every cache is a bet that the underlying answer has not changed. Sometimes the bet is safe because the data is immutable. Usually it is a wager with a time limit.

The thing most people get wrong is which number matters. A team measures 95% hit rate and concludes the database sees 5% of traffic. True in steady state, and irrelevant to capacity planning — because the moment the cache restarts, is deployed, or is flushed, the database sees **100%** of traffic. **The number that sizes your database is the cold-cache load.**

There is also a question worth asking before any of this: *is the work actually expensive?* A cache in front of an indexed primary-key lookup taking 0.4 ms buys nothing and adds a second source of truth, an eviction policy, and a new failure mode. Caching is for expensive work — a slow aggregate, a remote call, a computation — or for protecting a fragile dependency. It is not a general-purpose accelerant.`,
    analogyLimit:
      'Thinking of a cache as "a faster copy" is right and hides the asymmetry that causes incidents: the cache is fast when it is working and your system is sized for the cache working. A cache is not an optimisation layered on a system that would otherwise be slower — it is frequently a load-bearing component whose absence is an outage, and treating it as optional is how a Redis restart takes down a service.',
  },

  deepExplanation: {
    predict: {
      question:
        'A service serves 20,000 reads/second with a 96% cache hit rate. The database is provisioned for 1,500 queries/second, comfortably above the 800 QPS of misses. During a routine cache upgrade the cache tier restarts. What happens over the next 60 seconds, and what should the database have been provisioned for?',
      answer: `**The database receives 20,000 queries/second against a capacity of 1,500.** It saturates within a second, queries queue, connection pools exhaust, and the service is down — for a *routine maintenance operation on a component that was supposed to be an optimisation.*

The recovery is worse than it looks, because it does not self-heal cleanly. As the cache warms, misses fall — but only for keys that have been requested and successfully populated. While the database is saturated, most requests time out before they can populate the cache, so the cache stays cold and the load stays at 20,000. **The system can sit in that state indefinitely** rather than gradually recovering.

**What it should have been provisioned for:** the cold-cache load, or close to it. Options, in ascending order of cost:

- **Provision for cold load.** Expensive: 13× the steady-state requirement, idle almost always.
- **Warm the cache before taking traffic.** Populate from a known key set, or bring the new tier up alongside the old one and switch over warm. This is what makes rolling cache upgrades safe.
- **Request coalescing.** A thousand concurrent misses on one key make *one* database call. This does not help a cold cache with 20,000 *distinct* keys, and it helps enormously with hot-key concentration.
- **Load shedding with a fallback.** When the database is saturated, serve stale data if any exists, or fail fast with a degraded response rather than queueing. Failing fast is what allows recovery, because it stops the queue that prevents the cache warming.
- **Never flush the whole tier at once.** Restart nodes in sequence so hit rate degrades by 1/N rather than to zero.

**The general principle:** provision the layer behind a cache for the load it sees when the cache is *absent*, not when it is working. Otherwise the cache is not an optimisation — it is a single point of failure you have not acknowledged.`,
    },
    body: `## Where the copy lives, and what that costs you

Placement is the first decision, and it fixes what you can and cannot do afterwards.

| Location | Latency | Can you invalidate it? | Failure mode |
| --- | --- | --- | --- |
| Browser / client | 0 | **No.** Once sent, it is gone | Stale data you cannot recall |
| CDN edge | 5-30 ms | Yes, with a purge that takes seconds to minutes | Regional staleness |
| Reverse proxy | 1-5 ms | Yes | One shared cache to keep correct |
| In-process | 0.01 ms | **Only via TTL or a pub/sub channel** | Each instance holds a different version |
| Shared cache (Redis, Memcached) | 0.5-2 ms | Yes, immediately | A network hop, and a new dependency |
| Materialised in the database | query time | Yes, transactionally | Not really a cache — see the derived-data lesson |

Two entries deserve emphasis because they are where surprises live.

**Client caches cannot be recalled.** A \`Cache-Control: max-age=86400\` response is in that browser for a day, and no amount of deployment changes it. Which is why long client-side caching requires content-hashed URLs — you do not invalidate the old copy, you stop referring to it.

**In-process caches diverge.** Ten instances each hold their own copy, so a user whose requests land on different instances sees different data — the monotonic-read problem from replication, arriving from a different direction. They are fantastically fast and the right answer for very hot keys, and they need short TTLs or an invalidation broadcast.

## The three patterns

**Cache-aside (lazy loading).** The application checks the cache, and on a miss reads the source and populates. The default, and the one everything else is a variation of.

- Only requested data is cached, so memory tracks actual demand.
- Every miss pays the full cost, so the first request after an expiry is slow.
- The cache and the source can disagree, because population happens after the read.

**Write-through.** Writes go to the cache and the source together. The cache is never stale for written keys, and every write pays cache latency. Keys never read are cached anyway, wasting memory.

**Write-behind.** Writes go to the cache and are flushed to the source asynchronously. Very fast writes, and **you can lose acknowledged writes** if the cache dies before flushing. Acceptable for metrics and counters; not for anything you cannot regenerate.

Most systems want cache-aside. The reason is that reads and writes usually have very different distributions, and cache-aside is the only one that lets memory follow read demand.

## Invalidation: the actual hard part

Three strategies, and the ordering matters because the first is right more often than the others.

**TTL (expiry).** The copy is valid for N seconds, then it is gone. Wrong for at most N seconds, and then **self-corrects** — which is the property that makes a cache dramatically easier to live with than a denormalised column. It needs no coordination, so it works with in-process caches, CDNs and clients alike.

The cost is bounded staleness, and choosing N is a product decision: how wrong may this be? A price on a listing page might tolerate 60 seconds; an account balance might tolerate zero, which means it should not be cached.

**Explicit invalidation.** On write, delete or update the cached key. Correctness is immediate, and you now need to know *every* key affected by a write — which is the hard part. A change to a product's price affects the product page, the category listing, the search result, the recommendation panel, and the sitemap. Missing one leaves it stale forever, because there is no TTL to save you.

**Versioned keys.** Include a version or content hash in the key: \`product:991:v7\`. A write bumps the version, so new reads miss and old entries are never read again, aging out naturally. No invalidation call, no coordination, and it works across every cache layer including clients. The cost is memory holding unreferenced old versions until eviction, and needing the version available wherever the key is constructed.

**Delete, do not update.** When you do invalidate explicitly, prefer deleting the key over writing the new value into it. Writing the new value races: two concurrent writers can populate in the wrong order, leaving the cache holding the older value permanently. Deleting means the next read repopulates from the source, which is by definition current.

## Stampedes and hot keys

Two distinct failure modes that get confused.

**A stampede (thundering herd)** is many concurrent requests for the *same* key missing at once — typically the moment a popular key expires. Without coordination, all of them hit the source for identical data.

*Fixes:* **request coalescing** (the first miss fetches, the rest wait on its result), **stale-while-revalidate** (serve the expired value and refresh in the background — correct here because a value that was right a second ago is almost certainly still right), and **jittered TTLs** so keys written together do not expire together.

**A hot key** is one key taking a disproportionate share of *all* traffic — a viral item, a celebrity account. Note what does not help: **partitioning the cache**. Every request for that key hashes to the same node regardless of how many nodes exist.

*Fixes:* an **in-process cache** in front of the shared cache for the top few hundred keys, turning the hottest keys into zero network hops and spreading them across every application instance; or **key splitting** — store N copies under \`key:0\`..\`key:N\` and read a random one, which spreads reads and multiplies invalidation work.

## Hit rate is a property of policy, not only size

Eviction decides what stays when memory is full, and LRU is the default rather than the best.

**LRU** evicts the least recently used. It is fooled by a scan: a batch job reading a million rows once evicts your entire working set to cache data nobody will request again.

**LFU** evicts the least frequently used, which resists scans and adapts slowly to genuine changes in what is popular.

**Admission policies** decide whether a new item is worth caching *at all*, by comparing its estimated frequency against the victim it would evict. This is what modern caches do, and it is why hit rate can improve substantially with no extra memory.

For most systems the default policy is fine and the useful lesson is diagnostic: **if a batch job tanks your hit rate, the policy is the cause**, and either a separate cache for that workload or a scan-resistant policy is the fix.

## The questions to ask before adding a cache

1. **Is the work expensive?** If the underlying operation is a sub-millisecond indexed lookup, a cache adds a second source of truth for no gain.
2. **What is the staleness budget, as a number?** If the answer is zero, do not cache — or cache only immutable data.
3. **What is the cold-cache load, and can the source survive it?** This is the capacity question, and it is the one most often skipped.
4. **What is the hit rate you expect, and from what?** A cache in front of uniformly distributed reads over a large key space has no working set to exploit and will not help.
5. **Who invalidates, and can they name every affected key?** If not, use TTLs or versioned keys.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'cold-cache',
      title: 'Why the cold-cache load sizes your database',
      caption:
        'Follow the second column. The database was provisioned for the miss rate, which is the wrong number — and note that saturation prevents the cache warming, so the system does not gradually recover on its own.',
      code: `flowchart TB
    subgraph WARM["Steady state — 96% hit rate"]
      W1["20,000 reads/s"] --> W2[Cache]
      W2 -->|"19,200/s served"| W3["✓ Fast"]
      W2 -->|"800/s miss"| W4["Database<br/>capacity 1,500/s"]
      W4 --> W5["✓ Comfortable"]
    end

    subgraph COLD["Cache restarts — 0% hit rate"]
      C1["20,000 reads/s"] --> C2[Cache: empty]
      C2 -->|"20,000/s miss"| C3["Database<br/>capacity 1,500/s"]
      C3 --> C4["✗ Saturated in under a second"]
      C4 --> C5["Queries queue,<br/>pools exhaust"]
      C5 --> C6["Requests time out before<br/>they can populate the cache"]
      C6 --> C2
    end

    style W5 fill:#17272a,stroke:#35897e
    style C4 fill:#2a1d1d,stroke:#b8383b
    style C6 fill:#2a1d1d,stroke:#b8383b`,
    },
    {
      kind: 'flow',
      id: 'cache-layers',
      title: 'Five places to put a copy, and what each gives up',
      caption:
        'Step through the layers. The pattern to notice: latency improves as you move left, and your ability to invalidate gets worse. The client cache is fastest and completely unrecallable.',
      nodes: [
        { id: 'client', label: 'Client cache', kind: 'client', x: 0, y: 40, detail: 'Zero latency and no possibility of invalidation. Once a max-age response is sent it is in that browser for the full duration, which is why long client caching requires content-hashed URLs — you stop referring to the old copy rather than recalling it.' },
        { id: 'edge', label: 'CDN edge', kind: 'edge', x: 190, y: 40, detail: 'Answers without any of your infrastructure running. Purgeable, but a purge takes seconds to minutes to reach every location, so staleness is regional and bounded rather than instant.' },
        { id: 'inproc', label: 'In-process cache', kind: 'service', x: 190, y: 190, detail: 'Fastest thing you control, and each instance holds a different version. The right answer for a hot key, and it needs a short TTL or an invalidation broadcast because nothing else can reach it.' },
        { id: 'shared', label: 'Shared cache', kind: 'cache', x: 420, y: 120, detail: 'One version everyone sees, invalidated immediately. Costs a network hop and becomes a dependency whose restart is an outage unless the source can absorb cold load.' },
        { id: 'db', label: 'Database', kind: 'store', x: 640, y: 120, detail: 'The source of truth, and the thing that must survive the cache being absent. Provision it for cold-cache load, not for the steady-state miss rate.' },
        { id: 'coalesce', label: 'Request coalescing', kind: 'service', x: 420, y: 280, detail: 'The first miss fetches; concurrent misses for the same key wait on its result. Turns a thousand simultaneous misses into one query — the fix for a stampede, not for a cold cache with distinct keys.' },
      ],
      edges: [
        { id: 'c1', source: 'client', target: 'edge', label: 'on client miss', kind: 'read' },
        { id: 'c2', source: 'edge', target: 'inproc', label: 'on edge miss', kind: 'read' },
        { id: 'c3', source: 'inproc', target: 'shared', label: 'on local miss', kind: 'read' },
        { id: 'c4', source: 'shared', target: 'coalesce', label: 'on miss', kind: 'read' },
        { id: 'c5', source: 'coalesce', target: 'db', label: 'one query', kind: 'read' },
      ],
      steps: [
        {
          id: 'l1',
          title: 'The fastest cache is the one you cannot control',
          description:
            'A client cache costs nothing and answers instantly, and there is no mechanism to invalidate it. That single property is why immutable, content-hashed URLs exist: you never update a cached asset, you refer to a different one.',
          nodes: ['client', 'edge'],
          edges: ['c1'],
        },
        {
          id: 'l2',
          title: 'The edge answers without your infrastructure running',
          description:
            'A CDN hit means no service, no cache tier and no database is involved. That makes it the most valuable layer for anything cacheable — and purges propagate over seconds, so staleness is bounded rather than instant.',
          nodes: ['edge', 'inproc'],
          edges: ['c2'],
        },
        {
          id: 'l3',
          title: 'In-process handles hot keys that partitioning cannot',
          description:
            'A viral key hashes to one shared-cache node no matter how many nodes exist. Holding the top few hundred keys in each instance\'s memory spreads that load across every instance and removes the network hop entirely.',
          nodes: ['inproc', 'shared'],
          edges: ['c3'],
        },
        {
          id: 'l4',
          title: 'And the miss path is what you must actually size',
          description:
            'Request coalescing collapses concurrent misses on one key into a single query. Beyond that, the database must survive the cache being empty — because a saturated database cannot serve the queries that would warm the cache back up.',
          nodes: ['shared', 'coalesce', 'db'],
          edges: ['c4', 'c5'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Facebook memcache'],
    body: `Facebook published a detailed account of running memcached at very large scale, and two of its mechanisms are worth extracting because both address problems that appear at any scale.

**Leases, for stampedes and stale sets.** When a client misses, the cache issues it a short-lived token along with the miss. Only the lease holder is permitted to write the value back. This solves two problems at once:

- Concurrent misses on the same key do not all query the database; the non-holders wait or serve a slightly stale value.
- More subtly, it prevents a **stale set**: a client that missed, fetched a value, and was then slow cannot overwrite a newer value written by someone else in the interim. Without leases, a slow reader can permanently install an old value into the cache — which is exactly why the "delete, do not update" rule exists, and leases are the more rigorous version of it.

**Regional invalidation over the replication stream.** Rather than having application code invalidate caches in every region, invalidations are derived from the database's replication stream. This means the invalidation and the write cannot disagree — the same reasoning as change data capture for derived data, and for the same reason: **application-level invalidation is only as complete as the code paths someone remembered.** Anything that writes the database without going through that code — a migration, an admin tool, another service — leaves a stale cache entry with no TTL to correct it.

Two transferable lessons:

**A cache is a distributed system, and its coordination problems are the same ones.** Stampedes are contention. Stale sets are lost updates. Leases are locks. The vocabulary from the transactions lesson applies directly, which means you already have the tools to reason about it.

**Deriving invalidation from the write stream rather than from application code is the same move as an outbox.** In both cases the goal is a mechanism that sees every committed change, because a mechanism that sees only the changes your service makes is not an owner.`,
  },

  tradeoffs: {
    intro:
      'Two independent decisions bundled: where the copy lives, and how it becomes correct again. Rows are ordered by how much coordination each requires.',
    rows: [
      {
        option: 'No cache: compute or query every time',
        whenItWins:
          'When the work is cheap — an indexed lookup, a simple query. No second source of truth, no eviction policy, no cold-start cliff.',
        whenItLoses:
          'Expensive aggregates, remote calls, or a read volume the source cannot serve.',
        cost:
          'The full cost of the work on every request, and a fragile dependency exposed to your full read traffic.',
      },
      {
        option: 'Cache-aside with a TTL',
        whenItWins:
          'The default, and right most of the time. Memory follows read demand, staleness is bounded, and it self-corrects with no coordination.',
        whenItLoses:
          'When zero staleness is required, or when a popular key expiring produces a stampede.',
        cost:
          'Staleness up to the TTL, a slow first request after each expiry, and a cold-start load the source must absorb.',
      },
      {
        option: 'Explicit invalidation on write',
        whenItWins:
          'When correctness must be immediate and you can enumerate every key a write affects.',
        whenItLoses:
          'When you cannot enumerate them. A missed key is stale forever, because no TTL will correct it.',
        cost:
          'A complete mapping from writes to affected keys, kept correct as features are added, plus every write path having to know about the cache.',
      },
      {
        option: 'Versioned or content-hashed keys',
        whenItWins:
          'When you want immediate correctness without an invalidation call — a version bump makes old entries unreachable, and it works across clients and CDNs too.',
        whenItLoses:
          'When the version is not available wherever the key is built, or when memory cannot absorb unreferenced old versions.',
        cost:
          'Memory holding dead versions until eviction, and a version that must be readable everywhere a key is constructed.',
      },
      {
        option: 'Write-through',
        whenItWins:
          'Read-after-write consistency for cached keys, with no stale window at all.',
        whenItLoses:
          'When writes are latency-sensitive, or when most written keys are never read — you are spending memory on demand that does not exist.',
        cost:
          'Cache latency added to every write, and memory allocated by write pattern rather than read pattern.',
      },
      {
        option: 'Write-behind',
        whenItWins:
          'Very high write rates on regenerable data: counters, metrics, view tallies.',
        whenItLoses:
          'Anything you cannot afford to lose — acknowledged writes disappear if the cache dies before flushing.',
        cost:
          'A durability gap, and a flush process with its own failure and backpressure behaviour.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We have a 96% hit rate, so the database only sees 4% of our traffic."',
      whyWeak:
        'True in steady state and wrong for capacity planning. The moment the cache restarts, is deployed, or is flushed, the database sees 100% of traffic. Provisioning for the miss rate means a routine cache maintenance operation becomes an outage.',
      strongAnswer:
        '"96% is the steady-state figure; the number I would provision the database against is the cold-cache load, which is the full 20,000 QPS. Either provision for it, or make cold starts impossible — warm the new tier before switching traffic, restart nodes in sequence so hit rate degrades by 1/N, and shed load with a degraded response rather than queueing, so the cache can actually warm."',
    },
    {
      weakAnswer: '"On write we update the cached value so it stays fresh."',
      whyWeak:
        'Writing the new value into the cache races. Two concurrent writers can populate in the wrong order, or a slow reader that fetched an old value can install it after a newer write — leaving the cache holding stale data permanently, with no TTL to correct it.',
      strongAnswer:
        '"Delete the key rather than updating it, so the next read repopulates from the source and is current by definition. If I need to prevent a slow reader installing a stale value, that is what a lease does — only the holder of the lease issued with the miss may write the value back."',
    },
    {
      weakAnswer: '"We invalidate the cache in the service that handles the write, so it is always correct."',
      whyWeak:
        'That is a claim about one code path. A migration, an admin tool, a bulk job or a second service writing the same table leaves a stale entry with no expiry to fix it — the same failure as application-level ownership of derived data, and the consequence is permanent rather than bounded.',
      strongAnswer:
        '"Application-level invalidation is only as complete as the code paths someone remembered. I would either derive invalidation from the database\'s change stream so it sees every committed write, or use TTLs and versioned keys so a missed invalidation is bounded rather than permanent."',
    },
    {
      weakAnswer: '"One key is taking 30% of our traffic, so we will add more cache nodes."',
      whyWeak:
        'Partitioning distributes distinct keys, not requests for one key. Every lookup of that key hashes to the same node no matter how many nodes exist, so adding capacity changes nothing for the hot key.',
      strongAnswer:
        '"Sharding does not help a single hot key. I would hold the top few hundred keys in an in-process cache in each application instance — that spreads the load across every instance and removes the network hop. Key splitting across N replicas is the alternative, and it multiplies invalidation work."',
    },
    {
      weakAnswer: '"We added a cache in front of the user lookup to reduce database load."',
      whyWeak:
        'If the lookup is an indexed primary-key read taking under a millisecond, the cache buys nothing measurable and costs a second source of truth, an eviction policy, an invalidation story and a new failure mode. Caching is for expensive work, not as a general accelerant.',
      strongAnswer:
        '"I would check what the lookup actually costs first. A sub-millisecond indexed read does not need a cache — the win is not measurable and the complexity is real. Caching earns its place in front of expensive work: a slow aggregate, a remote call, or a dependency I need to protect from my own read volume."',
    },
    {
      weakAnswer: '"Our hit rate dropped from 95% to 60% and nothing changed in the code."',
      whyWeak:
        'Something changed in the *access pattern*, and the usual culprit is a batch job or a crawler doing a large scan. Under LRU, reading a million rows once evicts the entire working set to cache data nobody will request again — so the cache is now full of useless entries.',
      strongAnswer:
        '"A hit-rate collapse with no code change usually means a scan polluted the cache — a batch job, a crawler, an export. LRU is not scan-resistant. I would give that workload its own cache or bypass the cache for it entirely, and consider an admission policy that only caches items likely to be requested again."',
    },
  ],

  flashcards: [
    {
      id: 'fc-cache-1',
      front: 'Which two questions decide a caching design, and what does each determine?',
      back: 'Where the copy lives (determines your failure mode and whether you can invalidate it) and when it becomes wrong (determines your correctness).',
      topic: 'caching',
    },
    {
      id: 'fc-cache-2',
      front: 'Which number should size the layer behind a cache?',
      back: 'The cold-cache load, not the steady-state miss rate. At a 96% hit rate the source sees 4% normally and 100% the moment the cache is empty.',
      topic: 'hit-rate',
    },
    {
      id: 'fc-cache-3',
      front: 'Why does a saturated database prevent its own cache from warming?',
      back: 'Requests time out before they can populate the cache, so the hit rate stays at zero and the load stays at maximum. The system does not gradually recover — it needs load shedding to break the cycle.',
      topic: 'stampede',
    },
    {
      id: 'fc-cache-4',
      front: 'Why can a client-side cache not be invalidated?',
      back: 'Once a response with a max-age is sent, it is in that browser for the duration and no deployment reaches it. The workaround is content-hashed URLs: stop referring to the old copy rather than recalling it.',
      topic: 'invalidation',
    },
    {
      id: 'fc-cache-5',
      front: 'What is the defining problem with in-process caches?',
      back: 'Each instance holds its own version, so a user hitting different instances sees different data. They need short TTLs or an invalidation broadcast, because nothing else can reach them.',
      topic: 'consistency',
    },
    {
      id: 'fc-cache-6',
      front: 'Why prefer deleting a cache key over updating it on write?',
      back: 'Updating races: concurrent writers can populate in the wrong order, or a slow reader can install an old value after a newer write. Deleting means the next read repopulates from the source and is current by definition.',
      topic: 'invalidation',
    },
    {
      id: 'fc-cache-7',
      front: 'What makes a TTL easier to live with than explicit invalidation?',
      back: 'It self-corrects. A TTL is wrong for a bounded time and then refreshes; a missed explicit invalidation is stale forever.',
      topic: 'invalidation',
    },
    {
      id: 'fc-cache-8',
      front: 'What do versioned keys buy over invalidation calls?',
      back: 'A version bump makes old entries unreachable with no coordination, and it works across every layer including clients and CDNs. The cost is memory holding dead versions until eviction.',
      topic: 'invalidation',
    },
    {
      id: 'fc-cache-9',
      front: 'What is a cache stampede, and what are the three fixes?',
      back: 'Many concurrent requests for the same key missing at once, usually at expiry. Fixes: request coalescing, stale-while-revalidate, and jittered TTLs so keys written together do not expire together.',
      topic: 'stampede',
    },
    {
      id: 'fc-cache-10',
      front: 'Why does partitioning not fix a hot key?',
      back: 'Partitioning distributes distinct keys. Every request for one key hashes to the same node regardless of node count. The fix is an in-process cache in each application instance, or key splitting.',
      topic: 'caching',
    },
    {
      id: 'fc-cache-11',
      front: 'Why is LRU not scan-resistant, and what does that cause?',
      back: 'A batch job reading a million rows once becomes the most recently used data, evicting the entire working set for entries nobody will request again — a hit-rate collapse with no code change.',
      topic: 'hit-rate',
    },
    {
      id: 'fc-cache-12',
      front: 'Why is application-level cache invalidation incomplete?',
      back: 'It only covers the code paths someone remembered. Migrations, admin tools, bulk jobs and other services write the source without invalidating, leaving permanently stale entries.',
      topic: 'invalidation',
    },
    {
      id: 'fc-cache-13',
      front: 'When should you not add a cache?',
      back: 'When the underlying work is cheap, when the staleness budget is zero, or when reads are uniformly distributed over a large key space so there is no working set to exploit.',
      topic: 'caching',
    },
  ],

  quiz: [
    {
      id: 'q-cache-1',
      kind: 'scenario',
      prompt:
        'A service at 15,000 reads/second has a 97% hit rate. The database handles 900 QPS comfortably. A cache node is replaced during maintenance and the service goes down. Why, and what is the fix?',
      options: [
        { id: 'a', label: 'The database saw the full 15,000 QPS with an empty cache; provision for cold load or warm the new node before it takes traffic' },
        { id: 'b', label: 'The cache client needed a longer timeout' },
        { id: 'c', label: 'The database needed a read replica' },
        { id: 'd', label: 'The hit rate calculation was wrong' },
      ],
      correct: ['a'],
      explanation:
        'A cache tier at 0% hit rate passes everything through. The database was provisioned for the miss rate, which is the wrong number — the real requirement is the load when the cache is absent. Warming before cutover, sequential node replacement, and load shedding are the standard mitigations.',
      difficulty: 'core',
      topic: 'hit-rate',
    },
    {
      id: 'q-cache-2',
      kind: 'scenario',
      prompt:
        'A cached product price is occasionally stale for hours despite explicit invalidation on every write in the product service. What is the most likely cause?',
      options: [
        { id: 'a', label: 'Another writer — a bulk import, admin tool or second service — updates the product without invalidating' },
        { id: 'b', label: 'The cache TTL is too long' },
        { id: 'c', label: 'The invalidation call is failing silently and needs retries' },
        { id: 'd', label: 'The cache is evicting the key too slowly' },
      ],
      correct: ['a'],
      explanation:
        'Hours of staleness with explicit invalidation means the invalidation never happened for that write. Application-level invalidation covers only the paths that call it, so migrations, admin tools and other services leave permanently stale entries. A failing invalidation call is plausible and would show in logs; a missing writer would not. Deriving invalidation from the change stream fixes the class.',
      difficulty: 'core',
      topic: 'invalidation',
    },
    {
      id: 'q-cache-3',
      kind: 'single',
      prompt: 'Why is deleting a cache key on write preferable to writing the new value into it?',
      options: [
        { id: 'a', label: 'Updating races — a slow reader or an out-of-order writer can install an older value permanently' },
        { id: 'b', label: 'Deleting is faster than writing' },
        { id: 'c', label: 'Deleting frees memory sooner' },
        { id: 'd', label: 'Cache clients cannot write structured values reliably' },
      ],
      correct: ['a'],
      explanation:
        'The hazard is ordering. A reader that missed, fetched an old value, and was then delayed can write it back after a newer update — and with no TTL nothing corrects it. Deleting means the next read repopulates from the source, so the cache cannot hold a value older than the last write. Leases are the rigorous version of the same protection.',
      difficulty: 'intro',
      topic: 'invalidation',
    },
    {
      id: 'q-cache-4',
      kind: 'scenario',
      prompt:
        'Hit rate falls from 94% to 55% every night at 02:00 and recovers by 04:00. Traffic is flat. What is happening?',
      options: [
        { id: 'a', label: 'A nightly batch job scans a large dataset, and under LRU that evicts the working set for data nobody will request again' },
        { id: 'b', label: 'The cache is being restarted nightly' },
        { id: 'c', label: 'TTLs are expiring in a synchronised burst' },
        { id: 'd', label: 'Network latency to the cache increases overnight' },
      ],
      correct: ['a'],
      explanation:
        'This is cache pollution from a scan, and LRU is not scan-resistant: the scanned rows are the most recently used, so they displace the working set. The fix is to bypass or isolate the cache for that job, or to use an admission policy that only caches items likely to be re-requested. A restart would drop the rate to zero, not to 55%.',
      difficulty: 'advanced',
      topic: 'hit-rate',
    },
    {
      id: 'q-cache-5',
      kind: 'scenario',
      prompt:
        'A popular key expires and the database receives 4,000 identical queries in one second. Which fix addresses this specific problem, and which would not help?',
      options: [
        { id: 'a', label: 'Request coalescing helps; adding cache nodes would not, since all requests target one key' },
        { id: 'b', label: 'Adding cache nodes helps; coalescing would not' },
        { id: 'c', label: 'A longer TTL is the only fix' },
        { id: 'd', label: 'Both coalescing and more nodes help equally' },
      ],
      correct: ['a'],
      explanation:
        'This is a stampede: concurrent misses on one key. Coalescing makes the first miss fetch and the rest wait on its result, collapsing 4,000 queries into one. Partitioning distributes distinct keys and cannot help when they are all the same key. Stale-while-revalidate and jittered TTLs are the other two standard fixes.',
      difficulty: 'core',
      topic: 'stampede',
    },
    {
      id: 'q-cache-6',
      kind: 'multi',
      prompt:
        'Which of these are legitimate reasons *not* to add a cache? Select all that apply.',
      options: [
        { id: 'a', label: 'The underlying operation is a sub-millisecond indexed lookup' },
        { id: 'b', label: 'The staleness budget for this data is zero' },
        { id: 'c', label: 'Reads are uniformly distributed across a very large key space' },
        { id: 'd', label: 'The team has not used a cache before' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Cheap work means no measurable gain against real added complexity. Zero staleness tolerance means the cache cannot be used safely unless the data is immutable. Uniform distribution over a large key space means there is no working set, so the hit rate will be poor regardless of size. Team unfamiliarity is a training question, not a design argument.',
      difficulty: 'core',
      topic: 'caching',
    },
  ],

  exercises: [
    {
      id: 'ex-cache-1',
      kind: 'design',
      title: 'Place, invalidate and size four caches',
      estimatedMinutes: 25,
      prompt: `An e-commerce site has these read paths:

1. **Product detail page** — name, description, images, price, stock badge. 8,000 req/s. Prices change a few times a day; stock changes continuously.
2. **Category listing** — 40 products per page with names and prices. 3,000 req/s. Changes when any product in the category changes.
3. **User's cart** — per user, changes on every add. 400 req/s.
4. **Search results** — query-dependent, long tail of distinct queries. 1,200 req/s.

Facts: the database handles 2,000 QPS comfortably; a single product page can go viral and reach 2,000 req/s alone; a nightly catalogue import updates 40% of products.

For each path produce: where the cache lives, the invalidation strategy, the staleness budget as a number, and the expected hit rate with reasoning. Then answer: what is your total cold-cache load, and how do you survive it?`,
      rubric: [
        'Product page: splits the response — cacheable body at the edge, stock badge fetched separately or given a very short TTL.',
        'Category listing: recognises that any member product changing invalidates it, and prefers a short TTL or versioned key over enumerating dependencies.',
        'Cart: identifies it as per-user with near-zero staleness tolerance and low volume, so caching buys little; if cached, it is per-user with write-through or invalidate-on-write.',
        'Search: identifies the long tail as producing a poor hit rate, and considers caching only popular queries.',
        'Addresses the viral single product with an in-process cache, noting that partitioning does not help a hot key.',
        'Computes cold-cache load across all paths and compares it against the 2,000 QPS database capacity.',
        'Names concrete cold-start survival measures: staged warming, sequential node restarts, coalescing, load shedding.',
        'Addresses the nightly import as a mass-invalidation event that would produce a synchronised stampede.',
      ],
      modelAnswer: `**1. Product detail page — 8,000 req/s**

The key move is to notice this response contains data with **two different staleness budgets**, and caching it as one object forces the shorter one on everything.

- Name, description, images, price → budget **60 seconds**. Prices change a few times a day, and 60 seconds of staleness on a price is commercially acceptable if the cart re-prices authoritatively at checkout.
- Stock badge → budget **5 seconds**, or better, not cached at all. It changes continuously and users notice.

*Design:* cache the product body **at the CDN edge** with a 60-second TTL, and load the stock badge with a separate small request served from the shared cache with a 5-second TTL. That way 8,000 req/s of product body is answered by the edge without any of my infrastructure running.

*Invalidation:* versioned keys — \`product:991:v7\`. A price change bumps the version, so the new URL misses immediately and old entries age out. This works at the edge and in clients, where an invalidation call cannot reach.

*Expected hit rate:* very high, 98%+. A catalogue has a strong popularity skew and the TTL is short relative to change frequency.

**2. Category listing — 3,000 req/s**

*Where:* CDN edge, same reasoning.

*Invalidation:* **short TTL, 30 seconds** — deliberately not explicit invalidation. The listing depends on 40 products, so a change to any one of them invalidates it, and maintaining that dependency map correctly across every write path is exactly the enumeration problem that leaves entries permanently stale. A 30-second TTL is bounded and self-correcting, and nobody notices a category page 30 seconds behind.

*Staleness budget:* 30 seconds.

*Expected hit rate:* high, 95%+, because there are few categories and many requests per category — the best possible cache shape.

**3. User's cart — 400 req/s**

*Where:* nowhere, initially. 400 req/s of indexed per-user lookups is unremarkable for the database, and the staleness tolerance is effectively zero — a user who adds an item and does not see it assumes it failed.

*If I did cache it:* shared cache, keyed per user, **invalidate on write** (delete, not update). Explicit invalidation is viable here precisely because the dependency map is trivial: one user's write affects one key. This is the one path where explicit invalidation is clearly correct.

*Staleness budget:* zero.

*Expected hit rate:* poor. Each user reads their own cart a handful of times per session, so there is little reuse — which is the second reason not to bother.

**4. Search results — 1,200 req/s**

*Where:* shared cache, keyed by the normalised query.

*Invalidation:* **TTL of 5 minutes.** Search results depend on the whole catalogue, so explicit invalidation is impossible in practice.

*Expected hit rate:* **poor to moderate, and this is the point.** A long tail of distinct queries means most requests are unique, so most miss. I would cache only queries seen more than once in a window — an admission policy — so memory holds the head of the distribution rather than a million singletons. Realistically 40-60%, and I would measure rather than assume.

**The viral product — 2,000 req/s on one key**

Sharding the cache does nothing: every request for that key hashes to one node. The fix is an **in-process cache** in each application instance holding the top few hundred products, with a 10-second TTL. That spreads 2,000 req/s across every instance and removes the network hop entirely. It also means each instance may hold a slightly different version for up to 10 seconds, which is acceptable at this budget.

In practice the edge cache absorbs most of this anyway — which is the real argument for pushing cacheable content as far out as possible.

**Cold-cache load**

If every cache tier is empty simultaneously:

| Path | Requests/s | Reaches database |
| --- | --- | --- |
| Product page | 8,000 | 8,000 |
| Stock badge | 8,000 | 8,000 |
| Category listing | 3,000 | 3,000 (each fanning out to 40 products) |
| Cart | 400 | 400 |
| Search | 1,200 | 1,200 |
| **Total** | | **~20,600 QPS, plus category fan-out** |

Against a database capacity of **2,000 QPS**. That is roughly **10× over**, and the category fan-out makes it worse.

**How I survive it:**

1. **Never flush everything at once.** Restart cache nodes sequentially so hit rate degrades by 1/N rather than to zero. This is the single most important operational rule and it costs nothing.
2. **Warm before cutover.** Bring a replacement tier up, populate it from the previous tier's key set or from a known-popular list, and switch traffic once warm.
3. **Request coalescing on every miss path.** With a strong popularity skew, concurrent misses collapse dramatically — this converts much of the cold load into a much smaller number of distinct queries.
4. **Load shedding with a degraded response.** Above a threshold, return the page without the stock badge, or serve a stale value if any exists, rather than queueing. This is what lets the cache warm: a saturated database cannot serve the queries that would repopulate it.
5. **Fix the category fan-out.** A category listing that issues 40 product queries on a miss is 3,000 × 40 = 120,000 queries. It should be a single query returning 40 rows, or a pre-rendered listing object.

**The nightly import**

Updating 40% of products bumps 40% of the versions at once, which invalidates a large share of the cache in one moment — a self-inflicted cold start during a window when nobody is watching.

*Fixes:* batch the import with pauses so versions bump gradually; **jitter the effective TTLs** so entries written together do not expire together; and re-warm the most popular products immediately after the import rather than waiting for organic traffic. The general principle is that any mass write is also a mass invalidation, and it needs the same care as a cache restart.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-cache-1',
      level: 'basic',
      question: 'Where would you put a cache, and why does the choice matter?',
      guidance:
        'Client, edge, in-process, shared, each with different latency and different invalidation capability. A strong answer connects placement to failure mode: a client cache cannot be recalled, an in-process cache diverges per instance, a shared cache is a dependency whose restart is an outage.',
    },
    {
      id: 'iq-cache-2',
      level: 'basic',
      question: 'What are cache-aside, write-through and write-behind?',
      guidance:
        'Lazy population on miss, write to both together, write to cache and flush later. A strong answer says why cache-aside is usually right — memory follows read demand — and that write-behind can lose acknowledged writes.',
    },
    {
      id: 'iq-cache-3',
      level: 'intermediate',
      question: 'How do you invalidate a cache?',
      guidance:
        'TTL, explicit invalidation, or versioned keys. Look for the reasoning that a TTL self-corrects while a missed explicit invalidation is permanent, and for "delete, do not update" with the race explained.',
    },
    {
      id: 'iq-cache-4',
      level: 'intermediate',
      question: 'Your hit rate is 95%. How do you size the database behind it?',
      guidance:
        'For the cold-cache load, not the miss rate. Strong answers explain that a cache restart means 100% miss, and that a saturated database cannot serve the queries that would warm the cache — so it does not self-recover.',
    },
    {
      id: 'iq-cache-5',
      level: 'advanced',
      question: 'One key takes 30% of your traffic. What breaks and what fixes it?',
      guidance:
        'Partitioning does not help because every request for one key hashes to one node. The fix is an in-process cache in each instance, or key splitting with multiplied invalidation. Excellent answers also add coalescing for the moment that key expires.',
    },
    {
      id: 'iq-cache-6',
      level: 'advanced',
      question: 'A price change is occasionally not reflected for hours. Diagnose it.',
      guidance:
        'A write path that does not invalidate — a migration, admin tool, or another service. Look for the recognition that application-level invalidation covers only remembered paths, and that the fix is deriving invalidation from the change stream or falling back to TTLs so staleness is bounded.',
    },
    {
      id: 'iq-cache-7',
      level: 'followup',
      question: 'You said use a TTL. How do you choose the number?',
      guidance:
        'From the product\'s staleness tolerance for that specific data, not from a default. A strong answer notes that a response often contains fields with different budgets, and that caching them as one object forces the shortest budget onto everything — so splitting the response is often the real fix.',
    },
    {
      id: 'iq-cache-8',
      level: 'followup',
      question: 'When is adding a cache the wrong answer?',
      guidance:
        'Cheap underlying work, zero staleness tolerance, or uniformly distributed reads with no working set. A candidate who cannot name a case against caching will add them reflexively, and each one is a second source of truth with a cold-start cliff.',
    },
  ],

  activeLearning: [
    {
      id: 'al-cache-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson assumed cached data is small and cheap to store. Now change one thing: the cached values are large — 2 MB rendered HTML pages — and the cache holds 50,000 of them. What changes about placement, eviction, invalidation and the cold-start problem?',
      discussion: `Size changes the economics of every decision, and two of them invert.

**Placement inverts towards the edge.** 50,000 × 2 MB is 100 GB, which is a substantial shared-cache cluster and completely impractical in-process — a per-instance cache holding even a hundred of these is 200 MB per instance. Meanwhile a CDN is *designed* for large objects and has orders of magnitude more storage than you would provision for a Redis tier. So the answer moves outward: cache large objects at the edge, and keep the shared cache for small metadata.

**Eviction stops being about count and starts being about bytes.** LRU by entry count is meaningless when entries differ by orders of magnitude — evicting one 2 MB page and one 200-byte metadata entry are not comparable decisions. The policy must be size-aware: cost per byte, so a large item must be substantially more popular to justify its footprint. This is exactly what CDN eviction policies do and what a naive application cache does not.

**Network becomes the constraint rather than latency.** Serving 8,000 req/s of 2 MB objects is 16 GB/s, which is a bandwidth problem before it is a cache problem. This is the point where the interesting question stops being "is it cached" and becomes "should we be transferring this much" — which usually means the page should be split into a cacheable shell plus small dynamic fragments.

**Invalidation gets more expensive per event.** Purging a 2 MB object from a CDN and having it re-fetched costs real bandwidth. Versioned keys become clearly preferable to purges: the old version is simply never requested again and ages out, with no purge propagation and no re-fetch storm.

**And the cold-start problem changes character entirely.** A cold cache with small values means many queries. A cold cache with 2 MB values means many queries *and* 100 GB of regeneration and transfer. Warming is now a bandwidth and rendering-capacity exercise measured in minutes, not a burst you can absorb — so pre-warming stops being an optimisation and becomes mandatory, and "restart nodes sequentially" is no longer sufficient because even 1/N of 100 GB is a lot.

**The design conclusion that falls out.** At this object size, the answer is usually to stop caching whole rendered pages. Split into a cacheable shell with content-hashed asset URLs, and small dynamic fragments fetched separately — which is the same move as splitting the product page in the exercise, arrived at by a different route. Then the large parts are immutable and cache forever at the edge, and the small parts have short TTLs and modest bandwidth.

**Transferable:** every caching rule in this lesson has an implicit assumption that values are small. When they are not, the constraint moves from latency to bandwidth and from entry count to bytes, and the correct response is usually to change what is cached rather than how.`,
    },
    {
      id: 'al-cache-2',
      kind: 'debug',
      prompt:
        'Users report intermittently seeing another user\'s data — the wrong name in the header, occasionally someone else\'s order list. It happens perhaps once in 50,000 requests. There is a CDN, a reverse proxy, an in-process cache and a shared cache. Where do you look, and in what order?',
      discussion: `Cross-user data leakage through a cache is the most serious caching bug there is, and it always comes from the same root cause: **a cache key that does not include everything the response varies on.**

That reframing narrows it immediately. Somewhere, a personalised response is being stored under a key that does not identify the user.

**Where to look, in order of both likelihood and severity:**

**1. The CDN or reverse proxy caching a personalised response.** This is first because it is the most likely and by far the worst — one cached response can be served to thousands of users. Specific causes:

- A response containing personalised content sent without \`Cache-Control: private\` or \`no-store\`. The CDN cached it under the URL, and the URL is the same for every user.
- A \`Vary\` header that omits the header carrying identity. If authentication is a cookie and the response does not \`Vary: Cookie\`, every user shares one cache entry.
- An endpoint that is *usually* anonymous but sometimes personalised — a homepage that shows a name when logged in. The anonymous version is correctly cacheable; the personalised one must not be, and the same URL serves both.

**2. The in-process cache keyed without the user.** A per-request context cached under a key like \`user_profile\` rather than \`user_profile:{id}\`, or a cache populated during one request and read during another because it is module-scoped rather than request-scoped. This produces exactly the reported rate: it depends on request interleaving on one instance, so it is rare and non-reproducible.

**3. The shared cache with a key collision or a missing tenant prefix.** Less likely to be intermittent — a systematic key collision would be consistent — but worth checking if keys are constructed from user-supplied values without escaping, so one user's identifier can produce another's key.

**4. Something that is not a cache at all.** Connection-pooled state, a thread-local not cleared between requests, a framework-level context object reused across requests. Worth holding as a hypothesis because the symptom is identical and no cache is involved — and if all four cache layers are clean, this is where the answer is.

**How I would confirm it:**

- **Ask whether the affected responses are cacheable at all.** Inspect the actual response headers on the personalised endpoints. This is a five-minute check and it resolves hypothesis 1 outright.
- **Check whether the leak is one-to-many or one-to-one.** If many users see the *same* wrong data, it is a shared cache layer (CDN or proxy). If each affected user sees a *different* wrong user's data, it is per-instance state — in-process cache or request-context contamination. **This is the decisive question** and it should be asked before anything else, because it splits the problem in half.
- **Correlate against instance.** If affected requests cluster on particular application instances, it is in-process.

**What I would do immediately, before diagnosing.** Set \`Cache-Control: private, no-store\` on every authenticated endpoint and purge the shared caches. This is a data-protection incident, and reducing the blast radius comes before understanding it. The diagnosis can proceed with the leak stopped.

**Transferable:** a cache key must include every dimension the response varies on — user, tenant, locale, permissions, device, feature flags. Cross-user leakage is never a subtle bug in cache internals; it is always a missing key component or a missing \`Vary\`. And the "one-to-many or one-to-one" question is the fastest way to locate which layer, because it distinguishes shared state from per-instance state in a single observation.`,
    },
  ],

  revision: {
    bullets: [
      'A cache is a copy of an answer. Everything difficult about caching follows from the word "copy".',
      'Placement decides your failure mode; invalidation decides your correctness.',
      'The number that sizes the layer behind a cache is the cold-cache load, not the steady-state miss rate.',
      'A saturated source cannot serve the queries that would warm its cache, so the system does not self-recover — it needs load shedding.',
      'Client caches cannot be invalidated. Use content-hashed URLs: stop referring to the old copy.',
      'In-process caches diverge per instance, so they need short TTLs or an invalidation broadcast.',
      'Cache-aside is the default because memory follows read demand. Write-behind can lose acknowledged writes.',
      'A TTL self-corrects; a missed explicit invalidation is stale forever.',
      'Explicit invalidation requires enumerating every key a write affects, and that map rots as features are added.',
      'Versioned keys give immediate correctness with no coordination, and work at the edge and in clients.',
      'Delete keys, do not update them — updating races and can install an old value permanently.',
      'Application-level invalidation covers only remembered code paths; deriving it from the change stream sees every write.',
      'A stampede is many misses on one key: fix with coalescing, stale-while-revalidate and jittered TTLs.',
      'A hot key is not fixed by partitioning — every request hashes to the same node. Use an in-process cache.',
      'LRU is not scan-resistant: a batch job can collapse your hit rate with no code change.',
      'Do not cache cheap work, zero-staleness data, or uniformly distributed reads with no working set.',
      'A cache key must include every dimension the response varies on, or you leak data between users.',
      'Any mass write is also a mass invalidation, and needs the same care as a cache restart.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Keeping a copy of an expensive answer somewhere cheaper to reach, with a policy for when the copy becomes invalid and what happens when it is missing.',
    whyItExists:
      'Some work is too expensive to repeat per request, and read volume frequently exceeds what the source can serve. A cache trades correctness guarantees for cost.',
    whenToUse: [
      'Expensive work: slow aggregates, remote calls, rendering, computation.',
      'Protecting a fragile or rate-limited dependency from your full read volume.',
      'Cacheable content at the edge, where a hit means none of your infrastructure runs.',
    ],
    whenNotToUse: [
      'Cheap work such as a sub-millisecond indexed lookup.',
      'Data with a zero staleness budget, unless it is immutable.',
      'Uniformly distributed reads over a large key space, where there is no working set.',
      'Any personalised response at a shared cache layer without a complete cache key.',
    ],
    alternatives: [
      'An index or a better query, which removes the cost rather than hiding it.',
      'A materialised view or derived table, which is transactionally maintained rather than expiring.',
      'A read replica, which adds read capacity without a second source of truth.',
      'Splitting a response into an immutable cacheable part and a small dynamic part.',
    ],
    tradeoffs: [
      'Moving the copy closer buys latency and costs the ability to invalidate.',
      'A TTL buys self-correction and costs bounded staleness.',
      'Explicit invalidation buys immediacy and costs a complete write-to-key mapping that rots.',
      'Versioned keys buy coordination-free correctness and cost memory holding dead versions.',
      'An in-process cache buys hot-key relief and costs per-instance divergence.',
    ],
    failureModes: [
      'Cold-cache load exceeding source capacity, with no self-recovery.',
      'A stampede when a popular key expires.',
      'A hot key saturating one cache node regardless of partitioning.',
      'A stale set: a slow reader installing an old value permanently.',
      'A missed invalidation from a write path that does not call it.',
      'A scan polluting the cache under LRU and collapsing hit rate.',
      'Cross-user leakage from a cache key missing a dimension the response varies on.',
      'A mass write bumping most versions at once, producing a self-inflicted cold start.',
    ],
    followUpQuestions: [
      'Is the work behind this cache actually expensive?',
      'What is the staleness budget for this data, as a number?',
      'What is your cold-cache load, and can the source survive it?',
      'Who invalidates, and can they name every affected key?',
      'What happens when one key takes 30% of your traffic?',
      'Does your cache key include every dimension the response varies on?',
    ],
  },
});
