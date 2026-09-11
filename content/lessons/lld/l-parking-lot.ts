import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-parking-lot',
  title: 'Design a parking lot',
  summary:
    'The compatibility between a vehicle and a spot is a relation rather than a size comparison, extensibility means a table row rather than a class, and two cars arriving at once is the inventory race in miniature.',
  phase: 'lld',
  module: 'machine-coding',
  position: 65,
  kind: 'machine-coding',
  difficulty: 'core',
  estimatedMinutes: 70,
  tags: ['allocation', 'pricing', 'compatibility', 'contention'],
  prerequisites: ['l-pubsub'],
  resources: [
    {
      key: 'refactoring-guru-patterns',
      tier: 'must',
      note: 'Read strategy with two seams in mind at once — allocation and pricing. They are the two the prompt names, and seeing both in one design is what stops strategy being applied to everything else as well.',
    },
    {
      key: 'postgres-explicit-locking',
      tier: 'must',
      note: 'Read it for the conditional update again. Two cars arriving at the same instant is the inventory oversell at a smaller scale, and the resolution is identical — the resource arbitrates, not a lock.',
    },
    {
      key: 'xstate-statecharts',
      tier: 'good',
      note: 'Read it for guarded transitions. The ticket lifecycle is short and its interesting cases are the irregular ones — a lost ticket, an expired payment grace period — which is exactly where guards earn their place.',
    },
    {
      key: 'refactoring-guru-solid',
      tier: 'good',
      note: 'Re-read open-closed here. This problem is the clearest case in the course where the requested extension is satisfied by a data row rather than by a subclass, which is a distinction the principle is usually taught without.',
    },
    {
      key: 'gof-patterns-ref',
      tier: 'advanced',
      note: 'Read the strategy entry\'s intent section. Useful for defending why allocation and pricing are strategies while vehicle type is not — the intent is a varying algorithm, and a vehicle type varies no algorithm.',
    },
  ],

  intuition: {
    body: `The prompt names its seams — **"extensible to new vehicle and spot types" and "different pricing strategies"** — and the mistake is to satisfy the first one with classes.

\`\`\`
Motorcycle · Car · Van · Bus · ElectricCar · Truck
Compact · Regular · Large · Handicapped · Electric
→ 6 × 5 = 30 combinations, as a class hierarchy
\`\`\`

**A new vehicle type then means a new class, a new branch in allocation, and a new branch in pricing.** That is a modification in three places, which is exactly what "extensible" was asking you to avoid.

**The thing that actually varies is data.** A vehicle type is a value with attributes — which spots it fits, what it is charged — **so extensibility means adding a row, not a subclass.**

Then the observation that makes the design: **compatibility is a relation, not an ordering.**

\`\`\`
Naive:  spot.size >= vehicle.size
Reality: a motorcycle fits a compact, a regular, or a
         motorcycle bay
         an electric car needs a charger, so it fits an
         electric spot regardless of size
         a van fits a large spot but not a regular one
\`\`\`

**Size ordering cannot express "needs a charger"**, and it cannot express a vehicle that fits two spot types but not a third. **So compatibility is a lookup table**, and it belongs to neither the vehicle nor the spot — **it is the relationship between them**, which is why a naive design has nowhere to put it and pushes it into a service.

**Third: allocation is a search, and the naive version is a scan.**

Ten thousand spots and a park event every few seconds is fine. **Ten thousand spots scanned for every arrival at a busy airport is not** — so free spots need an index by the thing you search on, which is the compatible spot type.

**And fourth, the one people skip: two cars arriving at the same instant.**

**This is the inventory oversell at a smaller scale**, and the resolution is the same conditional claim: the spot itself arbitrates, and the loser is told instantly and given the next candidate.

**Pricing has one detail that breaks the obvious interface.** A daily maximum is not a rate — **it depends on the whole duration rather than on each hour** — so a pricing interface taking "hours" cannot express it. It has to take the ticket.`,
    analogyLimit:
      '"A parking lot is a collection of spots with sizes" makes compatibility a comparison, and it is a relation: an electric car needs a charger regardless of size, and a van fits large but not regular. Once compatibility is a table, the class hierarchy that the size ordering suggested disappears — and the requested extensibility turns out to mean adding a row. The framing also hides contention entirely, which is the one place this problem is genuinely hard.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate designs: a `Vehicle` hierarchy with `getSize()`; a `Spot` with a size enum and an occupied flag; `park(vehicle)` scanning all spots for the first where `spot.size >= vehicle.getSize()`; and `calculateFee` switching on vehicle type times hours. The interviewer then asks for electric vehicles needing chargers, a daily maximum charge, and a 10,000-spot airport lot. What breaks?',
      answer: `**All three requests break it, and each breaks a different assumption.**

**Electric vehicles break the size ordering, which is the deepest problem.**

\`\`\`
An electric car is car-sized and needs a charger.
  spot.size >= vehicle.size  → matches any regular spot
  → the vehicle is parked where it cannot charge
\`\`\`

**The comparison cannot express a requirement that is not a size**, so the fix is either a second comparison bolted on — \`spot.size >= v.size && (!v.needsCharge || spot.hasCharger)\` — **which grows a clause per attribute** — or the realisation that this was never an ordering.

**It is a relation**, and relations are tables:

\`\`\`
             motorcycle  compact  regular  large  electric
motorcycle        ✓          ✓        ✓       ✓       ✓
car                         ✓        ✓       ✓       ✓
electric car                                          ✓
van                                          ✓
\`\`\`

**And a table is data**, so a new vehicle type is a row — which is what the extensibility requirement was asking for.

**The daily maximum breaks the pricing interface.**

\`\`\`
fee = rate(vehicleType) × hours
A daily cap is not a rate. It is a function of the WHOLE
duration: min(hours × rate, dailyMax × days)
→ and "days" needs the entry and exit times, not a count
   of hours
\`\`\`

**An interface taking hours cannot express it**, and the fix is to pass the ticket — **entry time, exit time, vehicle type** — so a policy can compute anything from the interval.

*And this generalises:* early-bird rates, weekend rates and the first thirty minutes free **are all functions of the interval rather than multipliers on it.** The hours parameter was a premature summary of the input.

**Five hundred spots break the scan.**

\`\`\`
park() scans all spots for the first that fits.
500 spots × an arrival every few seconds: fine.
10,000 spots at an airport on a Friday: a full scan per
arrival, and the scan is over mostly-occupied spots.
\`\`\`

**The fix is an index of free spots by spot type**, so allocation is a lookup into a small set rather than a linear search — **and it must be maintained on park and unpark**, which is the two-structures-must-agree problem from the cache lesson.

**And a fourth thing the interviewer did not ask about, which is the one that bites: two cars arriving at once.**

\`\`\`
Car A: scan → spot 42 is free
Car B: scan → spot 42 is free
Both park in 42.
\`\`\`

**The scan-then-claim is a read-modify-write race**, identical to the inventory oversell. **The fix is the same conditional claim** — mark the spot occupied only if it is still free, and give the loser the next candidate.

**What the corrected shape is.**

\`\`\`
compatibility:  a table, keyed (vehicleType, spotType)
allocation:     a strategy, over an index of free spots
                by spot type
pricing:        a strategy taking the TICKET
claiming:       a conditional state change on the spot
vehicle types:  data rows, not classes
\`\`\`

**Two strategies — the two the prompt named — and no subclasses at all.**

**The transferable diagnostic: when an extension requires a new class *and* a new branch in two methods, the thing that varies is data.** A subclass is the right answer only when the extension carries behaviour.`,
    },
  body: `## Requirements and the invariant

**Five questions, each of which changes something.**

\`\`\`
"Which vehicles fit which spots — is it a size ordering?"
  → no, a relation → a table
"Can several vehicles arrive simultaneously?"
  → yes → a conditional claim
"Pricing: per hour, or are there caps and free periods?"
  → caps → the policy takes the ticket
"How many spots, and how busy?"
  → 10,000 → an index of free spots
"What happens when a ticket is lost?"
  → a real requirement, and a guarded transition
\`\`\`

\`\`\`
INVARIANT
  a spot holds at most one vehicle
  a parked vehicle occupies exactly one spot, compatible
    with it by the compatibility table
  the free-spot index contains exactly the unoccupied spots
  a ticket's fee is a pure function of (entry, exit, vehicle
    type, policy)
\`\`\`

**The third clause is the one that will break**, because it is two structures that must agree — the same shape as the LRU cache's map and list, **so every change to occupancy must touch both in one place.**

## The domain, which is mostly data

\`\`\`ts
type VehicleTypeId = string;      // 'motorcycle' | 'car' | ...
type SpotTypeId    = string;      // 'compact' | 'electric' | ...

interface VehicleType {           // DATA, not a class hierarchy
  id: VehicleTypeId;
  label: string;
}

interface SpotType {
  id: SpotTypeId;
  label: string;
}

/** The relation. Neither the vehicle's nor the spot's alone. */
class Compatibility {
  private readonly fits = new Map<VehicleTypeId, Set<SpotTypeId>>();

  allow(v: VehicleTypeId, s: SpotTypeId): void { /* ... */ }
  accepts(spot: SpotTypeId, vehicle: VehicleTypeId): boolean {
    return this.fits.get(vehicle)?.has(spot) ?? false;
  }
  spotTypesFor(vehicle: VehicleTypeId): readonly SpotTypeId[] { /* ... */ }
}

class Spot {
  private occupiedBy: VehicleId | null = null;
  constructor(readonly id: SpotId, readonly type: SpotTypeId,
              readonly level: number, readonly distanceToEntrance: number) {}

  get isFree(): boolean { return this.occupiedBy === null; }

  /** Conditional claim: returns false if someone else won. */
  tryClaim(vehicle: VehicleId): boolean {
    if (this.occupiedBy !== null) return false;
    this.occupiedBy = vehicle;
    return true;
  }
  release(): void { this.occupiedBy = null; }
}
\`\`\`

**Four decisions worth defending.**

**Vehicle and spot types are data, not classes.** A new type is a row and two table entries — **no subclass, no branch in allocation, no branch in pricing.** This is what the extensibility requirement was asking for, and it is the single most important decision here.

**\`Compatibility\` is its own object** because the relation belongs to neither participant. **A naive design has nowhere to put it and therefore pushes it into a service**, which is how the god service starts.

**\`spotTypesFor(vehicle)\` exists as well as \`accepts\`.** Allocation needs to ask "which spot types could this vehicle use" to consult the right index buckets — **and answering that by testing every spot type is the scan again, one level up.**

**And \`tryClaim\` is conditional and on the spot.** The spot owns its own occupancy, **so it arbitrates** — no lock, and the loser learns from a false return.

## Allocation: a strategy over an index

\`\`\`ts
interface AllocationStrategy {
  choose(candidates: readonly Spot[], v: VehicleTypeId): Spot | undefined;
}

class NearestFirst implements AllocationStrategy {
  choose(c: readonly Spot[]): Spot | undefined {
    return c.reduce((best, s) =>
      !best || s.distanceToEntrance < best.distanceToEntrance ? s : best,
      undefined as Spot | undefined);
  }
}

/** Smallest compatible type first, preserving large spots. */
class BestFit implements AllocationStrategy {
  constructor(private readonly rank: Map<SpotTypeId, number>) {}
  choose(c: readonly Spot[]): Spot | undefined { /* min by rank */ }
}
\`\`\`

**And the index that makes it affordable:**

\`\`\`ts
class FreeSpotIndex {
  private readonly free = new Map<SpotTypeId, Set<Spot>>();

  add(spot: Spot): void    { this.free.get(spot.type)!.add(spot); }
  remove(spot: Spot): void { this.free.get(spot.type)!.delete(spot); }

  candidatesFor(types: readonly SpotTypeId[]): Spot[] {
    return types.flatMap(t => [...(this.free.get(t) ?? [])]);
  }
}
\`\`\`

**Three decisions.**

**The index is keyed by spot type, because that is what allocation searches on.** A motorcycle's candidates are the union of three small sets rather than a scan of ten thousand spots — **and the index is maintained on park and unpark rather than computed on arrival.**

**The strategy chooses from candidates; it does not own the index.** Same reasoning as the LRU cache's eviction policy: **a policy that owned the free set would split the occupancy invariant across two objects.** The lot owns occupancy and the index; the strategy only ranks.

**And best-fit is worth naming as the interesting default.** Nearest-first fills the good spots with whatever arrives; **best-fit puts a motorcycle in a motorcycle bay and preserves large spots for vehicles that need them** — which raises effective capacity at a busy lot, and costs nothing but a comparison.

*The honest limit:* with \`candidatesFor\` returning every free spot of the compatible types, **a nearly-empty lot builds a large array per arrival.** For 10,000 spots that is acceptable; if it were not, **the index would hold a sorted structure per type** and the strategy would take the first — which trades maintenance cost for allocation cost.

## Parking, and the race

\`\`\`ts
park(vehicle: Vehicle, now: number): ParkResult {
  const types = this.compat.spotTypesFor(vehicle.type);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidates = this.index.candidatesFor(types);
    if (candidates.length === 0)
      return { ok: false, reason: 'lot-full', forTypes: types };

    const spot = this.strategy.choose(candidates, vehicle.type);
    if (!spot) return { ok: false, reason: 'lot-full', forTypes: types };

    if (!spot.tryClaim(vehicle.id)) continue;   // ← lost the race

    this.index.remove(spot);                    // both structures,
    const ticket = Ticket.issue(vehicle, spot, now);  //   one place
    this.tickets.set(ticket.id, ticket);
    return { ok: true, ticket };
  }
  return { ok: false, reason: 'contention', forTypes: types };
}
\`\`\`

**Four things worth pointing at.**

**\`tryClaim\` failing is a normal outcome, not an error.** The loser retries with a fresh candidate set — **the same conditional-claim-and-retry as the ride-hailing driver offer and the inventory reservation.**

**The retry is bounded.** Unbounded retry under heavy contention is a spin; **after a few attempts, reporting contention is more honest than looping**, and it is a signal worth alerting on.

**The index removal and the ticket issue happen together, immediately after a successful claim.** If the index and the occupancy can diverge, **allocation starts offering occupied spots** — which manifests as a burst of failed claims rather than as an error.

**And a failure names the spot types it searched.** \`lot-full\` is not enough: **"full for motorcycle, compact and regular" tells the operator which capacity to add**, and it is the result-over-boolean habit applied to a domain answer.

## Pricing: the policy takes the ticket

\`\`\`ts
interface PricingPolicy {
  fee(ticket: ClosedTicket): Money;      // NOT (hours, type)
}

class RateWithDailyCap implements PricingPolicy {
  constructor(
    private readonly hourlyRate: Map<VehicleTypeId, Money>,
    private readonly dailyCap: Map<VehicleTypeId, Money>,
    private readonly freeMinutes: number,
  ) {}

  fee(t: ClosedTicket): Money {
    const minutes = Math.max(0, t.exitAt - t.entryAt) / 60_000;
    if (minutes <= this.freeMinutes) return 0;

    const rate = this.hourlyRate.get(t.vehicleType)!;
    const cap  = this.dailyCap.get(t.vehicleType)!;
    let total = 0;
    let remaining = minutes;
    while (remaining > 0) {                    // cap applies PER DAY
      const dayMinutes = Math.min(remaining, 24 * 60);
      total += Math.min(Math.ceil(dayMinutes / 60) * rate, cap);
      remaining -= dayMinutes;
    }
    return total;
  }
}
\`\`\`

**Three decisions.**

**The policy takes the ticket, not a duration.** A daily cap, an early-bird rate, a weekend rate and a free grace period are all **functions of the interval and its position in time** — none of them can be computed from a count of hours. **The hours parameter was a premature summary.**

**The cap applies per day rather than to the total.** A three-day stay is three capped days, not one — **which is a business rule that a single \`min(total, cap)\` silently gets wrong**, and the loop is the honest expression of it.

**And rates are tables keyed by vehicle type**, so a new vehicle type is an entry rather than a branch. **Same argument as compatibility**, and it is why pricing needs no subclasses either.

*What varies here that the prompt named:* **the policy itself** — flat rate, capped, early-bird, validated-by-a-shop. One interface, several implementations, **and a decorator when a rule wraps another** (a weekend discount over a capped rate) rather than a new implementation combining both.

## The ticket lifecycle

\`\`\`
issued ──park──▶ parked ──request_exit──▶ awaiting_payment
                                                │ pay
                                                ▼
                                              paid ──exit [within grace]──▶ closed
                                                │
                                                └──[grace expired]──▶ awaiting_payment
                                                     (a surcharge applies)

parked ──report_lost──▶ lost_ticket ──pay_lost_fee──▶ paid
\`\`\`

**Four things the diagram decides.**

**Payment precedes exit, and the grace period is a guard.** Paying and then taking twenty minutes to reach the barrier is normal; **taking two hours is another parking session.** The guard makes the difference explicit rather than leaving the gate to decide.

**A lost ticket is a state, not an error.** Its transition has a different fee rule — a flat maximum, since the entry time is unknown — **and it exists because it is a real requirement, not an edge case.**

**\`parked → closed\` is not drawn.** Exit without payment is impossible, **and the absence says so.**

**And every transition records who and when**, so a dispute about a charge has an answer — **the transition log from the ride-hailing and payment lessons, at the smallest useful scale.**

## Tests

\`\`\`ts
test('an electric car cannot take a regular spot', () => {
  expect(compat.accepts('regular', 'electric_car')).toBe(false);
  expect(compat.accepts('electric', 'electric_car')).toBe(true);
});

test('best fit leaves large spots for large vehicles', () => {
  // one compact free, one large free; a car arrives
  expect(lot.park(car, t0).ticket.spot.type).toBe('compact');
});

test('two vehicles racing for the last spot: exactly one parks', () => {
  const spot = onlyFreeSpot();
  expect(spot.tryClaim('v1')).toBe(true);
  expect(spot.tryClaim('v2')).toBe(false);      // the loser knows
});

test('the free index matches actual occupancy after churn', () => {
  // park and unpark 200 times at random, then assert
  expect(index.size()).toBe(lot.spots.filter(s => s.isFree).length);
});

test('a three-day stay is capped per day, not in total', () => {
  expect(policy.fee(ticketOf(72 * 60))).toBe(3 * dailyCap);
});

test('the first 30 minutes are free, the 31st is not', () => { /* ... */ });
\`\`\`

**The fourth test is the invariant check** — the analogue of the ledger's zero-sum and the cache's structure walk. **It catches index drift, which no operation-level test will**, because drift only appears after a sequence.

**And the fifth catches the per-day-cap rule**, which is the pricing bug a single \`min\` produces.

## What to say in the last three minutes

**That compatibility is a relation and therefore a table**, which is why there are no vehicle subclasses.

**That the requested extensibility is satisfied by data** — a row plus two table entries — rather than by a class.

**Two strategies, both named in the prompt**: allocation and pricing. **And nothing else is an interface.**

**That the pricing policy takes the ticket**, because caps and free periods are functions of the interval.

**That the claim is conditional with a bounded retry**, and that the free index and occupancy are mutated together.

**And what you left out:** multi-level routing and signage, reservations, monthly passes, and the physical gate hardware.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'relation-not-ordering',
      title: 'Compatibility is a relation, and that removes the class hierarchy',
      caption:
        'Read the left column as the design a size comparison suggests. Every extension there is a class plus two branches; on the right every extension is a row.',
      code: `flowchart TB
    subgraph ORD["**As a size ordering**"]
      direction TB
      O1["Vehicle (abstract)<br/>getSize()"]
      O1 --> O2["Motorcycle · Car · Van<br/>Bus · ElectricCar · Truck"]
      O2 --> O3["spot.size >= vehicle.size"]
      O3 --> O4["**Electric car breaks it:**<br/>car-sized, needs a charger.<br/>Add a clause:<br/>&& (!v.needsCharge<br/>|| spot.hasCharger)"]
      O4 --> O5["**And a clause per attribute<br/>after that** — handicapped,<br/>oversized, valet-only"]
      O5 --> O6["**A new type = a class<br/>+ an allocation branch<br/>+ a pricing branch**<br/>→ three modifications, which<br/>is what 'extensible' asked<br/>you to avoid"]
    end

    subgraph REL["**As a relation**"]
      direction TB
      R1["Compatibility table<br/>(vehicleType × spotType)"]
      R1 --> R2["motorcycle → {motorcycle,<br/>compact, regular, large}<br/>electric_car → {electric}<br/>van → {large}"]
      R2 --> R3["**It belongs to neither**<br/>the vehicle nor the spot —<br/>which is why a naive design<br/>has nowhere to put it and<br/>pushes it into a service"]
      R3 --> R4["**A new type = one row<br/>+ table entries.**<br/>No class. No branches.<br/>Vehicle types are DATA."]
    end

    D["**The diagnostic:** when an extension<br/>needs a new class AND new branches in<br/>two methods, the thing that varies is data.<br/>A subclass is right only when the<br/>extension carries behaviour."]
    O6 -.-> D
    R4 -.-> D

    style O4 fill:#40181c,stroke:#b4535e
    style O6 fill:#40181c,stroke:#b4535e
    style R4 fill:#17272a,stroke:#35897e
    style D fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'park-path',
      title: 'The park path, and the three things it must get right',
      caption:
        'Step through it. The index makes allocation affordable, the conditional claim makes it correct under contention, and the two must be mutated together or allocation starts offering occupied spots.',
      nodes: [
        { id: 'arrive', label: 'Vehicle arrives', kind: 'client', x: 0, y: 150, detail: 'A vehicle is a type id plus an identifier — data, not a subclass. Its type is the key into the compatibility table and into the rate table, and nothing about it carries behaviour.' },
        { id: 'compat', label: 'spotTypesFor(vehicleType)', kind: 'service', x: 230, y: 150, detail: 'Which spot types could this vehicle use? Answering it by testing every spot type would be the scan one level up, so the relation is indexed in both directions.' },
        { id: 'index', label: 'Free-spot index, keyed by spot type', kind: 'store', x: 470, y: 60, detail: 'A motorcycle\'s candidates are the union of three small sets rather than a scan of 10,000 spots. Maintained on park and unpark rather than computed on arrival — which makes it the second structure that must agree with occupancy.' },
        { id: 'strategy', label: 'AllocationStrategy.choose(candidates)', kind: 'service', x: 470, y: 220, detail: 'Ranks candidates; it does not own the index. A strategy owning the free set would split the occupancy invariant across two objects — the same argument as the eviction policy in the cache lesson. Best-fit preserves large spots for vehicles that need them.' },
        { id: 'claim', label: 'spot.tryClaim(vehicleId)', kind: 'note', x: 730, y: 150, detail: 'The spot owns its occupancy, so it arbitrates. A false return means another vehicle won — a normal outcome, not an error — and the loser retries with a fresh candidate set. Bounded retries, because an unbounded loop under contention is a spin.' },
        { id: 'both', label: 'Remove from index + issue ticket', kind: 'service', x: 970, y: 60, detail: 'Immediately after a successful claim, in one place. If the index and occupancy can diverge, allocation starts offering occupied spots — which appears as a burst of failed claims rather than as an error, and only an invariant test catches it.' },
        { id: 'fail', label: 'Failure names the spot types searched', kind: 'note', x: 970, y: 250, detail: '"Full for motorcycle, compact and regular" tells an operator which capacity to add. A bare lot-full boolean discards the reason, so the caller re-derives it — the result-over-boolean habit in a domain answer.' },
      ],
      edges: [
        { id: 'k1', source: 'arrive', target: 'compat', kind: 'sync' },
        { id: 'k2', source: 'compat', target: 'index', kind: 'read' },
        { id: 'k3', source: 'index', target: 'strategy', kind: 'control' },
        { id: 'k4', source: 'strategy', target: 'claim', kind: 'control' },
        { id: 'k5', source: 'claim', target: 'both', kind: 'write' },
        { id: 'k6', source: 'claim', target: 'fail', kind: 'control' },
      ],
      steps: [
        {
          id: 'ks1',
          title: 'The relation answers which spots are even candidates',
          description:
            'Compatibility is a table because an electric car needs a charger regardless of size. And it is indexed both ways, so asking "which types fit this vehicle" is a lookup rather than a test per type.',
          nodes: ['arrive', 'compat'],
          edges: ['k1'],
        },
        {
          id: 'ks2',
          title: 'The index makes allocation a lookup, not a scan',
          description:
            'Free spots keyed by spot type, maintained on park and unpark. Ten thousand spots scanned per arrival at a busy airport is the cost this removes.',
          nodes: ['index'],
          edges: ['k2'],
        },
        {
          id: 'ks3',
          title: 'The strategy ranks; it does not own the set',
          description:
            'A policy holding the free spots would split the occupancy invariant across two objects. Best-fit is the interesting default: it preserves large spots and costs one comparison.',
          nodes: ['strategy'],
          edges: ['k3'],
        },
        {
          id: 'ks4',
          title: 'And the spot arbitrates, because two cars arrive at once',
          description:
            'The inventory oversell in miniature. A conditional claim on the spot, a false return for the loser, and a bounded retry — unbounded retry under contention is a spin.',
          nodes: ['claim'],
          edges: ['k4'],
        },
        {
          id: 'ks5',
          title: 'Then both structures change together, and failure explains itself',
          description:
            'Index removal and ticket issue in one place, or allocation starts offering occupied spots. And a refusal names the types it searched, so the operator learns which capacity to add.',
          nodes: ['both', 'fail'],
          edges: ['k5', 'k6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `There is no single published system to point at here, and the useful reference is the open-closed principle read carefully — because this problem is the clearest case where the principle is satisfied by data rather than by a subclass.

**The principle says a module should be open for extension and closed for modification.** It does not say extension means inheritance, **and the version that circulates usually implies it does** — which is how a parking lot acquires six vehicle classes.

**The test that distinguishes the two is whether the extension carries behaviour.**

\`\`\`
A new vehicle type: which spots it fits (data)
                    what it is charged (data)
                    → no behaviour → a row
A new pricing rule: an algorithm over the ticket
                    → behaviour → an implementation
\`\`\`

**And the prompt names both extensions in the same sentence**, which is what makes this problem a good teacher: **"extensible to new vehicle types and different pricing strategies" asks for a table in one case and an interface in the other.** A candidate who gives both the same treatment gets one of them wrong, whichever way they go.

**Three transferable lessons.**

**Ask what the extension contains before choosing its mechanism.** Attributes are rows; algorithms are implementations. **The word "extensible" does not choose.**

**A relation between two types belongs to neither.** Compatibility is not the vehicle's property and not the spot's, **so a design with only those two classes has nowhere to put it** — and pushes it into a service, which is the god-service origin story in miniature.

**And data-driven extension is testable in a way inheritance is not.** A compatibility table can be asserted exhaustively — **every vehicle type against every spot type is a small matrix** — whereas a hierarchy of overridden methods has to be tested per subclass, and a forgotten override is silent.

**Where this reading does not help.** It tells you which mechanism to use and nothing about contention, indexing or the ticket lifecycle — **which is where the remaining difficulty of this problem lives**, and all three are invisible until the lot is large or busy.`,
  },

  tradeoffs: {
    intro:
      'The decisions this problem turns on, most of which are about what varies and how it is represented.',
    rows: [
      {
        option: 'Vehicle and spot types as a class hierarchy',
        whenItWins:
          'When a type genuinely carries behaviour that differs — which it does not here.',
        whenItLoses:
          'A new type is a class plus an allocation branch plus a pricing branch: three modifications, which is what extensibility was meant to avoid.',
        cost:
          'Modification in three places per extension, and untestable combinations.',
      },
      {
        option: 'Types as data rows with lookup tables',
        whenItWins:
          'Always here. A new type is a row and two table entries, with no code change.',
        whenItLoses:
          'Type identifiers become strings, so a typo is a runtime rather than a compile-time error.',
        cost:
          'Validation that a referenced type exists, at construction.',
      },
      {
        option: 'Compatibility as a size comparison',
        whenItWins:
          'A lot with one axis of variation and no special requirements.',
        whenItLoses:
          'It cannot express "needs a charger", so each new attribute adds a clause to the comparison.',
        cost:
          'A growing boolean expression that nobody can safely change.',
      },
      {
        option: 'Compatibility as a table',
        whenItWins:
          'Always. It expresses arbitrary relations and can be asserted exhaustively.',
        whenItLoses:
          'The table grows as the product of the two type sets.',
        cost:
          'A matrix to maintain, which is also a matrix you can test.',
      },
      {
        option: 'Scanning all spots for a free compatible one',
        whenItWins:
          'A small lot where the scan is negligible.',
        whenItLoses:
          '10,000 spots scanned per arrival at a busy airport, over mostly-occupied spots.',
        cost:
          'Allocation cost proportional to total capacity rather than free capacity.',
      },
      {
        option: 'A free-spot index keyed by spot type',
        whenItWins:
          'Always at scale. Candidates are a union of small sets.',
        whenItLoses:
          'It must be maintained on park and unpark, so it is a second structure that can diverge.',
        cost:
          'An invariant test, because drift only appears after a sequence.',
      },
      {
        option: 'Nearest-to-entrance allocation',
        whenItWins:
          'Customer experience, and it is what people expect.',
        whenItLoses:
          'It fills large spots with small vehicles, so the lot fills for vans before it is full.',
        cost:
          'Effective capacity for the vehicles that have fewest options.',
      },
      {
        option: 'Best-fit allocation',
        whenItWins:
          'The interesting default — it preserves large spots and costs one comparison.',
        whenItLoses:
          'A motorcycle may be sent to a distant motorcycle bay past a nearby regular spot.',
        cost:
          'Walking distance, traded for capacity.',
      },
      {
        option: 'The strategy owning the free-spot set',
        whenItWins:
          'Nowhere. It looks like a cleaner separation.',
        whenItLoses:
          'It splits the occupancy invariant across two objects, so call order can leave them disagreeing.',
        cost:
          'A consistency bug no type catches.',
      },
      {
        option: 'Scan then mark occupied',
        whenItWins:
          'Single-threaded simulations.',
        whenItLoses:
          'Two vehicles arriving at once both see the same free spot — the inventory oversell in miniature.',
        cost:
          'Two vehicles assigned one spot.',
      },
      {
        option: 'A conditional claim with bounded retry',
        whenItWins:
          'Always. The spot arbitrates, the loser learns instantly, and contention is reported rather than spun on.',
        whenItLoses:
          'Under extreme contention a vehicle may exhaust its attempts.',
        cost:
          'A retry loop and a contention outcome to handle.',
      },
      {
        option: 'Pricing as rate × hours',
        whenItWins:
          'A flat hourly charge with no caps or free periods.',
        whenItLoses:
          'A daily cap, an early-bird rate and a free grace period are all functions of the interval, not multipliers on it.',
        cost:
          'An interface that cannot express the rules the business wants.',
      },
      {
        option: 'A pricing policy taking the ticket',
        whenItWins:
          'Always. Any rule computable from entry, exit and type fits.',
        whenItLoses:
          'The policy must handle the interval arithmetic, including multi-day stays.',
        cost:
          'More logic inside the policy, where it belongs.',
      },
      {
        option: 'Applying a daily cap to the total',
        whenItWins:
          'Nowhere. It is the natural single min().',
        whenItLoses:
          'A three-day stay is charged one day, which is a revenue bug that looks like a rounding detail.',
        cost:
          'Silent undercharging on long stays.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Vehicle is abstract, with Motorcycle, Car and Bus subclasses that each return their size."',
      whyWeak:
        'A vehicle type carries no behaviour here — just which spots it fits and what it is charged, both of which are data. So a new type means a class plus a branch in allocation plus a branch in pricing: three modifications, which is what "extensible to new vehicle types" was asking you to avoid.',
      strongAnswer:
        '"Vehicle and spot types are data — an identifier and a label — because they carry no behaviour. What they participate in is a compatibility table and a rate table, so adding an electric car is a row plus two table entries, with no code change. I would use a subclass only if a type carried an algorithm, and here none does. The prompt asks for two extensions in one sentence and they need different mechanisms: new types want a row, new pricing rules want an implementation."',
    },
    {
      weakAnswer: '"A spot fits a vehicle if spot.size is at least vehicle.size."',
      whyWeak:
        'That is an ordering, and compatibility is a relation. An electric car is car-sized and needs a charger, so a size comparison parks it where it cannot charge — and fixing it by adding a clause means a clause per attribute forever.',
      strongAnswer:
        '"Compatibility is a table keyed by vehicle type and spot type, because it is not an ordering: an electric car needs a charger regardless of size, and a van fits large but not regular. And the table belongs to neither the vehicle nor the spot — it is the relationship between them, which is exactly why a design with only those two classes has nowhere to put it and pushes it into a service. I would index it both ways, so asking which spot types fit a vehicle is a lookup rather than a test per type."',
    },
    {
      weakAnswer: '"park() loops over all spots and takes the first free one that fits."',
      whyWeak:
        'Two problems. It scans total capacity rather than free capacity, so 10,000 spots are examined per arrival at a busy lot. And scan-then-mark is a read-modify-write race: two vehicles arriving at once both see the same free spot.',
      strongAnswer:
        '"Free spots are indexed by spot type, so a motorcycle\'s candidates are the union of three small sets rather than a scan. The allocation strategy ranks those candidates — best fit by default, which preserves large spots for vehicles with fewer options. And the claim is conditional: spot.tryClaim returns false if another vehicle won, which is a normal outcome rather than an error, and the loser retries with a fresh candidate set. Bounded retries, because an unbounded loop under contention is a spin."',
    },
    {
      weakAnswer: '"An EvictionStrategy-style AllocationStrategy owns the set of free spots and hands one out."',
      whyWeak:
        'It splits the occupancy invariant across two objects: the lot knows which spots are occupied and the strategy knows which are free, and nothing enforces that they agree. An incorrect call order leaves them disagreeing, which shows up as allocation offering occupied spots.',
      strongAnswer:
        '"The lot owns occupancy and the free index, and the strategy only ranks candidates it is given. That keeps every pairwise mutation — claim the spot, remove it from the index, issue the ticket — in one method. It is the same argument as the cache\'s eviction policy: a policy that owns the ordering structure splits an invariant across two objects. And I would add an invariant test that parks and unparks a few hundred times at random and then asserts the index matches actual occupancy, because drift only appears after a sequence."',
    },
    {
      weakAnswer: '"calculateFee switches on vehicle type and multiplies the rate by the number of hours."',
      whyWeak:
        'The switch means a new vehicle type modifies pricing, and the hours parameter is a premature summary: a daily cap, an early-bird rate and a free first thirty minutes are all functions of the interval and where it sits in time, none of which a count of hours can express.',
      strongAnswer:
        '"The pricing policy takes the ticket — entry, exit and vehicle type — so any rule computable from the interval fits, and rates are a table keyed by type rather than a switch. The detail worth getting right is that a daily cap applies per day rather than to the total: a three-day stay is three capped days, and a single min against the total silently undercharges. And when a rule wraps another — a weekend discount over a capped rate — I would use a decorator rather than a combined implementation."',
    },
    {
      weakAnswer: '"park returns the spot, or null if the lot is full."',
      whyWeak:
        'Null discards the reason. The caller cannot distinguish a genuinely full lot from one that is full only for this vehicle type, and cannot tell an operator which capacity to add.',
      strongAnswer:
        '"It returns a result: a ticket, or a refusal naming the reason and the spot types it searched. \'Full for motorcycle, compact and regular\' is actionable — it says which capacity is short — and a separate contention outcome distinguishes \'no spots\' from \'lost the race too many times\', which is a signal worth alerting on rather than a customer-facing condition."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lpl-1',
      front: 'Why are vehicle and spot types data rather than classes?',
      back: 'They carry no behaviour — only which spots they fit and what they are charged, both of which are table entries. A subclass is right only when the extension carries an algorithm.',
      topic: 'compatibility',
    },
    {
      id: 'fc-lpl-2',
      front: 'What does a class-per-vehicle-type cost per extension?',
      back: 'A class, an allocation branch and a pricing branch — three modifications, which is what "extensible" was asking you to avoid.',
      topic: 'compatibility',
    },
    {
      id: 'fc-lpl-3',
      front: 'Why is compatibility a relation rather than a size ordering?',
      back: 'An electric car is car-sized and needs a charger, and a van fits large but not regular. A comparison cannot express a requirement that is not a size.',
      topic: 'compatibility',
    },
    {
      id: 'fc-lpl-4',
      front: 'Where does the compatibility table belong, and why?',
      back: 'To neither the vehicle nor the spot — it is the relationship between them, which is why a two-class design has nowhere to put it and pushes it into a service.',
      topic: 'compatibility',
    },
    {
      id: 'fc-lpl-5',
      front: 'Why index free spots by spot type?',
      back: 'Allocation searches on compatible spot types, so candidates become a union of small sets rather than a scan of total capacity.',
      topic: 'allocation',
    },
    {
      id: 'fc-lpl-6',
      front: 'Why must the allocation strategy not own the free-spot set?',
      back: 'It would split the occupancy invariant across two objects, so an incorrect call order leaves them disagreeing and allocation offers occupied spots.',
      topic: 'allocation',
    },
    {
      id: 'fc-lpl-7',
      front: 'What does best-fit allocation buy over nearest-first?',
      back: 'It preserves large spots for vehicles with fewer options, raising effective capacity, and costs one comparison plus some walking distance.',
      topic: 'allocation',
    },
    {
      id: 'fc-lpl-8',
      front: 'What resolves two vehicles arriving at once?',
      back: 'A conditional claim on the spot — it owns its occupancy and arbitrates. The loser gets a false return and retries with fresh candidates.',
      topic: 'contention',
    },
    {
      id: 'fc-lpl-9',
      front: 'Why bound the claim retry?',
      back: 'An unbounded loop under contention is a spin. Reporting contention after a few attempts is honest and is a signal worth alerting on.',
      topic: 'contention',
    },
    {
      id: 'fc-lpl-10',
      front: 'Why must the index removal and the claim happen together?',
      back: 'If occupancy and the index diverge, allocation starts offering occupied spots — appearing as a burst of failed claims rather than an error.',
      topic: 'contention',
    },
    {
      id: 'fc-lpl-11',
      front: 'Why does the pricing policy take the ticket rather than hours?',
      back: 'Daily caps, early-bird rates and free grace periods are functions of the interval and its position in time; hours is a premature summary of the input.',
      topic: 'pricing',
    },
    {
      id: 'fc-lpl-12',
      front: 'What is the daily-cap bug?',
      back: 'Applying the cap to the total rather than per day, so a three-day stay is charged as one — a revenue bug that looks like a rounding detail.',
      topic: 'pricing',
    },
    {
      id: 'fc-lpl-13',
      front: 'Which test catches free-index drift?',
      back: 'Park and unpark a few hundred times at random, then assert the index matches actual occupancy. Drift only appears after a sequence.',
      topic: 'allocation',
    },
    {
      id: 'fc-lpl-14',
      front: 'Why should a park failure name the spot types searched?',
      back: '"Full for motorcycle, compact and regular" tells an operator which capacity to add; a bare null makes the caller re-derive it.',
      topic: 'allocation',
    },
  ],

  quiz: [
    {
      id: 'q-lpl-1',
      kind: 'scenario',
      prompt:
        'An electric car is car-sized and needs a charging spot. What does `spot.size >= vehicle.size` do?',
      options: [
        { id: 'a', label: 'It parks the car in any regular spot, because the comparison cannot express a requirement that is not a size' },
        { id: 'b', label: 'It correctly rejects regular spots, since electric spots are a different size' },
        { id: 'c', label: 'It works if electric spots are given the largest size value' },
        { id: 'd', label: 'It works with an added needsCharge flag on the vehicle' },
      ],
      correct: ['a'],
      explanation:
        'Compatibility is a relation, not an ordering. Option c inverts it — making electric spots largest would let every vehicle use them. Option d works for exactly one attribute and adds a clause per attribute after that, which is how the comparison becomes an expression nobody can safely change.',
      difficulty: 'core',
      topic: 'compatibility',
    },
    {
      id: 'q-lpl-2',
      kind: 'scenario',
      prompt:
        'The prompt says "extensible to new vehicle types and different pricing strategies". What mechanism does each need?',
      options: [
        { id: 'a', label: 'A data row for a vehicle type, an interface implementation for a pricing rule — attributes versus an algorithm' },
        { id: 'b', label: 'Subclasses for both, since both are extensions' },
        { id: 'c', label: 'Interfaces for both, since both are named seams' },
        { id: 'd', label: 'Data rows for both, since both are configuration' },
      ],
      correct: ['a'],
      explanation:
        'The word "extensible" does not choose the mechanism; what the extension contains does. A vehicle type carries attributes — which spots it fits, what it is charged — while a pricing rule carries an algorithm over the ticket. Giving both the same treatment gets one of them wrong whichever way you go.',
      difficulty: 'core',
      topic: 'compatibility',
    },
    {
      id: 'q-lpl-3',
      kind: 'scenario',
      prompt:
        'Two vehicles arrive simultaneously and the allocation strategy picks the same spot for both. What prevents a double assignment?',
      options: [
        { id: 'a', label: 'A conditional claim on the spot — it owns its occupancy, so the second claim returns false and that vehicle retries' },
        { id: 'b', label: 'A lock held around the whole park operation' },
        { id: 'c', label: 'The strategy returns different spots because it is deterministic' },
        { id: 'd', label: 'The free index prevents it, since the spot is removed when chosen' },
      ],
      correct: ['a'],
      explanation:
        'Let the resource arbitrate — the same pattern as the driver offer and the inventory reservation. Option c is backwards: a deterministic strategy makes the collision certain rather than avoiding it. Option d confuses the order: the index is updated after a successful claim, so it cannot be what resolves the race.',
      difficulty: 'core',
      topic: 'contention',
    },
    {
      id: 'q-lpl-4',
      kind: 'scenario',
      prompt:
        'A vehicle stays three days under an hourly rate with a daily maximum. What does `min(hours × rate, dailyMax)` produce?',
      options: [
        { id: 'a', label: 'One day\'s maximum for a three-day stay — the cap applies per day, so it must be computed day by day' },
        { id: 'b', label: 'Three days\' maximum, which is correct' },
        { id: 'c', label: 'The full hourly total, since the cap is exceeded' },
        { id: 'd', label: 'An error, since the duration exceeds a day' },
      ],
      correct: ['a'],
      explanation:
        'A revenue bug that looks like a rounding detail: the customer is charged a third of what they owe, and no test of a short stay catches it. The honest expression is a loop over whole days, which also makes it obvious that the policy needs the interval rather than a count of hours.',
      difficulty: 'advanced',
      topic: 'pricing',
    },
    {
      id: 'q-lpl-5',
      kind: 'scenario',
      prompt:
        'Why should the allocation strategy not hold the set of free spots?',
      options: [
        { id: 'a', label: 'It splits the occupancy invariant across two objects, so an incorrect call order can leave the lot and the strategy disagreeing' },
        { id: 'b', label: 'Strategies must be stateless by definition' },
        { id: 'c', label: 'It would make the strategy harder to swap' },
        { id: 'd', label: 'It would prevent best-fit from working' },
      ],
      correct: ['a'],
      explanation:
        'The same argument as the cache\'s eviction policy: two structures that must agree belong to one owner. The lot mutates occupancy and the index together in one method; the strategy is given candidates and ranks them, which keeps it genuinely swappable as a side benefit.',
      difficulty: 'advanced',
      topic: 'allocation',
    },
    {
      id: 'q-lpl-6',
      kind: 'multi',
      prompt:
        'Which of these should be an interface in this design? Select all that apply.',
      options: [
        { id: 'a', label: 'AllocationStrategy — the prompt names it and it is an algorithm' },
        { id: 'b', label: 'PricingPolicy — named in the prompt, and an algorithm over the ticket' },
        { id: 'c', label: 'Vehicle, with a subclass per type' },
        { id: 'd', label: 'SpotRepository, for storing spots' },
      ],
      correct: ['a', 'b'],
      explanation:
        'Exactly the two the prompt names, and both carry algorithms. Vehicle types carry attributes, so they are rows. And storage was never mentioned as varying — abstracting it is the unearned seam from the SOLID lesson, added because it feels architectural.',
      difficulty: 'core',
      topic: 'pricing',
    },
  ],

  exercises: [
    {
      id: 'ex-lpl-1',
      kind: 'implement',
      title: 'Add reservations, and find the requirement that breaks the model',
      estimatedMinutes: 45,
      prompt: `Extend the parking lot with three features. For each, write the signatures and say what changes in the invariant.

**Part 1 — reservations.** A driver reserves a spot for a future arrival window. A reserved spot may not be given to a walk-in during that window, and an unclaimed reservation expires.

**Part 2 — monthly passes.** A pass holder parks free, is guaranteed a spot on a specific level, and the pass is checked at entry rather than at exit.

**Part 3 — an operator dashboard** showing, per level and per spot type: occupied, free, reserved, and the current fill rate.

**Part 4.** One of these three cannot be satisfied by the existing model without changing a core decision. Identify it, say which decision, and give the options.

Then answer:

- In Part 1, what does the free-spot index contain during a reservation window?
- Should a pass holder who finds their level full be turned away?`,
      rubric: [
        'Reservation modelled with a window and an expiry, not a permanent hold.',
        'States how a reserved spot interacts with the free index.',
        'Monthly pass handled as an entry-time check with a fee policy of zero.',
        'Identifies the level guarantee as the problematic requirement.',
        'Dashboard derived from existing state rather than maintained separately.',
        'Names which core decision the guarantee breaks.',
        'Gives at least two options with costs.',
        'Answers the index question precisely.',
        'Takes a defensible position on the full-level case.',
      ],
      modelAnswer: `**Part 1 — reservations**

\`\`\`ts
interface Reservation {
  id: ReservationId;
  spotId: SpotId;
  vehicleType: VehicleTypeId;
  windowStart: number;
  windowEnd: number;           // expiry: unclaimed after this
  state: 'held' | 'claimed' | 'expired' | 'cancelled';
}

class Spot {
  private occupiedBy: VehicleId | null = null;
  private reservation: ReservationId | null = null;
  private reservedUntil = 0;

  isAvailableTo(vehicle: VehicleId, res: ReservationId | null,
                now: number): boolean {
    if (this.occupiedBy !== null) return false;
    if (this.reservation === null) return true;
    if (now > this.reservedUntil) return true;      // lapsed
    return this.reservation === res;                // the holder
  }

  tryClaim(vehicle: VehicleId, res: ReservationId | null,
           now: number): boolean {
    if (!this.isAvailableTo(vehicle, res, now)) return false;
    this.occupiedBy = vehicle;
    this.reservation = null;
    return true;
  }
}
\`\`\`

**Three decisions worth defending.**

**The reservation's expiry is stored on the spot, not enforced by a timer.** \`reservedUntil\` is data, **so a lapsed reservation frees the spot on the next read whether or not any sweeper ran** — the same stored-deadline pattern as the hold in the e-commerce design and the offer in ride-hailing. **Three designs, one mechanism.**

**\`tryClaim\` takes the reservation id**, so the conditional claim now expresses "free, or reserved for you". **The arbitration stays on the spot** and the predicate simply grew — which is exactly what happened when the e-commerce lot gained multi-warehouse allocation.

**And a claimed reservation clears the hold**, so the spot is occupied rather than both occupied and reserved. **Two flags that can both be set is a state nobody enumerated.**

*The invariant gains a clause:* **a free spot is available to a walk-in only if it is unreserved or its reservation has lapsed.** Which is where Part 1's closing question lives.

---

**Part 2 — monthly passes**

\`\`\`ts
interface Pass {
  id: PassId;
  vehicleId: VehicleId;
  vehicleType: VehicleTypeId;
  guaranteedLevel: number;
  validFrom: number;
  validUntil: number;
}

class FreeForPassHolders implements PricingPolicy {
  constructor(private readonly inner: PricingPolicy,
              private readonly passes: PassStore) {}
  fee(t: ClosedTicket): Money {
    return this.passes.wasValidAt(t.passId, t.entryAt)
      ? 0 : this.inner.fee(t);
  }
}
\`\`\`

**Two decisions.**

**The pass is checked at entry and recorded on the ticket**, not looked up at exit. **A pass that expires mid-stay should not retroactively make the stay chargeable** — so validity is evaluated at entry and the answer travels with the ticket. **This is the store-what-you-promised pattern for the fourth time in the course.**

**And free parking is a decorator over the existing policy rather than a new one.** A pass holder pays nothing; **everyone else falls through to whatever the underlying policy is**, so caps and grace periods continue to work unchanged and the two rules compose.

*The invariant is unchanged so far.* **The level guarantee is the part that is not**, which is Part 4.

---

**Part 3 — the operator dashboard**

\`\`\`ts
interface LevelStats {
  level: number;
  byType: Map<SpotTypeId, {
    total: number; occupied: number; free: number; reserved: number;
  }>;
  fillRate: number;              // occupied / total
}

class Dashboard {
  constructor(private readonly lot: ParkingLot) {}
  snapshot(now: number): LevelStats[] { /* derived from spots */ }
}
\`\`\`

**One decision, and it is the whole answer: derive, do not maintain.**

**A separately maintained set of counters is a third structure that must agree with occupancy and the index** — and the lesson already has one pair that can drift. **Adding counters triples the number of places a park operation must update**, and dashboard numbers being slightly wrong is exactly the kind of bug nobody notices for months.

*And the cost is nothing that matters:* iterating 10,000 spots to build a snapshot is microseconds, **and the dashboard refreshes every few seconds rather than per arrival.** If it ever mattered, **the free index already holds free counts per type**, so the derivation is mostly a lookup.

*The invariant is unchanged*, which is the signal that this feature belongs where it is: **a read model over existing state adds no new consistency requirement.**

---

**Part 4 — the requirement that breaks the model**

**The monthly pass's guaranteed level breaks it, and the decision it breaks is that a spot is claimed only on arrival.**

\`\`\`
"Guaranteed a spot on level 2"
→ if level 2 is full when the pass holder arrives, the
  guarantee has already failed
→ and nothing in the design reserves capacity in advance
→ a guarantee that is only checked at arrival is not
  a guarantee; it is a preference
\`\`\`

**The core decision is that occupancy is first-come-first-served.** Every mechanism so far — the conditional claim, the free index, the allocation strategy — **assumes a spot is allocated at the moment a vehicle arrives.** A guarantee requires capacity to be withheld *before* anyone arrives, which is a different model.

**Three options, with costs.**

**(a) Physically ring-fence capacity.** Mark N spots on level 2 as pass-only; walk-ins never see them.

\`\`\`
Simple, and it satisfies the guarantee exactly.
Cost: those spots sit empty whenever pass holders are absent
      — the utilisation loss is the number of passes times
      the fraction of time they are away
\`\`\`

**This is what real car parks do**, and it is honest: **the guarantee is paid for with idle capacity, and the pass price should reflect that.**

**(b) Over-subscribe with a probability model.** Sell more passes than ring-fenced spots, assuming not all arrive at once — **the airline model.**

\`\`\`
Better utilisation.
Cost: the guarantee occasionally fails, so it is no longer
      a guarantee — it is a high-probability promise plus
      a compensation policy
\`\`\`

**And the compensation has to be designed** — a nearby level, valet parking, a refund — **because "occasionally fails" without a remedy is just a broken promise.**

**(c) Dynamic reservation on a predicted arrival.** Hold a spot when a pass holder's usual arrival window approaches.

\`\`\`
Best utilisation of the three.
Cost: it depends on a prediction, and it holds spots for
      people who do not come — so it degrades to (a) with
      extra machinery when the prediction is poor
\`\`\`

**I would build (a) and price it accordingly**, and say why: **the guarantee is the product being sold, so satisfying it with idle capacity is the cost of goods rather than a design flaw.** Option (b) is defensible if the business explicitly accepts a failure rate and funds a compensation path — **but that is a product decision, not one I would make silently.**

*And the design consequence of (a) is small*, which is worth noting: **a \`passOnly\` flag on a spot, excluded from the walk-in index and included in a pass-holder index.** The mechanism already exists; what changes is that capacity is partitioned rather than shared.

---

**What does the free-spot index contain during a reservation window?**

**The reserved spot stays in the index, and the claim predicate excludes it.** Which is the opposite of the intuitive answer, and it is the right one for three reasons.

\`\`\`
Option A — remove it from the index while reserved
  · a walk-in never sees it: correct
  · but the index no longer means "free spots"
  · and the RESERVATION HOLDER also cannot find it,
    because allocation reads the same index
  · so a second, parallel index is needed for holders
    → two indexes to keep in agreement

Option B — keep it, and let tryClaim reject walk-ins
  · the index means "unoccupied spots", which is a
    simpler and stable definition
  · the holder finds it through the normal path, and the
    predicate lets them through
  · a walk-in that picks it loses the claim and retries —
    which is the contention path that already exists
\`\`\`

**Option B reuses the retry path instead of adding a structure**, and that is the deciding argument: **a lost claim is already a normal outcome, so a reserved spot is just another way to lose one.**

*The cost is real and small:* **wasted claim attempts when many spots in a type are reserved.** With 50 reserved spots out of 60 free, a walk-in may lose several claims before finding one — **which is why the retry is bounded and why the contention outcome exists.**

*And the mitigation if that became common:* **keep the index as "unoccupied" but sort or partition by reservation state**, so the strategy prefers unreserved spots. **That is a ranking change in the strategy rather than a second index** — which keeps one structure, and is the right escalation.

**The invariant becomes:** *the index contains exactly the unoccupied spots; availability to a particular vehicle is a predicate on top.* **Cleaner than the original, because "unoccupied" is a property of the spot alone** while "available" depends on who is asking — **and separating them is what stops a second index from being needed.**

---

**Should a pass holder who finds their level full be turned away?**

**No — and the interesting part is what the alternative costs.**

**Turning them away is the worst available outcome.** They have paid for a guarantee, the guarantee failed, **and refusing entry converts a service failure into a total one.** The lot may well have space elsewhere.

**So the fallback ladder is:**

\`\`\`
1. A spot on the guaranteed level        the promise
2. A compatible spot on another level    the promise broken,
                                         service preserved
3. Any compatible spot                   as above
4. Turned away                           only if the whole lot
                                         is full for their type
\`\`\`

**And every step below the first should be recorded as a guarantee breach**, not silently absorbed. **Three reasons that matters.**

**It is the metric that says whether the ring-fence is sized correctly.** A breach rate above zero means too few pass-only spots, **and it is the only signal that says so before customers complain.**

**It drives the compensation the business promised** — a refund, a free day, whatever the product says. **A breach nobody recorded cannot be compensated.**

**And it distinguishes two failures that look alike.** "Level 2 was full" and "the lot was full" are different problems with different fixes — **the first is a partitioning error, the second is a capacity error** — and only a recorded reason tells them apart.

*Which is the park-result-names-its-reason habit again*, applied to a guarantee rather than to capacity: **the refusal or the downgrade must carry why, or the operator cannot act on it.**

*One product refinement worth offering:* **tell the pass holder at the barrier, not after they have driven to level 2 and found it full.** The system knows at entry; **surfacing it immediately turns a wasted five minutes into a redirection** — and that is a design consequence of checking the pass at entry rather than at exit, which Part 2 already chose for a different reason.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lpl-1',
      level: 'basic',
      question: 'Design a parking lot.',
      guidance:
        'Look for compatibility as a relation and types as data. A vehicle class hierarchy with getSize() is the standard answer and it breaks on the first extension.',
    },
    {
      id: 'iq-lpl-2',
      level: 'basic',
      question: 'How do you decide which spot a vehicle gets?',
      guidance:
        'An allocation strategy over an index of free spots by type. Strong answers name best-fit and say what it preserves.',
    },
    {
      id: 'iq-lpl-3',
      level: 'intermediate',
      question: 'Add electric vehicles that need charging spots.',
      guidance:
        'A row in the compatibility table and a rate entry — no new class. A candidate adding a needsCharge clause to a size comparison has kept the wrong model.',
    },
    {
      id: 'iq-lpl-4',
      level: 'intermediate',
      question: 'Two cars arrive at the same instant. What happens?',
      guidance:
        'A conditional claim on the spot with a bounded retry. Look for the loser being told instantly and for the index and occupancy changing together.',
    },
    {
      id: 'iq-lpl-5',
      level: 'advanced',
      question: 'Add a daily maximum charge.',
      guidance:
        'The policy must take the ticket rather than hours, and the cap applies per day. Excellent answers note that a single min against the total undercharges long stays.',
    },
    {
      id: 'iq-lpl-6',
      level: 'advanced',
      question: 'The lot has 10,000 spots at an airport. What changes?',
      guidance:
        'A free-spot index keyed by spot type, plus the invariant test that catches drift. Scanning total capacity per arrival is the cost being removed.',
    },
    {
      id: 'iq-lpl-7',
      level: 'followup',
      question: 'Add reservations for a future arrival window.',
      guidance:
        'A stored expiry on the spot and a claim predicate that admits the holder. Look for the index continuing to mean "unoccupied" rather than a second index.',
    },
    {
      id: 'iq-lpl-8',
      level: 'followup',
      question: 'A monthly pass guarantees a spot on a specific level. Can you support it?',
      guidance:
        'Not without ring-fencing capacity, because the design allocates on arrival. The guarantee is paid for with idle capacity, and that is a pricing decision rather than a design flaw.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lpl-1',
      kind: 'what-changes-if',
      prompt:
        'Change the physical constraint: this is a multi-storey lot where vehicles must be directed to a level before they can see whether spots remain, and a wrong direction means driving up three floors and back down. What changes?',
      discussion: `**The design so far assumes allocation and arrival are simultaneous.** Introducing a travel time between the decision and the occupancy makes it a two-phase problem — **and every mechanism in the lesson has to account for the gap.**

**What breaks: the claim happens at the barrier, and the vehicle arrives at the spot minutes later.**

\`\`\`
t=0    barrier: claim spot 2-147, direct to level 2
t=0..3 the vehicle drives
t=3    the vehicle arrives at 2-147
\`\`\`

**For three minutes the spot is claimed but empty**, which is a new state the model does not have. And two things go wrong without it:

**If the spot is not claimed at the barrier**, another vehicle may take it during the drive, **and the first driver arrives at an occupied spot having been directed there** — which is the failure the whole exercise is about.

**If it is claimed and the driver never arrives** — they leave, take a different spot, or cannot find it — **the spot is held indefinitely.**

**So the claim becomes a hold with an expiry**, which is the pattern this course has now reached four times:

\`\`\`
claimed_at_barrier ──arrives──▶ occupied
        │
        └──[now > claimedUntil]──▶ free
\`\`\`

**And the expiry is stored on the spot** rather than enforced by a timer, so a driver who never arrives releases the spot on the next read. **The e-commerce reservation, the ride-hailing offer, the parking reservation and this are the same mechanism** — which is worth saying out loud, because recognising it is faster than deriving it.

**What gets harder: the direction is now a commitment with a cost.**

**A wrong direction costs the driver five minutes**, so the allocation decision matters more than it did. Three consequences:

**Best-fit becomes less attractive.** Sending a motorcycle to a distant motorcycle bay was a small walking cost when the vehicle was already there; **now it is a drive to level 4 past empty spots on level 1.** The strategy needs a distance term, **so the objective becomes a weighted combination of capacity preservation and travel cost** rather than pure best-fit.

**Level-level capacity becomes the unit of decision.** A driver is directed to a *level*, not to a spot, in most real lots — **and then finds a spot themselves.** Which changes the model significantly: **the system allocates level capacity and the driver allocates the spot**, so the free index is consulted per level and the per-spot claim happens only if the lot has per-spot sensors.

*That is the honest version:* **most multi-storey lots direct to a level and count**, because per-spot claiming requires per-spot detection hardware. **The design should ask which it has**, and that is a requirements question with a large consequence.

**And a capacity count per level can be wrong**, because a driver may take a spot on a different level than directed. **So the count must be reconciled against sensors or against entry/exit counts** — a drift problem exactly like the free-index drift, and with the same invariant test.

**What becomes newly possible.**

**The direction can be optimised across vehicles.** With a queue at the barrier, **directing three vehicles to three different levels beats sending all three to the nearest one** — which is a small assignment problem rather than three independent choices.

**And the expiry gives a natural reconciliation point.** A claimed-but-unoccupied spot that expires **is evidence that the direction failed**, so the expiry rate per level is a signal about signage, distance or accuracy.

**What I would build.**

\`\`\`
Ask first:   per-spot sensors, or level counts only?

Per-spot:    claim at the barrier with a stored expiry,
             occupancy confirmed by the sensor,
             expiry rate monitored per level

Level-only:  allocate level capacity with a stored expiry
             per direction, reconcile counts against
             entry/exit, and accept that the per-spot
             invariant does not exist
\`\`\`

**The second is a weaker model and it is what the hardware permits**, which is the kind of constraint that should shape the design rather than be worked around.

**The transferable point:** when a decision and its effect are separated by time, **the decision becomes a hold and the hold needs a stored expiry** — and the rest of the design has to tolerate the intermediate state. **That is the same conclusion as three earlier lessons, and the repetition is the lesson: any allocate-then-arrive gap produces it.**`,
    },
    {
      id: 'al-lpl-2',
      kind: 'debug',
      prompt:
        'A parking system reports "lot full" while cameras show roughly 200 free spots. The condition clears after a restart and returns within a few days. Occupancy sensors are working and the ticket records look correct. Diagnose it.',
      discussion: `**"Clears after a restart and returns over days"** is the signature of accumulating in-memory state drift, and **"the ticket records look correct"** tells you the durable data is fine — **so the divergence is between the durable truth and a derived structure.**

This design has exactly one such structure: **the free-spot index.**

**Hypothesis 1 — the index leaks entries on unpark.**

If a release path fails to add the spot back — an early return, an exception, a code path that clears occupancy without touching the index — **each occurrence permanently removes a spot from allocation.**

\`\`\`
200 missing spots over days, ~3,000 park events/day
→ roughly a 2% leak rate
→ consistent with one uncommon path (a lost ticket, a
   cancelled session, a manual override) not restoring
   the index
\`\`\`

*Why it fits everything:* a restart rebuilds the index from occupancy, **so the condition clears**, and it accumulates again at the same rate. **This is my leading hypothesis**, and the rate points at an uncommon path rather than the main one.

*Check:* every path that sets \`occupiedBy = null\`, and whether each one calls \`index.add\`. **There should be exactly one such method**, and anything else — a lost-ticket flow, an admin release, a cleanup job — is the suspect.

**Hypothesis 2 — claims that lose the race remove the spot from the index anyway.**

If the code removes from the index *before* the conditional claim, or removes on a failed claim:

\`\`\`
vehicle A claims 2-147 successfully → index.remove ✓
vehicle B loses the claim → but also calls index.remove
→ the spot is removed twice
→ when A leaves, index.add restores it once
→ net: correct. But if B's remove happens for a spot
   it never claimed and A never had, the spot is lost
\`\`\`

*Why it fits the timing:* contention is intermittent and higher at busy periods, **so the leak rate would correlate with peak hours** rather than being uniform.

*Check:* the ordering of \`tryClaim\` and \`index.remove\`, and whether the failure branch touches the index. **The lesson's ordering — claim first, then remove — is what makes this impossible**, so an inverted order is the bug.

**Hypothesis 3 — the index is keyed by spot type and a type was renamed or mistyped.**

\`\`\`
index.free = Map<SpotTypeId, Set<Spot>>
A spot with type 'Electric' added to a map initialised
with 'electric'
→ index.get('electric') never returns it
→ and the spot is invisible to allocation forever
\`\`\`

*Why it fits partially:* it would be constant rather than growing, **and it would clear on restart only if the seeding path normalised the case.** *Check:* the set of keys in the index against the set of distinct spot types. **Cheap, and it also catches a type added to configuration but not to the index's initialisation.**

**Hypothesis 4 — the free spots are reserved, not free.**

If reservations exist, **200 spots held by expired-but-not-swept reservations look free on camera and are unavailable to walk-ins** — and if the expiry is enforced by a sweeper rather than checked on read, a stopped sweeper produces exactly this.

*Why the restart clears it:* reservations held only in memory are lost. *Check:* the reservation state of the visibly-free spots, **and whether expiry is evaluated on read or only by a job.** The lesson's stored-deadline design makes this impossible, **so finding a sweeper-only expiry is the bug.**

**Hypothesis 5 — compatibility, not capacity.**

"Lot full" may be accurate *for the requesting vehicle type*. **200 free compact spots and a van arriving is a genuine refusal**, and if the refusal message does not name the types searched, it reads as a false alarm.

*Why it fits:* it would correlate with vehicle type rather than with time, **and a restart would not change it** — which argues against it here. **But it is the cheapest to rule out**, and the reason the lesson insists a refusal names the spot types it searched.

*Check:* whether the refusals cluster by vehicle type, and whether the free spots are compatible with the refused vehicles.

**What I would check first: the index size against the actual count of unoccupied spots.** One comparison, and it distinguishes "the index is wrong" (hypotheses 1–3) from "the index is right and something else refuses" (4–5). **That single number is the diagnosis, and it should be a continuous metric rather than something computed during an incident.**

**Then: enumerate the paths that clear occupancy.** Hypothesis 1 explains the growth rate and the restart behaviour together, **and the fix — one release method touching both structures — is the lesson's own rule.**

**Why "clears after a restart" is the most useful fact.**

It proves the durable state is correct and the derived state is not. **A restart rebuilds the index from occupancy**, so the rebuild is producing the right answer — **which means the incremental maintenance is what diverges.**

**And that is a general diagnostic worth keeping:** when a restart fixes a data problem, **the durable source is fine and something derived from it is drifting.** The question then is only which derivation and on which path.

**The instrumentation this demands.**

**A continuous invariant check: index size versus the count of unoccupied spots.** The single highest-value metric here, **and it is the same check as the ledger's zero-sum and the cache's structure walk.** It should alert on any non-zero difference, because the correct difference is exactly zero.

**A counter per release path.** If there are three ways a spot is released, **each should be counted** — and the one whose count does not match its corresponding index-add count is the leak.

**Refusal reasons broken down by vehicle type and spot type.** "Lot full" is not a metric; **"full for van: searched large" is** — and it distinguishes hypothesis 5 from the rest without any investigation.

**And a periodic reconciliation against the sensors.** The camera count and the system's occupancy should agree, **so a scheduled comparison catches drift in the other direction** — occupancy believing a spot is taken when it is not.

**Transferable:** a derived structure maintained incrementally will drift, and the only reliable defence is **a continuous comparison against the source it derives from.** Operation-level tests cannot catch it because drift appears only after a sequence — **and a restart masking the symptom is what lets it run for days.**`,
    },
  ],

  revision: {
    bullets: [
      'Compatibility is a relation, not a size ordering — an electric car needs a charger regardless of size.',
      'The relation belongs to neither the vehicle nor the spot, which is why a two-class design pushes it into a service.',
      'Vehicle and spot types are data rows, because they carry no behaviour.',
      'A class per vehicle type costs a class plus two branches per extension — three modifications.',
      'The prompt names two extensions needing different mechanisms: a row for types, an interface for pricing.',
      'Ask what the extension contains: attributes are rows, algorithms are implementations.',
      'Index free spots by spot type, so candidates are a union of small sets rather than a scan.',
      'The allocation strategy ranks candidates; it must not own the free set.',
      'Best-fit preserves large spots for vehicles with fewer options, at one comparison and some walking.',
      'Two vehicles arriving at once is the inventory oversell in miniature.',
      'A conditional claim on the spot resolves it: the spot arbitrates and the loser retries.',
      'Bound the retry — an unbounded loop under contention is a spin, and contention is a signal.',
      'Claim, index removal and ticket issue happen together, or allocation offers occupied spots.',
      'A refusal names the spot types searched, so an operator knows which capacity to add.',
      'The pricing policy takes the ticket: caps and free periods are functions of the interval.',
      'A daily cap applies per day — a single min against the total undercharges long stays.',
      'A lost ticket is a state with its own fee rule, not an error.',
      'The invariant test parks and unparks at random, then asserts the index matches occupancy.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A lot of spots allocated by a strategy over a free-spot index, with vehicle-to-spot compatibility as a table, occupancy claimed conditionally on the spot, and pricing as a policy that takes the whole ticket.',
    whyItExists:
      'Because the two extensions the prompt names need different mechanisms — a data row for a type, an interface for an algorithm — and because two vehicles arriving at the same instant is a contention problem that a scan-then-mark design gets wrong.',
    whenToUse: [
      'A lookup table whenever compatibility is a relation rather than an ordering.',
      'Data rows whenever an extension carries attributes rather than behaviour.',
      'An index keyed by the search dimension whenever allocation would otherwise scan.',
      'A conditional claim whenever two actors can select the same resource.',
      'A policy taking the whole record whenever rules depend on an interval.',
    ],
    whenNotToUse: [
      'A class hierarchy for vehicle or spot types.',
      'A size comparison for compatibility.',
      'A full scan of spots per arrival.',
      'A strategy that owns the free-spot set.',
      'Scan-then-mark under any concurrency.',
      'A pricing function taking a count of hours.',
      'A single min against the total for a daily cap.',
      'A bare null for a failed park.',
    ],
    alternatives: [
      'Nearest-first allocation, when customer walking distance outweighs capacity preservation.',
      'A sorted structure per spot type, trading maintenance cost for allocation cost.',
      'A decorator over a pricing policy when a rule wraps another, rather than a combined implementation.',
      'Ring-fenced capacity, when a guarantee must actually hold.',
      'Level-level allocation with reconciliation, when per-spot sensors do not exist.',
    ],
    tradeoffs: [
      'Data-driven types buy row-only extension and cost compile-time type safety on identifiers.',
      'A compatibility table buys arbitrary relations and costs a matrix that grows as a product.',
      'A free-spot index buys allocation proportional to free capacity and costs a structure that can drift.',
      'Best-fit buys effective capacity and costs walking distance.',
      'A conditional claim buys correctness under contention and costs a bounded retry path.',
      'A ticket-taking pricing policy buys expressiveness and costs interval arithmetic inside the policy.',
      'A ring-fenced guarantee buys a promise that holds and costs idle capacity.',
    ],
    failureModes: [
      'An electric car parked where it cannot charge, because compatibility was a comparison.',
      'A new vehicle type requiring a class and two branches.',
      'A scan of 10,000 spots per arrival.',
      'Two vehicles assigned the same spot by scan-then-mark.',
      'An unbounded claim retry spinning under contention.',
      'The free index and occupancy diverging, so allocation offers occupied spots.',
      'A daily cap applied to the total, undercharging a three-day stay.',
      'A pricing interface taking hours, unable to express a free grace period.',
      'A bare "lot full" that cannot say which capacity is short.',
      'A release path that clears occupancy without restoring the index.',
      'Reservation expiry enforced by a sweeper rather than stored on the spot.',
    ],
    followUpQuestions: [
      'Is compatibility an ordering or a relation?',
      'Does a new vehicle type require code changes?',
      'What does allocation search, and is it indexed on that?',
      'Who owns the free-spot set?',
      'What happens when two vehicles pick the same spot?',
      'Is the claim retry bounded, and is contention reported?',
      'Do occupancy and the index change in the same method?',
      'Does the pricing policy see the interval or a count of hours?',
      'Does the daily cap apply per day or to the total?',
      'Does a refusal say which spot types were searched?',
      'Is there a continuous check that the index matches occupancy?',
    ],
  },
});
