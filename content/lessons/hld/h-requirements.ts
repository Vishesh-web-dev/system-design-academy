import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-requirements',
  title: 'Requirements, scope, clarifying questions',
  summary:
    'A question is worth asking only if you can name the two designs its answers produce. This lesson is the mapping from requirement to architecture — and the technique for proceeding when the interviewer says "you decide".',
  phase: 'hld',
  module: 'method',
  position: 39,
  kind: 'method',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['requirements', 'scoping', 'non-functional', 'assumptions', 'trade-offs'],
  prerequisites: ['h-framework'],
  resources: [
    {
      key: 'google-sre-slo',
      tier: 'must',
      note: 'Read it to learn what a non-functional requirement looks like when stated properly. "Highly available" is not a requirement; a percentage over a window with a defined success criterion is.',
    },
    {
      key: 'google-api-design-guide',
      tier: 'must',
      note: 'Read the resource-and-method material. Naming the operations precisely is most of requirements work, and this shows what precise looks like.',
    },
    {
      key: 'ddia-book',
      tier: 'must',
      note: 'Read the opening chapter on reliability, scalability and maintainability. It is the clearest statement of why non-functional requirements have to be quantified before they mean anything.',
    },
    {
      key: 'google-sre-workbook-slo',
      tier: 'good',
      note: 'The practical companion: choosing an indicator that reflects user experience. Useful when you need to turn "it should be fast" into something a design can be checked against.',
    },
    {
      key: 'aws-well-architected-reliability',
      tier: 'good',
      note: 'Read the sections on workload requirements and on recovery objectives. RPO and RTO are the two non-functional requirements candidates most often omit entirely.',
    },
    {
      key: 'system-design-primer',
      tier: 'advanced',
      note: 'Skim several of its worked problems and note what each one assumes. The assumptions are usually implicit, and finding them is good practice for making yours explicit.',
    },
  ],

  intuition: {
    body: `The framework said step 2 is "ask the questions that change the architecture". This lesson is how you know which those are, and what to do when the answers do not come.

**The test for any question: can you name the two designs?**

Before asking, complete this sentence out loud in your head: *"If the answer is X I would build A; if it is Y I would build B."* If both halves are concrete and different, ask. If you cannot fill in A and B, the question does not change the architecture and it is costing you the deep dive.

Applied to real questions:

> *"Do we need to show who liked a post, or only the count?"*
> **X = who:** a row per like, 365 billion rows a year, partitioned. **Y = count only:** one counter per post. **A 1000× storage difference.** Ask it.

> *"Which cloud provider?"*
> **X = one provider, Y = another:** the same design. Do not ask.

That test is most of the skill. The rest is knowing the small set of dimensions that actually reshape systems.

**And the second idea: requirements come in two kinds and candidates collect only one.**

**Functional requirements** are what the system does — the operations. Candidates are good at these because they are what the prompt describes.

**Non-functional requirements** are the constraints on how well it does them: scale, latency, consistency, durability, availability. **These are what actually determine the architecture**, and they are almost never in the prompt. "Design Twitter" contains no non-functional requirement at all, so a candidate who does not ask for them is designing against the ones they imagined.

A non-functional requirement is only useful when **quantified**. "Highly available" is not a requirement — it is a sentiment. "99.9% of reads succeed within 200 ms" is a requirement, because a design can be checked against it.

**The third idea, and it is the one that separates confident answers from stalled ones: when the interviewer will not give you a number, state an assumption and proceed.**

> "You decide."
> "Then I will assume 500 million daily active users, each viewing 100 posts a day, giving roughly 600,000 reads per second at average and 1.7 million at peak. I will design for that and note where a different figure would change my approach."

**That is a complete answer to "you decide".** It is fast, it is checkable, it lets the interviewer correct you cheaply, and it demonstrates that you know which number matters. A candidate who waits for a specification that is not coming loses minutes and looks unable to proceed under ambiguity — which is the actual job.

The framing to carry: **name the two designs before asking, quantify every non-functional requirement, and convert every unanswered question into a stated assumption.**`,
    analogyLimit:
      'Treating requirements gathering as information collection is the error. You are not filling in a form — you are looking for the small number of facts that eliminate design options, and every question that eliminates nothing is time taken from the deep dive. The framing also hides that unanswered questions are not blockers: a stated assumption is a complete substitute for an answer, and treating ambiguity as something to resolve rather than something to bound is what stalls candidates.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate is asked to design a food-delivery order-tracking system. They ask: "Should we use Kubernetes?", "How many engineers are on the team?", "Do we need a mobile app and a web app?", "What database do you prefer?", and "Should the tracking update in real time?". Which of these were worth asking, and what should the five questions have been?',
      answer: `**Grading each question by whether you can name the two designs.**

**"Should we use Kubernetes?"** — **Worthless.** X = yes, Y = no, and the design is identical either way. This is a deployment preference, not an architecture. Asking it signals an inability to distinguish the two.

**"How many engineers are on the team?"** — **Worthless in an interview**, and genuinely relevant in real work. Team size affects how much complexity you can operate, but the interviewer wants the design reasoning, not a staffing-adjusted compromise. Save it for real life.

**"Do we need a mobile app and a web app?"** — **Nearly worthless.** Both are clients over HTTP or a WebSocket. It changes no server-side component. It becomes worth asking *only* if the answer implies something architectural — for instance if mobile means intermittent connectivity and offline queuing, which is a real design difference. **Ask the architectural version, not the surface version.**

**"What database do you prefer?"** — **Worthless, and actively bad.** It asks the interviewer to make your decision. The database follows from the access patterns and the scale, which are things you should be establishing.

**"Should the tracking update in real time?"** — **Genuinely valuable, and the only good question of the five.** X = real time: a persistent connection per active order, server push, connection ownership, and a fan-out problem. Y = polling every 10 seconds: a plain HTTP endpoint, a cache, and no connection state at all. **Two completely different systems**, and the candidate found it.

**Score: one useful question out of five**, and four minutes spent.

**What the five questions should have been.**

> **1. "How fresh must the courier's location be — seconds, or is 30 seconds acceptable?"**
> The sharper version of the one good question. Seconds means push over a persistent connection and location updates flowing continuously. Thirty seconds means the client polls, the location lives in a cache with a short TTL, and there is no connection state. **The distinction is push versus pull, which is the largest structural decision in this system.**

> **2. "How many concurrent active orders at peak, and how many location updates per courier per minute?"**
> This is the number that sizes everything. 10,000 concurrent orders with one update every 5 seconds is 2,000 writes/second — modest. 500,000 concurrent orders at the same rate is 100,000 writes/second, which forces a different storage decision and probably means location never touches a durable database on the hot path.

> **3. "Does the order's state history need to be durable and auditable, or only the current state?"**
> X = history: an append-only event log per order, and the current state is a projection. Y = current state only: one mutable row. **This determines whether the system is event-sourced or CRUD**, and it usually matters for a delivery business because disputes require knowing what happened when.

> **4. "Who can see an order's location — only the customer, or the courier and support too?"**
> An authorisation requirement, and it decides whether location data can be served from a shared cache keyed by order id or must be filtered per viewer. **The CDN lesson's conclusion: if the response depends on who is asking, it cannot be cached publicly.** It also determines whether a location endpoint can be a simple public-shaped read.

> **5. "What happens if a courier's phone loses signal for two minutes?"**
> A failure requirement disguised as a functional one. X = show the last known location with a timestamp: the design needs staleness metadata on every location and the client must render it. Y = show "location unavailable": simpler client, worse experience. **Asking a failure question during requirements is unusual and strong**, because it surfaces a state the design must represent rather than one discovered later.

**Two things to notice about the good list.**

**Every one names a structural consequence.** Push versus pull; the write rate that sizes storage; event log versus mutable row; cacheable versus per-viewer; a staleness field or not. None of them is a preference.

**Four of the five are non-functional.** Only the third is about what the system does; the rest are about freshness, scale, authorisation and failure. **That ratio is roughly right** — the prompt already told the candidate what the system does, and it told them nothing about the constraints that determine how to build it.

**The general lesson.** The candidate's four bad questions were all *answerable*, which is why they felt productive. Answerable is not the test. **The test is whether the answer eliminates a design option**, and a question whose answers lead to the same architecture has cost you a minute of the deep dive to learn nothing.`,
    },
  body: `## Functional requirements: name the operations precisely

Functional requirements are the operations. The discipline is precision, because vagueness here produces the wrong data model.

**Write them as verbs with actors and objects.** Not "users can manage posts" but:

\`\`\`
A user can create a post
A user can delete their own post
A user can edit their own post within 5 minutes of creation
A user can view any public post
A user can like and un-like a post
\`\`\`

Three things this precision buys:

**It surfaces the operations candidates forget.** Delete, edit, un-like, cancel, refund, revoke. **Every "create" implies a possible "delete", and the delete is usually the harder design.** A candidate who lists only creates and reads will have a data model that cannot express removal.

**It surfaces the authorisation model.** "Their own post" versus "any post" is a requirement that shapes the API and possibly the partition key.

**It surfaces constraints hidden in the verb.** "Edit within 5 minutes" is a business rule that must be enforced somewhere, and deciding where is a design decision.

**Then state what is explicitly out of scope.** This is a technique, not a formality:

> "I am going to treat authentication, the recommendation ranking model, and payments as out of scope — I will assume an authenticated user id arrives with each request. Tell me if any of those is actually the focus."

**This does three things at once:** it prevents the interviewer thinking you forgot them, it bounds the problem so you can finish, and it invites correction in ten seconds rather than twenty minutes. **Declaring scope is one of the highest-value sentences available in the first two minutes.**

## Non-functional requirements: the dimensions that reshape systems

These are what actually determine the architecture, and they are almost never in the prompt. Six dimensions cover nearly everything:

**Scale.** Users, requests per second, data volume, growth rate. And the read-to-write ratio, which is often the single most consequential number.

**Latency.** A budget per operation, at a percentile. "Reads under 200 ms at p99" is checkable; "fast" is not.

**Consistency.** Per operation, using the vocabulary from the consistency-models lesson: does this need linearizability, read-your-writes, or is eventual acceptable? **Asking this per operation rather than per system is what distinguishes a considered answer.**

**Durability.** What must never be lost, and what may be. RPO — how much data loss is acceptable in a failure — is a requirement candidates almost never ask for and which determines synchronous versus asynchronous replication.

**Availability.** A target with a window, and RTO — how long a recovery may take. Both from the availability lesson.

**Security and privacy.** Who may see what; whether data has a retention obligation or a deletion right. **A deletion right is an architectural requirement**, because it is hard in append-only logs and in caches.

Two rules for stating them:

**Quantify or discard.** An unquantified non-functional requirement cannot be designed against. If the interviewer will not quantify it, quantify it yourself as an assumption.

**State them per operation where they differ.** A payment and a view counter in the same system want opposite consistency and availability answers, and a single system-wide statement hides that.

## The question taxonomy: what each answer changes

The dimensions above, expressed as questions with their architectural consequences:

| Question | If one way | If the other |
| --- | --- | --- |
| Read-to-write ratio? | Read-heavy: caching, replicas, denormalisation, fan-out on write | Write-heavy: partitioning, append-only, fan-out on read |
| Absolute scale? | Small: one database, no cache, one service | Large: partitioning, caching, async everything |
| Exact or approximate? | Exact: coordination on the hot path | Approximate: sharded counters, edge caching |
| Who sees a change, how fast? | Global immediacy: linearizable reads | Own-writes only: session routing, cheap |
| Is there a hot entity? | Yes: bucketing, dedicated capacity, the deep dive | No: uniform partitioning works |
| Real time or polling? | Real time: persistent connections, connection ownership, push fan-out | Polling: plain HTTP, a cache, no connection state |
| History or current state? | History: append-only log plus projections | Current: one mutable row |
| Response depends on the viewer? | Yes: private, per-viewer, uncacheable publicly | No: shared cache, CDN |
| What may be lost? | Nothing: synchronous replication, latency cost | Seconds: async replication, an explicit RPO |
| Is the operation reversible? | No: idempotency keys, compensation, careful ordering | Yes: retry freely |
| Deletion right? | Yes: no infinite retention, cache purge paths, deletion propagation | No: append-only forever is available |

**The three that most often decide the whole design:** read-to-write ratio, whether there is a hot entity, and whether the response depends on the viewer. Ask those three on almost any prompt.

## The questions not to ask

They share a property: the answer leads to the same design.

**Technology preferences.** "Which database?" "Which cloud?" "Kubernetes?" These follow from the requirements; asking them delegates your decision.

**Team and organisation.** Team size, timeline, budget. Genuinely relevant in real work and not what the interview assesses.

**Client platforms, unless architectural.** "Mobile or web?" changes nothing. "Do clients need to work offline?" changes a great deal. **Ask the architectural version.**

**Anything answerable by an assumption.** "Should the ids be UUIDs?" Assume, state it, move on.

**Questions the prompt already answered.** Listening carefully is cheaper than asking.

**And a caution about volume.** Four to six good questions is right. Ten questions — even good ones — consumes the deep dive, and a candidate who asks fifteen reads as unable to proceed without complete information.

## When the interviewer will not answer

Three responses you will get, and what to do with each:

**"You decide."** State an assumption with a number and move. "I will assume 500 million daily active users and 100 views each, so roughly 600,000 reads per second average and 1.7 million peak. I will design for that." **Then use the number.** The assumption is worthless if the design does not depend on it.

**"What do you think?"** They are testing whether you know which answer is typical. Give a reasoned default: "For a social feed I would expect heavily read-skewed, perhaps 100:1, because a post is written once and read by every follower. I will assume that."

**"It depends what you want to focus on."** They are offering you the choice of deep dive. Take it, and pick the hardest part.

**The technique underneath all three: an assumption is a complete substitute for an answer**, provided it is stated explicitly, has a number, and is used. Candidates treat unanswered questions as blockers; they are not. They are opportunities to demonstrate that you know which value matters.

**Write assumptions where they are visible** — on the whiteboard, in the shared document — so the interviewer can correct one cheaply and you can point back to it when defending a decision.

## Estimating scope from the prompt

Prompts encode scale conventionally, and reading the convention saves a question:

**A named consumer product** — "design Twitter", "design Uber" — means the real thing's scale: hundreds of millions of users, and the interesting problems are at scale.

**"Design a system for X" without a name** usually means a moderate business scale unless stated, and it is worth confirming with an assumption rather than a question.

**"Design an internal tool for our support team"** means small: thousands of users. **And the correct answer is small** — the framework lesson's point that producing a small design confidently is harder than producing a large one.

**A prompt with a number in it** is telling you the number matters. "Design a system to handle 1 million concurrent WebSocket connections" is a prompt about connection management, and the number is the whole question.

## The requirement that changes everything, per system type

Worth having as recall, because it tells you what to ask first:

| System | The requirement that decides the design |
| --- | --- |
| Feed / timeline | Is there a celebrity? (fan-out on write vs read) |
| Chat / messaging | Delivery guarantee and ordering scope |
| Video / media | Live or on-demand (changes the entire pipeline) |
| Payments / ledger | Exactly-once and audit history |
| Search | Freshness requirement (indexing latency) |
| Rate limiter | Exact or approximate (central vs local) |
| Storage / file sync | Conflict resolution semantics |
| Booking / inventory | Whether overselling is acceptable |
| Notifications | Deduplication and quiet-hours rules |
| Analytics | Query latency versus ingestion volume |

## Where requirements work goes wrong

**Collecting functional requirements only.** The prompt gave you those. The non-functional ones determine the architecture and you must ask for them.

**Unquantified non-functional requirements.** "Scalable, available, low-latency" is three sentiments. Numbers or nothing.

**Asking without a consequence in mind.** The test exists to prevent this and is easy to skip under pressure.

**Treating an unanswered question as a blocker.** State an assumption; it is a complete substitute.

**Stating assumptions and then ignoring them.** Assuming 1.7 million reads per second and then proposing a relational read path is worse than not assuming.

**Never declaring what is out of scope.** The interviewer cannot tell whether you excluded authentication deliberately or forgot it, and one sentence resolves it.

**Asking too many questions.** Six good ones. Fifteen reads as an inability to proceed under ambiguity.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'question-test',
      title: 'The test: can you name the two designs?',
      caption:
        'Run every candidate question through this before asking. The left column is what the test rejects, and each rejected question costs a minute of the deep dive to learn nothing.',
      code: `flowchart TB
    Q["Candidate question"]
    Q --> T["Complete: 'if X I build A,<br/>if Y I build B'"]

    T -->|"Cannot fill in A and B"| N["**Do not ask**"]
    N --> N1["Which cloud provider?<br/>Which database do you prefer?<br/>Kubernetes?<br/>Team size?<br/>Mobile or web?"]
    N1 --> N2["Answerable ≠ useful.<br/>These feel productive and<br/>eliminate no design option"]

    T -->|"A and B are concrete<br/>and different"| Y["**Ask it**"]
    Y --> Y1["Read-to-write ratio?<br/>Exact or approximate?<br/>Hot entity?<br/>Real time or polling?<br/>Depends on the viewer?<br/>What may be lost?"]

    Y1 --> A["Interviewer answers"] --> U["Use the number in the design"]
    Y1 --> B["'You decide'"] --> S["**State an assumption<br/>with a number, and use it.**<br/>A complete substitute<br/>for an answer"]

    style N2 fill:#2a1a1a,stroke:#a04848
    style Y1 fill:#17272a,stroke:#35897e
    style S fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'requirement-to-design',
      title: 'Each requirement eliminating design options',
      caption:
        'Step through it. Every requirement removes possibilities, and by the end the architecture is largely determined — which is why requirements precede design rather than accompanying it.',
      nodes: [
        { id: 'prompt', label: '"Design order tracking"', kind: 'client', x: 0, y: 190, detail: 'The prompt gives the functional shape and none of the constraints. Every architecture is still available at this point.' },
        { id: 'fresh', label: 'Freshness: seconds', kind: 'service', x: 190, y: 60, detail: 'Eliminates polling. Requires a persistent connection per active order, server push, and connection ownership — the largest structural decision in this system.' },
        { id: 'scale', label: 'Scale: 500k concurrent', kind: 'service', x: 190, y: 160, detail: '100,000 location writes/second. Eliminates a durable database on the hot path; location lives in memory with periodic durable snapshots.' },
        { id: 'hist', label: 'History: auditable', kind: 'service', x: 190, y: 260, detail: 'Eliminates a single mutable row. Requires an append-only event log per order, with current state as a projection.' },
        { id: 'viewer', label: 'Per-viewer authorisation', kind: 'service', x: 190, y: 360, detail: 'Eliminates public CDN caching of the location endpoint. The response depends on who is asking, so it is private per the CDN lesson.' },
        { id: 'design', label: 'The design is now largely determined', kind: 'store', x: 470, y: 190, detail: 'WebSocket gateway with connection ownership · in-memory location store · append-only order event log · projection for current state · private, uncacheable reads.' },
        { id: 'assume', label: 'Unanswered → assumption', kind: 'note', x: 470, y: 360, detail: '"You decide" becomes "I assume 500k concurrent orders at one update per 5 seconds." Stated with a number, written down, and then used — otherwise it is worthless.' },
        { id: 'scope', label: 'Explicitly out of scope', kind: 'note', x: 470, y: 40, detail: 'Authentication, payments, courier dispatch. One sentence prevents the interviewer thinking you forgot them and invites correction in ten seconds.' },
      ],
      edges: [
        { id: 'r1', source: 'prompt', target: 'fresh', kind: 'control' },
        { id: 'r2', source: 'prompt', target: 'scale', kind: 'control' },
        { id: 'r3', source: 'prompt', target: 'hist', kind: 'control' },
        { id: 'r4', source: 'prompt', target: 'viewer', kind: 'control' },
        { id: 'r5', source: 'fresh', target: 'design', kind: 'sync' },
        { id: 'r6', source: 'scale', target: 'design', kind: 'sync' },
        { id: 'r7', source: 'hist', target: 'design', kind: 'sync' },
        { id: 'r8', source: 'viewer', target: 'design', kind: 'sync' },
        { id: 'r9', source: 'assume', target: 'design', kind: 'async' },
        { id: 'r10', source: 'scope', target: 'prompt', kind: 'control' },
      ],
      steps: [
        {
          id: 'rq1',
          title: 'The prompt constrains almost nothing',
          description:
            'It gives the operations and none of the non-functional requirements. Every architecture remains available, which is why designing now means choosing at random.',
          nodes: ['prompt'],
          edges: [],
        },
        {
          id: 'rq2',
          title: 'Declare what is out of scope first',
          description:
            'Authentication, payments, dispatch. One sentence bounds the problem so you can finish, and invites correction immediately rather than at minute twenty.',
          nodes: ['scope'],
          edges: ['r10'],
        },
        {
          id: 'rq3',
          title: 'Each requirement eliminates options',
          description:
            'Seconds of freshness removes polling. 100,000 writes/second removes a durable hot path. Auditable history removes a mutable row. Per-viewer authorisation removes public caching.',
          nodes: ['fresh', 'scale', 'hist', 'viewer'],
          edges: ['r1', 'r2', 'r3', 'r4'],
        },
        {
          id: 'rq4',
          title: 'And the architecture is now largely determined',
          description:
            'Four requirements produced a connection gateway, an in-memory location store, an event log and private reads. The design was derived rather than chosen — which is the point of the ordering.',
          nodes: ['design'],
          edges: ['r5', 'r6', 'r7', 'r8'],
        },
        {
          id: 'rq5',
          title: 'Unanswered questions become stated assumptions',
          description:
            '"You decide" is answered with a number, written where the interviewer can see it, and then used in the design. An assumption that does not change anything was not worth stating.',
          nodes: ['assume'],
          edges: ['r9'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The most useful example here is a side-by-side of two requirement sets for the same prompt, because it shows how completely the non-functional answers determine the design.

**The prompt, both times: "design a system that shows a delivery courier's live location to the customer."**

**Set A**

\`\`\`
Freshness:      30 seconds is fine
Concurrency:    5,000 active orders at peak
History:        current location only
Authorisation:  the customer only
Loss tolerance: losing recent locations is fine
\`\`\`

**The design this forces:** the courier's app posts a location every 30 seconds to a plain HTTP endpoint. The location goes into Redis with a 2-minute TTL, keyed by order id. The customer's app polls a \`GET\` endpoint every 30 seconds. **No persistent connections, no durable location storage, no event log.** Total: two endpoints and one Redis key pattern. At 5,000 orders and one write per 30 seconds, that is 170 writes per second — a single instance.

**Set B**

\`\`\`
Freshness:      2 seconds
Concurrency:    500,000 active orders at peak
History:        the full route must be auditable for 90 days
Authorisation:  customer, courier and support, with different fields
Loss tolerance: the audit record must lose nothing
\`\`\`

**The design this forces, and almost nothing survives from Set A:**

- **2-second freshness** eliminates polling — 500,000 clients polling every 2 seconds is 250,000 requests/second of mostly-unchanged data. It requires **server push over persistent connections**, which brings connection ownership: which gateway holds this customer's connection, and how does a location update reach it.
- **500,000 concurrent orders** at one update per 2 seconds is **250,000 writes/second**. That cannot go to a durable database synchronously, so live location is in memory and durability is separate.
- **A 90-day auditable route** requires an append-only log, and it is a different write path from the live one: the live path optimises for latency, the audit path for durability. **One requirement split the design into two paths.**
- **Different fields per viewer** means the response depends on who is asking, so it cannot be cached publicly and the authorisation check is on the hot path.
- **The audit record losing nothing** forces the durable write to be acknowledged, which means the live path publishes to a log with acknowledgement rather than fire-and-forget.

**The comparison is the lesson.** Same functional requirement — "show the courier's location" — and the two designs share no components. Set A is two endpoints; Set B is a connection gateway, an in-memory store, a durable log, a projection, and per-viewer authorisation.

**Three transferable conclusions.**

**The functional requirement determined almost nothing.** Both systems show a location. Everything that differs came from the non-functional answers, which is why a candidate who collects only functional requirements is designing against imagined constraints.

**One requirement can split a design in two.** "Auditable for 90 days" plus "2-second freshness" cannot be served by one write path, because they optimise for opposite things. **Noticing that two requirements conflict is a strong signal** — it means proposing two paths rather than one compromised path.

**The scale figure changed the storage decision, not the component count.** 170 writes/second and 250,000 writes/second both need somewhere to put a location; only the second forbids that place being a durable database. **This is why the estimate must precede the data model** rather than accompany it.`,
  },

  tradeoffs: {
    intro:
      'The decisions are about how to spend the scoping budget. Rows are the choices candidates actually face in the first five minutes.',
    rows: [
      {
        option: 'Four to six questions, each with a named consequence',
        whenItWins:
          'The target. Enough to eliminate the main design options, cheap enough to leave the deep dive intact.',
        whenItLoses:
          'When the prompt is genuinely open-ended, where scoping legitimately becomes most of the interview.',
        cost:
          'Roughly three minutes, and the discipline of rejecting questions you want to ask.',
      },
      {
        option: 'Ten or more questions',
        whenItWins:
          'Rarely — an open-ended business prompt where the problem itself is unclear.',
        whenItLoses:
          'Usually. It consumes the deep dive and reads as an inability to proceed without complete information.',
        cost:
          'Minutes taken from where the assessment concentrates.',
      },
      {
        option: 'No questions; design immediately',
        whenItWins:
          'Never in an interview.',
        whenItLoses:
          'Always. The design answers constraints you imagined, and the interviewer finds out at minute twenty.',
        cost:
          'A technically competent answer to a different problem.',
      },
      {
        option: 'Quantified non-functional requirements',
        whenItWins:
          'Always. A number is checkable, so a design can be validated against it and defended with it.',
        whenItLoses:
          'Never — though it costs a question or an assumption per dimension.',
        cost:
          'Time, and the risk of assuming a figure the interviewer would have chosen differently.',
      },
      {
        option: 'Unquantified sentiments — "scalable, available, fast"',
        whenItWins:
          'Nowhere. They cannot be designed against or checked.',
        whenItLoses:
          'Always, and invisibly: the design cannot be wrong because nothing constrains it.',
        cost:
          'Every subsequent decision becomes unfalsifiable.',
      },
      {
        option: 'State an assumption when the answer does not come',
        whenItWins:
          'Whenever the interviewer says "you decide". Fast, checkable, and it demonstrates knowing which number matters.',
        whenItLoses:
          'If the assumption is then ignored, which is worse than not stating it.',
        cost:
          'Being visibly wrong if the interviewer had a different figure in mind — which is cheap and correctable.',
      },
      {
        option: 'Wait for the interviewer to specify',
        whenItWins:
          'Nowhere. The specification is not coming; ambiguity is the test.',
        whenItLoses:
          'Immediately, and it reads as an inability to work under the conditions of the actual job.',
        cost:
          'Minutes of stalled progress and a poor impression.',
      },
      {
        option: 'Declare out-of-scope explicitly',
        whenItWins:
          'Always, in one sentence. Bounds the problem, prevents the appearance of forgetting, and invites correction in ten seconds.',
        whenItLoses:
          'If you exclude the thing the interviewer wanted to assess — which the invitation to correct resolves.',
        cost:
          'One sentence.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"What database should I use? Which cloud provider? Should this be microservices?"',
      whyWeak:
        'None of the answers changes the design, so each question costs a minute of the deep dive to learn nothing. Worse, asking which database delegates your decision to the interviewer — the database follows from the access patterns and scale you should be establishing.',
      strongAnswer:
        '"Before asking anything I check whether I can complete \'if the answer is X I would build A, if Y then B\'. For the database question I cannot — the answer follows from the access pattern and the scale, which are what I should be asking about. So instead: what is the read-to-write ratio and the absolute scale, does this need to be exact or approximate, and is there a hot entity?"',
    },
    {
      weakAnswer: '"The requirements are: it should be scalable, highly available, and low latency."',
      whyWeak:
        'Three sentiments, none of which a design can be checked against. "Highly available" is compatible with 99% and 99.999%, which are different architectures separated by three orders of magnitude of cost. Nothing here constrains any decision.',
      strongAnswer:
        '"Let me quantify those, because unquantified they cannot be designed against. I will assume 99.9% availability measured on successful reads within 200 ms, over a 28-day window — which gives 43 minutes of monthly budget and rules out a single-region single-primary design. And I will assume roughly 600,000 reads per second at average with 3× peak. If those figures are wrong, tell me and I will adjust."',
    },
    {
      weakAnswer: 'Interviewer: "You decide the scale." Candidate: "Hmm. Well, it depends... what would be typical?"',
      whyWeak:
        'It returns the question, which is what the interviewer was testing. Ambiguity is the condition of the actual job, and a candidate who cannot proceed without a specification looks unable to do it. It also burns time visibly.',
      strongAnswer:
        '"Then I will assume 500 million daily active users viewing 100 posts each, so roughly 600,000 reads per second at average and 1.7 million at peak, with a 50:1 read-to-write ratio. I will write that on the board and design for it. If a different order of magnitude were intended, the storage decision is what would change first."',
    },
    {
      weakAnswer: 'Lists the functional requirements from the prompt and starts designing.',
      whyWeak:
        'The prompt already gave the functional requirements; they determine almost nothing. Two systems that both "show a courier\'s location" can share no components, depending entirely on freshness, scale, history and authorisation — none of which is in the prompt.',
      strongAnswer:
        '"The prompt gave me the operations, so the useful work is the constraints it did not give. I need six things: scale and read-to-write ratio, a latency budget at a percentile, the consistency requirement per operation, what may be lost, an availability target, and who may see what. Those determine the architecture; the operations mostly determine the API."',
    },
    {
      weakAnswer: 'Assumes 1.7 million reads per second, then proposes serving reads from a partitioned relational database.',
      whyWeak:
        'The assumption was stated and not used. That is worse than not assuming, because it demonstrates that the candidate knows the ritual without understanding its purpose — the number exists to eliminate design options, and this one was ignored.',
      strongAnswer:
        '"1.7 million reads per second at peak, so the read path cannot touch a relational database — it has to be served from memory, with the database as the durable record behind it. The write path at 35,000 per second is comfortable for a relational primary. That asymmetry is why I am splitting the read and write paths, and the number is what forced it."',
    },
    {
      weakAnswer: 'Designs the whole system including authentication, payments and a recommendation model, and runs out of time.',
      whyWeak:
        'Nothing was declared out of scope, so the candidate tried to build everything and finished nothing. And the interviewer could not tell whether the omissions at the end were deliberate or forgotten.',
      strongAnswer:
        '"I am going to treat authentication, payments and the ranking model as out of scope and assume an authenticated user id arrives with each request — tell me if any of those is the focus. That bounds this to the parts I can actually design in the time, and it lets you redirect me in ten seconds if I have excluded the interesting part."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hr-1',
      front: 'What is the test for whether a clarifying question is worth asking?',
      back: 'Complete "if the answer is X I would build A, if Y then B". If both halves are concrete and different, ask. If not, it changes nothing.',
      topic: 'scoping',
    },
    {
      id: 'fc-hr-2',
      front: 'Why is "answerable" not the same as "worth asking"?',
      back: 'Answerable questions feel productive. The test is whether the answer eliminates a design option — one that leads to the same architecture cost you a minute of the deep dive.',
      topic: 'scoping',
    },
    {
      id: 'fc-hr-3',
      front: 'Which kind of requirement is in the prompt, and which determines the architecture?',
      back: 'Functional requirements are in the prompt; non-functional ones determine the architecture and are almost never given. A candidate who only collects functional ones designs against imagined constraints.',
      topic: 'requirements',
    },
    {
      id: 'fc-hr-4',
      front: 'What makes a non-functional requirement usable?',
      back: 'Quantification. "Highly available" is compatible with 99% and 99.999% — three orders of magnitude of cost apart. Numbers or nothing.',
      topic: 'non-functional',
    },
    {
      id: 'fc-hr-5',
      front: 'Name the six non-functional dimensions.',
      back: 'Scale (with read-to-write ratio), latency at a percentile, consistency per operation, durability and RPO, availability and RTO, and security and privacy including deletion rights.',
      topic: 'non-functional',
    },
    {
      id: 'fc-hr-6',
      front: 'What do you do when the interviewer says "you decide"?',
      back: 'State an assumption with a number, write it where they can see it, and then use it. An assumption is a complete substitute for an answer.',
      topic: 'assumptions',
    },
    {
      id: 'fc-hr-7',
      front: 'What is worse than not stating an assumption?',
      back: 'Stating it and then ignoring it. That shows the ritual was performed without understanding that the number exists to eliminate design options.',
      topic: 'assumptions',
    },
    {
      id: 'fc-hr-8',
      front: 'Which three questions are worth asking on almost any prompt?',
      back: 'The read-to-write ratio, whether there is a hot entity, and whether the response depends on who is asking.',
      topic: 'scoping',
    },
    {
      id: 'fc-hr-9',
      front: 'Why write functional requirements as verbs with actors and objects?',
      back: 'Precision surfaces the operations candidates forget — delete, edit, un-like, cancel — plus the authorisation model and the business rules hidden in the verb.',
      topic: 'requirements',
    },
    {
      id: 'fc-hr-10',
      front: 'What does declaring out-of-scope buy, in one sentence?',
      back: 'It bounds the problem so you can finish, prevents the interviewer thinking you forgot, and invites correction in ten seconds rather than twenty minutes.',
      topic: 'requirements',
    },
    {
      id: 'fc-hr-11',
      front: 'Why ask about consistency per operation rather than per system?',
      back: 'A payment and a view counter in the same system want opposite answers, and a system-wide statement hides that. Per-operation is what distinguishes a considered answer.',
      topic: 'non-functional',
    },
    {
      id: 'fc-hr-12',
      front: 'Which two non-functional requirements do candidates most often omit entirely?',
      back: 'RPO — how much data loss is acceptable — and RTO. RPO determines synchronous versus asynchronous replication.',
      topic: 'non-functional',
    },
    {
      id: 'fc-hr-13',
      front: 'What does it mean when two requirements conflict?',
      back: 'That you need two paths rather than one compromised path — "2-second freshness" and "90-day auditable" optimise for opposite things. Noticing the conflict is a strong signal.',
      topic: 'trade-offs',
    },
    {
      id: 'fc-hr-14',
      front: 'How many clarifying questions, and why not more?',
      back: 'Four to six with named consequences. Ten — even good ones — consumes the deep dive and reads as an inability to proceed under ambiguity.',
      topic: 'scoping',
    },
  ],

  quiz: [
    {
      id: 'q-hr-1',
      kind: 'single',
      prompt: 'Which question passes the "name the two designs" test?',
      options: [
        { id: 'a', label: '"Does the courier location need to be fresh within seconds, or is 30 seconds acceptable?"' },
        { id: 'b', label: '"Should we deploy on Kubernetes?"' },
        { id: 'c', label: '"Do we need a mobile app as well as web?"' },
        { id: 'd', label: '"Which database do you prefer?"' },
      ],
      correct: ['a'],
      explanation:
        'Seconds means persistent connections, server push and connection ownership; 30 seconds means a polled HTTP endpoint and a cache with no connection state — two completely different systems. The other three lead to the same design, and asking which database delegates your decision to the interviewer.',
      difficulty: 'core',
      topic: 'scoping',
    },
    {
      id: 'q-hr-2',
      kind: 'scenario',
      prompt:
        'A candidate states: "requirements are that it be scalable, highly available and low-latency". Why is this not usable?',
      options: [
        { id: 'a', label: 'None is quantified, so no design can be checked against them — "highly available" spans 99% to 99.999%, three orders of magnitude of cost apart' },
        { id: 'b', label: 'These are functional rather than non-functional requirements' },
        { id: 'c', label: 'They should have been provided by the interviewer' },
        { id: 'd', label: 'Nothing; these are the standard non-functional requirements' },
      ],
      correct: ['a'],
      explanation:
        'They are the right dimensions and useless without numbers. 99% is 7.2 hours of monthly downtime and 99.999% is 26 seconds; they are not the same requirement. An unquantified non-functional requirement makes every subsequent decision unfalsifiable, which is why the candidate should assume figures if the interviewer will not give them.',
      difficulty: 'core',
      topic: 'non-functional',
    },
    {
      id: 'q-hr-3',
      kind: 'scenario',
      prompt:
        'The interviewer says "you decide the scale". What is the best response?',
      options: [
        { id: 'a', label: 'State a specific assumption with numbers, write it visibly, and use it to make design decisions' },
        { id: 'b', label: 'Ask what would be typical for this kind of system' },
        { id: 'c', label: 'Design for the largest plausible scale to be safe' },
        { id: 'd', label: 'Design something scale-agnostic that works at any size' },
      ],
      correct: ['a'],
      explanation:
        'Ambiguity is the test, and an assumption is a complete substitute for an answer. Returning the question stalls; designing for the largest scale over-engineers and demonstrates that you cannot size a solution; and nothing is scale-agnostic — 170 writes/second and 250,000 writes/second have no design in common.',
      difficulty: 'core',
      topic: 'assumptions',
    },
    {
      id: 'q-hr-4',
      kind: 'scenario',
      prompt:
        'Two requirements arrive: "courier location must be fresh within 2 seconds" and "the full route must be auditable for 90 days with no loss". What does this combination imply?',
      options: [
        { id: 'a', label: 'Two separate write paths — the live path optimised for latency and the audit path for durability, since they optimise for opposite things' },
        { id: 'b', label: 'A single durable write path with a 2-second acknowledgement budget' },
        { id: 'c', label: 'The audit requirement should be dropped as incompatible' },
        { id: 'd', label: 'A cache in front of the durable store' },
      ],
      correct: ['a'],
      explanation:
        'At scale, 2-second freshness means location cannot wait for a durable acknowledgement, and a lossless audit record means the durable write must be acknowledged. One path cannot satisfy both, so the design splits: in-memory live state plus an append-only log. Noticing the conflict and proposing two paths is the strong answer.',
      difficulty: 'advanced',
      topic: 'trade-offs',
    },
    {
      id: 'q-hr-5',
      kind: 'scenario',
      prompt:
        'A candidate assumes 1.7 million reads/second, then proposes serving reads from a partitioned relational database. What is the problem?',
      options: [
        { id: 'a', label: 'The assumption was stated and not used — which is worse than not stating it, because the number exists to eliminate design options' },
        { id: 'b', label: 'The assumption was too high and should have been more conservative' },
        { id: 'c', label: 'Nothing, provided enough partitions are used' },
        { id: 'd', label: 'The assumption should have been agreed with the interviewer first' },
      ],
      correct: ['a'],
      explanation:
        'Stating a figure and then designing something it forbids demonstrates the ritual without its purpose. 1.7 million reads/second must be served from memory; partitioning does not close a three-order-of-magnitude gap. The estimate exists to make the design decision, not to be recited.',
      difficulty: 'core',
      topic: 'assumptions',
    },
    {
      id: 'q-hr-6',
      kind: 'multi',
      prompt:
        'Which are good reasons to declare something explicitly out of scope? Select all that apply.',
      options: [
        { id: 'a', label: 'It bounds the problem so the design can actually be finished in the time' },
        { id: 'b', label: 'It prevents the interviewer thinking you forgot it' },
        { id: 'c', label: 'It invites correction in ten seconds rather than at minute twenty' },
        { id: 'd', label: 'It reduces the number of questions you need to ask' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are why one sentence of scope declaration is among the highest-value moves in the opening minutes. The fourth is not a benefit — the questions you still need are about the parts that remain in scope, and excluding authentication does not reduce the need to establish scale or consistency.',
      difficulty: 'core',
      topic: 'requirements',
    },
  ],

  exercises: [
    {
      id: 'ex-hr-1',
      kind: 'design',
      title: 'Grade the questions, then write the requirement set',
      estimatedMinutes: 30,
      prompt: `**Part 1.** For the prompt "design a system for scheduling and running recurring background jobs for a SaaS product", grade each candidate question as **ask** or **skip**, and for each "ask" name the two designs its answers produce.

1. Should we use cron or a workflow engine?
2. How many jobs, how often, and how long does each run?
3. Must a job run exactly once per schedule, or is at-least-once acceptable?
4. What language are the jobs written in?
5. Can a job be scheduled by a customer, or only by us?
6. What happens if a job is still running when its next scheduled time arrives?
7. Do we need a UI?
8. Must jobs run at the exact scheduled time, or is a few minutes' delay acceptable?
9. Should we use PostgreSQL or Redis for the schedule?
10. Can jobs depend on other jobs?

**Part 2.** Write the complete requirement set you would state before designing: functional requirements as precise verbs, six quantified non-functional requirements, and an explicit out-of-scope declaration. Assume the interviewer says "you decide" to everything.

Then answer:

- Which single requirement most determines the architecture, and why?
- Which two of your requirements conflict, and what does that imply?
- What would you have got wrong if you had skipped question 6?`,
      rubric: [
        'Each question graded with a reason tied to the two-designs test.',
        'Correctly identifies 2, 3, 5, 6, 8, 10 as ask and 1, 4, 7, 9 as skip.',
        'For each "ask", names two concrete and different designs.',
        'Functional requirements written as verbs with actors and objects, including delete and modify.',
        'Six quantified non-functional requirements, with numbers.',
        'Consistency and durability stated per operation where they differ.',
        'Explicit out-of-scope declaration in one sentence.',
        'Identifies the exactly-once requirement or the overlap policy as most architecturally decisive, with reasoning.',
        'Names a genuine conflict between two requirements and proposes two paths.',
        'Explains what the overlap question prevents getting wrong.',
      ],
      modelAnswer: `**Part 1 — grading the questions**

**1. "Cron or a workflow engine?" — SKIP.**
This asks me to choose a technology before establishing the requirements that would decide it. And it delegates the decision: whether a workflow engine is warranted follows from question 10 (do jobs have dependencies) and question 3 (what delivery guarantee). **Ask those; the technology falls out.**

**2. "How many jobs, how often, how long?" — ASK.**
*If 500 jobs, hourly, 30 seconds each:* roughly 12,000 runs/day, ~0.14 concurrent on average. A single scheduler process, a database table for schedules, and a small worker pool. **No distribution needed at all.**
*If 5 million jobs (one per customer), every minute, up to 10 minutes each:* 7.2 billion runs/day and potentially 50,000 concurrent executions. The scheduler must be partitioned, the dispatch must be queue-based, and worker capacity is the dominant cost. **Completely different system.**
This is the sizing question and it must be asked.

**3. "Exactly once per schedule, or at-least-once?" — ASK.**
*Exactly once:* impossible in the strict sense, so it means at-least-once dispatch plus idempotent execution — which pushes a requirement onto every job, and requires a claim mechanism with fencing so two workers cannot run the same occurrence.
*At-least-once, duplicates acceptable:* a much simpler dispatcher, no claim protocol, and no idempotency obligation on job authors.
**This determines whether the hard part is the dispatcher or the job contract.**

**4. "What language are the jobs written in?" — SKIP.**
Changes no scheduling architecture. It would become architectural if the answer were "arbitrary customer-supplied code", because that implies sandboxing and resource isolation — **so the useful version is question 5**, which I am already asking.

**5. "Customer-scheduled, or only us?" — ASK.**
*Only us:* schedules are configuration, changed at deploy time, trusted, and bounded in number. No multi-tenancy, no quotas, no validation of arbitrary input.
*Customer-scheduled:* schedules are user data with a CRUD API, per-tenant quotas, validation of schedule expressions, and — critically — **a noisy-tenant problem**, since one customer scheduling 10,000 jobs a minute must not starve everyone else. That brings per-tenant concurrency limits and possibly cell isolation.
**A very large difference, and it also changes the scale answer**, so I would ask this before question 2.

**6. "What if a job is still running when its next schedule arrives?" — ASK.**
*Skip the occurrence:* the scheduler needs to know whether a previous run is still active, so it needs run state and a way to detect a crashed run versus a slow one — which is a lease.
*Queue it and run after:* an unbounded backlog is possible, so the queue must be bounded and there must be a policy for what happens when it fills.
*Run it concurrently:* jobs must tolerate concurrent execution of themselves, which is a contract on job authors.
**Three different answers with three different mechanisms**, and none of them is the default anyone would guess.

**7. "Do we need a UI?" — SKIP.**
No server-side architectural consequence. If the answer implied "customers manage schedules themselves", that is question 5.

**8. "Exact time, or is a few minutes' delay acceptable?" — ASK.**
*Exact (within a second):* the scheduler must poll at high frequency or use precise timers, and clock skew across scheduler instances becomes a correctness concern.
*A few minutes acceptable:* the scheduler can wake every 30 seconds and scan for due jobs, which is far simpler and much cheaper. **It also permits batching dispatch**, which matters at the high end of question 2.
**This is the difference between a timing-critical system and a periodic-scan system.**

**9. "PostgreSQL or Redis for the schedule?" — SKIP.**
Same defect as question 1. The answer follows from scale and durability requirements. And schedules are data that must not be lost, which mostly answers it — but I should reach that by establishing durability, not by asking for a preference.

**10. "Can jobs depend on other jobs?" — ASK.**
*No:* independent occurrences, dispatched to a queue, no coordination. A scheduler and workers.
*Yes:* a directed graph of jobs with completion-triggered dispatch, partial-failure semantics, and a way to represent "job B waits for job A this cycle". **That is a workflow engine, not a scheduler**, and it is the single largest scope difference in the list.

**Score: ask 2, 3, 5, 6, 8, 10 — six questions. Skip 1, 4, 7, 9.**

*And I would order them:* 5 (who schedules) first because it reframes everything, then 10 (dependencies) because it decides scheduler versus workflow engine, then 2 (scale), 3 (guarantee), 6 (overlap), 8 (timing precision). **Asking the two scope-defining questions before the sizing question stops me sizing the wrong system.**

---

**Part 2 — the requirement set, with everything assumed**

**Out of scope, stated first, in one sentence:**

> "I am treating authentication, the job execution runtime itself — I assume jobs are containers we can run — billing, and the customer-facing UI as out of scope. I will design the scheduling and dispatch system, and I will assume an authenticated tenant id arrives with each API call. Tell me if any of those is actually the focus."

**Functional requirements — verbs, actors, objects:**

\`\`\`
A tenant can create a recurring schedule for a job
A tenant can update a schedule's timing or configuration
A tenant can delete a schedule
A tenant can pause and resume a schedule
A tenant can list their schedules and each schedule's recent runs
A tenant can trigger an immediate one-off run of a schedule
The system dispatches a run when a schedule becomes due
The system records the outcome of every run
A tenant can view the logs and outcome of a specific run
An operator can cancel an in-flight run
\`\`\`

*Three things this precision surfaced:*

**Pause and resume**, which is distinct from delete and which most candidates omit. It matters because a paused schedule must not accumulate a backlog — which connects to the overlap policy.

**Trigger immediately**, which means the dispatch path must be callable outside the scheduler. If the scheduler is the only thing that can dispatch, this requirement forces a redesign later.

**Cancel an in-flight run**, which requires runs to be addressable and workers to be interruptible — a real constraint on the worker contract that would be very expensive to add afterwards.

**Non-functional requirements, quantified, all assumed:**

\`\`\`
1. SCALE
   50,000 tenants; 20 schedules each = 1,000,000 schedules
   Median frequency: hourly.  Minimum: every minute.
   → ~1,000,000 runs/hour average, ~300 dispatches/second
   → peak at the top of the hour: assume 40% of schedules are hourly
     and land on the hour → ~400,000 dispatches in one minute
     = ~6,700/second for 60 seconds
   Run duration: p50 5 s, p99 5 min, hard cap 30 min
   → concurrent runs: ~300/s × 5 s ≈ 1,500 average; peak much higher

2. TIMING
   A run is dispatched within 30 s of its due time at p99.
   Not exact-time. This is a deliberate assumption and it is the one
   I would most want confirmed.

3. DELIVERY GUARANTEE
   At-least-once dispatch. Jobs must be idempotent — stated as a
   contract on job authors, in the documentation.
   No occurrence may be silently skipped: every due occurrence
   results in either a run or a recorded failure.

4. DURABILITY
   Schedules: RPO of zero. Losing a schedule means a customer's job
   silently stops, which is the worst failure this system has.
   Run history: RPO of 60 s acceptable; it is diagnostic, not
   authoritative.
   Retention: run history 90 days.

5. AVAILABILITY
   Schedule CRUD API: 99.9% (43 min/month).
   Dispatch: 99.95% — and measured as "occurrences dispatched
   within 5 minutes of due", not as endpoint uptime.
   RTO: 5 minutes. A dispatcher outage longer than that produces a
   backlog that must be worked through under the overlap policy.

6. ISOLATION AND SECURITY
   Per-tenant concurrency limit: 50 simultaneous runs.
   Per-tenant schedule limit: 1,000.
   A tenant can only see and modify their own schedules and runs.
   Run logs may contain customer data → encrypted at rest, and
   deletable on request within 30 days.
\`\`\`

*Note the shape of requirement 5.* "Dispatch availability" measured as endpoint uptime would be meaningless — the dispatcher has no endpoint. Measuring it as *occurrences dispatched within 5 minutes of due* is the observability lesson's point: **the SLI must reflect the outcome, not the mechanism.** A dispatcher that is running and dispatching nothing is 100% available by the wrong measure.

*And note requirement 3's second clause.* "No occurrence may be silently skipped" is the requirement that makes this system trustworthy, and it is stronger than at-least-once dispatch — it means a failure to dispatch must be *recorded*, so a customer can see that their job did not run. Without it, the failure mode is invisible.

**Overlap policy, from question 6 — assumed:**

\`\`\`
Default: skip the occurrence if the previous run is still active,
         and record it as "skipped: previous run in progress"
Configurable per schedule: skip | queue (max depth 1) | allow concurrent
\`\`\`

---

**Which single requirement most determines the architecture?**

**Requirement 3's second clause: "no occurrence may be silently skipped."**

It is more decisive than the scale figure, which is worth explaining because scale is the instinctive answer.

The scale — 6,700 dispatches/second at the top of the hour — determines *sizing*: how many scheduler partitions, how large the queue, how many workers. Those are quantitative decisions within a known structure.

The no-silent-skip requirement determines the *structure itself*:

- **The schedule store must record occurrences, not just schedules.** If the scheduler only holds "run hourly", then a scheduler that was down for two hours has no record of the two missed occurrences and cannot report them. So there must be a materialised notion of "occurrence due at T", created before dispatch.
- **That record must be created durably and then claimed**, which is the outbox pattern: a due occurrence is written, then dispatched, then marked. Without it, a crash between "decided to dispatch" and "dispatched" loses the occurrence with no trace.
- **A missed occurrence must be detectable**, which means a reconciliation process comparing expected occurrences against recorded outcomes — the outcome metric from the observability lesson, as a first-class component rather than a monitoring addition.
- **And it interacts with the overlap policy**: "skipped because the previous run was still active" is a *recorded outcome*, not an absence. The distinction between "deliberately skipped" and "silently lost" only exists if both are written down.

**So one clause in one requirement produced an occurrence table, an outbox, a claim protocol, and a reconciliation job.** That is why I would state it explicitly rather than leaving "at-least-once" to imply it — and it is a good example of the framework lesson's claim that the design is derived from the requirements rather than chosen.

*The runner-up is question 10's answer.* If jobs could depend on each other, this is a workflow engine and almost nothing above survives. I assumed no, and I would flag that as the assumption most likely to be wrong in a real product.

**Which two requirements conflict, and what does that imply?**

**Requirement 2 (dispatch within 30 seconds at p99) conflicts with requirement 1's peak (6,700 dispatches/second in a single minute at the top of the hour).**

The conflict: if the scheduler wakes every 30 seconds and scans for due occurrences, then at the top of the hour it finds 400,000 due occurrences in one scan. Dispatching 400,000 items takes time; the ones dispatched last are well outside the 30-second budget. **A single-scan design cannot meet the p99 timing requirement at the peak** — the requirements are individually reasonable and jointly unsatisfiable by the obvious design.

*What it implies: two things, not a compromise.*

**Partition the scheduler by schedule id**, so N partitions each handle 400,000/N occurrences and the scan-plus-dispatch fits in the budget. This is the sizing consequence, and it is why the scale figure matters even though it was not the most decisive requirement.

**And spread the schedules deliberately.** The peak exists because everyone's hourly job runs at :00. If schedule creation assigns a **deterministic jittered offset** — derived from a hash of the schedule id, so it is stable — then "hourly" means "every hour at minute 17, second 23" for one tenant and a different offset for another. **That flattens a 6,700/second peak into a steady ~300/second**, which makes the 30-second budget easy and removes the need for most of the partitioning.

**The jitter is the better fix**, and it is a *requirements* change rather than an architecture change: it means "hourly" does not mean "on the hour". I would raise that explicitly, because it is the kind of requirement relaxation that eliminates an entire scaling problem — and it is only findable by noticing that two stated requirements conflict.

*A second, smaller conflict:* requirement 4 gives run history an RPO of 60 seconds, while requirement 3 says no occurrence may be silently skipped. If the occurrence record is part of "run history" with a 60-second RPO, a crash could lose the record of an occurrence — violating requirement 3. **So the occurrence record belongs with the schedules at RPO zero, and only the run *logs and outcome detail* get the relaxed RPO.** Noticing that forces a useful split in the storage design.

**What would I have got wrong if I had skipped question 6?**

I would have assumed the obvious default — **"just run it"** — and produced a system with three defects, all discovered late.

**A long-running job would silently multiply.** A job scheduled every minute that takes 10 minutes accumulates 10 concurrent copies within ten minutes, and 600 within an hour. **That is an availability incident caused by a scheduling default**, and it would present as a worker fleet exhausted by one customer.

**The per-tenant concurrency limit would then fail unpredictably.** With a limit of 50 concurrent runs, the multiplying job consumes the tenant's entire allowance, so their *other* schedules stop running. The customer's complaint would be "my hourly report stopped" and the cause would be an unrelated minute-frequency job — a diagnosis nobody would reach quickly.

**And there would be no vocabulary for the correct behaviour.** Adding "skip if still running" later requires knowing whether a previous run is active, which requires run state with a lease to distinguish "still running" from "crashed and never finished". **That is a lease with all the arithmetic from the distributed-locks lesson**, retrofitted into a running system — and every existing schedule needs a default policy chosen for it.

**The general lesson from this one question.** It looks like an edge case and it is a core semantic decision. **Questions about "what happens when two things overlap" are almost always core semantics disguised as edge cases**, and they are cheap to ask and expensive to discover. The same shape appears in most systems: what happens when two writes race, when a retry arrives during the original, when a schedule fires during a deploy. Asking one of them during requirements is worth more than an hour of design afterwards.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hr-1',
      level: 'basic',
      question: 'What clarifying questions would you ask for any design prompt?',
      guidance:
        'Scale and read-to-write ratio, exact versus approximate, hot entities, who sees changes how fast, what may be lost. Look for the two-designs test being applied rather than a memorised list.',
    },
    {
      id: 'iq-hr-2',
      level: 'basic',
      question: 'What is the difference between functional and non-functional requirements here?',
      guidance:
        'Functional requirements are in the prompt and determine the API; non-functional ones are not given and determine the architecture. A strong answer notes that two systems with identical functional requirements can share no components.',
    },
    {
      id: 'iq-hr-3',
      level: 'intermediate',
      question: 'The interviewer says "you decide the scale". What do you do?',
      guidance:
        'State a specific assumption with numbers, write it visibly, and use it. Look for the recognition that ambiguity is the test and that an assumption is a complete substitute for an answer.',
    },
    {
      id: 'iq-hr-4',
      level: 'intermediate',
      question: 'How do you know a clarifying question is worth asking?',
      guidance:
        'Complete "if X I build A, if Y then B" with two concrete different designs. A strong answer distinguishes "answerable" from "useful" and gives an example of each.',
    },
    {
      id: 'iq-hr-5',
      level: 'advanced',
      question: 'Two requirements you have gathered conflict. What does that tell you?',
      guidance:
        'That you need two paths rather than one compromised path — or that a requirement can be relaxed to eliminate the conflict entirely. Excellent answers give an example of the relaxation being the better fix.',
    },
    {
      id: 'iq-hr-6',
      level: 'advanced',
      question: 'Which requirement in a system you know well was the most architecturally decisive, and why?',
      guidance:
        'Looking for a specific requirement traced to specific structure — not a scale figure, ideally, since those size a known structure rather than determine it. Excellent answers show one clause producing several components.',
    },
    {
      id: 'iq-hr-7',
      level: 'followup',
      question: 'You declared authentication out of scope. Why is that better than just not mentioning it?',
      guidance:
        'It bounds the problem so the design can be finished, prevents the appearance of forgetting, and invites correction in ten seconds. Look for it framed as a technique rather than a formality.',
    },
    {
      id: 'iq-hr-8',
      level: 'followup',
      question: 'You asked what happens when two things overlap. Why is that not an edge case?',
      guidance:
        'Because overlap questions are core semantics disguised as edge cases — the answer determines whether you need run state, leases, and a policy per entity. A strong answer notes they are cheap to ask and expensive to discover.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hr-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed an interviewer who can answer questions. Now change one thing: this is real work, and the person who wants the system does not know the non-functional requirements — they have never thought about consistency, RPO or peak load. How do you get them?',
      discussion: `This is the more common situation in practice, and asking the interview questions directly does not work: "what is your acceptable RPO?" gets a blank look, because the question is in your vocabulary rather than theirs.

**The translation technique: ask about consequences, not about properties.**

Instead of *"what consistency do you need?"* ask **"if two people edit this at the same time, what should happen?"** and **"if someone changes this and their colleague does not see it for ten seconds, is that a problem or is nobody looking?"** The answers give you the consistency requirement without using the word.

Instead of *"what is your RPO?"* ask **"if we lost the last thirty seconds of data in a crash, what would that mean for you?"** The answer is usually one of three: "nothing, they would just do it again", "we would need to know which records were affected", or "that is unacceptable, this is financial". Those map directly onto asynchronous replication, asynchronous plus reconciliation, and synchronous.

Instead of *"what is peak QPS?"* ask **"how many people use this, and when is it busiest?"** Then derive it yourself, out loud, and check the result against their intuition: "so about 200 requests a second at the Monday morning peak — does that sound right?" **They can validate a number they could not produce.**

**The technique for latency: ask what they would do about it.** "If this took five seconds, would people wait or would they give up?" A requirement stated as user behaviour is one a non-technical stakeholder can answer confidently, and it converts directly.

**Three sources of requirements that do not involve asking.**

**The existing system's data.** If there is a current version, its logs contain the actual traffic pattern, the actual read-to-write ratio, and the actual peak. **Measured requirements beat stated ones**, and stakeholders are frequently wrong about their own volumes by an order of magnitude in both directions.

**The business process around the system.** If support manually fixes wrong records, the current consistency is inadequate. If there is a nightly reconciliation spreadsheet, someone has already discovered a durability gap. **Existing manual workarounds are unstated requirements**, and they are the most reliable source available.

**The regulatory or contractual context.** Retention obligations, deletion rights, audit requirements, uptime commitments to customers. These are firm requirements that stakeholders often do not think to mention because they are not features.

**And the most important move: propose and let them react.** Rather than eliciting requirements, write down what you believe them to be and present them:

> "Here is what I think we need: up to 30 seconds of staleness is fine for the dashboard; a lost order is unacceptable but a lost page view is fine; peak is around 200 requests a second on Monday mornings; and data must be deletable within 30 days on request. Which of those is wrong?"

**People are much better at correcting a proposal than at producing a specification.** This is the same technique as stating an assumption in an interview, and for the same reason: it makes the requirement concrete and checkable, and it shifts the work from recall to recognition.

**What genuinely changes from the interview version.**

**You can iterate.** An interview has one pass; real work lets you build the smallest version, observe how it is used, and let the requirements emerge from usage. **That is usually better than getting them right up front**, and it argues for a design that is easy to change rather than one optimised for a guessed load.

**You must write them down.** In an interview the requirements live for 45 minutes. In real work they are the thing everyone will disagree about in six months, and an unwritten requirement will be remembered differently by each person.

**Some requirements are negotiable, and finding that out is your job.** "Exact counts" often becomes "approximate is fine" when someone learns the exact version costs three months. **In an interview the requirements are given; in real work the most valuable thing you can do is establish which are real and which are preferences** — because relaxing one requirement can eliminate an entire scaling problem, as the exercise's jitter example showed.

**The transferable point.** The interview skill is choosing which question to ask; the real-work skill is *translating* between the stakeholder's vocabulary and the architectural one, and knowing that measured behaviour beats stated intent. **Both rest on the same underlying move: convert a vague property into a concrete consequence, because a consequence can be checked and a property cannot.**`,
    },
    {
      id: 'al-hr-2',
      kind: 'debug',
      prompt:
        'A team built a notification system to specification and it is a persistent source of complaints: duplicate emails, notifications arriving hours late, and users receiving notifications for things they had muted. The code matches the requirements document. Diagnose which requirements were wrong or missing.',
      discussion: `The code matches the requirements, so the requirements are the defect. Each of the three symptoms points at a specific missing or under-specified requirement, and the pattern across them is instructive.

**Symptom 1 — duplicate emails. The missing requirement: the delivery guarantee, stated as a consequence.**

The requirements document almost certainly said "notifications must be delivered reliably". That is a sentiment, and it is compatible with at-least-once (duplicates) and at-most-once (losses). The team implemented retries, got at-least-once, and duplicates are the correct behaviour of what was specified.

*What the requirement should have said:* "A notification must be delivered at least once. Duplicate delivery of the same notification to the same user must be prevented by deduplication on a stable notification id, within a 24-hour window." **That is a requirement with a mechanism implied**, and it would have produced a deduplication table.

*The general defect:* **"reliable" is not a delivery guarantee.** The delivery-semantics vocabulary — at-least-once plus idempotent processing — exists precisely so this can be stated.

**Symptom 2 — notifications hours late. The missing requirement: a latency budget per notification class.**

The document said notifications are "sent promptly" or gave no timing at all. So the team built one queue for everything, and a batch of 5 million marketing notifications now sits ahead of a password-reset email. **The password reset arrives after the batch drains**, which is hours.

*What the requirement should have said:* "Transactional notifications — password reset, security alert, order confirmation — are delivered within 30 seconds at p99. Marketing notifications are delivered within 4 hours." **Two numbers, and they force separate queues with separate workers**, which is the bulkhead from the backpressure lesson.

*The general defect:* **a single latency requirement for a system with heterogeneous traffic classes guarantees the important class waits behind the unimportant one.** The requirement must be per class, and stating it per class is what produces the isolation.

**Symptom 3 — notifications for muted things. The missing requirement: when preferences are evaluated.**

The document said "users can mute notifications for a thread" — a functional requirement, correctly implemented. What it did not say is **at what point in the pipeline the mute is checked.**

If the check happens when the notification is *created*, then a notification created before the mute and delivered after it will still arrive. If it happens at *delivery*, it will not. And if notifications are batched, the gap between creation and delivery can be hours — so the two answers diverge substantially.

*What the requirement should have said:* "A user's notification preferences are evaluated at delivery time, not at creation time. A notification whose subject was muted after creation must not be delivered." **This one sentence changes the pipeline**: preferences must be readable on the delivery path, which means the delivery worker needs access to preference state, which may mean a cache and an invalidation concern.

*The general defect:* a requirement about *what* is checked with no requirement about *when* it is checked. **In any pipeline with a delay between decision and effect, "when is this evaluated" is a required part of the specification** — and it is invisible in a synchronous system, which is why it gets omitted.

**The two further requirements I would expect to be missing, given this pattern.**

**Quiet hours and rate limiting per user.** "Do not send more than N notifications per user per hour, and none between 22:00 and 08:00 in the user's local time." Almost every notification system needs this and almost no first specification includes it. Without it, an event storm sends a user forty emails at 3am, which is the complaint that arrives next.

**What happens when a provider fails.** "If the email provider is unavailable, transactional notifications are retried for 24 hours and then recorded as failed with an alert; marketing notifications are dropped after 1 hour." Without a stated policy, the team chose one implicitly — and a dead-letter queue nobody watches is the likely outcome.

**The pattern across all five, which is the real finding.**

**Every one is a non-functional or semantic requirement, and every one was implementable in several incompatible ways.** The functional requirements — "send notifications", "let users mute threads" — were complete and correct. The defects are entirely in the dimensions nobody specified: the delivery guarantee, the per-class latency budget, the evaluation point, the rate limits, and the failure policy.

**And each was cheap to ask and expensive to discover.** "What happens if we send the same notification twice?" is a fifteen-second question during requirements. As a production incident it is a deduplication table retrofitted into a running pipeline, plus an apology to every affected user.

**The diagnostic I would run on any requirements document**: for each functional requirement, ask four questions — *how many times may this happen? how late may it be? when is the decision evaluated? what happens when it fails?* **A functional requirement with no answer to those four is a requirement that will be implemented in whichever way is easiest**, and the resulting behaviour will be a surprise to whoever wrote it.

**Transferable:** a requirements document that specifies only behaviour specifies almost nothing, because behaviour under the normal case is the part everyone agrees on. **The requirements that matter are the ones about repetition, timing, evaluation order and failure** — and they are systematically omitted because the person writing the document is imagining the system working.`,
    },
  ],

  revision: {
    bullets: [
      'The test: complete "if X I build A, if Y then B" with two concrete different designs. If you cannot, do not ask.',
      'Answerable is not useful. A question whose answers lead to the same design costs you the deep dive.',
      'Functional requirements are in the prompt; non-functional ones determine the architecture and are not.',
      'Two systems with identical functional requirements can share no components.',
      'Quantify every non-functional requirement or discard it — "highly available" spans three orders of magnitude.',
      'The six dimensions: scale and read/write ratio, latency at a percentile, consistency per operation, durability and RPO, availability and RTO, security and deletion rights.',
      'Ask consistency per operation, not per system — a payment and a view counter want opposite answers.',
      'RPO and RTO are the two non-functional requirements candidates most often omit entirely.',
      'The three to ask on almost any prompt: read/write ratio, hot entity, does the response depend on the viewer.',
      'Do not ask technology preferences, team size, or client platform unless the answer is architectural.',
      'Four to six questions. Ten reads as an inability to proceed under ambiguity.',
      'When told "you decide", state an assumption with a number, write it visibly, and then use it.',
      'Stating an assumption and then ignoring it is worse than not stating it.',
      'Write functional requirements as verbs with actors and objects; it surfaces delete, edit, cancel and the authorisation model.',
      'Declare out-of-scope in one sentence: it bounds the problem, prevents the appearance of forgetting, and invites cheap correction.',
      'When two requirements conflict, you need two paths — or a requirement relaxation that eliminates the conflict.',
      '"What happens when two things overlap" is core semantics disguised as an edge case.',
      'For each functional requirement ask: how many times, how late, when evaluated, what on failure.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The step that converts an ambiguous prompt into a bounded problem: precise functional operations, quantified non-functional constraints, explicit out-of-scope declarations, and stated assumptions for everything left unanswered.',
    whyItExists:
      'Because the prompt contains the functional requirements and none of the constraints that determine the architecture — so a design built without them answers constraints the candidate imagined.',
    whenToUse: [
      'Every design prompt, before drawing anything.',
      'Even on problems you recognise, since the interviewer\'s version may differ.',
      'Most heavily on open-ended prompts, where scoping is the interview.',
    ],
    whenNotToUse: [
      'As an information-gathering exercise — every question must eliminate a design option.',
      'As a reason to stall when answers do not come; assume instead.',
      'For technology preferences, team size, or non-architectural client details.',
    ],
    alternatives: [
      'Stating an assumption, which is a complete substitute for an answer.',
      'Measuring the existing system, which beats stated requirements in real work.',
      'Proposing a requirement set for correction, since people correct better than they specify.',
      'Asking about consequences rather than properties, when the stakeholder lacks the vocabulary.',
    ],
    tradeoffs: [
      'Each question buys an eliminated design option and costs a minute of the deep dive.',
      'Quantifying buys a checkable design and costs a question or an assumption per dimension.',
      'An assumption buys momentum and costs being visibly wrong, which is cheap and correctable.',
      'Declaring out-of-scope buys a finishable problem and risks excluding the interesting part.',
      'Precision in functional requirements buys surfaced operations and costs time on wording.',
    ],
    failureModes: [
      'Collecting only functional requirements, which the prompt already gave.',
      'Unquantified non-functional sentiments that no design can be checked against.',
      'Asking questions whose answers lead to the same design.',
      'Asking which database or cloud, delegating your decision to the interviewer.',
      'Treating an unanswered question as a blocker rather than assuming.',
      'Stating an assumption and then designing something it forbids.',
      'Never declaring out-of-scope, so omissions look like oversights.',
      'Asking fifteen questions and losing the deep dive.',
      'Omitting RPO and RTO entirely, leaving replication choices unjustified.',
      'A single latency requirement for heterogeneous traffic classes.',
      'Specifying what is checked without specifying when it is evaluated.',
    ],
    followUpQuestions: [
      'Can you name the two designs this question\'s answers produce?',
      'What is the read-to-write ratio, and the absolute scale?',
      'What is the latency budget, at what percentile, per operation?',
      'What consistency does *this* operation need, as opposed to the system?',
      'What may be lost in a failure, and how long may recovery take?',
      'Is there a hot entity, and does the response depend on who is asking?',
      'Which operations are irreversible?',
      'Is there a deletion or retention obligation?',
      'What is explicitly out of scope, and have you said so?',
      'Which of your assumptions, if wrong, would change the design most?',
      'How many times may this happen, how late may it be, when is it evaluated, and what happens on failure?',
    ],
  },
});
