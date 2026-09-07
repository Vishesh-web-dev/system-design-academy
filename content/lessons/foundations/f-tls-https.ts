import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-tls-https',
  title: 'TLS and HTTPS: what it protects, what it costs',
  summary:
    'What TLS actually guarantees, where those guarantees stop, and why terminating at the edge is a latency win that silently creates a second trust decision you have to make on purpose.',
  phase: 'foundations',
  module: 'networking',
  position: 4,
  kind: 'concept',
  difficulty: 'intro',
  estimatedMinutes: 35,
  tags: ['tls', 'https', 'security', 'certificates', 'mtls', 'trust-boundaries'],
  prerequisites: ['f-http-versions'],
  resources: [
    {
      key: 'rfc-8446-tls13',
      tier: 'must',
      note: 'Read section 2 only. It shows the 1-RTT handshake and 0-RTT resumption as message flows, which is the part that shapes latency budgets and the replay constraint.',
    },
    {
      key: 'rfc-8555-acme',
      tier: 'must',
      note: 'How automated certificate issuance and renewal actually works. Expiry is the most common TLS outage, and this is the mechanism that removes the human from the loop.',
    },
    {
      key: 'envoy-architecture',
      tier: 'good',
      note: 'The service-mesh view of mutual TLS: identity per workload rather than per network location. Read the sections on listeners and upstream connections.',
    },
    {
      key: 'owasp-auth-cheatsheet',
      tier: 'good',
      note: 'Where transport security ends and application authentication begins. Useful for keeping the two separate in your head, which is the mistake this lesson is guarding against.',
    },
  ],

  intuition: {
    body: `TLS answers three questions about a connection, and it is worth being precise about which three, because engineers routinely credit it with a fourth it does not provide.

1. **Is anyone reading this?** No — the payload is encrypted (confidentiality).
2. **Has anyone changed it?** No — tampering is detectable (integrity).
3. **Am I talking to who I think I am?** Yes, for the *server* — its certificate proves it controls that hostname (authentication).

The fourth question TLS does not answer: **what happens to the data after it is decrypted.** TLS protects bytes in transit between two endpoints. It says nothing about the endpoint's behaviour, nothing about whether that endpoint should have received the data, and nothing about anything past the point of decryption.

That gap is where the interesting design decisions live. The moment you terminate TLS at a load balancer or CDN edge — which almost every production system does, for good latency reasons — the client's guarantee ends there. The traffic between that edge and your services is a *separate* decision that you now have to make deliberately. "It's HTTPS" stops being an answer at exactly the point most people stop thinking about it.

The other thing worth internalising is that TLS costs a round trip and some CPU, and both are avoidable in the ways that matter: the round trip disappears with connection reuse, and the CPU is concentrated in the handshake rather than the data transfer. That asymmetry — expensive to start, cheap to continue — is what makes connection storms a real operational hazard and steady-state encryption a non-issue.`,
    analogyLimit:
      'Thinking of TLS as "a sealed envelope" is fine until you notice that an envelope protects the contents from everyone including the recipient\'s mailroom, whereas TLS protects them only up to whichever machine holds the private key. In a typical deployment that machine is an edge proxy the user has never heard of, and everything past it is plaintext unless you arranged otherwise.',
  },

  deepExplanation: {
    predict: {
      question:
        'Your architecture is: client → CDN (TLS terminated) → load balancer → API service → database. The client sees a green padlock. List everywhere the request exists in plaintext, and say which of those you consider acceptable and why.',
      answer: `Plaintext exists at **every hop after the CDN**, plus inside the CDN itself:

1. **Inside the CDN edge**, after decryption. The CDN provider can read the full request and response. This is not a flaw — it is the entire reason they can cache and route — but it is a trust decision, and for regulated data it may be the wrong one.
2. **CDN → load balancer**, unless re-encrypted. Over the public internet or a shared network this is the worst leg.
3. **Load balancer → API service**, unless re-encrypted.
4. **API service → database**, unless the driver uses TLS. Frequently it does not, because it is "internal".
5. **In memory and in logs** on every one of those machines. Logging a request body is the most common way sensitive data leaves a system.

Which are acceptable depends entirely on the threat model, and stating the threat model is the answer:

- If the threat is a passive observer on the public internet, terminating at the CDN and re-encrypting to origin is fine.
- If the threat is an attacker who has already reached your internal network — which is the assumption behind zero-trust and the one most production designs now make — then every internal hop needs its own encryption *and* its own authentication, because being on the network must not be sufficient to be trusted. That is what mutual TLS provides.
- If the threat is a compromised or subpoenaed CDN, terminating there is unacceptable and you need end-to-end encryption the CDN cannot break — which means giving up edge caching of that content.

The point of the exercise: **"we use HTTPS" describes one leg of five.** A design that says it is secure because the browser shows a padlock has answered a question nobody asked.`,
    },
    body: `## The handshake, and what each round trip buys

TLS 1.3 completes in one round trip before application data flows.

1. **ClientHello** — supported cipher suites, and a key share (the client guesses the group the server will pick, which is what saves the extra round trip 1.2 needed).
2. **ServerHello** — chosen parameters, the server's key share, its certificate chain, and a Finished message proving it holds the private key.
3. Client verifies the chain, derives the shared secret, and sends application data.

TLS 1.2 needed two round trips because the key exchange could not begin until parameters were negotiated. That single round trip is why 1.3 produced a measurable latency improvement across the web rather than only a cryptographic one.

**Session resumption** lets a returning client skip the full handshake using a pre-shared key from the previous session. **0-RTT** goes further: application data rides in the client's very first packet.

0-RTT has a specific, non-negotiable constraint. Because the data is sent before any liveness exchange, an attacker who captures that packet can replay it, and the server cannot distinguish the replay from the original. **Therefore 0-RTT data must be idempotent.** A GET is fine; a POST that charges a card is not. This is the first time in the curriculum that idempotency turns out to be a protocol-level requirement rather than an application nicety, and it will not be the last.

## Certificates: what is actually proved

A certificate binds a public key to a hostname, signed by a certificate authority the client already trusts. The chain of trust runs: your certificate → an intermediate CA → a root CA in the client's trust store.

What it proves: **whoever holds the private key demonstrated control of that hostname** at issuance time. That is all.

What it does not prove: that the operator is honest, that the service is well built, that the data is handled properly, or that the hostname belongs to the organisation the user believes it does. A phishing site with a valid certificate for \`paypa1-secure.example\` gets the same padlock as anyone else.

Three operational realities that cause real outages:

**Expiry is the most common TLS incident.** Certificates are short-lived by design. Automated issuance and renewal through ACME removes the human from the loop, and any manual renewal process is an outage with a date on it.

**Revocation barely works.** OCSP and CRLs are unreliable and often fail open — a client that cannot check revocation status usually proceeds anyway. Short lifetimes are the actual mitigation: a compromised key stops mattering when the certificate expires in days rather than years.

**Rotation must be routine before it is urgent.** The time to discover your rotation process is broken is not the day a key leaks.

## Termination, and the trust boundary it creates

TLS termination means decrypting at some point before the origin. There are three shapes, and choosing one is choosing a threat model.

**Terminate at the edge, plaintext to origin.** Fastest and simplest. The client's handshake completes against a machine milliseconds away rather than continents away, which is often the single largest latency win available. Every hop after the edge is plaintext. Acceptable only when the internal network is genuinely trusted, which is an increasingly hard claim to defend.

**Terminate at the edge, re-encrypt to origin.** Same latency benefit, and the internal leg is encrypted. This is the common default. Note what it is *not*: the edge still reads everything, so this protects against network observers, not against the edge itself.

**Pass through to origin.** The edge forwards encrypted bytes without decrypting. Only the origin holds the key. Maximum confidentiality, and you give up everything that requires reading the request — caching, L7 routing, header-based rate limiting, request inspection. For most content that is too much to give up; for a small set of highly sensitive endpoints it is exactly right.

## Mutual TLS: authenticating the client too

Ordinary TLS authenticates the server. Mutual TLS (mTLS) has both sides present certificates, so the server knows which client it is talking to — cryptographically, rather than by IP address or network position.

This is the mechanism behind zero-trust service-to-service communication. The claim it enables is important: **being on the network is not sufficient to be trusted.** Every service proves its identity on every connection, so an attacker who gains network access still cannot call anything.

It costs a certificate lifecycle per workload: issuance, distribution, rotation, revocation. Doing this by hand across hundreds of services is unmanageable, which is why mTLS in practice arrives bundled with a service mesh or a workload-identity system that automates it. Proposing mTLS without proposing the automation is proposing an outage.

## What TLS costs

**Latency:** one round trip on a new connection, zero on a reused one. Connection reuse removes it entirely.

**CPU:** concentrated in the handshake, where the asymmetric cryptography lives. Bulk encryption of the data stream is cheap — modern CPUs have dedicated instructions and the overhead is typically low single-digit percent. This asymmetry is why the cost surfaces as a *connection rate* problem rather than a throughput problem, and why a fleet that comfortably serves warm connections can fail establishing cold ones after a synchronised restart.

**Operational:** certificates to issue, renew, distribute and rotate, plus the monitoring to notice when that stops working.

## Where the model is misapplied

**"Internal traffic doesn't need TLS."** This assumes the network perimeter is a security boundary. Shared infrastructure, container platforms and cloud networks all undermine that assumption, and lateral movement after an initial compromise is how most breaches actually progress.

**"We use HTTPS, so we're secure."** TLS is transport security. It does not authenticate users, authorise actions, validate input, or prevent an application from leaking data itself. Conflating the two layers means the application-layer work quietly does not get done.

**"TLS is too slow."** Measurable on connection rate, negligible on throughput, and removable with connection reuse. This objection was defensible in 2005 and is not now.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'tls-handshake',
      title: 'TLS 1.3: one round trip, and where 0-RTT gets its constraint',
      caption:
        'Notice that in the 0-RTT path the client sends application data before any exchange proves the server is live. That is exactly why the data is replayable, and therefore why it must be idempotent.',
      code: `sequenceDiagram
    participant C as Client
    participant S as Server

    rect rgb(21,29,38)
    Note over C,S: Full handshake — 1 round trip
    C->>S: ClientHello + key share + cipher suites
    S-->>C: ServerHello + key share + certificate + Finished
    Note right of C: Verify chain, derive keys
    C->>S: Finished + application data
    end

    rect rgb(23,39,42)
    Note over C,S: Resumption with 0-RTT — no round trip
    C->>S: ClientHello + PSK + early application data
    Note right of S: Replayable: an attacker can<br/>resend this packet verbatim
    S-->>C: ServerHello + Finished + response
    end`,
    },
    {
      kind: 'flow',
      id: 'trust-boundaries',
      title: 'Where the client guarantee ends',
      caption:
        'Step through the hops. The client\'s padlock covers exactly the first edge, and every hop after it is a separate decision. The point is not that termination is wrong — it is that it is a decision, and it is usually made by default.',
      nodes: [
        { id: 'client', label: 'Client', kind: 'client', x: 0, y: 120, detail: 'Holds the trust store and verifies the certificate chain. Its guarantee covers exactly one leg: from here to whichever machine holds the private key.' },
        { id: 'edge', label: 'CDN / edge', kind: 'edge', x: 200, y: 120, detail: 'Terminates TLS milliseconds from the user rather than continents away — usually the largest single latency win available. It also reads every request and response in plaintext, which is what makes caching and L7 routing possible.' },
        { id: 'lb', label: 'Load balancer', kind: 'edge', x: 410, y: 120, detail: 'Second hop. Encrypted only if the edge was configured to re-encrypt. Over a shared or public network this is the leg most often left in plaintext by accident.' },
        { id: 'api', label: 'API service', kind: 'service', x: 610, y: 120, detail: 'Where mTLS matters: with it, the service knows which caller it is talking to cryptographically rather than by IP address or network position.' },
        { id: 'db', label: 'Database', kind: 'store', x: 810, y: 120, detail: 'Frequently unencrypted because it is "internal". Most drivers support TLS and most deployments do not enable it.' },
        { id: 'logs', label: 'Logs and traces', kind: 'store', x: 610, y: 280, detail: 'The hop nobody diagrams. A logged request body is plaintext at rest in a system with a completely different access model to the database.' },
      ],
      edges: [
        { id: 't1', source: 'client', target: 'edge', label: 'TLS — the padlock', kind: 'sync' },
        { id: 't2', source: 'edge', target: 'lb', label: 're-encrypt?', kind: 'sync' },
        { id: 't3', source: 'lb', target: 'api', label: 'mTLS?', kind: 'sync' },
        { id: 't4', source: 'api', target: 'db', label: 'TLS?', kind: 'write' },
        { id: 't5', source: 'api', target: 'logs', label: 'plaintext', kind: 'async' },
      ],
      steps: [
        {
          id: 'b1',
          title: 'The padlock covers one leg',
          description:
            'The client verifies a certificate for the hostname and encrypts to whichever machine holds the matching private key. In almost every production system that machine is an edge proxy, not your service.',
          nodes: ['client', 'edge'],
          edges: ['t1'],
        },
        {
          id: 'b2',
          title: 'Every hop after termination is a separate decision',
          description:
            'Re-encrypting to origin protects against network observers. It does not protect against the edge itself, which read everything in order to cache and route. Choosing between them is choosing a threat model, and it should be explicit.',
          nodes: ['edge', 'lb', 'api'],
          edges: ['t2', 't3'],
        },
        {
          id: 'b3',
          title: 'mTLS moves trust from network position to identity',
          description:
            'With mutual TLS both sides present certificates, so an attacker who reaches the network still cannot call the service. The cost is a certificate lifecycle per workload, which is only manageable when it is automated.',
          nodes: ['api'],
          edges: ['t3'],
        },
        {
          id: 'b4',
          title: 'The hops that are not on the diagram',
          description:
            'Database connections often run unencrypted because they are "internal". Logs and traces hold plaintext request bodies at rest under a different access model entirely. Both are where sensitive data actually escapes.',
          nodes: ['db', 'logs'],
          edges: ['t4', 't5'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Envoy service mesh'],
    body: `The service-mesh pattern, as implemented by proxies such as Envoy, is the clearest production expression of the idea that network position is not identity.

The traditional model authorises by location: services inside the perimeter can call each other, and a firewall keeps everyone else out. The failure mode is well known — an attacker who gets a foothold anywhere inside can move laterally, because being inside is the credential.

A mesh replaces that with per-workload identity. Every service instance is issued a short-lived certificate identifying *what it is*, not where it runs. A sidecar proxy alongside each service terminates inbound mTLS, verifies the caller's certificate, and originates outbound mTLS on the way to its dependencies. Authorisation policy is then written in terms of identity: "the checkout service may call the payments service", enforced cryptographically on every connection.

Three properties are worth extracting, none of which require adopting a mesh:

**The certificate lifecycle has to be automated or the model collapses.** Certificates live hours to days, are issued by an internal authority, and are rotated without restarts. Nobody can hand-manage thousands of certificates on that cadence — which is why mTLS arrives as part of a platform rather than as a configuration change. Proposing the security property without proposing the automation is proposing an outage.

**Encryption and authorisation are separate concerns that arrive together.** mTLS provides both: the channel is encrypted *and* both ends are identified. It is the identification that changes the security model; the encryption is almost incidental in a datacentre where the wire may already be reasonably protected.

**The proxy is now a component with its own failure modes.** Every request traverses two extra hops (local sidecars), which adds latency, memory and a new class of incident — certificate rotation failures, proxy version skew, configuration propagation delays. That is a real cost, and the honest framing in an interview is that a mesh trades application-level security work for platform-level operational work rather than eliminating work.

The transferable question, whether or not a mesh is involved: **if an attacker were already inside your network, which of your services would they be able to call?** If the answer is "all of them", your security model is the perimeter, and the perimeter is not a boundary you control.`,
  },

  tradeoffs: {
    intro:
      'The decision is where TLS terminates and whether the internal legs are protected. Each row is a different threat model, and picking one means naming the attacker you are defending against.',
    rows: [
      {
        option: 'TLS to the origin, no edge (do nothing extra)',
        whenItWins:
          'Small deployments, internal tools, and any service where the origin is close to its users and no caching layer is needed.',
        whenItLoses:
          'Geographically distributed users — three handshake round trips against a distant origin is the largest avoidable latency in the request.',
        cost:
          'Handshake latency proportional to distance, and TLS handshake CPU concentrated on your origin fleet.',
      },
      {
        option: 'Terminate at the edge, plaintext to origin',
        whenItWins:
          'Public, non-sensitive content on a genuinely private network segment. Simplest and fastest.',
        whenItLoses:
          'Any threat model that includes an attacker inside the network, which is now the default assumption.',
        cost:
          'Every internal hop readable by anyone with network access, and a security posture that depends on a perimeter.',
      },
      {
        option: 'Terminate at the edge, re-encrypt to origin',
        whenItWins:
          'Almost all production systems. Keeps the latency benefit and closes the network-observer gap.',
        whenItLoses:
          'When the edge itself is outside your trust boundary — it still reads everything in plaintext.',
        cost:
          'A second set of certificates to manage, plus handshake CPU on both the edge and the origin.',
      },
      {
        option: 'Pass through: only the origin holds the key',
        whenItWins:
          'Highly sensitive endpoints where no intermediary may see the payload, and where caching and L7 routing are not needed anyway.',
        whenItLoses:
          'Anything that benefits from edge caching, path-based routing, header inspection or WAF rules — all of which require reading the request.',
        cost:
          'Loss of every edge capability, and full handshake latency against a distant origin.',
      },
      {
        option: 'mTLS between internal services',
        whenItWins:
          'When you need identity rather than location as the basis of authorisation — multi-tenant platforms, regulated environments, anything assuming the network is hostile.',
        whenItLoses:
          'Small systems where the certificate lifecycle costs more than the risk it removes.',
        cost:
          'A certificate per workload with automated issuance and rotation, plus proxy hops and a new class of operational failure.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We terminate TLS at the load balancer, so traffic is encrypted."',
      whyWeak:
        'Encrypted up to the load balancer. What happens between it and the services behind it is a separate, unstated decision — and it is exactly the leg an interviewer will ask about. In a shared or multi-tenant network it is also the leg an attacker is most likely to be sitting on.',
      strongAnswer:
        '"We terminate at the edge for latency and re-encrypt to origin. Between services we use mTLS, so identity does not depend on network position. The threat model is an attacker already inside the network, which is why being on the network is not sufficient to call anything."',
    },
    {
      weakAnswer: '"Internal service-to-service traffic does not need TLS — it never leaves our network."',
      whyWeak:
        'It treats the network perimeter as a security boundary. On shared cloud infrastructure, container platforms and multi-tenant networks that assumption does not hold, and lateral movement after an initial foothold is how most breaches progress. It also leaves you with no way to authenticate callers other than by IP address, which is spoofable and fragile.',
      strongAnswer:
        '"I would use mTLS internally, mainly for the identity rather than the encryption: it lets us authorise by workload identity instead of by network position. That requires automated certificate issuance and rotation, so I would only propose it alongside the platform capability to run it."',
    },
    {
      weakAnswer: '"The site has a valid certificate, so users know it is legitimate."',
      whyWeak:
        'A certificate proves control of a hostname at issuance time. It proves nothing about the operator\'s honesty or the organisation behind the name. Phishing sites obtain valid certificates routinely, and the padlock is exactly as green.',
      strongAnswer:
        '"A certificate proves the server controls that hostname and nothing more. It does not establish that the operator is trustworthy. Identity assurance for users is a separate problem — domain reputation, brand indicators, user education — and it is not something TLS was designed to provide."',
    },
    {
      weakAnswer: '"We enable TLS 0-RTT everywhere to cut latency."',
      whyWeak:
        'Early data is sent before any exchange proves the server is live, so a captured packet can be replayed verbatim and the server cannot tell. Applying 0-RTT to a non-idempotent request means an attacker can cause the operation to happen twice.',
      strongAnswer:
        '"0-RTT is only safe for idempotent requests, because early data is replayable by design. I would enable it for GETs and explicitly exclude anything that mutates state — and I would rely on idempotency keys on the write path anyway, since retries create the same hazard from a different direction."',
    },
    {
      weakAnswer: '"TLS adds too much overhead for high-throughput services."',
      whyWeak:
        'It conflates handshake cost with bulk encryption cost. The expensive asymmetric cryptography happens once per connection; symmetric encryption of the stream has dedicated CPU instructions and typically costs low single-digit percent. The real cost surfaces as connection *rate*, not throughput.',
      strongAnswer:
        '"The cost is concentrated in the handshake, so it shows up as a connection-rate problem rather than a throughput one. Connection reuse removes it almost entirely. Where I would pay attention is a synchronised restart, because tens of thousands of simultaneous handshakes is genuinely expensive — that is a deploy-strategy problem, not a reason to disable TLS."',
    },
  ],

  flashcards: [
    {
      id: 'fc-tls-1',
      front: 'What three properties does TLS provide, and what does it not?',
      back: 'Confidentiality, integrity, and authentication of the server. It says nothing about what happens after decryption — endpoint behaviour, authorisation, or data handling.',
      topic: 'tls',
    },
    {
      id: 'fc-tls-2',
      front: 'Why must TLS 0-RTT data be idempotent?',
      back: 'Early data is sent before any exchange proves the server is live, so a captured packet can be replayed and the server cannot distinguish it from the original.',
      topic: 'tls',
    },
    {
      id: 'fc-tls-3',
      front: 'What exactly does a certificate prove?',
      back: 'That whoever holds the private key demonstrated control of that hostname at issuance time. Nothing about the operator, the organisation, or the quality of the service.',
      topic: 'certificates',
    },
    {
      id: 'fc-tls-4',
      front: 'Why are short certificate lifetimes the real mitigation for key compromise?',
      back: 'Revocation is unreliable — OCSP and CRL checks often fail open. A certificate that expires in days limits the damage window without depending on clients checking anything.',
      topic: 'certificates',
    },
    {
      id: 'fc-tls-5',
      front: 'What do you give up by passing TLS through to the origin instead of terminating at the edge?',
      back: 'Everything that requires reading the request: edge caching, path and header routing, WAF inspection, header-based rate limiting. Plus full handshake latency against a distant origin.',
      topic: 'trust-boundaries',
    },
    {
      id: 'fc-tls-6',
      front: 'What does mTLS change about a security model?',
      back: 'Authorisation moves from network position to cryptographic workload identity, so an attacker already inside the network still cannot call a service.',
      topic: 'mtls',
    },
    {
      id: 'fc-tls-7',
      front: 'Where is TLS CPU cost concentrated, and what does that imply operationally?',
      back: 'In the handshake\'s asymmetric cryptography, not in bulk stream encryption. So the risk is connection rate — a synchronised fleet restart can exhaust CPU establishing connections it served happily when warm.',
      topic: 'https',
    },
    {
      id: 'fc-tls-8',
      front: 'Name two plaintext hops that are usually missing from an architecture diagram.',
      back: 'The application-to-database connection, often unencrypted because it is "internal", and logs or traces holding request bodies at rest under a different access model.',
      topic: 'trust-boundaries',
    },
  ],

  quiz: [
    {
      id: 'q-tls-1',
      kind: 'scenario',
      prompt:
        'An auditor asks where customer data exists in plaintext in a system: client → CDN (terminates TLS) → LB (re-encrypted) → API (re-encrypted) → database (unencrypted driver). What is the most accurate answer?',
      options: [
        { id: 'a', label: 'Inside the CDN after decryption, on the API↔database leg, and in memory and logs on every hop' },
        { id: 'b', label: 'Nowhere — every external leg is encrypted' },
        { id: 'c', label: 'Only on the API↔database leg' },
        { id: 'd', label: 'Only inside the CDN' },
      ],
      correct: ['a'],
      explanation:
        'Re-encrypting protects the wire, not the endpoints. The CDN decrypts in order to cache and route, so it sees everything. The database driver leg is plaintext. And every hop holds the data in memory and, if request bodies are logged, at rest in a system with a different access model. Enumerating all of these is what an honest answer looks like.',
      difficulty: 'core',
      topic: 'trust-boundaries',
    },
    {
      id: 'q-tls-2',
      kind: 'scenario',
      prompt:
        'A team enables TLS 0-RTT for all endpoints to reduce mobile latency. A week later, duplicate charges appear. What happened?',
      options: [
        { id: 'a', label: 'A payment POST was sent as 0-RTT early data and replayed — early data is replayable by design' },
        { id: 'b', label: 'The TLS session cache was shared across users' },
        { id: 'c', label: 'Certificate rotation invalidated in-flight requests, causing client retries' },
        { id: 'd', label: 'HTTP/2 multiplexing duplicated the stream' },
      ],
      correct: ['a'],
      explanation:
        '0-RTT sends application data before any liveness exchange, so an attacker — or a retrying network path — can replay the packet and the server cannot tell. This is why 0-RTT must be restricted to idempotent requests, and why the write path needs idempotency keys regardless.',
      difficulty: 'advanced',
      topic: 'tls',
    },
    {
      id: 'q-tls-3',
      kind: 'single',
      prompt: 'What does a valid TLS certificate for a domain prove?',
      options: [
        { id: 'a', label: 'The holder demonstrated control of that hostname when the certificate was issued' },
        { id: 'b', label: 'The organisation behind the site has been verified as legitimate' },
        { id: 'c', label: 'The server stores user data securely' },
        { id: 'd', label: 'The connection cannot be intercepted by any party' },
      ],
      correct: ['a'],
      explanation:
        'Domain control at issuance time is the entire claim. It says nothing about the operator or their practices, which is why phishing sites carry valid certificates and identical padlocks. And the connection is protected only up to whichever machine holds the private key.',
      difficulty: 'intro',
      topic: 'certificates',
    },
    {
      id: 'q-tls-4',
      kind: 'scenario',
      prompt:
        'A deploy restarts 400 instances in 20 seconds. Request volume is unchanged, but CPU saturates fleet-wide for two minutes. Which explanation fits best?',
      options: [
        { id: 'a', label: 'Every client re-handshakes at once, and TLS handshake asymmetric cryptography is the expensive part' },
        { id: 'b', label: 'Bulk TLS encryption overhead scales with instance count' },
        { id: 'c', label: 'Certificate validation now happens on every request instead of per connection' },
        { id: 'd', label: 'The new instances have not warmed their JIT caches' },
      ],
      correct: ['a'],
      explanation:
        'Steady-state encryption is cheap; the handshake is not. Killing every connection simultaneously converts a warm fleet into one doing tens of thousands of simultaneous handshakes. The fix is staggered restarts with connection draining and jittered client reconnect — a deploy strategy, not more CPU.',
      difficulty: 'advanced',
      topic: 'https',
    },
    {
      id: 'q-tls-5',
      kind: 'scenario',
      prompt:
        'A payments service must guarantee no intermediary can read request bodies, and it needs no caching. What termination strategy fits?',
      options: [
        { id: 'a', label: 'Pass through: the edge forwards encrypted bytes and only the origin holds the key' },
        { id: 'b', label: 'Terminate at the edge and re-encrypt to origin' },
        { id: 'c', label: 'Terminate at the edge with plaintext to origin, on a private link' },
        { id: 'd', label: 'Terminate at the origin only, with no edge at all' },
      ],
      correct: ['a'],
      explanation:
        'Re-encryption protects the wire but the edge still decrypts and reads everything, which violates the stated requirement. Pass-through keeps the key at the origin. It costs every edge capability that needs to read the request — acceptable here precisely because caching is not needed. Option (d) also satisfies confidentiality but gives up the edge entirely, including DDoS absorption.',
      difficulty: 'core',
      topic: 'trust-boundaries',
    },
    {
      id: 'q-tls-6',
      kind: 'multi',
      prompt: 'Which of these are genuine costs of adopting mTLS between internal services? Select all that apply.',
      options: [
        { id: 'a', label: 'A certificate lifecycle per workload: issuance, distribution, rotation' },
        { id: 'b', label: 'Extra proxy hops and their latency and memory, in a sidecar deployment' },
        { id: 'c', label: 'A new class of incident: rotation failures, config propagation delays, version skew' },
        { id: 'd', label: 'Application code must implement certificate verification itself' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the real operational costs, and naming them is what distinguishes a considered proposal from a slogan. Application code does not implement verification — that is precisely what the sidecar or TLS library handles, and it is why mTLS is deployable without touching services.',
      difficulty: 'core',
      topic: 'mtls',
    },
  ],

  exercises: [
    {
      id: 'ex-tls-1',
      kind: 'design',
      title: 'State the threat model, then place the boundaries',
      estimatedMinutes: 18,
      prompt: `You are designing transport security for a health-records platform:

- Patients access it from browsers and a mobile app, globally.
- Clinicians access it from hospital networks you do not control.
- The platform runs on shared cloud infrastructure alongside other tenants.
- Records must not be readable by any third party, including infrastructure providers, without a specific contractual basis.
- Static assets (CSS, JS, images) are large and benefit substantially from edge caching.
- There is a regulatory audit requirement to show where data exists in plaintext.

Produce:
1. Three distinct threat actors you are defending against, with what each can do.
2. A termination strategy per traffic class, justified by which actor it addresses.
3. The internal service-to-service posture, and what it requires operationally.
4. The two plaintext locations most likely to be missed in the audit, and how you would address them.`,
      rubric: [
        'Names at least three distinct actors with different capabilities — e.g. a passive network observer, an attacker with a foothold inside the cloud network, and the infrastructure provider itself.',
        'Splits traffic by class rather than choosing one strategy for everything: static assets and record data get different termination.',
        'Justifies edge termination for static assets by the latency and caching benefit and the absence of sensitive content.',
        'Chooses pass-through or origin-only termination for record data, and explicitly states what edge capability is given up.',
        'Proposes mTLS internally for identity rather than only encryption, and states that automated issuance and rotation is a prerequisite rather than a detail.',
        'Identifies logs and traces as a plaintext location, with a concrete control (redaction at emission, not at query time).',
        'Identifies the database connection or backups as the second, with a concrete control (driver TLS, encryption at rest with a separately managed key).',
      ],
      modelAnswer: `**1. Threat actors**

*A — Passive network observer.* Sits on a hospital network, public WiFi, or an intermediate transit provider. Can read anything unencrypted in transit; cannot execute code anywhere. Cheapest to defend against and the one ordinary TLS handles completely.

*B — Attacker with a foothold in the cloud environment.* Has compromised one workload or obtained credentials to one namespace. Can reach internal network addresses and attempt calls to other services. This is the actor that makes perimeter security insufficient, and the one mTLS exists for.

*C — The infrastructure or CDN provider.* Not malicious, but legally and technically capable of reading anything decrypted on their machines. Defending against this is a *contractual and architectural* choice, not a purely technical one, and the regulatory requirement makes it explicit.

**2. Termination per traffic class**

*Static assets (CSS, JS, images, fonts).* Terminate at the CDN edge. Contains no record data, benefits enormously from caching and from a handshake against a nearby machine. Addresses actor A; actor C is irrelevant because there is nothing sensitive to read.

*API traffic carrying record data.* Do not terminate at a third-party edge. Either pass through to origin, or terminate at an edge we operate inside our own trust boundary. This addresses actor C, and it is the requirement doing the work — the latency cost is real and accepted deliberately.

*Authentication endpoints.* Same as record data. Credentials are at least as sensitive as records.

The split is the whole answer. Applying one strategy to all traffic would mean either giving up caching on 80% of bytes or exposing records to the CDN.

**3. Internal posture**

mTLS between all services, with authorisation expressed in terms of workload identity rather than network address. The property that matters is not the encryption — it is that a compromised workload (actor B) presenting no valid identity cannot call the records service at all.

Operationally this requires, and I would not propose it without:

- An internal certificate authority issuing short-lived (hours) workload certificates.
- Automated distribution and rotation without restarts.
- Authorisation policy as code, reviewed like any other change.
- Monitoring for rotation failure, which is the failure mode that takes the whole platform down at once.

If that platform capability does not exist, mTLS is a project, not a configuration change, and I would say so rather than presenting it as free.

**4. The two plaintext locations most likely to be missed**

*Logs and traces.* Request and response bodies logged for debugging are plaintext at rest, in a system that typically has broader access than the database and a longer retention period than anyone intends. The control has to be **redaction at emission** — a structured logging layer that only serialises allowlisted fields — because redaction at query time means the data was still written. I would also make the audit check log storage, not just the database.

*Database connections and backups.* Drivers commonly default to unencrypted connections on the assumption that the network is internal, which is precisely the assumption actor B invalidates. Enable driver TLS with certificate verification. Backups are the same problem displaced in time: encrypted at rest with a key managed separately from the backup store, otherwise the key and the ciphertext sit in the same compromised bucket.

I would add a third if the audit permits: **memory dumps and crash reports.** They contain whatever was being processed, and they are routinely shipped to third-party error-tracking services — which reintroduces actor C through a door nobody drew on the diagram.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-tls-1',
      level: 'basic',
      question: 'What does HTTPS actually protect against?',
      guidance:
        'Confidentiality, integrity, and server authentication — for one leg. A strong answer immediately says where the guarantee stops (at whichever machine holds the private key) and notes that it says nothing about authorisation, input validation, or how the endpoint handles the data.',
    },
    {
      id: 'iq-tls-2',
      level: 'basic',
      question: 'How many round trips does a TLS handshake cost, and can you avoid them?',
      guidance:
        'One for TLS 1.3, two for 1.2, zero on a reused connection or with 0-RTT resumption. A strong answer connects this to connection pooling and notes the 0-RTT replay constraint rather than presenting it as free latency.',
    },
    {
      id: 'iq-tls-3',
      level: 'intermediate',
      question: 'You terminate TLS at a CDN. What is the security posture behind it?',
      guidance:
        'The candidate must recognise this is a separate decision. Look for: re-encryption to origin, an explicit threat model, and the observation that the CDN itself reads everything. Excellent answers note the case where that is unacceptable and what you give up by passing through instead.',
    },
    {
      id: 'iq-tls-4',
      level: 'intermediate',
      question: 'Why would you use mTLS between internal services rather than just a firewall?',
      guidance:
        'Because a firewall authorises by location and an attacker with any foothold is inside. mTLS authorises by cryptographic identity, so being on the network is not sufficient. A strong answer immediately names the operational cost — a certificate lifecycle per workload — and says it must be automated.',
    },
    {
      id: 'iq-tls-5',
      level: 'advanced',
      question: 'Walk me through everywhere sensitive data exists in plaintext in a typical deployment.',
      guidance:
        'Look for the hops beyond the diagram: inside the terminating proxy, on any un-re-encrypted internal leg, in the database connection, in logs and traces, in memory dumps and crash reports shipped to third parties, and in backups. A candidate who names only the wire has not thought about where data actually leaks.',
    },
    {
      id: 'iq-tls-6',
      level: 'advanced',
      question: 'Your certificates expire in 30 days and renewal is a manual runbook. What do you change and why?',
      guidance:
        'Automate issuance and renewal, shorten lifetimes deliberately, and monitor for renewal failure rather than for expiry. Strong answers explain that short lifetimes are the real mitigation for compromise because revocation is unreliable and often fails open. Excellent answers note that shorter lifetimes force the automation to work, which is a feature.',
    },
    {
      id: 'iq-tls-7',
      level: 'followup',
      question: 'You said TLS overhead is negligible. When is that not true?',
      guidance:
        'When connection *rate* is high rather than throughput: a synchronised restart, a client that does not pool, or a service handling many short-lived connections. The asymmetric cryptography in the handshake is where the cost lives. A candidate who cannot name the exception is repeating a slogan.',
    },
    {
      id: 'iq-tls-8',
      level: 'followup',
      question: 'If mTLS gives you identity, do you still need application-level authorisation?',
      guidance:
        'Yes. mTLS establishes which *service* is calling; it says nothing about which *user* the request is on behalf of, or whether that user may perform this action on this resource. Strong answers keep the two layers distinct and note that collapsing them produces a system where any compromised service can act as any user.',
    },
  ],

  activeLearning: [
    {
      id: 'al-tls-1',
      kind: 'modify-architecture',
      prompt:
        'A system terminates TLS at a third-party CDN and re-encrypts to origin. Legal now requires that the CDN must not be able to read request bodies for one specific endpoint — a document upload — while everything else stays as it is. Sketch the change. Be specific about what the CDN can still do for that endpoint and what it cannot.',
      discussion: `The instinct is "pass that endpoint through", and it is broadly right — but the interesting part is enumerating exactly what breaks, because that is what the interviewer will push on.

**The change.** Route the upload endpoint to a separate hostname (or a separate CDN configuration) set to TCP pass-through, so the CDN forwards encrypted bytes and only the origin holds the key. Everything else continues to terminate at the edge.

**What the CDN can still do for that endpoint:**

- Absorb volumetric DDoS at layer 3 and 4. It can see packet rates and source addresses without reading payloads.
- Route by SNI, which is visible in the ClientHello. So it still knows which hostname is being contacted — worth noting, because "the CDN sees nothing" is not quite true.
- Provide anycast routing to a nearby point of presence, which still shortens the network path even though the handshake completes at the origin.

**What it can no longer do:**

- Cache. Irrelevant here — an upload is not cacheable — which is exactly why this endpoint is the right one to pass through.
- Path-based routing, since the path is inside the encrypted stream. All routing must be by hostname, which is why the separate hostname is not optional.
- WAF inspection, request-size enforcement, and header-based rate limiting. These all need the plaintext request. **This is the real cost**, and it must be replaced at the origin rather than quietly dropped — otherwise the change trades a confidentiality gain for an availability and abuse regression.
- TLS termination close to the user, so the handshake now costs a full round trip to the origin. On an upload endpoint that matters less than usual, because the transfer dominates.

**What you must add at the origin to compensate:**

- Request size limits and upload rate limiting, previously enforced at the edge.
- Whatever WAF rules protected that endpoint.
- Capacity for the handshake CPU the edge was absorbing.

**The second-order problem worth raising unprompted.** A separate hostname for uploads is visible in DNS and in SNI, so an observer learns that a request is an upload before any content is exchanged. For most systems that is fine; for one where the *existence* of an upload is itself sensitive, it is a leak that the encryption does not cover. Encrypted Client Hello addresses this and is not universally deployed, so the honest answer is to name the residual exposure rather than claim it away.

**The transferable structure.** Any change that removes an intermediary's ability to read traffic removes every capability that depended on reading it. List those capabilities before making the change, and decide for each one whether it moves, is replaced, or is genuinely abandoned. A design that only lists the security gain is half a design.`,
    },
    {
      id: 'al-tls-2',
      kind: 'explain-yourself',
      prompt:
        'Write, in your own words and without looking back, the answer you would give to: "Why bother with mTLS internally when everything is already inside our VPC?" Aim for five or six sentences and make sure you concede the strongest part of their position. Then compare with the discussion.',
      discussion: `A strong answer here concedes the cost honestly, because the objection is reasonable and dismissing it signals you have not operated one.

One version:

> Inside a VPC the wire is reasonably protected, so encryption is not really the argument — the argument is identity. Right now anything that reaches the network can call anything, which means one compromised workload or one leaked credential gives an attacker the whole internal surface. mTLS makes each service prove *what it is* on every connection, so authorisation stops depending on network position and starts depending on identity. That said, it is not free: it needs an internal CA, short-lived certificates, automated rotation without restarts, and it introduces a new outage mode when rotation breaks. So I would only propose it if we have or can build that automation, and I would start with the services holding the most sensitive data rather than turning it on everywhere at once.

What makes that strong:

- **It concedes the correct point.** In a VPC, encryption genuinely is the weaker half of the argument. Leading with "but the traffic is unencrypted!" would be arguing the part where the objector is right.
- **It names the actual property**: identity replacing location as the basis of authorisation.
- **It states the threat concretely** — one compromised workload, lateral movement — rather than gesturing at "security".
- **It names the operational cost, including the new failure mode.** Rotation failure taking down every service simultaneously is a real risk and pretending otherwise is how these proposals lose credibility.
- **It proposes an incremental path.** "Everywhere at once" is how mTLS projects fail; starting with the highest-value services is how they succeed.

Weaknesses to check your own answer for:

- Did you argue mainly about encryption? That is the weaker half inside a VPC.
- Did you claim it is free or easy? It is neither, and the objector will know.
- Did you propose a big-bang rollout?
- Did you say anything about what happens when certificate rotation fails at 3am? If not, you have not thought about operating it.`,
    },
  ],

  revision: {
    bullets: [
      'TLS provides confidentiality, integrity, and authentication of the server. It says nothing about what happens after decryption.',
      'The client\'s guarantee ends at whichever machine holds the private key — usually an edge proxy, not your service.',
      'TLS 1.3 handshake: 1 RTT. TLS 1.2: 2 RTT. Reused connection: 0. Resumption with 0-RTT: 0, with a replay constraint.',
      '0-RTT early data is replayable by design, so it must carry only idempotent requests.',
      'A certificate proves control of a hostname at issuance time. Nothing about the operator or the organisation.',
      'Revocation is unreliable and often fails open; short lifetimes plus automated renewal are the real mitigation.',
      'Certificate expiry is the most common TLS outage. Automate issuance and renewal, and monitor renewal, not expiry.',
      'Three termination shapes: plaintext to origin, re-encrypt to origin, pass through. Each names a different threat model.',
      'Re-encryption protects against network observers, not against the terminating edge, which reads everything.',
      'Pass-through gives up caching, path routing, WAF and header-based rate limiting — everything that needs to read the request.',
      'mTLS moves authorisation from network position to workload identity, so a foothold on the network is not enough.',
      'mTLS requires automated certificate issuance and rotation; without it, it is an outage waiting for a date.',
      'TLS CPU is concentrated in the handshake, so the risk is connection rate, not throughput. Steady-state encryption is cheap.',
      'The plaintext hops people forget: the database driver, logs and traces, crash reports sent to third parties, and backups.',
      'Transport security is not authentication or authorisation. Conflating the layers means the application-layer work quietly does not happen.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A protocol that encrypts and authenticates a connection between two endpoints, proving that the server controls the hostname it claims and that nobody in between can read or alter the bytes.',
    whyItExists:
      'The network path between a client and a server passes through machines nobody controls. TLS makes that path unreadable and untamperable without requiring trust in any of them.',
    whenToUse: [
      'Every external connection, without exception.',
      'Internal connections when the threat model includes an attacker already inside the network — which is the default assumption on shared infrastructure.',
      'mTLS specifically when authorisation should depend on workload identity rather than network position.',
    ],
    whenNotToUse: [
      'As a substitute for authentication or authorisation — it establishes a channel, not a permission.',
      'mTLS in a small system where the certificate lifecycle costs more operationally than the risk it removes.',
    ],
    alternatives: [
      'Application-layer encryption when even the terminating endpoint must not read the payload, at the cost of losing every capability that needs plaintext.',
      'Network isolation such as a private link, which reduces exposure without providing identity — usually a complement, not a replacement.',
      'Token-based authentication for identity, which authenticates the caller but leaves the channel unprotected.',
    ],
    tradeoffs: [
      'Edge termination buys large latency wins and creates a second trust decision you must make explicitly.',
      'Pass-through buys confidentiality from intermediaries and costs caching, routing and inspection.',
      'mTLS buys identity-based authorisation and costs a certificate lifecycle plus a new class of outage.',
      '0-RTT buys a round trip and costs replay safety on anything that mutates state.',
    ],
    failureModes: [
      'Certificate expiry — the most common TLS incident, and entirely preventable with automation.',
      'Connection storms after synchronised restart: handshake CPU, not request volume, is the limit.',
      'An internal leg left in plaintext because it was assumed to be inside a trusted network.',
      'Sensitive data written to logs, traces or crash reports in plaintext, under a different access model.',
      '0-RTT applied to non-idempotent requests, producing duplicate side effects on replay.',
      'Certificate rotation failure in an mTLS deployment, taking every service down simultaneously.',
    ],
    followUpQuestions: [
      'Where does the client\'s TLS guarantee end, and what protects the hops after that?',
      'What is your threat model — a network observer, an attacker inside, or the infrastructure provider?',
      'How are certificates issued and rotated, and what happens when that automation fails?',
      'If an attacker had a foothold in your network, which services could they call?',
      'Where does sensitive data exist in plaintext that is not on your architecture diagram?',
    ],
  },
});
