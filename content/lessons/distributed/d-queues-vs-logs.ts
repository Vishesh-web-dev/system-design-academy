import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-queues-vs-logs',
  title: 'Message queues vs log-based brokers',
  summary:
    'A queue deletes a message once it is handled; a log keeps it for everyone. Retention and replay are the dividing line, and choosing wrongly shows up as either a lost message you cannot recover or a queue you cannot add a consumer to.',
  phase: 'distributed',
  module: 'messaging',
  position: 29,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['queues', 'log-brokers', 'retention', 'replay', 'consumer-groups'],
  prerequisites: ['d-gateways-discovery'],
  resources: [
    {
      key: 'kafka-design',
      tier: 'must',
      note: 'Read the sections on persistence, the partitioned log and consumer position. The design rationale — that a log with a consumer-held offset is simpler and faster than per-message tracking — is the whole distinction this lesson turns on.',
    },
    {
      key: 'rabbitmq-tutorials',
      tier: 'must',
      note: 'Work through work queues, publish/subscribe and routing. Seeing the exchange-and-binding model concretely is what makes the difference from a log obvious.',
    },
    {
      key: 'kafka-consumer-groups',
      tier: 'must',
      note: 'How partitions are assigned to consumers, and why the partition count caps consumer parallelism. Read it before sizing any topic — it is the decision you cannot easily undo.',
    },
    {
      key: 'aws-sqs-fifo',
      tier: 'good',
      note: 'A managed queue that offers ordering per message group. Read it for the cost of ordering in a queue model and for how throughput is bounded by group.',
    },
    {
      key: 'rabbitmq-quorum-queues',
      tier: 'good',
      note: 'Replicated queues built on consensus. Read it to see what durability costs in a queue broker, and why the older mirrored-queue approach was replaced.',
    },
    {
      key: 'kafka-original-paper',
      tier: 'advanced',
      note: 'The original motivation: log aggregation at volume where existing brokers could not keep up. Useful for understanding which constraints shaped the design.',
    },
  ],

  intuition: {
    body: `Both a queue and a log move messages from producers to consumers asynchronously. The difference is what happens to a message **after** it is consumed, and every other difference follows from it.

**A queue is a work distributor.** A message is put in, one consumer takes it, processes it, acknowledges it, and **the broker deletes it.** The queue's job is to make sure each unit of work is done once. Its natural question is *"has this been handled?"*, and the broker tracks that per message.

**A log is an ordered, retained sequence.** A message is appended and stays for a configured retention period — hours, days, or forever — regardless of who has read it. Consumers hold a **position** (an offset) and read forward. Its natural question is *"where has each consumer got to?"*, and the broker tracks a single number per consumer group rather than state per message.

That one design difference — per-message state versus a per-consumer offset — produces everything else:

**Adding a consumer.** In a queue, a second consumer *competes* for messages: each message goes to one of them. In a log, a second consumer group reads **the same messages independently**, from wherever it chooses to start. So a log supports "three teams each want every event" and a queue does not.

**Replay.** In a queue, a consumed message is gone. If your consumer had a bug and mangled a thousand messages, they are unrecoverable. In a log, you reset the offset and read them again. **This is the single most consequential practical difference**, and it is the one people wish they had thought about.

**Ordering.** A queue with several competing consumers has no meaningful order — that is the point of competing consumers. A log guarantees order **within a partition**, which is a real guarantee with a real constraint attached.

**Per-message operations.** A queue can nack one message, delay one message, route one message by attributes, and dead-letter one message. A log cannot: there is only an offset, so skipping a bad message means advancing past it, and you cannot retry one message without either blocking the partition or moving it elsewhere.

The framing to carry: **do consumers need the same messages, and might you need to read them again?** If yes to either, you want a log. If each message is a unit of work to be done once by one worker, with per-message retry and routing, you want a queue.

And the honest addition: **many systems need both**, and using one for the other's job is where the pain comes from.`,
    analogyLimit:
      '"Both are just message passing" is what leads teams to pick on familiarity and discover the mismatch a year later. The framing hides that a queue deletes on acknowledgement, so a consumer bug destroys data irrecoverably, and that a log has no per-message operations, so one poisonous message can block an entire partition. It also hides that a log\'s partition count caps consumer parallelism and is awkward to change — a sizing decision made on day one that constrains you afterwards.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team uses a queue for "order placed" events. One consumer sends confirmation emails. Six months later, three more teams want the same events: analytics, a fraud checker, and a warehouse system. A developer proposes adding three more consumers to the queue. What goes wrong, what are the fixes, and which would you choose?',
      answer: `**What goes wrong: competing consumers split the messages rather than each receiving all of them.**

In a queue, consumers on the same queue **compete**. With four consumers attached, each order event is delivered to exactly one of them. So roughly a quarter of orders get an email, a quarter get analysed, a quarter get fraud-checked, and a quarter reach the warehouse. Every consumer works perfectly and the system is comprehensively broken.

Worse, the failure is **silent and proportional**. Nothing errors. Emails still go out — just not for every order. The fraud checker still runs — on 25% of traffic. Somebody notices weeks later when a customer complains about a missing confirmation, and the investigation starts from the wrong end.

**The fixes, and what each costs.**

**Fix 1 — fan-out to four queues via an exchange.** Most queue brokers support publish/subscribe: the producer publishes to an exchange, which is bound to four queues, and each queue gets its own copy. Each team consumes its own queue independently.

*Cost:* four copies of every message stored. Each new consumer requires a broker configuration change, which is operational coupling — adding a team means changing shared infrastructure. And a consumer that falls behind grows its own queue without bound, which is at least isolated to that consumer.

*This works, and it is the right minimal change if the queue is already in production.*

**Fix 2 — move to a log with four consumer groups.** Each group reads the whole topic at its own pace with its own offset. One copy stored, and adding a consumer group requires **no producer or broker change at all** — the new team just starts reading.

*Cost:* a migration. And the log's constraints arrive with it: partition count caps parallelism, per-message retry is not available, and a poisonous message can block a partition.

**Fix 3 — a queue per consumer, with the producer publishing four times.** Explicitly wrong, and worth naming because people do it: the producer now knows about every consumer, so adding a fifth team means changing and deploying the producer. That is precisely the coupling asynchronous messaging exists to remove.

**Which I would choose: fix 2, the log — and the reason is a question the developer did not ask.**

Three of these four consumers want to **replay**. Analytics will want to recompute a metric over last month's orders when the definition changes. The fraud checker will want to re-run an improved model over historical orders. The warehouse system will want to reprocess a day it dropped during an outage.

**A queue cannot do any of that.** Once acknowledged, the message is gone. Every one of those requests becomes "can you extract it from the orders table and replay it manually", which is an ad-hoc script written under time pressure, each time.

So the deciding factor is not fan-out — fix 1 solves fan-out. It is that **"several teams want these events" is a strong predictor that "someone will need to re-read them" is coming**, and only one of the two architectures can answer that.

**The one thing that would change my answer.** If the consumers need genuine per-message semantics — this specific email failed, retry it in 5 minutes with backoff, dead-letter it after 5 attempts — a queue gives that natively and a log makes you build it. The pragmatic answer in that case is **both**: the log is the source of events, and a small consumer reads the log and feeds a queue for the work that needs per-message retry. That is a common and good architecture, not a compromise.

**The general lesson.** "Add another consumer" is the question that reveals which model you needed, and the queue-versus-log decision is usually made before anyone knows the answer. Asking *"will anything ever need to read these again?"* on day one is cheap; discovering it on day 400 is not.`,
    },
  body: `## The two models side by side

| | Queue | Log |
| --- | --- | --- |
| After consumption | Deleted | Retained for the retention period |
| Broker state | Per message (delivered? acked?) | One offset per consumer group |
| Second consumer | **Competes** for messages | Reads everything independently |
| Fan-out | An exchange bound to several queues | Native: another consumer group |
| Replay | Impossible | Reset the offset |
| Ordering | None with competing consumers | Guaranteed **within a partition** |
| Retry one message | Native: nack, delay, redeliver | Not available — only an offset |
| Dead-letter one message | Native | Must be built |
| Parallelism limit | Number of consumers | **Number of partitions** |
| Priority | Supported by some brokers | Not supported |
| Natural throughput | High | Very high — sequential appends and reads |

Three entries deserve elaboration because they are where the real constraints live.

**Parallelism is capped by partitions.** In a log, each partition is consumed by at most one consumer in a group. Ten partitions means at most ten parallel consumers; an eleventh sits idle. So partition count is a **capacity decision made when you create the topic**, and increasing it later breaks key-to-partition mapping — which means messages for a key that used to go to partition 3 now go to partition 7, and ordering across that boundary is lost. Choose generously up front.

**Ordering is per partition, which forces a keying decision.** A log guarantees order within a partition, and messages are assigned to partitions by a key. So "all events for order 42 in order" means keying by order id. That works, and it re-introduces the partitioning lesson's problem: a hot key is a hot partition, and one enormous key limits your throughput regardless of partition count.

**Per-message retry is the thing logs genuinely cannot do.** With only an offset, you cannot acknowledge message 5 while leaving message 4 pending. So a message that fails leaves three options: block the partition until it succeeds (head-of-line blocking, which halts everything behind it), skip it and lose it, or **copy it somewhere else** — a retry topic or a dead-letter topic — and advance. The third is the standard answer and it is machinery you build.

## Retention: the property that decides everything

**Queue retention is implicit and short.** A message exists until acknowledged. A well-functioning queue is nearly empty; a queue with depth is a symptom.

**Log retention is explicit and a design parameter.** Common choices:

- **Hours to days.** Enough to survive a consumer outage and to replay a recent mistake. The usual default.
- **Weeks to months.** Enough to onboard a new consumer over historical data, or re-run an improved model.
- **Forever, with compaction.** Keep only the latest message per key, so the log becomes a durable snapshot of current state that can be replayed from the beginning to rebuild any derived view. This is what turns a log into a source of truth rather than a transport.

Compaction is worth understanding as a distinct capability: a compacted topic keyed by entity id, retained forever, lets any new consumer rebuild the complete current state by reading from offset zero. That is the mechanism behind event-sourced projections and cache warming, and it is not available from a queue in any form.

The cost of retention is storage and, on a log, the fact that **your retention window is your replay window.** Three-day retention means a bug discovered on Thursday cannot be fixed by replaying Monday. Teams routinely discover this at the worst moment.

## Consumer groups and rebalancing

In a log, a **consumer group** is a set of consumers sharing the work of a topic: partitions are distributed among them, and the group holds one offset per partition.

**Rebalancing** happens when a consumer joins or leaves: partitions are reassigned. Two consequences that cause real incidents:

**A stop-the-world pause.** In the traditional protocol, all consumers stop, partitions are reassigned, and consumption resumes. On a large group this is seconds. A rolling deploy of twelve consumers triggers twelve rebalances, so a routine deploy can mean a minute of stalled consumption. Incremental and cooperative rebalancing protocols reduce this considerably and are worth enabling.

**A slow consumer triggers repeated rebalances.** If a consumer takes longer than the configured poll interval to process a batch, the group considers it dead and rebalances. The consumer then finishes, rejoins, and triggers another rebalance — a loop where the group spends its time rebalancing rather than consuming. The fix is either smaller batches or a longer poll interval, and diagnosing it requires knowing the symptom.

## Where each one is the wrong tool

**A queue is wrong when** several consumers need the same messages, when you might need to replay, when strict ordering matters, or when you want a durable record of what happened.

**A log is wrong when** you need per-message retry with backoff and dead-lettering, when you need priority, when consumers vastly outnumber partitions, or when you need to delay individual messages.

**Both are wrong when the operation should be synchronous.** If the caller needs the result to proceed, putting a queue in the middle adds latency and a state-tracking problem. Asynchrony is for work the caller does not need to wait for.

**Both are wrong as a database.** A log with infinite retention can *rebuild* state; it cannot answer "what is the current balance of account 42" without a consumer that maintains a queryable projection. A log is an excellent source of truth and a poor query interface.

## The combination that is usually right

At meaningful scale, the answer is often both:

**A log as the event backbone.** All domain events published once, retained for days or weeks, with any number of consumer groups. This is the durable record and the replay mechanism.

**Queues for work that needs per-message semantics.** A small consumer reads the log and enqueues work items — send this email, generate this PDF — into a queue where per-message retry, backoff, delay and dead-lettering are native.

This is not a compromise; it is using each for what it is good at. The log gives fan-out, ordering and replay; the queue gives per-message control. And the boundary between them is a natural place to put the transformation from "something happened" to "something must be done".`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'consumer-addition',
      title: 'Adding a consumer: the question that reveals which model you needed',
      caption:
        'Step through it. The top path is the silent failure — every consumer works and only a quarter of the work happens. The bottom path is why replay is the deciding factor rather than fan-out.',
      nodes: [
        { id: 'prod', label: 'Order service', kind: 'service', x: 0, y: 200, detail: 'Publishes "order placed". Ideally it knows nothing about who consumes — that decoupling is the whole point of asynchronous messaging.' },
        { id: 'q', label: 'Queue', kind: 'store', x: 190, y: 90, detail: 'Deletes each message once acknowledged. Broker tracks state per message: delivered, acked, redelivered, dead-lettered.' },
        { id: 'compete', label: '4 competing consumers', kind: 'note', x: 400, y: 40, detail: 'Each message goes to exactly ONE of them. Emails for 25% of orders, fraud checks on 25%. Nothing errors — the failure is silent and proportional.' },
        { id: 'fanout', label: 'Exchange → 4 queues', kind: 'note', x: 400, y: 140, detail: 'The correct queue-model fix. Four copies stored, and each new consumer needs a broker configuration change — operational coupling on shared infrastructure.' },
        { id: 'log', label: 'Log topic', kind: 'store', x: 190, y: 310, detail: 'Appends and retains for the configured period regardless of who has read. Broker tracks one offset per consumer group.' },
        { id: 'groups', label: '4 consumer groups', kind: 'note', x: 400, y: 260, detail: 'Each reads every message at its own pace from its own offset. Adding a fifth needs no producer change and no broker change — the new team just starts reading.' },
        { id: 'replay', label: 'Reset offset', kind: 'note', x: 400, y: 370, detail: 'Analytics recomputes last month. The fraud model re-runs over history. The warehouse reprocesses a dropped day. None of this is possible in a queue.' },
        { id: 'both', label: 'Log → queue for work', kind: 'service', x: 640, y: 310, detail: 'The usual real answer: the log is the event record; a small consumer feeds a queue for work needing per-message retry, backoff and dead-lettering. Not a compromise — each tool doing its job.' },
      ],
      edges: [
        { id: 'q1', source: 'prod', target: 'q', kind: 'write' },
        { id: 'q2', source: 'q', target: 'compete', kind: 'read' },
        { id: 'q3', source: 'q', target: 'fanout', kind: 'read' },
        { id: 'q4', source: 'prod', target: 'log', kind: 'write' },
        { id: 'q5', source: 'log', target: 'groups', kind: 'read' },
        { id: 'q6', source: 'log', target: 'replay', kind: 'read' },
        { id: 'q7', source: 'groups', target: 'both', kind: 'async' },
      ],
      steps: [
        {
          id: 'q-s1',
          title: 'Four consumers on one queue split the work',
          description:
            'Competing consumers is the queue\'s purpose, so each message reaches one consumer. Every consumer functions correctly and only a quarter of each job happens. Nothing errors, so nobody notices for weeks.',
          nodes: ['prod', 'q', 'compete'],
          edges: ['q1', 'q2'],
        },
        {
          id: 'q-s2',
          title: 'Fan-out fixes it, at a coupling cost',
          description:
            'An exchange bound to four queues gives each consumer its own copy. Correct, and every new consumer requires a change to shared broker configuration — so adding a team means an infrastructure change.',
          nodes: ['fanout'],
          edges: ['q3'],
        },
        {
          id: 'q-s3',
          title: 'A log gives fan-out with no configuration at all',
          description:
            'Each consumer group holds its own offset over one stored copy. A fifth team starts reading without touching the producer or the broker — the decoupling asynchronous messaging was supposed to provide.',
          nodes: ['log', 'groups'],
          edges: ['q4', 'q5'],
        },
        {
          id: 'q-s4',
          title: 'And replay is the actual deciding factor',
          description:
            '"Several teams want these events" strongly predicts "someone will need to read them again". A queue answers that with an ad-hoc extraction script written under pressure; a log answers it with an offset reset.',
          nodes: ['replay'],
          edges: ['q6'],
        },
        {
          id: 'q-s5',
          title: 'When you need both, use both',
          description:
            'Per-message retry, backoff and dead-lettering are native to a queue and absent from a log. A consumer that reads the log and enqueues work items gets both sets of properties.',
          nodes: ['both'],
          edges: ['q7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'poison-message',
      title: 'One bad message, two very different outcomes',
      caption:
        'The mirror image of the previous diagram. Here the queue wins outright, and the log needs machinery you have to build — which is why "which is better" has no answer.',
      code: `flowchart TB
    M["Message 4 fails to process<br/>(malformed payload)"]

    M --> QQ["**Queue**"]
    M --> LL["**Log**"]

    QQ --> Q1["nack message 4"] --> Q2["Broker redelivers with<br/>backoff, then dead-letters<br/>after N attempts"] --> Q3["Messages 5, 6, 7<br/>continue normally.<br/>**Native behaviour**"]

    LL --> L1["Only an offset exists —<br/>cannot ack 5 while<br/>leaving 4 pending"]
    L1 --> L2["Option A: block the partition<br/>until 4 succeeds"] --> L2b["Head-of-line blocking.<br/>Everything behind it stops"]
    L1 --> L3["Option B: skip and advance"] --> L3b["Message lost silently"]
    L1 --> L4["Option C: copy to a<br/>retry topic, then advance"] --> L4b["Correct — and it is<br/>machinery you build,<br/>including ordering caveats"]

    style Q3 fill:#17272a,stroke:#35897e
    style L2b fill:#2a1a1a,stroke:#a04848
    style L3b fill:#2a1a1a,stroke:#a04848
    style L4b fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: ['linkedin'],
    body: `Kafka's origin is instructive because the design was shaped by constraints that explain why it is a log rather than a queue, and those constraints are legible in the result.

**The problem.** LinkedIn needed to move very large volumes of activity data — page views, clicks, operational metrics — from many producers to many consumers. Several teams wanted the same data for different purposes: monitoring, analytics, search indexing, recommendation training.

**Why existing brokers did not fit.** They tracked state per message so a consumer could acknowledge individually, which is exactly right for work distribution and expensive at this volume: per-message bookkeeping, random-access storage patterns, and no cheap way to give five teams the same feed.

**The design choices that followed, and what each bought.**

**A partitioned, append-only log per topic.** Writes are sequential appends and reads are sequential scans, which is the access pattern storage hardware is best at. The throughput advantage is substantially about avoiding random access, not about being in memory.

**The consumer holds the offset, not the broker.** This is the pivotal decision. Broker state per consumer group collapses from per-message tracking to a single number per partition. Fan-out becomes nearly free — another group is another number — and replay becomes trivial, because rewinding is assigning a smaller number.

**Retention decoupled from consumption.** Messages persist for a configured period whether or not anyone read them. So a consumer can be down for hours and catch up, a new consumer can start from the beginning, and a buggy consumer's output can be recomputed.

**What was given up, deliberately.** Per-message acknowledgement, and with it per-message retry, delay, priority and dead-lettering. These are absent by design, not by oversight — they are the cost of the offset model.

**The transferable lessons.**

**The state model determines the capabilities.** Per-message state buys per-message operations; a per-consumer offset buys fan-out and replay. You cannot have both cheaply, and knowing which one you are buying is the decision.

**Sequential access is the throughput story.** A log broker outperforms a queue broker at volume largely because appending and scanning beat random access, which is a property of the data structure rather than of the implementation.

**Where the model does not transfer.** Kafka's design assumes consumers that read forward in bulk and tolerate batch-level rather than message-level error handling. A system whose defining need is "retry this one email in five minutes, then give up after three tries" is asking for the state model Kafka deliberately discarded — and the right answer there is a queue, or a log feeding a queue.`,
  },

  tradeoffs: {
    intro:
      'The choice is a state model, and every capability follows from it. Rows include the hybrid, which is the common real answer.',
    rows: [
      {
        option: 'Queue with competing consumers',
        whenItWins:
          'Work distribution: each item done once by one worker, with native per-message retry, backoff, delay, priority and dead-lettering.',
        whenItLoses:
          'When several consumers need the same messages, when replay may be needed, or when order matters.',
        cost:
          'Messages are gone once acknowledged, so a consumer bug destroys data irrecoverably.',
      },
      {
        option: 'Queue with exchange fan-out',
        whenItWins:
          'Several consumers each needing every message, while keeping per-message retry semantics per consumer.',
        whenItLoses:
          'When adding consumers frequently, since each needs a shared-broker configuration change.',
        cost:
          'One stored copy per consumer, operational coupling on the broker, and still no replay.',
      },
      {
        option: 'Log with consumer groups',
        whenItWins:
          'Several independent consumers, replay, ordering within a key, and very high throughput. Adding a consumer group requires no change anywhere else.',
        whenItLoses:
          'When you need per-message retry or priority, or when consumers must outnumber partitions.',
        cost:
          'Partition count caps parallelism and is awkward to change; per-message error handling must be built.',
      },
      {
        option: 'Log with compaction, retained forever',
        whenItWins:
          'When the log should be the source of truth: keyed by entity, it lets any consumer rebuild complete current state from offset zero.',
        whenItLoses:
          'When the data is not naturally keyed, or when full history has a retention or privacy constraint.',
        cost:
          'Unbounded storage growth, compaction overhead, and a deletion problem when a record must be erased.',
      },
      {
        option: 'Log feeding a queue',
        whenItWins:
          'The common real answer: the log is the durable record with fan-out and replay; the queue handles work needing per-message retry, backoff and dead-lettering.',
        whenItLoses:
          'At small scale, where two brokers is more operational surface than the problem justifies.',
        cost:
          'Two systems to operate, and a bridging consumer to maintain.',
      },
      {
        option: 'Synchronous call, no broker',
        whenItWins:
          'When the caller needs the result to proceed. A broker adds latency and a state-tracking problem for nothing.',
        whenItLoses:
          'When the work is slow, unreliable, or of no interest to the caller — then it couples availability unnecessarily.',
        cost:
          'The caller\'s availability becomes the product of every callee\'s.',
      },
      {
        option: 'A database table as a queue',
        whenItWins:
          'Low volume, and when the enqueue must be transactional with a business write — which removes the dual-write problem entirely.',
        whenItLoses:
          'At volume, where polling and row-level contention on the claim become the bottleneck.',
        cost:
          'Polling load, careful atomic claiming, and manual retry and dead-letter logic.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We will use Kafka because it is the standard for messaging."',
      whyWeak:
        'It names a product rather than a requirement. If the need is "send this email, retry with backoff, give up after three attempts, and dead-letter it", a log makes you build all of that, because it has only an offset and cannot acknowledge one message while leaving another pending.',
      strongAnswer:
        '"I would decide from two questions: do several consumers need the same messages, and might anything need to read them again? Yes to either means a log. If instead each message is a unit of work needing per-message retry and dead-lettering, that is a queue. And if I need both — which is common — the log is the event record and a small consumer feeds a queue for the work items."',
    },
    {
      weakAnswer: '"We need another consumer for these events, so we will attach it to the queue."',
      whyWeak:
        'Consumers on one queue compete, so each message goes to exactly one of them. With four consumers, each does a quarter of the work. Nothing errors — the failure is silent and proportional, and it typically surfaces weeks later through a customer complaint.',
      strongAnswer:
        '"Competing consumers would split the messages, so each consumer would handle a quarter of them with no error anywhere. I would either fan out through an exchange to one queue per consumer, or move to a log where each consumer group reads everything independently. And the fact that several teams want these events strongly suggests someone will want to replay them, which only a log can do."',
    },
    {
      weakAnswer: '"Retention is three days, which is plenty — consumers are never down that long."',
      whyWeak:
        'Retention is not a consumer-outage budget, it is a **replay window**. Three-day retention means a bug discovered on Thursday cannot be fixed by reprocessing Monday. And that is exactly when you need retention, because the discovery is usually days after the cause.',
      strongAnswer:
        '"Retention is the replay window, not a downtime budget. I would set it from \'how long might it take to notice a consumer bug and want to reprocess?\' — which is realistically a week or more. For anything that is a source of truth I would use a compacted topic retained indefinitely, so any consumer can rebuild complete state from the beginning."',
    },
    {
      weakAnswer: '"We have ten partitions, so we can scale to as many consumers as we need."',
      whyWeak:
        'Each partition is consumed by at most one consumer in a group, so ten partitions caps a group at ten consumers — an eleventh sits idle. And increasing the partition count later changes key-to-partition mapping, so a key\'s messages move partitions and ordering across that boundary is lost.',
      strongAnswer:
        '"Ten partitions caps a consumer group at ten consumers. Partition count is a capacity decision made at topic creation, and raising it later remaps keys to partitions, which breaks per-key ordering across the change. So I would over-provision partitions up front — the cost of extra partitions is small and the cost of changing later is not."',
    },
    {
      weakAnswer: '"If a message fails to process, we skip it and log the error."',
      whyWeak:
        'That is silent data loss, and the log line will not be read. In a log the alternatives are worse than they look: blocking the partition halts everything behind it, and skipping loses the message with no record of what was lost.',
      strongAnswer:
        '"In a log I would copy the failed message to a retry topic and advance the offset, so the partition keeps flowing and nothing is lost. A separate consumer handles the retry topic with backoff and eventually a dead-letter topic. In a queue this is native — nack, redeliver with backoff, dead-letter after N attempts — which is a strong reason to have a queue for work that fails per message."',
    },
    {
      weakAnswer: '"Our consumers are slow, so we increased the batch size."',
      whyWeak:
        'A batch taking longer than the poll interval makes the group consider the consumer dead and rebalance. The consumer then finishes, rejoins, and triggers another rebalance — a loop where the group spends its time rebalancing rather than consuming. Larger batches make it worse.',
      strongAnswer:
        '"Larger batches risk exceeding the poll interval, which makes the group treat the consumer as dead and rebalance — and the consumer then rejoins and triggers another, so throughput collapses into a rebalance loop. I would either reduce batch size or raise the poll interval to comfortably exceed worst-case batch processing time, and I would enable cooperative rebalancing so a deploy does not stop the whole group."',
    },
  ],

  flashcards: [
    {
      id: 'fc-ql-1',
      front: 'What is the one design difference between a queue and a log?',
      back: 'What happens after consumption. A queue deletes the message; a log retains it for the retention period. Every other difference follows.',
      topic: 'queues',
    },
    {
      id: 'fc-ql-2',
      front: 'What state does each broker track?',
      back: 'A queue tracks state per message (delivered, acked, redelivered). A log tracks one offset per consumer group per partition.',
      topic: 'log-brokers',
    },
    {
      id: 'fc-ql-3',
      front: 'What happens when you add a consumer to a queue?',
      back: 'It competes — each message goes to one consumer. Four consumers each handle a quarter, with no error anywhere. Silent and proportional failure.',
      topic: 'consumer-groups',
    },
    {
      id: 'fc-ql-4',
      front: 'How does fan-out work in each model?',
      back: 'A queue needs an exchange bound to one queue per consumer, with a broker config change per consumer. A log needs another consumer group and no change anywhere.',
      topic: 'consumer-groups',
    },
    {
      id: 'fc-ql-5',
      front: 'Why is replay the deciding factor between the models?',
      back: 'A queue deletes on acknowledgement, so a consumer bug destroys data irrecoverably. A log rewinds an offset. And several consumers wanting events predicts someone wanting to re-read them.',
      topic: 'replay',
    },
    {
      id: 'fc-ql-6',
      front: 'What caps consumer parallelism in a log?',
      back: 'Partition count — each partition is consumed by at most one consumer in a group. Ten partitions means at most ten consumers; an eleventh idles.',
      topic: 'log-brokers',
    },
    {
      id: 'fc-ql-7',
      front: 'Why is raising partition count later a problem?',
      back: 'It changes key-to-partition mapping, so a key\'s messages move partitions and per-key ordering across the change is lost. Over-provision up front.',
      topic: 'log-brokers',
    },
    {
      id: 'fc-ql-8',
      front: 'What ordering does a log guarantee, and what does that force?',
      back: 'Order within a partition. So "all events for order 42 in order" means keying by order id — which re-introduces hot keys as hot partitions.',
      topic: 'log-brokers',
    },
    {
      id: 'fc-ql-9',
      front: 'Why can a log not retry one message?',
      back: 'There is only an offset, so you cannot ack message 5 while leaving 4 pending. The options are block the partition, skip and lose it, or copy to a retry topic.',
      topic: 'replay',
    },
    {
      id: 'fc-ql-10',
      front: 'What is retention actually a budget for?',
      back: 'The replay window, not consumer downtime. Three days means a bug found on Thursday cannot be fixed by reprocessing Monday.',
      topic: 'retention',
    },
    {
      id: 'fc-ql-11',
      front: 'What does log compaction enable?',
      back: 'Keeping only the latest message per key, retained forever — so a new consumer can rebuild complete current state by reading from offset zero.',
      topic: 'retention',
    },
    {
      id: 'fc-ql-12',
      front: 'Why does a rebalance loop happen?',
      back: 'A batch taking longer than the poll interval makes the group treat the consumer as dead and rebalance; it finishes, rejoins, and triggers another. Larger batches make it worse.',
      topic: 'consumer-groups',
    },
    {
      id: 'fc-ql-13',
      front: 'What is the usual real answer at scale?',
      back: 'Both. A log as the event backbone for fan-out, ordering and replay, feeding queues for work that needs per-message retry, backoff and dead-lettering.',
      topic: 'queues',
    },
    {
      id: 'fc-ql-14',
      front: 'Why is a log a poor database?',
      back: 'It can rebuild state but cannot answer "what is the balance of account 42" without a consumer maintaining a queryable projection. Excellent source of truth, poor query interface.',
      topic: 'retention',
    },
  ],

  quiz: [
    {
      id: 'q-ql-1',
      kind: 'scenario',
      prompt:
        'A queue delivers "order placed" events to an email consumer. Three more teams attach their own consumers to the same queue. What happens?',
      options: [
        { id: 'a', label: 'The four consumers compete, so each handles roughly a quarter of the orders — with no error anywhere, so the failure is silent' },
        { id: 'b', label: 'Each consumer receives every message, since they are separate applications' },
        { id: 'c', label: 'The broker rejects the additional consumers' },
        { id: 'd', label: 'Messages are duplicated four times, once per consumer' },
      ],
      correct: ['a'],
      explanation:
        'Competing consumers is the queue model\'s purpose: each message goes to exactly one consumer. Every consumer works correctly and only a quarter of each job happens. Nothing errors, which is why this typically surfaces weeks later via a customer complaint rather than an alert.',
      difficulty: 'core',
      topic: 'consumer-groups',
    },
    {
      id: 'q-ql-2',
      kind: 'scenario',
      prompt:
        'A topic has 10 partitions. A team scales its consumer group to 16 instances to handle a backlog. What happens?',
      options: [
        { id: 'a', label: '10 consumers get one partition each and 6 sit idle — partition count caps group parallelism' },
        { id: 'b', label: 'Each consumer gets a share of every partition' },
        { id: 'c', label: 'The broker automatically increases the partition count' },
        { id: 'd', label: 'Throughput scales linearly to 16' },
      ],
      correct: ['a'],
      explanation:
        'A partition is consumed by at most one consumer in a group, so parallelism is bounded by partition count. Raising the count would help future throughput and would also remap keys to partitions, breaking per-key ordering across the change — which is why partitions should be over-provisioned at topic creation.',
      difficulty: 'core',
      topic: 'log-brokers',
    },
    {
      id: 'q-ql-3',
      kind: 'scenario',
      prompt:
        'A consumer reading a log hits a malformed message at offset 4 that always throws. What are the options and which is standard?',
      options: [
        { id: 'a', label: 'Block the partition, skip and lose it, or copy it to a retry topic and advance — the third is standard' },
        { id: 'b', label: 'Nack the message so the broker redelivers it with backoff' },
        { id: 'c', label: 'Acknowledge offset 5 while leaving 4 pending' },
        { id: 'd', label: 'Move the message to the end of the partition' },
      ],
      correct: ['a'],
      explanation:
        'A log tracks only an offset, so per-message acknowledgement and nacking are unavailable — options b and c describe queue capabilities. Copying the failed message to a retry topic and advancing keeps the partition flowing without losing data, and it is machinery you build rather than a broker feature.',
      difficulty: 'advanced',
      topic: 'replay',
    },
    {
      id: 'q-ql-4',
      kind: 'scenario',
      prompt:
        'A consumer bug corrupted the derived data for 200,000 messages processed over the last four days. Retention is 72 hours. What is possible?',
      options: [
        { id: 'a', label: 'Only the last 72 hours can be replayed; the earlier messages must be reconstructed from another source — retention is the replay window' },
        { id: 'b', label: 'All 200,000 can be replayed, since the offsets still exist' },
        { id: 'c', label: 'Nothing can be replayed once a consumer has committed offsets' },
        { id: 'd', label: 'The broker can extend retention retroactively' },
      ],
      correct: ['a'],
      explanation:
        'Retention determines how far back you can read, and messages older than it are deleted regardless of offsets. This is the concrete reason retention should be set from "how long might it take to notice a bug and want to reprocess", not from expected consumer downtime.',
      difficulty: 'core',
      topic: 'retention',
    },
    {
      id: 'q-ql-5',
      kind: 'scenario',
      prompt:
        'A consumer group\'s throughput collapses after batch size was increased to improve efficiency. Logs show frequent rebalances. What is happening?',
      options: [
        { id: 'a', label: 'Batches now exceed the poll interval, so the group treats consumers as dead and rebalances; they rejoin and trigger another — a rebalance loop' },
        { id: 'b', label: 'The larger batches exceed the broker\'s maximum message size' },
        { id: 'c', label: 'Partitions are being reassigned because the topic was resized' },
        { id: 'd', label: 'Consumers are running out of memory and restarting' },
      ],
      correct: ['a'],
      explanation:
        'If processing a batch takes longer than the poll interval, the group considers the consumer failed and rebalances. The consumer finishes, rejoins, and triggers another rebalance, so the group spends its time rebalancing. The fix is smaller batches or a longer poll interval, plus cooperative rebalancing.',
      difficulty: 'advanced',
      topic: 'consumer-groups',
    },
    {
      id: 'q-ql-6',
      kind: 'multi',
      prompt:
        'Which capabilities are native to a queue and absent from a log? Select all that apply.',
      options: [
        { id: 'a', label: 'Retrying a single message with backoff' },
        { id: 'b', label: 'Dead-lettering one message after N attempts' },
        { id: 'c', label: 'Message priority' },
        { id: 'd', label: 'Independent fan-out to several consumers with no configuration change' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three all require per-message state, which is exactly what a log gives up in exchange for a single offset. The fourth is the log\'s native strength — another consumer group is another number, requiring no producer or broker change.',
      difficulty: 'core',
      topic: 'queues',
    },
  ],

  exercises: [
    {
      id: 'ex-ql-1',
      kind: 'design',
      title: 'Pick the model per flow, then defend the retention',
      estimatedMinutes: 30,
      prompt: `Design the messaging for an e-commerce platform. For each flow: queue, log, both, or neither — with the reason, and the retention if a log.

1. "Order placed" — consumed by email, analytics, fraud, warehouse, and a recommendation trainer.
2. "Send order confirmation email" — must retry with backoff, give up after 5 attempts, and be visible when it fails.
3. "Inventory changed" — the search index and the storefront cache must both reflect it, in order per product.
4. Generating a monthly invoice PDF — takes 20 seconds, must happen exactly once per invoice.
5. Clickstream events — 200,000/second, consumed by analytics and an ML pipeline.
6. "Check whether this promo code is valid" — the checkout page needs the answer to proceed.
7. Payment webhook received from the processor — must be processed, and the processor retries if we return an error.

Then answer:

- Which flow's retention setting would you argue hardest about, and what number?
- A consumer has been down for 6 hours. What happens in each of your choices?
- Flow 3 requires per-product ordering. What is the key, and what breaks?
- Where does a poison message hurt most in your design, and what do you do?`,
      rubric: [
        'Flow 1: log with several consumer groups, retention justified by replay need.',
        'Flow 2: queue, justified by per-message retry and dead-lettering.',
        'Flow 3: log keyed by product id, with the hot-key consequence named.',
        'Flow 4: queue with idempotency, or a log feeding a queue; exactly-once addressed as idempotency.',
        'Flow 5: log, with partition count and volume addressed.',
        'Flow 6: synchronous, not messaging — identifies that the caller needs the result.',
        'Flow 7: acknowledges the webhook fast and enqueues, rather than processing inline.',
        'Retention argument names a concrete number with a reason tied to bug-discovery time.',
        'Six-hour outage answer distinguishes queue growth from log offset lag.',
        'Poison-message answer identifies the highest-impact location and the retry-topic mechanism.',
      ],
      modelAnswer: `**1. "Order placed" — LOG, five consumer groups, 30-day retention**

*Why a log:* five consumers each need every event. In a queue they would compete and each would get a fifth. Fan-out through an exchange would work and would require a broker configuration change for each new consumer — and with five consumers already, a sixth is coming.

*Why the retention matters most here:* three of the five will want replay. Analytics will recompute a metric when the definition changes. The fraud team will re-run an improved model over history. The recommendation trainer will retrain, which means reading a large historical window by design.

*Retention: 30 days.* Reasoning below in the retention question.

*Partitions:* keyed by \`order_id\` so all events for an order are ordered. 50 partitions — generous, because raising it later remaps keys.

**2. "Send order confirmation email" — QUEUE**

*Why a queue:* the requirement is a list of queue features. Retry with backoff, give up after 5 attempts, and be visible on failure — that is nack-with-backoff plus a dead-letter queue, native in a queue broker and machinery you build on a log.

*How it connects to flow 1:* a small consumer group on the order log enqueues an email work item per order. That is the log-feeds-queue pattern, and the boundary is exactly where "something happened" becomes "something must be done".

*Why not process emails directly from the log:* a permanently-failing email — an invalid address — would either block the partition or need a retry topic plus a backoff scheduler plus a dead-letter topic. I would be rebuilding a queue, worse.

*Dead-letter handling:* a dead-letter queue with an alert on depth, and a runbook. **A dead-letter queue nobody watches is the same as dropping the message**, so the alert is part of the design rather than an operational afterthought.

**3. "Inventory changed" — LOG, keyed by product_id, 7-day retention**

*Why a log:* two consumers need every event, and both are building derived views that may need rebuilding. If the search index mapping changes, replaying inventory events rebuilds it — which is worth more than it sounds, because index rebuilds otherwise require a bulk export from the database.

*Why ordered per product:* if "stock 5" and "stock 0" arrive out of order, the index shows 5 for a sold-out product. Keying by \`product_id\` puts all of one product's events in one partition, which is ordered.

*Retention 7 days rather than 30:* these events are a projection of database state, so the database is the fallback for a full rebuild. Retention needs to cover "notice the index is wrong and replay a few days", not "rebuild from scratch".

*Alternative worth mentioning:* a **compacted** topic keyed by product id, retained indefinitely. Then a new consumer rebuilds complete current inventory from offset zero with no database export. If index rebuilds are frequent this is clearly better, and the cost is storage plus the deletion problem when a product must be erased.

**4. Monthly invoice PDF, 20 seconds, exactly once — QUEUE, with idempotency**

*Why a queue:* a unit of work needing per-message retry. A 20-second job will occasionally time out or crash, and per-message redelivery is exactly right.

*"Exactly once" is the part to get right:* no broker delivers exactly once. This is at-least-once delivery plus idempotent processing. Concretely: the PDF is written to object storage at a deterministic key — \`invoices/{invoice_id}.pdf\` — and the job checks for the object before generating. A duplicate delivery finds the object and returns. The invoice record is updated with a conditional write on its version.

*A subtlety worth naming:* generating twice concurrently is wasteful but safe if the key is deterministic — the second write overwrites identical content. **Making the output address deterministic is what converts a hard delivery problem into a trivial one**, and it is available far more often than people use it.

*Visibility timeout:* must comfortably exceed 20 seconds — I would set 120 seconds. Too short and the message is redelivered while the first attempt is still running, producing exactly the concurrency the idempotency has to absorb.

**5. Clickstream, 200,000/s — LOG, 3-day retention, many partitions**

*Why a log:* the volume settles it. Sequential appends and reads are what a log broker is best at, and per-message acknowledgement at this rate would be the bottleneck. Two consumers need everything.

*Retention 3 days:* clickstream is high-volume and low-value per event. 200,000/s at even 200 bytes is around 3.5 TB a day, so retention is a direct storage cost. Three days covers a consumer outage and a short replay; longer history belongs in the data warehouse the analytics consumer writes to.

*Partitions: many — 200 or more.* At this rate the parallelism cap matters, and per-event ordering does not: clicks are independent. So I would key by session id for locality without a strict ordering requirement, or use no key at all for the flattest distribution.

*The one thing I would add:* clickstream should be on a **separate cluster** from order events. Its volume can saturate a broker, and I do not want a clickstream spike to delay order processing. Isolating by value is worth the extra cluster.

**6. "Is this promo code valid?" — NEITHER. Synchronous call.**

*Why:* the checkout page needs the answer to proceed. Putting a broker in the middle adds latency, requires the caller to poll or hold a connection for a response, and introduces a state-tracking problem for a question answerable in five milliseconds.

*The rule:* asynchrony is for work the caller does not need to wait for. This is not that.

*What I would add instead:* a timeout and a fallback. If the promo service is slow, checkout should proceed without the discount rather than hang — with the discount applied later if that is commercially acceptable. **The messaging question was the wrong question; the real one is what checkout does when the promo service is unavailable.**

**7. Payment webhook — QUEUE, and acknowledge the HTTP request immediately**

*The shape:* accept the webhook, validate the signature, write it to a durable queue, return 200. Then process asynchronously from the queue.

*Why acknowledge before processing:* the processor retries if we return an error, and its retry policy is not ours to control. If processing takes 3 seconds and occasionally fails, the processor retries and we get duplicates driven by our own slowness. Acknowledging fast decouples our processing from their retry policy.

*Why a queue rather than a log:* per-message retry for a webhook that fails to process, with a dead-letter queue for ones that never will. Payment webhooks are individually important — one is a payment — so per-message visibility matters more than fan-out.

*Idempotency is mandatory, not optional:* the processor will send duplicates, and we will occasionally process a queue message twice. Deduplicate on the processor's event id with a unique constraint, so a duplicate is a caught constraint violation rather than a double effect.

*The one thing I would add:* write the raw webhook payload to durable storage **before** acknowledging, keyed by event id, retained for months. Payment reconciliation disputes are answered by "here is exactly what you sent us and when", and the raw record is the only thing that answers them.

---

**Which retention would I argue hardest about, and what number?**

**Flow 1, order events. 30 days, and I would resist pressure to reduce it.**

The argument for a small number is storage cost. The argument for 30 days has three parts:

**Bug-discovery time is the real constraint.** A consumer bug producing subtly wrong derived data is typically noticed in days, not hours — someone questions a number, an investigation follows, and by the time replay is the answer, a week has passed. Retention shorter than realistic discovery time means the replay capability you paid for is unavailable exactly when needed.

**Onboarding a new consumer needs history.** The recommendation trainer wants a month of orders to train on. With 3-day retention, its first task is a bulk database export and a bespoke backfill path — a whole separate pipeline built because retention was set too low. **The retention setting determines whether onboarding a consumer is an afternoon or a project.**

**Order events are low-volume and high-value.** Unlike clickstream, orders are perhaps thousands per second at peak and each matters. 30 days of order events is a modest storage cost, and the asymmetry between that cost and the cost of an unavailable replay is large.

*What I would not do:* set it to "forever" on a non-compacted topic. Unbounded growth with no compaction eventually forces an emergency decision, and there is a data-deletion obligation to consider — a customer's right to erasure is hard to honour in an append-only log retained indefinitely. **If I wanted indefinite retention I would use compaction with keyed tombstones**, which makes deletion expressible.

**A consumer down for 6 hours — what happens in each?**

| Flow | Model | Effect |
| --- | --- | --- |
| 1. Orders | Log, 30 d | **Nothing bad.** Offset lags 6 hours; on restart it reads forward and catches up. Other consumer groups are entirely unaffected. |
| 2. Emails | Queue | **Queue depth grows for 6 hours.** Messages are retained (not consumed, not acked), so nothing is lost. On restart, a large backlog is delivered — and the throughput spike may hit the email provider's rate limit, so the consumer needs its own rate limiting. |
| 3. Inventory | Log, 7 d | Offset lags; the index is 6 hours stale, which is user-visible as wrong stock. Catches up on restart. |
| 4. Invoices | Queue | Depth grows; no loss. A 20-second job with a big backlog takes a long time to drain, so this needs consumer scaling. |
| 5. Clickstream | Log, 3 d | Offset lags. **6 hours at 200,000/s is 4.3 billion messages** — catching up requires far more throughput than steady state, so either it never catches up or it must scale out. Worth planning for explicitly. |
| 6. Promo | Sync | Not applicable — but the *promo service* being down for 6 hours means checkout needs its fallback, which is why I specified one. |
| 7. Webhooks | Queue | Depth grows. The HTTP endpoint still returns 200, so the processor does not retry — **which is why acknowledging before processing matters.** If we had processed inline, 6 hours of failures would have triggered the processor's retry storm on top of our own backlog. |

**The pattern worth extracting:** a log consumer being down costs *lag*, isolated to that consumer group. A queue consumer being down costs *depth*, and depth becomes a throughput spike on recovery. **Both need a plan for catch-up capacity**, and flow 5 shows that catch-up can be arithmetically impossible without scaling — 6 hours of backlog at steady-state throughput takes 6 hours to clear only if the incoming rate is zero, which it is not.

**Flow 3 ordering: what is the key and what breaks?**

*Key:* \`product_id\`. All events for a product land in one partition, which is ordered, so "stock 5" then "stock 0" cannot be observed in reverse.

*What breaks — three things:*

**A hot product is a hot partition.** A flash sale on one product sends all its events to one partition, and that partition's throughput becomes the bottleneck regardless of how many partitions exist. This is the partitioning lesson's hot-key problem in a broker.

**Consumer parallelism for that product is one.** Ordering per partition means one consumer per partition, so a single product's events cannot be processed in parallel. Under a flash sale, that consumer is the constraint.

**Raising the partition count breaks ordering across the change.** Product 88's events go to partition 12 today and partition 31 after a resize, so events for one product exist in two partitions with no ordering between them. Any replay spanning the change sees them out of order.

*Mitigations:*

- **Over-provision partitions** so a resize is not needed. Cheap insurance.
- **Make the consumer idempotent and order-insensitive where possible.** If the event carries the absolute stock level plus a version, the consumer can discard any event with a version lower than what it has already applied — **ordering then stops being a correctness requirement.** This is the strongest fix, because it removes the constraint rather than satisfying it.
- **For a known hot product**, a dedicated topic or partition. Operationally awkward and effective.

*The version-based fix deserves emphasis:* if the consumer can reject stale versions, the partition-key constraint relaxes and the hot-partition problem largely disappears. **Designing events to carry absolute state plus a version, rather than deltas, is what buys that** — and it is a design decision available at the start and expensive later.

**Where does a poison message hurt most, and what do I do?**

**Flow 3, inventory, keyed by product_id — this is the worst case in the design.**

A malformed inventory event in partition 12 blocks that partition. Every product whose id hashes to partition 12 stops updating: their stock levels freeze in the search index and the storefront cache. That is roughly 1/50th of the catalogue showing wrong stock, indefinitely, while the rest of the system looks perfectly healthy.

The failure is nasty for three reasons: it is **partial** (most products fine), **silent** (no error rate spike — the consumer is failing on one message repeatedly), and **user-visible** (customers order out-of-stock items).

*What I do:*

1. **A retry topic with a bounded attempt count.** The consumer tries a message N times; on exhaustion it copies the message to \`inventory-events-dlq\` with the error and advances the offset. The partition keeps flowing.
2. **Alert on the DLQ, not just on consumer errors.** A message in the DLQ means a product's state is now potentially wrong, so this alert needs a name and a runbook, not a dashboard tile.
3. **Alert on per-partition lag, not just group lag.** One stuck partition out of 50 barely moves aggregate lag — which is exactly why this failure runs for hours. **Per-partition lag is the metric that catches it**, and it is almost never configured.
4. **Make the DLQ replayable.** Once the bug is fixed, the DLQ messages must be reprocessable. That means the DLQ retains the original key and payload, and a tool exists to replay from it. A DLQ you cannot replay from is a graveyard.

*Compare the queue flows:* a poison message in the email queue is redelivered with backoff and dead-lettered after 5 attempts, and messages 5, 6 and 7 continue normally. **The blast radius is one message.** That contrast — one message versus a partition — is the clearest single argument for a queue where per-message failure is expected, and it is why I put emails on a queue rather than consuming the order log directly.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-ql-1',
      level: 'basic',
      question: 'What is the difference between a message queue and a log-based broker?',
      guidance:
        'A queue deletes on acknowledgement and tracks per-message state; a log retains and tracks a per-consumer offset. Look for the recognition that every other difference follows from that one.',
    },
    {
      id: 'iq-ql-2',
      level: 'basic',
      question: 'What happens if you add a second consumer to a queue?',
      guidance:
        'They compete — each message goes to one of them. A strong answer names the silence of the failure and reaches for exchange fan-out or a log with consumer groups.',
    },
    {
      id: 'iq-ql-3',
      level: 'intermediate',
      question: 'How would you decide between the two for a new event flow?',
      guidance:
        'Two questions: do several consumers need the same messages, and might anything need to read them again? A strong answer also names the queue-only capabilities — per-message retry, dead-lettering, priority — as the counterweight.',
    },
    {
      id: 'iq-ql-4',
      level: 'intermediate',
      question: 'What sets your log retention period?',
      guidance:
        'How long until a consumer bug is noticed and replay is wanted — realistically a week or more — plus whether a new consumer needs history. Look for retention framed as a replay window rather than a downtime budget.',
    },
    {
      id: 'iq-ql-5',
      level: 'advanced',
      question: 'A message in a log topic always fails to process. Walk me through the options.',
      guidance:
        'Block the partition, skip and lose it, or copy to a retry topic and advance. Excellent answers name per-partition lag as the metric that detects it and note the blast radius is a whole partition.',
    },
    {
      id: 'iq-ql-6',
      level: 'advanced',
      question: 'How do you choose a partition count and a partition key?',
      guidance:
        'The count caps consumer parallelism and is awkward to change, so over-provision. The key determines ordering and creates hot partitions. Excellent answers propose version-based idempotency to relax the ordering requirement entirely.',
    },
    {
      id: 'iq-ql-7',
      level: 'followup',
      question: 'You said a dead-letter queue. What makes that actually useful?',
      guidance:
        'An alert on its depth with a runbook, and the ability to replay from it once the bug is fixed. A DLQ nobody watches is equivalent to dropping the message, and one you cannot replay from is a graveyard.',
    },
    {
      id: 'iq-ql-8',
      level: 'followup',
      question: 'A consumer has been down for six hours. What is your recovery concern?',
      guidance:
        'Catch-up capacity. Clearing a backlog at steady-state throughput takes as long as the outage only if incoming traffic is zero. A strong answer notes it can be arithmetically impossible without scaling, and that recovery can overwhelm downstream dependencies.',
    },
  ],

  activeLearning: [
    {
      id: 'al-ql-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed a broker you run or rent. Now change one thing: use a database table as your queue — rows with a status column, workers claiming them. What genuinely improves, and where does it break?',
      discussion: `This is a real and underrated option, and the reflexive dismissal of it is usually wrong at small scale.

**What genuinely improves.**

**The dual-write problem disappears.** This is the big one. With a separate broker, writing a business record and publishing an event are two systems, so either can succeed while the other fails. With a table, the enqueue is **in the same transaction as the business write** — atomically, with no outbox pattern, no CDC, no reconciliation. That is a substantial correctness benefit and it is the reason the next lesson exists.

**No new infrastructure.** No broker to run, upgrade, monitor, secure or pay for. For a team of five, that is a real fraction of their operational capacity.

**Full queryability.** "How many jobs are pending, by type, older than an hour?" is a SQL query. On a broker it is a metrics dashboard that may not have the dimension you want. Debugging a stuck job means reading a row, not decoding a message from a broker's storage.

**Transactional side effects.** A worker can process the job and update the business record in one transaction, so a crash mid-processing rolls back both. That is genuinely hard with a broker, where the message acknowledgement and the database commit are separate.

**Arbitrary scheduling and priority.** \`WHERE run_after < now() ORDER BY priority DESC\` gives delayed jobs and priority for free — both of which are broker features you would otherwise be constrained by.

**Where it breaks.**

**Polling.** Workers ask "is there work?" repeatedly. At a one-second interval with twenty workers that is twenty queries a second doing nothing, forever. Notification mechanisms help, and the fallback poll must remain because notifications can be missed.

**Contention on the claim.** Several workers claiming simultaneously contend on the same rows. The atomic claim — \`UPDATE ... WHERE status = 'pending' ... RETURNING\`, or a select that skips locked rows — is essential and it is where naive implementations produce double-processing. This is the part most home-grown implementations get wrong.

**Table growth and dead rows.** Completed jobs accumulate, and in an MVCC store every status update leaves a dead version. A high-volume job table bloats and its index degrades, so vacuum and archival are ongoing operational work rather than a one-off.

**Throughput ceiling.** Thousands per second is fine; hundreds of thousands is not. Row locking, index maintenance and write amplification put a ceiling well below a purpose-built broker.

**No fan-out or replay.** Each job is a row processed once. Several consumers wanting the same events means either several tables or a status column per consumer, both of which get ugly fast.

**It shares fate with your database.** The queue's availability is the database's. Under database pressure, the queue stops — and the queue is often what you would use to shed load.

**When I would choose it.** Small to moderate volume — under a few thousand jobs per second — where the enqueue must be transactional with a business write, and where the team is small enough that not running a broker is a genuine benefit. **This describes a large fraction of real applications**, and reaching for a broker before this is a common over-engineering.

**When I would not.** High volume, fan-out to several consumers, replay, or when the queue must survive database problems.

**The migration path worth knowing.** A table queue and the **outbox pattern** are nearly the same shape: rows written transactionally, drained by a process. So starting with a table queue and later having a drainer publish to a broker is a natural evolution rather than a rewrite. **Starting with a table is therefore not a decision you are stuck with** — which is a strong argument for starting there.

**The transferable point.** "Use a queue" is often read as "run a broker", and those are different statements. The question is what properties you need: transactional enqueue points at a table, fan-out and replay point at a log, per-message retry at volume points at a broker queue. Reasoning from properties rather than from category names is what avoids running infrastructure you did not need.`,
    },
    {
      id: 'al-ql-2',
      kind: 'debug',
      prompt:
        'A log consumer group processing order events shows aggregate lag near zero, and a customer-support ticket says some orders never received a confirmation email. The affected orders have no pattern anyone can see — different times, different amounts, different regions. Hypotheses?',
      discussion: `Aggregate lag near zero with a subset of orders unprocessed is the important combination. Near-zero lag means the group is keeping up *overall*, so this is not a throughput problem. And "no pattern anyone can see" is itself the strongest clue — it suggests the pattern is in a dimension nobody has looked at.

**Hypothesis 1 — one partition is stuck and aggregate lag hides it.** If partition 12 of 50 is blocked on a poison message, its lag grows while the other 49 stay at zero. **Aggregate lag barely moves** — one partition out of 50 contributes 2% of the total, and a growing 2% against a noisy zero is invisible.

*Why "no pattern" fits perfectly:* the affected orders would all hash to the same partition, which means they share a partition key. If the key is \`order_id\`, the affected orders look completely random by time, amount and region — because partition membership correlates with none of those things.

*Check:* **lag per partition, not aggregate.** And take the affected order ids and compute their partition. If they all map to one partition, this is conclusive.

**Hypothesis 2 — a consumer instance is alive but silently failing.** If one consumer in the group throws on every message and the error is caught and logged without advancing the offset, its partitions stall. Or worse: it catches the error, logs it, and **commits the offset anyway** — in which case lag is genuinely zero and the messages are simply skipped.

*Why this fits:* the offset-committing variant explains near-zero lag exactly, with no stuck partition. Messages are consumed, dropped, and marked done.

*Check:* whether the consumer commits offsets in a \`finally\` block or after a caught exception. This is a code-reading check and it is the single most common cause of "consumed but not processed".

**Hypothesis 3 — the email send fails and the failure is swallowed.** The log consumer succeeds, enqueues to the email queue, and the *email* consumer fails. If the email consumer dead-letters without an alert, or catches and logs, the orders are processed from the log's perspective and no email is sent.

*Why it fits:* lag is zero because the log consumer did its job. The failure is one layer downstream.

*Check:* the dead-letter queue depth, and the ratio of email-send attempts to order events. If the DLQ has messages nobody is watching, this is it — and it is the failure mode I explicitly designed against in the exercise for exactly this reason.

**Hypothesis 4 — a rebalance dropped in-flight messages.** During a rebalance, a consumer may have fetched messages it has not processed when its partition is reassigned. If offsets were committed optimistically on fetch rather than after processing, those messages are lost. This produces small, random-looking losses clustered around deploys and scaling events.

*Why "no pattern" fits:* the pattern is in *time*, clustered at rebalances — but only if someone looks at the timestamps against the deploy log, which is not an obvious thing to check.

*Check:* correlate affected order timestamps with rebalance events and deploys. A cluster is unmistakable once you plot it.

**Hypothesis 5 — duplicate consumer groups, or a group id collision.** If two deployments accidentally share a consumer group id, they split the partitions — so half the orders go to a deployment that may be an old version, or in a staging environment that discards them.

*Check:* the consumer group's member list. Seeing members you did not expect is immediate and conclusive.

**What I would check first: lag per partition, and the partition of the affected order ids.** One query and one computation. It confirms or eliminates hypothesis 1, which is both the most likely and the one whose "no pattern" signature matches the report most precisely.

**Then: whether the consumer commits offsets after a caught exception** (hypothesis 2, a code read), and **the dead-letter queue depth** (hypothesis 3, one metric). Between them these three cover the realistic causes.

**What the evidence does *not* rule out that people assume it does.** Near-zero aggregate lag feels like proof the pipeline is healthy, and it is proof of nothing — it is compatible with a stuck partition, with silent skipping, and with a downstream failure. **Aggregate lag is one of the most misleading metrics in messaging**, because it averages away exactly the failures that matter.

**The monitoring changes this incident demands.**

**Per-partition lag with an alert.** The single highest-value change. A stuck partition is invisible in aggregate and obvious per partition.

**A reconciliation check, not just pipeline metrics.** Count orders created in the last hour against confirmation emails sent, and alert on the gap. **This is the only metric that would have caught every hypothesis above**, because it measures the outcome rather than the mechanism. Pipeline health metrics tell you the pipeline thinks it is fine; a reconciliation check tells you whether the work happened.

**An alert on dead-letter depth**, with a named owner.

**Transferable:** for any asynchronous pipeline, instrument the *outcome* and not only the *transport*. Every hypothesis here produces healthy transport metrics, and one end-to-end count comparison catches all of them. That check is usually five lines of SQL and it is the thing teams add after this incident rather than before it.`,
    },
  ],

  revision: {
    bullets: [
      'A queue deletes on acknowledgement; a log retains for the retention period. Everything else follows.',
      'A queue tracks per-message state; a log tracks one offset per consumer group per partition.',
      'Consumers on one queue compete — four consumers each handle a quarter, silently.',
      'Fan-out in a queue needs an exchange and a config change per consumer; in a log it needs nothing.',
      'Replay is the deciding factor: a queue\'s consumed messages are gone, a log\'s are an offset reset away.',
      'Several consumers wanting events strongly predicts someone wanting to re-read them.',
      'Partition count caps consumer-group parallelism, and raising it later remaps keys and breaks ordering.',
      'A log orders within a partition, so ordering forces a key — and a hot key becomes a hot partition.',
      'A log cannot retry one message: block the partition, lose it, or copy to a retry topic.',
      'Retention is a replay window, not a consumer-downtime budget.',
      'Compaction keyed by entity, retained forever, lets a new consumer rebuild full state from offset zero.',
      'Per-message retry, backoff, delay, dead-lettering and priority are native to a queue and absent from a log.',
      'A rebalance loop happens when batch processing exceeds the poll interval.',
      'The usual real answer is both: a log as the event backbone, feeding queues for work needing per-message control.',
      'Events carrying absolute state plus a version let consumers reject stale ones, removing the ordering constraint.',
      'A dead-letter queue with no alert is equivalent to dropping the message.',
      'Recovery from a backlog needs catch-up capacity — clearing it at steady-state throughput never converges.',
      'Aggregate lag hides a single stuck partition; alert on per-partition lag and on end-to-end outcome counts.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Two asynchronous messaging models: a queue, which deletes each message once a consumer acknowledges it, and a log, which retains an ordered sequence that consumers read at their own offsets.',
    whyItExists:
      'To decouple producers from consumers in time and availability — and the two models exist because per-message state buys per-message operations while a per-consumer offset buys fan-out and replay.',
    whenToUse: [
      'A queue when each message is a unit of work needing per-message retry, backoff, delay or dead-lettering.',
      'A log when several consumers need the same messages, when replay may be needed, or when ordering matters.',
      'A compacted log when it should be the source of truth for entity state.',
      'Both, with the log as the event record feeding queues for per-message work.',
    ],
    whenNotToUse: [
      'When the caller needs the result to proceed — that is a synchronous call.',
      'A log when you need per-message retry, priority, or more consumers than partitions.',
      'A queue when anything might need to read the messages again.',
      'Either as a query interface; a log rebuilds state but cannot answer questions about it.',
    ],
    alternatives: [
      'A database table as a queue, when the enqueue must be transactional with a business write and volume is moderate.',
      'A synchronous call with a timeout and a fallback, when the result is needed now.',
      'Change data capture, when the events are really a projection of database state.',
      'A managed queue with FIFO message groups, when ordering is needed per key at modest throughput.',
    ],
    tradeoffs: [
      'Per-message state buys retry and dead-lettering, and costs fan-out and replay.',
      'A per-consumer offset buys fan-out and replay, and costs all per-message operations.',
      'More partitions buy parallelism and cost ordering scope and broker overhead.',
      'Longer retention buys a wider replay window and costs storage plus a deletion obligation.',
      'A log feeding a queue buys both models\' strengths and costs two systems to operate.',
    ],
    failureModes: [
      'Competing consumers silently splitting messages when fan-out was intended.',
      'A poison message blocking a partition, freezing everything behind it.',
      'A stuck partition invisible in aggregate lag.',
      'A consumer committing offsets after a caught exception, skipping messages with zero lag.',
      'Retention shorter than bug-discovery time, so replay is unavailable when needed.',
      'Partition count capping parallelism, discovered when scaling out does nothing.',
      'A partition resize remapping keys and breaking per-key ordering across the change.',
      'A rebalance loop from batches exceeding the poll interval.',
      'A dead-letter queue nobody watches, equivalent to dropping messages.',
      'Recovery throughput insufficient to clear a backlog while traffic continues.',
      'A recovery backlog overwhelming a downstream rate-limited dependency.',
    ],
    followUpQuestions: [
      'Do several consumers need the same messages, and might anything read them again?',
      'What is your retention, and what bug-discovery time does it assume?',
      'How many partitions, and what happens when you need more?',
      'What is the partition key, and which key is hottest?',
      'What happens to a message that always fails to process?',
      'Do you alert on per-partition lag, or only aggregate?',
      'Do you have an end-to-end outcome count, not just transport metrics?',
      'Who watches the dead-letter queue, and can you replay from it?',
      'If a consumer is down for six hours, what clears the backlog?',
    ],
  },
});
