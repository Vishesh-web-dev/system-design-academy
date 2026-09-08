import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-google-drive',
  title: 'Design Google Drive',
  summary:
    'A file-sync system is an eventually-consistent replicated state machine whose replicas are laptops you do not control — so the design is a sync protocol and a conflict policy, not a storage system.',
  phase: 'hld',
  module: 'core-designs',
  position: 45,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 90,
  tags: ['sync-protocol', 'content-hashing', 'conflict-resolution', 'deduplication', 'sharing'],
  prerequisites: ['h-blob-storage'],
  resources: [
    {
      key: 'dropbox-magic-pocket',
      tier: 'must',
      note: 'A published account of the storage layer beneath a file-sync product, including content-addressed blocks. Read it for how the block store and the sync metadata are separate systems.',
    },
    {
      key: 'aws-s3-multipart',
      tier: 'must',
      note: 'The upload protocol that makes large-file sync resumable. Read it because a sync client on a mobile connection must resume, not restart.',
    },
    {
      key: 'crdt-tech',
      tier: 'must',
      note: 'Read it to understand what "conflict-free" actually buys and what it costs. Then note that a filesystem tree is one of the structures CRDTs handle badly, which is why this design does not use one.',
    },
    {
      key: 'jepsen-consistency',
      tier: 'good',
      note: 'Use it as a reference for naming the guarantee the sync protocol provides. A sync system is a distributed store and its consistency model deserves the same precision.',
    },
    {
      key: 'automerge-docs',
      tier: 'good',
      note: 'A concrete CRDT implementation. Read it for the metadata growth problem, which is what rules CRDTs out for whole-file sync and in for collaborative documents.',
    },
    {
      key: 'figma-multiplayer',
      tier: 'advanced',
      note: 'The contrast case: real-time collaborative editing, where the unit is an operation rather than a file. Read it to see why the two problems need different architectures.',
    },
  ],

  intuition: {
    body: `The instinct is to design a storage system. The storage part is the previous lesson and is largely solved. **What makes this problem different is that the replicas are laptops.**

A user's file lives in four places: their laptop, their phone, another laptop, and the server. All four are writable, three of them go offline for days, and none of them can be upgraded on your schedule. **That is an eventually-consistent replicated state machine with untrusted, intermittently-connected replicas** — and every hard question follows from it.

Three of those questions, and each shapes the architecture:

**How does a client learn what changed?** Polling for the full tree is unaffordable — a user with 200,000 files cannot re-enumerate them every 30 seconds. So the server must offer a **delta**: "since cursor X, these things changed". That cursor is the sync protocol's central abstraction, and getting it right determines whether the system works.

**What happens when two devices edit the same file offline?** Both come back with a new version derived from the same parent. There is no correct merge for a binary file, so **the honest answer is to keep both** — and "keep both" is a product decision with a name, a UI and a support cost.

**What is the unit of transfer?** Sending a whole 500 MB file because one byte changed is unacceptable on a laptop connection. So files are split into **content-addressed blocks**, and only changed blocks move. That single decision also gives deduplication for free, because identical blocks have identical hashes.

And the observation that organises the whole design: **file sync is not one system but three, coupled by a version number.**

**A block store** — content-addressed, immutable, dumb, and essentially the previous lesson.
**A metadata service** — the file tree, versions, and a per-user ordered log of changes. Small, strongly consistent, and the hard part.
**A sync engine on the client** — watching the local filesystem, computing diffs, resolving conflicts, and applying remote changes without losing local work.

**Most of the difficulty is in the third one**, which is the part a server-side design discussion never reaches.

The framing to carry: **design the change log first, because the client's ability to converge depends entirely on being able to ask "what happened since I last looked" and get a complete, ordered answer.**`,
    analogyLimit:
      '"Dropbox is cloud storage with a folder" hides that the folder is a writable replica. Cloud storage has one authoritative copy and clients that read it; file sync has N authoritative copies that diverge while offline and must converge without losing work. The analogy also hides that the client is most of the system — filesystem watching, diffing, conflict handling and crash recovery on a machine you do not control is where the engineering actually is.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds file sync as follows: the client polls `GET /files` every 30 seconds for the full file list with modification times, compares against local state, and uploads or downloads whole files that differ. Identify four things that break, and say which one is a correctness problem rather than an efficiency one.',
      answer: `**Break 1 — polling the full tree does not scale, and it fails on both sides.**

A user with 200,000 files polling every 30 seconds:

\`\`\`
Response size:   200,000 × ~200 bytes ≈ 40 MB per poll
Per user per day: 2,880 polls × 40 MB = 115 GB
At 10 million users: unthinkable
\`\`\`

And the client side is as bad: comparing 200,000 entries against local state every 30 seconds is real CPU and disk work on a laptop, for a result that is almost always "nothing changed".

**The fix is a cursor-based delta.** \`GET /delta?cursor=X\` returns only what changed since X, plus a new cursor. A quiet account returns an empty list and a few bytes. **The change log becomes the primary data structure**, and the file tree becomes a projection of it.

**Break 2 — whole-file transfer is unusable for large files.**

A 500 MB video with one byte changed re-uploads 500 MB. On a 10 Mbit connection that is seven minutes, and a document saved every few minutes makes the client permanently uploading.

**The fix is content-addressed blocks.** Split each file into blocks of, say, 4 MB, hash each one, and upload only blocks the server does not already have. A one-byte change to a 500 MB file transfers **one 4 MB block**.

And the same mechanism gives deduplication: **if two users store the same file, the blocks are already present**, so the second upload transfers nothing.

**Break 3 — modification time is not a version, and this is the correctness problem.**

Two devices edit the same file while offline. Both come back with a local modification time later than the server's. The server has no way to tell:

- Device A edited it, or
- Device B edited it, or
- **both** edited it independently and there are now two divergent versions.

**Modification time cannot distinguish "newer" from "concurrent".** So a last-writer-wins comparison silently discards one user's work — and this is the failure that matters, because the others are slow and this one loses data.

**The fix is a version identifier that captures ancestry.** Each file version records its **parent version**. When a client uploads, it declares the parent it derived from:

\`\`\`
PUT /files/{id}  { parentVersion: "v7", blocks: [...] }
  → server's current version is v7:  accept, create v8
  → server's current version is v9:  CONFLICT — the client derived
    from v7, so v9 contains changes the client has not seen
\`\`\`

**That conditional write is the mechanism**, and it is the conditional-update pattern from the consistency lesson. The server never has to guess: either the client's parent is current, or it is not.

**On conflict, keep both.** There is no correct merge for a binary file, so the server creates a second file — \`report (Device B's conflicted copy).docx\` — and both devices sync both. **Ugly, honest, and it never loses work**, which is the only property that matters.

**Break 4 — the client has no crash-safe local state.**

The design compares "local state" against the server with no mention of how local state is stored. If the client is killed mid-download, is the file half-written? Does it re-download? If a user's disk fills mid-sync, what happens?

**The fix is a local database of intent**, not just a folder. The client records what it is doing — "downloading blocks 3–7 of file X, target version v8" — so a restart resumes rather than restarts, and a partially-downloaded file is never visible as the real file. **Download to a temporary location and rename atomically at the end**, so the user's folder never contains a half-file.

**In order of severity: break 3 is the correctness problem**, because it silently loses user data. Breaks 1 and 2 make the product unusable, and break 4 makes it unreliable in ways users experience as corruption. **The only one that destroys data is the version model**, and it is the one a naive design gets wrong precisely because modification times look like they work.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
A user can add, modify, move, rename and delete a file
A user can create and delete folders
A file's changes propagate to the user's other devices
A user can work offline and converge on reconnection
A user can share a file or folder with another user, read-only or read-write
A user can view and restore a previous version of a file
A user can recover a deleted file for 30 days
Two devices editing the same file concurrently must not lose either edit
\`\`\`

**The clarifying questions that change this design:**

**Is real-time collaborative editing in scope?** *No.* Whole-file sync and operational collaborative editing are different architectures — the unit is a file versus an operation. **Answering yes would replace this design entirely.**

**Can a client be offline for a long time?** *Yes, days.* This forces a durable change log with a retention window, and it means the "too far behind" case needs a defined answer.

**Are conflicts resolved automatically or surfaced?** *Surfaced — keep both copies.* There is no correct merge for arbitrary binary content.

**Is deduplication cross-user?** *Yes at the block level, with a caveat covered in step 6.* It is where most of the storage saving comes from.

**How large can files be?** *Up to 50 GB*, which forces block-level transfer and resumability.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Sync latency (online) | Change visible on another device in under 5 s | Push notification, not polling |
| Delta response time | p99 under 200 ms | The change log must be a per-user ordered sequence |
| Correctness | No edit is ever silently lost | Parent-version conditional writes |
| Offline window | 30 days | Change-log retention, plus a full-resync path |
| Transfer efficiency | Only changed blocks move | Content-addressed blocks |
| Scale | 10 M users, 200 K files each | See estimation |

**Out of scope:** authentication, the desktop UI, real-time collaborative editing, and the block store's internals (that is the previous lesson).

## Step 2 — Estimation

\`\`\`
Users:            10 million, 2 million daily active
Files per user:   200,000 average
Total files:      2 trillion file rows...
\`\`\`

**That number is wrong and worth catching.** 10 M × 200 K = 2 × 10¹¹ = **200 billion** file rows, not 2 trillion. At ~300 bytes of metadata each:

\`\`\`
200e9 × 300 B = 60 TB of file metadata
× 2 for indexes and versions ≈ 120 TB
\`\`\`

**120 TB of metadata is a large partitioned database, not an impossible one** — and it is the number that makes the metadata service the interesting part.

\`\`\`
Change events:    assume 50 changes/day per active user
                  2e6 × 50 = 100 million changes/day
                  → 1,000/s average, 3,000/s peak
Delta requests:   2 million active devices × 1 poll/30 s (fallback)
                  → 67,000/s if polling; near zero with push
\`\`\`

**That comparison is the argument for push.** Polling every 30 seconds costs 67,000 requests per second of mostly-empty responses; a push notification on change costs 1,000 per second. **Push is a 67× reduction, and the fallback poll must remain for clients whose connection dropped.**

\`\`\`
Data volume:
  New unique data: assume 100 MB/user/day uploaded, 40% deduplicated
  2e6 × 100 MB × 0.6 = 120 TB/day of unique blocks
Block metadata:
  4 MB blocks → 120 TB/day ÷ 4 MB = 30 million new blocks/day
  Block table grows by 30 M rows/day
\`\`\`

**Deduplication saves 40% of storage**, which at 200 TB/day of raw uploads is 80 TB/day — the single largest cost saving in the system and the reason content addressing is not merely an efficiency detail.

\`\`\`
Bandwidth:
  120 TB/day ÷ 100,000 s = 1.2 GB/s inbound average, ~4 GB/s peak
  Downloads ~3× uploads (multi-device) → ~12 GB/s peak outbound
\`\`\`

**Conclusion the estimate forces:** blocks go directly between client and block store via presigned URLs — 12 GB/s must not pass through the metadata service, exactly as in the previous lesson.

## Step 3 — API design

\`\`\`
Delta sync — the core of the protocol
  GET  /delta?cursor={c}          → { changes[], cursor, hasMore }
  GET  /delta/latest_cursor       → { cursor }   (for a fresh client)

Long-poll / push for immediacy
  GET  /delta/longpoll?cursor={c} → blocks up to 90 s, returns when changed

File operations
  POST /files/commit
    { path, parentVersion, blocks: [hash...], size, mtime }
    → 200 { version }  |  409 { conflict, serverVersion }
  GET  /files/{id}/versions       → version history
  POST /files/{id}/restore        { version }

Block operations
  POST /blocks/check   { hashes: [...] }  → { missing: [...] }
  POST /blocks/upload_url { hash }        → presigned URL
  GET  /blocks/{hash}/download_url        → presigned URL

Sharing
  POST /shares  { fileId, granteeUserId, role }  → { shareId }
\`\`\`

**Five decisions worth defending.**

**\`/delta\` returns changes, not state.** A change entry is \`{ path, type: added|modified|deleted|moved, version, blocks }\`. The client applies them in order and advances its cursor. **This is a replicated log, and the cursor is the client's position in it.**

**\`/blocks/check\` before uploading is the deduplication mechanism and it is client-driven.** The client hashes its blocks, asks which the server lacks, and uploads only those. **A file identical to one already stored uploads zero bytes** — and the check is one round trip regardless of file size.

**\`commit\` is a single atomic operation taking the block list.** Blocks are uploaded first, independently and in parallel; the commit makes the new version exist. **This is the multipart-completion pattern: the only transaction in the write path.**

**\`commit\` requires \`parentVersion\` and can return 409.** The conditional write from the prediction. A client without the current version cannot overwrite it.

**Long-polling rather than a persistent connection for the notification path.** A 90-second long-poll is simpler than maintaining WebSocket state for 2 million devices, degrades to plain polling naturally, and traverses awkward networks. **The cost is a held connection per device**, which at 2 million devices means real connection capacity — worth noting as the trade.

## Step 4 — Data model

\`\`\`sql
-- The change log: the primary structure, partitioned per user
change_log(
  user_id,                    -- PARTITION KEY
  seq BIGSERIAL,              -- SORT KEY: the cursor
  file_id, path, change_type, version_id, created_at,
  PRIMARY KEY (user_id, seq)
)

-- Current file state: a projection of the log
files(
  user_id, file_id,           -- PARTITION KEY: hash(user_id)
  path, current_version, parent_folder_id,
  size, mtime, deleted_at,
  UNIQUE (user_id, path) WHERE deleted_at IS NULL
)

file_versions(
  file_id, version_id,
  parent_version_id,          -- the ancestry that makes conflicts detectable
  block_list,                 -- ordered content hashes
  size, created_at, created_by_device
)

-- Content-addressed blocks, global across all users
blocks(
  hash PRIMARY KEY,           -- content hash: the identity
  size, refcount, storage_location
)

shares(share_id, file_id, owner_id, grantee_id, role, created_at)
\`\`\`

**Four decisions, and the first is the design.**

**The change log is partitioned by \`user_id\` with a monotonic \`seq\`.** So \`GET /delta?cursor=X\` is a single-partition range scan from \`seq > X\` — the cheapest possible query, and it is the operation the entire product depends on.

**\`seq\` must be monotonic *per user*, not globally.** A global sequence would be a single hot counter at 3,000 writes/second and a coordination bottleneck. Per-user monotonicity is what makes the cursor cheap, and it is why the log is partitioned this way.

**\`UNIQUE (user_id, path)\` on live files** means the database enforces that two files cannot occupy one path. A conflict-copy rename must therefore pick a free name, and the constraint guarantees it rather than trusting the code.

**Blocks are global and reference-counted.** \`hash\` is the primary key, so identical content is stored once across all users. **The refcount is what makes deletion possible** — and it is also where the design's hardest correctness problem lives, covered in step 6.

## Step 5 — Architecture

\`\`\`
Desktop / mobile client
  · filesystem watcher → local SQLite state + intent journal
  · block hasher, chunker
  · sync engine: apply remote deltas, upload local changes
        │                                      │
        │ metadata (small, frequent)           │ blocks (large, direct)
        ▼                                      ▼
┌──── METADATA SERVICE ────┐          ┌──── BLOCK STORE ────┐
│  delta / commit / shares  │          │  presigned upload   │
│         │                 │          │  presigned download │
│         ▼                 │          │  content-addressed  │
│  change_log (per user)    │          └─────────────────────┘
│  files, file_versions     │                    ▲
│  blocks (refcounts)       │────────────────────┘
│         │                 │           (block existence checks)
│         ▼                 │
│  Notifier → long-poll     │
└───────────────────────────┘

Background: refcount reaper · version pruner · share fan-out
\`\`\`

**Why the client holds a local database rather than just a folder.** It needs: the last-synced version of every file, the cursor, an intent journal for crash recovery, and block hashes so a re-hash is not needed on every scan. **The folder is the output; the database is the state.**

**Why blocks bypass the metadata service.** 12 GB/s peak outbound. Same argument as the previous lesson, and the metadata service handles only small frequent requests.

**Why a notifier rather than clients polling.** 67× fewer requests. The notifier holds long-poll connections and releases the ones affected by a change.

## Step 6 — The deep dive: sync, conflicts and the refcount problem

**The sync loop, from the client's side:**

\`\`\`
1. Watch the filesystem. On a change, hash the file's blocks.
2. POST /blocks/check → upload only missing blocks (presigned, parallel).
3. POST /files/commit with parentVersion = last-synced version.
   → 200: record the new version locally. Done.
   → 409: conflict. Handle it (below).
4. Meanwhile: long-poll /delta. On a change, download missing
   blocks, write to a temp file, rename atomically, update local state,
   advance the cursor.
\`\`\`

**Two properties make this crash-safe.** The intent journal records step 3's target before attempting it, so a restart knows what was in flight. And step 4 writes to a temporary path and renames, so **the user's folder never contains a partial file.**

**Conflict handling, concretely.** A 409 means the server's version is not the client's parent — someone else changed the file.

\`\`\`
On 409:
  1. Download the server's current version to a temp file.
  2. Rename the local file to "report (Device B's conflicted copy).docx".
  3. Place the server version at the original path.
  4. Commit the conflicted copy as a NEW file (no parent, so no conflict).
  5. Both files now sync to all devices.
\`\`\`

**Why not merge.** For arbitrary binary content there is no merge. For text there sometimes is, and a three-way merge using the common ancestor works — but a silently-merged document that is subtly wrong is worse than two files the user can compare. **Keeping both is honest; it never loses work; and it makes the conflict visible to the person who can resolve it.**

**Why the conflicted copy is committed as a new file.** It has no parent version, so its commit cannot itself conflict. **That guarantees the conflict resolution terminates** rather than looping.

**Moves and renames are the case that catches people.** A rename is not a delete plus an add — treating it that way means re-uploading the entire file. So \`change_type: moved\` carries the old and new paths and no block changes, and the client applies it as a local rename. **Getting this wrong turns "reorganise my photo folder" into re-uploading 50 GB.**

**Now the refcount problem, which is the subtlest thing in the design.**

Blocks are shared across users and reference-counted. Deleting a file decrements its blocks' refcounts, and a block at zero is eligible for deletion. **The race:**

\`\`\`
t=0  User A deletes the only file using block H. refcount → 0.
t=1  Reaper reads refcount = 0, decides to delete H.
t=2  User B uploads a file containing block H. /blocks/check says
     "present", so B uploads nothing. refcount → 1.
t=3  Reaper deletes H.
     → User B's file is now permanently corrupt.
\`\`\`

**User B's file references a block that no longer exists, and B never had the data to re-upload.** This is silent data loss caused by deduplication.

**Three defences, and all three are needed:**

**A grace period.** A block at refcount zero is not deleted for 7 days. The reaper deletes only blocks that have been at zero continuously for that long, re-checking at deletion time. **This bounds the race to a window that a check-then-upload cannot span.**

**Atomic increment on the existence check.** \`/blocks/check\` does not merely report presence — for present blocks it increments a **pending reference** with a short TTL, so a block a client is about to reference is protected from the reaper. The commit converts pending references into real ones.

**Never delete a block whose refcount changed since the reaper read it.** A conditional delete on the refcount value, so t=2's increment causes t=3's delete to fail.

**And the deduplication caveat from step 1.** Cross-user deduplication means the server can tell whether a user possesses a particular file, because uploading it transfers nothing. **That is an information leak**, and the mitigation is either to scope deduplication per user (losing most of the saving) or to accept it and not expose upload timing to clients. **Real systems have made both choices**, and it is a privacy decision rather than a technical one — worth naming as such.

## Step 7 — What breaks at 10×

**100 million users, 2 trillion files, 30,000 changes/second.**

**The change log's retention becomes the constraint.** A client 30 days behind needs 30 days of log entries, and at 100 million changes per day per 10× that is a very large table. *Fix:* compact the log — collapse repeated modifications of one file into the latest, since a client only needs the *current* state of each changed path, not every intermediate step. **Log compaction is what makes the 30-day window affordable**, and it works because the log is a state-change log rather than an event log.

**Clients too far behind need a different path.** Beyond the retention window, the delta cannot be served. *Fix:* return a "resync required" response and have the client re-enumerate. **This must be a designed path, not an error**, because it is how a client returning after two months recovers.

**Shared folders become the fan-out problem.** A folder shared with 500 people means one change writes 500 change-log entries. *Fix:* for large shares, keep one log entry against the *folder* and have clients resolve shared-folder changes separately — fan-out on read for large shares, on write for small ones. **The feed lesson's split, arriving in a different product.**

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Client killed mid-download | Partial file | Temp file discarded; intent journal resumes |
| Client killed mid-upload | Some blocks uploaded, no commit | Blocks are orphaned but harmless; commit retries |
| Metadata service down | No sync | Clients queue local changes and retry; local work continues |
| Block store down | No transfer | Metadata syncs; blocks fetch later. **Files appear but are not yet downloadable** — must be surfaced in the UI |
| Two devices commit simultaneously | One gets 409 | Conflict copy; no loss |
| Client clock wrong | — | Irrelevant: versions are server-assigned, not time-based |
| Reaper races an upload | Corrupt file | Grace period + pending references + conditional delete |
| Client 60 days behind | Log entries gone | "Resync required" — a designed path |

**Two rows carry the real content.** The **clock row** is worth stating because a design based on modification times would fail here, and this one does not — versions are server-assigned. And the **block-store row** shows a partial-availability state the UI must represent: metadata says the file exists and the bytes are not local yet, which is a real state rather than an error.

## Step 9 — Defending it

**"I designed the change log first, because everything the client can do depends on asking 'what happened since cursor X' and getting a complete ordered answer.** It is partitioned per user with a per-user monotonic sequence, so a delta is a single-partition range scan — and a global sequence would have been a coordination bottleneck for no benefit.

**I used parent-version conditional commits rather than modification times.** A timestamp cannot distinguish 'newer' from 'concurrent', so last-writer-wins silently discards work. Declaring the parent makes the server's answer unambiguous, and a 409 is a conflict rather than a guess.

**On conflict I keep both copies and I do not merge.** There is no correct merge for binary content, and a subtly-wrong merged document is worse than two files the user can compare. The conflicted copy commits with no parent so resolution cannot loop.

**I made blocks content-addressed and global**, which gives both delta transfer and cross-user deduplication — about 40% of storage. The cost is a subtle deletion race, handled with a grace period, pending references and a conditional delete; and an information leak about file possession, which is a privacy decision rather than a technical one.

**What I gave up:** conflicts are visible and ugly; a client beyond the retention window must fully resync; sharing with a large group needs a separate read-time path; and the client is genuinely complex — a local database, an intent journal and atomic renames, on a machine I do not control.

**What would make me revisit it:** if real-time collaborative editing became a requirement, the unit changes from a file to an operation and this architecture is replaced rather than extended. And if privacy required it, I would scope deduplication per user and accept most of the storage saving disappearing."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'sync-loop',
      title: 'The sync loop, and where the conflict is detected',
      caption:
        'Step through it. The parent-version check in the commit is the single mechanism that makes concurrent edits detectable rather than silently resolved.',
      nodes: [
        { id: 'watch', label: 'Filesystem watcher', kind: 'client', x: 0, y: 190, detail: 'Detects a local change and hashes the file into 4 MB content-addressed blocks. The local database holds previous hashes so unchanged blocks are not re-hashed.' },
        { id: 'check', label: 'POST /blocks/check', kind: 'service', x: 180, y: 90, detail: 'Sends the block hashes; the server replies with which it lacks. A file identical to one already stored uploads zero bytes — one round trip regardless of file size.' },
        { id: 'upload', label: 'Upload missing blocks', kind: 'store', x: 370, y: 90, detail: 'Presigned direct-to-block-store, in parallel. A one-byte change to a 500 MB file transfers one 4 MB block rather than 500 MB.' },
        { id: 'commit', label: 'POST /files/commit + parentVersion', kind: 'service', x: 180, y: 200, detail: 'The only transaction in the write path. Declaring the parent version is what lets the server distinguish "newer" from "concurrent" — a modification time cannot.' },
        { id: 'ok', label: '200: new version', kind: 'note', x: 370, y: 190, detail: 'The server\'s current version was the declared parent, so the commit is a linear successor. Record it locally and advance.' },
        { id: 'conflict', label: '409: conflict', kind: 'note', x: 370, y: 290, detail: 'The server has a version the client never saw. Rename the local file to a conflicted copy, place the server version at the original path, and commit the copy as a NEW file with no parent — so resolution cannot loop.' },
        { id: 'log', label: 'change_log (per user, seq)', kind: 'store', x: 590, y: 190, detail: 'Partitioned by user with a per-user monotonic sequence, so a delta is a single-partition range scan. A global sequence would be a coordination bottleneck.' },
        { id: 'poll', label: 'Long-poll /delta?cursor', kind: 'service', x: 590, y: 60, detail: 'Push rather than polling: 1,000 changes/second versus 67,000 mostly-empty polls. The fallback poll stays for clients whose connection dropped.' },
        { id: 'apply', label: 'Apply: temp file → atomic rename', kind: 'client', x: 780, y: 190, detail: 'Downloads missing blocks to a temporary path and renames at the end, so the user\'s folder never contains a partial file. The intent journal makes a crash resumable.' },
      ],
      edges: [
        { id: 'g1', source: 'watch', target: 'check', kind: 'sync' },
        { id: 'g2', source: 'check', target: 'upload', kind: 'write' },
        { id: 'g3', source: 'watch', target: 'commit', kind: 'sync' },
        { id: 'g4', source: 'commit', target: 'ok', kind: 'control' },
        { id: 'g5', source: 'commit', target: 'conflict', kind: 'control' },
        { id: 'g6', source: 'ok', target: 'log', kind: 'write' },
        { id: 'g7', source: 'log', target: 'poll', kind: 'read' },
        { id: 'g8', source: 'poll', target: 'apply', kind: 'sync' },
      ],
      steps: [
        {
          id: 'sl1',
          title: 'Hash first, then ask what is missing',
          description:
            'The client hashes into content-addressed blocks and asks the server which it lacks. Identical content anywhere in the system uploads nothing, and a one-byte change transfers one block.',
          nodes: ['watch', 'check', 'upload'],
          edges: ['g1', 'g2'],
        },
        {
          id: 'sl2',
          title: 'The commit declares its parent',
          description:
            'Blocks are uploaded independently; the commit is the single atomic operation that makes the version exist. Declaring the parent is what makes concurrency detectable rather than guessed at.',
          nodes: ['commit'],
          edges: ['g3'],
        },
        {
          id: 'sl3',
          title: 'A 409 is a conflict, not an error',
          description:
            'The server holds a version the client never saw. Keep both: rename the local file to a conflicted copy and commit it as a new file with no parent, so resolution terminates.',
          nodes: ['ok', 'conflict'],
          edges: ['g4', 'g5'],
        },
        {
          id: 'sl4',
          title: 'The change log is the primary structure',
          description:
            'Every accepted commit appends to a per-user log with a monotonic sequence. The file tree is a projection of it, and the cursor is a client\'s position in it.',
          nodes: ['log', 'poll'],
          edges: ['g6', 'g7'],
        },
        {
          id: 'sl5',
          title: 'Apply remotely with atomic renames',
          description:
            'Download to a temporary path and rename at the end, so a partial file is never visible. The intent journal records what was in flight so a crash resumes rather than restarts.',
          nodes: ['apply'],
          edges: ['g8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'refcount-race',
      title: 'The deduplication deletion race, and the three defences',
      caption:
        'The red path is silent data loss caused by deduplication, and it needs all three defences — any one alone leaves a window.',
      code: `flowchart TB
    T0["t=0 · User A deletes the only<br/>file using block H<br/>refcount → 0"]
    T0 --> T1["t=1 · Reaper reads refcount = 0<br/>and decides to delete H"]
    T1 --> T2["t=2 · User B uploads a file<br/>containing block H.<br/>/blocks/check says 'present',<br/>so B uploads NOTHING.<br/>refcount → 1"]
    T2 --> T3["t=3 · Reaper deletes H"]
    T3 --> BAD["**User B's file is permanently<br/>corrupt, and B never had the<br/>data to re-upload.**<br/>Silent loss caused by dedup"]

    BAD --> D1["**Defence 1 — grace period**<br/>Delete only blocks at zero<br/>continuously for 7 days,<br/>re-checked at delete time"]
    BAD --> D2["**Defence 2 — pending refs**<br/>/blocks/check increments a<br/>short-TTL pending reference,<br/>so a block about to be used<br/>is protected"]
    BAD --> D3["**Defence 3 — conditional delete**<br/>Delete only if refcount is<br/>unchanged since the reaper<br/>read it"]

    style BAD fill:#2a1a1a,stroke:#a04848
    style D1 fill:#17272a,stroke:#35897e
    style D2 fill:#17272a,stroke:#35897e
    style D3 fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['dropbox'],
    body: `Dropbox's published account of its storage migration is the most useful reference here, and the interesting part is the boundary it draws.

**Blocks are content-addressed and immutable, in a store that knows nothing about files.** The block layer stores 4 MB blocks keyed by their hash; the concept of a "file" exists only in the metadata layer above. **That separation is the design decision this lesson centres on** — and it means the block store is essentially the previous lesson's object store, while all the sync difficulty lives in metadata and the client.

**The migration itself makes a point worth extracting.** Moving exabytes from a third-party object store to their own required the block layer to be **addressable by content rather than by location**, so a block could exist in two places during migration and either copy satisfied a read. **Content addressing is what made a multi-year migration possible without a cutover** — a property nobody designs for and everybody eventually needs.

**And the storage-efficiency work they describe is the erasure-coding and tiering conclusion from the previous lesson**, applied to the same block abstraction. The block store's problems are storage problems; the sync system's problems are elsewhere.

**Three transferable lessons.**

**Put the file abstraction above the block store, not inside it.** A block store that understands files cannot deduplicate across them, and a sync layer that understands storage locations cannot be migrated.

**Content addressing does three jobs at once**: delta transfer, deduplication, and location-independence. **Most designs reach for it for the first reason and get the other two free**, and the third is the one that matters years later.

**The client is a product, not a component.** The published engineering material about file sync is disproportionately about the client — filesystem event handling across three operating systems, crash recovery, handling users who edit files with tools that write by rename-and-replace. **A server-side design discussion never reaches any of that**, and it is where the majority of the engineering effort actually goes.

**Where this reference does not help.** It describes the storage layer, not the sync protocol or the conflict policy. **The hardest parts of this lesson — the cursor semantics, the parent-version commit, the refcount race — are not published by anyone in detail**, which is worth knowing when preparing: they must be derived rather than recalled.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on. Most are about the protocol and the conflict policy rather than about storage.',
    rows: [
      {
        option: 'Poll for the full file list',
        whenItWins:
          'Tiny accounts and prototypes.',
        whenItLoses:
          'Immediately at scale: 200,000 files is a 40 MB response, and comparing them locally every 30 seconds is real work for a result that is almost always "nothing changed".',
        cost:
          'Bandwidth proportional to account size on every poll, on both sides.',
      },
      {
        option: 'Cursor-based delta log',
        whenItWins:
          'Always. A quiet account returns a few bytes, and the query is a single-partition range scan.',
        whenItLoses:
          'When a client falls beyond the log retention window and must fully resync.',
        cost:
          'A durable per-user log with a retention policy, and a designed resync path.',
      },
      {
        option: 'Whole-file transfer',
        whenItWins:
          'Small files, where block accounting is overhead.',
        whenItLoses:
          'Large files: one byte changed re-uploads everything, so a frequently-saved large document keeps the client permanently uploading.',
        cost:
          'Bandwidth proportional to file size rather than to change size.',
      },
      {
        option: 'Content-addressed blocks',
        whenItWins:
          'Always. Delta transfer, cross-user deduplication (~40% of storage) and location-independence for migrations, from one mechanism.',
        whenItLoses:
          'When privacy forbids cross-user deduplication, which leaks whether a user possesses a file.',
        cost:
          'A refcount deletion race needing three defences, and an information leak that is a privacy decision.',
      },
      {
        option: 'Modification-time comparison',
        whenItWins:
          'Nowhere. It cannot distinguish "newer" from "concurrent".',
        whenItLoses:
          'Whenever two devices edit offline — last-writer-wins silently discards one user\'s work.',
        cost:
          'Silent data loss, which is the only unacceptable failure in this product.',
      },
      {
        option: 'Parent-version conditional commit',
        whenItWins:
          'Always. The server never guesses: the declared parent is current or it is not.',
        whenItLoses:
          'Never, though it requires the client to track its last-synced version per file.',
        cost:
          'A 409 path the client must handle, and version ancestry stored per file.',
      },
      {
        option: 'Automatic merge on conflict',
        whenItWins:
          'For structured text with a known format, using a three-way merge against the common ancestor.',
        whenItLoses:
          'For arbitrary binary content, where no merge exists — and a subtly-wrong merged document is worse than two comparable files.',
        cost:
          'Silent corruption that looks like success.',
      },
      {
        option: 'Keep both copies on conflict',
        whenItWins:
          'The right default. Never loses work, and surfaces the conflict to the person who can resolve it.',
        whenItLoses:
          'On user experience — conflicted copies are ugly and generate support contacts.',
        cost:
          'Visible clutter, and a naming scheme that must guarantee a free path.',
      },
      {
        option: 'A CRDT for the file tree',
        whenItWins:
          'For collaborative documents, where the unit is an operation and the merge semantics match the intent.',
        whenItLoses:
          'For a filesystem tree — move and rename semantics are exactly what CRDTs handle badly, and metadata grows without bound.',
        cost:
          'Unbounded metadata growth, and merge results that may not match filesystem expectations.',
      },
      {
        option: 'Long-polling for change notification',
        whenItWins:
          'Simpler than persistent connections, degrades to polling naturally, and traverses awkward networks.',
        whenItLoses:
          'At very large device counts, where held connections are significant capacity.',
        cost:
          'One held connection per online device.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The client polls for the file list every 30 seconds and syncs anything whose modification time differs."',
      whyWeak:
        'Two failures. A 200,000-file account is a 40 MB response every 30 seconds, on both sides. And modification time cannot distinguish "newer" from "concurrent", so two devices editing offline results in last-writer-wins silently discarding one user\'s work.',
      strongAnswer:
        '"A cursor-based delta: `GET /delta?cursor=X` returns only what changed, so a quiet account costs a few bytes and the query is a single-partition range scan. And versions must capture ancestry, not time — each commit declares the parent version it derived from, so the server can return 409 when the client\'s parent is not current. A timestamp comparison would silently lose an edit, which is the one unacceptable failure here."',
    },
    {
      weakAnswer: '"On conflict, the most recent version wins."',
      whyWeak:
        'It discards work. And "most recent" is undefined across devices with unsynchronised clocks — the two edits were concurrent, not ordered, so there is no fact about which is later.',
      strongAnswer:
        '"There is no correct merge for arbitrary binary content and no ordering between concurrent edits, so I keep both: the local file is renamed to a conflicted copy and the server version is placed at the original path. The copy is committed as a *new* file with no parent version, which guarantees its commit cannot itself conflict and the resolution terminates. It is ugly and it never loses work, which is the property that matters."',
    },
    {
      weakAnswer: '"Files are split into blocks and deduplicated by hash, and deleting a file removes its blocks."',
      whyWeak:
        'The deletion race. A block reaching refcount zero can be deleted between another user\'s existence check and their commit — and because the check said "present" they uploaded nothing, so their file references data that no longer exists and they never had it to re-upload.',
      strongAnswer:
        '"Deduplication creates a subtle deletion race, and it needs three defences together. A grace period, so a block at zero is not deleted for days. A pending reference incremented by the existence check with a short TTL, so a block about to be used is protected. And a conditional delete that fails if the refcount changed since the reaper read it. Any one alone leaves a window, and the failure mode is silent corruption of a file the user cannot re-upload."',
    },
    {
      weakAnswer: '"A rename is a delete of the old path plus an add of the new one."',
      whyWeak:
        'It re-uploads the file. Reorganising a photo folder becomes re-uploading tens of gigabytes, and on the receiving device it becomes a delete and a full download rather than a local rename.',
      strongAnswer:
        '"A move must be its own change type carrying the old and new paths with no block changes, so the client applies it as a local rename and no bytes transfer. Getting this wrong turns \'reorganise my folders\' into re-uploading everything — and because content addressing means the blocks already exist, even a naive implementation would at least not re-transfer, but the receiving device would still delete and re-download the file."',
    },
    {
      weakAnswer: '"The client keeps its state in the synced folder itself."',
      whyWeak:
        'The client needs a crash-safe record of intent — what it was uploading or downloading, the target version, the cursor — and the folder cannot hold it. Without it, a client killed mid-download leaves a partial file visible as the real file, which users experience as corruption.',
      strongAnswer:
        '"The client holds a local database: last-synced version per file, block hashes so re-hashing is unnecessary, the cursor, and an intent journal so a restart resumes rather than restarts. And downloads go to a temporary path with an atomic rename at the end, so the user\'s folder never contains a partial file. The folder is the output; the database is the state."',
    },
    {
      weakAnswer: '"We use a CRDT so conflicts resolve automatically."',
      whyWeak:
        'A filesystem tree is one of the structures CRDTs handle worst — concurrent moves can produce cycles or duplicate subtrees, and the converged result may not match what either user expected. And CRDT metadata grows without bound, which is untenable for a 200,000-file account.',
      strongAnswer:
        '"CRDTs are the right tool for collaborative documents where the unit is an operation and the merge semantics match the intent. A filesystem tree is not that: concurrent moves are exactly the case CRDTs handle badly, and the metadata growth is untenable at 200,000 files per user. For whole-file sync, a parent-version conditional commit with conflict copies is both simpler and more honest — it makes the conflict visible rather than converging on something nobody chose."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hgd-1',
      front: 'What makes file sync different from cloud storage?',
      back: 'The replicas are laptops. N writable copies that diverge while offline and must converge without losing work, on machines you cannot upgrade.',
      topic: 'sync-protocol',
    },
    {
      id: 'fc-hgd-2',
      front: 'What is the primary data structure, and how is it partitioned?',
      back: 'A per-user change log with a monotonic sequence, partitioned by user id — so a delta is a single-partition range scan. The file tree is a projection of it.',
      topic: 'sync-protocol',
    },
    {
      id: 'fc-hgd-3',
      front: 'Why must the sequence be per-user rather than global?',
      back: 'A global sequence is a single hot counter and a coordination bottleneck. Per-user monotonicity is what makes the cursor cheap.',
      topic: 'sync-protocol',
    },
    {
      id: 'fc-hgd-4',
      front: 'Why is polling the file list unaffordable?',
      back: '200,000 files is a ~40 MB response, and comparing it locally every 30 seconds is real work — for a result that is almost always "nothing changed".',
      topic: 'sync-protocol',
    },
    {
      id: 'fc-hgd-5',
      front: 'Why can modification time not be used as a version?',
      back: 'It cannot distinguish "newer" from "concurrent". Two devices editing offline both have a later time, so last-writer-wins silently discards work.',
      topic: 'conflict-resolution',
    },
    {
      id: 'fc-hgd-6',
      front: 'What makes concurrent edits detectable?',
      back: 'Each commit declares the parent version it derived from. If the server\'s current version is not that parent, it returns 409 — no guessing required.',
      topic: 'conflict-resolution',
    },
    {
      id: 'fc-hgd-7',
      front: 'Why commit a conflicted copy as a new file with no parent?',
      back: 'A commit with no parent cannot itself conflict, which guarantees the conflict resolution terminates rather than looping.',
      topic: 'conflict-resolution',
    },
    {
      id: 'fc-hgd-8',
      front: 'Why keep both copies rather than merge?',
      back: 'There is no merge for arbitrary binary content, and a subtly-wrong merged document is worse than two files the user can compare. Keeping both never loses work.',
      topic: 'conflict-resolution',
    },
    {
      id: 'fc-hgd-9',
      front: 'What three things does content addressing buy?',
      back: 'Delta transfer (only changed blocks move), cross-user deduplication (~40% of storage), and location-independence, which is what makes a storage migration possible without a cutover.',
      topic: 'content-hashing',
    },
    {
      id: 'fc-hgd-10',
      front: 'Describe the deduplication deletion race.',
      back: 'A block hits refcount zero; the reaper decides to delete it; another user\'s existence check says "present" so they upload nothing; the reaper deletes it. Their file is corrupt and they never had the data.',
      topic: 'deduplication',
    },
    {
      id: 'fc-hgd-11',
      front: 'The three defences against the refcount race?',
      back: 'A multi-day grace period at zero; a short-TTL pending reference incremented by the existence check; and a conditional delete that fails if the refcount changed.',
      topic: 'deduplication',
    },
    {
      id: 'fc-hgd-12',
      front: 'What privacy problem does cross-user deduplication create?',
      back: 'Uploading a file already stored transfers nothing, which reveals whether a user possesses that file. Mitigations are per-user dedup (losing the saving) or hiding upload timing.',
      topic: 'deduplication',
    },
    {
      id: 'fc-hgd-13',
      front: 'Why is a move its own change type?',
      back: 'Treating a rename as delete-plus-add re-uploads the file and makes the receiving device delete and re-download it. A move carries old and new paths with no block changes.',
      topic: 'sync-protocol',
    },
    {
      id: 'fc-hgd-14',
      front: 'Why does the client need a local database and an intent journal?',
      back: 'So a crash resumes rather than restarts, and so a partial download is never visible as the real file. The folder is the output; the database is the state.',
      topic: 'sync-protocol',
    },
  ],

  quiz: [
    {
      id: 'q-hgd-1',
      kind: 'scenario',
      prompt:
        'Two laptops edit the same document while offline, both deriving from server version v7. Both reconnect. What should happen?',
      options: [
        { id: 'a', label: 'The first commit creates v8; the second gets a 409 because its parent v7 is no longer current, and its edit becomes a conflicted copy' },
        { id: 'b', label: 'The one with the later modification time wins and overwrites the other' },
        { id: 'c', label: 'The server merges the two versions automatically' },
        { id: 'd', label: 'The second commit is rejected and the client is told to discard its changes' },
      ],
      correct: ['a'],
      explanation:
        'The parent-version check makes the concurrency detectable: the second client derived from v7, which is no longer current, so the server can say so rather than guess. Modification time cannot distinguish newer from concurrent; there is no merge for arbitrary content; and discarding the second edit is the data loss the design exists to prevent.',
      difficulty: 'core',
      topic: 'conflict-resolution',
    },
    {
      id: 'q-hgd-2',
      kind: 'scenario',
      prompt:
        'A user with 200,000 files has a client polling `GET /files` every 30 seconds. What is the cost, and what replaces it?',
      options: [
        { id: 'a', label: 'About 40 MB per poll and a full local comparison each time — replaced by a cursor-based delta returning only changes' },
        { id: 'b', label: 'Negligible, since the response compresses well' },
        { id: 'c', label: 'High CPU only; bandwidth is fine because the response is metadata' },
        { id: 'd', label: 'Acceptable if the poll interval is raised to 5 minutes' },
      ],
      correct: ['a'],
      explanation:
        '200,000 × ~200 bytes is ~40 MB, 2,880 times a day — and the client must compare all of it locally for a result that is almost always empty. A cursor-based delta makes a quiet account cost a few bytes, and the query becomes a single-partition range scan. Raising the interval trades sync latency for a cost that is still proportional to account size.',
      difficulty: 'core',
      topic: 'sync-protocol',
    },
    {
      id: 'q-hgd-3',
      kind: 'scenario',
      prompt:
        'User A deletes the last file using block H, dropping its refcount to zero. The reaper reads the refcount. Before it deletes, user B uploads a file containing H — the existence check says "present", so B uploads nothing. What is the outcome without protection?',
      options: [
        { id: 'a', label: 'The reaper deletes H and B\'s file is permanently corrupt, with B never having had the data to re-upload' },
        { id: 'b', label: 'B\'s upload restores the block, so nothing is lost' },
        { id: 'c', label: 'The reaper skips H because the refcount is now non-zero' },
        { id: 'd', label: 'B\'s client detects the missing block and re-uploads it' },
      ],
      correct: ['a'],
      explanation:
        'B never transferred the block, so B\'s client may no longer have the source data — and even if it did, nothing tells it the block vanished. Option c is what the *conditional delete* defence adds and is not automatic. This is silent corruption caused by deduplication, and it needs a grace period, pending references and a conditional delete together.',
      difficulty: 'advanced',
      topic: 'deduplication',
    },
    {
      id: 'q-hgd-4',
      kind: 'scenario',
      prompt:
        'A user renames a folder containing 5,000 photos. What should cross the network?',
      options: [
        { id: 'a', label: 'Change entries with type "moved" carrying old and new paths, and no block data at all' },
        { id: 'b', label: '5,000 delete entries and 5,000 add entries, with blocks re-uploaded' },
        { id: 'c', label: 'One entry for the folder, with clients recomputing child paths' },
        { id: 'd', label: 'Nothing, since paths are client-side metadata' },
      ],
      correct: ['a'],
      explanation:
        'A move must be its own change type so no bytes transfer and the receiving device performs a local rename. Option c is an appealing optimisation and requires clients to derive child paths, which breaks if a child was independently moved; explicit per-file move entries are unambiguous. Option b is the mistake that turns reorganising a folder into re-uploading it.',
      difficulty: 'core',
      topic: 'sync-protocol',
    },
    {
      id: 'q-hgd-5',
      kind: 'scenario',
      prompt:
        'A client has been offline for 60 days; the change log retains 30 days. What should the server return?',
      options: [
        { id: 'a', label: 'A "resync required" response, triggering a full re-enumeration — a designed path, not an error' },
        { id: 'b', label: 'An error, since the cursor is invalid' },
        { id: 'c', label: 'All changes from the beginning of time' },
        { id: 'd', label: 'The current file list, which the client diffs against local state' },
      ],
      correct: ['a'],
      explanation:
        'This is how a long-absent client recovers, so it must be a first-class response rather than an error the client interprets. Option d is essentially what resync does, and the important point is that the server signals the transition explicitly rather than the client guessing. Retaining all history forever is what log retention exists to avoid.',
      difficulty: 'core',
      topic: 'sync-protocol',
    },
    {
      id: 'q-hgd-6',
      kind: 'multi',
      prompt:
        'Which are reasons a CRDT is the wrong choice for whole-file sync? Select all that apply.',
      options: [
        { id: 'a', label: 'Concurrent moves in a tree are exactly what CRDTs handle badly, producing cycles or duplicate subtrees' },
        { id: 'b', label: 'CRDT metadata grows without bound, which is untenable at 200,000 files per user' },
        { id: 'c', label: 'The converged result may not match what either user expected, hiding the conflict' },
        { id: 'd', label: 'CRDTs cannot represent file content at all' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the real objections, and the third is the most important: converging silently on something nobody chose is worse than surfacing a conflict. CRDTs can represent content — that is what collaborative editors do — which is why they are the right tool when the unit is an operation rather than a file.',
      difficulty: 'advanced',
      topic: 'conflict-resolution',
    },
  ],

  exercises: [
    {
      id: 'ex-hgd-1',
      kind: 'design',
      title: 'Specify the sync protocol against adversarial cases',
      estimatedMinutes: 40,
      prompt: `The lesson sketches the sync protocol. Now specify it precisely enough to survive these eight cases. For each, say exactly what the client and server do, and what the user sees.

1. A user edits a file on laptop A while laptop B is offline, then edits the *same* file on B before it reconnects.
2. A user deletes a file on laptop A while laptop B modifies it offline.
3. A user moves file X into folder F on laptop A, while laptop B moves folder F into folder G.
4. A user's laptop is killed while downloading block 4 of 8 of a new file version.
5. A user's disk fills during a download.
6. A file is edited by an application that saves by writing a new file and renaming over the original.
7. Two users share a folder read-write; both create a file at the same path simultaneously.
8. A user restores a file to version v3 while another device has just committed v9.

Then answer:

- Which case has no non-surprising answer, and what would you tell the product owner?
- Which two cases share the same underlying mechanism?
- What single addition to the data model would make case 3 unambiguous?`,
      rubric: [
        'Each case gives concrete client and server behaviour plus the user-visible result.',
        'Case 1 uses the parent-version 409 and conflict-copy flow.',
        'Case 2 identifies delete-versus-edit as a conflict requiring a policy decision.',
        'Case 3 identifies concurrent tree moves as the genuinely hard case.',
        'Cases 4 and 5 use the intent journal and atomic rename, with disk-full handled distinctly.',
        'Case 6 identifies the rename-over-original pattern and its detection.',
        'Case 7 uses the unique path constraint and a conflict copy.',
        'Case 8 treats restore as a new version derived from the current one.',
        'Names case 3 or 2 as having no non-surprising answer, with a product recommendation.',
        'Identifies the shared mechanism between two cases.',
      ],
      modelAnswer: `**1. Concurrent edits to the same file on two laptops**

\`\`\`
Both A and B have last-synced version v7.
A commits: parentVersion=v7 → server v7 is current → v8 created.
B reconnects, commits: parentVersion=v7 → server is at v8 → 409.
\`\`\`

**B's client, on 409:**

1. Downloads v8's missing blocks to a temp file.
2. Renames its local file to \`report (B's conflicted copy).docx\`.
3. Moves v8 into place at \`report.docx\`.
4. Commits the conflicted copy as a **new file** with no parent version.
5. Advances its cursor.

**The user sees** two files in the folder on every device, and a notification saying a conflicted copy was created. **Nothing is lost, and the person who made both edits is the person best placed to reconcile them.**

*The detail that matters:* step 4's commit has no parent, so it cannot conflict, so **the resolution provably terminates.** A conflicted copy committed with a parent could 409 against another device's conflicted copy, and that loops.

**2. Delete on A, modify on B — and this is a policy decision, not a technical one**

\`\`\`
A deletes: parentVersion=v7 → v8 is a tombstone.
B commits a modification: parentVersion=v7 → server is at v8 → 409.
\`\`\`

The mechanism detects it. **What to do is the product question**, and the three options are all defensible:

**Option A — the edit wins; the file is restored.** Rationale: a deletion is easy to redo, and losing new content is not. The user sees the file reappear, possibly confusingly.

**Option B — the delete wins; the edit becomes a conflicted copy at the original path.** Rationale: honours both intentions — the original is gone, the new content survives as a separate file.

**Option C — the delete wins and the edit is discarded.** **Unacceptable** — it silently loses work, which is the one failure this design forbids.

**I would choose Option B**, because it preserves the property that no edit is ever lost while respecting the delete. The user sees \`report (B's conflicted copy).docx\` appear and \`report.docx\` gone.

*And the asymmetry worth noting:* B's client discovers this as a 409 with a *tombstone* as the current version, which the client must handle distinctly from a 409 against a live version. **A client that treats all 409s identically would try to download the tombstone's blocks and fail.**

**3. Concurrent tree moves — the genuinely hard case**

\`\`\`
A: move file X into folder F        →  /F/X
B: move folder F into folder G      →  /G/F
\`\`\`

**These do not conflict on any single path**, so the parent-version check on individual entities does not fire. Applied in either order the result is \`/G/F/X\`, which is arguably what both users wanted.

**But the general case is not benign.** Consider:

\`\`\`
A: move folder F into folder G
B: move folder G into folder F
\`\`\`

Applied naively in either order, this creates a **cycle** — F is inside G and G is inside F — and the tree is no longer a tree. **This is the case CRDTs handle badly and it is why this design does not use one for the tree.**

**What the design must do:** the *server* validates tree invariants at commit time, because it is the only party with the whole tree.

\`\`\`
On a move commit:
  1. parentVersion check on the moved entity (as normal).
  2. TREE VALIDATION: walk from the new parent upward. If the moved
     folder appears in its own ancestry → reject with 409 CYCLE.
  3. On rejection, the client places the folder at a safe location
     (its original parent) and reports the conflict.
\`\`\`

**So the answer to case 3 as stated: it applies cleanly, both moves succeed, and the file ends at \`/G/F/X\`.** But the mechanism required to make that safe is server-side tree validation, which the lesson's parent-version check alone does not provide.

*And a second subtlety:* if A's move of X into F and B's move of F both commit, then A's client learns about F's move via the delta and must **re-derive X's path.** So a client cannot cache absolute paths — it must store parent-id references and compute paths. **That is a data-model consequence of concurrent moves**, and it is the answer to the final question below.

**4. Killed mid-download, block 4 of 8**

\`\`\`
Before starting, the client wrote to its intent journal:
  { op: "download", file_id: X, target_version: v8,
    blocks: [h1..h8], temp_path: ".sync/tmp/abc" }
\`\`\`

**On restart:**

1. Reads the journal, finds the incomplete download.
2. Checks which blocks are already in the temp file (it recorded progress, or re-verifies by hashing what it has).
3. Downloads the remaining blocks.
4. Verifies the assembled file's hash against v8's expected hash.
5. Atomic rename into place; updates local state; clears the journal entry.

**The user sees nothing.** The temp file was never in the synced folder, so **the folder never contained a partial file** — which is the property the atomic rename buys.

*Why verify the assembled hash:* a block could have been corrupted in transit or on disk. **Verifying end-to-end catches what per-block checks miss**, and it is cheap relative to the download.

**5. Disk fills during a download — distinct from case 4**

The mechanism is the same journal, and the handling must differ because **retrying immediately will fail again.**

\`\`\`
On ENOSPC:
  1. Abort the download; delete the temp file to reclaim its space.
  2. Mark the file as "pending, insufficient space" in local state.
  3. Surface a persistent UI state: "3 files cannot sync — 2.1 GB needed".
  4. Do NOT retry on a timer. Retry when free space changes,
     detected by watching the filesystem.
\`\`\`

**Three things this gets right.** Deleting the temp file first, because holding a partial download while reporting insufficient space makes the problem worse. Not retrying on a timer, because a full disk is a persistent condition and retrying is pure waste. And surfacing it, because **the user is the only party who can fix it** — a silent stall is the failure mode users report as "sync is broken".

*And the ordering decision:* if several files are pending, sync the smallest first. **More files become available sooner**, and it maximises the chance that some progress is possible.

**6. An application that saves by rename-over-original**

Many editors write \`report.docx.tmp\`, then rename it over \`report.docx\`. **The filesystem watcher sees: create, write, delete, rename** — and a naive client interprets this as *delete \`report.docx\`, then create a new unrelated file at that path.*

**The consequence of getting it wrong: the file's version history is broken.** The new content commits as a *new file* with no parent, so the server sees a delete followed by an unrelated creation — losing version history and, worse, potentially producing a conflict against the old file's tombstone.

**What the client must do:**

\`\`\`
1. Debounce filesystem events — wait ~500 ms of quiet before acting.
   The whole write-and-rename sequence completes inside the window.
2. After debouncing, compare the FINAL state of the path against
   the last-synced state.
3. If a file exists at the path and its content differs, that is a
   MODIFICATION of the existing file — commit with the existing
   file's parentVersion, regardless of the intermediate events.
\`\`\`

**Debouncing plus final-state comparison is the fix**, and it generalises: **the client should react to the settled state of a path, not to the sequence of events that produced it.** Filesystem event streams are noisy and platform-specific; the final state is not.

*A related case the same fix handles:* an editor that writes in place with several partial writes. Without debouncing the client would commit each intermediate state.

**7. Two users in a shared folder create the same path simultaneously**

\`\`\`
Both commit: create /shared/notes.txt
\`\`\`

**The unique constraint \`UNIQUE (user_id, path) WHERE deleted_at IS NULL\`** — extended for shares to be scoped to the *owning* folder rather than the user — means the database rejects the second.

\`\`\`
First commit:  succeeds, creates the file.
Second commit: unique-constraint violation → 409 PATH_TAKEN
Second client: renames its local file to
               "notes (User B's conflicted copy).txt" and commits
               that as a new file.
\`\`\`

**The user sees** both files, distinguishable by name. Same resolution shape as case 1, arrived at through a different detection mechanism — **and the important point is that the *database* enforced it, so no code path could produce two files at one path.**

*The detail worth naming:* the conflict-copy name must be guaranteed free. The client appends a counter if needed — \`(2)\`, \`(3)\` — and **the unique constraint is what makes the retry loop terminate**, since eventually a free name is found.

**8. Restore to v3 while another device commits v9**

**Restore is not special — it is a new version whose content happens to be old.**

\`\`\`
Client requests restore to v3.
Server creates v10 with parentVersion = v9 (the CURRENT version)
  and block_list = v3's block_list.
\`\`\`

**Restoring must derive from the current version, not from v3.** If v10 declared v3 as its parent, it would 409 — and more importantly, treating a restore as "go back to v3" would discard v9's existence from the history rather than recording that a restore happened.

**The user sees** the file's content revert, and the version history shows \`v10 (restored from v3)\` after v9. **Nothing is lost:** v9 remains in the history and can itself be restored.

*The race, if the restore and v9's commit are simultaneous:* the restore reads the current version as v8, creates v10 with parent v8, and gets a 409 because v9 landed first. **The client retries the restore against v9.** Restore is idempotent in intent, so retrying is safe — and the retry must re-read the current version rather than reusing the stale one.

---

**Which case has no non-surprising answer?**

**Case 2, delete versus edit**, and I would escalate it rather than decide it.

*Why it is genuinely unresolvable:* every option surprises someone.

- **Restore the file** (edit wins): the user who deleted it sees it reappear and deletes it again — possibly repeatedly, if the other device keeps resurrecting it.
- **Keep only the conflicted copy** (delete wins, edit preserved): the user who edited it finds their file has been renamed and moved, for reasons they cannot see.
- **Discard the edit:** unacceptable.

**There is no option where both users see what they expect**, because their intentions genuinely conflict and no merge exists.

*What I would bring to the product owner:*

- **The recommendation:** delete wins, edit survives as a conflicted copy. It preserves the never-lose-work invariant while respecting the more recent explicit intent.
- **The specific surprise it causes**, stated plainly: the editing user's file is renamed without their action, and they need a notification explaining why.
- **The alternative worth considering:** if the two users are the *same person* on two devices — which is the common case — restoring the file may be less surprising, because the person remembers deleting it and will delete it again knowingly. **In a shared folder with two different people, the conflicted copy is clearly better.** So the right answer may differ by context, which is a product decision I cannot make.

*Case 3's cycle variant is the runner-up*, and it differs in kind: there the surprise is unavoidable but the *correct* behaviour is clear — reject the move that would create a cycle. **Case 2 has no correct behaviour, only trade-offs.**

**Which two cases share the same underlying mechanism?**

**Cases 4 and 5 both rest on the intent journal plus atomic rename**, and that is the obvious pairing.

**But the more interesting pairing is cases 1 and 7.** Both are "two writers, one target", and both resolve to a conflicted copy — yet they are *detected* by completely different mechanisms:

\`\`\`
Case 1: parent-version mismatch     → 409 from the version check
Case 7: unique path constraint      → 409 from the database
\`\`\`

**Case 1 is a conflict on the file's *identity*; case 7 is a conflict on the file's *name*.** A design that only implements the parent-version check handles case 1 and lets case 7 through — producing two files at one path, which is a corrupt tree state.

**So both mechanisms are required, and neither substitutes for the other.** That is worth stating because a candidate who describes only the version check has a design with a real hole in it, and the hole is invisible until two users create the same filename.

*And a third case shares the resolution:* case 2's delete-versus-edit also ends in a conflicted copy. **Three different detections, one resolution** — which is a sign the resolution is the right one.

**What single data-model addition would make case 3 unambiguous?**

**Store the parent folder id, not the path — and compute paths on the client.**

The lesson's \`files\` table already has \`parent_folder_id\`, and the addition is to make it **authoritative** and remove \`path\` as stored state:

\`\`\`sql
files(
  user_id, file_id,
  name,                  -- just the leaf name, not the full path
  parent_folder_id,      -- AUTHORITATIVE
  current_version, ...
  UNIQUE (user_id, parent_folder_id, name) WHERE deleted_at IS NULL
)
\`\`\`

**Three things this fixes.**

**Concurrent moves compose correctly.** A's move of X sets \`X.parent_folder_id = F\`. B's move of F sets \`F.parent_folder_id = G\`. **These touch different rows and both succeed**, and the resulting path is derived: \`/G/F/X\`. With stored paths, A's change would have written \`/F/X\` and B's change would have to rewrite every descendant's path — a cascading update over an unbounded subtree.

**The unique constraint becomes correct.** \`UNIQUE (parent_folder_id, name)\` enforces "no two entries with the same name in the same folder", which is the actual filesystem invariant. \`UNIQUE (path)\` enforces the same thing only as long as paths are consistent, which under concurrent moves they are not.

**A rename of a folder becomes one row update** rather than an update to every descendant. **That is the difference between reorganising a 50,000-file folder being instant and being a batch job.**

**And it makes the cycle check natural:** validating that a move does not create a cycle is a walk up the \`parent_folder_id\` chain, which is a bounded traversal of the tree depth rather than a string operation on paths.

*The cost:* clients must compute paths from parent references, which means holding the folder structure locally and recomputing descendant paths when an ancestor moves. **That is real client work and it is unavoidable** — the alternative is a server-side cascading path update, which is worse and still does not make concurrent moves compose.

*And the general principle:* **store the relationship, derive the path.** A path is a *view* of a tree, and storing a view means every structural change invalidates it. This is the same reasoning as storing an event log and deriving current state — the derived form is convenient and cannot be authoritative.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hgd-1',
      level: 'basic',
      question: 'Design Google Drive. Where do you start?',
      guidance:
        'With the observation that the replicas are laptops, and therefore with the change log — because everything a client can do depends on asking "what changed since cursor X". A strong answer does not start with storage.',
    },
    {
      id: 'iq-hgd-2',
      level: 'basic',
      question: 'How does a client learn what changed?',
      guidance:
        'A cursor-based delta over a per-user change log, with long-polling for immediacy. Look for the arithmetic that rules out polling the file list, and for the fallback poll being retained.',
    },
    {
      id: 'iq-hgd-3',
      level: 'intermediate',
      question: 'Two devices edit the same file offline. What happens?',
      guidance:
        'A parent-version conditional commit gives a 409, and the resolution keeps both copies. Look for the recognition that modification time cannot distinguish newer from concurrent.',
    },
    {
      id: 'iq-hgd-4',
      level: 'intermediate',
      question: 'How do you avoid re-uploading a large file after a small edit?',
      guidance:
        'Content-addressed blocks with a client-driven existence check. A strong answer notes this also gives cross-user deduplication and location-independence from the same mechanism.',
    },
    {
      id: 'iq-hgd-5',
      level: 'advanced',
      question: 'Deduplication means blocks are shared. How do you delete one safely?',
      guidance:
        'A grace period, pending references from the existence check, and a conditional delete — all three. Excellent answers describe the race precisely and note the failure is silent corruption of a file the user cannot re-upload.',
    },
    {
      id: 'iq-hgd-6',
      level: 'advanced',
      question: 'Two users concurrently move folders into each other. What happens?',
      guidance:
        'A cycle, which per-entity version checks do not catch — the server must validate tree invariants at commit. Excellent answers propose storing parent references rather than paths so moves compose.',
    },
    {
      id: 'iq-hgd-7',
      level: 'followup',
      question: 'Why not use a CRDT so conflicts resolve automatically?',
      guidance:
        'Concurrent tree moves are what CRDTs handle worst, metadata grows without bound, and converging silently on something nobody chose hides the conflict. Right for documents where the unit is an operation.',
    },
    {
      id: 'iq-hgd-8',
      level: 'followup',
      question: 'A user deletes a file on one device while editing it on another. What do you do?',
      guidance:
        'There is no non-surprising answer. A strong response recommends delete-wins with the edit preserved as a conflicted copy, states the surprise it causes, and notes the right answer may differ for one user on two devices versus two people in a shared folder.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hgd-1',
      kind: 'what-changes-if',
      prompt:
        'This design syncs whole files. Now change one thing: users must be able to edit the same document simultaneously, seeing each other\'s changes as they type. What does the architecture become?',
      discussion: `The unit changes from a file to an operation, and that replaces the design rather than extending it.

**Why whole-file sync cannot be made to work here.** The parent-version conditional commit is the mechanism, and it means **every concurrent edit is a conflict.** Two people typing in the same paragraph would produce a conflicted copy per keystroke. The design is correct for its problem and structurally wrong for this one.

**What the new architecture is.**

**Operations, not versions.** The client sends "insert 'x' at position 47", not "here is the new document". Operations are small, frequent — many per second per editor — and can be applied concurrently.

**A convergence algorithm, and this is where CRDTs become the right tool.** The problem the previous design rejected them for was a *filesystem tree*, where concurrent moves produce cycles. For a *sequence of characters*, a CRDT's merge semantics match the intent: two inserts at the same position both survive, deterministically ordered, and every replica converges on the same document. **Same technique, opposite verdict, because the data structure changed.**

*The alternative is operational transformation*, which rewrites incoming operations against concurrently-applied ones. It requires a server to establish an order and is harder to get right, and it produces smaller metadata than a CRDT — which is why both approaches exist.

**A persistent connection per editor.** Long-polling at keystroke frequency is untenable; this needs a WebSocket per active editor, with the server relaying operations to everyone in the document.

**Presence becomes a feature.** Cursors, selections, who is here. Ephemeral, high-frequency, and it does not need to be durable — so it is a separate channel from the operations.

**A snapshot plus a log, rather than versions.** Storing every operation forever is untenable, so periodically compact the operation log into a snapshot. A client joining loads the snapshot and replays operations since it.

**What survives from the previous design.**

**The change log idea**, in a different form — the operation log is the same structure at a finer grain.

**Cursor-based catch-up.** A client that was offline replays operations since its position.

**The block store**, for embedded images and attachments, which are still whole immutable files.

**Sharing and permissions**, unchanged.

**What gets harder, and this is the part people underestimate.**

**Metadata growth.** A CRDT for text keeps a tombstone for every deleted character, so a heavily-edited document's metadata can exceed its content by a large factor. **Compaction is not optional**, and it interacts badly with clients that have been offline — you cannot compact away operations a client still needs.

**Undo is genuinely hard.** In a single-user editor, undo reverses your last operation. With concurrent editors, "your last operation" may have been transformed, and reversing it may not restore any state that ever existed. **Undo in a collaborative editor is a research-grade problem**, and it is a feature users consider table stakes.

**Offline editing for a long period becomes questionable.** A week of offline operations replayed against a week of others' operations converges — to a document that may be incoherent. **CRDTs guarantee convergence, not sensibleness**, which is the same caveat as the shopping-cart merge from the delivery-semantics lesson.

**The system is now latency-sensitive.** Whole-file sync tolerates seconds; collaborative editing needs operations relayed in tens of milliseconds, which means regional presence and a connection topology that whole-file sync did not need.

**What I would actually build: both, side by side.**

Collaborative editing for the document types where it matters — text documents, spreadsheets — and whole-file sync for everything else. **They share the storage layer, the sharing model and the folder structure, and nothing else.** A design that tries to unify them produces a system that is bad at both, because "sync a 50 GB video file" and "relay keystrokes at 50 ms" have no common mechanism.

**The transferable point.** The unit of change determines the architecture. **Whole-file sync and operational collaboration are not points on a spectrum** — one is an eventually-consistent replicated store with conflict surfacing, the other is a real-time convergent data structure with a persistent connection. Recognising which problem you have, and that a product may have both, is the design decision; the algorithms follow from it.`,
    },
    {
      id: 'al-hgd-2',
      kind: 'debug',
      prompt:
        'A file-sync product built to this design has a support pattern: a small number of users report that one specific file "keeps coming back" after they delete it, or "keeps reverting" to an older version. Server logs show normal commits, no 409s for these files, and the change log looks consistent. Diagnose it.',
      discussion: `A file that resurrects or reverts, with no 409s and a consistent server log, means the server is doing exactly what it was told — so the wrong commits are being sent, and by a client. The absence of 409s is the strongest clue: whatever is happening, the client's declared parent version is always current, so it is not a concurrency conflict.

**Hypothesis 1 — a second device that is behind and keeps re-committing stale state.** A laptop that has been asleep, or whose sync engine has stalled, still holds an old version. If something causes it to re-scan and it believes its local file is a *modification* — because its last-synced record was lost or reset — it commits the old content with the *current* parent version. **The server accepts it: the parent is current, so this is a legitimate new version whose content happens to be old.**

*Why no 409:* the stale device is up to date on *versions* and stale on *content*. It fetched the delta (advancing its cursor) without applying the file, so it declares the correct parent and uploads wrong content.

*Why "keeps coming back":* the device repeats this whenever it re-scans, so the user deletes, the device re-commits, and the cycle repeats.

*Check:* the \`created_by_device\` field on the reverting versions. **If they all come from one device, this is it** — and that field existing is what makes the diagnosis a single query.

**Hypothesis 2 — the cursor advanced without the change being applied.** The client's cursor and its per-file applied state are two pieces of local state, and if they can diverge, the client believes it has applied a change it has not. Then a re-scan sees a difference between the folder and its recorded state and interprets it as a local edit.

*How it happens:* advancing the cursor before applying the changes in a batch, so a crash mid-batch skips changes permanently. **This is the offset-commit-before-processing bug from the delivery-semantics lesson**, in a sync client.

*Check:* whether the client advances its cursor per-change after applying, or per-batch before. And whether the affected users had a client crash or forced quit.

**Hypothesis 3 — a third-party tool rewriting the file.** Backup software, an antivirus scanner, or a cloud-sync competitor also watching the folder can rewrite the file — restoring an older copy, or re-writing it with identical content but a new modification time. The sync client sees a legitimate local change and commits it.

*Why it fits "a small number of users":* it correlates with having a particular tool installed, not with anything in the product.

*Check:* whether the reverted content matches a known older version exactly. **If it does, something is restoring it**, and the affected users likely share software.

**Hypothesis 4 — the rename-over-original pattern mishandled.** From the exercise: an application saves by writing a temp file and renaming over the original. If the client debounces incorrectly, it can observe the *intermediate* state — the moment the original is deleted — and commit a deletion, then commit the new file as unrelated. **A user deleting the file then sees it "come back" as the editor's next save re-creates it.**

*Check:* whether the affected files have extensions associated with editors that save this way, and whether the change log shows delete-then-create pairs rather than modifications.

**Hypothesis 5 — a shared folder where another user's device is the source.** If the file is in a shared folder, another user's stale device produces the same effect, and the reporting user has no visibility into it. **This is hypothesis 1 with the added difficulty that the cause is on a machine belonging to someone else.**

*Check:* whether the affected files are in shared folders, and whether \`created_by_device\` belongs to a different user.

**What I would check first: \`created_by_device\` on the resurrecting versions.** One query. If they cluster on a single device, hypotheses 1, 2 or 5; if they are the user's own active device, hypotheses 3 or 4. **This single field splits the space, which is a good argument for recording it.**

**Then: whether the client advances its cursor before or after applying** (hypothesis 2), because it is a code read and it is a systematic bug rather than an environmental one — so it would affect more users over time.

**Why "no 409s" is the most informative observation.**

It rules out the entire class of explanation candidates reach for first — concurrent edits, conflict handling, version races. **The conflict machinery is working perfectly; the problem is that a client is sending semantically wrong commits that are syntactically valid.**

That reframes the investigation from "the server's conflict logic is broken" to "a client's model of its own state is wrong", which is a completely different place to look. **And it is the harder place, because the client is on a machine you cannot inspect.**

**The design changes this incident demands.**

**Content-hash the whole file in the commit, and let the server reject a commit whose content matches an older version of the same file.** Not a hard rejection — the user might legitimately revert — but a **flagged** one that surfaces in the client as "this looks like a revert; confirm?". **That converts a silent resurrection into a visible question**, and it is the single highest-value guard.

**Make the cursor and the applied-state advance atomically**, in one local transaction, so they cannot diverge. If the local store cannot do that, advance the cursor only after the change is applied and verified — accepting reprocessing over skipping.

**Record and surface \`created_by_device\` in the client's version history.** The user seeing "reverted by Old-Laptop" diagnoses their own problem, which for this class of issue is faster than any support interaction.

**Add a client-side staleness guard:** a device that has not successfully synced for N days performs a full state verification before committing anything, rather than trusting its local record. **A long-asleep device is exactly the one whose state should not be trusted**, and it is the one most likely to cause this.

**Transferable:** in a system whose replicas are clients you do not control, a "consistent server, wrong outcome" report means a client is sending correct-looking commits derived from wrong local state. **The server cannot distinguish a legitimate revert from a stale device's mistake** — both are a valid commit with a current parent — so the guard has to be a content check plus attribution, not a stronger version protocol.`,
    },
  ],

  revision: {
    bullets: [
      'File sync is an eventually-consistent replicated store whose replicas are laptops you do not control.',
      'Design the change log first: everything a client can do depends on "what changed since cursor X".',
      'The log is partitioned per user with a per-user monotonic sequence, so a delta is a single-partition range scan.',
      'A global sequence would be a hot counter and a coordination bottleneck for no benefit.',
      'Polling the file list is unaffordable — 200,000 files is a ~40 MB response every 30 seconds, on both sides.',
      'Push beats polling by ~67×; keep the fallback poll for clients whose connection dropped.',
      'Modification time cannot distinguish "newer" from "concurrent", so it silently loses work.',
      'Each commit declares its parent version; a 409 means the client derived from a version that is no longer current.',
      'Keep both copies on conflict, and commit the copy with no parent so resolution provably terminates.',
      'There is no merge for arbitrary binary content, and a subtly-wrong merge is worse than two comparable files.',
      'Content addressing buys delta transfer, cross-user deduplication (~40%) and location-independence at once.',
      'Deduplication creates a deletion race needing all three of: a grace period, pending references, and a conditional delete.',
      'Cross-user deduplication leaks whether a user possesses a file — a privacy decision, not a technical one.',
      'A move is its own change type; treating a rename as delete-plus-add re-uploads the file.',
      'Store parent references and derive paths, so concurrent moves compose and a folder rename is one row update.',
      'The server must validate tree invariants at commit, because per-entity version checks do not catch cycles.',
      'The client needs a local database and an intent journal; download to a temp path and rename atomically.',
      'A CRDT is right for collaborative documents and wrong for a filesystem tree, where concurrent moves are the worst case.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A per-user ordered change log plus a content-addressed block store, with a client-side sync engine that applies deltas and resolves conflicts by keeping both copies.',
    whyItExists:
      'Because the replicas are user devices — writable, intermittently connected, and not upgradeable on your schedule — so convergence must be achievable by a client asking one cheap question repeatedly.',
    whenToUse: [
      'Whole-file sync across a user\'s devices, with offline support.',
      'When files can be large and edits small, making delta transfer essential.',
      'When conflicts must never lose work, even at the cost of visible clutter.',
    ],
    whenNotToUse: [
      'Real-time collaborative editing, where the unit is an operation rather than a file.',
      'A CRDT for the folder tree, where concurrent moves are the worst case.',
      'Modification-time comparison as a version model, ever.',
      'Stored absolute paths, which do not survive concurrent moves.',
    ],
    alternatives: [
      'Operation-based sync with a CRDT or operational transformation, for collaborative documents.',
      'A pull-only model, when clients never write and the folder is read-only.',
      'Per-user deduplication scope, when the cross-user information leak is unacceptable.',
      'Fan-out on read for large shared folders, instead of a log entry per member.',
    ],
    tradeoffs: [
      'A delta log buys cheap sync and costs a retention window plus a resync path.',
      'Content addressing buys delta transfer and deduplication and costs a deletion race and a privacy leak.',
      'Parent-version commits buy unambiguous conflict detection and cost a 409 path in the client.',
      'Conflict copies buy never losing work and cost visible clutter and support contacts.',
      'Long-polling buys simplicity and costs a held connection per online device.',
      'Parent references buy composable moves and cost client-side path computation.',
    ],
    failureModes: [
      'Polling the full file list, costing bandwidth proportional to account size on both sides.',
      'Modification-time comparison silently discarding one device\'s edit.',
      'A conflicted copy committed with a parent, so resolution can loop.',
      'A rename treated as delete-plus-add, re-uploading the file and re-downloading it elsewhere.',
      'Concurrent folder moves producing a cycle, which per-entity version checks do not catch.',
      'A block deleted between another user\'s existence check and their commit, corrupting a file irrecoverably.',
      'A partial download visible as the real file, which users experience as corruption.',
      'A cursor advanced before changes are applied, so a crash skips them permanently.',
      'An editor\'s write-and-rename pattern read as a delete plus an unrelated creation.',
      'A long-asleep device re-committing stale content with a current parent version.',
      'A client beyond the log retention window with no designed resync path.',
    ],
    followUpQuestions: [
      'How does a client learn what changed, and what does a quiet account cost?',
      'Is the sequence global or per user, and why?',
      'What identifies a version, and can it distinguish concurrent from newer?',
      'What happens on a conflict, and can the resolution loop?',
      'What is the unit of transfer, and what does a one-byte change to a large file cost?',
      'How is a shared block safely deleted?',
      'Does cross-user deduplication leak file possession, and is that acceptable?',
      'Is a move its own change type?',
      'Do you store paths or parent references, and what happens under concurrent moves?',
      'What does the client do if killed mid-transfer?',
      'What happens to a client that has been offline beyond the retention window?',
    ],
  },
});
