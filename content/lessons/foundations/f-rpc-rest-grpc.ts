import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-rpc-rest-grpc',
  title: 'REST vs RPC vs gRPC vs GraphQL',
  summary:
    'Protocol choice follows the relationship between you and your consumers — how many there are, whether you can change them, and who decides what a response contains.',
  phase: 'foundations',
  module: 'networking',
  position: 6,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 40,
  tags: ['rest', 'rpc', 'grpc', 'graphql', 'api-design', 'coupling'],
  prerequisites: ['f-http-versions'],
  resources: [
    {
      key: 'grpc-core-concepts',
      tier: 'must',
      note: 'Read the four call types (unary, server streaming, client streaming, bidirectional). The streaming modes are the capability that has no clean REST equivalent, and they are why gRPC exists rather than just being faster.',
    },
    {
      key: 'google-api-design-guide',
      tier: 'must',
      note: 'The resource-oriented design chapter. It is the clearest statement of what "REST" means in practice once you stop arguing about hypermedia and start designing an API someone else has to consume.',
    },
    {
      key: 'graphql-best-practices',
      tier: 'must',
      note: 'Read it for what GraphQL makes hard rather than easy — caching, rate limiting and query cost are all named as open problems, which is the honest framing this lesson wants.',
    },
    {
      key: 'protobuf-proto3',
      tier: 'good',
      note: 'How field numbers and optionality give you forward and backward compatibility. This mechanism is the real reason schema-first works, independent of gRPC.',
    },
    {
      key: 'rfc-9110-http-semantics',
      tier: 'good',
      note: 'The definitions of safe, idempotent and cacheable methods. REST inherits these guarantees; RPC over POST discards them, and knowing what you gave up is the point.',
    },
  ],

  intuition: {
    body: `Four styles, and the marketing for each makes the same claim: it is the modern way to build APIs. That framing is useless, because they are not competing for the same job.

Here is the framing that is useful. Ask two questions about your consumers:

**How many are there, and can you change them?**

- **A handful of clients you control** — a mobile app and a web app you ship — means you can change client and server together. Coupling is cheap.
- **Thousands of clients you have never met** — a public API, an SDK, a partner integration — means the contract outlives every implementation of it. Coupling is enormously expensive.

**Who decides what a response contains?**

- **The server decides** — every consumer gets the same shape and takes what it needs. Simple, cacheable, sometimes wasteful.
- **The client decides** — each consumer asks for exactly the fields it wants. Efficient over the wire, and it moves query cost and caching from a solved problem to an unsolved one.

Those two axes place the four styles:

- **REST** — many unknown consumers, server decides. Nouns, HTTP semantics, cacheable, evolvable, verbose.
- **RPC** — few known consumers, server decides. Verbs, whatever transport, minimal ceremony, tightly coupled.
- **gRPC** — few known consumers, server decides, plus a strict schema and streaming. RPC with contracts and code generation.
- **GraphQL** — many varied consumers with differing needs, client decides. One endpoint, one graph, and every HTTP-layer convenience you now have to rebuild.

Notice that "which is fastest" appears nowhere. Serialisation differences are real and almost always dwarfed by round trips, database queries and the model of who has to change when you change something.`,
    analogyLimit:
      'Placing these on two axes is clarifying and slightly too tidy: real systems use several at once, and correctly. A public REST API in front of internal gRPC services with a GraphQL layer for the mobile app is not indecision — each boundary has a different consumer relationship. The axes tell you what to use at a given boundary, not what to standardise on.',
  },

  deepExplanation: {
    predict: {
      question:
        'A service exposes `POST /api/getUserOrders` with a JSON body `{"userId": 42, "status": "open"}`. It works. Name three concrete things this design gives up compared with `GET /users/42/orders?status=open`, and for each say who suffers.',
      answer: `**1. Caching, at every layer.** \`POST\` is not cacheable. A browser will not cache it, a CDN will not cache it, an HTTP proxy will not cache it, and \`ETag\`/\`If-None-Match\` do not apply. With the GET form, a read-heavy endpoint can be served from an edge cache and never reach your origin. *Who suffers:* your origin, which now handles every read, and the user, who pays a full round trip for data that has not changed.

**2. Safe-retry semantics, for every intermediary and client.** \`GET\` is defined as safe and idempotent, so any client library, proxy or service mesh may retry it freely after a timeout. \`POST\` may not be retried automatically, because a POST is allowed to have side effects. So a network blip on a read becomes an error the client must handle rather than a retry that silently succeeds. *Who suffers:* every consumer, who must now write retry logic for a read.

**3. Observability and operability.** Logs, traces, metrics, access controls and rate limits are all commonly keyed on method and path. With everything on \`POST /api/*\`, your dashboards show one endpoint. You cannot see that order lookups are slow, cannot rate-limit reads differently from writes, and cannot write a WAF rule or a routing rule that distinguishes them without parsing bodies. *Who suffers:* you, at 3am.

A fourth worth knowing: **the URL no longer identifies the resource**, so nothing can be linked, bookmarked, or referenced in a bug report.

None of this makes RPC-over-POST wrong. It is the correct choice when the client is one you control, the calls are actions rather than resource reads, and you want no ceremony. What is wrong is choosing it *by accident* and then discovering you cannot cache your read path.`,
    },
    body: `## REST: resources, and the guarantees HTTP already provides

REST in practice means modelling your domain as resources with identifiers, and using HTTP methods with their defined semantics.

\`\`\`
GET    /orders/42          fetch one
GET    /orders?status=open list with a filter
POST   /orders             create
PATCH  /orders/42          partial update
DELETE /orders/42          remove
\`\`\`

What you get for free by following the semantics rather than inventing your own:

- **Caching.** GET is cacheable, so browsers, CDNs and proxies can all participate. Conditional requests make unchanged responses nearly free.
- **Safe retries.** GET, HEAD and PUT are idempotent by definition, so any layer may retry them.
- **Legible operations.** Method plus path is the natural key for logs, metrics, traces, rate limits and routing rules.
- **Something to reference.** A resource has a URL, so it can be linked and cited.

What it costs:

- **Round trips for graphs.** Fetching an order, its customer and its line items is three calls unless you design a composite endpoint — and composite endpoints are the beginning of a slide back towards RPC.
- **Over-fetching.** Every consumer receives the server's shape. A mobile client that wants two fields downloads forty.
- **Awkward verbs.** "Cancel this order" is genuinely not a resource operation. \`POST /orders/42/cancellation\` is a noun invented to satisfy a rule, and \`POST /orders/42:cancel\` is more honest. Pretending everything is CRUD produces worse APIs than admitting some things are actions.

REST is the right default for **public APIs and any consumer you cannot change**, because HTTP's guarantees are the ones every intermediary already understands.

## RPC: call a function, ignore the ceremony

RPC exposes operations directly: \`createOrder\`, \`cancelOrder\`, \`recalculatePricing\`. Usually POST with a JSON body, or a binary protocol.

Its virtue is honesty. Some operations are not resource manipulations, and forcing them into nouns adds a translation step for no benefit.

Its cost is that you have opted out of HTTP's semantics, so everything HTTP gave you is now yours to provide: cacheability, retry safety, per-operation observability, routing.

RPC is right when the clients are few and you control them, and the API is a set of actions rather than a set of things.

## gRPC: RPC with a contract, generated clients, and streaming

gRPC is RPC over HTTP/2 with Protocol Buffers, and three things distinguish it:

**A schema is the source of truth.** A \`.proto\` file defines messages and services, and clients and servers are generated from it. A field mismatch is a compile error rather than a runtime surprise — which is a categorically different feedback loop from JSON.

**Evolution is built into the wire format.** Fields are identified by number rather than name. Adding a field is backward compatible; removing one is safe if the number is reserved and never reused. This mechanism — not the binary encoding — is the real reason schema-first works.

**Streaming is first class.** Four call types: unary, server streaming, client streaming, bidirectional. This is the capability with no clean REST equivalent, and it is why gRPC exists rather than merely being a faster REST.

What it costs:

- **Browsers cannot speak it directly.** They cannot control HTTP/2 frames, so a proxy translation layer (gRPC-Web) is required. That translation loses some streaming modes.
- **Opaque on the wire.** You cannot read a request with \`curl\` or eyeball it in a log. Debugging needs tooling.
- **Not HTTP-cacheable.** Everything is POST-shaped as far as intermediaries are concerned.
- **Code generation in the build.** A real cost across many languages and repositories, and a coordination cost when the schema changes.

gRPC is right for **service-to-service** communication in a system where you own both sides, especially with many services, several languages, or streaming.

## GraphQL: the client decides the response

One endpoint, a typed schema describing a graph, and queries that specify exactly which fields to return.

\`\`\`
query {
  order(id: 42) {
    total
    customer { name }
    items { sku quantity }
  }
}
\`\`\`

One round trip, exactly the requested fields, no over-fetching. For a mobile client on a high-latency link assembling a screen from several resources, that is a genuine and large win — it is the round-trip deletion this curriculum keeps returning to.

What it costs, and these are the parts that get skipped:

**HTTP caching is gone.** Queries are POSTs with bodies, so nothing downstream can cache them. You rebuild caching inside the application: persisted queries to make them GET-able, response caching keyed by query hash, and per-field caching with its own invalidation problem. This is not a small amount of work.

**Query cost is unbounded by default.** A client can request a deeply nested graph that fans out into thousands of database queries. You need depth limits, complexity scoring, and cost-based rate limiting — because request count is no longer a proxy for load. A single request can be a denial of service.

**The N+1 problem is structural.** Resolving \`items\` for each of 50 orders naively issues 50 queries. Batching layers (dataloader patterns) are mandatory rather than optional, and they are a permanent tax on every resolver.

**Observability degrades.** Every request is \`POST /graphql\`. Per-endpoint latency, error rates and rate limits all need to be reimplemented per operation or per field.

**Authorisation moves to the field.** Any field may be requested from any path, so authorisation cannot live at the endpoint. It must be enforced per field, which is more places to get it wrong.

GraphQL is right when you have **many consumers with genuinely different data needs** and the aggregation problem is real — typically several first-party clients over one complex domain. It is a poor fit for a simple CRUD API, and it is a poor fit for a public API unless you are prepared to solve query cost properly.

## Choosing at a boundary

| Boundary | Default | Why |
| --- | --- | --- |
| Public API, unknown consumers | REST | HTTP semantics are the contract everyone already implements |
| Service to service, you own both | gRPC | Schema, generated clients, streaming, cheap evolution |
| Internal service with two callers | RPC over JSON | Least ceremony; upgrade to gRPC when the schema drift starts hurting |
| Mobile or web client assembling screens from one complex domain | GraphQL | Deletes round trips and over-fetching, if you fund the caching and cost work |
| Browser client, simple CRUD | REST | Cacheable, debuggable, no infrastructure |
| Streaming or long-lived bidirectional | gRPC streaming, or WebSockets for browsers | The others have no answer |

Two rules that prevent most bad choices:

**Choose per boundary, not per company.** REST at the edge and gRPC internally is not inconsistency; it is two different consumer relationships.

**Never choose on serialisation speed.** JSON versus Protobuf is single-digit milliseconds on payloads that are already dominated by round trips and database work. If someone's argument for a protocol is parsing throughput, they have picked the smallest term in the budget.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'protocol-axes',
      title: 'Two axes that place all four',
      caption:
        'Select each style and read the consumer relationship it assumes. The axis nobody draws — how expensive is it to change your clients — is the one that actually decides, and it is why REST survives at public boundaries regardless of fashion.',
      nodes: [
        { id: 'rest', label: 'REST', kind: 'service', x: 0, y: 30, detail: 'Many unknown consumers, server decides the shape. Inherits caching, safe retries and per-endpoint observability from HTTP. Costs round trips for graphs and over-fetching.' },
        { id: 'rpc', label: 'RPC / JSON', kind: 'service', x: 220, y: 30, detail: 'Few known consumers, server decides. Least ceremony, honest about actions rather than nouns. Gives up everything HTTP semantics provided.' },
        { id: 'grpc', label: 'gRPC', kind: 'service', x: 440, y: 30, detail: 'Few known consumers, schema is the source of truth, streaming is first class. Field numbers make evolution cheap. Browsers need a translating proxy.' },
        { id: 'gql', label: 'GraphQL', kind: 'service', x: 660, y: 30, detail: 'Many varied consumers, client decides the shape. Deletes round trips and over-fetching, and hands you caching, query cost and per-field authorisation as new problems.' },
        { id: 'public', label: 'Consumers you cannot change', kind: 'client', x: 110, y: 220, detail: 'Partners, third-party developers, shipped mobile versions. The contract outlives every implementation, so evolvability dominates every other consideration.' },
        { id: 'owned', label: 'Consumers you deploy', kind: 'client', x: 440, y: 220, detail: 'Your own services and clients, released together. Coupling is cheap, so you can spend it on schemas, code generation and streaming.' },
        { id: 'varied', label: 'Many clients, different needs', kind: 'client', x: 700, y: 220, detail: 'Several first-party surfaces over one complex domain, each wanting a different slice. The aggregation problem is real and worth paying for.' },
      ],
      edges: [
        { id: 'a1', source: 'public', target: 'rest', label: 'default', kind: 'control' },
        { id: 'a2', source: 'owned', target: 'rpc', kind: 'control' },
        { id: 'a3', source: 'owned', target: 'grpc', label: 'at scale', kind: 'control' },
        { id: 'a4', source: 'varied', target: 'gql', kind: 'control' },
      ],
      steps: [
        {
          id: 'x1',
          title: 'Consumers you cannot change force evolvability first',
          description:
            'A public API contract outlives every version of the code behind it. HTTP semantics are the only contract every intermediary and client library already implements, which is why REST remains the default here no matter what is fashionable internally.',
          nodes: ['public', 'rest'],
          edges: ['a1'],
        },
        {
          id: 'x2',
          title: 'Consumers you deploy make coupling cheap, so spend it',
          description:
            'When client and server ship together, a schema that breaks the build is a feature. Start with plain RPC over JSON for two callers; move to gRPC when schema drift, multiple languages or streaming start costing real time.',
          nodes: ['owned', 'rpc', 'grpc'],
          edges: ['a2', 'a3'],
        },
        {
          id: 'x3',
          title: 'Many clients with different needs is the case for the client deciding',
          description:
            'GraphQL solves a real problem — round trips and over-fetching across a complex graph — and hands back caching, query cost and per-field authorisation. Adopt it when the aggregation pain is measured, not anticipated.',
          nodes: ['varied', 'gql'],
          edges: ['a4'],
        },
        {
          id: 'x4',
          title: 'The answer is usually more than one',
          description:
            'REST at the public edge, gRPC between services, GraphQL for a first-party mobile client is a coherent design, because each boundary has a different consumer relationship. Standardising one protocol everywhere optimises for organisational tidiness rather than for any actual consumer.',
          nodes: ['rest', 'grpc', 'gql'],
          edges: ['a1', 'a3', 'a4'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'graphql-tradeoff',
      title: 'What GraphQL deletes, and what it hands back',
      caption:
        'Read the two columns as a swap rather than an upgrade. The left column is work the HTTP layer was doing for you; the right column is work you now do in application code. Whether the swap is worth it depends entirely on how much the aggregation actually cost.',
      code: `flowchart LR
    subgraph GAIN["Deleted"]
      G1[Multiple round trips<br/>to assemble a screen]
      G2[Over-fetching:<br/>40 fields to use 2]
      G3[Endpoint proliferation<br/>per client need]
    end

    subgraph API["GraphQL: one endpoint,<br/>client picks the shape"]
      A1[POST /graphql]
    end

    subgraph COST["Handed back to you"]
      C1[HTTP caching — rebuild with<br/>persisted queries and hashes]
      C2[Query cost limits — depth,<br/>complexity, cost-based rate limits]
      C3["N+1 resolution — batching<br/>is mandatory, not optional"]
      C4[Per-operation observability<br/>and per-field authorisation]
    end

    G1 --> A1
    G2 --> A1
    G3 --> A1
    A1 --> C1
    A1 --> C2
    A1 --> C3
    A1 --> C4

    style GAIN fill:#17272a,stroke:#35897e
    style COST fill:#2a1d1d,stroke:#b8383b`,
    },
  ],

  productionExample: {
    systems: ['Google Cloud APIs'],
    body: `Google's public API design guide is a useful production example precisely because it describes a system that had to solve this problem at both boundaries simultaneously, and did not pick one answer.

Internally, Google's services communicate with gRPC over Protocol Buffers. The consumers are services the company deploys, so a schema that breaks the build is a benefit rather than a coupling problem, and streaming is available where it is needed.

Externally, the same services are exposed as REST APIs, because the consumers are developers and organisations Google cannot change. Those consumers have existing HTTP tooling, existing caching infrastructure, and existing retry libraries that understand method semantics.

The mechanism connecting them is worth studying: the \`.proto\` definitions carry annotations describing how each RPC maps onto an HTTP method and path, and a gateway performs the translation. One service definition, two boundaries, generated rather than hand-written translation.

Two design decisions in the guide are worth extracting:

**Custom methods are permitted, with a distinct syntax.** The guide accepts that not everything is CRUD and specifies \`POST /v1/orders/42:cancel\` for genuine actions, rather than requiring an invented noun. This is more honest than either extreme — forcing everything into resources produces contorted APIs, and abandoning resources entirely gives up HTTP's guarantees.

**Errors are a standard structure, not per-endpoint invention.** A defined error model with a stable status enumeration means every client library can handle failures uniformly. On a public API, error format is part of the contract and changing it is a breaking change, so it is worth specifying once.

The transferable lesson: **the internal and external protocol decisions are independent, and trying to make one answer serve both is where designs go wrong.** Exposing gRPC publicly forces every consumer to adopt your toolchain. Using REST internally gives up schemas and streaming between services that would benefit from both. A translation layer at the boundary costs a gateway and buys the right answer on each side — and generating that translation from the same definition keeps them from drifting.`,
  },

  tradeoffs: {
    intro:
      'Choose per boundary. The rows are ordered from most evolvable to most tightly coupled, and evolvability is what public consumers need most.',
    rows: [
      {
        option: 'REST over JSON',
        whenItWins:
          'Public APIs and any consumer you cannot redeploy. Caching, safe retries and per-endpoint observability come from HTTP rather than from your code.',
        whenItLoses:
          'Graph-shaped reads needing several round trips, and clients that want a small subset of a large response.',
        cost:
          'Over-fetching, round trips for related resources, and awkward modelling for operations that are genuinely actions.',
      },
      {
        option: 'RPC over JSON and POST',
        whenItWins:
          'Two or three internal callers you deploy, where the API is a set of actions and ceremony is not worth paying for.',
        whenItLoses:
          'Read-heavy paths that would benefit from caching, and any consumer you cannot change when the shape changes.',
        cost:
          'No HTTP caching, no automatic retry safety, one endpoint in every dashboard, and no schema so drift is found at runtime.',
      },
      {
        option: 'gRPC',
        whenItWins:
          'Service-to-service at scale, several languages, or streaming. The schema breaks the build instead of production, and field numbers make evolution cheap.',
        whenItLoses:
          'Browser clients, which need a translating proxy, and any situation where readability on the wire matters more than contracts.',
        cost:
          'Code generation in every build, opaque payloads, no HTTP-layer caching, and a proxy at the browser boundary.',
      },
      {
        option: 'GraphQL',
        whenItWins:
          'Several first-party clients with genuinely different needs over one complex domain, where round trips and over-fetching are measured costs.',
        whenItLoses:
          'Simple CRUD, and public APIs where unbounded query cost becomes an availability problem you have handed to strangers.',
        cost:
          'Rebuilding caching, query-cost limiting, batching for N+1, per-operation observability and per-field authorisation.',
      },
      {
        option: 'Do less: one composite REST endpoint per client screen',
        whenItWins:
          'When the only real problem is round trips for a handful of known screens. Deletes the round trips without adopting a query language.',
        whenItLoses:
          'When client needs multiply — you end up maintaining an endpoint per screen per client, which is the pain GraphQL exists to remove.',
        cost:
          'Endpoint proliferation, per-user uncacheable responses, and partial-failure semantics to define.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We use REST" — describing an API that is entirely `POST /api/doThing` with JSON bodies.',
      whyWeak:
        'That is RPC with REST\'s vocabulary borrowed. Nothing is wrong with RPC, but calling it REST means the team believes it has HTTP\'s guarantees when it has opted out of all of them: no caching, no safe retries for reads, and one endpoint in every log and dashboard.',
      strongAnswer:
        '"It is RPC over HTTP, which is a reasonable choice for internal callers we deploy. What it costs is that reads are not cacheable and intermediaries cannot retry them safely, and every operation looks identical in our metrics. If we wanted those back for the read path I would model those reads as GETs on resources."',
    },
    {
      weakAnswer: '"gRPC is faster because Protobuf is more efficient than JSON."',
      whyWeak:
        'Serialisation is usually the smallest term in the budget — single-digit milliseconds against round trips and database work measured in tens or hundreds. Choosing a protocol on parsing throughput optimises a term nobody was blocked on, and it misses the actual reasons to pick gRPC.',
      strongAnswer:
        '"The wire efficiency is real and rarely the point. I would choose gRPC for the schema and generated clients — a field mismatch becomes a compile error — and for streaming, which has no clean REST equivalent. If the bottleneck were serialisation I would want to see that measured first, because it usually is not."',
    },
    {
      weakAnswer: '"GraphQL means we only need one endpoint and clients get exactly what they want."',
      whyWeak:
        'Both halves are true and the sentence omits the swap. One endpoint means one entry in every dashboard, one rate limit, and no HTTP caching. Clients choosing the shape means query cost is unbounded, N+1 resolution is structural, and authorisation moves to every field.',
      strongAnswer:
        '"It removes round trips and over-fetching, which for our mobile client is a measured win. In exchange I own caching — probably persisted queries so they can be GETs — query depth and complexity limits, batching in every resolver, per-operation metrics, and field-level authorisation. I would adopt it if the aggregation pain is real, and not for a CRUD surface."',
    },
    {
      weakAnswer: '"We should standardise on one protocol across the whole company."',
      whyWeak:
        'It optimises for organisational tidiness rather than for any consumer. Public consumers need HTTP\'s evolvability; internal services benefit from schemas and streaming; a mobile client may need aggregation. One protocol at every boundary means at least one boundary is served badly.',
      strongAnswer:
        '"I would standardise per boundary. REST at the public edge because the contract outlives our code and consumers already have HTTP tooling. gRPC between services because we deploy both sides and want the schema to break the build. If a client genuinely needs aggregation we can add a GraphQL layer over the same services — the boundaries have different consumer relationships and should have different answers."',
    },
    {
      weakAnswer: '"Everything must be a resource, so cancelling an order is `POST /orders/42/cancellations`."',
      whyWeak:
        'It invents a noun to satisfy a rule. Nobody is manipulating a cancellation resource; they are performing an action. The contortion makes the API harder to understand and does not deliver anything HTTP\'s semantics would have given you, because it is a POST either way.',
      strongAnswer:
        '"Most of the API is resource-oriented, and for genuine actions I would use an explicit custom method — `POST /orders/42:cancel` — which is what Google\'s API design guide recommends. It is honest about being an action, keeps the resource in the path so observability and authorisation still key on it, and avoids inventing a noun that models nothing."',
    },
  ],

  flashcards: [
    {
      id: 'fc-proto-1',
      front: 'What two questions about consumers decide protocol choice?',
      back: 'How many are there and can you change them (which sets how expensive coupling is), and who decides the response shape — server or client.',
      topic: 'api-design',
    },
    {
      id: 'fc-proto-2',
      front: 'Name three things RPC over POST gives up compared with GET on a resource.',
      back: 'HTTP caching at every layer, safe automatic retries by intermediaries and client libraries, and per-endpoint observability, rate limiting and routing.',
      topic: 'rpc',
    },
    {
      id: 'fc-proto-3',
      front: 'What is the real reason schema-first works in gRPC?',
      back: 'Field numbers rather than names identify fields on the wire, so adding a field is backward compatible and removing one is safe if the number is reserved. The binary encoding is a side benefit.',
      topic: 'grpc',
    },
    {
      id: 'fc-proto-4',
      front: 'What capability does gRPC have that has no clean REST equivalent?',
      back: 'Streaming — server, client and bidirectional — as a first-class call type rather than something layered on top.',
      topic: 'grpc',
    },
    {
      id: 'fc-proto-5',
      front: 'Why can browsers not speak gRPC directly?',
      back: 'They cannot control HTTP/2 frames from JavaScript, so a translating proxy (gRPC-Web) is required, and some streaming modes are lost in translation.',
      topic: 'grpc',
    },
    {
      id: 'fc-proto-6',
      front: 'What does GraphQL delete, and what does it hand back?',
      back: 'Deletes round trips, over-fetching and endpoint proliferation. Hands back HTTP caching, query cost limiting, N+1 batching, per-operation observability and per-field authorisation.',
      topic: 'graphql',
    },
    {
      id: 'fc-proto-7',
      front: 'Why is request count not a proxy for load in GraphQL?',
      back: 'One query can request a deeply nested graph that fans out into thousands of database queries, so a single request can be a denial of service. Cost must be scored, not counted.',
      topic: 'graphql',
    },
    {
      id: 'fc-proto-8',
      front: 'Why does authorisation move to the field in GraphQL?',
      back: 'Any field can be reached from any query path, so endpoint-level authorisation cannot express the rules. Each field must enforce its own, which is more places to be wrong.',
      topic: 'graphql',
    },
    {
      id: 'fc-proto-9',
      front: 'What is the honest way to model a genuine action in a REST API?',
      back: 'An explicit custom method such as `POST /orders/42:cancel`, rather than inventing a noun like `/cancellations` that models nothing.',
      topic: 'rest',
    },
    {
      id: 'fc-proto-10',
      front: 'Why is "Protobuf is faster than JSON" a weak reason to choose gRPC?',
      back: 'Serialisation is single-digit milliseconds against round trips and database work measured in tens or hundreds. The real reasons are schemas, generated clients, cheap evolution and streaming.',
      topic: 'coupling',
    },
    {
      id: 'fc-proto-11',
      front: 'Why is using several protocols across a system usually correct?',
      back: 'Each boundary has a different consumer relationship. Public consumers need HTTP evolvability; services you deploy benefit from schemas and streaming; some clients need aggregation. One protocol everywhere serves at least one boundary badly.',
      topic: 'coupling',
    },
  ],

  quiz: [
    {
      id: 'q-proto-1',
      kind: 'scenario',
      prompt:
        'A read-heavy product catalogue API is exposed as `POST /api/searchProducts` with a JSON filter body. Origin load is high and a CDN is already in place but caches nothing. What is the single highest-leverage change?',
      options: [
        { id: 'a', label: 'Model the read as a GET with query parameters so the CDN and conditional requests can work' },
        { id: 'b', label: 'Switch the payload from JSON to Protocol Buffers to reduce bytes' },
        { id: 'c', label: 'Add a GraphQL layer so clients fetch fewer fields' },
        { id: 'd', label: 'Increase the origin instance count' },
      ],
      correct: ['a'],
      explanation:
        'POST is not cacheable, so the CDN is structurally unable to help — the request shape is the bug. Converting the read to a GET with parameters in the URL lets the edge serve repeat queries and lets ETags make unchanged responses tiny. Protobuf reduces bytes on requests that still all reach the origin, and scaling instances treats the symptom.',
      difficulty: 'core',
      topic: 'rest',
    },
    {
      id: 'q-proto-2',
      kind: 'scenario',
      prompt:
        'A GraphQL API is public. One partner sends a query nesting friends-of-friends-of-friends and the database saturates. Rate limiting by requests per minute did not prevent it. Why not, and what would?',
      options: [
        { id: 'a', label: 'One request can fan out into thousands of queries — you need depth limits and complexity-based cost accounting, not request counting' },
        { id: 'b', label: 'The rate limiter was misconfigured and should be set lower' },
        { id: 'c', label: 'Persisted queries would have prevented the fan-out' },
        { id: 'd', label: 'The database needs a read replica' },
      ],
      correct: ['a'],
      explanation:
        'In GraphQL, request count is not proportional to work, so counting requests cannot bound load. The controls are maximum query depth, a complexity score computed before execution, and rate limits denominated in cost units. Persisted queries help by restricting clients to an approved set — a good idea, but the direct fix is cost accounting.',
      difficulty: 'advanced',
      topic: 'graphql',
    },
    {
      id: 'q-proto-3',
      kind: 'single',
      prompt: 'Which is the strongest reason to choose gRPC for service-to-service calls?',
      options: [
        { id: 'a', label: 'A shared schema turns field mismatches into compile errors, and streaming is first class' },
        { id: 'b', label: 'Protocol Buffers parse faster than JSON' },
        { id: 'c', label: 'HTTP/2 multiplexing reduces latency inside a datacentre' },
        { id: 'd', label: 'It works in browsers without a proxy' },
      ],
      correct: ['a'],
      explanation:
        'Contracts and streaming are the substantive reasons. Parsing speed is a small term; multiplexing buys little at sub-millisecond RTT for request/response traffic; and browsers explicitly cannot speak gRPC without a translating proxy.',
      difficulty: 'intro',
      topic: 'grpc',
    },
    {
      id: 'q-proto-4',
      kind: 'scenario',
      prompt:
        'A team runs gRPC internally and wants to expose the same functionality to third-party developers. What is the best approach?',
      options: [
        { id: 'a', label: 'Add a REST gateway generated from the same service definitions, so both boundaries stay in sync' },
        { id: 'b', label: 'Publish the .proto files and require partners to use gRPC' },
        { id: 'c', label: 'Rewrite the internal services as REST and drop gRPC' },
        { id: 'd', label: 'Expose a GraphQL endpoint instead' },
      ],
      correct: ['a'],
      explanation:
        'The two boundaries have different consumer relationships, so they deserve different answers. Requiring partners to adopt your toolchain makes integration expensive and constrains them. Rewriting internally gives up schemas and streaming for no external benefit. Generating the translation from the same definitions is what stops the two from drifting.',
      difficulty: 'core',
      topic: 'coupling',
    },
    {
      id: 'q-proto-5',
      kind: 'scenario',
      prompt:
        'A mobile app makes 7 REST calls to render its home screen, over a 180 ms link. The team proposes GraphQL. What should you establish first?',
      options: [
        { id: 'a', label: 'Whether one composite endpoint would solve it, since the problem is 7 round trips on a small number of known screens' },
        { id: 'b', label: 'Whether the backend team knows GraphQL' },
        { id: 'c', label: 'Whether the payloads are large enough to justify Protobuf' },
        { id: 'd', label: 'Whether the mobile app can be updated frequently' },
      ],
      correct: ['a'],
      explanation:
        'The measured problem is round trips on a handful of known screens, and a composite endpoint deletes them without adopting a query language and its caching, cost-limiting and batching obligations. GraphQL earns its cost when client needs multiply enough that endpoint-per-screen becomes the pain — so establish whether that is the trajectory before paying for it.',
      difficulty: 'advanced',
      topic: 'api-design',
    },
    {
      id: 'q-proto-6',
      kind: 'multi',
      prompt:
        'Which of these do you inherit from HTTP by using GET on a resource, and lose by using POST for the same read? Select all that apply.',
      options: [
        { id: 'a', label: 'CDN and browser caching' },
        { id: 'b', label: 'Automatic retry safety in client libraries and proxies' },
        { id: 'c', label: 'Per-endpoint metrics, rate limits and routing keyed on method and path' },
        { id: 'd', label: 'Automatic request body validation' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are genuine inherited guarantees, and they are exactly what an RPC-over-POST read path gives up. Body validation is not an HTTP feature in either case — that is your schema layer\'s job regardless of method.',
      difficulty: 'core',
      topic: 'rest',
    },
  ],

  exercises: [
    {
      id: 'ex-proto-1',
      kind: 'design',
      title: 'Pick a protocol at every boundary',
      estimatedMinutes: 20,
      prompt: `A logistics company has these boundaries:

1. **Partner API** — 400 shipping companies integrate to submit and track shipments. Integrations take months and are maintained by the partners' own teams.
2. **Warehouse scanners** — 12,000 handheld devices, firmware updated quarterly, submitting scan events and receiving pick instructions. Warehouse WiFi is unreliable.
3. **Internal services** — 40 services in three languages (Java, Go, TypeScript), all deployed by the same platform team.
4. **Ops dashboard** — one internal web app showing a complex view: shipments, routes, vehicles, drivers, exceptions. Product changes the view weekly.
5. **Public tracking page** — one page, shows the status of one shipment by tracking number. Very high traffic, mostly repeat lookups of the same numbers.

For each: choose a protocol, name the deciding property of the consumer relationship, and state the main cost you are accepting. Then identify the one boundary where you would most likely be wrong, and what evidence would change your mind.`,
      rubric: [
        'Partner API: REST, decided by consumers you cannot change and integrations that outlive your code; accepts over-fetching and round trips.',
        'Scanners: recognises unreliable connectivity as the deciding property — needs offline queueing and idempotent submission, not just a protocol choice.',
        'Internal services: gRPC, decided by owning both sides plus three languages; accepts code generation in every build.',
        'Ops dashboard: GraphQL is defensible, decided by a complex view changing weekly against one owned client; accepts caching, cost limiting and batching work.',
        'Public tracking page: REST with GET, decided by cacheability — high-volume repeat lookups belong at the edge.',
        'Names a specific cost for each choice rather than only the benefit.',
        'Identifies the ops dashboard as the most likely wrong call, since one client and weekly changes may be better served by composite endpoints, and states what evidence would decide.',
      ],
      modelAnswer: `**1. Partner API — REST over JSON**

*Deciding property:* 400 consumers whose integration effort is measured in months and whose code you cannot touch. The contract will outlive several rewrites of your implementation.
*Cost accepted:* over-fetching and multiple round trips for related resources. Partners will also ask for fields you do not want to commit to, and every addition is permanent.
*What makes REST right here specifically:* partners already have HTTP clients, retry libraries, and monitoring that understand method semantics. Requiring gRPC would add a toolchain dependency to a months-long integration, and requiring GraphQL would hand unbounded query cost to 400 organisations.

**2. Warehouse scanners — the protocol is the smaller half**

*Deciding property:* unreliable connectivity. The device must accept a scan, hold it, and submit it whenever the network returns.
*Design:* a small REST surface, but the substance is on the device — a durable local queue, a client-generated idempotency key per scan, and submission with jittered backoff. Server-side, submission must be idempotent so a retry after an ambiguous timeout cannot double-count a scan.
*For pick instructions arriving at the device:* long polling or SSE, not WebSockets. Firmware updates quarterly, so anything complex is expensive to fix, and SSE's automatic resumption with a cursor is exactly what an intermittently connected device needs.
*Cost accepted:* the device holds state and can be behind; the server must tolerate scans arriving out of order and late.
*Why this is the interesting boundary:* naming the protocol without naming idempotency and offline queueing would be answering the wrong question.

**3. Internal services — gRPC**

*Deciding property:* both sides deployed by one team, three languages, 40 services. Schema drift across language boundaries found at runtime is exactly the failure gRPC removes.
*Cost accepted:* protobuf generation in every build pipeline, opaque payloads that need tooling to debug, no HTTP-layer caching, and a coordination cost whenever a shared message changes.
*Note:* if this were 4 services rather than 40, I would start with JSON over HTTP and move when the drift started costing real time. 40 services in 3 languages is comfortably past that point.

**4. Ops dashboard — GraphQL, tentatively**

*Deciding property:* a complex, deeply related view that product changes weekly, against a single client that ships continuously. Client-decides-the-shape means the backend stops being on the critical path for every view change.
*Cost accepted:* no HTTP caching (mitigated by low traffic — it is one internal app), batching in every resolver, and per-field authorisation. Query cost limiting matters less here than on a public API because the consumer is internal and identifiable, but I would still cap depth to prevent an accidental catastrophe.
*Why the traffic profile matters:* GraphQL's worst costs are caching and query cost, and both are cheap to accept when the client is one internal app with modest volume. This is the boundary where GraphQL's downsides are smallest.

**5. Public tracking page — REST, GET, aggressively cacheable**

*Deciding property:* very high volume, repeat lookups of the same tracking numbers, one tiny response shape.
*Design:* \`GET /track/{number}\` with a short \`Cache-Control\` max-age and an \`ETag\`. Most requests are served at the edge and never reach the origin.
*Cost accepted:* status can be up to the TTL stale. For parcel tracking, 30–60 seconds of staleness is invisible to users and buys an enormous reduction in origin load.
*Why not GraphQL:* the response shape is fixed and tiny, so there is nothing to select — and it would make the highest-volume endpoint in the company uncacheable.

**Where I would most likely be wrong: the ops dashboard.**

The case against GraphQL there: it is *one* client. The pain GraphQL solves is many clients with divergent needs, and with a single consumer, three or four composite endpoints tailored to the dashboard's views would deliver the same round-trip and over-fetching benefit for a fraction of the machinery — no resolver batching, no field-level authorisation, no caching rebuild.

*Evidence that would change my mind toward composite endpoints:* the dashboard settles into a stable set of views, or the backend team finds itself maintaining dataloaders and cost limits that nobody asked for.

*Evidence that would confirm GraphQL:* a second and third internal client appears (a mobile ops app, a partner-facing portal) with overlapping but different needs, and the backend team is being asked for a new endpoint every week. That is the trajectory GraphQL is for, and adopting it before that trajectory is visible is paying for a problem you may not get.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-proto-1',
      level: 'basic',
      question: 'What is the difference between REST and RPC?',
      guidance:
        'REST models resources and uses HTTP method semantics, inheriting caching, retry safety and per-endpoint observability. RPC exposes operations and typically uses POST for everything, giving those up in exchange for less ceremony. A strong answer frames it as a trade rather than a hierarchy.',
    },
    {
      id: 'iq-proto-2',
      level: 'basic',
      question: 'Why would you choose gRPC over REST between two of your own services?',
      guidance:
        'Schema as the source of truth with generated clients, cheap evolution via field numbers, and first-class streaming. A candidate who leads with "it is faster" has picked the smallest term; a strong answer explicitly deprioritises serialisation speed.',
    },
    {
      id: 'iq-proto-3',
      level: 'intermediate',
      question: 'What does GraphQL make harder?',
      guidance:
        'Caching (no HTTP layer, so persisted queries and hashes), query cost (request count is not load), N+1 resolution (batching mandatory), per-operation observability, and field-level authorisation. A candidate who can only list benefits has not operated one.',
    },
    {
      id: 'iq-proto-4',
      level: 'intermediate',
      question: 'Your API is entirely POST endpoints and reads are slow. What do you do?',
      guidance:
        'Recognise that POST is uncacheable, so no edge or browser can help regardless of infrastructure. Convert reads to GETs on resources with parameters in the URL, add ETags. A strong answer notes that this also restores safe retries and per-endpoint metrics, not just caching.',
    },
    {
      id: 'iq-proto-5',
      level: 'advanced',
      question: 'How do you expose a gRPC-based system to third-party developers?',
      guidance:
        'A REST gateway, ideally generated from the same service definitions so the two cannot drift. Strong answers explain why not to publish .proto files and require gRPC: it imposes a toolchain on consumers whose integration cost you do not control. Excellent answers mention that error format and versioning become part of the public contract at that boundary.',
    },
    {
      id: 'iq-proto-6',
      level: 'advanced',
      question: 'A partner sends a GraphQL query that saturates your database. Your rate limiter did not stop it. Why?',
      guidance:
        'Request count is not proportional to work in GraphQL — one query can fan out arbitrarily. The controls are maximum depth, a complexity score computed before execution, and rate limits in cost units. Excellent answers add persisted queries to restrict public consumers to an approved set, and note this is a reason GraphQL is a hard fit for public APIs.',
    },
    {
      id: 'iq-proto-7',
      level: 'followup',
      question: 'You said use REST publicly and gRPC internally. Is that not inconsistent?',
      guidance:
        'No — the boundaries have different consumer relationships. Public consumers cannot be redeployed and already own HTTP tooling; internal services ship together and benefit from schemas and streaming. A strong answer notes that generating the translation from one definition is what keeps them consistent where it matters.',
    },
    {
      id: 'iq-proto-8',
      level: 'followup',
      question: 'How would you model "cancel this order" in a REST API?',
      guidance:
        'An explicit custom method such as `POST /orders/42:cancel`, being honest that it is an action. Strong answers reject inventing a `/cancellations` resource that models nothing, note the resource stays in the path so observability and authorisation still key on it, and observe that some operations genuinely are not CRUD.',
    },
  ],

  activeLearning: [
    {
      id: 'al-proto-1',
      kind: 'what-changes-if',
      prompt:
        'A team has a REST API with 30 endpoints serving one web app and one mobile app. They propose replacing it with GraphQL. Now change one fact: the API is also consumed by 200 enterprise customers who built integrations over the last four years. What changes about the proposal, and what would you actually do?',
      discussion: `The 200 integrations change the answer completely, and the interesting part is that they do not make GraphQL wrong — they make *replacing* wrong.

**Why replacement is off the table.** Those 200 integrations were built over four years by teams you cannot schedule. Migrating them means either coordinating 200 external engineering efforts or breaking them, and neither is a project you can run. The existing REST surface is now permanent infrastructure regardless of what you build next. Any proposal whose first step is "turn off the old API" has not accounted for the largest constraint in the system.

**Why GraphQL might still be right — for the first-party clients.** The original motivation presumably stands: the web and mobile apps assemble screens from several endpoints and over-fetch. That pain is real and GraphQL addresses it. The mistake is scope, not direction.

**What I would actually do: add, do not replace.**

Keep the REST API exactly as it is for enterprise consumers. Add a GraphQL endpoint for first-party clients, implemented over the same domain services rather than over the REST API. Two boundaries, two protocols, one set of business logic.

**What this costs, honestly:**

- Two API surfaces to keep behaviourally consistent. The mitigation is that both must call the same domain layer — if GraphQL resolvers call the REST API over HTTP, you have added a hop and guaranteed drift in error handling and authorisation.
- Authorisation implemented twice, in two shapes: per endpoint for REST, per field for GraphQL. This is the most likely place for a security divergence, and it is worth extracting into a shared policy layer rather than reimplementing.
- Two things to document, monitor and rate-limit.

**What it buys:**

- First-party clients get aggregation immediately, with no external coordination.
- Enterprise consumers are entirely unaffected — no communication, no migration window, no support load.
- The GraphQL surface can evolve fast, because its only consumers ship continuously. That is exactly the property that makes GraphQL affordable: no HTTP caching matters much when the client is yours and traffic is modest.

**The trap worth naming unprompted.** Once GraphQL exists internally, someone will propose exposing it to enterprise customers "so they get the same flexibility". That is when unbounded query cost becomes an availability problem owned by strangers, and it needs persisted queries, complexity scoring and cost-based rate limits before it happens rather than after.

**The transferable point.** "Should we adopt X" and "should we replace Y with X" are different questions with different answers, and the second is almost always harder than the proposal assumes. When consumers you cannot change exist, the existing interface is permanent, and the design question becomes what to add beside it.`,
    },
    {
      id: 'al-proto-2',
      kind: 'explain-yourself',
      prompt:
        'Write the answer you would give, in five or six sentences, to a colleague who says: "REST is dated. We should use gRPC for everything, including our public API." Concede the strongest part of their position before disagreeing. Then compare with the discussion.',
      discussion: `The strongest part of their position is real: for service-to-service work, gRPC genuinely is better on the axes that matter, and refusing to concede that makes the rest of the answer sound like conservatism.

One version:

> For our internal services I agree, and I would rather we moved sooner — the schema catching field mismatches at build time instead of in production is worth a lot, and we have three languages to keep in sync. The public API is a different problem, though: our consumers have already built integrations with HTTP clients, retry libraries and monitoring that understand method semantics, and gRPC would make them adopt our toolchain, add a proxy for anything browser-based, and give up edge caching on our read path. The thing REST is actually good at is not elegance, it is that the contract is one every intermediary already implements. So I would use gRPC internally and put a generated REST gateway at the public boundary — same service definitions, two surfaces, and they cannot drift because the translation is generated rather than hand-written.

What makes that strong:

- **It concedes properly, and specifically.** Not "you have a point" but "for internal services I agree and would move sooner", with the reason. That establishes you are evaluating rather than defending.
- **It separates the boundaries** instead of arguing about which protocol is better in the abstract.
- **It names concrete consumer costs**: existing tooling, a required proxy, lost edge caching. Those are checkable claims, not preferences.
- **It reframes what REST is for.** Not "readable" or "standard" but "the contract every intermediary already implements" — which is the property that matters when you cannot change your consumers.
- **It proposes a concrete design** with a mechanism (generated translation) for the obvious objection (two surfaces will drift).

Weaknesses to check your own answer against:

- Did you defend REST on aesthetics or familiarity? Those lose the argument and deserve to.
- Did you concede the internal case? If not, you sound like you are protecting the status quo.
- Did you name what breaks for consumers, specifically enough that someone could verify it?
- Did you address how two surfaces stay consistent? "We'll maintain both" is not an answer; "generated from the same definitions" is.`,
    },
  ],

  revision: {
    bullets: [
      'Two axes decide: how many consumers and can you change them; and who decides the response shape.',
      'REST: many unknown consumers, server decides. Inherits caching, safe retries and per-endpoint observability from HTTP.',
      'RPC over POST: few owned consumers, least ceremony, and you give up every HTTP guarantee including cacheable reads.',
      'gRPC: schema is the source of truth, generated clients, first-class streaming. Field numbers make evolution cheap.',
      'Browsers cannot speak gRPC directly — a translating proxy is required and some streaming modes are lost.',
      'GraphQL: client decides the shape. Deletes round trips and over-fetching.',
      'GraphQL hands back HTTP caching, query cost limiting, N+1 batching, per-operation observability and per-field authorisation.',
      'In GraphQL, request count is not load — one query can fan out into thousands of database calls.',
      'Never choose a protocol on serialisation speed; it is the smallest term against round trips and database work.',
      'Choose per boundary, not per company. REST publicly and gRPC internally is coherent, not inconsistent.',
      'Generate the public translation from the same service definitions so the two surfaces cannot drift.',
      'For genuine actions, an explicit custom method (`POST /orders/42:cancel`) beats inventing a noun.',
      'Before adopting GraphQL for round trips, check whether a composite endpoint solves it — especially with one client.',
      'When consumers you cannot change exist, the existing interface is permanent. Add beside it rather than replacing it.',
      'A POST read path cannot be cached by any layer, no matter how much CDN you buy.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Four API styles distinguished by how much they lean on HTTP semantics and by whether the server or the client decides what a response contains.',
    whyItExists:
      'Different consumer relationships need different guarantees: consumers you cannot redeploy need evolvability, consumers you deploy can afford tight coupling, and consumers with divergent needs may need to shape responses themselves.',
    whenToUse: [
      'REST for public APIs and anything consumed by clients you cannot change.',
      'gRPC for service-to-service where you own both sides, especially with several languages or streaming.',
      'GraphQL when several owned clients have genuinely different needs over one complex domain.',
    ],
    whenNotToUse: [
      'gRPC at a public boundary — it imposes your toolchain on consumers and needs a proxy for browsers.',
      'GraphQL for simple CRUD, or publicly without solving query cost first.',
      'RPC over POST for read-heavy paths that would benefit from caching.',
    ],
    alternatives: [
      'A composite REST endpoint per client screen: deletes round trips without adopting a query language, at the cost of endpoint proliferation.',
      'A REST gateway generated from gRPC definitions, giving the right protocol at each boundary from one source of truth.',
      'Server-sent events or WebSockets where the interaction is a stream rather than a call.',
    ],
    tradeoffs: [
      'REST buys HTTP guarantees and costs round trips and over-fetching.',
      'RPC buys minimal ceremony and costs caching, retry safety and observability.',
      'gRPC buys contracts and streaming and costs code generation, opacity and a browser proxy.',
      'GraphQL buys client-shaped responses and costs caching, cost limiting, batching and field-level authorisation.',
    ],
    failureModes: [
      'A read path on POST that no cache can help, however much CDN is provisioned.',
      'GraphQL query fan-out saturating a database while request-rate limits report normal traffic.',
      'N+1 resolution in GraphQL resolvers without batching.',
      'One endpoint in every dashboard, so per-operation latency and errors are invisible.',
      'Schema drift between services discovered at runtime because there was no shared contract.',
      'Two API surfaces over separately implemented logic, drifting in authorisation and error handling.',
    ],
    followUpQuestions: [
      'How many consumers are there, and can you redeploy them?',
      'Who decides the response shape, and what does that cost the other side?',
      'What does your read path give up by being a POST?',
      'How do you bound the cost of a single request?',
      'Where is authorisation enforced, and does it hold for every path to a field?',
      'If you have two API surfaces, what stops them drifting?',
    ],
  },
});
