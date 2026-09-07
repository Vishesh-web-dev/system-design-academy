import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-partitioning',
  title: 'Partitioning and sharding',
  summary:
    'Choosing a partition key is choosing your future hot spots and your cross-shard queries — it is the least reversible decision in a data architecture, and it is usually made in an afternoon.',
  phase: 'distributed',
  module: 'data-at-scale',
  position: 24,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 55,
  tags: ['partitioning', 'sharding', 'partition-keys', 'hot-spots', 'rebalancing'],
  prerequisites: ['f-replication-basics'],
  resources: [
    {
      key: 'dynamodb-partition-key-design',
      tier: 'must',
      note: 'The most direct treatment anywhere of how a key choice creates hot partitions. Read it even if you never use DynamoDB — the physics apply to every partitioned store.',
    },
    {
      key: 'postgres-partitioning',
      tier: 'must',
      note: 'Partitioning inside a single database, which is a different problem from sharding across machines. Read the sections on partition pruning and on the constraints partitioning places on unique keys.',
    },
    {
      key: 'vitess-sharding',
      tier: 'must',
      note: 'How a real system shards MySQL while preserving much of the relational interface. Read it for how cross-shard queries and resharding are actually handled rather than wished away.',
    },
    {
      key: 'discord-trillions-messages',
      tier: 'good',
      note: 'A concrete partition-key redesign under load, with the reasoning for the bucketing scheme. One of the clearest published accounts of choosing a key.',
    },
    {
      key: 'dynamodb-best-practices',
      tier: 'good',
      note: 'Read the sections on write sharding and on adjacency lists — both are techniques for making one key serve access patterns it otherwise could not.',
    },
    {
      key: 'aws-dynamodb-paper-usenix',
      tier: 'advanced',
      note: 'Read the sections on adaptive capacity and on splitting partitions by throughput rather than size. It is the answer to "what if the hot spot is unavoidable".',
    },
  ],

  intuition: {
    body: `Replication makes copies of the same data. **Partitioning splits different data across machines.** They solve different problems and are almost always used together: partition to exceed one machine's capacity, replicate each partition for availability.

The reason to partition is that one machine has limits — storage, write throughput, memory for the working set, and eventually the time to run a backup or rebuild an index. Reads can often be scaled with replicas alone. **Writes cannot**, because every replica must apply every write. So the pressure that forces partitioning is usually write volume or data size, not read volume, and recognising which pressure you actually have is the first useful thing to establish.

Now the part that matters. Partitioning requires a rule for deciding which machine holds which row, and that rule is the **partition key**. Every consequence of partitioning flows from it:

**Queries that include the key are cheap.** The router knows exactly which partition to ask. One machine answers.

**Queries that do not include the key must ask every partition.** This is a *scatter-gather*: fan out to all N partitions, wait for all N, merge. Its latency is the slowest partition's, its cost is N times a single query, and its availability is the product of all N partitions' availability. A scatter-gather across 20 partitions where each is 99.9% available is 98% available.

**Transactions across partitions are a different and much harder problem.** A single-partition transaction is an ordinary database transaction. A cross-partition transaction needs two-phase commit or a saga, both of which are substantially worse than what you had.

**Unequal key distribution means unequal load.** If 30% of your traffic concerns one key, one partition takes 30% of the traffic, and no amount of adding partitions fixes it.

So the partition key determines which queries are fast, which are expensive, which transactions are possible, and where your hot spots will be. And it is **the hardest thing to change later**, because changing it means moving every row.

The framing to carry: **you are not choosing where data lives. You are choosing which access patterns will be cheap for the rest of the system's life.** Enumerate the access patterns first, then choose the key that serves the ones that matter — and be explicit about which ones you are making expensive.`,
    analogyLimit:
      '"Splitting a big table across machines" is accurate and omits everything difficult. It suggests the split is a storage detail, when it is a query-cost decision: it silently reclassifies some queries as cheap and others as scatter-gathers whose availability is the product of every partition\'s. It also hides that the choice is nearly irreversible, and that an uneven key distribution produces a hot partition that adding machines cannot relieve.',
  },

  deepExplanation: {
    predict: {
      question:
        'A multi-tenant SaaS analytics product shards its events table by `tenant_id`. It has 5,000 tenants across 16 shards. Six months in, two problems appear: one shard is at 90% CPU while others are at 20%, and the "usage across all tenants this month" internal report has become unusably slow. Explain both, and say what you would do about each.',
      answer: `**Problem 1: the hot shard is your largest tenant, and this is structural.**

Tenant sizes in a SaaS product follow a power law. The largest tenant is routinely 100× the median and can be 30% of all traffic on its own. Hashing \`tenant_id\` distributes tenants evenly across shards — **it does not distribute traffic evenly, because tenants are not equal.** All of your biggest tenant's data is on one shard by construction, since that is precisely what the key guarantees.

The critical property: **adding shards does not help.** Go from 16 to 32 and the big tenant's data still lives entirely on one shard. Every row for that tenant hashes to the same place. This is the defining characteristic of a hot spot caused by key choice rather than by capacity — more capacity is not the remedy.

The fixes, in the order I would consider them:

1. **Split the key for large tenants.** Use \`tenant_id\` for most tenants and \`(tenant_id, bucket)\` for large ones, where bucket is derived from the event's timestamp or a hash of the event id. The big tenant's data now spreads across several shards. **The cost:** any query for that tenant must now hit all its buckets — a scatter-gather within the tenant. You have converted a hot-spot problem into a query-cost problem, which is usually the right trade but is a trade.

2. **Give the largest tenants dedicated shards.** Explicit mapping: tenant 4471 lives on shard 17, alone. Simple, effective, and it means your shard map is no longer a pure function — it is data you must maintain, which is a real operational cost but a small one.

3. **Rely on the store's adaptive splitting, if it has it.** Some managed stores split a partition by observed throughput rather than size, isolating a hot key automatically. Worth knowing exists; not something to design around if you are running the store yourself.

What I would actually do: **dedicated shards for the top handful of tenants**, because it is the least invasive and the top tenants are few, individually known, and commercially important enough to justify special handling. Bucketing is the answer when hot keys are numerous or unpredictable.

**Problem 2: the cross-tenant report is a scatter-gather, and it will only get worse.**

"Usage across all tenants" has no \`tenant_id\` predicate, so it must query all 16 shards, wait for the slowest — which is now the 90%-CPU shard — and merge. Three things are wrong simultaneously:

- Its latency is the slowest shard's latency, and one shard is saturated.
- Its cost is 16 queries, and it competes with production traffic on every shard.
- Its availability is the product of 16 shards' availability. At 99.9% each that is 98.4%.

**The fix is not a better query. It is a second data path.** An analytical query with no partition key is not a query the operational store should serve — the partition key was chosen for the operational access pattern, and this is a different access pattern that wants a different physical layout.

Concretely: stream events to a columnar analytical store, or maintain a pre-aggregated rollup table (per tenant, per day) that the report reads. A per-tenant-per-day rollup is small, and the report becomes a single-partition scan of a table designed for it.

**The general lesson, and the reason both problems appeared together.** Both are the same mistake seen from two sides: the key was chosen for one access pattern and is now being asked to serve two that it cannot. \`tenant_id\` is correct for tenant-scoped operational queries and wrong for both a skewed largest tenant and cross-tenant analytics. **The remedy is never a cleverer key — it is accepting that different access patterns need different physical arrangements**, and building the second one deliberately rather than making the first one worse.`,
    },
  body: `## Partitioning strategies

**Range partitioning.** Rows are assigned by key ranges: A–F on shard 1, G–M on shard 2. Range queries are efficient because adjacent keys are adjacent physically. Ranges can be split as they grow.

The problem is that **any monotonically increasing key sends all writes to one partition.** Partition by timestamp and today's writes all go to the last partition, which becomes the hot shard while the others are idle. Partition by auto-incrementing id and the same thing happens. This is a very common and very expensive mistake, because the symptom appears only under load.

**Hash partitioning.** Hash the key and assign by hash value. Distribution is even by construction and monotonic keys are no longer a problem — hashing destroys ordering, which is exactly what you wanted.

And that is also the cost: **range queries become scatter-gathers.** "All events between March 1 and March 7" must ask every partition, because hashing scattered adjacent timestamps everywhere.

**Composite: hash then range.** Hash the first component, range within it. \`(tenant_id, timestamp)\` hashes \`tenant_id\` to place the tenant and orders by timestamp within the tenant. This is the shape of most well-designed keys: **hash for distribution, range for locality within a distribution unit**, and it gives you efficient per-tenant time-range queries with even tenant distribution.

**Directory-based.** A lookup service maps keys to partitions explicitly. Maximum flexibility — you can move any key anywhere, give a large tenant its own shard, or rebalance one key at a time. The cost is a lookup on the read path, and that lookup service becomes a critical dependency, so it must be cached and highly available.

## Choosing the key: enumerate the access patterns first

The method, and it is worth following literally:

**1. List every access pattern with its frequency and latency requirement.** Not the schema — the *queries*. "Fetch a user's last 50 messages, 10,000/second, under 50 ms." "Count messages per channel per day, 100/hour, under 10 seconds."

**2. Find a key that appears in the highest-volume, most latency-sensitive patterns.** Those must be single-partition. Everything else can be expensive.

**3. Check the distribution of that key against real data.** Not the number of distinct values — the *distribution of traffic across* them. A key with a million distinct values where one accounts for 30% of traffic is a hot spot regardless of cardinality.

**4. List what you have just made expensive.** Every access pattern not including the key is now a scatter-gather. Write them down. If any of them is high-volume and latency-sensitive, you have the wrong key or you need a second data path.

**5. Check what transactions you need.** Anything requiring atomicity across two keys that hash differently now needs two-phase commit or a saga.

Step 4 is the one that gets skipped, and it is where the regret comes from. The key you chose is usually fine for what you had in mind; the problem is always the pattern nobody wrote down.

## Hot spots: the failure that adding capacity cannot fix

Four causes, with different remedies:

**A monotonic key.** All writes to the newest partition. Remedy: hash the key, or prefix it with something that distributes — a hash of a secondary attribute, or a small random salt.

**A skewed entity.** One celebrity, one huge tenant, one popular product. Remedy: bucket that key (\`(key, bucket)\`) so it spans partitions, at the cost of scatter-gather within the key; or give it a dedicated partition.

**A skewed access pattern.** The key distribution is fine but reads concentrate on a few keys — a viral post. Remedy: this is a *caching* problem, not a partitioning one. A cache in front absorbs read hot spots that partitioning cannot.

**Low cardinality.** Partitioning by \`country\` or \`status\` gives you as many partitions as distinct values, with sizes matching real-world distribution. Remedy: choose a higher-cardinality key; low-cardinality attributes are for secondary indexes, not partition keys.

The general test: **if adding partitions would not relieve the load, it is a key problem, not a capacity problem.** Almost all hot-spot remediation fails because that test was not applied first.

## Cross-partition queries, honestly

Three patterns for a query without the partition key:

**Scatter-gather.** Ask everyone, merge. Acceptable for low-volume queries. Its cost is N× and its availability is the product of N availabilities, and both of those get worse as you add partitions — so a scatter-gather query gets *less* viable as you scale, which is precisely backwards from what you want.

**A global secondary index.** A separate partitioned structure mapping the secondary attribute to primary keys. Reads become two lookups instead of a fan-out. The cost is that the index must be maintained: synchronously, making every write a cross-partition write; or asynchronously, making the index eventually consistent. Most systems choose asynchronous, and **the eventual consistency of a global index is a frequent source of surprise** — you write a row and immediately query the index and do not find it.

**A second data path.** Stream to an analytical store or maintain a rollup. This is the right answer whenever the query pattern is analytical rather than operational, and it stops trying to make one physical layout serve two incompatible access patterns.

For pagination, keyset pagination across partitions is genuinely awkward: you cannot offset globally without ordering globally. The practical approaches are to paginate within a partition (accepting per-partition pages) or to use a cursor encoding a position per partition.

## Rebalancing: the operation that decides whether you can grow

When you add capacity, data must move. How much moves is a property of your scheme.

**\`hash(key) % N\`** — remaps almost every key when N changes. Adding one node to a 10-node cluster moves roughly 90% of the data. This is why naive modulo hashing makes resharding an outage, and it is the subject of the next lesson.

**Consistent hashing** — moves roughly \`1/N\` of the data when a node is added. The next lesson covers this properly.

**Fixed partition count, greater than node count.** Create, say, 1,024 logical partitions at the start and assign them to nodes. Adding a node moves whole partitions, not individual keys — no rehashing, and rebalancing is a bookkeeping change plus a data copy. This is the pragmatic choice several real systems make, and it means **choosing the partition count is a decision you must get roughly right up front**, because changing it is the expensive operation you were avoiding.

**Dynamic splitting.** Partitions split when they exceed a size or throughput threshold. No up-front count to choose, and it needs a coordinator to manage split state.

Whichever scheme, three operational requirements:

**Moves must be online.** Copy while serving, then cut over. Downtime for rebalancing is unacceptable at any real scale.
**Moves must be throttled.** A rebalance saturating the network degrades production traffic, and it is a common cause of self-inflicted incidents.
**Routing must handle in-flight moves.** During a move a key exists in two places. Either the router knows, or reads go to the old location until cutover.

## Where partitioning is the wrong answer

**When you have not exhausted one machine.** Modern hardware handles far more than most people assume — a well-indexed database on a large instance serves tens of thousands of writes per second and holds terabytes. Partitioning multiplies operational complexity, so the first question is always whether vertical scaling, better indexes or a cache would do.

**When the pressure is read volume.** Replicas scale reads without partitioning's costs. Partition when writes or data size are the constraint.

**When you cannot identify a good key.** If every access pattern uses a different attribute, partitioning makes most of them worse. That is a signal to reconsider the data model, or to use a store that partitions differently.

**As a fix for a hot spot.** If load concentrates on a few keys, more partitions do not spread it. That is caching, bucketing, or a dedicated partition.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'key-consequences',
      title: 'What the partition key decides',
      caption:
        'Step through it. The same key that makes one query a single-partition lookup makes another a scatter-gather whose availability is the product of every partition\'s — that is one decision, not two.',
      nodes: [
        { id: 'router', label: 'Router', kind: 'service', x: 0, y: 180, detail: 'Applies the partition rule to each query. If the query carries the partition key it knows exactly where to go; if not, it must ask everyone.' },
        { id: 'q1', label: 'WHERE tenant_id = 42', kind: 'note', x: 0, y: 40, detail: 'Carries the partition key. One partition answers. Cheap, fast, and available if that one partition is available.' },
        { id: 'q2', label: 'WHERE created_at > ...', kind: 'note', x: 0, y: 320, detail: 'No partition key. Must fan out to every partition. Cost is N queries; latency is the slowest partition; availability is the product of all N.' },
        { id: 'p1', label: 'Partition 1', kind: 'store', x: 260, y: 80, detail: 'Holds tenants that hash here. Includes the largest tenant entirely, because every row for a tenant hashes to the same place.' },
        { id: 'p2', label: 'Partition 2', kind: 'store', x: 260, y: 180, detail: '20% CPU. Adding partitions redistributes tenants but never splits one tenant, so this stays idle while partition 1 saturates.' },
        { id: 'p3', label: 'Partition N', kind: 'store', x: 260, y: 280, detail: 'The slowest responder sets scatter-gather latency. As N grows, the chance that at least one partition is slow approaches certainty.' },
        { id: 'gsi', label: 'Global index', kind: 'store', x: 500, y: 320, detail: 'Maps a secondary attribute to primary keys, turning a fan-out into two lookups. Maintained asynchronously, so it is eventually consistent — write then immediately query and the row may be missing.' },
        { id: 'rollup', label: 'Rollup / analytical store', kind: 'store', x: 500, y: 100, detail: 'A second data path with its own physical layout for analytical patterns. The right answer when a query has no partition key by nature rather than by oversight.' },
      ],
      edges: [
        { id: 'k1', source: 'q1', target: 'router', kind: 'sync' },
        { id: 'k2', source: 'q2', target: 'router', kind: 'sync' },
        { id: 'k3', source: 'router', target: 'p1', kind: 'read' },
        { id: 'k4', source: 'router', target: 'p2', kind: 'read' },
        { id: 'k5', source: 'router', target: 'p3', kind: 'read' },
        { id: 'k6', source: 'p1', target: 'rollup', kind: 'async' },
        { id: 'k7', source: 'p1', target: 'gsi', kind: 'async' },
      ],
      steps: [
        {
          id: 'w1',
          title: 'With the key, one partition answers',
          description:
            'The router applies the rule and asks exactly one partition. This is the access pattern you chose the key for, and it should be your highest-volume, most latency-sensitive one.',
          nodes: ['q1', 'router', 'p1'],
          edges: ['k1', 'k3'],
        },
        {
          id: 'w2',
          title: 'Without it, everyone answers',
          description:
            'Fan out, wait for the slowest, merge. Cost is N× a single query, and availability is the product of N availabilities — 20 partitions at 99.9% each gives 98%.',
          nodes: ['q2', 'p1', 'p2', 'p3'],
          edges: ['k2', 'k3', 'k4', 'k5'],
        },
        {
          id: 'w3',
          title: 'And scatter-gather gets worse as you grow',
          description:
            'Every partition added makes the fan-out more expensive and less available. A query with no partition key becomes less viable at scale, which is exactly backwards from what scaling is for.',
          nodes: ['p3'],
          edges: ['k5'],
        },
        {
          id: 'w4',
          title: 'A global index converts fan-out into two lookups',
          description:
            'At the price of maintenance: synchronous means every write becomes cross-partition; asynchronous means the index is eventually consistent, and writing then immediately querying it is a common surprise.',
          nodes: ['gsi'],
          edges: ['k7'],
        },
        {
          id: 'w5',
          title: 'Analytical patterns need their own layout',
          description:
            'A query with no natural partition key is not a query the operational store should serve. A rollup or columnar store is a second data path, deliberately built, rather than a cleverer key.',
          nodes: ['rollup'],
          edges: ['k6'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'hotspot-causes',
      title: 'Four hot spots, four different remedies',
      caption:
        'Read the remedy column. Only one of these four is fixed by adding capacity, and the diagnostic question is whether more partitions would relieve the load.',
      code: `flowchart LR
    A["Monotonic key<br/>(timestamp, auto-id)"] --> A1["All writes hit the newest partition"] --> A2["Hash the key,<br/>or prefix to distribute"]
    B["Skewed entity<br/>(huge tenant, celebrity)"] --> B1["One key is 30% of traffic;<br/>more partitions do not help"] --> B2["Bucket the key, or give it<br/>a dedicated partition"]
    C["Skewed reads<br/>(viral post)"] --> C1["Key distribution is fine;<br/>reads concentrate"] --> C2["This is a caching problem,<br/>not a partitioning one"]
    D["Low cardinality<br/>(country, status)"] --> D1["As many partitions as<br/>distinct values, sized by<br/>real-world distribution"] --> D2["Pick a higher-cardinality key;<br/>these belong in indexes"]

    style A2 fill:#17272a,stroke:#35897e
    style B2 fill:#17272a,stroke:#35897e
    style C2 fill:#1c1814,stroke:#c99a4e
    style D2 fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['discord'],
    body: `Discord's message storage is the clearest published account of choosing a partition key, because the reasoning is explicit and the constraints are ones every system faces.

**The access patterns, in priority order.** Fetch recent messages in a channel — overwhelmingly the most common, and the one users notice. Jump to a point in a channel's history. Search, much rarer.

**The key: \`(channel_id, bucket)\`** where the bucket is a coarse time window derived from the message id.

Three properties, and each answers a specific pressure:

**\`channel_id\` first, hashed, gives even distribution across channels and puts one channel's data together.** The dominant access pattern — recent messages in a channel — becomes a single-partition read.

**The time bucket prevents unbounded partition growth.** Without it, a channel with a hundred million messages would be one enormous partition. Bucketing splits each channel's history into manageable pieces, and — importantly — **recent messages are in the newest bucket**, so the common query reads one bucket rather than scanning history.

**Within a bucket, messages are ordered by id, which is time-ordered.** So "the last 50 messages" is a bounded scan from one end, and "jump to this point" is a seek.

**What this deliberately makes expensive.** Search across channels has no \`channel_id\`, so it cannot use this key at all — and Discord runs a separate search system rather than making the primary store serve it. That is the "second data path" conclusion, chosen deliberately rather than discovered painfully.

**The hot spot they still have, and it is instructive.** A very large, very active channel is a hot partition. The bucket helps — activity spreads across buckets over time — but *right now*, all writes to that channel go to its current bucket. The remedy is finer buckets for high-volume channels, which is exactly the "bucket the key" technique, with its cost: reading recent history now touches several buckets.

**The transferable method.** They listed the access patterns, ranked them, chose a key serving the top one as a single-partition read, added a second component to bound partition size, and **built separate infrastructure for the pattern the key could not serve.** That sequence is the method, and the fourth step is the one most teams skip.

**Where it does not transfer.** This works because one access pattern dominates so heavily. A system with three equally important patterns on three different attributes has no key that serves all three, and the honest answer there is multiple data paths from the start rather than a cleverer key.`,
  },

  tradeoffs: {
    intro:
      'Two bundled decisions: the partitioning strategy, and how you serve the queries the key does not. Rows cover both.',
    rows: [
      {
        option: 'Range partitioning',
        whenItWins:
          'Range queries dominate, and the key is not monotonic. Adjacent keys are physically adjacent, and partitions can split as they grow.',
        whenItLoses:
          'Any monotonically increasing key — timestamps, auto-increment ids — sends all writes to the newest partition while the rest idle.',
        cost:
          'Hot spots from monotonic or skewed keys, and ongoing attention to range boundaries.',
      },
      {
        option: 'Hash partitioning',
        whenItWins:
          'Point lookups by key dominate and you want even distribution by construction. Monotonic keys stop being a problem.',
        whenItLoses:
          'Range queries, which become scatter-gathers because hashing destroys ordering.',
        cost:
          'No efficient range scans; ordering must come from somewhere else.',
      },
      {
        option: 'Composite: hash then range',
        whenItWins:
          'The shape of most good keys. Hash the entity for distribution, range within it for locality — efficient per-entity time ranges with even entity distribution.',
        whenItLoses:
          'When the first component is skewed, since all of one entity still lands on one partition.',
        cost:
          'Requires knowing the dominant entity up front, and skew in that entity is unfixable by adding capacity.',
      },
      {
        option: 'Directory-based mapping',
        whenItWins:
          'When you need per-key control: a dedicated shard for a huge tenant, incremental rebalancing, moving one key at a time.',
        whenItLoses:
          'When the lookup latency or the extra dependency is unacceptable.',
        cost:
          'A lookup service that must be cached and highly available, plus mapping state to maintain.',
      },
      {
        option: 'Scatter-gather for non-key queries',
        whenItWins:
          'Low-volume queries where N× cost is affordable and reduced availability is tolerable.',
        whenItLoses:
          'High-volume or latency-sensitive queries — and it gets worse as you add partitions, since both cost and failure probability grow with N.',
        cost:
          'N× query cost, latency of the slowest partition, availability as the product of all partitions.',
      },
      {
        option: 'Global secondary index',
        whenItWins:
          'A frequent query on a non-partition attribute where two lookups beat a fan-out.',
        whenItLoses:
          'When the write cost or the index\'s eventual consistency is unacceptable.',
        cost:
          'Synchronous maintenance makes every write cross-partition; asynchronous means writing then immediately querying may not find the row.',
      },
      {
        option: 'A second data path (rollup or analytical store)',
        whenItWins:
          'Analytical queries with no natural partition key. Each store gets a layout suited to its access pattern.',
        whenItLoses:
          'When the pipeline\'s complexity or its staleness is unacceptable.',
        cost:
          'A pipeline to operate, storage duplication, and a lag between the operational and analytical views.',
      },
      {
        option: 'Fixed logical partition count above node count',
        whenItWins:
          'Rebalancing moves whole partitions rather than rehashing keys, so adding nodes is bookkeeping plus a copy.',
        whenItLoses:
          'When the initial count turns out badly wrong — changing it is the expensive operation you were avoiding.',
        cost:
          'Choosing the count up front with imperfect information.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We shard by user id, which distributes evenly."',
      whyWeak:
        'It distributes *users* evenly, not *load*. User activity follows a power law, so a few users generate a disproportionate share of traffic and all of any one user\'s data is on one partition by construction. It also says nothing about the queries that do not carry a user id.',
      strongAnswer:
        '"User id distributes users evenly, and I would check the traffic distribution across users rather than the cardinality — a key with a million values where one is 30% of traffic is still a hot spot. And I would write down which access patterns no longer have the key, because those are now scatter-gathers. If any of them is high-volume, either the key is wrong or I need a second data path."',
    },
    {
      weakAnswer: '"We partition by created_at so queries by date range are efficient."',
      whyWeak:
        'A monotonically increasing partition key sends every write to the newest partition. Today\'s writes all go to one place while every other partition idles — so you have all the operational complexity of partitioning and one machine\'s write throughput.',
      strongAnswer:
        '"Timestamps are the classic monotonic-key mistake: all writes concentrate on the newest partition. If date ranges genuinely dominate I would use a composite key — hash an entity id for distribution, range by time within it — so I get time locality per entity with even distribution. If I truly need global date ranges, that is an analytical access pattern and belongs in a second store."',
    },
    {
      weakAnswer: '"If a partition gets hot we add more partitions."',
      whyWeak:
        'It confuses a capacity problem with a key problem. If the load is caused by one key or a monotonic key, adding partitions does not move that key — every row for it still hashes to the same place. You have added machines and changed nothing.',
      strongAnswer:
        '"The test is whether adding partitions would relieve the load. If the hot spot is one skewed key, it would not — every row for that key hashes to the same place. Then the remedies are bucketing the key so it spans partitions, or a dedicated partition for it. And if the key distribution is fine and reads concentrate, that is a caching problem rather than a partitioning one."',
    },
    {
      weakAnswer: '"Cross-shard queries just fan out to all shards and merge the results."',
      whyWeak:
        'Correct mechanically and it omits the costs. The latency is the slowest shard\'s, the cost is N queries competing with production traffic, and the availability is the product of every shard\'s availability — which means the query gets less reliable each time you add a shard.',
      strongAnswer:
        '"Scatter-gather works and has three costs worth stating: latency of the slowest shard, N× resource cost, and availability as the product of all N — 20 shards at 99.9% is 98%. Crucially it degrades as you scale, which is backwards. So I would use it only for genuinely low-volume queries, and for anything frequent I would build a global index or a second data path."',
    },
    {
      weakAnswer: '"We\'ll shard when we need to — it is just a configuration change."',
      whyWeak:
        'Choosing a partition key is the least reversible decision in a data architecture. Changing it means moving every row, and by the time you need to shard you have application code, reports and integrations assuming the current arrangement.',
      strongAnswer:
        '"Sharding is not a configuration change — the key choice is nearly irreversible because changing it means rewriting every row and every assumption built on the old layout. I would not shard prematurely, since a well-indexed database on modern hardware goes much further than people assume. But I would choose the key deliberately when the time comes, by enumerating access patterns and their volumes first, and I would write down what I am making expensive."',
      },
    {
      weakAnswer: '"We added a global secondary index so those queries are fast now."',
      whyWeak:
        'It omits what the index costs. Maintained synchronously, every write becomes a cross-partition write. Maintained asynchronously — which is the usual choice — the index is eventually consistent, so writing a row and immediately querying the index may not find it.',
      strongAnswer:
        '"A global index turns a fan-out into two lookups, and the cost is maintenance. Asynchronous is normally right, and it means the index is eventually consistent — so I would make sure no read-after-write path depends on it, and I would surface the lag as a metric. If a caller genuinely needs read-your-writes on that attribute, it has to read the primary partition or wait."',
    },
  ],

  flashcards: [
    {
      id: 'fc-part-1',
      front: 'What is the difference between replication and partitioning?',
      back: 'Replication makes copies of the same data; partitioning splits different data across machines. Used together: partition for capacity, replicate each partition for availability.',
      topic: 'partitioning',
    },
    {
      id: 'fc-part-2',
      front: 'Which pressure forces partitioning, and which does not?',
      back: 'Write volume and data size force it, because every replica must apply every write. Read volume usually does not — replicas scale reads without partitioning\'s costs.',
      topic: 'sharding',
    },
    {
      id: 'fc-part-3',
      front: 'What are you actually choosing when you choose a partition key?',
      back: 'Which access patterns will be cheap for the system\'s life. Queries with the key hit one partition; queries without it are scatter-gathers.',
      topic: 'partition-keys',
    },
    {
      id: 'fc-part-4',
      front: 'What is the availability of a scatter-gather across 20 partitions at 99.9% each?',
      back: 'About 98%. Availability is the product, so a fan-out query becomes less reliable every time you add a partition.',
      topic: 'sharding',
    },
    {
      id: 'fc-part-5',
      front: 'Why is a monotonically increasing partition key a mistake?',
      back: 'Every write goes to the newest partition while the rest idle — so you get all of partitioning\'s complexity and one machine\'s write throughput.',
      topic: 'hot-spots',
    },
    {
      id: 'fc-part-6',
      front: 'What does hash partitioning cost you?',
      back: 'Range queries. Hashing destroys ordering, so adjacent keys land on different partitions and any range scan becomes a fan-out.',
      topic: 'partitioning',
    },
    {
      id: 'fc-part-7',
      front: 'What is the shape of most well-designed partition keys?',
      back: 'Hash then range: hash an entity id for even distribution, order by time or sequence within it. Even distribution plus locality inside each unit.',
      topic: 'partition-keys',
    },
    {
      id: 'fc-part-8',
      front: 'The diagnostic test for a hot spot?',
      back: 'Would adding partitions relieve the load? If not, it is a key problem — a monotonic or skewed key — and more capacity changes nothing.',
      topic: 'hot-spots',
    },
    {
      id: 'fc-part-9',
      front: 'Why does hashing tenant_id not distribute load evenly?',
      back: 'It distributes tenants evenly, and tenants are not equal. Tenant sizes follow a power law, and all of one tenant\'s data is on one partition by construction.',
      topic: 'hot-spots',
    },
    {
      id: 'fc-part-10',
      front: 'Two remedies for a skewed key, and their costs?',
      back: 'Bucket it — `(key, bucket)` spans partitions, at the cost of scatter-gather within the key. Or a dedicated partition — simple, but the shard map becomes maintained state.',
      topic: 'hot-spots',
    },
    {
      id: 'fc-part-11',
      front: 'What kind of problem is a viral post that everyone reads?',
      back: 'A caching problem, not a partitioning one. The key distribution is fine; reads concentrate. A cache in front absorbs read hot spots partitioning cannot.',
      topic: 'hot-spots',
    },
    {
      id: 'fc-part-12',
      front: 'What does a global secondary index cost?',
      back: 'Synchronous maintenance makes every write cross-partition. Asynchronous — the usual choice — makes the index eventually consistent, so write-then-query may miss the row.',
      topic: 'partition-keys',
    },
    {
      id: 'fc-part-13',
      front: 'Why does `hash(key) % N` make resharding an outage?',
      back: 'Changing N remaps almost every key. Adding one node to a ten-node cluster moves about 90% of the data.',
      topic: 'rebalancing',
    },
    {
      id: 'fc-part-14',
      front: 'What does a fixed logical partition count above node count buy?',
      back: 'Rebalancing moves whole partitions rather than rehashing keys, so adding a node is bookkeeping plus a copy. The cost is choosing the count up front.',
      topic: 'rebalancing',
    },
  ],

  quiz: [
    {
      id: 'q-part-1',
      kind: 'scenario',
      prompt:
        'A multi-tenant product shards by hashed `tenant_id` across 16 shards. One shard is at 90% CPU, others at 20%. Would going to 32 shards fix it?',
      options: [
        { id: 'a', label: 'No — the largest tenant\'s data all hashes to one shard regardless of shard count; the remedies are bucketing that tenant\'s key or giving it a dedicated shard' },
        { id: 'b', label: 'Yes — doubling shards halves the load per shard' },
        { id: 'c', label: 'Yes, provided the hash function is changed at the same time' },
        { id: 'd', label: 'No — the problem is that hashing destroys locality' },
      ],
      correct: ['a'],
      explanation:
        'Hashing tenant_id guarantees all of one tenant lands together, so no shard count separates a large tenant\'s data. This is the diagnostic test: if adding partitions would not relieve the load, it is a key problem. Bucketing the key or a dedicated shard are the remedies.',
      difficulty: 'core',
      topic: 'hot-spots',
    },
    {
      id: 'q-part-2',
      kind: 'scenario',
      prompt:
        'An events table is partitioned by `created_at` (monthly ranges) for efficient date-range reporting. Write throughput is one twelfth of expected. Why?',
      options: [
        { id: 'a', label: 'The key is monotonic, so all writes go to the current month\'s partition while the other eleven idle' },
        { id: 'b', label: 'Monthly partitions are too coarse and should be daily' },
        { id: 'c', label: 'Range partitioning is always slower for writes than hash partitioning' },
        { id: 'd', label: 'The reporting queries are competing with writes' },
      ],
      correct: ['a'],
      explanation:
        'A monotonic partition key concentrates all writes on the newest partition. Finer partitions make it worse, not better — the current one is still the only write target. Range partitioning is not inherently slow; monotonic keys under range partitioning are. A composite key hashing an entity id with time ranges within it gives both distribution and locality.',
      difficulty: 'core',
      topic: 'hot-spots',
    },
    {
      id: 'q-part-3',
      kind: 'scenario',
      prompt:
        'A query with no partition key fans out to 20 partitions, each 99.9% available. What is the query\'s availability, and what does that imply as you scale?',
      options: [
        { id: 'a', label: 'About 98% — availability is the product, so the query becomes less reliable with every partition added' },
        { id: 'b', label: '99.9% — the router retries any failed partition' },
        { id: 'c', label: 'About 99.995% — redundancy across partitions improves it' },
        { id: 'd', label: 'It depends only on the router\'s availability' },
      ],
      correct: ['a'],
      explanation:
        '0.999^20 ≈ 0.980. A scatter-gather needs every partition, so its availability is the product and it degrades as the fleet grows — exactly backwards from what scaling should do. Retries help with transient failures and not with a partition that is genuinely down. This is why frequent non-key queries need a global index or a second data path.',
      difficulty: 'advanced',
      topic: 'sharding',
    },
    {
      id: 'q-part-4',
      kind: 'scenario',
      prompt:
        'A messaging system needs: (1) recent messages in a channel, very high volume, low latency; (2) search across all channels, rare. What key, and how is (2) served?',
      options: [
        { id: 'a', label: 'Partition by `(channel_id, time_bucket)`; serve search from a separate search system' },
        { id: 'b', label: 'Partition by `message_id` and add a global index on channel_id' },
        { id: 'c', label: 'Partition by `(channel_id, time_bucket)` and serve search by scatter-gather' },
        { id: 'd', label: 'Partition by search terms so search is a single-partition lookup' },
      ],
      correct: ['a'],
      explanation:
        'Channel id hashed gives even distribution and makes the dominant query single-partition; the time bucket bounds partition growth and keeps recent messages together. Search has no channel id by nature, so it needs its own layout — which is a deliberate second data path, not a fan-out on the primary store.',
      difficulty: 'core',
      topic: 'partition-keys',
    },
    {
      id: 'q-part-5',
      kind: 'multi',
      prompt:
        'A row is written and the application immediately queries a global secondary index for it, and does not find it. Which are true? Select all that apply.',
      options: [
        { id: 'a', label: 'Asynchronously maintained global indexes are eventually consistent, so this is expected behaviour' },
        { id: 'b', label: 'Reading the primary partition by partition key would find the row' },
        { id: 'c', label: 'Making the index synchronous would fix it, at the cost of making every write cross-partition' },
        { id: 'd', label: 'This indicates the index is corrupt and needs rebuilding' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'This is the normal consistency model of an asynchronous global index, and it surprises people repeatedly. The primary partition is immediately consistent for its own key. Synchronous maintenance removes the lag and turns every write into a cross-partition write, which is usually the worse trade — so the practical answer is to keep read-after-write paths off the index.',
      difficulty: 'advanced',
      topic: 'partition-keys',
    },
    {
      id: 'q-part-6',
      kind: 'scenario',
      prompt:
        'A cluster uses `hash(key) % N` with 10 nodes. An eleventh node is added. Roughly how much data moves, and what is the consequence?',
      options: [
        { id: 'a', label: 'About 90% — nearly every key remaps, so the move saturates the network and the cluster is effectively unavailable during it' },
        { id: 'b', label: 'About 9% — only the new node\'s share moves' },
        { id: 'c', label: 'About 10% — one node\'s worth of data' },
        { id: 'd', label: 'None — modulo hashing is stable under node addition' },
      ],
      correct: ['a'],
      explanation:
        'Changing N changes `hash(key) % N` for nearly every key, so almost all data must move. This is why naive modulo hashing makes resharding an outage, and why consistent hashing — which moves about 1/N — or a fixed logical partition count above node count are the practical alternatives.',
      difficulty: 'core',
      topic: 'rebalancing',
    },
  ],

  exercises: [
    {
      id: 'ex-part-1',
      kind: 'design',
      title: 'Choose the key, then name what you broke',
      estimatedMinutes: 35,
      prompt: `Design the partitioning for a ride-hailing platform's trips data. Access patterns, with volumes:

1. Fetch a rider's trip history, most recent first — 5,000/s, must be under 100 ms.
2. Fetch a driver's trips for a given day (for earnings) — 500/s, under 200 ms.
3. Fetch one trip by id (support tooling, receipts) — 200/s, under 50 ms.
4. Live trips in a city right now (operations dashboard) — 50/s, under 2 s.
5. Total trips and revenue per city per day (finance) — 20/hour, under 30 s.
6. Update a trip's status as it progresses — 20,000/s, under 50 ms.

Facts: 40 million riders, 3 million drivers, 400 cities. The largest city is 12% of all trips. A trip is written once and updated roughly 8 times.

Specify the partition key, the strategy, and for **each** of the six patterns whether it is single-partition, a fan-out, or served by a different path. Then answer:

- Which pattern did you make worst, and is that acceptable?
- The largest city is 12% of trips. Is that a problem with your key?
- A trip is updated 8 times. Where do those updates go?
- Two years in, riders' histories must be queryable back 5 years, and 80% of reads are for the last 30 days. What changes?`,
      rubric: [
        'Chooses rider_id (hashed) with time ordering within it, justified by pattern 1 being the highest-volume latency-sensitive read.',
        'Recognises that pattern 6 (status updates, 20,000/s) is the highest-volume operation overall and addresses where it lands.',
        'Handles trip-by-id via an id that embeds the partition key, or an explicit lookup index — not a fan-out.',
        'Handles driver queries with a global index or a second write path, with the consistency cost stated.',
        'Routes patterns 4 and 5 to different systems, with reasoning.',
        'Explicitly names which pattern was made worst and defends it.',
        'City skew answer correctly concludes it is not a problem for a rider-keyed scheme, and explains why.',
        'Update answer identifies that updates carry the trip id and must therefore resolve to the rider partition.',
        'Tiering answer proposes time-bucketing or hot/cold separation with a concrete boundary.',
      ],
      modelAnswer: `**First, rank the patterns by pressure, because the key must serve the top of that list.**

| Pattern | Volume | Latency | Verdict |
| --- | --- | --- | --- |
| 6. Status updates | 20,000/s | 50 ms | **Highest volume overall** |
| 1. Rider history | 5,000/s | 100 ms | **Highest-volume read** |
| 2. Driver's day | 500/s | 200 ms | Moderate |
| 3. Trip by id | 200/s | 50 ms | Low volume, tight latency |
| 4. City live | 50/s | 2 s | Low volume, loose latency |
| 5. Finance rollup | 20/hour | 30 s | Negligible volume, very loose |

Patterns 1 and 6 are the ones the key must serve. Patterns 4 and 5 are so low-volume and latency-tolerant that they should not influence the key at all — and noticing that is most of the answer, because the operations dashboard is the pattern people design around and it is worth 0.2% of the traffic.

**The key: hash \`rider_id\`, range by \`trip_id\` (time-ordered) within it.**

\`\`\`
Partition key:  hash(rider_id)
Sort key:       trip_id            (a time-ordered id, so newest last)
\`\`\`

*Why \`rider_id\`:* pattern 1 is the highest-volume read and becomes a single-partition scan from one end of the sort key. 40 million riders is high cardinality, and rider activity — while skewed — is nowhere near tenant-level skew: the busiest rider takes a few hundred trips a month, not 12% of traffic.

*Why the time-ordered sort key:* "most recent first" is a bounded scan from the end, with no sorting at read time and no scanning of old trips.

*Why not \`driver_id\`:* pattern 2 is 10× lower volume than pattern 1 and has looser latency. And 3 million drivers with real skew — a full-time driver does 100× the trips of an occasional one — is a worse distribution than riders.

*Why not \`trip_id\`:* it would make pattern 3 single-partition, but pattern 3 is 200/s and pattern 1 is 5,000/s. Optimising the low-volume pattern and turning the high-volume one into a fan-out is backwards.

*Why not \`city_id\`:* 400 values is low cardinality, and the largest is 12% of trips. That is a guaranteed hot partition, unfixable by adding capacity.

**How each pattern is served**

**1. Rider history — SINGLE PARTITION.** \`hash(rider_id)\` locates it; scan the sort key descending, limit 50. This is the design target. Under 100 ms comfortably.

**2. Driver's trips for a day — GLOBAL SECONDARY INDEX** on \`(driver_id, date)\` → trip keys.

Two lookups: index for the trip keys, then fetch the trips. At 500/s this is affordable.

*The cost, stated:* the index is maintained asynchronously and is therefore eventually consistent. For earnings display, lag of a second or two is fine. **For earnings *payment*, it is not** — I would compute payouts from a batch job over the authoritative data rather than from the index, because an index miss would silently underpay someone.

**3. Trip by id — SINGLE PARTITION, by construction.** I would **embed the rider id in the trip id**: \`trip_id = <time_component>-<rider_id_hash>-<random>\`. Then a trip id alone yields its partition with no lookup.

This is the technique worth naming: **make the id carry its own routing information.** The alternative — a global lookup table from trip id to rider id — is an extra hop and another structure to maintain, for a problem that a naming convention solves. The cost is that trip ids are now longer and structurally meaningful, which means the structure must be versioned if it ever changes.

**4. Live trips in a city — DIFFERENT PATH.** Not the trips store at all.

Live trip state is a small, rapidly-changing working set: the trips currently in progress in a city, perhaps a few thousand. That is a Redis sorted set per city, keyed \`live:{city}\`, scored by start time, updated as trips begin and end. The dashboard reads one key.

*Why not a fan-out on the trips store:* it would touch every partition, at 2-second latency, 50 times a second, competing with 20,000 writes/s. And its availability would be the product of every partition's. For a dashboard, a purpose-built structure is both cheaper and better.

**5. Finance rollups — DIFFERENT PATH.** Trips stream to an analytical store, or a nightly job writes per-city-per-day aggregates.

At 20 queries an hour with a 30-second budget, this could technically be a fan-out — and it should not be, because it would scan the entire dataset across every partition while production traffic is running. A rollup table is small and the query becomes trivial.

**6. Status updates — SINGLE PARTITION, and this is why the id design matters.** An update carries the trip id, and because the trip id embeds the rider id hash, the router resolves it to one partition with no lookup. 20,000/s spread across partitions by rider — the highest-volume operation in the system is a single-partition write.

**Had I not embedded the rider id in the trip id, this would be 20,000 lookups per second against a mapping table**, which would be the busiest component in the architecture. That is the single most consequential decision in this design, and it is a decision about id format rather than about partitioning.

**Which pattern did I make worst, and is that acceptable?**

**Pattern 2, the driver's trips.** It went from a possible single-partition read (had I keyed by driver) to two lookups through an eventually-consistent index.

*Acceptable, with one carve-out.* At 500/s and a 200 ms budget, two lookups are comfortable. The eventual consistency is fine for display and **not fine for payment**, so payouts read authoritative data via a batch job. That carve-out is the honest part of the answer: the index is fit for one use of the data and not another, and saying so is better than pretending the index serves everything.

*The pattern I made worst in relative terms is actually 4 and 5* — both went from "possible with a fan-out" to "requires separate infrastructure". That is a real cost in operational complexity, and it is the right trade because both would otherwise impose load wildly disproportionate to their value.

**Is the 12% city a problem?**

**No, and the reason is worth being precise about.** City is not in the partition key. Trips in the largest city belong to riders distributed across all partitions, so those trips are spread evenly. The 12% concentration exists in the *data* and not in the *partitioning*.

It would be a severe problem if I had keyed by \`city_id\`: one partition with 12% of all trips and all of that city's writes, unfixable by adding partitions.

**Where the city skew does surface:** the live-trips Redis key for that city is 12% of live-trip updates on one Redis key. At scale that is a hot key, and the remedy is the bucketing technique — \`live:{city}:{shard}\` with a small number of shards, with the dashboard reading all shards for that city. Same problem, same fix, different store.

**Where do the 8 updates per trip go?**

To the trip's own partition — the rider's partition — resolved from the embedded rider hash in the trip id. Three consequences:

**Write amplification is 9× per trip** (one insert, eight updates). If the design target is 20,000 updates/s, that is roughly 2,200 trips/s starting. Capacity planning must be based on the amplified number, and this is a routine underestimate.

**Updates and reads for the same rider contend on the same partition.** Fine here, because both are cheap point operations on the same physical rows.

**An update by trip id alone works only because of the id design.** Without the embedded rider hash, every update needs a lookup — 20,000/s of extra load. Worth restating because it is the load-bearing detail.

**One thing I would add:** trip status is the field being updated eight times, and status transitions are the thing the live dashboard cares about. I would write status changes to the Redis live-trip structure as part of the same operation, rather than deriving the dashboard from the trips store. That keeps pattern 4 cheap and is a small, honest denormalisation.

**Two years in: 5-year history, 80% of reads in the last 30 days**

The problem is partition size. Five years of trips per rider makes each rider's partition large, and — more importantly — the *aggregate* dataset is now 5 years of data where 80% of reads touch 30 days of it. Storage is dominated by cold data that makes hot reads slower by sitting in the same structures and inflating indexes.

**What I would change: add a time bucket to the partition key.**

\`\`\`
Partition key:  hash(rider_id) + year_quarter
Sort key:       trip_id
\`\`\`

- The common query — recent trips — reads the current quarter's partition. One partition, small.
- A 5-year history query reads 20 partitions for that rider. Bounded, predictable, and rare.
- Partition sizes stay flat over time rather than growing forever, which is the property that matters most.

**Then tier the storage.** Quarters older than a year move to a cheaper store, since they are read rarely and the latency budget for a 5-year history query can be seconds. The trips store holds roughly a year of hot data at steady size.

**What I would explicitly *not* do: change the partition key's first component.** Rehashing 40 million riders' trips is the expensive, risky operation. Adding a second component to the key is a migration — new writes go to bucketed partitions, a backfill moves old data, the read path queries both during transition — but it does not change *where a rider's data lives*, only how it is subdivided. **That distinction is what makes this migration feasible**, and it is the strongest practical argument for having chosen a composite key shape from the start.

**The cost, stated:** reads for the last 30 days occasionally straddle a quarter boundary and touch two partitions. Trivial. And the application must know the bucketing scheme, which is coupling between application and storage layout — real, and cheaper than the alternative.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-part-1',
      level: 'basic',
      question: 'What is the difference between replication and partitioning?',
      guidance:
        'Copies of the same data versus different data on different machines. A strong answer says they are used together and names which pressure each relieves — reads for replication, writes and size for partitioning.',
    },
    {
      id: 'iq-part-2',
      level: 'basic',
      question: 'How would you choose a partition key?',
      guidance:
        'Enumerate access patterns with volumes, pick a key serving the highest-volume latency-sensitive ones, check the traffic distribution across key values, then list what became expensive. Look for step four.',
    },
    {
      id: 'iq-part-3',
      level: 'intermediate',
      question: 'What is wrong with partitioning by timestamp?',
      guidance:
        'Monotonic keys send all writes to the newest partition. A strong answer proposes a composite key — hash an entity for distribution, range by time within it — and notes that finer time partitions make it worse.',
    },
    {
      id: 'iq-part-4',
      level: 'intermediate',
      question: 'A shard is hot. Walk me through your options.',
      guidance:
        'First the diagnostic: would more partitions help? If not, it is a key problem. Then bucketing, a dedicated partition, or caching if the skew is in reads. Look for the test being applied before the remedy.',
    },
    {
      id: 'iq-part-5',
      level: 'advanced',
      question: 'What is the true cost of a scatter-gather query?',
      guidance:
        'Latency of the slowest partition, N× resource cost, and availability as the product of all N. Excellent answers note it degrades as you scale, which makes it unsuitable for anything that grows with the system.',
    },
    {
      id: 'iq-part-6',
      level: 'advanced',
      question: 'How do you serve a frequent query that does not carry the partition key?',
      guidance:
        'A global secondary index, or a second data path. Excellent answers state the index\'s consistency cost and note that analytical patterns should never be forced onto the operational layout.',
    },
    {
      id: 'iq-part-7',
      level: 'followup',
      question: 'You said you would embed the partition key in the entity id. What does that buy, and what does it cost?',
      guidance:
        'It makes a lookup by id single-partition with no mapping table — critical when updates by id are the highest-volume operation. The cost is longer, structurally meaningful ids that must be versioned if the format changes.',
    },
    {
      id: 'iq-part-8',
      level: 'followup',
      question: 'Two years in, your partitions are too large. What can you change and what can you not?',
      guidance:
        'Adding a bucketing component subdivides partitions without moving a key\'s data between shards, so it is a feasible migration. Changing the first component rehashes everything. A strong answer names that distinction as the reason to prefer composite keys from the start.',
    },
  ],

  activeLearning: [
    {
      id: 'al-part-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed you choose the partition key and the store obeys it. Now change one thing: the store partitions automatically by observed load, splitting hot partitions without you specifying a key. What problems does that solve, and which remain exactly as they were?',
      discussion: `Some managed stores split partitions by observed throughput rather than only by size, so a hot partition is detected and divided automatically. It is worth being precise about what that fixes, because the marketing implies more than it delivers.

**What it genuinely solves.**

**Hot spots from unpredictable skew.** A product goes viral, a key becomes hot, the partition splits, load spreads. You did not have to predict which key would be hot, and that is a real benefit — bucketing requires knowing in advance which keys need it.

**Capacity planning for growth within a key range.** Partitions split as they grow, so you are not choosing a partition count up front and living with it.

**A whole class of 3am work disappears.** No manual resharding, no rebalancing scripts, no throttling a data move.

**What remains exactly as it was — and this is most of the lesson.**

**The single-key hot spot is still unfixable.** If one key is 30% of your traffic, there is nothing to split: all rows for that key share a value, and no partitioning scheme separates identical keys. Automatic splitting divides *ranges*, and a single key is not a range. This is the same wall as before, and the remedy is still bucketing at the application level.

**Cross-partition queries are unchanged.** A query without the partition key is still a fan-out, its availability is still the product, and it still degrades as the store splits into more partitions. Automatic splitting can make this *worse*, because more partitions means a wider fan-out for the same query.

**Transactions across partitions are unchanged.** Still two-phase commit or a saga.

**The key choice is still the decision.** Which queries are single-partition, what transactions are possible, what needs a second data path — all determined by the key, exactly as before. Automatic splitting changes *how a range is divided*, not *what the key is*.

**A new problem appears: splits happen when you are least ready.** A partition splits under load, and the split itself consumes resources during the traffic spike that caused it. Some stores also have a period after a split where capacity is still adjusting. So the automatic remedy arrives late and costs something at the worst moment — meaning you still need headroom, which is what you were hoping to stop planning for.

**And the observability gets harder.** With manual partitioning you know where data is. With automatic splitting the layout is dynamic and opaque, so "why is this query slow" has a new answer you cannot inspect. Debugging a hot partition you did not create and cannot see is genuinely harder.

**What I would do with such a store.** Design the key exactly as this lesson describes — enumerate access patterns, choose for the dominant one, write down what became expensive. Then treat automatic splitting as a safety net for skew I failed to predict, not as a reason to skip the analysis.

**The transferable point.** Automation removes the *operation*, not the *decision*. Automatic splitting saves you from rebalancing by hand, and it does not save you from choosing which access patterns are cheap. That choice is architectural and no store makes it for you — which is why "the database handles sharding" is never an answer to "what is your partition key".`,
    },
    {
      id: 'al-part-2',
      kind: 'debug',
      prompt:
        'A sharded database showed p99 write latency of 40 ms for a year. Over three weeks it rose to 800 ms. Traffic is up 5%. All shards show elevated latency, not one. Disk and CPU are moderate on every shard. Hypotheses?',
      discussion: `The uniformity is the key detail. All shards degrading together, with traffic essentially flat and resources moderate, rules out a hot shard and rules out capacity. Something changed that affects every shard identically.

**Hypothesis 1 — index growth crossing a memory threshold.** As data grows, indexes grow. When an index no longer fits in the buffer pool, every write that updates it becomes a disk read to fetch the page before modifying it. This produces a sharp, non-linear latency rise over weeks with flat traffic, uniformly across shards, with moderate CPU — because the time is spent waiting on I/O.

*Why it fits so well:* the three-week ramp with 5% traffic growth is characteristic of crossing a threshold rather than of load. And "disk moderate" often means throughput is moderate while *latency* per operation is not — the metric that matters is not the one usually graphed.

*Check:* buffer-pool hit rate over the three weeks, and index size against available memory. A hit rate declining from 99.9% to 98% is a 20× increase in disk reads.

**Hypothesis 2 — write amplification from an index nobody accounted for.** If a new index was added a month ago, every write now maintains one more structure. Uniform across shards, insensitive to traffic, and it would appear as a step rather than a ramp — so the ramp shape argues against this unless the index is on a growing column.

*Check:* index inventory and change history. This is cheap to check and cheap to fix.

**Hypothesis 3 — accumulated dead rows or fragmentation.** In an MVCC store, updated and deleted rows leave versions behind until vacuumed. If vacuum is not keeping up, tables bloat, pages hold fewer live rows, and every operation touches more pages. Uniform across shards, gradual, and CPU-moderate.

*Check:* table bloat and the age of the oldest un-vacuumed transaction. A vacuum falling behind is a well-known slow-onset failure and one of the most common causes of exactly this symptom shape.

**Hypothesis 4 — a growing partition making range operations slower.** If partitions grow without bound — no time bucketing — then B-tree depth increases and range scans within a partition take longer. Gradual, uniform, and it worsens with data volume rather than traffic.

*Check:* average partition size over time and index depth. This is the hypothesis that points at a design fix rather than an operational one.

**Hypothesis 5 — replication lag creating write pressure.** If writes wait for replica acknowledgement and replicas are falling behind — because *their* apply loop is slower as data grows — write latency rises with no change in the primary's own resource usage. Uniform, gradual, and it would show as time spent waiting rather than working.

*Check:* replica apply lag over the same three weeks, and whether writes are synchronous.

**What I would check first: the buffer-pool hit rate trend.** It is one graph, it covers hypothesis 1 directly, and a declining hit rate over exactly the window in question is close to conclusive. It also partially discriminates hypotheses 3 and 4, since bloat and larger partitions both reduce cache effectiveness.

**Then: bloat and vacuum age**, because a vacuum falling behind produces this signature and is both common and fixable without a design change.

**What the symptom profile rules out, and why that matters.** A hot shard — the failures would concentrate. A traffic-driven problem — traffic is flat. A capacity problem — resources are moderate. **All three are the things people check first**, and all three are eliminated by the uniformity plus the flat traffic. Reading that correctly saves days.

**The structural lesson.** These are all "the dataset outgrew an assumption" failures, and they share a shape: gradual, uniform, resource-moderate, traffic-independent. That shape should trigger a specific question — *what quantity has been growing for three weeks?* — rather than a load investigation.

And the monitoring gap is the real finding. Nobody was alerted because every dashboard tracked traffic and utilisation, and the thing that changed was *the ratio of working-set size to memory*. Partitioned systems need explicit alerts on the quantities that grow silently: index size against memory, partition size, bloat, and replica apply lag. Those are the metrics that predict this class of incident weeks in advance, and they are almost never on the dashboard.`,
    },
  ],

  revision: {
    bullets: [
      'Replication copies the same data; partitioning splits different data. Use both — partition for capacity, replicate each partition.',
      'Writes and data size force partitioning. Read volume usually does not — replicas handle that.',
      'Choosing a partition key is choosing which access patterns are cheap for the system\'s life.',
      'Queries with the key hit one partition. Queries without it are scatter-gathers.',
      'A scatter-gather\'s availability is the product of all partitions\' — 20 at 99.9% gives 98%, and it worsens as you grow.',
      'Monotonic keys — timestamps, auto-increment ids — send every write to the newest partition.',
      'Hash partitioning gives even distribution and destroys range queries.',
      'Most good keys are composite: hash an entity for distribution, range by time within it.',
      'The hot-spot test: would adding partitions relieve the load? If not, it is a key problem.',
      'Hashing tenant_id distributes tenants, not load — tenant sizes follow a power law.',
      'Skewed key remedies: bucket it (costing intra-key fan-out) or give it a dedicated partition.',
      'A read hot spot on a few keys is a caching problem, not a partitioning one.',
      'Low-cardinality attributes — country, status — belong in indexes, never in partition keys.',
      'A global secondary index turns fan-out into two lookups, and asynchronous maintenance makes it eventually consistent.',
      'Analytical queries with no natural partition key need their own data path, not a cleverer key.',
      'Embedding the partition key in the entity id makes lookup-by-id single-partition with no mapping table.',
      '`hash(key) % N` moves ~90% of data when adding a node to ten. Fixed logical partitions or consistent hashing avoid that.',
      'Adding a bucketing component to a key is a feasible migration; changing its first component rehashes everything.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Splitting a dataset across machines by a rule applied to a partition key, so that capacity, write throughput and data size can exceed one machine\'s limits.',
    whyItExists:
      'Replication scales reads and availability but every replica applies every write, so write volume and data size are bounded by one machine until data is split.',
    whenToUse: [
      'When write throughput or data size exceeds what one machine plus indexes and caching can handle.',
      'When one access pattern clearly dominates and can be made single-partition.',
      'When operational limits — backup time, index rebuild time — have become the constraint.',
    ],
    whenNotToUse: [
      'Before exhausting one machine, better indexes, and a cache.',
      'When the pressure is read volume — add replicas.',
      'When no key serves the important access patterns; reconsider the model instead.',
      'As a remedy for a hot key, which more partitions cannot spread.',
    ],
    alternatives: [
      'Read replicas, when reads are the constraint.',
      'Vertical scaling, which goes much further than most people assume.',
      'Caching, for read hot spots and for reducing load without splitting data.',
      'A separate analytical store, for queries with no natural partition key.',
    ],
    tradeoffs: [
      'Hash partitioning buys even distribution and costs range queries.',
      'Range partitioning buys range scans and costs hot spots on monotonic keys.',
      'A global index buys non-key queries and costs either cross-partition writes or eventual consistency.',
      'Bucketing a skewed key buys distribution and costs a fan-out within that key.',
      'A fixed logical partition count buys cheap rebalancing and costs an up-front decision.',
    ],
    failureModes: [
      'A monotonic key concentrating all writes on the newest partition.',
      'A skewed entity making one partition hot, with more partitions changing nothing.',
      'A low-cardinality partition key producing partitions sized by real-world distribution.',
      'A scatter-gather query whose availability degrades with every partition added.',
      'A read-after-write path depending on an eventually-consistent global index.',
      'A cross-partition transaction requiring two-phase commit or a saga.',
      'Rebalancing under `hash(key) % N` moving nearly all data.',
      'An unthrottled rebalance saturating the network and degrading production.',
      'Unbounded partition growth from a key with no time or size component.',
      'Working-set growth quietly crossing a memory threshold, degrading every shard at once.',
    ],
    followUpQuestions: [
      'What are your access patterns, with volumes and latency budgets?',
      'What is the traffic distribution across your partition key\'s values, not its cardinality?',
      'Which access patterns did this key make expensive? Have you written them down?',
      'Would adding partitions relieve your hot spot? If not, why not?',
      'What transactions do you need, and do they span partitions?',
      'How does a lookup by entity id find its partition?',
      'What bounds partition growth over time?',
      'What moves when you add a node, and is that move online and throttled?',
    ],
  },
});
