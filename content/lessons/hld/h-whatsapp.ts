import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-whatsapp',
  title: 'Design WhatsApp',
  summary:
    'The hard problem is not storing messages — it is knowing which of 100,000 servers holds a given user\'s connection, and what to do in the seconds after that answer becomes wrong.',
  phase: 'hld',
  module: 'core-designs',
  position: 46,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 95,
  tags: ['connection-ownership', 'delivery-receipts', 'offline-queue', 'ordering', 'group-fan-out'],
  prerequisites: ['h-notifications'],
  resources: [
    {
      key: 'whatsapp-erlang-scale',
      tier: 'must',
      note: 'Read it for the connection density figures — millions of concurrent connections per server. The number is what makes connection ownership a tractable problem rather than an impossible one.',
    },
    {
      key: 'rfc-6455-websocket',
      tier: 'must',
      note: 'Read the sections on the handshake, framing and close semantics. Close handling is the part that matters here: distinguishing a clean close from a dropped connection determines your presence accuracy.',
    },
    {
      key: 'slack-real-time',
      tier: 'must',
      note: 'A published account of a real-time messaging architecture, including the connection tier and how clients recover missed messages. Read it for the reconnection protocol specifically.',
    },
    {
      key: 'signal-double-ratchet',
      tier: 'good',
      note: 'The key-management protocol behind end-to-end encryption. Read it for why E2EE forces server-side fan-out to be over ciphertext, which removes several server-side features from the design.',
    },
    {
      key: 'mdn-websockets-api',
      tier: 'good',
      note: 'The client-side view, including reconnection and backoff. Useful for the client half of the protocol, which is where the missed-message recovery lives.',
    },
    {
      key: 'aws-sqs-fifo',
      tier: 'advanced',
      note: 'Read the message-group material as a comparison for per-conversation ordering. It shows the throughput cost of ordering scoped to a key, which is the same trade this design makes.',
    },
  ],

  intuition: {
    body: `Messaging looks like a database problem and is a **connection routing** problem.

Storing messages is easy: append-only rows partitioned by conversation, which the partitioning lesson settled. The difficulty is that a message must reach a device **now**, and that device is holding a WebSocket to exactly one of 100,000 servers. So every send requires answering: **which server owns this recipient's connection?**

That question has three properties that make it hard.

**The answer changes constantly.** Users move between networks, phones sleep, servers deploy. A connection lasting minutes is normal, so the mapping churns continuously — this is not a lookup table you populate once.

**The answer is frequently wrong by the time you use it.** You look up "user 8891 is on server 47", and by the time your message arrives there, the connection has moved. **So the design is not "find the server" but "find the server, and handle the case where it has gone"** — which is where most of the engineering is.

**A user has several devices.** Delivery is per device, not per user, and each device has its own connection and its own position in the message stream.

Then the second idea, which resolves what would otherwise be an impossible reliability problem: **the durable store is authoritative and the connection is an optimisation.**

Every message is persisted before any delivery is attempted. Delivery over a live connection is a fast path; if it fails, or the recipient is offline, the message is already safe and will be fetched on reconnection. **That inversion is what makes the system reliable despite connections being unreliable** — you never have to guarantee a connection-based delivery succeeded, because the store is the source of truth and the client pulls what it missed.

And the third, which is the ordering question: **order is per conversation, not global.** There is no meaningful global order across a billion users, and nobody needs one. Within one conversation, messages must appear in a consistent order on every device — and the useful realisation is that **the server assigns that order**, because client clocks disagree and a client-timestamp ordering shows messages out of sequence whenever a phone's clock is wrong.

The framing to carry: **persist first, deliver opportunistically, order per conversation on the server, and design for the connection mapping being stale.**`,
    analogyLimit:
      '"Messaging is a chat database" hides that the database part is solved and the routing part is not. It also hides the reconnection protocol, which is most of the client engineering: a device that was offline for an hour must discover exactly what it missed across every conversation, in order, without re-downloading its history — and that is a cursor problem, not a query problem.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds messaging as follows: clients hold WebSockets to a connection tier; a Redis hash maps user id to server id; sending looks up the recipient, forwards to that server, which writes the message to the database and pushes it down the socket. Identify four failures, and say which one loses messages.',
      answer: `**Failure 1 — the mapping is stale, and the message is silently dropped.**

\`\`\`
t=0  Sender's server reads Redis: user 8891 → server 47
t=1  User 8891's phone changes network; connection moves to server 82
t=2  Message arrives at server 47, which has no connection for 8891
t=3  Server 47 has no instruction for this case → drops it
\`\`\`

**The message is lost and nobody knows.** The sender saw a success, the recipient never receives it, and no error was recorded anywhere.

**And this window is not rare.** Connections churn constantly — a mobile user moving between cell towers and WiFi re-establishes several times an hour. **A design whose correctness depends on the mapping being current will lose messages continuously.**

**Failure 2 — the write ordering loses messages on crash, and this is the one that matters.**

The server writes the message *and then* pushes it. Reverse the concern: what if it crashes between receiving the message and writing it?

\`\`\`
Sender → server 47 → [crash] → nothing persisted, sender saw nothing
\`\`\`

Recoverable, because the sender can retry. But the real problem is subtler:

\`\`\`
Server 47 writes the message, pushes it down the socket, crashes.
Did the push arrive? Nobody knows.
The recipient's client has no record of it.
On reconnection, what does the client ask for?
\`\`\`

**Nothing in this design tells the client what it missed.** There is no cursor, no per-device delivery position. A client reconnecting can only ask "give me recent messages", which either re-delivers messages it has or misses ones it does not.

**This is the failure that loses messages**, and it loses them systematically rather than in a race. The fix is a **per-device cursor**: each device records the last message sequence it has, and on reconnection asks for everything after it. **The durable store plus a cursor is what makes delivery reliable; the socket is only an optimisation.**

**Failure 3 — persist-then-route is the wrong order.**

The design routes to the connection server, which then writes. So the write happens on whichever server holds the connection — meaning the durability of the message depends on finding the recipient.

**If the mapping lookup fails, or the recipient is offline, where does the message go?** The design has no answer, so an offline recipient's messages are either dropped or handled by some path not described.

**The correct order is: persist first, then deliver.**

\`\`\`
1. Sender's server assigns a sequence number and writes the message
   to the conversation's durable log. Acknowledge the sender.
2. Look up each recipient device's connection.
3. Attempt delivery over the socket, best-effort.
4. On failure or absence: nothing more to do — the message is stored
   and the device will fetch it on reconnection.
\`\`\`

**Now delivery failure is not an error.** It is the normal case for an offline device, and the same mechanism handles both.

**Failure 4 — no delivery receipts, and they are not a decoration.**

A messaging product needs "sent", "delivered", "read". Those are three distinct states with three different sources of truth:

\`\`\`
sent      — the server persisted it (server knows)
delivered — the recipient's device received it (device must tell the server)
read      — the user opened the conversation (device must tell the server)
\`\`\`

**Delivered and read are messages in the opposite direction**, and they need the same reliability treatment as the original message — persisted, ordered, and delivered opportunistically. A design that treats receipts as fire-and-forget socket writes produces the familiar bug where a message shows as undelivered forever despite having arrived.

**And receipts multiply the traffic.** One message to a group of 100 generates up to 100 delivered receipts and 100 read receipts, so **receipts can dominate message volume** — which is why they are batched and why group receipts are usually aggregated rather than per-member.

**In order: failure 2 loses messages systematically** and is fixed by per-device cursors. Failure 1 loses them in a race and is fixed by falling back to the durable path. Failure 3 is a structural ordering error. Failure 4 is a missing feature with a surprising traffic consequence.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
A user can send a text message to another user
A user can send a message to a group of up to 1,000 members
A user receives messages on all their devices
A sender sees sent / delivered / read status
A user can see whether a contact is online, and their last-seen time
A user can send images and video (media, up to 100 MB)
A user offline for up to 30 days receives everything they missed
Messages within a conversation appear in the same order on every device
\`\`\`

**The clarifying questions that change this design:**

**Is it end-to-end encrypted?** *Yes.* This is decisive: the server cannot read message content, so **server-side search, server-side media transcoding and content-based features are all impossible.** Fan-out becomes fan-out of ciphertext, and a group message must be encrypted separately per recipient device.

**How many devices per user?** *Up to 4.* Delivery and receipts are per device, and each device has its own cursor.

**Is message history stored on the server permanently?** *No — the server holds undelivered messages for 30 days and deletes after delivery to all devices.* This is the assumption that makes storage tractable, and it is a product decision with a large consequence.

**Maximum group size?** *1,000.* Bounded fan-out. Unbounded would force a broadcast-channel design instead.

**Ordering scope?** *Per conversation, server-assigned.* No global order, and not client timestamps.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Delivery latency (both online) | p99 under 500 ms | Persistent connections, in-memory routing |
| Message durability | Never lost once acknowledged | Persist before acknowledging the sender |
| Offline recovery | Complete, up to 30 days | Per-device cursor over a durable log |
| Ordering | Consistent per conversation on every device | Server-assigned per-conversation sequence |
| Concurrent connections | 500 million | Connection density is the sizing constraint |
| Availability | 99.99% for send | Persist path must survive a connection-tier failure |

**Out of scope:** the encryption protocol itself (assume a working key-agreement mechanism), voice and video calling, and the media CDN.

## Step 2 — Estimation

\`\`\`
Users:                 2 billion, 1.5 billion daily active
Concurrent connections: 500 million at peak
                       × 4 devices avg for active users
Messages:              100 billion/day
                       → 1 million/second average
                       → 3 million/second peak
\`\`\`

**Connection density is the number that shapes the fleet:**

\`\`\`
At 100,000 connections/server: 500e6 ÷ 1e5 = 5,000 servers
At 1,000,000 connections/server: 500 servers
\`\`\`

**A tenfold difference in fleet size from one tuning decision**, which is why connection density is worth engineering. It is dominated by per-connection memory: at 10 KB per connection, a million connections is 10 GB — feasible; at 100 KB it is 100 GB and not.

\`\`\`
Fan-out amplification:
  Assume 1-to-1 messages average 1.2 recipient devices
  Group messages: 100 billion × 15% in groups, avg 20 members × 2 devices
  → 85e9 × 1.2 + 15e9 × 40 = 102e9 + 600e9 = ~700 billion deliveries/day
  → 7 million deliveries/second average, 21 million peak
\`\`\`

**Group fan-out is 6× the direct message volume**, and that is with a 20-member average. **A 1,000-member group is 4,000 device deliveries from one send** — which the estimate identifies as the deep dive.

\`\`\`
Receipts:
  700e9 deliveries × 2 receipts (delivered + read) = 1.4 trillion/day
  → 14 million receipts/second average
\`\`\`

**Receipts are twice the message volume.** That is the estimate's most surprising output and it forces batching — a design that sends each receipt as its own message has doubled its traffic for a status indicator.

\`\`\`
Storage:
  Undelivered messages only. Assume 5% undelivered at any time,
  average message 1 KB (ciphertext + metadata)
  100e9 × 0.05 × 1 KB = 5 TB of pending messages
  × 3 replicas = 15 TB
\`\`\`

**5 TB of pending messages against 100 billion messages a day.** Deleting after delivery is what makes this a small storage problem — **permanent history would be 100 TB/day and a completely different system.**

## Step 3 — API design

**This is a protocol, not a REST API.** Over the WebSocket:

\`\`\`
Client → Server
  { t: "send",     convId, clientMsgId, ciphertextPerDevice[], mediaRef? }
  { t: "ack",      convId, upToSeq }        -- delivered, batched
  { t: "read",     convId, upToSeq }        -- read, batched
  { t: "sync",     cursors: [{convId, seq}] } -- on reconnection
  { t: "presence", state: "active"|"background" }

Server → Client
  { t: "msg",      convId, seq, senderId, ciphertext, serverTime }
  { t: "receipt",  convId, upToSeq, state: "delivered"|"read", deviceId }
  { t: "sync_resp", messages[], hasMore }
  { t: "sent",     clientMsgId, convId, seq }  -- the sender's confirmation
\`\`\`

**Five decisions worth defending.**

**\`clientMsgId\` is the idempotency key.** A client that sends and loses the connection before receiving \`sent\` retries with the same id. **The server deduplicates on it**, so a flaky connection cannot produce duplicate messages — which is the delivery-semantics lesson applied at the protocol level.

**Receipts are cumulative — \`upToSeq\`, not per message.** One acknowledgement covers everything up to a sequence number. **This is what makes 14 million receipts/second affordable:** a device catching up on 200 messages sends one ack, not 200. And it is idempotent by construction, since re-sending a lower watermark is a no-op.

**\`sync\` carries a cursor per conversation, not one global cursor.** Because ordering is per conversation, a device's position is per conversation too. **A single global cursor would be impossible to define** across independently-ordered conversations.

**The server assigns \`seq\` and returns it in \`sent\`.** The client's message has no order until the server gives it one, which is what makes ordering consistent across devices with disagreeing clocks.

**Ciphertext is per recipient device.** With end-to-end encryption the sender encrypts separately for each device, so a 1,000-member group with 2 devices each means the sender uploads 2,000 ciphertexts. **That is a client-side cost the estimate must account for**, and it is the largest practical constraint on group size.

## Step 4 — Data model

\`\`\`sql
-- Messages: append-only, partitioned by conversation
messages(
  conv_id,                    -- PARTITION KEY: hash(conv_id)
  seq BIGINT,                 -- SORT KEY: server-assigned, per conversation
  msg_id, sender_id, sender_device,
  ciphertext_ref,             -- per-device ciphertext blobs
  server_time, media_ref,
  PRIMARY KEY (conv_id, seq)
)

-- Per-device delivery position: the cursor
device_cursors(
  user_id, device_id, conv_id,  -- PARTITION KEY: hash(user_id, device_id)
  delivered_seq, read_seq, updated_at,
  PRIMARY KEY (user_id, device_id, conv_id)
)

-- Connection ownership: ephemeral, in memory
connections(                    -- Redis, not a durable store
  user_id, device_id → { server_id, connected_at, session_id }
  TTL: refreshed by heartbeat
)

conversations(conv_id, type, member_ids[], created_at)
group_members(conv_id, user_id, role, joined_at)  -- for large groups
\`\`\`

**Four decisions, and the sequence assignment is the important one.**

**\`seq\` is monotonic per conversation, and the conversation is a partition.** So assigning the next sequence is a single-partition operation — a conditional increment on the conversation's counter — with no global coordination. **A global sequence would be a hot counter at 3 million writes/second and is unnecessary**, because nobody needs cross-conversation order.

**\`device_cursors\` is partitioned by device, not by conversation.** The dominant query is "what has this device not received, across all its conversations" — a sync on reconnection. Partitioning by device makes that single-partition.

*The cost:* updating a cursor and reading messages touch different partitions, so they cannot be one transaction. **That is acceptable because cursors are advanced by cumulative watermarks and re-delivering a message is harmless.**

**Connection ownership is in Redis with a TTL, deliberately not durable.** It is ephemeral state that is wrong within seconds of any change, so durability would be a cost with no benefit. **The TTL refreshed by heartbeat is what garbage-collects dead entries** — a server that crashes stops refreshing, and its connections expire.

**Message rows are deleted once \`delivered_seq\` has advanced past them on every member device**, which is what keeps pending storage at 5 TB.

## Step 5 — Architecture

\`\`\`
Client (4 devices)
    │ WebSocket
    ▼
┌─────────── CONNECTION TIER (5,000 servers) ───────────┐
│  · terminates WebSockets, ~100k–1M per server          │
│  · registers ownership in Redis, heartbeats it         │
│  · pushes messages down sockets                        │
└──────┬───────────────────────────────┬─────────────────┘
       │ (send)                        │ (deliver)
       ▼                               ▲
┌── MESSAGE SERVICE ──┐                │
│  · dedup on clientMsgId              │
│  · assign per-conv seq               │
│  · persist to messages               │
│  · ack the sender                    │
│  · enqueue fan-out ──────────────────┤
└──────┬──────────────┘                │
       ▼                               │
┌── FAN-OUT WORKERS ──┐                │
│  · expand members → devices          │
│  · look up connection owner ─────────┘
│  · push, or leave for sync
└──────────────────────┘
       │
       ▼
┌── PRESENCE SERVICE ──┐   ┌── RECEIPT SERVICE ──┐
│  in-memory, gossiped  │   │  batched, cumulative │
└───────────────────────┘   └──────────────────────┘
\`\`\`

**Why the connection tier is separate from the message service.** The connection tier is sized by *concurrent connections* (500 million) and the message service by *message rate* (3 million/second). Those are different scaling dimensions, and a combined tier would be sized by the larger of two unrelated numbers.

**Why fan-out is a worker pool rather than inline.** A 1,000-member group send would otherwise block the sender's request for 4,000 lookups and pushes. **Acknowledging the sender after persistence and fanning out asynchronously is what keeps send latency at p99 500 ms** regardless of group size.

**Why presence is separate and in-memory.** It changes far more often than messages and is worthless if stale, so durability would be pure cost — and losing it on a restart is fine because clients re-announce.

## Step 6 — The deep dive: connection ownership and its staleness

**The core problem:** 500 million connections across 5,000 servers, churning constantly, and every delivery needs to find one.

**The mapping:** \`conn:{user_id}:{device_id} → { server_id, session_id }\` in Redis, with a 90-second TTL refreshed every 30 seconds by the owning server.

**Write rate:** churn at ~5%/minute is 400,000 writes/second; heartbeat refreshes are \`500e6 ÷ 30 ≈ 17 million/second\`. **The heartbeats dominate by 40×**, so a server must refresh all its connections in one batched command per interval rather than one per connection — turning 17 million writes/second into 5,000.

**Now the staleness problem, which is the actual deep dive.**

A fan-out worker reads "user 8891, device 2 → server 47" and pushes to server 47. Three things can be true by then:

\`\`\`
(a) Server 47 still owns it        → push succeeds
(b) The connection moved to 82     → server 47 has no such connection
(c) Server 47 is dead              → the push fails or times out
\`\`\`

**Cases (b) and (c) must not lose the message**, and the resolution is that they do not need to do anything special:

\`\`\`
Fan-out worker:
  1. Look up the owner. If absent → done (device is offline; it will sync).
  2. Push to the owning server.
  3. Server has no such connection → respond "not mine".
  4. Worker re-reads the mapping ONCE. If changed, push to the new owner.
     If unchanged or still absent → done.
\`\`\`

**Step 4's single retry is deliberate and bounded.** Chasing a moving connection indefinitely is unbounded work for a device that is clearly unstable. **One retry catches the common case — a connection that moved a moment ago — and everything else falls through to the sync path.**

**And that is safe precisely because the message is already persisted.** Failing to deliver over the socket is not an error; it is the same situation as the device being offline, and the same mechanism handles it. **The durable store plus the cursor is what makes the routing allowed to be unreliable.**

**The session id is what prevents a subtle duplicate-delivery bug.** A device that reconnects to the same server gets a new session id. Without it, a stale push could be delivered on the new connection — which the client would already have received via sync, producing a duplicate. **The server compares the session id and drops mismatches.**

**Reconnection, which is the client half:**

\`\`\`
1. Reconnect, authenticate.
2. Send { t: "sync", cursors: [{convId, seq}, ...] } for every
   conversation the client knows about.
3. Server returns messages after each cursor, paginated.
4. Client applies in order per conversation, advances cursors,
   sends one cumulative ack per conversation.
\`\`\`

**Two problems this must handle.** A client cannot send a cursor for a conversation it does not know exists, so the request also carries a **conversation-list cursor** — without it, a user added to a group while offline never learns of it. And a client with thousands of conversations sends cursors only for those with pending messages, learned from a lightweight "which conversations have news" call.

**Group fan-out, and the two regimes:**

\`\`\`
Small groups (< 50 members): fan out on write.
  One send → up to 200 device deliveries. Worker handles it inline.

Large groups (50–1,000): fan out on write, chunked.
  1,000 members × 2 devices = 2,000 deliveries.
  Chunked into batches of 100 with a cursor, so tasks are bounded
  and resumable — the notification lesson's mechanism.
\`\`\`

**Why not fan-out on read for large groups.** The feed lesson's alternative does not apply, because **a message must be pushed to be timely** — there is no read-time merge for a notification that must arrive in 500 ms. So fan-out on write it is, chunked and rate-limited.

**And the end-to-end encryption cost, which bounds group size in practice.** The sender must encrypt separately for each recipient device: 2,000 ciphertexts for a 1,000-member group. **That is client-side CPU and upload bandwidth on a phone**, and it is why group sizes have hard limits in E2EE messengers while unencrypted group chats can be far larger.

## Step 7 — What breaks at 10×

**5 billion concurrent connections, 30 million messages/second.**

**The connection mapping becomes the bottleneck** — 170 million heartbeat refreshes per second even batched. *Fix:* partition it across many Redis clusters, and more effectively **make ownership derivable rather than looked up.** If clients connect via a consistent hash of their user id to a server group, the sender computes a small candidate set and skips the lookup entirely for the common case — **converting a lookup into a computation**, which is the Maglev lesson's principle.

**Receipt volume dominates** at 140 million per second. *Fix:* aggregate group receipts and lengthen the batching window. **Receipts are a status indicator, so seconds of delay buy an order of magnitude.**

**Fan-out is embarrassingly parallel** and partitions cleanly by conversation, so it scales horizontally — the constraint becomes the mapping lookups above.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Connection server crashes | ~1 M connections dropped | Clients reconnect with backoff and jitter; sync recovers everything |
| Redis connection map down | Ownership unknown | **Fail to the sync path**: persist and acknowledge, deliver nothing live. Messages arrive on the client's next poll |
| Message service down | Sends fail | Sender sees "sending"; client retries with the same \`clientMsgId\` |
| Fan-out workers backed up | Delivery delayed | Messages persisted; delivered when workers catch up. **Sender still sees "sent"** |
| Stale mapping | Push to the wrong server | One retry, then fall through to sync. No loss |
| Device offline 40 days | Beyond retention | Messages deleted; the client is told its cursor is too old |
| Thundering reconnect after a crash | 1 M simultaneous reconnects | Backoff with jitter, plus server-side admission control |

**Three rows carry the content.**

**Redis being down degrades to the sync path rather than failing sends.** Because the store is authoritative, losing the routing layer costs *latency*, not *messages* — which is the payoff for persisting first.

**The sender still sees "sent" when fan-out is backed up**, because "sent" means persisted. Conflating "sent" with "delivered" would make the sender's UI depend on the recipient's connectivity.

**The thundering reconnect is the incident that a connection tier actually has.** A server holding a million connections crashes, and a million clients reconnect at once. **Backoff with jitter is mandatory** — without it the reconnect storm takes down the servers that absorbed them, which is the retries lesson's synchronised-retry failure at connection scale.

## Step 9 — Defending it

**"I made the durable store authoritative and the connection an optimisation.** Every message is persisted and sequenced before the sender is acknowledged, and delivery over a socket is best-effort. That is what lets the routing layer be unreliable — a stale mapping, a dead server or an offline device are all the same case, handled by the client's cursor.

**I assigned order per conversation on the server**, not globally and not from client timestamps. A global sequence would be a hot counter for a guarantee nobody needs, and client timestamps show messages out of order whenever a phone's clock is wrong.

**I made receipts cumulative watermarks rather than per-message acknowledgements.** The estimate said receipts are twice the message volume, so per-message receipts would have doubled the system's traffic for a status indicator — and cumulative watermarks are idempotent for free.

**I kept connection ownership ephemeral in Redis with batched heartbeats**, because it is wrong within seconds and durability would be cost without benefit. Heartbeats dominate the write rate 40-fold, so batching per server rather than per connection is what makes it feasible.

**What I gave up:** end-to-end encryption removes server-side search, server-side media processing and content-based features, and it makes the sender encrypt per recipient device — which is what bounds group size. Deleting messages after delivery means no server-side history, so a new device cannot see old conversations. And presence is best-effort and can be stale.

**What would make me revisit it:** if server-side message history were required, storage goes from 5 TB of pending messages to 100 TB/day and the design becomes a different system. And if groups needed to be unbounded — broadcast channels with millions of members — fan-out on write stops working and it becomes a feed problem with pull semantics."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'send-path',
      title: 'Persist first, deliver opportunistically',
      caption:
        'Step through it. The acknowledgement to the sender happens after persistence and before any delivery attempt — which is what makes every routing failure equivalent to the device simply being offline.',
      nodes: [
        { id: 'sender', label: 'Sender device', kind: 'client', x: 0, y: 200, detail: 'Sends with a clientMsgId as the idempotency key, plus one ciphertext per recipient device — 2,000 of them for a 1,000-member E2EE group.' },
        { id: 'msg', label: 'Message service', kind: 'service', x: 180, y: 200, detail: 'Deduplicates on clientMsgId, assigns the next per-conversation seq, persists, and acknowledges. The sender sees "sent" at this point — before any delivery is attempted.' },
        { id: 'store', label: 'messages (by conv_id, seq)', kind: 'store', x: 380, y: 90, detail: 'Append-only, partitioned by conversation so the sequence assignment is a single-partition conditional increment. A global sequence would be a hot counter for a guarantee nobody needs.' },
        { id: 'fanout', label: 'Fan-out workers', kind: 'service', x: 380, y: 290, detail: 'Asynchronous, so a 1,000-member group does not block the sender. Chunked with a cursor for large groups so tasks are bounded and resumable.' },
        { id: 'redis', label: 'Redis: conn ownership', kind: 'store', x: 580, y: 380, detail: 'Ephemeral with a 90 s TTL, refreshed in one batched command per server. Heartbeats dominate the write rate 40-fold, which is why per-connection refreshes are infeasible.' },
        { id: 'conn', label: 'Connection server 47', kind: 'service', x: 580, y: 250, detail: 'Holds ~1 M WebSockets. Compares the session id and drops a mismatch, which prevents a stale push being delivered on a reconnected socket as a duplicate.' },
        { id: 'stale', label: 'Not mine → one retry', kind: 'note', x: 780, y: 350, detail: 'The connection moved. Re-read the mapping once and push to the new owner; otherwise stop. Chasing a moving connection indefinitely is unbounded work for an unstable device.' },
        { id: 'recip', label: 'Recipient device', kind: 'client', x: 780, y: 200, detail: 'Receives the push, or receives nothing and fetches it on reconnection via its per-conversation cursor. Both paths are normal.' },
        { id: 'sync', label: 'sync: cursors per conversation', kind: 'service', x: 780, y: 90, detail: 'The reliability mechanism. Also carries a conversation-list cursor, without which a user added to a group while offline never learns of it.' },
      ],
      edges: [
        { id: 'w1', source: 'sender', target: 'msg', kind: 'sync' },
        { id: 'w2', source: 'msg', target: 'store', kind: 'write' },
        { id: 'w3', source: 'msg', target: 'fanout', kind: 'async' },
        { id: 'w4', source: 'fanout', target: 'redis', kind: 'read' },
        { id: 'w5', source: 'fanout', target: 'conn', kind: 'sync' },
        { id: 'w6', source: 'conn', target: 'recip', kind: 'sync' },
        { id: 'w7', source: 'conn', target: 'stale', kind: 'control' },
        { id: 'w8', source: 'recip', target: 'sync', kind: 'sync' },
        { id: 'w9', source: 'sync', target: 'store', kind: 'read' },
      ],
      steps: [
        {
          id: 'wp1',
          title: 'Persist and sequence before acknowledging',
          description:
            'Deduplicate on clientMsgId, assign the next per-conversation sequence, write, then tell the sender "sent". The sender\'s status now depends only on our durability, not on the recipient\'s connectivity.',
          nodes: ['sender', 'msg', 'store'],
          edges: ['w1', 'w2'],
        },
        {
          id: 'wp2',
          title: 'Fan out asynchronously',
          description:
            'A 1,000-member group is 2,000 device deliveries. Doing that inline would make send latency proportional to group size, so it happens after the acknowledgement, chunked and resumable.',
          nodes: ['fanout'],
          edges: ['w3'],
        },
        {
          id: 'wp3',
          title: 'Look up the owner, knowing the answer may be stale',
          description:
            'Redis holds ownership with a heartbeat-refreshed TTL. Connections churn constantly, so the mapping is frequently wrong by the time it is used — and the design assumes that rather than preventing it.',
          nodes: ['redis', 'conn'],
          edges: ['w4', 'w5'],
        },
        {
          id: 'wp4',
          title: 'A stale mapping costs one retry, then nothing',
          description:
            'Re-read once and push to the new owner; otherwise stop. Safe because the message is already stored, so a failed push is indistinguishable from the device being offline.',
          nodes: ['stale'],
          edges: ['w7'],
        },
        {
          id: 'wp5',
          title: 'The cursor is what makes it reliable',
          description:
            'On reconnection the device asks for everything after its per-conversation cursor. The socket is an optimisation; this is the mechanism that guarantees nothing is lost.',
          nodes: ['recip', 'sync'],
          edges: ['w6', 'w8', 'w9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'receipts',
      title: 'Why receipts must be cumulative watermarks',
      caption:
        'Read the arithmetic. Receipts are twice the message volume, so per-message acknowledgement doubles the system\'s traffic for a status indicator — and cumulative watermarks are idempotent for free.',
      code: `flowchart TB
    M["700 billion device<br/>deliveries/day"]
    M --> R["Each generates a<br/>'delivered' and a 'read'<br/>= 1.4 trillion receipts/day"]
    R --> R2["**14 million receipts/second** —<br/>twice the message rate"]

    R2 --> PER["**Per-message receipts**<br/>one ack per message"]
    PER --> PER2["A device catching up on 200<br/>messages sends 200 acks.<br/>Doubles system traffic.<br/>Needs its own dedup"]

    R2 --> CUM["**Cumulative watermark**<br/>{ convId, upToSeq }"]
    CUM --> CUM2["A device catching up on 200<br/>messages sends ONE ack.<br/>Idempotent by construction —<br/>a lower watermark is a no-op"]

    CUM2 --> G["**And for groups: aggregate.**<br/>'delivered to 47 of 50'<br/>rather than 50 receipts"]
    G --> G2["Receipts are a status indicator,<br/>so seconds of batching delay<br/>is acceptable and buys an<br/>order of magnitude"]

    style PER2 fill:#2a1a1a,stroke:#a04848
    style CUM2 fill:#17272a,stroke:#35897e
    style G2 fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['whatsapp'],
    body: `WhatsApp's published engineering figures are the most useful reference here, because one number reframes the whole problem.

**Millions of concurrent connections per server.** The reported figures — over two million TCP connections on a single machine — are the reason connection ownership is tractable. At 100,000 connections per server, 500 million connections is a 5,000-server fleet; at a million, it is 500. **A tenfold fleet difference from one engineering property**, and it is why per-connection memory footprint was worth extreme optimisation.

**The consequence for this design:** connection density is not a detail, it is the sizing constraint. And it is dominated by per-connection memory — buffers, TLS state, framing state. **10 KB per connection makes a million feasible; 100 KB does not.**

**A small team relative to the user count**, which the published material attributes partly to a deliberately narrow feature set. **The design consequence is visible in this lesson's requirements:** no server-side history, no server-side search, bounded group sizes. Each of those omissions removes a system.

**End-to-end encryption and what it forecloses.** Once the server cannot read content, several things become impossible rather than merely difficult: server-side search, server-side media transcoding, content-based spam filtering, and server-side group fan-out of a single ciphertext. **The sender must encrypt per recipient device**, which is why E2EE messengers have hard group-size limits while unencrypted group chats can have millions of members.

**Three transferable lessons.**

**Connection density is a first-order design parameter.** It determines fleet size, and therefore the difficulty of every problem that scales with server count — including the connection-ownership mapping this lesson spends its deep dive on.

**Feature omissions are architectural decisions.** "No server-side history" is what keeps pending storage at 5 TB rather than 100 TB/day. A candidate who adds permanent history without noting that it changes the storage tier by four orders of magnitude has not costed the feature.

**Encryption is not a layer added at the end.** It determines what the server can do, which determines what the architecture can contain. **Deciding E2EE late means discovering that several planned features are impossible.**

**Where the reference does not help.** The connection-ownership mechanism, the cursor protocol and the receipt aggregation are not published in detail by anyone. **They must be derived**, which is what the deep dive does — and it is worth knowing that this part of the answer cannot be recalled.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on. Rows include the arithmetic where it settles the choice.',
    rows: [
      {
        option: 'Deliver over the connection, persist afterwards',
        whenItWins:
          'Nowhere. It makes durability depend on finding the recipient.',
        whenItLoses:
          'Immediately: an offline recipient has no defined path, and a crash between receive and write loses the message with no record.',
        cost:
          'Systematic message loss, and no answer for the offline case.',
      },
      {
        option: 'Persist and sequence first, then deliver best-effort',
        whenItWins:
          'Always. A stale mapping, a dead server and an offline device all become the same handled case.',
        whenItLoses:
          'Never, though it means the sender\'s "sent" status says nothing about delivery.',
        cost:
          'A write before every acknowledgement, and a separate receipt mechanism for delivery status.',
      },
      {
        option: 'Global message sequence',
        whenItWins:
          'Nowhere. Nobody needs cross-conversation ordering.',
        whenItLoses:
          'At 3 million messages/second it is a single hot counter and a coordination bottleneck.',
        cost:
          'A global serialisation point for a guarantee with no consumer.',
      },
      {
        option: 'Per-conversation server-assigned sequence',
        whenItWins:
          'Always. A single-partition conditional increment, and consistent order on every device regardless of clock skew.',
        whenItLoses:
          'When cross-conversation order matters, which it does not.',
        cost:
          'Per-conversation cursors rather than one global cursor.',
      },
      {
        option: 'Client-timestamp ordering',
        whenItWins:
          'Nowhere. Device clocks disagree.',
        whenItLoses:
          'Whenever a phone\'s clock is wrong — messages appear out of order, or in the future.',
        cost:
          'Visibly wrong ordering, with no server-side way to correct it.',
      },
      {
        option: 'Per-message delivery receipts',
        whenItWins:
          'Nowhere at this scale.',
        whenItLoses:
          'Receipts are twice the message volume, so per-message acknowledgement doubles system traffic for a status indicator.',
        cost:
          'Doubled traffic, plus its own deduplication problem.',
      },
      {
        option: 'Cumulative receipt watermarks, aggregated for groups',
        whenItWins:
          'Always. One ack covers 200 messages, it is idempotent by construction, and group aggregation cuts another order of magnitude.',
        whenItLoses:
          'When per-message read status per member is a product requirement.',
        cost:
          'Coarser status information, and seconds of batching delay.',
      },
      {
        option: 'Durable connection-ownership mapping',
        whenItWins:
          'Nowhere. The mapping is wrong within seconds of any change.',
        whenItLoses:
          'It costs write amplification and durability guarantees for state that is inherently ephemeral.',
        cost:
          'Durability cost with no benefit, and a dead server\'s entries persisting.',
      },
      {
        option: 'Ephemeral mapping with heartbeat TTL, batched per server',
        whenItWins:
          'Always. Heartbeats dominate the write rate 40-fold, so batching per server rather than per connection is what makes it feasible.',
        whenItLoses:
          'When it is unavailable — but then the design degrades to the sync path rather than failing.',
        cost:
          'Up to a TTL of stale entries after a server dies.',
      },
      {
        option: 'Fan-out on read for large groups',
        whenItWins:
          'Nowhere in messaging. A message must be pushed to be timely.',
        whenItLoses:
          'There is no read-time merge for something that must arrive in 500 ms.',
        cost:
          'Unacceptable latency for the product\'s core interaction.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The sender\'s server looks up the recipient\'s connection server and forwards the message to it, which writes it and pushes it."',
      whyWeak:
        'It makes durability depend on routing. If the mapping is stale the message reaches a server with no such connection and is dropped; if the recipient is offline there is no defined path at all. And a crash between receiving and writing loses the message with no record.',
      strongAnswer:
        '"Persist first, then deliver best-effort. The sender\'s server deduplicates on the client message id, assigns the next per-conversation sequence, writes it, and acknowledges the sender — all before any delivery attempt. Then a stale mapping, a dead server and an offline device are the same case: nothing more to do, because the message is stored and the device will fetch it via its cursor on reconnection."',
    },
    {
      weakAnswer: '"Messages are ordered by their timestamp so all devices see the same order."',
      whyWeak:
        'Which timestamp? A client timestamp is unreliable — device clocks disagree, so messages appear out of order or in the future. A server timestamp is better and still not an order: two messages assigned the same millisecond have no defined relative position, and clock skew between servers reintroduces the problem.',
      strongAnswer:
        '"The server assigns a monotonic sequence number per conversation, and the conversation is a partition — so it is a single-partition conditional increment with no global coordination. That gives a total order within a conversation that every device agrees on regardless of clock skew. There is no global order across conversations, and nobody needs one, so a global counter would be a hot spot for no benefit."',
    },
    {
      weakAnswer: '"Each device acknowledges each message it receives so the sender sees delivery status."',
      whyWeak:
        'The estimate makes this untenable: 700 billion deliveries a day generate 1.4 trillion receipts, twice the message volume. Per-message acknowledgement doubles the system\'s traffic for a status indicator, and each receipt then needs its own deduplication.',
      strongAnswer:
        '"Receipts must be cumulative watermarks — `{ convId, upToSeq }` — so a device catching up on 200 messages sends one acknowledgement rather than 200. That also makes them idempotent for free, since re-sending a lower watermark is a no-op. And for groups I would aggregate: \'delivered to 47 of 50\' rather than 50 separate receipts. Receipts are a status indicator, so seconds of batching delay is acceptable and buys an order of magnitude."',
    },
    {
      weakAnswer: '"The connection mapping is stored in a replicated database so it survives failures."',
      whyWeak:
        'The mapping is wrong within seconds of any change — connections churn constantly as phones move between networks. Making inherently ephemeral state durable costs write amplification and durability guarantees for no benefit, and a crashed server\'s entries persist rather than expiring.',
      strongAnswer:
        '"Ownership is ephemeral state, so it lives in Redis with a TTL refreshed by heartbeat — a server that crashes stops refreshing and its entries expire automatically. The write rate is dominated by heartbeats 40 to one, so a server refreshes all its connections in one batched command rather than one per connection. And if the mapping is unavailable, we degrade to the sync path: persist, acknowledge, deliver nothing live. Losing the routing layer costs latency, not messages."',
    },
    {
      weakAnswer: '"On reconnection the client requests recent messages for each conversation."',
      whyWeak:
        '"Recent" is undefined, so the client either re-downloads messages it has or misses ones it does not. And a client cannot request a conversation it does not know about — a user added to a group while offline would never learn of it.',
      strongAnswer:
        '"The client sends a cursor per conversation — the last sequence it has — and the server returns everything after each, paginated. Plus a conversation-list cursor, because a client cannot ask about a conversation it does not know exists, and without that a user added to a group while offline never learns of it. To keep the request small, the client first makes one lightweight call asking which conversations have news."',
    },
    {
      weakAnswer: '"A 1,000-member group message is fanned out to all members synchronously before acknowledging the sender."',
      whyWeak:
        'That is 2,000 device deliveries — connection lookups and pushes — before the sender sees confirmation, so send latency becomes proportional to group size. And a failure partway through leaves the send in an undefined state.',
      strongAnswer:
        '"Acknowledge after persistence, then fan out asynchronously in a worker pool. For large groups, chunk it with a cursor so each task is bounded and resumable, and rate-limit the bulk pool so one large group cannot starve ordinary messages. And the real constraint on group size is end-to-end encryption: the sender must encrypt separately per recipient device, so 1,000 members with two devices each means 2,000 ciphertexts produced and uploaded by a phone."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hw-1',
      front: 'What is the actual hard problem in a messaging system?',
      back: 'Connection routing: which of 100,000 servers owns this recipient\'s socket, and what to do when that answer is already wrong. Storage is the easy part.',
      topic: 'connection-ownership',
    },
    {
      id: 'fc-hw-2',
      front: 'What inversion makes the system reliable despite unreliable connections?',
      back: 'The durable store is authoritative and the connection is an optimisation. Persist and sequence before acknowledging; delivery over a socket is best-effort.',
      topic: 'offline-queue',
    },
    {
      id: 'fc-hw-3',
      front: 'Why is a failed push not an error?',
      back: 'Because the message is already stored, so a stale mapping, a dead server and an offline device are the same case — handled by the client\'s cursor on reconnection.',
      topic: 'offline-queue',
    },
    {
      id: 'fc-hw-4',
      front: 'What is the ordering scope, and who assigns it?',
      back: 'Per conversation, assigned by the server as a monotonic sequence. Client timestamps show wrong order when clocks disagree; a global sequence is a hot counter nobody needs.',
      topic: 'ordering',
    },
    {
      id: 'fc-hw-5',
      front: 'Why is assigning a per-conversation sequence cheap?',
      back: 'The conversation is the partition key, so it is a single-partition conditional increment with no global coordination.',
      topic: 'ordering',
    },
    {
      id: 'fc-hw-6',
      front: 'Why must receipts be cumulative watermarks?',
      back: 'Receipts are twice the message volume. `{convId, upToSeq}` means a device catching up on 200 messages sends one ack, and a lower watermark is a harmless no-op.',
      topic: 'delivery-receipts',
    },
    {
      id: 'fc-hw-7',
      front: 'What are the three delivery states and their sources of truth?',
      back: 'Sent — the server persisted it. Delivered — the device must tell the server. Read — the device must tell the server. The last two are messages in the opposite direction.',
      topic: 'delivery-receipts',
    },
    {
      id: 'fc-hw-8',
      front: 'Why is connection ownership ephemeral rather than durable?',
      back: 'It is wrong within seconds of any change, so durability is cost with no benefit — and a TTL refreshed by heartbeat garbage-collects a crashed server\'s entries automatically.',
      topic: 'connection-ownership',
    },
    {
      id: 'fc-hw-9',
      front: 'Why must heartbeats be batched per server?',
      back: 'Heartbeats dominate the mapping\'s write rate 40-fold. One command per server per interval turns 17 million writes/second into 5,000.',
      topic: 'connection-ownership',
    },
    {
      id: 'fc-hw-10',
      front: 'How many retries when a push finds no connection, and why?',
      back: 'One. It catches a connection that moved a moment ago; chasing further is unbounded work for an unstable device, and the sync path handles the rest.',
      topic: 'connection-ownership',
    },
    {
      id: 'fc-hw-11',
      front: 'What does the session id prevent?',
      back: 'A stale push being delivered on a reconnected socket as a duplicate — the client would already have received it via sync. The server drops session-id mismatches.',
      topic: 'connection-ownership',
    },
    {
      id: 'fc-hw-12',
      front: 'What must a sync request carry besides per-conversation cursors?',
      back: 'A conversation-list cursor. A client cannot ask about a conversation it does not know exists, so without it a user added to a group while offline never learns of it.',
      topic: 'offline-queue',
    },
    {
      id: 'fc-hw-13',
      front: 'Why is fan-out on read unavailable for group messages?',
      back: 'A message must be pushed to arrive in 500 ms; there is no read-time merge for a real-time notification. So fan-out on write, chunked and rate-limited.',
      topic: 'group-fan-out',
    },
    {
      id: 'fc-hw-14',
      front: 'What does end-to-end encryption cost this design?',
      back: 'No server-side search, media processing or content filtering; and the sender encrypts per recipient device — 2,000 ciphertexts for a 1,000-member group, which is what bounds group size.',
      topic: 'group-fan-out',
    },
  ],

  quiz: [
    {
      id: 'q-hw-1',
      kind: 'scenario',
      prompt:
        'A fan-out worker reads "user 8891 → server 47" and pushes there, but the connection moved to server 82 a moment earlier. What should happen?',
      options: [
        { id: 'a', label: 'Server 47 responds "not mine"; the worker re-reads the mapping once and pushes to 82. If that also fails, stop — the message is stored and sync will deliver it' },
        { id: 'b', label: 'Server 47 forwards the message to server 82 directly' },
        { id: 'c', label: 'The worker retries until the push succeeds' },
        { id: 'd', label: 'The message is returned to the sender as undeliverable' },
      ],
      correct: ['a'],
      explanation:
        'One bounded retry catches the common case of a just-moved connection. Retrying indefinitely is unbounded work for an unstable device, and it is unnecessary because the durable store plus the client\'s cursor guarantees delivery. Server-to-server forwarding would require every connection server to know the mapping, adding a lookup to the wrong tier.',
      difficulty: 'core',
      topic: 'connection-ownership',
    },
    {
      id: 'q-hw-2',
      kind: 'scenario',
      prompt:
        '700 billion device deliveries per day, each generating a delivered and a read receipt. What does that imply about the receipt design?',
      options: [
        { id: 'a', label: '14 million receipts/second — twice the message rate — so receipts must be cumulative watermarks and aggregated for groups' },
        { id: 'b', label: 'Receipts are small, so per-message acknowledgement is affordable' },
        { id: 'c', label: 'Receipts should be sent only for direct messages, not groups' },
        { id: 'd', label: 'Receipts should be computed server-side without device involvement' },
      ],
      correct: ['a'],
      explanation:
        'Per-message receipts would double the system\'s traffic for a status indicator. A cumulative `{convId, upToSeq}` lets a device catching up on 200 messages send one acknowledgement, and it is idempotent by construction. Delivered and read cannot be computed server-side — only the device knows.',
      difficulty: 'advanced',
      topic: 'delivery-receipts',
    },
    {
      id: 'q-hw-3',
      kind: 'scenario',
      prompt:
        'A device has been offline for an hour. On reconnection, what does it send, and what would be missing from a naive version?',
      options: [
        { id: 'a', label: 'A cursor per conversation plus a conversation-list cursor — without the latter, a user added to a group while offline never learns of it' },
        { id: 'b', label: 'One global cursor covering all conversations' },
        { id: 'c', label: 'A request for all messages from the last hour' },
        { id: 'd', label: 'Nothing — the server pushes what it queued for that device' },
      ],
      correct: ['a'],
      explanation:
        'Ordering is per conversation, so a client\'s position is per conversation — a single global cursor cannot be defined across independently-sequenced conversations. And a client cannot request a conversation it does not know exists, which is the gap the conversation-list cursor closes.',
      difficulty: 'advanced',
      topic: 'offline-queue',
    },
    {
      id: 'q-hw-4',
      kind: 'scenario',
      prompt:
        'The Redis holding connection ownership becomes unavailable. What should the system do?',
      options: [
        { id: 'a', label: 'Continue accepting and persisting messages, acknowledging senders, and deliver nothing live — clients receive on their next sync' },
        { id: 'b', label: 'Reject sends until ownership can be resolved' },
        { id: 'c', label: 'Broadcast each message to all connection servers so whichever owns the recipient delivers it' },
        { id: 'd', label: 'Fall back to a durable copy of the mapping' },
      ],
      correct: ['a'],
      explanation:
        'Because the store is authoritative, losing the routing layer costs latency rather than messages — which is the payoff for persisting first. Rejecting sends turns a routing outage into a product outage. Broadcasting to 5,000 servers per message is 5,000× amplification, and a durable mapping would be stale anyway.',
      difficulty: 'core',
      topic: 'connection-ownership',
    },
    {
      id: 'q-hw-5',
      kind: 'scenario',
      prompt:
        'A connection server holding one million WebSockets crashes. What is the immediate risk beyond the dropped connections?',
      options: [
        { id: 'a', label: 'One million clients reconnecting simultaneously — without backoff and jitter the storm takes down the servers absorbing them' },
        { id: 'b', label: 'One million messages lost, since they were in the server\'s memory' },
        { id: 'c', label: 'The connection mapping becomes permanently inconsistent' },
        { id: 'd', label: 'Receipts for those devices are lost permanently' },
      ],
      correct: ['a'],
      explanation:
        'This is the synchronised-retry failure at connection scale: a million clients failing at the same moment retry at the same moment. Messages are not lost because they were persisted before delivery, the mapping self-heals when the crashed server stops heartbeating, and receipts are cumulative so they are re-sent on reconnection.',
      difficulty: 'core',
      topic: 'offline-queue',
    },
    {
      id: 'q-hw-6',
      kind: 'multi',
      prompt:
        'Which does end-to-end encryption make impossible or much harder in this design? Select all that apply.',
      options: [
        { id: 'a', label: 'Server-side message search' },
        { id: 'b', label: 'Server-side media transcoding' },
        { id: 'c', label: 'Fanning out one ciphertext to all group members' },
        { id: 'd', label: 'Per-device delivery receipts' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three all require reading content. In particular the sender must encrypt separately per recipient device, so a 1,000-member group means 2,000 ciphertexts produced on a phone — which is what bounds group size in practice. Receipts carry only sequence numbers and identifiers, so they are unaffected.',
      difficulty: 'core',
      topic: 'group-fan-out',
    },
  ],

  exercises: [
    {
      id: 'ex-hw-1',
      kind: 'design',
      title: 'Specify the protocol against the cases that lose messages',
      estimatedMinutes: 40,
      prompt: `Specify the exact protocol behaviour for these eight cases. For each, say what the client does, what the server does, and what the user sees.

1. A sender loses its connection after sending but before receiving the "sent" confirmation.
2. A recipient's device receives a message, shows it, then the app is killed before acknowledging.
3. Two of a user's four devices are online; two have been offline for a week.
4. A user is added to a group while all their devices are offline.
5. A message is pushed to server 47; the device reconnects to server 47 with a new session while the push is in flight.
6. A group of 500 members receives a message; 30 members' devices are offline.
7. A user reads 200 messages in one conversation while offline, then reconnects.
8. A device's cursor is older than the 30-day retention window.

Then answer:

- Which two cases can produce a duplicate, and what prevents it?
- Which case reveals a gap that per-conversation cursors alone cannot close?
- What single addition would let a sender distinguish "not delivered yet" from "will never be delivered"?`,
      rubric: [
        'Case 1 uses clientMsgId deduplication with the retry returning the original sequence.',
        'Case 2 identifies at-least-once delivery and the cumulative watermark making re-delivery harmless.',
        'Case 3 treats each device independently with its own cursors.',
        'Case 4 requires the conversation-list cursor.',
        'Case 5 uses the session id to drop the stale push.',
        'Case 6 distinguishes per-device delivery from aggregated group receipts.',
        'Case 7 sends one cumulative read watermark rather than 200 receipts.',
        'Case 8 defines an explicit "cursor too old" response and its consequence.',
        'Names cases 1 and 5 (or 2) as the duplicate risks with their specific guards.',
        'Identifies case 4 as the gap and case 8 as needing a designed path.',
      ],
      modelAnswer: `**1. Sender loses connection before receiving "sent"**

\`\`\`
Client:  sent { clientMsgId: "c-9f2a", convId, ciphertexts }
         connection drops before { t: "sent" } arrives
         → message stays in local "sending" state
         → on reconnect, RE-SENDS with the SAME clientMsgId
Server:  first attempt persisted it as seq 4471
         second attempt: dedup on (senderId, clientMsgId) hits
         → returns { t: "sent", clientMsgId: "c-9f2a", seq: 4471 }
         WITHOUT creating a second message
\`\`\`

**The user sees** the message move from "sending" to "sent" a moment after reconnecting. No duplicate.

*The load-bearing detail:* the deduplication record must return the **original sequence number**, not just "already seen". If it returned only success, the client would not know the message's position and could not place it correctly in the conversation. **The dedup record therefore stores the assigned seq**, which makes the retry fully idempotent rather than merely harmless.

*Retention:* the dedup record needs a TTL long enough to cover any plausible retry — 24 hours is generous — and it is keyed \`(sender_id, client_msg_id)\` so it is partitioned with the sender.

**2. Device receives and displays a message, then is killed before acknowledging**

\`\`\`
Server:  pushed seq 4471; no ack received
         device_cursors.delivered_seq remains 4470
Client:  message is in local storage and displayed
         on reconnect, sends sync with cursor 4470
Server:  returns messages 4471 onward — INCLUDING 4471
Client:  already has 4471 (by msg_id) → discards the duplicate,
         advances its cursor, sends ack { upToSeq: 4471+ }
\`\`\`

**The user sees nothing.** The re-delivery is invisible because the client deduplicates locally on message id.

**This is at-least-once delivery, deliberately.** The alternative — acknowledging before displaying — would be at-most-once and could lose a message on a crash in the same window. **Re-delivering a message the client already has costs nothing; losing one is unacceptable**, so the direction of the trade is forced.

*And the cumulative watermark makes it clean:* the client's ack after catching up covers everything, so there is no per-message bookkeeping to reconcile.

**3. Two devices online, two offline for a week**

**Each device is independent.** There is no user-level delivery state:

\`\`\`
device_cursors:
  (user, dev1, conv) delivered_seq = 4471, read_seq = 4471
  (user, dev2, conv) delivered_seq = 4471, read_seq = 4200
  (user, dev3, conv) delivered_seq = 3100   ← offline a week
  (user, dev4, conv) delivered_seq = 3100
\`\`\`

Fan-out attempts delivery to all four; two succeed, two find no connection and stop. **Messages 3101–4471 remain stored** because not every device has them.

**When dev3 reconnects**, it syncs from 3100 and receives ~1,300 messages, paginated. **The retention rule is what matters here:** a message is deletable only when \`delivered_seq >= seq\` for *every* member device. **So one long-offline device pins storage for the whole conversation**, which is why the 30-day cap exists.

*What the sender sees:* delivery status is aggregated. "Delivered" means delivered to at least one device; a per-device breakdown is available but not the default, because **users think in people, not devices.**

**4. Added to a group while all devices are offline**

**This is the case per-conversation cursors cannot handle**, because the client has no cursor for a conversation it does not know exists.

\`\`\`
Client sync request:
  { t: "sync",
    convCursor: 88213,              ← the conversation-list cursor
    cursors: [ {convId: A, seq: ...}, {convId: B, seq: ...} ] }

Server:
  1. Reads the conversation-membership log after convCursor 88213
     → "user added to conv C at membership-seq 88240"
  2. Returns { newConversations: [ { convId: C, metadata,
                                     firstVisibleSeq: 501 } ],
               convCursor: 88240 }
  3. Client creates conv C locally with cursor 500 and syncs it
\`\`\`

**Two design points.** The conversation-list cursor is a **second, independent log** of membership changes, partitioned by user — because membership events are not messages and have their own ordering.

And \`firstVisibleSeq\` answers a product question: **does a new member see history?** Setting it to the join point means no, which is the E2EE-consistent answer since the new member has no keys for earlier messages. **The encryption model forces the product behaviour**, which is worth naming.

**5. Push in flight while the device reconnects to the same server**

\`\`\`
t=0  Device connected to server 47, session S1
t=1  Fan-out worker reads mapping → server 47, pushes seq 4471
t=2  Connection drops; device reconnects to server 47, session S2
t=3  The push arrives, addressed to (user, dev, session S1)
     Server 47 compares: current session is S2 ≠ S1 → DROP
t=4  Device syncs from its cursor and receives 4471 normally
\`\`\`

**Without the session id, server 47 would see a live connection for that device and deliver.** The device would then also receive 4471 via sync, producing a duplicate — harmless because of local msg_id deduplication, but it wastes bandwidth and, worse, **could deliver a message the client has not yet placed in order**, showing it out of sequence momentarily.

**The session id is cheap and removes an entire class of ordering artefact.** It is generated at connection setup and included in the mapping.

**6. Group of 500; 30 members' devices offline**

\`\`\`
Fan-out: 500 members × ~2 devices = ~1,000 device deliveries
  ~940 succeed (pushed)
  ~60 find no connection → nothing to do, stored
\`\`\`

**Chunked in batches of 100 with a cursor**, so the task is bounded and a crash resumes.

**Receipts, and this is where aggregation matters.** 940 devices each send a cumulative delivered watermark. Naively the sender receives 940 receipt messages.

\`\`\`
Receipt service:
  · collects per-device watermarks for (conv, seq)
  · aggregates to member level (a member is "delivered" when
    ANY of their devices is)
  · batches over ~3 s
  · sends the sender ONE update: { convId, upToSeq, deliveredTo: 470, of: 500 }
  · updates incrementally as offline members catch up
\`\`\`

**The sender's UI shows a count, not 500 ticks.** And the aggregation is what makes 14 million receipts/second affordable — **without it, a single group message generates 1,000 upstream messages.**

*The product decision inside this:* for large groups, read receipts are often disabled or reduced to a count, because "who has read this" for 500 people is both a privacy question and a traffic problem.

**7. Reading 200 messages offline, then reconnecting**

\`\`\`
Client (offline): user scrolls through 200 messages
                  local read_seq advances to 4471
                  NO individual receipts are queued
Client (reconnect): sends ONE { t: "read", convId, upToSeq: 4471 }
Server:             updates device_cursors.read_seq = 4471
                    notifies the sender: read up to 4471
\`\`\`

**One message instead of 200.** This is the cumulative watermark's whole point, and the offline case is where it is most visible.

*And it is idempotent:* if the read message is sent twice, or a lower watermark arrives late out of order, the server takes the maximum and ignores regressions. **A watermark that only moves forward needs no deduplication at all.**

**8. Cursor older than the 30-day retention window**

\`\`\`
Client:  sync with cursor 1200; conversation's oldest retained seq is 3050
Server:  { t: "sync_resp", error: "cursor_expired",
           oldestAvailableSeq: 3050, latestSeq: 4471 }
Client:  1. Records a gap marker in the conversation:
            "Messages from [date range] are unavailable"
         2. Sets its cursor to 3049 and syncs from there
         3. Displays the gap to the user
\`\`\`

**This must be a designed response, not an error.** A client that treats it as a failure either retries forever or shows an empty conversation.

**And the user must be told.** A silent gap is worse than a visible one — a user who scrolls up and sees messages jump from one date to another with no explanation assumes the app lost their data. **A gap marker is honest and it is the only option**, because the messages genuinely no longer exist.

*The alternative the design rejected:* permanent server-side history, which would make this case impossible and would take storage from 5 TB of pending messages to 100 TB/day. **The gap marker is the visible cost of that decision.**

---

**Which two cases can produce a duplicate, and what prevents it?**

**Case 1 (sender retry) and case 5 (stale push to a reconnected session)** — and they need different guards because the duplicate originates at different ends.

**Case 1 is a duplicate *creation*.** The sender retries and could create a second message with a second sequence number, which would appear twice in the conversation for everyone. **Guard: server-side deduplication on \`(sender_id, client_msg_id)\`, returning the original sequence.** This is the only one of the two that could produce a genuinely duplicated message.

**Case 5 is a duplicate *delivery*.** One message, delivered twice to one device. **Guards, in layers:** the session-id comparison drops the stale push at the server; and client-side deduplication on \`msg_id\` catches anything that gets through. **Two layers because the first is an optimisation and the second is the guarantee.**

**Case 2 is also a duplicate delivery** and is deliberately unguarded at the server — re-delivery after a missing acknowledgement is the correct behaviour of at-least-once, and the client's local deduplication handles it. **So three cases produce duplicate deliveries and only one produces a duplicate message**, which is the distinction that matters: the first class is harmless by design, the second would be a visible bug.

**Which case reveals a gap that per-conversation cursors alone cannot close?**

**Case 4 — added to a group while offline.**

The cursor protocol is complete *given a set of conversations*, and it has nothing to say about how that set changes. **A client cannot ask about a conversation it does not know exists**, so no number of per-conversation cursors closes this.

The fix is a **second cursor over a different log**: a per-user membership-change log with its own sequence. And the general principle is worth extracting: **any cursor protocol needs a cursor over the set of things being cursored.** The same gap appears in the file-sync design — a client needs a cursor over the change log *and* a way to learn about newly-shared folders.

*Case 8 is the runner-up*, and it is different in kind: it is not a gap in the protocol but a **boundary** of it, requiring a designed response rather than an additional mechanism.

**What single addition lets a sender distinguish "not delivered yet" from "will never be delivered"?**

**A per-recipient delivery deadline, surfaced as a terminal state.**

Currently a sender sees "sent" and then, eventually, "delivered". If a recipient never comes online, the sender waits indefinitely with no distinction between "their phone is off" and "their account was deleted" or "they left the group" or "the message expired".

**The addition:**

\`\`\`
messages.expires_at = server_time + retention_window

Receipt service, per (message, recipient):
  · delivered           → "delivered"
  · not delivered and now() > expires_at
                        → "expired" (terminal)
  · recipient no longer a member / account deleted
                        → "undeliverable" (terminal)
\`\`\`

**Three properties this needs to be useful.**

**It must be terminal.** The sender's UI can stop waiting, which is the entire point. A state that might still change is not an answer.

**It must distinguish the reasons**, because "their phone has been off for a month" and "this account no longer exists" call for different user actions.

**It must be pushed, not polled.** The sender learns when the state becomes terminal, which means the expiry sweep generates receipts — **a background job producing upstream traffic**, and its rate is bounded by the undelivered message count rather than by message volume, so it is cheap.

*Why this is a single addition rather than several:* the mechanism already exists. Receipts are cumulative watermarks flowing back to senders, and this adds two more terminal values to the same channel. **The expiry timestamp is already needed for the retention sweep**, so the only new work is emitting a receipt when the sweep deletes an undelivered message.

*And the product consequence:* users get "not delivered" with a reason rather than an indefinite single tick, which is a meaningful improvement for a cost that is almost entirely already paid.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hw-1',
      level: 'basic',
      question: 'Design WhatsApp. What is the hard part?',
      guidance:
        'Connection routing, not storage — which of many servers holds this recipient\'s socket, and what to do when that answer is stale. A strong answer establishes the persist-first inversion early.',
    },
    {
      id: 'iq-hw-2',
      level: 'basic',
      question: 'How are messages ordered?',
      guidance:
        'A server-assigned monotonic sequence per conversation. Look for the rejection of client timestamps and of a global sequence, with reasons for both.',
    },
    {
      id: 'iq-hw-3',
      level: 'intermediate',
      question: 'How does a device that has been offline for a week catch up?',
      guidance:
        'A cursor per conversation plus a conversation-list cursor. A strong answer names the gap the second cursor closes — a user added to a group while offline.',
    },
    {
      id: 'iq-hw-4',
      level: 'intermediate',
      question: 'How do you track which server holds a user\'s connection?',
      guidance:
        'Ephemeral state in Redis with a heartbeat-refreshed TTL, batched per server. Look for the recognition that the mapping is frequently stale and that the design assumes it rather than preventing it.',
    },
    {
      id: 'iq-hw-5',
      level: 'advanced',
      question: 'What is the traffic cost of delivery receipts?',
      guidance:
        'Roughly twice the message volume. Excellent answers derive it, then propose cumulative watermarks plus group aggregation, noting that watermarks are idempotent for free.',
    },
    {
      id: 'iq-hw-6',
      level: 'advanced',
      question: 'A connection server holding a million sockets crashes. Walk me through it.',
      guidance:
        'No messages lost (persisted first), the mapping self-heals via heartbeat expiry, and the real risk is a synchronised reconnect storm — requiring backoff with jitter plus admission control.',
    },
    {
      id: 'iq-hw-7',
      level: 'followup',
      question: 'What does end-to-end encryption cost this design?',
      guidance:
        'No server-side search, media processing or content filtering, and the sender must encrypt per recipient device — which bounds group size. A strong answer notes that deciding E2EE late means discovering features are impossible.',
    },
    {
      id: 'iq-hw-8',
      level: 'followup',
      question: 'You delete messages after delivery. What does that buy and cost?',
      guidance:
        'It keeps pending storage at a few terabytes rather than a hundred per day. The cost is no server-side history, so a new device sees nothing and a long-offline device gets a visible gap.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hw-1',
      kind: 'what-changes-if',
      prompt:
        'This design deletes messages once delivered to every device. Now change one thing: full message history must be stored on the server forever, searchable, and available to a newly-added device. What changes?',
      discussion: `This single requirement change replaces roughly half the design, and it is worth working through because it is the most commonly-requested extension.

**The storage change is four orders of magnitude.**

\`\`\`
Pending-only:  5 TB of undelivered messages
Permanent:     100 billion messages/day × 1 KB = 100 TB/day
               × 1.5 for indexes × 3 replicas = 450 TB/day
               Over a year: ~160 PB
\`\`\`

**That is the blob-storage lesson's problem**, so messages move from a hot partitioned database to a tiered store: recent months on fast storage, older content erasure-coded and cold. And the retention sweep — currently the mechanism that keeps storage small — disappears entirely.

**The delivery model simplifies in one way and complicates in another.**

**Simpler:** a device no longer pins storage. Currently one long-offline device prevents deletion for a whole conversation; with permanent history, cursors are purely a delivery optimisation and the 30-day cap and its gap markers vanish. **Case 8 from the exercise stops existing.**

**More complicated:** a *new* device must be able to load history it was never sent. That is a different access pattern — paginated backwards reads over a conversation, rather than forward delivery from a cursor. **Two read paths where there was one.**

**End-to-end encryption becomes the blocking problem, and it is not a detail.**

Under E2EE, each message is encrypted for the devices that existed when it was sent. **A new device has no keys for old messages**, so server-side history is undecryptable by it. The options are all unattractive:

**Re-encrypt on the client.** An existing device downloads history, decrypts, re-encrypts for the new device, uploads. **Works, and it means adding a device requires an existing one to be online and to transfer the entire history** — which for years of messages is a substantial transfer over a phone.

**Encrypt history with a per-conversation key held by the user rather than the device.** Then any device with the user's key can read history. **This weakens the security model** — compromising the user's key exposes all history rather than one device's — and it is the trade real products make when they offer history.

**Store history unencrypted or server-decryptable.** Enables search and new devices, and abandons end-to-end encryption.

**The requirement "searchable" forces the third option.** Server-side search requires the server to read content. **So "permanent, searchable history" and "end-to-end encrypted" are incompatible**, and one of them has to go. That is the most important thing to say, because it is a product decision disguised as a technical one — and a candidate who adds search without noticing has silently removed the encryption.

*The partial escape:* client-side search over locally-stored history. Works, does not require server access to content, and cannot search history the device does not hold — so it does not solve the new-device case.

**What else appears.**

**Deletion becomes a real problem.** "Delete for everyone" currently works because messages are transient. With permanent history it must propagate to every device's local copy and to the server's tiers, including cold storage — and a legal erasure request must reach erasure-coded archives. **This is the append-only-log deletion problem from the event-sourcing discussion.**

**Search infrastructure is a new system.** An index over 160 PB, per user, with per-conversation access control. That is a large search deployment, and it is only possible in the non-E2EE variant.

**Media retention multiplies it.** Currently media can expire; permanently, a decade of photos and video per user is far larger than the text.

**What I would actually do.** Offer permanent history as an **opt-in, per-conversation** feature with the security consequence stated plainly to the user, and keep client-side-only search. **That preserves the default security model, bounds the storage growth to conversations that chose it, and avoids the incompatibility** — while accepting that the new-device case requires an existing device to transfer history.

**The transferable point.** "Store everything forever" reads as a storage requirement and is actually three separate changes: a four-order-of-magnitude storage tier change, a second read path for backfill, and — decisively — an incompatibility with the encryption model. **The third is the one that determines whether the feature is possible at all**, and it is invisible if you treat the requirement as being about storage.`,
    },
    {
      id: 'al-hw-2',
      kind: 'debug',
      prompt:
        'A messaging system built to this design has a persistent complaint: a small number of users report messages arriving out of order — an answer appearing above the question. Server logs show sequence numbers assigned monotonically per conversation, no gaps, and clients acknowledging in order. Diagnose it.',
      discussion: `Sequences are monotonic and gapless on the server, and clients acknowledge in order — so the ordering is correct in the store and wrong on the screen. That localises the fault to the client's rendering, or to how the client learns of messages, rather than to the sequence assignment.

**Hypothesis 1 — the client renders by arrival rather than by sequence.** Messages arrive by two paths: pushed over the socket, and fetched via sync. If a client appends in arrival order rather than inserting by sequence, then any interleaving of the two paths produces visible disorder.

*Concretely:* a client reconnects, starts a sync fetch, and simultaneously receives a live push for a newer message. The push arrives first (one round trip) while the sync response is still paginating. **Appending gives the newer message above the older ones.**

*Why it fits "a small number of users":* it requires the reconnect-plus-live-push overlap, which needs a particular timing — common for users on unstable connections and rare otherwise.

*Check:* whether the client inserts by \`seq\` into an ordered structure, or appends. And whether the affected users have high reconnection rates. **This is a code read and it is the leading candidate.**

**Hypothesis 2 — messages ordered by \`server_time\` rather than by \`seq\`.** If the client sorts by timestamp, two messages assigned the same millisecond have no defined order, and — worse — clock skew between message-service instances means \`server_time\` is not monotonic with \`seq\`. **A message with a later sequence can carry an earlier timestamp.**

*Why it fits:* it would be rare, correlated with high message rates in a conversation (more same-millisecond collisions) and with which servers handled the writes.

*Check:* whether the client sorts by \`seq\` or \`server_time\`, and whether any conversations contain a pair where \`seq\` and \`server_time\` disagree in order. **The second query is definitive and worth running regardless**, because it also reveals whether the server is emitting inconsistent timestamps.

**Hypothesis 3 — the sync response is applied out of order across pages.** If sync pagination returns pages that the client fetches in parallel for speed, page 3 can be applied before page 2. **Within a page order is preserved; across pages it is not.**

*Why it fits:* it would affect only users who had enough backlog to paginate — long-offline users, which is a small subset.

*Check:* whether sync pages are fetched sequentially or in parallel, and whether the affected disorder spans a page boundary.

**Hypothesis 4 — a stale push delivered on a reconnected session.** From the exercise: without a session-id check, a push in flight can be delivered on a new connection after the client has already synced past it. **The client receives an older message after newer ones.** If the client deduplicates on message id it is discarded harmlessly — but if deduplication happens *after* insertion, or is missing, the old message appears at the bottom.

*Check:* whether the session-id comparison is implemented, and whether the affected messages appear twice in client logs.

**Hypothesis 5 — the conversation view merges two sources with different ordering.** If the client stores messages locally and renders from a local query, and that query orders by an insertion timestamp or a rowid rather than by \`seq\`, then a message inserted later but sequenced earlier renders in the wrong place. **The local database's ordering, not the protocol's, is what the user sees.**

*Check:* the client's rendering query. **This is the same defect as hypothesis 1 one layer down**, and it is easy to introduce by adding a local cache.

**What I would check first: whether the client's rendering path orders by \`seq\`.** One code read, and it covers hypotheses 1, 2 and 5 — which together are the most likely. **The server-side investigation is finished: monotonic, gapless sequences with in-order acknowledgements is a clean bill of health**, and continuing to look there is the mistake that makes this take a week.

**Then: whether sync pages are fetched in parallel** (hypothesis 3), and **whether \`seq\` and \`server_time\` ever disagree** (hypothesis 2), both of which are single queries.

**Why the server-side evidence is so informative here.**

"Sequence numbers assigned monotonically, no gaps, acknowledgements in order" rules out:

- A broken sequence assignment.
- Lost or reordered messages in the store.
- A fan-out path delivering out of order in a way the client could not correct.

**And it establishes that the client has everything it needs to render correctly**, because the sequence is a total order and the client has all the messages. **So the disorder is purely a rendering decision** — which is a much smaller and more tractable problem than it first appears.

**The design changes this incident demands.**

**Make \`seq\` the only ordering key, everywhere.** In the local schema, in the rendering query, in the insertion logic. **\`server_time\` should be display-only and never an ordering input**, and it is worth making that explicit in the client's data model — for instance by not storing it in a sortable column.

**Insert by sequence, never append.** The client's conversation view should be an ordered structure keyed by \`seq\`, so the arrival path is irrelevant to the display. **That makes hypotheses 1, 3 and 4 all impossible rather than individually guarded against.**

**Fetch sync pages sequentially**, or apply them in page order regardless of arrival. The parallelism gain is small and the correctness cost is real.

**Add a client-side ordering assertion in debug builds:** on insert, verify the new message's sequence is consistent with its neighbours. **A cheap invariant check that would have caught this in development**, and this class of bug is exactly what such assertions are for.

**Transferable:** when a system's store is provably correct and the user sees something wrong, the defect is in the presentation path — and the fix is usually to make the correct ordering *structural* rather than to guard each way it can be violated. **An ordered insert by the authoritative key makes every arrival-order bug impossible at once**, which is more robust than fixing the three paths that can produce it.`,
    },
  ],

  revision: {
    bullets: [
      'The hard problem is connection routing, not storage: which server owns this socket, and what to do when the answer is stale.',
      'The durable store is authoritative and the connection is an optimisation.',
      'Persist and sequence before acknowledging the sender; delivery over a socket is best-effort.',
      'That inversion makes a stale mapping, a dead server and an offline device the same handled case.',
      'Order is per conversation, assigned by the server — not global, and not from client timestamps.',
      'A per-conversation sequence is a single-partition conditional increment; a global one is a hot counter nobody needs.',
      'Receipts are twice the message volume, so they must be cumulative watermarks and aggregated for groups.',
      'A cumulative watermark is idempotent by construction — a lower value is a harmless no-op.',
      'Connection ownership is ephemeral in Redis with a heartbeat-refreshed TTL; durability would be cost with no benefit.',
      'Heartbeats dominate the mapping write rate 40-fold, so refresh per server in one batched command.',
      'A push that finds no connection gets one bounded retry, then falls through to sync.',
      'A session id prevents a stale push being delivered on a reconnected socket.',
      'A sync request needs a conversation-list cursor as well, or a user added to a group while offline never learns of it.',
      'Fan-out on read is unavailable — a message must be pushed to arrive in 500 ms.',
      'End-to-end encryption removes server-side search, media processing and single-ciphertext group fan-out.',
      'The sender must encrypt per recipient device, which is what bounds group size in practice.',
      'Deleting after delivery keeps pending storage at a few terabytes; permanent history is four orders of magnitude more.',
      'The characteristic incident is a reconnect storm after a connection server dies — backoff with jitter is mandatory.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A durable per-conversation message log with server-assigned sequences, a connection tier holding persistent sockets, an ephemeral ownership mapping, and per-device cursors that make delivery reliable independently of the connection.',
    whyItExists:
      'Because a message must reach a device now, that device holds one socket to one of thousands of servers, and the mapping is frequently wrong by the time it is used.',
    whenToUse: [
      'Real-time messaging with offline recovery and multi-device delivery.',
      'Whenever a persistent connection tier must be sized separately from a request tier.',
      'Wherever per-conversation ordering is required and global ordering is not.',
    ],
    whenNotToUse: [
      'Routing before persisting, which makes durability depend on finding the recipient.',
      'A global message sequence, which is a hot counter for a guarantee with no consumer.',
      'Client timestamps as an ordering key.',
      'Per-message receipts at scale.',
      'Fan-out on read for messages, which cannot meet the latency requirement.',
    ],
    alternatives: [
      'Long-polling instead of WebSockets, when connection density is not the constraint.',
      'Push-notification delivery for backgrounded devices, instead of holding a socket.',
      'A broadcast-channel design for unbounded group sizes, with pull semantics.',
      'Derivable connection ownership by consistent hashing, instead of a lookup.',
    ],
    tradeoffs: [
      'Persist-first buys reliability independent of routing and costs a write before every acknowledgement.',
      'Per-conversation sequencing buys cheap assignment and costs per-conversation cursors.',
      'Cumulative receipts buy an order of magnitude of traffic and cost granularity.',
      'Ephemeral ownership buys write efficiency and costs a TTL of staleness after a crash.',
      'Deleting after delivery buys tiny storage and costs server-side history entirely.',
      'End-to-end encryption buys privacy and costs search, media processing and group size.',
    ],
    failureModes: [
      'A stale mapping delivering to a server that no longer holds the connection.',
      'No per-device cursor, so a reconnecting client cannot know what it missed.',
      'A crash between receiving and persisting, losing the message with no record.',
      'Client-timestamp ordering showing messages out of sequence when a clock is wrong.',
      'Per-message receipts doubling system traffic for a status indicator.',
      'A stale push delivered on a reconnected socket as a duplicate or out of order.',
      'A user added to a group while offline never learning of it.',
      'A million clients reconnecting simultaneously after a connection server crashes.',
      'Synchronous group fan-out making send latency proportional to group size.',
      'One long-offline device pinning storage for an entire conversation.',
      'A client rendering by arrival order rather than by sequence.',
    ],
    followUpQuestions: [
      'Is the message persisted before the sender is acknowledged?',
      'What assigns the order, and at what scope?',
      'How does a reconnecting device learn what it missed?',
      'How does it learn about a conversation it was added to while offline?',
      'Where does connection ownership live, and what happens when it is stale?',
      'What is the receipt volume relative to the message volume?',
      'What prevents a stale push being delivered on a new connection?',
      'What happens when a connection server holding a million sockets dies?',
      'How long are messages retained, and what does a client past that see?',
      'What does end-to-end encryption make impossible here?',
      'Does the client render by sequence or by arrival?',
    ],
  },
});
