import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-observability',
  title: 'Logs, metrics, traces, SLOs',
  summary:
    'Metrics tell you something is wrong, traces tell you where, logs tell you why — and each has a cost model that decides what you can afford to know. Averages hide every failure that matters, and percentiles cannot be averaged.',
  phase: 'distributed',
  module: 'resilience',
  position: 37,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['observability', 'metrics', 'tracing', 'percentiles', 'cardinality'],
  prerequisites: ['d-backpressure'],
  resources: [
    {
      key: 'opentelemetry-docs',
      tier: 'must',
      note: 'The vendor-neutral model for the three signals and, more importantly, for context propagation. Read the sections on traces and on context — propagation is the part that must be designed in rather than added later.',
    },
    {
      key: 'dapper-paper',
      tier: 'must',
      note: 'The original distributed-tracing design. Read the sections on the trace model and on sampling — the argument that low sampling rates still answer most questions is what makes tracing affordable.',
    },
    {
      key: 'prometheus-histograms',
      tier: 'must',
      note: 'Read this to understand why you cannot average percentiles and what a histogram actually stores. It is the single most consequential piece of measurement theory in this lesson.',
    },
    {
      key: 'otel-metrics',
      tier: 'good',
      note: 'Read the instrument types and the material on attributes. Attributes are cardinality, and cardinality is the cost model that governs what you can measure.',
    },
    {
      key: 'otel-logs',
      tier: 'good',
      note: 'Read it for how logs are correlated with traces via context. A log line without a trace id is an orphan, and this is the mechanism that prevents that.',
    },
    {
      key: 'google-sre-book',
      tier: 'advanced',
      note: 'Read the monitoring chapter for the four golden signals and for the argument that alerts should fire on symptoms rather than causes.',
    },
  ],

  intuition: {
    body: `Three signals, three different questions, three very different cost models. Choosing the wrong one for a question is the commonest reason an incident takes hours.

**Metrics** are numeric aggregates over time. Cheap, always on, and the right answer to *"is something wrong, and since when?"* A counter or a histogram costs a few bytes per series per scrape interval regardless of traffic volume — which is why metrics can cover everything.

**Traces** follow one request across every service it touches. They answer *"where did the time go, and what did this request actually do?"* Expensive per request, so they are sampled — and sampling is the design decision that makes them affordable.

**Logs** are discrete events with detail. They answer *"why did this specific thing happen?"* Cost scales with traffic **and** with verbosity, which is why log spend is the line item that surprises people.

The relationship worth internalising: **metrics detect, traces localise, logs explain.** An incident normally moves through all three in that order, and a team missing one of them substitutes a worse tool — grepping logs to find out whether error rates rose, which is slow and imprecise.

Then two ideas that decide whether your observability actually works.

**Averages hide every failure that matters.** A mean latency of 100 ms is consistent with every request taking 100 ms, and equally consistent with 99% taking 50 ms and 1% taking 5 seconds. The second is a serious problem and the mean is unmoved. **Worse: a user loading a page that makes 20 requests has a roughly 18% chance of hitting at least one p99 request**, so the p99 is not a rare edge case — it is the common experience of a page.

And the trap that follows: **you cannot average percentiles.** The mean of each server's p99 is not the fleet's p99, and there is no arithmetic that recovers it. Percentiles must be computed from a distribution — a histogram — which is why the storage format for latency is a design decision rather than an implementation detail.

**Cardinality is the cost model for metrics.** Every distinct combination of label values is a separate stored series. Adding a \`user_id\` label to a metric with a million users creates a million series and will take down your metrics system. **Metrics are for bounded dimensions; unbounded dimensions belong in traces and logs.** Nearly every metrics outage is a cardinality explosion.

The framing to carry: **design the three signals into the architecture, because the one thing you cannot add later is context propagation** — and without it, traces do not connect and logs cannot be correlated.`,
    analogyLimit:
      '"Add monitoring" treats observability as a layer applied afterwards, and one part of it genuinely cannot be: a trace id created at the edge and carried through every hop, every queue message and every log line has to be threaded through the code. Bolting it on later means retrofitting every function signature or accepting traces that break at each service boundary — which is why the propagation decision belongs in the first week rather than the first incident.',
  },

  deepExplanation: {
    predict: {
      question:
        'A dashboard shows mean latency of 95 ms, flat for weeks. Users complain the site is slow. A team member computes the fleet p99 by averaging the p99 reported by each of 40 servers, getting 180 ms — still fine. Both numbers are wrong for the question. Explain what each hides, and what the real numbers might be.',
      answer: `**What the mean hides.**

A mean of 95 ms is consistent with wildly different distributions:

\`\`\`
Distribution A: every request 95 ms                    → mean 95 ms
Distribution B: 99% at 50 ms, 1% at 4,550 ms           → mean 95 ms
Distribution C: 90% at 30 ms, 10% at 680 ms            → mean 95 ms
\`\`\`

B and C are serious problems and the mean cannot distinguish them from A. **The mean is dominated by the bulk and structurally blind to the tail**, and the tail is what users notice.

And the multiplication that makes this urgent: a page making **20 requests** has a chance of at least one p99 request of:

\`\`\`
1 − 0.99²⁰ = 18%
\`\`\`

So **roughly one page load in five contains a p99-latency request.** If the p99 is 4 seconds, nearly a fifth of page loads take over 4 seconds. That is not an edge case, and it is invisible in the mean.

**What averaging per-server p99s hides — and this is the more interesting error.**

You cannot average percentiles. There is no arithmetic that turns 40 per-server p99 values into a fleet p99, and the result is not an approximation — it can be wrong in either direction by a large margin.

*Concretely, why.* Suppose 39 servers are healthy with a p99 of 100 ms, and one server is broken with a p99 of 8,000 ms.

\`\`\`
Average of the 40 p99 values = (39 × 100 + 8,000) / 40 = 297 ms
\`\`\`

But the *fleet* p99 asks: across all requests, what value is the 99th percentile? The broken server handles 1/40th of traffic — 2.5% — and essentially all of its requests are slow. **So more than 1% of all fleet requests are around 8,000 ms, meaning the true fleet p99 is roughly 8,000 ms**, not 297 ms.

The averaged number understates it by a factor of 27, and it does so precisely in the situation you most need to detect: one bad server.

*It can err the other way too.* If every server has a p99 of 500 ms but those slow requests happen at *different times*, the fleet p99 can be lower than 500 ms, because the fleet distribution spreads them out.

**The real numbers, most likely.** Given a mean of 95 ms and users complaining, a plausible actual distribution is p50 around 40 ms, p95 around 200 ms, **p99 around 3–5 seconds**, and p99.9 at the timeout. That shape — a low median with a long tail — produces a mean near 95 ms and a genuinely slow site.

**How to get the number correctly.**

**Store histograms, not summaries.** Each server reports counts per latency bucket — how many requests fell into 0–10 ms, 10–25 ms, and so on. Bucket counts are **additive**, so you sum them across servers to get the fleet distribution and then read the percentile off it. This is the only correct method, and it is why the storage format matters.

The cost is bucket granularity: the percentile is only as precise as the boundaries. A histogram with buckets at 1 s and 5 s can only tell you the p99 is somewhere between them.

**And then, crucially, break it down.** A fleet p99 of 4 seconds tells you there is a problem. p99 **by server** immediately shows one server at 8 seconds and 39 at 100 ms — which is a completely different investigation from all 40 being at 4 seconds. The breakdown is where the diagnosis is, and it requires the dimension to be a bounded label on the metric.

**The general lesson.** The team asked "is latency acceptable" and answered it with two statistics that cannot answer it. **The mean is the wrong statistic and the averaged percentile is not a statistic at all.** Store histograms, read percentiles from summed buckets, always break down by a bounded dimension, and remember that a p99 is roughly a one-in-five page-load experience rather than a rare event.`,
    },
  body: `## The three signals and their cost models

| | Answers | Cost scales with | Sampling |
| --- | --- | --- | --- |
| **Metrics** | Is something wrong, since when, how much? | **Cardinality** (label combinations) | Never — aggregate everything |
| **Traces** | Where did the time go? What did this request do? | Requests × spans per request | **Always** — 0.1%–10% typical |
| **Logs** | Why did this specific thing happen? | Requests × verbosity × retention | By level, sometimes by request |

The cost-model column is the operationally important one, because it dictates what each signal can cover.

**Metrics are independent of traffic volume.** A counter incremented a billion times costs the same to store as one incremented ten times — you store the value, not the events. **So metrics can cover everything**, and their limit is dimensionality rather than volume.

**Traces scale with traffic**, so they must be sampled. Fortunately a small sample answers most questions: to find *where* time goes in a slow request, you need some slow requests, not all of them.

**Logs scale with traffic and verbosity**, which is why they are usually the largest observability bill. And the failure is asymmetric: you cannot retroactively raise the log level for an incident that already happened.

## Metrics: cardinality is the whole constraint

A metric is a name plus labels. **Every distinct combination of label values is a separate stored time series.**

\`\`\`
http_requests_total{method, status, endpoint}
  5 methods × 8 statuses × 40 endpoints = 1,600 series   ✓ fine
\`\`\`

Add one unbounded label:

\`\`\`
http_requests_total{method, status, endpoint, user_id}
  1,600 × 1,000,000 users = 1.6 BILLION series           ✗ outage
\`\`\`

**Nearly every metrics-system outage is a cardinality explosion**, and the offending label is almost always one of a short list:

- \`user_id\`, \`customer_id\`, \`session_id\`, \`request_id\`, \`trace_id\`
- A raw URL path containing ids: \`/orders/4471\` instead of \`/orders/{id}\`
- An error message as a label, since messages contain ids and values
- A timestamp, or anything derived from one
- An email address or any other user-supplied string

**The rule: labels must have bounded, low cardinality — tens or low hundreds of distinct values.** Anything per-user, per-request or per-entity belongs in a trace or a log, not in a metric label.

The consequence worth stating, because it is the source of most confusion: **metrics cannot answer per-user questions.** "Why is this customer seeing errors?" is not a metrics question, and trying to make it one is how metrics systems die. That question is answered by traces and logs, filtered by an id.

**Aggregate metric types**, and which to use:

**Counter** — monotonically increasing. Rate is derived from it. Use for requests, errors, bytes.
**Gauge** — a current value. Use for queue depth, connections in use, memory.
**Histogram** — bucketed counts. **Use for anything you will want a percentile of.**
**Summary** — pre-computed percentiles per instance. **Avoid**, because those percentiles cannot be aggregated across instances.

That last distinction is the one that matters. A summary gives you a per-instance p99 that is arithmetically useless at the fleet level. A histogram gives you additive bucket counts from which a correct fleet percentile can be computed.

## Percentiles: the arithmetic

**Averages hide the tail.** Covered above, and the multiplication is the part to remember: with N requests per page, the chance of hitting at least one p99 request is \`1 − 0.99ᴺ\`. At N = 20 that is 18%. **The p99 is a common page experience, not a rare event.**

**Percentiles cannot be averaged.** The mean of per-server p99s is not the fleet p99, and it can be wrong by an order of magnitude in either direction. Compute percentiles from summed histogram buckets.

**Which percentiles to watch:**

**p50** — the typical experience. Useful for capacity trends and useless for detecting problems.
**p95, p99** — where users notice. The primary latency signals.
**p99.9** — one in a thousand. Meaningful at high volume and noise at low volume: at 1,000 requests per minute, the p99.9 is one request, so it moves wildly.
**Maximum** — almost always noise, and occasionally the only way to notice a pathological case.

Two practical notes:

**Bucket boundaries determine precision.** A histogram with a bucket edge at 1 s and the next at 5 s cannot tell you whether the p99 is 1.1 s or 4.9 s. Choose boundaries around the values you care about — usually the SLO threshold and its neighbourhood.

**Always break down by a bounded dimension.** A fleet p99 says a problem exists; p99 by endpoint, by server, by region or by client version says where. **The breakdown is the diagnosis**, and the whole point of keeping label cardinality bounded is that breakdowns remain affordable.

## Traces: context propagation is the part you must design in

A **trace** is a tree of **spans**, each with a name, a start and end time, and attributes. A span represents one operation — an HTTP handler, a database query, a cache lookup.

**Context propagation** is the mechanism: a trace id and the current span id are passed with every outbound call, so the receiving service creates spans that attach to the same trace.

**This is the part that must be designed in.** Concretely, propagation must cross:

- **HTTP calls** — via a header. Straightforward.
- **Queue messages** — the context must be in the message, or the consumer's spans start a new disconnected trace. **This is the most commonly missed one**, and it is why traces so often stop at a queue boundary.
- **Background jobs and scheduled work** — a new trace, ideally linked to whatever caused it.
- **Thread and async boundaries within a process** — context must follow the logical operation, not the thread.

Adding this later means either retrofitting every function signature or accepting traces that break at each boundary. **A trace that stops at the first queue is not much of a trace**, since asynchronous hops are exactly where time gets lost.

**Sampling**, and the three strategies:

**Head-based:** decide at the start of the trace, propagate the decision. Simple, cheap, and it decides before knowing whether the request was interesting.

**Tail-based:** buffer all spans and decide after the trace completes, so you can keep every trace that was slow or errored. **Much more useful** — it captures the traces you actually want — and it requires buffering complete traces somewhere, which is real infrastructure.

**Head-based with a bias:** sample 100% of errors and slow requests plus 1% of the rest, decided as early as possible. A pragmatic middle.

**The rate matters less than people expect.** At 1% sampling and 10,000 requests per second, you capture 100 traces per second — thousands of examples of any recurring pattern. Sampling is a problem for *specific-request* investigations ("this customer's order at 14:32") and not for *pattern* investigations. If specific-request lookup matters, sample by request attribute rather than raising the global rate.

## Logs: structure them, correlate them, and control the cost

**Structured, not prose.** A log line should be a set of fields, not a sentence with values interpolated. Compare:

\`\`\`
Bad:   "Failed to charge order 4471 for user 8891: card declined"
Good:  {event: "charge_failed", order_id: "4471", user_id: "8891",
        reason: "card_declined", trace_id: "abc123"}
\`\`\`

The structured version is queryable — count declines by reason, find all events for one order — and the prose version requires a regular expression that breaks when the message is edited.

**Every log line needs a trace id.** Without it, a log line is an orphan: you cannot find the other events from the same request, and you cannot get from a slow trace to the logs explaining it. **This is the correlation that makes the three signals a system rather than three tools**, and it comes free from context propagation.

**Log levels, and the honest failure.** \`ERROR\` for things needing attention; \`WARN\` for things that might; \`INFO\` for significant business events; \`DEBUG\` for development. The problem is that **you cannot retroactively raise the level for an incident that already happened**, so the debug detail you need is exactly what you were not recording.

The mitigations:

**Log more on the error path than the success path.** An error log line can be verbose because errors are rare. A success line must be terse because it happens millions of times.
**Dynamic log levels** — raise the level for one service, or one customer, without redeploying.
**Sample high-volume INFO logs** and keep 100% of errors.

**Cost control.** Logs are usually the biggest observability bill, and the levers are retention (7 days hot, 90 days cold), sampling, and not logging things that are already metrics — a log line per request to count requests is a metric implemented expensively.

## What to measure: golden signals

For any service, four signals cover most of what you need:

**Latency** — as a distribution, and **separated by success and failure.** Failed requests are often fast (a fast rejection) or very slow (a timeout), and mixing them makes the successful-request latency meaningless.
**Traffic** — request rate, so you can tell a drop in errors from a drop in traffic.
**Errors** — rate and, broken down, kind. A 4xx rate and a 5xx rate are different signals.
**Saturation** — how full the constrained resource is. **The hard one**, because the constrained resource is rarely CPU: it is usually connection-pool utilisation, worker occupancy, or queue depth.

Saturation deserves emphasis because it is the leading indicator. Latency and errors tell you a problem has arrived; **saturation tells you it is coming.** And the backpressure lesson's conclusion applies directly: graph the bounded resource you actually have, not CPU.

Two additions specific to this material:

**Goodput** — successful responses delivered within their deadline. Under overload, throughput and goodput diverge completely, and only one of them reflects reality.
**Queue depth and age of oldest item**, for anything asynchronous. These are the only signals that surface a consumer falling behind.

## Alerting: on symptoms, not causes

**Alert on what users experience**, not on the mechanisms behind it. "The error rate for checkout exceeds 1%" is a symptom. "CPU above 80%" is a cause, and it may be entirely fine.

Why this matters: cause-based alerts fire when nothing is wrong (high CPU on a batch job) and stay silent when something is (a memory leak causing errors at 30% CPU). **Symptom-based alerts fire when and only when users are affected.**

The corollary: **every alert should be actionable.** An alert nobody acts on trains people to ignore alerts, which is worse than not having it. The test is whether there is a documented action; if the answer is "look at it and probably do nothing", it is a dashboard, not an alert.

**Burn-rate alerting** connects this to the previous lesson: alert when the error budget is being consumed faster than the window allows. A budget being spent at 10× the sustainable rate warrants waking someone; one being spent at 1.2× warrants a ticket. This distinguishes urgency from mere existence, which a static threshold cannot.

## Where observability goes wrong

**Three tools with no correlation.** Metrics in one system, traces in another, logs in a third, with no shared ids. Then every investigation is manual cross-referencing by timestamp, which is slow and error-prone. **The trace id in every log line and exemplars linking metrics to traces are what make it one system.**

**Cardinality treated as free.** It is the cost model, and ignoring it takes down the metrics system during the incident you need it for.

**Averages on dashboards.** They hide the failures that matter and they are the default in most tools.

**Alerting on causes.** Produces noise and misses real problems.

**Instrumenting after the incident.** The signal you needed is the one you were not collecting, and you cannot go back. **The cheap insurance is to instrument the bounded resources and the outcome counts up front** — pool acquisition time, queue depth, goodput — because those are the ones every debugging exercise in this phase needed and almost nobody had.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'signals',
      title: 'Three signals, three questions, three cost models',
      caption:
        'Read the cost column, because it dictates coverage. Metrics are independent of traffic so they can cover everything; traces and logs scale with it, so both must be sampled or budgeted.',
      code: `flowchart TB
    I["An incident begins"]

    I --> M["**Metrics**<br/>Is something wrong,<br/>since when, how much?"]
    M --> M1["Cost: cardinality —<br/>every label combination<br/>is a stored series"]
    M1 --> M2["Independent of traffic volume,<br/>so it can cover EVERYTHING.<br/>Never sampled"]
    M2 --> M3["✗ Cannot answer<br/>per-user questions —<br/>that is a cardinality<br/>explosion"]

    I --> T["**Traces**<br/>Where did the time go?<br/>What did this request do?"]
    T --> T1["Cost: requests × spans"]
    T1 --> T2["Always sampled.<br/>1% of 10k/s is still<br/>100 traces/s — plenty<br/>for pattern questions"]

    I --> L["**Logs**<br/>Why did this specific<br/>thing happen?"]
    L --> L1["Cost: requests ×<br/>verbosity × retention"]
    L1 --> L2["Usually the biggest bill.<br/>Cannot retroactively raise<br/>the level for an incident<br/>that already happened"]

    M2 --> C["**metrics detect →<br/>traces localise →<br/>logs explain**"]
    T2 --> C
    L2 --> C
    C --> C2["Held together by ONE thing:<br/>a trace id in every span<br/>and every log line"]

    style M3 fill:#2a1a1a,stroke:#a04848
    style L2 fill:#1c1814,stroke:#c99a4e
    style C2 fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'percentile-error',
      title: 'Why averaging per-server p99s hides a broken server',
      caption:
        'Step through it. The averaged figure understates the true fleet p99 by a factor of 27, and it does so exactly in the situation you most need to detect.',
      nodes: [
        { id: 'healthy', label: '39 servers, p99 = 100 ms', kind: 'service', x: 0, y: 100, detail: 'Each handles 1/40th of traffic and is entirely healthy. Their p99 values are all around 100 ms.' },
        { id: 'broken', label: '1 server, p99 = 8,000 ms', kind: 'service', x: 0, y: 260, detail: 'Handles 2.5% of traffic, and essentially all of its requests are slow. This is the failure the monitoring exists to catch.' },
        { id: 'avg', label: 'Average the p99s', kind: 'note', x: 220, y: 180, detail: '(39 × 100 + 8,000) / 40 = 297 ms. Looks acceptable, so nobody investigates. This number is not a statistic — no arithmetic recovers a fleet percentile from per-server ones.' },
        { id: 'truth', label: 'True fleet p99 ≈ 8,000 ms', kind: 'note', x: 220, y: 320, detail: 'The broken server is 2.5% of all requests and nearly all of them are slow, so more than 1% of fleet requests are ~8,000 ms. The 99th percentile of the fleet lands in that group.' },
        { id: 'hist', label: 'Histogram buckets', kind: 'store', x: 440, y: 180, detail: 'Each server reports counts per latency bucket. Bucket counts are ADDITIVE, so they sum across servers to give the true fleet distribution.' },
        { id: 'sum', label: 'Sum, then read p99', kind: 'service', x: 620, y: 180, detail: 'Compute the percentile from the summed distribution — the only correct method. Precision is limited by bucket boundaries, so place them around your SLO threshold.' },
        { id: 'break', label: 'Break down by server', kind: 'service', x: 620, y: 320, detail: 'p99 by server shows one at 8,000 ms and 39 at 100 ms — a completely different investigation from all 40 being at 4,000 ms. The breakdown IS the diagnosis.' },
      ],
      edges: [
        { id: 'p1', source: 'healthy', target: 'avg', kind: 'read' },
        { id: 'p2', source: 'broken', target: 'avg', kind: 'read' },
        { id: 'p3', source: 'broken', target: 'truth', kind: 'control' },
        { id: 'p4', source: 'healthy', target: 'hist', kind: 'write' },
        { id: 'p5', source: 'broken', target: 'hist', kind: 'write' },
        { id: 'p6', source: 'hist', target: 'sum', kind: 'sync' },
        { id: 'p7', source: 'sum', target: 'break', kind: 'control' },
      ],
      steps: [
        {
          id: 'pe1',
          title: 'One server is broken and 39 are fine',
          description:
            'The broken server handles 2.5% of traffic with essentially all requests slow. This is exactly the failure latency monitoring is supposed to surface.',
          nodes: ['healthy', 'broken'],
          edges: [],
        },
        {
          id: 'pe2',
          title: 'Averaging the per-server p99s gives 297 ms',
          description:
            'Which looks acceptable, so nobody investigates. Percentiles cannot be averaged — the result is not an approximation of the fleet p99, it is a number with no meaning.',
          nodes: ['avg'],
          edges: ['p1', 'p2'],
        },
        {
          id: 'pe3',
          title: 'The true fleet p99 is about 8,000 ms',
          description:
            'Because 2.5% of all fleet requests are slow, more than 1% sit around 8,000 ms — so the 99th percentile of the whole request population lands there. The averaged figure understates it 27-fold.',
          nodes: ['truth'],
          edges: ['p3'],
        },
        {
          id: 'pe4',
          title: 'Histograms are additive, so they compose',
          description:
            'Each server reports counts per latency bucket. Summing bucket counts across servers gives the real fleet distribution, and the percentile is read from it. This is the only correct method.',
          nodes: ['hist', 'sum'],
          edges: ['p4', 'p5', 'p6'],
        },
        {
          id: 'pe5',
          title: 'Then break it down, because that is the diagnosis',
          description:
            'A fleet p99 of 8 seconds says a problem exists. p99 by server says one machine is broken — which is why keeping label cardinality bounded matters: it is what makes the breakdown affordable.',
          nodes: ['break'],
          edges: ['p7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['google'],
    body: `Dapper is the design that made distributed tracing practical, and three of its decisions explain why tracing works at all.

**Aggressive sampling, defended on the grounds that it does not matter.** Dapper samples a small fraction of requests — well under 1% at high volume. The argument is that for the questions tracing answers, a sample is sufficient: to learn where time goes in a class of slow request you need *some* examples, not all of them. At high traffic even a low rate yields thousands of examples of any recurring pattern.

**The corollary is the limit.** Sampling means you often cannot find *one specific* request, so "show me this customer's order at 14:32" may have no trace. The remedy is not a higher global rate but **sampling by attribute** — always trace requests from a debugging customer, or requests that errored.

**Context propagation built into the RPC layer**, not into application code. Because every service used a common RPC library, propagation was implemented once and every service got tracing without changes. **This is the decision that made adoption possible**, and it is the argument for a shared client library or a service mesh: propagation implemented per service, in several languages, will be inconsistent and incomplete.

**Low overhead as a hard requirement.** Instrumentation always on, and cheap enough that nobody disables it in production. An observability system that is expensive gets turned off during the incident you needed it for.

**And the finding they report that surprises people: tracing was as useful for understanding *normal* behaviour as for debugging failures.** Which services call which, how often, and what the dependency graph actually is — as opposed to what the architecture diagram claims. In a large system nobody knows the real call graph, and traces are the only artefact that shows it.

**The transferable lessons.**

**Implement propagation in shared infrastructure**, whether that is a client library, a framework middleware, or a mesh. Per-service implementations diverge, and the divergence appears as traces that break at boundaries.

**Sample by outcome, not just by rate.** 100% of errors and slow requests plus 1% of the rest gives you the traces you want at a fraction of the cost of raising the global rate.

**Trace across asynchronous boundaries deliberately.** Context must travel in queue messages, or the trace ends at the producer — and asynchronous hops are exactly where unexplained latency lives.

**Where this needs adapting.** Dapper assumes a homogeneous RPC layer that a single team controls. In a heterogeneous system, the equivalent is adopting one propagation standard and enforcing it at every boundary — with the honest observation that **the first service that does not propagate breaks every trace passing through it**, so partial adoption yields much less than partial value.`,
  },

  tradeoffs: {
    intro:
      'Decisions across all three signals. Rows are the choices that actually change what you can find out during an incident.',
    rows: [
      {
        option: 'Averages on dashboards',
        whenItWins:
          'Capacity trends and cost attribution, where the bulk is what matters.',
        whenItLoses:
          'For detecting problems. A mean is blind to the tail, and the tail is what users experience — a p99 is roughly a one-in-five page-load event.',
        cost:
          'Every latency failure that matters is invisible.',
      },
      {
        option: 'Summaries (pre-computed per-instance percentiles)',
        whenItWins:
          'A single-instance service, where there is nothing to aggregate.',
        whenItLoses:
          'Any fleet. Per-instance percentiles cannot be averaged, and the error is largest exactly when one instance is broken.',
        cost:
          'A fleet percentile that cannot be computed at all, and a number that looks like one.',
      },
      {
        option: 'Histograms (bucketed counts)',
        whenItWins:
          'Always, for anything you will want a percentile of. Buckets are additive, so fleet percentiles are correct.',
        whenItLoses:
          'When bucket boundaries are badly chosen, limiting precision to the gap between them.',
        cost:
          'More series per metric (one per bucket), and boundaries chosen up front.',
      },
      {
        option: 'Rich metric labels including per-entity ids',
        whenItWins:
          'Never. It is the standard cause of metrics-system outages.',
        whenItLoses:
          'Immediately: a `user_id` label with a million users is a million series per metric.',
        cost:
          'A cardinality explosion that takes down monitoring during the incident you need it for.',
      },
      {
        option: 'Bounded metric labels, with per-entity questions in traces and logs',
        whenItWins:
          'Always. Tens to low hundreds of values per label keeps breakdowns affordable, which is where diagnosis happens.',
        whenItLoses:
          'When someone genuinely needs a per-customer time series — which is a different system, not a metric.',
        cost:
          'Accepting that metrics cannot answer per-user questions.',
      },
      {
        option: 'Head-based trace sampling',
        whenItWins:
          'Simplicity and low cost. The decision is made once and propagated.',
        whenItLoses:
          'It decides before knowing whether the request was interesting, so most captured traces are unremarkable.',
        cost:
          'Slow and errored requests are captured only by luck.',
      },
      {
        option: 'Tail-based trace sampling',
        whenItWins:
          'When you want the traces you actually need — keep every trace that was slow or errored, discard the rest.',
        whenItLoses:
          'When buffering complete traces is operationally out of reach.',
        cost:
          'Infrastructure to buffer all spans until a trace completes.',
      },
      {
        option: 'Structured logs with a trace id on every line',
        whenItWins:
          'Always. Queryable, correlatable, and it is what turns three tools into one system.',
        whenItLoses:
          'Nowhere, though it requires context propagation to be in place first.',
        cost:
          'Slightly more verbose lines, and propagation plumbing.',
      },
      {
        option: 'Alerting on symptoms (error rate, latency, budget burn)',
        whenItWins:
          'Always. Fires when and only when users are affected.',
        whenItLoses:
          'When the symptom is a lagging indicator and you wanted warning — which is what saturation metrics are for.',
        cost:
          'You learn about a cause only after it has produced a symptom.',
      },
      {
        option: 'Alerting on causes (CPU, memory, disk)',
        whenItWins:
          'For genuine capacity exhaustion where the resource is the constraint — disk filling, for instance.',
        whenItLoses:
          'Generally. Fires when nothing is wrong and stays silent when something is, training people to ignore alerts.',
        cost:
          'Alert fatigue, which is worse than having no alert.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Our average response time is 95 ms, so performance is good."',
      whyWeak:
        'A mean of 95 ms is equally consistent with every request taking 95 ms and with 99% taking 50 ms while 1% take 4.5 seconds. And a page making 20 requests has an 18% chance of containing a p99 request — so the tail is a common experience rather than an edge case.',
      strongAnswer:
        '"The mean is dominated by the bulk and blind to the tail. I would look at p50, p95 and p99 from a histogram, computed from summed buckets across the fleet. And I would remember the multiplication: with 20 requests per page, roughly one page load in five contains a p99 request, so a 4-second p99 means a fifth of page loads are slow."',
    },
    {
      weakAnswer: '"We average the p99 across our 40 servers to get the fleet p99."',
      whyWeak:
        'Percentiles cannot be averaged, and the error is largest exactly when it matters. With 39 servers at 100 ms and one at 8,000 ms, the average of the p99s is 297 ms while the true fleet p99 is around 8,000 ms — a 27-fold understatement of a broken server.',
      strongAnswer:
        '"That is not a valid operation — there is no arithmetic that recovers a fleet percentile from per-instance ones, and it understates by an order of magnitude when one server is broken. I would use histograms: each server reports counts per latency bucket, buckets are additive, so I sum across servers and read the percentile off the fleet distribution. Then break down by server, because that is where the diagnosis is."',
    },
    {
      weakAnswer: '"We added a `user_id` label to our request metrics so we can investigate individual customers."',
      whyWeak:
        'Every distinct label combination is a stored time series, so a million users multiplies every metric by a million. This is the standard cause of a metrics-system outage, and it happens during the incident you needed monitoring for.',
      strongAnswer:
        '"That is a cardinality explosion — metrics cost scales with label combinations, so a per-user label multiplies every series by the user count. Metric labels must be bounded: tens to low hundreds of values. Per-user questions belong in traces and logs, filtered by id — which is exactly what the trace id in every log line is for."',
    },
    {
      weakAnswer: '"We have metrics, traces and logs, so we have observability."',
      whyWeak:
        'Three tools with no shared identifiers is three tools, not a system. Without a trace id in log lines and links from metrics to example traces, every investigation is manual cross-referencing by timestamp — slow, error-prone, and impossible when timestamps are skewed.',
      strongAnswer:
        '"The correlation is what makes them a system. Every log line carries the trace id, so a slow trace leads straight to its logs. Metrics carry exemplars — links to sample traces in a bucket — so a p99 spike leads to a trace of a slow request. Without those, the three signals are three separate investigations joined by guesswork about timestamps."',
    },
    {
      weakAnswer: '"We alert when CPU exceeds 80%."',
      whyWeak:
        'It is a cause, not a symptom. It fires when nothing is wrong — a batch job legitimately using CPU — and stays silent when something is, such as a connection-pool exhaustion producing errors at 30% CPU. Both directions train people to ignore alerts.',
      strongAnswer:
        '"I would alert on symptoms: error rate, latency against the objective, and error-budget burn rate. Those fire when and only when users are affected. CPU is useful on a dashboard and as a saturation signal for capacity, and the saturation that actually matters is usually not CPU — it is pool utilisation, worker occupancy or queue depth. Every alert also needs a documented action, or it is a dashboard."',
    },
    {
      weakAnswer: '"When we need to debug we turn up the log level."',
      whyWeak:
        'You cannot retroactively raise the level for an incident that has already happened, so the detail you need is precisely what you were not recording. And turning it up under load can generate enough volume to become its own problem.',
      strongAnswer:
        '"The detail I need is what I was not recording, so I would log verbosely on the error path — errors are rare, so their lines can be rich — and terse on the success path. Dynamic log levels let me raise verbosity for one service or one customer without redeploying. And I would instrument the bounded resources and outcome counts up front: pool acquisition time, queue depth, goodput. Those are what every incident needs and almost nobody has."',
    },
  ],

  flashcards: [
    {
      id: 'fc-obs-1',
      front: 'What question does each of the three signals answer?',
      back: 'Metrics: is something wrong and since when. Traces: where did the time go. Logs: why did this specific thing happen. Metrics detect, traces localise, logs explain.',
      topic: 'observability',
    },
    {
      id: 'fc-obs-2',
      front: 'What does each signal\'s cost scale with?',
      back: 'Metrics: cardinality, independent of traffic. Traces: requests × spans, so always sampled. Logs: requests × verbosity × retention, usually the biggest bill.',
      topic: 'observability',
    },
    {
      id: 'fc-obs-3',
      front: 'Why is a mean latency useless for detecting problems?',
      back: 'It is dominated by the bulk and blind to the tail. A mean of 95 ms fits both "every request 95 ms" and "1% at 4.5 seconds".',
      topic: 'percentiles',
    },
    {
      id: 'fc-obs-4',
      front: 'What is the chance a 20-request page hits a p99 request?',
      back: '1 − 0.99²⁰ ≈ 18%. The p99 is roughly a one-in-five page-load experience, not a rare edge case.',
      topic: 'percentiles',
    },
    {
      id: 'fc-obs-5',
      front: 'Why can you not average percentiles?',
      back: 'There is no arithmetic that recovers a fleet percentile from per-instance ones. With 39 servers at 100 ms and one at 8,000 ms, the average p99 is 297 ms and the true fleet p99 is ~8,000 ms.',
      topic: 'percentiles',
    },
    {
      id: 'fc-obs-6',
      front: 'How do you compute a correct fleet percentile?',
      back: 'From histograms: each instance reports counts per bucket, bucket counts are additive, so sum across instances and read the percentile from the fleet distribution.',
      topic: 'metrics',
    },
    {
      id: 'fc-obs-7',
      front: 'Histogram or summary, and why?',
      back: 'Histogram. A summary pre-computes per-instance percentiles, which cannot be aggregated — so it gives a number that looks like a fleet percentile and is not one.',
      topic: 'metrics',
    },
    {
      id: 'fc-obs-8',
      front: 'What is cardinality and why does it govern metrics?',
      back: 'Every distinct label-value combination is a stored series. It is the cost model, and a cardinality explosion is the standard cause of a metrics-system outage.',
      topic: 'cardinality',
    },
    {
      id: 'fc-obs-9',
      front: 'Which labels must never go on a metric?',
      back: 'Anything unbounded: user id, session id, request id, trace id, a raw URL path with ids, an error message, a timestamp, an email address.',
      topic: 'cardinality',
    },
    {
      id: 'fc-obs-10',
      front: 'What is the one part of observability you cannot add later?',
      back: 'Context propagation. A trace id threaded through every hop, every queue message and every log line has to be designed in.',
      topic: 'tracing',
    },
    {
      id: 'fc-obs-11',
      front: 'Where does trace propagation most commonly break?',
      back: 'At queue boundaries. If the context is not in the message, the consumer starts a new disconnected trace — and asynchronous hops are where unexplained latency lives.',
      topic: 'tracing',
    },
    {
      id: 'fc-obs-12',
      front: 'Head-based versus tail-based sampling?',
      back: 'Head-based decides at the start and is cheap but blind to whether the request was interesting. Tail-based buffers spans and keeps traces that were slow or errored — much more useful, and it needs buffering infrastructure.',
      topic: 'tracing',
    },
    {
      id: 'fc-obs-13',
      front: 'Why alert on symptoms rather than causes?',
      back: 'Cause alerts fire when nothing is wrong and stay silent when something is. Symptom alerts — error rate, latency, budget burn — fire when and only when users are affected.',
      topic: 'observability',
    },
    {
      id: 'fc-obs-14',
      front: 'Which saturation signal matters, and which usually does not?',
      back: 'The bounded resource you actually have — pool utilisation, worker occupancy, queue depth. Rarely CPU, and saturation is the leading indicator where latency and errors are lagging ones.',
      topic: 'metrics',
    },
  ],

  quiz: [
    {
      id: 'q-obs-1',
      kind: 'scenario',
      prompt:
        '39 servers report a p99 of 100 ms and one reports 8,000 ms. A dashboard averages them to 297 ms. What is the true fleet p99, roughly, and why?',
      options: [
        { id: 'a', label: 'About 8,000 ms — the broken server is 2.5% of all requests and nearly all are slow, so more than 1% of fleet requests land around 8,000 ms' },
        { id: 'b', label: '297 ms, which is what averaging correctly gives' },
        { id: 'c', label: '100 ms, since 39 of 40 servers are healthy' },
        { id: 'd', label: 'Cannot be estimated without knowing each server\'s full distribution' },
      ],
      correct: ['a'],
      explanation:
        'The fleet p99 asks what value the 99th percentile of *all requests* takes. A server handling 2.5% of traffic with almost every request slow puts more than 1% of fleet requests in the slow group, so the 99th percentile lands there. Averaging per-instance percentiles is not a valid operation, and it understates by 27× here.',
      difficulty: 'advanced',
      topic: 'percentiles',
    },
    {
      id: 'q-obs-2',
      kind: 'scenario',
      prompt:
        'A team adds a `customer_id` label to `http_requests_total{method, status, endpoint}` — 1,600 existing series — with 50,000 customers. What happens?',
      options: [
        { id: 'a', label: 'Up to 80 million series, which will likely take down the metrics system — per-entity questions belong in traces and logs' },
        { id: 'b', label: 'Nothing; labels are stored as strings and are cheap' },
        { id: 'c', label: 'Query performance degrades but storage is unaffected' },
        { id: 'd', label: 'It works if the retention period is shortened' },
      ],
      correct: ['a'],
      explanation:
        'Cardinality is multiplicative: every distinct combination is a separate time series. 1,600 × 50,000 is 80 million, and this is the standard cause of a metrics-system outage — which arrives during the incident you needed monitoring for. Shorter retention reduces storage and not the series count.',
      difficulty: 'core',
      topic: 'cardinality',
    },
    {
      id: 'q-obs-3',
      kind: 'scenario',
      prompt:
        'Traces show a complete picture for synchronous calls, but the work done by a queue consumer never appears in the same trace. Why?',
      options: [
        { id: 'a', label: 'The trace context is not carried in the queue message, so the consumer starts a new disconnected trace' },
        { id: 'b', label: 'Traces cannot span asynchronous boundaries by design' },
        { id: 'c', label: 'The sampling decision is not propagated to consumers' },
        { id: 'd', label: 'Consumers run in a different process and cannot join a trace' },
      ],
      correct: ['a'],
      explanation:
        'Propagation across a queue requires the trace context to travel in the message payload or headers. This is the most commonly missed boundary, and it matters because asynchronous hops are exactly where unexplained latency accumulates. Traces can absolutely span asynchronous boundaries when the context is carried.',
      difficulty: 'core',
      topic: 'tracing',
    },
    {
      id: 'q-obs-4',
      kind: 'scenario',
      prompt:
        'A service alerts on CPU above 80%. During an incident, users see errors while CPU sits at 30%. What was wrong with the alert?',
      options: [
        { id: 'a', label: 'It alerts on a cause rather than a symptom — the real saturation was a bounded resource that is not CPU, such as a connection pool' },
        { id: 'b', label: 'The threshold should have been 20%' },
        { id: 'c', label: 'CPU should be measured per core rather than averaged' },
        { id: 'd', label: 'Nothing; the alert correctly did not fire because CPU was fine' },
      ],
      correct: ['a'],
      explanation:
        'Cause-based alerts fire when nothing is wrong and stay silent when something is. Errors at 30% CPU is the signature of waiting on a bounded resource that is not CPU — a pool, worker slots, a lock. The alert should be on the symptom (error rate, latency) with pool utilisation as the leading saturation signal.',
      difficulty: 'core',
      topic: 'observability',
    },
    {
      id: 'q-obs-5',
      kind: 'scenario',
      prompt:
        'An investigation requires finding the logs for one specific slow request identified in a trace. The logs have no trace id. What is the consequence?',
      options: [
        { id: 'a', label: 'The logs are orphans — correlation requires manual timestamp matching, which is slow, error-prone and unreliable under clock skew' },
        { id: 'b', label: 'Nothing; log timestamps are sufficient for correlation' },
        { id: 'c', label: 'The trace can be used to regenerate the logs' },
        { id: 'd', label: 'Only the entry-point service\'s logs can be found' },
      ],
      correct: ['a'],
      explanation:
        'Without a shared identifier, metrics, traces and logs are three separate tools joined by guesswork about timestamps — which fails when several requests overlap and when clocks are skewed across machines. The trace id in every log line comes free from context propagation and is what makes the signals one system.',
      difficulty: 'core',
      topic: 'observability',
    },
    {
      id: 'q-obs-6',
      kind: 'multi',
      prompt:
        'Which are true about trace sampling? Select all that apply.',
      options: [
        { id: 'a', label: '1% of 10,000 requests/second still yields 100 traces/second — plenty for pattern investigations' },
        { id: 'b', label: 'Sampling makes it hard to find one specific request, which is a different problem from finding a pattern' },
        { id: 'c', label: 'Tail-based sampling can keep every slow or errored trace, at the cost of buffering spans' },
        { id: 'd', label: 'Raising the global sampling rate is the right fix for specific-request lookup' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are why sampling works and where it does not. For specific-request lookup the right fix is sampling by attribute — always trace a debugging customer, always trace errors — rather than raising the global rate, which multiplies cost for a small increase in the chance of catching any given request.',
      difficulty: 'core',
      topic: 'tracing',
    },
  ],

  exercises: [
    {
      id: 'ex-obs-1',
      kind: 'design',
      title: 'Instrument it so the last four incidents would have been fast',
      estimatedMinutes: 30,
      prompt: `Design the observability for an order service: HTTP API → PostgreSQL, Redis, a payment provider, and a Kafka topic consumed by three downstream services.

Specify: the metrics with their labels, what is a histogram, the trace spans and propagation points, the log structure, and the alerts.

Then, for each of these four past incidents, say exactly which signal would have identified it and how long it would have taken:

1. One of 40 instances had an exhausted database connection pool; 2.5% of requests failed for six hours before anyone noticed.
2. A deploy raised p99 latency from 200 ms to 3 s. Mean latency moved from 90 ms to 110 ms and nobody noticed for three days.
3. A Kafka consumer silently skipped messages because it committed offsets in a \`finally\` block. Found by a customer complaint after two weeks.
4. Payment latency rose from 200 ms to 4 s for 20 minutes. The service recovered but nobody could explain what happened.

Finally: what would you add that you have not been asked for?`,
      rubric: [
        'Metrics with explicitly bounded labels, and a stated rule about cardinality.',
        'Latency as a histogram with justified bucket boundaries, separated by outcome.',
        'Saturation metrics on the actual bounded resources, not CPU.',
        'Trace spans named, with propagation into Kafka messages explicitly addressed.',
        'Sampling strategy that keeps errors and slow requests.',
        'Structured logs with trace id, and an error-path-verbose policy.',
        'Alerts on symptoms with burn rate, each with an action.',
        'All four incidents mapped to a specific signal with a realistic detection time.',
        'Incident 1 requires a per-instance breakdown; incident 3 requires an outcome/reconciliation metric.',
        'The unasked-for addition is justified by the incidents rather than generic.',
      ],
      modelAnswer: `**Metrics, with cardinality stated as a rule**

**The rule I would write down:** *a metric label must have fewer than 200 possible values, known in advance. Anything per-entity goes in traces and logs.*

\`\`\`
# Request-level — the golden signals
http_requests_total{method, route, status_class}
    method: 5   route: ~40 (templated: /orders/{id})   status_class: 5
    → ~1,000 series

http_request_duration_seconds{route, outcome}          [HISTOGRAM]
    outcome: success | client_error | server_error | timeout
    → 40 × 4 × ~14 buckets = ~2,240 series

# Dependency calls — one per dependency
dependency_duration_seconds{dependency, operation, outcome}  [HISTOGRAM]
    dependency: postgres | redis | payment | kafka
    → ~1,700 series

dependency_requests_total{dependency, operation, outcome}

# Saturation — the bounded resources that actually bind
pool_connections_in_use{pool}
pool_connections_max{pool}
pool_acquire_duration_seconds{pool}                    [HISTOGRAM]
worker_slots_in_use{}
worker_slots_max{}
request_queue_depth{}
request_queue_oldest_age_seconds{}

# Outcome — what actually happened, not what the pipeline thinks
orders_created_total{}
order_events_published_total{}
payment_attempts_total{outcome}
goodput_total{}          # completed within deadline
wasted_work_total{}      # completed after deadline expired

# Kafka consumer side (per consumer service)
consumer_lag_messages{topic, partition, group}
consumer_messages_processed_total{topic, group, outcome}
\`\`\`

**Total: roughly 6,000 series.** Small, affordable, and every dimension I will want to break down by is present.

*Why \`route\` is templated:* \`/orders/4471\` as a label value would be one series per order. \`/orders/{id}\` is one series. **This single normalisation is the difference between 40 route series and millions.**

*Why \`outcome\` rather than \`status\`:* it separates success latency from failure latency. Failed requests are either very fast (a rejection) or very slow (a timeout), and mixing them makes the successful-request latency meaningless. **This separation is not optional** — without it, an error-rate spike moves the latency histogram in a way that looks like a latency regression.

*Why \`pool_acquire_duration_seconds\` exists:* it is the metric that would have caught incident 1, and it is almost never instrumented. Time spent waiting for a connection is invisible in query latency and invisible in CPU.

**Histogram buckets**

\`\`\`
Request duration:    5ms 10 25 50 100 200 400 800 1.6s 3.2s 6.4s 12.8s +Inf
Payment duration:    50ms 100 200 400 800 1.6s 3.2s 6.4s 12.8s +Inf
Pool acquire:        0.1ms 1 5 10 50 100 500ms 1s +Inf
\`\`\`

*Why these boundaries:* roughly exponential, with extra resolution around the SLO threshold. If the objective is "99% of requests under 500 ms", I want boundaries at 400 and 800 so the p99 is pinned near the threshold rather than reported as "somewhere between 200 ms and 2 s".

*Why the pool-acquire buckets start at 0.1 ms:* healthy acquisition is microseconds. A bucket structure starting at 10 ms would report "all acquisitions under 10 ms" and tell me nothing about a pool going from 0.05 ms to 5 ms — which is a hundredfold degradation and the leading indicator of incident 1.

**Traces**

\`\`\`
Span tree for POST /orders:

order-service: POST /orders                          [root, ~250 ms]
├── postgres: BEGIN
├── postgres: INSERT orders
├── postgres: INSERT order_line_items
├── postgres: INSERT outbox
├── postgres: COMMIT
├── redis: GET session:{hash}
├── payment-provider: POST /charge                   [~200 ms, the bulk]
└── kafka: produce order.placed
        ↓ context carried IN THE MESSAGE HEADERS
        ├── email-service: consume order.placed      [linked span]
        ├── analytics-service: consume order.placed
        └── warehouse-service: consume order.placed
\`\`\`

**Propagation points, and the third is the one that gets missed:**

1. **Inbound HTTP** — extract context from the traceparent header, or start a new trace at the edge.
2. **Outbound HTTP** — inject into headers. Framework middleware handles this.
3. **Kafka produce and consume** — inject the context into **message headers**, extract on consume. **Without this the three downstream services appear in no trace at all**, and the entire asynchronous half of the system is invisible.
4. **Async boundaries in-process** — context follows the logical operation, not the thread.

*Span attributes:* \`order_id\`, \`customer_id\`, \`amount_cents\`, \`payment_provider_ref\`. **High-cardinality values belong here** — this is exactly what traces are for, and it is why they answer the per-user questions metrics cannot.

*Sampling:*

\`\`\`
100%  of traces containing an error
100%  of traces exceeding 1 s
100%  of traces for customers on a debug list
1%    of everything else
\`\`\`

Tail-based if the infrastructure supports buffering; otherwise head-based with an early bias, deciding as soon as an error or a slow dependency is observed. **The rate is far less important than the bias** — 1% of normal traffic gives me thousands of examples of any pattern, and the traces I actually open during an incident are the errors and the slow ones.

**Logs**

\`\`\`json
{
  "ts": "2026-09-08T14:22:10.412Z",
  "level": "error",
  "event": "payment_charge_failed",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "service": "order-service",
  "order_id": "4471",
  "customer_id": "8891",
  "payment_ref": "ch_abc123",
  "reason": "provider_timeout",
  "duration_ms": 4012,
  "attempt": 1
}
\`\`\`

**Policy:**

- **\`trace_id\` on every line, without exception.** It is what makes a slow trace lead to its logs.
- **Verbose on the error path, terse on the success path.** An error line can carry the full request context because errors are rare; a success line at millions per day cannot.
- **One \`INFO\` per request at most**, and I would question whether even that is needed given the metrics — a log line per request to count requests is a metric implemented expensively.
- **Dynamic levels**, settable per service and per customer without a redeploy.
- **7 days hot, 90 days cold.**

**Alerts — symptoms, with an action each**

\`\`\`
1. Fast burn:  error budget consumed at >14× sustainable rate over 1 h
               → PAGE. (Consumes 2% of a 30-day budget in an hour.)

2. Slow burn:  budget consumed at >3× over 6 h
               → TICKET.

3. Latency:    p99 of successful requests > 1 s for 10 min
               → PAGE.

4. Saturation: any pool_connections_in_use / max > 0.85 for 5 min
               → PAGE. Leading indicator.

5. Saturation: pool_acquire_duration p99 > 10 ms for 5 min
               → PAGE. Earlier still.

6. Consumer:   consumer_lag > 10,000 OR oldest_message_age > 300 s
               → PAGE, per consumer group.

7. Outcome:    orders_created_total − order_events_published_total
               diverges by > 0.1% over 1 h
               → PAGE. Reconciliation, not pipeline health.

8. Wasted:     wasted_work_total / goodput_total > 0.05 for 10 min
               → PAGE. Overload signature.
\`\`\`

**No CPU alert.** CPU goes on a dashboard. Every incident in this phase's debugging exercises had moderate CPU, and alerting on it produces noise while missing the real saturation.

**Each alert names a runbook action.** If I cannot write the action, it is a dashboard.

---

**The four incidents**

**1. One instance with an exhausted pool, 2.5% failures for six hours**

*Which signal:* **metrics — saturation, broken down by instance.**

Alert 4 (\`pool_connections_in_use / max > 0.85\`) fires within **5 minutes**, and alert 5 on acquisition latency fires even earlier. Both are per-instance, so the alert names the bad instance.

*Why it went undetected for six hours before:* 2.5% failures against whatever error-rate threshold existed did not trip it, and there was no per-instance saturation metric. **The aggregate hid it** — the same failure mode as averaging percentiles.

*The essential detail:* the metric must be **per instance**. An aggregate pool-utilisation figure across 40 instances would show 0.85/40 ≈ 2% higher than normal, which is invisible. **The \`instance\` label is what makes this detectable**, and it is bounded (40 values), so it is affordable.

*Detection time: under 5 minutes, with the instance identified.*

**2. A deploy raised p99 from 200 ms to 3 s; the mean barely moved**

*Which signal:* **metrics — the latency histogram, and specifically not the mean.**

Alert 3 (p99 of successful requests > 1 s for 10 minutes) fires **10 minutes after the deploy**. The p99 tripled and the mean moved 20 ms, which is exactly why the mean is the wrong statistic.

*Then localisation:* p99 broken down by \`route\` shows which endpoints regressed. And because 100% of traces over 1 s are sampled, there are thousands of traces of slow requests available immediately — showing which span grew.

*The other thing that would have caught it:* a **canary deploy gated on p99 regression**, which would have rolled back before the alert fired. That is the availability lesson's conclusion, and it makes this a 90-second event rather than a 10-minute one.

*Detection time: 10 minutes, or 90 seconds with a canary gate.*

**3. A consumer silently skipped messages by committing offsets in a \`finally\` block**

*Which signal:* **alert 7 — the outcome reconciliation.** And nothing else would have caught it, which is the point.

Consumer lag was **zero** — the messages were consumed, just not processed. Throughput was normal. Error rate was normal, because the exception was caught. Every pipeline-health metric was green for two weeks.

The reconciliation metric compares \`orders_created_total\` against a per-consumer \`consumer_messages_processed_total{outcome="success"}\`. A divergence beyond 0.1% over an hour fires.

*Why this is the important lesson of the four:* **transport metrics measure the mechanism; only an outcome metric measures the result.** Lag, throughput and error rate all reported health while a fraction of orders got no confirmation email. This is the same conclusion as the messaging lesson's debugging exercise, and it is why alert 7 exists.

*Detection time: 1 hour instead of 2 weeks.*

*I would add one more thing for this class:* a metric distinguishing \`outcome="skipped"\` explicitly, so a consumer that catches an exception and advances records it. **A silent skip should be a counter, not a log line** — a log line will not be read.

**4. Payment latency 200 ms → 4 s for 20 minutes, unexplained**

*Which signals:* **metrics to detect, traces to explain — and this is the one that needs all three.**

\`dependency_duration_seconds{dependency="payment"}\` p99 rising twentyfold fires a latency alert within minutes. But the question was *why*, and the incident closed unexplained.

**What answers it: the 100%-sampled slow traces.** Because every trace over 1 s is kept, there are thousands of traces from those 20 minutes showing the payment span at 4 s. Within a trace I can see:

- Whether the whole span was slow, or whether time went to connection establishment (a separate child span for the connect, which I would add).
- Whether it correlates with a particular payment method or region, from the span attributes.
- Whether our retries contributed — visible as multiple payment child spans in one trace.

**And the logs, found by trace id**, give the provider's response headers and any error codes.

*The detail worth adding:* a **separate span for connection establishment** versus request execution. A jump from 200 ms to 4 s could be the provider being slow or our connection pool exhausting and each request paying a new TLS handshake. **Those have completely different fixes**, and one span cannot distinguish them.

*Detection: minutes. Explanation: available afterwards, which it was not before — because the traces from the incident window now exist.*

---

**What I would add that was not asked for**

**1. A dashboard that puts throughput next to goodput and wasted work.** The backpressure lesson's conclusion: under overload, throughput looks healthy while goodput is zero. This is the single most misleading pattern in monitoring, and one panel makes it legible.

**2. Exemplars on the latency histogram.** Each bucket carries links to a few sample trace ids. Then clicking a p99 spike goes straight to a trace of a slow request, rather than requiring a separate search by timestamp. **This is what makes metrics and traces one system rather than two**, and it removes the slowest step of most investigations.

**3. A per-instance dashboard for every saturation metric.** Incident 1 was hidden by aggregation, and it will not be the last. Any resource that can be exhausted on one instance needs an \`instance\` breakdown, and a "worst instance" panel is more useful than a fleet average.

**4. Continuous exercise of the degraded paths, with a metric.** The timeouts and backpressure lessons both warned that fallback and degraded paths run only during incidents. I would route 0.5% of traffic through the payment-unavailable path and the search-degraded path continuously, with a metric confirming they still work. **A fallback with no metric is a fallback nobody knows is broken.**

**5. Deploy markers on every dashboard.** Incident 2 was a deploy regression that took three days to notice. Deploy annotations on latency and error graphs make "did this start with a deploy?" a glance rather than an investigation — and it is the first question in most incidents.

**6. A cardinality alert on the metrics system itself.** Series count per metric name, alerting on sudden growth. **The metrics-system outage arrives during the incident you needed it for**, and it is always someone adding a label with good intentions. This alert catches it in minutes rather than at the moment monitoring dies.

*The through-line:* five of these six come directly from failures in this phase's debugging exercises. **Instrumenting for the incidents you have already had is far more effective than instrumenting comprehensively**, because the incidents tell you which signals were missing.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-obs-1',
      level: 'basic',
      question: 'What are the three observability signals and what is each for?',
      guidance:
        'Metrics detect, traces localise, logs explain. A strong answer gives each one\'s cost model — cardinality, requests × spans, requests × verbosity — because that dictates what each can cover.',
    },
    {
      id: 'iq-obs-2',
      level: 'basic',
      question: 'Why look at percentiles rather than averages?',
      guidance:
        'The mean is blind to the tail. Look for the multiplication: with 20 requests per page, the chance of hitting a p99 request is 18%, so the tail is a common experience.',
    },
    {
      id: 'iq-obs-3',
      level: 'intermediate',
      question: 'How do you compute a fleet p99 across 40 servers?',
      guidance:
        'From summed histogram buckets, never by averaging per-server percentiles. A strong answer explains the error is largest exactly when one server is broken, and prefers histograms over summaries for that reason.',
    },
    {
      id: 'iq-obs-4',
      level: 'intermediate',
      question: 'What is cardinality and how does it constrain what you measure?',
      guidance:
        'Every label combination is a stored series, so labels must be bounded. Look for the conclusion that metrics cannot answer per-user questions, and that those belong in traces and logs.',
    },
    {
      id: 'iq-obs-5',
      level: 'advanced',
      question: 'What part of observability must be designed in rather than added later?',
      guidance:
        'Context propagation. Excellent answers name the boundaries — HTTP, queue messages, async hops — and note that a trace stopping at a queue misses where latency actually hides.',
    },
    {
      id: 'iq-obs-6',
      level: 'advanced',
      question: 'A consumer silently drops messages. Which signal catches it?',
      guidance:
        'Only an outcome reconciliation — entities created versus events processed. Lag, throughput and error rate are all green. Excellent answers state that transport metrics measure the mechanism and outcome metrics measure the result.',
    },
    {
      id: 'iq-obs-7',
      level: 'followup',
      question: 'You have metrics, traces and logs. Why might that still not be observability?',
      guidance:
        'Without shared identifiers they are three tools joined by timestamp guesswork. The trace id on every log line and exemplars linking metrics to traces are what make it one system.',
    },
    {
      id: 'iq-obs-8',
      level: 'followup',
      question: 'Why not alert on CPU?',
      guidance:
        'It is a cause: it fires when nothing is wrong and stays silent when something is, since the binding resource is usually a pool, worker slots or a queue. A strong answer alerts on symptoms and budget burn, with saturation on the actual bounded resource.',
    },
  ],

  activeLearning: [
    {
      id: 'al-obs-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed you can afford to instrument comprehensively. Now change one thing: your observability bill is larger than your compute bill, and you must cut it by 70%. What do you cut, and what must survive?',
      discussion: `This is a real and common situation, and the useful part is that the cuts are not evenly painful — the cost is concentrated in one signal and the value is concentrated in another.

**Where the money actually is.** Almost always logs, then metrics cardinality, then traces. Logs scale with traffic times verbosity times retention — three multiplicative factors, all of which drift upward as teams add lines. Traces are usually already sampled and therefore cheap.

**What I would cut, in order.**

**1. Log retention, from 90 days to 7 hot plus 30 cold.** Most log queries are within hours of an incident. Ninety days of hot retention serves compliance and rare forensics, and cold storage serves both at a fraction of the cost. **Usually the largest single saving and the least painful.**

**2. \`INFO\` logs on the success path.** A log line per successful request is a metric implemented expensively — the count is already in a counter and the latency is already in a histogram. Delete them, or sample at 1%. **Keep 100% of errors**, which are rare and where all the value is.

**3. Metric cardinality audit.** Find the metrics with the most series and check whether every label is earning its keep. In practice a handful of metrics account for most of the series, and usually one label — an unbounded route, a status message, a version string — is responsible. Removing one label can cut series counts by an order of magnitude.

**4. Metric resolution and retention.** 15-second scrapes retained for 15 months is often 60-second scrapes for 3 months plus downsampled longer-term. Detection at 60-second granularity is adequate for almost everything.

**5. Trace sampling rate on the *normal* path.** From 1% to 0.1%. At high volume that is still hundreds of traces per minute of ordinary requests, which is plenty for pattern work.

**What must survive, non-negotiably.**

**All error and slow-request traces.** These are the traces anyone actually opens. Cutting them saves little — they are a small fraction of traffic — and costs most of tracing's value.

**All error logs, with full context.** Same argument: rare, and where the answers are.

**Every saturation metric, per instance.** Pool utilisation, acquisition latency, queue depth, worker occupancy. These are the leading indicators and the ones every incident in this phase needed. They are also cheap — a handful of series each.

**Outcome and reconciliation metrics.** The counters that compare entities created against events processed. They caught a two-week silent failure and cost almost nothing.

**Latency histograms with a per-route and per-instance breakdown.** The breakdown is the diagnosis, and removing the breakdown to save series is removing the thing that makes the metric useful.

**Trace ids on every log line.** Free, and it is what makes the remaining signals a system.

**What this reveals, and it is the real point.** The 70% cut is almost entirely achievable by removing things that were **never used**: success-path logs nobody queries, long hot retention nobody reaches for, high-cardinality labels nobody breaks down by, and normal-path traces nobody opens. **The valuable observability is cheap; the expensive observability is largely waste.**

**And the diagnostic to run before cutting:** query usage. Most observability platforms can report which metrics are queried, which dashboards are viewed, and which log fields are searched. **A metric nobody has queried in six months is a candidate for deletion**, and this data usually shows that a large majority of series are never read.

**The transferable point.** "Instrument everything" is not the goal, and neither is minimalism. The goal is that **the signals needed by the incidents you actually have are present**, which is a much smaller and much cheaper set than comprehensive coverage. The way to find that set is to review past incidents and ask which signal would have identified each — as the exercise above did — because the incidents tell you what to keep and, by omission, what to cut.`,
    },
    {
      id: 'al-obs-2',
      kind: 'debug',
      prompt:
        'An incident is in progress: users report errors, and every dashboard is green. Error rate 0.2%, p99 latency 240 ms, CPU 45%, no dependency alerts, no recent deploys. Complaints are specific and credible. What do you do, and what does "green dashboards during an incident" tell you?',
      discussion: `Green dashboards with credible complaints means the monitoring is not measuring what users experience. That is itself the most important finding, and the investigation should proceed on the assumption that the signals are wrong rather than that the users are.

**Hypothesis 1 — the failures are before the request reaches the service.** DNS failures, TLS handshake failures, connections rejected at the load balancer, requests that timed out before arriving. **A server-side error rate cannot count a request that never arrived**, so it reports 0.2% while a meaningful fraction of attempts fail.

*Why it fits:* it explains green server metrics with real user failures perfectly, and it is the standard blind spot of server-side measurement.

*Check:* load-balancer or CDN request counts and error counts against application-level counts. **A gap between the two is the answer**, and it is a comparison almost nobody has on a dashboard.

**Hypothesis 2 — the failures are concentrated in one operation the aggregate averages away.** If checkout is 2% of traffic and failing 15%, the aggregate error rate moves 0.3% and stays green. But every affected user complains, and checkout is commercially the operation that matters.

*Why it fits:* it explains a high complaint volume with a tiny aggregate signal.

*Check:* error rate broken down by route. **This is why per-route labels exist**, and if the dashboard shows only an aggregate, this hypothesis cannot be excluded from it.

**Hypothesis 3 — one instance, one region or one client version is badly affected.** 2.5% of traffic failing entirely gives a 2.5% aggregate error rate — and if it is one small region or one mobile app version, the aggregate is smaller still while that population's experience is total failure.

*Check:* error rate and latency by instance, region and client version. **Aggregation is the mechanism that hides this**, exactly as with averaged percentiles.

**Hypothesis 4 — the p99 is computed wrongly and latency is actually terrible.** If per-instance percentiles are being averaged, one broken instance is understated by an order of magnitude. A displayed p99 of 240 ms is consistent with a true fleet p99 of several seconds.

*Check:* whether the latency panel uses a histogram summed across instances or a summary averaged across them. **If it is a summary, the number on the dashboard is not a fleet percentile at all.**

**Hypothesis 5 — the problem is correctness, not availability.** Every request returns 200 quickly with wrong or stale data: a lagging replica, a stale cache, a broken projection, a consumer silently skipping. **No availability metric detects this**, and the complaints would describe "wrong" rather than "slow" or "broken".

*Check:* read the complaints carefully. This should be step one.

**Hypothesis 6 — latency is measured server-side and excludes what users wait for.** Server-side duration starts when the handler begins and ends when the response is written. It excludes queueing before the handler, TLS negotiation, and the response transfer to a slow client. Client-observed latency can be many times the server-side figure.

*Check:* client-side or synthetic-probe latency against server-side. A large gap localises it to queueing or the network.

**What I would do, in order.**

**1. Read ten complaints and categorise them.** Slow? Errors? Wrong data? Which page? Which region? Which client? **This is the fastest possible discriminator** and it costs five minutes. Choosing an investigation without it is guessing.

**2. Compare edge counts against application counts.** One query, and it definitively includes or excludes hypothesis 1 — which is the leading candidate for green-server-metrics-with-real-failures.

**3. Break down error rate and latency by route, instance, region and client version.** If any of these breakdowns is unavailable, that is a finding to record for after the incident.

**4. Check whether the latency panel is a histogram or a summary.** Thirty seconds, and it determines whether the number I have been reading means anything.

**5. Find a failing user and trace their request by id.** If traces are sampled by attribute, or a debug list exists, this is available immediately. If not, that is another finding.

**What "green dashboards during an incident" tells you, and it is the durable lesson.**

**The monitoring is measuring the mechanism rather than the outcome.** Every green signal here — server-side error rate, aggregate p99, CPU — measures something about the system's internals. None measures whether a user successfully did the thing they came to do.

The standard defects, all present in this scenario's dashboard:

- **Measured server-side**, so pre-arrival failures are invisible.
- **Aggregated across operations** of unequal importance, so a broken checkout hides in working browsing.
- **Aggregated across instances, regions and clients**, so a badly-affected subset disappears.
- **Percentiles possibly computed by averaging**, so the number is not what it claims.
- **No correctness signal at all**, so wrong-but-fast is indistinguishable from right.

**The fix after the incident is a measurement fix, not a system fix.** Client-side or synthetic SLIs, per-operation objectives, per-instance and per-region breakdowns, histograms rather than summaries, and at least one end-to-end outcome metric — orders placed versus orders confirmed.

**And the process fix:** when complaints rise while dashboards are green, **the dashboards are the bug.** Treating the complaints as noise because the metrics disagree is how a measurement defect survives for months — and the complaints are the ground truth against which the metrics are validated, not the other way round.`,
    },
  ],

  revision: {
    bullets: [
      'Metrics detect, traces localise, logs explain. Missing one means substituting a worse tool.',
      'Metrics cost scales with cardinality and is independent of traffic, so they can cover everything.',
      'Traces scale with requests × spans, so they are always sampled. Logs scale with traffic × verbosity × retention.',
      'A mean is dominated by the bulk and blind to the tail; the tail is what users experience.',
      'With 20 requests per page, the chance of hitting a p99 request is 18% — not an edge case.',
      'Percentiles cannot be averaged; averaging per-instance p99s understates a broken instance by an order of magnitude.',
      'Compute fleet percentiles from summed histogram buckets — bucket counts are additive.',
      'Use histograms, not summaries. A summary\'s per-instance percentiles cannot be aggregated.',
      'Bucket boundaries determine precision, so place them around the SLO threshold.',
      'Every distinct label combination is a stored series; labels must have bounded, low cardinality.',
      'Never label a metric with a user id, session id, raw path, error message or timestamp.',
      'Metrics cannot answer per-user questions — those belong in traces and logs.',
      'Always break down by a bounded dimension; the breakdown is the diagnosis.',
      'Context propagation is the one thing you cannot add later, and queue boundaries are where it breaks.',
      'Sample by outcome — 100% of errors and slow requests plus 1% of the rest — not by raising the global rate.',
      'Every log line needs a trace id, or it is an orphan and the signals are three separate tools.',
      'Log verbosely on the error path and tersely on the success path; you cannot raise the level retroactively.',
      'Alert on symptoms and budget burn, not on CPU — and instrument the bounded resource that actually binds.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Three signals with distinct questions and cost models — metrics as cheap aggregates, traces as sampled per-request causal trees, logs as detailed events — tied together by a propagated trace id.',
    whyItExists:
      'Because a distributed system\'s behaviour cannot be inferred from any single machine, and because each question you will ask during an incident is answerable by only one of the three signals.',
    whenToUse: [
      'Metrics for detection, always on, with bounded labels and histograms for anything latency-related.',
      'Traces for localising where time went, sampled by outcome.',
      'Logs for explaining a specific event, structured and correlated by trace id.',
      'Outcome and reconciliation metrics for anything asynchronous.',
    ],
    whenNotToUse: [
      'Metrics for per-entity questions — that is a cardinality explosion.',
      'Averages for detecting latency problems.',
      'Summaries when you need a fleet percentile.',
      'Cause-based alerts such as CPU thresholds.',
      'A log line per request to count requests, which is a metric implemented expensively.',
    ],
    alternatives: [
      'Exemplars, linking a histogram bucket to sample traces so metrics lead directly to traces.',
      'Synthetic probes, which keep measuring during a total outage when real users have stopped.',
      'Client-side monitoring, which catches DNS, TLS and pre-arrival failures a server cannot see.',
      'Continuous profiling, for the questions about where CPU or memory goes that traces cannot answer.',
    ],
    tradeoffs: [
      'Histograms buy correct fleet percentiles and cost one series per bucket.',
      'Bounded labels buy affordable breakdowns and cost the ability to ask per-user questions of metrics.',
      'Tail-based sampling buys the traces you actually want and costs buffering infrastructure.',
      'Verbose error logging buys explanatory power and costs little, because errors are rare.',
      'Long hot log retention buys forensic reach and is usually the largest observability bill.',
      'Symptom alerting buys precision and costs advance warning, which saturation metrics provide instead.',
    ],
    failureModes: [
      'A mean latency hiding a catastrophic tail.',
      'Averaged per-instance percentiles understating a broken instance by an order of magnitude.',
      'A cardinality explosion taking down monitoring during the incident that needed it.',
      'Traces that stop at a queue boundary because context was not carried in the message.',
      'Log lines with no trace id, forcing timestamp-based correlation.',
      'A needed log level that was not enabled when the incident happened.',
      'Cause-based alerts firing on healthy load and staying silent on real failures.',
      'A server-side SLI missing DNS, TLS and pre-arrival failures.',
      'An aggregate error rate hiding a broken low-volume, high-value operation.',
      'Consumer lag reporting zero while messages are silently skipped.',
      'Throughput looking healthy while goodput is zero.',
      'A degraded or fallback path with no metric confirming it still works.',
    ],
    followUpQuestions: [
      'Is your latency a histogram or a summary, and how is the fleet percentile computed?',
      'What is the highest-cardinality label in your metrics, and how many series does it create?',
      'Can you break down p99 by instance, route, region and client version?',
      'Does trace context travel in your queue messages?',
      'Does every log line carry a trace id?',
      'What fraction of error traces do you keep?',
      'Which bounded resource do you graph as saturation, and is it CPU?',
      'Do you have an outcome metric, or only transport metrics?',
      'Is your SLI measured where the user is, with a latency threshold?',
      'For each of your last four incidents, which signal identified it?',
      'What would you have needed and not had?',
    ],
  },
});
