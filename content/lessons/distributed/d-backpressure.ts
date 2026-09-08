import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-backpressure',
  title: 'Backpressure, load shedding, circuit breakers',
  summary:
    'A queue does not absorb overload — it converts a throughput problem into a latency problem and hides it until every response is too late to be useful. Bounded queues, shedding by criticality, and concurrency limits are what actually work.',
  phase: 'distributed',
  module: 'resilience',
  position: 35,
  kind: 'concept',
  difficulty: 'advanced',
  estimatedMinutes: 45,
  tags: ['backpressure', 'load-shedding', 'circuit-breakers', 'queueing', 'cascading-failure'],
  prerequisites: ['d-retries-timeouts'],
  resources: [
    {
      key: 'google-sre-handling-overload',
      tier: 'must',
      note: 'Read the sections on criticality, client-side throttling and per-customer limits. The central idea — that you must decide what to drop before you need to drop it — is the whole subject.',
    },
    {
      key: 'aws-load-shedding',
      tier: 'must',
      note: 'Read it for the argument that shedding is more useful than queueing, and for the treatment of what to shed first. Pairs directly with the queueing arithmetic below.',
    },
    {
      key: 'google-sre-addressing-cascading',
      tier: 'must',
      note: 'The mechanics of how one component\'s overload propagates and becomes systemic. Read the sections on the failure modes and on how to break the cycle during an incident.',
    },
    {
      key: 'fowler-circuit-breaker',
      tier: 'good',
      note: 'The pattern stated plainly. Read it and then read the failure modes below — a breaker is easy to describe and easy to configure into something that causes an outage.',
    },
    {
      key: 'envoy-architecture',
      tier: 'good',
      note: 'Read the circuit-breaking and outlier-detection material for how a proxy implements concurrency limits and ejection without application changes.',
    },
    {
      key: 'aws-well-architected-reliability',
      tier: 'advanced',
      note: 'Read the workload-architecture sections on graceful degradation and bulkheads, as the frame for deciding which parts of a system are allowed to fail independently.',
    },
  ],

  intuition: {
    body: `Start with the arithmetic, because it settles the argument that queues help.

A service can process 100 requests per second. 120 arrive per second. The excess is 20 per second, and it goes into a queue.

After one minute the queue holds 1,200 requests. A request arriving now waits 12 seconds before processing begins. After five minutes it holds 6,000 and the wait is 60 seconds. **The queue is not absorbing the overload — it is recording it**, and each entry is a request whose caller has almost certainly given up.

That is the whole insight. **A queue converts a throughput problem into a latency problem.** The throughput deficit does not go away; it accumulates as delay. And because the callers have timeouts, past a certain queue depth **every** response is produced too late to be useful — so the service is running at 100% capacity with 0% useful output. Full CPU, zero goodput.

Two consequences that follow directly:

**An unbounded queue is a way of hiding an overload until it is unrecoverable.** With no queue, the excess 20 requests per second fail immediately and visibly. With a queue, everything looks fine for a minute, then latency climbs, then everything fails at once and the backlog persists long after the load subsides.

**The useful measure is not throughput but goodput** — responses delivered before their deadline. A service processing 100 requests per second where 90 are already too late has a goodput of 10.

So the mechanisms that actually work all reduce to the same idea: **when you cannot serve everything, decide deliberately what not to serve, and do it early.**

- **Bound the queue.** A full queue rejects immediately, which is fast, honest, and recoverable.
- **Shed by criticality.** Not all requests are equal. A payment matters more than a recommendation refresh, and deciding that *before* an incident is what makes shedding useful rather than arbitrary.
- **Limit concurrency, not rate.** A bound on in-flight work adapts automatically as the work gets slower, where a rate limit is a fixed guess.
- **Break the circuit** when a dependency is not merely slow but down, so you stop spending resources discovering that.

And the reason all this matters beyond one service: **overload propagates.** A slow service makes its callers slow, which fills their queues, which makes their callers slow. That is cascading failure, and it is why the correct response to overload is to reject work rather than to hold it.

The framing to carry: **backpressure is telling your caller to stop, and load shedding is deciding what to drop when they do not. A queue is neither.**`,
    analogyLimit:
      'A queue at a shop is the misleading picture, because a person in a real queue can see how long it is and leave. A request in a service queue cannot: it has already been accepted, its caller has already committed a timeout, and nothing tells either of them that the wait now exceeds the deadline. The analogy also hides that the queue is where the failure becomes invisible — a growing queue looks like a healthy service right up to the moment every response is worthless.',
  },

  deepExplanation: {
    predict: {
      question:
        'A service processes 100 requests/second. Load rises to 130/second for four minutes, then returns to 90/second. Callers have a 5-second timeout. The service has an unbounded queue. Describe what happens minute by minute, including after the load drops — and say what the graphs look like.',
      answer: `**Minute 1.** 130 arrive, 100 are processed, 30 accumulate. The queue reaches 1,800 by the end of the minute. Queue wait is 18 seconds. **Every request arriving now will exceed its caller's 5-second timeout before it is even started.**

Note what the metrics show: CPU is at 100%, throughput is 100 requests/second — the healthy number — and the error rate is **still low**, because the requests that are completing were queued when the wait was short. Latency is climbing. Nothing looks like an emergency yet.

**Minute 2.** Queue reaches 3,600. Wait is 36 seconds. Now the requests being processed are all ones that were queued more than 5 seconds ago, so **their callers have all timed out.** The service is at 100% CPU producing 100 responses per second that nobody will read.

**Goodput is now zero.** Throughput is unchanged at 100. This is the divergence that matters and it is the one nobody graphs.

And the callers, having timed out, retry. If they retry once, arrival becomes 130 plus retries — call it 200/second. The queue now grows at 100 per second rather than 30.

**Minute 3.** Queue at roughly 9,000 with retries. Wait over 90 seconds. Callers' own thread pools are now full of requests waiting on this service, so **the callers start failing requests that never needed this service at all.** The overload has propagated upward.

**Minute 4.** Load is still 130 plus retries. Queue is around 15,000.

**Minute 5 — the load drops to 90/second, and this is the important part.**

The service can process 100/second and only 90 are arriving, so it has 10 requests/second of spare capacity to drain a 15,000-request backlog. **That takes 25 minutes.**

For those 25 minutes, every request being processed was queued long ago and has already timed out. So the service continues at 100% CPU with zero goodput, and every new request arriving joins the back of a queue whose wait exceeds the timeout. **New requests fail even though the service has spare capacity**, because the capacity is spent on dead work.

Worse: the callers are still timing out and still retrying, so arrival is not really 90 — it is 90 plus retries, which may exceed 100 and mean the backlog never drains at all. **The system can remain in this state indefinitely after the original cause has gone.**

**What the graphs look like, and why they mislead.**

- **CPU:** pinned at 100% throughout. Looks like a capacity problem.
- **Throughput:** flat at 100/second the entire time. **Looks completely healthy.**
- **Error rate:** low for the first 90 seconds, then 100%, staying at 100% for half an hour after load normalises.
- **Latency:** climbing steadily. The only honest signal, and it is the one usually reported as a percentile that saturates at the timeout value.
- **Queue depth:** the actual answer, and frequently not instrumented at all.

The characteristic and confusing shape is **a flat throughput graph next to a 100% error rate.** A team reading throughput concludes the service is fine and looks elsewhere.

**What would have prevented it.**

**A bounded queue** of, say, 200 — roughly two seconds of work. Beyond that, reject immediately. Then during minutes 1–4 the service serves 100/second successfully and rejects 30/second explicitly. Callers get fast failures they can act on. **When load drops to 90, the service is instantly healthy** because there is no backlog. The four-minute overload causes four minutes of partial failure rather than half an hour of total failure.

**Deadline checking at the front of the queue.** Before starting work, check whether the request's deadline has passed; if so, drop it and take the next. This converts dead work into free capacity and is the single cheapest fix — it turns the 25-minute drain into seconds.

**A retry budget in the callers**, so the amplification does not turn a 30% overload into a 100% one.

**The general lesson.** The queue did not protect the service; it converted a bounded, visible, recoverable problem into an unbounded, invisible, self-sustaining one. **Rejecting work is not a failure of the design — it is the design.**`,
    },
  body: `## Little's Law, and why queues are not capacity

The relationship governing every queue:

\`\`\`
L = λ × W
\`\`\`

Items in the system (\`L\`) equals arrival rate (\`λ\`) times time in the system (\`W\`). Rearranged, the useful form:

\`\`\`
W = L / λ        →  wait time = queue depth / throughput
\`\`\`

So a queue of 1,000 in front of a service doing 100/second means a **10-second wait**. That is not a tuning parameter; it is arithmetic. If your callers have a 5-second timeout, a queue depth above 500 guarantees failure for everything behind it.

This gives you the way to size a queue: **choose the maximum acceptable wait, multiply by throughput.**

\`\`\`
max_queue_depth = throughput × acceptable_wait
                = 100/s × 2 s = 200
\`\`\`

A queue of 200 is a genuine buffer for bursts. A queue of 10,000 is a mechanism for accepting work you cannot do.

The corollary worth stating: **a bounded queue is not a limitation, it is the only kind that is honest.** An unbounded queue promises to do work it has no capacity for, and it makes that promise silently.

## Goodput, not throughput

**Throughput** is responses produced. **Goodput** is responses produced *before their deadline*. Under overload these diverge completely, and only one of them is what users experience.

A service at 100% CPU producing 100 responses/second, all of which arrive after their caller timed out, has:

- Throughput: 100/second — looks perfect.
- Goodput: 0/second.

**Instrument goodput.** Concretely: on completing a request, compare the elapsed time to the deadline and count it as useful or wasted. A dashboard showing "wasted work" as a percentage of throughput makes overload obvious in a way no CPU or throughput graph does.

And the operational conclusion: **dropping a request whose deadline has passed is free capacity.** Checking the deadline at the front of the queue, before doing the work, is a few lines of code and it is the difference between a 25-minute recovery and an instant one.

## Backpressure: telling the caller to stop

**Backpressure** is a signal propagating upstream that says *slow down*. It is different from shedding, which drops work; backpressure ideally prevents the work from being sent.

Where it exists naturally:

**TCP flow control.** A receiver's window advertises how much it can accept, so a fast sender is throttled by the network stack. This is backpressure working invisibly and well.

**A bounded queue between stages.** If stage B's input queue is full, stage A blocks when it tries to enqueue. The pressure propagates backwards to whoever is feeding A.

**Reactive streams and pull-based consumers.** The consumer requests N items; the producer sends at most N. The consumer's rate governs.

**A concurrency limit.** A caller allowed 20 in-flight requests naturally slows when the callee slows, because the slots fill.

Where it does not exist and must be built:

**A synchronous HTTP API has no backpressure channel.** A client sends a request; there is no mechanism to say "not now, and stop sending". The nearest equivalents are \`429\` with \`Retry-After\`, \`503\`, and closing the connection — all of which are *shedding plus a hint*, and they depend on the client honouring the hint.

**A message queue removes backpressure by design.** That is its purpose: producers do not wait for consumers. So the queue depth becomes the only signal, and if nobody watches it the overload is invisible until the consumer is hours behind.

The practical position: **prefer designs where backpressure is structural** — bounded queues, concurrency limits, pull-based consumers. Where it cannot be, you need shedding plus a client that cooperates.

## Load shedding: deciding what to drop

When you cannot serve everything, you drop something. The only question is whether you choose, or the failure chooses for you.

**The first requirement is criticality**, assigned before the incident:

| Class | Examples | Shed when |
| --- | --- | --- |
| Critical | Payments, authentication, health checks | Never, until nothing else remains |
| Important | Core reads and writes | Under severe overload |
| Best-effort | Recommendations, analytics, prefetch | First |

Two things this makes possible: shedding preserves the operations that matter, and **the decision is made calmly in advance** rather than by whoever is on call at 3am.

**The signal to shed on.** Not CPU — CPU is a lagging and ambiguous indicator, and a service can be overloaded at 40% CPU if it is I/O-bound. Better signals:

**Queue depth or wait time**, compared against the deadline. If the wait already exceeds the deadline, shed — because the work is worthless.

**Latency against an objective**, in the style of latency-based admission control: if the observed minimum queue delay stays above a threshold for a sustained window, start dropping. The virtue of using *minimum* delay over a window is that it distinguishes a persistent standing queue from a brief burst, so it does not shed on a spike that will clear itself.

**Concurrency saturation.** If all in-flight slots are occupied, reject rather than queue.

**How to shed:** reject immediately with a fast, cheap response — \`503\` with \`Retry-After\`, or \`429\`. **The rejection must be much cheaper than the work**, or shedding does not help. A rejection that runs authentication, database lookups and full logging is not a rejection, it is a slightly cheaper request.

And the rule that makes shedding survivable: **shed at the edge, as early as possible.** A request rejected after passing through four services has consumed four services' resources.

## Concurrency limits, not rate limits

For protecting a dependency, a **concurrency limit** — a bound on in-flight requests — is almost always better than a rate limit.

**Why.** A rate limit is a guess about how fast the dependency is. If the dependency slows from 50 ms to 500 ms, the same request rate now means ten times the concurrent work, so the rate limit no longer protects it. A concurrency limit is invariant: 20 in-flight is 20 in-flight regardless of latency, so **when the dependency slows, the slots fill and the caller is throttled automatically with nothing to retune.**

That self-adjusting property is the whole argument, and it is why concurrency limits appear in service meshes and connection pools rather than rate limits.

**Adaptive concurrency limits** go further: adjust the limit based on observed latency, in the style of TCP congestion control. Increase while latency is stable, decrease when it rises. This finds the dependency's actual capacity without anyone configuring a number — which matters because the right number changes with the dependency's deployment, data size and load.

**Bulkheads.** Give each dependency its own bounded allocation of connections or threads, rather than sharing one pool. Then a hung dependency consumes its own allocation and stops, and requests that do not touch it are unaffected. **Without bulkheads, one slow dependency exhausts the shared pool and fails everything** — which is the mechanism from the timeouts lesson, and the concurrency limit is what confines it.

## Circuit breakers, and how they cause outages

A **circuit breaker** stops calling a dependency that is failing, so you stop spending resources discovering that it is down.

**States:** *closed* (calls pass through, failures counted), *open* (calls rejected immediately without trying), *half-open* (a limited number of probe calls test whether it has recovered).

**When it genuinely helps:** the dependency is **down** rather than slow. Then every call is a wasted timeout, and rejecting immediately frees threads and returns errors fast. It also gives the dependency a period with no load, which can be what lets it recover.

**Four ways a breaker causes an outage:**

**A threshold that trips on normal error rates.** A dependency with a legitimate 5% error rate — some requests genuinely 404 — will trip a 5% breaker. Then the breaker rejects all traffic including the 95% that would have succeeded. **Count only failures that indicate unavailability**, not application errors.

**Insufficient volume for the statistic.** A breaker tripping after "3 consecutive failures" on a dependency receiving 2 requests per minute will trip on noise. Breakers need a minimum request volume before the failure ratio means anything.

**A shared breaker for independent failures.** One breaker per *service* trips when one endpoint is broken, cutting off healthy endpoints on the same service. Breakers should be per dependency **and per operation** where the operations fail independently.

**A stuck-open breaker.** If half-open probes fail for an unrelated reason — a bad probe path, a probe that is itself rate-limited, a reset interval measured in minutes — the breaker never closes and the dependency stays cut off long after it recovered.

**The general caution:** a breaker converts a partial failure into a total one *for the traffic it governs*. That is correct when the dependency is down and wrong when it is degraded, and the configuration is what distinguishes the two. Given the choice, **a concurrency limit is safer than a breaker** for a slow dependency, because it degrades proportionally rather than in a step.

## Cascading failure: how one overload becomes systemic

The mechanics, in order:

1. Service D slows.
2. Service C's calls to D take longer, so C's threads are held longer, so C's concurrency rises.
3. C's pool fills. **Requests to C that do not touch D now fail**, because the pool is shared.
4. C's latency rises, so B's calls to C time out, so B retries, adding load.
5. B's pool fills. The failure is now at B.
6. Callers of B time out and retry. Load on the whole chain is now several times normal.
7. Even when D recovers, the accumulated backlog and retry load keep the chain saturated.

**Four things break the cycle**, and they are in ascending order of how early they act:

**Bulkheads**, so step 3 does not happen — a hung dependency cannot consume the whole pool.
**Short timeouts and deadlines**, so held threads are released quickly and abandoned work stops.
**Retry budgets**, so step 4 does not multiply.
**Load shedding at the edge**, so the excess never enters the system.

And the counter-intuitive operational point: **during a cascade, the fix is usually to reduce load rather than to add capacity.** Adding capacity to a system saturated with retries and dead work often does nothing, because the new capacity is immediately consumed by the same amplified load. Shedding aggressively, then easing off, is what breaks it.

## Graceful degradation

The design goal is that overload produces a **worse service**, not **no service**:

- Serve stale cached data rather than nothing.
- Return a page without the recommendation strip.
- Disable an expensive feature under load and say so.
- Reduce result-set sizes or precision.

Two requirements that are usually missed:

**The degraded path must be exercised continuously.** The timeouts lesson's warning about fallbacks applies exactly: a degraded path that only runs during incidents is the least-tested code in the system running under the worst conditions. Route a small fraction of traffic through it always.

**Degradation must be a deliberate switch, not an emergent behaviour.** "The recommendations call timed out so the strip is empty" is emergent and produces inconsistent behaviour. "Load shedding is active, so recommendations are disabled" is deliberate, uniform, and visible on a dashboard.

## Where these mechanisms do not apply

**When you are not near capacity.** All of this is machinery for the overloaded case, and a service with 60% headroom needs timeouts and bulkheads rather than adaptive shedding.

**A circuit breaker on a merely slow dependency.** A concurrency limit degrades proportionally; a breaker fails everything in a step.

**Shedding as a substitute for capacity.** If you are permanently shedding 30% of traffic, you need 40% more capacity. Shedding is for transients and for protecting against the unpredictable, not for running under-provisioned.

**Backpressure through a message queue.** The queue exists to decouple producer from consumer, so it deliberately removes the backpressure channel. Monitor depth and limit consumer concurrency instead.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'queue-collapse',
      title: 'How a queue turns a 30% overload into a 30-minute outage',
      caption:
        'Step through it and watch the metrics column. Throughput stays flat and healthy throughout, which is why teams reading throughput conclude the service is fine.',
      nodes: [
        { id: 'load', label: '130/s arriving', kind: 'client', x: 0, y: 190, detail: 'Capacity is 100/s, so 30/s of excess. A 30% overload — significant and, on its own, entirely survivable.' },
        { id: 'queue', label: 'Unbounded queue', kind: 'store', x: 180, y: 190, detail: 'Accumulates 30/s. After one minute: 1,800 items. Little\'s Law gives an 18-second wait, against a 5-second caller timeout.' },
        { id: 'svc', label: 'Service, 100/s', kind: 'service', x: 370, y: 190, detail: 'Pinned at 100% CPU, producing exactly 100 responses per second. On a throughput graph this is indistinguishable from perfect health.' },
        { id: 'dead', label: 'Goodput → 0', kind: 'note', x: 370, y: 60, detail: 'From minute 2 every request being processed was queued more than 5 seconds ago, so its caller has gone. 100% CPU, 100 responses/s, zero useful output.' },
        { id: 'retry', label: 'Callers retry', kind: 'client', x: 180, y: 320, detail: 'Timed-out callers retry, so arrival becomes ~200/s. The queue now grows at 100/s instead of 30/s — the amplification from the retries lesson.' },
        { id: 'up', label: 'Callers\' pools fill', kind: 'note', x: 0, y: 320, detail: 'Callers hold threads waiting on this service, so their pools fill and they start failing requests that never touched it. The overload has propagated upward.' },
        { id: 'drain', label: 'Load drops to 90/s', kind: 'note', x: 570, y: 190, detail: '10/s of spare capacity against a 15,000 backlog: 25 minutes to drain, all of it dead work — and new requests still fail because they join the back of the queue.' },
        { id: 'fix1', label: 'Bounded queue: 200', kind: 'service', x: 570, y: 60, detail: 'throughput × acceptable wait = 100/s × 2 s. Beyond that, reject immediately. 100/s succeed, 30/s fail fast, and recovery is instant when load drops.' },
        { id: 'fix2', label: 'Drop expired at the front', kind: 'service', x: 570, y: 320, detail: 'Check the deadline before starting work. Dead work becomes free capacity, which turns a 25-minute drain into seconds. A few lines of code.' },
      ],
      edges: [
        { id: 'c1', source: 'load', target: 'queue', kind: 'sync' },
        { id: 'c2', source: 'queue', target: 'svc', kind: 'sync' },
        { id: 'c3', source: 'svc', target: 'dead', kind: 'control' },
        { id: 'c4', source: 'svc', target: 'retry', kind: 'async' },
        { id: 'c5', source: 'retry', target: 'queue', kind: 'sync' },
        { id: 'c6', source: 'retry', target: 'up', kind: 'control' },
        { id: 'c7', source: 'svc', target: 'drain', kind: 'control' },
        { id: 'c8', source: 'queue', target: 'fix1', kind: 'control' },
        { id: 'c9', source: 'queue', target: 'fix2', kind: 'control' },
      ],
      steps: [
        {
          id: 'qc1',
          title: 'The queue records the deficit rather than absorbing it',
          description:
            '30 requests per second accumulate. Little\'s Law converts depth into wait: 1,800 queued at 100/s is an 18-second wait, and the caller\'s timeout is 5 seconds.',
          nodes: ['load', 'queue', 'svc'],
          edges: ['c1', 'c2'],
        },
        {
          id: 'qc2',
          title: 'Goodput reaches zero while throughput looks perfect',
          description:
            'Every request now being processed was queued past its caller\'s timeout. 100% CPU, 100 responses per second, none of them read. Throughput and goodput have completely diverged.',
          nodes: ['dead'],
          edges: ['c3'],
        },
        {
          id: 'qc3',
          title: 'Retries amplify and the failure climbs upward',
          description:
            'Timed-out callers retry, roughly doubling arrival. Their own pools fill with requests waiting on this service, so they begin failing traffic that never touched it.',
          nodes: ['retry', 'up'],
          edges: ['c4', 'c5', 'c6'],
        },
        {
          id: 'qc4',
          title: 'Recovery takes far longer than the overload',
          description:
            'Load drops to 90/s, leaving 10/s to drain 15,000 items — 25 minutes, all of it work nobody will read, while new requests still fail behind it.',
          nodes: ['drain'],
          edges: ['c7'],
        },
        {
          id: 'qc5',
          title: 'Two changes make it a four-minute partial failure',
          description:
            'A queue bounded at throughput × acceptable wait rejects the excess immediately and honestly. Checking deadlines at the front of the queue turns dead work into free capacity.',
          nodes: ['fix1', 'fix2'],
          edges: ['c8', 'c9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'mechanism-choice',
      title: 'Which mechanism for which failure',
      caption:
        'Read the right column. The commonest mistake is a circuit breaker on a merely slow dependency — it fails everything in a step where a concurrency limit would degrade proportionally.',
      code: `flowchart LR
    Q["What is happening?"]

    Q --> S1["More load than<br/>we can serve"] --> A1["**Bounded queue +<br/>shed by criticality**<br/>Reject early, cheaply,<br/>preserving critical work"]

    Q --> S2["A dependency is<br/>SLOW"] --> A2["**Concurrency limit +<br/>bulkhead**<br/>Slots fill and callers throttle<br/>automatically — no number<br/>to retune"]

    Q --> S3["A dependency is<br/>DOWN"] --> A3["**Circuit breaker**<br/>Stop paying timeouts to<br/>discover it, and give it<br/>load-free time to recover"]

    Q --> S4["Queued work has<br/>already expired"] --> A4["**Drop at the front<br/>of the queue**<br/>Dead work becomes<br/>free capacity"]

    Q --> S5["Callers are amplifying<br/>with retries"] --> A5["**Retry budget +<br/>client-side throttling**"]

    S2 --> W["✗ A breaker here fails<br/>everything in a step<br/>when a proportional<br/>degradation was available"]

    style A1 fill:#17272a,stroke:#35897e
    style A2 fill:#17272a,stroke:#35897e
    style A3 fill:#17272a,stroke:#35897e
    style A4 fill:#17272a,stroke:#35897e
    style W fill:#2a1a1a,stroke:#a04848`,
    },
  ],

  productionExample: {
    systems: ['google'],
    body: `Google's published treatment of overload handling is the most complete practical account, and four of its positions are worth extracting because each contradicts a common instinct.

**Criticality is assigned in advance and carried with the request.** Requests are labelled — roughly critical, sheddable-plus, sheddable — and the label travels through the call chain. So a downstream service under pressure can shed the low-criticality traffic while continuing to serve critical requests, **without knowing anything about the business meaning** of the request.

That propagation is the part that makes it work. A criticality decided per-service would be inconsistent; carried with the request, every layer sheds the same things.

**Client-side throttling, not just server-side rejection.** When a client observes a high rejection rate it reduces its own send rate, rejecting some requests locally without sending them. The reasoning is that a server spends resources rejecting, so a well-behaved client that stops sending saves both sides. **Rejection is cheaper than service and it is not free**, and at high enough volume the rejections themselves become the load.

**Per-customer limits computed from actual capacity, not from a plan.** Rather than a fixed per-customer quota, the allocation reflects what the service can currently serve. This connects directly to the rate-limiting lesson's conclusion: fixed per-client limits summing above capacity means the limiter never fires during an overload.

**Retries are budgeted as a fraction of traffic**, with the explicit observation that retries are what turn a partial overload into a total one.

**And the operational finding that surprises people: during a cascade, add less load rather than more capacity.** New capacity in a system saturated with retries and dead work is consumed immediately by the same amplified load. The documented approach is to shed aggressively, let the system stabilise, then ease off — and to be prepared for recovery to take much longer than the original incident.

**The transferable lessons.**

**Decide criticality before you need it, and propagate it.** Assigning it during an incident is arbitrary, and assigning it per-service is inconsistent.

**Make rejection cheap and make it early.** A rejection that runs authentication and database lookups is not a rejection.

**Instrument goodput.** A dashboard showing throughput next to wasted work makes overload legible; one showing CPU and throughput alone actively misleads.

**Where this needs adapting.** This is guidance for a large fleet with a uniform RPC layer, where propagating criticality is a framework feature. A smaller system gets most of the benefit from three cheaper things: bounded queues sized by Little's Law, dropping expired work at the front of the queue, and per-dependency concurrency limits. **Those three are available to anyone and cover the failure this lesson opens with.**`,
  },

  tradeoffs: {
    intro:
      'The decision is which mechanism to apply to which failure. Rows are ordered roughly by how early they act, which is also roughly by how much they help.',
    rows: [
      {
        option: 'Unbounded queue',
        whenItWins:
          'Never, for a request path. It is the default in many frameworks and thread pools, which is why it needs naming.',
        whenItLoses:
          'Always. It converts a bounded, visible overload into an unbounded, invisible, self-sustaining one, and recovery outlasts the cause by an order of magnitude.',
        cost:
          'Full CPU with zero goodput, and a backlog that persists long after load normalises.',
      },
      {
        option: 'Bounded queue sized by Little\'s Law',
        whenItWins:
          'Always. `throughput × acceptable_wait` gives a genuine burst buffer, and beyond it rejection is fast, honest and instantly recoverable.',
        whenItLoses:
          'When the burst is longer than the buffer — but then rejecting is the correct behaviour anyway.',
        cost:
          'Visible rejections during bursts, which callers must handle.',
      },
      {
        option: 'Dropping expired work at the front of the queue',
        whenItWins:
          'Always, and it is the cheapest fix here. A few lines that turn dead work into free capacity and a long drain into a short one.',
        whenItLoses:
          'Only if requests carry no deadline — which is itself the thing to fix.',
        cost:
          'Requires a deadline on the request and a check before starting work.',
      },
      {
        option: 'Load shedding by criticality',
        whenItWins:
          'When you must drop something and not everything matters equally. Preserves payments and authentication while dropping recommendation refreshes.',
        whenItLoses:
          'If criticality is assigned during the incident, or per-service rather than carried with the request.',
        cost:
          'Classifying every request path in advance, and propagating the label.',
      },
      {
        option: 'Concurrency limit per dependency (bulkhead)',
        whenItWins:
          'Protecting against a slow dependency. Slots fill as it slows, so callers throttle automatically with no number to retune, and one hung dependency cannot exhaust the shared pool.',
        whenItLoses:
          'When the limit is set far from the dependency\'s real capacity — which adaptive limits address.',
        cost:
          'Per-dependency allocation to size, and lower peak utilisation than a shared pool.',
      },
      {
        option: 'Adaptive concurrency limit',
        whenItWins:
          'When a dependency\'s capacity changes with deployment, data size or load. Finds the real limit from observed latency, like congestion control.',
        whenItLoses:
          'When latency is noisy for reasons unrelated to load, causing the limit to oscillate.',
        cost:
          'More machinery, and a limit that is harder to reason about during an incident.',
      },
      {
        option: 'Circuit breaker',
        whenItWins:
          'A dependency that is **down**. Stops paying timeouts to rediscover it, and gives it a load-free period to recover.',
        whenItLoses:
          'A dependency that is merely slow or has a legitimate error rate — the breaker fails everything in a step where proportional degradation was available.',
        cost:
          'Total failure for governed traffic while open, plus four distinct misconfigurations that cause outages.',
      },
      {
        option: 'Client-side throttling',
        whenItWins:
          'When rejection volume is itself significant load. The client stops sending rather than being rejected, saving both sides.',
        whenItLoses:
          'When failures are specific to a subset of requests rather than the dependency as a whole.',
        cost:
          'Locally rejecting requests that might have succeeded.',
      },
      {
        option: 'Graceful degradation to a reduced service',
        whenItWins:
          'When a worse answer is much better than no answer — stale cache, a page without recommendations, reduced precision.',
        whenItLoses:
          'When the degraded path only runs during incidents, making it the least-tested code under the worst conditions.',
        cost:
          'A second code path to maintain and continuously exercise, plus possibly-stale data served silently.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We use a queue in front of the service so it can absorb traffic spikes."',
      whyWeak:
        'A queue does not add capacity; it converts a throughput deficit into latency. By Little\'s Law, 1,000 queued in front of a service doing 100/second is a 10-second wait — so if callers time out at 5 seconds, everything behind depth 500 is guaranteed worthless.',
      strongAnswer:
        '"A queue buffers a burst and cannot absorb sustained overload — the deficit accumulates as delay. I would size it from Little\'s Law: throughput times the maximum acceptable wait, so 100 per second and a 2-second budget gives a queue of 200. Beyond that, reject immediately. And I would drop requests whose deadline has already passed at the front of the queue, because that work is free to discard and expensive to perform."',
    },
    {
      weakAnswer: '"Throughput and CPU look normal, so the service is healthy."',
      whyWeak:
        'Under overload those are exactly the metrics that mislead. A service at 100% CPU producing its full rated throughput can have zero goodput if every response arrives after its caller timed out — and the throughput graph is flat and healthy throughout.',
      strongAnswer:
        '"Throughput is misleading under overload because it counts responses nobody reads. I would instrument goodput — on completion, compare elapsed time to the deadline and count the request as useful or wasted. A wasted-work percentage next to throughput makes an overload obvious, and queue depth or wait time is the leading indicator that CPU and throughput both hide."',
    },
    {
      weakAnswer: '"We added a circuit breaker on every downstream call for resilience."',
      whyWeak:
        'A breaker converts a partial failure into a total one for the traffic it governs. That is right when the dependency is down and wrong when it is slow or has a legitimate error rate — a dependency that genuinely 404s 5% of the time will trip a 5% breaker and cut off the 95% that would have succeeded.',
      strongAnswer:
        '"A breaker is for a dependency that is *down*, where every call is a wasted timeout. For a slow dependency I would use a concurrency limit, which degrades proportionally rather than in a step. And a breaker needs care: count only failures indicating unavailability rather than application errors, require a minimum request volume before the ratio means anything, scope it per operation rather than per service, and verify the half-open probe can actually succeed."',
    },
    {
      weakAnswer: '"We rate limit calls to the downstream service so we do not overload it."',
      whyWeak:
        'A rate limit is a fixed guess about the dependency\'s speed. If it slows from 50 ms to 500 ms, the same request rate now means ten times the concurrent work, so the limit no longer protects it — and if it speeds up, the limit wastes capacity.',
      strongAnswer:
        '"A concurrency limit is the right shape: 20 in-flight is 20 in-flight regardless of latency, so when the dependency slows the slots fill and callers throttle automatically with nothing to retune. I would also make it a per-dependency allocation rather than a share of one pool, so a hung dependency consumes its own bulkhead and cannot fail requests that never touched it."',
    },
    {
      weakAnswer: '"Under overload we shed the excess traffic."',
      whyWeak:
        'It omits both hard parts. Which traffic — a payment or a recommendation refresh? And rejection must be much cheaper than service, or shedding does not help; a rejection that runs authentication, a database lookup and full logging is just a slightly cheaper request.',
      strongAnswer:
        '"Shedding needs criticality assigned in advance and carried with the request, so every layer sheds the same things consistently — best-effort work first, critical operations last. And the rejection has to be genuinely cheap and as early as possible, ideally at the edge: a request rejected after traversing four services has already consumed four services\' resources."',
    },
    {
      weakAnswer: '"When the system is overloaded we scale up to add capacity."',
      whyWeak:
        'In a cascade, new capacity is consumed immediately by the accumulated retry load and by dead work being processed for callers who have gone. Scaling up often changes nothing, and it takes minutes during which the backlog grows further.',
      strongAnswer:
        '"During a cascade the fix is usually to reduce load, not add capacity — new capacity gets consumed by retries and by dead work. So: shed aggressively at the edge, drop expired work at the front of queues, and confirm caller retry budgets are actually capping retries. Then ease off. Capacity is the right answer for sustained under-provisioning and the wrong one for a cascade already in progress."',
    },
  ],

  flashcards: [
    {
      id: 'fc-bp-1',
      front: 'What does a queue actually do to an overload?',
      back: 'Converts a throughput problem into a latency problem. The deficit accumulates as delay rather than disappearing, and past a certain depth every response is too late to be useful.',
      topic: 'queueing',
    },
    {
      id: 'fc-bp-2',
      front: 'State Little\'s Law in its useful form.',
      back: '`wait = queue depth / throughput`. 1,000 queued at 100/second is a 10-second wait — arithmetic, not a tuning parameter.',
      topic: 'queueing',
    },
    {
      id: 'fc-bp-3',
      front: 'How do you size a queue?',
      back: '`throughput × acceptable_wait`. 100/second with a 2-second budget gives 200. Anything much larger is a mechanism for accepting work you cannot do.',
      topic: 'queueing',
    },
    {
      id: 'fc-bp-4',
      front: 'What is goodput and why does it matter?',
      back: 'Responses delivered before their deadline. Under overload throughput can be at its rated maximum while goodput is zero — and only throughput appears on the dashboard.',
      topic: 'queueing',
    },
    {
      id: 'fc-bp-5',
      front: 'Why is dropping expired work at the front of the queue so valuable?',
      back: 'Dead work becomes free capacity. It converts a long drain into a short one for a few lines of code, and it is the cheapest fix in the lesson.',
      topic: 'load-shedding',
    },
    {
      id: 'fc-bp-6',
      front: 'Why does an unbounded queue make recovery worse than the outage?',
      back: 'The backlog must drain at spare capacity, which is small — so a four-minute overload can produce a half-hour outage, with retries potentially preventing any drain at all.',
      topic: 'queueing',
    },
    {
      id: 'fc-bp-7',
      front: 'What is backpressure, and where does it not exist?',
      back: 'A signal upstream saying "slow down". It does not exist in a synchronous HTTP API or through a message queue — the nearest equivalent is shedding plus a hint the client may ignore.',
      topic: 'backpressure',
    },
    {
      id: 'fc-bp-8',
      front: 'What signal should you shed on, and which should you not?',
      back: 'Queue wait against the deadline, sustained minimum latency, or concurrency saturation. Not CPU — it lags, and an I/O-bound service can be overloaded at 40%.',
      topic: 'load-shedding',
    },
    {
      id: 'fc-bp-9',
      front: 'What are the two requirements for load shedding to work?',
      back: 'Criticality assigned in advance and carried with the request, and a rejection that is genuinely cheap and applied as early as possible.',
      topic: 'load-shedding',
    },
    {
      id: 'fc-bp-10',
      front: 'Why is a concurrency limit better than a rate limit for a dependency?',
      back: 'It is invariant to latency. When the dependency slows, slots fill and callers throttle automatically — a rate limit is a fixed guess about speed that stops protecting when speed changes.',
      topic: 'backpressure',
    },
    {
      id: 'fc-bp-11',
      front: 'What is a bulkhead and what does it prevent?',
      back: 'A bounded per-dependency allocation of threads or connections. It stops one hung dependency from exhausting a shared pool and failing traffic that never touched it.',
      topic: 'backpressure',
    },
    {
      id: 'fc-bp-12',
      front: 'When is a circuit breaker right, and when is it wrong?',
      back: 'Right when the dependency is *down* — every call is a wasted timeout. Wrong when it is merely slow, where a concurrency limit degrades proportionally instead of in a step.',
      topic: 'circuit-breakers',
    },
    {
      id: 'fc-bp-13',
      front: 'Name the four ways a circuit breaker causes an outage.',
      back: 'A threshold tripping on legitimate application errors; insufficient volume for the ratio to mean anything; one breaker shared across independently-failing operations; and half-open probes that cannot succeed.',
      topic: 'circuit-breakers',
    },
    {
      id: 'fc-bp-14',
      front: 'Why is adding capacity often wrong during a cascade?',
      back: 'New capacity is immediately consumed by accumulated retries and by dead work being processed for callers who have gone. Shed load first, then ease off.',
      topic: 'cascading-failure',
    },
  ],

  quiz: [
    {
      id: 'q-bp-1',
      kind: 'scenario',
      prompt:
        'A service handles 100 requests/second. 1,000 requests are queued. Callers time out at 5 seconds. What is true of the request at the back of the queue?',
      options: [
        { id: 'a', label: 'It will wait about 10 seconds, so its caller will have timed out before processing begins — the work is already worthless' },
        { id: 'b', label: 'It will be served within 5 seconds because the queue drains quickly' },
        { id: 'c', label: 'It will be served immediately if the service scales up' },
        { id: 'd', label: 'Its wait depends on CPU utilisation rather than queue depth' },
      ],
      correct: ['a'],
      explanation:
        'Little\'s Law: wait equals depth divided by throughput, so 1,000 at 100/second is 10 seconds. This is arithmetic rather than a tuning question, and it means any queue deeper than 500 guarantees failure for everything behind it. Dropping the request at the front rather than processing it is free capacity.',
      difficulty: 'core',
      topic: 'queueing',
    },
    {
      id: 'q-bp-2',
      kind: 'scenario',
      prompt:
        'During an incident, CPU is 100%, throughput is at its normal 100/second, and the error rate is 100%. What is happening?',
      options: [
        { id: 'a', label: 'The service is producing responses for callers who have already timed out — throughput is at maximum and goodput is zero' },
        { id: 'b', label: 'The service is CPU-bound and needs more cores' },
        { id: 'c', label: 'The errors are coming from a downstream dependency, not from this service' },
        { id: 'd', label: 'The throughput metric is broken, since a 100% error rate means zero throughput' },
      ],
      correct: ['a'],
      explanation:
        'This is the signature combination and the reason to instrument goodput. Throughput counts responses produced; it says nothing about whether anyone was still waiting. A flat healthy throughput graph beside a 100% error rate is what a saturated queue looks like, and reading throughput alone sends the investigation elsewhere.',
      difficulty: 'advanced',
      topic: 'queueing',
    },
    {
      id: 'q-bp-3',
      kind: 'scenario',
      prompt:
        'A dependency returns 404 for about 5% of requests as normal behaviour. A circuit breaker is configured to open at a 5% failure rate. What happens?',
      options: [
        { id: 'a', label: 'The breaker opens under normal conditions and rejects all traffic, including the 95% that would have succeeded' },
        { id: 'b', label: 'Nothing, since 404 is not a failure' },
        { id: 'c', label: 'The breaker opens only if the rate exceeds 5% significantly' },
        { id: 'd', label: 'The breaker enters half-open and stays there' },
      ],
      correct: ['a'],
      explanation:
        'A breaker must count only failures indicating unavailability — connection errors, timeouts, 503s — not application-level outcomes. Counting a legitimate 404 rate turns the breaker into a self-inflicted outage, and it is one of four standard misconfigurations alongside insufficient volume, over-broad scope, and probes that cannot succeed.',
      difficulty: 'core',
      topic: 'circuit-breakers',
    },
    {
      id: 'q-bp-4',
      kind: 'scenario',
      prompt:
        'A caller limits itself to 200 requests/second to a dependency. The dependency slows from 50 ms to 500 ms per request. What happens to the concurrent load on it?',
      options: [
        { id: 'a', label: 'It rises tenfold — from about 10 concurrent to about 100 — so the rate limit no longer protects it' },
        { id: 'b', label: 'It stays the same, since the rate is unchanged' },
        { id: 'c', label: 'It falls, since slower responses mean fewer requests complete' },
        { id: 'd', label: 'It depends on the dependency\'s thread pool size' },
      ],
      correct: ['a'],
      explanation:
        'Concurrency is arrival rate times service time — Little\'s Law again. At 200/second and 50 ms, roughly 10 are in flight; at 500 ms, roughly 100. A rate limit is a guess about latency, so it stops protecting the moment latency changes. A concurrency limit is invariant and throttles the caller automatically.',
      difficulty: 'advanced',
      topic: 'backpressure',
    },
    {
      id: 'q-bp-5',
      kind: 'scenario',
      prompt:
        'A four-minute 30% overload leaves a service failing 100% of requests for 25 minutes afterwards, with load back to normal. What is the mechanism and the fix?',
      options: [
        { id: 'a', label: 'An unbounded queue accumulated a backlog that drains only at spare capacity, and every drained request is already expired — bound the queue and drop expired work at the front' },
        { id: 'b', label: 'The service needs more capacity to handle the peak' },
        { id: 'c', label: 'A circuit breaker opened and has not reset' },
        { id: 'd', label: 'A cache expired during the overload and is still cold' },
      ],
      correct: ['a'],
      explanation:
        'The backlog is the whole story: 15,000 queued items draining at 10 per second is 25 minutes, all spent on requests whose callers left. A bounded queue means the overload causes four minutes of partial failure and instant recovery. Dropping expired work at the front converts the remaining drain into seconds.',
      difficulty: 'core',
      topic: 'cascading-failure',
    },
    {
      id: 'q-bp-6',
      kind: 'multi',
      prompt:
        'Which are true about load shedding? Select all that apply.',
      options: [
        { id: 'a', label: 'Criticality should be assigned before an incident and carried with the request' },
        { id: 'b', label: 'The rejection must be much cheaper than the work, or shedding does not help' },
        { id: 'c', label: 'Shedding should happen as early as possible, ideally at the edge' },
        { id: 'd', label: 'CPU utilisation is the best signal for when to start shedding' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are what make shedding effective rather than arbitrary. CPU is a poor signal: it lags, and an I/O-bound service can be badly overloaded at 40% CPU. Queue wait against the deadline, sustained minimum latency, or concurrency saturation are the signals that actually indicate the condition shedding addresses.',
      difficulty: 'core',
      topic: 'load-shedding',
    },
  ],

  exercises: [
    {
      id: 'ex-bp-1',
      kind: 'design',
      title: 'Size the queues, then decide what dies',
      estimatedMinutes: 30,
      prompt: `An API service has these facts:

- Capacity: 800 requests/second per instance, 20 instances.
- Caller deadline: 2 seconds, propagated.
- Request mix: 60% product reads (cheap, cacheable), 25% search (expensive), 10% cart/checkout (critical), 5% recommendations (best-effort).
- Dependencies: PostgreSQL (p99 40 ms), search cluster (p99 300 ms), payment processor (p99 900 ms), recommendation service (p99 150 ms).
- Traffic doubles for 10 minutes every day at a promotion drop.

Specify: queue bounds, criticality classes, the shedding signal and thresholds, concurrency limits per dependency, and where circuit breakers go. Then answer:

- Compute the queue bound from Little's Law and justify the acceptable wait.
- Traffic triples unexpectedly. Walk through what happens, in order.
- The search cluster slows to 3 seconds p99. Trace it with and without your design.
- Where would a circuit breaker be wrong here, and what replaces it?`,
      rubric: [
        'Queue bound computed from throughput × acceptable wait, with the wait justified against the 2-second deadline.',
        'Criticality classes assigned to all four traffic types with reasoning.',
        'Shedding signal is queue wait or latency-based, explicitly not CPU.',
        'Concurrency limits per dependency, sized from latency and target throughput.',
        'Bulkheads: separate allocations so one dependency cannot exhaust the pool.',
        'Circuit breaker placed only where a dependency can be down, with failure classification.',
        'Identifies search as the dependency needing a concurrency limit rather than a breaker.',
        'Triple-traffic trace is ordered and specific about what sheds first.',
        'Search-slowdown trace contrasts with and without the design.',
        'Expired-work dropping is included.',
      ],
      modelAnswer: `**Queue bound, from Little's Law**

Per instance: 800 requests/second capacity. The deadline is 2 seconds, propagated from the caller.

*How much of that 2 seconds can be queue wait?* The work itself needs time: a product read is a few milliseconds plus a 40 ms database p99; a search is 300 ms; a checkout involves a 900 ms payment call. **The slowest legitimate request needs about 1 second of service time**, so I can afford at most 1 second of queue wait for it — and considerably less if I want checkouts to succeed comfortably.

I would set the acceptable wait at **250 ms**:

\`\`\`
max_queue_depth = 800/s × 0.25 s = 200 per instance
\`\`\`

*Why 250 ms and not 1 second:* a queue wait of 1 second leaves no margin for a slow dependency, and the queue is meant to buffer *scheduling jitter and micro-bursts*, not to hold sustained overload. 250 ms absorbs a burst of 200 requests — a real buffer — while leaving 1.75 seconds for the work.

**And separate queues per criticality class**, which is the more important structural decision:

\`\`\`
critical (cart/checkout):     depth 100    (never shed until last)
important (product, search):  depth 150
best-effort (recommendations): depth 20     (sheds first, almost immediately)
\`\`\`

*Why separate queues rather than one with priorities:* a single queue means a burst of recommendations sits ahead of a checkout. Separate queues with a scheduler that always drains critical first means **a flood of best-effort traffic cannot delay a checkout at all** — which one shared queue cannot guarantee regardless of how it is sorted, because the items are already in it.

*The best-effort queue is deliberately tiny.* 20 deep at 800/second is 25 ms of buffer. Recommendations should be dropped almost immediately under any pressure, and a large queue for them would only accumulate work nobody needs.

**Criticality classes**

| Traffic | Class | Reasoning |
| --- | --- | --- |
| Cart / checkout (10%) | **Critical** | Revenue, and a failed checkout is a lost sale rather than a retry. Shed last. |
| Product reads (60%) | **Important** | The core experience, and cacheable — so degradation to stale data is available before shedding. |
| Search (25%) | **Important, sheddable-first within its class** | Expensive per request, and a degraded search (fewer results, cached popular queries) is acceptable. |
| Recommendations (5%) | **Best-effort** | The page works without it. Shed first, always. |

**The label is assigned at the edge and carried with the request**, so every downstream service sheds the same things. A criticality decided per service would be inconsistent — the search cluster would have no way to know a request came from a checkout flow.

*One refinement:* product reads are 60% of traffic and cacheable. Under pressure I would serve them **stale from cache** before shedding them, which is graceful degradation preserving the majority of traffic. That makes the effective shed order: recommendations, then search, then product reads become stale, then product reads shed, then checkout.

**Shedding signal and thresholds**

**Not CPU.** These requests are dominated by waiting on dependencies, so the service can be badly overloaded at 40% CPU. CPU would tell me nothing until far too late.

**Primary signal: queue wait time against remaining deadline**, checked at admission:

\`\`\`
on arrival:
  estimated_wait = queue_depth / recent_throughput
  if estimated_wait + p99_service_time > remaining_deadline:
      reject immediately (503 + Retry-After)
\`\`\`

*Why this signal:* it directly answers the question that matters — "can this request possibly succeed?" A request that cannot is rejected in microseconds rather than consuming a second of capacity to produce a response nobody reads.

**Secondary signal: sustained minimum queue delay.** If the *minimum* observed queue delay over a 100 ms window stays above 50 ms for 500 ms, start shedding best-effort traffic proactively. Using the minimum over a window distinguishes a **standing queue** from a brief burst, so it does not shed on a spike that will clear itself — which is the property that makes latency-based admission control usable.

**Thresholds by class:**

\`\`\`
sustained delay > 50 ms   → shed recommendations
sustained delay > 100 ms  → serve product reads from stale cache
sustained delay > 150 ms  → shed search
sustained delay > 400 ms  → shed product reads
checkout: shed only when its own queue is full
\`\`\`

**Plus: drop expired requests at the front of every queue.** Before starting work, check the propagated deadline; if it has passed, discard and take the next. **This is the cheapest and highest-value item in the whole design** — it converts dead work into free capacity and prevents the 25-minute-drain failure entirely.

**Concurrency limits per dependency, per instance**

Sized as \`target_throughput × latency\`, with headroom:

\`\`\`
PostgreSQL:      800/s × 0.04 s = 32   → limit 50
Search cluster:  200/s × 0.30 s = 60   → limit 80
Payment:          80/s × 0.90 s = 72   → limit 100
Recommendations:  40/s × 0.15 s = 6    → limit 15
                                  Total: 245 slots
\`\`\`

**These are bulkheads: separate allocations, not shares of one pool.** That is the load-bearing property. If the search cluster hangs completely, it consumes its 80 slots and stops — PostgreSQL, payment and recommendation calls continue with their own allocations, so **checkouts keep working while search is dead.** With a shared pool of 245, a hung search cluster would take all of it within seconds and fail everything.

*I would make the search limit adaptive*, adjusting from observed latency in the manner of congestion control. The search cluster's capacity varies with index size and query mix, so a fixed 80 will be wrong after the next index rebuild — and a limit that finds the real capacity is better than one somebody retunes quarterly.

**Circuit breakers: exactly one, and it is the payment processor**

**Payment processor: yes.** It is a third party that can be genuinely *down*, and when it is, every call costs a 900 ms-to-timeout wait to rediscover it. A breaker rejects immediately, freeing slots.

\`\`\`
Failure criteria:  connection errors, timeouts, 5xx only
                   NOT 402 (card declined) — that is a valid outcome
Minimum volume:    20 requests in the window before the ratio counts
Threshold:         50% failures
Open duration:     10 s, then half-open with 3 probes
Scope:             per operation (authorise / capture / refund)
\`\`\`

*The 402 exclusion is the important detail.* Declined cards are normal and could easily be 5–10% of traffic. Counting them would trip the breaker under healthy conditions and stop all payments — the exact self-inflicted outage from the mistakes section.

*Per-operation scope:* if refunds are broken, authorisations should keep working. One breaker per service would cut off all three.

**Where a breaker would be wrong**

**The search cluster.** It is far more likely to be *slow* than *down* — a heavy query mix, an index merge, a hot shard. A breaker would fail 100% of search when the cluster could still serve, say, 60% of normal throughput. **The concurrency limit degrades proportionally instead**: as search slows, its 80 slots fill, further search requests are shed, and the searches that do run succeed. Users see slower or occasionally-rejected search rather than no search at all.

**PostgreSQL.** If the database is down, the service cannot function, so cutting off calls to it achieves nothing except changing the error message. And a breaker on the database risks tripping on a transient blip and taking the service down when it would have recovered. A short timeout, a statement timeout and a concurrency limit are the right tools.

**Recommendations.** A breaker here would be *harmless* but redundant — this is best-effort traffic that the shedding logic already drops first. Adding a breaker adds a second mechanism with its own misconfiguration risk for no benefit.

**The general rule I would state:** a breaker for a dependency that can be down and is not on the critical path for basic function; a concurrency limit for everything else.

---

**Traffic triples unexpectedly — walk through it**

Arrival goes from 16,000/second across the fleet to 48,000/second, against 16,000 capacity.

\`\`\`
t=0–0.2 s   Queues fill. Product-read and search queues reach their
            bounds within a fraction of a second at 3× arrival.

t≈0.1 s     Recommendations shed first. Its queue is 20 deep, so it
            fills almost instantly and the sustained-delay threshold
            of 50 ms is crossed. 5% of traffic gone, instantly.

t≈0.3 s     Sustained delay passes 100 ms. Product reads switch to
            serving from stale cache. This is the big one — 60% of
            traffic now bypasses PostgreSQL entirely, so effective
            capacity for that class rises sharply.

t≈0.5 s     Sustained delay passes 150 ms. Search sheds. 25% of
            traffic — the most expensive 25% — is rejected with
            503 + Retry-After.

t≈1 s       Steady state: recommendations rejected, search rejected,
            product reads served stale and fast, checkouts served
            normally from their own queue and their own payment
            bulkhead.

Ongoing     Admission control rejects anything whose estimated wait
            plus service time exceeds its remaining deadline. Expired
            requests are dropped at queue fronts. Goodput stays high
            for what is admitted.
\`\`\`

**The outcome:** roughly 30% of requests rejected fast, 60% served with stale data, and **100% of checkouts succeed.** Revenue is unaffected. Users see a degraded but working site.

**And critically, recovery is immediate.** When traffic returns to normal, the queues are at most 200 deep — 250 ms of work. There is no backlog, no dead work, and no 25-minute tail. The 10-minute event causes 10 minutes of degradation.

*The daily promotion drop is only 2×, so it should be handled with capacity rather than shedding.* I would scale to 30 instances ahead of it — shedding 15% of traffic every day at a known time is a provisioning failure, not a resilience success. **Shedding is for the unpredictable 3×, not the predictable 2×**, and conflating the two is how teams end up permanently shedding.

**The search cluster slows to 3 seconds p99 — with and without the design**

**Without bulkheads or concurrency limits** (one shared pool of 245 slots, no shedding):

\`\`\`
t=0       Search requests start taking 3 s instead of 0.3 s.
t≈5 s     Search is 25% of 800/s = 200/s, each holding a slot for
          3 s → 600 concurrent needed against 245 available.
          The shared pool is exhausted by search alone.
t≈6 s     Product reads cannot get a slot. Checkouts cannot get a slot.
          EVERYTHING fails, including the 75% of traffic that never
          touches search.
t≈10 s    Callers time out and retry, roughly doubling arrival.
t≈30 s    Queues (unbounded, in this counterfactual) are tens of
          thousands deep. Goodput is zero. Callers' own pools are
          filling, so the failure climbs upward.
Recovery  Long after search recovers, the backlog and retries keep
          the service saturated.
\`\`\`

**A slow search cluster has taken down checkout.** That is the cascading-failure mechanism, and search is only a quarter of traffic.

**With the design:**

\`\`\`
t=0       Search calls start taking 3 s.
t≈1 s     The search bulkhead's 80 slots fill (80 × 3 s ≈ 27/s
          throughput, against 200/s demand).
t≈1 s     Further search requests find no slot → shed immediately
          with 503. Fast, cheap rejection.
t≈2 s     The adaptive concurrency limit observes rising latency and
          reduces the search limit, so fewer requests are admitted
          to a dependency that cannot serve them.
Always    PostgreSQL's 50 slots, payment's 100 and recommendations'
          15 are untouched. Product reads and checkouts are
          completely unaffected.
Deadline  Search requests admitted before the slowdown exceed their
          2 s deadline; they are dropped at the queue front rather
          than being processed for callers who have gone.
\`\`\`

**Outcome:** search is mostly unavailable and returns fast errors. Everything else works perfectly. **75% of traffic is unaffected**, and the fast rejection means callers can render a page without search rather than hanging.

*The single decision that produced that difference is the bulkhead* — a separate slot allocation per dependency rather than a shared pool. Timeouts alone would not have saved it: even a 500 ms timeout on search means 200/s × 0.5 s = 100 concurrent, which is still a large share of a 245 pool. **The bulkhead is what confines the damage; the timeout only limits how long each unit of damage lasts.**

*And I would add one thing:* a **cached-popular-queries fallback** for search, exercised continuously with 1% of live traffic so I know it works. Then a slow search cluster produces degraded search results rather than none — but only because the path is exercised daily rather than discovered during the incident.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-bp-1',
      level: 'basic',
      question: 'Does a queue help with overload?',
      guidance:
        'No — it converts a throughput deficit into latency. Look for Little\'s Law and for the recognition that past a certain depth every response is too late to be useful.',
    },
    {
      id: 'iq-bp-2',
      level: 'basic',
      question: 'How would you size a queue?',
      guidance:
        '`throughput × acceptable_wait`, with the wait derived from the caller\'s deadline minus service time. A strong answer also proposes separate queues per criticality class.',
    },
    {
      id: 'iq-bp-3',
      level: 'intermediate',
      question: 'What is goodput and why does it matter?',
      guidance:
        'Responses delivered before their deadline. Under overload it can be zero while throughput is at maximum. Look for the observation that throughput and CPU graphs actively mislead.',
    },
    {
      id: 'iq-bp-4',
      level: 'intermediate',
      question: 'How do you decide what to shed?',
      guidance:
        'Criticality assigned in advance and carried with the request, shed cheaply and early. Look for rejection of CPU as the signal in favour of queue wait or sustained latency.',
    },
    {
      id: 'iq-bp-5',
      level: 'advanced',
      question: 'When is a circuit breaker the wrong tool?',
      guidance:
        'When the dependency is slow rather than down, where it fails everything in a step. Excellent answers name the four misconfigurations and prefer a concurrency limit for proportional degradation.',
    },
    {
      id: 'iq-bp-6',
      level: 'advanced',
      question: 'Trace how one slow dependency takes down a service that does not depend on it.',
      guidance:
        'Held threads, shared pool exhaustion, then retries amplifying and climbing upward. Excellent answers name bulkheads as the fix and note timeouts alone are insufficient.',
    },
    {
      id: 'iq-bp-7',
      level: 'followup',
      question: 'You are in a cascade. Do you add capacity?',
      guidance:
        'Usually not — new capacity is consumed by retries and dead work. Shed aggressively, drop expired work, confirm retry budgets, then ease off. Capacity addresses sustained under-provisioning, not a cascade.',
    },
    {
      id: 'iq-bp-8',
      level: 'followup',
      question: 'You proposed graceful degradation. What makes it actually work?',
      guidance:
        'Continuous exercise with a fraction of live traffic, and degradation as a deliberate switch rather than an emergent consequence of timeouts — so behaviour is uniform and visible rather than inconsistent.',
    },
  ],

  activeLearning: [
    {
      id: 'al-bp-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed a synchronous request path with a waiting caller. Now change one thing: the work arrives through a message queue with no caller waiting. What still applies, and what needs rethinking?',
      discussion: `Removing the waiting caller removes the deadline that made most of the above computable, and it replaces it with a different constraint.

**What still applies exactly.**

**Little's Law.** Queue depth divided by throughput is still the wait. A consumer processing 100 jobs/second with 360,000 queued is an hour behind, and that arithmetic is what tells you whether catching up is possible.

**Bulkheads and concurrency limits.** A consumer calling a slow dependency still exhausts its worker pool, and workers are still shared. The mechanism is identical; only the symptom differs — the queue grows instead of requests failing.

**Cascading failure.** A consumer that hammers a struggling dependency keeps it down, and the fact that nobody is waiting does not change that.

**Circuit breakers.** Arguably *more* useful here: a consumer that stops calling a dead dependency stops burning workers on timeouts and can pause consumption entirely.

**What changes fundamentally.**

**There is no deadline, so "expired work" has no definition.** The single cheapest fix above — drop requests whose deadline has passed — is unavailable unless you invent one. And often you should: a job that has been queued for six hours may be worthless, and giving jobs a validity window makes the same optimisation available. **A stale-price-update job or a stale cache-invalidation job is genuinely better discarded than performed.** Deciding which jobs have a useful lifetime is work worth doing.

**Shedding becomes a different question.** You cannot reject a message the way you reject a request — it is already durably enqueued. The available moves are: process it and fail it into a dead-letter destination, leave it queued, or discard it explicitly. Discarding requires a policy about which jobs are droppable, which is criticality again but with a harsher decision.

**Priority becomes structural.** With separate queues per criticality and consumers weighted toward the critical ones, an accumulated backlog of best-effort work cannot delay critical work. This matters more than in the synchronous case because the backlog can be enormous.

**The overload is invisible unless someone watches depth.** A synchronous overload announces itself through latency and errors. A queue overload announces nothing — producers succeed, consumers work steadily, and the only signal is depth or consumer lag. **Depth and age-of-oldest-message are the entire observability story**, and they are frequently not alerted on.

**Recovery becomes the dangerous moment.** An hour of accumulated work becomes due at once when a dependency recovers. The consumer must ramp rather than flood — which a concurrency limit provides automatically, and which is a strong argument for using one rather than a rate limit.

**And a new failure appears: the queue itself filling.** A broker has finite retention or capacity. A consumer down long enough means messages are dropped by the broker or producers start failing — and *then* backpressure appears, suddenly and at the producer, which is usually the worst place for it.

**What I would build differently.**

**A validity window on jobs that have one**, checked before processing. This restores the "drop expired work" optimisation.

**Separate queues per criticality with weighted consumers**, so a best-effort backlog cannot starve critical work.

**A concurrency limit on the consumer**, not a rate limit — so it slows automatically as a dependency slows, and ramps automatically on recovery.

**Alerts on depth and on age-of-oldest-message**, because nothing else surfaces the condition.

**An explicit answer to "what happens when the broker fills"**, decided in advance rather than discovered.

**The transferable point.** The synchronous case has a caller's deadline doing quiet structural work: it defines what is worthless, bounds the queue implicitly, and makes overload visible. **Asynchronous work removes that, so every one of those has to be reconstructed deliberately** — a validity window, an explicit depth bound, and monitoring on depth. Teams reuse a synchronous mental model and are surprised that a consumer can be four hours behind with every dashboard green.`,
    },
    {
      id: 'al-bp-2',
      kind: 'debug',
      prompt:
        'A service\'s p50 latency is 30 ms and its p99 is 1,900 ms, against a 2-second client timeout. CPU is 55%, memory is fine, no dependency shows elevated latency, and the error rate is 1.5%. This has been true for weeks. Hypotheses?',
      discussion: `A p99 sixty times the p50 with moderate CPU and healthy dependencies is a queueing signature, not a capacity or dependency signature. Something is making a small fraction of requests wait, and the waiting is not for CPU.

**Hypothesis 1 — a bounded resource that is not CPU, saturating intermittently.** Worker threads, database connections, or a semaphore. If the pool has 50 slots and demand occasionally needs 60, 1% of requests wait for a slot. CPU stays moderate because waiting consumes none.

*Why it fits best:* it explains a healthy p50 (most requests get a slot immediately), a terrible p99 (a few wait), moderate CPU (waiting is free), and healthy dependency latency (**the dependency is fast for the calls that reach it** — the time is spent before the call, waiting for a connection).

*Check:* time spent acquiring a connection or worker, as distinct from time spent using it. Most pool libraries expose this and it is almost never graphed. **This is the single most informative metric here** and its absence is why this has persisted for weeks.

**Hypothesis 2 — head-of-line blocking behind a small number of expensive requests.** If the same workers serve both 5 ms lookups and 1,500 ms reports, a lookup arriving behind two reports waits. The p50 is the lookups that arrive clear; the p99 is those that queue behind a report.

*Why it fits:* moderate CPU because the expensive requests may be I/O-bound, and no dependency looks slow because each individual call is fine.

*Check:* the distribution of request durations by endpoint, and whether slow requests correlate in time with expensive ones. If p99 requests cluster immediately after a report begins, this is it. **The fix is a bulkhead — separate worker pools per traffic class.**

**Hypothesis 3 — garbage collection or another periodic stall.** A 1–2 second pause would put every request in flight during it into the p99. Weeks of stability fits a steady allocation rate.

*Check:* correlate slow-request timestamps with pause logs. If the p99 requests cluster inside pauses, this is the answer, and the remedy is tuning rather than architecture.

**Hypothesis 4 — a lock or contended shared resource.** A mutex, a hot row, a cache write lock. Most requests do not contend; a few do and wait. Moderate CPU, healthy dependencies.

*Check:* lock wait time if instrumented; otherwise whether slow requests share a characteristic — the same tenant, the same key, the same code path.

**Hypothesis 5 — connection establishment rather than request handling.** If connection reuse is imperfect, a fraction of requests pay a TCP and TLS handshake. That is easily hundreds of milliseconds, appears in client-measured latency, and is invisible in dependency-side latency because the dependency only measures the request.

*Check:* the gap between client-measured and server-measured duration for slow requests, and connection-pool reuse rates. **This is the hypothesis most often missed**, because every server-side metric looks fine.

**What I would check first: the gap between client-measured and server-measured request duration.** One comparison, and it splits the space decisively — time inside the service (hypotheses 1–4) versus time before it reaches the handler (hypothesis 5, plus network and TLS). Diagnosis should begin with the check that eliminates the most.

**Then: pool acquisition time.** It covers hypotheses 1 and 2, which together are the most likely, and it is the metric whose absence allowed this to run for weeks.

**Why this matters more than the numbers suggest.** A p99 of 1,900 ms against a 2-second timeout means **the service is one small perturbation away from a large error rate.** Any increase in load, a slightly slower dependency, or one extra expensive request type pushes p99 past 2 seconds and the error rate jumps from 1.5% to something much worse. The 1.5% is not the problem; the absence of margin is.

**And the 1.5% error rate is probably the tail already exceeding the timeout** — which means it is not a separate mystery to investigate but the same phenomenon measured differently. Confirming that the errors are timeouts rather than application failures is a quick and useful check.

**The fixes, depending on the answer.**

If a saturated pool: raise the limit if the dependency can take it, or bound admission so requests are rejected rather than queued for a slot they will not get in time.

If head-of-line blocking: **separate pools per traffic class.** A cheap request should never wait behind an expensive one, and this is a bulkhead applied inside a single service.

If garbage collection: tune it. This is the one case where the architecture is fine.

If connection establishment: fix pooling and keepalives.

**Regardless of the answer, two things.** Graph **pool acquisition time** alongside utilisation — a saturated pool with moderate CPU is invisible otherwise. And **alert on the ratio of p99 to the timeout**, not just on the error rate, because a p99 at 95% of the timeout is a pending incident and a green dashboard.

**Transferable:** a p99 far above the p50 with moderate CPU is always a queue for something that is not CPU. The candidates are a short list — threads, connections, locks, expensive neighbours, or handshakes — and the diagnostic is always "what bounded resource are these requests waiting for", never "how much CPU do we have".`,
    },
  ],

  revision: {
    bullets: [
      'A queue converts a throughput problem into a latency problem; it does not add capacity.',
      'Little\'s Law: `wait = queue depth / throughput`. 1,000 queued at 100/s is a 10-second wait.',
      'Size a queue as `throughput × acceptable_wait`. Anything much larger accepts work you cannot do.',
      'Goodput is responses delivered before their deadline; under overload it can be zero while throughput is at maximum.',
      'A flat healthy throughput graph beside a 100% error rate is the signature of a saturated queue.',
      'Dropping expired work at the front of the queue is the cheapest fix here — dead work becomes free capacity.',
      'An unbounded queue makes recovery outlast the outage by an order of magnitude.',
      'Backpressure is telling the caller to stop; a synchronous HTTP API has no channel for it.',
      'A message queue removes backpressure by design, so depth is the only signal.',
      'Shed on queue wait or sustained minimum latency, never on CPU — an I/O-bound service overloads at 40%.',
      'Assign criticality in advance and carry it with the request, so every layer sheds the same things.',
      'The rejection must be much cheaper than the work, and as early as possible.',
      'A concurrency limit is invariant to latency; a rate limit is a fixed guess about a dependency\'s speed.',
      'Bulkheads — per-dependency allocations — are what stop one hung dependency failing unrelated traffic.',
      'Timeouts limit how long each unit of damage lasts; bulkheads confine how much there is.',
      'A circuit breaker is for a dependency that is *down*; a concurrency limit for one that is slow.',
      'Breaker failure modes: counting application errors, insufficient volume, over-broad scope, unfixable probes.',
      'During a cascade, reduce load rather than adding capacity — new capacity is consumed by retries and dead work.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The set of mechanisms that decide what happens when demand exceeds capacity: bounded queues, backpressure signals, load shedding by criticality, concurrency limits, and circuit breakers.',
    whyItExists:
      'Because a queue records an overload rather than absorbing it, so without a deliberate decision about what not to serve, a bounded and visible problem becomes an unbounded and invisible one.',
    whenToUse: [
      'Bounded queues sized by Little\'s Law, always.',
      'Dropping expired work at the front of every queue, always.',
      'Shedding by criticality when demand can exceed capacity unpredictably.',
      'Per-dependency concurrency limits and bulkheads, always.',
      'A circuit breaker only for a dependency that can be entirely down.',
    ],
    whenNotToUse: [
      'An unbounded queue anywhere on a request path.',
      'A circuit breaker on a merely slow dependency, or on one whose failure means you cannot function anyway.',
      'CPU as a shedding signal.',
      'Shedding as a substitute for capacity you predictably need.',
      'Adding capacity as the first response to a cascade in progress.',
    ],
    alternatives: [
      'Graceful degradation to stale cache or reduced results, before shedding.',
      'A rate limit, for per-client fairness rather than for protecting a dependency.',
      'Adaptive concurrency limits, when a dependency\'s capacity changes over time.',
      'Client-side throttling, when rejection volume is itself significant load.',
      'Provisioning, for predictable peaks — shedding is for the unpredictable.',
    ],
    tradeoffs: [
      'A bounded queue buys fast honest failure and instant recovery, and costs visible rejections during bursts.',
      'Shedding by criticality buys preserved critical traffic and costs classifying every path in advance.',
      'A concurrency limit buys automatic adaptation to a dependency\'s speed and costs lower peak utilisation.',
      'Bulkheads buy failure isolation and cost the efficiency of a shared pool.',
      'A circuit breaker buys freed resources when a dependency is down and costs total failure when it is merely degraded.',
      'Graceful degradation buys a working service and costs a second path that must be continuously exercised.',
    ],
    failureModes: [
      'An unbounded queue producing full CPU with zero goodput.',
      'A backlog draining at spare capacity, so recovery outlasts the overload many times over.',
      'Throughput and CPU graphs looking healthy while every response is too late.',
      'Retries amplifying an overload into a self-sustaining cascade.',
      'One slow dependency exhausting a shared pool and failing unrelated traffic.',
      'A rate limit failing to protect a dependency once its latency changes.',
      'A circuit breaker tripping on legitimate application errors.',
      'A breaker tripping on noise because request volume is too low for the ratio.',
      'A breaker stuck open because half-open probes cannot succeed.',
      'A degraded path executing for the first time during an incident.',
      'A consumer hours behind with every dashboard green, because nobody alerts on queue depth.',
    ],
    followUpQuestions: [
      'Is every queue bounded, and what wait does its bound imply?',
      'Do you measure goodput, or only throughput?',
      'Do you drop requests whose deadline has already passed?',
      'What criticality classes exist, and is the label carried with the request?',
      'What signal triggers shedding, and is it CPU?',
      'Is your rejection genuinely cheaper than the work, and how early does it happen?',
      'Does each dependency have its own concurrency allocation, or do they share a pool?',
      'Is this dependency slow or down? Which mechanism matches?',
      'What does your breaker count as a failure, and can its probe succeed?',
      'Has the degraded path run under load this week?',
      'What is your p99 as a fraction of the client timeout?',
    ],
  },
});
