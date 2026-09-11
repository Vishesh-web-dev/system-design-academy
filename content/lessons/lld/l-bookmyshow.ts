import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-bookmyshow',
  title: 'Design BookMyShow',
  summary:
    'Seat booking is the inventory reservation with two twists: the claim is a set that must succeed atomically, and the hold can expire while the payment it exists for is still in flight.',
  phase: 'lld',
  module: 'machine-coding',
  position: 67,
  kind: 'machine-coding',
  difficulty: 'advanced',
  estimatedMinutes: 80,
  tags: ['holds', 'atomic-claims', 'state-machine', 'idempotency'],
  prerequisites: ['l-splitwise', 'f-transactions'],
  resources: [
    {
      key: 'postgres-explicit-locking',
      tier: 'must',
      note: 'Read it for the difference between a lock and a conditional update once more, and this time for the multi-row case: the ordering requirement that prevents deadlock is stated there, and it is the detail multi-seat claims turn on.',
    },
    {
      key: 'postgres-transaction-iso',
      tier: 'must',
      note: 'Read the isolation levels with this problem in mind. A multi-seat claim is where read-committed and serialisable genuinely differ, and knowing which anomaly each permits is what lets you defend a conditional update instead.',
    },
    {
      key: 'stripe-idempotent-requests',
      tier: 'must',
      note: 'Read it a third time, now for the retry-after-timeout case specifically. A booking whose payment outcome is unknown is the hardest state in this design, and the key is what makes retrying it safe.',
    },
    {
      key: 'xstate-statecharts',
      tier: 'good',
      note: 'Read it for guards on transitions. The interesting states here are the irregular ones — expired-during-payment, paid-but-seats-gone — and each is a guard rather than a state, which is a distinction worth getting right.',
    },
    {
      key: 'redis-expire',
      tier: 'good',
      note: 'Read the expiry semantics for the hold store. Lazy expiry on read plus a sampled sweep is the right shape here, and the reason is the same as everywhere else: correctness must not depend on a background job running.',
    },
  ],

  intuition: {
    body: `Everyone reaches for the same word, and it is the wrong one: **"lock the seat."**

\`\`\`
BEGIN
  SELECT ... FOR UPDATE on the seat rows
  <the user enters card details — 40 seconds>
  <a bank redirect — another 60>
COMMIT
\`\`\`

**A database lock held across a payment is the anti-pattern from the e-commerce lesson**, now with a human in the middle. It holds connections, it blocks every other viewer of that seat, and **if the process dies the lock outlives the intent.**

**What you want is a hold: a claim with a stored deadline.** No lock, no transaction spanning a network call, and **a dead client releases its seats by the clock rather than by anyone noticing.**

Then the twist that makes this harder than the e-commerce case: **the claim is a set.**

\`\`\`
"Four seats together in row H"
→ H12, H13, H14, H15 — all four or none
→ two users each getting two of them is the worst
   possible outcome: neither can use them
\`\`\`

**A partial claim is worse than a refusal**, so the claim must be atomic across seats — **and the naive loop over seats with a rollback is where deadlock enters**, because two users claiming overlapping sets in different orders each hold what the other needs.

**And the second twist, which is the one candidates miss: the hold can expire during the payment it exists for.**

\`\`\`
t=0    hold 4 seats, expires at t=600
t=540  user starts payment
t=610  payment succeeds
       → the hold expired 10 seconds ago
       → the seats may already be someone else's
\`\`\`

**Neither answer is free.** Refusing the booking after taking the money means an immediate refund; **extending the hold at payment start means a failed payment holds seats longer than the policy says.** The design has to choose, and say so.

**Finally, the thing that separates this from a pure backend problem: the seat map is a live view.** Every hold changes what other users see, **so availability is a stream** — and a popular show produces enough churn that broadcasting every change is its own problem.`,
    analogyLimit:
      '"Reserve a seat like reserving stock" gets you the hold and the expiry and stops at the two things that make this harder. Stock is fungible, so a partial allocation is fine — four of six units is a smaller order; seats are not, so four of six seats is a booking nobody wants, which makes the claim atomic across a set. And a stock reservation is invisible to other shoppers, while a seat hold changes the map everyone is looking at in real time.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate designs: `BEGIN; SELECT seats WHERE id IN (...) FOR UPDATE; check all available; UPDATE them to booked; call the payment gateway; COMMIT`. Holds are not modelled — the transaction is the hold. Identify four problems and rank them.',
      answer: `**Problem 1 — a transaction held across a payment call, which is the design error.**

\`\`\`
The transaction is open for the duration of:
  card entry (30–60 s) + gateway round trip + a possible
  3-D Secure challenge (30–120 s)
→ a database connection held for minutes, per booking
→ locks held on those seat rows for the same duration
→ and every other user selecting those seats blocks
\`\`\`

**A connection pool is exhausted by a few hundred concurrent checkouts**, and the blocking is worse than the resource cost: **other users' seat-map reads stall rather than showing the seats as taken.**

**And the failure mode is ambiguous in the same way as the e-commerce case.** If the gateway times out, **rolling back does not un-charge the customer** — and the rollback silently frees seats that may have been paid for.

*The fix:* **a hold with a stored expiry**, committed immediately, and the payment outside any transaction.

**Problem 2 — no hold means a crash holds seats until a lock times out, or forever.**

Without a hold record, **the only thing marking the seats is the open transaction.** A client that closes their browser leaves the transaction open until a server-side timeout — **and the timeout is a database setting, not a product decision.**

**A hold makes the expiry explicit and product-owned:** ten minutes, visible to the user as a countdown, **and evaluated on read so no sweeper is required for correctness.**

**Problem 3 — \`FOR UPDATE\` on a set without a deterministic order deadlocks.**

\`\`\`
User A: locks H12, then H13
User B: locks H13, then H12
→ each holds what the other needs
→ the database detects it and kills one transaction
\`\`\`

**\`IN (...)\` does not guarantee lock acquisition order**, so the deadlock is real under concurrency. **Ordering the seats — by id — removes it entirely**, and it is a one-line fix that a candidate should name.

*And the better answer avoids locks altogether:* **one conditional update over the whole set**, checking that the affected row count equals the number of seats requested.

**Problem 4 — no idempotency, so a retried request double-books or double-charges.**

**The user's browser retries a timed-out request.** Without a key, the second attempt is a new booking: **either it fails because the seats are now held by the first attempt, or — worse — the first attempt failed after charging and the retry charges again.**

**What the corrected shape is.**

\`\`\`
1. hold(showId, seatIds, userId, idempotencyKey, now)
     → one atomic conditional claim over the set
     → a hold row with expiresAt = now + 10 min
     → COMMIT immediately
2. pay(holdId, paymentMethod, idempotencyKey)
     → outside any transaction
     → the gateway's own idempotency plus ours
3. confirm(holdId, paymentRef)
     → conditional on the hold still being valid
\`\`\`

**Three short transactions instead of one long one**, with the slow external call between them rather than inside them.

**Ranking. Problem 1 is the design error** and it causes an outage under load rather than a correctness bug. **Problem 4 charges customers twice**, which is the most damaging individual failure. Problem 3 is a real deadlock with a one-line fix. Problem 2 is the missing concept that problems 1 and 3 are symptoms of.

**The transferable diagnostic: find the slowest thing inside the transaction.** If it is a network call to another organisation, **the transaction boundary is in the wrong place** — and no isolation level fixes that.`,
    },
  body: `## Requirements and the invariant

**Five questions, each with a consequence.**

\`\`\`
"Must a multi-seat selection be all-or-nothing?"  → atomic claim
"How long is a hold, and who sees the countdown?" → a product number
"Can a hold expire mid-payment, and then what?"   → the hard policy
"Is the seat map live for other users?"            → a stream
"Can the same seat ever be sold twice?"            → never; physical
\`\`\`

\`\`\`
INVARIANT
  a seat is available, held by exactly one hold, or booked by
    exactly one booking — never two of these
  a hold covers a set of seats; either all are held by it or
    none are
  an expired hold confers nothing, whether or not a sweeper ran
  a confirmed booking's seats were held by that booking at the
    moment of confirmation
\`\`\`

**The last clause is the one the expiry race attacks**, and stating it up front is what forces the policy decision rather than leaving it to whichever code path runs first.

## Holds, not locks

\`\`\`ts
interface Hold {
  id: HoldId;
  showId: ShowId;
  seatIds: readonly SeatId[];
  userId: UserId;
  state: 'held' | 'paying' | 'confirmed' | 'released' | 'expired';
  createdAt: number;
  expiresAt: number;            // STORED, not a timer
  idempotencyKey: string;
}

function isActive(h: Hold, now: number): boolean {
  return (h.state === 'held' || h.state === 'paying')
      && h.expiresAt > now;     // evaluated on READ
}
\`\`\`

**Three properties, and the third is the one that matters operationally.**

**The expiry is data.** A hold is expired if \`expiresAt <= now\`, **whether or not any sweeper has run** — so a stopped background job costs capacity rather than leaking seats. **The fourth appearance of this pattern in the course**, and by now it should be reflexive.

**Nothing is held across a network call.** The hold is committed in milliseconds; **the payment happens with no transaction open.**

**And the countdown is the user's contract.** \`expiresAt\` is returned to the client and displayed, **so the user knows how long they have** — which reduces abandonment and makes the expiry defensible rather than surprising.

## The atomic multi-seat claim

**Two implementations, and the first is better where the store allows it.**

\`\`\`sql
-- (a) One statement, one round trip, no ordering concern
UPDATE seats
   SET hold_id = :holdId, held_until = :expiresAt
 WHERE show_id = :showId
   AND seat_id IN (:seatIds)
   AND (hold_id IS NULL OR held_until <= :now)   -- free or lapsed
   AND booking_id IS NULL;
-- then: if affectedRows <> seatIds.length → ROLLBACK, 409
\`\`\`

**The affected-row count is the check.** Four seats requested and three updated means **someone else holds one of them**, and the transaction rolls back — **so the all-or-nothing property comes from the statement rather than from application logic.**

\`\`\`ts
// (b) Per-seat conditional claims, in DETERMINISTIC order
const ordered = [...seatIds].sort();          // ← prevents deadlock
const claimed: SeatId[] = [];
for (const id of ordered) {
  if (!seats.get(id)!.tryClaim(holdId, expiresAt, now)) {
    for (const c of claimed) seats.get(c)!.release(holdId);
    return { ok: false, reason: 'seat-taken', seatId: id };
  }
  claimed.push(id);
}
\`\`\`

**Three things (b) must get right.**

**Sorted order, always.** Two users claiming overlapping sets in opposite orders each hold what the other needs — **a genuine deadlock, and sorting removes it because every claimer acquires in the same sequence.**

**Release on partial failure**, and release only what this hold claimed — **a release keyed by hold id, so a hold cannot free someone else's seat.**

**And the failure names the seat.** "H14 is taken" lets the client grey out that seat and re-suggest, **which is the result-over-boolean habit in a user-facing flow.**

*Which to use:* **(a) where a single conditional statement over the set is available**, because it is one round trip and has no ordering concern at all. **(b) when claims are spread across stores or the state is in memory** — and then the sort is mandatory rather than a nicety.

## The booking state machine

\`\`\`
selecting ──hold──▶ held ──start_payment──▶ paying
                     │                        │
     release / expiry│                        │ payment result
                     ▼                        ▼
                 released              ┌──────┴───────┐
                                       │              │
                                  confirmed        failed
                                       │              │
                                   (seats booked)  released
\`\`\`

**Four things the diagram decides.**

**\`paying\` is a distinct state from \`held\`.** It matters because **the expiry policy differs**: a hold that has entered payment may be treated differently from one where the user is still choosing, **which is the next section.**

**\`held → confirmed\` is not drawn.** Confirmation requires a payment result, **so the absence says a booking cannot be confirmed without one.**

**\`expired\` and \`released\` are separate.** One is the clock, the other is a user action — **and the difference matters for analytics and for whether a seat becomes available immediately or at the next read.**

**And every transition is recorded with who and when**, because "the seats I paid for were released" is a dispute that needs an answer.

## The expiry-during-payment race

**This is the hardest decision in the problem, and it has no free answer.**

\`\`\`
t=0    hold 4 seats, expiresAt = 600
t=540  start_payment
t=610  gateway returns success
       → the hold expired at 600
       → seats may already be held or booked by someone else
\`\`\`

**Three policies.**

**(1) Extend the hold when payment starts.**

\`\`\`
on start_payment: expiresAt = now + PAYMENT_WINDOW (e.g. 5 min)
+ simple, and the common case never races
− a hold that enters payment and fails holds seats for the
  full extended window
− and a user who starts payment and abandons gets more time
  than one who does not
\`\`\`

**(2) Do not extend; on success, re-acquire the seats.**

\`\`\`
on payment success with an expired hold:
  attempt the atomic claim again
  → succeeded: confirm
  → failed:   REFUND, and tell the user
+ the hold policy is honest — ten minutes means ten minutes
− some customers are charged and refunded, which is a poor
  experience even when handled correctly
\`\`\`

**(3) Extend, and treat the payment window as part of the hold policy.**

\`\`\`
Total hold = selection window + payment window, stated up front
+ one number the user sees, no surprise
− the seat is unavailable to others for longer
\`\`\`

**I would implement (1) with a short payment window and (2) as the fallback**, and say why: **the extension makes the race rare rather than impossible**, so the re-acquire path must still exist — **and a design that extends without a fallback has an unhandled case that will occur.**

*And the refund path must be idempotent and auditable*, because it is money moving on a failure path — **the payments lesson's compensation, at this scale.**

**One more detail worth volunteering: release the hold as soon as payment fails**, rather than waiting for the expiry. **A declined card should free the seats immediately**, since the user is not coming back for those seats in the next five minutes.

## Idempotent booking

\`\`\`ts
POST /holds        { showId, seatIds, idempotencyKey }
POST /holds/{id}/pay { paymentMethod, idempotencyKey }
\`\`\`

**Two layers, as in the payments lesson.**

**Our records**, keyed by the client-supplied key with a hash of the request: **a retry returns the original result rather than re-executing.** Without it, a retried hold request either fails against its own first attempt or creates a second hold on different seats.

**And the gateway's key**, passed through, **so a timeout on our side cannot produce two charges.**

*The case worth naming:* **a hold request that times out on the client.** The user's browser retries; **with the key, the second request returns the same hold and the same \`expiresAt\`** — so the countdown does not restart, which is both correct and what the user expects.

## The live seat map

**Every hold changes what other users see**, so availability is a stream rather than a poll.

\`\`\`
Popular show, 500 seats, 2,000 concurrent viewers
Seat state changes: ~50/second during the first minutes
Naive broadcast: 50 × 2,000 = 100,000 messages/second
\`\`\`

**Three mitigations, and the second is the important one.**

**Send deltas, not the map.** A seat-state change is a few bytes; the full map is kilobytes.

**Coalesce and throttle per viewer.** At most a few updates per second per client, **batching everything that changed in the interval** — which cuts the message count by an order of magnitude and loses nothing, since a user cannot act on 50 updates a second.

**And treat the stream as advisory.** The map is a hint; **the claim is the truth.** So a user clicking a seat that was taken 200 ms ago gets a clean 409 naming the seat — **the same relationship as a cached availability badge and the reservation in the e-commerce design.**

## Tests

\`\`\`ts
test('a four-seat claim is all-or-nothing', () => {
  hold(['H12','H13','H14'], userA, t0);
  const r = hold(['H14','H15','H16','H17'], userB, t0);
  expect(r.ok).toBe(false);
  expect(seatState('H15', t0)).toBe('available');   // ← not held
});

test('overlapping claims in opposite orders do not deadlock', () => {
  // claim ['H13','H12'] and ['H12','H13'] concurrently
  // exactly one succeeds, neither blocks
});

test('an expired hold confers nothing without a sweeper', () => {
  const h = hold(['H12'], userA, 0);
  expect(canClaim('H12', userB, 601)).toBe(true);   // no sweep ran
});

test('a retried hold with the same key returns the same hold', () => {
  const a = hold(['H12'], userA, 0, 'key-1');
  const b = hold(['H12'], userA, 5, 'key-1');
  expect(b.holdId).toBe(a.holdId);
  expect(b.expiresAt).toBe(a.expiresAt);            // countdown intact
});

test('payment succeeding after expiry re-acquires or refunds', () => { /* ... */ });
\`\`\`

**The first test's second assertion is the one that matters:** a failed claim must leave **no** seats held, **so checking that H15 is still available is what proves the rollback.** Asserting only that the call failed would pass for a partial claim.

## What to say in the last three minutes

**That it is a hold with a stored expiry, not a lock** — and that nothing is held across the payment call.

**That the multi-seat claim is atomic**, by affected-row count or by sorted per-seat claims, **and that the sort is what prevents deadlock.**

**The expiry-during-payment policy, explicitly** — extend on payment start, with re-acquire-or-refund as the fallback that must still exist.

**Idempotency at two layers, and that a retried hold returns the same countdown.**

**That the seat map is advisory and the claim is the truth.**

**And what you left out:** seat pricing tiers, group discounts, cancellation windows, and the fairness question for a high-demand release.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'transaction-boundary',
      title: 'Where the transaction ends is the whole design',
      caption:
        'Read the left column as what "lock the seat" produces. The slow thing is a call to another organisation, and no isolation level makes it safe to hold a transaction across it.',
      code: `sequenceDiagram
    participant U as User
    participant S as Server
    participant D as Database
    participant G as Gateway

    rect rgb(40, 24, 24)
    note over U,G: **Transaction across the payment**
    S->>D: BEGIN; SELECT ... FOR UPDATE
    note over D: seat rows locked
    U->>S: enters card details (40 s)
    S->>G: charge
    note over G: 3-D Secure challenge (90 s)
    note over D: **connection + locks held<br/>for over two minutes**<br/>every other viewer of<br/>these seats BLOCKS
    G-->>S: timeout — charged or not?
    S->>D: ROLLBACK
    note over S,D: **the rollback does not<br/>un-charge the customer,<br/>and it silently frees seats<br/>that may have been paid for**
    end

    rect rgb(23, 39, 42)
    note over U,G: **Hold, then pay, then confirm**
    S->>D: atomic claim over the seat set
    D-->>S: 4 rows affected → COMMIT (milliseconds)
    note over S: hold.expiresAt = now + 10 min<br/>**returned to the user as<br/>a countdown**
    U->>S: enters card details
    S->>G: charge (idempotency key)
    G-->>S: result
    S->>D: confirm, conditional on the hold<br/>still being valid
    note over S,D: **three short transactions,<br/>the slow call between them**
    end`,
    },
    {
      kind: 'flow',
      id: 'expiry-race',
      title: 'The race the design must choose a policy for',
      caption:
        'Step through it. Extending makes the race rare and not impossible, which is why the re-acquire path must exist — a design that extends without a fallback has an unhandled case that will occur.',
      nodes: [
        { id: 'hold', label: 'Hold: atomic claim over the set', kind: 'service', x: 0, y: 140, detail: 'All-or-nothing, because four of six seats is a booking nobody wants. Either one conditional statement checking the affected-row count, or per-seat claims in sorted order — and the sort is what prevents two users claiming overlapping sets from deadlocking.' },
        { id: 'expiry', label: 'expiresAt, stored and read-evaluated', kind: 'store', x: 250, y: 40, detail: 'A hold is expired if the deadline has passed, whether or not a sweeper ran — so a stopped background job costs capacity rather than leaking seats. And the deadline is returned to the user as a countdown, which makes the expiry a contract rather than a surprise.' },
        { id: 'pay', label: 'Payment, outside any transaction', kind: 'external', x: 250, y: 230, detail: 'Card entry plus a possible 3-D Secure challenge is a minute or more. Nothing database-side is held across it: the hold was committed in milliseconds, and the payment is an ordinary call with an idempotency key.' },
        { id: 'race', label: 'The hold expires mid-payment', kind: 'note', x: 520, y: 140, detail: 'Neither answer is free. Refusing after taking money means an immediate refund; extending means a failed payment holds seats longer than the stated policy. The design must choose, and say which.' },
        { id: 'extend', label: 'Policy 1: extend on payment start', kind: 'service', x: 780, y: 40, detail: 'Makes the common case never race. Costs a longer hold when payment fails — mitigated by releasing immediately on decline rather than waiting for the expiry, since the user is not coming back for those seats.' },
        { id: 'reacquire', label: 'Policy 2: re-acquire, or refund', kind: 'service', x: 780, y: 230, detail: 'The honest policy — ten minutes means ten minutes — and the fallback that must exist even when extending, because extension makes the race rare rather than impossible. The refund path is money moving on a failure path, so it is idempotent and audited.' },
        { id: 'map', label: 'The seat map is advisory', kind: 'note', x: 520, y: 320, detail: 'Deltas, coalesced to a few per second per viewer — a user cannot act on fifty updates a second. And a click on a seat taken 200 ms ago gets a clean 409 naming it: the map is a hint, the claim is the truth.' },
      ],
      edges: [
        { id: 'b1', source: 'hold', target: 'expiry', kind: 'write' },
        { id: 'b2', source: 'hold', target: 'pay', kind: 'sync' },
        { id: 'b3', source: 'expiry', target: 'race', kind: 'control' },
        { id: 'b4', source: 'pay', target: 'race', kind: 'control' },
        { id: 'b5', source: 'race', target: 'extend', kind: 'control' },
        { id: 'b6', source: 'race', target: 'reacquire', kind: 'control' },
        { id: 'b7', source: 'hold', target: 'map', kind: 'async' },
      ],
      steps: [
        {
          id: 'bs1',
          title: 'The claim is a set, and it is all-or-nothing',
          description:
            'Two users each getting two of four adjacent seats is the worst outcome — neither can use them. Atomicity comes from the affected-row count, or from sorted per-seat claims.',
          nodes: ['hold'],
          edges: [],
        },
        {
          id: 'bs2',
          title: 'Then commit, and leave the transaction',
          description:
            'The hold is stored with a deadline and the payment happens outside any transaction. A lock held across a bank redirect exhausts connections and blocks every other viewer of those seats.',
          nodes: ['expiry', 'pay'],
          edges: ['b1', 'b2'],
        },
        {
          id: 'bs3',
          title: 'And the deadline can pass while the payment runs',
          description:
            'Ten minutes of hold, a payment started at minute nine, a gateway that takes ninety seconds. The seats may already belong to someone else when the money arrives.',
          nodes: ['race'],
          edges: ['b3', 'b4'],
        },
        {
          id: 'bs4',
          title: 'Choose a policy, and keep the fallback',
          description:
            'Extending makes the race rare; re-acquire-or-refund handles the rest. Implementing only the extension leaves a case that will occur and has no code path.',
          nodes: ['extend', 'reacquire'],
          edges: ['b5', 'b6'],
        },
        {
          id: 'bs5',
          title: 'Meanwhile everyone is watching the same map',
          description:
            'Deltas, coalesced per viewer, treated as a hint. The authoritative answer is the conditional claim, which is why a stale click gets a clean refusal naming the seat.',
          nodes: ['map'],
          edges: ['b7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['stripe'],
    body: `The payment-intent and idempotency documentation matters here for one specific case, and it is the case this design is hardest on: **a booking whose payment outcome is unknown.**

