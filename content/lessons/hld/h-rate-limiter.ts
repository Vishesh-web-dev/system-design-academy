import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-rate-limiter',
  title: 'Design a distributed rate limiter',
  summary:
    'The algorithm is a footnote. The design is where enforcement lives, what accuracy costs per request, and what happens when the counter store is unavailable — and those three answers are forced by whether the limit is a published contract.',
  phase: 'hld',
  module: 'core-designs',
  position: 42,
  kind: 'system-design',
  difficulty: 'core',
  estimatedMinutes: 85,
  tags: ['rate-limiting', 'distributed-counters', 'fail-open', 'api-design', 'estimation'],
  prerequisites: ['h-url-shortener'],
  resources: [
    {
      key: 'stripe-rate-limits',
      tier: 'must',
      note: 'The client-facing half of this design, published. Read what the response contains and what clients are instructed to do — that contract is half the system and candidates design none of it.',
    },
    {
      key: 'google-sre-handling-overload',
      tier: 'must',
      note: 'Read the sections on per-customer limits computed from capacity and on client-side throttling. It is the argument for why a fixed per-tenant limit does not protect you during an overload.',
    },
    {
      key: 'envoy-architecture',
      tier: 'must',
      note: 'Read the rate-limiting filter and global-rate-limit-service material. It is the concrete shape of the local-plus-central enforcement split this design arrives at.',
    },
    {
      key: 'redis-data-types',
      tier: 'good',
      note: 'The counter and sorted-set operations this design depends on. Read it with the atomicity requirement in mind — the read-modify-write trap is what makes a Lua script necessary.',
    },
    {
      key: 'aws-load-shedding',
      tier: 'good',
      note: 'Read it for the distinction between limiting a client and protecting yourself. This design does the first; the second needs different signals, and conflating them is the commonest architectural error here.',
    },
    {
      key: 'redis-cluster-spec',
      tier: 'advanced',
      note: 'Read the hash-slot material. A limiter\'s keys must be co-located for a multi-key script to work, which makes key naming a partitioning decision.',
    },
  ],

  intuition: {
    body: `A rate limiter looks like the simplest system in this phase and is one of the more interesting, because almost none of the difficulty is in the algorithm.

The algorithms — token bucket, sliding window, fixed window — were settled in the distributed-systems phase. Choosing between them takes one sentence. **What makes this a design problem is three questions the algorithm does not touch:**

**Where does enforcement happen?** At the edge proxy, in each application server, or in a dedicated service? Each answer produces a different system, and the choice is forced by whether the limit is a published contract customers will measure.

**What does accuracy cost per request?** An exact limit across forty servers needs a shared counter, which is a network round trip on every request and a new dependency in every request path. An approximate limit needs neither. **This is the central trade and it is quantifiable**, which makes it the deep dive.

**What happens when the counter store is unavailable?** Fail open and you have no limiting during the outage. Fail closed and a limiter outage becomes an API outage. **Both answers are wrong for some traffic**, and the resolution is that different limits get different policies.

And the framing that organises the whole design: **a rate limiter is two systems wearing one name.**

**A fairness limiter** enforces a per-tenant allowance. It is a published contract, it must be reasonably accurate because customers measure it, and it says the same thing whether the system is idle or on fire.

**A protection limiter** stops the system being pushed past capacity. It is global, it should respond to actual load, and exact accuracy is worthless.

Designing one mechanism for both produces something that does neither well: a fairness limit derived from a capacity estimate is wastefully low most of the time and useless during an overload, because **the sum of all tenants' limits almost always exceeds your capacity.** So a system where every tenant is compliant can still be overloaded, with the limiter reporting everything as fine.

The framing to carry: **decide whether each limit is a contract or a defence, because that decides its accuracy requirement, and the accuracy requirement decides the architecture.**`,
    analogyLimit:
      '"A counter with a threshold" describes the algorithm and none of the system. It hides that the counter must be shared across forty servers, that sharing it puts a network dependency in every request, that the response is half the design because a bare rejection produces a retry storm, and that a limiter which is a published contract has a completely different accuracy requirement from one that exists to protect you. The counter is the easy part.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds a rate limiter for their public API. Each of 40 API servers keeps an in-memory token bucket per API key, sized at the plan limit divided by 40. Launch goes fine for a week. Then two things happen: a Pro customer on a 5,000/minute plan complains they are limited at around 400/minute, and during a traffic spike the API falls over with every customer well inside their limit. Explain both, and say what the design should have been.',
      answer: `**Complaint one: limited at 400 instead of 5,000.**

The per-server share is 5,000 ÷ 40 = 125 per minute. That assumes each server sees one fortieth of that customer's traffic, and it does not, for two compounding reasons.

**HTTP keep-alive concentrates the client.** The customer's SDK holds a connection pool — say three connections. Those three connections terminate on at most three of the forty servers, and most requests go down them. So the customer reaches three servers with a share of 125 each: **375 per minute**, which is the 400 they are reporting.

**And even without keep-alive, the share arithmetic under-limits.** Distributing 5,000 requests randomly across 40 buckets gives a mean of 125 with a standard deviation of about 11. Roughly half the servers exceed 125 and reject their excess, while the global total is under 5,000. The accepted total is meaningfully below the limit, and **the shortfall grows as you add servers**, because each server's share shrinks while its relative variance grows.

**So the local-share design is biased low by an amount nobody computed**, and it is worst for exactly the well-behaved clients that pool connections.

**Complaint two: the API falls over with everyone inside their limit.**

This is the fairness-versus-protection confusion, and the arithmetic makes it obvious.

\`\`\`
Customers:              8,000
Average plan limit:     1,000 requests/minute
Sum of all limits:      8,000,000 requests/minute = 133,000/second
Actual system capacity: 40 servers × 3,000/s = 120,000/second
\`\`\`

**The sum of the limits exceeds capacity**, so a state exists in which every customer is fully compliant and the system is overloaded. The limiter never fires because no individual limit was breached, and it reports everything as fine while latency collapses.

That is not a bug in the limiter. **It is the limiter being asked to do a job it structurally cannot do** — per-tenant fairness says nothing about the aggregate.

**What the design should have been.**

**Two mechanisms, not one.**

**1. The fairness limiter, centrally counted.** The plan limit is a published contract that customers measure and dispute, so it must be accurate. That means a shared counter:

\`\`\`
Redis: token bucket per (api_key), updated atomically
Cost:  one round trip per request, ~1 ms same-region
\`\`\`

One millisecond on a 20 ms endpoint is 5% of the latency budget — real, and the correct price for a limit that appears in a contract. **The accuracy requirement came from the limit being a contract, and it justified the round trip.**

**2. The protection limiter, local and load-driven.** A concurrency limit per server — say 400 in-flight requests — plus load shedding when the queue wait exceeds the deadline. This is global, dynamic, and needs no accuracy at all: it fires when the server is actually in trouble, regardless of whose traffic caused it.

**Crucially, the protection limiter is what would have prevented the fall-over**, and it is not a rate limit. A concurrency bound is invariant to latency: when the database slows, in-flight requests accumulate, the bound is reached, and the server sheds — with nothing to retune.

**3. A local backstop for the fairness limit**, at perhaps 130% of the per-server expected share. Loose enough never to fire in normal operation, and it is the only protection during a Redis outage, since the fairness limiter fails open.

**Three further things the original design omitted.**

**The response.** A bare 429 with no \`Retry-After\` means every rejected client invents its own retry timing and they synchronise on failure — producing the load spike the limiter exists to prevent.

**Rejected requests must not consume quota.** If they do, a client that hits the limit and retries extends its own lockout indefinitely.

**Cost, not count.** A 3 ms lookup and a 25-second report are both one request. A weighted bucket — a report costs 200 tokens — expresses the actual resource constraint, and without it a customer can exhaust the platform while inside their request limit.

**The general lesson.** The team implemented an algorithm and skipped the design. **Every one of these failures is architectural: where enforcement lives, which limit is a contract, what the response says, and what unit the limit is denominated in.** The token bucket was correct throughout.`,
    },
  body: `## Step 1 — Requirements

**The clarifying questions that change this design:**

**Is the limit a published contract, or internal protection?** *Assume both — plan limits are published, and there is also unauthenticated abuse to stop.* This is the question that forces everything else, because a contract needs accuracy and protection does not.

**What is the limit denominated in — requests, or cost?** *Assume both.* Endpoints span 3 ms to 25 seconds, so a request count does not express the constraint.

**Must the limit be exact?** *For plan limits, close enough that a customer measuring it agrees. For abuse limits, no.* "Exact" is not achievable across a distributed system anyway; the target is "accurate enough not to produce a support ticket".

**What happens when the counter store is down?** *Fail open for plan limits; fail closed for authentication endpoints.* This must be decided per limit, in advance.

**Are there unauthenticated endpoints?** *Yes — login, signup, password reset.* These need much stricter limits keyed on IP and account, and they are the one place failing closed is correct.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Added latency | p99 under 3 ms | Same-region counter store, one round trip, no more |
| Limiter availability | Must not reduce API availability | Fail open, plus a local backstop |
| Accuracy (plan limits) | Within a few percent | Central counting |
| Accuracy (abuse limits) | Order of magnitude | Local counting with reconciliation |
| Scale | 200,000 requests/second peak | The counter store must serve 200,000 ops/second |

**Out of scope:** authentication itself, billing, and the plan-management UI. Assume an authenticated API key and a plan tier arrive with each request.

## Step 2 — Estimation

\`\`\`
Customers:            8,000
Peak request rate:    200,000/s
API servers:          40 (5,000/s each at peak)

Counter operations:
  Plan rate limit:    1 op/request
  Plan cost limit:    1 op/request
  Concurrency limit:  local, 0 ops
  → 400,000 counter ops/second at peak
\`\`\`

**That figure decides the counter store.** 400,000 operations per second is beyond a single Redis instance, which does perhaps 100,000 per second for scripted operations. So the counters must be **sharded across at least 6–8 Redis nodes**, keyed by API key so a customer's counters are co-located.

\`\`\`
Memory:
  Token bucket per key: 2 values (tokens, last_refill) ≈ 100 bytes with overhead
  8,000 customers × 2 limits × 100 bytes ≈ 1.6 MB
  Abuse limits keyed by IP: assume 2 million distinct IPs/day
    × 200 bytes ≈ 400 MB
  → under 1 GB. Memory is not a constraint.
\`\`\`

**Note what that eliminates: nothing about this system is storage-bound.** The constraint is operations per second and the latency of each one. That is unusual and worth saying, because it directs the design at throughput and away from capacity planning.

\`\`\`
Latency budget:
  Same-region Redis round trip:  ~0.5 ms
  Two limits, pipelined:          ~0.7 ms
  → within the 3 ms budget with room
\`\`\`

**Pipelining the two limits into one round trip is what keeps this inside budget.** Two sequential round trips would be 1.4 ms, still acceptable; three or four separate limits checked sequentially would not be.

## Step 3 — API design

**The enforcement is not an API the client calls — it is a filter in the request path.** But there are two APIs worth specifying.

**The limiter's internal interface**, called by the edge proxy or the application middleware:

\`\`\`
check(descriptors: [{key, limit, cost}]) → { allowed, remaining[], retryAfter }
\`\`\`

Taking a **list** of descriptors matters: one call checks the plan rate limit and the plan cost limit together, pipelined into a single round trip. A per-limit interface would force one round trip each.

**The client-facing contract**, which is half the design:

\`\`\`
On success:
  RateLimit-Limit: 5000
  RateLimit-Remaining: 4211
  RateLimit-Reset: 1725718800
  RateLimit-Cost-Remaining: 38400

On rejection:
  HTTP/1.1 429 Too Many Requests
  Retry-After: 12
  RateLimit-Limit: 5000
  RateLimit-Remaining: 0
  RateLimit-Policy: 5000;w=60, cost;limit=50000;w=60
  { "error": "rate_limit_exceeded", "limit": "plan_rate", "retryAfter": 12 }
\`\`\`

**Four decisions in that response, each defensible:**

**\`Retry-After\` is mandatory.** Without it every rejected client invents its own timing and they synchronise, producing a spike. This is the single most important field.

**Quota headers on *successful* responses too.** A client that learns its remaining quota only when rejected can only react after failing. Exposing it always lets a well-behaved SDK slow down before hitting the wall.

**The body names *which* limit fired.** Without it, every support case is an investigation — a customer counting requests sees 800 against a 5,000 limit and cannot know they exhausted the cost budget instead.

**Rejected requests do not consume quota.** Otherwise a client that hits the limit and retries extends its own lockout forever, which is a cruel and real bug.

## Step 4 — Data model

The counter state, in Redis:

\`\`\`
Token bucket, per (key, limit_name):
  ratelimit:{api_key}:rate   → HASH { tokens, last_refill_ms }
  ratelimit:{api_key}:cost   → HASH { tokens, last_refill_ms }
  TTL: 2 × window, so inactive keys expire

Abuse limits:
  abuse:{ip}:login           → sorted set of attempt timestamps
  abuse:{account}:login      → sorted set of attempt timestamps
  TTL: window + margin
\`\`\`

**The braces are load-bearing.** \`{api_key}\` is a Redis Cluster hash tag, so both of a customer's counters land in the same hash slot. That is required for a single Lua script to touch both atomically — and without it, the two-limits-in-one-round-trip design does not work. **Key naming is a partitioning decision**, exactly as in the partitioning lesson.

**Why a hash rather than two keys:** the token bucket needs the token count and the last-refill timestamp read and written together. One hash is one key, so the script is single-key per limit.

**The plan configuration** lives in the application's own database and is cached in each server's memory with a short TTL, because it changes rarely and reading it per request would be a second dependency:

\`\`\`
plans(plan_id PK, rate_limit, cost_limit, burst_capacity)
api_keys(key_hash PK, customer_id, plan_id, status)
endpoint_costs(route PK, cost_tokens)
\`\`\`

## Step 5 — The enforcement architecture

Three places enforcement can live, and the design uses all three for different limits.

**At the edge proxy.** Cheapest rejection — the request never reaches an application server, so a rejected request costs almost nothing. Best for abuse limits keyed on IP, because those should be rejected before consuming anything.

**In the application, before the handler.** Has the authenticated identity and the route, so it can apply plan limits and cost weights. This is where the plan limits live, because the edge does not know the endpoint's cost or the customer's plan.

**Locally, per server.** No round trip. This is where the concurrency limit and the loose backstop live.

**The resulting request path:**

\`\`\`
Client
  → Edge proxy
      · IP-based abuse limits (local counters, approximate)
      · reject here if the IP is abusive — costs nothing
  → API server
      · Local concurrency limit (400 in-flight) — protection
      · Local backstop bucket at 130% of expected share
      · Authenticate → get api_key, plan, route cost
      · ONE pipelined Redis call: plan rate + plan cost
      · reject with 429 + Retry-After, or proceed
  → Handler
\`\`\`

**Why the order matters.** Cheap local checks first, then the network call. A request rejected by the concurrency limit never touches Redis, so during an overload the limiter itself does not add load. **Putting the expensive check first would mean paying for it on requests you were going to reject anyway.**

## Step 6 — The deep dive: exact counting across 40 servers

This is the interesting part, and the trade is quantifiable.

**Why local counting fails.** Established in the prediction: keep-alive concentrates clients, and share arithmetic under-limits. The effective limit is well below the intended one, by an amount that grows with server count.

**Central counting, done correctly.** The naive implementation is a race:

\`\`\`
GET  ratelimit:{key}:rate     -- read tokens
compute refill, check, decrement
HSET ratelimit:{key}:rate     -- write back
\`\`\`

**That is a read-modify-write and it loses concurrent decrements**, so the limiter under-counts and lets extra traffic through — the Redis lesson's central mistake. The fix is a Lua script executing atomically on the server:

\`\`\`lua
-- KEYS[1] = bucket, ARGV = now_ms, rate, capacity, cost
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or tonumber(ARGV[3])
local ts     = tonumber(b[2]) or tonumber(ARGV[1])
local refill = (tonumber(ARGV[1]) - ts) * tonumber(ARGV[2]) / 1000
tokens = math.min(tonumber(ARGV[3]), tokens + refill)
if tokens < tonumber(ARGV[4]) then
  return {0, tokens}                       -- rejected
end
tokens = tokens - tonumber(ARGV[4])
redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', ARGV[1])
redis.call('EXPIRE', KEYS[1], 120)
return {1, tokens}                         -- allowed
\`\`\`

**Three properties of this script worth naming.** It is atomic, so no race. It refills **lazily** from the elapsed time rather than needing a background job. And it sets the TTL on every call, so a key can never exist without an expiry — which is the memory leak the Redis lesson warned about.

**The cost, quantified.**

\`\`\`
Per request:      1 Redis round trip, ~0.5 ms
At 200,000 req/s: 400,000 script executions/second
                  → 6–8 Redis nodes, sharded by hash tag
Latency added:    ~0.7 ms at p99 with both limits pipelined
Dependency:       Redis is now in every request path
\`\`\`

**The alternative: local enforcement with asynchronous reconciliation.** Each server enforces locally against a share, reports its usage to Redis every second, and receives an updated share proportional to the traffic it is actually seeing.

\`\`\`
Accuracy:   overshoot bounded by the sum of unreconciled allowances
            — roughly (servers × 1 second of local allowance)
Latency:    zero added
Dependency: none in the request path
Complexity: significantly more code
\`\`\`

**Which for which limit, and the reasoning is the whole answer.**

**Plan limits: central counting.** They are a published contract. A customer measuring 3,200 successful requests against a 5,000 limit opens a billing dispute, and "our enforcement is approximate" is not an acceptable answer to someone paying for the higher tier. **The contract justifies the round trip.**

**Abuse limits: local with reconciliation.** Nobody purchased a per-IP abuse limit and nobody measures it. Firing at 10 attempts or 13 is equally effective. **No accuracy requirement means no round trip.**

**The refinement that reduces the Redis load substantially.** Most requests are nowhere near the limit. A server can hold a **local lease**: request 50 tokens from Redis in one call, then serve 50 requests locally before going back. That cuts Redis operations by 50× at the cost of up to 50 tokens of overshoot per server per lease.

\`\`\`
Without leasing: 400,000 Redis ops/second
With 50-token leases: ~8,000 Redis ops/second
Overshoot: up to 40 servers × 50 tokens = 2,000 requests
\`\`\`

**For a 5,000/minute limit, 2,000 of overshoot is 40% — too much.** But leases can be sized to the limit: lease 2% of the limit, so overshoot stays around 40 × 2% = 80% of one limit-unit... which is still significant. **Leasing works well for large limits and badly for small ones**, so the honest design leases only for limits above a threshold and counts centrally below it. Saying that trade-off out loud, with the arithmetic, is the strongest version of this answer.

## Step 7 — What breaks at 10×

**2 million requests/second, 80,000 customers.**

**Redis operation rate becomes the constraint.** 4 million script executions per second needs 40–60 Redis nodes purely for rate limiting, which is a substantial fleet to operate for a filter.

*The fix, in order:* apply leasing to every limit above a threshold, accepting bounded overshoot; then move abuse limits entirely local; then, if still constrained, shift plan limits to reconciliation and change the published contract to state a tolerance — "the effective limit is between 5,000 and 5,500 per minute". **That last step is a product decision, not a technical one**, and it is the honest way to buy the throughput.

**Hot keys.** A single very large customer at 500,000 requests/second concentrates on one hash slot, so one Redis node takes all of it. *Fix:* shard that customer's counter — \`{api_key}:rate:{0..15}\` — with each server addressing a random shard and the limit divided by 16. That reintroduces the local-share under-limiting problem within one customer, bounded and acceptable at that scale.

**Configuration propagation.** 80,000 customers' plan data cached in 400 servers is a cache-invalidation problem when a plan changes. *Fix:* a short TTL — 60 seconds — plus accepting that a plan upgrade takes a minute to take effect. Cheap, and worth stating as a deliberate staleness decision.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| One Redis shard down | Plan limits for keys on that shard cannot be checked | **Fail open** — requests proceed; the local backstop is the only limit |
| All Redis down | No plan limits enforced | **Fail open**, backstop only, alert at high severity |
| Redis slow (not down) | Latency added to every request | **Timeout at 5 ms and fail open** — a slow limiter must not become the latency |
| API server down | Its local counters lost | Backstop resets; negligible |
| Edge proxy down | IP abuse limits not enforced | Application-level limits still apply |
| Auth endpoint limits, Redis down | Cannot count login attempts | **Fail closed** — reject logins with 503 |

**Three of those rows carry the real content.**

**Fail open for plan limits**, because a limiter outage must not be an API outage. The consequence — no limiting during the outage — is why the local backstop exists, and the backstop is the only thing standing between a client and unlimited access at that moment.

**A timeout on the Redis call, failing open.** A limiter that is slow rather than down is more dangerous than one that is down: it adds its latency to every request. **Treating a timeout as "allowed" rather than "over limit" is a deliberate policy**, and the opposite — treating a timeout as a rejection — is a fail-closed policy nobody chose.

**Fail closed for authentication endpoints**, the one exception. Unlimited login attempts is a security exposure and a brief login outage is recoverable. The asymmetry justifies the different policy and it should be documented as a decision rather than being an artefact of which code path was written first.

## Step 9 — Defending it

**"I chose central counting for plan limits and local counting for abuse limits, because accuracy is only worth a round trip when a customer will measure it.** Plan limits are a published contract; a per-IP abuse limit is not, so it gets local enforcement with reconciliation and no hot-path dependency.

**I chose a concurrency limit rather than a rate limit for protection**, because the sum of all customers' plan limits exceeds our capacity — so a state exists where everyone is compliant and we are overloaded. A per-tenant rate limit structurally cannot catch that. The concurrency bound is invariant to latency, so when a dependency slows it fires automatically with nothing to retune.

**I chose fail-open everywhere except authentication.** A limiter outage becoming an API outage is a worse failure than a period of no limiting, and the local backstop bounds the exposure. Authentication is the exception because unlimited login attempts is a security incident.

**What I gave up:** exactness. Even with central counting there is a small window, leasing adds bounded overshoot, and during a Redis outage there is effectively no plan limiting. I would publish the tolerance rather than claim an exact limit.

**What would make me revisit it:** if plan limits stopped being a published contract — an internal-only API — I would move everything to local enforcement and remove Redis from the request path entirely. And if the request rate reached 2 million per second, I would have to buy throughput by relaxing the published accuracy, which is a product conversation before it is a technical one."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'enforcement-path',
      title: 'Three enforcement layers, cheapest check first',
      caption:
        'Step through it. The ordering is deliberate: local checks precede the network call, so a request rejected during an overload never adds load to the limiter itself.',
      nodes: [
        { id: 'client', label: 'Client SDK', kind: 'client', x: 0, y: 200, detail: 'Holds a connection pool of three, which is why a per-server share design limits this customer at three shares rather than forty.' },
        { id: 'edge', label: 'Edge proxy', kind: 'service', x: 170, y: 200, detail: 'IP-based abuse limits with local counters. Rejects here cost almost nothing because the request never reaches an application server — which is why abuse limits belong at the edge.' },
        { id: 'conc', label: 'Local concurrency limit', kind: 'service', x: 350, y: 90, detail: '400 in-flight per server. This is PROTECTION, not fairness: invariant to latency, so when a dependency slows the slots fill and the server sheds with nothing to retune.' },
        { id: 'backstop', label: 'Local backstop bucket', kind: 'service', x: 350, y: 190, detail: '130% of the expected per-server share. Loose enough never to fire normally, and it is the only limit in force during a Redis outage.' },
        { id: 'auth', label: 'Authenticate → key, plan, route cost', kind: 'service', x: 350, y: 290, detail: 'The edge cannot apply plan limits because it does not know the plan or the endpoint cost. This is why plan enforcement lives in the application rather than at the proxy.' },
        { id: 'redis', label: 'Redis: one pipelined script', kind: 'store', x: 600, y: 200, detail: 'Plan rate and plan cost in one round trip, ~0.7 ms at p99. Atomic Lua so there is no read-modify-write race, with lazy refill and a TTL set on every call.' },
        { id: 'reject', label: '429 + Retry-After + which limit', kind: 'note', x: 600, y: 60, detail: 'Half the design. Without Retry-After clients synchronise their retries; without naming the limit every support case is an investigation; and rejected requests must not consume quota.' },
        { id: 'handler', label: 'Handler', kind: 'service', x: 810, y: 200, detail: 'Reached only after all three layers pass. Success responses carry remaining quota so a well-behaved client can slow down before being rejected.' },
      ],
      edges: [
        { id: 'e1', source: 'client', target: 'edge', kind: 'sync' },
        { id: 'e2', source: 'edge', target: 'conc', kind: 'sync' },
        { id: 'e3', source: 'conc', target: 'backstop', kind: 'control' },
        { id: 'e4', source: 'backstop', target: 'auth', kind: 'control' },
        { id: 'e5', source: 'auth', target: 'redis', kind: 'sync' },
        { id: 'e6', source: 'redis', target: 'handler', kind: 'sync' },
        { id: 'e7', source: 'redis', target: 'reject', kind: 'control' },
      ],
      steps: [
        {
          id: 'ep1',
          title: 'Abuse limits at the edge, because rejection is free there',
          description:
            'IP-keyed counters at the proxy. A request rejected here never reaches an application server, and these limits need no accuracy — nobody purchased a per-IP allowance.',
          nodes: ['client', 'edge'],
          edges: ['e1'],
        },
        {
          id: 'ep2',
          title: 'Then local protection, with no network call',
          description:
            'A concurrency bound and a loose backstop bucket. Both are local, so during an overload the checks that reject cheapest run first and the limiter adds no load of its own.',
          nodes: ['conc', 'backstop'],
          edges: ['e2', 'e3'],
        },
        {
          id: 'ep3',
          title: 'Plan limits need identity and route cost',
          description:
            'Which is why they cannot live at the edge: the proxy knows neither the customer plan nor that this endpoint costs 200 tokens rather than 1.',
          nodes: ['auth'],
          edges: ['e4'],
        },
        {
          id: 'ep4',
          title: 'One atomic script for both plan limits',
          description:
            'Rate and cost pipelined into a single round trip. Atomic Lua avoids the read-modify-write race, refills lazily from elapsed time, and sets a TTL so no key can leak.',
          nodes: ['redis'],
          edges: ['e5', 'e6'],
        },
        {
          id: 'ep5',
          title: 'And the rejection is half the design',
          description:
            'Retry-After stops clients synchronising, the body names which limit fired, and rejected requests do not consume quota — otherwise a retrying client locks itself out permanently.',
          nodes: ['reject'],
          edges: ['e7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'accuracy-cost',
      title: 'What accuracy costs, and which limits are worth it',
      caption:
        'The decision is not technical. Read the bottom row: whether a limit is a published contract determines its accuracy requirement, and the accuracy requirement determines the architecture.',
      code: `flowchart TB
    Q["How is this limit enforced<br/>across 40 servers?"]

    Q --> L["**Local share**<br/>limit ÷ 40 per server"]
    L --> L1["Zero latency, no dependency"]
    L1 --> L2["**Biased LOW.** Keep-alive puts a<br/>3-connection client on 3 servers<br/>→ limited at 3/40 of the plan.<br/>Worse as servers are added"]

    Q --> C["**Central counting**<br/>atomic Lua per request"]
    C --> C1["Accurate to a few percent"]
    C1 --> C2["~0.7 ms per request ·<br/>400k ops/s at 200k req/s ·<br/>Redis in every request path ·<br/>needs a fail-open policy"]

    Q --> R["**Local + async reconciliation**<br/>report usage every second"]
    R --> R1["Overshoot bounded by<br/>servers × 1 s of allowance"]
    R1 --> R2["Zero latency, no hot-path<br/>dependency, more code"]

    Q --> LE["**Central + local leasing**<br/>lease N tokens at a time"]
    LE --> LE1["Redis ops ÷ N"]
    LE1 --> LE2["Overshoot ≈ servers × N.<br/>Good for large limits,<br/>bad for small ones"]

    C2 --> D["**Is this limit a published<br/>contract customers measure?**"]
    R2 --> D
    LE2 --> D
    D --> D1["YES → central counting.<br/>A billing dispute costs more<br/>than 0.7 ms"]
    D --> D2["NO → local + reconciliation.<br/>Nobody measures a per-IP<br/>abuse limit"]

    style L2 fill:#2a1a1a,stroke:#a04848
    style D1 fill:#17272a,stroke:#35897e
    style D2 fill:#17272a,stroke:#35897e
    style LE2 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: ['stripe'],
    body: `Stripe's published rate-limiting behaviour is the closest public reference for this design, and it validates three of its decisions while showing one thing this design would do differently.

**Several limits on different dimensions, simultaneously.** A request-rate limit, a concurrency limit, and separate treatment for read and write operations. That is exactly the fairness-plus-protection split: the request rate is the published contract, and the concurrency limit is the protection that catches a customer sending few but very expensive requests. **One limit on one dimension does not express a real constraint**, and a public API confirms it in practice.

**Different limits for test and live modes.** A small detail with a large implication: test traffic is automated and bursty, live traffic is human-paced. **Limits should reflect the traffic shape of the workload**, not be a single number applied uniformly — which argues for the burst-capacity parameter in the plan configuration above.

**The response carries explicit retry guidance**, and clients are instructed to back off exponentially with jitter rather than retrying immediately. This is the half of the design candidates omit, and it is published as part of the contract precisely because a limiter whose clients retry badly produces the spike it exists to prevent.

**Idempotency keys are designed together with the retry guidance.** Telling a client to retry is only responsible if retrying cannot duplicate an effect. **That pairing is the detail worth copying:** a rate-limit contract that says "retry with backoff" and an API that is not idempotent are inconsistent with each other.

**Limits are documented rather than discovered.** A published limit is one a client can pace itself against; an undocumented one is discovered in production by a client that has already built something exceeding it.

**What this design does differently, and why.** Stripe's limits are presented as firm published numbers. This design leases tokens locally for large limits, accepting bounded overshoot to reduce Redis load by an order of magnitude — which means the effective limit can slightly exceed the published one. **That is a defensible trade in the direction of generosity** (a customer occasionally getting a few extra requests does not complain), and it would be indefensible in the other direction. **Overshoot is acceptable; undershoot is a support ticket.** Recognising that the error is asymmetric is what makes leasing safe here.

**The transferable questions:** which of your limits is a contract, does your response tell the client when to return, and is retrying safe?`,
  },

  tradeoffs: {
    intro:
      'The decisions specific to building this system, as opposed to choosing an algorithm. Rows are the choices the design actually turns on.',
    rows: [
      {
        option: 'Local share (limit ÷ server count)',
        whenItWins:
          'Only as a loose backstop, set well above the expected share so it never fires in normal operation.',
        whenItLoses:
          'As the primary mechanism. Keep-alive concentrates clients onto a few servers, so a pooled client is limited at a fraction of its plan — and it worsens as servers are added.',
        cost:
          'An effective limit well below the published one, biased in the direction that generates support tickets.',
      },
      {
        option: 'Central counting with an atomic script',
        whenItWins:
          'For any limit that is a published contract. Accurate to a few percent, and the round trip is justified because a billing dispute costs more than 0.7 ms.',
        whenItLoses:
          'When the added latency is unaffordable, or at a request rate where the counter fleet becomes larger than the service it protects.',
        cost:
          '~0.7 ms per request, a counter store sized for total request volume, and a dependency in every request path needing a fail-open policy.',
      },
      {
        option: 'Local enforcement with async reconciliation',
        whenItWins:
          'For abuse limits and anything nobody measures. Zero added latency, no hot-path dependency, and accuracy within an order of magnitude.',
        whenItLoses:
          'For contractual limits, where bounded overshoot is still a number a customer can dispute.',
        cost:
          'Overshoot up to the sum of unreconciled allowances, and materially more code.',
      },
      {
        option: 'Central counting with local leasing',
        whenItWins:
          'Large limits at high request rates. Leasing 50 tokens cuts counter operations 50-fold.',
        whenItLoses:
          'Small limits, where overshoot of servers × lease size is a large fraction of the limit itself.',
        cost:
          'Overshoot proportional to server count times lease size, so it must be applied only above a threshold.',
      },
      {
        option: 'Count requests',
        whenItWins:
          'When endpoint costs are uniform, which is rare.',
        whenItLoses:
          'When a 3 ms lookup and a 25-second report are both one request — the limit is simultaneously too permissive and too restrictive.',
        cost:
          'A customer can exhaust the platform while inside their request limit.',
      },
      {
        option: 'Weight by cost, plus a concurrency limit on expensive routes',
        whenItWins:
          'When endpoint costs span orders of magnitude. The weighted bucket expresses the resource constraint; the concurrency limit expresses the time-held constraint.',
        whenItLoses:
          'When costs are uniform, making the weighting pure complexity.',
        cost:
          'A cost per endpoint to assign, maintain and publish — and an undocumented weighting is worse than none.',
      },
      {
        option: 'Fail open when the counter store is unavailable',
        whenItWins:
          'For plan limits, always. A limiter outage must not become an API outage.',
        whenItLoses:
          'For authentication endpoints, where unlimited attempts is a security exposure.',
        cost:
          'No plan limiting during the outage, bounded only by the local backstop.',
      },
      {
        option: 'Fail closed when the counter store is unavailable',
        whenItWins:
          'Authentication endpoints only. A brief login outage is preferable to unlimited credential attempts.',
        whenItLoses:
          'Everywhere else. It converts a limiter problem into a total outage.',
        cost:
          'Rejecting traffic that would have succeeded, for as long as the store is down.',
      },
      {
        option: 'A per-tenant rate limit as overload protection',
        whenItWins:
          'Nowhere. The sum of all tenants\' limits almost always exceeds capacity.',
        whenItLoses:
          'Precisely during an overload: every tenant is compliant, nothing fires, and the limiter reports health while latency collapses.',
        cost:
          'A false belief that you are protected, which is worse than knowing you are not.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Each server keeps an in-memory token bucket sized at the plan limit divided by the server count."',
      whyWeak:
        'It assumes traffic distributes evenly across servers. Keep-alive means a client with a three-connection pool reaches three servers, so it is limited at 3/40 of its plan. And even with perfect randomness the share arithmetic under-limits, worsening as servers are added.',
      strongAnswer:
        '"Dividing by the server count under-limits badly, because connection pooling concentrates each client on a few servers. For a published plan limit I would count centrally in Redis with an atomic Lua script — one round trip, about 0.7 ms, which is the right price for a limit a customer will measure. The per-server bucket survives only as a loose backstop at 130% of the expected share, for use when Redis is unavailable."',
    },
    {
      weakAnswer: '"We enforce per-customer rate limits, so the API is protected from overload."',
      whyWeak:
        'Per-tenant fairness says nothing about the aggregate. With 8,000 customers averaging 1,000 requests/minute, the sum of limits is 133,000/second against a capacity of 120,000 — so a state exists where everyone is compliant and the system is overloaded, and the limiter never fires.',
      strongAnswer:
        '"Those are two different mechanisms. Plan limits are per-tenant fairness and they are a published contract. Overload protection needs a global, load-driven mechanism: a concurrency limit per server plus shedding when the queue wait exceeds the deadline. The concurrency bound is the important one because it is invariant to latency — when a dependency slows, the slots fill and the server sheds with nothing to retune."',
    },
    {
      weakAnswer: '"We read the current count from Redis, check it against the limit, and write back the increment."',
      whyWeak:
        'A read-modify-write across a network loses concurrent decrements, so the limiter under-counts and admits extra traffic. It is also three round trips per request rather than one.',
      strongAnswer:
        '"That race loses concurrent decrements. I would use an atomic Lua script executing on the Redis node: it reads the bucket, refills lazily from elapsed time, checks and decrements, and sets the TTL — all in one indivisible operation and one round trip. The lazy refill removes the need for any background job, and setting the TTL on every call means a bucket can never exist without an expiry."',
    },
    {
      weakAnswer: '"When the limit is exceeded we return 429."',
      whyWeak:
        'A bare 429 leaves the client to invent its own retry timing, so rejected clients synchronise and produce the spike the limiter exists to prevent. It also does not say which limit fired, making every support case an investigation.',
      strongAnswer:
        '"The response is half the design. 429 with `Retry-After`, plus limit, remaining and reset headers — and those headers on successful responses too, so a client can slow down before being rejected rather than after. The body names which limit fired, because a customer counting requests against a 5,000 limit cannot otherwise know they exhausted the cost budget. And rejected requests must not consume quota, or a retrying client locks itself out permanently."',
    },
    {
      weakAnswer: '"If Redis is unavailable we reject requests, to be safe."',
      whyWeak:
        'That converts a limiter outage into an API outage, which is a far worse failure. And a Redis that is slow rather than down is worse still — treating a timeout as "over limit" is a fail-closed policy nobody deliberately chose.',
      strongAnswer:
        '"Fail open for plan limits: a limiter outage must not be an API outage, and the local backstop bucket is the only protection during it — which is why the backstop exists. I would also put a 5 ms timeout on the Redis call and treat a timeout as allowed, because a slow limiter adding latency to every request is more dangerous than no limiter. Authentication endpoints are the single exception and fail closed, since unlimited login attempts is a security exposure."',
    },
    {
      weakAnswer: '"The limit is 5,000 requests per minute across the whole API."',
      whyWeak:
        'It treats a 3 ms lookup and a 25-second report as equivalent. A customer sending 5,000 reports is inside their limit and will exhaust the platform; one sending 5,001 lookups is rejected for no reason.',
      strongAnswer:
        '"The unit should be cost, not count. A weighted token bucket — a lookup costs 1 token, a report 200 — expresses the actual resource constraint, and I would publish the cost table because an undocumented weighting is worse than none. Separately, the expensive route gets a concurrency limit, since \'no more than three reports running at once\' states its constraint more directly than any rate and adapts if the route gets faster."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hrl-1',
      front: 'What are the three design questions a rate limiter turns on?',
      back: 'Where enforcement lives, what accuracy costs per request, and what happens when the counter store is unavailable. The algorithm is a footnote.',
      topic: 'rate-limiting',
    },
    {
      id: 'fc-hrl-2',
      front: 'Why is a rate limiter two systems wearing one name?',
      back: 'Fairness (per-tenant, published, needs accuracy) and protection (global, load-driven, needs none). One mechanism for both does neither well.',
      topic: 'rate-limiting',
    },
    {
      id: 'fc-hrl-3',
      front: 'Why does a per-tenant rate limit not protect against overload?',
      back: 'The sum of all tenants\' limits almost always exceeds capacity, so everyone can be compliant while the system is overloaded — and nothing fires.',
      topic: 'rate-limiting',
    },
    {
      id: 'fc-hrl-4',
      front: 'Why does dividing a limit by the server count under-limit?',
      back: 'Keep-alive concentrates a client on as many servers as it has connections, so a 3-connection client gets 3/40 of its plan. Random distribution also under-limits, worsening with server count.',
      topic: 'distributed-counters',
    },
    {
      id: 'fc-hrl-5',
      front: 'What decides whether a limit deserves central counting?',
      back: 'Whether it is a published contract customers measure. A billing dispute costs more than 0.7 ms; a per-IP abuse limit nobody measures does not justify a round trip.',
      topic: 'distributed-counters',
    },
    {
      id: 'fc-hrl-6',
      front: 'Why must the counter update be an atomic script?',
      back: 'A read-modify-write across a network loses concurrent decrements, so the limiter under-counts. A Lua script makes read, refill, check, decrement and TTL one indivisible operation and one round trip.',
      topic: 'distributed-counters',
    },
    {
      id: 'fc-hrl-7',
      front: 'What two things does lazy refill in the script buy?',
      back: 'No background refill job, and the TTL can be set on every call — so a bucket can never exist without an expiry and leak memory.',
      topic: 'distributed-counters',
    },
    {
      id: 'fc-hrl-8',
      front: 'What does local leasing buy and cost?',
      back: 'Leasing 50 tokens cuts counter operations 50-fold and costs overshoot of roughly servers × lease size — good for large limits, bad for small ones.',
      topic: 'distributed-counters',
    },
    {
      id: 'fc-hrl-9',
      front: 'Why is overshoot acceptable where undershoot is not?',
      back: 'The error is asymmetric: a customer occasionally getting extra requests does not complain, while a customer limited below their plan opens a billing dispute.',
      topic: 'rate-limiting',
    },
    {
      id: 'fc-hrl-10',
      front: 'Why are abuse limits enforced at the edge and plan limits in the application?',
      back: 'An edge rejection costs almost nothing and IP limits need no identity. Plan limits need the authenticated key, the plan tier and the route cost, which the proxy does not have.',
      topic: 'api-design',
    },
    {
      id: 'fc-hrl-11',
      front: 'Why do local checks come before the Redis call?',
      back: 'A request rejected by the concurrency limit never touches Redis, so during an overload the limiter adds no load of its own.',
      topic: 'api-design',
    },
    {
      id: 'fc-hrl-12',
      front: 'What must a 429 response contain, and why?',
      back: '`Retry-After` above all, or clients synchronise their retries. Plus which limit fired, plus quota headers on successes so clients slow down before being rejected.',
      topic: 'api-design',
    },
    {
      id: 'fc-hrl-13',
      front: 'What is the fail-open policy, and the one exception?',
      back: 'Fail open for plan limits, with a timeout treating slow as allowed, because a limiter outage must not be an API outage. Authentication endpoints fail closed.',
      topic: 'fail-open',
    },
    {
      id: 'fc-hrl-14',
      front: 'Why do the counter keys need a hash tag?',
      back: 'So a customer\'s rate and cost buckets share a Redis Cluster slot, which a single script touching both requires. Key naming is a partitioning decision.',
      topic: 'distributed-counters',
    },
  ],

  quiz: [
    {
      id: 'q-hrl-1',
      kind: 'scenario',
      prompt:
        'A 5,000/minute plan limit is enforced as 125 per minute on each of 40 servers. A customer whose SDK pools three connections reports being limited at around 375/minute. Why?',
      options: [
        { id: 'a', label: 'Keep-alive puts their traffic on three servers, so they receive three shares of 125 rather than forty' },
        { id: 'b', label: 'The load balancer is misconfigured and not distributing evenly' },
        { id: 'c', label: 'The per-server counters are expiring too early' },
        { id: 'd', label: 'The customer is sending more than 5,000 requests and the excess is being rejected' },
      ],
      correct: ['a'],
      explanation:
        'A pooled client reaches at most as many servers as it has connections, so its effective limit is pool size × per-server share. The balancer is behaving normally — it distributes connections, not requests per key. This is why a published contract needs central counting rather than a local share.',
      difficulty: 'core',
      topic: 'distributed-counters',
    },
    {
      id: 'q-hrl-2',
      kind: 'scenario',
      prompt:
        '8,000 customers each have a 1,000/minute limit. System capacity is 120,000 requests/second. What does the arithmetic tell you?',
      options: [
        { id: 'a', label: 'The sum of limits is 133,000/s, above capacity — so all customers can be compliant while the system is overloaded, and the limiter never fires' },
        { id: 'b', label: 'The limits are set correctly, since capacity exceeds the average load' },
        { id: 'c', label: 'The limits should be raised, since capacity is under-used' },
        { id: 'd', label: 'Capacity should be raised to 133,000/s to match the sum of limits' },
      ],
      correct: ['a'],
      explanation:
        '8,000 × 1,000 ÷ 60 ≈ 133,000/second. A per-tenant limit is fairness, not protection, and the sum exceeding capacity means a fully-compliant overload is reachable. Provisioning for the sum of limits is prohibitively expensive; the answer is a separate load-driven protection mechanism.',
      difficulty: 'advanced',
      topic: 'rate-limiting',
    },
    {
      id: 'q-hrl-3',
      kind: 'scenario',
      prompt:
        'A limiter does `GET` the counter, checks it in the application, then `SET` the new value. Under concurrency the effective limit is above the configured one. Why?',
      options: [
        { id: 'a', label: 'The read-modify-write loses concurrent decrements, so the counter under-counts and extra traffic is admitted' },
        { id: 'b', label: 'Network latency delays the `SET`, so the window shifts' },
        { id: 'c', label: 'Redis is evicting the counter under memory pressure' },
        { id: 'd', label: 'The TTL is being reset on every request' },
      ],
      correct: ['a'],
      explanation:
        'Two concurrent requests both read the same value, both compute the decrement, and one write is lost — so the limiter counts fewer requests than occurred. An atomic Lua script makes read, refill, check, decrement and TTL one indivisible operation. Resetting the TTL is a separate real bug in fixed-window designs.',
      difficulty: 'core',
      topic: 'distributed-counters',
    },
    {
      id: 'q-hrl-4',
      kind: 'scenario',
      prompt:
        'Redis becomes slow — 200 ms per operation rather than 0.5 ms — but is not down. What should the limiter do?',
      options: [
        { id: 'a', label: 'Time out at a few milliseconds and treat the timeout as allowed, because a slow limiter adding latency to every request is worse than no limiter' },
        { id: 'b', label: 'Wait for the response, since correctness of the limit matters most' },
        { id: 'c', label: 'Treat the timeout as over-limit and reject, to stay safe' },
        { id: 'd', label: 'Retry the operation until it succeeds' },
      ],
      correct: ['a'],
      explanation:
        'Without a timeout the limiter adds 200 ms to every request, which is a self-inflicted outage. Treating a timeout as a rejection is a fail-closed policy nobody chose and turns limiter slowness into an API outage. Retrying makes it worse by adding load to a struggling store.',
      difficulty: 'advanced',
      topic: 'fail-open',
    },
    {
      id: 'q-hrl-5',
      kind: 'scenario',
      prompt:
        'A design leases 50 tokens per server at a time to cut Redis load. For which limit is this a bad idea?',
      options: [
        { id: 'a', label: 'A small limit — with 40 servers, overshoot of up to 2,000 tokens is a large fraction of a 5,000/minute limit' },
        { id: 'b', label: 'A large limit, because the lease is proportionally too small to help' },
        { id: 'c', label: 'Any limit, because leasing breaks atomicity' },
        { id: 'd', label: 'Abuse limits, because they must be exact' },
      ],
      correct: ['a'],
      explanation:
        'Overshoot is roughly servers × lease size, so 40 × 50 = 2,000 — 40% of a 5,000 limit and unacceptable for a contract. Leasing is efficient precisely for large limits where the overshoot is a small percentage. Abuse limits are the ones that need least accuracy, so leasing suits them well.',
      difficulty: 'advanced',
      topic: 'distributed-counters',
    },
    {
      id: 'q-hrl-6',
      kind: 'multi',
      prompt:
        'Which belong in the design of the rejection response? Select all that apply.',
      options: [
        { id: 'a', label: '`Retry-After`, so rejected clients do not synchronise their retries' },
        { id: 'b', label: 'Which limit fired, so support cases are not investigations' },
        { id: 'c', label: 'Quota headers on successful responses too, so clients slow down before being rejected' },
        { id: 'd', label: 'Counting the rejected request against the limit, to discourage retrying' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are what make the client-facing half of the design work. The fourth is a cruel and real bug: if rejections consume quota, a client that hits the limit and retries extends its own lockout indefinitely and can never recover.',
      difficulty: 'core',
      topic: 'api-design',
    },
  ],

  exercises: [
    {
      id: 'ex-hrl-1',
      kind: 'design',
      title: 'Change one requirement and re-derive the design',
      estimatedMinutes: 40,
      prompt: `Take the design in this lesson and change exactly one requirement in each case. For each, say what changes, what stays, and what new problem appears.

1. **The API is internal only.** No published contract, no customers, no billing disputes.
2. **Added latency budget drops to 0.2 ms p99.** The API is a low-latency trading endpoint.
3. **The limit must be global across three regions**, not per region.
4. **Endpoint costs are now dynamic** — the same route can cost 1 or 500 tokens depending on the query.
5. **A single customer is 60% of all traffic** at 120,000 requests/second on their own.

Then answer:

- Which change most simplifies the design, and which most complicates it?
- Which two changes are mutually incompatible, and what would you do if given both?
- For change 3, compute the latency cost and say whether the requirement is achievable.`,
      rubric: [
        'Change 1: removes central counting and the Redis dependency entirely, with reasoning tied to accuracy.',
        'Change 2: identifies that any network round trip exceeds the budget, forcing local enforcement.',
        'Change 3: computes cross-region round-trip latency and concludes the requirement conflicts with the latency budget.',
        'Change 4: identifies that cost must be known before the limiter runs, or the limiter runs after the work.',
        'Change 5: identifies the hot-key problem and proposes sharding or dedicated capacity.',
        'Names change 1 as the biggest simplification and 3 or 4 as the biggest complication.',
        'Identifies the incompatibility between the tight latency budget and global counting.',
        'Change 3 arithmetic is explicit and the conclusion is stated as a product trade-off.',
      ],
      modelAnswer: `**1. Internal API only — the biggest simplification available**

**What changes: central counting disappears entirely.**

The whole justification for a Redis round trip on every request was that plan limits are a published contract customers measure and dispute. **Remove the contract and the accuracy requirement evaporates.** Nobody files a support ticket because an internal service was limited at 4,200 instead of 5,000.

\`\`\`
Before: local checks → Redis atomic script → handler
After:  local checks → handler
\`\`\`

**What the design becomes:**

- **Per-caller local token buckets** with asynchronous reconciliation every second. Each server reports its usage and receives an updated share proportional to the traffic it sees, which fixes the keep-alive concentration problem without a hot-path dependency.
- **Concurrency limits per caller**, which for internal traffic are the better primitive anyway — "no more than 50 in-flight from the batch service" adapts as the endpoint's latency changes, where a rate limit is a fixed guess.
- **Redis leaves the request path.** It becomes a reconciliation channel consulted off-path, so its unavailability degrades share accuracy rather than affecting requests at all.

**What stays:** the response contract, and this is worth stating. Internal callers still need \`Retry-After\` or they synchronise their retries just as external ones do. **The client-facing half of the design is not about customers, it is about clients.**

**What new problem appears: nobody notices when it is wrong.** With external customers, a mis-limited caller complains. Internally, a batch job silently limited at a fifth of its allowance just runs slowly, and nobody investigates for months. **So the observability requirement goes up as the accuracy requirement goes down** — I would add a metric of allowance-versus-usage per caller, alerted when a caller is persistently near its limit, because that is now the only detection mechanism.

**2. Latency budget 0.2 ms p99 — forces local, and the arithmetic is decisive**

\`\`\`
Same-region Redis round trip:  ~0.5 ms p50, ~1–2 ms p99
Budget:                         0.2 ms p99
\`\`\`

**No network call fits.** A same-datacentre round trip is 0.5 ms at best, and the p99 is several times that once queuing and TLS are included. **The requirement forbids central counting outright**, not marginally.

**What the design becomes: entirely local, in-process.**

- **In-process token buckets** in the application's own memory. No network, no serialisation, no round trip — a few hundred nanoseconds.
- **Reconciliation strictly off-path**: a background goroutine or thread reports usage and fetches shares every second. The request path never blocks on it.
- **Sticky routing becomes valuable.** If the load balancer consistent-hashes the caller identity to a server, then that caller's traffic concentrates on one server which can enforce the full limit locally with no coordination at all. **That converts the keep-alive concentration problem from a defect into the mechanism** — which is a nice inversion and the right answer at this latency budget.

**What stays:** the algorithm, the response contract, and the local concurrency limit for protection.

**What new problem appears: sticky routing creates a hot spot and a failover problem.** All of one caller's traffic on one server means that server's failure loses the counter state and redistributes the caller. *Mitigation:* accept that a failover briefly doubles a caller's allowance — a bounded overshoot, and acceptable given overshoot is the safe direction.

**3. Global limit across three regions — compute it, then say it is a product decision**

**The latency arithmetic first:**

\`\`\`
Cross-region round trip (e.g. Europe ↔ North America):  ~80–150 ms
Budget from the original design:                          3 ms p99
\`\`\`

**A synchronous global counter is 30–50× over budget.** The requirement as stated is not achievable — and saying that plainly, with the number, is the answer rather than a failure to answer.

**Three options, in ascending accuracy:**

**Option A — divide the limit by region.** 5,000/minute becomes 1,667 per region, counted locally within each. Zero added latency, and it under-limits exactly as the per-server share did: a customer whose traffic is 90% in one region is limited at 1,667 rather than 5,000. **Same defect, larger blast radius.**

**Option B — regional counting with asynchronous global reconciliation.** Each region enforces locally and every second publishes its consumption to the other two. A region seeing more traffic gets a larger share on the next cycle.

\`\`\`
Accuracy: overshoot bounded by 3 regions × 1 second of allowance
          For 5,000/minute = 83/second, so ~250 requests of overshoot
          ≈ 5% of the limit
Latency:  zero added
\`\`\`

**5% overshoot on a published limit is defensible**, because the error is in the generous direction. **This is the answer**, and the honest framing is to publish the tolerance: "the limit is 5,000 per minute, enforced with approximately 5% tolerance across regions".

**Option C — a single global counter in one region.** Accurate, and it adds 80–150 ms to every request from the other two regions and makes one region's availability the whole system's. **Not viable**, and worth naming so the interviewer knows it was considered and rejected on numbers.

**What new problem appears with Option B: the reconciliation channel is a cross-region dependency**, and if it partitions, each region keeps its last known share. Three regions each enforcing a full share during a partition means 3× the limit — **so the share must degrade toward limit/3 when reconciliation is stale**, which is a deliberate fail-safe rather than a fail-open.

**4. Dynamic endpoint costs — the most structurally awkward change**

The original design read a static cost from the endpoint-cost table before the limiter ran. **Dynamic cost breaks that ordering**, because the cost depends on the query and is only known after the query has been analysed — and possibly only after it has run.

**Three ways out, and the choice depends on when cost becomes knowable.**

**Option A — estimate before, reconcile after.** Charge an estimated cost up front from cheap request features (query shape, requested page size, date range), then after execution charge the difference.

\`\`\`
Before:  deduct estimated_cost (say 10 tokens)
Execute
After:   deduct (actual_cost − estimated_cost), which may be +490 or −9
\`\`\`

*The consequence:* a customer can go **negative** on their budget, and the next request is rejected until the bucket refills. That is correct behaviour and it must be documented, or a customer whose one expensive query consumed their whole minute will be confused.

*And it doubles the counter operations* — one before, one after — which the estimation step said we could afford at 0.7 ms but now becomes 1.4 ms and 800,000 Redis operations per second. **Worth stating the cost of the fix.**

**Option B — a concurrency limit instead of a cost limit for that route.** If cost is unpredictable, "no more than 3 of these running at once per customer" bounds resource consumption without needing to know the cost at all. **This is often the better answer** — it is the backpressure lesson's point that concurrency limits are invariant to how expensive the work turns out to be.

**Option C — a query planner that refuses expensive queries.** Analyse before executing and reject anything estimated above a threshold, with a message telling the customer to narrow their query. **Changes the product**, and for an analytical API it is frequently the right answer.

**What I would do: B for the unpredictable routes and A for routes where the estimate is good.** And I would say that mixing them is deliberate: predictable-cost routes get weighted buckets, unpredictable ones get concurrency limits, and the API documentation says which is which.

**What new problem appears: the limiter now runs after the work for part of its job**, which means a request can consume resources and then discover it was over budget. **The limiter has stopped being purely admission control**, and accepting that is the price of dynamic cost.

**5. One customer at 60% of traffic — a hot-key problem**

120,000 requests/second from one API key means **all of that customer's counter operations hit one hash slot, therefore one Redis node.** A single Redis node does perhaps 100,000 scripted operations per second, so this customer alone saturates a node — and their two limits are 240,000 operations per second.

**Three fixes, in ascending order of how much I like them.**

**Option A — shard that customer's counter.** \`{api_key}:rate:{0..15}\`, each server picking a random shard, with the limit divided by 16.

\`\`\`
Per shard: 15,000 ops/s — comfortable
Cost:      reintroduces share-based under-limiting WITHIN one customer
           16 shards, so the variance is the same problem at a
           smaller scale — and at 120,000 req/s the law of large
           numbers works in our favour, so the under-limiting is
           a fraction of a percent
\`\`\`

**At this volume the sharding penalty is negligible**, which is the opposite of the 40-server case — because the request rate per shard is high enough that random distribution is nearly even. **The same technique that failed at low volume works at high volume**, and understanding why is the interesting part: variance relative to the mean falls as the count rises.

**Option B — leasing, which now works well.** This customer's limit is enormous, so leasing 1,000 tokens at a time gives overshoot of 40 servers × 1,000 = 40,000 against a limit of, say, 7.2 million per minute — **0.5% overshoot.** Leasing is efficient precisely for large limits, and this is the largest limit in the system.

**Option C — dedicated capacity.** Give this customer their own Redis node, or their own API server pool. Simple, effective, and it means the shard map is data to maintain rather than a pure function.

**What I would do: leasing plus a dedicated Redis node.** Leasing because the arithmetic is overwhelmingly favourable at this limit size, and dedicated capacity because a customer who is 60% of traffic is not really a co-tenant — **isolating them protects the other 7,999 customers from their traffic**, which is the shuffle-sharding argument from the load-balancing lesson.

**What new problem appears: this customer is now an availability dependency.** If their dedicated Redis node fails, they fail open onto a backstop sized for a normal customer, which would limit them at a tiny fraction of their allowance. **So their backstop must be sized for them specifically**, which means the backstop is no longer a uniform constant — a small piece of per-customer configuration that is easy to forget.

---

**Which change most simplifies, and which most complicates?**

**Most simplifying: change 1, internal only.** It removes the entire justification for central counting, so Redis leaves the request path, the fail-open policy becomes irrelevant to availability, and the atomic script is no longer needed. **One requirement removal deleted the deep dive.** That is worth noticing: the hardest part of this design existed only because of the published contract.

**Most complicating: change 4, dynamic costs.** Changes 2, 3 and 5 all have clean answers within the existing structure — local enforcement, regional reconciliation, leasing plus sharding. **Change 4 breaks the ordering of the design**: the limiter can no longer be pure admission control, because the cost is not knowable before the work. That forces either a two-phase charge with negative balances, or replacing the cost limit with a concurrency limit, and both change the product contract.

**Change 3 is the runner-up complication** because it forces a product decision — publishing a tolerance — rather than a technical one.

**Which two changes are incompatible?**

**Change 2 (0.2 ms budget) and change 3 (global cross-region limit).**

A global limit requires either a synchronous cross-region call — 80–150 ms, which is 500× the budget — or asynchronous reconciliation, which is not a global limit but a locally-enforced approximation of one. **You cannot have a genuinely global limit and a sub-millisecond budget**, and no engineering closes a gap of that size because it is the speed of light plus a protocol.

**If given both, what I would do:**

**State the impossibility with the number, then offer the closest achievable thing.** "A globally-exact limit requires a cross-region round trip of at least 80 ms, which is 400× the latency budget. What is achievable is a limit enforced locally in each region with asynchronous reconciliation, giving roughly 5% tolerance and zero added latency. **So the question is whether 5% tolerance on the limit is acceptable, because exactness at 0.2 ms is not available.**"

**And then I would ask which requirement is real**, because usually one of them is a preference. A 0.2 ms budget on a trading endpoint is likely genuine; "global rather than per-region" is often a simplification someone wrote down without pricing it. **Establishing which of two conflicting requirements is negotiable is the most valuable thing to do when they conflict**, which is the requirements lesson's conclusion arriving in a concrete case.

**Change 3's latency cost, explicitly**

\`\`\`
Option C, single global counter in one region:
  Requests from the home region:    +0.5 ms   (local Redis)
  Requests from the other two:      +80–150 ms (cross-region round trip)
  Weighted, assuming even traffic:  ~60–100 ms added on average

Against a 3 ms budget: 20–33× over.
Against change 2's 0.2 ms budget: 400–750× over.

And: one region's Redis availability becomes the whole
system's availability for all three regions.
\`\`\`

**So the requirement "global limit" as literally stated is not achievable at any latency budget under about 200 ms**, and it additionally couples three regions' availability into one. **Option B — regional enforcement with asynchronous reconciliation and a published 5% tolerance — is the achievable version**, and the design should present it as such rather than pretending the literal requirement was met.

*The general point this exercise makes:* **every one of these five changes altered the architecture, and none altered the algorithm.** The token bucket was correct in all five cases. That is the lesson's claim demonstrated — the design is where enforcement lives, what accuracy costs, and what happens when the store is unavailable, and the algorithm is a footnote throughout.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hrl-1',
      level: 'basic',
      question: 'Design a rate limiter for a public API. Where do you start?',
      guidance:
        'With whether the limit is a published contract, because that decides the accuracy requirement and therefore the architecture. A strong answer establishes that before discussing any algorithm.',
    },
    {
      id: 'iq-hrl-2',
      level: 'basic',
      question: 'Why not just keep a counter per server?',
      guidance:
        'Keep-alive concentrates a client on as many servers as it has connections, so a pooled client is limited at a fraction of its plan — and random distribution under-limits too. Look for the arithmetic, not just the observation.',
    },
    {
      id: 'iq-hrl-3',
      level: 'intermediate',
      question: 'How do you count accurately across forty servers, and what does it cost?',
      guidance:
        'An atomic Lua script in Redis, one round trip, ~0.7 ms with limits pipelined. A strong answer names the read-modify-write race it avoids and the operations-per-second the fleet must serve.',
    },
    {
      id: 'iq-hrl-4',
      level: 'intermediate',
      question: 'What happens when the counter store is unavailable?',
      guidance:
        'Fail open for plan limits with a local backstop, and a timeout treating slow as allowed. Authentication endpoints are the exception and fail closed. Look for it being decided per limit, in advance.',
    },
    {
      id: 'iq-hrl-5',
      level: 'advanced',
      question: 'Every customer is within their limit and the API is overloaded. Explain.',
      guidance:
        'The sum of per-tenant limits exceeds capacity, so a compliant overload is reachable and the limiter never fires. Excellent answers propose a concurrency limit as protection and explain why it is invariant to latency.',
    },
    {
      id: 'iq-hrl-6',
      level: 'advanced',
      question: 'How would you reduce the counter-store load by an order of magnitude?',
      guidance:
        'Local leasing — request N tokens, serve N requests locally. Excellent answers give the overshoot arithmetic (servers × lease size) and note it works for large limits and fails for small ones.',
    },
    {
      id: 'iq-hrl-7',
      level: 'followup',
      question: 'You said the limit is per minute. Why is that not enough?',
      guidance:
        'Because a request count treats a 3 ms lookup and a 25-second report as equal. A strong answer proposes weighted costs with a published cost table, plus a concurrency limit on the expensive route.',
    },
    {
      id: 'iq-hrl-8',
      level: 'followup',
      question: 'A customer is 60% of your traffic. What breaks?',
      guidance:
        'Their counter is a hot key on one Redis node. Leasing works well at that limit size, sharding the counter is nearly free at high volume, and dedicated capacity isolates the other tenants — with their backstop needing individual sizing.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hrl-1',
      kind: 'what-changes-if',
      prompt:
        'This design limits inbound requests to your API. Now invert it: you are the client, calling a third-party API whose limit you cannot raise, from a fleet of 40 workers. What does the design become?',
      discussion: `The mechanics invert and the hard part moves. You are no longer deciding whom to reject; you are rationing a fixed allowance across your own fleet — and the third party counts globally without caring how many workers you run.

**The problem, stated with numbers.** The provider allows 1,000 requests/minute. You have 40 workers. If each worker sends at will, you exceed the limit forty times over. **So you need exactly the shared-counter design from this lesson, on your side**, and now you *must* build it rather than choosing to.

**What is the same.** A shared token bucket in Redis, atomic script, workers draw from it before calling out. Leasing to reduce Redis load. The keep-alive concentration problem does not arise (you control the workers), but the share-arithmetic problem does if you divide by worker count.

**What is different, and this is the substance.**

**You must fail *closed*, which reverses this lesson's central policy.** If your Redis is unavailable, the safe action is to *stop calling the provider* — because exceeding their limit may get you throttled harder, or blocked, or billed. **Failing open here means the third party enforces the limit for you, punitively.** That is the opposite of the internal case where a limiter outage must not be an API outage.

**Prioritisation becomes mandatory.** With 1,000 calls a minute available and 5,000 wanted, *which* 5,000 you drop matters enormously. A user-facing lookup should win over a background refresh. **So the token bucket needs priority classes**, and the low-priority consumers must be able to wait or be dropped — which is a queue per priority rather than a single bucket.

**The provider's own limit is your ground truth, and you should not trust your model of it.** Published limits are approximate, unevenly enforced across endpoints, and sometimes lower in practice. **So your rejection rate from the provider is a feedback signal:** if you are getting 429s while your own bucket says you are inside the limit, your model is wrong and you should reduce it. That is adaptive rather than configured, and it has no analogue in the inbound case.

**Retry-After must be honoured, and it interacts with your bucket.** If the provider says "retry in 12 seconds", your bucket should stop issuing tokens for 12 seconds rather than letting 40 workers each independently discover the same instruction.

**And the hardest part is not technical.** With a fixed allowance you cannot raise, **the highest-value work is needing fewer calls**: cache responses aggressively, batch where the API supports it, use webhooks instead of polling, and question whether every call is necessary. **A polling integration checking 10,000 records every minute usually needs 100 calls, not 10,000**, and the fix is change detection rather than a cleverer limiter.

Teams reach for exponential backoff and a shared bucket, and skip the question of why they are making 10,000 calls.

**What I would build, in order.**

1. **Measure what you actually consume**, per endpoint, before anything else. The distribution is usually surprising and one endpoint usually dominates.
2. **Reduce it** — caching, batching, webhooks, eliminating redundant calls. Cheapest and largest win.
3. **A shared token bucket in Redis** sized just below the published limit, with atomic draws and leasing, failing closed.
4. **Priority classes**, so scarcity is allocated deliberately.
5. **Adaptive reduction** driven by the provider's 429 rate, treating the published limit as an estimate.

**The transferable point.** Both sides of a rate limit are designs, and the client side is usually undesigned — a retry-on-429 in a library and nothing else. **The limit is fixed; how much useful work you extract inside it is not**, and that is determined by call reduction and prioritisation rather than by the limiter. The limiter is necessary and it is the least valuable part of the answer.`,
    },
    {
      id: 'al-hrl-2',
      kind: 'debug',
      prompt:
        'A rate limiter built to this design is in production. Support reports a cluster of complaints: several customers say they are being limited far below their plan, all within the same two-hour window last Tuesday, and all on the same plan tier. The limiter\'s own metrics show rejection rates within normal range. Diagnose it.',
      discussion: `Complaints clustered in time and by plan tier, with limiter metrics normal. The clustering by *tier* is the strongest clue — it points at configuration rather than at the counting mechanism, because a counting bug would not respect plan boundaries.

**Hypothesis 1 — a plan configuration change propagated wrongly.** Plan data is cached in each server's memory with a 60-second TTL. If someone changed the Pro tier's limit — or a deploy shipped a config with a wrong value — every customer on that tier is affected, and only that tier.

*Why it fits best:* explains the tier correlation exactly, and a two-hour window matches "changed, then noticed and reverted".

*Check:* the plan-configuration change history for that window, and whether the cached value on servers matched the database. **This is the first check and it is a question, not an investigation.**

**Hypothesis 2 — the cost table changed, not the rate limit.** If someone raised the token cost of a commonly-used endpoint from 5 to 50, customers would exhaust their *cost* budget while nowhere near their *request* limit. They would report "limited below my plan" because they count requests, and the limiter would report normal rejection rates because it is rejecting correctly against a budget that changed.

*Why it fits particularly well:* it explains why the customers describe it as being under their limit — **they are measuring the wrong limit.** And it explains normal limiter metrics: nothing is malfunctioning.

*Check:* the endpoint-cost table's change history, and for an affected customer whether the rejections cite the cost limit or the rate limit. **This is where naming the limit in the response body pays for itself** — without it, this hypothesis takes hours instead of minutes.

**Hypothesis 3 — a Redis shard failed and the local backstop took over.** The backstop is sized at 130% of the *expected per-server share*, which for a large customer is far below their actual usage. If the shard holding that tier's keys failed, those customers would fall back to a limit a fraction of their plan.

*Why it fits:* customers hashing to one shard could correlate with a tier if key distribution happens to cluster, though that would be coincidence. **More likely if the tier correlation is imperfect** — worth checking whether *all* Pro customers complained or only some.

*Check:* Redis shard health during the window, and whether the affected customers' keys map to one shard. And critically: **were the limiter's metrics broken down per shard?** A single failed shard out of eight would barely move an aggregate rejection rate — the observability lesson's aggregate-hides-the-outlier problem.

**Hypothesis 4 — leasing overshoot inverted by a deploy.** If leasing is enabled above a threshold and a deploy changed the threshold or the lease size, servers could be drawing leases that starve each other. For instance, if lease size were mistakenly set as a fraction rather than a count, each server might lease almost nothing and go to Redis constantly, or lease too much and exhaust the bucket for other servers.

*Check:* lease-size configuration and the Redis operation rate during the window. A large change in operations per second would confirm it.

**Hypothesis 5 — the complaints are correct and the metrics are measuring the wrong thing.** If the rejection-rate metric is aggregate across all customers and all limits, a subset being heavily rejected is invisible. **"Metrics show normal" may mean "the metric cannot see this".**

*Check:* rejection rate broken down by plan tier and by which limit fired. If that breakdown does not exist, that is the finding.

**What I would check first: the change history for plan configuration and the endpoint cost table in that window.** One query across two tables, and it covers hypotheses 1 and 2 — which together are the most likely given the tier correlation. **A time-clustered, tier-correlated incident is a configuration incident until proven otherwise.**

**Then: rejection rate broken down by limit name and plan tier.** This both discriminates hypothesis 2 from 1 and reveals whether hypothesis 5 is true — because if that breakdown is unavailable, the "metrics show normal" claim was never meaningful.

**Why the metrics being normal is itself the most important finding.**

Customers were limited below their plan for two hours and the limiter reported health. That is a measurement failure regardless of the root cause, and it is the same pattern as the observability lesson's green-dashboard incident:

- **Aggregate rejection rate** across 8,000 customers hides a few hundred being heavily rejected.
- **No per-limit breakdown** means "rejected" does not distinguish rate from cost, which is exactly the distinction hypothesis 2 turns on.
- **No per-shard breakdown** means one failed Redis shard out of eight is invisible.

**The fix set, therefore:**

**Per-customer, per-limit rejection counts**, queryable for support. This turns every future case into a five-minute answer: "customer X was rejected 4,000 times by the cost limit". **This is the single highest-value change** and it makes five of the five hypotheses checkable in one query.

**An alert on the *ratio* of a customer's rejections to their plan limit**, so a customer being limited at 8% of their allowance pages someone rather than waiting for them to complain.

**Configuration changes to plans and costs treated as deploys** — reviewed, versioned, and annotated on dashboards. Two of the five hypotheses are configuration changes, and a change annotation would have made the two-hour window immediately attributable.

**Per-shard limiter metrics**, since a single failed shard is otherwise invisible in aggregate.

**Transferable:** a limiter is a component whose failures are experienced by customers and invisible in its own metrics, because its normal operation *is* rejecting requests. **The only way to distinguish correct rejection from incorrect rejection is a per-customer, per-limit breakdown** — and a limiter without one will always be diagnosed by support tickets rather than by monitoring.`,
    },
  ],

  revision: {
    bullets: [
      'The algorithm is a footnote; the design is where enforcement lives, what accuracy costs, and what happens when the store is down.',
      'A rate limiter is two systems: fairness (published, needs accuracy) and protection (global, load-driven, needs none).',
      'The sum of per-tenant limits almost always exceeds capacity, so a fully-compliant overload is reachable.',
      'Overload protection is a concurrency limit, not a rate limit — it is invariant to latency.',
      'Dividing a limit by server count under-limits: keep-alive puts a 3-connection client on 3 servers.',
      'Whether a limit is a published contract decides whether it deserves a round trip.',
      'Central counting needs an atomic script; a read-modify-write across a network loses concurrent decrements.',
      'Lazy refill in the script removes the background job and lets the TTL be set on every call.',
      'Hash tags co-locate a customer\'s counters so one script can touch both in one round trip.',
      'Local leasing cuts counter operations by the lease size and costs servers × lease size of overshoot.',
      'Leasing suits large limits and fails for small ones, so apply it above a threshold.',
      'Overshoot is the safe direction; undershoot generates support tickets.',
      'Abuse limits at the edge where rejection is free; plan limits in the application where identity and route cost are known.',
      'Local checks before the network call, so an overload does not add load to the limiter.',
      'The response is half the design: `Retry-After`, which limit fired, and quota on successes.',
      'Rejected requests must not consume quota, or a retrying client locks itself out permanently.',
      'Fail open with a timeout for plan limits; fail closed only for authentication endpoints.',
      'A limiter\'s failures are invisible in aggregate metrics, so per-customer per-limit counts are mandatory.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A filter in the request path that admits or rejects based on counters keyed by identity — with the counting either central and accurate, or local and approximate, depending on whether the limit is a published contract.',
    whyItExists:
      'So one tenant cannot consume capacity others paid for, and so a published allowance can be enforced — while a separate load-driven mechanism handles the overload that per-tenant limits structurally cannot catch.',
    whenToUse: [
      'Central counting with an atomic script for limits customers measure.',
      'Local counting with reconciliation for abuse limits nobody measures.',
      'Local leasing for large limits at high request rates.',
      'A concurrency limit, separately, for overload protection and for expensive routes.',
    ],
    whenNotToUse: [
      'A per-server share as the primary mechanism for a published limit.',
      'A per-tenant rate limit as overload protection.',
      'A request count when endpoint costs span orders of magnitude.',
      'Fail-closed on the counter store, except for authentication endpoints.',
      'Leasing on small limits, where overshoot is a large fraction of the limit.',
    ],
    alternatives: [
      'Concurrency limits, which express a time-held constraint and adapt to latency.',
      'Load shedding on queue wait, for protection rather than fairness.',
      'A query planner refusing expensive requests, when cost is unpredictable.',
      'Client-side throttling, when rejection volume is itself significant load.',
      'Dedicated capacity for a tenant who is a large fraction of traffic.',
    ],
    tradeoffs: [
      'Central counting buys contractual accuracy and costs a round trip plus a hot-path dependency.',
      'Local counting buys zero latency and costs an effective limit below the published one.',
      'Reconciliation buys most of the accuracy for none of the latency, with bounded overshoot.',
      'Leasing buys an order of magnitude fewer counter operations and costs overshoot proportional to fleet size.',
      'Cost weighting buys a limit that reflects real resources and costs a table to maintain and publish.',
      'Fail-open buys API availability during a limiter outage and costs all enforcement during it.',
    ],
    failureModes: [
      'A pooled client limited at a fraction of its plan by a per-server share.',
      'A read-modify-write counter losing concurrent decrements and admitting extra traffic.',
      'A bucket created without a TTL, leaking memory indefinitely.',
      'A hot customer\'s counter saturating one Redis node.',
      'Every tenant compliant while the system is overloaded.',
      'A bare 429 causing rejected clients to synchronise their retries.',
      'Rejected requests consuming quota, locking out a retrying client permanently.',
      'A slow counter store adding its latency to every request because there is no timeout.',
      'Fail-closed on the counter store turning a limiter outage into an API outage.',
      'A cost-table change presenting as customers "limited below their plan".',
      'Aggregate rejection metrics hiding a subset of customers being heavily rejected.',
    ],
    followUpQuestions: [
      'Is this limit a published contract, or internal protection?',
      'What is it denominated in — requests, or cost?',
      'How is it counted across servers, and what is the effective limit?',
      'Is the counter update atomic, and does every key have a TTL?',
      'What is the added latency at p99, and what is the timeout?',
      'What happens when the counter store is unavailable, per limit?',
      'What protects you when every tenant is compliant?',
      'Does the response carry `Retry-After` and name which limit fired?',
      'Do rejected requests consume quota?',
      'Can you show a specific customer\'s rejections, broken down by limit?',
      'What happens when one customer is a large fraction of traffic?',
    ],
  },
});
