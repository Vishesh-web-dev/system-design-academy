import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-idempotency',
  title: 'Idempotency and safe retries',
  summary:
    'Networks lose responses, so callers must retry, so writes must be safe to repeat — and "exactly once" is always at-least-once delivery plus idempotent processing.',
  phase: 'foundations',
  module: 'apis',
  position: 11,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['idempotency', 'retries', 'api-design', 'exactly-once', 'concurrency'],
  prerequisites: ['f-api-errors'],
  resources: [
    {
      key: 'stripe-idempotent-requests',
      tier: 'must',
      note: 'The reference implementation of client-supplied idempotency keys: what is stored, how long, and what happens on a concurrent replay. Note the detail that a key is bound to its original request body.',
    },
    {
      key: 'aws-timeouts-retries-jitter',
      tier: 'must',
      note: 'The retry side of the contract. Read it for why an ambiguous failure forces a retry and why retries need budgets and jitter, which is what makes idempotency load-bearing rather than optional.',
    },
    {
      key: 'rfc-9110-http-semantics',
      tier: 'must',
      note: 'The formal definitions of safe and idempotent methods. Worth reading precisely, because "idempotent" in HTTP means repeatable without additional effect — not that the response is identical.',
    },
    {
      key: 'paypal-idempotency',
      tier: 'good',
      note: 'A second production contract for the same mechanism. Comparing two independently designed versions shows which parts are essential and which are choices.',
    },
    {
      key: 'kafka-exactly-once-confluent',
      tier: 'advanced',
      note: 'How a messaging system builds transactional exactly-once semantics, and precisely what it does and does not guarantee once effects leave the system.',
    },
  ],

  intuition: {
    body: `Start from something unavoidable: **the network can always lose your response.** Not sometimes, not with bad infrastructure — always, in principle. The server can commit a write, start sending 201 Created, and have the connection drop before the client sees a byte.

Two consequences follow, and together they force the entire design.

**The caller must retry.** Otherwise every lost response is a lost operation, and a payment that silently did not happen is worse than one that happened twice.

**So the operation must be safe to repeat.** If retrying creates a second order, then the only two available behaviours are "sometimes lose operations" and "sometimes duplicate them". Both are wrong.

Idempotency is the property that makes the retry harmless: **performing the operation twice has the same effect as performing it once.** Note carefully what it does not say. It does not say the second call does nothing, or that it returns the same bytes, or that it takes the same time. It says the *effect* is the same.

Some operations are naturally idempotent. \`DELETE /orders/42\` twice leaves the order deleted. \`PUT /users/7\` with a full representation twice leaves the same user. Both are idempotent because they describe a desired end state rather than a change.

Some are not, and cannot be made so by wishing. \`POST /payments\` with \`{amount: 2450}\` means "charge this", and charging twice charges twice. The fix is to give the operation an identity: the caller generates a key, sends it, and the server uses it to recognise "this is the same request I already did" rather than "here is another request that looks similar".

The sentence to remember for the rest of the curriculum: **there is no exactly-once delivery. There is at-least-once delivery plus idempotent processing, and that combination is what people mean when they say exactly once.**`,
    analogyLimit:
      'Thinking of idempotency as "safe to repeat" is right and hides the hard part: two identical requests arriving *simultaneously*, not sequentially. Sequential replay is a lookup problem. Concurrent replay is a locking problem, and it is where real implementations are subtly wrong — usually by checking for the key and inserting it in two separate steps.',
  },

  deepExplanation: {
    predict: {
      question:
        'A server implements idempotency as: (1) look up the key, (2) if found return the stored response, (3) otherwise do the work and store the key with the response. Two identical retries arrive 5 ms apart, hitting two different instances. What happens, and what is the fix?',
      answer: `**Both charge the card.**

Interleaved:

| Time | Instance A | Instance B |
| --- | --- | --- |
| t0 | look up key → not found | |
| t1 | | look up key → not found |
| t2 | charge card | |
| t3 | | charge card |
| t4 | store key + response | |
| t5 | | store key + response — conflict, or overwrite |

The check and the insert are two separate operations with a window between them. Classic time-of-check-to-time-of-use, and 5 ms is an enormous window.

**The fix: make claiming the key atomic, before doing the work.**

\`\`\`sql
INSERT INTO idempotency_keys (key, status, request_hash)
VALUES ($1, 'in_progress', $2)
ON CONFLICT (key) DO NOTHING
RETURNING key;
\`\`\`

- **Rows returned** → you claimed it. Do the work, then update the row to \`completed\` with the response.
- **No rows** → someone else claimed it. Now you must decide what to do, and there are only two honest options:
  - If the existing row is \`completed\`, return its stored response.
  - If it is \`in_progress\`, the other request is still running. Return **409 Conflict** and let the caller retry shortly. Do **not** wait and poll — you would be holding a request open on a promise you cannot keep, and you cannot distinguish "still running" from "crashed mid-flight".

**The second thing this reveals: an \`in_progress\` row can be orphaned.** If the instance that claimed the key crashes after charging the card and before recording the response, the key stays \`in_progress\` forever and the caller can never get an answer. You need a lease with an expiry, and a reconciliation path for keys that expire while in progress — which for money means checking with the payment provider rather than assuming.

That is the honest depth of this problem: the atomic claim is necessary and not sufficient, because the process doing the work can die between the external effect and the record of it.`,
    },
    body: `## What idempotent actually means

RFC 9110 defines a method as idempotent if **the intended effect of several identical requests is the same as for a single request.** Three clarifications that matter:

**It is about effect, not response.** \`DELETE /orders/42\` may return 204 the first time and 404 the second. Both are correct; the effect — the order is gone — is unchanged.

**It is a property of the method, not of the implementation.** GET, HEAD, PUT and DELETE are idempotent by definition; POST is not. That definition is what licenses intermediaries and client libraries to retry the first four automatically.

**Idempotent is not the same as safe.** GET is *safe* (no side effects at all). PUT and DELETE are idempotent but not safe — they change things, just repeatably.

The practical consequence: **any layer may retry an idempotent method without asking you.** Proxies, meshes, client libraries and load balancers all do. If you implement a non-idempotent operation behind PUT, something will eventually retry it and you will not see where the duplicate came from.

## Making writes idempotent

Four mechanisms, in rough order of preference.

**Model the operation as a desired state.** \`PUT /orders/42/status\` with \`{"status": "cancelled"}\` is naturally idempotent — the second call sets it to cancelled again. This is the cheapest option and it is available more often than people expect. Prefer it wherever the operation genuinely is "make it be this".

**Client-generated resource identity.** Let the client choose the id: \`PUT /orders/{clientGeneratedId}\`. A retry addresses the same resource, so the unique constraint on the primary key does the deduplication for you, with no extra table. Elegant, and it requires the client to generate identifiers, which some cannot.

**Idempotency keys.** The general mechanism, described below. Works for any operation and costs a stored record per key.

**Natural uniqueness constraints.** A unique index on \`(customer_id, order_reference)\` makes a duplicate insert fail at the database. Cheap and precise, and it only works when a genuine business-level uniqueness rule exists.

## The idempotency key contract

The caller generates a key — a UUID is fine — and sends it with the request. The key identifies *the operation the caller is attempting*, not the attempt itself, so **all retries of one logical operation must reuse the same key**. Generating a fresh key per attempt defeats the entire mechanism, and it is the most common client-side bug.

Server side, five decisions:

**Bind the key to the request.** Store a hash of the request body alongside the key. If the same key arrives with a *different* body, that is a client bug — return 422, not the stored response. Without this check, a client that reuses keys carelessly gets the wrong operation's result back, silently.

**Claim atomically.** As derived in the prediction: one statement that inserts-or-fails, before any work happens.

**Store the response, not just the fact.** A retry must be able to return what the original returned, including the created resource's id. Storing only "done" leaves the caller unable to learn the outcome.

**Choose a retention window and state it.** 24 hours covers essentially all retry scenarios; longer costs storage and delays the moment a key can be reused. Publish it, because the caller needs to know when a key stops being recognised.

**Decide the concurrent-replay behaviour.** 409 while \`in_progress\` is the honest answer. Anything else means holding a connection open waiting for work you do not control.

## Where it gets genuinely hard

**External side effects.** If the operation charges a card through a third party, the atomic claim protects your database and not the provider. The sequence must be: claim the key durably, then call the provider *passing your key as their idempotency reference*, then record the result. If you crash between the provider call and recording it, the key is orphaned — and recovery means asking the provider what happened, not guessing. Payment providers support idempotency keys precisely because this problem has no local solution.

**Non-deterministic operations.** "Assign the next available seat" produces a different answer each time it runs. Making it idempotent means the *first* execution's choice must be recorded and returned on replay, which is what storing the response achieves. If you store only "succeeded", a retry cannot tell the caller which seat.

**Multi-step operations.** Create an order, reserve stock, charge a card. A retry must not repeat the steps that already completed, which means each step needs its own idempotency, not just the endpoint. This is where an idempotency key stops being enough and a durable workflow with per-step checkpointing is the actual answer.

## The exactly-once question

You will be asked whether exactly-once delivery is possible. The answer is no, and the reasoning is worth being able to give:

A sender cannot know whether a message was delivered without an acknowledgement, and the acknowledgement can be lost. So the sender either retries (at-least-once, possible duplicates) or does not (at-most-once, possible loss). There is no third option, because the uncertainty is in the network and no protocol removes it.

What systems marketed as exactly-once actually provide is **at-least-once delivery plus deduplication in the consumer**, sometimes wrapped in a transaction so the dedup record and the effect commit together. That is genuinely valuable and it is not exactly-once delivery.

The boundary is worth naming: it holds **only inside the transactional system**. The moment an effect leaves — an email sent, a card charged, a file written elsewhere — the guarantee stops, because that external effect cannot join your transaction. Which returns you to idempotency keys at that boundary.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'concurrent-replay',
      title: 'Why check-then-act duplicates, and what fixes it',
      caption:
        'Compare the two halves. In the first, both instances see "not found" because the check and the insert are separate. In the second, the database decides the winner in one statement — which is the only place that decision can be made correctly.',
      code: `sequenceDiagram
    participant A as Instance A
    participant B as Instance B
    participant D as Database
    participant P as Payment provider

    rect rgb(42,29,29)
    Note over A,P: Broken: check, then act
    A->>D: SELECT key → not found
    B->>D: SELECT key → not found
    A->>P: charge card
    B->>P: charge card
    Note over P: charged twice
    end

    rect rgb(23,39,42)
    Note over A,P: Correct: claim atomically first
    A->>D: INSERT key ON CONFLICT DO NOTHING
    D-->>A: claimed
    B->>D: INSERT key ON CONFLICT DO NOTHING
    D-->>B: no rows — someone else has it
    A->>P: charge card (passing the same key)
    A->>D: UPDATE key: completed + response
    B-->>B: 409 Conflict, retry shortly
    end`,
    },
    {
      kind: 'flow',
      id: 'idempotency-lifecycle',
      title: 'The lifecycle of one idempotency key',
      caption:
        'Step through it, then look at the crash edge. The atomic claim solves concurrency; it does not solve a process dying between the external effect and the record of it, which is why reconciliation is part of the design rather than an afterthought.',
      nodes: [
        { id: 'client', label: 'Client', kind: 'client', x: 0, y: 140, detail: 'Generates one key per logical operation and reuses it for every retry. A fresh key per attempt defeats the whole mechanism and is the most common client-side bug.' },
        { id: 'claim', label: 'Atomic claim', kind: 'service', x: 190, y: 140, detail: 'A single INSERT ... ON CONFLICT DO NOTHING with the request hash. Rows returned means you own the operation; no rows means someone else does.' },
        { id: 'keys', label: 'Key store', kind: 'store', x: 190, y: 300, detail: 'key, status (in_progress / completed), request hash, stored response, lease expiry. The request hash is what stops a reused key returning the wrong operation.' },
        { id: 'work', label: 'Do the work', kind: 'service', x: 400, y: 140, detail: 'Runs only for the claim winner. For non-deterministic operations, whatever it chooses must be recorded, because a replay has to return the same choice.' },
        { id: 'ext', label: 'Payment provider', kind: 'external', x: 600, y: 60, detail: 'Pass your key as their idempotency reference. Your database transaction cannot protect an effect outside your database, so the provider has to deduplicate too.' },
        { id: 'store', label: 'Record response', kind: 'service', x: 600, y: 210, detail: 'Marks the key completed and stores the full response, so a later replay can return the created id rather than merely "done".' },
        { id: 'replay', label: 'Replay handling', kind: 'service', x: 400, y: 300, detail: 'completed → return the stored response. in_progress → 409, let the caller retry. Waiting and polling holds a connection open on work you cannot observe.' },
        { id: 'recon', label: 'Reconciliation', kind: 'service', x: 800, y: 130, detail: 'For leases that expired while in progress: ask the provider what actually happened. This is the only correct recovery when an effect may have occurred outside your transaction.' },
      ],
      edges: [
        { id: 'i1', source: 'client', target: 'claim', label: 'key + body', kind: 'sync' },
        { id: 'i2', source: 'claim', target: 'keys', label: 'insert or fail', kind: 'write' },
        { id: 'i3', source: 'claim', target: 'work', label: 'if claimed', kind: 'sync' },
        { id: 'i4', source: 'claim', target: 'replay', label: 'if not claimed', kind: 'sync' },
        { id: 'i5', source: 'work', target: 'ext', label: 'same key', kind: 'sync' },
        { id: 'i6', source: 'work', target: 'store', kind: 'sync' },
        { id: 'i7', source: 'store', target: 'keys', label: 'completed', kind: 'write' },
        { id: 'i8', source: 'replay', target: 'keys', label: 'read', kind: 'read' },
        { id: 'i9', source: 'keys', target: 'recon', label: 'lease expired', kind: 'async' },
        { id: 'i10', source: 'recon', target: 'ext', label: 'what happened?', kind: 'read' },
      ],
      steps: [
        {
          id: 'k1',
          title: 'One key per logical operation, reused across retries',
          description:
            'The key identifies what the caller is trying to achieve, not this particular attempt. Every retry carries the same key, and the request body is hashed alongside it so a carelessly reused key fails loudly instead of returning the wrong result.',
          nodes: ['client', 'claim', 'keys'],
          edges: ['i1', 'i2'],
        },
        {
          id: 'k2',
          title: 'The claim is atomic and happens before any work',
          description:
            'A single insert-or-fail statement decides the winner. This is the only place that decision can be made correctly — any check followed by a separate insert leaves a window, and 5 ms is a wide window.',
          nodes: ['claim', 'work', 'replay'],
          edges: ['i3', 'i4'],
        },
        {
          id: 'k3',
          title: 'External effects need the key too',
          description:
            'Your transaction cannot cover a card charge at a third party, so pass your key as their idempotency reference. Payment providers support this precisely because the problem has no local solution.',
          nodes: ['work', 'ext', 'store'],
          edges: ['i5', 'i6', 'i7'],
        },
        {
          id: 'k4',
          title: 'And the edge that atomicity does not fix',
          description:
            'If the process dies between charging the card and recording it, the key is stuck in progress and the caller can never get an answer. A lease expiry plus reconciliation against the provider is the recovery — guessing is not.',
          nodes: ['keys', 'recon', 'ext'],
          edges: ['i9', 'i10'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Stripe', 'PayPal'],
    body: `Two payment providers independently designed client-supplied idempotency keys, and comparing them shows which parts of the contract are essential rather than stylistic.

**Both** accept a caller-generated key on write requests, store the original response, and return that stored response on a replay of the same key. Both scope keys per account so two customers cannot collide. Both publish a retention window after which a key is forgotten.

**Both bind the key to the original request.** Sending the same key with a different body is treated as an error rather than returning the earlier result. This is the detail most home-grown implementations omit, and omitting it means a client that reuses keys carelessly silently receives the wrong operation's outcome — a bug that is nearly impossible to diagnose from either side.

**Both define concurrent-replay behaviour explicitly.** A replay arriving while the original is still executing gets a conflict response rather than being queued behind it. That is the honest answer: the server cannot know whether the in-flight request will succeed, so it declines to pretend.

The parts that differ — exact retention period, header name, status code for a conflict — are the parts that do not matter much. The parts they agree on are the contract.

Three transferable lessons:

**The key belongs to the caller, because only the caller knows what "the same operation" means.** A server cannot infer that two similar-looking requests are one intent; two genuinely separate £24.50 payments to the same merchant in the same second are legitimate. Only the client knows.

**Publishing the retention window is part of the contract.** A caller retrying after the window gets a fresh execution, and if that window is undocumented the caller cannot know when their retry stopped being safe.

**Providers offer this because the problem cannot be solved on one side alone.** A caller cannot make a remote charge idempotent, and a provider cannot know which requests are duplicates. It is a two-party protocol, which is why the same mechanism appears independently wherever money crosses a network boundary — and why your own service should offer it to *its* callers for exactly the same reason.`,
  },

  tradeoffs: {
    intro:
      'Ordered from cheapest to most general. Reach for the earlier rows first — the last row is the most powerful and the most work.',
    rows: [
      {
        option: 'Model the operation as a desired state (PUT-style)',
        whenItWins:
          'Whenever the operation genuinely is "make it be this": status changes, settings, full replacements. Idempotent with no extra machinery.',
        whenItLoses:
          'Operations that are inherently incremental — charge this amount, append this event, allocate the next available thing.',
        cost:
          'Nothing structural. Sometimes an awkward API shape when the caller only wants to change one field.',
      },
      {
        option: 'Client-generated resource identity',
        whenItWins:
          'Creates where the client can choose an id. The primary-key constraint deduplicates for free, with no extra table.',
        whenItLoses:
          'When clients cannot generate identifiers, or when the id must be server-assigned for ordering or opacity reasons.',
        cost:
          'Clients must generate collision-free ids, and a duplicate returns a conflict the client has to interpret.',
      },
      {
        option: 'A natural uniqueness constraint',
        whenItWins:
          'When a genuine business uniqueness rule exists — one invoice per order, one booking per seat per showing.',
        whenItLoses:
          'When no such rule exists. Two identical payments a second apart may both be legitimate.',
        cost:
          'A unique index, and a constraint violation the application must translate into a meaningful response.',
      },
      {
        option: 'Client-supplied idempotency keys',
        whenItWins:
          'The general mechanism. Works for any non-idempotent operation, including ones with external side effects.',
        whenItLoses:
          'Nowhere for correctness — but it is real work, and it is wasted where a desired-state model would have been idempotent for free.',
        cost:
          'A key store with atomic claim, request-hash binding, stored responses, a retention policy, and lease recovery for orphans.',
      },
      {
        option: 'Durable workflow with per-step checkpointing',
        whenItWins:
          'Multi-step operations with several external effects, where a retry must resume rather than restart.',
        whenItLoses:
          'Single-step operations, where it is far more machinery than an idempotency key.',
        cost:
          'A workflow engine or equivalent, durable state per execution, and a substantially larger operational surface.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We check whether the idempotency key exists, and if not we do the work and store it."',
      whyWeak:
        'The check and the store are separate operations, so two concurrent retries both see "not found" and both do the work. On a payment that is a double charge, and the window is milliseconds wide — which is exactly the interval a retrying client produces.',
      strongAnswer:
        '"The claim has to be atomic and happen before the work: a single `INSERT ... ON CONFLICT DO NOTHING`. If it returns a row I own the operation; if not, I either return the stored response or a 409 if the original is still in flight. Check-then-act cannot be made safe by ordering."',
    },
    {
      weakAnswer: '"The client generates a new idempotency key for each retry attempt."',
      whyWeak:
        'That is the opposite of the mechanism. The key identifies the logical operation, not the attempt, so a fresh key per attempt makes every retry a new operation and guarantees duplicates. It also looks correct in code review, which is why it survives.',
      strongAnswer:
        '"One key per logical operation, generated before the first attempt and reused for every retry of it. I would generate it where the intent is formed — not inside the retry loop — and I would make that explicit in the client library so callers cannot get it wrong by accident."',
    },
    {
      weakAnswer: '"We store the key and return 200 on a replay, so the caller knows it succeeded."',
      whyWeak:
        'The caller needs the *outcome*, not an acknowledgement. If the original response contained the created payment id, a replay returning a bare 200 leaves the caller unable to learn what was created — so it either has to query blindly or treat the operation as unresolved.',
      strongAnswer:
        '"I store the full original response alongside the key and replay it verbatim, including the created resource id and the original status code. That is what makes the retry genuinely transparent, and it matters most for non-deterministic operations where the first execution made a choice."',
    },
    {
      weakAnswer: '"Our message queue guarantees exactly-once delivery, so consumers do not need to be idempotent."',
      whyWeak:
        'No system provides exactly-once *delivery*, because an acknowledgement can always be lost. What such systems provide is at-least-once delivery plus deduplication, and that guarantee holds only inside the transactional boundary — the moment an effect leaves (an email, a charge), it is unprotected.',
      strongAnswer:
        '"Exactly-once is at-least-once delivery plus idempotent processing. Inside the broker\'s transaction that can be genuinely end-to-end, but any external effect leaves the boundary and needs its own idempotency. So consumers stay idempotent regardless of what the broker offers."',
    },
    {
      weakAnswer: '"Idempotency keys are stored for 30 days, which gives clients plenty of room."',
      whyWeak:
        'Thirty days is far longer than any legitimate retry window, so it mostly buys storage cost and a long period in which an accidentally reused key returns a stale result. It also delays the point at which a key can be safely reissued.',
      strongAnswer:
        '"Twenty-four hours covers effectively every retry scenario, and I would publish the window because a caller retrying after it gets a fresh execution and needs to know that. Longer retention costs storage and widens the window for a reused key to return an unexpected old result."',
    },
    {
      weakAnswer: '"With an atomic claim in place, the operation cannot be duplicated."',
      whyWeak:
        'The claim protects your database. If the process crashes after calling an external provider and before recording the result, the key sits in progress forever, the caller can never get an answer, and the external effect may or may not have happened.',
      strongAnswer:
        '"Atomic claim plus a lease with an expiry, and a reconciliation path for keys that expire while in progress — which for a payment means asking the provider what actually happened rather than assuming. Passing our key to the provider as their idempotency reference is what makes that recovery possible."',
    },
  ],

  flashcards: [
    {
      id: 'fc-idem-1',
      front: 'Why must callers retry, and what does that force?',
      back: 'A response can always be lost, so not retrying means silently losing operations. Retrying forces the operation to be safe to repeat — otherwise the only options are losing or duplicating.',
      topic: 'retries',
    },
    {
      id: 'fc-idem-2',
      front: 'What does idempotent mean precisely?',
      back: 'The intended effect of several identical requests is the same as for one. It says nothing about the response being identical, or the second call doing no work.',
      topic: 'idempotency',
    },
    {
      id: 'fc-idem-3',
      front: 'Which HTTP methods are idempotent, and why does the definition matter?',
      back: 'GET, HEAD, PUT and DELETE. It matters because that definition licenses proxies, meshes and client libraries to retry them automatically without asking you.',
      topic: 'idempotency',
    },
    {
      id: 'fc-idem-4',
      front: 'What is the difference between safe and idempotent?',
      back: 'Safe means no side effects at all (GET). Idempotent means side effects that do not compound on repetition (PUT, DELETE). Safe implies idempotent; the reverse is not true.',
      topic: 'idempotency',
    },
    {
      id: 'fc-idem-5',
      front: 'Why does check-then-act fail for idempotency keys?',
      back: 'Two concurrent retries both read "not found" in the window between the check and the insert, so both do the work. The claim must be a single atomic insert-or-fail before any work happens.',
      topic: 'concurrency',
    },
    {
      id: 'fc-idem-6',
      front: 'Why store a hash of the request body with the key?',
      back: 'So the same key arriving with a different body is rejected as a client bug rather than silently returning the earlier operation\'s result — a failure that is nearly undiagnosable from either side.',
      topic: 'idempotency',
    },
    {
      id: 'fc-idem-7',
      front: 'Why store the full response rather than just "done"?',
      back: 'A replay must be able to return the outcome, including a created resource id. This matters most for non-deterministic operations, where the first execution made a choice the caller needs to learn.',
      topic: 'api-design',
    },
    {
      id: 'fc-idem-8',
      front: 'What should a replay get while the original request is still in flight?',
      back: '409 Conflict. The server cannot know whether the in-flight request will succeed, and waiting means holding a connection open on work it cannot observe.',
      topic: 'concurrency',
    },
    {
      id: 'fc-idem-9',
      front: 'Why must the client generate the idempotency key rather than the server?',
      back: 'Only the caller knows which attempts are one logical operation. Two genuinely separate identical payments a second apart are legitimate, so the server cannot infer intent from similarity.',
      topic: 'idempotency',
    },
    {
      id: 'fc-idem-10',
      front: 'Is exactly-once delivery possible?',
      back: 'No. An acknowledgement can always be lost, so a sender either retries (at-least-once) or does not (at-most-once). What is called exactly-once is at-least-once delivery plus deduplication in the consumer.',
      topic: 'exactly-once',
    },
    {
      id: 'fc-idem-11',
      front: 'Where does a broker\'s exactly-once guarantee stop?',
      back: 'At the transactional boundary. Any effect that leaves the system — an email, a card charge, a write to another store — cannot join the transaction and needs its own idempotency.',
      topic: 'exactly-once',
    },
    {
      id: 'fc-idem-12',
      front: 'What does an atomic claim not protect against?',
      back: 'A crash between an external side effect and recording it. The key is stuck in progress, so you need a lease expiry plus reconciliation against the external system.',
      topic: 'concurrency',
    },
  ],

  quiz: [
    {
      id: 'q-idem-1',
      kind: 'scenario',
      prompt:
        'A payments endpoint stores idempotency keys. Under load, a small number of duplicate charges appear. The code reads: look up key; if absent, charge and then insert the key. What is the fix?',
      options: [
        { id: 'a', label: 'Claim the key with a single atomic insert-or-fail before charging' },
        { id: 'b', label: 'Wrap the lookup and the insert in a transaction with default isolation' },
        { id: 'c', label: 'Have the client wait longer before retrying' },
        { id: 'd', label: 'Add a unique index on the key column' },
      ],
      correct: ['a'],
      explanation:
        'The window between checking and inserting is where both requests proceed. Only claiming atomically before the work removes it. A transaction at default isolation does not prevent two concurrent reads both seeing absence, and a unique index alone causes the second insert to fail *after* the second charge has already happened.',
      difficulty: 'core',
      topic: 'concurrency',
    },
    {
      id: 'q-idem-2',
      kind: 'scenario',
      prompt:
        'A client library generates a fresh UUID as the idempotency key inside its retry loop. What is the effect?',
      options: [
        { id: 'a', label: 'Every retry is a new operation, so the mechanism provides no protection at all' },
        { id: 'b', label: 'Keys collide and some requests are rejected' },
        { id: 'c', label: 'The key store fills up faster but behaviour is correct' },
        { id: 'd', label: 'Only concurrent retries are affected' },
      ],
      correct: ['a'],
      explanation:
        'The key identifies the logical operation, not the attempt. A new key per attempt means the server sees each retry as a distinct operation and performs it, which is exactly the duplication the key existed to prevent. Generating the key where the intent is formed, outside the retry loop, is the fix.',
      difficulty: 'core',
      topic: 'idempotency',
    },
    {
      id: 'q-idem-3',
      kind: 'single',
      prompt: 'Which statement about HTTP idempotency is correct?',
      options: [
        { id: 'a', label: 'DELETE is idempotent even though the second call may return 404' },
        { id: 'b', label: 'Idempotent means the response is byte-identical on repetition' },
        { id: 'c', label: 'POST is idempotent if the server deduplicates internally' },
        { id: 'd', label: 'Idempotent and safe mean the same thing' },
      ],
      correct: ['a'],
      explanation:
        'Idempotency is about effect, not response — the order is gone either way. Byte-identical responses are not required. POST remains non-idempotent by definition regardless of implementation, which is why intermediaries will not retry it automatically. And safe (no side effects) is strictly stronger than idempotent.',
      difficulty: 'intro',
      topic: 'idempotency',
    },
    {
      id: 'q-idem-4',
      kind: 'scenario',
      prompt:
        'An endpoint charges a card via a third party, then records the payment. The process is killed between those two steps. The idempotency key remains `in_progress`. What is the correct recovery?',
      options: [
        { id: 'a', label: 'On lease expiry, query the provider using the same key to learn what actually happened, then record it' },
        { id: 'b', label: 'Delete the stale key so the next retry can execute cleanly' },
        { id: 'c', label: 'Mark the key failed and let the client retry' },
        { id: 'd', label: 'Mark the key completed and return success' },
      ],
      correct: ['a'],
      explanation:
        'The charge may or may not have happened, and only the provider knows. Deleting the key or marking it failed invites a second charge; marking it completed may report success for money that never moved. Passing your key to the provider as their idempotency reference is precisely what makes this query possible.',
      difficulty: 'advanced',
      topic: 'concurrency',
    },
    {
      id: 'q-idem-5',
      kind: 'scenario',
      prompt:
        'A colleague says the message broker gives exactly-once delivery, so the consumer that emails customers does not need deduplication. What is the strongest response?',
      options: [
        { id: 'a', label: 'The guarantee holds only inside the broker\'s transaction — an email leaves that boundary and can be sent twice' },
        { id: 'b', label: 'Agree, provided transactions are enabled on the producer' },
        { id: 'c', label: 'Disagree, because brokers cannot deduplicate at all' },
        { id: 'd', label: 'Agree, but only for single-partition topics' },
      ],
      correct: ['a'],
      explanation:
        'Transactional processing can make the offset commit and a database write atomic, which genuinely removes duplicates *inside* the system. Sending an email is an external effect that cannot join the transaction, so a retry after a crash sends it again. That boundary is where idempotency keys become necessary regardless of the broker.',
      difficulty: 'advanced',
      topic: 'exactly-once',
    },
    {
      id: 'q-idem-6',
      kind: 'multi',
      prompt:
        'Which of these operations are naturally idempotent without any additional mechanism? Select all that apply.',
      options: [
        { id: 'a', label: 'PUT /users/7 with a complete representation' },
        { id: 'b', label: 'PUT /orders/42/status with {"status": "cancelled"}' },
        { id: 'c', label: 'POST /accounts/9/credits with {"amount": 500}' },
        { id: 'd', label: 'POST /bookings with "assign the next available seat"' },
      ],
      correct: ['a', 'b'],
      explanation:
        'The first two describe a desired end state, so repeating them changes nothing further. Crediting an amount is incremental — twice credits twice. Assigning the next available seat is both incremental and non-deterministic, so it needs a key *and* the first execution\'s choice stored, or a replay cannot report which seat was taken.',
      difficulty: 'core',
      topic: 'idempotency',
    },
  ],

  exercises: [
    {
      id: 'ex-idem-1',
      kind: 'implement',
      title: 'Specify an idempotency layer completely',
      estimatedMinutes: 25,
      prompt: `Specify the idempotency mechanism for \`POST /transfers\`, which moves money between two accounts in your own ledger and then notifies a third-party bank API.

You must define:

1. The client-side contract: what the client generates, when, and what it reuses.
2. The key store schema, field by field, and the reason each field exists.
3. The exact sequence of operations on a first request, as numbered steps.
4. The behaviour for a sequential replay, a concurrent replay, and a replay with a mismatched body.
5. The recovery path when a process dies mid-operation, including how you decide what actually happened.
6. Retention policy and what you publish to callers.
7. One failure mode your design still does not handle, stated honestly.`,
      rubric: [
        'Client contract: one key per logical transfer, generated before the first attempt, reused for every retry, with the key created outside the retry loop.',
        'Schema includes key, status, request hash, stored response, status code, lease expiry and timestamps — with a stated reason for each.',
        'First-request sequence claims the key atomically before any work, and records the ledger movement and the key update in one transaction.',
        'Distinguishes all three replay cases: completed returns the stored response and status; in_progress returns 409; mismatched hash returns 422.',
        'Recovery uses lease expiry plus a query to the third-party bank using the same key, rather than assuming or retrying blindly.',
        'Retention window stated (around 24 hours) and published, with the consequence of retrying after it made explicit.',
        'Names a genuine residual failure mode rather than claiming completeness.',
      ],
      modelAnswer: `**1. Client-side contract**

The client generates one UUIDv4 per logical transfer, **at the moment the user confirms the transfer**, and stores it with the pending operation locally. Every retry of that transfer — including retries after a process restart — sends the same key in an \`Idempotency-Key\` header.

The key must be generated *outside* the retry loop. In our client library, the retry wrapper receives an already-built request and must not be able to mint keys, so this cannot be got wrong by accident.

Retries use exponential backoff with jitter, and only for 5xx, 429 and timeouts. A 4xx is never retried.

**2. Key store schema**

\`\`\`sql
CREATE TABLE idempotency_keys (
  key            text PRIMARY KEY,
  account_id     text NOT NULL,
  status         text NOT NULL,      -- 'in_progress' | 'completed'
  request_hash   text NOT NULL,
  response_body  jsonb,
  response_code  int,
  lease_expires_at timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX ON idempotency_keys (status, lease_expires_at);
\`\`\`

| Field | Why it exists |
| --- | --- |
| \`key\` as primary key | The uniqueness constraint is the atomic claim. No separate lock needed. |
| \`account_id\` | Keys are scoped per caller, so two customers cannot collide on a UUID or on a guessed key. |
| \`status\` | Distinguishes "still running" from "finished", which is the difference between 409 and a replayed response. |
| \`request_hash\` | Detects a key reused with a different body — a client bug that must fail loudly, not silently return the wrong transfer. |
| \`response_body\`, \`response_code\` | A replay must return the original outcome including the transfer id, not merely an acknowledgement. |
| \`lease_expires_at\` | Bounds how long an \`in_progress\` row blocks the caller, so a crashed request does not wedge the key forever. |
| Index on \`(status, lease_expires_at)\` | Lets the reconciliation job find expired in-progress rows cheaply. |

**3. First request, in order**

1. Validate the request. Invalid → 422, and **no key is claimed** (an invalid request is not an operation).
2. Claim atomically:
   \`\`\`sql
   INSERT INTO idempotency_keys (key, account_id, status, request_hash, lease_expires_at)
   VALUES ($1, $2, 'in_progress', $3, now() + interval '60 seconds')
   ON CONFLICT (key) DO NOTHING
   RETURNING key;
   \`\`\`
   No rows returned → go to step 4 (replay handling).
3. Claimed. In **one database transaction**: debit the source account, credit the destination, insert the transfer row. Commit. The ledger is now correct and durable regardless of what happens next.
4. Call the bank API, passing our key as their idempotency reference.
5. In one transaction: update the transfer with the bank reference, and set the key to \`completed\` with the response body and code. Commit.
6. Return 201 with the transfer.

The ordering matters: **the ledger commits before the external call.** If we crash after step 5 the operation is complete; if we crash between 3 and 5 the ledger shows a transfer whose bank status is unknown, which is a recoverable state. Calling the bank first would leave money moved externally with no local record — unrecoverable without reconciliation against their system alone.

**4. Replay behaviour**

| Case | Response |
| --- | --- |
| \`completed\`, hash matches | The stored \`response_code\` and \`response_body\`, verbatim |
| \`in_progress\`, lease valid, hash matches | **409 Conflict**, \`type: "request_in_progress"\`, with \`Retry-After: 2\` |
| Hash **does not** match | **422**, \`type: "idempotency_key_reused"\` — a client bug, and reporting it is more useful than guessing |
| Key not found (past retention) | Treated as a new request and executed |

The mismatched-hash case is the one most implementations omit, and it is the one that produces the most confusing incident: a client that reuses a key for a different transfer would otherwise receive the *previous* transfer's response and believe the new one succeeded.

**5. Recovery from a mid-operation crash**

A reconciliation job runs every 30 seconds over rows where \`status = 'in_progress'\` and \`lease_expires_at < now()\`. For each:

1. Look up whether a transfer row exists for that key. If not, the crash happened before step 3 — nothing moved. Delete the key row; the next retry executes cleanly.
2. If a transfer row exists, the ledger moved and the bank status is unknown. **Query the bank API using our key.**
   - The bank has it → record the reference, mark the key \`completed\`.
   - The bank does not have it → retry the bank call (safe, because we are passing the same key).
   - The bank returns an error we cannot classify → mark the transfer \`needs_review\` and alert. A human decides; the system does not guess about money.

The load-bearing point: recovery is a *query*, not an assumption. Passing our key to the bank in step 4 is what makes that query possible, and it is the reason the design works at all.

**6. Retention**

24 hours from \`created_at\`, deleted by a periodic job. Published in the API documentation: *"An idempotency key is recognised for 24 hours. A request replayed with the same key after that window is treated as a new transfer."*

24 hours comfortably exceeds any legitimate retry window, including a client that was offline overnight. Longer retention costs storage and widens the window in which an accidentally reused key returns an unexpectedly old result.

**7. What this design still does not handle**

**Two genuinely distinct transfers submitted with the same key by a buggy client.** The request-hash check catches the case where the bodies differ. If a client generates one key and reuses it for two transfers that happen to be *identical* — same accounts, same amount — the second is silently deduplicated and the user's second transfer never happens. From the server's position these are indistinguishable, because deduplicating identical requests is exactly what the mechanism is for.

The mitigation is client-side discipline, and it is worth documenting explicitly: the key must identify the *intent*, and two deliberate identical transfers are two intents needing two keys. There is no server-side fix, and pretending otherwise would be worse than naming the limit.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-idem-1',
      level: 'basic',
      question: 'What does idempotent mean, and which HTTP methods are?',
      guidance:
        'Repeating the request has the same effect as performing it once — about effect, not response. GET, HEAD, PUT, DELETE. A strong answer notes that DELETE returning 404 the second time is still idempotent, and that the definition is what licenses automatic retries by intermediaries.',
    },
    {
      id: 'iq-idem-2',
      level: 'basic',
      question: 'Why does a POST endpoint need an idempotency key?',
      guidance:
        'Because a response can be lost, so callers must retry, and POST is not repeatable. A strong answer frames it as removing the caller\'s impossible choice between duplicating and dropping — rather than as a nice-to-have for reliability.',
    },
    {
      id: 'iq-idem-3',
      level: 'intermediate',
      question: 'Walk me through implementing an idempotency key server-side.',
      guidance:
        'Atomic claim before any work, request-hash binding, stored response, defined behaviour for concurrent replay, retention window. A candidate who describes check-then-act has the bug the mechanism exists to prevent, and it is worth probing whether they see it.',
    },
    {
      id: 'iq-idem-4',
      level: 'intermediate',
      question: 'Which operations are naturally idempotent and which need help?',
      guidance:
        'Desired-state operations (PUT a full representation, set a status) are naturally idempotent. Incremental ones (credit an amount, append an event) and non-deterministic ones (allocate the next available thing) are not. A strong answer reaches for a desired-state model before reaching for keys.',
    },
    {
      id: 'iq-idem-5',
      level: 'advanced',
      question: 'Is exactly-once delivery possible? Explain.',
      guidance:
        'No: acknowledgements can be lost, so the sender either retries (at-least-once) or does not (at-most-once). What is sold as exactly-once is at-least-once plus consumer deduplication, sometimes transactional. Excellent answers identify where the guarantee stops — any effect leaving the transactional boundary.',
    },
    {
      id: 'iq-idem-6',
      level: 'advanced',
      question: 'Your service charges a card then records it, and crashes in between. How do you recover?',
      guidance:
        'Lease expiry on the in-progress key, then query the provider using the same key to learn what happened. Look for the recognition that this is a query rather than an assumption, and that passing your key to the provider is what makes it possible. Excellent answers order the local commit before the external call and explain why.',
    },
    {
      id: 'iq-idem-7',
      level: 'followup',
      question: 'What should happen if the same key arrives with a different request body?',
      guidance:
        'Reject it — 422 — because it is a client bug. Returning the stored response would silently give the caller the wrong operation\'s outcome, which is nearly undiagnosable from either side. A candidate who has not considered this has probably not stored a request hash.',
    },
    {
      id: 'iq-idem-8',
      level: 'followup',
      question: 'A replay arrives while the original is still executing. What do you return?',
      guidance:
        '409 with a Retry-After. Waiting means holding a connection open on work you cannot observe, and you cannot distinguish "still running" from "crashed". A strong answer connects this to the lease: the in-progress state must be bounded or the caller can never get an answer.',
    },
  ],

  activeLearning: [
    {
      id: 'al-idem-1',
      kind: 'modify-architecture',
      prompt:
        'The design in this lesson stores idempotency keys in the same database as the business data, which is what lets the claim and the work share a transaction. Now change one thing: the service is stateless and the key store must be Redis, because the operation writes to three different databases. What breaks, and what would you actually do?',
      discussion: `Moving the key store out of the transactional database breaks the one property the design was leaning on, and the honest answer involves giving something up.

**What breaks: the claim and the work can no longer commit atomically.**

Previously, "mark the key completed" and "insert the transfer" were one transaction, so they could not disagree. With Redis holding keys and Postgres holding data, there are two commits and therefore a window:

- Redis says completed, the write did not land → a replay returns success for work that never happened. **Worst case.**
- The write landed, Redis update failed → a replay re-executes. Duplicate.

You have reintroduced exactly the ambiguity the key was supposed to remove, one layer up.

**Second thing that breaks: Redis is not durable by default.** A key store that can lose the last few seconds of writes on failover is a key store that can forget a claim for an operation that already happened. Appending to disk on every write helps and costs latency; a replica promotion can still lose the tail.

**What I would actually do, in order of preference:**

*Option A — keep keys in one of the three databases, specifically the one holding the primary record.* If the transfer row lives in Postgres, put the key there and let it share that transaction. The other two databases become secondary effects, handled by an outbox from the primary. This preserves atomicity where it matters most and is almost always available if you look for it.

*Option B — make the key store the authority and the writes idempotent individually.* Redis claims the key, then each of the three writes is independently idempotent (upsert by a deterministic id derived from the key). A replay re-runs all three writes and they converge. This tolerates the ambiguity instead of preventing it, and it requires every write to be genuinely idempotent — which is a real constraint on the data model, not a configuration.

*Option C — Redis for the claim, a durable record for the outcome.* Use Redis only to win the race cheaply, and write the authoritative \`in_progress\` / \`completed\` record to a durable store. You get fast contention handling and durable truth, at the cost of two stores to keep roughly consistent and a reconciliation path for when they disagree.

**Which I would choose: A, and I would push back hard on the premise.** "Three databases" is usually a signal that the operation should be one durable write plus asynchronous propagation, not three synchronous writes. If the operation genuinely must touch three stores atomically, the answer is a saga or a durable workflow with per-step idempotency — not a cleverer key store. The idempotency key stops being sufficient the moment the operation has multiple independent effects, which is the last row of this lesson's trade-off table.

**Transferable:** idempotency keys are cheap when the key and the effect can commit together. Once they cannot, you are choosing between making every effect individually idempotent and adopting a durable workflow. Recognising which of those you are in is more valuable than optimising the key store.`,
    },
    {
      id: 'al-idem-2',
      kind: 'debug',
      prompt:
        'A service with correct idempotency keys reports rare duplicate orders — perhaps one in fifty thousand. The atomic claim is a single `INSERT ... ON CONFLICT DO NOTHING`. Keys are retained for 24 hours. Reads go to replicas; writes go to the primary. What are your hypotheses?',
      discussion: `The claim is correct as described, so the duplicate must come from somewhere the claim does not cover. Four hypotheses, roughly by likelihood.

**1. The client is not reusing the key.** Most likely, and cheapest to check. A retry path somewhere — a mobile app resuming after a crash, a job runner restarting, a user double-tapping — generates a new key for what is logically the same order. The server behaves perfectly and duplicates anyway, because it was asked to do two operations. Check by logging whether duplicate orders arrived with different keys: if so, the server is exonerated and the fix is client-side.

**2. Retries arriving more than 24 hours apart.** Rare by construction, and one in fifty thousand is exactly the scale of "rare". A client that was offline overnight, or a queued job retried the next day, sends the key after retention has expired. The key is gone, the request executes, duplicate. Check the time delta between the two orders — if it exceeds the retention window, this is it. The fix is either a longer window for this operation or a business-level uniqueness constraint that outlives the key.

**3. A read from a replica in the replay path.** The claim is atomic against the primary, but if the *replay* branch reads the key's status from a replica, a lagging replica may report the key as absent or still in progress when it is actually completed. Depending on how the code handles that, it could fall through to executing. Any read in an idempotency path must go to the primary — this is the classic subtle bug when a service has a default read-replica routing policy that nobody remembered applies here too.

**4. Key scoping.** If keys are scoped per account and something in the path uses the wrong account context — an admin acting on behalf of a customer, a tenant migration — the same key could claim twice under different scopes. Worth checking whether duplicates cluster around a particular access pattern.

**What I would measure, in order:**

1. **Do the duplicate orders share an idempotency key?** One query, and it splits the space in half: same key means a server-side bug, different keys means a client-side one.
2. **Time between the duplicates**, compared against the retention window.
3. **Whether any read in the idempotency path can hit a replica** — a code-path audit rather than a measurement.
4. **Whether duplicates correlate with a client version, a job type or an account type.**

**The structural improvement regardless of which it is: a business-level uniqueness constraint as a backstop.** If an order is genuinely unique per \`(customer_id, cart_id)\` or per \`(account, reference)\`, a unique index enforces that independently of keys, retention windows and client behaviour. Idempotency keys are a protocol mechanism with a time bound; a uniqueness constraint is a data invariant with none. Where a genuine business rule exists, having both means a failure in one is caught by the other.

**Transferable:** when a correct mechanism produces rare failures, the bug is usually outside the mechanism — in how it is called, how long it is remembered, or which replica answered. And a defence-in-depth invariant at the data layer is worth having precisely because it does not share any of those failure modes.`,
    },
  ],

  revision: {
    bullets: [
      'A response can always be lost, so callers must retry, so writes must be safe to repeat.',
      'Idempotent means the effect of repeating is the same as doing it once. Nothing about identical responses.',
      'GET, HEAD, PUT, DELETE are idempotent by definition — which is why intermediaries retry them without asking.',
      'Safe (no side effects) is stronger than idempotent (repeatable side effects).',
      'Prefer a desired-state model (PUT a status, PUT a representation) — idempotent for free.',
      'Client-generated resource ids let the primary key deduplicate with no extra table.',
      'A natural uniqueness constraint is cheap and precise where a genuine business rule exists.',
      'Idempotency keys are the general mechanism: the client generates one key per logical operation and reuses it for every retry.',
      'The most common client bug is generating a fresh key per attempt inside the retry loop.',
      'Claim the key atomically before any work: one INSERT ... ON CONFLICT DO NOTHING.',
      'Store a hash of the request body — a key reused with a different body must return 422, not the old result.',
      'Store the full response, so a replay returns the created id rather than a bare acknowledgement.',
      'Concurrent replay gets 409 with Retry-After. Never wait on work you cannot observe.',
      'Commit the local record before the external call, and pass your key to the provider as their reference.',
      'Atomic claim plus lease expiry plus reconciliation — a crash between an external effect and its record needs a query, not a guess.',
      'There is no exactly-once delivery: only at-least-once plus idempotent processing, and the guarantee stops at the transactional boundary.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The property that repeating an operation has the same effect as performing it once, plus the mechanisms — desired-state modelling, client-chosen ids, uniqueness constraints, idempotency keys — that provide it where it is not natural.',
    whyItExists:
      'Responses can be lost, so callers must retry to avoid silently dropping operations. Retrying is only acceptable if repetition is harmless.',
    whenToUse: [
      'Every non-idempotent write endpoint, especially anything involving money or external effects.',
      'Every message consumer, regardless of what the broker claims to guarantee.',
      'Anywhere a caller might reasonably retry after a timeout — which is everywhere.',
    ],
    whenNotToUse: [
      'Idempotency keys where a desired-state model would have been idempotent for free.',
      'A durable workflow for a single-step operation, where a key is sufficient.',
      'Long retention windows: they add storage and widen the window for a reused key to return a stale result.',
    ],
    alternatives: [
      'Desired-state (PUT-style) modelling, which removes the need for any deduplication mechanism.',
      'Client-generated identifiers, letting the primary-key constraint deduplicate.',
      'A durable workflow with per-step checkpointing, for multi-effect operations where a retry must resume rather than restart.',
    ],
    tradeoffs: [
      'Desired-state modelling buys free idempotency and sometimes forces an awkward API shape.',
      'Idempotency keys buy generality and cost a key store with atomic claim, hashes, stored responses and lease recovery.',
      'A longer retention window buys tolerance for slow retries and costs storage plus stale-replay risk.',
      'Returning 409 on concurrent replay buys honesty and costs the caller an extra round trip.',
    ],
    failureModes: [
      'Check-then-act on the key, so concurrent retries both execute.',
      'A fresh key per retry attempt, which disables the mechanism entirely.',
      'Storing only "done", so a replay cannot report the created resource.',
      'A key reused with a different body silently returning the previous result.',
      'A crash between an external effect and its record, leaving the key permanently in progress.',
      'Retries arriving after the retention window and executing as new operations.',
      'A read in the idempotency path served by a lagging replica.',
      'Assuming a broker\'s exactly-once guarantee covers effects that leave the system.',
    ],
    followUpQuestions: [
      'Is this operation naturally idempotent, and if not, why not?',
      'How is the key claimed, and is that one statement or two?',
      'What happens when the same key arrives with a different body?',
      'What does a replay return while the original is still running?',
      'How long are keys kept, and what does a caller see after that?',
      'What happens if the process dies after the external call and before recording it?',
      'Where exactly does your exactly-once guarantee stop?',
    ],
  },
});
