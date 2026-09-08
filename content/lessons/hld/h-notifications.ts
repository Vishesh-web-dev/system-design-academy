import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-notifications',
  title: 'Design a notification system',
  summary:
    'Every hard part is a policy question wearing an infrastructure costume: when preferences are evaluated, what counts as a duplicate, which channel a failure falls back to, and whether a two-hour outage should deliver its backlog at 3am.',
  phase: 'hld',
  module: 'core-designs',
  position: 43,
  kind: 'system-design',
  difficulty: 'core',
  estimatedMinutes: 90,
  tags: ['fan-out', 'deduplication', 'preferences', 'dead-letter', 'multi-channel'],
  prerequisites: ['h-rate-limiter'],
  resources: [
    {
      key: 'stripe-webhooks',
      tier: 'must',
      note: 'A published delivery contract for the webhook channel: at-least-once, no ordering, retries over an extended window, deduplicate on the event id. Read it as the specification this design owes its own consumers.',
    },
    {
      key: 'microservices-outbox',
      tier: 'must',
      note: 'The pattern that makes "a thing happened, therefore notify" reliable. Read it because the alternative — publishing after the business write — silently drops notifications.',
    },
    {
      key: 'aws-sqs-fifo',
      tier: 'must',
      note: 'Read the deduplication-interval and message-group material. It shows both what a broker can do about duplicates and the narrow window in which it works, which is why application-level dedup is still required.',
    },
    {
      key: 'kafka-consumer-groups',
      tier: 'good',
      note: 'Read the offset-commit material with the fan-out stage in mind. Where you commit relative to sending is what makes a channel worker at-least-once or at-most-once.',
    },
    {
      key: 'google-sre-handling-overload',
      tier: 'good',
      note: 'Read the criticality sections. A password reset and a marketing digest must not share a queue, and criticality carried with the request is what lets every stage shed the right things.',
    },
    {
      key: 'rfc-5321-smtp',
      tier: 'advanced',
      note: 'Read the sections on reply codes and on retry. Email delivery has its own failure taxonomy — hard versus soft bounces — and treating them alike is how a sender destroys its own reputation.',
    },
  ],

  intuition: {
    body: `A notification system looks like a queue with some workers, and the queue is the least interesting part. The difficulty is that **almost every hard question is a policy question with an infrastructure consequence.**

Four of them, and each one changes the architecture:

**When are preferences evaluated?** A user mutes a thread at 14:00. A notification for that thread was created at 13:58 and is still queued. Does it arrive? If preferences are checked at *creation*, yes. At *delivery*, no. **The gap between creation and delivery can be hours**, so these are different products, and only one of them requires preference state on the delivery path.

**What counts as a duplicate?** The same event delivered twice is obviously one. What about two different events about the same thing within a minute — three comments on your photo? Users experience three notifications as spam, so **deduplication is partly a product decision about aggregation**, not just a technical guard against retries.

**What happens when a channel fails?** Push fails because the device token is stale. Do you fall back to email? Silently? That is a policy — and if the answer is yes, a channel failure becomes a routing decision rather than a retry.

**What happens after an outage?** The system is down for two hours and recovers at 3am. Delivering the backlog immediately sends everyone a burst of notifications in the middle of the night. **So a recovery is not "drain the queue"**; it needs a policy about staleness and quiet hours.

None of those is answered by choosing a broker.

And one structural idea organises the whole design: **separate "something happened" from "someone must be told".**

An event — *order shipped* — is a fact. A notification — *send this email to this address* — is a decision derived from that fact plus the recipient's preferences, plus their locale, plus their channel availability, plus rate limits. **Conflating them means the producing service must know about preferences, channels and quiet hours**, which couples every service in the company to the notification logic.

So the pipeline has a shape that follows from that separation:

\`\`\`
event → fan-out (who should be told?) → policy (should they, and how?)
      → per-channel delivery (with each channel's own failure model)
\`\`\`

The framing to carry: **the queue is trivial; the design is the policy layer, and every policy question you leave unanswered gets answered accidentally by whoever writes the code.**`,
    analogyLimit:
      '"A queue with workers" is accurate about the transport and silent about everything that matters. It hides that preferences must be evaluated at a specific point in the pipeline, that deduplication is partly a product decision about aggregation, that each channel has an incompatible failure model, and that draining a backlog after an outage is a policy question rather than an operation. Teams build the queue in a week and spend a year on the policies.',
  },

  deepExplanation: {
    predict: {
      question:
        'A notification system is built to specification: events go to a Kafka topic, a fan-out service expands them to recipients, and channel workers send email, push and SMS with retries and a dead-letter queue. Six months in, there are four persistent complaints: duplicate emails, password resets arriving after 40 minutes, notifications for muted threads, and a user who received 60 emails at 4am. The code matches the requirements. Diagnose each.',
      answer: `**All four are missing requirements rather than bugs, and each maps to a specific architectural omission.**

**Complaint 1: duplicate emails.**

The requirement said "delivered reliably", which is a sentiment compatible with at-least-once (duplicates) and at-most-once (losses). The team implemented retries, got at-least-once, and **duplicates are the correct behaviour of what was specified.**

The specific mechanism: a channel worker sends the email, then commits its offset. If it crashes between the two — or the send succeeds and the response is lost — the message is redelivered and sent again.

**What was missing:** a deduplication record keyed on a stable notification id, written in the same transaction as the decision to send. Then a redelivery finds the record and skips.

**And the subtlety:** the record must be written *before* the send and committed, because an email cannot be un-sent. That accepts a rare lost email — a crash in the window between recording and sending — in exchange for never duplicating. **A duplicate is unbounded (every retry sends one) while a loss is single and detectable by reconciliation**, so this is the right direction, and it must be a stated decision rather than an accident.

**Complaint 2: password resets after 40 minutes.**

One queue for everything. A batch of 5 million marketing notifications was enqueued, and the password reset went behind them. It arrives when the batch drains.

**What was missing:** a latency budget *per notification class*. "Transactional notifications within 30 seconds at p99; marketing within 4 hours" is two numbers, and they force **separate queues with separate workers** — the bulkhead from the backpressure lesson. One queue for heterogeneous traffic classes guarantees the important class waits behind the unimportant one.

**And the sharper form:** this is not only about queues. The *provider* rate limit is shared too. If marketing sends consume the email provider's rate allowance, transactional sends are throttled by the provider even with separate internal queues. **So the isolation has to extend to per-class provider quotas**, which is a requirement nobody writes down.

**Complaint 3: notifications for muted threads.**

The mute worked. The notification was *created* before the mute and *delivered* after it, and preferences were checked at creation.

**What was missing:** a statement of *when* preferences are evaluated. This is the most instructive of the four, because the functional requirement — "users can mute a thread" — was implemented correctly and completely. **The specification omitted the evaluation point**, which is invisible in a synchronous system and decisive in a pipeline with a delay.

The fix is architectural: preferences must be readable on the **delivery** path, which means the channel worker needs preference state — a cache with invalidation, or a lookup per send. That is a dependency the original design did not have.

**Complaint 4: 60 emails at 4am.**

Two failures compounding, and it is worth separating them.

**No per-user rate limit.** An event storm — someone bulk-updating 60 records, each generating a notification — produced 60 notifications. **A cap of "no more than N per user per hour, with the rest aggregated into a digest" is a requirement every notification system needs and almost no first specification includes.**

**No quiet hours.** Delivery proceeded at 4am in the user's local time. And note that this requires knowing the user's timezone at delivery time, which is another preference-path dependency.

**And the third thing that produced 60 rather than 6:** this may have been the *backlog* of an earlier outage draining. Nothing in the design said "a notification older than N minutes is stale and should be dropped or digested rather than delivered". **A recovery delivered two hours of accumulated notifications at once**, which is the failure mode the intuition section named.

**What the design should have been, structurally.**

\`\`\`
event → fan-out → POLICY LAYER → per-class queues → channel workers
                       │
                       ├── preferences (evaluated HERE, at delivery decision)
                       ├── per-user rate limit + aggregation into digests
                       ├── quiet hours in the user's timezone
                       ├── staleness check (drop or digest if too old)
                       └── deduplication record, written before sending
\`\`\`

**Every one of the four complaints is a component of that policy layer**, and the original design had no policy layer at all — it went from fan-out straight to channel workers.

**The general lesson.** The functional requirements were complete and the system was wrong. **The requirements that mattered were about repetition, timing, evaluation point and failure** — the four questions the requirements lesson said to ask of every functional requirement, and the ones systematically omitted because whoever writes the specification is imagining the system working.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements, as precise operations:**

\`\`\`
A service can request that a user be notified of an event
A user can set channel preferences per notification category
A user can mute a specific thread or entity
A user can set quiet hours in their local timezone
A user can unsubscribe from a category entirely
The system delivers via email, push, SMS and in-app
The system records the delivery outcome of every notification
A user can view their in-app notification history
An operator can inspect and replay failed notifications
\`\`\`

**The clarifying questions that change this design:**

**When are preferences evaluated — creation or delivery?** *Delivery.* This is the most consequential answer in the whole design, because it puts preference state on the delivery path.

**What is the latency requirement, per class?** *Transactional within 30 s at p99; digest within 4 hours.* Two numbers, and they force separate queues and separate provider quotas.

**What counts as a duplicate?** *The same notification id, and also N notifications about the same entity within a window — which should aggregate rather than send separately.*

**Is there a per-user volume cap?** *Yes — at most 10 per hour, with the excess aggregated into a digest.*

**Do channels fall back to one another?** *No, and this is a deliberate answer.* A push failure does not silently become an email, because the user chose push. Failure is recorded and surfaced, not rerouted.

**What happens to a notification that is hours old?** *Transactional: still deliver, it is probably still wanted. Digest: drop or fold into the next digest.* Per class, and it is what makes a post-outage recovery safe.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Transactional latency | p99 under 30 s | Separate queue, separate workers, separate provider quota |
| Digest latency | Under 4 hours | Can be batched and cheap |
| Delivery guarantee | At-least-once send, no duplicate *delivered* | Dedup record before send |
| Durability | A requested notification is never silently lost | Outbox at the producer; DLQ with alerting |
| Availability | 99.9% for accepting requests | Accepting is cheap; delivery can lag |
| Scale | 500 M notifications/day | See estimation |

**Out of scope:** authentication, the content-authoring and templating UI, and the marketing-campaign scheduler. Assume templates exist and a campaign scheduler enqueues into this system like any other producer.

## Step 2 — Estimation

\`\`\`
Users:                 200 million, 50 million daily active
Notifications:         500 million/day
  → 500e6 ÷ 100,000 = 5,000/second average
  → peak 3× = 15,000/second

Class mix:
  Transactional (order, security, reset):  10%  →  1,500/s peak
  Social (comment, like, follow):          70%  → 10,500/s peak
  Digest / marketing:                      20%  →  3,000/s peak
\`\`\`

**Fan-out amplification.** An event does not equal a notification. A comment on a popular post notifies the author plus everyone following the thread:

\`\`\`
Average recipients per event: 3
→ 500 million notifications from ~170 million events
\`\`\`

**But the tail is what matters.** A post with 100,000 followers generates 100,000 notifications from one event. At 15,000 notifications/second capacity, that single event takes **7 seconds of the entire system's throughput** — which starves everything else. **That is the deep dive**, and the estimate found it.

\`\`\`
Channel split (after preferences):
  Push:    60%  →  9,000/s peak
  In-app:  25%  →  3,750/s peak
  Email:   12%  →  1,800/s peak
  SMS:      3%  →    450/s peak
\`\`\`

**Provider limits are the real constraint on email and SMS.** Email providers typically allow tens of thousands per second on a warmed sender; SMS is far lower and metered per message. **450 SMS/second at typical per-message pricing is a significant daily cost**, which is why SMS is 3% and why the cost belongs in the estimate.

\`\`\`
Storage:
  Notification record: ~500 bytes (id, user, type, payload ref, status)
  500e6/day × 500 B = 250 GB/day raw
  × 1.5 indexes × 3 replicas ≈ 1.1 TB/day
  Retention 90 days hot → ~100 TB
  In-app history: keep 500 per user → 200e6 × 500 × 200 B = 20 TB

Dedup records:
  Keyed by notification id, 60-byte key, 24-hour window
  500e6 × 60 B ≈ 30 GB in Redis. Fits comfortably.
\`\`\`

**Bandwidth is not a constraint** — notifications are small and the payloads are references rather than content. **The constraints are provider rate limits, the fan-out tail, and the policy lookups per notification.**

\`\`\`
Policy lookups: 15,000/s peak × (preferences + rate limit + quiet hours)
  → if each is a separate call, 45,000 lookups/second
  → must be one combined lookup, cached, or the policy layer
    becomes the bottleneck
\`\`\`

**That last line is a real design conclusion from arithmetic**: the policy layer needs a single combined read, not three.

## Step 3 — API design

**The producer interface. Deliberately narrow, and this is the important design decision:**

\`\`\`
POST /notifications
{
  "eventId": "evt_4471",              // idempotency key, from the producer
  "type": "comment.created",
  "recipients": ["user_8891"],        // or a resolvable audience
  "data": { "commentId": "c_991", "postId": "p_12" },
  "class": "social"                   // transactional | social | digest
}
→ 202 Accepted { "notificationIds": ["ntf_..."] }
\`\`\`

**What the producer does *not* send, and why each omission matters:**

**No channel.** The producer does not know whether this user wants push or email. **If it did, every service would need preference logic.**

**No content.** Only structured data and a type. The notification system renders from a template, so copy changes and localisation do not require a producer deploy.

**No recipient list for large audiences.** For "everyone following post 12", the producer sends an audience reference and the fan-out service expands it — because a producer holding 100,000 user ids in a request body is the wrong shape.

**\`eventId\` is the producer's idempotency key**, derived deterministically from the event. A producer retry with the same id must not create a second notification. **This is the first of three deduplication layers** and it is the cheapest.

**The preference interface:**

\`\`\`
GET  /users/{id}/preferences
PUT  /users/{id}/preferences
  { "categories": { "comment": { "push": true, "email": false } },
    "quietHours": { "start": "22:00", "end": "08:00", "tz": "Europe/London" },
    "muted": ["thread:p_12"],
    "unsubscribed": ["marketing"] }
\`\`\`

**And the internal contract that matters most:** the policy layer reads a single combined preference document per user, so one lookup answers channel choice, mute status, quiet hours and rate-limit state. The estimate showed that three separate lookups would make the policy layer the bottleneck.

## Step 4 — Data model

\`\`\`sql
-- The request, as accepted. Immutable.
notification_requests(
  id, event_id UNIQUE, type, class, data JSONB, created_at
)

-- One row per (notification, recipient, channel). The unit of delivery.
deliveries(
  id, request_id, user_id, channel,
  status,              -- pending | sent | failed | suppressed
  suppressed_reason,   -- muted | quiet_hours | rate_limited | unsubscribed | stale
  provider_ref, attempts, created_at, sent_at,
  UNIQUE (request_id, user_id, channel)
)

-- Per-user policy, read as one document
user_preferences(user_id PK, doc JSONB, updated_at)

-- In-app feed, the only channel we store rather than send
in_app_feed(user_id, delivery_id, read_at, created_at)
  PARTITION BY HASH (user_id)
\`\`\`

**Four decisions worth defending.**

**\`UNIQUE (request_id, user_id, channel)\` is the deduplication mechanism.** A retried fan-out cannot create a second delivery row for the same person on the same channel — the database enforces it, so no code path can bypass it. **This is the second dedup layer**, and it is the strongest because it is a constraint rather than a check.

**\`suppressed\` is a first-class status with a reason.** A notification that was deliberately not sent because of quiet hours is *not* the same as one that failed, and it is not the same as one that never existed. **Recording why nothing was sent is what makes support answerable** — "why didn't I get this?" has a queryable answer.

**Deliveries, not notifications, are the unit.** One request to notify five people across two channels each is ten delivery rows. That is what makes per-channel status, per-channel retry and per-channel dedup possible.

**The in-app feed is partitioned by user**, because the access pattern is entirely "this user's recent notifications" and it is the highest-volume read in the system.

## Step 5 — The pipeline

\`\`\`
Producer service
   │ (outbox, in the same transaction as the business write)
   ▼
notification-requests topic ─────────────────────────────┐
   │                                                      │
   ▼                                                      │
FAN-OUT SERVICE                                           │
   · resolve audience → recipient list                    │
   · create delivery rows (unique constraint = dedup)      │
   · emit one message per delivery                        │
   ▼                                                      │
POLICY LAYER  (one combined preference read per user)      │
   · unsubscribed?     → suppress                         │
   · muted?            → suppress                         │
   · channel enabled?  → suppress this channel            │
   · quiet hours?      → defer to window end, or digest    │
   · rate limit hit?   → aggregate into digest             │
   · stale?            → drop (digest) or send (transactional)
   ▼
PER-CLASS QUEUES  (transactional | social | digest)
   ▼                    ▼                    ▼
email worker        push worker          sms worker      in-app writer
   · dedup record      · dedup record        · dedup       · insert row
   · provider call     · provider call       · provider
   · retry / DLQ       · retry / DLQ         · retry / DLQ
\`\`\`

**Why the producer uses an outbox.** "The order shipped and nobody was told" is a silent failure — nothing monitors the absence of a notification. Writing the notification request to an outbox in the same transaction as the business change makes it atomic, and a relay publishes it. **Without this, the most important reliability property of the system is missing at the very first step.**

**Why the policy layer is a distinct stage rather than logic inside the channel workers.** Three reasons: the policy read is expensive enough that it must be done once rather than per channel; suppression decisions apply across channels; and putting policy in each worker means four implementations that will diverge.

**Why per-class queues.** The bulkhead. A 5-million-message marketing batch must not delay a password reset, and separate queues with separate workers is the only thing that guarantees it.

## Step 6 — The deep dive: fan-out and the celebrity problem

The estimate found it: one event with 100,000 recipients consumes 7 seconds of total system throughput. Three things break.

**Problem 1 — a single fan-out task is unbounded.** Expanding 100,000 recipients in one worker takes minutes, holds a worker, and if it crashes at 60,000 the whole thing restarts.

*Fix: chunked fan-out.* The fan-out worker reads the audience in pages of 1,000 and emits a **continuation message** with a cursor:

\`\`\`
fan_out(request_id, cursor=0)
  → create 1,000 delivery rows
  → emit fan_out(request_id, cursor=1000)
  → return
\`\`\`

Each task is bounded, and a crash resumes from the last committed cursor. **And it is idempotent because of the unique constraint** — a re-run of a chunk creates no duplicate rows.

**Problem 2 — a large fan-out starves everything else.** 100,000 delivery messages in the social queue mean the next ordinary comment notification waits behind them.

*Fix: separate the large fan-outs.* Audiences above a threshold — say 5,000 — go to a **bulk fan-out queue** with its own bounded worker pool. Ordinary fan-outs are unaffected.

*And rate-limit the bulk pool*, so a 10-million-recipient announcement spreads over minutes rather than saturating the delivery workers. **The trade: a very large announcement takes longer to reach everyone**, which is almost always acceptable and must be stated.

**Problem 3 — the delivery stage is still the bottleneck for a huge event.** Even chunked and isolated, 100,000 push notifications must be sent, and the provider has a rate limit.

*Fix: batch at the provider boundary.* Push providers accept batched sends of hundreds of tokens per call, so 100,000 becomes a few hundred calls rather than 100,000. **This is a 100× reduction and it exists only because the channel supports batching** — email largely does not, SMS does not at all.

**The asymmetry is the interesting conclusion:** push scales through batching, email scales through provider throughput and sender reputation, and SMS scales through money. **The same fan-out produces three different scaling problems**, which is why channel workers cannot share an implementation.

**The alternative worth considering and rejecting: pull-based in-app notifications for large audiences.** Rather than writing 100,000 feed rows, store the event once and have each user's feed query merge it in at read time — the feed lesson's fan-out-on-read. **For in-app that is genuinely better** at these fan-outs, and I would adopt it there. It does not help push, email or SMS, because those are *pushed* by definition — there is no read-time merge for an email.

So: **fan-out on read for in-app, fan-out on write for everything else**, and the split is forced by whether the channel is pull or push.

## Step 7 — What breaks at 10×

**5 billion notifications/day, 150,000/second peak.**

**The policy layer becomes the bottleneck.** 150,000 combined preference reads per second against a cached document store. *Fix:* cache preferences aggressively in the policy workers with a short TTL, accepting that a preference change takes up to a minute to take effect — a deliberate staleness decision that must be published, because a user who mutes a thread and immediately receives a notification will report it as a bug.

**Provider limits become hard walls.** 18,000 emails/second exceeds what most providers allow on a single sender. *Fix:* multiple sending domains and IP pools, with warm-up — which is weeks of operational lead time, not a configuration change. **This is the constraint that cannot be engineered around quickly**, and it is worth naming as a capacity-planning dependency with a long lead time.

**The deliveries table becomes large.** 5 billion rows/day. *Fix:* partition by day, drop old partitions rather than deleting rows, and move anything past 7 days to cold storage. **The outbox lesson's conclusion: a high-churn status table needs partitioning, not deletion.**

**Dedup records grow.** 5 billion keys per day in Redis at 60 bytes is 300 GB — affordable but no longer trivial. *Fix:* shorten the dedup window for social notifications to 1 hour (retries complete well inside it) and keep 24 hours only for transactional.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Producer's outbox relay down | Notifications not requested | Requests accumulate durably; delivered late, nothing lost |
| Fan-out service down | Nothing expands | Requests queue; transactional latency breached, alert |
| Policy store down | Cannot evaluate preferences | **Fail closed for suppression**: hold, do not send. Sending to a muted user is worse than sending late |
| Email provider down | Emails fail | Retry with backoff for 24 h; then DLQ with alert. **No silent fallback to another channel** |
| Push provider rejects a token | That device unreachable | Mark the token invalid, do not retry, do not fall back |
| Per-class queue backed up | That class delayed | Other classes unaffected — the bulkhead working |
| Recovery after a 2-hour outage | 2 hours of backlog | **Staleness policy applies**: transactional sends, social digests, marketing drops |

**Three rows carry the real content.**

**The policy store fails *closed*.** This inverts the usual advice and it is correct here: if we cannot check whether a user muted a thread, sending is worse than waiting. **The failure that generates complaints is an unwanted notification, not a late one.**

**No silent channel fallback.** A push failure does not become an email. The user chose push; substituting a channel they declined is a product decision disguised as error handling. **Record the failure, surface it, and let the product decide** — and if fallback is genuinely wanted, it must be an explicit user preference.

**Recovery is governed by the staleness policy**, which is what prevents the 4am burst. **A queue drain is not a recovery plan**, and this row is the design's answer to the fourth complaint in the prediction.

## Step 9 — Defending it

**"I separated 'something happened' from 'someone must be told', which is the decision everything else follows from.** Producers send events with structured data and no channel and no copy, so no service in the company needs preference logic and a copy change does not require a producer deploy.

**I put preference evaluation at delivery time, not creation time.** That costs a preference lookup on the delivery path and a cache with a staleness window, and it means a user who mutes a thread stops receiving notifications for it — which is what they expect and what creation-time evaluation cannot deliver.

**I used three deduplication layers**: the producer's event id, a unique constraint on (request, user, channel), and a per-send dedup record written before the provider call. The constraint is the strongest because no code path can bypass it, and the pre-send record accepts a rare lost email in exchange for never duplicating — because a duplicate is unbounded and a loss is single and detectable.

**I separated queues by class and refused channel fallback.** The first is a bulkhead so marketing cannot delay a password reset; the second is a policy decision that a channel the user declined is not a fallback.

**What I gave up:** preference changes take up to a minute to take effect; a very large announcement takes minutes to reach everyone rather than seconds; and during a policy-store outage nothing is sent at all. All three are deliberate and all three are the safe direction.

**What would make me revisit it:** if in-app became the dominant channel, I would move it entirely to fan-out on read and stop writing feed rows — which would remove the largest write volume in the system. And if transactional latency had to drop below a second, the policy lookup would have to move off the delivery path, which means accepting creation-time evaluation for that class and its consequences."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'pipeline',
      title: 'The pipeline, with the policy layer as its own stage',
      caption:
        'Step through it. The policy layer is where every user-visible complaint is prevented, and the original design in the prediction went from fan-out straight to channel workers with nothing in between.',
      nodes: [
        { id: 'prod', label: 'Producer + outbox', kind: 'service', x: 0, y: 200, detail: 'Writes the notification request in the same transaction as the business change. Without this, "the order shipped and nobody was told" is a silent failure nothing monitors.' },
        { id: 'topic', label: 'requests topic', kind: 'store', x: 160, y: 200, detail: 'Events carry structured data, a type and a class — no channel and no copy, so no producer needs preference logic and a copy change needs no producer deploy.' },
        { id: 'fanout', label: 'Fan-out (chunked)', kind: 'service', x: 320, y: 200, detail: 'Expands an audience in pages of 1,000, emitting a continuation with a cursor. Bounded tasks, resumable on crash, and idempotent because of the unique constraint on delivery rows.' },
        { id: 'bulk', label: 'Bulk fan-out queue', kind: 'store', x: 320, y: 80, detail: 'Audiences above 5,000 go here with their own rate-limited worker pool, so a 100,000-recipient event cannot starve ordinary notifications.' },
        { id: 'policy', label: 'Policy layer', kind: 'service', x: 500, y: 200, detail: 'One combined preference read per user answers channel choice, mute, quiet hours, rate limit and staleness. Three separate lookups at 15,000/s would make this the bottleneck.' },
        { id: 'suppress', label: 'suppressed + reason', kind: 'note', x: 500, y: 330, detail: 'A first-class status with a reason: muted, quiet_hours, rate_limited, unsubscribed, stale. Recording why nothing was sent is what makes "why didn\'t I get this?" answerable.' },
        { id: 'queues', label: 'Per-class queues', kind: 'store', x: 680, y: 200, detail: 'Transactional, social, digest — separate queues with separate workers AND separate provider quotas, so a 5-million marketing batch cannot delay a password reset.' },
        { id: 'push', label: 'Push worker', kind: 'service', x: 860, y: 90, detail: 'Batches hundreds of tokens per provider call — a 100× reduction. Scales through batching, which email and SMS cannot do.' },
        { id: 'email', label: 'Email worker', kind: 'service', x: 860, y: 190, detail: 'Dedup record written and committed BEFORE the send, because an email cannot be un-sent. Scales through provider throughput and sender reputation, which takes weeks to warm.' },
        { id: 'inapp', label: 'In-app writer', kind: 'service', x: 860, y: 290, detail: 'The only pull channel, so it can use fan-out on read for large audiences — store the event once and merge at query time, avoiding 100,000 row writes.' },
      ],
      edges: [
        { id: 'n1', source: 'prod', target: 'topic', kind: 'write' },
        { id: 'n2', source: 'topic', target: 'fanout', kind: 'read' },
        { id: 'n3', source: 'fanout', target: 'bulk', kind: 'async' },
        { id: 'n4', source: 'fanout', target: 'policy', kind: 'sync' },
        { id: 'n5', source: 'policy', target: 'suppress', kind: 'control' },
        { id: 'n6', source: 'policy', target: 'queues', kind: 'write' },
        { id: 'n7', source: 'queues', target: 'push', kind: 'read' },
        { id: 'n8', source: 'queues', target: 'email', kind: 'read' },
        { id: 'n9', source: 'queues', target: 'inapp', kind: 'read' },
      ],
      steps: [
        {
          id: 'np1',
          title: 'The producer sends a fact, not an instruction',
          description:
            'Structured data, a type and a class — written to an outbox in the same transaction as the business change. No channel, no copy, so preference logic stays out of every other service.',
          nodes: ['prod', 'topic'],
          edges: ['n1'],
        },
        {
          id: 'np2',
          title: 'Fan-out is chunked and large audiences are isolated',
          description:
            'Pages of 1,000 with a cursor continuation, so tasks are bounded and resumable. Audiences above a threshold go to a rate-limited bulk pool so they cannot starve ordinary traffic.',
          nodes: ['fanout', 'bulk'],
          edges: ['n2', 'n3'],
        },
        {
          id: 'np3',
          title: 'The policy layer is where the complaints are prevented',
          description:
            'One combined read decides channel, mute, quiet hours, rate limit and staleness. Evaluating at delivery rather than creation is what makes a mute actually work.',
          nodes: ['policy', 'suppress'],
          edges: ['n4', 'n5'],
        },
        {
          id: 'np4',
          title: 'Suppression is recorded, not silent',
          description:
            'A deliberate non-send has a status and a reason, distinct from a failure and from never having existed. Without it, support cannot answer why a notification did not arrive.',
          nodes: ['suppress'],
          edges: ['n5'],
        },
        {
          id: 'np5',
          title: 'Per-class queues, then three incompatible channel models',
          description:
            'Push scales by batching, email by provider reputation, SMS by money — so the workers cannot share an implementation, and in-app is the only one that can fan out on read.',
          nodes: ['queues', 'push', 'email', 'inapp'],
          edges: ['n6', 'n7', 'n8', 'n9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'policy-decisions',
      title: 'Four policy questions and the architecture each forces',
      caption:
        'Read the right column. Every one of these is a product decision, and each has an infrastructure consequence that cannot be added cheaply later.',
      code: `flowchart LR
    P1["**When are preferences<br/>evaluated?**"] --> P1a["At creation:<br/>a mute after creation<br/>does not take effect"]
    P1 --> P1b["At delivery:<br/>preference state on the<br/>delivery path, cached,<br/>with a staleness window"]

    P2["**What is a duplicate?**"] --> P2a["Same notification id:<br/>a dedup record, cheap"]
    P2 --> P2b["Three events about one<br/>entity in a minute:<br/>**aggregation into a digest**,<br/>which is a product feature"]

    P3["**Does a failed channel<br/>fall back?**"] --> P3a["Silently:<br/>the user receives a channel<br/>they declined"]
    P3 --> P3b["No — record and surface.<br/>Fallback must be an<br/>explicit user preference"]

    P4["**What happens to a<br/>2-hour backlog?**"] --> P4a["Drain it:<br/>60 emails at 4am"]
    P4 --> P4b["Staleness policy per class:<br/>transactional sends,<br/>social digests,<br/>marketing drops"]

    style P1b fill:#17272a,stroke:#35897e
    style P2b fill:#17272a,stroke:#35897e
    style P3b fill:#17272a,stroke:#35897e
    style P4b fill:#17272a,stroke:#35897e
    style P1a fill:#2a1a1a,stroke:#a04848
    style P4a fill:#2a1a1a,stroke:#a04848`,
    },
  ],

  productionExample: {
    systems: ['stripe'],
    body: `Stripe's webhook delivery is the closest public reference for the *delivery* half of this design, because the guarantees are published rather than inferred — and a webhook is a notification channel whose recipient is a machine.

**Events are durable and independently queryable.** You can list past events over the API, which means the event was recorded as a fact before any delivery was attempted. **That is the outbox property: the event's existence does not depend on delivery succeeding**, which is exactly what the producer stage of this design needs.

**Delivery is at-least-once with retries over an extended window.** A recipient endpoint down for hours receives the events afterwards. And the documentation is explicit that handlers must be idempotent — **the deduplication obligation is stated as part of the contract rather than left to be discovered.**

**Ordering is explicitly not guaranteed.** Retries reorder, so rather than promising an order they cannot maintain, the documentation says so and advises fetching current state from the API when order matters. **Publishing the unflattering guarantee is what lets consumers write correct handlers.**

**Events carry a stable id**, which is what recipients deduplicate on. This is the same role as \`eventId\` in this design's producer interface.

**Two things this design does that a webhook system does not have to.**

**Preferences and suppression.** A webhook endpoint receives everything it subscribed to; a human recipient has muted threads, quiet hours and a volume cap. **The entire policy layer has no webhook analogue**, which is why webhook delivery looks simpler than notification delivery and why teams underestimate the latter by copying the former.

**Aggregation.** Three webhook events are three deliveries. Three notifications about the same photo within a minute should be one notification saying "3 new comments". **That is a product feature living inside the delivery pipeline**, and it is the hardest thing in this design to retrofit — because it requires holding a notification back to see whether more arrive, which means the pipeline needs a deliberate delay window.

**The transferable lessons.**

**Record the fact first, deliver second.** Delivery is unreliable and retryable; the fact is not.

**Publish the guarantees, including the ones you would rather not.** At-least-once, no ordering, deduplicate on the id, retries for this long. Consumers cannot write a correct handler without them.

**A machine recipient and a human recipient are different problems.** The transport is the same; the policy layer exists only for humans, and it is where all the difficulty is.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on. Most are policy choices with an architectural consequence rather than technology choices.',
    rows: [
      {
        option: 'Evaluate preferences at creation time',
        whenItWins:
          'When delivery is near-instant, so creation and delivery are effectively the same moment. Removes preference state from the delivery path.',
        whenItLoses:
          'Whenever there is a delay. A user who mutes a thread still receives queued notifications, which is the complaint they will report.',
        cost:
          'Mutes and unsubscribes do not take effect on in-flight notifications.',
      },
      {
        option: 'Evaluate preferences at delivery time',
        whenItWins:
          'The correct default. A mute takes effect on everything not yet sent, which is what users expect.',
        whenItLoses:
          'When the latency budget cannot absorb a preference lookup — under a second, for instance.',
        cost:
          'Preference state on the delivery path, cached with a staleness window, plus a fail-closed policy when it is unavailable.',
      },
      {
        option: 'One queue for all notifications',
        whenItWins:
          'At low volume with homogeneous urgency.',
        whenItLoses:
          'As soon as classes differ. A 5-million marketing batch puts a password reset behind hours of work.',
        cost:
          'The most urgent class waits behind the least urgent one, guaranteed.',
      },
      {
        option: 'Per-class queues with separate provider quotas',
        whenItWins:
          'Always, once classes exist. The bulkhead is the only thing that guarantees isolation.',
        whenItLoses:
          'Never — though the provider-quota half is the part teams omit, so transactional sends are still throttled by marketing volume.',
        cost:
          'More queues and worker pools to operate, and quota allocation per class.',
      },
      {
        option: 'Fan-out on write for every channel',
        whenItWins:
          'For push, email and SMS — they are pushed by definition, so there is no read-time merge available.',
        whenItLoses:
          'For in-app, where writing 100,000 feed rows for one event is avoidable.',
        cost:
          'Write amplification proportional to audience size.',
      },
      {
        option: 'Fan-out on read for in-app',
        whenItWins:
          'Large audiences on a pull channel. Store the event once and merge at query time.',
        whenItLoses:
          'When the feed query becomes expensive, or when read volume vastly exceeds write volume.',
        cost:
          'A more complex feed query, and per-user read state to track separately.',
      },
      {
        option: 'Silent channel fallback on failure',
        whenItWins:
          'Rarely. Occasionally justified for a critical transactional notification where any channel is better than none.',
        whenItLoses:
          'Generally. The user chose push; substituting email is a product decision disguised as error handling.',
        cost:
          'Users receive channels they declined, and the failure is hidden rather than surfaced.',
      },
      {
        option: 'Record the failure, no fallback',
        whenItWins:
          'The default. The failure is visible, and fallback becomes an explicit user preference if wanted.',
        whenItLoses:
          'When a critical notification silently fails and nobody looks at the dead-letter queue.',
        cost:
          'A DLQ that must be alerted on and owned, or it is equivalent to dropping the message.',
      },
      {
        option: 'Drain the backlog after an outage',
        whenItWins:
          'Nowhere, unenriched. It is what produces 60 emails at 4am.',
        whenItLoses:
          'Always, at any meaningful backlog size.',
        cost:
          'A burst of stale notifications, possibly during quiet hours.',
      },
      {
        option: 'A staleness policy per class',
        whenItWins:
          'Always. Transactional sends late, social folds into a digest, marketing drops.',
        whenItLoses:
          'Never, though it needs a decision per class that someone must own.',
        cost:
          'Some notifications are deliberately never delivered, which must be recorded and defensible.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The producer sends the notification with the channel and the message text."',
      whyWeak:
        'It puts preference logic and copy in every producing service. Adding a channel means changing every producer; localising a message means a producer deploy; and each service must know about quiet hours and mutes. The coupling is total.',
      strongAnswer:
        '"The producer sends a fact: a type, structured data, a class and a recipient or audience reference — no channel and no copy. The notification system decides the channel from preferences and renders from a template. That way no other service needs preference logic, and a copy or localisation change does not require a producer deploy."',
    },
    {
      weakAnswer: '"We check the user\'s preferences when the notification is created."',
      whyWeak:
        'The gap between creation and delivery can be hours. A user who mutes a thread at 14:00 still receives notifications created at 13:58, which is exactly the behaviour they muted to prevent — and the functional requirement "users can mute a thread" was implemented correctly.',
      strongAnswer:
        '"Preferences must be evaluated at delivery time, because the gap between creation and delivery can be hours and a mute should take effect on everything not yet sent. That puts preference state on the delivery path — one combined read per user, cached with a short TTL — and it means the policy store failing has to fail closed, since sending to a muted user is worse than sending late."',
      },
    {
      weakAnswer: '"One queue, with workers for each channel reading from it."',
      whyWeak:
        'A batch of 5 million marketing notifications sits ahead of a password reset, which then arrives in 40 minutes. Heterogeneous urgency in one queue guarantees the urgent class waits behind the unimportant one.',
      strongAnswer:
        '"Separate queues per class — transactional, social, digest — with separate worker pools. And the part usually omitted: separate provider quotas too, because if marketing consumes the email provider\'s rate allowance then transactional sends are throttled by the provider even with separate internal queues. The isolation has to extend to the shared external resource."',
    },
    {
      weakAnswer: '"If push fails we fall back to email so the user still gets it."',
      whyWeak:
        'The user chose push and declined email. Substituting a channel they turned off is a product decision made inside error-handling code, and it will generate complaints from users who deliberately disabled email.',
      strongAnswer:
        '"No silent fallback. The user chose that channel, so a failure is recorded with a reason and surfaced rather than rerouted. If fallback is genuinely wanted it should be an explicit preference — \'email me if push fails\' — so the user opted into it. And a stale device token is a permanent failure, not a retryable one: mark the token invalid rather than retrying."',
    },
    {
      weakAnswer: '"Failed notifications go to a dead-letter queue so nothing is lost."',
      whyWeak:
        'A dead-letter queue nobody watches is equivalent to dropping the message, and if the original payload and key are not preserved you cannot replay from it after fixing the bug.',
      strongAnswer:
        '"A DLQ needs three things to be real: an alert on its depth with a named owner and a runbook, the original request and recipient preserved, and a tool to replay from it. Without those it is a place notifications go to be forgotten — and the existence of the queue makes people believe the problem is handled."',
    },
    {
      weakAnswer: '"After an outage the workers catch up on the backlog."',
      whyWeak:
        'Two hours of accumulated notifications delivered at once, potentially at 4am, produces a burst of stale notifications during quiet hours. A queue drain is not a recovery plan.',
      strongAnswer:
        '"Recovery needs a staleness policy per class. Transactional notifications are still wanted, so send them. Social notifications older than an hour fold into a digest instead of arriving as sixty separate messages. Marketing older than its window is dropped. And quiet hours still apply during recovery, so a backlog completing at 4am is deferred rather than delivered — otherwise the recovery is itself the incident."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hn-1',
      front: 'What is the structural separation this design is built on?',
      back: '"Something happened" versus "someone must be told". An event is a fact; a notification is a decision derived from it plus preferences, channel, locale and rate limits.',
      topic: 'multi-channel',
    },
    {
      id: 'fc-hn-2',
      front: 'What must the producer NOT send, and why?',
      back: 'No channel and no copy. Otherwise every producing service needs preference logic, and a copy or localisation change requires a producer deploy.',
      topic: 'multi-channel',
    },
    {
      id: 'fc-hn-3',
      front: 'Why must preferences be evaluated at delivery rather than creation?',
      back: 'The gap can be hours. A mute at 14:00 should suppress a notification created at 13:58 — which creation-time evaluation cannot do.',
      topic: 'preferences',
    },
    {
      id: 'fc-hn-4',
      front: 'What does delivery-time preference evaluation cost?',
      back: 'Preference state on the delivery path, cached with a staleness window, plus a fail-closed policy when the store is unavailable.',
      topic: 'preferences',
    },
    {
      id: 'fc-hn-5',
      front: 'Why does the policy store fail *closed*?',
      back: 'Because sending to a muted user is worse than sending late. The complaint-generating failure is an unwanted notification, not a delayed one.',
      topic: 'preferences',
    },
    {
      id: 'fc-hn-6',
      front: 'What are the three deduplication layers?',
      back: 'The producer\'s event id; a unique constraint on (request, user, channel); and a per-send dedup record written before the provider call.',
      topic: 'deduplication',
    },
    {
      id: 'fc-hn-7',
      front: 'Why write the dedup record before sending an email rather than after?',
      back: 'An email cannot be un-sent. Recording first accepts a rare loss in exchange for never duplicating — and a duplicate is unbounded while a loss is single and reconcilable.',
      topic: 'deduplication',
    },
    {
      id: 'fc-hn-8',
      front: 'What is the second, product-level meaning of deduplication here?',
      back: 'Aggregation. Three comments in a minute should be one notification saying "3 new comments" — which requires holding a notification back to see whether more arrive.',
      topic: 'deduplication',
    },
    {
      id: 'fc-hn-9',
      front: 'Why are per-class queues insufficient on their own?',
      back: 'The provider quota is shared. If marketing consumes the email provider\'s rate allowance, transactional sends are throttled externally despite separate internal queues.',
      topic: 'fan-out',
    },
    {
      id: 'fc-hn-10',
      front: 'How is a 100,000-recipient fan-out made safe?',
      back: 'Chunked with a cursor continuation so tasks are bounded and resumable; routed to a rate-limited bulk pool so it cannot starve ordinary traffic; and batched at the provider boundary where the channel allows.',
      topic: 'fan-out',
    },
    {
      id: 'fc-hn-11',
      front: 'Why can in-app use fan-out on read while other channels cannot?',
      back: 'In-app is the only pull channel. Push, email and SMS are pushed by definition, so there is no read-time merge available for them.',
      topic: 'fan-out',
    },
    {
      id: 'fc-hn-12',
      front: 'How do the three channels scale differently?',
      back: 'Push scales by batching hundreds per call; email by provider throughput and sender reputation, which takes weeks to warm; SMS by money.',
      topic: 'multi-channel',
    },
    {
      id: 'fc-hn-13',
      front: 'Why is `suppressed` a first-class status with a reason?',
      back: 'A deliberate non-send differs from a failure and from never existing. Recording the reason is what makes "why didn\'t I get this?" answerable.',
      topic: 'preferences',
    },
    {
      id: 'fc-hn-14',
      front: 'Why is draining a backlog not a recovery plan?',
      back: 'Two hours of accumulated notifications delivered at once, possibly at 4am. Recovery needs a per-class staleness policy: transactional sends, social digests, marketing drops.',
      topic: 'dead-letter',
    },
  ],

  quiz: [
    {
      id: 'q-hn-1',
      kind: 'scenario',
      prompt:
        'A user mutes a thread at 14:00. A notification for that thread was created at 13:58 and is still queued. It arrives at 14:05. What is the design defect?',
      options: [
        { id: 'a', label: 'Preferences are evaluated at creation rather than delivery — the mute cannot affect notifications already in flight' },
        { id: 'b', label: 'The mute did not propagate to the preference store fast enough' },
        { id: 'c', label: 'The queue is too slow and should deliver within seconds' },
        { id: 'd', label: 'Nothing; the notification predates the mute so it should be delivered' },
      ],
      correct: ['a'],
      explanation:
        'The functional requirement "users can mute a thread" was implemented correctly; the specification omitted *when* the preference is evaluated. Evaluating at delivery puts preference state on the delivery path and makes the mute effective on everything not yet sent — which is what the user expects.',
      difficulty: 'core',
      topic: 'preferences',
    },
    {
      id: 'q-hn-2',
      kind: 'scenario',
      prompt:
        'A password reset arrives 40 minutes after being requested. A 5-million-message marketing batch was enqueued shortly before. What is the fix, and what is the part usually omitted?',
      options: [
        { id: 'a', label: 'Separate queues and workers per class — and separate provider quotas, since a shared email quota throttles transactional sends anyway' },
        { id: 'b', label: 'More workers on the single queue' },
        { id: 'c', label: 'Priority ordering within the single queue' },
        { id: 'd', label: 'Rate-limit the marketing producer' },
      ],
      correct: ['a'],
      explanation:
        'A bulkhead is the only guarantee: separate queues with separate workers. The commonly-omitted half is the external resource — if marketing consumes the email provider\'s rate allowance, transactional sends are throttled by the provider despite internal isolation. Priority within one queue does not help messages already ahead in it.',
      difficulty: 'advanced',
      topic: 'fan-out',
    },
    {
      id: 'q-hn-3',
      kind: 'scenario',
      prompt:
        'An email worker sends, then commits its queue offset. It crashes between the two. What happens, and what prevents it?',
      options: [
        { id: 'a', label: 'The message is redelivered and a duplicate email is sent — prevented by a dedup record written and committed before the send' },
        { id: 'b', label: 'The message is lost, since the offset was not committed' },
        { id: 'c', label: 'Nothing; the broker deduplicates redelivered messages' },
        { id: 'd', label: 'The email provider deduplicates on the recipient address' },
      ],
      correct: ['a'],
      explanation:
        'Commit-after-send gives at-least-once, so a crash in the window causes a duplicate. The record must be written *before* the send because an email cannot be un-sent — accepting a rare loss to avoid an unbounded duplicate. Broker deduplication windows are narrow and do not cover this, and providers do not deduplicate distinct messages.',
      difficulty: 'core',
      topic: 'deduplication',
    },
    {
      id: 'q-hn-4',
      kind: 'scenario',
      prompt:
        'One event has 100,000 recipients. Total system capacity is 15,000 notifications/second. What are the three problems?',
      options: [
        { id: 'a', label: 'An unbounded fan-out task, starvation of ordinary notifications, and provider rate limits at the delivery stage' },
        { id: 'b', label: 'Storage growth, index bloat, and query latency' },
        { id: 'c', label: 'Duplicate delivery, ordering violations, and missing preferences' },
        { id: 'd', label: 'Only starvation; the other stages scale linearly' },
      ],
      correct: ['a'],
      explanation:
        'Expanding 100,000 recipients in one task takes minutes and restarts from zero on a crash; 100,000 queued deliveries put ordinary notifications behind them; and the provider limit binds at the send stage. The fixes are chunked fan-out with a cursor, a rate-limited bulk pool, and provider batching where the channel supports it.',
      difficulty: 'advanced',
      topic: 'fan-out',
    },
    {
      id: 'q-hn-5',
      kind: 'scenario',
      prompt:
        'The policy store — holding preferences, mutes and quiet hours — becomes unavailable. What should the pipeline do?',
      options: [
        { id: 'a', label: 'Fail closed: hold notifications rather than send them, because sending to a muted user is worse than sending late' },
        { id: 'b', label: 'Fail open: send everything, since a late notification is worse than an unwanted one' },
        { id: 'c', label: 'Send transactional notifications only and drop the rest' },
        { id: 'd', label: 'Fall back to the last cached preferences indefinitely' },
      ],
      correct: ['a'],
      explanation:
        'This inverts the usual fail-open advice and is correct here: the complaint-generating failure is an unwanted notification, not a delayed one. Option d is a reasonable *partial* answer — a short-TTL cache absorbs a brief outage — but relying on an indefinitely stale cache eventually sends to users who have since muted.',
      difficulty: 'advanced',
      topic: 'preferences',
    },
    {
      id: 'q-hn-6',
      kind: 'multi',
      prompt:
        'Which are true about recovering from a two-hour outage? Select all that apply.',
      options: [
        { id: 'a', label: 'Transactional notifications should still be delivered, since they are probably still wanted' },
        { id: 'b', label: 'Social notifications should fold into a digest rather than arrive as dozens of messages' },
        { id: 'c', label: 'Quiet hours still apply, so a backlog completing at 4am is deferred' },
        { id: 'd', label: 'Draining the queue as fast as possible is the correct recovery' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the per-class staleness policy that makes recovery safe. The fourth is what produces sixty emails at 4am — a queue drain is not a recovery plan, and without a staleness policy the recovery becomes the incident.',
      difficulty: 'core',
      topic: 'dead-letter',
    },
  ],

  exercises: [
    {
      id: 'ex-hn-1',
      kind: 'design',
      title: 'Write the policy layer, then break it',
      estimatedMinutes: 40,
      prompt: `The design above sketches the policy layer. Specify it properly.

**Part 1.** Write the exact decision sequence a notification passes through in the policy layer, in order, with what each step reads and what it does on a match. Include: unsubscribe, mute, channel preference, quiet hours, per-user rate limit with aggregation, and staleness.

**Part 2.** For each of these five situations, say what your policy layer does and why:

1. A user has quiet hours 22:00–08:00 and a password reset is requested at 02:00.
2. A user receives 40 "someone liked your photo" notifications in five minutes.
3. A user has muted a thread but is directly @-mentioned in it.
4. A user's timezone is unknown (never set).
5. A notification's rendered content depends on data that has since been deleted.

Then answer:

- Which two policy steps could be reordered without changing behaviour, and which orderings are load-bearing?
- Where does the aggregation step store state, and what breaks if that store is unavailable?
- Which of the five situations is a product decision you would escalate rather than decide?`,
      rubric: [
        'Decision sequence is ordered with a stated reason for the order.',
        'Each step names what it reads and its action on match.',
        'Quiet hours are computed in the user\'s timezone, with a fallback for unknown.',
        'Transactional notifications override quiet hours, with the reasoning given.',
        'Aggregation is described concretely with a hold window and a state store.',
        'The @-mention case identifies a conflict between mute and direct address.',
        'Staleness is per class and includes a "referenced data deleted" case.',
        'Identifies which orderings are load-bearing (cheapest/most-absolute first).',
        'Aggregation-store failure has a stated fail direction.',
        'Escalates at least one case explicitly as a product decision.',
      ],
      modelAnswer: `**Part 1 — the decision sequence**

Ordered **most absolute first, cheapest first**, so an unsubscribed user costs one lookup rather than six.

\`\`\`
INPUT: delivery row (request_id, user_id, channel, class, created_at, entity_ref)

STEP 0 — Load the combined policy document
  Reads:  user_preferences.doc  (one read, cached 60 s)
  Miss:   FAIL CLOSED — requeue with backoff, do not send
  Why one read: the estimate showed 3 separate lookups at 15,000/s
                would make this stage the bottleneck

STEP 1 — Unsubscribed from the category?
  Reads:  doc.unsubscribed[]
  Match:  status = suppressed, reason = unsubscribed. STOP.
  Why first: it is the most absolute — a legal/consent boundary in
             many jurisdictions, and it overrides everything including
             transactional in some categories. Never overridden.

STEP 2 — Is the channel enabled for this category?
  Reads:  doc.categories[type][channel]
  Match (disabled): status = suppressed, reason = channel_disabled. STOP.
  Why here: it is a per-channel decision, so it prunes work before any
            of the more expensive per-entity or time-based checks.

STEP 3 — Muted entity?
  Reads:  doc.muted[]  vs  delivery.entity_ref
  Match:  status = suppressed, reason = muted. STOP.
          EXCEPTION: if delivery.is_direct = true, continue (see Part 2.3)

STEP 4 — Stale?
  Reads:  delivery.created_at, class staleness policy
  transactional:  no limit — still send
  social:         > 1 hour → route to digest, reason = stale_digested
  digest/mktg:    > window → suppressed, reason = stale_dropped
  Why before quiet hours: no point computing a deferral window for
                          something we are about to drop

STEP 5 — Per-user rate limit + aggregation
  Reads:  rate:{user_id}:{hour} counter, and agg:{user_id}:{entity} state
  Under limit:  increment, continue
  Over limit:   fold into the pending digest for this user,
                status = suppressed, reason = rate_limited_digested
  ALSO: if 2+ notifications for the SAME entity are pending within
        a 60 s hold window → aggregate them into one
  Why after staleness: a stale notification should not consume quota

STEP 6 — Quiet hours?
  Reads:  doc.quietHours {start, end, tz}
  Compute: now, converted to the user's tz
  In window AND class != transactional:
          defer: scheduled_for = window end, requeue. STOP.
  In window AND class == transactional:
          continue — send anyway (see Part 2.1)
  Why last: it is the only step that DEFERS rather than suppresses,
            so everything that would have been dropped is already gone

STEP 7 — Write the dedup record, then hand to the channel worker
  Reads/writes: dedup:{request_id}:{user_id}:{channel}  SETNX, 24 h TTL
  Already present: this is a redelivery. STOP, no send.
  Absent:  record it, commit, then enqueue to the per-class queue
\`\`\`

**Why this order, stated as a rule:** absolute and cheap checks first, deferral last. **Every step before 6 either passes or terminates; only step 6 can put the notification back for later**, so it must come after everything that could have removed it — otherwise you schedule a deferral for a notification you were going to drop.

**Part 2 — the five situations**

**1. Quiet hours 22:00–08:00, password reset at 02:00 → SEND.**

Step 6 checks the class. Transactional notifications override quiet hours.

*Why:* a password reset is requested by the user, in that moment, and they are waiting for it. Deferring it to 08:00 makes the product broken rather than considerate. **The user's quiet-hours setting is an instruction about *unsolicited* notifications**, and a response to their own action is not unsolicited.

*The general rule I would write down:* **quiet hours apply to notifications the system initiates, not to responses to a user action.** Order confirmations, password resets, security alerts and two-factor codes all send. Comments, likes and follows defer.

*And one refinement:* a *security alert* — "a new device signed into your account" — should send at 02:00 even though the user did not initiate it, because the whole value is immediacy. **So the rule is really about urgency, and "transactional" is a proxy for it.** I would make the override an explicit per-type flag, \`ignores_quiet_hours\`, rather than deriving it from the class — because the class is a routing decision and this is a semantic one, and conflating them means a new urgent type inherits the wrong behaviour.

**2. Forty "someone liked your photo" in five minutes → AGGREGATE to one.**

Step 5 does two things here, and both fire.

**The hold window catches the burst.** Notifications for the same entity — \`photo:p_991\` — within a 60-second window are folded: instead of 40 sends, one send saying **"40 people liked your photo"**.

**The rate limit catches the rest.** If likes continue past the hold window, the per-user hourly cap (10) is reached and further notifications fold into the pending digest.

*The mechanism, concretely:*

\`\`\`
agg:{user_id}:{entity}:{type}  →  { count, first_seen, sample_actors[3] }
  TTL 60 s, refreshed on each new arrival up to a 5-minute maximum

On first arrival:  create the record, schedule a send at +60 s
On subsequent:     increment count, append actor if fewer than 3,
                   refresh the window (but not past the 5-min cap)
At window expiry:  render "X and N others liked your photo", send once
\`\`\`

**The 5-minute cap on window refresh is the detail that matters.** Without it, a photo receiving a like every 50 seconds never sends a notification at all — the window keeps extending. **A refreshing window with no maximum is a notification that never arrives**, which is a worse failure than sending 40.

*Cost:* every aggregatable notification now waits up to 60 seconds. **That is a deliberate latency sacrifice for social notifications and it must be stated** — it would be unacceptable for transactional, which is another reason aggregation is class-scoped.

**3. Muted thread but directly @-mentioned → SEND, and this is the interesting one.**

Step 3 has an exception for \`is_direct\`.

*Why:* muting a thread means "stop telling me about activity in this thread". Being directly addressed is different in kind — someone is asking you something. **Suppressing a direct mention because of a thread mute is the behaviour that makes users distrust the mute feature**, because they mute to reduce noise and then miss something addressed to them.

*But this is genuinely contested, and I would say so.* Some users mute a thread precisely because they want *nothing* from it, including mentions — a heated argument they have withdrawn from. **So the honest design is a third mute level:**

\`\`\`
mute: "activity"  →  suppress activity, deliver direct mentions  (default)
mute: "all"       →  suppress everything including mentions
\`\`\`

*And the architectural consequence:* \`is_direct\` must be computed by the **producer**, because only the commenting service knows the mention was directed at this user. So it becomes a field on the notification request — which means the producer interface needs it, and adding it later is a change to every producer.

**That is worth noticing: a product nuance about mute semantics reaches all the way back into the producer contract.**

**4. Timezone unknown → treat quiet hours as inactive, and record it.**

Step 6 needs a timezone and has none. Three options:

**Option A — infer from the last request's IP or the device.** Reasonable and unreliable; a user travelling gets the wrong window.

**Option B — default to a fixed timezone (UTC or the account's country).** Predictable and wrong for anyone outside it, so a user in Tokyo gets notifications at their 07:00 with a UTC 22:00–08:00 window.

**Option C — treat quiet hours as inactive when the timezone is unknown, and prompt the user to set it.**

**I would choose C, with a caveat.** Deferring on a guessed timezone means either sending during someone's night (bad) or holding notifications for hours unnecessarily (also bad). **Sending is the recoverable error and holding is not** — a user who receives a notification at an awkward hour is mildly annoyed; a user whose notifications are held for eight hours because we guessed wrong may miss something.

*The caveat:* if quiet hours are explicitly *set* but the timezone is missing, that is an inconsistent state and I would infer aggressively from the device, because the user has expressed the intent. **The unknown-timezone default only applies when quiet hours were never configured.**

*And the record:* \`reason = quiet_hours_skipped_no_tz\` on the delivery, so this is measurable. If it is 5% of deliveries, prompting for timezone becomes a product priority.

**5. Rendered content depends on deleted data → SUPPRESS, with a specific reason.**

The comment was deleted; the notification "Alice commented: <text>" cannot be rendered.

*The mechanism:* the channel worker renders at send time from the \`entity_ref\`, and a render failure due to missing data is **not** a retryable error. It is terminal:

\`\`\`
status = suppressed, reason = source_deleted
\`\`\`

*Why render at send time rather than at creation:* because content can change or be deleted between creation and delivery, and delivering "Alice commented: [deleted]" or stale text is worse than delivering nothing. **This is the same argument as evaluating preferences at delivery time** — anything that can change between decision and delivery must be resolved at delivery.

*Why not retry:* the data is not coming back. Retrying a missing-entity render for 24 hours and then dead-lettering it wastes work and fills the DLQ with items nobody will act on. **Distinguishing terminal from retryable failures is what keeps a DLQ meaningful.**

*One exception worth naming:* if the entity is missing because of *replication lag* rather than deletion, retry is correct. So the check must distinguish "not found and the tombstone exists" from "not found, and might appear". **In practice: retry twice with a short delay, then treat as terminal** — cheap, and it covers the lag case without holding items for a day.

---

**Which two steps could be reordered, and which orderings are load-bearing?**

**Freely reorderable: steps 1, 2 and 3** (unsubscribe, channel disabled, muted). All three are absolute suppressions read from the same cached document, all cost nothing, and all terminate. **Any order produces the same outcome**, and I ordered them by how absolute they are for readability rather than for behaviour.

**Load-bearing orderings, and there are three:**

**Step 0 before everything.** Obviously — nothing can be evaluated without the document. And its fail-closed behaviour is what makes the rest safe.

**Step 4 (staleness) before step 5 (rate limit).** If a stale notification consumed the user's hourly quota, then a backlog of old notifications after an outage would exhaust every user's allowance and suppress the *fresh* notifications behind them. **Reversing these two turns a recovery into a second incident**, and it is a subtle enough error that I would comment the code.

**Step 6 (quiet hours) last.** It is the only step that **defers** rather than suppresses. If it ran earlier, we would schedule a 08:00 delivery for notifications that steps 4 or 5 would have dropped — so at 08:00 a pile of deferred notifications would arrive, be evaluated for staleness, and be dropped. **Wasted scheduling, wasted storage, and a confusing audit trail.**

**Step 7 (dedup) last, immediately before the send.** If the dedup record were written earlier, a notification suppressed by quiet hours would have consumed its dedup slot — and when the deferred copy arrives it would be treated as a redelivery and dropped. **The dedup record must be written only for notifications that are actually about to be sent.**

*The general principle:* **suppressions can be in any order; the deferral must be last, and the dedup record must be adjacent to the send.**

**Where does aggregation state live, and what breaks if it is unavailable?**

**Redis**, keyed \`agg:{user_id}:{entity}:{type}\`, with the count, first-seen timestamp, and up to three sample actor names for rendering. Plus a scheduled-send mechanism — either a sorted set scored by send time that a worker polls, or a delayed message per aggregation window.

*Why Redis and not the database:* the access pattern is a read-modify-write on a short-lived key at up to 15,000/second. That is a Redis workload, and the state is genuinely ephemeral — a 60-second window with a 5-minute cap.

*Why the send schedule must be durable, though.* If the scheduled send lives only in Redis and Redis loses it, the aggregated notification never sends and the 40 likes produce nothing. **That is a silent total loss, which is worse than sending 40 separate notifications.** So the aggregation *state* can be ephemeral while the *obligation to send* must not be — I would write a \`pending_aggregations\` row in the database when the window opens, and clear it when the send completes, with a sweeper for orphans.

**If Redis is unavailable, three behaviours are possible:**

**Fail open on aggregation — send each notification individually.** The user gets 40 notifications. Noisy, and nothing is lost.

**Fail closed — hold everything until Redis returns.** Nothing is sent; if Redis is down for an hour, an hour of social notifications are held, and then the staleness policy folds them into a digest anyway.

**Hybrid: aggregate optimistically, degrade to individual sends after a short retry.** Try Redis twice; on failure, send individually.

**I would choose the hybrid, and it is the opposite direction from the policy store.** The reasoning: the *policy* store failing risks sending something the user muted — a correctness failure. The *aggregation* store failing risks sending too many of something the user *did* want — a quality failure. **A correctness failure justifies failing closed; a quality failure does not.**

*And the per-user rate limit shares this store*, which is the complication. If the rate-limit counter is unavailable and we fail open on it, a user could receive far more than 10 per hour. **So I would split them:** aggregation state fails open (send individually), and the rate-limit counter fails *closed* to a conservative local cap — each policy worker allows a small number per user per minute from local memory, which bounds the damage without needing Redis.

**Which situation would I escalate as a product decision?**

**Situation 3, the muted thread with a direct mention** — and I would escalate it rather than decide it.

*Why it is not mine to decide:* both behaviours are defensible and they encode different beliefs about what "mute" means. Delivering the mention respects the direct address; suppressing it respects the mute absolutely. **Users hold both views strongly**, and getting it wrong in either direction produces complaints that are about product intent rather than about correctness.

*What I would bring to the escalation, rather than just the question:*

- **The two options, with the third-level mute as a proposal** — because "mute activity" versus "mute all" resolves the disagreement rather than picking a side.
- **The architectural cost of the third level:** \`is_direct\` must be computed by the producer, so it is a change to the producer contract and to every producing service. **That cost is the reason to decide now rather than later**, and it is the thing a product owner cannot know without being told.
- **A default recommendation:** mute activity, deliver mentions, because it is the less surprising behaviour for the majority and the more restrictive option remains available.

*Situation 1 is the near-miss.* Whether a security alert overrides quiet hours is also a product question, and I would decide it myself with the \`ignores_quiet_hours\` flag — because the flag makes it configurable per type rather than baked in, so product can change it without an architecture change. **The distinction is whether the decision can be made cheap and reversible: if it can, decide it and make it a setting; if it reaches into another team's contract, escalate it.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hn-1',
      level: 'basic',
      question: 'Design a notification system. What does the producer send?',
      guidance:
        'A fact — type, structured data, class, recipient or audience reference — with no channel and no copy. Look for the reason: otherwise every service needs preference logic and copy changes require producer deploys.',
    },
    {
      id: 'iq-hn-2',
      level: 'basic',
      question: 'How do you prevent duplicate notifications?',
      guidance:
        'Three layers: the producer\'s event id, a unique constraint on (request, user, channel), and a per-send dedup record. A strong answer notes the constraint is strongest because no code path can bypass it.',
    },
    {
      id: 'iq-hn-3',
      level: 'intermediate',
      question: 'When are user preferences evaluated, and why does it matter?',
      guidance:
        'At delivery, because the gap from creation can be hours and a mute should suppress in-flight notifications. Look for the cost being named: preference state on the delivery path, cached, failing closed.',
    },
    {
      id: 'iq-hn-4',
      level: 'intermediate',
      question: 'A password reset arrives 40 minutes late. What went wrong?',
      guidance:
        'One queue for heterogeneous classes. A strong answer proposes per-class queues *and* per-class provider quotas, since a shared email allowance throttles transactional sends regardless of internal isolation.',
    },
    {
      id: 'iq-hn-5',
      level: 'advanced',
      question: 'One event has 100,000 recipients. Walk me through it.',
      guidance:
        'Chunked fan-out with a cursor, a rate-limited bulk pool, and provider batching. Excellent answers note that in-app can fan out on read while push, email and SMS cannot, and that the three channels scale by different mechanisms.',
    },
    {
      id: 'iq-hn-6',
      level: 'advanced',
      question: 'You have been down for two hours. How do you recover?',
      guidance:
        'A per-class staleness policy, not a queue drain: transactional sends, social digests, marketing drops, and quiet hours still apply. Excellent answers note that staleness must be evaluated before the rate limit or the backlog exhausts everyone\'s quota.',
    },
    {
      id: 'iq-hn-7',
      level: 'followup',
      question: 'Push fails for a user. Do you send an email instead?',
      guidance:
        'No — the user chose push and may have declined email. Record and surface the failure; make fallback an explicit preference if wanted. A strong answer distinguishes a stale device token as terminal rather than retryable.',
    },
    {
      id: 'iq-hn-8',
      level: 'followup',
      question: 'The preference store is unavailable. Fail open or closed?',
      guidance:
        'Closed — sending to a muted user is worse than sending late. A strong answer contrasts this with the aggregation store, which should fail open, and explains the distinction as correctness failure versus quality failure.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hn-1',
      kind: 'what-changes-if',
      prompt:
        'This design assumed notifications are sent to your own users. Now change one thing: you are building notifications-as-a-service for other companies, who send to *their* users. What changes?',
      discussion: `Becoming a platform changes the ownership of every policy decision, and that is a larger shift than it first appears.

**What becomes the customer's decision rather than yours.**

**Preference semantics.** You no longer decide what "mute" means or whether a direct mention overrides it — your customers do, and they will disagree with each other. **So the policy layer must become configurable rather than opinionated**, which means preferences are a schema your customers define rather than a document you designed. That is a substantially harder problem than the fixed document in this design.

**Quiet hours and rate limits.** One customer wants a 10-per-hour cap; another sends transactional-only and wants none. **Every policy step becomes a per-tenant configuration**, and the policy layer becomes an evaluator of customer-supplied rules rather than a fixed sequence.

**Templates and localisation.** Your customers own the copy, so you need a templating system with their variables, their locales, and a preview and test mechanism — which is a product surface this design did not have at all.

**What becomes harder, structurally.**

**Provider reputation becomes shared and dangerous.** This is the biggest change. If you send email on behalf of 500 customers from your own sending domains, **one customer's spam destroys deliverability for all of them.** So you need: per-customer sending domains with their own reputation, or aggressive content and consent screening, or both. **This is the platform's central operational risk and it has no analogue in the single-tenant design.**

**Per-tenant isolation becomes mandatory, not optional.** One customer's 50-million-recipient campaign must not delay another customer's password resets. The per-class queues from this design become **per-class *and* per-tenant**, or at least per-class with per-tenant concurrency limits — which is the rate-limiting lesson's blast-radius argument arriving as an availability requirement.

**Consent and legal obligations transfer partially to you.** You are sending on someone's behalf, and unsubscribe handling, consent records and deletion rights are now a compliance surface you share. **An unsubscribe must be honoured across every customer** — or at minimum, per customer with an auditable record — and that has to be enforced by the platform rather than trusted to the tenant.

**Metering and billing enter the pipeline.** Every send is a billable event, so the delivery record becomes financial data with the durability requirement that implies. **A lost delivery record is now lost revenue or an over-charge.**

**What stays exactly the same.**

**The pipeline shape.** Producer → fan-out → policy → per-class queues → channel workers. Unchanged, because it follows from the separation of fact and decision rather than from who owns the users.

**The three deduplication layers**, and the customer's event id becomes their idempotency key — which must be documented as part of your API contract, exactly as Stripe documents theirs.

**Delivery-time preference evaluation**, and it matters more: a customer's user unsubscribing must take effect on in-flight notifications, and getting that wrong is now a compliance problem rather than an annoyance.

**Staleness and recovery policy**, though the values become per-tenant configuration.

**And the new thing that dominates the roadmap: the customer-facing contract.**

You now owe your customers what Stripe owes its webhook consumers: **published delivery guarantees, a queryable event history, delivery-status webhooks so they know what happened, and documented retry behaviour.** A customer cannot build on your platform without knowing whether you deliver at-least-once, how long you retry, and how to reconcile.

**The delivery-status feedback loop is the feature that turns this from a queue into a platform.** Bounces, complaints, opens, unsubscribes — flowing back to the customer, and also flowing back into your own suppression list so a hard-bounced address is never retried across any tenant.

**What I would build first, and it is not the pipeline.** The pipeline is the part this design already covers. **The first platform-specific things are per-tenant isolation, per-tenant sending reputation, and the delivery-status feedback loop** — because those three are the ones that make the platform viable rather than merely functional, and none of them exists in the single-tenant version.

**The transferable point.** A multi-tenant version of a system is rarely the same system with a tenant id added. **The policies that were decisions become configuration, the shared external resources become the blast-radius problem, and the contract with consumers becomes a first-class product surface.** The transport was never the hard part, and in the platform version it is an even smaller fraction of the work.`,
    },
    {
      id: 'al-hn-2',
      kind: 'debug',
      prompt:
        'A notification system built to this design is in production. Complaints: a small number of users report receiving no notifications at all for several days, while their in-app feed shows the notifications correctly. Delivery metrics are normal, the DLQ is empty, and no errors are logged. Diagnose it.',
      discussion: `In-app works and push and email do not, for a small number of users, with no errors anywhere. In-app is the channel that bypasses the provider — it is written directly to a database table — so the divergence localises the fault to everything downstream of the queue split, or to the policy layer treating those channels differently.

**Hypothesis 1 — those users are being suppressed, and suppression is not an error.** This is the leading candidate and it explains every observation.

If step 2 (channel enabled?) is suppressing push and email for these users, the deliveries are marked \`suppressed\` with a reason, no error is logged, the DLQ stays empty, and the in-app channel still works because it was enabled. **Delivery metrics look normal because suppression is normal behaviour.**

*How it could happen without the user doing it:* a preferences migration that defaulted a category's channels to false; a bug in the preferences \`PUT\` that overwrites the whole document rather than merging, so setting one preference clears the rest; or a client sending a partial document.

*Check:* query \`deliveries\` for those users over the period, grouped by \`status\` and \`suppressed_reason\`. **This is a single query and it should be conclusive** — and it is only possible because suppression was recorded as a first-class status with a reason rather than being a silent skip. **The design decision that makes this diagnosable in one query is the one being tested here.**

**Hypothesis 2 — quiet hours are permanently active because of a timezone problem.** If a user's quiet hours are 22:00–08:00 and their timezone is stored wrongly — or the conversion has a bug that makes the window evaluate as always-true — every non-transactional notification defers forever, being rescheduled each time.

*Why it fits:* no errors, DLQ empty, in-app unaffected if in-app bypasses quiet hours (which it should, since an in-app notification is not intrusive). **And "several days" is characteristic of a permanent condition rather than a transient one.**

*Check:* those users' \`quietHours\` and timezone values, and whether any deliveries have \`scheduled_for\` timestamps repeatedly in the future. A notification deferred more than once is the signature.

**Hypothesis 3 — hard-bounced or invalidated contact details.** If a user's email hard-bounced, a well-behaved system adds them to a suppression list and stops sending — correctly. Similarly a push token marked invalid stops being used. **If the user has since fixed their email but the suppression was never cleared, they are permanently suppressed.**

*Why it fits:* no errors (we are not attempting the send), DLQ empty, in-app fine. And it explains "a small number of users" precisely — bounce rates are small percentages.

*Check:* the provider suppression list and the device-token status for those users. **And whether there is any mechanism to clear a suppression**, because a suppression list with no removal path is a permanent ban applied silently.

**Hypothesis 4 — the per-user rate limit counter is stuck.** If the hourly counter's TTL failed to be set — the Redis lesson's missing-expiry problem — the counter never resets, so every notification after the first 10 is folded into a digest forever. And if the digest itself is not being sent (see hypothesis 5), they receive nothing.

*Check:* the TTL on those users' rate-limit keys. \`TTL\` returning -1 is conclusive, and it is a class of bug the Redis lesson specifically warned about.

**Hypothesis 5 — the digest is not being sent.** If notifications are correctly folded into a digest but the digest scheduler is broken for some users, everything aggregates and nothing ever delivers. **A pending aggregation with a window that keeps refreshing** — the 5-minute-cap bug from the exercise — produces exactly this: notifications accumulate, the send is always in the future, and nothing errors.

*Check:* pending aggregation records for those users, and whether any have a first-seen timestamp days old. **A pending aggregation older than its cap is the signature.**

**What I would check first: the deliveries table for those users, grouped by status and suppression reason.** One query, and it distinguishes suppression (hypotheses 1, 3, 4) from deferral (hypothesis 2) from stuck-pending (hypothesis 5) immediately. **The whole diagnosis rests on suppression having been recorded rather than being a silent skip**, which is worth noting as a design payoff.

**Then: the TTL on the rate-limit keys and the age of any pending aggregations.** Both are single commands and both cover the "accumulating forever" hypotheses.

**Why "metrics are normal" is the most important observation.**

Every hypothesis here produces **correct-looking metrics**, because in each case the system is doing what it was told:

- Suppression is normal behaviour and is counted as a successful outcome.
- Deferral is normal behaviour.
- A bounce suppression is correct behaviour.
- A rate-limited notification folding into a digest is correct behaviour.

**The system has no metric for "this user received nothing", which is the thing that went wrong.** That is the observability lesson's conclusion in a specific form: transport metrics measure the mechanism, and the outcome here is per-user and invisible in aggregate.

**The monitoring changes this incident demands.**

**A per-user delivery-outcome check: users with zero *sent* deliveries over a period despite having *created* deliveries.** That single query catches all five hypotheses and it is the metric that does not exist. **It is the notification system's equivalent of the reconciliation check** — comparing what should have been delivered against what was.

**An alert on suppression-reason distribution.** If \`channel_disabled\` suddenly rises, a preferences migration has gone wrong. If \`rate_limited_digested\` rises, the counters are stuck. **The reasons are already recorded; nobody is watching their proportions.**

**An alert on the age of the oldest pending aggregation**, which catches the refreshing-window bug directly.

**And a suppression-clearing path with an audit trail**, because a permanent silent ban with no removal mechanism is a support burden regardless of which hypothesis is true.

**Transferable:** in any system whose normal operation includes deliberately *not* doing something, the failure mode is indistinguishable from correct behaviour in aggregate metrics. **The only detection is an outcome check per subject** — did this user actually receive anything — and it is the check teams add after this incident rather than before it.`,
    },
  ],

  revision: {
    bullets: [
      'Separate "something happened" from "someone must be told" — the event is a fact, the notification is a derived decision.',
      'The producer sends type, data, class and recipients — never a channel and never copy.',
      'Producers write the request to an outbox in the same transaction, or notifications are silently lost.',
      'Evaluate preferences at delivery, not creation: the gap can be hours and a mute must affect in-flight notifications.',
      'The policy store fails *closed* — sending to a muted user is worse than sending late.',
      'The aggregation store fails *open* — too many wanted notifications is a quality failure, not a correctness one.',
      'One combined preference read per user; three separate lookups would make the policy layer the bottleneck.',
      'Three dedup layers: producer event id, unique (request, user, channel), and a pre-send record.',
      'Write the dedup record before sending, because an email cannot be un-sent; a duplicate is unbounded, a loss is single.',
      'Deduplication is also a product feature: aggregate several events about one entity into one notification.',
      'A refreshing aggregation window needs a maximum, or the notification never arrives.',
      'Per-class queues AND per-class provider quotas — a shared email allowance throttles transactional sends anyway.',
      'Chunk large fan-outs with a cursor, isolate them in a rate-limited bulk pool, and batch at the provider.',
      'In-app is the only pull channel, so only it can fan out on read.',
      'Push scales by batching, email by provider reputation (weeks of warm-up), SMS by money.',
      'No silent channel fallback — the user declined that channel; make fallback an explicit preference.',
      'Suppression is a first-class status with a reason, which is what makes "why didn\'t I get this?" answerable.',
      'Evaluate staleness before the rate limit, or a post-outage backlog exhausts every user\'s quota.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A pipeline that turns domain events into per-recipient, per-channel deliveries — with a policy layer between fan-out and sending that decides whether, when and how each person is told.',
    whyItExists:
      'So no producing service needs to know about channels, preferences, quiet hours or rate limits — and so the policy decisions those imply are made in one place rather than accidentally by whoever writes each producer.',
    whenToUse: [
      'Whenever more than one service needs to notify users, or more than one channel exists.',
      'Whenever users can express preferences, mutes or quiet hours.',
      'Whenever notification volume can burst, requiring aggregation.',
    ],
    whenNotToUse: [
      'For a single channel with no preferences — a direct send is simpler.',
      'For machine recipients only, where the policy layer has no analogue and a webhook system suffices.',
      'When the notification must be synchronous with the user\'s action, which is a response rather than a notification.',
    ],
    alternatives: [
      'Fan-out on read for pull channels, avoiding a write per recipient.',
      'A digest instead of individual sends, when volume exceeds a user\'s tolerance.',
      'A webhook contract, when the recipient is a machine and no policy layer is needed.',
      'A managed notification platform, when per-tenant reputation and templating are not worth building.',
    ],
    tradeoffs: [
      'Delivery-time preferences buy correct mutes and cost a lookup on the delivery path plus a staleness window.',
      'Aggregation buys quieter notifications and costs up to a window of added latency.',
      'Per-class isolation buys transactional latency and costs more queues and quota allocation.',
      'Chunked fan-out buys bounded resumable tasks and costs more messages.',
      'Fan-out on read buys avoided writes and costs a more complex query and separate read state.',
      'Refusing channel fallback buys respecting the user\'s choice and costs a notification not arriving.',
    ],
    failureModes: [
      'Producers sending channel and copy, coupling every service to notification logic.',
      'Notifications lost because the producer published after the business write rather than via an outbox.',
      'A mute not taking effect because preferences were evaluated at creation.',
      'A password reset delayed 40 minutes behind a marketing batch.',
      'Transactional sends throttled by the provider because marketing shares the quota.',
      'Duplicate emails from commit-after-send with no pre-send dedup record.',
      'Sixty notifications in five minutes with no per-user cap or aggregation.',
      'An aggregation window that refreshes without a maximum, so nothing ever sends.',
      'A backlog drained at 4am because there was no staleness policy.',
      'A stale notification consuming quota, suppressing the fresh ones behind it.',
      'A silent channel fallback delivering a channel the user declined.',
      'A permanent suppression from a bounce with no clearing path.',
      'Zero-delivery users invisible because suppression counts as a normal outcome.',
    ],
    followUpQuestions: [
      'When are preferences evaluated — creation or delivery?',
      'What counts as a duplicate, and does that include aggregating several events?',
      'What is the latency budget per notification class?',
      'Do the classes share a provider quota?',
      'What happens to a notification whose data was deleted before delivery?',
      'Does a failed channel fall back, and did the user opt into that?',
      'What happens to the backlog after a two-hour outage?',
      'Is staleness evaluated before or after the rate limit?',
      'Is a deliberate non-send recorded, with a reason?',
      'What alerts you when a specific user has received nothing?',
      'Who watches the dead-letter queue, and can you replay from it?',
    ],
  },
});
