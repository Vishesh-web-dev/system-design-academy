import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-google-docs',
  title: 'Design Google Docs',
  summary:
    'The document is not the state — the ordered log of edits is, and the document is a cache of it. That reframing decides the concurrency mechanism, the persistence model, version history, and what offline reconciliation can honestly promise.',
  phase: 'hld',
  module: 'advanced-designs',
  position: 51,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 95,
  tags: ['ordering', 'convergence', 'presence', 'persistence', 'offline'],
  prerequisites: ['h-uber'],
  resources: [
    {
      key: 'crdt-tech',
      tier: 'must',
      note: 'Read it for what a conflict-free replicated data type guarantees and what it costs. The guarantee is convergence without coordination; the cost is per-character metadata that never fully goes away.',
    },
    {
      key: 'automerge-docs',
      tier: 'must',
      note: 'A working CRDT implementation for documents. Read the sections on change history and on document size — the size discussion is the honest account of the tombstone problem.',
    },
    {
      key: 'figma-multiplayer',
      tier: 'must',
      note: 'The central reference for the position taken here: a central server as the ordering authority, chosen deliberately over a peer-to-peer CRDT. Read it for why having a server changes the trade-off.',
    },
    {
      key: 'redis-expire',
      tier: 'good',
      note: 'Presence — cursors, selections, who is here — is high-volume disposable state with a TTL. Read the expiry semantics; the TTL is the departure mechanism, exactly as in the ride-hailing location tier.',
    },
    {
      key: 'martin-fowler-event-sourcing',
      tier: 'good',
      note: 'Read it for the log-is-the-truth framing and for snapshots as a derived cache. Version history in a collaborative editor is event sourcing whose events happen to be text edits.',
    },
    {
      key: 'figma-livegraph',
      tier: 'advanced',
      note: 'Read it for how live updates are delivered to many clients once the ordering problem is solved. Delivery and convergence are separate problems and it is worth seeing them separated.',
    },
  ],

  intuition: {
    body: `The instinct is that a collaborative editor stores a document and several people mutate it. **That framing produces an unfixable design**, because "the document" is not a thing that two people can concurrently mutate coherently.

**The reframing: the document is an ordered log of edits, and the visible document is a cache of replaying that log.** Once you accept it, four decisions fall out of one idea.

**Concurrency becomes ordering.** Two people typing at the same position are not conflicting over a value — they are producing two edits that need a total order. **Establish the order and there is no conflict**, because both edits apply, in sequence, with the second adjusted for the first.

**Persistence becomes an append.** Saving is appending an operation, not rewriting a document. **So there is no save button and no lost work** — the last operation to reach the server is durable.

**Version history is free.** The log *is* the history. **Restoring an old version is replaying to a point**, and "who wrote this sentence" is a query over the log rather than a feature that needs its own storage.

**And a snapshot is only an optimisation.** A million-operation document should not be replayed from scratch on every open, so you store a materialised form periodically. **But the snapshot is derived — if it disagrees with the log, the log wins.**

Then the choice that dominates these interviews: **who establishes the order?**

**A central server can**, by receiving operations, assigning sequence numbers, and adjusting each incoming operation for the ones it did not know about. That is operational transformation, and **it requires an authority** — which you have, because the document needs authentication, persistence and access control anyway.

**Or the data structure can**, by making every character's identity globally unique and every merge commutative, so that any two replicas converge with no coordination. That is a CRDT, and **it buys peer-to-peer and offline operation at the cost of per-character metadata that outlives the characters.**

**The honest answer is that the second solves a problem you may not have.** If a server is already in the path, the coordination it provides is free, and **paying CRDT metadata costs to avoid coordination you are already doing is the wrong trade.**

And one more asymmetry, which mirrors the ride-hailing lesson: **cursors and presence are enormously higher-volume than edits and completely disposable.** Nobody audits where a cursor was. **Different volume, different durability, different store.**`,
    analogyLimit:
      '"It is a document with locking" collapses immediately: locking a paragraph while someone types makes the product unusable, and locking a character is not implementable. The real trap, though, is subtler — "it stores a document" makes you look for a way to merge two versions of text, when the design that works never has two versions to merge. It has one ordered log of edits, and merging is not a step in it.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds a collaborative editor: the client sends the full document text on every change with a version number, the server rejects a write whose version is stale, and the client retries after refetching. Cursors are stored on the document row. Identify four failures and rank them.',
      answer: `**Failure 1 — sending the full document makes every keystroke cost the document's size, and this is the largest failure.**

\`\`\`
A 50-page document ≈ 150 KB of text
A typist produces ~5 changes/second
→ 750 KB/s uploaded, per editor
→ 10 editors in one document = 7.5 MB/s for typing
And the server must persist 150 KB per keystroke
\`\`\`

**The cost of an edit should be proportional to the edit, not to the document.** An insertion of one character is about 50 bytes as an operation — three thousand times smaller — and it stays 50 bytes when the document reaches 500 pages.

**And the durability cost is worse than the bandwidth cost.** Persisting a whole document per keystroke means rewriting the same rows continuously, which is write amplification measured in thousands.

*The fix:* **send operations, not documents.** \`insert("x", at: 412)\` is the unit, and it is the same size regardless of what surrounds it.

**Failure 2 — version-check-and-retry means concurrent typists livelock, and it is the failure that makes the product unusable.**

\`\`\`
Alice at v100: sends doc, accepted → v101
Bob at v100:   sends doc, REJECTED (stale)
Bob refetches v101, reapplies his change, sends → but Alice
  has typed twice more; Bob is now stale again
\`\`\`

**With two active typists, the slower one may never land a write.** Each retry takes a round trip, during which the other typist has advanced the version. **This is optimistic concurrency control applied to a workload where conflicts are the normal case rather than the exception** — and optimistic control only works when conflicts are rare.

**And when Bob's retry does land, he overwrites Alice's edits**, because "reapply my change to the new version" means recomputing a whole document from Bob's view of it. **Whoever writes last wins the entire document.**

*The fix:* **do not reject concurrent edits — order them.** The server accepts both operations, assigns them sequence numbers, and adjusts the second for the first. Nothing is rejected and nothing is lost.

**Failure 3 — cursors on the document row destroy the row.**

\`\`\`
10 editors × 1 cursor update/s = 10 writes/s per document
× 1 million active documents = 10 million writes/s
of data nobody will ever read twice
\`\`\`

**And they contend with the edits on the same row.** A cursor move — which nobody audits, which is worthless in two seconds — takes a lock on the row that edits need.

*The fix is the ride-hailing lesson's split:* **presence is high-volume disposable state and belongs in an in-memory store with a TTL**, where the TTL doubles as the departure mechanism — a client that stops reporting disappears from the collaborator list without any explicit leave message.

**Failure 4 — there is no history, and it cannot be added later.**

Storing only the current document means **"restore to yesterday" requires a separate snapshot system**, and "who wrote this paragraph" is unanswerable. Both are core expectations of the product.

*The fix is a consequence of fixing failure 1, not extra work:* **once the truth is a log of operations, history is already stored.** Restoring is replaying to a point; attribution is reading the operation that inserted a character. **The features that would each need their own subsystem come free from the representation.**

**Ranking. Failure 2 makes the product unusable** — the core promise is simultaneous editing, and version-check-and-retry means the second typist livelocks or overwrites. **Failure 1 is an efficiency failure that becomes an availability failure**, since 750 KB/s per typist exhausts capacity at modest scale. Failure 3 is a write-volume failure with a clean fix. Failure 4 is a missing feature that the right representation would have provided free.

**The unifying observation: all four come from storing the document instead of the edits.** The document view makes concurrency a merge problem, makes edits cost the document's size, gives presence nowhere natural to live, and throws away history. **The log view dissolves all four**, which is what makes it the correct reframing rather than merely a nice one.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
Multiple people edit one document simultaneously
Every editor converges on the same text
Each editor sees others' cursors, selections and identity
Edits are durable without an explicit save
Full version history, restorable to any point
Text is attributable to its author
A client can edit offline and reconcile on reconnect
Documents can be shared with view, comment or edit access
\`\`\`

**The clarifying questions that change the design:**

**How many simultaneous editors in one document?** *Typically 1–3, occasionally hundreds.* **A skewed distribution**, making fan-out a tail problem.

**Is there a central server in the path?** *Yes — authentication, access control, persistence.* **The question that decides the concurrency mechanism**, because an existing server can be the ordering authority for free.

**Must offline editing work?** *Yes, and sessions can last days.* The hard case, where an honest answer beats a clever one.

**Is history required?** *Full, indefinitely.* Forces the log to be the truth rather than a change feed.

**Rich text or plain?** *Rich text.* Operations carry attributes, and formatting ranges are their own ordering problem.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Local echo | 0 ms | Client applies its own edit immediately, then reconciles |
| Remote edit visible | p99 under 200 ms | Persistent connections, server-side ordering |
| Convergence | Guaranteed, always | A total order, not a merge heuristic |
| Presence update | Under 1 s, lossy | In-memory, TTL, no durability |
| Durability | No lost edit, no save button | Append-only op log |
| Document open | p99 under 1 s | Snapshot plus a short op tail |
| History | Full, indefinite | The log is the truth |

**Out of scope:** rendering, comment threads, suggestion mode, export.

## Step 2 — Estimation

\`\`\`
Documents:            1 billion
Concurrent sessions:  1 million (a doc open in an editor)
Actively typing:      ~10% at any instant = 100,000
Typing rate:          ~5 characters/s
→ 500,000 raw operations/s
Batched into 50 ms windows → ~100,000 batches/s
\`\`\`

**Batching is the first-order optimisation and nearly free:** 50 ms is below the threshold of noticing and collapses a keystroke burst into one message. **A fivefold reduction at no perceptible cost.**

**Presence volume, which dwarfs edits:**

\`\`\`
1 million sessions × 1 cursor update/s = 1,000,000 updates/s
vs 100,000 edit batches/s
\`\`\`

**Presence is ten times the edit volume and none of it is worth storing.** The same asymmetry as driver locations against trip transitions, and it drives the same split.

**Persistence:**

\`\`\`
Per operation: ~50 bytes (type, position, char, author, seq)
500,000 ops/s × 50 B = 25 MB/s = ~2 TB/day durable
\`\`\`

**2 TB/day of append-only operations.** Substantial, and the compaction question follows immediately: a heavily-edited document accumulates far more operation bytes than its text is worth.

\`\`\`
A 50-page document written over a year:
  ~150,000 characters, but ~500,000 operations
  (insertions, deletions, formatting, cursor-driven rewrites)
  → 25 MB of log for 150 KB of text
\`\`\`

**A 160× ratio of log to content** — which is why snapshots are not optional at scale, not for correctness but so that an open is not a 500,000-operation replay.

**Fan-out, and its skew:**

\`\`\`
Median document: 1 editor  → each op delivered to 0 others
p99 document:    5 editors → 4 deliveries per op
Tail:            300 editors in a shared meeting doc
                 → 300 deliveries per op, and if 10 people
                   type at once that is 3,000 deliveries/s
                   from one document
\`\`\`

**The tail is 300× the median** — the celebrity problem in a new costume: one document generating thousands of deliveries per second while a billion generate none.

## Step 3 — API design

\`\`\`
Session
  WS  /docs/{id}/session
      → { snapshot, snapshotSeq, ops: [...tail], sessionId }

  Client → server
    { kind: 'ops', baseSeq: 4102, ops: [ ... ] }
    { kind: 'presence', cursor: 412, selection: [412, 430] }

  Server → client
    { kind: 'ack', clientOpIds: [...], assignedSeq: [...] }
    { kind: 'ops', fromSeq: 4103, ops: [ ... ] }   -- others' edits
    { kind: 'presence', sessionId, cursor, selection, user }
    { kind: 'left', sessionId }

REST
  GET  /docs/{id}                        → snapshot + tail
  GET  /docs/{id}/history?from=&to=      → operations
  POST /docs/{id}/restore  { toSeq }     → appends inverse ops
\`\`\`

**Five decisions worth defending.**

**Every client operation carries \`baseSeq\`: the sequence the client had when it composed the op.** This one field makes ordering possible — **the server knows exactly which operations the client had not seen**, and therefore what to adjust against.

**Operations are acknowledged with their assigned sequence numbers**, which the client needs to reconcile its optimistic local state with the server's order.

**Presence shares the connection but is a different message kind**, explicitly lossy — dropped under load, never queued, never persisted.

**Restore appends inverse operations rather than rewinding.** It does not delete operations 4001 onward; it **appends the operations that transform the text back.** So a restore is itself an edit, in the history, and undoable.

**Reading history is a range over sequence numbers.** No separate versioning subsystem exists.

## Step 4 — Data model

\`\`\`sql
-- THE TRUTH: append-only, one sequence per document
doc_ops(
  doc_id, seq, client_op_id, author_id, at,
  kind,            -- insert | delete | format
  payload          -- position, content, attributes
)
PRIMARY KEY (doc_id, seq)
UNIQUE (doc_id, client_op_id)      -- idempotent retry

-- A CACHE of replaying the log, written periodically
doc_snapshots(doc_id, seq, content, created_at)
PRIMARY KEY (doc_id, seq)

-- Metadata
docs(doc_id, owner_id, title, latest_seq, created_at)
doc_acl(doc_id, principal_id, role)   -- view | comment | edit

-- PRESENCE: in memory, TTL 30 s, never persisted
presence:{doc_id} → HASH sessionId → { userId, cursor, selection }
\`\`\`

**Four decisions worth defending.**

**The sequence is per document, not global.** Ordering need only be total *within* a document — **two documents have no relationship** — so a global sequence would be a coordination point serving no purpose.

**\`UNIQUE (doc_id, client_op_id)\` makes retries idempotent.** A duplicate from a dropped connection is rejected by the constraint. **The same mechanism as the trip transition's sequence key**, for the same reason.

**Snapshots are keyed by the sequence they represent**, so a client gets a snapshot plus exactly the ops after it. **If one is lost or wrong, replaying regenerates it** — the log is the authority.

**Presence is not in the durable half at all.** No table, no column, no row.

## Step 5 — Architecture

\`\`\`
Client A ─┐                 ┌──────────────────────────┐
Client B ─┼── WebSocket ───▶│ Document server           │
Client C ─┘                 │ (one owner per document)  │
                            │  · assigns seq            │
                            │  · transforms ops         │
                            │  · fans out to sessions   │
                            └────┬──────────────┬───────┘
                                 │ append       │ presence
                          ┌──────▼──────┐  ┌────▼────────────┐
                          │ doc_ops     │  │ In-memory       │
                          │ (durable)   │  │ presence, TTL   │
                          └──────┬──────┘  └─────────────────┘
                                 │
                        ┌────────▼─────────┐
                        │ Snapshot worker   │
                        │ (periodic, async) │
                        └───────────────────┘
\`\`\`

**Why one server owns a document at a time.** Ordering needs a single decision point; **two assigners would need consensus per keystroke**, which single ownership avoids. Sessions route to the owner.

**Why that is acceptable.** **A billion documents shard perfectly by id**, so single ownership is not a global bottleneck — though an owner failure interrupts one document, which the failure section handles.

**Why snapshotting is asynchronous.** It is a read optimisation, so it must never be on the edit path. **If it lags, opens are slower; nothing is incorrect.**

**Why presence never touches the durable path.** Two streams with different guarantees, and **only one of them can slow down an edit.**

## Step 6 — The deep dive: ordering, and what offline can honestly promise

**How server-side ordering works, concretely.**

\`\`\`
Server at seq 100. Text: "hello"

Alice (baseSeq 100): insert("X", pos 5)   → "helloX"
Bob   (baseSeq 100): insert("Y", pos 0)   → "Yhello"

Server receives Alice first:
  assign seq 101, apply → "helloX"

Server receives Bob, baseSeq 100:
  Bob did not see op 101. Transform Bob's op against it:
    Alice inserted at 5; Bob inserts at 0 — before it — so
    Bob's position is unchanged.
  assign seq 102, apply → "YhelloX"

Server sends Alice: op 102 (Bob's insert at 0)
Server sends Bob:   op 101, transformed against Bob's own
                    pending op → insert("X", pos 6)
Both clients: "YhelloX"
\`\`\`

**The mechanism is one function: transform an operation against another that it did not see.** For text insert and delete, this is a position adjustment — an insertion before your position shifts you right, a deletion before it shifts you left.

**Three properties make this work.**

**The server is the only ordering authority**, so there is one sequence and no agreement problem.

**Clients apply their own operations immediately and reconcile after**, so **the local echo never waits** — the client holds unacknowledged ops, transforms arriving remote ops against them, and reconciles on acknowledgement.

**Transformation must be correct for concurrent pairs, and this is where implementations break.** Two insertions at the *same* position must be ordered consistently on both clients — by author id — or they converge on different text. **The convergence guarantee lives entirely in the transform function.**

**Why not a CRDT — and what a CRDT actually buys.**

A CRDT gives every character a globally unique identity, so an insertion says "after character \`a7f3\`" rather than "at position 5". **Position never needs adjusting, so merges are commutative and no authority is required.**

*What it costs:*

**Per-character metadata**, several times the size of the character itself.

**Tombstones that cannot be fully removed**, because a late operation may reference a deleted character. **So a rewritten document accumulates weight its text does not reflect**, and collecting a tombstone requires knowing no replica can still reference it — which requires knowing about all replicas, the coordination the CRDT was avoiding.

**And here is the decision: I would use server-ordered operations, because the server exists anyway.** Authentication, access control, persistence and history all require it. **A CRDT's guarantee is convergence without coordination, and I am already coordinating** — so paying per-character metadata to avoid coordination I cannot avoid is the wrong trade.

*When I would reverse this:* **genuine peer-to-peer, no server, or offline sessions long enough that transformation stops being meaningful.** Which brings the honest part.

**Offline reconciliation, and the promise that cannot be kept.**

\`\`\`
Alice goes offline at seq 4000, writes for three hours.
Meanwhile the document advances to seq 9500 — a co-author
rewrote the section Alice was editing.
Alice reconnects with 800 operations based on seq 4000.
\`\`\`

**Transformation is mechanically possible: each of Alice's 800 operations can be transformed against 5,500 it did not see.** The result is text that converges. **And it will be nonsense** — Alice's sentences interleaved into a section that no longer says what she was responding to.

**The mechanism does not fail; the meaning does.** Transformation preserves *character-level* intent and offers nothing at the level of "this paragraph now contradicts the one above it."

**So the honest design has a threshold.**

\`\`\`
Short divergence (minutes, small op count, non-overlapping regions):
  → transform and merge silently. This is the common case
    and it works well.

Long divergence, or overlapping edits:
  → do NOT silently merge. Materialise Alice's version as a
    separate artefact — a suggestion set, a branch, or a copy —
    and let a human resolve it.
\`\`\`

**Choosing "ask a human" is a design decision, not a failure to solve the problem.** A silent merge that produces incoherent prose is worse than a visible conflict, because **the user cannot see what went wrong or recover from it** — the original text is gone into a transformed blend.

*And the threshold needs a definition:* operation count, elapsed divergence, and whether the edited ranges overlap. **Overlap is the strongest signal** — 800 operations in an untouched section merge cleanly; 20 in a rewritten paragraph do not.

**Presence, briefly, because it is the volume.**

Cursors are ten times the edit volume and worth nothing after a second. **In-memory hash per document, TTL per session, fanned out on the same connection, dropped under load.** The TTL is the departure mechanism — the ride-hailing location tier in a different domain.

## Step 7 — What breaks at 10×

**10 million concurrent sessions, 1 million operations/s, 10 million presence updates/s.**

**Fan-out in the tail documents.** A 3,000-person shared document generating thousands of deliveries per second from one owner process. *Fix:* **a delivery tier separate from the ordering tier** — the owner assigns sequence numbers and hands the ordered stream to fan-out workers, so ordering stays single-threaded per document while delivery scales horizontally.

**Presence at 10 million updates/s** overwhelms per-document fan-out. *Fix:* **coalesce and rate-limit** — at most 4 presence messages per second per document however many editors moved. Presence is lossy by design, so dropping is legitimate.

**Snapshot generation falls behind** across a billion documents. *Fix:* snapshot on a policy, not a schedule — **on operation count since the last snapshot, and on session close** — so quiet documents are never snapshotted.

**Log volume reaches 20 TB/day.** *Fix:* tier it. Recent operations stay hot for transformation; **operations older than a snapshot move to cold storage**, since only history queries need them and those tolerate seconds.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| A client disconnects mid-edit | Unacknowledged ops in flight | Client retries with the same \`client_op_id\`; the unique constraint rejects duplicates |
| Document server (owner) crashes | That document pauses | **A new owner loads the snapshot plus the op tail and resumes.** Clients reconnect and resend unacknowledged ops. Other documents unaffected |
| Two servers briefly both own a document | Two sequence assigners | **The \`(doc_id, seq)\` primary key rejects the second writer's duplicate** — the append is the fencing mechanism |
| Snapshot is corrupt or missing | Slow open | Regenerate by replaying the log. **A cache miss, not data loss** |
| Presence store lost | Collaborator list empties | Refills within a second from the next presence update |
| Op log write fails | Edit not durable | **Do not acknowledge.** The client keeps retrying; local text stays ahead until the append succeeds |
| A client sends a very old \`baseSeq\` | Expensive transformation | Above a threshold, refuse to merge silently — return the divergence to the user as a separate version |
| Transform function has a bug | **Clients diverge silently** | The worst failure here. Detect with a periodic content hash exchange; on mismatch, resynchronise from the server's snapshot |

**Three rows carry the content.**

**The \`(doc_id, seq)\` primary key is the fencing mechanism.** If a partition leaves two servers believing they own a document, both append at the same sequence and **the database rejects one**. No lease, no consensus — **the log is itself the mutual exclusion**, the same insight as the ride-hailing conditional update: let the resource arbitrate.

**Never acknowledge an edit that is not durable.** The client's text is optimistically ahead and the ack is the promise. **Acknowledging early converts a retryable failure into lost work.**

**Silent divergence from a transform bug is the worst failure mode**, because everything appears to work while two people see different documents. **It needs active detection** — a periodic content-hash exchange — because nothing else surfaces it.

## Step 9 — Defending it

**"The design turns on one reframing: the document is not the state, the ordered log of edits is, and the visible document is a cache of replaying it.**

**That dissolves four problems at once.** Concurrency becomes ordering rather than merging, so nothing is ever rejected and nothing is lost. Persistence becomes an append, so there is no save button. **Version history is free, because the log is the history** — restore appends inverse operations rather than rewinding, so a restore is itself an edit and is itself undoable. And a snapshot is only a read optimisation: if it disagrees with the log, the log wins.

**On the ordering mechanism, I chose a server as the authority over a CRDT, deliberately.** A CRDT's guarantee is convergence without coordination, and its cost is per-character identity plus tombstones that cannot be collected without knowing about all replicas. **I am already coordinating** — the server exists for authentication, access control, persistence and history — **so paying that cost to avoid coordination I cannot avoid is the wrong trade.** One server owns a document at a time, which shards perfectly across a billion documents, and the log's unique sequence key is the fencing mechanism if ownership is ever briefly ambiguous.

**Presence is a separate system, because it is ten times the edit volume and worth nothing after a second.** In-memory, TTL, lossy under load, with the TTL as the departure mechanism.

**And on offline I would rather be honest than clever.** Short divergences transform and merge silently, which is the common case and works. **A three-hour offline session against a rewritten section can be transformed mechanically and the result is incoherent prose** — transformation preserves character-level intent and knows nothing about meaning. So above a threshold, defined by operation count and by whether the edited ranges overlap, I materialise the offline work as a separate version for a human to resolve. **A visible conflict is better than a silent blend the user cannot see or recover from.**

**What I gave up:** a single owner per document means a brief pause when a server fails; snapshots lag, so opens are occasionally slow; presence is lossy; and long offline sessions get a conflict rather than a merge.

**What would make me revisit it:** if the product had to work peer-to-peer with no server, the CRDT's cost would buy something real and I would pay it. And if a transform bug ever caused silent divergence in production, I would add continuous hash verification rather than periodic — because a convergence guarantee that is not measured is not a guarantee."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'log-is-truth',
      title: 'The log is the truth; everything else is derived or disposable',
      caption:
        'Step through it. Notice how many features come free from the representation — and how the two streams through the same connection get opposite guarantees.',
      nodes: [
        { id: 'clients', label: 'Editing clients', kind: 'client', x: 0, y: 140, detail: 'Apply their own edits immediately — local echo does not wait for the server — and hold unacknowledged operations, transforming arriving remote ops against them. Every op carries baseSeq: the sequence the client had when it composed the op.' },
        { id: 'owner', label: 'Document server (one owner per doc)', kind: 'service', x: 250, y: 140, detail: 'The only ordering authority. Two servers assigning sequence numbers for one document would need consensus per keystroke — which is exactly the coordination the single owner avoids. A billion documents shard perfectly by id.' },
        { id: 'transform', label: 'Transform against unseen ops', kind: 'note', x: 250, y: 20, detail: 'One function: adjust an incoming op for the ops its author had not seen. An insertion before your position shifts you right. Two insertions at the SAME position must be ordered consistently on both clients — by author id — or they diverge. The convergence guarantee lives entirely here.' },
        { id: 'log', label: 'doc_ops — append only, (doc_id, seq)', kind: 'store', x: 540, y: 100, detail: 'The truth. ~50 bytes per op regardless of document size. The primary key is also the fencing mechanism: if two servers briefly both own a document, the second append is rejected by the database. No lease, no consensus — let the resource arbitrate.' },
        { id: 'snap', label: 'Snapshot worker (async)', kind: 'service', x: 540, y: 250, detail: 'A read optimisation, never on the edit path. A 50-page document can carry 25 MB of log for 150 KB of text — a 160x ratio — so opening without a snapshot would be a 500,000-op replay. If a snapshot is lost or wrong, replay regenerates it: the log wins.' },
        { id: 'presence', label: 'Presence — in memory, TTL 30 s', kind: 'store', x: 250, y: 290, detail: 'Ten times the edit volume and worth nothing after a second. Never persisted, dropped under load, and the TTL is the departure mechanism — no leave message, no cleanup job. The ride-hailing location tier in a different domain.' },
        { id: 'history', label: 'History, restore, attribution', kind: 'note', x: 790, y: 100, detail: 'All free from the representation. Restore appends inverse ops rather than rewinding, so a restore is itself an edit and is itself undoable. "Who wrote this" is a read of the op that inserted the character.' },
      ],
      edges: [
        { id: 'g1', source: 'clients', target: 'owner', kind: 'sync' },
        { id: 'g2', source: 'owner', target: 'transform', kind: 'control' },
        { id: 'g3', source: 'owner', target: 'log', kind: 'write' },
        { id: 'g4', source: 'log', target: 'snap', kind: 'read' },
        { id: 'g5', source: 'owner', target: 'presence', kind: 'write' },
        { id: 'g6', source: 'log', target: 'history', kind: 'read' },
        { id: 'g7', source: 'owner', target: 'clients', kind: 'async' },
      ],
      steps: [
        {
          id: 'gs1',
          title: 'Send operations, not documents',
          description:
            'An insert is ~50 bytes and stays 50 bytes at 500 pages. Sending the whole document per keystroke costs 150 KB and rewrites the same rows continuously — write amplification in the thousands.',
          nodes: ['clients'],
          edges: [],
        },
        {
          id: 'gs2',
          title: 'One authority assigns the order',
          description:
            'Nothing is rejected. Two people typing at the same position are not conflicting over a value — they produce two ops that need a total order, and the second is adjusted for the first.',
          nodes: ['owner', 'transform'],
          edges: ['g1', 'g2', 'g7'],
        },
        {
          id: 'gs3',
          title: 'The append is the durability, and the fence',
          description:
            'Saving is appending. And the unique (doc_id, seq) key rejects a second writer if ownership is ever ambiguous — the log itself is the mutual exclusion.',
          nodes: ['log'],
          edges: ['g3'],
        },
        {
          id: 'gs4',
          title: 'Snapshots are a cache; history is not a feature',
          description:
            'Snapshotting is async and never on the edit path. Restore, version history and attribution all fall out of the log — subsystems that would each need building come free from the representation.',
          nodes: ['snap', 'history'],
          edges: ['g4', 'g6'],
        },
        {
          id: 'gs5',
          title: 'And the high-volume stream gets none of these guarantees',
          description:
            'A million presence updates per second, in memory, TTL, lossy. Same connection, opposite treatment — only one of the two streams can ever slow down an edit.',
          nodes: ['presence'],
          edges: ['g5'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'ordering-choice',
      title: 'Who establishes the order — and what each answer costs',
      caption:
        'Read the two branches as a single question about authority. The CRDT branch is not wrong; it buys something specific, and the question is whether you need it.',
      code: `flowchart TB
    Q["**Two people edit concurrently.<br/>Who establishes the order?**"]

    Q -->|"A central server"| S["**Server-ordered operations**"]
    S --> S1["Client sends op + baseSeq<br/>Server assigns seq, transforms<br/>against ops the client<br/>had not seen"]
    S1 --> S2["**Gains:** ~50 bytes per op,<br/>no per-character metadata,<br/>no tombstones, history free"]
    S1 --> S3["**Costs:** requires an authority;<br/>one owner per document;<br/>convergence lives in the<br/>transform function"]

    Q -->|"The data structure itself"| C["**CRDT**"]
    C --> C1["Every character has a unique<br/>identity — 'insert after a7f3'<br/>Merges commute, no<br/>authority needed"]
    C1 --> C2["**Gains:** peer-to-peer,<br/>arbitrary offline,<br/>convergence with zero<br/>coordination"]
    C1 --> C3["**Costs:** per-character metadata;<br/>tombstones that cannot be<br/>collected without knowing<br/>about all replicas"]

    S3 --> D["**The decision here:<br/>server-ordered.**<br/>A server already exists for auth,<br/>ACL, persistence and history —<br/>so I am already coordinating.<br/>Paying CRDT metadata to avoid<br/>coordination I cannot avoid is<br/>the wrong trade."]
    C3 --> D

    D --> R["**Reverse it when:** no server at all,<br/>or offline sessions so long that<br/>transformation converges on<br/>text but not on meaning"]

    style D fill:#17272a,stroke:#35897e
    style R fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: ['figma'],
    body: `The published account of Figma's multiplayer system is the clearest statement of the position taken here, and three of its points matter.

**They considered a CRDT and chose a central server instead.** The reasoning is that CRDTs are designed for systems with no central authority, and **Figma has a server** — so the property a CRDT buys is one they do not need to buy. That is the same argument as this design's, made by a team who shipped it.

**They note that CRDT metadata and tombstones are the cost.** Every element needs identity and ordering information that outlives it, and **a document accumulates weight its content does not reflect.** The published account is explicit that this cost is what tipped the decision.

**And they separate ordering from delivery.** The server establishes what happened; distributing it to clients is a different concern with different scaling properties. **That separation is what makes the 10× fan-out fix available** — keep ordering single-threaded per document, scale delivery horizontally.

**Three transferable lessons.**

**Ask what the exotic mechanism buys before paying for it.** A CRDT's guarantee is convergence without coordination. **If you are already coordinating for other reasons, that guarantee is not a benefit** — it is a cost with no matching gain. This is the most reusable form of the argument, and it applies well beyond editors.

**A single owner per small unit is not a bottleneck.** One server per document across a billion documents shards perfectly. **"Single-threaded" sounds alarming and is fine when the unit is small and independent** — the question is always what the unit is.

**Separate the guarantee that needs a single point from the work that does not.** Ordering needs one decision maker; delivery does not; presence needs neither durability nor ordering. **Three streams, three treatments.**

**Where the reference does not help.** Figma's document model is a graph of design objects, not a linear text sequence, so **their transformation problem is different from text's**. And it says little about long offline sessions, which is where the honest answer — refuse to merge silently, materialise a separate version — is a product decision rather than an engineering one.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, most of which follow from treating the log rather than the document as the truth.',
    rows: [
      {
        option: 'Store the document, send full text per change',
        whenItWins:
          'A single-editor editor with infrequent saves.',
        whenItLoses:
          'An edit costs the document\'s size — 150 KB per keystroke on a 50-page document — and every keystroke rewrites the same rows.',
        cost:
          'Bandwidth proportional to document size, and write amplification in the thousands.',
      },
      {
        option: 'Store an append-only operation log',
        whenItWins:
          'Always here. ~50 bytes per edit regardless of document size, and history, restore and attribution come free.',
        whenItLoses:
          'A 160× log-to-content ratio on heavily-edited documents, so snapshots become necessary.',
        cost:
          '~2 TB/day of appends, plus a snapshot pipeline and log tiering.',
      },
      {
        option: 'Optimistic version-check-and-retry',
        whenItWins:
          'When conflicts are rare — which is the assumption optimistic control is built on.',
        whenItLoses:
          'Here conflicts are the normal case: the slower typist livelocks, and their retry overwrites the other\'s edits.',
        cost:
          'The product\'s core promise.',
      },
      {
        option: 'Server-ordered operations with transformation',
        whenItWins:
          'When a server already exists for authentication, access control and persistence — so its coordination is free.',
        whenItLoses:
          'Peer-to-peer, or offline sessions long enough that transformation is meaningless.',
        cost:
          'One owner per document, and a transform function whose correctness is the convergence guarantee.',
      },
      {
        option: 'CRDT',
        whenItWins:
          'No central authority, or arbitrary offline divergence with automatic convergence.',
        whenItLoses:
          'When you are already coordinating — the guarantee is then a cost with no matching gain.',
        cost:
          'Per-character metadata, and tombstones that cannot be collected without knowing about all replicas.',
      },
      {
        option: 'Presence on the document row',
        whenItWins:
          'Nowhere. It is 10 million writes/s of data nobody reads twice.',
        whenItLoses:
          'It contends with edits on the same row, for state worthless in two seconds.',
        cost:
          'Row contention on the path that must never be slow.',
      },
      {
        option: 'Presence in memory with a TTL, lossy',
        whenItWins:
          'Always. The TTL is the departure mechanism, and dropping under load is legitimate.',
        whenItLoses:
          'A cursor can be briefly stale or missing.',
        cost:
          'Nothing that matters; losing the store refills in a second.',
      },
      {
        option: 'Synchronous snapshot on every edit',
        whenItWins:
          'Nowhere. It puts a document-sized write on the keystroke path.',
        whenItLoses:
          'It reintroduces the full-document write that the log representation removed.',
        cost:
          'Edit latency proportional to document size.',
      },
      {
        option: 'Asynchronous snapshots on a policy',
        whenItWins:
          'Always. Never on the edit path, and quiet documents are never snapshotted.',
        whenItLoses:
          'A lagging snapshot means a slower open.',
        cost:
          'Opens replay a longer tail when the worker is behind.',
      },
      {
        option: 'Silently merge any offline divergence',
        whenItWins:
          'Short divergences in non-overlapping regions — the common case, and it works well.',
        whenItLoses:
          'A three-hour session against a rewritten section: mechanically transformable, semantically incoherent.',
        cost:
          'Prose the user cannot recognise, with the original gone into the blend.',
      },
      {
        option: 'Threshold, then materialise a separate version',
        whenItWins:
          'Long divergence or overlapping edits. A visible conflict the user can resolve.',
        whenItLoses:
          'It asks the user to do work, and the threshold needs defining.',
        cost:
          'A resolution step, and a threshold on op count, elapsed time and range overlap.',
      },
      {
        option: 'A global sequence across all documents',
        whenItWins:
          'Nowhere. Ordering is only needed within a document.',
        whenItLoses:
          'It creates a coordination point serving no purpose and caps total throughput.',
        cost:
          'A global bottleneck for a per-document guarantee.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The client sends the updated document with a version number, and the server rejects stale writes."',
      whyWeak:
        'Two failures at once. Every keystroke costs the document\'s size, and optimistic version checking assumes conflicts are rare when here they are the normal case — the slower typist livelocks, and when their retry lands it overwrites the other\'s edits because it carries a whole document computed from a stale view.',
      strongAnswer:
        '"Clients send operations, not documents — an insert is about 50 bytes and stays 50 bytes on a 500-page document. And nothing is rejected: the server assigns a sequence number to every operation and transforms each one against the operations its author had not yet seen. Concurrency becomes ordering rather than merging, so both edits apply and neither is lost."',
    },
    {
      weakAnswer: '"Use a CRDT — it handles concurrent editing automatically."',
      whyWeak:
        'It names a mechanism without stating what it buys. A CRDT\'s guarantee is convergence without coordination, and its costs are per-character identity metadata plus tombstones that cannot be collected without knowing about all replicas.',
      strongAnswer:
        '"A CRDT buys convergence with no central authority. But a server is already in the path for authentication, access control, persistence and history — so I am already coordinating, and paying per-character metadata to avoid coordination I cannot avoid is the wrong trade. I would use server-assigned ordering with transformation. I would reverse that for genuine peer-to-peer, or if offline sessions were long enough that transformation converges on text but not on meaning."',
    },
    {
      weakAnswer: '"Store the current document, and add version history by snapshotting periodically."',
      whyWeak:
        'It builds a second subsystem for something the right representation provides free, and periodic snapshots cannot answer "who wrote this sentence" or restore to an arbitrary point.',
      strongAnswer:
        '"The log is the history — restoring is replaying to a point, and attribution is reading the operation that inserted a character. Restore appends inverse operations rather than rewinding, so a restore is itself an edit in the history and is itself undoable. Snapshots exist, but as a read cache: a heavily-edited document can carry a 160× log-to-content ratio, so opening without one would be a half-million-operation replay. If a snapshot disagrees with the log, the log wins."',
    },
    {
      weakAnswer: '"Cursor positions are stored on the document so all clients can read them."',
      whyWeak:
        'Presence is roughly ten times the edit volume and worthless after a second. Putting it on the document row means millions of writes per second of never-re-read data, contending with edits on the same row.',
      strongAnswer:
        '"Presence goes in an in-memory hash per document with a per-session TTL, fanned out on the same connection as edits but treated oppositely — lossy, droppable under load, never persisted. The TTL is also the departure mechanism, so there is no leave message and no cleanup job. It is the same split as disposable driver locations against durable trip transitions: same source, opposite guarantees."',
    },
    {
      weakAnswer: '"Offline edits are transformed against everything that happened and merged automatically."',
      whyWeak:
        'Mechanically true and it produces incoherent prose for long divergences. Transformation preserves character-level intent and knows nothing about meaning, so 800 operations merged into a rewritten section interleave sentences that no longer respond to anything.',
      strongAnswer:
        '"Short divergences in non-overlapping regions transform and merge silently, and that is the common case. Above a threshold — operation count, elapsed time, and crucially whether the edited ranges overlap — I refuse to merge silently and materialise the offline work as a separate version for a human to resolve. A visible conflict is better than a silent blend, because the user can see and recover from the former and not the latter. Choosing to ask a human is a design decision here, not a failure to solve the problem."',
    },
    {
      weakAnswer: '"Any server instance can accept edits for any document; they write to a shared log."',
      whyWeak:
        'Ordering needs a single decision point. Two servers assigning sequence numbers for one document would need consensus per keystroke, and without it they produce conflicting sequences and clients diverge.',
      strongAnswer:
        '"One server owns a document at a time, and sessions route to that owner. That shards perfectly — a billion independent documents — so single-threaded ordering per document is not a global bottleneck. And if a partition ever makes ownership briefly ambiguous, the log\'s unique (doc_id, seq) key rejects the second writer\'s append. The log is the fencing mechanism, so I need no lease and no consensus protocol — the resource arbitrates."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hdc-1',
      front: 'What is the reframing this design turns on?',
      back: 'The document is not the state — the ordered log of edits is, and the visible document is a cache of replaying it.',
      topic: 'ordering',
    },
    {
      id: 'fc-hdc-2',
      front: 'What four problems does the log framing dissolve at once?',
      back: 'Concurrency becomes ordering rather than merging; persistence becomes an append; version history is free; and snapshots become a mere optimisation.',
      topic: 'ordering',
    },
    {
      id: 'fc-hdc-3',
      front: 'Why send operations rather than the document?',
      back: 'An edit should cost what the edit costs, not what the document costs. An insert is ~50 bytes at any document size; full text is 150 KB per keystroke on 50 pages.',
      topic: 'ordering',
    },
    {
      id: 'fc-hdc-4',
      front: 'Why does optimistic version-check-and-retry fail here?',
      back: 'It assumes conflicts are rare; here they are normal. The slower typist livelocks, and their retry carries a whole document from a stale view, overwriting the other\'s edits.',
      topic: 'convergence',
    },
    {
      id: 'fc-hdc-5',
      front: 'What does baseSeq on each client operation enable?',
      back: 'The server knows exactly which operations the client had not seen, and therefore exactly what to transform the incoming operation against.',
      topic: 'convergence',
    },
    {
      id: 'fc-hdc-6',
      front: 'Where does the convergence guarantee actually live?',
      back: 'In the transform function. Two insertions at the same position must be ordered consistently on both clients — by author id, say — or they converge on different text.',
      topic: 'convergence',
    },
    {
      id: 'fc-hdc-7',
      front: 'What does a CRDT buy, and what does it cost?',
      back: 'Buys convergence with no central authority. Costs per-character identity metadata and tombstones that cannot be collected without knowing about all replicas.',
      topic: 'convergence',
    },
    {
      id: 'fc-hdc-8',
      front: 'Why choose server-ordered operations over a CRDT here?',
      back: 'A server already exists for auth, ACL, persistence and history, so you are already coordinating. Paying CRDT metadata to avoid unavoidable coordination is the wrong trade.',
      topic: 'convergence',
    },
    {
      id: 'fc-hdc-9',
      front: 'Why is one owner per document acceptable rather than a bottleneck?',
      back: 'A document is a small independent unit, so a billion of them shard perfectly. Single-threaded ordering is fine when the unit is small.',
      topic: 'ordering',
    },
    {
      id: 'fc-hdc-10',
      front: 'What fences a document against two servers briefly both owning it?',
      back: 'The unique (doc_id, seq) primary key — the second writer\'s append is rejected. The log itself is the mutual exclusion; no lease or consensus needed.',
      topic: 'persistence',
    },
    {
      id: 'fc-hdc-11',
      front: 'How does restore work, and why that way?',
      back: 'By appending inverse operations, not rewinding the log. So a restore is itself an edit, appears in history, and is itself undoable.',
      topic: 'persistence',
    },
    {
      id: 'fc-hdc-12',
      front: 'Why are snapshots necessary if the log is the truth?',
      back: 'Only for read cost — a heavily-edited document can carry a 160× log-to-content ratio, so opening would replay half a million operations. If a snapshot disagrees with the log, the log wins.',
      topic: 'persistence',
    },
    {
      id: 'fc-hdc-13',
      front: 'How is presence treated, and why?',
      back: 'In memory, per-session TTL, lossy, never persisted — roughly 10× the edit volume and worth nothing after a second. The TTL is the departure mechanism.',
      topic: 'presence',
    },
    {
      id: 'fc-hdc-14',
      front: 'Why refuse to silently merge a long offline divergence?',
      back: 'Transformation preserves character-level intent and knows nothing about meaning, so the merge converges on text and produces incoherent prose. A visible conflict is recoverable; a silent blend is not.',
      topic: 'offline',
    },
  ],

  quiz: [
    {
      id: 'q-hdc-1',
      kind: 'scenario',
      prompt:
        'Two people type at the same position simultaneously. What resolves it?',
      options: [
        { id: 'a', label: 'The server assigns both operations a sequence number and transforms the second against the first — nothing is rejected' },
        { id: 'b', label: 'The second write is rejected as stale and the client retries after refetching' },
        { id: 'c', label: 'The paragraph is locked while one person types' },
        { id: 'd', label: 'Last writer wins, since text edits are idempotent' },
      ],
      correct: ['a'],
      explanation:
        'Concurrency here is an ordering problem, not a merge problem: both edits apply, in sequence, with the second adjusted for the first. Option b is optimistic concurrency control applied where conflicts are the normal case, so the slower typist livelocks. Option c makes the product unusable, and option d loses one person\'s work.',
      difficulty: 'core',
      topic: 'convergence',
    },
    {
      id: 'q-hdc-2',
      kind: 'scenario',
      prompt:
        'A candidate proposes a CRDT. What is the strongest argument against it in this design?',
      options: [
        { id: 'a', label: 'Its guarantee is convergence without coordination, and a server already exists for auth, ACL and persistence — so the guarantee is a cost with no matching gain' },
        { id: 'b', label: 'CRDTs cannot guarantee convergence for text' },
        { id: 'c', label: 'CRDTs require every client to be online' },
        { id: 'd', label: 'CRDTs cannot support version history' },
      ],
      correct: ['a'],
      explanation:
        'The argument is about whether you need what it buys. Options b and c are false — convergence and offline operation are exactly what CRDTs provide. Option d is also false. The real cost is per-character metadata and tombstones that cannot be collected without knowing about all replicas, and that cost only pays for itself when there is no authority.',
      difficulty: 'advanced',
      topic: 'convergence',
    },
    {
      id: 'q-hdc-3',
      kind: 'scenario',
      prompt:
        'A network partition briefly leaves two servers believing they own one document. What prevents divergence?',
      options: [
        { id: 'a', label: 'The unique (doc_id, seq) primary key rejects the second writer\'s append — the log is the fencing mechanism' },
        { id: 'b', label: 'A distributed lock on the document id' },
        { id: 'c', label: 'A consensus round before each sequence assignment' },
        { id: 'd', label: 'Nothing — both sequences are merged when the partition heals' },
      ],
      correct: ['a'],
      explanation:
        'Let the resource arbitrate: two appends at the same sequence cannot both succeed, so no lease or consensus protocol is needed. This is the same insight as the conditional update on a driver row in the ride-hailing design. Option c would put a consensus round on every keystroke, which is precisely what single ownership avoids.',
      difficulty: 'advanced',
      topic: 'persistence',
    },
    {
      id: 'q-hdc-4',
      kind: 'scenario',
      prompt:
        'A document\'s snapshot is found to be corrupt. What is the impact?',
      options: [
        { id: 'a', label: 'A slower open while the log is replayed to regenerate it — a cache miss, not data loss' },
        { id: 'b', label: 'The document is lost back to the previous snapshot' },
        { id: 'c', label: 'Edits made since the snapshot are unrecoverable' },
        { id: 'd', label: 'The document must be restored from backup' },
      ],
      correct: ['a'],
      explanation:
        'The snapshot is derived from the log, so it is regenerable by definition. If it ever disagrees with the log, the log wins. Options b, c and d all treat the snapshot as authoritative, which inverts the design\'s central relationship.',
      difficulty: 'core',
      topic: 'persistence',
    },
    {
      id: 'q-hdc-5',
      kind: 'scenario',
      prompt:
        'Someone edits offline for three hours while a co-author rewrites the same section. On reconnect, what should happen?',
      options: [
        { id: 'a', label: 'Refuse to merge silently — materialise the offline work as a separate version for a human to resolve' },
        { id: 'b', label: 'Transform all 800 offline operations against the 5,500 they missed and merge automatically' },
        { id: 'c', label: 'Discard the offline edits, since the document has moved on' },
        { id: 'd', label: 'Discard the online edits, since the offline author was editing first' },
      ],
      correct: ['a'],
      explanation:
        'Option b is mechanically possible and produces incoherent prose: transformation preserves character-level intent and knows nothing about meaning. The strongest signal for the threshold is whether the edited ranges overlap — 800 operations in an untouched section merge cleanly. Options c and d destroy work silently, which is worse than a visible conflict.',
      difficulty: 'advanced',
      topic: 'offline',
    },
    {
      id: 'q-hdc-6',
      kind: 'multi',
      prompt:
        'Which features come free from making the operation log the truth? Select all that apply.',
      options: [
        { id: 'a', label: 'Version history — the log is the history' },
        { id: 'b', label: 'Attribution — read the operation that inserted the character' },
        { id: 'c', label: 'Durability without a save button — saving is appending' },
        { id: 'd', label: 'Cursor presence for collaborators' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are consequences of the representation rather than separate subsystems, which is what makes the reframing worth so much. Presence is not among them: it is disposable high-volume state with no ordering or durability requirement, and it needs its own store precisely because the log is the wrong home for it.',
      difficulty: 'core',
      topic: 'persistence',
    },
  ],

  exercises: [
    {
      id: 'ex-hdc-1',
      kind: 'design',
      title: 'Add comments and suggestions, and watch anchoring break',
      estimatedMinutes: 40,
      prompt: `The product adds two features:

**Comments** anchored to a range of text, visible in a margin, with replies and resolution.
**Suggestion mode**, where an editor's changes are proposed rather than applied, and an owner accepts or rejects each one.

**Part 1.** Comments anchor to a text range. The text moves as others edit. State the anchoring problem precisely and give three mechanisms with their failure modes.

**Part 2.** Suggestion mode means an operation exists but is not applied. How does that interact with the ordering model? Be specific about what the log contains and what each client renders.

**Part 3.** Accepting a suggestion made against an older version of the text. What has to happen, and when must it be refused?

**Part 4.** Name four new failure modes and what each does.

Then answer:

- Which of these two features is harder, and why?
- What does suggestion mode reveal about the claim that "the document is a cache of the log"?`,
      rubric: [
        'States the anchoring problem as position invalidation under concurrent edits.',
        'Gives three anchoring mechanisms with concrete failure modes.',
        'Recommends one with reasoning.',
        'Models suggestions as operations in the log with a pending state, not as separate documents.',
        'Explains that clients render a projection, and that different clients may render different projections.',
        'Handles acceptance of a stale suggestion via transformation, with a refusal threshold.',
        'Names at least four failure modes with consequences.',
        'Answers which feature is harder with reasoning.',
        'Draws the right conclusion about the log-to-document relationship becoming one-to-many.',
      ],
      modelAnswer: `**Part 1 — the anchoring problem, stated precisely**

**A comment is attached to a range that was meaningful at the version it was created against, and text positions are not stable under concurrent editing.**

\`\`\`
At seq 500: comment C anchored to characters [412, 430]
            ("the Q3 forecast")
At seq 620: someone inserted 80 characters at position 100
            → the commented text is now at [492, 510]
            → C still points at [412, 430], which is now
              mid-sentence somewhere earlier
\`\`\`

**And the deeper problem: the anchored text may cease to exist.** Someone deletes the sentence the comment was about. **The comment is now anchored to nothing**, and there is no position that is correct.

**So anchoring has two distinct sub-problems** — position drift, which is solvable mechanically, and target destruction, which is not.

**Mechanism 1 — store absolute offsets and transform them like operations.**

The comment's range is \`[412, 430]\` and every subsequent operation transforms it exactly as it would transform a pending edit's position.

*Failure modes:*

**It requires transforming every comment on every operation.** A document with 200 comments and 500,000 operations means transforming 200 ranges per keystroke. **The cost is comments × operations**, which is the wrong shape.

**A deletion overlapping the range leaves it degenerate.** Delete the middle of the commented text and the range collapses. **There is no correct answer**, and the mechanism silently produces a zero-length or nonsensical range.

*Verdict:* correct in principle, wrong cost, and it does not solve destruction.

**Mechanism 2 — anchor to character identity rather than position.**

Give the boundary characters stable identities and store the comment as "from character \`a7f3\` to character \`b219\`". **Positions never need transforming, because identity does not move.**

*Failure modes:*

**It reintroduces exactly the CRDT cost the main design rejected** — per-character identity metadata — but only for anchored characters, which is a much smaller set.

**Deleting an anchor character orphans the comment**, and the identity must survive as a tombstone to be recognisable. **So this mechanism needs tombstones for anchor characters specifically.**

*Verdict:* the mechanically cleanest, at the cost of introducing identity for a subset of characters.

**Mechanism 3 — store the anchor as position plus the quoted text, and re-locate on read.**

The comment stores \`[412, 430]\` *and* the string it referred to. On render, look near the stored position for that string; if found, anchor there; if not, search wider; if still not found, mark the comment orphaned.

*Failure modes:*

**It is a heuristic and it is sometimes wrong.** Repeated text — "the Q3 forecast" appearing three times — can re-locate to the wrong instance. **Wrong-but-plausible is a worse failure than orphaned.**

**Re-location cost is on the read path**, which is where the product is latency-sensitive.

**Partial edits inside the quoted text defeat matching**, so a comment on text that was lightly edited orphans even though a human would say it still applies.

*Verdict:* cheap, and its failures are visible to users in an unhelpful way.

**What I would build: identity anchors for the boundaries, with quoted text as a fallback for display.**

\`\`\`
comment_anchors(
  comment_id, doc_id,
  start_char_id, end_char_id,   -- stable identity
  quoted_text,                   -- for orphan display + repair
  created_at_seq,
  state                          -- anchored | orphaned | resolved
)
\`\`\`

**Three reasons.**

**Identity means no per-keystroke transformation cost**, which mechanism 1 cannot avoid.

**Orphaning becomes detectable rather than silent.** If an anchor character is deleted, the comment's state changes to orphaned, and the product can show it in a "comments on deleted text" section. **The quoted text is what makes that display useful** — the user sees what the comment was about even though the text is gone.

**And target destruction gets an honest answer rather than a wrong position.** A comment whose text was deleted is *orphaned*, which is the truth. **Mechanism 3's heuristic would put it somewhere plausible and wrong**, and mechanism 1 would collapse it to a degenerate range.

*What this costs:* identity metadata for anchor characters, and tombstones for deleted anchors. **A bounded version of the CRDT cost, paid only where it buys something** — which is the same reasoning as the main design's, applied in the other direction.

---

**Part 2 — suggestion mode in the ordering model**

**The key insight: a suggestion is an operation in the log with a pending state, not a separate document or a diff.**

\`\`\`sql
doc_ops(
  doc_id, seq, client_op_id, author_id, at, kind, payload,
  suggestion_id,   -- NULL for applied ops
  status           -- applied | pending | rejected
)
\`\`\`

**So the log contains everything: applied operations and pending ones, in one total order.** Ordering is unchanged — the server still assigns a sequence number to every incoming operation, suggestion or not, and still transforms it against what its author had not seen.

**What changes is that the document is no longer one projection of the log.**

\`\`\`
Projection "accepted":   replay ops where status = 'applied'
Projection "with S":     replay applied ops + suggestion S's ops
Projection "all":        replay applied + all pending
\`\`\`

**Each client renders a projection, and different clients render different ones.** An owner reviewing suggestion S sees the "with S" projection; another editor sees "accepted"; a third sees "all" with change bars.

**Three consequences worth naming.**

**Positions differ between projections.** A pending insertion of 40 characters means the same logical location has different offsets in "accepted" and "with S". **So a client editing in one projection composes operations whose positions are only meaningful in that projection** — and \`baseSeq\` alone no longer identifies the client's view.

*The fix:* an operation carries both \`baseSeq\` **and** the projection it was composed against. **The server transforms into the accepted projection before assigning a sequence number.** Without this, an edit made while viewing suggestions lands at the wrong offset.

**Pending operations must transform as live edits do.** A suggestion sitting for a week while the surrounding text is edited must have its positions transformed by every intervening operation, or accepting it later applies it in the wrong place. **So pending operations are not frozen — they track the document.**

**And a suggestion can become un-applicable.** If the text it modifies is deleted, the suggestion has nothing to apply to. **Same shape as an orphaned comment**, and it needs the same honest state rather than a silent misapplication.

---

**Part 3 — accepting a stale suggestion**

\`\`\`
Suggestion S composed at seq 4000: replace [412, 430] with "Q4"
Accepted at seq 9500. In between:
  · 5,500 operations
  · The paragraph containing [412, 430] was edited
\`\`\`

**What has to happen: transform S's operations against everything since, then apply them as normal operations with new sequence numbers.**

\`\`\`
1. Take S's pending ops, already transformed forward to
   the current sequence (Part 2's third consequence).
2. Verify the anchor still exists and S's target range is intact.
3. Append the ops with status = 'applied' and fresh sequence
   numbers — acceptance is itself an edit in the log.
4. Mark S accepted, recording who accepted it and at what seq.
\`\`\`

**Step 3 is the important one. Acceptance appends rather than mutating the pending rows' status in place.** So the history shows the suggestion being made *and* being accepted, as two events at two points in time, and **the acceptance is undoable like any other edit.** Flipping a status column would lose the fact that the change entered the document at seq 9500 rather than 4000.

**When acceptance must be refused.**

**When the target text no longer exists.** The suggestion replaced a sentence that was deleted. **There is nothing to apply**, and applying "insert Q4 somewhere near where that sentence was" is the wrong-but-plausible failure again.

**When the target was substantially rewritten.** Mechanically the transform still produces a position; semantically the suggestion was a response to text that is gone. **Same threshold problem as offline reconciliation**, and the same answer: overlap between the suggestion's range and subsequent edits is the strongest signal.

**When the suggestion's own operations were made against a projection that no longer resolves.** A suggestion built on top of another suggestion that has since been rejected. **Its base does not exist**, so it cannot be transformed into the accepted projection.

*And the product behaviour on refusal:* **show the owner the suggestion, the original text it targeted, and the current text, and let them decide.** Not an error — a decision handed to a human with the context needed to make it, which is exactly the offline-reconciliation stance.

---

**Part 4 — four new failure modes**

**1. Comment anchor drift with no orphan detection.** A comment silently re-anchors to different text and now reads as a criticism of an innocent sentence. **This is the worst of the four**, because it is invisible: nothing errors, and the comment looks legitimate. *Requires:* identity anchors so destruction is detectable, and an explicit orphaned state.

**2. Suggestion applied at the wrong offset.** A pending operation that was not transformed forward, or an edit composed against a suggestion projection and assigned as if composed against the accepted one. **Text appears mid-word or in the wrong paragraph.** *Requires:* operations to carry their projection, and pending operations to transform continuously.

**3. Projection divergence between clients.** Two clients rendering what they believe is the same projection disagree, because the pending-operation transformation ran differently. **The suggestion-mode analogue of the transform bug**, and equally silent. *Requires:* the content-hash exchange extended to cover each projection a client renders, not only the accepted one.

**4. Suggestion pile-up creating a combinatorial projection space.** Twenty pending suggestions, some overlapping, means the "with S" projection depends on which other suggestions are also shown — and two overlapping suggestions may not be simultaneously applicable. **The projection space is exponential in pending suggestions.** *Requires:* limiting the rendered projection to accepted-plus-one-suggestion for editing, and detecting overlap between pending suggestions so the product can say "these two conflict" rather than rendering an arbitrary combination.

*And a fifth worth naming:* **a comment anchored inside a pending suggestion's text.** The comment's anchor characters only exist in one projection. **If the suggestion is rejected, the comment is orphaned by a rejection rather than by an edit** — a case that no part of the original design anticipated.

---

**Which feature is harder, and why**

**Suggestion mode, clearly — and the reason is structural rather than incidental.**

**Comments add a second kind of anchored object.** The anchoring problem is real, has three plausible mechanisms, and has a defensible best answer. **It does not change how the document relates to the log.** A comment is metadata pointing into the text.

**Suggestions change the relationship between the log and the document from one-to-one to one-to-many.** That is a structural change to the design's central claim, and everything downstream inherits it: positions are projection-relative, operations must declare their projection, pending operations must transform continuously, and clients can render different documents from the same log.

**And the failure modes reflect that difference.** A misanchored comment is one wrong object. **A wrong projection is a wrong document**, and it is silent.

*The measurable version:* comments add one table and a state machine with three states. **Suggestions add a dimension to every position in the system.**

---

**What suggestion mode reveals about "the document is a cache of the log"**

**It reveals that the claim was more specific than it sounded — and the specificity was hiding an assumption.**

The original claim: *the document is a cache of replaying the log.* **The unstated part was "replaying all of it, in order, unconditionally"** — which made the projection unique, and made "the document" a well-defined phrase.

**Suggestion mode makes the projection a parameter.** Replaying the log now requires a filter, and different filters produce different valid documents. **So the honest restatement is: the log is the truth, and a document is a *projection* of the log — of which there are many, all equally valid.**

**Three things follow, and they are worth stating because they are not obvious.**

**"The current text" stops being a well-defined phrase**, and every API that returns it must say which projection it means. A snapshot is a snapshot *of a projection* — so the snapshot table needs a projection key, or snapshots only ever cache the accepted projection and other projections are always computed.

*I would cache only the accepted projection*, because it is the one every reader needs and the others are transient review states.

**Positions become projection-relative**, which is the change that propagates furthest. Every position in every operation, comment anchor and cursor is meaningful only relative to a projection. **The original design got away with treating position as absolute because there was only one projection.**

**And it explains why event sourcing systems generally have multiple read models.** This is not a special case of collaborative editing — **it is the normal state of a log-as-truth system**, and the single-projection version was the simple case rather than the general one. The reframing that made the original design work was correct; suggestion mode just reveals it had one more degree of freedom than was being used.

**The transferable point:** when a log is the truth, ask early **how many projections of it the product needs.** One is a special case that hides an assumption in every position it stores. **Discovering the second projection late means revisiting every place a position was treated as absolute** — which is precisely the work suggestion mode turned out to require.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hdc-1',
      level: 'basic',
      question: 'Design Google Docs. What is stored?',
      guidance:
        'Look for the log as the truth and the document as a cache of replaying it, stated early. A candidate who starts by storing the document text will hit the merge problem and not escape it.',
    },
    {
      id: 'iq-hdc-2',
      level: 'basic',
      question: 'Two people type at the same position. What happens?',
      guidance:
        'Both operations are accepted, sequenced, and the second is transformed against the first. Nothing is rejected — concurrency is ordering, not merging.',
    },
    {
      id: 'iq-hdc-3',
      level: 'intermediate',
      question: 'Would you use a CRDT? Defend the answer.',
      guidance:
        'Either answer is acceptable with reasoning. Look for: a CRDT buys convergence without coordination, costs per-character metadata and tombstones, and a server already in the path makes the guarantee redundant.',
    },
    {
      id: 'iq-hdc-4',
      level: 'intermediate',
      question: 'How do cursors and presence work?',
      guidance:
        'In-memory, per-session TTL, lossy, never persisted, roughly 10× the edit volume. Strong answers name the TTL as the departure mechanism.',
    },
    {
      id: 'iq-hdc-5',
      level: 'advanced',
      question: 'Someone edits offline for three hours. What happens on reconnect?',
      guidance:
        'Short divergences merge silently; long or overlapping ones are materialised as a separate version. Excellent answers say that transformation converges on text but not on meaning, and name range overlap as the threshold signal.',
    },
    {
      id: 'iq-hdc-6',
      level: 'advanced',
      question: 'Your document server crashes mid-session. Walk me through recovery.',
      guidance:
        'A new owner loads snapshot plus op tail; clients reconnect and resend unacknowledged operations, deduplicated by client_op_id. Excellent answers name the (doc_id, seq) key as the fence against two owners.',
    },
    {
      id: 'iq-hdc-7',
      level: 'followup',
      question: 'How do you implement version history and "who wrote this"?',
      guidance:
        'Both are reads over the log — no separate subsystem. Restore appends inverse operations rather than rewinding, so the restore is itself an edit and is undoable.',
    },
    {
      id: 'iq-hdc-8',
      level: 'followup',
      question: 'How would you detect that two clients have silently diverged?',
      guidance:
        'A periodic content-hash exchange with the server, and resynchronisation on mismatch. Look for the recognition that a transform bug produces silent divergence that nothing else surfaces.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hdc-1',
      kind: 'what-changes-if',
      prompt:
        'Change one requirement: the document must be end-to-end encrypted, so the server never sees plaintext. What survives, what breaks, and what becomes impossible?',
      discussion: `The server was doing two jobs — **ordering** and **transformation** — and only one of them survives encryption. That asymmetry is the whole answer.

**What survives: ordering.**

Assigning sequence numbers requires knowing that an operation arrived, not what it says. **The server can sequence opaque blobs perfectly well**, so it remains the ordering authority, the log remains append-only with \`(doc_id, seq)\`, and the fencing property is untouched.

**What breaks: transformation.**

Transforming an operation means adjusting its position for operations it did not see — **which requires reading both operations.** An encrypted operation is a blob, so the server cannot transform it.

**And that single loss cascades.**

\`\`\`
Server cannot transform
  → server cannot maintain a materialised document
  → server cannot produce snapshots
  → opening a document means the CLIENT replays the whole log
  → and the client must transform every concurrent pair itself
\`\`\`

**So transformation moves to the clients**, and now every client must independently arrive at the same result from the same ordered log. **Which is achievable — the order is given — but it means the convergence guarantee now depends on every client implementing the transform identically**, including old app versions.

*That is a materially worse position.* In the original design one server-side implementation determined convergence. **Now a stale mobile client with a subtly different transform diverges from everyone**, and the server cannot detect it because it cannot compute the correct answer to compare against.

**Which makes a CRDT the right choice — and this is the interesting inversion.**

The main design rejected a CRDT because a server was already coordinating, so convergence-without-coordination bought nothing. **Encryption removes exactly the part of the server's role that made that true.** The server still orders, but it cannot *interpret*, and CRDTs converge without interpretation.

\`\`\`
Server-ordered OT + E2E:  clients must all transform identically
                          against a total order they receive
CRDT + E2E:               operations commute by construction;
                          the order does not even need to be total
\`\`\`

**The CRDT's per-character metadata cost is now buying something real:** convergence that does not depend on every client agreeing about transformation. **This is the reversal condition the main design named** — "no central authority" turns out to include "an authority that cannot read the data."

**What becomes impossible, or nearly so.**

**Server-side search.** Finding a phrase across a user's documents requires reading them. *Partial answers:* client-side indexing with an encrypted index, or searchable encryption with known leakage. **Both are substantially worse than plaintext search**, and this is usually the feature that kills E2E for document products.

**Server-side snapshots**, as established. *Mitigation:* clients upload encrypted snapshots. **The server stores them without being able to verify or regenerate them** — so a corrupt snapshot is no longer a cache miss the server can repair; it is a blob the client must detect and discard.

*That is a real loss of a good property:* "the log wins" was enforceable because the server could replay. **Now it is a client-side convention.**

**Server-side conflict thresholds.** The offline reconciliation threshold depended on whether edited *ranges overlapped*, which requires reading positions. **An encrypted design can only see operation counts and timestamps** — much blunter signals — so it will either merge things it should not or refuse things it need not.

**Access-control changes on shared documents.** Revoking someone's access means they should not read future edits, which requires re-keying and distributing the new key to remaining members. **The server cannot do it, because it cannot hold the key** — so it is a client-coordinated key rotation, and a member who is offline during rotation cannot read anything until they come back and fetch it.

**Server-side attribution and history rendering.** The log still records who and when — that metadata need not be encrypted — but rendering "who wrote this sentence" requires replaying content, so it is a client operation over the full log.

**What I would actually build.**

\`\`\`
Server:  orders encrypted ops, appends to the log, fans out,
         stores client-produced encrypted snapshots,
         holds unencrypted metadata (author, timestamp, seq)
Client:  CRDT for convergence, local replay, local snapshot
         production, local index for search, key management
Presence: encrypted too, or restricted to opaque session ids
         with no cursor positions — since a cursor position
         leaks document structure
\`\`\`

**And the point about presence is worth making**, because it is the kind of leak that gets missed: **cursor positions leak document length and editing patterns even when the text is encrypted.** A design that encrypts operations and sends plaintext cursor offsets has not achieved much.

**The honest summary.** Encryption keeps the ordering authority and removes the interpreting authority, and **the interpreting authority was what made server-ordered transformation the right choice.** So the mechanism inverts to a CRDT, whose cost now buys convergence that does not depend on client uniformity. **What is genuinely lost is search, verifiable snapshots, and meaningful conflict thresholds** — and the first of those is usually the one that decides whether the product ships this way at all.

**The transferable point:** when you remove a central component's ability to *read* rather than its existence, check which of its jobs required understanding the data. **Ordering does not; transformation, indexing, validation and repair all do** — and every one of those has to move or disappear.`,
    },
    {
      id: 'al-hdc-2',
      kind: 'debug',
      prompt:
        'A small number of users report that a document "looks different on my laptop than on my phone" — a paragraph appears twice on one device, or a sentence is missing on the other. Refreshing fixes it. Server logs show no errors, no failed appends, and the op log for the affected documents is complete and well-ordered. Diagnose it.',
      discussion: `"Refreshing fixes it" is the most informative detail in the report, and it eliminates half the possibilities immediately.

**A refresh reloads the snapshot and replays the op tail.** So **the log is right and the server's view is right** — which the log inspection already confirmed. **The divergence is in client-side state that a reload discards.** That is a short list: the client's transformation of remote operations against its own pending ones, its local application of acknowledged operations, or its handling of the connection lifecycle.

**Hypothesis 1 — the transform function diverges for a specific concurrent pattern.** Two insertions at the same position must be ordered consistently on every client, and if the tie-break is not deterministic — using arrival order rather than author id, say — **two clients apply them in opposite orders and converge on different text.**

*Why it fits perfectly:* this is the failure mode the design named as the worst, and it presents exactly like this. **Silent, per-client, affects a small number of users** (those who hit the specific concurrent pattern), **and a refresh repairs it** because reloading takes the server's authoritative order.

*Check:* the client-side transform's tie-break rule, and whether the affected documents had concurrent same-position edits around the time of the report. **Reproduce with two clients typing at the same offset simultaneously** — this is deterministic enough to reproduce once you know to try it.

**Hypothesis 2 — the client applies its own operation twice.** The client applies optimistically, then on acknowledgement it must reconcile — **not re-apply.** If a code path applies the acknowledged operation again, the client's text contains the edit twice while the server has it once.

*Why it fits the "paragraph appears twice" symptom specifically:* **a duplicated large paste is exactly what a double-applied operation looks like.** And it explains why refresh fixes it and the log is clean.

*What would trigger it:* an acknowledgement arriving after a reconnect, so the client no longer recognises the operation as its own pending one and treats it as remote. **Which makes this a reconnect-path bug rather than a steady-state one** — and reconnect paths are where the affected-user count stays small.

*Check:* whether the affected sessions had a reconnect shortly before the report, and whether acknowledgements arriving for operations no longer in the pending set are handled or ignored.

**Hypothesis 3 — operations are missed across a reconnect.** On reconnect the client must request everything from its last known sequence. **If it resumes from the wrong point** — its last *sent* sequence rather than its last *received* one, say — it silently skips remote operations. **The missing-sentence symptom.**

*Why it fits:* one device reconnects (a phone changing networks, or waking from sleep), misses operations, and shows less text than the laptop that stayed connected. **And the mobile-versus-laptop framing in the report is a strong hint**, because phones reconnect constantly and laptops do not.

*Check:* the resume sequence number clients send on reconnect against what they had received, and whether the server's response range is inclusive or exclusive at the boundary. **An off-by-one at a resume boundary loses exactly one operation**, which is a missing sentence.

**Hypothesis 4 — pending operations are dropped rather than resent on reconnect.** The inverse of hypothesis 2. The client had unacknowledged operations, reconnected, and did not resend them. **Its local text has them, the server does not.**

*Why the symptom is asymmetric:* **the user's own device shows text nobody else has**, until a refresh silently discards their work. **This is the most damaging hypothesis** — it is not a display bug, it is lost edits, and the refresh that "fixes" it is what destroys the evidence.

*Check:* whether the client resends its pending queue after reconnect, and whether \`client_op_id\` deduplication is working — because the correct behaviour is to resend everything and let the unique constraint reject duplicates.

**Hypothesis 5 — the client applied a stale snapshot with a mismatched op tail.** On open, the client gets a snapshot at sequence N and operations from N+1. **If the snapshot's sequence is recorded wrong, or the tail starts at the wrong point, the client's starting text is inconsistent** in a way that persists for the session.

*Why refresh fixes it:* it fetches a fresh snapshot, which is probably correct the second time. *Check:* whether the affected documents were snapshotted around the report time, and whether \`doc_snapshots.seq\` matches the content it holds.

**What I would check first: whether the affected sessions reconnected, and whether pending operations were resent.** One query over session events, and it discriminates hypotheses 2, 3 and 4 — which together are three of the five and share a cause class. **The reconnect path is where client-side state and server-side state have to be reconciled explicitly**, so it is where they diverge.

**Then: the transform tie-break rule.** A code read rather than an investigation, and it either is deterministic or it is not. **Cheap to check and catastrophic if wrong**, which is a good ratio.

**Why "a refresh fixes it" is the key fact.**

It proves the log is authoritative and intact — **so no amount of server-side investigation will find anything**, which matches the clean logs. **The bug is in the client's incremental application of a correct stream**, and there are only two ways that goes wrong: applying something twice, or missing something.

**And that reframes the whole investigation from "what did the server do wrong" to "where does the client's incremental state diverge from a full replay."** Which suggests the diagnostic that should have existed: **compare them.**

**The instrumentation this demands.**

**A periodic content-hash exchange between client and server.** The design's failure table named this and it is clearly not implemented, because these reports came from users rather than from an alert. **The client hashes its rendered text at a known sequence and sends the hash; the server compares against its own.** A mismatch is divergence, detected in seconds rather than by a user noticing a duplicated paragraph.

*And it must be per-sequence, not periodic-by-time*, so both sides hash the same logical state.

**Reconnect telemetry as a first-class metric:** resume sequence, operations received in the resume batch, pending operations resent, and acknowledgements received for operations not in the pending set. **The last of those is hypothesis 2 detected directly**, and it is a counter that should always be zero.

**A pending-queue-dropped counter.** Hypothesis 4 loses user work, and it currently has no signal at all. **Any transition that empties the pending queue without acknowledgements should be counted and alerted**, because it is never correct.

**Snapshot verification on write.** The snapshot worker replays to sequence N and could hash the result; storing the hash lets any reader detect a mismatched snapshot rather than rendering from it.

**Transformation as a tested invariant rather than a code path.** Property-based tests over random concurrent operation pairs, asserting that applying in either order converges. **The convergence guarantee lives in this function**, and a guarantee with no test is a hope.

**Transferable:** when a refresh fixes a data inconsistency, the durable state is fine and the bug is in incremental application — **so instrument the comparison between incremental state and a full replay**, because that is the only thing that detects it before a user does. **A system whose correctness claim is "these two things converge" must continuously verify that they did.**`,
    },
  ],

  revision: {
    bullets: [
      'The document is not the state — the ordered log of edits is, and the document is a cache of replaying it.',
      'That reframing dissolves four problems: concurrency, persistence, history and attribution.',
      'Send operations, not documents: ~50 bytes per edit regardless of document size.',
      'Full-document writes cost 150 KB per keystroke on 50 pages, with write amplification in the thousands.',
      'Optimistic version-check-and-retry fails because conflicts are the normal case, not the exception.',
      'Nothing is rejected: the server assigns a sequence and transforms each op against those its author had not seen.',
      'Every client op carries baseSeq, which tells the server exactly what to transform against.',
      'Clients apply their own edits immediately and reconcile on acknowledgement — local echo never waits.',
      'The convergence guarantee lives entirely in the transform function, including the same-position tie-break.',
      'A CRDT buys convergence without coordination and costs per-character metadata plus uncollectable tombstones.',
      'Choose server ordering when a server already exists — paying to avoid unavoidable coordination is the wrong trade.',
      'One owner per document shards perfectly across a billion documents; single-threaded is fine when the unit is small.',
      'The unique (doc_id, seq) key is the fencing mechanism — no lease, no consensus.',
      'Restore appends inverse operations rather than rewinding, so a restore is itself an undoable edit.',
      'Snapshots are a read cache; a heavily-edited document can carry a 160× log-to-content ratio.',
      'Never acknowledge an edit that is not durable — the ack is the promise.',
      'Presence is ~10× the edit volume and disposable: in memory, TTL, lossy, with the TTL as the departure mechanism.',
      'Long offline divergence converges on text but not on meaning — threshold on range overlap and hand it to a human.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A collaborative editor whose truth is an append-only per-document operation log, with a single server ordering and transforming operations, snapshots as a read cache, and presence as separate disposable in-memory state.',
    whyItExists:
      'Because concurrent editing has no coherent solution as a document-merging problem. Reframing it as ordering a log makes convergence, durability, history and attribution consequences of one representation instead of four subsystems.',
    whenToUse: [
      'An operation log as the truth whenever concurrent editors must all converge.',
      'Server-assigned ordering whenever a server already exists for authentication and persistence.',
      'A CRDT whenever there is genuinely no authority, or the authority cannot read the data.',
      'Snapshots as an async read cache whenever replay cost grows with history.',
      'An in-memory TTL store for any high-volume state whose only value is being current.',
    ],
    whenNotToUse: [
      'Storing the document and sending full text per change.',
      'Optimistic version-check-and-retry where conflicts are the normal case.',
      'Locking a region while someone types.',
      'A global sequence when ordering is only needed per document.',
      'Presence on the document row.',
      'Silent merging of long offline divergences.',
    ],
    alternatives: [
      'A CRDT, when there is no authority or it cannot interpret the data.',
      'Identity-based anchors for comments, a bounded version of the CRDT cost paid only where it buys something.',
      'A delivery tier separate from the ordering tier, to scale fan-out in tail documents.',
      'Client-side replay and snapshots, when the server cannot read the content.',
      'Materialising a divergent branch for human resolution instead of merging.',
    ],
    tradeoffs: [
      'An operation log buys tiny edits plus free history and costs ~2 TB/day and a snapshot pipeline.',
      'Server ordering buys no per-character metadata and costs one owner per document.',
      'A CRDT buys coordination-free convergence and costs tombstones that cannot be collected.',
      'Async snapshots buy an edit path free of document-sized writes and cost slower opens when lagging.',
      'In-memory presence buys 10× the edit volume for free and costs a briefly stale cursor.',
      'A merge threshold buys coherent text and costs the user a resolution step.',
    ],
    failureModes: [
      'Full-document writes making an edit cost the document\'s size.',
      'Version-check-and-retry livelocking the slower typist and overwriting the faster one.',
      'A non-deterministic same-position tie-break causing silent client divergence.',
      'Acknowledging an edit before its append is durable, turning a retry into lost work.',
      'Two servers owning one document — caught by the (doc_id, seq) key, not by a lease.',
      'A client double-applying its own operation after a reconnect.',
      'A client resuming from the wrong sequence and silently missing operations.',
      'Pending operations dropped rather than resent on reconnect, losing user work.',
      'Cursors on the document row contending with edits.',
      'Silently merging a three-hour offline divergence into incoherent prose.',
      'Comment anchors silently re-locating to different text.',
    ],
    followUpQuestions: [
      'What is the unit of change — an operation or a document?',
      'Who assigns the order, and what happens if two servers think they own the document?',
      'What does each client operation carry besides the edit?',
      'How are two insertions at the same position ordered, and is that deterministic?',
      'Is the acknowledgement sent before or after the durable append?',
      'What is the log-to-content ratio, and when are snapshots written?',
      'If a snapshot disagrees with the log, which wins?',
      'How does restore work — rewind or inverse operations?',
      'Where does presence live, and what removes a departed collaborator?',
      'What is the offline threshold, and what signal defines it?',
      'How would you detect that two clients have silently diverged?',
    ],
  },
});
