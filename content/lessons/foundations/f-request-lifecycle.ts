import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-request-lifecycle',
  title: 'How a request actually travels',
  summary:
    'Every hop between a URL and the first byte of a response, why the total is measured in round trips rather than megabits, and which later component is inserted into which hop.',
  phase: 'foundations',
  module: 'networking',
  position: 1,
  kind: 'concept',
  difficulty: 'intro',
  estimatedMinutes: 45,
  tags: ['request-lifecycle', 'dns', 'tcp', 'tls', 'latency', 'http'],
  prerequisites: [],
  resources: [
    {
      key: 'mdn-http-overview',
      tier: 'must',
      note: 'Read it for the shape of the request/response cycle only. Skip the header catalogue; you will meet those headers when a lesson needs them.',
    },
    {
      key: 'latency-numbers',
      tier: 'must',
      note: 'Set the year slider to the current one and memorise three numbers: same-datacentre round trip, cross-continent round trip, disk seek. Every estimation you do rests on these.',
    },
    {
      key: 'rfc-8446-tls13',
      tier: 'good',
      note: 'Section 2 alone. It shows the 1-RTT handshake and 0-RTT resumption as message flows, which is the part that matters for latency budgets.',
    },
    {
      key: 'web-almanac-http',
      tier: 'good',
      note: 'Real measured adoption of HTTP/2 and HTTP/3 across the web, so your claims about protocol versions are grounded rather than assumed.',
    },
  ],

  intuition: {
    body: `You type a URL and press enter. It feels like one action. It is at least four separate conversations, each one a full trip across the planet and back before the next one can start.

Think about asking a question inside a building you have never visited. First you find the address. Then you get through the front door, which means someone has to see you and let you in. Then you find a private room, because you would rather not ask your question in the lobby. Only then do you ask, and only then does the answer come back.

Four steps, in a fixed order, none of which can be skipped or overlapped on a first visit. That order is the whole lesson:

1. **DNS** — turn \`api.example.com\` into an IP address.
2. **TCP** — open a connection to that address.
3. **TLS** — negotiate encryption on that connection.
4. **HTTP** — finally, send the request and read the response.

The reason this matters is not trivia. Each of those four steps costs a *round trip*: your packet travels to the other machine and its reply travels back. Round trips are governed by distance and the speed of light in fibre, and they do not get cheaper when you buy a bigger server or a fatter pipe. A user 100 ms away pays roughly 400 ms before the first byte of your response arrives, and about 390 ms of that has nothing to do with your code.

Almost every performance component you will meet later — CDNs, connection pools, keep-alive, edge TLS termination, anycast — exists to delete one of those four round trips or to move it closer.`,
    analogyLimit:
      'The building analogy hides the only number that matters: distance. Walking to a different room in a building is free; sending a packet to Frankfurt and back is not. Drop the building now and think in round trips, because that is the unit every later trade-off is priced in.',
  },

  deepExplanation: {
    predict: {
      question:
        'A user in Mumbai loads a page from your server in Virginia. Round-trip time between them is 200 ms. The server does 20 ms of work. Nothing is cached anywhere. Roughly how long until the browser has the first byte of the response — and what fraction of that is your application code?',
      answer: `Roughly **820 ms**, of which **20 ms** — about 2.5% — is your code.

The breakdown, assuming a cold start with no DNS cache and no existing connection:

| Step | Round trips | Cost at 200 ms RTT |
| --- | --- | --- |
| DNS resolution (recursive resolver already knows the TLD, one trip to the authoritative server) | 1 | 200 ms |
| TCP handshake (SYN → SYN-ACK → ACK; the client can send after the second message) | 1 | 200 ms |
| TLS 1.3 handshake | 1 | 200 ms |
| HTTP request → first byte of response | 1 | 200 ms |
| Server work | — | 20 ms |
| **Total** | **4** | **≈ 820 ms** |

Two conclusions follow, and both drive real architecture decisions.

First, optimising the server from 20 ms to 10 ms changes the user's experience by 1.2%. Moving the connection endpoint from Virginia to Mumbai — so RTT drops to 10 ms — changes it by roughly 95%. This is why "put a CDN in front of it" is often the highest-leverage single change, and why it is *not* the right answer when the response cannot be served from an edge.

Second, the second request on the same connection costs one round trip, not four. Connection reuse is worth about 600 ms here. That is the entire justification for keep-alive, HTTP/2 multiplexing, and server-side connection pools.`,
    },
    body: `## The URL is a set of instructions

\`https://api.example.com:443/v1/orders?status=open\` is not a location. It is four separate instructions to four different layers:

- \`https\` — which application protocol, and therefore that TLS is required.
- \`api.example.com\` — a name that must be resolved to an address before anything can happen.
- \`:443\` — which port on that address (implied by the scheme here).
- \`/v1/orders?status=open\` — the only part your application ever sees.

Everything before the path happens before your code is invoked. Engineers who only ever debug the path spend a lot of time confused about latency.

## Step 1 — DNS: a name becomes an address

Your process asks the operating system's *stub resolver* for \`api.example.com\`. The stub resolver checks its cache. If it misses, it asks a *recursive resolver* — usually your ISP's, your corporate network's, or a public one.

The recursive resolver is the one that does the work, and it walks a hierarchy:

- A **root** server answers "I don't know, but here are the nameservers for \`.com\`."
- A **TLD** server answers "I don't know, but here are the nameservers for \`example.com\`."
- The **authoritative** server for \`example.com\` answers "\`api.example.com\` is 203.0.113.10."

In practice the recursive resolver already has the root and TLD answers cached — those TTLs are measured in days — so a real cold lookup is usually *one* round trip to the authoritative server, not three.

Every answer carries a **TTL**. A 300-second TTL means resolvers may serve that address for five minutes without asking again. This is the mechanism, and the trap:

> **DNS TTL is a promise you cannot revoke.** If you plan to fail over by changing a DNS record, your worst-case failover time is bounded below by the TTL — and in practice by resolvers and client libraries that ignore TTLs and cache longer.

Systems that need fast failover therefore do not fail over with DNS. They put a stable address in DNS (often an **anycast** address, announced from many locations at once) and move traffic behind it, where the change takes effect in seconds rather than minutes.

Negative answers are cached too. A typo'd hostname stays broken for the negative-cache TTL even after you create the record. This is why "I created the DNS record but it still doesn't work" is almost always answered with "wait."

## Step 2 — TCP: a connection is established

With an IP address, the client opens a TCP connection. The three-way handshake is:

1. Client → Server: \`SYN\` (I want to talk, here is my starting sequence number)
2. Server → Client: \`SYN-ACK\` (fine, here is mine)
3. Client → Server: \`ACK\` (acknowledged)

The client can begin sending immediately after receiving the \`SYN-ACK\`, so the *cost before useful data* is one round trip, not one and a half.

Two properties of TCP matter for design:

**It is a stream, not a message boundary.** TCP guarantees bytes arrive in order and complete. It does not tell you where one message ends and the next begins — that is HTTP's job, or your protocol's. Every "I read half a JSON object" bug lives here.

**It starts slow on purpose.** TCP does not know the capacity of the path, so it begins with a small congestion window (typically 10 packets, ~14 KB) and doubles it each round trip until something is lost. A 200 KB response over a fresh connection is not one transfer; it is several round trips of ramp-up. This is *slow start*, and it is a second, separate reason that connection reuse is valuable: a warm connection has already paid for its window.

## Step 3 — TLS: the connection becomes private

TLS 1.3 completes its handshake in one round trip. The client sends its supported parameters and a key share; the server replies with its certificate, its key share, and a \`Finished\` message. Application data can flow with the client's next packet.

TLS 1.2 needed two round trips, which is why the upgrade to 1.3 produced a measurable latency win across the web rather than a purely cryptographic one.

Session resumption can bring this to **0-RTT**: a returning client sends application data in its very first packet, encrypted with a key derived from the previous session. It is not free — 0-RTT data is replayable by an attacker who captures it, so it must only carry idempotent requests. That constraint is the first time in this curriculum that **idempotency** turns out to be a protocol-level requirement rather than an application nicety. It will not be the last.

What TLS gives you: confidentiality, integrity, and authentication *of the server* (the certificate proves the server owns that hostname). What it does not give you: any statement about what happens to the data after it is decrypted. That distinction becomes load-bearing the moment you terminate TLS at an edge proxy — from that point on, the traffic between the edge and your origin is a separate trust decision that you have to make explicitly.

## Step 4 — HTTP: the request finally happens

Only now does anything resembling your API exist. The client sends a request line, headers and optionally a body; the server replies with a status line, headers and a body.

HTTP is stateless by design: each request carries everything needed to interpret it. Sessions, cookies and tokens are all ways of re-supplying state that the protocol deliberately does not keep. That design choice is why horizontal scaling of web servers is easy and why the hard state problems get pushed down into your data layer, where the rest of this curriculum lives.

## Putting the numbers together

For a client 100 ms away from the server, first-byte latency looks like this:

| Scenario | Round trips | Time to first byte |
| --- | --- | --- |
| Cold: no DNS cache, new connection | 4 | ~400 ms + server time |
| Warm DNS, new connection | 3 | ~300 ms + server time |
| Warm DNS, reused connection | 1 | ~100 ms + server time |
| Served from an edge 5 ms away, connection reused | 1 | ~5 ms |

Read that table again, because it is the single most useful thing in this lesson. **Latency is dominated by round trips and distance, not by bandwidth or CPU.** Doubling your bandwidth does nothing to the first three rows. Doubling your server speed changes the "+ server time" term only.

Bandwidth matters for *throughput* — how much data per second, once flowing. Latency matters for *responsiveness*. Conflating them is the most common estimation error in system design interviews, and it produces designs that add capacity to solve a problem caused by distance.

## Where every later component plugs in

This is the payoff. Each of the four steps is an insertion point, and the components you will spend the rest of this curriculum learning are inserted into exactly one of them:

| Hop | What gets inserted | What it actually buys |
| --- | --- | --- |
| DNS | GeoDNS, anycast addressing | Sends the client to a *nearer* endpoint, shrinking every subsequent round trip. |
| DNS | Service discovery | Lets internal callers find healthy instances without hard-coded addresses. |
| TCP | Connection pools, keep-alive, HTTP/2 | Deletes handshake round trips and reuses a warmed congestion window. |
| TCP | L4 load balancer | Spreads connections across servers without inspecting the request. |
| TLS | Edge termination, mTLS | Moves the handshake close to the user; makes service-to-service identity explicit. |
| HTTP | CDN, cache headers | Answers without reaching your origin at all — deleting all four hops. |
| HTTP | L7 load balancer, API gateway | Routes on path/host/header; enforces auth and rate limits before your code runs. |

When someone in an interview says "add a CDN", the correct follow-up is *which hop are you deleting, and for which requests?* A CDN in front of a personalised, authenticated, uncacheable API deletes nothing and adds a hop. A CDN in front of static assets and cacheable reads deletes all four.

## What goes wrong

**Connection storms after a deploy.** Restart every instance at once and every client reconnects at once. Each reconnection costs a TCP and a TLS handshake, and TLS handshakes are CPU-expensive on the server side. A fleet that comfortably serves 50,000 warm connections can fall over trying to establish 50,000 cold ones. The fix is staggered restarts and connection draining — both of which only make sense once you know the handshake is the expensive part.

**Timeouts set without knowing the budget.** A 100 ms client timeout against a server 100 ms away can never succeed on a cold connection. Timeouts have to be set against the whole path, not the server's own processing time.

**"DNS round-robin gives us load balancing and failover."** It gives you neither reliably. Clients cache aggressively, ignore TTLs, and have no idea whether an address is healthy. Round-robin DNS spreads load statistically at best, and during a failure it keeps sending a share of traffic into the dead instance until every cache expires.

**Debugging the wrong layer.** "The API is slow" is answered by knowing whether time went to DNS, to connection setup, to server processing, or to transfer. This is exactly why distributed tracing exists, and why the first span in a trace should start before the request reaches your code, not after.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'cold-request',
      title: 'A cold request, drawn in round trips',
      caption:
        'Notice that nothing is overlapped. Each dashed reply must arrive before the next solid arrow can leave, which is why the total is four round trips rather than four small delays. The server does 20 ms of work at the very bottom.',
      code: `sequenceDiagram
    autonumber
    participant C as Client
    participant R as Recursive resolver
    participant A as Authoritative DNS
    participant S as Server (100 ms away)

    Note over C,S: RTT to server = 100 ms
    C->>R: Who is api.example.com?
    R->>A: Who is api.example.com?
    A-->>R: 203.0.113.10 (TTL 300)
    R-->>C: 203.0.113.10
    Note right of C: ≈100 ms spent

    C->>S: TCP SYN
    S-->>C: SYN-ACK
    Note right of C: ≈200 ms spent

    C->>S: TLS ClientHello + key share
    S-->>C: ServerHello, certificate, Finished
    Note right of C: ≈300 ms spent

    C->>S: GET /v1/orders
    Note over S: 20 ms of application work
    S-->>C: 200 OK, first byte
    Note right of C: ≈420 ms to first byte`,
    },
    {
      kind: 'flow',
      id: 'insertion-points',
      title: 'The four hops, and what gets inserted into each',
      caption:
        'Walk the steps. Each one highlights a hop and the components that live there. The point to notice: a component only helps if it removes work from the hop it sits on — a CDN cannot help a request that must reach your database.',
      nodes: [
        { id: 'client', label: 'Client', kind: 'client', x: 0, y: 120, detail: 'Browser, mobile app or another service. Holds the DNS cache and the connection pool that decide how much of this diagram runs at all.' },
        { id: 'dns', label: 'DNS resolution', kind: 'external', x: 190, y: 20, detail: 'GeoDNS and anycast live here. They do not make the request faster; they make the remaining round trips shorter by choosing a nearer endpoint.' },
        { id: 'edge', label: 'Edge / CDN', kind: 'edge', x: 190, y: 200, detail: 'Terminates TCP and TLS close to the user. A cache hit here answers without any of the downstream hops running at all.' },
        { id: 'lb', label: 'Load balancer', kind: 'edge', x: 400, y: 200, detail: 'L4 spreads connections; L7 reads the request and can route, retry and rate-limit. L7 costs a little latency and buys a lot of control.' },
        { id: 'gw', label: 'API gateway', kind: 'service', x: 600, y: 200, detail: 'Authentication, rate limiting and request shaping, executed before your application code is reached.' },
        { id: 'app', label: 'Application', kind: 'service', x: 800, y: 200, detail: 'The only hop that runs your code. In the worked example it accounts for 20 ms of 820 ms.' },
        { id: 'db', label: 'Database', kind: 'store', x: 990, y: 200, detail: 'Usually in the same datacentre as the application, so its round trips are sub-millisecond — which is exactly why co-location matters.' },
      ],
      edges: [
        { id: 'e-dns', source: 'client', target: 'dns', label: 'resolve', kind: 'control' },
        { id: 'e-edge', source: 'client', target: 'edge', label: 'TCP + TLS', kind: 'sync' },
        { id: 'e-lb', source: 'edge', target: 'lb', label: 'on cache miss', kind: 'sync' },
        { id: 'e-gw', source: 'lb', target: 'gw', kind: 'sync' },
        { id: 'e-app', source: 'gw', target: 'app', kind: 'sync' },
        { id: 'e-db', source: 'app', target: 'db', label: 'query', kind: 'read' },
      ],
      steps: [
        {
          id: 's1',
          title: 'DNS decides how far everything else has to travel',
          description:
            'Before a single byte of your protocol moves, the name is resolved. GeoDNS and anycast are inserted here, and their only job is to hand back an address that is physically closer. Every round trip after this is priced by that choice.',
          nodes: ['client', 'dns'],
          edges: ['e-dns'],
        },
        {
          id: 's2',
          title: 'TCP and TLS terminate at the nearest thing that can terminate them',
          description:
            'If an edge exists, the three handshake round trips are paid against 5 ms rather than 100 ms. This is the largest single latency win available, and it is why edge termination shows up in designs that have no caching requirement at all.',
          nodes: ['client', 'edge'],
          edges: ['e-edge'],
        },
        {
          id: 's3',
          title: 'A cache hit ends the story here',
          description:
            'If the edge can answer, nothing to the right of it runs. That is the real value of a CDN: not that it is fast, but that it deletes hops. It follows that a CDN is worthless for requests that are personalised or must be strongly consistent.',
          nodes: ['edge'],
          edges: [],
        },
        {
          id: 's4',
          title: 'Only on a miss does your infrastructure get involved',
          description:
            'Load balancer, gateway and application each add a hop inside your own network, where round trips are sub-millisecond. This is why adding an internal service is cheap in latency and expensive in operational complexity — the opposite trade-off to adding a hop across the internet.',
          nodes: ['lb', 'gw', 'app', 'db'],
          edges: ['e-lb', 'e-gw', 'e-app', 'e-db'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Netflix Open Connect'],
    body: `Netflix publishes the architecture of Open Connect, its own content delivery network. The design decision worth studying is not the caching — it is *where the connection terminates*.

Open Connect appliances are placed inside internet service provider networks, physically close to subscribers. When a client streams, the TCP and TLS handshakes complete against a machine that may be a single-digit number of milliseconds away rather than a datacentre on another continent. The four-round-trip setup cost that dominates a cold request collapses from hundreds of milliseconds to tens.

The control plane does not move. Deciding which titles a user may watch, which appliance should serve them, and recording that a play started all remain in the cloud, because those operations need data that cannot be replicated to thousands of edge locations and kept correct. Netflix's architecture therefore splits along exactly the line this lesson draws: the *bytes* are served from a hop close to the user, while the *decisions* are served from a hop close to the data.

That split is the generic pattern, and you should reach for it whenever a design has a large, cacheable payload and a small, personalised decision:

- Put the payload where the round trips are short.
- Put the decision where the truth lives.
- Connect them with a request that happens once, not once per byte.

AWS CloudFront's documentation describes the same structure from the other side: the cache key determines whether the edge can answer at all, and every header, cookie or query parameter you add to that key multiplies the number of distinct objects the edge must store — which lowers hit rate, which sends more requests back through all four hops. Cacheability is not a property of your content; it is a property of how much of the request you agreed to vary on.`,
  },

  tradeoffs: {
    intro:
      'The options below all address the same problem — too many round trips, each too long. They are listed cheapest-first, and the first row is the one most designs should stay on.',
    rows: [
      {
        option: 'Do nothing: direct client → origin, new connection each time',
        whenItWins:
          'Internal services in one datacentre (RTT under 1 ms), low request rates, or any system where correctness matters more than the 300 ms of setup.',
        whenItLoses: 'Users far from the origin, or chatty clients making many small requests.',
        cost: 'Zero infrastructure. Costs 3–4 round trips per request and a TLS handshake of server CPU each time.',
      },
      {
        option: 'Connection reuse: keep-alive, HTTP/2, server-side pools',
        whenItWins:
          'Almost always. Any client that makes more than one request to the same host, which is every client.',
        whenItLoses:
          'Rarely — but pools hold sockets open against dead servers, so failure detection must not rely on connection failure alone.',
        cost:
          'Memory per idle connection on both ends, plus pool-sizing and idle-timeout configuration that must agree with the server’s own timeouts.',
      },
      {
        option: 'CDN with edge TLS termination',
        whenItWins:
          'Large or repeated payloads, static assets, cacheable reads, geographically spread users.',
        whenItLoses:
          'Personalised, authenticated or strongly consistent responses — the hit rate collapses and you have added a hop plus a new failure domain.',
        cost:
          'Money per GB, cache invalidation becomes your problem, and a second copy of the truth exists that can be stale.',
      },
      {
        option: 'Anycast address plus regional origins',
        whenItWins:
          'When failover must happen in seconds and DNS TTLs are too slow, or when you need users routed to a nearby region automatically.',
        whenItLoses:
          'Small deployments — the operational cost of running BGP announcements and multi-region state dwarfs the benefit.',
        cost:
          'Significant operational complexity, multi-region data consistency problems, and a much larger blast radius when routing is misconfigured.',
      },
      {
        option: 'Reduce the number of requests (batch, coalesce, embed)',
        whenItWins:
          'Chatty clients on high-latency links — mobile especially. Deleting a request removes a whole round trip and always beats making it faster.',
        whenItLoses:
          'When batching couples independent failures together, so one slow item delays a response that could have been partially useful.',
        cost:
          'API design complexity, harder caching (a batch response is a unique object), and partial-failure semantics you now have to define.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The API is slow, so I would put it behind a CDN."',
      whyWeak:
        'It names a component without naming the hop it removes. A CDN only helps if a meaningful share of requests can be answered without reaching the origin. For an authenticated, per-user API the hit rate is near zero, so the CDN adds a hop, adds a failure domain, adds cost, and removes nothing.',
      strongAnswer:
        '"First I would find where the time goes: DNS, connection setup, server processing, or transfer. If it is setup, connection reuse or edge termination helps. If it is server processing, a CDN does nothing unless the responses are cacheable — and for a per-user API they are not, so I would look at the query path instead."',
    },
    {
      weakAnswer:
        '"We can handle the load, we have a 10 Gbps link."',
      whyWeak:
        'Confuses bandwidth with latency. Bandwidth determines throughput once data is flowing; latency determines how long before it starts. A 10 Gbps link does not make a 200 ms round trip any shorter, and most user-perceived slowness on small responses is round trips, not saturation.',
      strongAnswer:
        '"Bandwidth is fine for the payload size, but the request is latency-bound: four round trips at 200 ms each. I would attack the round trips — reuse connections and terminate closer to the user — before adding capacity."',
    },
    {
      weakAnswer: '"We fail over by updating the DNS record."',
      whyWeak:
        'Failover time is then bounded below by the TTL, and in practice by clients and resolvers that cache beyond it. A five-minute TTL is a five-minute outage floor, and some JVM and library defaults have historically cached DNS results for the process lifetime.',
      strongAnswer:
        '"DNS is for the stable entry point, not for failover. I would keep an anycast or load-balancer address in DNS with a long TTL and move traffic behind it, so failover takes effect in seconds and does not depend on client cache behaviour."',
    },
    {
      weakAnswer: '"We terminate TLS at the load balancer, so the traffic is encrypted."',
      whyWeak:
        'It is encrypted up to the load balancer. What happens between the load balancer and the services behind it is a separate decision that this sentence quietly skips — and in a shared network or a multi-tenant environment, that leg is exactly where a reviewer will press.',
      strongAnswer:
        '"We terminate at the edge for latency, and re-encrypt to the origin. Inside the mesh, services authenticate each other with mTLS, so identity does not depend on network position. The threat model I am defending against is an attacker who is already inside the network perimeter."',
    },
    {
      weakAnswer:
        '"I set the client timeout to 100 ms so we fail fast."',
      whyWeak:
        'On a cold connection to a server 100 ms away, 100 ms is not enough to complete the handshakes, let alone the request. Every first request fails, the client retries, and the retries create the load spike the timeout was meant to prevent.',
      strongAnswer:
        '"I would set the timeout against the whole path, not the server’s processing time: connection setup plus request plus a margin. And I would separate the connect timeout from the read timeout, because they fail for different reasons and deserve different budgets."',
    },
  ],

  flashcards: [
    {
      id: 'fc-req-1',
      front: 'On a cold connection, how many round trips happen before the first byte of an HTTP response?',
      back: 'Four: DNS resolution, TCP handshake, TLS 1.3 handshake, and the request itself. Warm DNS removes one; a reused connection removes two more, leaving one.',
      topic: 'request-lifecycle',
    },
    {
      id: 'fc-req-2',
      front: 'Why can you not fail over quickly by changing a DNS record?',
      back: 'Resolvers and clients may serve the cached answer for the full TTL, and many cache beyond it. The TTL is a floor on failover time that you cannot revoke once published.',
      topic: 'dns',
    },
    {
      id: 'fc-req-3',
      front: 'What does TCP slow start cost you, and why does connection reuse fix it?',
      back: 'A new connection begins with a small congestion window (~10 packets) and doubles it per round trip, so a large first response takes several round trips to ramp. A reused connection has already grown its window.',
      topic: 'tcp',
    },
    {
      id: 'fc-req-4',
      front: 'What is the latency difference between TLS 1.2 and TLS 1.3, and what is 0-RTT?',
      back: 'TLS 1.2 needs two round trips, TLS 1.3 needs one. 0-RTT resumption sends application data in the first packet using a key from a previous session — but that data is replayable, so it must be idempotent.',
      topic: 'tls',
    },
    {
      id: 'fc-req-5',
      front: 'Bandwidth or latency: which one does adding a CDN primarily address?',
      back: 'Latency, by shortening every round trip and by deleting hops entirely on a cache hit. It helps bandwidth costs too, but the first-order win is distance.',
      topic: 'latency',
    },
    {
      id: 'fc-req-6',
      front: 'Why does a personalised, authenticated API get little benefit from a CDN?',
      back: 'The cache key must vary on the user, so almost every request is unique. Hit rate approaches zero, and you have added a hop, a cost and a failure domain for nothing.',
      topic: 'latency',
    },
    {
      id: 'fc-req-7',
      front: 'What is the operational risk of restarting a whole fleet at once?',
      back: 'A connection storm: every client reconnects simultaneously, and each reconnection costs a TCP handshake plus a CPU-expensive TLS handshake. A fleet that serves warm connections comfortably can fail establishing cold ones.',
      topic: 'tcp',
    },
    {
      id: 'fc-req-8',
      front: 'Which hop does an L7 load balancer sit on, and what does that buy over an L4 one?',
      back: 'HTTP. It can read path, host and headers, so it can route, retry, rate-limit and terminate TLS. An L4 balancer only sees connections, so it is cheaper and blinder.',
      topic: 'http',
    },
    {
      id: 'fc-req-9',
      front: 'Why is HTTP statelessness relevant to scaling?',
      back: 'Each request carries what is needed to interpret it, so any server can handle any request and web tiers scale horizontally. The state problem does not disappear — it is pushed into the data layer.',
      topic: 'http',
    },
  ],

  quiz: [
    {
      id: 'q-req-1',
      kind: 'scenario',
      prompt:
        'Your mobile app makes 8 small API calls when it opens. Users in Southeast Asia report a slow launch; your servers are in Europe, RTT ≈ 180 ms, and server-side p99 is 25 ms. Which change removes the most launch latency?',
      options: [
        { id: 'a', label: 'Scale the API tier from 4 to 12 instances' },
        { id: 'b', label: 'Ensure all 8 calls reuse one connection, and collapse them into fewer requests' },
        { id: 'c', label: 'Increase the server’s network bandwidth' },
        { id: 'd', label: 'Add a read replica of the database in Europe' },
      ],
      correct: ['b'],
      explanation:
        'Server time is 25 ms of roughly 750+ ms. The launch is dominated by handshakes and per-request round trips. Reusing one connection removes the repeated TCP and TLS setup; collapsing 8 requests into 2 removes 6 further round trips. Scaling instances, adding bandwidth or adding a replica all address capacity or server-side time, which is not where the latency is.',
      difficulty: 'core',
      topic: 'latency',
    },
    {
      id: 'q-req-2',
      kind: 'scenario',
      prompt:
        'You publish an A record with a 60-second TTL so you can fail over quickly. During a real incident, 20% of traffic still reaches the dead host 30 minutes later. What is the most likely explanation?',
      options: [
        { id: 'a', label: 'The TTL was ignored — some resolvers and client runtimes cache DNS answers far longer than the TTL' },
        { id: 'b', label: 'The TCP handshake succeeded against the dead host' },
        { id: 'c', label: 'TLS session resumption bypassed DNS' },
        { id: 'd', label: 'The negative cache TTL was too short' },
      ],
      correct: ['a'],
      explanation:
        'DNS TTL is advisory in practice. Corporate resolvers, some CDNs and several language runtimes have historically cached entries for far longer — some for the lifetime of the process. This is exactly why failover is done behind a stable address rather than by changing DNS records.',
      difficulty: 'core',
      topic: 'dns',
    },
    {
      id: 'q-req-3',
      kind: 'single',
      prompt: 'How many round trips does a TLS 1.3 handshake require before application data can be sent (without resumption)?',
      options: [
        { id: 'a', label: 'Zero' },
        { id: 'b', label: 'One' },
        { id: 'c', label: 'Two' },
        { id: 'd', label: 'Three' },
      ],
      correct: ['b'],
      explanation:
        'TLS 1.3 completes in one round trip: the client sends its key share with ClientHello, and the server replies with everything needed to finish. TLS 1.2 needed two. Zero is only possible with 0-RTT resumption, which carries a replay risk and so is restricted to idempotent requests.',
      difficulty: 'intro',
      topic: 'tls',
    },
    {
      id: 'q-req-4',
      kind: 'scenario',
      prompt:
        'A deploy restarts all 60 API instances within 10 seconds. CPU on the new instances immediately saturates even though request volume is unchanged. What is the most likely cause?',
      options: [
        { id: 'a', label: 'A connection storm: every client re-handshakes at once, and TLS handshakes are CPU-expensive' },
        { id: 'b', label: 'The database ran out of connections' },
        { id: 'c', label: 'DNS resolution failed and clients retried' },
        { id: 'd', label: 'Slow start reduced throughput below what the CPU could handle' },
      ],
      correct: ['a'],
      explanation:
        'Steady-state traffic on warm connections costs almost no handshake CPU. Killing every connection at once forces tens of thousands of simultaneous TLS handshakes, whose asymmetric cryptography is the expensive part. The fix is staggered restarts with connection draining, not more CPU.',
      difficulty: 'advanced',
      topic: 'tcp',
    },
    {
      id: 'q-req-5',
      kind: 'multi',
      prompt:
        'Which of the following are removed for a client whose request is answered by a CDN edge cache hit? Select all that apply.',
      options: [
        { id: 'a', label: 'The round trips to your origin' },
        { id: 'b', label: 'Your application’s processing time' },
        { id: 'c', label: 'The TLS handshake' },
        { id: 'd', label: 'Your database query' },
      ],
      correct: ['a', 'b', 'd'],
      explanation:
        'A cache hit means the origin, the application and the database are never reached. The TLS handshake is not removed — it still happens, but against the edge rather than the origin, which is why it becomes cheap rather than free.',
      difficulty: 'core',
      topic: 'latency',
    },
    {
      id: 'q-req-6',
      kind: 'scenario',
      prompt:
        'A service-to-service call inside one datacentre has an RTT of 0.5 ms. Your team proposes adding a caching layer in front of it to "reduce latency". What is the strongest objection?',
      options: [
        { id: 'a', label: 'The round trip is already negligible; the cache adds a second source of truth and an invalidation problem to save almost nothing' },
        { id: 'b', label: 'Caches cannot be used for internal services' },
        { id: 'c', label: 'The cache will increase bandwidth usage' },
        { id: 'd', label: 'TLS termination would have to move' },
      ],
      correct: ['a'],
      explanation:
        'At 0.5 ms the network cost is not the problem. A cache is justified by expensive *work* (a slow query, an expensive computation) or by protecting a fragile dependency — not by a sub-millisecond round trip. Adding one here buys a stale-data class of bug for no measurable gain.',
      difficulty: 'advanced',
      topic: 'latency',
    },
  ],

  exercises: [
    {
      id: 'ex-req-1',
      kind: 'estimate',
      title: 'Budget the latency, then decide where to spend',
      estimatedMinutes: 18,
      prompt: `A B2B dashboard is served from a single region in Frankfurt. Your largest customer's staff are in São Paulo, RTT ≈ 210 ms. Loading the dashboard makes:

- 1 HTML request (12 KB)
- 6 static asset requests (total 900 KB, unchanged for months)
- 4 API requests returning per-user data (2–30 KB each), p99 server time 40 ms

Assume a cold start: no DNS cache, no existing connections, HTTP/2 available, TLS 1.3.

Write out a latency budget for the page load. Then choose the two changes that remove the most milliseconds, and state what each one costs. Do not propose more than two.`,
      rubric: [
        'Separates the one-off setup cost (DNS + TCP + TLS ≈ 3 round trips ≈ 630 ms) from per-request cost.',
        'Recognises that HTTP/2 multiplexes the 6 asset requests over one connection, so they cost roughly one round trip plus transfer, not six round trips.',
        'Computes transfer time for 900 KB separately from latency, and notes TCP slow start means the first transfer does not reach full rate immediately.',
        'Identifies that static assets are cacheable and per-user API responses are not — and therefore that a CDN helps one group and not the other.',
        'Names exactly two changes and prices each: e.g. CDN/edge termination for assets and handshakes; and reducing the 4 API calls to 1–2.',
        'States a cost for each change (invalidation and staleness for the CDN; partial-failure semantics and cache-ability loss for batching).',
        'Does not propose scaling the server tier, which addresses 40 ms out of well over 1000 ms.',
      ],
      modelAnswer: `**Budget (cold load, RTT 210 ms)**

| Item | Cost | Reasoning |
| --- | --- | --- |
| DNS | ~210 ms | One round trip to the authoritative server; root and TLD are cached at the resolver. |
| TCP handshake | ~210 ms | One round trip before data can be sent. |
| TLS 1.3 handshake | ~210 ms | One round trip. |
| HTML request | ~210 ms + 40 ms | First byte after setup, plus server time. |
| 6 assets over HTTP/2 | ~210 ms + transfer | Multiplexed on the same connection: one round trip for all six, then transfer. |
| 900 KB transfer | ~300–600 ms | Depends on bandwidth *and* on slow start: the congestion window has to grow before the link is used fully. |
| 4 API calls | ~210 ms + 40 ms if parallel on the same connection | Multiplexed, so one round trip if issued together; ~840 ms if issued serially. |
| **Total** | **≈ 1.6–2.0 s** | Of which server processing is ~80–160 ms. |

The shape of the answer: **roughly 90% of the load is distance and setup.**

**Change 1 — Serve assets and terminate TLS at an edge near São Paulo.**
The 900 KB of unchanged static assets is the ideal CDN payload: high volume, zero personalisation, long cacheable lifetime. Moving termination to an edge ~15 ms away also collapses the three setup round trips from ~630 ms to ~45 ms, and that benefit applies to the API requests too, because they now ride a connection that is already established to the edge.
*Estimated saving: ~600 ms of setup plus most of the asset transfer time.*
*Cost:* a second source of truth for assets, so deployments must handle invalidation — usually solved with content-hashed filenames. Plus per-GB cost and a new failure domain.

**Change 2 — Collapse the 4 API calls into 1.**
Even multiplexed, four calls means four server round trips against the origin and four sets of query work. One call returning the dashboard payload removes three of those.
*Estimated saving: ~200–600 ms depending on whether the client currently issues them serially.*
*Cost:* the combined endpoint is harder to cache (one unique object per user), and partial failure now has to be designed — if one section's data is unavailable, the response should still return the rest with that section marked as failed rather than failing the whole page.

**What was deliberately not chosen.** Scaling the API tier addresses 40 ms of p99 server time out of ~1800 ms. Adding bandwidth addresses the transfer portion only, and slow start limits how much of that is reachable. A read replica in São Paulo would help, but it is a much larger commitment — multi-region data consistency — for a saving the edge already delivers on the cacheable majority of bytes.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-req-1',
      level: 'basic',
      question: 'Walk me through everything that happens between typing a URL and seeing the page.',
      guidance:
        'A strong answer names the four hops in order (DNS, TCP, TLS, HTTP), attaches a round-trip cost to each, and then says which of them are usually already paid — warm DNS cache, reused connection. Weak answers list steps without cost, so they cannot then reason about what to optimise. Mentioning that rendering is a fifth phase, separate from delivery, shows the candidate knows where the boundary of the backend problem is.',
    },
    {
      id: 'iq-req-2',
      level: 'basic',
      question: 'What is the difference between latency and bandwidth, and which one does adding servers help?',
      guidance:
        'Latency is time-to-first-byte, governed by distance and round trips. Bandwidth is bytes per second once flowing. Adding servers addresses neither directly — it addresses *capacity*, which shows up as queuing delay only when the system is loaded. A strong candidate immediately connects this to when scaling is and is not the right answer.',
    },
    {
      id: 'iq-req-3',
      level: 'intermediate',
      question: 'Your p99 API latency is 800 ms but the server reports 30 ms of processing. Where would you look?',
      guidance:
        'Look for the missing 770 ms outside the application: connection setup on cold clients, DNS, queueing before the request reaches the handler, TLS handshake CPU contention, or transfer time for a large response. A strong answer says the instrumentation is the real problem — the trace should start at the edge, not at the handler, or you cannot answer this question at all.',
    },
    {
      id: 'iq-req-4',
      level: 'intermediate',
      question: 'When would you not put a CDN in front of a service?',
      guidance:
        'When responses are personalised, authenticated, strongly consistent, or written more than read — the hit rate collapses and you have added a hop, a cost and a failure domain. A strong answer frames cacheability as a function of the cache key: every header or cookie you vary on multiplies stored objects and divides hit rate.',
    },
    {
      id: 'iq-req-5',
      level: 'advanced',
      question:
        'You terminate TLS at the edge. What is the security posture between the edge and your services, and how would you justify it?',
      guidance:
        'The candidate must recognise that TLS termination ends the client’s guarantee at the edge, and that the next leg is a separate, explicit decision. Strong answers name the threat model (an attacker already inside the network), propose re-encryption or mTLS for service identity, and note that authorisation must not depend on network position. Mentioning that mTLS costs certificate rotation and operational machinery shows balance.',
    },
    {
      id: 'iq-req-6',
      level: 'advanced',
      question:
        'Design the rollout of a change that restarts every instance in a fleet of 500, each holding thousands of persistent connections. What do you have to be careful about?',
      guidance:
        'The core risk is a connection storm: simultaneous TCP and TLS handshakes are CPU-expensive and can exceed the fleet’s capacity even at unchanged request volume. Strong answers propose staggered restarts, connection draining, jittered client reconnect with backoff, and capacity headroom sized for the reconnect rate rather than the steady-state rate. Excellent answers note that clients need jitter too, or the storm simply reappears from the other side.',
    },
    {
      id: 'iq-req-7',
      level: 'followup',
      question: 'You said you would reuse connections. What breaks when you do?',
      guidance:
        'Idle connections consume memory on both ends and can be held open against servers that are already gone, so failure detection cannot rely on connection failure. Client and server idle timeouts must agree, or the client will send on a socket the server has just closed and see a confusing reset. Load balancing also becomes coarser: with long-lived connections, traffic is distributed at connect time, so a new instance receives nothing until connections churn.',
    },
    {
      id: 'iq-req-8',
      level: 'followup',
      question: 'If DNS is such a poor failover mechanism, why is it still in every architecture?',
      guidance:
        'Because it solves a different problem: a stable, human-meaningful name for an entry point, resolvable by clients that share no code with you. The right framing is that DNS is for *addressing*, and traffic management belongs behind that address — in anycast routing, a load balancer, or a service mesh. A strong answer notes that GeoDNS is a legitimate use of DNS for coarse geographic routing, precisely because it does not need to change quickly.',
    },
  ],

  activeLearning: [
    {
      id: 'al-req-1',
      kind: 'what-changes-if',
      prompt:
        'You have modelled a request as 4 round trips at 100 ms. Now change one thing: the client is a server in the same datacentre as yours, RTT 0.4 ms, making 50,000 requests per second to your service. Which of the four hops still matters, and which optimisation from this lesson becomes the important one?',
      discussion: `Almost the whole lesson inverts.

DNS still matters, but not for latency — for *discovery and failure*. Internal name resolution that goes stale sends 50,000 requests per second at a dead instance, which is why internal systems use service discovery with health checking rather than plain DNS records.

The TCP and TLS handshakes stop mattering per-request and start mattering *in aggregate*. At 50,000 rps, even a 1% rate of new connections means 500 handshakes per second, whose asymmetric cryptography is measurable server CPU. So connection pooling stops being a latency optimisation and becomes a capacity optimisation — the same technique for an entirely different reason.

The CDN idea becomes irrelevant: there is no distance to remove and the payload is not shared between callers.

What becomes dominant instead is *queueing*. At 0.4 ms RTT, network time is noise; the observed latency is now the service's own processing plus time spent waiting behind other requests. This is the regime where the rest of this curriculum lives — caching to avoid work, backpressure to avoid unbounded queues, and rate limiting to protect the service from a single caller.

The transferable point: the same architecture diagram has completely different bottlenecks depending on where the client is. Always ask *where is the caller* before proposing a fix.`,
    },
    {
      id: 'al-req-2',
      kind: 'debug',
      prompt:
        'A team reports that their service is "fine on average but has terrible p99". Traces show the handler taking 20 ms consistently at every percentile. Client-side measurements show 25 ms at p50 and 1.4 s at p99. Nothing is overloaded — CPU is at 30%, no queue depth, no GC pauses. What single hypothesis explains this best, and what would you measure to confirm it?',
      discussion: `The gap between a flat server-side distribution and a bimodal client-side one means the extra time is being spent *outside the span you are measuring*. The most likely explanation is connection setup: p50 requests reuse a warm connection and cost one round trip, while p99 requests are the ones that had to establish a new connection and paid DNS plus TCP plus TLS.

That produces exactly this signature — a tight cluster at the warm cost, and a distant cluster at the cold cost, with almost nothing in between. Averages hide it because cold connections are a small fraction of requests. It is also why percentiles, not averages, are the only honest way to talk about latency.

What to measure to confirm it:

- Client-side connection metrics: new connections established per second, and latency broken down by whether the request reused a connection.
- The client's pool configuration: max idle connections, idle timeout, and whether it is smaller than the concurrency the client actually reaches.
- The server's idle timeout. If the server closes idle connections *before* the client's idle timeout, the client will keep discovering dead sockets and reconnecting. Mismatched timeouts on the two ends are the single most common cause of this pattern.

The fix is usually configuration rather than code: raise the pool size to cover peak concurrency, and make the client's idle timeout comfortably shorter than the server's.

The transferable lesson: when server-side and client-side distributions disagree, the answer is always in the part of the path you are not instrumenting. Extend the span before you optimise anything.`,
    },
  ],

  revision: {
    bullets: [
      'Four hops before your code runs: DNS → TCP → TLS → HTTP. Each costs a round trip on a cold path.',
      'Cold ≈ 4 RTT. Warm DNS ≈ 3 RTT. Reused connection ≈ 1 RTT. Edge hit ≈ 1 short RTT and nothing downstream runs.',
      'Latency is distance and round trips. Bandwidth is bytes per second once flowing. Capacity is a third thing. Never mix them.',
      'DNS TTL is a floor on failover time, and clients cache beyond it. Use DNS for addressing, not for traffic management.',
      'TLS 1.3 handshake = 1 RTT. 0-RTT resumption exists but is replayable, so it is only safe for idempotent requests.',
      'TCP slow start means a new connection cannot use full bandwidth immediately — a second reason connection reuse pays.',
      'Every component you will learn plugs into exactly one hop. Ask which hop it removes work from before adding it.',
      'A CDN only helps when responses are cacheable. Personalised or authenticated responses give near-zero hit rate.',
      'Cacheability is a property of your cache key. Every header or cookie you vary on divides your hit rate.',
      'Restarting a fleet at once causes a connection storm; TLS handshakes are the expensive part, not the requests.',
      'Timeouts must be budgeted against the whole path, and connect timeouts must be separate from read timeouts.',
      'When client-side and server-side latency distributions disagree, the missing time is outside your instrumented span.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The fixed sequence of network operations — DNS resolution, TCP handshake, TLS handshake, HTTP exchange — that must complete before an application response reaches a client.',
    whyItExists:
      'Each layer solves a problem the one below it does not: names for addresses, reliable ordered bytes for datagrams, confidentiality and server identity for a plain stream, and request semantics for a byte stream.',
    whenToUse: [
      'Any time you are asked why something is slow, before proposing a component.',
      'When setting timeouts, retries or connection pool sizes, all of which are priced in round trips.',
      'When deciding whether an edge, a cache or a nearer region is the right lever.',
    ],
    whenNotToUse: [
      'Reasoning about throughput or capacity — those are bandwidth and queueing questions, not round-trip questions.',
      'Intra-datacentre calls at sub-millisecond RTT, where setup cost matters in aggregate CPU rather than per-request latency.',
    ],
    alternatives: [
      'QUIC/HTTP-3 folds the transport and TLS handshakes together, cutting a round trip on a cold connection.',
      'Persistent bidirectional transports (WebSockets, gRPC streams) pay setup once and then avoid per-message round trips entirely.',
      'Removing the request altogether — batching, coalescing or embedding data — always beats making the request faster.',
    ],
    tradeoffs: [
      'Edge termination cuts setup latency but creates a second trust boundary and a cache that can be stale.',
      'Connection reuse removes handshakes but holds memory, hides dead peers, and makes load balancing coarser.',
      'Batching removes round trips but couples failures and makes responses harder to cache.',
    ],
    failureModes: [
      'Connection storms after a synchronised restart; TLS handshake CPU, not request volume, is the limit.',
      'DNS caching past TTL keeping traffic on a dead endpoint long after a failover.',
      'Client and server idle timeouts disagreeing, producing resets that look like random p99 spikes.',
      'Timeouts shorter than the cold-path setup cost, so first requests always fail and retries amplify load.',
    ],
    followUpQuestions: [
      'Which hop does your proposed component remove work from, and for what fraction of requests?',
      'What is your cache key, and what does that do to hit rate?',
      'How long is your failover bounded by DNS caching you do not control?',
      'Is your latency problem distance, work, or queueing — and what measurement tells them apart?',
      'What happens to your connection pool when the server restarts?',
    ],
  },
});
