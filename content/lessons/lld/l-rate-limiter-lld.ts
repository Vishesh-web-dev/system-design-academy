import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-rate-limiter-lld',
  title: 'Design a rate limiter (LLD)',
  summary:
    'Four algorithms with different memory and burst behaviour, one interface that must fit all of them, and a clock that must be a parameter — because every interesting test here is a test about time.',
  phase: 'lld',
  module: 'machine-coding',
  position: 62,
  kind: 'machine-coding',
  difficulty: 'core',
  estimatedMinutes: 60,
  tags: ['algorithms', 'clock-injection', 'testability', 'thread-safety'],
  prerequisites: ['l-lru-cache'],
  resources: [
    {
      key: 'stripe-rate-limits',
      tier: 'must',
      note: 'Read it for what a caller actually needs from a refusal — the remaining allowance and when to retry. Those two fields are what force the interface to return a decision object rather than a boolean.',
    },
    {
      key: 'redis-data-types',
      tier: 'must',
      note: 'Read the atomic increment and expiry sections. The check-then-increment sequence is the correctness problem in every distributed rate limiter, and atomicity is the answer — the same shape as the conditional write in the HLD designs.',
    },
    {
      key: 'redis-expire',
      tier: 'good',
      note: 'Read it for per-key expiry as the mechanism that bounds state. A rate limiter accumulates one entry per client, so without expiry its memory grows with the number of clients ever seen.',
    },
    {
      key: 'aws-timeouts-retries-jitter',
      tier: 'good',
      note: 'Read it for what happens after you return a retry-after. Every refused client retrying at the same moment is a self-inflicted thundering herd, which is why jitter belongs in the answer.',
    },
    {
      key: 'kent-beck-tdd',
      tier: 'advanced',
      note: 'Read it for fast deterministic feedback as a design constraint. This problem is the clearest case in the course: injecting the clock is what makes the boundary behaviour testable at all.',
    },
  ],

  intuition: {
    body: `Every interesting property of a rate limiter is a property of **time**, and that single observation determines the design twice over.

**It determines the interface.** A method that reads a global clock cannot be tested at a window boundary, **and the window boundary is where all four algorithms differ.** So the current time is a parameter:

\`\`\`ts
tryAcquire(key: string, now: number, cost = 1): Decision
\`\`\`

**One parameter, and every test becomes an assertion rather than a sleep.** Testing that 100 requests are allowed and the 101st is refused, that the counter resets at the boundary, that a token bucket refills at exactly the right rate — **all of it is arithmetic instead of waiting.**

**And it determines the algorithm choice**, because the four candidates differ precisely in how they treat time:

\`\`\`
Fixed window          counts per aligned interval.  O(1) memory.
                      Allows 2N at a boundary.
Sliding log           keeps every timestamp.        O(N) memory.
                      Exact, and expensive.
Sliding window count  weights the previous window.  O(1) memory.
                      Approximate, no boundary burst.
Token bucket          refills continuously.         O(1) memory.
                      Allows a designed burst.
\`\`\`

**None is correct in general; each answers a different question**, and the question is whether bursts are acceptable and how much memory a client's state may cost.

Then the thing the interface must get right, which people discover too late: **a refusal must carry when to retry.**

\`\`\`
boolean          → the client retries immediately, and again,
                   and again. You have built a load amplifier.
{ allowed, remaining, retryAfterMs }
                 → the client waits the right amount
\`\`\`

**And computing \`retryAfterMs\` is different for each algorithm** — time to the next window boundary, time until the oldest timestamp falls out of the log, time to accumulate one token. **Which makes it the test of whether the interface actually fits all four**, rather than fitting the one you implemented first.

**Two more things decide whether the implementation is correct.**

**The refill must be computed from elapsed time, not by a background timer.** A timer per key is unaffordable and unnecessary: **\`tokens = min(capacity, tokens + elapsed × rate)\` evaluated on access** gives the same answer with no scheduler.

**And the state map must be bounded.** One entry per client key means **memory grows with every client ever seen** — so the map needs expiry or eviction, and that interacts with correctness in a way worth thinking about.`,
    analogyLimit:
      '"Count requests and reject over the limit" is the fixed-window algorithm stated as if it were the problem, and it hides the boundary burst: 100 requests at 00:00:59 and 100 more at 00:01:00 is 200 in a second under a 100-per-minute limit. The framing also hides that a refusal is useless without a retry-after — a boolean turns every refused client into an immediate retry, so the limiter becomes an amplifier under exactly the load it exists to shed.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate implements a rate limiter as a map from key to a counter and a window start timestamp: on each request, if the current wall-clock time is past windowStart + 60s, reset the counter to zero and set windowStart to now; then increment and return count <= 100. They say it is O(1) and thread-safe under a single lock. Identify four problems.',
      answer: `**Problem 1 — the boundary burst, which is the algorithm's defining flaw and is not mentioned.**

\`\`\`
Limit: 100 per minute.
00:00:59.9 — 100 requests → all allowed (window 1)
00:01:00.1 — window resets → 100 requests → all allowed
→ 200 requests in 200 milliseconds
\`\`\`

**The limit is nominally 100 per minute and the achievable instantaneous rate is 2N.** Whether that is acceptable is a product decision, **and not knowing it is the problem** — the candidate has chosen a burst tolerance without noticing.

*And the window is per key rather than aligned*, which makes it worse in one way and better in another: **the reset happens on first request after expiry**, so a client that idles and returns gets a fresh window immediately — **their effective limit depends on their own traffic pattern.**

**Problem 2 — reading the wall clock, which breaks both testing and correctness.**

**Untestable:** verifying the boundary behaviour requires waiting sixty seconds, **so the test that matters most is the one nobody writes.**

**And incorrect:** wall-clock time can move backwards — NTP corrections, manual changes, virtual-machine migration.

\`\`\`
windowStart = 12:00:00
clock steps back to 11:59:30
now - windowStart is negative
→ the window never expires, or expires immediately,
  depending on the comparison
\`\`\`

*The fix is two-part:* **take \`now\` as a parameter**, and **use a monotonic source for elapsed time** — or at minimum clamp elapsed to be non-negative, so a backward step cannot produce a negative interval.

**Problem 3 — returning a boolean, so the limiter amplifies load.**

A refused client with no retry hint **retries immediately.** Under overload every refused client retries continuously, **so the rate limiter converts a burst into sustained maximum request rate** — the opposite of its purpose.

\`\`\`
Return instead:
  { allowed: false, remaining: 0, retryAfterMs: 420 }
\`\`\`

**And the caller needs the jitter warning too:** every client told to retry in 420 ms retries at the same instant. **The retry-after should be jittered by the client, or spread by the server.**

**Problem 4 — the map is unbounded, so this is a memory leak with a user-supplied key.**

\`\`\`
One entry per key, never removed.
Keyed by API key: bounded by customers. Survivable.
Keyed by IP address: bounded by the internet.
Keyed by anything a caller controls: an attack.
\`\`\`

**An attacker sending requests with distinct keys allocates an entry each**, and the limiter's own state becomes the vulnerability. *Fix:* **expiry per entry** — an entry whose window has passed carries no information and can be deleted — **plus a bounded map with eviction as a backstop.**

*And the subtlety worth naming:* **evicting an active key resets its limit**, so under memory pressure the eviction policy becomes a correctness hole. **Evicting idle keys is free; evicting active ones grants free requests** — which argues for eviction by staleness rather than by recency of use.

**What a correct minimal version looks like.**

\`\`\`ts
interface RateLimiter {
  tryAcquire(key: string, now: number, cost?: number): Decision;
}
type Decision =
  | { allowed: true;  remaining: number }
  | { allowed: false; remaining: 0; retryAfterMs: number };
\`\`\`

**Plus a stated algorithm with its burst behaviour, elapsed time clamped to non-negative, and per-entry expiry.** Four changes, and the first one — the interface — is what makes the other three sayable.

**The transferable diagnostic: for any limiter, ask what the maximum instantaneous rate is.** For fixed window it is 2N; **for token bucket it is the bucket capacity; for a sliding log it is N.** A candidate who cannot answer has not chosen a burst policy — they have inherited one.`,
    },
  body: `## Requirements and the invariant

**Four questions, and each changes the algorithm.**

\`\`\`
"Are short bursts acceptable, or must the rate be smooth?"
  → bursts fine → token bucket; smooth → sliding window
"What is the limit keyed on — API key, user, IP, endpoint?"
  → decides whether the key space is bounded
"How much memory per client is acceptable?"
  → rules the sliding log in or out
"Does the caller need to know when to retry?"
  → almost always yes → the decision object
\`\`\`

\`\`\`
INVARIANT
  for any key, the number of accepted requests in any
  window of length W never exceeds N
  the decision is a pure function of (key, now, prior state)
  tryAcquire is O(1) time and O(1) memory per key
\`\`\`

**The second clause is the one that makes this testable.** A decision that depends only on its inputs and stored state **can be verified by arithmetic**, which is the entire reason the clock is a parameter.

## The interface, which is the design

\`\`\`ts
export type Decision =
  | { allowed: true;  remaining: number }
  | { allowed: false; remaining: 0; retryAfterMs: number };

export interface RateLimiter {
  /** now: milliseconds from a monotonic source.
   *  cost: weight of this request; some endpoints cost more. */
  tryAcquire(key: string, now: number, cost?: number): Decision;
}
\`\`\`

**Four decisions worth defending.**

**\`now\` is a parameter.** The single highest-value choice here: **every boundary test becomes arithmetic.** And it makes the limiter usable with a simulated clock for load modelling.

**\`cost\` supports weighted requests.** A search endpoint may cost ten units and a health check one, **and without a cost parameter the only way to express that is a second limiter.**

**The decision is a discriminated union, not a boolean plus optional fields.** \`remaining\` is meaningful when allowed; \`retryAfterMs\` when refused. **A single shape with both optional invites reading the wrong one.**

**And \`retryAfterMs\` is required on refusal**, which is what forces each algorithm to be able to compute it — **the test of whether the interface genuinely fits all four rather than the first one implemented.**

*What is deliberately absent:* a \`reset()\`, a \`configure()\`, a statistics method. **None is requested, and each is a speculative seam.**

## Four algorithms

**Fixed window — O(1), simplest, bursts to 2N.**

\`\`\`ts
// state: { windowStart: number, count: number }
const elapsed = Math.max(0, now - s.windowStart);
if (elapsed >= windowMs) { s.windowStart = now; s.count = 0; }
if (s.count + cost > limit)
  return { allowed: false, remaining: 0,
           retryAfterMs: s.windowStart + windowMs - now };
s.count += cost;
return { allowed: true, remaining: limit - s.count };
\`\`\`

**Retry-after is time to the window's end**, which is exact and easy. **And the 2N burst is the cost**, since two adjacent windows can each be filled instantaneously at the boundary.

**Sliding log — exact, O(N) memory per key.**

\`\`\`ts
// state: number[] of accepted timestamps
while (log.length && log[0] <= now - windowMs) log.shift();
if (log.length + cost > limit)
  return { allowed: false, remaining: 0,
           retryAfterMs: log[0] + windowMs - now };
for (let i = 0; i < cost; i++) log.push(now);
return { allowed: true, remaining: limit - log.length };
\`\`\`

**Exact: no window of length W ever contains more than N.** And the memory is N timestamps per key — **for a limit of 10,000 requests per minute across a million keys, that is untenable.**

*Retry-after is the nice property here:* **when the oldest timestamp falls out of the window**, which is precisely correct rather than an upper bound.

**Sliding window counter — O(1), approximate, no boundary burst.**

\`\`\`ts
// state: { prevCount, currCount, currWindowStart }
const intoWindow = now - s.currWindowStart;
const weight = 1 - intoWindow / windowMs;      // 1 → 0
const estimate = s.prevCount * weight + s.currCount;
if (estimate + cost > limit) return refused(...);
\`\`\`

**Two counters and a linear weight**, so the previous window's contribution decays as the current one progresses. **It removes the boundary burst at the cost of being approximate** — it assumes the previous window's requests were evenly spread, which they were not.

*The error is bounded and it goes both ways:* a client that front-loaded the previous window is over-counted and **slightly over-limited**, which is the safer direction.

**Token bucket — O(1), designed bursts, refill from elapsed time.**

\`\`\`ts
// state: { tokens: number, lastRefill: number }
const elapsed = Math.max(0, now - s.lastRefill);
s.tokens = Math.min(capacity, s.tokens + (elapsed * ratePerMs));
s.lastRefill = now;
if (s.tokens < cost) {
  const deficit = cost - s.tokens;
  return { allowed: false, remaining: 0,
           retryAfterMs: Math.ceil(deficit / ratePerMs) };
}
s.tokens -= cost;
return { allowed: true, remaining: Math.floor(s.tokens) };
\`\`\`

**The refill is lazy, and that is the implementation insight worth stating.** No timer, no background task, no per-key scheduling — **elapsed time multiplied by the rate, clamped to capacity, computed when the key is touched.** A million idle keys cost nothing.

**And the burst is a designed parameter rather than an accident.** Capacity is the maximum instantaneous burst; the rate is the sustained limit. **Two independent knobs, which is why this is the usual default.**

*The clamp matters:* without \`Math.min(capacity, ...)\`, a key idle for a day accumulates a day's tokens and **the next burst is unbounded.**

## Choosing, and the number that decides it

\`\`\`
Maximum instantaneous rate:
  fixed window        2N        (boundary)
  sliding log         N         (exact)
  sliding window      ~N        (approximate, no burst)
  token bucket        capacity  (by design)

Memory per key:
  fixed window        2 numbers
  sliding log         N timestamps
  sliding window      3 numbers
  token bucket        2 numbers
\`\`\`

**Ask "what is the maximum instantaneous rate you can tolerate?" and the table answers.** Token bucket by default, **because it makes the burst an explicit parameter instead of a consequence of the window arithmetic.**

## Clock injection, properly

**Three separate concerns, and conflating them is the usual mistake.**

**Testability.** \`now\` as a parameter makes every boundary test arithmetic.

\`\`\`ts
test('refills at exactly the rate', () => {
  const rl = new TokenBucket({ capacity: 10, ratePerSec: 1 });
  for (let i = 0; i < 10; i++)
    expect(rl.tryAcquire('k', 0).allowed).toBe(true);
  expect(rl.tryAcquire('k', 0).allowed).toBe(false);     // empty
  expect(rl.tryAcquire('k', 999).allowed).toBe(false);   // <1 token
  expect(rl.tryAcquire('k', 1000).allowed).toBe(true);   // exactly 1
});
\`\`\`

**Monotonicity.** Wall-clock time moves backwards; **a monotonic source does not.** So the caller should pass a monotonic reading, **and the limiter should clamp elapsed to non-negative anyway** — defence against a caller who passes the wrong thing.

**And resolution.** Millisecond resolution with a rate of one per second is fine; **a rate of 10,000 per second means a token arrives every 0.1 ms**, and integer millisecond arithmetic loses it. *Fix:* keep tokens as a float and compute from elapsed rather than accumulating per tick — **which the lazy refill already does**, so the correct implementation is accidentally robust here.

*The one thing not to do:* **an internal \`Date.now()\` with an optional injected clock for tests.** It works and it means the tested path differs from the production path. **A parameter is honest.**

## Bounding the state

**One entry per key, so the key space is the memory bound.**

\`\`\`
API key      bounded by customers            fine
User id      bounded by users                fine
IP address   bounded by the internet         needs bounding
Anything the caller supplies freely          an attack vector
\`\`\`

**Two mechanisms, and they do different jobs.**

**Expiry: an entry whose state carries no information can be deleted.** For fixed window that is a window older than \`windowMs\`; **for token bucket it is a bucket that has refilled to capacity** — at which point the entry is indistinguishable from a fresh one.

*That second case is the elegant one:* **a full bucket is the same as no bucket**, so idle keys delete themselves without any correctness impact.

**Eviction: a bounded map as a backstop**, because expiry only helps if keys go idle.

**And the interaction worth raising: evicting an active key grants free requests.**

\`\`\`
key at 0 tokens, heavily throttled
→ evicted under memory pressure
→ next request creates a fresh full bucket
→ the client gets a full burst for free
\`\`\`

**So eviction order matters for correctness, not just for hit rate.** Evict by staleness — the entry closest to being equivalent to a fresh one — **rather than by least-recently-used, because the least recently used key is the one whose state has decayed least dangerously.** *In practice:* prefer evicting entries with the most tokens, which is exactly the entries whose eviction is free.

## Thread safety

**Per-key state means per-key synchronisation, which is the good case.**

\`\`\`
One global lock     correct; every request serialises
Per-key lock        correct; contention only per key —
                    and keys are the natural partition
Atomic compare-and-set on the key's state
                    lock-free; retry on contention
\`\`\`

**Per-key locking is right here, and the reason is structural: keys are independent.** Unlike the LRU cache's global recency list, **nothing in a rate limiter relates one key to another** — so partitioning by key costs nothing semantically. **That is a genuinely better position than the cache was in.**

**And the operation must be atomic as a whole**, because it is a check-then-act:

\`\`\`
read tokens → decide → write tokens
  two threads reading 1 token can both decide "allowed"
  → 2 requests admitted on 1 token
\`\`\`

**This is the same read-modify-write race as the inventory oversell**, and the fix is the same: **make the check and the write one atomic operation** — under a per-key lock, or as a compare-and-set that retries.

*And the distributed version is the same argument again:* a shared store needs the whole sequence atomic, **which is why these are implemented as a single server-side script rather than as read, decide, write from the client.**

## What to say in the last three minutes

**The algorithm you chose and its maximum instantaneous rate**, because that is the number that characterises a limiter.

**That the clock is a parameter**, and that elapsed is clamped.

**That the state map is bounded**, and that a full bucket is equivalent to no bucket — so idle keys are free to drop.

**That eviction of an active key grants free requests**, so eviction prefers the most-refilled entries.

**And the retry-after plus jitter point:** returning \`retryAfterMs\` is necessary, **and clients all obeying it exactly is a synchronised herd** — so jitter belongs on one side or the other.

**What you left out:** distributed coordination, per-endpoint cost tables, and a configuration reload path.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'four-algorithms',
      title: 'Four algorithms, and the number that chooses between them',
      caption:
        'Read the rightmost column first. "What maximum instantaneous rate can you tolerate?" is the question that selects an algorithm, and a candidate who has not answered it has inherited a burst policy rather than chosen one.',
      code: `flowchart LR
    Q["**Limit: N per window W.<br/>Which algorithm?**"]

    Q --> FW["**Fixed window**<br/>count per interval<br/>2 numbers/key"]
    Q --> SL["**Sliding log**<br/>every timestamp<br/>N timestamps/key"]
    Q --> SW["**Sliding window count**<br/>weight the previous<br/>3 numbers/key"]
    Q --> TB["**Token bucket**<br/>lazy refill from elapsed<br/>2 numbers/key"]

    FW --> FWR["Max instantaneous: **2N**<br/>retryAfter = end of window<br/>**Boundary burst is the flaw**"]
    SL --> SLR["Max instantaneous: **N**<br/>retryAfter = when the oldest<br/>timestamp falls out — exact<br/>**Memory is the flaw**"]
    SW --> SWR["Max instantaneous: **~N**<br/>Approximate: assumes the<br/>previous window was even.<br/>Errs toward over-limiting,<br/>which is the safe direction"]
    TB --> TBR["Max instantaneous: **capacity**<br/>retryAfter = deficit ÷ rate<br/>**Burst is a parameter,<br/>not an accident** — two<br/>independent knobs"]

    TBR --> D["**Default to token bucket**,<br/>because capacity and rate<br/>are separate knobs and the<br/>refill needs no timer:<br/>tokens = min(cap,<br/>tokens + elapsed × rate)"]

    style TBR fill:#17272a,stroke:#35897e
    style D fill:#17272a,stroke:#35897e
    style FWR fill:#40181c,stroke:#b4535e`,
    },
    {
      kind: 'flow',
      id: 'time-decides',
      title: 'Every decision follows from time being a parameter',
      caption:
        'Step through it. The clock choice is not a testing convenience — it decides testability, correctness under clock steps, and resolution at high rates.',
      nodes: [
        { id: 'param', label: 'now is a parameter', kind: 'note', x: 0, y: 130, detail: 'The single highest-value decision in this problem. Every boundary test becomes arithmetic rather than a sleep — and the boundary is exactly where the four algorithms differ, so it is the test that matters most.' },
        { id: 'mono', label: 'Monotonic, and clamp elapsed', kind: 'service', x: 240, y: 30, detail: 'Wall-clock time moves backwards on NTP corrections and VM migration, which makes a window never expire or expire instantly depending on the comparison. Math.max(0, now - last) is one call and it defends against a caller passing the wrong clock.' },
        { id: 'lazy', label: 'Refill from elapsed, never a timer', kind: 'service', x: 240, y: 160, detail: 'tokens = min(capacity, tokens + elapsed × rate), computed when the key is touched. A million idle keys cost nothing, and there is no scheduler. The clamp is load-bearing: without it a key idle for a day accumulates a day of tokens.' },
        { id: 'res', label: 'Keep tokens as a float', kind: 'service', x: 240, y: 290, detail: 'At 10,000 per second a token arrives every 0.1 ms, so integer millisecond accumulation loses it. Computing from elapsed rather than accumulating per tick is accidentally robust here — the correct implementation already avoids the problem.' },
        { id: 'decision', label: 'Return a decision, not a boolean', kind: 'service', x: 520, y: 90, detail: 'A refused client with no hint retries immediately, so the limiter converts a burst into sustained maximum request rate. And retryAfterMs differs per algorithm — window end, oldest timestamp falling out, deficit over rate — which is the test of whether the interface fits all four.' },
        { id: 'jitter', label: 'And warn about the synchronised herd', kind: 'note', x: 760, y: 90, detail: 'Every client told to retry in 420 ms retries at the same instant. Jitter belongs on one side or the other, and naming it unprompted is the difference between having read about rate limiting and having operated one.' },
        { id: 'bound', label: 'Bound the state map', kind: 'store', x: 520, y: 250, detail: 'One entry per key, so the key space is the memory bound — fine for API keys, an attack vector for anything a caller supplies. A full bucket is indistinguishable from no bucket, so idle keys delete themselves for free.' },
        { id: 'evict', label: 'Evict the most-refilled, not the least-recent', kind: 'note', x: 760, y: 250, detail: 'Evicting a throttled key creates a fresh full bucket and grants a free burst, so eviction order is a correctness question. Prefer entries closest to equivalent-to-fresh — which is the opposite of what an LRU would choose.' },
      ],
      edges: [
        { id: 'r1', source: 'param', target: 'mono', kind: 'control' },
        { id: 'r2', source: 'param', target: 'lazy', kind: 'control' },
        { id: 'r3', source: 'param', target: 'res', kind: 'control' },
        { id: 'r4', source: 'lazy', target: 'decision', kind: 'control' },
        { id: 'r5', source: 'decision', target: 'jitter', kind: 'control' },
        { id: 'r6', source: 'lazy', target: 'bound', kind: 'control' },
        { id: 'r7', source: 'bound', target: 'evict', kind: 'control' },
      ],
      steps: [
        {
          id: 'rs1',
          title: 'Time as a parameter, for three separate reasons',
          description:
            'Testability, monotonicity and resolution are different concerns, and conflating them is the usual mistake. An internal clock with an optional injection for tests means the tested path differs from production.',
          nodes: ['param', 'mono', 'res'],
          edges: ['r1', 'r3'],
        },
        {
          id: 'rs2',
          title: 'Which makes the refill lazy and free',
          description:
            'Elapsed times rate, clamped to capacity, evaluated on access. No timers, no scheduler, and idle keys cost nothing — and the clamp is what stops an idle key banking an unbounded burst.',
          nodes: ['lazy'],
          edges: ['r2'],
        },
        {
          id: 'rs3',
          title: 'A refusal must say when to come back',
          description:
            'A boolean turns the limiter into a load amplifier. And because retry-after is computed differently by each algorithm, requiring it is what proves the interface fits more than the first implementation.',
          nodes: ['decision'],
          edges: ['r4'],
        },
        {
          id: 'rs4',
          title: 'Then warn about the herd you just created',
          description:
            'Precise retry-after values synchronise clients. Jitter on one side or the other, and saying so unprompted is an operator\'s detail rather than a reader\'s.',
          nodes: ['jitter'],
          edges: ['r5'],
        },
        {
          id: 'rs5',
          title: 'And bound the state, with eviction that is not LRU',
          description:
            'The key space is the memory bound. Expiry is free because a full bucket equals no bucket — and eviction must prefer refilled entries, because evicting a throttled key hands out a free burst.',
          nodes: ['bound', 'evict'],
          edges: ['r6', 'r7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['stripe'],
    body: `The published rate-limiting documentation for a payments API is the most useful reference here, and three of its properties are design constraints rather than descriptions.

**A refusal returns a status code and a retry hint.** The documented behaviour is that clients receive a specific error and are expected to back off, **which is what makes the decision object rather than a boolean the correct interface** — the retry hint is part of the contract, not a nicety.

**There are several limits, applied together.** Different endpoints and different operations have different allowances, **which is exactly why the interface needs a \`cost\` parameter or a per-endpoint keying scheme** — one global limit per client cannot express that a search is more expensive than a status check.

**And the documentation recommends exponential backoff with jitter on the client side.** That recommendation exists because **precise retry-after values synchronise clients**, and the documented advice is the mitigation for the herd the limit itself creates.

**Three transferable lessons.**

**The retry hint is part of the limiter's job.** A limiter that only says no has moved the problem to the client and made it worse, **because the client's default is to retry immediately.**

**Multiple limits are the normal case.** So the design should be a limiter per rule with a composition step, **rather than one limiter that tries to express every rule** — and asking "how many limits?" is a requirements question worth raising early.

**And the client's behaviour is part of the system.** A server-side limit plus naive client retries is a load amplifier; **the limit works only if the backoff does** — which is why an interview answer should name jitter even though it lives on the other side of the boundary.

**Where the reference does not help.** It describes an operated service rather than an implementation, so **the algorithm, the clock handling and the state bounding are all yours** — and the state bounding in particular is the part that turns a working limiter into a vulnerability if the key is caller-supplied.`,
  },

  tradeoffs: {
    intro:
      'The algorithm choices and the implementation decisions, with the number that distinguishes each.',
    rows: [
      {
        option: 'Fixed window counter',
        whenItWins:
          'When simplicity matters and a 2N instantaneous burst is acceptable.',
        whenItLoses:
          'Two adjacent windows can each be filled instantly, so the achievable rate is twice the nominal limit.',
        cost:
          'A burst policy chosen by accident rather than on purpose.',
      },
      {
        option: 'Sliding log of timestamps',
        whenItWins:
          'When the limit must be exact and N is small — and its retry-after is precisely correct.',
        whenItLoses:
          'N timestamps per key: a 10,000-per-minute limit across a million keys is untenable.',
        cost:
          'Memory proportional to the limit, per key.',
      },
      {
        option: 'Sliding window counter',
        whenItWins:
          'When the boundary burst is unacceptable and O(1) memory is required.',
        whenItLoses:
          'It assumes the previous window was evenly spread, so it is approximate.',
        cost:
          'A bounded error, erring toward over-limiting — which is the safe direction.',
      },
      {
        option: 'Token bucket',
        whenItWins:
          'The right default. Capacity and rate are independent knobs, and refill needs no timer.',
        whenItLoses:
          'It permits a burst up to capacity, which must be a deliberate choice.',
        cost:
          'Two parameters to set rather than one.',
      },
      {
        option: 'A background timer refilling buckets',
        whenItWins:
          'Nowhere. It is the intuitive reading of "refills over time".',
        whenItLoses:
          'A timer per key is unaffordable, and a global sweep touches idle keys pointlessly.',
        cost:
          'A scheduler, for a result arithmetic gives free.',
      },
      {
        option: 'Lazy refill computed from elapsed time',
        whenItWins:
          'Always. A million idle keys cost nothing and there is no scheduler.',
        whenItLoses:
          'Requires the clamp to capacity, without which an idle key banks an unbounded burst.',
        cost:
          'One multiplication and one min per call.',
      },
      {
        option: 'Reading the wall clock internally',
        whenItWins:
          'Nowhere. It is the default.',
        whenItLoses:
          'Boundary tests need sleeps so they are not written, and backward clock steps make windows never expire or expire instantly.',
        cost:
          'The most important tests, plus a correctness hazard.',
      },
      {
        option: 'now as a parameter, from a monotonic source',
        whenItWins:
          'Always. Every boundary test is arithmetic.',
        whenItLoses:
          'Callers must supply it, and may supply the wrong clock.',
        cost:
          'One parameter, plus clamping elapsed defensively.',
      },
      {
        option: 'Returning a boolean',
        whenItWins:
          'Nowhere. The caller needs to know when to return.',
        whenItLoses:
          'Refused clients retry immediately, so the limiter sustains maximum request rate under overload.',
        cost:
          'The limiter becomes an amplifier under the load it exists to shed.',
      },
      {
        option: 'A decision object with remaining and retryAfterMs',
        whenItWins:
          'Always — and requiring retry-after is what proves the interface fits all four algorithms.',
        whenItLoses:
          'Precise values synchronise clients into a herd.',
        cost:
          'Jitter required on one side or the other.',
      },
      {
        option: 'An unbounded state map',
        whenItWins:
          'When the key is an API key and customers are bounded.',
        whenItLoses:
          'Keyed by IP it is bounded by the internet; keyed by caller-supplied data it is an attack.',
        cost:
          'Memory growth driven by an adversary.',
      },
      {
        option: 'Per-entry expiry plus a bounded map',
        whenItWins:
          'Always. A full bucket is indistinguishable from no bucket, so idle keys drop for free.',
        whenItLoses:
          'Expiry only helps when keys go idle, so eviction is still needed as a backstop.',
        cost:
          'An eviction policy whose order affects correctness.',
      },
      {
        option: 'LRU eviction of limiter state',
        whenItWins:
          'Nowhere. It is the reflex, given the previous lesson.',
        whenItLoses:
          'Evicting a throttled key creates a fresh full bucket, granting a free burst to the most aggressive client.',
        cost:
          'The limit, for exactly the clients it was restraining.',
      },
      {
        option: 'One global lock',
        whenItWins:
          'Low throughput, or a first correct implementation.',
        whenItLoses:
          'Every request serialises, for state that is naturally partitioned.',
        cost:
          'Throughput, unnecessarily.',
      },
      {
        option: 'Per-key locking or compare-and-set',
        whenItWins:
          'Always. Keys are independent, so partitioning costs nothing semantically.',
        whenItLoses:
          'Compare-and-set needs a retry loop under contention.',
        cost:
          'A lock per key, or a retry path.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"A map from key to a counter, reset when the minute rolls over, rejecting anything over the limit."',
      whyWeak:
        'That is the fixed-window algorithm presented as though it were the problem, and its defining flaw goes unmentioned: 100 requests just before the boundary and 100 just after is 200 in a fraction of a second under a 100-per-minute limit. The candidate has chosen a burst tolerance without noticing.',
      strongAnswer:
        '"Fixed window is the simplest, and its maximum instantaneous rate is 2N because two adjacent windows can each be filled at the boundary. I would default to a token bucket instead, where the burst is an explicit capacity parameter and the sustained rate is a separate one. Before choosing, I would ask what maximum instantaneous rate is tolerable — that question selects the algorithm, and the four candidates differ mainly in that number and in memory per key."',
      },
    {
      weakAnswer: '"The limiter checks the current time internally with a system call."',
      whyWeak:
        'Two problems. Boundary behaviour then requires a sixty-second sleep to test, so the test that matters most does not get written. And wall-clock time moves backwards on NTP corrections and VM migration, which makes a window either never expire or expire immediately depending on the comparison.',
      strongAnswer:
        '"The current time is a parameter, from a monotonic source, and I clamp elapsed to non-negative as a defence against a caller passing wall-clock time. That makes every boundary test arithmetic — I can assert that the tenth token is available at exactly 1000 ms and not at 999. And I would not use an internal clock with an optional injection for tests, because then the tested path differs from the production path."',
    },
    {
      weakAnswer: '"tryAcquire returns true or false."',
      whyWeak:
        'A refused client with no retry hint retries immediately, so under overload every refused client retries continuously and the limiter sustains maximum request rate — the opposite of its purpose.',
      strongAnswer:
        '"It returns a decision: allowed with the remaining allowance, or refused with a retryAfterMs. The caller needs the second field to back off correctly. And requiring retry-after is a useful design forcing function, because each algorithm computes it differently — time to the window end, time until the oldest timestamp falls out, or the token deficit divided by the rate — so it proves the interface fits all four rather than the one I implemented first."',
    },
    {
      weakAnswer: '"A background task refills each bucket every tick."',
      whyWeak:
        'A timer per key is unaffordable, and a global sweep touches every idle key for nothing. It also makes the refill rate a function of the scheduler\'s accuracy.',
      strongAnswer:
        '"The refill is computed lazily from elapsed time when the key is touched: tokens equals the minimum of capacity and current tokens plus elapsed times rate. No timers, no scheduler, and a million idle keys cost nothing. The clamp to capacity is load-bearing — without it a key idle for a day accumulates a day of tokens and the next burst is unbounded."',
    },
    {
      weakAnswer: '"The state lives in a map keyed by client IP, which grows as needed."',
      whyWeak:
        'One entry per key means the key space is the memory bound. Keyed by IP that is bounded by the internet, and keyed by anything a caller supplies freely it is an attack: an adversary allocates an entry per request.',
      strongAnswer:
        '"The map has to be bounded. Per-entry expiry does most of it for free, and the elegant case is that a bucket refilled to capacity is indistinguishable from no bucket at all — so idle keys delete themselves with no correctness impact. A bounded map with eviction is the backstop, and the eviction order matters for correctness rather than just hit rate: evicting a throttled key creates a fresh full bucket and hands a free burst to the most aggressive client, so I evict the most-refilled entries rather than the least recently used."',
    },
    {
      weakAnswer: '"Read the current count, check it against the limit, then write the incremented value."',
      whyWeak:
        'That is a read-modify-write race. Two threads reading a state with one token remaining can both decide the request is allowed, so two requests are admitted on one token — the same bug as an inventory oversell.',
      strongAnswer:
        '"The check and the write must be one atomic operation — under a per-key lock, or as a compare-and-set that retries on contention. Per-key locking is the right granularity here because keys are genuinely independent: unlike the LRU cache\'s global recency list, nothing relates one key to another, so partitioning by key costs nothing semantically. And the same argument applies to a distributed limiter, which is why those are implemented as a single server-side script rather than read-decide-write from the client."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lrl-1',
      front: 'What single number characterises a rate limiter?',
      back: 'Its maximum instantaneous rate: 2N for fixed window, N for a sliding log, roughly N for a sliding window counter, and the bucket capacity for a token bucket.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lrl-2',
      front: 'What is the fixed window\'s defining flaw?',
      back: 'The boundary burst — two adjacent windows can each be filled instantaneously, so the achievable rate is twice the nominal limit.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lrl-3',
      front: 'What does a sliding log buy and cost?',
      back: 'Exactness and a precisely correct retry-after, at N timestamps of memory per key — untenable for large limits across many keys.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lrl-4',
      front: 'How does a sliding window counter approximate?',
      back: 'It weights the previous window\'s count linearly as the current window progresses, assuming the previous window was evenly spread.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lrl-5',
      front: 'Why is token bucket the usual default?',
      back: 'Capacity and rate are independent knobs, so the burst is an explicit parameter rather than a consequence of window arithmetic.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lrl-6',
      front: 'How is a token bucket refilled without a timer?',
      back: 'tokens = min(capacity, tokens + elapsed × rate), computed when the key is touched. No scheduler, and idle keys cost nothing.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lrl-7',
      front: 'Why is the clamp to capacity load-bearing?',
      back: 'Without it, a key idle for a day accumulates a day of tokens and the next burst is unbounded.',
      topic: 'algorithms',
    },
    {
      id: 'fc-lrl-8',
      front: 'Name the three separate reasons the clock is a parameter.',
      back: 'Testability (boundary tests become arithmetic), monotonicity (wall clocks step backwards), and resolution (high rates need sub-millisecond accounting).',
      topic: 'clock-injection',
    },
    {
      id: 'fc-lrl-9',
      front: 'Why not an internal clock with an optional injection for tests?',
      back: 'The tested path then differs from the production path. A parameter is honest.',
      topic: 'clock-injection',
    },
    {
      id: 'fc-lrl-10',
      front: 'Why must a refusal carry retryAfterMs?',
      back: 'A boolean makes refused clients retry immediately, so the limiter sustains maximum request rate under overload — it becomes an amplifier.',
      topic: 'testability',
    },
    {
      id: 'fc-lrl-11',
      front: 'Why does requiring retry-after validate the interface?',
      back: 'Each algorithm computes it differently — window end, oldest timestamp falling out, deficit over rate — so requiring it proves the interface fits all four.',
      topic: 'testability',
    },
    {
      id: 'fc-lrl-12',
      front: 'What bounds a rate limiter\'s memory, and what is the risk?',
      back: 'The key space — fine for API keys, bounded by the internet for IPs, and an attack vector for anything a caller supplies freely.',
      topic: 'thread-safety',
    },
    {
      id: 'fc-lrl-13',
      front: 'Why is LRU the wrong eviction policy for limiter state?',
      back: 'Evicting a throttled key creates a fresh full bucket, granting a free burst to the most aggressive client. Evict the most-refilled entries instead.',
      topic: 'thread-safety',
    },
    {
      id: 'fc-lrl-14',
      front: 'Why is per-key locking better here than in an LRU cache?',
      back: 'Keys are genuinely independent — nothing relates one to another — so partitioning costs nothing semantically, unlike splitting a global recency list.',
      topic: 'thread-safety',
    },
  ],

  quiz: [
    {
      id: 'q-lrl-1',
      kind: 'scenario',
      prompt:
        'A fixed-window limiter allows 100 requests per minute. What is the maximum number a client can send in a 200-millisecond span?',
      options: [
        { id: 'a', label: '200 — 100 just before the boundary and 100 just after' },
        { id: 'b', label: '100, since that is the limit' },
        { id: 'c', label: '1, because the window has not reset' },
        { id: 'd', label: 'Unbounded, since the counter resets on each request' },
      ],
      correct: ['a'],
      explanation:
        'Two adjacent windows can each be filled instantaneously, so the achievable instantaneous rate is twice the nominal limit. This is the algorithm\'s defining flaw, and whether it matters is a product decision — the problem is choosing it without knowing.',
      difficulty: 'core',
      topic: 'algorithms',
    },
    {
      id: 'q-lrl-2',
      kind: 'scenario',
      prompt:
        'A token bucket has capacity 10 and refills at 1 per second. A key is untouched for 24 hours, then sends a burst. Without the clamp to capacity, what happens?',
      options: [
        { id: 'a', label: 'It accumulates 86,400 tokens, so the burst is effectively unbounded' },
        { id: 'b', label: 'It accumulates 10 tokens, since capacity limits the state' },
        { id: 'c', label: 'It has 0 tokens, because the state expired' },
        { id: 'd', label: 'Nothing changes; the clamp is a micro-optimisation' },
      ],
      correct: ['a'],
      explanation:
        'The clamp is what makes capacity mean anything. Without min(capacity, ...) the lazy refill computes tokens from elapsed time with no upper bound, so idle time banks an unbounded burst — and the intuitive reading of "refills over time" gives exactly this bug.',
      difficulty: 'core',
      topic: 'algorithms',
    },
    {
      id: 'q-lrl-3',
      kind: 'scenario',
      prompt:
        'Why does `tryAcquire` returning a boolean make a rate limiter worse under overload?',
      options: [
        { id: 'a', label: 'Refused clients retry immediately and continuously, so the limiter sustains maximum request rate rather than shedding load' },
        { id: 'b', label: 'Booleans cannot express partial success' },
        { id: 'c', label: 'It prevents weighted requests' },
        { id: 'd', label: 'It makes the implementation harder to test' },
      ],
      correct: ['a'],
      explanation:
        'Without a retry hint the client\'s default is an immediate retry, so the limiter converts a burst into a sustained flood. Requiring retryAfterMs also serves a design purpose: each algorithm computes it differently, which proves the interface fits more than the first implementation.',
      difficulty: 'core',
      topic: 'testability',
    },
    {
      id: 'q-lrl-4',
      kind: 'scenario',
      prompt:
        'Limiter state is held in a bounded map with LRU eviction. What goes wrong?',
      options: [
        { id: 'a', label: 'Evicting a throttled key creates a fresh full bucket, so the most aggressive clients get free bursts' },
        { id: 'b', label: 'Nothing — LRU is the right policy for bounded caches' },
        { id: 'c', label: 'The map still grows unboundedly' },
        { id: 'd', label: 'Idle keys are never evicted' },
      ],
      correct: ['a'],
      explanation:
        'Eviction order is a correctness question here, not a hit-rate question. A heavily-throttled key is the most valuable state to keep and the most likely to be recently used — so LRU keeps it, but under pressure any eviction of an active key grants a burst. Prefer evicting the most-refilled entries, which are the ones already equivalent to fresh.',
      difficulty: 'advanced',
      topic: 'thread-safety',
    },
    {
      id: 'q-lrl-5',
      kind: 'scenario',
      prompt:
        'Two threads call tryAcquire for the same key when one token remains. The code reads the state, decides, then writes. What happens?',
      options: [
        { id: 'a', label: 'Both may be allowed — a read-modify-write race, the same bug as an inventory oversell' },
        { id: 'b', label: 'One blocks until the other finishes, since maps are thread-safe' },
        { id: 'c', label: 'Both are refused, since the token count reaches -1' },
        { id: 'd', label: 'The outcome is correct because the write is atomic' },
      ],
      correct: ['a'],
      explanation:
        'The write being atomic does not help: both threads read the same state before either wrote. The fix is to make the whole check-and-write atomic — a per-key lock or a compare-and-set retry — which is also why distributed limiters run as a single server-side script rather than read-decide-write from the client.',
      difficulty: 'core',
      topic: 'thread-safety',
    },
    {
      id: 'q-lrl-6',
      kind: 'multi',
      prompt:
        'Which are genuine reasons to pass the current time as a parameter? Select all that apply.',
      options: [
        { id: 'a', label: 'Boundary behaviour becomes testable by arithmetic rather than by sleeping' },
        { id: 'b', label: 'Wall-clock time can step backwards, making windows never expire or expire instantly' },
        { id: 'c', label: 'The same limiter can be driven by a simulated clock for load modelling' },
        { id: 'd', label: 'It reduces the number of system calls, which is the main benefit' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Testability, monotonicity and simulation are three distinct reasons, and conflating them is the usual mistake. The system-call saving is real and negligible — treating it as the main benefit misses that this is a correctness and testability decision.',
      difficulty: 'core',
      topic: 'clock-injection',
    },
  ],

  exercises: [
    {
      id: 'ex-lrl-1',
      kind: 'implement',
      title: 'Compose multiple limits, then distribute one',
      estimatedMinutes: 45,
      prompt: `**Part 1.** Implement \`TokenBucket\` behind the \`RateLimiter\` interface from the lesson, with lazy refill, a clamped elapsed time, and a correct \`retryAfterMs\`. Then write the four tests that prove the invariant.

**Part 2.** A real API needs several limits at once: 1,000 requests per hour per API key, 20 per second per API key, and 100 per minute per IP. Design the composition. What does a refusal return when two limits refuse?

**Part 3.** Add a per-endpoint cost table, so a search costs 10 units and a status check costs 1. Where does the table live, and why not inside the limiter?

**Part 4.** Now the limiter must work across 12 servers sharing one limit. State what breaks, give the mechanism, and name what you give up.

Then answer:

- In Part 2, should a request consume from every bucket or only until the first refusal?
- What is the worst failure mode of the distributed version, and which way does it fail?`,
      rubric: [
        'TokenBucket implements lazy refill with the capacity clamp.',
        'Elapsed time is clamped to non-negative.',
        'retryAfterMs computed from the token deficit and rate.',
        'Four tests including exact refill timing and the burst ceiling.',
        'Composition is a list of rules with an explicit refusal policy.',
        'Answers what a multi-refusal returns with reasoning.',
        'Cost table placed outside the limiter with justification.',
        'Distributed section identifies the atomicity requirement and the round trip.',
        'Names the failure direction and defends it.',
      ],
      modelAnswer: `**Part 1 — the implementation and its tests**

\`\`\`ts
export interface BucketConfig {
  capacity: number;        // maximum instantaneous burst
  ratePerSec: number;      // sustained rate
}

interface BucketState { tokens: number; lastRefill: number; }

export class TokenBucket implements RateLimiter {
  private readonly state = new Map<string, BucketState>();
  private readonly ratePerMs: number;

  constructor(private readonly cfg: BucketConfig) {
    if (cfg.capacity < 1) throw new RangeError('capacity >= 1');
    if (cfg.ratePerSec <= 0) throw new RangeError('rate > 0');
    this.ratePerMs = cfg.ratePerSec / 1000;
  }

  tryAcquire(key: string, now: number, cost = 1): Decision {
    if (cost > this.cfg.capacity)
      // Unsatisfiable at any time — refuse without consuming.
      return { allowed: false, remaining: 0, retryAfterMs: Infinity };

    const s = this.state.get(key)
      ?? { tokens: this.cfg.capacity, lastRefill: now };

    const elapsed = Math.max(0, now - s.lastRefill);   // clamp
    s.tokens = Math.min(this.cfg.capacity,
                        s.tokens + elapsed * this.ratePerMs);
    s.lastRefill = now;

    if (s.tokens < cost) {
      const deficit = cost - s.tokens;
      this.state.set(key, s);
      return {
        allowed: false, remaining: 0,
        retryAfterMs: Math.ceil(deficit / this.ratePerMs),
      };
    }

    s.tokens -= cost;
    this.state.set(key, s);
    return { allowed: true, remaining: Math.floor(s.tokens) };
  }
}
\`\`\`

**Three details worth pointing at.**

**A cost exceeding capacity returns \`Infinity\` rather than looping forever.** Waiting will never help — **the bucket cannot hold that many tokens** — so this is a configuration error surfaced as a refusal rather than an unsatisfiable retry-after.

**A missing key starts full.** The alternative — starting empty — would throttle every new client's first burst, **and it is equivalent to the client having been idle forever**, which is what the full state represents.

**The state is written on both paths.** The refusal path still updates \`lastRefill\` and the refilled token count, **so a refused request does not lose the refill that happened since the last call.**

**The four tests.**

\`\`\`ts
test('allows a burst up to capacity, then refuses', () => {
  const rl = new TokenBucket({ capacity: 10, ratePerSec: 1 });
  for (let i = 0; i < 10; i++)
    expect(rl.tryAcquire('k', 0).allowed).toBe(true);
  const d = rl.tryAcquire('k', 0);
  expect(d.allowed).toBe(false);
  expect((d as any).retryAfterMs).toBe(1000);   // 1 token at 1/s
});

test('refills at exactly the rate', () => {
  const rl = new TokenBucket({ capacity: 10, ratePerSec: 1 });
  for (let i = 0; i < 10; i++) rl.tryAcquire('k', 0);
  expect(rl.tryAcquire('k', 999).allowed).toBe(false);
  expect(rl.tryAcquire('k', 1000).allowed).toBe(true);
});

test('does not accumulate beyond capacity while idle', () => {
  const rl = new TokenBucket({ capacity: 10, ratePerSec: 1 });
  rl.tryAcquire('k', 0);                        // 9 left
  const day = 86_400_000;
  let allowed = 0;
  for (let i = 0; i < 50; i++)
    if (rl.tryAcquire('k', day).allowed) allowed++;
  expect(allowed).toBe(10);                     // NOT 86,400
});

test('a backward clock step does not grant tokens', () => {
  const rl = new TokenBucket({ capacity: 5, ratePerSec: 1 });
  for (let i = 0; i < 5; i++) rl.tryAcquire('k', 10_000);
  expect(rl.tryAcquire('k', 9_000).allowed).toBe(false);  // clamped
});
\`\`\`

**The third test is the discriminating one.** An implementation missing the capacity clamp passes the first two and allows 86,400 requests here — **and every one of these tests is arithmetic, which is only possible because the clock is a parameter.**

---

**Part 2 — composing several limits**

\`\`\`ts
interface LimitRule {
  name: string;
  keyOf: (req: Request) => string;    // api key, ip, ...
  limiter: RateLimiter;
}

const RULES: LimitRule[] = [
  { name: 'key-hourly', keyOf: r => \`k:\${r.apiKey}\`,
    limiter: new TokenBucket({ capacity: 1000, ratePerSec: 1000/3600 }) },
  { name: 'key-burst',  keyOf: r => \`kb:\${r.apiKey}\`,
    limiter: new TokenBucket({ capacity: 20, ratePerSec: 20 }) },
  { name: 'ip-minute',  keyOf: r => \`ip:\${r.ip}\`,
    limiter: new TokenBucket({ capacity: 100, ratePerSec: 100/60 }) },
];

function check(req: Request, now: number, cost: number): Verdict {
  // Phase 1: ask every rule WITHOUT consuming.
  const refusals = RULES
    .map(r => ({ r, d: r.limiter.peek(r.keyOf(req), now, cost) }))
    .filter(x => !x.d.allowed);

  if (refusals.length > 0) {
    const worst = refusals.reduce((a, b) =>
      b.d.retryAfterMs > a.d.retryAfterMs ? b : a);
    return { allowed: false, rule: worst.r.name,
             retryAfterMs: worst.d.retryAfterMs };
  }

  // Phase 2: consume from all rules.
  for (const r of RULES) r.limiter.tryAcquire(r.keyOf(req), now, cost);
  return { allowed: true };
}
\`\`\`

**Three decisions here, and the first is the important one.**

**Two phases: check all, then consume all.** A naive loop that consumes as it goes **charges the buckets that passed before hitting the one that refuses** — so a client blocked by the IP limit silently burns their API-key allowance. **Over a sustained block that exhausts a limit they never actually used.**

*The cost is that \`peek\` must exist* — a non-consuming variant of \`tryAcquire\` — **which is a small interface addition and the only honest way to compose.**

**A refusal reports the largest retry-after and the rule that produced it.** The client must wait for the *slowest* constraint; **returning the smallest would guarantee a second refusal.** And naming the rule is what lets a client distinguish "you are over your plan" from "your IP is noisy", which are different actions.

**Separate keys per rule, prefixed.** \`k:abc\` and \`kb:abc\` are different buckets for the same API key. **Without the prefix the hourly and burst limits would share state**, which is a subtle and total failure.

*And the composition is a list, which makes it configuration rather than code* — adding a per-endpoint limit is a new entry.

---

**Part 3 — the cost table**

**It lives outside the limiter, in the routing or middleware layer:**

\`\`\`ts
const COST: Record<string, number> = {
  'POST /search': 10,
  'GET /status': 1,
  'POST /export': 50,
};
const cost = COST[route] ?? DEFAULT_COST;
check(req, now, cost);
\`\`\`

**Three reasons not to put it inside.**

**The limiter does not know about routes.** Its job is "N units per window per key", and **a route is a concept from a layer above.** Pushing the table in would give the limiter a dependency on the HTTP surface.

**It would make the limiter change for a product reason.** Adding an endpoint or repricing one is a routing change; **with the table inside, every such change edits the limiter** — which is the single-responsibility test failing on "who edits this".

**And the cost is per request, not per limiter.** The same request consumes the same cost from all three rules in Part 2, **so the cost belongs to the request rather than to any one limiter** — which the \`cost\` parameter already expresses correctly.

*One thing I would put inside:* the \`cost > capacity\` check from Part 1, **because only the limiter knows its capacity** and an unsatisfiable request should be identified where that knowledge is.

---

**Part 4 — distributing the limit across 12 servers**

**What breaks: the state is per process, so twelve servers enforce twelve independent limits.**

\`\`\`
Configured: 1,000/hour per key
Reality:    12 × 1,000 = 12,000/hour
\`\`\`

**And local state cannot be made correct by any local means** — the servers have to share it.

**The mechanism: the bucket state lives in a shared store, and the whole check-and-consume runs atomically there.**

\`\`\`
Per request, per rule:
  atomically, in the store:
    1. read { tokens, lastRefill }
    2. tokens = min(cap, tokens + (now - lastRefill) * rate)
    3. if tokens >= cost: tokens -= cost; allowed = true
    4. write { tokens, lastRefill: now }
    5. return allowed + remaining/deficit
\`\`\`

**The atomicity requirement is the whole design.** Read-decide-write from the application would race across servers exactly as it races across threads — **so this must be one server-side operation**, which is why these are implemented as a script executed in the store rather than as three round trips.

**And \`now\` is supplied by the caller**, which raises a new problem: **twelve servers with slightly different clocks.** A server whose clock is 500 ms ahead computes a larger elapsed and grants extra tokens. *Options:* use the store's own clock inside the script — **which is the better answer, since it makes time single-sourced** — or accept bounded skew as a small over-grant.

**What I give up, in order of importance.**

**A network round trip on every request**, on the hot path, before any work is done. **The limiter now has a latency cost and an availability dependency** — which is a significant change from a local map lookup.

**Exactness under partition.** If the store is unreachable the limiter cannot decide, which is the failure question below.

**And per-key contention becomes global.** A single very hot key serialises on one store key across all twelve servers, **where locally each server had its own lock.**

*The standard mitigation, worth naming:* **local buckets holding a share of the global allowance**, reconciled periodically — the rate-limiting lesson's approximate-enforcement approach. **Each server gets 1,000/12 per hour and requests more from the store when it runs low.** That removes the per-request round trip and accepts that a client hitting one server hard is limited before the global limit is reached.

---

**Should a request consume from every bucket, or stop at the first refusal?**

**Neither, as stated — check all without consuming, then consume from all. And the reasoning matters.**

**Consuming as you go is wrong**, because the buckets checked before the refusal are charged for a request that never happened:

\`\`\`
key-hourly:  ok, consumed (999 left)
key-burst:   ok, consumed (19 left)
ip-minute:   REFUSED
→ the request was rejected and the client paid twice
→ under a sustained IP block, their hourly allowance drains
   to zero without a single successful request
\`\`\`

**That is a real and nasty bug**: a client throttled by a shared-IP limit loses the plan allowance they are paying for, **and the cause is invisible to them.**

**Stopping at the first refusal without consuming anything is closer to correct** and gives a worse answer to the client: **you learn about the first constraint that refused rather than the binding one.** If the hourly limit refuses with a 40-minute retry-after and the burst limit would have refused with 50 ms, **reporting the first one you happened to check is misleading.**

*So: check all, report the maximum retry-after, and consume only on success.* **The cost is a \`peek\` method and one extra pass over a list of three rules** — negligible, and it is the only composition that is fair to the client in both directions.

*One refinement for a hot path:* **order the rules cheapest-and-most-likely-to-refuse first and short-circuit the check phase** if you only need a yes/no. But if you want the correct retry-after you need all of them, **so the full check is the honest default.**

---

**The worst failure mode of the distributed version, and which way it fails**

**The store becomes unreachable, and the limiter must decide with no state.**

\`\`\`
Fail closed:  refuse everything
              → a limiter outage becomes a total API outage
              → the limiter is now less available than the
                service it protects
Fail open:    allow everything
              → unlimited traffic reaches the backend
              → and the backend has no other protection
\`\`\`

**Both are bad, and the answer is neither in full.**

**I would fail open with a local fallback limit.** On losing the store, each server switches to a local bucket sized at its share of the global allowance — **1,000/12 per hour per key** — computed from local state.

**Three reasons this is the right direction.**

**A rate limiter must not be the thing that takes the service down.** It is a protective component, and **a protective component that fails closed has inverted its purpose.** The streaming lesson's fail-open stance, applied here.

**The local fallback bounds the damage.** Pure fail-open admits 12× the limit under a store outage; **the local share admits roughly 1× in aggregate if traffic is balanced**, which is close to correct.

**And the degradation is legible.** The fallback is a known mode with a known limit, **so the blast radius is calculable** rather than "unlimited traffic for the duration of the incident".

*What it gives up:* **exactness while degraded**, and unfairness if traffic is unbalanced — a client hitting one server gets 1/12 of their allowance. **That is the right thing to lose.**

*And the second-worst failure mode, worth naming:* **clock skew between servers**, because it fails silently. A server 500 ms ahead grants extra tokens on every request and **nothing surfaces it** — the limit is simply slightly wrong, forever. **Sourcing time from inside the store's atomic script removes it**, which is the stronger reason for that choice than convenience.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lrl-1',
      level: 'basic',
      question: 'Design and implement a rate limiter.',
      guidance:
        'Look for the algorithm named with its maximum instantaneous rate, and for the clock as a parameter. A counter reset on the minute boundary without mentioning the 2N burst is the weak answer.',
    },
    {
      id: 'iq-lrl-2',
      level: 'basic',
      question: 'Which algorithms could you use, and how do they differ?',
      guidance:
        'Four candidates differing in memory per key and maximum instantaneous rate. Strong answers ask what burst is tolerable, since that question selects the algorithm.',
    },
    {
      id: 'iq-lrl-3',
      level: 'intermediate',
      question: 'How does the token bucket refill?',
      guidance:
        'Lazily, from elapsed time, clamped to capacity. Look for the rejection of a background timer and for why the clamp matters.',
    },
    {
      id: 'iq-lrl-4',
      level: 'intermediate',
      question: 'What does tryAcquire return?',
      guidance:
        'A decision with remaining or retryAfterMs, never a boolean. Strong answers note that requiring retry-after is what proves the interface fits every algorithm.',
    },
    {
      id: 'iq-lrl-5',
      level: 'advanced',
      question: 'How would you test the boundary behaviour?',
      guidance:
        'By arithmetic, because the clock is a parameter — assert the token is available at exactly 1000 ms and not at 999. Any answer involving a sleep has the wrong interface.',
    },
    {
      id: 'iq-lrl-6',
      level: 'advanced',
      question: 'Where does the limiter state live, and what bounds it?',
      guidance:
        'One entry per key, so the key space is the bound. Excellent answers note that a full bucket equals no bucket, and that evicting an active key grants a free burst.',
    },
    {
      id: 'iq-lrl-7',
      level: 'followup',
      question: 'Now make it work across twelve servers.',
      guidance:
        'Shared state with the whole check-and-consume atomic in the store, time sourced inside the script. Look for the round-trip cost and the local-share mitigation.',
    },
    {
      id: 'iq-lrl-8',
      level: 'followup',
      question: 'The shared store becomes unreachable. What do you do?',
      guidance:
        'Fail open with a local fallback sized at each server\'s share. A limiter that fails closed has inverted its purpose by taking down the service it protects.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lrl-1',
      kind: 'what-changes-if',
      prompt:
        'Change the goal: instead of rejecting excess requests, the limiter must delay them so the downstream service sees a smooth rate. What changes, and what new failure mode appears?',
      discussion: `**This is a different component wearing a similar name**, and separating them is the point: a limiter sheds load, a **throttle** or **shaper** defers it. The algorithms overlap and almost everything else changes.

**What survives.**

**The token bucket arithmetic, unchanged.** Lazy refill, clamp to capacity, elapsed clamped to non-negative.

**The clock as a parameter**, and for the same three reasons.

**And the per-key state with its bounding problem** — now worse, because a delayed request holds resources while it waits.

**What changes: the return value stops being a decision and becomes a wait.**

\`\`\`
Limiter:  tryAcquire → { allowed, retryAfterMs }
          the CLIENT waits, and may not
Shaper:   acquire → Promise that resolves when a token is
          available
          the SERVER waits, holding the request
\`\`\`

**And that inverts who holds the cost.** A rejection costs the client a retry; **a delay costs the server a held connection, a thread or a promise, plus memory for the queued request** — for as long as the wait lasts.

**Which produces the new failure mode, and it is the significant one: an unbounded queue.**

\`\`\`
Arrival rate 500/s, shaped rate 100/s
→ queue grows by 400/s
→ after 60 seconds: 24,000 queued requests
→ every one of them holding memory and a connection
→ and every one of them probably already timed out
   at the client
\`\`\`

**A shaper without a bounded queue converts an overload into a memory exhaustion**, and it does so while doing useless work — **serving requests whose callers have already given up.**

**So a shaper needs three things a limiter does not.**

**A bounded queue, with rejection when full.** Which means **the shaper still needs the limiter's refusal path** — it has not eliminated rejection, it has deferred it. *And the honest framing:* a shaper is a limiter with a small buffer in front.

**A maximum wait, enforced server-side.** A request whose wait would exceed the client's likely timeout should be refused immediately rather than queued. **Waiting past the caller's deadline is pure waste** — the backpressure lesson's point exactly, and the queue must know the deadline to apply it.

**And the queue discipline becomes a decision.** First-in-first-out is fair and means a burst delays everything behind it; **last-in-first-out serves fresh requests first and starves the oldest** — which is counter-intuitively better under overload, because the oldest requests are the most likely to have timed out already.

**Two more things worth knowing.**

**Shaping and rejecting compose naturally, in that order.** Shape up to a small queue depth, reject beyond it. **This is what a well-behaved API does: tolerate small bursts by delaying them, refuse sustained overload.**

**And a shaper hides the signal a limiter sends.** A client receiving a refusal with a retry-after learns it is over its limit; **a client experiencing a 3-second delay learns only that you are slow.** *Which is a real product cost:* **shaping degrades observability for the caller**, and the mitigation is to send the wait as a response header even on success.

**What I would build.**

\`\`\`
acquire(key, now, cost, deadline): Promise<Result>
  · compute wait from the token deficit
  · if wait > (deadline - now)      → refuse NOW, no queueing
  · if queue depth at key >= MAX    → refuse now
  · else enqueue with the deadline, resolve when tokens exist
  · on dequeue: re-check the deadline before proceeding
\`\`\`

**That last clause matters.** A request that waited legitimately may have expired while waiting, **so the deadline is checked again at the front of the queue** — otherwise the shaper does work for callers who are gone.

**The transferable point:** rejecting and delaying move the cost to opposite sides of the boundary, so **a shaper takes on the caller's waiting as your memory** — which means it needs a bounded queue, a deadline and a discipline, and it still needs the rejection path it appeared to remove. **"Delay instead of reject" is not a simplification; it is rejection with a buffer and three new parameters.**`,
    },
    {
      id: 'al-lrl-2',
      kind: 'debug',
      prompt:
        'A rate limiter allowing 100 requests per minute per API key is reported by customers as rejecting them "long before 100". Metrics show refusals at counts between 40 and 60. The limiter uses a token bucket with capacity 100 and a refill rate of 100 per minute, the clock is injected, and unit tests pass. Diagnose it.',
      discussion: `**Refusals at 40–60 against a limit of 100 is roughly half**, and that number is the clue: **a factor of about two suggests either double consumption or a halved effective capacity** — and both have specific causes worth distinguishing before generating a long list.

**Hypothesis 1 — the request consumes from the bucket more than once.**

If the limiter is invoked in two places — middleware and a handler, or a retry wrapper and the route — **each request costs two tokens** and the client sees refusal at 50.

*Why it fits precisely:* 40–60 brackets 50, and **the variance would come from a subset of endpoints being double-checked.**

*Check:* count \`tryAcquire\` calls per inbound request. **A ratio above 1.0 is conclusive**, and it is a single counter.

*And a specific variant worth checking:* **a preflight or health check sharing the key.** A browser sending an OPTIONS request before each POST doubles the count, **and the OPTIONS never appears in the customer's own count of "requests".**

**Hypothesis 2 — the composed rules share a key, so two limits consume the same bucket.**

From the lesson's composition: if an hourly and a per-minute rule are keyed \`k:{apiKey}\` without distinct prefixes, **both consume the same state** and the effective limit is halved.

*Why it fits:* exactly a factor of two, and **the unit tests would pass** because they test one limiter in isolation.

*Check:* the key derivation for every rule. **Distinct prefixes per rule, verified by asserting the store's key set.**

**Hypothesis 3 — a per-request cost above 1 that nobody accounted for.**

If a cost table exists and a default of 2 was applied, or a search endpoint costs 10 and customers make more searches than they realise, **the token count and the request count diverge legitimately.**

*Why the range fits:* a mixed workload of cost-1 and cost-10 requests produces a *variable* effective request limit — **which explains 40 to 60 better than an exact halving does.** **This is my leading hypothesis on the evidence**, because the spread is the thing a constant factor cannot explain.

*Check:* the distribution of cost values actually passed, and whether the customer-visible documentation mentions weights. **A limit expressed in requests and enforced in units is a documentation bug as much as a code one.**

**Hypothesis 4 — the servers each hold local state, so the limit is per server and unevenly consumed.**

With twelve servers each holding capacity 100, the aggregate is 1,200 — **the opposite of the reported symptom.** *Unless* the configuration divides the allowance: each server given capacity 100/12 ≈ 8, **and a client whose requests land unevenly is refused early on whichever server took more.**

*Why it fits the range:* load-balancer distribution is not uniform, **so the count at which a given client is refused varies run to run** — which matches "between 40 and 60" better than a fixed halving.

*Check:* whether state is local and how the allowance is divided, and the per-server distribution of one customer's requests. **A client with sticky routing or a small request count will see this strongly.**

**Hypothesis 5 — refill rate and capacity are inconsistent in their units.**

\`ratePerSec: 100/60\` is 1.67 per second; **a configuration passing \`100\` as a per-second rate refills too fast, and passing \`100/3600\` refills far too slowly.** With a slow refill, a client using 100 in the first ten seconds waits a long time — **and if they count requests over a minute, they see refusals well before 100 in the *second* minute.**

*Why it fits:* the first minute allows 100, **subsequent minutes allow far fewer** — so the reported count depends on how long the customer has been running. *Check:* the effective \`ratePerMs\` and a test asserting the sustained rate over three windows, which the existing tests apparently do not cover.

**What I would check first: the count of \`tryAcquire\` invocations per inbound request, and the distribution of \`cost\` values.** Two metrics, and between them they separate "the limiter is called too often", "each call costs too much" and "the limit is per server". **All three present as premature refusal and have unrelated fixes.**

**Then: whether state is local or shared, and the key prefixes per rule.** Both are code reads.

**Why "unit tests pass" is the most informative fact here.**

It tells you **the algorithm is correct in isolation** — the bucket refills right, the clamp works, the boundary is exact. **So the bug is in how the limiter is wired into the system**, not in what it computes.

**Which is a specific and useful conclusion: every hypothesis above is about the call site, the key, the cost, or the deployment topology.** None is about the token arithmetic. **A component with good unit tests failing in production is almost always failing at its boundaries**, and rate limiters have four: the key, the cost, the clock and the number of call sites.

**The instrumentation this demands.**

**A ratio of \`tryAcquire\` calls to inbound requests.** It should be exactly the number of rules, and **any deviation is hypothesis 1 detected directly.** This is the single most valuable counter and it does not exist in most implementations.

**Refusals broken down by rule name.** The composition returns which rule refused, **so the metric should carry it** — without that, "customers are being refused" cannot be attributed to the hourly, burst or IP limit.

**The cost distribution, and the effective limit in requests.** A limit configured in units and experienced in requests needs a translation, **and publishing "your remaining allowance" in the response — the \`remaining\` field the interface already returns — makes the customer's count and yours agree.** That alone would have turned this report into a specific one.

**Per-key token levels sampled over time.** A saw-tooth that never approaches capacity indicates a refill-rate misconfiguration; **a level that sits at zero indicates sustained overload rather than a bug.**

**And a sustained-rate test, over several windows**, which the existing suite is missing. The lesson's four tests cover the burst, the exact refill, the idle clamp and the backward clock — **none of them checks that the rate is sustainable across three consecutive windows**, which is precisely where a units error hides.

**Transferable:** when a limiter refuses earlier than configured, **the error is almost never in the algorithm and almost always in the accounting** — how many times it is asked, what each ask costs, which key it lands on, and how many independent copies exist. **Instrument the ratio of calls to requests first**, because it is one counter and it eliminates the most common cause outright.`,
    },
  ],

  revision: {
    bullets: [
      'Every interesting property of a rate limiter is a property of time, so the clock is a parameter.',
      'Then every boundary test is arithmetic rather than a sleep — and the boundary is where the algorithms differ.',
      'The number that characterises a limiter is its maximum instantaneous rate.',
      'Fixed window: O(1) memory, bursts to 2N at the boundary.',
      'Sliding log: exact and precisely correct retry-after, at N timestamps per key.',
      'Sliding window counter: O(1) and approximate, erring toward over-limiting.',
      'Token bucket: O(1), with capacity and rate as independent knobs — the usual default.',
      'Refill lazily: tokens = min(capacity, tokens + elapsed × rate), computed on access.',
      'No background timer: a timer per key is unaffordable and arithmetic gives the same answer.',
      'The clamp to capacity is load-bearing — without it an idle key banks an unbounded burst.',
      'Clamp elapsed to non-negative, because wall clocks step backwards.',
      'Return a decision, never a boolean: a refused client with no hint retries immediately.',
      'Requiring retryAfterMs proves the interface fits all four algorithms, not just the first.',
      'Precise retry-after values synchronise clients, so jitter belongs on one side or the other.',
      'One entry per key means the key space is the memory bound — and a caller-supplied key is an attack.',
      'A full bucket is indistinguishable from no bucket, so idle keys drop for free.',
      'Evicting an active key grants a free burst, so evict the most-refilled rather than the least-recent.',
      'Per-key locking costs nothing semantically here, because keys are genuinely independent.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A per-key allowance enforced behind one interface that takes the current time and a cost and returns a decision carrying either the remaining allowance or a retry-after, with a token bucket refilled lazily from elapsed time as the default algorithm.',
    whyItExists:
      'Because a limiter must be correct at a window boundary, testable without sleeping, robust to a clock stepping backwards, and bounded in memory against a key space it does not control — and all four of those are decided by the interface rather than the algorithm.',
    whenToUse: [
      'Token bucket by default, because burst and sustained rate are separate knobs.',
      'Sliding window counter when a boundary burst is unacceptable and memory is tight.',
      'Sliding log when the limit must be exact and N is small.',
      'Fixed window only when a 2N instantaneous burst is acceptable.',
      'Per-key locking or compare-and-set whenever the check and write must be atomic.',
    ],
    whenNotToUse: [
      'A boolean return.',
      'An internal wall clock, with or without an optional injection.',
      'A background timer refilling buckets.',
      'Lazy refill without the clamp to capacity.',
      'An unbounded state map keyed by anything a caller supplies.',
      'LRU eviction of limiter state.',
      'Consuming from composed limits as you check them.',
      'A route cost table inside the limiter.',
    ],
    alternatives: [
      'A shaper that delays rather than refuses — which needs a bounded queue, a deadline and a discipline, and still needs the refusal path.',
      'Local buckets holding a share of a global allowance, to avoid a round trip per request.',
      'Time sourced inside the store\'s atomic script, to remove clock skew between servers.',
      'A peek method plus check-all-then-consume-all, for composing several limits fairly.',
      'A limiter per rule with a composition step, rather than one limiter expressing every rule.',
    ],
    tradeoffs: [
      'Token bucket buys a designed burst and costs two parameters instead of one.',
      'A sliding log buys exactness and costs memory proportional to the limit.',
      'Lazy refill buys free idle keys and requires the capacity clamp.',
      'The clock as a parameter buys testable boundaries and costs a caller obligation.',
      'A decision object buys correct client backoff and creates a synchronised herd.',
      'Per-entry expiry buys bounded memory for free, because a full bucket equals no bucket.',
      'Shared distributed state buys one true limit and costs a round trip on the hot path.',
    ],
    failureModes: [
      'A 2N burst at a fixed-window boundary, chosen by accident.',
      'An idle key banking an unbounded burst, from a missing clamp.',
      'A backward clock step making a window never expire, or expire instantly.',
      'A boolean return turning the limiter into a load amplifier.',
      'Every refused client retrying at the same instant.',
      'Unbounded state driven by a caller-supplied key.',
      'A free burst granted by evicting a throttled key.',
      'A read-decide-write race admitting two requests on one token.',
      'Composed limits sharing a key, halving the effective allowance.',
      'Composed limits consuming before a later rule refuses, draining an unused allowance.',
      'Twelve servers enforcing twelve independent limits.',
      'A limiter failing closed and taking down the service it protects.',
    ],
    followUpQuestions: [
      'What is the maximum instantaneous rate this permits?',
      'How much memory does one key cost?',
      'Is the clock a parameter, and is elapsed clamped?',
      'Is the refill lazy, and is it clamped to capacity?',
      'What does a refusal tell the caller?',
      'How does this algorithm compute retry-after?',
      'What bounds the state map, and who controls the key?',
      'What does evicting an active key do to the limit?',
      'Is the check-and-write atomic?',
      'How many rules are there, and do they share keys?',
      'What happens when the shared store is unreachable?',
    ],
  },
});
