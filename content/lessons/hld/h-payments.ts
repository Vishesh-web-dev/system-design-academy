import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-payments',
  title: 'Design a payment system',
  summary:
    'There is no exactly-once in money. There is at-least-once delivery, an append-only double-entry ledger whose writes are idempotent, and a reconciliation subsystem that finds the residue — because at any real volume the residue is thousands of breaks a day.',
  phase: 'hld',
  module: 'advanced-designs',
  position: 55,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 100,
  tags: ['ledger', 'idempotency', 'reconciliation', 'psp-failure', 'exactly-once'],
  prerequisites: ['h-food-delivery'],
  resources: [
    {
      key: 'martin-fowler-ledger-accounting',
      tier: 'must',
      note: 'The central reference. Read it for why double-entry is a structural invariant rather than accounting ceremony — every transfer sums to zero, so the whole ledger has a continuous self-check that a balance column cannot offer.',
    },
    {
      key: 'stripe-payment-intents',
      tier: 'must',
      note: 'Read it as a state machine for an operation whose outcome may be unknown for minutes. The intent object existing before the money moves is what makes the unknown state addressable rather than lost.',
    },
    {
      key: 'stripe-idempotent-requests',
      tier: 'must',
      note: 'Read it again here, with money at stake. The key must be generated before the first attempt and reused across retries, and its bounded lifetime is what limits how long the safety property holds.',
    },
    {
      key: 'stripe-webhooks',
      tier: 'good',
      note: 'Read it for the idea that the authoritative outcome arrives asynchronously, after your request returned. A payment system that treats the synchronous response as the answer will disagree with the provider within a day.',
    },
    {
      key: 'microservices-outbox',
      tier: 'good',
      note: 'Read it for making a state change and its event atomic. Every ledger write here emits an event, and a ledger that disagrees with its own event stream is unauditable.',
    },
    {
      key: 'kafka-exactly-once-confluent',
      tier: 'advanced',
      note: 'Read it for what exactly-once actually means in practice: at-least-once delivery plus idempotent application. The same decomposition is the whole argument of this lesson, with money instead of messages.',
    },
  ],

  intuition: {
    body: `Start by discarding the goal everyone states: **exactly-once money transfer does not exist as a primitive.**

Every hop is unreliable. Your request to the provider may time out after the charge succeeded. Your write of the result may fail after the provider committed. **At no point can any participant know, synchronously and with certainty, what happened** — and no protocol fixes that, because the provider is a separate organisation on the other side of a network.

**What exists is a decomposition: at-least-once delivery, plus idempotent application, plus reconciliation to find the residue.** Those three, together, produce something indistinguishable from exactly-once. Any one of them missing and money is lost or duplicated.

**At-least-once means you must retry** — a timeout is not a failure, it is an unknown, and abandoning an unknown loses money.

**Idempotent means the retry is safe**, which requires a key chosen before the first attempt and reused by every subsequent one.

**And reconciliation means you find what the first two missed**, because they will miss some. At fifty million payments a day, **even a 99.99% agreement rate leaves five thousand disagreements daily** — so reconciliation is not a cleanup script, it is a core subsystem with a queue and people attached to it.

Then the representation, which is where most designs go wrong before they reach any of that: **a balance column is not a record of money.**

\`\`\`
UPDATE accounts SET balance = balance - 100 WHERE id = A;
UPDATE accounts SET balance = balance + 100 WHERE id = B;
\`\`\`

**Those two statements can disagree with each other and nothing detects it.** There is no record of why the balance is what it is, no way to answer "what happened on Tuesday", and **a bug that drops one update leaves a permanently wrong number with no trace.**

**An append-only double-entry ledger inverts this.** Every movement is two or more immutable entries that sum to zero, balances are derived by summing entries, and **the invariant "all entries in a currency sum to zero" is a continuous self-check over the entire system.** A dropped entry is not an invisible wrong number — it is a broken invariant you can alert on.

**And money has three states, not two.** Authorised, meaning held but not moved. Captured, meaning moved as far as you know. **Settled, meaning the bank has confirmed it — days later, and that is the only one that is actually true.**

Designing as though captured equals settled is designing as though your view of the world is authoritative. **It is not; the bank's is.**`,
    analogyLimit:
      '"Move money from A to B" is the wrong mental model because it implies a single operation that either happens or does not. Every real payment is a sequence of unreliable hops across organisational boundaries, each of which can leave an outcome permanently unknown to you. The phrase also hides that your records are not authoritative — the bank settles days later, and a design that treats its own captured state as the truth will disagree with the provider within a day and have no process for it.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds payments: an accounts table with a balance column updated in a transaction, a charge call to the provider retried on timeout, the synchronous provider response treated as the outcome, and a nightly job that logs mismatches against the provider\'s report. Identify four failures and rank them.',
      answer: `**Failure 1 — retrying a charge without an idempotency key double-charges, and this is the worst failure because it is a direct, visible theft from a customer.**

\`\`\`
POST /charge { amount: 4999, card: ... }
  → provider processes it
  → response lost to a network timeout
Your service: "timed out, retry"
POST /charge { amount: 4999, card: ... }   ← a NEW charge
  → the customer is charged twice
\`\`\`

**A timeout is not a failure — it is an unknown**, and retrying an unknown mutation without a key turns "maybe once" into "probably twice."

**And both naive fixes are wrong.** Not retrying loses money when the charge failed; querying first races, because the charge may commit between the query and the retry.

*The fix:* **a key generated before the first attempt and reused by every retry**, so the provider recognises the second request as the same operation and returns the original outcome. **Retry becomes safe rather than avoided.**

**Failure 2 — a balance column has no self-check, so a lost update is a permanently wrong number with no trace.**

\`\`\`
UPDATE accounts SET balance = balance - 100 WHERE id = A;
UPDATE accounts SET balance = balance + 100 WHERE id = B;
→ transaction rolls back halfway? A bug skips the second?
→ nothing in the system can detect the inconsistency
→ and nothing records WHY the balance is what it is
\`\`\`

**You cannot say what happened on Tuesday, recompute a balance, or prove one is correct** — the fundamental defect for a system whose purpose is being correct about money.

*The fix:* **append-only double-entry.** Immutable entries summing to zero, balances derived by summing. **"All entries sum to zero per currency" is a continuous self-check**, so a dropped entry breaks an invariant instead of silently changing a number.

**Failure 3 — treating the synchronous response as the outcome disagrees with the provider within a day.**

The synchronous response says the request was accepted and, at best, authorised. **The authoritative outcome arrives later** — as a webhook minutes later, and as settlement days later.

\`\`\`
Synchronous:  "succeeded"
4 minutes later, webhook: payment failed (issuer reversal)
2 days later, settlement: this payment is not in the file
→ your ledger says money arrived; the bank says it did not
\`\`\`

**And worse than a wrong record: you have already shipped the goods.**

*The fix:* **three states — authorised, captured, settled** — each recorded as entries, with **only settled treated as true.** Webhooks are inputs; the settlement file is the authority.

**Failure 4 — a nightly job that logs mismatches is not reconciliation.**

\`\`\`
50 million payments/day × even a 99.99% match rate
= 5,000 mismatches/day
→ a log file nobody reads
→ and each mismatch is real money in the wrong place
\`\`\`

**Reconciliation is not a check that should pass — it is a permanently non-empty work queue** with categories, severities, owners and ages. **A system that logs breaks has decided not to resolve them.**

*The fix:* **reconciliation as a subsystem.** Match on a business key, classify by type, route to automation or a human queue, and **track break age** — an unresolved break is money genuinely in the wrong place.

**Ranking. Failure 1 charges a customer twice** — the most damaging thing this system can do, and entirely preventable. **Failure 2 makes every other error undetectable.** **Failure 3 puts your records in disagreement with the bank's within a day**, after you shipped. Failure 4 leaves the residue unresolved.

**The unifying observation: all four come from believing you can know an outcome.** The key, the ledger, the three states and the break queue are each a mechanism for operating correctly **while not knowing** — which is the actual job.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
Charge a customer for an order, via an external provider
Hold funds (authorise) and capture later
Refund fully or partially
Split a payment between platform and merchants
Pay out to merchants on a schedule
Produce an auditable history of every movement
Reconcile against the provider's settlement records
\`\`\`

**The clarifying questions that change the design:**

**Is the provider external?** *Yes, possibly several.* **So outcomes are sometimes permanently unknown**, the constraint everything answers to.

**Is our record authoritative?** *No — settlement is, days later.* Forces three money states.

**Acceptable double-charge rate?** *Zero.* Forces client-generated keys end to end.

**What happens to the residue?** *Found and resolved, not logged.* Makes reconciliation a subsystem.

**Must every balance be explainable?** *Yes, for years.* **Forces an append-only ledger.**

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Double charges | **Exactly zero** | Client-generated keys, reused on every retry |
| Lost payments | **Exactly zero** | Retry on unknown; never abandon a timeout |
| Ledger immutability | Absolute | Append-only; corrections are new entries |
| Balance derivation | Provable from entries | Sum of entries, with snapshots as a cache |
| Invariant check | Continuous | Sum of all entries per currency = 0 |
| Break resolution | p95 under 24 h | A queue with owners, not a log |
| Charge latency | p99 under 3 s | Provider-bound; the ledger write is cheap |
| Audit retention | Years | Immutable entries, partitioned by time |

**Out of scope:** card-network protocols, fraud scoring, PCI scope, tax calculation.

## Step 2 — Estimation

\`\`\`
Payments:      50 million/day → ~600/s avg, ~3,000/s peak
Refunds:       ~2% → 1 million/day
Payouts:       5 million merchants, daily or weekly
\`\`\`

**These numbers are small, which is the point.** Three thousand writes per second is unremarkable — **the difficulty is entirely correctness, and capacity contributes nothing to it.**

**Ledger volume, which is where the multiplier lives:**

\`\`\`
One payment is NOT two entries. A split payment:
  customer payable −5000, platform revenue +200,
  merchant payable +4500, fee expense +150, tax +150
→ 5 entries, plus more for refunds and payouts later.
Average ~8 per payment lifecycle.

50e6 × 8 = 400 M entries/day × ~200 B = 80 GB/day = ~30 TB/year
\`\`\`

**Eight entries per payment is the number people miss.** The ledger is nearly an order of magnitude larger than the payment count, **and it only grows.**

**Balance reads, and why snapshots are needed:**

\`\`\`
A balance = the sum of all that account's entries, ever, and a
merchant with 3 years of history has ~500,000 of them.
→ snapshot periodically; a read is snapshot + entries since
\`\`\`

**The snapshot is a cache, exactly like the document-editing lesson's.** If it disagrees with the entries, **the entries win** — which makes a bad snapshot a performance problem, not a loss.

**The break rate, which justifies an entire subsystem:**

\`\`\`
50 million payments/day.
At 99.99% agreement with the provider: 5,000 breaks/day
At 99.999%:                              500 breaks/day
\`\`\`

**Even at five nines the queue has five hundred items a day.** So reconciliation is not an assertion that should pass — **it is a permanently non-empty work queue**, which is an operational design problem as much as a technical one.

\`\`\`
Settlement files: ~50 million rows/day from each provider
Webhook volume:   ~150 million events/day (multiple per payment)
                  → ~1,700/s, all of which must be idempotent
                    because providers retry
\`\`\`

## Step 3 — API design

\`\`\`
Internal
  POST /payment-intents  { orderId, amount, currency, idemKey }
       → { intentId, state: 'requires_confirmation' }
       -- the intent EXISTS before any money moves
  POST /payment-intents/{id}/confirm  { method, idemKey }
       → { state: 'authorised' | 'processing' | 'failed' }
  POST /payment-intents/{id}/capture  { amount, idemKey }
  POST /payment-intents/{id}/refund   { amount, idemKey }
  GET  /payment-intents/{id}          → full state + entries

  GET  /accounts/{id}/balance         → available, pending, settled
  GET  /accounts/{id}/entries?from=   → the audit trail

Inbound from providers
  POST /webhooks/{provider}           → idempotent by event id
  (settlement files ingested on a schedule)

Operations
  GET  /breaks?status=open&type=      → the reconciliation queue
  POST /breaks/{id}/resolve  { resolution, adjustingEntries }
\`\`\`

**Five decisions worth defending.**

**The intent exists before any money moves** — the most useful API decision here. **A timeout on \`confirm\` leaves an addressable object** whose state can be queried against the provider, rather than an operation that may or may not have happened with no local trace.

**Every mutating call takes a caller-generated idempotency key**, because **a server-side key cannot deduplicate the request that created it.**

**Balance has three fields.** Collapsing \`available\`, \`pending\` and \`settled\` means **either paying out money that has not settled or withholding money that has.**

**Webhooks are idempotent by the provider's event id**, because providers retry, reorder and duplicate.

**Breaks are a first-class API whose resolution takes adjusting entries** — **you never edit history, you append a correction**, and the correction is itself auditable.

## Step 4 — Data model

\`\`\`sql
-- THE TRUTH: append-only, immutable, never updated
ledger_entries(
  entry_id, transfer_id,      -- entries of one transfer share this
  account_id, direction,      -- debit | credit
  amount_minor, currency,     -- integer minor units. NEVER float.
  entry_type, occurred_at, recorded_at,
  payment_intent_id, provider_ref,
  PRIMARY KEY (entry_id)
)
INDEX (account_id, recorded_at)
INDEX (transfer_id)
-- INVARIANT: per transfer_id, SUM(signed amount) = 0
-- INVARIANT: per currency, SUM over ALL entries = 0

-- DERIVED: a cache of summing entries
account_balances(
  account_id, currency, as_of_entry_id,
  available_minor, pending_minor, settled_minor
)

-- The operation, including its unknown states
payment_intents(
  intent_id, order_id, amount_minor, currency,
  state,        -- requires_confirmation | processing | authorised
                -- | captured | settled | failed | UNKNOWN
  idem_key UNIQUE, provider, provider_ref, last_checked_at
)
intent_transitions(intent_id, seq, from_state, to_state, cause, at)

-- Idempotency, stored permanently
idempotency_records(
  idem_key PRIMARY KEY, request_hash, response_body, created_at
)
webhook_events(provider, event_id PRIMARY KEY, processed_at)

-- Reconciliation
settlement_rows(provider, file_id, row_id, provider_ref, amount_minor, ...)
breaks(
  break_id, type, severity, provider_ref, intent_id,
  expected_minor, actual_minor, status, opened_at, resolved_at,
  resolution, adjusting_transfer_id
)
\`\`\`

**Five decisions worth defending.**

**Amounts are integers in minor units.** Floats cannot represent decimal fractions exactly, so **a float ledger accumulates error the invariant then flags forever.** A correctness requirement, not a style preference.

**Entries are appended, never updated.** A mistake is corrected by a new balancing transfer, **so history shows both the error and its correction** — which a corrected row destroys.

**\`transfer_id\` groups one movement's entries**, so the per-transfer invariant is checkable on every write and **the global per-currency one continuously.**

**\`UNKNOWN\` is an explicit state.** Most designs have no name for "we asked and do not know", so it gets recorded as failed or succeeded. **Naming it makes it queryable and resolvable.**

**\`occurred_at\` and \`recorded_at\` are separate**, because a payment from yesterday may be recorded today. **Reports use one, replay the other.**

## Step 5 — Architecture

\`\`\`
Order service ──▶ ┌────────────────────────────────┐
                  │ Payment service                 │
                  │  intents + idempotency records  │
                  └───┬──────────────────┬──────────┘
                      │ provider call    │ transfers
          ┌───────────▼────────┐   ┌─────▼─────────────────┐
          │ Provider adapters   │   │ Ledger service         │
          │  (PSP A, PSP B)     │   │  append-only entries   │
          │  key passthrough    │   │  zero-sum enforced     │
          └───────────┬────────┘   └─────┬─────────────────┘
                      │                   │ outbox events
          ┌───────────▼────────┐   ┌──────▼─────────────────┐
          │ Webhook ingest      │   │ Balance projector       │
          │  idempotent by      │   │  snapshots (a CACHE)    │
          │  event id           │   └────────────────────────┘
          └───────────┬────────┘
          ┌───────────▼───────────────────────────────────┐
          │ Reconciliation engine                          │
          │  settlement files × ledger → breaks            │
          └───────────┬───────────────────────────────────┘
                      ▼
              Break queue (auto-resolve + humans)
\`\`\`

**Why the ledger has one write path.** The invariant must be enforced somewhere, and **every additional writer is another place to violate it.**

**Why provider adapters are per provider.** Different idempotency semantics, error taxonomies and webhook formats — **and keys are not portable between them**, which Step 6 returns to.

**Why balances are a projection rather than a table the ledger updates.** Two writes can disagree; **a projection rebuildable from entries can only be stale.**

**Why reconciliation is an engine, not a job.** **Five hundred to five thousand items a day is a product with users**, not a cron script.

## Step 6 — The deep dive: idempotency end to end, the unknown, and reconciliation

**Idempotency, at three layers, because one is not enough.**

\`\`\`
Layer 1 — caller → payment service
  idempotency_records keyed by idem_key: a retry returns the
  stored response without re-executing.

Layer 2 — payment service → provider
  the SAME key passed through, so they deduplicate too.

Layer 3 — ledger write
  transfer_id derived deterministically, so applying an event
  twice is a primary-key violation, not a duplicate transfer.
\`\`\`

**Each layer covers a gap the others cannot.** **Layer 1 alone fails** if your record write succeeds and something else retries the provider call. **Layer 2 alone fails** if the provider charged and your response write failed. **Layer 3 alone fails** because deduplicating the ledger does not stop a second charge being created.

**And the key must cover the request content.** The stored \`request_hash\` makes **the same key with a different amount an error, not a cache hit** — otherwise a client bug silently returns the wrong outcome.

**The unknown state, which is the condition the whole design exists for.**

\`\`\`
POST /confirm → provider call times out after 30 s.
Either it succeeded and the response was lost, it failed, or
it is still processing there.
→ THREE possibilities, no local information distinguishes them
\`\`\`

**What you must not do: guess.** Failed loses money; succeeded ships unpaid goods. **Both are wrong in hard-to-detect ways.**

\`\`\`
What to do:
  1. state = UNKNOWN. It is a real state.
  2. No ledger entries — nothing is known to have happened.
  3. Query the provider by idempotency key or provider_ref,
     with backoff, for minutes to hours.
  4. Definite answer → write entries, transition state.
  5. Still unknown after the window → a BREAK, for
     settlement to resolve.
\`\`\`

**Three properties.** **No ledger entries during the unknown**, because the ledger's meaning depends on entries being facts — **a speculative entry would make a balanced ledger meaningless.** **The unknown resolves by query, not retry**, since re-charging risks a second charge if the key window has lapsed. **And it has a deadline**: after the window it becomes a break, which is the design saying **the authoritative record will decide this, not me.**

**Multi-provider failover, and the trap in it.**

**Failover is safe for a new intent and catastrophic for an in-flight one**, because your key means nothing to provider B.

\`\`\`
Provider A: charge in UNKNOWN state. Fail over to B with
"the same" key → B has never seen it, so it charges.
If A also charged, the customer paid twice and NOTHING
detects it except reconciliation.
\`\`\`

**So failover applies only to intents not confirmed anywhere.** An assigned intent stays with its provider until resolved — **stuck while that provider is down.** Stuck is recoverable; a cross-provider double charge is a break only a human finds.

**Reconciliation, the subsystem.**

\`\`\`
Daily: ingest each settlement file (~50 M rows)
Match on provider_ref, then amount + date as fallback

Break types:
  MISSING_IN_LEDGER     they settled it, we have no entries
  MISSING_AT_PROVIDER   we have entries, they have no record
                        → we may have shipped for free
  AMOUNT_MISMATCH       fees, FX, or partial-refund timing
  DUPLICATE_AT_PROVIDER a double charge; refund one
  TIMING                settled in another period; usually
                        resolves itself next cycle
\`\`\`

**Three things make this a subsystem rather than a script.**

**Most breaks have automated resolutions.** A \`MISSING_IN_LEDGER\` whose intent is \`UNKNOWN\` resolves by writing the entries settlement proves; timing breaks close themselves next cycle. **Perhaps 90% need no human — and the 10% that do are why the rest must be automated.**

**Every resolution appends adjusting entries, never an edit**, so the history shows the discrepancy and the fix.

**Break age is the metric, not count** — an old break is money that has been misplaced for a long time, and **a rising median means the automation is failing.**

*And the honest framing:* **breaks are not bugs to eliminate.** They arise from timing, fees and FX. **The goal is a bounded queue, not an empty one** — and a team treating them as defects will stop looking at it.

**Which is how "exactly-once" is actually delivered.**

\`\`\`
at-least-once delivery   (retry the unknown — never lose money)
+ idempotent application (three layers — never duplicate money)
+ reconciliation         (find the residue — because there is one)
= indistinguishable from exactly-once, from outside
\`\`\`

**None of the three is optional**, and the last is the one designs omit — **which is why they are wrong by thousands of payments a day and do not know it.**

## Step 7 — What breaks at 10×

**500 million payments/day, 4 billion ledger entries/day, 300 TB/year.**

**The ledger's single write path becomes a bottleneck.** *Fix:* **partition by account** — the per-transfer invariant is checkable within a transfer, the global one asynchronously. **A cross-partition transfer shares a \`transfer_id\`** and a monitor verifies the sum, trading synchronous enforcement for detection.

**Settlement files reach 500 million rows.** *Fix:* stream and match incrementally, **partitioned by reference range.**

**Break volume reaches 5,000–50,000/day.** *Fix:* automation rate becomes critical — **90% automation still leaves 5,000 manual items a day**, which is a staffing problem.

**Snapshot projection lags.** *Fix:* snapshot on entry count per account, **so hot accounts snapshot often and dormant ones never.**

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Provider call times out | Outcome unknown | **State \`UNKNOWN\`, no ledger entries.** Query by key with backoff; then a break |
| Provider down entirely | Cannot charge | New intents may fail over; **in-flight intents must NOT** — a cross-provider double charge is undetectable |
| Ledger write fails after a provider charge | Money moved, no record | Retry the ledger write with the deterministic \`transfer_id\`; **settlement catches it if the retry fails** |
| Duplicate webhook | Same event twice | Rejected by \`webhook_events\` primary key |
| Out-of-order webhooks | Capture before authorise | Intent state machine rejects illegal transitions; **re-query the provider for the true state** |
| Balance snapshot corrupt | Wrong displayed balance | **Rebuild by summing entries.** A cache, not data |
| Zero-sum invariant breaks | A real bug, somewhere | **Alert immediately and stop payouts.** The invariant exists for this |
| Settlement file missing | No reconciliation that day | Breaks age; the queue grows. **Age is the metric** |
| Provider reverses a settled payment | Money taken back | New entries reversing it. **A compensation, not an erasure** |

**Three rows carry the content.**

**The in-flight failover prohibition is the most important operational rule here**, and it is counter-intuitive — the instinct during an outage is to route everything elsewhere. **But an in-flight intent's key means nothing to provider B, so failing it over risks a double charge only reconciliation can find**, days later. **Being stuck is recoverable; that is not.**

**A broken zero-sum invariant stops payouts**, because every derived balance is then suspect and **paying out from a suspect balance turns a detectable bug into transferred money.**

**Money is never un-taken.** Reversals, refunds and resolutions are all new entries. **The ledger only grows**, which is what keeps every failure auditable.

## Step 9 — Defending it

**"I would start by rejecting the premise. There is no exactly-once money transfer, because the provider is a separate organisation across a network and a timeout leaves the outcome permanently unknown to me. What exists is a decomposition: at-least-once delivery so I never lose money, idempotent application so I never duplicate it, and reconciliation to find the residue — because at fifty million payments a day, even 99.99% agreement leaves five thousand disagreements. All three are required, and the third is the one designs omit.**

**The record is an append-only double-entry ledger, not balance columns.** Entries sum to zero, and the per-currency zero-sum invariant is **a continuous self-check over the whole system** — a dropped entry breaks something I can alert on rather than silently changing a number. Balances are summed, with snapshots as a rebuildable cache: **if a snapshot disagrees, the entries win.** Amounts are integers in minor units, because float rounding would accumulate into the invariant forever.

**Idempotency is three layers**, each covering a gap the others cannot: my records, the provider's, and a deterministic transfer id in the ledger. **And the key hashes the request**, so the same key with a different amount is an error rather than a wrong cache hit.

**\`UNKNOWN\` is an explicit state writing no ledger entries**, because the ledger records facts and a speculative entry would destroy the invariant's usefulness. It resolves by *querying*, never by re-charging, and after a bounded window becomes a break. **The bank's record is authoritative, not mine.**

**Which is why money has three states** — authorised, captured, settled — **and only settled is true.** Treating captured as authoritative means disagreeing with the provider within a day, having already shipped.

**Two operational rules I would insist on.** An in-flight intent never fails over — my key means nothing there, and a cross-provider double charge is undetectable except by reconciliation days later, so **stuck is recoverable and that is not.** And a broken invariant halts payouts, because every derived balance is then suspect.

**And breaks are a queue with owners, measured by age rather than count**, because an old break is long-misplaced money. They arise from timing, fees and FX rather than bugs — **so the goal is a bounded queue, not an empty one.**

**What I gave up:** an in-flight intent can be stuck while its provider is down; balances can be briefly stale; unknown outcomes can take a settlement cycle to resolve; and the ledger only grows, at about 30 TB a year.

**What would make me revisit it:** if we held both sides — a closed-loop wallet rather than card payments — the external unknown largely disappears and the ledger write becomes the authoritative act, removing the reconciliation engine's reason to exist."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'three-mechanisms',
      title: 'Exactly-once, decomposed into three mechanisms',
      caption:
        'Step through it. Each mechanism covers a failure the others cannot — and the third one, reconciliation, is the one most designs leave out and then silently need.',
      nodes: [
        { id: 'caller', label: 'Caller — key before first attempt', kind: 'client', x: 0, y: 160, detail: 'A server-generated key cannot deduplicate the request that created it, so this is a contract obligation on the caller. The stored record hashes the request too: the same key with a different amount is an error, not a cache hit.' },
        { id: 'intent', label: 'Payment intent (exists before money moves)', kind: 'service', x: 240, y: 160, detail: 'The single most useful API decision here. A timeout on confirm leaves an addressable object whose state can be queried against the provider — rather than an operation that may or may not have happened with no local trace.' },
        { id: 'unknown', label: 'UNKNOWN — an explicit state', kind: 'note', x: 240, y: 30, detail: 'Three possibilities after a timeout: charged, failed, still processing. Guessing either way is wrong in a hard-to-detect way. So: no ledger entries, query the provider by key with backoff, and after a bounded window it becomes a break.' },
        { id: 'psp', label: 'Provider adapters (keys NOT portable)', kind: 'external', x: 500, y: 160, detail: 'Each provider has its own idempotency semantics and error taxonomy. And your key means nothing to provider B — which is why an in-flight intent must never fail over: a cross-provider double charge is undetectable except by reconciliation, days later.' },
        { id: 'ledger', label: 'Ledger — append-only, zero-sum', kind: 'store', x: 760, y: 60, detail: 'Every movement is entries summing to zero, in integer minor units. The invariant "all entries per currency sum to zero" is a continuous self-check: a dropped entry breaks an invariant you can alert on, rather than silently changing a number.' },
        { id: 'bal', label: 'Balance snapshots — a CACHE', kind: 'store', x: 1000, y: 60, detail: 'A merchant with three years of history has ~500,000 entries, so summing per read is unacceptable. Snapshot plus entries-since. If a snapshot disagrees with the entries, the entries win — same relationship as the document-editing snapshot.' },
        { id: 'recon', label: 'Reconciliation engine', kind: 'service', x: 760, y: 280, detail: 'Settlement files are the authority. 50 million payments/day at 99.99% agreement is 5,000 breaks/day — so this is a work queue that is always non-empty, not an assertion that should pass.' },
        { id: 'breaks', label: 'Break queue — measured by AGE', kind: 'store', x: 1000, y: 280, detail: 'Typed, severity-ranked, ~90% auto-resolved. Age rather than count is the metric, because an old break is money that has been in the wrong place for a long time. Every resolution writes adjusting entries — never an edit.' },
      ],
      edges: [
        { id: 'p1', source: 'caller', target: 'intent', kind: 'sync' },
        { id: 'p2', source: 'intent', target: 'unknown', kind: 'control' },
        { id: 'p3', source: 'intent', target: 'psp', kind: 'sync' },
        { id: 'p4', source: 'unknown', target: 'psp', kind: 'read' },
        { id: 'p5', source: 'intent', target: 'ledger', kind: 'write' },
        { id: 'p6', source: 'ledger', target: 'bal', kind: 'async' },
        { id: 'p7', source: 'psp', target: 'recon', kind: 'async' },
        { id: 'p8', source: 'ledger', target: 'recon', kind: 'read' },
        { id: 'p9', source: 'recon', target: 'breaks', kind: 'write' },
        { id: 'p10', source: 'breaks', target: 'ledger', kind: 'write' },
      ],
      steps: [
        {
          id: 'ps1',
          title: 'Idempotency at three layers, because one is not enough',
          description:
            'Your records, the provider\'s, and a deterministic transfer id in the ledger. Layer 1 alone fails if something else retries the provider call; layer 2 alone fails if the provider charged and your write failed.',
          nodes: ['caller', 'intent'],
          edges: ['p1'],
        },
        {
          id: 'ps2',
          title: 'A timeout is an unknown, not a failure',
          description:
            'Retry-on-unknown is what stops money being lost. But resolve by querying the provider, never by re-charging — and write no ledger entries while nothing is known to have happened.',
          nodes: ['unknown', 'psp'],
          edges: ['p2', 'p3', 'p4'],
        },
        {
          id: 'ps3',
          title: 'The ledger records facts, and checks itself',
          description:
            'Append-only double entry in integer minor units. Balances are summed, with snapshots as a rebuildable cache — which is why a corrupt snapshot is a performance problem rather than a loss.',
          nodes: ['ledger', 'bal'],
          edges: ['p5', 'p6'],
        },
        {
          id: 'ps4',
          title: 'And the bank is the authority, days later',
          description:
            'Settlement files versus the ledger produce typed breaks. Even 99.99% agreement leaves 5,000 a day, so this is a subsystem with a queue and people — not a nightly assertion.',
          nodes: ['recon'],
          edges: ['p7', 'p8'],
        },
        {
          id: 'ps5',
          title: 'Every resolution appends; nothing is ever edited',
          description:
            'A break closes by writing a correcting transfer, so the history shows both the discrepancy and the fix. Break age is the metric — a rising median means the automation is failing.',
          nodes: ['breaks'],
          edges: ['p9', 'p10'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'money-states',
      title: 'Three states of money, and the one that is actually true',
      caption:
        'Read the right-hand column as the design consequence of each state. Most designs collapse captured and settled, which is the same as believing your own records outrank the bank\'s.',
      code: `stateDiagram-v2
    [*] --> requires_confirmation: intent created<br/>**before money moves**

    requires_confirmation --> processing: confirm sent
    processing --> authorised: **funds HELD**<br/>not moved
    processing --> failed: declined
    processing --> UNKNOWN: **timeout**

    UNKNOWN --> authorised: query resolves
    UNKNOWN --> failed: query resolves
    UNKNOWN --> break_opened: **window expired —<br/>settlement will decide**

    authorised --> captured: **moved, as far<br/>as WE know**
    authorised --> expired: hold lapsed

    captured --> settled: **bank confirms,<br/>days later —<br/>the ONLY true state**
    captured --> break_opened: not in the<br/>settlement file

    settled --> reversed: issuer pulls it back<br/>**new entries, not an erasure**

    break_opened --> settled: resolved with<br/>adjusting entries
    break_opened --> failed: resolved as<br/>never charged

    note right of UNKNOWN
        NO ledger entries here.
        The ledger records facts,
        and nothing is known.
        Resolve by QUERY, never
        by re-charging.
    end note

    note right of captured
        Shipping goods here is
        shipping on your own
        word, not the bank's.
        Fine — but know that
        is what you are doing.
    end note`,
    },
  ],

  productionExample: {
    systems: ['stripe'],
    body: `The published payment-intent and webhook documentation together describe the shape this design uses, and three properties are worth extracting.

**The intent object is created before the money moves**, and it persists through every outcome including the ambiguous ones. **So there is always a server-side object to ask about** — which is what makes an unknown resolvable by query rather than by guessing. A design whose first durable record is the *result* of a charge has nothing to ask about when the result is lost.

**The authoritative outcome arrives asynchronously.** The documentation is explicit that webhooks, not the synchronous response, carry the definitive state, and that **webhooks may arrive out of order, be duplicated, and be retried.** Which forces the receiving endpoint to be idempotent by event id and the intent to be a state machine that rejects illegal transitions.

**And idempotency keys have a bounded lifetime.** They are not remembered indefinitely, **so the safety property has an expiry** — and any retry policy has to live inside that window. A retry a week later is a new charge.

**Three transferable lessons.**

**Create the durable object before the risky operation.** It costs one write and it converts "did anything happen?" into "what is the state of this thing?" — **a question that has an answer.**

**Treat the synchronous response as a hint and the asynchronous notification as the fact.** Any system that ships goods on a synchronous success is making a business decision to trust its own word over the bank's. **That can be correct; it should be deliberate.**

**A bounded safety window is itself a design input.** If keys expire after a day, then an unknown older than a day cannot be resolved by retry-with-key — **it must be resolved by settlement**, which is exactly why the reconciliation engine is not optional.

**Where the reference does not help.** It describes one provider's interface. **The ledger, the zero-sum invariant, the break taxonomy and the in-flight failover prohibition are all yours to design** — and the failover rule in particular is a cross-provider concern that no single provider's documentation will warn you about.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, most of which are about operating correctly while not knowing what happened.',
    rows: [
      {
        option: 'Balance columns updated in a transaction',
        whenItWins:
          'A toy system where no balance is ever disputed and no history is needed.',
        whenItLoses:
          'No self-check, no explanation of why a balance is what it is, and a dropped update is a permanently wrong number with no trace.',
        cost:
          'Unauditability — the one thing a money system cannot afford.',
      },
      {
        option: 'Append-only double-entry ledger',
        whenItWins:
          'Always. Entries sum to zero per transfer and per currency, giving a continuous system-wide self-check.',
        whenItLoses:
          'Volume — about 8 entries per payment, 30 TB/year, growing forever.',
        cost:
          'Storage, plus derived balances needing snapshots.',
      },
      {
        option: 'Float amounts',
        whenItWins:
          'Nowhere. It is convenient.',
        whenItLoses:
          'Decimal fractions are not exactly representable, so rounding error accumulates and the zero-sum invariant flags it forever.',
        cost:
          'A permanently broken invariant, which is worse than no invariant.',
      },
      {
        option: 'Integer minor units',
        whenItWins:
          'Always. Exact arithmetic, and the invariant stays meaningful.',
        whenItLoses:
          'Multi-currency and FX need explicit scale handling.',
        cost:
          'Careful conversion code at boundaries.',
      },
      {
        option: 'Retry a charge without an idempotency key',
        whenItWins:
          'Nowhere. It is the default if you do nothing.',
        whenItLoses:
          'A timeout is an unknown, so retrying turns "maybe once" into "probably twice".',
        cost:
          'A double charge — the most damaging thing this system can do.',
      },
      {
        option: 'Not retrying on timeout',
        whenItWins:
          'Nowhere. It avoids double charges by losing money.',
        whenItLoses:
          'The charge may have failed, and abandoning it loses the payment silently.',
        cost:
          'Lost revenue, undetected.',
      },
      {
        option: 'Three-layer idempotency with a request hash',
        whenItWins:
          'Always. Each layer covers a gap the others cannot, and the hash catches key misuse.',
        whenItLoses:
          'Keys have bounded lifetimes, so the guarantee has an expiry.',
        cost:
          'Permanent idempotency records, and a contract obligation on callers.',
      },
      {
        option: 'Recording an unknown outcome as succeeded or failed',
        whenItWins:
          'Nowhere. It keeps the state machine simple.',
        whenItLoses:
          'Succeeded ships unpaid goods; failed loses money. Both are hard to detect later.',
        cost:
          'A wrong ledger, with the invariant still balanced and therefore useless.',
      },
      {
        option: 'An explicit UNKNOWN state with no ledger entries',
        whenItWins:
          'Always. Queryable, resolvable, and it keeps the ledger factual.',
        whenItLoses:
          'The payment is in limbo until the query or settlement resolves it.',
        cost:
          'A resolution loop and a bounded window before it becomes a break.',
      },
      {
        option: 'Failing an in-flight intent over to another provider',
        whenItWins:
          'Nowhere. It is the instinctive response to a provider outage.',
        whenItLoses:
          'Your key means nothing to provider B, so both may charge — undetectable except by reconciliation days later.',
        cost:
          'A double charge the customer finds before you do.',
      },
      {
        option: 'Failover only for unconfirmed intents',
        whenItWins:
          'Always. New payments route around an outage; in-flight ones wait.',
        whenItLoses:
          'In-flight intents are stuck while their provider is down.',
        cost:
          'Delay for some payments, in exchange for no cross-provider duplication.',
      },
      {
        option: 'A nightly job logging mismatches',
        whenItWins:
          'Nowhere. It looks like reconciliation.',
        whenItLoses:
          '5,000 mismatches a day in a log nobody reads, each of which is real misplaced money.',
        cost:
          'Unresolved residue accumulating indefinitely.',
      },
      {
        option: 'A reconciliation engine with a typed break queue',
        whenItWins:
          'Always. ~90% auto-resolved, the rest owned, and age is the metric.',
        whenItLoses:
          'It is a real subsystem with staffing implications.',
        cost:
          'Engineering plus operations, permanently.',
      },
      {
        option: 'Treating captured as settled',
        whenItWins:
          'When shipping speed matters more than payment certainty — a deliberate business choice.',
        whenItLoses:
          'Your records disagree with the bank within a day, and you have already shipped.',
        cost:
          'Loss on reversed payments, which should be priced rather than discovered.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Debit one account and credit the other in a single transaction, with balance columns."',
      whyWeak:
        'Nothing detects an inconsistency between the two updates, nothing records why a balance is what it is, and a dropped update leaves a permanently wrong number with no trace. For a system whose entire purpose is being correct about money, that is the fundamental defect.',
      strongAnswer:
        '"An append-only double-entry ledger. Every movement is two or more immutable entries summing to zero, and balances are derived by summing entries. The invariant that all entries in a currency sum to zero is a continuous self-check over the whole system, so a dropped entry breaks an invariant I can alert on instead of silently changing a number. Amounts are integers in minor units, because float rounding would accumulate into that invariant forever. And balances get snapshots as a cache — if a snapshot disagrees with the entries, the entries win."',
    },
    {
      weakAnswer: '"The charge call timed out, so retry it."',
      whyWeak:
        'A timeout is not a failure, it is an unknown: the charge may have succeeded with the response lost, failed, or still be processing. Retrying without a key creates a second charge — turning "maybe once" into "probably twice".',
      strongAnswer:
        '"Retry, but with the idempotency key generated before the first attempt, so the provider recognises the second request as the same operation and returns the original outcome. And I would set the intent to an explicit UNKNOWN state and write no ledger entries, because the ledger records facts and nothing is known yet. The unknown resolves by querying the provider — never by re-charging — and after a bounded window it becomes a reconciliation break, because at that point the settlement record is the only authority."',
    },
    {
      weakAnswer: '"Store the idempotency key and return the cached response on a repeat."',
      whyWeak:
        'One layer is not enough, and it has a hole: if your record write succeeded but the provider call is retried by something else, the provider sees a fresh request. It also cannot catch a caller reusing a key for a different payment.',
      strongAnswer:
        '"Three layers, because each covers a gap the others cannot. My idempotency records return the stored response on a retry; the same key is passed through to the provider so their systems deduplicate too; and the ledger\'s transfer id is derived deterministically, so applying the same event twice is a primary-key violation. And the stored record hashes the request, so the same key with a different amount is an error rather than a wrong cache hit."',
    },
    {
      weakAnswer: '"The provider returned success, so the payment is complete and we can ship."',
      whyWeak:
        'The synchronous response says the request was accepted and at best authorised. The authoritative outcome arrives later — a webhook minutes on, and settlement days on — and a reversal after shipping is a loss you discover rather than price.',
      strongAnswer:
        '"Money has three states: authorised means held, captured means moved as far as I know, and settled means the bank has confirmed it days later — and only settled is actually true. I record each transition as ledger entries and treat the settlement file as the authority. Shipping on captured is a legitimate business choice about speed versus certainty, but it should be deliberate and priced, not a consequence of believing my own records outrank the bank\'s."',
    },
    {
      weakAnswer: '"Provider A is down, so route everything to provider B."',
      whyWeak:
        'Correct for new payments and catastrophic for in-flight ones. An intent in an unknown state at provider A carries a key that provider B has never seen, so B will charge — and if A also charged, nothing detects the double charge except reconciliation days later, after the customer has noticed.',
      strongAnswer:
        '"Failover applies only to intents that have not been confirmed anywhere. Once an intent has a provider assigned it stays with that provider until resolved, even though that means it is stuck while the provider is down. Idempotency keys are not portable across providers, so cross-provider duplication has no detection mechanism at all — and being stuck is recoverable while that is not."',
    },
    {
      weakAnswer: '"A nightly job compares our records to the provider\'s report and logs any mismatches."',
      whyWeak:
        'At 50 million payments a day, even a 99.99% agreement rate produces 5,000 mismatches daily. A log file is a decision not to resolve them, and each unresolved line is real money in the wrong place.',
      strongAnswer:
        '"Reconciliation is a subsystem, not a job. Breaks are typed — missing in ledger, missing at provider, amount mismatch, duplicate at provider, timing — with severities, owners and automated resolution paths for about 90% of them. Every resolution writes adjusting entries rather than editing history, so the audit trail shows the discrepancy and the fix. And the metric is break age rather than break count, because an old break is money that has been in the wrong place for a long time. Breaks are not defects to eliminate — they come from timing, fees and FX — so the goal is a bounded queue, not an empty one."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hp-1',
      front: 'What are the three mechanisms that together look like exactly-once?',
      back: 'At-least-once delivery (never lose money), idempotent application (never duplicate it), and reconciliation (find the residue). None is optional.',
      topic: 'exactly-once',
    },
    {
      id: 'fc-hp-2',
      front: 'Why does exactly-once money transfer not exist as a primitive?',
      back: 'The provider is a separate organisation across a network, so a timeout leaves the outcome permanently unknown to you and no protocol removes that.',
      topic: 'exactly-once',
    },
    {
      id: 'fc-hp-3',
      front: 'What is wrong with a balance column?',
      back: 'No self-check, no record of why the balance is what it is, and a dropped update leaves a permanently wrong number with no trace.',
      topic: 'ledger',
    },
    {
      id: 'fc-hp-4',
      front: 'What does double-entry buy that is structural rather than ceremonial?',
      back: 'A continuous self-check: entries sum to zero per transfer and per currency, so a dropped entry breaks an invariant you can alert on.',
      topic: 'ledger',
    },
    {
      id: 'fc-hp-5',
      front: 'Why integer minor units rather than floats?',
      back: 'Decimal fractions are not exactly representable, so rounding error accumulates and the zero-sum invariant flags it forever — a permanently broken invariant is worse than none.',
      topic: 'ledger',
    },
    {
      id: 'fc-hp-6',
      front: 'How many ledger entries does one payment produce, roughly?',
      back: 'About eight across its lifecycle — customer, platform revenue, merchant payable, fees, tax, then refunds and payouts. The ledger is ~8× the payment count.',
      topic: 'ledger',
    },
    {
      id: 'fc-hp-7',
      front: 'What are the three layers of idempotency?',
      back: 'Your idempotency records, the key passed through to the provider, and a deterministic transfer id in the ledger. Each covers a gap the others cannot.',
      topic: 'idempotency',
    },
    {
      id: 'fc-hp-8',
      front: 'Why must the idempotency record hash the request?',
      back: 'So the same key with a different amount is an error rather than a cache hit returning the wrong outcome.',
      topic: 'idempotency',
    },
    {
      id: 'fc-hp-9',
      front: 'Why write no ledger entries during an UNKNOWN state?',
      back: 'The ledger records facts, and nothing is known to have happened. A speculative entry would destroy the zero-sum invariant\'s usefulness.',
      topic: 'psp-failure',
    },
    {
      id: 'fc-hp-10',
      front: 'How does an UNKNOWN resolve?',
      back: 'By querying the provider with backoff — never by re-charging — and after a bounded window it becomes a reconciliation break for settlement to decide.',
      topic: 'psp-failure',
    },
    {
      id: 'fc-hp-11',
      front: 'Why must an in-flight intent never fail over to another provider?',
      back: 'Keys are not portable, so provider B charges regardless of what A did. A cross-provider double charge has no detection except reconciliation, days later.',
      topic: 'psp-failure',
    },
    {
      id: 'fc-hp-12',
      front: 'What are the three states of money, and which is true?',
      back: 'Authorised (held), captured (moved as far as you know), settled (bank-confirmed, days later). Only settled is actually true.',
      topic: 'psp-failure',
    },
    {
      id: 'fc-hp-13',
      front: 'Why is reconciliation a subsystem rather than a job?',
      back: '50 million payments/day at 99.99% agreement is 5,000 breaks/day. It is a work queue that is always non-empty, with types, owners and automated resolutions.',
      topic: 'reconciliation',
    },
    {
      id: 'fc-hp-14',
      front: 'Why measure break age rather than break count?',
      back: 'An old break is money that has been in the wrong place for a long time. A rising median age means the automation is failing.',
      topic: 'reconciliation',
    },
  ],

  quiz: [
    {
      id: 'q-hp-1',
      kind: 'scenario',
      prompt:
        'A charge request to the provider times out after 30 seconds. What do you record?',
      options: [
        { id: 'a', label: 'An explicit UNKNOWN state with no ledger entries, then query the provider by idempotency key with backoff' },
        { id: 'b', label: 'Failed — the request did not complete' },
        { id: 'c', label: 'Succeeded, and reverse it later if the webhook disagrees' },
        { id: 'd', label: 'Nothing, and retry the charge immediately' },
      ],
      correct: ['a'],
      explanation:
        'Three outcomes are possible and no local information distinguishes them. Recording failed loses money; recording succeeded ships unpaid goods. Writing no entries keeps the ledger factual — a speculative entry would make a balanced ledger meaningless. And resolution is by query, because re-charging risks a second charge if the key window has lapsed.',
      difficulty: 'core',
      topic: 'psp-failure',
    },
    {
      id: 'q-hp-2',
      kind: 'scenario',
      prompt:
        'Why is a per-currency zero-sum invariant over all ledger entries valuable?',
      options: [
        { id: 'a', label: 'It is a continuous self-check: a dropped or malformed entry breaks the invariant instead of silently changing a balance' },
        { id: 'b', label: 'It makes balance reads faster' },
        { id: 'c', label: 'It is required by accounting standards' },
        { id: 'd', label: 'It prevents double charges' },
      ],
      correct: ['a'],
      explanation:
        'Detectability is the whole point — it converts a silent wrong number into an alertable condition, which is why a broken invariant justifies halting payouts. It does nothing for read speed (snapshots do that) and nothing for double charges (idempotency does that). Standards compliance is a consequence rather than the engineering reason.',
      difficulty: 'core',
      topic: 'ledger',
    },
    {
      id: 'q-hp-3',
      kind: 'scenario',
      prompt:
        'Provider A is down and you have 400 intents in UNKNOWN state with it. Should they fail over to provider B?',
      options: [
        { id: 'a', label: 'No — keys are not portable, so B would charge regardless of what A did, and the double charge is undetectable except by reconciliation days later' },
        { id: 'b', label: 'Yes, with the same idempotency key, which B will honour' },
        { id: 'c', label: 'Yes, after querying A once more to confirm the charges failed' },
        { id: 'd', label: 'Yes, and refund any duplicates found later' },
      ],
      correct: ['a'],
      explanation:
        'Option b is the central misconception: an idempotency key is meaningful only within the provider that issued it. Option c has a race — the charge can commit at A between the query and the retry at B. Option d accepts double-charging customers as a normal cost. Being stuck is recoverable; a cross-provider duplicate is found by the customer before you find it.',
      difficulty: 'advanced',
      topic: 'psp-failure',
    },
    {
      id: 'q-hp-4',
      kind: 'scenario',
      prompt:
        'You process 50 million payments a day and agree with the provider on 99.99% of them. What does that imply?',
      options: [
        { id: 'a', label: '5,000 breaks a day — so reconciliation must be a queue with types, owners and automated resolutions, not a log' },
        { id: 'b', label: 'The system is working well and breaks can be ignored' },
        { id: 'c', label: 'There is a bug producing 0.01% failures that should be eliminated' },
        { id: 'd', label: 'Reconciliation should run more frequently to reduce the count' },
      ],
      correct: ['a'],
      explanation:
        'Volume turns an excellent agreement rate into thousands of items of real misplaced money. Option c misframes it: most breaks come from timing, fees and FX rather than bugs, so the goal is a bounded ageing-controlled queue rather than an empty one — and a team treating breaks as defects will stop looking at the queue.',
      difficulty: 'advanced',
      topic: 'reconciliation',
    },
    {
      id: 'q-hp-5',
      kind: 'scenario',
      prompt:
        'A break is resolved: settlement proves a payment the ledger has no entries for. What is written?',
      options: [
        { id: 'a', label: 'New entries for the transfer, plus a correcting transfer referencing the break — history is appended to, never edited' },
        { id: 'b', label: 'The missing entries are inserted with the original occurred_at and the break is deleted' },
        { id: 'c', label: 'The affected balance is corrected directly' },
        { id: 'd', label: 'The intent state is updated to settled with no ledger change' },
      ],
      correct: ['a'],
      explanation:
        'An immutable ledger means corrections are appends, so the history shows the discrepancy and its fix — which is what audit requires. Note that occurred_at may legitimately be the original date while recorded_at is today; that is why the two timestamps are separate. Options b, c and d each destroy or bypass the audit trail.',
      difficulty: 'core',
      topic: 'reconciliation',
    },
    {
      id: 'q-hp-6',
      kind: 'multi',
      prompt:
        'Which are required for a system to behave as though money moved exactly once? Select all that apply.',
      options: [
        { id: 'a', label: 'Retrying operations whose outcome is unknown' },
        { id: 'b', label: 'Idempotent application of every retry, keyed before the first attempt' },
        { id: 'c', label: 'Reconciliation against the authoritative record to find the residue' },
        { id: 'd', label: 'A distributed transaction spanning your service and the provider' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The three together are indistinguishable from exactly-once, and dropping any one loses or duplicates money — retry without idempotency double-charges, idempotency without retry loses payments, and both without reconciliation leaves thousands of daily discrepancies undetected. Option d is unavailable: the provider is a separate organisation and cannot enlist in your transaction.',
      difficulty: 'core',
      topic: 'exactly-once',
    },
  ],

  exercises: [
    {
      id: 'ex-hp-1',
      kind: 'design',
      title: 'Add multi-currency and FX, and watch the invariant get harder',
      estimatedMinutes: 45,
      prompt: `The platform expands internationally. Now:

**Customers pay in their local currency; merchants are paid in theirs.**
**FX conversion happens at some point, at a rate that changes continuously.**
**Some currencies settle on different days and through different providers.**

**Part 1.** The zero-sum invariant was per currency. State precisely what breaks, and what the invariant must become.

**Part 2.** Design the FX transfer. Where does the rate come from, when is it fixed, and who bears the movement between quote and settlement?

**Part 3.** Reconciliation now spans currencies and settlement calendars. Work out the new break types.

**Part 4.** Name four new failure modes and what each does.

Then answer:

- What single number would you monitor to know the FX handling is correct?
- What does this reveal about the original per-currency invariant?`,
      rubric: [
        'Identifies that a cross-currency transfer cannot sum to zero in one currency.',
        'Introduces an FX position or conversion account as the balancing mechanism.',
        'States the invariant correctly: zero-sum per currency, with FX accounts absorbing the difference.',
        'Designs the FX transfer as two single-currency transfers plus a rate record.',
        'Addresses when the rate is fixed and who bears movement.',
        'Names at least three new break types specific to FX and settlement calendars.',
        'Names at least four failure modes with consequences.',
        'Gives a specific monitorable number with reasoning.',
        'Concludes that the invariant was per-currency because value was conserved within a currency.',
      ],
      modelAnswer: `**Part 1 — what breaks, and what the invariant becomes**

**What breaks: a cross-currency transfer cannot sum to zero in any single currency.**

\`\`\`
Customer pays EUR 100. Merchant is owed USD 108.
Naive entries:
  customer payable   −10000 EUR
  merchant payable   +10800 USD
→ EUR sums to −10000. USD sums to +10800.
→ BOTH per-currency invariants broken, permanently.
\`\`\`

**And the invariant was the design's continuous self-check**, so breaking it does not merely lose a nicety — **it removes the mechanism that detects every other error.** That is why this is the first thing to fix rather than a detail.

**What the invariant must become: zero-sum per currency still holds, with explicit FX accounts absorbing each side.**

\`\`\`
An FX conversion is TWO single-currency transfers, joined by a
rate record:

Transfer 1 (EUR):
  customer payable      −10000 EUR
  fx position EUR       +10000 EUR      → EUR sums to zero ✓

Transfer 2 (USD):
  fx position USD       −10800 USD
  merchant payable      +10800 USD      → USD sums to zero ✓

fx_conversions(conversion_id, from_currency, from_minor,
               to_currency, to_minor, rate, rate_source,
               quoted_at, transfer_1_id, transfer_2_id)
\`\`\`

**Three properties this shape gives you.**

**Each currency's invariant is preserved exactly as before.** No change to the check, no change to its meaning. **The FX accounts are where the currencies meet**, and they meet through a documented rate rather than an unexplained imbalance.

**The FX position becomes a real, monitorable balance.** \`fx position EUR\` accumulates every EUR taken in; \`fx position USD\` accumulates every USD paid out. **Their combined value at current rates is the platform's FX exposure** — a number that did not exist before and now needs watching.

**And the rate is recorded as data, not implied by the amounts.** You can divide 10800 by 10000 and get 1.08, and **that tells you nothing about where the rate came from or when it was quoted** — both of which matter for disputes and for measuring slippage.

**What survives unchanged:** append-only entries, integer minor units, three-layer idempotency, the UNKNOWN state, and the break queue's structure. **The ledger's mechanics generalise; only the invariant's scope needed care.**

---

**Part 2 — designing the FX transfer**

**Where the rate comes from, and the decision that matters most: when it is fixed.**

\`\`\`
Option A — fix at checkout (customer sees a final amount)
Option B — fix at capture (hours later)
Option C — fix at settlement (days later)
\`\`\`

**Each puts the rate movement on a different party.**

**Fix at checkout** means the customer knows exactly what they pay, and **the platform carries the movement** between quote and settlement — which can be days.

**Fix at settlement** means the platform carries no FX risk and **the merchant's receipt is unknown until it arrives**, which makes their own accounting impossible.

**Fix at capture** splits the difference and satisfies nobody fully.

**I would fix at checkout for the customer and at capture for the merchant**, with the platform absorbing both movements — and the reasoning is about who can manage the risk.

**The customer cannot hedge and will not accept uncertainty in a price**, so quoting a final amount is close to a product requirement. **The merchant can tolerate a short window but needs a known figure for reconciliation.** The platform can hedge, can price a margin into the rate, and can aggregate across thousands of transactions where individual movements cancel. **Put the risk where it can be managed.**

**Which means the rate needs a margin, and the margin should be explicit in the ledger.**

\`\`\`
Market rate:  1.0850
Quoted rate:  1.0800   (a ~0.46% margin)

Transfer 2 (USD):
  fx position USD       −10850 USD    at the MARKET rate
  merchant payable      +10800 USD
  fx margin revenue        +50 USD    ← explicit
→ USD sums to zero ✓
\`\`\`

**Recording the margin as revenue rather than burying it in the rate is what makes FX profitability measurable**, and it is the same discipline as separating processing fees from the payment amount. **A margin hidden in a rate is revenue you cannot report or optimise.**

**And the rate source must be recorded with a timestamp**, because a dispute about an FX rate is a dispute about what the market was at a moment, and **"our system said 1.08" is not an answer** without a source and a time.

---

**Part 3 — new break types**

**The existing types still apply within each currency.** These are additions.

**\`FX_RATE_MISMATCH\`** — the provider converted at a different rate than the one you recorded.

*Cause:* they used their rate rather than your quote, or converted at a different time. *Effect:* the amounts reconcile in neither currency, and **the difference silently becomes an unrecorded FX gain or loss.** *Resolution:* adjusting entries to the FX position plus an FX gain/loss account, and **an alert if the pattern is systematic** — because a systematic rate difference means your quoting model disagrees with your provider's, which is a pricing bug rather than a break.

**\`SETTLEMENT_CALENDAR_SKEW\`** — a payment settles in one currency on day 1 and its counterpart on day 3, because the currencies have different settlement cycles.

*Cause:* normal market structure, not an error. *Effect:* **for two days the ledger legitimately shows an unmatched position** — and a naive reconciliation reports it as a break every single time. *Resolution:* the matcher must know each currency's settlement calendar and **not open a break until the expected settlement date has passed.** Otherwise the queue fills with items that resolve themselves, which is how a break queue becomes ignored.

**\`FX_POSITION_DRIFT\`** — the FX position accounts have accumulated a balance far from zero.

*Cause:* an imbalance between currency inflows and outflows, or a bug. *Effect:* **real, unhedged market exposure.** *Resolution:* treasury action rather than a ledger fix — **and this is the break type with no engineering resolution**, which is worth noting because it is a break the platform must act on commercially.

**\`CROSS_CURRENCY_ORPHAN\`** — transfer 1 of a conversion committed and transfer 2 did not.

*Cause:* a failure between the two writes. *Effect:* **both per-currency invariants break at once**, which is the loudest possible signal. *Resolution:* complete or reverse the conversion. **And the design point: both transfers must be written in one atomic operation**, or this becomes common rather than exceptional.

*And one more worth naming:* **\`MULTI_PROVIDER_SPLIT\`** — a payment collected through a provider in one region and paid out through another, so no single settlement file contains both sides. **Reconciliation must join across providers**, which means the conversion record is the only link and it had better be correct.

---

**Part 4 — four new failure modes**

**1. A stale rate quoted at checkout.** The rate feed lags or is cached too long. **Customers are quoted a rate the market has moved away from**, and the platform absorbs the difference on every transaction in the same direction.

*Effect:* systematic FX loss that looks like normal margin variation. *Mitigation:* a maximum rate age, **refusal to quote on a stale rate** rather than quoting an old one, and monitoring realised versus quoted rates as a distribution.

**2. Rounding accumulating at conversion boundaries.** Integer minor units are exact within a currency, and **conversion always involves a division that must round.** At millions of conversions the residue is material.

*Effect:* the FX position drifts by rounding alone, and the direction depends on the rounding rule. *Mitigation:* **a defined rounding policy with the residue posted to an explicit rounding account** rather than absorbed silently. **If rounding has nowhere to go, it goes into your invariant.**

**3. Asymmetric refunds.** A customer paid EUR 100 at 1.08 and is refunded weeks later when the rate is 1.12. **Refunding EUR 100 costs USD 112 against USD 108 received.**

*Effect:* refunds are systematically loss-making in one rate direction. *Mitigation:* a decision to record explicitly — **refund at the original rate (customer made whole, platform bears movement) or at the current rate (customer bears it).** Either is defensible; **undefined is not**, and it must be the same choice every time or the position drifts unpredictably.

**4. Settlement in an unexpected currency.** A provider settles in USD what you expected in EUR, netting at their own rate. **Your matcher finds nothing on either side.**

*Effect:* a large unmatched block and a manual investigation. *Mitigation:* settlement ingestion that reads the file's stated currency rather than assuming, and **a break type for currency mismatch** so it is classified rather than mysterious.

*And a fifth:* **the FX margin becoming negative under volatility.** A 0.46% margin does not cover a 2% intraday move. **The quoting model needs a volatility-aware margin**, or high-volatility currencies are loss-making by construction.

---

**The single number I would monitor**

**The FX position accounts' combined value at current market rates, expressed in the platform's reporting currency — tracked as a time series.**

**Why this one.** It is the single number that captures whether FX handling is *correct*, in the strongest available sense:

\`\`\`
Position near zero and stable
  → inflows and outflows balance, rounding is contained,
    rates are being applied consistently

Position drifting steadily in one direction
  → a systematic error: a stale feed, a rounding leak,
    a refund asymmetry, or genuine unhedged exposure

Position jumping
  → conversions failing halfway (orphans) or a rate
    source problem
\`\`\`

**It aggregates every FX failure mode into one observable**, because every one of them ends up in the position accounts. **Rounding residue, stale rates, asymmetric refunds and orphaned conversions all drift the position** — and none of them shows up in a per-currency invariant, which stays satisfied throughout.

**And it is the number with money attached.** A drifting position is not an abstract inconsistency; **it is unhedged market exposure that will be realised as a gain or loss.** So it is simultaneously a correctness signal and a risk measure, which is unusual and valuable.

*The refinement:* monitor it **decomposed by cause** — position from timing (expected, self-correcting), from rounding (should be tiny and bounded), from margin (should be positive), and unexplained (should be zero). **The unexplained component is the engineering metric**, and it is the one that should alert.

*Why not break count, or rate accuracy:* break count is dominated by settlement-calendar noise, and rate accuracy per transaction misses the aggregate. **The position is where all the errors sum**, which is exactly the property the zero-sum invariant had within a currency.

---

**What this reveals about the original per-currency invariant**

**It reveals that "per currency" was not a scoping convenience — it was a statement about where value is conserved, and it was precisely right.**

The original invariant said: all entries in a currency sum to zero. **The reason that works is that within one currency, money is only ever moved, never created or destroyed.** Conservation holds, so a zero sum is the correct expression of it.

**Cross-currency movement is not a move — it is an exchange**, and value is not conserved in either currency across it. EUR genuinely leaves the EUR world and USD genuinely enters the USD world. **So the invariant did not need generalising; it needed the exchange to be modelled as two conserved moves with an explicit meeting point.**

**Three things follow.**

**The FX position account is not a workaround — it is the ledger being honest about where value crosses a boundary.** A design that "fixed" the invariant by making it cross-currency — summing everything at current rates — **would have destroyed the self-check entirely**, because the sum would then move with the market and could never be expected to be zero. **The correct response to an invariant that breaks is often to model the thing that broke it, not to weaken the invariant.**

**And the FX position gives you something the original design did not have: a place where a whole class of errors accumulates visibly.** Within a currency, errors break the invariant loudly. **Across currencies, errors drift a balance** — quieter, but monitorable, and arguably more informative because the magnitude tells you how bad it is rather than merely that something is wrong.

**Third: the invariant's scope told you the system's boundaries, and you could have read it that way from the start.** "Zero-sum per currency" implies "each currency is a closed system" — **so the moment currencies must interact, you know exactly where the new machinery goes.** The invariant was documentation of a structural assumption, not just a check.

*The transferable form:* **when an invariant breaks under a new requirement, ask whether the requirement violates the conservation law the invariant expresses, or merely exceeds its scope.** If it exceeds the scope, widen it. **If it violates conservation — as an exchange does — then model the crossing explicitly and keep the invariant intact**, because an invariant you weakened to accommodate a case is an invariant that no longer detects anything.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hp-1',
      level: 'basic',
      question: 'Design a payment system. How do you guarantee money moves exactly once?',
      guidance:
        'Look for rejection of the premise, then the decomposition: at-least-once, idempotent application, reconciliation. A candidate who claims exactly-once as a primitive has not understood the problem.',
    },
    {
      id: 'iq-hp-2',
      level: 'basic',
      question: 'How do you store balances?',
      guidance:
        'Append-only double-entry ledger with derived balances and snapshots as a cache. Strong answers name the zero-sum invariant as a continuous self-check and use integer minor units.',
    },
    {
      id: 'iq-hp-3',
      level: 'intermediate',
      question: 'Your charge call to the provider times out. Walk me through it.',
      guidance:
        'Explicit UNKNOWN, no ledger entries, resolve by query with backoff, then a break. Look for "a timeout is an unknown, not a failure".',
    },
    {
      id: 'iq-hp-4',
      level: 'intermediate',
      question: 'Where do idempotency keys live and who generates them?',
      guidance:
        'Three layers, client-generated before the first attempt, with the request hashed. Strong answers explain which gap each layer covers.',
    },
    {
      id: 'iq-hp-5',
      level: 'advanced',
      question: 'The provider is down with hundreds of in-flight charges. Do you fail over?',
      guidance:
        'Only unconfirmed intents. Keys are not portable, so failing over an in-flight intent risks an undetectable cross-provider double charge.',
    },
    {
      id: 'iq-hp-6',
      level: 'advanced',
      question: 'How does reconciliation work, and how big is it?',
      guidance:
        'Typed breaks with automated resolutions and a human queue; 5,000/day at 99.99% agreement. Excellent answers measure break age, and say breaks are not defects to eliminate.',
    },
    {
      id: 'iq-hp-7',
      level: 'followup',
      question: 'What does "settled" mean and why does it matter?',
      guidance:
        'Bank-confirmed, days later, and the only true state. Shipping on captured is a deliberate business trade rather than a technical assumption.',
    },
    {
      id: 'iq-hp-8',
      level: 'followup',
      question: 'Now add multi-currency. What happens to your invariant?',
      guidance:
        'It stays per-currency, with FX position accounts as the explicit crossing point and the rate recorded as data. Look for refusal to weaken the invariant into a cross-currency sum.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hp-1',
      kind: 'what-changes-if',
      prompt:
        'Change one thing: the platform holds both sides — a closed-loop wallet where users top up once and then transfer to each other internally. What collapses, what remains, and what new problem replaces the old one?',
      discussion: `Most of this design's complexity exists because **an external party's record is authoritative and you cannot know it synchronously.** Holding both accounts removes that for internal transfers, and the amount that collapses is striking.

**What collapses.**

**The UNKNOWN state disappears for internal transfers.** A wallet-to-wallet transfer is two ledger entries in one local transaction. **It either commits or it does not, and you know which** — there is no network boundary and no separate organisation.

**Reconciliation against a provider largely disappears** for the internal flow. **There is no settlement file to match** because nobody else holds a competing record. The engine remains only for the top-up and withdrawal edges.

**The three money states collapse to one internally.** No authorised-versus-captured-versus-settled, because **the ledger write *is* the settlement.** Your record is authoritative for the first time in this design.

**And the in-flight failover prohibition becomes irrelevant internally**, since there is no provider to fail over between.

**So the reconciliation engine, the UNKNOWN resolution loop, and the multi-state money model — three of the design's five hard parts — apply only at the boundary**, which is a small fraction of transaction volume once users hold balances.

**What remains, and remains essential.**

**The append-only double-entry ledger, unchanged and more important.** It is now the *only* record — **there is no external authority to reconcile against, so the ledger's internal self-check is the only correctness mechanism you have.** The zero-sum invariant goes from valuable to load-bearing.

**Idempotency, because clients still retry.** A user's app resending a transfer request over a flaky mobile connection is the same problem as before. **The key and the request hash are still required** — and layer 2 disappears while layers 1 and 3 remain.

**Immutability and audit.** Disputes, regulatory requirements and "why is my balance this" are unchanged.

**And the boundary keeps every original problem.** Top-ups come from cards, withdrawals go to banks — **so the full machinery exists for those, just at lower volume.** Which is a nice property: the hard parts are confined to a narrow, well-defined edge.

**What new problem replaces it, and it is a bigger one.**

**You are now holding other people's money, which makes you liable for it in a way you were not before.**

\`\`\`
Card payments: money passes through. Your ledger tracks
               a flow, and the balances are transient.
Wallet:        money SITS with you. The sum of all user
               balances is a liability you must be able
               to honour, in full, at any moment.
\`\`\`

**Three consequences, each larger than anything in the original design.**

**The float must be segregated and provably sufficient.** The sum of user wallet balances must equal the money you actually hold in a real bank account. **That is a new invariant, and unlike the zero-sum check it cannot be verified from the ledger alone** — it requires comparing the ledger's liability total against an external bank balance. **Which means reconciliation comes back, in a more consequential form: not "did this payment happen" but "do we have the money we owe."**

*And that check is the one a regulator asks about.* A break in the zero-sum invariant is an engineering problem; **a shortfall between liabilities and the float is an insolvency.**

**Internal transfers create a systemic settlement risk that did not exist.** With card payments, each transaction is independent. **With wallets, a user's balance is a claim on a shared pool**, so a bug that credits without debiting does not merely produce a wrong number — **it creates money.** The zero-sum invariant catches the entry-level version; it does not catch a correct-looking transfer from an account that should have been frozen.

**And you acquire obligations you cannot design away.** Holding customer funds brings licensing, capital requirements, anti-money-laundering monitoring, and transaction limits. **Internal transfers between users are exactly the pattern money-laundering controls exist to watch**, so a monitoring subsystem becomes mandatory — **replacing reconciliation with something of comparable size and less forgiving failure modes.**

**What I would build differently.**

\`\`\`
Ledger:      unchanged, and now the sole authority
Invariants:  zero-sum per currency (as before)
             + SUM(user balances) == float account balance
               ← checked against the BANK, continuously
Boundary:    full original machinery for top-up/withdrawal
             (UNKNOWN, keys, provider reconciliation)
Internal:    single-transaction two-entry transfers,
             idempotent by client key
New:         float reconciliation, transaction monitoring,
             and limits enforced before the ledger write
\`\`\`

**The honest summary.** A closed loop removes the *epistemic* problem — not knowing what happened — and replaces it with a *custodial* one: being responsible for money you hold. **The engineering gets simpler and the stakes get higher**, which is an uncomfortable trade and the right one to name out loud.

**The transferable point:** when a design's complexity comes from an external authority you must agree with, **bringing the boundary inside removes the agreement problem and makes you the authority** — which means every error that was previously a disagreement to reconcile becomes a loss with nobody to check it against. **Being authoritative is not a simplification; it is a transfer of responsibility.**`,
    },
    {
      id: 'al-hp-2',
      kind: 'debug',
      prompt:
        'The zero-sum invariant check fails: entries in USD sum to +$4,312.40 rather than zero. It has been drifting upward for six days, roughly $700 a day. No deploy correlates, payment volume is flat, and the break queue is at its normal size with normal age. Diagnose it.',
      discussion: `**A drifting invariant rather than a step change is the most informative detail**, and it narrows this sharply before any hypotheses.

A step change would point at a deploy or a one-off event. **A steady daily drift of a similar magnitude points at something happening on a fraction of ordinary transactions** — a code path exercised regularly, producing one unbalanced transfer each time.

\`\`\`
$700/day over ~600 payments/s... no.
$700/day is tiny relative to volume, so this is either:
  · a small number of transfers with large imbalances, or
  · a large number with tiny ones (rounding)
\`\`\`

**Establishing which of those it is should be the first action**, because it splits the hypotheses cleanly and it is a single query: **the distribution of per-transfer sums that are non-zero.**

**Hypothesis 1 — a rounding residue with nowhere to go.** Some calculation divides — a fee percentage, a split, a tax — and the remainder is dropped rather than posted anywhere.

\`\`\`
Fee 2.9% of $47.31 = $1.37199 → $1.37, and $0.00199 vanishes
× hundreds of thousands of payments/day = hundreds of dollars
\`\`\`

**Why it fits perfectly:** a steady daily drift proportional to volume, in a consistent direction (rounding down the debit side creates a credit surplus), with no deploy needed if the path has always been slightly wrong and only recently started being checked — **or if a fee rate changed to a value that rounds differently.**

*Check:* the distribution of non-zero transfer sums. **Many transfers off by sub-cent-to-cent amounts confirms it immediately.** This is my leading hypothesis because the magnitude and the steadiness both match.

**Hypothesis 2 — a new entry type that is not being balanced.** A transfer type added or newly exercised writes one side and omits the other — a fee, a tax, or an FX margin credited without a corresponding debit.

*Why it fits:* a smaller number of transfers, each off by a larger amount. **And "no deploy correlates" does not rule it out** if the code shipped earlier and a configuration change started routing traffic through it six days ago.

*Check:* group non-zero transfers by \`entry_type\` and by the set of types present. **If the imbalance concentrates in transfers containing one particular type, that is the answer** — and it is a more serious bug than rounding because the amounts are material per transaction.

**Hypothesis 3 — a break resolution writing unbalanced adjusting entries.** Resolutions append correcting transfers, and **a resolution path that credits an account without a balancing debit breaks the invariant on every use.**

*Why "the break queue is normal" does not exonerate this:* a normal-sized queue with normal age means resolutions are *happening* — **which is exactly when this bug would fire.** The queue's health is consistent with the hypothesis rather than against it.

*Check:* whether the non-zero transfers carry a \`break_id\` reference. **A direct query, and it distinguishes this from everything else in one step.**

**Hypothesis 4 — a partial write: one side of a transfer committed and the other did not.** The per-transfer zero-sum check should have rejected it at write time, **so this implies the check is not enforced synchronously**, or entries are written in separate transactions.

*Why it fits a steady drift:* a small constant failure rate on a two-write path produces exactly this. *Check:* whether the imbalanced transfers have an odd number of entries or a missing counterpart account. **And critically, whether the per-transfer invariant is actually enforced on write** — if it is not, that is the real finding, because it means the loud local check was never running and only the slow global one is.

**Hypothesis 5 — a currency mislabelling.** An entry intended as another currency is recorded as USD, so **USD gains an entry whose counterpart sits in a different currency's sum.**

*Why it would show as a one-sided drift:* the other currency would show a matching opposite drift. *Check:* **whether any other currency's sum has drifted by a corresponding amount at current rates.** That single comparison confirms or eliminates it, and it is worth running early because it is cheap.

**What I would check first: the distribution of non-zero per-transfer sums, and whether any other currency is drifting oppositely.** Two queries. **The first splits rounding (many tiny) from a structural bug (few large); the second catches mislabelling.** Between them the space collapses to one or two candidates.

**Then: group the imbalanced transfers by entry type and by presence of a break reference.** That distinguishes hypotheses 2 and 3, which have very different fixes — a missing entry in a transfer builder versus a bad resolution path.

**Why "the break queue is normal" is the most misleading fact here.**

It invites the conclusion that reconciliation is healthy and therefore not involved. **But the break queue measures agreement with the provider, and this failure is internal** — the ledger disagreeing with itself. **A ledger can be internally inconsistent while matching the provider perfectly**, because the provider only sees payment amounts, not your internal fee, tax and revenue splits.

**Which is the important structural point: the two checks cover disjoint failure classes.** Reconciliation catches disagreement with the outside world; the zero-sum invariant catches disagreement with yourself. **Neither substitutes for the other**, and a normal break queue is no evidence at all about internal consistency.

**And what the drift being allowed to run for six days tells us.**

**The invariant was being computed and not alerted on**, or computed too infrequently. **A design whose central self-check runs slowly enough to let $4,000 accumulate has the check as documentation rather than as a control.**

**The response this demands.**

**Enforce the per-transfer zero-sum synchronously, on write, as a hard constraint.** This is the loud, local, cheap version — **it makes the bug impossible rather than detectable**, and any imbalance becomes a failed write with a stack trace pointing at the responsible code path. **If hypothesis 4 is right, this check was missing, and that is the root finding.**

**Run the global per-currency check continuously and alert on any non-zero value**, not on a threshold. **The correct value is zero, so any drift is actionable** — and a threshold is a decision to tolerate an unknown amount of wrongness.

**Post rounding residue to an explicit rounding account.** If rounding has nowhere to go, it goes into the invariant. **Giving it an account makes it visible, bounded and reportable** — and turns a correctness failure into a monitorable quantity.

**Require every transfer builder to balance by construction**, ideally by making the ledger API accept a *transfer* — a set of entries validated as summing to zero — rather than individual entries. **An API that can express an unbalanced transfer will eventually be used to write one.**

**And halt payouts while the invariant is broken**, per the design's own failure table. **Six days of paying out from suspect balances is the actual incident here** — the $4,312 is a symptom, and money that left on the strength of possibly-wrong balances is the real exposure.

**Transferable:** a self-check that is computed but not enforced is documentation. **Put the cheap local version in the write path as a constraint, and the expensive global version on a continuous alert at zero tolerance** — and never let a check whose correct value is exactly zero be monitored with a threshold.`,
    },
  ],

  revision: {
    bullets: [
      'Exactly-once money transfer does not exist as a primitive — the provider is across a network and a timeout is permanent uncertainty.',
      'What exists: at-least-once delivery, idempotent application, and reconciliation to find the residue.',
      'None of the three is optional; reconciliation is the one designs omit and then silently need.',
      'A balance column has no self-check, no history, and a dropped update is a permanently wrong number.',
      'An append-only double-entry ledger makes "all entries sum to zero per currency" a continuous self-check.',
      'Amounts are integers in minor units; float rounding would accumulate into the invariant forever.',
      'One payment produces about eight entries across its lifecycle — the ledger is ~8× the payment count.',
      'Balances are derived by summing entries, with snapshots as a cache: if they disagree, the entries win.',
      'Idempotency has three layers — your records, the provider\'s, and a deterministic transfer id.',
      'The idempotency record hashes the request, so the same key with a different amount is an error.',
      'A timeout is an unknown, not a failure: retrying without a key double-charges, abandoning loses money.',
      'UNKNOWN is an explicit state that writes no ledger entries, because the ledger records facts.',
      'An unknown resolves by querying the provider, never by re-charging, then becomes a break.',
      'An in-flight intent never fails over: keys are not portable, and cross-provider duplication is undetectable.',
      'Money has three states — authorised, captured, settled — and only settled is actually true.',
      '50 million payments/day at 99.99% agreement is 5,000 breaks/day, so reconciliation is a subsystem.',
      'Break age, not count, is the metric — an old break is misplaced money that has been misplaced for a while.',
      'Every break resolution appends adjusting entries; history is never edited.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A payment system built on an append-only double-entry ledger with a zero-sum invariant, three-layer idempotency, an explicit unknown state for in-flight operations, and a reconciliation engine that produces a typed break queue against the provider\'s authoritative settlement records.',
    whyItExists:
      'Because you cannot know synchronously whether money moved. Every mechanism here is a way of operating correctly while not knowing — and of detecting, rather than assuming away, the residue that remains.',
    whenToUse: [
      'An append-only double-entry ledger whenever balances must be explainable and provable.',
      'A client-generated idempotency key whenever a mutation crosses an unreliable boundary.',
      'An explicit unknown state whenever an outcome can be permanently ambiguous.',
      'Reconciliation as a subsystem whenever another party holds the authoritative record.',
      'Integer minor units for any monetary amount, always.',
    ],
    whenNotToUse: [
      'Balance columns as the record of money.',
      'Floats for monetary amounts.',
      'Retrying a charge without a key, or abandoning a timeout.',
      'Recording an unknown outcome as succeeded or failed.',
      'Writing ledger entries for an operation whose outcome is unknown.',
      'Failing an in-flight intent over to a different provider.',
      'A nightly job that logs mismatches.',
      'Treating captured as settled without deciding to.',
    ],
    alternatives: [
      'A closed-loop wallet, which removes the external unknown and replaces it with custodial liability.',
      'Ledger partitioned by account with asynchronous global invariant checking, at 10× volume.',
      'FX position accounts as an explicit crossing point, rather than weakening the per-currency invariant.',
      'An explicit rounding account, so residue is visible rather than absorbed into the invariant.',
      'A transfer-shaped ledger API that cannot express an unbalanced write.',
    ],
    tradeoffs: [
      'A double-entry ledger buys a continuous self-check and costs ~30 TB/year, growing forever.',
      'Three-layer idempotency buys zero double charges and costs permanent records plus a caller contract.',
      'An explicit unknown buys a factual ledger and costs payments in limbo until resolution.',
      'Failover only for unconfirmed intents buys no cross-provider duplication and costs stuck payments.',
      'Reconciliation buys detection of the residue and costs a permanent subsystem with staffing.',
      'Snapshots buy fast balance reads and cost occasional staleness.',
      'Treating settled as truth buys accuracy and costs shipping delay.',
    ],
    failureModes: [
      'Retrying a charge without a key, double-charging a customer.',
      'Abandoning a timeout, silently losing a payment.',
      'A balance column with no self-check, making every other error invisible.',
      'Float amounts accumulating rounding into the zero-sum invariant.',
      'Speculative ledger entries for an unknown outcome, destroying the invariant\'s meaning.',
      'Failing an in-flight intent over, producing an undetectable cross-provider double charge.',
      'Shipping on a synchronous success that the webhook later reverses.',
      'Mismatches logged rather than queued, so thousands of daily discrepancies accumulate.',
      'Rounding residue with no account to go to, drifting the invariant.',
      'A break resolution that edits history instead of appending a correction.',
      'The zero-sum check computed but not alerted at zero tolerance, letting drift run for days.',
    ],
    followUpQuestions: [
      'Is the record a ledger or a balance column?',
      'What is the invariant, and is it enforced on write or only checked later?',
      'Are amounts integers in minor units?',
      'Who generates the idempotency key, and how many layers deduplicate?',
      'Does the idempotency record hash the request?',
      'What state does a timed-out charge go into, and are ledger entries written?',
      'How does an unknown resolve — by query or by retry?',
      'Can an in-flight intent fail over to another provider?',
      'Which of authorised, captured and settled do you ship on?',
      'How many breaks per day, and what is the median break age?',
      'Does a break resolution append or edit?',
    ],
  },
});
