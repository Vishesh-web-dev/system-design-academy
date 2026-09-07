import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-load-balancing',
  title: 'Load balancing: L4 vs L7',
  summary:
    'Interviews ask about the algorithm; incidents are caused by health checks, connection draining and the fact that "least connections" happily routes every request to your slowest machine.',
  phase: 'distributed',
  module: 'serving',
  position: 22,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['load-balancing', 'health-checks', 'draining', 'algorithms', 'failure-isolation'],
  prerequisites: ['f-tcp-latency'],
  resources: [
    {
      key: 'nginx-load-balancing',
      tier: 'must',
      note: 'The practical reference. Read the sections on the algorithms and on passive health checks, and note how much of the configuration surface is about failure handling rather than distribution.',
    },
    {
      key: 'sre-book-load-balancing-dc',
      tier: 'must',
      note: 'The chapter that explains why simple algorithms misbehave at scale, including the least-loaded trap. This is the single most useful thing to read on the subject.',
    },
    {
      key: 'aws-elb-overview',
      tier: 'must',
      note: 'Read it for the concrete distinction between a network load balancer and an application load balancer, which is exactly the L4/L7 split with the trade-offs made operational.',
    },
    {
      key: 'maglev-paper',
      tier: 'good',
      note: 'A software network load balancer built for consistent hashing with minimal disruption on backend changes. Read the sections on the hashing scheme and on connection tracking.',
    },
    {
      key: 'google-sre-handling-overload',
      tier: 'good',
      note: 'What to do when every backend is over capacity, and why load balancing alone cannot fix overload. Pairs with the backpressure lesson.',
    },
    {
      key: 'aws-workload-isolation-shuffle',
      tier: 'advanced',
      note: 'Shuffle sharding, which changes the question from "how do I spread load" to "how do I limit how many customers one bad request can hurt". Read it for the blast-radius framing.',
    },
  ],

  intuition: {
    body: `A load balancer sits in front of several identical backends and decides which one gets each request. The naive picture — a switchboard spreading work evenly — is accurate and almost entirely useless, because it draws attention to the wrong thing.

The algorithm is the least interesting part of a load balancer. Round robin, least connections, random-of-two: on a healthy fleet of identical machines they all perform within a few percent of each other. Nobody has ever been paged because they chose round robin.

What causes incidents is **what the load balancer believes about its backends.**

A load balancer's real job is to maintain a *model* of which backends can serve traffic, and route according to that model. Every serious failure is the model being wrong:

- A backend is dead but the health check still passes, so a third of requests fail.
- A backend is alive but the health check fails — because the check touches a dependency the real traffic does not need — so you lose capacity you had.
- A backend is deploying, and requests in flight are cut off because nothing drained the connections first.
- A backend is *slow*, and "least connections" interprets its growing backlog as available capacity, so it receives progressively more traffic until it collapses.

That last one deserves emphasis because it is the most counter-intuitive result in this lesson. **Naive least-loaded routing actively seeks out your sickest machine.** A backend that is failing fast has few open connections, so it looks idle; a backend that is slow accumulates connections and looks busy. Depending on which metric you use, one of those two misreadings is guaranteed.

The second big idea is the **L4/L7 split**, which is a question about how much the balancer understands:

- **L4** operates on TCP. It sees addresses, ports and bytes. It picks a backend when the connection opens and forwards the rest of that connection blindly.
- **L7** operates on HTTP. It sees methods, paths, headers and individual requests, so it can route per request, retry a failed one elsewhere, and terminate TLS.

The trade is understanding against cost. L7 can do vastly more and must parse and buffer everything, which costs latency and CPU. L4 is nearly free and can only make one decision per connection.

The framing to carry: **choose L4 or L7 by what decisions you need per request, and then spend your effort on health checks and draining, because that is where the outages are.**`,
    analogyLimit:
      'The switchboard analogy fails in three ways that matter. A switchboard has no opinion about whether an operator is well, whereas that opinion is a load balancer\'s central function and the whole failure surface. It cannot see that an operator is slow rather than busy — the distinction that makes least-loaded routing dangerous. And it never hands off a call in progress, whereas connection draining is a routine and frequently botched requirement.',
  },

  deepExplanation: {
    predict: {
      question:
        'A fleet of ten backends sits behind a least-connections load balancer. One backend develops a fault: it accepts requests but its database connection pool is exhausted, so every request takes 30 seconds and then fails. What does the load balancer do, and what does the fleet look like ten minutes later?',
      answer: `**What the load balancer does: it sends that backend *more* traffic than the others, and keeps doing so.**

Work through the mechanism. Least connections routes to whichever backend currently has the fewest open connections. The healthy backends serve requests in 50 ms, so at any instant each holds a handful of open connections. The faulty backend holds requests for 30 seconds, so it accumulates connections — and initially that makes it look *busiest*, so it gets less traffic.

Then the accumulation crosses a threshold. Either the backend's connections start timing out and closing at the 30-second mark faster than new ones arrive, or the client gives up first and closes them. At that point the faulty backend's open-connection count drops sharply while healthy backends stay steadily occupied — and it now looks like the **idlest** machine in the fleet.

So it receives a burst. Those requests also take 30 seconds and fail. The count drops again. Another burst.

The observable result is oscillation: the faulty backend takes disproportionate traffic in waves, and **every request routed to it fails after 30 seconds.** Ten percent of the fleet is causing far more than ten percent of the errors.

**Why the health check did not save you.** Almost certainly the check is \`GET /health\` returning \`200 OK\` from a handler that does not touch the database. The process is alive, the port is open, the handler responds — so the check passes while every real request fails. This is the commonest health-check design error: **checking liveness when you needed to check readiness to serve.**

**What the fleet looks like ten minutes later, if nothing intervenes.** Worse than one bad backend in ten. Because requests routed to the faulty backend occupy client-side resources for 30 seconds, the callers upstream accumulate their own backlog. If those callers have bounded connection pools — and they do — the pool fills with connections waiting on the faulty backend, and the caller starts failing requests it would have sent to *healthy* backends. One faulty backend has degraded the whole service. That is the cascading-failure pattern, and load balancing is where it starts.

**What would have prevented it, in order of value:**

1. **A health check that exercises the dependency path** — one that acquires a database connection and runs a trivial query. Then the faulty backend fails the check and is removed.
2. **Outlier detection**: eject a backend when its error rate or latency diverges sharply from its peers, regardless of what the health check says. This catches faults nobody wrote a check for.
3. **A request timeout well below 30 seconds**, so a stuck request is abandoned in one second rather than occupying resources for thirty. This bounds the damage even when detection fails.
4. **Random-of-two-choices instead of strict least connections**, which removes the oscillation by never deterministically picking the apparently-idlest machine.

**The general lesson.** The algorithm did not fail — it did exactly what it was told. It was told to prefer the machine that looks idle, and a broken machine looks idle. Load-balancing correctness lives in the health model and the timeouts, not in the distribution rule.`,
    },
  body: `## L4 versus L7: what the balancer understands

| | L4 (transport) | L7 (application) |
| --- | --- | --- |
| Sees | IP, port, TCP bytes | Method, path, headers, body |
| Decides | Once, when the connection opens | Per request |
| TLS | Passes through encrypted | Terminates, so it can read the request |
| Retry a failure elsewhere | No — it cannot tell a failure from data | Yes |
| Route by path or header | No | Yes |
| Latency added | Microseconds | Milliseconds |
| Throughput | Millions of connections per node | Far lower; it parses everything |
| Sticky sessions | By source address only | By cookie or header |

The consequences that matter in a design discussion:

**L4 cannot retry.** It forwarded bytes; it has no idea whether the response was a success or a 503. If a backend dies mid-connection, the client sees a broken connection and must handle it. This is not a deficiency to work around — it is the price of not parsing.

**L4 pins a connection for its lifetime.** With HTTP/2 or gRPC, a client opens **one long-lived connection** and multiplexes thousands of requests over it. An L4 balancer makes one routing decision for all of them. So a new backend joining the fleet receives no traffic at all until clients reconnect, and long-lived connections mean load stays where it was assigned regardless of how imbalanced that becomes. This is the single most common surprise when putting gRPC behind an L4 balancer, and the fix is either an L7 proxy that understands HTTP/2 streams or client-side balancing.

**L7 terminates TLS, which is usually what you wanted anyway.** Certificate management in one place, and the balancer can read headers to route. The cost is that traffic from balancer to backend is plaintext unless you re-encrypt, and that the balancer is now a component that must scale with request volume rather than connection count.

**Use L4 when** you need raw throughput, non-HTTP protocols, or true source-IP preservation. **Use L7 when** you need per-request routing, retries, path-based dispatch or centralised TLS — which is most web-facing systems.

## The algorithms, and where each one breaks

**Round robin.** Next backend in order. Simple, predictable, and blind to load. Fine when requests are homogeneous and backends identical. Breaks when request cost varies by orders of magnitude — one backend gets three expensive requests in a row and queues while others idle.

**Weighted round robin.** Round robin with per-backend weights, for heterogeneous hardware or gradual rollouts. The weights are static and therefore always slightly wrong.

**Least connections.** Fewest open connections wins. Better with variable request cost — and it has the trap from the prediction above: a *failing* backend looks idle, so this algorithm actively prefers broken machines. Also nearly useless with HTTP/2, where one connection carries many requests.

**Least request / least outstanding requests.** Counts in-flight requests rather than connections, which fixes the HTTP/2 problem. It has the same failing-fast trap.

**Random of two choices ("power of two random choices").** Pick two backends at random, send to the less loaded. This is a genuinely important result: it gets most of the benefit of least-loaded while **avoiding the herding and oscillation** that deterministic least-loaded produces, because no backend is ever the guaranteed winner. It is the default worth reaching for.

**Consistent hashing.** Hash a request key to a backend, so the same key lands on the same backend. Essential when backends hold per-key state — a local cache, a session, a shard. Covered properly in the consistent-hashing lesson; here the point is that it is a *cache-locality* tool, and it trades even distribution for locality.

The honest summary: **on a healthy fleet the choice barely matters; random-of-two is the best default; consistent hashing is for locality, not for balance.**

## Health checks: where the outages actually are

A health check is a periodic request that determines whether a backend receives traffic. The design decisions:

**Liveness versus readiness.** *Liveness* asks "is the process running". *Readiness* asks "can this instance serve a real request right now". A handler that returns \`200\` without touching anything checks liveness and tells you almost nothing. A readiness check that acquires a database connection and runs a trivial query catches the failure from the prediction above.

**The over-correction, and it is a real one.** A readiness check that fails when *any* dependency is unavailable will remove **every** backend simultaneously when a shared dependency degrades — turning a partial degradation into a total outage. If the database is briefly slow, all ten backends fail their checks, all ten are removed, and the load balancer has no one to route to.

The resolution: **check only dependencies that are required for the traffic this instance serves, and distinguish "I am broken" from "something I depend on is broken".** A backend whose database is unreachable should not be removed if every other backend is in the same position — there is nowhere better to send the request, and serving an error from a backend is strictly better than serving nothing from the balancer. Some balancers implement exactly this as a **panic threshold**: if more than a configured fraction of backends are unhealthy, ignore health status entirely and route to everyone.

**Active versus passive.**
- *Active*: the balancer polls \`/health\`. Detects problems before real traffic hits them; costs a constant request rate and only tests what the check tests.
- *Passive (outlier detection)*: the balancer watches real traffic and ejects a backend whose error rate or latency diverges from its peers. Catches faults nobody anticipated, and requires real failures to detect them.

**Both, always.** Active for known conditions, passive for unknown ones.

**Timing.** Check interval, failure threshold and success threshold together set your detection time. Three failures at a five-second interval is fifteen seconds of routing to a dead backend. Tightening it detects faster and risks ejecting healthy backends on a transient blip. And the success threshold matters as much: re-admitting a backend after one passing check causes flapping, where a marginal backend cycles in and out of rotation.

## Connection draining: the deploy that drops requests

When you remove a backend — deploy, scale-in, replacement — requests are in flight. Cutting it off immediately fails them.

**Draining** is the correct sequence:

1. Mark the backend as draining. The balancer sends it no *new* requests.
2. Existing requests complete normally.
3. After a timeout, close whatever remains.
4. Now stop the process.

Two details that cause real bugs:

**The application must participate.** On \`SIGTERM\`, a well-behaved server stops accepting new connections, finishes in-flight requests, and *then* exits. A server that exits immediately on \`SIGTERM\` drops requests no matter how carefully the balancer drains.

**The drain timeout must exceed your longest legitimate request.** A 5-second drain with a 30-second export endpoint kills exports on every deploy. And it must be shorter than your orchestrator's termination grace period, or the orchestrator sends \`SIGKILL\` mid-drain and the careful sequence achieves nothing.

## Beyond distribution: blast radius

Standard load balancing spreads every customer's requests across every backend. That maximises utilisation and means **one poisonous request pattern can degrade every backend**, and therefore every customer.

**Shuffle sharding** changes the objective. Assign each customer a small random subset of backends — say two of ten. A customer whose traffic breaks its backends breaks only those two. Another customer would have to draw the *same* two to be affected, and with two-of-ten there are 45 distinct pairs, so the probability of full overlap with any given customer is small.

The trade: lower utilisation, since each customer can only use part of the fleet, and more complex capacity planning. Worth it when one tenant can hurt others — which is any multi-tenant system.

This is worth naming in an interview because it reframes the question. Load balancing asks "how do I spread work evenly". Shuffle sharding asks "how many customers can one bad actor hurt". The second is usually the question that matters.

## What load balancing cannot do

**It cannot create capacity.** If all backends are over capacity, distributing more evenly changes nothing. That is a load-shedding and backpressure problem.

**It cannot fix a slow dependency.** If every backend waits on the same slow database, routing is irrelevant.

**It cannot make a stateful backend stateless.** Sticky sessions are a workaround for state that should not be local; they undermine even distribution and mean losing a backend loses sessions.

**It is not free of itself.** The balancer is a component that can fail, saturate and be misconfigured. Anycast plus multiple balancer nodes, or DNS-level distribution across balancers, is how you avoid making it a single point of failure.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'lb-health-model',
      title: 'The health model is the load balancer',
      caption:
        'Step through it. Every routing decision is a consequence of the model, and every serious incident in this lesson is the model being wrong in one of four specific ways.',
      nodes: [
        { id: 'client', label: 'Clients', kind: 'client', x: 0, y: 160, detail: 'Send requests. With HTTP/2 or gRPC, one long-lived connection carries thousands of them — which is why an L4 balancer makes one decision for all of them.' },
        { id: 'lb', label: 'Load balancer', kind: 'service', x: 190, y: 160, detail: 'Maintains a model of which backends can serve traffic, then applies an algorithm to the healthy set. The model is the important half.' },
        { id: 'active', label: 'Active checks', kind: 'note', x: 190, y: 30, detail: 'Polls /health on an interval. Detects known conditions before real traffic hits them, and only tests what the check actually touches.' },
        { id: 'passive', label: 'Outlier detection', kind: 'note', x: 190, y: 290, detail: 'Watches real traffic and ejects a backend whose error rate or latency diverges from its peers. Catches faults nobody wrote a check for.' },
        { id: 'healthy', label: 'Healthy backends', kind: 'service', x: 430, y: 70, detail: 'Serving in 50 ms. Each holds a handful of open connections at any instant, so under least-connections they look steadily occupied.' },
        { id: 'slow', label: 'Slow backend', kind: 'service', x: 430, y: 170, detail: 'Pool exhausted; 30 seconds per request then failure. Its connection count oscillates, and when it drops it looks like the idlest machine in the fleet.' },
        { id: 'draining', label: 'Draining backend', kind: 'service', x: 430, y: 270, detail: 'No new requests; in-flight ones complete. Requires the application to honour SIGTERM, and a drain timeout longer than the longest legitimate request.' },
        { id: 'db', label: 'Shared database', kind: 'store', x: 660, y: 170, detail: 'The dependency a readiness check should exercise — and the reason a check that fails on any dependency outage removes every backend at once.' },
      ],
      edges: [
        { id: 'l1', source: 'client', target: 'lb', kind: 'sync' },
        { id: 'l2', source: 'lb', target: 'active', kind: 'control' },
        { id: 'l3', source: 'lb', target: 'passive', kind: 'control' },
        { id: 'l4', source: 'lb', target: 'healthy', kind: 'sync' },
        { id: 'l5', source: 'lb', target: 'slow', kind: 'sync' },
        { id: 'l6', source: 'lb', target: 'draining', kind: 'async' },
        { id: 'l7', source: 'healthy', target: 'db', kind: 'read' },
        { id: 'l8', source: 'slow', target: 'db', kind: 'read' },
      ],
      steps: [
        {
          id: 'p1',
          title: 'Routing follows the model, not the reality',
          description:
            'The balancer applies its algorithm to whichever backends its model calls healthy. If the model is wrong, a perfect algorithm routes perfectly to a broken machine.',
          nodes: ['client', 'lb', 'healthy'],
          edges: ['l1', 'l4'],
        },
        {
          id: 'p2',
          title: 'A liveness check keeps a broken backend in rotation',
          description:
            'GET /health returns 200 from a handler that never touches the database. The process is alive and every real request fails. This is the commonest health-check error — checking liveness when readiness was needed.',
          nodes: ['active', 'slow', 'db'],
          edges: ['l2', 'l5', 'l8'],
        },
        {
          id: 'p3',
          title: 'Least connections then prefers the broken one',
          description:
            'The slow backend accumulates connections, they time out together, its count drops, and it becomes the apparently idlest machine — so it takes a burst. Random-of-two removes the oscillation by never having a guaranteed winner.',
          nodes: ['slow', 'healthy'],
          edges: ['l5', 'l4'],
        },
        {
          id: 'p4',
          title: 'Outlier detection catches what no check anticipated',
          description:
            'Divergent error rate or latency against peers ejects the backend regardless of what /health says. Active checks handle known conditions; passive detection handles the rest. Run both.',
          nodes: ['passive', 'slow'],
          edges: ['l3', 'l5'],
        },
        {
          id: 'p5',
          title: 'And removal has to be gradual',
          description:
            'A draining backend takes no new requests and finishes its in-flight ones. This needs the application to honour SIGTERM, a drain timeout above the longest legitimate request, and a grace period above the drain timeout.',
          nodes: ['draining'],
          edges: ['l6'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'algorithm-failure',
      title: 'Each algorithm and the fleet state that defeats it',
      caption:
        'Read the failure column rather than the algorithm column. The point is that every rule has a fleet state it misreads, and random-of-two is the default because its misreadings are the mildest.',
      code: `flowchart LR
    RR["Round robin"] --> RRF["Blind to load.<br/>One backend gets three<br/>expensive requests, queues"]
    WRR["Weighted round robin"] --> WRRF["Weights are static,<br/>so always slightly wrong"]
    LC["Least connections"] --> LCF["A failing-fast backend<br/>looks idle.<br/>Useless with HTTP/2"]
    LR["Least outstanding requests"] --> LRF["Fixes HTTP/2.<br/>Same failing-fast trap"]
    P2["Random of two choices"] --> P2F["No guaranteed winner,<br/>so no herding.<br/>Best default"]
    CH["Consistent hashing"] --> CHF["Trades even load<br/>for cache locality.<br/>A hot key is a hot backend"]

    style P2F fill:#17272a,stroke:#35897e
    style LCF fill:#2a1a1a,stroke:#a04848
    style CHF fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: ['google'],
    body: `Google's Maglev is instructive because it is a network load balancer built by people who had already been bitten by everything in this lesson, and the design choices read as answers to specific failures.

Three properties worth extracting.

**It runs in software on commodity machines, behind anycast.** Rather than a dedicated hardware appliance, many identical Maglev machines announce the same address, and the network delivers a packet to whichever is closest. Scaling is adding machines; failure of one machine is handled by the network. This removes the load balancer as a single point of failure — the concern that closes the previous section — without any load-balancer-aware logic in clients.

**It uses consistent hashing with connection tracking, and both are necessary.** Anycast means successive packets of the same TCP connection may arrive at *different* Maglev machines, and each must forward them to the same backend or the connection breaks. Consistent hashing gives that: any machine hashing the same connection tuple picks the same backend without coordination. Connection tracking is the local optimisation on top — a table so the common case is a lookup rather than a hash — and it is explicitly a cache, not the source of truth. If the entry is missing, hashing still produces the right answer.

The design principle is the transferable part: **make the stateless computation authoritative and the state a cache.** A system whose correctness depends on shared mutable state across load-balancer nodes has to solve consensus; one where the state is an optimisation does not.

**Its hashing minimises disruption when backends change.** Naive hashing by modulo remaps most keys when the backend count changes, breaking most in-flight connections. Maglev's scheme is designed so that adding or removing a backend moves as few connections as possible — which is the consistent-hashing property, tuned for the specific constraint that a moved connection is a broken connection rather than a cache miss.

**Where the model does not transfer.** Maglev is L4. It cannot retry a failed request elsewhere, route by path, or terminate TLS, and it is designed for an environment with anycast and a controlled network. Most systems get their L4 tier from a cloud network load balancer and put an L7 proxy behind it — which is the same two-tier shape: a cheap connection-level tier for throughput and resilience, and a request-level tier for intelligence.

The transferable questions: **is your load-balancing tier itself a single point of failure, and does its correctness depend on state that must be shared?** Both have good answers, and both are usually unexamined.`,
  },

  tradeoffs: {
    intro:
      'Three bundled decisions: what layer to operate at, what rule to distribute by, and how to decide a backend is unwell. Rows cover all three.',
    rows: [
      {
        option: 'L4 (transport-level)',
        whenItWins:
          'Raw throughput, non-HTTP protocols, source-IP preservation, and as a resilient front tier under an L7 layer. Microseconds of added latency.',
        whenItLoses:
          'When you need per-request decisions — and especially with HTTP/2 or gRPC, where one long-lived connection carries thousands of requests and gets one routing decision.',
        cost:
          'No retries, no path routing, no TLS termination; new backends receive nothing until clients reconnect.',
      },
      {
        option: 'L7 (request-level)',
        whenItWins:
          'Most web-facing systems. Per-request routing, retry elsewhere on failure, path and header dispatch, centralised TLS, and correct handling of multiplexed connections.',
        whenItLoses:
          'At extreme throughput, or for protocols it cannot parse. It must buffer and parse everything.',
        cost:
          'Milliseconds of latency, meaningful CPU, plaintext to backends unless re-encrypted, and a tier that scales with requests rather than connections.',
      },
      {
        option: 'Round robin',
        whenItWins:
          'Homogeneous requests on identical backends. Predictable, trivially debuggable, no state.',
        whenItLoses:
          'When request cost varies by orders of magnitude — it will hand one backend several expensive requests in a row.',
        cost:
          'Complete blindness to actual load.',
      },
      {
        option: 'Least connections or least outstanding requests',
        whenItWins:
          'Highly variable request cost, where reacting to real occupancy beats a fixed rotation.',
        whenItLoses:
          'When a backend fails fast — it then looks idle and attracts traffic. Least *connections* is additionally near-useless under HTTP/2.',
        cost:
          'Per-backend state, oscillation, and an active preference for broken machines.',
      },
      {
        option: 'Random of two choices',
        whenItWins:
          'Almost always. Most of the benefit of least-loaded with no deterministic winner, so no herding and no oscillation.',
        whenItLoses:
          'When backends hold per-key state and locality matters more than balance.',
        cost:
          'Slightly worse theoretical balance than perfect least-loaded, which is not achievable anyway.',
      },
      {
        option: 'Consistent hashing',
        whenItWins:
          'When backends hold per-key state: a local cache, a session, a shard. Locality raises hit rates dramatically.',
        whenItLoses:
          'When keys are skewed — a hot key becomes a hot backend and no rebalancing helps.',
        cost:
          'Uneven load by construction, plus disruption on membership change even with a good scheme.',
      },
      {
        option: 'Liveness-only health check',
        whenItWins:
          'Nowhere, as the sole check. It answers a question you rarely need the answer to.',
        whenItLoses:
          'Whenever a process is alive but cannot serve — an exhausted pool, an unreachable dependency, a deadlocked worker.',
        cost:
          'Broken backends stay in rotation, and the failure is invisible in balancer metrics.',
      },
      {
        option: 'Readiness check touching dependencies, plus a panic threshold',
        whenItWins:
          'The correct default. Catches the failures that matter, and the threshold prevents a shared-dependency blip from removing the entire fleet.',
        whenItLoses:
          'When the check itself is expensive, or checks the wrong dependencies and ejects backends that could have served.',
        cost:
          'Load on dependencies from checks, and real thought about which dependencies are actually required.',
      },
      {
        option: 'Shuffle sharding',
        whenItWins:
          'Multi-tenant systems where one tenant\'s traffic can degrade backends. Limits how many others any one tenant can hurt.',
        whenItLoses:
          'Single-tenant systems, or when utilisation is the binding constraint.',
        cost:
          'Lower utilisation, harder capacity planning, and assignment state to maintain.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We use least connections because it balances load better than round robin."',
      whyWeak:
        'True on a healthy fleet and dangerous on an unhealthy one. A backend that fails fast holds few connections and therefore looks idle, so least connections actively prefers it. And under HTTP/2 or gRPC, where one connection carries thousands of requests, connection count barely correlates with load at all.',
      strongAnswer:
        '"I would use random-of-two-choices: pick two backends at random and send to the less loaded. It gets most of the benefit of least-loaded without a deterministic winner, so no herding and no oscillation. If I were counting anything I would count in-flight requests rather than connections, since connection count is meaningless under HTTP/2 — and either way the algorithm matters far less than the health check."',
    },
    {
      weakAnswer: '"Health checks hit `/health`, which returns 200 if the process is up."',
      whyWeak:
        'That is a liveness check, and it passes for a process whose database pool is exhausted, whose disk is full, or whose worker threads are deadlocked. Every request fails while the check reports health, which is exactly the failure mode where you needed the check to work.',
      strongAnswer:
        '"Readiness rather than liveness: the check should acquire a database connection and run a trivial query, so an exhausted pool fails it. But it must only check dependencies this instance genuinely needs, and I would set a panic threshold — if more than half the fleet is unhealthy the balancer ignores health status and routes to everyone, because serving errors from a backend beats serving nothing from the balancer."',
    },
    {
      weakAnswer: '"Our health check verifies every downstream dependency, so we know the instance is fully functional."',
      whyWeak:
        'A shared dependency degrading now removes every backend simultaneously, converting a partial degradation into a total outage. All ten instances fail their checks, all ten are removed, and the balancer has nowhere to route.',
      strongAnswer:
        '"That over-corrects. A check should distinguish \'I am broken\' from \'something we all depend on is broken\' — if every backend has the same unreachable database, removing them all makes things strictly worse. I would check only dependencies required for this instance\'s traffic, and rely on a panic threshold so a fleet-wide failure means health status is ignored rather than obeyed."',
    },
    {
      weakAnswer: '"We remove the instance from the load balancer and then deploy."',
      whyWeak:
        'It omits draining. Requests are in flight when the instance is removed; if it stops immediately those requests fail. And the failure appears on every deploy as a small error spike that teams learn to ignore.',
      strongAnswer:
        '"Mark it draining so it gets no new requests, let in-flight requests finish, then stop the process. Three things have to line up: the application must honour SIGTERM by finishing in-flight work before exiting, the drain timeout must exceed the longest legitimate request — otherwise every deploy kills long exports — and the orchestrator\'s grace period must exceed the drain timeout, or SIGKILL arrives mid-drain."',
    },
    {
      weakAnswer: '"We use sticky sessions so users always reach the same server."',
      whyWeak:
        'It is a workaround for state that should not be on the server, and it has real costs: distribution becomes uneven and unfixable, losing a backend loses its sessions, and a scale-out event gives new instances no traffic because existing users are pinned elsewhere.',
      strongAnswer:
        '"I would ask why the server holds state. Session data in a shared store or a signed token makes every backend interchangeable, which is what makes the rest of this work. If stickiness is genuinely needed — a long-lived WebSocket, an in-progress upload — I would use consistent hashing so failures redistribute predictably rather than source-IP affinity, and I would treat losing that state as an expected event."',
    },
    {
      weakAnswer: '"Adding a load balancer removes the single point of failure."',
      whyWeak:
        'It relocates it. The balancer itself can fail, saturate, or be misconfigured, and now every request depends on it. A single balancer instance in front of ten backends is less available than the backends were.',
      strongAnswer:
        '"The balancer becomes the thing that must not fail, so it needs the same treatment: multiple instances announcing the same address via anycast, or DNS-level distribution across several balancers, plus health checks on the balancers themselves. Google\'s Maglev is the illustration — many identical software balancers behind anycast, with correctness resting on stateless hashing so no shared state has to be coordinated."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lb-1',
      front: 'What is a load balancer\'s real job, beyond distribution?',
      back: 'Maintaining a correct model of which backends can serve traffic. Every serious load-balancing incident is that model being wrong.',
      topic: 'load-balancing',
    },
    {
      id: 'fc-lb-2',
      front: 'What does L4 see, and what can it therefore not do?',
      back: 'IP, port and TCP bytes. It cannot retry a failed request, route by path or header, or terminate TLS — it forwards bytes and cannot tell a failure from data.',
      topic: 'load-balancing',
    },
    {
      id: 'fc-lb-3',
      front: 'Why is L4 a poor fit for gRPC or HTTP/2?',
      back: 'One long-lived connection carries thousands of requests, and L4 makes one routing decision per connection. New backends get no traffic until clients reconnect.',
      topic: 'load-balancing',
    },
    {
      id: 'fc-lb-4',
      front: 'Why does least connections prefer broken backends?',
      back: 'A backend failing fast holds few open connections, so it looks idle. A slow one accumulates connections, they time out together, its count drops, and it becomes the apparently idlest machine.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lb-5',
      front: 'Why is random-of-two-choices the best default algorithm?',
      back: 'It gets most of the benefit of least-loaded with no deterministic winner, so there is no herding and no oscillation toward whichever backend momentarily looks idlest.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lb-6',
      front: 'What does consistent hashing trade, in a load-balancing context?',
      back: 'Even distribution for cache locality. The same key always reaches the same backend, so local hit rates rise — and a hot key becomes a hot backend.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lb-7',
      front: 'Liveness versus readiness?',
      back: 'Liveness: is the process running. Readiness: can this instance serve a real request now. A 200 from a handler that touches nothing checks liveness and tells you almost nothing.',
      topic: 'health-checks',
    },
    {
      id: 'fc-lb-8',
      front: 'What is the danger of a health check that verifies every dependency?',
      back: 'A shared dependency degrading fails every backend at once, converting partial degradation into a total outage with nowhere to route.',
      topic: 'health-checks',
    },
    {
      id: 'fc-lb-9',
      front: 'What is a panic threshold?',
      back: 'When more than a configured fraction of backends are unhealthy, the balancer ignores health status and routes to everyone — because serving errors from a backend beats serving nothing.',
      topic: 'health-checks',
    },
    {
      id: 'fc-lb-10',
      front: 'Active versus passive health checking, and which do you run?',
      back: 'Active polls an endpoint and catches known conditions early. Passive (outlier detection) ejects backends whose error rate or latency diverges from peers, catching unanticipated faults. Run both.',
      topic: 'health-checks',
    },
    {
      id: 'fc-lb-11',
      front: 'What sets your detection time for a dead backend?',
      back: 'Check interval × failure threshold. Three failures at five seconds is fifteen seconds of routing to a dead backend. The success threshold matters too — re-admitting after one pass causes flapping.',
      topic: 'health-checks',
    },
    {
      id: 'fc-lb-12',
      front: 'What are the three things that must line up for draining to work?',
      back: 'The application honours SIGTERM by finishing in-flight work; the drain timeout exceeds the longest legitimate request; the orchestrator grace period exceeds the drain timeout.',
      topic: 'draining',
    },
    {
      id: 'fc-lb-14',
      front: 'What question does shuffle sharding ask that load balancing does not?',
      back: 'Not "how do I spread work evenly" but "how many customers can one bad actor hurt". Each tenant gets a small random subset of backends, so overlap — and therefore blast radius — is limited.',
      topic: 'failure-isolation',
    },
    {
      id: 'fc-lb-15',
      front: 'Name three things load balancing cannot do.',
      back: 'Create capacity when every backend is overloaded, fix a slow shared dependency, or make a stateful backend stateless. And it is itself a component that can fail.',
      topic: 'failure-isolation',
    },
  ],

  quiz: [
    {
      id: 'q-lb-1',
      kind: 'scenario',
      prompt:
        'Ten backends behind a least-connections balancer. One has an exhausted database pool: every request takes 30 seconds and fails. `GET /health` returns 200. What happens to traffic distribution?',
      options: [
        { id: 'a', label: 'The faulty backend receives bursts of disproportionate traffic, because its connections time out together and it then appears to be the idlest machine' },
        { id: 'b', label: 'The balancer routes around it once its connection count rises' },
        { id: 'c', label: 'Traffic stays evenly distributed since the health check passes' },
        { id: 'd', label: 'The faulty backend receives less traffic permanently because it holds connections longer' },
      ],
      correct: ['a'],
      explanation:
        'The connection count oscillates: it climbs as requests accumulate, then falls sharply when they time out together, at which point the backend looks idler than steadily-occupied healthy peers and attracts a burst. The liveness-only health check never intervenes. This is why random-of-two, a readiness check and a short request timeout all matter more than the algorithm choice.',
      difficulty: 'advanced',
      topic: 'algorithms',
    },
    {
      id: 'q-lb-2',
      kind: 'scenario',
      prompt:
        'A gRPC service is deployed behind an L4 network load balancer. After scaling from 3 to 6 backends, the three new instances receive almost no traffic. Why?',
      options: [
        { id: 'a', label: 'L4 routes per connection, and gRPC clients hold long-lived multiplexed connections that were assigned to the original three backends' },
        { id: 'b', label: 'The new instances are failing health checks' },
        { id: 'c', label: 'The balancer needs its algorithm changed to least connections' },
        { id: 'd', label: 'DNS has not propagated to the new instances' },
      ],
      correct: ['a'],
      explanation:
        'An L4 balancer makes one decision when a connection opens. HTTP/2 clients keep that connection and multiplex thousands of requests over it, so nothing is rerouted when the fleet grows. The fixes are an L7 proxy that understands HTTP/2 streams, client-side load balancing, or forcing periodic client reconnection.',
      difficulty: 'advanced',
      topic: 'load-balancing',
    },
    {
      id: 'q-lb-3',
      kind: 'scenario',
      prompt:
        'A readiness check verifies connectivity to the database, the cache and two downstream services. The database becomes slow for 90 seconds. What happens, and what is the fix?',
      options: [
        { id: 'a', label: 'Every backend fails its check and is removed, so the balancer has nowhere to route — a total outage from a partial degradation; fix with a panic threshold and by checking only required dependencies' },
        { id: 'b', label: 'Backends are removed one at a time, degrading gracefully' },
        { id: 'c', label: 'Nothing, because the check has a failure threshold' },
        { id: 'd', label: 'The balancer switches to round robin automatically' },
      ],
      correct: ['a'],
      explanation:
        'A shared dependency fails identically for every backend, so a check that includes it removes the whole fleet simultaneously. Serving errors from a backend is strictly better than serving nothing from the balancer. A panic threshold — ignore health status when more than a configured fraction is unhealthy — is the standard mitigation, alongside checking only what this instance genuinely requires.',
      difficulty: 'advanced',
      topic: 'health-checks',
    },
    {
      id: 'q-lb-4',
      kind: 'single',
      prompt: 'Which algorithm is the best general default, and why?',
      options: [
        { id: 'a', label: 'Random of two choices — most of the benefit of least-loaded with no deterministic winner, so no herding or oscillation' },
        { id: 'b', label: 'Least connections, because it reacts to real load' },
        { id: 'c', label: 'Round robin, because it is simplest' },
        { id: 'd', label: 'Consistent hashing, because it maximises cache hit rates' },
      ],
      correct: ['a'],
      explanation:
        'Random-of-two avoids the failure mode that defeats strict least-loaded: because no backend is ever the guaranteed winner, a momentarily idle-looking machine cannot attract a herd. Round robin is blind to load, least connections prefers broken backends, and consistent hashing is a locality tool that deliberately trades away even distribution.',
      difficulty: 'core',
      topic: 'algorithms',
    },
    {
      id: 'q-lb-5',
      kind: 'scenario',
      prompt:
        'Every deployment produces a brief spike of failed requests. Connection draining is configured with a 5-second timeout. What are the two most likely causes?',
      options: [
        { id: 'a', label: 'The application exits immediately on SIGTERM rather than finishing in-flight work, and/or some requests legitimately take longer than 5 seconds' },
        { id: 'b', label: 'The health check interval is too long' },
        { id: 'c', label: 'The load balancer algorithm needs changing' },
        { id: 'd', label: 'DNS caching is sending traffic to removed instances' },
      ],
      correct: ['a'],
      explanation:
        'Draining requires application cooperation — a server that exits immediately on SIGTERM drops in-flight requests no matter what the balancer does. And a drain timeout shorter than the longest legitimate request kills those requests on every deploy. A third thing to check is whether the orchestrator grace period exceeds the drain timeout, or SIGKILL arrives mid-drain.',
      difficulty: 'core',
      topic: 'draining',
    },
    {
      id: 'q-lb-6',
      kind: 'multi',
      prompt:
        'Which statements about shuffle sharding are correct? Select all that apply.',
      options: [
        { id: 'a', label: 'Each tenant is assigned a small random subset of backends' },
        { id: 'b', label: 'It limits how many other tenants one tenant\'s bad traffic can affect' },
        { id: 'c', label: 'It reduces utilisation, since each tenant can use only part of the fleet' },
        { id: 'd', label: 'It improves load distribution compared with routing every tenant to every backend' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Shuffle sharding optimises blast radius, not distribution — routing every tenant everywhere distributes load better, which is exactly why it lets one tenant hurt everyone. The trade is deliberate: lower utilisation and harder capacity planning in exchange for a bounded number of affected tenants.',
      difficulty: 'advanced',
      topic: 'failure-isolation',
    },
  ],

  exercises: [
    {
      id: 'ex-lb-1',
      kind: 'design',
      title: 'Design the load-balancing tier, then break it',
      estimatedMinutes: 30,
      prompt: `Design the load-balancing tier for a multi-tenant API. Facts:

- 40 backend instances, stateless, behind a shared PostgreSQL primary with read replicas.
- Traffic is HTTPS from browsers and gRPC from mobile SDKs.
- Requests range from 20 ms lookups to 45-second CSV exports.
- 300 tenants; the largest is 30% of traffic.
- Deploys happen roughly ten times a day.

Specify: the layer(s), the algorithm, the health-check design with concrete intervals and thresholds, the drain configuration, and how the balancing tier itself is made resilient.

Then answer four failure questions:

1. One backend's database pool is exhausted. Trace what happens with your design.
2. The database primary becomes slow for two minutes. What does your health check do, and is that right?
3. One tenant starts sending a request pattern that consumes 30 seconds of CPU per request. Who is affected?
4. A deploy ships a version that crashes on startup. What does the fleet look like?`,
      rubric: [
        'Two tiers: L4 for the front and L7 behind it, with gRPC explicitly routed through an HTTP/2-aware L7 proxy.',
        'Random-of-two or least-outstanding-requests, with an explicit rejection of least connections under HTTP/2.',
        'Readiness check that acquires a database connection, with concrete interval, failure and success thresholds and a stated detection time.',
        'A panic threshold, justified by the shared-primary scenario.',
        'Outlier detection alongside active checks.',
        'Drain timeout above 45 seconds, and an orchestrator grace period above that.',
        'Request timeouts and separate handling for the export endpoint.',
        'Balancer resilience: multiple instances, anycast or DNS distribution, no shared mutable state.',
        'Shuffle sharding or per-tenant concurrency limits for the noisy-tenant question.',
        'Failure traces are specific and identify the mechanism, not just the outcome.',
      ],
      modelAnswer: `**Layers: two tiers, and the reason is gRPC**

- **Front tier: L4.** A network load balancer taking all inbound traffic. Cheap, high throughput, terminates nothing, and it is the tier that survives if the L7 tier has problems.
- **Second tier: L7.** HTTP/2-aware proxies terminating TLS and making per-request decisions.

**Why both rather than L7 alone:** the L4 tier gives me a stable entry point that scales with connections rather than requests, and it lets me scale or replace the L7 fleet without touching DNS. **Why not L4 alone:** the mobile SDKs speak gRPC over HTTP/2 — one long-lived multiplexed connection per client. An L4 balancer would make a single routing decision per client and pin thousands of requests to one backend, so a scale-out event would send no traffic to new instances. The L7 tier is what makes per-request routing possible for gRPC, and that is not optional here.

**Algorithm: random-of-two-choices on outstanding requests**

Pick two backends at random, send to whichever has fewer in-flight requests.

*Why not round robin:* request cost spans 20 ms to 45 seconds. Round robin will hand one backend three exports in a row while others idle.

*Why not least connections:* meaningless under HTTP/2, where one connection carries many requests, and it prefers broken backends — a backend failing fast holds few connections and looks idle.

*Why not strict least-outstanding:* deterministic least-loaded herds. Whichever backend momentarily has the fewest in-flight requests receives everything until its count rises, which produces oscillation and, in the presence of a fault, actively targets the sick machine.

*Why random-of-two:* it captures nearly all of the least-loaded benefit and has no guaranteed winner, so neither herding nor oscillation occurs.

**One deliberate addition: exports get their own routing.** A 45-second request and a 20 ms request should not share a backend pool, because a handful of concurrent exports will occupy a backend's workers and its 20 ms requests will queue behind them. I would route \`POST /exports\` to a separate backend pool by path — which is a capability the L7 tier gives me and is a large part of why it is there. This is the bulkhead pattern applied at the balancer.

**Health checks**

\`\`\`
Endpoint:            GET /ready
Interval:            3s
Unhealthy threshold: 2 consecutive failures   → detection in ~6s
Healthy threshold:   3 consecutive successes  → prevents flapping
Timeout:             1s
Panic threshold:     50% of backends unhealthy → ignore health, route to all
\`\`\`

*What \`/ready\` does:* acquires a connection from the primary's pool and runs a trivial query, with a 500 ms budget. This is the key decision — it means an exhausted pool fails the check, which is the exact fault in failure question 1.

*What \`/ready\` deliberately does **not** check:* the read replicas, the object store the exports write to, or any other downstream service. Rationale: those are either non-essential for most traffic or shared by every backend, so including them converts a dependency degradation into a fleet-wide removal. An instance that cannot reach the object store should fail *export* requests, not be removed from serving lookups.

*Asymmetric thresholds are deliberate.* Two failures to eject (fast detection, ~6 seconds) and three successes to re-admit (slow recovery, ~9 seconds). A marginal backend that passes intermittently would otherwise flap in and out of rotation, and each re-admission sends it a burst.

*Plus outlier detection:* eject any backend whose 5xx rate exceeds three times the fleet median over a 30-second window, for 30 seconds, with the ejection duration doubling on repeat. This catches faults nobody wrote a check for — the whole category of "alive, ready, and returning garbage".

*Request timeouts, which matter as much as the checks:* 5 seconds for normal endpoints, 60 for exports. Without these, a stuck backend occupies caller resources for as long as it likes, and that is how one bad backend becomes a fleet-wide problem.

**Draining**

\`\`\`
Drain timeout:                    60s   (> the 45s export)
Orchestrator grace period:        75s   (> drain timeout)
Application SIGTERM behaviour:    stop accepting, finish in-flight, exit
Deregistration delay before drain: 5s   (let in-flight routing settle)
\`\`\`

The 60-second drain is set by the 45-second export, not by taste. A 5-second drain — a common default — would kill exports on all ten daily deploys, and that shows up as a small recurring error spike that teams learn to ignore.

The 75-second grace period must exceed the drain timeout or the orchestrator sends \`SIGKILL\` mid-drain, and every careful thing above achieves nothing.

The application half is non-negotiable: on \`SIGTERM\` it must stop accepting new connections, finish in-flight requests, and then exit. A server that exits immediately drops requests regardless of balancer configuration. **I would test this specifically** — send \`SIGTERM\` during a load test and assert zero failed requests — because it is the part most likely to regress silently.

**Making the balancing tier resilient**

- Multiple L4 nodes announcing the same address, so no single balancer is a point of failure. Cloud network load balancers provide this; self-managed means anycast.
- The L4 tier holds **no shared mutable state**. Routing is a stateless hash of the connection tuple, with any connection table as a local cache rather than the source of truth. This is the Maglev principle: make the stateless computation authoritative so nothing needs coordinating.
- At least 3 L7 proxies across availability zones, health-checked by the L4 tier, each provisioned for full traffic so losing one zone is survivable.
- DNS with a short TTL as the outermost layer, for regional failover.

**Failure question 1 — one backend's database pool is exhausted**

1. \`/ready\` tries to acquire a connection and cannot. The check times out at 1 second and fails.
2. Second consecutive failure ~3 seconds later. The backend is ejected at roughly **6 seconds**.
3. In those 6 seconds, requests routed to it hit the 5-second request timeout and fail. At 1/40th of traffic that is a small, bounded error count.
4. Outlier detection would have caught it too, as a backstop.
5. It is re-admitted only after 3 consecutive successes, so a partially-recovered pool does not immediately take a burst.

**Total impact: about 6 seconds of errors on 2.5% of traffic.** The two decisions that produced that outcome are the readiness check touching the pool and the 5-second request timeout. With a liveness-only check and no timeout, this is the 30-second oscillating failure from the prediction, and it lasts until someone notices.

**Failure question 2 — the primary is slow for two minutes**

*What happens:* \`/ready\` acquires a connection and runs its query, which now takes longer than the 500 ms budget. **Every backend fails the check simultaneously.** The unhealthy count crosses 50% within about 6 seconds and the **panic threshold engages**: the balancer ignores health status and routes to all 40 backends.

*Is that right?* Yes, and it is the most important design decision in this answer. Without the panic threshold, all 40 backends are removed, the balancer has nowhere to route, and a *slow database* becomes a *total outage*. With it, requests reach backends, backends attempt them, and users see slow responses and some timeouts — degraded, not down.

*What I would add:* the check should be tolerant of the difference between slow and unreachable. A 500 ms budget on a trivial query is tight enough that ordinary jitter can trip it, so I would either raise it to 1 second or use a separate, longer timeout for the check than for real queries. **The panic threshold is the safety net, not the design** — relying on it routinely means the check is wrong.

**Failure question 3 — one tenant sends 30-second-CPU requests**

*Who is affected, with my design so far:* **everyone.** Random-of-two spreads that tenant's requests across all 40 backends. Each expensive request occupies a worker for 30 seconds, so within a minute a meaningful fraction of every backend's workers is consumed, and all 300 tenants see queuing.

This is the multi-tenant blast-radius problem, and load balancing does not solve it. Three things do:

1. **Per-tenant concurrency limits at the L7 tier.** Cap each tenant at, say, 50 in-flight requests. The offending tenant is throttled; everyone else is unaffected. This is the highest-value, lowest-complexity fix and I would do it first.
2. **Shuffle sharding.** Assign each tenant 4 of the 40 backends, chosen by hashing the tenant id. The offending tenant degrades only its own 4. Another tenant would need the same 4 out of 91,390 possible combinations to be fully affected. Cost: lower utilisation, and the 30%-of-traffic tenant needs a larger dedicated shard.
3. **CPU and time limits per request**, so a 30-second-CPU request is killed at, say, 10 seconds. This bounds the damage regardless of routing.

*What I would actually do:* per-tenant concurrency limits plus request time limits immediately. Shuffle sharding is the right answer at larger scale, and I would want the largest tenant on a dedicated pool anyway, since at 30% of traffic it is not really a co-tenant.

**Failure question 4 — a deploy ships a version that crashes on startup**

1. New instances start, crash, and never pass \`/ready\`. They are never added to rotation.
2. A rolling deploy replaces old instances with new ones. Each replacement removes a working backend and adds a non-working one.
3. **Whether this is survivable depends entirely on the deploy strategy, not on the load balancer.** With a 25%-at-a-time rolling deploy and a health gate that halts on failure, I lose 25% of capacity and the deploy stops. Without a health gate, I lose all 40 and the service is down.
4. The panic threshold **does not help here** and would actively hurt: crashed instances are not merely failing checks, they are not listening at all, so routing to them yields connection refusals rather than degraded responses.

*What makes this safe:* the deploy pipeline, not the balancer — a health gate that halts the rollout when new instances fail readiness, a maximum-unavailable bound, and automatic rollback. This is worth stating explicitly, because it is the one failure in this set where the load-balancing tier is not the answer, and recognising which failures are outside a component's remit is part of designing it.

**Summary of what actually did the work:** the readiness check touching the connection pool, request timeouts well below the drain timeout, the panic threshold, asymmetric health thresholds, a drain timeout set by the longest real request, per-tenant concurrency limits, and a stateless L4 tier. The algorithm choice — one line of configuration — is the least consequential decision here.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lb-1',
      level: 'basic',
      question: 'What is the difference between an L4 and an L7 load balancer?',
      guidance:
        'L4 sees TCP and decides once per connection; L7 parses HTTP and decides per request, so it can retry, route by path and terminate TLS. A strong answer names the cost — L7 must parse and buffer everything.',
    },
    {
      id: 'iq-lb-2',
      level: 'basic',
      question: 'What load-balancing algorithms do you know, and which would you pick?',
      guidance:
        'Look for random-of-two as the default with a reason, and for the recognition that on a healthy fleet the choice barely matters. An answer that treats the algorithm as the main decision has missed the lesson.',
    },
    {
      id: 'iq-lb-3',
      level: 'intermediate',
      question: 'How would you design a health check?',
      guidance:
        'Readiness rather than liveness, touching only required dependencies, with concrete intervals and asymmetric thresholds. Strong answers add outlier detection and a panic threshold, and explain why checking every dependency is an over-correction.',
    },
    {
      id: 'iq-lb-4',
      level: 'intermediate',
      question: 'A deploy causes a spike of failed requests every time. Where do you look?',
      guidance:
        'Draining: whether the application honours SIGTERM, whether the drain timeout exceeds the longest request, and whether the orchestrator grace period exceeds the drain timeout. All three must line up.',
    },
    {
      id: 'iq-lb-5',
      level: 'advanced',
      question: 'One backend in forty is slow and failing. Why might that cause more than 2.5% of errors?',
      guidance:
        'Least-loaded routing prefers it, and requests to it occupy caller resources for their full timeout, filling upstream connection pools and starving healthy paths. Excellent answers name request timeouts as the bound on the damage.',
    },
    {
      id: 'iq-lb-6',
      level: 'advanced',
      question: 'Your gRPC service scaled out and the new instances get no traffic. Explain and fix.',
      guidance:
        'L4 routes per connection; HTTP/2 clients hold one long-lived multiplexed connection. Fixes: an HTTP/2-aware L7 proxy, client-side balancing, or forcing periodic reconnection. Excellent answers note this also breaks least-connections accounting.',
    },
    {
      id: 'iq-lb-7',
      level: 'followup',
      question: 'You added a panic threshold. When is that the wrong behaviour?',
      guidance:
        'When backends are not listening at all — a bad deploy — since routing to them gives connection refusals rather than degraded responses. A strong answer distinguishes "unhealthy but serving" from "absent", and puts the bad-deploy case on the deploy pipeline rather than the balancer.',
    },
    {
      id: 'iq-lb-8',
      level: 'followup',
      question: 'How does load balancing limit the damage one tenant can do to others?',
      guidance:
        'It does not — spreading traffic evenly is what lets one tenant hurt everyone. Per-tenant concurrency limits and shuffle sharding are the answers, and a strong response frames it as optimising blast radius rather than distribution.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lb-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed a load balancer in the request path. Now remove it: clients discover backends themselves and choose one. What improves, what gets harder, and what would make you choose it?',
      discussion: `Client-side load balancing means each client holds the backend list — from a discovery service — and picks a backend itself. This is how gRPC's built-in balancing and most service meshes' sidecar model work.

**What improves.**

**One fewer network hop.** The request goes client to backend rather than client to balancer to backend. On an internal call between two services in the same datacentre, the balancer hop can be a meaningful fraction of total latency.

**No shared bottleneck.** The balancer is no longer a component that must scale with total traffic, saturate, or fail. Capacity scales with the number of clients automatically.

**Better load information, in principle.** A client knows its own in-flight requests to each backend exactly, with no sampling delay. And per-request routing works naturally over HTTP/2, dissolving the L4 multiplexing problem entirely — because the client makes a fresh decision per request over whichever connection it likes.

**What gets harder, and this is the larger list.**

**Every client needs the backend list, kept current.** That is a discovery system — the subject of the next lesson — and it becomes a critical dependency. A stale list means routing to dead backends; an unavailable discovery service means new clients cannot start.

**Health checking multiplies.** With a central balancer, one component checks 40 backends: 40 checks. With 500 clients each checking 40 backends, that is 20,000 checks, and the check traffic becomes a real load. In practice clients rely on passive detection from their own request outcomes, which is weaker — a client that sends one request per minute learns very little.

**Every client makes decisions with partial information.** A client knows its own load on each backend, not everyone else's. Five hundred clients independently choosing the least-loaded backend will converge on the same one, which is the herding problem the central balancer avoided by having complete information. Random-of-two matters *more* here, not less.

**Policy is now distributed.** Changing the algorithm, adjusting timeouts, or ejecting a backend means updating every client — a deploy across your whole fleet, in whatever languages they are written in. This is exactly the problem service meshes solve by putting the logic in a sidecar the client does not have to be rebuilt to change.

**Consistent behaviour across languages becomes an ongoing cost.** A Go client, a Python client and a Node client must implement the same retry, timeout and ejection semantics. They will not, and the differences will surface as incidents.

**When I would choose it.**

**Internal service-to-service traffic, in a mesh.** The sidecar owns the logic so policy stays centrally managed, and the latency saving on high-volume internal calls is real. This is the mainstream answer and it works because the sidecar gets you client-side routing without distributed policy.

**High-volume gRPC between services you control.** Per-request routing over multiplexed connections is the natural fit, and gRPC's built-in balancing exists precisely for this.

**When I would not.**

**Anything client-facing.** Browsers and mobile apps cannot be trusted with the backend list, cannot be updated on demand, and would need direct network access to backends. A central balancer is not optional at the edge.

**Small fleets.** The operational cost of discovery plus per-client policy exceeds the benefit when a single balancer handles the traffic comfortably.

**The transferable point.** Both designs need the same three things: a current view of who is healthy, a rule for choosing among them, and a way to remove a backend gracefully. Client-side balancing does not remove that work — it distributes it, and distributed work needs a mechanism to keep it consistent. The sidecar is that mechanism, which is why "client-side balancing" in practice almost always means "a mesh", and why the discovery system becomes the thing you actually have to get right.`,
    },
    {
      id: 'al-lb-2',
      kind: 'debug',
      prompt:
        'A service behind an L7 balancer shows p50 latency of 40 ms and p99 of 9 seconds. Backend CPU is 35%, no backend is unhealthy, error rate is 0.1%. The 9-second requests are spread across all endpoints and all backends. Hypotheses?',
      discussion: `Low p50, catastrophic p99, moderate CPU, all endpoints, all backends. The uniformity is the strongest clue: something affecting every backend and every endpoint equally is not a per-backend fault and not a slow endpoint.

**Hypothesis 1 — head-of-line blocking behind expensive requests.** If the fleet handles both 20 ms lookups and 45-second exports on the same workers, a lookup arriving behind two exports waits for a worker. With a bounded worker pool and moderate CPU, this fits perfectly: CPU is low because exports are I/O-bound while occupying workers.

*Why it explains the uniformity:* exports are spread across all backends by the balancer, so every backend has the same problem, and every endpoint queues behind them equally.

*Check:* the distribution of request durations per backend and worker-pool utilisation. If workers are near-saturated while CPU is at 35%, this is it. The fix is a bulkhead — route expensive endpoints to a separate pool.

**Hypothesis 2 — connection-pool contention downstream.** Every backend holds a bounded pool of database connections. If a slow query class occupies them, other requests wait for a connection, not for CPU. Same signature: low CPU, high latency, everything affected.

*Check:* time spent waiting to acquire a connection, as distinct from query execution time. Most pool libraries expose this and it is rarely graphed.

**Hypothesis 3 — retries amplifying under a mild degradation.** If the balancer retries on timeout and the timeout is generous, a mildly slow backend generates retries that add load, making it slower. The 0.1% error rate is consistent with retries mostly succeeding eventually — which is exactly what hides the problem, since the user-visible symptom is latency rather than errors.

*Check:* the ratio of balancer-originated requests to client requests. A ratio meaningfully above 1 means retries are a significant traffic source. Retry budgets — capping retries at a small percentage of traffic — are the fix.

**Hypothesis 4 — garbage collection or another periodic stall.** A pause of several seconds on each backend, staggered across the fleet, produces exactly this: p50 unaffected, p99 terrible, uniform across endpoints, CPU moderate.

*Check:* correlate slow-request timestamps with per-backend GC pause logs. If the 9-second requests cluster in the pauses, this is it.

**Hypothesis 5 — the balancer itself.** An L7 proxy that buffers whole request bodies, or is short of file descriptors or worker threads, adds latency invisible to backend metrics. Backends look fine because they *are* fine.

*Check:* compare the balancer's own request duration against the backend's reported duration. A large gap localises the problem to the proxy — and this is the check people run last despite it being one of the cheapest.

**What I would check first: the gap between balancer-measured and backend-measured duration.** It is one query and it splits the space in half — either the time is being spent in the backend (hypotheses 1–4) or in the proxy and network (hypothesis 5). Diagnosis should always start with the check that eliminates the most possibilities.

**Then, if the time is in the backend:** worker-pool utilisation against CPU. Saturated workers with low CPU points straight at hypothesis 1 or 2, which together are the most likely answers given the symptom profile.

**What the symptom profile rules out.** A single bad backend — the failures would cluster. A slow endpoint — they would cluster by route. A dead dependency — the error rate would be higher. The uniformity is doing real work here, and reading it correctly is most of the diagnosis.

**Transferable:** p99 with a healthy p50 is almost always a queuing problem, and queuing problems are almost always a bounded resource that is not CPU — workers, connections, file descriptors, or a lock. Graph CPU and you will conclude everything is fine. Graph the bounded resource you actually have and the answer appears immediately, which is why "what is the queue for the scarcest resource" is the right first question for any latency-tail investigation.`,
    },
  ],

  revision: {
    bullets: [
      'A load balancer\'s real job is maintaining a correct model of which backends can serve. Incidents are that model being wrong.',
      'L4 sees TCP and decides once per connection; L7 parses HTTP and decides per request.',
      'L4 cannot retry, route by path, or terminate TLS — it cannot tell a failure from data.',
      'Under HTTP/2 or gRPC, L4 pins thousands of requests to one backend, so new instances get no traffic.',
      'On a healthy fleet the algorithm barely matters. Random-of-two-choices is the best default.',
      'Least connections prefers broken backends: a backend failing fast holds few connections and looks idle.',
      'Least connections is also near-meaningless under HTTP/2; count outstanding requests instead.',
      'Consistent hashing trades even distribution for cache locality. A hot key becomes a hot backend.',
      'Liveness asks "is the process up"; readiness asks "can this instance serve now". You almost always want readiness.',
      'A check that verifies every dependency removes the whole fleet when a shared dependency degrades.',
      'A panic threshold — ignore health when most backends are unhealthy — turns that total outage back into degradation.',
      'Run active checks for known conditions and outlier detection for the ones nobody anticipated.',
      'Detection time is interval × failure threshold. Asymmetric thresholds prevent flapping on re-admission.',
      'Draining needs three things: SIGTERM handled, drain timeout above the longest request, grace period above the drain timeout.',
      'Request timeouts bound the damage from a slow backend even when detection fails.',
      'Sticky sessions are a workaround for server-local state, and they make distribution unfixable.',
      'Shuffle sharding optimises blast radius, not distribution — routing everyone everywhere is what lets one tenant hurt all.',
      'Load balancing cannot create capacity, fix a slow shared dependency, or stop being a component that can fail.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A component that maintains a model of which backends are able to serve traffic and distributes requests or connections across that healthy set.',
    whyItExists:
      'To use a fleet of interchangeable backends as one endpoint, so capacity scales horizontally and individual failures are absorbed rather than user-visible.',
    whenToUse: [
      'Any time more than one interchangeable instance serves the same traffic.',
      'L7 for web-facing HTTP, per-request routing, retries and centralised TLS.',
      'L4 as a resilient high-throughput front tier, or for non-HTTP protocols.',
    ],
    whenNotToUse: [
      'To create capacity — an overloaded fleet needs shedding and backpressure, not redistribution.',
      'To compensate for backends holding local state; fix the state instead.',
      'L4 alone in front of gRPC or HTTP/2, where one connection carries all the requests.',
      'Client-facing, in the client-side form — browsers cannot hold the backend list.',
    ],
    alternatives: [
      'Client-side balancing with service discovery, for internal high-volume traffic.',
      'A service mesh sidecar, which is client-side routing with centrally managed policy.',
      'DNS-based distribution, as an outer layer for regional failover.',
      'Anycast, to distribute across balancer nodes without client awareness.',
    ],
    tradeoffs: [
      'L7 buys per-request intelligence and costs latency, CPU, and a tier that scales with requests.',
      'Least-loaded buys responsiveness to real load and costs herding plus a preference for broken backends.',
      'A thorough readiness check buys real fault detection and risks removing the fleet on a shared outage.',
      'Tight check thresholds buy fast detection and risk ejecting healthy backends on a blip.',
      'Shuffle sharding buys a bounded blast radius and costs utilisation.',
    ],
    failureModes: [
      'A liveness-only check keeping a backend with an exhausted pool in rotation.',
      'Least-loaded routing sending bursts to the sickest machine.',
      'A dependency-complete check removing all backends when a shared dependency degrades.',
      'Health-check flapping from a symmetric success threshold.',
      'Requests dropped on every deploy because the application ignores SIGTERM.',
      'A drain timeout shorter than the longest legitimate request.',
      'An orchestrator grace period shorter than the drain timeout, so SIGKILL lands mid-drain.',
      'New gRPC backends receiving no traffic behind an L4 balancer.',
      'One backend\'s slowness filling upstream connection pools and starving healthy paths.',
      'One tenant\'s expensive requests degrading all tenants, because load is spread evenly.',
      'The balancer itself as a single point of failure or an unmonitored latency source.',
    ],
    followUpQuestions: [
      'What does your health check actually touch, and what does it deliberately not touch?',
      'What happens when a dependency every backend shares becomes slow?',
      'How long between a backend dying and it stopping receiving traffic?',
      'What is your longest legitimate request, and is your drain timeout above it?',
      'Does the application finish in-flight requests on SIGTERM? Have you tested that?',
      'Under HTTP/2, what makes new backends receive traffic?',
      'How many tenants can one tenant\'s bad traffic affect?',
      'Is the balancing tier itself redundant, and does its correctness need shared state?',
    ],
  },
});
