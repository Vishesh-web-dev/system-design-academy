import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-delivery-semantics',
  title: 'Delivery semantics and ordering',
  summary:
    '"Exactly once" delivery does not exist across a network. What exists is at-least-once delivery plus idempotent processing, and every system that claims otherwise is doing that internally with a boundary you must respect.',
  phase: 'distributed',
  module: 'messaging',
  position: 30,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['delivery-semantics', 'idempotency', 'ordering', 'deduplication', 'acknowledgement'],
  prerequisites: ['d-queues-vs-logs', 'f-idempotency'],
  resources: [
    {
      key: 'kafka-delivery-semantics',
      tier: 'must',
      note: 'Read the message-delivery-semantics section directly. It is unusually honest about where the guarantees begin and end, and about what the producer and consumer each contribute.',
    },
    {
      key: 'kafka-exactly-once-confluent',
      tier: 'must',
      note: 'Read this specifically for the boundary: what the transactional producer and read-process-write cycle cover, and why an external side effect falls outside it. That boundary is the whole subject.',
    },
    {
      key: 'stripe-idempotent-requests',
      tier: 'must',
      note: 'The reference implementation of idempotency keys as a public API contract. Read the key lifetime and the behaviour on a retried request with a different body.',
    },
    {
      key: 'aws-sqs-fifo',
      tier: 'good',
      note: 'Read the deduplication-interval and message-group sections. It shows both what a broker can do about duplicates and the narrow window in which it works.',
    },
    {
      key: 'paypal-idempotency',
      tier: 'good',
      note: 'A second public treatment of idempotency keys, useful for contrast on key scoping and on what happens when a retry arrives while the original is still in flight.',
    },
    {
      key: 'kafka-consumer-groups',
      tier: 'advanced',
      note: 'Read the offset-commit material. When you commit relative to processing is the single decision that makes a consumer at-least-once or at-most-once.',
    },
  ],

  intuition: {
    body: `There are three delivery semantics, and only two of them are real.

**At-most-once.** Send it, do not retry. A message may be lost and will never be duplicated. Almost never what you want, and cheap.

**At-least-once.** Retry until acknowledged. No message is lost and some are delivered twice. **This is what every real system provides.**

**Exactly once.** Each message is delivered and processed precisely once. **This is not achievable across a network boundary**, and understanding why takes thirty seconds and saves years.

Here is why. A sender transmits a message and waits for an acknowledgement. The acknowledgement does not arrive. **Two things are indistinguishable from the sender's position:** the message was lost, or the message arrived and the acknowledgement was lost. The sender must choose:

- **Retry** → if the message did arrive, it is now a duplicate. That is at-least-once.
- **Do not retry** → if the message did not arrive, it is lost. That is at-most-once.

There is no third option, and no amount of protocol removes the ambiguity — because any acknowledgement of the acknowledgement has the same problem, forever. This is the **two-generals** situation, and it is a genuine impossibility rather than an engineering gap.

So what do systems mean when they advertise exactly-once?

**They mean at-least-once delivery plus deduplication inside a boundary they control.** A broker's transactional producer can make "consume from topic A, process, produce to topic B, commit the offset" atomic, because all three are inside the same system. Genuinely useful, and precisely bounded: **the moment your processing has an effect outside that system — an HTTP call, an email, a row in a different database — you are back to at-least-once.**

Which leads to the framing that actually matters in practice:

> **Exactly-once processing = at-least-once delivery + idempotent processing.**

Stop trying to make delivery exact. Make **processing** idempotent, so a duplicate delivery is harmless. Then at-least-once delivery is sufficient, and you have a system whose correctness does not depend on an impossible guarantee.

The second half of this lesson is ordering, which has the same structure: guarantees are narrower than they appear, and the durable fix is to make consumers not need them.`,
    analogyLimit:
      'Treating "exactly once" as a feature to buy is the error. It is a property of your *processing*, not of the transport, and it is achieved by making duplicates harmless rather than by preventing them. A broker\'s exactly-once mode is real inside its own boundary and stops at the first external side effect — so a design that relies on it without knowing where that boundary sits has a duplicate-charge bug it cannot see.',
  },

  deepExplanation: {
    predict: {
      question:
        'A payment consumer reads "order placed" from a broker configured for exactly-once semantics, calls the payment provider to charge the card, and writes a payment record to its own database. The team believes duplicate charges are impossible. Trace a sequence that produces one, and say what would actually prevent it.',
      answer: `**The sequence.**

1. The consumer reads the order message at offset 500.
2. It calls the payment provider. **The charge succeeds** — money has moved.
3. The provider's response is lost, or the consumer crashes before receiving it, or the consumer is killed between the charge and its database write.
4. The offset was never committed, because the consumer did not finish.
5. The consumer restarts, reads offset 500 again — **correctly**, this is at-least-once working as designed.
6. It calls the payment provider again. **The card is charged a second time.**

**Why the broker's exactly-once mode did not help, and this is the whole point.**

The broker's transactional guarantee covers *its own* operations: reading from a topic, producing to a topic, and committing the offset can be made atomic **because all three are inside the broker**. It can roll them back together.

The payment provider is not inside the broker. The broker cannot know a charge happened, cannot roll it back, and cannot include it in its transaction. **Exactly-once semantics stop at the boundary of the system providing them**, and the team's belief was a misreading of where that boundary sits.

The database write has the same problem for the same reason — it is a second external system, so "charge and record" is itself a dual-write.

**What actually prevents it, in order of importance.**

**1. An idempotency key on the charge, derived deterministically from the message.** Not a random UUID generated per attempt — that would differ on each retry and defeat the whole mechanism. Something stable: the order id, or a hash of \`(order_id, "charge")\`. The provider records the key and returns the *original* result for any repeat, so the second call returns the first charge rather than creating a new one.

**This is the load-bearing fix.** It works regardless of how many times the consumer retries, whether it crashed before or after the call, or whether the broker redelivered.

**2. Write the payment record with a unique constraint on the same key.** So even if the record write is retried, the second insert fails with a duplicate-key error the consumer treats as "already recorded".

**3. Commit the offset only after both the charge and the record are complete.** This is at-least-once done correctly: it guarantees no message is skipped, and it guarantees duplicates, which step 1 has made harmless.

**4. Prefer a durable local record of intent before the external call.** Write "charge attempted for order 500, key X" to the local database, then charge, then update to "completed". On restart, a row in "attempted" state tells the consumer to *query* the provider by key rather than blindly re-charge. This narrows the window further and gives an audit trail — and it is the difference between a design that is correct and one that is also debuggable.

**What would be wrong to reach for.**

**A distributed lock** so only one consumer processes the order. It reduces concurrency and does nothing about the crash-and-restart sequence above, which is sequential rather than concurrent.

**Committing the offset before processing.** That converts duplicates into losses — at-most-once — which for a payment is strictly worse: an unpaid order is harder to detect than a double charge, because nobody complains about not being billed.

**Checking "has this order been charged?" before charging.** The check and the charge are not atomic, so a crash between them reproduces the bug. It also cannot detect a charge that succeeded while the response was lost, which is the exact failure at hand.

**The general lesson.** The question is never "does the broker guarantee exactly once". It is **"what is the boundary of that guarantee, and what does my processing do outside it?"** Every external effect needs an idempotency key derived deterministically from the message, and the transport's guarantees are irrelevant to it.`,
    },
  body: `## Where each semantic comes from

Delivery semantics are not a single setting. They are produced by **two independent decisions**, one at the producer and one at the consumer.

**Producer side.**

| Behaviour | Result |
| --- | --- |
| Fire and forget, no acknowledgement | At-most-once — messages lost on failure |
| Wait for acknowledgement, retry on failure | At-least-once — duplicates on ack loss |
| Retry with a producer sequence number the broker deduplicates | Effectively once *into the broker* |

That third row is real and worth knowing: a producer that stamps each message with a monotonic sequence number lets the broker discard a retransmission it has already stored. It removes duplicates caused by *producer* retries, and it does nothing about duplicates caused by consumer redelivery.

**Consumer side — and this is the decision that dominates.**

The whole thing turns on **when you commit the offset or acknowledge the message, relative to processing**:

\`\`\`
Commit BEFORE processing:  at-most-once
  crash after commit, before processing → message skipped, silently

Commit AFTER processing:   at-least-once
  crash after processing, before commit → message reprocessed
\`\`\`

That is the entire mechanism. One line of code placement decides which semantic your consumer has, and **almost always you want commit-after-processing**, because a duplicate you have made harmless is far better than a silent loss.

The failure worth naming explicitly: a consumer that commits in a \`finally\` block, or after catching an exception, has accidentally chosen at-most-once. Processing failed, the offset advanced, and the message is gone with only a log line. This is the most common accidental data-loss bug in message consumers.

## Idempotency: the actual solution

Since delivery is at-least-once, correctness must come from processing being idempotent — the same message processed twice has the same effect as once.

**Naturally idempotent operations.** Setting an absolute value (\`status = 'shipped'\`), deleting by id, adding to a set. Process these twice and nothing changes. Where you have a choice, **prefer absolute assignments over deltas** — it is the cheapest idempotency available.

**Not naturally idempotent.** Incrementing a counter, appending to a list, sending an email, charging a card. These need a mechanism.

**The mechanisms, in ascending cost:**

**1. A deterministic natural key plus a unique constraint.** The strongest and simplest. If an event's effect is a row, derive its key from the event — \`(order_id, 'confirmation_email')\` — and put a unique constraint on it. A duplicate insert fails with a constraint violation the consumer treats as success. **The database enforces it, so no code path can bypass it.**

**2. A deduplication table.** Record each processed message id, and check before processing. Two subtleties: the check and the processing must be atomic — insert the id in the *same transaction* as the effect, or a crash between them reproduces the bug — and the table needs a retention policy, or it grows forever.

**3. Idempotency keys on external calls.** For effects in systems you do not control, pass a key derived deterministically from the message. The provider returns the original result for a repeat. **The key must be derived from the message, not generated per attempt** — a fresh UUID per retry makes the mechanism useless, and this is a real and common mistake.

**4. Conditional updates with a version.** \`UPDATE ... WHERE version = ?\`. A duplicate finds the version already advanced and matches zero rows. Requires checking the affected-row count, which is the step people skip.

**5. Deterministic output addressing.** If the effect is a file, write it to a key derived from the message — \`invoices/{invoice_id}.pdf\`. A duplicate overwrites identical content. This converts a hard delivery problem into a trivial one and is available more often than people notice.

**The mechanism that does not work: "check whether it has been done, then do it."** The check and the action are not atomic, so a crash or a concurrent consumer between them reproduces the duplicate. The check must be *part of* the action — a constraint, a conditional update, or a same-transaction insert.

## Ordering: narrower than it looks

**What a log guarantees:** order within a partition. Nothing across partitions.

So "these events must be ordered" means "these events must share a partition", which means keying by whatever defines the ordering scope — the order id, the account id, the entity id. That is the partitioning lesson's decision arriving again, with its hot-key consequence.

**What breaks ordering even within a partition:**

**Concurrent processing.** A consumer that reads a batch and processes it across a thread pool has discarded the ordering the broker provided. This is extremely common and usually unnoticed, because it only manifests when two events for the same key land in one batch.

**Retries.** If message 4 fails and is sent to a retry topic while 5 and 6 proceed, 4 is now processed after 6. **Retry mechanisms and ordering are fundamentally in tension**, and you cannot have per-message retry and strict ordering simultaneously.

**Producer retries without sequence numbers.** A retransmitted message can be appended after a later one, reordering them at the source.

**Multiple producers.** Two producers writing related events to one partition have no defined order between them. Ordering is per partition, not per key across producers.

**The durable fix: make consumers not need ordering.** Three techniques:

**Absolute state plus a version.** Events carry the full current value and a monotonic version. The consumer rejects any event whose version is not greater than what it has applied. Out-of-order events are discarded harmlessly. **This is the single most valuable technique in this lesson** — it makes ordering an optimisation rather than a correctness requirement, and it also makes processing idempotent for free.

**Commutative operations.** If the operations commute — set union, max, counter increments handled by a CRDT — order does not matter by construction.

**Event-time reordering.** Buffer briefly and sort by an event timestamp before processing. Bounded correctness at the cost of latency, and it needs a decision about how long to wait for a late event.

## Poison messages and the retry/ordering trade

A message that always fails must go somewhere. Under at-least-once with strict ordering, it blocks everything behind it.

**Ordered, blocking.** Retry forever in place. Ordering preserved; the partition stops. Correct for a strict-ordering requirement and it means one bad message halts a stream.

**Unordered, non-blocking.** Move it to a retry topic with backoff, then a dead-letter topic. The stream flows; that message is now out of order relative to its siblings.

**You must choose.** The honest position in a design discussion is: "strict ordering means a poison message blocks the partition; if that is unacceptable, we need version-based idempotency so ordering is not required."

Two operational requirements regardless of choice:

**A dead-letter destination with an alert and an owner.** A dead-letter queue nobody watches is equivalent to dropping the message.
**The ability to replay from it** once the bug is fixed, preserving the original key and payload.

## Where these concerns do not apply

**Genuinely idempotent operations need none of this.** If the message says "set status to shipped", duplicates and reordering are both harmless. Recognising this saves a great deal of machinery, and it is a reason to shape events as absolute state.

**Truly independent events need no ordering.** Clickstream, metrics, log lines. Do not pay for ordering you do not need — it costs partition keying and consumer parallelism.

**Synchronous request/response has different mechanics.** The caller sees the outcome, so a retry with an idempotency key is the whole story and there is no offset to commit.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'ack-ambiguity',
      title: 'Why exactly-once cannot exist',
      caption:
        'The branch at the top is undecidable from the sender\'s position, and every acknowledgement of an acknowledgement has the same branch. There is no third option — only a choice about which failure you prefer.',
      code: `flowchart TB
    S["Sender transmits,<br/>waits for ack.<br/>**No ack arrives.**"]

    S --> U["Two indistinguishable causes"]
    U --> U1["The message was lost"]
    U --> U2["The message arrived;<br/>the ACK was lost"]

    U1 --> D["Sender must decide"]
    U2 --> D

    D --> R["Retry"] --> R2["If it did arrive:<br/>**duplicate**<br/>= at-least-once"]
    D --> N["Do not retry"] --> N2["If it did not arrive:<br/>**lost**<br/>= at-most-once"]

    R2 --> F["**The way out:**<br/>make processing idempotent,<br/>so duplicates are harmless"]

    style R2 fill:#1c1814,stroke:#c99a4e
    style N2 fill:#2a1a1a,stroke:#a04848
    style F fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'boundary',
      title: 'Where the exactly-once boundary actually is',
      caption:
        'Step through it. Everything inside the dashed region can be made atomic by the broker; the two systems outside it cannot. A design that relies on exactly-once without locating this line has a duplicate-effect bug it cannot see.',
      nodes: [
        { id: 'topicA', label: 'Topic A', kind: 'store', x: 0, y: 180, detail: 'The source. Reading from it is one of the three operations the broker can include in a transaction.' },
        { id: 'consumer', label: 'Consumer', kind: 'service', x: 190, y: 180, detail: 'Reads, processes, produces, commits. Whether this consumer is at-least-once or at-most-once is decided by one thing: whether it commits before or after processing.' },
        { id: 'topicB', label: 'Topic B', kind: 'store', x: 400, y: 90, detail: 'Producing here is inside the broker, so it can be made atomic with the read and the offset commit. This is the real, bounded exactly-once guarantee.' },
        { id: 'offset', label: 'Offset commit', kind: 'store', x: 400, y: 250, detail: 'Also inside the broker. Read, produce and commit together form the read-process-write cycle the transactional producer covers.' },
        { id: 'boundary', label: 'Broker boundary', kind: 'note', x: 400, y: 170, detail: 'Everything inside can be rolled back together. Nothing outside can. This line is what "exactly-once semantics" actually means, and locating it is the design question.' },
        { id: 'payment', label: 'Payment provider', kind: 'service', x: 640, y: 90, detail: 'Outside. The broker cannot know a charge happened and cannot roll it back. Needs an idempotency key derived deterministically from the message — never a fresh UUID per attempt.' },
        { id: 'db', label: 'Application database', kind: 'store', x: 640, y: 250, detail: 'Also outside. Needs a unique constraint on a key derived from the message, so a duplicate insert fails as a constraint violation rather than creating a second effect.' },
        { id: 'email', label: 'Email provider', kind: 'service', x: 640, y: 350, detail: 'Outside, and the hardest: a sent email cannot be un-sent. Needs a deduplication record written in the same transaction as the send decision.' },
      ],
      edges: [
        { id: 'b1', source: 'topicA', target: 'consumer', kind: 'read' },
        { id: 'b2', source: 'consumer', target: 'topicB', kind: 'write' },
        { id: 'b3', source: 'consumer', target: 'offset', kind: 'write' },
        { id: 'b4', source: 'consumer', target: 'payment', kind: 'sync' },
        { id: 'b5', source: 'consumer', target: 'db', kind: 'write' },
        { id: 'b6', source: 'consumer', target: 'email', kind: 'sync' },
      ],
      steps: [
        {
          id: 'bd1',
          title: 'The consumer\'s semantic is one line of code',
          description:
            'Commit the offset before processing and you have at-most-once — a crash after commit silently skips the message. Commit after processing and you have at-least-once. Almost always choose the latter.',
          nodes: ['topicA', 'consumer', 'offset'],
          edges: ['b1', 'b3'],
        },
        {
          id: 'bd2',
          title: 'Inside the broker, exactly-once is real',
          description:
            'Read from A, produce to B, commit the offset — all three inside one system, so they can be made atomic and rolled back together. This is a genuine and useful guarantee.',
          nodes: ['topicB', 'boundary'],
          edges: ['b2', 'b3'],
        },
        {
          id: 'bd3',
          title: 'The payment call is outside it',
          description:
            'The broker cannot know the charge happened and cannot undo it. A crash after charging and before committing means the charge happens again — which is why the idempotency key must come from the message, not from the attempt.',
          nodes: ['payment'],
          edges: ['b4'],
        },
        {
          id: 'bd4',
          title: 'So is the database write',
          description:
            'A second external system, so "charge and record" is itself a dual write. A unique constraint on a message-derived key makes the duplicate insert fail rather than duplicate the effect.',
          nodes: ['db'],
          edges: ['b5'],
        },
        {
          id: 'bd5',
          title: 'And an email cannot be undone at all',
          description:
            'The irreversible case. The deduplication record must be written in the same transaction as the decision to send, so a crash cannot produce a send with no record of it.',
          nodes: ['email'],
          edges: ['b6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['stripe'],
    body: `Stripe's idempotency-key contract is the clearest production treatment of this material, because it makes the guarantee explicit at an API boundary where exactly-once delivery is impossible by construction.

**The contract.** A client sends \`Idempotency-Key: <value>\` on a request that creates something. Stripe records the key with the response. If the same key arrives again, Stripe returns the **original response** rather than performing the operation again.

Four details that carry the real lessons.

**The key is the client's responsibility, and its derivation is the design decision.** Stripe cannot generate it — only the client knows that this retry is the same logical operation as the earlier attempt. So the client must derive the key deterministically from something stable: an order id, a message id, a hash of the operation's inputs. **A fresh UUID per HTTP attempt makes the mechanism useless**, and this is the single most common way idempotency keys are implemented wrongly.

**A retry with the same key and a *different* body is an error, not a silent success.** That distinction matters: it catches a real bug — key reuse across different operations — instead of quietly returning the wrong result. An idempotency mechanism that silently ignores a mismatched body would mask exactly the error you most want to know about.

**Keys expire.** They are retained for a bounded window, not forever. So the guarantee is "a retry within the window is safe", and a retry after it creates a second charge. That is a real constraint with a real consequence: **a retry mechanism whose backoff can exceed the key lifetime has a duplicate-charge bug that only appears during a long outage** — precisely when retries are most aggressive.

**A concurrent request with the same key gets a defined answer**, rather than both proceeding. Without that, two simultaneous retries would both find no record and both charge.

**The transferable lessons.**

**Idempotency is a contract, not an implementation detail.** Both sides have obligations: the caller derives a stable key, the callee stores and honours it. Publish the contract, including the key lifetime, because the caller cannot design its retry policy without knowing it.

**The mechanism belongs at the point of effect.** Stripe deduplicates where the charge happens. Nothing the caller's transport does — no broker mode, no retry library — can provide this, because only the system performing the effect can decide not to perform it again.

**Where this does not transfer.** It requires the callee to cooperate. An external API with no idempotency support cannot be made safe this way, and the fallback is a durable local record of intent plus a query-by-reference to discover whether the operation already happened — weaker, and sometimes the best available.

**The question to carry:** for every external effect in a message consumer, what is the key, where is it derived from, and how long does the callee remember it?`,
  },

  tradeoffs: {
    intro:
      'Two bundled decisions: what delivery semantic to run, and how to make processing tolerate it. Rows cover both, roughly cheapest first.',
    rows: [
      {
        option: 'At-most-once (commit before processing)',
        whenItWins:
          'Metrics, sampled telemetry, best-effort notifications — where a lost message costs nothing and duplicates would be worse than loss.',
        whenItLoses:
          'Anywhere loss matters. And it is frequently chosen *by accident*, through committing in a `finally` block or after a caught exception.',
        cost:
          'Silent message loss with only a log line, which is the hardest failure to detect.',
      },
      {
        option: 'At-least-once with naturally idempotent processing',
        whenItWins:
          'The ideal. Absolute assignments, deletes by id, set additions. Duplicates and reordering are both harmless with no machinery at all.',
        whenItLoses:
          'When the operation is inherently cumulative — an increment, an append, a send.',
        cost:
          'Requires shaping events as absolute state rather than deltas, which is a design decision made early.',
      },
      {
        option: 'At-least-once plus a natural key and unique constraint',
        whenItWins:
          'When the effect is a row. The database enforces uniqueness, so no code path can bypass it and a duplicate is a caught constraint violation.',
        whenItLoses:
          'When the effect is not a row, or when no stable natural key exists in the event.',
        cost:
          'A key derivable from the event, and handling the constraint violation as success.',
      },
      {
        option: 'At-least-once plus an idempotency key on external calls',
        whenItWins:
          'Effects in systems you do not control — payments, provisioning, third-party APIs. The only mechanism that works there.',
        whenItLoses:
          'When the callee does not support keys, or when the retry window can exceed the key lifetime.',
        cost:
          'Key derivation discipline, and a retry policy bounded by the callee\'s key retention.',
      },
      {
        option: 'At-least-once plus a deduplication table',
        whenItWins:
          'When there is no natural key and no callee support. General-purpose fallback.',
        whenItLoses:
          'If the deduplication insert is not in the same transaction as the effect, which reproduces the bug it was meant to fix.',
        cost:
          'A table with a retention policy, and transactional discipline.',
      },
      {
        option: 'Broker exactly-once (transactional read-process-write)',
        whenItWins:
          'Stream-processing pipelines whose effects are entirely inside the broker — consume, transform, produce, commit atomically.',
        whenItLoses:
          'The instant processing has an external effect. Believing otherwise is the failure this lesson exists to prevent.',
        cost:
          'Throughput overhead, operational complexity, and a boundary you must locate precisely.',
      },
      {
        option: 'Strict ordering with blocking retry',
        whenItWins:
          'When order is a hard correctness requirement and out-of-order processing corrupts state.',
        whenItLoses:
          'When one poison message halting the entire partition is unacceptable.',
        cost:
          'A single bad message stops the stream, and per-message retry is unavailable.',
      },
      {
        option: 'Version-based idempotency instead of ordering',
        whenItWins:
          'Almost always preferable. Events carry absolute state plus a monotonic version; consumers discard stale versions. Ordering becomes an optimisation.',
        whenItLoses:
          'When events are genuinely deltas that cannot be expressed as absolute state.',
        cost:
          'A version on every event and a version check in every consumer.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We configured the broker for exactly-once, so duplicates are impossible."',
      whyWeak:
        'The broker\'s guarantee covers its own operations — read, produce, commit offset — because those are inside one system. Any external effect is outside it: an HTTP call, an email, a row in another database. A crash after the external effect and before the offset commit reproduces it.',
      strongAnswer:
        '"Exactly-once covers the broker\'s read-process-write cycle, which is genuinely useful for pipelines whose effects stay inside the broker. Our payment call is outside that boundary, so the broker cannot know the charge happened or roll it back. Every external effect needs an idempotency key derived from the message — and then the delivery semantic stops mattering for correctness."',
    },
    {
      weakAnswer: '"We generate a UUID for each request and send it as the idempotency key."',
      whyWeak:
        'A fresh UUID per attempt is a different key each time, so the callee sees each retry as a new operation and performs it again. The mechanism is present and does nothing, which is worse than absent because it creates false confidence.',
      strongAnswer:
        '"The key must be derived deterministically from the operation, not from the attempt — the order id, or a hash of `(order_id, \'charge\')`. Then every retry carries the same key and the callee returns the original result. I would also check the callee\'s key lifetime against my retry policy, because a backoff that outlasts the retention window has a duplicate-effect bug that only shows up during a long outage."',
    },
    {
      weakAnswer: '"We commit the offset in a `finally` block so it always advances."',
      whyWeak:
        'That is at-most-once by accident. When processing throws, the offset advances anyway and the message is gone with only a log line. It is the most common accidental data-loss bug in message consumers, and it is invisible in lag metrics because lag stays at zero.',
      strongAnswer:
        '"Committing in a `finally` block means a failed message is silently skipped — at-most-once, chosen unintentionally. I would commit only after processing succeeds, so a failure means redelivery. That guarantees duplicates, which is why processing has to be idempotent — but a duplicate I have made harmless is far better than a loss I cannot detect."',
    },
    {
      weakAnswer: '"Before processing, we check whether we have already handled this message."',
      whyWeak:
        'The check and the processing are not atomic. A crash between them, or a concurrent consumer, reproduces the duplicate. It also cannot detect an external effect that succeeded while its response was lost, which is the most likely failure.',
      strongAnswer:
        '"A check-then-act is not atomic, so a crash or a concurrent consumer between the two reproduces the duplicate. The check has to be *part of* the action: a unique constraint on a message-derived key, a conditional update on a version, or a deduplication row inserted in the same transaction as the effect. Then the database enforces it rather than the code remembering to."',
    },
    {
      weakAnswer: '"Kafka guarantees ordering, so our consumer processes events in order."',
      whyWeak:
        'Ordering is per partition, and the consumer can discard it. A consumer that reads a batch and processes it across a thread pool has no ordering at all. Retry topics reorder by construction, and two producers writing to one partition have no defined order between them.',
      strongAnswer:
        '"Ordering is per partition, so it requires keying by whatever defines the ordering scope — and then the consumer must not process a batch concurrently, or it throws that ordering away. Rather than depending on it, I would have events carry absolute state plus a monotonic version and have consumers discard stale versions. Then ordering is an optimisation, and it gives idempotency for free."',
    },
    {
      weakAnswer: '"Failed messages go to a dead-letter queue, so nothing is lost."',
      whyWeak:
        'A dead-letter destination nobody watches is equivalent to dropping the message. And if you cannot replay from it after fixing the bug — because the original key and payload were not preserved — it is a graveyard rather than a recovery mechanism.',
      strongAnswer:
        '"A dead-letter queue needs three things to be real: an alert on its depth with a named owner and a runbook, the original key and payload preserved, and a tool to replay from it once the bug is fixed. Without those it is a place messages go to be forgotten, and the fact that it exists makes people believe the problem is handled."',
    },
  ],

  flashcards: [
    {
      id: 'fc-ds-1',
      front: 'Why is exactly-once delivery impossible across a network?',
      back: 'A missing acknowledgement is indistinguishable from a lost message. Retry and you may duplicate; do not retry and you may lose. No protocol removes the ambiguity.',
      topic: 'delivery-semantics',
    },
    {
      id: 'fc-ds-2',
      front: 'What is the practical formulation to remember?',
      back: 'Exactly-once *processing* = at-least-once delivery + idempotent processing. Stop trying to make delivery exact; make duplicates harmless.',
      topic: 'delivery-semantics',
    },
    {
      id: 'fc-ds-3',
      front: 'What do brokers mean by exactly-once semantics?',
      back: 'At-least-once delivery plus deduplication inside their own boundary — read, produce, commit offset atomically. It stops at the first external effect.',
      topic: 'delivery-semantics',
    },
    {
      id: 'fc-ds-4',
      front: 'What single decision makes a consumer at-least-once or at-most-once?',
      back: 'Whether the offset is committed before or after processing. Before means a crash silently skips the message; after means redelivery.',
      topic: 'acknowledgement',
    },
    {
      id: 'fc-ds-5',
      front: 'Why is committing in a `finally` block a bug?',
      back: 'A failed message has its offset advanced anyway, so it is silently lost with only a log line — at-most-once by accident, and invisible in lag metrics.',
      topic: 'acknowledgement',
    },
    {
      id: 'fc-ds-6',
      front: 'Why must an idempotency key be derived from the message?',
      back: 'A fresh UUID per attempt is a different key each time, so the callee treats each retry as a new operation. The mechanism is present and useless.',
      topic: 'idempotency',
    },
    {
      id: 'fc-ds-7',
      front: 'Why is "check whether it has been done, then do it" broken?',
      back: 'The check and the action are not atomic, so a crash or a concurrent consumer between them reproduces the duplicate. The check must be part of the action.',
      topic: 'deduplication',
    },
    {
      id: 'fc-ds-8',
      front: 'What is the strongest and simplest deduplication mechanism?',
      back: 'A deterministic natural key from the event plus a unique constraint. The database enforces it, so no code path can bypass it.',
      topic: 'deduplication',
    },
    {
      id: 'fc-ds-9',
      front: 'What must be true of a deduplication table to work?',
      back: 'The id insert must be in the same transaction as the effect, or a crash between them reproduces the bug. And it needs a retention policy.',
      topic: 'deduplication',
    },
    {
      id: 'fc-ds-10',
      front: 'What is the risk of an idempotency key lifetime?',
      back: 'Keys expire. A retry policy whose backoff can exceed the callee\'s retention window has a duplicate-effect bug that appears only during a long outage.',
      topic: 'idempotency',
    },
    {
      id: 'fc-ds-11',
      front: 'Name four things that break ordering even within a partition.',
      back: 'Concurrent processing of a batch, retry topics, producer retries without sequence numbers, and two producers writing related events.',
      topic: 'ordering',
    },
    {
      id: 'fc-ds-12',
      front: 'What is the most valuable technique for removing an ordering requirement?',
      back: 'Events carry absolute state plus a monotonic version; consumers discard any version not greater than what they applied. Ordering becomes an optimisation, and idempotency comes free.',
      topic: 'ordering',
    },
    {
      id: 'fc-ds-13',
      front: 'What is the trade between per-message retry and strict ordering?',
      back: 'You cannot have both. Blocking retry preserves order and halts the partition; a retry topic keeps the stream flowing and reorders that message.',
      topic: 'ordering',
    },
    {
      id: 'fc-ds-14',
      front: 'What makes a dead-letter destination real rather than decorative?',
      back: 'An alert on depth with a named owner, the original key and payload preserved, and a tool to replay from it once the bug is fixed.',
      topic: 'delivery-semantics',
    },
  ],

  quiz: [
    {
      id: 'q-ds-1',
      kind: 'scenario',
      prompt:
        'A consumer with broker exactly-once enabled charges a card, then writes a payment record, then commits the offset. It crashes after the charge succeeds but before committing. What happens on restart?',
      options: [
        { id: 'a', label: 'The message is redelivered and the card is charged again — the broker\'s guarantee does not extend to the payment provider' },
        { id: 'b', label: 'Nothing; the broker rolls back the charge as part of the transaction' },
        { id: 'c', label: 'The message is skipped, since the charge already happened' },
        { id: 'd', label: 'The broker detects the duplicate and suppresses redelivery' },
      ],
      correct: ['a'],
      explanation:
        'Exactly-once semantics cover reading, producing and committing inside the broker, because those can be rolled back together. The payment provider is outside — the broker cannot know a charge happened or undo it. Only an idempotency key derived deterministically from the message prevents the second charge.',
      difficulty: 'core',
      topic: 'delivery-semantics',
    },
    {
      id: 'q-ds-2',
      kind: 'single',
      prompt: 'A consumer commits the offset in a `finally` block. What semantic does it have?',
      options: [
        { id: 'a', label: 'At-most-once — a failed message has its offset advanced and is silently lost' },
        { id: 'b', label: 'At-least-once, since the offset is always committed' },
        { id: 'c', label: 'Exactly-once, since each offset is committed exactly one time' },
        { id: 'd', label: 'It depends on the broker configuration' },
      ],
      correct: ['a'],
      explanation:
        'Committing regardless of outcome means a message that failed to process is never redelivered. This is at-most-once chosen by accident, and it is invisible in lag metrics because lag stays at zero — the message was consumed, just not processed.',
      difficulty: 'core',
      topic: 'acknowledgement',
    },
    {
      id: 'q-ds-3',
      kind: 'scenario',
      prompt:
        'A client sends `Idempotency-Key: <new UUID>` on every HTTP attempt, including retries. What is the effect?',
      options: [
        { id: 'a', label: 'None — each retry carries a different key, so the callee performs the operation again; the mechanism is present and useless' },
        { id: 'b', label: 'It works correctly, since each request is uniquely identified' },
        { id: 'c', label: 'The callee rejects requests with unrecognised keys' },
        { id: 'd', label: 'It works, but only within the key expiry window' },
      ],
      correct: ['a'],
      explanation:
        'The key must identify the logical *operation*, not the attempt, so it has to be derived from something stable — the order id, or a hash of the operation\'s inputs. A per-attempt UUID means the callee sees every retry as new. This is the most common way idempotency keys are implemented wrongly, and it creates false confidence.',
      difficulty: 'core',
      topic: 'idempotency',
    },
    {
      id: 'q-ds-4',
      kind: 'scenario',
      prompt:
        'Events are keyed by account id so they are ordered per account. The consumer reads batches of 500 and processes them across a 20-thread pool. Is ordering preserved?',
      options: [
        { id: 'a', label: 'No — concurrent processing discards the ordering the broker provided, and it only manifests when two events for one account land in the same batch' },
        { id: 'b', label: 'Yes, because the partition key guarantees ordering end to end' },
        { id: 'c', label: 'Yes, provided the thread pool preserves submission order' },
        { id: 'd', label: 'Only if the batch size is smaller than the thread count' },
      ],
      correct: ['a'],
      explanation:
        'The broker delivers in order; the consumer then processes concurrently and throws that away. It is extremely common and usually unnoticed, because it requires two events for the same key in one batch. The durable fix is version-based idempotency so ordering is not required, rather than serialising the consumer.',
      difficulty: 'advanced',
      topic: 'ordering',
    },
    {
      id: 'q-ds-5',
      kind: 'scenario',
      prompt:
        'A consumer inserts a deduplication row for the message id, then performs the effect, in two separate transactions. What can go wrong?',
      options: [
        { id: 'a', label: 'A crash between them leaves the id recorded with the effect never performed — so the retry is suppressed and the work is silently lost' },
        { id: 'b', label: 'Nothing; recording the id first is the safe order' },
        { id: 'c', label: 'The deduplication table grows unbounded' },
        { id: 'd', label: 'Concurrent consumers both insert the id successfully' },
      ],
      correct: ['a'],
      explanation:
        'Splitting the deduplication record from the effect reintroduces the problem in the other direction: id-first can lose work, effect-first can duplicate it. The insert must be in the *same transaction* as the effect. Unbounded growth is a real secondary concern and not the correctness bug here.',
      difficulty: 'advanced',
      topic: 'deduplication',
    },
    {
      id: 'q-ds-6',
      kind: 'multi',
      prompt:
        'Which are true about strict ordering and per-message retry? Select all that apply.',
      options: [
        { id: 'a', label: 'You cannot have both — a retried message is processed after later ones' },
        { id: 'b', label: 'Blocking retry preserves order and halts the partition on a poison message' },
        { id: 'c', label: 'Version-based idempotency removes the ordering requirement, making both available' },
        { id: 'd', label: 'A retry topic preserves ordering if it uses the same partition key' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The tension is fundamental: retrying message 4 while 5 and 6 proceed reorders 4. The same partition key in a retry topic does not help, because the reordering already happened relative to the main topic. Version-based idempotency is the way out — it makes out-of-order processing harmless.',
      difficulty: 'advanced',
      topic: 'ordering',
    },
  ],

  exercises: [
    {
      id: 'ex-ds-1',
      kind: 'design',
      title: 'Make every effect idempotent, then say what you assumed',
      estimatedMinutes: 30,
      prompt: `A consumer reads an "order confirmed" event and must perform six effects. For each, specify the idempotency mechanism, the key and where it comes from, and what happens on a duplicate delivery.

1. Insert an \`order_fulfilments\` row.
2. Decrement stock for each line item.
3. Charge the customer's card via a third-party provider.
4. Send a confirmation email via a third-party provider.
5. Publish an "order fulfilled" event to another topic.
6. Increment a \`lifetime_orders\` counter on the customer record.

Then answer:

- Which effect is hardest, and what is your honest position on it?
- What ordering do you commit the six effects in, and why that order?
- Where do you commit the offset, and what does a crash at each point cost?
- The event may be redelivered days later after a replay. Which mechanisms still work?`,
      rubric: [
        'Row insert: natural key plus unique constraint, treating the violation as success.',
        'Stock decrement: identifies it as non-idempotent and proposes a per-order fulfilment record rather than a bare decrement.',
        'Charge: idempotency key derived from the order id, with the key-lifetime caveat.',
        'Email: identifies irreversibility and puts the dedup record in the same transaction as the send decision.',
        'Publish: producer sequence numbers or a message key the downstream deduplicates on.',
        'Counter: derives it from a query rather than incrementing, or uses a per-order marker.',
        'Names the email as hardest and states an honest position on residual risk.',
        'Ordering rationale puts reversible and cheap effects before irreversible ones.',
        'Offset commit is after all effects, with a per-point crash analysis.',
        'Replay answer distinguishes mechanisms with retention limits from those without.',
      ],
      modelAnswer: `**The general rule I am applying:** every effect gets a key derived deterministically from the event — never from the attempt — and the deduplication is enforced by the system performing the effect, not by a check in my code.

The event carries \`order_id\` and an \`event_id\`. **I will key most things on \`order_id\`**, because the logical operation is "fulfil order 4471" and that is true regardless of how many times the event is delivered or replayed. \`event_id\` would be wrong here: a replay generates the same event and I want it deduplicated, which keying on \`event_id\` would give me only if replays reuse ids — a fragile assumption.

**1. Insert an \`order_fulfilments\` row — NATURAL KEY + UNIQUE CONSTRAINT**

\`\`\`sql
CREATE UNIQUE INDEX ON order_fulfilments (order_id);
INSERT INTO order_fulfilments (order_id, ...) VALUES (...);
\`\`\`

*Key:* \`order_id\`, straight from the event.

*On duplicate:* the insert raises a unique-violation, which the consumer catches and treats as success — the row already exists, so the effect is already achieved.

*Why this is the best case:* the database enforces it. **No code path can bypass it**, including a future code path written by someone who has not read this design. That property is why I prefer a constraint over a deduplication check everywhere it is available.

**2. Decrement stock per line item — NOT a bare decrement**

A decrement is inherently non-idempotent. The mechanism is to make the *fulfilment* the recorded fact and the decrement its consequence.

\`\`\`sql
-- one row per (order, sku), unique
INSERT INTO stock_movements (order_id, sku, delta) VALUES (4471, 'ABC', -2);
-- then, in the same transaction:
UPDATE stock SET on_hand = on_hand - 2 WHERE sku = 'ABC' AND on_hand >= 2;
\`\`\`

*Key:* \`(order_id, sku)\`, unique.

*On duplicate:* the \`stock_movements\` insert fails, the transaction aborts, and the \`UPDATE\` never runs. **The movement record is what makes the decrement idempotent** — the decrement itself is not, and it does not need to be, because it can only execute when the movement insert succeeds.

*Both statements in one transaction, non-negotiable.* Split them and a crash between produces either a movement with no decrement or a decrement with no record.

*A second benefit worth naming:* \`stock_movements\` is an audit trail. \`SELECT sum(delta)\` reconciles against \`stock.on_hand\`, so a drift is detectable. **The idempotency mechanism and the reconciliation mechanism are the same table**, which is a good sign the design is right.

*Note the \`on_hand >= 2\` guard and the affected-row count.* If it matches zero rows, stock went negative and the transaction must abort — otherwise the movement is recorded for a decrement that did not happen.

**3. Charge the card — IDEMPOTENCY KEY on the provider call**

\`\`\`
Idempotency-Key: order-4471-charge
\`\`\`

*Key derivation:* \`"order-" + order_id + "-charge"\`. Deterministic, stable across every retry and every replay, and scoped so a future refund operation cannot collide with it.

*On duplicate:* the provider returns the original charge response. No second charge.

*The caveat I would raise in review:* **the provider's key retention is finite.** If it is 24 hours and my retry backoff can extend beyond that — or a replay happens days later — the key is forgotten and a second charge is created. So:

- My retry policy must be bounded well inside the retention window.
- **A replay of old events must not re-run the charge.** I handle this with a local guard: a \`payments\` row keyed \`(order_id, 'charge')\` written in the same transaction as the fulfilment. If that row exists, the charge is skipped entirely and the provider is never called. The provider's key is the defence against my *retries*; my local row is the defence against *replays*.

That two-layer arrangement is the honest answer, and it is a direct consequence of key lifetimes being finite.

**4. Send the confirmation email — DEDUP RECORD IN THE SAME TRANSACTION**

\`\`\`sql
INSERT INTO emails_sent (order_id, template) VALUES (4471, 'confirmation');
-- unique on (order_id, template); if this succeeds, send
\`\`\`

*Key:* \`(order_id, 'confirmation')\`.

*On duplicate:* the insert fails, so the send is skipped.

*Why the insert must come first and be committed before sending:* an email cannot be un-sent. Given the choice between "recorded but not sent" and "sent but not recorded", I choose the first — a missing confirmation email is a support conversation, and a duplicate is a trust problem, and more importantly a duplicate is **unbounded**: if the record write fails repeatedly, the customer gets an email on every retry.

*This means accepting a real failure mode:* commit the record, crash before sending, and the email is never sent with the system believing it was. **Mitigation: a reconciliation job** comparing \`emails_sent\` rows against the provider's delivery log, re-sending any with no corresponding delivery. Not free, and it is the right shape — the reconciliation is auditable, whereas hoping a crash does not happen is not.

*Most providers also support their own idempotency key*, which would let me send first and record second. If available, I would use it and prefer that ordering, since it removes the lost-email case. Worth checking rather than assuming.

**5. Publish "order fulfilled" — MESSAGE KEY + downstream deduplication**

*Producer side:* enable the producer's idempotence so retransmissions are deduplicated by the broker via sequence numbers. This handles duplicates caused by *my* retries into the broker.

*Consumer side:* the message carries \`order_id\` as its key and an explicit \`fulfilment_id\`. **Downstream consumers must deduplicate on it**, because producer idempotence does not cover the case where I crash after publishing and before committing my offset, then republish on restart.

*On duplicate:* downstream consumers see a repeated \`fulfilment_id\` and skip.

*The thing to state plainly:* I cannot make publishing exactly-once from a consumer whose offset commit is a separate step. **The contract has to be "at-least-once, deduplicate on \`fulfilment_id\`", published in the event schema** so downstream teams know their obligation. An event schema that does not say how to deduplicate is an incomplete contract.

**6. Increment \`lifetime_orders\` — DERIVE IT, do not increment it**

*Preferred mechanism:* do not store an incrementing counter. Derive it:

\`\`\`sql
SELECT count(*) FROM order_fulfilments WHERE customer_id = ?
\`\`\`

*Why:* an increment is non-idempotent and needs a mechanism. A count over the fulfilments table is idempotent by construction, always correct, and self-healing — a bug that skipped an order corrects itself when the order is fulfilled.

*If a stored counter is needed for read performance*, update it in the same transaction as the fulfilment insert:

\`\`\`sql
INSERT INTO order_fulfilments ...;                    -- unique, may fail
UPDATE customers SET lifetime_orders = lifetime_orders + 1 WHERE id = ?;
\`\`\`

The insert's uniqueness gates the increment, so the increment can only run once per order. Same pattern as stock: **make the idempotent record the gate, and the non-idempotent effect its consequence.**

*Plus a periodic reconciliation* against the derived count, because a denormalised counter will drift eventually and a drift nobody detects becomes a wrong number nobody trusts.

---

**Which effect is hardest, and my honest position?**

**The email, and it is not close.**

The other five all reduce to "put the effect behind a unique constraint in a database I control". The email is different in two ways:

**It is irreversible.** Every other effect can be corrected: a charge can be refunded, a stock movement reversed, a counter recomputed, a row deleted. A sent email is sent.

**The recording and the effect are in different systems and cannot be atomic.** Whichever order I choose, there is a crash window that produces either a duplicate or a loss. **There is no arrangement of two systems that removes it** — this is the dual-write problem, which is the next lesson's subject.

*My position:* commit the record before sending, accept that a crash in the window loses an email, and cover it with reconciliation against the provider's delivery log. I choose loss over duplication because a duplicate is unbounded — a repeatedly failing record write sends an email per retry — while a loss is single and detectable by reconciliation.

*And I would say the residual risk out loud in review*, rather than presenting the design as safe. "A crash in a roughly 200-millisecond window loses one confirmation email; the reconciliation job catches it within an hour" is a statement someone can accept or reject. "Emails are idempotent" is not true and would end the conversation prematurely.

**Ordering of the six effects, and why**

\`\`\`
Transaction 1 (one database transaction):
  1. INSERT order_fulfilments        ← the gate for everything else
  2. INSERT stock_movements + UPDATE stock
  3. INSERT payments (order_id, 'charge')   ← local guard for the charge
  4. INSERT emails_sent              ← local guard for the email
  6. UPDATE customers.lifetime_orders
  COMMIT

Then, outside the transaction:
  3'. Charge the card (idempotency key: order-4471-charge)
  4'. Send the email
  5.  Publish "order fulfilled"
  --  Commit the offset
\`\`\`

*The principle:* **all the local, reversible, transactional effects first, in one transaction. Then the external, irreversible ones. Then the offset.**

*Why the local guards are inside the transaction and the external calls are outside:* I cannot include an HTTP call in a database transaction. So the transaction records *the decision* to perform each external effect, and the external calls follow. A crash after the commit and before an external call means the guard exists without the effect — recoverable by a reconciliation job, and detectable because the guard rows are queryable.

*Why the charge before the email:* if the charge fails permanently — a declined card — I do not want a confirmation email already sent. Order the external effects so the one most likely to fail comes first.

*Why the publish last:* it announces "this order is fulfilled" and should not be true before the effects it announces have happened. Publishing early would let a downstream consumer act on a fulfilment that then failed.

**Offset commit, and the cost of a crash at each point**

*Commit after everything.* At-least-once, deliberately.

| Crash point | Cost on redelivery |
| --- | --- |
| Before transaction 1 | **Nothing.** Nothing happened; full reprocessing. |
| Inside transaction 1 | **Nothing.** The transaction rolls back entirely. |
| After commit, before charge | Fulfilment recorded, charge not made. Redelivery: the fulfilment insert fails, so the consumer must **not** treat that as "already done" — see below. |
| After charge, before email | Redelivery: fulfilment insert fails, charge is guarded by the provider key. Email must still be sent. |
| After email, before publish | Redelivery: everything guarded. Publish repeats; downstream deduplicates on \`fulfilment_id\`. |
| After publish, before commit | Redelivery: everything guarded, publish repeats, downstream deduplicates. Harmless. |

**The important subtlety, and it is the one this table exposes.** A naive consumer treats "fulfilment row already exists" as "fully processed, skip" and commits. But the row existing does **not** mean the charge, email and publish happened — only that the transaction committed. So a crash after the transaction and before the charge would leave the order fulfilled and never charged, permanently.

*The fix:* the guard rows carry state, not just existence.

\`\`\`
payments:     (order_id, 'charge', status: pending | completed)
emails_sent:  (order_id, template, status: pending | sent)
\`\`\`

On redelivery, the consumer reads the guards and performs only the steps still \`pending\`. **Each guard row is a step in a small local saga**, and "already exists" is not the same as "already done".

That distinction is the difference between a design that looks idempotent and one that is. It is also why I would test this by killing the consumer at each of the six points and asserting the end state — because reasoning about it, as this table shows, gets subtle quickly.

**Replay days later — which mechanisms still work?**

*Still work, unconditionally:*

- **All the unique constraints** — fulfilment, stock movements, emails_sent, payments. Database rows do not expire, so a replay a year later is still deduplicated correctly. **This is the strongest argument for preferring database-enforced deduplication over anything with a retention window.**
- **Derived counters.** A count over a table is always right.

*Break or become unsafe:*

- **The provider's idempotency key**, if the replay is outside its retention window. The provider has forgotten \`order-4471-charge\` and would create a second charge.
- **Broker producer idempotence**, which is scoped to a producer session and does not span a replay.
- **A deduplication table with aggressive retention.** If I pruned rows older than 7 days, a 30-day replay reprocesses everything.

*What this means for how I design the replay:*

**The local guard rows are what make a replay safe**, precisely because they have no expiry. My \`payments\` row means a replay never calls the provider at all, so the provider's key retention becomes irrelevant. That is why I included it as a second layer rather than relying on the provider alone — and the reason is exactly this scenario.

**And I would give the consumer a replay mode.** A replay usually wants to rebuild derived state, not re-send emails and re-charge cards. So the consumer takes a flag — or reads a per-run configuration — that suppresses external effects while performing the local ones. **Replaying a consumer with side effects into the real world is how a replay becomes an incident**, and it is far better handled by an explicit mode than by trusting every guard to hold.

*The transferable rule:* **prefer deduplication whose record does not expire.** A unique constraint in your own database is safe forever; an idempotency key at a third party is safe for hours. Where you must rely on the latter, put something that does not expire in front of it.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-ds-1',
      level: 'basic',
      question: 'What are the three delivery semantics?',
      guidance:
        'At-most-once, at-least-once, exactly-once — and the third is not achievable across a network. Look for the acknowledgement-ambiguity argument rather than a recitation.',
    },
    {
      id: 'iq-ds-2',
      level: 'basic',
      question: 'What makes a consumer at-least-once rather than at-most-once?',
      guidance:
        'Committing the offset after processing rather than before. A strong answer names the `finally`-block mistake and notes that at-most-once loss is invisible in lag metrics.',
    },
    {
      id: 'iq-ds-3',
      level: 'intermediate',
      question: 'A broker advertises exactly-once. What does that actually cover?',
      guidance:
        'Read, produce and commit inside the broker, made atomic. Look for the boundary being located explicitly, and for the recognition that any external effect falls outside it.',
    },
    {
      id: 'iq-ds-4',
      level: 'intermediate',
      question: 'How do you make a message consumer idempotent?',
      guidance:
        'A deterministic key from the message plus enforcement at the point of effect — a unique constraint, a conditional update, or a provider idempotency key. Strong answers reject check-then-act as non-atomic.',
    },
    {
      id: 'iq-ds-5',
      level: 'advanced',
      question: 'Your consumer preserves per-key ordering. What could still break it?',
      guidance:
        'Concurrent batch processing, retry topics, producer retries without sequence numbers, multiple producers. Excellent answers propose version-based idempotency to remove the requirement rather than protect it.',
    },
    {
      id: 'iq-ds-6',
      level: 'advanced',
      question: 'How do you handle a message that always fails to process?',
      guidance:
        'Retry with backoff then a dead-letter destination, and an explicit choice about ordering — blocking preserves order and halts the partition. Excellent answers require an alert, an owner, and a replay path.',
    },
    {
      id: 'iq-ds-7',
      level: 'followup',
      question: 'You said an idempotency key on the payment call. What is its lifetime?',
      guidance:
        'Finite, typically hours to a day. A retry policy or replay exceeding it creates a duplicate charge. A strong answer adds a local guard row with no expiry in front of the provider\'s key.',
    },
    {
      id: 'iq-ds-8',
      level: 'followup',
      question: 'A duplicate-suppression row already exists. Is the message fully processed?',
      guidance:
        'No — existence means one transaction committed, not that every downstream effect happened. Guard rows need state, so redelivery performs only the pending steps. This is the subtlety that makes an apparently-idempotent consumer wrong.',
    },
  ],

  activeLearning: [
    {
      id: 'al-ds-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed you control the consumer. Now change one thing: you are the *producer* publishing events for external customers who write their own consumers. What obligations shift to you, and what can you no longer assume?',
      discussion: `Publishing for external consumers changes the problem from "make my processing idempotent" to "make it possible for someone else to".

**What becomes your obligation.**

**A stable, documented deduplication key in every event.** Your consumers cannot deduplicate without one, and they cannot invent it. This must be part of the published schema — a field named for the purpose, with documented semantics: what it identifies, whether it is stable across replays, and whether it is unique globally or per stream. **An event schema without a deduplication key is an incomplete contract**, and every consumer will invent a different and probably wrong scheme.

**An explicit statement of your delivery semantic.** "At-least-once; deduplicate on \`event_id\`" belongs in your documentation, prominently. Consumers who assume exactly-once will build duplicate bugs, and they will report them as your bug.

**A version or sequence number if ordering matters.** If two events for one entity have a meaningful order, consumers need a way to detect staleness. Absolute state plus a monotonic version lets them discard out-of-order events without any ordering guarantee from you — which is far more robust than promising ordering you cannot maintain through retries and partition changes.

**Schema stability, or explicit versioning.** An external consumer cannot be redeployed on your schedule. Adding a required field breaks them; changing a field's meaning breaks them silently, which is worse.

**What you can no longer assume.**

**That consumers process promptly.** An external consumer may be down for a day, or process with a week's lag, or replay six months of history when they onboard. Your retention and your key stability must accommodate that.

**That consumers deduplicate at all.** Some will not. So for events whose duplicate processing would cause customer-visible harm, **you should minimise duplicates even though you cannot eliminate them** — producer idempotence, careful retry policies. Not because it is a guarantee, but because reducing the rate reduces the number of consumers hurt by their own missing deduplication.

**That consumers handle unknown event types.** They will not. Adding a new event type to an existing stream breaks consumers that assumed a closed set, which argues for either a separate stream per type or an explicit "ignore unknown types" instruction in the contract.

**That consumers read your documentation.** Which argues for making the safe path the default: put the deduplication key in an obviously-named field, make ordering unnecessary by design, and avoid delivery patterns that require careful handling.

**What genuinely new obligations appear.**

**Ordering across your own retries becomes visible.** Internally you might tolerate a reordered retry. Externally, a consumer that sees event 5 then event 4 may take a wrong action and blame you. Version-based events make this a non-event, which is another reason to shape them that way.

**Replay becomes a customer-facing feature with a risk.** A consumer onboarding will read your history, and if your events contain side-effect *instructions* rather than *facts* — "send this email" rather than "an order was placed" — a replay causes real-world effects. **Publish facts, not commands**, and this problem does not arise.

**Idempotency-key lifetimes become a published contract.** If your API accepts idempotency keys, the retention window is something consumers must know to design their retry policy. Undocumented, it is a bug waiting for their first long outage.

**What I would actually do.** Publish events as **facts with absolute state, a stable event id, and a monotonic per-entity version**. Document at-least-once explicitly. That combination means a consumer can be correct with a deduplication check and a version comparison, and it does not depend on them reading anything subtle.

**The transferable point.** Internally, delivery semantics are a design choice you can revisit. At a public boundary they become a contract, and the contract must make the safe implementation the obvious one — because you cannot fix the consumers. **The shape of the event is what determines whether correct consumption is easy or subtle**, and that shape is decided once, early, by you.`,
    },
    {
      id: 'al-ds-2',
      kind: 'debug',
      prompt:
        'A billing consumer occasionally double-charges — about 1 in 20,000 orders. The consumer sends an idempotency key on every charge and commits its offset only after the charge succeeds. Duplicates cluster during periods of elevated latency from the payment provider. Hypotheses?',
      discussion: `The key detail is the clustering during elevated provider latency. That points at something in the timeout-and-retry path rather than at a logic error, because a logic error would produce a steady rate.

**Hypothesis 1 — the idempotency key is derived per attempt, not per operation.** If the key includes a timestamp, a retry counter, or a fresh UUID, each retry carries a different key and the provider treats it as a new charge. Duplicates would then correlate exactly with retries, and retries correlate with provider latency.

*Why this fits best:* it explains the clustering precisely — no retries, no duplicates; latency causes timeouts, timeouts cause retries, retries with fresh keys cause charges.

*Check:* log the key on every attempt and look for two different keys against one order. This is conclusive in one query.

**Hypothesis 2 — the retry backoff exceeds the provider's key retention.** If the provider retains keys for, say, 24 hours and a retry sequence with long backoff extends past that, the final retry carries a key the provider has forgotten. Rare by construction, which fits 1 in 20,000, and it would occur specifically during long degradations.

*Check:* the provider's documented retention against the maximum total duration of the retry policy. Arithmetic, not instrumentation.

**Hypothesis 3 — the client-side timeout is shorter than the provider's processing time, and concurrent retries race.** If the consumer times out at 5 seconds and the provider takes 8 seconds under load, the consumer retries while the first request is still in flight. Two requests with the same key arrive concurrently. **Whether that is safe depends on the provider's concurrent-key behaviour** — some return a conflict, some queue, and some process both if the first has not yet been recorded.

*Why it fits:* concurrency requires slowness, so it appears only under latency. And it is the failure mode that a correct key derivation does not protect against.

*Check:* the provider's documented behaviour for a concurrent request with an in-flight key, and whether the client timeout exceeds the provider's worst-case processing time.

**Hypothesis 4 — a retry at a layer that does not know about idempotency.** An HTTP client library, a service mesh sidecar, or a load balancer configured to retry on timeout. Those retries may reuse the key — fine — or they may be issued in a way that bypasses whatever the application does. Worse, the application may not know they happened, so its logs show one attempt.

*Why it fits:* a lower-layer retry on timeout activates exactly under latency, and it is invisible to application-level logging.

*Check:* the HTTP client's and mesh's retry configuration, and compare the count of requests the provider received against the count the application believes it sent. **A mismatch is the finding**, and it is the hypothesis most likely to be missed because the application code looks correct.

**Hypothesis 5 — two consumer instances processing the same message concurrently.** During a rebalance, a partition can be briefly owned by two consumers — the old owner has not yet noticed it lost the partition. Both process the same offset. If the key derivation is correct this is safe; combined with hypothesis 3's concurrency question, it may not be.

*Check:* whether duplicate charges cluster around rebalances as well as around latency. If both, this is contributing.

**What I would check first: log the idempotency key on every attempt and search for one order with two distinct keys.** It is one instrumentation change and one query, and it definitively confirms or eliminates the most likely cause. **Crucially it also eliminates hypothesis 4 partially** — if the application only ever generated one key but the provider recorded two charges, the extra request came from below the application.

**Then: compare request counts.** How many charge requests the provider received for the affected orders against how many the application logged. A mismatch localises the retry to a lower layer immediately, and this comparison is the check that most often goes unmade.

**What the evidence rules out.** A steady logic error — the rate would not cluster. A missing key entirely — the rate would be far higher than 1 in 20,000. Offset-commit ordering — committing after the charge is correct and would produce duplicates on crashes, which do not correlate with provider latency.

**The structural fixes, in order of value.**

**A durable local record of intent before the call.** Write \`(order_id, 'charge', status: pending, key: order-4471-charge)\` and commit it *before* calling the provider. Then:

- Every attempt reads the key from that row, so it is impossible for two attempts to use different keys — **hypothesis 1 becomes structurally impossible** rather than fixed by careful coding.
- On restart, a \`pending\` row means "query the provider by this key to find out what happened" rather than "charge again". That converts an ambiguous state into a resolvable one.
- It survives indefinitely, so it protects against replays outside the provider's retention window — covering hypothesis 2.

**A client timeout above the provider's worst-case latency, with no lower-layer retries.** Configure the HTTP client and mesh not to retry this endpoint; retries must be application-controlled so they carry the key from the local record. This addresses hypotheses 3 and 4.

**A reconciliation job** comparing local payment records against the provider's charge list daily, alerting on any charge with no matching record or any order with two charges. **1 in 20,000 was found by a customer**, which means detection was the real failure — a reconciliation job finds it the next morning, every time, regardless of cause.

**Transferable:** an idempotency key is only as good as its derivation, and derivation done in code at call time is fragile. **Writing the key to durable storage before the first attempt makes correct derivation structural** — every retry, restart and replay reads the same key because there is only one place it can come from. And whenever a failure rate is low enough to be reported by a customer rather than an alert, the missing reconciliation check is a finding in its own right.`,
    },
  ],

  revision: {
    bullets: [
      'Exactly-once delivery is impossible: a missing ack is indistinguishable from a lost message.',
      'Retry and you may duplicate; do not retry and you may lose. There is no third option.',
      'Exactly-once *processing* = at-least-once delivery + idempotent processing.',
      'A broker\'s exactly-once covers read, produce and commit inside itself, and stops at the first external effect.',
      'Committing the offset before processing is at-most-once; after processing is at-least-once.',
      'Committing in a `finally` block is at-most-once by accident, and the loss is invisible in lag metrics.',
      'An idempotency key must be derived from the operation, never generated per attempt.',
      'Check-then-act is not atomic; the check must be part of the action.',
      'The strongest mechanism is a deterministic natural key plus a unique constraint — the database enforces it.',
      'A deduplication row must be inserted in the same transaction as the effect.',
      'Prefer absolute assignments over deltas; they are idempotent for free.',
      'Deterministic output addressing makes a file-producing effect idempotent trivially.',
      'Ordering is per partition, and a consumer processing a batch concurrently discards it.',
      'Retry topics and strict ordering are fundamentally in tension — you cannot have both.',
      'Absolute state plus a monotonic version makes ordering an optimisation and gives idempotency free.',
      'Idempotency keys at a third party expire; a unique constraint in your own database does not.',
      'Put a durable local guard with no expiry in front of any provider-side idempotency key.',
      'A guard row existing means one transaction committed, not that every downstream effect happened.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The guarantees a messaging system makes about how many times a message is delivered and in what order — at-most-once, at-least-once, and the impossible exactly-once — plus the processing-side mechanisms that make at-least-once safe.',
    whyItExists:
      'Because an unacknowledged send is ambiguous between loss and ack-loss, so any system must choose between duplicating and losing, and correctness has to come from processing rather than transport.',
    whenToUse: [
      'At-least-once with idempotent processing, as the default for anything that matters.',
      'At-most-once only for telemetry where loss is free and duplicates are worse.',
      'Broker exactly-once for pipelines whose effects stay entirely inside the broker.',
      'Version-based idempotency whenever ordering would otherwise be a correctness requirement.',
    ],
    whenNotToUse: [
      'Relying on broker exactly-once when processing has any external effect.',
      'Per-message retry when strict ordering is a hard requirement, or vice versa.',
      'A check-then-act deduplication, which is not atomic.',
      'A provider-side idempotency key alone, when a replay may occur outside its retention window.',
    ],
    alternatives: [
      'A unique constraint on a deterministic natural key, enforced by the database.',
      'Conditional updates on a version, with the affected-row count checked.',
      'Deterministic output addressing, for effects that produce a file or object.',
      'Deriving a value instead of incrementing it, which is idempotent by construction.',
      'Reconciliation against the effect system, for irreversible effects that cannot be made atomic.',
    ],
    tradeoffs: [
      'At-least-once buys no loss and costs duplicates you must absorb.',
      'At-most-once buys no duplicates and costs silent loss.',
      'A unique constraint buys unbypassable enforcement and requires a stable key in the event.',
      'Blocking retry buys strict ordering and costs a halted partition on a poison message.',
      'Version-based idempotency buys freedom from ordering and costs a version on every event.',
      'A local guard row buys replay safety and costs a table plus state management.',
    ],
    failureModes: [
      'A double charge from a crash between an external effect and the offset commit.',
      'An idempotency key generated per attempt, so the mechanism does nothing.',
      'A retry backoff or replay exceeding the callee\'s key retention window.',
      'A lower-layer retry — HTTP client or mesh — invisible to application logging.',
      'Committing the offset in a `finally` block, silently skipping failed messages.',
      'A deduplication row in a different transaction from the effect, losing or duplicating work.',
      'Concurrent batch processing discarding the ordering the broker provided.',
      'A retry topic reordering a message relative to its siblings.',
      'Two consumers briefly owning one partition during a rebalance.',
      'A guard row read as "fully processed" when later steps had not run.',
      'A replay re-triggering real-world side effects because the consumer has no replay mode.',
    ],
    followUpQuestions: [
      'For each external effect, what is the idempotency key and where is it derived from?',
      'How long does the callee remember that key, and can your retries outlast it?',
      'Where exactly do you commit the offset, relative to each effect?',
      'Is your deduplication record written in the same transaction as the effect?',
      'Could a lower layer be retrying without your knowledge?',
      'Does your consumer process batches concurrently? Then what preserves ordering?',
      'What happens to a message that always fails, and who is alerted?',
      'Is it safe to replay this topic, and does the consumer have a replay mode?',
      'What reconciliation would detect a duplicate or missing effect the next morning?',
    ],
  },
});
