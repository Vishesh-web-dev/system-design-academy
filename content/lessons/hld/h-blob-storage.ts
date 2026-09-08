import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-blob-storage',
  title: 'Design a blob store (S3-like)',
  summary:
    'Two systems with opposite properties in one product: a tiny strongly-consistent metadata service, and an enormous eventually-durable data plane that no request ever passes through.',
  phase: 'hld',
  module: 'core-designs',
  position: 44,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 90,
  tags: ['erasure-coding', 'chunking', 'metadata-service', 'presigned-urls', 'durability'],
  prerequisites: ['h-notifications'],
  resources: [
    {
      key: 'aws-s3-consistency',
      tier: 'must',
      note: 'Read it for the fact that a major object store moved from eventual to strong read-after-write consistency. It is the evidence that the metadata plane\'s consistency model is an engineering choice rather than a constraint.',
    },
    {
      key: 'aws-s3-multipart',
      tier: 'must',
      note: 'The upload protocol this design depends on: parts uploaded independently, then a completion call. Read it for why the completion step exists and what it makes atomic.',
    },
    {
      key: 'gfs-paper',
      tier: 'must',
      note: 'Read the sections on the master, chunk servers and the decision to keep the master out of the data path. That separation is the central idea of this design and it predates every commercial object store.',
    },
    {
      key: 'dropbox-magic-pocket',
      tier: 'good',
      note: 'A published account of building an exabyte store, including the move from replication to erasure coding and what it saved. Read it for the operational reality of running the data plane.',
    },
    {
      key: 'aws-s3-consistency',
      tier: 'good',
      note: 'Worth a second pass specifically on what consistency applies to listings versus individual objects — the two are not the same guarantee, and the difference shapes the metadata index.',
    },
    {
      key: 'consistent-hashing-karger',
      tier: 'advanced',
      note: 'Placement of chunks across a changing fleet is the problem this solves. Read it with the rebalancing cost in mind, since moving petabytes is the operation the placement scheme determines.',
    },
  ],

  intuition: {
    body: `An object store is two systems with opposite properties, and almost every design mistake comes from treating it as one.

**The metadata plane is small, strongly consistent, and on the request path.** It answers "does \`bucket/key\` exist, and where are its bytes?" A billion objects at 1 KB of metadata each is a terabyte — a database, not a distributed storage problem. It needs transactions, unique constraints, and a strong read-after-write guarantee, because a \`PUT\` followed by a \`GET\` returning nothing is the most user-visible failure the system has.

**The data plane is enormous, eventually durable, and off the request path.** It stores the bytes. Exabytes, immutable, written once and read many times. It does not need transactions or listings — it needs to not lose data and to serve sequential reads at enormous bandwidth.

**And the crucial architectural decision: no client request passes through a server that also holds the bytes.**

That sounds odd until you compute it. Uploads at 30,000 objects per second averaging 3 MB is **90 GB/s of inbound bandwidth**. Any application tier in that path would have to be provisioned for 90 GB/s, which is roughly 720 Gb/s and a serious network engineering problem — for a tier whose job is to check a permission and write a row.

So the design inverts: **the API returns a credential, and the client talks to storage directly.** A presigned URL is not a convenience feature; it is the mechanism that keeps the byte path out of the control plane. **The control plane handles thousands of requests per second; the data plane handles gigabytes per second; and they are different fleets because those are different problems.**

Then the two decisions that dominate everything else:

**Chunking.** A 5 TB object cannot be one file on one disk. Split it into fixed-size chunks — 4 MB to 64 MB — placed independently. That makes an object's size unbounded, its upload parallel and resumable, and its read parallel across many disks. **Chunk size is the tuning knob**: small chunks mean more metadata and more parallelism; large chunks mean less metadata and coarser recovery.

**Redundancy: replication or erasure coding.** Three replicas is 3× storage and dead simple. Erasure coding with 10 data and 4 parity fragments gives comparable durability at **1.4×** — less than half the storage for the same protection. At exabyte scale that difference is the largest line in the budget, and it costs CPU on write and a reconstruction read when a fragment is missing.

The framing to carry: **design the metadata plane as a database and the data plane as a storage fabric, and keep every byte out of the control plane.**`,
    analogyLimit:
      '"A giant filesystem" is the model to discard. A filesystem offers mutable files, directory trees, renames and partial writes; an object store offers immutable whole-object writes and a flat key space, and every one of those omissions is what makes it scale. The analogy also hides the two-plane split — a filesystem has one metadata structure on the data path, whereas the entire design here rests on the control plane never touching a byte.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds an object store where clients upload through an API tier: the request arrives, the service authenticates it, streams the body to three storage nodes, writes a metadata row, and returns 200. Traffic is 30,000 uploads/second averaging 3 MB. Identify four things that break, in order of severity.',
      answer: `**Break 1 — the bandwidth of the API tier, and it is not close.**

\`\`\`
30,000 uploads/s × 3 MB = 90 GB/s inbound
And it writes to three replicas: 270 GB/s outbound
Total through the API tier: 360 GB/s ≈ 2.9 Tb/s
\`\`\`

**That tier has to move 2.9 terabits per second** to perform an authentication check and a database insert. At 25 Gb/s per server that is roughly 120 machines doing nothing but copying bytes, and the network fabric to support it is a substantial capital problem.

**The fix is structural, not incremental.** The API returns a presigned credential and the client uploads **directly** to storage nodes. Now the API tier handles 30,000 small requests per second — a few megabits — and the 90 GB/s goes straight to the fleet designed for it. **The byte path and the control path become different fleets because they have different problems**, and no amount of scaling the API tier changes that.

**Break 2 — a 5 TB upload cannot work at all.**

Streaming a 5 TB object through one request means: one connection held for hours, one server's memory and disk involved, no resumability, and total loss on any failure. And the request timeout at every layer — load balancer, proxy, application — will kill it long before it finishes.

**The fix is multipart upload.** The client initiates, uploads parts of, say, 8 MB independently and in parallel, and calls a completion endpoint listing the parts.

Three properties this buys, and each matters on its own:

**Resumability.** A failed part is one 8 MB retry, not a 5 TB restart. Over a mobile connection this is the difference between possible and impossible.
**Parallelism.** Twenty concurrent parts saturate the client's bandwidth instead of one stream.
**Atomicity.** The object does not exist until the completion call, so a half-uploaded object is never visible. **That completion call is the only place in the whole upload where a transaction is needed**, and it makes the object appear atomically.

**Break 3 — 3× replication is more than twice the storage bill it needs to be.**

\`\`\`
90 GB/s × 100,000 s = 9 PB/day of unique data
× 3 replicas         = 27 PB/day stored
× 1.4 erasure coding = 12.6 PB/day stored
\`\`\`

**A saving of 14.4 PB per day**, which at any storage price is the largest single cost decision in the system.

Erasure coding splits each chunk into 10 data fragments and 4 parity fragments, distributed across 14 failure domains. Any 10 of the 14 reconstruct the chunk, so it survives 4 simultaneous losses — **better durability than 3 replicas, which survive 2** — at 1.4× rather than 3×.

**What it costs, and both are real:** encoding CPU on write, and a **reconstruction read** when a fragment is unavailable, which fetches 10 fragments instead of 1 and does arithmetic. So a read that hits a degraded chunk is slower and more expensive.

**The consequence for the design: erasure-code cold data and replicate hot data.** Recent objects, read frequently, get replicas for cheap fast reads; objects past a threshold are re-encoded. **That tiering is the resolution rather than choosing one scheme.**

**Break 4 — the metadata write is in the wrong place, and it is a dual write.**

The service streams bytes to storage and *then* writes the metadata row. Between those two steps:

- Crash after the bytes, before the row: **orphaned data.** Bytes on disk that no metadata references, consuming space forever with nothing to find them.
- Crash after the row, before the bytes complete: **a dangling reference.** \`GET\` returns metadata pointing at bytes that do not exist, so the object appears to exist and cannot be read — which is worse than either.

**This is the dual-write problem, and there is no ordering that removes it.** The resolution is the completion call: parts are uploaded to storage first, and the metadata row is written **once, atomically, at completion**. Before completion the object does not exist; after it, both exist.

**Orphaned parts from abandoned uploads are then handled by a reaper** — a background job deleting parts whose upload was initiated more than, say, 7 days ago and never completed. **That converts an unbounded correctness problem into a bounded storage cost**, which is the right trade.

**In order of severity:** the bandwidth (an architectural impossibility), the large-object path (a whole use case unsupported), the metadata dual write (silent data corruption), and the redundancy scheme (a very large cost). **The first three are correctness or feasibility; only the fourth is money** — and it is the one candidates usually lead with.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
A client can create and delete a bucket
A client can upload an object to bucket/key, of any size up to 5 TB
A client can download an object, or a byte range of it
A client can delete an object
A client can list objects in a bucket, filtered by key prefix
A client can read an object's metadata without its body
A client can grant time-limited access to an object without sharing credentials
A client can set a lifecycle rule to transition or expire objects
\`\`\`

**The clarifying questions that change this design:**

**Are objects mutable?** *No — immutable, whole-object writes only.* This removes partial writes, read-modify-write and locking. **It is the assumption that makes the data plane simple**, and why an object store is not a filesystem.

**Is there a directory hierarchy?** *No — a flat key space*, with prefix listing giving the appearance of directories. **A real hierarchy needs atomic subtree renames**, which is a distributed transaction over an unbounded key set.

**Read-after-write consistency?** *Strong per object; eventual for listings*, because a strongly-consistent global index over a billion keys per bucket is a far harder problem than a point lookup.

**Durability target?** *Eleven nines*, which forces erasure coding across failure domains and continuous background verification.

**Maximum object size?** *5 TB*, which forces chunking and multipart upload.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Durability | 11 nines | Erasure coding across failure domains, background scrubbing |
| Availability (reads) | 99.99% | Multi-zone placement, degraded reads from parity |
| Availability (writes) | 99.9% | Writes may be less available than reads |
| First-byte latency | p99 under 100 ms | Metadata lookup must be fast; data can stream |
| Throughput | 90 GB/s inbound at peak | Clients talk to storage directly — no byte path through the API |
| Consistency | Strong per object, eventual for listings | Two different index designs |

**Out of scope:** authentication and identity, billing and metering, cross-region replication, and the CDN in front of reads. Assume an authenticated principal arrives with each request.

## Step 2 — Estimation

\`\`\`
Uploads:      30,000/s peak, average object 3 MB
              → 90 GB/s inbound
              → 9 PB/day of unique data
Downloads:    300,000/s peak (10:1 read-heavy), average 1 MB served
              (range reads and small objects dominate reads)
              → 300 GB/s outbound
Objects:      1 billion new objects/day
\`\`\`

**Metadata volume — and this is the number that reframes the problem:**

\`\`\`
Object metadata: ~1 KB (bucket, key, size, etag, chunk list, timestamps, ACL ref)
1 billion/day × 1 KB = 1 TB/day of metadata
Over 5 years: ~1.8 PB of metadata
Chunk metadata: 3 MB average ÷ 8 MB chunks ≈ 1 chunk per object
  (but a 5 TB object is 640,000 chunks)
\`\`\`

**1.8 PB of metadata against exabytes of data is roughly 0.2%** — three orders of magnitude smaller, which is why it can be a strongly-consistent partitioned database while the data plane cannot.

\`\`\`
Storage, with erasure coding:
  9 PB/day unique × 1.4 = 12.6 PB/day
  Over a year: 4.6 EB
  With tiering (hot 30 days replicated 3×, rest erasure coded):
    Hot:  9 PB × 30 × 3   = 810 PB
    Cold: 9 PB × 335 × 1.4 = 4.2 EB
\`\`\`

\`\`\`
Storage nodes:
  Each node: 30 TB of disk, 25 Gb/s network
  4.6 EB ÷ 30 TB ≈ 150,000 nodes for capacity
  90 GB/s inbound ÷ 3 GB/s per node ≈ 30 nodes for write bandwidth
  → capacity-bound, not bandwidth-bound, by four orders of magnitude
\`\`\`

**The fleet is sized by disk, not by network**, which means it should optimise for bytes stored rather than throughput — and it is why erasure coding matters more than any latency optimisation.

\`\`\`
Metadata request rate:
  330,000 requests/s peak (uploads + downloads + listings)
  Each needs one metadata lookup
  → 330,000 point reads/s against a partitioned store
  → at 20,000/s per shard, ~20 shards plus replicas
\`\`\`

**The control plane is a modest system: 330,000 point lookups per second against 1.8 PB.** That is a large database and an entirely conventional one. **All the difficulty is in the data plane's scale and durability**, and the estimate is what establishes that.

## Step 3 — API design

\`\`\`
Bucket operations
  PUT    /{bucket}                          → 200
  DELETE /{bucket}                          → 204  (must be empty)
  GET    /{bucket}?prefix=&continuation=    → 200 { keys[], nextContinuation }

Simple object operations (small objects, under ~100 MB)
  PUT    /{bucket}/{key}                    → 200 { etag }
  GET    /{bucket}/{key}                    → 200 body
  GET    /{bucket}/{key}  Range: bytes=...  → 206 partial
  HEAD   /{bucket}/{key}                    → 200 headers only
  DELETE /{bucket}/{key}                    → 204

Multipart upload (large objects)
  POST   /{bucket}/{key}?uploads            → 200 { uploadId }
  PUT    /{bucket}/{key}?uploadId=&partNumber=  → 200 { etag }
  POST   /{bucket}/{key}?uploadId=          → 200 { etag }
         body: [{ partNumber, etag }, ...]        (completion)
  DELETE /{bucket}/{key}?uploadId=          → 204  (abort)

Presigned access
  POST   /presign  { bucket, key, method, expires } → { url, headers }
\`\`\`

**Five decisions worth defending.**

**Multipart completion takes the part list with etags.** The client asserts which parts form the object, and the service verifies each etag matches what it stored. **That check is what makes a corrupted or missing part fail the completion rather than producing a silently wrong object.**

**Range reads are first-class.** A video player requesting bytes 4 MB–8 MB of a 2 GB file must not download 2 GB. Range support maps directly onto chunking: a range request touches only the chunks it overlaps.

**Listings paginate with an opaque continuation token, never an offset**, because an offset over a billion keys forces a scan. And **\`HEAD\` exists separately** because "does this exist and how big is it" is a metadata-only question that must not touch the data plane.

**Presigning is a control-plane operation returning a credential.** The client then uploads or downloads directly. **This single endpoint is what keeps 90 GB/s out of the API tier**, and it is worth stating as the load-bearing API decision rather than a convenience.

## Step 4 — Data model

**The metadata plane, partitioned by bucket and key:**

\`\`\`sql
objects(
  bucket, key,                          -- PARTITION KEY: hash(bucket, key)
  version_id,                           -- for versioning; latest flag
  size, etag, content_type,
  chunk_list,                           -- ordered chunk ids, or a pointer
  storage_class,                         -- hot | cold
  created_at, deleted_at,
  PRIMARY KEY (bucket, key, version_id)
)

-- Secondary index for prefix listing, partitioned differently
object_index(
  bucket,                               -- PARTITION KEY: hash(bucket)
  key,                                  -- SORT KEY: enables prefix scan
  version_id, size, created_at
)

chunks(
  chunk_id,                             -- PARTITION KEY: hash(chunk_id)
  fragment_locations[],                 -- 14 (node, disk, offset) for EC
  checksum, size, encoding_scheme
)

multipart_uploads(
  upload_id, bucket, key, initiated_at,
  parts[]                               -- { part_number, etag, chunk_ids[] }
)
\`\`\`

**Four decisions, and the first two are the important ones.**

**Objects are partitioned by \`hash(bucket, key)\`, so a point lookup is single-partition.** That is the dominant access pattern — 330,000 point reads per second — and it must be one shard.

**Listings need a *different* partitioning, which is why \`object_index\` exists separately.** A prefix scan requires keys to be *ordered* and *co-located*, so the index is partitioned by bucket and sorted by key. **This is the partitioning lesson's conclusion arriving directly: one access pattern is cheap and the other needed a second data path.**

And the cost is stated in the requirements: the index is maintained asynchronously, so **listings are eventually consistent while point reads are strong.** A \`PUT\` followed immediately by a \`LIST\` may not show the object. That is a deliberate, documented trade, and it is why the requirement distinguished the two.

**The hot-bucket problem this creates:** a bucket with a billion objects is one index partition. *Fix:* sub-partition large buckets by key-prefix hash, with listings fanning out and merging — a scatter-gather, acceptable because listings are rare and latency-tolerant.

**Chunks are partitioned by \`chunk_id\`, independent of the object**, so a chunk can be moved or re-encoded without touching object metadata. And **deletion is a tombstone**, because bytes are reclaimed asynchronously.

## Step 5 — Architecture

\`\`\`
                    ┌──────────── CONTROL PLANE ────────────┐
Client ─────────────▶  API service (auth, metadata, presign) │
   │                │        │                               │
   │                │        ▼                               │
   │                │  Metadata store (partitioned, strong)  │
   │                │        │                               │
   │                │        ▼                               │
   │                │  Placement service ──▶ Cluster map     │
   │                └────────┬──────────────────────────────┘
   │                         │ (returns node addresses + token)
   │                         │
   │   presigned URL / direct connection
   ▼                         ▼
┌──────────────────── DATA PLANE ────────────────────────┐
│  Storage nodes: 150,000 × 30 TB                         │
│  · accept fragment writes with a capability token       │
│  · serve fragment reads                                 │
│  · verify checksums on read and on scrub                │
│                                                          │
│  Background services:                                    │
│  · Scrubber      — reads and verifies every chunk        │
│  · Repairer      — reconstructs missing fragments        │
│  · Re-encoder    — replication → erasure coding on age   │
│  · Reaper        — deletes orphaned and tombstoned data  │
│  · Rebalancer    — moves chunks when the fleet changes   │
└──────────────────────────────────────────────────────────┘
\`\`\`

**Why placement is a separate service.** It needs the current cluster map — which nodes exist, are full, are draining, and which failure domain each is in — and that state changes constantly. One service means one authoritative view when placement goes wrong.

**Why the client talks to storage nodes directly:** the bandwidth argument from the prediction. The API returns node addresses plus a short-lived **capability token** the storage node verifies, so a client cannot write to arbitrary nodes.

**Why five background services rather than one.** The scrubber is read-bandwidth-bound and can be slow; the repairer is urgent; the re-encoder is deferrable CPU work; the reaper is cheap; the rebalancer must be throttled hard because it moves petabytes. **Combining them means one throttle for five different urgencies.**

## Step 6 — The deep dive: chunking, placement and erasure coding

**Chunking.** Objects are split into fixed-size chunks — 8 MB here.

*Why fixed rather than variable:* placement, accounting and repair all become uniform. Variable-size chunking earns its complexity only for deduplication across similar objects, which is the file-sync problem rather than the object-store problem.

*Why 8 MB:* smaller means more parallelism and proportionally more chunk metadata; larger means a repair moves more bytes to fix one fragment and small objects waste space. **The dominant consideration is that most objects are smaller than one chunk** — at a 3 MB average, chunking is inert for the common case and engages only for large objects, so the common path has no chunk-assembly cost.

**Erasure coding, concretely.** A chunk is encoded into k data + m parity fragments; any k reconstruct it.

\`\`\`
10+4:  1.4× overhead, tolerates 4 fragment losses
6+3:   1.5× overhead, tolerates 3
3× replication: 3.0× overhead, tolerates 2
\`\`\`

**Better durability at less than half the storage.** That is the whole case.

**Placement determines whether the durability claim is real**, and the rule is arithmetic: **the per-zone fragment limit equals the parity count m**, because losing a zone must leave at least k. And the fragments must fit: \`(k+m) ≤ Z × m\`.

**So 10+4 across 3 zones does not work at all:** 14 fragments over 3 zones means at least 5 in some zone, leaving 9 when 10 are needed. **6+3 with exactly 3 per zone leaves 6, which is exactly enough.** I choose 6+3 for that reason, and the extra 0.1× overhead is the price of a zone-failure story that works.

**A team that "spreads fragments across zones" without computing this discovers at zone-failure time that chunks are unreadable** — the consistent-hashing lesson's replica-placement bug at a different scale. Placement across the fleet uses consistent hashing with virtual nodes, with the walk skipping both nodes and failure domains already chosen.

**Reads have two paths.** A normal read fetches the k data fragments and concatenates — no arithmetic. A degraded read, with a fragment unavailable, fetches k of the survivors and decodes: more bandwidth, more CPU, slower.

**The optimisation that matters:** fragments are ordered so the data fragments alone form the chunk in sequence, so only a *degraded* read pays reconstruction cost. **Without that ordering, every read would decode.**

**Hot data stays replicated**, and that resolves the trade: objects under 30 days get 3× replication for cheap fast reads; older objects are re-encoded to 6+3. **Access falls off steeply with age**, so this puts the cheap-read scheme where the reads are and the cheap-storage scheme where the bytes are — and the transition is the single largest storage saving in the system.

**Durability needs background verification.** Erasure coding protects against *detected* loss and does nothing about **silent corruption** — a disk returning wrong bytes without an error.

So: every fragment carries a checksum, storage nodes verify on every read, and a scrubber reads and verifies every fragment on a rolling cycle. Any mismatch is treated as a lost fragment and repaired.

**Eleven nines is not achievable without this**, because a chunk with too many silently-corrupted fragments is unrecoverable and the system does not know. **The scrub interval is therefore a direct input to the durability figure.**

*And repair must be prioritised by degradation.* A chunk at its minimum fragment count has zero tolerance and must go first. **A FIFO repair queue is a durability bug.**

## Step 7 — What breaks at 10×

**46 EB, 900 GB/s inbound, 3.3 million metadata requests/second.**

**The listing index becomes the hard problem.** Point lookups still scale by partitioning on \`hash(bucket, key)\`, but a bucket with 10 billion objects fans out across many sub-partitions. **At that point listings become an offline-generated inventory report rather than a live API**, which several object stores actually do.

**The scrubber's bandwidth becomes a constraint.** Verifying 46 EB every 30 days is roughly 18 TB/s of read bandwidth — comparable to the serving load. *Fix:* a longer scrub cycle for cold data and a shorter one for recently-repaired chunks. **The scrub interval becomes a tunable durability-versus-cost dial.**

**Small objects dominate metadata cost.** A billion 4 KB objects carry 1 KB of metadata each — a 25% overhead on the data itself. *Fix:* pack small objects into shared chunks with an offset in the metadata, which makes deletion a compaction problem.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| One storage node | Fragments unavailable | Degraded reads succeed; repairer reconstructs to a new node |
| One rack | Many fragments unavailable | Placement guaranteed distinct racks, so reads succeed |
| One zone | Up to 4 fragments per chunk gone | 6+3 with 3 per zone survives; 10+4 with 5 per zone does **not** |
| Metadata shard down | Objects in that shard unreadable | Replicated with automatic failover; reads from a replica |
| Placement service down | New uploads cannot be placed | **Reads unaffected** — writes fail, which is the correct asymmetry |
| Silent disk corruption | Wrong bytes returned | Checksum verification on read rejects it; scrubber finds it proactively |
| Client abandons a multipart upload | Orphaned parts consuming space | Reaper deletes parts older than 7 days |
| Repairer falls behind | Chunks accumulate at low fragment counts | **Durability degrades silently** — must alert on fragment-count distribution |

**Three rows carry the real content.**

**The zone-loss row is the arithmetic from step 6**, and it is the difference between a design that survives a zone failure and one that discovers it does not. **Stating the fragments-per-zone constraint explicitly is what distinguishes a considered answer.**

**Placement service down means writes fail and reads do not.** That asymmetry is deliberate: reads need only the metadata store and the storage nodes, so the write path can be less available than the read path — which the requirements permitted.

**A repairer falling behind degrades durability silently.** Nothing user-visible happens; chunks simply sit closer to unrecoverable. **So the alert is on the *distribution* of fragment counts** — "how many chunks have fewer than 12 of 14 fragments" — not on the repairer's queue depth. This is the observability lesson's point: the outcome metric, not the mechanism metric.

## Step 9 — Defending it

**"I split this into a small strongly-consistent control plane and an enormous eventually-durable data plane, and kept every byte out of the control plane.** 90 GB/s inbound through an API tier is 2.9 Tb/s of copying to do an auth check and a database insert, so presigned direct-to-storage is not a feature — it is the only viable shape.

**I made objects immutable with a flat key space.** That removes partial writes, locking, and atomic subtree renames — which is the hardest thing a filesystem does and which nobody asked for. Prefix listing provides the appearance of hierarchy.

**I chose strong consistency for point reads and eventual for listings**, because they need opposite index partitionings. Making listings strong would mean a synchronous cross-partition write on every upload, for an access pattern that is rare and latency-tolerant.

**I chose 6+3 with exactly 3 fragments per zone for cold data, and 3× replication for hot data.** 6+3 costs 0.1× more storage than 10+4 and survives a zone loss, which 10+4 across three zones does not. The tiering puts cheap reads where the reads are and cheap storage where the bytes are.

**What I gave up:** listings are eventually consistent; a degraded read is slower and costs 10× the bandwidth; re-encoding is a continuous background CPU cost; and a 5 TB object is 640,000 chunks of metadata, so very large objects are metadata-expensive.

**What would make me revisit it:** if the workload became small-object-dominated, the metadata overhead would exceed 20% of the data and I would pack small objects into shared chunks — which makes deletion a compaction problem and is a significant change. And if listings needed to be strongly consistent, I would have to make the index a synchronous part of the write, which turns every upload into a cross-partition write."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'two-planes',
      title: 'Two planes, and no byte crosses the control plane',
      caption:
        'Step through it. The dashed separation is the design: the control plane handles thousands of small requests and the data plane handles gigabytes per second, and they are different fleets because those are different problems.',
      nodes: [
        { id: 'client', label: 'Client', kind: 'client', x: 0, y: 200, detail: 'Uploads 30,000 objects/second averaging 3 MB — 90 GB/s. Any tier in this path would need 2.9 Tb/s to do an auth check and a database insert.' },
        { id: 'api', label: 'API service', kind: 'service', x: 190, y: 90, detail: 'Authenticates, writes metadata, and returns a presigned URL plus a capability token. Handles 330,000 small requests/second — a few megabits, not gigabytes.' },
        { id: 'meta', label: 'Metadata store', kind: 'store', x: 400, y: 40, detail: '1.8 PB over five years — 0.2% of the data. Partitioned by hash(bucket, key) so a point read is single-shard, strongly consistent, with transactions at the completion call.' },
        { id: 'index', label: 'Listing index', kind: 'store', x: 400, y: 140, detail: 'A SECOND data path: partitioned by bucket, sorted by key, so a prefix scan is a seek. Maintained asynchronously, which is why listings are eventually consistent while point reads are strong.' },
        { id: 'place', label: 'Placement service', kind: 'service', x: 190, y: 190, detail: 'Holds the cluster map and chooses 9 fragment locations in distinct failure domains. Its unavailability fails writes and leaves reads working — a deliberate asymmetry.' },
        { id: 'nodes', label: '150,000 storage nodes', kind: 'store', x: 400, y: 290, detail: 'Client writes fragments here DIRECTLY, presenting the capability token. Fleet is sized by disk (150,000 nodes for capacity) not by network (30 for bandwidth) — four orders of magnitude apart.' },
        { id: 'scrub', label: 'Scrubber + repairer', kind: 'service', x: 640, y: 200, detail: 'Erasure coding protects against detected loss; only checksum verification catches silent corruption. The scrub interval is a direct input to the durability figure.' },
        { id: 'reenc', label: 'Re-encoder', kind: 'service', x: 640, y: 300, detail: 'Moves objects past 30 days from 3× replication to 6+3 erasure coding at 1.5×. The single largest storage saving in the system, and entirely deferrable.' },
        { id: 'reaper', label: 'Reaper', kind: 'service', x: 640, y: 100, detail: 'Deletes fragments from multipart uploads abandoned more than 7 days ago. Converts an unbounded orphan problem into a bounded storage cost.' },
      ],
      edges: [
        { id: 'b1', source: 'client', target: 'api', kind: 'sync' },
        { id: 'b2', source: 'api', target: 'meta', kind: 'write' },
        { id: 'b3', source: 'meta', target: 'index', kind: 'async' },
        { id: 'b4', source: 'api', target: 'place', kind: 'sync' },
        { id: 'b5', source: 'client', target: 'nodes', kind: 'write' },
        { id: 'b6', source: 'place', target: 'nodes', kind: 'control' },
        { id: 'b7', source: 'nodes', target: 'scrub', kind: 'async' },
        { id: 'b8', source: 'nodes', target: 'reenc', kind: 'async' },
        { id: 'b9', source: 'nodes', target: 'reaper', kind: 'async' },
      ],
      steps: [
        {
          id: 'bp1',
          title: 'The control plane returns a credential, not a byte path',
          description:
            'Authenticate, reserve metadata, choose placement, return a presigned URL and a capability token. This is the decision that keeps 90 GB/s out of a tier whose job is an auth check.',
          nodes: ['client', 'api', 'place'],
          edges: ['b1', 'b4'],
        },
        {
          id: 'bp2',
          title: 'Two metadata indexes, because two access patterns',
          description:
            'Point lookups are partitioned by hash(bucket, key) and strongly consistent. Prefix listing needs keys ordered and co-located, so it is a separate asynchronously-maintained index — and therefore eventually consistent.',
          nodes: ['meta', 'index'],
          edges: ['b2', 'b3'],
        },
        {
          id: 'bp3',
          title: 'The client writes fragments directly',
          description:
            'Nine fragments to nine distinct failure domains, presenting the capability token. The fleet is capacity-bound rather than bandwidth-bound by four orders of magnitude, which is why storage efficiency dominates.',
          nodes: ['nodes'],
          edges: ['b5', 'b6'],
        },
        {
          id: 'bp4',
          title: 'Durability comes from verification, not from coding alone',
          description:
            'Erasure coding handles detected loss; silent corruption is caught only by checksums on read and by the scrubber. Eleven nines is not reachable without a scrub cycle faster than correlated failures accumulate.',
          nodes: ['scrub'],
          edges: ['b7'],
        },
        {
          id: 'bp5',
          title: 'And three background services with three different urgencies',
          description:
            'The repairer is urgent and prioritised by how degraded each chunk is; the re-encoder is deferrable CPU work worth petabytes; the reaper is cheap. Combining them would mean one throttle for three urgencies.',
          nodes: ['reenc', 'reaper'],
          edges: ['b8', 'b9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'redundancy-arithmetic',
      title: 'Erasure coding, and the fragments-per-zone constraint',
      caption:
        'The red box is the error a "spread across zones" placement makes. Losing a zone must leave at least the data-fragment count available, and that arithmetic is the design rather than a detail.',
      code: `flowchart TB
    Q["9 PB/day of unique data.<br/>What redundancy?"]

    Q --> R3["**3× replication**<br/>3.0× storage<br/>Survives 2 failures"]
    R3 --> R3a["27 PB/day stored.<br/>Cheap reads: no decoding.<br/>Simple repair: copy one file"]

    Q --> EC1["**10+4 erasure coding**<br/>1.4× storage<br/>Survives 4 failures"]
    EC1 --> EC1a["12.6 PB/day stored —<br/>saves 14.4 PB/day"]
    EC1a --> EC1b["**But across 3 zones:**<br/>14 fragments = 5 per zone.<br/>Lose a zone → 9 left.<br/>Need 10. **UNREADABLE**"]

    Q --> EC2["**6+3 erasure coding**<br/>1.5× storage<br/>Survives 3 failures"]
    EC2 --> EC2a["Exactly 3 per zone<br/>across 3 zones"]
    EC2a --> EC2b["Lose a zone → 6 left.<br/>Need 6. **Survives**, plus<br/>one more failure elsewhere"]

    R3a --> T["**Tier by age**"]
    EC2b --> T
    T --> T1["Hot (30 days): 3× replication —<br/>cheap fast reads where reads are"]
    T --> T2["Cold: 6+3 at 1.5× —<br/>cheap storage where bytes are"]

    style EC1b fill:#2a1a1a,stroke:#a04848
    style EC2b fill:#17272a,stroke:#35897e
    style T1 fill:#17272a,stroke:#35897e
    style T2 fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['amazon', 'google'],
    body: `Two published systems bracket this design, and the more interesting lesson is where they disagree.

**GFS established the two-plane split, and stated the reason plainly.** A single master holds all metadata — the file namespace and the mapping from files to chunks — and **clients contact the master only to learn where chunks are, then read and write to chunk servers directly.** The paper is explicit that keeping the master out of the data path is what allows the metadata to be small enough for one machine's memory while the data scales arbitrarily.

Three GFS decisions this design inherits:

**Large chunks, for a reason.** GFS used 64 MB, deliberately, to keep metadata small enough to hold in memory and to reduce client–master interaction. **This design chose 8 MB because the average object is 3 MB** — a different workload gives a different answer to the same trade, and knowing why the number differs is more useful than knowing either number.

**Metadata in memory, operations logged.** The master's state is small enough to be resident, with a persistent operation log for recovery. That is the "metadata is 0.2% of data" observation, exploited.

**Checksums per block, verified on read.** GFS assumed component failure was normal and silent corruption was routine. **This design's scrubber is that assumption taken to its conclusion.**

**S3's move from eventual to strong read-after-write consistency is the more instructive data point**, because it shows what this design's consistency requirement actually costs.

For years, S3 was eventually consistent for overwrites and deletes, and applications built elaborate workarounds — retry loops, external consistency layers, naming schemes that avoided overwrites. Then it moved to strong read-after-write for all operations, **at no additional cost to users.**

**What that tells you: the metadata plane's consistency model is an engineering choice, not a physical constraint.** A candidate who says "object stores are eventually consistent" is describing a decision that was reversed, not a property of distributed storage. And it validates this design's split — **strong for point reads is achievable; strong for listings is a materially harder problem**, and S3's guarantee is about individual objects rather than about listings.

**Where the published systems and this design differ, and it is worth naming.** GFS optimised for large sequential reads of enormous files by a small number of trusted clients inside one organisation. This design assumes many small objects, untrusted external clients, and range reads. **So GFS's single master is unavailable to us** — untrusted clients at 330,000 requests/second need a partitioned, replicated metadata tier and a capability-token model that GFS did not need.

**The transferable lessons.**

**Compute the metadata-to-data ratio.** If it is a fraction of a percent, the metadata plane is a database problem and the data plane is a separate one. That single number licenses the whole two-plane architecture.

**Keep the control plane out of the byte path**, and use a credential rather than a proxy to do it.

**Assume silent corruption.** Checksums on every fragment, verified on read and on a rolling scrub, or the durability figure is aspirational.

**And be specific about which consistency guarantee applies to what.** "Strongly consistent" applied to an object store means point reads, and applying it to listings is a much larger claim.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on. Rows include the arithmetic where it is what settles the choice.',
    rows: [
      {
        option: 'Bytes through the API tier',
        whenItWins:
          'Small scale, or where a proxy is needed for transformation or inspection on the write path.',
        whenItLoses:
          'At any meaningful throughput. 90 GB/s inbound plus replication is ~2.9 Tb/s through a tier doing an auth check.',
        cost:
          'A copy tier sized for total bandwidth, and it becomes the system\'s capacity ceiling.',
      },
      {
        option: 'Presigned direct-to-storage',
        whenItWins:
          'Always at scale. The control plane handles small requests; the data plane handles bytes.',
        whenItLoses:
          'When the write path must inspect or transform content, which then needs a separate processing step after upload.',
        cost:
          'A capability-token model, and the client must be able to reach storage nodes.',
      },
      {
        option: 'Single-request upload only',
        whenItWins:
          'Objects under a few hundred megabytes on reliable connections.',
        whenItLoses:
          'For large objects: no resumability, no parallelism, and every layer\'s request timeout kills it.',
        cost:
          'Total loss on any failure, and a whole use case unsupported.',
      },
      {
        option: 'Multipart upload with a completion call',
        whenItWins:
          'Any object above a threshold. Resumable, parallel, and the completion call makes the object appear atomically.',
        whenItLoses:
          'For tiny objects, where the three-round-trip protocol is overhead.',
        cost:
          'Orphaned parts from abandoned uploads, needing a reaper — a bounded storage cost.',
      },
      {
        option: '3× replication',
        whenItWins:
          'Hot data. No decoding on read, simple repair by copying one file, and a straightforward mental model.',
        whenItLoses:
          'At scale, on cost: 3.0× versus 1.4–1.5× is more than double the storage bill for worse failure tolerance.',
        cost:
          '3× storage, and it tolerates only 2 simultaneous failures.',
      },
      {
        option: 'Erasure coding, 10+4',
        whenItWins:
          'Maximum storage efficiency at 1.4×, tolerating 4 failures.',
        whenItLoses:
          'Across three zones — 14 fragments means 5 per zone, and losing a zone leaves 9 when 10 are needed. **Unreadable.**',
        cost:
          '1.4× storage and a zone-loss story that does not work without more zones.',
      },
      {
        option: 'Erasure coding, 6+3 with 3 per zone',
        whenItWins:
          'Cold data across three zones. Survives a full zone loss plus one more failure, at 1.5×.',
        whenItLoses:
          'When storage cost dominates absolutely and more zones are available to make a wider scheme safe.',
        cost:
          '1.5× rather than 1.4×, plus reconstruction cost on degraded reads.',
      },
      {
        option: 'Strong consistency for listings',
        whenItWins:
          'When applications use listings for correctness rather than for browsing.',
        whenItLoses:
          'Generally. It requires a strongly-consistent global index over a billion keys per bucket, making every upload a cross-partition write.',
        cost:
          'A synchronous secondary-index write on every upload.',
      },
      {
        option: 'Eventually-consistent listings, strong point reads',
        whenItWins:
          'The right default. Two access patterns get two index partitionings, and the rare latency-tolerant one absorbs the staleness.',
        whenItLoses:
          'When a client uploads and immediately lists, which will not show the object.',
        cost:
          'A documented staleness window on listings, and clients that must not depend on them.',
      },
      {
        option: 'One background service for all maintenance',
        whenItWins:
          'Nowhere. Scrubbing, repair, re-encoding, reaping and rebalancing have different urgencies.',
        whenItLoses:
          'Immediately: one throttle for five urgencies means urgent repair competes with deferrable re-encoding.',
        cost:
          'Repair latency coupled to background work, which degrades durability.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The client uploads to our API service, which writes to three storage nodes and returns 200."',
      whyWeak:
        'At 30,000 uploads/second averaging 3 MB, that tier moves 90 GB/s inbound and 270 GB/s outbound — 2.9 Tb/s to perform an authentication check and a database insert. It is an architectural impossibility, not an optimisation opportunity.',
      strongAnswer:
        '"No byte should pass through the control plane. The API authenticates, reserves metadata, asks the placement service for fragment locations, and returns a presigned URL with a short-lived capability token. The client then writes fragments directly to storage nodes. That leaves the API tier handling 330,000 small requests per second — a few megabits — while the 90 GB/s goes to the fleet designed for it."',
    },
    {
      weakAnswer: '"We use 3× replication for durability, which gives us eleven nines."',
      whyWeak:
        'Two problems. 3× costs 3.0× storage where erasure coding gives better failure tolerance at 1.4–1.5×, which at exabyte scale is the largest line in the budget. And replication alone does not give eleven nines — silent corruption is undetected by replication, so without checksums and scrubbing the figure is aspirational.',
      strongAnswer:
        '"I would replicate hot data for cheap reads and erasure-code cold data — 6+3 at 1.5× tolerating three failures. And replication or coding only protects against *detected* loss: silent corruption needs a checksum per fragment, verified on every read and on a rolling scrub. The scrub interval is a direct input to the durability figure, because a chunk with too many silently-corrupted fragments is unrecoverable and the system does not know."',
    },
    {
      weakAnswer: '"We erasure-code 10+4 and spread the 14 fragments across our three availability zones."',
      whyWeak:
        'Fourteen fragments across three zones is roughly five per zone. Losing a zone leaves nine fragments, and a 10+4 scheme needs ten to reconstruct. **The chunk is unreadable** — the design does not survive the failure it was spread across zones to survive.',
      strongAnswer:
        '"That arithmetic does not work: 14 fragments across 3 zones is 5 per zone, so losing a zone leaves 9 and I need 10. I would use 6+3 with exactly 3 fragments per zone — losing a zone leaves 6, which is exactly what 6+3 needs, plus tolerance for one more failure elsewhere. It costs 1.5× rather than 1.4×, and it actually survives a zone loss. Placement has to enforce the per-domain count explicitly rather than just spreading."',
    },
    {
      weakAnswer: '"The service writes the bytes, then writes the metadata row."',
      whyWeak:
        'A dual write with no ordering that helps. Crash after the bytes gives orphaned data consuming space forever; crash after the row gives a dangling reference, so the object appears to exist and cannot be read — which is worse.',
      strongAnswer:
        '"That is a dual write and no ordering removes it. The resolution is the multipart completion call: parts go to storage first, and the metadata row is written once, atomically, at completion. Before completion the object does not exist; after it, both exist. Orphaned parts from abandoned uploads are handled by a reaper deleting anything initiated more than seven days ago — which converts an unbounded correctness problem into a bounded storage cost."',
    },
    {
      weakAnswer: '"Object metadata and listings both come from the same partitioned table."',
      whyWeak:
        'The two access patterns need opposite partitionings. A point lookup wants `hash(bucket, key)` so it is single-shard; a prefix listing wants keys ordered and co-located within a bucket. One table cannot serve both efficiently, and choosing either makes the other a scatter-gather.',
      strongAnswer:
        '"Two indexes, because two access patterns. Objects are partitioned by `hash(bucket, key)` so a point read is single-shard and strongly consistent — that is 330,000 requests per second and it must be one shard. The listing index is partitioned by bucket and sorted by key so a prefix scan is a seek, and it is maintained asynchronously. The consequence, which I would document: listings are eventually consistent while point reads are strong."',
    },
    {
      weakAnswer: '"A background job scrubs, repairs and rebalances the fleet."',
      whyWeak:
        'These have completely different urgencies. Repair of a chunk down to its minimum fragment count is urgent and durability-critical; re-encoding is entirely deferrable; rebalancing moves petabytes and must be throttled hard. One job means one throttle for three urgencies, so urgent repair competes with deferrable work.',
      strongAnswer:
        '"Separate services, because the urgencies differ. The repairer is prioritised by how degraded each chunk is — a chunk at its minimum fragment count has zero tolerance and must go first, so a FIFO repair queue is a durability bug. The scrubber is read-bandwidth-bound and can be slow. The re-encoder is deferrable CPU work. The rebalancer must be throttled to a fixed fraction of network capacity. And I would alert on the *distribution* of fragment counts, not on repair queue depth, because a repairer falling behind degrades durability with nothing user-visible happening."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hb-1',
      front: 'What are the two planes, and how do their properties differ?',
      back: 'A small strongly-consistent metadata plane on the request path, and an enormous eventually-durable data plane off it. Metadata is ~0.2% of data, which is what licenses the split.',
      topic: 'metadata-service',
    },
    {
      id: 'fc-hb-2',
      front: 'Why must no byte pass through the control plane?',
      back: '30,000 uploads/s at 3 MB is 90 GB/s inbound, and with replication ~2.9 Tb/s — to perform an auth check and a database insert.',
      topic: 'presigned-urls',
    },
    {
      id: 'fc-hb-3',
      front: 'What is a presigned URL actually for?',
      back: 'Keeping the byte path out of the control plane. The API returns a credential and the client talks to storage directly — it is the load-bearing API decision, not a convenience.',
      topic: 'presigned-urls',
    },
    {
      id: 'fc-hb-4',
      front: 'What three things does multipart upload buy?',
      back: 'Resumability (a failed part is one retry), parallelism (many concurrent parts), and atomicity (the object exists only after the completion call).',
      topic: 'chunking',
    },
    {
      id: 'fc-hb-5',
      front: 'Where is the only transaction in an upload?',
      back: 'The completion call. Parts go to storage first; the metadata row is written once, atomically, at completion — which resolves the dual write.',
      topic: 'chunking',
    },
    {
      id: 'fc-hb-6',
      front: 'How is chunk size chosen?',
      back: 'Smaller means more parallelism and more metadata; larger means coarser repair and wasted space on small objects. At a 3 MB average, 8 MB means the common case is one chunk.',
      topic: 'chunking',
    },
    {
      id: 'fc-hb-7',
      front: 'Compare 3× replication with 10+4 erasure coding.',
      back: '3.0× storage tolerating 2 failures, versus 1.4× tolerating 4. Better durability at less than half the storage — the largest cost decision in the system.',
      topic: 'erasure-coding',
    },
    {
      id: 'fc-hb-8',
      front: 'Why does 10+4 across three zones not survive a zone loss?',
      back: '14 fragments over 3 zones is ~5 per zone. Losing a zone leaves 9, and 10 are needed to reconstruct. 6+3 with exactly 3 per zone leaves 6, which is exactly enough.',
      topic: 'erasure-coding',
    },
    {
      id: 'fc-hb-9',
      front: 'Why does a normal erasure-coded read need no decoding?',
      back: 'Fragments are ordered so the data fragments alone form the chunk in sequence. Only a *degraded* read — with a fragment missing — pays reconstruction cost.',
      topic: 'erasure-coding',
    },
    {
      id: 'fc-hb-10',
      front: 'Why replicate hot data and erasure-code cold data?',
      back: 'Access falls off steeply with age, so replication gives cheap fast reads where the reads are, and coding gives cheap storage where the bytes are.',
      topic: 'durability',
    },
    {
      id: 'fc-hb-11',
      front: 'What does erasure coding not protect against?',
      back: 'Silent corruption. It handles *detected* loss; bit rot needs a checksum per fragment, verified on read and by a rolling scrubber.',
      topic: 'durability',
    },
    {
      id: 'fc-hb-12',
      front: 'Why is a FIFO repair queue a durability bug?',
      back: 'A chunk at its minimum fragment count has zero remaining tolerance and must be repaired first. FIFO repairs safe and urgent chunks at the same rate.',
      topic: 'durability',
    },
    {
      id: 'fc-hb-13',
      front: 'Why do point reads and listings need different indexes?',
      back: 'A point lookup wants `hash(bucket, key)` for single-shard reads; a prefix scan wants keys ordered and co-located per bucket. One table cannot serve both.',
      topic: 'metadata-service',
    },
    {
      id: 'fc-hb-14',
      front: 'What should you alert on for durability?',
      back: 'The distribution of fragment counts — how many chunks are below a threshold — not repair queue depth. A repairer falling behind degrades durability with nothing user-visible.',
      topic: 'durability',
    },
  ],

  quiz: [
    {
      id: 'q-hb-1',
      kind: 'scenario',
      prompt:
        'Uploads are 30,000/second averaging 3 MB, streamed through an API tier that writes to three replicas. What bandwidth must that tier sustain, and what is the fix?',
      options: [
        { id: 'a', label: 'About 2.9 Tb/s — 90 GB/s in plus 270 GB/s out. The fix is presigned direct-to-storage so no byte crosses the control plane' },
        { id: 'b', label: 'About 90 GB/s, which is manageable with enough instances' },
        { id: 'c', label: 'About 720 Gb/s, and the fix is compression' },
        { id: 'd', label: 'Bandwidth is not the constraint; the metadata writes are' },
      ],
      correct: ['a'],
      explanation:
        '30,000 × 3 MB = 90 GB/s inbound, and fanning out to three replicas is 270 GB/s outbound — 360 GB/s total, roughly 2.9 Tb/s. That is a capital network problem for a tier performing an auth check and an insert. Compression does not help data that is already compressed, and metadata writes are trivial by comparison.',
      difficulty: 'core',
      topic: 'presigned-urls',
    },
    {
      id: 'q-hb-2',
      kind: 'scenario',
      prompt:
        'A 10+4 erasure-coded chunk has its 14 fragments spread evenly across three availability zones. One zone is lost. What happens?',
      options: [
        { id: 'a', label: 'The chunk is unreadable — 5 fragments per zone means 9 remain, and 10 are required to reconstruct' },
        { id: 'b', label: 'The chunk is readable via a degraded read from the remaining 9 fragments' },
        { id: 'c', label: 'The chunk is readable because parity fragments can substitute for any loss' },
        { id: 'd', label: 'It depends on whether the lost fragments were data or parity' },
      ],
      correct: ['a'],
      explanation:
        'A k+m scheme needs any k of the k+m fragments. 14 across 3 zones is ~5 per zone, so a zone loss leaves 9 against a requirement of 10 — regardless of which fragments they were. This is the placement arithmetic that must be computed rather than assumed, and 6+3 with exactly 3 per zone is the scheme that works here.',
      difficulty: 'advanced',
      topic: 'erasure-coding',
    },
    {
      id: 'q-hb-3',
      kind: 'scenario',
      prompt:
        'A service writes an object\'s bytes to storage, then writes its metadata row, and crashes between the two. What state results, and what is the design fix?',
      options: [
        { id: 'a', label: 'Orphaned bytes with no metadata referencing them — resolved by writing metadata atomically at a completion call, plus a reaper for abandoned parts' },
        { id: 'b', label: 'A dangling metadata reference to bytes that do not exist' },
        { id: 'c', label: 'Nothing; the storage write is idempotent so a retry corrects it' },
        { id: 'd', label: 'The object is visible but its size is wrong' },
      ],
      correct: ['a'],
      explanation:
        'This ordering gives orphaned data — bytes consuming space with nothing to find them. The reverse ordering gives the dangling reference, which is worse because the object appears to exist and cannot be read. Neither ordering removes the dual write; the completion call does, by making the metadata write the single atomic point at which the object begins to exist.',
      difficulty: 'core',
      topic: 'metadata-service',
    },
    {
      id: 'q-hb-4',
      kind: 'scenario',
      prompt:
        'A client uploads an object successfully, then immediately lists the bucket prefix and does not see it. Is this a bug?',
      options: [
        { id: 'a', label: 'No — point reads are strongly consistent while the listing index is maintained asynchronously, which is a documented and deliberate trade' },
        { id: 'b', label: 'Yes — a successful upload must be visible in all read paths immediately' },
        { id: 'c', label: 'Yes — the metadata write did not commit before the response was returned' },
        { id: 'd', label: 'No — listings are always cached for 60 seconds' },
      ],
      correct: ['a'],
      explanation:
        'The two access patterns need opposite partitionings, so the listing index is a second data path maintained asynchronously. Making it strongly consistent would require a synchronous cross-partition write on every upload, for an access pattern that is rare and latency-tolerant. A `GET` of the object by key does see it immediately.',
      difficulty: 'core',
      topic: 'metadata-service',
    },
    {
      id: 'q-hb-5',
      kind: 'scenario',
      prompt:
        'The system claims eleven nines of durability from 6+3 erasure coding. What is missing from that claim?',
      options: [
        { id: 'a', label: 'Detection of silent corruption — coding handles detected loss, so checksums verified on read and by a rolling scrubber are required' },
        { id: 'b', label: 'Nothing; 6+3 tolerating three failures is sufficient for eleven nines' },
        { id: 'c', label: 'Cross-region replication, without which eleven nines is impossible' },
        { id: 'd', label: 'More parity fragments, since three is too few' },
      ],
      correct: ['a'],
      explanation:
        'A disk returning wrong bytes without an error is invisible to erasure coding, so corrupted fragments accumulate and a chunk becomes unrecoverable without the system knowing. Checksums plus a scrub cycle faster than correlated failures accumulate is what makes the figure real — which is why the scrub interval is an input to the durability calculation.',
      difficulty: 'advanced',
      topic: 'durability',
    },
    {
      id: 'q-hb-6',
      kind: 'multi',
      prompt:
        'Which are true about the background maintenance services? Select all that apply.',
      options: [
        { id: 'a', label: 'Repair must be prioritised by how degraded each chunk is, not FIFO' },
        { id: 'b', label: 'Re-encoding replicated data to erasure coding is deferrable but is the largest storage saving' },
        { id: 'c', label: 'The rebalancer must be throttled, since it moves petabytes when the fleet changes' },
        { id: 'd', label: 'Combining them into one service simplifies throttling and is the right choice' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three follow from each service having a different urgency and resource profile. Combining them is the error: one throttle for five urgencies means urgent repair — which is durability-critical — competes for capacity with entirely deferrable re-encoding.',
      difficulty: 'core',
      topic: 'durability',
    },
  ],

  exercises: [
    {
      id: 'ex-hb-1',
      kind: 'design',
      title: 'Compute the durability, then find what breaks it',
      estimatedMinutes: 40,
      prompt: `**Part 1 — placement arithmetic.** For each scheme, say whether it survives a full zone loss, and what the per-zone fragment limit must be. Assume the stated number of zones.

1. 3× replication, 3 zones.
2. 10+4 erasure coding, 3 zones.
3. 10+4 erasure coding, 5 zones.
4. 6+3 erasure coding, 3 zones.
5. 12+4 erasure coding, 4 zones.

**Part 2 — the durability calculation.** Estimate the annual probability of losing a chunk under 6+3 coding, given: 150,000 nodes, an annual disk failure rate of 2%, a mean repair time of 4 hours after detection, and a mean detection time of 1 hour. State your assumptions and say which input the design has most control over.

**Part 3 — five things that break the durability claim.** Not disk failures — things the arithmetic in Part 2 does not model.

Then answer:

- Which input to Part 2 would you invest in improving first?
- Which of your Part 3 items is hardest to detect?
- A customer asks for a stronger durability guarantee. What do you actually change?`,
      rubric: [
        'Each scheme evaluated with the per-zone limit computed, not asserted.',
        'Correctly identifies that 10+4 over 3 zones fails and over 5 zones succeeds.',
        'Part 2 states assumptions and computes a per-chunk annual figure.',
        'Identifies repair time or detection time as the controllable input.',
        'Part 3 names at least four non-disk failure modes.',
        'Includes correlated failure and correlated repair as distinct items.',
        'Identifies silent corruption or a placement bug as hardest to detect.',
        'Final answer changes the controllable inputs rather than only the coding scheme.',
      ],
      modelAnswer: `**Part 1 — placement arithmetic**

The rule: a k+m scheme needs any **k** fragments. Losing a zone must leave at least k. So with Z zones, the per-zone limit is:

\`\`\`
max_per_zone ≤ (k + m) − k = m
\`\`\`

**The per-zone limit equals the parity count.** That is the whole rule, and it is worth stating that way because it makes every case immediate.

And separately, the fragments must *fit*: \`(k + m) ≤ Z × max_per_zone\`, so \`(k+m) ≤ Z × m\`.

**1. 3× replication, 3 zones.**

\`\`\`
k = 1 (any one replica suffices), total = 3, so m = 2
max_per_zone ≤ 2
Fits: 3 ≤ 3 × 2 = 6  ✓
Place 1 per zone
\`\`\`

**Survives a zone loss** — 2 replicas remain, 1 needed. Survives *two* zone losses. Replication is trivially zone-safe, which is part of its appeal.

**2. 10+4 erasure coding, 3 zones.**

\`\`\`
max_per_zone ≤ 4
Fits: 14 ≤ 3 × 4 = 12?  NO — 14 > 12
\`\`\`

**Does not survive, and it cannot be made to.** Fourteen fragments across three zones requires at least ⌈14/3⌉ = 5 in some zone, which exceeds the limit of 4. **The scheme is arithmetically incompatible with three zones**, regardless of how carefully you place.

*This is the key result*, and it is why "spread across zones" is not a placement policy.

**3. 10+4 erasure coding, 5 zones.**

\`\`\`
max_per_zone ≤ 4
Fits: 14 ≤ 5 × 4 = 20  ✓
Place: 3, 3, 3, 3, 2
\`\`\`

**Survives.** Worst case loses 3, leaving 11, and 10 are needed. **So 10+4 is fine — with five zones.** The scheme was never the problem; the zone count was.

**4. 6+3 erasure coding, 3 zones.**

\`\`\`
max_per_zone ≤ 3
Fits: 9 ≤ 3 × 3 = 9  ✓  (exactly)
Place: 3, 3, 3
\`\`\`

**Survives, exactly.** Losing a zone leaves 6, and 6 are needed — **zero margin.** So a zone loss plus *any* additional failure makes the chunk unreadable.

*That is worth stating as a caveat rather than a feature.* The design in the lesson said "plus one more failure elsewhere", which is true only while the zone is up. **During a zone outage, 6+3 across 3 zones has no remaining tolerance**, so repair becomes urgent in a way it is not normally — and a zone outage should trigger accelerated repair to restore margin, not just degraded reads.

**5. 12+4 erasure coding, 4 zones.**

\`\`\`
max_per_zone ≤ 4
Fits: 16 ≤ 4 × 4 = 16  ✓  (exactly)
Place: 4, 4, 4, 4
\`\`\`

**Survives, exactly, with zero margin** — same shape as case 4. Storage overhead 16/12 = 1.33×, which is better than 6+3's 1.5×.

**So case 5 is the best of these for three-or-more-zone deployments with four zones available**: 1.33× overhead, zone-loss survival. **The general conclusion: the scheme should be chosen from the zone count, not the reverse** — and \`(k+m) ≤ Z × m\` is the constraint to check first.

---

**Part 2 — the durability calculation**

**Assumptions, stated:**

\`\`\`
Scheme:              6+3, so 9 fragments, tolerating 3 losses
Node failure rate:   2%/year → each fragment's node fails with p = 0.02
Detection time:      1 hour
Repair time:         4 hours after detection
Total vulnerability window: 5 hours = 5/8760 years ≈ 5.7e-4 years
Failures independent (revisited in Part 3)
\`\`\`

**The reasoning.** A chunk is lost if 4 or more of its 9 fragments are unavailable simultaneously. With repair, "simultaneously" means within the 5-hour window.

**Probability that a given fragment fails within a 5-hour window:**

\`\`\`
p_window = 0.02 × (5 / 8760) ≈ 1.14e-5
\`\`\`

**Probability that 4 or more of 9 fail in that window**, taking the dominant term (exactly 4, since higher terms are vastly smaller):

\`\`\`
C(9,4) = 126
P(4 fail) ≈ 126 × (1.14e-5)^4
         ≈ 126 × 1.69e-20
         ≈ 2.1e-18
\`\`\`

**But that is per window, and there are 8760/5 = 1752 windows per year:**

\`\`\`
Annual per-chunk loss probability ≈ 1752 × 2.1e-18 ≈ 3.7e-15
\`\`\`

**That is roughly fourteen nines per chunk**, comfortably above the eleven-nines target — and it is *per chunk*, so with a trillion chunks the expected annual losses are:

\`\`\`
1e12 chunks × 3.7e-15 ≈ 0.004 chunks/year
\`\`\`

**About one chunk lost every 250 years**, on this model.

**Which input the design most controls: the repair time, and it dominates.**

The loss probability scales as \`window^4\` for the dominant term, and the window is detection plus repair. So:

\`\`\`
Halving the window (5 h → 2.5 h):  loss probability ÷ 2^4 = ÷16
                                    (and ×2 more windows, so ÷8 net)
Doubling it (5 h → 10 h):           loss probability × 8
\`\`\`

**A factor of 8 in durability for a factor of 2 in repair speed.** Nothing else in the model has that leverage — halving the disk failure rate only helps by 2^4 in the same way but is not something the design controls, since it is a property of the hardware.

**And repair time is entirely within the design's control:** repair bandwidth allocation, repair prioritisation by degradation level, and how quickly a failed node's fragments are reconstructed elsewhere. **This is why the repairer is a separate, prioritised service** — the arithmetic says it is the highest-leverage component in the durability story.

*Detection time matters equally* and is cheaper to improve: node health checks at 10-second intervals rather than hourly polling reduces detection from 1 hour to under a minute, which shrinks the window from 5 hours to 4 — a 2.4× durability improvement for a monitoring change.

---

**Part 3 — five things that break the calculation**

Every one of these is a failure the independence assumption in Part 2 excludes.

**1. Correlated failure: fragments in the same failure domain.**

If a placement bug puts 4 fragments on nodes sharing a power supply, a rack switch or a top-of-rack PDU, then one event takes 4 fragments and the chunk is lost immediately. **The 3.7e-15 figure assumed independent failures; a placement bug makes them a single event with probability approaching the rack failure rate — perhaps 1e-3 per year.**

**That is twelve orders of magnitude worse**, which makes placement correctness the single largest durability risk in the system — not the coding scheme, not the repair speed.

**2. Correlated repair: the repair itself causes further failure.**

When a node fails, its fragments are reconstructed by reading from surviving fragments across the fleet. That reconstruction generates a large burst of read load, and **if it is not throttled, the additional load can push marginal disks over the edge** — producing more failures during exactly the window when tolerance is lowest.

*This is why the rebalancer and repairer must be throttled*, and why "repair as fast as possible" is not straightforwardly correct. **Repair speed improves durability up to the point where the repair load itself becomes a failure source**, and finding that point is an empirical question.

**3. Silent corruption accumulating undetected.**

Part 2 modelled *detected* failures. A disk returning wrong bytes without an error is not detected, so **corrupted fragments accumulate silently until a chunk crosses its tolerance threshold — and the system does not know it happened.**

The scrub cycle is the only defence. With a 30-day scrub cycle, a fragment can be silently corrupt for up to 30 days, so the effective vulnerability window for corruption-driven loss is **30 days rather than 5 hours** — which changes the exponent's base by a factor of 144.

**So silent corruption is the failure mode where the scrub interval, not the repair time, is the controlling input.** Two different failure modes with two different levers.

**4. Software bugs writing bad fragments.**

A bug in the encoding path could write fragments that are individually checksum-valid and collectively fail to reconstruct. **Checksums do not catch this** — each fragment is exactly what was written; what was written was wrong.

*Detection requires end-to-end verification:* periodically reconstructing a chunk from its parity fragments and comparing against the data fragments, or storing a whole-object checksum and verifying it after reconstruction. **The whole-object etag is what makes this detectable**, and it should be verified on any degraded read.

*And the correlated version is worse:* a bug affects every chunk written during the affected deployment window, so the losses are not independent at all — they are a cohort.

**5. Operational error.**

An operator decommissioning a rack without draining it; a configuration change reducing the replication factor; a deletion script with a wrong prefix. **These are not in any durability model and they are historically a leading cause of real data loss.**

*Mitigations are procedural rather than architectural:* deletion requires a tombstone period before bytes are reclaimed, decommission requires a drain confirmation, and any operation reducing redundancy requires a check that no chunk drops below a threshold. **A soft-delete window is the single most valuable one** — it converts an irreversible operator error into a recoverable one.

**A sixth worth mentioning: metadata loss.** Part 2 modelled data loss. If a chunk's metadata — its fragment locations — is lost, the bytes exist and are unfindable. **Metadata is 0.2% of the data and 100% of the addressability**, so its durability must be at least as high, and it is a database problem with a completely different failure model.

---

**Which input would I invest in first?**

**Placement correctness, which is not in the model at all.**

The arithmetic says repair time has the most leverage among the *modelled* inputs — a factor of 8 for a factor of 2. But Part 3's first item shows that a placement bug moves the loss probability by **twelve orders of magnitude**, from 3.7e-15 to something like 1e-3.

**So the investment order is:**

1. **Verify placement continuously.** A background auditor that checks, for a sample of chunks, that no failure domain holds more than *m* fragments. **This is cheap and it guards against the largest risk**, and it catches placement bugs introduced by a fleet topology change rather than by code.
2. **Reduce detection time**, from an hour to under a minute. A monitoring change, and it is 2.4× durability.
3. **Reduce repair time**, with prioritisation by degradation level and dedicated repair bandwidth. The highest-leverage modelled input.
4. **Shorten the scrub cycle for recently-written data**, since corruption's window is the scrub interval rather than the repair time.

**Notice that only item 3 is what the arithmetic pointed at.** The model's answer is right within the model, and the model excludes the biggest risk — which is the general lesson: **a durability calculation tells you about the failure mode you modelled, and the losses come from the ones you did not.**

**Which Part 3 item is hardest to detect?**

**Item 4, software bugs writing bad fragments** — because every defence the system has says the data is fine.

- The fragments have valid checksums (they are what was written).
- The scrubber passes (it verifies checksums).
- Reads succeed (normal reads concatenate data fragments and never touch parity).
- The fragment count is complete.

**The corruption is invisible until a degraded read attempts reconstruction**, which may be months or years after the write — and by then the affected cohort is enormous.

*The detection mechanism has to be deliberate:* **periodically reconstruct a sample of chunks from parity alone and compare against the data fragments.** That exercises the path that is otherwise never used until it is needed, and it is the erasure-coding equivalent of the timeouts lesson's point about fallback paths — **a code path that only runs during a failure is the least-tested code in the system.**

*Runner-up: item 1, a placement bug*, because it is also invisible until the correlated failure occurs. The difference is that placement is *checkable* — you can audit the current placement of any chunk at any time — whereas reconstruction correctness requires actually doing the reconstruction.

**A customer asks for a stronger durability guarantee. What do I actually change?**

**Not the coding scheme, which is where the conversation usually goes.**

Going from 6+3 to 6+4 improves the modelled figure by roughly another four orders of magnitude and costs 1.67× storage instead of 1.5×. **But the modelled figure was already fourteen nines, and the actual losses come from Part 3.** So paying 11% more storage to improve a number that is not the binding constraint is a poor trade.

**What I would change, in order:**

**1. Reduce detection and repair time.** Sub-minute detection and prioritised repair, targeting a 1-hour total window instead of 5. **This improves the modelled figure by ~100× and costs monitoring plus repair bandwidth**, not storage.

**2. Add continuous placement auditing.** Addresses the twelve-orders-of-magnitude risk. Cheap.

**3. Add reconstruction verification.** Periodically reconstruct from parity and compare, catching the class of bug nothing else catches.

**4. Shorten the scrub cycle**, particularly for recently-written data where a systematic write bug would be concentrated.

**5. Add a soft-delete window and drain confirmations.** Addresses operator error, which is historically a leading cause of real loss and appears in no model.

**6. Only then, consider more parity** — and if the customer's requirement is about surviving a *region* loss rather than a disk loss, the answer is cross-region replication, which is a different and much more expensive conversation.

**And what I would tell the customer:** the guarantee is limited by placement correctness, corruption detection and operational safety rather than by the coding scheme — **so the honest answer to "make it more durable" is "here is what we are doing about the failure modes the number does not cover", not "here is a bigger number".** A durability figure derived from disk failure rates alone overstates the guarantee, and saying so is more credible than quoting more nines.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hb-1',
      level: 'basic',
      question: 'Design an object store. Where do you start?',
      guidance:
        'With the metadata-to-data ratio, which licenses the two-plane split, and with the upload bandwidth, which forces presigned direct-to-storage. A strong answer establishes both before drawing anything.',
    },
    {
      id: 'iq-hb-2',
      level: 'basic',
      question: 'Why are objects immutable with a flat key space?',
      guidance:
        'Immutability removes partial writes, locking and read-modify-write; a flat key space removes atomic subtree renames, which is the hardest thing a filesystem does. Look for these framed as enabling simplifications.',
    },
    {
      id: 'iq-hb-3',
      level: 'intermediate',
      question: 'Replication or erasure coding?',
      guidance:
        'Both, tiered by age — replication for hot data\'s cheap reads, coding for cold data\'s cheap storage. A strong answer gives the overhead figures and notes that coding tolerates more failures at less than half the storage.',
    },
    {
      id: 'iq-hb-4',
      level: 'intermediate',
      question: 'How do you place erasure-coded fragments across three availability zones?',
      guidance:
        'The per-zone limit is the parity count, and (k+m) must fit in Z × m. Look for the arithmetic being computed — 10+4 does not fit in three zones — rather than "spread them across zones".',
    },
    {
      id: 'iq-hb-5',
      level: 'advanced',
      question: 'How do you achieve eleven nines of durability?',
      guidance:
        'Coding plus checksums plus a rolling scrub plus degradation-prioritised repair. Excellent answers note that repair time dominates the modelled figure and that placement correctness dominates the real one.',
    },
    {
      id: 'iq-hb-6',
      level: 'advanced',
      question: 'A 5 TB upload arrives. Trace it.',
      guidance:
        'Initiate, upload parts in parallel with presigned URLs, complete with a part list and etags. Excellent answers name the completion call as the only transaction and the reaper as what bounds abandoned uploads.',
    },
    {
      id: 'iq-hb-7',
      level: 'followup',
      question: 'You said listings are eventually consistent. Why not make them strong?',
      guidance:
        'Point lookups and prefix scans need opposite partitionings, so a strong listing index means a synchronous cross-partition write on every upload — for an access pattern that is rare and latency-tolerant.',
    },
    {
      id: 'iq-hb-8',
      level: 'followup',
      question: 'A customer wants stronger durability. What do you change?',
      guidance:
        'Detection and repair time, placement auditing, reconstruction verification, scrub interval, and operational safeguards — not the coding scheme. A strong answer explains that the real losses come from failure modes the durability model excludes.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hb-1',
      kind: 'what-changes-if',
      prompt:
        'This design assumed objects are immutable and written whole. Now change one thing: clients can perform random writes into the middle of a multi-gigabyte object, like a filesystem. What breaks, and what does the design become?',
      discussion: `Mutability is the assumption the entire data plane rests on, and removing it changes almost everything.

**What breaks immediately.**

**Erasure coding becomes expensive per write.** A 6+3 chunk is encoded from its 6 data fragments together. Modifying 4 KB in the middle means: read the affected chunk's fragments, decode, apply the change, re-encode, and write 9 fragments. **A 4 KB write becomes an 8 MB read plus an 8 MB encode plus a 12 MB write** — write amplification of roughly 5,000×.

*This is why no object store offers random writes over erasure-coded data.* The scheme's efficiency depends on writing a whole chunk once.

**Immutable chunk ids stop working.** Chunk placement, deduplication and caching all assumed a chunk id identifies fixed content. With mutation, either the chunk id changes on every write — invalidating the object's chunk list — or the id stays and the content changes, which breaks every cache and every checksum.

**The etag stops being cheap.** An object's etag is currently computed once at upload. With random writes it must be recomputed on every modification, which for a multi-gigabyte object means reading the whole thing.

**Concurrent writes need coordination.** Two clients writing different byte ranges of the same object is fine physically and requires a consistency decision: are the writes serialised, do they conflict, is there a lock? **Immutability made this question not exist.**

**Range reads may see torn state.** A read spanning a chunk being modified could see part of the old content and part of the new. That requires either per-chunk versioning with a read snapshot, or a lock.

**What the design becomes: a distributed filesystem, and the differences are structural.**

**Chunks become mutable and replicated, not erasure-coded.** Replication supports in-place modification cheaply — write to three copies — where coding does not. **So the storage cost goes from 1.5× to 3×**, and the largest cost saving in the original design is gone.

*Or:* keep erasure coding and add a **write-ahead log per chunk** — modifications append to a log, reads apply the log over the base chunk, and a background compactor periodically re-encodes. **That preserves the storage efficiency and adds read-path complexity plus a compaction cycle**, which is the log-structured approach real systems use.

**Chunk leases replace immutability for coordination.** A client acquires a lease on a chunk to write it, which serialises writers — and brings the whole distributed-locks lesson: lease duration, renewal arithmetic, fencing tokens so a paused holder cannot write after expiry. **GFS did exactly this**, with the master granting chunk leases to a primary replica.

**Versioning per chunk becomes necessary**, so a reader can get a consistent snapshot and a stale replica can be detected.

**Metadata grows and becomes hotter.** Each chunk now has a version, a lease holder and possibly a log offset — and it is written on every modification rather than once. **The metadata plane goes from 330,000 point reads per second to a comparable write rate**, which changes it from a read-optimised store to a mixed workload.

**What survives.**

**The two-plane split, and it matters more.** Metadata is still a small fraction of data, and clients must still talk to storage directly.

**Chunking**, though now as the unit of mutation and locking rather than just of placement.

**Checksums and scrubbing**, though checksums must now be per-block-within-chunk so a partial write does not invalidate the whole chunk's checksum.

**The reaper**, now handling superseded chunk versions rather than abandoned uploads.

**What I would actually do, and it is not "build a filesystem".**

**Ask whether random writes are the requirement or an assumed mechanism.** Most workloads that appear to need them do not:

- **Append-only writes** — logs, event streams — need appends, not random writes. An append-only object with sealed chunks keeps immutability for everything but the tail, which is a much smaller change.
- **Small mutable metadata alongside large immutable data** — the common shape — is better served by putting the mutable part in a database and the immutable part in the object store.
- **Read-modify-write of a whole small object** does not need random writes at all; it needs conditional put on an etag, which the original design already supports.

**Only genuine large-file random access — a database file, a VM disk image — needs the filesystem model**, and for those the right answer is a block store or a filesystem product, not an object store with mutation added.

**The transferable point.** Immutability is not a limitation of object stores; it is the constraint that buys erasure coding, cheap metadata, lock-free concurrency and simple caching. **Adding mutation does not extend the design — it replaces it with a different and substantially harder system**, which is why the two products exist separately. And the useful interview move is to establish which one the requirement actually needs, rather than bolting mutation onto the wrong one.`,
    },
    {
      id: 'al-hb-2',
      kind: 'debug',
      prompt:
        'An object store reports normal metrics: upload success rate 99.99%, read success rate 99.999%, no repair backlog, scrubber up to date. A customer reports that a specific object they uploaded three months ago now returns 500 on every read attempt. Investigation confirms the object metadata is intact and correct. Diagnose it.',
      discussion: `Metadata intact, reads failing, all fleet metrics normal. The metadata being correct is the key constraint: the system knows exactly where the fragments should be, so this is a data-plane fault localised to one chunk — and one chunk out of a trillion is invisible in every aggregate.

**Hypothesis 1 — insufficient fragments available, and the repairer never knew.** The chunk needs 6 of 9 fragments and has fewer. The repairer works from *detected* failures, so if fragments became unavailable in a way that produced no failure signal, no repair was ever queued.

*How that happens:* nodes decommissioned without draining, so their fragments vanished with no failure event. Or a fleet topology change that made some nodes unreachable from the repairer's perspective while they appeared healthy to monitoring.

*Why metrics are normal:* one chunk. And **"no repair backlog" is consistent with "nothing was ever detected as needing repair"** — which is a very different statement and the two are indistinguishable in that metric.

*Check:* attempt to fetch each of the 9 fragment locations directly and count how many respond. This is the definitive test and it takes seconds.

**Hypothesis 2 — the fragments are present and fail to reconstruct.** The software-bug case from the exercise: fragments are individually checksum-valid and collectively wrong, because the encoding path had a bug when this object was written three months ago.

*Why every defence missed it:* checksums pass (each fragment is what was written), the scrubber passes (it verifies checksums), and normal reads never exercise reconstruction — **so the fault is invisible until a degraded read attempts it.**

*Why it fits "three months ago" specifically:* if a deployment window had an encoding bug, the affected objects are a **cohort** defined by write time. **So the critical follow-up is whether other objects written in the same window also fail** — and if they do, this is not one customer's problem.

*Check:* reconstruct the chunk from parity fragments only and compare against the data fragments. And immediately sample other objects written in the same 24-hour window.

**Hypothesis 3 — silent corruption in more fragments than tolerance allows.** More than 3 fragments are corrupt. Coding cannot recover, and the chunk is unrecoverable.

*Why the scrubber missed it:* possible if the scrub cycle is 30 days and corruption accumulated between cycles, though 3 months means several cycles should have run. **More likely: the scrubber verified checksums and the checksums are also corrupt or were never written**, so verification passes trivially.

*Check:* verify each fragment's checksum against a recomputed value, and confirm the checksum itself is present. **A missing checksum that is treated as "valid" rather than as an error is a real and severe bug**, because it makes the scrubber report success on unverifiable data.

**Hypothesis 4 — a placement bug put too many fragments in one failure domain, and that domain had an event.** The exercise's twelve-orders-of-magnitude risk. If 4 fragments landed on one rack and that rack was lost, the chunk went with it — and the repairer would have detected the node failures and attempted repair, but with only 5 fragments left it cannot reconstruct.

*Why it fits:* it explains a single-chunk loss with normal fleet metrics, because a rack loss is a routine handled event that should not have caused data loss.

*Check:* the fragment locations in metadata, mapped to failure domains. **If more than 3 share a domain, this is both the diagnosis and a systemic finding** — other chunks placed during the same period are equally at risk.

**Hypothesis 5 — the metadata is correct and stale.** The fragment locations are valid entries pointing at nodes that were replaced, and the repairer rebuilt the fragments elsewhere without updating the object's chunk list — so the read looks in the old places.

*Why it fits:* metadata "intact and correct" was verified as *well-formed*, not as *current*. **This is a metadata-consistency bug rather than a data-loss event, and it is the best possible outcome** because the data still exists.

*Check:* search for fragments of this chunk id across the fleet, independent of the metadata's locations. If they exist elsewhere, this is it and the object is recoverable.

**What I would check first: fetch each of the 9 fragment locations and count successes.** One operation, and it splits the space decisively:

- **0–5 respond:** hypotheses 1, 3 or 4 — genuine unavailability.
- **6+ respond but reconstruction fails:** hypothesis 2 — the encoding bug, which is the systemic one.
- **Fragments missing from stated locations but findable elsewhere:** hypothesis 5 — recoverable.

**Then, if 6 or more respond: attempt reconstruction and immediately sample the write cohort.** Because hypothesis 2 is the only one where this customer's object is the visible tip of a much larger problem, and establishing that quickly matters more than recovering the one object.

**Why "all metrics normal" is the finding rather than the reassurance.**

Every hypothesis produces normal aggregate metrics, because **one chunk in a trillion moves nothing.** And two of the metrics are actively misleading:

**"No repair backlog"** conflates "everything is repaired" with "nothing was detected as needing repair". Those are opposite situations and the metric cannot distinguish them.

**"Scrubber up to date"** means the scrubber completed its cycle, not that the data is verified — if checksums are missing or themselves corrupt, verification passes trivially.

**The monitoring changes this demands.**

**Alert on the distribution of fragment counts, not on repair queue depth.** "How many chunks have fewer than 7 of 9 fragments" is the durability signal; queue depth is the mechanism signal. **This is the design's own stated requirement and this incident proves it was not implemented.**

**A continuous placement auditor**, sampling chunks and verifying no failure domain holds more than the parity count. Catches hypothesis 4 before the rack event rather than after.

**Reconstruction verification as a background job.** Periodically reconstruct sampled chunks from parity and compare, exercising the path that is otherwise never used until it is needed. **This is the only detection for hypothesis 2**, and hypothesis 2 is the one with a blast radius beyond one object.

**A metadata-versus-reality auditor**, confirming that stated fragment locations actually hold the fragments — which catches hypothesis 5, and which is a cheap read-only sweep.

**And an alert on unverifiable fragments** — a fragment with no checksum should be an error condition, not a pass.

**Transferable:** in a system with a trillion units, **per-unit failures are structurally invisible in aggregate metrics, and the metrics that sound like durability signals usually measure mechanisms instead.** The detections that work are auditors that sample and verify properties end to end — placement against domains, fragments against metadata, reconstruction against data — because each of those checks something no operational metric covers.`,
    },
  ],

  revision: {
    bullets: [
      'Two planes with opposite properties: small strongly-consistent metadata on the request path, enormous eventually-durable data off it.',
      'Metadata is ~0.2% of data, which is what licenses treating it as a database problem.',
      'No byte may cross the control plane: 90 GB/s in plus replication is ~2.9 Tb/s for an auth check.',
      'A presigned URL is the mechanism that keeps the byte path out of the control plane, not a convenience.',
      'Multipart upload buys resumability, parallelism and atomicity — the object exists only after completion.',
      'The completion call is the only transaction in an upload, and it resolves the metadata dual write.',
      'Abandoned upload parts are a bounded storage cost handled by a reaper, not a correctness problem.',
      'Chunk size trades parallelism and metadata against repair granularity; at a 3 MB average, 8 MB means one chunk.',
      'Erasure coding at 1.4–1.5× tolerates more failures than 3× replication — the largest cost decision in the system.',
      'The per-zone fragment limit equals the parity count, and (k+m) must fit in Z × m.',
      '10+4 cannot be placed safely across three zones: 14 fragments means 5 per zone, leaving 9 when 10 are needed.',
      'Order fragments so data fragments alone form the chunk, and only degraded reads pay reconstruction cost.',
      'Replicate hot data for cheap reads; erasure-code cold data for cheap storage.',
      'Coding protects against detected loss only — silent corruption needs checksums plus a rolling scrub.',
      'Repair must be prioritised by degradation level; a FIFO repair queue is a durability bug.',
      'Point reads and prefix listings need opposite partitionings, so listings are a second, asynchronous index.',
      'Five background services with five urgencies; one service means one throttle for all of them.',
      'Alert on the fragment-count distribution, not on repair queue depth — "no backlog" may mean "nothing detected".',
    ],
  },

  cheatSheet: {
    whatItIs:
      'An immutable, flat-keyspace store with two planes: a partitioned strongly-consistent metadata service that answers where bytes are, and a capacity-bound storage fabric that holds them behind erasure coding.',
    whyItExists:
      'Because storing exabytes durably and answering "where is bucket/key" quickly are different problems, and the byte throughput forbids any single tier from doing both.',
    whenToUse: [
      'Large immutable objects — media, backups, logs, model artefacts.',
      'When clients can be given direct storage access via a credential.',
      'When a flat key space with prefix listing is sufficient.',
    ],
    whenNotToUse: [
      'When objects must be randomly mutable — that is a filesystem or block store.',
      'When atomic subtree renames are needed.',
      'When strongly-consistent listings are required for correctness.',
      'For small mutable records, which belong in a database.',
    ],
    alternatives: [
      'A distributed filesystem, when random writes and hierarchy are genuine requirements.',
      'A block store, for VM disks and database files.',
      'Append-only objects with sealed chunks, when the need is appends rather than random writes.',
      'A database plus an object store, when small mutable metadata accompanies large immutable data.',
    ],
    tradeoffs: [
      'Presigned direct upload buys throughput and costs a capability-token model plus client reachability.',
      'Multipart buys resumability and atomicity and costs orphaned parts needing a reaper.',
      'Erasure coding buys less than half the storage and costs encode CPU and degraded-read reconstruction.',
      'Wider coding schemes buy storage efficiency and cost zone-failure tolerance unless zones are added.',
      'Age-based tiering buys cheap reads where reads are and cheap storage where bytes are, and costs a re-encoding pipeline.',
      'Eventually-consistent listings buy a workable index and cost a documented staleness window.',
    ],
    failureModes: [
      'Bytes streamed through the control plane, making it the throughput ceiling.',
      'A single-request path making large uploads impossible and non-resumable.',
      'Metadata written before or after the bytes, giving dangling references or orphans.',
      'Erasure-coded fragments placed without a per-domain limit, so a zone loss is unrecoverable.',
      'Silent corruption accumulating because checksums are absent or unverified.',
      'A missing checksum treated as valid, so the scrubber reports success on unverifiable data.',
      'A FIFO repair queue repairing safe and critical chunks at the same rate.',
      'Repair load unthrottled, pushing marginal disks over during the lowest-tolerance window.',
      'An encoding bug producing checksum-valid fragments that cannot reconstruct — invisible until a degraded read.',
      'One background service throttling urgent repair alongside deferrable re-encoding.',
      'Per-chunk failures invisible in aggregate metrics across a trillion chunks.',
      'Operator error reducing redundancy, which appears in no durability model.',
    ],
    followUpQuestions: [
      'What is the metadata-to-data ratio?',
      'What inbound bandwidth would the control plane carry, and why is it not carrying it?',
      'Where is the single atomic point at which an object begins to exist?',
      'How many fragments per failure domain, and does (k+m) fit in Z × m?',
      'Does a normal read decode, or only a degraded one?',
      'What detects silent corruption, and what is the scrub interval?',
      'Is repair prioritised by degradation level?',
      'What audits that placement still satisfies the domain constraint?',
      'What exercises the reconstruction path before you need it?',
      'What alerts you when one chunk in a trillion is unrecoverable?',
      'Which consistency guarantee applies to point reads, and which to listings?',
    ],
  },
});
