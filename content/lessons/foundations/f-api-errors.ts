import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-api-errors',
  title: 'Errors, status codes and partial failure',
  summary:
    'Errors are part of the contract, and the expensive ones are ambiguous: a caller who cannot tell whether the operation happened has to guess, and guessing means either duplicating work or losing it.',
  phase: 'foundations',
  module: 'apis',
  position: 10,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 35,
  tags: ['api-errors', 'status-codes', 'partial-failure', 'retries', 'api-design'],
  prerequisites: ['f-api-versioning'],
  resources: [
    {
      key: 'rfc-9457-problem-details',
      tier: 'must',
      note: 'A standard error body for HTTP APIs. Adopt the shape rather than inventing one — the value is that clients and tooling can recognise it without reading your docs.',
    },
    {
      key: 'mdn-http-status',
      tier: 'must',
      note: 'Use it as a reference for the distinction that matters: 4xx means the request was wrong, 5xx means we were. Getting that boundary right decides whether a caller retries.',
    },
    {
      key: 'google-aip-errors',
      tier: 'must',
      note: 'A production error model with a fixed status enumeration, and guidance on what belongs in a message a caller may show a user versus a detail only an engineer should see.',
    },
    {
      key: 'aws-timeouts-retries-jitter',
      tier: 'good',
      note: 'The retry half of this lesson. Read it for why an ambiguous failure is more expensive than a clear one, and why retries need budgets.',
    },
  ],

  intuition: {
    body: `There are three kinds of failure, and only two of them are cheap.

**"You asked for something wrong."** A malformed request, a missing field, a resource that does not exist, a permission the caller does not have. The client can fix it or must not retry. Unambiguous, cheap to handle.

**"We failed, and nothing happened."** The service rejected the request before doing anything — overloaded, dependency down, deliberate load shedding. The caller retries and all is well. Unambiguous, cheap.

**"Something went wrong and I cannot tell you whether it took effect."** A timeout. A connection reset mid-response. A 500 from a service that had already committed the write. This is the expensive one, and it is expensive because the caller now has to *guess*: retry and risk doing it twice, or give up and risk it never happening.

Almost everything in this lesson is about shrinking the third category. Two mechanisms do the shrinking:

**Make the failure boundary honest.** If the request was invalid, say so with a 4xx so nobody retries. If you failed before committing, say so clearly so retrying is safe. Returning 500 for a declined card teaches the caller to retry something that will never succeed; returning 200 with an error inside the body teaches them to ignore status codes entirely.

**Make the ambiguous case safe.** You cannot eliminate timeouts — the network will always be able to lose a response you already sent. What you can do is make retrying harmless, which is what idempotency keys are for. That is the next lesson, and this one is the setup for it.

The framing to keep: **an error response is an instruction to the caller.** It says retry, do not retry, or fix your request. If the caller cannot tell which, your error design has failed regardless of how neat the JSON is.`,
    analogyLimit:
      'Thinking of errors as three buckets is useful and slightly too clean: real failures cross buckets. A 429 is "you asked for too much" and also "retry later"; a 409 conflict may be permanent or may resolve on its own. The buckets tell you what the caller needs to know, not how neatly reality sorts itself.',
  },

  deepExplanation: {
    predict: {
      question:
        'A client POSTs to create a payment. The request times out after 30 seconds. The client has no other information. List everything that might have happened on the server, and say what the client can safely do.',
      answer: `**What might have happened, all consistent with the same timeout:**

1. The request never arrived. Nothing happened.
2. It arrived, was rejected by validation. Nothing happened.
3. It arrived, the payment was created and the card charged, and the response was lost on the way back.
4. It arrived, the payment was created, the card charge is still in progress.
5. It arrived, the card was charged, and then the server crashed before recording it — so money moved and no record exists.
6. It is still executing right now and will complete in ten seconds.

**What the client can safely do: nothing, on this information alone.**

That is the entire point. A timeout is not a failure — it is the *absence of information*. Retrying risks a double charge (cases 3, 4, 6). Not retrying risks the payment never happening (cases 1, 2). Both are wrong, and the client cannot distinguish.

**What makes it safe:**

*An idempotency key on the original request.* The client generated a key, sent it, and can now retry the identical request. The server recognises the key, does not repeat the work, and returns the original outcome. Case 3 returns the payment that already exists; case 1 creates it. Ambiguity resolved.

*A way to ask.* \`GET /payments?idempotencyKey=...\` or a client-supplied reference lets the caller query rather than guess. This works even without idempotent writes, and it is often the cheaper thing to add.

*Case 5 needs more than either.* If money moved and no record exists, no API design fixes it — that requires the write and the external effect to be reconciled, which means a durable record written *before* the external call and a reconciliation process afterwards. That is the payments lesson, and it is worth noticing now that some ambiguity is a state problem rather than a protocol problem.

**The design conclusion:** every non-idempotent write endpoint should accept an idempotency key, because timeouts are not preventable and a caller who cannot retry safely will either duplicate or drop.`,
    },
    body: `## Status codes: the part that changes caller behaviour

Most of the value in status codes comes from one distinction: **4xx means the request was wrong, 5xx means we were.** That single bit tells every client library, proxy and service mesh whether a retry could possibly help.

The ones worth knowing precisely, because they are the ones people get wrong:

| Code | Means | Retry? |
| --- | --- | --- |
| 400 | Malformed or semantically invalid request | No — fix it |
| 401 | Not authenticated | No — authenticate |
| 403 | Authenticated, not permitted | No |
| 404 | No such resource | No |
| 409 | Conflicts with current state | Maybe — depends why |
| 422 | Well-formed but fails business rules | No |
| 429 | Rate limited | Yes, after \`Retry-After\` |
| 500 | We broke, unexpectedly | Yes, with backoff |
| 502/504 | An upstream failed or timed out | Yes — but the request may have taken effect |
| 503 | Deliberately unavailable or shedding load | Yes, after \`Retry-After\` |

Three distinctions that matter more than the exact numbers:

**503 versus 500.** A 503 says "we chose not to serve this, come back". A 500 says "something unexpected broke". Load shedding should return 503 with a \`Retry-After\`, because that is a controlled response and the caller can cooperate. Returning 500 while shedding tells callers something is broken and invites immediate retries, which is precisely what you were shedding to avoid.

**504 is the ambiguous one.** A gateway timeout means the upstream did not answer in time — it does not mean the upstream did nothing. Callers must treat 504 as "unknown", not "failed".

**Never 200 with an error inside.** \`200 OK {"success": false}\` is the single most damaging error-design mistake, because it defeats every layer that reasons about status: retry logic, error-rate monitoring, alerting, circuit breakers and load-balancer health checks all see success. You have also taught every consumer that your status codes are meaningless, so they stop reading them.

## The error body

Standardise on one shape, ideally RFC 9457's:

\`\`\`json
{
  "type": "insufficient_stock",
  "title": "Not enough stock to fulfil this order",
  "detail": "Item sku_991 has 2 available, 5 requested",
  "instance": "req_01HXYZ",
  "errors": [
    { "field": "items[1].quantity", "code": "max_exceeded", "max": 2 }
  ]
}
\`\`\`

What each part is for, because the distinction is the design:

- **\`type\`** is the stable machine-readable code. Clients branch on this, so it is part of the contract and cannot change.
- **\`title\`** and **\`detail\`** are for humans. Deliberately *not* stable — you must be free to reword and localise them. A client branching on message text is a client coupled to your copywriting.
- **\`instance\`** is the request identifier, so a support conversation can find the exact request in your logs. This is the single field most often missing and most often needed.
- **\`errors\`** carries per-field validation failures, so a form can highlight the right inputs rather than showing one generic message.

Two rules about content:

**Return all validation failures, not the first.** A client that has to submit five times to discover five problems is a client whose users give up.

**Never leak internals.** A stack trace, a SQL fragment or an internal hostname in an error body is a security disclosure and a support burden. The \`instance\` identifier is the correct way to connect a user-visible error to internal detail: they quote the id, you look it up.

## Partial failure

Any operation touching more than one thing can half-succeed.

**Batch endpoints.** \`POST /orders/batch\` with 100 orders, 3 of which fail validation. Three choices:

- *All-or-nothing.* Simple to reason about, wasteful when one bad row rejects 99 good ones.
- *Per-item results.* Return 207 or 200 with a per-item outcome array, each carrying its own status and error. Requires the client to inspect every element, and a client that only checks the overall status will silently miss failures.
- *Reject the batch on any invalid item, before doing anything.* Validate all, apply all or none. Often the best answer, because it removes partial success entirely.

Whichever you choose, **the contract must be explicit about whether partial success is possible**, because a client written against the wrong assumption fails silently.

**Multi-step operations.** Create an order, reserve stock, charge a card, send a confirmation. If the charge succeeds and the confirmation fails, the operation is neither done nor undone. The API-level answer is to expose the *state* rather than a single success flag: return the order with \`status: "paid"\` and \`confirmationSent: false\`, and make the missing step recoverable — by a retry, a background job, or an explicit endpoint. A boolean success cannot express this, which is why compound endpoints with two side effects are a modelling problem before they are an error-handling problem.

## Retries are part of the same design

An error tells the caller whether to retry; the caller's retry behaviour then becomes your load. Three things that must be true together:

**Only retry what is retryable.** 5xx and 429, not 4xx. Retrying a 400 is pure waste and a common client bug.

**Backoff with jitter.** Exponential backoff stops a retry storm; jitter stops synchronised retries from reconverging into one. Without jitter, every client that failed at the same moment retries at the same moment, forever.

**A retry budget.** Cap retries as a fraction of total requests, so a widespread failure cannot triple your load at exactly the moment you are least able to serve it. Per-request retry limits do not prevent this; a global budget does.

And the server side of the same contract: **\`Retry-After\` on 429 and 503.** It converts guesswork into cooperation, and it is the cheapest thing you can give a well-behaved client.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'error-decision',
      title: 'What the caller needs to decide',
      caption:
        'Read this from the caller\'s side. Every branch is a different action, and the whole purpose of an error response is to put the caller on the right branch. The shaded box is the one that costs money.',
      code: `flowchart TD
    A[Request fails] --> B{Did we get a response?}
    B -->|No: timeout or reset| C["UNKNOWN<br/>The write may have taken effect"]
    B -->|Yes| D{Status class?}

    D -->|4xx| E{Which?}
    E -->|400 / 422| F[Fix the request. Never retry.]
    E -->|401 / 403| G[Authenticate or stop.]
    E -->|404| H[Resource absent. Do not retry.]
    E -->|429| I["Retry after Retry-After"]
    E -->|409| J["Depends: read state, then decide"]

    D -->|5xx| K{Which?}
    K -->|500| L[Retry with backoff and jitter]
    K -->|503| M["Retry after Retry-After — we shed on purpose"]
    K -->|502 / 504| C

    C --> N{Was an idempotency<br/>key sent?}
    N -->|Yes| O[Retry the identical request. Safe.]
    N -->|No| P["Guess: duplicate, or lose the operation"]

    style C fill:#2a1d1d,stroke:#b8383b
    style P fill:#2a1d1d,stroke:#b8383b
    style O fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'partial-failure',
      title: 'A compound operation that half-succeeds',
      caption:
        'Step through it. The failure at step 4 is not recoverable by a status code — the interesting decision is what the resource looks like afterwards, and whether the missing step is discoverable and repeatable.',
      nodes: [
        { id: 'client', label: 'Client', kind: 'client', x: 0, y: 130, detail: 'Sent one request expecting one answer. Whatever happens, it needs to know what state the world is in — not merely whether the call succeeded.' },
        { id: 'api', label: 'Order API', kind: 'service', x: 180, y: 130, detail: 'Owns the compound operation. Its response contract is the design decision: a boolean cannot express "order created, payment taken, confirmation not sent".' },
        { id: 'order', label: 'Create order', kind: 'store', x: 380, y: 20, detail: 'Succeeded. The order exists and has an id, so the operation is not undoable by simply returning an error.' },
        { id: 'stock', label: 'Reserve stock', kind: 'service', x: 380, y: 110, detail: 'Succeeded. Stock is held, which means a failure downstream leaves inventory committed to an order that may never complete.' },
        { id: 'pay', label: 'Charge card', kind: 'external', x: 380, y: 200, detail: 'Succeeded, against a third party. This is the step that cannot be rolled back — only compensated by an explicit refund.' },
        { id: 'notify', label: 'Send confirmation', kind: 'queue', x: 380, y: 290, detail: 'Failed. The least important step, and the one that determines the naive response: a boolean success flag would report failure for an operation that mostly worked.' },
        { id: 'state', label: 'Order state', kind: 'store', x: 590, y: 130, detail: 'The honest answer: return the resource with per-step status so the client knows exactly what happened and what is outstanding.' },
        { id: 'job', label: 'Recovery worker', kind: 'service', x: 590, y: 290, detail: 'Retries the outstanding step asynchronously. This is what makes partial success acceptable rather than permanent — without it, the gap stays open forever.' },
      ],
      edges: [
        { id: 'f1', source: 'client', target: 'api', kind: 'sync' },
        { id: 'f2', source: 'api', target: 'order', kind: 'write' },
        { id: 'f3', source: 'api', target: 'stock', kind: 'sync' },
        { id: 'f4', source: 'api', target: 'pay', kind: 'sync' },
        { id: 'f5', source: 'api', target: 'notify', kind: 'async' },
        { id: 'f6', source: 'api', target: 'state', kind: 'write' },
        { id: 'f7', source: 'job', target: 'notify', label: 'retry', kind: 'async' },
        { id: 'f8', source: 'state', target: 'job', label: 'outstanding', kind: 'read' },
      ],
      steps: [
        {
          id: 'e1',
          title: 'Three steps succeed and one fails',
          description:
            'The order exists, stock is held, and money has moved. Only the confirmation failed. Any response that reduces this to a single boolean throws away everything the client needs to know.',
          nodes: ['client', 'api', 'order', 'stock', 'pay', 'notify'],
          edges: ['f1', 'f2', 'f3', 'f4', 'f5'],
        },
        {
          id: 'e2',
          title: 'Returning 500 is actively harmful here',
          description:
            'A 500 tells the caller to retry, and retrying creates a second order and a second charge. The operation largely succeeded — reporting it as a server failure converts a minor gap into a duplicate payment.',
          nodes: ['api', 'notify'],
          edges: ['f5'],
        },
        {
          id: 'e3',
          title: 'Return the state, not a verdict',
          description:
            'Respond 201 with the order and per-step status: paid true, confirmation pending. The client can render something correct, and the outstanding work is explicit rather than hidden inside an error.',
          nodes: ['api', 'state'],
          edges: ['f6'],
        },
        {
          id: 'e4',
          title: 'And make the gap close by itself',
          description:
            'A worker picks up outstanding steps and retries them. Without this, "partial success" is a permanent inconsistency dressed up as a status field — which is worse than an error, because nobody is watching it.',
          nodes: ['state', 'job', 'notify'],
          edges: ['f8', 'f7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Stripe', 'Google Cloud APIs'],
    body: `Two published error models agree on the decisions that matter, which is a useful signal about which decisions those are.

**Stripe's API** distinguishes error *types* — a card decline is a different type from an invalid request, which is different from an internal error — and pairs each with a stable machine-readable code plus a human message. Critically, a declined card is not a server error. The request was well-formed and the operation legitimately did not succeed, so it returns a 4xx-class outcome with a specific decline code. A caller that retried a decline as though it were a transient failure would retry forever against a card that will never authorise, and the status code is what prevents that.

**Google's error model** goes further on structure: a fixed enumeration of status codes shared across every API, with defined mappings to HTTP, plus a details array carrying typed additional information. The value of a *fixed* enumeration is that a client library can handle every error uniformly without knowing which service produced it — one error-handling path across hundreds of APIs.

Both agree on three things worth adopting:

**A stable code, separate from the message.** The code is contract; the message is copy. Conflating them means either you can never reword an error, or clients break when you do.

**A request identifier in every error.** It is the only practical bridge between a user saying "it failed" and an engineer finding the request. Cheap to add, and the thing most APIs are missing when they need it.

**Client-visible versus internal detail, separated deliberately.** Some information helps the caller act; some only helps you debug and would be a disclosure if published. Making that a structural distinction rather than a judgement call per endpoint is what keeps stack traces out of production responses.

The transferable point: **error format is part of the public contract and therefore worth deciding once, centrally.** A team that lets each endpoint invent its own error shape has published dozens of contracts by accident, and every client integrating with them writes dozens of error-handling paths. Specifying it before the second endpoint exists costs an afternoon; retrofitting it across a live surface costs a version.`,
  },

  tradeoffs: {
    intro:
      'The decisions here are about how much the caller is told and how much work you do to make failures unambiguous. Rows are ordered from least to most effort.',
    rows: [
      {
        option: 'Status code plus a plain message',
        whenItWins:
          'Internal services with owned callers, where the human message is read by the engineer who wrote both sides.',
        whenItLoses:
          'As soon as a client must branch programmatically, or a form needs to highlight specific fields.',
        cost:
          'Clients end up parsing message strings, which couples them to your wording and breaks silently when you reword.',
      },
      {
        option: 'A standard structured body with stable codes',
        whenItWins:
          'Almost always. Clients branch on codes, forms highlight fields, and support can trace a request by identifier.',
        whenItLoses:
          'Nowhere meaningful — the only cost is deciding the shape once, before the second endpoint exists.',
        cost:
          'The codes become permanent contract, so they must be chosen with the same care as field names.',
      },
      {
        option: 'All-or-nothing batch semantics',
        whenItWins:
          'When partial application would leave the caller in a state they cannot reason about, and when validating everything up front is cheap.',
        whenItLoses:
          'Large batches where one bad item wastes the work of hundreds of good ones.',
        cost:
          'Wasted work on rejection, and callers must resubmit whole batches after fixing one item.',
      },
      {
        option: 'Per-item batch results',
        whenItWins:
          'Large batches of independent items, where rejecting everything for one bad row is unacceptable.',
        whenItLoses:
          'When clients check only the overall status — then failures are silently ignored, which is worse than rejection.',
        cost:
          'A more complex contract, and the near-certainty that some client will not inspect every item.',
      },
      {
        option: 'Idempotency keys on every write',
        whenItWins:
          'Any non-idempotent write, because timeouts are not preventable and a caller who cannot retry safely will duplicate or drop.',
        whenItLoses:
          'Never for correctness — but it is real work: key storage, a dedup window, and returning the original response on replay.',
        cost:
          'A stored record per key with a retention policy, and the discipline to make every write path honour it.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We always return 200 with a `success` boolean in the body, so clients only need one code path."',
      whyWeak:
        'It defeats every layer that reasons about status codes: client retry logic, error-rate metrics, alerting, circuit breakers and load-balancer health checks all see success. Your dashboards show zero errors during an outage, and you have taught consumers that your status codes carry no information.',
      strongAnswer:
        '"Status codes are the interface every intermediary already understands, so I would use them: 4xx when the request was wrong, 5xx when we were, with a structured body carrying a stable code. That way retry logic, monitoring and circuit breakers all work without any consumer-specific configuration."',
    },
    {
      weakAnswer: '"A declined card returns 500, because the payment failed."',
      whyWeak:
        'A decline is not a server failure — the request was well-formed and the operation legitimately did not succeed. Returning 500 tells every client library to retry, so they retry a card that will never authorise, generating load and possibly repeated authorisation attempts against the customer.',
      strongAnswer:
        '"A decline is a 4xx-class outcome with a specific code, because the request was valid and the answer is genuinely no. 5xx is reserved for us failing unexpectedly. That distinction is what stops clients retrying something that cannot succeed."',
    },
    {
      weakAnswer: '"On a timeout the client retries the request. That is standard practice."',
      whyWeak:
        'A timeout means "no information", not "it failed". The write may have committed and the response been lost. Retrying a non-idempotent write on a timeout is how duplicate charges and duplicate orders happen — and it looks like correct client behaviour, which is why it survives review.',
      strongAnswer:
        '"Retrying on a timeout is only safe if the operation is idempotent. I would have the client send an idempotency key with every write, so the server can recognise the retry and return the original outcome. Failing that, a way to query by a client-supplied reference — but the key is the cheaper mechanism."',
    },
    {
      weakAnswer: '"Validation returns the first error it finds, which keeps the response simple."',
      whyWeak:
        'A user with five invalid fields submits five times to discover five problems, and most give up before the third. It also makes automated clients iterate needlessly. The simplicity is on your side of the boundary and the cost is on theirs.',
      strongAnswer:
        '"I would validate everything and return all failures at once, each with a field path and a stable code, so a form can highlight every problem in one pass. The response is slightly more complex and it removes several round trips and most of the frustration."',
    },
    {
      weakAnswer: '"The error body includes the exception message and stack trace so clients can report issues accurately."',
      whyWeak:
        'It is a security disclosure — internal hostnames, file paths, library versions, sometimes SQL — and it is not actionable for the caller anyway. It also couples them to your internals, so a refactor changes what they see.',
      strongAnswer:
        '"I would return a stable code, a human-readable message and a request identifier. The identifier is how a support conversation reaches the internal detail: the user quotes it, we look it up. Stack traces go to our logs, never to a response body."',
    },
    {
      weakAnswer: '"The batch endpoint returns per-item results, so partial failure is handled."',
      whyWeak:
        'Returning per-item results handles partial failure only if the client inspects every item. Many will check the overall status, see success, and silently discard the failures — which is worse than an outright rejection because nobody notices.',
      strongAnswer:
        '"Per-item results only work if clients read them, so I would make the overall status reflect that something failed — a 207 rather than a 200 — and document that clients must inspect each item. Where the items are cheap to validate, I would prefer validating everything and rejecting the batch, because it removes the failure mode instead of documenting it."',
    },
  ],

  flashcards: [
    {
      id: 'fc-err-1',
      front: 'What are the three kinds of failure, and which is expensive?',
      back: 'The request was wrong (4xx), we failed and nothing happened (clear 5xx), and unknown — a timeout where the write may have taken effect. The third is expensive because the caller must guess between duplicating and dropping.',
      topic: 'partial-failure',
    },
    {
      id: 'fc-err-2',
      front: 'What is the one bit of information a status code must carry correctly?',
      back: 'Whether the request was wrong (4xx) or the service was (5xx). That single distinction tells every client, proxy and mesh whether a retry could possibly help.',
      topic: 'status-codes',
    },
    {
      id: 'fc-err-3',
      front: 'Why should load shedding return 503 rather than 500?',
      back: '503 says "we chose not to serve this, come back after Retry-After", which the caller can cooperate with. 500 says something broke unexpectedly and invites immediate retries — exactly the load you were shedding.',
      topic: 'status-codes',
    },
    {
      id: 'fc-err-4',
      front: 'Why must a caller treat 504 as unknown rather than failed?',
      back: 'A gateway timeout means the upstream did not answer in time, not that it did nothing. The operation may have committed and the response been lost.',
      topic: 'partial-failure',
    },
    {
      id: 'fc-err-5',
      front: 'What is wrong with returning 200 and a success flag in the body?',
      back: 'It defeats retry logic, error-rate metrics, alerting, circuit breakers and health checks, all of which read status codes. It also teaches consumers your status codes mean nothing.',
      topic: 'status-codes',
    },
    {
      id: 'fc-err-6',
      front: 'Which parts of an error body are contract and which are not?',
      back: 'The machine-readable code is contract and cannot change. Titles and messages are deliberately unstable so you can reword and localise. A client branching on message text is coupled to your copywriting.',
      topic: 'api-errors',
    },
    {
      id: 'fc-err-7',
      front: 'Why is a request identifier the most important field in an error body?',
      back: 'It is the only practical bridge between a user reporting a failure and an engineer finding the request, and it lets you keep internal detail out of the response entirely.',
      topic: 'api-errors',
    },
    {
      id: 'fc-err-8',
      front: 'Why is returning 500 for a partially successful compound operation harmful?',
      back: 'It instructs the caller to retry, and retrying recreates the parts that already succeeded — duplicate orders, duplicate charges. Return the resource state with per-step status instead.',
      topic: 'partial-failure',
    },
    {
      id: 'fc-err-9',
      front: 'What are the three things that must be true together about retries?',
      back: 'Retry only retryable classes (5xx, 429, not 4xx); backoff with jitter so retries do not reconverge; and a global retry budget so a widespread failure cannot multiply your load.',
      topic: 'retries',
    },
    {
      id: 'fc-err-10',
      front: 'What is the risk of per-item batch results?',
      back: 'They only work if clients inspect every item. A client that checks only the overall status silently discards failures, which is worse than a rejection because nobody notices.',
      topic: 'partial-failure',
    },
    {
      id: 'fc-err-11',
      front: 'Why should validation return all failures rather than the first?',
      back: 'Otherwise a user with five invalid fields submits five times to discover five problems. The simplicity is on the server side and the cost is entirely on the caller.',
      topic: 'api-design',
    },
  ],

  quiz: [
    {
      id: 'q-err-1',
      kind: 'scenario',
      prompt:
        'A payments API returns 500 for declined cards. Support reports that some customers see several authorisation attempts on their statement for one purchase. What is the mechanism?',
      options: [
        { id: 'a', label: 'Client libraries treat 5xx as retryable, so they retry a decline that will never succeed' },
        { id: 'b', label: 'The payment processor is duplicating the authorisation internally' },
        { id: 'c', label: 'The client is missing an idempotency key' },
        { id: 'd', label: 'A load balancer is replaying the request to a second instance' },
      ],
      correct: ['a'],
      explanation:
        'A decline is a valid request with a negative answer, so it belongs in the 4xx class. Labelling it 5xx tells every retry layer that the failure is transient, and each retry produces another authorisation attempt. An idempotency key would reduce the damage but the root cause is the wrong status class.',
      difficulty: 'core',
      topic: 'status-codes',
    },
    {
      id: 'q-err-2',
      kind: 'scenario',
      prompt:
        'A service returns `200 OK` with `{"ok": false, "error": "..."}` for all failures. During a two-hour outage, the on-call engineer sees no alerts. Why?',
      options: [
        { id: 'a', label: 'Error-rate monitoring, alerting, circuit breakers and health checks all read status codes, and every response was a success' },
        { id: 'b', label: 'The alerting thresholds were set too high' },
        { id: 'c', label: 'The logs were not being shipped during the outage' },
        { id: 'd', label: 'Clients were caching the successful responses' },
      ],
      correct: ['a'],
      explanation:
        'This is the compounding cost of 200-with-an-error. Every layer that reasons about failure — metrics, alerts, breakers, load-balancer health — sees success, so an outage is invisible to the entire operational stack. Threshold tuning cannot help when the signal was never emitted.',
      difficulty: 'core',
      topic: 'status-codes',
    },
    {
      id: 'q-err-3',
      kind: 'single',
      prompt: 'A client receives 504 Gateway Timeout on a POST that creates a resource. What is the correct interpretation?',
      options: [
        { id: 'a', label: 'Unknown — the resource may or may not have been created' },
        { id: 'b', label: 'The request failed and nothing was created' },
        { id: 'c', label: 'The request was invalid and must be corrected' },
        { id: 'd', label: 'The resource was created but the response was truncated' },
      ],
      correct: ['a'],
      explanation:
        'A gateway timeout says the upstream did not respond in time. It carries no information about whether the upstream did the work. Treating it as failure risks losing the operation; treating it as success risks acting on something that never happened. Only an idempotency key or a query mechanism resolves it.',
      difficulty: 'intro',
      topic: 'partial-failure',
    },
    {
      id: 'q-err-4',
      kind: 'scenario',
      prompt:
        'An endpoint creates an order, charges a card and sends a confirmation email. The email provider is down. What should the response be?',
      options: [
        { id: 'a', label: '201 with the order and per-step status showing the confirmation as pending, plus a worker that retries it' },
        { id: 'b', label: '500, because the operation did not fully complete' },
        { id: 'c', label: '200 with a warning field describing the email failure' },
        { id: 'd', label: '502, because an upstream dependency failed' },
      ],
      correct: ['a'],
      explanation:
        'The order exists and money has moved, so any error status invites a retry that duplicates both. Returning the resource state lets the client render something correct, and making the outstanding step explicit plus retried asynchronously is what stops partial success becoming a permanent gap. A warning field with a 200 is closer but leaves the recovery undefined.',
      difficulty: 'advanced',
      topic: 'partial-failure',
    },
    {
      id: 'q-err-5',
      kind: 'scenario',
      prompt:
        'A dependency starts failing and your service returns 500. Total inbound request volume triples within a minute even though user traffic is flat. What is happening, and what would have prevented it?',
      options: [
        { id: 'a', label: 'Clients are retrying without jitter or a retry budget, so failures multiply load exactly when capacity is lowest' },
        { id: 'b', label: 'The load balancer is duplicating requests across instances' },
        { id: 'c', label: 'Users are refreshing manually' },
        { id: 'd', label: 'Connection pooling has been exhausted, causing reconnections' },
      ],
      correct: ['a'],
      explanation:
        'Retries are a load amplifier. Without jitter, clients that failed together retry together; without a global budget, each client\'s modest per-request retry limit still triples aggregate volume. Returning 503 with Retry-After during shedding lets well-behaved clients cooperate instead of guessing.',
      difficulty: 'advanced',
      topic: 'retries',
    },
    {
      id: 'q-err-6',
      kind: 'multi',
      prompt:
        'Which of these belong in an error response as stable, machine-consumable values? Select all that apply.',
      options: [
        { id: 'a', label: 'A code identifying the error class' },
        { id: 'b', label: 'Per-field validation failures with field paths' },
        { id: 'c', label: 'A request identifier for log correlation' },
        { id: 'd', label: 'The exception message and stack trace' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Codes, field paths and the request identifier are consumed programmatically and must be stable. A stack trace is a security disclosure, is not actionable for the caller, and couples them to internals that will change — the request identifier is the correct bridge to that detail.',
      difficulty: 'core',
      topic: 'api-errors',
    },
  ],

  exercises: [
    {
      id: 'ex-err-1',
      kind: 'debug',
      title: 'Fix an error contract that is causing real incidents',
      estimatedMinutes: 20,
      prompt: `A booking API in production has these behaviours, all observed:

1. Every response is \`200 OK\`. Failures carry \`{"status": "error", "message": "..."}\`.
2. A sold-out event returns \`{"status": "error", "message": "No seats available"}\`.
3. Database connection failures return the same shape with \`"message": "could not connect to db-primary-3.internal:5432"\`.
4. Validation returns the first invalid field only.
5. On timeout, the official client library retries three times immediately.
6. \`POST /bookings/batch\` accepts 200 bookings and returns \`{"created": 187}\` with no detail about the other 13.

Reported incidents: duplicate bookings during a network blip; an outage where no alerts fired; a partner unable to work out why 13 of 200 bookings vanished.

Produce: the root cause for each incident, the corrected contract, and the order you would ship the fixes in with justification.`,
      rubric: [
        'Links duplicate bookings to behaviours 1 and 5: immediate retries on a timeout with no idempotency key and no status-code signal.',
        'Links the silent outage to behaviour 1: monitoring, alerting and circuit breakers all read status codes and saw success.',
        'Links the vanished 13 to behaviour 6: an aggregate count with no per-item outcomes, so failures are undiscoverable.',
        'Identifies behaviour 3 as a security disclosure and prescribes a request identifier instead.',
        'Corrects the status classes: sold-out is 4xx (409 or 422), database failure is 503 or 500, timeout stays ambiguous.',
        'Prescribes idempotency keys plus backoff with jitter, and notes that the client library change and the server change are separable.',
        'Orders the fixes with justification — status codes first, because they unblock monitoring and correct retry behaviour simultaneously.',
      ],
      modelAnswer: `**Incident 1 — duplicate bookings during a network blip**

*Root cause: behaviours 1 and 5 together.* The client retries immediately three times on timeout. Because the request is a non-idempotent create with no idempotency key, each retry that reaches the server creates another booking. Immediate retries with no jitter make this maximally likely during exactly the network conditions that caused the timeout.

*Fix, two parts:*
- **Server:** accept an \`Idempotency-Key\` header on \`POST /bookings\`. Store the key with the response for 24 hours; on replay, return the original response rather than creating a second booking.
- **Client:** generate a key per logical operation (not per attempt), and retry with exponential backoff plus jitter rather than immediately.

Note these are separable: the server change alone fixes correctness for any client that sends a key, and the client change alone reduces the blast radius. Ship the server side first, since it is the half that protects every caller.

**Incident 2 — an outage with no alerts**

*Root cause: behaviour 1.* Everything returns 200. Error-rate monitoring, alerting rules, circuit breakers and load-balancer health checks all read status codes, so the entire operational stack saw a healthy service throughout.

*Fix:* real status codes.

| Situation | Now | Correct |
| --- | --- | --- |
| Sold out | 200 | **409** with \`type: "no_seats_available"\` |
| Invalid field | 200 | **422** with all field errors |
| Not authenticated | 200 | **401** |
| Database unreachable | 200 | **503** with \`Retry-After\` if shedding, else **500** |
| Rate limited | 200 | **429** with \`Retry-After\` |

Sold-out as 409 rather than 500 matters specifically: it stops clients retrying an event that will never have seats.

**Incident 3 — 13 vanished bookings**

*Root cause: behaviour 6.* \`{"created": 187}\` tells the partner that 13 did not happen and nothing about which or why. There is no way to identify, fix and resubmit them.

*Fix:* per-item outcomes, and a status that reflects partial failure.

\`\`\`
207 Multi-Status
{
  "results": [
    { "index": 0, "status": "created", "id": "bkg_..." },
    { "index": 7, "status": "failed", "type": "no_seats_available",
      "detail": "Event evt_88 has 0 seats remaining" }
  ]
}
\`\`\`

A 207 rather than 200 is deliberate: a client that only checks the overall status at least learns that something is different. And I would document that clients must inspect every result.

Given seats are cheap to check, I would also offer an all-or-nothing mode — validate all 200 first, apply all or none — because that removes the failure mode rather than documenting it.

**Behaviour 3 — the leaked internal hostname**

Not linked to a reported incident, and I would fix it anyway: \`db-primary-3.internal:5432\` discloses internal topology and is useless to the caller. Replace with a stable code, a generic message, and an \`instance\` request identifier. The partner quotes the id; we look it up.

**Behaviour 4 — first-error-only validation**

Return all failures with field paths and stable codes. It is a small change and it removes several round trips per failed submission.

**Shipping order**

1. **Real status codes.** One change that fixes the invisible-outage problem *and* corrects retry behaviour across every existing client, because their libraries already handle 4xx and 5xx properly. Highest value per unit of work, and it makes the remaining problems observable.
2. **Idempotency keys on the server.** Correctness fix for the duplicate-booking incident, effective for any client that adopts it, and a prerequisite for safely encouraging retries.
3. **Per-item batch results with 207.** Unblocks the partner who currently cannot diagnose anything. Third rather than first only because it affects one integration path rather than all of them.
4. **Structured error bodies with request identifiers**, replacing the leaked internals. Additive and low risk.
5. **Client library: backoff with jitter and key generation.** Last because it requires consumers to upgrade, and by this point the server no longer depends on them doing so.

The ordering principle: fix what makes failures *visible* first, then what makes them *safe*, then what makes them *diagnosable* — and put changes requiring consumer action last.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-err-1',
      level: 'basic',
      question: 'How do you decide between a 4xx and a 5xx status code?',
      guidance:
        'Was the request wrong, or were we? A strong answer immediately connects it to behaviour: 4xx means do not retry, 5xx means a retry may help, and every client library and mesh depends on that. Look for the observation that a declined card is 4xx, not 500.',
    },
    {
      id: 'iq-err-2',
      level: 'basic',
      question: 'What goes in an error response body?',
      guidance:
        'A stable machine-readable code, a human message that is explicitly not stable, per-field validation detail, and a request identifier. A strong answer separates contract from copy and explains why a client branching on message text is a problem.',
    },
    {
      id: 'iq-err-3',
      level: 'intermediate',
      question: 'A client times out on a POST. What should it do?',
      guidance:
        'Recognise that a timeout is absence of information, not failure. Safe retry requires an idempotency key or a way to query by a client-supplied reference. A candidate who says "retry" without qualification has just described how duplicate charges happen.',
    },
    {
      id: 'iq-err-4',
      level: 'intermediate',
      question: 'How would you design a batch endpoint that can partially fail?',
      guidance:
        'Either validate everything and apply all-or-nothing, or return per-item results with a status that signals partial failure. A strong answer notes the failure mode of per-item results — clients that check only the overall status silently drop failures — and prefers removing the mode where validation is cheap.',
    },
    {
      id: 'iq-err-5',
      level: 'advanced',
      question: 'A dependency fails and your inbound traffic triples. Explain and fix.',
      guidance:
        'Retries as a load amplifier: no jitter means synchronised retries, no global budget means per-client limits still multiply aggregate load. Fixes include jittered exponential backoff, a retry budget as a fraction of traffic, and 503 with Retry-After so clients cooperate rather than guess.',
    },
    {
      id: 'iq-err-6',
      level: 'advanced',
      question: 'An endpoint charges a card and then fails to send a confirmation. What do you return?',
      guidance:
        'Not an error — the money moved, so an error invites a duplicating retry. Return the resource with per-step state and make the outstanding step recoverable by a worker. Excellent answers observe that this is a modelling problem first: a compound operation with two side effects has no single correct status.',
    },
    {
      id: 'iq-err-7',
      level: 'followup',
      question: 'You said never return 200 with an error. Is there any case where it is right?',
      guidance:
        'Genuine edge cases exist — a transport that cannot carry status codes, or a batch where the operation as a whole succeeded and individual items did not (and even then 207 is better). A strong answer concedes narrowly, insists the aggregate status must still signal partial failure, and does not use the exception to defend the general pattern.',
    },
    {
      id: 'iq-err-8',
      level: 'followup',
      question: 'How do you keep error codes stable when the implementation changes?',
      guidance:
        'Treat codes as contract: define them centrally, never repurpose one, add new ones rather than redefining, and cover them by tests. A strong answer notes that mapping internal exceptions to public codes explicitly — rather than deriving codes from exception class names — is what stops a refactor changing the public contract.',
    },
  ],

  activeLearning: [
    {
      id: 'al-err-1',
      kind: 'what-changes-if',
      prompt:
        'Everything here assumed synchronous HTTP where the caller waits for an answer. Now change it: the operation is submitted to a queue and processed later, so the API returns 202 Accepted immediately. Where do errors go, and what new problem appears?',
      discussion: `The status code stops carrying the outcome, and that single change relocates every part of the error contract.

**What 202 actually means.** "I have accepted responsibility for this work." It says the request was well-formed and durably recorded — nothing about whether the work will succeed. So *validation* errors still belong at submission time as 4xx, because they are knowable immediately. Everything else moves.

**Where errors go instead: the resource.** The submission returns an identifier, and the outcome lives on a resource the caller can read:

\`\`\`
POST /exports        → 202 { id: "exp_7f3a", status: "queued" }
GET  /exports/exp_7f3a → { status: "failed", type: "source_unavailable",
                           detail: "...", attempts: 3, nextAttemptAt: null }
\`\`\`

The error contract is now a *state machine on a resource* rather than a response body. Same fields — stable code, human message, request identifier — different location.

**How the caller finds out.** Three options, and the choice is a familiar one: polling (simple, adds latency and load), a webhook (push, and now you own delivery guarantees and the caller's endpoint being down), or a stream. Notice this is the same transport decision as the real-time lesson, arrived at from the error side.

**The new problem: retries have moved inside your system, and so has the ambiguity.**

Previously the caller decided whether to retry. Now you do, and that means you own decisions the caller used to make:

- **How many attempts, with what backoff?** The caller cannot see this and cannot influence it, so it must be exposed on the resource — \`attempts\`, \`nextAttemptAt\` — or the caller cannot tell "failed" from "will try again".
- **Which failures are retryable?** A source being temporarily unavailable is; a malformed source file is not. Retrying a permanent failure fifty times burns capacity and delays everything behind it.
- **Where do permanent failures go?** A dead-letter queue, and *someone has to look at it*. A DLQ nobody monitors is a silent data-loss mechanism, and this is the most common way asynchronous designs fail in practice.
- **Duplicate execution.** The queue delivers at least once, so the worker may run twice. The ambiguity did not disappear — it moved from the caller's retry decision to your consumer's idempotency. Which means the worker needs the same idempotency discipline the HTTP endpoint needed.

**The subtler cost: the caller has lost the ability to reason about time.** Synchronously, a 30-second timeout bounds how long the caller waits. Asynchronously, "queued" could mean five seconds or five hours, and there is no bound unless you publish one. A caller building a user experience on top needs either a service-level expectation or a way to cancel.

**Transferable:** moving work behind a queue does not remove failure handling, it relocates it — from a status code the caller reads to a state machine you must expose, plus retry policy, dead-letter monitoring and consumer idempotency that you now own. Async is a decision to take on error handling, not to avoid it.`,
    },
    {
      id: 'al-err-2',
      kind: 'debug',
      prompt:
        'A service reports a 0.02% error rate and healthy dashboards. A partner insists roughly 3% of their requests fail. Both are looking at real data. What are the possible explanations, and what single measurement would distinguish them?',
      discussion: `Both being right means the failures are happening somewhere neither dashboard covers, or are being classified differently at each end. Four candidate explanations, and one measurement separates them.

**1. Failures that never reach the service.** Connection failures, TLS errors, DNS problems, requests rejected at a load balancer or WAF. The service never sees them, so its error rate cannot include them. This is the most common answer, and it is why server-side error rate is structurally incapable of measuring what a client experiences.

**2. Timeouts counted differently.** The partner's client times out at 5 seconds; the service completes in 8 and records a success. From the service's view the request succeeded; from the partner's it failed. **Both records are accurate and they disagree**, which is exactly the reported situation.

**3. 200-with-an-error, or an equivalent.** If any code path returns a success status with a failure inside — even one endpoint, even for one condition — the service's error rate undercounts by exactly those. Worth checking before anything else because it is cheap to check.

**4. The partner's definition of failure is broader.** Perhaps they count a 429 as a failure. If they are being rate limited at 3%, that is a working rate limiter and a partner who needs a higher quota — a business conversation, not an incident.

**The single most distinguishing measurement: client-side error rate broken down by failure class, correlated with server-side outcomes by request identifier.**

Concretely: ask the partner for their failures grouped by class — connection error, timeout, 4xx, 5xx — with request identifiers where they have them.

- Mostly connection errors and timeouts with **no** matching server-side record → explanation 1.
- Timeouts **with** matching successful server-side records → explanation 2, and the fix is aligning the timeout budget with actual p99, not fixing an error.
- 4xx-heavy, dominated by 429 → explanation 4.
- Failures that the server recorded as successes → explanation 3.

**The structural fix, regardless of which it is: emit a request identifier on every response, success or failure, and have the partner log it.** Without a shared identifier, this conversation is two parties comparing aggregate percentages and cannot converge. With one, it is a join.

**The transferable lesson.** Server-side error rate measures a service's opinion of itself. It cannot see requests that never arrived, and it disagrees with clients about timeouts by construction. Any service with external consumers needs a client-side signal — synthetic probes, SDK telemetry, or partner-reported data keyed on a shared identifier — or its dashboards will be reassuring during a real problem.`,
    },
  ],

  revision: {
    bullets: [
      'Three failure kinds: request was wrong, we failed and nothing happened, and unknown. The third is the expensive one.',
      'An error response is an instruction: retry, do not retry, or fix your request.',
      '4xx means the request was wrong, 5xx means we were. That bit drives every retry layer.',
      'A declined card is 4xx, not 500 — otherwise clients retry something that will never succeed.',
      '503 with Retry-After for deliberate shedding; 500 means something broke unexpectedly.',
      '504 means unknown, not failed. The upstream may have committed and lost the response.',
      'Never return 200 with an error inside: it blinds metrics, alerts, breakers and health checks simultaneously.',
      'Error body: stable machine code (contract), human message (deliberately unstable), per-field detail, request identifier.',
      'Never leak stack traces, hostnames or SQL. The request identifier is the bridge to internal detail.',
      'Return all validation failures, not the first.',
      'Batch endpoints: validate-all-then-apply removes partial failure; per-item results document it and rely on clients reading them.',
      'A partially succeeded compound operation must return state, not an error — an error invites a duplicating retry.',
      'Make the outstanding step recoverable by a worker, or partial success is a permanent gap nobody is watching.',
      'Retries need three things together: only retryable classes, backoff with jitter, and a global retry budget.',
      'Every non-idempotent write should accept an idempotency key, because timeouts are not preventable.',
      'Server-side error rate cannot see requests that never arrived, and disagrees with clients about timeouts by construction.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The part of an API contract that tells a caller what went wrong, whether the operation took effect, and what to do next.',
    whyItExists:
      'Distributed calls fail in ways that are not visible to the caller, and a caller who cannot tell whether an operation happened must either duplicate it or lose it.',
    whenToUse: [
      'Status codes with a structured body for every API, internal or public.',
      'Idempotency keys on every non-idempotent write.',
      'Explicit per-step state whenever one request has more than one side effect.',
    ],
    whenNotToUse: [
      '200 with an error inside — it disables the entire operational stack that reads status codes.',
      '5xx for a valid request with a negative answer, which teaches clients to retry the impossible.',
      'Per-item batch results where validating everything up front would remove partial failure entirely.',
    ],
    alternatives: [
      'Asynchronous submission with 202 and a status resource, which relocates errors rather than removing them.',
      'A query endpoint keyed on a client-supplied reference, when idempotent writes are too invasive to add.',
      'All-or-nothing transactional semantics, when partial application would leave callers unable to reason about state.',
    ],
    tradeoffs: [
      'Structured errors buy programmatic handling and make the codes permanent contract.',
      'Per-item batch results buy throughput on large batches and rely on clients inspecting every item.',
      'Idempotency keys buy safe retries and cost stored keys with a retention policy.',
      'Asynchronous processing buys availability and transfers retry policy, dead-lettering and consumer idempotency to you.',
    ],
    failureModes: [
      'Duplicate writes from retrying a timeout on a non-idempotent endpoint.',
      'An invisible outage because every response was 200.',
      'Clients retrying 4xx forever because a permanent failure was labelled 5xx.',
      'A retry storm tripling load exactly when capacity is lowest.',
      'Batch failures silently discarded because the client only read the aggregate status.',
      'A dead-letter queue nobody monitors, quietly losing work.',
      'Internal hostnames and stack traces disclosed in error bodies.',
    ],
    followUpQuestions: [
      'What does the caller do differently for each error you return?',
      'On a timeout, can the caller retry safely — and how do you know?',
      'What does your monitoring see when this endpoint fails?',
      'If half the operation succeeded, what does the response say?',
      'Who watches the dead-letter queue?',
      'How would you and a partner reconcile disagreeing error rates?',
    ],
  },
});
