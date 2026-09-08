import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-retries-timeouts',
  title: 'Timeouts, retries, backoff, hedging',
  summary:
    'A retry is extra load applied at the exact moment a system is least able to serve it. Budgets and jitter are not refinements — they are what separates a retry policy from an outage amplifier, and deadlines are what stop retries multiplying down a call chain.',
  phase: 'distributed',
  module: 'resilience',
  position: 34,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['timeouts', 'retries', 'backoff', 'hedging', 'deadlines'],
  prerequisites: ['d-delivery-semantics'],
  resources: [
    {
      key: 'aws-timeouts-retries-jitter',
      tier: 'must',
      note: 'The definitive practical treatment: why jitter matters, what a retry budget does, and how retries amplify. Read it before writing any retry code.',
    },
    {
      key: 'grpc-deadlines',
      tier: 'must',
      note: 'Deadline propagation, which is the mechanism that stops each layer of a call chain inventing its own timeout. Read it for why a deadline is a point in time rather than a duration.',
    },
    {
      key: 'google-sre-handling-overload',
      tier: 'must',
      note: 'Read the sections on retry budgets and client-side throttling. The argument that a retry policy must be bounded as a fraction of traffic is the central operational idea here.',
    },
    {
      key: 'aws-avoiding-fallback',
      tier: 'good',
      note: 'Why a fallback path is usually a liability: it is exercised only during incidents, so it is the least-tested code running under the worst conditions. Read it as a caution against the obvious remedy.',
    },
    {
      key: 'grpc-guides-performance',
      tier: 'good',
      note: 'Read the sections on connection reuse and on keepalives. Much of what looks like a retry problem is a connection-establishment problem, and the two need different fixes.',
    },
    {
      key: 'latency-numbers',
      tier: 'advanced',
      note: 'Use it as a sanity check when setting timeouts: a timeout should be derived from the operation\'s realistic latency distribution, and this gives you the physical floor.',
    },
  ],

  intuition: {
    body: `Three mechanisms that look like details and decide whether a degradation becomes an outage.

**A timeout** is how long you wait before giving up. Set it too short and you abandon work that would have succeeded, and you generate a retry. Set it too long and a slow dependency holds your resources — threads, connections, memory — until you have none left for anything else. **A missing timeout is the worst case: it means "wait forever", and forever is how a single slow dependency exhausts a whole fleet.**

**A retry** is trying again. And the essential property, which is easy to state and easy to forget: **a retry is additional load applied at precisely the moment the system is least able to serve it.** A dependency failing 40% of requests receives roughly 1.7× its normal traffic from retries, which pushes it further down, which generates more retries. That feedback loop is how a partial degradation becomes total.

**Backoff and jitter** control when the retry happens. Exponential backoff spaces attempts out. **Jitter** — randomising the delay — matters more than people expect: without it, every client that failed at the same moment retries at the same moment, so the load arrives as a spike rather than a smooth increase. Retries synchronise, and synchronised retries are a thundering herd you built yourself.

The framing that makes the rest follow: **retries trade a small increase in success probability for a guaranteed increase in load.** That trade is good when failures are independent and rare — a dropped packet, one unlucky host. It is catastrophic when the failure is *systemic*, because then every retry hits the same broken thing and you have simply multiplied the load on it.

So the design question is not "should we retry" but **"how do we retry in a way that cannot amplify a systemic failure?"** And there are three answers, all of which you need:

- **A retry budget:** cap retries at a small fraction of total traffic. When a dependency is broadly failing, retries stop automatically.
- **Jitter:** so retries spread out rather than arriving together.
- **Deadlines rather than timeouts:** so a retry at one layer does not multiply against retries at the next.

That last one is the mechanism people miss, and it is the one that turns a three-layer call chain's modest retry policy into 27 requests for one user action.`,
    analogyLimit:
      '"Just try again" is fine for one client and wrong for a fleet. It hides that retries are correlated: the reason your request failed is usually the reason everyone else\'s failed, so everyone retries together and the aggregate is a spike rather than a nudge. It also hides multiplication down a call chain — three layers each retrying three times is 27 requests for one user action, which no single layer\'s policy looks unreasonable enough to reveal.',
  },

  deepExplanation: {
    predict: {
      question:
        'A request path is Gateway → Orders → Inventory → Database. Each service has a 3-second timeout on its downstream call and retries up to 3 times. The database becomes slow, taking 4 seconds per query. Work out how many database queries one user request generates, and how long the user waits.',
      answer: `**The multiplication, computed layer by layer.**

Work from the bottom. Inventory calls the database with a 3-second timeout. The query takes 4 seconds, so it times out. Inventory retries: 3 attempts total.

\`\`\`
Inventory → Database:  3 attempts × 3 s = 9 s, then Inventory fails
\`\`\`

But Orders has a 3-second timeout on its call to Inventory. Inventory takes 9 seconds to fail, so **Orders times out at 3 seconds** — while Inventory is still working. Orders retries: 3 attempts.

\`\`\`
Orders → Inventory:    3 attempts × 3 s = 9 s
Each Orders attempt starts a fresh Inventory attempt chain
\`\`\`

And Gateway has a 3-second timeout on Orders, so it times out at 3 seconds too, and retries 3 times.

\`\`\`
Gateway → Orders:      3 attempts × 3 s = 9 s
\`\`\`

**The database query count.** Each Gateway attempt starts an Orders attempt. Each Orders attempt starts an Inventory attempt. Each Inventory attempt starts a database query. Within its 3-second window each layer gets through at most one downstream attempt before timing out — but **the abandoned work keeps running.**

That is the critical detail. When Orders times out after 3 seconds and retries, the first Inventory call **does not stop.** It continues its own 3-attempt chain against the database. So:

\`\`\`
Gateway makes 3 attempts
  → each starts an Orders attempt, and Orders makes 3 attempts
    → each starts an Inventory attempt, and Inventory makes 3 attempts
      → each makes 1 database query

3 × 3 × 3 = 27 database queries for one user request
\`\`\`

**And the user waits 9 seconds** — the Gateway's three 3-second attempts — then receives an error.

**Three things worth extracting.**

**Retries multiply, they do not add.** Each layer's "retry 3 times" looks reasonable in isolation. Composed, it is 27×. No code review of any single service would flag it, which is exactly why this failure is common.

**Abandoned work does not stop.** A timeout at one layer abandons the *response*, not the *work*. The downstream service keeps computing, keeps holding a connection, and keeps querying the database — doing work whose result nobody will read. Under load, most of the system's capacity can be consumed producing responses for callers that have already given up.

**Timeouts equal at every layer is the worst configuration.** Because the outer timeout is not longer than the inner one's total duration, the outer layer always times out first — so it retries while the inner attempt is still running, guaranteeing the multiplication. The timeouts must *decrease* going inward.

**What fixes it, in order of importance.**

**1. Deadline propagation.** The Gateway sets a deadline — "this request must complete by \`T+3s\`" — and passes the absolute deadline downstream. Each service computes its remaining budget from it: Orders sees 2.8 seconds left, Inventory sees 2.6, the database gets a 2.4-second statement timeout. **Crucially, a service with 200 ms of budget left does not retry**, because there is no time for another attempt. Retries stop being possible near the deadline rather than being merely unwise, and the total is bounded to one deadline regardless of how many layers exist.

**2. Retry at one layer, not all of them.** Pick the layer with the best information — usually the outermost, which knows the user is waiting, or the innermost, which knows whether the failure was transient. **Not both.** Every additional retrying layer multiplies.

**3. Retry budgets.** Cap retries at, say, 10% of requests. When the database is broadly slow, nearly every request fails, the budget is exhausted immediately, and retries stop. **This is what converts a systemic failure from an amplifier into a plain failure**, and it is the single most valuable control here.

**4. Cancellation.** When a caller gives up, the downstream work should stop. This requires propagating cancellation and downstream services checking it — real work, and it is what stops abandoned requests consuming the capacity needed by live ones.

**The general lesson.** Every layer's retry policy is reasonable and the composition is not. **Retry policies must be designed for the call chain, not for the call** — and the mechanism that makes that possible is a deadline passed down rather than a timeout invented at each hop.`,
    },
  body: `## Timeouts: where the number comes from

A timeout is a bet about latency, so derive it from the latency distribution rather than choosing a round number.

**The method.** Take the operation's p99 or p99.9 latency under normal conditions and add margin. If a call is 20 ms at p50 and 90 ms at p99, a 250 ms timeout abandons almost nothing legitimate and bounds the damage from a slow call. A 5-second timeout on that call means a slow dependency holds a thread for 5 seconds.

**The failure modes at both ends:**

**Too short:** you abandon work that would have succeeded, generate a retry, and — because retries are load — make the situation worse. A timeout below the p99 fails 1% of requests by construction.

**Too long:** resources are held. With 200 threads and a 30-second timeout, a fully-hung dependency exhausts the pool in the time it takes 200 requests to arrive. **This is the mechanism by which one slow dependency takes down a service that does not depend on it** — the pool is shared.

**Absent:** the default in many clients is no timeout, meaning wait forever. **Every network call needs an explicit timeout**, and the audit for this is one of the highest-value things you can do to an existing codebase.

Three distinctions worth keeping separate, because they are frequently configured as one:

**Connection timeout** — establishing a connection. Should be short: a TCP handshake is one round trip, so hundreds of milliseconds, not seconds.
**Request timeout** — a single attempt, from send to response.
**Total timeout / deadline** — the whole operation including all retries. This is the one the caller cares about, and the one usually missing.

## Deadlines instead of timeouts

The prediction above shows why. A **timeout** is a duration each layer invents; a **deadline** is an absolute point in time passed down the call chain.

\`\`\`
Gateway:    deadline = now + 3 s        → passes T+3s
Orders:     budget = T+3s − now = 2.8 s → passes T+3s
Inventory:  budget = 2.6 s              → passes T+3s
Database:   statement_timeout = 2.4 s
\`\`\`

Four properties, and each solves a specific problem:

**The total is bounded** regardless of depth. The user waits 3 seconds, not 3 seconds per layer.
**No layer can exceed its caller's patience**, so nobody computes a response nobody will read.
**Retries become budget-aware.** A service with 200 ms remaining does not retry, because there is no time. **Retries stop being possible near the deadline**, which bounds the multiplication automatically.
**A slow first hop shrinks everyone's budget**, which is correct: the time is genuinely gone.

Two implementation notes:

**Deadlines must be absolute**, not durations, or each hop adds its own network latency to the budget. Passing "2.8 seconds remaining" means the next hop starts its 2.8 seconds after the network delay, so the total drifts upward at every layer.

**Clock skew matters a little.** Absolute deadlines compare clocks across machines. Skew of tens of milliseconds is tolerable against a multi-second deadline, and the alternative — durations — has a worse failure. Some systems pass remaining duration and subtract measured network time, which is a reasonable middle.

## Retries: when they help and when they hurt

**Retry when the failure is independent and transient:** a dropped packet, a connection reset, one unhealthy host among many, a brief leader election.

**Do not retry when the failure is systemic or deterministic:**

| Response | Retry? | Why |
| --- | --- | --- |
| Connection refused / reset | Yes | Likely one host; another may serve |
| Timeout | **Carefully** | The work may have succeeded; needs idempotency |
| 500 | Maybe once | Could be transient; could be a bug hit every time |
| 502 / 503 | Yes, with backoff | Usually transient unavailability |
| 429 | Only after \`Retry-After\` | The server told you to stop |
| 400 / 422 | **Never** | Deterministic; the request is wrong |
| 401 / 403 | **Never** | Retrying will not grant permission |
| 404 | **Never** | It will not appear |

The row that causes real damage is **429**. Retrying a rate-limit rejection immediately is the purest form of amplification: the server is telling you it cannot take more, and the retry ignores it. Honour \`Retry-After\`.

And the row that causes silent damage is **timeout**. A timed-out request may have succeeded — the previous lesson's ambiguity. Retrying a non-idempotent operation after a timeout can duplicate the effect. **So "retry on timeout" requires idempotency**, and if the operation is not idempotent, a timeout must be surfaced as an ambiguous outcome rather than retried.

## Backoff and jitter

**Exponential backoff:** delay of \`base × 2^attempt\`, capped. 100 ms, 200 ms, 400 ms, 800 ms, capped at a few seconds. This spaces attempts so a recovering dependency is not immediately hit again.

**Jitter is not optional.** Without it, every client that failed at moment T retries at T+100ms, T+300ms, T+700ms — **together**. A thousand clients produce a thousand simultaneous requests at each step. The dependency, which was recovering, is knocked over again, and the pattern repeats. This is a self-inflicted thundering herd, and it produces the characteristic sawtooth recovery graph.

Three jitter strategies:

**Full jitter:** \`delay = random(0, base × 2^attempt)\`. Spreads most effectively; the usual recommendation.
**Equal jitter:** \`delay = half + random(0, half)\`. Guarantees a minimum wait while still spreading.
**Decorrelated jitter:** each attempt's delay is derived from the previous actual delay plus randomness. Spreads well and avoids clustering across a long retry sequence.

**Full jitter unless you need a minimum wait.** The important thing is that there is randomness at all — the difference between no jitter and any jitter is far larger than the difference between the strategies.

## Retry budgets: the control that actually saves you

Backoff and jitter shape *when* retries happen. A **budget** limits *how many* happen at all.

**The mechanism:** track the ratio of retries to original requests over a sliding window. If retries exceed, say, 10% of requests, stop retrying — return the failure immediately.

**Why this is the important control.** Backoff and jitter help when a few requests fail. They do not help when *most* requests fail, because 10,000 failing requests each retrying politely with jitter is still 10,000 extra requests. **A budget is the only mechanism that distinguishes "a few transient failures, retry them" from "everything is broken, stop trying".**

And the behaviour under systemic failure is exactly right: the budget exhausts within seconds, retries cease, load returns to baseline, and the dependency gets a chance to recover rather than being held down.

**A related control: client-side throttling.** If a client observes a high failure rate, it reduces its own request rate proportionally — rejecting some requests locally without sending them. Harsher than a retry budget and appropriate when a dependency is severely degraded, since it stops the client wasting its own resources generating failures.

## Hedging: retrying before failure

**Hedged requests** attack tail latency rather than failure. Send the request; if no response by the p95 latency, send a second copy to a different instance and take whichever answers first.

**Why it works so well.** Tail latency is usually caused by an unlucky *instance* — a garbage collection pause, a cold cache, a noisy neighbour — not by an unlucky *request*. So a second attempt elsewhere is very likely to be fast. Two independent 95th-percentile events are rare, so p99 improves dramatically.

**The cost is bounded and small.** Hedging at p95 adds about 5% extra load, because only 5% of requests trigger a hedge. That is an excellent trade for a large tail improvement.

**When not to hedge:** non-idempotent operations, since both copies may execute; operations where the work is expensive, since you may pay for it twice; and during overload, when the extra 5% is exactly what you cannot afford. **Hedging should be disabled or budgeted under load**, which means it needs the same budget mechanism as retries.

## What retries cannot fix

**A dependency that is down.** Retrying a dead service produces load and no successes. This is what circuit breakers address, in the backpressure lesson.

**Insufficient capacity.** If the dependency needs 10 servers and has 5, retries make it worse.

**A deterministic bug.** A request that triggers a null-pointer exception triggers it every time.

**And a caution about the obvious remedy: fallbacks.** "If the call fails, use a cached value or a default" sounds prudent and has a specific hazard: **the fallback path runs only during incidents, so it is the least-tested code in the system running under the worst conditions.** Fallbacks that allocate, call other services, or have never been exercised at load are a common way for a degradation to become an outage. If you have a fallback, exercise it continuously — send a small fraction of traffic through it always — or do not have one.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'multiplication',
      title: 'How three reasonable retry policies become 27 requests',
      caption:
        'Step through it. No single layer\'s configuration looks wrong, which is exactly why this failure survives code review — and the abandoned work at each layer keeps running.',
      nodes: [
        { id: 'user', label: 'User request', kind: 'client', x: 0, y: 190, detail: 'One action. Waits 9 seconds — the Gateway\'s three 3-second attempts — and then receives an error.' },
        { id: 'gw', label: 'Gateway ×3, 3 s', kind: 'service', x: 170, y: 190, detail: 'Times out at 3 s and retries. Its timeout is not longer than Orders\' total duration, so it always times out while Orders is still working.' },
        { id: 'ord', label: 'Orders ×3, 3 s', kind: 'service', x: 350, y: 190, detail: 'Each Gateway attempt starts a fresh Orders chain of 3 attempts. Times out at 3 s while Inventory is still retrying.' },
        { id: 'inv', label: 'Inventory ×3, 3 s', kind: 'service', x: 530, y: 190, detail: 'Each Orders attempt starts 3 Inventory attempts. Its full chain takes 9 s, so Orders has already given up by 3 s.' },
        { id: 'db', label: 'Database, 4 s/query', kind: 'store', x: 710, y: 190, detail: '3 × 3 × 3 = 27 queries for one user action. The load rises 27× at the exact moment the database is least able to serve it.' },
        { id: 'aband', label: 'Abandoned work continues', kind: 'note', x: 530, y: 60, detail: 'A timeout abandons the RESPONSE, not the WORK. Each timed-out call keeps computing and keeps querying — capacity consumed producing answers nobody will read.' },
        { id: 'dl', label: 'Deadline T+3s', kind: 'service', x: 350, y: 330, detail: 'One absolute deadline passed down. Orders sees 2.8 s left, Inventory 2.6 s, the database gets a 2.4 s statement timeout. The total is bounded regardless of depth.' },
        { id: 'norty', label: 'No time to retry', kind: 'note', x: 530, y: 330, detail: 'A service with 200 ms of budget left cannot retry — there is no time. Retries become impossible near the deadline rather than merely unwise, which bounds multiplication automatically.' },
        { id: 'budget', label: 'Retry budget 10%', kind: 'service', x: 710, y: 330, detail: 'When the database is broadly slow, nearly every request fails, the budget exhausts in seconds, and retries stop. The only control that distinguishes a few transient failures from everything being broken.' },
      ],
      edges: [
        { id: 'm1', source: 'user', target: 'gw', kind: 'sync' },
        { id: 'm2', source: 'gw', target: 'ord', kind: 'sync' },
        { id: 'm3', source: 'ord', target: 'inv', kind: 'sync' },
        { id: 'm4', source: 'inv', target: 'db', kind: 'sync' },
        { id: 'm5', source: 'inv', target: 'aband', kind: 'control' },
        { id: 'm6', source: 'dl', target: 'norty', kind: 'control' },
        { id: 'm7', source: 'norty', target: 'budget', kind: 'control' },
      ],
      steps: [
        {
          id: 'mu1',
          title: 'Each layer retries three times, reasonably',
          description:
            'Gateway, Orders and Inventory each retry three times with a 3-second timeout. Reviewed in isolation, every one of these is a defensible configuration.',
          nodes: ['user', 'gw', 'ord', 'inv'],
          edges: ['m1', 'm2', 'm3'],
        },
        {
          id: 'mu2',
          title: 'Composed, they multiply to 27',
          description:
            '3 × 3 × 3 database queries for one user action. Retries multiply rather than add, and no single service\'s code review can see it — the failure lives in the composition.',
          nodes: ['db'],
          edges: ['m4'],
        },
        {
          id: 'mu3',
          title: 'And the abandoned work keeps running',
          description:
            'A timeout abandons the response, not the work. Timed-out calls continue computing and querying, so a large share of capacity goes to producing answers nobody will read.',
          nodes: ['aband'],
          edges: ['m5'],
        },
        {
          id: 'mu4',
          title: 'One absolute deadline bounds the whole chain',
          description:
            'The Gateway sets T+3s and passes it down. Each layer computes its remaining budget, so the user waits 3 seconds rather than 3 per layer, and nobody works past their caller\'s patience.',
          nodes: ['dl'],
          edges: [],
        },
        {
          id: 'mu5',
          title: 'Which makes retries self-limiting',
          description:
            'A service with 200 ms left cannot fit another attempt, so retries stop near the deadline automatically. Add a retry budget and a systemic failure stops amplifying within seconds.',
          nodes: ['norty', 'budget'],
          edges: ['m6', 'm7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'jitter',
      title: 'Why jitter matters more than the backoff curve',
      caption:
        'Read the two lower branches together. Backoff without jitter converts one failure moment into a series of synchronised spikes — the sawtooth recovery graph — and any randomness at all removes it.',
      code: `flowchart TB
    F["1,000 clients fail<br/>at the same moment"]

    F --> NB["**No backoff**<br/>retry immediately"] --> NB2["1,000 requests instantly.<br/>Dependency knocked over<br/>before it can recover"]

    F --> BO["**Backoff, no jitter**<br/>100 ms, 200, 400, 800"] --> BO2["1,000 requests at T+100,<br/>1,000 at T+300,<br/>1,000 at T+700..."] --> BO3["Synchronised spikes.<br/>Sawtooth recovery —<br/>a herd you built"]

    F --> FJ["**Backoff + full jitter**<br/>random(0, base × 2^n)"] --> FJ2["Requests spread smoothly<br/>across each window"] --> FJ3["Dependency sees a gentle<br/>ramp and can recover"]

    FJ3 --> BUD["**But none of these help<br/>when MOST requests fail.**<br/>10,000 polite retries<br/>are still 10,000 requests"]
    BUD --> BUD2["**Retry budget:** cap retries<br/>at 10% of traffic.<br/>The only control that stops<br/>a systemic failure amplifying"]

    style NB2 fill:#2a1a1a,stroke:#a04848
    style BO3 fill:#2a1a1a,stroke:#a04848
    style FJ3 fill:#17272a,stroke:#35897e
    style BUD2 fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['amazon'],
    body: `AWS's published guidance on timeouts, retries and jitter is the most directly applicable material in this area, because it comes from operating systems where retry storms have caused real outages.

**Four positions worth extracting.**

**Jitter is presented as mandatory, not as a refinement.** The reasoning is the correlation: clients fail together because the cause is shared, so they retry together. The published measurements show the difference between jittered and unjittered backoff as a difference in kind — a smooth ramp versus repeated spikes — rather than a small improvement. **Full jitter is the recommended default**, and the case for it is that the variance reduction matters more than the expected delay.

**Retry budgets are treated as the primary defence.** The framing is that backoff and jitter manage the *timing* of retries while a budget manages their *existence*, and only the latter helps when a dependency is broadly failing. This ordering — budget first, then jitter, then the backoff curve — is the opposite of how most teams implement retries.

**Retries are described as an amplifier with a specific multiplier.** A service failing at rate \`p\` with \`n\` attempts receives traffic multiplied by roughly \`(1 − p^n) / (1 − p)\`. At a 50% failure rate with three attempts that is 1.75×. The value of having the formula is that it makes the amplification a number you can put in a capacity plan rather than an intuition.

**Fallbacks are treated with suspicion.** The argument is that a fallback path executes only during incidents, so it is the least-exercised code in the system running under the worst conditions — and fallbacks that allocate, call other services, or have never been load-tested have turned degradations into outages. The guidance is either to exercise the fallback continuously with a fraction of live traffic, or to not have one.

**The transferable lessons.**

**Implement the budget before the backoff curve.** Teams tune exponential bases and cap durations while having no budget at all, which optimises the case that does not matter and leaves the case that does.

**Randomise anything periodic, not just retries.** The same correlation argument applies to health checks, cache expiry, scheduled jobs and reconnection attempts. Anything that many clients do on a timer will synchronise, and jitter is the general remedy.

**Treat the amplification factor as a capacity input.** If your retry policy multiplies load by 1.75× under a 50% failure rate, your dependency needs headroom for that or the retry policy is a plan to cause an outage.

**Where this needs adapting.** The guidance is written for services with many independent clients. For an internal call between two services you control, deadline propagation and retrying at exactly one layer are available and are stronger tools than anything a client library can do alone — so the AWS advice is the floor rather than the whole design.`,
  },

  tradeoffs: {
    intro:
      'Four bundled decisions: timeout value, whether to retry, how to space retries, and how to bound them. Rows cover each with what it actually costs.',
    rows: [
      {
        option: 'No timeout (the common default)',
        whenItWins:
          'Never. It means "wait forever", and forever is how one slow dependency exhausts a shared thread or connection pool.',
        whenItLoses:
          'Always. It is the mechanism by which a slow dependency takes down a service that does not depend on it.',
        cost:
          'Resource exhaustion under any downstream slowness, affecting unrelated traffic.',
      },
      {
        option: 'A timeout derived from the p99 plus margin',
        whenItWins:
          'The default. It abandons almost nothing legitimate and bounds how long a slow call holds resources.',
        whenItLoses:
          'When the latency distribution is bimodal or shifts, making one number wrong for part of the traffic.',
        cost:
          'Measurement work, and periodic revisiting as the operation changes.',
      },
      {
        option: 'A deadline propagated down the call chain',
        whenItWins:
          'Any multi-hop path. The total is bounded regardless of depth, nobody works past their caller\'s patience, and retries become self-limiting near the deadline.',
        whenItLoses:
          'When you cannot change every hop, or when a protocol carries no metadata for it.',
        cost:
          'Plumbing through every layer, and a mild dependency on clock agreement.',
      },
      {
        option: 'Retry with exponential backoff, no jitter',
        whenItWins:
          'Marginally better than immediate retry, and only when there is a single client.',
        whenItLoses:
          'With many clients — they all failed together, so they all retry together, converting one failure into a series of synchronised spikes.',
        cost:
          'A self-inflicted thundering herd and a sawtooth recovery.',
      },
      {
        option: 'Retry with exponential backoff and full jitter',
        whenItWins:
          'The correct baseline whenever you retry at all. Load arrives as a smooth ramp rather than a spike.',
        whenItLoses:
          'When most requests are failing — 10,000 politely-jittered retries are still 10,000 extra requests.',
        cost:
          'Variable latency for the retried request, and it still amplifies under systemic failure.',
      },
      {
        option: 'A retry budget capping retries at a fraction of traffic',
        whenItWins:
          'Always, and it is the control that matters most. Under systemic failure the budget exhausts in seconds and retries stop, letting the dependency recover.',
        whenItLoses:
          'It does not help an individual request that deserved a retry once the budget is spent.',
        cost:
          'Some retryable failures are not retried during a degradation — which is the point.',
      },
      {
        option: 'Client-side throttling on observed failure rate',
        whenItWins:
          'When a dependency is severely degraded. The client reduces its own send rate, stopping it from wasting resources generating failures.',
        whenItLoses:
          'When the failures are specific to a subset of requests rather than the dependency as a whole.',
        cost:
          'Locally rejecting requests that might have succeeded.',
      },
      {
        option: 'Hedged requests at the p95',
        whenItWins:
          'Tail-latency reduction for idempotent reads. About 5% extra load for a large p99 improvement, because tail latency is usually an unlucky instance rather than an unlucky request.',
        whenItLoses:
          'For non-idempotent operations, for expensive work, and during overload — when the extra 5% is exactly what you lack.',
        cost:
          'About 5% more load, doubled work on hedged requests, and it needs a budget like retries.',
      },
      {
        option: 'A fallback path (cached value or default)',
        whenItWins:
          'When the fallback is continuously exercised with a fraction of live traffic, so it is known to work.',
        whenItLoses:
          'When it runs only during incidents — the least-tested code in the system under the worst conditions.',
        cost:
          'An untested code path that can turn a degradation into an outage, plus possibly-wrong data served silently.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Every service retries its downstream calls three times with a 3-second timeout."',
      whyWeak:
        'Retries multiply down a chain. Three layers each retrying three times is 27 downstream requests for one user action, at the moment the dependency is least able to serve them. No single service\'s configuration looks wrong, which is why this survives review.',
      strongAnswer:
        '"Retries multiply rather than add, so I would retry at exactly one layer — usually the outermost, which knows a user is waiting. Then I would propagate an absolute deadline so no layer works past its caller\'s patience and a layer with little budget left cannot retry at all. And a retry budget capping retries at around 10% of traffic, so a systemic failure stops amplifying within seconds."',
    },
    {
      weakAnswer: '"We use exponential backoff, so retries do not overwhelm the dependency."',
      whyWeak:
        'Without jitter, every client that failed at the same moment retries at the same moment. A thousand clients produce a thousand simultaneous requests at each backoff step, so the dependency is knocked over repeatedly — the sawtooth recovery graph. And backoff does nothing when most requests are failing.',
      strongAnswer:
        '"Backoff without jitter converts one failure moment into a series of synchronised spikes, because clients fail together and therefore retry together. Full jitter — a random delay between zero and the backoff value — spreads them. But the more important control is a retry budget: backoff shapes when retries happen, and only a budget limits whether they happen at all when a dependency is broadly failing."',
    },
    {
      weakAnswer: '"On a timeout we retry, since the request probably did not get through."',
      whyWeak:
        'A timeout is ambiguous: the request may have succeeded with the response lost. Retrying a non-idempotent operation after a timeout can duplicate the effect — a second charge, a second order.',
      strongAnswer:
        '"A timeout does not tell you whether the work happened, so retrying is only safe if the operation is idempotent. For a write that means an idempotency key derived from the operation, so the retry returns the original result. If the operation cannot be made idempotent, a timeout has to be surfaced as an ambiguous outcome and resolved by querying, rather than retried."',
    },
    {
      weakAnswer: '"Our client retries on any error response to be resilient."',
      whyWeak:
        'Several responses are deterministic and will fail identically forever: 400, 422, 401, 403, 404. Retrying them wastes capacity and delays the error the caller needs. And retrying a 429 is the purest amplification — the server has explicitly said it cannot take more.',
      strongAnswer:
        '"Retries should be selective. Retry connection failures, 502 and 503 with backoff. Never retry 400, 422, 401, 403 or 404 — they are deterministic. Only retry 429 after the interval in `Retry-After`, because retrying it immediately ignores an explicit instruction to stop. And retry a timeout only if the operation is idempotent."',
    },
    {
      weakAnswer: '"We set a 30-second timeout to be safe, so slow requests still complete."',
      whyWeak:
        'It reverses the risk. With 200 threads and a 30-second timeout, a fully-hung dependency exhausts the pool in the time it takes 200 requests to arrive — and because the pool is shared, requests that do not touch that dependency start failing too.',
      strongAnswer:
        '"A long timeout is not safe, it is how one slow dependency exhausts a shared pool and takes down unrelated traffic. I would derive the timeout from the operation\'s p99 plus margin — if p99 is 90 ms, then 250 ms — so a slow dependency is abandoned quickly. And I would bound concurrency to that dependency separately, so it cannot consume the whole pool even at its timeout."',
    },
    {
      weakAnswer: '"If the call fails we fall back to a cached value, so users always see something."',
      whyWeak:
        'The fallback path runs only during incidents, so it is the least-exercised code in the system running under the worst conditions. Fallbacks that allocate, call other services, or have never been load-tested are a documented way for a degradation to become an outage.',
      strongAnswer:
        '"A fallback only executes during an incident, so it is the least-tested code running at the worst time — and it may serve wrong data silently. If I keep one, I would exercise it continuously by routing a small fraction of live traffic through it, so I know it works and how it performs. Otherwise I would prefer failing explicitly, which is at least a behaviour someone has seen before."',
    },
  ],

  flashcards: [
    {
      id: 'fc-rto-1',
      front: 'What is the essential property of a retry?',
      back: 'It is additional load applied at precisely the moment the system is least able to serve it. It trades a small increase in success probability for a guaranteed increase in load.',
      topic: 'retries',
    },
    {
      id: 'fc-rto-2',
      front: 'Where should a timeout value come from?',
      back: 'The operation\'s p99 or p99.9 latency plus margin. A timeout below the p99 fails 1% of requests by construction.',
      topic: 'timeouts',
    },
    {
      id: 'fc-rto-3',
      front: 'Why is a long timeout dangerous rather than safe?',
      back: 'It holds resources. 200 threads with a 30-second timeout exhaust in the time 200 requests arrive, and because the pool is shared, unrelated traffic starts failing.',
      topic: 'timeouts',
    },
    {
      id: 'fc-rto-4',
      front: 'What are the three timeouts that are frequently configured as one?',
      back: 'Connection timeout (a handshake, so hundreds of ms), request timeout (one attempt), and total deadline (the whole operation including retries) — the last usually missing.',
      topic: 'timeouts',
    },
    {
      id: 'fc-rto-5',
      front: 'Why do retries multiply rather than add?',
      back: 'Each layer\'s attempts start a fresh chain below it. Three layers retrying three times is 27 downstream requests for one user action.',
      topic: 'retries',
    },
    {
      id: 'fc-rto-6',
      front: 'What does a timeout abandon, and what does it not?',
      back: 'It abandons the response, not the work. The downstream service keeps computing and querying, consuming capacity to produce answers nobody will read.',
      topic: 'timeouts',
    },
    {
      id: 'fc-rto-7',
      front: 'What four things does deadline propagation give you?',
      back: 'A total bounded regardless of depth; no layer working past its caller\'s patience; retries that stop when budget runs out; and a slow first hop correctly shrinking everyone\'s budget.',
      topic: 'deadlines',
    },
    {
      id: 'fc-rto-8',
      front: 'Why must a deadline be absolute rather than a remaining duration?',
      back: 'A duration restarts at each hop after the network delay, so the total drifts upward at every layer.',
      topic: 'deadlines',
    },
    {
      id: 'fc-rto-9',
      front: 'Which responses must never be retried?',
      back: '400, 422, 401, 403, 404 — deterministic failures. And 429 only after the interval in `Retry-After`, since retrying it ignores an explicit instruction to stop.',
      topic: 'retries',
    },
    {
      id: 'fc-rto-10',
      front: 'Why does retrying a timeout require idempotency?',
      back: 'A timeout is ambiguous — the work may have succeeded with the response lost. Retrying a non-idempotent operation can duplicate the effect.',
      topic: 'retries',
    },
    {
      id: 'fc-rto-11',
      front: 'What happens with backoff but no jitter?',
      back: 'Clients failed together so they retry together: a thousand simultaneous requests at each backoff step, knocking over the recovering dependency repeatedly. The sawtooth graph.',
      topic: 'backoff',
    },
    {
      id: 'fc-rto-12',
      front: 'What does a retry budget do that backoff and jitter cannot?',
      back: 'It limits whether retries happen at all. Backoff shapes timing; only a budget stops 10,000 politely-jittered retries from still being 10,000 extra requests.',
      topic: 'backoff',
    },
    {
      id: 'fc-rto-13',
      front: 'Why does hedging work so well, and what does it cost?',
      back: 'Tail latency is usually an unlucky instance rather than an unlucky request, so a second copy elsewhere is likely fast. Hedging at p95 costs about 5% extra load.',
      topic: 'hedging',
    },
    {
      id: 'fc-rto-14',
      front: 'Why are fallback paths a liability?',
      back: 'They run only during incidents, so they are the least-exercised code in the system under the worst conditions. Exercise them with live traffic continuously or do not have them.',
      topic: 'hedging',
    },
  ],

  quiz: [
    {
      id: 'q-rto-1',
      kind: 'scenario',
      prompt:
        'Gateway → Orders → Inventory, each with a 3-second timeout and 3 retries. Inventory\'s database slows to 4 seconds per query. How many database queries does one user request generate?',
      options: [
        { id: 'a', label: '27 — each layer\'s attempts start a fresh chain below it, so the retries multiply' },
        { id: 'b', label: '9 — three layers times three retries' },
        { id: 'c', label: '3 — only the innermost layer retries against the database' },
        { id: 'd', label: '1 — the outer timeouts cancel the inner work' },
      ],
      correct: ['a'],
      explanation:
        '3 × 3 × 3. Each Gateway attempt starts an Orders chain, each Orders attempt starts an Inventory chain, each Inventory attempt queries the database. And because outer timeouts do not cancel inner work, the abandoned calls continue running — so the load is real, not theoretical.',
      difficulty: 'core',
      topic: 'retries',
    },
    {
      id: 'q-rto-2',
      kind: 'scenario',
      prompt:
        'A thousand clients all fail at the same moment and retry with exponential backoff at 100 ms, 200 ms, 400 ms — with no jitter. What does the dependency experience?',
      options: [
        { id: 'a', label: 'A thousand simultaneous requests at each backoff step, repeatedly knocking over a recovering dependency' },
        { id: 'b', label: 'A smooth increase in load as the backoff spreads attempts out' },
        { id: 'c', label: 'No additional load, since backoff delays the retries' },
        { id: 'd', label: 'Load only from the clients whose first retry succeeds' },
      ],
      correct: ['a'],
      explanation:
        'Backoff spaces one client\'s attempts and does nothing to decorrelate different clients. They failed together because the cause was shared, so they retry together and arrive as spikes — producing the characteristic sawtooth recovery. Full jitter, a random delay in the backoff window, is what spreads them.',
      difficulty: 'core',
      topic: 'backoff',
    },
    {
      id: 'q-rto-3',
      kind: 'scenario',
      prompt:
        'A dependency is failing 80% of requests. Clients retry with exponential backoff and full jitter. Why is this still a problem, and what fixes it?',
      options: [
        { id: 'a', label: 'Jitter smooths the arrival pattern without reducing volume — a retry budget capping retries at a fraction of traffic is what stops the amplification' },
        { id: 'b', label: 'A longer backoff cap would reduce the load' },
        { id: 'c', label: 'Nothing is wrong; jitter has solved the herd problem' },
        { id: 'd', label: 'More retry attempts would eventually succeed and reduce total load' },
      ],
      correct: ['a'],
      explanation:
        'This is the central distinction: backoff and jitter manage the *timing* of retries, and a budget manages their *existence*. At an 80% failure rate almost every request retries, so the aggregate extra load is large regardless of how well it is spread. A budget exhausts within seconds and lets the dependency recover.',
      difficulty: 'advanced',
      topic: 'backoff',
    },
    {
      id: 'q-rto-4',
      kind: 'multi',
      prompt:
        'Which responses should generally not be retried? Select all that apply.',
      options: [
        { id: 'a', label: '400 Bad Request' },
        { id: 'b', label: '403 Forbidden' },
        { id: 'c', label: '429 Too Many Requests, immediately' },
        { id: 'd', label: '503 Service Unavailable' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        '400 and 403 are deterministic — the same request will fail identically forever. Retrying 429 immediately is the purest amplification, since the server has explicitly said it cannot take more; retry only after `Retry-After`. 503 is usually transient unavailability and is a reasonable retry with backoff.',
      difficulty: 'core',
      topic: 'retries',
    },
    {
      id: 'q-rto-5',
      kind: 'scenario',
      prompt:
        'A service has 200 threads and a 30-second timeout on a downstream call. That dependency hangs completely. What happens to requests that do not touch it?',
      options: [
        { id: 'a', label: 'They fail too — the hung calls occupy all 200 threads, and the pool is shared' },
        { id: 'b', label: 'They are unaffected, since they do not call the hung dependency' },
        { id: 'c', label: 'They are served more slowly but continue to succeed' },
        { id: 'd', label: 'They fail only if they also have a 30-second timeout' },
      ],
      correct: ['a'],
      explanation:
        'This is how one slow dependency takes down a service that does not depend on it. A 30-second timeout means each hung call holds a thread for 30 seconds, so the pool exhausts in the time 200 such requests arrive, and unrelated traffic then has nowhere to run. A short timeout plus a bounded concurrency limit per dependency prevents it.',
      difficulty: 'core',
      topic: 'timeouts',
    },
    {
      id: 'q-rto-6',
      kind: 'scenario',
      prompt:
        'A team hedges idempotent reads at the p95 latency, sending a second copy to another instance. What does this cost and why does it work?',
      options: [
        { id: 'a', label: 'About 5% extra load, and it works because tail latency is usually an unlucky instance rather than an unlucky request' },
        { id: 'b', label: 'Double the load, since every request is sent twice' },
        { id: 'c', label: 'Nothing, since the second copy replaces the first' },
        { id: 'd', label: 'About 50% extra load, since half the requests exceed the median' },
      ],
      correct: ['a'],
      explanation:
        'Only requests slower than p95 trigger a hedge, so roughly 5% of requests are duplicated. It is effective because a slow response usually means a paused or cold instance, and a second attempt elsewhere is very likely fast — two independent p95 events being rare is what improves p99. It must be budgeted or disabled under overload.',
      difficulty: 'core',
      topic: 'hedging',
    },
  ],

  exercises: [
    {
      id: 'ex-rto-1',
      kind: 'design',
      title: 'Set every number, then compute the amplification',
      estimatedMinutes: 30,
      prompt: `Design the timeout and retry policy for this path:

\`\`\`
Browser → CDN → API Gateway → Orders → { Inventory, Pricing, Payments }
                                Orders → PostgreSQL
                                Payments → third-party processor
\`\`\`

Measured latencies (p50 / p99):
- Orders → PostgreSQL: 4 ms / 40 ms
- Orders → Inventory: 12 ms / 80 ms
- Orders → Pricing: 8 ms / 60 ms
- Orders → Payments: 200 ms / 900 ms
- Payments → processor: 180 ms / 850 ms

The user-facing budget for placing an order is 3 seconds.

Specify: every timeout, which layers retry and how, the deadline propagation, and the budgets. Then answer:

- Compute the worst-case downstream load amplification for your policy.
- Payments is not idempotent by default. What must change before you retry it?
- The processor starts taking 4 seconds. Trace what happens with your policy.
- Where would you hedge, and where would you refuse to?`,
      rubric: [
        'Every call has an explicit timeout derived from its p99, with the margin stated.',
        'Retries happen at one layer, not all — with the choice justified.',
        'An absolute deadline is propagated, with a per-hop budget calculation shown.',
        'PostgreSQL gets a statement timeout, not just a client-side one.',
        'Payments retry is conditioned on an idempotency key.',
        'A retry budget with a concrete percentage.',
        'Amplification is computed numerically for the chosen policy.',
        'Processor-slowdown trace is specific about what times out and what the user sees.',
        'Hedging proposal covers idempotent reads and refuses non-idempotent or expensive paths.',
        'Concurrency isolation per dependency is addressed, not only timeouts.',
      ],
      modelAnswer: `**Deadline first, because every timeout below is derived from it.**

The API Gateway sets an **absolute deadline** of \`now + 2.5 s\` — 3 seconds of user budget minus 500 ms reserved for the browser, CDN and response serialisation. That deadline is passed to every downstream hop, which computes its remaining budget from it.

\`\`\`
Gateway sets deadline D = T + 2500 ms, passes D downstream
Orders receives D, sees ~2450 ms remaining
Each Orders → dependency call gets min(its own timeout, remaining budget)
\`\`\`

**Timeouts, each derived from p99 plus margin**

| Call | p99 | Timeout | Margin reason |
| --- | --- | --- | --- |
| Orders → PostgreSQL | 40 ms | **150 ms** | ~3.5× p99. Tight, because a query above this is pathological. |
| Orders → Inventory | 80 ms | **250 ms** | ~3× p99. |
| Orders → Pricing | 60 ms | **200 ms** | ~3× p99. |
| Orders → Payments | 900 ms | **1,500 ms** | ~1.7× p99, and constrained by the total budget below. |
| Payments → processor | 850 ms | **1,200 ms** | Must fit inside Payments' own 1,500 ms with room for its own work. |

**Plus connection timeouts of 100 ms everywhere.** A TCP handshake is one round trip, so a connection taking longer than 100 ms means the host is unreachable, not slow. Separating this from the request timeout means an unreachable host is detected in 100 ms rather than in the full request timeout — a distinction that matters a great deal during a partial outage.

**And a PostgreSQL \`statement_timeout\` of 150 ms**, set server-side. A client-side timeout abandons the response; the server keeps executing the query. **The statement timeout is what actually stops the work**, and setting only the client-side one is the mistake that leaves a database full of abandoned queries during an incident.

**Budget check.** Inventory and Pricing can run concurrently — they are independent — so the serial path is:

\`\`\`
max(Inventory 250, Pricing 200) + PostgreSQL 150 + Payments 1500 = 1,900 ms
\`\`\`

Against a 2,450 ms budget that leaves 550 ms of headroom, which absorbs Orders' own processing and one retry of a cheap call. **This calculation is the point of the exercise** — timeouts chosen independently would not have fitted, and I would not know until production.

**Who retries**

**Orders retries Inventory, Pricing and PostgreSQL. Once each.** One retry, not three.

*Why Orders and not the Gateway:* Orders knows which dependency failed and whether that dependency is idempotent. The Gateway sees one opaque failure and would retry the entire fan-out including Payments — retrying a payment because Pricing was slow.

*Why one retry:* the second attempt captures most of the benefit. Failures that survive two attempts are rarely transient, and each additional attempt multiplies load for diminishing returns. With a 150 ms PostgreSQL timeout, one retry costs 150 ms of the 550 ms headroom.

**The Gateway does not retry.** It is the only layer that could, and retrying there multiplies against Orders' retries. This is the deliberate application of "retry at exactly one layer".

**The CDN does not retry** dynamic requests — a \`POST /orders\` must not be replayed by infrastructure that knows nothing about idempotency.

**Payments: retried only under a condition, covered below.**

**Backoff and jitter**

With one retry there is little curve to tune, and jitter still matters:

\`\`\`
retry delay = random(0, 50 ms)
\`\`\`

*Why so short:* the budget. A long backoff on a 150 ms call would consume the headroom. *Why jittered at all:* if Inventory has a brief blip, every in-flight Orders request fails at roughly the same moment and would otherwise retry together, hitting the recovering Inventory with a synchronised spike.

**Retry budget: 10% of requests per dependency, over a 30-second sliding window.**

Tracked per dependency, not globally — Inventory being broken should not consume the budget that would let a PostgreSQL blip be retried. When Inventory is broadly failing, the budget exhausts within seconds and Orders stops retrying it while continuing to retry the others.

**Concurrency isolation, which timeouts alone do not give**

\`\`\`
Orders' connection/thread limits:
  PostgreSQL:  40 concurrent
  Inventory:   30 concurrent
  Pricing:     20 concurrent
  Payments:    50 concurrent   (slowest, so needs the most)
  Total pool: 200
\`\`\`

*Why this matters as much as the timeouts:* with a shared pool of 200 and a 1,500 ms Payments timeout, a hung Payments consumes all 200 slots in the time 200 order requests arrive — and then Inventory and Pricing calls have nowhere to run, so requests that never needed Payments fail. **Per-dependency limits are the bulkhead**, and a slow dependency is confined to its own allocation.

---

**Worst-case amplification for this policy**

Per user request:

\`\`\`
Gateway → Orders:              1  (no retry)
Orders → Inventory:            2  (1 + 1 retry)
Orders → Pricing:              2
Orders → PostgreSQL:           2
Orders → Payments:             2  (only if idempotent — see below)
Payments → processor:          2  per Payments attempt = up to 4
\`\`\`

**Amplification on the processor: 4× worst case.** On PostgreSQL, Inventory and Pricing: **2×**.

Compare with the naive three-layers-times-three-retries configuration: **27×**. The reduction from 27 to 4 comes from three decisions — retry at one layer, retry once rather than three times, and propagate a deadline that makes retries impossible when budget is short.

*And the budget bounds it further in practice.* The 4× figure is the worst case for a *single* request. Across the fleet, the 10% retry budget means the aggregate amplification never exceeds 1.1× — which is the number that matters for capacity planning. **The per-request worst case tells you about latency; the budget tells you about load.**

**Payments is not idempotent. What must change before retrying it?**

**Nothing may retry Payments until an idempotency key exists.** Concretely:

1. **Orders generates a key deterministically from the order**: \`order-{order_id}-charge\`. Not a per-attempt UUID, which would defeat the mechanism.
2. **The key is persisted with the order before the first attempt.** So every retry — including one after an Orders restart — reads the same key from one place rather than regenerating it. This makes correct derivation structural rather than a coding convention.
3. **Payments passes the key to the processor**, which returns the original result for a repeat.
4. **Payments records the attempt locally** keyed on it, so a replay outside the processor's key-retention window does not produce a second charge. Two layers, because the processor's retention is finite.

**Until all four are in place, Payments gets zero retries and a timeout is surfaced as an ambiguous outcome** — the order enters a "payment pending" state and a reconciliation job queries the processor by reference to determine what actually happened.

*The distinction worth stating:* a timeout on Payments does not mean the charge failed. It means we do not know. **Treating unknown as failure and retrying is how double charges happen**, and treating it as failure and *not* retrying is how orders go unpaid. The only correct handling is a third state.

**The processor slows to 4 seconds — trace it**

\`\`\`
t=0     Gateway sets deadline T+2500
t=~20   Orders starts Inventory + Pricing concurrently
t=~100  both return (normal latencies)
t=~110  Orders → PostgreSQL, returns ~115
t=~120  Orders → Payments, timeout 1500, budget remaining ~2330
t=~125  Payments → processor, timeout 1200
t=1325  processor call times out (4 s > 1.2 s)
t=1325  Payments retries? Remaining budget ≈ 1175 ms.
        One more 1200 ms attempt does not fit → NO RETRY
t=1330  Payments returns a timeout error to Orders
t=1330  Orders retries Payments? Remaining ≈ 1120 ms,
        Payments timeout is 1500 → does not fit → NO RETRY
t=1340  Orders returns an error to the Gateway
t=1350  User sees an error at ~1.4 seconds
\`\`\`

**Three things this trace demonstrates.**

**The deadline suppressed both retries automatically.** Nobody wrote "do not retry when the processor is slow" — the budget arithmetic made a retry impossible because there was no time for one. **That is the property that makes deadline propagation worth the plumbing**, and it is why it appears before retry budgets in my design.

**The user gets an error at 1.4 seconds, not at 3.** Fast failure rather than a long hang, and the remaining 1.6 seconds of budget was not burned on attempts that could not have completed.

**Amplification on the struggling processor is 1×, not 4×.** The worst case only materialises when there is budget for it — which is precisely when the dependency is healthy enough to absorb it. **The amplification is self-limiting because it is budget-bounded**, and that inverse relationship is the whole point.

*And the state to handle:* the order is now in "payment unknown". The processor may have charged the card — it took 4 seconds, so it may well have succeeded after we gave up. The reconciliation job must query by the idempotency key and either complete or cancel the order. **This is not an edge case; it is the expected outcome of a slow payment processor**, and a design that has no state for it will produce silent double charges or unpaid orders.

**Where I would hedge, and where I would refuse**

**Hedge: Orders → Inventory and Orders → Pricing.**

\`\`\`
Send at t=0. If no response by 80 ms (the p99), send a second
copy to a different instance. Take whichever answers first.
\`\`\`

*Why these:* both are idempotent reads, both are cheap, and both are on the critical path for every order. Tail latency here is almost certainly an unlucky instance — a GC pause, a cold cache — so a second attempt elsewhere is very likely fast.

*Cost:* about 1% extra load, since I am hedging at p99 rather than p95. I would use p99 rather than p95 because these calls are already fast and the budget is not tight; hedging at p95 would add 5% for a smaller marginal gain.

*It needs a budget too.* Hedging is a retry sent early, so it amplifies identically under load. I would cap hedges at 5% of requests and **disable hedging entirely when the retry budget is exhausted** — during a degradation the extra load is exactly what the dependency cannot take.

**Also hedge: Orders → PostgreSQL reads.** Same reasoning, against a read replica. Not writes.

**Refuse to hedge: Payments.** Two reasons, either sufficient. It is not idempotent, so two copies could produce two charges. And it is expensive — a 200 ms call to a third party, possibly with a per-transaction fee — so duplicating 5% of them has a direct financial cost.

**Refuse to hedge: anything with a side effect.** The general rule. A hedge is a speculative duplicate, so the operation must be safe to perform twice. If I ever made Payments idempotent with a key, hedging would become *safe* and still be wrong, because paying twice for a hedge that is usually unnecessary is a poor trade.

*The summary I would give:* **hedge idempotent, cheap, latency-critical reads; budget the hedges like retries; disable them under load; and never hedge anything with an effect.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-rto-1',
      level: 'basic',
      question: 'How do you choose a timeout value?',
      guidance:
        'From the operation\'s p99 latency plus margin. A strong answer names both failure modes — too short generates retries, too long exhausts shared pools — and separates connection, request and total timeouts.',
    },
    {
      id: 'iq-rto-2',
      level: 'basic',
      question: 'Why is jitter necessary with exponential backoff?',
      guidance:
        'Clients fail together because the cause is shared, so they retry together and arrive as spikes. Look for the sawtooth recovery and for full jitter as the default.',
    },
    {
      id: 'iq-rto-3',
      level: 'intermediate',
      question: 'Three services each retry three times. What is the problem?',
      guidance:
        '27 downstream requests for one user action, plus abandoned work continuing. A strong answer proposes retrying at one layer and propagating a deadline rather than tuning each timeout.',
    },
    {
      id: 'iq-rto-4',
      level: 'intermediate',
      question: 'What is a retry budget and why does it matter more than backoff?',
      guidance:
        'A cap on retries as a fraction of traffic. Backoff shapes when retries happen; only a budget limits whether they happen when most requests are failing. Look for that distinction stated crisply.',
    },
    {
      id: 'iq-rto-5',
      level: 'advanced',
      question: 'How does deadline propagation change a retry policy?',
      guidance:
        'It bounds the total regardless of depth and makes retries impossible when budget is short, so amplification becomes self-limiting. Excellent answers note deadlines must be absolute and that a statement timeout is needed server-side.',
    },
    {
      id: 'iq-rto-6',
      level: 'advanced',
      question: 'When would you hedge requests, and what does it cost?',
      guidance:
        'Idempotent, cheap, latency-critical reads. About 5% extra load at p95 for a large p99 gain, because tail latency is an unlucky instance. Excellent answers budget hedges and disable them under load.',
    },
    {
      id: 'iq-rto-7',
      level: 'followup',
      question: 'A call to a non-idempotent payment API times out. What do you do?',
      guidance:
        'Not retry, and not treat it as failure. Surface it as an unknown outcome and resolve by querying the processor by reference. A strong answer describes the third state as expected rather than exceptional.',
    },
    {
      id: 'iq-rto-8',
      level: 'followup',
      question: 'You proposed a fallback to a cached value. What is the risk?',
      guidance:
        'It runs only during incidents, so it is the least-tested code under the worst conditions, and it may serve wrong data silently. Either exercise it continuously with live traffic or prefer explicit failure.',
    },
  ],

  activeLearning: [
    {
      id: 'al-rto-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed a synchronous request the user is waiting for. Now change one thing: the work is asynchronous — a queue consumer processing a job with no user waiting. What changes about timeouts, retries and backoff?',
      discussion: `Removing the waiting user removes the constraint that shaped every number, and it introduces a different one.

**What relaxes.**

**The deadline is no longer a user's patience.** A job can take 30 seconds where a request could take 2.5. So timeouts can be generous, and retries can be numerous and widely spaced — minutes or hours rather than milliseconds.

**Backoff can be long and aggressive.** 1 s, 10 s, 1 min, 10 min, 1 hour. There is no budget to fit inside, and a dependency that is down for an hour is one the retry can simply outlast. This is the case where exponential backoff genuinely earns its curve.

**Retry attempts can be many.** Ten or twenty attempts over hours is reasonable, because the cost of each is only compute rather than a user waiting.

**What becomes harder, and this is the substance.**

**Retries no longer bound themselves.** With a synchronous request, the user's patience caps the total attempts — a deadline makes retries impossible when time runs out. **Asynchronously there is no such cap**, so a job can retry forever and a bad job can retry forever *loudly*. The bound must be explicit: a maximum attempt count and then a dead-letter destination.

**Amplification is worse, not better.** In a synchronous path a retry replaces a request that a user has abandoned. In a queue, retried jobs *accumulate*: a dependency failing for an hour means an hour of jobs, each retrying on its own schedule, all becoming due at once when the dependency recovers. **The recovery is the dangerous moment**, and it will knock the dependency over again unless the consumer rate-limits itself.

**Backoff must be durable.** A "wait 10 minutes then retry" that lives in a process's memory is lost on restart. It has to be a visibility timeout, a delayed-delivery message, or a \`run_after\` column — otherwise a deploy resets every backoff to zero and all pending retries fire immediately. **This is the specific mistake that turns a slow dependency into a self-inflicted spike after a routine deploy.**

**Timeouts still matter, for a different reason.** A consumer with no timeout on a downstream call holds a worker indefinitely, so the pool drains and the queue stops being processed. The timeout is not protecting a user's latency, it is protecting worker availability — and the reasoning changes even though the mechanism does not.

**The ordering problem returns.** Retrying job 4 while jobs 5 and 6 proceed reorders them, which is the delivery-semantics tension. Synchronously there is no ordering to break; asynchronously there may be.

**What I would actually build differently.**

**A durable \`run_after\` with jittered exponential backoff**, so backoff survives restarts and retries do not synchronise on recovery.

**A maximum attempt count and a dead-letter destination**, with an alert and an owner — because nothing else bounds the retries.

**A concurrency limit on the consumer, not a rate limit.** If the dependency slows, in-flight work fills the limit and the consumer naturally slows. This adapts where a rate limit would need retuning, and it is the mechanism that makes recovery safe.

**Rate limiting on recovery specifically.** When a dependency comes back and an hour of accumulated retries becomes due, the consumer must ramp rather than flood. A concurrency limit provides this automatically, which is another reason to prefer it.

**The transferable point.** The synchronous case is bounded by the user's patience, and that bound does a lot of quiet work — it caps attempts, caps total latency, and makes amplification self-limiting. **Asynchronous work removes that bound, so every limit must be made explicit**: attempt counts, dead-letter destinations, durable backoff, and concurrency limits. Teams reuse a synchronous retry policy in a consumer and are surprised when a dependency's recovery causes a second outage.`,
    },
    {
      id: 'al-rto-2',
      kind: 'debug',
      prompt:
        'A service\'s error rate is 0.4% at steady state. During a 90-second downstream degradation, its error rate reaches 100% and stays there for 8 minutes after the downstream dependency has fully recovered. Hypotheses?',
      discussion: `The key detail is the 8 minutes *after* recovery. The dependency is healthy and the service is still failing everything, which means the service is now the problem — something in it has entered a state it cannot leave on its own.

**Hypothesis 1 — connection or thread pool exhausted by requests that will never complete.** During the degradation, calls held threads until their timeout. If the timeout is long and the arrival rate is high, the pool filled. After recovery, new requests cannot get a thread because the pool is still occupied by the backlog — and each backlogged request, when it finally runs, may already have exceeded its own deadline and fail immediately. **The queue drains at the rate of timeouts, not at the rate of the recovered dependency.**

*Why it fits the 8 minutes:* the drain time is determined by pool size, timeout duration and backlog depth, and it is entirely independent of the dependency's health.

*Check:* pool utilisation and queue depth over the whole window. If utilisation stayed at 100% through recovery, this is it.

**Hypothesis 2 — retry amplification sustaining the overload.** During the degradation every request retried, multiplying load. After recovery the dependency faces the original traffic plus retries plus the backlog of queued work, which may exceed its capacity — so it fails again, generating more retries. **The system holds itself down.**

*Why it fits:* it explains a self-sustaining state that persists after the original cause is gone, and it is exactly what a retry budget prevents.

*Check:* the ratio of downstream requests to inbound requests during the 8 minutes. A ratio well above 1 confirms retries are a major traffic source.

**Hypothesis 3 — a queue of work whose deadlines have all expired.** If requests queue and each carries a deadline, a request that waits 3 seconds in a queue with a 2.5-second deadline is dead on arrival. So the service processes requests, finds each expired, and fails it — at 100% — while making no progress on the backlog. **Full CPU, full throughput, zero success.**

*Why it fits perfectly:* it explains 100% rather than merely elevated errors, and it explains persistence. The service is working hard and every unit of work is worthless.

*Check:* whether failures are deadline-exceeded rather than downstream errors, and the queue wait time versus the deadline. **This distinction — failing because the dependency failed versus failing because we queued too long — is the most important thing to establish**, and the two usually share an error code.

**Hypothesis 4 — a circuit breaker stuck open.** If a breaker opened during the degradation and its half-open probe logic is broken — probes are themselves failing for an unrelated reason, or the reset interval is very long — it stays open and rejects everything after the dependency recovers.

*Why it fits:* it would produce exactly 100% failure with an instant, clean rejection. Distinguishable from the others by latency: breaker rejections are fast, exhausted pools are slow.

*Check:* breaker state over the window, and the latency of the failing requests. **Fast failures point here; slow failures point at hypotheses 1 and 3.**

**Hypothesis 5 — a cache stampede on recovery.** If a cache expired during the degradation and every request now misses, the recovered dependency receives the full uncached load, which it cannot serve. Cold-cache load from the caching lesson.

*Check:* cache hit rate during the 8 minutes. A hit rate near zero recovering slowly would confirm it.

**What I would check first: the latency of the failing requests during the 8 minutes.** One graph, and it splits the hypothesis space cleanly. Fast failures mean a breaker or an admission check is rejecting; slow failures mean the work is being attempted and something is exhausted or expired. Getting this wrong sends the investigation in the opposite direction for an hour.

**Then: the failure reason breakdown** — deadline-exceeded versus downstream-error versus pool-timeout. That distinguishes hypothesis 3 from 1 and 2, and it is the distinction most error dashboards collapse.

**Why the 8-minute tail is the real finding.** A 90-second degradation causing a 90-second outage is unfortunate. A 90-second degradation causing a 9.5-minute outage means **the system's recovery behaviour is worse than its failure behaviour**, and that is the more serious problem — the fix is not "make the dependency more reliable", it is "make recovery work".

**The fixes, in order.**

**Shed load rather than queueing it.** If a request cannot be served within its deadline, reject it immediately rather than queueing it to fail later. This is the single highest-value change: it converts hypothesis 3 from a self-sustaining outage into fast, honest rejections, and it frees capacity for requests that can succeed.

**A retry budget**, so amplification cannot sustain the overload.

**Short timeouts and per-dependency concurrency limits**, so a degradation cannot fill the shared pool in the first place.

**Check the deadline before starting work, not only before returning.** A request whose deadline has passed should be dropped at the front of the queue, cheaply.

**And exercise recovery deliberately.** This behaviour was discoverable in a load test with an injected 90-second dependency failure, and it was not found because nobody tested recovery. **Failure injection that ends and then measures the tail is a different test from failure injection that measures the failure**, and the second is where this class of bug lives.

**Transferable:** a system whose recovery takes much longer than its outage has a self-sustaining feedback loop, and the candidates are always the same short list — exhausted pools draining at timeout rate, retry amplification, expired queued work, a stuck breaker, or a cold cache. **The diagnostic that separates them fastest is the latency of the failures**, not their rate.`,
    },
  ],

  revision: {
    bullets: [
      'A retry is extra load applied when the system is least able to serve it.',
      'A timeout should come from the operation\'s p99 plus margin, not a round number.',
      'A long timeout is dangerous: it holds shared resources, so one slow dependency fails unrelated traffic.',
      'A missing timeout means "wait forever" and is the worst case. Every network call needs one.',
      'Keep connection, request and total timeouts distinct; the total deadline is usually missing.',
      'Retries multiply down a chain: three layers retrying three times is 27 requests.',
      'A timeout abandons the response, not the work — abandoned calls keep computing and querying.',
      'Equal timeouts at every layer is the worst configuration; they must decrease going inward.',
      'A propagated absolute deadline bounds the total regardless of depth and makes retries self-limiting.',
      'A remaining-duration deadline drifts upward at every hop; deadlines must be absolute.',
      'A client-side timeout does not stop a database query; you also need a server-side statement timeout.',
      'Never retry 400, 422, 401, 403 or 404. Retry 429 only after `Retry-After`.',
      'Retrying a timeout requires idempotency, because the work may have succeeded.',
      'Backoff without jitter converts one failure moment into synchronised spikes.',
      'A retry budget is the control that matters: it limits whether retries happen, not just when.',
      'Hedging at p95 costs ~5% load and improves p99 sharply, because slowness is usually an unlucky instance.',
      'Hedges need budgeting and must be disabled under load; never hedge an operation with an effect.',
      'A fallback path runs only during incidents, so exercise it with live traffic or do not have one.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The set of controls governing how long a caller waits, whether it tries again, when, how many times, and how those decisions compose across a call chain.',
    whyItExists:
      'Because networks and dependencies fail transiently, and because the obvious remedy — trying again — is extra load applied at the worst possible moment, so it must be bounded rather than merely configured.',
    whenToUse: [
      'An explicit timeout on every network call, derived from the p99.',
      'A propagated absolute deadline on any multi-hop request path.',
      'Retries at exactly one layer, with jitter and a budget.',
      'Hedging for idempotent, cheap, latency-critical reads.',
    ],
    whenNotToUse: [
      'Retrying deterministic failures — 400, 422, 401, 403, 404.',
      'Retrying a timeout on a non-idempotent operation.',
      'Retrying at every layer of a call chain.',
      'Hedging anything with a side effect, or anything expensive.',
      'A fallback path that is never exercised outside incidents.',
    ],
    alternatives: [
      'Load shedding, which rejects rather than queueing work that cannot meet its deadline.',
      'Circuit breakers, for a dependency that is down rather than slow.',
      'Per-dependency concurrency limits, which bound damage better than timeouts alone.',
      'Client-side throttling, when a dependency is severely degraded.',
      'A third "unknown" outcome, when a non-idempotent call times out.',
    ],
    tradeoffs: [
      'A shorter timeout buys fast failure and costs abandoning some work that would have succeeded.',
      'A longer timeout buys success on slow calls and costs held resources for unrelated traffic.',
      'Retries buy a higher success probability and cost a guaranteed load increase.',
      'Jitter buys decorrelation and costs predictable retry timing.',
      'A retry budget buys protection under systemic failure and costs retries for individual deserving requests.',
      'Hedging buys tail latency and costs about 5% extra load, doubled on hedged requests.',
    ],
    failureModes: [
      'Retries multiplying down a call chain to tens of downstream requests per user action.',
      'Abandoned work continuing after a caller times out, consuming capacity for nobody.',
      'A long timeout exhausting a shared pool and failing traffic that never touched the slow dependency.',
      'Backoff without jitter producing synchronised retry spikes and a sawtooth recovery.',
      'Retrying 429 immediately, ignoring an explicit instruction to stop.',
      'Retrying a timed-out non-idempotent call and duplicating the effect.',
      'A client-side timeout with no server-side statement timeout, leaving abandoned queries running.',
      'Queued requests whose deadlines expired while waiting, producing 100% failure at full throughput.',
      'Retry amplification sustaining an overload after the original cause has recovered.',
      'A fallback path executing for the first time under incident conditions.',
      'In-memory backoff lost on deploy, firing every pending retry at once.',
    ],
    followUpQuestions: [
      'Does every network call have an explicit timeout, and where did the number come from?',
      'Do you propagate a deadline, and is it absolute?',
      'Which layers retry? Multiply their attempt counts together.',
      'Is there a retry budget, and what percentage?',
      'Is jitter applied, and to what else that runs on a timer?',
      'Does a client timeout actually stop the downstream work?',
      'Is retrying this call safe if it already succeeded?',
      'When a caller gives up, does the downstream work stop?',
      'What happens in the minutes after a dependency recovers?',
      'Has the fallback path ever run under load?',
    ],
  },
});
