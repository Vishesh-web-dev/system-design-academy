import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-lru-cache',
  title: 'Design an LRU cache',
  summary:
    'The O(1) requirement chooses the data structures, and then the entire difficulty is keeping two of them consistent — which is why the eviction policy cannot own the ordering, why a read-write lock is wrong, and why sharding gives you a different cache.',
  phase: 'lld',
  module: 'machine-coding',
  position: 61,
  kind: 'machine-coding',
  difficulty: 'core',
  estimatedMinutes: 60,
  tags: ['invariants', 'data-structures', 'thread-safety', 'ttl'],
  prerequisites: ['l-patterns'],
  resources: [
    {
      key: 'caffeine-cache-wiki',
      tier: 'must',
      note: 'Read the eviction section. It is the best available account of why plain recency loses to frequency-aware policies on real workloads, and it gives you the scan-resistance answer that turns a follow-up question into a strength.',
    },
    {
      key: 'redis-expire',
      tier: 'must',
      note: 'Read the expiry semantics — lazy on access plus a sampling background pass. That combination is exactly the right answer for the TTL extension, and the reasoning for it is the same here as there.',
    },
    {
      key: 'python-lru-cache-docs',
      tier: 'good',
      note: 'A minimal real API worth reading for its choices: what maxsize means, what the statistics expose, and how little surface a useful cache needs. A good model for the interface you should present.',
    },
    {
      key: 'refactoring-guru-patterns',
      tier: 'good',
      note: 'Re-read strategy with this problem in mind. Pluggable eviction is the canonical example given for strategy, and the interesting part here is why the naive split — the policy owning the ordering list — breaks an invariant.',
    },
    {
      key: 'aws-caching-challenges',
      tier: 'advanced',
      note: 'Read it for what a cache does under adverse conditions. Useful for the trade-offs step, where "what happens when the working set exceeds capacity" is a question a strong answer anticipates.',
    },
  ],

  intuition: {
    body: `This problem looks like a data-structures exercise and the data structures are the easy part. **State the invariant and they are chosen for you:**

\`\`\`
get and put are O(1)
+ a recency order must be maintained
+ the least recently used entry must be findable in O(1)
\`\`\`

**O(1) lookup by key means a hash map.** O(1) removal of an arbitrary element from the middle of an ordering means **a doubly-linked list** — a singly-linked list cannot unlink a node without its predecessor, and an array cannot remove from the middle at all. **And the map must store the node, not the value**, or finding the node to move is a scan.

\`\`\`
map: key → node        (O(1) lookup)
list: node ⇄ node      (O(1) unlink, O(1) move to head)
\`\`\`

**That is the whole structural decision, and it takes thirty seconds.** The rest of the hour is about one thing: **those two structures must agree, always.**

\`\`\`
INVARIANT: map.size === list.length ≤ capacity
           every map value is a node in the list
           head is the most recently used
\`\`\`

**Every interesting decision in this problem is a consequence of that invariant.**

**It is why the eviction policy cannot own the list.** Split the map and the ordering across two objects and **an incorrect call order leaves them inconsistent** — a bug no type system catches and no single test targets.

**It is why a read-write lock is wrong.** \`get\` mutates the recency order, **so \`get\` is not a read** — and a lock that permits concurrent reads permits concurrent mutation of the list.

**And it is why sharding does not work the way you would hope.** A global recency order is global state; **split it by key and you no longer have one LRU cache, you have N smaller ones** with different eviction behaviour.

Then the case that separates working implementations from plausible ones: **putting a key that already exists.**

\`\`\`
put(a, 1)  → size 1
put(a, 2)  → must update the value, move a to head,
             and NOT increase the size, and NOT evict
\`\`\`

**Most first implementations get this wrong**, because the eviction check and the insert path are written together and the update path takes the same route. **It is the first thing an interviewer tests.**`,
    analogyLimit:
      '"It is a hash map with a size limit" is where the difficulty hides. A size limit implies a choice of what to drop, that choice requires an ordering, and maintaining an ordering in O(1) requires a second structure — at which point the problem becomes keeping two structures consistent under every operation, including the ones that look like reads. The framing also hides that get is a mutation, which is the fact that decides the concurrency answer.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate implements an LRU cache as a hash map from key to value plus an array of keys in access order: on get, find the key in the array and move it to the end; on put, append and drop the front if over capacity. They say both operations are O(1). What is wrong, and what does the correct structure look like?',
      answer: `**Two of the three claimed O(1) operations are not, and one behaviour is outright wrong.**

**\`get\` is O(n), not O(1).** Finding the key in the array requires a scan:

\`\`\`
array = [k1, k2, ..., kn]
get(k) → indexOf(k)          O(n)
       → splice out + push    O(n) again, because splice
                               shifts every later element
\`\`\`

**So a cache of 10,000 entries does up to 20,000 element operations per \`get\`** — which is worse than the naive alternative of no cache at all for many workloads.

**\`put\` on an existing key is also O(n)**, for the same reason.

**And eviction is O(n)**: \`shift\` from the front of an array moves every remaining element.

*The candidate's mistake is a common one:* **treating "array append and pop are O(1)" as if it extended to removal from the middle.** It does not, and the middle is where LRU spends its time.

**The behavioural bug: nothing keeps the array and the map consistent on the update path.**

\`\`\`
put(a, 1)   → map{a:1}, array [a]
put(a, 2)   → map{a:2}, array [a, a]     ← a appears twice
put(b, 1)   → over capacity → shift → drops the FIRST a
            → array [a, b], map{a:2, b:1}
            → the cache now believes a is newer than it is,
              and the array length no longer matches map size
\`\`\`

**So the invariant is broken silently**, and the symptom appears several operations later as a wrong eviction — which is the hardest kind of bug to trace.

**What the correct structure is, and why each piece is forced.**

\`\`\`
map:  key → NODE     not key → value.
      Storing the value means you still have to find the
      node to reorder it, which is the O(n) scan again.

list: DOUBLY linked. A singly-linked list cannot unlink a
      node without its predecessor, so unlink becomes O(n).

sentinels: a permanent head and tail node that hold no data.
      They remove every null check from unlink and insert —
      which is why the implementation is short.
\`\`\`

**The sentinel detail is worth volunteering.** Without them, every list operation needs special cases for the first element, the last element and the single-element list — **four branches per operation, and each is a place to be wrong.** With them there are none:

\`\`\`ts
private unlink(n: Node) {
  n.prev!.next = n.next;      // always safe: sentinels
  n.next!.prev = n.prev;      // guarantee both exist
}
\`\`\`

**And the corrected complexity:**

\`\`\`
get:   map lookup O(1) + unlink O(1) + insert at head O(1)
put:   same, plus eviction = unlink the node before tail O(1)
\`\`\`

**Every operation is a constant number of pointer writes**, which is what the requirement asked for.

**The transferable diagnostic: for each claimed O(1) operation, name the exact steps.** "Find the key" is where the scan hides, **and the fix is always the same — store a handle to the position rather than searching for it.**`,
    },
  body: `## Requirements and the invariant

**Ask four things, then state the invariant.**

\`\`\`
"Fixed capacity at construction, or resizable?"     → fixed
"Expiry as well as capacity eviction?"              → note it;
                                                       extension
"Thread-safe, or single-threaded?"                  → ask; it
                                                       changes the code
"Must eviction policy be pluggable?"                → usually no
\`\`\`

\`\`\`
INVARIANT
  map.size === list.length ≤ capacity
  every value in map is a node currently in the list
  list head = most recently used, list tail = least
  get and put are O(1)
\`\`\`

**And the scope declaration:** *"I will implement get, put, eviction and the update-existing-key path completely, with tests. I will note where a lock goes rather than implementing it unless you want it, and I will treat TTL as an extension."*

## The implementation

\`\`\`ts
class Node<K, V> {
  prev: Node<K, V> | null = null;
  next: Node<K, V> | null = null;
  constructor(public key: K, public value: V) {}
}

export class LruCache<K, V> {
  private readonly map = new Map<K, Node<K, V>>();
  // Sentinels: permanent, dataless, and they remove every
  // null check from the list operations below.
  private readonly head = new Node<K, V>(null as K, null as V);
  private readonly tail = new Node<K, V>(null as K, null as V);

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get size(): number { return this.map.size; }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToFront(node);          // a get IS a mutation
    return node.value;
  }

  put(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {                  // THE update path
      existing.value = value;
      this.moveToFront(existing);
      return;                        // no size change, no eviction
    }
    if (this.map.size >= this.capacity) this.evictLru();
    const node = new Node(key, value);
    this.map.set(key, node);
    this.insertAtFront(node);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.unlink(node);
    this.map.delete(key);
    return true;
  }

  // ── list primitives: each is a fixed number of writes ──
  private unlink(n: Node<K, V>): void {
    n.prev!.next = n.next;
    n.next!.prev = n.prev;
    n.prev = n.next = null;
  }

  private insertAtFront(n: Node<K, V>): void {
    n.next = this.head.next;
    n.prev = this.head;
    this.head.next!.prev = n;
    this.head.next = n;
  }

  private moveToFront(n: Node<K, V>): void {
    this.unlink(n);
    this.insertAtFront(n);
  }

  private evictLru(): void {
    const lru = this.tail.prev!;
    if (lru === this.head) return;   // empty; unreachable here
    this.unlink(lru);
    this.map.delete(lru.key);        // BOTH structures, together
  }
}
\`\`\`

**Four things to point at while writing it.**

**\`get\` calls \`moveToFront\`, so a read mutates.** Say it out loud when you write it — **it is the fact the concurrency question turns on**, and noticing it early is worth more than noticing it when asked.

**The update path returns early.** No size change, no eviction check. **This is the case an interviewer tests first.**

**\`evictLru\` touches both structures in one method.** Nothing else in the class removes an entry except \`delete\`, which also touches both. **Keeping every pairwise mutation in one place is how the invariant is maintained** — and it is the argument against splitting the ordering into a policy object.

**And \`capacity < 1\` throws at construction.** A capacity of zero would make every \`put\` evict what it just inserted; **rejecting it is better than defining that behaviour.**

## Tests derived from the invariant

\`\`\`ts
test('size never exceeds capacity', () => {
  const c = new LruCache<string, number>(2);
  c.put('a', 1); c.put('b', 2); c.put('c', 3);
  expect(c.size).toBe(2);
  expect(c.get('a')).toBeUndefined();      // a was the LRU
});

test('recency reflects access, not insertion', () => {
  const c = new LruCache<string, number>(2);
  c.put('a', 1); c.put('b', 2);
  c.get('a');                              // a becomes MRU
  c.put('c', 3);                           // so b is evicted
  expect(c.get('b')).toBeUndefined();
  expect(c.get('a')).toBe(1);
});

test('updating an existing key does not grow the cache', () => {
  const c = new LruCache<string, number>(2);
  c.put('a', 1); c.put('a', 2);
  expect(c.size).toBe(1);
  expect(c.get('a')).toBe(2);
});

test('capacity 1 degenerate case', () => {
  const c = new LruCache<string, number>(1);
  c.put('a', 1); c.put('b', 2);
  expect(c.get('a')).toBeUndefined();
  expect(c.get('b')).toBe(2);
});
\`\`\`

**The second test is the one that discriminates.** A first-in-first-out cache passes tests one, three and four — **only a mixed sequence with an interleaved \`get\` distinguishes LRU from FIFO**, and that is exactly what the invariant's "head is most recently used" clause claims.

**And the fourth test catches a specific bug class:** with capacity 1, insert-then-evict and evict-then-insert produce different results if the order is wrong.

## Pluggable eviction, and the trap in it

**If the prompt does not ask for it, do not build it.** If it does, the naive split is wrong and knowing why is the interesting part.

\`\`\`
Naive:  EvictionPolicy owns the ordering list
        Cache owns the map
        → two objects, one invariant
        → cache.put must call policy.onInsert in the right
          order, and nothing enforces that
        → an incorrect sequence leaves map and list disagreeing
\`\`\`

**The fix is to narrow what the policy decides.**

\`\`\`ts
interface EvictionPolicy<K> {
  onAccess(key: K): void;      // recency/frequency bookkeeping
  onInsert(key: K): void;
  onRemove(key: K): void;
  selectVictim(): K | undefined;
}
\`\`\`

**The policy keeps its own bookkeeping and chooses a victim; the cache still owns the map and performs every removal.** So the invariant becomes:

\`\`\`
every key in the map has been announced to the policy,
and every key the policy knows is in the map
\`\`\`

**Which is weaker and still needs a test** — one that puts and evicts through the cache and asserts the policy's key set matches the map's. **Say that the test exists**, because the whole point of the seam is that it introduces a consistency requirement the single-class version did not have.

*And the honest cost:* **an LRU policy under this interface maintains its own list, duplicating the node bookkeeping**, so the pluggable version is slower and larger than the fused one. **That is the price of the seam, and it is worth naming rather than hiding.**

## Thread safety

**One lock around \`get\`, \`put\` and \`delete\`. State the granularity and the reason.**

**Why not a read-write lock:** \`get\` moves a node to the front, **so it is a writer.** A read-write lock would allow several \`get\` calls to mutate the list concurrently, which corrupts it — **and the corruption is a torn linked list, which manifests as an infinite loop or a lost entry rather than a clean error.**

**Why not sharding by key hash:** this is the more interesting answer.

\`\`\`
16 shards, each its own map + list + lock
  → 16× less contention
  → and it is NO LONGER an LRU cache of size N
  → it is 16 LRU caches of size N/16
\`\`\`

**A hot key in shard 3 cannot evict a cold key in shard 7**, so an entry can be evicted while globally-colder entries survive. **Whether that matters is a workload question, not a correctness one** — and the answer is that production caches do exactly this, accepting approximate global recency for throughput.

*So the honest ranking:*

\`\`\`
Single lock      correct, simple, contention at high throughput
Sharded locks    approximate LRU, scales, what real caches do
Lock-free        possible with atomic pointer tricks; the
                 complexity is not justified in an interview
\`\`\`

**Saying "sharding changes the semantics and that is usually acceptable" is the answer that demonstrates understanding** — it is a trade rather than an optimisation.

## The TTL extension

**Two mechanisms, and they are complementary rather than alternatives.**

\`\`\`
Lazy expiry:   check expiresAt on get; if expired, remove and
               return undefined
               · zero background cost
               · an expired entry occupies capacity until touched
Active sweep:  sample keys periodically and remove expired ones
               · frees capacity sooner
               · costs a background pass
\`\`\`

\`\`\`ts
get(key: K, now: number): V | undefined {
  const node = this.map.get(key);
  if (!node) return undefined;
  if (node.expiresAt !== undefined && node.expiresAt <= now) {
    this.unlink(node); this.map.delete(key);   // lazy expiry
    return undefined;
  }
  this.moveToFront(node);
  return node.value;
}
\`\`\`

**Note \`now\` is a parameter.** That one change makes every expiry test an assertion rather than a sleep, **and it is the highest-value signature habit in these problems.**

**Then the interaction worth raising unprompted: an expired entry can be the most recently used.**

\`\`\`
put(a, 1, ttl 1s) at t=0     → a is MRU
at t=2, the cache is full:
  → LRU eviction evicts the TAIL, which may be a live entry
  → while a, expired and useless, sits at the head
\`\`\`

**So eviction should prefer expired entries when it can find them cheaply**, and the pragmatic form is: **on eviction, check the tail; if it is expired, remove it and continue; otherwise evict it anyway.** A full scan for expired entries would be O(n) and defeat the point.

*And the design question behind it:* **TTL and LRU are two orderings, and a single list cannot be sorted by both.** Maintaining a second ordering by expiry — a heap or a time-bucketed list — is the complete answer and rarely worth it. **Saying that is better than pretending one list does both.**

## Beyond LRU, for the follow-up

**Two questions come up, and both have short strong answers.**

**"What if the workload scans a large range once?"** A sequential scan of items never read again **evicts the entire working set** — classic LRU has no scan resistance.

\`\`\`
Fix: segmented LRU. A small probation segment takes new
     entries; an entry is promoted to the protected segment
     only on a second access. A scan fills probation and
     never touches the protected working set.
\`\`\`

**"What about frequency?"** LRU keeps a once-accessed entry over a thousand-times-accessed one that is slightly older. **Frequency-aware admission** — estimate a candidate's frequency and refuse to admit it if the victim is more frequent — **is what modern caches do**, and a compact sketch gives the estimate cheaply.

**Both answers say the same thing: recency alone is a weak signal, and the fix is admission control rather than a different eviction order.**

## What to say in the last three minutes

**The invariant, and that both structures are mutated in the same methods.**

**That \`get\` is a mutation**, which is why a single lock and not a read-write lock.

**That sharding changes the semantics to approximate LRU**, and that this is usually the right trade.

**What you left out:** TTL with its second-ordering problem, pluggable policies with their consistency test, and statistics.

**And one anticipated follow-up answered before it is asked:** scan resistance, or frequency-aware admission. **Volunteering the weakness of the thing you just built is the strongest available close.**`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'two-structures',
      title: 'Two structures, one invariant, and every decision that follows',
      caption:
        'Step through it. Everything interesting in this problem is a consequence of the map and the list having to agree — including the answers about locking and sharding.',
      nodes: [
        { id: 'inv', label: 'The invariant', kind: 'note', x: 0, y: 140, detail: 'map.size === list.length <= capacity; every map value is a node in the list; head is most recently used; get and put are O(1). Every decision below is a consequence of this.' },
        { id: 'map', label: 'map: key → NODE', kind: 'store', x: 240, y: 50, detail: 'Storing the node rather than the value is the point. Store the value and you still have to find the node to reorder it — which is the O(n) scan the naive array solution hides.' },
        { id: 'list', label: 'list: doubly linked, with sentinels', kind: 'store', x: 240, y: 220, detail: 'Doubly linked because a singly-linked list cannot unlink a node without its predecessor. Sentinels because they remove every null check — without them each operation needs four branches for first, last, single and empty.' },
        { id: 'fused', label: 'Both mutated in the same methods', kind: 'service', x: 510, y: 140, detail: 'evictLru and delete are the only paths that remove an entry, and each touches map and list together. Keeping every pairwise mutation in one place is how the invariant survives — and it is the argument against a policy object owning the list.' },
        { id: 'policy', label: 'If pluggable: narrow what the policy decides', kind: 'note', x: 760, y: 40, detail: 'The policy keeps its own bookkeeping and selects a victim; the cache still owns the map and performs every removal. The invariant weakens to "the policy knows exactly the map\'s keys" — which needs its own test, and the LRU policy then duplicates node bookkeeping. That is the price of the seam.' },
        { id: 'lock', label: 'get is a mutation → one lock', kind: 'note', x: 760, y: 170, detail: 'A read-write lock would let several gets mutate the list concurrently, and a torn doubly-linked list manifests as an infinite loop or a lost entry rather than a clean error.' },
        { id: 'shard', label: 'Sharding changes the semantics', kind: 'note', x: 760, y: 300, detail: '16 shards is not an LRU cache of size N — it is 16 caches of size N/16, so a hot key in one shard cannot evict a colder key in another. Approximate global recency for throughput, which is what production caches choose.' },
      ],
      edges: [
        { id: 'c1', source: 'inv', target: 'map', kind: 'control' },
        { id: 'c2', source: 'inv', target: 'list', kind: 'control' },
        { id: 'c3', source: 'map', target: 'fused', kind: 'control' },
        { id: 'c4', source: 'list', target: 'fused', kind: 'control' },
        { id: 'c5', source: 'fused', target: 'policy', kind: 'control' },
        { id: 'c6', source: 'fused', target: 'lock', kind: 'control' },
        { id: 'c7', source: 'lock', target: 'shard', kind: 'control' },
      ],
      steps: [
        {
          id: 'cs1',
          title: 'The invariant picks the structures in thirty seconds',
          description:
            'O(1) lookup means a hash map. O(1) removal from the middle of an ordering means a doubly-linked list. And the map must hold the node, or reordering needs a scan.',
          nodes: ['inv', 'map', 'list'],
          edges: ['c1', 'c2'],
        },
        {
          id: 'cs2',
          title: 'Then the hour is about keeping them consistent',
          description:
            'Every removal path touches both structures in one method. Sentinels make the pointer writes unconditional, which is why the code is short enough to be correct.',
          nodes: ['fused'],
          edges: ['c3', 'c4'],
        },
        {
          id: 'cs3',
          title: 'Which is the argument against the naive policy split',
          description:
            'A policy owning the list means two objects and one invariant, with nothing enforcing call order. Narrow it to victim selection and the cost is duplicated bookkeeping — real, and worth naming.',
          nodes: ['policy'],
          edges: ['c5'],
        },
        {
          id: 'cs4',
          title: 'And why a read-write lock is wrong',
          description:
            'get moves a node to the front, so it is a writer. Concurrent gets under a read lock tear the list, and a torn list loops rather than erroring.',
          nodes: ['lock'],
          edges: ['c6'],
        },
        {
          id: 'cs5',
          title: 'Sharding is a semantic trade, not an optimisation',
          description:
            'Splitting the recency order splits the cache. Approximate LRU is usually the right choice — and saying it is a trade rather than a speedup is the answer that shows understanding.',
          nodes: ['shard'],
          edges: ['c7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'put-paths',
      title: 'The three paths through put, and the one people get wrong',
      caption:
        'Read the middle branch carefully. It is the case an interviewer tests first, and the one a naive implementation routes through the insert path.',
      code: `flowchart TB
    P["**put(key, value)**"]
    P --> Q{"key already<br/>in the map?"}

    Q -->|"YES — **the update path**"| U["update node.value<br/>moveToFront(node)<br/>**return**"]
    U --> UN["**No size change.<br/>No eviction check.**<br/>Routing this through the<br/>insert path is the most<br/>common bug, and it shows<br/>up as a wrong eviction<br/>several operations later."]

    Q -->|"NO"| F{"size >=<br/>capacity?"}
    F -->|"NO"| I["new Node<br/>map.set<br/>insertAtFront"]
    F -->|"YES"| E["**evictLru()**<br/>unlink(tail.prev)<br/>map.delete(lru.key)<br/>← BOTH structures,<br/>one method"]
    E --> I

    I --> OK["size increased by 1<br/>invariant holds"]
    UN --> OK2["size unchanged<br/>invariant holds"]

    T["**The test that catches it:**<br/>put(a,1); put(a,2)<br/>→ assert size === 1<br/>→ assert get(a) === 2"]
    UN -.-> T

    style U fill:#17272a,stroke:#35897e
    style UN fill:#1c1814,stroke:#c99a4e
    style T fill:#1c1814,stroke:#c99a4e
    style E fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The published documentation for a production Java caching library is the most useful reference here, because it says plainly what a hand-rolled LRU gets wrong on real workloads.

**Its central claim is that recency alone is a weak eviction signal**, and it gives two specific failure modes.

**Scan resistance.** A sequential pass over many items read once **evicts the entire working set** under classic LRU, because every scanned item becomes the most recently used. The documented remedy is **admission control**: a new entry must earn its place rather than being admitted automatically.

**And frequency.** LRU keeps an item accessed once five minutes ago over an item accessed a thousand times six minutes ago. **A frequency estimate, maintained cheaply in a compact sketch, lets the cache refuse to admit a candidate that is less frequent than the victim it would displace.**

**The second thing worth taking from it is the segmented structure.** New entries go to a small probation area and are promoted only on a second access, **so a scan churns probation and never disturbs the protected segment** — which is a structural answer to the first failure mode rather than a tuning parameter.

**Three transferable lessons.**

**Eviction has two decisions, not one: what to remove, and whether to admit.** Classic LRU only answers the first, **and most of the real improvement comes from the second** — which is not obvious and is the strongest thing to say in a follow-up.

**Approximate global ordering is acceptable in production.** These libraries do not maintain a strict global recency order under concurrency; **they buffer accesses and apply them in batches**, which is the same trade as sharding.

**And a cache's hit rate is a workload property.** Any claim about policy quality is a claim about a workload — **so the right answer to "which policy is better" is a question about the access pattern.**

**Where the reference does not help.** It describes a mature library with years of tuning, and an interview wants a correct LRU in twenty minutes. **Proposing a frequency sketch and a segmented structure as your primary design is over-reach** — the right use is as the answer to "what are the weaknesses of what you built", which is a question you should invite.`,
  },

  tradeoffs: {
    intro:
      'The decisions this problem turns on, most of which follow from having two structures that must agree.',
    rows: [
      {
        option: 'Hash map plus an array of keys in access order',
        whenItWins:
          'Nowhere at any size. It is the intuitive first answer.',
        whenItLoses:
          'Finding a key is a scan and removing from the middle shifts elements, so get and put are both O(n).',
        cost:
          'The stated complexity requirement, plus a silent invariant break on the update path.',
      },
      {
        option: 'Hash map to node plus a doubly-linked list',
        whenItWins:
          'Always. Every operation is a fixed number of pointer writes.',
        whenItLoses:
          'Two structures that must be kept consistent, which is the whole difficulty.',
        cost:
          'A node object per entry, and discipline about mutating both together.',
      },
      {
        option: 'A singly-linked list',
        whenItWins:
          'Nowhere here.',
        whenItLoses:
          'Unlinking a node requires its predecessor, so removal from the middle is O(n).',
        cost:
          'The O(1) guarantee.',
      },
      {
        option: 'No sentinel nodes',
        whenItWins:
          'Marginally less memory.',
        whenItLoses:
          'Every list operation needs branches for first, last, single-element and empty — four places to be wrong per method.',
        cost:
          'Longer, more conditional code, which is where bugs live.',
      },
      {
        option: 'A min-heap keyed by last-access timestamp',
        whenItWins:
          'When you also need "the k least recently used" or expiry ordering.',
        whenItLoses:
          'Both access and eviction become O(log n), and updating a key\'s priority is O(log n) too.',
        cost:
          'The O(1) requirement, for flexibility nobody asked for.',
      },
      {
        option: 'Eviction policy owning the ordering list',
        whenItWins:
          'Nowhere. It looks like a clean strategy application.',
        whenItLoses:
          'It splits one invariant across two objects, so an incorrect call order leaves the map and list disagreeing.',
        cost:
          'A consistency bug no type system catches.',
      },
      {
        option: 'Policy narrowed to victim selection',
        whenItWins:
          'When the prompt requires pluggable policies.',
        whenItLoses:
          'The LRU policy duplicates node bookkeeping, so it is slower and larger than the fused version.',
        cost:
          'Duplication, plus a test asserting the policy\'s keys match the map\'s.',
      },
      {
        option: 'A read-write lock',
        whenItWins:
          'A genuinely read-only cache with no recency tracking.',
        whenItLoses:
          'get moves a node, so concurrent gets under a read lock tear the list.',
        cost:
          'Corruption that manifests as an infinite loop, not an error.',
      },
      {
        option: 'A single mutex',
        whenItWins:
          'Correct and simple, and right for most interview answers.',
        whenItLoses:
          'Contention at high throughput, since every operation serialises.',
        cost:
          'Throughput ceiling proportional to one lock.',
      },
      {
        option: 'Sharded locks',
        whenItWins:
          'High throughput, and it is what production caches do.',
        whenItLoses:
          'It is N smaller caches, so a hot key cannot evict a globally colder key in another shard.',
        cost:
          'Approximate global recency — a semantic change, not just a speedup.',
      },
      {
        option: 'Lazy TTL expiry only',
        whenItWins:
          'Most cases. Zero background cost.',
        whenItLoses:
          'An expired entry occupies capacity until someone touches it.',
        cost:
          'Effective capacity below nominal when expiry is common.',
      },
      {
        option: 'Lazy plus a sampled active sweep',
        whenItWins:
          'When expired entries would otherwise hold significant capacity.',
        whenItLoses:
          'A background pass to schedule and tune.',
        cost:
          'CPU for sampling, and a sweep interval to choose.',
      },
      {
        option: 'A second ordering by expiry',
        whenItWins:
          'When expiry-ordered eviction genuinely matters.',
        whenItLoses:
          'Two orderings over one dataset, so every mutation maintains both.',
        cost:
          'A heap or time buckets alongside the list — rarely worth it.',
      },
      {
        option: 'Classic LRU with no admission control',
        whenItWins:
          'Workloads with a stable working set and no scans.',
        whenItLoses:
          'A single sequential scan evicts the whole working set, and a once-read entry displaces a frequently-read one.',
        cost:
          'Hit rate on realistic workloads.',
      },
      {
        option: 'Segmented LRU with frequency-aware admission',
        whenItWins:
          'Real production workloads — scans churn probation and never disturb the protected segment.',
        whenItLoses:
          'Substantially more machinery than an interview requires.',
        cost:
          'A sketch, a promotion rule, and tuning — the right answer to "what are the weaknesses", not the primary design.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"A hash map for the values plus an array of keys in access order — on get I move the key to the end."',
      whyWeak:
        'Finding the key in the array is a scan and removing from the middle shifts every later element, so get and put are both O(n) rather than O(1). It also duplicates keys on the update path, which breaks the size invariant silently and surfaces later as a wrong eviction.',
      strongAnswer:
        '"A hash map from key to node, plus a doubly-linked list of nodes. The map holds the node rather than the value, because otherwise I still have to find the node to reorder it — which is the scan again. Doubly linked because unlinking needs the predecessor. And I would add head and tail sentinels so the list operations have no null checks: without them every operation needs branches for first, last, single and empty."',
    },
    {
      weakAnswer: '"put checks whether the cache is full, evicts if needed, then inserts the new entry."',
      whyWeak:
        'It routes an update of an existing key through the insert path, so putting the same key twice either grows the size or evicts something unnecessarily. This is the first case an interviewer tests.',
      strongAnswer:
        '"put branches first on whether the key already exists. If it does, I update the value, move the node to the front and return — no size change and no eviction check. Only a genuinely new key reaches the capacity check. And the test for it is put(a,1); put(a,2); assert size is 1 and the value is 2, because that is the path a naive implementation gets wrong."',
    },
    {
      weakAnswer: '"For thread safety I would use a read-write lock so multiple gets can proceed in parallel."',
      whyWeak:
        'get moves a node to the front of the recency list, so it is a writer. Several concurrent gets under a read lock mutate the list simultaneously, and a torn doubly-linked list shows up as an infinite loop or a lost entry rather than a clean failure.',
      strongAnswer:
        '"A single mutex around get, put and delete, because get is a mutation — it reorders the list — so there are no pure readers to optimise for. If throughput needed more, I would shard by key hash, and I would say explicitly that this changes the semantics: sixteen shards is sixteen LRU caches of capacity N over 16, not one of capacity N, so a hot key cannot evict a globally colder key in another shard. That is what production caches do, and it is a trade rather than an optimisation."',
    },
    {
      weakAnswer: '"I will make eviction pluggable with an EvictionPolicy that owns the ordering list."',
      whyWeak:
        'It splits one invariant across two objects. The cache owns the map and the policy owns the list, so an incorrect call order leaves them disagreeing — and nothing in the types prevents it.',
      strongAnswer:
        '"If pluggable policies are required I would narrow what the policy decides: it does its own bookkeeping on access and insert, and selects a victim, but the cache still owns the map and performs every removal. The invariant then becomes that the policy knows exactly the map\'s keys, which needs its own test. And the cost is real — an LRU policy under that interface maintains its own list, duplicating the node bookkeeping, so it is slower than the fused version. If the prompt does not ask for pluggable policies I would keep it as one class."',
    },
    {
      weakAnswer: '"For TTL I would check the system clock when reading an entry and drop it if expired."',
      whyWeak:
        'Reading a global clock makes every expiry test require a sleep, so those tests are slow and generally do not get written — which means the expiry path ships untested. It also ignores that an expired entry can be the most recently used and therefore safe from LRU eviction.',
      strongAnswer:
        '"I would pass the current time in as a parameter, so every expiry test is an assertion rather than a sleep. Lazy expiry on read is the base mechanism, and I would add a sampled background sweep if expired entries were holding significant capacity. And there is an interaction worth naming: an expired entry can sit at the head of the recency list while eviction removes a live entry from the tail, so on eviction I check whether the tail is expired first. A full scan for expired entries would be O(n), and maintaining a second ordering by expiry is the complete answer that is rarely worth it — one list cannot be sorted by both recency and expiry."',
    },
    {
      weakAnswer: '"LRU is a good general-purpose eviction policy, so this design is complete."',
      whyWeak:
        'Recency alone is a weak signal, and the weaknesses are specific: a single sequential scan evicts the entire working set, and a once-accessed entry displaces a frequently-accessed one that is slightly older.',
      strongAnswer:
        '"Recency alone has two known weaknesses I would raise before you ask. A sequential scan of items read once evicts the whole working set, and the structural fix is a segmented cache where new entries land in a small probation area and are promoted only on a second access. And LRU ignores frequency, so a frequency estimate kept in a compact sketch lets the cache refuse to admit a candidate less frequent than the victim it would displace. The general point is that eviction has two decisions — what to remove and whether to admit — and classic LRU only answers the first."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lru-1',
      front: 'What is the LRU cache invariant?',
      back: 'map.size equals list length, at most capacity; every map value is a node in the list; head is most recently used; get and put are O(1).',
      topic: 'invariants',
    },
    {
      id: 'fc-lru-2',
      front: 'Why must the map store the node rather than the value?',
      back: 'Otherwise you still have to find the node to reorder it, which is an O(n) scan — the hidden cost in every naive solution.',
      topic: 'data-structures',
    },
    {
      id: 'fc-lru-3',
      front: 'Why doubly linked rather than singly linked?',
      back: 'Unlinking a node requires its predecessor. A singly-linked list makes removal from the middle O(n).',
      topic: 'data-structures',
    },
    {
      id: 'fc-lru-4',
      front: 'What do sentinel head and tail nodes buy?',
      back: 'No null checks in any list operation. Without them each operation needs branches for first, last, single-element and empty.',
      topic: 'data-structures',
    },
    {
      id: 'fc-lru-5',
      front: 'Why is a min-heap on last-access time the wrong structure?',
      back: 'Access, eviction and priority updates all become O(log n), which fails the stated requirement for flexibility nobody asked for.',
      topic: 'data-structures',
    },
    {
      id: 'fc-lru-6',
      front: 'What is the update-existing-key path, and why does it matter?',
      back: 'Update the value, move to front, return — no size change and no eviction. It is the case a naive implementation routes through insert, and the first one tested.',
      topic: 'invariants',
    },
    {
      id: 'fc-lru-7',
      front: 'Which single test distinguishes LRU from FIFO?',
      back: 'put a, b; get(a); put(c) — assert b was evicted. A mixed sequence with an interleaved get; FIFO passes all the others.',
      topic: 'invariants',
    },
    {
      id: 'fc-lru-8',
      front: 'Why can the eviction policy not own the ordering list?',
      back: 'It splits one invariant across two objects, so an incorrect call order leaves map and list disagreeing — a bug no type catches.',
      topic: 'invariants',
    },
    {
      id: 'fc-lru-9',
      front: 'What does a narrowed eviction-policy interface look like, and what does it cost?',
      back: 'onAccess, onInsert, onRemove, selectVictim — the cache still owns the map and all removals. Cost: the LRU policy duplicates node bookkeeping.',
      topic: 'invariants',
    },
    {
      id: 'fc-lru-10',
      front: 'Why is a read-write lock wrong here?',
      back: 'get moves a node to the front, so it is a writer. Concurrent gets under a read lock tear the list, which loops rather than erroring.',
      topic: 'thread-safety',
    },
    {
      id: 'fc-lru-11',
      front: 'What does sharding by key hash actually change?',
      back: 'It makes N caches of capacity C/N rather than one of capacity C, so a hot key cannot evict a globally colder key elsewhere. Approximate LRU for throughput.',
      topic: 'thread-safety',
    },
    {
      id: 'fc-lru-12',
      front: 'What are the two TTL mechanisms and their costs?',
      back: 'Lazy expiry on read — zero background cost, expired entries hold capacity until touched. Sampled active sweep — frees capacity sooner, costs a background pass.',
      topic: 'ttl',
    },
    {
      id: 'fc-lru-13',
      front: 'What is the TTL-versus-LRU interaction?',
      back: 'An expired entry can be the most recently used, so LRU evicts a live entry from the tail while a useless one sits at the head. One list cannot be sorted by both orderings.',
      topic: 'ttl',
    },
    {
      id: 'fc-lru-14',
      front: 'What are LRU\'s two known weaknesses, and the fixes?',
      back: 'No scan resistance — fix with a segmented probation area promoting on second access. And it ignores frequency — fix with frequency-aware admission control.',
      topic: 'data-structures',
    },
  ],

  quiz: [
    {
      id: 'q-lru-1',
      kind: 'scenario',
      prompt:
        'A candidate uses a hash map plus an array of keys in access order and claims O(1) operations. Which operations are actually O(n)?',
      options: [
        { id: 'a', label: 'get, put on an existing key, and eviction — finding a key is a scan, and removing from the middle or front shifts elements' },
        { id: 'b', label: 'Only eviction, because shift is O(n)' },
        { id: 'c', label: 'Only get, because put appends' },
        { id: 'd', label: 'None — array append and pop are O(1)' },
      ],
      correct: ['a'],
      explanation:
        'All three. The scan to find a key is the hidden cost, and splice or shift moves every later element. Option d is the specific misconception: "append and pop are O(1)" is true and does not extend to the middle, which is exactly where LRU spends its time.',
      difficulty: 'core',
      topic: 'data-structures',
    },
    {
      id: 'q-lru-2',
      kind: 'scenario',
      prompt:
        'Capacity is 2. The sequence is put(a,1), put(a,2), put(b,1). What must the cache contain?',
      options: [
        { id: 'a', label: 'a=2 and b=1, size 2 — the second put updated a rather than inserting it' },
        { id: 'b', label: 'b=1 only, because a was evicted when the cache filled' },
        { id: 'c', label: 'a=2 and b=1, size 3' },
        { id: 'd', label: 'a=1 and b=1, because the first value wins' },
      ],
      correct: ['a'],
      explanation:
        'The update path must not change the size or trigger eviction. Option b is what a naive implementation produces when the update is routed through insert — the size hits capacity, something is evicted, and a duplicate entry appears in the ordering.',
      difficulty: 'core',
      topic: 'invariants',
    },
    {
      id: 'q-lru-3',
      kind: 'scenario',
      prompt:
        'Why is a read-write lock the wrong choice for an LRU cache?',
      options: [
        { id: 'a', label: 'get moves a node to the front, so it is a writer — concurrent gets under a read lock would tear the list' },
        { id: 'b', label: 'Read-write locks are slower than mutexes' },
        { id: 'c', label: 'Because the hash map is not thread-safe' },
        { id: 'd', label: 'It is correct — gets only read the value' },
      ],
      correct: ['a'],
      explanation:
        'The recency update makes get a mutation, so there are no pure readers to optimise for. And the failure mode is nasty: a torn doubly-linked list manifests as an infinite loop or a lost entry rather than a clean error, so the corruption is hard to attribute.',
      difficulty: 'core',
      topic: 'thread-safety',
    },
    {
      id: 'q-lru-4',
      kind: 'scenario',
      prompt:
        'You shard the cache into 16 independent maps and lists, each with its own lock. What changed besides contention?',
      options: [
        { id: 'a', label: 'It is now 16 LRU caches of capacity C/16, so a hot key cannot evict a globally colder key in another shard' },
        { id: 'b', label: 'Nothing — the eviction behaviour is identical' },
        { id: 'c', label: 'The complexity becomes O(log n) per operation' },
        { id: 'd', label: 'The invariant no longer holds' },
      ],
      correct: ['a'],
      explanation:
        'Splitting the recency order splits the cache, so global recency becomes approximate — which is a semantic change rather than a speedup, and it is what production caches accept for throughput. The per-shard invariant still holds, and complexity is unchanged.',
      difficulty: 'advanced',
      topic: 'thread-safety',
    },
    {
      id: 'q-lru-5',
      kind: 'scenario',
      prompt:
        'With TTL added, a short-lived entry is inserted and then expires. The cache is now full. What happens under plain LRU eviction?',
      options: [
        { id: 'a', label: 'A live entry is evicted from the tail while the expired one sits near the head — so eviction should check the tail for expiry first' },
        { id: 'b', label: 'The expired entry is evicted first, since it is useless' },
        { id: 'c', label: 'Nothing is evicted, because the expired entry frees space automatically' },
        { id: 'd', label: 'The cache scans for expired entries before evicting' },
      ],
      correct: ['a'],
      explanation:
        'Recency and expiry are two different orderings and one list cannot be sorted by both. Option d is the tempting fix and it is O(n), defeating the point — the pragmatic answer is to check the tail cheaply, and a second ordering by expiry is the complete answer that is rarely worth its cost.',
      difficulty: 'advanced',
      topic: 'ttl',
    },
    {
      id: 'q-lru-6',
      kind: 'multi',
      prompt:
        'Which of these are genuine weaknesses of classic LRU? Select all that apply.',
      options: [
        { id: 'a', label: 'A sequential scan of once-read items evicts the entire working set' },
        { id: 'b', label: 'A once-accessed entry can displace a frequently-accessed slightly older one' },
        { id: 'c', label: 'Eviction answers what to remove but never whether to admit' },
        { id: 'd', label: 'Its operations are not actually O(1)' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first two are the documented failure modes on real workloads, and the third is the framing that unifies them — most of the improvement in modern caches comes from admission control rather than a different eviction order. Option d is false: with a map to nodes plus a doubly-linked list, every operation is a fixed number of pointer writes.',
      difficulty: 'core',
      topic: 'data-structures',
    },
  ],

  exercises: [
    {
      id: 'ex-lru-1',
      kind: 'implement',
      title: 'Extend it three ways, and say which extension breaks the shape',
      estimatedMinutes: 45,
      prompt: `Starting from the LRU cache in this lesson, implement three extensions. For each, write the code and say whether it is an addition or a modification.

**Part 1 — TTL.** Per-entry expiry, with the clock injected. Handle the expired-entry-at-the-head interaction.

**Part 2 — a size-aware capacity.** Capacity is measured in bytes rather than entries; each entry declares a weight. Eviction removes entries until the total weight fits.

**Part 3 — \`getOrCompute(key, loader)\`.** If the key is absent, compute the value, store it, and return it. Two callers requesting the same missing key must not both run the loader.

**Part 4.** One of the three extensions does not fit the existing shape cleanly. Identify it, say why, and give the honest options.

Then answer:

- Which extension required changing the invariant, and how did you restate it?
- For Part 3, what happens if the loader throws?`,
      rubric: [
        'TTL uses an injected clock and handles lazy expiry on read.',
        'Addresses the expired-at-head interaction without an O(n) scan.',
        'Weight-based capacity restated as an invariant over summed weights.',
        'Recognises that weighted eviction is a loop, not a single removal.',
        'getOrCompute prevents duplicate loader execution with a stated mechanism.',
        'Identifies getOrCompute as the extension that breaks the shape, with reasoning.',
        'Gives honest options including their costs.',
        'Correctly restates the invariant for the weighted case.',
        'Handles a throwing loader without poisoning the cache.',
      ],
      modelAnswer: `**Part 1 — TTL: an addition, with one modification to eviction**

\`\`\`ts
class Node<K, V> {
  prev: Node<K, V> | null = null;
  next: Node<K, V> | null = null;
  constructor(
    public key: K,
    public value: V,
    public expiresAt: number | undefined,   // ← added
  ) {}
}

get(key: K, now: number): V | undefined {
  const node = this.map.get(key);
  if (!node) return undefined;
  if (this.isExpired(node, now)) {
    this.removeNode(node);                  // lazy expiry
    return undefined;
  }
  this.moveToFront(node);
  return node.value;
}

put(key: K, value: V, now: number, ttlMs?: number): void {
  const expiresAt = ttlMs === undefined ? undefined : now + ttlMs;
  const existing = this.map.get(key);
  if (existing) {
    existing.value = value;
    existing.expiresAt = expiresAt;         // a put RESETS the ttl
    this.moveToFront(existing);
    return;
  }
  if (this.map.size >= this.capacity) this.evictOne(now);
  const node = new Node(key, value, expiresAt);
  this.map.set(key, node);
  this.insertAtFront(node);
}

private isExpired(n: Node<K, V>, now: number): boolean {
  return n.expiresAt !== undefined && n.expiresAt <= now;
}

private removeNode(n: Node<K, V>): void {
  this.unlink(n);
  this.map.delete(n.key);
}

// The one MODIFICATION: eviction now prefers expired entries,
// but only as far as it can do so in O(1) amortised.
private evictOne(now: number): void {
  let candidate = this.tail.prev!;
  let checked = 0;
  while (candidate !== this.head && checked < EXPIRY_PROBE) {
    if (this.isExpired(candidate, now)) { this.removeNode(candidate); return; }
    candidate = candidate.prev!;
    checked++;
  }
  const lru = this.tail.prev!;              // nothing expired nearby
  if (lru !== this.head) this.removeNode(lru);
}
\`\`\`

**Three decisions worth defending.**

**A \`put\` on an existing key resets its TTL.** Not obvious — the alternative is to preserve the original expiry — **and I would ask.** Resetting is the common semantics (the entry was refreshed), but "cache this for exactly 60 seconds from first write" is a legitimate requirement, **and the two produce very different behaviour under repeated writes.**

**Eviction probes a bounded number of nodes from the tail** rather than scanning for expired entries. **A full scan is O(n) and defeats the point; a bounded probe is O(1) with a constant** — and it catches the common case where expired entries have drifted toward the tail anyway.

**The expired-at-head case is accepted, not solved.** An entry inserted with a 1-second TTL and read at 0.5 seconds sits at the head and is invisible to a tail probe. **It will be reclaimed lazily on its next read, or by a sweeper if I add one** — and the honest statement is that capacity is therefore an upper bound on *live* entries rather than an exact count.

*Addition or modification:* **an addition to the node and both operations, plus one real modification to \`evictOne\`.** The list and map structures are untouched.

---

**Part 2 — weight-based capacity: a modification, and the invariant changes**

\`\`\`ts
class Node<K, V> {
  constructor(
    public key: K,
    public value: V,
    public weight: number,                  // ← added
  ) {}
}

export class WeightedLruCache<K, V> {
  private readonly map = new Map<K, Node<K, V>>();
  private totalWeight = 0;                  // ← the new state

  constructor(
    private readonly maxWeight: number,
    private readonly weigher: (v: V) => number,
  ) {}

  put(key: K, value: V): void {
    const weight = this.weigher(value);
    if (weight > this.maxWeight) return;    // ← unadmittable

    const existing = this.map.get(key);
    if (existing) {
      this.totalWeight += weight - existing.weight;   // DELTA
      existing.value = value;
      existing.weight = weight;
      this.moveToFront(existing);
      this.evictUntilFits();                // ← an update can
      return;                               //   now overflow!
    }

    const node = new Node(key, value, weight);
    this.map.set(key, node);
    this.insertAtFront(node);
    this.totalWeight += weight;
    this.evictUntilFits();
  }

  private evictUntilFits(): void {
    while (this.totalWeight > this.maxWeight && this.map.size > 1) {
      const lru = this.tail.prev!;
      if (lru === this.head) break;
      this.totalWeight -= lru.weight;
      this.removeNode(lru);
    }
  }
}
\`\`\`

**Three things this reveals.**

**Eviction becomes a loop rather than a single removal.** Inserting a 5 MB entry into a 10 MB cache full of 100 KB entries **evicts fifty of them.** A single \`evictLru()\` call is no longer sufficient, and **that is the first thing to notice.**

**An update can now overflow the cache.** \`put(a, smallValue)\` followed by \`put(a, hugeValue)\` **increases total weight without adding an entry** — so the update path needs the eviction check that the unweighted version deliberately skipped. **The exact thing that was wrong before is now required**, which is a nice illustration of how an invariant change propagates.

**And an entry heavier than the whole cache is unadmittable.** Without the guard, \`evictUntilFits\` would empty the cache and still not fit — **so it must be rejected up front**, and I kept \`map.size > 1\` in the loop as a second defence.

*Addition or modification:* **a genuine modification.** It changes the invariant, the update path, eviction's shape, and adds a weigher dependency.

---

**Part 3 — getOrCompute, and the concurrency requirement**

\`\`\`ts
private readonly inFlight = new Map<K, Promise<V>>();

async getOrCompute(key: K, loader: (k: K) => Promise<V>,
                   now: number): Promise<V> {
  const hit = this.get(key, now);
  if (hit !== undefined) return hit;

  const pending = this.inFlight.get(key);
  if (pending) return pending;              // ← the second caller
                                            //   joins, not loads
  const promise = loader(key)
    .then(value => { this.put(key, value, now); return value; })
    .finally(() => { this.inFlight.delete(key); });

  this.inFlight.set(key, promise);
  return promise;
}
\`\`\`

**The mechanism is a second map of in-flight promises**, and the second caller for the same key receives the first caller's promise rather than invoking the loader. **This is the cache-stampede fix from the caching lesson, in miniature.**

**Two details that matter.**

**\`finally\` removes the in-flight entry whether the loader succeeded or failed.** Leaving a rejected promise in the map would make every subsequent caller receive the same failure forever — **a poisoned key.**

**And the value is stored by the first caller only**, inside the \`then\`. Every joiner gets the value without touching the cache, **so there is exactly one \`put\` per load.**

---

**Part 4 — which extension breaks the shape, and why**

**\`getOrCompute\` does, and the reason is that it makes the cache asynchronous and stateful in a second dimension.**

\`\`\`
TTL:       adds a field and a check. The class stays
           synchronous and holds one kind of state.
Weighting: changes the invariant. The class stays
           synchronous and holds one kind of state.
getOrCompute: the class now holds TWO kinds of state —
           entries and in-flight loads — with different
           lifetimes, and its API becomes asynchronous.
\`\`\`

**Three specific consequences.**

**The single-mutex concurrency answer stops being sufficient.** A lock cannot be held across an awaited loader — **that would serialise all cache access behind one slow load** — so the lock protects the map operations and the in-flight map separately, and **the check-then-insert on \`inFlight\` must itself be atomic** or two callers both start loading.

**The invariant gains a clause about a set the cache does not own.** In-flight keys are neither present nor absent: **\`get\` returns undefined while a load is pending**, so a caller using \`get\` and a caller using \`getOrCompute\` see different worlds.

**And failure becomes a first-class case.** A cache with no loader cannot fail; **one that computes values can**, which means the API needs to express failure and the caller needs a policy for it.

**The honest options.**

**(a) Keep it, and accept that the class does two things.** Simplest, and it is what most real caching libraries do — **the loading cache is a distinct type in several of them**, which is the tell that it is a different abstraction.

**(b) Wrap it: a \`LoadingCache\` that composes an \`LruCache\`.** The cache stays synchronous and single-purpose; **the loading and stampede-prevention logic lives in the wrapper.** *This is what I would build*, because it keeps the invariant-critical code free of asynchrony and the wrapper is independently testable.

**(c) Push it out entirely:** the caller does get, load, put. **Simplest of all, and it loses stampede prevention** — which was the actual requirement, so this fails.

*I would say:* **"this one I would compose rather than extend — the eviction invariant is the part that must be exactly right, and I do not want asynchrony in the same class as the pointer manipulation."**

---

**Which extension changed the invariant, and the restatement**

**Weighting, and the restatement is more than a substitution.**

\`\`\`
Before:
  map.size === list.length <= capacity

After:
  map.size === list.length
  AND sum of node weights === totalWeight
  AND totalWeight <= maxWeight
  AND no admitted entry has weight > maxWeight
\`\`\`

**The second clause is the new risk, and it is the interesting one.** \`totalWeight\` is a cached aggregate of data held elsewhere, **so it can drift** — and the ways it drifts are specific:

\`\`\`
· an update that adds the new weight without subtracting
  the old (the delta bug)
· a removal path that forgets to decrement
· a weigher that is not deterministic for the same value
\`\`\`

**That last one is worth calling out.** If \`weigher(v)\` returns different numbers for the same value — say it measures a serialised size that varies — **then the stored weight and a recomputed weight disagree, and the sum drifts permanently.** So the weigher must be deterministic, **and the weight is recorded on the node rather than recomputed on removal.**

*And the test that guards it:* **after a mixed sequence of puts, updates, gets and evictions, assert that \`totalWeight\` equals the sum of the nodes' weights.** That is the invariant-check test, and it is exactly the kind that catches a drift bug the operation-level tests miss — **the same shape as the ledger lesson's zero-sum check, at a much smaller scale.**

**TTL, by contrast, weakened the invariant rather than changing it:** capacity became an upper bound on live entries rather than an exact count, **because an expired entry occupies a slot until it is touched.** Worth saying, because it is a real semantic change that looks like an implementation detail.

---

**What if the loader throws?**

**Three things must happen, and only the first is obvious.**

**The in-flight entry must be removed.** Handled by \`finally\`. **Without it, a single transient failure poisons the key permanently** — every later caller receives the same rejected promise, and nothing ever retries.

**Nothing must be cached.** No entry is inserted, because \`put\` is inside the \`then\`. **A failure must not become a cached value**, and it must not become a cached *absence* either — **negative caching is a separate decision with its own TTL**, and doing it accidentally is worse than not doing it.

**And every joined caller must receive the failure.** They share the promise, so they all reject — **which is correct, and it has a consequence worth naming: one failed load fails N callers.** Without the in-flight sharing, each would have retried independently and some might have succeeded.

*So the trade is explicit:* **stampede prevention converts N independent attempts into one shared attempt, which means one shared failure.** For an expensive loader that is the right trade; **for a flaky one it amplifies failures**, and the mitigation is a retry inside the loader rather than in the cache.

*And a fourth consideration if the loader is slow as well as failing:* **a load that hangs holds the in-flight entry indefinitely**, so every subsequent caller joins a promise that never settles. **A timeout on the in-flight entry is the fix**, and it is the same stored-deadline idea as everywhere else in this course — **a bounded wait rather than an unbounded one.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lru-1',
      level: 'basic',
      question: 'Design and implement an LRU cache with O(1) get and put.',
      guidance:
        'Look for the invariant stated first, then a hash map to nodes plus a doubly-linked list with sentinels. A candidate who reaches for an array has not checked what each claimed O(1) step actually costs.',
    },
    {
      id: 'iq-lru-2',
      level: 'basic',
      question: 'Why a doubly-linked list?',
      guidance:
        'Unlinking needs the predecessor. Strong answers also explain why the map stores the node rather than the value, and volunteer the sentinel trick.',
    },
    {
      id: 'iq-lru-3',
      level: 'intermediate',
      question: 'What happens on put of a key that already exists?',
      guidance:
        'Update, move to front, return — no size change and no eviction. This is the first case to test, and the test is put(a,1); put(a,2); assert size 1.',
    },
    {
      id: 'iq-lru-4',
      level: 'intermediate',
      question: 'Make it thread-safe.',
      guidance:
        'A single mutex, because get is a mutation. Look for the rejection of a read-write lock with that reason rather than a performance argument.',
    },
    {
      id: 'iq-lru-5',
      level: 'advanced',
      question: 'That single lock is a bottleneck. What now?',
      guidance:
        'Shard by key hash, and state that it becomes N caches of capacity C/N — approximate global recency. Excellent answers call it a semantic trade, not an optimisation.',
    },
    {
      id: 'iq-lru-6',
      level: 'advanced',
      question: 'Now add per-entry TTL expiry.',
      guidance:
        'Injected clock, lazy expiry on read, optional sampled sweep. Excellent answers raise the expired-at-head interaction and note that one list cannot be sorted by two orderings.',
    },
    {
      id: 'iq-lru-7',
      level: 'followup',
      question: 'Make the eviction policy pluggable.',
      guidance:
        'Narrow the policy to victim selection; the cache keeps the map and all removals. Look for the consistency test and for naming the duplicated bookkeeping as the cost.',
    },
    {
      id: 'iq-lru-8',
      level: 'followup',
      question: 'What are the weaknesses of what you just built?',
      guidance:
        'No scan resistance and no frequency awareness, with segmented admission as the fix. The strongest candidates volunteer this before being asked.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lru-1',
      kind: 'debug',
      prompt:
        'An LRU cache in production occasionally returns a value for a key that was never put, and occasionally a get hangs forever consuming CPU. Both are rare and neither reproduces in tests. The single-threaded unit tests all pass. Diagnose it.',
      discussion: `**"Hangs forever consuming CPU" is the diagnostic detail**, and it names the failure class before any hypothesis: **that is a cycle in the linked list**, and a traversal following \`next\` pointers round a loop.

Combined with "single-threaded tests pass" and "rare", **this is a data race on the list.** The question is which one.

**Hypothesis 1 — a read-write lock, with \`get\` under the read lock.**

\`get\` calls \`moveToFront\`, which performs four pointer writes. **Two concurrent gets both unlink and reinsert**, and interleaved writes produce a list where a node's \`next\` eventually points backwards.

\`\`\`
Thread A: unlink(x)  — sets x.prev.next = x.next
Thread B: unlink(y)  — reads y.prev, which A is mutating
→ a pointer left dangling or cyclic
→ traversal loops; CPU pegs
\`\`\`

**And it explains the other symptom too.** A corrupted list means \`map\` and list disagree, **so a node reachable in the map may have been unlinked, or a node's key may no longer match what the map believes** — which surfaces as a value returned for an unexpected key.

*Why it never reproduces in tests:* single-threaded tests exercise no interleaving at all. **This is the design-level bug from the lesson, arriving as a production incident.**

*Check:* the lock type and which operations take which mode. **If \`get\` takes a read lock, the diagnosis is done** — no further investigation needed.

**Hypothesis 2 — no lock at all, and a single-threaded assumption that stopped holding.**

The cache was written for a single-threaded context and is now shared. **Identical symptoms**, and the fix is the same.

*Check:* how many threads or event-loop contexts touch it. **Worth checking because the fix differs in urgency** — an unlocked cache is corrupting constantly and only rarely visibly.

**Hypothesis 3 — the map and list are mutated in separate places, so a partial failure leaves them inconsistent.**

If some path removes from the map without unlinking (or the reverse):

\`\`\`
map.delete(k)  succeeds
unlink(node)   throws, or is skipped on an early return
→ an orphaned node still in the list
→ eviction reaches it, deletes map[node.key] — which is
  now a DIFFERENT entry, or absent
→ a subsequent get returns a value for a key that was
  never put under it
\`\`\`

**This explains the wrong-value symptom without any concurrency**, which makes it worth checking even though it does not explain the hang.

*Check:* every path that removes an entry. **There should be exactly one**, and anything else — an expiry path, a clear, a resize — is a candidate. **The lesson's insistence that both structures be mutated in the same method exists precisely for this.**

**Hypothesis 4 — a mutable key.** If keys are objects whose hash or equality depends on mutable fields, **a key mutated after insertion becomes unfindable in the map while its node remains in the list.**

\`\`\`
put(keyObj, v)      → map keyed by keyObj's current hash
keyObj.field = ...  → hash changes
get(keyObj)         → miss, though the node is still listed
eviction            → map.delete(node.key) deletes nothing
→ the map and list sizes drift apart permanently
\`\`\`

*Why it fits "rare":* it requires a caller to mutate a key after use. *Check:* whether keys are primitives. **If they are, eliminate this immediately; if they are objects, it is a strong candidate** and the fix is defensive copying or a documented requirement for immutable keys.

**Hypothesis 5 — reentrancy through a callback.** If the cache invokes anything caller-supplied while holding the list mid-mutation — an eviction listener, a weigher, a loader — **that callback can call back into the cache** and mutate the list while a pointer update is half-complete. **The same corruption as a data race, in a single thread.**

*Check:* any callback invoked from inside \`evictLru\`, \`put\` or \`get\`. **The fix is to invoke callbacks after the structural mutation completes**, which is the same discipline as dispatching observer notifications outside a transition.

**What I would check first: the lock type and \`get\`'s mode.** One code read, and hypotheses 1 and 2 are the only ones that explain a CPU-pegged hang. **A cycle in a doubly-linked list is essentially always a concurrent mutation** — nothing in single-threaded code creates one unless the pointer arithmetic itself is wrong, and the tests would have caught that.

**Then: enumerate the removal paths.** Hypothesis 3 explains the wrong-value symptom independently, and **it is possible both bugs exist** — the wrong values and the hangs need not share a cause.

**Why "single-threaded tests pass" is the most informative fact.**

It tells you the pointer logic is correct. **The unlink and insert operations produce a valid list when nothing else is touching it**, so the bug is not in the algorithm — **it is in the assumption that nothing else is touching it.**

**And that reframes the whole investigation from "find the wrong pointer write" to "find the unsynchronised access."** A more precise version of the observation: **the tests prove the operations are individually correct, and say nothing about whether they compose.**

**The instrumentation this demands.**

**An invariant check, runnable on demand.** Walk the list from head to tail with a step limit, counting nodes and verifying each node is in the map at its own key, then compare against \`map.size\`.

\`\`\`
· node count === map.size
· every listed node is map.get(node.key)
· traversal terminates within map.size + 2 steps
\`\`\`

**That third clause detects a cycle without hanging**, and the whole check is cheap enough to run in staging continuously or behind a flag in production. **This is the single highest-value addition** — it converts a rare mysterious symptom into a specific alert.

**A concurrency test, which the suite is missing.** Many threads doing random gets and puts, then the invariant check. **It would have caught hypothesis 1 immediately**, and it is a dozen lines.

**A removal-path audit as a code invariant**, not a metric: every removal goes through one method, and that method touches both structures. **Anything else is a bug waiting for load.**

**And a bounded traversal everywhere.** Any loop over the list should have a step limit that logs and aborts. **A corrupted structure should produce an error rather than consuming a core** — the hang is worse than the wrong value, because it takes the process with it.

**Transferable:** when a data structure that passes single-threaded tests corrupts under load, **the bug is in the synchronisation assumption rather than the algorithm** — and the fix that prevents recurrence is an executable invariant check plus a concurrency test, because those are the two things the existing suite structurally could not express.`,
    },
    {
      id: 'al-lru-2',
      kind: 'what-changes-if',
      prompt:
        'Change the requirement: the cache must be distributed across a cluster of servers rather than living in one process. Which parts of this design survive, and what replaces the ones that do not?',
      discussion: `**Almost nothing structural survives, and tracing why is more instructive than the parts that do** — because every element of the single-process design depends on cheap shared memory.

**What survives conceptually.**

**The invariant's *shape*** — a bounded store with an eviction ordering — is still the goal.

**The update-existing-key discipline**, though it becomes a different problem: **a distributed cache still must not double-count an entry**, and now the race is between nodes rather than threads.

**And the eviction weaknesses survive intact.** Scan resistance and frequency awareness are properties of the policy, not of the deployment, **so segmented admission is still the answer to "what are the weaknesses"** — and it is if anything more important, since a distributed cache is more expensive to miss.

**What does not survive, and what replaces it.**

**The doubly-linked list is gone.** It is a pointer structure over shared memory, and **there is no shared memory.** Maintaining a global recency order across a cluster would require a coordinated write per read:

\`\`\`
Every get must update the global ordering
  → every read becomes a write to shared state
  → a read-heavy cache becomes write-bound
  → and the ordering becomes the bottleneck and the
    single point of failure
\`\`\`

**So strict global LRU is not merely expensive; it inverts the cache's purpose.** A cache exists to make reads cheap, **and coordinating reads makes them expensive.**

*What replaces it:* **per-node approximate LRU**, which is the sharding answer from the lesson taken to its conclusion. Each server keeps its own map and ordering for the keys it owns, **so the cluster is N independent caches** and global recency is not merely approximate — it does not exist as a concept.

**Consistent hashing replaces the map.** In-process, "which structure holds this key" was trivial. **In a cluster it is a routing decision**, and the requirement is that adding or removing a node moves as few keys as possible — which is exactly what consistent hashing with virtual nodes provides. *And the consequence:* **a node joining or leaving invalidates the entries that move**, so scaling the cache costs a partial cold start.

**The lock is replaced by "no coordination at all", deliberately.** A distributed lock per operation would cost a network round trip on the hot path, **which is unacceptable for a cache.** So the answer is that **each key has one owning node, and that node's local lock is the only synchronisation** — key ownership replaces locking, which is a much better trade.

*And what this gives up:* **two clients writing the same key race at the owning node**, resolved by last-write-wins. **For a cache that is fine** — the value is derivable from the source of truth — **which is the property that makes all of this acceptable.**

**TTL survives and becomes more important.** Lazy expiry still works per node, **and now TTL is the primary correctness mechanism rather than a convenience**: with no way to invalidate coherently across the cluster, **a bounded staleness window is what keeps the cache honest.**

**What is genuinely new.**

**The stampede problem changes scale.** In-process, the in-flight promise map prevented duplicate loads within one process. **Across a cluster, N nodes can each load the same key simultaneously** after an eviction or a restart — so the single-flight mechanism has to be per key *per cluster*, which needs coordination at exactly the moment you were avoiding it.

*The pragmatic answers:* **route each key to one owner so single-flight is local again** (which key-ownership already gives you), or **accept N duplicate loads and make them cheap**, or **use a short-lived marker in the cache itself** as a best-effort lock. **The first is why key ownership is the load-bearing decision.**

**Invalidation becomes the hard problem.** In-process, \`delete(key)\` is exact. **In a cluster it must reach every node that might hold the key** — which, with key ownership, is one node, **and that is another reason ownership beats replication for a cache.**

**And a cold node is a new failure mode.** A restarted node owns its keys and holds none of them, **so its keys miss until refilled** — the cold-cache stampede from the HLD phase, arriving in a low-level design.

**What I would actually build.**

\`\`\`
Routing:      consistent hashing with virtual nodes
Per node:     exactly the cache from this lesson —
              map + doubly-linked list + one lock
Ordering:     per node only; no global recency
Consistency:  last-write-wins, bounded by TTL
Single-flight: local, which key ownership makes correct
Eviction:     per node, with segmented admission
\`\`\`

**And the observation worth leading with: the single-process design becomes the per-node implementation.** The linked list, the sentinels, the update path and the single lock all survive **inside one node** — what disappears is the pretence that the cluster has one ordering.

**The transferable point:** when a design depends on cheap shared mutable state, **distributing it does not scale the design — it replaces the coordination with partitioning.** The in-process structure survives as the per-partition implementation, **and the global property it guaranteed (strict LRU) is the thing you give up** — which is acceptable here only because a cache's contents are derivable, and would not be for a ledger.`,
    },
  ],

  revision: {
    bullets: [
      'The invariant picks the structures: O(1) lookup means a hash map, O(1) middle removal means a doubly-linked list.',
      'The map stores the node, not the value — otherwise reordering needs a scan.',
      'Doubly linked, because unlinking requires the predecessor.',
      'Sentinel head and tail nodes remove every null check from the list operations.',
      'An array of keys is O(n) for get, update and eviction — the scan and the shift.',
      'A heap on last-access time makes everything O(log n), including priority updates.',
      'The update-existing-key path returns early: no size change, no eviction check.',
      'Only a mixed sequence with an interleaved get distinguishes LRU from FIFO.',
      'Every removal path touches map and list in the same method — that is how the invariant survives.',
      'The eviction policy cannot own the ordering: two objects, one invariant, no enforcement of call order.',
      'Narrowed to victim selection it works, at the cost of duplicated bookkeeping and a consistency test.',
      'get is a mutation, so a read-write lock is wrong and a torn list loops rather than erroring.',
      'Sharding makes N caches of capacity C/N — approximate global recency, which is a semantic trade.',
      'TTL: lazy expiry on read, plus a sampled sweep if expired entries hold capacity.',
      'Inject the clock, so every expiry test is an assertion rather than a sleep.',
      'An expired entry can be the most recently used — one list cannot be sorted by recency and expiry.',
      'Classic LRU has no scan resistance: a sequential pass evicts the whole working set.',
      'Eviction has two decisions — what to remove and whether to admit — and LRU answers only the first.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A fixed-capacity cache with O(1) get and put, implemented as a hash map from key to node plus a doubly-linked list with sentinels, where every operation mutates both structures together and a get is a mutation.',
    whyItExists:
      'Because a size limit implies choosing what to drop, that choice needs an ordering, and maintaining an ordering in O(1) needs a second structure — so the problem is really about keeping two structures consistent under every operation.',
    whenToUse: [
      'A map to nodes plus a doubly-linked list whenever O(1) access and O(1) reordering are both required.',
      'Sentinels whenever list operations would otherwise need empty and boundary cases.',
      'A single mutex whenever a read path mutates state.',
      'Sharded locks when throughput matters more than exact global ordering.',
      'Lazy expiry with an injected clock whenever entries have a TTL.',
    ],
    whenNotToUse: [
      'An array of keys in access order.',
      'A map to values rather than to nodes.',
      'A singly-linked list.',
      'A heap keyed by access time, when O(1) is required.',
      'A read-write lock.',
      'An eviction policy that owns the ordering list.',
      'A full scan for expired entries during eviction.',
      'Pluggable policies the prompt never requested.',
    ],
    alternatives: [
      'Segmented LRU with a probation area, for scan resistance.',
      'Frequency-aware admission with a compact sketch, when recency alone loses hit rate.',
      'Weight-based capacity with an eviction loop, when entries differ in size.',
      'A composed loading cache wrapper, rather than adding asynchrony to the cache itself.',
      'Consistent hashing with per-node caches, when the cache must be distributed.',
    ],
    tradeoffs: [
      'Two structures buy O(1) on every operation and cost a consistency requirement.',
      'Sentinels buy unconditional pointer writes and cost two dataless nodes.',
      'A single lock buys correctness and simplicity and costs throughput.',
      'Sharding buys throughput and costs exact global recency.',
      'Lazy expiry buys zero background cost and costs capacity held by expired entries.',
      'A narrowed policy seam buys pluggability and costs duplicated bookkeeping.',
      'Admission control buys hit rate on real workloads and costs substantial machinery.',
    ],
    failureModes: [
      'An O(n) scan hidden inside a claimed O(1) get.',
      'An update routed through the insert path, growing the size or evicting unnecessarily.',
      'A duplicated key in the ordering after an update.',
      'A read-write lock letting concurrent gets tear the list.',
      'A cycle in the list, which pegs a core rather than raising an error.',
      'A removal path that touches only one of the two structures.',
      'A mutable key whose hash changes after insertion.',
      'A callback invoked mid-mutation, re-entering the cache.',
      'An expired entry at the head while a live entry is evicted from the tail.',
      'A rejected in-flight promise left in the map, poisoning a key.',
      'A sequential scan evicting the entire working set.',
    ],
    followUpQuestions: [
      'What exactly does each claimed O(1) step do?',
      'Does the map store the node or the value?',
      'What happens on put of an existing key?',
      'Which test distinguishes this from a FIFO cache?',
      'How many places remove an entry, and do they all touch both structures?',
      'Is get a mutation?',
      'What does sharding change besides contention?',
      'Is the clock injected?',
      'Can an expired entry be the most recently used?',
      'What happens when the working set exceeds capacity, or a scan runs?',
      'Does eviction ever decide whether to admit?',
    ],
  },
});
