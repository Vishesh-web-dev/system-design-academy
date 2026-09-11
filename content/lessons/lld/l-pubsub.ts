import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-pubsub',
  title: 'Design an in-process pub/sub',
  summary:
    'One question decides the whole design: what happens to a slow subscriber? With no network to absorb the mismatch, the answer is a per-subscription queue with a stated drop policy — and every other decision follows from that.',
  phase: 'lld',
  module: 'machine-coding',
  position: 64,
  kind: 'machine-coding',
  difficulty: 'core',
  estimatedMinutes: 60,
  tags: ['backpressure', 'delivery-guarantees', 'ordering', 'subscriptions'],
  prerequisites: ['l-logger'],
  resources: [
    {
      key: 'redis-pubsub',
      tier: 'must',
      note: 'Read it for a deliberately at-most-once design: messages are not persisted and a slow or absent subscriber simply misses them. It is the clearest statement of what you buy by refusing to buffer on the subscriber\'s behalf.',
    },
    {
      key: 'kafka-consumer-groups',
      tier: 'must',
      note: 'Read it for ordering guaranteed per partition rather than per topic. That is the same trade you face here — ordering per subscription requires serial handling, so parallelism costs ordering unless you partition by key.',
    },
    {
      key: 'kafka-delivery-semantics',
      tier: 'good',
      note: 'Read it for the decomposition of exactly-once into at-least-once plus idempotent application. The same argument as the payments lesson, and it is what to say when someone asks for exactly-once delivery in process.',
    },
    {
      key: 'rabbitmq-tutorials',
      tier: 'good',
      note: 'Read the topic-exchange tutorial for wildcard routing semantics. Useful for deciding whether pattern subscriptions are worth their per-publish matching cost, and for the vocabulary to describe what you chose.',
    },
    {
      key: 'aws-load-shedding',
      tier: 'advanced',
      note: 'Read it for shedding as a deliberate act rather than a failure. A bounded queue that drops and counts is the same idea, and the interesting variant here is shedding the subscriber rather than the message.',
    },
  ],

  intuition: {
    body: `Publishing to several subscribers looks like the observer pattern with topics, and **it is, until one subscriber is slower than the publisher.** That single case decides the entire design, because **there is no network in the middle to absorb the mismatch.**

\`\`\`
Publisher: 10,000 messages/second
Subscriber A: handles 10,000/second   fine
Subscriber B: handles 100/second      ← the design question
\`\`\`

**Three answers, and they are not equivalent.**

**Block the publisher.** Now the publisher runs at the speed of its slowest subscriber, **so adding a subscriber slows down the thing being observed** — which is usually unacceptable and always surprising.

**An unbounded queue per subscriber.** The publisher stays fast and B's queue grows at 9,900 messages per second, **so the process runs out of memory** — the failure is deferred rather than avoided.

**A bounded queue per subscriber, which drops.** The publisher stays fast, B loses messages, **and the loss is counted and attributable to B.** This is the only answer that is stable under a permanent mismatch.

**And the queue must be per subscription rather than shared**, which is the decision people miss. **A shared queue means the slowest subscriber sets the pace for everyone** — one slow handler and every subscriber is delayed, which reintroduces the coupling the whole thing exists to avoid.

Then the second decision, which the first makes unavoidable: **what does delivery guarantee?**

\`\`\`
At-most-once   drop on overflow, no retry. Simple, lossy.
At-least-once  retry until the handler acknowledges.
               Duplicates, so handlers must be idempotent.
Exactly-once   does not exist. It is at-least-once plus
               an idempotent handler.
\`\`\`

**And the third, which is easy to promise carelessly: ordering.**

**Order within a subscription is preserved only if that subscription's messages are handled serially.** The moment a subscriber processes two messages concurrently, **its ordering guarantee is gone** — so parallelism and ordering are exclusive per subscription unless you partition by key.

**Finally the bug that appears in every first implementation: unsubscribing during dispatch.** A handler that unsubscribes itself mutates the list the dispatcher is iterating, **and the result is a skipped subscriber or a crash.**`,
    analogyLimit:
      '"It is the observer pattern with topics" is accurate and stops exactly where the difficulty starts. Observer assumes the subscriber keeps up, so it has no vocabulary for a slow one — and in process there is no broker absorbing the difference, which means the mismatch has to be resolved in your code with a policy you choose and state. The framing also hides that ordering and parallelism are exclusive per subscription, which is a guarantee people promise without noticing they have.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate implements in-process pub/sub as a map from topic to an array of handler functions; `publish(topic, msg)` loops over the array calling each handler synchronously; `subscribe` pushes and `unsubscribe` splices by identity. Identify four problems and rank them.',
      answer: `**Problem 1 — synchronous dispatch makes publish cost the sum of its subscribers, and this is the worst because it couples everything.**

\`\`\`
publish() returns only after every handler returns.
One handler doing a 50 ms database write
→ every publish costs 50 ms
→ and the publisher's latency is now a function of who
  happens to be subscribed
\`\`\`

**Adding a subscriber slows down the publisher**, which inverts the purpose of the decoupling. **And it is worse than the observer-pattern version of this problem**, because with topics the publisher typically does not know who is subscribed at all — so the latency is unpredictable and changes as modules are added.

*The fix is a queue per subscription and a dispatcher*, which immediately raises the slow-subscriber question the whole design turns on.

**Problem 2 — no isolation, so one handler's exception stops the rest.**

\`\`\`
handlers = [A, B, C]
B throws
→ the loop aborts
→ C never receives the message
→ and the exception propagates to the PUBLISHER,
  which was not doing anything wrong
\`\`\`

**Two failures in one:** later subscribers are silently skipped, **and a bug in an unrelated module fails the publishing code path.** The order of the array determines who is affected, which makes it non-deterministic in practice.

*Fix:* each dispatch in its own try, with a per-subscription failure counter — **the same requirement as the observer pattern and the logger's sinks, for the same reason.**

**Problem 3 — unsubscribing during dispatch corrupts the iteration.**

\`\`\`
handlers = [A, B, C]        index 0 → A runs
A unsubscribes itself       → splice(0,1) → [B, C]
loop increments to index 1  → C
→ B IS SKIPPED
\`\`\`

**A subscriber silently misses a message, and it happens only when a handler unsubscribes** — so it is intermittent and depends on position in the array. **This is the single most common bug in a first implementation.**

*Fix:* **iterate a snapshot.**

\`\`\`ts
for (const s of [...this.subs.get(topic) ?? []]) { /* ... */ }
\`\`\`

**And then state the consequence honestly: a subscription cancelled mid-dispatch may still receive that one message.** That is a documented semantic, not a bug — **the alternative is a check before each delivery, which is also defensible and slightly slower.**

**Problem 4 — there is no backpressure story at all, because synchronous dispatch hides it.**

**Synchronous dispatch has no queues, so nothing overflows** — the publisher simply blocks. **Which means problem 1 and problem 4 are the same problem seen from two directions:** the design has chosen "block the publisher" without knowing it, **and a candidate who cannot say what happens to a slow subscriber has not made the decision.**

**Ranking. Problem 1 is the design error** — it couples the publisher's latency to an unknown set of subscribers, and everything else follows from fixing it. **Problem 3 is the correctness bug** that will reach production, because it is intermittent and position-dependent. **Problem 2 is a correctness and blast-radius bug.** Problem 4 is the missing decision that problem 1 concealed.

**What the corrected shape is.**

\`\`\`ts
interface Subscription { unsubscribe(): void; }

class PubSub {
  subscribe(topic: string, handler: Handler,
            opts?: { queueSize?: number;
                     onOverflow?: 'drop-old' | 'drop-new';
                     ordered?: boolean }): Subscription;
  publish(topic: string, msg: unknown): PublishResult;
}
type PublishResult = { delivered: number; dropped: number };
\`\`\`

**Per-subscription options, because the policy belongs to the subscriber**, and a publish result that reports drops — **because a pub/sub that loses messages silently is the same dishonesty as a logger that does.**

**The transferable diagnostic: ask what happens when one subscriber is ten times slower than the publisher.** A design with no answer has chosen blocking by default.`,
    },
  body: `## Requirements and the invariant

**Five questions, and each changes the design.**

\`\`\`
"May publish block if a subscriber is slow?"     → the core one
"Must delivery be ordered per subscriber?"        → serial handling
"At-most-once or at-least-once?"                  → retry or not
"Exact topics, or patterns?"                      → matching cost
"Can a handler unsubscribe or publish?"           → reentrancy
\`\`\`

\`\`\`
INVARIANT
  a message published to a topic is offered exactly once to
    each subscription active at publish time
  publish never blocks and never throws to the publisher
  a message is either delivered to a subscription, or counted
    as dropped for that subscription
  within a subscription, delivery order matches publish order
    (only while handling is serial)
\`\`\`

**The last clause has a condition attached, and that is deliberate.** Ordering is not a free property — **it holds only while a subscription handles one message at a time**, and stating the condition is what makes the guarantee honest.

## The structure

\`\`\`ts
type Handler<T> = (msg: T) => void | Promise<void>;

interface SubOptions {
  queueSize?: number;                        // default 1024
  onOverflow?: 'drop-old' | 'drop-new';      // default drop-old
  ordered?: boolean;                         // default true
}

class SubscriptionState<T> {
  readonly queue: T[] = [];
  dropped = 0;
  failures = 0;
  draining = false;
  active = true;
  constructor(readonly topic: string,
              readonly handler: Handler<T>,
              readonly opts: Required<SubOptions>) {}
}

export class PubSub {
  private readonly byTopic = new Map<string, Set<SubscriptionState<any>>>();

  subscribe<T>(topic: string, handler: Handler<T>,
               opts: SubOptions = {}): Subscription {
    const state = new SubscriptionState(topic, handler, {
      queueSize: opts.queueSize ?? 1024,
      onOverflow: opts.onOverflow ?? 'drop-old',
      ordered: opts.ordered ?? true,
    });
    let set = this.byTopic.get(topic);
    if (!set) { set = new Set(); this.byTopic.set(topic, set); }
    set.add(state);
    return { unsubscribe: () => { state.active = false; set!.delete(state); } };
  }

  publish<T>(topic: string, msg: T): PublishResult {
    const set = this.byTopic.get(topic);
    if (!set) return { delivered: 0, dropped: 0 };

    let delivered = 0, dropped = 0;
    for (const state of [...set]) {              // SNAPSHOT
      if (!state.active) continue;
      if (state.queue.length >= state.opts.queueSize) {
        if (state.opts.onOverflow === 'drop-new') {
          state.dropped++; dropped++; continue;
        }
        state.queue.shift(); state.dropped++; dropped++;
      }
      state.queue.push(msg);
      delivered++;
      this.scheduleDrain(state);
    }
    return { delivered, dropped };
  }
}
\`\`\`

**Four decisions worth defending.**

**The queue is per subscription.** A shared queue lets the slowest subscriber set the pace for all of them, **which reintroduces exactly the coupling pub/sub exists to remove.** The cost is memory proportional to subscribers × queue size, **which is the price of isolation and is worth stating as a number.**

**Options are per subscription.** A metrics subscriber can afford to drop; an audit subscriber cannot. **The policy belongs to the subscriber**, because only the subscriber knows the value of its own messages.

**\`publish\` iterates a snapshot of the subscriber set.** This is the fix for the unsubscribe-during-dispatch bug, **and it has a stated consequence**: a subscription cancelled during a publish may still receive that message. The \`active\` check narrows the window without closing it.

**And \`publish\` returns a result with a drop count.** A pub/sub that loses messages silently is the logger's silent-drop problem again — **the publisher cannot react to something it cannot see.**

## The drain, and where ordering comes from

\`\`\`ts
private scheduleDrain(state: SubscriptionState<any>): void {
  if (state.draining) return;                // one drain at a time
  state.draining = true;
  queueMicrotask(() => this.drain(state));   // off the publisher
}

private async drain(state: SubscriptionState<any>): Promise<void> {
  try {
    while (state.active && state.queue.length > 0) {
      const msg = state.queue.shift()!;
      try {
        const r = state.handler(msg);
        if (state.opts.ordered && r instanceof Promise) await r;
      } catch {
        state.failures++;                    // ISOLATED
      }
    }
  } finally {
    state.draining = false;
    if (state.active && state.queue.length > 0) this.scheduleDrain(state);
  }
}
\`\`\`

**Three things this gets right, and one honest limitation.**

**\`draining\` is a per-subscription mutex**, so at most one drain loop runs per subscription. **That single flag is where the ordering guarantee lives** — remove it and two loops interleave, and order is gone.

**The await is conditional on \`ordered\`.** A subscription that asks for unordered delivery does not await, **so its handler invocations overlap and it processes faster.** The trade is explicit and per subscription, which is the right place for it.

**Handler exceptions are caught per message**, so one bad message does not stop the subscription's queue — **and the failure is counted rather than swallowed.**

*The limitation:* an unordered subscription whose handler returns a promise **has no bound on concurrency** — a burst of a thousand messages starts a thousand overlapping handler calls. **A real implementation needs a concurrency limit**, and saying so is better than pretending \`ordered: false\` is free.

## Delivery guarantees, chosen per subscription

**Three options, and only two exist.**

\`\`\`
AT-MOST-ONCE   push to the queue, drop on overflow, never retry.
               Cheap, lossy, and correct for metrics, cache
               invalidation, UI updates.

AT-LEAST-ONCE  the handler must acknowledge; unacknowledged
               messages are retried with backoff, then
               dead-lettered.
               Duplicates are guaranteed, so the handler must
               be idempotent.

EXACTLY-ONCE   does not exist. It is at-least-once plus an
               idempotent handler — the same decomposition as
               the payments lesson, with messages instead
               of money.
\`\`\`

**At-least-once changes the handler contract**, which is the part to make explicit:

\`\`\`ts
type AckHandler<T> = (msg: T) => Promise<void>;   // reject = retry
\`\`\`

**A rejected promise means retry; a resolved one means done.** And then three things are required that at-most-once does not need:

**A retry policy with backoff and a cap**, or a permanently failing handler retries forever.

**A dead-letter destination** for messages that exhaust their retries — **because the alternative is dropping them silently after pretending to guarantee delivery**, which is the worst of both models.

**And the message must stay in the queue until acknowledged**, so the queue is no longer a simple shift — an in-flight message occupies a slot, **which reduces the effective queue capacity under retry.**

*The recommendation:* **default to at-most-once and make at-least-once opt-in per subscription.** Most in-process subscribers are notifications where a miss is acceptable, **and the ones that are not usually want durability too** — which an in-process queue cannot provide anyway.

## Ordering and parallelism are exclusive

\`\`\`
ordered: true   one message at a time per subscription
                → publish order preserved
                → throughput bounded by handler latency

ordered: false  handler invocations overlap
                → no order guarantee
                → throughput bounded by concurrency limit
\`\`\`

**And the third option, which is the one worth knowing: partition by key.**

\`\`\`ts
subscribe('orders', handler, {
  ordered: true,
  partitionBy: (msg) => msg.orderId,    // N serial lanes
  lanes: 8,
});
\`\`\`

**Messages for the same key go to the same lane and are handled serially; different keys proceed in parallel.** So you get **order within a key and parallelism across keys** — which is what is usually actually needed, and it is the consumer-group model from the messaging lesson applied in process.

*The cost:* a lane per partition, **so the memory and the bookkeeping multiply** — and a hot key still serialises, so the parallelism is only as good as the key distribution.

## Topic matching

**Exact match is a map lookup, and it should be the default.**

\`\`\`ts
this.byTopic.get(topic)      // O(1)
\`\`\`

**Patterns cost a match per publish**, and the naive implementation is a linear scan of every pattern subscription on every message — **which is fine at ten subscriptions and not at a thousand.**

*If patterns are required, resolve once and cache:*

\`\`\`ts
private resolved = new Map<string, Set<SubscriptionState<any>>>();

private subsFor(topic: string): Set<SubscriptionState<any>> {
  let s = this.resolved.get(topic);
  if (!s) {
    s = new Set([...(this.byTopic.get(topic) ?? []),
                 ...this.matchPatterns(topic)]);
    this.resolved.set(topic, s);         // cache per CONCRETE topic
  }
  return s;
}
// and invalidate \`resolved\` on any subscribe/unsubscribe
\`\`\`

**Concrete topics are usually a small bounded set even when patterns are many**, so the cache hit rate is high. **And the invalidation is coarse — clear it entirely on any subscription change** — because subscriptions change rarely and publishes happen constantly.

*What to say if asked whether to support patterns:* **not unless the prompt asks.** They cost a matching strategy, a cache and an invalidation rule, **for a convenience an explicit topic list usually provides.**

## Reentrancy: a handler that publishes

**A handler publishing to another topic is normal and must work.** With the queue-and-drain design it does, almost by accident:

\`\`\`
handler for 'order.created' publishes 'email.queued'
→ publish() enqueues to email subscriptions and returns
→ no recursion, because delivery is not synchronous
\`\`\`

**Which is a real benefit of the asynchronous design**: synchronous dispatch would recurse, **and a cycle of two topics publishing to each other would overflow the stack.** With queues, a cycle becomes an infinite loop that is at least observable — the queues stay non-empty and the drop counters climb.

*Worth naming anyway:* **a publish cycle is still a bug**, and a cheap guard is a per-message hop count that drops after N hops. **Not required, and cheap insurance.**

## Tests

\`\`\`ts
test('a handler that unsubscribes does not skip the next subscriber', () => {
  const seen: string[] = [];
  const a = ps.subscribe('t', () => { seen.push('a'); a.unsubscribe(); });
  ps.subscribe('t', () => seen.push('b'));
  ps.publish('t', 1);
  await flush();
  expect(seen).toEqual(['a', 'b']);        // ← b must not be skipped
});

test('a throwing handler does not affect the others', async () => { /* ... */ });

test('a slow subscriber does not slow publish', () => {
  ps.subscribe('t', async () => { await never(); });
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) ps.publish('t', i);
  expect(performance.now() - t0).toBeLessThan(50);   // not blocked
});

test('overflow drops per policy and reports the count', () => {
  ps.subscribe('t', async () => never(), { queueSize: 10 });
  let dropped = 0;
  for (let i = 0; i < 100; i++) dropped += ps.publish('t', i).dropped;
  expect(dropped).toBe(90);
});

test('order is preserved within an ordered subscription', async () => { /* ... */ });
\`\`\`

**The first test is the one that catches the bug everyone writes**, and the third is the one that proves the central design property — **that a slow subscriber cannot slow the publisher.**

## What to say in the last three minutes

**The slow-subscriber answer first**, because it is the design: a bounded queue per subscription with a stated drop policy, and the publish result reporting drops.

**Why the queue is per subscription** — a shared one lets the slowest set the pace, reinstating the coupling.

**That ordering holds only while handling is serial**, and that partitioning by key is how you get order plus parallelism.

**That exactly-once does not exist**, and at-least-once needs acknowledgements, backoff, a cap and a dead-letter path.

**The snapshot iteration**, and the honest consequence that a mid-publish unsubscribe may still receive one message.

**And what you left out:** durability, cross-process delivery, pattern subscriptions, and a concurrency limit for unordered subscriptions.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'slow-subscriber',
      title: 'One slow subscriber, and the three answers',
      caption:
        'Step through it. In process there is no broker to absorb the mismatch, so the policy has to be in your code — and only the third answer is stable when the mismatch is permanent.',
      nodes: [
        { id: 'pub', label: 'Publisher — 10,000 msg/s', kind: 'client', x: 0, y: 160, detail: 'With topics, the publisher usually does not know who is subscribed — so any design where publish cost depends on the subscribers makes the publisher\'s latency unpredictable and changing as modules are added.' },
        { id: 'block', label: 'Answer 1: block the publisher', kind: 'note', x: 250, y: 30, detail: 'Synchronous dispatch, which is what a naive implementation chooses without noticing. The publisher now runs at the speed of its slowest subscriber, so adding a subscriber slows the thing being observed — inverting the purpose of the decoupling.' },
        { id: 'unbounded', label: 'Answer 2: unbounded queue', kind: 'note', x: 250, y: 160, detail: 'The publisher stays fast and the slow subscriber\'s queue grows at the difference — 9,900 messages per second here. The failure is deferred into memory exhaustion rather than avoided, and it takes the whole process down.' },
        { id: 'bounded', label: 'Answer 3: bounded queue per subscription', kind: 'store', x: 250, y: 300, detail: 'The publisher stays fast, the slow subscriber loses messages, and the loss is counted and attributable to that subscription. The only answer that is stable under a permanent mismatch — which is the normal case.' },
        { id: 'per', label: 'Per subscription, never shared', kind: 'note', x: 540, y: 300, detail: 'A shared queue lets the slowest subscriber set the pace for everyone, reintroducing exactly the coupling pub/sub exists to remove. The cost is memory proportional to subscribers times queue size, which is worth stating as a number.' },
        { id: 'drain', label: 'One drain loop per subscription', kind: 'service', x: 800, y: 220, detail: 'A single draining flag per subscription is a per-subscription mutex, and it is where the ordering guarantee lives. Remove it and two loops interleave, and publish order is gone.' },
        { id: 'partition', label: 'Order AND parallelism: partition by key', kind: 'note', x: 800, y: 360, detail: 'N serial lanes keyed by a message field: order within a key, parallelism across keys — the consumer-group model in process. A hot key still serialises, so the parallelism is only as good as the key distribution.' },
        { id: 'report', label: 'publish() returns a drop count', kind: 'note', x: 540, y: 120, detail: 'A pub/sub that loses messages silently is the logger\'s silent-drop problem again: the publisher cannot react to something it cannot see. Either delivered to a subscription or counted as dropped for it.' },
      ],
      edges: [
        { id: 'p1', source: 'pub', target: 'block', kind: 'control' },
        { id: 'p2', source: 'pub', target: 'unbounded', kind: 'control' },
        { id: 'p3', source: 'pub', target: 'bounded', kind: 'write' },
        { id: 'p4', source: 'bounded', target: 'per', kind: 'control' },
        { id: 'p5', source: 'bounded', target: 'report', kind: 'control' },
        { id: 'p6', source: 'per', target: 'drain', kind: 'async' },
        { id: 'p7', source: 'drain', target: 'partition', kind: 'control' },
      ],
      steps: [
        {
          id: 'ps1',
          title: 'The question that is the design',
          description:
            'What happens when one subscriber is ten times slower than the publisher? A design with no answer has chosen blocking by default — which is what synchronous dispatch is.',
          nodes: ['pub', 'block', 'unbounded'],
          edges: ['p1', 'p2'],
        },
        {
          id: 'ps2',
          title: 'Only a bounded queue is stable',
          description:
            'Blocking couples the publisher to its slowest subscriber; an unbounded queue defers the failure into memory exhaustion. A bounded queue converts an unbounded problem into a counted loss.',
          nodes: ['bounded'],
          edges: ['p3'],
        },
        {
          id: 'ps3',
          title: 'And it must be per subscription',
          description:
            'A shared queue lets the slowest set the pace for all, which is the coupling pub/sub exists to remove. Per-subscription queues cost memory and buy isolation — and the policy belongs to the subscriber, since only it knows what its messages are worth.',
          nodes: ['per', 'report'],
          edges: ['p4', 'p5'],
        },
        {
          id: 'ps4',
          title: 'Ordering lives in one flag',
          description:
            'A per-subscription draining flag means at most one drain loop, which is what preserves publish order. Ordering is not free — it holds only while handling is serial, and the condition must be stated.',
          nodes: ['drain'],
          edges: ['p6'],
        },
        {
          id: 'ps5',
          title: 'Then partition to get both',
          description:
            'Serial lanes keyed by a message field give order within a key and parallelism across keys. It is what is usually actually wanted, and a hot key still bounds it.',
          nodes: ['partition'],
          edges: ['p7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'unsubscribe-bug',
      title: 'The bug in every first implementation',
      caption:
        'Read the left side step by step. The skip happens only when a handler unsubscribes, and only for the subscriber positioned after it — which is why it is intermittent and survives review.',
      code: `flowchart TB
    subgraph BUG["**Iterating the live array**"]
      direction TB
      B0["handlers = [A, B, C]<br/>i = 0"]
      B0 --> B1["i=0 → A runs<br/>A unsubscribes itself<br/>**splice(0,1) → [B, C]**"]
      B1 --> B2["i becomes 1<br/>handlers[1] = **C**"]
      B2 --> B3["**B IS SKIPPED**<br/>silently, and only when<br/>a handler unsubscribes"]
    end

    subgraph FIX["**Iterating a snapshot**"]
      direction TB
      F0["snapshot = [...handlers]<br/>= [A, B, C]"]
      F0 --> F1["A runs, unsubscribes<br/>live set → {B, C}<br/>**snapshot unchanged**"]
      F1 --> F2["B runs · C runs<br/>all three offered"]
      F2 --> F3["**Stated consequence:**<br/>a subscription cancelled<br/>mid-publish may still<br/>receive that one message"]
    end

    N["**Why this survives review:**<br/>it needs a handler that unsubscribes,<br/>and it only affects subscribers positioned<br/>after it — so it is intermittent and<br/>position-dependent.<br/><br/>The test: A unsubscribes itself, assert<br/>B still received the message."]

    B3 -.-> N
    F3 -.-> N

    style B3 fill:#40181c,stroke:#b4535e
    style F3 fill:#1c1814,stroke:#c99a4e
    style N fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `Two published designs bracket the decision space here, and the contrast between them is the useful thing.

**The Redis pub/sub model is deliberately at-most-once and holds nothing for absent subscribers.** Messages are delivered to whoever is connected and interested at that moment; **a subscriber that is slow or disconnected simply misses them**, and the documentation is explicit that nothing is persisted.

**What that buys is a publisher whose cost does not depend on its subscribers.** No queues to grow, no memory proportional to subscriber lag, no retry machinery. **And what it costs is stated up front rather than discovered** — which is the property worth imitating: the guarantee is weak and it is honest.

**The Kafka consumer-group model takes the opposite position and pays for it.** Messages are durable, consumers track their own position, and **ordering is guaranteed per partition rather than per topic.**

**That last detail is the one to carry into this design.** Ordering per partition is precisely the compromise that makes parallelism possible: **a single ordered stream can only be processed serially, so the ordering guarantee is narrowed to a key range** and parallelism is recovered across keys. **The in-process version of that is serial lanes keyed by a message field** — the same trade, several orders of magnitude smaller.

**Three transferable lessons.**

**A weak guarantee stated clearly beats a strong one implied.** "Slow subscribers miss messages" is a usable contract; **"delivery is reliable" without qualification is not, and it will be wrong under load.**

**Narrow the ordering guarantee to make parallelism possible.** Per-topic ordering forces serial processing; **per-key ordering is usually what was actually needed** and it scales.

**And the position of the buffer determines who absorbs a mismatch.** A broker holds it; **in process, either the publisher waits, the memory grows, or messages are dropped** — and there is no fourth option, so the choice must be explicit.

**Where these references do not help.** Both are network systems with a broker, so **the slow-subscriber mismatch is absorbed by infrastructure you do not have.** In process the policy lives in your code, which makes it a design decision rather than a configuration one — and that is the whole substance of this problem.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, nearly all of which follow from how a slow subscriber is handled.',
    rows: [
      {
        option: 'Synchronous dispatch to every handler',
        whenItWins:
          'A handful of fast, trusted handlers where publish latency is irrelevant.',
        whenItLoses:
          'Publish costs the sum of its subscribers, so adding a subscriber slows the publisher — and with topics the publisher does not know who is subscribed.',
        cost:
          'Unpredictable publish latency, plus recursion on any publish cycle.',
      },
      {
        option: 'Blocking the publisher when a queue is full',
        whenItWins:
          'When every message matters more than publisher throughput — which is rarely true in process.',
        whenItLoses:
          'The publisher runs at the speed of its slowest subscriber, permanently.',
        cost:
          'The decoupling the design exists to provide.',
      },
      {
        option: 'An unbounded queue per subscriber',
        whenItWins:
          'When lag is guaranteed to be transient and small.',
        whenItLoses:
          'A permanent mismatch grows the queue at the rate difference until the process dies.',
        cost:
          'A deferred failure that takes the whole process, not just the subscriber.',
      },
      {
        option: 'A bounded queue per subscription with a drop policy',
        whenItWins:
          'Always. The only answer stable under a permanent mismatch, and the loss is counted and attributable.',
        whenItLoses:
          'Messages are lost, and memory is subscribers × queue size.',
        cost:
          'Counted loss, plus a policy each subscriber must choose.',
      },
      {
        option: 'One shared queue for all subscribers',
        whenItWins:
          'Nowhere. It looks like a memory saving.',
        whenItLoses:
          'The slowest subscriber sets the pace for every subscriber, reinstating the coupling.',
        cost:
          'Isolation, which was the point.',
      },
      {
        option: 'At-most-once delivery',
        whenItWins:
          'The right default in process — metrics, cache invalidation, UI updates, where a miss is acceptable.',
        whenItLoses:
          'Anything where a missed message is a business error.',
        cost:
          'Messages lost on overflow, with no retry.',
      },
      {
        option: 'At-least-once with acknowledgements',
        whenItWins:
          'When a missed message is unacceptable and the handler can be made idempotent.',
        whenItLoses:
          'Duplicates are guaranteed, in-flight messages occupy queue slots, and it needs backoff, a retry cap and a dead-letter path.',
        cost:
          'A handler contract change and three pieces of machinery.',
      },
      {
        option: 'Promising exactly-once',
        whenItWins:
          'Nowhere. It does not exist.',
        whenItLoses:
          'It is at-least-once plus an idempotent handler, and claiming otherwise hides the idempotency requirement from the handler author.',
        cost:
          'A guarantee that will be violated silently.',
      },
      {
        option: 'Ordered delivery per subscription',
        whenItWins:
          'When the handler\'s correctness depends on sequence — applying updates, maintaining a projection.',
        whenItLoses:
          'Throughput is bounded by handler latency, since exactly one message is in flight.',
        cost:
          'No parallelism within the subscription.',
      },
      {
        option: 'Unordered delivery',
        whenItWins:
          'Independent messages where throughput matters.',
        whenItLoses:
          'Order is gone, and without a concurrency limit a burst starts unbounded overlapping handler calls.',
        cost:
          'A concurrency limit is required, so it is not free.',
      },
      {
        option: 'Partitioned lanes keyed by a message field',
        whenItWins:
          'Usually what is actually wanted: order within a key, parallelism across keys.',
        whenItLoses:
          'A hot key serialises, so parallelism is only as good as the key distribution.',
        cost:
          'A lane per partition, multiplying memory and bookkeeping.',
      },
      {
        option: 'Iterating the live subscriber list',
        whenItWins:
          'Nowhere.',
        whenItLoses:
          'A handler that unsubscribes shifts the array, so the next subscriber is silently skipped.',
        cost:
          'An intermittent, position-dependent missed delivery.',
      },
      {
        option: 'Iterating a snapshot',
        whenItWins:
          'Always. It is one spread operator.',
        whenItLoses:
          'A subscription cancelled mid-publish may still receive that message.',
        cost:
          'A documented semantic, and an allocation per publish.',
      },
      {
        option: 'Pattern subscriptions',
        whenItWins:
          'When topics are genuinely dynamic and numerous.',
        whenItLoses:
          'The naive form scans every pattern on every publish, so it needs a resolved-set cache and an invalidation rule.',
        cost:
          'A matching strategy, a cache, and invalidation — for a convenience an explicit topic list often provides.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"publish loops over the handlers for that topic and calls each one."',
      whyWeak:
        'Publish then costs the sum of its subscribers, so one handler doing a 50 ms write makes every publish cost 50 ms — and with topics the publisher usually does not know who is subscribed, so its latency changes as unrelated modules are added. It has also chosen "block the publisher" as the slow-subscriber policy without noticing.',
      strongAnswer:
        '"Each subscription gets a bounded queue and a drain loop, so publish enqueues and returns. That decouples publish latency from the subscribers entirely, which is the point of having topics. And it forces the decision the design is really about: what happens when a subscriber is slower than the publisher — for which the answer is a stated drop policy per subscription, with the drops counted and returned from publish."',
    },
    {
      weakAnswer: '"Each subscriber gets a queue so publish never blocks."',
      whyWeak:
        'Unbounded queues defer the failure rather than avoiding it. A subscriber handling 100 messages per second against a publisher producing 10,000 accumulates 9,900 per second, so the process runs out of memory — and it takes every subscriber down, not just the slow one.',
      strongAnswer:
        '"Bounded queues, with a per-subscription policy: drop the oldest by default, and the count reported from publish and tracked per subscription. That converts an unbounded problem into a counted, attributable loss. And the bound is a number I would state — say 1,024 messages per subscription — so the memory cost is subscribers times queue size rather than unknown."',
    },
    {
      weakAnswer: '"One queue holds pending deliveries, and a worker drains it to the subscribers."',
      whyWeak:
        'A shared queue means the slowest subscriber sets the pace for all of them: while its handler runs, nothing else is delivered. That is the coupling pub/sub exists to remove, reintroduced one level down.',
      strongAnswer:
        '"The queue has to be per subscription, and that is the decision people miss. Otherwise one slow handler delays every subscriber, which is the coupling the topics were supposed to break. The cost is memory proportional to subscribers times queue size, and it buys genuine isolation — plus the ability to give each subscription its own policy, since only the subscriber knows what its messages are worth."',
    },
    {
      weakAnswer: '"Delivery is guaranteed — the message stays in the queue until the handler processes it."',
      whyWeak:
        'It promises a guarantee the design cannot keep. An in-process queue is lost on a crash, a bounded queue drops on overflow, and without acknowledgements a handler that throws loses the message anyway.',
      strongAnswer:
        '"At-most-once by default: enqueue, drop on overflow, no retry — which is correct for metrics, cache invalidation and UI updates. At-least-once is opt-in per subscription and changes the handler contract to a promise, where a rejection means retry — and it needs backoff, a retry cap and a dead-letter path, or a permanently failing handler retries forever. Exactly-once does not exist; it is at-least-once plus an idempotent handler, and claiming otherwise hides the idempotency requirement from whoever writes the handler."',
    },
    {
      weakAnswer: '"Messages are delivered in order to each subscriber."',
      whyWeak:
        'That holds only while a subscription handles one message at a time, and the claim is usually made without noticing the condition. The moment handler invocations overlap — an async handler that is not awaited — the ordering is gone.',
      strongAnswer:
        '"Order is preserved per subscription only while its handling is serial, which is what a single draining flag per subscription enforces. So ordering and parallelism are exclusive within a subscription — and the way to get both is to partition by a message key into serial lanes: order within a key, parallelism across keys. That is the consumer-group trade in process, and it is usually what people actually wanted."',
    },
    {
      weakAnswer: '"unsubscribe removes the handler from the array, and publish iterates that array."',
      whyWeak:
        'A handler that unsubscribes itself during dispatch mutates the array being iterated, so the next subscriber is silently skipped. It happens only when a handler unsubscribes, and only for subscribers positioned after it — which makes it intermittent and survives review.',
      strongAnswer:
        '"Publish iterates a snapshot of the subscriber set, so a mid-dispatch unsubscribe cannot corrupt the iteration. The honest consequence is that a subscription cancelled during a publish may still receive that one message — a documented semantic rather than a bug, narrowed by an active flag checked before delivery. And the test is explicit: a handler that unsubscribes itself, asserting the next subscriber still received the message."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lps-1',
      front: 'What single question decides this design?',
      back: 'What happens to a slow subscriber. In process there is no broker to absorb the mismatch, so the policy has to be in your code.',
      topic: 'backpressure',
    },
    {
      id: 'fc-lps-2',
      front: 'What are the three possible answers, and which is stable?',
      back: 'Block the publisher, an unbounded queue, or a bounded queue that drops. Only the bounded queue is stable under a permanent mismatch.',
      topic: 'backpressure',
    },
    {
      id: 'fc-lps-3',
      front: 'Why must the queue be per subscription rather than shared?',
      back: 'A shared queue lets the slowest subscriber set the pace for all of them, reinstating exactly the coupling pub/sub exists to remove.',
      topic: 'backpressure',
    },
    {
      id: 'fc-lps-4',
      front: 'What does synchronous dispatch implicitly choose?',
      back: '"Block the publisher" — so a design with no slow-subscriber answer has already made the worst choice without noticing.',
      topic: 'backpressure',
    },
    {
      id: 'fc-lps-5',
      front: 'Why should the drop policy be per subscription?',
      back: 'Only the subscriber knows what its messages are worth — metrics can drop, an audit consumer cannot.',
      topic: 'subscriptions',
    },
    {
      id: 'fc-lps-6',
      front: 'Why does publish return a drop count?',
      back: 'Because a pub/sub that loses messages silently leaves the publisher unable to react to something it cannot see.',
      topic: 'subscriptions',
    },
    {
      id: 'fc-lps-7',
      front: 'Where does the ordering guarantee physically live?',
      back: 'In a single per-subscription draining flag, which ensures at most one drain loop. Remove it and two loops interleave and order is gone.',
      topic: 'ordering',
    },
    {
      id: 'fc-lps-8',
      front: 'Why are ordering and parallelism exclusive per subscription?',
      back: 'Order requires one message in flight at a time; overlapping handler invocations have no defined sequence.',
      topic: 'ordering',
    },
    {
      id: 'fc-lps-9',
      front: 'How do you get order and parallelism together?',
      back: 'Partition into serial lanes keyed by a message field — order within a key, parallelism across keys. A hot key still serialises.',
      topic: 'ordering',
    },
    {
      id: 'fc-lps-10',
      front: 'Why is unordered delivery not free?',
      back: 'Without a concurrency limit, a burst of a thousand messages starts a thousand overlapping handler calls.',
      topic: 'ordering',
    },
    {
      id: 'fc-lps-11',
      front: 'What does at-least-once require beyond a retry?',
      back: 'Backoff, a retry cap, a dead-letter path, and in-flight messages occupying queue slots — plus an idempotent handler.',
      topic: 'delivery-guarantees',
    },
    {
      id: 'fc-lps-12',
      front: 'What is exactly-once delivery?',
      back: 'At-least-once plus an idempotent handler. Claiming it as a primitive hides the idempotency requirement from the handler author.',
      topic: 'delivery-guarantees',
    },
    {
      id: 'fc-lps-13',
      front: 'What is the bug in every first implementation?',
      back: 'A handler that unsubscribes mutates the array being iterated, silently skipping the next subscriber. Fix: iterate a snapshot.',
      topic: 'subscriptions',
    },
    {
      id: 'fc-lps-14',
      front: 'What is the stated consequence of snapshot iteration?',
      back: 'A subscription cancelled mid-publish may still receive that one message — a documented semantic rather than a bug.',
      topic: 'subscriptions',
    },
  ],

  quiz: [
    {
      id: 'q-lps-1',
      kind: 'scenario',
      prompt:
        'A publisher produces 10,000 messages/second. One subscriber handles 100/second. With an unbounded queue per subscriber, what happens?',
      options: [
        { id: 'a', label: 'The queue grows by 9,900 per second until the process exhausts memory — taking every subscriber down, not just the slow one' },
        { id: 'b', label: 'The publisher slows to 100/second' },
        { id: 'c', label: 'The slow subscriber misses messages' },
        { id: 'd', label: 'Nothing — queues absorb the difference' },
      ],
      correct: ['a'],
      explanation:
        'An unbounded queue defers the failure rather than avoiding it, and the failure is worse than the problem: the whole process dies. Option b describes blocking, option c describes a bounded queue — the three answers are genuinely different and only the bounded one is stable under a permanent mismatch.',
      difficulty: 'core',
      topic: 'backpressure',
    },
    {
      id: 'q-lps-2',
      kind: 'scenario',
      prompt:
        'Why is one shared delivery queue drained by a worker the wrong structure?',
      options: [
        { id: 'a', label: 'While the slowest handler runs, nothing else is delivered — so the slowest subscriber sets the pace for every subscriber' },
        { id: 'b', label: 'It uses more memory than per-subscription queues' },
        { id: 'c', label: 'It cannot preserve ordering' },
        { id: 'd', label: 'Nothing — it is the standard design' },
      ],
      correct: ['a'],
      explanation:
        'It reintroduces the coupling that topics existed to remove, one level down. Option b is backwards — a shared queue uses less memory, which is exactly why it is tempting, and the memory is the price of isolation.',
      difficulty: 'core',
      topic: 'backpressure',
    },
    {
      id: 'q-lps-3',
      kind: 'scenario',
      prompt:
        'Handlers [A, B, C] are subscribed. A unsubscribes itself when called, and publish iterates the live array by index. What happens?',
      options: [
        { id: 'a', label: 'B is silently skipped, because removing A shifts the array while the index advances' },
        { id: 'b', label: 'All three receive the message' },
        { id: 'c', label: 'The loop throws a concurrent-modification error' },
        { id: 'd', label: 'A receives the message twice' },
      ],
      correct: ['a'],
      explanation:
        'This is the most common bug in a first implementation, and it is intermittent: it needs a handler that unsubscribes and it only affects subscribers positioned after it. The fix is one spread operator to iterate a snapshot, with the honest consequence that a mid-publish unsubscribe may still receive that message.',
      difficulty: 'core',
      topic: 'subscriptions',
    },
    {
      id: 'q-lps-4',
      kind: 'scenario',
      prompt:
        'A subscription is declared "ordered" but its async handler is invoked without awaiting. What is the guarantee?',
      options: [
        { id: 'a', label: 'None — handler invocations overlap, so publish order is not preserved despite the declaration' },
        { id: 'b', label: 'Order is preserved because the queue is FIFO' },
        { id: 'c', label: 'Order is preserved for synchronous handlers only' },
        { id: 'd', label: 'Order is preserved but throughput suffers' },
      ],
      correct: ['a'],
      explanation:
        'A FIFO queue delivers in order and guarantees nothing about completion order once invocations overlap. Ordering lives in the serialisation — the per-subscription draining flag plus awaiting the handler — not in the queue, which is why the guarantee must state the serial-handling condition.',
      difficulty: 'advanced',
      topic: 'ordering',
    },
    {
      id: 'q-lps-5',
      kind: 'scenario',
      prompt:
        'A subscriber asks for exactly-once delivery. What is the correct response?',
      options: [
        { id: 'a', label: 'It does not exist: at-least-once with acknowledgements plus an idempotent handler, which is what exactly-once means in practice' },
        { id: 'b', label: 'Deduplicate by message id in the pub/sub before delivery' },
        { id: 'c', label: 'Use at-most-once, which guarantees no duplicates' },
        { id: 'd', label: 'Acknowledge before invoking the handler' },
      ],
      correct: ['a'],
      explanation:
        'The same decomposition as the payments lesson, with messages instead of money. Option b helps and cannot be complete, since a handler can be invoked and then crash before its effect is durable. Option c guarantees no duplicates by permitting loss, and option d converts at-least-once into at-most-once.',
      difficulty: 'advanced',
      topic: 'delivery-guarantees',
    },
    {
      id: 'q-lps-6',
      kind: 'multi',
      prompt:
        'A subscription needs both ordering and parallelism. Which approaches genuinely help? Select all that apply.',
      options: [
        { id: 'a', label: 'Partition into serial lanes keyed by a message field — order within a key, parallelism across keys' },
        { id: 'b', label: 'Accept that a hot key still serialises, so parallelism is bounded by key distribution' },
        { id: 'c', label: 'Split into several subscriptions, each handling a disjoint key range' },
        { id: 'd', label: 'Set ordered: false and rely on the FIFO queue for order' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the same idea at different granularities, and the second is the honest limit on it. Option d is the misconception from the previous question: a FIFO queue delivers in order and guarantees nothing once handler invocations overlap.',
      difficulty: 'core',
      topic: 'ordering',
    },
  ],

  exercises: [
    {
      id: 'ex-lps-1',
      kind: 'implement',
      title: 'Add the guarantees, then find the one that cannot be added',
      estimatedMinutes: 45,
      prompt: `Starting from the pub/sub in this lesson, add three capabilities. For each, write the code and state what it does to the invariant.