**The intent exists before the money moves**, which means a timed-out charge leaves a server-side object to query rather than an operation that may or may not have happened. **In a seat-booking flow that is the difference between "re-acquire the seats and confirm" and "we do not know whether to refund."**

**And the idempotency key must be generated before the first attempt**, which is an API constraint the booking endpoint inherits: **the hold request and the pay request each take a key from the client**, or a retried browser request cannot be recognised as the same operation.

**The third property is the one with product consequences: the authoritative outcome arrives asynchronously.** A synchronous success is not the end of the story, **so a booking confirmed on the synchronous response can be contradicted by a webhook minutes later** — and by then the tickets have been emailed.

**Three transferable lessons.**

**Create the durable object before the risky operation.** The hold plays that role for the seats and the intent plays it for the money; **both convert "did anything happen?" into "what is the state of this thing?"**

**A timeout is the normal case in a flow with a human and a bank in it.** The seat-booking version has two: **the payment may time out, and the hold may expire while it does** — and both need a defined path rather than an exception handler.

**And retry safety must reach the client.** A user refreshing a stuck checkout page is the most common retry in this system; **without a key it creates a second hold or a second charge**, and with one it returns the same booking and the same countdown.

**Where the reference does not help.** It covers the money and says nothing about the seats. **The atomic multi-seat claim, the hold expiry policy, and the decision about what happens when a payment succeeds against expired seats are all yours** — and the last one is the question that distinguishes a complete answer here.`,
  },

  tradeoffs: {
    intro:
      'The decisions this problem turns on, most of which concern where the transaction ends and what a hold guarantees.',
    rows: [
      {
        option: 'A database transaction spanning the payment',
        whenItWins:
          'Nowhere. It is the intuitive reading of "lock the seat".',
        whenItLoses:
          'A connection and row locks are held for minutes, other viewers block, and a rollback cannot un-charge a customer.',
        cost:
          'Connection exhaustion under load, plus an ambiguous failure.',
      },
      {
        option: 'A hold with a stored expiry',
        whenItWins:
          'Always. Committed in milliseconds, released by the clock, and visible to the user as a countdown.',
        whenItLoses:
          'Seats are unavailable to others for the hold duration even if the user abandons immediately.',
        cost:
          'A duration to choose, and a race with payment to resolve.',
      },
      {
        option: 'Expiry enforced by a sweeper only',
        whenItWins:
          'Nowhere as the sole mechanism.',
        whenItLoses:
          'A stopped job leaks seats indefinitely, and the leak is invisible until a show appears sold out.',
        cost:
          'Correctness depending on a background process.',
      },
      {
        option: 'Expiry evaluated on read, with a sweeper as an optimisation',
        whenItWins:
          'Always. A stopped job costs capacity rather than correctness.',
        whenItLoses:
          'Seats appear taken slightly longer than necessary until someone reads them.',
        cost:
          'A predicate on every availability check.',
      },
      {
        option: 'Per-seat claims in arbitrary order',
        whenItWins:
          'Nowhere under concurrency.',
        whenItLoses:
          'Two users claiming overlapping sets in opposite orders deadlock.',
        cost:
          'A killed transaction and a failed booking, intermittently.',
      },
      {
        option: 'Per-seat claims in sorted order, releasing on partial failure',
        whenItWins:
          'When state is in memory or spread across stores.',
        whenItLoses:
          'Several round trips, and a release path that must be exactly right.',
        cost:
          'More code than a single statement, and a sort that is mandatory.',
      },
      {
        option: 'One conditional statement over the seat set',
        whenItWins:
          'Where the store supports it. One round trip, no ordering concern, atomicity from the affected-row count.',
        whenItLoses:
          'It requires all the seats in one store.',
        cost:
          'Nothing where it applies.',
      },
      {
        option: 'Allowing a partial claim',
        whenItWins:
          'Fungible inventory, where four of six units is a smaller order.',
        whenItLoses:
          'Seats are not fungible: two users with two of four adjacent seats each is worse than either being refused.',
        cost:
          'A booking nobody wants, twice.',
      },
      {
        option: 'Extending the hold when payment starts',
        whenItWins:
          'The right default — the common case never races.',
        whenItLoses:
          'A failed payment holds seats for the extended window, and abandoning after starting payment is rewarded.',
        cost:
          'Longer unavailability, mitigated by releasing immediately on decline.',
      },
      {
        option: 'Re-acquire on payment success, refund if unavailable',
        whenItWins:
          'As the fallback that must exist even when extending, because extension makes the race rare rather than impossible.',
        whenItLoses:
          'Some customers are charged and refunded, which is poor even when handled correctly.',
        cost:
          'An idempotent, audited refund path on a money-moving failure.',
      },
      {
        option: 'No idempotency key',
        whenItWins:
          'Nowhere.',
        whenItLoses:
          'A retried hold creates a second hold or fails against its own first attempt; a retried payment charges twice.',
        cost:
          'Double charges, which is the worst individual failure here.',
      },
      {
        option: 'Client-generated keys at two layers',
        whenItWins:
          'Always. A retried hold returns the same hold and the same countdown.',
        whenItLoses:
          'The client must generate and reuse keys correctly.',
        cost:
          'A contract obligation on the caller.',
      },
      {
        option: 'Broadcasting every seat-state change to every viewer',
        whenItWins:
          'A quiet show with few viewers.',
        whenItLoses:
          'Fifty changes a second across two thousand viewers is a hundred thousand messages a second, delivering updates nobody can act on.',
        cost:
          'Fan-out that grows as the product of churn and audience.',
      },
      {
        option: 'Coalesced deltas, treated as advisory',
        whenItWins:
          'Always. A few updates per second per viewer, with the claim as the authority.',
        whenItLoses:
          'A user may click a seat taken moments ago.',
        cost:
          'A clean 409 naming the seat, which the client renders.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Start a transaction, select the seats FOR UPDATE, call the payment gateway, then commit."',
      whyWeak:
        'The transaction is open across card entry and a possible bank challenge — minutes — so a connection and the row locks are held for that whole time, and every other user selecting those seats blocks rather than seeing them as taken. And if the gateway times out, rolling back does not un-charge the customer while silently freeing seats that may have been paid for.',
      strongAnswer:
        '"Three short transactions with the slow call between them. First an atomic conditional claim over the seat set, committed in milliseconds, creating a hold with a stored expiry. Then the payment, with no transaction open. Then a confirmation conditional on the hold still being valid. The general rule is to find the slowest thing inside the transaction: if it is a call to another organisation, the boundary is in the wrong place, and no isolation level fixes that."',
    },
    {
      weakAnswer: '"Loop over the requested seats and mark each one held; if one fails, roll back the others."',
      whyWeak:
        'Without a deterministic order this deadlocks: two users claiming overlapping sets in opposite orders each hold what the other needs. And a naive rollback can release seats held by a different hold if the release is not keyed by hold id.',
      strongAnswer:
        '"Sort the seat ids before claiming, which removes the deadlock entirely because every claimer acquires in the same sequence — a one-line fix. Better still, where the store allows it, a single conditional update over the whole set with a check that the affected row count equals the number of seats requested: one round trip, no ordering concern, and the all-or-nothing property comes from the statement rather than from application logic. Releases are keyed by hold id so a rollback cannot free someone else\'s seat."',
    },
    {
      weakAnswer: '"A background job runs every minute and releases holds that have expired."',
      whyWeak:
        'It makes correctness depend on a background process. If the job stops, expired holds keep their seats indefinitely and a popular show appears sold out while nothing is actually booked — and the leak is invisible until a customer complains.',
      strongAnswer:
        '"The expiry is stored on the hold and evaluated on read: a hold with a passed deadline confers nothing, whether or not any sweeper ran. The sweeper then becomes an optimisation that returns seats to the map sooner, so a stopped job costs capacity rather than correctness. It is the same stored-deadline pattern as the parking reservation, the driver offer and the stock reservation — by this point it should be the reflex."',
    },
    {
      weakAnswer: '"The hold lasts ten minutes; if the user does not pay in that time the seats are released."',
      whyWeak:
        'It states the happy path and leaves out the race that defines the problem: a payment started at minute nine and completing at minute eleven succeeds against a hold that has already expired, and the seats may belong to someone else.',
      strongAnswer:
        '"I would extend the hold when payment starts, with a short payment window, so the common case never races. But extension makes the race rare rather than impossible, so the fallback must exist: on a payment that succeeds against an expired hold, attempt the atomic claim again — confirm if it succeeds, and refund if it does not, with an idempotent and audited refund path. A design that extends without the fallback has an unhandled case that will occur. And I would release the hold immediately on a declined payment rather than waiting for the expiry."',
    },
    {
      weakAnswer: '"The booking endpoint creates a booking and charges the card."',
      whyWeak:
        'No idempotency key, so a user refreshing a stuck checkout page either creates a second hold on different seats, fails against their own first attempt, or — if the first attempt charged and then failed — is charged twice.',
      strongAnswer:
        '"Both the hold and the pay endpoints take a client-generated idempotency key, created before the first attempt. Our records return the original result on a retry, and the same key is passed through to the gateway so a timeout on our side cannot produce two charges. The case worth calling out is a retried hold: with the key it returns the same hold and the same expiresAt, so the user\'s countdown does not restart — which is both correct and what they expect."',
    },
    {
      weakAnswer: '"The seat map is pushed to all viewers whenever a seat changes state."',
      whyWeak:
        'A popular show with fifty state changes a second and two thousand concurrent viewers is a hundred thousand messages a second, and most of them deliver information a human cannot act on at that rate.',
      strongAnswer:
        '"Deltas rather than the full map, coalesced per viewer to a few updates a second — batching everything that changed in the interval, which cuts the volume by an order of magnitude and loses nothing, since nobody can act on fifty updates a second. And the map is advisory: the claim is the authority, so a user clicking a seat taken two hundred milliseconds ago gets a clean 409 naming that seat and the client greys it out. Same relationship as a cached availability badge and the actual reservation."',
    },
  ],

  flashcards: [
    {
      id: 'fc-bms-1',
      front: 'Why is "lock the seat" the wrong framing?',
      back: 'A database lock held across a payment holds a connection and blocks other viewers for minutes, and a rollback cannot un-charge a customer.',
      topic: 'holds',
    },
    {
      id: 'fc-bms-2',
      front: 'What replaces the lock?',
      back: 'A hold: a claim with a stored deadline, committed in milliseconds, with the payment outside any transaction.',
      topic: 'holds',
    },
    {
      id: 'fc-bms-3',
      front: 'What is the general rule about transaction boundaries here?',
      back: 'Find the slowest thing inside the transaction. If it is a call to another organisation, the boundary is wrong — and no isolation level fixes it.',
      topic: 'holds',
    },
    {
      id: 'fc-bms-4',
      front: 'Why must a multi-seat claim be all-or-nothing?',
      back: 'Seats are not fungible: two users each holding two of four adjacent seats is worse than either being refused, because neither can use them.',
      topic: 'atomic-claims',
    },
    {
      id: 'fc-bms-5',
      front: 'How does one conditional statement give atomicity over a set?',
      back: 'Update all requested seats where free, then check the affected-row count equals the number requested; roll back if not.',
      topic: 'atomic-claims',
    },
    {
      id: 'fc-bms-6',
      front: 'Why sort seat ids before per-seat claims?',
      back: 'Two users claiming overlapping sets in opposite orders each hold what the other needs — a genuine deadlock that a consistent order removes.',
      topic: 'atomic-claims',
    },
    {
      id: 'fc-bms-7',
      front: 'Why must a release be keyed by hold id?',
      back: 'So a rollback frees only the seats this hold claimed, and cannot release someone else\'s.',
      topic: 'atomic-claims',
    },
    {
      id: 'fc-bms-8',
      front: 'Why evaluate hold expiry on read?',
      back: 'So a stopped sweeper costs capacity rather than leaking seats — correctness must not depend on a background job running.',
      topic: 'holds',
    },
    {
      id: 'fc-bms-9',
      front: 'What is the expiry-during-payment race?',
      back: 'A payment started near the end of the hold succeeds after it expires, so the seats may already belong to someone else.',
      topic: 'state-machine',
    },
    {
      id: 'fc-bms-10',
      front: 'What is the recommended policy for that race, and why two parts?',
      back: 'Extend the hold at payment start so the common case never races, plus re-acquire-or-refund — because extension makes it rare rather than impossible.',
      topic: 'state-machine',
    },
    {
      id: 'fc-bms-11',
      front: 'Why is paying a separate state from held?',
      back: 'Because the expiry policy differs: a hold that has entered payment may be extended, while one where the user is still choosing is not.',
      topic: 'state-machine',
    },
    {
      id: 'fc-bms-12',
      front: 'What should happen on a declined payment?',
      back: 'Release the hold immediately rather than waiting for the expiry — the user is not coming back for those seats in the next five minutes.',
      topic: 'state-machine',
    },
    {
      id: 'fc-bms-13',
      front: 'What does a retried hold request return with the same key?',
      back: 'The same hold and the same expiresAt, so the countdown does not restart.',
      topic: 'idempotency',
    },
    {
      id: 'fc-bms-14',
      front: 'What is the relationship between the live seat map and the claim?',
      back: 'The map is advisory and the claim is the truth — so a stale click gets a clean 409 naming the seat.',
      topic: 'idempotency',
    },
  ],

  quiz: [
    {
      id: 'q-bms-1',
      kind: 'scenario',
      prompt:
        'A design holds a database transaction open from seat selection through payment. What is the first failure under load?',
      options: [
        { id: 'a', label: 'Connection exhaustion, plus other viewers blocking on the locked seat rows rather than seeing them as taken' },
        { id: 'b', label: 'Double-booked seats, since the lock is not strong enough' },
        { id: 'c', label: 'Deadlock between users selecting the same seats' },
        { id: 'd', label: 'Nothing — this is what transactions are for' },
      ],
      correct: ['a'],
      explanation:
        'A few hundred concurrent checkouts each holding a connection for two minutes exhausts the pool, and the blocking is worse than the resource cost. Deadlock is a separate real problem with unordered multi-row locking, and double-booking is what the approach does prevent — at a cost that makes it unusable.',
      difficulty: 'core',
      topic: 'holds',
    },
    {
      id: 'q-bms-2',
      kind: 'scenario',
      prompt:
        'User A requests H12, H13, H14 and user B concurrently requests H14, H15. What must happen?',
      options: [
        { id: 'a', label: 'Exactly one succeeds fully; the other gets a refusal naming H14, and none of its other seats are left held' },
        { id: 'b', label: 'A gets H12 and H13, B gets H14 and H15' },
        { id: 'c', label: 'Both succeed, since only H14 overlaps' },
        { id: 'd', label: 'Both fail, to be safe' },
      ],
      correct: ['a'],
      explanation:
        'Seats are not fungible, so a partial claim is worse than a refusal — the test that matters asserts the loser\'s other seats are still available, not merely that the call failed. Option b is the partial-claim failure: A never wanted two seats, and the rollback is what prevents it.',
      difficulty: 'core',
      topic: 'atomic-claims',
    },
    {
      id: 'q-bms-3',
      kind: 'scenario',
      prompt:
        'Two users claim overlapping seat sets with per-seat conditional claims in the order the client sent them. What can happen?',
      options: [
        { id: 'a', label: 'A deadlock — each holds a seat the other needs — which sorting the ids removes entirely' },
        { id: 'b', label: 'Nothing; conditional claims never block' },
        { id: 'c', label: 'Both users get partial sets permanently' },
        { id: 'd', label: 'The database resolves it by rolling back both' },
      ],
      correct: ['a'],
      explanation:
        'With row locks taken in different orders, each transaction waits on the other. Sorting means every claimer acquires in the same sequence, so one simply fails its conditional check and releases — a one-line fix that a candidate should name unprompted.',
      difficulty: 'advanced',
      topic: 'atomic-claims',
    },
    {
      id: 'q-bms-4',
      kind: 'scenario',
      prompt:
        'A hold expires at t=600. A payment started at t=540 succeeds at t=610. What should the system do?',
      options: [
        { id: 'a', label: 'Attempt the atomic claim again — confirm if it succeeds, refund if the seats are gone — with an audited refund path' },
        { id: 'b', label: 'Confirm the booking, since the payment succeeded' },
        { id: 'c', label: 'Reject the payment result and let the user try again' },
        { id: 'd', label: 'Extend the hold retroactively to cover the payment' },
      ],
      correct: ['a'],
      explanation:
        'The invariant requires that a confirmed booking\'s seats were held by it at confirmation. Option b can double-book a physical seat; option c leaves the customer charged with no booking; option d pretends the seats were not available to others, which they were. Extending at payment start makes this rare — the fallback still has to exist.',
      difficulty: 'advanced',
      topic: 'state-machine',
    },
    {
      id: 'q-bms-5',
      kind: 'scenario',
      prompt:
        'A user refreshes a stuck checkout page, resending the hold request with the same idempotency key. What should come back?',
      options: [
        { id: 'a', label: 'The same hold id and the same expiresAt, so the countdown does not restart' },
        { id: 'b', label: 'A new hold on the same seats with a fresh ten minutes' },
        { id: 'c', label: 'A 409, since the seats are already held' },
        { id: 'd', label: 'A new hold on different seats' },
      ],
      correct: ['a'],
      explanation:
        'A retry is the same operation, so it returns the original result. Option b lets a user extend their hold indefinitely by refreshing; option c refuses the user their own hold, which is the failure a key exists to prevent.',
      difficulty: 'core',
      topic: 'idempotency',
    },
    {
      id: 'q-bms-6',
      kind: 'multi',
      prompt:
        'A popular show has 2,000 concurrent viewers and ~50 seat-state changes per second. Which approaches help? Select all that apply.',
      options: [
        { id: 'a', label: 'Send deltas rather than the full seat map' },
        { id: 'b', label: 'Coalesce updates per viewer to a few per second' },
        { id: 'c', label: 'Treat the map as advisory and let the claim refuse stale clicks' },
        { id: 'd', label: 'Increase the polling interval so clients ask less often' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Deltas cut message size, coalescing cuts message count by an order of magnitude without losing anything a human could act on, and treating the map as a hint is what makes both safe. Polling is the wrong mechanism entirely here — it delivers stale data more expensively than a stream delivers fresh data.',
      difficulty: 'core',
      topic: 'holds',
    },
  ],

  exercises: [
    {
      id: 'ex-bms-1',
      kind: 'implement',
      title: 'Add fairness, then cancellation, then find the impossible one',
      estimatedMinutes: 50,
      prompt: `Extend the design with three capabilities. For each, write the signatures and say what changes in the invariant.

