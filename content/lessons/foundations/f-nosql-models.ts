import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-nosql-models',
  title: 'NoSQL models and access-pattern-first design',
  summary:
    'You do not choose a non-relational store for scale — you choose it for a known access pattern, and you pay by losing the ability to ask questions you did not plan for.',
  phase: 'foundations',
  module: 'databases',
  position: 16,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['nosql', 'access-patterns', 'data-modeling', 'partitioning', 'key-value'],
  prerequisites: ['f-relational-modeling'],
  resources: [
    {
      key: 'dynamodb-best-practices',
      tier: 'must',
      note: 'Access-pattern-first design taken to its conclusion. Read it for the discipline of enumerating every query before designing a key, which is the whole methodological difference.',
    },
    {
      key: 'dynamodb-partition-key-design',
      tier: 'must',
      note: 'Concrete rules for choosing a partition key and the hot-partition symptoms. The reasoning applies to any partitioned store, relational ones included.',
    },
    {
      key: 'mongodb-data-modeling',
      tier: 'must',
      note: 'The embed-versus-reference decision, which is the central modelling question in a document store. Note the size and growth caveats on embedding.',
    },
    {
      key: 'cassandra-architecture',
      tier: 'good',
      note: 'A wide-column store where the partition key and clustering columns literally are the schema. Useful for seeing how far "design for the query" can be taken.',
    },
    {
      key: 'ddia-book',
      tier: 'good',
      note: 'The chapter on data models, for the argument that the document/relational debate is really about how much your data is a tree versus a graph.',
    },
    {
      key: 'postgres-json',
      tier: 'advanced',
      note: 'Relevant because the honest alternative to adopting a document store is often a JSON column in the relational database you already run.',
    },
  ],

  intuition: {
    body: `The usual story is that relational databases do not scale and NoSQL does. That story is wrong in both halves, and believing it produces bad designs.

A single Postgres instance handles tens of thousands of writes per second and terabytes of data. Most systems that "needed NoSQL for scale" were nowhere near either limit. Meanwhile a non-relational store scales beautifully **on the access patterns it was designed for** and falls over on the ones it was not.

So here is the honest framing. The trade is not scale versus features. It is:

**A relational model lets you decide the questions later. A non-relational model requires you to decide them first, and rewards you with predictable cost.**

A relational database is built around hiding access paths. You declare the data, the planner finds a way to answer whatever you ask. A query nobody anticipated is *slow* — and answerable.

A key-value or wide-column store makes the access path explicit. The key **is** the query plan. A lookup by key costs the same at a thousand rows and at a billion, which is genuinely valuable. And a query that does not match a key is not slow — it is a full scan you must ask for, or it is impossible.

That is the whole decision, and it has a corollary worth stating plainly: **if you cannot enumerate your access patterns, you are not ready to choose a non-relational store.** Not because the technology is harder, but because its entire value proposition is answering a fixed set of questions extremely well, and you do not yet know what they are.`,
    analogyLimit:
      'Framing it as "decide the questions now or later" is right about the methodology and understates one asymmetry: a relational database will answer any question you can express, badly if necessary, and that fallback has saved more projects than any performance characteristic. Losing it is the real cost, and it is the one least often priced in the comparison.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team stores a social feed in a key-value store, partitioned by `user_id`, with posts as items under each user. Reads are "show me a user\'s posts" and they are fast. Product now asks for two things: "show me posts from everyone I follow, newest first" and "how many posts mention this hashtag". What happens, and which one is worse?',
      answer: `**"Posts from everyone I follow"** — the partition key is \`user_id\`, so this requires reading from every followed user's partition and merging. Follow 300 people and one feed load is 300 partition reads, merged in the application. It works, its cost scales with the follow count, and its latency is the *slowest* of 300 reads. This is scatter-gather, and it is the pattern the store's design was specifically avoiding.

**"Count posts mentioning a hashtag"** — there is no key for this at all. Hashtags are inside post bodies, scattered across every partition. The only options are a full table scan or a secondary index you must have created in advance, which means a backfill over the entire dataset.

**Which is worse: the hashtag query, decisively.** Not because it is slower — because it is *unanticipated*. The feed query is at least expressible with a known cost you can optimise (pre-compute the feed, fan out on write). The hashtag query requires a structure that does not exist and cannot be added cheaply, and while the new index backfills it returns incomplete answers.

**What the relational equivalent would have been:** the feed query is a join with an index on \`(author_id, created_at)\` — one query, and the planner handles it. The hashtag query is an index on a derived column or a full-text index — added in one statement, built in the background, and immediately correct.

**The lesson:** the cost of a non-relational model is not paid at design time. It is paid the first time someone asks a question the key does not answer — and that moment always arrives, because product requirements are not knowable in advance. Before choosing, ask: *how confident am I that this list of access patterns is complete, and what does it cost me to be wrong?*`,
    },
    body: `## The four families, and what each is actually for

**Key-value.** A dictionary: put and get by key. Everything else is out of scope. Extremely fast, trivially partitionable, and it answers exactly one question. Right for caches, sessions, feature flags, rate-limit counters — anything with one obvious lookup.

**Document.** A key-value store that understands the value's structure, so it can index inside it and update parts of it. Right when your data is naturally a tree that you load and save as a unit: a user profile with nested preferences, a product with variants, a captured third-party payload.

**Wide-column.** A partition key plus clustering columns, giving you sorted rows within a partition. Right for time-series and event data where every query is "recent items for this entity" — the shape it serves is precisely partition-plus-range.

**Graph.** Optimised for traversal: friends-of-friends, shortest path, reachability. Right when the *relationships* are the data and queries are recursive. A relational database can express two joins comfortably and six painfully; a graph store makes depth cheap.

The families are not competitors. They are four different fixed access patterns, and the question is whether one of them matches yours.

## Access-pattern-first design, as a method

The method inverts relational design. Instead of modelling entities and then querying them, you enumerate queries and then design keys that serve them.

1. **List every access pattern.** Not "we need users and orders" but "get an order by id", "list a customer's orders newest first", "list orders in a status for an admin queue". Each one is a query with an input and a sort order.
2. **For each, decide the partition key and the sort key.** The partition key must be supplied with equality; the sort key gives you range and ordering within it.
3. **Where two patterns disagree, duplicate the data.** Store the item twice under two different keys, or create a secondary index. There is no join to reconcile them, so the same fact lives in several places by design.
4. **Accept that step 3 is the cost.** Every duplicate needs an owner, a write path that updates all copies, and a reconciliation job — the exact three requirements from the denormalisation rule, now applying to most of your data rather than a few columns.

The discipline is real and so is the trap: **step 1 is a bet that you know the future.**

## Partition keys decide everything

In any partitioned store — including a sharded relational one — the partition key determines three things simultaneously:

**Which queries are cheap.** Supply the partition key and you touch one node. Omit it and you scatter across all of them.

**Where the hot spots are.** A key with skewed distribution concentrates traffic. Partitioning by \`tenant_id\` when one tenant is 40% of your traffic means one node carries 40% of the load, and adding nodes does not help.

**What can be atomic.** Most non-relational stores offer atomicity within a partition and none across partitions. So the partition boundary is also the transaction boundary, which makes partition-key choice a *correctness* decision rather than only a performance one.

Two standard techniques for skew, both with real costs:

- **Composite keys** — \`tenant_id#bucket\` where bucket is derived from something high-cardinality. Spreads the load and means reading all of a tenant's data now touches every bucket.
- **Write sharding** — append a random suffix to spread writes, and read by querying every suffix. Fixes hot writes and makes every read a scatter-gather.

Both convert a write problem into a read problem, which is only a win if reads are rarer or more tolerant.

## Embed or reference, in a document store

The central modelling question, and it has a clean decision rule.

**Embed when:** the child is always loaded with the parent, the child has no independent identity, and the collection is bounded and small. Order line items inside an order. Address inside a user.

**Reference when:** the child is queried independently, referenced by other documents, or the collection is unbounded. Comments on a post that has ten thousand of them. A product referenced by every order.

Three specific failure modes of over-embedding:

- **Unbounded growth.** A document with an ever-growing array eventually exceeds the store's document size limit, and every read of the parent transfers the whole array whether or not you need it.
- **Contention.** Two concurrent updates to different elements of one array are a read-modify-write on the same document, so one silently loses unless you use an atomic array operator or optimistic locking.
- **Duplication drift.** Embedding a copy of a product name in every order line is correct *if* it is a snapshot of what was ordered. It is a bug if it is meant to track the current product name — and the distinction is the same historical-versus-current question from relational modelling, unchanged.

## The option people skip

Before adopting a new store, the honest comparison includes: **a JSON column in the relational database you already run.**

It gives you schema flexibility for the parts that need it, real columns and constraints for the parts that do not, transactions across both, joins when you need them, and one system to operate. Modern relational databases index inside JSON well enough for most document workloads.

What it does not give you is horizontal write scaling or the operational simplicity of a managed key-value store at extreme scale. Those are real reasons to move — and they are reasons you should be able to state as numbers before you do.

## When a non-relational store is clearly right

- **A cache or session store.** Key-value, obviously. Nobody argues about this.
- **Very high write throughput on a known key** — telemetry, event ingestion, counters. Wide-column stores exist for this and relational ones struggle.
- **Data that is genuinely a tree** loaded and saved as a unit, with no cross-entity queries.
- **Traversal-heavy relationships** several hops deep, where joins become unmanageable.
- **Predictable single-digit-millisecond latency at any scale**, which a managed key-value store gives and a relational database's planner cannot promise.

And when it is clearly wrong: when you cannot list your access patterns, when the same data is queried several different ways, when you need multi-entity transactions, or when the actual motivation is that a relational schema felt like too much upfront work. That last one is common and it trades an afternoon of modelling for a permanent constraint.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'model-decision',
      title: 'Which store, and what you commit to',
      caption:
        'Follow the branches and notice how many paths return to the relational store with a JSON column. The first question is the one most teams skip, and answering it honestly resolves most of these decisions.',
      code: `flowchart TD
    A[New storage need] --> B{Can you enumerate<br/>every access pattern?}
    B -->|No| C["Relational.<br/>You are not ready to fix<br/>the access paths."]
    B -->|Yes| D{Is the same data queried<br/>several different ways?}

    D -->|Yes| E{Would duplicating it<br/>under several keys be<br/>acceptable to maintain?}
    E -->|No| C
    E -->|Yes| F{Need multi-entity<br/>transactions?}
    D -->|No, one shape| F

    F -->|Yes| C
    F -->|No| G{What shape is the data?}

    G -->|One obvious key lookup| H["Key-value<br/>cache, session, flags"]
    G -->|A tree loaded as a unit| I{Is it also unbounded<br/>or independently queried?}
    G -->|Entity + time range| J["Wide-column<br/>telemetry, events"]
    G -->|Relationships several hops| K["Graph"]

    I -->|Yes| L["Reference, not embed —<br/>or a relational table"]
    I -->|No| M["Document store, or a<br/>JSON column in Postgres"]

    style C fill:#17272a,stroke:#35897e
    style M fill:#1c1814,stroke:#c99a4e
    style L fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'partition-consequences',
      title: 'One partition key, three consequences',
      caption:
        'Select each consequence. The third is the one most often discovered late: the partition boundary is also the transaction boundary, which makes key choice a correctness decision rather than a tuning one.',
      nodes: [
        { id: 'key', label: 'Partition key choice', kind: 'service', x: 0, y: 150, detail: 'A single decision, usually made early and effectively permanent — changing it means rewriting every item and every query that depends on it.' },
        { id: 'cheap', label: 'Which queries are cheap', kind: 'note', x: 230, y: 20, detail: 'Supply the key with equality and you touch one node at constant cost. Omit it and you scatter across every node, with latency set by the slowest one.' },
        { id: 'hot', label: 'Where the hot spots are', kind: 'note', x: 230, y: 150, detail: 'A skewed key concentrates traffic. Partition by tenant when one tenant is 40% of traffic and one node carries 40% of the load — adding nodes changes nothing.' },
        { id: 'atomic', label: 'What can be atomic', kind: 'note', x: 230, y: 290, detail: 'Most stores offer atomicity within a partition and none across. The partition boundary is the transaction boundary, so items that must change together must share a key.' },
        { id: 'scatter', label: 'Scatter-gather', kind: 'external', x: 470, y: 20, detail: 'Query every partition and merge. Cost grows with partition count and latency is the slowest response — the failure mode the store exists to avoid.' },
        { id: 'composite', label: 'Composite or sharded key', kind: 'service', x: 470, y: 170, detail: 'tenant#bucket spreads the load, and reading all of a tenant\'s data now touches every bucket. A write problem converted into a read problem.' },
        { id: 'saga', label: 'Saga or compensations', kind: 'service', x: 470, y: 300, detail: 'Cross-partition operations give up atomicity: each step commits locally, each has a compensating action, and every step must be idempotent.' },
        { id: 'dup', label: 'Duplicate under a second key', kind: 'store', x: 700, y: 100, detail: 'The standard fix for a second access pattern: store the item again under a different key. Needs an owner, a write path that updates every copy, and a reconciliation job.' },
      ],
      edges: [
        { id: 'p1', source: 'key', target: 'cheap', kind: 'control' },
        { id: 'p2', source: 'key', target: 'hot', kind: 'control' },
        { id: 'p3', source: 'key', target: 'atomic', kind: 'control' },
        { id: 'p4', source: 'cheap', target: 'scatter', label: 'key absent', kind: 'read' },
        { id: 'p5', source: 'hot', target: 'composite', label: 'if skewed', kind: 'control' },
        { id: 'p6', source: 'atomic', target: 'saga', label: 'if spanning', kind: 'control' },
        { id: 'p7', source: 'scatter', target: 'dup', label: 'or avoid it', kind: 'write' },
      ],
      steps: [
        {
          id: 'k1',
          title: 'The key is the query plan',
          description:
            'Supplying the partition key with equality costs the same at a thousand items and at a billion. That predictability is what you are buying, and it only applies to queries the key serves.',
          nodes: ['key', 'cheap'],
          edges: ['p1'],
        },
        {
          id: 'k2',
          title: 'Omitting the key means scatter-gather, or duplication',
          description:
            'Reading every partition and merging has cost proportional to partition count and latency set by the slowest node. The alternative is storing the item again under a key that serves the second pattern — which is why duplication is a design norm here, not an optimisation.',
          nodes: ['cheap', 'scatter', 'dup'],
          edges: ['p4', 'p7'],
        },
        {
          id: 'k3',
          title: 'Skew is a property of the key, not of the load',
          description:
            'One dominant tenant means one hot node, and horizontal scaling does not relieve it. Composite or write-sharded keys spread the load and make reading a whole tenant touch every bucket — a write problem traded for a read problem.',
          nodes: ['hot', 'composite'],
          edges: ['p2', 'p5'],
        },
        {
          id: 'k4',
          title: 'And the consequence found late: atomicity stops at the partition',
          description:
            'Items that must change together have to share a partition key. If they cannot, the operation becomes a saga with compensations and per-step idempotency — so partition-key choice decides which invariants you can enforce at all.',
          nodes: ['atomic', 'saga'],
          edges: ['p3', 'p6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The most instructive production pattern here is the migration that goes in the *other* direction: teams that adopted a non-relational store early and moved back, or moved to a hybrid.

The trajectory is consistent enough to be worth recognising.

**Phase one.** A new product picks a document store because the schema is still moving and defining tables feels premature. This is a real benefit and it is genuinely delivered — early iteration is faster.

**Phase two.** The product finds its shape. Access patterns stabilise, and they turn out to be more numerous than anticipated: not three queries but fifteen, several of them cutting across entities. Each new one needs either a secondary index or a duplicate copy of the data.

**Phase three.** Reporting arrives. "Revenue by region by month", "customers who did X but not Y", "top ten by any of six dimensions". These are ad-hoc analytical queries, and they are the category that access-pattern-first design cannot serve, because nobody can enumerate them in advance — that is what makes them ad-hoc.

**Phase four.** The team ends up with one of three shapes: a relational read model fed by change events, an analytical warehouse alongside the operational store, or a migration back with the flexible parts kept as JSON columns.

The third outcome is worth dwelling on, because it is the design that would have been correct at phase one: **real columns and constraints for the entities and relationships that are stable, JSON for the parts that genuinely vary, in one relational database.** It gives the early-iteration benefit that motivated the original choice without giving up joins, transactions or the ability to answer an unplanned question.

Two transferable lessons:

**The requirement that breaks access-pattern-first design is always reporting**, and it always arrives. Any system with a business behind it will eventually be asked questions nobody planned, and a store designed around fixed access paths has no answer except a scan or a second system.

**"Our schema is still changing" is an argument for JSON columns, not for a different database.** It is a genuine problem with a much cheaper solution, and conflating the two is how a schema-flexibility need becomes a permanent architectural constraint.`,
  },

  tradeoffs: {
    intro:
      'Ordered by how much you must know up front. The first row is the default and the last two are for specific, identifiable shapes.',
    rows: [
      {
        option: 'Relational with a normalised schema',
        whenItWins:
          'Almost always as a starting point: unplanned queries are answerable, transactions span entities, and constraints enforce invariants.',
        whenItLoses:
          'Write throughput beyond one instance, or a requirement for predictable single-digit-millisecond latency at very large scale.',
        cost:
          'Joins on read, a schema to migrate, and a planner whose choices can change as data grows.',
      },
      {
        option: 'Relational with JSON columns for the variable parts',
        whenItWins:
          'When some data is genuinely unstructured or caller-supplied while the rest is stable. Keeps transactions, joins and constraints for everything that has them.',
        whenItLoses:
          'When almost all data is document-shaped and the relational features go unused, or when horizontal write scaling is the actual need.',
        cost:
          'No constraints or foreign keys inside the JSON, read-modify-write hazards on documents, and expression indexes to maintain.',
      },
      {
        option: 'Key-value store',
        whenItWins:
          'One obvious lookup and nothing else: caches, sessions, flags, counters. Fastest and simplest thing available.',
        whenItLoses:
          'Any second access pattern, any range query, any relationship.',
        cost:
          'Nothing beyond what it does not do — which is everything except get and put.',
      },
      {
        option: 'Document store',
        whenItWins:
          'Data that is a tree loaded and saved as a unit, with bounded nesting and no cross-entity queries.',
        whenItLoses:
          'Unbounded embedded collections, data referenced from several places, and reporting across documents.',
        cost:
          'Duplication with owners and reconciliation, contention on concurrent updates to one document, and no cross-document transactions in most configurations.',
      },
      {
        option: 'Wide-column store',
        whenItWins:
          'Very high write rates on entity-plus-time-range access: telemetry, event streams, message history. The shape it serves is exactly partition-plus-range.',
        whenItLoses:
          'Anything needing a query the clustering key does not serve, and anything needing joins.',
        cost:
          'Every access pattern must be designed as a table, so the same data is written several times, and there is no planner to save you.',
      },
      {
        option: 'Graph store',
        whenItWins:
          'Traversal several hops deep where relationships are the primary data: recommendation, fraud rings, permission inheritance.',
        whenItLoses:
          'Aggregate reporting and high-volume simple lookups, which it does worse than the alternatives.',
        cost:
          'A specialised store to operate, a query language to learn, and usually a second system for everything else.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We chose a NoSQL database because we need to scale."',
      whyWeak:
        'It names a category rather than a constraint. A single relational instance handles tens of thousands of writes per second and terabytes of data, so "scale" is not a reason until it is a number. And a non-relational store only scales well on the access patterns it was keyed for — it scales worse than relational on anything else.',
      strongAnswer:
        '"What write rate and data volume are we expecting, and where does that sit against one relational instance? If we are genuinely past it, the question becomes which access patterns must stay fast — and that is what determines the key design. If we are not past it, I would rather keep the ability to answer unplanned queries."',
    },
    {
      weakAnswer: '"A document store is better here because our schema is still changing."',
      whyWeak:
        'It is a real problem with a much cheaper solution. A JSON column gives schema flexibility inside a relational database, so you keep transactions, joins, constraints and the ability to answer an unplanned query — and you do not take on a second system.',
      strongAnswer:
        '"Schema flexibility is an argument for a JSON column, not for a different database. I would model the parts that are stable as real columns with constraints, keep the variable parts as JSON, and revisit if the relational features genuinely go unused. Adopting a document store for this reason trades an afternoon of modelling for a permanent constraint."',
    },
    {
      weakAnswer: '"We partition by `tenant_id`, which spreads load evenly across nodes."',
      whyWeak:
        'Only if tenants are evenly sized, and they never are. In almost every multi-tenant system a handful of tenants are most of the traffic, so one node carries a disproportionate share and adding nodes does not relieve it — the key, not the node count, determines the distribution.',
      strongAnswer:
        '"Tenant size distribution is almost always heavily skewed, so `tenant_id` alone gives hot partitions. I would use a composite key — tenant plus a bucket derived from something high-cardinality — and accept that reading all of one tenant\'s data now touches every bucket. That is trading a write hot spot for a read fan-out, which is only worth it if reads are rarer or more tolerant."',
    },
    {
      weakAnswer: '"We embed comments in the post document so one read gets everything."',
      whyWeak:
        'Comments are unbounded. A popular post grows past the document size limit, every read of the post transfers every comment whether needed or not, and two people commenting simultaneously are a read-modify-write on the same document where one silently loses.',
      strongAnswer:
        '"Embedding is right for bounded collections with no independent identity — order lines, addresses. Comments are unbounded and independently queried, so they are referenced, with the post storing a count and perhaps the newest few for display. The rule is: embed if it is always loaded with the parent and bounded; reference otherwise."',
    },
    {
      weakAnswer: '"Duplicating data across keys is fine — the store has no joins, so that is just how it works."',
      whyWeak:
        'Correct that it is normal and incomplete about the cost. Every duplicate needs an owner, a write path that updates all copies, and a reconciliation job — and with no foreign keys or transactions across partitions, drift is not hypothetical.',
      strongAnswer:
        '"Duplication is the design norm here, and each copy inherits the same three obligations as any denormalised value: one owner, a write path that updates every copy, and a job that detects divergence. Without those, the second copy is a second source of truth nobody is responsible for."',
    },
    {
      weakAnswer: '"We enumerated our access patterns up front, so the key design is settled."',
      whyWeak:
        'The enumeration is a bet that you know the future, and reporting requirements — which nobody can enumerate, because they are ad-hoc by definition — always arrive. A design that is correct for fifteen known queries has no answer for the sixteenth.',
      strongAnswer:
        '"The enumeration is the right method and it is a bet. I would plan for being wrong: change events streamed to a relational read model or an analytical store, so ad-hoc questions have somewhere to go without a scan of the operational store. Deciding that up front is much cheaper than discovering it when finance asks for revenue by region."',
    },
  ],

  flashcards: [
    {
      id: 'fc-nosql-1',
      front: 'What is the real trade between relational and non-relational stores?',
      back: 'Relational lets you decide the questions later; non-relational requires deciding them first and rewards you with predictable cost. Not scale versus features.',
      topic: 'nosql',
    },
    {
      id: 'fc-nosql-2',
      front: 'What is the signal that you are not ready to choose a non-relational store?',
      back: 'You cannot enumerate your access patterns. The store\'s entire value is answering a fixed set of questions extremely well, and you do not yet know what they are.',
      topic: 'access-patterns',
    },
    {
      id: 'fc-nosql-3',
      front: 'What are the four non-relational families and what is each for?',
      back: 'Key-value (one lookup: caches, sessions), document (a tree loaded as a unit), wide-column (entity plus time range at high write rates), graph (traversal several hops deep).',
      topic: 'nosql',
    },
    {
      id: 'fc-nosql-4',
      front: 'What three things does a partition key decide?',
      back: 'Which queries are cheap, where the hot spots are, and what can be atomic — because the partition boundary is usually also the transaction boundary.',
      topic: 'partitioning',
    },
    {
      id: 'fc-nosql-5',
      front: 'Why does `tenant_id` usually make a poor partition key on its own?',
      back: 'Tenant sizes are heavily skewed, so a handful of tenants become hot partitions and adding nodes does not relieve them. The key determines distribution, not the node count.',
      topic: 'partitioning',
    },
    {
      id: 'fc-nosql-6',
      front: 'What do composite and write-sharded keys actually trade?',
      back: 'A write hot spot for a read fan-out. Reading all of one logical group now touches every bucket, so it only wins if reads are rarer or more tolerant.',
      topic: 'partitioning',
    },
    {
      id: 'fc-nosql-7',
      front: 'When should you embed a child document, and when reference it?',
      back: 'Embed when it is always loaded with the parent, has no independent identity, and the collection is bounded and small. Reference when it is queried independently, referenced elsewhere, or unbounded.',
      topic: 'data-modeling',
    },
    {
      id: 'fc-nosql-8',
      front: 'Name three failure modes of over-embedding.',
      back: 'Unbounded growth past the document size limit, contention when two updates to different elements collide as one read-modify-write, and duplication drift when a copy was meant to track its source.',
      topic: 'data-modeling',
    },
    {
      id: 'fc-nosql-9',
      front: 'What obligations does every duplicated copy inherit?',
      back: 'An owner, a write path that updates every copy, and a reconciliation job — the same three requirements as any denormalised value, now applying to most of your data.',
      topic: 'data-modeling',
    },
    {
      id: 'fc-nosql-10',
      front: 'Which requirement reliably breaks access-pattern-first design?',
      back: 'Reporting. Ad-hoc analytical questions cannot be enumerated in advance, which is what makes them ad-hoc, and a fixed-key design has no answer except a scan or a second system.',
      topic: 'access-patterns',
    },
    {
      id: 'fc-nosql-11',
      front: 'What is the honest alternative to adopting a document store?',
      back: 'A JSON column in the relational database you already run: schema flexibility where needed, real columns and constraints elsewhere, and transactions and joins across both.',
      topic: 'key-value',
    },
    {
      id: 'fc-nosql-12',
      front: 'What does "the key is the query plan" mean in practice?',
      back: 'A lookup supplying the partition key costs the same at a thousand items and at a billion. A query that does not match a key is not slow — it is a scan you must request, or impossible.',
      topic: 'key-value',
    },
  ],

  quiz: [
    {
      id: 'q-nosql-1',
      kind: 'scenario',
      prompt:
        'A team expects 3,000 writes/second and 500 GB of data within two years, and proposes a distributed key-value store "because Postgres will not scale". What is the strongest response?',
      options: [
        { id: 'a', label: 'Those numbers are comfortably within one relational instance; the question is whether the access patterns are known and fixed' },
        { id: 'b', label: 'Agree — 3,000 writes/second requires horizontal scaling' },
        { id: 'c', label: 'Agree, but suggest sharding Postgres instead' },
        { id: 'd', label: 'Disagree, because key-value stores cannot handle 500 GB' },
      ],
      correct: ['a'],
      explanation:
        '3,000 writes/second and 500 GB are unremarkable for a single well-provisioned relational instance. "Scale" is not a reason until it is a number that exceeds a real limit. The legitimate reason to choose a key-value store is a fixed, known access pattern with a requirement for predictable latency — and that reframing is what the response should offer.',
      difficulty: 'core',
      topic: 'nosql',
    },
    {
      id: 'q-nosql-2',
      kind: 'scenario',
      prompt:
        'A feed is stored in a key-value store partitioned by `author_id`. Product asks for "posts from everyone I follow, newest first". A user follows 400 accounts. What is the cost profile?',
      options: [
        { id: 'a', label: '400 partition reads merged in the application, with latency set by the slowest one' },
        { id: 'b', label: 'One read, since the store maintains a global sort order' },
        { id: 'c', label: 'A full table scan, since the query has no partition key' },
        { id: 'd', label: 'Constant time, because key-value lookups are O(1)' },
      ],
      correct: ['a'],
      explanation:
        'The query needs data from 400 partitions, so it is a scatter-gather: cost proportional to follow count and tail-latency amplification from the slowest node. It is not a full scan — the partition keys are known — and it is certainly not constant time. Avoiding this is why feed systems fan out on write into a per-reader partition.',
      difficulty: 'core',
      topic: 'access-patterns',
    },
    {
      id: 'q-nosql-3',
      kind: 'single',
      prompt: 'Why is the partition key a correctness decision and not only a performance one?',
      options: [
        { id: 'a', label: 'Most stores offer atomicity within a partition and none across, so items that must change together must share a key' },
        { id: 'b', label: 'The partition key must be unique across the dataset' },
        { id: 'c', label: 'Partition keys cannot be changed after creation' },
        { id: 'd', label: 'Secondary indexes require the partition key to be immutable' },
      ],
      correct: ['a'],
      explanation:
        'The partition boundary is usually the transaction boundary, so key choice determines which invariants you can enforce atomically. Anything spanning partitions becomes a saga with compensations and per-step idempotency. Partition keys are not required to be unique — many items share one — and immutability is a practical consequence rather than the reason.',
      difficulty: 'advanced',
      topic: 'partitioning',
    },
    {
      id: 'q-nosql-4',
      kind: 'scenario',
      prompt:
        'A document store holds posts with comments embedded as an array. A post goes viral and accumulates 40,000 comments. What breaks first, and what else breaks?',
      options: [
        { id: 'a', label: 'The document approaches the size limit; every post read transfers all comments; concurrent comment writes collide as read-modify-write' },
        { id: 'b', label: 'Nothing — document stores handle large arrays efficiently' },
        { id: 'c', label: 'Only read performance; writes are unaffected' },
        { id: 'd', label: 'Only the size limit; reads and writes are otherwise fine' },
      ],
      correct: ['a'],
      explanation:
        'All three problems arrive together, which is why unbounded embedding is the classic document-store modelling error. Comments are independently queried and unbounded, so they should be referenced, with the post holding a count and perhaps the newest few for display.',
      difficulty: 'core',
      topic: 'data-modeling',
    },
    {
      id: 'q-nosql-5',
      kind: 'scenario',
      prompt:
        'A multi-tenant system partitions by `tenant_id`. After eighteen months, one node handles 45% of traffic while others are idle. Adding nodes does not help. What happened and what is the fix?',
      options: [
        { id: 'a', label: 'Tenant size is skewed, so the key concentrates load; a composite key spreading one tenant across buckets fixes writes and makes whole-tenant reads fan out' },
        { id: 'b', label: 'The cluster needs rebalancing' },
        { id: 'c', label: 'The store is not distributing keys uniformly and needs a different hash function' },
        { id: 'd', label: 'The node needs more capacity' },
      ],
      correct: ['a'],
      explanation:
        'The hash is distributing keys fine — there is simply one key with 45% of the traffic behind it. Rebalancing cannot split a single partition, and adding nodes gives the hot partition no relief. Only changing the key changes the distribution, and the composite key trades the write hot spot for a read fan-out.',
      difficulty: 'advanced',
      topic: 'partitioning',
    },
    {
      id: 'q-nosql-6',
      kind: 'multi',
      prompt:
        'Which of these are genuine reasons to choose a non-relational store? Select all that apply.',
      options: [
        { id: 'a', label: 'A single well-known lookup pattern with a requirement for predictable low latency at very large scale' },
        { id: 'b', label: 'Very high write throughput on entity-plus-time-range access' },
        { id: 'c', label: 'Traversal queries several relationship hops deep' },
        { id: 'd', label: 'The schema is still changing and defining tables feels premature' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are shapes that a specific family genuinely serves better. Schema instability is a real problem with a much cheaper answer — a JSON column in the relational database you already run — and treating it as a reason to change databases trades an afternoon of modelling for a permanent constraint on what you can ask.',
      difficulty: 'core',
      topic: 'nosql',
    },
  ],

  exercises: [
    {
      id: 'ex-nosql-1',
      kind: 'design',
      title: 'Design the keys, then find what you cannot answer',
      estimatedMinutes: 25,
      prompt: `A team is building a delivery-tracking system on a key-value store with a partition key and one sort key per index. Known access patterns:

1. Get a shipment by tracking number. (very high volume, public tracking page)
2. List a customer's shipments, newest first. (customer dashboard)
3. List a courier's shipments for today, in delivery-route order. (courier app)
4. Append a status event to a shipment and read its full history. (high write volume)

Facts: 40 million shipments/year; one retail customer is 30% of volume; a shipment averages 12 status events; couriers have 40-80 shipments per day.

Produce:
1. The key design for each access pattern, and where you duplicate data.
2. The hot-partition risk and how you address it.
3. Which access pattern determines the transaction boundary, and what that means.
4. Three plausible future requirements this design cannot serve, and what you would put in place now.`,
      rubric: [
        'Pattern 1: partition key is the tracking number, giving a constant-cost point lookup.',
        'Pattern 2: a second copy or index partitioned by customer_id with created_at as sort key.',
        'Pattern 3: partition key combining courier and date, with sequence or route order as sort key.',
        'Pattern 4: status events under the shipment partition with timestamp as sort key, so append and history read are one partition.',
        'Identifies the 30% customer as a hot partition for pattern 2 and proposes a composite key with an explicit read fan-out cost.',
        'Identifies pattern 4 as setting the transaction boundary: events must share the shipment partition for atomic append plus status update.',
        'Names three genuine unanswerable future queries — analytical or cross-cutting — rather than variations of the known four.',
        'Proposes a change-event stream to a relational or analytical store now, rather than after the requirement arrives.',
      ],
      modelAnswer: `**1. Key design per pattern**

| # | Partition key | Sort key | Notes |
| --- | --- | --- | --- |
| 1 | \`tracking_number\` | — | Point lookup, constant cost at any scale. This is the highest-volume pattern and it gets the primary key. |
| 2 | \`customer_id\` | \`created_at DESC\` | A duplicate item (or a secondary index) so a customer's shipments are one partition read in the required order. |
| 3 | \`courier_id#date\` | \`route_sequence\` | Date in the partition key bounds the partition to one day's work — 40-80 items — and the sort key gives route order directly. |
| 4 | \`tracking_number\` | \`event_timestamp\` | Events live in the *same* partition as the shipment, so appending an event and reading full history are both single-partition operations. |

**Where I duplicate:** the shipment item exists under \`tracking_number\` (pattern 1) and again keyed by \`customer_id\` (pattern 2). Pattern 3 stores a lighter projection — address, ETA, sequence — under the courier key, because the courier app does not need full history.

Each duplicate inherits the three obligations: the shipment service is the sole writer of all copies, writes go to every copy in one logical operation, and a nightly job compares copies and reports divergence. With no cross-partition transaction, that job is not optional — it is how you learn about drift.

**2. Hot partition risk**

Pattern 2 is the problem. One retail customer at 30% of 40 million shipments a year is ~12 million items under one partition key. That partition is both a storage hot spot and a traffic hot spot, and adding nodes does nothing because a single partition key lives on one node.

*Fix:* composite key \`customer_id#YYYY-MM\`.

- Bounds any single partition to one month of that customer's shipments (~1 million for the large customer, a handful for a small one).
- The dashboard's "newest first" query reads the current month's partition and pages backwards month by month — usually one partition read, occasionally two.
- **Cost:** "all shipments for this customer ever" now touches up to 24 partitions. That is a fan-out I am accepting, and I would confirm it is not a real access pattern before committing.

Pattern 1 has no skew risk: tracking numbers are high-cardinality by construction. Pattern 3 is naturally bounded by the date in the key.

**3. The transaction boundary**

**Pattern 4 sets it.** Appending a status event and updating the shipment's current status must be atomic — otherwise a reader sees an event that the summary does not reflect, or a status with no supporting event. Both items therefore *must* share the \`tracking_number\` partition, and that is why events are keyed under the shipment rather than in their own table.

What follows from that:

- The duplicate under \`customer_id#month\` is in a **different** partition, so updating it is **not** atomic with the event append. It is eventually consistent, and the dashboard may briefly show a stale status.
- That is acceptable here — a tracking status a second behind is invisible to a user — and it must be a stated decision, not an accident.
- The same is true of the courier projection.

So the design has one strongly consistent partition (the shipment and its events) and two eventually consistent projections. Naming which is which is the substance of the answer.

**4. Three requirements this cannot serve**

**a) "Average delivery time by region, by month."** No key serves it. Regions are inside addresses, and the aggregation spans every partition. Only a full scan or a purpose-built index answers it, and nobody can enumerate the dimensions finance will want.

**b) "All shipments currently in the exception state, across all customers."** Status is not a partition key. Adding a secondary index on status would create a hot partition — the vast majority of shipments share a small number of statuses — so even the obvious fix is bad.

**c) "Which couriers had more than three late deliveries last week?"** A cross-entity aggregate with a computed predicate. Nothing in the key design touches it.

**What I would put in place now: a change-event stream out of the operational store into a relational read model.**

Every write to a shipment or event emits a change record; a consumer maintains a normalised relational copy. That gives:

- Ad-hoc SQL for all three questions above, and every one nobody has asked yet.
- A place for reporting load that is not the store serving the public tracking page.
- A second source of truth for the reconciliation job to compare against.

The reason to build it **now** rather than when (a) arrives: retrofitting a change stream means backfilling four years of history, and in the meantime the answer to a reasonable business question is "we cannot". Building it while the data volume is small is dramatically cheaper, and it is the specific mitigation for the bet that the access-pattern enumeration is complete — a bet I am confident is wrong, because reporting requirements always arrive.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-nosql-1',
      level: 'basic',
      question: 'When would you choose a non-relational database?',
      guidance:
        'A known fixed access pattern with a predictable-latency requirement, very high write rates on an entity-plus-time key, tree-shaped data loaded as a unit, or deep traversal. A candidate who answers "for scale" without a number has not made a decision.',
    },
    {
      id: 'iq-nosql-2',
      level: 'basic',
      question: 'What does access-pattern-first design mean?',
      guidance:
        'Enumerate every query, then design keys to serve them, duplicating data where patterns disagree. A strong answer names the bet involved — that the enumeration is complete — and notes the relational alternative defers that decision.',
    },
    {
      id: 'iq-nosql-3',
      level: 'intermediate',
      question: 'How do you choose a partition key?',
      guidance:
        'From the access patterns, with cardinality and distribution checked, and with the knowledge that the partition boundary is also the transaction boundary. Look for all three consequences: which queries are cheap, where hot spots form, and what can be atomic.',
    },
    {
      id: 'iq-nosql-4',
      level: 'intermediate',
      question: 'Embed or reference, in a document store?',
      guidance:
        'Embed when always loaded together, no independent identity, bounded and small. Reference otherwise. A strong answer names the three over-embedding failures — size limits, whole-document transfer, read-modify-write contention — rather than only the size limit.',
    },
    {
      id: 'iq-nosql-5',
      level: 'advanced',
      question: 'One tenant is 40% of your traffic and you partition by tenant. What now?',
      guidance:
        'A composite key spreading that tenant across buckets, with the read fan-out stated as the cost. Excellent answers note that rebalancing and adding nodes cannot help a single hot key, and consider whether the large tenant warrants its own dedicated capacity.',
    },
    {
      id: 'iq-nosql-6',
      level: 'advanced',
      question: 'Your access-pattern-first design is live and a reporting requirement arrives. What do you do?',
      guidance:
        'Recognise the category — ad-hoc analytics cannot be served by fixed keys — and stream change events to a relational or analytical read model. Excellent answers say this should have been built up front, because retrofitting means backfilling history while the business has no answer.',
    },
    {
      id: 'iq-nosql-7',
      level: 'followup',
      question: 'A team wants a document store because their schema keeps changing. Your view?',
      guidance:
        'The problem is real and the solution is a JSON column in the existing relational database — flexibility where needed, constraints and joins everywhere else, one system to operate. A strong answer names what would change their mind: relational features going genuinely unused, or a real horizontal write-scaling need.',
    },
    {
      id: 'iq-nosql-8',
      level: 'followup',
      question: 'You duplicate data across keys. What does each copy cost you?',
      guidance:
        'An owner, a write path updating every copy, and a reconciliation job — plus the acknowledgement that copies in different partitions are eventually consistent, since there is no cross-partition transaction. A candidate who treats duplication as free has not operated one of these.',
    },
  ],

  activeLearning: [
    {
      id: 'al-nosql-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson framed the choice as one store or another. Now change the premise: you may run both, with change events flowing from an operational key-value store into a relational read model. Which problems does that solve, which does it create, and what is the property you must now protect?',
      discussion: `This is the shape most mature systems land on, and it is worth being precise about what it does and does not buy.

**Solved:**

*Ad-hoc queries.* The relational side answers anything expressible in SQL, including the reporting questions nobody enumerated. The failure mode that reliably breaks access-pattern-first design now has somewhere to go.

*Read/write isolation.* Analytical load lands on the read model rather than on the store serving the public tracking page. A slow report cannot degrade a customer-facing lookup.

*Predictable operational latency.* The key-value side keeps its constant-cost point lookups, unaffected by whatever queries the read model is running.

*A reconciliation oracle.* Two independently derived copies of the truth means divergence is detectable, which it is not when there is only one.

**Created:**

*Eventual consistency, now user-visible in a new place.* The read model lags. A user who completes an action and immediately views a report sees stale data. This is manageable and must be designed: show the operational value where freshness matters, the read model where it does not.

*A pipeline as a first-class component.* Change capture, ordering, delivery guarantees, dead-lettering, replay. It is a system with its own failure modes, and the ones that hurt are silent: a consumer that falls behind for hours, or a lost event, produces a read model that is quietly wrong rather than obviously broken.

*Schema evolution in two places.* A field added operationally must reach the read model, and the two evolve on different clocks.

*Double the storage and a second thing to operate.*

**The property to protect: the pipeline must be replayable and monitored for lag.**

Everything else about this architecture is recoverable if you can rebuild the read model from the operational store or from the event log. If you cannot — if events are consumed and discarded, or the operational store has no way to re-emit history — then a bug in the consumer means permanent silent corruption with no repair path.

Concretely, that means: retain the change log long enough to rebuild, make consumers idempotent so replay is safe, expose consumer lag as a first-class metric with an alert, and periodically reconcile the two sides and report divergence rather than assuming agreement.

**The uncomfortable observation.** Once you are running both, the honest question is whether the key-value store is still earning its place. If the relational side handles reporting and the operational access patterns are within one relational instance, you are operating two systems where one would do — and the answer depends entirely on whether the point-lookup volume and latency requirement genuinely exceed what relational can give. That is a numbers question, and it is worth revisiting rather than assuming the original decision still holds.

**Transferable:** adding a second store to cover the first one's weakness is a legitimate and common move, and it converts a modelling constraint into a pipeline you must operate. Pipelines fail quietly, so the mitigation is replayability plus lag monitoring — decided up front, because both are far harder to add after the read model has diverged.`,
    },
    {
      id: 'al-nosql-2',
      kind: 'debug',
      prompt:
        'A key-value-backed service has p50 of 4 ms and p99 of 900 ms. The store reports no throttling and consistent internal latency. Item sizes are small. Requests are distributed evenly across many partition keys. What are your hypotheses?',
      discussion: `Even key distribution, no throttling, healthy store-side latency, small items — the store is behaving. So the tail is coming from how it is being *used*, not from the store itself.

**1. Some requests are scatter-gather.** The most likely explanation. If a minority of requests query without the partition key — a secondary-index query, a filtered scan, a fan-out over several keys — those touch many partitions and their latency is the slowest response among them. Evenly distributed *partition keys* says nothing about requests that supply no key. This produces exactly a bimodal distribution: fast point lookups and slow fan-outs.

*Check:* group latency by operation type, not by key. Point lookups versus index queries versus scans.

**2. Pagination loops in the application.** A request that internally pages through results issues N sequential round trips. The store reports each one as fast; the caller experiences the sum. A query returning a short page with a continuation token — which these stores do when a size budget is hit — makes the loop count unpredictable.

*Check:* number of store calls per application request. A p99 with 40 calls and a p50 with 1 is the answer.

**3. A single large item or partition among the small ones.** "Item sizes are small" is usually an average. One shipment with 40,000 events, or one customer partition with millions of items, produces slow reads for anyone touching it. Averages hide this precisely.

*Check:* the maximum item size and the maximum partition size, not the mean. Correlate slow requests with specific key values.

**4. Client-side, not store-side.** Connection pool exhaustion, DNS resolution, credential refresh, or garbage collection in the client. The store is fast; the request is waiting before it is issued. This is the hypothesis that fits "the store looks perfect" best after fan-out.

*Check:* client-side connection-acquisition time, and whether slow requests cluster in time (pointing at GC or a credential refresh) rather than by key.

**What I would measure first: latency grouped by operation type.** One dimension, and it separates hypothesis 1 from everything else immediately — which matters because hypothesis 1 requires a *modelling* change (a new key or a duplicated item) while the others are configuration or code fixes.

**Then:** store calls per application request (2), maximum rather than mean item and partition size (3), connection-acquisition time (4).

**The transferable lesson.** In a store with predictable per-operation cost, a latency tail almost always means some requests are doing a different *kind* of operation, or many operations. The store's own metrics cannot show that, because from its side each call was fast. Instrumenting at the application boundary — operation type and calls per request — is what makes this visible, and it is the instrumentation people add after the incident rather than before.`,
    },
  ],

  revision: {
    bullets: [
      'The trade is not scale versus features: relational lets you decide the questions later, non-relational requires deciding them first.',
      'A single relational instance handles tens of thousands of writes per second and terabytes. "Scale" is not a reason until it is a number.',
      'If you cannot enumerate your access patterns, you are not ready to choose a non-relational store.',
      'Key-value: one lookup. Document: a tree loaded as a unit. Wide-column: entity plus time range at high write rates. Graph: deep traversal.',
      'The key is the query plan. Supplying it costs the same at a thousand items and a billion; omitting it is a scan or impossible.',
      'A partition key decides which queries are cheap, where hot spots form, and what can be atomic.',
      'The partition boundary is usually the transaction boundary, so key choice is a correctness decision.',
      'tenant_id alone is a poor key: tenant sizes are skewed, and adding nodes cannot relieve one hot key.',
      'Composite and write-sharded keys trade a write hot spot for a read fan-out.',
      'Embed when always loaded together, bounded, and with no independent identity. Reference otherwise.',
      'Over-embedding fails three ways at once: size limits, whole-document transfer, and read-modify-write contention.',
      'Every duplicated copy needs an owner, a write path that updates all copies, and a reconciliation job.',
      'Copies in different partitions are eventually consistent, because there is no cross-partition transaction.',
      'Reporting is the requirement that reliably breaks access-pattern-first design, and it always arrives.',
      'Build the change-event stream to a relational read model up front — retrofitting means backfilling history.',
      '"Our schema keeps changing" is an argument for a JSON column, not for a different database.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A family of stores that fix the access path in the key rather than deferring it to a query planner, trading query flexibility for predictable cost.',
    whyItExists:
      'Hiding access paths costs a planner, statistics and unpredictable query cost. Making the path explicit gives constant-cost lookups and horizontal partitioning, for the queries the key serves.',
    whenToUse: [
      'A single known lookup with a predictable-latency requirement at large scale.',
      'Very high write rates on entity-plus-time-range access.',
      'Tree-shaped data loaded and saved as a unit, with bounded nesting.',
      'Traversal several relationship hops deep.',
    ],
    whenNotToUse: [
      'When you cannot enumerate the access patterns.',
      'When the same data is queried several different ways and duplication is unacceptable to maintain.',
      'When invariants span entities and need atomic enforcement.',
      'When the real motivation is schema flexibility, which a JSON column solves more cheaply.',
    ],
    alternatives: [
      'A relational database with JSON columns: flexibility where needed, constraints and joins elsewhere, one system.',
      'A sharded relational database, which keeps SQL while partitioning — with the same partition-key consequences.',
      'A hybrid: operational key-value store plus a relational read model fed by change events.',
    ],
    tradeoffs: [
      'Fixed access paths buy predictable cost and cost the ability to answer unplanned questions.',
      'Duplication buys a second access pattern and costs owners, write fan-out and reconciliation.',
      'Composite keys buy even load distribution and cost a read fan-out.',
      'A second store buys ad-hoc query capability and costs a pipeline you must keep replayable and monitored.',
    ],
    failureModes: [
      'A hot partition from a skewed key, which adding nodes cannot relieve.',
      'Scatter-gather for a query the key does not serve, with tail latency set by the slowest partition.',
      'An unbounded embedded array hitting a size limit, transferring on every read, and losing concurrent updates.',
      'Duplicated copies drifting because no owner or reconciliation job exists.',
      'A reporting requirement with no possible answer except a full scan.',
      'A change-event consumer falling behind, leaving a read model quietly wrong.',
    ],
    followUpQuestions: [
      'List every access pattern. How confident are you that the list is complete?',
      'What write rate and data volume are you expecting, and where does that sit against one relational instance?',
      'What is the distribution of your partition key, not just its cardinality?',
      'Which items must change atomically, and do they share a partition?',
      'Where does an ad-hoc reporting question go?',
      'Who owns each duplicated copy, and what tells you when they disagree?',
    ],
  },
});
