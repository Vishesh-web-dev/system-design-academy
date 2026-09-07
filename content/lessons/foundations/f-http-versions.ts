import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-http-versions',
  title: 'HTTP/1.1 → HTTP/2 → HTTP/3',
  summary:
    'HTTP semantics have barely changed since 1997; only the transport underneath them has. Knowing which layer each version altered tells you which problems an upgrade actually solves.',
  phase: 'foundations',
  module: 'networking',
  position: 3,
  kind: 'concept',
  difficulty: 'intro',
  estimatedMinutes: 35,
  tags: ['http', 'multiplexing', 'quic', 'head-of-line-blocking', 'connections'],
  prerequisites: ['f-tcp-latency'],
  resources: [
    {
      key: 'rfc-9110-http-semantics',
      tier: 'must',
      note: 'The document that made the point of this lesson official: semantics were split out from any particular version. Skim section 1 to see the separation, then use it as a reference rather than reading it through.',
    },
    {
      key: 'web-almanac-http',
      tier: 'must',
      note: 'Measured adoption and connection behaviour across the real web. Use it when you want to claim what most traffic actually does instead of guessing.',
    },
    {
      key: 'rfc-9113-http2',
      tier: 'good',
      note: 'Read the sections on streams and flow control. They explain why multiplexing is not free and where per-stream backpressure comes from.',
    },
    {
      key: 'rfc-9114-http3',
      tier: 'good',
      note: 'The mapping of HTTP onto QUIC. The interesting part is what it no longer has to specify, because QUIC handles it at the transport layer.',
    },
  ],

  intuition: {
    body: `Here is the thing most people get wrong about HTTP versions: **the version number has almost nothing to do with what HTTP means.**

A \`GET /orders/42\` with an \`Authorization\` header returning \`200 OK\` and a JSON body is the same request in HTTP/1.1, HTTP/2 and HTTP/3. Same methods, same status codes, same headers, same caching rules, same idempotency guarantees. Your application code does not change. Your API design does not change. Your mental model of a request does not change.

What changes is how those bytes get across the wire.

- **HTTP/1.1** sends requests as text, one at a time per connection. Want six in parallel? Open six connections.
- **HTTP/2** sends them as binary frames, interleaved on one connection. Six requests, one connection, no waiting in line.
- **HTTP/3** does the same, but over QUIC instead of TCP, so a lost packet no longer stalls unrelated requests.

Notice the shape of that progression. Each version solved the previous one's *transport* problem, and none of them changed the *semantics*. That is why RFC 9110 exists: it defines HTTP semantics once, independently of any version, and the version-specific RFCs then describe only the wire format.

The practical consequence, and the reason this matters in an interview: **an HTTP version upgrade is a latency and connection-efficiency change, never a functionality change.** If someone proposes moving to HTTP/2 to fix an API design problem, they have confused the layers. If someone proposes it to fix six-connections-per-host contention on a page with 80 assets, they are exactly right.`,
    analogyLimit:
      'Treating the versions as "same meaning, better delivery" is right, but it hides one place where the transport leaks into behaviour: head-of-line blocking. HTTP/2 removes it between requests and reintroduces it at the TCP layer, so on a lossy link an HTTP/2 upgrade can perform worse than HTTP/1.1 with several connections. The layers are separable in the specification and not always in practice.',
  },

  deepExplanation: {
    predict: {
      question:
        'A page loads 80 small assets from one host over HTTP/1.1, RTT 100 ms, and the browser allows 6 connections per host. Ignoring transmission time and server time, roughly how long before all 80 have arrived? Then: what would HTTP/2 change, and what would it not change?',
      answer: `**HTTP/1.1:** 80 assets ÷ 6 connections = about **14 rounds** of requests. Each round costs one round trip, so ≈ **1.4 seconds** — plus 6 handshakes at the start (2 RTT each with TLS, but concurrent, so ~200 ms) and slow start on each of the six connections independently.

Call it **1.6 seconds before the last asset arrives**, essentially none of it transmission.

**HTTP/2 changes:** all 80 requests are multiplexed onto one connection and issued immediately. The round-trip cost collapses from 14 rounds to **1 round** — roughly 100 ms plus transmission. Handshake is paid once, and one shared congestion window grows for all 80 transfers instead of six separate windows starting cold.

Estimated total: **~300 ms**. A five-fold improvement, and it came entirely from deleting round trips.

**HTTP/2 does not change:** the response bodies, the caching headers, the fact that 80 requests is a questionable design, or the total bytes transferred. It also does not remove head-of-line blocking — it moves it. All 80 streams share one TCP connection, so a single lost segment stalls delivery for every one of them until it is retransmitted. On a link with 2% packet loss, the HTTP/1.1 version with six independent connections can actually finish sooner, because a loss only stalls one sixth of the work.

That last paragraph is the interview answer. Anyone can say "HTTP/2 multiplexes". The candidate who says "and that is why it can be *worse* on a lossy link" has understood the mechanism.`,
    },
    body: `## HTTP/1.1: one request at a time, per connection

HTTP/1.1 is a text protocol. A request is a request line, headers, a blank line, and optionally a body. Simple enough to type by hand, which is genuinely why it survived so long.

Its defining limitation is that a connection carries one request-response exchange at a time. Persistent connections (keep-alive) let you reuse the connection for the *next* request, which saves handshakes, but you still wait for response N before sending request N+1.

Pipelining was specified to fix this — send several requests without waiting — but responses still had to come back in order, so one slow response blocked all the ones behind it. That is **application-level head-of-line blocking**, and it is why pipelining was effectively never deployed.

The workaround the whole web adopted was **parallel connections**: browsers open up to six per host. That works, and it costs six handshakes, six congestion windows starting cold, six sets of socket buffers on the server, and a hard ceiling on concurrency. It also drove a generation of workarounds — sprite sheets, CSS/JS bundling, domain sharding — all of which exist purely to fit more content through fewer requests.

Header overhead compounds it. Every request re-sends the full header set, uncompressed. A request with cookies can be 800 bytes of headers to fetch a 100-byte asset.

## HTTP/2: binary framing and multiplexing

HTTP/2 keeps the semantics and replaces the wire format.

**Binary framing.** Messages are split into frames with a type and a stream identifier. Because every frame says which stream it belongs to, frames from different requests can be interleaved arbitrarily on one connection.

**Multiplexing.** Many concurrent streams over one connection. The six-connection limit and the request-ordering constraint both disappear. This is the change that matters, and it is why domain sharding and bundling became counterproductive rather than clever.

**Header compression (HPACK).** Headers are compressed with a shared dynamic table, so repeated headers across requests cost a few bytes instead of hundreds.

**Server push.** The server could proactively send resources the client had not asked for. It was hard to use correctly — the server rarely knows what the client has cached — and has largely been abandoned in favour of resource hints. Worth knowing mainly so you can say why it did not work out.

**Stream prioritisation and flow control.** Clients can express relative priority, and each stream has its own flow-control window so one large download cannot starve everything else on the connection.

What HTTP/2 does *not* fix: it runs on TCP, and TCP delivers bytes in order. A lost segment blocks delivery of every stream sharing that connection. **Head-of-line blocking moved from the application layer to the transport layer.** On a clean link this is invisible. On a mobile link with real loss, an HTTP/2 connection can underperform six independent HTTP/1.1 connections, because loss on one of six connections only stalls one sixth of the work.

## HTTP/3: same semantics, different transport

HTTP/3 keeps the semantics again and replaces TCP with QUIC, which runs over UDP.

**Independent streams.** QUIC provides ordering *per stream* rather than per connection. A lost packet affecting stream 3 delays only stream 3. This is the actual fix for the problem HTTP/2 relocated.

**One-round-trip handshake.** QUIC integrates the cryptographic handshake into the transport handshake, so a new connection costs 1 RTT instead of TCP's 1 plus TLS's 1. Resumption can be 0-RTT, with the same replay caveat as TLS 1.3 — only idempotent requests may use it.

**Connection migration.** A QUIC connection is identified by a connection ID rather than by the four-tuple of addresses and ports. A phone moving from WiFi to cellular keeps the same connection, including its congestion state. Under TCP that transition means a brand-new connection and a fresh slow start.

**User-space implementation.** QUIC lives in the application rather than the kernel, which makes it deployable and iterable without operating-system changes — and costs more CPU per byte than the kernel's heavily optimised TCP path. On very high-throughput servers this is a real trade.

## Choosing, in practice

The honest summary is that you rarely choose. Clients and CDNs negotiate the highest version both support, and for most services the answer is "enable HTTP/2 and HTTP/3 at the edge and stop thinking about it".

Where it becomes a genuine decision:

- **Many small resources from one origin** — HTTP/2 or /3 is a large win, and the old workarounds (sharding, bundling everything) become actively harmful.
- **Lossy or high-latency client links** (mobile, satellite, poor WiFi) — HTTP/3 is meaningfully better, and it is where connection migration pays.
- **Service-to-service inside a datacentre** — near-zero loss and sub-millisecond RTT means multiplexing buys little for request/response traffic. gRPC uses HTTP/2 anyway, but for its streaming and framing rather than for latency.
- **Very high throughput bulk transfer** — TCP's kernel path may still win on CPU efficiency.
- **A single large download** — no version helps. One stream, no concurrency to exploit.

## Where the layering leaks

Two places the "semantics are unchanged" story is not quite complete, and both come up as follow-ups:

**Connection coalescing.** HTTP/2 clients may reuse one connection for multiple hostnames that resolve to the same address and are covered by the same certificate. Behaviour that looked per-host is now shared, which can surprise anyone relying on per-host isolation for rate limiting.

**Header case and pseudo-headers.** HTTP/2 lowercases header names and moves method, path, scheme and authority into pseudo-headers. Code that compared header names case-sensitively, or parsed the request line as text, breaks. The semantics did not change; the representation did, and some code was written against the representation.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'hol-blocking',
      title: 'Where head-of-line blocking lives in each version',
      caption:
        'Follow the blocked box down the three rows. The problem is not solved once and for all — it is pushed one layer down at each step, and only QUIC removes it rather than relocating it.',
      code: `flowchart TB
    subgraph H1["HTTP/1.1 — blocking at the application layer"]
      A1[Request 1] --> A2[Response 1 must complete]
      A2 --> A3[Request 2 may now proceed]
      A4["Workaround: 6 parallel connections<br/>6 handshakes, 6 cold windows"]
    end

    subgraph H2["HTTP/2 — blocking at the transport layer"]
      B1[Streams 1..80 interleaved<br/>on one connection]
      B1 --> B2{Segment lost?}
      B2 -->|No| B3[All streams progress]
      B2 -->|Yes| B4["Every stream waits for<br/>the retransmission"]
    end

    subgraph H3["HTTP/3 — blocking confined to one stream"]
      C1[Streams 1..80 over QUIC]
      C1 --> C2{Packet lost?}
      C2 -->|No| C3[All streams progress]
      C2 -->|Yes| C4["Only the affected stream waits"]
    end

    style A4 fill:#2a1d1d,stroke:#b8383b
    style B4 fill:#2a1d1d,stroke:#b8383b
    style C4 fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'version-decision',
      title: 'Which layer does each version change?',
      caption:
        'Select each node. The semantics layer is identical across all three versions — which is why an upgrade never fixes an API design problem, and always might fix a connection-efficiency one.',
      nodes: [
        { id: 'sem', label: 'HTTP semantics', kind: 'note', x: 250, y: 0, detail: 'Methods, status codes, headers, caching, conditional requests, idempotency. Defined once in RFC 9110 and identical in every version. Your application code lives entirely here.' },
        { id: 'h1', label: 'HTTP/1.1 wire format', kind: 'service', x: 0, y: 130, detail: 'Text protocol, one exchange at a time per connection. Concurrency comes from opening more connections, capped at about six per host by browsers.' },
        { id: 'h2', label: 'HTTP/2 framing', kind: 'service', x: 250, y: 130, detail: 'Binary frames tagged with a stream id, so requests interleave on one connection. Adds HPACK header compression and per-stream flow control.' },
        { id: 'h3', label: 'HTTP/3 framing', kind: 'service', x: 500, y: 130, detail: 'Same multiplexing model, mapped onto QUIC. Much of what HTTP/2 had to specify is handled by the transport instead.' },
        { id: 'tcp', label: 'TCP', kind: 'store', x: 125, y: 270, detail: 'Ordered byte stream per connection. One lost segment stalls everything behind it, including logically independent HTTP/2 streams.' },
        { id: 'quic', label: 'QUIC over UDP', kind: 'store', x: 500, y: 270, detail: 'Per-stream ordering, integrated crypto handshake (1 RTT), and connection migration by connection ID rather than address tuple.' },
      ],
      edges: [
        { id: 'v1', source: 'sem', target: 'h1', kind: 'control' },
        { id: 'v2', source: 'sem', target: 'h2', kind: 'control' },
        { id: 'v3', source: 'sem', target: 'h3', kind: 'control' },
        { id: 'v4', source: 'h1', target: 'tcp', kind: 'sync' },
        { id: 'v5', source: 'h2', target: 'tcp', kind: 'sync' },
        { id: 'v6', source: 'h3', target: 'quic', kind: 'sync' },
      ],
      steps: [
        {
          id: 'p1',
          title: 'One set of semantics, three wire formats',
          description:
            'RFC 9110 defines what a GET means, what 404 means, what Cache-Control does — independently of any version. Every version below implements the same meaning. This is why an upgrade is never a functionality change.',
          nodes: ['sem', 'h1', 'h2', 'h3'],
          edges: ['v1', 'v2', 'v3'],
        },
        {
          id: 'p2',
          title: 'HTTP/1.1 and HTTP/2 share a transport, and therefore share a limit',
          description:
            'Both run on TCP, which delivers a connection\'s bytes in order. HTTP/2 removed the application-level queue and inherited the transport-level one — six connections stall independently, one multiplexed connection stalls together.',
          nodes: ['h1', 'h2', 'tcp'],
          edges: ['v4', 'v5'],
        },
        {
          id: 'p3',
          title: 'HTTP/3 changed the transport, which is the only thing that could fix it',
          description:
            'QUIC gives each stream independent delivery, folds the crypto handshake into the transport handshake, and survives a network change without re-establishing. All three benefits come from the transport, not from HTTP.',
          nodes: ['h3', 'quic'],
          edges: ['v6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The clearest evidence for the argument in this lesson is what happened to front-end build practice.

Under HTTP/1.1, the six-connections-per-host limit made every request expensive, so an entire discipline grew up around making fewer of them. Sprite sheets combined dozens of small images into one file with CSS offsets. Bundlers concatenated hundreds of JavaScript modules into a single file. Domain sharding served assets from \`static1\`, \`static2\`, \`static3\` so the browser would open eighteen connections instead of six. Inlining pushed small assets directly into the HTML as data URIs.

Every one of those techniques trades something real for fewer round trips:

- Bundling destroys cache granularity. Change one module and the entire bundle's cache entry is invalidated, so a returning user re-downloads everything.
- Sprite sheets couple unrelated images into one artefact and one cache lifetime.
- Domain sharding multiplies DNS lookups, handshakes and cold congestion windows — you paid setup cost to buy concurrency.
- Inlining makes assets uncacheable across pages, because they now live inside a document that is not cacheable.

Once HTTP/2 multiplexing was widely deployed, the constraint those techniques existed to work around disappeared, and the trade-offs stopped being worth it. Modern guidance inverts most of them: ship many smaller, independently cacheable modules; do not shard domains (it actively hurts, because it defeats connection reuse and coalescing); inline only what is genuinely critical for first paint.

Measured data from the Web Almanac shows the transition in practice — HTTP/2 and HTTP/3 adoption climbing, and connection counts per page falling as a consequence.

Two transferable lessons:

**Optimisations encode the constraints of their era, and they outlive them.** A codebase full of bundling and sharding is a codebase carrying HTTP/1.1 assumptions into an HTTP/2 world, paying the costs and no longer receiving the benefit. The same pattern recurs constantly — connection pooling tuned for a slow network, batch sizes tuned for a slow disk, retry counts tuned for a flaky dependency that was fixed years ago.

**"Fewer, bigger" and "more, smaller" are both correct answers to different transports.** The question to ask is not which is better but which constraint you are actually under, and whether it is still there.`,
  },

  tradeoffs: {
    intro:
      'You rarely pick a version explicitly — clients negotiate it — but you do decide which to enable and what to optimise for. These are the trade-offs behind that decision.',
    rows: [
      {
        option: 'HTTP/1.1 only',
        whenItWins:
          'Simple internal tooling, debugging by hand, environments where an intermediary does not speak anything newer. Text on the wire is genuinely easier to inspect.',
        whenItLoses:
          'Pages or clients making many requests to one host: the six-connection ceiling and one-exchange-at-a-time rule dominate.',
        cost:
          'Round trips, repeated uncompressed headers, six handshakes and six cold congestion windows to get concurrency.',
      },
      {
        option: 'HTTP/2',
        whenItWins:
          'Many concurrent requests to one origin over a reasonably clean network. Header compression and multiplexing remove most per-request overhead.',
        whenItLoses:
          'Lossy links, where all streams share one TCP connection and a single lost segment stalls every one of them.',
        cost:
          'Head-of-line blocking relocated to the transport, plus binary framing that makes casual wire inspection harder.',
      },
      {
        option: 'HTTP/3 (QUIC)',
        whenItWins:
          'Mobile and other lossy or high-latency links, clients that change network mid-session, and anywhere the one-round-trip handshake matters.',
        whenItLoses:
          'High-throughput server-to-server transfer where TCP\'s kernel path is more CPU-efficient, and networks where UDP is blocked or throttled.',
        cost:
          'More CPU per byte, a user-space stack to keep patched, and fallback logic for networks that block UDP.',
      },
      {
        option: 'Change nothing and reduce request count instead',
        whenItWins:
          'When the real problem is that a page or client makes far more requests than it needs. Deleting a request beats improving the transport that carries it.',
        whenItLoses:
          'When the requests are genuinely necessary and independent — then you are just building an HTTP/1.1-era workaround.',
        cost:
          'Coupled cache lifetimes, coupled failures, and optimisations that become counterproductive once the transport improves.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We should move to HTTP/2 — it is faster."',
      whyWeak:
        'Faster at what? HTTP/2 helps when many requests contend for a connection. It does nothing for a single large download, nothing for server processing time, and nothing for propagation delay. Without naming the mechanism, the claim cannot be checked and might be wrong.',
      strongAnswer:
        '"HTTP/2 helps if we are making many requests to one origin, because it removes the six-connection ceiling and the one-exchange-at-a-time rule. Our page makes 80 asset requests, so I would expect it to collapse about fourteen rounds of round trips into one. It would not help our single large video download at all."',
    },
    {
      weakAnswer: '"HTTP/2 solved head-of-line blocking."',
      whyWeak:
        'It solved it at the application layer and inherited it at the transport layer. All streams share one TCP connection, and TCP delivers in order, so one lost segment stalls every stream. On a lossy link that can make HTTP/2 slower than six independent HTTP/1.1 connections.',
      strongAnswer:
        '"HTTP/2 removed application-level head-of-line blocking but all streams share one TCP connection, so a lost segment still stalls all of them. HTTP/3 fixes it properly because QUIC gives each stream independent delivery. That is also why HTTP/2 can underperform on a lossy mobile link."',
    },
    {
      weakAnswer: '"We shard assets across four subdomains for more parallelism."',
      whyWeak:
        'That is an HTTP/1.1 workaround, and under HTTP/2 it is actively harmful: it defeats connection reuse and coalescing, so you pay four DNS lookups, four handshakes and four cold congestion windows to solve a problem that no longer exists.',
      strongAnswer:
        '"Domain sharding existed to get past the six-connection-per-host limit. With HTTP/2 that limit is gone, so sharding now costs extra handshakes and prevents connection coalescing. I would consolidate onto one origin and let multiplexing do the work."',
    },
    {
      weakAnswer: '"Upgrading to HTTP/3 will let us simplify our API."',
      whyWeak:
        'Confuses layers. HTTP semantics — methods, status codes, headers, caching, idempotency — are identical across all three versions and are defined independently of any of them. No transport change alters what an API means or how it should be modelled.',
      strongAnswer:
        '"An HTTP version is a wire-format and transport change; the semantics are the same in all three and are specified separately. If our API is awkward, that is a resource-modelling problem and I would fix it there. HTTP/3 would help our mobile clients on lossy links, which is a different problem entirely."',
    },
  ],

  flashcards: [
    {
      id: 'fc-http-1',
      front: 'What changed between HTTP/1.1, HTTP/2 and HTTP/3 — and what did not?',
      back: 'The wire format and transport changed. The semantics — methods, status codes, headers, caching, idempotency — are identical and are defined independently in RFC 9110.',
      topic: 'http',
    },
    {
      id: 'fc-http-2',
      front: 'Why did HTTP/1.1 pipelining fail in practice?',
      back: 'Responses had to return in request order, so one slow response blocked every response behind it. Application-level head-of-line blocking made it unusable, and browsers fell back to parallel connections.',
      topic: 'head-of-line-blocking',
    },
    {
      id: 'fc-http-3',
      front: 'What does HTTP/2 multiplexing actually remove?',
      back: 'The one-exchange-at-a-time-per-connection rule and the six-connections-per-host ceiling. Many requests interleave as frames tagged with a stream id on one connection.',
      topic: 'multiplexing',
    },
    {
      id: 'fc-http-4',
      front: 'Where does head-of-line blocking live under HTTP/2?',
      back: 'At the TCP layer. All streams share one connection and TCP delivers in order, so a lost segment stalls every stream until it is retransmitted.',
      topic: 'head-of-line-blocking',
    },
    {
      id: 'fc-http-5',
      front: 'Name three things QUIC gives HTTP/3 that TCP could not.',
      back: 'Per-stream ordering so a loss stalls only one stream; a one-round-trip handshake with crypto integrated; and connection migration by connection ID, so a network change does not reset the connection.',
      topic: 'quic',
    },
    {
      id: 'fc-http-6',
      front: 'Why did domain sharding become harmful after HTTP/2?',
      back: 'It existed to beat the six-connections-per-host limit, which multiplexing removed. Now it costs extra DNS lookups, handshakes and cold congestion windows, and defeats connection coalescing.',
      topic: 'connections',
    },
    {
      id: 'fc-http-7',
      front: 'When does an HTTP version upgrade buy nothing?',
      back: 'A single large download (no concurrency to exploit), server-processing-bound requests, and anything limited by propagation delay. Multiplexing only helps when requests contend.',
      topic: 'multiplexing',
    },
    {
      id: 'fc-http-8',
      front: 'What is the CPU trade-off with QUIC?',
      back: 'QUIC runs in user space rather than the kernel, which makes it deployable and iterable without OS changes but costs more CPU per byte than TCP\'s heavily optimised kernel path.',
      topic: 'quic',
    },
  ],

  quiz: [
    {
      id: 'q-http-1',
      kind: 'scenario',
      prompt:
        'A page loads 90 small assets from one origin. After enabling HTTP/2 at the CDN, load time drops from 1.8 s to 400 ms. A colleague concludes "HTTP/2 makes everything faster". What is the accurate version of that conclusion?',
      options: [
        { id: 'a', label: 'HTTP/2 removed round trips caused by request contention; it would not help a workload with one large request' },
        { id: 'b', label: 'HTTP/2 compressed the assets, reducing bytes transferred' },
        { id: 'c', label: 'HTTP/2 reduced server processing time per request' },
        { id: 'd', label: 'HTTP/2 shortened the propagation delay to the CDN' },
      ],
      correct: ['a'],
      explanation:
        'The gain came from multiplexing: 90 requests over six connections meant many sequential rounds, and multiplexing collapsed them into roughly one. HPACK compresses headers, not bodies. Nothing about the transport changes server time or the speed of light — so a single large download would see no benefit at all.',
      difficulty: 'core',
      topic: 'multiplexing',
    },
    {
      id: 'q-http-2',
      kind: 'scenario',
      prompt:
        'A mobile client on a network with about 2% packet loss performs *worse* after an HTTP/1.1 → HTTP/2 migration. What is the most likely explanation?',
      options: [
        { id: 'a', label: 'All streams now share one TCP connection, so a lost segment stalls every request instead of one sixth of them' },
        { id: 'b', label: 'HPACK compression fails under packet loss' },
        { id: 'c', label: 'HTTP/2 requires more round trips to establish' },
        { id: 'd', label: 'Binary framing is larger on the wire than text' },
      ],
      correct: ['a'],
      explanation:
        'This is transport-level head-of-line blocking. Six independent HTTP/1.1 connections isolate loss: a stall affects one connection. One multiplexed HTTP/2 connection shares the fate of every stream. HTTP/3 exists precisely to fix this, by giving each stream independent delivery over QUIC.',
      difficulty: 'advanced',
      topic: 'head-of-line-blocking',
    },
    {
      id: 'q-http-3',
      kind: 'single',
      prompt: 'Which of these differs between HTTP/1.1, HTTP/2 and HTTP/3?',
      options: [
        { id: 'a', label: 'How messages are represented on the wire' },
        { id: 'b', label: 'The meaning of a 409 status code' },
        { id: 'c', label: 'Whether GET is safe and idempotent' },
        { id: 'd', label: 'How Cache-Control directives are interpreted' },
      ],
      correct: ['a'],
      explanation:
        'Only the representation changes. Status code meanings, method properties and caching rules are HTTP semantics, defined once in RFC 9110 and identical across versions. This separation is exactly why a version upgrade cannot fix an API design problem.',
      difficulty: 'intro',
      topic: 'http',
    },
    {
      id: 'q-http-4',
      kind: 'scenario',
      prompt:
        'A team maintains a JavaScript bundler configuration that concatenates 400 modules into one 2 MB file, plus sprite sheets for icons. All clients are on HTTP/2. What would you suggest?',
      options: [
        { id: 'a', label: 'Split into smaller, independently cacheable chunks — the constraint that justified bundling is gone, and bundling destroys cache granularity' },
        { id: 'b', label: 'Keep it: fewer requests is always better' },
        { id: 'c', label: 'Shard the bundle across subdomains for parallelism' },
        { id: 'd', label: 'Switch to HTTP/1.1, which handles large files better' },
      ],
      correct: ['a'],
      explanation:
        'Aggressive bundling was a workaround for the per-host connection limit. Under multiplexing, many small requests are cheap, and small chunks mean a one-module change invalidates one chunk rather than 2 MB. Sharding is the same era of workaround and now actively defeats connection reuse.',
      difficulty: 'core',
      topic: 'connections',
    },
    {
      id: 'q-http-5',
      kind: 'scenario',
      prompt:
        'Two internal services in the same rack communicate over HTTP/1.1 with keep-alive, RTT 0.3 ms, near-zero loss, request/response only. A proposal suggests migrating to HTTP/3 "for performance". What is the strongest response?',
      options: [
        { id: 'a', label: 'The benefits of HTTP/3 — loss isolation, faster handshakes, connection migration — barely apply here; measure first and expect little' },
        { id: 'b', label: 'Agree, since HTTP/3 is the newest version' },
        { id: 'c', label: 'Agree, because QUIC is more CPU-efficient than TCP' },
        { id: 'd', label: 'Disagree, because HTTP/3 cannot carry request/response traffic' },
      ],
      correct: ['a'],
      explanation:
        'Every advantage QUIC brings addresses a condition absent here: there is no meaningful loss, handshakes are amortised by keep-alive, and nothing changes network. QUIC is also *less* CPU-efficient per byte because it runs in user space. The migration would cost effort for no measurable gain.',
      difficulty: 'advanced',
      topic: 'quic',
    },
    {
      id: 'q-http-6',
      kind: 'multi',
      prompt: 'Which of these are real changes introduced by HTTP/2? Select all that apply.',
      options: [
        { id: 'a', label: 'Binary framing with stream identifiers' },
        { id: 'b', label: 'Header compression with a shared dynamic table' },
        { id: 'c', label: 'Per-stream flow control' },
        { id: 'd', label: 'New status codes for multiplexed requests' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are wire-format and framing features. There are no new status codes: status codes are semantics, and semantics did not change. Recognising which of a version\'s features are semantic and which are transport is the whole skill this lesson trains.',
      difficulty: 'core',
      topic: 'http',
    },
  ],

  exercises: [
    {
      id: 'ex-http-1',
      kind: 'modify',
      title: 'Audit an HTTP/1.1-era front end',
      estimatedMinutes: 16,
      prompt: `You inherit a web app with these delivery decisions, all made in 2016:

1. All JavaScript concatenated into one 1.8 MB bundle.
2. Icons served from a 240 KB sprite sheet.
3. Static assets sharded across \`cdn1.example.com\`, \`cdn2.example.com\`, \`cdn3.example.com\`.
4. Critical CSS inlined into every HTML response (18 KB).
5. Images inlined as data URIs when under 8 KB.

Clients are now on HTTP/2 or HTTP/3. Assets change roughly weekly, and most users return several times a week.

For each decision: say what constraint it was solving, whether that constraint still exists, what it now costs, and what you would do. Then pick the single change you would make first and justify the ordering.`,
      rubric: [
        'Identifies the shared constraint behind items 1, 2, 3 and 5: the six-connections-per-host limit and per-request round-trip cost under HTTP/1.1.',
        'States that multiplexing removed that constraint, so many small requests are now cheap.',
        'Names cache granularity as the specific cost of bundling and sprite sheets: one change invalidates the whole artefact for returning users.',
        'Identifies domain sharding as now actively harmful — extra DNS, handshakes and cold windows, and it defeats connection coalescing.',
        'Treats inlined critical CSS differently: it is about render-blocking and first paint, not connection limits, so it may still be justified.',
        'Notes that data-URI inlining makes assets uncacheable across pages and inflates the enclosing document.',
        'Chooses one first change with reasoning tied to the return-visitor pattern and weekly asset churn, rather than to what is easiest.',
      ],
      modelAnswer: `**1. One 1.8 MB JavaScript bundle**
*Constraint:* per-request cost and the six-connection limit — 400 separate module requests were unaffordable.
*Still exists?* No. Multiplexing makes many small requests cheap.
*Now costs:* cache granularity. Assets change weekly and users return several times a week, so every visitor re-downloads 1.8 MB for what is usually a small change. Also delays parse and execution until the whole bundle arrives.
*Change:* split into route-level or vendor/app chunks with content-hashed filenames. Vendor code changes rarely and stays cached; app code changes weekly and only that chunk is refetched.

**2. 240 KB sprite sheet**
*Constraint:* same one — dozens of icon requests were expensive.
*Still exists?* No.
*Now costs:* every icon shares one cache lifetime, and every page downloads all 240 KB to show perhaps six icons.
*Change:* individual SVGs, or an inline SVG symbol set for the small set actually used above the fold. Individually cacheable, and unused icons are never fetched.

**3. Domain sharding across three CDN hosts**
*Constraint:* getting past six connections per host by using three hosts.
*Still exists?* No — and this is the one that is now actively negative.
*Now costs:* three DNS lookups, three TCP+TLS handshakes, three cold congestion windows, and it prevents HTTP/2 connection coalescing that would otherwise let one connection serve everything.
*Change:* consolidate to one origin. This is a pure win: strictly fewer round trips, strictly less setup.

**4. Inlined critical CSS (18 KB)**
*Constraint:* render-blocking. The browser cannot paint until CSS arrives, so a round trip for stylesheets delays first paint.
*Still exists?* **Yes.** This one is not about connection limits at all — it is about the critical rendering path, and multiplexing does not remove the round trip, only makes it cheaper to run in parallel with others.
*Now costs:* 18 KB on every HTML response, uncacheable across pages.
*Change:* keep it, but audit the size. 18 KB is a lot for "critical"; if it has grown to cover the whole site rather than above-the-fold, trim it. This is the item where the honest answer is "the original reasoning still holds".

**5. Data-URI inlining under 8 KB**
*Constraint:* avoiding a request per small image.
*Still exists?* No.
*Now costs:* inlined assets cannot be cached independently, so a repeated logo is re-downloaded inside every page. Base64 also adds about 33% overhead, and inlining into CSS blocks rendering on a larger stylesheet.
*Change:* serve as normal files with long cache lifetimes. Keep inlining only for a genuinely tiny, above-the-fold, single-use asset.

**First change: remove the domain sharding.**

Ordering justification:
- It is the only item that is now **purely negative** — nothing about it helps under HTTP/2. Items 1, 2 and 5 at least still reduce request count; sharding reduces nothing and adds setup cost.
- It is a configuration change rather than a build-system change, so it ships in hours rather than a sprint.
- It **unlocks** the value of the other fixes. Once everything is on one origin with one warm connection, splitting the bundle into many chunks becomes cheap. Splitting the bundle while assets are still sharded would spread those chunks across three connections and partially waste the benefit.

Second would be bundle splitting, because the weekly-churn-plus-returning-users pattern makes cache granularity the largest remaining cost — a returning user currently pays 1.8 MB for a one-line change.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-http-1',
      level: 'basic',
      question: 'What is the difference between HTTP/1.1, HTTP/2 and HTTP/3?',
      guidance:
        'The answer must lead with what did *not* change: semantics are identical. Then the wire format and transport differences. A candidate who describes them as three different protocols with different capabilities has the wrong model and will make layer-confusion errors later.',
    },
    {
      id: 'iq-http-2',
      level: 'basic',
      question: 'Why did browsers open six connections per host under HTTP/1.1?',
      guidance:
        'Because a connection carried one exchange at a time and pipelining failed due to ordered responses. Parallel connections were the only concurrency available. A strong answer names the costs it bought: six handshakes, six cold congestion windows, more server memory.',
    },
    {
      id: 'iq-http-3',
      level: 'intermediate',
      question: 'Does HTTP/2 eliminate head-of-line blocking?',
      guidance:
        'No — it moves it from the application layer to the transport layer. Strong answers explain that all streams share one TCP connection and TCP delivers in order. Excellent answers note the practical consequence: on a lossy link, HTTP/2 can be slower than HTTP/1.1 with six connections.',
    },
    {
      id: 'iq-http-4',
      level: 'intermediate',
      question: 'When would you not bother enabling HTTP/3?',
      guidance:
        'Server-to-server inside a datacentre with near-zero loss and amortised handshakes; high-throughput bulk transfer where TCP\'s kernel path is more CPU-efficient; networks where UDP is blocked. A candidate who cannot name a case against the newest version is pattern-matching rather than reasoning.',
    },
    {
      id: 'iq-http-5',
      level: 'advanced',
      question: 'Your mobile app got slower after an HTTP/2 migration. Walk me through your diagnosis.',
      guidance:
        'Look for the loss hypothesis and how to test it: correlate slowness with packet loss and network type, compare against a control on HTTP/1.1, check whether stalls affect all in-flight requests simultaneously (the fingerprint of transport-level blocking). Excellent answers propose HTTP/3 as the fix and note it needs a UDP-capable path end to end.',
    },
    {
      id: 'iq-http-6',
      level: 'advanced',
      question: 'What is connection coalescing and how can it surprise you?',
      guidance:
        'An HTTP/2 client may reuse one connection for several hostnames resolving to the same address under one certificate. It saves handshakes and can break assumptions: per-host rate limiting, per-host connection accounting, and origin isolation all become per-connection instead. A strong answer notes that domain sharding defeats it, which is another reason sharding hurts.',
    },
    {
      id: 'iq-http-7',
      level: 'followup',
      question: 'You said semantics are unchanged. Is that completely true?',
      guidance:
        'Semantics are unchanged; the *representation* is not, and some code was written against the representation. HTTP/2 lowercases header names and moves method, path, scheme and authority into pseudo-headers, so case-sensitive header comparison and request-line parsing break. A candidate who concedes this precisely, rather than defending an absolute, is reasoning rather than reciting.',
    },
    {
      id: 'iq-http-8',
      level: 'followup',
      question: 'HTTP/2 had server push and it was removed. Why?',
      guidance:
        'The server rarely knows what the client already has cached, so push frequently sent bytes the client would have skipped — spending bandwidth to save a round trip that was not going to happen. Resource hints let the client decide instead. A strong answer generalises: pushing based on a guess about a peer\'s state is fragile whenever that state is not observable.',
    },
  ],

  activeLearning: [
    {
      id: 'al-http-1',
      kind: 'what-changes-if',
      prompt:
        'The lesson assumed a browser fetching many assets. Now change the workload: a gRPC service opening one long-lived HTTP/2 connection and streaming thousands of small messages per second in both directions, inside one datacentre. Which HTTP/2 features are load-bearing here, which are irrelevant, and does HTTP/3 help?',
      discussion: `The features that matter completely invert, which is why "gRPC uses HTTP/2" is a fact that misleads people about *why*.

**Load-bearing here:**

*Binary framing.* This is the real reason gRPC chose HTTP/2, and it has nothing to do with latency. Frames carry a stream id and a length, which gives message boundaries for free — the framing problem TCP does not solve. A hand-rolled protocol would have had to invent this.

*Bidirectional streaming.* Multiple long-lived streams on one connection, each carrying an independent sequence of messages in both directions. HTTP/1.1 has no model for this at all; you would be writing a custom protocol.

*Per-stream flow control.* Genuinely important in streaming. Without it, a fast producer on one stream can exhaust the connection's buffers and starve every other stream. Per-stream windows give you backpressure per logical channel, which is exactly what a multiplexed streaming system needs.

**Irrelevant here:**

*Multiplexing as a latency optimisation.* At 0.3 ms RTT and one persistent connection, the round-trip savings that dominate a browser page load are noise. Multiplexing matters for *structure* — many logical channels on one socket — not for speed.

*HPACK header compression.* gRPC messages carry few headers and the dynamic table converges almost immediately. Real but tiny.

*Server push.* Never used; the streaming model supersedes it.

**Does HTTP/3 help?** Mostly no, and this is the interesting part.

- *Loss isolation:* near-zero loss in a datacentre, so there is little for it to isolate. On a **cross-region** gRPC link, this changes — loss becomes real and per-stream delivery starts to matter.
- *Faster handshake:* the connection is established once and lives for hours. Saving one round trip at startup is irrelevant.
- *Connection migration:* servers do not change networks mid-session.
- *CPU cost:* QUIC in user space is more expensive per byte, and at thousands of messages per second that is a real regression rather than a rounding error.

So for intra-datacentre gRPC, HTTP/3 is a net negative. For cross-region or client-to-edge gRPC over the public internet, the calculus flips.

**The transferable point.** The same protocol feature is load-bearing or irrelevant depending on the workload. HTTP/2 for a browser is a latency optimisation. HTTP/2 for gRPC is a framing and multiplexing *abstraction* — they happen to be the same protocol for entirely different reasons. When someone says "we use X because it is fast", ask which of X's properties they are actually depending on. Frequently it is not the one in the headline.`,
    },
    {
      id: 'al-http-2',
      kind: 'predict',
      prompt:
        'A CDN reports that after enabling HTTP/3, p50 latency for a static asset is unchanged but p99 dropped by 40%. Before reading the discussion: explain why the median would not move while the tail moves substantially, and say what you would expect to see in the same measurement taken only over wired desktop clients.',
      discussion: `**Why p50 does not move.** The median request is a clean one: no packet loss, an established connection, nothing to isolate. For that request, HTTP/3 and HTTP/2 do the same amount of work over the same distance. Propagation delay dominates and is identical. There is no mechanism by which QUIC could make a loss-free, warm-connection request faster — so it does not.

**Why p99 moves a lot.** The tail is made of the requests where something went wrong, and QUIC's advantages are all about what happens when something goes wrong:

- *A lost packet.* Under HTTP/2 that stalls every stream on the connection until retransmission; under HTTP/3 it stalls one. Requests that were merely unlucky enough to share a connection with a loss stop being slow.
- *A cold connection.* QUIC's handshake is one round trip instead of two, so requests that had to establish a connection save a full RTT — and on a high-latency mobile link that is a large absolute number.
- *A network change.* A client moving from WiFi to cellular keeps its QUIC connection and its congestion state. Under TCP that is a new connection and a fresh slow start, which produces exactly the kind of multi-hundred-millisecond outlier that lands in p99.

Each of these affects a small fraction of requests and affects them severely. That is the definition of a tail improvement, and it is why the median is silent about it.

**Wired desktop clients only.** I would expect the p99 improvement to shrink substantially — perhaps to single-digit percent, perhaps to nothing measurable. Wired networks have very low loss, stable connections, and no network transitions. All three of QUIC's mechanisms need a condition that is largely absent. The handshake saving remains for genuinely new connections, so a small improvement in the cold-start portion of the tail is plausible, but the loss-isolation and migration benefits have nothing to act on.

**The generalisable lesson.** Improvements that target failure paths show up in tails, not in medians — and a change measured on the wrong population will look like it did nothing. This is why "we shipped it and p50 did not move, so it did not work" is one of the most common ways teams discard changes that were in fact working exactly as designed. Always ask which requests a change was supposed to help, then measure those.`,
    },
  ],

  revision: {
    bullets: [
      'Semantics — methods, status codes, headers, caching, idempotency — are identical across all three versions and defined once in RFC 9110.',
      'Only the wire format and transport change. An HTTP upgrade never fixes an API design problem.',
      'HTTP/1.1: one exchange at a time per connection; concurrency comes from six connections per host.',
      'Pipelining failed because responses had to return in order — application-level head-of-line blocking.',
      'HTTP/2: binary frames tagged with a stream id, so requests interleave on one connection. Plus HPACK and per-stream flow control.',
      'HTTP/2 moved head-of-line blocking to TCP: one lost segment stalls every stream sharing the connection.',
      'On lossy links HTTP/2 can be slower than HTTP/1.1 with six connections, because loss is no longer isolated.',
      'HTTP/3 runs on QUIC: per-stream delivery, 1-RTT handshake, connection migration by connection ID.',
      'QUIC costs more CPU per byte because it runs in user space, and needs a fallback where UDP is blocked.',
      'Bundling, sprite sheets, domain sharding and data-URI inlining were HTTP/1.1 workarounds; under HTTP/2 most become net negative.',
      'Domain sharding is the clearest case: extra DNS, handshakes and cold windows, and it defeats connection coalescing.',
      'Inlined critical CSS is the exception — it addresses render-blocking, not connection limits, so it may still be justified.',
      'HTTP/2 upgrades help many-small-requests workloads. They do nothing for a single large download or a CPU-bound endpoint.',
      'gRPC uses HTTP/2 for framing and bidirectional streaming, not for latency — same protocol, different reason.',
      'Improvements that target failure paths move p99, not p50. Measure the population the change was meant to help.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Three wire formats for one unchanging set of HTTP semantics: text over TCP, binary multiplexed frames over TCP, and the same frames over QUIC.',
    whyItExists:
      'Each version fixed the previous one\'s transport bottleneck — first request serialisation, then transport-level head-of-line blocking — without touching what a request means.',
    whenToUse: [
      'HTTP/2 or /3 wherever clients make many concurrent requests to one origin.',
      'HTTP/3 specifically for mobile, lossy or high-latency links, and clients that change network mid-session.',
      'HTTP/1.1 for hand-debugging and for intermediaries that speak nothing newer.',
    ],
    whenNotToUse: [
      'As a fix for API design, resource modelling or server-side latency — those live at a different layer entirely.',
      'HTTP/3 for intra-datacentre traffic with negligible loss and long-lived connections, where it costs CPU and buys nothing.',
    ],
    alternatives: [
      'Fewer requests: batching or composed endpoints delete round trips outright, at the cost of cacheability and coupled failures.',
      'Persistent streams (WebSockets, gRPC streaming) when the interaction is not request/response at all.',
      'Serving from an edge, which shortens every round trip regardless of protocol version.',
    ],
    tradeoffs: [
      'Multiplexing removes request contention and concentrates loss impact onto one connection.',
      'QUIC isolates loss and survives network changes, and costs more CPU per byte plus a UDP fallback path.',
      'Binary framing gives free message boundaries and makes casual wire inspection harder.',
      'Bundling reduces requests and destroys cache granularity — a good trade under HTTP/1.1 and usually a bad one after.',
    ],
    failureModes: [
      'HTTP/2 on a lossy link: one lost segment stalls every in-flight stream.',
      'HTTP/1.1-era workarounds left in place: sharding and bundling now costing more than they save.',
      'Connection coalescing breaking per-host assumptions in rate limiting or connection accounting.',
      'Code parsing the HTTP/1.1 request line or comparing header names case-sensitively, broken by HTTP/2 framing.',
      'UDP blocked on a network path, so HTTP/3 silently falls back and the expected improvement never appears.',
    ],
    followUpQuestions: [
      'Which layer does the change you are proposing sit at — semantics, framing, or transport?',
      'Does head-of-line blocking still exist in your setup, and at which layer?',
      'Which of your delivery optimisations were solving a constraint that no longer exists?',
      'Which requests was this change supposed to help, and did you measure those specifically?',
      'What does your client do on a network where UDP is blocked?',
    ],
  },
});