**Part 1 — a high-demand release.** Tickets go on sale at a fixed time and 50,000 people arrive in the first minute for 2,000 seats. Design the admission, and say what you do about fairness.

**Part 2 — cancellation and refunds.** A user cancels a confirmed booking. Seats return to the pool, the refund follows a policy that depends on how close the show is, and the whole thing must be auditable.

**Part 3 — seat recommendations.** When a user asks for four seats together, the system suggests the best available block rather than making them hunt.

**Part 4.** One of these three cannot be made fair in the sense users expect. Identify it, say why, and give the options.

Then answer:

- In Part 1, should the queue position be held if the user closes their browser?
- In Part 2, what is the correct order of the refund and the seat release?`,
      rubric: [
        'Admission gate rejects most traffic before it reaches the seat store.',
        'States that the hot path is rejection, not purchase.',
        'Queue or lottery discussed with its fairness properties.',
        'Cancellation modelled as entries, not mutations, with an audit trail.',
        'Refund policy takes the booking and the show time, not a flat rule.',
        'Recommendation treats the map as advisory and the claim as authoritative.',
        'Identifies the high-demand release as the one that cannot be fair.',
        'Gives at least two options with their costs.',
        'Answers the ordering question with the money-versus-inventory reasoning.',
      ],
      modelAnswer: `**Part 1 — the high-demand release**

