import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-tcp-latency',
  title: 'TCP, connections, and why latency is not bandwidth',
  summary:
    'Round trips, not megabits, decide how a system feels — and connection reuse, congestion control and queueing are the three mechanisms that decide how many round trips you pay.',
  phase: 'foundations',
  module: 'networking',
  position: 2,
  kind: 'concept',
  difficulty: 'intro',
  estimatedMinutes: 40,
  tags: ['tcp', 'latency', 'bandwidth', 'congestion-control', 'connections', 'queueing'],
  prerequisites: ['f-request-lifecycle'],
  resources: [
    {
      key: 'latency-numbers',
      tier: 'must',
      note: 'Set the slider to the current year and internalise three figures: same-datacentre round trip, cross-continent round trip, and memory versus disk. Every capacity estimate you ever do out loud starts from these.',
    },
    {
      key: 'aws-timeouts-retries-jitter',
      tier: 'must',
      note: 'Read it for the argument that a timeout is a budget across the whole path, not a property of the server. The retry-storm section is the failure mode this lesson sets up.',
    },
    {
      key: 'grpc-guides-performance',
      tier: 'good',
      note: 'Concrete guidance on connection reuse and why long-lived connections behave differently from a pool of short ones. Short, and directly applicable.',
    },
    {
      key: 'web-almanac-http',
      tier: 'good',
      note: 'Measured data on connection reuse and protocol adoption across the real web, useful when you want to say "most traffic already does X" without guessing.',
    },
  ],

  intuition: {
    body: `Two engineers are debugging the same slow API. One says "we need more bandwidth". The other says "we need fewer round trips". Only one of them is going to fix it.

Bandwidth is how *wide* the pipe is: bytes per second once data is flowing. Latency is how *long* the pipe is: how long before the first byte comes back. They are independent, and they are fixed by different things.

Bandwidth you can buy. Latency you mostly cannot, because it is set by distance and the speed of light in fibre — roughly 200,000 km per second once you account for the refractive index and the routing detours. London to Singapore is about 10,700 km as the crow flies, which is 54 ms one way at best, and real routes are longer. No amount of money moves that number.

Here is the mental model. Think of a request as a conversation where each party must wait for the other to finish before speaking. Every question-and-answer is one round trip. If your protocol needs four exchanges before useful work happens, you pay four round trips whether the payload is 100 bytes or 100 kilobytes.

That is why the interesting question about a slow system is almost never "how much data are we moving?" It is:

- **How many round trips does this operation take?**
- **How far away is the other end?**
- **How many of those round trips have we already paid for?**

The last one is what connection reuse is about, and it is the single highest-leverage thing most systems get wrong.`,
    analogyLimit:
      'The pipe picture is fine for latency and bandwidth in isolation, but it hides the mechanism that connects them: TCP does not know how fast the path is, so it deliberately starts slow and speeds up. A pipe has a fixed width; a TCP connection has a width that grows over the first few round trips and collapses whenever a packet is lost.',
  },

  deepExplanation: {
    predict: {
      question:
        'You must transfer 1 MB from a server 100 ms away over a link with 100 Mbps of available bandwidth. Naively, 1 MB at 100 Mbps takes 80 ms. Roughly how long does the transfer actually take on a brand-new connection, and why?',
      answer: `Roughly **400–500 ms**, and almost none of it is bandwidth.

The transfer does not start at 100 Mbps. TCP has no idea what the path can carry, so it starts with a small congestion window — commonly 10 segments, about 14 KB — and doubles it each round trip while nothing is lost. That is *slow start*.

| Round trip | Window | Cumulative sent |
| --- | --- | --- |
| 1 | 14 KB | 14 KB |
| 2 | 28 KB | 42 KB |
| 3 | 56 KB | 98 KB |
| 4 | 112 KB | 210 KB |
| 5 | 224 KB | 434 KB |
| 6 | 448 KB | 882 KB |
| 7 | 896 KB | 1 MB — done |

So about **7 round trips of ramp**, or roughly 700 ms of waiting at 100 ms RTT — except the last round trips overlap with actual transfer, so in practice you land somewhere around 400–500 ms. Add the TCP and TLS handshakes on a genuinely new connection and it is worse.

Two consequences worth carrying:

**Bandwidth was never the limit.** The link could have moved 1 MB in 80 ms. It took five times that because the sender spent most of the transfer discovering how fast it was allowed to go.

**A warm connection has already paid this.** A connection that has been transferring for a while has a large congestion window and starts at full speed. That is a second, entirely separate reason connection reuse matters — distinct from the handshake round trips, and often larger.

This is why the "bandwidth-delay product" — bandwidth × RTT — is the real unit. It is how many bytes can be in flight at once, and if your window is smaller than it, you are latency-bound no matter what you paid for.`,
    },
    body: `## What TCP actually guarantees, and what it does not

TCP gives you three things: bytes arrive **in order**, bytes arrive **complete** (lost segments are retransmitted), and the sender will not **overwhelm** the receiver or the network.

It does not give you message boundaries. A single \`write()\` of 500 bytes may arrive as one \`read()\` of 500 bytes, or two of 250, or be merged with the next message. Every "I parsed half a JSON object" bug lives here. Framing is your protocol's job: HTTP uses \`Content-Length\` or chunked encoding, gRPC uses length-prefixed frames, and hand-rolled protocols usually get this wrong once before getting it right.

It also does not give you *timeliness*. A lost segment is retransmitted, and everything behind it waits — that is **head-of-line blocking**. Ordered delivery and low latency are in tension, and TCP always chooses ordering. This is precisely the trade QUIC revisits.

## The three round-trip costs

**Handshake.** Three-way: SYN, SYN-ACK, ACK. The client can send after the SYN-ACK arrives, so the cost before useful data is one RTT. Add one more for TLS 1.3.

**Slow start.** As derived above. The window begins small and doubles per RTT until a loss signals the limit. A short-lived connection may never leave slow start at all, which is why a burst of small requests on fresh connections is so much slower than the same requests on one warm connection.

**Congestion response.** On loss, classic TCP halves the window and climbs back linearly. One lost packet on a long-distance link can cost hundreds of milliseconds of reduced throughput. Modern congestion control (BBR and similar) models bandwidth and RTT directly rather than treating loss as the only signal, which behaves better on lossy links like mobile networks — but the principle is unchanged: the sender is always estimating, and estimates cost time.

## Bandwidth-delay product: the number that explains everything

\`\`\`
BDP = bandwidth × round-trip time
\`\`\`

A 100 Mbps link with 100 ms RTT has a BDP of 100 × 10⁶ ÷ 8 × 0.1 = **1.25 MB**. That is how much data must be in flight to keep the link busy. If the sender's congestion window or the receiver's buffer is smaller than the BDP, the sender spends part of every round trip idle, waiting for acknowledgements — and no extra bandwidth helps.

This is why "long fat networks" (high bandwidth, high latency) need window scaling, and why a single TCP stream often cannot saturate a fast intercontinental link no matter how it is tuned.

## Where the time actually goes

For a request from a client 100 ms away:

| Component | Cost | Reducible by |
| --- | --- | --- |
| Propagation delay | ~100 ms RTT | Moving the endpoint closer. Nothing else. |
| Handshakes | 1–2 RTT | Connection reuse, TLS session resumption, QUIC |
| Slow start | 3–7 RTT for a MB | Connection reuse, larger initial window |
| Transmission | payload ÷ bandwidth | More bandwidth — usually the smallest term |
| Server processing | your code | Optimisation, caching |
| Queueing | 0 → unbounded | Capacity, load shedding, backpressure |

The last row is the one that ruins production systems. Queueing delay is zero when a system is lightly loaded and grows without bound as utilisation approaches 100%. It is why a service that averages 20 ms can show 2 s at p99 with no code change and no resource "maxed out" on any dashboard — because the queue is in a connection pool, a thread pool or a socket backlog, and those are not on the dashboard.

## Connection reuse, and what it costs

Keeping connections open removes handshake round trips and preserves a warmed congestion window. It is close to free performance and almost every client does it by default. The costs are real but manageable, and knowing them is what separates "use keep-alive" from an actual answer:

**Memory.** Each idle connection holds socket buffers on both ends. Thousands of idle connections per server is normal; hundreds of thousands needs deliberate tuning.

**Stale sockets.** A pooled connection can be closed by the server, a load balancer, or a NAT device without the client noticing until it writes. This is the single most common cause of mysterious intermittent errors: the client sends on a socket the server closed seconds ago and sees a connection reset. **The client's idle timeout must be comfortably shorter than the server's**, so the client is always the side that closes.

**Coarser load balancing.** With long-lived connections, traffic is distributed at connect time, not per request. A newly added instance receives nothing until connections churn. L7 load balancers that balance per request avoid this; L4 balancers do not.

**Connection storms.** If every client reconnects at once — after a deploy, or after a network blip — the handshake cost that reuse was hiding all arrives simultaneously. TLS handshakes are CPU-expensive on the server, so a fleet comfortably serving warm connections can fail to establish cold ones. Staggered restarts and jittered client reconnect are the mitigations, and they only make sense once you understand which part is expensive.

## The practical rules

1. **Count round trips, not bytes.** For any operation, ask how many exchanges it needs before the user sees something.
2. **Reuse connections.** Then check that your pool is large enough for your peak concurrency, and that your idle timeout is shorter than the server's.
3. **Set timeouts against the whole path.** A 100 ms timeout to a server 100 ms away can never succeed on a cold connection. Separate the connect timeout from the read timeout; they fail for different reasons.
4. **Batch to remove requests, not to make them bigger.** Deleting a round trip always beats speeding one up — but batching couples failures, so define partial-failure semantics before you do it.
5. **When p50 is fine and p99 is terrible, look for a queue.** Utilisation dashboards are averages, and averages are exactly where queueing hides.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'slow-start',
      title: 'Slow start: the first megabyte is not bandwidth-limited',
      caption:
        'Watch the cumulative column rather than the window. Nearly half the transfer happens in the last two round trips, which means the earlier ones were spent discovering capacity rather than using it — and a reused connection skips all of them.',
      code: `sequenceDiagram
    participant C as Client
    participant S as Server (100 ms RTT)

    Note over C,S: New connection, 1 MB to transfer, 100 Mbps available
    C->>S: SYN
    S-->>C: SYN-ACK
    C->>S: ACK + request
    Note right of C: 100 ms — handshake done

    S-->>C: 14 KB (window = 10 segments)
    Note right of C: 200 ms — 14 KB delivered
    S-->>C: 28 KB
    Note right of C: 300 ms — 42 KB
    S-->>C: 56 KB
    Note right of C: 400 ms — 98 KB
    S-->>C: 112 KB
    Note right of C: 500 ms — 210 KB
    S-->>C: 224 KB
    Note right of C: 600 ms — 434 KB
    S-->>C: 448 KB
    Note right of C: 700 ms — 882 KB
    S-->>C: remainder
    Note right of C: 800 ms — 1 MB done`,
    },
    {
      kind: 'flow',
      id: 'where-time-goes',
      title: 'Six places a request spends time',
      caption:
        'Step through each one and note what actually reduces it. Only one of the six is fixed by buying more bandwidth, and it is usually the smallest term.',
      nodes: [
        { id: 'prop', label: 'Propagation', kind: 'note', x: 0, y: 40, detail: 'Distance divided by the speed of light in fibre. London to Singapore is ~54 ms one way at best. Reducible only by moving the endpoint closer — this is what a CDN or a regional deployment actually buys.' },
        { id: 'hand', label: 'Handshakes', kind: 'note', x: 190, y: 40, detail: 'TCP one round trip, TLS 1.3 one more. Removed entirely by reusing a connection, and reduced to zero by TLS 0-RTT resumption for idempotent requests.' },
        { id: 'slow', label: 'Slow start', kind: 'note', x: 380, y: 40, detail: 'Three to seven round trips for a megabyte on a fresh connection. A warm connection has already grown its window, which is a second and often larger reason to reuse connections.' },
        { id: 'xmit', label: 'Transmission', kind: 'note', x: 570, y: 40, detail: 'Payload divided by bandwidth. The only term that more bandwidth fixes, and usually the smallest one for API-shaped traffic.' },
        { id: 'proc', label: 'Server work', kind: 'service', x: 760, y: 40, detail: 'Your code plus its dependencies. Frequently the only term teams instrument, which is why the other five stay invisible.' },
        { id: 'queue', label: 'Queueing', kind: 'queue', x: 950, y: 40, detail: 'Zero at low load, unbounded as utilisation approaches 100%. Hides in connection pools, thread pools and socket backlogs — none of which appear on a CPU graph.' },
      ],
      edges: [
        { id: 'q1', source: 'prop', target: 'hand', kind: 'control' },
        { id: 'q2', source: 'hand', target: 'slow', kind: 'control' },
        { id: 'q3', source: 'slow', target: 'xmit', kind: 'control' },
        { id: 'q4', source: 'xmit', target: 'proc', kind: 'control' },
        { id: 'q5', source: 'proc', target: 'queue', kind: 'control' },
      ],
      steps: [
        {
          id: 'w1',
          title: 'Distance is the term you cannot optimise',
          description:
            'Propagation delay is physics. Every architectural move that helps latency — CDN, edge termination, regional replicas — is a move that shortens this term by shortening the distance, not by making anything faster.',
          nodes: ['prop'],
          edges: [],
        },
        {
          id: 'w2',
          title: 'Handshakes and slow start are what connection reuse deletes',
          description:
            'Together these can be five or more round trips on a fresh connection carrying a megabyte. A reused connection pays neither. This is why a pool sized for your actual peak concurrency is worth more than most code optimisation.',
          nodes: ['hand', 'slow'],
          edges: ['q1', 'q2'],
        },
        {
          id: 'w3',
          title: 'Transmission is the only bandwidth term',
          description:
            'For a 5 KB JSON response this is under a millisecond on any modern link. Teams that respond to a latency problem by provisioning more bandwidth are optimising the term that was already negligible.',
          nodes: ['xmit'],
          edges: ['q3'],
        },
        {
          id: 'w4',
          title: 'Queueing is where production systems actually die',
          description:
            'It is invisible at low load and superlinear near saturation. When p50 looks healthy and p99 is catastrophic with no resource obviously exhausted, the answer is almost always a queue you are not measuring.',
          nodes: ['proc', 'queue'],
          edges: ['q4', 'q5'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The clearest place this shows up in practice is mobile clients, and the pattern generalises to any client on a long, lossy link.

A mobile app opening its home screen typically needs several pieces of data: the user profile, a feed, notification counts, feature flags. The obvious implementation issues four requests. On a good WiFi connection at 20 ms RTT nobody notices. On a mobile network at 150 ms RTT with a fresh connection, that same screen takes well over a second before anything renders — and almost none of that is the server.

Three techniques address it, and they attack different terms in the budget:

**Connection reuse plus multiplexing.** HTTP/2 lets all four requests share one connection, so the handshakes are paid once and the congestion window is shared and warm. This deletes the repeated handshake round trips but not the per-request round trip.

**Batching or a composed endpoint.** One request returning all four payloads deletes three round trips outright. This is the largest single win, and it is why "backend for frontend" endpoints exist at all — not for elegance, but for round trips. The cost is real: the composed response is unique per user so it caches poorly, and one slow dependency now delays the whole screen unless partial failure is designed in.

**Prefetching and caching on the device.** The fastest request is the one never made. A client that already has last session's feed can render immediately and refresh in the background, which converts a latency problem into a staleness problem — usually a good trade for a feed and a terrible one for an account balance.

The transferable structure: when a client is far away, the design lever is *number of exchanges*, and each technique should be justified by which exchange it removes. A team that answers "the app is slow on mobile" with "we'll add caching" without saying which round trip disappears is guessing.

The same reasoning inverts for service-to-service calls inside one datacentre at 0.5 ms RTT. There, round trips are nearly free and the dominant terms are server work and queueing — so batching buys almost nothing and connection pooling matters for handshake *CPU* rather than latency. Same diagram, different bottleneck, because the distance term changed by two orders of magnitude.`,
  },

  tradeoffs: {
    intro:
      'The options below all reduce perceived latency. They are ordered by how little machinery they need, and the first two should be exhausted before the others are considered.',
    rows: [
      {
        option: 'Do nothing: new connection per request',
        whenItWins:
          'Very low request rates, or clients that genuinely make one call and disappear. Simplest possible client, no pool to size or tune.',
        whenItLoses: 'Any client making more than one request, and anything on a high-latency link.',
        cost:
          'Handshake round trips and a cold congestion window on every request, plus TLS handshake CPU on the server for each one.',
      },
      {
        option: 'Connection reuse: keep-alive, HTTP/2, client-side pools',
        whenItWins:
          'Nearly always. Removes handshake round trips and preserves a warmed window for essentially no development cost.',
        whenItLoses:
          'Rarely. But pools hide dead peers, and mismatched idle timeouts produce intermittent resets that look like flaky infrastructure.',
        cost:
          'Memory per idle connection, pool sizing, idle-timeout coordination with the server, and coarser load distribution across instances.',
      },
      {
        option: 'Batch or compose requests',
        whenItWins:
          'Chatty clients on high-latency links. Deleting a round trip always beats making one faster, and this is the only technique that deletes them.',
        whenItLoses:
          'When it couples independent failures, or when the composed response is unique per caller and therefore uncacheable.',
        cost:
          'A wider API surface, partial-failure semantics you must define, and worse cacheability.',
      },
      {
        option: 'Move the endpoint closer (edge, regional deployment)',
        whenItWins:
          'When propagation delay dominates and the work can genuinely be done near the user — static assets, cacheable reads, TLS termination.',
        whenItLoses:
          'When the operation needs data that only exists in one region; you have then added a hop rather than removed one.',
        cost:
          'Operational complexity, and either replicated state with its consistency problems or a second network hop back to origin.',
      },
      {
        option: 'Buy more bandwidth',
        whenItWins:
          'When you are genuinely transmission-bound: large payloads, video, bulk transfer, saturated links.',
        whenItLoses:
          'Every latency problem involving small payloads, which is most API traffic. It does not shorten a single round trip.',
        cost:
          'Money, and the opportunity cost of not fixing the term that was actually dominant.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The API is slow, so we should increase our bandwidth."',
      whyWeak:
        'Bandwidth affects transmission time, which for a few kilobytes of JSON is well under a millisecond on any modern link. The slowness is round trips, server work or queueing. This answer optimises the smallest term in the budget and leaves the largest untouched.',
      strongAnswer:
        '"I would break the time down first: propagation, handshakes, slow start, transmission, server work, queueing. For a small JSON response transmission is negligible, so I would expect the answer to be round trips or queueing. Bandwidth is the right lever only when we are moving enough data to saturate the link."',
    },
    {
      weakAnswer: '"We use connection pooling, so handshake cost is not an issue."',
      whyWeak:
        'True only if the pool is large enough for peak concurrency and the idle timeouts are coordinated. A pool that is too small silently serialises requests behind connection acquisition; an idle timeout longer than the server\'s produces resets on sockets the server has already closed. Both look like random p99 spikes.',
      strongAnswer:
        '"We pool, and I would check two things: that the pool size covers peak concurrency, because otherwise requests queue on acquisition rather than on the server, and that our idle timeout is shorter than the server\'s so we are always the side that closes. Mismatched timeouts are the classic cause of intermittent connection resets."',
    },
    {
      weakAnswer: '"Latency is fine — CPU is at 30% and nothing is saturated."',
      whyWeak:
        'Queueing delay grows superlinearly as utilisation rises, and the queue is rarely on the dashboard. Requests can be waiting in a connection pool, a thread pool or a socket backlog while every resource graph looks calm. Utilisation is an average, and averages are exactly where tail latency hides.',
      strongAnswer:
        '"Resource utilisation being low does not rule out queueing — the queue may be in the connection pool or the thread pool rather than in CPU. I would look at pool wait time and at the p50/p99 gap. A large gap with healthy averages is the signature of a queue somewhere I am not measuring."',
    },
    {
      weakAnswer: '"We set a 200 ms timeout everywhere so we fail fast."',
      whyWeak:
        'A single timeout applied uniformly ignores that different callers are different distances away and that a cold connection costs several round trips before any work begins. Set below the cold-path cost, every first request fails, the client retries, and the retries create the load spike the timeout was meant to prevent.',
      strongAnswer:
        '"Timeouts have to be budgeted against the whole path, and separately for connect and read — they fail for different reasons and deserve different values. I would also add jittered backoff on retry, because synchronised retries after a timeout are how a brief slowdown becomes an outage."',
    },
  ],

  flashcards: [
    {
      id: 'fc-tcp-1',
      front: 'What is the bandwidth-delay product and why does it matter?',
      back: 'Bandwidth × RTT: the number of bytes that must be in flight to keep a link busy. If the congestion window or receive buffer is smaller than the BDP, the sender idles waiting for acknowledgements and extra bandwidth buys nothing.',
      topic: 'bandwidth',
    },
    {
      id: 'fc-tcp-2',
      front: 'Why does a 1 MB transfer on a new connection take much longer than payload ÷ bandwidth?',
      back: 'Slow start. TCP begins with roughly a 14 KB congestion window and doubles it each round trip, so a megabyte takes several round trips of ramp before the link is used fully.',
      topic: 'congestion-control',
    },
    {
      id: 'fc-tcp-3',
      front: 'Name the two separate benefits of reusing a TCP connection.',
      back: 'It skips the TCP and TLS handshake round trips, and it inherits an already-grown congestion window so the transfer starts at full speed instead of in slow start.',
      topic: 'connections',
    },
    {
      id: 'fc-tcp-4',
      front: 'What does TCP guarantee, and what must your protocol provide itself?',
      back: 'TCP guarantees ordered, complete delivery and flow control. It does not provide message boundaries — framing is the application protocol\'s job — and it does not provide timeliness.',
      topic: 'tcp',
    },
    {
      id: 'fc-tcp-5',
      front: 'What is head-of-line blocking in TCP?',
      back: 'A lost segment must be retransmitted before anything behind it can be delivered, because TCP guarantees ordering. Ordered delivery and low latency are in tension, and TCP always chooses ordering.',
      topic: 'tcp',
    },
    {
      id: 'fc-tcp-6',
      front: 'Why must a client\'s idle timeout be shorter than the server\'s?',
      back: 'So the client is always the side that closes. Otherwise the client writes to a socket the server already closed and sees a connection reset — the classic cause of intermittent, unexplained errors.',
      topic: 'connections',
    },
    {
      id: 'fc-tcp-7',
      front: 'What is the signature of queueing delay in latency metrics?',
      back: 'A healthy p50 with a large p99, while no resource looks saturated. The queue is usually in a connection pool, thread pool or socket backlog rather than in CPU.',
      topic: 'queueing',
    },
    {
      id: 'fc-tcp-8',
      front: 'Why does connection reuse make load balancing coarser?',
      back: 'Traffic is distributed at connect time rather than per request, so a newly added instance receives nothing until connections churn. L7 balancers that route per request avoid this; L4 balancers do not.',
      topic: 'connections',
    },
    {
      id: 'fc-tcp-9',
      front: 'Which single technique reduces latency more than making a request faster?',
      back: 'Deleting the request. Batching or composing removes a whole round trip; the cost is coupled failures and worse cacheability.',
      topic: 'latency',
    },
  ],

  quiz: [
    {
      id: 'q-tcp-1',
      kind: 'scenario',
      prompt:
        'A service returns 4 KB JSON responses. Clients 150 ms away report p50 latency of 620 ms. Server-side processing is 15 ms and the link is nowhere near saturated. What is the most likely dominant term?',
      options: [
        { id: 'a', label: 'Round trips: handshakes plus per-request exchanges on connections that are not being reused' },
        { id: 'b', label: 'Transmission time for the 4 KB payload' },
        { id: 'c', label: 'Server processing time' },
        { id: 'd', label: 'Insufficient bandwidth on the client link' },
      ],
      correct: ['a'],
      explanation:
        '4 KB transmits in well under a millisecond on any modern link, and 15 ms of server time accounts for almost nothing of 620 ms. At 150 ms RTT, roughly four round trips explains the figure exactly — which is what a cold connection costs. Connection reuse is the lever.',
      difficulty: 'core',
      topic: 'latency',
    },
    {
      id: 'q-tcp-2',
      kind: 'scenario',
      prompt:
        'A batch job copies 500 MB between two datacentres on a 1 Gbps link with 80 ms RTT. It achieves about 60 Mbps and the link is otherwise idle. What is the most likely cause?',
      options: [
        { id: 'a', label: 'The window is smaller than the bandwidth-delay product, so the sender idles waiting for acknowledgements' },
        { id: 'b', label: 'The link is oversubscribed by other traffic' },
        { id: 'c', label: 'The receiving application is too slow to read the data' },
        { id: 'd', label: 'Packet loss is forcing constant retransmission' },
      ],
      correct: ['a'],
      explanation:
        'The BDP here is 1 Gbps × 0.08 s ÷ 8 = 10 MB. A connection whose window caps well below that spends most of each round trip idle regardless of available bandwidth. This is the classic long-fat-network problem, fixed with window scaling, larger buffers, or parallel streams. An idle link rules out contention.',
      difficulty: 'advanced',
      topic: 'bandwidth',
    },
    {
      id: 'q-tcp-3',
      kind: 'single',
      prompt: 'Which of these does TCP explicitly not provide?',
      options: [
        { id: 'a', label: 'Message boundaries between application writes' },
        { id: 'b', label: 'Ordered delivery of bytes' },
        { id: 'c', label: 'Retransmission of lost segments' },
        { id: 'd', label: 'Flow control to avoid overwhelming the receiver' },
      ],
      correct: ['a'],
      explanation:
        'TCP is a byte stream. Two application writes may arrive as one read, or one write may arrive as several. Framing is the application protocol\'s responsibility — Content-Length in HTTP, length-prefixed frames in gRPC — and getting it wrong is the source of most partial-message parsing bugs.',
      difficulty: 'intro',
      topic: 'tcp',
    },
    {
      id: 'q-tcp-4',
      kind: 'scenario',
      prompt:
        'After a deploy that restarts all instances within 30 seconds, CPU spikes to 100% across the fleet even though request volume is unchanged. What is happening?',
      options: [
        { id: 'a', label: 'A connection storm: every client re-handshakes simultaneously, and TLS handshakes are CPU-expensive' },
        { id: 'b', label: 'The new build has a performance regression' },
        { id: 'c', label: 'Slow start is limiting throughput and causing retries' },
        { id: 'd', label: 'The load balancer is sending duplicate traffic' },
      ],
      correct: ['a'],
      explanation:
        'Steady-state traffic on warm connections costs almost no handshake CPU. Killing every connection at once forces every client to redo TCP and TLS simultaneously, and the asymmetric cryptography in a TLS handshake is expensive. Staggered restarts with connection draining and jittered client reconnect are the fix; more CPU is not.',
      difficulty: 'advanced',
      topic: 'connections',
    },
    {
      id: 'q-tcp-5',
      kind: 'scenario',
      prompt:
        'An internal service call has 0.4 ms RTT within one datacentre. A team proposes batching ten small calls into one to reduce latency. What is the strongest response?',
      options: [
        { id: 'a', label: 'At 0.4 ms the round trips are already negligible; batching buys almost nothing and couples ten failures together' },
        { id: 'b', label: 'Agree — batching always reduces latency' },
        { id: 'c', label: 'Agree, because it also reduces bandwidth usage' },
        { id: 'd', label: 'Disagree, because batching is only valid for writes' },
      ],
      correct: ['a'],
      explanation:
        'Ten round trips at 0.4 ms is 4 ms — likely smaller than the server work involved. Batching would buy that back while making one slow dependency delay all ten results and requiring partial-failure semantics. The same technique that is essential at 150 ms RTT is unjustified at 0.4 ms, which is why "where is the caller" precedes every latency fix.',
      difficulty: 'core',
      topic: 'latency',
    },
    {
      id: 'q-tcp-6',
      kind: 'multi',
      prompt: 'Which of these are genuine costs of long-lived pooled connections? Select all that apply.',
      options: [
        { id: 'a', label: 'Memory for socket buffers on both ends' },
        { id: 'b', label: 'Load is distributed at connect time, so new instances receive no traffic until connections churn' },
        { id: 'c', label: 'Sockets can be closed by a peer or middlebox without the client noticing until it writes' },
        { id: 'd', label: 'Each request must repeat the TLS handshake' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are real and worth naming. Repeating the TLS handshake per request is what pooling exists to avoid — it is the cost of *not* pooling. Being able to state the genuine costs is what separates a considered answer from repeating "use keep-alive".',
      difficulty: 'core',
      topic: 'connections',
    },
  ],

  exercises: [
    {
      id: 'ex-tcp-1',
      kind: 'estimate',
      title: 'Budget a mobile screen, then delete round trips',
      estimatedMinutes: 18,
      prompt: `A mobile app's home screen issues six API requests on launch:

- profile (2 KB), feed page 1 (60 KB), notification count (200 B), feature flags (4 KB), recent searches (1 KB), unread messages (500 B)

Assume: RTT 150 ms, TLS 1.3, fresh connection at launch, HTTP/2 available, server p99 per request 30 ms, all six issued in parallel by the client.

1. Compute the time until the screen has all six responses. Show the round trips separately from transmission.
2. Recompute for HTTP/1.1 with six parallel connections instead. What is different, and why is it worse than it first appears?
3. Propose two changes and quantify each. State one thing each change costs.
4. Now change one assumption: the app was opened five minutes ago and the connection is still alive. Recompute the HTTP/2 case and say what fraction of the original time was connection setup.`,
      rubric: [
        'Separates the one-off setup (DNS possibly cached, TCP 1 RTT, TLS 1 RTT) from the per-request round trip.',
        'Recognises that HTTP/2 multiplexes all six over one connection, so it is roughly 3 RTT total plus transmission, not 6 × 3 RTT.',
        'Notices the 60 KB feed page is subject to slow start on a fresh connection and therefore costs additional round trips beyond the request/response exchange.',
        'For HTTP/1.1 identifies that six parallel connections mean six handshakes and six cold congestion windows, plus TLS CPU on the server — worse than the naive "they run in parallel so it is the same" answer.',
        'Proposes composing endpoints and/or prefetch-and-render-stale, and quantifies the round trips removed rather than asserting improvement.',
        'States a cost for each change: composed responses are uncacheable per user and couple failures; stale-render trades latency for staleness.',
        'For the warm-connection case computes roughly 1 RTT plus transmission and expresses setup as a fraction of the original total.',
      ],
      modelAnswer: `**1. HTTP/2, cold connection**

| Step | Round trips | Time |
| --- | --- | --- |
| TCP handshake | 1 | 150 ms |
| TLS 1.3 handshake | 1 | 150 ms |
| All six requests, multiplexed | 1 | 150 ms + 30 ms server |
| Slow start for the 60 KB feed | ~2 extra | ~300 ms |
| **Total** | | **≈ 780 ms** |

Transmission itself is negligible: 68 KB total is a few milliseconds on any usable link. Essentially the entire 780 ms is round trips.

The slow-start term is the one most people miss. A fresh connection's initial window is around 14 KB, so 60 KB needs roughly two extra doublings before it is all in flight.

**2. HTTP/1.1, six parallel connections**

Superficially the same: six handshakes happen concurrently, so wall-clock setup is still about 2 RTT. But three things are worse:

- **Six cold congestion windows instead of one.** The feed page gets its own 14 KB start with no help from the other five connections. Same slow-start penalty, no sharing.
- **Six TLS handshakes of server CPU** instead of one. Invisible for one client, very visible when a million clients launch at once — this is the connection-storm mechanism.
- **Browsers and many clients cap parallel connections per host** (historically six). Any seventh request queues on the client, which is a queue you do not control and cannot see server-side.

So wall-clock is similar for one client and materially worse in aggregate, which is exactly the kind of cost that does not show up in a single-device test.

**3. Two changes**

*Change A — compose the six calls into one endpoint.*
Removes nothing from setup (still 2 RTT) but collapses six logical requests into one exchange. In HTTP/2 the direct round-trip saving is small since they were already multiplexed; the real saving is that the server does one round of work and the client parses one payload. Bigger win: it makes the *stale-render* change below possible with a single cached blob.
*Estimated saving:* modest on HTTP/2 (~30–50 ms), large on HTTP/1.1 (~150 ms plus queueing).
*Cost:* the composed response is unique per user so it caches poorly, and one slow dependency now delays the whole screen unless the endpoint returns partial results with per-section error markers.

*Change B — render from cache immediately, refresh in background.*
The screen paints from last session's data at roughly 0 ms and updates when the network responds.
*Estimated saving:* ~780 ms of *perceived* latency, which is the number the user experiences.
*Cost:* the user briefly sees stale data. Fine for a feed and unread counts; unacceptable for anything the user will act on financially. This trade must be made per field, not per screen.

I would deliberately not propose "more bandwidth": 68 KB is not a bandwidth problem.

**4. Warm connection, HTTP/2**

| Step | Round trips | Time |
| --- | --- | --- |
| Handshakes | 0 | 0 ms |
| Requests, multiplexed | 1 | 150 ms + 30 ms |
| Slow start | 0 — window already grown | 0 ms |
| **Total** | | **≈ 180 ms** |

Setup was 780 − 180 = **600 ms, roughly 77% of the original launch time**.

That is the headline number. Three quarters of a cold app launch is connection establishment and congestion-window ramp — not the API, not the server, not the payload. Which makes connection warming on app launch (open the connection while the splash screen renders, before any request is needed) one of the highest-leverage mobile optimisations available, and it requires no backend change at all.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-tcp-1',
      level: 'basic',
      question: 'What is the difference between latency and bandwidth?',
      guidance:
        'Latency is time-to-first-byte, governed by distance and round trips; bandwidth is bytes per second once flowing. A strong answer immediately says which one adding servers or buying a fatter link helps, and gives an example where the two point at different fixes.',
    },
    {
      id: 'iq-tcp-2',
      level: 'basic',
      question: 'Why is the first request on a new connection slower than the tenth?',
      guidance:
        'Two mechanisms, and a strong answer names both: the handshake round trips are paid once, and the congestion window has grown out of slow start. Candidates who only mention the handshake have half the picture and will underestimate the value of connection reuse for large payloads.',
    },
    {
      id: 'iq-tcp-3',
      level: 'intermediate',
      question: 'A batch transfer between datacentres reaches only a fraction of the link speed on an idle link. What would you check?',
      guidance:
        'Look for bandwidth-delay product reasoning: window size versus BDP, window scaling, receive buffer limits, and the option of parallel streams. Weak answers reach for packet loss first; an idle link makes that unlikely and the arithmetic points elsewhere.',
    },
    {
      id: 'iq-tcp-4',
      level: 'intermediate',
      question: 'How would you set timeouts for a service that is called from three different regions?',
      guidance:
        'The key insight is that a timeout is a budget over the whole path and the path length differs per caller. Strong answers separate connect from read timeouts, size against cold-path cost, and add jittered backoff. Excellent answers mention retry budgets so retries cannot amplify a slowdown into an outage.',
    },
    {
      id: 'iq-tcp-5',
      level: 'advanced',
      question: 'p50 is 25 ms, p99 is 1.8 s, and no resource is saturated. Where do you look?',
      guidance:
        'Queueing, and the candidate should say where queues hide: connection pool acquisition, thread pools, socket backlogs. Strong answers also consider cold connections producing a bimodal distribution. Excellent answers note that utilisation dashboards are averages and cannot show this, so the fix starts with instrumenting pool wait time.',
    },
    {
      id: 'iq-tcp-6',
      level: 'advanced',
      question: 'What breaks when you enable aggressive connection pooling in a client?',
      guidance:
        'Memory per idle connection, stale sockets closed by peers or middleboxes, idle-timeout mismatch producing resets, coarser load distribution so new instances stay idle, and connection storms when everything reconnects at once. A candidate who can only list benefits has not operated one.',
    },
    {
      id: 'iq-tcp-7',
      level: 'followup',
      question: 'You said batching helps. When does it make things worse?',
      guidance:
        'When round trips are already cheap (intra-datacentre), when it couples independent failures so one slow item delays everything, when the batched response becomes uncacheable, and when it creates a large payload subject to slow start. Strong answers say partial-failure semantics must be designed before batching, not after.',
    },
    {
      id: 'iq-tcp-8',
      level: 'followup',
      question: 'Head-of-line blocking exists in TCP. Does moving to HTTP/2 fix it?',
      guidance:
        'No — HTTP/2 removes application-level head-of-line blocking between streams but they all share one TCP connection, so a lost segment still stalls every stream. The blocking moved rather than disappearing. QUIC addresses it by giving each stream independent delivery over UDP. A candidate who says HTTP/2 solves it has learned the marketing rather than the mechanism.',
    },
  ],

  activeLearning: [
    {
      id: 'al-tcp-1',
      kind: 'debug',
      prompt:
        'A service calls a dependency in the same datacentre. Normally p99 is 4 ms. During a deploy of the *dependency*, the caller\'s p99 jumps to 30 seconds for about two minutes, and its thread pool saturates — even though the dependency\'s own metrics show it healthy within 20 seconds of the deploy finishing. Explain the 100-second gap.',
      discussion: `The dependency recovered in 20 seconds. The caller took two minutes. That gap is the interesting part, and it is almost always the caller's own machinery rather than the dependency.

**What happened, in sequence:**

1. The dependency's instances went away. The caller's pooled connections became dead sockets — but a TCP connection does not announce that it has died. The caller only discovers it when it writes and gets a reset, or when it waits for a response that never comes.
2. Requests issued on dead connections did not fail fast. Depending on the client, they waited for the read timeout — and if the read timeout is generous (30 s is a common default), that is exactly where 30 seconds comes from.
3. Each waiting request held a thread and a pool slot. With a pool of, say, 200 and requests arriving at 500/s, the pool saturated in under a second.
4. Once the pool saturated, *new* requests began queueing on pool acquisition. Those requests were slow even though the dependency had recovered — they were waiting for a slot behind requests still burning down a 30-second timeout.
5. The queue drained only after the last stuck request timed out. That is the 100-second gap: it is the time for the backlog to clear, not the time for the dependency to recover.

**Why the dependency's metrics looked fine.** It was measuring requests it received. It never received these — they were stuck on the caller's side, on connections to instances that no longer existed. Two healthy-looking dashboards, one broken interaction, and the truth visible in neither.

**What to measure to confirm it:**

- Connection pool wait time and pool saturation on the caller. This is the single most diagnostic metric and is usually not instrumented.
- The distribution of caller-side failures: a spike of read timeouts at exactly the configured value is a fingerprint, not a coincidence.
- Whether the caller distinguishes "connect failed" from "read timed out" in its error metrics. If it does not, this class of incident is invisible.

**Fixes, and the order I would apply them:**

1. **Shorter read timeouts, budgeted against the actual path.** 30 seconds for a call whose p99 is 4 ms is not a safety margin, it is a resource-exhaustion vector. Something around 100 ms would have failed 300 times faster and the pool would never have saturated.
2. **Connection draining on the dependency's side** during deploys: stop accepting new work, let in-flight requests finish, close connections gracefully so the caller learns immediately instead of discovering it by timeout.
3. **A circuit breaker on the caller**, so that after a burst of failures it stops trying and fails fast rather than filling the pool with doomed requests.
4. **Health-check-driven connection eviction** so dead pool entries are removed rather than handed to the next request.

**The transferable lesson.** When a downstream recovers and an upstream does not, the extra time is almost always the upstream's own queue draining. And the queue is usually made of requests waiting on a timeout that was set generously by someone who was thinking about the slowest legitimate response rather than about how many resources a stuck request holds while it waits.`,
    },
    {
      id: 'al-tcp-2',
      kind: 'what-changes-if',
      prompt:
        'Everything in this lesson assumed TCP. Suppose the transport is QUIC (as used by HTTP/3) instead: it runs over UDP, integrates the cryptographic handshake into the transport handshake, and gives each stream independent delivery. Which of the six time terms change, and which stay exactly the same?',
      discussion: `Two terms change, one changes in an interesting partial way, and three are untouched.

**Unchanged: propagation delay.** QUIC does not move the speed of light. A client 150 ms away is still 150 ms away. This is worth stating first because it bounds how much any protocol change can possibly buy.

**Unchanged: transmission time.** Payload divided by bandwidth is the same.

**Unchanged: server processing.** Obviously.

**Changed: handshakes.** QUIC folds the transport and cryptographic handshakes together, so a new connection is one round trip rather than two. On resumption it can be zero — the client sends application data in its very first packet, with the same replay caveat as TLS 1.3 0-RTT, which means only idempotent requests may use it. So this term goes from 2 RTT to 1 RTT, or to 0 for a resuming client with an idempotent request.

**Changed: head-of-line blocking.** This is the substantive one. In TCP, a lost segment stalls *everything* behind it, including logically independent HTTP/2 streams sharing that connection. QUIC gives each stream its own delivery guarantees, so a loss affecting one stream does not delay the others. On a clean link this changes nothing; on a lossy mobile link with many concurrent streams it is a large difference. Note carefully what this does *not* fix: within a single stream, ordering is still enforced, so a loss still stalls that stream.

**Partially changed: slow start.** QUIC still has congestion control and still starts conservatively — the physics of not knowing the path capacity has not changed. But QUIC keeps congestion state per *connection* and can migrate a connection across network changes (WiFi to cellular) without re-establishing it, which means a mobile client that changes network does not restart from a cold window. Under TCP that migration means a brand new connection and a full slow start.

**Where queueing sits.** Unchanged in principle — queues are a property of your system, not the transport. But QUIC runs in user space rather than the kernel, which moves some buffering and adds CPU cost per packet. On very high throughput servers this has historically been a real trade: better tail latency on lossy links, more CPU per byte.

**The transferable point.** When someone proposes a protocol change, map it onto the time budget and ask which term it touches. QUIC is a genuine improvement for clients that are far away, on lossy links, changing networks, and making many concurrent requests — which describes mobile precisely. For two services in the same rack, it changes almost nothing worth the migration. Same protocol, opposite verdict, because the dominant term is different.`,
    },
  ],

  revision: {
    bullets: [
      'Latency is distance and round trips; bandwidth is bytes per second once flowing. Different fixes, frequently confused.',
      'Propagation delay is physics: ~200,000 km/s in fibre. Only moving the endpoint closer reduces it.',
      'TCP handshake costs 1 RTT before data; TLS 1.3 adds another.',
      'Slow start: window begins at ~14 KB and doubles per RTT. A megabyte on a fresh connection takes several round trips of ramp.',
      'Bandwidth-delay product = bandwidth × RTT. If the window is smaller than the BDP, you idle regardless of link speed.',
      'Connection reuse buys two separate things: no handshakes, and an already-grown congestion window.',
      'TCP gives ordering and completeness, not message boundaries. Framing is your protocol\'s job.',
      'Head-of-line blocking: a lost segment stalls everything behind it. HTTP/2 moves it rather than removing it; QUIC gives streams independent delivery.',
      'Client idle timeout must be shorter than the server\'s, or you write to sockets the server already closed.',
      'Pooling makes load balancing coarser: traffic is distributed at connect time, so new instances stay idle until churn.',
      'Connection storms after a synchronised restart are a TLS-handshake CPU problem, not a request-volume problem.',
      'Deleting a round trip beats speeding one up — but batching couples failures and hurts cacheability.',
      'Queueing is zero at low load and unbounded near saturation, and it hides in pools rather than in CPU graphs.',
      'Healthy p50 with catastrophic p99 and no saturated resource means a queue you are not measuring.',
      'Timeouts are budgets over the whole path; separate connect from read, and always add jittered backoff.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The transport layer beneath almost every request: a reliable, ordered byte stream whose cost is measured in round trips, congestion-window growth and queueing rather than in bytes.',
    whyItExists:
      'Networks lose, reorder and duplicate packets, and senders have no way to know how fast a path is. TCP hides all of that behind a stream abstraction, and the price of that abstraction is the round trips this lesson counts.',
    whenToUse: [
      'Whenever you are asked why something is slow, before naming a component.',
      'When sizing connection pools, timeouts and retry budgets — all of which are priced in round trips.',
      'When deciding whether batching, an edge deployment or more capacity is the right lever.',
    ],
    whenNotToUse: [
      'Reasoning about throughput ceilings — that is a bandwidth and queueing question, not a round-trip one.',
      'Intra-datacentre calls at sub-millisecond RTT, where round trips are noise and server work plus queueing dominate.',
    ],
    alternatives: [
      'QUIC/HTTP-3: one-round-trip handshake, per-stream delivery, connection migration across networks. Better on lossy mobile links, more CPU per byte.',
      'Persistent streams (WebSockets, gRPC streaming): pay setup once, then no per-message round trip at all.',
      'UDP with application-level reliability, when you would rather drop late data than deliver it in order — real-time media and games.',
    ],
    tradeoffs: [
      'Connection reuse removes handshakes and warm windows, and costs memory, stale-socket handling and coarser load distribution.',
      'Batching removes round trips and couples failures while destroying cacheability.',
      'Ordered delivery buys simplicity and costs head-of-line blocking under loss.',
      'Generous timeouts tolerate slow responses and turn a slow dependency into resource exhaustion.',
    ],
    failureModes: [
      'Connection storm after a synchronised restart: handshake CPU, not request volume, is the limit.',
      'Idle-timeout mismatch: the client writes to a socket the server closed, producing intermittent resets.',
      'Pool exhaustion behind long timeouts, so a recovered dependency leaves the caller broken for minutes.',
      'Window below the bandwidth-delay product: an idle fast link with a slow transfer.',
      'Timeouts shorter than cold-path cost, so first requests always fail and retries amplify load.',
    ],
    followUpQuestions: [
      'How many round trips does this operation take, and how many have already been paid?',
      'How far away is the caller, and does that change your answer?',
      'What is your pool size relative to peak concurrency, and which side closes idle connections?',
      'Is this latency problem distance, work, or queueing — and what measurement distinguishes them?',
      'What happens to your callers when this service restarts every instance at once?',
    ],
  },
});
