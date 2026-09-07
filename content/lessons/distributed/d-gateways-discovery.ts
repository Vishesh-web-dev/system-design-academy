import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-gateways-discovery',
  title: 'Reverse proxies, API gateways, service discovery',
  summary:
    'Three components that all sit between a caller and a service. The design question is never which one to use — it is what belongs at the edge, because everything you centralise there becomes a shared bottleneck and a shared deploy.',
  phase: 'distributed',
  module: 'serving',
  position: 23,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 40,
  tags: ['api-gateway', 'reverse-proxy', 'service-discovery', 'edge', 'coupling'],
  prerequisites: ['d-load-balancing'],
  resources: [
    {
      key: 'nginx-reverse-proxy',
      tier: 'must',
      note: 'The baseline. Read the sections on proxying and on buffering — understanding what a plain reverse proxy already gives you is how you judge whether a gateway is adding anything.',
    },
    {
      key: 'envoy-architecture',
      tier: 'must',
      note: 'Read the listener, filter-chain and cluster model, and the section on dynamic configuration. The filter-chain abstraction is the clearest expression of "the edge is a pipeline of concerns".',
    },
    {
      key: 'consul-service-discovery',
      tier: 'must',
      note: 'A working discovery system with health checking built in. Read it for how registration, health and DNS or API resolution fit together, and for what happens when the discovery layer itself is unavailable.',
    },
    {
      key: 'google-api-design-guide',
      tier: 'good',
      note: 'Useful here for what a public API surface should look like once a gateway lets you shape it independently of your internal services.',
    },
    {
      key: 'google-sre-addressing-cascading',
      tier: 'good',
      note: 'Read it for why a shared component in every request path amplifies failure. This is the strongest argument against putting business logic in a gateway.',
    },
    {
      key: 'martin-fowler-strangler',
      tier: 'advanced',
      note: 'The pattern that a gateway makes practical: route by path to shift traffic from an old system to a new one incrementally. Read it as the best justification for a gateway that exists.',
    },
  ],

  intuition: {
    body: `Three components, and the confusion between them is mostly naming.

**A reverse proxy** accepts requests on behalf of one or more backends and forwards them. That is the whole definition. Terminate TLS, forward, return the response. A load balancer is a reverse proxy that also chooses among backends. Nginx and Envoy are reverse proxies.

**An API gateway** is a reverse proxy with cross-cutting concerns attached. Authentication, rate limiting, request validation, response transformation, routing by path to different services, and a single public surface in front of many internal ones. The mechanism is identical; what differs is how much it does.

**Service discovery** answers a different question entirely: *where is the service I want?* Instances come and go — deploys, autoscaling, failures — so a static list of addresses is wrong within minutes. Discovery is the system that keeps the answer current.

The relationship worth holding: **a proxy needs discovery to know its backends, and a gateway is a proxy with opinions.** They are one layer viewed at three levels of ambition.

Now the part that actually matters. The tempting picture is a gateway as a helpful front door that absorbs every shared concern so services stay simple. That picture is what produces the most common architectural failure in this area, because it ignores three properties of anything in every request path:

**It is a shared bottleneck.** Every request passes through it. Its capacity is your capacity, its latency is added to every call, and its failure is total.

**It is a shared deploy.** Logic in the gateway is deployed on the gateway's schedule. If team A's routing change requires a gateway deploy, and the gateway is shared with teams B through F, then A's small change is now a coordination problem — and a risk to everyone else.

**It attracts logic.** Each individual addition is reasonable. "Just validate this field here." "Just add this header transform." Twenty reasonable additions later the gateway holds business logic that nobody owns, cannot be tested in isolation, and is the riskiest deploy in the company.

So the framing to carry is not "what can a gateway do" but **"what belongs at the edge?"** The answer is narrow: concerns that are genuinely identical for every service, that must be enforced before the request reaches anything trusted, and that would be wrong to reimplement per service. TLS termination, coarse authentication, rate limiting, routing. Everything else belongs in the service that owns it.`,
    analogyLimit:
      'The "front door" analogy is what causes the damage. A front door is passive and cheap; a gateway is a component with capacity limits, a deploy cadence, and an owner. The analogy also hides the coupling: a front door does not make everyone who uses it coordinate their changes, whereas shared gateway logic does exactly that — and that coupling, not latency, is the real cost of over-centralising.',
  },

  deepExplanation: {
    predict: {
      question:
        'A company has an API gateway in front of twelve services. Over two years, teams have added to it: JWT validation, rate limiting, request-schema validation per endpoint, response field-filtering by user plan, a header transform for a legacy client, and a rule that rewrites a deprecated path. What has gone wrong, and which of those six things actually belonged there?',
      answer: `**What has gone wrong: the gateway now contains business logic, and it is the highest-risk deploy in the company.**

Work through the specific consequences.

**Ownership is gone.** The path-rewrite rule was added by whoever needed it in 2024. The response filtering encodes plan rules that belong to the billing domain. Nobody can say who owns any single rule, so nobody deletes anything, so it only grows.

**Testing is impossible in isolation.** Per-endpoint schema validation in the gateway means a service's contract lives in two places: the service's own code and the gateway's config. They will diverge. A service team changes a field, tests pass locally, and the gateway rejects the request in staging — or worse, does not, and the two disagree about what is valid.

**Every change is a coordinated deploy.** A team adding an endpoint must change the gateway to validate it. That deploy affects all twelve services. So either changes queue behind a shared release process, or the gateway is deployed casually and one team's typo takes down everything.

**The blast radius is total.** A bad regex in the path rewrite, an error in the plan-filtering logic, a memory leak in a custom filter — any of these takes down all twelve services simultaneously. The gateway has become a single point of failure holding the least-tested code.

**Which of the six belonged there.**

**JWT validation — yes, but only the coarse part.** Verifying the signature, expiry and issuer is identical for every service, must happen before the request reaches anything trusted, and reimplementing it twelve times invites twelve subtly different bugs. The gateway should validate the token and pass the verified claims onward. What must *not* be at the edge is authorisation — whether this user may access this resource — because that depends on the resource, and only the owning service knows.

**Rate limiting — yes.** Genuinely cross-cutting, and it must happen before the request consumes real resources. Coarse limits at the edge, per-tenant or per-key. Fine-grained per-operation limits belong in the service, because only the service knows which operations are expensive.

**Request-schema validation — no.** This is the service's contract. The service must validate anyway — it cannot trust that every caller came through the gateway — so gateway validation is duplication that will drift. The gateway may enforce coarse limits like maximum body size, which is a resource-protection concern rather than a contract concern.

**Response field-filtering by plan — definitely not.** This is business logic. It encodes billing rules in an infrastructure component, and it requires the gateway to understand the shape of every response. When plans change, an infrastructure deploy is needed.

**Header transform for a legacy client — no, with a caveat.** Client-specific adaptation belongs in a versioning layer or a dedicated adapter, not in the shared path for everyone. The caveat: if this is a genuinely temporary migration measure with a deletion date, a gateway rule is a pragmatic bridge — the failure is that these never get deleted, so it needs an owner and an expiry.

**Deprecated path rewrite — yes, and this is what gateways are genuinely excellent at.** Routing by path is the gateway's native capability, and it enables the strangler pattern: move traffic incrementally from an old implementation to a new one with no client changes. A rewrite that is *routing* is fine. A rewrite that is *transforming the request* is logic.

**The rule that emerges.** Something belongs at the edge if it is (1) identical for every service, (2) must be enforced before reaching anything trusted, and (3) concerns transport or resources rather than domain meaning. All three, not two.`,
    },
  body: `## What belongs at the edge

| Concern | At the edge? | Why |
| --- | --- | --- |
| TLS termination | Yes | Identical everywhere; certificates in one place |
| Coarse authentication (verify the token) | Yes | Identical; must precede trust; reimplementation invites divergent bugs |
| Authorisation (may this user access this resource?) | **No** | Depends on the resource; only the owner knows |
| Rate limiting per tenant or key | Yes | Cross-cutting; must precede resource consumption |
| Per-operation rate limits | No | Only the service knows which operations are expensive |
| Routing by path or header | Yes | The gateway's native capability |
| Request-schema validation | No | The service's contract; it must validate anyway, so this drifts |
| Maximum body size, timeout ceilings | Yes | Resource protection, not contract |
| Response transformation | No | Requires understanding every response's shape |
| Business rules of any kind | No | Unowned, untestable, and a shared deploy |
| Request logging and trace propagation | Yes | Uniform observability at the boundary |
| CORS headers | Yes | Uniform browser-facing policy |
| Retries to backends | Careful | Useful, and an amplifier under load — needs a retry budget |

The pattern in the "no" column: **anything that requires understanding domain meaning.** The edge should reason about transport, identity and resources. The moment it reasons about what a field *means*, it has taken on logic that belongs to a service.

The distinction between authentication and authorisation is the sharpest instance and the one most often blurred. *Authentication* — this token is validly signed and not expired — is uniform and belongs at the edge. *Authorisation* — this user may read document 42 — depends on document 42's ownership, sharing rules and the caller's relationship to it. A gateway that tries to answer it either duplicates the service's model or asks the service anyway, at which point it has added a hop for nothing.

## The gateway's genuinely good use: one surface, many services

The strongest argument for a gateway has nothing to do with cross-cutting concerns. It is that **your public API surface should not be a projection of your internal service boundaries.**

Internally you might have twelve services because twelve teams own twelve domains. Externally, clients want a coherent API. A gateway lets \`/v1/orders\` and \`/v1/orders/{id}/shipments\` come from different services while looking like one API, and lets you split or merge a service without clients noticing.

Three concrete capabilities follow:

**The strangler pattern.** Route 5% of \`/v1/orders\` to a new implementation, watch, increase. No client changes, instant rollback by configuration. This is the most valuable thing a gateway does and it justifies having one on its own.

**Service splitting without client breakage.** A monolithic service becomes two; the gateway routes accordingly; clients see no change.

**Aggregation, with a caveat.** A gateway that fans out to three services and merges the responses saves the client round trips. The caveat: this is composition logic, and if it embeds knowledge of what those responses mean, it is business logic in the gateway. The disciplined version of this is a **backend-for-frontend** — a *separate service* per client type, owned by the client team, that does the aggregation. It gets the round-trip saving without putting client-specific logic in shared infrastructure.

## Service discovery: keeping the answer current

Instances come and go. Discovery answers "where is service X right now", and there are three mechanisms.

**DNS.** A hostname resolves to instance addresses. Universal, requires nothing of the client, and has two real problems: TTL means stale answers, and **many clients and runtimes cache DNS resolutions indefinitely** regardless of TTL, so a removed instance keeps receiving traffic. It also carries no health or metadata.

**A registry with client-side lookup.** Instances register themselves; clients query the registry and cache the result, with the registry pushing updates. Rich — health status, metadata, versions — and it makes the registry a critical dependency.

**A registry with server-side routing.** The proxy queries the registry; clients only know the proxy. Clients stay simple, the proxy centralises the dependency, and this is the mainstream shape: a load balancer or mesh sidecar configured dynamically from a registry.

Two decisions inside any of them:

**Self-registration versus third-party registration.** An instance can register itself on startup and deregister on shutdown — simple, and it fails exactly when the instance crashes without deregistering. Or the platform registers it based on observed state, which is what orchestrators do and why discovery is often already solved for you.

**How stale answers are handled.** This is the part that determines behaviour under failure, and the two policies are opposite:

- **Fail closed:** if the registry is unavailable, refuse to route. Safe and turns a registry outage into a total outage.
- **Fail open:** keep using the last known good list. A dead instance keeps receiving traffic, and the system survives a registry outage.

**Fail open is almost always right**, because the last known list is usually still mostly correct, and health checking will catch the instances that are not. The registry should be a component whose failure degrades rather than stops you — which means clients and proxies must cache aggressively and treat the registry as a source of updates rather than a lookup on the request path.

## The failure mode: a shared component in every path

Anything in every request path amplifies failure, in three ways.

**Capacity.** The gateway's throughput ceiling is the system's ceiling. Sizing it means sizing for aggregate peak across every service, and one service's traffic spike consumes headroom the others needed.

**Latency.** Every millisecond is added to every request. A gateway that parses and buffers full request bodies adds latency proportional to body size — and this is a common default that surprises people.

**Correlated failure.** A gateway bug takes down everything. And because the gateway holds the least-tested code — configuration rules added ad hoc — the probability is not small.

The mitigations:

**Multiple gateway instances, and ideally multiple gateway *fleets*.** Separating public API traffic from internal traffic, or high-value from low-value, bounds a bad configuration change to one fleet.

**Configuration as code, reviewed and deployed like code.** Gateway rules edited in a console are unreviewed production changes.

**Aggressive limits on what can go in.** The most effective control is not technical: a written policy about what may be added to the gateway, enforced in review. Every incident in this section starts with a reasonable-sounding addition.

**Retry budgets.** A gateway retrying failed requests turns a mildly degraded backend into an overloaded one. Cap retries at a small fraction of traffic — the concern the retries-and-timeouts lesson develops fully.

## Where these components are the wrong answer

**A gateway for a single service.** A reverse proxy for TLS and rate limiting is enough. A gateway's value is having many services behind one surface, and with one service there is nothing to unify.

**A gateway as a hiding place for an unclear architecture.** If services need heavy transformation to present a coherent API, the boundaries are wrong. The gateway will paper over it, and the papering becomes permanent.

**Discovery when the platform already provides it.** Most orchestrators give you DNS-based discovery with health-aware endpoints. Running a separate registry alongside adds a critical dependency for capability you already had.

**A mesh for a handful of services.** Service meshes solve real problems — mTLS everywhere, uniform retry and timeout policy, per-service observability — at real operational cost. Below roughly a dozen services the cost dominates.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'edge-layers',
      title: 'What each layer is allowed to know',
      caption:
        'Step through it. Watch what each layer is permitted to reason about: transport, then identity, then resources, then meaning — and meaning only ever inside a service.',
      nodes: [
        { id: 'client', label: 'Client', kind: 'client', x: 0, y: 160, detail: 'Browser, mobile app or partner. Knows one hostname and one API surface, which is the gateway\'s main reason to exist.' },
        { id: 'l4', label: 'L4 balancer', kind: 'service', x: 160, y: 160, detail: 'Reasons about connections only. Spreads them across gateway instances and survives the loss of one. Knows nothing about HTTP.' },
        { id: 'gw', label: 'Gateway', kind: 'service', x: 330, y: 160, detail: 'Terminates TLS, verifies the token signature, applies coarse rate limits, propagates a trace id, routes by path. Reasons about transport, identity and resources — never about meaning.' },
        { id: 'reg', label: 'Registry', kind: 'store', x: 330, y: 30, detail: 'Tells the gateway which instances exist. Consulted out of band and cached — never on the request path, so a registry outage degrades rather than stops routing.' },
        { id: 'orders', label: 'Orders service', kind: 'service', x: 540, y: 80, detail: 'Owns authorisation for orders, its own request validation, and per-operation limits. Cannot trust that a caller came through the gateway, so it validates regardless.' },
        { id: 'ship', label: 'Shipments service', kind: 'service', x: 540, y: 240, detail: 'A separate team and deploy cadence, presented to clients as part of the same API surface. Splitting or merging it changes gateway routing, not clients.' },
        { id: 'bff', label: 'Mobile BFF', kind: 'service', x: 540, y: 380, detail: 'Aggregates several services for one client type, owned by the client team. This is where composition logic goes so it stays out of shared infrastructure.' },
        { id: 'db', label: 'Orders DB', kind: 'store', x: 740, y: 80, detail: 'Only the owning service reaches it. The authorisation rules that decide who may read a row live next to the row, which is why they cannot be hoisted to the edge.' },
      ],
      edges: [
        { id: 'g1', source: 'client', target: 'l4', kind: 'sync' },
        { id: 'g2', source: 'l4', target: 'gw', kind: 'sync' },
        { id: 'g3', source: 'reg', target: 'gw', kind: 'control' },
        { id: 'g4', source: 'gw', target: 'orders', kind: 'sync' },
        { id: 'g5', source: 'gw', target: 'ship', kind: 'sync' },
        { id: 'g6', source: 'gw', target: 'bff', kind: 'sync' },
        { id: 'g7', source: 'bff', target: 'orders', kind: 'sync' },
        { id: 'g8', source: 'orders', target: 'db', kind: 'read' },
      ],
      steps: [
        {
          id: 'e1',
          title: 'The transport layer knows only connections',
          description:
            'An L4 tier spreads connections across gateway instances so no single gateway is a point of failure. It cannot and should not understand the request.',
          nodes: ['client', 'l4'],
          edges: ['g1', 'g2'],
        },
        {
          id: 'e2',
          title: 'The gateway reasons about identity and resources',
          description:
            'TLS termination, token signature verification, coarse per-tenant rate limits, trace propagation, routing by path. Every one of these is identical for all twelve services, which is exactly the test for belonging here.',
          nodes: ['gw'],
          edges: ['g2'],
        },
        {
          id: 'e3',
          title: 'Discovery informs routing, off the request path',
          description:
            'The registry tells the gateway which instances exist, and the gateway caches that. If the registry is unavailable it keeps the last known list — fail open, because a stale list is mostly right and health checks catch the rest.',
          nodes: ['reg', 'gw'],
          edges: ['g3'],
        },
        {
          id: 'e4',
          title: 'Meaning stops at the service boundary',
          description:
            'Whether this user may read this order depends on the order. Only the owning service knows, so authorisation, request validation and per-operation limits live there — and the service validates regardless, since it cannot assume the gateway was used.',
          nodes: ['orders', 'ship', 'db'],
          edges: ['g4', 'g5', 'g8'],
        },
        {
          id: 'e5',
          title: 'Composition gets its own service, not a gateway rule',
          description:
            'Aggregating several services for one client type is real work with real logic. A backend-for-frontend owned by the client team gets the round-trip saving without putting client-specific logic in shared infrastructure.',
          nodes: ['bff'],
          edges: ['g6', 'g7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'edge-test',
      title: 'The three-part test, and what fails it',
      caption:
        'All three conditions, not two. The right-hand column is the list of things that sound edge-appropriate and are not, each because it fails exactly one condition.',
      code: `flowchart TB
    T["Belongs at the edge only if<br/>ALL THREE hold"] --> T1["1. Identical for every service"]
    T --> T2["2. Must precede reaching<br/>anything trusted"]
    T --> T3["3. Concerns transport, identity<br/>or resources — not meaning"]

    T1 --> Y["TLS termination<br/>Token signature verification<br/>Per-tenant rate limits<br/>Routing by path<br/>Trace propagation<br/>Max body size · CORS"]

    T3 --> N1["Authorisation<br/>fails 1 and 3:<br/>depends on the resource"]
    T3 --> N2["Request-schema validation<br/>fails 1 and 2:<br/>the service must validate anyway"]
    T3 --> N3["Response filtering by plan<br/>fails 3:<br/>business logic"]
    T3 --> N4["Per-operation rate limits<br/>fails 1:<br/>only the service knows the cost"]

    style Y fill:#17272a,stroke:#35897e
    style N1 fill:#2a1a1a,stroke:#a04848
    style N2 fill:#2a1a1a,stroke:#a04848
    style N3 fill:#2a1a1a,stroke:#a04848
    style N4 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The strangler pattern is the most instructive production use of a gateway, because it is the case where a gateway earns its cost outright rather than merely centralising concerns.

The situation: a monolith serves \`/orders\`, and a team is building a replacement. The risky approach is a cutover — build the new system, test it, switch, and hope. The failure mode is discovering in production that some behaviour of the old system was load-bearing and undocumented.

With a gateway in the path, the migration becomes incremental:

1. Route 100% of \`/orders\` to the monolith. Nothing has changed; this is just establishing the seam.
2. Build the new service. Route **1%** of read traffic to it. Compare responses against the monolith's for the same requests — shadowing, where the new service receives a copy and its response is compared but discarded.
3. Discrepancies reveal undocumented behaviour. Fix, repeat.
4. Raise reads to 10%, 50%, 100%. Every step is a configuration change with a one-line rollback.
5. Migrate writes last, and one endpoint at a time, because writes cannot be shadowed safely — a shadowed write is a real write.
6. When \`/orders\` is fully served by the new service, delete that path from the monolith.

Three properties make this work, and all three come from the gateway:

**Clients never change.** They call one URL throughout. The migration is invisible, which means it can take months without a client-coordination problem.

**Rollback is a configuration change.** Not a deploy, not a database restore. When something is wrong at 50%, you go back to 10% in seconds. This is what makes the incremental approach *safe* rather than merely gradual.

**Traffic percentage is a dial.** You choose your exposure. A 1% error rate on 1% of traffic is a rounding error you can debug calmly.

**Where it does not apply.** Writes cannot be shadowed, so the write migration is genuinely riskier and needs a different technique — dual writes with reconciliation, or accepting a brief maintenance window per endpoint. And if the old and new systems share a database, "migrating" is an illusion: the coupling is in the data, and the gateway can only move where the code runs.

The transferable idea: **a seam in the request path converts a risky cutover into a series of reversible steps.** That is worth having a gateway for even if you never attach a single cross-cutting concern to it — and it is the argument to lead with when someone asks why a gateway exists.`,
  },

  tradeoffs: {
    intro:
      'Two decisions bundled: how much the edge layer does, and how services find each other. Rows cover both.',
    rows: [
      {
        option: 'Plain reverse proxy (TLS, routing, nothing else)',
        whenItWins:
          'A single service, or several services where clients can address each directly. Minimal latency, minimal coupling, nothing to own.',
        whenItLoses:
          'When cross-cutting concerns would otherwise be reimplemented per service — token verification in six languages is six chances to get it wrong.',
        cost:
          'Each service implements its own authentication, rate limiting and observability.',
      },
      {
        option: 'API gateway with narrow scope',
        whenItWins:
          'Many services behind one public surface. TLS, coarse authentication, per-tenant limits, routing, trace propagation — and the strangler seam.',
        whenItLoses:
          'For a single service, or when it becomes the place logic accumulates because it is the easiest place to put it.',
        cost:
          'A shared bottleneck in every path, a shared deploy, and continuous discipline about what may be added.',
      },
      {
        option: 'API gateway with broad scope (validation, transformation, business rules)',
        whenItWins:
          'Rarely. Occasionally justified for a legacy surface that must be preserved while everything behind it is rebuilt.',
        whenItLoses:
          'Almost always. Unowned logic, contracts in two places that drift, and the riskiest deploy in the company.',
        cost:
          'Correlated failure across every service, and coordination for every change.',
      },
      {
        option: 'Backend-for-frontend per client type',
        whenItWins:
          'When different clients need genuinely different shapes and aggregations. The client team owns it, so composition logic sits with the people who understand the client.',
        whenItLoses:
          'When clients need the same thing, in which case it is a service you maintain for nothing.',
        cost:
          'One more service per client type, and drift between them.',
      },
      {
        option: 'DNS-based discovery',
        whenItWins:
          'Universal, zero client work, and usually already provided by your platform. The right default when the platform gives it to you.',
        whenItLoses:
          'When you need health status or metadata, or when clients cache resolutions indefinitely and keep hitting removed instances.',
        cost:
          'Stale answers bounded by TTL — and, in practice, by client caching behaviour you do not control.',
      },
      {
        option: 'Registry with server-side routing',
        whenItWins:
          'The mainstream shape. Clients know only the proxy; the proxy is configured dynamically from the registry, so no client changes as the fleet moves.',
        whenItLoses:
          'When the extra hop matters, or when running a registry duplicates what the platform already provides.',
        cost:
          'A registry to operate, plus the discipline to cache and fail open.',
      },
      {
        option: 'Service mesh (sidecar per instance)',
        whenItWins:
          'Many services needing uniform mTLS, retry and timeout policy, and per-service observability without per-language libraries.',
        whenItLoses:
          'Below roughly a dozen services, where operational cost and debugging difficulty dominate the benefit.',
        cost:
          'A sidecar per instance, a control plane to run, and an extra layer in every trace.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We put authentication and authorisation in the API gateway so services do not have to worry about it."',
      whyWeak:
        'Authentication belongs there; authorisation does not. Whether a user may read document 42 depends on document 42 — its owner, its sharing rules, the caller\'s relationship to it. A gateway answering that either duplicates the service\'s domain model or calls the service anyway, adding a hop for nothing.',
      strongAnswer:
        '"The gateway verifies the token — signature, expiry, issuer — and passes the verified claims onward, because that check is identical for every service and must happen before the request reaches anything trusted. Authorisation stays in the owning service, because it depends on the resource. And the service still validates the claims itself rather than trusting a header, since it cannot assume every caller came through the gateway."',
    },
    {
      weakAnswer: '"We validate request schemas at the gateway so bad requests never reach services."',
      whyWeak:
        'The service must validate anyway — it cannot assume every caller came through the gateway — so the contract now lives in two places and will drift. A team changes a field, the service accepts it, the gateway rejects it, and the failure appears in staging with no obvious cause.',
      strongAnswer:
        '"Schema validation is the service\'s contract and belongs with the service, which has to validate regardless. At the edge I would enforce resource limits instead — maximum body size, timeout ceilings — which protect infrastructure without encoding anyone\'s contract. If I wanted the contract enforced centrally I would generate the gateway config from the service\'s own schema so there is one source, not two."',
    },
    {
      weakAnswer: '"The gateway aggregates calls to three services so mobile clients make one request."',
      whyWeak:
        'The saving is real; the placement is wrong. Aggregation requires knowing what those responses mean and how to merge them, which is logic. Put it in the shared gateway and it is unowned, untestable in isolation, and deployed on everyone\'s schedule.',
      strongAnswer:
        '"That is a backend-for-frontend, and it should be a separate service owned by the mobile team. It gets the round-trip saving, the composition logic sits with the people who understand the client, and it deploys on the mobile team\'s cadence. The gateway routes to it and stays free of any knowledge about response shapes."',
    },
    {
      weakAnswer: '"Service discovery: instances register with the registry, and clients query it to find them."',
      whyWeak:
        'It omits the two decisions that determine behaviour under failure. If clients query the registry on the request path, a registry outage is a total outage. And if instances self-deregister, a crashed instance never deregisters and stays in the list forever.',
      strongAnswer:
        '"Clients or proxies cache the list and treat the registry as a source of updates rather than a request-path lookup, so a registry outage degrades instead of stopping us — fail open, because a stale list is mostly correct and health checking catches the instances that are not. And registration should be platform-driven rather than self-reported, because a crashed instance cannot deregister itself."',
    },
    {
      weakAnswer: '"We use a service mesh because we have microservices."',
      whyWeak:
        'A mesh solves specific problems — mTLS everywhere, uniform retry and timeout policy, per-service observability without per-language libraries — at substantial operational cost. Adopting it because of an architectural label rather than a problem means paying the cost for benefits you may not need.',
      strongAnswer:
        '"I would ask which of the mesh\'s capabilities we actually need. Below about a dozen services, a shared library for retries and timeouts plus platform-provided discovery covers most of it at a fraction of the cost. A mesh becomes worth it when the per-language library problem is real — several languages needing identical policy — or when mTLS between every pair of services is a requirement."',
    },
    {
      weakAnswer: '"The gateway retries failed requests so transient errors are invisible to clients."',
      whyWeak:
        'Retries at a shared choke point amplify load precisely when backends are struggling. A backend at 50% error rate receiving double traffic from retries goes to 100%. And a retry of a non-idempotent request can duplicate an effect.',
      strongAnswer:
        '"Retries need a budget — cap them at a small percentage of total traffic so a degraded backend cannot be pushed over by retry load — and they must only apply to idempotent requests, which means honouring the method or an idempotency key. I would also add jitter, since synchronised retries produce a load spike rather than a smooth increase."',
    },
  ],

  flashcards: [
    {
      id: 'fc-gw-1',
      front: 'What is the actual difference between a reverse proxy, a load balancer and an API gateway?',
      back: 'Ambition, not mechanism. A reverse proxy forwards; a load balancer also chooses among backends; a gateway also attaches cross-cutting concerns. One layer at three levels.',
      topic: 'api-gateway',
    },
    {
      id: 'fc-gw-2',
      front: 'What is the three-part test for something belonging at the edge?',
      back: 'Identical for every service, must be enforced before reaching anything trusted, and concerns transport, identity or resources rather than domain meaning. All three, not two.',
      topic: 'edge',
    },
    {
      id: 'fc-gw-3',
      front: 'Why does authentication belong at the edge but authorisation not?',
      back: 'Verifying a token is identical everywhere. Deciding whether a user may access a specific resource depends on that resource, which only the owning service knows.',
      topic: 'edge',
    },
    {
      id: 'fc-gw-4',
      front: 'Why is gateway request-schema validation a mistake?',
      back: 'The service must validate anyway, since it cannot assume callers came through the gateway. So the contract lives in two places and drifts.',
      topic: 'edge',
    },
    {
      id: 'fc-gw-5',
      front: 'What are the three costs of anything sitting in every request path?',
      back: 'Its capacity is your ceiling; its latency is added to every call; its failure is correlated across everything behind it.',
      topic: 'coupling',
    },
    {
      id: 'fc-gw-6',
      front: 'Why is shared gateway logic a coupling problem rather than a latency problem?',
      back: 'Logic in the gateway deploys on the gateway\'s schedule, so one team\'s change becomes a coordination problem and a risk for every other team behind it.',
      topic: 'coupling',
    },
    {
      id: 'fc-gw-7',
      front: 'What is the strongest single argument for having a gateway?',
      back: 'A seam in the request path. It lets you route by path to shift traffic incrementally from an old implementation to a new one, with rollback as a configuration change.',
      topic: 'api-gateway',
    },
    {
      id: 'fc-gw-8',
      front: 'Where does aggregation logic belong, and why not the gateway?',
      back: 'A backend-for-frontend, owned by the client team. Aggregation requires knowing what responses mean, which is logic — and in a shared gateway it is unowned and deployed on everyone\'s schedule.',
      topic: 'api-gateway',
    },
    {
      id: 'fc-gw-9',
      front: 'What are DNS discovery\'s two real problems?',
      back: 'Stale answers bounded by TTL, and many clients cache resolutions indefinitely regardless of TTL, so removed instances keep receiving traffic. It also carries no health or metadata.',
      topic: 'service-discovery',
    },
    {
      id: 'fc-gw-10',
      front: 'Fail open or fail closed when the registry is unavailable?',
      back: 'Fail open — keep the last known list. It is usually still mostly correct, health checks catch the rest, and fail-closed turns a registry outage into a total outage.',
      topic: 'service-discovery',
    },
    {
      id: 'fc-gw-11',
      front: 'Why should the registry never be on the request path?',
      back: 'Because then its availability is your availability. Cache the list and treat the registry as a source of updates instead.',
      topic: 'service-discovery',
    },
    {
      id: 'fc-gw-12',
      front: 'Why is self-registration weaker than platform registration?',
      back: 'A crashed instance cannot deregister itself, so it stays in the list until something else notices. Platform-driven registration reflects observed state.',
      topic: 'service-discovery',
    },
    {
      id: 'fc-gw-13',
      front: 'Why do gateway retries need a budget?',
      back: 'Retries at a shared choke point amplify load exactly when backends are struggling. Cap them at a small fraction of traffic, add jitter, and restrict them to idempotent requests.',
      topic: 'coupling',
    },
    {
      id: 'fc-gw-14',
      front: 'When is a service mesh not worth it?',
      back: 'Below roughly a dozen services, where the control plane, sidecars and added debugging difficulty cost more than a shared library plus platform discovery.',
      topic: 'service-discovery',
    },
  ],

  quiz: [
    {
      id: 'q-gw-1',
      kind: 'scenario',
      prompt:
        'A gateway in front of twelve services has accumulated per-endpoint schema validation. A team adds a field to their service, deploys, and requests containing it are rejected with a 400 before reaching the service. What is the structural problem?',
      options: [
        { id: 'a', label: 'The service contract lives in two places — the service and the gateway config — so they drift, and the gateway is not the contract\'s owner' },
        { id: 'b', label: 'The gateway needs a cache invalidation' },
        { id: 'c', label: 'The team should have deployed the gateway first' },
        { id: 'd', label: 'Schema validation should be stricter, not looser' },
      ],
      correct: ['a'],
      explanation:
        'Deploying the gateway first would fix this instance and not the problem: every future contract change requires a coordinated deploy across twelve services. The service must validate regardless since it cannot assume callers used the gateway, so gateway validation is duplication. Resource limits belong at the edge; contracts do not.',
      difficulty: 'core',
      topic: 'edge',
    },
    {
      id: 'q-gw-2',
      kind: 'scenario',
      prompt:
        'A gateway verifies JWTs and injects an `X-User-Id` header. A service trusts that header for authorisation. What is the vulnerability?',
      options: [
        { id: 'a', label: 'Any caller reaching the service directly — internal traffic, a misconfigured network path, a compromised neighbour — can set the header and impersonate any user' },
        { id: 'b', label: 'The header could be cached by the gateway' },
        { id: 'c', label: 'JWT verification should happen in the service instead' },
        { id: 'd', label: 'Nothing, provided the gateway strips inbound copies of the header' },
      ],
      correct: ['a'],
      explanation:
        'The service is trusting a network position rather than a credential. Stripping inbound headers at the gateway is necessary but insufficient — it only protects the gateway path. The service should verify the token itself, or accept a credential it can validate, so security does not depend on every possible route to it being controlled.',
      difficulty: 'advanced',
      topic: 'edge',
    },
    {
      id: 'q-gw-3',
      kind: 'single',
      prompt: 'The service registry becomes unavailable for ten minutes. What should proxies do?',
      options: [
        { id: 'a', label: 'Keep routing with the last known instance list, relying on health checks to catch instances that have gone' },
        { id: 'b', label: 'Refuse to route, since the instance list may be stale' },
        { id: 'c', label: 'Fall back to a hardcoded list of addresses' },
        { id: 'd', label: 'Route to every address ever seen' },
      ],
      correct: ['a'],
      explanation:
        'Fail open. The last known list is usually mostly correct over ten minutes, and health checking removes what has gone. Failing closed converts a registry outage into a total outage, which makes the registry a single point of failure for the whole system — the opposite of what discovery is for.',
      difficulty: 'core',
      topic: 'service-discovery',
    },
    {
      id: 'q-gw-4',
      kind: 'scenario',
      prompt:
        'A team wants to replace a monolith\'s `/orders` endpoints with a new service, with minimal risk. What does a gateway make possible?',
      options: [
        { id: 'a', label: 'Route a small percentage of read traffic to the new service, compare responses, increase gradually, with rollback as a configuration change' },
        { id: 'b', label: 'Run both systems and let clients choose which to call' },
        { id: 'c', label: 'Mirror the database so both systems stay in sync' },
        { id: 'd', label: 'Deploy the new service and switch DNS when ready' },
      ],
      correct: ['a'],
      explanation:
        'The strangler pattern. Clients never change, exposure is a dial, and rollback is configuration rather than a deploy. Letting clients choose pushes the migration onto every client; a DNS switch is a cutover with all its risk; sharing a database means the coupling is in the data and only the location of the code has moved.',
      difficulty: 'core',
      topic: 'api-gateway',
    },
    {
      id: 'q-gw-5',
      kind: 'scenario',
      prompt:
        'A gateway retries any request that returns 5xx, up to three times. One backend degrades to a 40% error rate. What happens to its load?',
      options: [
        { id: 'a', label: 'It rises substantially, because each failure generates retries — pushing a degraded backend toward total failure' },
        { id: 'b', label: 'It falls, because the gateway routes retries to healthy backends' },
        { id: 'c', label: 'It stays the same; retries replace failed requests rather than adding to them' },
        { id: 'd', label: 'It rises only if the retries are not jittered' },
      ],
      correct: ['a'],
      explanation:
        'Retries add traffic on top of the original request, and they arrive exactly when the backend is least able to handle them. Jitter smooths the arrival pattern without reducing volume. The fix is a retry budget capping retries at a small fraction of total traffic, plus restricting retries to idempotent requests.',
      difficulty: 'advanced',
      topic: 'coupling',
    },
    {
      id: 'q-gw-6',
      kind: 'multi',
      prompt:
        'Which of these belong at the edge? Select all that apply.',
      options: [
        { id: 'a', label: 'TLS termination' },
        { id: 'b', label: 'Verifying a token\'s signature and expiry' },
        { id: 'c', label: 'Per-tenant rate limits and maximum body size' },
        { id: 'd', label: 'Deciding whether this user may read this particular document' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are identical for every service, must precede reaching anything trusted, and concern transport, identity or resources. The fourth depends on the document — its owner and sharing rules — so only the owning service can answer it, and a gateway attempting to either duplicates the domain model or calls the service anyway.',
      difficulty: 'core',
      topic: 'edge',
    },
  ],

  exercises: [
    {
      id: 'ex-gw-1',
      kind: 'design',
      title: 'Draw the line, then defend it',
      estimatedMinutes: 25,
      prompt: `Six teams own six services behind one public API. The platform team is designing the edge. For each proposed gateway feature, decide **edge**, **service**, or **separate component**, and give the reason. Then answer the follow-ups.

1. TLS termination and certificate management.
2. JWT signature and expiry verification.
3. Checking that the caller's organisation has an active subscription.
4. Rate limiting: 10,000 requests per hour per API key.
5. Rate limiting: 10 requests per minute on the report-generation endpoint, because each costs 8 seconds of CPU.
6. Rejecting requests whose body exceeds 5 MB.
7. Rejecting requests whose JSON does not match the endpoint's schema.
8. Stripping fields from responses that the caller's plan does not include.
9. Injecting a trace id and logging method, path, status and duration.
10. Combining calls to three services into one response for the mobile app.
11. Rewriting \`/v1/orders\` to \`/v2/orders\` for clients that have not migrated.
12. Retrying 5xx responses.

Follow-ups:

- The gateway becomes a bottleneck at peak. What are your options, in order of preference?
- A service is being rewritten. How does the gateway help, and what are the limits?
- How do services find each other for internal calls, and what happens when the registry is down?`,
      rubric: [
        'Correctly places TLS, token verification, per-key limits, body size, and observability at the edge.',
        'Correctly places subscription checking, per-endpoint limits, schema validation and plan-based filtering in services.',
        'Places mobile aggregation in a separate backend-for-frontend, owned by the client team.',
        'Treats path rewriting as legitimate gateway routing, with a caveat about it being permanent.',
        'Treats retries as edge-appropriate but requiring a budget and idempotency restriction.',
        'Applies the three-part test explicitly rather than answering case by case.',
        'Bottleneck answer prefers scaling out and removing work over sharding gateways.',
        'Rewrite answer describes the strangler pattern and names the shared-database limit.',
        'Discovery answer specifies platform DNS, caching, and fail-open behaviour.',
      ],
      modelAnswer: `**The test I am applying to each item.** Edge only if all three hold: identical for every service; must be enforced before the request reaches anything trusted; concerns transport, identity or resources rather than domain meaning.

**1. TLS termination — EDGE.** All three hold. Certificates in one place, rotation in one place, and no service implements TLS. The clearest case there is.

**2. JWT signature and expiry verification — EDGE.** Identical for all six services, must precede reaching anything trusted, and concerns identity rather than meaning. The gateway verifies and passes the claims on.

**One necessary addition:** the gateway must **strip any inbound copy** of the headers it injects, or a caller can forge them. And — this is the part usually missed — **services must still verify the token themselves rather than trusting an injected header.** Otherwise security depends on every possible network route to the service being controlled, which is an assumption that fails the first time someone adds an internal path. The gateway's verification is defence in depth and a latency saving, not the only check.

**3. Subscription check — SERVICE.** Fails condition 3: whether an organisation has an active subscription is domain state owned by the billing service. Two ways to get it wrong: the gateway calls billing on every request, adding a hop and a hard dependency to every call; or the gateway caches subscription state and now holds stale billing data with no ownership.

The right shape: the token carries a subscription claim, set at token issue by whoever owns subscriptions. The gateway verifies the token, and services read the claim. That moves the check to token-issue time, where it belongs. It also introduces staleness bounded by token lifetime — which is a trade to state explicitly, and if a cancelled subscription must take effect immediately, a short token lifetime or a revocation check is the price.

**4. Per-API-key rate limit, 10,000/hour — EDGE.** All three hold. Identical across services, must happen before resources are consumed, concerns resources rather than meaning. Coarse quota enforcement is exactly what an edge is for.

**5. Per-endpoint limit, 10/minute on reports — SERVICE.** Fails condition 1: only the reports service knows that this endpoint costs 8 seconds of CPU. Encoding it in the gateway means the gateway config must change whenever the endpoint's cost profile changes, and the knowledge lives away from the code that has it.

*Better still,* this is a concurrency limit rather than a rate limit. "10 per minute" is a proxy for "no more than N running at once". A semaphore of, say, 4 concurrent report generations in the service directly expresses the constraint and adapts automatically when the endpoint gets faster. This is worth saying because rate limits are frequently the wrong primitive for expensive operations.

**6. Body size limit, 5 MB — EDGE.** All three hold. It protects infrastructure, is identical everywhere, and must be enforced before the body is buffered — which is the point: rejecting at the edge means the bytes never reach a service. A service that wants a *smaller* limit adds its own; the edge sets the ceiling.

**7. JSON schema validation — SERVICE.** Fails conditions 1 and 2. Each endpoint's schema is specific to it, and the service must validate anyway since it cannot assume the caller came through the gateway. Putting it in both places means two sources of truth that drift, and the drift shows up as a 400 with no obvious cause.

*The compromise I would accept:* generate gateway validation config from the service's own schema definition as a build step, so there is one source and it cannot drift. That gets early rejection without duplication. **I would not hand-write schemas in gateway config**, which is the version that always rots.

**8. Plan-based response filtering — SERVICE.** Fails condition 3 outright. This is business logic: it requires knowing every response's shape and which fields map to which plan tier. In the gateway it is unowned, untestable in isolation, and every plan change becomes an infrastructure deploy.

There is also a correctness argument beyond ownership: filtering at the edge means the service *computed and returned* data the caller was not entitled to, and it travelled over the network before being stripped. The service should not produce it at all.

**9. Trace id and request logging — EDGE.** All three hold. Uniform observability at the boundary, and the trace id must be created at the first point of entry or the trace has no root. This is a case where the edge is the only correct place.

**10. Mobile aggregation — SEPARATE COMPONENT.** A backend-for-frontend, owned by the mobile team.

*Why not the gateway:* combining three responses requires knowing what they mean and how they relate. That is logic, and in a shared gateway it is unowned and deployed on everyone's schedule.

*Why not the mobile client:* the round trips are the problem being solved.

*Why a separate service:* the mobile team owns it and deploys it on their cadence, the logic sits with the people who understand the client, and it can be tested in isolation. The gateway routes \`/mobile/*\` to it and knows nothing about response shapes.

**11. Path rewriting \`/v1\` → \`/v2\` — EDGE.** This is routing, which is the gateway's native capability, and it is genuinely the right place. It lets you version the public surface independently of internal structure.

*The caveat worth stating:* these rules are permanent unless someone owns their removal. A rewrite added for a 2024 migration will still be there in 2028, and it is a rule no current engineer understands. Every such rule needs an owner and a documented expiry, checked periodically.

*The line:* a rewrite that changes *where a request goes* is routing. A rewrite that changes *what the request says* — reshaping a body, renaming fields — is transformation, and that is logic. The first belongs at the edge; the second belongs in a versioning layer inside the service.

**12. Retrying 5xx — EDGE, with two hard conditions.**

Retries are reasonable at the edge — the gateway can see a failure and try another backend, which is the main thing L7 buys you. But:

*Condition 1 — a retry budget.* Cap retries at, say, 10% of total traffic. Without this, a backend at a 40% error rate receives roughly 1.7× its normal load from retries alone, exactly when it is least able to serve it. This is how a degradation becomes an outage.

*Condition 2 — idempotent requests only.* Retrying a \`POST\` that created an order can create two. Retry \`GET\`, \`PUT\` and \`DELETE\` freely; retry \`POST\` only when it carries an idempotency key the service honours.

Plus jitter, so retries do not arrive as a synchronised spike.

**Follow-up 1: the gateway is a bottleneck at peak. Options in order of preference.**

1. **Scale out.** Add instances behind the L4 tier. If the gateway is stateless — and it should be, with rate-limit counters in a shared store — this is a capacity change and nothing more. Try this first because it is cheap and reversible.
2. **Remove work from it.** Profile what it actually spends time on. The usual culprits: buffering full request and response bodies when streaming would do, per-request token verification that could be cached by token, and expensive filters added over time that nobody has measured. **This is frequently the highest-value fix** and it is skipped because scaling out is easier to reason about.
3. **Split by traffic class into separate fleets.** Public API on one, internal on another, high-value tenants on a third. This bounds a bad configuration change or a traffic spike to one fleet, so it buys blast-radius reduction as well as capacity. Worth doing for the isolation even without a capacity problem.
4. **Bypass it for specific paths.** High-volume, low-value traffic — health checks, static assets, telemetry ingestion — routed directly by the L4 tier. Removes load and removes the concerns the gateway provided, so it needs a per-path justification.
5. **Remove the gateway from internal service-to-service calls entirely.** Internal traffic does not need public-facing authentication or quota enforcement, and routing it through the gateway both adds latency and consumes public-traffic capacity. A mesh or direct discovery-based calls is the answer, and this is often where the surprising volume was.

**Follow-up 2: a service is being rewritten. How does the gateway help, and what are the limits?**

*How it helps:* the strangler pattern. Route 1% of read traffic to the new service, shadow the rest to compare responses, raise to 10%, 50%, 100%. Clients never change, exposure is a dial, and rollback is a configuration change rather than a deploy. Migrate writes last and one endpoint at a time.

*Limit 1 — writes cannot be shadowed.* A shadowed write is a real write. The write migration needs dual writes with reconciliation, or an accepted brief window per endpoint. This is the genuinely risky part and the gateway does not de-risk it.

*Limit 2 — a shared database defeats it.* If old and new both write the same tables, "migrating" only moves where the code runs. The coupling is in the data, and the schema is now constrained by two implementations. The gateway can route requests; it cannot decouple data.

*Limit 3 — behavioural comparison is harder than it sounds.* Responses differ in timestamps, ordering, and generated ids. Comparison needs normalisation, and getting that wrong produces either false alarms nobody investigates or false confidence.

**Follow-up 3: internal discovery, and registry failure.**

*Mechanism:* platform-provided DNS. Most orchestrators give a stable name per service resolving to healthy instance addresses, with health awareness built in. **Running a separate registry alongside that adds a critical dependency for a capability we already have**, so I would not, unless we needed metadata the platform does not carry.

*The caveat that bites:* many runtimes cache DNS resolutions indefinitely regardless of TTL. So a removed instance keeps receiving traffic from a client that resolved it once at startup. The fixes are configuring the runtime's DNS cache TTL explicitly — and knowing which of your languages need this, because the defaults differ — or letting a sidecar or client library handle resolution with its own refresh.

*When the registry or DNS is unavailable:* **fail open.** Keep the last known list. Over a ten-minute outage most of those addresses are still valid, and health checking removes the ones that are not. Failing closed makes discovery a single point of failure for everything, which inverts its purpose.

Concretely: cache resolved endpoints with a refresh interval, serve from cache on resolution failure, and alert on prolonged staleness. The registry is a source of updates, never a lookup on the request path.

**The single sentence I would want to leave an interviewer with:** the edge should reason about transport, identity and resources; the moment it reasons about what a field *means*, it has taken on logic that belongs to a service — and that logic will be unowned, undeletable, and deployed on everyone's schedule.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-gw-1',
      level: 'basic',
      question: 'What is the difference between a reverse proxy, a load balancer and an API gateway?',
      guidance:
        'One layer at three levels of ambition: forward, choose a backend, attach cross-cutting concerns. A strong answer notes the mechanism is identical and the distinction is about scope.',
    },
    {
      id: 'iq-gw-2',
      level: 'basic',
      question: 'What would you put in an API gateway?',
      guidance:
        'TLS, token verification, coarse rate limits, routing, trace propagation. Look for a *rule* rather than a list, and for what is deliberately excluded — the exclusions show more understanding than the inclusions.',
    },
    {
      id: 'iq-gw-3',
      level: 'intermediate',
      question: 'Why should authorisation not be in the gateway?',
      guidance:
        'It depends on the resource, which only the owning service knows. A gateway attempting it either duplicates the domain model or calls the service anyway. Strong answers separate authentication from authorisation crisply.',
    },
    {
      id: 'iq-gw-4',
      level: 'intermediate',
      question: 'How does service discovery work, and what happens when the registry is unavailable?',
      guidance:
        'DNS, client-side lookup, or server-side routing from a registry. The important half is fail-open with cached lists, and treating the registry as a source of updates rather than a request-path lookup.',
    },
    {
      id: 'iq-gw-5',
      level: 'advanced',
      question: 'Your gateway has accumulated business logic over two years. What is the actual harm?',
      guidance:
        'Unowned logic, contracts in two places that drift, a shared deploy that couples every team, and correlated failure across all services from the least-tested code. Excellent answers name the coupling as the primary cost, ahead of latency.',
    },
    {
      id: 'iq-gw-6',
      level: 'advanced',
      question: 'How would you migrate an endpoint from a monolith to a new service safely?',
      guidance:
        'The strangler pattern with percentage routing and response shadowing. Excellent answers name the limits: writes cannot be shadowed, and a shared database means the coupling is in the data.',
    },
    {
      id: 'iq-gw-7',
      level: 'followup',
      question: 'The gateway injects an `X-User-Id` header and services trust it. What is wrong?',
      guidance:
        'The service is trusting a network position rather than a credential, so any direct path allows impersonation. Stripping inbound headers is necessary and insufficient — the service should verify the token itself.',
    },
    {
      id: 'iq-gw-8',
      level: 'followup',
      question: 'The gateway is at capacity. What do you do before adding instances?',
      guidance:
        'Measure what it spends time on — body buffering, uncached token verification, accumulated filters. A strong answer also proposes splitting into fleets by traffic class for blast-radius reduction, and removing internal traffic from the public gateway.',
    },
  ],

  activeLearning: [
    {
      id: 'al-gw-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed a central gateway in the request path. Now change one thing: every service instance runs a sidecar proxy that handles the same concerns locally. What genuinely improves, and what does not change at all?',
      discussion: `This is the service-mesh model, and separating its real benefits from its imagined ones is worth doing carefully, because the imagined ones are what drive most adoptions.

**What genuinely improves.**

**Policy without per-language libraries.** Retries, timeouts, circuit breaking and mTLS are implemented once in the sidecar rather than in a Go library, a Python library and a Node library. This is the strongest real benefit, and it grows with the number of languages. With one language, a shared library achieves the same thing at far lower cost.

**Uniform mTLS between every pair of services.** Certificate issuance, rotation and verification handled by the mesh. Doing this by hand across every service is genuinely painful, and it is the second-strongest reason to adopt.

**Per-service observability for free.** Every call in and out passes through a sidecar, so request rates, latencies and error rates per service pair appear without instrumenting anything. Valuable, and partly available from a central gateway too — except the gateway only sees traffic that goes through it, which excludes service-to-service calls.

**No shared bottleneck for internal traffic.** Each sidecar handles only its instance's traffic, so capacity scales with the fleet automatically. The central gateway's "capacity is your ceiling" problem disappears for internal calls.

**Policy changes without service deploys.** Change a timeout across the fleet by updating the control plane. No service redeploys. This is real and it is also the capability that recreates the coupling problem, as below.

**What does not change at all.**

**The question of what belongs where.** Authorisation still depends on the resource. Schema validation is still the service's contract. Business logic in a sidecar filter is exactly as unowned and undeployable-in-isolation as business logic in a gateway. The mesh gives you a new place to put logic that does not belong there, and being distributed does not make it better — it makes it harder to find.

**The need for a public edge.** Browsers and mobile clients cannot participate in a mesh. You still need a gateway at the boundary for TLS, public authentication and quota enforcement. **A mesh replaces internal proxying, not the edge** — a distinction frequently lost in mesh discussions.

**The coupling, relocated.** The control plane is now a shared component. A bad policy push affects every sidecar simultaneously, which is a broader blast radius than a bad gateway deploy, not a narrower one. You traded a shared data plane for a shared control plane.

**Discovery.** Sidecars still need to know where instances are. The mesh usually brings its own registry, so discovery has not gone away — it has become a mesh-internal concern you now have to understand when it breaks.

**What gets worse.**

**Operational surface.** A control plane, a sidecar per instance, certificate lifecycle, and version skew between sidecars and control plane. This is a full-time responsibility.

**Debugging.** A request now traverses two extra proxies. "Where did the 503 come from" has four candidate answers instead of two, and sidecar logs are a distinct thing to learn to read.

**Resource cost.** A sidecar per instance is real memory and CPU, and one or two milliseconds per hop. At a hundred instances that is a hundred sidecars.

**When I would adopt it: several languages needing identical policy, or mTLS everywhere as a requirement.** Those two justify the cost. **When I would not: below about a dozen services, or a single language** — a shared library plus platform discovery gets most of the benefit for a fraction of the operational load.

**The transferable point.** Both models answer "where do cross-cutting concerns live" and neither answers "what counts as cross-cutting". That question is architectural, and no infrastructure choice resolves it. A team that puts business logic in a gateway will put business logic in a sidecar filter — and will find it harder to notice, because it is now in a hundred places.`,
    },
    {
      id: 'al-gw-2',
      kind: 'debug',
      prompt:
        'After a routine gateway deploy, about 3% of requests fail with 503. The failures are concentrated on one of six services, but that service reports no errors and normal latency. The gateway\'s upstream metrics show connection failures to that service. Hypotheses?',
      discussion: `The key detail is that the service reports nothing. It is not failing requests — it is not *receiving* them. So the fault is between the gateway and the service, and the 3% figure and single-service concentration narrow it further.

**Hypothesis 1 — a stale endpoint list from before the deploy.** If the gateway lost its registry connection during the restart and started with a cached or bootstrap list, it may be routing to instances that no longer exist. Connections to a dead address fail immediately, which matches "connection failures" exactly.

*Why one service:* that service deployed recently, so its instance addresses changed while the others did not.

*Check:* compare the gateway's configured endpoints for that service against the registry's current list. This is a direct check and should be first.

**Hypothesis 2 — a connection-pool or keepalive mismatch introduced by the deploy.** If the new gateway version keeps upstream connections alive longer than the service's idle timeout, the service closes a connection the gateway still believes is usable. The next request on it fails immediately. The failure rate would be proportional to how often a request lands on a connection that was closed — a small percentage, matching 3%.

*Why one service:* different services have different idle timeouts, and only one is shorter than the gateway's new keepalive.

*Check:* the service's idle timeout against the gateway's upstream keepalive. If the gateway's is longer, this is it. **This is the hypothesis I would rate highest given "after a deploy" plus "connection failures" plus a low steady percentage** — it produces exactly that signature.

**Hypothesis 3 — the deploy changed protocol negotiation.** If the new gateway version defaults to HTTP/2 upstream and that service only speaks HTTP/1.1, connections fail during negotiation. But this would usually fail 100% of requests to that service rather than 3%, so it fits poorly unless only some instances differ — for example a partially completed service deploy.

*Check:* the gateway's upstream protocol setting for that cluster, and whether the failures cluster on particular instances.

**Hypothesis 4 — file-descriptor or connection-limit exhaustion on the gateway.** A new version with different pooling could exceed a limit, and failures would appear as connection errors. But this would affect all services roughly equally, which contradicts the single-service concentration — so it is a poor fit unless that service receives most of the traffic.

*Check:* gateway file-descriptor usage against its limit, and whether the failure distribution matches traffic distribution.

**Hypothesis 5 — a health-check configuration change ejecting instances intermittently.** If the deploy tightened the health-check timeout, that service's instances might fail checks intermittently, be ejected, and be re-admitted. During ejection the gateway has fewer instances, and if all are ejected it has none — producing 503s. The intermittency matches 3%.

*Check:* the gateway's record of health-check state changes for that cluster. Frequent ejection and re-admission is unmistakable in that log.

**What I would check first: the gateway's configured endpoints for that service against the registry's list.** It is a single comparison, it definitively confirms or eliminates hypothesis 1, and hypothesis 1 is both plausible and the one with the simplest fix.

**Then: the keepalive-versus-idle-timeout comparison**, because it is the hypothesis that best matches the full signature — deploy-triggered, connection-level, low steady percentage, one service — and because this class of mismatch is common and easy to introduce by changing a default.

**The thing this incident should change.** A gateway deploy that can break one service's connectivity while the service reports nothing means the gateway's upstream behaviour is not covered by tests. Concretely: a deploy gate that sends synthetic traffic to every upstream cluster and verifies a 200 before the deploy completes. Per-cluster connection-error alerting also matters — this ran at 3% and was found by someone looking, when it should have paged.

**Transferable:** when a proxy reports failures and the upstream reports nothing, the fault is in the connection between them, and the candidates are always the same small set — stale endpoints, timeout and keepalive mismatches, protocol mismatch, resource limits, health-check flapping. Knowing that list turns an open-ended investigation into five checks.`,
    },
  ],

  revision: {
    bullets: [
      'Reverse proxy, load balancer and gateway are one layer at three levels of ambition, not three mechanisms.',
      'The question is never which to use — it is what belongs at the edge.',
      'Edge test, all three parts: identical for every service; must precede reaching anything trusted; concerns transport, identity or resources rather than meaning.',
      'Authentication belongs at the edge. Authorisation does not — it depends on the resource.',
      'Services must verify credentials themselves rather than trusting an injected header, or security depends on network position.',
      'Schema validation is the service\'s contract; the service validates anyway, so gateway copies drift.',
      'Coarse per-tenant limits at the edge; per-operation limits in the service, which knows the cost.',
      'Response transformation and business rules never belong at the edge.',
      'Anything in every request path is a shared bottleneck, a shared deploy, and a correlated failure.',
      'The real cost of over-centralising is coupling, not latency: gateway logic deploys on the gateway\'s schedule.',
      'The strongest argument for a gateway is a seam — the strangler pattern, with rollback as configuration.',
      'Aggregation belongs in a backend-for-frontend owned by the client team, not in shared infrastructure.',
      'Writes cannot be shadowed, and a shared database means the coupling is in the data.',
      'DNS discovery is universal and has two problems: TTL staleness, and clients that cache resolutions indefinitely.',
      'The registry must never be on the request path — cache the list and treat it as a source of updates.',
      'Fail open when discovery is unavailable: a stale list is mostly right and health checks catch the rest.',
      'Self-registration fails when an instance crashes without deregistering; platform registration reflects observed state.',
      'Gateway retries need a budget, jitter and idempotency, or they push a degraded backend over.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A layer between callers and services that terminates connections, enforces uniform concerns and routes to a current set of instances — plus the discovery system that keeps that set current.',
    whyItExists:
      'So a public API surface is independent of internal service boundaries, so concerns identical to every service are implemented once, and so callers need not track a fleet that changes constantly.',
    whenToUse: [
      'A gateway when many services must present one coherent public surface.',
      'A gateway when you need a seam for incremental migration — the strangler pattern.',
      'A plain reverse proxy when there is one service and you need TLS and routing.',
      'Platform-provided DNS discovery, unless you need metadata it cannot carry.',
    ],
    whenNotToUse: [
      'A gateway for a single service — a reverse proxy is enough.',
      'A gateway as the home for authorisation, schema validation, transformation or business rules.',
      'A gateway to paper over service boundaries that are wrong.',
      'A separate registry when the platform already provides health-aware discovery.',
      'A mesh below roughly a dozen services, or with a single language.',
    ],
    alternatives: [
      'A service mesh, for uniform internal policy across several languages — it replaces internal proxying, not the edge.',
      'A backend-for-frontend per client type, for aggregation and client-specific shaping.',
      'A shared client library, for retries and timeouts when a mesh is too costly.',
      'Direct service-to-service calls with platform discovery, for internal traffic.',
    ],
    tradeoffs: [
      'Centralising a concern buys one implementation and costs a shared bottleneck and a shared deploy.',
      'A gateway buys a migration seam and independent public versioning, and costs latency on every request.',
      'Fail-open discovery buys survival of a registry outage and costs routing to some dead instances.',
      'A mesh buys uniform policy without per-language libraries and costs a control plane, sidecars and debugging depth.',
      'Edge retries buy transient-fault tolerance and cost load amplification without a budget.',
    ],
    failureModes: [
      'Gateway logic accumulating until it is the riskiest deploy and nobody owns any rule.',
      'A contract validated in both gateway and service, drifting silently.',
      'A service trusting an injected identity header, allowing impersonation via any direct path.',
      'The gateway as a single point of failure for every service behind it.',
      'Full body buffering adding latency proportional to payload size.',
      'Retries without a budget pushing a degraded backend into total failure.',
      'A registry on the request path making its outage a total outage.',
      'A crashed instance that never deregistered continuing to receive traffic.',
      'A client runtime caching DNS indefinitely and routing to removed instances.',
      'A path-rewrite rule from a finished migration surviving for years, unowned.',
      'A control-plane policy push breaking every sidecar simultaneously.',
    ],
    followUpQuestions: [
      'Does this concern pass all three parts of the edge test, or only two?',
      'If the gateway were bypassed, would this still be enforced?',
      'Who owns this gateway rule, and when is it deleted?',
      'What is the gateway\'s capacity ceiling, and what does it spend its time on?',
      'What happens to routing when the registry is unavailable?',
      'How does a crashed instance leave the instance list?',
      'Does your runtime honour DNS TTLs, and have you verified it?',
      'Are retries budgeted, jittered, and restricted to idempotent requests?',
    ],
  },
});
