import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-cdn',
  title: 'CDN and edge caching',
  summary:
    'A CDN is a cache you do not control, keyed by a string you must design deliberately — and personalisation is what quietly makes that key unique per user and the whole thing useless.',
  phase: 'distributed',
  module: 'serving',
  position: 21,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 40,
  tags: ['cdn', 'cache-keys', 'invalidation', 'http-caching', 'edge'],
  prerequisites: ['d-caching'],
  resources: [
    {
      key: 'rfc-9111-http-caching',
      tier: 'must',
      note: 'The normative rules for freshness, revalidation and the directives. Read the sections on `Cache-Control` response directives and on validators — everything a CDN does is an implementation of this document.',
    },
    {
      key: 'mdn-http-caching',
      tier: 'must',
      note: 'The readable version of the same material, with the distinction between a private and a shared cache made explicit. Start here if RFC prose is heavy going.',
    },
    {
      key: 'aws-cloudfront-caching',
      tier: 'must',
      note: 'Read this specifically for how a cache key is constructed and what is included in it by default. It is the clearest statement anywhere of the idea that the key is a design decision.',
    },
    {
      key: 'netflix-open-connect',
      tier: 'good',
      note: 'A CDN taken to its logical conclusion: appliances inside ISP networks, filled overnight. Read it for the insight that predictable content lets you pre-position rather than cache on demand.',
    },
    {
      key: 'web-almanac-http',
      tier: 'good',
      note: 'Measured data on what real sites actually send. Useful as a corrective — the gap between the caching headers people believe they set and the ones they do is large.',
    },
    {
      key: 'rfc-9114-http3',
      tier: 'advanced',
      note: 'Read the introduction for why connection setup cost matters at the edge. A CDN\'s latency advantage is substantially about terminating the connection close to the user, not only about the cache hit.',
    },
  ],

  intuition: {
    body: `The caching lesson framed a cache as a second copy of the truth that can be wrong. A CDN is that, with two properties that change how you reason about it.

**It is geographically distributed.** Hundreds of points of presence, each holding a copy. A user in Mumbai is served from Mumbai rather than from your origin in Virginia. This saves two things, and the second is usually larger: the bytes travel less far, and — because the TCP and TLS handshake terminates at the nearby edge — the *connection setup* happens over 20 ms of network rather than 250 ms. On a small request, setup dominates transfer, so a CDN can be a large win even at a low hit rate.

**You do not control it.** This is the property people underestimate. You cannot inspect it, you cannot reason about which copy a given user hit, and when content is wrong you cannot reach in and fix it. You can only ask, politely and asynchronously, for it to be purged — and then wait.

Everything hard about CDNs follows from one mechanism: **the cache key.**

An edge cache stores responses keyed by a string. By default that string is roughly the URL. When a request arrives, the edge builds the key, and if it has a fresh response for that key it serves it — **without asking your origin, and without knowing anything about who is asking.**

That last clause is the whole difficulty. Two users requesting the same URL get the same bytes. If your response depends on who they are — their name in the header, their currency, their language, their feature flags — then serving one user's response to another is a **correctness bug**, and one that leaks data across accounts.

The two ways out are the entire design space. Either **include the varying dimension in the key** — which multiplies the number of stored objects and divides your hit rate — or **remove the personalisation from the cacheable response** and fetch it separately. Almost every real CDN decision is a choice between those two.

The framing to carry: **a CDN does not cache your pages. It caches key-to-response mappings.** Design the key, and everything else follows.`,
    analogyLimit:
      '"A CDN is a cache near the user" is true and stops just before the useful part. It omits that the key is yours to design, that a wrong key is a data leak rather than a slow page, and that invalidation is a request you make to someone else\'s infrastructure with no synchronous confirmation. It also hides the connection-termination benefit, which is why a CDN helps even for content that cannot be cached at all.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team puts a CDN in front of their dashboard with `Cache-Control: public, max-age=300`. The page greets the user by name and shows their account balance. Within minutes, users report seeing other people\'s names and balances. What exactly happened, and what are the two candidate fixes?',
      answer: `**What happened, precisely.** The edge cached the response for the key \`GET /dashboard\`. The first user to request it after a cache miss populated that entry with *their* rendered page, name and balance included. Every subsequent user requesting \`/dashboard\` within 300 seconds matched the same key and was served those bytes. The session cookie was never consulted, because a cookie is not part of the default cache key — the edge had a fresh response for the key and had no reason to ask the origin anything.

This is not a caching bug. It is a **cross-account data leak**, and it is the single most consequential CDN mistake because the failure is silent from the origin's perspective: your logs show one request, your error rate is zero, and your users are seeing each other's data.

**Fix candidate 1 — mark it uncacheable by shared caches.**

\`\`\`
Cache-Control: private, no-store
\`\`\`

\`private\` tells shared caches — CDNs, corporate proxies — not to store it at all, while permitting the user's own browser to. \`no-store\` forbids storage anywhere. This is the correct *immediate* fix, and it should be the default for anything user-specific. The cost is that the page is no longer edge-cached, so it is served from origin every time.

Note that the CDN still helps here: it terminates TLS near the user and holds a warm connection back to origin, so the request is faster than a direct one even with no cache hit at all.

**Fix candidate 2 — separate the personalised part from the cacheable part.**

Serve \`/dashboard\` as a cacheable shell with no user data in it — \`Cache-Control: public, max-age=300\` — and have the client fetch \`/api/me\` and \`/api/balance\` separately with \`private, no-store\`. Now the expensive, identical shell is served from the edge to everyone, and only the small personalised payloads reach the origin.

**Why not "add \`Vary: Cookie\`"?** It is technically correct and practically useless. \`Vary: Cookie\` includes the entire cookie header in the key, and every user has a distinct session cookie — so every user gets their own cache entry, the hit rate is effectively zero, and you have filled the edge with single-use objects. It is *safe*, which matters, but it purchases no benefit. If you must vary, vary on a **low-cardinality** derived value: a currency code, a language, a plan tier — never on an identity.

**The general lesson.** Ask of every response: *does this depend on who is asking?* If yes, it is either \`private\` or it must be split. Getting this wrong does not produce a stale page; it produces a breach.`,
    },
  body: `## The cache key is the design

A CDN stores responses under a key. By default the key is derived from the request URL — host, path, and usually the query string. Everything else about the request is invisible to the lookup.

You extend the key in two ways:

**\`Vary\`**, a response header naming request headers that must match. \`Vary: Accept-Encoding\` means gzip and brotli responses are stored separately, which is correct and necessary. \`Vary: Accept-Language\` gives you one entry per language.

**CDN-specific key configuration**, which lets you include named cookies, specific query parameters, or headers, and — importantly — *exclude* things. Excluding is often the bigger win: analytics query parameters like campaign tags do not change the response, but they do change the URL, so without exclusion every share link creates a fresh cache entry for identical bytes.

The arithmetic that governs every decision here:

> **Cache entries = distinct values of every dimension in the key, multiplied.**

Two languages × three currencies × two device classes is twelve entries per URL. Add a user identity and it is twelve per user, which is not a cache. **Every dimension you add divides your hit rate**, so each one needs a justification stronger than "it might matter".

## Freshness, and the directives that actually matter

\`Cache-Control\` on the *response* is how you instruct caches. The directives worth knowing cold:

| Directive | Effect | When |
| --- | --- | --- |
| \`public\` | Shared caches may store it | Anything identical for all users |
| \`private\` | Only the user's browser may store it | Anything user-specific |
| \`no-store\` | Nobody stores it | Sensitive responses |
| \`max-age=N\` | Fresh for N seconds | Everywhere |
| \`s-maxage=N\` | Overrides \`max-age\` for *shared* caches only | Long at the edge, short in the browser |
| \`no-cache\` | Store, but revalidate before every use | Content that changes unpredictably |
| \`immutable\` | Never revalidate within its freshness | Fingerprinted assets |
| \`stale-while-revalidate=N\` | Serve stale for N seconds while refreshing behind the scenes | Latency-sensitive content |
| \`stale-if-error=N\` | Serve stale for N seconds if origin errors | Availability |

Two of these deserve emphasis because they solve problems people otherwise solve badly.

**\`s-maxage\` separates the two caches.** A browser holding a page for a day is bad — the user cannot get a fix without a hard refresh. An edge holding it for a day is fine, because you can purge the edge. So \`Cache-Control: public, max-age=60, s-maxage=86400\` gives a one-minute browser cache and a one-day edge cache, and the edge absorbs essentially all the traffic while remaining under your control.

**\`stale-while-revalidate\` removes the latency cost of expiry.** Without it, the request that arrives just after expiry waits for the origin. With it, that request is served stale immediately and the refresh happens asynchronously. This is the same idea as the caching lesson's refresh-ahead, expressed as a header — and it is why the thundering-herd problem at the edge is largely solved by a directive rather than by code.

**\`no-cache\` does not mean "do not cache".** It means "store it, but check with the origin before each use". The one that means what people think \`no-cache\` means is \`no-store\`. This is a genuine and common misreading, and getting it backwards either leaks data or destroys performance.

## Validators: revalidation that costs almost nothing

When an entry expires, the cache does not have to re-download it. It sends a conditional request using a validator from the original response:

- \`ETag\` — an opaque version identifier. The cache sends \`If-None-Match\`.
- \`Last-Modified\` — a timestamp. The cache sends \`If-Modified-Since\`.

If the content has not changed, the origin replies **\`304 Not Modified\`** with no body. So revalidating a 2 MB image costs a few hundred bytes.

This makes a short \`max-age\` far cheaper than it looks: with a good \`ETag\`, a 60-second freshness on rarely-changing content costs one 304 per minute per edge, not one full transfer.

## Invalidation: purge, or design so you never need to

The caching lesson's hardest problem gets harder at the edge, because you are asking someone else's global network to forget something.

**Purge by path.** Tell the CDN to drop \`/api/products/42\`. Propagates in seconds to a few minutes. Fine for a handful of objects; useless when one change affects thousands of URLs.

**Purge by tag (surrogate keys).** Tag responses on the way out — \`Surrogate-Key: product-42 category-shoes\` — then purge the tag. One call invalidates every response involving product 42 regardless of URL. This is the mechanism that makes edge-cached dynamic content practical, and it is worth naming in an interview because it shows you have thought past "we'd purge the URL".

**Purge everything.** Available, and it sends your full traffic to origin simultaneously. This is the cold-cache problem from the caching lesson, at global scale, and it is how a routine deployment becomes an outage.

**Or: never invalidate.** Put a content hash in the filename — \`app.9f2a1c.js\` — and serve it with \`max-age=31536000, immutable\`. Content changes produce a *new URL*, so the old entry is simply never requested again. This is the correct approach for every static asset, and it dissolves invalidation rather than solving it.

The rule: **content-hash what you can, tag what you cannot, and treat purge-all as an incident tool.**

## What a CDN gives you beyond cache hits

Three benefits that survive a 0% hit rate, and each is a reason a CDN helps for content that is not cacheable at all:

**Connection termination near the user.** TCP and TLS handshakes complete over a short path. For a small request this is the majority of the total time — the CDN's advantage here is a round-trip-count reduction, not a bytes reduction.

**A warm, optimised path to origin.** Pre-established pooled connections over well-provisioned networks, so the edge-to-origin leg is faster than an arbitrary client-to-origin leg.

**Absorption of unwanted traffic.** Volumetric attacks and bot traffic terminate at the edge. This is frequently the main reason a CDN sits in front of an entirely uncacheable API.

## Where a CDN is the wrong tool

**Frequently-changing personalised content.** If the response differs per user and changes every few seconds, there is nothing to cache. Use the CDN for connection termination and stop there.

**Write paths.** \`POST\`, \`PUT\` and \`DELETE\` are not cacheable and must not be. A CDN configured to cache by method-agnostic key on a write endpoint is a serious bug.

**When strong consistency is required.** Edge propagation is eventual by construction. If a user must see their own write immediately, either bypass the edge for that request or route reads for recently-writing users to origin.

**As a substitute for a fast origin.** If the origin takes four seconds, every miss takes four seconds, and misses are guaranteed — new content, new regions, post-purge. A CDN multiplies a good origin; it does not replace one.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'cache-key-path',
      title: 'How the key decides everything',
      caption:
        'Step through it. Notice that the edge never consults identity unless you put identity in the key — which is why a personalised response under a public key is a data leak rather than a stale page.',
      nodes: [
        { id: 'user', label: 'User in Mumbai', kind: 'client', x: 0, y: 140, detail: 'Sends GET /dashboard with a session cookie. TCP and TLS terminate at the nearby edge — roughly 20 ms of round trip instead of 250 ms to origin.' },
        { id: 'edge', label: 'Edge PoP', kind: 'service', x: 200, y: 140, detail: 'Builds the cache key from the request. By default: host + path + query. Nothing else — no cookie, no header, no identity.' },
        { id: 'key', label: 'Key: GET /dashboard', kind: 'note', x: 200, y: 30, detail: 'This string is the whole contract. Two users producing the same key get the same bytes, whoever they are.' },
        { id: 'hit', label: 'Fresh entry exists', kind: 'store', x: 430, y: 60, detail: 'Served immediately, with no origin request. If that entry was populated by another user\'s personalised page, this is where the leak happens.' },
        { id: 'stale', label: 'Entry stale', kind: 'store', x: 430, y: 160, detail: 'With stale-while-revalidate, serve it now and refresh in the background. Otherwise the request waits for the origin.' },
        { id: 'miss', label: 'No entry', kind: 'store', x: 430, y: 260, detail: 'Forward to origin over a warm pooled connection — faster than an arbitrary client-to-origin leg even on a miss.' },
        { id: 'origin', label: 'Origin', kind: 'service', x: 660, y: 210, detail: 'Returns the response plus Cache-Control, Vary, ETag and any surrogate keys. These headers are the only instructions the edge receives.' },
        { id: 'revalidate', label: '304 Not Modified', kind: 'note', x: 660, y: 100, detail: 'A conditional request with If-None-Match costs a few hundred bytes. This is why a short max-age with a good ETag is far cheaper than it looks.' },
      ],
      edges: [
        { id: 'c1', source: 'user', target: 'edge', kind: 'sync' },
        { id: 'c2', source: 'edge', target: 'key', kind: 'control' },
        { id: 'c3', source: 'edge', target: 'hit', kind: 'read' },
        { id: 'c4', source: 'edge', target: 'stale', kind: 'read' },
        { id: 'c5', source: 'edge', target: 'miss', kind: 'read' },
        { id: 'c6', source: 'miss', target: 'origin', kind: 'sync' },
        { id: 'c7', source: 'stale', target: 'revalidate', kind: 'async' },
        { id: 'c8', source: 'revalidate', target: 'origin', kind: 'sync' },
      ],
      steps: [
        {
          id: 's1',
          title: 'The edge builds a key, and it is not much of a key',
          description:
            'Host, path, query string. The session cookie is present in the request and plays no part in the lookup. Extending the key is something you must do deliberately, with Vary or CDN configuration.',
          nodes: ['user', 'edge', 'key'],
          edges: ['c1', 'c2'],
        },
        {
          id: 's2',
          title: 'A hit skips the origin entirely',
          description:
            'No origin request, no logs, no error rate. If the stored entry contains another user\'s name and balance, nothing anywhere reports a problem — which is why this failure runs for minutes before anyone notices.',
          nodes: ['hit'],
          edges: ['c3'],
        },
        {
          id: 's3',
          title: 'Stale is a decision, not a failure',
          description:
            'With stale-while-revalidate the expired entry is served immediately and refreshed behind the scenes, so nobody pays the origin latency at expiry. Without it, whoever arrives first after expiry waits.',
          nodes: ['stale', 'revalidate'],
          edges: ['c4', 'c7', 'c8'],
        },
        {
          id: 's4',
          title: 'A miss still benefits from the edge',
          description:
            'The connection already terminated nearby, and the edge-to-origin leg runs over a warm pooled connection. This is why a CDN helps even for wholly uncacheable APIs — and why absorbing attack traffic is often the real reason it is there.',
          nodes: ['miss', 'origin'],
          edges: ['c5', 'c6'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'key-arithmetic',
      title: 'Every dimension divides your hit rate',
      caption:
        'The arithmetic is multiplicative. Read the bottom two rows together: varying on a low-cardinality derived value is a design; varying on identity is a cache with a hit rate of zero that you are paying to operate.',
      code: `flowchart TB
    A["Key: /page<br/>1 entry"] --> B["+ Vary: Accept-Encoding<br/>2 entries (gzip, br)"]
    B --> C["+ Vary: Accept-Language<br/>× 8 languages = 16"]
    C --> D["+ currency cookie<br/>× 4 = 64 entries"]
    D --> E["Still a cache.<br/>64 entries, high hit rate"]
    C --> F["+ Vary: Cookie<br/>× every session"]
    F --> G["One entry per user.<br/>Hit rate ≈ 0"]

    H["Excluded: utm_source, fbclid<br/>URL differs, response identical"] --> I["Without exclusion:<br/>one entry per share link"]

    style E fill:#17272a,stroke:#35897e
    style G fill:#2a1a1a,stroke:#a04848
    style I fill:#2a1a1a,stroke:#a04848`,
    },
  ],

  productionExample: {
    systems: ['netflix'],
    body: `Netflix's Open Connect is the most instructive CDN case because it inverts the usual model, and the inversion follows from one property of its content.

A general CDN caches **reactively**: a user requests something, the edge misses, it fetches from origin, and the next user in that region hits. The first user in each region pays the miss.

Netflix does not do that. It ships physical appliances into ISP networks and **fills them overnight** with content predicted to be popular in that region tomorrow. By the time anyone presses play, the bytes are already inside their ISP's network — often one hop away.

The property that makes this possible is worth extracting, because it generalises further than Netflix: **their catalogue is finite, known in advance, immutable, and has a predictable popularity distribution.** A new episode's demand is forecastable to a useful accuracy. Under those conditions, pre-positioning strictly dominates reactive caching — there is no reason to wait for a request to discover something you already knew.

Two further consequences:

**Invalidation is not a problem they have.** A video file, once encoded, never changes. A new encode is a new object with a new identifier. This is the content-hash strategy applied to a media library, and it removes the hardest part of caching entirely.

**Filling happens during off-peak hours.** The appliances are populated when the ISP's network is idle, so the transfer costs nothing at peak. The cache is not just closer — it is filled at a time when bandwidth is free.

**Where the model does not transfer.** Pre-positioning requires predictable demand over a bounded, immutable catalogue. An e-commerce site has millions of products with long-tail demand and prices that change hourly; a social feed is unique per user. Neither can be pre-positioned, and both are correctly served by reactive caching with careful key design.

The transferable question is the one Netflix answered in the affirmative and most systems answer in the negative: **do I know what will be requested before it is requested?** When the answer is yes, pre-position. When it is no, cache reactively and spend your effort on the key.`,
  },

  tradeoffs: {
    intro:
      'The recurring decision is what to put in the cache key and how long to hold the entry. Rows are the positions worth being able to defend.',
    rows: [
      {
        option: 'Content-hashed assets, `immutable`, one year',
        whenItWins:
          'Every static asset — JS, CSS, images, fonts. Maximum hit rate, zero revalidation, and invalidation dissolves because a change is a new URL.',
        whenItLoses:
          'Never, for content you build. It requires a build step that fingerprints and rewrites references.',
        cost:
          'Build tooling, and discipline that no fingerprinted URL is ever reused for different content.',
      },
      {
        option: 'Short `max-age` with a strong `ETag`',
        whenItWins:
          'Content that changes unpredictably but is expensive to generate. Revalidation costs a 304 rather than a transfer, so freshness is cheap.',
        whenItLoses:
          'When generating the ETag is itself expensive, or when the origin cannot answer conditional requests cheaply.',
        cost:
          'One conditional request per interval per edge, plus origin work to compute the validator.',
      },
      {
        option: 'Long `s-maxage`, short `max-age`, purge on change',
        whenItWins:
          'Dynamic content that must be edge-cached: product pages, article pages. The edge absorbs the traffic and stays under your control; the browser holds nothing you cannot fix.',
        whenItLoses:
          'When purge propagation delay — seconds to minutes — is too long for the requirement.',
        cost:
          'Purge infrastructure, and a delay window during which some users see stale content.',
      },
      {
        option: 'Surrogate keys (tag-based purge)',
        whenItWins:
          'When one entity appears in many URLs. Change a product; purge `product-42`; every affected response goes at once.',
        whenItLoses:
          'When tagging is incomplete — an untagged response is unpurgeable and will silently serve stale content until it expires.',
        cost:
          'Tagging discipline at every response site, and CDN support for it.',
      },
      {
        option: '`Vary` on a low-cardinality derived value',
        whenItWins:
          'Language, currency, plan tier, device class — a handful of values, each shared by many users. A real multiplier on entries with a real preserved hit rate.',
        whenItLoses:
          'As soon as the value approaches per-user cardinality, at which point the hit rate collapses.',
        cost:
          'Entries multiply by the number of distinct values, and normalising the header into a small set is your job.',
      },
      {
        option: '`private, no-store` and use the CDN only for transport',
        whenItWins:
          'Anything user-specific or sensitive. Correct by default, and still buys connection termination, a warm origin path and attack absorption.',
        whenItLoses:
          'When the uncacheable response is expensive and identical shell-plus-data separation was available and not taken.',
        cost:
          'Every request reaches origin, so origin capacity must carry full traffic.',
      },
      {
        option: 'Pre-positioning (push rather than pull)',
        whenItWins:
          'Bounded immutable catalogues with forecastable demand — video, game patches, model weights. Nobody pays a miss.',
        whenItLoses:
          'Unbounded or unpredictable catalogues, and anything personalised. You would be shipping bytes nobody requests.',
        cost:
          'Forecasting, storage for content that may not be watched, and a distribution pipeline.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We put the CDN in front of everything with a five-minute cache."',
      whyWeak:
        'If any response depends on who is asking, this serves one user\'s data to another. The default cache key does not include the session cookie, so the edge has no way to distinguish users and no reason to consult the origin.',
      strongAnswer:
        '"I would classify responses first. Static assets get content-hashed URLs with a one-year immutable cache. Shared dynamic content gets a long `s-maxage` with purge on change. Anything user-specific gets `private, no-store` — and where the expensive part is identical for everyone, I would split it into a cacheable shell plus a small personalised fetch."',
    },
    {
      weakAnswer: '"Personalisation is fine, we just add `Vary: Cookie`."',
      whyWeak:
        'Technically safe and practically useless. Every user has a distinct session cookie, so every user gets their own cache entry. The hit rate is effectively zero and the edge fills with single-use objects — you are paying to operate a cache that never hits.',
      strongAnswer:
        '"`Vary: Cookie` is safe but buys nothing, because session cookies are per-user. If I need to vary, I vary on a low-cardinality derived value — a currency code or plan tier normalised into a handful of values — and the origin is responsible for that normalisation. Identity in the key means no cache."',
    },
    {
      weakAnswer: '"We set `Cache-Control: no-cache` on sensitive pages so they are never cached."',
      whyWeak:
        '`no-cache` means "store it, but revalidate before each use" — the response *is* stored, including in shared caches unless also marked private. The directive that prevents storage is `no-store`.',
      strongAnswer:
        '"`no-store` is the one that prevents storage. `no-cache` permits storage and requires revalidation, which is a performance directive rather than a privacy one. For sensitive responses I would send `Cache-Control: private, no-store` and treat `no-cache` as unrelated to the problem."',
    },
    {
      weakAnswer: '"When content changes we purge the CDN."',
      whyWeak:
        'Purge is asynchronous, takes seconds to minutes to propagate globally, and does not scale when one change affects thousands of URLs. Relying on it as the primary mechanism means either a stale window you have not acknowledged or a purge-all that stampedes your origin.',
      strongAnswer:
        '"Purge is the fallback, not the strategy. Static assets get content hashes so a change is a new URL and no purge is needed. Dynamic content gets surrogate keys so one call invalidates every affected URL. Purge-all is an incident tool — it sends full traffic to origin at once, which is the cold-cache problem at global scale."',
    },
    {
      weakAnswer: '"Our API is not cacheable, so a CDN would not help."',
      whyWeak:
        'It conflates the CDN with its cache. Even at a 0% hit rate, terminating TCP and TLS near the user removes most of the round trips from a small request, the edge-to-origin leg runs over a warm pooled connection, and volumetric traffic never reaches your infrastructure.',
      strongAnswer:
        '"A CDN in front of an uncacheable API still helps in three ways: connection termination near the user, which dominates latency for small requests; a warm optimised path to origin; and absorption of attack and bot traffic. For many APIs that third reason is the main one. Separately, I would check whether *parts* of it are cacheable — reference data and public listings usually are."',
    },
    {
      weakAnswer: '"We enabled the CDN and the origin still gets most of the traffic — the CDN is not working."',
      whyWeak:
        'Almost always the cache key. Analytics query parameters not excluded from the key mean every share link is a distinct entry; an over-broad `Vary` fragments entries; a missing or too-short `max-age` means nothing is retained. The CDN is working exactly as configured.',
      strongAnswer:
        '"I would look at the cache key before anything else. First, which query parameters are included — campaign tags change the URL and not the response, so without exclusion every share link creates a fresh entry. Second, what `Vary` is being sent, since an over-broad `Vary` fragments the cache. Third, whether responses actually carry a freshness lifetime at all. The hit-rate-by-key-pattern report answers all three."',
    },
  ],

  flashcards: [
    {
      id: 'fc-cdn-1',
      front: 'What does a CDN actually cache?',
      back: 'Key-to-response mappings, not pages. The key is derived from the URL by default and is yours to design; everything hard about CDNs follows from it.',
      topic: 'cache-keys',
    },
    {
      id: 'fc-cdn-2',
      front: 'Why is a personalised response under a public cache key not merely a stale-data bug?',
      back: 'It is a cross-account data leak. The edge serves one user\'s stored bytes to everyone matching the key, with no origin request and therefore no logs or error rate.',
      topic: 'cache-keys',
    },
    {
      id: 'fc-cdn-3',
      front: 'Why is `Vary: Cookie` safe but useless?',
      back: 'Session cookies are per-user, so it creates one cache entry per user. Safe, zero hit rate. Vary on low-cardinality derived values instead — currency, language, plan tier.',
      topic: 'cache-keys',
    },
    {
      id: 'fc-cdn-4',
      front: 'What is the arithmetic of cache keys?',
      back: 'Entries equal the distinct values of every key dimension, multiplied. Each dimension added divides the hit rate, so each needs a real justification.',
      topic: 'cache-keys',
    },
    {
      id: 'fc-cdn-5',
      front: 'What does `no-cache` actually mean?',
      back: '"Store it, but revalidate before each use." It is a performance directive. The one that prevents storage is `no-store`.',
      topic: 'http-caching',
    },
    {
      id: 'fc-cdn-6',
      front: 'What problem does `s-maxage` solve?',
      back: 'It separates the two caches: a short `max-age` for browsers, which you cannot purge, and a long `s-maxage` for the edge, which you can. The edge absorbs traffic and stays under your control.',
      topic: 'http-caching',
    },
    {
      id: 'fc-cdn-7',
      front: 'What does `stale-while-revalidate` remove?',
      back: 'The latency cost of expiry. The request arriving after expiry is served stale immediately while the refresh happens asynchronously — refresh-ahead expressed as a header.',
      topic: 'http-caching',
    },
    {
      id: 'fc-cdn-8',
      front: 'Why does a strong `ETag` make short freshness cheap?',
      back: 'Revalidation is a conditional request answered with 304 and no body. Refreshing a 2 MB image costs a few hundred bytes rather than a full transfer.',
      topic: 'http-caching',
    },
    {
      id: 'fc-cdn-9',
      front: 'What is the correct invalidation strategy for static assets?',
      back: 'Do not invalidate. Put a content hash in the filename and serve with `max-age=31536000, immutable`, so a change produces a new URL and the old entry is never requested again.',
      topic: 'invalidation',
    },
    {
      id: 'fc-cdn-10',
      front: 'What are surrogate keys for?',
      back: 'Tagging responses so one purge call invalidates every URL involving an entity. They are what makes edge-cached dynamic content practical when one change affects many URLs.',
      topic: 'invalidation',
    },
    {
      id: 'fc-cdn-11',
      front: 'Why is purge-all an incident tool rather than a deployment step?',
      back: 'It sends your entire traffic to origin simultaneously — the cold-cache problem at global scale, which turns a routine deployment into an outage.',
      topic: 'invalidation',
    },
    {
      id: 'fc-cdn-12',
      front: 'Name three CDN benefits that survive a 0% hit rate.',
      back: 'Connection termination near the user (fewer long round trips for handshakes), a warm pooled path to origin, and absorption of volumetric and bot traffic at the edge.',
      topic: 'edge',
    },
    {
      id: 'fc-cdn-13',
      front: 'What makes Netflix able to pre-position rather than cache reactively?',
      back: 'A bounded, immutable catalogue with forecastable regional demand. Under those conditions pushing content overnight dominates waiting for a miss to discover what you already knew.',
      topic: 'cdn',
    },
    {
      id: 'fc-cdn-14',
      front: 'The origin still receives most traffic after enabling a CDN. What do you check first?',
      back: 'The cache key: unexcluded analytics query parameters, an over-broad `Vary`, and whether responses carry a freshness lifetime at all.',
      topic: 'cdn',
    },
  ],

  quiz: [
    {
      id: 'q-cdn-1',
      kind: 'scenario',
      prompt:
        'A dashboard showing the signed-in user\'s name and balance is served with `Cache-Control: public, max-age=300` behind a CDN. Users begin seeing each other\'s data. What is the precise mechanism?',
      options: [
        { id: 'a', label: 'The edge cached the first response under the key GET /dashboard and served those bytes to everyone matching the key; the session cookie is not part of the default key' },
        { id: 'b', label: 'The CDN mixed up TLS sessions between users' },
        { id: 'c', label: 'The origin returned the wrong user because of a connection-pool bug' },
        { id: 'd', label: 'max-age was too long and should be shorter' },
      ],
      correct: ['a'],
      explanation:
        'The default cache key is host, path and query — nothing about identity. One user populated the entry, everyone else matched it. Shortening max-age narrows the window without fixing the defect. The correct fix is `private, no-store`, or splitting a cacheable shell from personalised fetches.',
      difficulty: 'core',
      topic: 'cache-keys',
    },
    {
      id: 'q-cdn-2',
      kind: 'single',
      prompt: 'Which directive prevents a response from being stored anywhere?',
      options: [
        { id: 'a', label: '`no-store`' },
        { id: 'b', label: '`no-cache`' },
        { id: 'c', label: '`max-age=0`' },
        { id: 'd', label: '`must-revalidate`' },
      ],
      correct: ['a'],
      explanation:
        '`no-store` forbids storage. `no-cache` permits storage and requires revalidation before use. `max-age=0` makes it immediately stale but still storable and revalidatable. `must-revalidate` forbids serving stale after expiry. Only `no-store` addresses storage itself.',
      difficulty: 'intro',
      topic: 'http-caching',
    },
    {
      id: 'q-cdn-3',
      kind: 'scenario',
      prompt:
        'A product page is edge-cacheable and identical for everyone, but prices change several times a day and must not be shown stale for more than a minute or two. Users also must not be stuck with a bad page after a fix. What headers and mechanism?',
      options: [
        { id: 'a', label: '`public, max-age=60, s-maxage=86400, stale-while-revalidate=30` with surrogate-key purge on price change' },
        { id: 'b', label: '`public, max-age=86400` and purge-all on every price change' },
        { id: 'c', label: '`private, no-store` so prices are always current' },
        { id: 'd', label: '`public, max-age=60` everywhere, relying on expiry alone' },
      ],
      correct: ['a'],
      explanation:
        'A short browser max-age means a fix reaches users quickly; a long s-maxage lets the edge absorb traffic while remaining purgeable; surrogate keys invalidate every URL showing that product in one call; stale-while-revalidate removes the latency spike at expiry. Purge-all stampedes origin, no-store discards the benefit entirely, and expiry alone gives no way to push a correction.',
      difficulty: 'advanced',
      topic: 'invalidation',
    },
    {
      id: 'q-cdn-4',
      kind: 'scenario',
      prompt:
        'Hit rate is 12% despite most content being identical for all users. Investigation shows cached URLs like `/product/42?utm_source=twitter&fbclid=abc123`. What is the fix?',
      options: [
        { id: 'a', label: 'Exclude the analytics parameters from the cache key so all variants of the URL resolve to one entry' },
        { id: 'b', label: 'Increase max-age so entries survive longer' },
        { id: 'c', label: 'Add more edge locations' },
        { id: 'd', label: 'Add `Vary: Referer` so referrers are handled consistently' },
      ],
      correct: ['a'],
      explanation:
        'Every distinct campaign parameter creates a separate entry for byte-identical content, so each share link is a guaranteed miss. Excluding those parameters from the key collapses them into one entry. A longer max-age does not help entries that are never requested twice, more locations fragment the cache further, and adding Vary makes it worse.',
      difficulty: 'core',
      topic: 'cache-keys',
    },
    {
      id: 'q-cdn-5',
      kind: 'multi',
      prompt:
        'A CDN sits in front of a wholly uncacheable authenticated API. Which benefits still apply? Select all that apply.',
      options: [
        { id: 'a', label: 'TCP and TLS terminate near the user, removing long round trips from connection setup' },
        { id: 'b', label: 'The edge-to-origin leg uses warm pooled connections over well-provisioned networks' },
        { id: 'c', label: 'Volumetric and bot traffic is absorbed at the edge rather than reaching origin' },
        { id: 'd', label: 'Origin compute cost falls because responses are served from cache' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are independent of the cache and are often the actual reason a CDN fronts an API. The fourth requires cache hits, which by premise do not occur. Recognising this separation is what distinguishes "CDN" from "cache" in an answer.',
      difficulty: 'core',
      topic: 'edge',
    },
    {
      id: 'q-cdn-6',
      kind: 'scenario',
      prompt:
        'A team wants edge caching for a site with eight languages, four currencies, and a signed-in state that changes only a header greeting. What key design preserves a useful hit rate?',
      options: [
        { id: 'a', label: 'Vary on normalised language and currency only, and move the greeting to a separate client-side fetch marked private' },
        { id: 'b', label: 'Vary on Accept-Language, currency cookie and session cookie' },
        { id: 'c', label: 'Mark the whole site private, no-store' },
        { id: 'd', label: 'Serve one language and currency from the edge and redirect everyone else to origin' },
      ],
      correct: ['a'],
      explanation:
        'Language and currency are low-cardinality, so 8 × 4 = 32 entries per URL is a real cache. Adding the session cookie makes it one entry per user and collapses the hit rate. Marking everything no-store discards the benefit for content that is genuinely shared, and routing most users to origin defeats the purpose. Splitting the small personalised fragment out is the standard move.',
      difficulty: 'advanced',
      topic: 'cache-keys',
    },
  ],

  exercises: [
    {
      id: 'ex-cdn-1',
      kind: 'design',
      title: 'Classify every response, then design the keys',
      estimatedMinutes: 25,
      prompt: `You are putting a CDN in front of an existing e-commerce site. Classify each of the following and give the exact \`Cache-Control\` you would send, what is in the cache key, and how it gets invalidated.

1. \`/static/app.js\` — the JavaScript bundle, changes on every deploy.
2. \`/product/42\` — a product page. Identical for all users, but price and stock change several times a day. Available in 8 languages and 4 currencies.
3. \`/api/products?category=shoes&page=2\` — a public product listing, same data as above.
4. \`/cart\` — the signed-in user's cart.
5. \`/api/me\` — the signed-in user's profile.
6. \`/search?q=running+shoes\` — search results, public, expensive to compute, tolerant of being a few minutes stale.
7. \`POST /api/checkout\` — placing an order.

Then answer three follow-ups:

- A price change on product 42 must be reflected within two minutes. What exactly happens, in order?
- Hit rate comes back at 30% and you expected 85%. Name the three things you check, in order.
- What breaks if a deployment ships \`/static/app.js\` without changing the filename?`,
      rubric: [
        'Static bundle: content-hashed filename with max-age one year plus immutable, and an explicit statement that no invalidation is needed.',
        'Product page: public with short max-age, long s-maxage, Vary on normalised language and currency, surrogate-key purge.',
        'API listing: same treatment as the product page, with the tag covering it so one purge hits both.',
        'Cart and /api/me: private, no-store, with the CDN still used for transport.',
        'Search: public with a moderate max-age and stale-while-revalidate; notes query normalisation to avoid key fragmentation.',
        'POST: never cached; states that caching a write path is a serious bug.',
        'Price-change sequence: origin write, tag purge, propagation delay, stale window bounded by browser max-age.',
        'Hit-rate triage names query-parameter inclusion, over-broad Vary, and missing freshness lifetime.',
        'Identifies that a reused filename with immutable means users hold the old bundle until it expires, with no purge that reaches browsers.',
      ],
      modelAnswer: `**1. \`/static/app.js\` — content-hashed, cached forever**

First, change the URL: build output is \`/static/app.9f2a1c.js\`, with the hash derived from the content.

\`\`\`
Cache-Control: public, max-age=31536000, immutable
\`\`\`

*Key:* the URL alone. Nothing varies — the content hash means the URL fully determines the bytes.

*Invalidation:* **none, ever.** A new build produces a new hash, therefore a new URL. The old entry is simply never requested again and ages out on its own. This is the strategy that dissolves invalidation rather than solving it, and it is why fingerprinting is worth the build-step cost.

One necessary consequence: the HTML that references the bundle must *not* be cached with a long lifetime, or users will hold an old document pointing at an old bundle. The referencing document gets a short lifetime; the referenced assets get a year.

**2. \`/product/42\` — the interesting one**

\`\`\`
Cache-Control: public, max-age=60, s-maxage=86400, stale-while-revalidate=30
Vary: Accept-Encoding
Surrogate-Key: product-42 category-shoes
\`\`\`

*Key:* URL + encoding + normalised language + normalised currency. Language and currency come from CDN key configuration on a normalised cookie or a path prefix, **not** from raw \`Vary: Accept-Language\` — raw \`Accept-Language\` headers have enormous cardinality (\`en-GB,en;q=0.9,fr;q=0.8\` and \`en-GB,en;q=0.9\` are different strings requesting the same page). The origin normalises to one of eight values.

*Entries:* 8 languages × 4 currencies × 2 encodings = **64 per product.** Multiplicative but bounded, and each entry is shared by many users, so the hit rate stays high.

*Why the split lifetimes:* \`max-age=60\` means a browser holds it for a minute, so a correction reaches users quickly and nobody is stuck with a bad page. \`s-maxage=86400\` means the edge holds it for a day and absorbs essentially all traffic — safe precisely because the edge is purgeable and the browser is not.

*Invalidation:* surrogate-key purge on \`product-42\` when price or stock changes.

**Personalisation:** if this page shows "you last viewed this" or a personalised recommendation strip, that comes from a separate \`private, no-store\` fetch. The page itself stays identical for everyone in its language and currency. This is the decision that keeps the page cacheable at all.

**3. \`/api/products?category=shoes&page=2\` — same treatment, same tags**

\`\`\`
Cache-Control: public, max-age=60, s-maxage=86400, stale-while-revalidate=30
Surrogate-Key: category-shoes product-42 product-51 product-78 ...
\`\`\`

*Key:* URL with \`category\` and \`page\` **included** (they change the response) and analytics parameters **excluded**. Plus normalised currency, since prices appear in the payload.

*Invalidation:* tag with every product id in the response. A change to product 42 purges this listing too, from the same single purge call. This is exactly what surrogate keys are for — the same entity appears in a page and in N listings, and one purge reaches all of them.

*The failure mode to name:* if the listing is not tagged with individual product ids, purging \`product-42\` fixes the product page and leaves every listing showing the old price for up to a day. Incomplete tagging is worse than no tagging, because it is invisible.

**4. \`/cart\` — private, and the CDN still earns its place**

\`\`\`
Cache-Control: private, no-store
\`\`\`

*Key:* not cached, so no key.

*Why \`no-store\` and not just \`private\`:* \`private\` permits the browser to store it, and a cart on a shared machine surviving in the browser cache is undesirable. \`no-store\` is the conservative default for anything session-bound.

*What the CDN still does:* terminates TLS near the user, forwards over a warm pooled connection, and absorbs bot traffic. On a small JSON response the connection-setup saving alone is most of the latency.

**5. \`/api/me\` — identical treatment**

\`\`\`
Cache-Control: private, no-store
\`\`\`

Same reasoning. This is the endpoint that the product page's personalised strip calls, and keeping it separate is what allowed the product page to be public.

**6. \`/search?q=running+shoes\` — cacheable, with normalisation**

\`\`\`
Cache-Control: public, max-age=300, stale-while-revalidate=600
\`\`\`

*Key:* URL with a **normalised** query — lowercased, whitespace collapsed, parameters sorted. Without normalisation, \`Running Shoes\`, \`running  shoes\` and \`shoes running\` are three entries for one result set, and search queries have a long tail that fragments badly.

*Why \`stale-while-revalidate=600\`:* search is expensive to compute and tolerant of staleness. Serving a five-minute-old result set instantly while refreshing behind the scenes is strictly better than making someone wait, and it protects the search backend from a herd at expiry.

*Invalidation:* none. Expiry is sufficient, because there is no correctness requirement that a specific search reflect a specific change immediately.

**7. \`POST /api/checkout\` — never**

\`\`\`
Cache-Control: no-store
\`\`\`

Not cacheable by method, and the CDN must be configured to pass it through. **A CDN that caches a write path is a serious bug**, not a performance issue: it means an order is placed once and a second attempt returns a cached success without the order existing, or the same order response is served to a different user.

---

**Follow-up 1: a price change must appear within two minutes. What happens, in order?**

1. The write commits at origin. The database is now correct.
2. The application issues a purge for the surrogate key \`product-42\`. This is a call to the CDN's API, and it should happen **after** the commit — purging before the commit means the edge refetches the old value and caches it again for a day.
3. The purge propagates across the CDN's PoPs. Seconds to a couple of minutes depending on provider.
4. The next request to any purged PoP misses and refetches from origin, getting the new price.
5. **Browsers that already have the page hold it for up to 60 seconds** — the \`max-age\`. Purge does not reach browsers, which is the entire reason \`max-age\` is short and \`s-maxage\` is long.

*Total worst case:* purge propagation plus 60 seconds of browser cache. Within the two-minute budget, but only just — and the thing to say out loud is that **the two-minute requirement is what set \`max-age=60\`**, not a coincidence. If the requirement were ten seconds, \`max-age\` would have to be under ten and the browser cache would stop being useful, at which point I would ask whether the price needs to be in the cached document at all or should be fetched separately.

*The ordering bug worth naming:* purge-then-commit is a real and common mistake. A request arriving between the purge and the commit refetches the old value and re-caches it for a full day, and no further purge is coming. Always commit first.

**Follow-up 2: hit rate is 30%, expected 85%. Three checks, in order.**

1. **Which query parameters are in the key.** By far the most common cause. If \`utm_source\`, \`fbclid\`, \`gclid\` and session-tracking parameters are included, every shared or advertised link is a guaranteed miss for byte-identical content. The check is a report of cached URLs by pattern — the presence of many near-identical URLs is immediately visible. Excluding them can move a hit rate by tens of points in one configuration change.

2. **What \`Vary\` is actually being sent.** A framework that emits \`Vary: Accept-Language, User-Agent, Cookie\` by default will fragment the cache into near-uselessness. \`User-Agent\` alone has effectively unbounded cardinality. The check is inspecting response headers from origin, not the CDN configuration — the origin is often sending more than anyone configured.

3. **Whether responses carry a freshness lifetime at all.** A response with no \`Cache-Control\` and no \`Expires\` may be heuristically cached for a very short time or not at all, depending on the CDN. The check is the proportion of origin responses with an explicit lifetime. This is also where I would look for \`max-age\` values set in seconds when minutes were meant.

*Order matters:* these are ranked by how often they are the answer and how cheap they are to check. All three are answerable from a hit-rate-by-key-pattern report plus origin response headers, and none requires a code change to diagnose.

**Follow-up 3: what breaks if a deploy ships \`/static/app.js\` without changing the filename?**

The URL is unchanged and the response said \`max-age=31536000, immutable\`. So:

- **Edges** still hold the old bundle for a year. A purge fixes them.
- **Browsers** hold the old bundle for a year, and **there is no purge that reaches a browser.** Every user who loaded the site before the deploy keeps the old JavaScript until their cache is evicted or they hard-refresh.
- \`immutable\` makes it worse: it instructs the browser not even to revalidate on a normal reload. A user pressing refresh does not get the new bundle.
- The specific breakage is a **version skew**: the old bundle calls the new API, and any changed contract fails in ways that are hard to reproduce because they only affect users with a warm cache.

This is why \`immutable\` and content hashing are a single decision rather than two. The directive is a promise that the URL's content never changes; reusing the filename breaks that promise, and the only remedy is waiting or a forced reload. The safeguard is mechanical: the build must fail if it emits an unhashed asset with a long lifetime.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-cdn-1',
      level: 'basic',
      question: 'What does a CDN do?',
      guidance:
        'Look for both halves: cached copies near users, and connection termination near users. An answer that mentions only the cache has missed why a CDN helps for uncacheable content.',
    },
    {
      id: 'iq-cdn-2',
      level: 'basic',
      question: 'What is the difference between `no-cache` and `no-store`?',
      guidance:
        '`no-cache` stores and revalidates; `no-store` does not store. A strong answer notes that this is a commonly reversed pair and that `no-store` plus `private` is the default for user-specific responses.',
    },
    {
      id: 'iq-cdn-3',
      level: 'intermediate',
      question: 'How would you make a personalised page edge-cacheable?',
      guidance:
        'Split it: a public shell plus private fetches for the personalised fragments. Look for the recognition that `Vary: Cookie` is safe but yields no hits, and for varying only on low-cardinality normalised values.',
    },
    {
      id: 'iq-cdn-4',
      level: 'intermediate',
      question: 'A product changes and it appears in a page plus fifty listings. How do you invalidate?',
      guidance:
        'Surrogate keys — tag every response with the entity ids it contains, then purge the tag. A strong answer names incomplete tagging as the failure mode and rejects purge-all because of the origin stampede.',
    },
    {
      id: 'iq-cdn-5',
      level: 'advanced',
      question: 'Hit rate is 30% when you expected 85%. Walk me through your investigation.',
      guidance:
        'Cache key first: query parameters included, `Vary` actually sent, freshness lifetime present. Excellent answers order the checks by prior probability and note that all three are answerable from a hit-rate-by-key-pattern report.',
    },
    {
      id: 'iq-cdn-6',
      level: 'advanced',
      question: 'When is pre-positioning content better than caching it on demand, and why?',
      guidance:
        'When the catalogue is bounded, immutable, and demand is forecastable — so nobody pays a miss and filling can happen off-peak. Excellent answers state why it does not transfer to long-tail or personalised content.',
    },
    {
      id: 'iq-cdn-7',
      level: 'followup',
      question: 'You said you would purge on write. What happens if the purge fires before the commit?',
      guidance:
        'A request arriving in the gap refetches the old value and re-caches it for the full lifetime, with no further purge coming. A strong answer states the rule — commit first, then purge — and notes that a purge failure needs a retry or the stale entry persists.',
    },
    {
      id: 'iq-cdn-8',
      level: 'followup',
      question: 'Your assets are `immutable` with a one-year lifetime. A deploy reuses a filename. What now?',
      guidance:
        'Edges can be purged; browsers cannot. `immutable` suppresses revalidation even on reload, so affected users run old code against a new API until eviction. A strong answer proposes a build-time check that refuses to emit an unhashed long-lived asset.',
    },
  ],

  activeLearning: [
    {
      id: 'al-cdn-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed the CDN caches responses your origin generated. Now change one thing: the CDN can run your code at the edge. What becomes possible, and what problems does it not solve?',
      discussion: `Edge compute changes the unit of work from "serve a stored response" to "run a function near the user". Three things genuinely become possible.

**1. Personalisation without destroying cacheability.** The expensive shared page is cached at the edge; a small edge function injects the user's name or currency into it before serving. The cache key stays public and low-cardinality, and the personalisation happens after the cache lookup rather than before it. This is the most valuable capability, because it dissolves the central tension of this lesson.

**2. Key normalisation at the edge.** Rather than relying on the origin to normalise \`Accept-Language\` into one of eight values, an edge function does it before the lookup. Sorting query parameters, stripping campaign tags, canonicalising a search query — all of it moves to where the key is actually built, which is where it belongs.

**3. Routing and access decisions without an origin round trip.** Authorisation checks, A/B assignment, geographic redirects, bot filtering. Each currently costs a round trip to origin and now costs nothing.

**What it does not solve, and this is the part worth being precise about.**

**Invalidation is unchanged.** An edge function that reads cached content still reads cached content. If the underlying entry is stale, the function personalises stale bytes. Surrogate keys and purge remain exactly as they were.

**Data locality becomes the new bottleneck.** An edge function that needs the user's cart must fetch it, and if the database is in one region then the function in Mumbai is 250 ms from its data — worse than an origin-region server would have been. Edge compute is fast only when it needs no data, or when the data is also distributed, and distributing the data reintroduces every consistency problem from the replication and CAP lessons.

**Consistency is harder, not easier.** Code running in a hundred locations against eventually-consistent replicated state is a distributed system with a hundred nodes. A read-your-writes guarantee that was trivial with one database becomes a real design problem.

**Debuggability degrades.** A bug that manifests in one PoP, for users of one language, with a warm cache, is genuinely hard to reproduce. The observability burden rises sharply and it is rarely budgeted for.

**What I would actually use it for:** key normalisation and shell personalisation — the two cases where the function needs no data beyond the request itself. Those are pure wins with no consistency cost.

**What I would be cautious about:** anything requiring a database read. The instinct that "closer to the user is faster" is only true when the data is also close, and moving the data is the expensive part of the decision that edge compute makes easy to overlook.

**The transferable point.** Edge compute moves computation to the edge; it does not move *data* there. Most of the appeal assumes both, and the gap between them is where the disappointment lives.`,
    },
    {
      id: 'al-cdn-2',
      kind: 'debug',
      prompt:
        'Users in one country report seeing prices in the wrong currency, intermittently — roughly one page load in five. Everyone else is fine. The origin returns the correct currency when queried directly. Hypotheses?',
      discussion: `Intermittent, region-specific, and correct at origin. That combination points hard at the cache key, and the "one in five" is the diagnostic detail.

**Hypothesis 1 — currency is not in the cache key.** The strongest candidate. If the origin determines currency from a cookie or a geo header but the CDN does not include that dimension in the key, then whichever user populated the entry sets the currency for everyone hitting that entry. It would be intermittent because it depends on which PoP the user reaches and who populated it there.

*Why "one in five" fits:* a user is routed to one of several PoPs, and only some of those entries were populated by a user with a different currency. The ratio is roughly the proportion of entries populated wrongly.

*Check:* request the same URL twice with different currency cookies through the CDN and compare. If both return the same currency, the key is missing the dimension. This is a two-minute check and should be first.

**Hypothesis 2 — the key includes currency, but the origin omits the matching \`Vary\`.** If the CDN is configured to vary on a currency cookie but the origin does not send \`Vary\`, some intermediary — a corporate proxy, the browser cache — may store and reuse across currencies. This produces the same symptom one layer out, and it is why the origin appears correct when queried directly.

*Check:* inspect the actual response headers reaching a client, not the origin's intent. Look for a \`Vary\` that omits the dimension the CDN is keying on.

**Hypothesis 3 — the currency dimension is derived from something with high cardinality that sometimes collapses.** For instance keying on a geo header that is occasionally absent or wrong for VPN and mobile-carrier traffic. When the header is missing the origin falls back to a default currency and that response is cached under the key that other users also produce.

*Check:* the proportion of origin requests where the geo or currency signal is absent. If it is around 20%, this is the answer, and the fix is to make a missing signal produce an uncacheable response rather than a cached default.

**Hypothesis 4 — normalisation is inconsistent between origin and edge.** The origin normalises \`GBP\` and \`gbp\` to the same value; the edge treats them as distinct keys, or vice versa. Case-mismatched entries then serve inconsistently depending on which was populated.

*Check:* the distinct key values the CDN reports for that dimension. More than the expected four means normalisation is leaking.

**What I would check first: two requests through the CDN with different currency cookies.** It separates hypothesis 1 from all the others in one step, and hypothesis 1 is both the most likely and the most serious — because the same defect applied to any other user-specific field is a data leak rather than a wrong currency.

**And that is the point worth generalising.** A wrong currency is a visible, reported, low-harm symptom of exactly the mechanism that, applied to a name or a balance, is a silent breach. Finding this bug is a reason to audit *every* response for the question "does this depend on who is asking, and is that dimension in the key?" — not just to fix the currency.

**The structural fix.** A response whose content depends on a request dimension should be mechanically prevented from being cached without that dimension in the key. In practice: a middleware that inspects what the response actually depended on and refuses to send \`public\` unless every such dimension is declared. That converts a class of silent correctness bugs into a loud failure at development time.`,
    },
  ],

  revision: {
    bullets: [
      'A CDN caches key-to-response mappings, not pages. The key is yours to design.',
      'The default key is host + path + query. No cookie, no header, no identity.',
      'A personalised response under a public key is a cross-account leak, not a stale page — and it is silent at origin.',
      'Entries = distinct values of every key dimension, multiplied. Each dimension divides the hit rate.',
      '`Vary: Cookie` is safe and useless: session cookies are per-user, so the hit rate is zero.',
      'Vary only on low-cardinality *normalised* values — raw `Accept-Language` has huge cardinality, so normalise it first.',
      '`no-cache` means store-and-revalidate. `no-store` is the one that prevents storage.',
      '`s-maxage` separates a short unpurgeable browser cache from a long purgeable edge cache.',
      '`stale-while-revalidate` removes the latency cost of expiry — refresh-ahead as a header.',
      'A strong `ETag` makes revalidation a 304 with no body, so short freshness is cheap.',
      'Content-hash static assets with `immutable` and a one-year lifetime: invalidation dissolves.',
      'Reusing a fingerprinted filename is unfixable for browsers — purge does not reach them.',
      'Surrogate keys let one purge invalidate every URL containing an entity. Incomplete tagging is invisible.',
      'Purge-all is an incident tool: it sends full traffic to origin at once. And commit before purging — purge-then-commit re-caches the old value for the full lifetime.',
      'Three benefits survive a 0% hit rate: connection termination, a warm origin path, attack absorption.',
      'Low hit rate? Check query parameters in the key, the `Vary` actually sent, then whether freshness exists at all.',
      'Pre-position instead of caching when the catalogue is bounded, immutable and demand is forecastable.',
      'A CDN multiplies a fast origin; it does not replace one, because misses are guaranteed.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A geographically distributed set of caches that store responses keyed by a string derived from the request, and that terminate client connections close to the user.',
    whyItExists:
      'To remove distance from the request path — both the bytes travelled and, more importantly for small requests, the round trips of connection setup — while offloading traffic from the origin.',
    whenToUse: [
      'Static assets, always, with content-hashed URLs and a one-year immutable lifetime.',
      'Shared dynamic content, with a long `s-maxage` and surrogate-key purge on change.',
      'In front of uncacheable APIs, for connection termination and attack absorption.',
    ],
    whenNotToUse: [
      'As the cache for per-user content, unless split into a public shell plus private fetches.',
      'On write paths — `POST`, `PUT`, `DELETE` must never be cached.',
      'When a user must observe their own write immediately, without routing those reads to origin.',
      'As a substitute for a fast origin: misses are guaranteed and each one pays full origin latency.',
    ],
    alternatives: [
      'An origin-side shared cache such as Redis, when the win is compute rather than distance.',
      'Browser caching alone, when traffic is low and content is per-user.',
      'Pre-positioning, when the catalogue is bounded and demand is forecastable.',
      'Edge compute, for key normalisation and shell personalisation — but not for data-dependent work.',
    ],
    tradeoffs: [
      'Every key dimension buys correctness or relevance and costs hit rate, multiplicatively.',
      'A long `s-maxage` buys offload and costs a stale window bounded by purge propagation.',
      'A short `max-age` buys the ability to push a correction and costs browser-cache effectiveness.',
      '`immutable` buys zero revalidation and costs any ability to fix a reused URL.',
      'Pre-positioning buys zero misses and costs storage plus forecasting for content nobody may request.',
    ],
    failureModes: [
      'Personalised content under a public key: cross-account data leak, invisible at origin.',
      '`Vary: Cookie`: a cache with a zero hit rate that you pay to operate.',
      'Analytics query parameters in the key: every share link is a guaranteed miss.',
      'An over-broad framework-emitted `Vary` fragmenting the cache.',
      'Purge before commit: the old value is refetched and re-cached for the full lifetime.',
      'Incomplete surrogate-key tagging: some URLs serve stale content until natural expiry.',
      'Purge-all as a deployment step: a global cold cache and an origin stampede.',
      'A reused fingerprinted filename with `immutable`: version skew that no purge can fix.',
      'A slow origin behind a CDN: every guaranteed miss pays full origin latency.',
    ],
    followUpQuestions: [
      'What exactly is in your cache key, and what did you deliberately exclude?',
      'Does this response depend on who is asking? Then why is it `public`?',
      'How does a change to one entity invalidate every URL that contains it?',
      'What is your stale window, and does it include browser `max-age`?',
      'Do you purge before or after the commit?',
      'What is your hit rate broken down by key pattern?',
      'What happens on a miss, and can your origin serve full traffic if the cache is cold?',
    ],
  },
});
