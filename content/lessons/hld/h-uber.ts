import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-uber',
  title: 'Design Uber',
  summary:
    'Two write paths with opposite requirements: a 1.25 million per second stream of disposable driver locations, and a small number of trip transitions that must never be lost or duplicated. Conflating them is the design mistake.',
  phase: 'hld',
  module: 'advanced-designs',
  position: 50,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 95,
  tags: ['write-paths', 'geospatial', 'contention', 'state-machine', 'surge'],
  prerequisites: ['h-media-streaming'],
  resources: [
    {
      key: 'uber-h3-docs',
      tier: 'must',
      note: 'Read the sections on cell indexing and on why hexagons. The uniform neighbour distance is the property that makes ring queries behave predictably, and that is the reason to prefer hexes over squares.',
    },
    {
      key: 's2-geometry',
      tier: 'must',
      note: 'The alternative: a space-filling curve over a sphere producing hierarchical cell ids. Read it alongside H3 so you can say why you picked one — the honest answer is usually about neighbour semantics rather than accuracy.',
    },
    {
      key: 'redis-data-types',
      tier: 'must',
      note: 'The location store is a keyspace of small mutable values with a TTL. Read the sorted-set and expiry sections — the whole driver-location tier is those two primitives applied at 1.25 million writes per second.',
    },
    {
      key: 'xstate-statecharts',
      tier: 'good',
      note: 'Read it for explicit states and guarded transitions. A trip is the clearest example of a domain where an implicit state machine spread across boolean columns produces bugs you cannot reason about.',
    },
    {
      key: 'postgres-explicit-locking',
      tier: 'good',
      note: 'Read it for the difference between a lock that serialises and a conditional update that fails. Matching contention is solved by the latter, and knowing why is most of the answer.',
    },
    {
      key: 'kleppmann-redlock',
      tier: 'advanced',
      note: 'Read it for why a distributed lock cannot make an operation safe on its own. It is the argument that an offer must be enforced by a conditional write on the driver record rather than by holding a lock.',
    },
  ],

  intuition: {
    body: `This design has **two write paths with opposite requirements**, and almost every mistake comes from treating them as one.

**Path one: driver locations.** Five million active drivers reporting every four seconds is **1.25 million writes per second** — the largest write volume in the system by three orders of magnitude. And every one of those writes is **disposable**: a location from twelve seconds ago has no value, nobody will ever audit it, and losing one costs nothing because another arrives in four seconds.

**Path two: trip transitions.** Twenty million trips a day is a few hundred writes per second. And every one of those writes is **precious**: a lost "trip completed" means an unbilled ride, a duplicated "driver accepted" means two riders in one car, and every transition must be reconstructable months later for a dispute.

**A million disposable writes per second, and a few hundred that must never be lost.** Put them in the same store and you get the worst of both — a durable, replicated, audited database taking 1.25 million writes per second of data it will throw away, which is enormously expensive and still too slow.

**So: locations go to an in-memory store with a TTL, trips go to a durable transactional store.** That split is the design's spine.

Then the part that is genuinely hard: **matching is a contention problem, not a search problem.**

Finding the nearest drivers is a geospatial query and it is the easy half. The hard half is that **two riders can be matched to the same driver simultaneously**, and the system must guarantee exactly one wins. **That is not solved by a faster query** — it is solved by making the driver record the arbiter, with a conditional write that fails for the loser.

And **the offer must be exclusive but time-bounded.** A driver who is offered a trip cannot be offered another until they accept or decline, but they might close the app instead — so the exclusivity has to expire on its own.

**And surge is a control loop.** Not a pricing formula but a feedback system: prices rise where demand exceeds supply, which changes both demand and supply, which changes the price. **A feedback loop with a delay oscillates unless it is damped**, and that is the design consideration rather than the multiplier arithmetic.

Carry three things: **split the write paths by durability requirement, treat matching as contention, and recognise surge as feedback control.**`,
    analogyLimit:
      '"It is a search problem — find the nearest driver" is where most answers go wrong. The nearest-driver query is the easy half and a cell index handles it. The hard half is that two riders can be offered the same driver at the same instant, and no amount of query performance resolves that. The framing also hides the volume asymmetry: the location stream is a million times larger than the trip stream and needs none of its guarantees.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team designs a ride-hailing backend: driver locations written to a PostgreSQL table with a PostGIS index, matching by selecting the nearest available driver and updating its row, and trip state tracked with boolean columns on the trip row. Identify four failures and rank them.',
      answer: `**Failure 1 — the location table destroys the database, and this is the largest failure.**

\`\`\`
5 million active drivers × 1 update / 4 s = 1.25 million writes/s
Each write updates an indexed geospatial column
→ index maintenance on every write
→ WAL for every write
→ replication of every write
→ vacuum pressure from 1.25 M row versions/s
\`\`\`

**A single PostgreSQL instance handles tens of thousands of writes per second, not a million.** Sharding by driver helps the write volume and destroys the query: "drivers near this point" now touches every shard.

**And the deeper wrong is paying for durability on data that is worthless in four seconds.** WAL, replication, backups, MVCC row versions — all of that machinery exists to never lose a write, and every location write is one you would happily lose.

*The fix:* **an in-memory store keyed by cell, with a TTL.** A driver's location is a small mutable value that expires if not refreshed, which means **stale drivers disappear without a cleanup job** — the expiry *is* the liveness mechanism.

**Failure 2 — the nearest-driver query is the wrong shape, and it gets worse as it succeeds.**

A geospatial nearest-neighbour query scans an index ordered by distance. It works, and it has three problems at scale:

**It contends with the write stream.** 1.25 million writes per second against the same index the reads use.

**It cannot be sharded usefully.** Nearest-neighbour over a shared space needs the space, so either every shard is queried or the space is partitioned — and partitioning the space is exactly what a cell index does, so you end up there anyway.

**It returns the wrong thing.** The nearest driver by straight-line distance is not the best match; a driver 200 m away across a river is worse than one 800 m away on the same road.

*The fix:* **bucket drivers into fixed cells and query the cell plus its neighbour ring.** The query becomes a handful of key lookups rather than an index scan, which is a different cost class — and it shards perfectly, because a cell id is a partition key.

**Failure 3 — matching by "select nearest, then update" produces double-matched drivers.**

\`\`\`
Rider A                          Rider B
SELECT nearest available → D     SELECT nearest available → D
UPDATE driver SET busy           UPDATE driver SET busy
→ both succeed
→ two riders assigned driver D
\`\`\`

**This is the read-modify-write race**, and it is the same bug as the inventory oversell. Two readers see an available driver and both claim it.

*The fix has two parts.*

**Make the claim conditional.** \`UPDATE drivers SET state='offered', offer_id=X WHERE id=D AND state='available'\` — **the loser's update affects zero rows and it knows it lost.** The driver record is the arbiter and the database's atomicity does the work. No lock, no coordination.

**And make the claim expire.** An offered driver who never responds — app closed, phone dead — must not be locked out permanently. **So the offer carries a deadline**, and a driver whose offer has expired returns to available.

*Why not a distributed lock:* a lock's holder can be paused or partitioned while believing it still holds the lock, so **a lock does not make the claim safe — a conditional write on the resource itself does.** The lock would be an optimisation that reduces contention, not the correctness mechanism.

**Failure 4 — boolean columns for trip state permit states that cannot exist.**

\`\`\`
is_accepted, is_driver_arrived, is_started, is_completed, is_cancelled
→ 32 combinations, of which perhaps 6 are legal
→ is_completed AND is_cancelled: what does that mean?
→ is_started AND NOT is_accepted: how did that happen?
\`\`\`

**Every query then defends against illegal combinations**, and the defence is spread across the codebase rather than stated once. And there is no record of *how* the trip got to its current state, which is what a dispute needs.

*The fix:* **an explicit state column with guarded transitions**, plus an append-only transition log. A transition is legal only from specific prior states, which makes the invalid combinations unrepresentable — and **the log is the audit trail**, recording who caused each transition and when.

**Ranking. Failure 1 is an outage: the database cannot take the write volume**, so nothing else in the system matters. Failure 3 is a correctness bug that assigns two riders to one car, which is visible and damaging but does not stop the service. Failure 2 is a scaling ceiling reached shortly after failure 1 is fixed. Failure 4 is a maintainability and dispute-resolution problem that will produce a data-integrity incident eventually.

**The unifying observation:** three of the four come from **using one storage strategy for two workloads with opposite requirements.** The locations needed no durability and got all of it; the trips needed strict state discipline and got none.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
A rider requests a ride from a pickup to a destination
The system matches a nearby available driver
A driver receives an offer and accepts or declines it
Both parties see the other's live location during the trip
The trip progresses through arrival, start, and completion
Fares are computed and charged at completion
Pricing responds to local supply and demand
Either party can cancel, with defined consequences
\`\`\`

**The clarifying questions that change the design:**

**How many active drivers, and how often do they report?** *5 million at peak, every 4 seconds.* **The number that determines the storage split** — 1.25 million writes/s of disposable data.

**Must a driver ever be assigned two riders?** *Never.* Makes matching a contention problem with a correctness requirement.

**Is an offer exclusive?** *Yes, and time-bounded* — so the exclusivity must expire on its own.

**Is trip history auditable?** *Yes, for years.* Forces an append-only transition log distinct from current state.

**Does pricing adjust in real time?** *Yes, per area.* A feedback loop rather than a lookup.

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Location ingest | 1.25 M writes/s | In-memory, TTL, no durability |
| Match latency | p99 under 2 s end to end | Cell lookups, not index scans |
| Nearby-driver query | p99 under 50 ms | Cell plus ring, a few key reads |
| Double-match rate | Exactly zero | Conditional write on the driver record |
| Trip transition durability | No loss, no duplication | Transactional, idempotent |
| Live location to rider | Under 5 s staleness | Push, not poll |
| Trip audit retention | Years | Append-only log, separate from state |

**Out of scope:** routing and ETA computation (assume a routing service), payments beyond charging at completion, driver onboarding, and fraud detection.

## Step 2 — Estimation

\`\`\`
Active drivers (peak):   5 million
Location interval:       4 s
→ 1.25 million writes/s

Trips per day:           20 million
→ 230/s average, ~800/s peak
Match attempts:          ~1.3× trips (declines, retries) → ~1,000/s peak
\`\`\`

**The asymmetry is the whole point: 1.25 million against 1,000.** Location writes outnumber trip events by more than a thousand to one, and they need none of the trip events' guarantees.

**Location storage:**

\`\`\`
Per driver: driver_id, lat, lng, cell_id, heading, updated_at
            ≈ 64 bytes
5 M drivers × 64 B = 320 MB
\`\`\`

**320 megabytes.** The entire live location state of a global fleet fits in memory on one machine — **which is why the in-memory decision is easy** rather than a trade-off. It is partitioned for throughput, not for capacity.

**Trip storage:**

\`\`\`
Per trip: ~500 bytes of state + ~10 transitions × 100 bytes
          ≈ 1.5 KB
20 M/day × 1.5 KB = 30 GB/day = ~11 TB/year
\`\`\`

**11 TB/year of durable, audited data** — substantial but ordinary, and it is what the transactional store is for.

**Read volume during trips:**

\`\`\`
Concurrent trips: 20 M/day × 15 min average ÷ 86,400 s
                  = ~200,000 concurrent
Each rider watching the driver's location: 1 update / 4 s
→ 50,000 pushes/s
\`\`\`

**50,000 pushes per second to riders**, which is a connection-management problem rather than a storage one — and it is why this is push over a persistent connection rather than polling.

\`\`\`
Nearby-driver query cost:
  1 cell + 2 rings ≈ 19 cells
  Each cell: one key lookup returning its driver set
→ ~19 reads per match attempt × 1,000/s = 19,000 reads/s
\`\`\`

**19,000 reads per second against an in-memory store is trivial.** The geospatial query, done this way, is not a performance concern at all — which is the point of choosing the cell representation.

## Step 3 — API design

\`\`\`
Driver
  POST /drivers/location  { lat, lng, heading }     (every 4 s)
  POST /offers/{id}/accept                          → trip, or 409 if taken
  POST /offers/{id}/decline
  POST /trips/{id}/arrived
  POST /trips/{id}/start
  POST /trips/{id}/complete  { finalLat, finalLng }

Rider
  POST /rides  { pickup, destination }
       → { rideId, status: 'matching', priceEstimate }
  GET  /rides/{id}                     → status, driver, ETA
  WS   /rides/{id}/stream              → driver location, state changes
  POST /rides/{id}/cancel

Internal
  GET  /drivers/nearby?cell=&rings=2   → candidate drivers
\`\`\`

**Five decisions worth defending.**

**Location is fire-and-forget with no response body**, and **the client must not retry a failed update** — a fresher one is four seconds away, so retrying adds load to deliver worse data.

**\`POST /rides\` returns \`matching\`, not a driver.** Matching may involve several offers, so the outcome arrives over the stream. **A synchronous match would hold a connection open through multiple driver decisions.**

**Accepting an offer can return 409**, because the offer may have expired or been claimed. **The conflict is a normal outcome**, presented as "no longer available" rather than a failure.

**Transitions are separate endpoints, not a \`PATCH\` with a state field.** \`POST /trips/{id}/start\` names an event and the server decides if it is legal. **A client that sets state directly can set an illegal state.**

**The rider gets a stream, not polling.** 200,000 concurrent trips polling every 4 s is 50,000 requests/s of mostly-unchanged data.

## Step 4 — Data model

\`\`\`
IN MEMORY — disposable, TTL 30 s
  driver:{id}          → { lat, lng, cell, heading, state }
  cell:{cell_id}       → SET of driver ids  (available drivers only)
  offer:{id}           → { driver_id, ride_id, expires_at }  TTL 15 s

DURABLE — transactional
  drivers(driver_id, ..., state, current_offer_id, offer_expires_at)
  trips(
    trip_id, rider_id, driver_id, state,
    pickup, destination, requested_at, price_quote
  )
  trip_transitions(              -- append only, the audit trail
    trip_id, seq, from_state, to_state, actor, at, metadata
  )
  PRIMARY KEY (trip_id, seq)

  trip_locations(trip_id, at, lat, lng)   -- sampled, for disputes
    PARTITION BY RANGE (at)

SURGE — in memory, recomputed periodically
  surge:{cell_id}      → multiplier
\`\`\`

**Four decisions worth defending.**

**The driver's authoritative state is durable; their location is in memory.** Different facts with different requirements: **"where is this driver" is disposable, "is this driver already assigned" is not.** Splitting them looks like duplication and is the central decision.

**\`cell:{cell_id}\` holds only available drivers**, maintained as they move or change state. **The set is the index**, built on write rather than computed on read.

**\`trip_transitions\` is append-only with a sequence per trip.** The state on \`trips\` is a cache of the last transition — **derivable, but stored because every read needs it.** The log answers "how did this trip get here".

**\`trip_locations\` is sampled.** Storing 1.25 M locations/s durably was failure 1; a sample per active trip every 15 s is a few thousand writes/s and enough to reconstruct a route. **A deliberate fidelity choice.**

## Step 5 — Architecture

\`\`\`
Driver app ──location every 4 s──▶ ┌─────────────────────┐
                                   │ Location ingest      │
                                   │ (stateless, sharded  │
                                   │  by driver id)       │
                                   └──────────┬───────────┘
                                              │ write + cell move
                                   ┌──────────▼───────────┐
                                   │ In-memory geo store  │
                                   │ driver:{id} TTL 30 s │
                                   │ cell:{id} → drivers  │
                                   └──────────┬───────────┘
Rider app ──POST /rides──▶ ┌───────────────┐  │ cell + ring reads
                           │ Match service │◀─┘
                           └──────┬────────┘
                                  │ conditional claim
                           ┌──────▼─────────────────────┐
                           │ Trip service (durable)      │
                           │ state machine + transitions │
                           └──────┬──────────────────────┘
                                  │ events
        ┌─────────────────────────┼──────────────────────┐
        ▼                         ▼                      ▼
  Push gateway            Surge controller         Billing
  (WS to riders)          (per-cell loop)          (at completion)
\`\`\`

**Why location ingest is a separate stateless tier.** It absorbs 1.25 M writes/s doing one thing: write a location, move the driver between cell sets. **Sharded by driver id, so linearly scalable**, and it shares nothing with matching.

**Why the match service reads memory and writes durably.** The search is cheap and in-memory; the claim is durable and conditional. **The two halves cross exactly once**, at the claim.

**Why the trip service owns the state machine.** **A state machine enforced in two places is not enforced.**

**Why surge is a separate loop.** **Making it a loop rather than a request-path computation is what allows damping** — a per-request value cannot be smoothed over time.

## Step 6 — The deep dive: cells, contention, and the feedback loop

**Cell indexing, and why hexagons.**

The requirement is "drivers within roughly 2 km of this point", answered by key lookups rather than a scan. So partition the surface into fixed cells, keep a driver set per cell, and read the containing cell plus rings of neighbours.

**Squares have a defect that matters here: their neighbours are at two different distances.** Edge-neighbours are closer than corner-neighbours, so **a one-ring query covers an irregular area** and the search radius depends on direction.

**Hexagons have six neighbours, all equidistant**, so ring \`k\` is an approximately circular band and **expanding by one ring means the same thing in every direction.** That predictability is the reason to prefer hexes — not accuracy, which is comparable.

\`\`\`
Cell size choice:
  Too large  → each cell holds thousands of drivers; you fetch and
               filter far more candidates than needed
  Too small  → a 2 km radius spans many rings; more lookups
  Target     → a few tens of drivers per cell in a dense city
\`\`\`

**And density varies enormously**: a cell sized for a dense centre holds one driver in a suburb. *Two responses:* **query more rings where density is low**, or **use a coarser resolution outside dense areas.**

*I would adapt the ring count*, because one grid is much simpler to operate and the expansion loop is one the matcher already needs when the first ring is empty.

**Matching under contention, concretely.**

\`\`\`
1. Read cell + rings → candidate driver ids from memory
2. Rank candidates (ETA from the routing service, not distance;
   driver rating; time since last trip)
3. Claim the top candidate:
     UPDATE drivers
        SET state = 'offered', current_offer_id = :o,
            offer_expires_at = now() + 15 s
      WHERE driver_id = :d
        AND state = 'available'
   → 0 rows: someone else claimed them; try the next candidate
   → 1 row: the offer is ours
4. Push the offer to the driver; wait up to 15 s
5. Accept  → transition the trip, driver state = 'on_trip'
   Decline → release the driver, offer the next candidate
   Timeout → release the driver, offer the next candidate
\`\`\`

**Three things this gets right.**

**The conditional update is the entire concurrency control.** One matcher's update matches the \`state = 'available'\` predicate; the other matches nothing. **Row-level atomicity does the work, with no lock and no coordination protocol.**

**The offer expiry is stored, not held.** A driver whose app died is released by any later read that notices the deadline, or by a sweeper. **Nothing depends on a process staying alive**, which is the failure mode a held lock has.

**Ranking is by ETA, not distance.** A driver 800 m away on the same road beats one 200 m away across a river. **The cell query's job is to reduce thousands to a few tens worth an ETA computation.**

*And why not a distributed lock:* a lock holder can be paused or partitioned while believing it holds the lock, so **the lock cannot be the correctness mechanism** — the conditional write on the driver row can. A lock would only reduce wasted claim attempts.

**Sequential offers versus broadcast.** Broadcasting to five is fast and creates four disappointed drivers plus a race. **Sequential with a 15-second deadline**, because losing a race repeatedly is corrosive for drivers — and the common case, where the first accepts, is fast.

**Surge as a control loop, and the oscillation it must avoid.**

\`\`\`
Every 60 s, per cell:
  demand = ride requests in the last 5 min
  supply = available drivers now
  target_multiplier = f(demand / supply)
  new = old + α × (target − old)        -- damping, α ≈ 0.3
  clamp to [1.0, cap]
\`\`\`

**Why a loop and not a formula per request.** Price changes both demand and supply: a higher price suppresses requests and attracts drivers, which lowers the ratio, which lowers the price, which raises demand again. **A feedback loop with a delay — drivers take minutes to move — oscillates unless damped**, and the damping term is what prevents a cell flapping between 1.0 and 2.5 every minute.

**Three mechanisms the loop needs.** **Damping**, moving a fraction of the way to the target. **A minimum hold time**, so the multiplier a rider is quoted is honoured for a minute or two regardless of what the loop does next. And **a cap**, because an unbounded multiplier during an emergency is a reputational event rather than market clearing.

*The trade:* the price lags a spike by minutes. **That is the right direction** — an oscillating price is worse for both sides than a lagging one.

## Step 7 — What breaks at 10×

**50 million drivers, 200 million trips/day, 12.5 million location writes/s.**

**Location ingest at 12.5 million writes/s** exceeds a single in-memory tier. *Fix:* shard the geo store **by cell region** rather than by driver, so that a cell-plus-ring query stays within one shard in the common case — accepting that queries near a shard boundary touch two.

**Cell set updates become the hot path.** A driver crossing a cell boundary is two set operations, and at 12.5 million updates per second many drivers cross constantly. *Fix:* **only update the cell set when the cell actually changes**, which the ingest tier can detect cheaply by comparing to the previous cell — turning most writes into a single value update.

**Trip transitions reach ~10,000/s durable writes** with an 110 TB/year log. *Fix:* partition trips by region, and move the transition log to a partitioned append-only table with a retention policy that archives beyond the regulatory window.

**Push fan-out reaches 500,000/s** to riders. *Fix:* regional push gateways, and reduce the location push rate during steady-state driving — a rider watching a car on a highway does not need 4-second granularity.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Geo store loses a shard | Drivers in those cells invisible | **Drivers re-report within 4 s**, so the store refills itself. Matches in that area fail for seconds |
| Location ingest degraded | Stale driver positions | Matches use stale locations; TTL removes drivers after 30 s, so the fleet appears to shrink rather than teleport |
| Routing service down | No ETA for ranking | **Fall back to straight-line distance** — worse matches, still matching |
| Two matchers claim one driver | One must lose | The conditional update makes the loser's write affect zero rows; it tries the next candidate |
| Driver app dies mid-offer | Driver locked out | \`offer_expires_at\` releases them in 15 s without any process staying alive |
| Trip service down | No transitions | **Trips in progress continue physically**; the driver app queues transitions and replays them, which requires idempotent transitions |
| Duplicate transition replay | Double completion | Rejected by the state machine: \`complete\` is illegal from \`completed\`, and the transition log's \`(trip_id, seq)\` key rejects the duplicate |
| Surge controller stops | Multipliers freeze | **Frozen at the last value**, which is safe; quotes remain honoured |

**Three rows carry the content.**

**Losing the geo store is nearly free**, a direct consequence of the disposability decision. **It refills itself from the 4-second reporting cycle** — no restore, no replay, no backup, all three of which a durable store would need.

**The offer expiry being a stored value rather than a held lock** makes a dead driver app harmless.

**Transitions must be idempotent because the driver app will replay them.** A driver completing a trip in a tunnel retries until it succeeds, and the retry must not bill twice. **The state machine rejects illegal transitions and the sequence key rejects duplicates** — two defences, because this one is money.

## Step 9 — Defending it

**"The design turns on one observation: there are two write paths with opposite requirements.**

**Driver locations are 1.25 million writes per second of disposable data.** No durability, no audit, no replication — an in-memory store with a 30-second TTL, where **the expiry is the liveness mechanism and losing a shard costs seconds** because drivers re-report every 4 seconds. **Trip transitions are a few hundred writes per second that must never be lost or duplicated**, so they get a transactional store, an explicit state machine, and an append-only log that answers disputes years later. Conflating those two is the mistake that breaks the database.

**Matching is contention, not search.** Cell-plus-ring lookups reduce the fleet to a few tens of candidates for the price of nineteen key reads, then ranking uses ETA rather than distance because a driver across a river is not close. **The claim is a conditional update on the driver row** — the loser's write affects zero rows — and the offer's expiry is a stored deadline, so nothing needs to stay alive to release a driver whose app died. **A distributed lock would not make this safe**, because a lock holder can be paused while believing it holds the lock.

**And surge is a damped control loop rather than a formula**, because price changes both demand and supply with a delay, and an undamped loop with a delay oscillates. The quote is held for the rider, and the multiplier is capped.

**What I gave up:** driver locations older than 30 seconds are simply gone; trip routes are sampled rather than complete; surge lags real conditions by a few minutes; and cell size is fixed, so sparse areas need more ring expansions.

**What would make me revisit it:** if location history became a product requirement — driver behaviour scoring, insurance telemetry — the disposability assumption breaks and I would add a separate durable pipeline for a sampled stream rather than making the live store durable. And if matching had to consider multi-rider pooling, the contention model changes from one driver per rider to a combinatorial assignment, which is a different problem."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'two-paths',
      title: 'A million disposable writes and a few hundred precious ones',
      caption:
        'Step through it. The two write paths never share a store, and they cross exactly once — at the conditional claim that resolves contention.',
      nodes: [
        { id: 'driver', label: 'Driver app', kind: 'client', x: 0, y: 40, detail: 'Reports location every 4 seconds and must NOT retry a failed report — a fresher one is 4 seconds away, so retrying adds load to deliver worse data.' },
        { id: 'ingest', label: 'Location ingest (sharded)', kind: 'service', x: 210, y: 40, detail: '1.25 million writes/s, stateless, sharded by driver id. Does two things: write the location and move the driver between cell sets when their cell actually changes.' },
        { id: 'geo', label: 'In-memory geo store (TTL 30 s)', kind: 'store', x: 440, y: 40, detail: '320 MB holds a global fleet\'s live positions. The TTL is the liveness mechanism — stale drivers vanish with no cleanup job — and losing a shard costs seconds because it refills itself.' },
        { id: 'rider', label: 'Rider app', kind: 'client', x: 0, y: 200, detail: 'POST /rides returns "matching", not a driver. Matching may involve several sequential offers, so the outcome arrives over the stream rather than in the response.' },
        { id: 'match', label: 'Match service', kind: 'service', x: 210, y: 200, detail: 'Reads cell plus 2 rings — about 19 key lookups — to reduce the fleet to a few tens of candidates, then ranks by ETA rather than distance. Distance is cheap; ETA is what the rider experiences.' },
        { id: 'claim', label: 'Conditional claim on the driver row', kind: 'note', x: 440, y: 200, detail: 'UPDATE ... WHERE state = \'available\'. The loser\'s update affects zero rows and knows it lost. Row-level atomicity is the entire concurrency control — a distributed lock could not make this safe, because a holder can be paused while believing it holds the lock.' },
        { id: 'trip', label: 'Trip service (state machine)', kind: 'service', x: 690, y: 200, detail: 'One component owns the legal transition graph. A state machine enforced in two places is not enforced. Transitions are idempotent because the driver app replays them from tunnels.' },
        { id: 'log', label: 'trip_transitions (append only)', kind: 'store', x: 690, y: 60, detail: 'Keyed (trip_id, seq). Answers "how did this trip get here", which a state column cannot — and the sequence key rejects duplicate replays, the second defence on a path that moves money.' },
        { id: 'surge', label: 'Surge controller (damped loop)', kind: 'service', x: 690, y: 340, detail: 'Runs on a timer, not per request, because damping requires smoothing over time. Price changes both demand and supply with a delay, and an undamped delayed loop oscillates.' },
      ],
      edges: [
        { id: 'u1', source: 'driver', target: 'ingest', kind: 'write' },
        { id: 'u2', source: 'ingest', target: 'geo', kind: 'write' },
        { id: 'u3', source: 'rider', target: 'match', kind: 'sync' },
        { id: 'u4', source: 'match', target: 'geo', kind: 'read' },
        { id: 'u5', source: 'match', target: 'claim', kind: 'control' },
        { id: 'u6', source: 'claim', target: 'trip', kind: 'write' },
        { id: 'u7', source: 'trip', target: 'log', kind: 'write' },
        { id: 'u8', source: 'trip', target: 'surge', kind: 'control' },
      ],
      steps: [
        {
          id: 'us1',
          title: 'A million disposable writes per second',
          description:
            'Locations go to memory with a TTL. No WAL, no replication, no backups — because a location from twelve seconds ago has no value and losing one costs nothing.',
          nodes: ['driver', 'ingest', 'geo'],
          edges: ['u1', 'u2'],
        },
        {
          id: 'us2',
          title: 'The geospatial query is the easy half',
          description:
            'Cell plus two rings is about 19 key lookups against an in-memory store — 19,000 reads/s at peak, which is nothing. Hexagons because ring k is the same distance in every direction.',
          nodes: ['rider', 'match'],
          edges: ['u3', 'u4'],
        },
        {
          id: 'us3',
          title: 'The hard half is that two riders can claim one driver',
          description:
            'A conditional update on the driver row resolves it: one matcher\'s predicate matches, the other\'s affects zero rows. And the offer deadline is a stored value, so nothing must stay alive to release a dead app\'s driver.',
          nodes: ['claim'],
          edges: ['u5'],
        },
        {
          id: 'us4',
          title: 'And a few hundred writes that must never be lost',
          description:
            'Trip transitions get a transactional store, guarded transitions, and an append-only log keyed by sequence — two independent defences against a replayed completion, because this path is money.',
          nodes: ['trip', 'log'],
          edges: ['u6', 'u7'],
        },
        {
          id: 'us5',
          title: 'Surge is feedback control, not arithmetic',
          description:
            'A damped loop on a timer, with a held quote and a cap. Damping means the price lags a spike by minutes, which is far better than flapping between 1.0 and 2.5 every minute.',
          nodes: ['surge'],
          edges: ['u8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'trip-states',
      title: 'The trip state machine, and what boolean columns permit',
      caption:
        'Every arrow is a legal transition; anything not drawn is rejected. Five boolean columns would permit 32 combinations, of which six are legal — and the illegal ones then have to be defended against in every query.',
      code: `stateDiagram-v2
    [*] --> requested: rider requests

    requested --> matching: quote accepted
    matching --> offered: **conditional claim<br/>succeeds**
    matching --> no_drivers: rings exhausted

    offered --> matching: decline / **offer expires**
    offered --> accepted: driver accepts

    accepted --> arrived: driver at pickup
    arrived --> in_progress: trip starts
    in_progress --> completed: **idempotent —<br/>replay rejected**

    completed --> [*]
    no_drivers --> [*]

    requested --> cancelled: rider cancels
    matching --> cancelled: rider cancels
    offered --> cancelled: rider cancels
    accepted --> cancelled_fee: **cancellation fee**
    arrived --> cancelled_fee: fee
    cancelled --> [*]
    cancelled_fee --> [*]

    note right of offered
        The claim that got here was a
        conditional UPDATE, not a lock.
        The expiry is a stored deadline,
        so a dead driver app releases
        itself in 15 s.
    end note

    note right of completed
        Illegal from completed, so a
        replayed completion is rejected
        by the state machine AND by the
        (trip_id, seq) key. Two defences,
        because this one bills.
    end note`,
    },
  ],

  productionExample: {
    systems: ['uber'],
    body: `The published H3 documentation is the reference for the indexing half, and three of its properties explain design choices here.

**Hexagons have six neighbours, all at the same distance.** The documentation states this as the motivating property, and it is the reason to prefer hexes over squares for a proximity search. **A square grid's edge-neighbours are closer than its corner-neighbours**, so a one-ring query around a square covers an irregular area and the effective radius depends on direction. **With hexes, ring k is an approximately circular band**, which means "expand the search" behaves the same everywhere.

**Cells are hierarchical across resolutions, but hexagons do not tile perfectly into larger hexagons.** The documentation is explicit that the parent-child relationship is approximate, unlike a square quadtree where four children exactly compose a parent. **That is the cost of the neighbour property**, and it matters if you aggregate across resolutions — which is why the design here uses one resolution and adapts the ring count instead.

**Cell ids are integers encoding resolution and position.** So a cell id is directly usable as a partition key, a map key, and a set name — **which is what makes the "cell set of available drivers" representation cheap.** The geospatial structure lives entirely in the key.

**Three transferable lessons.**

**Choose the grid for its query semantics, not its accuracy.** H3 and S2 are comparable in precision. The distinguishing question is what a neighbour query means, and hexes give a cleaner answer for proximity search.

**Turn the geospatial problem into a key-value problem.** Once drivers are bucketed by cell, "who is nearby" is a handful of set reads rather than an index scan — **and it shards perfectly, because the cell id partitions the space.**

**One resolution plus adaptive ring count beats multiple resolutions.** Density varies by orders of magnitude between a city centre and a suburb, and the simpler response is to expand rings where candidates are scarce rather than operate two grids.

**Where the reference does not help.** H3 solves indexing, which the estimation shows is the cheap part — 19,000 reads per second. **The hard parts of this design are contention and feedback control, and neither is geospatial.** A candidate who spends the whole interview on the grid has answered the easy question thoroughly.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, several of which follow from the volume asymmetry between the two write paths.',
    rows: [
      {
        option: 'Driver locations in a durable geospatial database',
        whenItWins:
          'When location history is itself a product requirement — telemetry, behaviour scoring.',
        whenItLoses:
          'At 1.25 M writes/s of data worthless in four seconds. WAL, replication, MVCC and vacuum all exist to never lose a write you would happily lose.',
        cost:
          'Two to three orders of magnitude more write capacity than needed, and it still cannot keep up.',
      },
      {
        option: 'In-memory location store with a TTL',
        whenItWins:
          'The right answer. 320 MB for a global fleet, the expiry is the liveness mechanism, and a lost shard refills itself in four seconds.',
        whenItLoses:
          'If location history were needed, which would require a separate sampled durable pipeline.',
        cost:
          'Anything older than 30 seconds is gone.',
      },
      {
        option: 'Geospatial nearest-neighbour index query',
        whenItWins:
          'Low write volumes, where index maintenance is not the bottleneck.',
        whenItLoses:
          'It contends with the write stream, cannot shard without partitioning the space anyway, and returns nearest-by-distance rather than nearest-by-ETA.',
        cost:
          'An index scan per match, on the same structure taking a million writes a second.',
      },
      {
        option: 'Cell sets plus ring expansion',
        whenItWins:
          'Always here. About 19 key reads per match, shards on the cell id, and reduces the fleet to a few tens of candidates worth an ETA call.',
        whenItLoses:
          'Fixed cell size fits one density; sparse areas need more rings.',
        cost:
          'Cell-set maintenance on every cell crossing, and a resolution choice to tune.',
      },
      {
        option: 'A distributed lock on the driver during matching',
        whenItWins:
          'Nowhere as the correctness mechanism. It can reduce wasted claim attempts.',
        whenItLoses:
          'A holder can be paused or partitioned while believing it holds the lock, so it cannot guarantee exclusivity.',
        cost:
          'Complexity and a false sense of safety, plus a lock to release when a process dies.',
      },
      {
        option: 'Conditional update on the driver row',
        whenItWins:
          'Always. Row-level atomicity resolves the race, and the loser learns it lost from a zero-row result.',
        whenItLoses:
          'Under extreme contention on one driver, several matchers waste an attempt each — which is cheap.',
        cost:
          'Nothing meaningful; the claim is a single-row conditional write.',
      },
      {
        option: 'Broadcast an offer to several drivers',
        whenItWins:
          'Matching latency, when acceptance rates are low and speed matters more than driver experience.',
        whenItLoses:
          'It creates a race among drivers and repeatedly disappoints the losers, which is corrosive.',
        cost:
          'Driver trust, plus a second contention problem between the accepting drivers.',
      },
      {
        option: 'Sequential offers with a short deadline',
        whenItWins:
          'The right default. Fair, and two candidates at 15 seconds still fit the latency budget in the common case.',
        whenItLoses:
          'When acceptance rates are very low, so many sequential offers exceed the budget.',
        cost:
          'Slower matching when the first candidates decline.',
      },
      {
        option: 'Boolean columns for trip state',
        whenItWins:
          'Nowhere. It represents states that cannot exist.',
        whenItLoses:
          'Five flags permit 32 combinations of which six are legal, and every query must defend against the rest.',
        cost:
          'Defensive logic spread across the codebase, and no record of how a trip reached its state.',
      },
      {
        option: 'Explicit state plus an append-only transition log',
        whenItWins:
          'Always. Illegal states are unrepresentable, and the log answers disputes years later.',
        whenItLoses:
          'Storage — about 11 TB/year — and a transition graph to maintain.',
        cost:
          'A write per transition, and a retention policy.',
      },
      {
        option: 'Surge computed per request',
        whenItWins:
          'Nowhere. It cannot be damped, because damping requires smoothing over time.',
        whenItLoses:
          'Price changes demand and supply with a delay, so an undamped loop oscillates.',
        cost:
          'A multiplier that flaps, which is worse for both sides than one that lags.',
      },
      {
        option: 'A damped control loop with a held quote and a cap',
        whenItWins:
          'Always. Stable prices, honoured quotes, and a bound on the reputational tail.',
        whenItLoses:
          'The price lags a genuine spike by minutes, under-pricing it.',
        cost:
          'Lag, and three parameters to tune.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Driver locations go in a table with a geospatial index, and matching selects the nearest available driver."',
      whyWeak:
        'It puts 1.25 million writes per second of disposable data into a store built to never lose a write — paying for WAL, replication, MVCC row versions and vacuum on data that is worthless in four seconds. And a single instance handles tens of thousands of writes per second, not a million.',
      strongAnswer:
        '"Locations go to an in-memory store with a 30-second TTL, keyed by driver and bucketed into cell sets. 320 MB holds a global fleet, so it is partitioned for throughput rather than capacity. The TTL is the liveness mechanism — stale drivers disappear with no cleanup job — and losing a shard costs seconds, because every driver re-reports within four. Trip transitions are a few hundred writes per second and those go to a transactional store, because they must never be lost."',
    },
    {
      weakAnswer: '"Find the nearest driver, then update their row to mark them busy."',
      whyWeak:
        'It is a read-modify-write race. Two riders can read the same available driver and both succeed in marking them busy, assigning two riders to one car — the same bug as an inventory oversell.',
      strongAnswer:
        '"The claim is a conditional update: set the driver to offered where their state is still available. One matcher\'s predicate matches and the other\'s affects zero rows, so the loser knows immediately and tries the next candidate. Row-level atomicity is the entire concurrency control — no lock, no coordination protocol. And the offer carries a stored expiry, so a driver whose app died is released in fifteen seconds without any process staying alive to release them."',
    },
    {
      weakAnswer: '"Take a distributed lock on the driver while the offer is pending."',
      whyWeak:
        'A lock holder can be paused by garbage collection or partitioned from the lock service while still believing it holds the lock, so the lock cannot guarantee exclusivity. It also needs releasing when the holder dies.',
      strongAnswer:
        '"A lock cannot be the correctness mechanism, because a holder can be paused while believing it still holds it. The conditional write on the driver row can, because the row itself is the arbiter and the check and the change are one atomic operation. A lock would only be an optimisation to reduce wasted claim attempts, and at this contention level that is not worth the machinery."',
    },
    {
      weakAnswer: '"Rank candidates by distance and offer the closest one."',
      whyWeak:
        'Straight-line distance is not what the rider experiences. A driver 200 m away across a river or on the wrong side of a motorway arrives later than one 800 m away on the same road.',
      strongAnswer:
        '"The cell query gives me distance cheaply, and its job is to reduce thousands of drivers to a few tens that are worth a real ETA computation. Then ranking uses ETA from the routing service, plus driver rating and time since their last trip. If routing is unavailable I fall back to straight-line distance — worse matches, still matching, which is the right degradation."',
    },
    {
      weakAnswer: '"Trip state is tracked with flags: accepted, arrived, started, completed, cancelled."',
      whyWeak:
        'Five flags permit 32 combinations of which perhaps six are legal, so every query must defend against combinations like completed-and-cancelled. And there is no record of how the trip reached its state, which is exactly what a dispute needs.',
      strongAnswer:
        '"An explicit state column with guarded transitions, so a transition is legal only from specific prior states and the illegal combinations are unrepresentable. Plus an append-only transition log keyed by trip and sequence, recording actor and time — that is the audit trail for disputes years later. It also gives me the second defence against a replayed completion: the state machine rejects complete-from-completed, and the sequence key rejects the duplicate row."',
    },
    {
      weakAnswer: '"Surge is demand divided by supply, computed when the rider requests a ride."',
      whyWeak:
        'Price changes both demand and supply with a delay — drivers take minutes to move — so computing it per request creates an undamped feedback loop that oscillates, flapping a cell between low and high multipliers every few minutes.',
      strongAnswer:
        '"Surge is a damped control loop running on a timer per cell: it moves a fraction of the way toward the target multiplier rather than jumping to it, because a feedback loop with a delay oscillates otherwise. The multiplier a rider is quoted is held for a minute or two regardless of what the loop does next, and it is capped. That means the price lags a genuine spike by a few minutes, which is the right trade — a flapping price is worse for both sides than a lagging one."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hu-1',
      front: 'What are the two write paths, and how do they differ?',
      back: '1.25 M location writes/s that are disposable, and a few hundred trip transitions/s that must never be lost or duplicated. Conflating them is the design mistake.',
      topic: 'write-paths',
    },
    {
      id: 'fc-hu-2',
      front: 'Why do driver locations not belong in a durable database?',
      back: 'WAL, replication, MVCC and vacuum exist to never lose a write. A location is worthless in four seconds, so all of that cost buys nothing — and a single instance cannot take a million writes/s anyway.',
      topic: 'write-paths',
    },
    {
      id: 'fc-hu-3',
      front: 'How large is the live location state of a global fleet?',
      back: 'About 320 MB — 5 million drivers × ~64 bytes. It is partitioned for throughput, not capacity, which is why the in-memory choice is easy rather than a trade-off.',
      topic: 'write-paths',
    },
    {
      id: 'fc-hu-4',
      front: 'What does the location TTL do besides bound memory?',
      back: 'It is the liveness mechanism: a driver who stops reporting disappears in 30 seconds with no cleanup job, and a lost shard refills itself from the 4-second reporting cycle.',
      topic: 'write-paths',
    },
    {
      id: 'fc-hu-5',
      front: 'Why hexagonal cells rather than square ones?',
      back: 'Six neighbours all at the same distance, so ring k is an approximately circular band and expanding the search means the same thing in every direction. A square\'s corner-neighbours are farther than its edge-neighbours.',
      topic: 'geospatial',
    },
    {
      id: 'fc-hu-6',
      front: 'What does bucketing drivers into cells turn the geospatial query into?',
      back: 'A key-value problem: cell plus two rings is about 19 set reads rather than an index scan — and the cell id shards the space perfectly.',
      topic: 'geospatial',
    },
    {
      id: 'fc-hu-7',
      front: 'How is varying driver density handled with a fixed cell size?',
      back: 'Adapt the ring count rather than the resolution — expand more rings where candidates are scarce. One grid is much simpler to operate than two.',
      topic: 'geospatial',
    },
    {
      id: 'fc-hu-8',
      front: 'What actually prevents two riders being assigned one driver?',
      back: 'A conditional update on the driver row: set offered where state is still available. The loser\'s update affects zero rows. Row-level atomicity, no lock.',
      topic: 'contention',
    },
    {
      id: 'fc-hu-9',
      front: 'Why can a distributed lock not be the correctness mechanism here?',
      back: 'A holder can be paused or partitioned while believing it still holds the lock. The resource itself must arbitrate, via an atomic conditional write.',
      topic: 'contention',
    },
    {
      id: 'fc-hu-10',
      front: 'Why is the offer expiry a stored value rather than a held lease?',
      back: 'So a driver whose app died is released without any process staying alive to release them — a subsequent read or a sweeper notices the deadline has passed.',
      topic: 'contention',
    },
    {
      id: 'fc-hu-11',
      front: 'Why rank candidates by ETA rather than distance?',
      back: 'A driver 800 m away on the same road arrives before one 200 m away across a river. The cell query cheaply reduces the fleet to a few tens worth a real ETA call.',
      topic: 'contention',
    },
    {
      id: 'fc-hu-12',
      front: 'What is wrong with boolean columns for trip state?',
      back: 'Five flags permit 32 combinations of which about six are legal, so every query defends against the rest — and nothing records how the trip reached its state.',
      topic: 'state-machine',
    },
    {
      id: 'fc-hu-13',
      front: 'What are the two independent defences against a replayed trip completion?',
      back: 'The state machine rejects complete-from-completed, and the transition log\'s (trip_id, seq) key rejects the duplicate row. Two, because this path bills.',
      topic: 'state-machine',
    },
    {
      id: 'fc-hu-14',
      front: 'Why is surge a damped loop rather than a per-request formula?',
      back: 'Price changes both demand and supply with a delay, and a delayed feedback loop oscillates unless damped. A lagging price is far better than a flapping one.',
      topic: 'surge',
    },
  ],

  quiz: [
    {
      id: 'q-hu-1',
      kind: 'scenario',
      prompt:
        'Five million drivers report location every four seconds. Where do those writes go, and why?',
      options: [
        { id: 'a', label: 'An in-memory store with a TTL — the data is disposable, so durability machinery buys nothing, and 320 MB holds a global fleet' },
        { id: 'b', label: 'A geospatial table with a spatial index, sharded by driver id' },
        { id: 'c', label: 'An append-only log, compacted periodically' },
        { id: 'd', label: 'A durable store, because losing a driver\'s location means losing the driver' },
      ],
      correct: ['a'],
      explanation:
        '1.25 million writes per second of data worthless in four seconds. WAL, replication, MVCC row versions and vacuum all exist to never lose a write, and every one of these is a write you would happily lose. Option d has the failure mode backwards: a lost location is replaced within four seconds by the reporting cycle, which is also why a lost shard refills itself.',
      difficulty: 'core',
      topic: 'write-paths',
    },
    {
      id: 'q-hu-2',
      kind: 'scenario',
      prompt:
        'Two match services simultaneously select the same available driver as their best candidate. What guarantees one loses?',
      options: [
        { id: 'a', label: 'A conditional update on the driver row — one matches the still-available predicate, the other affects zero rows and knows it lost' },
        { id: 'b', label: 'A distributed lock on the driver id, held for the offer duration' },
        { id: 'c', label: 'A queue of match requests processed one at a time' },
        { id: 'd', label: 'Nothing — the second offer simply supersedes the first' },
      ],
      correct: ['a'],
      explanation:
        'Row-level atomicity makes the check and the change one operation, so the driver record itself arbitrates. A lock cannot guarantee this because a holder can be paused or partitioned while believing it holds the lock — it would only reduce wasted attempts. A global queue would serialise all matching, which is a throughput ceiling for a problem that only needs per-driver exclusivity.',
      difficulty: 'core',
      topic: 'contention',
    },
    {
      id: 'q-hu-3',
      kind: 'scenario',
      prompt:
        'A driver is offered a trip and their phone dies. What releases them?',
      options: [
        { id: 'a', label: 'A stored offer deadline on the driver row, noticed by a later read or a sweeper — nothing needs to stay alive' },
        { id: 'b', label: 'The match service releases them when it times out waiting' },
        { id: 'c', label: 'The lock expires when its holder\'s session drops' },
        { id: 'd', label: 'The driver is released when they next report a location' },
      ],
      correct: ['a'],
      explanation:
        'Storing the deadline rather than holding a lease means no process must survive to release the claim. Option b fails if the match service also dies; option c reintroduces the lock; option d never fires, because a dead phone reports nothing — which is precisely the case being handled.',
      difficulty: 'advanced',
      topic: 'contention',
    },
    {
      id: 'q-hu-4',
      kind: 'scenario',
      prompt:
        'Why hexagonal cells rather than a square grid for driver bucketing?',
      options: [
        { id: 'a', label: 'Six neighbours all equidistant, so ring k is an approximately circular band and expanding the search means the same thing in every direction' },
        { id: 'b', label: 'Hexagons tile perfectly into larger hexagons, giving exact hierarchy' },
        { id: 'c', label: 'Hexagons are more precise at representing a point on a sphere' },
        { id: 'd', label: 'Hexagonal cell ids are smaller integers' },
      ],
      correct: ['a'],
      explanation:
        'Neighbour semantics is the reason. Option b is the opposite of true — hexagons do not tile perfectly into larger hexagons, and that approximate hierarchy is the cost paid for the neighbour property, which is why using one resolution and adapting ring count is simpler. Precision is comparable between the schemes.',
      difficulty: 'core',
      topic: 'geospatial',
    },
    {
      id: 'q-hu-5',
      kind: 'scenario',
      prompt:
        'A driver completes a trip in a tunnel; the request fails and the app retries three times. What prevents triple billing?',
      options: [
        { id: 'a', label: 'The state machine rejects complete-from-completed, and the transition log\'s (trip_id, seq) key rejects the duplicate row' },
        { id: 'b', label: 'The billing service deduplicates by trip id at charge time' },
        { id: 'c', label: 'The app suppresses retries after the first failure' },
        { id: 'd', label: 'The trip row\'s updated_at timestamp prevents a second write' },
      ],
      correct: ['a'],
      explanation:
        'Two independent defences, because this path moves money. Option b is a reasonable additional layer but puts the guarantee in the wrong place — the transition itself must be idempotent. Option c loses completions, which is the failure this retry exists to prevent. Option d is not a mechanism.',
      difficulty: 'advanced',
      topic: 'state-machine',
    },
    {
      id: 'q-hu-6',
      kind: 'multi',
      prompt:
        'A surge multiplier computed fresh on every ride request flaps between 1.0 and 2.4 every few minutes in one area. Which mechanisms address it? Select all that apply.',
      options: [
        { id: 'a', label: 'Damping — move a fraction of the way toward the target rather than jumping to it' },
        { id: 'b', label: 'Computing on a timer rather than per request, so the value can be smoothed over time' },
        { id: 'c', label: 'Holding a quoted multiplier for a minute or two so a rider\'s price stays valid' },
        { id: 'd', label: 'Increasing the cap so the multiplier has more room to settle' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The oscillation comes from an undamped feedback loop with a delay: price changes demand and supply, drivers take minutes to move. Damping and a timer-based loop address the cause; a held quote addresses the user-facing symptom. Raising the cap widens the oscillation rather than settling it — the cap bounds the reputational tail, not the stability.',
      difficulty: 'advanced',
      topic: 'surge',
    },
  ],

  exercises: [
    {
      id: 'ex-hu-1',
      kind: 'design',
      title: 'Add pooling, and watch the contention model change',
      estimatedMinutes: 40,
      prompt: `The product adds shared rides: up to three riders with separate pickups and destinations share one vehicle, and a rider may be added to a trip already in progress.

**Part 1.** Which parts of the design survive unchanged, and which break? Cover: the location tier, the cell index, the claim mechanism, the trip state machine, and surge.

**Part 2.** Matching is no longer one driver per rider. State the new problem precisely, and give a mechanism that is implementable rather than optimal.

**Part 3.** The trip state machine now has multiple riders at different stages in one vehicle. Redesign it.

**Part 4.** Name four new failure modes pooling introduces, and say what each does.

Then answer:

- The single-rider claim was a conditional update on the driver row. What is the equivalent for pooling, and what does it protect?
- Which one measurement would tell you whether pooling is working?`,
      rubric: [
        'Correctly identifies the location tier and cell index as unchanged, with reasoning.',
        'Identifies the claim mechanism as needing a capacity predicate rather than a state predicate.',
        'States the new matching problem as assignment under constraints, not nearest-neighbour.',
        'Gives an implementable greedy or incremental mechanism rather than an optimal solver.',
        'Redesigns trip state as per-rider legs plus a vehicle-level state.',
        'Names at least four pooling-specific failure modes with consequences.',
        'Answers the claim question with a conditional write including a capacity check.',
        'Names a specific measurement and says what decision it drives.',
      ],
      modelAnswer: `**Part 1 — what survives and what breaks**

**The location tier survives entirely, unchanged.** Drivers still report every four seconds; locations are still disposable; the TTL is still the liveness mechanism. **Pooling changes what a vehicle is doing, not where it is or how that is reported.** The 1.25 million writes per second and the 320 MB are identical.

**The cell index survives with one change to its contents.** Cells still bucket vehicles and ring queries still work. **But \`cell:{id}\` held *available* drivers, and "available" is now a spectrum**: a vehicle with two of three seats filled is available to some riders and not others.

*Two options:*

**Keep one set of "vehicles with any free seat" and filter after reading.** Simple, and it fetches candidates that turn out to be unsuitable — which is fine, because the cell query's job was always to reduce thousands to tens for closer evaluation.

**Keep a set per remaining-capacity level.** More precise, and now every seat change is a set move — extra write amplification on a path that already handles cell crossings.

**I would filter after reading**, because the candidate set is small by construction and the alternative adds writes to the hottest path to save a cheap filter.

**The claim mechanism breaks, and this is the most interesting change.**

The single-rider claim was:

\`\`\`sql
UPDATE drivers SET state = 'offered', ...
 WHERE driver_id = :d AND state = 'available'
\`\`\`

**The predicate \`state = 'available'\` no longer expresses the constraint.** A pooled vehicle stays claimable while it has capacity, so the check is not "is this driver free" but "does this vehicle still have a seat, *and* has its route not already been committed in a way this rider breaks".

**The mechanism survives; the predicate must change.** Detail in the Part answers below.

**The trip state machine breaks structurally.** One \`trips\` row with one state cannot represent three riders at different stages in one vehicle. **This needs restructuring rather than extending** — a fifth boolean would be exactly the mistake the original design avoided.

**Surge survives, with a caveat.** The per-cell loop, damping, held quotes and cap all still apply. **But pooling changes effective supply**: one vehicle can now serve three riders, so the same fleet has more capacity, which the supply term should reflect. *Fix:* count available *seats* rather than available vehicles. **A one-line change to the loop's input with a real effect on its output.**

---

**Part 2 — the new matching problem, and an implementable mechanism**

**Stated precisely:** given a set of pending ride requests and a set of vehicles each with a current route and remaining capacity, assign requests to vehicles so as to minimise added detour, subject to: capacity is never exceeded, no existing rider's detour exceeds a bound, and every rider's pickup happens within a bound of their request.

**That is a constrained assignment problem, and it is NP-hard in general** — vehicle routing with time windows. **So the answer is not an optimal solver**, and saying so is part of the answer.

**An implementable mechanism: greedy incremental insertion.**

\`\`\`
For a new request R:
  1. Cell + ring query → vehicles with free capacity nearby
  2. For each candidate vehicle V (a few tens):
       - Compute the best insertion of R's pickup and dropoff
         into V's existing route
       - Reject if: capacity exceeded at any point, OR any existing
         rider's total detour would exceed their bound, OR R's
         pickup would be later than R's bound
       - Score = added vehicle distance + R's own detour
  3. Rank surviving candidates by score
  4. Claim the best one conditionally (Part answer below)
  5. On claim failure, try the next
\`\`\`

**Three properties that make this the right shape.**

**It is incremental, matching how requests actually arrive.** Requests come one at a time, and a vehicle's route grows by insertion. **Batching requests for a few seconds to consider them jointly would find better assignments** and adds latency to every request — a trade worth naming but not taking by default.

**It reuses the existing pipeline exactly.** Cell query, rank a few tens of candidates, claim conditionally, fall through on failure. **The steps are the same; only the scoring and the predicate change** — which is the sign that the original decomposition was right.

**Detour bounds are hard constraints, not scoring terms.** A rider whose 15-minute trip becomes 40 minutes will not use the product again, so **that must be a rejection rather than a penalty** — otherwise a sufficiently good score can always justify it.

*What this gives up:* assignments are locally good, not globally optimal. A request arriving now may take a vehicle that a better-matched request would have used a minute later. **Accepting that is what makes the system implementable**, and batching is the knob if the loss proves material.

---

**Part 3 — the trip state machine, restructured**

**The change: split trip state into per-rider legs and a vehicle-level assignment.**

\`\`\`
pool_trips(pool_trip_id, driver_id, state, created_at)
  state: forming | active | completing | completed

trip_legs(
  leg_id, pool_trip_id, rider_id, state,
  pickup, destination, seq_pickup, seq_dropoff,
  quoted_price, quoted_detour_bound
)
  state: assigned | picked_up | dropped_off | cancelled

leg_transitions(leg_id, seq, from_state, to_state, actor, at)
  PRIMARY KEY (leg_id, seq)

pool_route(pool_trip_id, seq, kind, leg_id, location)
  kind: pickup | dropoff        -- the committed stop order
\`\`\`

**Four decisions worth defending.**

**Per-rider state lives on the leg, not the pool trip.** Each rider is independently assigned, picked up and dropped off. **The vehicle-level state is derived** — a pool trip is \`active\` while any leg is between assigned and dropped off.

**The route is explicit and ordered, in its own table.** \`pool_route\` is the committed stop sequence, and **insertion means inserting two rows and renumbering.** Making the route a first-class, ordered, stored thing is what allows the claim predicate to reason about it.

**The transition log moves to the leg.** Disputes are per-rider — "I was charged for a 40-minute ride" is a leg question. **The audit trail must be at the granularity of the thing being disputed.**

**Each leg stores its quoted detour bound.** The bound was a promise made at quote time, so **it must be recorded rather than recomputed** — a later request's insertion check must compare against what this rider was actually promised.

**The legal transitions:**

\`\`\`
Leg:  assigned → picked_up → dropped_off
      assigned → cancelled          (rider cancels before pickup)
      picked_up → cancelled         (illegal — rider is in the car)

Pool: forming → active              (first pickup)
      active → completing           (last pickup done, dropoffs remain)
      completing → completed        (last dropoff)
      forming → cancelled           (all legs cancelled before any pickup)
\`\`\`

**And the invariant worth stating: a pool trip in \`completing\` accepts no new legs.** Once the last scheduled pickup has happened, adding a rider would mean reversing direction. **That is the constraint the claim predicate enforces**, and it is why the pool trip needs a state distinct from "has capacity".

---

**Part 4 — four failure modes pooling introduces**

**1. Detour creep.** Each insertion is individually within bounds, and three successive insertions compound. **Rider A's 15-minute trip becomes 22, then 28, then 34 — each step legal, the total unacceptable.**

*What it does:* the worst experience goes to the rider who was matched first, which is exactly backwards. *Fix:* the bound is on the rider's **total** detour against their original quote, not on each insertion's marginal addition — which is why the leg stores its quoted bound.

**2. Pickup starvation.** A vehicle repeatedly picks up new riders near its current position, and a rider assigned early but geographically awkward keeps getting deferred. **The greedy scorer minimises added distance, and revisiting a distant pickup is always the expensive option.**

*What it does:* one rider waits far longer than promised while the vehicle serves convenient requests. *Fix:* a hard bound on pickup time from assignment, checked as a rejection on every subsequent insertion — and **escalating priority**, so an aging pickup starts dominating the score.

**3. Cascading cancellation.** A rider cancels after the route was optimised around their stop. **The remaining riders now have a route shaped by a rider who is gone**, including a detour that no longer serves anyone.

*What it does:* remaining riders take a detour for nothing. *Fix:* recompute the route on cancellation, dropping the cancelled stops and re-sequencing. **Which means the route must be recomputable rather than only appendable** — a design requirement that only cancellation reveals.

**4. Capacity race on the last seat.** Two matchers evaluate the same vehicle with one free seat, both compute a valid insertion, both claim. **The single-rider version of this was the double-match; here it is an oversell.**

*What it does:* a rider is assigned to a full vehicle and must be reassigned, after being told they were matched. *Fix:* the conditional claim below.

*And a fifth worth naming:* **route commitment conflict.** Two matchers insert into the same vehicle's route concurrently, each validating against the pre-insertion route. **Both insertions are individually valid and their combination violates a detour bound** — capacity was fine, the route promise was not. This is why the claim must check the route version, not only the seat count.

---

**What replaces the conditional update, and what it protects**

\`\`\`sql
UPDATE pool_trips
   SET seats_used  = seats_used + 1,
       route_version = route_version + 1
 WHERE pool_trip_id = :p
   AND state        = 'active'          -- or 'forming'
   AND seats_used   < capacity          -- capacity check
   AND route_version = :seen_version    -- optimistic concurrency
\`\`\`

**Same mechanism, three predicates instead of one.**

**\`seats_used < capacity\`** replaces \`state = 'available'\`. It protects against the oversell — failure mode 4 — and it is the direct analogue of the original check.

**\`route_version = :seen_version\`** is the new and essential part. The matcher validated its insertion against a specific route; **if another insertion committed in the meantime, that validation is stale and must be redone.** This protects against failure mode 5, which the capacity check alone does not catch — because two insertions can both fit in the seats and jointly break a detour promise.

**\`state = 'active' or 'forming'\`** protects the invariant that a vehicle past its last pickup accepts no new riders.

**Then the insertion of the route rows happens in the same transaction as this update**, so the route and the counters cannot diverge.

**What the whole thing protects, stated as one sentence: that every rider in the vehicle still has the trip they were promised.** The single-rider claim protected a simpler property — one rider per driver — and the pooled claim protects a compound one, which is why it needs three predicates and a version.

**And the shape is unchanged, which is the point.** No lock, no coordination protocol, no distributed transaction. **A conditional write on the row that owns the constraint**, and the loser retries with fresh state. The original mechanism generalised; only the predicate grew.

---

**The one measurement that says whether pooling works**

**The pooling rate weighted by rider-experienced detour** — specifically: what fraction of legs shared a vehicle with at least one other rider, cross-tabulated against the distribution of detour as a fraction of the solo trip time.

**Why this and not either half alone.**

\`\`\`
High pooling rate, high detours   → riders stop using it;
                                    the rate will collapse next month
Low pooling rate, low detours     → the product is single rides with
                                    extra machinery and a discount
High pooling rate, low detours    → it works
\`\`\`

**Pooling rate alone is the number that looks good while the product fails.** It rises when the matcher is aggressive, and aggressive matching is exactly what produces the detours that drive riders away. **So the rate must always be read against the detour distribution**, and the tail of that distribution matters more than its mean — a 95th-percentile detour of 2.5× is a churn driver even if the median is 1.1×.

**What decision it drives:** the detour bound. **It is the single parameter that trades pooling rate against rider experience**, and it cannot be set from first principles — only from observing where the detour distribution starts costing retention. Loosen it and the rate rises with the tail; tighten it and the rate falls with the tail.

*A second measurement, subordinate:* **vehicle-hours saved per pooled leg.** Pooling exists to reduce vehicle utilisation per rider, and if a pooled trip's added detour distance approaches the distance saved by not dispatching a second vehicle, **the pooling is doing work without producing the benefit it exists for** — which is possible and is not visible in either the rate or the detour numbers.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hu-1',
      level: 'basic',
      question: 'Design Uber. Start with the write paths.',
      guidance:
        'Look for the volume asymmetry stated early: 1.25 M disposable location writes/s against a few hundred precious trip transitions/s, in different stores.',
    },
    {
      id: 'iq-hu-2',
      level: 'basic',
      question: 'How do you find drivers near a rider?',
      guidance:
        'Cell buckets plus ring expansion, turning the query into a handful of set reads. A strong answer notes this is the cheap part of the problem.',
    },
    {
      id: 'iq-hu-3',
      level: 'intermediate',
      question: 'Two riders request at the same instant and the same driver is best for both. What happens?',
      guidance:
        'A conditional update on the driver row; the loser\'s update affects zero rows and it tries the next candidate. Look for rejection of a distributed lock as the correctness mechanism.',
    },
    {
      id: 'iq-hu-4',
      level: 'intermediate',
      question: 'How do you model trip state?',
      guidance:
        'Explicit state with guarded transitions plus an append-only log keyed by trip and sequence. Strong answers name the boolean-columns alternative and why it permits impossible states.',
    },
    {
      id: 'iq-hu-5',
      level: 'advanced',
      question: 'A driver is offered a trip and their phone dies. Walk me through what happens.',
      guidance:
        'A stored offer deadline releases them without any process staying alive. Excellent answers contrast this with a held lease, whose release depends on a survivor.',
    },
    {
      id: 'iq-hu-6',
      level: 'advanced',
      question: 'How does surge pricing work, and what goes wrong?',
      guidance:
        'A damped control loop per cell, with a held quote and a cap. Excellent answers explain that price changes both demand and supply with a delay, so an undamped loop oscillates.',
    },
    {
      id: 'iq-hu-7',
      level: 'followup',
      question: 'Your in-memory location store loses a shard. What is the impact?',
      guidance:
        'Matches fail in those cells for a few seconds, then the store refills itself from the reporting cycle. No restore, no replay — a direct consequence of the disposability decision.',
    },
    {
      id: 'iq-hu-8',
      level: 'followup',
      question: 'Now add shared rides. What breaks?',
      guidance:
        'The claim predicate (capacity plus route version, not driver state) and the trip state machine (per-rider legs plus a vehicle route). The location tier and cell index are untouched.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hu-1',
      kind: 'what-changes-if',
      prompt:
        'Change one requirement: driver locations must be retained for two years, because an insurance product and a driver-safety score both need trip telemetry. What changes, and what must not?',
      discussion: `The disposability assumption was load-bearing for the whole location tier, so this looks like it invalidates the design. **It does not — provided the new requirement is served by a separate pipeline rather than by making the live store durable.**

**The wrong response, and why it is wrong.**

Making the in-memory store durable, or writing every location to a database as well. **That is failure 1 from the prediction, reintroduced by a product requirement instead of by a design error:**

\`\`\`
1.25 M writes/s × 64 bytes = 80 MB/s
× 86,400 s = ~7 TB/day = ~2.5 PB/year
× 2 years  = 5 PB of driver GPS pings
\`\`\`

**Five petabytes, and the matching path now shares a store with a 1.25-million-write-per-second durable stream.** The live path's latency becomes hostage to the archive's write load, which is the coupling the original split existed to prevent.

**The right response: two pipelines from one source.**

\`\`\`
Driver app ──▶ Location ingest ──┬──▶ In-memory store (live, TTL 30 s)
                                 │    UNCHANGED
                                 └──▶ Append to a log ──▶ Archive
                                      (durable, sampled,
                                       partitioned by time)
\`\`\`

**The live tier does not change at all**, which is the point worth defending in an interview. It keeps its TTL, keeps its disposability, keeps its cheap shard loss. **The new requirement is served alongside it, not through it.**

**And three decisions make the archive affordable.**

**Sample, and sample by context rather than uniformly.** The insurance and safety products need trip telemetry — braking, cornering, speed — which matters *during a trip* and not while a driver waits at a rank.

\`\`\`
On trip:      every 4 s (full fidelity — this is what the products need)
Available:    every 60 s (coarse; enough for supply analytics)
Offline:      nothing
\`\`\`

Concurrent trips were estimated at 200,000, so:

\`\`\`
On-trip:   200,000 / 4 s   =  50,000 writes/s
Idle:      4.8 M / 60 s    =  80,000 writes/s
→ ~130,000 writes/s instead of 1,250,000 — a 10× reduction
And the retained volume: ~500 TB over 2 years, not 5 PB
\`\`\`

**A tenfold reduction from asking what the data is for**, which is the estimation discipline applied to a retention requirement.

**Write to a log, not to the archive directly.** The ingest tier's job is to absorb writes at line rate; **making it wait for a durable archive write couples the live path to the archive's availability.** An append to a partitioned log decouples them, and the archive consumes at its own pace. If the archive is down for an hour, the log holds and the live path never notices.

**Partition the archive by time, and by driver within time.** The access patterns are "this driver's history for a period" (safety score) and "this trip's route" (dispute, claim). **Both are bounded scans if the partitioning matches**, and neither is a query over five petabytes.

**What must not change, and this is the part to say out loud.**

**The matching path must never read the archive.** Matching reads the in-memory store, full stop. **If a "driver safety score" becomes a ranking input, it must be a precomputed value on the driver record**, refreshed by a batch job — not a query against telemetry history on the critical path.

**The live store's TTL must not lengthen.** There will be pressure to keep locations for 10 minutes "since we're storing them anyway", and that confuses two purposes. **The TTL is a liveness mechanism**, not a retention policy: a driver who has not reported for 30 seconds should be invisible to matching whether or not their history is archived.

**Shard loss must stay cheap.** The live tier's best property is that losing it costs seconds. **Any coupling to the archive — a write-through, a synchronous flush, a shared cluster — trades that away** for a requirement that does not need it.

**What this genuinely costs.**

**A second pipeline to operate**, with its own lag, backlog and failure modes.

**A sampling policy that is a product decision** — the on-trip interval is exactly the fidelity of the insurance product, so it cannot be set by engineering alone.

**Privacy and retention obligations that did not previously exist.** Two years of driver GPS history is regulated personal data in most jurisdictions, requiring access controls, deletion on request, and a defensible purpose. **This is the largest real cost and it is not technical** — the previous design had no such exposure precisely because it stored nothing.

**The transferable point.** When a new requirement contradicts an assumption a tier depends on, **check whether it needs the same tier or only the same source.** Here it needs the source — the location stream — and not the live store, so the answer is a fan-out at ingest rather than a change in storage strategy. **A requirement that arrives as "make X durable" is often really "give me a durable copy of what flows into X"**, and those have very different costs.`,
    },
    {
      id: 'al-hu-2',
      kind: 'debug',
      prompt:
        'Riders in one large city report that matching frequently takes 20–40 seconds, occasionally times out, and sometimes assigns a driver who is clearly farther away than another visible on the map. Location ingest is healthy, the geo store\'s read latency is a stable 3 ms, trip transitions are normal, and no other city is affected. Diagnose it.',
      discussion: `One city, matching-specific, with a correctness symptom alongside the latency one. **The geo store being healthy eliminates the location tier and the cell reads**, so the fault is in the match service's own work: candidate ranking, the claim loop, or the cell parameters for this city.

**And the "farther driver assigned" symptom is the most informative detail**, because latency alone has many causes while *bad choices plus slow* narrows it sharply.

**Hypothesis 1 — the routing service is slow or failing for this city, so ranking falls back to distance.** Ranking calls routing for ETAs on a few tens of candidates. If those calls are slow, each match attempt waits; if they time out, the fallback is straight-line distance.

*Why it explains both symptoms at once:* **the fallback produces exactly the "farther driver chosen" complaint** — a driver 200 m away across a river beats one 800 m away on the same road by distance and loses by ETA. And the timeouts explain the 20–40 seconds.

*Check:* routing-service latency and error rate **filtered to this city**, and the rate at which the matcher takes its distance fallback. **This is the first thing I would look at**, because it is the only hypothesis that explains the wrong-driver symptom directly.

**Hypothesis 2 — the offer decline rate has risen, so the sequential loop runs many more iterations.** Each offer waits up to 15 seconds. Two declines is 30 seconds of pure waiting, which lands precisely in the reported range.

*Why it fits:* 20–40 seconds is suspiciously close to two or three 15-second offer deadlines. **The latency is not slow work — it is waiting for humans**, which no amount of infrastructure investigation will reveal.

*What would cause it:* a driver-app release that made the offer notification less prominent; a surge multiplier change altering driver incentives; or offers being sent to drivers who are ending their shift.

*Check:* offers per successful match, and the decline-versus-timeout split. **A rise in *timeouts* rather than declines points at the app or notification delivery**; a rise in declines points at driver incentives. Those are different investigations and the split distinguishes them.

**Hypothesis 3 — cell resolution is wrong for this city's density, so candidate sets are enormous.** A cell sized for a typical city holds thousands of drivers in an unusually dense one. The matcher then fetches thousands of candidates and calls routing for all of them — **which is slow, and it also loads the routing service, which feeds hypothesis 1.**

*Why one city only:* cell size is global while density is local. **A single global resolution has to be wrong somewhere**, and it will be wrong in the most extreme city first.

*Check:* the distribution of candidate-set sizes for this city against others, and the number of ETA calls per match attempt. **If this city's candidate sets are ten times larger, this is the cause and hypothesis 1 is its symptom** — which would be an important ordering to get right, since fixing routing capacity would only mask it.

**Hypothesis 4 — claim contention is high, so matchers burn attempts losing races.** In a dense area with high demand, many matchers evaluate the same top-ranked drivers and all but one lose the conditional update, then re-rank and try again.

*Why it fits one city:* contention scales with demand density, not with fleet size. **The busiest city hits it first.**

*Check:* the ratio of zero-row claim results to successful claims. **If matchers are losing most claims, the fix is to randomise among the top candidates rather than all choosing the single best** — deliberately sacrificing a little match quality to cut contention sharply.

**Hypothesis 5 — the available-driver population in this city has genuinely collapsed.** Ring expansion is exhausting more rings to find any candidate, and the driver eventually assigned is genuinely far away because there is nobody closer.

*Why it explains the "wrong driver" symptom differently:* **the rider sees a nearer driver on the map who is not actually available** — on another trip, or ending a shift. The map is showing vehicles; the matcher is choosing among available ones.

*Check:* available drivers per cell over time for this city, and the average ring count reached per match. **This hypothesis is a supply problem wearing an engineering costume**, and distinguishing it matters because no code change fixes it.

**What I would check first: offers per successful match, and the routing-service fallback rate for this city.** Two numbers, and between them they discriminate the main branches — **is the time spent waiting for drivers (2), waiting for routing (1, 3), or losing claims (4)?** Those are three unrelated fixes and guessing wrong wastes days.

**Then: the candidate-set size distribution**, because hypothesis 3 would present as hypothesis 1 and lead to the wrong fix — adding routing capacity to serve a query that should never have been that large.

**Why "one city only" is the most useful fact.**

It eliminates everything global: the ingest tier, the geo store's implementation, the claim mechanism's correctness, the trip service. **The fault is in something that varies by city** — and the design has exactly four such things: local density against a global cell resolution, local supply and demand, local driver behaviour, and regional routing capacity.

**That is a short list, and it comes from the architecture rather than from the symptoms.** Enumerating the design's city-varying parameters is faster than working forward from "matching is slow".

**The instrumentation this demands.**

**Offers per successful match, split by decline versus timeout.** The single most valuable matching metric, and it is not derivable from latency. **It separates "the system is slow" from "drivers are not accepting"**, which are different problems with no overlap in their fixes.

**Match latency broken into phases:** cell reads, ETA calls, ranking, claim attempts, and offer wait. **The offer wait will dominate and it is not the system's fault** — mixing it into one number makes every matching investigation start from a misleading premise.

**The routing fallback rate as a first-class metric.** Falling back to distance is a silent quality degradation: **matching still succeeds, riders just get worse drivers.** Without this metric the only signal is rider complaints, which is what happened here.

**Candidate-set size distribution per city.** It detects a resolution mismatch directly, and it is the input to any decision about adaptive cell sizing.

**Claim loss rate.** The conditional update makes contention *safe*, not *free*. **Safety without visibility means the contention shows up as latency somewhere else**, which is precisely how it presented here.

**Transferable:** a symptom that is both "slow" and "chose badly" points at a fallback path, because fallbacks trade quality for progress and usually cost latency on the way. **Instrument every fallback with a rate, because a fallback that fires silently is a quality regression with no alarm attached.**`,
    },
  ],

  revision: {
    bullets: [
      'Two write paths with opposite requirements: 1.25 M disposable location writes/s and a few hundred precious trip transitions/s.',
      'Conflating them is the design mistake — a durable store pays WAL, replication and vacuum on data worthless in four seconds.',
      'Locations go in memory with a 30-second TTL; 320 MB holds a global fleet, so it is partitioned for throughput not capacity.',
      'The TTL is the liveness mechanism: stale drivers vanish with no cleanup job.',
      'Losing a geo shard costs seconds, because every driver re-reports within four.',
      'Bucket drivers into cells and query cell plus ring — about 19 key reads, and the cell id shards the space.',
      'Hexagons because six neighbours are equidistant, so ring k means the same distance in every direction.',
      'Adapt the ring count rather than the cell resolution; one grid is much simpler to operate than two.',
      'Rank by ETA, not distance — a driver across a river is not close.',
      'Matching is contention, not search: the nearest-driver query is the easy half.',
      'A conditional update on the driver row is the entire concurrency control; the loser affects zero rows.',
      'A distributed lock cannot be the correctness mechanism — a holder can be paused while believing it holds the lock.',
      'The offer deadline is a stored value, so nothing must stay alive to release a dead app\'s driver.',
      'Sequential offers with a 15-second deadline over broadcast, because losing a race repeatedly is corrosive for drivers.',
      'Explicit trip state with guarded transitions; five booleans permit 32 combinations of which six are legal.',
      'An append-only transition log keyed (trip_id, seq) is the audit trail and the second defence against a replayed completion.',
      'Trip routes are sampled, not the full location stream — a deliberate fidelity choice.',
      'Surge is a damped control loop on a timer, with a held quote and a cap, because a delayed feedback loop oscillates.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A ride-hailing backend with two separate write paths: a million-per-second stream of disposable driver locations in memory, and a small stream of trip transitions in a transactional store with an append-only audit log.',
    whyItExists:
      'Because the geospatial search is the cheap half of the problem. The hard parts are resolving simultaneous claims on one driver, keeping trip state legal and auditable, and running a price feedback loop that does not oscillate.',
    whenToUse: [
      'An in-memory TTL store whenever the write volume is high and the data is disposable.',
      'Cell bucketing whenever proximity queries must shard and must not scan an index under write load.',
      'A conditional write on the contended resource whenever two actors can claim one thing.',
      'An explicit state machine plus a transition log whenever state is disputed later.',
      'A damped control loop whenever the output changes its own inputs with a delay.',
    ],
    whenNotToUse: [
      'A durable geospatial database for the live location stream.',
      'A geospatial nearest-neighbour index query on a write-saturated table.',
      'A distributed lock as the correctness mechanism for a claim.',
      'Distance as the ranking signal when the rider experiences ETA.',
      'Boolean columns for a multi-step lifecycle.',
      'A per-request pricing formula in a system with supply feedback.',
    ],
    alternatives: [
      'S2 cells instead of H3, if hierarchical aggregation matters more than neighbour semantics.',
      'Multiple cell resolutions instead of adaptive ring counts, at the cost of operating two grids.',
      'Broadcast offers instead of sequential, buying latency at the cost of driver experience.',
      'Batched matching over a few seconds, buying assignment quality at the cost of latency.',
      'A separate sampled durable pipeline, if location history becomes a product requirement.',
    ],
    tradeoffs: [
      'In-memory locations buy a million writes per second and cost everything older than 30 seconds.',
      'Cell bucketing buys sharding and cheap reads and costs a resolution that fits one density.',
      'A conditional claim buys correctness with no coordination and costs a wasted attempt per loser.',
      'A stored offer deadline buys liveness with no supervisor and costs 15 seconds of driver lockout.',
      'Sequential offers buy fairness and cost latency when candidates decline.',
      'A transition log buys auditability and costs about 11 TB/year.',
      'Damping buys price stability and costs minutes of lag on a genuine spike.',
    ],
    failureModes: [
      'A durable store taking 1.25 M location writes/s, which no single instance can absorb.',
      'A read-modify-write claim assigning two riders to one driver.',
      'A distributed lock whose holder is paused while believing it holds the lock.',
      'An offer held as a lease, so a dead process locks a driver out indefinitely.',
      'Distance-based ranking choosing a driver across a river.',
      'Boolean state columns permitting completed-and-cancelled.',
      'A replayed completion billing twice, absent an idempotent transition.',
      'An undamped surge loop flapping a cell between 1.0 and 2.4.',
      'A silent routing fallback degrading match quality with no metric attached.',
      'Claim contention appearing as latency because the loss rate is not measured.',
      'A global cell resolution producing thousand-driver candidate sets in the densest city.',
    ],
    followUpQuestions: [
      'What are the two write paths, and what does each need?',
      'How many location writes per second, and how much does that data matter?',
      'What is the live location state\'s total size?',
      'What happens when a geo shard is lost?',
      'What is the cell resolution, and what is the candidate-set size in the densest city?',
      'What exactly prevents two riders being assigned one driver?',
      'What releases a driver whose app died mid-offer?',
      'Are offers sequential or broadcast, and what did that choose?',
      'What are the legal trip states, and what rejects a replayed completion?',
      'Is surge computed per request or on a loop, and is it damped?',
      'What is the routing fallback rate, and is it measured?',
    ],
  },
});