\`\`\`
50,000 arrivals in 60 seconds for 2,000 seats
→ at most 2,000 can succeed; 96% MUST be refused
→ the hot path is refusal, exactly as in the flash sale
\`\`\`

**Three layers, and the first does most of the work.**

\`\`\`ts
// 1. Admission gate — before anything touches the seat store
interface AdmissionGate {
  admit(showId: ShowId, userId: UserId, now: number): AdmissionResult;
}
// backed by: a token bucket sized to the seat store's capacity,
// plus a sold-out flag once all seats are held or booked

// 2. Queue — for those admitted beyond immediate capacity
interface WaitingRoom {
  join(showId: ShowId, userId: UserId, now: number): QueueTicket;
  poll(ticket: QueueTicket, now: number): 'waiting' | 'admitted' | 'expired';
}

// 3. The existing hold flow, unchanged, for admitted users
\`\`\`

**The gate is sized to what the seat store can absorb**, not to demand — say 500 concurrent hold attempts — **and everything beyond it is queued rather than refused**, because a queue is a better experience than a refusal when the user can see their position.

**And once the show is sold out, the gate short-circuits**: a cached flag rejects without touching the store, **and being briefly wrong in the permissive direction is safe** because the conditional claim still arbitrates. **The flash-sale argument, unchanged.**

**On fairness, three models.**

\`\`\`
First-come         rewards fast connections and pre-warmed
                   browser tabs. Feels fair, is not.
Queue by arrival   rewards being early to the queue, which
                   is the same thing with a visible position.
Lottery            everyone who registers in a window has
                   an equal chance, regardless of connection.
\`\`\`

**A lottery is the only one that is fair in the sense users mean**, and it is a product decision rather than a technical one: **register in a window, draw at random, issue timed purchase windows to winners.** It removes the stampede entirely — **there is no first minute to win.**

*What I would build:* **gate plus queue by default, with lottery as a supported mode** for genuinely oversubscribed releases. **And I would say which one is running**, because a user who thinks it is first-come and it is a lottery feels cheated.

---

**Part 2 — cancellation and refunds**

\`\`\`ts
type BookingEntry =
  | { kind: 'confirmed'; bookingId; seatIds; amountMinor; at }
  | { kind: 'cancelled'; bookingId; by: UserId; reason?: string; at }
  | { kind: 'refund_issued'; bookingId; amountMinor;
      paymentRef; policyApplied: string; at }
  | { kind: 'seats_released'; bookingId; seatIds; at };

interface RefundPolicy {
  refundFor(booking: ConfirmedBooking, showStartsAt: number,
            now: number): { amountMinor: Minor; policy: string };
}
\`\`\`

**Four decisions.**

**Cancellation is an appended entry, not a mutation.** The booking stays; **a later entry says it no longer holds seats** — the reversal pattern from the Splitwise lesson, and here it is what makes a refund dispute answerable.

**The refund policy takes the booking and the show time.** A percentage that depends on hours remaining is a function of the interval, **not a flat rule** — the same argument as the parking lot's daily cap, and the same interface shape.

**The policy applied is recorded on the entry.** "Refunded £12 of £20 under the 24-hour policy" **is what a customer asks about**, and recomputing it later with a changed policy would give a different answer.

**And the released seats become available through the same conditional-claim path**, so a cancelled seat is simply free again — **no special state, and the seat map delta flows as usual.**

*The invariant gains a clause:* **a cancelled booking holds no seats, and its seats are available or held by someone else.** Which means release must be idempotent, since a retried cancellation must not double-release.

---

**Part 3 — seat recommendations**

\`\`\`ts
interface SeatRecommender {
  suggest(showId: ShowId, count: number, prefs: Prefs,
          now: number): SeatBlock[];
}

interface SeatBlock {
  seatIds: readonly SeatId[];
  score: number;          // contiguity, centrality, row preference
}
\`\`\`

**Two decisions.**

**It reads the same advisory map everyone else sees**, so a suggestion can be stale by the time the user clicks. **That is acceptable and it must be handled**: the claim refuses, the client re-suggests, **and the user sees "those just went — how about these?" rather than an error.**

**And it suggests several blocks rather than one.** With a single suggestion, **a failed claim sends the user back to the start**; with three, the client can try the next immediately — **which turns a race loss into a half-second delay.**

*The invariant is unchanged*, because recommendation writes nothing. **Another read model**, like debt simplification and the pairwise view: **shaped for a purpose, authoritative about nothing.**

---

**Part 4 — the one that cannot be fair**

**The high-demand release, and the reason is that fairness and first-come are incompatible.**

\`\`\`
"Fair" to a user means:  equal chance for equal effort
First-come rewards:      network latency, geography, device
                         speed, pre-opened tabs, scripts
→ a user 20 ms closer to the data centre wins systematically
→ and a script wins against every human
\`\`\`

**No amount of engineering makes a first-come race fair**, because the thing it measures is not effort — **it is infrastructure.** A queue makes the ordering visible and does not change what it is ordering by.

**Three options.**

**(a) First-come with a queue.** What most systems do.

\`\`\`
+ simple, understood, no registration step
− systematically favours fast connections and bots
− and the fairness complaint is legitimate
\`\`\`

**(b) A lottery over a registration window.**

\`\`\`
+ genuinely equal chance regardless of connection
+ no stampede at all — the release moment stops mattering
− users must register in advance and wait for a draw
− and it needs identity verification, or one person
  enters a thousand times
\`\`\`

**(c) A hybrid: a lottery for a proportion of seats, first-come for the rest.**

\`\`\`
+ serves both preferences, and hedges the product risk
− two mechanisms to build, explain and operate
\`\`\`

**I would build (a) and support (b) as a mode**, and the reason is honest rather than technical: **(b) is better and it changes the product**, so it is the promoter's decision rather than the engineer's. **What I would insist on is that whichever is running is stated clearly to users** — because the complaint is not usually about losing, it is about believing the rules were different.

*And the bot problem is worth naming under any option:* **a script beats a human at first-come and can enter a lottery many times.** So fairness in practice **depends on identity verification more than on the queueing mechanism**, which is an uncomfortable conclusion and the correct one.

---

**Should a queue position be held if the user closes their browser?**

**For a short window, yes — and then no.**

\`\`\`
Hold it indefinitely:  a user who left occupies a place ahead
                       of people still waiting
Drop it immediately:   a dropped connection, a phone switching
                       networks, or a tab refresh loses a place
                       earned by waiting 20 minutes
\`\`\`

**A grace period resolves it**, and it is the stored-deadline pattern once more:

\`\`\`ts
interface QueueTicket {
  id: TicketId; position: number;
  heldUntil: number;        // extended on each poll
}
// poll extends heldUntil by, say, 60 s
// a ticket not polled within that window is dropped
\`\`\`

**Three properties.**

**The position survives a refresh or a brief network loss**, which is the common case and the one users are angriest about.

**It does not survive walking away**, because the grace period is short and requires an active client.

**And the mechanism is a heartbeat**, which is the same thing as the concurrent-stream limit in the streaming lesson and the courier session in delivery — **a client that stops reporting loses its claim, without anyone deciding.**

*One refinement:* **when a ticket is admitted, the purchase window should be generous** — five minutes rather than one — **because a user admitted while briefly disconnected should still get their turn.** The queue's job is ordering, and the purchase window is where the hold policy takes over.

---

**The correct order of the refund and the seat release**

**Release the seats first, then issue the refund — and the reasoning is about which failure is recoverable.**

\`\`\`
Refund first, then release:
  refund succeeds → release fails (crash, bug)
  → the customer has their money AND the seats are still held
  → the seats are unsellable until someone notices
  → revenue lost, and the show may sell out with empty seats

Release first, then refund:
  release succeeds → refund fails
  → the seats are resellable immediately
  → the customer is owed money, and that is a retryable,
    auditable, alertable condition
\`\`\`

**The asymmetry is that a pending refund is a known debt and an unreleased seat is an invisible loss.**

**A pending refund has a record, a retry path, and a customer who will chase it** — three independent forces that get it resolved. **An unreleased seat has none of those**: nobody is looking for it, and it silently reduces inventory.

**Three things that make this safe.**

**The refund must be retried until it succeeds**, with the idempotency key on the original payment so retries cannot double-refund.

**The pending-refund state must be visible** — a queue with an age metric, exactly like the payments lesson's breaks — **because an old pending refund is money owed that has been owed for a while.**

**And the release and the cancellation entry are one transaction.** Local, fast, no external call: **the seats and the record of why they were freed change together**, and the refund — the external part — follows.

*Which is the general form:* **do the local, reversible, verifiable thing first; do the external, ambiguous, money-moving thing second** — because a failure in the second leaves a visible debt, and a failure in the first would leave an invisible one.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-bms-1',
      level: 'basic',
      question: 'Design a seat-booking system.',
      guidance:
        'Look for a hold with a stored expiry rather than a lock, and for the payment being outside any transaction. "SELECT FOR UPDATE then charge" is the standard wrong answer.',
    },
    {
      id: 'iq-bms-2',
      level: 'basic',
      question: 'A user wants four seats together. How is that claimed?',
      guidance:
        'Atomically — one conditional statement checking the affected-row count, or sorted per-seat claims with rollback. Partial claims are worse than refusals because seats are not fungible.',
    },
    {
      id: 'iq-bms-3',
      level: 'intermediate',
      question: 'Two users select overlapping seats at the same moment. Walk me through it.',
      guidance:
        'One succeeds fully, the other is refused with the conflicting seat named and none of its other seats left held. Look for the deadlock discussion if per-seat claims are used.',
    },
    {
      id: 'iq-bms-4',
      level: 'intermediate',
      question: 'How and when are holds released?',
      guidance:
        'A stored deadline evaluated on read, with a sweeper as an optimisation. Correctness must not depend on the background job running.',
    },
    {
      id: 'iq-bms-5',
      level: 'advanced',
      question: 'The hold expires while the payment is in flight. What happens?',
      guidance:
        'Extend at payment start so the common case never races, plus re-acquire-or-refund as the fallback. Excellent answers note that extension makes it rare rather than impossible.',
    },
    {
      id: 'iq-bms-6',
      level: 'advanced',
      question: 'A user refreshes the checkout page mid-payment. What must not happen?',
      guidance:
        'A second hold, a second charge, or a restarted countdown. Client-generated keys at two layers, returning the original result.',
    },
    {
      id: 'iq-bms-7',
      level: 'followup',
      question: 'Two thousand people are watching the same seat map. How is it kept current?',
      guidance:
        'Coalesced deltas, a few updates per second per viewer, and the map treated as advisory with the claim as the authority.',
    },
    {
      id: 'iq-bms-8',
      level: 'followup',
      question: 'Fifty thousand people arrive at once for two thousand seats.',
      guidance:
        'An admission gate sized to the store, a queue beyond it, and a sold-out short circuit. Strong answers note that first-come cannot be fair and name the lottery alternative.',
    },
  ],

  activeLearning: [
    {
      id: 'al-bms-1',
      kind: 'debug',
      prompt:
        'A cinema reports that a handful of shows each week end up with two bookings for the same seat. The conditional claim is correct in isolation, holds expire properly, and the logs show both bookings passing their claim successfully. Diagnose it.',
      discussion: `**Both bookings passing their claim successfully** is the detail that makes this tractable: **the conditional update returned success twice for the same seat**, which is either impossible or means the two claims went to different places.

