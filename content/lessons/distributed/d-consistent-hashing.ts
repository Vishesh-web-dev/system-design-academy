import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-consistent-hashing',
  title: 'Consistent hashing and virtual nodes',
  summary:
    'Naive `hash % N` remaps almost every key when N changes, which makes adding a machine an outage. Consistent hashing moves 1/N instead — and virtual nodes exist because the naive version of it distributes badly.',
  phase: 'distributed',
  module: 'data-at-scale',
  position: 25,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 40,
  tags: ['consistent-hashing', 'virtual-nodes', 'rebalancing', 'hash-ring', 'replication-placement'],
  prerequisites: ['d-partitioning'],
  resources: [
    {
      key: 'consistent-hashing-karger',
      tier: 'must',
      note: 'The original paper. Read the sections defining the construction and its balance properties — the whole idea is short, and reading it first-hand removes a lot of second-hand confusion.',
    },
    {
      key: 'dynamo-paper',
      tier: 'must',
      note: 'Read the partitioning and replication sections. This is where virtual nodes and the preference list are introduced as answers to the plain ring\'s specific problems.',
    },
    {
      key: 'cassandra-architecture',
      tier: 'must',
      note: 'A production ring with token ranges and virtual nodes. Read it for how token assignment and replica placement interact in a real deployment.',
    },
    {
      key: 'jump-consistent-hash',
      tier: 'good',
      note: 'A different construction with perfect balance and no ring state, at the cost of only supporting node additions at the end. Worth reading to see that "consistent hashing" is a property, not one algorithm.',
    },
    {
      key: 'maglev-paper',
      tier: 'good',
      note: 'Read the hashing section. Maglev optimises for minimal disruption and near-perfect balance in a load-balancing context, where a remapped key means a broken connection rather than a cache miss.',
    },
    {
      key: 'vitess-sharding',
      tier: 'advanced',
      note: 'Read it as the counterpoint: a system that uses explicit key ranges rather than a hash ring, and why that is a reasonable choice when resharding is a controlled operation.',
    },
  ],

  intuition: {
    body: `Start with the problem, because the solution is otherwise unmotivated.

You have N machines and you place each key with \`hash(key) % N\`. Even distribution, no state, one line of code. Then you add a machine.

\`hash(key) % 10\` and \`hash(key) % 11\` are unrelated for almost every key. **Roughly 90% of your keys now belong somewhere else.** For a cache, that means a near-total miss rate and every request hitting the origin at once. For a database, it means moving 90% of your data before the cluster is correct again.

So the operation you most need to be routine — adding capacity — is the operation this scheme makes catastrophic. That is the entire problem consistent hashing solves.

**The construction.** Imagine the hash output space as a circle. Hash each *node* to a position on it. Hash each *key* to a position too. A key belongs to **the first node clockwise from its position.**

Now add a node. It lands somewhere on the circle and claims only the keys between its position and the previous node's — the keys that used to belong to its clockwise neighbour. **Nothing else moves.** On average that is \`1/N\` of the keyspace rather than \`(N-1)/N\`.

That single property — a membership change disturbs \`1/N\` of keys instead of nearly all of them — is what makes elastic clusters possible.

**And then the property that most explanations skip.** The plain ring distributes *badly*. With 10 nodes hashed to random positions, the gaps between them are not equal — some nodes get three times the keyspace of others, because random points on a circle cluster. So you have solved rebalancing and created a load-imbalance problem.

**Virtual nodes fix that.** Instead of hashing each node once, hash it 100 or 200 times, so each physical node owns many small scattered arcs rather than one large one. The law of large numbers does the rest: 10 nodes × 200 virtual nodes is 2,000 arcs, and the total per physical node converges tightly on 10%.

Virtual nodes also buy two things that are arguably more valuable than the balance:

**Heterogeneous capacity.** A machine with twice the RAM gets twice the virtual nodes. Weighting is free.

**Spread-out failure.** When a node dies, its many small arcs are inherited by many different nodes, so the load is spread across the cluster rather than dumped on one unlucky clockwise neighbour.

The framing to carry: **consistent hashing is a property — a membership change moves \`1/N\` of keys — and the ring is one way to get it. Virtual nodes are not an optimisation; without them the ring is unusable.**`,
    analogyLimit:
      'The ring picture is genuinely helpful and hides two things. It suggests nodes are evenly spaced, when random placement is exactly what makes the plain ring imbalanced — the picture people draw is the case that does not occur. And a ring drawn with one point per node cannot show the property that matters most in a failure: with virtual nodes a dead node\'s load is inherited by many nodes at once, not dumped on its single clockwise neighbour.',
  },

  deepExplanation: {
    predict: {
      question:
        'A 10-node Memcached tier uses `hash(key) % 10`. An eleventh node is added during a routine capacity increase. The origin database falls over within seconds. Explain the sequence precisely, and say what the outcome would have been with consistent hashing plus virtual nodes.',
      answer: `**The sequence, step by step.**

1. Clients pick up the new node list and start computing \`hash(key) % 11\`.
2. For a key, \`hash(key) % 10\` and \`hash(key) % 11\` agree only when the hash happens to land such that both remainders match — roughly \`1/11\` of the time. **So about 90% of keys now map to a different node than the one holding them.**
3. Every request for those keys is a cache miss. Not a gradual decay — an instantaneous cliff, because every client recomputes at once.
4. The cache tier was absorbing, say, 95% of read traffic. It now absorbs about 10%. **Origin read load multiplies roughly 18-fold** in the space of a second.
5. The database saturates. Query latency climbs, connection pools fill, and requests that would have been served from cache now queue behind database work.
6. Two amplifying effects follow. First, the cache-fill writes themselves add load, since every miss triggers a read-through populate. Second, retries: clients timing out on slow requests retry, adding traffic exactly when the database is least able to serve it.
7. Even as the cache refills, the origin stays saturated because the refill *is* the load. Recovery is not fast, and the cluster does not settle until the working set is resident again.

The essential point: **the outage is not caused by the new node being slow or wrong. It is caused by 90% of keys changing owner simultaneously.** The new node worked perfectly.

**With consistent hashing plus virtual nodes.**

1. The new node's ~200 virtual nodes land at scattered positions on the ring.
2. Each claims a small arc from whichever node previously owned that region.
3. **About \`1/11\` of keys — roughly 9% — change owner.** The other 91% are unaffected and still hit.
4. Cache hit rate drops from 95% to about 86%. Origin read load rises by roughly 2.8× rather than 18×.
5. That is a large increase and it is survivable with normal headroom, which is the whole difference.
6. The 9% refills over the next minutes, spread across the cluster because the arcs came from many nodes rather than one.

**Two things worth adding, because they are what an experienced answer includes.**

**Even 2.8× can be too much.** If the origin was provisioned for the cached load with 50% headroom, a 2.8× spike still exceeds it. The remedy is to add capacity gradually — introduce the new node with a fraction of its virtual nodes and raise it over minutes — so the miss rate rises in steps you can watch. Consistent hashing makes the change survivable; incremental introduction makes it boring.

**Without virtual nodes, the ring would have concentrated the damage.** A single-point-per-node ring means the new node claims one contiguous arc, taken entirely from **one** existing node. That node's hit rate collapses while everyone else is unaffected, and the origin load for that arc arrives as a spike against whichever backend shard serves it. The total keys moved is the same 9%; the *distribution* of the resulting load is much worse. This is why virtual nodes are not a refinement.

**The general lesson.** The cost of a partitioning scheme is not how well it distributes when stable — modulo hashing distributes perfectly. It is **how much it disturbs when membership changes**, because membership changes are routine and a scheme that punishes them makes the cluster unable to grow.`,
    },
  body: `## The construction, precisely

**Setup.** Take a hash function with a large output space, say 2^32, and treat that space as a circle where the largest value wraps to zero.

**Placing nodes.** For each node, compute \`hash(node_id)\` and mark that position. With virtual nodes, compute \`hash(node_id + ":" + i)\` for \`i\` from 0 to V-1, marking V positions.

**Placing keys.** For a key, compute \`hash(key)\` and walk **clockwise** to the first node position. That node owns the key.

**Lookup cost.** The node positions are kept in a sorted structure, so a lookup is a binary search: \`O(log(N × V))\`. With 100 nodes and 200 virtual nodes each, that is 20,000 entries and about 15 comparisons. Cheap, and the structure is small enough for every client to hold.

**Adding a node.** Its V positions are inserted. Each claims the arc between itself and the previous position, taken from whichever node owned that arc. Expected keys moved: \`1/(N+1)\`.

**Removing a node.** Its V positions are deleted. Each arc merges into the next node clockwise. Expected keys moved: \`1/N\`, spread across many nodes because the arcs were scattered.

## Why virtual nodes are mandatory, with numbers

Hash 10 nodes onto a circle at random. The gaps are not equal — random points cluster, and the distribution of gap sizes has a long tail.

With one position per node, the largest share is typically **two to three times** the smallest. That is not a balanced cluster: one machine is at 90% while another is at 30%, and adding capacity does not fix it because the imbalance is a property of where the hashes landed.

With V positions per node, each physical node's share is the sum of V independent arcs. Variance falls roughly as \`1/√V\`. At V = 100 the spread is a few percent; at V = 200, tighter still.

Three consequences beyond balance:

**Weighting is free.** Give a node with twice the capacity twice the virtual nodes. No special-casing, and heterogeneous fleets — which is what you get when you buy machines over several years — become ordinary.

**Failure load is spread.** A dead node's arcs are inherited by many nodes. Without virtual nodes, one neighbour inherits everything and may itself then fail — a cascading failure caused directly by the placement scheme.

**Rebalancing is smooth.** Introducing a node's virtual nodes gradually raises its share in small increments, so you can watch the miss rate climb rather than discover it.

The costs are real but small: more state (N × V positions), slightly slower lookups, and a subtlety in replica placement covered below.

## Replica placement: the part that goes wrong

Consistent hashing usually places replicas too, and the natural rule has a bug.

**The naive rule:** a key's replicas are the next R nodes clockwise. With R = 3, walk clockwise and take three.

**The bug:** with virtual nodes, the next three positions clockwise may belong to **the same physical node.** Node A has 200 scattered positions; two of them can easily be adjacent. So "three replicas" can be two copies on one machine — and losing that machine loses two of three replicas.

**The fix:** walk clockwise and skip positions belonging to a physical node already chosen. Dynamo calls the resulting list a *preference list* and this skipping is explicit in it.

**The same problem one level up.** If your three replicas are on three machines in the same rack or availability zone, a zone failure takes all three. So the walk must skip by *failure domain*, not only by physical node — take the next three positions belonging to three distinct zones.

This is the single most common implementation error in consistent hashing, and it is invisible until a failure. Everything works, replication factor reports 3, and one machine loss costs two copies.

## Consistent hashing is a property, not an algorithm

The ring is one construction. Others achieve the same property with different trade-offs, and knowing they exist is useful because it separates the requirement from the implementation.

**Jump consistent hash.** A short function mapping a key to one of N buckets with perfect balance and no stored state at all. The constraint: it only supports changing the bucket count at the *end* of the range — you can go from N to N+1, but you cannot remove bucket 3 and keep the rest. Excellent when nodes are numbered and you only grow or shrink the count; unusable when you need to remove a specific node.

**Rendezvous (highest random weight) hashing.** For a key, compute \`hash(key, node)\` for every node and pick the highest. Perfect balance, no ring, no virtual nodes, and naturally gives an ordered replica list — the top R by weight, which incidentally cannot select the same node twice. The cost is \`O(N)\` per lookup rather than \`O(log N)\`, which is fine for tens of nodes and not for thousands.

**Maglev hashing.** Builds a fixed-size lookup table giving near-perfect balance with minimal disruption on membership change. Optimised for the load-balancing case where a remapped key is a *broken connection* rather than a cache miss, so minimal disruption matters more than it does for a cache.

**Explicit range assignment.** Keep a table mapping key ranges to nodes. Not hashing at all: maximum control, arbitrary rebalancing, a large tenant on its own node — at the cost of a lookup service and mapping state. This is what several sharded relational systems do, and it is the right choice when resharding is a planned operation rather than an automatic one.

The selection question: **do you need to remove arbitrary nodes** (ring or rendezvous), **is balance more important than state** (rendezvous or Maglev), **do you need per-key control** (explicit ranges), **or do you only ever change the count** (jump).

## What consistent hashing does not solve

**Hot keys.** If one key is 30% of traffic, it lives on one node, and the ring has no mechanism to split a single key. This is the partitioning lesson's conclusion restated: consistent hashing distributes *keys*, not *load*. The remedy is still bucketing or replicating that key.

**Range queries.** Hashing destroys ordering, so adjacent keys are scattered. A ring cannot serve range scans.

**The data movement itself.** It reduces how much moves; it does not move it. You still need online copying, throttling, and a router that handles keys existing in two places during the transfer.

**Cross-partition transactions.** Unchanged.

**The need to know your ring.** Every client must have a current view of ring membership. That is a distribution problem — gossip, a coordination service, or a control plane — and a client with a stale ring routes to the wrong node. Systems solve this differently, and a client-side ring means membership changes must propagate to every client before they are effective.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'modulo-vs-ring',
      title: 'What moves when you add a node',
      caption:
        'Compare the third column. All three schemes distribute acceptably when stable; they differ entirely in what a membership change costs, and membership changes are the routine event.',
      code: `flowchart TB
    subgraph M["hash(key) % N — 10 nodes → 11"]
      M1["Every key recomputed<br/>against a new modulus"] --> M2["~90% of keys change owner"] --> M3["Cache hit rate 95% → 10%<br/>Origin load ×18<br/>Outage"]
    end

    subgraph R["Plain ring — 10 nodes → 11"]
      R1["New node claims one<br/>contiguous arc"] --> R2["~9% of keys change owner"] --> R3["All taken from ONE node.<br/>That node's hit rate collapses;<br/>load lands unevenly"]
    end

    subgraph V["Ring + 200 virtual nodes"]
      V1["New node's 200 positions<br/>scatter across the ring"] --> V2["~9% of keys change owner"] --> V3["Taken from MANY nodes.<br/>Hit rate 95% → 86%<br/>Origin load ×2.8 — survivable"]
    end

    style M3 fill:#2a1a1a,stroke:#a04848
    style R3 fill:#1c1814,stroke:#c99a4e
    style V3 fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'ring-walk',
      title: 'The clockwise walk, and the replica bug in it',
      caption:
        'Step through it. The final step is the error that is invisible until a machine dies: three replicas that are really two copies on one machine, or three copies in one zone.',
      nodes: [
        { id: 'key', label: 'hash("user:42")', kind: 'client', x: 0, y: 160, detail: 'A position on the 2^32 circle. The key itself carries no information about where it lives — the ring decides.' },
        { id: 'search', label: 'Binary search', kind: 'service', x: 180, y: 160, detail: 'Node positions are held sorted, so finding the first position clockwise is O(log(N × V)). With 100 nodes at 200 virtual nodes each, about 15 comparisons over 20,000 entries.' },
        { id: 'vn1', label: 'vnode A-137', kind: 'store', x: 390, y: 60, detail: 'First position clockwise. Belongs to physical node A, which becomes the primary for this key.' },
        { id: 'vn2', label: 'vnode A-88', kind: 'store', x: 390, y: 160, detail: 'Second position clockwise — and it also belongs to node A. Taking it as a replica puts two of three copies on one machine. This is the bug.' },
        { id: 'vn3', label: 'vnode B-12', kind: 'store', x: 390, y: 260, detail: 'Third position, physical node B. A correct walk skips A-88 and takes this instead.' },
        { id: 'vn4', label: 'vnode C-201', kind: 'store', x: 390, y: 360, detail: 'Fourth position, node C — but if C is in the same availability zone as A and B, a zone failure still loses all three copies.' },
        { id: 'pref', label: 'Preference list', kind: 'note', x: 620, y: 210, detail: 'The corrected result: walk clockwise, skipping any position whose physical node — and whose failure domain — is already chosen. Dynamo names this explicitly for exactly this reason.' },
      ],
      edges: [
        { id: 'r1', source: 'key', target: 'search', kind: 'sync' },
        { id: 'r2', source: 'search', target: 'vn1', kind: 'read' },
        { id: 'r3', source: 'vn1', target: 'vn2', kind: 'control' },
        { id: 'r4', source: 'vn2', target: 'vn3', kind: 'control' },
        { id: 'r5', source: 'vn3', target: 'vn4', kind: 'control' },
        { id: 'r6', source: 'vn3', target: 'pref', kind: 'async' },
        { id: 'r7', source: 'vn4', target: 'pref', kind: 'async' },
      ],
      steps: [
        {
          id: 'v1',
          title: 'The key hashes to a position, not to a node',
          description:
            'Nothing about the key says where it lives. The ring is the entire mapping, which is why every client must hold a current view of ring membership.',
          nodes: ['key', 'search'],
          edges: ['r1'],
        },
        {
          id: 'v2',
          title: 'Walk clockwise to the first position',
          description:
            'Binary search over the sorted positions. That position\'s physical node is the primary. This is the whole read path — O(log(N × V)) and no network call.',
          nodes: ['vn1'],
          edges: ['r2'],
        },
        {
          id: 'v3',
          title: 'Keep walking for replicas — and here is the bug',
          description:
            'The next position clockwise can belong to the same physical node, because that node owns 200 scattered positions and two can be adjacent. Taking it gives two of three copies on one machine.',
          nodes: ['vn2'],
          edges: ['r3'],
        },
        {
          id: 'v4',
          title: 'Skip by physical node',
          description:
            'A correct walk skips any position whose physical node is already in the list. Now three replicas really are three machines.',
          nodes: ['vn3'],
          edges: ['r4'],
        },
        {
          id: 'v5',
          title: 'Then skip by failure domain too',
          description:
            'Three distinct machines in one rack or zone still lose all three copies to a zone failure. The walk must skip by failure domain, and the result is the preference list.',
          nodes: ['vn4', 'pref'],
          edges: ['r5', 'r6', 'r7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['amazon'],
    body: `Dynamo is where consistent hashing became a production pattern rather than a paper, and the paper is unusually candid about why the plain ring was not enough.

**The plain ring's three problems, as they encountered them.**

**Imbalance.** Random node positions produce unequal arcs, so nodes held unequal amounts of data with no way to correct it.

**No heterogeneity.** Nodes bought in different years have different capacity, and one position per node cannot express that.

**Concentrated failure and recovery load.** When a node failed, its single arc went entirely to its clockwise neighbour — which then held double the data and served double the traffic, on a cluster already down a node. And when the failed node returned, it pulled its whole range back from that one neighbour, so recovery load was concentrated too.

**Virtual nodes answered all three.** Many positions per physical node: balance from the law of large numbers, weighting by position count, and failure load spread across many nodes because the arcs came from many places.

**The preference list is the detail worth carrying.** Dynamo does not simply take the next R positions clockwise. It walks the ring **skipping positions whose physical node is already in the list**, so R replicas are R distinct machines. The paper states this explicitly, which tells you it was a mistake worth naming — and it remains the most common implementation error in consistent hashing.

The list also extends beyond R, which enables **hinted handoff**: if a replica is unavailable, the write goes to the next node in the preference list with a hint saying who it belongs to. That node holds it and forwards it when the intended replica returns. This is how Dynamo stays writable during a failure, and it is only possible because the ring gives a well-defined *ordered* set of fallbacks rather than just a set of three.

**Where the model does not transfer.** Dynamo accepts eventual consistency and resolves conflicting versions with vector clocks and application-level merging. Consistent hashing does not require that — Cassandra uses the same ring with tunable quorums, and a load balancer uses it with no replication at all. **The ring is a placement mechanism; the consistency model is a separate decision**, and conflating them is a common misreading of this paper.

**The transferable questions:** does your replica walk skip by physical node *and* by failure domain, and do you have an ordered fallback list so a write can survive an unavailable replica?`,
  },

  tradeoffs: {
    intro:
      'The decision is which construction gives you the consistent-hashing property, and each buys a different thing. Rows include the scheme this replaces.',
    rows: [
      {
        option: '`hash(key) % N`',
        whenItWins:
          'A fixed node count that genuinely never changes. Perfect balance, no state, one line.',
        whenItLoses:
          'The moment N changes — nearly every key remaps, which makes adding capacity an outage.',
        cost:
          'Roughly `(N-1)/N` of keys move on any membership change.',
      },
      {
        option: 'Consistent hash ring, one position per node',
        whenItWins:
          'Nowhere, in practice. It has the movement property and none of the balance.',
        whenItLoses:
          'Always: arcs are unequal by two to three times, capacity cannot be weighted, and a failed node dumps everything on one neighbour.',
        cost:
          'Persistent imbalance that adding capacity does not fix, and concentrated failure load.',
      },
      {
        option: 'Ring with virtual nodes',
        whenItWins:
          'The default. `1/N` movement, tight balance, free capacity weighting, and failure load spread across the cluster.',
        whenItLoses:
          'When you need range queries, or per-key placement control for a large tenant.',
        cost:
          'N × V positions of state on every client, and a replica walk that must skip by physical node and failure domain.',
      },
      {
        option: 'Rendezvous (highest random weight) hashing',
        whenItWins:
          'Tens of nodes. Perfect balance, no ring state, no virtual nodes, and an ordered replica list that cannot pick a node twice.',
        whenItLoses:
          'At thousands of nodes, where `O(N)` hashing per lookup becomes expensive.',
        cost:
          'A hash per node per lookup rather than a binary search.',
      },
      {
        option: 'Jump consistent hash',
        whenItWins:
          'Numbered buckets where you only grow or shrink the count. Perfect balance, no state at all, very fast.',
        whenItLoses:
          'When you must remove a *specific* node — it only supports changes at the end of the range.',
        cost:
          'No arbitrary node removal, and no natural way to weight capacity.',
      },
      {
        option: 'Maglev hashing',
        whenItWins:
          'Load balancing, where a remapped key breaks a live connection. Near-perfect balance with minimal disruption.',
        whenItLoses:
          'When the table build cost or its fixed size is awkward for a very large or fast-changing membership.',
        cost:
          'A lookup table to build and redistribute on membership change.',
      },
      {
        option: 'Explicit range assignment',
        whenItWins:
          'When you need per-key control: a dedicated node for a large tenant, arbitrary rebalancing, range queries preserved.',
        whenItLoses:
          'When you want membership changes to require no coordination.',
        cost:
          'A mapping service that must be cached and highly available, plus mapping state to maintain.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We use consistent hashing so adding nodes does not cause a cache stampede."',
      whyWeak:
        'True but incomplete, and the omission matters. It moves 1/N of keys instead of nearly all — with 11 nodes that is still 9% of the cache going cold at once. If the origin has less than about 3× headroom on the cached read load, that is still an outage.',
      strongAnswer:
        '"Consistent hashing takes the movement from about 90% to about 1/N, which turns an 18× origin spike into roughly 2.8× at eleven nodes. That is survivable with normal headroom rather than free — so I would also introduce the node gradually, starting with a fraction of its virtual nodes and raising it over minutes, so the miss rate climbs in steps I can watch."',
    },
    {
      weakAnswer: '"Hash each node to a point on the ring, and each key goes to the next node clockwise."',
      whyWeak:
        'That is the plain ring, and it distributes badly. Random positions produce arcs differing by two to three times, so one node runs at 90% while another idles, capacity cannot be weighted, and a failed node dumps its entire range on one neighbour.',
      strongAnswer:
        '"Each physical node needs many positions — 100 to 200 virtual nodes — because random single points cluster and produce a two-to-three-times imbalance. Virtual nodes give balance from the law of large numbers, let me weight a bigger machine by giving it more positions, and spread a failed node\'s load across many nodes instead of one unlucky neighbour."',
    },
    {
      weakAnswer: '"For three replicas, take the next three nodes clockwise from the key."',
      whyWeak:
        'With virtual nodes, adjacent positions can belong to the same physical node, so "three replicas" can be two copies on one machine. Replication factor reports 3, everything works, and losing one machine costs two of three copies. It is invisible until a failure.',
      strongAnswer:
        '"Walk clockwise but skip any position whose physical node is already in the list — Dynamo\'s preference list. And skip by failure domain too, since three distinct machines in one availability zone still lose all three copies to a zone failure. This is the commonest implementation error in consistent hashing precisely because nothing surfaces it until something dies."',
    },
    {
      weakAnswer: '"Consistent hashing balances load across the cluster."',
      whyWeak:
        'It balances *keys*, not *load*. If one key takes 30% of traffic it lives on one node, and no ring construction splits a single key. The distinction matters because it determines whether adding nodes is the remedy.',
      strongAnswer:
        '"It distributes keys evenly, with virtual nodes. Load follows only if key access is roughly uniform. A hot key still lands on one node and no ring helps, because there is nothing to split — the remedies are the partitioning lesson\'s: bucket the key, or replicate it to several nodes and read from any."',
    },
    {
      weakAnswer: '"Consistent hashing means we can add and remove nodes freely."',
      whyWeak:
        'It reduces how much data moves; it does not move it. Adding a node still means copying 1/N of the dataset while serving traffic, which needs online copying, throttling so the transfer does not saturate the network, and a router that handles keys existing in two places during the move.',
      strongAnswer:
        '"It bounds the movement to about 1/N, which makes the operation feasible. The operation itself still needs care: copy online, throttle so the rebalance does not degrade production traffic, and have the router serve from the old location until cutover. And every client needs a current ring view, so membership changes must propagate before they take effect."',
    },
    {
      weakAnswer: '"Consistent hashing is the hash ring."',
      whyWeak:
        'The ring is one construction of a property. Treating them as the same thing means missing alternatives that are better fits — rendezvous hashing for perfect balance without virtual nodes, jump hashing for stateless bucketing, Maglev where a remapped key breaks a connection.',
      strongAnswer:
        '"Consistent hashing is the property that a membership change moves about 1/N of keys. The ring is one construction. Rendezvous hashing gives perfect balance with no ring state and a naturally-ordered replica list, at O(N) per lookup. Jump hashing is stateless and very fast but only supports changing the count at the end. Which one depends on whether I need arbitrary node removal, capacity weighting, or minimal state."',
    },
  ],

  flashcards: [
    {
      id: 'fc-ch-1',
      front: 'Why does `hash(key) % N` make adding a node an outage?',
      back: 'Changing N changes the result for nearly every key — about 90% remap going from 10 to 11 nodes. A cache goes cold instantly and origin load multiplies ~18×.',
      topic: 'rebalancing',
    },
    {
      id: 'fc-ch-2',
      front: 'What is the consistent-hashing property?',
      back: 'A membership change moves about `1/N` of keys instead of nearly all of them. It is a property, and the hash ring is one construction of it.',
      topic: 'consistent-hashing',
    },
    {
      id: 'fc-ch-3',
      front: 'How does the ring construction work?',
      back: 'Hash nodes and keys onto a circular hash space. A key belongs to the first node position clockwise from it. Lookup is a binary search over sorted positions.',
      topic: 'hash-ring',
    },
    {
      id: 'fc-ch-4',
      front: 'Why is the plain one-position-per-node ring unusable?',
      back: 'Random points cluster, so arcs differ by two to three times. One node runs hot while another idles, capacity cannot be weighted, and a failed node dumps everything on one neighbour.',
      topic: 'hash-ring',
    },
    {
      id: 'fc-ch-5',
      front: 'What three things do virtual nodes buy?',
      back: 'Tight balance (variance falls as 1/√V), free capacity weighting (more positions for a bigger machine), and failure load spread across many nodes rather than one.',
      topic: 'virtual-nodes',
    },
    {
      id: 'fc-ch-6',
      front: 'What is the replica-placement bug in consistent hashing?',
      back: 'Adjacent ring positions can belong to the same physical node, so "three replicas" can be two copies on one machine. Invisible until that machine dies.',
      topic: 'replication-placement',
    },
    {
      id: 'fc-ch-7',
      front: 'What is a preference list?',
      back: 'The replica list built by walking clockwise while skipping positions whose physical node — and failure domain — is already chosen. It extends beyond R to give ordered fallbacks.',
      topic: 'replication-placement',
    },
    {
      id: 'fc-ch-8',
      front: 'Why must the replica walk skip by failure domain, not just by node?',
      back: 'Three distinct machines in one rack or availability zone still lose all three copies to a zone failure. Distinct machines is not the same as distinct failure domains.',
      topic: 'replication-placement',
    },
    {
      id: 'fc-ch-9',
      front: 'What does hinted handoff need from the ring?',
      back: 'An ordered fallback list. If a replica is unavailable, the write goes to the next node in the preference list with a hint, and is forwarded when the intended replica returns.',
      topic: 'replication-placement',
    },
    {
      id: 'fc-ch-10',
      front: 'What does rendezvous hashing trade against the ring?',
      back: 'Perfect balance, no ring state, no virtual nodes, and a replica list that cannot pick a node twice — at O(N) hashes per lookup instead of O(log N).',
      topic: 'consistent-hashing',
    },
    {
      id: 'fc-ch-11',
      front: 'What is jump consistent hash good and bad at?',
      back: 'Good: perfect balance, zero state, very fast. Bad: only supports changing the bucket count at the end of the range, so you cannot remove a specific node.',
      topic: 'consistent-hashing',
    },
    {
      id: 'fc-ch-12',
      front: 'Does consistent hashing balance load?',
      back: 'It balances keys. Load follows only if key access is roughly uniform — a hot key still lands on one node and no ring construction splits a single key.',
      topic: 'consistent-hashing',
    },
    {
      id: 'fc-ch-13',
      front: 'What does consistent hashing not do for a rebalance?',
      back: 'It bounds how much moves; it does not move it. You still need online copying, throttling so production is not degraded, and a router handling keys in two places.',
      topic: 'rebalancing',
    },
    {
      id: 'fc-ch-14',
      front: 'Why can\'t a hash ring serve range queries?',
      back: 'Hashing destroys ordering, so adjacent keys land at unrelated ring positions. Range scans need explicit range assignment instead.',
      topic: 'hash-ring',
    },
  ],

  quiz: [
    {
      id: 'q-ch-1',
      kind: 'scenario',
      prompt:
        'A 10-node cache tier using `hash(key) % 10` gains an eleventh node. The origin database saturates within seconds. What is the mechanism?',
      options: [
        { id: 'a', label: 'About 90% of keys remap to different nodes at once, so the hit rate collapses from 95% to ~10% and origin read load multiplies roughly 18×' },
        { id: 'b', label: 'The new node is cold and cannot serve requests yet' },
        { id: 'c', label: 'Clients are unevenly distributing across eleven nodes' },
        { id: 'd', label: 'The hash function collides more often with eleven buckets' },
      ],
      correct: ['a'],
      explanation:
        '`hash(key) % 10` and `hash(key) % 11` agree for only about 1/11 of keys, so nearly everything changes owner simultaneously. The new node being cold accounts for 1/11 of the keyspace; the other ~80% of the damage is existing nodes losing keys they still hold. This is why modulo hashing makes capacity increases catastrophic.',
      difficulty: 'core',
      topic: 'rebalancing',
    },
    {
      id: 'q-ch-2',
      kind: 'scenario',
      prompt:
        'A ring with one position per node has 10 nodes. Monitoring shows one node at 90% CPU and another at 30%. Adding two more nodes does not fix the imbalance. Why?',
      options: [
        { id: 'a', label: 'Random single positions produce unequal arcs; the imbalance is a property of where the hashes landed, so more nodes just produce a new random imbalance' },
        { id: 'b', label: 'The hash function is not uniform enough' },
        { id: 'c', label: 'The hot node is holding a hot key' },
        { id: 'd', label: 'Nodes need to be manually positioned at equal intervals' },
      ],
      correct: ['a'],
      explanation:
        'With one position per node, arc sizes follow the distribution of gaps between random points, and the largest is typically two to three times the smallest. Adding nodes redraws the lottery rather than fixing it. Virtual nodes fix it because each physical node\'s share is the sum of many independent arcs, so variance falls as 1/√V.',
      difficulty: 'core',
      topic: 'virtual-nodes',
    },
    {
      id: 'q-ch-3',
      kind: 'scenario',
      prompt:
        'A cluster uses a ring with 200 virtual nodes per machine and replication factor 3, taking the next three positions clockwise. One machine is lost and some keys are down to a single copy. What happened?',
      options: [
        { id: 'a', label: 'Adjacent ring positions belonged to the same physical machine, so two of the three "replicas" were on it — the walk must skip physical nodes already chosen' },
        { id: 'b', label: 'The replication factor was misconfigured to 2' },
        { id: 'c', label: 'Two machines failed simultaneously' },
        { id: 'd', label: 'Virtual nodes are incompatible with replication' },
      ],
      correct: ['a'],
      explanation:
        'With 200 scattered positions per machine, two positions being adjacent is common. Taking the next three positions can therefore select the same machine twice. The fix is Dynamo\'s preference list: walk clockwise skipping positions whose physical node — and failure domain — is already in the list. Nothing surfaces this until a machine dies.',
      difficulty: 'advanced',
      topic: 'replication-placement',
    },
    {
      id: 'q-ch-4',
      kind: 'scenario',
      prompt:
        'A team must remove a specific failing node from a hashing scheme. Which construction cannot do it?',
      options: [
        { id: 'a', label: 'Jump consistent hash — it only supports changing the bucket count at the end of the range' },
        { id: 'b', label: 'A ring with virtual nodes' },
        { id: 'c', label: 'Rendezvous hashing' },
        { id: 'd', label: 'Explicit range assignment' },
      ],
      correct: ['a'],
      explanation:
        'Jump consistent hash maps a key to one of N numbered buckets and supports growing or shrinking N at the end, not removing an arbitrary bucket. The ring deletes that node\'s positions, rendezvous simply stops including the node in the weight computation, and explicit ranges are reassigned by hand. This is the constraint that decides whether jump hashing is usable for you.',
      difficulty: 'advanced',
      topic: 'consistent-hashing',
    },
    {
      id: 'q-ch-5',
      kind: 'scenario',
      prompt:
        'A ring with virtual nodes is in use, and one key accounts for 30% of all traffic. That key\'s node is saturated. What does adding nodes achieve?',
      options: [
        { id: 'a', label: 'Nothing for that key — it hashes to one position and no ring construction splits a single key; the remedy is bucketing or replicating that key' },
        { id: 'b', label: 'It spreads the key across more nodes proportionally' },
        { id: 'c', label: 'It halves the load on that node' },
        { id: 'd', label: 'It works if virtual node count is increased at the same time' },
      ],
      correct: ['a'],
      explanation:
        'Consistent hashing distributes keys, not load. A single key has one hash value and therefore one owner regardless of ring size or virtual node count. This is the partitioning lesson\'s hot-key conclusion: bucket the key so it becomes several keys, or replicate it to several nodes and read from any of them.',
      difficulty: 'core',
      topic: 'consistent-hashing',
    },
    {
      id: 'q-ch-6',
      kind: 'multi',
      prompt:
        'Which are true of virtual nodes? Select all that apply.',
      options: [
        { id: 'a', label: 'They tighten load balance because each node\'s share is the sum of many independent arcs' },
        { id: 'b', label: 'They allow capacity weighting by giving a larger machine more positions' },
        { id: 'c', label: 'They spread a failed node\'s load across many nodes rather than one neighbour' },
        { id: 'd', label: 'They reduce the fraction of keys that move on a membership change below 1/N' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are exactly why virtual nodes are mandatory rather than optional. The fourth is wrong: the fraction moved is still about 1/N — virtual nodes change *which* nodes it comes from and therefore how the resulting load is distributed, not how much moves.',
      difficulty: 'core',
      topic: 'virtual-nodes',
    },
  ],

  exercises: [
    {
      id: 'ex-ch-1',
      kind: 'design',
      title: 'Specify the ring, then survive the failures',
      estimatedMinutes: 25,
      prompt: `Specify the key placement for a distributed key-value cache. Facts:

- 24 machines across 3 availability zones, 8 per zone.
- Machines are two generations: 16 with 64 GB, 8 with 128 GB.
- Replication factor 3; a zone loss must not lose all copies of any key.
- 40,000 reads/s, 4,000 writes/s. Cache hit rate 94%. The origin can absorb about 3× its current read load.
- Clients are application servers holding the ring in memory.

Specify: the construction, the virtual node count and how you weight the two generations, the replica-placement rule, and how ring membership reaches clients.

Then answer:

- You add 4 machines. What is the miss-rate impact, and is the origin safe?
- One machine fails. What happens to keys, load, and replica counts?
- One zone fails. What happens?
- A client has a ring view 30 seconds stale. What does it do wrong?`,
      rubric: [
        'Ring with virtual nodes, with a stated count and the reason for that magnitude.',
        'Weighting by virtual node count proportional to capacity, with concrete numbers.',
        'Replica rule skips both physical node and availability zone, producing one replica per zone.',
        'Membership distribution mechanism named, with staleness behaviour considered.',
        'Scale-out impact computed numerically and compared against the origin\'s 3× headroom.',
        'Proposes gradual virtual-node introduction if the computed spike is near the limit.',
        'Machine-failure answer covers both cache misses and replica-count reduction, and re-replication load.',
        'Zone-failure answer concludes no key loses all copies, and quantifies the remaining capacity problem.',
        'Stale-ring answer identifies both wrong-node reads and split-brain writes, with a mitigation.',
      ],
      modelAnswer: `**Construction: hash ring with virtual nodes.**

*Why the ring rather than the alternatives:* I need arbitrary node removal (machines fail and are replaced individually), capacity weighting (two hardware generations), and an ordered replica list (for zone-aware placement and fallbacks). The ring gives all three. Rendezvous hashing would also work and gives perfect balance with no ring state — at 24 nodes its \`O(N)\` cost is trivial, so it is a genuinely reasonable alternative here and I would consider it. Jump hashing is out because I must remove specific nodes.

**Virtual nodes and weighting**

\`\`\`
64 GB machines  (16):  150 virtual nodes each  =  2,400
128 GB machines  (8):  300 virtual nodes each  =  2,400
                                        Total  =  4,800 positions
\`\`\`

*Why 150 as the base:* variance falls roughly as \`1/√V\`. At V = 150 the per-machine share lands within a few percent of its target, which is tight enough that no machine is meaningfully hotter than another. Below about 100 the tail starts to matter; far above 300 the state grows for no further benefit.

*Why 2× positions for 2× RAM:* a cache's capacity constraint is memory, and share of keyspace is proportional to virtual node count. So the 128 GB machines each hold twice the keys. Total effective capacity is 16×64 + 8×128 = 2,048 GB, and each hardware class holds exactly half the keyspace — which is what I want, since each class contributes half the memory.

*State cost:* 4,800 sorted positions on every client. A few hundred kilobytes, and lookup is a binary search over 4,800 entries — about 13 comparisons. Negligible.

**Replica placement: skip by physical node AND by zone**

\`\`\`
walk clockwise from hash(key):
  take the position's physical node if
    (a) that node is not already chosen, AND
    (b) that node's zone is not already chosen
  stop at 3
\`\`\`

With 3 zones and replication factor 3, condition (b) means **exactly one replica per zone.** That satisfies the requirement directly: a zone loss removes one copy from every key, never all three.

*Why condition (a) alone is not enough — the bug this avoids:* with 150–300 positions per machine, two adjacent positions belonging to the same machine is common. Taking the next three positions blindly can put two copies on one machine. Then replication factor reports 3, everything works, and losing that machine costs two of three copies. **Nothing surfaces this until a failure**, which is what makes it the commonest error in consistent hashing.

*Why condition (b) matters on top:* three distinct machines that happen to be in one zone still lose all three copies to a zone failure. Distinct machines is not distinct failure domains.

*I extend the list past 3* — continuing the walk to give an ordered set of fallbacks. That enables hinted handoff: if a replica is unavailable, the write goes to the next eligible node with a hint saying whose it is, and is forwarded when the intended replica returns. This is only possible because the ring gives an *ordered* list rather than just a set.

**Getting ring membership to clients**

A control plane holds authoritative membership. Clients fetch it on startup and then receive updates by long-poll or subscription, with a periodic refresh (say every 30 seconds) as a fallback.

Two properties I want:

**Versioned rings.** Each ring view carries a monotonic version. A client includes its version on requests, and a server that sees an old version can tell the client to refresh. This bounds staleness by traffic rather than by a timer, which is much tighter.

**Fail open on control-plane unavailability.** Keep the last known ring. A stale ring is mostly correct; no ring means no service. Same reasoning as the discovery lesson.

**Adding 4 machines: is the origin safe?**

Going from 24 to 28 machines. Fraction of keys moved ≈ 4/28 ≈ **14%**.

\`\`\`
Hit rate before:            94%
Keys that go cold:          14%
Hit rate immediately after: 94% × (1 - 0.14) ≈ 81%
Miss rate:                  6% → 19%
Origin read load:           19/6 ≈ 3.2× current
Origin headroom:            3×
\`\`\`

**So no — this is marginally over the limit, and I should not do it as a single step.**

*What I would do instead:* introduce each new machine with a fraction of its virtual nodes and raise it in stages.

\`\`\`
Stage 1: 4 machines × 40 vnodes  → ~4% of keys move → origin ~1.6×
Stage 2: raise to 100 vnodes     → cumulative ~9%   → origin ~2.4×
Stage 3: raise to 150 vnodes     → cumulative ~14%  → origin ~3.2×
\`\`\`

Each stage is followed by a wait for the cache to refill — a few minutes — before the next. Because the cache warms between stages, **the origin never sees the cumulative spike**; it sees each increment against an already-warm cache. Peak origin load stays under 2×.

This is the practical point worth stating: consistent hashing makes a scale-out *survivable*; gradual virtual-node introduction makes it *boring*. And it is only possible because virtual nodes give a continuous dial rather than an all-or-nothing switch — one more thing they buy that is rarely listed.

**One machine fails**

*Keys:* that machine held ~1/24 of the keyspace (or ~1/12 if it was a 128 GB machine). Those keys' primary is now the next eligible node clockwise for each of its ~150–300 arcs — **spread across many machines in the other two zones**, because the arcs were scattered. No single machine absorbs the whole share.

*Cache impact:* around 4–8% of keys lose their primary copy. But replication factor 3 means each of those keys still has 2 copies, so a read can be served from a replica. **The hit-rate impact is near zero if reads can fall back to replicas** — which is a design decision I would make explicitly, because a cache that reads only the primary would see a 4–8% miss spike here for no reason.

*Replica counts:* every key that had this machine among its three replicas is down to 2. Re-replication brings them back to 3, and that copying is load on the surviving machines. **This must be throttled** — an unthrottled re-replication after a failure is a classic way to turn one machine loss into a cluster problem.

*Zone balance:* the failed machine's share is inherited by machines in the other two zones. Because the replica rule enforces one copy per zone, the *new* third replica for affected keys must go to a machine in the failed machine's zone — of which 7 remain. Those 7 now hold what 8 held, a ~14% increase for that zone.

**One zone fails (8 machines)**

*Data:* **no key loses all copies.** The one-replica-per-zone rule guarantees every key retains 2 of 3 copies in the surviving zones. This is the requirement met by construction rather than by luck.

*Capacity:* one third of the machines and one third of the memory are gone. The remaining 16 machines must hold the whole working set, and they cannot — total memory drops from 2,048 GB to roughly 1,365 GB. **So the surviving cache evicts, and the hit rate falls** by whatever fraction of the working set no longer fits.

*Origin load:* this is the real risk, and it is larger than the machine-failure case. If the hit rate falls from 94% to, say, 88%, origin read load doubles. Survivable within 3× headroom, and it depends on how much of the working set the reduced memory can hold — which is a number I would want measured rather than estimated.

*What I would not do:* re-replicate to restore replication factor 3 within the two surviving zones. That would require placing two copies in one zone, violating the placement rule, and it would consume memory the cluster does not have. **Running at replication factor 2 across two zones until the third returns is the correct choice**, and it should be an explicit configured behaviour rather than something the system decides on its own. This is worth saying out loud because the instinct — restore the replication factor — makes things worse here.

**A client with a 30-second stale ring**

Two distinct problems, and the second is worse.

**Wrong-node reads.** The client asks a node that no longer owns the key. Result: a miss, and possibly a populate at the wrong node — which writes an entry nobody will look for and wastes memory. Bounded and mostly harmless.

**Split-brain writes, which are not harmless.** During a rebalance, key K is being moved from node A to node B. A stale client writes K to A; a current client writes K to B. Now two nodes hold different values for K and readers see one or the other depending on their ring view. For a cache this is a correctness bug that presents as flapping stale data — genuinely hard to diagnose because it depends on which client served the request.

*Mitigations, in order:*

1. **Version the ring and have servers reject stale-version requests** with a "refresh" response. This bounds staleness by request rate rather than by a 30-second timer, so a busy client is never stale for long.
2. **Have the node that no longer owns a key forward or reject** rather than serve it. A node knows its own arcs, so it can detect a request for a key it does not own.
3. **Make the move two-phase**: B starts accepting writes and A forwards to B before A stops serving reads, so there is no window where both accept independent writes.

*The general principle:* a client-side ring is a distributed cache of membership, and it has the same staleness problem as any cache. **The fix is not a shorter refresh interval — it is making the server authoritative about ownership**, so a stale client is corrected rather than merely eventually updated.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-ch-1',
      level: 'basic',
      question: 'What problem does consistent hashing solve?',
      guidance:
        'Modulo hashing remaps nearly every key when the node count changes. A strong answer gives the number — ~90% going from 10 to 11 — and names the consequence for a cache: an instant cold cache and a multiplied origin load.',
    },
    {
      id: 'iq-ch-2',
      level: 'basic',
      question: 'How does the hash ring work?',
      guidance:
        'Hash nodes and keys onto a circular space; a key belongs to the first node clockwise. Look for the lookup cost being a binary search, and for the movement property being 1/N.',
    },
    {
      id: 'iq-ch-3',
      level: 'intermediate',
      question: 'Why do you need virtual nodes?',
      guidance:
        'Random single positions produce two-to-three-times imbalance. A strong answer names all three benefits — balance, capacity weighting, spread failure load — and treats them as mandatory rather than an optimisation.',
    },
    {
      id: 'iq-ch-4',
      level: 'intermediate',
      question: 'How do you place three replicas on a ring?',
      guidance:
        'Walk clockwise skipping positions whose physical node is already chosen, and skipping by failure domain too. Look for awareness that the naive next-three-positions rule can put two copies on one machine.',
    },
    {
      id: 'iq-ch-5',
      level: 'advanced',
      question: 'You add four nodes to a 24-node cache. Is that safe?',
      guidance:
        'Compute it: ~14% of keys move, hit rate falls proportionally, origin load rises by the ratio of miss rates. Excellent answers compare against actual headroom and propose gradual virtual-node introduction when the number is marginal.',
    },
    {
      id: 'iq-ch-6',
      level: 'advanced',
      question: 'What are the alternatives to a hash ring, and when would you pick one?',
      guidance:
        'Rendezvous for perfect balance without virtual nodes at O(N); jump for stateless bucketing without arbitrary removal; Maglev where a remapped key breaks a connection; explicit ranges for per-key control. The selection criteria matter more than the list.',
    },
    {
      id: 'iq-ch-7',
      level: 'followup',
      question: 'A client has a stale ring view during a rebalance. What can go wrong?',
      guidance:
        'Wrong-node reads (a miss, bounded) and split-brain writes (two nodes holding different values for one key, which flaps). A strong answer makes the server authoritative about ownership rather than shortening the refresh interval.',
    },
    {
      id: 'iq-ch-8',
      level: 'followup',
      question: 'A zone fails and you are down to two replicas per key. Do you re-replicate?',
      guidance:
        'Not into the surviving zones — it would violate one-copy-per-zone placement and consume memory the reduced cluster does not have. Running at a lower replication factor until the zone returns is correct, and should be explicit configured behaviour.',
    },
  ],

  activeLearning: [
    {
      id: 'al-ch-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed clients hold the ring and compute placement themselves. Now change one thing: a routing tier holds the ring and clients know nothing about it. What improves, what gets worse, and what is unchanged?',
      discussion: `This is the difference between a client-side ring — Memcached clients, Cassandra drivers in token-aware mode — and a proxy tier that owns placement.

**What improves.**

**No stale-ring problem, or rather it is confined.** The split-brain write from the exercise disappears from the client population: only the proxy tier needs a current ring, and that is a small, controlled set of processes you can update quickly and consistently. This is the biggest single benefit, because stale-ring bugs are genuinely hard to diagnose.

**Membership changes are instant.** Update the proxy tier and every client is immediately correct. No waiting for propagation across hundreds of application servers in several languages.

**Clients get simpler.** No ring library, no hash function to keep identical across implementations. A Go client and a Python client cannot disagree about placement if neither computes it — and subtle hash-function mismatches between client libraries are a real class of bug.

**Rebalancing can be handled centrally.** During a move the proxy can serve from the old location, forward to the new one, or read both, entirely invisibly. Doing this correctly across many client libraries is much harder.

**What gets worse.**

**An extra hop on every request.** For a cache whose value proposition is sub-millisecond latency, adding a proxy round trip can be a large relative cost — potentially doubling the latency of the operation the cache exists to make fast.

**The proxy tier is a shared bottleneck.** Its capacity is your capacity, and it must be sized for aggregate peak. This is the gateway lesson's conclusion applied here.

**A new failure domain.** The proxy can fail, saturate or be misconfigured. It needs its own redundancy, health checking and load balancing — so you have added a tier to remove a distribution problem.

**Connection multiplication or multiplexing.** Either every client connects to every proxy and every proxy to every cache node, or you pool. Either way the connection topology is more complex than clients-to-nodes.

**What is entirely unchanged, and this is the point.**

**The ring, the virtual nodes, and the replica-placement rule.** All of it. Moving the computation does not change what is computed. The preference list still must skip physical nodes and failure domains; virtual nodes are still mandatory for balance and weighting; a membership change still moves 1/N of keys and still cold-caches that fraction.

**The rebalance itself.** Still online copying, still throttled, still a window where a key exists in two places.

**Hot keys.** Still one key, one node, no remedy from the ring.

**What I would do.** For a latency-critical cache, keep the ring client-side and solve staleness properly: version the ring, make servers authoritative about ownership so a stale client is corrected rather than merely serving wrong, and use a two-phase move. The extra hop is the thing I least want to pay for.

For a datastore where operations already cost milliseconds, a proxy tier is a good trade — the hop is a small relative cost and the operational simplification is large. This is why Vitess and similar systems are proxy-based while Memcached clients are not: **the right answer follows from how much latency headroom the operation has**, not from which design is cleaner.

**The transferable point.** Where a computation happens is an operational decision; what it computes is an architectural one. Consistent hashing's hard parts — placement correctness across failure domains, hot keys, the mechanics of moving data — are untouched by moving the ring. It is worth checking, whenever a design change feels like it solves a problem, whether it has actually moved the problem's location.`,
    },
    {
      id: 'al-ch-2',
      kind: 'debug',
      prompt:
        'A Cassandra-style cluster with 12 nodes, 256 virtual nodes each, replication factor 3, reports uneven disk usage: three nodes at 78% and the rest between 40% and 48%. All nodes have identical hardware and identical virtual node counts. Hypotheses?',
      discussion: `Identical hardware, identical virtual node counts, and yet three nodes hold roughly 70% more data than the rest. With 256 virtual nodes, random arc variance should be a few percent — so this is not the plain-ring imbalance problem. Something else is concentrating data.

**Hypothesis 1 — a large partition, not a large number of partitions.** The ring balances *partition keys*, not *bytes*. If a few partition keys hold enormously more data than others — a channel with a hundred million messages, a tenant with years of events — then the three nodes holding those keys (and their replicas) hold far more bytes. Three nodes at once is exactly what replication factor 3 predicts for **one** oversized partition.

*Why this fits best:* three nodes, not one. Replication factor 3 means one huge partition lands on precisely three nodes. The 3:1 correspondence is the strongest clue in the symptom.

*Check:* the largest partitions by size. Most such systems expose this directly, and it is usually a five-minute answer.

**Hypothesis 2 — accumulated tombstones or un-compacted data on those nodes.** If compaction has fallen behind on three nodes — because they are also the ones serving the hot partition, so they have less spare I/O — deleted data still occupies disk. This can compound hypothesis 1 rather than compete with it.

*Check:* pending compaction tasks and the ratio of live to total data per node.

**Hypothesis 3 — replica placement not skipping failure domains, concentrating replicas.** If the placement rule is not rack- or zone-aware, replicas can cluster on a subset of nodes. This would produce uneven replica counts and therefore uneven data. It would be a persistent structural imbalance rather than one caused by a specific partition.

*Check:* for a sample of partition keys, which nodes hold their replicas, and whether the distribution of replica counts across nodes is flat. This also happens to be the check that would catch the correctness bug from this lesson.

**Hypothesis 4 — snapshots or backups left on disk.** Operational residue: a snapshot taken before a schema change on three nodes and never cleaned up. Mundane and common, and it would show as a large gap between the data directory size and the reported live data size.

*Check:* disk usage by directory, not just total. This is cheap and worth doing early precisely because it is unglamorous.

**Hypothesis 5 — those three nodes joined the cluster differently.** If they were added later and streamed data in, or replaced failed nodes, they may hold ranges from the node they replaced plus their own. Less likely with automatic token assignment, and worth checking if the cluster has a history of node replacements.

*Check:* token ownership per node against the expected uniform share.

**What I would check first: the largest partitions by size.** It is one command, and hypothesis 1 both fits the 3-node signature precisely and is by far the most common cause of this symptom in ring-based stores. It also determines whether the fix is a data-model change or an operational one, which is the branch that matters.

**Then: disk usage by directory** (hypothesis 4, cheap and often the answer) and **token ownership per node** (hypothesis 5, and it also confirms the virtual nodes are doing their job).

**What the symptom rules out.** Plain-ring imbalance — 256 virtual nodes makes arc variance a few percent, not 70%. Hardware differences — stated identical. Weighting misconfiguration — virtual node counts stated identical. Eliminating these three immediately is what points at data skew rather than placement skew.

**The distinction this incident teaches.** Consistent hashing with virtual nodes gives you an even distribution of *keys*. It says nothing about the distribution of *bytes per key*, and nothing about the distribution of *requests per key*. Both are data-model properties. A store can be perfectly balanced by the ring's own measure and badly balanced in every way that matters operationally.

**So the monitoring conclusion:** track largest-partition size as a first-class metric, not disk usage alone. Disk usage tells you a problem exists; partition size tells you what it is. And a partition-size alert catches this weeks earlier, while it is a data-model conversation rather than a node running out of disk.`,
    },
  ],

  revision: {
    bullets: [
      '`hash(key) % N` remaps ~90% of keys going from 10 nodes to 11, which makes adding capacity an outage.',
      'Consistent hashing is a property: a membership change moves about `1/N` of keys. The ring is one construction.',
      'The ring: hash nodes and keys onto a circle; a key belongs to the first node clockwise. Lookup is a binary search.',
      'The plain one-position-per-node ring is unusable — random points cluster, giving two-to-three-times imbalance.',
      'Virtual nodes give balance (variance falls as 1/√V), free capacity weighting, and spread failure load.',
      'Virtual nodes also give a continuous dial, so a node can be introduced gradually to keep the miss-rate spike small.',
      'Taking the next R positions clockwise can put two replicas on one machine — adjacent positions can share a node.',
      'The preference list walks clockwise skipping physical nodes and failure domains already chosen.',
      'Three distinct machines in one zone still lose all three copies. Skip by failure domain, not just by node.',
      'An ordered fallback list beyond R enables hinted handoff, keeping writes possible during a failure.',
      'Rendezvous hashing: perfect balance, no ring state, ordered replicas, at O(N) per lookup.',
      'Jump consistent hash: stateless and fast, but cannot remove a specific node.',
      'Maglev: near-perfect balance with minimal disruption, for load balancing where a remap breaks a connection.',
      'Explicit ranges: per-key control and range queries preserved, at the cost of a mapping service.',
      'Consistent hashing distributes keys, not load. A hot key still lands on one node.',
      'It bounds how much data moves; the move still needs to be online, throttled, and handled by the router.',
      'The ring balances keys, not bytes per key or requests per key — both are data-model properties.',
      'A stale client ring causes wrong-node reads and split-brain writes; make the server authoritative about ownership.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A family of key-placement schemes with the property that adding or removing a node reassigns only about 1/N of keys, rather than nearly all of them.',
    whyItExists:
      'Because `hash(key) % N` remaps almost every key when N changes, making the routine operation of adding capacity into a cache-cold event or a full data migration.',
    whenToUse: [
      'Distributed caches, where a membership change must not empty the cache.',
      'Partitioned datastores that add and remove nodes without a planned resharding operation.',
      'Load balancers needing session or cache affinity that survives backend changes.',
    ],
    whenNotToUse: [
      'When range queries matter — hashing destroys ordering.',
      'When you need per-key placement control, such as a dedicated node for one large tenant.',
      'As a remedy for a hot key, which no ring construction splits.',
      'Without virtual nodes, which makes the plain ring imbalanced and its failures concentrated.',
    ],
    alternatives: [
      'Rendezvous hashing, for perfect balance with no ring state at tens of nodes.',
      'Jump consistent hash, for stateless numbered buckets when you only change the count.',
      'Maglev hashing, for load balancing where a remapped key breaks a live connection.',
      'Explicit range assignment, for per-key control and preserved ordering.',
    ],
    tradeoffs: [
      'The ring buys 1/N movement and costs ring state on every client plus a placement rule that must skip failure domains.',
      'More virtual nodes buy tighter balance and cost state and lookup time.',
      'A client-side ring buys a latency hop and costs a staleness problem across every client.',
      'A proxy tier buys instant membership changes and costs a hop and a shared bottleneck.',
      'Rendezvous buys perfect balance and costs O(N) hashing per lookup.',
    ],
    failureModes: [
      'Modulo hashing remapping nearly everything on a membership change.',
      'A plain ring with two-to-three-times imbalance that adding nodes does not fix.',
      'Two of three replicas on one physical machine, invisible until it fails.',
      'Three replicas in one availability zone, invisible until that zone fails.',
      'A failed node dumping its whole range on one clockwise neighbour, cascading.',
      'A scale-out spike exceeding origin headroom because 1/N still went cold at once.',
      'Unthrottled re-replication after a failure degrading the surviving cluster.',
      'A stale client ring causing split-brain writes that present as flapping stale reads.',
      'Even key distribution masking severe byte or request skew per key.',
    ],
    followUpQuestions: [
      'How many virtual nodes per physical node, and why that number?',
      'Does your replica walk skip physical nodes already chosen? And failure domains?',
      'What fraction of keys move when you add a node, and can your origin absorb that miss spike?',
      'Can you introduce a node gradually, or is it all at once?',
      'How does ring membership reach clients, and what happens when a client is stale?',
      'What is your largest partition by bytes, and by request rate?',
      'Is re-replication after a failure throttled?',
      'Do you ever need to remove a specific node, or only change the count?',
    ],
  },
});
