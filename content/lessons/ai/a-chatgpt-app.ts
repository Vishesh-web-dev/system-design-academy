import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-chatgpt-app',
  title: 'Design a ChatGPT-style application',
  summary:
    'The model call is a solved API; the system around it is the design. What makes it hard is that inference is slow, streamed, and runs on scarce GPUs you must queue for — so this is a capacity-and-streaming problem wearing a chatbot costume, with conversation storage and multi-tenant abuse control on top.',
  phase: 'ai',
  module: 'ai-designs',
  position: 88,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 95,
  tags: ['streaming', 'gpu-capacity', 'conversation-storage', 'queueing', 'multi-tenant'],
  prerequisites: ['a-model-selection'],
  resources: [
    {
      key: 'prometheus-histograms',
      tier: 'must',
      note: 'Read it for measuring latency distributions. Inference latency has two very different numbers — time to first token and total time — and a system that reports only an average of the wrong one is blind to what users feel.',
    },
    {
      key: 'kafka-design',
      tier: 'must',
      note: 'Read it for the queue as a buffer between bursty demand and finite capacity. GPU inference is the classic case of expensive, finite workers that must be fed from a queue rather than hit directly.',
    },
    {
      key: 'google-sre-slo',
      tier: 'must',
      note: 'Read it for expressing "how good must the service be" as an explicit objective. Streaming latency and availability under capacity pressure are exactly what an SLO is for, and the design decisions follow from the target.',
    },
    {
      key: 'nginx-reverse-proxy',
      tier: 'good',
      note: 'Read it for connection handling at the edge. Streaming responses hold a connection open for the whole generation, which changes the load-balancing and timeout picture from an ordinary request.',
    },
    {
      key: 'postgres-partitioning',
      tier: 'good',
      note: 'Read it for storing conversations that grow without bound. Conversation history is append-heavy and per-user, which is a partitioning problem with a clean key.',
    },
    {
      key: 'aws-workload-isolation-shuffle',
      tier: 'advanced',
      note: 'Read it for keeping one tenant\'s load from starving another. Multi-tenant GPU capacity is a shared scarce resource, and isolation is what stops a heavy user degrading everyone.',
    },
  ],

  intuition: {
    body: `**The model call is a solved API. Everything hard is the system that surrounds it** — and three properties of inference make that system unusual.

\`\`\`
1. IT IS SLOW    seconds, not milliseconds — a
                 generation is 100s of tokens each
                 taking real time
2. IT IS STREAMED  tokens arrive one at a time, so
                 the response is a stream, not a
                 payload — held open for seconds
3. IT RUNS ON SCARCE GPUs  which are expensive,
                 finite, and cannot be spun up
                 instantly — so you QUEUE for them
\`\`\`

**Together these make it a capacity-and-streaming problem, not a request/response one.** **A candidate who designs it like a normal web app — synchronous request, JSON reply, autoscale on CPU — has missed what makes it hard.**

**The metric that reframes everything: latency is two numbers, not one.**

\`\`\`
TIME TO FIRST TOKEN (TTFT)   how long until the
                             stream STARTS
                             → what the user feels
                               as responsiveness
TOTAL GENERATION TIME        how long until it
                             finishes
                             → dominated by output
                               length
→ reporting one average of "latency" hides both
\`\`\`

**Streaming exists precisely to decouple these** — the user sees words appear immediately (low TTFT) even though the full answer takes ten seconds. **So the design optimises TTFT hard, and total time follows the output.**

**The capacity reality that bounds the design:**

\`\`\`
GPUs are finite and demand is bursty.
→ you CANNOT serve every request instantly
→ so there is a QUEUE, and the question is how
  to schedule scarce capacity fairly across
  tenants without letting one user starve the rest
\`\`\`

**And conversation storage is the quiet third pillar** — **history grows without bound, must be reloaded to continue a chat, and every turn resends it** — so storage, retrieval and the token cost of long histories are a real subsystem, not a detail.`,
    analogyLimit:
      '"A web app that calls a model" hides the three things that make it hard: inference is slow, so responses stream token by token rather than returning a payload; it runs on scarce GPUs you must queue for, so capacity scheduling and fairness are central; and latency is two numbers — time to first token versus total generation — that a single average conflates. It also hides that history grows without bound and is resent every turn, and that one tenant can starve shared GPU capacity.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds a ChatGPT-style app as a standard web service: a synchronous POST that calls the model and returns the full response as JSON, behind an autoscaling group that scales on CPU, storing each message as a row. Name four things that break at scale.',
      answer: `**Break 1 — a synchronous full-response call means a 10-second request, and the user stares at a spinner.**

**Inference takes seconds, and returning the whole response as JSON means the user waits for all of it before seeing anything.** **The perceived latency is the total generation time**, which is terrible — **when it could be the time-to-first-token, near-instant, if streamed.**

*The fix:* **stream tokens as they are generated** (server-sent events or a websocket), so the user sees the answer appear immediately. **Optimise TTFT; let total time follow the output length.**

**Break 2 — autoscaling on CPU is scaling on the wrong signal, and GPUs cannot scale that way anyway.**

**The bottleneck is GPU capacity, not CPU**, so CPU-based autoscaling adds web servers while the GPUs are saturated. **And GPUs are scarce and slow to provision** — you cannot spin up a fleet in seconds to meet a burst.

*The fix:* **a queue in front of finite GPU workers.** Requests enqueue; workers pull when free; **the queue absorbs bursts, and capacity scaling is a slow, deliberate, GPU-provisioning decision — not reactive autoscale.**

**Break 3 — one heavy user starves everyone, because GPU capacity is shared and finite.**

**With no fairness, a single tenant hammering the API or requesting enormous generations consumes the shared GPUs**, and every other user\'s TTFT collapses. **In a naive queue, one abuser is a denial of service for all.**

*The fix:* **per-tenant fairness and quotas** — rate limits, fair scheduling across tenants, and caps on generation length — so one user\'s load cannot monopolise the shared resource.

**Break 4 — a row per message ignores that history is resent every turn and grows unbounded.**

**To continue a conversation, the whole history is reloaded and resent to the model** — so a long conversation is expensive on every turn, and storing messages as loose rows without a partitioning and truncation strategy makes both storage and retrieval scale badly.

*The fix:* **conversation history partitioned per user, loaded efficiently, and truncated or summarised past a length** — because the model has a context limit and the cost is per-token-resent.

**What the corrected design looks like.**

\`\`\`
· streaming responses, TTFT-optimised
· a queue in front of finite GPU workers;
  capacity provisioned deliberately, not
  autoscaled on CPU
· per-tenant rate limits, fair scheduling, and
  generation-length caps
· conversation history partitioned per user, with
  a truncation/summarisation strategy
\`\`\`

**The transferable point: the naive design treats inference like a fast, stateless, infinitely-scalable web call, and it is none of those.** **It is slow, streamed, capacity-bound and stateful — and the design is about managing exactly those four facts.**`,
    },
  body: `## Framing and requirements

\`\`\`
· Scale: how many concurrent conversations?
  → sizes the GPU fleet and the queue
· Latency target: TTFT and total, as an SLO
  → drives streaming and scheduling
· Multi-tenant? → fairness and abuse control
· Conversation length and retention?
  → storage and truncation strategy
· Self-hosted models or a provider API?
  → whether GPU capacity is YOUR problem
\`\`\`

**The last question splits the design.** **On a provider API, capacity and queueing are partly the provider\'s problem (you still handle rate limits and streaming); self-hosted, GPU capacity is the centre of the design.** **State the assumption; the interesting version is self-hosted, so assume that unless told otherwise.** **The dominant non-functional requirement is responsiveness under bursty load against finite capacity** — not throughput alone.

## Streaming — the response is a stream

\`\`\`
client ──open connection──▶ gateway ──▶ GPU worker
  ◀──── token ── token ── token ── token ────────
\`\`\`

**The response holds a connection open for the whole generation** — seconds — **which changes the infrastructure.**

**Server-sent events (SSE) or websockets, not a JSON reply.** SSE is usually enough — one-directional, simple, resumable — and the token stream flows over it. **The gateway proxies the stream from the worker to the client without buffering the whole thing.**

**Long-lived connections change load balancing.** **A streamed request occupies a connection for its whole duration, so connection count, not request rate, is the load signal**, and timeouts must allow for multi-second generations. **This is why an ordinary web-app load balancer configuration fails here.**

*And streaming needs cancellation.* **A user who closes the tab or stops the generation must free the GPU immediately** — an uncancelled generation wastes the scarcest resource, so cancellation propagates from the client through the gateway to the worker.

## GPU capacity and the queue

**The heart of the design, and the part that is genuinely different from an ordinary service.**

\`\`\`
requests ──▶ [ QUEUE ] ──▶ finite GPU workers
                             (each serving a batch)
\`\`\`

**GPUs are scarce, expensive, and slow to provision** — you plan capacity, you do not autoscale it in seconds. **So a queue sits in front of the workers**, absorbing bursts, and the workers pull when they have room.

**Two capacity levers specific to inference.**

**Batching.** **A GPU serves multiple requests at once far more efficiently than one at a time** — so the scheduler batches concurrent generations. **Continuous batching** (adding new requests to a running batch as others finish) keeps utilisation high, which is the difference between an affordable system and an unaffordable one.

**Queue discipline under saturation.** **When demand exceeds capacity, the queue grows, and TTFT is dominated by queue wait, not inference.** **So the design must decide what happens when saturated: shed load (reject with a clear signal), degrade (a smaller/faster model), or make users wait — and prioritise fairly across tenants.**

*Capacity planning is a real subsystem:* **provision for the peak you commit to serving, measure utilisation, and treat GPU addition as a lead-time decision.** **The SLO — what TTFT you promise at what load — is what sizes the fleet.**

## Multi-tenant fairness and abuse

**Shared scarce capacity means one tenant can starve the rest**, so fairness is a first-class control.

\`\`\`
· RATE LIMITS per tenant (requests, and tokens
  per period — tokens matter more than requests,
  since one request can be enormous)
· FAIR SCHEDULING — the queue serves tenants
  fairly, so a heavy user waits behind their own
  backlog, not ahead of everyone
· GENERATION CAPS — a maximum output length, so
  no single request monopolises a worker
· ABUSE CONTROLS — detect and throttle automated
  hammering, and content abuse
\`\`\`

**Token-based limits, not request-based, are the key insight.** **A request is not a unit of load — a 4,000-token generation costs vastly more than a 20-token one** — so quotas and fairness are measured in tokens (or GPU-time), which is the real resource. **A request-count limit lets a tenant consume everything with a few enormous requests.**

## Conversation storage

\`\`\`
· PARTITION by user/conversation — history is
  per-user and append-heavy, a clean shard key
· LOAD efficiently to continue a chat — the
  recent turns, fast
· TRUNCATE or SUMMARISE past the context limit —
  the model cannot take unbounded history, and
  every turn RESENDS what is included
\`\`\`

**The cost insight: every turn resends the included history**, so a long conversation is quadratically expensive in tokens as it grows (the agent-memory lesson\'s curve). **So the design truncates to a window, or summarises older turns** — both to fit the context limit and to bound cost. **Storage is cheap; resending is not.**

*And conversations are the product\'s memory*, so retention, export, and deletion (a user deleting a conversation, or a data-deletion request) are real requirements — the history is personal data.

## Cost and observability

\`\`\`
COST is dominated by GPU-time (self-hosted) or
tokens (provider):
  · batching utilisation is the biggest lever
  · generation caps and history truncation bound
    per-conversation cost
  · a cheaper/smaller model for simple turns
    (model selection, lesson 71)

OBSERVE the two latencies separately:
  · TTFT distribution (p50/p95/p99) — the
    responsiveness SLO
  · total generation time — follows output length
  · queue depth and GPU utilisation — the capacity
    signals
  · per-tenant token consumption — the fairness
    signal
\`\`\`

**Watching queue depth and GPU utilisation together is the operational core** — **rising queue depth at high utilisation means you are capacity-bound and TTFT is about to degrade**, which is the signal to shed load or add capacity, decided against the SLO.

## What to say in a design discussion

**That the model call is a solved API and the system around it — streaming, capacity, storage — is the design.**

**That responses stream token by token over SSE/websockets, holding a connection open, so TTFT is optimised and total time follows output length.**

**That finite GPUs sit behind a queue with batching, capacity is provisioned deliberately, and saturation is handled by fair shedding or degradation.**

**That fairness and quotas are measured in tokens, not requests, because a request is not a unit of load.**

**That conversation history is partitioned per user and truncated or summarised, because every turn resends what is included.**

**And that the two latencies, queue depth, and GPU utilisation are the metrics that run the system, against an explicit SLO.**`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'chatgpt-arch',
      title: 'The request path: stream in front, queue and GPUs behind, history alongside',
      caption:
        'Step through it. The ordinary web-app instinct fails at three points — streaming, the queue, and token-based fairness.',
      nodes: [
        { id: 'client', label: 'Client — holds a streamed connection', kind: 'client', x: 0, y: 170, detail: 'The connection stays open for the whole generation, seconds long. Closing the tab must cancel the generation and free the GPU — an uncancelled stream wastes the scarcest resource.' },
        { id: 'gateway', label: 'Gateway: SSE/websocket, rate limit, fairness', kind: 'service', x: 270, y: 170, detail: 'Proxies the token stream without buffering the whole response. Enforces per-tenant token limits and fair scheduling here — a request is not a unit of load, so quotas are in tokens, not request counts.' },
        { id: 'queue', label: 'Queue — absorbs bursts', kind: 'queue', x: 540, y: 170, detail: 'GPUs are finite and slow to provision, so you queue for them rather than autoscaling reactively. Under saturation, TTFT is dominated by queue wait, and the design decides whether to shed, degrade, or make users wait — fairly across tenants.' },
        { id: 'workers', label: 'GPU workers — continuous batching', kind: 'service', x: 810, y: 170, detail: 'A GPU serves many generations at once far more efficiently than one; continuous batching adds new requests to a running batch as others finish, keeping utilisation high. This is the difference between an affordable and an unaffordable system.' },
        { id: 'ttft', label: 'TTFT vs total time', kind: 'note', x: 810, y: 30, detail: 'Two different numbers. Time to first token is what the user feels as responsiveness and is what streaming and the queue optimise; total generation time follows the output length. Reporting one average of "latency" is blind to both.' },
        { id: 'store', label: 'Conversation store — partitioned per user', kind: 'store', x: 270, y: 320, detail: 'Append-heavy, per-user, a clean shard key. Loaded to continue a chat, and truncated or summarised past the context limit — because every turn resends the included history, making a long conversation quadratically expensive in tokens.' },
        { id: 'capacity', label: 'Capacity planning against an SLO', kind: 'note', x: 540, y: 30, detail: 'The TTFT you promise at a given load sizes the GPU fleet. Provisioning is a lead-time decision, not a reactive autoscale, so the SLO plus the demand forecast is the capacity plan.' },
      ],
      edges: [
        { id: 'c1', source: 'client', target: 'gateway', kind: 'sync' },
        { id: 'c2', source: 'gateway', target: 'queue', kind: 'async' },
        { id: 'c3', source: 'queue', target: 'workers', kind: 'sync' },
        { id: 'c4', source: 'workers', target: 'ttft', kind: 'control' },
        { id: 'c5', source: 'gateway', target: 'store', kind: 'read' },
        { id: 'c6', source: 'capacity', target: 'queue', kind: 'control' },
        { id: 'c7', source: 'workers', target: 'client', kind: 'async' },
      ],
      steps: [
        {
          id: 'ca1',
          title: 'The response is a stream, not a payload',
          description:
            'A connection held open for the whole generation, over SSE or a websocket, with cancellation on disconnect. TTFT is what the user feels.',
          nodes: ['client', 'gateway'],
          edges: ['c1'],
        },
        {
          id: 'ca2',
          title: 'Fairness lives at the gateway, in tokens',
          description:
            'Per-tenant limits and fair scheduling measured in tokens, not requests — because one request can be enormous, and a request-count limit lets a tenant consume everything.',
          nodes: ['store'],
          edges: ['c5'],
        },
        {
          id: 'ca3',
          title: 'A queue feeds finite GPUs',
          description:
            'Bursts hit the queue, not the workers directly. Capacity is provisioned against the SLO, and saturation is handled by shedding or degrading, fairly across tenants.',
          nodes: ['queue', 'capacity'],
          edges: ['c2', 'c6'],
        },
        {
          id: 'ca4',
          title: 'Batching is the affordability lever',
          description:
            'Continuous batching keeps GPU utilisation high by adding requests to a running batch. It is the single biggest cost lever in a self-hosted design.',
          nodes: ['workers'],
          edges: ['c3'],
        },
        {
          id: 'ca5',
          title: 'And the two latencies run the system',
          description:
            'TTFT optimised and measured separately from total time; queue depth and GPU utilisation together signal when to shed or add capacity, against the SLO.',
          nodes: ['ttft'],
          edges: ['c4', 'c7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'load-unit',
      title: 'Why fairness is measured in tokens, not requests',
      caption:
        'Read the two tenants as identical request counts and wildly different load. A request-count limit treats them the same, which is the bug.',
      code: `flowchart TB
    Q["**Two tenants, 100 requests<br/>each. Same load?**"]

    Q --> A["**Tenant A**<br/>100 requests ×<br/>~30 output tokens each<br/>= 3,000 tokens"]
    Q --> B["**Tenant B**<br/>100 requests ×<br/>~4,000 output tokens each<br/>= 400,000 tokens"]

    A --> C["**Same request count,<br/>~130× the GPU load**"]
    B --> C

    C --> D["**So a request-count rate limit<br/>lets tenant B consume the fleet<br/>while looking identical to A.**<br/><br/>Fairness and quotas are measured<br/>in **tokens** (or GPU-time) —<br/>the real unit of load — plus a<br/>**generation-length cap** so no<br/>single request monopolises a<br/>worker.<br/><br/>*A request is not a unit of load.*"]

    style B fill:#2a1a1a,stroke:#8c4a4a
    style D fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The queue-as-buffer pattern from Kafka\'s design is the most useful reference here, because GPU inference is the textbook case of the problem it solves: bursty demand meeting expensive, finite workers.

**The pattern.** Producers (user requests) and consumers (GPU workers) run at different, uncorrelated rates. **A queue decouples them** — producers enqueue at whatever rate demand dictates, consumers pull at whatever rate their capacity allows — **so a demand burst becomes a longer queue rather than a dropped request or a crashed worker.**

**Why it fits inference precisely.** **GPUs cannot be added in seconds to meet a spike**, so the reactive-autoscale answer that works for CPU web servers is unavailable. **The queue is what stands between an unservable burst and finite capacity**, and the queue\'s depth becomes the primary signal of whether you are keeping up.

**Three lessons for the design.**

**The queue makes bursts survivable and latency honest.** Under a burst, TTFT rises because of queue wait — **which is visible and manageable, unlike a fleet that simply falls over.** **The queue converts an availability problem into a latency problem**, which is the better failure mode.

**Consumer capacity is the throughput ceiling.** **Adding producers (users) does not add capacity; only more GPU workers do** — so the design must be explicit that scaling is a deliberate, lead-time capacity decision, and the queue is how you survive until it lands.

**And queue depth is the operational signal.** **A growing queue at full utilisation means you are capacity-bound**, and the response — shed, degrade, or add capacity — is a decision made against the SLO, exactly as a saturation policy should be.

**Where the analogy stops.** **A message queue delivers discrete messages; an inference request produces a stream held open for seconds** — so the worker is occupied for the whole generation, not just to hand off a message. **That is why batching matters here and does not in an ordinary queue**: the way to serve more with the same workers is to run many generations at once, which is an inference-specific capacity lever the queue pattern alone does not provide.`,
  },

  tradeoffs: {
    intro:
      'The decisions a ChatGPT-style app forces, most of which trade responsiveness or cost against complexity.',
    rows: [
      {
        option: 'Synchronous full-response API',
        whenItWins:
          'A prototype, or very short responses.',
        whenItLoses:
          'Any real chat — the user waits the whole generation before seeing anything.',
        cost:
          'Perceived latency equal to total generation time.',
      },
      {
        option: 'Streaming responses (SSE/websocket)',
        whenItWins:
          'Always for chat — the user sees tokens immediately.',
        whenItLoses:
          'Adds long-lived connections and cancellation handling.',
        cost:
          'Connection-oriented infrastructure instead of request/response.',
      },
      {
        option: 'CPU-based autoscaling',
        whenItWins:
          'Nowhere for GPU-bound inference.',
        whenItLoses:
          'Scales the wrong resource while GPUs saturate.',
        cost:
          'Web servers added while the bottleneck is untouched.',
      },
      {
        option: 'A queue in front of finite GPUs',
        whenItWins:
          'Any self-hosted inference under bursty load.',
        whenItLoses:
          'Adds queue-wait latency under saturation.',
        cost:
          'A queue to operate, converting bursts into latency.',
      },
      {
        option: 'One request per GPU',
        whenItWins:
          'Nowhere at scale — it wastes the GPU.',
        whenItLoses:
          'Utilisation and throughput collapse; cost per request soars.',
        cost:
          'An unaffordable system.',
      },
      {
        option: 'Continuous batching',
        whenItWins:
          'Always self-hosted — the biggest utilisation and cost lever.',
        whenItLoses:
          'Adds scheduler complexity, and batching interacts with latency.',
        cost:
          'A more complex serving layer, for affordability.',
      },
      {
        option: 'Request-count rate limits',
        whenItWins:
          'Rarely — only when generations are uniformly small.',
        whenItLoses:
          'A tenant consumes the fleet with a few enormous requests.',
        cost:
          'Fairness that does not track the real load.',
      },
      {
        option: 'Token-based limits and fair scheduling',
        whenItWins:
          'Any multi-tenant system — tokens are the real unit of load.',
        whenItLoses:
          'More to measure and enforce.',
        cost:
          'Token accounting, for fairness that holds.',
      },
      {
        option: 'Unbounded generation length',
        whenItWins:
          'Nowhere at scale.',
        whenItLoses:
          'One request monopolises a worker and blows the cost.',
        cost:
          'A single request degrading everyone.',
      },
      {
        option: 'Full conversation history every turn',
        whenItWins:
          'Short conversations.',
        whenItLoses:
          'Long ones — quadratic token cost, and the context limit is hit.',
        cost:
          'Cost that grows with conversation length, then failure.',
      },
      {
        option: 'Truncated or summarised history',
        whenItWins:
          'Any long-running conversation.',
        whenItLoses:
          'Loses detail from older turns.',
        cost:
          'A truncation or summarisation strategy to design.',
      },
      {
        option: 'Shed load under saturation',
        whenItWins:
          'When holding the SLO matters more than serving every request.',
        whenItLoses:
          'Rejected users, though with a clear signal.',
        cost:
          'Refused requests, in exchange for a protected latency target.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"It\'s a web service that calls the model and returns the answer as JSON."',
      whyWeak:
        'Inference takes seconds, so a synchronous full-response call makes the user wait the entire generation before seeing anything — perceived latency equal to total time. And it ignores that the response is naturally a stream.',
      strongAnswer:
        '"The response streams token by token over server-sent events or a websocket, so the user sees the answer appear immediately — I optimise time-to-first-token hard and let total time follow the output length. That changes the infrastructure: the connection is held open for the whole generation, so connection count rather than request rate is the load signal, timeouts must allow multi-second generations, and closing the tab has to cancel the generation to free the GPU. Streaming exists precisely to decouple TTFT from total time, which is the whole latency story."',
    },
    {
      weakAnswer: '"We autoscale the fleet on CPU utilisation to handle load."',
      whyWeak:
        'The bottleneck is GPU capacity, not CPU, so CPU autoscaling adds web servers while the GPUs saturate. And GPUs cannot be provisioned in seconds anyway, so reactive autoscaling is the wrong model entirely.',
      strongAnswer:
        '"GPUs are scarce, expensive and slow to provision, so I put a queue in front of a finite worker fleet rather than autoscaling reactively. The queue absorbs bursts — a demand spike becomes a longer queue, not a dropped request — and capacity is a deliberate, lead-time planning decision sized against the SLO and a demand forecast. Within the workers, continuous batching keeps utilisation high, which is the biggest cost lever. Under saturation I shed load or degrade to a faster model, fairly across tenants, because I cannot conjure GPUs to meet the peak."',
    },
    {
      weakAnswer: '"We rate-limit each tenant to N requests per minute for fairness."',
      whyWeak:
        'A request is not a unit of load — a 4,000-token generation costs vastly more than a 20-token one — so a request-count limit lets a tenant consume the whole fleet with a few enormous requests while looking identical to a light user.',
      strongAnswer:
        '"Fairness and quotas are measured in tokens, or GPU-time, because that is the real unit of load. I also cap generation length so no single request monopolises a worker, and I use fair scheduling in the queue so a heavy tenant waits behind their own backlog rather than ahead of everyone else. Token-based accounting is the key insight — a request-count limit is fairness that does not track the resource, and it fails exactly when one tenant sends a few huge generations."',
    },
    {
      weakAnswer: '"Each message is a row; we load them all to continue the conversation."',
      whyWeak:
        'Every turn resends the included history to the model, so a long conversation is quadratically expensive in tokens as it grows, and eventually exceeds the model\'s context limit and simply fails. Loose rows with no partitioning or truncation scale badly on both storage and cost.',
      strongAnswer:
        '"Conversation history is partitioned per user — it\'s append-heavy with a clean shard key — and loaded efficiently to continue a chat. Crucially, I truncate to a window or summarise older turns, both to fit the context limit and to bound cost, because every turn resends what\'s included and storage is cheap while resending is not. That\'s the agent-memory curve: the working context has to be managed, not just accumulated. And since conversations are personal data, retention, export and deletion are real requirements."',
    },
    {
      weakAnswer: '"We report average latency to track performance."',
      whyWeak:
        'Latency is two different numbers — time to first token and total generation time — and total time is dominated by output length, so an average of "latency" conflates responsiveness with response size and is blind to what the user actually feels.',
      strongAnswer:
        '"I measure TTFT and total generation time separately, as distributions not averages — TTFT p50/p95/p99 is the responsiveness SLO, and total time follows output length. Alongside them, queue depth and GPU utilisation are the capacity signals: a growing queue at high utilisation means I\'m capacity-bound and TTFT is about to degrade, which is the trigger to shed load or add capacity, decided against the SLO. And per-tenant token consumption is the fairness signal. Those four numbers run the system."',
    },
    {
      weakAnswer: '"Cost is just the model API price; we don\'t optimise it much."',
      whyWeak:
        'For a self-hosted design cost is dominated by GPU-time, where batching utilisation swings it enormously, and for any design the resent conversation history and unbounded generations drive per-conversation cost. Ignoring these makes the system expensive in ways the model price does not show.',
      strongAnswer:
        '"Cost is dominated by GPU-time self-hosted, or tokens on a provider, and the levers are concrete: continuous batching utilisation is the biggest one, generation caps and history truncation bound per-conversation cost, and a cheaper, smaller model for simple turns — the model-selection cascade — cuts the common case. I\'d instrument cost per conversation and watch utilisation, because an underutilised GPU fleet or unbounded histories can make the system cost several times what it should while every individual request looks fine."',
    },
  ],

  flashcards: [
    {
      id: 'fc-cgpt-1',
      front: 'What three properties of inference make this a hard system?',
      back: 'It is slow (seconds), streamed (token by token), and runs on scarce GPUs you must queue for — a capacity-and-streaming problem, not request/response.',
      topic: 'gpu-capacity',
    },
    {
      id: 'fc-cgpt-2',
      front: 'What are the two latency numbers, and which does the user feel?',
      back: 'Time to first token (responsiveness — what the user feels) and total generation time (follows output length). An average conflates them.',
      topic: 'streaming',
    },
    {
      id: 'fc-cgpt-3',
      front: 'Why does the response stream?',
      back: 'To decouple TTFT from total time — the user sees words immediately even though the full answer takes seconds.',
      topic: 'streaming',
    },
    {
      id: 'fc-cgpt-4',
      front: 'How does streaming change the infrastructure?',
      back: 'A connection is held open for the whole generation, so connection count is the load signal, timeouts must allow seconds, and disconnect must cancel.',
      topic: 'streaming',
    },
    {
      id: 'fc-cgpt-5',
      front: 'Why a queue in front of GPUs instead of autoscaling?',
      back: 'GPUs are scarce and slow to provision, so you cannot scale reactively — the queue absorbs bursts and capacity is planned deliberately.',
      topic: 'gpu-capacity',
    },
    {
      id: 'fc-cgpt-6',
      front: 'What is continuous batching, and why does it matter?',
      back: 'Adding new requests to a running GPU batch as others finish — it keeps utilisation high and is the biggest cost lever self-hosted.',
      topic: 'gpu-capacity',
    },
    {
      id: 'fc-cgpt-7',
      front: 'What happens to TTFT under saturation?',
      back: 'It is dominated by queue wait, not inference — so the design must shed, degrade, or make users wait, fairly across tenants.',
      topic: 'queueing',
    },
    {
      id: 'fc-cgpt-8',
      front: 'Why are quotas measured in tokens, not requests?',
      back: 'A request is not a unit of load — one big generation costs 100× a small one — so a request-count limit lets a tenant consume the fleet.',
      topic: 'multi-tenant',
    },
    {
      id: 'fc-cgpt-9',
      front: 'What stops one request monopolising a worker?',
      back: 'A generation-length cap — a maximum output length — so no single request occupies a GPU indefinitely.',
      topic: 'multi-tenant',
    },
    {
      id: 'fc-cgpt-10',
      front: 'How is conversation history stored?',
      back: 'Partitioned per user (append-heavy, clean shard key), loaded to continue, and truncated or summarised past the context limit.',
      topic: 'conversation-storage',
    },
    {
      id: 'fc-cgpt-11',
      front: 'Why does long conversation history cost so much?',
      back: 'Every turn resends the included history, so cost grows quadratically as the conversation lengthens — storage is cheap, resending is not.',
      topic: 'conversation-storage',
    },
    {
      id: 'fc-cgpt-12',
      front: 'What are the capacity signals to watch?',
      back: 'Queue depth and GPU utilisation together — a growing queue at high utilisation means you are capacity-bound and TTFT is about to degrade.',
      topic: 'queueing',
    },
    {
      id: 'fc-cgpt-13',
      front: 'What splits the design in two?',
      back: 'Self-hosted versus a provider API — self-hosted makes GPU capacity the centre of the design; a provider handles some of it.',
      topic: 'gpu-capacity',
    },
    {
      id: 'fc-cgpt-14',
      front: 'What are the main cost levers?',
      back: 'Batching utilisation, generation caps, history truncation, and a cheaper model for simple turns.',
      topic: 'gpu-capacity',
    },
  ],

  quiz: [
    {
      id: 'q-cgpt-1',
      kind: 'scenario',
      prompt:
        'A team returns the full model response as JSON from a synchronous endpoint. Users complain it feels slow even for good answers. Why?',
      options: [
        { id: 'a', label: 'Perceived latency equals total generation time — nothing appears until the whole answer is ready; streaming would show tokens immediately' },
        { id: 'b', label: 'The JSON is too large to parse' },
        { id: 'c', label: 'The model is too big' },
        { id: 'd', label: 'The database is slow' },
      ],
      correct: ['a'],
      explanation:
        'Inference takes seconds, and a full-response reply makes the user wait for all of it. Streaming decouples time-to-first-token from total time, so the answer appears immediately even though it finishes later.',
      difficulty: 'core',
      topic: 'streaming',
    },
    {
      id: 'q-cgpt-2',
      kind: 'scenario',
      prompt:
        'Under a traffic spike, the GPU fleet is saturated. What is the right architecture, and what happens to latency?',
      options: [
        { id: 'a', label: 'A queue absorbs the burst; TTFT rises with queue wait, and the design sheds or degrades fairly rather than crashing' },
        { id: 'b', label: 'Autoscale the GPU fleet in seconds to meet the spike' },
        { id: 'c', label: 'Return errors to all users until the spike passes' },
        { id: 'd', label: 'Buffer the requests in memory on the web servers' },
      ],
      correct: ['a'],
      explanation:
        'GPUs cannot be added in seconds, so a queue converts an availability problem into a latency one. Rising TTFT from queue wait is the visible, manageable signal, and the saturation policy — shed or degrade — is decided against the SLO.',
      difficulty: 'core',
      topic: 'queueing',
    },
    {
      id: 'q-cgpt-3',
      kind: 'scenario',
      prompt:
        'Two tenants each send 100 requests. Tenant B\'s generations are 100× longer. A request-count rate limit treats them equally. What breaks?',
      options: [
        { id: 'a', label: 'Tenant B consumes far more GPU load while looking identical — fairness must be measured in tokens, the real unit of load' },
        { id: 'b', label: 'Nothing — 100 requests is 100 requests' },
        { id: 'c', label: 'Tenant B hits the request limit first' },
        { id: 'd', label: 'The queue reorders them automatically' },
      ],
      correct: ['a'],
      explanation:
        'A request is not a unit of load, so a request-count limit lets a tenant with huge generations monopolise the fleet. Token-based (or GPU-time) quotas and a generation-length cap track the real resource.',
      difficulty: 'core',
      topic: 'multi-tenant',
    },
    {
      id: 'q-cgpt-4',
      kind: 'scenario',
      prompt:
        'A conversation has 200 turns and each new turn is slower and more expensive than the last. Why, and what fixes it?',
      options: [
        { id: 'a', label: 'Every turn resends the growing history, so cost and latency grow with length — truncate to a window or summarise older turns' },
        { id: 'b', label: 'The database index is fragmented' },
        { id: 'c', label: 'The GPU is overheating' },
        { id: 'd', label: 'The model degrades with age' },
      ],
      correct: ['a'],
      explanation:
        'The included history is resent on every turn, which is the agent-memory quadratic curve, and it eventually hits the context limit. Truncating to a window or summarising older turns bounds both cost and context.',
      difficulty: 'core',
      topic: 'conversation-storage',
    },
    {
      id: 'q-cgpt-5',
      kind: 'scenario',
      prompt:
        'The team reports "average latency is 4 seconds." Why is this insufficient for a streaming chat app?',
      options: [
        { id: 'a', label: 'It conflates time-to-first-token with total generation time — the user feels TTFT, which streaming makes near-instant regardless of total time' },
        { id: 'b', label: 'Four seconds is acceptable, so there is no issue' },
        { id: 'c', label: 'Averages are always wrong' },
        { id: 'd', label: 'It should be measured in requests per second' },
      ],
      correct: ['a'],
      explanation:
        'The two latencies mean different things — responsiveness versus response size — and total time follows output length. TTFT distribution is the responsiveness SLO, and a single average hides it.',
      difficulty: 'advanced',
      topic: 'streaming',
    },
    {
      id: 'q-cgpt-6',
      kind: 'multi',
      prompt:
        'Which of these are inference-specific concerns that an ordinary web app does not have? Select all that apply.',
      options: [
        { id: 'a', label: 'Continuous batching of concurrent generations on a GPU' },
        { id: 'b', label: 'Cancelling a generation when the client disconnects to free the GPU' },
        { id: 'c', label: 'Measuring load in tokens rather than requests' },
        { id: 'd', label: 'Storing user data in a database' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Batching, cancellation-frees-the-scarce-resource, and token-based load are all specific to slow, streamed, GPU-bound inference. Storing user data in a database is ordinary and not inference-specific.',
      difficulty: 'advanced',
      topic: 'gpu-capacity',
    },
  ],

  exercises: [
    {
      id: 'ex-cgpt-1',
      kind: 'design',
      title: 'Design the serving stack for a multi-tenant AI chat product',
      estimatedMinutes: 45,
      prompt: `Design the serving infrastructure for a chat product with a free tier and a paid tier, self-hosting open models on a fixed GPU fleet. Free users are many and bursty; paid users expect reliable low latency. Conversations can run long. There is a hard monthly GPU budget.

**Part 1.** Frame the requirements and name the dominant constraint.

**Part 2.** Design the request path — streaming, queue, workers.

**Part 3.** Design multi-tenant fairness between free and paid, given a fixed fleet.

**Part 4.** Design conversation storage and history management under the budget.

**Part 5.** Design what happens under saturation.

Then answer:

- What two metrics would you put on the main dashboard?
- What would you deliberately not build?`,
      rubric: [
        'Fixed GPU capacity under bursty demand is named as dominant.',
        'Streaming with cancellation, a queue, and batched workers.',
        'Fairness distinguishes free and paid, measured in tokens, on a fixed fleet.',
        'History is truncated/summarised, partitioned per user, cost-bounded.',
        'Saturation policy protects the paid SLO — shed or degrade free first.',
        'Dashboard metrics are TTFT and queue-depth/utilisation, not averages.',
        'Defers something (e.g. per-request autoscaling, a bespoke serving engine).',
      ],
      modelAnswer: `**Part 1 — requirements, and the dominant constraint**

\`\`\`
FUNCTIONAL
  streamed chat for free and paid tiers over
  self-hosted open models

NON-FUNCTIONAL, in priority order
  1. FIXED GPU CAPACITY under bursty, uneven
     demand — the fleet cannot grow to meet a
     spike, and the budget caps its size
  2. PAID-TIER LATENCY SLO — reliable low TTFT
     for paying users, protected from free-tier
     bursts
  3. COST within the monthly GPU budget
  4. FREE-TIER availability — best-effort

The dominant constraint is FIXED CAPACITY meeting
BURSTY DEMAND with a TIERED SLO.
\`\`\`

**Everything follows from "the fleet is fixed and the demand is not."** **I cannot autoscale my way out of a spike, so the design is about scheduling scarce, fixed capacity to protect the paid SLO while serving free users with what remains** — a queueing and fairness problem, with cost as the budget that sizes the fleet. **A candidate who proposes "just add GPUs when busy" has missed that the fleet is fixed by budget.**

---

**Part 2 — the request path**

\`\`\`
client ──SSE──▶ gateway ──▶ tiered queue ──▶ GPU
  ◀──── tokens ─────────────────────────── workers
                                   (continuous
                                    batching)

STREAMING
  · SSE (one-directional, simple, resumable) —
    enough for chat
  · gateway proxies tokens without buffering
  · disconnect → CANCEL the generation → free
    the GPU immediately (a wasted generation is
    wasted scarce capacity)

QUEUE
  · requests enqueue; workers pull when they have
    batch room
  · TWO logical queues (Part 3): paid and free

WORKERS
  · continuous batching — new generations join a
    running batch as others finish → high
    utilisation, the main cost lever
  · a generation-length cap so no request occupies
    a worker indefinitely
\`\`\`

**Cancellation on disconnect is worth calling out as load-bearing on a fixed fleet.** **Every generation a user abandons but that keeps running is scarce capacity spent on nothing** — so propagating cancellation from the closed connection through the gateway to the worker directly protects the SLO for everyone else. **On an infinite fleet it is a nicety; on a fixed one it is a real capacity recovery.**

---

**Part 3 — fairness between free and paid on a fixed fleet**

**This is the heart of the design, and the answer is reserved capacity plus token-based fairness within each tier.**

\`\`\`
CAPACITY RESERVATION
  · reserve a floor of GPU capacity for PAID that
    free traffic can never consume
    → paid TTFT is protected from any free-tier
      burst, because free physically cannot touch
      the reserved slice
  · free uses the rest, PLUS any idle paid
    capacity (paid floor is a guarantee, not a
    cap when idle)

WITHIN EACH TIER
  · fair scheduling across tenants, measured in
    TOKENS not requests
  · per-user token quotas (tighter for free)
  · generation-length caps (shorter for free)

FREE-TIER SHAPING
  · lower priority: free requests wait behind paid
  · a smaller/faster model for free (model
    selection) → cheaper per token, and frees the
    big model for paid
\`\`\`

**The reservation is what makes the tiered SLO real.** **If free and paid shared one undifferentiated queue, a free-tier spike would raise paid TTFT — which is exactly what paying users are paying to avoid** — so a reserved paid floor, that free traffic cannot cross, is the structural guarantee. **Fair scheduling within a tier then stops one tenant starving others in that tier.**

*And letting free use idle paid capacity is the efficiency that keeps the budget honest:* **reserved-but-idle GPU is wasted money**, so the reservation is a priority guarantee — paid preempts — rather than a hard partition that sits idle. **This is the shuffle-sharding/isolation idea: isolate the guarantee, share the slack.**

---

**Part 4 — conversation storage under the budget**

\`\`\`
STORAGE
  · partition by user/conversation — append-heavy,
    clean shard key
  · load recent turns fast to continue a chat
  · retention + deletion (personal data)

HISTORY MANAGEMENT — the cost control
  · truncate to a context WINDOW (recent turns)
  · SUMMARISE older turns into a running summary
    → keeps continuity without resending
      everything
  · the window size is a COST KNOB: every turn
    resends the window, so a smaller window is
    cheaper per turn
  · FREE tier: smaller window (cheaper); PAID:
    larger window (better continuity)
\`\`\`

**History management is a cost lever, not just a context-limit workaround.** **Because every turn resends the included history, the window size directly sets the per-turn token cost** — so on a fixed budget, the window is something I tune per tier: free users get a smaller window (cheaper, slightly less continuity), paid users a larger one. **This ties conversation design directly to the GPU budget**, which is the connection the naive "just store the messages" design misses.

*Summarisation earns its place for long conversations specifically:* **a running summary of older turns preserves continuity at a fraction of the tokens of resending them** — the agent-memory compaction move, here justified by cost as much as by context limits.

---

**Part 5 — saturation policy**

\`\`\`
When demand exceeds the fixed fleet:

1. PAID is protected by the reserved floor — it
   does not saturate first by design
2. FREE degrades, in order:
   a. route free to the smaller/faster model
   b. increase free queue wait (they wait longer)
   c. SHED: reject new free requests with a clear
      "busy, try again shortly" — never a silent
      hang
3. If PAID itself saturates (demand beyond the
   committed SLO):
   a. degrade paid to a faster model before
      shedding
   b. shed with a clear signal, and this is a
      CAPACITY-PLANNING signal — the fleet is
      undersized for the paid commitment
\`\`\`

**The policy protects the paid SLO by degrading and shedding free first**, which is the whole point of the tiers — **free is best-effort and absorbs the volatility so paid stays reliable.** **And shedding is explicit, never a silent hang**, because a clear "try again" is a far better experience than a connection that never produces a token.

*Paid saturation is a distinct, louder signal:* **if the reserved paid capacity is itself insufficient, that is not a runtime decision to make gracefully — it is a sign the fleet is undersized for what was sold**, and it feeds capacity planning (buy more GPUs, or sell fewer paid seats), a lead-time decision made against the SLO.

---

**The two dashboard metrics**

**TTFT p95 for the paid tier, and queue-depth-versus-GPU-utilisation.**

\`\`\`
1. PAID TTFT p95 — the SLO, directly. It is what
   was sold, and it is the number that must hold.
   (Not an average — the tail is what users
   notice, and not total time, which follows
   output length.)

2. QUEUE DEPTH vs GPU UTILISATION — the capacity
   signal. A growing queue at high utilisation
   means capacity-bound, and TTFT is about to
   degrade → the trigger to shed free, or plan
   more capacity.
\`\`\`

**These two together answer "is the promise being kept" and "am I about to break it."** **Paid TTFT p95 is the outcome; queue-depth-at-utilisation is the leading indicator** — and watching the leading indicator is what lets me shed free traffic before paid TTFT degrades, rather than after. **An average-latency dashboard would show neither.**

---

**What I would deliberately not build**

**A bespoke inference serving engine.** **Continuous batching, streaming, and GPU scheduling are solved by existing serving frameworks** — building my own is months of work to match what is available, and the value is in the tiering, fairness and capacity policy on top, not in re-implementing the batcher.

**Per-request GPU autoscaling.** **The fleet is fixed by budget and GPUs have provisioning lead time**, so reactive per-request scaling is both impossible and the wrong model — capacity is a planning decision, and the queue plus saturation policy is how I survive between planning cycles.

**A cross-region active-active fleet, at first.** **Until the scale demands it, one region with the queue and tiering is simpler and sufficient** — geo-distribution is a real cost and complexity that the requirements do not yet justify.

**And elaborate free-tier features.** **Free is best-effort and absorbs volatility**, so investing in guaranteeing free-tier latency works against the design — the free tier\'s job is to degrade gracefully, not to be reliable, and building reliability into it would either cost budget or erode the paid guarantee. **The honest design makes free explicitly second-class, and spends the fixed capacity on the promise that was sold.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-cgpt-1',
      level: 'basic',
      question: 'What makes a ChatGPT-style app different from an ordinary web service?',
      guidance:
        'Inference is slow, streamed, and GPU-bound — a capacity-and-streaming problem. Look for that reframe, not a CRUD design.',
    },
    {
      id: 'iq-cgpt-2',
      level: 'basic',
      question: 'What are the two latency numbers you care about?',
      guidance:
        'Time to first token (responsiveness) and total generation time (follows output). An average of "latency" hides both.',
    },
    {
      id: 'iq-cgpt-3',
      level: 'intermediate',
      question: 'Why not autoscale the GPU fleet on demand?',
      guidance:
        'GPUs are scarce and slow to provision. A queue absorbs bursts; capacity is planned. Continuous batching is the utilisation lever.',
    },
    {
      id: 'iq-cgpt-4',
      level: 'intermediate',
      question: 'How do you keep one tenant from starving the rest?',
      guidance:
        'Token-based (not request-based) quotas, fair scheduling, and generation-length caps. A request is not a unit of load.',
    },
    {
      id: 'iq-cgpt-5',
      level: 'advanced',
      question: 'How do you protect a paid SLO from a free-tier burst on a fixed fleet?',
      guidance:
        'Reserve a paid capacity floor free cannot cross; let free use idle slack; degrade and shed free first under saturation.',
    },
    {
      id: 'iq-cgpt-6',
      level: 'advanced',
      question: 'How do you manage a very long conversation?',
      guidance:
        'Truncate to a window or summarise older turns — every turn resends the history, so it is a cost and context-limit control.',
    },
    {
      id: 'iq-cgpt-7',
      level: 'followup',
      question: 'What happens when the client disconnects mid-generation?',
      guidance:
        'Cancel the generation and free the GPU — an uncancelled stream wastes the scarcest resource, which matters most on a fixed fleet.',
    },
    {
      id: 'iq-cgpt-8',
      level: 'followup',
      question: 'What two metrics run this system?',
      guidance:
        'TTFT distribution (the SLO) and queue-depth-versus-utilisation (the capacity signal). Not average latency.',
    },
  ],

  activeLearning: [
    {
      id: 'al-cgpt-1',
      kind: 'what-changes-if',
      prompt:
        'Change the deployment: instead of self-hosting open models on your own GPUs, you build on a third-party model provider\'s API. What parts of this design disappear, what remains, and what genuinely new problems appear?',
      discussion: `**Moving to a provider API removes the capacity-engineering half of the design and adds a dependency-management half** — so the difficulty relocates rather than shrinking, which is the theme of these scale changes.

**What disappears.**

**GPU capacity planning, batching, and the worker fleet.** **The provider owns the GPUs**, so continuous batching, fleet sizing, and utilisation are their problem — the single most involved part of the self-hosted design is simply gone. **No queue-in-front-of-workers, no capacity lead-time decisions, no batching scheduler.**

**And the fixed-fleet saturation policy.** **You are no longer rationing your own scarce GPUs**, so the "reserve a paid floor, degrade free first" machinery mostly dissolves — the provider serves your requests subject to their rate limits, not your fleet.

**What remains, essentially unchanged.**

**Streaming.** **The provider streams tokens and you still stream to your client** — SSE, connection held open, cancellation on disconnect. **The whole streaming and TTFT story is identical**, because it is a property of inference, not of who owns the GPU.

**Conversation storage and history management.** **The provider does not store your conversations — you do** — so partitioning per user, truncation, summarisation, and the every-turn-resends-history cost curve all remain, and the cost curve arguably matters more (below).

**The two-latency distinction and the metrics.** **TTFT versus total time is still the truth**, though now TTFT includes the provider\'s queue, which you do not control.

**What is genuinely new.**

**Rate limits are now someone else\'s policy, and they are a hard ceiling.**

\`\`\`
Self-hosted: your capacity, your rules
Provider:    their rate limits (requests/min,
             tokens/min) — a hard cap you cannot
             exceed by adding hardware
→ so a traffic spike hits the PROVIDER\'S limit,
  and your only levers are: request a higher
  limit (lead time), queue and smooth your own
  traffic, or shed
\`\`\`

**You still need a queue and a saturation policy — but to stay under the provider\'s rate limit, not to ration your own GPUs.** **The queue\'s job changes from "feed my workers" to "smooth my traffic to fit the provider\'s ceiling"**, and the tiering (protect paid, shed free) reappears in that new context.

**Cost becomes per-token and directly metered, which changes the levers.**

\`\`\`
Self-hosted: cost is GPU-time; idle GPUs waste
             money; batching is the lever
Provider:    cost is per-token, pay-for-what-you-
             use; no idle cost, but every token
             is billed
→ so history truncation and generation caps
  matter MORE (every resent token is billed
  directly), and batching is irrelevant (not
  yours)
→ and the model-selection cascade — cheaper
  model for simple turns — is now a pure cost win
  with no utilisation trade-off
\`\`\`

**The new dependency risks.**

**Provider availability is now your availability.** **If the provider has an outage, you are down** — so the design needs a fallback: a secondary provider, or a smaller self-hosted model for degraded service, and graceful handling of provider errors and timeouts.

**Provider rate-limit exhaustion is a shared-fate problem.** **All your tenants draw on the same provider quota**, so a free-tier burst can exhaust the quota that paid depends on — which brings back the fairness design, now rationing the provider\'s rate limit across your tenants rather than your GPUs. **The token-based per-tenant quotas remain essential for exactly this reason.**

**And data leaves your infrastructure.** **Conversations are sent to the provider**, which is a privacy and compliance consideration the self-hosted design did not have — relevant for regulated tenants, and a reason some deployments stay self-hosted.

**What I\'d build differently.**

\`\`\`
Drop:    GPU fleet, batching, capacity planning,
         fixed-fleet saturation
Keep:    streaming + cancellation, conversation
         storage + history management, the two-
         latency metrics, per-tenant token quotas
Add:     provider rate-limit smoothing (a queue
         for THAT), a fallback provider/model,
         provider-error handling, cost metering
         per tenant, data-residency consideration
Elevate: history truncation and model-cascade as
         pure cost wins; provider availability as
         an availability risk
\`\`\`

**The transferable point: outsourcing the GPUs outsources the capacity-engineering problem and imports a dependency-management one.** **The provider\'s rate limit is the new fixed capacity — you still queue, still ration across tenants, still shed under pressure — but the resource being rationed is a contractual quota rather than physical hardware.** **The streaming, storage, and fairness core is stable across both, which again shows it was the right core; the capacity layer underneath it is entirely determined by whether you own the silicon.**`,
    },
    {
      id: 'al-cgpt-2',
      kind: 'debug',
      prompt:
        'A self-hosted chat service has healthy-looking average latency and normal GPU utilisation, but users report that responses "sometimes take forever to start" and it is intermittent, worse at peak hours. Diagnose it.',
      discussion: `**"Sometimes take forever to START" is the crucial phrase — it points at time-to-first-token, not total time, and at the tail, not the average — so the healthy average and normal utilisation are consistent with a real problem the wrong metrics are hiding.**

**Hypothesis 1 — queue wait at peak, invisible in the average.**

**"Worse at peak hours" and "intermittent" strongly suggest capacity saturation.** **At peak, the queue grows, and TTFT becomes dominated by queue wait rather than inference** — so the request eventually gets served (total time is fine, average is fine) but the *start* is delayed by queueing.

\`\`\`
Off-peak: queue empty → TTFT = inference start
  → fast
Peak:     queue deep → TTFT = queue wait +
  inference start → "forever to start"
→ the AVERAGE is fine because most hours are
  off-peak, and TOTAL time is fine because the
  generation itself is normal
\`\`\`

*Check:* **plot TTFT p95/p99 against time of day, alongside queue depth.** **If TTFT tail spikes at peak while the average stays flat, this is confirmed** — and it is the leading hypothesis given the peak-hour correlation.

**Why the average and utilisation looked healthy** is the instructive part: **the average is dominated by the many off-peak requests, and "normal utilisation" is exactly what you see when you are capacity-bound — the GPUs are busy, not idle, which is the saturation signature, not a reassurance.** **High utilisation with a growing queue is the problem, and utilisation alone reads as healthy.**

**Hypothesis 2 — head-of-line blocking from long generations.**

**If the scheduler is not doing continuous batching well, a few very long generations can occupy workers and block new requests from starting** — so TTFT for a request that arrives behind a giant one is terrible, intermittently, depending on what else is running.

\`\`\`
A 4,000-token generation holds batch slots for a
long time → requests arriving behind it wait to
START → intermittent, correlated with when big
generations happen
\`\`\`

*Check:* **correlate TTFT spikes with concurrent long generations, and look at whether generation-length caps exist.** **If uncapped long generations are blocking, that is both a fairness and a TTFT problem** — and a generation cap plus better batching is the fix.

**Hypothesis 3 — batching latency trade-off.**

**Batching improves throughput but can add latency**: if the scheduler waits to accumulate a batch before starting, TTFT includes that wait. **Tuned too aggressively for throughput, batching delays the start of every generation** — and this would be worse at peak when the batching dynamics change.

*Check:* **the batching configuration and whether TTFT correlates with batch-formation wait.** **This is a tuning issue** — the throughput/latency knob set too far toward throughput.

**Hypothesis 4 — connection/gateway issues under load.**

**Streaming holds connections open, and at peak the gateway may be running out of connection capacity or hitting limits** — so the delay is in establishing or proxying the stream, not in the GPU at all. **"Forever to start" could be the connection, not the inference.**

*Check:* **gateway connection counts and any connection-pool exhaustion at peak.** **If the gateway is the bottleneck, GPU utilisation would indeed look normal** because the requests are not even reaching the workers promptly.

**Hypothesis 5 — a specific tenant\'s burst starving the queue.**

**Without fair scheduling, one tenant\'s peak-hour burst fills the queue, and everyone else\'s TTFT collapses behind it** — intermittent (depends on the abuser\'s activity) and worse at peak (when they burst).

*Check:* **per-tenant token consumption at the spike times.** **If one tenant dominates the queue during TTFT spikes, fairness is the fix** — token-based quotas and fair scheduling.

**What I\'d check first.** **TTFT p99 against time of day, overlaid with queue depth and GPU utilisation.** **This single chart distinguishes hypotheses 1, 2 and 5** — is TTFT tail spiking at peak (queue saturation), is it correlated with long generations (head-of-line), or with one tenant (fairness). **And it exposes the core measurement failure: the team was watching average total latency, which is blind to a peak-hour TTFT-tail problem.**

**The instrumentation gap this reveals.**

**The team measured the wrong thing in three ways at once:**

\`\`\`
· AVERAGE, not the tail → hides an intermittent
  problem that only hits some requests
· TOTAL latency, not TTFT → hides a "slow to
  start" problem, since total time is fine
· not correlated with queue depth → hides that
  it is capacity-driven
\`\`\`

**"Healthy average latency and normal utilisation" is precisely the dashboard that misses this class of problem** — and it is the exact dashboard the lesson warns against. **The fix, before any tuning, is the right metrics:**

\`\`\`
· TTFT distribution (p95/p99), separately from
  total time
· queue depth and GPU utilisation together,
  over time
· per-tenant token consumption
\`\`\`

**Then the response follows the diagnosis:** if peak saturation (H1), the queue is telling you to shed/degrade or add capacity against the SLO; if head-of-line (H2), cap generations and fix batching; if fairness (H5), token-based scheduling. **But none of those can even be chosen until the metrics can see the problem** — which is the transferable point: **an average of total latency is not a measure of a streaming system\'s responsiveness, and a system that reports it is blind to exactly the intermittent, tail, time-of-day failures users actually experience.**`,
    },
  ],

  revision: {
    bullets: [
      'The model call is a solved API; the streaming, capacity and storage system around it is the design.',
      'Inference is slow, streamed, and GPU-bound — a capacity-and-streaming problem, not request/response.',
      'Latency is two numbers: time to first token (responsiveness) and total time (follows output length).',
      'Stream tokens over SSE or websockets, optimising TTFT; a single average of "latency" is blind.',
      'Streaming holds a connection open, so connection count is the load signal and disconnect must cancel.',
      'Cancelling on disconnect frees the scarcest resource — it matters most on a fixed fleet.',
      'GPUs are scarce and slow to provision, so a queue absorbs bursts rather than reactive autoscaling.',
      'Continuous batching keeps GPU utilisation high and is the biggest cost lever self-hosted.',
      'Under saturation, TTFT is dominated by queue wait, so the design sheds or degrades, fairly.',
      'Fairness and quotas are measured in tokens, not requests — a request is not a unit of load.',
      'A generation-length cap stops one request monopolising a worker.',
      'Conversation history is partitioned per user and truncated or summarised past the context limit.',
      'Every turn resends the included history, so long conversations are quadratically expensive.',
      'The window size is a cost knob, because it sets the per-turn token cost.',
      'Self-hosted makes GPU capacity central; a provider API makes rate limits and dependency central.',
      'Reserve a paid capacity floor free traffic cannot cross to protect a tiered SLO.',
      'Watch TTFT distribution and queue-depth-versus-utilisation, not average latency.',
      'A growing queue at high utilisation means capacity-bound — the signal to shed or add capacity.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A streaming, capacity-managed serving system around a model call: token streaming over held-open connections, a queue feeding batched finite GPUs, token-based multi-tenant fairness, and per-user conversation storage with history truncation — run by the two latencies and the capacity signals.',
    whyItExists:
      'Because inference is slow, streamed, and runs on scarce GPUs, which makes serving a chat product a capacity-and-streaming problem rather than an ordinary request/response web app.',
    whenToUse: [
      'Streaming responses over SSE or websockets with cancellation on disconnect.',
      'A queue in front of finite GPU workers, with continuous batching.',
      'Token-based (not request-based) quotas and fair scheduling.',
      'Generation-length caps to bound any single request.',
      'Per-user partitioned conversation storage with truncation or summarisation.',
      'Reserved capacity floors to protect a tiered latency SLO.',
    ],
    whenNotToUse: [
      'A synchronous full-response JSON endpoint for chat.',
      'CPU-based autoscaling of a GPU-bound service.',
      'Reactive per-request GPU autoscaling.',
      'Request-count rate limits as multi-tenant fairness.',
      'Unbounded generation length or unbounded resent history.',
      'Average latency as the responsiveness metric.',
      'A bespoke serving engine when frameworks exist.',
    ],
    alternatives: [
      'A provider API, which outsources GPU capacity and imports rate-limit and dependency management.',
      'A smaller or cheaper model for simple turns, cutting the common-case cost.',
      'Summarised history instead of full history, for long conversations.',
      'Load shedding with a clear signal, instead of a silent hang, under saturation.',
    ],
    tradeoffs: [
      'Streaming buys responsiveness and costs connection-oriented infrastructure.',
      'A queue buys burst survivability and costs queue-wait latency under saturation.',
      'Continuous batching buys utilisation and affordability and costs scheduler complexity.',
      'Token-based fairness buys real fairness and costs token accounting.',
      'History truncation buys bounded cost and context and costs older-turn detail.',
      'A reserved paid floor buys a protected SLO and costs some idle-capacity efficiency.',
    ],
    failureModes: [
      'A synchronous reply making perceived latency equal to total generation time.',
      'CPU autoscaling adding web servers while the GPUs saturate.',
      'An uncancelled generation wasting a GPU after the user left.',
      'A request-count limit letting a tenant consume the fleet with huge generations.',
      'One long generation blocking new requests from starting.',
      'A conversation growing until it hits the context limit and fails.',
      'Quadratic token cost from resending unbounded history every turn.',
      'A free-tier burst degrading the paid SLO with no capacity reservation.',
      'A silent hang under saturation instead of an explicit shed.',
      'An average-latency dashboard blind to a peak-hour TTFT-tail problem.',
      'A provider rate limit exhausted by one tenant, starving the rest.',
    ],
    followUpQuestions: [
      'Is the response streamed, and what is the time-to-first-token target?',
      'What happens when the client disconnects mid-generation?',
      'Self-hosted or a provider — whose problem is GPU capacity?',
      'What sits between bursty demand and finite GPUs?',
      'How is one request stopped from monopolising a worker?',
      'Is fairness measured in requests or tokens, and why?',
      'How is a very long conversation handled?',
      'How is a paid SLO protected from a free-tier burst?',
      'What happens under saturation — shed, degrade, or wait?',
      'Which two metrics tell you the system is healthy?',
      'What is the biggest cost lever, and are you using it?',
    ],
  },
});
