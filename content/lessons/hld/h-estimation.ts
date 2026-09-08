import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-estimation',
  title: 'Capacity, traffic and storage estimation',
  summary:
    'Six memorised numbers and four round-number tricks let you derive QPS, storage, bandwidth and machine count out loud in three minutes — and the point of the arithmetic is to eliminate designs, not to be right.',
  phase: 'hld',
  module: 'method',
  position: 40,
  kind: 'method',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['estimation', 'capacity-planning', 'latency-numbers', 'arithmetic', 'sizing'],
  prerequisites: ['h-requirements'],
  resources: [
    {
      key: 'latency-numbers',
      tier: 'must',
      note: 'Memorise the order of magnitude of every line. You will not be able to look these up, and every estimate in this lesson starts from one of them.',
    },
    {
      key: 'ddia-book',
      tier: 'must',
      note: 'Read the chapter on describing performance for why percentiles rather than averages, and the storage chapters for the write-amplification factors that make a naive storage estimate wrong.',
    },
    {
      key: 'system-design-primer',
      tier: 'must',
      note: 'Read its "powers of two" and "latency numbers" sections and then do a few of its worked problems, checking your derivation against theirs before reading the answer.',
    },
    {
      key: 'google-sre-book',
      tier: 'good',
      note: 'Read the capacity-planning material for why you provision for peak plus headroom rather than for average, and for how demand forecasting interacts with the numbers you derive here.',
    },
    {
      key: 'birthday-problem',
      tier: 'good',
      note: 'The arithmetic behind "how large must my key space be before collisions matter". Needed whenever you size an id, a short code, or a hash.',
    },
    {
      key: 'prometheus-histograms',
      tier: 'advanced',
      note: 'Read it as a reminder that the number you estimate must match the number you will later measure — an estimate of average latency cannot be validated against a p99.',
    },
  ],

  intuition: {
    body: `Estimation in a design interview is not a maths test. **Its purpose is to eliminate designs**, and it is finished the moment enough options are eliminated.

That reframing changes how you do it. If the answer is "roughly 600,000 reads per second", then any design serving reads from a relational database is out and you have the information you needed. Computing 583,333 rather than 600,000 eliminates nothing further, so the extra precision is waste.

**Round aggressively, and round in a direction you can defend.** The rule: keep one significant figure and use powers of ten.

Four tricks make the arithmetic fast enough to do out loud:

**100,000 seconds per day.** The real figure is 86,400. Using 100,000 makes every division trivial and errs by 16% — far inside the precision that matters. So *a million events a day is 10 per second.*

**2.5 million seconds per month, 30 million per year.** For storage growth.

**Powers of two for sizes.** 2^10 is a thousand, 2^20 a million, 2^30 a billion. So a 4-byte integer times a billion rows is 4 GB, computed in your head.

**Peak is 2–3× average.** Always provision for peak. A design that works at average and falls over at peak works for two hours a day.

Then **six numbers to have memorised**, because every estimate begins from one of them:

\`\`\`
Memory read              ~100 ns
SSD random read          ~100 µs      (1,000× memory)
Network round trip, same datacentre  ~500 µs
Disk (spinning) seek     ~10 ms
Network round trip, cross-continent  ~150 ms
Sequential read is ~100× faster than random, on any medium
\`\`\`

**The most useful consequence of that list: memory is a thousand times faster than SSD, and SSD is a hundred times faster than a network round trip across the world.** Those two ratios decide most designs — they are why a cache exists, and why a cross-region synchronous write is a different system from a same-region one.

And the arithmetic that catches the most errors: **does it fit on one machine?** A modern server has hundreds of gigabytes of memory and tens of terabytes of storage, and it will do tens of thousands of simple operations per second. **Many systems that candidates shard would fit comfortably on one machine**, and checking is a ten-second calculation that prevents an over-engineered answer.

The framing to carry: **estimate to eliminate, round to one significant figure, always compute the peak, and check whether one machine would do.**`,
    analogyLimit:
      'Treating estimation as a calculation to get right is the error. The output is not a number, it is a set of eliminated designs — so precision beyond the point where options stop being eliminated is wasted time, and a candidate who computes to three significant figures has misunderstood the exercise. The framing also hides the direction of the answer: sometimes the correct conclusion is "this fits on one machine", and producing that confidently is harder than producing a distributed design.',
  },

  deepExplanation: {
    predict: {
      question:
        'Estimate the storage for a photo-sharing service: 500 million daily active users, each uploading 2 photos a day, photos average 3 MB, kept forever, with three replicas. Then say why the naive answer is wrong by a large factor, and what the real figure is.',
      answer: `**The naive calculation, which most candidates produce.**

\`\`\`
Uploads/day  = 500M × 2 = 1 billion photos/day
Raw bytes    = 1e9 × 3 MB = 3 PB/day
Per year     = 3 PB × 365 ≈ 1,100 PB ≈ 1.1 EB/year
With 3×      = 3.3 EB/year
\`\`\`

**That number is wrong in both directions, by large factors, for four reasons.**

**Error 1 — the derived variants are usually larger than the original.** Nobody serves a 3 MB photo to a phone. A real service generates several sizes: a thumbnail, a feed-sized version, a full-screen version, perhaps a video-preview frame. Those are typically 5% to 30% of the original in total.

But that is not the big one. **The big one is that the original is often kept at full resolution *and* the derived versions are what actually get served**, so storage is original plus variants:

\`\`\`
Original 3 MB + variants ~0.6 MB ≈ 3.6 MB per photo  (×1.2)
\`\`\`

**Error 2 — 3× replication is probably wrong, and erasure coding is the reason.** At exabyte scale, nobody stores three full copies. Erasure coding with, say, 10 data and 4 parity fragments gives comparable durability at **1.4× overhead rather than 3×.**

\`\`\`
3× replication:   3.6 MB × 3   = 10.8 MB per photo
Erasure coding:   3.6 MB × 1.4 = 5.0 MB per photo
\`\`\`

**That single decision more than halves the storage bill**, and at these volumes it is the largest cost decision in the system. A candidate who assumes 3× has assumed a design rather than estimated.

**Error 3 — the retention assumption is doing enormous work and was not questioned.** "Kept forever" times "growing daily" is an unbounded number, and every real service tiers storage:

\`\`\`
Recent 30 days:  hot storage (SSD, fast access)
30 days – 1 yr:  warm
Older than 1 yr: cold / archival, minutes to retrieve
\`\`\`

**Access to photos falls off very steeply with age** — most views are of very recent content. So the *hot* storage figure, which is what determines the expensive infrastructure, is a tiny fraction of the total:

\`\`\`
Hot (30 days) = 1e9/day × 30 × 5.0 MB ≈ 150 PB
Total (1 year) ≈ 1.8 EB, mostly cold
\`\`\`

**150 PB hot and 1.8 EB cold are different problems with different costs**, and reporting one number conflates them.

**Error 4 — the peak upload rate was never computed, and it sizes the ingest path.**

\`\`\`
1e9 uploads/day ÷ 100,000 s = 10,000 uploads/s average
Peak 3×                      = 30,000 uploads/s
Bandwidth at peak            = 30,000 × 3 MB = 90 GB/s inbound
\`\`\`

**90 GB/s of inbound bandwidth is the number that actually constrains the design.** It is roughly 720 Gb/s, which is a serious network engineering problem and the reason uploads go directly to object storage via presigned URLs rather than through an application tier. **The storage total tells you the cost; the peak bandwidth tells you the architecture.**

**The corrected answer, stated the way it should be said aloud:**

> "1 billion photos a day at 3 MB is 3 PB of originals daily. Variants add about 20%, so 3.6 PB. At exabyte scale I would use erasure coding at roughly 1.4× rather than 3× replication, giving about 5 PB a day, so **1.8 EB a year** — but the number that matters is that only the last 30 days need to be hot, which is **about 150 PB**, and the rest tiers to cold storage.
>
> The constraint I actually care about is ingest: 30,000 uploads a second at peak is **90 GB/s inbound**, which means uploads must go straight to object storage with presigned URLs and never through an application tier."

**The general lesson.** The naive figure was wrong by a factor of two in one direction from the replication assumption, and by a factor of ten in the other from conflating hot and cold. **The four corrections are all *modelling* corrections rather than arithmetic ones** — variants, replication scheme, tiering, and computing the peak. Estimation errors are almost never arithmetic; they are omitted factors.`,
    },
  body: `## The numbers to memorise

**Latency, in orders of magnitude:**

| Operation | Time | Relative |
| --- | --- | --- |
| L1 cache reference | ~1 ns | 1 |
| Main memory reference | ~100 ns | 100 |
| SSD random read | ~100 µs | 1,000× memory |
| Network round trip, same datacentre | ~500 µs | 5× SSD |
| Spinning-disk seek | ~10 ms | 100× SSD |
| Network round trip, cross-continent | ~150 ms | 1,500× same-datacentre |

**The two ratios that decide designs:** memory is ~1,000× faster than SSD, and a cross-continent round trip is ~1,500× a local one. The first is why caches exist; the second is why a synchronous cross-region write is a different architecture.

**Throughput, roughly:**

\`\`\`
Sequential SSD read       ~1–3 GB/s
Sequential HDD read       ~150 MB/s
Datacentre network link   10–100 Gb/s  = 1.2–12 GB/s
Sequential is ~100× faster than random, on any medium
\`\`\`

**Capacities of one modern server:**

\`\`\`
Memory        128 GB – 1 TB
SSD           2 – 30 TB
CPU           32 – 128 cores
Network       10 – 100 Gb/s
\`\`\`

**Software throughput, order of magnitude:**

\`\`\`
Simple key-value read from memory (Redis)   ~100,000/s per instance
Indexed relational read                     ~10,000/s per instance
Relational write with fsync                 ~1,000–10,000/s
HTTP request through an app framework       ~1,000–10,000/s per instance
\`\`\`

Those last figures are deliberately rough. Their value is comparative: **an in-memory read is ten times a database read, which is ten times a durable write.** That ordering is what you reason with.

## The four round-number tricks

**Seconds:**

\`\`\`
1 day   ≈ 100,000 s    (really 86,400 — 16% high, fine)
1 month ≈ 2.5 million s
1 year  ≈ 30 million s
\`\`\`

So: **1 million/day = 10/s. 1 billion/day = 10,000/s.** Those two conversions cover most prompts.

**Powers of two:**

\`\`\`
2^10 ≈ 1 thousand      2^20 ≈ 1 million       2^30 ≈ 1 billion
2^32 ≈ 4 billion        2^40 ≈ 1 trillion
\`\`\`

So a 4-byte integer per row × 1 billion rows = 4 GB. And 2^32 ≈ 4 billion is worth knowing because it is where 32-bit ids run out.

**Peak multiplier: 2–3× average.** Higher for a consumer product with a daily rhythm, lower for a global service with users in every timezone. **State the multiplier you used**, because it is an assumption.

**Data sizes, as defaults when not told:**

\`\`\`
A small record (id, a few fields)  ~100 bytes – 1 KB
A tweet-sized text row             ~300 bytes
A user profile row                 ~1 KB
A photo                            ~1–5 MB
A minute of 1080p video            ~50 MB
A UUID                             16 bytes binary, 36 chars as text
\`\`\`

## Deriving QPS

**From daily active users:**

\`\`\`
QPS_avg  = DAU × actions_per_user_per_day ÷ 100,000
QPS_peak = QPS_avg × 3
\`\`\`

Worked: 100 million DAU, 20 actions each.

\`\`\`
2 billion actions/day ÷ 100,000 = 20,000/s average → 60,000/s peak
\`\`\`

**Then split reads from writes**, because they have different costs and usually a large ratio:

\`\`\`
If 50:1 read-heavy:  ~59,000 reads/s peak, ~1,200 writes/s peak
\`\`\`

**That split is the most consequential line in most estimates.** 1,200 writes per second is a single well-provisioned database; 59,000 reads per second is not, and must be served from memory. **The asymmetry tells you where the design effort goes.**

**The check nobody does:** is the derived QPS plausible? 60,000 requests per second means roughly 6–60 application instances at 1,000–10,000 requests each. If your answer implies 5,000 instances, an input is wrong.

## Deriving storage

\`\`\`
Storage/day = writes/day × bytes_per_write × amplification
Total       = storage/day × retention_days
\`\`\`

**The amplification factor is where estimates go wrong**, and it is the sum of several things candidates omit:

| Factor | Typical multiplier |
| --- | --- |
| Indexes | 1.2–2× the raw data |
| Replication (3 copies) | 3× |
| Erasure coding instead | 1.4× |
| Derived variants (thumbnails, transcodes) | 1.1–2× |
| Backups and snapshots | 1.5–3× |
| MVCC dead rows before vacuum | 1.2–2× |
| Free-space and fragmentation headroom | 1.3× |

**Naive raw bytes can be off by 5–10×** once these are included, which is why an estimate that produces "exactly 2 PB" is less credible than one that produces "a few petabytes, with the multipliers being replication and indexes".

**And tier it.** Hot storage is the expensive infrastructure, and it is usually a small fraction of the total because access falls off steeply with age. **Report hot and total separately**; a single number conflates two different cost decisions.

## Deriving bandwidth

\`\`\`
Bandwidth = QPS × bytes_per_response
\`\`\`

Trivial arithmetic, frequently the binding constraint, and almost always skipped.

Worked: 59,000 reads/s of a 2 KB response.

\`\`\`
59,000 × 2 KB ≈ 120 MB/s ≈ 1 Gb/s.  Comfortable.
\`\`\`

Now the same QPS with a 3 MB photo:

\`\`\`
59,000 × 3 MB ≈ 177 GB/s ≈ 1.4 Tb/s.  Not comfortable.
\`\`\`

**That difference is why media is served from a CDN and JSON is not.** The bandwidth calculation is what forces it, and it takes ten seconds.

## Deriving memory and the working set

**The question that decides whether a cache is viable: does the working set fit in memory?**

\`\`\`
Working set = active_items × bytes_per_item
\`\`\`

Worked: 100 million users, each with a 1 KB session, 10% active in any hour.

\`\`\`
10 million × 1 KB = 10 GB.  Fits on one machine comfortably.
\`\`\`

Versus caching every photo:

\`\`\`
1 billion photos × 3 MB = 3 PB.  Does not fit anywhere in memory.
\`\`\`

**So sessions are cached and photos are not** — photos go to a CDN, which is a disk-backed cache near the user. **The memory calculation is what distinguishes those two answers**, and it is why "add a cache" is not a design until you have done it.

## Deriving concurrency and machine count

**Concurrency from Little's Law**, which the backpressure lesson established:

\`\`\`
concurrent_requests = QPS × latency
\`\`\`

Worked: 10,000 requests/s at 50 ms.

\`\`\`
10,000 × 0.05 = 500 concurrent requests
\`\`\`

**That is the number that sizes thread pools, connection pools and instance counts** — not QPS. And the consequence worth internalising: **if latency doubles, concurrency doubles at the same request rate.** A dependency slowing from 50 ms to 500 ms turns 500 concurrent into 5,000, which is how a slowdown exhausts a pool.

**Machine count:**

\`\`\`
instances = QPS_peak ÷ QPS_per_instance × (1 + headroom)
\`\`\`

Worked: 60,000 peak at 3,000 per instance, with 50% headroom for failures and growth.

\`\`\`
60,000 ÷ 3,000 = 20 → 30 instances
\`\`\`

**Headroom is not optional.** Provisioning exactly at peak means the first instance failure is an incident, and it leaves nothing for growth between capacity reviews. **N+2 across at least two zones** is the usual floor.

## The one-machine check

Before proposing anything distributed, ask: **would one machine do?**

\`\`\`
Storage:  does the data fit in 10 TB?
Memory:   does the working set fit in 256 GB?
QPS:      is it under ~10,000?
Writes:   is it under ~5,000/s?
\`\`\`

If all four are yes, **one machine plus a replica is the correct answer**, and proposing a partitioned distributed system is over-engineering that the estimate has already disproved.

Concretely: an internal tool with 5,000 users, an events table growing 200 MB a month, and 50 requests per second is one PostgreSQL instance. **Producing that answer confidently is harder than producing a distributed one**, and it is the stronger answer.

## Key-space sizing

Whenever you invent an id or a short code, check the space against demand.

\`\`\`
space = alphabet_size ^ length
\`\`\`

\`\`\`
6 chars, [a-z0-9] (36):    36^6  ≈ 2.2 billion
8 chars, [a-z0-9] (36):    36^8  ≈ 2.8 trillion
UUID v4:                   2^122 ≈ 5.3e36
Snowflake-style 64-bit:    time + machine + sequence
\`\`\`

**And collisions matter long before the space is full.** By the birthday argument, random collisions become likely around the **square root** of the space: with a 2.2-billion space, that is roughly 47,000 codes. Below that, collisions are rare enough that one retry on a unique-constraint violation is sufficient; well above it, retries dominate.

**The rule: keep occupancy below a few percent**, and check the twenty-year demand rather than today's.

## Estimating out loud

The delivery matters as much as the arithmetic, because the interviewer is assessing whether you reason with magnitudes.

**State each assumption as you use it.** "I will assume 500 million daily active users — stop me if that is wrong."

**Say the conclusion, not just the number.** Not "600,000 reads per second" but "600,000 reads per second, which means this cannot be served from a relational database — it has to come from memory." **The conclusion is the point; the number is the working.**

**Write the numbers where they can be seen**, so you can point back to them when defending a decision three steps later.

**Round visibly.** "86,400 seconds in a day — I will call it 100,000, it makes the division easier and the error does not matter." That sentence demonstrates that you know you are approximating, which is better than appearing to be wrong.

**Three minutes, not eight.** If the estimate is taking longer, you are being too precise or estimating something that changes nothing.

## Where estimation goes wrong

**Omitted factors, not arithmetic.** Replication, indexes, variants, backups, dead rows. **Naive raw bytes is routinely 5–10× low.**

**Estimating the average and designing for it.** Peak is 2–3×, and the system must work at peak.

**Conflating hot and total storage.** They are different cost decisions.

**Never computing bandwidth.** It is often the binding constraint and it is one multiplication.

**Confusing QPS with concurrency.** QPS × latency is what sizes pools, and it is the quantity that explodes when a dependency slows.

**Assuming a design inside the estimate.** "3× replication" is a design choice, not a fact — say it as an assumption or the estimate has smuggled in a decision.

**Computing and then not using it.** The framework lesson's point: a number that eliminates a design, followed by that design, is worse than no number at all.

**Being too precise.** 583,333 and 600,000 eliminate the same designs. The extra digits cost time and buy nothing.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'derivation-chain',
      title: 'One input, six derived numbers, and what each eliminates',
      caption:
        'Read the right column. Each derived figure removes design options, and the estimate is finished when enough are removed — not when the arithmetic is precise.',
      code: `flowchart TB
    I["**Input:** 100M DAU<br/>× 20 actions/day<br/>= 2 billion actions/day"]

    I --> Q["**QPS** ÷ 100,000 s<br/>= 20,000/s avg<br/>× 3 = **60,000/s peak**"]
    Q --> QS["50:1 read-heavy →<br/>59,000 reads/s, 1,200 writes/s"]
    QS --> QE["Reads cannot come from a<br/>relational DB → memory.<br/>Writes fit one primary."]

    Q --> B["**Bandwidth** = QPS × bytes<br/>2 KB → 1 Gb/s ✓<br/>3 MB → 1.4 Tb/s ✗"]
    B --> BE["JSON from origin,<br/>media from a CDN"]

    Q --> C["**Concurrency** = QPS × latency<br/>10,000/s × 50 ms = 500"]
    C --> CE["Sizes pools, not QPS.<br/>Latency ×10 → concurrency ×10"]

    Q --> M["**Machines** = peak ÷ per-instance<br/>60,000 ÷ 3,000 = 20<br/>+50% headroom = **30**"]
    M --> ME["N+2 across 2+ zones.<br/>Exactly-at-peak = first<br/>failure is an incident"]

    I --> S["**Storage** = writes × bytes<br/>× amplification × retention"]
    S --> SE["Amplification is where<br/>estimates go 5–10× wrong.<br/>Report hot and total separately"]

    I --> O["**One-machine check**<br/>&lt;10 TB, &lt;256 GB working set,<br/>&lt;10k QPS, &lt;5k writes/s?"]
    O --> OE["If yes: one machine + replica.<br/>Producing this answer confidently<br/>is the harder skill"]

    style QE fill:#17272a,stroke:#35897e
    style BE fill:#17272a,stroke:#35897e
    style SE fill:#2a1a1a,stroke:#a04848
    style OE fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'amplification',
      title: 'Why naive storage estimates are 5–10× low',
      caption:
        'Step through it. Every multiplier is a factor candidates omit, and the errors are modelling errors rather than arithmetic ones — which is why they compound silently.',
      nodes: [
        { id: 'raw', label: 'Raw: 1B rows × 1 KB = 1 TB/day', kind: 'client', x: 0, y: 190, detail: 'The figure most candidates report. It is the input to the calculation, not the answer.' },
        { id: 'idx', label: '× 1.5 indexes', kind: 'service', x: 190, y: 70, detail: 'Indexes are typically 20–100% of the data. A table with four indexes can exceed the size of the rows themselves.' },
        { id: 'mvcc', label: '× 1.3 dead rows', kind: 'service', x: 190, y: 170, detail: 'In an MVCC store every update leaves a dead version until vacuumed. A high-churn table runs persistently larger than its live data.' },
        { id: 'repl', label: '× 3 replication', kind: 'service', x: 190, y: 270, detail: 'Three copies for durability — or 1.4× with erasure coding, which is what large object stores use. This is an assumption, not a fact, and it should be said aloud.' },
        { id: 'backup', label: '× 2 backups', kind: 'service', x: 190, y: 370, detail: 'Snapshots and point-in-time recovery. Frequently forgotten, and it is real storage someone pays for.' },
        { id: 'total', label: '≈ 12 TB/day, not 1', kind: 'store', x: 440, y: 190, detail: '1 × 1.5 × 1.3 × 3 × 2 ≈ 12. The naive figure was low by an order of magnitude, and every multiplier was a factor omitted rather than a sum done wrong.' },
        { id: 'tier', label: 'Tier it', kind: 'note', x: 660, y: 100, detail: 'Access falls off steeply with age. Hot 30 days is the expensive infrastructure; the rest is cold. Report both — one number conflates two cost decisions.' },
        { id: 'peak', label: 'And compute the peak rate', kind: 'note', x: 660, y: 280, detail: 'The total tells you the cost; the peak write rate and inbound bandwidth tell you the architecture — such as whether uploads may pass through an application tier at all.' },
      ],
      edges: [
        { id: 'a1', source: 'raw', target: 'idx', kind: 'control' },
        { id: 'a2', source: 'raw', target: 'mvcc', kind: 'control' },
        { id: 'a3', source: 'raw', target: 'repl', kind: 'control' },
        { id: 'a4', source: 'raw', target: 'backup', kind: 'control' },
        { id: 'a5', source: 'idx', target: 'total', kind: 'sync' },
        { id: 'a6', source: 'mvcc', target: 'total', kind: 'sync' },
        { id: 'a7', source: 'repl', target: 'total', kind: 'sync' },
        { id: 'a8', source: 'backup', target: 'total', kind: 'sync' },
        { id: 'a9', source: 'total', target: 'tier', kind: 'async' },
        { id: 'a10', source: 'total', target: 'peak', kind: 'async' },
      ],
      steps: [
        {
          id: 'am1',
          title: 'The raw figure is the input, not the answer',
          description:
            '1 billion rows at 1 KB is 1 TB a day. Reporting this as the storage estimate omits every factor that determines what is actually provisioned.',
          nodes: ['raw'],
          edges: [],
        },
        {
          id: 'am2',
          title: 'Indexes and dead rows come first',
          description:
            'Indexes are 20–100% of the data, and in an MVCC store every update leaves a dead version until vacuum catches up. Together roughly 2× before any copies are made.',
          nodes: ['idx', 'mvcc'],
          edges: ['a1', 'a2'],
        },
        {
          id: 'am3',
          title: 'Then copies — and the copy scheme is a design choice',
          description:
            'Three replicas is 3×; erasure coding is about 1.4× for comparable durability. At large scale that single choice more than halves the bill, so it must be stated as an assumption rather than assumed silently.',
          nodes: ['repl', 'backup'],
          edges: ['a3', 'a4'],
        },
        {
          id: 'am4',
          title: 'The product is an order of magnitude higher',
          description:
            '1.5 × 1.3 × 3 × 2 ≈ 12. Every one of those was a factor omitted, not a sum done wrong — which is why estimation errors are modelling errors.',
          nodes: ['total'],
          edges: ['a5', 'a6', 'a7', 'a8'],
        },
        {
          id: 'am5',
          title: 'Then tier it, and compute the peak',
          description:
            'Hot and total are different cost decisions and should be reported separately. And the peak write rate and inbound bandwidth are what constrain the architecture, as opposed to the total which constrains the budget.',
          nodes: ['tier', 'peak'],
          edges: ['a9', 'a10'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The most useful worked example is a complete three-minute estimate delivered the way it should be spoken, with the eliminations made explicit.

**Prompt: "design a system for a social platform's activity feed." Interviewer gives no numbers.**

> "I will assume 200 million daily active users, each opening the app 10 times a day and seeing 20 items per open. Stop me if the scale is different.
>
> **Reads.** 200 million × 10 = 2 billion feed loads a day. Over 100,000 seconds that is **20,000 feed loads a second average, 60,000 at peak** using a 3× multiplier. Each load returns 20 items, so **1.2 million items a second** are being assembled at peak.
>
> **Writes.** Assume each user posts once every three days, so about 70 million posts a day, which is **700 a second, 2,000 at peak.**
>
> **So the read:write ratio is about 30:1 on loads, and 600:1 on items.** That is the most important number so far: **the write path is small enough to do real work on, and the read path is far too large to do any.** Which points at fan-out on write — precompute each user's feed when a post is made — rather than assembling it at read time.
>
> **Let me check that.** Average followers, say 200. 700 posts a second × 200 followers = **140,000 feed insertions a second, 420,000 at peak.** That is large but tractable, and it converts 1.2 million reads a second into a single lookup per feed load.
>
> **But the celebrity case breaks it.** A user with 50 million followers generates 50 million insertions from one post. At 420,000 insertions a second capacity, that single post takes two minutes to fan out — and it would starve everyone else. **So celebrities must be handled differently: their posts are pulled at read time and merged.** That hybrid is the deep dive.
>
> **Storage.** A feed entry is small — a post id, an author id, a timestamp, maybe 50 bytes. Keep 500 entries per user: 200 million × 500 × 50 bytes = **5 TB**. With indexes and three replicas, call it **25 TB.** That fits in a modest cluster and is not a constraint.
>
> Posts themselves: 70 million a day × 1 KB = 70 GB a day, so **25 TB a year** before amplification. Also not a constraint.
>
> **Bandwidth.** 60,000 feed loads a second, each returning 20 items hydrated to maybe 2 KB each = 40 KB per response. 60,000 × 40 KB = **2.4 GB/s, about 20 Gb/s.** Significant, and it means responses should be served from a cache near the user and the payload should be trimmed.
>
> **Memory.** Can the feeds live in memory? 5 TB of feed entries — no, not in one place, but across a Redis cluster of, say, 30 machines at 256 GB each, yes. **So feeds are cached in memory and the database is the durable record.**
>
> **Machines.** 60,000 requests a second at 3,000 per instance is 20 instances, plus 50% headroom = **30 instances** for the feed-read service.
>
> **The conclusions I am taking forward:** fan-out on write with a pull-based exception for celebrities; feeds in a Redis cluster with a durable backing store; 20 Gb/s of egress means edge caching; and the deep dive is the celebrity fan-out problem."

**Roughly three minutes of speech, and notice what it produced.**

**Five eliminations:** read-time assembly is out (1.2 million items/second); pure fan-out on write is out (celebrities); a single cache machine is out (5 TB); origin-served responses are out (20 Gb/s); and storage is explicitly *not* a constraint, which is worth saying because it directs attention away from a non-problem.

**One deep dive identified**, and identified *by the arithmetic* rather than by taste. The celebrity problem emerged from computing 50 million × 1 against a 420,000/second capacity.

**Every assumption stated**, so the interviewer can correct one cheaply, and every number available to point back at when defending a decision later.

**The transferable structure: reads, writes, ratio, then check the implied design against a specific number, then storage, bandwidth, memory, machines.** Same order every time, and the check step — computing whether fan-out on write is actually feasible — is the one candidates skip and the one that finds the deep dive.`,
  },

  tradeoffs: {
    intro:
      'The decisions are about how to spend estimation effort. Rows are the choices that change whether the arithmetic helps or wastes time.',
    rows: [
      {
        option: 'One significant figure, powers of ten',
        whenItWins:
          'Always. 583,333 and 600,000 eliminate the same designs, so the extra digits cost time and buy nothing.',
        whenItLoses:
          'When a decision genuinely turns on a factor of two — then compute both bounds rather than one precise figure.',
        cost:
          'Appearing imprecise, which is resolved by saying "I am rounding, the error does not matter here".',
      },
      {
        option: 'Precise arithmetic',
        whenItWins:
          'Almost nowhere in an interview. Occasionally in real capacity planning where money follows the number.',
        whenItLoses:
          'Under time pressure. It consumes the deep dive and demonstrates arithmetic rather than judgement.',
        cost:
          'Minutes, and the risk of an arithmetic slip that undermines confidence in the reasoning.',
      },
      {
        option: 'Estimate average load',
        whenItWins:
          'As an intermediate step on the way to peak.',
        whenItLoses:
          'As the sizing figure. A system provisioned for average fails for the hours each day when traffic exceeds it.',
        cost:
          'A design that works most of the time, which is the definition of an outage.',
      },
      {
        option: 'Estimate peak with a stated multiplier',
        whenItWins:
          'Always. 2–3× average, higher for a product with a daily rhythm, and stating the multiplier makes it correctable.',
        whenItLoses:
          'Never, though the multiplier itself is an assumption worth flagging.',
        cost:
          'Provisioning for a load that occurs a few hours a day.',
      },
      {
        option: 'Raw bytes as the storage estimate',
        whenItWins:
          'Nowhere. It is the input to the calculation.',
        whenItLoses:
          'Always, and by 5–10×. Indexes, dead rows, replication, variants and backups are all omitted.',
        cost:
          'An estimate that is wrong by an order of magnitude in a predictable direction.',
      },
      {
        option: 'Raw bytes × a stated amplification factor',
        whenItWins:
          'Always. Naming the multipliers shows which are assumptions and lets the interviewer challenge one.',
        whenItLoses:
          'Never, and it takes fifteen extra seconds.',
        cost:
          'Having to know the typical multipliers, which is what the table is for.',
      },
      {
        option: 'One storage number',
        whenItWins:
          'When retention is short and access is uniform across the data.',
        whenItLoses:
          'When access falls off with age, which is most systems. Hot and total are different cost decisions.',
        cost:
          'Conflating the expensive infrastructure with the cheap archive.',
      },
      {
        option: 'Skip the bandwidth calculation',
        whenItWins:
          'Nowhere. It is one multiplication and it is frequently the binding constraint.',
        whenItLoses:
          'Whenever responses are large. It is the calculation that forces media to a CDN and uploads to presigned URLs.',
        cost:
          'Missing the constraint that actually determines the architecture.',
      },
      {
        option: 'The one-machine check',
        whenItWins:
          'Always, before proposing anything distributed. Ten seconds, and it prevents a whole class of over-engineering.',
        whenItLoses:
          'Never — though producing the "one machine" answer confidently requires more conviction than producing a distributed one.',
        cost:
          'A design that looks unambitious and is correct.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"1 billion writes a day at 1 KB each is 1 TB a day, so 365 TB a year."',
      whyWeak:
        'That is raw bytes, which is the input rather than the answer. It omits indexes (1.2–2×), MVCC dead rows (1.2–2×), replication (3×, or 1.4× with erasure coding) and backups (1.5–3×). The realistic figure is 5–10× higher.',
      strongAnswer:
        '"1 TB a day raw. Then the multipliers: about 1.5× for indexes, 1.3× for MVCC dead versions before vacuum, 3× for replication — or 1.4× if I use erasure coding, which at this scale I would — and roughly 2× for backups. So call it 8–12 TB a day, and around 3–4 PB a year. And I would separate hot from cold: if access falls off with age, the last 30 days is the expensive infrastructure and the rest tiers to archival."',
    },
    {
      weakAnswer: '"20,000 requests per second, so we need 20,000 divided by 3,000 — about 7 instances."',
      whyWeak:
        'It sizes for average rather than peak, and it includes no headroom. At a 3× peak the real figure is 60,000 per second, needing 20 instances, and provisioning exactly at peak means the first instance failure is an incident with nothing left for growth.',
      strongAnswer:
        '"20,000 per second average, and peak is 2–3× so call it 60,000. At 3,000 per instance that is 20 instances, plus 50% headroom for failures and growth gives 30 — spread across at least two zones so losing a zone leaves enough capacity. Provisioning exactly at peak means the first failure is an outage."',
    },
    {
      weakAnswer: '"Reads are 59,000 per second. We will need a big cache." — and no bandwidth calculation.',
      whyWeak:
        'Bandwidth is one multiplication and it is frequently the binding constraint. 59,000 reads of a 2 KB JSON response is 1 Gb/s and comfortable; 59,000 reads of a 3 MB photo is 1.4 Tb/s and impossible from an origin. Those are different architectures and only the multiplication distinguishes them.',
      strongAnswer:
        '"59,000 reads a second — let me compute the bandwidth, because it usually matters more than the request rate. At a 2 KB JSON response that is about 120 MB/s, roughly 1 Gb/s, which is comfortable from an origin. If these were 3 MB photos it would be 177 GB/s and would have to come from a CDN. So the payload size decides whether this is an origin-served or edge-served system."',
    },
    {
      weakAnswer: '"We need to shard the database because we will have 500 million rows."',
      whyWeak:
        'It never checks whether one machine would do. 500 million rows at 1 KB is 500 GB, which fits comfortably on a modern SSD, and if the QPS is modest a single well-indexed instance with a replica handles it. Sharding was assumed rather than derived.',
      strongAnswer:
        '"Let me check whether one machine would do first. 500 million rows at 1 KB is 500 GB, well inside a 10 TB SSD, and the working set is probably a fraction of that. If the QPS is under about 10,000 and writes under 5,000 a second, this is one PostgreSQL instance plus a replica — and proposing a partitioned cluster would be adding operational complexity the numbers do not justify."',
    },
    {
      weakAnswer: '"10,000 requests per second, so we need a connection pool of 10,000."',
      whyWeak:
        'It confuses request rate with concurrency. By Little\'s Law, concurrency is QPS times latency: 10,000 per second at 50 ms is 500 concurrent, not 10,000. A pool of 10,000 is twenty times larger than needed and would itself overwhelm the database.',
      strongAnswer:
        '"Concurrency is QPS times latency, so 10,000 per second at 50 ms is 500 concurrent requests — that is what sizes the pool, not the request rate. And the important consequence: if the database slows to 500 ms, the same request rate needs 5,000 concurrent, so the pool fills and requests queue. That is the mechanism by which a slowdown exhausts a pool, and it is why I would bound the pool and shed rather than let it grow."',
    },
    {
      weakAnswer: '"Photos are 3 MB, times 1 billion a day, times 3 replicas — about 9 PB a day, kept forever."',
      whyWeak:
        'Three errors. It assumes 3× replication when erasure coding at 1.4× is what large object stores use — a design assumption smuggled into an estimate. It omits derived variants. And "kept forever" times "growing daily" conflates a small hot tier with an enormous cold one.',
      strongAnswer:
        '"3 PB a day of originals. Variants add about 20%. At this scale I would assume erasure coding at roughly 1.4× rather than 3× replication — that is a design assumption and it more than halves the bill, so it is worth stating. That gives about 5 PB a day. But the number that matters is the hot tier: if most views are of recent content, 30 days is about 150 PB and the rest is cold. And separately, 30,000 uploads a second at peak is 90 GB/s inbound, which is what forces presigned direct-to-storage uploads."',
    },
  ],

  flashcards: [
    {
      id: 'fc-he-1',
      front: 'What is the purpose of estimation in a design interview?',
      back: 'To eliminate designs. It is finished when enough options are eliminated, so precision beyond that point is waste.',
      topic: 'estimation',
    },
    {
      id: 'fc-he-2',
      front: 'The four round-number tricks?',
      back: '100,000 seconds a day; 2.5 million a month, 30 million a year; powers of two (2^20 ≈ a million); peak is 2–3× average.',
      topic: 'arithmetic',
    },
    {
      id: 'fc-he-3',
      front: 'What are 1 million/day and 1 billion/day in per-second terms?',
      back: '10/s and 10,000/s. These two conversions cover most prompts.',
      topic: 'arithmetic',
    },
    {
      id: 'fc-he-4',
      front: 'The two latency ratios that decide designs?',
      back: 'Memory is ~1,000× faster than SSD (why caches exist), and a cross-continent round trip is ~1,500× a local one (why cross-region synchronous writes are a different architecture).',
      topic: 'latency-numbers',
    },
    {
      id: 'fc-he-5',
      front: 'Rough software throughput per instance, in order?',
      back: 'In-memory key-value read ~100,000/s; indexed relational read ~10,000/s; durable relational write ~1,000–10,000/s. Each roughly 10× the next.',
      topic: 'latency-numbers',
    },
    {
      id: 'fc-he-6',
      front: 'How do you derive peak QPS from DAU?',
      back: '`DAU × actions_per_day ÷ 100,000 × 3`. Then split reads from writes, because the ratio is usually where the design effort goes.',
      topic: 'estimation',
    },
    {
      id: 'fc-he-7',
      front: 'Which factors make a naive storage estimate 5–10× low?',
      back: 'Indexes (1.2–2×), MVCC dead rows (1.2–2×), replication (3×) or erasure coding (1.4×), derived variants (1.1–2×), and backups (1.5–3×).',
      topic: 'sizing',
    },
    {
      id: 'fc-he-8',
      front: 'Why report hot and total storage separately?',
      back: 'They are different cost decisions. Access falls off steeply with age, so the hot tier — the expensive infrastructure — is usually a small fraction of the total.',
      topic: 'sizing',
    },
    {
      id: 'fc-he-9',
      front: 'Why compute bandwidth, and what does it decide?',
      back: 'One multiplication, frequently the binding constraint. 59,000 reads of 2 KB is 1 Gb/s; of 3 MB it is 1.4 Tb/s — which forces a CDN and presigned uploads.',
      topic: 'sizing',
    },
    {
      id: 'fc-he-10',
      front: 'How do you compute concurrency, and why not QPS?',
      back: '`concurrency = QPS × latency`. 10,000/s at 50 ms is 500 concurrent. That sizes pools — and if latency ×10, concurrency ×10 at the same request rate.',
      topic: 'capacity-planning',
    },
    {
      id: 'fc-he-11',
      front: 'How do you size instance count?',
      back: '`peak QPS ÷ per-instance throughput × (1 + headroom)`, with at least 50% headroom, spread so losing a zone leaves enough capacity.',
      topic: 'capacity-planning',
    },
    {
      id: 'fc-he-12',
      front: 'What is the one-machine check?',
      back: 'Under 10 TB storage, 256 GB working set, ~10,000 QPS and ~5,000 writes/s? Then one machine plus a replica, and a distributed design is over-engineering.',
      topic: 'capacity-planning',
    },
    {
      id: 'fc-he-13',
      front: 'When do id collisions start to matter?',
      back: 'Around the square root of the key space, by the birthday argument. A 2.2-billion space has meaningful collision probability at roughly 47,000 ids.',
      topic: 'sizing',
    },
    {
      id: 'fc-he-14',
      front: 'What should you say after computing a number?',
      back: 'The conclusion, not just the figure. "600,000 reads a second, which means this cannot come from a relational database." The number is the working; the elimination is the point.',
      topic: 'estimation',
    },
  ],

  quiz: [
    {
      id: 'q-he-1',
      kind: 'scenario',
      prompt:
        '50 million DAU, 40 actions each per day, 20:1 read-heavy. What is the peak read rate?',
      options: [
        { id: 'a', label: 'About 57,000 reads/s — 2 billion actions ÷ 100,000 s = 20,000/s, × 3 for peak = 60,000/s, of which 20/21 are reads' },
        { id: 'b', label: 'About 20,000 reads/s, since that is the average rate' },
        { id: 'c', label: 'About 2,000 reads/s' },
        { id: 'd', label: 'Cannot be derived without the response size' },
      ],
      correct: ['a'],
      explanation:
        '50M × 40 = 2 billion actions/day; ÷ 100,000 s ≈ 20,000/s average; × 3 ≈ 60,000/s peak; 20:1 read-heavy makes roughly 57,000 of those reads. Option b sizes for average, which means the design fails for the hours each day when traffic exceeds it. Response size is needed for bandwidth, not for the request rate.',
      difficulty: 'core',
      topic: 'arithmetic',
    },
    {
      id: 'q-he-2',
      kind: 'scenario',
      prompt:
        'A service handles 8,000 requests/second with 100 ms average latency. What connection-pool size does this imply?',
      options: [
        { id: 'a', label: 'About 800 — concurrency is QPS × latency, not the request rate' },
        { id: 'b', label: 'About 8,000, one per request per second' },
        { id: 'c', label: 'About 80, since 100 ms is a tenth of a second' },
        { id: 'd', label: 'It depends only on the database\'s maximum connections' },
      ],
      correct: ['a'],
      explanation:
        'Little\'s Law: 8,000/s × 0.1 s = 800 concurrent. Sizing at 8,000 would be ten times too large and would itself overwhelm the database. And the consequence matters more than the number: if latency rises to 1 second, the same request rate needs 8,000 concurrent — which is how a slowdown exhausts a pool.',
      difficulty: 'core',
      topic: 'capacity-planning',
    },
    {
      id: 'q-he-3',
      kind: 'scenario',
      prompt:
        '200 million rows a day at 2 KB each. A candidate reports 400 GB/day and 146 TB/year. What is missing?',
      options: [
        { id: 'a', label: 'The amplification factors — indexes, MVCC dead rows, replication and backups typically make the real figure 5–10× higher' },
        { id: 'b', label: 'Nothing; that arithmetic is correct' },
        { id: 'c', label: 'The peak write rate, which changes the storage total' },
        { id: 'd', label: 'The compression ratio, which would reduce it' },
      ],
      correct: ['a'],
      explanation:
        'The arithmetic is right and it computes raw bytes, which is the input rather than the answer. Indexes at 1.5×, dead rows at 1.3×, replication at 3× and backups at 2× compound to roughly 12×. The peak rate matters for the ingest architecture and not for the total; compression is real and rarely closes an order-of-magnitude gap.',
      difficulty: 'core',
      topic: 'sizing',
    },
    {
      id: 'q-he-4',
      kind: 'scenario',
      prompt:
        'A candidate proposes sharding for a system with 300 million rows of 500 bytes and 4,000 requests/second. Is sharding justified?',
      options: [
        { id: 'a', label: 'No — 150 GB fits comfortably on one SSD and 4,000 QPS is within one instance, so one machine plus a replica is correct' },
        { id: 'b', label: 'Yes, 300 million rows exceeds what a single database can index' },
        { id: 'c', label: 'Yes, because 4,000 requests/second requires horizontal scaling' },
        { id: 'd', label: 'Cannot tell without the read-to-write ratio' },
      ],
      correct: ['a'],
      explanation:
        '300M × 500 bytes = 150 GB, well inside a 10 TB SSD, and 4,000 requests/second is comfortable for a well-indexed instance. Sharding here adds operational complexity the numbers disprove. The one-machine check takes ten seconds and prevents this class of over-engineering — and producing the "one machine" answer confidently is the harder skill.',
      difficulty: 'core',
      topic: 'capacity-planning',
    },
    {
      id: 'q-he-5',
      kind: 'scenario',
      prompt:
        '40,000 reads/second. Under which condition does the design have to change fundamentally?',
      options: [
        { id: 'a', label: 'When the response is large — 40,000 × 3 MB is 120 GB/s, which forces a CDN, while 40,000 × 2 KB is under 1 Gb/s and is fine from an origin' },
        { id: 'b', label: 'When the read-to-write ratio exceeds 10:1' },
        { id: 'c', label: 'When the data exceeds 1 TB' },
        { id: 'd', label: 'Never; 40,000 reads/second is a solved problem' },
      ],
      correct: ['a'],
      explanation:
        'The same request rate with two payload sizes is two different architectures, and only the bandwidth multiplication distinguishes them. This is why the bandwidth calculation is worth ten seconds — it is frequently the binding constraint and it is the calculation candidates most often skip.',
      difficulty: 'core',
      topic: 'sizing',
    },
    {
      id: 'q-he-6',
      kind: 'multi',
      prompt:
        'Which are true about estimating in an interview? Select all that apply.',
      options: [
        { id: 'a', label: 'Round to one significant figure — 583,333 and 600,000 eliminate the same designs' },
        { id: 'b', label: 'Say the conclusion the number forces, not just the number' },
        { id: 'c', label: 'Always compute the peak, with a stated multiplier' },
        { id: 'd', label: 'Precision demonstrates rigour and is worth the extra time' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the technique. The fourth is the failure mode: extra digits eliminate nothing further, consume the deep dive, and risk an arithmetic slip that undermines confidence in the reasoning. The interviewer is assessing whether you reason with magnitudes, which rounding demonstrates rather than obscures.',
      difficulty: 'core',
      topic: 'estimation',
    },
  ],

  exercises: [
    {
      id: 'ex-he-1',
      kind: 'estimate',
      title: 'Four estimates, three minutes each, out loud',
      estimatedMinutes: 40,
      prompt: `Do each of these out loud against a timer. Three minutes each, one significant figure, and after every number say what it eliminates.

**1. A messaging app.** 2 billion users, 1 billion daily active, 40 messages sent per active user per day, average message 200 bytes, messages kept forever, delivered to an average of 1.2 recipients.

Derive: messages/second (average and peak), storage per day and per year with amplification, the fan-out write rate, and whether message history fits in memory.

**2. A video platform's upload pipeline.** 500 hours of video uploaded per minute, average 1 GB per hour of source, each source transcoded into 6 renditions totalling 1.5× the source size.

Derive: inbound bandwidth, storage per day, transcoding compute required if one CPU-hour transcodes 10 minutes of video, and what this implies about where uploads land.

**3. An internal expense-approval tool.** 8,000 employees, 3 expense reports each per month, each with an average of 6 line items and 2 receipt images of 500 KB.

Derive: everything, and then state what the correct architecture is.

**4. A short-code service.** Codes are 7 characters from a 32-character alphabet. 50 million codes created per year, kept forever.

Derive: key space, years until collisions become a practical problem, and whether 7 characters is the right length.

Then answer:

- Which of the four had the most surprising binding constraint?
- In which did the arithmetic argue for a *smaller* design?
- Which single omitted factor would most change one of your answers?`,
      rubric: [
        'Each estimate uses rounded figures and states a peak multiplier.',
        'Each number is followed by what it eliminates.',
        'Messaging: fan-out multiplier applied; storage amplification included; memory check performed.',
        'Video: inbound bandwidth computed and identified as the architectural driver; compute derived in machine-count terms.',
        'Expense tool: one-machine conclusion reached explicitly.',
        'Short code: key space computed and the birthday bound applied, not just occupancy.',
        'Identifies bandwidth or compute as a surprising binding constraint with reasoning.',
        'Identifies the expense tool as the case arguing for a smaller design.',
        'Names a specific omitted factor and quantifies its effect.',
      ],
      modelAnswer: `**1. Messaging app**

> "1 billion daily active users × 40 messages = **40 billion messages sent per day.** Over 100,000 seconds that is **400,000 sends/second average**, and messaging has a strong daily rhythm so I will use 3× — **1.2 million sends/second at peak.**
>
> **That number eliminates a great deal immediately.** 1.2 million writes a second is far beyond any single database, so the write path must be partitioned — by conversation id, so a conversation's messages stay ordered and together. And it rules out any synchronous cross-region write, since 1.2 million × a 150 ms round trip is not a system.
>
> **Fan-out.** 1.2 recipients on average, so **48 billion deliveries/day, 480,000/second average, 1.4 million at peak.** Only slightly more than sends, because most messages are one-to-one — **so fan-out is not the problem here**, unlike a social feed. Group messages are the exception and the average tells me they are a minority.
>
> **Storage.** 40 billion × 200 bytes = **8 TB/day raw.** Amplification: an index on (conversation, time) plus a per-recipient delivery index, call it 2×; replication 3×; backups 1.5×. So **roughly 70 TB/day, 25 PB/year.**
>
> **That is the number that should worry me, and 'kept forever' is the reason.** 25 PB a year growing is an unbounded commitment. I would push back on the requirement: tier messages older than a year to cold storage, and check whether legal retention actually requires forever. **The estimate has found a requirement worth challenging**, which is more valuable than the number.
>
> **Memory check.** Can message history be cached? 25 PB — obviously not. But the *recent* history is what gets read: assume users read the last 50 messages per conversation, 1 billion users × 20 active conversations × 50 messages × 200 bytes = **200 TB.** Still too large for memory across any reasonable cluster.
>
> **So the read path is not a memory cache — it is a partitioned store with recent messages on SSD, and only the *currently open* conversation cached client-side.** That is a significant architectural conclusion and it came from the memory calculation.
>
> **Conclusions:** partition by conversation; 1.2 million writes/second means append-only writes with no read-modify-write; storage tiering is mandatory and 'forever' should be challenged; and the client is the cache."

**2. Video upload pipeline**

> "500 hours/minute of source. Let me convert: **500 ÷ 60 ≈ 8.3 hours of video per second.**
>
> **Inbound bandwidth.** 8.3 hours/s × 1 GB/hour = **8.3 GB/s ≈ 66 Gb/s sustained, and 200 Gb/s at a 3× peak.**
>
> **That is the binding constraint and it decides the architecture immediately.** 200 Gb/s cannot pass through an application tier — it must go directly to object storage via presigned URLs, with the application only issuing credentials and receiving a completion callback. **No application server is in the byte path at all.** And uploads must be multipart and resumable, because a 1 GB upload over a mobile connection will fail partway.
>
> **Storage.** 8.3 GB/s × 100,000 s = **830 TB/day of source.** Renditions at 1.5× add 1.2 PB, so **about 2 PB/day.** With erasure coding at 1.4× rather than 3× replication — which at petabyte scale I would certainly use — that is **2.9 PB/day, or about 1 EB/year.**
>
> **Transcoding compute.** 8.3 hours of video per second, and one CPU-hour transcodes 10 minutes. So one hour of video needs 6 CPU-hours, and 6 renditions means **36 CPU-hours per source hour.**
>
> 8.3 source-hours/second × 36 = **300 CPU-hours per second**, which is **300 × 3,600 = 1.08 million CPU-seconds per second — meaning about 1.08 million cores running continuously.** At 64 cores per machine that is **17,000 machines.**
>
> **That is the second surprise and it is larger than the storage problem.** 17,000 machines of transcoding is the dominant cost in this system, and it immediately suggests three things: transcode lazily rather than eagerly (only generate a rendition when someone requests that quality), use hardware encoders which are far more efficient than CPUs, and reduce the rendition count for content nobody watches.
>
> **The lazy-transcoding conclusion is the important one.** Most uploaded video is watched very little, so eagerly producing 6 renditions for everything is enormous waste. **Transcode one default rendition eagerly and the rest on first request** — that could cut the 17,000 machines by an order of magnitude.
>
> **Conclusions:** presigned direct-to-storage uploads with no application server in the byte path; multipart and resumable; erasure coding; and transcoding is the dominant cost, so it must be lazy and hardware-accelerated."

**3. Internal expense-approval tool**

> "8,000 employees × 3 reports/month = **24,000 reports/month, about 800/day, which is 0.008/second.**
>
> **Let me just say the conclusion: this is 8 requests per 1,000 seconds. Every scale question is answered — there is no scale.**
>
> **Storage.** 24,000 reports × 6 line items = 144,000 rows/month, so **1.7 million rows/year.** At 500 bytes each that is **900 MB/year** — call it 3 GB with indexes and replication.
>
> Receipts: 24,000 × 2 × 500 KB = **24 GB/month, 290 GB/year.** Over ten years, 3 TB — and that is the only figure of any size.
>
> **QPS.** Even assuming employees browse reports 50× more than they create them, that is 0.4 requests/second average, perhaps 5/second at a month-end peak.
>
> **The correct architecture: one PostgreSQL instance with a replica, one application server (or two for availability), and receipts in object storage.** No cache, no queue, no partitioning, no message broker, no separate services.
>
> **The one-machine check passes on every dimension by three or four orders of magnitude.** 3 GB against 10 TB of storage; 5 requests/second against 10,000; 900 MB of working set against 256 GB of memory.
>
> **The only thing I would add is a background worker** for emailing approvers, so a slow mail provider does not block a request — and that is a queue table in the same database, not a broker.
>
> **What I am explicitly not building, and why:** no Redis, because there is nothing to cache; no Kafka, because there is one consumer; no sharding, because 1.7 million rows a year fits for a century; no separate services, because 8,000 users and two entities does not justify a deployment unit and an on-call rotation."

**4. Short-code service**

> "7 characters from a 32-character alphabet: **32^7 = 2^35 ≈ 34 billion codes.**
>
> **Demand:** 50 million/year × 20 years = **1 billion codes.**
>
> **Occupancy at 20 years:** 1e9 / 34e9 ≈ **3%.** Comfortable on occupancy alone.
>
> **But occupancy is the wrong test, and this is the point.** By the birthday argument, random collisions become likely around the *square root* of the space: √34e9 ≈ **185,000 codes.** So collisions start happening well before the space is anywhere near full.
>
> **What that actually means, concretely.** With N codes issued in a space of S, the probability that a newly-generated random code collides is N/S. At 1 billion issued in 34 billion, that is **3% per generation** — so about 1 in 33 creations needs a retry. One retry is cheap; and the expected number of attempts stays close to 1 even at 3% occupancy, so a bounded retry loop of 5 attempts is more than sufficient.
>
> **So 7 characters is right**, and the reasoning is not 'the space is big enough' but 'the collision *rate* stays low enough that a single retry handles it'.
>
> **Where it would stop being right:** if demand were 500 million/year, then 10 billion codes in 20 years is 30% occupancy, and 30% of generations would need a retry with a meaningful chance of needing several. **At that point I would go to 8 characters**, multiplying the space by 32 and dropping occupancy back to 1%.
>
> **Conclusion:** 7 characters, random generation from a cryptographically-secure source, a unique constraint on the column, and \`INSERT ... ON CONFLICT\` with a bounded retry of 5. And I would use \`varchar(8)\` rather than \`char(7)\` so growing to 8 characters later needs no schema change."

---

**Which had the most surprising binding constraint?**

**The video platform, and it was the transcoding compute rather than the storage or bandwidth.**

The bandwidth figure — 200 Gb/s at peak — is surprising and it has an obvious answer: presigned direct uploads. The storage figure of 1 EB/year is large and is a cost problem rather than an architecture problem.

**But 1.08 million cores was not something I would have guessed**, and it is derived from an innocuous-looking input: "6 renditions" and "one CPU-hour per 10 minutes". Those two numbers multiply to a 36× amplification on an already-large volume, and the result is 17,000 machines running continuously — plausibly the largest line in the platform's infrastructure bill.

**And it changes the design rather than just the budget**, which is what makes it the interesting answer. It argues for lazy transcoding, which means the playback path must be able to handle "this rendition does not exist yet" — a real architectural requirement that would never have surfaced without the compute estimate.

*The transferable point:* **compute is the dimension candidates estimate least often**, and for anything involving media processing, machine learning inference or heavy aggregation it is frequently the binding constraint. QPS, storage and bandwidth are the habitual three; compute is the fourth and it is often the largest.

**In which did the arithmetic argue for a smaller design?**

**The expense tool, unambiguously** — and by three to four orders of magnitude on every dimension.

This is the case worth practising hardest, because the instinct in an interview is to demonstrate range, and the correct answer here is "one database, one app server, object storage for receipts, nothing else". **Saying that confidently, and listing what you are deliberately not building, is a stronger signal than any distributed design would be** — because it shows the numbers were used rather than performed.

**The messaging app also contained a smaller-design argument**, in a different form: fan-out turned out *not* to be the problem, because 1.2 average recipients means most messages are one-to-one. A candidate who assumed messaging is a fan-out problem — reasoning by analogy with social feeds — would have designed a fan-out pipeline the arithmetic does not justify. **The estimate ruled out a component**, which is as valuable as ruling one in.

**Which single omitted factor would most change an answer?**

**Read amplification on the messaging app's storage.**

I computed storage from *sends*: 40 billion × 200 bytes. But a messaging system typically stores a **per-recipient delivery record** — read state, delivery state, per-device sync position — and that record can be comparable in size to the message itself, or larger. With 48 billion deliveries a day and, say, 100 bytes of delivery state each, that is another 4.8 TB/day raw before amplification.

**More significantly: per-device sync state.** If a user has 3 devices and each needs its own read position and delivery confirmation per message, delivery records triple. That would take my 8 TB/day raw to perhaps 20 TB/day, and my 25 PB/year to **60 PB/year** — a factor of 2.5 that came entirely from a factor I did not model.

**Second candidate: compression on the video platform.** I applied no compression to the 1 EB/year figure, and video is already compressed so there is little to gain — **which is worth saying explicitly**, because the instinct to apply a compression factor would be wrong here and right for the messaging app's text (where 3–5× is realistic and would materially change the storage answer).

*The general lesson from this question:* **estimation errors are omitted factors, and the factors you omit are the ones specific to the domain.** Indexes, replication and backups are generic and easy to remember; per-device sync state, rendition counts and read-state records are domain-specific and are what actually move the answer. **Asking "what else does this system store per event?" is the check that catches them.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-he-1',
      level: 'basic',
      question: 'How many seconds are in a day, and why does the answer 100,000 matter?',
      guidance:
        '86,400, rounded to 100,000 for arithmetic — 16% error, far inside what matters. A strong answer immediately gives the useful conversions: 1 million/day is 10/s, 1 billion/day is 10,000/s.',
    },
    {
      id: 'iq-he-2',
      level: 'basic',
      question: 'Estimate the peak QPS for a service with 100 million daily active users doing 20 actions each.',
      guidance:
        '2 billion ÷ 100,000 = 20,000/s average, × 3 = 60,000/s peak. Look for the peak multiplier being stated, and for the reads/writes split being made.',
    },
    {
      id: 'iq-he-3',
      level: 'intermediate',
      question: 'Why is a naive storage estimate usually wrong, and by how much?',
      guidance:
        'Omitted factors — indexes, dead rows, replication, variants, backups — compounding to 5–10×. A strong answer names erasure coding versus 3× replication as a design assumption smuggled into an estimate.',
    },
    {
      id: 'iq-he-4',
      level: 'intermediate',
      question: 'You have 10,000 requests/second. How large should the connection pool be?',
      guidance:
        'QPS × latency, so 500 at 50 ms — not 10,000. Look for the consequence: if latency rises tenfold, concurrency does too at the same request rate, which is how a slowdown exhausts a pool.',
    },
    {
      id: 'iq-he-5',
      level: 'advanced',
      question: 'When would you conclude that a system fits on one machine, and why is that hard to say?',
      guidance:
        'Under ~10 TB, ~256 GB working set, ~10,000 QPS, ~5,000 writes/s. Hard because an interview feels like an invitation to demonstrate range. Excellent answers list what they are deliberately not building.',
    },
    {
      id: 'iq-he-6',
      level: 'advanced',
      question: 'Which dimension do candidates most often fail to estimate?',
      guidance:
        'Compute, and bandwidth close behind. Excellent answers give an example where compute dominated — media transcoding, model inference — and note that it changes the architecture rather than only the budget.',
    },
    {
      id: 'iq-he-7',
      level: 'followup',
      question: 'You rounded 86,400 to 100,000. Does that not make your answer wrong?',
      guidance:
        'By 16%, which eliminates the same designs. A strong answer states that the output is a set of eliminated options rather than a number, so precision past that point is waste.',
    },
    {
      id: 'iq-he-8',
      level: 'followup',
      question: 'Your estimate says 25 PB a year and growing forever. What do you do with that?',
      guidance:
        'Challenge the retention requirement and propose tiering. A strong answer treats the estimate as having found a requirement worth revisiting, which is more valuable than the number itself.',
    },
  ],

  activeLearning: [
    {
      id: 'al-he-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above optimised for speed and rough accuracy in an interview. Now change one thing: this is a real capacity plan where money follows the number and you will be held to it. What changes?',
      discussion: `The techniques mostly survive and their purpose inverts: in an interview you estimate to eliminate designs; in a capacity plan you estimate to commit money, and being wrong in either direction has a cost.

**What changes fundamentally.**

**Measure instead of assuming.** The interview's biggest input — "assume 500 million daily active users" — is data you actually have. Real traffic logs give the actual request rate, the actual read-to-write ratio, the actual payload sizes and the actual peak shape. **Every assumed figure should be replaced by a measured one**, and the measured ones are routinely off from intuition by a factor of two or more in both directions.

**The peak multiplier becomes a measured distribution, not a rule of thumb.** "2–3×" is a reasonable guess and the real number might be 1.4× for a global service or 8× for a product with a single-timezone daily rhythm plus a marketing event. **And the shape matters as much as the ratio:** a 3× peak lasting ten minutes is an autoscaling problem; a 3× peak lasting four hours is a provisioning problem.

**Errors become asymmetric, and you must say which way you rounded.** Under-provisioning causes an outage; over-provisioning wastes money. Those are not equally bad, and which one is worse depends on the business. **So a capacity plan states a direction: "I have rounded up on the read path because under-provisioning there is user-visible, and rounded down on batch capacity because it can queue."** The interview's habit of rounding for convenience is replaced by rounding deliberately.

**Growth becomes a first-class input.** An interview estimate is a snapshot; a capacity plan has to cover the period until the next review. If traffic grows 5% a month, that is 80% over a year, and provisioning for today means being under-provisioned in four months. **The plan's horizon is the input nobody states in an interview.**

**Ranges rather than points.** "Between 40 and 70 TB, most likely 55" is more honest and more useful than "55 TB", because it says how confident you are. And the range's width tells the reader whether to build slack in or not.

**Cost enters the arithmetic.** In an interview, erasure coding versus 3× replication is a technical choice. In a plan it is a line item, and the difference at petabyte scale is a large number that someone has to approve. **The estimate becomes a comparison of options priced out**, not a single figure.

**What survives unchanged.**

**The derivation chain.** QPS, storage, bandwidth, concurrency, machine count — same order, same formulas, better inputs.

**The amplification factors**, and they matter *more* because the number is being committed to. An unmodelled per-device sync record is now a budget miss rather than an interview imprecision.

**Little's Law for concurrency**, which sizes pools and instance counts identically.

**The one-machine check.** Still worth ten seconds, and in real work it saves operational cost rather than interview credibility.

**What is genuinely new.**

**Validation against what you can measure later.** The observability lesson's point: an estimate of *average* latency cannot be checked against a *p99*. **A capacity plan should state its figures in the same terms as the metrics that will validate them**, or nobody can tell afterwards whether the plan was right.

**A review cadence, and a tracked variance.** The plan is a hypothesis; the useful artefact is the record of how wrong previous plans were, because that calibrates the next one. **A team that has never compared a plan against outcomes has no basis for confidence in the current one.**

**Headroom as a policy rather than a number.** 50% is a reasonable default; the real figure comes from how fast you can add capacity, how much variance the traffic has, and how bad an outage is. A service that can autoscale in 90 seconds needs far less headroom than one requiring a hardware order.

**What I would keep from the interview technique even in a plan.** Rounding to one or two significant figures, because false precision in a capacity plan is worse than in an interview — it implies confidence the inputs do not support. **A plan claiming 54.7 TB invites a reader to trust a figure whose inputs were estimates.**

**The transferable point.** The interview version teaches the derivation and the habit of asking what each number eliminates. Real capacity planning adds measurement, growth, asymmetric error, cost and validation — but the arithmetic is identical, and **someone who can do the interview version fluently can do the real one with better inputs.** The reverse is not true: a team with excellent monitoring and no derivation habit will measure what exists and fail to predict what a design change would cost.`,
    },
    {
      id: 'al-he-2',
      kind: 'debug',
      prompt:
        'A team provisioned a service from a careful estimate: 50,000 peak requests/second, 30 instances at 3,000 each with 50% headroom. In production it falls over at 18,000 requests/second — well under the estimate. The arithmetic was checked and is correct. What was wrong?',
      discussion: `The arithmetic is right and the system fails at a third of the predicted capacity, so the error is in an input or in an unmodelled interaction. Five candidates, and they are distinguishable.

**Hypothesis 1 — the per-instance throughput figure was measured under the wrong conditions.** "3,000 requests/second per instance" probably came from a benchmark: a single endpoint, warm cache, no contention, small payloads. Production traffic is a mix of endpoints with different costs, cold caches, and larger payloads.

*Why it fits best:* it explains a shortfall of exactly this shape. If the real mixed-traffic throughput is 1,000/second rather than 3,000, then 30 instances gives 30,000 capacity, and with the concurrency effects below it falls over at 18,000.

*Check:* measure per-instance throughput with production traffic mix at the actual payload sizes. **This is the input most likely to be optimistic**, because benchmarks measure the easiest case.

**Hypothesis 2 — the bottleneck is not the application instances.** The estimate sized the application tier and said nothing about the database, the cache, the connection pool, or the network. If the database saturates at 18,000 requests/second, adding application instances changes nothing.

*Why it fits:* the estimate computed one dimension and the system has several. **A capacity estimate that sizes only the tier you are thinking about is a partial estimate**, and the unmodelled tier is where the limit lands.

*Check:* which resource is saturated at 18,000 — application CPU, database CPU, connection-pool utilisation, or network. If application instances are at 40% while the database is at 100%, this is it.

**Hypothesis 3 — concurrency, not request rate, is the binding constraint.** The estimate used QPS. If production latency is higher than assumed — because of a slower dependency, larger payloads, or contention — then by Little's Law concurrency is higher at the same request rate, and the pool or thread limit is reached first.

*Concretely:* if the estimate assumed 50 ms latency, 18,000/second is 900 concurrent. If real latency is 200 ms, it is 3,600 concurrent — four times the pool. **The request rate is within budget and the concurrency is not.**

*Check:* actual p50 and p99 latency against what the estimate assumed, and pool utilisation at failure. **This is the failure mode the estimate structurally cannot see**, because it did not compute concurrency.

**Hypothesis 4 — the peak is not what was estimated.** "50,000 peak" came from a 3× multiplier on average. If the real peak is spikier — 8× for two minutes rather than 3× sustained — then a system sized for 50,000 sustained can be hit by bursts it cannot absorb, and the failure happens at an average of 18,000 during a spike.

*Check:* the traffic distribution at fine granularity. Per-minute averages hide a ten-second spike, and a system fails on the ten-second spike.

**Hypothesis 5 — retry amplification.** At 18,000 requests/second something begins to fail, clients retry, and the effective load becomes 30,000 or more. The system did not fail at 18,000; it failed at 18,000 *plus* the amplification the failure caused.

*Why it fits:* it explains a sharp collapse rather than a gradual degradation, and it is the retries lesson's central mechanism.

*Check:* the ratio of inbound requests to downstream requests during the failure. A ratio well above 1 means retries are a major traffic source, and it means the *effective* capacity is much lower than the nominal one.

**What I would check first: which resource was actually saturated at the moment of failure.** One question, and it splits the hypothesis space decisively — application CPU points at hypothesis 1, a saturated pool at 3, a saturated database at 2. **Diagnosing a capacity shortfall without knowing which resource ran out is guessing**, and it is the check people skip because the estimate told them what the constraint should be.

**Then: measured latency against assumed latency**, which covers hypothesis 3 and is a common and large error.

**What the estimate should have included, and this is the lesson.**

**Concurrency, not just QPS.** The single most common omission. Little's Law converts a rate into a resource requirement, and pools are sized in concurrency.

**Every tier, not just the one being sized.** Application instances, database, cache, connection pools, network egress. **The limit lands wherever you did not look.**

**Per-instance throughput measured with production traffic**, not a benchmark. And stated with the conditions: "3,000/second on the mixed endpoint distribution at p99 payload size".

**The peak shape, not just the multiplier.** A sustained 3× and a spiky 8× need different provisioning, and per-minute graphs hide the difference.

**Effective capacity after retry amplification**, since nominal capacity is not what you get when things start failing.

**And the validation step:** a load test at the estimated peak before relying on the estimate. **An unvalidated capacity estimate is a hypothesis**, and this team discovered theirs was wrong in production rather than in a load test — which is the actual process failure.

**Transferable:** a capacity estimate that computes one number for one tier will be wrong, and it will be wrong in the direction of optimism because every omitted factor reduces capacity. **The defensive habit is to compute concurrency alongside rate, size every tier rather than the interesting one, and load-test before believing any of it.**`,
    },
  ],

  revision: {
    bullets: [
      'Estimation exists to eliminate designs; it is finished when enough are eliminated.',
      '100,000 seconds a day. So 1 million/day is 10/s and 1 billion/day is 10,000/s.',
      '2.5 million seconds a month, 30 million a year. 2^20 ≈ a million, 2^30 ≈ a billion.',
      'Peak is 2–3× average — always compute it, and state the multiplier you used.',
      'Memory is ~1,000× faster than SSD; a cross-continent round trip is ~1,500× a local one.',
      'Rough per-instance throughput: in-memory 100k/s, indexed read 10k/s, durable write 1–10k/s.',
      'Split reads from writes — the asymmetry tells you where the design effort goes.',
      'Naive raw bytes is the input, not the answer; amplification makes it 5–10× higher.',
      'Amplification factors: indexes, MVCC dead rows, replication or erasure coding, variants, backups.',
      '3× replication versus 1.4× erasure coding is a design assumption, so say it aloud.',
      'Report hot and total storage separately — they are different cost decisions.',
      'Bandwidth = QPS × payload. One multiplication, frequently the binding constraint.',
      'Concurrency = QPS × latency. That sizes pools, not the request rate.',
      'If latency rises tenfold, concurrency does too at the same request rate.',
      'Instances = peak ÷ per-instance × (1 + headroom), with at least 50% headroom.',
      'The one-machine check: under 10 TB, 256 GB working set, 10k QPS, 5k writes/s? Then one machine.',
      'Collisions matter around the square root of the key space, not when it is full.',
      'Say the conclusion the number forces, not just the number.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A short derivation chain — QPS, storage, bandwidth, concurrency, machines — computed from a handful of memorised constants and aggressive rounding, whose output is a set of eliminated design options.',
    whyItExists:
      'Because design decisions are only defensible against numbers: 600,000 reads per second rules out a relational read path, and without the figure the choice is unfalsifiable.',
    whenToUse: [
      'Step 3 of the design loop, before choosing a data model or drawing components.',
      'Before proposing anything distributed — the one-machine check.',
      'Whenever you invent an id or short code, to size the key space.',
      'Whenever a payload might be large, to compute bandwidth.',
    ],
    whenNotToUse: [
      'To more than one or two significant figures in an interview.',
      'On dimensions that change no decision.',
      'As a substitute for measurement, in real capacity planning.',
      'Without stating your assumptions, which makes the figure uncorrectable.',
    ],
    alternatives: [
      'Measured production data, which beats every assumption in real work.',
      'A load test, which validates an estimate before you rely on it.',
      'A range rather than a point, when the inputs do not support precision.',
      'Challenging the requirement, when the estimate produces an unbounded number.',
    ],
    tradeoffs: [
      'Rounding buys speed and costs precision that eliminates nothing further.',
      'Peak provisioning buys survival at peak and costs capacity idle most of the day.',
      'Headroom buys failure tolerance and growth room and costs unused machines.',
      'Erasure coding buys much lower storage overhead and costs reconstruction cost on read.',
      'Tiering buys a smaller hot footprint and costs retrieval latency for old data.',
      'Lazy generation buys enormous compute savings and costs first-request latency.',
    ],
    failureModes: [
      'Reporting raw bytes as the storage estimate, low by 5–10×.',
      'Sizing for average rather than peak.',
      'Omitting headroom, so the first instance failure is an incident.',
      'Never computing bandwidth, missing the binding constraint.',
      'Confusing request rate with concurrency when sizing pools.',
      'Assuming 3× replication where erasure coding is what would be used.',
      'Conflating hot and cold storage into one number.',
      'Never estimating compute, which dominates in media and inference workloads.',
      'Using benchmark per-instance throughput rather than production-mix throughput.',
      'Sizing only the tier you were thinking about, so the limit lands elsewhere.',
      'Computing a number and then proposing a design it rules out.',
      'Proposing a distributed system for something that fits on one machine.',
    ],
    followUpQuestions: [
      'What does this number eliminate?',
      'Is that the average or the peak, and what multiplier did you use?',
      'What amplification factors have you applied to the storage?',
      'Is that hot storage or total?',
      'What is the bandwidth, and can the origin serve it?',
      'What is the concurrency, and what does it size?',
      'What headroom, and across how many zones?',
      'Have you estimated compute, not just storage and requests?',
      'Would one machine do?',
      'Where did the per-instance throughput figure come from?',
      'Which of your assumptions, if wrong by 3×, would change the design?',
    ],
  },
});
