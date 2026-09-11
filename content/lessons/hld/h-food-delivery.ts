import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-food-delivery',
  title: 'Design a food delivery platform',
  summary:
    'The hard problem is not matching a courier — it is joining two independent timelines. Food becomes ready on the kitchen\'s schedule and a courier arrives on the road\'s, and every important decision is about when to couple them.',
  phase: 'hld',
  module: 'advanced-designs',
  position: 54,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 95,
  tags: ['three-sided', 'dispatch-timing', 'eta', 'lifecycle', 'capacity'],
  prerequisites: ['h-ecommerce'],
  resources: [
    {
      key: 'uber-h3-docs',
      tier: 'must',
      note: 'Cell indexing again, and here it buckets two populations rather than one — couriers and restaurants. Read it with that in mind: the same grid serves two different proximity questions.',
    },
    {
      key: 'xstate-statecharts',
      tier: 'must',
      note: 'Read the sections on parallel states in particular. An order has three concurrent lifecycles — order, kitchen, courier — and modelling them as one flat state machine is the mistake this lesson is built around.',
    },
    {
      key: 'microservices-saga',
      tier: 'must',
      note: 'Three independent parties can each fail at any point, so every step needs a compensation. Read it for why a compensation is a new action rather than an undo — remaking food is not a rollback.',
    },
    {
      key: 'prometheus-histograms',
      tier: 'good',
      note: 'Read it for why a mean hides everything that matters. ETA quality is the shape of an error distribution, and a system optimised for average error will be confidently wrong in the tail where customers actually complain.',
    },
    {
      key: 'redis-expire',
      tier: 'good',
      note: 'Courier locations and restaurant heartbeats are both disposable state with a TTL. Read the expiry semantics as the mechanism for "this restaurant stopped responding, so stop sending it orders".',
    },
    {
      key: 'aws-load-shedding',
      tier: 'advanced',
      note: 'Read it as the answer to peak-hour demand exceeding courier supply. Accepting an order you cannot deliver is this domain\'s oversell, and shedding honestly is the alternative.',
    },
  ],

  intuition: {
    body: `The ride-hailing instinct says: find a nearby courier, assign them, done. **That instinct solves the easy third of this problem.**

A ride has one timeline — the driver arrives and the trip happens. **A delivery has two independent timelines that must meet.** Food becomes ready on the kitchen's schedule, which the platform does not control and cannot observe directly. A courier arrives on the road's schedule. **Every important decision in this design is about when to couple them.**

**Dispatch too early and the courier waits at the restaurant.** Courier time is the platform's scarcest resource at peak, and a courier standing in a lobby for eight minutes is supply removed from the market.

**Dispatch too late and the food waits on the counter.** Cold food is a refund, a bad rating, and a customer who does not return. **The cost is on the demand side rather than the supply side**, which is why the two errors are not symmetric and the bias has to be chosen deliberately.

**So the central quantity is not "when will the food arrive" — it is "when will the food be ready", and it is the estimate you control least.**

Which leads to the second observation: **an ETA is a sum of estimates with completely different error characteristics.** Travel time is well-behaved and predictable from road data. **Prep time is set by a kitchen that has its own queue, its own staff, and no obligation to tell you anything** — so its variance dominates, and the ETA's quality is almost entirely the prep estimate's quality.

Then a constraint that looks like a boolean and is really a rate: **restaurant availability.**

"Open" is not the question. **A kitchen has throughput**, and sending forty orders in five minutes to a restaurant that produces six a minute destroys the prep time of all forty — including the ones that were fine before. **So availability is a capacity limit, not a flag**, and it is the rate-limiting problem applied to a physical resource you cannot scale.

And a third party means **three independent failure sources.** The customer cancels, the restaurant rejects, the courier unassigns — at any point, concurrently. **An order is not one state machine but three running in parallel**, and flattening them produces states nobody can reason about.

**Finally, the display problem, which is easy to dismiss and shapes the product.** A recomputed ETA that jumps from 25 minutes to 40 and back to 30 destroys trust faster than being wrong by ten minutes consistently. **What you show is not what you computed.**`,
    analogyLimit:
      '"It is Uber for food" gets you the courier location tier and nothing else. A ride has one timeline; a delivery has two that must be joined, and the joining decision — when to dispatch against an unobservable kitchen schedule — is the actual problem. The analogy also hides that the restaurant is a capacity-limited participant rather than a passive destination, and that the two ways of getting dispatch timing wrong have costs on opposite sides of the market.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds a delivery platform: a courier is dispatched the moment an order is placed, ETA is prep time plus travel time using the restaurant\'s advertised prep time, restaurants have an open/closed flag, and the order has one state column. Identify four failures and rank them.',
      answer: `**Failure 1 — dispatching at order placement wastes the scarcest resource, and at peak it is self-amplifying.**

\`\`\`
Order placed at 19:00. Prep time: 22 minutes.
Courier dispatched at 19:00, arrives 19:06.
→ waits 16 minutes in the lobby.

At peak: 1,000 orders/minute × ~12 minutes average wait
       = 12,000 courier-minutes/minute wasted
       = 200 couriers permanently idle at any instant
\`\`\`

**And that is why it amplifies.** Removing 200 couriers from the pool lengthens every other order's assignment time, which lengthens ETAs, which makes more customers wait — **precisely when supply is tightest.**

*The fix:* **dispatch at \`predicted_ready − travel_time − buffer\`**, so the courier arrives as the food does. Which requires a prep-time prediction, and makes prediction quality a supply-efficiency question rather than a cosmetic one.

**Failure 2 — the restaurant's advertised prep time is the worst available estimate.**

It is a single number set once at onboarding, and **actual prep time varies by a factor of three** with kitchen load, item complexity, and hour.

\`\`\`
Advertised: 20 minutes, always.
Tuesday 15:00, one order in the kitchen:   11 minutes
Friday 19:30, 24 orders in the kitchen:    38 minutes
\`\`\`

**The advertised number is wrong in both directions at the times that matter most**, and it is the term whose variance dominates the whole ETA.

*The fix:* **predict prep time from observed history** — this restaurant, this hour, this basket size, and crucially **the kitchen's current queue depth**, which is the strongest single signal and is something the platform knows and the advertised number cannot express.

**Failure 3 — an open/closed flag lets one restaurant destroy its own service.**

\`\`\`
19:15 Friday. Restaurant is "open".
40 orders arrive in 5 minutes. Kitchen produces ~6/minute.
→ order 40 waits ~35 minutes before prep even begins
→ and orders 1-10, which were fine, are now late too
\`\`\`

**A boolean cannot express throughput**, so the platform keeps accepting until the restaurant manually closes — by which time every in-flight order is late.

*The fix:* **availability is a rate limit**, derived from observed throughput and current queue depth, and it degrades rather than flipping: longer advertised prep times first, then pausing new orders. **The restaurant's own earlier orders are what the limit is protecting.**

**Failure 4 — one state column cannot represent three concurrent lifecycles.**

\`\`\`
The kitchen is cooking. The courier is en route.
The customer requests a cancellation.
→ What is "the state"?
   cooking? assigned? cancelling?
→ All three are simultaneously true.
\`\`\`

**Flattening them produces a state space that is the product of three machines**, enumerated by hand, with most combinations forgotten until they happen in production.

*The fix:* **three parallel state regions** — order, kitchen, courier — each with its own transitions, plus explicit rules for the interactions. "Cancel while cooking" is then a defined interaction of two regions rather than a state someone had to remember to add.

**Ranking. Failure 1 is the most expensive**: it burns the scarcest resource at exactly the wrong time and amplifies itself. **Failure 2 is its cause** — you cannot dispatch on time without a prep prediction, so these two are one problem seen from both ends. **Failure 3 destroys service for a whole restaurant's customers**, including orders that were already fine. Failure 4 is a correctness and maintainability failure that produces a steady stream of stuck orders.

**The unifying observation: three of the four come from treating the restaurant as a passive destination rather than a participant with its own schedule and capacity.** The dispatch timing, the ETA and the availability model all fail the same way — **by assuming the kitchen is predictable and unlimited**, when it is neither and the platform cannot control either.`,
    },
  body: `## Step 1 — Requirements

**Functional requirements:**

\`\`\`
Browse nearby restaurants with delivery estimates
Place an order; the restaurant accepts or rejects
A courier is dispatched and collects the food
Customer tracks courier location and an ETA
Order completes; all three parties are paid
Any party can cancel, with defined consequences
Restaurants control their availability and capacity
\`\`\`

**The clarifying questions that change the design:**

**Can the platform observe when food is actually ready?** *Only when the restaurant marks it, unreliably and often late.* **The question the design turns on** — the key quantity is estimated, not observed.

**Which is worse: a courier waiting or food waiting?** *Food waiting per order; courier waiting compounds at peak.* **Sets the dispatch bias**, differently at peak.

**Is capacity fixed?** *No — it varies by hour, staffing and basket mix.* Makes availability a learned rate.

**Can orders be batched?** *Yes, a major efficiency lever.* Adds a second timeline-joining problem.

**How concentrated is demand?** *~40% of daily orders in two evening hours.* **Peak is the design point.**

**Non-functional requirements:**

| Requirement | Value | What it forces |
| --- | --- | --- |
| Courier location freshness | Under 5 s | Disposable in-memory stream with a TTL |
| Displayed ETA stability | No oscillation | Smoothing; what you show ≠ what you computed |
| ETA error | p90 within 8 minutes | Prep prediction from queue depth, not advertised |
| Courier idle-at-restaurant | Median under 3 minutes | Dispatch at predicted-ready minus travel |
| Dispatch decision | Under 2 s | Cell lookups, conditional claim |
| Order state correctness | No stuck orders | Three parallel regions, explicit interactions |
| Peak behaviour | **Never accept an undeliverable order** | Shed honestly |

**Out of scope:** payments (the e-commerce saga applies), menu management, courier onboarding, and the routing engine itself.

## Step 2 — Estimation

\`\`\`
Orders:      20 million/day
Peak:        40% in 2 hours → 8 M / 7,200 s = ~1,100/s
Couriers:    1 million active at peak, location every 4 s
             → 250,000 writes/s (disposable)
Restaurants: 2 million, ~200,000 active at peak
\`\`\`

**The number that surprises people is the ETA recomputation load:**

\`\`\`
Active orders at peak: 1,100/s × ~35 min = ~2.3 million concurrent
Each recomputes ETA every ~15 s
→ ~150,000 ETA computations/s
\`\`\`

**An ETA is not computed once — it is recomputed for every live order continuously**, which makes it a serving-load problem too. **150,000/s rules out a routing call per computation**, so travel time comes from a cached road-speed grid.

**Courier idle time, which quantifies failure 1:**

\`\`\`
Naive dispatch-at-order: ~12 min average wait per order
  1,100 orders/s × 12 min = 13,200 courier-minutes/minute
  = ~13,000 couriers permanently idle at peak

Dispatch at predicted-ready − travel − buffer, with a
  3-minute median wait: ~3,300 couriers idle
→ ~10,000 couriers returned to the market
\`\`\`

**Ten thousand couriers is a 1% supply increase bought with a prediction** — and at peak that 1% decides whether demand is met or shed.

\`\`\`
Restaurant capacity: a kitchen produces 4-10 orders/minute
  200,000 active × 6/min = 1.2 M orders/min capacity
  Peak demand: 1,100/s = 66,000/min
→ aggregate capacity is ample; the constraint is LOCAL
\`\`\`

**No restaurant shortage exists in aggregate**, yet popular restaurants saturate badly. **The capacity problem is per-kitchen, never global** — hence a per-restaurant rate limit rather than global shedding.

## Step 3 — API design

\`\`\`
Customer
  GET  /restaurants?lat=&lng=     → list + ETA estimates
  POST /orders  { restaurantId, items, address, idemKey }
       → { orderId, state: 'pending_restaurant', etaRange }
  WS   /orders/{id}/stream        → state, courier location, ETA
  POST /orders/{id}/cancel        → outcome depends on state

Restaurant
  WS   /merchant/stream           → incoming orders
  POST /orders/{id}/accept  { estimatedPrepMinutes }
  POST /orders/{id}/reject  { reason }
  POST /orders/{id}/ready
  POST /merchant/capacity  { ordersPerMinute | pause }
  POST /merchant/heartbeat        → every 30 s

Courier
  POST /courier/location  { lat, lng }      (every 4 s)
  POST /offers/{id}/accept                  → 409 if taken
  POST /assignments/{id}/arrived_restaurant
  POST /assignments/{id}/picked_up
  POST /assignments/{id}/delivered
\`\`\`

**Five decisions worth defending.**

**\`POST /orders\` returns \`pending_restaurant\` and an ETA *range*.** Nothing is committed yet, **and a range is honest where a number is not**, because the prep variance is wide before the kitchen has looked.

**Accept carries the restaurant's own prep estimate** as a signal, not the answer. **Dispatch blends it with the platform's prediction**, weighted by this kitchen's historical accuracy.

**\`/merchant/heartbeat\` exists so silence means unavailable** — a dead tablet stops receiving orders automatically, **the TTL as the mechanism.**

**Capacity is both declared and inferred.** The merchant sets a rate or pauses; **the platform overrides downward when observed throughput contradicts the claim.**

**Cancel's outcome depends on state.** Free before acceptance; during cooking the food exists and someone pays. **The API returns what happened, not just that it worked.**

## Step 4 — Data model

\`\`\`sql
-- Three parallel regions, three state columns
orders(
  order_id, customer_id, restaurant_id, idem_key UNIQUE,
  order_state,      -- placed|accepted|cooking|ready|picked|delivered|cancelled
  kitchen_state,    -- pending|accepted|cooking|ready|rejected
  courier_state,    -- none|offered|assigned|at_restaurant|carrying|done
  placed_at, predicted_ready_at, promised_eta, actual_delivered_at
)
order_transitions(order_id, seq, region, from_state, to_state, actor, at)
PRIMARY KEY (order_id, seq)

-- Learned capacity, not configured
restaurant_capacity(
  restaurant_id, declared_per_min, observed_per_min,
  queue_depth, effective_per_min, last_heartbeat_at, paused
)

-- Prep-time model inputs, kept for training and prediction
prep_observations(
  restaurant_id, order_id, hour_of_day, item_count,
  queue_depth_at_accept, accepted_at, ready_at
)

-- IN MEMORY, disposable
courier:{id}       → { lat, lng, state }        TTL 30 s
cell:{cell_id}     → SET of available couriers
eta:{order_id}     → { displayed_eta, computed_eta, updated_at }
\`\`\`

**Four decisions worth defending.**

**Three state columns, not one.** The product of three machines is not enumerable by hand, and **each region transitions on its own party's actions.** Interactions are explicit rules rather than remembered states.

**\`promised_eta\` is stored separately from \`predicted_ready_at\`** — what the customer was told versus the current belief. **Storing what you promised is the recurring pattern**, as with the cart's \`price_at_add\`.

**\`effective_per_min\` is derived from declared, observed and queue depth.** **A kitchen declaring 10 and delivering 5 gets 5**, because the limit protects its earlier customers.

**\`eta:{order_id}\` holds both displayed and computed values**, which differ deliberately — **keeping both makes the smoothing auditable.**

## Step 5 — Architecture

\`\`\`
Customer ──▶ ┌────────────────┐        ┌──────────────────────┐
             │ Order service   │───────▶│ Restaurant service    │
             │ 3 state regions │◀───────│ capacity + heartbeat  │
             └────┬───────────┘        └──────────────────────┘
                  │ predicted_ready_at
             ┌────▼────────────┐        ┌──────────────────────┐
             │ Prep predictor   │◀───────│ prep_observations     │
             │ (queue depth!)   │        └──────────────────────┘
             └────┬────────────┘
                  │ dispatch_at = ready − travel − buffer
             ┌────▼────────────┐        ┌──────────────────────┐
             │ Dispatch service │───────▶│ Courier geo store     │
             │ (timed, not      │        │ in-memory, TTL        │
             │  immediate)      │◀───────│ 250 K writes/s        │
             └────┬────────────┘        └──────────────────────┘
                  │
             ┌────▼────────────┐
             │ ETA service      │──▶ smoothed display value
             │ 150 K/s          │    + cached road-speed grid
             └─────────────────┘
\`\`\`

**Why dispatch is a scheduled decision, not a request handler.** The interesting thing is *when* it runs, so it is timer-driven. **A request handler cannot express "do this in 14 minutes."**

**Why the prep predictor reads queue depth.** It is the strongest signal and it is platform-owned, **so the predictor must see all of a restaurant's in-flight orders.**

**Why the ETA service is separate from dispatch.** 150,000/s for display versus once per order for a decision — **same inputs, completely different load profiles.**

**Why courier location reuses the ride-hailing tier exactly.** **250,000 writes/s of data worthless in four seconds** — the same argument, worth reusing rather than rederiving.

## Step 6 — The deep dive: dispatch timing, prep prediction, and the displayed ETA

**Dispatch timing, and the asymmetry that sets the bias.**

\`\`\`
dispatch_at = predicted_ready_at − travel_time_to_restaurant − buffer

buffer scales with the prediction's UNCERTAINTY:
  confident prediction (σ ≈ 3 min)  → buffer 2 min
  uncertain prediction (σ ≈ 10 min) → buffer 6 min
\`\`\`

**The buffer scaling with variance is the key move.** A point prediction is not enough — **you need the distribution**, because how early to arrive depends on how wrong you might be.

**Now the asymmetry, which is genuinely two-sided.**

\`\`\`
Courier arrives EARLY:  idle courier-minutes.
                        Cost: supply removed from the market,
                        and it compounds at peak.
Courier arrives LATE:   food sits on a counter.
                        Cost: quality, refunds, ratings —
                        borne per order, not compounded.
\`\`\`

**So the bias should change with market conditions, and that is the interesting conclusion.** Off-peak, couriers are abundant and idle time is nearly free, so **bias early and protect food quality.** At peak, courier minutes are the binding constraint, so **bias later and accept some food waiting** — because the alternative is orders nobody can deliver at all.

*A single fixed buffer is therefore wrong in both regimes*, and the buffer should be a function of local courier supply as well as prediction variance.

**And the case that breaks the formula: predicted_ready in the past.** The kitchen is slower than predicted, the courier is already waiting, and **the prediction must be revised upward *while the order is live*** — which then changes the displayed ETA, which is the display problem.

**Prep prediction, and why queue depth dominates.**

\`\`\`
Features, in descending order of value:
  1. Kitchen queue depth at accept   ← strongest by far
  2. Restaurant × hour-of-day history
  3. Item count and complexity mix
  4. The restaurant's own estimate    ← weighted by its
                                        historical accuracy
  5. Day of week, weather
\`\`\`

**Queue depth is first because it is the only feature explaining variance within a single restaurant-hour.** Two identical 19:30 orders differ by twenty minutes between an empty kitchen and fifteen tickets.

**And the platform sees queue depth while the advertised number structurally cannot express it** — **the better estimate comes from better observation, not better modelling.**

**Predict a distribution, not a number.** The buffer needs σ and the customer needs a range. *And measure the error distribution:* a good average can be catastrophically wrong in the tail, **and the tail is where refunds happen.**

*The uncomfortable feedback loop:* dispatch decisions change observed prep times. Dispatching later means couriers wait less, and **the "ready_at" you record is the restaurant's mark, which arrives late when nobody is waiting for the food.** So the training data is contaminated by the dispatch policy that produced it — **worth acknowledging rather than pretending the observation is clean.**

**Restaurant capacity as a rate limit.**

\`\`\`
effective_per_min = min(
    declared_per_min,
    observed_throughput × 0.9,
    f(queue_depth)          -- falls as the queue grows
)

Then degrade gradually rather than flipping:
  queue moderate → advertise longer prep times (demand falls)
  queue high     → stop showing this restaurant to new customers
  queue extreme  → pause; existing orders continue
\`\`\`

**Three properties.**

**The claim is capped by observation.** A kitchen declaring ten per minute and delivering five gets five, **because the protected parties are the customers of its earlier orders.**

**Degradation is gradual and starts with honesty.** A longer advertised prep time reduces demand *and* sets a correct expectation — **one mechanism, two purposes.**

**And the limit protects the restaurant from itself.** Forty orders in five minutes makes all forty late, including the ten that were fine. **The rate-limiting lesson applied to a resource that cannot be scaled at all.**

**The displayed ETA, which is a trust problem.**

\`\`\`
computed_eta:  recomputed every 15 s. Jumps as prep
               predictions revise and traffic changes.
displayed_eta: derived from computed, with rules:
  · Never move earlier then later — only one direction
    per phase of the order
  · Move in at most 2-minute increments
  · Show a RANGE before pickup, a point after
  · Revise upward immediately and visibly if it is
    genuinely much later — silence is worse than bad news
\`\`\`

**Why not show the computed value.** 25, then 40, then 30 minutes reads as a broken system. **Stable and conservative is trusted; accurate and volatile is not** — and trust decides whether the customer waits.

**Same mechanism as the surge loop**: a volatile derived value must be damped before display. **Damping a price, damping a time.**

*The rule that matters most:* **revise upward promptly when the news is genuinely bad.** Smoothing must not become hiding. **A customer told 20 minutes who waits 45 with the display frozen at 20 is the worst outcome of all** — worse than being told 45 at the start.

## Step 7 — What breaks at 10×

**200 million orders/day, 11,000 orders/s peak, 2.5 million writes/s of courier locations.**

**ETA recomputation reaches 1.5 million/s.** *Fix:* recompute on a schedule that varies by order phase — **frequently near handoff, rarely in mid-journey** — since an ETA 25 minutes out does not need 15-second precision.

**The prep predictor becomes a per-restaurant serving problem.** *Fix:* precompute a prep-time curve per restaurant-hour and **apply queue depth as a cheap runtime adjustment** rather than running a model per order.

**Dispatch timers reach millions of pending decisions.** *Fix:* partition the dispatch service by geographic region, since **dispatch decisions never cross regions** — a clean shard key that falls out of the domain.

**Batching becomes mandatory rather than an optimisation.** At this scale, single-order deliveries cannot be staffed. *Fix:* batch two or three orders per courier where routes and ready-times align — **which is a second timeline-joining problem**, now across orders rather than between kitchen and courier.

## Step 8 — Failure

| Failure | Effect | Behaviour |
| --- | --- | --- |
| Restaurant heartbeat stops | Tablet dead, orders would pile up | **TTL marks it unavailable.** New orders stop; existing ones need human follow-up |
| Prep predictor down | No dispatch time | **Fall back to the restaurant's declared prep time.** Worse dispatch, still functioning |
| Courier geo store loses a shard | Couriers invisible | **Refills in 4 s** from the reporting cycle; dispatch in those cells pauses briefly |
| No courier available at peak | Order undeliverable | **Do not accept it.** Extend ETAs, then stop showing restaurants. This domain's oversell |
| Restaurant rejects after acceptance | Food will not exist | Refund, notify, suggest alternatives. **A compensation, not a rollback** |
| Courier unassigns mid-carry | Food in transit, no courier | Reassign from the courier's current location. **The food is the thing to rescue, not the route** |
| ETA service down | No live estimate | **Show the promised range and the courier's position.** Degraded, not broken |
| Cancel during cooking | Food exists, nobody wants it | Restaurant is paid, customer charged per policy, courier released. **Someone must pay** |
| All three regions conflict | Concurrent cancel + ready + assign | Region rules resolve it; the transition log records who acted first |

**Three rows carry the content.**

**"Do not accept an order you cannot deliver" is this domain's zero-oversell rule** — the analogue of the e-commerce reservation. **The food gets made, nobody collects it, and every party loses.** Degrade visibly instead: longer ETAs, then fewer restaurants.

**A courier unassigning mid-carry has no clean compensation.** The food is prepared, paid for, and on a bicycle. **There is no undo** — only a new assignment from where the courier is now. **Compensations here are actions, not reversals.**

**Cancellation during cooking always costs someone**, and the job is to make the policy explicit. **An undefined cost is worse than an unfairly allocated one**, because undefined surfaces as a support ticket.

## Step 9 — Defending it

**"The framing that matters: a ride has one timeline, a delivery has two. Food becomes ready on the kitchen's schedule, which I cannot observe, and a courier arrives on the road's. Every important decision is about when to couple them.**

**So dispatch is a scheduled decision, not an immediate one.** Dispatching at order placement wastes roughly twelve courier-minutes per order — about thirteen thousand couriers permanently idle at peak — **and it compounds, because removing supply lengthens everyone else's wait exactly when supply is tightest.** Instead I dispatch at predicted-ready minus travel minus a buffer, and **the buffer scales with the prediction's variance** — a point estimate is not enough, because how early to arrive depends on how wrong I might be.

**The bias changes with market conditions**, which I think is the non-obvious part. Off-peak, courier minutes are nearly free, so bias early and protect food quality. At peak they are the binding constraint, so bias later and accept some food waiting — **because the alternative is orders nobody can deliver.**

**Prep time is the term whose variance dominates the ETA, and queue depth is the feature that dominates prep time** — it is the only signal that explains variance within one restaurant-hour, and the platform can see it while the restaurant's advertised number structurally cannot express it. **My advantage is observation, not modelling.** And I predict a distribution, because the buffer needs the spread and the customer needs a range.

**Restaurant availability is a rate limit, not a flag.** A kitchen accepting forty orders in five minutes makes all forty late, including the ten that were fine — **so the limit protects the restaurant from itself**, capped by observed throughput rather than its own claim, and degrading by advertising longer prep times before it stops showing the restaurant at all.

**An order is three parallel state regions**, because cancel-while-cooking-while-courier-assigned is three simultaneous truths and one column cannot hold them.

**And what I display is not what I compute.** A raw ETA jumping between 25 and 40 minutes reads as broken; a consistently conservative one is trusted. **Same damping argument as surge pricing, applied to a time** — with the hard rule that smoothing must never become hiding, because a frozen display over a 45-minute wait is the worst outcome available.

**What I gave up:** food sometimes waits at peak by design; displayed ETAs are deliberately conservative; restaurants are throttled below their own claims; and prep training data is contaminated by the dispatch policy that produced it.

**What would make me revisit it:** if kitchens exposed real ticket-level state, prep prediction stops being the dominant uncertainty and dispatch timing becomes nearly solved. And if batching became mandatory rather than opportunistic, the timeline-joining problem moves from two timelines to many and the dispatch decision becomes a routing problem."`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'two-timelines',
      title: 'Two timelines, and the decision that joins them',
      caption:
        'Step through it. Notice that the scheduled dispatch is the only place the two timelines meet — and that the quality of that join is entirely a prediction problem.',
      nodes: [
        { id: 'cust', label: 'Customer places order', kind: 'client', x: 0, y: 140, detail: 'Returns pending_restaurant with an ETA RANGE, not a number. Nothing is committed yet, and the prep estimate\'s variance is genuinely wide before the kitchen has looked at the ticket.' },
        { id: 'rest', label: 'Restaurant service (capacity + heartbeat)', kind: 'service', x: 250, y: 40, detail: 'Availability is a rate limit, not a flag: effective throughput is capped by observation, not by the restaurant\'s claim. It degrades by advertising longer prep times first — which reduces demand AND sets a correct expectation.' },
        { id: 'prep', label: 'Prep predictor — queue depth first', kind: 'service', x: 250, y: 180, detail: 'Queue depth is the strongest feature because it is the only one explaining variance within a single restaurant-hour. The platform can see it; the restaurant\'s advertised number structurally cannot express it. Predicts a DISTRIBUTION, because the buffer needs the spread.' },
        { id: 'disp', label: 'Dispatch — a TIMER, not a handler', kind: 'service', x: 530, y: 180, detail: 'dispatch_at = predicted_ready − travel − buffer, where the buffer scales with prediction variance AND with local courier supply. Dispatching at order placement wastes ~12 courier-minutes per order — 13,000 couriers idle at peak, and it compounds.' },
        { id: 'geo', label: 'Courier geo store — TTL, 250 K writes/s', kind: 'store', x: 790, y: 90, detail: 'Exactly the ride-hailing tier: disposable, in-memory, TTL as liveness, refills itself in four seconds after a shard loss. Worth reusing rather than rederiving.' },
        { id: 'eta', label: 'ETA service — 150 K computations/s', kind: 'service', x: 530, y: 320, detail: 'An ETA is recomputed for every live order every ~15 s, so 2.3 million concurrent orders means 150,000/s. That rules out a routing call per computation — travel time comes from a cached road-speed grid.' },
        { id: 'disp2', label: 'Displayed ETA ≠ computed ETA', kind: 'note', x: 790, y: 320, detail: 'Move in one direction per phase, in small increments, as a range before pickup. Same damping argument as surge pricing. But smoothing must never become hiding: revise upward promptly when the news is bad, because a frozen display over a 45-minute wait is the worst outcome available.' },
        { id: 'shed', label: 'No courier available → do not accept', kind: 'note', x: 250, y: 320, detail: 'This domain\'s zero-oversell rule. Accepting an order with no courier is selling something that does not exist: the food gets made and nobody collects it. Degrade visibly — longer ETAs first, then fewer restaurants shown.' },
      ],
      edges: [
        { id: 'f1', source: 'cust', target: 'rest', kind: 'sync' },
        { id: 'f2', source: 'rest', target: 'prep', kind: 'control' },
        { id: 'f3', source: 'prep', target: 'disp', kind: 'control' },
        { id: 'f4', source: 'disp', target: 'geo', kind: 'read' },
        { id: 'f5', source: 'prep', target: 'eta', kind: 'control' },
        { id: 'f6', source: 'eta', target: 'disp2', kind: 'control' },
        { id: 'f7', source: 'rest', target: 'shed', kind: 'control' },
        { id: 'f8', source: 'geo', target: 'eta', kind: 'read' },
      ],
      steps: [
        {
          id: 'fs1',
          title: 'The restaurant is a participant, not a destination',
          description:
            'A kitchen has throughput. Forty orders in five minutes to a six-per-minute kitchen makes all forty late, including the ten that were fine — so availability is a learned rate capped by observation.',
          nodes: ['cust', 'rest'],
          edges: ['f1'],
        },
        {
          id: 'fs2',
          title: 'And its schedule is the quantity you control least',
          description:
            'Prep time dominates the ETA\'s variance, and queue depth dominates prep time. The platform\'s advantage over the advertised number is observation, not modelling.',
          nodes: ['prep'],
          edges: ['f2'],
        },
        {
          id: 'fs3',
          title: 'So dispatch is timed, and the buffer carries the uncertainty',
          description:
            'Arrive as the food does. The buffer scales with prediction variance — and with courier supply, because the right bias off-peak (early, protect the food) is wrong at peak (later, protect supply).',
          nodes: ['disp', 'geo'],
          edges: ['f3', 'f4'],
        },
        {
          id: 'fs4',
          title: 'The same estimate, recomputed 150,000 times a second',
          description:
            'Dispatch uses it once for a decision; display uses it continuously for 2.3 million live orders. Same inputs, completely different load profiles — so they are different services.',
          nodes: ['eta'],
          edges: ['f5', 'f8'],
        },
        {
          id: 'fs5',
          title: 'Then damp what you show, and refuse what you cannot deliver',
          description:
            'A volatile accurate ETA is trusted less than a stable conservative one — but smoothing must never hide bad news. And an order with no courier is this domain\'s oversell: refuse it visibly.',
          nodes: ['disp2', 'shed'],
          edges: ['f6', 'f7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'parallel-regions',
      title: 'Three lifecycles running at once, not one state column',
      caption:
        'Read the three regions as concurrent. The interactions at the bottom are the states that a flattened machine forgets — and they are the ones that produce stuck orders in production.',
      code: `flowchart TB
    subgraph ORDER["**Region 1 — Order**"]
      O1[placed] --> O2[accepted] --> O3[in_progress] --> O4[delivered]
      O1 --> OC[cancelled]
      O2 --> OC
      O3 --> OC
    end

    subgraph KITCHEN["**Region 2 — Kitchen**"]
      K1[pending] --> K2[accepted] --> K3[cooking] --> K4[ready]
      K1 --> KR[rejected]
      K3 --> KA["**abandoned**<br/>food exists,<br/>nobody wants it"]
    end

    subgraph COURIER["**Region 3 — Courier**"]
      C1[none] --> C2[offered] --> C3[assigned]
      C3 --> C4[at_restaurant] --> C5[carrying] --> C6[done]
      C2 --> C1
      C3 --> C1
      C5 --> CU["**unassigned mid-carry**<br/>no clean compensation"]
    end

    I["**The interactions a flat machine forgets**"]
    I --> I1["cancel WHILE cooking<br/>→ food exists; someone pays.<br/>**Undefined cost is worse<br/>than an unfair one**"]
    I --> I2["ready BEFORE courier assigned<br/>→ prediction was wrong;<br/>food waits, ETA revises **up**"]
    I --> I3["courier at_restaurant<br/>while kitchen still cooking<br/>→ dispatched too early;<br/>**idle supply at peak**"]
    I --> I4["reject AFTER accept<br/>→ refund + notify.<br/>**A compensation, not a rollback**"]

    style KA fill:#40181c,stroke:#b4535e
    style CU fill:#40181c,stroke:#b4535e
    style I1 fill:#1c1814,stroke:#c99a4e
    style I2 fill:#1c1814,stroke:#c99a4e
    style I3 fill:#1c1814,stroke:#c99a4e
    style I4 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: ['uber'],
    body: `The published H3 documentation serves this design twice over, and the second use is the interesting one.

**The same grid buckets two populations.** Couriers are bucketed for "who is near this restaurant"; restaurants are bucketed for "what can be delivered to this address". **One index structure answering two different proximity questions**, which is a reuse the ride-hailing design did not need — it had only one moving population.

**Ring expansion carries a different meaning per population.** Expanding rings for couriers means accepting a longer pickup; expanding rings for restaurants means offering the customer a longer delivery. **The same mechanical operation has two distinct product consequences**, and conflating them would let a courier shortage silently widen the restaurant list.

**And cell ids partition dispatch cleanly.** Dispatch decisions never cross regions, so **the cell id is both the proximity index and the shard key** — which is the 10× fix falling out of a structure chosen for a different reason.

**Three transferable lessons.**

**When a design has two moving populations, check whether one index serves both.** Here it does, because both questions are "what is near this point". **The saving is real and the risk is conflating what expansion means** for each.

**Proximity indexes are also partition keys.** Cell-based bucketing gave the ride-hailing design cheap queries; here it also gives the dispatch service its shard boundary for free.

**The geospatial layer is again the easy part.** It was the easy part in ride-hailing, where contention was hard; **here it is the easy part because prediction is hard.** Two designs, the same index, the difficulty somewhere else both times — which is a useful signal about where to spend interview time.

**Where the reference does not help at all.** H3 says nothing about prep-time prediction, dispatch timing, or kitchen capacity — **and those are the whole problem here.** A candidate who spends the interview on cells and rings has answered the part that was already solved in the previous lesson.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, most of which concern when to couple two timelines and what to do about an estimate you cannot verify.',
    rows: [
      {
        option: 'Dispatch a courier at order placement',
        whenItWins:
          'Off-peak, when courier supply is abundant and idle time is nearly free.',
        whenItLoses:
          'At peak it wastes ~12 courier-minutes per order — about 13,000 couriers idle — and it compounds, because lost supply lengthens everyone else\'s wait.',
        cost:
          'The scarcest resource, at exactly the wrong time.',
      },
      {
        option: 'Dispatch at predicted-ready minus travel minus buffer',
        whenItWins:
          'Always, and more at peak. Returns roughly 10,000 couriers to the market — a 1% supply increase bought with a prediction.',
        whenItLoses:
          'A wrong prediction means either idle couriers or waiting food, and the prediction is of something unobservable.',
        cost:
          'A prep-time model, and a buffer to tune per regime.',
      },
      {
        option: 'A fixed dispatch buffer',
        whenItWins:
          'Simplicity, when courier supply and prediction quality are both stable.',
        whenItLoses:
          'It is wrong in both regimes: too early at peak (wasting supply), too late off-peak (chilling food unnecessarily).',
        cost:
          'Choosing which regime to be wrong in.',
      },
      {
        option: 'Buffer scaled by prediction variance and courier supply',
        whenItWins:
          'The right answer. Earliness matched to uncertainty, and bias matched to what is scarce.',
        whenItLoses:
          'It needs a predicted distribution and a live supply signal.',
        cost:
          'Two extra inputs, and a policy that changes through the day.',
      },
      {
        option: 'The restaurant\'s advertised prep time',
        whenItWins:
          'As a feature weighted by the restaurant\'s historical accuracy.',
        whenItLoses:
          'As the estimate. One number cannot express queue depth, and actual prep varies threefold.',
        cost:
          'An ETA wrong in both directions exactly when it matters.',
      },
      {
        option: 'Predicted prep distribution with queue depth',
        whenItWins:
          'Always. Queue depth is the only feature explaining variance within one restaurant-hour, and the platform sees it.',
        whenItLoses:
          'Training data is contaminated by the dispatch policy that produced it.',
        cost:
          'A model per restaurant-hour, and honest acknowledgement of the feedback loop.',
      },
      {
        option: 'An open/closed availability flag',
        whenItWins:
          'A restaurant with capacity far above its demand.',
        whenItLoses:
          'It cannot express throughput, so a popular kitchen accepts orders until it has ruined all of them.',
        cost:
          'Every in-flight order late, including the ones that were fine.',
      },
      {
        option: 'Availability as a learned rate limit',
        whenItWins:
          'Always. Capped by observation, degrading through longer advertised prep times before pausing.',
        whenItLoses:
          'The restaurant is throttled below its own claim, which it may dispute.',
        cost:
          'Lost orders for that restaurant, protecting its earlier customers.',
      },
      {
        option: 'One state column for the order',
        whenItWins:
          'Nowhere. Three parties act concurrently.',
        whenItLoses:
          'Cancel-while-cooking-while-assigned is three simultaneous truths, and the flattened product is enumerated by hand and forgotten.',
        cost:
          'A steady stream of stuck orders in states nobody defined.',
      },
      {
        option: 'Three parallel state regions',
        whenItWins:
          'Always. Each region transitions on its own party\'s actions, with interactions as explicit rules.',
        whenItLoses:
          'More state to reason about, and interactions must be enumerated deliberately.',
        cost:
          'Three columns and an interaction table.',
      },
      {
        option: 'Display the computed ETA directly',
        whenItWins:
          'Nowhere. It is the accurate value.',
        whenItLoses:
          '25 then 40 then 30 minutes reads as a broken system, and trust determines whether the customer waits or cancels.',
        cost:
          'Trust, which is the thing that keeps the customer waiting.',
      },
      {
        option: 'Smoothed, conservative displayed ETA',
        whenItWins:
          'Always. Stable and slightly pessimistic beats accurate and volatile.',
        whenItLoses:
          'If smoothing becomes hiding — a frozen display over a 45-minute wait is the worst outcome available.',
        cost:
          'Deliberate conservatism, plus a hard rule to revise upward promptly.',
      },
      {
        option: 'Accept orders during a courier shortage',
        whenItWins:
          'Nowhere. It is this domain\'s oversell.',
        whenItLoses:
          'The food is made and nobody collects it; every party loses.',
        cost:
          'Wasted food, a refund, and three unhappy participants.',
      },
      {
        option: 'Shed demand visibly at peak',
        whenItWins:
          'Always. Longer ETAs first, then fewer restaurants shown.',
        whenItLoses:
          'Rejected demand is lost revenue and a disappointed customer.',
        cost:
          'Orders not taken, in exchange for orders not failed.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Assign a courier as soon as the order is placed, like a ride request."',
      whyWeak:
        'A ride has one timeline; a delivery has two. The courier arrives in six minutes and the food is ready in twenty-two, so they wait sixteen — about twelve courier-minutes per order on average, roughly thirteen thousand couriers permanently idle at peak. And it compounds, because removing supply lengthens every other order\'s wait exactly when supply is tightest.',
      strongAnswer:
        '"Dispatch is a scheduled decision, not an immediate one: dispatch at predicted-ready minus travel time minus a buffer, so the courier arrives as the food does. That returns roughly ten thousand couriers to the market at peak — a 1% supply increase bought with a prediction. And the buffer scales with the prediction\'s variance, because how early to arrive depends on how wrong I might be."',
    },
    {
      weakAnswer: '"ETA is the restaurant\'s stated prep time plus the driving time."',
      whyWeak:
        'The advertised prep time is a single number set at onboarding, and actual prep varies threefold with kitchen load. It is wrong in both directions precisely at the busy hours that matter, and it is the term whose variance dominates the whole ETA.',
      strongAnswer:
        '"Prep time dominates the ETA\'s variance, and queue depth dominates prep time — it is the only feature that explains variance within a single restaurant-hour, since two identical orders at 19:30 differ by twenty minutes depending on whether the kitchen has fifteen tickets or none. The platform can observe queue depth and the advertised number structurally cannot express it, so my advantage is observation rather than modelling. And I predict a distribution: the dispatch buffer needs the spread and the customer needs a range."',
    },
    {
      weakAnswer: '"Restaurants have an open/closed toggle they control."',
      whyWeak:
        'A boolean cannot express throughput. A kitchen producing six orders a minute that receives forty in five minutes has made all forty late — including the ten that were on track before the flood.',
      strongAnswer:
        '"Availability is a rate limit derived from observed throughput and current queue depth, with the restaurant\'s declared rate as a capped input — a kitchen that claims ten per minute and delivers five gets five, because the limit protects the customers of its earlier orders. And it degrades gradually rather than flipping: first advertise longer prep times, which reduces demand and sets a correct expectation at the same time, then stop showing the restaurant, then pause. It is the rate-limiting pattern applied to a resource that cannot be scaled at all."',
    },
    {
      weakAnswer: '"The order has a status field: placed, cooking, out for delivery, delivered."',
      whyWeak:
        'Three parties act concurrently. When the kitchen is cooking and the courier is en route and the customer requests a cancellation, all three are true simultaneously and no single column can hold that.',
      strongAnswer:
        '"Three parallel state regions — order, kitchen, courier — each transitioning on its own party\'s actions, plus explicit rules for the interactions. Then \'cancel while cooking\' is a defined interaction of two regions rather than a state someone had to remember to add. Flattening them means enumerating the product of three machines by hand, and the combinations you forget are the stuck orders you find in production."',
    },
    {
      weakAnswer: '"Show the customer the current computed ETA, updated live."',
      whyWeak:
        'The computed value moves as prep predictions revise and traffic changes. An ETA reading 25, then 40, then 30 minutes is read as a broken system, and trust is what determines whether the customer waits or cancels.',
      strongAnswer:
        '"What I display is not what I compute. The displayed value moves in one direction per phase of the order, in small increments, shown as a range before pickup and a point after. Same damping argument as surge pricing, applied to a time rather than a price. But with a hard rule: revise upward promptly and visibly when the news is genuinely bad, because smoothing must never become hiding — a customer told twenty minutes who waits forty-five with a frozen display is the worst outcome available."',
    },
    {
      weakAnswer: '"At peak, accept all orders and let couriers catch up."',
      whyWeak:
        'Accepting an order with no courier available is this domain\'s oversell: the kitchen makes the food, nobody collects it, and every party loses — the customer waits then refunds, the restaurant wasted ingredients, and the platform pays for both.',
      strongAnswer:
        '"Never accept an order I cannot deliver. Degrade visibly instead: extend advertised ETAs first, which both reduces demand and sets a correct expectation, then stop showing restaurants that cannot be served, then pause. It is the same rule as reserving stock before charging — do not promise what you have not secured. And note that the constraint is local rather than aggregate: courier capacity exists somewhere, it just is not near this restaurant right now."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hfd-1',
      front: 'What distinguishes this from a ride-hailing design?',
      back: 'A ride has one timeline; a delivery has two that must be joined — food ready on the kitchen\'s schedule, courier arrival on the road\'s. Every important decision is when to couple them.',
      topic: 'three-sided',
    },
    {
      id: 'fc-hfd-2',
      front: 'What does dispatching at order placement cost?',
      back: 'About 12 courier-minutes per order — roughly 13,000 couriers idle at peak — and it compounds, because lost supply lengthens everyone else\'s wait when supply is tightest.',
      topic: 'dispatch-timing',
    },
    {
      id: 'fc-hfd-3',
      front: 'What is the dispatch formula?',
      back: 'dispatch_at = predicted_ready − travel_time − buffer, with the buffer scaled by prediction variance and by local courier supply.',
      topic: 'dispatch-timing',
    },
    {
      id: 'fc-hfd-4',
      front: 'Why does the dispatch bias change with market conditions?',
      back: 'Off-peak, courier minutes are nearly free, so bias early and protect food. At peak they are the binding constraint, so bias later — the alternative is orders nobody can deliver.',
      topic: 'dispatch-timing',
    },
    {
      id: 'fc-hfd-5',
      front: 'Which ETA term dominates its variance, and why?',
      back: 'Prep time. Travel is predictable from road data; the kitchen has its own queue and staff and no obligation to tell you anything.',
      topic: 'eta',
    },
    {
      id: 'fc-hfd-6',
      front: 'Why is queue depth the strongest prep-time feature?',
      back: 'It is the only feature explaining variance within a single restaurant-hour — two identical 19:30 orders differ by 20 minutes depending on whether the kitchen has 15 tickets or none.',
      topic: 'eta',
    },
    {
      id: 'fc-hfd-7',
      front: 'What is the platform\'s advantage over the advertised prep time?',
      back: 'Observation, not modelling. The platform sees the restaurant\'s full in-flight queue; a single advertised number structurally cannot express it.',
      topic: 'eta',
    },
    {
      id: 'fc-hfd-8',
      front: 'Why predict a distribution rather than a number?',
      back: 'The dispatch buffer needs the spread and the customer needs a range. And measure error as a distribution too — a good mean can hide a catastrophic tail.',
      topic: 'eta',
    },
    {
      id: 'fc-hfd-9',
      front: 'Why is restaurant availability a rate rather than a flag?',
      back: 'A kitchen has throughput. Forty orders in five minutes to a six-per-minute kitchen makes all forty late, including the ten that were fine.',
      topic: 'capacity',
    },
    {
      id: 'fc-hfd-10',
      front: 'Why is the restaurant\'s declared capacity capped by observation?',
      back: 'Because the limit protects the customers of its earlier orders. A kitchen claiming 10/min and delivering 5 gets 5.',
      topic: 'capacity',
    },
    {
      id: 'fc-hfd-11',
      front: 'What is the first degradation step for an overloaded restaurant?',
      back: 'Advertise longer prep times — which reduces demand and sets a correct expectation at the same time. One mechanism, two purposes.',
      topic: 'capacity',
    },
    {
      id: 'fc-hfd-12',
      front: 'Why three parallel state regions rather than one column?',
      back: 'Cancel-while-cooking-while-courier-assigned is three simultaneous truths. Flattening means enumerating the product of three machines by hand and forgetting most of it.',
      topic: 'lifecycle',
    },
    {
      id: 'fc-hfd-13',
      front: 'Why is the displayed ETA different from the computed one?',
      back: 'A value reading 25, then 40, then 30 minutes reads as broken. Stable and conservative is trusted; accurate and volatile is not — and trust decides whether the customer waits.',
      topic: 'eta',
    },
    {
      id: 'fc-hfd-14',
      front: 'What is this domain\'s zero-oversell rule?',
      back: 'Never accept an order you cannot deliver. The food gets made and nobody collects it. Shed visibly instead: longer ETAs, then fewer restaurants.',
      topic: 'capacity',
    },
  ],

  quiz: [
    {
      id: 'q-hfd-1',
      kind: 'scenario',
      prompt:
        'An order is placed at 19:00 with a 22-minute prep time. The nearest courier is 6 minutes away. When should the courier be dispatched?',
      options: [
        { id: 'a', label: 'At about 19:14 — predicted ready minus travel minus a buffer that scales with prediction uncertainty' },
        { id: 'b', label: 'Immediately, so the courier is certainly there when the food is ready' },
        { id: 'c', label: 'When the restaurant marks the order ready' },
        { id: 'd', label: 'At 19:16 exactly, so arrival coincides with the predicted ready time' },
      ],
      correct: ['a'],
      explanation:
        'Option b wastes 16 courier-minutes on this order alone, and roughly 13,000 couriers at peak. Option c guarantees the food waits for the full travel time. Option d has no buffer, so any prep prediction error under-shoots — and the buffer must scale with variance because how early to arrive depends on how wrong you might be.',
      difficulty: 'core',
      topic: 'dispatch-timing',
    },
    {
      id: 'q-hfd-2',
      kind: 'scenario',
      prompt:
        'Two identical orders are placed at the same restaurant at 19:30 and their actual prep times differ by 20 minutes. Which feature explains that?',
      options: [
        { id: 'a', label: 'Kitchen queue depth at accept time — the only feature that varies within a single restaurant-hour' },
        { id: 'b', label: 'Hour of day' },
        { id: 'c', label: 'The restaurant\'s advertised prep time' },
        { id: 'd', label: 'Item count, since the baskets must differ' },
      ],
      correct: ['a'],
      explanation:
        'Hour of day and the advertised time are identical for both orders, so neither can explain a difference between them — and the baskets are stated to be identical. Queue depth is what changed, and it is platform-owned state the restaurant\'s single advertised number structurally cannot express.',
      difficulty: 'core',
      topic: 'eta',
    },
    {
      id: 'q-hfd-3',
      kind: 'scenario',
      prompt:
        'A popular restaurant marked "open" receives 40 orders in 5 minutes; its kitchen produces 6 per minute. What is the consequence and the fix?',
      options: [
        { id: 'a', label: 'All 40 are late including the 10 that were on track — availability must be a rate limit capped by observed throughput, degrading through longer advertised prep times' },
        { id: 'b', label: 'Only the last orders are late, which is acceptable' },
        { id: 'c', label: 'The restaurant should close manually when overwhelmed' },
        { id: 'd', label: 'Dispatch more couriers to compensate' },
      ],
      correct: ['a'],
      explanation:
        'The queue delays everything behind it, which is why the earlier orders suffer too — the limit protects the restaurant from itself. Option c is what the boolean forces, and by the time a busy kitchen reacts, every in-flight order is already late. Option d addresses the wrong constraint entirely: the bottleneck is the kitchen.',
      difficulty: 'core',
      topic: 'capacity',
    },
    {
      id: 'q-hfd-4',
      kind: 'scenario',
      prompt:
        'The kitchen is cooking, the courier is en route, and the customer requests a cancellation. How is this represented?',
      options: [
        { id: 'a', label: 'Three parallel state regions, with "cancel while cooking" as an explicit interaction rule between two of them' },
        { id: 'b', label: 'A single status field set to "cancelling"' },
        { id: 'c', label: 'A boolean is_cancelled alongside the status field' },
        { id: 'd', label: 'Reject the cancellation, since the order is already in progress' },
      ],
      correct: ['a'],
      explanation:
        'All three facts are simultaneously true, so one column cannot hold them. Option c is the boolean-columns mistake from the ride-hailing lesson, which permits states that cannot exist. Option d avoids the modelling problem by removing a product requirement — and the cost of the food still has to be allocated to someone, which is exactly what the interaction rule defines.',
      difficulty: 'advanced',
      topic: 'lifecycle',
    },
    {
      id: 'q-hfd-5',
      kind: 'scenario',
      prompt:
        'At peak, demand exceeds available couriers in one area. What should happen?',
      options: [
        { id: 'a', label: 'Extend advertised ETAs, then stop showing unservable restaurants — never accept an order that cannot be delivered' },
        { id: 'b', label: 'Accept the orders and deliver them late' },
        { id: 'c', label: 'Accept the orders and cancel the ones that cannot be assigned' },
        { id: 'd', label: 'Dispatch couriers from further away regardless of travel time' },
      ],
      correct: ['a'],
      explanation:
        'Accepting an undeliverable order is this domain\'s oversell: the food is made, nobody collects it, and all three parties lose. Option c is worse than refusing up front because the kitchen has already spent ingredients. Extending ETAs is the best first step because it reduces demand and sets a correct expectation with one mechanism.',
      difficulty: 'advanced',
      topic: 'capacity',
    },
    {
      id: 'q-hfd-6',
      kind: 'multi',
      prompt:
        'Which rules should govern the ETA shown to a customer? Select all that apply.',
      options: [
        { id: 'a', label: 'Move in one direction per order phase, in small increments' },
        { id: 'b', label: 'Show a range before pickup and a point after' },
        { id: 'c', label: 'Revise upward promptly and visibly when the delay is genuinely large' },
        { id: 'd', label: 'Always show the freshest computed value for maximum accuracy' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first two are the damping rules; the third is the limit on damping — smoothing must never become hiding, since a frozen display over a long wait is the worst outcome available. Option d is the mistake: an accurate but volatile ETA reads as a broken system, and trust is what determines whether the customer waits or cancels.',
      difficulty: 'core',
      topic: 'eta',
    },
  ],

  exercises: [
    {
      id: 'ex-hfd-1',
      kind: 'design',
      title: 'Add batching, and the two timelines become many',
      estimatedMinutes: 40,
      prompt: `Courier economics force batching: one courier carries two or three orders, possibly from different restaurants, to different addresses.

**Part 1.** The dispatch formula assumed one order per courier. State precisely what breaks and what survives.

**Part 2.** Redesign dispatch for batches. Give an implementable mechanism and state what you optimise.

**Part 3.** Batching changes what an ETA means for each customer in the batch. Work out the consequences and what you display.

**Part 4.** Name four new failure modes and what each does.

Then answer:

- Which customer in a batch should be told the truth first?
- What does batching reveal about the original single-order design?`,
      rubric: [
        'Identifies that the dispatch formula cannot express multiple ready-times.',
        'Correctly states what survives: geo index, capacity limits, state regions, the display discipline.',
        'Reframes batch dispatch as joining N ready-times plus a route, with an explicit objective.',
        'Gives an implementable incremental mechanism rather than an optimal solver.',
        'Handles the ready-time spread as the binding constraint on batch feasibility.',
        'Works out the per-customer ETA consequences including the later-customer penalty.',
        'Names at least four failure modes with consequences.',
        'Answers the fairness question with reasoning.',
        'Concludes that the single-order design was a special case of a joining problem.',
      ],
      modelAnswer: `**Part 1 — what breaks and what survives**

**What breaks: the dispatch formula has one \`predicted_ready_at\` and now needs several.**

\`\`\`
Single order:
  dispatch_at = ready − travel − buffer          ← one ready time

Batch of two:
  order A ready at 19:22 (σ = 4 min)
  order B ready at 19:31 (σ = 9 min)
  → dispatch when? Arrive at A at 19:22 and wait 9+ minutes
    for B, or arrive at A at 19:31 and let A's food sit?
\`\`\`

**The formula cannot express this because it was joining two timelines and now joins three or more.** And the new binding constraint is not any single ready-time — **it is the *spread* between them.**

**Which yields the feasibility rule, and it is the most useful single output of this exercise:**

\`\`\`
A batch is feasible iff the spread of ready-times is small
relative to the food's tolerance for waiting.

spread ≈ 3 min  → batch freely
spread ≈ 10 min → the earlier food waits 10 minutes. Marginal.
spread ≈ 20 min → do not batch. No dispatch time is acceptable.
\`\`\`

**So batch formation is gated by predicted ready-times before geography is even considered** — which inverts the intuitive order, where you would look for nearby orders first.

**A second break: the courier's idle time is no longer the only waste.** Now **the earlier order's food waits while the courier collects the later one**, so the cost structure gains a term that did not exist. **Batching converts courier idle time into food waiting time**, which is precisely the trade the single-order design was set up to avoid.

**What survives, and it is substantial.**

**The cell index and courier location tier are untouched.** Still 250,000 disposable writes per second, still proximity by ring expansion.

**Restaurant capacity limits are untouched.** Batching changes collection, not kitchen throughput.

**The three parallel state regions survive with one change:** the courier region is now **per-assignment rather than per-order**, so one courier state serves several orders. **The regions were already independent, which is why this is an adjustment rather than a redesign.**

**The prep predictor becomes more valuable, not less.** Batch feasibility depends on the *spread* of predicted ready-times, so **σ now gates whether a batch may form at all** — a prediction with wide uncertainty cannot support batching, because you cannot know the spread.

**And the display discipline survives and gets harder**, which is Part 3.

---

**Part 2 — batch dispatch**

**What I optimise, stated first:**

\`\`\`
Minimise:  total courier-minutes per delivered order
Subject to: no order's food waits more than W minutes
            no customer's ETA exceeds their promise + tolerance
            courier capacity (bag volume) respected
\`\`\`

**The food-wait constraint is hard, not a penalty term.** Cold food is a refund and a lost customer, so **a batch that saves courier time by letting food sit 25 minutes is not a better solution — it is an infeasible one.**

**The mechanism: incremental batch formation at dispatch time.**

\`\`\`
Dispatch runs on a timer. For each order approaching its
dispatch moment:

1. Candidate batch-mates: orders whose PREDICTED READY TIME
   is within W minutes of this one.
     ← ready-time filter FIRST, because it is the hard gate
2. Of those, keep ones whose restaurant is within a short
   detour of this order's restaurant (cell + 1 ring).
3. Of those, keep ones whose delivery address is roughly
   in the same direction (bearing within ~45°).
4. Score each candidate pairing:
     saving = courier-minutes saved by combining
     penalty = food-wait minutes added to the earlier order
              + ETA extension for the earlier customer
   Keep pairings where saving > penalty × weight.
5. Form the batch greedily, up to capacity, then dispatch
   at: min(ready times) adjusted so arrival at restaurant 1
   leaves time to reach restaurant 2 near ITS ready time.
6. Claim each order conditionally, as before. A lost claim
   shrinks the batch rather than failing it.
\`\`\`

**Four properties worth defending.**

**Ready-time filtering comes first, before geography.** The intuitive order is to find nearby orders and then check timing, but **timing is the hard constraint and geography is the soft one** — a 3-minute detour is cheap, and a 20-minute food wait is disqualifying. **Filtering on the hard constraint first is also much cheaper**, since it prunes most candidates.

**The bearing filter is a cheap proxy for routing.** Computing optimal two-stop routes for every candidate pair at 1,100 orders/second is not affordable. **"Roughly the same direction" eliminates almost all bad pairings for the cost of an angle comparison**, and only survivors get a real route computation.

**A lost claim shrinks the batch rather than failing it.** Another dispatcher took one of your candidates, so **deliver the rest** — which is only possible because the batch was formed from independently-claimable orders. **Designing the batch as a set of individual claims rather than one atomic claim is what makes contention survivable.**

**And step 5's dispatch time is the batch's genuinely new computation.** It is not the minimum ready-time or the maximum — **it is the time at which the courier can traverse the pickup route arriving near each restaurant's ready moment**, which is a small scheduling problem per batch.

*What I am not building:* an optimal batching solver. **This is bin-packing plus routing plus stochastic ready-times, and it is intractable per dispatch at this rate.** Greedy pairing on a hard-constraint-first filter is implementable and captures most of the available saving.

---

**Part 3 — what an ETA means in a batch**

**The structural change: one customer's delivery time now depends on another customer's order**, which was not true before.

\`\`\`
Batch: A (ready 19:22, delivered first)
       B (ready 19:31, delivered second)

A's ETA: pickup A 19:24 → pickup B 19:33 → deliver A 19:41
         (A's food is now 19 minutes old at delivery, and
          A waited 9 minutes longer than solo)
B's ETA: deliver B 19:50
\`\`\`

**Three consequences.**

**The first-delivered customer is penalised most.** A's food waits for B's collection. **This is the opposite of intuition** — being first in the delivery order does not mean being served soonest relative to your own readiness.

*And it suggests a sequencing rule:* **deliver in order of food fragility rather than route efficiency**, when the two conflict. Cold-tolerant food waits; hot food goes first. **A product constraint entering a routing decision.**

**The ETA must be computed for the batch, not the order.** Each customer's ETA depends on the whole route, so **a change anywhere in the batch changes everyone's ETA.** If B's kitchen is slow, A's already-collected food sits longer and A's ETA extends — **for a reason A cannot see and would not accept as an explanation.**

**And the promise made at order time must account for possible batching.** If I promise a solo ETA and then batch, **I have broken the promise to save my own costs** — which is the worst pattern available. *Two honest options:*

**Promise a range wide enough to include batching**, which means every solo delivery over-promises.

**Promise solo, and treat batching as constrained by the promise** — batch only when the resulting ETA still fits what the customer was told. **I would choose this**, because it keeps the promise meaningful and it makes the batching decision pay for itself against a real constraint rather than against an inflated buffer.

**What I display:** the same damping discipline, with one addition — **never explain a delay by referring to another order.** "Your courier is collecting another order" tells the customer they are subsidising someone else's delivery. **The display shows the revised time, honestly and promptly; the reason stays internal.**

---

**Part 4 — four new failure modes**

**1. Batch spread explosion mid-flight.** The batch was formed on predicted ready-times within 6 minutes. **Restaurant B is then 20 minutes late**, so the courier holds A's food for 20 minutes.

*Effect:* A's order is ruined by B's kitchen, and A has no relationship with B's restaurant. *Mitigation:* **a mid-flight batch break rule** — if the wait for B exceeds a threshold, deliver A now and re-dispatch B. **The batch must be dissolvable after formation**, which is a requirement most batching designs omit.

**2. Cascading cancellation.** B cancels after the batch is formed and the courier is en route. **The route is now shaped around a stop that no longer exists.**

*Effect:* A took a detour for nothing. *Mitigation:* recompute the route on any batch change and **re-evaluate whether the remaining orders should still be batched at all** — the same shape as the ride-pooling cancellation problem, and it means the route must be recomputable rather than only appendable.

**3. Fairness drift concentrating on the same customers.** Batching decisions optimise total courier-minutes, and **certain addresses are systematically convenient as first pickups and inconvenient as first deliveries.** Those customers get batched — and penalised — disproportionately.

*Effect:* a subset of customers experiences consistently worse service, invisible in aggregate metrics. *Mitigation:* **track batch penalty per customer over time and weight it into the scorer**, so repeated penalisation makes a customer less eligible for batching. **This is only detectable if you measure per-customer, which aggregate ETA error will never surface.**

**4. Courier capacity violation discovered at pickup.** Bag volume was estimated from item counts; the second order is three pizzas and does not fit. **The courier cannot complete the batch at the moment of collection.**

*Effect:* an order stranded at a restaurant with the courier already carrying another. *Mitigation:* volume estimates per menu item, conservative capacity limits, and **a defined abandon path that returns the uncollected order to dispatch** rather than leaving it assigned to a courier who cannot take it.

*And a fifth worth naming:* **prep-prediction contamination gets worse.** Ready-times are now observed under batching, where a courier may not be waiting at all. **The recorded \`ready_at\` drifts later when nobody is there to collect**, and that data trains the predictor that decides batch feasibility. **A feedback loop with the batching policy inside it**, and the honest response is to record ready-times differently — ideally from a kitchen signal rather than a courier-adjacent one.

---

**Which customer should be told the truth first?**

**The one whose outcome is about to get worse, as soon as it is known — and in a batch that is usually the first-delivered customer.**

**The reasoning is about actionability.** A customer told promptly that their delivery is now 12 minutes later can decide to wait, cancel, or eat something else. **A customer told at minute 40 of a 45-minute wait has no options left**, and the lateness plus the silence are two separate failures.

**And the first-delivered customer is the one most likely to be surprised**, because their food was ready earliest and they have the least reason to expect a delay. **The intuition "I ordered first so I will be served first" is exactly what batching violates.**

*The rule I would implement:* **push an ETA revision to whichever customer's delivery time changed most, immediately, before optimising anything else.** Not the one whose position changed in the route, and not the batch as a group — **the one whose promise moved furthest.**

**And a harder version of the question: should the batch form at all if it makes one customer's ETA worse than their promise?** **No** — that is the Part 3 constraint, and it is what keeps the promise meaningful. **Being honest promptly is the fallback for when a prediction fails, not a licence to make choices you then apologise for.**

---

**What batching reveals about the single-order design**

**It reveals that the single-order design was a special case of a joining problem, and that the general problem was always the shape of it.**

The original framing was strong: *two timelines that must meet.* **What batching shows is that "two" was incidental.** The general problem is:

\`\`\`
N events with predicted times and uncertainties,
one mobile resource that must be present at each,
costs for arriving early (idle) and late (spoilage),
and a decision about when to start.
\`\`\`

**Batching is N = 3 or more. The single order was N = 2.** The mechanism did not change kind — **it changed cardinality**, and everything that got harder got harder in the same direction: the spread of predicted times became the binding constraint, and the buffer became a schedule.

**Three things follow.**

**The prep predictor's variance was always the load-bearing quantity, and batching makes that unmissable.** In the single-order case, σ set a buffer — a tuning parameter. **In the batch case, σ determines whether a batch may form at all**, because you cannot know the spread of times you cannot predict. **The same number moves from tuning a parameter to gating a capability**, which is a strong signal it was the right thing to invest in.

**"Store what you promised" recurs again, and now it constrains an optimisation.** \`promised_eta\` was recorded for honesty in the base design. **Here it becomes the constraint that decides whether a cost-saving batch is permitted** — the promise is not just a record, it is a bound on future decisions. **That is the third design in a row where storing the promise turned out to do more work than expected**, after the reservation expiry and \`price_at_add\`.

**And the batch must be dissolvable, which the single-order design never had to consider.** An assignment was atomic: one courier, one order, no mid-flight restructuring. **Batching introduces state that was formed on a prediction and must be revisited when the prediction fails** — failure mode 1 — and that is a genuinely new requirement rather than a scaled one.

*The transferable form:* **when a design joins two schedules, ask what happens at three.** If the mechanism generalises by cardinality, the framing was right and the extension is engineering. **If the binding constraint changes — as it does here, from any single ready-time to the spread between them — then the general problem has a property the special case hid**, and the sooner you know which, the less you rebuild.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hfd-1',
      level: 'basic',
      question: 'Design a food delivery platform. How is it different from ride-hailing?',
      guidance:
        'Look for two timelines that must be joined, rather than one. A candidate who describes courier matching has answered the easy third of the problem.',
    },
    {
      id: 'iq-hfd-2',
      level: 'basic',
      question: 'When do you dispatch a courier?',
      guidance:
        'At predicted-ready minus travel minus buffer. Strong answers quantify what immediate dispatch costs and note that the buffer scales with prediction variance.',
    },
    {
      id: 'iq-hfd-3',
      level: 'intermediate',
      question: 'How do you compute an ETA?',
      guidance:
        'Prep prediction plus travel, with prep dominating the variance and queue depth dominating prep. Look for a distribution rather than a point estimate.',
    },
    {
      id: 'iq-hfd-4',
      level: 'intermediate',
      question: 'A restaurant is overwhelmed at peak. What does the platform do?',
      guidance:
        'Availability as a learned rate limit capped by observation, degrading through longer advertised prep times before pausing. Look for "the limit protects its earlier customers".',
    },
    {
      id: 'iq-hfd-5',
      level: 'advanced',
      question: 'The kitchen is cooking, the courier is en route, and the customer cancels. Model it.',
      guidance:
        'Three parallel state regions with explicit interaction rules, and a defined cost allocation. Excellent answers say an undefined cost is worse than an unfair one.',
    },
    {
      id: 'iq-hfd-6',
      level: 'advanced',
      question: 'What ETA do you show the customer, and why is it not the computed one?',
      guidance:
        'Damped, conservative, one-directional per phase, with prompt upward revision for genuinely bad news. Excellent answers connect it to the surge-pricing damping argument.',
    },
    {
      id: 'iq-hfd-7',
      level: 'followup',
      question: 'Demand exceeds courier supply in an area at peak. What happens?',
      guidance:
        'Never accept an undeliverable order — extend ETAs, then stop showing restaurants. The same rule as reserving before charging.',
    },
    {
      id: 'iq-hfd-8',
      level: 'followup',
      question: 'Now one courier carries three orders. What breaks?',
      guidance:
        'The dispatch formula has one ready-time and now needs several, with the spread as the binding constraint. Batches must also be dissolvable mid-flight.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hfd-1',
      kind: 'what-changes-if',
      prompt:
        'Change one thing: the platform integrates directly with kitchen display systems, so it sees every ticket\'s true state — queued, started, plated — in real time. What becomes easy, what stays hard, and what new problem appears?',
      discussion: `This removes the design's dominant uncertainty, and the interesting result is **how much of the machinery was there purely to cope with not knowing.**

**What becomes easy, or nearly solved.**

**Dispatch timing.** The formula was \`predicted_ready − travel − buffer\`, and **the buffer existed only because \`predicted_ready\` was a guess.** With a real ticket state, ready-time is an observation with a short horizon rather than a prediction over 25 minutes.

\`\`\`
Before: predict ready 22 min ahead, σ ≈ 8 min → buffer 5 min
After:  ticket started, 6 of 8 items plated
        → ready in ~3 min, σ ≈ 1 min → buffer 1 min
\`\`\`

**The buffer collapses from 5 minutes to 1**, which is courier-minutes returned to the market — on top of the 10,000 already recovered by timed dispatch. **The same lever, pushed much further.**

**ETA quality.** Prep dominated the variance, so **removing prep uncertainty removes most ETA error.** The remaining error is travel, which is well-behaved. *And the display smoothing becomes much less necessary*, because the computed value stops jumping — **the damping was compensating for a bad estimate, not for volatile reality.**

**Restaurant capacity.** \`observed_per_min\` and \`queue_depth\` were inferred from order acceptances and ready marks. **Now they are measured directly**, and the rate limit can be set from actual kitchen throughput rather than a proxy.

**And batch feasibility**, from the exercise: it was gated by the spread of *predicted* ready-times and σ. **With real ticket state, the spread is known, so batching becomes far more aggressive and safe** — the single largest efficiency gain available.

**What stays hard.**

**The three parallel state regions.** Three parties still act independently, and knowing the kitchen's state does not stop a customer cancelling while a courier carries food. **Nothing about observation changes the concurrency of intent.**

**Peak supply shortage.** Courier scarcity is a physical constraint. **Better prediction improves utilisation and does not create couriers**, so the shed-honestly rule stands unchanged.

**The compensation problem.** A courier unassigning mid-carry still has no clean undo. **Knowing exactly when the food was plated does not help once it is in a bag on a bicycle.**

**And the promise problem.** You still tell the customer a time and must honour or revise it. **A better estimate makes the promise more accurate, not less binding.**

**What new problem appears, and it is the interesting part.**

**A tight integration makes you dependent on a system you do not control, on the critical path.**

\`\`\`
Before: kitchen integration absent → prediction degrades
        gracefully, because prediction was always the plan
After:  kitchen integration present and DOWN →
        dispatch has no ready-time at all
\`\`\`

**So the prediction path cannot be deleted — it must be maintained as the fallback**, which means operating two systems where the second is exercised rarely and therefore rots. **A fallback that is never used is a fallback that does not work**, and that is a real operational cost of the integration rather than a theoretical one.

*What I would do:* **run the predictor continuously in shadow even when real ticket state is available**, comparing its output to observed reality. **That keeps it trained, keeps it verified, and gives a live measure of how much the integration is worth** — three purposes for one piece of always-on work.

**And a second new problem: the incentive to misreport.**

Ticket state comes from the restaurant's system. **A restaurant that marks items plated early gets couriers dispatched earlier, which reduces its own perceived lateness** and pushes the wait onto the courier.

**So a directly-observed signal from a party with an interest is not the same as ground truth**, which is the marketplace-inventory problem from the e-commerce lesson in a new costume. *Mitigation:* **compare reported plating times against courier-observed pickup times**, and weight a restaurant's signal by its measured honesty. **The same "let the allocator learn which sources lie" pattern, third time.**

**And a third, subtler one: coverage skew.** Large chains integrate; independent restaurants do not. **So the platform's dispatch quality becomes systematically better for chains**, which means better ETAs, better rankings, and more orders — **a structural advantage created by an engineering decision.** Worth naming, because it is a fairness consequence that no metric in the design would surface.

**The transferable point:** when a design's hardest component is an estimate of something unobservable, **integrating to observe it directly removes most of the difficulty and adds three new ones** — a dependency on the critical path whose fallback rots, a source with an incentive to misreport, and uneven coverage that advantages whoever integrated. **The estimate does not go away; it becomes the shadow system that keeps you honest about the observation.**`,
    },
    {
      id: 'al-hfd-2',
      kind: 'debug',
      prompt:
        'Courier idle time at restaurants has risen from a 3-minute median to 11 minutes over two weeks, in one city only. Order volume is flat, courier supply is flat, ETA error is unchanged, and no deploy correlates. Restaurants in that city have not changed their declared prep times. Diagnose it.',
      discussion: `**ETA error unchanged while courier idle time triples is the contradiction that makes this diagnosable**, and it is worth sitting with before generating hypotheses.

Idle time is driven by the gap between courier arrival and food readiness — **which is exactly what the dispatch formula's inputs determine.** If the ETA is still accurate, the *total* timeline is being predicted correctly. **So the error is not in predicting when food is ready; it is in the dispatch decision that uses that prediction**, or in something happening after dispatch.

**That splits the space cleanly, which is what a good contradiction does.**

**Hypothesis 1 — the buffer grew, because prediction variance grew.** The buffer scales with σ. **If σ rose while the mean prediction stayed accurate, dispatch moves earlier and couriers wait longer — and ETA error would be unchanged**, because the mean is still right.

*Why it fits perfectly:* it is the one hypothesis that explains the contradiction directly. **A wider distribution with the same mean produces exactly these symptoms.** And a city-scoped change in variance is plausible — a change in the restaurant mix, a new large merchant with erratic kitchens.

*Check:* the predicted σ distribution for that city over the two weeks, and the resulting buffer values. **This is my leading hypothesis** precisely because σ and the mean are separately observable and only σ needs to have moved.

**Hypothesis 2 — travel-time estimates became pessimistic.** Dispatch uses \`travel_time\` to decide when to send. **If the road-speed grid now over-estimates travel, couriers are dispatched too early and arrive before the food.**

*Why ETA error would be unchanged:* the *displayed* ETA is dominated by prep plus travel to the customer, and **an over-estimate of travel-to-restaurant inflates idle time without necessarily changing total delivery time** — the courier absorbs the error by waiting.

*What would cause it city-wide:* a road-network data update, a new construction pattern, or a speed model retrained on data from a period with unusual traffic. **No deploy needed if the grid updates on a data feed.**

*Check:* predicted versus actual courier travel-to-restaurant times for that city. **If predictions systematically exceed actuals, this is it** — and it is a cheap comparison because both numbers are already recorded.

**Hypothesis 3 — restaurants are marking ready later, so the prediction target shifted.** \`ready_at\` comes from the restaurant marking it. **If merchants in that city started marking ready when the courier arrives rather than when the food is plated, the recorded ready time drifts later**, the predictor learns the later time, and — here is the trap — **the predictor is now correct about the mark and wrong about the food.**

*Why it produces this exact signature:* couriers wait for a *mark* that is issued in response to their arrival. **A circular dependency**, and idle time inflates while every prediction metric looks fine because the model predicts the mark accurately.

*What would cause it:* a merchant-app change, or a policy or training change in one city's merchant operations. **"No deploy" covers the platform's code, not the merchant app or the city's operational practices.**

*Check:* the distribution of \`ready_at\` minus courier \`arrived_restaurant\` timestamps. **If ready marks now cluster just after arrival, the signal has been corrupted** — and this is the hypothesis whose consequences are worst, because the training data is poisoned going forward.

**Hypothesis 4 — batching or assignment changes are sending couriers to the wrong restaurant first.** If multi-order routing is active, **a courier dispatched for a batch may arrive at restaurant A early because the dispatch was timed for restaurant B.**

*Why one city:* batching is often enabled or tuned per market. *Check:* whether idle time is concentrated in batched assignments, and whether the batching rate in that city changed. **A simple split of the idle-time metric by batched-versus-solo answers it immediately.**

**Hypothesis 5 — the courier population's behaviour changed.** Couriers accepting offers faster, or waiting at restaurants rather than repositioning between jobs. **"Idle at restaurant" may be measuring time couriers choose to spend there** rather than time the dispatch decision imposed.

*Why it fits "supply flat":* the count is flat and the behaviour is not. *Check:* whether idle time is measured from arrival-at-restaurant events or inferred from location proximity. **If it is inferred from location, couriers loitering near restaurants between jobs would inflate it with no dispatch change at all** — a measurement artefact rather than a regression.

**What I would check first: the ready-mark-minus-arrival distribution (hypothesis 3) and the predicted σ trend (hypothesis 1).** Two distributions, both already recorded, and between them they cover the two hypotheses that explain the contradiction most directly. **Hypothesis 3 is the one I would most want to rule out early**, because if the ready signal is corrupted then every other measurement is built on a moved foundation.

**Then: split the idle metric by batched-versus-solo and check the travel-time residuals.** Both are cheap and both discriminate the remaining branches.

**Why "ETA error unchanged" is the most useful evidence.**

It eliminates the hypothesis everyone reaches for first — **that prep prediction got worse.** If the model had degraded in its mean, delivery times would have drifted and ETA error would have risen. **It did not, so the total timeline is still being predicted correctly.**

**Which leaves only: the same total, allocated differently.** The courier is absorbing time that used to be spent elsewhere, and that is either a variance change, a travel-estimate change, a signal-definition change, or a measurement change. **Four candidates, derived from one contradiction rather than from enumerating the architecture.**

**The instrumentation this demands.**

**Predicted σ as a monitored distribution, not just an input.** The buffer is a function of σ, so **σ drifting is a silent change in dispatch behaviour** with a direct cost in courier-minutes. It should be graphed beside idle time.

**Ready-mark timing relative to courier arrival.** This detects signal corruption — the hypothesis-3 trap — and **it is the one measurement that catches a circular dependency between the thing you predict and the action you take on the prediction.** Any clustering of ready marks immediately after arrival should alert.

**Travel-time residuals, separately for courier-to-restaurant and restaurant-to-customer.** They feed different decisions — one sets dispatch timing, the other sets the displayed ETA — so **a single aggregate travel-error metric cannot attribute a regression to the decision it broke.**

**Idle time split by assignment type.** Batched and solo assignments have different idle-time expectations, so mixing them makes the metric uninterpretable the moment batching rates change.

**And a definition audit on "idle at restaurant".** Measured from explicit arrival events or inferred from proximity? **A metric whose definition allows courier choice to be counted as system behaviour will eventually produce an investigation like this one for no reason at all.**

**Transferable:** when one metric degrades and its obvious upstream cause is provably healthy, **look for a redistribution rather than a regression** — the same total time or cost landing on a different party. And when the thing you predict is *reported by someone who observes your action*, check for the circular dependency: **a prediction that becomes true because you acted on it is indistinguishable from a good prediction, and only the cost shows up.**`,
    },
  ],

  revision: {
    bullets: [
      'A ride has one timeline; a delivery has two that must be joined — kitchen schedule and road schedule.',
      'Every important decision is about when to couple them, and the kitchen is the side you control least.',
      'Dispatching at order placement wastes ~12 courier-minutes per order and ~13,000 couriers at peak.',
      'And it compounds: lost supply lengthens everyone else\'s wait exactly when supply is tightest.',
      'Dispatch at predicted_ready − travel − buffer, with the buffer scaled by prediction variance.',
      'The bias changes with conditions: early off-peak protects food, later at peak protects supply.',
      'Prep time dominates ETA variance; travel is well-behaved and predictable.',
      'Queue depth dominates prep time — the only feature explaining variance within one restaurant-hour.',
      'The platform\'s advantage over the advertised prep time is observation, not modelling.',
      'Predict a distribution: the buffer needs the spread, the customer needs a range.',
      'Measure ETA error as a distribution too — a good mean hides a catastrophic tail.',
      'Restaurant availability is a rate limit, not a flag: a boolean cannot express throughput.',
      'The declared rate is capped by observation, because the limit protects earlier orders.',
      'Degrade by advertising longer prep times first — reducing demand and setting expectations at once.',
      'An order is three parallel state regions, because three parties act concurrently.',
      'What you display is not what you compute: damp the ETA, as you damp a surge price.',
      'But smoothing must never become hiding — revise upward promptly when the news is bad.',
      'Never accept an order you cannot deliver: the food gets made and nobody collects it.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A three-sided delivery platform whose central mechanism is timed dispatch — scheduling a courier to arrive as food becomes ready, against a prep-time distribution predicted from kitchen queue depth, with restaurant capacity as a learned rate limit and three parallel order state regions.',
    whyItExists:
      'Because joining two independent timelines is the actual problem: arriving early wastes the scarcest resource and compounds at peak, arriving late ruins the product, and the moment of readiness is the quantity the platform can neither control nor directly observe.',
    whenToUse: [
      'Timed dispatch whenever a mobile resource must meet an event you do not control.',
      'A buffer scaled by prediction variance whenever earliness has a cost and the prediction has a spread.',
      'A learned rate limit whenever a participant\'s capacity cannot be scaled and its claim cannot be trusted.',
      'Parallel state regions whenever independent parties act concurrently on one entity.',
      'Display damping whenever a computed value is volatile and trust depends on stability.',
    ],
    whenNotToUse: [
      'Immediate dispatch on order placement.',
      'An advertised prep time as the estimate rather than as a weighted feature.',
      'A point prep estimate, when a buffer and a customer range both need the spread.',
      'An open/closed availability flag for a capacity-limited kitchen.',
      'One state column for three concurrent lifecycles.',
      'Displaying the raw computed ETA.',
      'Accepting orders during a local courier shortage.',
    ],
    alternatives: [
      'Direct kitchen-system integration, which collapses the buffer and makes batching safe — at the cost of a critical-path dependency whose fallback rots.',
      'Batching, which converts courier idle time into food waiting time and is gated by the spread of ready-times.',
      'Sequencing deliveries by food fragility rather than route efficiency, when they conflict.',
      'Precomputed prep curves per restaurant-hour with a runtime queue-depth adjustment, at serving scale.',
      'Dispatch partitioned by geographic region, since dispatch decisions never cross regions.',
    ],
    tradeoffs: [
      'Timed dispatch buys ~10,000 couriers at peak and costs a prediction of something unobservable.',
      'A variance-scaled buffer buys earliness matched to uncertainty and costs a predicted distribution.',
      'Queue-depth prediction buys the dominant ETA term and costs training data contaminated by dispatch policy.',
      'A learned rate limit buys protection for earlier orders and costs throttling a restaurant below its claim.',
      'Parallel regions buy representable concurrency and cost an interaction table.',
      'Display damping buys trust and costs deliberate conservatism.',
      'Shedding at peak buys never failing an accepted order and costs the orders not taken.',
    ],
    failureModes: [
      'Immediate dispatch idling thousands of couriers at peak, compounding as supply falls.',
      'Advertised prep times wrong in both directions at the busiest hours.',
      'A boolean availability flag letting a kitchen ruin all its in-flight orders.',
      'One state column unable to represent cancel-while-cooking-while-assigned.',
      'A displayed ETA oscillating and reading as a broken system.',
      'Smoothing becoming hiding — a frozen display over a long wait.',
      'Accepting an undeliverable order, so the food is made and abandoned.',
      'A courier unassigning mid-carry, which has no clean compensation.',
      'A batch whose ready-time spread explodes, holding one order\'s food for another\'s kitchen.',
      'Ready marks issued in response to courier arrival, corrupting the prediction target.',
      'Prediction variance drifting upward, silently moving dispatch earlier.',
    ],
    followUpQuestions: [
      'How many timelines does this order have, and where do they meet?',
      'When is the courier dispatched, and what determines the buffer?',
      'Does the dispatch bias change between peak and off-peak?',
      'Which ETA term has the largest variance, and what predicts it?',
      'Is prep time a point estimate or a distribution?',
      'Is ETA error measured as a mean or a distribution?',
      'Is restaurant availability a flag or a rate, and who sets it?',
      'How does an overloaded restaurant degrade, and in what order?',
      'How many state machines does an order have?',
      'Is the displayed ETA the computed ETA?',
      'What happens when no courier can serve an area?',
    ],
  },
});
