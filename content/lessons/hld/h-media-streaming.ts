import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-media-streaming',
  title: 'Design a media streaming platform (Netflix/Spotify)',
  summary:
    'A bounded catalogue with forecastable demand inverts every decision from the user-generated case: content is pre-positioned rather than cached, encoded once rather than lazily, and the hard paths are licence delivery and recommendation serving.',
  phase: 'hld',
  module: 'advanced-designs',
  position: 49,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 90,
  tags: ['pre-positioning', 'drm', 'catalogue', 'recommendation-serving', 'cdn'],
  prerequisites: ['h-youtube'],
  resources: [
    {
      key: 'netflix-open-connect',
      tier: 'must',
      note: 'The central reference. Read it for the appliance model and for the fill window — pre-positioning is only possible because demand is forecastable, and that is the property this whole design turns on.',
    },
    {
      key: 'rfc-8216-hls',
      tier: 'must',
      note: 'Read the sections on encryption keys and on the manifest. Licence-protected playback is a manifest that points at both segments and a key server, and understanding that separation is most of the DRM design.',
    },
    {
      key: 'aws-cloudfront-caching',
      tier: 'must',
      note: 'Read it for the distinction between a cache you fill on demand and one you populate deliberately. This design does both, for different content, and the difference is the interesting part.',
    },
    {
      key: 'hnsw-paper',
      tier: 'good',
      note: 'Approximate nearest-neighbour search over embeddings. Read it as the mechanism for recommendation candidate generation — the retrieval half of serving, which must be milliseconds rather than a batch job.',
    },
    {
      key: 'facebook-memcache',
      tier: 'good',
      note: 'Read the lease and thundering-herd sections. The catalogue read path is almost entirely cache and its failure modes are cache failure modes.',
    },
    {
      key: 'aws-caching-challenges',
      tier: 'advanced',
      note: 'Read it for what happens when a cache is cold. A simultaneous global release makes every edge cold at the same moment, which is the one event pre-positioning exists to prevent.',
    },
  ],

  intuition: {
    body: `This looks like the previous lesson and almost every decision inverts, because one property of the catalogue is different: **it is bounded, immutable, and its demand is forecastable.**

Netflix has thousands of titles, known months in advance, with viewership predictable to a useful accuracy. YouTube ingests 500 hours a minute of content whose demand is unknowable. **That single difference flips three decisions.**

**Transcoding becomes eager and elaborate rather than lazy.** With a bounded catalogue you can afford to encode every title into a full ladder — and better than that, you can spend real compute *per title*, analysing the content to choose bitrates suited to its complexity. **A talking-head scene needs a fraction of the bitrate of fast action at the same perceived quality**, and per-title encoding exploits that. Lazy transcoding, which was the largest saving in the user-generated case, is unnecessary here and would be strictly worse.

**Delivery becomes pre-positioning rather than reactive caching.** Because you know what will be popular tomorrow in a given region, you can push it into ISP networks overnight and **nobody ever pays a cache miss.** Reactive caching means the first viewer in each region waits for an origin fetch; pre-positioning means the bytes are already one hop away.

**And the fill happens off-peak**, when the ISP's network is idle, so the transfer costs nothing at the moment it matters.

Then two problems that barely existed in the previous lesson.

**Licence delivery is a separate low-latency path with a hard availability requirement.** Content is encrypted, so playback needs a decryption key from a licence server — and that request is **on the critical path to first frame**, every play, for every viewer. It cannot be cached at the edge, because the whole point is that it is per-device and per-entitlement. **So a small, uncacheable, entitlement-checking service must be as available as the CDN**, and it is the least redundant thing in the design.

**Recommendation serving is a retrieval-plus-ranking system, not a model.** The interesting problem is not training but answering "what should this member see, now, in under 100 ms" over a catalogue of thousands with a personalised ordering. **Which is candidate retrieval over embeddings followed by scoring** — the same two-stage shape as the feed lesson, at a much smaller candidate scale and a much tighter latency budget.

The framing to carry: **a bounded forecastable catalogue lets you pre-position and pre-encode, and the hard paths become the ones that cannot be pre-computed — licences and personalisation.**`,
    analogyLimit:
      '"It is YouTube with fewer videos" is exactly the wrong intuition. Fewer videos is not a smaller version of the same problem — it is a *different* problem, because bounded and forecastable demand makes pre-positioning and per-title encoding possible, and those are unavailable at any scale of user-generated content. The analogy also hides DRM entirely, which adds an uncacheable per-play request to the critical path that a public video platform does not have.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team designs a streaming platform reusing the YouTube architecture: lazy transcoding, reactive CDN caching, and no licence server because content is served as plain segments. The catalogue is 10,000 titles and a new season releases globally at midnight UTC. Identify four failures and rank them.',
      answer: `**Failure 1 — the simultaneous global release makes every edge cold at once, and this is the largest failure.**

Reactive caching means an edge fetches an object on first request. At midnight UTC, **every edge in the world simultaneously has zero copies of the new season**, and millions of viewers request it in the same minute.

\`\`\`
10 episodes × 6 renditions × 400 segments = 24,000 objects per season
× ~200 edge locations = 4.8 million distinct fetches from origin
All within minutes of each other
\`\`\`

**The origin receives the full uncached load of a global launch.** That is the cold-cache stampede from the caching lesson, at planetary scale and at a precisely predictable moment.

**The fix is pre-positioning**, and it is available here specifically because the release time and the content are known in advance. Push the season to every edge in the days before launch, filling overnight when networks are idle. **At midnight every edge already has it and the origin sees nothing.**

**And this is the decision that a bounded catalogue makes possible.** A user-generated platform cannot pre-position because it does not know what will be requested; a scheduled release is the ideal case.

**Failure 2 — lazy transcoding is exactly wrong for this catalogue.**

Lazy transcoding was the largest saving in the user-generated case because most uploads are barely watched. **Here every title in the catalogue is watched**, so the lazy path triggers for everything — meaning you pay the full transcoding cost *and* the complexity of the lazy machinery, *and* the first viewers of each rendition wait.

**Worse: it forecloses per-title encoding.** With a bounded catalogue you can afford to analyse each title and choose a bitrate ladder suited to its content — which reduces both storage and, far more importantly, **egress**, the largest operating cost. Lazy transcoding under time pressure cannot do that analysis.

\`\`\`
Fixed ladder:      1080p at 6 Mbit/s for everything
Per-title encoding: 2 Mbit/s for a dialogue-heavy drama,
                    8 Mbit/s for an action sequence
→ substantial egress reduction at equal perceived quality
\`\`\`

**So encode eagerly, once, with real compute per title.** The bounded catalogue makes it affordable and the egress saving makes it worthwhile.

**Failure 3 — no licence server means the content is not protected, which is a licensing violation rather than a technical fault.**

Studios license content on the condition that it is protected. Serving plain segments from a CDN means anyone with the URL can download the film. **This is not an engineering trade-off — it is a contractual requirement**, and without it the catalogue cannot be licensed at all.

**The fix introduces a new critical-path dependency.** Segments are encrypted; the manifest points at both the segments and a **licence server**; the player requests a key, presenting a device identity and a session token; the licence server checks entitlement — is this member subscribed, in a permitted region, within their concurrent-stream limit — and returns a key bound to that device.

**Three consequences worth naming:**

**It is uncacheable by design.** Per device and per entitlement, so the CDN lesson's rule applies: a response depending on who is asking cannot be shared. **The licence path has none of the CDN's leverage.**

**It is on the critical path to first frame.** Every play waits for it, so its latency is user-visible startup latency.

**It must be as available as the CDN.** If the licence server is down, nothing plays — even though every byte of content is sitting on an edge one hop away. **It becomes the least redundant component in the system**, which is an uncomfortable position for the thing gating all playback.

**Failure 4 — the recommendation path has no design at all, and the home screen is the product.**

For a bounded catalogue the home screen is not a feed of recent uploads — it is a personalised ordering of thousands of titles into rows. **That is a retrieval-and-ranking problem with a sub-100-ms budget**, and treating it as a database query produces either a generic home screen or a slow one.

**In order of severity: the cold-start stampede (1) is an outage at a known moment**; the missing licence server (3) makes the catalogue unlicensable, which is worse in kind but is a legal rather than an availability failure; lazy transcoding (2) costs money and quality; and the recommendation gap (4) degrades the product rather than breaking it.

**The unifying observation:** three of the four failures come from applying a design built for *unpredictable, unbounded* content to a catalogue that is *known and finite*. **The properties of the catalogue are the design inputs**, and they were carried over unexamined.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
A member can browse a personalised home screen of rows of titles
A member can search the catalogue
A member can play a title, resuming where they left off
Playback adapts quality to bandwidth
A member can download a title for offline viewing
A member can play on up to N devices concurrently
Content is protected and playable only by entitled members
An operator can schedule a global release at a specific time
\`\`\`

**The clarifying questions that change this design:**

**Is the catalogue bounded and known in advance?** *Yes — around 10,000 titles, with additions scheduled.* **This is the question that determines everything**, because it licenses pre-positioning and per-title encoding.

**Are releases simultaneous and global?** *Yes.* A precisely-timed demand spike — the biggest risk, and the easiest to prepare for because it is predictable.

**Is content DRM-protected?** *Yes, contractually.* Adds an uncacheable per-play request to the critical path.

**What is the concurrent-stream limit?** *Up to 4 per account.* Makes licence issuance stateful — it must count active sessions, which is coordination rather than a lookup.

**Is offline download supported?** *Yes.* Requires persistent licences with their own expiry, a materially harder DRM case.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Time to first frame | p99 under 1.5 s | Licence + manifest + first segment all from nearby |
| Licence latency | p99 under 200 ms | Regional licence servers; it is on the critical path |
| Rebuffer rate | Under 0.5% of playback | Pre-positioned segments, adaptive bitrate |
| Home screen latency | p99 under 100 ms | Precomputed rows, retrieval + ranking, not a query |
| Playback availability | 99.99% | Licence server must match CDN availability |
| Cache hit rate at launch | Effectively 100% | Pre-positioning, not reactive caching |

**Out of scope:** the recommendation *model* (assume trained embeddings and a scorer exist), studio ingest, billing, and the encoding farm's internals.

## Step 2 — Estimation

\`\`\`
Members:       250 million, 100 million daily active
Streams:       100 million/day → 1,150/s average, 4,000/s peak
Watch length:  average 45 minutes at 4 Mbit/s
               → ~1.35 GB per stream
\`\`\`

**Egress, which is the dominant operating cost:**

\`\`\`
100e6 × 1.35 GB = 135 PB/day
÷ 100,000 s = 1.35 TB/s average
Peak (evening, per region, overlapping): ~4 TB/s
\`\`\`

**4 TB/s is 32 Tb/s**, which is why delivery is owned infrastructure at this scale. **And it is the number per-title encoding attacks**: a 20% bitrate reduction at equal quality saves 27 PB/day.

**Catalogue storage — and the surprise is how small it is:**

\`\`\`
10,000 titles × average 2 hours
Per title: 6 renditions, total ~1.5× the highest bitrate
  ≈ 2 h × 8 Mbit/s × 1.5 = ~10 GB per title
10,000 × 10 GB = 100 TB
\`\`\`

**100 TB is the entire catalogue.** That is a single rack. **Compare 1 EB/year for the user-generated case** — four orders of magnitude smaller, and it is the fact that makes pre-positioning viable: you can fit a meaningful fraction of the catalogue on an appliance inside an ISP.

\`\`\`
Appliance capacity: ~200 TB per box
→ the ENTIRE catalogue fits on one appliance
→ so an appliance holds everything, or the popular 90% comfortably
\`\`\`

**That is the decisive arithmetic here.** At 100 TB, "push everything everywhere" is affordable; at an exabyte it is not, and reactive caching is forced.

\`\`\`
Transcoding (eager, per-title):
  10,000 titles × 2 h = 20,000 source-hours
  × 36 CPU-hours (6 renditions) × 3 for per-title analysis passes
  = ~2.2 million CPU-hours total
  Spread over a year: ~250 cores continuously
  A new-title burst: 100 titles/month → ~900 cores for a week
\`\`\`

**250 cores against the user-generated case's million.** Transcoding is a rounding error here, which is why eager and elaborate encoding is affordable.

\`\`\`
Licence requests: 4,000 plays/s peak, one licence each
                  Plus renewals for long sessions: ~6,000/s peak
Home screen loads: 100 M members × 5 sessions/day = 500 M/day
                   → 6,000/s average, 20,000/s peak
\`\`\`

**Licence and home-screen request rates are modest**, which is the point: **the hard paths are hard because of latency and availability, not volume.**

## Step 3 — API design

\`\`\`
Discovery
  GET  /home                        → { rows: [{ title, titleIds[] }] }
  GET  /titles/{id}                 → metadata, artwork refs
  GET  /search?q=                   → results

Playback
  POST /playback/start  { titleId, deviceId }
       → { manifestUrl, licenceUrl, sessionId, resumePositionSec }
  GET  {manifestUrl}                → the ABR manifest (CDN)
  POST {licenceUrl}  { deviceId, sessionId, keyIds[] }
       → { licence }                (NOT cacheable)
  GET  /segments/{...}              → segments (CDN, pre-positioned)
  POST /playback/heartbeat  { sessionId, positionSec }
  POST /playback/stop  { sessionId }

Offline
  POST /downloads  { titleId, deviceId }
       → { manifestUrl, persistentLicence, expiresAt }
\`\`\`

**Five decisions worth defending.**

**\`/playback/start\` is a single call returning everything the player needs to begin.** Manifest URL, licence URL, session id and resume position. **Three round trips collapsed into one**, which matters because this is on the critical path to first frame and every avoided round trip is 50–100 ms.

**The licence URL is returned rather than fixed**, so it can point at the member's nearest regional server. **Latency here is user-visible startup latency.**

**A session id, not just a device id.** Concurrency limits count *active sessions*, and heartbeats keep one alive. **Without a session concept, a member who closes their laptop lid holds a slot forever.**

**Heartbeats carry the resume position**, so resume is a side effect of a call already being made. Stop is best-effort — **the heartbeat timeout is what actually frees the session.**

**Offline downloads get a persistent licence with an explicit expiry** — a different DRM object, since it must survive without network access and still expire.

## Step 4 — Data model

\`\`\`sql
-- Catalogue: small, read-heavy, almost entirely cached
titles(
  title_id, name, synopsis, duration_sec, release_at,
  maturity_rating, artwork_refs, available_regions[]
)
title_renditions(title_id, rendition_id, bitrate, codec, manifest_ref)

-- Entitlement and sessions: small, strongly consistent
members(member_id, plan, region, concurrent_limit)
playback_sessions(
  session_id, member_id, device_id, title_id,
  started_at, last_heartbeat_at, position_sec
)                                   -- TTL on last_heartbeat

-- Viewing history: large, append-only, feeds recommendations
view_events(member_id, title_id, position_sec, event_at)
  PARTITION BY member_id

-- Precomputed home rows, refreshed periodically
home:{member_id}  → ordered rows of title ids (cache)

-- Content placement: which appliance holds what
placement(appliance_id, title_id, rendition_id, filled_at)
\`\`\`

**Four decisions worth defending.**

**The catalogue is small enough to be fully cached everywhere.** A few hundred megabytes of metadata, so **every instance holds it all in memory** and refreshes periodically — removing the catalogue database from the read path, a luxury the user-generated case lacks.

**\`playback_sessions\` has a heartbeat TTL, not a clean lifecycle.** A session expires if heartbeats stop, because clients vanish. **This is the ephemeral-state-with-TTL pattern from the messaging lesson**, and it is what makes the concurrent-stream limit workable.

**\`available_regions\` is on the title**, because licensing is regional and a title available in one country may not be in another. **This means the home screen and search are region-filtered**, and a member travelling sees a different catalogue — a product behaviour driven entirely by contracts.

**\`placement\` is a first-class table.** Knowing which appliance holds which rendition is what allows a player to be steered to a nearby copy, and it is the state the fill pipeline maintains.

## Step 5 — Architecture

\`\`\`
                    ┌──── CONTROL PLANE ────┐
Member client ──────▶ Discovery service      │  (catalogue in memory)
     │              │ Playback service       │  (sessions, entitlement)
     │              │ Licence service ───────┼──▶ key store (regional)
     │              │ Recommendation serving │
     │              └───────────┬────────────┘
     │                          │
     │  manifest + segments      │ placement + steering
     ▼                          ▼
┌──────── DELIVERY ────────────────────────────────┐
│  Appliances inside ISP networks (~200 TB each)    │
│  · hold the full or popular catalogue             │
│  · filled overnight from regional fill sources    │
│  Commercial CDN as the fallback tier              │
└───────────────────────────────────────────────────┘
     ▲
     │ fill (off-peak)
┌──────── ENCODING + FILL ────────┐
│  Per-title encoder (eager)       │
│  Fill planner: forecast demand   │
│    per region → placement plan   │
└──────────────────────────────────┘
\`\`\`

**Why the licence service is separate and regional.** Uncacheable, on the critical path, and must be highly available. **Sharing a service with discovery would couple playback availability to browse availability**, and browse is far less critical.

**Why appliances rather than a commercial CDN as the primary tier.** At 4 TB/s peak, CDN egress is both a capacity and a cost problem. **An appliance inside an ISP serves that ISP's members one hop away, and its bandwidth is essentially free** — the ISP benefits too, since the traffic never crosses their transit links.

**Why a CDN remains as fallback.** Not every ISP hosts an appliance, and appliances fail. **The fallback is what makes the model safe to deploy incrementally.**

**Why the fill planner is its own component.** It forecasts regional demand, plans placement, and schedules off-peak transfers — **the component that turns "we know what will be popular" into bytes in the right place**, with no analogue in the user-generated design.

## Step 6 — The deep dive: pre-positioning, licences, and recommendation serving

**Pre-positioning, concretely.**

\`\`\`
Daily, per region:
  1. Forecast tomorrow's demand per title from history, release
     schedule, and regional signals.
  2. Rank titles by expected regional demand × size.
  3. Compute a placement plan per appliance, respecting capacity.
  4. Diff against current placement → transfer list.
  5. Execute transfers in the local off-peak window (typically
     the small hours), rate-limited.
\`\`\`

**Three properties that make this work.**

**The catalogue is 100 TB and an appliance holds 200 TB**, so the plan is usually "hold everything" and the diff is only new titles. **Forecasting becomes load-bearing only when the catalogue exceeds appliance capacity.**

**A scheduled release is the ideal case.** Content and moment are both known, so the fill completes days before and **every edge is warm at midnight** — the direct answer to the prediction's largest failure.

**Off-peak filling is free.** The transfer happens when the ISP network is idle. **The cache is not just closer — it is filled when bandwidth has no opportunity cost.**

*And what it costs:* storage for content that may not be watched, a forecasting pipeline, and a placement plan that is wrong sometimes. **A miss falls through to the CDN fallback**, so a bad forecast degrades cost rather than availability.

**Licence delivery, and why it is the design's most uncomfortable component.**

\`\`\`
Player: POST /licence { deviceId, sessionId, keyIds }
Licence service:
  1. Validate the session token (signed, short-lived).
  2. Check entitlement: subscription active, title available
     in the member's region, maturity rating permitted.
  3. Check concurrency: count active sessions for this member.
  4. Issue a key bound to the device's DRM identity.
\`\`\`

**Step 3 is the hard one, and it is a coordination problem.** Counting active sessions means reading shared state on the critical path to first frame.

*Three ways to do it, in ascending accuracy:*

**A regional session count.** Fast, and a member streaming in two regions could exceed the limit. **Acceptable, because the limit discourages account sharing rather than being exact.**

**A globally-consistent count.** Correct, and it adds a cross-region round trip — 100 ms or more on the path to first frame. **Not worth it for a deterrent.**

**Local enforcement with asynchronous reconciliation.** Each region enforces a share and reports usage — **the rate-limiting lesson's mechanism**, and the honest answer.

**I would enforce regionally and accept the overshoot**, because the failure mode of over-enforcement is a paying member being told they cannot watch — which is far worse than a shared account occasionally getting a fifth stream.

**And the availability problem.** The licence service gates all playback, is uncacheable, and cannot be pre-positioned. **So it must be the most redundant service in the system**: regional deployments, multiple availability zones each, and a degraded mode.

*What degraded mode means concretely:* if the entitlement store is unavailable, **issue a licence based on the signed session token alone** — skipping the concurrency check and the fresh entitlement check, trusting a token issued minutes ago. **Fail open, because a subscriber unable to watch is worse than a shared account getting an extra stream**, and the token bounds the exposure.

**Recommendation serving, which is a retrieval problem before it is a ranking one.**

The home screen is rows: "Because you watched X", "Trending in your region", "Continue watching". **Each row is a retrieval query with a different candidate source**, then a ranking pass.

\`\`\`
Per row:
  Retrieval:  candidate title ids from one source
              — nearest neighbours to a watched title's embedding
              — regional popularity
              — the member's in-progress list
  Ranking:    score candidates for this member, order them
  Assembly:   order the rows themselves for this member
\`\`\`

**The latency budget is 100 ms for the whole home screen**, which rules out scoring thousands of titles per row per request. Three things make it fit:

**Precompute the rows, refresh periodically** — every few hours or on a significant viewing event, not per load. **So a load is a cache read**, and 20,000 loads/second is trivially served.

**Retrieval via approximate nearest neighbour over embeddings.** "Similar to what you watched" is a vector query returning 100 candidates in single-digit milliseconds, not a scan.

**Ranking on the small candidate set.** 100 candidates × 10 rows = 1,000 scorings per refresh, not per load — **a modest batch load rather than a serving problem.**

*And the freshness trade:* the screen does not reflect the last five minutes. **The fix is a targeted refresh** — a completed episode recomputes the "Continue watching" row and nothing else. **Row-level invalidation.**

## Step 7 — What breaks at 10×

**2.5 billion members, 40 TB/s peak egress, a 1 PB catalogue.**

**The catalogue exceeds appliance capacity**, so "hold everything" stops working and forecasting becomes genuinely load-bearing. *Fix:* tiered placement — the popular 10% on every appliance, the long tail on regional fill sources one hop further, and the true tail on the commercial CDN. **Three tiers rather than two**, with the miss rate per tier as the metric.

**Licence volume reaches 60,000/s.** Modest in absolute terms, and expensive because of the availability requirement: every region, with generous headroom. *Fix:* longer validity so sessions renew less often, and bundled licences for a likely binge.

**Home-screen precomputation becomes the batch bottleneck.** *Fix:* refresh lazily — recompute on the next load if the last refresh is stale. **Most members do not load every day**, so scheduled refresh does most of its work for nobody.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| An appliance fails | Its ISP's members lose the near copy | Steering directs them to the CDN fallback — slower and working |
| Fill window missed for a release | Edges cold at launch | CDN fallback absorbs it, expensively. **This is the scenario the fill planner exists to prevent** |
| Licence service down in one region | **No playback in that region** | Fail over to an adjacent region; higher latency, playback continues |
| Entitlement store down | Cannot verify subscription | **Fail open on the signed session token** — skip concurrency and fresh checks |
| Recommendation serving down | No personalised rows | **Serve a regional-popularity home screen** — a designed fallback, not an error |
| Catalogue database down | Cannot refresh metadata | Every instance holds the catalogue in memory; serves stale until refreshed |
| Session store down | Cannot enforce concurrency | Fail open; the limit is deterrence, not correctness |

**Three rows carry the content.**

**A licence-service regional outage stops playback entirely**, even with every byte one hop away. **That asymmetry is the design's most uncomfortable property**, and why the licence path gets the most redundancy.

**Failing open on entitlement inverts the usual instinct, and is right here.** A subscriber told they cannot watch is a cancellation; a fifth stream is a rounding error. **The signed token bounds the exposure to minutes.**

**The catalogue being in memory everywhere makes a database outage invisible** — a benefit of it being small enough to fit.

## Step 9 — Defending it

**"The design inverts almost every decision from a user-generated video platform, and one property is why: the catalogue is bounded, immutable and forecastable.**

**That makes pre-positioning possible.** A 100 TB catalogue against 200 TB appliances means the common case is 'hold everything', so a scheduled global release finds every edge already warm — which is the direct answer to the cold-start stampede that would otherwise be an outage at a precisely known moment. And filling off-peak means the transfer costs nothing at peak.

**It also makes eager per-title encoding correct.** Lazy transcoding was the largest saving when most content is barely watched; here everything is watched, so lazy would pay the full cost plus the complexity. And a bounded catalogue affords real analysis per title, which reduces egress — the largest operating cost.

**The hard paths are the ones that cannot be pre-computed: licences and personalisation.** The licence request is per device, per entitlement, uncacheable and on the critical path to first frame, so it is the least redundant thing gating all playback — which is why it gets regional deployment and a fail-open degraded mode. And the home screen is retrieval plus ranking, precomputed and row-level invalidated, because a 100 ms budget cannot score a catalogue per load.

**What I gave up:** storage for pre-positioned content that may not be watched; a forecasting pipeline that is sometimes wrong; concurrent-stream limits that are regionally approximate; and a home screen that does not reflect the last five minutes except for the rows I invalidate deliberately.

**What would make me revisit it:** if the catalogue grew past appliance capacity, forecasting stops being a convenience and becomes the constraint, and placement becomes a three-tier problem. And if releases became continuous rather than scheduled, the single biggest advantage of a known catalogue — knowing exactly when demand arrives — would disappear."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'two-paths',
      title: 'Pre-positioned bytes, and the two paths that cannot be',
      caption:
        'Step through it. Everything that can be pre-computed is; the licence and the personalised ordering cannot be, and that is exactly where the difficulty concentrates.',
      nodes: [
        { id: 'encode', label: 'Per-title encoder (eager)', kind: 'service', x: 0, y: 60, detail: '10,000 titles is ~250 cores continuously — a rounding error against a user-generated platform\'s million. That affordability is what makes per-title bitrate analysis worthwhile, and it attacks egress, the largest cost.' },
        { id: 'plan', label: 'Fill planner', kind: 'service', x: 0, y: 180, detail: 'Forecasts regional demand, computes a placement plan per appliance, and schedules transfers in the local off-peak window. The component with no analogue in the user-generated design.' },
        { id: 'appliance', label: 'ISP appliances (~200 TB)', kind: 'store', x: 220, y: 120, detail: 'The catalogue is ~100 TB, so the common case is "hold everything". A scheduled release is filled days ahead, so every edge is warm at midnight and the origin sees nothing.' },
        { id: 'cdn', label: 'Commercial CDN fallback', kind: 'store', x: 220, y: 250, detail: 'Covers ISPs without an appliance, appliance failures, and forecast misses. Its existence is what makes the appliance model safe to deploy incrementally.' },
        { id: 'client', label: 'Member client', kind: 'client', x: 450, y: 180, detail: 'One /playback/start call returns manifest URL, licence URL, session id and resume position — three round trips collapsed into one, on the path to first frame.' },
        { id: 'licence', label: 'Licence service (regional)', kind: 'service', x: 660, y: 90, detail: 'Per device, per entitlement, therefore uncacheable — the CDN lesson\'s rule. On the critical path to first frame, gating all playback, and so the least redundant thing in the system.' },
        { id: 'sess', label: 'Session + entitlement store', kind: 'store', x: 660, y: 210, detail: 'Concurrency counting on the critical path. Enforced regionally and approximately, because over-enforcement means telling a paying subscriber they cannot watch.' },
        { id: 'rec', label: 'Recommendation serving', kind: 'service', x: 660, y: 330, detail: 'Rows precomputed and refreshed periodically, with retrieval by approximate nearest neighbour and ranking over ~100 candidates. A 100 ms budget cannot score a catalogue per load.' },
        { id: 'degrade', label: 'Fail open on the session token', kind: 'note', x: 880, y: 150, detail: 'If entitlement is unavailable, issue a licence on the signed short-lived token alone. A subscriber unable to watch is a cancellation; a shared account getting an extra stream is a rounding error.' },
      ],
      edges: [
        { id: 'm1', source: 'encode', target: 'plan', kind: 'control' },
        { id: 'm2', source: 'plan', target: 'appliance', kind: 'write' },
        { id: 'm3', source: 'plan', target: 'cdn', kind: 'write' },
        { id: 'm4', source: 'appliance', target: 'client', kind: 'read' },
        { id: 'm5', source: 'cdn', target: 'client', kind: 'read' },
        { id: 'm6', source: 'client', target: 'licence', kind: 'sync' },
        { id: 'm7', source: 'licence', target: 'sess', kind: 'read' },
        { id: 'm8', source: 'client', target: 'rec', kind: 'sync' },
        { id: 'm9', source: 'licence', target: 'degrade', kind: 'control' },
      ],
      steps: [
        {
          id: 'ms1',
          title: 'Encode eagerly, because the catalogue is bounded',
          description:
            '10,000 titles at ~250 cores continuously. Lazy transcoding was the largest saving when most content is barely watched; here everything is watched, so lazy pays the full cost plus the complexity.',
          nodes: ['encode'],
          edges: [],
        },
        {
          id: 'ms2',
          title: 'Then push the bytes before anyone asks',
          description:
            'A 100 TB catalogue against 200 TB appliances means "hold everything" in the common case. A scheduled release fills days ahead, so nobody ever pays a cache miss and the fill happens when bandwidth is free.',
          nodes: ['plan', 'appliance', 'cdn'],
          edges: ['m1', 'm2', 'm3'],
        },
        {
          id: 'ms3',
          title: 'Segments come from one hop away',
          description:
            '4 TB/s peak egress from inside ISP networks, where the bandwidth is essentially free and the traffic never crosses expensive transit. The CDN covers gaps and failures.',
          nodes: ['client'],
          edges: ['m4', 'm5'],
        },
        {
          id: 'ms4',
          title: 'The licence cannot be pre-positioned or cached',
          description:
            'Per device and per entitlement, on the critical path to first frame, gating every play. It becomes the least redundant component in a system where the content itself is everywhere.',
          nodes: ['licence', 'sess'],
          edges: ['m6', 'm7'],
        },
        {
          id: 'ms5',
          title: 'Neither can personalisation — so precompute it instead',
          description:
            'Rows refreshed periodically with row-level invalidation, retrieval by nearest neighbour, ranking over a hundred candidates. And fail open on entitlement, because refusing a subscriber is worse than an extra stream.',
          nodes: ['rec', 'degrade'],
          edges: ['m8', 'm9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'inversion',
      title: 'One catalogue property, three inverted decisions',
      caption:
        'Read the two columns together. Nothing here is about scale — the user-generated platform is larger. Every difference follows from whether demand is knowable in advance.',
      code: `flowchart LR
    Q["**Is the catalogue bounded,<br/>immutable and forecastable?**"]

    Q -->|"NO — 500 h/min uploaded,<br/>demand unknowable"| U["**User-generated**"]
    U --> U1["Lazy transcoding:<br/>most uploads barely watched,<br/>so eager wastes a million cores"]
    U --> U2["Reactive CDN caching:<br/>cannot pre-position what<br/>you cannot predict"]
    U --> U3["Catalogue ~1 EB/year:<br/>too large to place anywhere<br/>in full"]

    Q -->|"YES — 10,000 titles,<br/>scheduled releases"| N["**Curated catalogue**"]
    N --> N1["**Eager per-title encoding:**<br/>everything is watched, and<br/>analysis reduces egress —<br/>the largest cost"]
    N --> N2["**Pre-positioning:**<br/>fill overnight, so nobody<br/>ever pays a cache miss"]
    N --> N3["**Catalogue ~100 TB** —<br/>fits on ONE appliance,<br/>so 'hold everything' works"]

    N1 --> H["**And the hard paths become<br/>the ones that cannot be<br/>pre-computed**"]
    N2 --> H
    N3 --> H
    H --> H1["Licence: per device,<br/>uncacheable, on the critical<br/>path, gating all playback"]
    H --> H2["Personalisation: a 100 ms<br/>budget over thousands of<br/>titles per member"]

    style N1 fill:#17272a,stroke:#35897e
    style N2 fill:#17272a,stroke:#35897e
    style N3 fill:#17272a,stroke:#35897e
    style H1 fill:#1c1814,stroke:#c99a4e
    style H2 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: ['netflix'],
    body: `Open Connect is the reference this design is built on, and four of its properties are worth extracting because each is a consequence of the catalogue rather than of scale.

**Appliances live inside ISP networks, not at internet exchange points.** The traffic never crosses the ISP's expensive transit links, which is why ISPs host them willingly — **the arrangement benefits both parties**, and that mutual benefit is what makes the model deployable at all. A design that only helped the streaming provider would not get installed.

**Appliances are filled during off-peak hours.** The published model fills in the small hours when the ISP's network is idle. **So the cache is not merely closer — it is populated at a time when bandwidth has no opportunity cost**, which is a second saving on top of the proximity.

**Placement is driven by forecast popularity per region.** Not a least-recently-used cache but a **deliberate plan**: predicted regional demand determines what each appliance holds. **This is the component with no analogue in reactive caching**, and it exists only because demand is predictable.

**And the catalogue's size is what makes it work.** A curated catalogue is small enough that a meaningful fraction — often all of it — fits on a single appliance. **That is the arithmetic underneath the whole model**, and it is why the same approach cannot be applied to user-generated video: an exabyte catalogue has no "hold everything" option.

**Three transferable lessons.**

**Ask whether you know demand in advance.** If yes, pre-position and stop paying cache misses. If no, cache reactively and spend the effort on the cache key. **This is the same question the CDN lesson posed, answered in the affirmative for the first time.**

**Compute the catalogue-to-appliance ratio.** A 100 TB catalogue against 200 TB boxes gives "hold everything", which makes forecasting a convenience. A 1 PB catalogue makes it the constraint, and placement becomes a tiered problem with a miss rate per tier.

**Off-peak filling is a distinct saving from proximity.** Both matter, and only one is obvious.

**Where the reference does not help.** Open Connect is about delivery. **The licence path and recommendation serving — the two hard paths in this design — are elsewhere**, and the licence path in particular is uncomfortable precisely because it is the one thing that cannot be pushed to the edge. A design that pre-positions perfectly and has a single-region licence service has moved every byte close to the viewer and left the gate far away.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, several of which are the opposite of the user-generated case.',
    rows: [
      {
        option: 'Lazy transcoding',
        whenItWins:
          'When most content is barely watched, which is user-generated video.',
        whenItLoses:
          'Here. Every title is watched, so lazy pays the full cost plus the machinery, plus first-viewer waits — and it forecloses per-title analysis.',
        cost:
          'Complexity with no saving, and a higher egress bill from a fixed ladder.',
      },
      {
        option: 'Eager per-title encoding',
        whenItWins:
          'A bounded catalogue. ~250 cores continuously, and content-aware bitrates reduce egress, which is the largest operating cost.',
        whenItLoses:
          'When the catalogue is unbounded, where eager encoding is a million cores mostly wasted.',
        cost:
          'Encoding every title fully, including any that underperform.',
      },
      {
        option: 'Reactive CDN caching',
        whenItWins:
          'Unpredictable demand — the first viewer per region pays a miss and everyone after hits.',
        whenItLoses:
          'A simultaneous global release makes every edge cold at a precisely known moment, sending the full uncached load to origin.',
        cost:
          'A cold-start stampede at exactly the worst time.',
      },
      {
        option: 'Pre-positioning into ISP appliances',
        whenItWins:
          'Bounded forecastable catalogues. Nobody pays a miss, filling is off-peak and therefore free, and traffic avoids ISP transit.',
        whenItLoses:
          'When the catalogue exceeds appliance capacity, making forecasting the binding constraint.',
        cost:
          'Storage for content that may not be watched, a forecasting pipeline, and hardware inside third-party networks.',
      },
      {
        option: 'Globally-consistent concurrent-stream counting',
        whenItWins:
          'Nowhere worth the price. It is exact.',
        whenItLoses:
          'It adds a cross-region round trip to the critical path to first frame, for a limit whose purpose is deterrence.',
        cost:
          '100 ms or more of user-visible startup latency on every play.',
      },
      {
        option: 'Regional approximate concurrency enforcement',
        whenItWins:
          'The right answer. Fast, and the overshoot is a shared account getting an extra stream.',
        whenItLoses:
          'If the limit were a contractual guarantee rather than a deterrent.',
        cost:
          'A member streaming across regions can exceed the limit.',
      },
      {
        option: 'Fail closed on entitlement',
        whenItWins:
          'Nowhere. It refuses paying subscribers during an infrastructure problem.',
        whenItLoses:
          'Always: a subscriber unable to watch is a cancellation, while an extra stream is a rounding error.',
        cost:
          'Playback outage during any entitlement-store problem.',
      },
      {
        option: 'Fail open on a signed short-lived session token',
        whenItWins:
          'Always. Playback continues on a token issued minutes ago, which bounds the exposure.',
        whenItLoses:
          'If tokens were long-lived, which is why they must not be.',
        cost:
          'Concurrency and fresh entitlement unchecked for the token\'s lifetime.',
      },
      {
        option: 'Home screen computed per request',
        whenItWins:
          'Perfect freshness.',
        whenItLoses:
          'A 100 ms budget cannot score thousands of titles per row per load at 20,000 loads/second.',
        cost:
          'An unachievable latency target.',
      },
      {
        option: 'Precomputed rows with row-level invalidation',
        whenItWins:
          'Always. A load is a cache read; refresh is periodic; a completed episode invalidates only the affected row.',
        whenItLoses:
          'Freshness — the screen lags recent viewing except where invalidated deliberately.',
        cost:
          'A refresh pipeline and an invalidation rule per row type.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Same as YouTube: lazy transcoding and a CDN that caches on first request."',
      whyWeak:
        'It carries over a design built for unpredictable unbounded content. Lazy transcoding saves nothing when every title is watched, and reactive caching means a simultaneous global release finds every edge cold at a precisely known moment — sending millions of uncached fetches to origin at once.',
      strongAnswer:
        '"The catalogue property inverts the decisions. Bounded and forecastable means I encode eagerly with per-title bitrate analysis, which reduces egress — the largest cost — and it means I pre-position content into ISP appliances before a release rather than caching it reactively. A 100 TB catalogue against 200 TB appliances makes \'hold everything\' the common case, so nobody ever pays a cache miss and the fill happens off-peak when bandwidth is free."',
    },
    {
      weakAnswer: '"Content is served as encrypted segments from the CDN, with keys included in the manifest."',
      whyWeak:
        'A key in the manifest is a key anyone with the manifest can use, which defeats the protection entirely. And it misses that the licence must be per device and per entitlement — checked against an active subscription, a permitted region and a concurrency limit.',
      strongAnswer:
        '"The manifest points at a separate licence server; the player presents a device identity and a signed session token, and the server checks subscription, regional availability and concurrency before issuing a key bound to that device. That request is per device and per entitlement, so it is uncacheable by definition, and it is on the critical path to first frame — which makes it the least redundant component gating all playback, and the one needing the most redundancy."',
    },
    {
      weakAnswer: '"The licence server checks a globally-consistent count of active streams before issuing a key."',
      whyWeak:
        'It puts a cross-region round trip — 100 ms or more — on the critical path to first frame, for a limit whose purpose is discouraging account sharing rather than being exact.',
      strongAnswer:
        '"I would enforce concurrency regionally and approximately, with asynchronous reconciliation. A member streaming across two regions might get a fifth stream, and that is the right direction: the failure mode of over-enforcement is telling a paying subscriber they cannot watch, which is a cancellation. Exactness is not worth 100 milliseconds on every play for a deterrent."',
    },
    {
      weakAnswer: '"If the entitlement store is unavailable, playback is blocked to prevent unauthorised viewing."',
      whyWeak:
        'It refuses paying subscribers during an infrastructure problem, even though every byte of content is sitting on an appliance one hop away. The asymmetry is severe: a blocked subscriber may cancel, while an unauthorised stream costs almost nothing.',
      strongAnswer:
        '"Fail open on the signed session token. It was issued minutes ago after a successful entitlement check, so it bounds the exposure — I skip the concurrency check and the fresh subscription check and let playback proceed. This inverts the usual instinct deliberately: a subscriber unable to watch is a cancellation, and a shared account getting an extra stream is a rounding error. Short token lifetimes are what make that safe."',
    },
    {
      weakAnswer: '"The home screen queries the catalogue, joins viewing history, and ranks the results per request."',
      whyWeak:
        'A 100 ms budget cannot score thousands of titles across ten rows per load, at 20,000 loads per second. Treating it as a database query yields either a generic screen or a slow one.',
      strongAnswer:
        '"Precompute the rows and refresh periodically, so a load is a cache read. Retrieval per row uses approximate nearest-neighbour search over embeddings to get about a hundred candidates in single-digit milliseconds, then ranking scores that small set — a thousand scorings per refresh rather than per load. And a completed episode invalidates only the \'Continue watching\' row rather than recomputing the screen."',
    },
    {
      weakAnswer: '"An appliance cache uses LRU eviction to keep popular content."',
      whyWeak:
        'It reduces pre-positioning to reactive caching with extra hardware. LRU learns popularity from misses, which means the first viewers in each region still wait — and a scheduled release still finds every appliance cold.',
      strongAnswer:
        '"Placement is a deliberate plan, not an eviction policy. A fill planner forecasts regional demand, computes what each appliance should hold, and schedules transfers in the local off-peak window. That is the whole point: LRU learns what was popular by paying misses, whereas a forecast puts the bytes in place before the first request. And with a 100 TB catalogue against 200 TB appliances, the plan is usually \'hold everything\' and the diff is just new titles."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hms-1',
      front: 'Which catalogue property inverts every decision from a user-generated platform?',
      back: 'Bounded, immutable, and forecastable demand. It licenses pre-positioning and eager per-title encoding, neither of which is available for unpredictable content.',
      topic: 'catalogue',
    },
    {
      id: 'fc-hms-2',
      front: 'Why is lazy transcoding wrong here?',
      back: 'Every title is watched, so lazy pays the full cost plus the machinery plus first-viewer waits — and it forecloses per-title bitrate analysis, which attacks egress.',
      topic: 'catalogue',
    },
    {
      id: 'fc-hms-3',
      front: 'What does per-title encoding buy?',
      back: 'Content-aware bitrates — a dialogue scene needs a fraction of an action sequence\'s bitrate at equal perceived quality — which reduces egress, the largest operating cost.',
      topic: 'catalogue',
    },
    {
      id: 'fc-hms-4',
      front: 'What arithmetic makes pre-positioning viable?',
      back: 'A ~100 TB catalogue against ~200 TB appliances, so the common case is "hold everything" and forecasting is a convenience rather than the constraint.',
      topic: 'pre-positioning',
    },
    {
      id: 'fc-hms-5',
      front: 'Why is a simultaneous global release the worst case for reactive caching?',
      back: 'Every edge is cold at the same precisely-known moment, so millions of distinct uncached fetches hit origin within minutes.',
      topic: 'pre-positioning',
    },
    {
      id: 'fc-hms-6',
      front: 'Name the two savings from off-peak appliance filling.',
      back: 'Proximity — the bytes are one hop away — and timing, since the transfer happens when the ISP network is idle and bandwidth has no opportunity cost.',
      topic: 'pre-positioning',
    },
    {
      id: 'fc-hms-7',
      front: 'Why is placement a plan rather than an eviction policy?',
      back: 'LRU learns popularity by paying misses, so first viewers still wait and a scheduled release still finds appliances cold. A forecast puts bytes in place before the first request.',
      topic: 'pre-positioning',
    },
    {
      id: 'fc-hms-8',
      front: 'Why can a licence request not be cached at the edge?',
      back: 'It is per device and per entitlement — the CDN rule that a response depending on who is asking cannot be shared. So the licence path has none of the CDN\'s leverage.',
      topic: 'drm',
    },
    {
      id: 'fc-hms-9',
      front: 'Why is the licence service the most uncomfortable component?',
      back: 'It gates all playback, is uncacheable, cannot be pre-positioned, and sits on the critical path to first frame — so it is the least redundant thing in a system where content is everywhere.',
      topic: 'drm',
    },
    {
      id: 'fc-hms-10',
      front: 'How is the concurrent-stream limit enforced, and why approximately?',
      back: 'Regionally with asynchronous reconciliation. A global count adds 100 ms to every play for a limit whose purpose is deterrence, and over-enforcement means refusing a paying subscriber.',
      topic: 'drm',
    },
    {
      id: 'fc-hms-11',
      front: 'Which way does the entitlement check fail, and why?',
      back: 'Open, on a signed short-lived session token. A blocked subscriber is a cancellation; an extra stream is a rounding error. The token lifetime bounds the exposure.',
      topic: 'drm',
    },
    {
      id: 'fc-hms-12',
      front: 'Why is the home screen precomputed rather than queried?',
      back: 'A 100 ms budget cannot score thousands of titles across ten rows at 20,000 loads/second. Precomputed rows make a load a cache read.',
      topic: 'recommendation-serving',
    },
    {
      id: 'fc-hms-13',
      front: 'What are the two stages of recommendation serving?',
      back: 'Retrieval — approximate nearest neighbour over embeddings for ~100 candidates in single-digit milliseconds — then ranking that small set. A thousand scorings per refresh, not per load.',
      topic: 'recommendation-serving',
    },
    {
      id: 'fc-hms-14',
      front: 'How is home-screen freshness recovered without full recomputation?',
      back: 'Row-level invalidation: a completed episode invalidates only the "Continue watching" row rather than the whole screen.',
      topic: 'recommendation-serving',
    },
  ],

  quiz: [
    {
      id: 'q-hms-1',
      kind: 'scenario',
      prompt:
        'A new season releases globally at midnight UTC. The platform uses reactive CDN caching. What happens?',
      options: [
        { id: 'a', label: 'Every edge is cold simultaneously, so millions of distinct uncached fetches hit origin within minutes — a cold-start stampede at a precisely known moment' },
        { id: 'b', label: 'The CDN pre-fetches popular content automatically, so nothing happens' },
        { id: 'c', label: 'Only the first viewer per edge waits, which is a negligible cost' },
        { id: 'd', label: 'The origin serves everything, which is fine because segments are small' },
      ],
      correct: ['a'],
      explanation:
        '10 episodes × 6 renditions × 400 segments is 24,000 objects, times ~200 edges, all fetched in the same window. Reactive caching means the first viewer per edge per object pays a miss, and with a simultaneous global release those are all at once. Pre-positioning exists precisely for this case, and it is available because the content and the moment are both known.',
      difficulty: 'core',
      topic: 'pre-positioning',
    },
    {
      id: 'q-hms-2',
      kind: 'scenario',
      prompt:
        'A candidate proposes lazy transcoding for a 10,000-title curated catalogue. Why is that wrong?',
      options: [
        { id: 'a', label: 'Every title is watched, so lazy pays the full cost plus the machinery and first-viewer waits — and it forecloses per-title bitrate analysis' },
        { id: 'b', label: 'Lazy transcoding cannot produce more than one rendition' },
        { id: 'c', label: 'It is correct — lazy transcoding always saves compute' },
        { id: 'd', label: 'The catalogue is too small for transcoding to matter at all' },
      ],
      correct: ['a'],
      explanation:
        'Lazy transcoding earns its complexity when most content is barely watched. With a curated catalogue every title is watched, so the lazy path triggers for everything. And eager encoding at this scale is ~250 cores, which makes per-title analysis affordable — reducing egress, the largest operating cost.',
      difficulty: 'core',
      topic: 'catalogue',
    },
    {
      id: 'q-hms-3',
      kind: 'scenario',
      prompt:
        'Every byte of content sits on an appliance one hop from the viewer. The regional licence service goes down. What happens?',
      options: [
        { id: 'a', label: 'Nothing plays in that region — the licence gates all playback and cannot be pre-positioned or cached, making it the least redundant component' },
        { id: 'b', label: 'Playback continues because the segments are already local' },
        { id: 'c', label: 'The CDN issues licences as a fallback' },
        { id: 'd', label: 'Only new plays are affected; existing sessions continue indefinitely' },
      ],
      correct: ['a'],
      explanation:
        'This asymmetry is the design\'s most uncomfortable property: perfect content placement is worthless if the gate is unavailable. Existing sessions continue until their licence needs renewal, which is why option d is partially right and not the answer. The mitigations are regional deployment, cross-region failover, and a degraded mode.',
      difficulty: 'advanced',
      topic: 'drm',
    },
    {
      id: 'q-hms-4',
      kind: 'scenario',
      prompt:
        'The entitlement store is unavailable. Should the licence service issue keys?',
      options: [
        { id: 'a', label: 'Yes — fail open on the signed short-lived session token, because refusing a paying subscriber is worse than an extra unauthorised stream' },
        { id: 'b', label: 'No — blocking playback prevents unauthorised viewing' },
        { id: 'c', label: 'Yes, but only for content the member has watched before' },
        { id: 'd', label: 'No — it should queue requests until the store recovers' },
      ],
      correct: ['a'],
      explanation:
        'The asymmetry is severe: a blocked subscriber may cancel, while an unauthorised stream costs almost nothing. The signed token was issued minutes ago after a successful check, so it bounds the exposure — which is why token lifetimes must be short. Queueing means the same outage from the viewer\'s perspective.',
      difficulty: 'core',
      topic: 'drm',
    },
    {
      id: 'q-hms-5',
      kind: 'scenario',
      prompt:
        'The home screen has a 100 ms p99 budget, ten rows, and 20,000 loads/second at peak. What design does that force?',
      options: [
        { id: 'a', label: 'Precomputed rows refreshed periodically, with nearest-neighbour retrieval and ranking over ~100 candidates per row at refresh time' },
        { id: 'b', label: 'A denormalised catalogue table with an index on member id' },
        { id: 'c', label: 'Ranking all 10,000 titles per load with a fast linear model' },
        { id: 'd', label: 'Serving the same regionally-popular rows to everyone' },
      ],
      correct: ['a'],
      explanation:
        'Precomputation turns a load into a cache read, which is what makes 20,000/second trivial. Retrieval by approximate nearest neighbour returns candidates in single-digit milliseconds, and ranking a hundred candidates per row happens at refresh — a thousand scorings per refresh rather than per load. Option d is the designed fallback when recommendation serving is down, not the primary path.',
      difficulty: 'core',
      topic: 'recommendation-serving',
    },
    {
      id: 'q-hms-6',
      kind: 'multi',
      prompt:
        'Which properties make ISP appliance pre-positioning work here but not for user-generated video? Select all that apply.',
      options: [
        { id: 'a', label: 'The catalogue is ~100 TB and fits on a single ~200 TB appliance' },
        { id: 'b', label: 'Demand is forecastable per region, so placement can be planned rather than learned from misses' },
        { id: 'c', label: 'Release times are known, so the fill completes before demand arrives' },
        { id: 'd', label: 'Segments are immutable, which user-generated segments are not' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the enabling properties, and all three concern predictability and size rather than scale. The fourth is wrong: user-generated segments are equally immutable once produced — which is why they cache well reactively. Immutability enables caching; forecastability enables pre-positioning.',
      difficulty: 'advanced',
      topic: 'pre-positioning',
    },
  ],

  exercises: [
    {
      id: 'ex-hms-1',
      kind: 'design',
      title: 'Grow the catalogue until the design breaks',
      estimatedMinutes: 40,
      prompt: `**Part 1.** The design assumes a 100 TB catalogue and 200 TB appliances. Work out what changes at each catalogue size, and what the placement strategy becomes.

\`\`\`
(a) 100 TB   — the design as given
(b) 400 TB   — 2× appliance capacity
(c) 5 PB     — 25× appliance capacity
(d) 1 EB     — user-generated scale
\`\`\`

For each: the placement strategy, what fraction of requests miss the appliance, and what the miss falls through to.

**Part 2.** For case (c), design the tiering. Specify the tiers, what determines placement in each, and the expected miss rate per tier.

**Part 3.** Five things that break in case (c) beyond storage.

Then answer:

- At which catalogue size does forecasting stop being a convenience and become the constraint?
- What single measurement would you want before committing to a tiering design?
- The licence service cannot be pre-positioned. Is there anything about it that can be?`,
      rubric: [
        'Each catalogue size gets a placement strategy with reasoning.',
        'Identifies that (a) and (b) permit "hold everything" or near it.',
        'Identifies (c) as where forecasting becomes load-bearing.',
        'Identifies (d) as forcing reactive caching.',
        'Part 2 specifies at least three tiers with placement criteria and miss rates.',
        'Part 3 names at least four non-storage consequences.',
        'Answers the forecasting-threshold question with reasoning tied to capacity ratio.',
        'Names a specific measurement — the demand distribution — and says what it decides.',
        'Licence answer identifies what can be pushed toward the edge and what cannot.',
      ],
      modelAnswer: `**Part 1 — placement strategy by catalogue size**

**(a) 100 TB against 200 TB appliances — the design as given.**

\`\`\`
Strategy:   hold the entire catalogue on every appliance
Miss rate:  effectively 0% for content, ignoring appliance failures
Fallback:   commercial CDN, used only for ISPs without an appliance
            and for appliance failures
\`\`\`

**Forecasting is a convenience, not a requirement.** The plan is "everything", and the daily diff is just newly-released titles. **The fill planner's forecasting logic barely runs**, which is a comfortable place to be — the sophisticated component is present and idle.

**(b) 400 TB against 200 TB appliances — 2× capacity.**

\`\`\`
Strategy:   hold the popular ~50% on every appliance
Miss rate:  depends entirely on the demand distribution.
            If the top 50% of titles are 95% of views → 5% miss
            If demand were uniform → 50% miss
Fallback:   CDN for the tail
\`\`\`

**Now forecasting matters, and the demand distribution decides how much.** Streaming viewership is heavily skewed — a small fraction of titles dominates — so holding the popular half plausibly captures 90–95% of views. **The design still works well, and it now depends on a property of the demand curve rather than on arithmetic.**

*And a refinement becomes available:* **regional variation.** A title popular in one country may be unwatched in another, so per-region placement plans capture more views than a single global "top 50%" list. **This is where forecasting starts earning its complexity.**

**(c) 5 PB against 200 TB appliances — 25× capacity.**

\`\`\`
Strategy:   tiered (see Part 2). An appliance holds ~4% of the catalogue.
Miss rate:  if the top 4% of titles are ~70% of views → ~30% appliance miss
Fallback:   a regional fill tier, then the CDN
\`\`\`

**A 30% miss rate is a different system.** At 4 TB/s peak, 30% is 1.2 TB/s falling through — which is more than a fallback tier absorbs incidentally. **So the fallback becomes a designed tier with its own capacity plan**, and this is the case Part 2 addresses.

**(d) 1 EB — user-generated scale.**

\`\`\`
Strategy:   pre-positioning is abandoned for the catalogue as a whole.
            An appliance holds 0.02% of it.
Miss rate:  dominated by the long tail; pre-positioning the top 0.02%
            might capture 30–40% of views at best
Fallback:   reactive caching becomes the primary mechanism
\`\`\`

**And the reason is not only size — it is that demand is no longer forecastable.** At this scale the catalogue is user-generated, so which of a billion videos will be watched tomorrow is unknown. **Both enabling properties disappear together**, which is why the previous lesson's design is reactive.

*The one thing that survives:* **pre-positioning the popular head is still worthwhile.** Pushing the top few thousand videos to edges captures a meaningful share of views cheaply. **So even at exabyte scale the answer is a hybrid** — push what you can predict, cache the rest.

---

**Part 2 — tiering for the 5 PB case**

**Three tiers, and the placement criterion differs at each.**

\`\`\`
TIER 1 — ISP appliances (~200 TB each, ~4% of catalogue)
  Placement:  forecast regional demand for the next 24 h, ranked by
              expected views ÷ size. Refreshed nightly.
  Content:    current releases, regional top titles, seasonal content
  Target:     capture ~70% of views
  Miss cost:  one hop further

TIER 2 — Regional fill sources (~5 PB each, full catalogue, one per region)
  Placement:  everything. This is the regional origin.
  Content:    the complete catalogue
  Target:     capture ~29% of views (everything tier 1 misses)
  Miss cost:  a regional round trip, still inside the continent

TIER 3 — Commercial CDN + global origin
  Placement:  reactive
  Content:    whatever is requested and not in tier 2
  Target:     ~1% — appliance and regional failures, unusual requests
  Miss cost:  cross-region fetch
\`\`\`

**Three design points worth defending.**

**Tier 2 holds the full catalogue, which is what makes tier 1's miss rate acceptable.** A 30% miss from tier 1 falls to a regional source rather than to a cross-continent origin — **so the miss is a latency increase of tens of milliseconds rather than hundreds**, and the segments are large enough that the initial latency matters less than sustained throughput.

*This is the crucial structural choice.* Without tier 2, a tier-1 miss goes to a global origin and 1.2 TB/s crosses continents. **With it, the expensive traffic stays regional.**

**Placement is ranked by expected views ÷ size**, not by expected views alone. **A 50 GB 4K film with 10,000 expected views is worse value per byte than a 5 GB episode with 5,000** — the ratio is what maximises captured views per byte of appliance capacity.

**Refresh nightly, in the off-peak window.** The diff each night is modest — new releases plus shifts in regional popularity — so the transfer volume is manageable even though the appliance holds only 4%.

**Expected miss rates, and the metric to watch.**

\`\`\`
Tier 1 hit:  ~70%   (planned, forecast-dependent)
Tier 2 hit:  ~29%   (full catalogue, so nearly everything else)
Tier 3:      ~1%    (failures and oddities)
\`\`\`

**The metric that matters is the tier-1 hit rate**, because it determines how much traffic crosses ISP transit. A drop from 70% to 50% means 40% more regional traffic — **so the hit rate is a cost signal and it should be alerted on**, not merely reported.

---

**Part 3 — five things that break beyond storage in the 5 PB case**

**1. Forecast accuracy becomes a cost driver rather than a nicety.** At 4% appliance capacity, a forecast that misplaces the top titles moves the hit rate several points, and each point is tens of gigabytes per second of regional traffic. **A bad forecast now has a measurable bill**, which means the forecasting pipeline needs its own accuracy monitoring — comparing predicted against actual regional demand and alerting on drift.

**2. The nightly fill window becomes a constraint.** Refreshing 4% of a 5 PB catalogue — with churn as popularity shifts — could be tens of terabytes per appliance per night. **At some point the off-peak window is not long enough**, and the fill starts running into peak hours, at which point the "free bandwidth" property is lost. *Mitigation:* incremental placement with hysteresis, so a title near the boundary is not shipped in and out on successive nights.

**3. Regional variation stops being an optimisation and becomes necessary.** With 4% capacity, a globally-uniform placement wastes appliance space on content nobody in that region watches. **Per-region — possibly per-ISP — plans become required**, which multiplies the planning work and the placement state.

**4. The long tail's latency becomes visible in the product.** 30% of plays fetch from a regional source rather than an appliance. **For a film that is a slightly slower start; for a series the viewer notices the difference between episodes** if some are on the appliance and others are not. *Mitigation:* place whole series together rather than ranking episodes individually — **a placement constraint driven by product experience rather than by demand arithmetic.**

**5. Placement state becomes a real system.** Which appliance holds which rendition of which title, across thousands of appliances and millions of objects. **That is a database with a consistency requirement**: steering a player to an appliance that no longer holds the content is a miss with an extra round trip. *Mitigation:* the appliance reports its inventory, and steering uses the reported state rather than the plan — **because the plan is intent and the inventory is truth.**

*And a sixth worth naming:* **eviction becomes a decision.** At 100 TB there is nothing to evict. At 4% capacity, every night's fill implies evicting something, and evicting content that is about to become popular is the failure mode. **Eviction should follow the forecast rather than recency**, which is the opposite of a normal cache.

---

**At which catalogue size does forecasting become the constraint?**

**Between (b) and (c) — roughly when the catalogue exceeds about 2–3× appliance capacity.**

The reasoning is about the demand curve rather than the ratio alone:

\`\`\`
Catalogue = 0.5× capacity:  hold everything. Forecasting idle.
Catalogue = 2× capacity:    hold the top 50%. If the demand curve is
                            steep, that captures ~95% of views —
                            forecasting matters but errors are cheap.
Catalogue = 25× capacity:   hold the top 4%. Now the marginal title
                            included or excluded is a real cost, and
                            forecast error is directly a bandwidth bill.
\`\`\`

**The transition is where the marginal title's inclusion stops being obvious.** At 50% capacity, the top half of a steeply-skewed catalogue is clearly worth holding and the boundary titles barely matter. At 4%, the boundary is in the middle of the demand curve where the density of similarly-popular titles is high — **so small forecast errors swap genuinely different titles in and out.**

**Sharper: forecasting becomes the constraint when the appliance boundary falls where the demand curve is flat.** With a steep head and a long flat tail, holding the head is easy and the boundary is in the flat part — so the exact cut matters less than one might expect, and the real constraint is the *total* captured fraction rather than which specific titles.

**What single measurement would I want before committing to a tiering design?**

**The cumulative demand distribution, per region.** Specifically: what fraction of views is captured by the top N titles, for N across the range, computed separately per region.

**Why this and nothing else:** every number in Part 2 depends on it.

\`\`\`
If the top 4% captures 90% of views  → tier 1 does most of the work,
                                        tier 2 is a thin fallback
If the top 4% captures 40% of views  → tier 2 carries the majority of
                                        traffic and must be sized as a
                                        primary tier, not a fallback
\`\`\`

**A factor-of-two difference in that one measurement changes tier 2 from a fallback into the main delivery tier**, which changes its capacity, its placement, and its cost by a large amount.

**And the per-region breakdown matters as much as the aggregate.** If regional demand curves differ substantially — different languages, different local content — then a global placement plan is leaving capture on the table, and per-region planning is worth its complexity. **If they are similar, a global plan is nearly as good and much simpler.**

*A second measurement I would want, subordinate to the first:* **how quickly demand decays after release.** If a title's views are concentrated in the first week, placement can be aggressive and short-lived — hold it everywhere for two weeks, then evict. If demand is durable, placement is stable and eviction is harder. **That determines the fill volume per night**, which is the constraint from Part 3.

**Can anything about the licence path be pre-positioned?**

**The check cannot be. Parts of what it needs can be, and that is the useful answer.**

**What cannot be pushed to the edge:** the decision itself. It depends on the member's current subscription state, their concurrent sessions, and their region — all of which are live, per-member, and mutable. **A licence issued at the edge without that state is not a licence check.**

**What can be pushed closer:**

**The entitlement snapshot.** A member's subscription state, plan and permitted region change rarely. **A regional replica of member entitlement — eventually consistent, refreshed continuously — means the licence service does not cross regions to check subscription.** The staleness window is the risk, and it is bounded: a cancelled member might get a licence for a few minutes.

**The signed session token, which is exactly this idea already.** The token *is* a pre-positioned entitlement assertion: it says "this member was verified as entitled at time T", and it travels with the client. **So the design already pushes the entitlement decision toward the edge in time rather than in space** — and that is what makes the fail-open degraded mode possible.

**The content keys.** Keys per title can be replicated to every regional licence service in advance. **The key material is not the secret being protected — the *binding to a device* is** — so distributing keys regionally is safe and removes a lookup from the critical path.

**What can be reduced rather than moved: the number of licence requests.** A licence covering several titles, or a longer validity period, means fewer requests on the critical path. **For a member about to watch three episodes, issuing one licence covering all three removes two round trips from their session.**

**So the honest summary: the licence *check* is irreducibly central, and everything it depends on can be regionalised, pre-shared or bundled — which reduces its latency and its failure blast radius without changing its central nature.**

*And the general principle worth extracting:* when something cannot be pre-computed, ask what its *inputs* are and whether those can be. **The check needs live state; the state it needs is mostly slow-changing**, and separating the fast decision from the slow inputs is what makes a central component fast and survivable.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hms-1',
      level: 'basic',
      question: 'Design Netflix. How is it different from designing YouTube?',
      guidance:
        'The catalogue is bounded, immutable and forecastable, which inverts transcoding and delivery decisions. Look for that stated as the design input rather than a list of feature differences.',
    },
    {
      id: 'iq-hms-2',
      level: 'basic',
      question: 'How is content delivered?',
      guidance:
        'Pre-positioned into appliances inside ISP networks, filled off-peak, with a commercial CDN as fallback. A strong answer gives the catalogue-to-appliance ratio that makes it viable.',
    },
    {
      id: 'iq-hms-3',
      level: 'intermediate',
      question: 'A season releases globally at midnight. What do you do?',
      guidance:
        'Pre-position it days ahead so every edge is warm. Look for the recognition that reactive caching makes every edge cold at a precisely known moment, and that this is the ideal pre-positioning case.',
    },
    {
      id: 'iq-hms-4',
      level: 'intermediate',
      question: 'How does DRM fit into the playback path?',
      guidance:
        'A separate licence service, per device and per entitlement, therefore uncacheable and on the critical path to first frame. A strong answer names it as the least redundant component gating all playback.',
    },
    {
      id: 'iq-hms-5',
      level: 'advanced',
      question: 'The entitlement store is down. Do you issue licences?',
      guidance:
        'Yes — fail open on a signed short-lived session token. Excellent answers state the asymmetry (a blocked subscriber cancels; an extra stream is a rounding error) and note the token lifetime bounds the exposure.',
    },
    {
      id: 'iq-hms-6',
      level: 'advanced',
      question: 'How do you serve a personalised home screen in 100 ms?',
      guidance:
        'Precomputed rows, nearest-neighbour retrieval, ranking over a small candidate set at refresh time, with row-level invalidation. Excellent answers note it is a thousand scorings per refresh rather than per load.',
    },
    {
      id: 'iq-hms-7',
      level: 'followup',
      question: 'Your catalogue grows to 25× appliance capacity. What changes?',
      guidance:
        'Forecasting becomes the constraint, placement becomes tiered with a full-catalogue regional tier, and the tier-1 hit rate becomes a cost signal. A strong answer names the demand distribution as the measurement that decides the tiering.',
    },
    {
      id: 'iq-hms-8',
      level: 'followup',
      question: 'The licence check cannot be pre-positioned. Can anything about it be?',
      guidance:
        'Its inputs: a regional entitlement replica, pre-shared content keys, and the signed session token as a pre-positioned entitlement assertion. Plus reducing request count via bundled or longer-lived licences.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hms-1',
      kind: 'what-changes-if',
      prompt:
        'This design assumes video. Now change one thing: it is music — Spotify rather than Netflix. Same bounded catalogue, radically different object size and session shape. What changes?',
      discussion: `The catalogue property is the same, and almost every quantity changes by orders of magnitude in ways that invert several decisions.

**The arithmetic first, because it drives everything.**

\`\`\`
Video:  ~10 GB per title, 10,000 titles = 100 TB
        45-minute session at 4 Mbit/s = 1.35 GB
Music:  ~5 MB per track, 100 million tracks = 500 TB
        30-minute session, ~10 tracks = 50 MB
\`\`\`

**Two inversions fall straight out.**

**The catalogue is larger and the objects are tiny.** 100 million tracks is a much bigger catalogue than 10,000 films, and yet at 500 TB it is only 5× the video catalogue's size. **So "hold everything" is out of reach for a single appliance, and the popular head is trivially small** — the top 100,000 tracks is 500 GB, which fits anywhere.

**Egress per session collapses.** 50 MB versus 1.35 GB is 27× less. **So bandwidth stops being the dominant cost**, and the design's entire delivery emphasis weakens. Music streaming's infrastructure cost is dominated by something else.

**What that something else is: request volume.**

\`\`\`
Video:  1,150 plays/second → 1,150 manifest + licence requests/second
Music:  a track every 3 minutes per active listener
        50 million concurrent listeners → ~280,000 track starts/second
\`\`\`

**Two orders of magnitude more requests, each tiny.** So the system's shape flips from *bandwidth-bound* to *request-bound*, and that changes several components:

**The licence path becomes the bottleneck by volume, not just by criticality.** 280,000 licence requests per second rather than 1,150. **At that rate, per-track licensing is untenable** — so licences must cover a session or a period rather than a track, which is a materially different DRM model.

**Prefetching becomes central.** A listener's next track is highly predictable — it is the next item in a playlist or queue. **So the client fetches track N+1 while playing track N**, which removes the start latency entirely and makes the perceived experience gapless. Video has no equivalent: you do not know which film someone will watch next.

*This is the most interesting change:* **predictable sequential access within a session** is a property music has and video does not, and it moves the latency problem off the critical path entirely.

**Adaptive bitrate largely disappears.** A 5 MB track at 320 kbit/s is affordable on almost any connection, and switching quality mid-track is neither necessary nor perceptible in the way video quality is. **So the segment-and-manifest machinery simplifies to a single file per quality**, with quality chosen once at session start.

*And that removes a whole subsystem* — no per-segment fetching, no bitrate ladder logic in the client, no mid-stream switching.

**What gets harder.**

**Recommendation serving becomes far more central and far more demanding.** Discovery in music is the product: playlists, radio, daily mixes. And the candidate space is 100 million tracks rather than 10,000 titles — **four orders of magnitude more candidates for the retrieval stage**, which makes approximate nearest-neighbour search essential rather than convenient.

**And the latency budget is tighter in a specific way:** a "radio" or "autoplay" feature must choose the next track *during* the current one, which is a real-time recommendation rather than a precomputed row. **So music needs both precomputed surfaces and a live next-track decision**, where video needs only the former.

**Royalty accounting becomes a first-class system with money attached.** Every play is a payment to a rights holder, so **play counting must be exact and auditable** — not the approximate view counting the video lesson permitted. That is the ledger problem: idempotent, reconciled, per-play, at 280,000 plays per second.

*This is a genuinely harder requirement than anything in the video design*, because approximate is unacceptable and the volume is high.

**Offline is a bulk operation rather than a per-title one.** A listener downloads a playlist of 50 tracks, not one film. **So persistent licences cover collections**, and the sync problem resembles the file-sync lesson more than the video one.

**What survives unchanged.**

**The catalogue property and its consequences:** bounded, forecastable, so eager encoding and pre-positioning of the popular head.

**The fail-open entitlement stance**, for the same asymmetry — a paying subscriber unable to listen is a cancellation.

**The two-stage retrieval-and-ranking shape** for recommendations, at a much larger candidate scale.

**Session-based concurrency limits**, with the same regional-approximate enforcement.

**What I would build differently.** Session-scoped licences rather than per-track; aggressive client prefetch of the next track; a full-catalogue regional tier with only the popular head on appliances; and an exact, ledger-grade play-counting pipeline as a separate system from analytics.

**The transferable point.** Both designs share a catalogue property and diverge on object size and session shape. **Object size determines whether you are bandwidth-bound or request-bound**, and session shape determines whether the next request is predictable. Those two questions reorganise the design more than the catalogue size does — which is why "it is streaming, so it is the same problem" is wrong in both directions.`,
    },
    {
      id: 'al-hms-2',
      kind: 'debug',
      prompt:
        'A streaming platform reports that startup latency (time to first frame) has degraded from a p99 of 1.2 s to 2.8 s over three weeks. CDN and appliance hit rates are unchanged at 99%+, segment delivery latency is unchanged, and no releases or deploys correlate with the onset. Diagnose it.',
      discussion: `Segment delivery is unchanged and hit rates are fine, so the bytes are arriving as fast as ever. **The extra 1.6 seconds is spent before the first segment is fetched** — which localises it to the pre-playback sequence: \`/playback/start\`, the manifest fetch, and the licence request.

**Hypothesis 1 — the licence path has slowed.** It is on the critical path, uncacheable, and depends on live state. Any of three things could have degraded: the entitlement lookup, the concurrency count, or the key issuance itself.

*Why it fits the profile:* it is the one component that cannot be helped by the CDN, so its latency passes through to startup latency directly. **And a gradual three-week degradation fits a growing dataset** — a session table accumulating rows, an entitlement store whose index is degrading.

*Check:* licence-service p99 latency over the three weeks, broken into its phases — token validation, entitlement read, concurrency count, key issuance. **The concurrency count is the most likely single culprit**, because it reads a table that grows with active sessions and it is the newest kind of work in that path.

**Hypothesis 2 — the session table has grown because sessions are not expiring.** Concurrency counting reads active sessions for a member. If the heartbeat TTL is not reliably removing dead sessions — a bug, a changed heartbeat interval, a client version that stopped sending them — **the table accumulates and the count query gets slower.**

*Why it fits perfectly:* it explains a *gradual* degradation with no deploy correlation, because the table grows continuously once the leak starts. And a client rollout that changed heartbeat behaviour would not appear in the platform's own deploy log.

*Check:* row count in the session table over time, and the distribution of \`last_heartbeat_at\`. **A large population of sessions last heard from days ago is conclusive** — and it would also mean members are hitting concurrency limits spuriously, which is worth checking as a second symptom.

**Hypothesis 3 — \`/playback/start\` has accumulated work.** That call returns the manifest URL, licence URL, session id and resume position. **If a feature added a synchronous call to it** — fetching a personalised intro, checking a new eligibility rule, writing an analytics event inline — it lengthens the critical path.

*Why the three-week gradual shape argues against it:* a feature addition is a step change, not a ramp. **Unless the added work itself scales with a growing dataset**, in which case it is really hypothesis 1 or 2 in a different component.

*Check:* the p99 of \`/playback/start\` separately from the licence call, and its span breakdown. **This is where tracing earns its cost** — the two calls must be measured separately or the diagnosis is guesswork.

**Hypothesis 4 — the resume-position lookup has slowed.** Resume requires reading the member's viewing position, which lives in a table growing with view events. **If that read is not appropriately indexed or partitioned, it degrades as history accumulates** — and it is on the critical path because \`/playback/start\` returns the position.

*Why it fits:* a steadily-growing table producing a steadily-growing read latency, with no deploy correlation.

*Check:* the resume-position query's latency and the growth of the view-events table. **And whether the query reads the event history or a materialised position** — if it scans events to find the latest, that gets worse forever.

**Hypothesis 5 — DNS or TLS setup to a newly-added regional endpoint.** If a new licence region or a new steering endpoint was introduced, clients in some regions may be paying an extra connection setup. **A cross-continent TLS handshake is 300–400 ms**, which would show as startup latency with no change in segment delivery.

*Check:* startup latency broken down by region and by client version. **A regional concentration points here**, and it is a cheap check that also discriminates several other hypotheses.

**What I would check first: the startup-latency breakdown by phase** — \`/playback/start\`, manifest fetch, licence request, first segment. One dashboard, and it localises the 1.6 seconds to a single call. **Without that breakdown, every hypothesis above is equally plausible**, which is why the phase instrumentation is the prerequisite rather than the investigation.

**Then: the session table's row count and heartbeat-age distribution**, because hypothesis 2 explains the gradual shape better than anything else and it has a second detectable symptom — members spuriously hitting concurrency limits.

**Why the unchanged hit rates are the most useful evidence.**

They eliminate the entire delivery tier: appliances, CDN, placement, forecasting, segment sizes. **All the machinery this design spends most of its effort on is provably fine**, which is a large reduction of the search space in one observation.

**And it points at the thing the design itself identified as uncomfortable:** the licence path is the one component that cannot be pre-positioned, cached or made faster by proximity. **When startup latency degrades and delivery does not, the uncacheable critical-path component is the first place to look** — the architecture predicts where its own weakness is.

**The instrumentation changes this demands.**

**Phase-level startup latency as a first-class metric.** Time to \`/playback/start\` response, time to manifest, time to licence, time to first segment — **four numbers, not one.** A single "time to first frame" metric tells you something is wrong and nothing about where.

**Session-table health as a monitored quantity:** row count, and the age distribution of heartbeats. **A session leak degrades both latency and correctness** (spurious concurrency rejections), and neither is visible in a startup-latency graph.

**A latency budget per phase, with alerts.** If the licence request has a 200 ms budget and it drifts to 400, that should page before the aggregate crosses a user-visible threshold. **Budget-per-component beats a single end-to-end target**, because the end-to-end number cannot say which component consumed its share.

**And a growth-related alert class.** Three of the five hypotheses are "a table grew and a query got slower", which is the class of failure that produces exactly this signature — gradual, uncorrelated with deploys, invisible in resource utilisation. **Alerting on query latency trends rather than absolute values catches it weeks earlier.**

**Transferable:** when a composite latency degrades and its most-instrumented component is unchanged, the fault is in the least-instrumented one — and in a system built around pre-positioning and caching, that is whatever could not be pre-positioned or cached. **The architecture tells you where to look, because the component with no leverage is the component with no safety margin.**`,
    },
  ],

  revision: {
    bullets: [
      'A bounded, immutable, forecastable catalogue inverts almost every decision from user-generated video.',
      'Encode eagerly with per-title bitrate analysis — 10,000 titles is ~250 cores, a rounding error.',
      'Per-title encoding attacks egress, which is the largest operating cost.',
      'Lazy transcoding saves nothing when every title is watched, and it forecloses per-title analysis.',
      'A ~100 TB catalogue against ~200 TB appliances makes "hold everything" the common case.',
      'Pre-position rather than cache reactively, so nobody ever pays a cache miss.',
      'A simultaneous global release makes every edge cold at a precisely known moment — the case pre-positioning prevents.',
      'Off-peak filling is a second saving beyond proximity: bandwidth has no opportunity cost when the network is idle.',
      'Placement is a forecast-driven plan, not an eviction policy — LRU learns popularity by paying misses.',
      'A licence request is per device and per entitlement, therefore uncacheable and on the critical path.',
      'The licence service gates all playback and cannot be pre-positioned, making it the least redundant component.',
      'Enforce concurrent-stream limits regionally and approximately; a global count costs 100 ms on every play.',
      'Fail open on a signed short-lived session token — a blocked subscriber is a cancellation.',
      'A 100 ms home-screen budget forces precomputed rows with row-level invalidation.',
      'Recommendation serving is retrieval by nearest neighbour then ranking over ~100 candidates, at refresh not per load.',
      'The catalogue is small enough to hold in memory in every instance, removing its database from the read path.',
      'Forecasting becomes the constraint when the catalogue exceeds roughly 2–3× appliance capacity.',
      'What cannot be pre-positioned can often have its inputs pre-positioned — entitlement replicas, pre-shared keys, session tokens.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A curated-catalogue streaming platform: content encoded eagerly per title, pushed into ISP appliances ahead of demand, with an uncacheable licence service and a precomputed personalised discovery surface.',
    whyItExists:
      'Because a bounded catalogue with forecastable demand permits pre-computation of almost everything — leaving only per-member and per-device decisions on the critical path, which is where the difficulty concentrates.',
    whenToUse: [
      'Eager per-title encoding whenever the catalogue is bounded and every title is watched.',
      'Pre-positioning whenever demand is forecastable and the catalogue fits in edge capacity.',
      'A separate regional licence service whenever content is contractually protected.',
      'Precomputed personalised surfaces whenever the latency budget forbids per-request ranking.',
    ],
    whenNotToUse: [
      'Lazy transcoding — it saves nothing here and forecloses per-title analysis.',
      'Reactive caching as the primary tier for a scheduled global release.',
      'LRU as the appliance placement policy.',
      'Globally-consistent concurrency counting on the critical path.',
      'Failing closed on entitlement.',
    ],
    alternatives: [
      'Reactive CDN caching, when demand is unpredictable or the catalogue does not fit.',
      'Tiered placement with a full-catalogue regional tier, when the catalogue exceeds appliance capacity.',
      'Session-scoped or bundled licences, to reduce critical-path requests.',
      'Regional entitlement replicas and pre-shared keys, to regionalise what cannot be edge-cached.',
      'A regional-popularity home screen, as the designed fallback when personalisation is unavailable.',
    ],
    tradeoffs: [
      'Pre-positioning buys zero cache misses and costs storage for content that may not be watched.',
      'Per-title encoding buys egress reduction and costs analysis compute per title.',
      'Regional approximate concurrency buys 100 ms of startup latency and costs occasional overshoot.',
      'Failing open buys subscriber availability and costs unchecked entitlement for a token lifetime.',
      'Precomputed rows buy a 100 ms budget and cost freshness outside deliberate invalidation.',
      'A full-catalogue regional tier buys a cheap appliance miss and costs a regional origin per region.',
    ],
    failureModes: [
      'Reactive caching leaving every edge cold at a scheduled global release.',
      'Lazy transcoding applied to a catalogue where everything is watched.',
      'A decryption key placed in the manifest, defeating protection entirely.',
      'A globally-consistent concurrency check adding a cross-region round trip to first frame.',
      'Failing closed on entitlement, refusing paying subscribers during an infrastructure fault.',
      'A licence-service regional outage stopping all playback despite content being one hop away.',
      'LRU placement, so first viewers per region still pay misses.',
      'Steering to an appliance whose reported inventory differs from the placement plan.',
      'A session leak growing the concurrency-count query and degrading startup latency gradually.',
      'A home screen computed per request against a 100 ms budget.',
      'Whole series split across placement tiers, so episode start latency varies visibly.',
    ],
    followUpQuestions: [
      'Is the catalogue bounded, and is demand forecastable per region?',
      'What is the catalogue-to-appliance capacity ratio?',
      'What fraction of views does the top N of the catalogue capture, per region?',
      'What happens at a simultaneous global release?',
      'Is placement a plan or an eviction policy?',
      'Where is the licence check, and how many round trips does startup cost?',
      'How is the concurrent-stream limit enforced, and how exact is it?',
      'Which way does the entitlement check fail, and what bounds the exposure?',
      'What is the home screen\'s latency budget, and what is precomputed?',
      'What invalidates a single row rather than the whole screen?',
      'What could be pre-positioned about the inputs to the licence decision?',
    ],
  },
});