That is a short list.

**Hypothesis 1 — the two claims ran against different stores or replicas.**

If seat state is read from a replica and written to a primary, **or if a caching layer sits in front of the claim**, two claims can each see the seat as free.

\`\`\`
claim A → primary: seat free → claimed ✓
claim B → replica (lagging): seat free → claimed ✓
→ both writes land, and the second overwrites the first
\`\`\`

*Why it fits:* both claims log success, **and it is intermittent** because it depends on replication lag at that instant. *Check:* whether the conditional update is guaranteed to execute on the primary. **A conditional write against a replica is not a conditional write** — it is a read of stale state followed by a write elsewhere.

**Hypothesis 2 — the predicate does not actually exclude the other claimant.**

\`\`\`sql
UPDATE seats SET hold_id = :new
 WHERE seat_id IN (...) AND (hold_id IS NULL OR held_until <= :now)
\`\`\`

**If \`:now\` is supplied by the application and the two servers' clocks differ**, a server running slightly ahead sees a hold as expired when it is not:

\`\`\`
hold expires at 12:00:00
server A clock: 11:59:58 → not expired, refuses
server B clock: 12:00:01 → expired, claims
→ the original holder is still paying
\`\`\`

*Why it fits perfectly:* **both claims are legitimate given their own inputs**, which is exactly "both passed successfully". And clock skew is intermittent and small. *Check:* whether \`now\` comes from the application or from the database. **Sourcing it inside the statement removes the skew entirely** — the same conclusion as the distributed rate limiter.

**Hypothesis 3 — confirmation does not re-check the hold.**

If \`confirm\` writes \`booking_id\` without a predicate on the hold still being valid, **two users can both hold in sequence** — the first expires, the second claims — **and then the first's payment completes and confirms anyway.**

\`\`\`
A holds → expires → B holds → B confirms
A's payment (slow) returns → A confirms
→ both bookings, and both claims were valid when made
\`\`\`

*Why it fits everything:* **the claims really did both succeed, at different times**, and the logs would show exactly that. **This is my leading hypothesis**, because it matches "both passing their claim successfully" most literally — the failure is at confirmation, not at claim.

*Check:* whether the confirm statement is conditional on \`hold_id\` still matching. **The invariant says a confirmed booking's seats were held by it at confirmation**, and an unconditional confirm violates it silently.

**Hypothesis 4 — the release path frees seats it does not own.**

If a release is keyed by seat rather than by hold — a rollback after a partial claim, or a cancellation — **it can free a seat another hold legitimately owns**, after which a second claim succeeds correctly.

*Why it fits:* both claims are valid, **and the bug is in between them.** *Check:* every release for a \`hold_id\` predicate. **A release without one is the multi-seat rollback bug from the lesson**, and it produces exactly this.

**Hypothesis 5 — a retry without idempotency creating a second booking.**

A timed-out confirm retried without a key **could create a second booking for the same seats under the same hold** — which is a double booking by the same user rather than two users, and worth distinguishing.

*Check:* whether the two bookings belong to the same user. **If they do, this is it and the fix is the key**; if not, hypotheses 1–4 apply.

**What I would check first: whether the two bookings belong to the same user, and whether \`confirm\` is conditional on the hold.** Two queries, and they separate the retry case from the genuine two-user case — **and within the two-user case, an unconditional confirm is both the most likely cause and the easiest to verify.**

**Then: where \`now\` comes from, and whether claims can hit a replica.** Both are code reads, and both produce the "two valid claims" signature.

**Why "the conditional claim is correct in isolation" is the most useful fact.**

It moves the investigation off the mechanism everyone would examine first **and onto the inputs and the surrounding steps.** A conditional update is correct or it is not, and testing it in isolation proves it is — **so the failure is in what it is given (the clock, the store it hits) or in what happens after it (confirm, release).**

**Which is a general shape:** a correct primitive failing in production is failing at its boundaries. **For a conditional write, those boundaries are exactly four: the store it executes against, the time it compares against, the identity it checks, and whatever runs after it.**

**The instrumentation this demands.**

**A uniqueness constraint as a last line of defence.** A partial unique index on \`(show_id, seat_id) WHERE booking_id IS NOT NULL\` **makes a double booking impossible rather than detectable** — and it would have turned this incident into a failed write with a stack trace on the day it first happened.

**This is the highest-value change**, and it is the let-the-database-arbitrate argument applied one level up from the claim.

**A continuous invariant check:** for every show, no seat appears in two active bookings. **Run it after every confirm in development and as a periodic job in production**, alerting at zero tolerance.

**Clock skew monitoring across the servers**, or better, **removing the dependency by sourcing time inside the statement.** Skew that produces business errors is invisible in every other metric.

**And a counter of confirms that found the hold invalid.** It should be small and non-zero — **the expiry-during-payment race made rare by extension, not eliminated** — and a sudden rise means the extension logic broke.

**Transferable:** when a correctness mechanism is provably right and the incorrect outcome still occurs, **look at what surrounds it rather than inside it** — and add a constraint at the point where the invariant is finally violated, because a check at the last step catches every cause at once.`,
    },
    {
      id: 'al-bms-2',
      kind: 'what-changes-if',
      prompt:
        'Change the product: instead of assigned seats, this is general admission with a capacity of 2,000 — no seat map, just a count. What simplifies, what stays, and what new problem appears?',
      discussion: `**A great deal simplifies, and the parts that remain are the ones worth noticing — because they are the parts that were never about seats.**

**What disappears entirely.**

**The atomic multi-seat claim.** Four tickets is now \`count >= 4\`, a single conditional decrement: **no set, no ordering, no deadlock, no partial-claim rollback.** The most intricate mechanism in the design is replaced by the e-commerce lesson's inventory decrement verbatim.

**The seat map and its live stream.** No map means no deltas, no coalescing, no per-viewer fan-out — **a hundred thousand messages a second becomes a single "N remaining" that can be cached and updated every few seconds.**

**And seat recommendation**, which had no purpose without geometry.

*That is three of the design's four hard parts gone*, and the reason is one property: **general-admission tickets are fungible.** Seats were hard because they are not.

**What stays, essentially unchanged.**

**The hold with a stored expiry.** Still needed: a user still takes minutes to pay, **and holding capacity during that time is still the only alternative to a lock across a payment.**

**The expiry-during-payment race**, identical in shape. A payment succeeding after a hold expires **may find capacity gone**, and the same policy applies — extend at payment start, re-acquire or refund as the fallback.

**Idempotency at two layers**, unchanged and for the same reasons.

**And the admission gate for a high-demand release**, unchanged — **though now more effective**, because a single counter is far cheaper to contend on than a seat table.

*Which is the useful observation:* **the parts that survive are the ones about time and money rather than about the resource.** Holds exist because humans are slow; idempotency exists because networks are unreliable. **Neither has anything to do with seats.**

**What becomes easier in a way worth quantifying.**

\`\`\`
Assigned seats: contention is per seat — 2,000 rows, each
                a potential conflict, and popular seats are
                hot while others are idle
General admit:  contention is on ONE counter
                → 50,000 arrivals all contend on one row
\`\`\`

**Which is simpler and more contended**, and it brings back the flash-sale toolkit: **an admission gate that rejects most attempts without touching the counter, and sharded counters if the gate is not enough.** Trading a distributed contention problem for a concentrated one.

**And the new problem, which is the interesting part: overselling becomes tempting and is now possible.**

\`\`\`
Assigned seats:  a seat is physical. Selling it twice means
                 two people in one seat — never acceptable.
General admit:   capacity is a policy number, not a physical
                 constraint. 2,000 is what the venue licence
                 says; 2,050 tickets sold against historical
                 no-show rates is a business decision.
\`\`\`

**This is genuinely new**, because with assigned seats the zero-oversell rule was absolute and here it is a parameter. **Airlines do exactly this**, and it changes the design in three ways:

**The counter's limit is not the capacity.** It is capacity times an oversell factor, **which must be a stored, auditable configuration** rather than a constant — because it is a commercial decision that will change.

**And a compensation path appears.** If more people arrive than fit, **someone must be turned away and compensated** — which is a workflow, a policy and a payment, none of which existed before.

**And the compensation cost must inform the oversell factor.** Selling 3% extra is profitable if the no-show rate is 5% and costly if it is 1%, **so the factor is derived from observed data rather than chosen** — a feedback loop, and one that should be damped for the reasons the surge-pricing discussion gave.

*The uncomfortable framing worth stating:* **overselling is only available because the resource became fungible.** The moment seats are assigned, it is not a policy choice — **it is two people standing in front of the same seat.**

**What I would build.**

\`\`\`
Replace:  seat set claim      → conditional decrement
          seat map stream     → a cached remaining count
          seat recommender    → nothing
Keep:     holds with stored expiry, the expiry race policy,
          two-layer idempotency, admission gate
Add:      an oversell factor as audited configuration,
          a no-show rate measurement, a damped adjustment,
          and a compensation workflow
\`\`\`

**The transferable point:** fungibility is the property that decides how hard an allocation problem is. **Non-fungible resources force atomic set claims, per-item state and a live map; fungible ones collapse to a counter** — and in exchange they make overselling a policy question, which is a business problem rather than an engineering one. **Ask which you have before designing the claim.**`,
    },
  ],

  revision: {
    bullets: [
      '"Lock the seat" is the wrong framing: a lock held across a payment blocks viewers and cannot be rolled back safely.',
      'Use a hold — a claim with a stored deadline — committed in milliseconds, with the payment outside any transaction.',
      'Find the slowest thing inside the transaction: a call to another organisation means the boundary is wrong.',
      'Seats are not fungible, so the claim is a set and must be all-or-nothing.',
      'Two users each holding two of four adjacent seats is worse than either being refused.',
      'One conditional statement over the set plus an affected-row check gives atomicity.',
      'Per-seat claims must be made in sorted order, or overlapping sets deadlock.',
      'Releases are keyed by hold id, so a rollback cannot free someone else\'s seat.',
      'Expiry is evaluated on read, so a stopped sweeper costs capacity rather than leaking seats.',
      'The countdown is returned to the user, which makes the expiry a contract rather than a surprise.',
      'The hold can expire during the payment it exists for, and neither answer is free.',
      'Extend at payment start so the common case never races — and keep the re-acquire-or-refund fallback.',
      'Release the hold immediately on a declined payment rather than waiting for the expiry.',
      'Idempotency at two layers; a retried hold returns the same hold and the same expiresAt.',
      'The seat map is advisory and the claim is the truth, so a stale click gets a 409 naming the seat.',
      'Coalesce seat deltas per viewer — nobody can act on fifty updates a second.',
      'A high-demand release is a rejection problem: gate first, queue beyond it, short-circuit when sold out.',
      'First-come cannot be fair, because it measures infrastructure rather than effort.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Seat booking as a hold-then-pay-then-confirm flow: an atomic conditional claim over a set of seats, a stored expiry, the payment outside any transaction, and a confirmation conditional on the hold still being valid.',
    whyItExists:
      'Because a physical seat cannot be sold twice, a user takes minutes to pay, and a partial claim on a set of adjacent seats is worse than a refusal — so the claim must be atomic, the hold must expire on its own, and the payment must not sit inside a transaction.',
    whenToUse: [
      'A hold with a stored deadline whenever a claim spans a slow human or external step.',
      'An atomic set claim whenever the resources are not fungible.',
      'A deterministic acquisition order whenever several resources are claimed individually.',
      'Two-layer idempotency whenever a retry can charge money.',
      'An admission gate whenever most requests must be refused.',
    ],
    whenNotToUse: [
      'A transaction spanning a payment call.',
      'A lock as the hold mechanism.',
      'Expiry enforced only by a sweeper.',
      'Partial claims on a set of seats.',
      'Unordered multi-row locking.',
      'A release keyed by seat rather than by hold.',
      'Broadcasting every seat change to every viewer.',
      'First-come framing presented as fair.',
    ],
    alternatives: [
      'A lottery over a registration window, when fairness matters more than immediacy.',
      'Sharded or gated counters, when contention concentrates on one row.',
      'A conditional decrement instead of a set claim, when the resource is fungible.',
      'Several suggested blocks instead of one, so a lost race costs half a second.',
      'A uniqueness constraint on booked seats, as a last line of defence.',
    ],
    tradeoffs: [
      'A hold buys a short transaction and costs seats being unavailable during it.',
      'Read-time expiry buys correctness without a job and costs a predicate on every check.',
      'One conditional statement buys atomicity in a round trip and requires one store.',
      'Sorted per-seat claims buy deadlock freedom and cost several round trips.',
      'Extending at payment start buys a rare race and costs longer holds on failure.',
      'Re-acquire-or-refund buys honesty and costs charged-then-refunded customers.',
      'Coalesced deltas buy an order of magnitude in fan-out and cost a little staleness.',
    ],
    failureModes: [
      'A connection pool exhausted by transactions held across payments.',
      'A deadlock from unordered multi-seat locking.',
      'A partial claim leaving two users with unusable pairs.',
      'A rollback releasing seats held by a different hold.',
      'A stopped sweeper leaking seats until a show appears sold out.',
      'A payment succeeding against an expired hold with no defined path.',
      'A retried request creating a second hold or a second charge.',
      'A restarted countdown on a retried hold.',
      'Confirmation without re-checking the hold, double-booking a seat.',
      'Clock skew between servers making one see a live hold as expired.',
      'A claim executed against a replica rather than the primary.',
    ],
    followUpQuestions: [
      'What is the slowest thing inside the transaction?',
      'Is the claim atomic over the whole seat set?',
      'In what order are individual seats claimed?',
      'Is the release keyed by hold id?',
      'Is expiry evaluated on read, or only by a sweeper?',
      'What happens if the hold expires during payment?',
      'Is the confirm conditional on the hold still being valid?',
      'Where does `now` come from in the claim predicate?',
      'Does a retried hold return the same countdown?',
      'Is the seat map authoritative or advisory?',
      'Is there a constraint preventing a seat appearing in two bookings?',
    ],
  },
});
