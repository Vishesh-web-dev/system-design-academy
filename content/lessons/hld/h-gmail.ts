import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-gmail',
  title: 'Design Gmail',
  summary:
    'Every query in the system is scoped to one user, and almost every decision follows from taking that seriously: per-user indexes, per-user threads, per-user quota — and one content-addressed copy of a body sent to ten million people.',
  phase: 'hld',
  module: 'advanced-designs',
  position: 52,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 90,
  tags: ['per-user-partitioning', 'search-indexing', 'threading', 'spam', 'quota'],
  prerequisites: ['h-google-docs'],
  resources: [
    {
      key: 'rfc-5321-smtp',
      tier: 'must',
      note: 'Read the reply-code sections in particular. The difference between a 4xx and a 5xx is the difference between "the sender will try again for days" and "bounce it now", and the quota design turns on that choice.',
    },
    {
      key: 'bigtable-paper',
      tier: 'must',
      note: 'The storage lineage for a mailbox: a wide row per user, sorted keys, and column families. Read it for why a row-per-user layout makes the common access pattern a single contiguous read.',
    },
    {
      key: 'elasticsearch-basics',
      tier: 'must',
      note: 'Read the sharding and routing sections. The whole argument here is that routing every document for a user to one shard turns a scatter-gather search into a single-shard query.',
    },
    {
      key: 'simhash-dedup',
      tier: 'good',
      note: 'Near-duplicate detection by fingerprint. Read it as the mechanism for spotting the same spam campaign arriving with small per-recipient variations — exact hashing misses all of it.',
    },
    {
      key: 'dynamodb-partition-key-design',
      tier: 'good',
      note: 'Read it for hot-partition failure. A per-user partition is the right shape here, and a mailing list delivering to millions is the pattern that finds its limits.',
    },
    {
      key: 'elastic-bm25',
      tier: 'advanced',
      note: 'Relevance scoring. Read it to see why a per-user index changes the statistics themselves — term frequencies computed over one mailbox differ from those over a billion, and that affects ranking.',
    },
  ],

  intuition: {
    body: `The scale numbers make this look like a storage problem. **It is a partitioning problem, and one observation decides the partitioning: every single query in this system is scoped to exactly one user.**

Search my mail. Show my inbox. Count my quota. Show my thread. **There is no query in the product that spans users**, which is unusual — a social feed reads across users, a marketplace searches a shared catalogue, a ride-hailing matcher scans a shared space. **Here, nothing does.**

**So partition everything by user, and four hard problems become easy ones.**

**Search stops being a distributed scatter-gather.** A global inverted index would route every query to every shard, where **almost every posting examined is another user's mail** and gets filtered away. Route all of one user's documents to one shard and **a search is a single-shard query over a mailbox-sized index** — thousands of times smaller.

**Deletion becomes tractable.** Deleting a user's data is a legal obligation with a deadline. In a global index it is a compaction touching every shard; **with per-user indexes it is dropping one thing.**

**And relevance improves**, because term statistics computed over one mailbox reflect what is distinctive in *that* mailbox rather than in a billion.

Then the storage observation that inverts the obvious approach: **a message sent to ten million recipients should be stored once.**

The naive model gives every recipient a copy. **A newsletter to ten million people then costs ten million times its size**, and newsletters are a large share of all mail. **Store the body once, content-addressed, and give each recipient a small reference** carrying only their own state — read, labels, folder.

**Which immediately complicates quota**, because the user's quota must count the bytes they are logically responsible for, **not the bytes physically stored for them** — which is a fraction of one copy.

And two things that look like features and are really about **where responsibility begins.**

**Spam has two decision points separated by a promise.** Before you answer the sending server, you can refuse the message and it remains the sender's problem. **The moment you say "accepted", you have taken on a durability obligation** — from then on the message may be filed anywhere, including a spam folder, but it may not be silently dropped.

**And threading is per-user and derived**, not a stored global object. My thread contains only the messages I received. **Two people in the same conversation legitimately see different threads**, and a design that stores one canonical thread has to fight that.`,
    analogyLimit:
      '"It is a database of messages with search on top" hides the decision that matters. The interesting property is not the volume but that no query crosses users — so reaching for a global table and a global index throws away the one structural advantage the problem offers. It also hides the SMTP responsibility boundary: accepting a message is a promise, and a filter that deletes after acceptance has broken it.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team designs a mail system: one global messages table with a copy per recipient, one global search index, threads grouped by matching subject lines, and a spam classifier that deletes spam after acceptance. Identify four failures and rank them.',
      answer: `**Failure 1 — deleting after acceptance breaks the promise made at the SMTP handshake, and this is the worst failure because it is unrecoverable.**

\`\`\`
Sending server: DATA ... <message>
Your server:    250 OK, message accepted
                → the sender now considers it DELIVERED
                → it will never retry
Later:          classifier says spam, message deleted
                → the mail is gone, and nobody knows
\`\`\`

**A false positive is now permanent, silent data loss.** The recipient never saw it, the sender believes it arrived, and there is no record to recover from. **A missed job offer or a legal notice disappears with no trace.**

**And the alternative was available and cheap.** Before answering, you may refuse — \`550\` for a permanent rejection, which makes the sender bounce it back so **the sender learns their message did not arrive.** Refusal keeps the problem with the sender; acceptance transfers it to you.

*The fix is a rule: after acceptance, a message may be filed anywhere but never destroyed.* **Spam goes to a folder with a retention period**, so a false positive is a recoverable inconvenience rather than a loss.

**Failure 2 — a global search index makes every query a scatter-gather over mostly-irrelevant data.**

\`\`\`
1.5 billion users, ~70,000 messages each
A global index sharded by message id:
  query "invoice from March" → fan out to ALL shards
  each shard scans postings for "invoice" across ALL users
  → matches millions of documents
  → filter to one user's → a handful survive
\`\`\`

**Almost all the work examines other users' mail and discards it.** And the cost per query grows with the *total* corpus rather than with the searching user's mailbox — **so search gets slower as the product succeeds**, which is the wrong scaling relationship.

*The fix is routing:* **all of a user's documents go to one shard, chosen by user id.** A query then touches one shard holding a mailbox-sized index. **No fan-out, no cross-user filtering, and the cost scales with the user's own mail** — which is bounded and small.

*And a second benefit that matters legally:* deleting a user's data becomes dropping their index rather than compacting every shard.

**Failure 3 — a copy per recipient multiplies large distributions by their audience.**

\`\`\`
A newsletter, 80 KB, sent to 10 million subscribers:
  copy-per-recipient → 800 GB for ONE send
  content-addressed  → 80 KB + 10 M × ~200 B refs = ~2 GB
→ ~400× reduction, and newsletters are a large share of all mail
\`\`\`

**The body is immutable and identical; only the per-recipient state differs.** So store the body once, addressed by its content hash, and give each recipient a reference holding their read flag, labels and folder.

*And the consequence to handle:* **quota must count logical bytes, not physical.** A user with a thousand newsletters is responsible for their logical size even though the storage is shared — otherwise quota becomes gameable and meaningless.

**Failure 4 — subject-based threading merges unrelated conversations.**

\`\`\`
Subject: "Re: Question"        → 14,000 unrelated messages
Subject: "Meeting"             → thousands, across years
Subject: "Invoice"             → every vendor, merged
\`\`\`

**And it splits threads that belong together**, because a reply that edits the subject line leaves the thread.

*The fix:* **thread on the \`Message-ID\` / \`In-Reply-To\` / \`References\` headers**, which express actual reply relationships. Subject similarity is a fallback for senders that omit them, and **it must be scoped** — same participants, within a time window — or it reproduces the failure it was covering for.

*And the deeper point:* **a thread is per-user and derived.** My thread contains the messages I received; a colleague copied on half the exchange sees a different thread. **Both are correct**, so a stored canonical thread is fighting the domain.

**Ranking. Failure 1 destroys mail irrecoverably and silently** — the one thing a mail system must never do. **Failure 2 is a scaling failure that gets worse with success** and would require re-indexing everything to fix later. Failure 3 is a cost failure with a large multiplier. Failure 4 is a correctness-of-presentation failure that makes the product confusing.

**The unifying observation: three of the four come from choosing global structures for a workload where every query is per-user.** The global index, the global thread and the per-recipient copy all ignore the partitioning the problem hands you. **And the fourth comes from misplacing the responsibility boundary** — not noticing that \`250 OK\` is a promise.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
Receive mail over SMTP from anywhere on the internet
Send mail, with retries and bounce handling
A user reads an inbox ordered by recency
A user searches their own mail by text, sender, date, attachment
Messages are grouped into conversation threads
Spam is filtered without losing legitimate mail
A user labels, archives, and deletes
Storage is capped per user and enforced
\`\`\`

**The clarifying questions that change the design:**

**Does any query span users?** *No — every read is scoped to one mailbox.* **The question the design turns on**, because it licenses per-user partitioning everywhere.

**What happens to spam after acceptance?** *It is filed, never deleted.* Fixes the responsibility boundary as a hard rule.

**Is a thread the same object for every participant?** *No.* Makes threading a derived per-user view.

**Is quota a hard limit?** *Yes, with a grace period.* Turns over-quota into a reply-code decision.

**How skewed is search usage?** *Most mailboxes are never searched.* **Licenses lazy index materialisation** — the opposite of the curated-catalogue lesson, where laziness was wrong because everything was used.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Accept-to-visible | p99 under 5 s | Classification and indexing off the accept path |
| Inbox load | p99 under 200 ms | One contiguous per-user read |
| Search | p99 under 500 ms | Single-shard, per-user index |
| Durability after acceptance | Absolute | Replicated write before \`250 OK\` |
| Spam false negatives | Tolerable | A user can mark and move on |
| Spam false positives | **Recoverable, never silent** | Filed with retention, never deleted |
| Deletion of a user's data | Complete, on a deadline | Per-user index and storage boundaries |

**Out of scope:** spam-model training, calendar and contacts, encryption-at-rest specifics, IMAP details.

## Step 2 — Estimation

\`\`\`
Users:            2 billion, 1.5 billion active
Accepted mail:    ~40 messages/user/day (including spam-foldered)
→ 60 billion/day = ~700,000/s average, ~1.5 million/s peak
\`\`\`

**And the volume that never becomes a message:**

\`\`\`
Connection attempts rejected before acceptance: ~3× accepted
→ ~2 million/s of refused delivery attempts
\`\`\`

**Most inbound volume is rejected at the edge and never stored** — the first-order fact about spam: **the cheap gate does the bulk of the work**, and the content classifier only sees what got past it.

**Storage, with and without deduplication:**

\`\`\`
Average message: ~20 KB body + attachments on ~10% at ~150 KB
                 → ~35 KB per message
Naive copy-per-recipient: 60e9 × 35 KB = ~2 PB/day

With content-addressed bodies:
  ~40% of volume is bulk mail averaging ~500,000 recipients
  → that 40% collapses to ~1/500,000 of its naive size
  Effective: ~0.6 PB/day
\`\`\`

**A threefold overall reduction, and far more on the bulk portion** — concentrated exactly where the volume is.

**Search index, which is the surprise:**

\`\`\`
Per user: ~70,000 messages × ~3 KB of indexable text
          = ~200 MB of text → ~60 MB of index
1.5 billion users × 60 MB = ~90 PB of index
\`\`\`

**Ninety petabytes is larger than a naive reading expects**, and it forces two decisions: **per-user partitioning** (each unit 60 MB rather than a shard of a monolith) and **lazy materialisation** (an index only where someone searches).

\`\`\`
If 10% of mailboxes are ever searched:
  → ~9 PB of live index instead of 90 PB
  → and a first search on a cold mailbox pays a build
\`\`\`

**A tenfold reduction from the usage distribution** — the lazy-transcoding argument, right here because search demand really is skewed.

\`\`\`
Read volume:
  Inbox loads: 1.5e9 × 10/day = ~170,000/s
  Searches:    1.5e9 × 0.3/day = ~5,000/s
\`\`\`

**Searches are 3% of inbox loads**, which sets the priority: the inbox path must be excellent, search must be good.

## Step 3 — API design

\`\`\`
SMTP ingress (not HTTP — the internet's protocol)
  MAIL FROM / RCPT TO / DATA
    → 550 permanent reject   (reputation, non-existent user)
    → 452 temporary reject   (over quota, overload — sender retries)
    → 250 accepted           (A PROMISE: now durable)

Client
  GET  /messages?label=inbox&cursor=       → thread summaries
  GET  /threads/{id}                        → messages in MY thread
  GET  /search?q=&cursor=                   → results, my index only
  POST /messages/{id}/labels  { add, remove }
  POST /messages/{id}/spam                  → move + feed the classifier
  POST /send  { to, subject, body }         → queued for delivery
  GET  /quota                               → used, limit, logical bytes
\`\`\`

**Five decisions worth defending.**

**The reply code at ingress is the most consequential API decision here.** \`550\` tells the sender to bounce, \`452\` to retry later, \`250\` transfers responsibility to you. **The wrong one loses mail or creates a retry loop.**

**Over quota returns \`452\`, not \`550\`.** A temporary rejection means the sender retries for days, **so the user has time to free space and the mail still arrives.** Only after the window expires does it bounce.

**\`GET /threads/{id}\` returns *my* thread**, and two participants legitimately get different message sets. **The API shape has to admit that.**

**Search takes no user parameter.** It is implicit in the authenticated identity, and **there is deliberately no way to express a cross-user search** — which is what lets the index be partitioned by user without qualification.

**Marking spam both moves the message and feeds the classifier**, because the user action is the highest-quality training signal available.

## Step 4 — Data model

\`\`\`sql
-- BODIES: stored once, addressed by content hash
message_bodies(
  content_hash PRIMARY KEY,   -- sha256 of the raw message
  raw_size, headers, body_ref, ref_count
)

-- PER-USER MAILBOX: the wide row. Partition key is the user.
mailbox(
  user_id, message_id,        -- (user_id, received_at DESC) clustering
  content_hash,               -- → message_bodies
  thread_id,                  -- derived, per user
  received_at, is_read, labels[], folder,
  logical_size                -- for quota: the body's size, per user
)
PARTITION BY HASH (user_id)

-- THREADS: derived per user, rebuildable
user_threads(user_id, thread_id, subject, participants[], last_at)

-- SEARCH: one index per user, materialised lazily
search_index:{user_id}   → inverted index over that mailbox
search_index_state(user_id, built_through, last_used_at)

-- QUOTA: a counter, updated asynchronously
user_quota(user_id, logical_bytes_used, limit_bytes, updated_at)
\`\`\`

**Four decisions worth defending.**

**\`user_id\` is the partition key for everything a user reads** — mailbox, threads, index, quota. **So every product read is a single-partition operation**, the direct payoff of no query spanning users.

**Bodies are content-addressed with a reference count**, so ten million recipients share one row. **The count is what makes deletion safe.**

**\`logical_size\` is on the mailbox reference, not the body**, recording what this user is responsible for regardless of who shares the bytes. **Quota must be logical or it is gameable.**

**The index has a \`built_through\` watermark and a \`last_used_at\`**, which together support lazy materialisation: **never searched means no index; searched means built and kept warm; idle means droppable.**

## Step 5 — Architecture

\`\`\`
Internet ──SMTP──▶ ┌──────────────────────────────────┐
  ~2 M/s attempts  │ Edge: connection-level gate       │
                   │  · IP/domain reputation           │
                   │  · rate, SPF/DKIM/DMARC           │
                   │  → 550 / 452 REJECT (no storage)  │
                   └──────────────┬───────────────────┘
                      ~700 K/s    │ 250 OK = PROMISE
                   ┌──────────────▼───────────────────┐
                   │ Accept path (synchronous)         │
                   │  1. store body (content hash)     │
                   │  2. write per-recipient refs      │
                   │  3. replicate, THEN answer 250    │
                   └──────────────┬───────────────────┘
                                  │ events (async)
        ┌─────────────────┬───────┴────────┬──────────────────┐
        ▼                 ▼                ▼                  ▼
  Spam classifier   Thread assigner   Index updater      Quota updater
  (files, never     (per-user,        (only for users    (async counter)
   deletes)          derived)          with an index)
\`\`\`

**Why the edge gate comes first.** It rejects two-thirds of inbound volume on cheap signals, **before storage is touched and before any promise is made.** Content classification here would mean parsing 2 million messages/s to reject most of them.

**Why the accept path is synchronous and everything after it is not.** \`250 OK\` must not be sent until the message is durable. Classification, threading and indexing are not on that path — until they run the message sits in the inbox unclassified, which is the correct degradation.

**Why the classifier is downstream of acceptance.** The promise is already made, **so its only available action is to move the message** — the constraint that prevents silent loss.

**Why the index updater is conditional.** It does nothing for the 90% of mailboxes with no index — **the laziest pipeline stage, and what makes 9 PB instead of 90 PB.**

## Step 6 — The deep dive: the responsibility boundary, per-user indexes, and threads

**The SMTP boundary, and why it is the most important line in the system.**

\`\`\`
Before 250 OK:  the message is the SENDER's responsibility.
                Rejecting it means they know — a bounce goes
                back to a human.
After 250 OK:   the message is YOUR responsibility.
                Losing it means nobody knows.
\`\`\`

**Every spam decision follows from which side of that line it acts on.**

**Before the line, cheap signals and a free action.** Sending IP reputation, domain authorisation, connection rate, recipient existence — **all available without reading the message**, and they reject two-thirds of volume for almost nothing.

**After the line, rich signals and only one safe action.** Content, structure, campaign fingerprints, the recipient's history. **But every action must preserve the message.**

**So the rule is: reject on cheap signals before accepting; classify on expensive signals after, and only file.**

*And the asymmetry that sets the thresholds:* **a false negative is one click; a false positive is potentially a lost job offer.** So the pre-acceptance gate is conservative — strong evidence only — and the post-acceptance classifier can be aggressive, because **its worst outcome is a wrong folder, recoverable for the retention period.**

*Near-duplicate detection is what makes that classifier strong.* A campaign arrives with small per-recipient variations, so exact hashing sees millions of distinct messages. **A tolerant fingerprint sees one campaign**, and campaign-level evidence is far stronger.

**Per-user search indexes, and what the partitioning actually buys.**

\`\`\`
Global index, sharded by message id:
  query → all shards → scan postings across all users
        → millions of candidate matches → filter to one user
  Cost grows with TOTAL corpus size.

Per-user index, routed by user id:
  query → one shard → one 60 MB index → done
  Cost grows with THIS USER's mail.
\`\`\`

**Four benefits, and the third is the one candidates miss.**

**Search cost is bounded by the user's own mailbox**, so it does not degrade as the product grows.

**No cross-user filtering**, so no work is done on data that will be discarded.

**Deletion is a drop, not a compaction** — **a bounded operation with a verifiable end**, rather than a global compaction you must prove completed.

**And relevance is computed over the right corpus.** **A term common globally but rare in my mail should rank highly for me**, and a global index's statistics say the opposite.

*What it costs:* **90 PB if every mailbox is indexed**, which is why the build is lazy — and **a first search on a cold mailbox pays that build.** *Mitigation:* build eagerly for anyone who has ever searched, and pre-warm on intent signals.

*And the contrast with the curated-catalogue lesson:* laziness was wrong there because every title was watched. **Here most mailboxes are never searched, so the same mechanism is right.** The mechanism is neither good nor bad — **the usage distribution decides.**

**Threading, and why it is per-user.**

\`\`\`
Primary: header chains.
  Each message has a Message-ID; a reply carries In-Reply-To
  and a References chain. Follow the chain → the thread.

Fallback, for senders that omit them:
  Same normalised subject
  AND overlapping participants
  AND within a bounded time window
\`\`\`

**All three conditions are required; dropping any one recreates the failure.** Subject alone merges every "Re: Question" ever sent; subject plus participants still merges a recurring weekly mail across years.

**And the thread is per-user because the message set is per-user.** Copied on three of ten messages, **my thread has three** — correct, not a gap.

*The consequence:* **\`thread_id\` is assigned within a mailbox**, so one conversation has different ids for different users. A global thread id must either show users messages they were not sent or maintain per-user visibility filters — **more machinery for a worse result.**

**Quota, briefly, because the mechanism is familiar.**

The counter lags, so **enforcement is approximate and should be**: refusing a paying user's mail over an exact byte count is worse than letting them exceed by a little. **The streaming lesson's stance on concurrent streams** — the limit bounds growth rather than being precise.

**And over-quota is a \`452\`, not a \`550\`.** The sender retries for days and the mail still arrives. **A permanent rejection destroys mail to enforce a storage policy.**

## Step 7 — What breaks at 10×

**15 billion active users, 7 million accepted messages/s, 20 million rejected attempts/s.**

**The edge gate becomes the dominant cost** at 20 million attempts/s. *Fix:* **cache reputation verdicts aggressively** — the same sending IPs recur constantly, so the decision is highly cacheable.

**Per-user index builds become a large batch load.** *Fix:* tier the index — recent mail always indexed, older mail indexed on demand, **so a first search returns recent results immediately and completes as the older tail builds.** Partial results fast beats complete results slowly.

**Content-addressed bodies become a hot-partition problem**: one row read by millions of mailboxes. *Fix:* replicate hot bodies — **the celebrity problem, in storage rather than fan-out.**

**Quota counter updates reach millions per second.** *Fix:* batch per user and accept more lag, since the enforcement is already approximate.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Storage unavailable at accept time | Cannot make the message durable | **Answer \`452\`, not \`250\`.** The sender retries; nothing is lost |
| Spam classifier down | Nothing classified | **Mail lands in the inbox unclassified.** Fail toward delivery, never toward dropping |
| Classifier false positive | Legitimate mail foldered | Recoverable: it is in the spam folder for the retention period. **The design's central safeguard** |
| Index updater lagging | Recent mail not searchable | Search returns older results; the inbox is unaffected |
| A user's index is lost | Search unavailable for them | Rebuild from the mailbox. **A cache, not data** |
| Thread assigner down | Messages ungrouped | Shown individually; regrouped when it recovers. **Threads are derived** |
| Quota counter stale | Over-quota user still accepted | Accepted. **Approximate enforcement is the intent** |
| Body storage unavailable | Bodies unreadable | Inbox list still renders from mailbox rows — headers are there — bodies error individually |
| Over-quota mailbox | Cannot accept | \`452\` for the retry window, then a bounce. **Never a silent drop** |

**Three rows carry the content.**

**The first row is the whole responsibility argument in one line.** When you cannot make a message durable, *do not promise* — answer \`452\` and let the sender hold it. **Answering \`250\` and then failing to write destroys mail**, and the sender never retries because they were told it arrived.

**Failing toward delivery when the classifier is down** is right for the same reason the streaming lesson failed open on entitlement: **the permissive failure is an annoyance, the strict one is a loss.**

**Almost everything downstream of acceptance is rebuildable** — index, threads, quota counter — since all are derived from the mailbox. **Only the mailbox and the bodies are truth**, a small surface to protect.

## Step 9 — Defending it

**"Two observations shape everything.**

**First: no query in this product spans users**, so I partition everything by user — mailbox, threads, search index, quota. **A global search index would fan out to every shard and discard almost every posting it examined**, with cost growing in the total corpus rather than in the searching user's mail. Routing a user's documents to one shard makes search a single-shard query over 60 MB, makes deleting a user's data a drop rather than a global compaction, and computes relevance over the corpus that actually reflects what is distinctive to that user.

**And because most mailboxes are never searched, indexes are built lazily** — 9 petabytes instead of 90. That is the same mechanism the curated-catalogue lesson rejected, and it is right here for the opposite reason: **there, everything was consumed; here, the usage distribution is genuinely skewed.**

**Second: \`250 OK\` is a promise**, and it divides the system. Before it, I have cheap signals — reputation, authentication, rate — and a free action: reject, so the sender bounces and a human learns. That rejects two-thirds of inbound volume without touching storage. After it, I have rich signals and only one safe action. **So spam may be filed anywhere but never deleted**, which turns a false positive from silent permanent loss into a recoverable inconvenience. And when I cannot make a message durable, I answer \`452\` rather than \`250\` — **never promise what you did not store.**

**Bodies are content-addressed, so a newsletter to ten million people is stored once** rather than ten million times, with a small per-recipient reference carrying read state and labels. Quota counts logical bytes, not physical, or it is gameable. **And over-quota is a \`452\`, not a \`550\`** — the sender retries for days, the user gets time, and the mail still arrives.

**Threads are derived per user from header chains**, with a subject fallback scoped by participants *and* a time window. Two participants seeing different threads is correct, not a bug.

**What I gave up:** a first search on a cold mailbox pays a build; quota is approximate; the spam folder holds mail that should have been rejected; and hot bodies are a partition-skew problem.

**What would make me revisit it:** if a cross-user query ever entered the product — organisation-wide legal discovery, say — the per-user index stops being sufficient, and I would add a separate purpose-built index for that access pattern rather than globalising the one that serves the product well."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'responsibility',
      title: 'The line that divides the system, and the partitioning underneath it',
      caption:
        'Step through it. Notice where the promise is made — and that everything to the right of the accept path is derived state that can be rebuilt.',
      nodes: [
        { id: 'net', label: 'Internet — ~2 M attempts/s', kind: 'client', x: 0, y: 140, detail: 'Roughly three times the accepted volume. Most inbound mail never becomes a message, which is the first-order fact about spam: the cheap gate does the bulk of the work.' },
        { id: 'gate', label: 'Edge gate — cheap signals', kind: 'service', x: 210, y: 140, detail: 'IP and domain reputation, SPF/DKIM/DMARC, connection rate, recipient existence. All available WITHOUT reading the message, and the action is free: reject, and the sender bounces it back to a human who learns.' },
        { id: 'line', label: '250 OK — the promise', kind: 'note', x: 210, y: 20, detail: 'Before this line the message is the sender\'s responsibility and rejecting it means they know. After it, losing the message means nobody knows. Every spam decision depends on which side of the line it acts on.' },
        { id: 'accept', label: 'Accept path (synchronous)', kind: 'service', x: 450, y: 140, detail: 'Store the body, write per-recipient references, replicate — THEN answer 250. If storage is unavailable, answer 452 instead: never promise what you did not store, because a sender told 250 will never retry.' },
        { id: 'bodies', label: 'message_bodies (content-addressed)', kind: 'store', x: 690, y: 40, detail: 'One row per distinct message, keyed by content hash, with a reference count. A newsletter to 10 million recipients is 80 KB plus 10 million small references instead of 800 GB — and the ref count is what makes deletion safe.' },
        { id: 'mailbox', label: 'mailbox — PARTITION BY user_id', kind: 'store', x: 690, y: 160, detail: 'The wide row. Every read in the product is a single-partition operation, which is the direct payoff of no query spanning users. Carries logical_size for quota — what this user is responsible for, regardless of who shares the bytes.' },
        { id: 'spam', label: 'Spam classifier — files, never deletes', kind: 'service', x: 450, y: 290, detail: 'Runs after the promise, so its only safe action is to move. Rich signals available: content, structure, and near-duplicate fingerprints that see one campaign where exact hashing sees millions of distinct messages.' },
        { id: 'index', label: 'Per-user index, built lazily', kind: 'store', x: 690, y: 290, detail: '60 MB per user instead of a shard of a 90 PB monolith. Built only for mailboxes actually searched — 9 PB instead of 90. Lazy is right here because search demand is genuinely skewed, unlike the curated-catalogue case.' },
        { id: 'threads', label: 'Threads — derived, per user', kind: 'service', x: 450, y: 400, detail: 'Header chains first; subject fallback requires same subject AND overlapping participants AND a time window — drop any one and it merges every "Re: Question" ever sent. My thread has only my messages, and that is correct.' },
      ],
      edges: [
        { id: 'm1', source: 'net', target: 'gate', kind: 'sync' },
        { id: 'm2', source: 'gate', target: 'line', kind: 'control' },
        { id: 'm3', source: 'gate', target: 'accept', kind: 'sync' },
        { id: 'm4', source: 'accept', target: 'bodies', kind: 'write' },
        { id: 'm5', source: 'accept', target: 'mailbox', kind: 'write' },
        { id: 'm6', source: 'accept', target: 'spam', kind: 'async' },
        { id: 'm7', source: 'spam', target: 'mailbox', kind: 'write' },
        { id: 'm8', source: 'accept', target: 'index', kind: 'async' },
        { id: 'm9', source: 'accept', target: 'threads', kind: 'async' },
      ],
      steps: [
        {
          id: 'ms1',
          title: 'Two-thirds of the volume is refused before any promise',
          description:
            'Cheap signals, free action. Rejecting means the sender bounces it and a human finds out — so the pre-acceptance gate must be conservative and reject only on strong evidence.',
          nodes: ['net', 'gate', 'line'],
          edges: ['m1', 'm2'],
        },
        {
          id: 'ms2',
          title: 'Then the promise, and it must be earned',
          description:
            'Replicate before answering 250. If storage is unavailable the answer is 452 — the sender holds the message and retries. A 250 followed by a failed write is destroyed mail nobody knows about.',
          nodes: ['accept'],
          edges: ['m3'],
        },
        {
          id: 'ms3',
          title: 'Store the body once; partition the mailbox by user',
          description:
            'Content addressing collapses bulk mail by its recipient count. And user_id as the partition key for everything makes every product read a single-partition operation.',
          nodes: ['bodies', 'mailbox'],
          edges: ['m4', 'm5'],
        },
        {
          id: 'ms4',
          title: 'After the promise, classification may only move',
          description:
            'Rich signals, one safe action. Which turns a false positive from silent permanent loss into a recoverable inconvenience — and that is the design\'s central safeguard.',
          nodes: ['spam'],
          edges: ['m6', 'm7'],
        },
        {
          id: 'ms5',
          title: 'And everything else is derived, so it is rebuildable',
          description:
            'Index and threads are both computed from the mailbox. Only the mailbox and the bodies are truth — a small surface to protect, by keeping derived state derived.',
          nodes: ['index', 'threads'],
          edges: ['m8', 'm9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'index-shape',
      title: 'One index for everyone, or one index each',
      caption:
        'Read both columns as answers to "where does the cost of a search come from". The right column is the one where a user\'s search cost depends on their own mail.',
      code: `flowchart TB
    Q["**Search 'invoice from March'<br/>in one user's mailbox**"]

    Q -->|"Global index,<br/>sharded by message id"| G["**Scatter-gather**"]
    G --> G1["Fan out to EVERY shard"]
    G1 --> G2["Each shard scans 'invoice'<br/>postings across ALL users<br/>→ millions of candidates"]
    G2 --> G3["Filter to this user<br/>→ a handful survive"]
    G3 --> G4["**Cost grows with the<br/>TOTAL corpus** — search<br/>degrades as the product<br/>succeeds"]
    G3 --> G5["Deleting a user =<br/>compaction across<br/>every shard"]
    G3 --> G6["Relevance computed over<br/>a billion mailboxes, so a<br/>term distinctive to ME<br/>looks common"]

    Q -->|"Per-user index,<br/>routed by user id"| P["**Single shard**"]
    P --> P1["One shard, one ~60 MB<br/>index, no fan-out"]
    P1 --> P2["**Cost grows with THIS<br/>USER's mail** — bounded<br/>and small"]
    P1 --> P3["Deleting a user =<br/>**drop one index**,<br/>a verifiable operation"]
    P1 --> P4["Relevance computed over<br/>the corpus that reflects<br/>what is distinctive<br/>to this user"]
    P1 --> P5["**Costs:** 90 PB if every<br/>mailbox is indexed →<br/>build lazily, since most<br/>are never searched"]

    style P2 fill:#17272a,stroke:#35897e
    style P3 fill:#17272a,stroke:#35897e
    style P4 fill:#17272a,stroke:#35897e
    style P5 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: ['gmail'],
    body: `The published Bigtable paper describes the storage shape this design uses, and three of its properties map directly onto a mailbox.

**A row is the unit of atomicity, and rows are sorted by key.** So a mailbox as \`(user_id, received_at)\` makes "the most recent hundred messages" **a single contiguous read of adjacent cells** — which is the product's highest-volume query, served by the physical layout rather than by an index.

**Column families let related data share a row with separate access and retention characteristics.** Headers, flags and labels are read on every inbox load; bodies are not. **Separating them means listing an inbox does not read message bodies**, which is why the failure table can say the inbox still renders when body storage is unavailable.

**And rows are the sharding unit**, so a row per user means a user's data never spans shards. **That is the mechanical basis for the whole per-user partitioning argument** — the storage layer's natural unit is the same as the product's query scope.

**Three transferable lessons.**

**Ask whether any query crosses your partition boundary before choosing it.** Here the answer is no, which is unusually convenient and worth naming explicitly. **Most systems have at least one cross-partition query that constrains the design** — and if this product ever gained one, such as organisation-wide discovery, the right response is a separate purpose-built index rather than globalising the one that works.

**Separate what is read constantly from what is read occasionally, inside the same record.** Headers on every list, bodies on one open. **Physical separation makes the common path cheap and makes partial failure survivable.**

**Let the physical sort order serve the dominant query.** Inbox-by-recency is the query; \`(user_id, received_at DESC)\` is the layout. **No secondary structure needed for the thing you do most.**

**Where the reference does not help.** Bigtable is storage; it says nothing about the SMTP responsibility boundary, which is the decision that prevents silent mail loss, or about spam classification. **Those are protocol and product decisions**, and the boundary in particular is the kind of thing that does not appear in any storage paper yet determines whether the system is trustworthy.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, most of which follow from per-user partitioning and from where responsibility begins.',
    rows: [
      {
        option: 'One global search index',
        whenItWins:
          'When queries genuinely span users — organisation-wide discovery, or a shared corpus.',
        whenItLoses:
          'Every query fans out to all shards and discards almost every posting examined, and cost grows with the total corpus rather than the user\'s mail.',
        cost:
          'Search that degrades as the product succeeds, plus deletion as a global compaction.',
      },
      {
        option: 'One index per user, routed by user id',
        whenItWins:
          'Always here. Single-shard queries over ~60 MB, deletion as a drop, and relevance computed over the right corpus.',
        whenItLoses:
          'If a cross-user query ever enters the product, it cannot serve it.',
        cost:
          '90 PB if every mailbox is indexed, which forces lazy builds.',
      },
      {
        option: 'Index every mailbox eagerly',
        whenItWins:
          'When every mailbox is searched — as eager transcoding is right for a catalogue where every title is watched.',
        whenItLoses:
          'Most mailboxes are never searched, so most of the 90 PB serves nobody.',
        cost:
          'Ten times the index storage for no benefit.',
      },
      {
        option: 'Build indexes lazily on first search',
        whenItWins:
          'Here. 9 PB instead of 90, because search demand is genuinely skewed.',
        whenItLoses:
          'A first search on a large cold mailbox pays a build of several seconds.',
        cost:
          'A slow first search, mitigated by pre-warming on intent signals.',
      },
      {
        option: 'A copy of the body per recipient',
        whenItWins:
          'Nowhere at this scale. Simple, and the multiplier is brutal.',
        whenItLoses:
          'A newsletter to 10 million recipients costs 800 GB instead of 80 KB.',
        cost:
          'Roughly 3× total storage, concentrated on the highest-volume mail.',
      },
      {
        option: 'Content-addressed bodies with reference counts',
        whenItWins:
          'Always. Bulk mail collapses by its recipient count, and the count makes deletion safe.',
        whenItLoses:
          'A hot body read by millions of mailboxes is a partition-skew problem.',
        cost:
          'Replicating hot bodies, plus logical-size accounting for quota.',
      },
      {
        option: 'Deleting spam after acceptance',
        whenItWins:
          'Nowhere. It breaks the promise made at the SMTP handshake.',
        whenItLoses:
          'A false positive becomes silent permanent loss — the sender was told it arrived and will never retry.',
        cost:
          'Trust in the system, irrecoverably.',
      },
      {
        option: 'Filing spam with a retention period',
        whenItWins:
          'Always. A false positive becomes a recoverable inconvenience.',
        whenItLoses:
          'Storage for mail that should have been rejected.',
        cost:
          'A spam folder that holds unwanted mail for the retention window.',
      },
      {
        option: 'Content classification before acceptance',
        whenItWins:
          'Nowhere at 2 million attempts/s. You would parse everything to reject most of it.',
        whenItLoses:
          'The expensive signals cost the most on exactly the volume you want to shed cheaply.',
        cost:
          'Three times the parsing work for the same rejections.',
      },
      {
        option: 'Cheap gate before, expensive classifier after',
        whenItWins:
          'Always. Two-thirds rejected for almost nothing; the rest classified with rich signals and a safe action.',
        whenItLoses:
          'The pre-acceptance gate must be conservative, so some obvious spam is accepted and foldered.',
        cost:
          'Storage for accepted spam, and two classification systems.',
      },
      {
        option: 'Over quota returns 550 (permanent)',
        whenItWins:
          'Nowhere. It destroys mail to enforce a storage policy.',
        whenItLoses:
          'The sender bounces immediately and the mail is gone, with no chance for the user to free space.',
        cost:
          'Lost mail for a recoverable condition.',
      },
      {
        option: 'Over quota returns 452 (temporary), then bounces',
        whenItWins:
          'Always. The sender retries for days, the user has time, and the mail still arrives.',
        whenItLoses:
          'Senders hold messages in their queues for longer.',
        cost:
          'Delayed delivery, and a bounce only after the retry window.',
      },
      {
        option: 'A global canonical thread object',
        whenItWins:
          'Nowhere. Participants legitimately received different message sets.',
        whenItLoses:
          'It must either show users messages they were not sent, or add per-user visibility filters over a shared thread.',
        cost:
          'More machinery for a worse result.',
      },
      {
        option: 'Per-user threads from header chains',
        whenItWins:
          'Always. My thread has my messages, derived and rebuildable.',
        whenItLoses:
          'Senders that omit the headers need a fallback.',
        cost:
          'A fallback requiring subject AND participants AND a time window — all three.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"A global search index over all messages, sharded by message id, filtered by user at query time."',
      whyWeak:
        'Every query fans out to every shard, scans postings across all users, and discards almost all of them. The cost grows with the total corpus rather than with the searching user\'s mail, so search gets slower as the product succeeds — and deleting a user\'s data becomes a compaction across every shard.',
      strongAnswer:
        '"Route all of a user\'s documents to one shard by user id, so a search is a single-shard query over a mailbox-sized index of about 60 MB. No fan-out and no cross-user filtering, cost bounded by the user\'s own mail, deletion is dropping one index rather than a global compaction, and relevance is computed over the corpus that reflects what is distinctive to that user. Every query in this product is scoped to one user, so nothing is given up."',
    },
    {
      weakAnswer: '"The classifier runs after delivery and deletes anything it scores as spam."',
      whyWeak:
        'Answering 250 OK is a promise: the sender considers the message delivered and will never retry. Deleting after that point makes a false positive into silent, permanent data loss — a missed job offer that nobody can recover and nobody knows about.',
      strongAnswer:
        '"The SMTP boundary divides the system. Before answering, I have cheap signals — reputation, authentication, rate — and a free action: reject with a 550, so the sender bounces it and a human learns. That sheds two-thirds of inbound volume without touching storage. After 250 OK, the message is my responsibility, so the classifier may file it anywhere but never destroy it. Spam goes to a folder with a retention period, which makes a false positive a recoverable inconvenience instead of a loss."',
    },
    {
      weakAnswer: '"Each recipient gets their own copy of the message row, including the body."',
      whyWeak:
        'The body is immutable and identical across recipients; only per-recipient state differs. A newsletter to 10 million subscribers costs 800 GB instead of 80 KB, and bulk mail is a large share of total volume — so the multiplier lands exactly where the volume is.',
      strongAnswer:
        '"Store the body once, addressed by its content hash, with a reference count, and give each recipient a small mailbox row carrying read state, labels and folder. That collapses bulk mail by its recipient count — roughly a threefold reduction overall and vastly more on the bulk portion. Quota then counts logical bytes rather than physical, or a user whose mail happens to be widely shared gets free storage and the limit becomes gameable."',
    },
    {
      weakAnswer: '"Threads are formed by grouping messages with the same subject line."',
      whyWeak:
        'It merges every "Re: Question" ever sent into one thread of thousands of unrelated messages, and it splits threads when someone edits the subject on reply.',
      strongAnswer:
        '"Thread on the header chain — Message-ID, In-Reply-To, References — which expresses actual reply relationships. Subject similarity is only a fallback for senders that omit the headers, and it needs all three conditions: same normalised subject, overlapping participants, and within a time window. Drop any one and it recreates the failure. And the thread is per-user, because my thread contains only the messages I received — two participants seeing different threads is correct, not a bug."',
    },
    {
      weakAnswer: '"If storage is having problems, accept the message and queue the write for retry."',
      whyWeak:
        'Answering 250 before the message is durable means promising what you have not stored. If the queued write is lost, the mail is gone and the sender will never retry, because they were told it arrived.',
      strongAnswer:
        '"Never promise what you did not store. Replication completes before I answer 250; if storage is unavailable I answer 452 instead, and the sending server holds the message and retries for days. That converts my infrastructure problem into a delay rather than a loss, and it costs nothing except that the sender\'s queue holds the message a while longer."',
    },
    {
      weakAnswer: '"A user over quota gets a permanent rejection so the sender knows immediately."',
      whyWeak:
        'It destroys mail to enforce a storage policy. The sender bounces the message straight away, and the user has no opportunity to free space — even though the condition is entirely recoverable.',
      strongAnswer:
        '"Over quota returns 452, a temporary rejection, so the sender retries for several days while the user gets a warning and time to delete things. Only after the retry window expires does it become a bounce. And enforcement should be approximate anyway — the quota counter is updated asynchronously and lags, which is fine: the limit exists to bound growth, not to be exact, and refusing a paying user\'s mail over a precise byte count is the wrong trade."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hgm-1',
      front: 'What single observation drives the partitioning of this design?',
      back: 'No query in the product spans users — search, inbox, thread and quota are all scoped to one mailbox. So partition everything by user id.',
      topic: 'per-user-partitioning',
    },
    {
      id: 'fc-hgm-2',
      front: 'Why is a global search index the wrong shape here?',
      back: 'Every query fans out to all shards and discards almost every posting examined, and cost grows with the total corpus rather than with the searching user\'s mail.',
      topic: 'search-indexing',
    },
    {
      id: 'fc-hgm-3',
      front: 'Name three benefits of a per-user index beyond speed.',
      back: 'Deletion becomes dropping one index rather than a global compaction; no cross-user filtering; and relevance statistics reflect what is distinctive in that mailbox.',
      topic: 'search-indexing',
    },
    {
      id: 'fc-hgm-4',
      front: 'Why are search indexes built lazily, and when would that be wrong?',
      back: 'Most mailboxes are never searched, so lazy gives ~9 PB instead of ~90 PB. It would be wrong if every mailbox were searched — as eager encoding is right for a catalogue where every title is watched.',
      topic: 'search-indexing',
    },
    {
      id: 'fc-hgm-5',
      front: 'What does 250 OK mean structurally?',
      back: 'Responsibility transfers. Before it, rejecting means the sender bounces and a human learns; after it, losing the message means nobody knows.',
      topic: 'spam',
    },
    {
      id: 'fc-hgm-6',
      front: 'What signals are available before acceptance, and what action?',
      back: 'IP and domain reputation, SPF/DKIM/DMARC, connection rate, recipient existence — all without reading the message. And the action is free: reject.',
      topic: 'spam',
    },
    {
      id: 'fc-hgm-7',
      front: 'What is the only safe action for a post-acceptance classifier?',
      back: 'Move the message. Filing spam with a retention period makes a false positive recoverable; deleting makes it silent permanent loss.',
      topic: 'spam',
    },
    {
      id: 'fc-hgm-8',
      front: 'Why is near-duplicate fingerprinting needed for spam?',
      back: 'A campaign arrives with small per-recipient variations, so exact hashing sees millions of distinct messages. A tolerant fingerprint sees one campaign, and campaign-level evidence is far stronger.',
      topic: 'spam',
    },
    {
      id: 'fc-hgm-9',
      front: 'How much does content-addressing save, and where?',
      back: 'A newsletter to 10 million recipients drops from 800 GB to 80 KB plus small references. Roughly 3× overall, concentrated on bulk mail — exactly where the volume is.',
      topic: 'per-user-partitioning',
    },
    {
      id: 'fc-hgm-10',
      front: 'Why must quota count logical rather than physical bytes?',
      back: 'Bodies are shared, so physical bytes attributable to a user are a fraction of one copy. Counting physically makes the limit gameable and meaningless.',
      topic: 'quota',
    },
    {
      id: 'fc-hgm-11',
      front: 'Why does over-quota return 452 rather than 550?',
      back: 'A temporary rejection makes the sender retry for days, so the user has time to free space and the mail still arrives. A permanent one destroys mail to enforce a storage policy.',
      topic: 'quota',
    },
    {
      id: 'fc-hgm-12',
      front: 'What are the three conditions of the subject-based threading fallback?',
      back: 'Same normalised subject, overlapping participants, and within a time window. Dropping any one merges unrelated conversations.',
      topic: 'threading',
    },
    {
      id: 'fc-hgm-13',
      front: 'Why is a thread per-user rather than a global object?',
      back: 'Each user received a different subset of the conversation, so their threads legitimately differ. A canonical thread must either leak messages or add per-user visibility filters.',
      topic: 'threading',
    },
    {
      id: 'fc-hgm-14',
      front: 'What is truth in this design, and what is derived?',
      back: 'The mailbox rows and the content-addressed bodies are truth. Index, threads and the quota counter are all derived and rebuildable — a small surface to protect.',
      topic: 'per-user-partitioning',
    },
  ],

  quiz: [
    {
      id: 'q-hgm-1',
      kind: 'scenario',
      prompt:
        'A classifier scores an accepted message as spam. What may it do?',
      options: [
        { id: 'a', label: 'Move it to a spam folder with a retention period — after 250 OK the message may be filed anywhere but never destroyed' },
        { id: 'b', label: 'Delete it, since the user does not want spam' },
        { id: 'c', label: 'Return it to the sender with a bounce' },
        { id: 'd', label: 'Delete it if the confidence score is above 99%' },
      ],
      correct: ['a'],
      explanation:
        '250 OK told the sender the message was delivered, so they will never retry. Deleting makes a false positive silent permanent loss. Option c is impossible — the SMTP transaction is over. Option d is the same failure with a threshold: a 1% false-positive rate across billions of messages is a great deal of destroyed mail.',
      difficulty: 'core',
      topic: 'spam',
    },
    {
      id: 'q-hgm-2',
      kind: 'scenario',
      prompt:
        'Storage is unavailable when a message arrives over SMTP. What should the server answer?',
      options: [
        { id: 'a', label: '452 — a temporary rejection, so the sending server holds the message and retries' },
        { id: 'b', label: '250, then queue the write for retry once storage recovers' },
        { id: 'c', label: '550, so the sender bounces it and knows immediately' },
        { id: 'd', label: 'Nothing — hold the connection open until storage recovers' },
      ],
      correct: ['a'],
      explanation:
        'Never promise what you did not store. Option b is the dangerous one because it looks helpful: a lost queued write becomes lost mail, and the sender will never retry. Option c destroys mail for a transient condition. Option d exhausts connections and eventually times out anyway.',
      difficulty: 'core',
      topic: 'spam',
    },
    {
      id: 'q-hgm-3',
      kind: 'scenario',
      prompt:
        'Why does routing all of a user\'s documents to one search shard help more than just avoiding fan-out?',
      options: [
        { id: 'a', label: 'Deletion becomes dropping one index rather than a global compaction, and relevance statistics reflect that mailbox rather than a billion' },
        { id: 'b', label: 'It allows the index to be stored in memory entirely' },
        { id: 'c', label: 'It removes the need for an inverted index at all' },
        { id: 'd', label: 'It makes cross-user search faster' },
      ],
      correct: ['a'],
      explanation:
        'Both extra benefits matter: deletion rights need a bounded, verifiable operation, and term rarity within one mailbox is what makes a term distinctive to that user — a globally common term that is rare in my mail should rank highly for me. Option d is backwards: per-user routing makes cross-user search impossible, which is acceptable only because the product has no such query.',
      difficulty: 'advanced',
      topic: 'search-indexing',
    },
    {
      id: 'q-hgm-4',
      kind: 'scenario',
      prompt:
        'A newsletter of 80 KB is sent to 10 million subscribers. What is stored?',
      options: [
        { id: 'a', label: 'One 80 KB content-addressed body with a reference count, plus 10 million small mailbox rows carrying per-recipient state' },
        { id: 'b', label: '10 million copies of the body, one per recipient mailbox' },
        { id: 'c', label: 'One copy, with recipients reading it from the sender\'s outbox' },
        { id: 'd', label: 'One copy per subscriber domain' },
      ],
      correct: ['a'],
      explanation:
        '800 GB versus roughly 2 GB. The body is immutable and identical; only read state, labels and folder differ per recipient. The reference count is what makes deletion safe — the body goes when the last reference does. Quota must then count logical bytes, or a user with a thousand shared newsletters gets free storage.',
      difficulty: 'core',
      topic: 'per-user-partitioning',
    },
    {
      id: 'q-hgm-5',
      kind: 'scenario',
      prompt:
        'A mailbox is over quota when new mail arrives. What happens?',
      options: [
        { id: 'a', label: '452 for the retry window — the sender retries for days while the user frees space — then a bounce if still over' },
        { id: 'b', label: '550 immediately, so the sender bounces it without delay' },
        { id: 'c', label: 'Accept it; quota is advisory' },
        { id: 'd', label: 'Accept it and delete the oldest mail to make room' },
      ],
      correct: ['a'],
      explanation:
        'A temporary rejection preserves the mail and gives the user time, which is the right balance for a recoverable condition. Option b destroys mail to enforce a storage policy. Option d destroys mail the user chose to keep, which is worse still. Note that enforcement is approximate anyway, since the quota counter lags.',
      difficulty: 'core',
      topic: 'quota',
    },
    {
      id: 'q-hgm-6',
      kind: 'multi',
      prompt:
        'Which parts of this design are derived and rebuildable from other state? Select all that apply.',
      options: [
        { id: 'a', label: 'The per-user search index' },
        { id: 'b', label: 'Thread assignments' },
        { id: 'c', label: 'The quota counter' },
        { id: 'd', label: 'The content-addressed message bodies' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Index, threads and the quota counter are all computed from the mailbox rows, which is why their failure modes are degradations rather than losses. Bodies and mailbox rows are the truth — and keeping the truth surface that small is deliberate, because it is the only part that needs protecting.',
      difficulty: 'core',
      topic: 'per-user-partitioning',
    },
  ],

  exercises: [
    {
      id: 'ex-hgm-1',
      kind: 'design',
      title: 'Add organisation-wide legal discovery, the query that breaks the partitioning',
      estimatedMinutes: 40,
      prompt: `The product gains an enterprise tier. Administrators need:

**Discovery search** — find all messages across every mailbox in the organisation matching a query, including deleted mail, for a date range.
**Legal hold** — freeze specified mailboxes so nothing can be deleted, including by the user.
**Export** — produce a defensible archive of the results.

**Part 1.** The design's central claim was that no query spans users. State precisely what this breaks and what still holds.

**Part 2.** Design discovery search. The per-user index cannot serve it. Give your approach, its cost, and what you are refusing to do.

**Part 3.** Legal hold conflicts with a user's deletion right and with quota enforcement. Resolve both conflicts.

**Part 4.** Name four new failure modes and what each does.

Then answer:

- Should discovery reuse the per-user indexes or have its own? Defend it.
- What does this exercise reveal about "no query spans users"?`,
      rubric: [
        'States precisely which per-user assumptions break and which survive.',
        'Recognises that per-user indexes cannot serve a cross-user query and does not try to force them.',
        'Proposes a separate org-scoped index or a scatter-gather with explicit cost accounting.',
        'Addresses deleted mail, which the primary design does not retain.',
        'Resolves legal hold against user deletion with a clear precedence rule.',
        'Resolves legal hold against quota with a defensible stance.',
        'Names at least four failure modes with consequences.',
        'Defends the reuse-or-separate decision with reasoning about access patterns.',
        'Draws the right conclusion: the claim was about the product\'s queries, not a property of the data.',
      ],
      modelAnswer: `**Part 1 — what breaks and what holds**

**What breaks: exactly one thing, and it is the load-bearing one.**

The claim was *no query in the product spans users*, and it licensed per-user partitioning of the search index specifically. **Discovery is a cross-user query, so the per-user index cannot serve it** — not slowly, not at all. There is no way to answer "which mailboxes in this organisation contain this phrase" from a collection of independent per-user indexes without visiting every one.

\`\`\`
Organisation with 50,000 mailboxes:
  per-user indexes → 50,000 single-shard queries
  → a scatter-gather across 50,000 units, at ~60 MB each
  → 3 TB of index examined per discovery query
\`\`\`

**And that is the scatter-gather the design rejected**, reintroduced — except now it is correct, because the query genuinely spans users. **The mechanism was never wrong; it was wrong for the product's queries.**

**What still holds, and it is most of the design.**

**Per-user partitioning of the mailbox itself is untouched.** Discovery reads mail; it does not change where mail lives. The wide row per user, the contiguous inbox read, the content-addressed bodies — all unaffected.

**The SMTP responsibility boundary is unaffected.** Discovery is a read path.

**Threading is unaffected**, though discovery results should probably not be threaded at all — an investigator wants messages, not conversations, and per-user threads would be misleading across mailboxes.

**Content-addressed bodies actually help.** A message sent to 200 people in the organisation is **one body**, so a discovery hit on it is one hit to examine rather than 200 — and deduplicating results is a matter of grouping by content hash.

**What breaks quietly, and is easy to miss: the deletion story.** The design said deleting a user's data is dropping their index and their rows. **Legal hold makes that conditional**, and a deletion path with a conditional exception is a different deletion path.

**And one thing breaks that is not about search at all: retention.** Discovery must find *deleted* mail. **The primary design does not retain deleted mail** — deletion means the rows are gone. So discovery requires a retention decision that the base design explicitly did not make.

---

**Part 2 — designing discovery search**

**The approach: a separate organisation-scoped index, populated only for organisations on the enterprise tier.**

\`\`\`
org_index:{org_id}   → inverted index over all messages in
                       the organisation, with postings carrying
                       (content_hash, mailbox_user_id, received_at)

Populated by:  the same accept-path event that feeds per-user
               indexes, filtered to enterprise organisations
Retained:      per the organisation's retention policy, which is
               INDEPENDENT of user deletion
\`\`\`

**Four decisions worth defending.**

**Postings key on content hash, not per-mailbox message id.** A message to 200 colleagues is one posting with 200 mailbox references. **So the index size tracks distinct messages rather than deliveries**, which for internal organisational mail — where fan-out is high — is a large reduction.

\`\`\`
50,000-person org, 40 messages/user/day:
  deliveries: 2 million/day
  distinct messages: maybe 400,000/day (internal fan-out ~5×)
  → the index is 1/5 the size of a delivery-keyed one
\`\`\`

**Only enterprise organisations get one.** Consumer mailboxes have no organisation and no discovery requirement, so **the 90 PB problem does not recur** — this index covers a small fraction of users. That is what makes a second index affordable at all.

**It is built eagerly, not lazily.** Discovery must find mail that was deleted, so **the index must exist before anyone knows they will search for it.** Lazy building would be useless: by the time an investigation starts, the evidence may be gone. *This is the direct inversion of the consumer decision*, and for a clean reason — the consumer index is a convenience that can be rebuilt from the mailbox, while this one is a record whose source may not survive.

**Retention is the organisation's, not the user's.** The index and a copy of the body persist per the organisation's policy even after a user deletes the message. **Which is the whole point** — and it is also the part requiring the clearest legal and product framing, because it means the organisation retains mail the employee believes they deleted.

**What this costs.**

\`\`\`
Index: 400,000 messages/day × ~3 KB text × 30% ≈ 360 MB/day/org
       Over 7 years: ~900 GB per 50,000-person organisation
Bodies: retained per policy rather than per user deletion
       → the org's retention floor becomes the real retention
\`\`\`

**Substantial but bounded**, and the enterprise tier is priced to cover it.

**What I am refusing to do, and this is as important as what I am building.**

**I am refusing to make the consumer index cross-user.** It would make every consumer search a scatter-gather to serve a query consumers never make. **Two indexes with different shapes beats one index that serves both badly.**

**I am refusing to retain consumer deleted mail.** Discovery retention applies only to enterprise organisations that have accepted the policy. **A consumer's deletion remains a real deletion**, which is both the right default and a legal necessity in several jurisdictions.

**I am refusing to make discovery real-time.** A discovery query over 900 GB of index with export is a job, not a request. **It returns a job id and completes in minutes**, which matches how investigations actually work and removes any need to optimise for interactive latency.

**I am refusing to thread discovery results.** Threads are per-user views, and presenting them across mailboxes would imply a shared conversation object that does not exist. **Results are messages, grouped by content hash.**

---

**Part 3 — legal hold against deletion, and against quota**

**Conflict 1: legal hold versus the user's deletion right.**

\`\`\`
User action:  delete message → mailbox row removed
Legal hold:   nothing in this mailbox may be removed
\`\`\`

**Resolution: hold wins over the user's deletion, and the user's experience is unchanged.**

\`\`\`
On delete, with a hold active:
  1. Remove the message from the user's visible mailbox
     (their view is correct — it is gone for them)
  2. Preserve the row in a held partition, flagged
     held_by = <hold_id>, invisible to the user
  3. Do NOT decrement the body's reference count
  4. Record the deletion in the hold's audit trail
\`\`\`

**Three reasons this shape is right.**

**The user's view is honest — the message is gone from their mailbox.** Refusing the deletion outright would tell them their organisation is watching, which may itself be legally problematic in an investigation.

**The preservation is auditable.** The hold's audit trail records that a deletion was attempted and when, which is often exactly what an investigation cares about.

**And the reference count is what makes this safe.** Because bodies are content-addressed with a count, **the hold simply keeps a reference** — no copying, no separate archive format. **The storage model built for deduplication turns out to make legal hold nearly free**, which is a genuine piece of luck worth noticing.

*What about a statutory deletion right that conflicts with a litigation hold?* **That is a legal conflict, not an engineering one**, and the system's job is to make both states representable and auditable rather than to resolve it. *What I would build:* a hold that records its legal basis, and a deletion request that records its basis, so **a conflict surfaces as a flagged case for a human** rather than being silently decided by whichever code path ran.

**Conflict 2: legal hold versus quota.**

A held mailbox accumulates messages the user deleted, so **its logical size grows without the user being able to reduce it.**

\`\`\`
User deletes 5 GB to get under quota
Hold preserves all 5 GB
→ if held bytes count toward quota, the user cannot
  get under it by any action available to them
\`\`\`

**Resolution: held bytes do not count toward the user's quota; they count toward the organisation's.**

**The reasoning is about who caused the storage.** The user deleted the mail — **they took the action that would have freed it.** The bytes persist because the organisation placed a hold, so the organisation is responsible for them. **Charging the user for storage they cannot release is enforcing a limit against someone with no way to comply**, which is the same failure as refusing a paying subscriber in the streaming lesson.

*And the practical consequence:* the organisation sees held storage as a line item, which is correct — **it makes the cost of a broad hold visible to the party choosing its scope.** A hold over 50,000 mailboxes for seven years has a real cost, and the party deciding should see it.

---

**Part 4 — four new failure modes**

**1. A hold applied after the mail is gone.** An investigation begins, a hold is placed, and the relevant mail was deleted last week. **The hold is prospective only and the evidence is absent** — which is precisely why the org index and its retention must be eager rather than triggered by the hold. *Effect:* the feature appears to work and produces nothing, which is the worst kind of failure for a compliance product.

**2. Discovery index divergence from mailboxes.** The org index is populated by the same accept-path event as per-user indexes. **If that pipeline drops events for one organisation, discovery returns fewer results than exist** — and unlike a consumer search, the absence is not obviously wrong to the user. *Requires:* a reconciliation job comparing message counts per organisation per day between mailbox rows and index postings, and **an explicit completeness attestation on every export** stating the period verified. **An export that cannot state its completeness is not defensible.**

**3. Reference-count leak from holds.** Held rows keep body references alive. **If a hold is released and its rows are not properly decremented, bodies persist forever** — a slow storage leak invisible in any per-user accounting, because the referencing rows are in a partition nobody looks at. *Requires:* hold release as an explicit, audited, verified operation rather than deleting a flag.

**4. Hold scope explosion.** A cautious legal team places holds on the whole organisation indefinitely. **Every deletion across 50,000 mailboxes becomes a preservation**, storage grows without bound, and quota exemptions apply to everyone. *Effect:* the enterprise tier's storage cost becomes unbounded and unpredictable. *Requires:* holds with mandatory expiry and renewal, and the cost line item from Part 3 so the scope decision is informed.

*And a fifth worth naming:* **cross-tenant leakage in the org index.** The org index is the only cross-user structure in the system, so **it is the only place where a routing or filtering bug can show one organisation another's mail.** Every other index is per-user and structurally incapable of this. *Requires:* the organisation id as a partition key rather than a filter — **so a leak requires reading the wrong partition rather than forgetting a WHERE clause.**

---

**Reuse the per-user indexes, or build a separate one?**

**Separate, decisively — and the reason is that they have different lifetimes, not just different shapes.**

**The shape argument is the obvious one.** Per-user indexes are optimised for single-mailbox queries; a cross-user query over 50,000 of them examines 3 TB of index. **A cross-user query wants a cross-user index.**

**But the lifetime argument is the one that settles it.**

\`\`\`
Per-user index:  a CACHE. Derived from the mailbox, dropped when
                 unused, rebuilt on demand. Deleted when the
                 user's data is deleted.
Org index:       a RECORD. Must survive the deletion of its
                 source. Retained on the organisation's policy.
                 Must be provably complete for a period.
\`\`\`

**Those are incompatible requirements for one structure.** The per-user index must be droppable and must vanish on user deletion; the org index must be durable and must outlive user deletion. **A single index cannot be both a cache and a record**, and attempting it would mean the consumer deletion path could destroy discovery evidence — which defeats the feature.

**A third argument, about blast radius.** Keeping discovery in a separate structure means **the cross-tenant risk is confined to one system** that can be built with organisation id as a partition key and audited accordingly. Making the consumer index cross-user would put every consumer search one bug away from a cross-user leak.

*The cost of separateness:* two indexing pipelines from one event stream, and the reconciliation job from failure mode 2 to prove they agree. **Worth it**, because the alternative couples a compliance record to a cache's lifecycle.

---

**What this reveals about "no query spans users"**

**It reveals that the claim was about the product's queries, not about the data — and that the distinction was doing more work than it appeared to.**

The original reasoning was sound: *given the queries this product makes,* per-user partitioning is free. **The unstated assumption was that the query set was fixed.** Enterprise discovery adds one query, and it is a query no amount of per-user optimisation can serve.

**Three things follow, and they generalise past this design.**

**A partitioning decision is a bet on the query set, and it should be recorded as one.** The right form of the original claim is: *"no query in the product spans users today, and if one ever does it will need its own index."* **Stated that way, the enterprise requirement is an anticipated event rather than a broken assumption** — and the response is additive rather than a redesign.

**And the response should be additive, which is the practical lesson.** The temptation is to generalise the existing index so it serves both. **That makes the common case worse to serve a rare one** — a scatter-gather for every consumer search so that administrators can occasionally search an organisation. **Adding a second structure for the second access pattern keeps the first one optimal**, and the base design's own logic supports it: the index was always a derived cache, so having two derivations is natural.

**The deeper point: "which queries cross my partition key" is a question to ask at design time and to keep asking.** It is not a property you verify once. **Here the answer was genuinely "none", which was an unusual gift** — and the gift came with the obligation to notice when it stopped being true.

*And the honest reading of this exercise:* the per-user decision was **still right**. It serves a billion users' searches optimally and makes deletion tractable. **Discovery costs one additional index covering a small fraction of users** — a far better outcome than having compromised the primary path from the start to accommodate a requirement that did not yet exist. **Designing for the queries you have, while naming the bet, beats designing for the queries you might have.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hgm-1',
      level: 'basic',
      question: 'Design Gmail. What is the first structural decision?',
      guidance:
        'Look for the observation that no query spans users, and partitioning everything by user as a consequence. A candidate who starts with a global messages table and a global index has missed the problem\'s main gift.',
    },
    {
      id: 'iq-hgm-2',
      level: 'basic',
      question: 'How is search implemented?',
      guidance:
        'Per-user index routed by user id, single-shard queries. A strong answer names deletion and relevance statistics as benefits beyond speed, and mentions lazy building.',
    },
    {
      id: 'iq-hgm-3',
      level: 'intermediate',
      question: 'Walk me through what happens when a message arrives.',
      guidance:
        'Edge gate on cheap signals, then the accept path: store body, write references, replicate, then 250. Everything else async. Look for the recognition that 250 is a promise.',
    },
    {
      id: 'iq-hgm-4',
      level: 'intermediate',
      question: 'How do you handle spam?',
      guidance:
        'Two decision points separated by acceptance: cheap reject before, rich classification after with filing only. Strong answers note the false-positive asymmetry and near-duplicate fingerprinting.',
    },
    {
      id: 'iq-hgm-5',
      level: 'advanced',
      question: 'Your storage tier is degraded when mail arrives. What do you answer?',
      guidance:
        '452, so the sender holds and retries. Excellent answers explicitly reject "accept and queue the write", naming it as promising what you did not store.',
    },
    {
      id: 'iq-hgm-6',
      level: 'advanced',
      question: 'A newsletter goes to 10 million subscribers. What is stored, and how does quota work?',
      guidance:
        'One content-addressed body with a reference count plus small per-recipient rows; quota counts logical bytes. Excellent answers note that physical accounting makes the limit gameable.',
    },
    {
      id: 'iq-hgm-7',
      level: 'followup',
      question: 'How does threading work, and why can two people see different threads?',
      guidance:
        'Header chains with a three-condition subject fallback. Threads are per-user because the message sets are per-user, and that is correct rather than a gap.',
    },
    {
      id: 'iq-hgm-8',
      level: 'followup',
      question: 'An enterprise customer needs search across all mailboxes in their organisation. Now what?',
      guidance:
        'A separate org-scoped index, eagerly built, retained on the organisation\'s policy. Look for refusal to globalise the per-user index, and for the cache-versus-record distinction.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hgm-1',
      kind: 'what-changes-if',
      prompt:
        'Change one requirement: all mail must be encrypted at rest with keys only the user holds, so the server cannot read message content. What survives, what breaks, and what does the spam pipeline become?',
      discussion: `This is the same shape as the encrypted-documents question, and it lands differently because **mail arrives from outside the system**. A document is created by its owner; a message is handed to you by a stranger, and you must decide what to do with it before anyone with a key is involved.

**What survives.**

**The SMTP responsibility boundary is untouched**, and it becomes *more* important. You still accept or reject, and \`250\` is still a promise.

**Per-user partitioning survives entirely** — indeed encryption reinforces it, since keys are per user and a cross-user structure would need cross-user keys.

**Quota survives**, because ciphertext size approximates plaintext size closely enough. **Counting bytes needs no plaintext.**

**And the mailbox layout survives**, with a caveat: envelope metadata — sender, recipient, timestamp, size — must remain readable for routing and listing, so **only bodies and subjects are encrypted.** Which is a substantial leak and worth naming rather than glossing: **who corresponded with whom and when is often more revealing than the content.**

**What breaks: server-side search, entirely.**

The per-user index was built by tokenising message text. **The server cannot tokenise what it cannot read.**

*Three options, all worse than plaintext search:*

**Client-side indexing.** The client decrypts, indexes locally, and searches locally. **Works well on one device with a small mailbox**, and poorly for a 70,000-message mailbox on a phone — and the index must be rebuilt or synchronised across devices.

**An encrypted index the server stores but cannot read.** The client builds it and uploads it encrypted; searching means downloading the relevant portion. **Trades storage for bandwidth and leaks access patterns.**

**Searchable encryption.** The server can test encrypted tokens against encrypted queries without learning either. **Real, and it leaks which documents matched which query** — and over many queries that leakage reconstructs a great deal.

*I would build client-side indexing with an encrypted server-stored index for sync*, and **accept that search is worse.** This is usually the feature that decides whether an encrypted mail product is viable.

**And the interesting part: what the spam pipeline becomes.**

**The pre-acceptance gate is entirely unaffected**, and this is the pleasant surprise. Reputation, authentication, connection rate, recipient existence — **none of these read the message.** So the gate that rejects two-thirds of inbound volume works exactly as before.

**Which means encryption costs the spam pipeline much less than it first appears**, because the cheap gate was always doing the bulk of the work.

**The post-acceptance content classifier, though, loses its inputs.** It ran on content, structure and near-duplicate fingerprints.

*What is still available before encryption:* **the message arrives as plaintext.** It has to — SMTP delivers plaintext, and the server encrypts it before storing. **So there is a window, in memory, on the accept path, where the content is readable.**

**So the classifier moves onto the accept path**, and that is a significant change with three consequences.

**It becomes synchronous and latency-bounded.** Classification now happens before the message is stored, so **it is on the path to \`250\`** and must complete in milliseconds rather than seconds. **A slower, better classifier is no longer available.**

**Its verdict must be stored as metadata**, since it cannot be recomputed later. **So a reclassification — the campaign is identified as spam an hour after delivery — cannot happen**, because the content is gone. *That is a real capability loss:* much spam detection is retrospective, identifying a campaign from its aggregate behaviour after many messages have landed.

**And the user's "mark as spam" signal becomes the only post-hoc mechanism.** Which raises its value and makes a subtlety important: **reporting spam means sending content back to the server**, so the user's report is an explicit, consented decryption of that one message. **That must be deliberate and visible**, not a silent side effect of a folder move.

*What partly survives retrospectively:* **fingerprints computed at accept time and stored as metadata.** The server cannot re-read the message, but it kept a fingerprint — so **when a campaign is identified later, messages sharing that fingerprint can be re-filed without decrypting anything.** That recovers a useful fraction of retrospective classification, and it is the design move worth naming: **compute and retain the derived signals at the one moment you can see the content.**

**What I would build.**

\`\`\`
Accept path:
  1. Edge gate (unchanged — reads no content)
  2. Classify synchronously, in memory, on plaintext
  3. Compute and retain: near-duplicate fingerprint,
     structural features, verdict
  4. Encrypt body + subject with the user's key
  5. Store; answer 250
Later:
  · Re-file by fingerprint when a campaign is identified
  · User reports = consented decryption of one message
Search:
  · Client-side index, encrypted copy stored server-side for sync
\`\`\`

**The honest summary.** Encryption at rest costs **search** (badly), **retrospective content classification** (partly recovered by retained fingerprints), and **the latency budget for classification** (now synchronous). It costs the pre-acceptance gate nothing, which is where most of the spam work happens. **And the metadata leak — who, when, how much — remains, which is the part users most often assume encryption covers and it does not.**

**The transferable point:** when content becomes unreadable at rest, find the **one moment it was readable** and decide what derived signals to compute and keep. **The plaintext window on the ingress path is the entire budget for everything the server will ever know about the content** — so what you extract there determines which features survive, and that decision cannot be revisited later.`,
    },
    {
      id: 'al-hgm-2',
      kind: 'debug',
      prompt:
        'A small percentage of users report that searching for a message they can see in their inbox returns no results. The message is definitely there — they found it by scrolling. Inbox loads are healthy, the index updater reports no errors and no backlog, and rebuilding the affected user\'s index fixes it permanently. Diagnose it.',
      discussion: `Two facts do most of the work here. **A rebuild fixes it permanently** — so the mailbox rows are complete and correct, and the index was missing something it should have had. **And the updater reports no backlog** — so it believes it processed everything.

**Those two together point somewhere specific: the index updater processed the event and produced nothing, or never received an event it should have.** Not a lag, not an error — a silent omission. That is a much smaller space than "search is broken".

**Hypothesis 1 — the message arrived while the user had no index, and the watermark was advanced anyway.** Indexes are built lazily, so most mailboxes have none. The updater's correct behaviour for such a user is to skip.

*The bug:* if it skips *and* advances \`built_through\`, then **when the user later searches and an index is built from the watermark, everything before it is missing.** The build starts from a watermark that was moved by messages it never indexed.

*Why it fits every fact:* affects a small percentage (users who searched for the first time recently), no errors (skipping is intended), no backlog (events were consumed), and **a rebuild from scratch fixes it permanently** because a full rebuild ignores the watermark.

*Check:* whether \`built_through\` advances for users with no index, and whether affected users' first search post-dates the missing messages. **This is my leading hypothesis** — it explains the "rebuild fixes it permanently" detail better than anything else, because a lag-type bug would recur.

**Hypothesis 2 — a race between the lazy build and concurrent delivery.** A build starts, reads the mailbox up to sequence N, and meanwhile messages N+1 and N+2 are delivered. **If the build then sets \`built_through = N+2\` (the current tail) instead of N (what it actually read), those two are lost forever.**

*Why it fits:* it affects only users who received mail during their index build — a small percentage — and the gap is permanent until a rebuild. **A classic off-by-a-window bug at a boundary between a batch build and a live stream.**

*Check:* the timestamps of missing messages against the affected users' index build windows. **If the missing messages cluster inside the build window, this is it.**

**Hypothesis 3 — the updater silently drops messages it cannot tokenise.** A message with an unusual encoding, a malformed MIME structure, or an enormous attachment might throw inside the tokeniser. **If that exception is caught and the event acknowledged, the message is skipped with no error recorded.**

*Why it fits:* affects specific messages rather than specific users, which would present as "a small percentage of users, each missing one or two messages". *And "no errors reported" is consistent with a swallowed exception* — the most common way for a pipeline to lose data quietly.

*Check:* whether the missing messages share a characteristic — encoding, size, attachment type. **Ask the affected users what the missing message was**, or diff one user's mailbox rows against their index postings and inspect what is absent. **A shared characteristic confirms it immediately.**

**Hypothesis 4 — the message is indexed but not matched, due to tokenisation asymmetry.** The document was tokenised one way at index time and the query another way — an analyser change, a normalisation difference, or searching for a term inside a compound the indexer split differently.

*Why it fits:* **and why a rebuild fixing it is the clue.** A rebuild re-tokenises with the *current* analyser, so if the analyser changed after the message was indexed, the old postings don't match current queries and the rebuild repairs it. **This is a strong fit for "rebuild fixes it permanently".**

*Check:* whether the affected messages were indexed before an analyser or tokeniser deployment. **A time boundary in the affected messages' indexed-at timestamps, rather than in their received-at, is the signature** — and that distinction is what separates this from hypotheses 1 and 2.

**Hypothesis 5 — the search query is routed to the wrong shard.** Routing by user id means a resharding or a routing-table change could send a query to a shard that does not hold that user's index. **The query returns nothing, the index is fine.**

*Why the rebuild detail argues against it:* a rebuild would write to whichever shard routing currently indicates, so **it would coincidentally fix a routing mismatch** — which makes this consistent with the facts but not the best explanation, since it would also cause total search failure for affected users rather than missing individual messages.

*Check:* whether affected users get *no* results at all or merely miss specific messages. **That single question discriminates this from every other hypothesis**, and it is the first thing to establish.

**What I would check first: do affected users miss specific messages, or all results?** One question to a few affected users, or one diff of mailbox rows against index postings. **Missing specific messages points at 2, 3 or 4; missing everything points at 1 or 5.** Everything else is guesswork until this is known.

**Then: the \`built_through\` watermark's behaviour for users without an index.** A code read, and hypothesis 1 is the one that fits "permanently fixed by rebuild" most naturally — a watermark advanced past unindexed content is permanently wrong in exactly this way.

**Why "no backlog and no errors" is the most useful evidence.**

It eliminates the entire class of lag and failure explanations, which is where investigation instinctively starts. **The pipeline believes it succeeded**, so the bug is in what "success" means — a skip that advances a watermark, a swallowed exception, a build that claims more than it read.

**All three are the same failure shape: state advanced past work not done.** And that shape is invisible to every metric a pipeline normally emits, because from the pipeline's perspective nothing went wrong.

**The instrumentation this demands.**

**A count reconciliation per user: mailbox rows versus index postings.** The single most valuable check, and it detects all of hypotheses 1, 2 and 3 directly. **Run it continuously on a sample of users** and alert on any discrepancy — this is exactly the check the design's "index is a cache, not data" framing makes safe to act on, since the repair is a rebuild.

**A skipped-document counter with a reason label.** Hypothesis 3 is a swallowed exception, and it becomes visible the moment skips are counted rather than caught. **Any skip that is not "user has no index" should be an alert**, not a log line.

**Watermark advancement gated on work done.** \`built_through\` should only ever advance to the highest sequence actually indexed — **never to the mailbox tail, and never for a skipped user.** That is a code invariant worth asserting rather than a metric.

**Analyser version stamped on the index.** Hypothesis 4 is undetectable without knowing which analyser produced which postings. **Stamping it makes "reindex everything indexed before version N" a runnable operation** instead of a guess.

**And a search-result-count sanity check on the read path.** A query that returns zero results for a user with a populated index is worth counting — **not an error, but a signal that should not be common.**

**Transferable:** when a derived structure is missing data and the pipeline reports success, the bug is in the bookkeeping rather than the work — **a watermark, an acknowledgement, or a caught exception claiming progress that did not happen.** And the only reliable detection is to **compare the derived structure against its source**, continuously, because no metric internal to the pipeline can see the difference.`,
    },
  ],

  revision: {
    bullets: [
      'No query in this product spans users — so partition mailbox, threads, index and quota by user id.',
      'A global search index fans out to every shard and discards almost every posting examined.',
      'Global-index search cost grows with the total corpus, so it degrades as the product succeeds.',
      'A per-user index makes search a single-shard query over ~60 MB.',
      'Per-user indexes make deletion a drop rather than a global compaction — which legal rights require.',
      'And they compute relevance over the corpus that reflects what is distinctive to that user.',
      'Index every mailbox and it is ~90 PB; index only mailboxes actually searched and it is ~9 PB.',
      'Lazy indexing is right here because search demand is skewed — the usage distribution decides, not the mechanism.',
      'Store bodies once, content-addressed with a reference count: a newsletter to 10 M is 80 KB, not 800 GB.',
      'Quota counts logical bytes, not physical, or shared bodies make the limit gameable.',
      '250 OK is a promise: before it the message is the sender\'s problem, after it losing it means nobody knows.',
      'Reject on cheap signals before acceptance — reputation, authentication, rate — which sheds two-thirds of volume.',
      'Classify on rich signals after acceptance, and only ever file: never delete accepted mail.',
      'A false negative is one click; a false positive could be a lost job offer.',
      'Near-duplicate fingerprints see one campaign where exact hashing sees millions of distinct messages.',
      'Never promise what you did not store — answer 452 when storage is unavailable, never 250.',
      'Over quota is a 452 then a bounce, so the sender retries for days and the user has time.',
      'Threads are derived per user from header chains; the subject fallback needs subject AND participants AND a window.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A mail system partitioned entirely by user — mailbox, threads, search index and quota — with content-addressed bodies shared across recipients, and a spam pipeline split by the SMTP responsibility boundary.',
    whyItExists:
      'Because no query in the product spans users, which licenses per-user partitioning of everything and turns search, deletion and relevance from hard problems into easy ones. And because accepting a message is a promise that constrains every later decision.',
    whenToUse: [
      'Per-user index partitioning whenever every query is scoped to one principal.',
      'Lazy index materialisation whenever usage is genuinely skewed.',
      'Content-addressed storage whenever an immutable payload is shared by many owners.',
      'A cheap pre-acceptance gate whenever most inbound volume should be refused.',
      'File-never-delete whenever a false positive would be silent permanent loss.',
    ],
    whenNotToUse: [
      'A global index for queries that never span users.',
      'Eager indexing when most units are never queried.',
      'A copy of an immutable body per recipient.',
      'Content classification before acceptance at high reject volume.',
      'Deleting anything after answering 250.',
      'Answering 250 before the write is durable.',
      'A permanent rejection for a recoverable condition like quota.',
      'Subject-only threading.',
    ],
    alternatives: [
      'A separate organisation-scoped index for genuine cross-user queries — additive, not a generalisation.',
      'Tiered indexing: recent mail always indexed, older on demand, for partial results fast.',
      'Replicating hot bodies across partitions, for bulk mail read by millions of mailboxes.',
      'Client-side indexing with an encrypted server-stored copy, when content is unreadable at rest.',
      'Fingerprints computed at ingress and retained, to recover retrospective classification without plaintext.',
    ],
    tradeoffs: [
      'Per-user indexes buy single-shard search and bounded deletion, and cost the ability to query across users.',
      'Lazy building buys 10× index storage and costs a slow first search.',
      'Content addressing buys ~3× storage overall and costs hot-partition skew plus logical accounting.',
      'A cheap pre-acceptance gate buys two-thirds of volume rejected for almost nothing, and costs conservatism.',
      'Filing rather than deleting buys recoverable false positives and costs spam-folder storage.',
      '452 over 550 buys the user time and costs delivery delay.',
      'Approximate quota buys a fast delivery path and costs precision nobody needs.',
    ],
    failureModes: [
      'Deleting spam after acceptance — silent permanent loss the sender will never retry.',
      'Answering 250 and then failing to write.',
      'A global index making search degrade as the corpus grows.',
      'A copy per recipient multiplying bulk mail by its audience.',
      'Subject-only threading merging every "Re: Question" ever sent.',
      'A canonical global thread leaking messages a user was not sent.',
      'Physical-byte quota accounting, making the limit gameable.',
      'A permanent rejection for an over-quota mailbox.',
      'An index watermark advanced past documents that were skipped, not indexed.',
      'A swallowed tokenisation exception losing documents while the pipeline reports success.',
      'Cross-tenant leakage in the one cross-user index — the only place structurally capable of it.',
    ],
    followUpQuestions: [
      'Does any query in this product span users?',
      'Is the search index partitioned by user or by message?',
      'How large is the index if every mailbox is indexed, and how many are searched?',
      'Is the body stored once or per recipient?',
      'Does quota count logical or physical bytes?',
      'What happens between the last cheap signal and 250 OK?',
      'What may a post-acceptance classifier do to a message?',
      'What do you answer when storage is unavailable?',
      'What reply code does an over-quota mailbox produce, and for how long?',
      'What are the conditions of the subject-based threading fallback?',
      'Which parts of this design are truth, and which are rebuildable?',
    ],
  },
});