**Part 1 — at-least-once for one subscription.** Acknowledgement, retry with backoff, a retry cap, and a dead-letter path. The other subscriptions stay at-most-once.

**Part 2 — partitioned lanes.** \`partitionBy\` and a lane count, giving order within a key and parallelism across keys.

**Part 3 — a "shed the subscriber" policy.** Instead of dropping messages, a subscription that stays full for too long is unsubscribed and notified.

**Part 4.** A subscriber asks for durable delivery: messages must survive a process restart. Explain why this cannot be added, and what you would do instead.

Then answer:

- In Part 1, what happens if the handler acknowledges and then the process crashes?
- Is Part 3 ever the right policy, and for whom?`,
      rubric: [
        'At-least-once implemented with ack, backoff, a cap and a dead-letter path.',
        'States that in-flight messages occupy queue slots.',
        'Partitioned lanes preserve order per key with a stated lane assignment.',
        'Notes that a hot key bounds the parallelism.',
        'Shed-the-subscriber implemented with a stall threshold and a notification.',
        'Explains why durability cannot be added in process.',
        'Proposes a concrete alternative rather than a partial version.',
        'Answers the crash-after-ack question correctly.',
        'Gives a defensible answer on when shedding is right.',
      ],
      modelAnswer: `**Part 1 — at-least-once for one subscription**

\`\`\`ts
interface AtLeastOnceOpts {
  maxAttempts: number;          // e.g. 5
  baseBackoffMs: number;        // e.g. 50
  deadLetter: (msg: unknown, attempts: number, err: unknown) => void;
}

class InFlight<T> {
  attempts = 0;
  nextAttemptAt = 0;
  constructor(readonly msg: T) {}
}

// In the subscription state:
//   queue: InFlight<T>[]   ← wraps the message with its attempts
//   the head stays until acknowledged

private async drainAtLeastOnce(s: SubState<any>): Promise<void> {
  while (s.active && s.queue.length > 0) {
    const item = s.queue[0];                     // PEEK, not shift
    if (this.clock.now() < item.nextAttemptAt) {
      this.scheduleAfter(s, item.nextAttemptAt - this.clock.now());
      return;                                    // back off, keep place
    }
    item.attempts++;
    try {
      await s.handler(item.msg);                  // resolve = ack
      s.queue.shift();                            // only now
    } catch (err) {
      if (item.attempts >= s.alo.maxAttempts) {
        s.queue.shift();
        s.deadLettered++;
        s.alo.deadLetter(item.msg, item.attempts, err);
      } else {
        const backoff = s.alo.baseBackoffMs * 2 ** (item.attempts - 1);
        item.nextAttemptAt = this.clock.now()
          + backoff * (0.5 + Math.random() * 0.5);   // jitter
        this.scheduleAfter(s, backoff);
        return;
      }
    }
  }
}
\`\`\`

**Four decisions worth defending.**

**Peek rather than shift, and remove only on acknowledgement.** That is the whole difference from at-most-once: **the message stays in the queue while it is being attempted**, so a crash mid-handler leaves it there for the next drain.

**Backoff is exponential with jitter, capped by \`maxAttempts\`.** Without a cap a permanently failing handler retries forever and **blocks its own queue behind the head message** — which is the head-of-line blocking the dead-letter path exists to break.

**Dead-letter is a callback rather than another topic.** Publishing dead letters back into the pub/sub is tempting and creates a cycle risk: **a dead-letter handler that also fails re-dead-letters.** A callback makes the boundary explicit.

**And backoff returns from the drain rather than sleeping in it**, so the drain loop does not hold the subscription while waiting — **which matters because the queue can still accept publishes during the backoff.**

**The invariant changes in two ways.**

**"Offered exactly once per subscription" becomes "offered at least once".** Duplicates are now guaranteed, **so the handler contract requires idempotency** — and that requirement must be documented at the subscribe call, because the handler author is the one who has to satisfy it.

**And effective queue capacity shrinks.** The head message occupies a slot while in flight and during backoff, **so a subscription with a queue of 1,024 and a failing head message can hold only 1,023 new messages** — and with a long backoff it drops while doing nothing. **Worth stating: at-least-once trades capacity for durability of attempt.**

---

**Part 2 — partitioned lanes**

\`\`\`ts
interface PartitionOpts<T> {
  partitionBy: (msg: T) => string;
  lanes: number;                     // e.g. 8
}

class LaneSet<T> {
  readonly queues: T[][];
  readonly draining: boolean[];
  constructor(readonly n: number) {
    this.queues = Array.from({ length: n }, () => []);
    this.draining = Array(n).fill(false);
  }
  laneFor(key: string): number {
    let h = 2166136261;                        // FNV-1a, stable
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i); h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % this.n;
  }
}

// publish path, per subscription:
const lane = lanes.laneFor(s.opts.partitionBy(msg));
if (lanes.queues[lane].length >= perLaneCapacity) { /* drop policy */ }
lanes.queues[lane].push(msg);
this.scheduleLaneDrain(s, lane);               // one flag PER LANE
\`\`\`

**Three decisions.**

**The hash must be stable and deterministic.** A key must always map to the same lane, **or two messages for the same order are handled concurrently and the ordering guarantee is void.** So no randomness, no insertion-order assignment, and no rehashing when the lane count changes — **changing \`lanes\` at runtime breaks ordering for keys in flight**, which is why it is constructor-only.

**One draining flag per lane, not per subscription.** That is what produces the guarantee: **serial within a lane, concurrent across lanes.** The per-subscription flag from the base design becomes per-lane, and everything else is unchanged.

**Capacity is per lane.** Total memory is lanes × per-lane capacity, **so eight lanes of 128 is the same memory as one queue of 1,024** — a useful way to present it, since it reframes partitioning as a reallocation rather than an increase.

*The honest limit:* **a hot key serialises.** If 80% of messages carry one order id, seven lanes are idle and one is saturated — **so the parallelism is only as good as the key distribution**, and a skewed distribution gets no benefit at all. **That is worth volunteering**, because it is the first question an interviewer asks.

*And a second limit:* **per-lane capacity means a hot key drops while other lanes are empty.** With a single queue that message would have been accepted. **Partitioning trades aggregate capacity for isolation between keys** — the same shape as the LRU sharding trade.

---

**Part 3 — shedding the subscriber**

\`\`\`ts
interface ShedOpts {
  fullForMs: number;              // e.g. 30_000
  onShed: (reason: 'stalled', stats: SubStats) => void;
}

// Recorded when the queue first becomes full:
if (s.queue.length >= s.opts.queueSize) {
  s.fullSince ??= this.clock.now();
  if (s.shed && this.clock.now() - s.fullSince >= s.shed.fullForMs) {
    this.forceUnsubscribe(s, 'stalled');
    return { delivered, dropped: dropped + 1 };
  }
  // ... normal drop policy
} else {
  s.fullSince = undefined;         // recovered
}

private forceUnsubscribe(s: SubState<any>, reason: 'stalled'): void {
  s.active = false;
  this.byTopic.get(s.topic)?.delete(s);
  s.queue.length = 0;                      // release the memory
  try { s.shed!.onShed(reason, statsOf(s)); } catch { /* isolated */ }
}
\`\`\`

**Three properties.**

**It sheds the subscriber, not the message** — which is the interesting inversion. The usual policy discards messages indefinitely while keeping a subscription that is provably not keeping up; **this removes the subscription and frees its memory.**

**\`fullSince\` distinguishes a burst from a stall.** A queue that fills and drains is healthy; **one that has been full for thirty seconds is not going to recover** — and the threshold is what separates the two rather than a single overflow event.

**And the notification is essential.** A silently removed subscription is worse than a dropping one: **the subscriber believes it is receiving messages and is not.** The callback lets it re-subscribe, alert, or degrade — and it is isolated in a try, because a shed handler that throws must not break the publish path.

*When this is right:* **when a stalled subscriber's messages are worthless without the ones it missed.** A projection builder that has dropped 200,000 events cannot be repaired by resuming — **it has to be rebuilt from a snapshot**, so shedding it and notifying is more useful than delivering a gap-ridden stream. Answered more fully below.

---

**Part 4 — why durability cannot be added**

**It cannot, and the reason is structural rather than a matter of effort: the queue is in memory in the same process as the publisher.**

\`\`\`
Process crashes → the heap is gone → the queue is gone
\`\`\`

**And every partial fix fails in a way worth naming.**

**"Write each message to disk before enqueueing."** Now \`publish\` performs a synchronous write, **so publish latency includes disk I/O** — which is the coupling the entire design exists to avoid, reintroduced for every subscriber including the fast ones. And a buffered write is not durable, so the property still does not hold.

**"Write asynchronously."** Then the window between accepting a message and persisting it **is exactly the window a crash loses** — so the guarantee is "durable, except during the interval where durability matters".

**"Periodically snapshot the queues."** The snapshot is stale by construction, **and restoring it replays messages the handler may already have processed** — so at-least-once semantics are required anyway, at which point the durable store is doing the work and the in-process queue is a cache of it.

**What I would do instead: tell the subscriber this is the wrong component.**

\`\`\`
Durability requires the message to be persisted OUTSIDE the
publishing process before publish returns.
That is a broker or a durable log — a different component
with a network hop and a fsync in its contract.
\`\`\`

**And the concrete migration is small**, which is the useful part of the answer:

\`\`\`
Publisher → durable log (append, acknowledged)
                 ↓
          log consumer  →  this PubSub.publish(topic, msg)
\`\`\`

**The in-process pub/sub keeps its job — fan-out to in-process subscribers with per-subscription policy — and the durability lives one layer up**, where a crash loses nothing because the consumer's position is in the log. **The two compose cleanly**, which is a better answer than either replacing the pub/sub or pretending it can be made durable.

*And the general principle:* **a guarantee that requires state to survive the process cannot be provided by state inside the process.** Every in-process attempt is a partial fix whose gap is exactly the failure it claims to handle — **so the honest answer names the boundary rather than moving it slightly.**

---

**What if the handler acknowledges and then the process crashes?**

**The message is lost, and there is nothing the design can do about it — which is worth stating plainly rather than hedging.**

\`\`\`
handler completes → queue.shift() → message gone from memory
process crashes before the handler's EFFECT is durable
→ the effect is lost and the message is not retryable
\`\`\`

**So "at-least-once" in process means at-least-once with respect to handler *invocation*, not with respect to the handler's effect.** That distinction is the whole limitation:

\`\`\`
Broker-based at-least-once:  the message is durable, so the
                             consumer's crash means redelivery
In-process at-least-once:    the message is in the same heap,
                             so the process's crash loses both
                             the message and the effect
\`\`\`

**Which means the retry machinery protects against handler *failures*, not process failures** — and those are genuinely different things. **A handler that throws gets retried; a process that dies does not.**

*And the implication for the handler author:* **making the handler idempotent buys nothing against a crash**, because the message will never be redelivered. **Idempotency here protects against retry duplicates only** — so the subscriber who wants crash safety needs Part 4's answer, not Part 1's.

*One thing that does help, and is worth offering:* **acknowledge after the effect is durable rather than after the handler returns.** If the handler writes to a database, the acknowledgement should follow the commit — **which is the handler's responsibility and the reason the contract is a promise it resolves.** It narrows the window to the interval between commit and shift, which is small but not zero.

---

**Is shedding the subscriber ever the right policy?**

**Yes, for one specific class of subscriber: those whose state is only meaningful if it is complete.**

\`\`\`
Metrics aggregator:      drop messages. A gap is a small
                         inaccuracy; keep running.
UI update handler:       drop messages. Only the latest
                         state matters.
Projection builder:      SHED. A projection with a 200,000
                         event gap is silently wrong, and
                         it will stay wrong forever.
Cache invalidator:       SHED. A missed invalidation means
                         serving stale data indefinitely —
                         worse than being disconnected.
\`\`\`

**The distinguishing question is whether a gap is self-healing.**

**A metric recovers**, because the next window is computed from fresh data. **A projection does not** — the missed events are gone, so the derived state is permanently divergent, and **continuing to deliver makes it look healthy while it is wrong.**

**Which reframes shedding: it converts a silent correctness failure into a loud availability failure.** The subscriber stops and knows it stopped, **so it can rebuild from a snapshot rather than serving wrong answers.** That is exactly the trade the payments lesson made when a broken invariant halts payouts.

*And the requirement that makes it work is the notification.* Shedding without telling anyone is worse than dropping — **the subscriber believes it is subscribed.** So \`onShed\` is not a convenience; **it is what makes the policy defensible**, because the subscriber's recovery path starts there.

*One refinement I would offer:* **shed and report what was missed** — the drop count, the stall duration, and the last message successfully handled. **A projection builder with a last-handled marker can decide whether to resume from a snapshot or rebuild entirely**, which is a much better position than "you were disconnected at some point".`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lps-1',
      level: 'basic',
      question: 'Design and implement an in-process pub/sub.',
      guidance:
        'Look for the slow-subscriber question raised early. A synchronous loop over handlers has chosen "block the publisher" without noticing, and everything else follows from fixing that.',
    },
    {
      id: 'iq-lps-2',
      level: 'basic',
      question: 'What happens when one subscriber is much slower than the publisher?',
      guidance:
        'Three answers — block, unbounded, bounded — with only the bounded queue stable. Strong answers state the queue is per subscription and say why.',
    },
    {
      id: 'iq-lps-3',
      level: 'intermediate',
      question: 'What delivery guarantee do you provide?',
      guidance:
        'At-most-once by default, at-least-once opt-in per subscription with backoff, a cap and a dead-letter path. Exactly-once does not exist.',
    },
    {
      id: 'iq-lps-4',
      level: 'intermediate',
      question: 'Is delivery ordered?',
      guidance:
        'Per subscription, and only while handling is serial. Look for the condition being stated rather than the guarantee being promised unconditionally.',
    },
    {
      id: 'iq-lps-5',
      level: 'advanced',
      question: 'A subscriber needs ordering and higher throughput. How?',
      guidance:
        'Serial lanes partitioned by a message key. Excellent answers note that a hot key serialises and that the lane hash must be stable.',
    },
    {
      id: 'iq-lps-6',
      level: 'advanced',
      question: 'A handler unsubscribes itself during dispatch. What happens?',
      guidance:
        'Iterate a snapshot, or the next subscriber is silently skipped. Excellent answers state the consequence that a cancelled subscription may still receive that message.',
    },
    {
      id: 'iq-lps-7',
      level: 'followup',
      question: 'Messages must survive a process restart. Can you add that?',
      guidance:
        'No — state in the process cannot outlive the process, and every partial fix has a gap exactly where durability matters. Propose a durable log in front instead.',
    },
    {
      id: 'iq-lps-8',
      level: 'followup',
      question: 'Would you ever remove a subscriber rather than drop its messages?',
      guidance:
        'Yes, when a gap is not self-healing — a projection or a cache invalidator. It converts a silent correctness failure into a loud availability one, and the notification is what makes it defensible.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lps-1',
      kind: 'debug',
      prompt:
        'An application using in-process pub/sub reports that a projection built from events is occasionally missing entries. The pub/sub reports zero drops, the projection handler has no errors logged, and replaying the same events in a test reproduces nothing. Diagnose it.',
      discussion: `**Zero drops and no handler errors, with entries still missing**, rules out the two obvious causes and points somewhere specific: **the message was never offered to the subscription at all.**

That narrows to the subscribe and publish paths rather than the queue.

**Hypothesis 1 — the subscribe-during-dispatch race.**

The invariant says a message is offered to each subscription *active at publish time*. **A subscription created while a publish is in flight does not receive that message** — which is correct by the contract and surprising in practice.

\`\`\`
startup: module A publishes seed events
         module B subscribes during initialisation
→ B misses whatever was published before its subscribe
→ and the projection has a gap at the beginning
\`\`\`

*Why it fits:* **zero drops** (nothing was enqueued to drop), **no errors**, and **it does not reproduce in a test** where subscription happens before any publish. **This is my leading hypothesis** because it explains all three negatives at once.

*Check:* whether subscription and the first publish are ordered deterministically at startup. **A gap concentrated at the beginning of the projection is conclusive.**

**Hypothesis 2 — the unsubscribe-during-dispatch skip.**

If publish iterates the live set and some handler unsubscribes, **a subscriber positioned after it is silently skipped.** Zero drops, no errors, intermittent.

*Why it fits the non-reproducibility:* it depends on **iteration order and on another handler unsubscribing** — both of which a focused test usually does not arrange.

*Check:* whether publish iterates a snapshot, and whether any handler on that topic unsubscribes. **One-line fix if this is it**, and the test is the one from the lesson.

**Hypothesis 3 — the projection handler is unordered, so entries are applied out of sequence and one overwrites another.**

**Not a missing delivery but a missing *effect*.** If \`ordered: false\` and the handler does read-modify-write on the projection, **two overlapping invocations can each read the same state and the second write loses the first's entry.**

\`\`\`
event 1 → read state, add A, write
event 2 → read state (before 1's write), add B, write
→ A is gone. Nothing dropped, nothing threw.
\`\`\`

*Why it fits perfectly:* zero drops, no errors, **and it reproduces only under concurrency** — a test replaying events sequentially never triggers it. **This is the strongest alternative to hypothesis 1.**

*Check:* the subscription's \`ordered\` setting, and whether the handler is async. **An async handler on an unordered subscription is the signature**, and the fix is either ordered handling or partitioning by the projection key.

**Hypothesis 4 — the topic string differs subtly.**

\`publish('order.created')\` versus \`subscribe('orders.created')\`, or a topic built by interpolation that sometimes produces a different string. **With exact matching, a mismatch means no subscriber and no drop** — and \`publish\` returns \`delivered: 0\`, which nobody checks.

*Why it fits:* completely silent, and **intermittent if the topic is constructed** — say a tenant id embedded in the topic where one code path omits it.

*Check:* whether publishes ever return \`delivered: 0\` for this topic. **That metric is the whole diagnosis**, and it is the reason \`publish\` returns a result at all.

**Hypothesis 5 — the drop counter is per subscription and someone is reading the wrong one.**

"The pub/sub reports zero drops" may mean **a global counter, or the wrong subscription's counter.** With per-subscription accounting, a naive aggregate can miss the one that matters.

*Check:* the drop count for *this subscription specifically*, and whether the projection subscription has a smaller queue than the others.

**What I would check first: whether publish ever returns \`delivered: 0\` for this topic, and the projection subscription's own drop and ordering settings.** Two cheap checks, and together they cover hypotheses 3, 4 and 5 — **the three that are configuration or measurement rather than a race.**

**Then: the startup ordering of subscribe versus publish.** Hypothesis 1 explains the negatives most economically, **and a gap concentrated early in the projection is a strong tell.**

**Why "replaying the events in a test reproduces nothing" is the most useful fact.**

It eliminates every hypothesis about the *messages* and points at the *context in which they were published*. **The events are fine; something about the live system's timing, ordering or wiring differs from the test.**

**And that is a short list: subscription timing, iteration during mutation, handler concurrency, and topic construction.** All four are properties of the environment rather than of the data — **which is exactly why a data-replay test cannot find them.**

**The instrumentation this demands.**

**\`publish\` results must be recorded, not discarded.** A \`delivered: 0\` on a topic that should have subscribers is a wiring bug, **and it is invisible unless the return value is used.** This is the single highest-value addition and it is why the method returns a result.

**Per-subscription counters, exposed individually:** delivered, dropped, failures, queue depth, and last-handled timestamp. **An aggregate hides the one subscription that is misbehaving**, which is hypothesis 5 as a measurement failure.

**A sequence number per topic, checked by order-sensitive subscribers.** The projection handler can assert that it sees \`n+1\` after \`n\` and **report a gap immediately** — which converts a silent correctness failure into a loud one, exactly as the shed-the-subscriber policy does. **For a projection this is worth more than any pub/sub metric**, because it detects the problem regardless of cause.

**And an explicit startup phase.** Subscriptions registered before any publishing begins, **with an assertion that no publish occurs during the wiring phase** — which makes hypothesis 1 structurally impossible rather than a timing accident.

**Transferable:** when a consumer is missing data and the transport reports no loss, **the message was either never offered or its effect was overwritten.** Both are invisible to the transport, so the consumer needs its own continuity check — **a sequence number is cheap and it is the only thing that detects a gap whatever caused it.**`,
    },
    {
      id: 'al-lps-2',
      kind: 'what-changes-if',
      prompt:
        'Change the scope: the same API must now deliver to subscribers in other processes on other machines. Which parts of this design survive, and which become somebody else\'s problem?',
      discussion: `**The API can survive almost unchanged, and nearly every guarantee behind it changes hands** — which is the useful thing to trace, because it shows which decisions were essential and which were consequences of being in one process.

**What survives, and survives better.**

**The per-subscription policy idea.** Queue size, drop policy, ordering and delivery guarantee remain per subscription — **and in a distributed setting they matter more**, because subscribers now differ by orders of magnitude in speed rather than a little.

**The at-most-once versus at-least-once choice**, unchanged in shape and now with a third possibility: **the broker can hold messages for a disconnected subscriber**, which in-process it could not.

**Ordering per key rather than per topic.** The partitioned-lanes design becomes **partitions in the broker**, which is where that model came from — **so the in-process version was a small copy of the distributed one**, and it scales up directly.

**And the snapshot-iteration semantics survive** as "the subscriber set at publish time", which a broker resolves the same way.

**What becomes the broker's problem.**

**Backpressure.** The single decision the whole in-process design turned on **is now absorbed by infrastructure**: the broker holds messages, and the publisher is decoupled from the subscriber by a durable buffer rather than by an in-memory queue you sized.

*Which is worth noticing carefully:* **the problem does not disappear, it moves and changes shape.** The broker's queue is bounded too, and its policies — retention, consumer lag limits, dead-lettering — are the same three answers you had, **chosen by configuration rather than by code.** A subscriber that stays behind still loses messages once retention passes.

**Durability**, which in process was impossible. **The broker's fsync is what makes at-least-once mean at-least-once with respect to effects rather than merely invocations** — which is the Part 4 limitation from the exercise, resolved by moving the buffer out of the process.

**And the drain loop.** Delivery becomes a network operation with its own retries, timeouts and connection management, **so the per-subscription drain is replaced by a consumer client** — and much of the code you wrote is deleted rather than adapted.

**What becomes genuinely harder, and is new.**

**Delivery is now a distributed problem, so the acknowledgement has the payments lesson's ambiguity.**

\`\`\`
In process:   the handler returned, so it ran. Certain.
Distributed:  the ack may be lost in flight
              → the broker redelivers
              → the handler runs twice
              → so idempotency stops being advisory and
                becomes mandatory
\`\`\`

**Idempotency was optional for in-process at-least-once and is now unavoidable**, because the ambiguity is structural rather than a retry artefact.

**Serialisation appears, and with it schema evolution.** In process a message is an object reference — **no copying, no versioning, and a shared type.** Across processes it is bytes, so **the publisher and subscriber can disagree about the shape**, and a field added by one deploys before the other.

*That is a whole new category of failure* that had no in-process analogue: **a message that is delivered, acknowledged, and misinterpreted.**

**And partial failure becomes possible.** In process, either the publisher ran or it did not. **Distributed, the publisher can succeed while the broker is unreachable** — so \`publish\` must itself have a retry, a timeout and a local buffer, which means the publisher now needs the design you just moved to the broker. **Buffering reappears on the other side.**

**The consequence for the API, which is the interesting part.**

\`\`\`ts
publish(topic, msg): PublishResult        // in-process: synchronous,
                                          // truthful, immediate
publish(topic, msg): Promise<PublishResult>  // distributed: may fail,
                                             // may time out, may
                                             // succeed ambiguously
\`\`\`

**The return type has to change**, and that is the honest signal — **the same argument as the logger's audit method.** An API that keeps a synchronous signature while doing network I/O is lying about its cost and its failure modes, **and every call site will treat it as if it cannot fail.**

*So the API does not quite survive unchanged*, and the one change is the important one: **the possibility of failure becomes visible in the type.**

**What I would build.**

\`\`\`
Keep:    the subscription options model, the per-key ordering
         concept, the at-most/at-least-once distinction
Replace: the queue and drain loop → a broker client
Add:     serialisation with a versioned schema,
         mandatory idempotency for at-least-once,
         a publisher-side buffer with its own bounded policy,
         and an async publish signature
Delete:  most of the drain, lane and backpressure code —
         the broker does it
\`\`\`

**And the composition from the exercise's Part 4 is the migration path**: a durable log in front, with this pub/sub retained for in-process fan-out behind it. **Two components, each doing what it can guarantee.**

**The transferable point:** moving a boundary outward does not remove a problem, **it relocates it and adds ambiguity at the new boundary.** Backpressure and durability become configuration instead of code; **acknowledgement ambiguity, serialisation and partial failure appear where there was previously certainty** — and the API's return type is where that change has to become visible, or the call sites will keep assuming the old guarantees.`,
    },
  ],

  revision: {
    bullets: [
      'One question decides the design: what happens to a slow subscriber.',
      'In process there is no broker to absorb the mismatch, so the policy lives in your code.',
      'Three answers: block the publisher, an unbounded queue, or a bounded queue that drops.',
      'Only the bounded queue is stable under a permanent mismatch.',
      'Synchronous dispatch has chosen "block the publisher" without noticing.',
      'And publish then costs the sum of its subscribers, which the publisher cannot predict.',
      'The queue must be per subscription: a shared one lets the slowest set the pace for all.',
      'Options belong to the subscriber, because only it knows what its messages are worth.',
      'publish returns a drop count — silent loss leaves the publisher unable to react.',
      'A single per-subscription draining flag is where the ordering guarantee physically lives.',
      'Ordering and parallelism are exclusive per subscription.',
      'Partition into serial lanes by key for order within a key and parallelism across keys.',
      'A hot key still serialises, so the parallelism is only as good as the key distribution.',
      'At-most-once by default; at-least-once needs acks, backoff, a cap and a dead-letter path.',
      'Exactly-once does not exist — it is at-least-once plus an idempotent handler.',
      'In-process at-least-once protects against handler failures, not process failures.',
      'Iterate a snapshot of the subscriber set, or a self-unsubscribing handler skips the next one.',
      'Durability cannot be added in process: state inside the process cannot outlive it.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A topic-keyed fan-out where each subscription owns a bounded queue, a drop policy, a delivery guarantee and a drain loop — so publish enqueues and returns, and a slow subscriber affects only itself.',
    whyItExists:
      'Because a publisher and its subscribers run at different speeds and there is no broker in the middle. Someone has to absorb the mismatch, and the only stable answer is a counted loss per subscription rather than a blocked publisher or an unbounded queue.',
    whenToUse: [
      'A bounded per-subscription queue whenever subscriber speed is not guaranteed.',
      'At-most-once by default for notifications, metrics and cache invalidation.',
      'At-least-once opt-in when a miss is a business error and the handler can be idempotent.',
      'Serial lanes by key when a subscription needs ordering and throughput.',
      'Shedding the subscriber when a gap in its stream is not self-healing.',
    ],
    whenNotToUse: [
      'Synchronous dispatch to unknown subscribers.',
      'Blocking the publisher when a queue is full.',
      'Unbounded queues.',
      'A single shared delivery queue.',
      'Promising exactly-once, or unconditional ordering.',
      'Iterating the live subscriber list during dispatch.',
      'Unordered delivery without a concurrency limit.',
      'In-process queues where durability is required.',
    ],
    alternatives: [
      'A durable log in front, with in-process fan-out behind it, when messages must survive a restart.',
      'A broker, when subscribers live in other processes — which moves backpressure into configuration and adds acknowledgement ambiguity.',
      'A resolved-subscriber cache per concrete topic, if pattern subscriptions are required.',
      'Shedding the subscriber with a notification, instead of dropping indefinitely.',
      'A dead-letter callback rather than a dead-letter topic, to avoid a re-dead-lettering cycle.',
    ],
    tradeoffs: [
      'Per-subscription queues buy isolation and cost subscribers × queue size in memory.',
      'Bounded queues buy stability and cost counted message loss.',
      'At-least-once buys attempt durability and costs duplicates plus effective queue capacity.',
      'Ordered delivery buys sequence and costs all parallelism within the subscription.',
      'Partitioned lanes buy both and cost a lane per partition, bounded by key skew.',
      'Snapshot iteration buys safe mutation and costs a possible delivery to a cancelled subscription.',
      'Shedding buys a loud failure instead of a silent one and costs the subscription entirely.',
    ],
    failureModes: [
      'Publish costing the sum of its subscribers, changing as modules are added.',
      'An unbounded queue exhausting memory and killing every subscriber.',
      'A shared queue letting one slow handler delay everyone.',
      'A self-unsubscribing handler causing the next subscriber to be silently skipped.',
      'An exception from one handler aborting the loop and reaching the publisher.',
      'An "ordered" subscription whose async handler is not awaited.',
      'A permanently failing at-least-once handler blocking its own queue head.',
      'Dead letters published back into the pub/sub, creating a cycle.',
      'A topic string mismatch producing delivered: 0 that nobody reads.',
      'A subscription created after the publishes it needed.',
      'Claiming durability for in-memory queues.',
    ],
    followUpQuestions: [
      'What happens when a subscriber is ten times slower than the publisher?',
      'Is the queue per subscription or shared?',
      'What is the queue size, and what does overflow do?',
      'Does publish report what it dropped?',
      'Is delivery at-most-once or at-least-once, and per subscription?',
      'Is ordering guaranteed, and under what condition?',
      'How would a subscription get both ordering and parallelism?',
      'What happens if a handler unsubscribes during dispatch?',
      'What happens if a handler publishes?',
      'Does at-least-once here survive a process crash?',
      'Would shedding the subscriber ever be better than dropping messages?',
    ],
  },
});
