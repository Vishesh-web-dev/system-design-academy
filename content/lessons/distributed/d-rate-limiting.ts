import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-rate-limiting',
  title: 'Rate limiting algorithms and distributed enforcement',
  summary:
    'Token bucket versus sliding window is a question about whether bursts are acceptable. The harder question is enforcement: a globally accurate limiter needs a round trip per request, and the usual right answer is to be deliberately approximate.',
  phase: 'distributed',
  module: 'messaging',
  position: 32,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['rate-limiting', 'token-bucket', 'sliding-window', 'quotas', 'load-shedding'],
  prerequisites: ['d-redis'],
  resources: [
    {
      key: 'stripe-rate-limits',
      tier: 'must',
      note: 'A public rate-limiting contract: what is limited, what the response looks like, and what clients are told to do. Read it as the specification of the client-facing half, which is usually neglected.',
    },
    {
      key: 'google-sre-handling-overload',
      tier: 'must',
      note: 'Read the sections on client-side throttling and on criticality. The argument that a limiter must be paired with graceful client behaviour is the part most treatments omit.',
    },
    {
      key: 'aws-load-shedding',
      tier: 'must',
      note: 'The distinction between rate limiting a client and shedding load to protect yourself. Read it for why the two need different mechanisms and different signals.',
    },
    {
      key: 'redis-data-types',
      tier: 'good',
      note: 'Read the sorted-set and string sections with the algorithms below in mind — each algorithm here maps onto a specific structure, and the mapping determines its cost.',
    },
    {
      key: 'envoy-architecture',
      tier: 'good',
      note: 'Read the rate-limiting filter material for how a proxy implements local and global limits, and where the global service sits relative to the request path.',
    },
    {
      key: 'google-sre-addressing-cascading',
      tier: 'advanced',
      note: 'Why a limiter is a defence against cascading failure, and how a badly-tuned one can cause the cascade instead. Read it after the algorithms, as the operational frame.',
    },
  ],

  intuition: {
    body: `A rate limiter answers one question: *may this request proceed?* And it exists for two quite different reasons that people conflate.

**Fairness.** One tenant should not consume capacity everyone else needs. This is about *allocation*, the limit is a policy decision, and it applies whether or not you are under pressure.

**Protection.** The system should not be pushed past what it can serve. This is about *survival*, the limit should respond to actual load, and it only matters when you are near capacity.

Conflating them produces limiters that do neither well: a fairness limit set from a capacity estimate is either wastefully low most of the time or useless when it matters. **Fairness limits are per-tenant and fixed; protection is load shedding and should be dynamic.** Both are worth having, and they are different mechanisms.

Now the algorithms. There are five worth knowing and the differences reduce to **what shape of traffic they permit**:

**Fixed window.** Count requests per calendar minute. Trivially cheap, and it permits a burst of 2× the limit across a window boundary — 100 in the last second of one minute and 100 in the first second of the next.

**Sliding window log.** A timestamp per request, counting those inside the window. Exact, and memory grows with request volume rather than with the number of clients.

**Sliding window counter.** Interpolate between two fixed windows. Nearly as accurate, constant memory. The usual pragmatic choice.

**Token bucket.** Capacity B refills at rate R; each request takes a token. **Permits a burst of up to B, then settles to R.**

**Leaky bucket.** Requests queue and drain at a fixed rate — smooth output, and it adds latency rather than rejecting.

The insight that makes the choice easy: **a token bucket permits bursts by design, and a sliding window is what you use when bursts are the thing you are preventing.** A client doing a legitimate batch of 50 then going quiet is fine under a token bucket and rejected under a strict sliding window. Which you want is a product decision.

Then the genuinely hard part: **enforcement across many servers.** A limit of "1,000 per minute per key" must be enforced by twenty servers that each see a fraction of the traffic. Either ask a shared store on every request — accurate, and a round trip plus a new dependency in every request path — or let each server enforce a share locally, which is free and wrong.

**The usual right answer is to be deliberately approximate:** enforce locally, reconcile asynchronously, and be explicit about the resulting tolerance rather than claiming an accuracy you are not paying for.

The framing to carry: **choose the algorithm from what traffic shape you permit, and the enforcement from how much accuracy is worth a round trip.**`,
    analogyLimit:
      '"A rate limiter caps requests per second" hides both halves of the difficulty. It does not say what shape of traffic is permitted — a token bucket and a sliding window with the same nominal rate accept very different clients — and it implies the count is a single global number, when in a distributed system it is a number nobody has without paying for it on every request. It also hides that a limiter without a graceful client contract converts an overload into a retry storm.',
  },

  deepExplanation: {
    predict: {
      question:
        'An API enforces 1,000 requests/minute per API key. It runs on 20 servers behind a load balancer, and each server independently enforces 50 requests/minute (1,000 ÷ 20) using a local in-memory counter. A customer complains they are limited at around 300 requests/minute. Explain precisely, and give three fixes with their costs.',
      answer: `**Why they are limited at 300 rather than 1,000.**

The local-share approach assumes each server sees exactly 1/20th of that key's traffic. It does not, for two reasons that compound.

**Load balancing distributes connections, not requests per key.** With random or round-robin distribution, one client's 1,000 requests spread unevenly across 20 servers. Some servers see 80, some see 30. **Any server that sees more than 50 rejects the excess**, even though the global total is under 1,000.

**The arithmetic is worse than intuition suggests.** Distributing 1,000 requests randomly across 20 buckets gives a mean of 50 per bucket with a standard deviation of about 7. So roughly half the servers exceed 50, and each rejects its excess. Summing the accepted requests across all servers gives substantially less than 1,000 — and the shortfall grows as the number of servers grows, because each server's share shrinks while its variance relative to that share increases.

**And the client's own behaviour makes it much worse.** A client using HTTP keep-alive holds a connection to *one* server and sends most requests down it. That server sees far more than 1/20th — potentially all of it — so the client is limited at 50 rather than 1,000. If the client uses a small connection pool of, say, six connections, it reaches six servers and is limited at around 300.

**That is the answer to the specific number.** 300 is roughly what a client with a six-connection pool gets from a 50-per-server limit, and it is a strong hint that connection pooling is the mechanism rather than pure randomness.

**Three fixes.**

**Fix 1 — centralised counting in a shared store.**

\`\`\`
INCR ratelimit:{key}:{minute}
EXPIRE ratelimit:{key}:{minute} 120 NX
\`\`\`

Every server increments the same counter, so the limit is exactly 1,000 regardless of distribution.

*Costs:* a round trip on every request — a millisecond or two same-region, which for a 20 ms endpoint is 10% of the latency budget. The store becomes a dependency in **every** request path, so its availability is your availability, and it must be sized for total request volume. And you must decide what happens when it is unavailable: fail open (unlimited) or fail closed (all requests rejected). **Fail open is almost always right**, because a limiter outage should not be an API outage.

**Fix 2 — route by key so each key lands on one server.**

Consistent-hash the API key at the load balancer so all of a key's requests reach one server, which then enforces the full 1,000 locally with no shared state.

*Costs:* it requires an L7 balancer that can hash on a header, and it reintroduces the hot-key problem — a very large customer's traffic all lands on one server. A server restart loses its counters, briefly allowing a double allowance. And it constrains routing for reasons unrelated to routing, which couples two concerns.

**Fix 3 — local enforcement with asynchronous reconciliation.**

Each server enforces locally against a share and periodically — every second or two — reports its usage to a shared store and receives an updated share. A server seeing more traffic gets a larger share.

*Costs:* deliberately approximate. Between reconciliations a client can exceed the limit by up to the sum of unreconciled local allowances. Accuracy is bounded by the reconciliation interval, and the mechanism is more code than either alternative.

**Which I would choose, and it depends on what the limit is for.**

**If the limit is a published contract** — "1,000 requests/minute on your plan" — customers will measure it, and being limited at 300 is a billing dispute. Accuracy matters, so **fix 1**, with a fail-open policy and the counter co-located with the API servers to keep the round trip cheap.

**If the limit is protection against abuse**, exact accuracy is worthless. **Fix 3**, with a stated tolerance — "the effective limit is between 1,000 and roughly 1,200 per minute" — because that buys nearly all the protection with no hot-path dependency.

**The general lesson.** The failure was not the algorithm; a fixed-window counter would have been fine. It was **assuming that dividing a global limit by the server count enforces the global limit.** It does so only if traffic distributes perfectly, and keep-alive connections guarantee it does not. Whenever a limit is enforced as a local share, the effective limit is lower than intended by an amount nobody calculated.`,
    },
  body: `## The five algorithms

**Fixed window.** \`INCR\` a key named for the current window, with a TTL.

*Cost:* one counter per key. Trivial.
*Permits:* up to 2× the limit across a boundary. A client sending 100 at 10:00:59 and 100 at 10:01:01 has sent 200 in two seconds against a 100/minute limit.
*Use when:* the limit is coarse protection and the boundary burst is acceptable.

**Sliding window log.** A sorted set of request timestamps; prune older than the window and count what remains.

*Cost:* **memory proportional to requests in the window, not to clients.** At 1,000/minute per key across 10,000 keys that is 10 million entries.
*Permits:* exactly the limit over any 60-second span. No boundary effect.
*Use when:* exactness matters and volume is low enough to afford it.

**Sliding window counter.** Keep the current and previous fixed-window counts, and interpolate by position within the current window:

\`\`\`
estimate = current + previous × (1 − elapsed_fraction_of_window)
\`\`\`

*Cost:* two counters per key. Constant.
*Permits:* close to the limit; the interpolation assumes the previous window's requests were evenly distributed, so a client that front-loaded them is slightly mis-estimated.
*Use when:* almost always, if you want a sliding window. Nearly the accuracy of the log at a tiny fraction of the memory.

**Token bucket.** Capacity B, refill rate R. Each request removes a token; empty means reject.

*Cost:* two values per key — token count and last-refill timestamp — updated lazily on access. Constant.
*Permits:* a burst up to B, then a sustained rate of R. **This is the important property.**
*Use when:* bursts are legitimate. Which is most of the time — clients batch, pages fire several requests, retries cluster.

**Leaky bucket (as a queue).** Requests enter a queue that drains at a fixed rate.

*Cost:* a queue per key, and the queue holds requests rather than counters.
*Permits:* a perfectly smooth output rate, at the cost of **latency instead of rejection**.
*Use when:* smoothing traffic toward a downstream that cannot burst — and only when the caller can wait. It converts a rejection into a delay, which is often worse, because a queued request holds resources on both sides.

## Choosing between them

The decision tree is short:

**Do you need to permit bursts?** Yes → token bucket. It is the only one that expresses "50 at once is fine, 50 per second sustained is not" as a single pair of parameters.

**Are bursts the thing you are preventing?** Yes → sliding window counter.

**Is the limit coarse and cheapness paramount?** → fixed window, accepting the boundary burst.

**Must the output rate be smooth for a downstream?** → leaky bucket, and check the caller can tolerate the added latency.

**Is exactness a contractual requirement at low volume?** → sliding window log.

A practical note: **a token bucket with B = R is a rate limiter with no burst allowance**, so the token bucket subsumes much of what a sliding window is used for. Tuning B separately from R is where its value is.

## What to limit on

The algorithm is the easy half. **The key you limit on determines whether the limiter works.**

| Key | Protects against | Fails when |
| --- | --- | --- |
| API key / tenant | One customer consuming everyone's capacity | The customer has many keys |
| User id | One user's abuse | The abuse is unauthenticated |
| IP address | Unauthenticated abuse | Carrier NAT puts thousands behind one IP; attackers rotate IPs |
| IP + endpoint | Credential stuffing on a login endpoint | Same as IP |
| Session or device | Per-device abuse | Sessions are cheap to create |

Two rules that matter more than the algorithm choice:

**Limit on the most specific identity available, and layer.** An authenticated request should be limited per tenant *and* per user *and* per IP, because each catches a different abuse. A single limit on one dimension is trivially bypassed.

**Limit expensive endpoints separately.** A global "1,000 requests/minute" treats a 2 ms lookup and an 8-second report as equivalent. **The right unit is often cost, not count** — a weighted token bucket where a report costs 100 tokens and a lookup costs 1 expresses the actual constraint. This is the single most valuable refinement available and it is rarely applied.

## Distributed enforcement: the real problem

Three approaches, and the trade is accuracy against a hot-path dependency.

**Centralised counting.** Every server updates a shared store per request.

*Accuracy:* exact.
*Cost:* a round trip per request; the store in every request path; sizing for total volume; and a fail-open/fail-closed decision. **Fail open**, so a limiter outage is not an API outage — and then be aware that during that outage you have no limiting at all, which is an argument for a coarse local limit as a backstop.

**Local share.** Each server enforces \`limit ÷ servers\`.

*Accuracy:* poor, and biased **low** — the effective limit is meaningfully below the intended one because traffic does not distribute evenly, and keep-alive connections make it much worse.
*Cost:* free.
*Use when:* the limit is a very coarse safety net and under-limiting is acceptable.

**Local enforcement with asynchronous reconciliation.** Enforce locally; report usage and receive an updated share every second or two.

*Accuracy:* bounded overshoot — a client can exceed by up to the sum of unreconciled allowances.
*Cost:* no hot-path dependency; more machinery.
*Use when:* the limit is protection rather than a contract. **This is the usual right answer at scale**, and the honest way to describe it is a stated tolerance rather than a claimed exact limit.

A useful hybrid: **a coarse local limit plus an exact central one.** The local limit rejects obvious abuse with no round trip; the central limit enforces the contract for traffic that passes it. The store is then consulted for a fraction of requests rather than all of them.

## The client-facing contract, which is half the design

A limiter that rejects without telling the client how to behave converts an overload into a retry storm. The response must carry enough for a client to do the right thing:

\`\`\`
HTTP/1.1 429 Too Many Requests
Retry-After: 12
RateLimit-Limit: 1000
RateLimit-Remaining: 0
RateLimit-Reset: 1725718800
\`\`\`

**\`Retry-After\` is the important one**, because without it every client invents its own retry timing and they synchronise on failure.

Three obligations that are usually missed:

**Publish the limit and the algorithm.** A client cannot pace itself against an undocumented limit. Saying "token bucket, capacity 100, refill 10/second" lets a well-behaved client stay inside it.

**Expose remaining quota on successful responses too**, so clients can slow down before being rejected rather than after.

**Do not count rejected requests against the limit.** Otherwise a client that hits the limit and retries can never escape it — every retry extends the lockout. This is a real and cruel bug.

And on the client side, the counterpart: **client-side throttling.** A client that observes a high rejection rate should reduce its own send rate rather than retrying at full speed. Without this, the limiter protects the server and the client burns its own capacity generating rejections.

## Rate limiting is not load shedding

These are constantly conflated and they need different mechanisms.

**Rate limiting** is per-client, fixed, and about fairness. It says "your allowance is 1,000/minute" and it says the same thing whether the system is idle or on fire.

**Load shedding** is global, dynamic, and about survival. It says "we are at capacity; reject the lowest-priority work" and it only activates under pressure.

You need both, and the failure of having only rate limiting is specific: **if every client stays within its limit and the sum of all limits exceeds your capacity, you are overloaded with no limiter triggered.** The limiter reports everything as fine while latency collapses.

Load shedding needs a different signal — queue depth, latency against an objective, or a concurrency limit — and a notion of **criticality**, so a health check or a payment completes while a recommendation refresh is dropped. This is developed properly in the backpressure lesson; here the point is that a rate limiter does not cover it.

## Where a rate limiter is the wrong tool

**To fix a slow endpoint.** Limiting traffic to something slow makes fewer people wait. It does not make it fast.

**As the only protection against overload.** See above: within-limit traffic can still exceed capacity.

**For internal service-to-service calls**, usually. A concurrency limit or a bounded connection pool expresses "do not overwhelm this dependency" more directly, and it adapts automatically as the dependency's speed changes.

**When the real problem is cost per request.** A limiter on count treats a cheap and an expensive request alike. Weight the cost, or limit concurrency on the expensive path.

**When the client cannot respond to being limited.** Rejecting a request from something that will retry immediately and forever produces more load than allowing it.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'algorithms',
      title: 'What traffic shape each algorithm permits',
      caption:
        'Read the middle column. The algorithms differ almost entirely in what burst they accept, and which burst you want to accept is a product decision rather than a technical one.',
      code: `flowchart LR
    Q["What traffic shape<br/>do you permit?"]

    Q --> TB["**Token bucket**<br/>capacity B, refill R"] --> TB2["Burst up to B,<br/>then sustained R"] --> TB3["Use when bursts are<br/>legitimate — batching,<br/>page loads, retries.<br/>**Usually the answer**"]

    Q --> SW["**Sliding window counter**<br/>two counters, interpolated"] --> SW2["Close to the limit over<br/>any window, constant memory"] --> SW3["Use when bursts are<br/>what you are preventing"]

    Q --> FW["**Fixed window**<br/>one counter per minute"] --> FW2["Up to 2× the limit<br/>across a boundary"] --> FW3["Use for coarse protection<br/>where cheapness wins"]

    Q --> SL["**Sliding window log**<br/>a timestamp per request"] --> SL2["Exact over any window"] --> SL3["Memory grows with<br/>REQUESTS, not clients.<br/>Low volume only"]

    Q --> LB["**Leaky bucket**<br/>a draining queue"] --> LB2["Perfectly smooth output"] --> LB3["Latency instead of<br/>rejection — only if the<br/>caller can wait"]

    style TB3 fill:#17272a,stroke:#35897e
    style SW3 fill:#17272a,stroke:#35897e
    style SL3 fill:#1c1814,stroke:#c99a4e
    style LB3 fill:#1c1814,stroke:#c99a4e
    style FW2 fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'enforcement',
      title: 'Three ways to enforce one limit across twenty servers',
      caption:
        'Step through it. The local-share path is free and biased low in a way nobody calculates; the central path is exact and puts a dependency in every request. The honest answer is usually a stated tolerance.',
      nodes: [
        { id: 'client', label: 'Client, 1,000 req/min', kind: 'client', x: 0, y: 200, detail: 'Uses HTTP keep-alive with a pool of six connections, so its requests reach six servers rather than spreading across twenty. This is what makes local-share enforcement badly wrong.' },
        { id: 'lb', label: 'Load balancer', kind: 'service', x: 180, y: 200, detail: 'Distributes connections, not requests per key. Nothing here knows or cares that all these requests share an API key.' },
        { id: 'srv', label: '20 servers', kind: 'service', x: 370, y: 200, detail: 'Each sees an uneven share. With a local limit of 50 each, a client reaching six of them is limited at ~300 rather than 1,000.' },
        { id: 'local', label: 'Local share: 50 each', kind: 'note', x: 370, y: 60, detail: 'Free, no dependency, and biased LOW. Distributing 1,000 across 20 buckets gives a mean of 50 with a deviation of ~7, so half the servers reject excess while the global total is under the limit.' },
        { id: 'central', label: 'Shared counter', kind: 'store', x: 600, y: 130, detail: 'INCR per request. Exact, and it is now a dependency in every request path: sized for total volume, its availability is your availability, and it needs a fail-open policy.' },
        { id: 'recon', label: 'Async reconciliation', kind: 'service', x: 600, y: 280, detail: 'Servers report usage every second or two and receive an updated share. No hot-path round trip; overshoot bounded by the reconciliation interval. The usual right answer for protection limits.' },
        { id: 'resp', label: '429 + Retry-After', kind: 'note', x: 830, y: 200, detail: 'Half the design. Without Retry-After every client invents its own timing and they synchronise on failure. And rejected requests must not count against the limit, or a client can never escape it.' },
      ],
      edges: [
        { id: 'e1', source: 'client', target: 'lb', kind: 'sync' },
        { id: 'e2', source: 'lb', target: 'srv', kind: 'sync' },
        { id: 'e3', source: 'srv', target: 'local', kind: 'control' },
        { id: 'e4', source: 'srv', target: 'central', kind: 'sync' },
        { id: 'e5', source: 'srv', target: 'recon', kind: 'async' },
        { id: 'e6', source: 'srv', target: 'resp', kind: 'sync' },
      ],
      steps: [
        {
          id: 'en1',
          title: 'The balancer distributes connections, not keys',
          description:
            'Nothing in the request path groups requests by API key. A client with a six-connection pool reaches six servers, so any per-server share assumption is already broken.',
          nodes: ['client', 'lb', 'srv'],
          edges: ['e1', 'e2'],
        },
        {
          id: 'en2',
          title: 'So a local share under-limits, by an amount nobody computed',
          description:
            'Dividing the global limit by the server count enforces the global limit only under perfect distribution. In practice the effective limit is well below the intended one, and it gets worse as servers are added.',
          nodes: ['local'],
          edges: ['e3'],
        },
        {
          id: 'en3',
          title: 'A shared counter is exact and costs a round trip',
          description:
            'One INCR per request gives the exact limit. It also puts a store in every request path — sized for total volume, with its availability becoming yours, needing a fail-open decision.',
          nodes: ['central'],
          edges: ['e4'],
        },
        {
          id: 'en4',
          title: 'Reconciliation buys most of the accuracy for none of the latency',
          description:
            'Enforce locally, report usage every second or two, receive an updated share. Overshoot is bounded by the interval, and the honest description is a stated tolerance rather than an exact limit.',
          nodes: ['recon'],
          edges: ['e5'],
        },
        {
          id: 'en5',
          title: 'And the response is half the design',
          description:
            'Retry-After stops clients inventing their own timing and synchronising. Publishing the limit lets a client pace itself. And rejected requests must never count against the limit.',
          nodes: ['resp'],
          edges: ['e6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['stripe'],
    body: `Stripe's published rate-limiting behaviour is worth studying because it makes the *client-facing* half explicit, which is the half most implementations neglect.

**Several limits operate simultaneously, on different dimensions.** A request rate limit, a concurrency limit, and separate treatment for read and write operations. The lesson: **one limit on one dimension does not express a real constraint.** A client sending few but very expensive requests is unconstrained by a request-rate limit and constrained by a concurrency limit, and both failure modes are real.

**Limits differ between test and live modes**, which is a small detail with a large implication: test traffic is bursty and automated, live traffic is human-paced. **Limits should reflect the traffic pattern of the workload, not a single number applied everywhere.**

**The response carries explicit guidance**, and clients are told to retry with exponential backoff plus jitter rather than immediately. Without that instruction, every client invents its own policy, they synchronise on failure, and the limiter produces the load spike it exists to prevent.

**Idempotency keys interact with limiting deliberately.** A retried request carrying the same idempotency key returns the original result rather than performing the operation again — so the retry guidance and the idempotency contract are designed together. That is the right shape: telling a client to retry is only safe if retries are safe.

**Rate limits are documented rather than discovered.** A published limit is a limit a client can design against; an undocumented one is discovered in production by a client that has already built something that exceeds it.

**Three transferable lessons.**

**Layer limits on different dimensions.** Rate, concurrency, and cost each catch abuse the others miss. A single request-count limit is the weakest useful version.

**Design the response, not just the decision.** Status code, \`Retry-After\`, remaining quota, and documented retry guidance. A limiter without these is a mechanism for turning an overload into a retry storm.

**Pair the retry guidance with idempotency.** "Retry with backoff" is dangerous advice unless retries are safe, and making them safe is the callee's job.

**Where the model does not transfer.** This is a public API with paying customers who read documentation, so accuracy and clarity are worth a great deal. An internal limiter protecting one service from another needs neither published documentation nor exact accuracy — a concurrency limit with no client-facing contract is usually the better tool there, and reaching for the public-API shape internally is over-engineering.`,
  },

  tradeoffs: {
    intro:
      'Two decisions: the algorithm, which fixes what traffic shape you permit, and the enforcement, which fixes how much accuracy costs. Rows cover both.',
    rows: [
      {
        option: 'Fixed window counter',
        whenItWins:
          'Coarse protection where cheapness dominates. One counter per key, one increment per request.',
        whenItLoses:
          'When a 2× burst across the window boundary matters, or when the limit is a published contract clients will measure.',
        cost:
          'Up to double the limit over a short span straddling a boundary.',
      },
      {
        option: 'Sliding window log',
        whenItWins:
          'Exactness over any window at low volume, or when the limit must be provably correct.',
        whenItLoses:
          'At volume — memory is proportional to requests in the window, not to the number of clients.',
        cost:
          'One stored timestamp per request, plus pruning work on every check.',
      },
      {
        option: 'Sliding window counter',
        whenItWins:
          'The pragmatic sliding window: nearly the log\'s accuracy with two counters per key.',
        whenItLoses:
          'When the interpolation\'s assumption of even distribution in the previous window is materially wrong.',
        cost:
          'Slight mis-estimation for clients that front-load a window.',
      },
      {
        option: 'Token bucket',
        whenItWins:
          'Most cases. It expresses "a burst of B is fine, a sustained rate above R is not" in two parameters, which is what clients actually do.',
        whenItLoses:
          'When any burst is unacceptable to a downstream that cannot absorb it.',
        cost:
          'A burst of up to B must be survivable by everything behind the limiter.',
      },
      {
        option: 'Leaky bucket (queue)',
        whenItWins:
          'Smoothing toward a downstream that cannot burst, when the caller can wait.',
        whenItLoses:
          'When the caller cannot wait. It converts rejection into latency, and a queued request holds resources on both sides.',
        cost:
          'Added latency, a queue to bound, and a worse failure mode when the queue fills.',
      },
      {
        option: 'Weighted limits (cost, not count)',
        whenItWins:
          'When request cost varies by orders of magnitude. A report costing 100 tokens and a lookup costing 1 expresses the real constraint.',
        whenItLoses:
          'When costs are uniform, making the weighting pure complexity.',
        cost:
          'Assigning and maintaining a cost per endpoint, and explaining it to clients.',
      },
      {
        option: 'Centralised counting in a shared store',
        whenItWins:
          'When the limit is a published contract customers will measure and dispute.',
        whenItLoses:
          'When a round trip per request is unaffordable, or when adding a dependency to every request path is unacceptable.',
        cost:
          'Hot-path latency, a store sized for total volume, and a fail-open policy that means no limiting during its outage.',
      },
      {
        option: 'Local share (limit ÷ servers)',
        whenItWins:
          'Very coarse safety nets where under-limiting is fine. Free and dependency-less.',
        whenItLoses:
          'Whenever the effective limit matters — it is biased low, and keep-alive connections make it far worse than the arithmetic suggests.',
        cost:
          'An effective limit well below the intended one, by an amount nobody calculated.',
      },
      {
        option: 'Local enforcement with async reconciliation',
        whenItWins:
          'Protection limits at scale. Nearly the accuracy of central counting with no hot-path dependency.',
        whenItLoses:
          'When exactness is contractual, since overshoot is bounded but real.',
        cost:
          'Overshoot up to the sum of unreconciled allowances, and more machinery than either alternative.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We have 20 servers and a 1,000/minute limit, so each server allows 50."',
      whyWeak:
        'That enforces the global limit only if traffic distributes perfectly across servers, and it does not. Random distribution alone means about half the servers exceed their share and reject excess while the global total is under the limit — and HTTP keep-alive makes it far worse, since a client with a six-connection pool reaches six servers and is limited at around 300.',
      strongAnswer:
        '"Dividing by the server count under-limits, because traffic does not distribute evenly and keep-alive connections concentrate a client on a few servers. If the limit is a published contract I would count centrally with a shared counter and a fail-open policy. If it is protection, I would enforce locally with asynchronous reconciliation every second or two and state the tolerance explicitly rather than claiming an exact limit."',
    },
    {
      weakAnswer: '"We use a fixed window counter, which is simple and effective."',
      whyWeak:
        'A fixed window permits up to double the limit across a boundary — 100 requests at 10:00:59 and 100 at 10:01:01 is 200 in two seconds against a 100/minute limit. If the limit exists to protect capacity, the burst you allowed is exactly the one you were protecting against.',
      strongAnswer:
        '"Fixed windows allow a 2× burst across the boundary, which matters if the limit is protecting capacity. A sliding window counter fixes it with two counters instead of one — nearly the accuracy of a full log at constant memory. And if bursts are actually legitimate, a token bucket says so deliberately with a capacity parameter rather than allowing them by accident at boundaries."',
    },
    {
      weakAnswer: '"The limit is 1,000 requests per minute across the whole API."',
      whyWeak:
        'It treats a 2 ms lookup and an 8-second report as equivalent. A client sending 1,000 reports is within the limit and will exhaust the system; a client sending 1,001 lookups is rejected for no reason. The limit does not express the actual constraint.',
      strongAnswer:
        '"The unit should be cost, not count. I would use a weighted token bucket — a lookup costs 1 token, a report costs 100 — so the limit expresses the real resource constraint. Separately, the expensive endpoint wants its own concurrency limit, because \'no more than four reports running at once\' is a more direct statement of that constraint than any rate."',
    },
    {
      weakAnswer: '"When a client exceeds the limit we return 429."',
      whyWeak:
        'A bare 429 tells the client nothing about when to retry, so every client invents its own timing and they synchronise on failure — producing the load spike the limiter exists to prevent. And if rejected requests are counted against the limit, a client that hits it can never escape.',
      strongAnswer:
        '"The response is half the design: 429 with `Retry-After`, plus limit, remaining and reset headers on successful responses too, so clients can slow down before being rejected. Rejected requests must not count against the limit or the client is locked out permanently by its own retries. And the documented retry guidance should say backoff with jitter — paired with idempotency, since telling clients to retry is only safe if retries are."',
    },
    {
      weakAnswer: '"Our rate limiter protects us from overload."',
      whyWeak:
        'It does not. If every client stays within its limit and the sum of all limits exceeds capacity, you are overloaded with no limiter triggered — and the limiter reports everything as fine while latency collapses. Rate limiting is per-client fairness; overload protection is load shedding.',
      strongAnswer:
        '"Rate limiting is per-client and fixed; it is about fairness. Overload protection needs a global, dynamic mechanism driven by a real signal — queue depth, latency against an objective, or a concurrency limit — plus a notion of criticality so a payment completes while a recommendation refresh is dropped. If the sum of all client limits exceeds capacity, and it usually does, the limiter never fires during an overload."',
    },
    {
      weakAnswer: '"We rate limit calls to our internal recommendation service so we do not overwhelm it."',
      whyWeak:
        'A rate limit is a fixed number that becomes wrong as soon as the dependency\'s speed changes. If it gets faster the limit wastes capacity; if it gets slower the limit no longer protects it, because the same request rate now means far more concurrent work.',
      strongAnswer:
        '"For an internal dependency I would use a concurrency limit rather than a rate limit — a bounded number of in-flight requests, or a bounded connection pool. That expresses \'do not have more than N outstanding\' directly, and it adapts automatically: if the dependency slows, concurrency fills and callers are throttled without anyone retuning a number. A rate limit is a guess about the dependency\'s speed."',
    },
  ],

  flashcards: [
    {
      id: 'fc-rl-1',
      front: 'What are the two distinct reasons to rate limit, and why keep them separate?',
      back: 'Fairness (per-tenant, fixed, always on) and protection (global, dynamic, only under pressure). A fairness limit set from a capacity estimate is either wastefully low or useless when it matters.',
      topic: 'rate-limiting',
    },
    {
      id: 'fc-rl-2',
      front: 'What burst does a fixed window permit?',
      back: 'Up to 2× the limit across a boundary — 100 at 10:00:59 plus 100 at 10:01:01 against a 100/minute limit.',
      topic: 'sliding-window',
    },
    {
      id: 'fc-rl-3',
      front: 'What does a sliding window log cost?',
      back: 'Memory proportional to requests in the window, not to the number of clients. At 1,000/minute across 10,000 keys that is 10 million stored timestamps.',
      topic: 'sliding-window',
    },
    {
      id: 'fc-rl-4',
      front: 'How does a sliding window counter work?',
      back: '`current + previous × (1 − elapsed fraction)`. Two counters per key, nearly the accuracy of a full log at constant memory.',
      topic: 'sliding-window',
    },
    {
      id: 'fc-rl-5',
      front: 'What makes a token bucket the usual right choice?',
      back: 'Capacity B and refill rate R express "a burst of B is fine, sustained above R is not" — which matches how clients actually behave: batching, page loads, clustered retries.',
      topic: 'token-bucket',
    },
    {
      id: 'fc-rl-6',
      front: 'What does a leaky bucket trade?',
      back: 'Rejection for latency. Output is perfectly smooth, and a queued request holds resources on both sides — only use it when the caller can genuinely wait.',
      topic: 'token-bucket',
    },
    {
      id: 'fc-rl-7',
      front: 'Why is dividing a global limit by the server count wrong?',
      back: 'It assumes perfect distribution. Random distribution alone makes about half the servers reject excess, and keep-alive connections concentrate a client on a few servers — so the effective limit is well below the intended one.',
      topic: 'quotas',
    },
    {
      id: 'fc-rl-8',
      front: 'What does centralised counting cost?',
      back: 'A round trip per request, a store sized for total volume, a dependency in every request path, and a fail-open policy — during whose outage there is no limiting at all.',
      topic: 'quotas',
    },
    {
      id: 'fc-rl-9',
      front: 'What is the usual right enforcement at scale, and how do you describe it?',
      back: 'Local enforcement with asynchronous reconciliation every second or two. Describe it as a stated tolerance — "between 1,000 and roughly 1,200" — not as an exact limit.',
      topic: 'quotas',
    },
    {
      id: 'fc-rl-10',
      front: 'Why is a count-based limit usually the wrong unit?',
      back: 'It treats a 2 ms lookup and an 8-second report as equivalent. A weighted token bucket — 1 token versus 100 — expresses the real resource constraint.',
      topic: 'rate-limiting',
    },
    {
      id: 'fc-rl-11',
      front: 'Why must rejected requests not count against the limit?',
      back: 'Otherwise a client that hits the limit and retries extends its own lockout indefinitely and can never escape.',
      topic: 'rate-limiting',
    },
    {
      id: 'fc-rl-12',
      front: 'What must a 429 response carry, and why?',
      back: '`Retry-After` above all — without it every client invents its own timing and they synchronise on failure, producing the spike the limiter exists to prevent.',
      topic: 'rate-limiting',
    },
    {
      id: 'fc-rl-13',
      front: 'Why does a rate limiter not protect against overload?',
      back: 'If every client stays within its limit and the sum of limits exceeds capacity, you are overloaded with no limiter triggered — and it reports everything as fine.',
      topic: 'load-shedding',
    },
    {
      id: 'fc-rl-14',
      front: 'Why prefer a concurrency limit for an internal dependency?',
      back: 'A rate limit is a fixed guess about the dependency\'s speed. A concurrency limit adapts automatically: if the dependency slows, in-flight requests fill and callers throttle without retuning anything.',
      topic: 'load-shedding',
    },
  ],

  quiz: [
    {
      id: 'q-rl-1',
      kind: 'scenario',
      prompt:
        'A 1,000/minute-per-key limit is enforced as 50 per server across 20 servers. A customer is limited at around 300/minute. What is the mechanism?',
      options: [
        { id: 'a', label: 'Keep-alive connections concentrate the client on about six servers, so it hits 6 × 50 rather than the intended 1,000' },
        { id: 'b', label: 'The load balancer is misconfigured and sending all traffic to six servers' },
        { id: 'c', label: 'The client is sending 700 malformed requests that are rejected separately' },
        { id: 'd', label: 'The per-server counters are not expiring correctly' },
      ],
      correct: ['a'],
      explanation:
        'A client with a small connection pool reaches only as many servers as it has connections, so its effective limit is pool size × per-server share. Random distribution alone would already under-limit — about half the servers exceed a mean share of 50 — and keep-alive makes it dramatically worse. The balancer is behaving normally; the share assumption is the bug.',
      difficulty: 'advanced',
      topic: 'quotas',
    },
    {
      id: 'q-rl-2',
      kind: 'single',
      prompt: 'A client legitimately sends 50 requests at once, then nothing for a minute. Which algorithm accepts this and which rejects it?',
      options: [
        { id: 'a', label: 'A token bucket with capacity ≥ 50 accepts it; a strict sliding window at a low per-second rate rejects it' },
        { id: 'b', label: 'Both accept it, since the per-minute total is low' },
        { id: 'c', label: 'Both reject it, since 50 at once exceeds any per-second rate' },
        { id: 'd', label: 'A fixed window rejects it and a sliding window accepts it' },
      ],
      correct: ['a'],
      explanation:
        'This is the defining difference. A token bucket\'s capacity parameter is an explicit burst allowance, so a batch that fits in the bucket is accepted. A sliding window measures the rate over the window and rejects the burst. Which behaviour is correct is a product decision about whether client batching is legitimate.',
      difficulty: 'core',
      topic: 'token-bucket',
    },
    {
      id: 'q-rl-3',
      kind: 'scenario',
      prompt:
        'Every client stays within its documented rate limit. The system is at 100% CPU and latency has collapsed. Why did the limiter not help?',
      options: [
        { id: 'a', label: 'The sum of all clients\' limits exceeds capacity — rate limiting is per-client fairness, not overload protection' },
        { id: 'b', label: 'The limiter\'s counters are being evicted under memory pressure' },
        { id: 'c', label: 'The limits are set too high and should be halved' },
        { id: 'd', label: 'The limiter is failing open under load' },
      ],
      correct: ['a'],
      explanation:
        'A per-client limit says nothing about the aggregate. If every client is compliant and the total exceeds capacity, the limiter never fires and reports everything as fine. Halving the limits would help this incident and would be wastefully restrictive the rest of the time — the correct answer is a separate load-shedding mechanism driven by a real load signal, with criticality.',
      difficulty: 'core',
      topic: 'load-shedding',
    },
    {
      id: 'q-rl-4',
      kind: 'scenario',
      prompt:
        'An API returns a bare 429 with no headers. A client library retries immediately on 429. What happens under load?',
      options: [
        { id: 'a', label: 'Rejected clients retry at full speed, adding load exactly when the system is constrained — the limiter produces the spike it exists to prevent' },
        { id: 'b', label: 'Nothing; rejected requests are cheap to serve' },
        { id: 'c', label: 'The limiter absorbs it, since retries are also rate limited' },
        { id: 'd', label: 'The load balancer sheds the retries automatically' },
      ],
      correct: ['a'],
      explanation:
        'Rejections are cheaper than real work and not free, and immediate retries mean the rejected traffic keeps arriving. `Retry-After` is what stops each client inventing its own timing and synchronising with the others. A worse variant: if rejected requests count against the limit, the client\'s own retries extend its lockout indefinitely.',
      difficulty: 'core',
      topic: 'rate-limiting',
    },
    {
      id: 'q-rl-5',
      kind: 'scenario',
      prompt:
        'A limit of 1,000 requests/minute applies uniformly. One endpoint takes 2 ms and another takes 8 seconds. What is wrong and what is the fix?',
      options: [
        { id: 'a', label: 'The unit is count, not cost — a weighted token bucket plus a concurrency limit on the expensive endpoint expresses the real constraint' },
        { id: 'b', label: 'The limit should be lowered until the expensive endpoint is safe' },
        { id: 'c', label: 'The expensive endpoint should be cached' },
        { id: 'd', label: 'Nothing; a request is a request' },
      ],
      correct: ['a'],
      explanation:
        'A count-based limit treats requests differing by four orders of magnitude in cost as equivalent, so it is simultaneously too permissive for the expensive path and needlessly restrictive for the cheap one. Weighting by cost fixes the fairness dimension; a concurrency limit on the expensive endpoint states its constraint directly and adapts if the endpoint\'s speed changes.',
      difficulty: 'core',
      topic: 'rate-limiting',
    },
    {
      id: 'q-rl-6',
      kind: 'multi',
      prompt:
        'A shared counter enforces limits exactly. Which consequences must you plan for? Select all that apply.',
      options: [
        { id: 'a', label: 'A round trip per request, which is a meaningful share of a low-latency endpoint\'s budget' },
        { id: 'b', label: 'The store must be sized for total request volume, not per-server volume' },
        { id: 'c', label: 'You need a fail-open or fail-closed policy for when the store is unavailable' },
        { id: 'd', label: 'Bursts across window boundaries become impossible' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the real costs of putting a store in every request path — and fail-open is almost always right, with the consequence that there is no limiting during the outage. The fourth is about the algorithm, not the enforcement: centralised counting of a fixed-window counter still permits the boundary burst.',
      difficulty: 'advanced',
      topic: 'quotas',
    },
  ],

  exercises: [
    {
      id: 'ex-rl-1',
      kind: 'design',
      title: 'Layer the limits, then state the tolerance',
      estimatedMinutes: 30,
      prompt: `Design rate limiting for a public API. Facts:

- 40 API servers across 3 regions.
- 8,000 customers. Plans: Free (100 req/min), Pro (5,000 req/min), Enterprise (negotiated).
- Endpoints range from a 3 ms lookup to a 25-second report generation.
- Unauthenticated endpoints: signup, login, password reset.
- Customers integrate via SDKs and expect documented, measurable limits.

Specify: what you limit on, the algorithm per limit, the enforcement mechanism per limit, and the response contract. Then answer:

- Which limits must be exact and which can be approximate, and why?
- What stops one customer's 25-second reports from degrading everyone?
- The shared counter is unavailable for 90 seconds. What happens?
- A customer says they are being limited below their plan. How do you diagnose it?`,
      rubric: [
        'Layers limits on several dimensions: plan/API key, user, IP, and per-endpoint class.',
        'Token bucket for the plan limit, justified by legitimate client bursts.',
        'A stricter sliding window on unauthenticated endpoints, justified by abuse rather than fairness.',
        'Weighted cost or separate limits for expensive endpoints, plus a concurrency limit.',
        'Central counting for the contractual plan limit; approximate enforcement for abuse limits.',
        'Response contract includes Retry-After, quota headers on success, and documented retry guidance.',
        'Distinguishes exact from approximate with a reason tied to whether customers measure it.',
        'Expensive-endpoint answer uses concurrency and isolation, not just a rate.',
        'Outage answer specifies fail-open with a local backstop.',
        'Diagnosis answer covers per-server shares, keep-alive, region split, and counting rejected requests.',
      ],
      modelAnswer: `**The limits I would run, layered**

| # | Limit | Key | Algorithm | Enforcement |
| --- | --- | --- | --- | --- |
| 1 | Plan rate | API key | Token bucket, B and R from plan | **Central**, exact |
| 2 | Plan cost | API key | Weighted token bucket | **Central**, exact |
| 3 | Expensive concurrency | API key | Concurrency semaphore | Central, exact |
| 4 | Per-user abuse | user id | Sliding window counter | Approximate |
| 5 | Unauthenticated | IP + endpoint | Sliding window counter, strict | Approximate, fail closed |
| 6 | Global backstop | per server | Token bucket | Local only |

Six limits sounds like a lot and each catches something the others miss. **A single limit on one dimension is trivially bypassed**, and the layering is the design rather than a complication.

**1. Plan rate — token bucket, central**

\`\`\`
Free:  B = 200,   R = 100/min
Pro:   B = 1,000, R = 5,000/min
Ent:   negotiated
\`\`\`

*Why a token bucket:* customers integrate via SDKs that batch. A client fetching 50 records in a loop at page load is legitimate and would be rejected by a strict sliding window at the equivalent per-second rate. The capacity parameter says "a burst of B is fine" **deliberately**, rather than allowing it by accident at a window boundary.

*Why B = 2× the per-minute rate for Free:* a small burst allowance makes the API usable for a client doing a short batch, without materially changing sustained throughput. For Pro I set B well below the minute rate, because 5,000 at once would be a real load spike.

*Why central and exact:* this is a **published contract customers measure**. Being limited at 300 when you paid for 5,000 is a billing dispute, and "our limiter is approximate" is not an acceptable answer to a paying customer. So this one earns its round trip.

*Implementation:* a token bucket in a shared store per region, updated atomically — token count and last-refill timestamp, refilled lazily on access, in a small script so the read-modify-write is atomic.

**2. Plan cost — weighted token bucket, central**

\`\`\`
Lookup (3 ms):        1 token
Standard query:       5 tokens
Report (25 s):      500 tokens
\`\`\`

*Why this exists alongside limit 1:* a count limit treats requests differing by four orders of magnitude in cost as equivalent. A Pro customer sending 5,000 reports/minute is within their request limit and would exhaust the platform. **The cost limit is the one that expresses the actual resource constraint.**

*How the two interact:* a request must pass both. In practice the cost limit binds for expensive traffic and the rate limit binds for cheap traffic, which is exactly right.

*What I would publish:* both limits, with a table of endpoint costs. **An undocumented cost weighting is worse than none**, because a client cannot pace itself against a limit whose unit it does not know.

**3. Expensive-endpoint concurrency — semaphore, central**

\`\`\`
Reports in flight per API key: max 3
Reports in flight globally:    max 60
\`\`\`

*Why concurrency and not rate:* the constraint on a 25-second report is not "how many per minute" but "how many running at once", because each holds a worker and memory for 25 seconds. A rate limit of 10/minute permits 10 concurrent if they all arrive together, and permits far fewer if they arrive spread out — so it does not express the constraint at all.

*Why it adapts:* if reports get slower, concurrency fills and callers are throttled automatically. A rate limit would need retuning; this does not. **This is the strongest argument for concurrency limits over rate limits wherever the resource is time-held.**

*Plus a separate worker pool for reports.* A concurrency limit stops reports from exhausting workers; a separate pool stops them from queuing ahead of 3 ms lookups. Both are needed — the bulkhead pattern from the load-balancing lesson.

**4. Per-user abuse — sliding window, approximate**

\`\`\`
2,000 requests / 5 minutes per user id
\`\`\`

*Why it exists:* limit 1 is per API key. An Enterprise customer's key covers thousands of their users, so one compromised or misbehaving user inside a large tenant is invisible to the plan limit.

*Why a sliding window rather than a token bucket:* here bursts are the thing I am detecting. A single user generating a burst is a signal, not legitimate batching.

*Why approximate:* nobody has purchased a per-user limit, so nobody measures it. Local enforcement with reconciliation every 2 seconds is ample, and it keeps this off the hot-path store.

**5. Unauthenticated endpoints — strict, and fail closed**

\`\`\`
POST /login:           10 / 5 min per IP,  and 20 / hour per account
POST /signup:           5 / hour per IP
POST /password-reset:   3 / hour per account, 10 / hour per IP
\`\`\`

*Why much stricter:* these are credential-stuffing and enumeration targets, and there is no plan or contract to honour. The cost of limiting a legitimate user too aggressively here is a support contact; the cost of not limiting is an account takeover.

*Why per-account as well as per-IP:* an attacker rotating IPs defeats an IP limit, and carrier NAT means an IP limit can catch thousands of innocent users. **Both dimensions, because each covers the other's blind spot.**

*Why fail closed — the one exception:* if the counter store is unavailable, I reject login attempts rather than allowing unlimited ones. An authentication endpoint with no rate limiting is a security incident, and a brief login outage is preferable. **This is the only limit I would fail closed**, and stating it as an explicit exception is part of the design.

**6. Global per-server backstop — local, free**

\`\`\`
Each server: token bucket at 120% of its expected steady-state share
\`\`\`

*Why:* during the shared store's outage (below), limits 1–4 fail open. This local limit is the only thing standing between a client and unlimited access at that moment. It is deliberately loose so it never fires in normal operation.

**The response contract**

\`\`\`
HTTP/1.1 429 Too Many Requests
Retry-After: 12
RateLimit-Limit: 5000
RateLimit-Remaining: 0
RateLimit-Reset: 1725718800
RateLimit-Policy: 5000;w=60, cost;limit=50000;w=60
\`\`\`

And on **successful** responses:

\`\`\`
RateLimit-Remaining: 4211
RateLimit-Cost-Remaining: 38400
\`\`\`

*Why quota headers on success matter:* a client that only learns its remaining quota when rejected can only react after failing. Exposing it on every response lets a well-behaved SDK slow down before hitting the wall, which is better for both sides.

*Three rules in the contract:*

**Rejected requests do not count against the limit.** Otherwise a client that hits the limit and retries extends its own lockout forever. Cruel, and a real bug in shipped implementations.

**Documented retry guidance: exponential backoff with full jitter, honouring \`Retry-After\`.** Without jitter every rejected client retries at the same moment and they synchronise.

**Retries are safe because writes accept idempotency keys.** Telling clients to retry is only responsible if retrying cannot duplicate an effect. The retry guidance and the idempotency contract are designed together.

---

**Which limits must be exact, and which can be approximate?**

**Exact: limits 1, 2 and 3 — the plan limits.**

The test is simple: **will a customer measure this and dispute it?** A published plan limit is a commercial commitment. A customer instruments their own client, sees 3,200 successful requests against a 5,000 limit, and opens a ticket. "Our enforcement is approximate" costs more in support and trust than the round trip costs in latency.

The concurrency limit must be exact for a different reason: it protects a hard resource. Three concurrent reports per key with an approximate limiter could mean six, which is twice the memory.

**Approximate: limits 4 and 6 — abuse and backstop.**

Nobody purchased them and nobody measures them. A per-user abuse limit that fires at 2,000 or at 2,400 is equally effective, and the difference is not worth a hot-path dependency. I would enforce these locally with reconciliation every 2 seconds and **document the tolerance internally**: "effective limit 2,000 to roughly 2,600 depending on server distribution".

**The exception worth naming: limit 5 is approximate in *count* and strict in *policy*.** I do not care whether the login limit fires at 10 or 13 attempts. I care a great deal that it fires, which is why it fails closed.

*And the general principle:* **accuracy is bought with a round trip, so buy it only where inaccuracy has a cost you can name.** For the plan limits that cost is a customer dispute. For the abuse limits there is no cost.

**What stops one customer's 25-second reports from degrading everyone?**

Four mechanisms, and no single one is sufficient.

**Per-key concurrency of 3.** One customer cannot have more than three reports running, so they cannot monopolise report capacity.

**Global concurrency of 60.** All customers together cannot exceed the platform's report capacity, so a coordinated spike across many customers is also bounded. **This is the limit that a per-key limit alone would miss** — 8,000 customers × 3 concurrent is 24,000, and the sum of per-client limits exceeding capacity is exactly the failure mode from the lesson.

**A separate worker pool.** Even bounded to 60 concurrent, reports must not share workers with 3 ms lookups, or lookups queue behind them. This is the head-of-line-blocking failure from the load-balancing lesson, and the bulkhead is what prevents it.

**The cost limit (500 tokens per report).** A Pro customer with 50,000 cost-tokens per minute can run 100 reports per minute sustained, which combined with the concurrency limit bounds both the rate and the parallelism.

*And one thing I would add that is not a limit:* **make reports asynchronous.** A 25-second synchronous request holds a connection, a worker, and the client's patience. Accept the request, return a job id, and let the client poll or receive a webhook. **That converts the hardest thing to limit into an ordinary queue with a bounded worker pool**, which is a better answer than limiting it well — and it is the move I would push for before tuning any of the above.

**The shared counter is unavailable for 90 seconds**

| Limit | Behaviour |
| --- | --- |
| 1, 2, 3 (plan) | **Fail open.** Requests proceed unlimited. |
| 4 (per-user abuse) | Fail open — it is already local with reconciliation, so it degrades to a stale share rather than failing. |
| 5 (unauthenticated) | **Fail closed.** Login, signup and password reset return 503. |
| 6 (local backstop) | Unaffected — it is purely local and is now the only limit in force. |

*Why fail open for the plan limits:* a limiter outage must not be an API outage. Rejecting all traffic because we cannot count it would turn a limiter problem into a total outage, which is a strictly worse failure.

*What protects us during those 90 seconds:* limit 6, the local per-server backstop at 120% of expected share. Loose, and it caps the worst case — a single client cannot take unlimited capacity. **This is why the backstop exists**, and it is the part of the design that only makes sense once you have decided to fail open.

*Why fail closed for authentication:* unlimited login attempts is a security exposure, and a 90-second login outage is recoverable. The asymmetry justifies the different policy, and it should be a documented deliberate choice rather than an artefact of which code path was written first.

*What I would add:* an alert on limiter-store unavailability with a stated severity, and a dashboard showing "limiting is currently degraded". During an outage the on-call needs to know that the limits are not being enforced, because the next incident may be caused by it.

**A customer says they are limited below their plan. Diagnosis, in order.**

**1. Are rejected requests counting against the limit?** Check first because it is a code bug with a large effect: if a client hits the limit, retries, and each retry consumes quota, they can never recover. Their observed limit would be far below the plan. One code read.

**2. Which limit is firing?** The 429 response should say. If it does not, that is the first fix — **a 429 that does not identify which limit rejected it makes every one of these diagnoses guesswork.** I would include a machine-readable reason in the response body. Most likely candidates: the cost limit if they are calling expensive endpoints, or the concurrency limit.

**3. Are they hitting the cost limit rather than the rate limit?** A customer counting requests sees 800 and expects 5,000. If those are reports at 500 tokens each, they consumed 400,000 cost-tokens against a 50,000 budget. **They are correct that they sent 800 requests and correct that they were limited** — the limits are documented and they did not read the cost table. This is the most likely answer, and it is a documentation and error-message problem rather than a bug.

**4. Is enforcement per-region rather than global?** If the plan limit is enforced per region and the customer's traffic is concentrated in one, their effective limit is a third of the plan. **This is the design decision I made implicitly** — a shared store per region — and I should have documented whether the limit is global or per region. If global, the counter must be cross-region, which adds a cross-region round trip to every request, so per-region with the plan divided is the pragmatic choice and it must be published.

**5. Is any local enforcement involved?** If limit 6 (the backstop) is firing rather than limit 1, the customer is hitting a per-server cap. Their traffic concentrated on a few servers via keep-alive would do it. Check whether the rejections are attributable to the backstop.

**6. Are they using a shared API key across many of their users?** Then limit 4, the per-user limit, may be firing for one of their users while their aggregate is well within plan.

*The instrumentation that makes all of this a five-minute answer:* **per-key, per-limit rejection counts.** For any customer, a query showing which limit rejected them how many times over the last hour answers steps 2 through 6 immediately. Without it, every one of these conversations is an investigation.

*And the lesson from this list:* five of the six causes are the limiter working as designed and being **inadequately explained**. The response body, the documentation, and the per-limit metrics are not adjuncts to a rate limiter — they are most of the operational surface.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-rl-1',
      level: 'basic',
      question: 'What rate-limiting algorithms do you know, and how do they differ?',
      guidance:
        'Fixed window, sliding window log, sliding window counter, token bucket, leaky bucket. Look for the differences framed as what traffic shape each permits, rather than as a list of mechanics.',
    },
    {
      id: 'iq-rl-2',
      level: 'basic',
      question: 'What should a rate-limited response contain?',
      guidance:
        '429 with `Retry-After`, plus limit, remaining and reset. A strong answer adds quota headers on successful responses and notes that rejected requests must not count against the limit.',
    },
    {
      id: 'iq-rl-3',
      level: 'intermediate',
      question: 'How do you enforce one limit across forty servers?',
      guidance:
        'Central counting (exact, a round trip), local share (free, biased low), or local with reconciliation (approximate, no hot-path dependency). Look for the choice being driven by whether customers measure the limit.',
    },
    {
      id: 'iq-rl-4',
      level: 'intermediate',
      question: 'Why is a token bucket usually the right default?',
      guidance:
        'It expresses a burst allowance and a sustained rate as two parameters, matching how clients behave. A strong answer notes that a sliding window rejects legitimate batching and that B = R removes the burst allowance.',
    },
    {
      id: 'iq-rl-5',
      level: 'advanced',
      question: 'Every client is within its limit and the system is overloaded. Explain.',
      guidance:
        'The sum of per-client limits exceeds capacity, so the limiter never fires. Excellent answers distinguish fairness from protection and propose load shedding driven by a real load signal, with criticality.',
    },
    {
      id: 'iq-rl-6',
      level: 'advanced',
      question: 'How would you limit an endpoint that takes 25 seconds?',
      guidance:
        'A concurrency limit rather than a rate, because the resource is time-held; plus a separate worker pool. Excellent answers propose making it asynchronous, converting the problem into a bounded queue.',
    },
    {
      id: 'iq-rl-7',
      level: 'followup',
      question: 'Your limiter store is unavailable. Fail open or closed?',
      guidance:
        'Fail open for plan limits, so a limiter outage is not an API outage — with a loose local backstop as the only protection during it. Fail closed for authentication endpoints, where unlimited attempts is a security exposure.',
    },
    {
      id: 'iq-rl-8',
      level: 'followup',
      question: 'A customer says they are limited below their plan. How do you find out why?',
      guidance:
        'Per-key, per-limit rejection counts. Candidates: rejected requests counting against quota, a cost limit binding instead of a rate limit, per-region rather than global enforcement, or a local backstop firing. A strong answer notes most causes are the limiter working and being unexplained.',
    },
  ],

  activeLearning: [
    {
      id: 'al-rl-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed you limit requests arriving at your API. Now change one thing: you are the *client*, calling a third-party API with a limit you do not control and cannot raise. What changes, and what is the hardest part?',
      discussion: `The mechanics invert: you are no longer deciding who to reject, you are deciding how to stay inside someone else's budget. Three things become important that were irrelevant before.

**Client-side rate limiting, before you send.** Rather than discovering the limit by being rejected, run a local token bucket sized just below the published limit and let it gate your own sends. **A rejection you never triggered is free; one you did costs a round trip and possibly a penalty.** This is the single highest-value change and it is the one most integrations skip.

**Respecting \`Retry-After\` and backing off with jitter.** The provider told you when to come back. Ignoring it and retrying immediately wastes your own capacity generating rejections and, on some providers, extends the penalty.

**Client-side throttling on the rejection rate.** If a meaningful fraction of your requests are being rejected, reduce your own send rate proportionally rather than continuing at full speed. Otherwise your workers spend their time producing 429s — the provider is protected and you have degraded yourself.

**What becomes genuinely hard.**

**Coordinating your own fleet against a single external budget.** This is the same distributed-enforcement problem from the lesson, and now you *must* solve it, because the provider counts globally and does not care how many servers you run. Twenty workers each sending at the published limit means you exceed it twentyfold. So you need a shared local budget — a token bucket in a shared store that all your workers draw from — which is central enforcement with all its costs, on your side.

**Prioritising within a scarce budget.** With 1,000 calls/minute available and 5,000 wanted, *which* 5,000 you drop matters. A user-facing lookup should win over a background refresh. This needs a notion of criticality and a queue per priority — and it is the part nobody builds until they hit the limit.

**Discovering the real limit.** Published limits are frequently approximate, unevenly enforced across endpoints, or lower in practice. So you need to observe your own rejection rate as a signal and adapt — which means treating the published number as an initial estimate rather than a fact.

**The hardest part, and it is not technical.** **When you cannot get more budget, the answer is usually to need fewer calls.** Concretely: cache responses aggressively, batch requests where the API supports it, use webhooks instead of polling, and question whether every call is necessary. A polling integration checking 10,000 records every minute usually needs 100 calls, not 10,000, and the fix is a change-detection mechanism rather than a cleverer limiter.

**That reframing is the whole lesson of the inversion.** As the server, a limiter is how you allocate scarce capacity. As the client, a limiter is how you *ration* a fixed allowance — and rationing well means first reducing what you need. Teams reach for exponential backoff and a shared token bucket, and skip the question of why they are making 10,000 calls.

**The transferable point.** Both sides of a rate limit are designs, and the client side is usually undesigned — a retry-on-429 in a library, and nothing else. A well-behaved client that paces itself, respects the contract, prioritises within its budget, and minimises its call volume gets more real throughput from the same limit than one that hammers and backs off. **The limit is fixed; how much useful work you get inside it is not.**`,
    },
    {
      id: 'al-rl-2',
      kind: 'debug',
      prompt:
        'An API\'s 429 rate jumps from 0.1% to 14% for about four minutes, roughly every hour, then returns to normal. Total request volume during those windows is only 20% above baseline. No single customer dominates the rejections. Hypotheses?',
      discussion: `A 140× jump in rejections from a 20% traffic increase is the key disproportion. Something is amplifying, or the limiter's view of traffic differs from the actual traffic. And the hourly periodicity plus the four-minute duration points at something scheduled.

**Hypothesis 1 — many customers running hourly scheduled jobs that synchronise on the hour.** Cron jobs default to the top of the hour, so hundreds of customers' integrations fire simultaneously. Each is individually within its limit over the hour and all of them burst in the same four minutes. Traffic rises 20% in aggregate while individual clients briefly exceed their per-minute rate.

*Why it fits:* explains the periodicity, the modest aggregate rise, and the absence of a dominant customer. **This is the leading candidate.**

*Check:* the distribution of request timestamps within the minute at the top of the hour, and whether rejected requests come from many keys each rejected a little.

*The fix is interesting:* not a bigger limit. A token bucket with a larger capacity absorbs the burst while keeping the sustained rate — which is exactly the burst-allowance property. Or publish guidance that scheduled jobs should use a random offset, which pushes the fix to clients and works only for clients who read it.

**Hypothesis 2 — retry amplification.** If clients retry on 429 without honouring \`Retry-After\`, the initial rejections generate retries, which are also rejected, generating more. A small genuine burst becomes a large rejection count. **The 140× disproportion is the signature of amplification.**

*Why it fits:* a 20% traffic rise producing a 140× rejection rise is hard to explain without amplification. Note that retried requests may not appear as a large *volume* increase if they are cheap and fast.

*Check:* the ratio of 429s to distinct client requests. If clients are retrying five times each, the 429 count is five times the number of genuinely limited requests. Correlate with client SDK versions — one version with a bad retry policy would show up clearly.

*A worse variant to check specifically:* **are rejected requests counting against the limit?** If so, a client that hits the limit and retries extends its own lockout, and the four-minute duration would be the lockout window rather than the burst duration. That would explain why 14% persists for four minutes when the burst is shorter.

**Hypothesis 3 — a limiter-store latency spike causing fail-closed behaviour.** If the shared counter is slow — its own scheduled maintenance, a snapshot, a backup — and the limiter treats a timeout as "over limit", requests are rejected because the limiter cannot decide. Hourly periodicity strongly suggests a scheduled operation on the store.

*Why it fits:* rejections would be spread across all customers with no dominant key, which matches. And the traffic rise would be incidental rather than causal.

*Check:* limiter-store latency during the windows, and the limiter's timeout behaviour. **If a timeout produces a rejection, that is a fail-closed policy nobody chose** — and it is a common accidental implementation.

**Hypothesis 4 — a counter-expiry boundary effect.** With fixed windows keyed by minute and a TTL, a mass expiry can cause a latency spike in the store, or a race where counters are recreated and briefly mis-counted. Less likely to produce a four-minute window, but worth eliminating.

*Check:* whether the windows align with counter TTL boundaries.

**Hypothesis 5 — a deploy or scale-in resetting local counters.** If part of the limit is enforced locally and servers are recycled hourly by an autoscaler or a rolling deploy, the changing server count changes each server's share. Fewer servers means each sees more traffic against an unchanged local share.

*Check:* server count during the windows against the deploy and autoscaling schedule.

**What I would check first: the ratio of 429s to distinct client requests, and limiter-store latency, together.** They are both single queries and they split the space: amplification (hypothesis 2) versus the limiter itself failing (3, 4), versus a genuine synchronised burst (1). Given the 140× disproportion, I would expect one of the first two.

**Then: the timestamp distribution within the top-of-hour minute**, which confirms or eliminates hypothesis 1 conclusively.

**What the evidence rules out.** A single abusive customer — no dominant key. A genuine capacity problem — traffic is only 20% up. A limit set too low in general — the other 56 minutes are fine at 0.1%.

**The fixes, depending on the answer, and one that helps regardless.**

If synchronised bursts: raise the token bucket capacity, not the rate. Publish jitter guidance for scheduled jobs.

If retry amplification: ensure \`Retry-After\` is sent and honoured, add jitter to the SDK's retry policy, and **verify rejected requests do not consume quota**.

If the limiter store: fail open on timeout rather than closed, and move the store's maintenance window.

**Regardless of the answer:** per-limit and per-key rejection metrics, plus a metric distinguishing "rejected because over limit" from "rejected because the limiter could not decide". **Those are different failures with different fixes, and most limiters report them as the same 429** — which is why this investigation needs five hypotheses instead of one.

**Transferable:** a disproportion between input change and output change is the most informative signal in an incident. A 20% traffic rise producing a 140× rejection rise means something is multiplying, and the candidates for multiplication are always the same small set — retries, synchronisation, and a mechanism failing in a way that looks like a decision.`,
    },
  ],

  revision: {
    bullets: [
      'Two distinct reasons to limit: fairness (per-tenant, fixed) and protection (global, dynamic). Different mechanisms.',
      'Fixed window: cheapest, permits a 2× burst across a boundary.',
      'Sliding window log: exact, and memory grows with requests rather than with clients.',
      'Sliding window counter: `current + previous × (1 − elapsed fraction)`. Nearly exact, constant memory.',
      'Token bucket: capacity B for bursts, refill R for the sustained rate. Usually the right default.',
      'Leaky bucket trades rejection for latency, and a queued request holds resources on both sides.',
      'Choose the algorithm from what traffic shape you permit — bursts legitimate or bursts prohibited.',
      'The key you limit on matters more than the algorithm. Layer: tenant, user, IP, endpoint class.',
      'The right unit is often cost, not count — a report and a lookup are not one request each.',
      'Dividing a global limit by the server count under-limits, badly, because keep-alive concentrates clients.',
      'Central counting is exact and costs a round trip plus a dependency in every request path.',
      'Local enforcement with async reconciliation is the usual right answer for protection limits.',
      'Describe approximate enforcement as a stated tolerance, not as an exact limit.',
      'A 429 needs `Retry-After`, or every client invents its own timing and they synchronise.',
      'Expose remaining quota on successful responses so clients slow down before being rejected.',
      'Rejected requests must not count against the limit, or a client can never escape it.',
      'A rate limiter is not overload protection: within-limit traffic summing above capacity never triggers it.',
      'For internal dependencies prefer a concurrency limit — it adapts as the dependency\'s speed changes.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A mechanism that decides whether a request may proceed, based on a counter or token state keyed by some identity — used for per-client fairness, and distinct from load shedding.',
    whyItExists:
      'So one client cannot consume capacity others need, and so a published allowance can be enforced — with the algorithm fixing what traffic shape is permitted and the enforcement fixing how accurate the count is.',
    whenToUse: [
      'A token bucket for a published per-tenant limit where client bursts are legitimate.',
      'A strict sliding window on unauthenticated endpoints, where bursts are the abuse signal.',
      'A weighted limit when request cost varies by orders of magnitude.',
      'A concurrency limit for expensive or time-held operations, and for internal dependencies.',
    ],
    whenNotToUse: [
      'As overload protection — that is load shedding, driven by a load signal with criticality.',
      'To fix a slow endpoint; it only makes fewer people wait.',
      'A rate limit on an internal dependency, where a concurrency limit adapts better.',
      'When the client cannot respond to rejection and will retry forever.',
    ],
    alternatives: [
      'Load shedding with criticality, for survival under overload.',
      'Concurrency limits and bounded connection pools, for time-held resources.',
      'Bulkheads — a separate worker pool per traffic class — to prevent head-of-line blocking.',
      'Making a slow operation asynchronous, converting it into a bounded queue.',
      'Caching, batching and webhooks, when the goal is to need fewer calls.',
    ],
    tradeoffs: [
      'A token bucket buys burst tolerance and requires everything downstream to survive a burst of B.',
      'A sliding window log buys exactness and costs memory proportional to request volume.',
      'Central counting buys accuracy and costs a round trip plus a hot-path dependency.',
      'Local share is free and under-limits by an uncalculated amount.',
      'Reconciliation buys most of the accuracy for none of the latency, with bounded overshoot.',
      'Failing open buys availability during a limiter outage and costs all enforcement during it.',
    ],
    failureModes: [
      'A local share under-limiting because keep-alive concentrates a client on a few servers.',
      'A fixed window permitting double the limit across a boundary.',
      'A count-based limit treating a 3 ms lookup and a 25-second report as equivalent.',
      'A bare 429 causing synchronised immediate retries and a self-inflicted spike.',
      'Rejected requests counting against the limit, locking a retrying client out permanently.',
      'A limiter reporting healthy while within-limit traffic exceeds capacity.',
      'A limiter-store timeout treated as "over limit" — a fail-closed policy nobody chose.',
      'Many clients\' hourly cron jobs synchronising at the top of the hour.',
      'A per-region limit presented to customers as a global one.',
      'A 429 that does not say which limit fired, making every support case an investigation.',
    ],
    followUpQuestions: [
      'Is this limit for fairness or for protection? What handles the other one?',
      'What traffic shape does your algorithm permit, and is that what you intended?',
      'What are you keying on, and what abuse does that key miss?',
      'Is the unit count or cost, and do your endpoints differ by orders of magnitude?',
      'How is the limit enforced across servers, and what is the effective limit?',
      'Does your 429 carry `Retry-After` and say which limit fired?',
      'Do rejected requests consume quota?',
      'What happens when the limiter store is unavailable, and what protects you then?',
      'If every client stayed exactly within its limit, could you serve the total?',
    ],
  },
});
