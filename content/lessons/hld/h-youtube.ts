import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-youtube',
  title: 'Design YouTube',
  summary:
    'Transcoding compute is the dominant cost and nobody estimates it — 36 CPU-hours per source hour across six renditions, against a catalogue where most videos are barely watched. That arithmetic makes lazy transcoding the design decision.',
  phase: 'hld',
  module: 'core-designs',
  position: 48,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 95,
  tags: ['transcoding', 'adaptive-bitrate', 'upload-pipeline', 'view-counting', 'cdn'],
  prerequisites: ['h-instagram-feed'],
  resources: [
    {
      key: 'rfc-8216-hls',
      tier: 'must',
      note: 'The adaptive-bitrate delivery protocol: a manifest listing renditions, each segmented. Read it to see why segmentation is what makes bitrate switching possible mid-playback.',
    },
    {
      key: 'aws-s3-multipart',
      tier: 'must',
      note: 'The upload protocol for large files. Read it because a 10 GB upload from a phone must be resumable and parallel, and the completion call is what makes the source appear atomically.',
    },
    {
      key: 'netflix-open-connect',
      tier: 'must',
      note: 'Pre-positioning appliances inside ISP networks, filled overnight. Read it for the contrast with this design — a finite predictable catalogue can be pushed; an unbounded one cannot.',
    },
    {
      key: 'aws-cloudfront-caching',
      tier: 'good',
      note: 'Read it for cache-key construction and origin offload. Video segments are the ideal CDN object — large, immutable, content-addressed — and understanding why is worth the read.',
    },
    {
      key: 'redis-data-types',
      tier: 'good',
      note: 'Read the HyperLogLog and sorted-set sections with view counting in mind. Distinct-viewer counting at 12 KB per video regardless of audience is the mechanism this design uses.',
    },
    {
      key: 'gorilla-paper',
      tier: 'advanced',
      note: 'Time-series compression for high-cardinality counters. Read it if the view-analytics half of this design interests you — it is the shape of the aggregation problem behind watch-time metrics.',
    },
  ],

  intuition: {
    body: `Everyone estimates storage and bandwidth for a video platform. **Almost nobody estimates compute, and compute is the largest cost.**

\`\`\`
One hour of source video, transcoded to 6 renditions:
  ~6 CPU-hours per rendition → 36 CPU-hours per source hour
At 500 hours uploaded per minute:
  8.3 source-hours/second × 36 = 300 CPU-hours per second
  = ~1.08 million cores running continuously
\`\`\`

**A million cores, permanently.** That is plausibly the largest line in the infrastructure budget, and it comes from two innocuous inputs — a rendition count and a transcoding speed — multiplied by an already-large volume.

And it is avoidable, because of a fact about the catalogue: **the view distribution is extremely skewed.** Most uploaded video is watched a handful of times or never. So eagerly producing six renditions of everything means **most of that million cores is spent on video nobody will watch.**

Which gives the design's central decision: **transcode lazily.** Produce one default rendition eagerly so the video is playable, and generate the rest on first request for that quality. **That can cut the transcoding fleet by an order of magnitude**, and it costs a slower first playback at an unusual resolution.

The architectural consequence is that **the playback path must handle "this rendition does not exist yet"** — which is a real requirement that would never surface without doing the compute estimate.

Then two more ideas that shape the system.

**Adaptive bitrate is why a video is not a file.** A player must switch quality mid-playback as bandwidth changes, so each rendition is cut into segments of a few seconds, and a manifest lists them. The player fetches segment by segment and can change rendition at any boundary. **So the storage unit is a segment, the delivery unit is a segment, and the CDN caches segments** — which is ideal, because segments are large, immutable and content-addressed.

**View counting is a different system from playback.** A billion views a day at exact counts on one row per video is a hot-key problem on the most popular videos. And "views" is not even well defined — it is a product decision involving watch duration, bot filtering and per-user deduplication. **So counting is asynchronous, approximate at the top of the funnel, and reconciled.**

The framing to carry: **estimate compute before anything else, let the view skew make transcoding lazy, and treat the segment as the unit of everything.**`,
    analogyLimit:
      '"Video streaming is file serving from a CDN" is right about delivery and silent about the two hard parts. It hides that the file does not exist until an expensive compute pipeline produces it — in six variants, of which most are never watched — and it hides that a video is not one file but hundreds of segments across several renditions, with a manifest that must be generated and kept consistent with what actually exists.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team designs the upload pipeline as: client uploads the video to the API, which stores it, then synchronously transcodes it into 6 renditions before returning success. Uploads are 500 hours of video per minute, averaging 1 GB per source hour. Identify four failures and rank them.',
      answer: `**Failure 1 — the upload bandwidth through the API tier is infeasible.**

\`\`\`
500 hours/minute ÷ 60 = 8.3 source-hours/second
× 1 GB/hour = 8.3 GB/s sustained
× 3 for peak = ~25 GB/s = 200 Gb/s
\`\`\`

**200 Gb/s through a tier whose job is to authenticate and record metadata.** This is the blob-storage lesson's conclusion arriving again: the API returns a presigned URL and the client uploads **directly to object storage**, with the application never in the byte path.

**And multipart is not optional.** A 10 GB upload from a phone will fail partway; without resumable parts it restarts from zero, which makes large uploads effectively impossible on mobile connections.

**Failure 2 — synchronous transcoding makes the upload take hours.**

\`\`\`
A 1-hour video → 36 CPU-hours of transcoding
Even parallelised across 100 cores: ~22 minutes
\`\`\`

**The client holds a request for 22 minutes**, which no HTTP layer permits and no user tolerates. And the failure mode is total: a transcoding error at minute 20 fails the whole upload.

**The fix is that upload and transcoding are different lifecycles.** The upload completes and returns; the video enters a \`processing\` state; transcoding happens asynchronously; the video becomes playable when the first rendition is ready. **So the API must expose a status, and the product must show "processing" as a real state** — not an error and not a hidden delay.

**Failure 3 — the compute cost, and it is the largest failure by cost.**

\`\`\`
300 CPU-hours/second → ~1.08 million cores continuously
At 64 cores/machine: ~17,000 machines
\`\`\`

**17,000 machines doing nothing but transcoding**, permanently, for a workload where most output is never watched.

**Two fixes, and both are large.**

**Lazy transcoding.** Produce one rendition eagerly — say 720p — so the video is playable. Generate 1080p, 4K, 480p and the rest **on first request for that quality**, then cache the result. Given the view skew, this eliminates most of the work.

\`\`\`
If 90% of videos never get a request above 720p:
  eager cost = 6 CPU-hours/source-hour (one rendition)
  lazy cost  = 0.1 × 30 = 3 additional CPU-hours/source-hour
  → 9 rather than 36: a 4× reduction
\`\`\`

**And a further order of magnitude from hardware encoders**, which transcode far more efficiently than general-purpose CPUs. **Together these take 17,000 machines to perhaps 1,000** — which is the difference between viable and not.

**Failure 4 — transcoding a long video as one unit is fragile and slow.**

A 3-hour video is 108 CPU-hours as a single task. It holds a worker for hours, cannot be parallelised, and a crash at 90% restarts from zero.

**The fix is to transcode by segment.** Split the source into chunks — say 10 seconds each — transcode them independently and in parallel, then assemble the manifest. **A 3-hour video becomes 1,080 independent tasks**, each a few seconds of work, parallelisable across the fleet and individually retryable.

*And this is not merely an optimisation.* Adaptive-bitrate delivery requires segmented output anyway, so **transcoding by segment aligns the compute unit with the delivery unit** — the same boundaries serve both purposes.

**Ranked: the compute cost (failure 3) is the largest by far**, and it is the one the team did not know they had. The bandwidth (1) is an architectural impossibility with a known fix. The synchronous lifecycle (2) makes the product unusable. Segment-level transcoding (4) is what makes the compute tractable and parallel. **Only failure 1 is the one candidates usually lead with.**`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
A creator can upload a video of up to 12 hours
A creator can see upload and processing status
A viewer can play a video, seeking to any point
Playback adapts quality to available bandwidth
A viewer sees a view count and the creator sees watch-time analytics
A viewer can search for videos and see recommendations
A creator can delete a video, removing it from delivery
\`\`\`

**The clarifying questions that change this design:**

**How many renditions, and must all exist before playback?** *Six target renditions; only one must exist for the video to be playable.* This is the decisive answer — it licenses lazy transcoding, which is the largest cost decision.

**Is live streaming in scope?** *No.* Live changes the pipeline completely: transcoding must be real-time, segments are produced continuously, and there is no lazy option. **Answering yes would be a different design.**

**Must view counts be exact?** *No — approximate above 1,000, and consistent within a few minutes.* Permits asynchronous aggregation and removes a hot-key coordination problem.

**What is the view distribution?** *Extremely skewed — the top 1% of videos receive the large majority of views.* This is the fact the whole design rests on, and it should be asked explicitly rather than assumed.

**Is the catalogue bounded?** *No — unbounded and growing.* Rules out pre-positioning content the way a finite catalogue can.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Time to playable | Under 5 minutes for a 10-minute video | Segment-parallel transcoding of one rendition |
| Playback start latency | p99 under 2 s | Manifest and first segment from a CDN edge |
| Rebuffer rate | Under 1% of playback time | Adaptive bitrate with short segments |
| Availability (playback) | 99.99% | Playback must not depend on the upload or transcode path |
| Durability (source) | 11 nines | The source is irreplaceable; renditions are derived |
| Scale | 500 hours uploaded/minute, 5 billion views/day | See estimation |

**Out of scope:** the recommendation model, search ranking, monetisation, and content moderation — each of which is a system in its own right.

## Step 2 — Estimation

\`\`\`
Uploads:  500 hours/minute = 8.3 source-hours/second
          ~1 GB per source hour
          → 8.3 GB/s sustained, ~25 GB/s peak
Views:    5 billion/day → 58,000/s average, 175,000/s peak
          Average watch: 5 minutes at 3 Mbit/s = ~110 MB
\`\`\`

**Egress bandwidth, which is the largest operating cost:**

\`\`\`
5e9 views × 110 MB = 550 PB/day
÷ 100,000 s = 5.5 TB/s average, ~16 TB/s peak
\`\`\`

**16 TB/s is 128 Tb/s** — an amount of bandwidth that only exists as a CDN. **No origin serves this**, which is why the design is CDN-first rather than CDN-assisted.

**Storage:**

\`\`\`
Source:     8.3 GB/s × 100,000 s = 830 TB/day
Renditions (eager, 6 at 1.5× total): 1.25 PB/day
                              Total: ~2 PB/day
With erasure coding at 1.4×:         2.9 PB/day → ~1 EB/year

Lazy transcoding instead:
  1 rendition eagerly (~0.3× source) + 10% of the rest
  → 830 TB + 250 TB + 125 TB ≈ 1.2 PB/day → ~440 PB/year
\`\`\`

**Lazy transcoding halves storage as well as cutting compute**, which is the second benefit and is usually overlooked.

**Compute — the number nobody estimates:**

\`\`\`
Eager, 6 renditions: 8.3 source-h/s × 36 CPU-h = 300 CPU-h/s
                     = 1.08 million cores = ~17,000 machines
Lazy (1 + 10% of 5): 8.3 × 9 = 75 CPU-h/s
                     = 270,000 cores = ~4,200 machines
With hardware encoders (~10× more efficient):
                     → ~420 machines
\`\`\`

**17,000 machines to 420 — a 40× reduction from two decisions.** This is the estimate's most consequential output and it exists only because compute was estimated at all.

\`\`\`
View-count writes:
  175,000 views/s peak, each a counter increment
  Plus watch-time events: ~1 event per 10 s of playback
  5e9 views × 30 events = 150 billion events/day = 1.7 million/s
\`\`\`

**Watch-time events are 30× the view count**, so the analytics ingestion path is a larger write problem than view counting — worth separating.

## Step 3 — API design

\`\`\`
Upload
  POST /videos                          → 201 { videoId, uploadId }
  POST /videos/{id}/upload_urls         → { presignedUrls[], partSize }
  POST /videos/{id}/complete            → 200 { status: "processing" }
  GET  /videos/{id}/status              → { status, renditionsReady[] }

Playback
  GET  /videos/{id}/manifest.m3u8       → the ABR manifest
  GET  /segments/{renditionId}/{n}.ts   → a segment (from the CDN)

Engagement
  POST /videos/{id}/view                → 204  (fire and forget)
  POST /videos/{id}/heartbeat  { positionSec } → 204
  GET  /videos/{id}                     → metadata + view count
\`\`\`

**Five decisions worth defending.**

**Upload is three calls, not one.** Create the record, get presigned part URLs, complete. **The completion call is the only transaction** — before it the video does not exist; after it, the source is durable and processing begins. Same shape as the blob-storage lesson.

**Status is a first-class endpoint** because processing is a real state lasting minutes. **A product that hides it either lies or hangs.**

**The manifest is generated, not stored.** It lists only renditions that currently exist, so under lazy transcoding it grows as renditions are produced. **This is what makes lazy transcoding invisible to a compliant player** — the player only ever sees what is available.

**Segments are served by the CDN with immutable, long-lived caching.** They are content-addressed and never change, so \`max-age=31536000, immutable\` — the CDN lesson's ideal case. **A rendition change produces new segment URLs rather than invalidating old ones.**

**View reporting is fire-and-forget from the client.** No response needed, so it never blocks playback. **And it is client-reported, which means it is untrusted** — bot filtering happens server-side, which is why counts are approximate and reconciled.

## Step 4 — Data model

\`\`\`sql
videos(
  video_id,                     -- PARTITION KEY: hash(video_id)
  channel_id, title, description, duration_sec,
  status,                       -- uploading | processing | ready | failed
  source_ref, thumbnail_ref,
  created_at, deleted_at
)

renditions(
  video_id, rendition_id,       -- e.g. "720p", "1080p"
  status,                       -- pending | transcoding | ready | failed
  segment_count, bitrate, codec, manifest_ref,
  PRIMARY KEY (video_id, rendition_id)
)

segments(
  rendition_id, segment_index,
  storage_ref, duration_ms, byte_size,
  PRIMARY KEY (rendition_id, segment_index)
)

transcode_tasks(
  task_id, video_id, rendition_id, segment_range,
  status, attempts, priority,   -- lazy requests get high priority
  PRIMARY KEY (task_id)
)

-- View counting: approximate, in Redis, reconciled to a warehouse
views:{video_id}          → counter, aggregated periodically
viewers:{video_id}:{day}  → HyperLogLog for distinct viewers
\`\`\`

**Four decisions worth defending.**

**\`renditions\` has a per-rendition status**, which is what makes lazy transcoding expressible. The manifest generator reads it and lists only \`ready\` renditions.

**Segments are rows, not a blob list on the rendition.** A 12-hour video at 10-second segments is 4,320 segments per rendition; storing them as a list on one row makes that row large and makes per-segment retry awkward. **As rows they are individually addressable and retryable.**

**\`transcode_tasks\` carries a priority**, because a lazily-requested rendition is blocking a viewer while a background rendition is not. **Without priority, a viewer waits behind batch work** — which is the bulkhead argument from the backpressure lesson.

**View counts live in Redis and are reconciled to a warehouse.** The displayed count is approximate and eventually consistent; the authoritative count for creator payouts is computed from the event stream. **Two numbers with different requirements**, which is the counter lesson's distinction between a display value and a money value.

## Step 5 — Architecture

\`\`\`
UPLOAD
  Client ──▶ API ──▶ videos row, presigned URLs
  Client ══▶ Object store (source, direct, multipart)
  Client ──▶ API /complete ──▶ enqueue segment-split task

TRANSCODE
  Splitter ──▶ source into ~10 s chunks
      │
      ▼
  Task queue (priority: lazy-request > default > background)
      │
      ▼
  Transcode workers (hardware encoders) ──▶ segments to object store
      │
      ▼
  Manifest generator ──▶ rendition marked ready

PLAYBACK
  Player ──▶ CDN ──▶ manifest (short TTL)
  Player ══▶ CDN ══▶ segments (immutable, long TTL)
      │
      └──▶ (rendition missing) ──▶ API ──▶ enqueue high-priority task

ENGAGEMENT
  Player ──▶ view/heartbeat events ──▶ Kafka
      │
      ├──▶ Counter aggregator ──▶ Redis (approximate, displayed)
      └──▶ Warehouse ──▶ authoritative watch-time and payouts
\`\`\`

**Why the byte paths bypass the API:** 25 GB/s inbound and 16 TB/s outbound. The API handles only create, presign, complete and status.

**Why the transcode queue has priority classes.** A lazily-requested rendition has a viewer waiting; a background one does not — so three classes with separate worker allocations, or background work starves a viewer.

**Why the manifest has a short TTL while segments have a long one.** The manifest changes as renditions become ready; segments never change. **Caching them identically either makes new renditions invisible for a year or makes segment delivery uncacheable** — and the second is catastrophic at 16 TB/s.

## Step 6 — The deep dive: lazy transcoding and the playback path

**The mechanism.**

\`\`\`
On upload completion:
  1. Split the source into ~10 s chunks.
  2. Enqueue transcode tasks for ONE rendition (720p) at default priority.
  3. When all its segments are ready, mark the rendition ready and
     generate the manifest. Video becomes playable.
  4. Enqueue the other five renditions at BACKGROUND priority —
     but only for videos above a view threshold (below).

On playback:
  Player fetches the manifest, which lists only ready renditions.
  It selects a rendition it can see. It never requests a missing one.
\`\`\`

**So a compliant player is unaffected by lazy transcoding**, because the manifest is the contract and it only advertises what exists. **That is the property that makes this invisible rather than a degradation.**

**But the quality ceiling is visible.** A viewer on a fast connection watching a 720p-only video sees 720p. **Three triggers, in order of preference:**

**On demand, mid-playback.** The client signals it could use higher quality, which enqueues a high-priority transcode. The viewer continues at 720p and switches up when it arrives, because ABR permits switching at any segment boundary and the manifest is refetched periodically. **This exists only because ABR already supports mid-stream switching** — the lazy transcode reads as adaptive behaviour rather than a wait.

**On the first view.** Any view enqueues the remaining renditions at low priority. Simpler, and it wastes work on the many videos viewed once.

**At a view threshold.** After N views, produce the full ladder — **the default policy I would ship**, since it aligns compute with demand and the threshold is a tunable cost dial.

**The arithmetic of the threshold:**

\`\`\`
If 90% of videos never reach 100 views:
  Eager:  36 CPU-h per source hour
  Lazy:   6 (720p) + 0.1 × 30 = 9 CPU-h per source hour
  → 4× reduction
If the threshold is 10 views and 70% never reach it:
  6 + 0.3 × 30 = 15 CPU-h → 2.4× reduction
\`\`\`

**The threshold trades compute against first-viewer quality**, and it is derivable from the view distribution rather than guessed.

**Segment-parallel transcoding, and the one thing that makes it non-trivial.**

Splitting at arbitrary byte offsets does not work — video codecs have interdependent frames, so a segment must start at a **keyframe**. So the splitter must either find existing keyframes or force them at segment boundaries.

\`\`\`
Splitter: decode enough to locate keyframes, cut at the nearest one
          to each target boundary
→ segments are approximately 10 s, not exactly
→ the manifest records each segment's actual duration
\`\`\`

**This is why the manifest lists per-segment durations rather than assuming uniformity**, and it is a detail that only appears once you try to parallelise.

**And segments must be independently decodable**, which means each starts with a keyframe and does not reference frames outside itself. **That costs bitrate** — keyframes are large — so shorter segments mean better switching granularity and worse compression. **2–10 seconds is the usual range**, and it is a genuine trade rather than a default.

**Adaptive bitrate, and what the player actually does.**

\`\`\`
Manifest lists: 240p (400 kbit/s), 480p (1 Mbit), 720p (3 Mbit),
                1080p (6 Mbit), 4K (20 Mbit)
Player: measures throughput over recent segments
        estimates whether the next segment arrives before the buffer drains
        selects the highest rendition that fits
        switches at segment boundaries
\`\`\`

**The server does nothing adaptive.** All the logic is client-side, and the server's job is to make every rendition's segments independently fetchable. **That is why ABR scales: the intelligence is distributed to the players and the origin serves immutable files.**

**View counting, and why it is a separate problem.**

\`\`\`
175,000 views/s peak, concentrated on popular videos.
A single trending video can take 20,000 views/s → one hot counter.
\`\`\`

**Three mechanisms together:**

**Sharded counters for the hot case.** \`views:{video}:{0..15}\`, increment a random shard, read the sum. The Redis lesson's technique, and it removes the hot key.

**Approximate distinct viewers via HyperLogLog.** \`viewers:{video}:{day}\` at ~12 KB regardless of audience size, with ~0.8% error. **Exact distinct counting would need a set of every viewer id per video per day**, which is unaffordable.

**Event-stream reconciliation for the authoritative number.** Views and heartbeats go to Kafka, a warehouse computes watch time, bot filtering and payout-grade counts. **The displayed count is Redis; the money count is the warehouse**, and they differ.

**And "a view" is a product definition, not a technical one.** Typically: watched for more than N seconds, from a non-bot client, deduplicated per viewer per window. **All three checks happen downstream of the counter**, which is why the displayed count is provisional and can be revised downward.

## Step 7 — What breaks at 10×

**5,000 hours/minute uploaded, 50 billion views/day.**

**Egress becomes the dominant constraint at 160 TB/s.** *Fix:* this is beyond what a commercial CDN provides, so it becomes an owned-infrastructure problem — appliances inside ISP networks, as Netflix does. **But the catalogue is unbounded, so it cannot be pre-positioned wholesale**; only the popular tail can be pushed, which is a hybrid of pre-positioning and reactive caching.

**Transcoding at 10× is 4,200 machines even lazily.** *Fix:* raise the lazy threshold, reduce the rendition ladder for unpopular content, and use per-title encoding — analysing each video to choose bitrates rather than applying a fixed ladder. **A talking-head video needs far less bitrate than an action sequence at the same perceived quality.**

**Watch-time event ingestion becomes 17 million events/second.** *Fix:* client-side batching (one event per 30 seconds rather than 10) and sampling for analytics that do not need every event. **Payout-relevant events cannot be sampled**, which is why they are separated from analytics.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Transcode worker crashes mid-segment | One segment missing | Task retried; segments are independent so nothing else is affected |
| A rendition fails entirely | That quality unavailable | Manifest omits it; other renditions play. **Video is still watchable** |
| The one eager rendition fails | Video unplayable | Status \`failed\`, creator notified, retried with a different codec path |
| Source object lost | Irrecoverable | 11-nines durability on the source; renditions are derived and rebuildable |
| CDN edge down | Segments unavailable there | Other edges serve; the origin absorbs the shift |
| Origin down | Cache misses fail | Long segment TTLs mean most requests are hits; new videos unavailable |
| Redis view counters lost | Counts reset | **Rebuild from the event stream** — the warehouse is authoritative |
| Transcode queue backed up | Videos stay \`processing\` | Priority queue keeps lazy requests fast; background work delayed |

**Three rows carry the content.**

**A failed rendition degrades quality rather than availability**, because the manifest is generated from what exists. **This is lazy transcoding's failure model, obtained for free.**

**Source durability is the only irreplaceable data.** Every rendition can be regenerated from it, so the storage tiers differ: the source gets 11 nines and cold storage, renditions get less because they are derived.

**Lost view counters are rebuildable from the event stream**, which is why the counter is a cache rather than a store. **A design that made Redis authoritative would have lost data.**

## Step 9 — Defending it

**"I estimated compute first, and it changed the design.** Six renditions at 36 CPU-hours per source hour is a million cores permanently — plausibly the largest cost in the system, and the number nobody computes. Combined with the view skew, that makes lazy transcoding the central decision: one rendition eagerly so the video is playable, the rest at a view threshold. That is a 4× compute reduction and it halves storage too.

**The architectural consequence is that the playback path handles missing renditions**, and adaptive bitrate makes that invisible — the manifest advertises only what exists, and a lazily-produced rendition appears mid-playback as a quality improvement. **That property is why lazy transcoding is viable rather than a degradation.**

**I transcode by segment**, which aligns the compute unit with the delivery unit, makes a 12-hour video 4,320 parallel tasks instead of one 400-hour task, and makes every failure a single-segment retry. The complication is keyframe alignment, which is why segments are approximately rather than exactly 10 seconds.

**I made view counting three systems:** sharded counters for the hot path, HyperLogLog for distinct viewers at 12 KB per video, and an event stream to a warehouse for the authoritative payout number. The displayed count and the money count are different numbers with different requirements.

**What I gave up:** the first viewer of an unpopular video may see a lower quality ceiling; a lazily-triggered rendition takes minutes to appear; displayed view counts are approximate and can be revised downward after bot filtering; and processing is a visible product state lasting minutes.

**What would make me revisit it:** live streaming, which removes the lazy option entirely because transcoding must be real-time and there is no second chance. And if egress reached the point where commercial CDNs could not serve it, delivery would become owned infrastructure — and an unbounded catalogue cannot be pre-positioned the way a finite one can."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'pipeline',
      title: 'The pipeline, with lazy transcoding as the load-bearing decision',
      caption:
        'Step through it. The compute estimate is what makes the lazy branch necessary, and adaptive bitrate is what makes it invisible to the viewer.',
      nodes: [
        { id: 'client', label: 'Creator client', kind: 'client', x: 0, y: 200, detail: '25 GB/s peak inbound. Multipart presigned upload directly to object storage — a 10 GB upload from a phone must be resumable or it is impossible.' },
        { id: 'api', label: 'API: create, presign, complete', kind: 'service', x: 170, y: 90, detail: 'Small requests only. The completion call is the single transaction: before it the video does not exist, after it the source is durable and processing begins.' },
        { id: 'store', label: 'Object store: source', kind: 'store', x: 370, y: 90, detail: '830 TB/day. The only irreplaceable data in the system — every rendition is derived from it, so it gets 11-nines durability while renditions get less.' },
        { id: 'split', label: 'Splitter: ~10 s chunks at keyframes', kind: 'service', x: 370, y: 190, detail: 'Cuts must land on keyframes because codec frames are interdependent, so segments are approximately rather than exactly 10 s — which is why the manifest records per-segment durations.' },
        { id: 'queue', label: 'Priority queue', kind: 'store', x: 550, y: 190, detail: 'Three classes: a lazy request has a viewer waiting, the default rendition is time-sensitive, background renditions are not. Without priority, a viewer queues behind batch work.' },
        { id: 'work', label: 'Transcode workers (hardware encoders)', kind: 'service', x: 730, y: 190, detail: 'Eagerly: one rendition, ~6 CPU-hours per source hour. Eagerly all six would be 36, which is a million cores permanently — the estimate that forces the design.' },
        { id: 'manifest', label: 'Manifest: only ready renditions', kind: 'service', x: 730, y: 90, detail: 'Generated, not stored, and short-TTL cached. It advertises only what exists, so a compliant player never requests a missing rendition — this is what makes lazy transcoding invisible.' },
        { id: 'cdn', label: 'CDN: segments, immutable', kind: 'store', x: 550, y: 320, detail: '16 TB/s peak egress — an amount that only exists as a CDN. Segments are large, immutable and content-addressed, so `max-age` of a year with no invalidation ever needed.' },
        { id: 'lazy', label: 'Missing rendition → high-priority task', kind: 'note', x: 730, y: 320, detail: 'The viewer continues at the available quality and the new rendition appears mid-playback, because ABR switches at any segment boundary. It reads as adaptive behaviour, not as a wait.' },
      ],
      edges: [
        { id: 'y1', source: 'client', target: 'api', kind: 'sync' },
        { id: 'y2', source: 'client', target: 'store', kind: 'write' },
        { id: 'y3', source: 'api', target: 'split', kind: 'async' },
        { id: 'y4', source: 'split', target: 'queue', kind: 'write' },
        { id: 'y5', source: 'queue', target: 'work', kind: 'read' },
        { id: 'y6', source: 'work', target: 'manifest', kind: 'control' },
        { id: 'y7', source: 'work', target: 'cdn', kind: 'write' },
        { id: 'y8', source: 'cdn', target: 'lazy', kind: 'control' },
        { id: 'y9', source: 'lazy', target: 'queue', kind: 'write' },
      ],
      steps: [
        {
          id: 'yp1',
          title: 'The bytes never cross the API',
          description:
            '25 GB/s peak inbound through a tier that authenticates and records metadata is infeasible. Presigned multipart upload direct to object storage, with the completion call as the only transaction.',
          nodes: ['client', 'api', 'store'],
          edges: ['y1', 'y2'],
        },
        {
          id: 'yp2',
          title: 'Split at keyframes, transcode in parallel',
          description:
            'A 12-hour video becomes 4,320 independent tasks rather than one 400-CPU-hour job. Cuts must land on keyframes, so segment durations vary and the manifest records them.',
          nodes: ['split', 'queue'],
          edges: ['y3', 'y4'],
        },
        {
          id: 'yp3',
          title: 'One rendition eagerly, because six would be a million cores',
          description:
            '36 CPU-hours per source hour across six renditions is ~17,000 machines permanently, for a catalogue where most video is barely watched. One eager rendition plus a view threshold is a 4× reduction.',
          nodes: ['work'],
          edges: ['y5'],
        },
        {
          id: 'yp4',
          title: 'The manifest advertises only what exists',
          description:
            'Generated per request from the rendition table, short-TTL cached. A compliant player never asks for a missing rendition, which is what makes lazy transcoding invisible rather than a failure.',
          nodes: ['manifest', 'cdn'],
          edges: ['y6', 'y7'],
        },
        {
          id: 'yp5',
          title: 'And a missing quality becomes a mid-playback improvement',
          description:
            'A request for an absent rendition enqueues it at high priority; the viewer continues at the available quality and switches up when it arrives. ABR\'s existing switching capability is what makes this graceful.',
          nodes: ['lazy'],
          edges: ['y8', 'y9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'compute-arithmetic',
      title: 'The compute estimate nobody does',
      caption:
        'Two innocuous inputs — a rendition count and a transcoding speed — multiplied by upload volume, produce the largest line in the budget. And the view skew is what makes it avoidable.',
      code: `flowchart TB
    A["500 hours uploaded/minute<br/>= 8.3 source-hours/second"]
    B["6 renditions ×<br/>~6 CPU-hours each<br/>= 36 CPU-hours per source hour"]

    A --> C["8.3 × 36 = **300 CPU-hours<br/>per second**"]
    B --> C
    C --> D["= 1.08 million cores<br/>running continuously<br/>= **~17,000 machines**"]

    D --> E["**And the view distribution<br/>is extremely skewed** —<br/>most uploads are barely watched"]
    E --> F["So most of that million cores<br/>produces renditions<br/>nobody requests"]

    F --> G["**Lazy: 1 rendition eagerly,<br/>rest at a view threshold**<br/>6 + 0.1 × 30 = 9 CPU-h<br/>→ 4× reduction"]
    G --> H["**Plus hardware encoders**<br/>~10× more efficient<br/>→ ~420 machines total"]

    H --> I["**17,000 → 420 machines.**<br/>And it halves storage too.<br/>The cost: the playback path<br/>must handle a missing rendition"]

    style D fill:#2a1a1a,stroke:#a04848
    style G fill:#17272a,stroke:#35897e
    style I fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['netflix', 'youtube'],
    body: `Netflix's Open Connect is the most useful reference here precisely because its central decision is **unavailable** to this design, and understanding why is the lesson.

**Netflix pre-positions content.** Appliances inside ISP networks, filled overnight with what will be popular in that region tomorrow. By the time anyone presses play, the bytes are one hop away and nobody pays a cache miss.

**Three properties make that possible**, and they are worth stating because they are the exact inverse of a user-generated platform:

**A bounded, finite catalogue.** Thousands of titles, known in advance. **An unbounded catalogue growing by 500 hours a minute cannot be pre-positioned wholesale** — there is no "everything" to push.

**Forecastable demand.** A new episode's viewership is predictable to a useful accuracy. **User-generated content's view distribution is the opposite: unpredictable, extremely skewed, and mostly near zero.**

**Immutable, professionally-encoded content.** Every title is transcoded once, deliberately, with the rendition ladder chosen per title. **No lazy transcoding is needed because the catalogue is small enough to encode fully.**

**So the transferable conclusion is a question, not a technique: do I know what will be requested before it is requested?** Netflix answers yes and pre-positions. This design answers no and must cache reactively — **and the hybrid at 10× scale is to pre-position only the popular tail while everything else remains reactive.**

**Per-title encoding is the one Netflix technique that does transfer.** Rather than a fixed bitrate ladder, analyse each title and choose bitrates suited to its complexity — a talking-head scene needs far less bitrate than fast action for the same perceived quality. **That reduces both storage and egress**, and egress is this design's largest operating cost at 16 TB/s.

*And it composes with lazy transcoding:* analyse the content when producing the eager rendition, and use that analysis to choose the ladder if the video later crosses the view threshold.

**Where user-generated platforms differ most, and it is the compute.** Netflix's transcoding is a bounded batch problem over a known catalogue. **A platform ingesting 500 hours a minute has transcoding as a permanent, dominant, continuously-scaling cost** — which is why the compute estimate is the first thing to do here and barely matters there.

**The transferable questions:** do you know demand in advance, is your catalogue bounded, and have you estimated compute rather than only storage and bandwidth?`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, with the arithmetic where it settles the choice.',
    rows: [
      {
        option: 'Eager transcoding of the full ladder',
        whenItWins:
          'A small, curated catalogue where every title will be watched — the Netflix case.',
        whenItLoses:
          'User-generated content: 36 CPU-hours per source hour is ~17,000 machines permanently, most of it producing renditions nobody requests.',
        cost:
          'The largest line in the infrastructure budget, and double the storage.',
      },
      {
        option: 'Lazy transcoding with a view threshold',
        whenItWins:
          'Whenever the view distribution is skewed. A 4× compute reduction and roughly half the storage.',
        whenItLoses:
          'For content that must be available at full quality immediately — a paid premiere, say.',
        cost:
          'The first viewer may see a lower quality ceiling, and the playback path must handle a missing rendition.',
      },
      {
        option: 'Transcode the whole video as one task',
        whenItWins:
          'Short videos, where the task is a few minutes.',
        whenItLoses:
          'A 12-hour video is 400 CPU-hours in one task: unparallelisable, holds a worker for hours, and restarts from zero on a crash.',
        cost:
          'Latency proportional to duration, and total loss on failure.',
      },
      {
        option: 'Segment-parallel transcoding',
        whenItWins:
          'Always. 4,320 independent tasks, parallel across the fleet, each individually retryable — and it aligns the compute unit with the delivery unit.',
        whenItLoses:
          'Never, though keyframe alignment means segments are approximate rather than exact.',
        cost:
          'A splitter that must locate keyframes, and per-segment durations in the manifest.',
      },
      {
        option: 'Short segments (2 s)',
        whenItWins:
          'Fine-grained quality switching and fast startup, which matters on variable connections.',
        whenItLoses:
          'On compression — each segment needs a keyframe, and keyframes are large.',
        cost:
          'Higher bitrate for the same quality, and more requests per minute of playback.',
      },
      {
        option: 'Long segments (10 s)',
        whenItWins:
          'Better compression and fewer requests.',
        whenItLoses:
          'Coarser switching, so a bandwidth drop causes a longer period at the wrong quality.',
        cost:
          'Slower adaptation and a longer startup delay.',
      },
      {
        option: 'Exact view counts on one row',
        whenItWins:
          'Low-traffic videos.',
        whenItLoses:
          'A trending video at 20,000 views/second is a hot counter, and exactness requires coordination on the hottest key.',
        cost:
          'A serialisation point on the most popular content.',
      },
      {
        option: 'Sharded counters + HyperLogLog + warehouse reconciliation',
        whenItWins:
          'Always. Sharding removes the hot key, HyperLogLog gives distinct viewers at 12 KB regardless of audience, and the warehouse gives the payout-grade number.',
        whenItLoses:
          'Where an exact real-time count is a product requirement.',
        cost:
          'The displayed count is approximate and can be revised downward after bot filtering.',
      },
      {
        option: 'Pre-positioning content at edges',
        whenItWins:
          'A bounded catalogue with forecastable demand — nobody pays a cache miss, and filling happens off-peak.',
        whenItLoses:
          'An unbounded catalogue growing by 500 hours a minute; there is no "everything" to push.',
        cost:
          'Storage for content that may never be watched, plus a forecasting pipeline.',
      },
      {
        option: 'Reactive CDN caching',
        whenItWins:
          'Unbounded catalogues. The first viewer in a region pays a miss and everyone after hits.',
        whenItLoses:
          'At extreme egress, where even a commercial CDN cannot serve the volume.',
        cost:
          'A cache miss per region per popular object, and origin bandwidth to absorb it.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The client uploads to our API, which stores the file and kicks off transcoding."',
      whyWeak:
        'Two problems. 25 GB/s peak inbound through a tier doing authentication and a metadata write is infeasible. And a 10 GB upload from a phone will fail partway — without resumable multipart parts it restarts from zero, making large uploads impossible on mobile.',
      strongAnswer:
        '"The API returns presigned URLs and the client uploads multipart directly to object storage, so no byte crosses the control plane — 25 GB/s peak would otherwise be a serious network engineering problem for a tier doing an auth check. The completion call is the only transaction: before it the video does not exist, after it the source is durable and processing is enqueued."',
    },
    {
      weakAnswer: '"We transcode into 6 renditions on upload so every quality is available."',
      whyWeak:
        'It is the largest cost in the system and mostly wasted. 36 CPU-hours per source hour at 8.3 source-hours per second is around 17,000 machines running permanently — and given the view skew, most of that produces renditions nobody ever requests.',
      strongAnswer:
        '"Let me estimate the compute, because it is usually the dominant cost and rarely computed. Six renditions is 36 CPU-hours per source hour, which at this upload rate is a million cores permanently. Since the view distribution is extremely skewed, I would transcode one rendition eagerly so the video is playable and produce the rest at a view threshold — a 4× reduction, and it halves storage too. Hardware encoders take it down another order of magnitude."',
    },
    {
      weakAnswer: '"A long video is transcoded as a single job on a powerful machine."',
      whyWeak:
        'A 12-hour video is around 400 CPU-hours for one rendition. As one task it cannot be parallelised, holds a worker for hours, and a crash at 90% restarts from zero.',
      strongAnswer:
        '"Transcode by segment: split the source into roughly 10-second chunks at keyframe boundaries, transcode them independently and in parallel, then generate the manifest. A 12-hour video becomes 4,320 tasks of a few seconds each, individually retryable. And it is not just an optimisation — adaptive-bitrate delivery needs segmented output anyway, so this aligns the compute unit with the delivery unit."',
    },
    {
      weakAnswer: '"If a viewer requests 4K and it does not exist, we return an error and transcode it."',
      whyWeak:
        'A compliant player should never request a rendition that does not exist, because the manifest is the contract. Returning an error means the manifest advertised something absent — a bug rather than a lazy-transcoding case.',
      strongAnswer:
        '"The manifest is generated per request and lists only renditions currently marked ready, so a compliant player never asks for a missing one. If a viewer\'s client signals it could use a higher quality, that enqueues a high-priority transcode; the viewer continues at the available rendition and switches up when it arrives, because ABR permits switching at any segment boundary. It reads as adaptive behaviour rather than a wait — which is what makes lazy transcoding invisible."',
    },
    {
      weakAnswer: '"View counts are a counter column on the video row, incremented per view."',
      whyWeak:
        'A trending video at 20,000 views per second is a single hot row, and exact counting requires coordination on the most popular content. It also conflates the displayed number with the authoritative one used for payouts.',
      strongAnswer:
        '"Three mechanisms. Sharded counters in Redis — increment a random shard of 16, read the sum — which removes the hot key. HyperLogLog for distinct viewers at about 12 KB per video regardless of audience, since an exact set of viewer ids per video per day is unaffordable. And the event stream to a warehouse for the authoritative payout number after bot filtering and watch-duration rules. The displayed count is a cache; the money count is computed, and they differ."',
    },
    {
      weakAnswer: '"Segments and the manifest are both cached at the CDN with a long TTL."',
      whyWeak:
        'The manifest changes as renditions become ready — under lazy transcoding it changes for hours. A long TTL makes newly-available renditions invisible for the duration, so the lazy mechanism silently stops working.',
      strongAnswer:
        '"Different TTLs, because they have different mutability. Segments are immutable and content-addressed, so `max-age` of a year with `immutable` — and 16 TB/s egress means they must be cached aggressively or nothing works. The manifest is generated and changes as renditions become ready, so a short TTL of tens of seconds. Caching them identically either makes new renditions invisible or makes segment delivery uncacheable, and the second would be catastrophic."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hy-1',
      front: 'What cost do candidates almost always omit for a video platform?',
      back: 'Transcoding compute. Six renditions at ~6 CPU-hours each is 36 CPU-hours per source hour, which at 500 hours/minute is ~17,000 machines permanently.',
      topic: 'transcoding',
    },
    {
      id: 'fc-hy-2',
      front: 'What fact about the catalogue makes lazy transcoding possible?',
      back: 'The view distribution is extremely skewed — most uploads are barely watched, so eager transcoding produces renditions nobody requests.',
      topic: 'transcoding',
    },
    {
      id: 'fc-hy-3',
      front: 'What does lazy transcoding buy, and what does it cost?',
      back: 'A 4× compute reduction and roughly half the storage. It costs a lower quality ceiling for the first viewer, and the playback path must handle a missing rendition.',
      topic: 'transcoding',
    },
    {
      id: 'fc-hy-4',
      front: 'Why is lazy transcoding invisible to a compliant player?',
      back: 'The manifest is generated per request and lists only ready renditions, so the player never asks for one that does not exist.',
      topic: 'adaptive-bitrate',
    },
    {
      id: 'fc-hy-5',
      front: 'How does a lazily-triggered rendition reach a viewer already watching?',
      back: 'ABR switches at any segment boundary, so the new rendition simply becomes available on the next manifest fetch and quality improves mid-playback.',
      topic: 'adaptive-bitrate',
    },
    {
      id: 'fc-hy-6',
      front: 'Why must segment boundaries land on keyframes?',
      back: 'Codec frames are interdependent, so a segment must be independently decodable. This makes segments approximately rather than exactly the target duration.',
      topic: 'transcoding',
    },
    {
      id: 'fc-hy-7',
      front: 'What does segment length trade?',
      back: 'Short segments give finer quality switching and faster startup; long segments compress better because each needs a keyframe. Usually 2–10 seconds.',
      topic: 'adaptive-bitrate',
    },
    {
      id: 'fc-hy-8',
      front: 'Where does the adaptive logic live?',
      back: 'Entirely in the player. It measures throughput and selects a rendition; the server just makes every rendition\'s segments independently fetchable.',
      topic: 'adaptive-bitrate',
    },
    {
      id: 'fc-hy-9',
      front: 'Why do the manifest and the segments need different cache TTLs?',
      back: 'Segments are immutable, so a year with `immutable`. The manifest changes as renditions become ready, so tens of seconds — otherwise lazy transcoding silently stops working.',
      topic: 'cdn',
    },
    {
      id: 'fc-hy-10',
      front: 'Why does the transcode queue need priority classes?',
      back: 'A lazily-requested rendition has a viewer waiting; a background rendition does not. Without priority, a viewer queues behind batch work.',
      topic: 'upload-pipeline',
    },
    {
      id: 'fc-hy-11',
      front: 'What are the three view-counting mechanisms?',
      back: 'Sharded counters to remove the hot key, HyperLogLog for distinct viewers at ~12 KB per video, and an event stream to a warehouse for the authoritative payout number.',
      topic: 'view-counting',
    },
    {
      id: 'fc-hy-12',
      front: 'Why is the displayed view count different from the authoritative one?',
      back: '"A view" is a product definition — watch duration, bot filtering, per-viewer deduplication — all applied downstream. The display is a cache and can be revised downward.',
      topic: 'view-counting',
    },
    {
      id: 'fc-hy-13',
      front: 'Which data in the system is irreplaceable?',
      back: 'Only the source. Every rendition is derived from it, so the source gets 11-nines durability and renditions get less.',
      topic: 'upload-pipeline',
    },
    {
      id: 'fc-hy-14',
      front: 'Why can this design not pre-position content the way Netflix does?',
      back: 'Pre-positioning needs a bounded catalogue with forecastable demand. An unbounded catalogue growing by 500 hours a minute has no "everything" to push.',
      topic: 'cdn',
    },
  ],

  quiz: [
    {
      id: 'q-hy-1',
      kind: 'scenario',
      prompt:
        '500 hours of video uploaded per minute, 6 renditions, ~6 CPU-hours per rendition per source hour. What is the transcoding fleet, and what does it imply?',
      options: [
        { id: 'a', label: '~1.08 million cores (~17,000 machines) permanently — which given the skewed view distribution means most output is never watched, forcing lazy transcoding' },
        { id: 'b', label: 'About 1,000 cores, since transcoding is fast on modern hardware' },
        { id: 'c', label: 'It cannot be estimated without knowing the codec' },
        { id: 'd', label: 'Compute is negligible compared to storage and bandwidth' },
      ],
      correct: ['a'],
      explanation:
        '8.3 source-hours/second × 36 CPU-hours = 300 CPU-hours per second, which is 1.08 million cores. This is plausibly the largest line in the budget and it is the figure candidates omit — and it is what makes lazy transcoding a design decision rather than an optimisation.',
      difficulty: 'core',
      topic: 'transcoding',
    },
    {
      id: 'q-hy-2',
      kind: 'scenario',
      prompt:
        'A video has only a 720p rendition. A viewer on a fast connection opens it. What happens under this design?',
      options: [
        { id: 'a', label: 'The manifest lists only 720p, so the player plays it; a signal from the client enqueues a high-priority transcode and quality improves mid-playback when it arrives' },
        { id: 'b', label: 'The player requests 1080p, receives a 404, and retries' },
        { id: 'c', label: 'Playback is blocked until the full rendition ladder is produced' },
        { id: 'd', label: 'The player downscales the 720p stream to match its bandwidth' },
      ],
      correct: ['a'],
      explanation:
        'The manifest is the contract and advertises only ready renditions, so a compliant player never requests a missing one. Because ABR switches at any segment boundary, the lazily-produced rendition becomes available on the next manifest fetch and reads as adaptive behaviour rather than a wait.',
      difficulty: 'core',
      topic: 'adaptive-bitrate',
    },
    {
      id: 'q-hy-3',
      kind: 'scenario',
      prompt:
        'A 12-hour video is uploaded. Why must transcoding be segment-parallel rather than a single task?',
      options: [
        { id: 'a', label: 'One rendition would be ~400 CPU-hours in a single unparallelisable task that restarts from zero on a crash — segments give 4,320 independent retryable tasks' },
        { id: 'b', label: 'Because object storage cannot hold a file that large' },
        { id: 'c', label: 'Because the codec requires it' },
        { id: 'd', label: 'Because segment-parallel transcoding produces higher quality output' },
      ],
      correct: ['a'],
      explanation:
        'Time-to-playable would be hours and any failure would be total. Segmenting also aligns the compute unit with the delivery unit, since adaptive-bitrate delivery requires segmented output anyway — so the same boundaries serve both purposes.',
      difficulty: 'core',
      topic: 'upload-pipeline',
    },
    {
      id: 'q-hy-4',
      kind: 'scenario',
      prompt:
        'A trending video receives 20,000 views/second. What is wrong with incrementing a counter column on its row?',
      options: [
        { id: 'a', label: 'It is a single hot row, and exact counting requires coordination on the most popular content — sharded counters plus warehouse reconciliation avoid it' },
        { id: 'b', label: 'Nothing, since counter increments are cheap' },
        { id: 'c', label: 'The count would overflow' },
        { id: 'd', label: 'Views should not be counted in the database at all, only in logs' },
      ],
      correct: ['a'],
      explanation:
        'The hot-key problem: no amount of partitioning helps a single row. Sharding the counter into 16 keys and summing removes it, HyperLogLog gives distinct viewers cheaply, and the authoritative payout count comes from the event stream after bot filtering — three mechanisms for three different requirements.',
      difficulty: 'core',
      topic: 'view-counting',
    },
    {
      id: 'q-hy-5',
      kind: 'scenario',
      prompt:
        'A team caches the manifest with a one-year TTL alongside the segments. What breaks?',
      options: [
        { id: 'a', label: 'Newly-produced renditions become invisible for a year, so lazy transcoding silently stops working' },
        { id: 'b', label: 'Nothing — manifests are small and change rarely' },
        { id: 'c', label: 'Segments would be evicted to make room for manifests' },
        { id: 'd', label: 'Players would receive stale segment URLs' },
      ],
      correct: ['a'],
      explanation:
        'Under lazy transcoding the manifest changes for hours after upload as renditions complete. A long TTL means the player keeps seeing the original list, so the higher renditions are produced and never advertised. Segments are genuinely immutable and must keep their long TTL, because 16 TB/s egress requires aggressive caching.',
      difficulty: 'advanced',
      topic: 'cdn',
    },
    {
      id: 'q-hy-6',
      kind: 'multi',
      prompt:
        'Which properties make Netflix-style pre-positioning unavailable to this design? Select all that apply.',
      options: [
        { id: 'a', label: 'The catalogue is unbounded, growing by 500 hours per minute' },
        { id: 'b', label: 'Demand is unpredictable and extremely skewed toward near-zero' },
        { id: 'c', label: 'Renditions may not exist yet under lazy transcoding' },
        { id: 'd', label: 'Video segments cannot be cached at CDN edges' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Pre-positioning needs a bounded catalogue with forecastable demand and content that exists. The fourth is wrong and is the opposite: segments are the ideal CDN object — large, immutable and content-addressed — which is why reactive caching works well here even though pre-positioning does not.',
      difficulty: 'advanced',
      topic: 'cdn',
    },
  ],

  exercises: [
    {
      id: 'ex-hy-1',
      kind: 'estimate',
      title: 'Price the transcoding policy',
      estimatedMinutes: 40,
      prompt: `**Part 1.** Compute the transcoding compute and storage for four policies, given: 500 hours/minute uploaded, 1 GB per source hour, six renditions at 6 CPU-hours per source hour each, and this view distribution.

\`\`\`
50% of videos:  0 views
30%:            1–10 views
15%:            11–1,000 views
4%:             1,001–100,000 views
1%:             > 100,000 views
\`\`\`

Policies: **(a)** eager all six; **(b)** one eager, rest at 1 view; **(c)** one eager, rest at 1,000 views; **(d)** one eager, rest at 100,000 views.

**Part 2.** For each policy, say what the first viewer of a video in each distribution bucket experiences.

**Part 3.** Five consequences of policy (d) — transcoding the full ladder only for the top 1%.

Then answer:

- Which policy would you ship, and what changes your answer?
- The eager rendition is 720p. What would change if it were 360p, and if it were 1080p?
- What second-order cost does lazy transcoding introduce that the arithmetic above misses?`,
      rubric: [
        'Compute calculated per policy using the distribution to weight the lazy fraction.',
        'Storage calculated per policy, noting renditions are ~1.5× source in total.',
        'First-viewer experience stated per bucket per policy.',
        'Part 3 names at least four consequences beyond compute.',
        'Ships a policy with reasoning tied to a specific trade rather than to minimising compute.',
        'Eager-rendition-choice answer addresses both quality floor and compute.',
        'Identifies a genuine second-order cost the arithmetic omits.',
      ],
      modelAnswer: `**Part 1 — compute and storage per policy**

Baseline volume: **8.3 source-hours/second**, so any per-source-hour figure multiplies by 8.3 to give CPU-hours/second.

Assume the eager rendition (720p) costs 6 CPU-hours per source hour and the remaining five cost 30 together.

**Policy (a) — eager all six.**

\`\`\`
Compute: 36 CPU-h per source hour × 8.3 = 300 CPU-h/s
         = 1.08 M cores = ~17,000 machines
Storage: source 830 TB/day + renditions ~1.25 PB/day
         = ~2.1 PB/day → ~770 PB/year (before erasure coding)
\`\`\`

**Policy (b) — one eager, rest at 1 view.**

50% of videos get 0 views, so 50% never trigger the ladder.

\`\`\`
Compute: 6 + (0.50 × 30) = 21 CPU-h per source hour
         × 8.3 = 174 CPU-h/s = ~9,800 machines
Storage: source 830 TB + 720p ~250 TB + 50% of the rest ~500 TB
         = ~1.6 PB/day → ~580 PB/year
\`\`\`

**A 42% compute reduction from the cheapest possible threshold** — and it is entirely from the 50% of videos nobody watches at all.

**Policy (c) — one eager, rest at 1,000 views.**

Videos exceeding 1,000 views: the 4% bucket plus the 1% bucket = **5%**.

\`\`\`
Compute: 6 + (0.05 × 30) = 7.5 CPU-h per source hour
         × 8.3 = 62 CPU-h/s = ~3,500 machines
Storage: source 830 TB + 250 TB + 5% of the rest ~50 TB
         = ~1.13 PB/day → ~410 PB/year
\`\`\`

**A 4.8× compute reduction and a 47% storage reduction.**

**Policy (d) — one eager, rest at 100,000 views.**

Only the top **1%** qualifies.

\`\`\`
Compute: 6 + (0.01 × 30) = 6.3 CPU-h per source hour
         × 8.3 = 52 CPU-h/s = ~2,900 machines
Storage: source 830 TB + 250 TB + 1% ~10 TB
         = ~1.09 PB/day → ~400 PB/year
\`\`\`

**A 5.7× compute reduction.** And notice the returns are diminishing sharply:

\`\`\`
(a) → (b):  17,000 → 9,800   saves 7,200 machines
(b) → (c):   9,800 → 3,500   saves 6,300 machines
(c) → (d):   3,500 → 2,900   saves   600 machines
\`\`\`

**The move from (c) to (d) saves 17% of (c)'s fleet while degrading quality for the entire 4% bucket** — which is millions of videos with meaningful audiences. **That asymmetry is the answer to which policy to ship.**

**Part 2 — first-viewer experience per bucket**

| Bucket | (a) eager all | (b) at 1 view | (c) at 1,000 views | (d) at 100,000 views |
| --- | --- | --- | --- | --- |
| 0 views | — | — | — | — |
| 1–10 views | Full ladder | **First viewer sees 720p only**, triggers ladder | 720p only, forever | 720p only, forever |
| 11–1,000 | Full ladder | First viewer 720p, then full | 720p only, forever | 720p only, forever |
| 1,001–100k | Full ladder | First viewer 720p, then full | **~1,000th viewer triggers**, earlier ones capped at 720p | 720p only, forever |
| > 100k | Full ladder | First viewer 720p, then full | ~1,000th viewer triggers | **~100,000th viewer triggers** |

**Two things this table makes visible.**

**Policy (b)'s cost is borne by exactly one viewer per video** — the first — and then everyone else gets the full ladder. **That is a remarkably cheap price**, and it explains why (b) is attractive despite saving the least.

**Policy (d) permanently caps quality for 19% of videos that have real audiences** (the 15% and 4% buckets). A video with 50,000 views never gets above 720p. **That is a product decision, not an infrastructure one**, and it should be escalated rather than chosen by an engineer optimising compute.

**Part 3 — five consequences of policy (d)**

**1. 19% of videos with genuine audiences are permanently capped at 720p.** The 15% bucket (11–1,000 views) and the 4% bucket (1,001–100,000) never cross the threshold. **Cumulatively that is a large fraction of total watch time**, because although each video is small, there are many of them — and creators in that range are precisely the ones the platform wants to retain.

**2. The threshold creates a visible cliff.** A video at 99,000 views is 720p; at 100,001 it becomes 4K. **Creators will notice and complain**, and a hard threshold invites gaming. A smooth ramp — 480p and 1080p at 1,000, 4K at 100,000 — is better and is a straightforward refinement.

**3. Storage savings are negligible beyond policy (c).** 400 PB/year versus 410 PB/year is a 2.4% difference. **So policy (d) is not a storage decision at all** — it is a compute decision worth 600 machines, and the framing matters because someone will justify it on storage grounds.

**4. The lazy trigger becomes a latency spike on popular content.** When a video crosses 100,000 views it is, by definition, being watched heavily right then. **So the transcode is triggered at the moment of peak demand**, and the high-priority queue receives a burst of large jobs precisely when the platform is busiest. Policy (c)'s earlier threshold spreads this over a much larger number of smaller, less urgent events.

**5. Egress cost rises for capped videos.** 720p at 3 Mbit/s is more bandwidth than 480p at 1 Mbit/s, and a viewer on a slow connection watching a 720p-only video either buffers or gets a poor experience — **because the lower rungs of the ladder are missing too.** This is the consequence most easily overlooked: lazy transcoding removes the *low* renditions as well as the high ones, and the low ones are what serve constrained connections.

*And that suggests a refinement:* the eager set should be **two** renditions — a low one and a mid one — so constrained connections are always served. **Which changes the arithmetic and is a better design.**

---

**Which policy would I ship?**

**Policy (c) — the full ladder at 1,000 views — with two eager renditions rather than one.**

*The reasoning is the diminishing returns plus consequence 5.*

\`\`\`
(c) with one eager rendition:  3,500 machines
(c) with two eager (480p+720p, ~10 CPU-h):
     10 + (0.05 × 26) = 11.3 CPU-h per source hour
     × 8.3 = 94 CPU-h/s = ~5,200 machines
\`\`\`

**5,200 machines rather than 3,500 — a 1,700-machine premium** to guarantee that every video has a low-bitrate rendition for constrained connections. **That is worth it**, because a viewer on a poor connection with only 720p available has a bad experience on 95% of the catalogue.

*And versus policy (b) at 9,800 machines:* (c) saves 4,600 machines and costs quality for the 15% bucket. **That is the trade I would want a product owner to make**, and I would present it as: "for 4,600 machines we can give the full ladder to videos with more than 10 views instead of more than 1,000".

*Versus policy (d):* (d) saves 2,300 machines and permanently caps 19% of videos. **A poor trade**, and I would decline it.

**What changes my answer.**

**If the platform's differentiator is creator quality**, shift toward (b): the marginal machines buy quality for small creators, which is the growth strategy.

**If margins are the constraint**, shift toward (d) — but with a smooth ramp rather than a cliff, and with the two-rendition eager floor retained.

**If hardware encoders are available**, everything moves. A 10× efficiency gain makes policy (b) cost 980 machines, at which point **the cheapest threshold becomes affordable and the whole debate largely disappears.** So the highest-value investment is the encoder efficiency, not the threshold — which is worth saying, because it reframes the question.

**If the view distribution is measured rather than assumed**, the weights change and so does the answer. **I would want the real distribution before committing**, since the entire calculation hinges on the 50/30/15/4/1 split.

**What changes if the eager rendition is 360p or 1080p?**

**360p eagerly (~2 CPU-hours):**

\`\`\`
Policy (c): 2 + (0.05 × 34) = 3.7 CPU-h per source hour
            × 8.3 = 31 CPU-h/s = ~1,700 machines
\`\`\`

**Half the compute of a 720p floor.** And the cost is severe: **every video below the threshold is 360p only**, which on a modern display is visibly poor. 95% of the catalogue would look bad. **A large compute saving bought with the platform's perceived quality** — and perceived quality is the product.

*The one context where it is right:* a platform serving primarily low-bandwidth markets on small screens, where 360p is the common playback resolution anyway.

**1080p eagerly (~10 CPU-hours):**

\`\`\`
Policy (c): 10 + (0.05 × 26) = 11.3 CPU-h per source hour
            × 8.3 = 94 CPU-h/s = ~5,200 machines
\`\`\`

**1.5× the compute of a 720p floor**, and it also **increases egress cost**, which is the largest operating expense at 16 TB/s. A 1080p floor means viewers who would have received 720p now receive 6 Mbit/s instead of 3 — **potentially doubling bandwidth for a large share of playback**, which may exceed the compute saving in the other direction.

**That is the interesting finding: raising the eager rendition trades compute against egress, and egress is the bigger number.** So the eager rendition should be chosen with the egress consequence in mind, not only the transcode cost.

**And it explains why two eager renditions is better than one high one.** A low rendition plus a mid rendition lets the player choose, so constrained viewers get 480p and capable ones get 720p — **serving both without forcing everyone to the higher bitrate.**

**What second-order cost does the arithmetic miss?**

**The source must be retained and re-read for every lazy transcode**, and that has three costs the calculation above ignores.

**Storage tier.** Under eager transcoding, the source could be moved to cold archival storage immediately after processing — it is never needed again. **Under lazy transcoding the source must stay warm indefinitely**, because a video might cross the view threshold at any time. At 830 TB/day accumulating, the difference between warm and cold storage for the entire source catalogue is a substantial ongoing cost that partly offsets the compute saving.

*The mitigation:* move the source to cold storage after a period — say 90 days — and accept that a video crossing the threshold later requires a cold retrieval first, adding minutes to the lazy transcode. **Which is acceptable, because the lazy transcode already takes minutes.**

**Read bandwidth.** Each lazy transcode re-reads the full source: 1 GB per source hour. At policy (c), 5% of videos trigger a ladder, so 5% of 830 TB/day is ~42 TB/day of source reads — **not free, and it competes with nothing else, so it is manageable.** But at policy (b) it is 415 TB/day, which is a real load on the storage tier.

**Operational complexity, which is unquantifiable and real.** Lazy transcoding introduces: a per-rendition status model, a priority queue with three classes, a manifest generator that must stay consistent with what exists, a trigger mechanism with a threshold to tune, and a playback path that must handle a rendition appearing mid-stream. **Eager transcoding has none of that** — it is a pipeline that runs once per upload.

**So the honest accounting is:** lazy transcoding saves compute and storage, and it costs warm source retention, source read bandwidth, and a materially more complex system with more failure modes. **At 17,000 machines versus 5,200 the saving clearly justifies it.** At a tenth of the scale it very likely would not, and a smaller platform should transcode eagerly and keep the simple pipeline.

*Which is the transferable point: the same arithmetic that makes lazy transcoding essential at this scale makes it over-engineering at a smaller one*, and the threshold for adopting it is a scale question rather than a best-practice question.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hy-1',
      level: 'basic',
      question: 'Design YouTube. What do you estimate first?',
      guidance:
        'Compute, because it is the dominant cost and the one candidates omit. Look for the 36 CPU-hours per source hour figure and the fleet size it implies before any architecture is drawn.',
    },
    {
      id: 'iq-hy-2',
      level: 'basic',
      question: 'How does the upload path work?',
      guidance:
        'Presigned multipart direct to object storage, with a completion call as the only transaction and processing as a visible asynchronous state. A strong answer gives the inbound bandwidth that forbids an API byte path.',
    },
    {
      id: 'iq-hy-3',
      level: 'intermediate',
      question: 'Why transcode lazily, and what does it require of the playback path?',
      guidance:
        'The view skew means eager transcoding produces renditions nobody requests. It requires the manifest to advertise only ready renditions, and ABR makes a later rendition appear as a mid-playback improvement.',
    },
    {
      id: 'iq-hy-4',
      level: 'intermediate',
      question: 'Why is a video not stored as a single file?',
      guidance:
        'Adaptive bitrate needs segmented renditions so the player can switch mid-playback, and segmenting also parallelises transcoding. Look for keyframe alignment being named as the complication.',
    },
    {
      id: 'iq-hy-5',
      level: 'advanced',
      question: 'How do you count views at 175,000 per second with hot videos?',
      guidance:
        'Sharded counters, HyperLogLog for distinct viewers, and a warehouse for the authoritative number. Excellent answers distinguish the displayed count from the payout count and note that "a view" is a product definition.',
    },
    {
      id: 'iq-hy-6',
      level: 'advanced',
      question: 'Why can you not pre-position content the way Netflix does?',
      guidance:
        'Pre-positioning needs a bounded catalogue with forecastable demand. Excellent answers note the hybrid at extreme scale — push the popular tail, cache the rest reactively — and that per-title encoding does transfer.',
    },
    {
      id: 'iq-hy-7',
      level: 'followup',
      question: 'You said the manifest is cached. For how long, and why not like the segments?',
      guidance:
        'Tens of seconds versus a year. The manifest changes as renditions become ready, so a long TTL makes lazy transcoding silently stop working; segments are immutable and must be cached aggressively at 16 TB/s.',
    },
    {
      id: 'iq-hy-8',
      level: 'followup',
      question: 'Lazy transcoding saves compute. What does it cost that the compute figure hides?',
      guidance:
        'Warm source retention indefinitely, source read bandwidth per lazy transcode, and materially more system complexity. A strong answer notes that at a tenth of the scale eager transcoding would be the right choice.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hy-1',
      kind: 'what-changes-if',
      prompt:
        'This design handles uploaded video. Now change one thing: live streaming, where a creator broadcasts and viewers watch with a few seconds of delay. What survives, and what is replaced?',
      discussion: `Live removes the two properties the whole design rests on: **the source is not complete, and there is no second chance.**

**What is replaced entirely.**

**Lazy transcoding is impossible.** There is no "first request for 1080p later" — the stream exists now or not at all. **So every rendition must be transcoded in real time, concurrently**, which returns the full 36-CPU-hours-per-source-hour cost with no way to avoid it. The largest saving in the uploaded design is unavailable.

*And the compute must be provisioned for peak concurrent streams rather than for average upload volume*, which is a much less forgiving capacity problem: an unpopular stream still consumes a full transcoding slot.

**Transcoding must be faster than real time, per rendition.** A 1-second segment must be transcoded in under 1 second, or the stream falls behind and never catches up. **That is a hard latency requirement rather than a throughput one**, and it forces hardware encoders and dedicated capacity rather than a shared queue.

**Segment-parallel transcoding across the whole video is gone.** You cannot split what has not arrived. Segments are produced sequentially as they arrive, so the parallelism is **across renditions** rather than across time — six concurrent encoders per stream rather than 4,320 tasks.

**The manifest becomes a rolling window.** Instead of listing all segments, it lists the most recent few and is refetched every segment interval. **So the manifest is requested constantly** — once per segment per viewer — which makes it a high-volume object rather than a once-per-session one, and its caching becomes a genuine problem: it must be fresh and it is requested millions of times per second.

**Segment length becomes a latency decision.** Uploaded video uses 10-second segments for compression; live uses 1–2 seconds because **end-to-end latency is roughly three segment durations** (encode, publish, buffer). Shorter segments mean lower latency and worse compression and more requests.

**What survives.**

**The CDN delivery model**, and it matters more. Segments are still immutable once produced, so they cache normally — **the difference is that a live segment's useful life is seconds rather than years**, so the cache is churning constantly and hit rates depend on how many viewers are watching the same moment.

*And that concentration is favourable:* a live stream's viewers are all watching the same segment at the same time, so **cache hit rates for live are excellent** — far better than for a long-tail catalogue.

**Adaptive bitrate, unchanged.** The player logic is identical.

**Presigned direct ingest**, though now it is a continuous RTMP or WebRTC stream to an ingest server rather than a multipart upload.

**View counting**, with an addition: concurrent-viewer count becomes a headline metric and it is a different computation from cumulative views — a gauge rather than a counter, computed from active sessions.

**What is genuinely new.**

**Ingest is a stateful connection**, so it has the connection-ownership problem from the messaging lesson: which ingest server holds this stream, and what happens when the creator's connection drops mid-broadcast. **A dropped ingest is a visible outage for every viewer.**

**There is no retry.** An uploaded video's failed transcode is retried. A live segment that fails to transcode is **gone** — viewers see a gap. So the pipeline must be redundant rather than retryable: **two independent transcode paths per stream**, with the delivery layer taking whichever produces a valid segment.

*That doubles the compute cost again*, and it is why live transcoding is dramatically more expensive per hour than uploaded transcoding.

**Recording for later playback is a separate output.** Most platforms also produce a video-on-demand asset from the live stream, which means the live pipeline writes segments for immediate delivery *and* archives the source for later re-transcoding at higher quality. **Two different quality targets from one ingest.**

**What I would build.** A separate live pipeline sharing only the CDN and the player, because almost nothing else transfers. **And I would provision live transcoding as dedicated per-stream capacity rather than a shared queue**, since the latency requirement makes queueing unacceptable — a live encoder that waits is a stream that fails.

**The transferable point.** The uploaded design's central decision — lazy transcoding — depends entirely on being able to defer work until demand appears. **Live removes the ability to defer, so it removes the saving, and the cost structure inverts: uploaded video is cheap per hour and enormous in volume, while live is expensive per hour and bounded by concurrent streams.** Recognising that a requirement change eliminates your main optimisation, rather than merely complicating it, is the judgement being tested.`,
    },
    {
      id: 'al-hy-2',
      kind: 'debug',
      prompt:
        'A video platform built to this design has a complaint: some videos play at low quality for viewers with fast connections, and the platform\'s own dashboards show those videos have all six renditions marked ready. Rebuffer rates are normal. Diagnose it.',
      discussion: `Renditions are ready and quality is low for viewers who could support more. Rebuffer rates being normal is informative: **the player is not struggling — it is choosing a low rendition deliberately**, or it is not being offered the high ones.

**Hypothesis 1 — the manifest is cached stale, from before the higher renditions completed.** The manifest has a short TTL by design, but if a CDN or a client caches it longer, the player sees the original list containing only 720p. **The renditions exist and are not advertised.**

*Why it fits perfectly:* the platform's dashboards read the database (all six ready) and the player reads the manifest (one rendition). **The two sources disagree, which is exactly the reported symptom.**

*Why "some videos":* those whose manifests were fetched during the window between the eager rendition completing and the ladder completing, and then cached.

*Check:* fetch the manifest for an affected video through the CDN and compare against the database. **One comparison, and it is conclusive** — and it is the check nobody makes because the dashboard is trusted.

**Hypothesis 2 — the manifest cache key omits something, so one variant is served to everyone.** If the manifest URL is identical regardless of client capability, and one client's request populated the cache at a moment when fewer renditions existed, **every subsequent viewer gets that snapshot** until the TTL expires. Same effect as hypothesis 1, different mechanism.

*Check:* the manifest's cache headers and whether the CDN honours them. And whether the manifest is served with a \`Vary\` that fragments or unifies it incorrectly.

**Hypothesis 3 — the player's bandwidth estimate is wrong, and it is conservative by design.** ABR players start at a low rendition and ramp up as they measure throughput. **If the ramp is slow, or the first segments are large, a short viewing session never reaches the top rendition.**

*Why rebuffer rates are normal:* the player is being cautious, which is exactly what prevents rebuffering. **Low quality and no rebuffering is the signature of an over-conservative ABR ladder.**

*Check:* the distribution of rendition selections over playback position. If quality climbs steadily and most sessions end before it peaks, this is it — and the fix is a faster ramp or a higher starting rendition, not a pipeline change.

**Hypothesis 4 — the rendition ladder's bitrates are mislabelled.** The manifest declares each rendition's bitrate, and the player selects based on those declarations. **If the declared bitrate is higher than the actual encoded bitrate, the player believes it cannot afford a rendition it easily could.**

*How it happens:* a fixed ladder applied to content that encodes more efficiently than assumed. A talking-head video encoded at "6 Mbit/s 1080p" may actually be 2 Mbit/s, but the manifest says 6 and the player on a 4 Mbit/s connection declines it.

*Check:* declared versus actual bitrate per rendition for affected videos. **This is where per-title encoding would help**, and it is a real and common misconfiguration.

**Hypothesis 5 — the higher renditions are marked ready but their segments are missing or unfetchable.** If a rendition's status was set to ready before all its segments were verified, the player attempts it, fails to fetch a segment, and **falls back to a lower rendition** — which is correct ABR behaviour and looks like a quality problem.

*Why rebuffer rates are normal:* the fallback is fast and seamless.

*Check:* fetch every segment of a high rendition for an affected video. **And whether the ready status is set after verifying segment count and integrity**, or optimistically when the last task reports success.

**What I would check first: fetch the manifest through the CDN and compare it against the rendition table.** One request, and it separates the advertising problem (hypotheses 1, 2) from the selection problem (3, 4) from the integrity problem (5). **The dashboard reading the database is precisely why the discrepancy went unnoticed** — nobody was comparing the two.

**Then: declared versus actual bitrates** (hypothesis 4), because it is a single query and it is a systematic misconfiguration rather than a per-video accident.

**Why "rebuffer rates are normal" is the most useful clue.**

It rules out the entire class of explanation involving delivery problems — slow origins, CDN misses, network issues. **A player that cannot fetch fast enough rebuffers; a player choosing low quality does not.** So the fault is in what the player was offered or what it decided, not in delivery.

**And it means the symptom is invisible in every delivery metric**, which is why this ran long enough to become a complaint pattern rather than an alert.

**The observability changes this demands.**

**Compare the manifest against the rendition table, continuously.** A synthetic check per video sample: does the manifest advertise every rendition the database says is ready? **This single check catches hypotheses 1, 2 and 5**, and it does not exist because the two sources are owned by different parts of the system.

**Track the distribution of served rendition versus client-reported bandwidth.** A client on 20 Mbit/s receiving 720p is a data point that should be counted. **This is the outcome metric** — what quality did viewers actually get — as opposed to the mechanism metrics (renditions produced, segments served) that all look healthy.

**Alert on declared-versus-actual bitrate divergence**, which catches ladder misconfiguration before it degrades selection.

**Verify segment completeness before marking a rendition ready.** An optimistic ready status is a lie that the player discovers and silently works around.

**Transferable:** when an internal dashboard and the user's experience disagree, **the dashboard is measuring a different thing than the user sees** — here, the database's view of renditions rather than the manifest's. In any system where a derived artefact (a manifest, a cached page, a search index) mediates between the store and the user, **the artefact is what needs monitoring**, and comparing it against the store is the check that finds this class of bug.`,
    },
  ],

  revision: {
    bullets: [
      'Estimate compute first: six renditions at ~6 CPU-hours each is 36 per source hour, or ~17,000 machines permanently.',
      'The view distribution is extremely skewed, so eager transcoding produces renditions nobody requests.',
      'Lazy transcoding — one rendition eagerly, the rest at a view threshold — is a 4× compute reduction and halves storage.',
      'The manifest advertises only ready renditions, so lazy transcoding is invisible to a compliant player.',
      'ABR switches at any segment boundary, so a lazily-produced rendition appears as a mid-playback improvement.',
      'Transcode by segment: a 12-hour video becomes 4,320 retryable tasks rather than one 400-CPU-hour job.',
      'Segments must start at keyframes, so durations are approximate and the manifest records them.',
      'Short segments give finer switching and worse compression; 2–10 seconds is the usual range.',
      'All adaptive logic is client-side; the server just makes every rendition independently fetchable.',
      'Segments are immutable with a year-long TTL; the manifest changes and needs a short one.',
      'Caching the manifest like the segments makes lazy transcoding silently stop working.',
      'The transcode queue needs priority classes, or a waiting viewer queues behind background work.',
      'View counting is three systems: sharded counters, HyperLogLog for distinct viewers, and a warehouse for payouts.',
      '"A view" is a product definition — duration, bot filtering, deduplication — all applied downstream.',
      'Only the source is irreplaceable; every rendition is derived, so their durability requirements differ.',
      'A failed rendition degrades quality rather than availability, because the manifest is generated.',
      'Pre-positioning needs a bounded catalogue with forecastable demand, which user-generated content lacks.',
      'Lazy transcoding hides costs the compute figure omits: warm source retention, source reads, and complexity.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'An asynchronous pipeline turning uploaded source video into segmented adaptive-bitrate renditions delivered by CDN, with transcoding deferred until demand justifies it and view counting separated from playback.',
    whyItExists:
      'Because transcoding compute is the dominant cost and most uploaded video is barely watched, so producing the full rendition ladder eagerly spends the largest budget line on output nobody requests.',
    whenToUse: [
      'Lazy transcoding whenever the view distribution is skewed.',
      'Segment-parallel transcoding for any video long enough to make a single task slow.',
      'Adaptive bitrate whenever viewers have variable bandwidth.',
      'Sharded counters and HyperLogLog for engagement metrics on popular content.',
    ],
    whenNotToUse: [
      'Lazy transcoding for live streaming, where work cannot be deferred.',
      'Lazy transcoding at small scale, where the complexity exceeds the saving.',
      'Bytes through the control plane, at any meaningful volume.',
      'Pre-positioning for an unbounded catalogue.',
      'Exact real-time view counts on a single row.',
    ],
    alternatives: [
      'Eager transcoding, for a bounded curated catalogue.',
      'Per-title encoding, choosing bitrates from content complexity rather than a fixed ladder.',
      'Pre-positioning at ISP edges, when the catalogue is finite and demand forecastable.',
      'Hardware encoders, which are roughly an order of magnitude more efficient than CPUs.',
      'A dedicated real-time pipeline for live, sharing only the CDN and player.',
    ],
    tradeoffs: [
      'Lazy transcoding buys a 4× compute reduction and costs first-viewer quality plus warm source retention.',
      'A higher view threshold buys less compute and permanently caps quality for more videos.',
      'A higher eager rendition buys quality and costs both compute and egress, the larger of the two.',
      'Short segments buy switching granularity and cost compression efficiency.',
      'Segment-parallel transcoding buys parallelism and retryability and costs keyframe-alignment complexity.',
      'Approximate view counts buy removal of a hot key and cost a displayed number that can be revised.',
    ],
    failureModes: [
      'Uploading through the API tier, at an infeasible bandwidth for an auth check.',
      'Synchronous transcoding holding a request for tens of minutes.',
      'Eager full-ladder transcoding as the dominant and largely wasted cost.',
      'A single transcode task per video, unparallelisable and restarting from zero.',
      'Segments cut at arbitrary offsets rather than keyframes, producing undecodable output.',
      'The manifest cached with a long TTL, making newly-ready renditions invisible.',
      'No priority in the transcode queue, so a waiting viewer sits behind background work.',
      'A counter column on the video row, hot on trending content.',
      'The displayed view count treated as authoritative for payouts.',
      'A rendition marked ready before its segments are verified, causing silent player fallback.',
      'Warm source retention overlooked when costing lazy transcoding.',
      'Dashboards reading the rendition table while players read the manifest, so the two diverge unnoticed.',
    ],
    followUpQuestions: [
      'What is the transcoding compute, in cores?',
      'What does the view distribution look like, and have you measured it?',
      'Which renditions are produced eagerly, and why those?',
      'What triggers a lazy rendition, and what does the viewer experience meanwhile?',
      'How long are segments, and what does that trade?',
      'Do segment boundaries land on keyframes?',
      'What are the manifest and segment cache TTLs, and why do they differ?',
      'Does the transcode queue have priority classes?',
      'Which number is displayed as views, and which is used for payouts?',
      'What is irreplaceable, and what is derived?',
      'What compares the manifest against what actually exists?',
    ],
  },
});
