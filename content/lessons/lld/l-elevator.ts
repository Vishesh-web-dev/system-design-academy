import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-elevator',
  title: 'Design an elevator system',
  summary:
    'Two kinds of request with different owners, a car whose door and motion states are not independent, and a scheduler that is only testable because the clock is a parameter and the whole system steps.',
  phase: 'lld',
  module: 'machine-coding',
  position: 68,
  kind: 'machine-coding',
  difficulty: 'advanced',
  estimatedMinutes: 75,
  tags: ['scheduling', 'state-machines', 'dispatch', 'simulation'],
  prerequisites: ['l-bookmyshow'],
  resources: [
    {
      key: 'xstate-statecharts',
      tier: 'must',
      note: 'Read it for compound states and guards. A car\'s door and motion states are not independent — doors must not open between floors — and expressing that as a guard rather than as two booleans is the whole modelling decision.',
    },
    {
      key: 'refactoring-guru-patterns',
      tier: 'must',
      note: 'Read strategy again with a cost function in mind. Scheduling here is "which car should take this call", which is a ranking over candidates — the same shape as the parking lot\'s allocation, with time instead of distance.',
    },
    {
      key: 'kent-beck-tdd',
      tier: 'good',
      note: 'Read it for fast deterministic feedback. A simulation is only testable if it steps under your control, so the tick-with-a-clock design is what makes every scheduling assertion arithmetic rather than a wait.',
    },
    {
      key: 'prometheus-histograms',
      tier: 'good',
      note: 'Read it for why a mean hides the tail. Elevator fairness is a wait-time distribution — the ninety-ninth percentile is the person who complains — and a scheduler optimised for average wait can starve a floor invisibly.',
    },
    {
      key: 'gof-patterns-ref',
      tier: 'advanced',
      note: 'Read the state entry for the classic per-state-class form, then reject it here for the reason the patterns lesson gave: this machine is transition-heavy, so a table plus guards is the readable shape.',
    },
  ],

  intuition: {
    body: `The mistake is modelling "a request" as one thing, and it makes the scheduler impossible to write.

**There are two kinds, and they have different owners.**

\`\`\`
HALL CALL   pressed outside, at a floor, WITH A DIRECTION
            → "someone on floor 7 wants to go down"
            → belongs to the SYSTEM
            → any car can serve it; this is what scheduling
              assigns

CAR CALL    pressed inside a car, a destination floor
            → "this car must stop at 3"
            → belongs to THAT CAR
            → not reassignable; the passenger is already inside
\`\`\`

**Conflate them and the central question has no expression.** "Which car should take this?" is meaningful for a hall call and meaningless for a car call — **so a single request type either makes car calls reassignable, which is absurd, or makes hall calls unassignable, which removes the scheduler.**

**And the direction on a hall call is not decoration.** A car travelling up that stops for a passenger going down **has picked up someone it is about to carry the wrong way** — so a down call is served by a car that will be going down when it arrives.

Second: **the car's door and motion states are not independent**, and modelling them as two booleans permits a state that must never exist.

\`\`\`
isMoving = true, doorsOpen = true
→ representable, catastrophic, and nothing rejects it
\`\`\`

**So it is one machine with compound states and guards** — you cannot transition to moving while the doors are anything but closed — **and the guard is the safety property written down.**

Third, the thing that decides whether you can test any of this: **an elevator is a time-driven system.**

\`\`\`ts
system.tick(now);        // the whole design steps
\`\`\`

**Nothing happens spontaneously.** A car moves because a tick advanced it, doors close because a tick found the dwell time elapsed — **so a test asserts a sequence of states after a sequence of ticks**, with no sleeping and no flakiness. **The clock as a parameter, for the third time in this module, and here it makes the entire problem tractable.**

**And finally: the obvious scheduler is bad in a specific way.** Sending the nearest car to every call **reverses direction constantly and starves distant floors** — so the discipline is to keep going in one direction while there is anything to serve that way.`,
    analogyLimit:
      '"An elevator takes requests and visits floors" hides the distinction the whole design rests on: a call from a landing belongs to the system and can be given to any car, while a call from inside belongs to that car and cannot be moved. It also hides that a hall call carries a direction, so serving it with a car heading the other way means carrying the passenger away from where they are going — which looks like a scheduling success and is a product failure.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate models a `Request { floor: number }` queue per elevator, assigns each new request to the nearest idle car (or the nearest car if none are idle), and has each car sort its queue and visit floors in order. Buttons inside and outside are the same request type. Identify four problems and rank them.',
      answer: `**Problem 1 — one request type cannot express the system\'s central question.**

**A call from inside belongs to that car; a call from a landing belongs to the system.** With one type, the design must either allow a passenger\'s destination to be reassigned to another car — **which strands them** — or forbid reassignment entirely, **which means a car that breaks down takes its hall calls with it.**

**And the missing direction is the second half.** A hall call with no direction cannot distinguish "wants to go up" from "wants to go down", **so a car travelling up stops for a passenger who then rides to the top before descending.** That is a correct visit and a terrible service.

**Problem 2 — sorting the queue by floor produces constant direction reversal.**

\`\`\`
Car at floor 5, queue {3, 8, 2, 9}
Sorted ascending: visit 2, 3, 8, 9
  → travel down 3 floors, then up 7
Nearest-first: 3, 2, 8, 9
  → down, down, up 6, up 1 — and any new call at 4
    reverses it again
\`\`\`

**Every reversal costs the deceleration and acceleration of a loaded car**, and it means a passenger inside travelling to 9 watches the car go down first.

**The discipline that fixes it is directional service**: keep moving one way while anything remains to be served in that direction, **then reverse.** Which is why the car needs a direction as part of its state rather than just a target floor.

**Problem 3 — the nearest-idle-car rule starves floors and ignores load.**

\`\`\`
Nearest by distance says nothing about:
  · which way the car is already going
  · how many stops it already has
  · how long this call has already waited
\`\`\`

**A car one floor away heading the other way with six stops queued is worse than a car four floors away heading toward you with none** — and distance cannot see that. **The result is a distribution with a long tail:** most waits are short, **and the top floor at 9 a.m. waits three minutes.**

*The fix is a cost function* — estimated time to serve, including current direction, queued stops and the call\'s existing wait — **and picking the minimum.** Which makes scheduling a ranking over candidates, the same shape as the parking lot\'s allocation.

**Problem 4 — no car state machine, so the unsafe state is representable.**

**"Visit floors in order" has no notion of doors.** A design with \`isMoving\` and \`doorsOpen\` as independent flags **permits moving with the doors open**, and nothing in the type system objects.

**And there is no dwell time**, so doors have no duration and a passenger has no time to enter — **which means the simulation cannot express the thing that dominates real elevator timing.**

**What the corrected shape is.**

\`\`\`ts
type HallCall = { floor: number; direction: 'up' | 'down';
                  requestedAt: number; assignedTo?: CarId };
type CarCall  = { carId: CarId; floor: number; requestedAt: number };

interface Scheduler {
  assign(call: HallCall, cars: readonly CarSnapshot[],
         now: number): CarId | undefined;     // a cost ranking
}

// One machine, compound states, guards:
type CarState =
  | { motion: 'idle' }
  | { motion: 'moving'; direction: Direction; doors: 'closed' }
  | { motion: 'stopped'; doors: 'opening' | 'open' | 'closing';
      openedAt: number };
\`\`\`

**Two request types, a cost-based scheduler, and a state type in which moving with open doors cannot be written down.**

**The transferable diagnostic: when a design has one type for two things with different owners, the question "who decides?" has no answer.** Splitting the type is what makes the scheduler expressible at all.`,
    },
  body: `## Requirements and the invariant

**Five questions, each with a consequence.**

\`\`\`
"Do landing buttons have a direction?"       → yes → two types
"Can a hall call be reassigned?"              → yes → assignment
                                                  is a hold
"How long do doors stay open?"                → a dwell time, and
                                                  the simulation needs it
"Is there a capacity limit per car?"          → full cars skip calls
"What is the fairness requirement?"           → a wait-time bound,
                                                  not an average
\`\`\`

\`\`\`
INVARIANT
  a car never moves unless its doors are closed
  a car call is served only by the car it was made in
  a hall call is assigned to at most one car at a time
  every hall call is eventually served — no call waits
    unboundedly
  the simulation advances only on tick()
\`\`\`

**The first clause is a safety property and the fourth is a liveness one**, and they fail differently: **the first is prevented by construction, and the fourth can only be checked over time** — which is why the simulation exists.

## Two request types

\`\`\`ts
type Direction = 'up' | 'down';

interface HallCall {
  floor: number;
  direction: Direction;          // NOT optional
  requestedAt: number;
  assignedTo?: CarId;            // reassignable
  assignedAt?: number;
}

interface CarCall {
  carId: CarId;                  // belongs to this car, permanently
  floor: number;
  requestedAt: number;
}
\`\`\`

**Three decisions worth defending.**

**The direction is required on a hall call.** A car heading up should not stop for someone going down, **because it would then carry them further from their destination** — and a design without the direction cannot express the difference between a good stop and a bad one.

**\`assignedTo\` is optional and mutable.** Assignment is a *hold*, not a binding: **a car that becomes unavailable — a fault, a full load, a service mode — must give its hall calls back** so another car can take them. **The fifth appearance of the hold pattern**, and here the expiry is a reassessment rather than a deadline.

**And a car call has no assignment at all**, because there is nothing to decide. **The passenger is already inside.**

*One thing this separation buys immediately:* **deduplication differs per type.** Two people pressing "down" on floor 7 is one hall call; **two people inside pressing 3 is also one car call** — but a hall call for floor 7 down and a car call for floor 7 are different events, and merging them would lose the direction.

## The car state machine

\`\`\`ts
type CarState =
  | { kind: 'idle'; floor: number }
  | { kind: 'moving'; from: number; to: number;
      direction: Direction; arrivesAt: number }
  | { kind: 'doors_opening'; floor: number; completesAt: number }
  | { kind: 'doors_open'; floor: number; closesAt: number }
  | { kind: 'doors_closing'; floor: number; completesAt: number };
\`\`\`

**Four things this shape decides.**

**Moving with the doors open is unrepresentable.** The \`moving\` variant has no door field, **so the unsafe state cannot be written down** — which is stronger than a guard that must be remembered, and it is the reason for a tagged union rather than two booleans.

**Every timed state carries its completion time.** \`arrivesAt\`, \`closesAt\`, \`completesAt\` — **so the tick compares against a stored deadline rather than counting down**, and the whole system is a pure function of the current time. **The same stored-deadline discipline as every hold in this module.**

**\`doors_open\` has a dwell that can be extended.** A passenger holding the door or a new car call at this floor **pushes \`closesAt\` out**, which is real behaviour and the thing that dominates elevator timing.

**And \`idle\` carries a floor while \`moving\` carries both ends.** A car between floors has no single floor, **so asking "which floor is car 2 on" while it is moving is a question with no answer** — and modelling it as a single mutable field invites a wrong one.

**The transitions:**

\`\`\`
idle ──[has a stop in some direction]──▶ moving
moving ──[now >= arrivesAt AND stopping here]──▶ doors_opening
moving ──[now >= arrivesAt AND not stopping]──▶ moving (next leg)
doors_opening ──[now >= completesAt]──▶ doors_open
doors_open ──[now >= closesAt]──▶ doors_closing
doors_closing ──[now >= completesAt]──▶ idle
\`\`\`

**And the transition not drawn is the safety property:** there is no edge from any door state directly to \`moving\`. **The only way to move is through \`doors_closing\` completing.**

## The tick

\`\`\`ts
class ElevatorSystem {
  tick(now: number): void {
    for (const car of this.cars) this.advance(car, now);   // motion
    this.reassessAssignments(now);                         // holds
    for (const call of this.unassignedHallCalls())
      this.assignIfPossible(call, now);                    // dispatch
  }
}
\`\`\`

**Three properties.**

**Nothing happens spontaneously.** No timers, no background threads, **no behaviour that a test cannot reproduce exactly** — the system is a function from (state, now) to state.

**The order within a tick matters and should be deliberate.** Advancing motion first means assignment sees the current positions; **assigning first would dispatch against stale state by one tick.** Small, and worth choosing rather than inheriting.

**And reassessment happens every tick**, which is what makes assignment a hold: **a call assigned to a car that has since become a worse choice can be moved**, and a call assigned to a failed car is freed.

*The one caution:* **reassignment must be damped.** A call that hops between cars every tick as their relative costs oscillate **serves nobody** — so a reassignment requires the new car to be better by a margin, or a minimum time since the last assignment. **The surge-pricing damping argument, in a much smaller system.**

## Scheduling: a cost function

\`\`\`ts
interface Scheduler {
  cost(call: HallCall, car: CarSnapshot, now: number): number | null;
  //   null = this car cannot serve it (full, out of service)
}

class DirectionalCost implements Scheduler {
  cost(call, car, now) {
    if (car.outOfService || car.atCapacity) return null;

    const d = distance(car.floor, call.floor);
    let estimate = d * TRAVEL_PER_FLOOR;

    // Stops already committed en route add dwell time
    estimate += car.stopsBetween(car.floor, call.floor)
                * (DOOR_CYCLE + DWELL);

    // A car heading the other way must finish its run first
    if (car.direction && car.direction !== call.direction)
      estimate += car.remainingRunTime(now);
    else if (car.direction && !isAhead(car, call))
      estimate += car.remainingRunTime(now);

    // Waiting time counts AGAINST the call being left behind
    const waited = now - call.requestedAt;
    return estimate - waited * STARVATION_WEIGHT;
  }
}
\`\`\`

**Four decisions worth defending.**

**The cost is estimated *time*, not distance.** Distance ignores committed stops and current direction, **which are exactly what determine when a passenger is actually collected.**

**\`null\` means cannot, not expensive.** A full car should be excluded rather than ranked badly, **so the scheduler distinguishes "worse" from "impossible"** — and a call with no eligible car stays unassigned rather than being given to a car that will not stop.

**Waiting time is subtracted**, so an old call becomes cheaper for every car and is eventually the best choice for someone. **That is the liveness property implemented as a term in a cost function** rather than as a special case.

**And the direction comparison is the core of it.** A car going up is a good candidate for an up call above it, **a poor one for an up call below it, and a bad one for a down call anywhere** — three cases from one comparison, and they are what makes the service feel sensible.

## The directional discipline

**A car serves everything in its current direction before reversing.**

\`\`\`
Car at 5, moving up. Stops: {8 (car call), 7-up (hall)}
New calls: 3-down (hall), 2 (car call — impossible, nobody
                              inside asked for 2 going up)
→ serve 7, then 8
→ THEN reverse and serve 3-down
\`\`\`

**Two properties this gives.**

**Bounded reversals.** A car changes direction at most when it runs out of work in the current one, **so a passenger inside does not experience the car going the wrong way** — which is the complaint a nearest-first scheduler generates constantly.

**And a natural ordering.** Within a direction, stops are served in floor order, **so the queue is not a queue at all** — it is two sorted sets, one per direction, **and the car drains one before the other.**

\`\`\`ts
class Car {
  private readonly up = new SortedSet<number>();     // stops above
  private readonly down = new SortedSet<number>();   // stops below
  nextStop(): number | undefined {
    return this.direction === 'up'
      ? this.up.firstAbove(this.floor) ?? this.down.lastBelow(this.floor)
      : this.down.lastBelow(this.floor) ?? this.up.firstAbove(this.floor);
  }
}
\`\`\`

**And the reversal is implicit in the fallback**, which is why this structure is worth choosing: **the discipline is expressed by the data structure rather than by a branch.**

## Testing a simulation

**The payoff of the tick design: every assertion is over a sequence of ticks.**

\`\`\`ts
test('doors never open while moving', () => {
  const sys = scenario(seed(42));
  for (let t = 0; t < 10_000; t += 100) {
    sys.tick(t);
    for (const car of sys.cars)
      expect(!(car.state.kind === 'moving' && hasOpenDoors(car)))
        .toBe(true);                       // unrepresentable, but assert
  }
});

test('no hall call waits longer than the bound', () => {
  const sys = scenario(morningRush(seed(7)));
  for (let t = 0; t < 600_000; t += 100) sys.tick(t);
  const waits = sys.completedCalls.map(c => c.servedAt - c.requestedAt);
  expect(Math.max(...waits)).toBeLessThan(MAX_WAIT_MS);
});

test('a car heading up does not stop for a down call it passes', () => { /* ... */ });

test('a failed car returns its hall calls within one tick', () => {
  sys.fail('car-2', t);
  sys.tick(t + 100);
  expect(callsAssignedTo('car-2')).toHaveLength(0);
});

test('reassignment does not oscillate', () => {
  // assert each call is reassigned at most N times in a run
});
\`\`\`

**Three things about this suite.**

**Invariants are asserted every tick**, not at the end. **A safety property that holds at the end and was violated in the middle is still violated** — and only a per-tick check finds it.

**Fairness is asserted as a maximum, not a mean.** The mean wait can be excellent while one floor waits three minutes, **so the assertion is on the tail** — which is the histogram argument applied to a test.

**And scenarios are seeded.** Morning rush, evening down-peak, lunchtime two-way: **each is a reproducible arrival pattern**, so a scheduling change can be compared against the same traffic rather than against a different random run.

## What to say in the last three minutes

**That there are two request types with different owners**, and that a hall call carries a direction.

**That assignment is a hold and is reassessed**, with damping so calls do not hop between cars.

**That the car state is a tagged union in which moving with open doors is unrepresentable**, and every timed state stores its completion time.

**That the scheduler is a cost function in estimated time**, returning null for cannot-serve, with waiting time subtracted so nothing starves.

**That direction is served to exhaustion before reversing**, and that two sorted sets express it without a branch.

**And that the whole system steps on \`tick(now)\`**, which is what makes every one of these claims testable.

**What you left out:** express zones, multi-bank dispatch, weight sensors, fire-service and maintenance modes, and door-obstruction handling.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'two-call-types',
      title: 'Two kinds of call, and why one type cannot work',
      caption:
        'Read the ownership column. "Which car should take this?" is the system\'s central question, and it is meaningful for exactly one of the two — which is why a single request type makes the scheduler inexpressible.',
      code: `flowchart TB
    subgraph ONE["**One request type**"]
      direction TB
      O1["Request { floor }"]
      O1 --> O2["Assigned to a car"]
      O2 --> O3["**Reassignable?**"]
      O3 --> O4["**Yes** → a passenger's<br/>destination can move to<br/>another car → they are<br/>stranded"]
      O3 --> O5["**No** → a broken car keeps<br/>its landing calls → those<br/>people wait forever"]
      O1 --> O6["**And no direction:**<br/>a car going up stops for<br/>someone going down, then<br/>carries them to the top"]
    end

    subgraph TWO["**Two request types**"]
      direction TB
      T1["**HallCall**<br/>{ floor, direction,<br/>requestedAt, assignedTo? }"]
      T1 --> T2["Owned by the SYSTEM.<br/>Any car can serve it.<br/>**Assignment is a hold** —<br/>reassessed every tick, so a<br/>failed car gives its calls back"]
      T3["**CarCall**<br/>{ carId, floor,<br/>requestedAt }"]
      T3 --> T4["Owned by THAT CAR.<br/>Not reassignable —<br/>**the passenger is<br/>already inside**"]
      T2 --> T5["**'Which car should take this?'<br/>is now expressible** — and it<br/>is the only question the<br/>scheduler answers"]
      T4 --> T5
    end

    style O4 fill:#40181c,stroke:#b4535e
    style O5 fill:#40181c,stroke:#b4535e
    style O6 fill:#40181c,stroke:#b4535e
    style T5 fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'tick',
      title: 'Everything happens on a tick, which is what makes it testable',
      caption:
        'Step through it. Nothing in this system acts spontaneously — which is the property that turns every scheduling and safety claim into an assertion over a sequence of steps.',
      nodes: [
        { id: 'tick', label: 'tick(now)', kind: 'client', x: 0, y: 150, detail: 'The system is a pure function from (state, now) to state. No timers, no threads, nothing that a test cannot reproduce exactly — and the order within a tick is chosen deliberately, since advancing motion before dispatch means assignment sees current positions.' },
        { id: 'advance', label: '1. Advance each car', kind: 'service', x: 240, y: 40, detail: 'Every timed state stores its completion time — arrivesAt, closesAt — so advancing compares against a stored deadline rather than counting down. The same discipline as every hold in this module.' },
        { id: 'state', label: 'Car state: a tagged union', kind: 'store', x: 490, y: 40, detail: 'The moving variant has no door field, so "moving with doors open" cannot be written down. Stronger than a guard that must be remembered — and the reason for a union rather than two booleans.' },
        { id: 'reassess', label: '2. Reassess assignments', kind: 'service', x: 240, y: 180, detail: 'Assignment is a hold, not a binding: a car that faults, fills or goes out of service gives its hall calls back. Damped, because a call hopping between cars every tick as costs oscillate serves nobody.' },
        { id: 'dispatch', label: '3. Dispatch unassigned hall calls', kind: 'service', x: 240, y: 310, detail: 'A cost function per car in estimated time, not distance — distance ignores committed stops and current direction, which are what determine when someone is actually collected. Returns null for cannot-serve, so full cars are excluded rather than ranked badly.' },
        { id: 'starve', label: 'Waiting time subtracted from cost', kind: 'note', x: 490, y: 310, detail: 'An old call becomes cheaper for every car and is eventually the best choice for someone. The liveness property implemented as a term in the cost function rather than as a special case — and asserted in tests as a maximum wait, never a mean.' },
        { id: 'direction', label: 'Two sorted sets, one per direction', kind: 'store', x: 740, y: 180, detail: 'Serve everything above before reversing. The reversal is the fallback in nextStop(), so the directional discipline is expressed by the data structure rather than by a branch — and a passenger inside never watches the car go the wrong way.' },
      ],
      edges: [
        { id: 'e1', source: 'tick', target: 'advance', kind: 'control' },
        { id: 'e2', source: 'advance', target: 'state', kind: 'write' },
        { id: 'e3', source: 'tick', target: 'reassess', kind: 'control' },
        { id: 'e4', source: 'tick', target: 'dispatch', kind: 'control' },
        { id: 'e5', source: 'dispatch', target: 'starve', kind: 'control' },
        { id: 'e6', source: 'state', target: 'direction', kind: 'read' },
      ],
      steps: [
        {
          id: 'ts1',
          title: 'One entry point, and nothing spontaneous',
          description:
            'The system steps only when told to. That single decision is what makes a time-driven design testable — every assertion becomes a sequence of ticks with no sleeping and no flakiness.',
          nodes: ['tick'],
          edges: [],
        },
        {
          id: 'ts2',
          title: 'Motion first, against stored deadlines',
          description:
            'Each car advances by comparing now against its own completion time. And the state type makes the unsafe combination unrepresentable rather than merely guarded.',
          nodes: ['advance', 'state'],
          edges: ['e1', 'e2'],
        },
        {
          id: 'ts3',
          title: 'Then reassess, because assignment is a hold',
          description:
            'A faulted or full car returns its hall calls. Damped by a margin or a minimum interval, or a call oscillates between cars and is served by neither.',
          nodes: ['reassess'],
          edges: ['e3'],
        },
        {
          id: 'ts4',
          title: 'Then dispatch by estimated time, not distance',
          description:
            'Committed stops and current direction decide when someone is actually collected. Null for cannot-serve keeps impossible from being confused with expensive.',
          nodes: ['dispatch', 'starve'],
          edges: ['e4', 'e5'],
        },
        {
          id: 'ts5',
          title: 'And the direction discipline lives in the structure',
          description:
            'Two sorted sets with a fallback: serve everything one way, then reverse. No branch enforces it, which is why it cannot be forgotten.',
          nodes: ['direction'],
          edges: ['e6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `There is no single published elevator design to cite, and the useful reference is the statechart material — because this problem is the clearest case in the course where a state type prevents a safety violation rather than detecting one.

**Statecharts distinguish states that merely differ from states that constrain what may happen next.** A car that is moving and a car whose doors are open are not two flags; **they are exclusive situations, and the exclusivity is the safety property.**

**Expressing that as a tagged union rather than as guards is stronger**, and the difference is worth being precise about:

\`\`\`
Two booleans + a guard:  the unsafe state is representable
                         and rejected by code that must be
                         remembered at every write
Tagged union:            the unsafe state cannot be
                         constructed, so there is nothing
                         to remember
\`\`\`

**A guard is a runtime check and a union is a compile-time impossibility**, and for a safety property that difference is the whole point.

**The second idea worth taking is guards on transitions carrying time.** Every transition here fires on \`now >= someDeadline\`, **so the machine is driven entirely by comparisons against stored times** — which is what lets the whole system be a pure function of the current instant and makes the simulation deterministic.

**Three transferable lessons.**

**Make illegal states unrepresentable where the cost is a safety property.** For an ordinary invariant a guard is fine; **for "doors must not open between floors" the type should refuse.**

**Store deadlines rather than counting down.** A state that knows when it completes can be advanced to any time, **including skipping forward in a test** — whereas a countdown must be stepped through.

**And a transition-heavy machine wants a table plus guards, not a class per state.** Six states here, and the content is which transitions exist — **the patterns lesson\'s rule, and this is the problem that best illustrates it.**

**Where this reference does not help.** It says nothing about dispatch, and dispatch is where the product quality lives: **a perfectly safe car with a bad cost function starves a floor**, and no state machine will tell you.`,
  },

  tradeoffs: {
    intro:
      'The decisions this problem turns on, most of which follow from having two request types and a time-driven system.',
    rows: [
      {
        option: 'One request type for both button kinds',
        whenItWins:
          'Nowhere. It is the obvious modelling.',
        whenItLoses:
          'A car call must not be reassignable and a hall call must be, so one type gets one of them wrong — and the direction has nowhere to live.',
        cost:
          'Either stranded passengers or hall calls trapped on a broken car.',
      },
      {
        option: 'Separate hall and car calls',
        whenItWins:
          'Always. "Which car should take this?" becomes expressible, and it applies to exactly one type.',
        whenItLoses:
          'Two types and two deduplication rules.',
        cost:
          'A little more structure, which is where the scheduler lives.',
      },
      {
        option: 'A hall call without a direction',
        whenItWins:
          'A single-car building where any stop is as good as another.',
        whenItLoses:
          'A car heading up stops for someone going down and carries them further from their destination.',
        cost:
          'A correct visit that is a poor service, invisible in any distance metric.',
      },
      {
        option: 'isMoving and doorsOpen as separate booleans',
        whenItWins:
          'Nowhere for a safety property.',
        whenItLoses:
          'Moving with the doors open is representable, and only a guard that must be remembered prevents it.',
        cost:
          'A runtime check standing in for an impossibility.',
      },
      {
        option: 'A tagged union where the unsafe state cannot be written',
        whenItWins:
          'Always here. The safety property is enforced by construction.',
        whenItLoses:
          'Slightly more verbose transitions.',
        cost:
          'Pattern matching instead of flag checks.',
      },
      {
        option: 'Nearest-car dispatch',
        whenItWins:
          'A quiet building where any car is close and free.',
        whenItLoses:
          'Distance ignores direction, committed stops and waiting time, so a nearby busy car beats a free one heading toward you.',
        cost:
          'A long tail of waits, and constant direction reversal.',
      },
      {
        option: 'A cost function in estimated time',
        whenItWins:
          'Always. It sees direction, queued stops and existing wait.',
        whenItLoses:
          'The estimate needs parameters — travel time, dwell — that must be measured.',
        cost:
          'Calibration, and a ranking per call per car.',
      },
      {
        option: 'Ranking a full car badly',
        whenItWins:
          'Nowhere. It looks like a smaller change than an exclusion.',
        whenItLoses:
          'A car that cannot stop should be excluded, or a call is assigned to a car that will pass it.',
        cost:
          'Confusing impossible with expensive.',
      },
      {
        option: 'Permanent assignment of a hall call',
        whenItWins:
          'A system with no faults and no capacity limits.',
        whenItLoses:
          'A failed or full car takes its calls with it, and those passengers wait indefinitely.',
        cost:
          'A liveness failure with no mechanism to recover.',
      },
      {
        option: 'Assignment as a reassessed hold',
        whenItWins:
          'Always. A faulted car returns its calls within a tick.',
        whenItLoses:
          'Without damping, calls oscillate between cars as relative costs change.',
        cost:
          'A margin or a minimum interval before reassignment.',
      },
      {
        option: 'Serving stops in floor order',
        whenItWins:
          'Nowhere under mixed traffic.',
        whenItLoses:
          'It reverses direction constantly, and a passenger inside watches the car go the wrong way.',
        cost:
          'Acceleration and deceleration of a loaded car, repeatedly.',
      },
      {
        option: 'Directional service with two sorted sets',
        whenItWins:
          'Always. The discipline is expressed by the structure rather than by a branch.',
        whenItLoses:
          'A call just behind the car waits for the full run to complete.',
        cost:
          'A longer worst case for calls in the wrong direction, offset by the starvation term.',
      },
      {
        option: 'Background timers driving the cars',
        whenItWins:
          'A real installation, where time passes on its own.',
        whenItLoses:
          'Tests must sleep, so scheduling assertions become slow and flaky.',
        cost:
          'The entire test suite for the interesting behaviour.',
      },
      {
        option: 'tick(now) driving everything',
        whenItWins:
          'Always in a design being assessed. Every claim becomes a sequence of steps.',
        whenItLoses:
          'A real deployment needs a driver loop around it.',
        cost:
          'One adapter, and determinism everywhere else.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"A Request has a floor, and each elevator has a queue of requests sorted by distance."',
      whyWeak:
        'One type cannot express the system\'s central question. A call from inside belongs to that car and must never be reassigned; a call from a landing belongs to the system and must be reassignable when a car faults. And with no direction on a landing call, a car heading up stops for someone going down and carries them further from where they are going.',
      strongAnswer:
        '"Two types. A hall call has a floor, a direction and an optional assignment — the assignment is a hold that is reassessed every tick, so a car that faults or fills returns its calls. A car call belongs permanently to the car it was pressed in, because the passenger is already inside and there is nothing to decide. Splitting them is what makes \'which car should take this\' expressible at all, and it applies to exactly one of the two."',
    },
    {
      weakAnswer: '"The elevator has isMoving and doorsOpen flags, and we check both before moving."',
      whyWeak:
        'The unsafe state is representable, so preventing it depends on a check being remembered at every write. For a safety property that is weaker than it needs to be.',
      strongAnswer:
        '"A tagged union where the moving variant has no door field at all, so moving with the doors open cannot be constructed. A guard is a runtime check that must be applied everywhere; a union is a compile-time impossibility, and for \'doors must not open between floors\' the type should refuse rather than the code remember. And every timed state stores its completion time, so advancing is a comparison against a stored deadline rather than a countdown."',
    },
    {
      weakAnswer: '"Assign each call to the nearest available elevator."',
      whyWeak:
        'Distance says nothing about which way the car is already heading, how many stops it has committed to, or how long the call has already waited. A car one floor away going the other way with six stops is worse than a free car four floors away heading toward you.',
      strongAnswer:
        '"A cost function in estimated time to serve: travel distance plus the dwell for stops already committed en route, plus the remaining run time if the car is heading the wrong way. It returns null rather than a large number when a car cannot serve the call at all — full or out of service — so impossible is distinguished from expensive. And the call\'s existing wait is subtracted from the cost, which means an old call becomes cheaper for every car and is eventually someone\'s best choice. That is the anti-starvation property implemented as a term rather than as a special case."',
    },
    {
      weakAnswer: '"Each car visits the floors in its queue in sorted order."',
      whyWeak:
        'It reverses direction constantly. A car at floor 5 with stops at 3, 8, 2 and 9 travels down before going up, and every new call below reverses it again — so a passenger inside heading for 9 watches the car descend first, and each reversal costs the deceleration and acceleration of a loaded car.',
      strongAnswer:
        '"Directional service: serve everything in the current direction before reversing. I would hold two sorted sets, stops above and stops below, and nextStop takes the first above when heading up, falling back to the last below — so the reversal is the fallback rather than a branch, and the discipline is expressed by the data structure. A passenger inside then never experiences the car going the wrong way, and reversals are bounded by running out of work."',
    },
    {
      weakAnswer: '"A background thread moves each elevator and fires events as floors are reached."',
      whyWeak:
        'It makes every interesting assertion a timing test. Verifying that a call is served within a bound, or that doors never open while moving, requires sleeping through the scenario — so the tests are slow, flaky, and generally not written.',
      strongAnswer:
        '"The whole system steps on tick(now), so nothing happens spontaneously and the state is a pure function of the current time. A test then runs ten thousand simulated seconds in milliseconds and asserts invariants at every step — and a safety property that holds at the end but was violated in the middle is still a violation, which only a per-tick check finds. A real deployment wraps it in a driver loop; the design itself stays deterministic."',
    },
    {
      weakAnswer: '"Average wait time is the metric, and our scheduler minimises it."',
      whyWeak:
        'A mean hides the tail. A scheduler can achieve an excellent average while one floor waits three minutes at peak, and the person who waits three minutes is the one who complains.',
      strongAnswer:
        '"Fairness is a distribution, so the assertion is on the maximum or the ninety-ninth percentile, not the mean. It is also why waiting time is subtracted from the dispatch cost rather than handled by a separate rule — the liveness property is a term in the objective. And the tests run seeded scenarios, morning rush and evening down-peak, so a scheduling change is compared against the same traffic rather than against a different random run."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lel-1',
      front: 'What are the two request types, and who owns each?',
      back: 'A hall call — floor plus direction — is owned by the system and can be served by any car. A car call belongs permanently to the car it was pressed in.',
      topic: 'dispatch',
    },
    {
      id: 'fc-lel-2',
      front: 'Why does a single request type break the design?',
      back: '"Which car should take this?" is meaningful only for hall calls, so one type either strands passengers or traps hall calls on a broken car.',
      topic: 'dispatch',
    },
    {
      id: 'fc-lel-3',
      front: 'Why must a hall call carry a direction?',
      back: 'A car heading up stopping for a passenger going down carries them away from their destination — a correct visit and a poor service.',
      topic: 'dispatch',
    },
    {
      id: 'fc-lel-4',
      front: 'Why is assignment a hold rather than a binding?',
      back: 'A car that faults, fills or goes out of service must return its hall calls so another car can take them.',
      topic: 'dispatch',
    },
    {
      id: 'fc-lel-5',
      front: 'What must damp reassignment, and why?',
      back: 'A margin or a minimum interval — otherwise a call hops between cars as relative costs oscillate and is served by neither.',
      topic: 'dispatch',
    },
    {
      id: 'fc-lel-6',
      front: 'Why a tagged union rather than isMoving and doorsOpen?',
      back: 'The moving variant has no door field, so the unsafe state cannot be constructed — a compile-time impossibility rather than a guard that must be remembered.',
      topic: 'state-machines',
    },
    {
      id: 'fc-lel-7',
      front: 'Why does every timed state store its completion time?',
      back: 'So advancing is a comparison against a stored deadline rather than a countdown, which makes the system a pure function of the current instant.',
      topic: 'state-machines',
    },
    {
      id: 'fc-lel-8',
      front: 'Why does the scheduler cost time rather than distance?',
      back: 'Distance ignores current direction and committed stops, which are what determine when a passenger is actually collected.',
      topic: 'scheduling',
    },
    {
      id: 'fc-lel-9',
      front: 'Why return null rather than a large cost for a full car?',
      back: 'To distinguish impossible from expensive — otherwise a call is assigned to a car that will pass it without stopping.',
      topic: 'scheduling',
    },
    {
      id: 'fc-lel-10',
      front: 'How is starvation prevented?',
      back: 'Waiting time is subtracted from the cost, so an old call becomes cheaper for every car and is eventually someone\'s best choice — liveness as a term, not a special case.',
      topic: 'scheduling',
    },
    {
      id: 'fc-lel-11',
      front: 'What is the directional discipline, and how is it expressed?',
      back: 'Serve everything in the current direction before reversing — implemented as two sorted sets where the reversal is the fallback in nextStop, so no branch enforces it.',
      topic: 'scheduling',
    },
    {
      id: 'fc-lel-12',
      front: 'Why does the whole system step on tick(now)?',
      back: 'Nothing happens spontaneously, so state is a pure function of the current time and every assertion is a sequence of steps with no sleeping.',
      topic: 'simulation',
    },
    {
      id: 'fc-lel-13',
      front: 'Why assert invariants every tick rather than at the end?',
      back: 'A safety property that holds at the end but was violated in the middle is still violated, and only a per-tick check finds it.',
      topic: 'simulation',
    },
    {
      id: 'fc-lel-14',
      front: 'Why is mean wait time the wrong fairness metric?',
      back: 'It hides the tail: an excellent average is compatible with one floor waiting three minutes, and that is the person who complains.',
      topic: 'simulation',
    },
  ],

  quiz: [
    {
      id: 'q-lel-1',
      kind: 'scenario',
      prompt:
        'Why can a single `Request { floor }` type not support this design?',
      options: [
        { id: 'a', label: 'Hall calls must be reassignable and car calls must not, so one type gets one of them wrong — and the direction has nowhere to live' },
        { id: 'b', label: 'It cannot represent multiple elevators' },
        { id: 'c', label: 'It cannot be sorted efficiently' },
        { id: 'd', label: 'Nothing — the assignment is stored separately' },
      ],
      correct: ['a'],
      explanation:
        'Ownership differs: a passenger inside cannot have their destination moved to another car, while a landing call must move when a car faults. Option d misses that the difference is semantic rather than structural — storing the assignment elsewhere does not make a car call reassignable in a way that makes sense.',
      difficulty: 'core',
      topic: 'dispatch',
    },
    {
      id: 'q-lel-2',
      kind: 'scenario',
      prompt:
        'A car travelling up passes floor 7, where someone has pressed the down button. What should it do?',
      options: [
        { id: 'a', label: 'Continue — a down call is served by a car that will be heading down when it arrives' },
        { id: 'b', label: 'Stop, since it is passing anyway and the stop is free' },
        { id: 'c', label: 'Stop only if it has no other calls above' },
        { id: 'd', label: 'Stop and reverse direction' },
      ],
      correct: ['a'],
      explanation:
        'Stopping collects a passenger the car is about to carry in the wrong direction, which registers as a successful visit and is a poor service. Option c is closer to reasonable — a car with nothing above will reverse anyway — but the decision belongs in the direction matching rather than as a special case at the door.',
      difficulty: 'core',
      topic: 'dispatch',
    },
    {
      id: 'q-lel-3',
      kind: 'scenario',
      prompt:
        'Which model best prevents a car moving with its doors open?',
      options: [
        { id: 'a', label: 'A tagged union whose moving variant has no door field, so the state cannot be constructed' },
        { id: 'b', label: 'Boolean flags with a guard checked before each move' },
        { id: 'c', label: 'An assertion in the tick loop' },
        { id: 'd', label: 'A door sensor that halts the motor' },
      ],
      correct: ['a'],
      explanation:
        'A guard is a runtime check that has to be applied at every write, and an assertion detects the violation after it exists. For a safety property the type should make the state unconstructable. A physical interlock is real and complementary — it protects against software being wrong, which is a different layer.',
      difficulty: 'advanced',
      topic: 'state-machines',
    },
    {
      id: 'q-lel-4',
      kind: 'scenario',
      prompt:
        'Car A is one floor away but heading the other way with six stops queued. Car B is four floors away and free, heading toward the call. Which does a distance-based scheduler pick, and why is that wrong?',
      options: [
        { id: 'a', label: 'A — and it is wrong because distance ignores direction and committed stops, which determine when the passenger is actually collected' },
        { id: 'b', label: 'B, correctly, since it is free' },
        { id: 'c', label: 'A, correctly, since it is nearer' },
        { id: 'd', label: 'Either — the difference is negligible' },
      ],
      correct: ['a'],
      explanation:
        'Car A must finish its run and reverse, plus six door cycles, which is likely a minute or more; car B arrives in a few seconds. A cost function in estimated time sees this and distance cannot — which is also why the same function needs the call\'s existing wait subtracted, to stop distant floors starving.',
      difficulty: 'core',
      topic: 'scheduling',
    },
    {
      id: 'q-lel-5',
      kind: 'scenario',
      prompt:
        'Why does the design step on `tick(now)` rather than using background timers?',
      options: [
        { id: 'a', label: 'Every assertion becomes a sequence of steps with no sleeping, so ten thousand simulated seconds run in milliseconds' },
        { id: 'b', label: 'Timers are unreliable in most languages' },
        { id: 'c', label: 'It reduces CPU usage' },
        { id: 'd', label: 'It is required for thread safety' },
      ],
      correct: ['a'],
      explanation:
        'Testability, and it is decisive here because the interesting properties are temporal: a wait-time bound, a door-safety invariant, a reassignment that does not oscillate. With timers each of those needs a real-time wait, so the tests are slow, flaky and generally never written.',
      difficulty: 'core',
      topic: 'simulation',
    },
    {
      id: 'q-lel-6',
      kind: 'multi',
      prompt:
        'Which of these prevent a hall call waiting indefinitely? Select all that apply.',
      options: [
        { id: 'a', label: 'Subtracting the call\'s waiting time from the dispatch cost' },
        { id: 'b', label: 'Reassessing assignments every tick, so a faulted car returns its calls' },
        { id: 'c', label: 'Asserting a maximum wait in seeded scenario tests' },
        { id: 'd', label: 'Minimising the mean wait time across all calls' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first is the mechanism, the second stops a call being stranded on an unavailable car, and the third is how you know either works. Minimising the mean actively permits starvation — a scheduler can improve its average by consistently deprioritising one floor.',
      difficulty: 'advanced',
      topic: 'scheduling',
    },
  ],

  exercises: [
    {
      id: 'ex-lel-1',
      kind: 'implement',
      title: 'Add capacity, then zones, then the mode that breaks everything',
      estimatedMinutes: 50,
      prompt: `Extend the design with three capabilities. For each, write the signatures and say what changes in the invariant.

**Part 1 — capacity.** A car has a passenger limit. A full car must not be assigned hall calls and must not stop for them, but must still serve its car calls.

**Part 2 — zones and express service.** In a tall building, cars 1–3 serve floors 1–20 and cars 4–6 serve 1 and 21–40, travelling express between.

**Part 3 — fire-service mode.** On alarm, all cars return to the ground floor, doors open, and the system stops accepting calls until reset.

**Part 4.** One of these three invalidates a property the rest of the design relies on. Identify it, say which property, and give the options.

Then answer:

- In Part 1, how does a full car learn it is full, and what should it do with hall calls already assigned to it?
- In Part 3, what happens to a car that is between floors when the alarm sounds?`,
      rubric: [
        'Capacity excludes a car from dispatch via the null cost, not a large cost.',
        'States that assigned hall calls must be returned when a car fills.',
        'Car calls continue to be served by a full car.',
        'Zones modelled as a serviceable-floor predicate per car.',
        'Express travel handled without breaking the directional discipline.',
        'Fire mode identified as the property-breaking capability.',
        'Names the property it breaks and gives at least two options.',
        'Answers the capacity-detection question including its unreliability.',
        'Handles the between-floors case explicitly.',
      ],
      modelAnswer: `**Part 1 — capacity**

\`\`\`ts
interface CarSnapshot {
  // ...
  load: number;                 // estimated occupants
  capacity: number;
  get atCapacity(): boolean { return this.load >= this.capacity; }
}

// In the scheduler:
cost(call, car, now) {
  if (car.outOfService || car.atCapacity) return null;   // EXCLUDED
  // ...
}

// In the car, deciding whether to stop:
shouldStopAt(floor: number): boolean {
  if (this.carCalls.has(floor)) return true;             // ALWAYS
  if (this.atCapacity) return false;                     // skip hall calls
  return this.assignedHallCalls.has(floor, this.direction);
}
\`\`\`

**Three decisions worth defending.**

**Capacity produces \`null\`, not a high cost.** A full car cannot serve the call at all, **and ranking it badly would still let it win when every car is loaded** — which assigns a call to a car that will drive past.

**Car calls are served regardless of load.** The passenger is already inside; **refusing their floor because the car is full is nonsense.** This is the clearest demonstration of why the two call types are different: **one is gated by capacity and the other is not.**

**And a car that becomes full must return its assigned hall calls**, which is the closing question below.

*The invariant gains a clause:* **a hall call is assigned only to a car that can stop for it** — and since capacity changes as passengers board, **that clause must be re-evaluated, which the per-tick reassessment already does.**

---

**Part 2 — zones and express service**

\`\`\`ts
interface Car {
  // ...
  readonly servicedFloors: ReadonlySet<number>;
  canService(floor: number): boolean { return this.servicedFloors.has(floor); }
}

// Scheduler:
if (!car.canService(call.floor)) return null;            // not my zone

// Motion: express legs skip intermediate floors entirely
nextStop(): number | undefined {
  // unchanged — the sorted sets contain only serviced floors,
  // so the express gap is simply an absence of stops
}
\`\`\`

**Two decisions, and the second is the pleasant surprise.**

**Zones are a predicate, not a new scheduler.** \`canService\` returning false yields \`null\` from the cost function — **the same exclusion mechanism as capacity** — so zoning costs one predicate and no scheduling change.

**And express travel needs no special handling at all.** A high-zone car has no stops between floors 1 and 21 **because those floors are not in its sets**, so \`nextStop\` naturally returns 21 and the car travels there without stopping. **The express behaviour falls out of the data.**

*The one thing that does change is the estimate*: travel time between floors 1 and 21 with no intermediate stops is faster per floor than local travel, **so the cost function needs a term for express legs** or it will systematically over-estimate high-zone cars and under-use them.

*And a lobby floor served by both zones is the interesting case:* **floor 1 is in every car's set**, so a call there is contested by all six cars — **which is correct, and it makes the lobby the busiest dispatch decision in the building.**

*The invariant gains:* **a car is assigned only calls on floors it services** — again enforced by the same \`null\`.

---

**Part 3 — fire-service mode**

\`\`\`ts
type SystemMode = 'normal' | 'fire_recall' | 'fire_service' | 'out_of_service';

interface ElevatorSystem {
  setMode(mode: SystemMode, now: number): void;
  tick(now: number): void;
}

// In tick, under fire_recall:
//   · discard ALL hall calls and car calls
//   · every car's only stop becomes the recall floor
//   · on arrival: doors open and STAY open
//   · no new calls accepted
\`\`\`

**Three decisions.**

**Existing calls are discarded rather than queued.** They are not deferred work — **the building is being evacuated**, and holding them would mean the system resumes servicing a five-minute-old call when the alarm clears.

**Doors stay open at the recall floor**, which is a state the normal machine does not have: **\`doors_open\` with no \`closesAt\`.** So the union gains a variant, or \`closesAt\` becomes optional with a documented meaning.

**And the mode is system-wide, not per car.** A building in fire mode has no cars in normal service, **so the mode belongs to the system and every car reads it** — which is simpler than propagating a flag.

*And the part that makes this Part 4:* **the invariant "every hall call is eventually served" is deliberately violated.**

---

**Part 4 — which capability breaks a property**

**Fire-service mode, and the property is the liveness invariant: every hall call is eventually served.**

\`\`\`
Normal:  waiting time is subtracted from cost, so an old call
         eventually wins → bounded wait, guaranteed
Fire:    all calls are discarded → a call that was waiting is
         never served, and no mechanism will serve it
\`\`\`

**Capacity and zoning do not break it**, and it is worth being precise about why: **both exclude a car from a call, and the anti-starvation term still applies across the remaining eligible cars.** A call on floor 30 is served by a high-zone car; a call during a full-car period waits and becomes cheaper. **Liveness holds within the eligible set.**

**Fire mode empties the eligible set for every call, permanently.**

**Three options.**

**(a) Accept the violation and scope the invariant.** Restate it as *"in normal mode, every hall call is eventually served."*

\`\`\`
+ honest, and it matches reality: an evacuating building is
  not serving calls
+ the tests then assert liveness only for normal-mode runs
− the invariant no longer holds unconditionally, so every
  future reader must know the scope
\`\`\`

**(b) Preserve the calls and re-serve them on reset.**

\`\`\`
+ the invariant survives literally
− and it is wrong: after an evacuation nobody is waiting
  where they were twenty minutes ago, so the system would
  dispatch cars to empty landings
\`\`\`

**(c) Model fire mode as outside the system.** The elevator system is stopped and a different controller runs.

\`\`\`
+ the normal system's invariants are untouched because
  it is not running
− and it is a fiction: the same code is executing, so the
  boundary exists only in the description
\`\`\`

**I would take (a) and state the scoped invariant explicitly**, because the honest version is more useful than a preserved one: **the property that matters is "no call is starved by the scheduler", and a building-wide emergency is not the scheduler starving anyone.**

*And the general form:* **a liveness property holds within a mode, and modes are exactly the thing that can suspend it.** Which means **every invariant should be stated with its scope** — and discovering the scope when a mode is added is the normal way to find it.

---

**How does a full car learn it is full, and what about its assigned calls?**

**It does not know reliably, and that is the interesting half of the answer.**

\`\`\`
Load sensor:      a weight sensor gives an estimate —
                  weight ÷ average person is crude, and a
                  trolley or luggage skews it badly
Door beam counts: counting entries and exits drifts, because
                  two people abreast register once
Inference:        a stop where nobody boards suggests full,
                  which is a signal after the fact
\`\`\`

**So "full" is an estimate with error in both directions**, and the design should treat it that way:

**Under-estimating** means the car is assigned a call it cannot serve, **and it arrives and nobody can board** — the passenger waits again, having watched a car arrive and leave.

**Over-estimating** means a car with space is excluded, **which wastes capacity and is invisible** — nobody complains about an elevator that did not come when another did.

*So I would bias toward under-estimating slightly*, because **the visible failure is worse than the invisible one**, and pair it with the after-the-fact signal: **a stop where the load did not change is evidence the car was full**, which can correct the estimate.

**And for calls already assigned to a car that becomes full: return them immediately, in the same tick.**

\`\`\`ts
if (car.atCapacity) {
  for (const call of car.assignedHallCalls) {
    call.assignedTo = undefined;        // back to the pool
    call.assignedAt = undefined;
  }
}
\`\`\`

**Three reasons this is right.**

**The reassessment already runs every tick**, so this is the existing hold mechanism firing on a new condition rather than new machinery. **Assignment was never a binding.**

**Returning them immediately rather than at the next natural reassessment matters**, because a full car may have several calls and **each one left assigned is a passenger watching a full car pass.**

**And the waiting time is preserved on the call**, so a returned call carries its accumulated wait into the next dispatch — **making it cheaper and therefore likely to be picked up promptly.** The anti-starvation term does the work automatically, **which is the payoff of implementing liveness as a cost term rather than as a special case.**

---

**A car between floors when the alarm sounds**

**It completes its current leg to the next floor, then recalls — it does not stop between floors, and it does not open its doors where it is.**

\`\`\`
state: { kind: 'moving', from: 14, to: 15, arrivesAt: t+2s }
alarm at t
→ continue to 15 (2 seconds)
→ then set the only stop to the recall floor
→ travel down, doors open, stay open
\`\`\`

**Three reasons.**

**The state machine has no transition from \`moving\` to a stopped state at a non-floor**, and that is correct rather than an omission: **a car cannot open its doors between floors**, so stopping there strands passengers in a shaft with no exit — **which is worse than two more seconds of travel.**

**The current leg is short by construction.** Floor-to-floor travel is a couple of seconds, **so the delay before recall begins is bounded and small** — and the alternative saves nothing.

**And the direction matters for the recall leg.** A car at 15 moving up when the alarm sounds **completes to 15 and then reverses**, which is the one legitimate immediate reversal in the whole design — **because the directional discipline is a service-quality rule and this is a safety override.**

*One refinement worth naming:* **a car already at a floor with its doors open should close them and recall immediately**, rather than waiting for its dwell to expire. **The dwell exists to let passengers board, and in fire mode nobody should be boarding** — so the mode shortens it to zero.

*And the state consequence:* fire mode needs **a transition from any state to \`recalling\`**, which is the one place a wildcard transition is justified. **Every other transition in this machine is specific, and an emergency override is the exception that should be visibly marked as one.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lel-1',
      level: 'basic',
      question: 'Design an elevator system.',
      guidance:
        'Look for two request types with different owners, and for the direction on a hall call. A single Request type is the standard answer and it makes the scheduler inexpressible.',
    },
    {
      id: 'iq-lel-2',
      level: 'basic',
      question: 'How do you model a car\'s state?',
      guidance:
        'A tagged union where moving with open doors cannot be constructed, with completion times stored per timed state. Two booleans plus a guard is the weaker answer.',
    },
    {
      id: 'iq-lel-3',
      level: 'intermediate',
      question: 'Which car should serve a new landing call?',
      guidance:
        'A cost function in estimated time, with null for cannot-serve and waiting time subtracted. Nearest-car by distance ignores the three things that matter.',
    },
    {
      id: 'iq-lel-4',
      level: 'intermediate',
      question: 'A car is going up and passes a floor where someone wants to go down.',
      guidance:
        'It continues — a down call is served by a car that will be heading down on arrival. Stopping registers as a visit and carries the passenger the wrong way.',
    },
    {
      id: 'iq-lel-5',
      level: 'advanced',
      question: 'How do you stop a floor being starved?',
      guidance:
        'Subtract the call\'s waiting time from the dispatch cost, so it eventually becomes someone\'s best choice. Excellent answers also reject mean wait time as the metric.',
    },
    {
      id: 'iq-lel-6',
      level: 'advanced',
      question: 'How would you test this?',
      guidance:
        'tick(now) with seeded scenarios, invariants asserted every tick, and fairness asserted as a maximum rather than a mean. Background timers make all of that impossible.',
    },
    {
      id: 'iq-lel-7',
      level: 'followup',
      question: 'A car breaks down with three calls assigned to it.',
      guidance:
        'Assignment is a hold reassessed every tick, so the calls return to the pool carrying their accumulated wait — which makes them cheap and therefore picked up promptly.',
    },
    {
      id: 'iq-lel-8',
      level: 'followup',
      question: 'Add capacity limits.',
      guidance:
        'Null from the cost function rather than a large cost, car calls still served, and assigned hall calls returned when a car fills. Strong answers note that "full" is an unreliable estimate.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lel-1',
      kind: 'what-changes-if',
      prompt:
        'Change the input: instead of a direction button on each landing, passengers enter their destination floor at a kiosk in the lobby before choosing a car. What changes?',
      discussion: `**This is destination dispatch, and it is a genuinely better system for a reason worth understanding: it moves information earlier.**

\`\`\`
Conventional:  "someone on 7 wants to go down"
               → the system learns the destination only when
                 they are inside and press a button
Destination:   "someone on 7 wants to go to 2"
               → the system knows both ends BEFORE assigning
\`\`\`

**And knowing both ends changes what the scheduler can do**, which is the whole point.

**What collapses: the two request types become one.**

**A destination request carries origin and destination**, so there is no separate car call — **the passenger presses nothing inside.** The distinction the whole lesson rests on disappears, **because it existed only to model the fact that the system learned the destination late.**

*Which is a useful retrospective observation:* **the two types were a consequence of the input mechanism rather than of elevators.**

**What becomes possible: grouping.**

\`\`\`
Three people at the lobby, destinations 12, 12, 14
Conventional: three hall calls indistinguishable from each
              other, then three car calls discovered later
Destination:  the system knows to put all three in one car,
              and tells them which car before it arrives
\`\`\`

**So the scheduler can batch passengers by destination**, which reduces stops per trip dramatically at peak. **A car serving only floors 12 and 14 makes two stops instead of six** — and stop count, not travel speed, is what dominates round-trip time.

**And the direction question disappears.** A car heading up stopping for a down passenger was a problem because the system could not tell; **with destinations known, the assignment simply never happens.**

**What gets harder, and it is the interesting part.**

**The passenger must be told which car, and must go to it.** A conventional system serves whichever car arrives; **destination dispatch assigns a specific car, so the passenger has to read a display and walk to the right one** — and a passenger who boards the wrong car defeats the grouping.

*Which introduces a failure the conventional design does not have:* **the system's model of who is in which car is a prediction, not an observation.** A car assigned four passengers may receive three.

**And the assignment becomes final at a bad moment.** The kiosk assigns a car, **and the passenger walks toward it** — so reassignment after that point is confusing at best. **The hold becomes much shorter-lived and much harder to revise**, which is the opposite of the conventional design where reassessment every tick was free.

*So the design gains a commitment point:* **before the display, assignment is fluid; after it, it is effectively binding.** That is a new state, and it is worth modelling explicitly rather than discovering it.

**What stays identical.**

**The car state machine**, unchanged — doors, motion, dwell, stored deadlines.

**The tick-driven simulation**, unchanged and more valuable, **because the scheduling is now more sophisticated and therefore needs more testing.**

**The cost function shape**, though its inputs are richer: **it can now estimate the whole journey rather than the pickup**, which makes the estimate better and the function more complex.

**And the starvation term**, still necessary — **a passenger whose destination is unpopular can still be deprioritised**, and the fix is the same.

**What I would build.**

\`\`\`
Replace:  HallCall + CarCall  → DestinationRequest
                                { from, to, requestedAt,
                                  assignedCar?, committedAt? }
Add:      grouping — cost a car for a GROUP of requests,
          not one at a time
          a commitment point after which reassignment is
          avoided
          a boarding-confirmation signal, or accept that
          the model drifts
Keep:     the car state machine, the tick, the cost shape,
          the starvation term
\`\`\`

**The transferable point:** when a system's model is shaped around information it receives late, **moving the information earlier can collapse the model rather than extend it.** The two request types were not a fact about elevators — **they were a fact about buttons** — and a design that treats an input mechanism as domain structure will resist the improvement rather than absorbing it.`,
    },
    {
      id: 'al-lel-2',
      kind: 'debug',
      prompt:
        'A six-car system is reported as "slow at 9 a.m." Average wait is 22 seconds, which is within target. But the top three floors report waits of two to three minutes, and only during the morning peak. The scheduler, state machines and simulation tests all pass. Diagnose it.',
      discussion: `**"Average within target, specific floors terrible, only at peak"** is a distribution problem, and the shape tells you a great deal before any hypothesis: **something systematically deprioritises the top floors when the system is busy.**

**Hypothesis 1 — the anti-starvation term is too weak relative to the travel term.**

\`\`\`
cost = estimate − waited × STARVATION_WEIGHT

At 9 a.m. every car is in the lower floors serving up-traffic.
A call at floor 39 has a large estimate for every car.
If STARVATION_WEIGHT is small, the call must wait a very long
time before its accumulated wait overcomes a 30-floor travel
estimate.
\`\`\`

*Why it fits perfectly:* **the term exists and is insufficient**, which is exactly "the tests pass" — a liveness test asserting a bound of five minutes passes while real users wait three. **This is my leading hypothesis**, and the fix is calibration rather than a new mechanism.

*Check:* the distribution of \`waited × WEIGHT\` against the distribution of \`estimate\` at peak. **If the starvation term never approaches the travel term, it is decorative.**

**Hypothesis 2 — the test scenario does not reproduce the morning pattern.**

Seeded scenarios are only as good as their arrival model. **If \`morningRush\` generates uniform origins, it never produces the real pattern — everyone entering at the lobby going up** — and the top floors are never starved in the test.

*Why it fits:* **the tests pass because they test a different building.** *Check:* the arrival distribution in the scenario against real traffic. **This is a test-validity problem rather than a code problem**, and it is why the seeded scenarios need to be derived from measurements.

**Hypothesis 3 — all six cars are eligible for lobby calls, so they cluster.**

With every car able to serve floor 1 and most demand at floor 1, **the cost function sends whichever car is nearest — and they are all near, because they all just delivered someone and returned.** The result is six cars oscillating in the lower third of the building.

*Why it fits:* **it is emergent rather than a bug**, and it only appears when demand concentrates. *Check:* the distribution of car positions at peak. **Six cars clustered between floors 1 and 12 is conclusive**, and the fix is a parking or zoning policy — **hold one car high during up-peak**, which is a standard technique and costs a little average latency for a large tail improvement.

**Hypothesis 4 — capacity exclusion is removing cars silently.**

If cars fill in the lobby, **they are excluded from every subsequent call via the null cost** — so during up-peak the eligible set is small, **and the calls that lose are the expensive ones, which are the high floors.**

*Why it fits the timing precisely:* it happens only when cars are full, which is only at peak. *Check:* how often the cost function returns null per call, broken down by floor. **A high-floor call seeing five nulls and one eligible car explains the wait directly.**

**Hypothesis 5 — the wait is real and the metric is measuring the wrong thing.**

If "wait" is measured from assignment rather than from the button press, **a call that sits unassigned for ninety seconds records a thirty-second wait.** The average is then within target because the unassigned period is invisible.

*Check:* whether \`servedAt − requestedAt\` or \`servedAt − assignedAt\` is being reported. **If it is the latter, every number in the report is understated** — and that would also explain why the tests pass.

**What I would check first: the position distribution of the cars at peak, and how often the cost function returns null for high-floor calls.** Two measurements from the running system, **and together they distinguish clustering (3), capacity exclusion (4) and an under-weighted starvation term (1)** — which are three different fixes.

**Then: what the wait metric actually measures.** Hypothesis 5 would invalidate the premise entirely, **and it is one line of code to check.**

**Why "the average is within target" is the most misleading fact.**

**It is evidence that the scheduler is optimising the thing it was told to optimise**, and that the thing was wrong. **A scheduler minimising mean wait will deprioritise expensive calls**, because serving one high-floor call costs the time of three lobby calls — **so the average improves by making the tail worse.**

**Which is not a bug in any component.** Every part passes its tests, and **the emergent behaviour is the objective function doing exactly what it says.** That is the signature of an optimisation-target problem rather than a defect.

**The instrumentation this demands.**

**Wait time as a histogram per floor, not an aggregate mean.** The single change that would have surfaced this immediately — **and it is the histogram argument made concrete: the mean is compatible with a floor waiting three minutes, and the p99 per floor is not.**

**The starvation term's contribution, logged per assignment.** How much of the winning car's cost was travel and how much was wait credit? **If the wait credit never decides an assignment, the mechanism is inert** and that is measurable rather than a matter of opinion.

**Car position distribution over time.** Clustering is invisible in any per-call metric and obvious in a heatmap.

**Null-cost counts per call, by floor.** Distinguishes "no car wanted this" from "no car could take this", **which are completely different problems with the same symptom.**

**And scenario fidelity checks.** The seeded morning-rush scenario should be validated against real arrival data periodically — **because a passing test on an unrepresentative scenario is worse than no test**, since it creates confidence.

**Transferable:** when an aggregate metric is healthy and specific users are not, **the optimisation target is the suspect rather than the implementation.** A mean invites the optimiser to trade the tail for the average, and the fix is to change what is being optimised — **which means the metric and the cost function have to be corrected together.**`,
    },
  ],

  revision: {
    bullets: [
      'Two request types with different owners: a hall call belongs to the system, a car call to its car.',
      'One type makes "which car should take this?" inexpressible, and the direction has nowhere to live.',
      'A hall call carries a direction, or a car going up collects someone going down.',
      'Assignment is a hold reassessed every tick, so a faulted or full car returns its calls.',
      'Reassignment must be damped, or a call hops between cars and is served by neither.',
      'Car state is a tagged union where moving with open doors cannot be constructed.',
      'A guard is a runtime check; a union is a compile-time impossibility — use the type for safety properties.',
      'Every timed state stores its completion time, so advancing compares against a deadline.',
      'The scheduler costs estimated time, not distance — distance ignores direction and committed stops.',
      'Return null for cannot-serve, so impossible is distinguished from expensive.',
      'Subtract waiting time from the cost: liveness as a term in the objective, not a special case.',
      'Serve everything in the current direction before reversing.',
      'Two sorted sets with a fallback express that discipline without a branch.',
      'The whole system steps on tick(now), so nothing happens spontaneously.',
      'Assert invariants every tick — a property violated in the middle is still violated.',
      'Fairness is a maximum or a p99, never a mean: an average hides a starved floor.',
      'Seeded scenarios make scheduling changes comparable against the same traffic.',
      'An invariant holds within a mode, and modes are what suspend it.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A tick-driven simulation of several cars, each a tagged-union state machine with stored completion times, serving two kinds of call — reassignable hall calls with a direction, and permanent car calls — dispatched by a cost function in estimated time.',
    whyItExists:
      'Because the system\'s central question is which car should take a landing call, which is only expressible once the two call types are separated — and because a car\'s door and motion states are not independent, which is a safety property the type should enforce.',
    whenToUse: [
      'Separate types whenever two things have different owners and different reassignability.',
      'A tagged union whenever a combination of states must never exist.',
      'A cost function returning null whenever some candidates are ineligible rather than merely worse.',
      'A waiting-time term whenever a greedy objective can starve someone.',
      'tick(now) whenever behaviour is time-driven and must be tested.',
    ],
    whenNotToUse: [
      'One request type for landing and in-car buttons.',
      'A hall call without a direction.',
      'Independent isMoving and doorsOpen flags.',
      'Nearest-car dispatch by distance.',
      'A large cost instead of an exclusion for a full car.',
      'Permanent assignment of a hall call.',
      'Visiting floors in sorted order.',
      'Background timers in a design being assessed.',
      'Mean wait time as the fairness metric.',
    ],
    alternatives: [
      'Destination dispatch, which collapses the two call types and enables grouping, at the cost of a commitment point.',
      'A parking policy holding a car high during up-peak, trading average latency for the tail.',
      'Zoning as a serviceable-floor predicate, reusing the same null exclusion.',
      'A per-state class hierarchy, which this transition-heavy machine does not want.',
      'A physical door interlock as a complementary layer to the type-level guarantee.',
    ],
    tradeoffs: [
      'Two request types buy an expressible scheduler and cost two deduplication rules.',
      'A tagged union buys an unconstructable unsafe state and costs pattern matching.',
      'A cost function buys direction and load awareness and costs calibration.',
      'A waiting-time term buys bounded waits and costs some average latency.',
      'Directional service buys bounded reversals and costs a longer wait for calls behind the car.',
      'Reassessment buys recovery from faults and costs damping to prevent oscillation.',
      'tick(now) buys deterministic tests and costs a driver loop in production.',
    ],
    failureModes: [
      'A passenger\'s destination reassigned to another car.',
      'Hall calls trapped on a broken car.',
      'A car going up collecting a passenger going down.',
      'Moving with the doors open, representable and only guarded.',
      'Constant direction reversal from sorted-order service.',
      'A nearby busy car chosen over a free car heading toward the call.',
      'A full car assigned a call it will drive past.',
      'A call oscillating between cars every tick.',
      'A floor starved while the mean wait stays within target.',
      'Tests passing against an unrepresentative arrival scenario.',
      'Wait measured from assignment rather than from the button press.',
    ],
    followUpQuestions: [
      'Are landing and in-car buttons the same type?',
      'Does a hall call carry a direction?',
      'Can an assigned hall call be reassigned, and how often is that reassessed?',
      'Can the state "moving with doors open" be constructed?',
      'Does each timed state store its completion time?',
      'Is the dispatch cost distance or estimated time?',
      'What does the cost function return for a full car?',
      'What stops a high floor being starved?',
      'When does a car reverse direction?',
      'Does anything happen without a tick?',
      'Is fairness measured as a mean or a tail?',
    ],
  },
});
