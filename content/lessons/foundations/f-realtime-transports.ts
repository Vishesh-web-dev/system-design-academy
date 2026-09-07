import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-realtime-transports',
  title: 'Polling, long polling, SSE, WebSockets',
  summary:
    'Choosing a real-time transport is a decision about who owns connection state, not about which option has the lowest latency — and that ownership is what constrains how you scale and fail over.',
  phase: 'foundations',
  module: 'networking',
  position: 5,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['realtime', 'websockets', 'sse', 'polling', 'connections', 'fanout'],
  prerequisites: ['f-http-versions'],
  resources: [
    {
      key: 'mdn-sse',
      tier: 'must',
      note: 'Read the reconnection and Last-Event-ID sections. Automatic resumption with a cursor is the feature that makes SSE more than "streaming HTTP", and it is what you would otherwise build by hand.',
    },
    {
      key: 'rfc-6455-websocket',
      tier: 'must',
      note: 'Read the handshake and framing sections only. The upgrade dance explains why WebSockets need proxy support that plain HTTP does not.',
    },
    {
      key: 'slack-real-time',
      tier: 'must',
      note: 'A production account of connection ownership at scale: which server holds a client, and what has to happen when that server goes away. This is the problem the lesson is really about.',
    },
    {
      key: 'mdn-websockets-api',
      tier: 'good',
      note: 'The client-side contract. Useful for seeing exactly how little the API gives you — no acknowledgements, no resumption, no backpressure signal — and therefore what you must add.',
    },
    {
      key: 'high-scalability-whatsapp',
      tier: 'good',
      note: 'What holding millions of simultaneous connections costs in memory and tuning. Read it for the order-of-magnitude figures rather than the specific numbers.',
    },
  ],

  intuition: {
    body: `Four ways to get new data to a client, in increasing order of how much the server has to remember:

1. **Polling** — the client asks every N seconds. The server remembers nothing.
2. **Long polling** — the client asks and the server holds the request open until there is something to say. The server remembers one pending request.
3. **Server-sent events (SSE)** — one long-lived HTTP response that the server keeps writing to. The server remembers one open stream per client.
4. **WebSockets** — a bidirectional connection that stays open. The server remembers one open socket per client, plus whatever state that client's session needs.

The instinct is to rank these by latency and pick the best one. That instinct produces the wrong design, because latency is not what separates them in practice — a 1-second poll and a WebSocket differ by under a second, and for most features nobody notices.

What separates them is **who owns connection state, and what happens to it when a machine dies.**

With polling, any server can answer any request. Scale by adding servers; a deploy is unremarkable; a crash affects one request. With WebSockets, a specific client is attached to a specific process, which now holds state that exists nowhere else. Adding servers does not rebalance existing clients. A deploy disconnects everyone. A crash loses whatever that process knew.

So the real question is not "how fast do updates need to arrive?" It is: **do I need to push to a specific client, and am I willing to own the machinery that makes that survivable?** If the answer to the second half is no, you want polling, and you should say so confidently rather than apologetically.`,
    analogyLimit:
      'Ranking these as a ladder from primitive to sophisticated is the trap. Polling is not the beginner option — it is the option with no connection state, and that absence is a feature that buys you trivial scaling, trivial deploys and trivial failure handling. The ladder runs from "stateless and cheap" to "stateful and capable", and which end you want depends on the requirement, not on seniority.',
  },

  deepExplanation: {
    predict: {
      question:
        'A dashboard shows a metric that changes at most once a minute. 50,000 users have it open. Option A: poll every 5 seconds. Option B: WebSockets pushing on change. Estimate the request rate and the connection count for each, then say which you would ship and why.',
      answer: `**Option A — poll every 5 seconds.**
50,000 ÷ 5 = **10,000 requests/second**, essentially all returning "nothing changed". Zero long-lived connections. Every request is independent, so any server can serve it.

**Option B — WebSockets.**
**50,000 persistent connections**, and roughly **833 pushed messages/second** in aggregate (50,000 clients × 1 change/minute ÷ 60).

The push option looks dramatically better on request rate, and 10,000 rps of near-empty responses is genuinely wasteful. But the honest comparison has a third column:

| | Poll every 5s | WebSockets |
| --- | --- | --- |
| Requests/sec | 10,000 | ~830 pushes |
| Persistent connections | 0 | 50,000 |
| Scaling | Add servers, done | Existing clients do not rebalance |
| Deploy | Rolling, invisible | Disconnects 50,000 clients |
| Server crash | One request fails, client retries | Its clients all reconnect at once |
| Update latency | ≤ 5 s | ~0 s |

**What I would ship: polling — but every 30 seconds, not every 5.**

The data changes once a minute. A 5-second poll is 12× more often than the data can possibly change, which is why the request rate looked bad. At 30 seconds it is **1,667 requests/second** with a worst-case staleness of 30 seconds on data that is at most 60 seconds fresh anyway. Add \`ETag\` and conditional requests and most of those responses become 304s of a few hundred bytes.

That is the whole answer: the poll interval was the bug, not the choice of transport. 1,667 stateless requests per second is a rounding error for any modern service, and it costs nothing in scaling, deploys or failure handling.

**When I would change my mind:** if the requirement became "sub-second" (trading, live collaboration, presence), or if the client needed to *send* frequently too. Those are requirements that genuinely need a connection, and then the operational cost is worth paying.`,
    },
    body: `## Polling

The client requests on a timer. Nothing about it is clever, and that is the point.

**Cost model.** Request rate is clients ÷ interval, regardless of whether anything changed. 100,000 clients on a 10-second poll is 10,000 rps.

**What makes it cheap.** Every request is independent. Any server can serve any client. Load balancing is per request, so a new instance receives traffic immediately. A deploy is a rolling restart nobody notices. A crash costs one request. There is no connection state to lose because there is no connection state.

**How to make it cheaper.** Conditional requests (\`If-None-Match\` / \`ETag\`) turn unchanged responses into small 304s. Cache-friendly endpoints let a CDN absorb most of the traffic entirely. Both are much less work than switching transport.

**When it stops being viable.** When the interval you would need is short enough that the request rate hurts, or when the staleness is genuinely unacceptable. Note the order: check the request rate against your actual capacity before assuming it hurts.

## Long polling

The client sends a request; the server does not respond until there is data or a timeout (typically 30–60 seconds) elapses. On response, the client immediately reconnects.

**What it buys.** Near-immediate delivery without a new protocol. Works through anything that speaks HTTP.

**What it costs.** Every client holds an open request most of the time, so the server needs one suspended request per client — which requires a non-blocking server model. On a thread-per-request server, 100,000 clients means 100,000 blocked threads, which is not a system.

**The subtle problem.** Between the response arriving and the next request being established, there is a gap. Events occurring in that gap must be queued server-side or they are lost, which means the server needs a per-client cursor — the first piece of real connection state. Long polling is often described as "simple", and this is where that description breaks down.

## Server-sent events

One HTTP GET whose response never ends. The server writes \`data:\` frames as things happen; the client parses them as they arrive.

**What it buys over long polling.** No reconnect per message — one stream carries many events. And the browser API handles reconnection automatically, resending the \`Last-Event-ID\` header so the server can resume from the client's cursor. **That resumption is the feature**: it is the piece you would otherwise design and get wrong.

**Constraints.** Server-to-client only; the client uses ordinary requests to send. Text only, so binary must be encoded. Under HTTP/1.1, each SSE stream occupies one of the six connections per host — which is a real limit if a page opens several. Under HTTP/2 they multiplex and the limit disappears.

**Where it fits.** Notifications, live feeds, progress updates, streaming LLM responses — anything where the flow is overwhelmingly one-directional. It is under-used relative to how well it fits those cases, largely because WebSockets are better known.

## WebSockets

An HTTP request with \`Upgrade: websocket\` that, once accepted, becomes a bidirectional message-framed connection over the same TCP socket.

**What it buys.** Genuine bidirectionality with low per-message overhead — a few bytes of framing rather than a full header set. Binary support. The lowest achievable latency in both directions.

**What it costs, and this is the part that matters.**

*Connection state.* A client is attached to one specific process. That process holds the socket and whatever session state goes with it. Nothing else in the system knows about it.

*Routing becomes your problem.* To push to user 12345 you must know which server holds them. That means a registry — a shared store mapping user to server, kept current as clients connect and disconnect — or a broadcast fan-out where every server receives every message and discards what it does not own. The registry is more efficient and adds a dependency on the hot path; the broadcast is simpler and does not scale past a certain message rate. Choosing between them is the actual design decision behind "we'll use WebSockets".

*Load balancing gets coarse.* Distribution happens at connect time. A new instance stays idle until clients reconnect, so scaling out does not relieve existing pressure. Some systems ask clients to reconnect periodically purely to enable rebalancing.

*Deploys disconnect everyone.* Every restart drops every connection on that instance. Without staggering and jittered client reconnect, a deploy is a self-inflicted connection storm — and each reconnection costs a TCP and a TLS handshake, where the TLS handshake is CPU-expensive.

*The API gives you less than you think.* No acknowledgements, no delivery guarantees, no resumption, no backpressure signal. If a client stops reading, the server's send buffer grows until something breaks. Every one of those is yours to build.

*Infrastructure needs to cooperate.* Proxies, load balancers and corporate middleboxes must support the upgrade and long-lived connections. Idle timeouts on intermediaries silently kill connections, which is why production WebSocket deployments always carry a heartbeat.

## What the connection actually costs

Per connection, roughly: a file descriptor, socket buffers (kernel defaults are generous — tens of kilobytes each way), plus application state. A few kilobytes of tuned overhead per connection means a million connections needs gigabytes and deliberate kernel tuning. Achievable, and a project rather than a configuration change.

The number that surprises people is not memory but **reconnection rate**. A million idle connections is cheap. A million clients reconnecting within 30 seconds is 33,000 TLS handshakes per second, which is a different system entirely.

## Choosing

| Requirement | Transport |
| --- | --- |
| Updates every few seconds are fine | Polling with ETags |
| Near-immediate, server → client only | SSE |
| Near-immediate, bidirectional, high client message rate | WebSockets |
| Must work through hostile proxies | Long polling as a fallback |
| Streaming a response to one request | SSE |
| Presence, typing indicators, collaborative editing | WebSockets |

And two rules that catch most mistakes:

**Match the interval to the data, not to the transport.** Most polling that looks expensive is polling faster than the data can change.

**Do not adopt a connection until you can say who owns it when a process dies.** If you cannot answer that, you have chosen the transport before the design.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'transport-comparison',
      title: 'Four transports, drawn to the same timeline',
      caption:
        'Count the round trips per delivered event, and then count how many open things the server is holding. The first number improves down the diagram; the second gets worse, and the second is what you will operate.',
      code: `sequenceDiagram
    participant C as Client
    participant S as Server

    rect rgb(21,29,38)
    Note over C,S: Polling — a request per interval, event or not
    C->>S: GET /updates
    S-->>C: 304 Not Modified
    C->>S: GET /updates
    S-->>C: 304 Not Modified
    C->>S: GET /updates
    S-->>C: 200 [event]
    end

    rect rgb(28,24,20)
    Note over C,S: Long polling — held open, reconnect per event
    C->>S: GET /updates (held)
    Note right of S: waits...
    S-->>C: 200 [event]
    C->>S: GET /updates (held)
    Note right of C: gap: events here must be queued
    end

    rect rgb(23,39,42)
    Note over C,S: SSE — one stream, many events, auto-resume
    C->>S: GET /stream (Accept: text/event-stream)
    S-->>C: data: event 1
    S-->>C: data: event 2
    S-->>C: data: event 3
    Note right of C: on drop, reconnects with Last-Event-ID
    end

    rect rgb(30,20,30)
    Note over C,S: WebSocket — bidirectional, server holds the socket
    C->>S: GET /ws (Upgrade: websocket)
    S-->>C: 101 Switching Protocols
    S-->>C: [event]
    C->>S: [client message]
    S-->>C: [event]
    Note right of S: which server holds this client?
    end`,
    },
    {
      kind: 'flow',
      id: 'connection-ownership',
      title: 'The problem WebSockets create: who holds this client?',
      caption:
        'Step through both routing options. The point to notice is that neither is optional — choosing WebSockets means choosing one of these, and most designs that say "we\'ll use WebSockets" have not.',
      nodes: [
        { id: 'c1', label: 'Client A', kind: 'client', x: 0, y: 40 },
        { id: 'c2', label: 'Client B', kind: 'client', x: 0, y: 180 },
        { id: 'lb', label: 'Load balancer', kind: 'edge', x: 170, y: 110, detail: 'Distributes at connect time only. A new instance receives no existing clients, so scaling out does not relieve load on the instances already holding connections.' },
        { id: 's1', label: 'Gateway 1', kind: 'service', x: 350, y: 40, detail: 'Holds Client A\'s socket. This is the only place in the system that knows that fact, unless it is written down somewhere shared.' },
        { id: 's2', label: 'Gateway 2', kind: 'service', x: 350, y: 180, detail: 'Holds Client B. If this process dies, Client B reconnects and may land on a different gateway — so any per-connection state must be reconstructible.' },
        { id: 'reg', label: 'Session registry', kind: 'store', x: 560, y: 40, detail: 'Maps user id to gateway. Efficient targeted delivery, and now a dependency on the push path that must be kept current through every connect, disconnect and crash.' },
        { id: 'bus', label: 'Broadcast bus', kind: 'queue', x: 560, y: 200, detail: 'Every gateway subscribes to everything and discards messages for clients it does not hold. No registry to keep consistent; wasted work grows with gateway count × message rate.' },
        { id: 'app', label: 'Publisher', kind: 'service', x: 760, y: 120, detail: 'Wants to notify user 12345. It cannot do that without one of the two mechanisms to its left — that is the cost the transport choice introduced.' },
      ],
      edges: [
        { id: 'r1', source: 'c1', target: 'lb', kind: 'sync' },
        { id: 'r2', source: 'c2', target: 'lb', kind: 'sync' },
        { id: 'r3', source: 'lb', target: 's1', label: 'at connect', kind: 'sync' },
        { id: 'r4', source: 'lb', target: 's2', label: 'at connect', kind: 'sync' },
        { id: 'r5', source: 's1', target: 'reg', label: 'register', kind: 'write' },
        { id: 'r6', source: 'app', target: 'reg', label: 'look up', kind: 'read' },
        { id: 'r7', source: 'app', target: 'bus', label: 'publish', kind: 'async' },
        { id: 'r8', source: 'bus', target: 's2', label: 'fan out', kind: 'async' },
      ],
      steps: [
        {
          id: 'o1',
          title: 'The load balancer places a client once, and never again',
          description:
            'Distribution happens at connect time. With long-lived connections, adding capacity does not move existing clients — which is why some systems deliberately ask clients to reconnect periodically just to enable rebalancing.',
          nodes: ['c1', 'c2', 'lb', 's1', 's2'],
          edges: ['r1', 'r2', 'r3', 'r4'],
        },
        {
          id: 'o2',
          title: 'Option one: a registry, and a dependency on the push path',
          description:
            'Each gateway records which clients it holds. Publishing to one user is a lookup plus a targeted send. Efficient, and the registry must be correct through every connect, disconnect and unclean crash — stale entries mean messages sent into the void.',
          nodes: ['s1', 'reg', 'app'],
          edges: ['r5', 'r6'],
        },
        {
          id: 'o3',
          title: 'Option two: broadcast, and pay in wasted work',
          description:
            'Every gateway receives every message and drops what it does not own. Nothing to keep consistent, no lookup on the hot path — and the wasted work scales with gateways × message rate, so it stops working at exactly the scale that made you want WebSockets.',
          nodes: ['app', 'bus', 's2'],
          edges: ['r7', 'r8'],
        },
        {
          id: 'o4',
          title: 'Now delete a gateway',
          description:
            'Its clients reconnect, land elsewhere, and re-register. Anything the old process knew and did not write down is gone. Whether you can survive that is the question that decides whether you were ready for a persistent connection at all.',
          nodes: ['s2', 'reg', 'bus'],
          edges: ['r4', 'r8'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Slack'],
    body: `Slack has published how its real-time messaging layer works, and the useful part is not the transport choice — it is everything built around it.

Clients hold a WebSocket to a gateway process. That much is unsurprising. The interesting decisions are the ones the transport forced:

**Connection establishment is a separate, authenticated step.** A client does not simply open a socket to a well-known address. It first makes an ordinary HTTP call that authenticates it and returns a URL for the gateway it should connect to. This puts the placement decision in the application rather than in a load balancer, which means it can account for which team the client belongs to and where the relevant state already lives — something an L4 balancer distributing connections cannot do.

**The initial state and the event stream are different mechanisms.** On connect the client receives a snapshot; thereafter it receives incremental events. This split exists because a reconnecting client has a gap to close, and closing it by replaying every event since the beginning of time is not viable. The general pattern — **snapshot plus cursor** — is what any resumable stream needs, and it is the single most transferable idea here.

**Reconnection is designed, not incidental.** Clients back off with jitter and can resume from where they left off rather than starting from an empty state. Without jitter, any event that disconnects many clients at once — a deploy, a network blip, a gateway crash — produces a synchronised reconnect storm, and the handshake cost of that storm can exceed the capacity the system had while serving those same clients happily.

Three lessons that apply whether or not you ever use WebSockets:

**The transport is the small part.** Session registry, snapshot-plus-cursor resumption, heartbeats, jittered backoff and a placement strategy are all consequences of choosing a persistent connection. A design that names the transport and stops has described perhaps a fifth of the work.

**Reconnection is the load-bearing path.** Steady state with a million idle connections is cheap. The reconnect storm is what sizes the fleet, exactly as cold-cache load rather than steady-state miss rate sizes a database behind a cache.

**Placement is an application decision at scale.** Once connections are long-lived and stateful, where a client lands matters, and the component that knows enough to decide well is your code rather than the network.`,
  },

  tradeoffs: {
    intro:
      'Ordered by how much connection state the server has to own. The first row is the default and should be argued out of rather than into.',
    rows: [
      {
        option: 'Polling on a timer, with ETags',
        whenItWins:
          'Any update requirement of a few seconds or more. Trivial to scale, deploy and reason about; zero connection state; a CDN can absorb most of it.',
        whenItLoses:
          'Sub-second requirements, or when the interval needed makes the request rate genuinely expensive.',
        cost:
          'Requests whether or not anything changed, and staleness bounded by the interval. Both are usually smaller than assumed.',
      },
      {
        option: 'Long polling',
        whenItWins:
          'Near-immediate delivery through infrastructure that only speaks plain HTTP, and as a fallback when an upgrade is blocked.',
        whenItLoses:
          'High client counts on a thread-per-request server, and any case where the reconnect gap loses events.',
        cost:
          'One suspended request per client (so a non-blocking server), plus a per-client cursor to cover the reconnect gap.',
      },
      {
        option: 'Server-sent events',
        whenItWins:
          'One-directional streams: notifications, feeds, progress, streaming generated text. Built-in reconnection with Last-Event-ID is the feature you would otherwise write yourself.',
        whenItLoses:
          'When the client sends frequently too, or when binary payloads matter, or under HTTP/1.1 where each stream consumes one of six connections per host.',
        cost:
          'One open response per client, text-only framing, and the same connection-ownership problem as WebSockets for targeted delivery.',
      },
      {
        option: 'WebSockets',
        whenItWins:
          'Bidirectional, latency-sensitive interaction with a high client-to-server message rate: collaborative editing, presence, chat, live trading.',
        whenItLoses:
          'When updates are infrequent or one-directional — you have taken on connection state for latency nobody asked for.',
        cost:
          'A session registry or broadcast fan-out, heartbeats, jittered reconnection, coarse load balancing, deploys that disconnect everyone, and delivery guarantees you build yourself.',
      },
      {
        option: 'Push notifications via the platform',
        whenItWins:
          'Mobile clients that are backgrounded or offline. The OS holds one connection for every app, so you hold none.',
        whenItLoses:
          'In-app real-time interaction — delivery is best-effort and latency is not yours to control.',
        cost:
          'A dependency on a third-party service, no delivery guarantee, and per-platform integration.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"It needs to be real-time, so WebSockets."',
      whyWeak:
        '"Real-time" is not a requirement until it has a number. Most features described that way tolerate several seconds, which polling handles with no connection state. Choosing WebSockets commits you to a session registry, heartbeats, reconnect handling and deploys that disconnect every user — costs that should be bought deliberately.',
      strongAnswer:
        '"What is the acceptable staleness? If it is a few seconds, I would poll with ETags — no connection state, trivial deploys, and a CDN can absorb most of it. If it is sub-second and the client also sends frequently, then WebSockets, and I would design the session registry and reconnect strategy as part of that choice rather than after it."',
    },
    {
      weakAnswer: '"We poll every second, and the request volume is killing us."',
      whyWeak:
        'The interval is almost always the bug rather than the transport. Polling faster than the data can change guarantees wasted requests. Before changing transport, match the interval to the data\'s actual change rate and make unchanged responses cheap.',
      strongAnswer:
        '"How often does the underlying data actually change? If it is once a minute, a one-second poll is 60× more often than it can possibly be useful. I would set the interval from the data, add ETags so unchanged responses are small 304s, and make the endpoint cacheable at the edge. That is usually a 30× reduction without touching the architecture."',
    },
    {
      weakAnswer: '"We use WebSockets, so messages are delivered instantly and reliably."',
      whyWeak:
        'The WebSocket API provides no acknowledgements, no delivery guarantees and no resumption. A message written while the client is disconnected is simply lost. Treating the transport as reliable delivery means the reliability work never gets done and the gaps only appear in production.',
      strongAnswer:
        '"WebSockets give me a fast pipe and nothing else — no acknowledgements, no resumption, no backpressure signal. I would add sequence numbers so the client can detect gaps, a snapshot-plus-cursor resume so a reconnecting client can close them, and application-level acknowledgements for anything that must not be lost."',
    },
    {
      weakAnswer: '"We\'ll scale the WebSocket tier by adding instances behind the load balancer."',
      whyWeak:
        'Distribution happens at connect time, so new instances receive no existing clients. Adding capacity does nothing for the instances already saturated. It also ignores that pushing to a specific user requires knowing which instance holds them — which no amount of horizontal scaling provides.',
      strongAnswer:
        '"Adding instances only helps new connections, because placement happens at connect time. To relieve existing load I need clients to reconnect — either by asking them to, with jitter, or by draining an instance. And I need a session registry or a broadcast bus so publishers can reach a specific client at all; that is the part scaling does not give me."',
    },
    {
      weakAnswer: '"Connections are cheap — we can hold a million on modest hardware."',
      whyWeak:
        'Idle connections are indeed cheap. What is not cheap is establishing them: a million clients reconnecting inside 30 seconds is over 30,000 TLS handshakes per second, where the asymmetric cryptography is the expensive part. The fleet is sized by the reconnect storm, not the steady state.',
      strongAnswer:
        '"Steady state is a few kilobytes per connection and fine. The number that sizes the fleet is the reconnect rate after a deploy or a network event — that is where the TLS handshake CPU lands. So I would stagger deploys, drain connections gracefully, and require jittered backoff in the client."',
    },
  ],

  flashcards: [
    {
      id: 'fc-rt-1',
      front: 'What actually distinguishes polling from WebSockets in a design?',
      back: 'Who owns connection state. Polling has none, so any server serves any request and scaling, deploys and crashes are trivial. WebSockets attach a client to one process, which then holds state nothing else knows about.',
      topic: 'realtime',
    },
    {
      id: 'fc-rt-2',
      front: 'What is the request rate for polling, and what is the usual bug?',
      back: 'Clients ÷ interval, regardless of whether data changed. The usual bug is polling faster than the data can change — matching the interval to the change rate is often a 10–60× reduction.',
      topic: 'polling',
    },
    {
      id: 'fc-rt-3',
      front: 'What hidden state does long polling require?',
      back: 'A per-client cursor. Between the response arriving and the next request being established there is a gap, and events in that gap must be queued or they are lost.',
      topic: 'polling',
    },
    {
      id: 'fc-rt-4',
      front: 'What does SSE give you that long polling does not?',
      back: 'One stream carries many events with no reconnect per message, and the browser reconnects automatically with Last-Event-ID so the server can resume from the client\'s cursor.',
      topic: 'sse',
    },
    {
      id: 'fc-rt-5',
      front: 'What are SSE\'s three main constraints?',
      back: 'Server-to-client only, text-only framing, and under HTTP/1.1 each stream consumes one of the six connections per host. HTTP/2 removes the third.',
      topic: 'sse',
    },
    {
      id: 'fc-rt-6',
      front: 'Name the two ways to push to a specific WebSocket client, and their trade-off.',
      back: 'A session registry mapping user to gateway — efficient, but a dependency on the push path that must stay correct through crashes. Or a broadcast bus where every gateway drops what it does not own — nothing to keep consistent, wasted work grows with gateways × message rate.',
      topic: 'fanout',
    },
    {
      id: 'fc-rt-7',
      front: 'Why does adding WebSocket instances not relieve existing load?',
      back: 'Placement happens at connect time, so new instances receive only new connections. Relieving loaded instances requires clients to reconnect — deliberately, with jitter, or via draining.',
      topic: 'connections',
    },
    {
      id: 'fc-rt-8',
      front: 'What does the WebSocket API not give you?',
      back: 'Acknowledgements, delivery guarantees, resumption, and any backpressure signal. Sequence numbers, snapshot-plus-cursor resume and application acknowledgements are all yours to build.',
      topic: 'websockets',
    },
    {
      id: 'fc-rt-9',
      front: 'Which number sizes a persistent-connection fleet?',
      back: 'The reconnection rate, not the steady-state connection count. A million idle connections is cheap; a million reconnecting in 30 seconds is 33,000 TLS handshakes per second.',
      topic: 'connections',
    },
    {
      id: 'fc-rt-10',
      front: 'Why do production WebSocket deployments always send heartbeats?',
      back: 'Intermediaries — proxies, load balancers, NAT devices, corporate middleboxes — silently close idle connections. A heartbeat keeps them open and lets both ends detect a dead peer.',
      topic: 'websockets',
    },
    {
      id: 'fc-rt-11',
      front: 'What is the snapshot-plus-cursor pattern and why does every resumable stream need it?',
      back: 'On connect the client gets current state plus a position; thereafter it receives increments. A reconnecting client resumes from its cursor instead of replaying everything or starting empty.',
      topic: 'realtime',
    },
  ],

  quiz: [
    {
      id: 'q-rt-1',
      kind: 'scenario',
      prompt:
        'An order-status page must reflect changes within about 10 seconds. 200,000 users may have it open. Orders change state a handful of times over their lifetime. What is the best transport?',
      options: [
        { id: 'a', label: 'Poll every 10 seconds with ETags — 20,000 rps of mostly 304s, and no connection state' },
        { id: 'b', label: 'WebSockets, so updates are pushed the instant they happen' },
        { id: 'c', label: 'Long polling with a 30-second timeout' },
        { id: 'd', label: 'SSE, one stream per open page' },
      ],
      correct: ['a'],
      explanation:
        'The requirement is 10 seconds, which polling meets exactly, and conditional requests make the unchanged case a few hundred bytes. The push options all buy sub-second latency nobody asked for, in exchange for 200,000 pieces of connection state, deploys that disconnect everyone, and a routing mechanism to reach a specific user.',
      difficulty: 'core',
      topic: 'polling',
    },
    {
      id: 'q-rt-2',
      kind: 'scenario',
      prompt:
        'A collaborative editor uses WebSockets. During a rolling deploy of 20 gateway instances, users report several seconds of frozen documents and the fleet CPU spikes. What is the primary cause?',
      options: [
        { id: 'a', label: 'Every restart drops its connections, and clients reconnect in a synchronised burst of TCP and TLS handshakes' },
        { id: 'b', label: 'The new instances have cold caches' },
        { id: 'c', label: 'The load balancer rebalanced existing connections onto fewer instances' },
        { id: 'd', label: 'Message ordering broke during the deploy' },
      ],
      correct: ['a'],
      explanation:
        'Restarting a gateway disconnects every client it held, and they all reconnect at once. TLS handshake CPU is the expensive part, and a fleet that serves those clients happily when warm can struggle to re-establish them. Staggered restarts, connection draining and jittered client backoff are the fix. Load balancers do not move existing connections — that is the property that made scaling hard in the first place.',
      difficulty: 'advanced',
      topic: 'connections',
    },
    {
      id: 'q-rt-3',
      kind: 'single',
      prompt: 'What does SSE provide that plain streaming HTTP does not?',
      options: [
        { id: 'a', label: 'Automatic client reconnection that resumes from Last-Event-ID' },
        { id: 'b', label: 'Bidirectional messaging' },
        { id: 'c', label: 'Binary frame support' },
        { id: 'd', label: 'Guaranteed delivery of every event' },
      ],
      correct: ['a'],
      explanation:
        'The event-stream format plus automatic reconnection with a cursor is the substance of SSE — it is the resumption machinery you would otherwise design and get subtly wrong. SSE is one-directional and text-only, and it guarantees nothing about delivery.',
      difficulty: 'intro',
      topic: 'sse',
    },
    {
      id: 'q-rt-4',
      kind: 'scenario',
      prompt:
        'A notification service must push to a specific user held on one of 50 WebSocket gateways. The team plans to publish every notification to all 50 and let each discard what it does not own. When does this stop working?',
      options: [
        { id: 'a', label: 'When gateway count × message rate makes the discarded work dominate — every gateway processes every message' },
        { id: 'b', label: 'Immediately: broadcast cannot reach a specific client' },
        { id: 'c', label: 'When notifications need ordering guarantees' },
        { id: 'd', label: 'Only if the message bus loses messages' },
      ],
      correct: ['a'],
      explanation:
        'Broadcast is correct and pleasantly simple — no registry to keep consistent, no lookup on the push path. Its cost is that total work is gateways × messages, so it degrades precisely as you scale out, which is the scale that motivated persistent connections. A session registry trades that waste for a consistency problem across connects, disconnects and crashes.',
      difficulty: 'advanced',
      topic: 'fanout',
    },
    {
      id: 'q-rt-5',
      kind: 'scenario',
      prompt:
        'A client reconnects a dropped WebSocket and the user sees a document missing the last few edits, permanently. What is missing from the design?',
      options: [
        { id: 'a', label: 'Snapshot-plus-cursor resumption: sequence numbers so gaps are detectable and a way to replay from the client\'s last position' },
        { id: 'b', label: 'A longer heartbeat interval' },
        { id: 'c', label: 'TLS session resumption' },
        { id: 'd', label: 'A larger server send buffer' },
      ],
      correct: ['a'],
      explanation:
        'WebSockets deliver nothing while disconnected and offer no resumption. Without sequence numbers the client cannot even tell it missed anything, and without a replayable log it cannot recover. Heartbeats detect the drop faster; they do not close the gap.',
      difficulty: 'core',
      topic: 'websockets',
    },
    {
      id: 'q-rt-6',
      kind: 'multi',
      prompt:
        'Which of these are consequences of choosing WebSockets that you must design for? Select all that apply.',
      options: [
        { id: 'a', label: 'A mechanism to find which instance holds a given client' },
        { id: 'b', label: 'Heartbeats, because intermediaries close idle connections' },
        { id: 'c', label: 'Jittered client reconnection to avoid synchronised storms' },
        { id: 'd', label: 'Message-level encryption, because WebSockets are plaintext' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are unavoidable consequences of holding connection state, and a design that names the transport without them is incomplete. WebSockets over `wss://` run inside TLS exactly like HTTPS, so transport encryption is not an extra step.',
      difficulty: 'core',
      topic: 'websockets',
    },
  ],

  exercises: [
    {
      id: 'ex-rt-1',
      kind: 'design',
      title: 'Pick a transport per feature, not per product',
      estimatedMinutes: 20,
      prompt: `A project-management product has four real-time-ish features and 300,000 concurrent web clients:

1. **Comment notifications** — a badge count, tolerable within ~15 seconds.
2. **Live cursors** in a shared document — must feel immediate, updates many times per second per active editor, only 2–8 editors per document.
3. **Build status** — a long-running CI job streams log lines to whoever is watching. Watchers are rare (tens at a time).
4. **Presence** ("who is online") — tolerable within ~30 seconds, but every client cares about every teammate.

For each feature: choose a transport, state the requirement that decided it, and give the cost model (requests/second or connections). Then identify which single feature forces the most infrastructure, and say what you would build for it.`,
      rubric: [
        'Chooses polling with ETags for notifications, justified by the 15-second tolerance, and computes the request rate (300,000 ÷ 15 = 20,000 rps).',
        'Chooses WebSockets for live cursors, justified by sub-second bidirectional needs — and notes that only active editors hold connections, not all 300,000 clients.',
        'Chooses SSE for build logs, justified by one-directional streaming plus Last-Event-ID resumption, and notes the tiny concurrent watcher count.',
        'Chooses polling for presence, and notices that fan-out — every client caring about every teammate — is a data-shape problem rather than a transport problem.',
        'Identifies live cursors as the feature forcing the most infrastructure, because it is the only one needing connection ownership.',
        'Scopes the WebSocket infrastructure to the document, not the user: connections only while a document is open, so the registry maps document to gateway.',
        'Names the concrete pieces required: placement, session registry or per-document affinity, heartbeats, jittered reconnect, and snapshot-plus-cursor resume.',
      ],
      modelAnswer: `**1. Comment notifications — polling with ETags**

*Deciding requirement:* 15 seconds of staleness is acceptable.
*Cost:* 300,000 ÷ 15 = **20,000 requests/second**, almost all 304s of a few hundred bytes. Cacheable per user for the poll interval, so an edge can absorb a large share.
*Why not push:* it would mean 300,000 persistent connections to deliver a number that changes a few times a day per user. That is the worst possible ratio of connection state to delivered value.

**2. Live cursors — WebSockets**

*Deciding requirement:* sub-second, bidirectional, many messages per second per editor. Nothing else meets this.
*Cost:* connections only for clients with a document *open in edit mode* — not all 300,000. If 3% are actively editing, that is **~9,000 connections**, and at 2–8 per document the message volume per connection is small.
*The key scoping decision:* the connection belongs to the document session, not to the user's login. Open on entering the editor, close on leaving. That reduces connection count by more than an order of magnitude and makes placement natural — route by document id so all editors of one document land on the same gateway and cursor updates never leave the process.

**3. Build logs — SSE**

*Deciding requirement:* one-directional streaming of many small events, with resumption when the watcher's network blips mid-build.
*Cost:* tens of concurrent streams. Negligible.
*Why SSE over WebSockets:* the client sends nothing, and Last-Event-ID resumption is exactly what a watcher needs after a drop — resume from the last log line rather than restarting or losing output. Using WebSockets here would mean writing that resumption by hand.
*Why not polling:* log lines arrive continuously, so polling would either lag badly or hammer the endpoint. This is the one case where streaming is clearly right and cheap.

**4. Presence — polling, and the interesting part is not the transport**

*Deciding requirement:* 30 seconds is fine, so 300,000 ÷ 30 = **10,000 rps**.
*The real problem:* every client cares about every teammate, so a naive design has each client requesting the status of N teammates. That is a fan-out problem in the *data*, not the transport. The fix is a single cacheable per-team presence document, updated by heartbeats and cached for the poll interval — one object served from cache to every member of that team, rather than a per-client query.
*Why this matters:* switching to WebSockets here would not help at all. It would make delivery faster and leave the fan-out untouched. Choosing the transport before understanding the fan-out is exactly the trap.

**Which feature forces the most infrastructure: live cursors.**

It is the only one requiring connection ownership, and therefore the only one that drags in:

- **Placement by document id** rather than round-robin, so co-editors share a gateway and cursor traffic stays in-process. This is the decision that removes the need for a cross-gateway bus for cursors entirely.
- **A session registry** mapping document to gateway, needed once a document's editors could span gateways (a large document, or a gateway at capacity).
- **Heartbeats** every ~30 seconds, because intermediaries silently close idle connections and a cursor connection can be idle while someone reads.
- **Jittered reconnection with backoff**, because a gateway restart drops every editor on it simultaneously.
- **Snapshot-plus-cursor resume**: on reconnect, fetch the current document version and the cursor positions, then resume the increment stream. Without this a reconnecting editor sees a stale document permanently.
- **Bounded send buffers with a disconnect policy**, because a client that stops reading will otherwise grow the server's buffer until the process suffers.

**The point of the exercise.** Three of four features need no connection state at all, and the fourth needs it only for a small, well-scoped subset of clients. A product-wide "we use WebSockets" decision would have taken on 300,000 connections' worth of operational burden to serve the 3% that actually needed it.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-rt-1',
      level: 'basic',
      question: 'What are the options for getting server-side updates to a browser, and how do they differ?',
      guidance:
        'Look for all four with an axis that distinguishes them. A strong answer uses connection state or ownership as the axis rather than latency, because latency differences are small for most features while the operational differences are large.',
    },
    {
      id: 'iq-rt-2',
      level: 'basic',
      question: 'When is polling the right answer?',
      guidance:
        'Whenever the staleness tolerance is a few seconds or more. A strong answer computes the request rate, notes that conditional requests make unchanged responses tiny, and frames zero connection state as the benefit rather than an excuse.',
    },
    {
      id: 'iq-rt-3',
      level: 'intermediate',
      question: 'You have chosen WebSockets. How does a publisher reach one specific user?',
      guidance:
        'This is the question that separates people who have deployed WebSockets from people who have used them. Look for either a session registry with its consistency burden, or broadcast fan-out with its scaling cost, and an explicit trade-off between them.',
    },
    {
      id: 'iq-rt-4',
      level: 'intermediate',
      question: 'Why would you use SSE rather than WebSockets?',
      guidance:
        'One-directional flow, and built-in reconnection with Last-Event-ID that you would otherwise implement yourself. A strong answer also names the constraints — text only, and one of six connections per host under HTTP/1.1 — rather than presenting it as strictly simpler.',
    },
    {
      id: 'iq-rt-5',
      level: 'advanced',
      question: 'You hold 2 million WebSocket connections. Walk me through a deploy.',
      guidance:
        'The candidate must recognise that a naive deploy is a self-inflicted reconnect storm. Look for staggered restarts, connection draining, jittered client backoff, and capacity sized for the reconnect rate rather than the steady state. Excellent answers note that reconnection is also the only mechanism for rebalancing, so it is worth making cheap.',
    },
    {
      id: 'iq-rt-6',
      level: 'advanced',
      question: 'A client disconnects for 30 seconds and reconnects. What must the design do?',
      guidance:
        'Snapshot plus cursor: sequence numbers so gaps are detectable, and a replayable buffer or a fresh snapshot so they can be closed. Strong answers bound the buffer and say what happens when the gap exceeds it — fall back to a full snapshot rather than replaying forever. Excellent answers note this is the same problem as consumer offsets in a message log.',
    },
    {
      id: 'iq-rt-7',
      level: 'followup',
      question: 'You said connections are cheap. What is the number that actually constrains you?',
      guidance:
        'Reconnection rate, because that is where TCP and TLS handshake CPU lands. Idle connections cost a file descriptor and buffers; establishing them costs asymmetric cryptography. A candidate who only cites memory per connection has not operated one of these.',
    },
    {
      id: 'iq-rt-8',
      level: 'followup',
      question: 'A client stops reading from its socket but stays connected. What happens?',
      guidance:
        'The server\'s send buffer grows, then either memory grows unboundedly or writes block, depending on the stack. The WebSocket API surfaces no backpressure signal, so the application must bound the buffer and choose a policy: drop old messages, drop the connection, or coalesce. A strong answer notes that a slow consumer must not be allowed to affect other connections.',
    },
  ],

  activeLearning: [
    {
      id: 'al-rt-1',
      kind: 'what-changes-if',
      prompt:
        'The lesson assumed browser clients. Change one thing: the clients are 500,000 IoT sensors on cellular connections, each reporting a reading every 60 seconds and occasionally needing to receive a configuration change. Which transport, and what changes about your reasoning?',
      discussion: `Almost every assumption inverts, and the transport that wins is one the lesson barely mentioned.

**What changes about the workload.** The dominant direction is now client-to-server, not server-to-client: 500,000 ÷ 60 ≈ **8,300 readings/second** flowing up, against a trickle of configuration changes flowing down. The lesson's framing — "how do I push to a client" — is the minor half of this problem.

**Why polling inverts.** Sensors are not polling for updates; they are *pushing* readings. So the question becomes whether a sensor opens a connection per reading or holds one open. On cellular, opening a connection is expensive in a way that matters differently from a browser: the radio has to wake up, and radio wake-up is the dominant power cost on a battery-powered device. Connection reuse stops being a latency optimisation and becomes a **battery** optimisation.

**Why WebSockets are a poor fit despite the persistent-connection need.** 500,000 persistent connections is a real burden, and the framing is heavier than necessary. More importantly, WebSockets give no quality-of-service controls, and an intermittently connected cellular device needs exactly that: "deliver this configuration change when the device next appears, and tell me it arrived".

**What actually fits: MQTT, or a similar broker-based protocol.** It was designed for this shape — persistent lightweight connections, publish/subscribe topics, per-message quality-of-service levels including at-least-once with acknowledgement, retained messages so a reconnecting device immediately receives the current configuration, and a last-will message so the broker knows when a device drops. Every one of those is a thing the lesson said you would have to build yourself on top of WebSockets. Here it is in the protocol.

**What stays exactly the same.** The connection-ownership problem does not go away — it moves into the broker, which now holds 500,000 sessions and has to be clustered, and clustering a broker while preserving subscription state is genuinely hard. The reconnect-storm problem is unchanged and worse: cellular networks drop connections regionally, so tens of thousands of devices can reconnect at once, and firmware must implement jittered backoff because you cannot patch it quickly if it does not.

**A second thing that stays the same, and bites harder.** Bounded buffers. A device offline for a week must not accumulate a week of undelivered messages. The retention policy — how many, for how long, dropped how — is a design decision, and on 500,000 devices getting it wrong exhausts the broker rather than one connection.

**The transferable point.** The four transports in this lesson are the browser's options. The underlying axis — how much connection state does the server own, and what happens when it is lost — is universal, and it is what lets you evaluate a protocol you have never used. When a purpose-built protocol exists for your client shape, it usually encodes answers to the questions you would otherwise be designing from scratch, and the right move is to check whether those answers match your requirements rather than to build the machinery again.`,
    },
    {
      id: 'al-rt-2',
      kind: 'debug',
      prompt:
        'A WebSocket-based chat product reports: messages arrive reliably for most users, but roughly 0.5% of users see messages arriving minutes late, in bursts. Those users are geographically scattered and on different networks. Server metrics show no queue depth, normal CPU, and no errors. What is your leading hypothesis, and what would you measure?',
      discussion: `Late-but-eventually-delivered, in bursts, for a small scattered minority, with clean server metrics. That combination is specific.

**Leading hypothesis: those clients' connections are being held open by an intermediary that has stopped forwarding, and messages are accumulating in a buffer until something flushes.**

The mechanism: a proxy, corporate middlebox or carrier NAT decides the connection is idle and stops passing traffic without sending a close. Neither end knows. The server keeps writing into a socket that appears healthy; the bytes sit in a buffer somewhere along the path. When the client eventually sends something — a keystroke, a heartbeat — the path wakes up and the accumulated messages arrive together. That is precisely "minutes late, in bursts".

Why it explains the clean metrics: the server is not queueing (it wrote successfully to the socket), there is no error (nothing was rejected), and CPU is fine (the work was done long ago). The delay lives in a component nobody is monitoring, on the path.

Why it hits a scattered 0.5%: it is a property of the network path, not the user or the region. Particular corporate proxies, particular carrier configurations, particular home routers.

**A second hypothesis worth holding: a slow or stalled consumer.** If the client stops reading — a backgrounded tab throttled by the browser, a JavaScript main thread blocked — the server's send buffer fills, and delivery resumes when the client resumes reading. Same burst signature, different cause. Worth distinguishing, because the fixes differ.

**What to measure, in order:**

1. **End-to-end message latency measured at the client**, reported back with the server-side send timestamp. Server-side metrics structurally cannot see this problem; only a client-reported round-trip figure can.
2. **Heartbeat round-trip time per connection.** If heartbeats are also delayed in the same bursts, the path is stalled. If heartbeats flow normally while messages lag, the problem is on the server side or in the client's read loop.
3. **Server send-buffer depth per connection.** This distinguishes the two hypotheses cleanly: a full buffer means the client is not reading; an empty buffer with late arrival means the path swallowed it.
4. **Correlate against client environment** — network type, browser, whether the tab was backgrounded. If it correlates with backgrounded tabs, it is the consumer, not the path.

**Fixes, matched to cause:**

*If the path is stalling:* shorten the heartbeat interval so stalls are detected in seconds, and treat a missed heartbeat as a dead connection — close and reconnect rather than hoping. This is why heartbeats exist, and the interval should be set below the shortest idle timeout you have observed in the wild, not to a comfortable default.

*If the consumer is stalling:* bound the send buffer with an explicit policy. For chat, coalescing or dropping is unacceptable, so the right behaviour is to disconnect the client once the buffer exceeds a threshold and let it reconnect and resume from its cursor — which requires the snapshot-plus-cursor mechanism to already exist.

**The transferable lesson.** For any persistent connection, "the socket is open" is not evidence that anything is being delivered. Liveness must be measured, not assumed, and it must be measured end to end — because every intermediate component will report success right up until the moment you ask the client whether it actually received anything.`,
    },
  ],

  revision: {
    bullets: [
      'Four transports, ordered by connection state the server owns: polling (none), long polling (one pending request), SSE (one stream), WebSockets (one socket plus session state).',
      'The differentiator is connection ownership and what happens when a process dies — not latency, which differs by less than a second for most features.',
      'Polling cost is clients ÷ interval. The usual bug is polling faster than the data can change.',
      'ETags and conditional requests turn unchanged polls into small 304s; a CDN can absorb most of the rest.',
      'Long polling needs a per-client cursor, because events in the reconnect gap are otherwise lost.',
      'SSE\'s real feature is automatic reconnection with Last-Event-ID. It is one-directional and text-only.',
      'Under HTTP/1.1 each SSE stream uses one of six connections per host; HTTP/2 removes that limit.',
      'WebSockets give a fast bidirectional pipe and nothing else: no acknowledgements, no resumption, no backpressure signal.',
      'To push to one client you need a session registry (efficient, consistency burden) or broadcast fan-out (simple, work scales with gateways × messages).',
      'Placement happens at connect time, so adding instances does not rebalance existing clients.',
      'A deploy disconnects everyone on an instance. Stagger restarts, drain connections, require jittered client backoff.',
      'Idle connections are cheap; reconnection is not. The reconnect storm sizes the fleet, via TLS handshake CPU.',
      'Always heartbeat: intermediaries close or stall idle connections without telling either end.',
      'Every resumable stream needs snapshot plus cursor, with a bounded replay buffer and a full-snapshot fallback.',
      'Bound the server send buffer and choose a policy, or one non-reading client grows memory without limit.',
      'Do not adopt a persistent connection until you can say who owns it when a process dies.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The four mechanisms for delivering server-side changes to a client — polling, long polling, server-sent events and WebSockets — distinguished by how much connection state the server must hold.',
    whyItExists:
      'HTTP is request-response, so a server cannot initiate. Each transport is a different compromise between letting the client ask repeatedly and letting the server keep a channel open.',
    whenToUse: [
      'Polling when staleness of seconds is acceptable — most features.',
      'SSE for one-directional streams: notifications, feeds, progress, streamed generated text.',
      'WebSockets when the interaction is bidirectional, sub-second and message-dense.',
    ],
    whenNotToUse: [
      'WebSockets for infrequent or one-directional updates — connection state bought for latency nobody asked for.',
      'Any persistent connection before you can describe placement, resumption and reconnect behaviour.',
      'Polling when the interval needed is short enough that the request rate genuinely exceeds capacity.',
    ],
    alternatives: [
      'Platform push notifications for backgrounded mobile clients: the OS holds the connection so you hold none.',
      'MQTT or a similar broker protocol for device fleets, which supplies quality-of-service, retained messages and last-will in the protocol.',
      'gRPC server streaming for service-to-service streams, giving typed messages and flow control.',
    ],
    tradeoffs: [
      'Polling buys stateless scaling and costs wasted requests plus bounded staleness.',
      'SSE buys resumption for free and costs one-directional, text-only framing.',
      'WebSockets buy lowest bidirectional latency and cost a session registry, heartbeats, reconnect design and deploys that disconnect everyone.',
      'A session registry buys efficient targeted delivery and costs consistency across crashes; broadcast inverts both.',
    ],
    failureModes: [
      'Reconnect storm after a deploy or network event: TLS handshake CPU, not message volume, is the limit.',
      'An intermediary stalling or closing an idle connection silently, so the socket looks open and nothing is delivered.',
      'A reconnecting client permanently missing events because there is no cursor or replay buffer.',
      'A non-reading client growing the server send buffer without bound.',
      'Polling faster than the data changes, producing a request rate that looks like a transport problem.',
      'Scaling out a connection tier and finding existing instances still saturated, because placement is at connect time.',
    ],
    followUpQuestions: [
      'What is the acceptable staleness, as a number?',
      'Who owns this client\'s connection, and what happens when that process dies?',
      'How does a publisher reach one specific connected user?',
      'What does a client see after reconnecting from a 30-second gap?',
      'What happens when a client stops reading but stays connected?',
      'What does your deploy do to every open connection?',
    ],
  },
});
