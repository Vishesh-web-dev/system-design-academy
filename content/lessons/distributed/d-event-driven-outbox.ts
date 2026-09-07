import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-event-driven-outbox',
  title: 'Event-driven architecture, outbox, CDC',
  summary:
    'Writing to your database and publishing an event are two systems, so one can succeed while the other fails. There are exactly two standard ways out — the outbox and change data capture — and they differ in who owns the event schema.',
  phase: 'distributed',
  module: 'messaging',
  position: 31,
  kind: 'concept',
  difficulty: 'advanced',
  estimatedMinutes: 50,
  tags: ['dual-write', 'outbox', 'cdc', 'event-driven', 'event-schema'],
  prerequisites: ['d-delivery-semantics'],
  resources: [
    {
      key: 'microservices-outbox',
      tier: 'must',
      note: 'The pattern stated plainly, with the reason it works: the event write is in the same transaction as the business write. Read it first — the idea is small and the consequences are not.',
    },
    {
      key: 'debezium-docs',
      tier: 'must',
      note: 'A production CDC implementation. Read the sections on how the transaction log is read and on the initial snapshot, since the snapshot is the part that surprises people during a deployment.',
    },
    {
      key: 'martin-fowler-event-sourcing',
      tier: 'must',
      note: 'Read it for the distinction between publishing events about state changes and making events the state itself. The second is a much larger commitment, and conflating them is the commonest mistake in this area.',
    },
    {
      key: 'microservices-saga',
      tier: 'good',
      note: 'What to do when a workflow spans services and cannot be one transaction. Pairs directly with the outbox — the outbox makes each local step reliable, and the saga sequences them.',
    },
    {
      key: 'fowler-cqrs',
      tier: 'good',
      note: 'Separating the write model from read models, which is what event consumers usually end up building. Read it for the honest treatment of when the separation is not worth it.',
    },
    {
      key: 'postgres-replication',
      tier: 'advanced',
      note: 'Read the logical-decoding material. Understanding that CDC reads the same write-ahead log replication uses explains both its reliability and its operational constraints, such as replication slots retaining WAL.',
    },
  ],

  intuition: {
    body: `An order service handles a request. It must do two things: write the order to its database, and publish "order placed" so other services react.

\`\`\`
db.insert(order);        // succeeds
broker.publish(event);   // ...and then the process crashes
\`\`\`

The order exists and nobody was told. No email, no fraud check, no warehouse pick. The failure is **silent** — the API returned 201, the row is there, and the absence of an event is not a thing anything monitors.

Reverse the order and it is no better:

\`\`\`
broker.publish(event);   // succeeds
db.insert(order);        // fails on a constraint violation
\`\`\`

Now four services believe an order exists that does not. Emails sent, stock decremented, a warehouse pick generated for nothing.

This is the **dual-write problem**: two systems, no shared transaction, so any crash between them leaves them disagreeing. And it cannot be fixed by ordering, retrying, or being careful — a retry can also fail, and there is always a window.

Wrapping them in a transaction does not work either, because the broker is not in your database's transaction. **Two-phase commit across a database and a broker** is technically possible, rarely supported, and brings the blocking failure mode from the consensus lesson.

**The insight that resolves it: write the event to the same database, in the same transaction.**

\`\`\`sql
BEGIN;
  INSERT INTO orders (...);
  INSERT INTO outbox (event_type, payload);
COMMIT;
\`\`\`

Now there is **one** write to **one** system. It either happens or it does not. A separate process reads the outbox and publishes to the broker, retrying until it succeeds. The dual write has been converted into a local transaction plus an asynchronous, retryable publish.

**The other standard way out is change data capture.** Rather than writing events yourself, a process reads the database's own transaction log — the same log replication uses — and turns committed row changes into events. There is no second write at all, so there is nothing to be inconsistent.

Both work. **They differ in who owns the event schema**, and that difference is the whole decision:

- **Outbox:** you write the event, so the event is a deliberate domain fact you designed.
- **CDC:** the event is derived from your table shape, so your schema becomes your published contract.

The framing to carry: **any time you write to a database and then tell someone about it, you have a dual write. The fix is to make it one write, and then choose who owns the event schema.**`,
    analogyLimit:
      'Thinking of this as "remember to publish reliably" misses that no amount of retry logic closes the window — the process can die between the two writes, and a retry has the same problem. It also hides the schema-ownership consequence: CDC removes the dual write and quietly makes your table columns a public contract, so a routine column rename becomes a breaking change for consumers you may not know about.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team adopts CDC on their orders table to publish "order placed" events, avoiding an outbox because it needs no application changes. Six months later, a developer renames `total_cents` to `total_amount_cents` and splits `address` into structured columns. What happens, and what would the outbox have done differently?',
      answer: `**What happens: every downstream consumer breaks, and the developer had no way to know.**

With CDC, the event payload **is** the row. So the published event for an order carried \`total_cents\` and \`address\` because those were the column names. Consumers wrote code reading \`event.after.total_cents\`.

The rename ships as an ordinary migration, reviewed by people who thought about the orders table. The next event carries \`total_amount_cents\`. Every consumer reading \`total_cents\` now gets \`undefined\` — and depending on the language, that is either an exception or a silent zero. **A billing consumer computing a total from an undefined field is the worst case**: no error, wrong money.

Three things make this genuinely bad rather than merely inconvenient.

**The breaking change was invisible at the point of decision.** Nothing in the migration, the code review, or the test suite says "this column is a published API". The developer did the normal, correct thing for a database column.

**The blast radius is unknown.** With CDC, any consumer can subscribe without telling you. There is no list of who reads \`total_cents\`, so you cannot assess the impact or notify anyone.

**The failure is downstream and delayed.** The orders service is fine. Its tests pass, its metrics are healthy. The breakage appears in other teams' services, hours later, and the investigation starts far from the cause.

**What the outbox would have done differently — and this is the substance.**

With an outbox, the application constructs the event explicitly:

\`\`\`sql
INSERT INTO outbox (event_type, payload) VALUES (
  'order.placed',
  jsonb_build_object(
    'orderId', o.id,
    'totalCents', o.total_amount_cents,   -- mapped deliberately
    'shippingAddress', ...
  )
);
\`\`\`

The rename changes **one mapping expression** in one place. The event's \`totalCents\` field is unchanged, so no consumer notices. The internal schema and the published contract are **decoupled**, which is the entire point.

Two further consequences worth naming:

**The event contains what the domain means, not what the table stores.** An "order placed" event probably wants the customer's email, the line items, and the total — which may live in three tables. CDC on the orders table gives you one row and forces consumers to either join against your database (terrible) or listen to three change streams and correlate them (worse).

**The event has a name.** \`order.placed\` and \`order.cancelled\` are different facts, and with an outbox they are different event types. With CDC on the orders table, both are "a row in orders was updated" and the consumer must infer which by diffing the status field. That inference is fragile and it belongs to whoever knows the domain, which is you rather than every consumer.

**Where CDC is nonetheless the right choice.** When you cannot change the application — a legacy system, a vendor database, a monolith mid-migration — CDC gets events out with no code changes at all. That is a real and frequent situation, and CDC is the right tool for it. It is also excellent for feeding a data warehouse, where consumers genuinely want the table shape.

**The general lesson.** "No application changes" reads as a benefit and is the cost: the application not participating means the application does not own the contract, so the table shape becomes the contract by default. **Choose CDC when you cannot change the application, and the outbox when you can.**`,
    },
  body: `## The dual-write problem, precisely

Any operation that must update two systems with no shared transaction has this problem. It is not specific to databases and brokers:

- Database plus message broker.
- Database plus search index.
- Database plus cache.
- Database plus a third-party API.
- Two databases owned by two services.

The general shape: **two writes, no atomicity, so a failure between them leaves permanent disagreement.** And the disagreement is usually silent, because nothing monitors the *absence* of a second effect.

Three non-solutions worth eliminating explicitly:

**Retrying the second write.** The retry can also fail, and the process can die before retrying. It narrows the window and does not close it.

**Reordering the writes.** Publish-then-write gives phantom events; write-then-publish gives silent misses. Both are wrong, and which is *less* wrong depends on whether a false positive or a false negative is worse in your domain.

**Two-phase commit.** Rarely supported by brokers, and it brings the blocking failure mode: a coordinator failure after prepare leaves participants holding locks with no way to decide.

## Solution 1: the transactional outbox

**The mechanism.** An \`outbox\` table in the same database, written in the same transaction as the business change. A separate **relay** process reads unpublished rows, publishes them, and marks them published.

\`\`\`sql
CREATE TABLE outbox (
  id           bigserial PRIMARY KEY,
  aggregate_id text        NOT NULL,
  event_type   text        NOT NULL,
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
\`\`\`

**Why it works.** One write to one system, atomically. If the transaction commits, the event exists and *will* be published, because the relay retries until it succeeds. If it rolls back, neither exists.

**What it gives you that CDC does not:**

- **You own the event schema.** The event is a domain fact you designed, decoupled from your table shape.
- **Events have names.** \`order.placed\` and \`order.cancelled\` are distinct types, not "a row changed".
- **Events can span tables.** The payload is whatever the domain fact requires.
- **The event is a deliberate act**, so adding one is a code change that gets reviewed.

**The costs, honestly:**

**At-least-once publishing, always.** The relay can publish and crash before marking the row published, so it republishes. **Consumers must deduplicate** — which is the previous lesson's conclusion, and it means the event needs a stable id.

**Ordering needs care.** If the relay publishes concurrently, events can reach the broker out of order. Publishing in \`id\` order with a single relay preserves it at the cost of throughput; partitioning the relay by \`aggregate_id\` gives per-aggregate ordering with parallelism, which is usually what you want.

**Table growth and dead rows.** Published rows accumulate, and in an MVCC store every \`published_at\` update leaves a dead version. Needs deletion or archival, and vacuum attention.

**Relay latency.** Polling adds delay. Notification mechanisms reduce it, and the fallback poll must remain because notifications can be missed.

**A variant worth knowing: delete on publish.** Rather than marking rows published, delete them. The table stays small and the dead rows still accumulate until vacuumed, but there is no growth and no cleanup job. The trade is losing the record of what was published, which is often worth keeping for debugging.

## Solution 2: change data capture

**The mechanism.** A connector reads the database's transaction log — the write-ahead log, the binlog — and emits an event per committed row change. No application involvement at all.

**Why it works.** There is no second write. The log *is* the record of committed changes, so anything in it definitely committed.

**What it gives you:**

- **No application changes.** Decisive when you cannot modify the application.
- **Nothing can be missed.** Every committed change is in the log, including changes made by a migration script or a database administrator — which the outbox would not capture.
- **Full before-and-after images**, so consumers can see exactly what changed.

**The costs:**

**Your schema becomes your published contract.** The prediction above. A column rename is a breaking change for consumers you may not be able to enumerate.

**Events are row changes, not domain facts.** Consumers must infer intent by diffing. "Status went from \`pending\` to \`cancelled\`" is a cancellation, and the consumer has to know that.

**Multi-table facts are hard.** A domain event spanning three tables arrives as three separate change events that consumers must correlate — and correlating them correctly requires knowing the transaction boundary, which not all CDC output preserves clearly.

**Real operational constraints.** A replication slot retains write-ahead log until the consumer reads it, so **a stopped CDC consumer can fill the database's disk.** This is a genuine outage mechanism and it is the CDC failure that most often causes an incident.

**The initial snapshot.** Starting a connector on an existing table usually means reading the whole table first. On a large table that is a long operation with real load, and the snapshot's events arrive before the streaming ones.

## Which to choose

| | Outbox | CDC |
| --- | --- | --- |
| Application changes | Required | None |
| Event schema owned by | You | Your table shape |
| Events are | Domain facts you named | Row changes |
| Multi-table events | Natural | Consumers must correlate |
| Captures out-of-band changes | No | Yes |
| Extra table | Yes | No |
| Operational risk | Table growth, relay lag | Replication slot filling disk |
| Best for | Domain events between services | Feeding warehouses, legacy systems |

**The decision rule:** **outbox when you can change the application, CDC when you cannot** — plus CDC for analytical consumers who genuinely want the table shape.

**And there is a hybrid that is often best: CDC on the outbox table.** The application writes domain events to the outbox transactionally, and a CDC connector reads the outbox table's changes rather than a relay polling it. You get the outbox's schema ownership *and* CDC's reliable low-latency delivery with no polling. This is a common production arrangement and worth naming, because it looks like a compromise and is strictly better than either alone when both are available.

## Event-driven architecture: what it buys and costs

Publishing events reliably enables a style, and the style has consequences worth being explicit about.

**What it buys.**

**Producers do not know their consumers.** Adding a consumer requires no producer change. This is the decoupling that lets teams move independently.

**Availability decouples.** The order service can complete an order while the email service is down; the event waits.

**Read models can be purpose-built.** Each consumer maintains a projection shaped for its queries — a search index, a denormalised view, a cache.

**What it costs, and these are underestimated.**

**Eventual consistency becomes user-visible.** An order exists and its confirmation email has not been sent, its analytics row does not exist, and its warehouse pick has not been created. Those intermediate states are observable, and the interface must acknowledge them rather than pretend they do not exist.

**Debugging spans services.** "Why did this customer not get an email" traverses a producer, a broker, a consumer and a provider. Distributed tracing stops being optional.

**No global transaction.** A workflow spanning services cannot be rolled back, so you need **sagas** — compensating actions per step. Writing a correct compensation for every step is real work, and some effects have no compensation.

**Schema evolution is a distributed problem.** Consumers you do not control deploy on their own schedule, so events must be backward compatible or explicitly versioned.

**Ordering and duplication are the consumer's problem.** Everything from the previous lesson applies to every consumer.

## Event sourcing is a different, much larger commitment

These are frequently conflated and should not be.

**Publishing events about state changes** — what this lesson describes — keeps the database as the source of truth and emits notifications about changes to it. Moderate commitment, easily adopted incrementally, easily reverted.

**Event sourcing** makes the event log itself the source of truth. There is no orders table that is authoritative; current state is derived by replaying events. That buys a complete audit trail and the ability to reconstruct any past state, and it costs a great deal:

- Every query needs a projection, because you cannot query a log.
- Schema evolution means old events in old formats must remain readable forever.
- Deleting data — a legal erasure request — is genuinely hard in an append-only log.
- The mental model is unfamiliar to most engineers who will maintain it.

**The honest position:** event sourcing is right for domains where the history *is* the domain — ledgers, audit-critical systems, anything where "how did we get here" is a first-class question. For most systems, a database as the source of truth plus an outbox publishing events gets most of the benefit at a fraction of the cost.

## Where none of this applies

**When the operation should be synchronous.** If the caller needs the result, publish nothing and call directly.

**When there is one consumer inside the same transaction boundary.** Two tables in one database need one transaction, not an event.

**When the coupling is genuinely tight.** If service A cannot function without an immediate response from B, an event does not decouple them — it just makes the coupling asynchronous and harder to see.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'dual-write',
      title: 'The dual write, and the two ways out',
      caption:
        'Step through it. The top path is the problem — two systems, no atomicity. The two lower paths each remove the second write, and they differ in exactly one respect: who authors the event.',
      nodes: [
        { id: 'svc', label: 'Order service', kind: 'service', x: 0, y: 200, detail: 'Handles the request. Must both record the order and tell other services about it — two effects in two systems.' },
        { id: 'db1', label: 'Database', kind: 'store', x: 210, y: 60, detail: 'The order row commits. From here the API can return 201 with the order genuinely recorded.' },
        { id: 'brk1', label: 'Broker', kind: 'store', x: 420, y: 60, detail: 'The publish never happens — the process crashed. Nothing monitors the ABSENCE of an event, so the failure is silent.' },
        { id: 'broken', label: 'Silent divergence', kind: 'note', x: 620, y: 60, detail: 'An order exists that nobody was told about. No email, no fraud check, no warehouse pick. Returned 201, row present, no alert anywhere.' },
        { id: 'tx', label: 'One transaction', kind: 'service', x: 210, y: 210, detail: 'INSERT the order and INSERT the outbox row together. One write to one system: it either happens or it does not.' },
        { id: 'outbox', label: 'outbox table', kind: 'store', x: 400, y: 210, detail: 'Holds the event the application authored — a named domain fact with a payload spanning whatever tables the fact requires.' },
        { id: 'relay', label: 'Relay', kind: 'service', x: 570, y: 210, detail: 'Reads unpublished rows and publishes, retrying until it succeeds. Can publish then crash before marking published, so publishing is at-least-once.' },
        { id: 'wal', label: 'Transaction log', kind: 'store', x: 210, y: 350, detail: 'The database\'s own write-ahead log. Anything in it definitely committed, so there is no second write to be inconsistent with.' },
        { id: 'cdc', label: 'CDC connector', kind: 'service', x: 400, y: 350, detail: 'Reads the log and emits an event per committed row change. No application changes — and the row shape becomes the event shape.' },
        { id: 'contract', label: 'Table = contract', kind: 'note', x: 620, y: 350, detail: 'A column rename is now a breaking change for consumers you may not be able to enumerate, decided in a migration review that had no reason to consider it.' },
      ],
      edges: [
        { id: 'd1', source: 'svc', target: 'db1', kind: 'write' },
        { id: 'd2', source: 'db1', target: 'brk1', kind: 'write' },
        { id: 'd3', source: 'brk1', target: 'broken', kind: 'control' },
        { id: 'd4', source: 'svc', target: 'tx', kind: 'write' },
        { id: 'd5', source: 'tx', target: 'outbox', kind: 'write' },
        { id: 'd6', source: 'outbox', target: 'relay', kind: 'read' },
        { id: 'd7', source: 'tx', target: 'wal', kind: 'async' },
        { id: 'd8', source: 'wal', target: 'cdc', kind: 'read' },
        { id: 'd9', source: 'cdc', target: 'contract', kind: 'control' },
      ],
      steps: [
        {
          id: 'dw1',
          title: 'Two writes, and a window between them',
          description:
            'The order commits and the publish does not. Retrying narrows the window and cannot close it, because the process can die before the retry. Reordering only changes which failure you get.',
          nodes: ['svc', 'db1', 'brk1', 'broken'],
          edges: ['d1', 'd2', 'd3'],
        },
        {
          id: 'dw2',
          title: 'The outbox makes it one write',
          description:
            'The order row and the event row commit together in one transaction. There is no window, because there is nothing between them — atomicity does the work that retry logic could not.',
          nodes: ['tx', 'outbox'],
          edges: ['d4', 'd5'],
        },
        {
          id: 'dw3',
          title: 'The relay publishes at-least-once',
          description:
            'It reads unpublished rows and retries until the broker accepts them. It can publish and crash before marking the row, so consumers must deduplicate on a stable event id.',
          nodes: ['relay'],
          edges: ['d6'],
        },
        {
          id: 'dw4',
          title: 'CDC removes the second write differently',
          description:
            'It reads the transaction log, so anything it emits definitely committed. No application changes at all — which is decisive when you cannot modify the application.',
          nodes: ['wal', 'cdc'],
          edges: ['d7', 'd8'],
        },
        {
          id: 'dw5',
          title: 'And that is exactly what it costs',
          description:
            'The application not participating means the application does not own the contract. The table shape becomes the published schema, so a column rename breaks consumers nobody listed.',
          nodes: ['contract'],
          edges: ['d9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'ownership',
      title: 'The decision is schema ownership',
      caption:
        'Read the middle column. Every practical difference between the two patterns follows from who authors the event — and the hybrid at the bottom gets the ownership of one with the delivery of the other.',
      code: `flowchart LR
    Q["Can you change<br/>the application?"]

    Q -->|Yes| OB["**Outbox**<br/>You author the event"]
    Q -->|No| CD["**CDC**<br/>The table authors the event"]

    OB --> OB1["Named domain facts:<br/>order.placed, order.cancelled"]
    OB --> OB2["Payload spans tables"]
    OB --> OB3["Internal schema decoupled<br/>from the contract"]
    OB --> OB4["Cost: an outbox table,<br/>a relay, table growth"]

    CD --> CD1["Row changes:<br/>consumers diff to infer intent"]
    CD --> CD2["One table per stream;<br/>consumers correlate"]
    CD --> CD3["Column rename = breaking<br/>change for unknown consumers"]
    CD --> CD4["Captures migrations and<br/>out-of-band writes too"]
    CD --> CD5["Risk: a stopped consumer<br/>retains WAL and fills the disk"]

    OB4 --> H["**Hybrid: CDC on the outbox table**<br/>Outbox schema ownership +<br/>CDC delivery, no polling"]
    CD5 --> H

    style OB3 fill:#17272a,stroke:#35897e
    style CD3 fill:#2a1a1a,stroke:#a04848
    style CD5 fill:#2a1a1a,stroke:#a04848
    style H fill:#231b2a,stroke:#7a5ea8`,
    },
  ],

  productionExample: {
    systems: ['stripe'],
    body: `Webhooks are the most widely-deployed instance of this pattern, and they are instructive because the guarantees are published rather than inferred.

**The shape.** A payment succeeds, and Stripe must both record it and notify the merchant's endpoint. Two systems — their database and the merchant's server — so the dual-write problem in its purest form, with the second system entirely outside their control.

**What the published contract tells you they do.**

**Events are durable and queryable independently of delivery.** You can list past events over the API, which means the event was recorded as a fact before any delivery was attempted. That is the outbox pattern's essential property: **the event's existence does not depend on delivery succeeding.**

**Delivery is at-least-once, with retries over an extended window.** A merchant endpoint that is down for hours receives the events afterwards. This is the relay retrying, and it is why the documentation is explicit that handlers must be idempotent.

**Events carry a stable id and are explicitly documented as possibly duplicated.** The deduplication obligation is stated as part of the contract, not left to be discovered. Merchants deduplicate on the event id.

**Event ordering is explicitly not guaranteed.** Retries reorder, exactly as the previous lesson's tension predicts. Rather than promising ordering they cannot maintain, the documentation says so and advises fetching current state from the API when order matters — pushing consumers toward version-based reasoning instead of ordering assumptions.

**The events are domain facts with names**, versioned independently of internal storage. \`payment_intent.succeeded\` is a designed event, not a row diff. A change to their internal schema does not change the event, which is the outbox's schema-ownership benefit at a public boundary where it matters most.

**Three transferable lessons.**

**Record the event as a fact first, deliver second.** Delivery is unreliable and retryable; the fact is not. This is the outbox's core idea and it applies to any notification.

**Publish your guarantees, including the unflattering ones.** At-least-once, no ordering, deduplicate on the id, retries for this long. Consumers cannot write a correct handler without knowing these, and stating them prevents the consumer bugs you would otherwise be blamed for.

**Make the event a designed artefact.** Named, versioned, and independent of your tables. This is what lets internal refactoring proceed without breaking anyone — and it is precisely what CDC on a business table gives up.

**Where the analogy has a limit.** Stripe's consumers are external and numerous, which makes schema ownership overwhelmingly worth the cost. For an internal analytical pipeline feeding a warehouse, consumers genuinely want the table shape, and CDC is the better tool. **The choice follows from who the consumers are**, not from one pattern being superior.`,
  },

  tradeoffs: {
    intro:
      'The decision is how to remove the second write, and then who owns the event schema. Rows include the non-solutions, because rejecting them clearly is part of the answer.',
    rows: [
      {
        option: 'Write to the database, then publish (no pattern)',
        whenItWins:
          'Nowhere, for anything that matters. Occasionally acceptable for a best-effort notification whose loss costs nothing.',
        whenItLoses:
          'Always, when the event matters. A crash between the two leaves permanent, silent divergence.',
        cost:
          'Silent missed events with no alert, because nothing monitors the absence of an effect.',
      },
      {
        option: 'Publish, then write to the database',
        whenItWins:
          'Effectively nowhere. Slightly preferable only when a phantom event is cheaper than a missed one, which is rare.',
        whenItLoses:
          'Almost always: consumers act on an entity that does not exist, sending emails and decrementing stock for nothing.',
        cost:
          'Phantom events, with downstream effects that must be compensated.',
      },
      {
        option: 'Transactional outbox with a polling relay',
        whenItWins:
          'The default when you can change the application. You own the event schema, events are named domain facts, and payloads span tables.',
        whenItLoses:
          'When you cannot modify the application, or when polling latency is unacceptable.',
        cost:
          'An outbox table with growth and dead rows, a relay to operate, polling latency, and at-least-once publishing.',
      },
      {
        option: 'Change data capture on business tables',
        whenItWins:
          'When the application cannot be changed — legacy, vendor, monolith mid-migration — and for analytical consumers who want the table shape.',
        whenItLoses:
          'For domain events between services, where the table shape becoming a public contract is a serious liability.',
        cost:
          'Schema as contract, row changes rather than facts, multi-table correlation, and a replication slot that can fill the disk.',
      },
      {
        option: 'CDC on the outbox table (hybrid)',
        whenItWins:
          'Often the best available: the application authors events transactionally, and CDC delivers them with low latency and no polling.',
        whenItLoses:
          'When running a CDC connector is operationally out of reach for the team.',
        cost:
          'Both systems to operate, plus the replication-slot risk.',
      },
      {
        option: 'A database table as the queue, no broker',
        whenItWins:
          'Moderate volume with a single logical consumer. The enqueue is transactional with the business write and there is nothing else to run.',
        whenItLoses:
          'At volume, or when several consumers need the same events, or when replay is needed.',
        cost:
          'Polling load, claim contention, table growth, and no fan-out or replay.',
      },
      {
        option: 'Event sourcing (the log is the source of truth)',
        whenItWins:
          'Domains where history is the domain — ledgers, audit-critical systems, anything where "how did we get here" is a first-class query.',
        whenItLoses:
          'Most systems. Every query needs a projection, old event formats must stay readable forever, and deletion is genuinely hard.',
        cost:
          'Projections for all reads, permanent schema-evolution obligations, a hard data-deletion problem, and an unfamiliar model.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We write the order, then publish the event, and retry the publish if it fails."',
      whyWeak:
        'Retrying narrows the window and cannot close it. The process can die after the commit and before the publish, or after a failed publish and before the retry. The result is an order nobody was told about, with no error and nothing monitoring the absence of an event.',
      strongAnswer:
        '"That is a dual write, and retry logic cannot fix it — there is always a window and the retry has the same problem. I would write the event to an outbox table in the same transaction as the order, so it is one write to one system. A relay then publishes from the outbox and retries until the broker accepts it, which makes publishing at-least-once and means consumers deduplicate on the event id."',
    },
    {
      weakAnswer: '"We use CDC because it needs no application changes."',
      whyWeak:
        'That is the cost presented as the benefit. If the application does not author the event, the table shape becomes the published contract — so a column rename is a breaking change for consumers you cannot enumerate, decided in a migration review that had no reason to consider it.',
      strongAnswer:
        '"No application changes means the application does not own the event schema, so my columns become a public API. A rename breaks consumers I may not be able to list, and the failure appears in their services hours later. I would use CDC where I genuinely cannot change the application, or for analytical consumers who want the table shape — and an outbox for domain events between services, so internal refactoring stays internal."',
    },
    {
      weakAnswer: '"The outbox guarantees each event is published exactly once."',
      whyWeak:
        'The outbox guarantees the event is *recorded* atomically with the business change. Publishing is a separate at-least-once step: the relay can publish and crash before marking the row published, so it republishes on restart.',
      strongAnswer:
        '"The outbox makes the event\'s *existence* atomic with the business write. Publishing from the outbox is at-least-once — the relay can publish and crash before marking the row, so it republishes. So the event needs a stable id and consumers must deduplicate on it, which I would state in the event contract rather than leave to be discovered."',
    },
    {
      weakAnswer: '"We run CDC and the consumer has been down for a few hours — we will restart it later."',
      whyWeak:
        'A replication slot retains write-ahead log until the consumer reads it. A stopped CDC consumer therefore accumulates WAL on the database, and given enough time it fills the disk and takes the database down. This is the CDC failure mode that most often causes an incident.',
      strongAnswer:
        '"A stopped CDC consumer is a database availability risk, not just a lag problem — the replication slot retains WAL until it is read, so disk fills. I would alert on slot lag in bytes with a threshold well below free disk, and treat a stopped connector as an urgent incident. Dropping the slot stops the bleeding at the cost of needing a re-snapshot, so that trade needs to be a documented decision rather than an improvised one."',
    },
    {
      weakAnswer: '"We are event-driven, so services are decoupled."',
      whyWeak:
        'Events decouple availability and deployment, and they do not remove coupling if the semantics are coupled. If consumers must understand the producer\'s internal states to interpret events, or if a workflow depends on consumers reacting in a particular order, the coupling is still there and is now harder to see.',
      strongAnswer:
        '"Events decouple availability and deployment — a consumer can be down and catch up. They do not decouple semantics: if consumers must diff a status field to infer intent, or a workflow depends on a particular reaction order, the coupling is still present and now implicit. Publishing named domain facts rather than state dumps is what makes the decoupling real, and cross-service workflows need an explicit saga rather than hoping the reactions line up."',
    },
    {
      weakAnswer: '"We will use event sourcing so we have a full audit trail."',
      whyWeak:
        'It conflates publishing events with making them the source of truth. Event sourcing means every query needs a projection, every old event format must remain readable forever, and deleting a customer\'s data from an append-only log is genuinely hard. An audit trail is available far more cheaply.',
      strongAnswer:
        '"If the goal is an audit trail, an append-only audit table plus an outbox gets it without making the log the source of truth. Event sourcing is a much larger commitment — no queryable current state without projections, permanent obligations around old event formats, and a real problem honouring data-deletion requests. I would reserve it for domains where the history *is* the domain, like a ledger."',
    },
  ],

  flashcards: [
    {
      id: 'fc-ob-1',
      front: 'What is the dual-write problem?',
      back: 'Two systems updated with no shared transaction, so a crash between them leaves permanent disagreement — and the divergence is silent because nothing monitors an absent effect.',
      topic: 'dual-write',
    },
    {
      id: 'fc-ob-2',
      front: 'Why does retrying the second write not fix it?',
      back: 'The retry can also fail and the process can die before retrying. Retry narrows the window; it cannot close it.',
      topic: 'dual-write',
    },
    {
      id: 'fc-ob-3',
      front: 'What are the only two standard ways out?',
      back: 'The transactional outbox — write the event to the same database in the same transaction — and change data capture, which reads the database\'s own transaction log.',
      topic: 'dual-write',
    },
    {
      id: 'fc-ob-4',
      front: 'What exactly does the outbox make atomic?',
      back: 'The event\'s *existence* with the business write. Publishing from the outbox is a separate at-least-once step.',
      topic: 'outbox',
    },
    {
      id: 'fc-ob-5',
      front: 'Why is outbox publishing at-least-once?',
      back: 'The relay can publish and crash before marking the row published, so it republishes. Consumers must deduplicate on a stable event id.',
      topic: 'outbox',
    },
    {
      id: 'fc-ob-6',
      front: 'How do you get per-aggregate ordering from an outbox?',
      back: 'Partition the relay by aggregate id and publish in id order within each partition — ordering where it matters, with parallelism.',
      topic: 'outbox',
    },
    {
      id: 'fc-ob-7',
      front: 'What is the real difference between the outbox and CDC?',
      back: 'Who owns the event schema. With an outbox you author the event; with CDC the table shape is the contract.',
      topic: 'event-schema',
    },
    {
      id: 'fc-ob-8',
      front: 'Why is "no application changes" a cost as well as a benefit?',
      back: 'If the application does not author the event, it does not own the contract — so a column rename is a breaking change for consumers you may not be able to enumerate.',
      topic: 'event-schema',
    },
    {
      id: 'fc-ob-9',
      front: 'What can CDC capture that an outbox cannot?',
      back: 'Out-of-band changes — migration scripts, administrator edits, anything that writes to the table without going through the application.',
      topic: 'cdc',
    },
    {
      id: 'fc-ob-10',
      front: 'What is CDC\'s most dangerous operational failure?',
      back: 'A replication slot retains write-ahead log until the consumer reads it, so a stopped CDC consumer accumulates WAL and can fill the database\'s disk.',
      topic: 'cdc',
    },
    {
      id: 'fc-ob-11',
      front: 'What is the hybrid arrangement, and why is it good?',
      back: 'CDC on the outbox table. The application authors events transactionally, and CDC delivers them with low latency and no polling — ownership of one, delivery of the other.',
      topic: 'cdc',
    },
    {
      id: 'fc-ob-12',
      front: 'What does event-driven architecture not decouple?',
      back: 'Semantics. If consumers must diff a status field to infer intent, or a workflow depends on reaction order, the coupling is still there and now implicit.',
      topic: 'event-driven',
    },
    {
      id: 'fc-ob-13',
      front: 'How does event sourcing differ from publishing events?',
      back: 'It makes the log the source of truth rather than the database. Every query needs a projection, old event formats must stay readable forever, and deletion is genuinely hard.',
      topic: 'event-driven',
    },
    {
      id: 'fc-ob-14',
      front: 'When is event sourcing actually right?',
      back: 'When history *is* the domain — ledgers, audit-critical systems. For an audit trail alone, an append-only table plus an outbox is far cheaper.',
      topic: 'event-driven',
    },
  ],

  quiz: [
    {
      id: 'q-ob-1',
      kind: 'scenario',
      prompt:
        'A service inserts an order, then publishes "order placed", and crashes between the two. What is the state, and what would have prevented it?',
      options: [
        { id: 'a', label: 'The order exists and no consumer knows — a silent divergence; an outbox row written in the same transaction would have prevented it' },
        { id: 'b', label: 'The order insert is rolled back automatically when the publish fails' },
        { id: 'c', label: 'Nothing is wrong; the publish will be retried on restart' },
        { id: 'd', label: 'The broker detects the missing event and requests it' },
      ],
      correct: ['a'],
      explanation:
        'The insert committed and the publish did not, with nothing to reconcile them. Retry on restart requires knowing the publish was owed, which is exactly the record that does not exist. Writing the event to an outbox table in the same transaction makes it one atomic write, and a relay then publishes with retries.',
      difficulty: 'core',
      topic: 'dual-write',
    },
    {
      id: 'q-ob-2',
      kind: 'scenario',
      prompt:
        'A team uses CDC on their orders table. A developer renames a column in a routine migration. What happens?',
      options: [
        { id: 'a', label: 'Every consumer reading that field breaks, and the developer had no signal that the column was a published contract' },
        { id: 'b', label: 'The CDC connector maps the old name automatically' },
        { id: 'c', label: 'Nothing, since CDC emits the full row regardless of names' },
        { id: 'd', label: 'The connector fails and stops, alerting the team' },
      ],
      correct: ['a'],
      explanation:
        'With CDC the event payload is the row, so column names are field names in a public contract. The rename is invisible as a breaking change at the point of decision, the affected consumers are unenumerable, and the failure appears in other teams\' services later. An outbox would have needed one mapping expression changed.',
      difficulty: 'core',
      topic: 'event-schema',
    },
    {
      id: 'q-ob-3',
      kind: 'scenario',
      prompt:
        'A CDC consumer has been stopped for eight hours during an incident. Beyond lag, what is the risk?',
      options: [
        { id: 'a', label: 'The replication slot retains write-ahead log until it is read, so the database\'s disk can fill and take the database down' },
        { id: 'b', label: 'The connector will need a full re-snapshot on restart' },
        { id: 'c', label: 'Events older than the retention period are lost' },
        { id: 'd', label: 'Nothing beyond lag; the log is retained indefinitely at no cost' },
      ],
      correct: ['a'],
      explanation:
        'This is CDC\'s most dangerous operational property and the one that turns a consumer outage into a database outage. It needs an alert on slot lag in bytes with a threshold well below free disk, and a documented decision about when to drop the slot — which stops the growth at the cost of a re-snapshot.',
      difficulty: 'advanced',
      topic: 'cdc',
    },
    {
      id: 'q-ob-4',
      kind: 'single',
      prompt: 'What does the transactional outbox guarantee?',
      options: [
        { id: 'a', label: 'That the event exists if and only if the business change committed — publishing is a separate at-least-once step' },
        { id: 'b', label: 'That each event is published exactly once' },
        { id: 'c', label: 'That events are published in order across all aggregates' },
        { id: 'd', label: 'That consumers process each event exactly once' },
      ],
      correct: ['a'],
      explanation:
        'The atomicity is between the business write and the event *record*. The relay can publish and crash before marking the row, so publishing is at-least-once and consumers must deduplicate. Global ordering requires a single serial relay, which costs throughput; per-aggregate ordering is the usual compromise.',
      difficulty: 'core',
      topic: 'outbox',
    },
    {
      id: 'q-ob-5',
      kind: 'scenario',
      prompt:
        'A team wants an audit trail of every change and proposes event sourcing. What is the cheaper alternative and what would event sourcing cost?',
      options: [
        { id: 'a', label: 'An append-only audit table plus an outbox; event sourcing would require projections for every query, permanent readability of old event formats, and a hard deletion problem' },
        { id: 'b', label: 'CDC into a data warehouse, which is equivalent to event sourcing' },
        { id: 'c', label: 'Nothing cheaper exists; event sourcing is the standard way to get an audit trail' },
        { id: 'd', label: 'Database transaction logs, which already provide a queryable audit trail' },
      ],
      correct: ['a'],
      explanation:
        'Publishing events and making the log the source of truth are different commitments, and conflating them is the common error. An audit trail wants an append-only record; event sourcing means current state is derived, so every read needs a projection and every historical event format must remain readable forever.',
      difficulty: 'advanced',
      topic: 'event-driven',
    },
    {
      id: 'q-ob-6',
      kind: 'multi',
      prompt:
        'Which are genuine advantages of an outbox over CDC on business tables? Select all that apply.',
      options: [
        { id: 'a', label: 'The event payload can span several tables, matching the domain fact' },
        { id: 'b', label: 'Events have explicit names rather than being row diffs consumers must interpret' },
        { id: 'c', label: 'Internal schema changes do not break consumers' },
        { id: 'd', label: 'It captures changes made by migration scripts and administrator edits' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three all follow from the application authoring the event. The fourth is CDC\'s advantage, not the outbox\'s — an outbox only captures what the application writes, so an out-of-band update misses it entirely, which is a real argument for CDC when such writes happen.',
      difficulty: 'core',
      topic: 'outbox',
    },
  ],

  exercises: [
    {
      id: 'ex-ob-1',
      kind: 'design',
      title: 'Remove every dual write, then own the schema',
      estimatedMinutes: 30,
      prompt: `An order service must, when an order is placed: write the order and line items, publish "order placed" for four consumers, update a search index, and call a third-party tax service to record the transaction.

Design it. Specify the outbox schema, the relay, the event payload, and how each of the four effects is made reliable. Then answer:

- Which effects are dual writes and which are not?
- What is the relay's ordering guarantee, and how do you get per-order ordering with parallelism?
- The outbox table reaches 400 million rows. What went wrong and what do you do?
- The tax service call cannot be in the transaction. How do you make it reliable?
- A consumer asks for a field that is in your \`orders\` table but not in your event. Do you add it?`,
      rubric: [
        'Identifies the broker publish, the search index and the tax call as dual writes; the order and line-item writes as one transaction.',
        'Outbox schema with aggregate id, event type, payload, and a stable event id.',
        'Event payload is a named domain fact spanning tables, not a row dump.',
        'Search index driven from the event stream rather than written inline.',
        'Tax call handled via the outbox or a separate durable intent record with an idempotency key.',
        'Relay ordering answer: global order needs a serial relay; partition by aggregate id for per-order ordering with parallelism.',
        'Table-growth answer identifies missing cleanup and MVCC dead rows, and gives a concrete remedy.',
        'Field-addition answer reasons about contract ownership rather than convenience.',
      ],
      modelAnswer: `**First, classify each effect.**

| Effect | Dual write? |
| --- | --- |
| Write order + line items | **No** — same database, one transaction. |
| Publish "order placed" | **Yes** — database plus broker. |
| Update the search index | **Yes** — database plus search engine. |
| Call the tax service | **Yes** — database plus third-party API. |

So one atomic write and three dual writes. **All three are solved by the same move: turn each into a row in the outbox, committed with the order.**

That is the observation worth leading with. The outbox is not "how we publish events" — it is **how we record intent to do anything outside this database**, and once you see it that way the design collapses into one mechanism.

**Outbox schema**

\`\`\`sql
CREATE TABLE outbox (
  id            bigserial   PRIMARY KEY,
  event_id      uuid        NOT NULL UNIQUE,   -- stable, published to consumers
  aggregate_type text       NOT NULL,          -- 'order'
  aggregate_id  text        NOT NULL,          -- '4471' — the partition key
  event_type    text        NOT NULL,          -- 'order.placed'
  payload       jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);

CREATE INDEX ON outbox (id) WHERE published_at IS NULL;
\`\`\`

*Why \`event_id\` is separate from \`id\`:* \`id\` is a local sequence used for ordering; \`event_id\` is what consumers deduplicate on. Publishing the local sequence number would leak an internal detail and would not survive a table rebuild.

*Why the partial index:* the relay only queries unpublished rows. A partial index stays small even when the table is large, so relay queries do not degrade as history accumulates — this is the index that makes the polling relay viable.

**The write path**

\`\`\`sql
BEGIN;
  INSERT INTO orders (...) RETURNING id;
  INSERT INTO order_line_items (...);
  INSERT INTO outbox (event_id, aggregate_type, aggregate_id, event_type, payload)
  VALUES (gen_random_uuid(), 'order', '4471', 'order.placed', <payload>);
COMMIT;
\`\`\`

One transaction. Either the order and its event both exist, or neither does.

**The event payload — a domain fact, not a row**

\`\`\`json
{
  "eventId": "…", "eventType": "order.placed", "eventVersion": 1,
  "occurredAt": "2026-09-07T14:22:10Z",
  "order": {
    "orderId": "4471", "customerId": "8891",
    "customerEmail": "…",
    "totalCents": 12980, "currency": "GBP",
    "lineItems": [ { "sku": "ABC", "quantity": 2, "unitPriceCents": 4990 } ],
    "shippingAddress": { … }
  }
}
\`\`\`

*Three deliberate choices:*

**It spans tables.** \`lineItems\` comes from \`order_line_items\`, \`customerEmail\` from \`customers\`. A domain fact is not a row, and this is the outbox's central advantage — CDC on \`orders\` would give one row and force consumers to correlate three change streams.

**Field names are contract names, not column names.** \`totalCents\` in the event; \`total_amount_cents\` may be the column. One mapping expression sits between them, so a rename is internal.

**\`eventVersion\` from the start.** Adding versioning later means every consumer must handle unversioned events forever. It costs one field now.

**The four consumers**

All four read the same topic as separate consumer groups. Nothing about the producer changes when a fifth arrives — which is the log's fan-out property from the queues lesson, and the reason the events go to a log rather than four queues.

**The search index — driven from the event stream, not written inline**

A dedicated consumer group reads \`order.placed\` and updates the index.

*Why not write it in the request path:* that is the dual write. And the index would then be updated by every code path that touches orders, so a migration or an admin edit would silently desynchronise it.

*Why this is better than it first appears:* the index becomes **rebuildable**. Reset the consumer group's offset to the beginning of retention and the index is reconstructed. That turns "the index is wrong" from an incident into an operation — and it is worth choosing the retention period with this in mind.

*Idempotency:* indexing by document id with the event's payload is an absolute assignment, so a duplicate is harmless. I would also carry an \`orderVersion\` and have the consumer skip any event whose version is not greater, so out-of-order delivery cannot regress the index.

**The tax service call — a separate outbox row, not an event consumer**

\`\`\`sql
INSERT INTO outbox (event_id, aggregate_type, aggregate_id, event_type, payload)
VALUES (…, 'order', '4471', 'tax.record_transaction', {…});
\`\`\`

A dedicated relay handler for \`tax.record_transaction\` calls the tax API with an idempotency key of \`order-4471-tax\`, and marks the row published only on success.

*Why a distinct event type rather than a consumer of \`order.placed\`:* both work. I prefer the explicit \`tax.record_transaction\` because it is a **command directed at one specific integration**, not a fact broadcast to whoever cares. Keeping commands and facts distinguishable in the outbox means a replay of facts does not re-fire commands — which matters, and is the same distinction the previous lesson's replay-mode discussion turned on.

*Retry policy:* exponential backoff with a cap, and after N failures the row is flagged for manual attention with an alert. **A permanently-failing outbox row is the outbox's equivalent of a dead-letter message**, and it needs the same treatment: an alert, an owner, and a replay path. Without that, the relay retries forever and nobody knows.

**Relay ordering: what you get and how to get more**

*A single serial relay* publishing in \`id\` order gives **global ordering** across all aggregates. Correct, and its throughput is one publish at a time — a bottleneck at any real volume.

*Concurrent publishing with no partitioning* gives **no ordering at all**. Two events for order 4471 can reach the broker in either order.

*What I would do: partition the relay by \`aggregate_id\`.*

\`\`\`
relay instance i handles rows where hash(aggregate_id) % N == i,
publishing in id order within its own set
\`\`\`

This gives **per-order ordering with N-way parallelism**, which is the guarantee that actually matters — \`order.placed\` before \`order.cancelled\` for the same order. Ordering *between* different orders is meaningless.

*The detail that makes it work:* the broker partition key must also be \`aggregate_id\`, or the broker reorders what the relay carefully ordered. **Ordering has to hold end to end** — relay partitioning plus broker keying plus a consumer that does not process a batch concurrently. Break any link and the guarantee is gone, which is why I would also carry \`orderVersion\` so ordering is an optimisation rather than a correctness requirement.

**400 million outbox rows — what went wrong**

Two things, and the second is the one people miss.

**No cleanup job.** Rows were marked \`published_at\` and never removed. Every order ever placed is still there.

**MVCC dead versions.** Each row was \`INSERT\`ed and then \`UPDATE\`d to set \`published_at\`. In an MVCC store that update creates a new version and leaves the old one dead until vacuumed. So the physical table is roughly twice the logical row count in versions, and a high-churn table like this is a classic vacuum problem.

*The symptoms I would expect:* the partial index keeps relay queries fast, so **relay latency looks fine** — which is why this goes unnoticed. What degrades is table size on disk, backup duration, and vacuum time.

*What I do now, in order:*

1. **Delete published rows older than a retention window** — 7 days, so there is a debugging record — in **small batches** with a pause between them. A single \`DELETE\` of 400 million rows takes an exclusive-ish toll on the table and generates enormous WAL. Batched deletion is slower and safe.
2. **Partition the table by \`created_at\`** so future cleanup is dropping a partition rather than deleting rows. Dropping a partition is instant and generates almost no WAL — this is the real fix.
3. **Vacuum aggressively**, or after partitioning let old partitions be dropped so vacuum never has to catch up.

*What I would change in the design:* **delete the row on publish instead of updating it.** Then the table holds only unpublished rows and stays near-empty in normal operation. The cost is losing the published record — which I would recover by having the relay write a copy to a partitioned \`outbox_archive\` table, or by simply relying on the broker's own retention, since the event is in the log anyway.

*And the monitoring I would add:* alert on **unpublished** row count and on the age of the oldest unpublished row. Those two catch a stalled relay immediately, and neither is affected by table growth. Total row count is the metric that would have caught this one, and nobody graphs it.

**A consumer asks for a field in \`orders\` but not in the event. Do I add it?**

**Not automatically — and the question to ask back is why they want it.**

Three cases with different answers:

**It is part of the domain fact and I omitted it.** If the field genuinely describes the order at the moment it was placed — a promotional code, a delivery preference — then yes, add it. Additive changes are backward compatible: existing consumers ignore an unknown field. I bump \`eventVersion\` and document it.

**It is internal state they should not depend on.** \`fraud_review_status\`, \`internal_notes\`, a denormalised counter. **No.** Adding it makes an internal implementation detail a published contract, and I will be unable to change it later. This is exactly the CDC failure mode arriving through the front door — and the reason to have an outbox is to be able to say no here.

**They want current state, not the fact.** "What is the order's status now?" is a query, not an event field. The event says what happened at a point in time; asking it to carry mutable current state means it goes stale immediately and consumers build wrong assumptions on it. **The answer is an API call or a \`order.status_changed\` event**, not a field on \`order.placed\`.

*The general principle:* an event describes **what happened**, immutably. If a requested field is part of what happened, add it. If it is current state, it belongs in a query or a different event. If it is internal, decline — and note that being able to decline is precisely the value the outbox provides over CDC.

*One process improvement I would propose:* a written event schema with an owner, versioned in the repository, reviewed like an API. Then "add this field" is a reviewable change against a documented contract rather than a favour, and the conversation above happens once per field rather than being re-litigated.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-ob-1',
      level: 'basic',
      question: 'What is the dual-write problem?',
      guidance:
        'Two systems, no shared transaction, so a crash between them leaves permanent disagreement. Look for the recognition that the divergence is silent and that retry does not fix it.',
    },
    {
      id: 'iq-ob-2',
      level: 'basic',
      question: 'How does the transactional outbox work?',
      guidance:
        'Write the event to a table in the same transaction as the business change; a relay publishes and retries. A strong answer states precisely what is atomic — the event\'s existence, not its publication.',
    },
    {
      id: 'iq-ob-3',
      level: 'intermediate',
      question: 'When would you choose CDC over an outbox?',
      guidance:
        'When you cannot change the application, or for analytical consumers who want the table shape. Look for schema ownership as the deciding axis rather than convenience.',
    },
    {
      id: 'iq-ob-4',
      level: 'intermediate',
      question: 'What ordering does an outbox relay give you?',
      guidance:
        'Global ordering needs a single serial relay. Partitioning by aggregate id gives per-aggregate ordering with parallelism. Strong answers note ordering must hold end to end through the broker key and the consumer.',
    },
    {
      id: 'iq-ob-5',
      level: 'advanced',
      question: 'What operational problems does each pattern bring?',
      guidance:
        'Outbox: table growth, MVCC dead rows, relay lag, permanently-failing rows needing an alert. CDC: a replication slot retaining WAL and filling disk, plus the initial snapshot. Excellent answers name the metrics to alert on.',
    },
    {
      id: 'iq-ob-6',
      level: 'advanced',
      question: 'How is event sourcing different, and when is it worth it?',
      guidance:
        'It makes the log the source of truth, so every query needs a projection and old formats must stay readable forever. Worth it when history is the domain. Excellent answers offer an append-only audit table as the cheap alternative.',
    },
    {
      id: 'iq-ob-7',
      level: 'followup',
      question: 'A consumer asks you to add an internal field to your event. What do you say?',
      guidance:
        'Distinguish part-of-the-fact (add it, additively), current state (an API call or a different event), and internal detail (decline). A strong answer notes that being able to decline is the value the outbox provides.',
    },
    {
      id: 'iq-ob-8',
      level: 'followup',
      question: 'Your outbox table has 400 million rows and relay latency looks fine. Why?',
      guidance:
        'A partial index on unpublished rows keeps relay queries fast, so the growth shows up in disk, backups and vacuum instead. A strong answer alerts on unpublished count and oldest unpublished age, and partitions by time so cleanup is a partition drop.',
    },
  ],

  activeLearning: [
    {
      id: 'al-ob-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed the event and the business data live in one database you control. Now change one thing: the write spans two services with separate databases — reserve inventory in one, charge payment in another — and both must succeed or neither. What patterns apply, and what genuinely cannot be achieved?',
      discussion: `The outbox solves "one database plus one external effect". This is a different problem: **two authoritative writes in two databases**, and no pattern gives you a transaction across them.

**What genuinely cannot be achieved.** Atomicity. There is no arrangement of outboxes that makes two writes in two databases commit together. Two-phase commit technically could, and brings the blocking failure mode from the consensus lesson: a coordinator failure after prepare leaves both services holding locks with no way to decide. Across independently-deployed services with their own release cycles, that is unacceptable.

**So the question changes.** Not "how do I make this atomic" but **"what intermediate states are acceptable, and how do I get out of each one?"** That reframing is the whole answer, and accepting it is the hard part.

**The pattern: a saga.** A sequence of local transactions, each with a compensating action.

\`\`\`
1. Reserve inventory        → compensate: release the reservation
2. Charge payment          → compensate: refund
3. Confirm the order       → (terminal; no compensation needed)
\`\`\`

Each step is a local transaction with its own outbox, so each step is individually reliable. The saga sequences them and compensates backwards on failure.

**Two ways to run it.**

**Orchestration.** A coordinator service holds the saga state and calls each step. The flow is in one place and readable, and the coordinator is a component to run and make durable — usually a workflow engine, because rolling your own durable state machine is more work than it looks.

**Choreography.** Each service reacts to the previous one's event. No coordinator, and the flow exists nowhere — understanding it means reading every service. **I would orchestrate**, because a saga's value is that its failure paths are explicit, and choreography scatters them.

**What the saga costs, honestly.**

**Intermediate states are observable.** Inventory reserved and payment not yet charged is a real state a customer can see. The interface must show "confirming your order" rather than pretending atomicity.

**Compensations are not rollbacks.** A refund is not the inverse of a charge — the customer saw a charge and then a refund, and their bank may take days. Some effects have no compensation at all: a sent email, a dispatched vehicle.

**Ordering the steps matters enormously.** Put the **most likely to fail** and the **cheapest to compensate** first. Reserve inventory before charging: a failed charge releases a reservation, which is invisible. Charging before reserving means a successful charge with no stock, requiring a refund — expensive and visible.

**Compensations can themselves fail.** A refund call can fail. So compensations need the same reliability machinery as forward steps — an outbox row, retries, and an alert when they exhaust. **A saga with unreliable compensation is worse than no saga**, because it leaves state that nothing will clean up.

**The alternative worth considering: do not span the services.** If reserving inventory and charging payment must be atomic, that is evidence the boundary is wrong. Options:

- **Put both in one service and one transaction.** Sometimes the right answer, and sometimes it is the answer people refuse to consider because the services already exist.
- **Weaken the requirement.** Reserve inventory optimistically, charge, and if stock turns out to be unavailable, cancel and refund with an apology. Many businesses already work this way, and it converts a distributed-transaction problem into a business process — which is the cheapest correct answer when it is acceptable.

**What I would actually do.** Ask whether the atomicity requirement is real. Overselling that is resolved with an apology and a refund is far cheaper than a saga. If it is real, an orchestrated saga with reliable compensation, steps ordered cheapest-compensation-first, and explicit intermediate states in the interface.

**The transferable point.** The outbox removes the dual write between a database and everything else. It does not remove the need for a **workflow** when the operation spans authoritative writes. Those are different problems, and using the outbox to make each step reliable is what makes the saga viable — the two patterns compose rather than compete.`,
    },
    {
      id: 'al-ob-2',
      kind: 'debug',
      prompt:
        'An outbox-based system publishes order events. About 0.3% of orders have no corresponding event in the broker, discovered by a reconciliation query comparing orders to events. The outbox table shows no unpublished rows and no rows with retry failures. Hypotheses?',
      discussion: `Orders with no event, and the outbox shows nothing outstanding. That combination is the interesting part: the outbox believes it published everything, and the broker disagrees. So either the outbox row never existed, or the relay marked it published without the broker accepting it.

**Hypothesis 1 — a code path that writes orders without writing an outbox row.** The most likely. If there are several ways to create an order — the main API, a bulk import, an admin tool, a data migration, a retry path — one of them may not insert the outbox row. 0.3% is a plausible share for a secondary path.

*Why it fits:* the outbox has no unpublished rows because the row was never created. Nothing anywhere records that an event was owed.

*Check:* take the affected order ids and look for **any** outbox row for them, published or not. If there is none, this is it. Then find what created those orders — a \`created_by\` or \`source\` column, or correlate their timestamps with batch-job runs.

**Hypothesis 2 — the relay marks rows published before confirming the broker accepted them.** If the relay does \`publish(); markPublished()\` and the publish is fire-and-forget — a producer that returns before the broker acknowledges, or an error that is caught and ignored — rows are marked published without the event existing.

*Why it fits:* explains "no unpublished rows" exactly, and 0.3% matches an intermittent broker or network failure rate.

*Check:* whether the relay awaits the broker acknowledgement before updating the row, and whether any publish error path leads to \`markPublished\`. **A \`markPublished\` in a \`finally\` block is the same bug as the offset-commit-in-\`finally\` from the delivery-semantics lesson**, and it is worth looking for specifically.

**Hypothesis 3 — the outbox insert is in a different transaction from the order.** If the code does \`insertOrder()\` then \`insertOutbox()\` as separate transactions, this is the dual-write problem reproduced *inside* the pattern meant to fix it. A crash or error between them loses the event.

*Why it fits:* the failure would be rare — only when something interrupts between the two commits — which matches 0.3%.

*Check:* read the transaction boundaries. This is a code-reading check and it is embarrassing to find, which is exactly why it should be checked early.

**Hypothesis 4 — the events were published and later removed by broker retention.** If the reconciliation query looks for events in the broker and retention is shorter than the reconciliation window, older orders legitimately have no event any more.

*Why it fits:* the affected orders would cluster at the **old** end of the range.

*Check:* the age distribution of affected orders against the topic's retention. If they are all older than retention, the reconciliation query is wrong rather than the system.

**Hypothesis 5 — a cleanup job deleted unpublished rows.** If the cleanup deletes by age rather than by \`published_at IS NOT NULL\`, it can remove rows the relay never got to — during a relay outage, for instance.

*Check:* the cleanup query's predicate. \`DELETE FROM outbox WHERE created_at < …\` with no published check is a silent data-loss bug, and it would explain both symptoms perfectly.

**What I would check first: whether any outbox row exists for the affected orders.** One query, and it splits the hypothesis space cleanly. A row present means the failure is in the relay or the cleanup (2 or 5); a row absent means it is in the write path (1 or 3) — or the reconciliation query is wrong (4).

**Then, depending:** if rows are absent, correlate the affected orders' creation with code paths and batch jobs. If rows are present and marked published, read the relay's error handling.

**The structural fixes, and the last one is the important one.**

**Make the outbox insert unavoidable.** A database trigger on \`orders\` that inserts the outbox row means no code path can skip it — at the cost of moving event construction into the database, which is awkward for a rich payload. A middle option: a single repository function that is the only way to create an order, enforced by review and by making the table not directly writable from other paths.

**Confirm the broker acknowledgement before marking published**, and never mark published on an error path.

**Fix the cleanup predicate** to require \`published_at IS NOT NULL\`.

**Keep the reconciliation query, and alert on it.** It found a bug that no pipeline metric detected — the outbox looked healthy, the relay looked healthy, and 0.3% of events were missing. **This is the same conclusion as the messaging lesson's debugging exercise: instrument the outcome, not the mechanism.** A count of orders in the last hour against events published for those orders catches every hypothesis above, and it is the only check that does.

**Transferable:** a pattern adopted to fix a problem can reproduce it if implemented carelessly — a two-transaction outbox is a dual write, and a relay that marks published without confirmation is a fire-and-forget publish. **The pattern's correctness depends on two specific properties: same-transaction insert, and mark-after-acknowledgement.** Verifying those two explicitly, rather than trusting that "we use the outbox pattern", is what makes the guarantee real.`,
    },
  ],

  revision: {
    bullets: [
      'The dual-write problem: two systems, no shared transaction, so a crash between them leaves silent permanent divergence.',
      'Retrying does not fix it — the retry can fail and the process can die first. Reordering only changes which failure you get.',
      'The outbox: write the event to the same database in the same transaction as the business change.',
      'What is atomic is the event\'s *existence*, not its publication. Publishing is a separate at-least-once step.',
      'The relay can publish and crash before marking the row, so consumers must deduplicate on a stable event id.',
      'The outbox is the mechanism for recording intent to do *anything* outside the database, not just to publish events.',
      'Partition the relay by aggregate id for per-aggregate ordering with parallelism; a serial relay gives global order slowly.',
      'Ordering must hold end to end: relay partitioning, broker key, and a consumer that does not process batches concurrently.',
      'CDC reads the database\'s own transaction log, so there is no second write to be inconsistent.',
      'The real difference is schema ownership: with an outbox you author the event; with CDC the table shape is the contract.',
      '"No application changes" is the cost, not the benefit — a column rename breaks consumers you cannot enumerate.',
      'CDC captures out-of-band changes an outbox misses: migrations, admin edits, direct writes.',
      'A stopped CDC consumer retains write-ahead log and can fill the database\'s disk.',
      'CDC on the outbox table is often best: the outbox\'s ownership with CDC\'s low-latency delivery and no polling.',
      'An index driven from the event stream becomes rebuildable by resetting an offset.',
      'Events decouple availability and deployment, not semantics. Publish named facts, not row diffs.',
      'Event sourcing makes the log the source of truth — every query needs a projection and old formats stay readable forever.',
      'An outbox\'s correctness rests on two properties: same-transaction insert, and mark-published only after acknowledgement.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Patterns for reliably telling other systems about a database change: the transactional outbox, which records the event in the same transaction, and change data capture, which reads the database\'s transaction log.',
    whyItExists:
      'Because writing to a database and publishing an event are two systems with no shared transaction, so any crash between them leaves permanent, silent disagreement that no retry logic can prevent.',
    whenToUse: [
      'An outbox whenever the application can be changed and you want to own the event schema.',
      'CDC when the application cannot be changed, or for analytical consumers who want the table shape.',
      'CDC on the outbox table when both are available — ownership plus low-latency delivery.',
      'A saga on top, when a workflow spans authoritative writes in separate databases.',
    ],
    whenNotToUse: [
      'When the operation should be synchronous and the caller needs the result.',
      'When both effects are in one database — that is one transaction, not an event.',
      'CDC for domain events between services, where table shape as contract is a liability.',
      'Event sourcing, unless history is genuinely the domain.',
    ],
    alternatives: [
      'A database table as the queue, when there is one logical consumer and moderate volume.',
      'An append-only audit table plus an outbox, when the goal is an audit trail rather than event sourcing.',
      'Putting both writes in one service and one transaction, when the boundary was wrong.',
      'Accepting the inconsistency and reconciling as a business process.',
    ],
    tradeoffs: [
      'The outbox buys schema ownership and named domain facts, and costs a table, a relay and growth management.',
      'CDC buys zero application changes and costs your schema becoming a public contract.',
      'A serial relay buys global ordering and costs throughput.',
      'Deleting outbox rows on publish buys a small table and costs the published record.',
      'Event-driven architecture buys team independence and costs user-visible eventual consistency and distributed debugging.',
      'Event sourcing buys complete history and costs projections for all reads plus permanent format obligations.',
    ],
    failureModes: [
      'A crash between the business write and the publish, losing the event silently.',
      'A publish-then-write ordering producing phantom events consumers act on.',
      'An outbox insert in a different transaction from the business write — the dual write reproduced.',
      'A relay marking rows published before the broker acknowledged.',
      'A code path that creates the entity without writing an outbox row.',
      'A cleanup job deleting unpublished outbox rows because it filters only by age.',
      'Outbox table growth plus MVCC dead rows degrading disk, backups and vacuum while relay latency looks fine.',
      'A permanently-failing outbox row retried forever with no alert.',
      'A CDC replication slot retaining WAL and filling the database disk.',
      'A column rename breaking CDC consumers nobody could enumerate.',
      'Consumers inferring intent by diffing a status field, coupling them to internal states.',
    ],
    followUpQuestions: [
      'Where are your dual writes? List every place you write a database and then tell something else.',
      'Is the outbox insert in the same transaction as the business write? Verified how?',
      'Does the relay mark a row published only after the broker acknowledged?',
      'Is there any code path that creates the entity without an outbox row?',
      'What is your relay\'s ordering guarantee, and does it survive the broker and the consumer?',
      'Who owns the event schema, and is it reviewed like an API?',
      'What alerts on unpublished outbox rows and on the oldest unpublished row\'s age?',
      'For CDC: what alerts on replication-slot lag in bytes, and at what threshold?',
      'What reconciliation compares entities created against events published?',
    ],
  },
});
