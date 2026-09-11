import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-object-design',
  title: 'Responsibility, encapsulation, composition',
  summary:
    'Objects come from behaviour, not from the nouns in the prompt. Extracting nouns reliably produces data holders plus one class that does everything — and every later question makes that design worse.',
  phase: 'lld',
  module: 'oo-foundations',
  position: 56,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['responsibility', 'encapsulation', 'composition', 'seams'],
  prerequisites: ['f-api-contracts'],
  resources: [
    {
      key: 'refactoring-guru-solid',
      tier: 'must',
      note: 'Read the single-responsibility section only, for now. The useful definition is "one reason to change" — not "one method" and not "one thing", both of which are unfalsifiable.',
    },
    {
      key: 'clean-architecture-blog',
      tier: 'must',
      note: 'Read it for the direction of dependencies. The reason responsibility assignment matters at all is that it determines which way the arrows point, and arrows are what make change cheap or expensive.',
    },
    {
      key: 'fowler-uml-distilled',
      tier: 'good',
      note: 'Read the class-diagram chapter for the vocabulary of relationships — association, composition, inheritance. You need the words to defend a choice between them out loud.',
    },
    {
      key: 'gof-patterns-ref',
      tier: 'good',
      note: 'Read the introduction rather than the catalogue. "Favour object composition over class inheritance" is stated there with the reasoning, and the reasoning is what you need in an interview.',
    },
    {
      key: 'kent-beck-tdd',
      tier: 'advanced',
      note: 'Read it for how a test exposes a design. A behaviour that is awkward to test usually sits on the wrong object, which makes tests a design tool rather than a verification step.',
    },
  ],

  intuition: {
    body: `The instinct in a low-level design interview is to underline the nouns. "Design a parking lot" gives you \`ParkingLot\`, \`Vehicle\`, \`Spot\`, \`Ticket\`, \`Payment\` — and that feels like progress, because you now have classes.

**It is not progress, and the design it produces is predictable.** Nouns become classes with fields and getters, because a noun on its own has no behaviour attached. **The behaviour has to go somewhere**, so it collects in one class — \`ParkingLotManager\`, \`ParkingLotService\` — which ends up holding every rule in the system.

\`\`\`
ParkingLot     { spots, tickets }        ← data
Vehicle        { plate, type }           ← data
Spot           { id, size, occupied }    ← data
ParkingLotService {
  findSpot, assignSpot, issueTicket, calculateFee,
  processPayment, releaseSpot, applyDiscount, ...
}                                        ← everything
\`\`\`

**That shape fails the interview specifically**, because the interviewer's next move is always a change: a new vehicle type, a different pricing rule, reserved spots for members. **Every one of those lands in the same class**, so every answer is "I add a branch to this method" — and the interview is trying to find out whether you can do better than that.

**The alternative is to start from behaviour.** Not "what things exist" but **"what must this system do, and what information does each of those actions need?"**

\`\`\`
"Decide where a vehicle goes"  → needs: spot availability, vehicle size
"Work out what is owed"        → needs: duration, rate rules
"Prove a vehicle may leave"    → needs: ticket, payment state
\`\`\`

**Then assign each behaviour to whoever owns the information it needs.** Fee calculation needs the rate rules, so it belongs with them — not in a service that fetches rules and applies them from outside.

**And encapsulation stops being a rule you follow and becomes a consequence.** An object that holds both the data and the behaviour over it has no reason to expose the data at all. **Getters appear precisely when behaviour has been put on the wrong object** — they are the symptom, not the design.

**Composition follows for the same reason.** The interviewer's changes are the axes of variation, and **an axis of variation is a thing you plug in, not a subclass you add** — because inheritance commits you to one axis and composition lets you have several.

The habit worth building: **find the verbs, group them by the information they need, and let the nouns fall out.**`,
    analogyLimit:
      'The noun-extraction habit comes from data modelling, where it is correct: a database schema really is a set of entities with attributes, and behaviour lives in application code. Carrying it into object design produces a schema with a procedure bolted on — which is a coherent design (a transaction script), just not the one being asked for. The tell is that every extension question gets the same answer: add a branch to the one class that does everything.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate designs a parking lot as: `ParkingLot` holding lists of `Spot` and `Ticket`; `Vehicle` with a plate and a type enum; and a `ParkingLotService` with `park()`, `unpark()`, and `calculateFee()` containing a switch on vehicle type. The interviewer then asks for (a) motorcycles that can share a car spot, (b) hourly pricing that differs by day of week, and (c) reserved spots for members. What happens to the design, and what was the root cause?',
      answer: `**Every one of the three changes lands in \`ParkingLotService\`, and each one makes the next harder.**

**(a) Motorcycles sharing a car spot** touches \`park()\`. The allocation logic currently matches a vehicle type to a spot size, so it gains a compatibility table or a chain of conditionals. **And the condition is not a property of the vehicle or of the spot — it is a relationship between them**, which has nowhere to live in this design.

**(b) Day-of-week pricing** touches \`calculateFee()\`, which already has a switch on vehicle type. **Now it has two dimensions**, so it becomes a nested switch — and the third pricing question will make it three.

**(c) Reserved spots for members** touches \`park()\` again, and this time it needs information the method does not have: who the driver is. **So the signature changes**, which means every caller changes, which means the change is not local at all.

**The root cause is that behaviour was separated from the data it needs**, and it happened because the design started from nouns.

\`\`\`
Nouns give you:  Spot { size, occupied }        ← no behaviour
Behaviour needs: "can this vehicle use this spot?"
                 ← needs the spot AND the vehicle, so it
                   went to the service, which owns neither
\`\`\`

**Once the service owns the decision, it must know the details of everything it decides about.** So \`ParkingLotService\` knows about vehicle types, spot sizes, pricing rules, membership and the compatibility between them — **and that is why every question lands there.** It is not that the class was badly written; it is that the design gave it no alternative.

**What a behaviour-first pass produces instead.**

\`\`\`
"Can this vehicle use this spot?"
  → the spot knows its own size; the vehicle knows what it needs
  → Spot.accepts(vehicle) — one small method, on the object
    that owns the constraint

"Which spot should this vehicle get?"
  → this is a POLICY, and the interviewer will change it
  → AllocationStrategy.choose(spots, vehicle)

"What is owed?"
  → needs duration and rate rules, not vehicle internals
  → PricingPolicy.fee(ticket)
\`\`\`

**Now re-run the three questions.**

**(a)** \`Spot.accepts()\` changes, or a \`MotorcycleFriendly\` spot type overrides it. **One object, no signature changes.**

**(b)** A new \`PricingPolicy\` implementation. **No existing code is modified** — and the day-of-week rule lives with the other rate rules rather than beside vehicle-type logic it has nothing to do with.

**(c)** A \`ReservedAllocationStrategy\`, which needs the driver — **so the driver becomes part of the parking request rather than a new parameter threaded through the service.** The request object is where the changing inputs accumulate, which is exactly where you want them.

**Three of three are now additions rather than modifications**, and that is the property the interviewer is testing for. **Not "did you use patterns" — did the changes stay local.**

**And the diagnostic you can apply during the interview:** if the answer to an extension question is "I add a parameter or a branch to an existing method", **the behaviour is on the wrong object.** That is a cheap check you can run on your own design before the interviewer runs it for you.`,
    },
    body: `## Finding objects from behaviour

The method is three steps, and the order matters.

**Step 1 — list what the system must do, as verbs.** Not entities. Actions, in the language of the problem.

\`\`\`
Design a ride-hailing dispatcher:
  match a rider to a driver
  estimate a fare
  track a trip's progress
  cancel, with consequences
  rate a completed trip
\`\`\`

**Step 2 — for each verb, ask what information it needs.** This is the step that does the work, because it forces you to notice which data travels together.

\`\`\`
"estimate a fare" needs: distance, duration, surge multiplier,
                         vehicle class rates
"match a rider to a driver" needs: rider location, available
                         drivers, their locations, matching rules
\`\`\`

**Step 3 — assign each verb to whoever owns the information it needs.** If no existing candidate owns it, **you have found an object** — and it is usually a policy, a strategy, or a small value type that nobody would have written down from the nouns.

\`\`\`
Nobody owns "surge multiplier + vehicle rates" → SurgePricing
Nobody owns "matching rules"                   → MatchingPolicy
\`\`\`

**The objects that matter most in an LLD interview are the ones no noun in the prompt names.** \`Vehicle\` and \`Rider\` are free; \`MatchingPolicy\` is the design.

**And a verb needing information from two objects is a signal, not a problem.** It usually means either the decision belongs to one of them (and the other is a parameter), or there is a missing object representing the relationship. **What it does not mean is "put it in a service".**

## Responsibility means one reason to change

The single-responsibility principle is usually quoted as "a class should do one thing", which is unfalsifiable — **any class can be described as doing one thing at a high enough level.** \`ParkingLotService\` manages parking. That is one thing.

**The useful formulation is: one reason to change.** Which means: **one stakeholder, or one kind of decision, drives edits to this class.**

\`\`\`
PricingPolicy        changes when the business changes rates
AllocationStrategy   changes when operations changes layout rules
Ticket               changes when the record format changes
ParkingLotService    changes when ANY of them changes
\`\`\`

**That last line is the test, and it is mechanical.** List the reasons a class might be edited; if they come from different people or different concerns, **the class has more than one responsibility** regardless of how coherently you can name it.

**And the reason this matters is dependency direction.** A class edited for four reasons is depended on by everything that touches any of those four concerns, so **a change for one reason risks breaking the other three** — which is the entire practical cost of poor responsibility assignment.

*What this does not license:* a class per method. **Splitting by mechanism rather than by reason-to-change produces a different mess** — a swarm of one-method classes whose relationships nobody can see, all of which still change together. **If two classes always change together, they had one responsibility, not two.**

## Encapsulation is a consequence, not a rule

The standard advice is "make fields private and expose getters", which achieves nothing: **a getter is a public field with extra steps.**

\`\`\`ts
// Encapsulated in name only
class Ticket {
  private entryTime: Date;
  getEntryTime(): Date { return this.entryTime; }
}
// Caller:
const hours = (now - ticket.getEntryTime()) / 3_600_000;
const fee = hours * rate;   // the behaviour is OUT HERE
\`\`\`

**The data escaped, so the behaviour followed it.** Every caller that needs the duration computes it, and the rule for computing it is now in as many places as there are callers.

\`\`\`ts
// Encapsulated in fact
class Ticket {
  private readonly entryTime: Date;
  durationUntil(exit: Date): Duration { /* the one rule */ }
}
\`\`\`

**"Tell, don't ask" is the working form of this.** Ask an object for its data and then decide — that decision belongs on the object. **Tell it what you want and let it decide.**

**And the practical test is the getter count.** A class with a getter per field and no other methods is a data holder, and **something else is doing its work.** That is fine when the class genuinely is a record — a data-transfer object at a boundary, a value type — **and it is a design smell when the class is named after a domain concept with rules attached.**

*One honest exception:* data crossing a serialisation boundary has to be readable. **An entity and its wire representation are different objects**, and conflating them is what makes people expose entity internals to satisfy a serialiser.

## Composition over inheritance, and why

**Inheritance couples you to the parent's implementation**, not just its interface. A subclass that overrides one method still inherits every assumption the parent makes about its own internal state — **so a change inside the parent can break a subclass that never touched the changed code.**

**And the more expensive cost is that inheritance is one axis.**

\`\`\`
Vehicle
 ├── Car
 ├── Motorcycle
 └── Truck

Now add electric vehicles, which charge while parked.
 ├── ElectricCar          ← and PetrolCar?
 ├── ElectricMotorcycle
 └── ElectricTruck        ← the combinations multiply
\`\`\`

**You chose "vehicle type" as the inheritance axis, and the second axis has nowhere to go.** Each additional axis multiplies the class count, and **the axes are exactly what the interviewer will add.**

\`\`\`ts
// Composition: each axis is a plugged-in part
class Vehicle {
  constructor(
    readonly size: SpotSize,          // what spot it needs
    readonly charging: ChargingNeed,  // an independent axis
  ) {}
}
\`\`\`

**Now each axis varies independently**, and a new axis is a new field rather than a doubling of the hierarchy.

**When inheritance is still right:** when the relationship is genuinely "is a kind of", the subtypes are a closed set, and **the base class is an interface or abstract with no meaningful state.** Then you are inheriting a contract rather than an implementation, which is the safe case — and it is why "implements an interface" carries almost none of inheritance's cost.

**The sentence to have ready:** *"I would use composition here because vehicle type and charging capability vary independently, and inheritance would force me to pick one of them as the hierarchy."* **Naming the axes is what makes the argument, not citing the principle.**

## Finding the seams before you are asked

**A seam is a place where the design expects to change.** In an interview, the seams are not a matter of judgment — **the prompt usually names them.**

\`\`\`
"extensible to new vehicle types"     → allocation, compatibility
"different pricing strategies"         → pricing
"multiple floors, configurable"        → layout
"support both card and cash"           → payment
\`\`\`

**Each of those phrases is the interviewer telling you where they will push.** So put an interface there, and nowhere else.

**Which is the discipline that keeps this from becoming pattern soup: an interface with one implementation and no requested variation is speculative.**

\`\`\`ts
// Requested: "different pricing strategies"
interface PricingPolicy { fee(t: Ticket): Money }   // ✓ a real seam

// Not requested, and no variation in sight
interface TicketRepository { save(t: Ticket): void } // ✗ if there is
                                                     //   one store
\`\`\`

**The second one is not wrong so much as unearned**, and an interviewer who is paying attention will ask why it exists. **"I do not need an abstraction here" is a strong answer** when you can say what would make you add one.

*And the reverse mistake is more common under pressure:* naming an interface after its single implementation — \`IHourlyPricing\` — **which means the abstraction is describing a mechanism rather than a role.** Name the seam for what the caller wants (\`PricingPolicy\`), not for what happens to be behind it.

## What to say out loud

The order that reads as competence, and it is the same order as the method:

**"Let me start from the behaviours rather than the entities."** Then list the verbs. This alone distinguishes you from the noun-extraction default.

**"This behaviour needs these three pieces of information, so it belongs with them."** Assignment with a reason, rather than assignment by convention.

**"These two things vary independently, so composition rather than inheritance."** Naming the axes.

**"The prompt says pricing is configurable, so that is a seam. I am not abstracting storage, because nothing suggests it varies."** Seams justified by the requirement, and abstractions declined on the record.

**"If you asked me to add X, that would be a new implementation rather than a change to existing code."** Demonstrating locality before being tested on it.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'two-designs',
      title: 'The same problem, from nouns and from behaviour',
      caption:
        'Read the left side as what noun extraction produces every time. The arrows are the point: on the left everything depends on one class, so every change is a change to it.',
      code: `flowchart LR
    subgraph NOUNS["**From nouns** — data plus a god service"]
      direction TB
      S["**ParkingLotService**<br/>findSpot · assignSpot<br/>issueTicket · calculateFee<br/>processPayment · release<br/>applyDiscount"]
      S --> D1["Spot<br/>{size, occupied}"]
      S --> D2["Vehicle<br/>{plate, type}"]
      S --> D3["Ticket<br/>{entry, spot}"]
      N1["**Every change lands here:**<br/>new vehicle type,<br/>new pricing rule,<br/>reserved spots"] -.-> S
    end

    subgraph BEHAVIOUR["**From behaviour** — decisions where the data is"]
      direction TB
      R["ParkingRequest<br/>{vehicle, driver, at}"]
      A["**AllocationStrategy**<br/>choose(spots, request)"]
      P["**PricingPolicy**<br/>fee(ticket)"]
      SP["Spot<br/>accepts(vehicle)"]
      T["Ticket<br/>durationUntil(exit)"]
      R --> A
      A --> SP
      P --> T
      N2["**Each change is a new<br/>implementation, not an<br/>edit to existing code**"] -.-> A
      N2 -.-> P
    end

    style S fill:#40181c,stroke:#b4535e
    style A fill:#17272a,stroke:#35897e
    style P fill:#17272a,stroke:#35897e
    style N1 fill:#1c1814,stroke:#c99a4e
    style N2 fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'method',
      title: 'Verbs, then information, then owners',
      caption:
        'Step through it. The objects worth finding are the ones that appear at step three — the ones no noun in the prompt named.',
      nodes: [
        { id: 'verbs', label: '1. List the verbs', kind: 'note', x: 0, y: 100, detail: 'What must the system DO, in the language of the problem. Not entities. "Decide where a vehicle goes", "work out what is owed", "prove a vehicle may leave".' },
        { id: 'info', label: '2. What information does each need?', kind: 'note', x: 250, y: 100, detail: 'The step that does the work, because it forces you to notice which data travels together. "Work out what is owed" needs duration and rate rules — and nothing about plates or spot ids.' },
        { id: 'owner', label: '3. Assign to whoever owns that information', kind: 'note', x: 530, y: 100, detail: 'If an existing candidate owns it, the behaviour goes there. If nobody does, you have found an object — usually a policy or a strategy, which is exactly the kind of object noun extraction never produces.' },
        { id: 'found', label: 'The objects that matter', kind: 'service', x: 810, y: 30, detail: 'AllocationStrategy, PricingPolicy, ParkingRequest. None of them is a noun in the prompt, and they are where the design lives — Vehicle and Spot come free.' },
        { id: 'enc', label: 'Encapsulation falls out', kind: 'service', x: 810, y: 150, detail: 'An object holding both the data and the behaviour over it has no reason to expose the data. Getters appear when behaviour is on the wrong object — they are the symptom, not the design.' },
        { id: 'seam', label: 'And the prompt names the seams', kind: 'note', x: 810, y: 270, detail: '"Extensible to new vehicle types", "different pricing strategies" — each phrase is the interviewer saying where they will push. Put an interface there and nowhere else; an interface with one implementation and no requested variation is unearned.' },
      ],
      edges: [
        { id: 'o1', source: 'verbs', target: 'info', kind: 'control' },
        { id: 'o2', source: 'info', target: 'owner', kind: 'control' },
        { id: 'o3', source: 'owner', target: 'found', kind: 'control' },
        { id: 'o4', source: 'owner', target: 'enc', kind: 'control' },
        { id: 'o5', source: 'found', target: 'seam', kind: 'control' },
      ],
      steps: [
        {
          id: 'os1',
          title: 'Start with verbs, not nouns',
          description:
            'Nouns have no behaviour attached, so the behaviour collects in one class and every extension question lands there. Verbs carry their own requirements with them.',
          nodes: ['verbs'],
          edges: [],
        },
        {
          id: 'os2',
          title: 'Then ask what each verb needs to know',
          description:
            'This is where the data groupings appear. Fee calculation needs duration and rates; it does not need a plate number — so it does not belong on anything that has one.',
          nodes: ['info'],
          edges: ['o1'],
        },
        {
          id: 'os3',
          title: 'Assign the behaviour to the owner of that information',
          description:
            'And when nobody owns it, you have found an object. These are the policies and strategies that noun extraction never finds — and they are the design.',
          nodes: ['owner', 'found'],
          edges: ['o2', 'o3'],
        },
        {
          id: 'os4',
          title: 'Encapsulation then needs no separate rule',
          description:
            'Data and the rules over it live together, so there is nothing to expose. The getter count is the diagnostic: a class of getters with no methods means something else is doing its work.',
          nodes: ['enc'],
          edges: ['o4'],
        },
        {
          id: 'os5',
          title: 'Put interfaces only where the prompt asks for variation',
          description:
            'The seams are named in the question. Everywhere else, declining an abstraction on the record — and saying what would make you add one — is the stronger answer.',
          nodes: ['seam'],
          edges: ['o5'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The clearest published statement of why responsibility assignment matters is the dependency-direction argument in the clean-architecture material, and it is worth reading for one idea rather than the whole scheme.

**Dependencies should point toward the things that change least.** Policies — the rules of the business — change for business reasons; mechanisms — storage, transport, formatting — change for technical ones. **When the policy depends on the mechanism, a technical change forces a business-logic change**, which is the expensive direction.

**And responsibility assignment is what determines the arrows.** Put fee calculation in a service that reads rate rules from a database, and the fee rule now depends on how rates are stored. **Put it on an object that owns the rules and the dependency reverses** — the storage layer supplies rules to the policy rather than the policy reaching into storage.

**Three things to take from it.**

**Ask "what changes for the same reason" before "what belongs together".** Coherent naming is not evidence of one responsibility; shared reasons to change is.

**A class that everything depends on must be stable.** If \`ParkingLotService\` is depended on by every caller and also edited for every new rule, **it is simultaneously the most depended-on and least stable class in the design** — which is the worst combination available.

**Interfaces belong where the dependency needs reversing**, which in practice is at the seams the prompt already named. **That is the same conclusion as the seam discipline, arrived at from the dependency side** — and having both arguments available is useful, because interviewers push on one or the other.

**Where the published material does not help.** It argues about architecture-scale boundaries, and an LLD interview is one class diagram. **The dependency argument scales down cleanly; the layering scheme does not** — proposing four concentric layers for a parking lot reads as ceremony, and the interviewer is asking about objects, not about a project structure.`,
  },

  tradeoffs: {
    intro:
      'The decisions this lesson turns on, and the failure mode of each direction.',
    rows: [
      {
        option: 'Extract nouns from the prompt as classes',
        whenItWins:
          'Data modelling, where entities with attributes are genuinely the answer.',
        whenItLoses:
          'Nouns carry no behaviour, so behaviour collects in one service and every extension question lands there.',
        cost:
          'Every change is a modification to the most depended-on class.',
      },
      {
        option: 'Derive objects from behaviours and their information needs',
        whenItWins:
          'Always here. It surfaces the policies and strategies no noun names, which is where the design lives.',
        whenItLoses:
          'It is slower to start, and it produces objects you have to justify out loud.',
        cost:
          'A few minutes of the interview spent on method rather than classes.',
      },
      {
        option: '"One class does one thing"',
        whenItWins:
          'Nowhere. It is unfalsifiable — any class does one thing at a high enough level.',
        whenItLoses:
          'It licenses a god service that "manages parking" and cannot be argued against.',
        cost:
          'A principle that cannot be applied.',
      },
      {
        option: '"One reason to change"',
        whenItWins:
          'Always. Listing the reasons a class might be edited is a mechanical test.',
        whenItLoses:
          'Applied by mechanism rather than by reason, it produces a swarm of one-method classes.',
        cost:
          'You must know who the stakeholders are to enumerate the reasons.',
      },
      {
        option: 'Private fields with getters',
        whenItWins:
          'At a serialisation boundary, where the data genuinely has to be readable.',
        whenItLoses:
          'A getter is a public field with extra steps — the data escapes, and the behaviour follows it to every caller.',
        cost:
          'One rule duplicated wherever the data is read.',
      },
      {
        option: 'Tell, don\'t ask — behaviour with the data',
        whenItWins:
          'Whenever the class is a domain concept with rules attached.',
        whenItLoses:
          'Data-transfer objects and value types at boundaries genuinely are records.',
        cost:
          'Separating an entity from its wire representation, which is two objects instead of one.',
      },
      {
        option: 'Inheritance for variation',
        whenItWins:
          'A genuine "is a kind of" over a closed set, inheriting a contract rather than state.',
        whenItLoses:
          'It couples you to the parent\'s implementation and commits you to a single axis — and the second axis multiplies the class count.',
        cost:
          'A hierarchy that doubles each time the interviewer adds a dimension.',
      },
      {
        option: 'Composition for variation',
        whenItWins:
          'Whenever two or more things vary independently, which is most of the time.',
        whenItLoses:
          'More small parts to wire together, and construction gets noisier.',
        cost:
          'Assembly code somewhere, usually a factory or a builder.',
      },
      {
        option: 'An interface at every boundary',
        whenItWins:
          'A large codebase with real substitution requirements — tests, multiple implementations.',
        whenItLoses:
          'An interface with one implementation and no requested variation is unearned, and reads as ceremony.',
        cost:
          'Indirection an interviewer will ask you to justify.',
      },
      {
        option: 'Interfaces only at the seams the prompt names',
        whenItWins:
          'Always in an interview. The prompt tells you where change is coming.',
        whenItLoses:
          'A seam you did not anticipate requires a refactor rather than an implementation.',
        cost:
          'Being wrong about one axis occasionally, which is cheaper than abstracting all of them.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The entities are ParkingLot, Spot, Vehicle, Ticket and Payment, so let me define those classes with their fields."',
      whyWeak:
        'Nouns have no behaviour attached, so the behaviour has to collect somewhere else — and it collects in one service class that ends up holding every rule. Then every extension question the interviewer asks lands in that same class, and every answer is "I add a branch".',
      strongAnswer:
        '"Let me start from the behaviours instead. The system must decide where a vehicle goes, work out what is owed, and prove a vehicle may leave. Deciding where a vehicle goes needs spot availability and the vehicle\'s size requirement, so that is an allocation policy; working out what is owed needs duration and rate rules, so that lives with the rates. The entities fall out of that, and the objects that matter — AllocationStrategy, PricingPolicy — are the ones no noun in the prompt named."',
    },
    {
      weakAnswer: '"Each class has a single responsibility — ParkingLotService is responsible for managing parking."',
      whyWeak:
        '"One thing" is unfalsifiable: any class does one thing described at a high enough level. The formulation gives you no way to argue that a class doing allocation, pricing, payment and membership has too much.',
      strongAnswer:
        '"I use \'one reason to change\' rather than \'one thing\'. If I list why this class might be edited — the business changes rates, operations changes layout rules, the record format changes — those are different stakeholders, so it has three responsibilities. And the cost is concrete: it is the most depended-on class and also the least stable, so a change for one reason risks breaking the other two."',
    },
    {
      weakAnswer: '"Fields are private with getters and setters, so the class is encapsulated."',
      whyWeak:
        'A getter is a public field with extra steps. Once the data is readable the behaviour over it moves to the callers, so the rule for computing a duration or a fee ends up duplicated wherever the data is read.',
      strongAnswer:
        '"Encapsulation is about behaviour, not visibility. If callers ask a ticket for its entry time and then compute a duration, that computation belongs on the ticket — so I expose durationUntil() rather than getEntryTime(). The diagnostic is the getter count: a domain class that is all getters and no methods means something else is doing its work. The honest exception is a boundary object that has to be serialised, and I would keep that separate from the entity."',
    },
    {
      weakAnswer: '"Vehicle is the base class, with Car, Motorcycle and Truck subclasses."',
      whyWeak:
        'It commits the design to one axis of variation. The moment a second axis appears — electric versus petrol, oversized, has a trailer — the combinations multiply, and the axes are exactly what an interviewer adds.',
      strongAnswer:
        '"I would compose rather than inherit, because vehicle type and charging capability vary independently and inheritance would force me to pick one of them as the hierarchy. A Vehicle holds a size requirement and a charging need as separate parts, so a new axis is a new field instead of doubling the class count. I would still use inheritance where the relationship is genuinely \'is a kind of\' over a closed set and the base has no state — which is really just implementing an interface, and carries almost none of the cost."',
    },
    {
      weakAnswer: '"I have put an interface in front of every component so the design is flexible."',
      whyWeak:
        'An interface with one implementation and no requested variation is indirection without a benefit, and an attentive interviewer will ask what it is for. It also obscures which parts of the design are genuinely expected to change.',
      strongAnswer:
        '"I put interfaces only where the prompt says variation is coming. It said pricing is configurable and new vehicle types are expected, so those are seams. It said nothing about storage varying, so I am not abstracting it — and if you asked me to support a second store, that is when I would add one. Declining an abstraction and saying what would make me add it is a more useful answer than adding it speculatively."',
    },
    {
      weakAnswer: '"I named the interface IHourlyPricing since that is what it does."',
      whyWeak:
        'It names the abstraction after its single implementation, so the interface describes a mechanism rather than a role. The next implementation — day-of-week pricing — makes the name actively misleading.',
      strongAnswer:
        '"I name a seam for what the caller wants, not for what is behind it — so PricingPolicy, with HourlyPricing and WeekendPricing as implementations. The test is whether the name still makes sense when a second implementation arrives; if it does not, the name was describing the mechanism."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lod-1',
      front: 'What does extracting nouns from the prompt reliably produce?',
      back: 'Data holders plus one service class that owns every rule — because nouns carry no behaviour, so the behaviour collects elsewhere.',
      topic: 'responsibility',
    },
    {
      id: 'fc-lod-2',
      front: 'What are the three steps of behaviour-first object discovery?',
      back: 'List the verbs; ask what information each needs; assign each to whoever owns that information. If nobody owns it, you have found an object.',
      topic: 'responsibility',
    },
    {
      id: 'fc-lod-3',
      front: 'Which objects matter most in an LLD interview?',
      back: 'The ones no noun in the prompt names — policies, strategies, request objects. The nouns come free.',
      topic: 'responsibility',
    },
    {
      id: 'fc-lod-4',
      front: 'Why is "a class should do one thing" useless?',
      back: 'It is unfalsifiable — any class does one thing described at a high enough level. "Manages parking" is one thing.',
      topic: 'responsibility',
    },
    {
      id: 'fc-lod-5',
      front: 'What is the workable definition of a responsibility?',
      back: 'One reason to change: one stakeholder or one kind of decision drives edits to the class. Listing the reasons is a mechanical test.',
      topic: 'responsibility',
    },
    {
      id: 'fc-lod-6',
      front: 'What is the practical cost of a class with four reasons to change?',
      back: 'It is the most depended-on and least stable class in the design, so a change for one reason risks breaking the other three.',
      topic: 'responsibility',
    },
    {
      id: 'fc-lod-7',
      front: 'If two classes always change together, what does that mean?',
      back: 'They had one responsibility, not two — the split was by mechanism rather than by reason to change.',
      topic: 'responsibility',
    },
    {
      id: 'fc-lod-8',
      front: 'Why is a getter not encapsulation?',
      back: 'It is a public field with extra steps. Once the data escapes, the behaviour over it moves to every caller and the rule is duplicated.',
      topic: 'encapsulation',
    },
    {
      id: 'fc-lod-9',
      front: 'What is the getter-count diagnostic?',
      back: 'A domain class that is all getters and no methods means something else is doing its work. Boundary records are the honest exception.',
      topic: 'encapsulation',
    },
    {
      id: 'fc-lod-10',
      front: 'What does inheritance couple you to, beyond the interface?',
      back: 'The parent\'s implementation — including assumptions about its own state — so a change inside the parent can break a subclass that never touched it.',
      topic: 'composition',
    },
    {
      id: 'fc-lod-11',
      front: 'What is inheritance\'s more expensive cost in an interview?',
      back: 'It commits you to one axis of variation, and the second axis multiplies the class count. The axes are exactly what the interviewer adds.',
      topic: 'composition',
    },
    {
      id: 'fc-lod-12',
      front: 'When is inheritance still the right choice?',
      back: 'A genuine "is a kind of" over a closed set, where the base has no meaningful state — which is essentially implementing an interface.',
      topic: 'composition',
    },
    {
      id: 'fc-lod-13',
      front: 'Where are the seams in an LLD prompt?',
      back: 'Named in the prompt: "extensible to new types", "different pricing strategies", "support card and cash". Each phrase says where the interviewer will push.',
      topic: 'seams',
    },
    {
      id: 'fc-lod-14',
      front: 'How should a seam interface be named?',
      back: 'For what the caller wants (PricingPolicy), never for its single implementation (IHourlyPricing) — otherwise the name describes a mechanism and misleads on the second implementation.',
      topic: 'seams',
    },
  ],

  quiz: [
    {
      id: 'q-lod-1',
      kind: 'scenario',
      prompt:
        'A design has Spot {size, occupied}, Vehicle {plate, type}, and a service method park(vehicle). The interviewer asks for motorcycles that may share a car spot. Where does the change belong?',
      options: [
        { id: 'a', label: 'On the spot — Spot.accepts(vehicle) — because the spot owns the constraint about what fits in it' },
        { id: 'b', label: 'In park(), as a compatibility table mapping vehicle types to spot sizes' },
        { id: 'c', label: 'On Vehicle, as a list of spot sizes it can use' },
        { id: 'd', label: 'In a new CompatibilityService' },
      ],
      correct: ['a'],
      explanation:
        'The constraint is about what a spot will accommodate, so it belongs with the spot, which owns its own size. Option b is what the noun-derived design forces and is why every question lands in one class. Option d adds another behaviour-without-data class, repeating the original mistake at smaller scale.',
      difficulty: 'core',
      topic: 'responsibility',
    },
    {
      id: 'q-lod-2',
      kind: 'scenario',
      prompt:
        'Which test tells you a class has more than one responsibility?',
      options: [
        { id: 'a', label: 'List the reasons it might be edited; if they come from different stakeholders or concerns, it has several' },
        { id: 'b', label: 'Count its public methods; more than five is too many' },
        { id: 'c', label: 'Check whether its name contains "and" or "Manager"' },
        { id: 'd', label: 'Count its lines; over 200 should be split' },
      ],
      correct: ['a'],
      explanation:
        'Reasons to change is the only formulation that is mechanical and falsifiable. Method and line counts measure size, not responsibility — a large class with one reason to change is fine, and a three-method class edited by three teams is not. The naming heuristic is a weak hint at best.',
      difficulty: 'core',
      topic: 'responsibility',
    },
    {
      id: 'q-lod-3',
      kind: 'scenario',
      prompt:
        'Callers repeatedly do `(now - ticket.getEntryTime()) / 3600000 * rate`. What is the diagnosis?',
      options: [
        { id: 'a', label: 'The data escaped through the getter, so the behaviour followed it — the duration and fee rules belong on the objects that own the data' },
        { id: 'b', label: 'The getter should return a formatted string instead' },
        { id: 'c', label: 'A utility class should hold the calculation' },
        { id: 'd', label: 'Nothing — the getter keeps the field private, which is encapsulation' },
      ],
      correct: ['a'],
      explanation:
        'A getter is a public field with extra steps, and the visible consequence is that the rule now lives in as many places as there are callers. Option c centralises the duplication without fixing the cause — the behaviour still sits away from its data. Option d is the misconception the question is built on.',
      difficulty: 'core',
      topic: 'encapsulation',
    },
    {
      id: 'q-lod-4',
      kind: 'scenario',
      prompt:
        'You have Car, Motorcycle and Truck subclasses of Vehicle. Electric vehicles are added, which charge while parked. What is the problem and the fix?',
      options: [
        { id: 'a', label: 'Vehicle type and charging capability are independent axes, so the hierarchy multiplies — compose the two as separate parts instead' },
        { id: 'b', label: 'Add ElectricCar, ElectricMotorcycle and ElectricTruck subclasses' },
        { id: 'c', label: 'Add an isElectric boolean to Vehicle' },
        { id: 'd', label: 'Make Electric a subclass of Vehicle alongside the others' },
      ],
      correct: ['a'],
      explanation:
        'Inheritance commits you to one axis, and this is the second. Option b is the multiplication itself, and a third axis would make it eight classes. Option c works for exactly one extra axis and then repeats the problem as a growing set of flags. Option d is a category error — electric is not a kind of vehicle alongside cars.',
      difficulty: 'core',
      topic: 'composition',
    },
    {
      id: 'q-lod-5',
      kind: 'scenario',
      prompt:
        'The prompt says "pricing should be configurable" and says nothing about storage. Where do interfaces belong?',
      options: [
        { id: 'a', label: 'Pricing only — and say explicitly that you are declining to abstract storage, and what would make you add it' },
        { id: 'b', label: 'Both, because abstracting storage is good practice regardless' },
        { id: 'c', label: 'Neither, until a second implementation actually exists' },
        { id: 'd', label: 'Behind every component, for consistency' },
      ],
      correct: ['a'],
      explanation:
        'The prompt names its seams, and an interface with one implementation and no requested variation is unearned indirection. Option c is too strict: the requirement itself is the evidence of variation, so waiting for the second implementation ignores what you were told. Declining an abstraction on the record is a stronger answer than either adding or omitting it silently.',
      difficulty: 'advanced',
      topic: 'seams',
    },
    {
      id: 'q-lod-6',
      kind: 'multi',
      prompt:
        'Which of these are signals that a behaviour sits on the wrong object? Select all that apply.',
      options: [
        { id: 'a', label: 'Answering an extension question requires adding a parameter or branch to an existing method' },
        { id: 'b', label: 'A method reads several getters from another object before deciding' },
        { id: 'c', label: 'A domain class consists of getters and no other methods' },
        { id: 'd', label: 'A class has more than one constructor' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are all the same underlying symptom — behaviour separated from the data it needs — seen from three angles: change locality, the ask-then-decide pattern, and the data holder left behind. Multiple constructors are about construction convenience and say nothing about responsibility assignment.',
      difficulty: 'core',
      topic: 'responsibility',
    },
  ],

  exercises: [
    {
      id: 'ex-lod-1',
      kind: 'implement',
      title: 'Redesign a god service from its behaviours',
      estimatedMinutes: 35,
      prompt: `Here is a noun-derived design for a library lending system.

\`\`\`ts
class Book   { isbn: string; title: string; copies: number }
class Member { id: string; name: string; tier: 'basic' | 'premium' }
class Loan   { bookIsbn: string; memberId: string; out: Date; due: Date }

class LibraryService {
  borrow(memberId: string, isbn: string): Loan { /* ... */ }
  returnBook(loanId: string): void { /* ... */ }
  calculateFine(loanId: string): number { /* ... */ }
  canBorrow(memberId: string): boolean { /* ... */ }
  extendLoan(loanId: string): void { /* ... */ }
}
\`\`\`

Known rules: basic members may hold 3 loans for 14 days; premium members 10 loans for 28 days. Fines are 20p per day overdue, capped at the book's value. A loan may be extended once, unless someone is waiting for the book.

**Part 1.** List the behaviours and, for each, the information it needs. Then say which object should own it.

**Part 2.** Write the redesigned types and signatures. No method bodies — signatures and the objects only.

**Part 3.** The interviewer asks for three changes. Say, for each, whether it is an addition or a modification, and where it lands:
(a) a student tier with different limits; (b) fines waived during a grace period after closure; (c) reservations, so a waiting member gets the book next.

**Part 4.** Name two places where you deliberately did NOT add an abstraction, and say what would make you add one.

Then answer:

- Which of your objects has a name that appears nowhere in the original design, and why is that the interesting one?
- \`canBorrow\` returns a boolean. What is wrong with that, and what would you return instead?`,
      rubric: [
        'Lists behaviours as verbs with their information needs.',
        'Assigns each behaviour to the owner of its data, with a reason.',
        'Identifies at least one policy object that no noun names.',
        'Redesigned signatures show behaviour on the objects that own the data.',
        'Loan limits and durations live with the tier policy, not in a service switch.',
        'Fine calculation lives with the loan and the fine policy.',
        'All three changes are correctly classified as addition or modification.',
        'Names two declined abstractions with the trigger that would change the decision.',
        'Explains why the boolean return is lossy and proposes a richer result.',
      ],
      modelAnswer: `**Part 1 — behaviours, information needs, and owners**

\`\`\`
"May this member take another loan?"
  needs: the member's tier limits, their current loan count
  → the limit is a POLICY (tier-dependent, will change)
  → the count is the member's loans
  → LendingPolicy.mayBorrow(member, currentLoans)

"How long is this loan for?"
  needs: the member's tier
  → LendingPolicy.loanPeriod(member)   ← same policy, same reason
                                          to change

"Is this loan overdue, and by how much?"
  needs: due date, return date
  → Loan.overdueBy(at: Date): Duration
  → the loan owns both dates; nobody else needs to know them

"What fine is owed?"
  needs: overdue duration, daily rate, the book's value for the cap
  → FinePolicy.fine(overdue: Duration, cap: Money): Money
  → the rate and the cap rule are the policy's; the duration
    comes from the loan

"May this loan be extended?"
  needs: whether it has been extended, whether anyone is waiting
  → the extension count is the loan's own state
  → "is anyone waiting" is NOT the loan's business
  → Loan.mayExtend(demand: BookDemand): boolean

"Is a copy available?"
  needs: total copies, copies currently out
  → BookCopies.isAvailable() — the count and the rule together
\`\`\`

**The two decisions worth defending.**

**Loan limits and loan periods go to the same object**, because they change for the same reason: someone redefines a membership tier. **Splitting them into a \`LimitPolicy\` and a \`PeriodPolicy\` would be splitting by mechanism**, and they would always be edited together — which by the "one reason to change" test means they are one responsibility.

**"Is anyone waiting" does not go on the loan.** The loan knows its own history; **demand for a book is a different object's business.** Passing it in keeps the loan ignorant of the reservation system, which is what lets reservations be added later without touching the loan.

---

**Part 2 — the redesign**

\`\`\`ts
type Money = number;       // minor units
type Days  = number;

// ── Value / entity types: data WITH its rules ──────────────
class Loan {
  private constructor(
    readonly id: LoanId,
    readonly isbn: Isbn,
    readonly memberId: MemberId,
    private readonly out: Date,
    private due: Date,
    private extensions: number,
  ) {}

  static open(isbn: Isbn, member: Member, period: Days): Loan;

  overdueBy(at: Date): Days;                 // 0 if not overdue
  mayExtend(demand: BookDemand): boolean;    // own history + demand
  extend(by: Days): void;                    // throws if !mayExtend
  isOpen(): boolean;
}

class BookCopies {
  constructor(readonly isbn: Isbn, private total: number,
              private out: number) {}
  isAvailable(): boolean;
  takeOne(): void;
  returnOne(): void;
}

class Book {
  constructor(readonly isbn: Isbn, readonly title: string,
              readonly value: Money) {}      // value: the fine cap
}

class Member {
  constructor(readonly id: MemberId, readonly name: string,
              readonly tier: Tier) {}
}

// ── Seams: the things the prompt says will vary ────────────
interface LendingPolicy {
  mayBorrow(member: Member, openLoans: number): BorrowDecision;
  loanPeriod(member: Member): Days;
  extensionPeriod(member: Member): Days;
}

interface FinePolicy {
  fine(overdue: Days, cap: Money): Money;
}

interface BookDemand {                 // "is anyone waiting?"
  hasWaitingMembers(isbn: Isbn): boolean;
}

// ── The request/result types that carry changing inputs ────
class BorrowRequest {
  constructor(readonly member: Member, readonly isbn: Isbn,
              readonly at: Date) {}
}

type BorrowDecision =
  | { allowed: true; period: Days }
  | { allowed: false; reason: 'limit-reached' | 'no-copies'
                            | 'unpaid-fines'; detail: string };

// ── The only orchestrator, and it decides nothing ──────────
class Lending {
  constructor(
    private readonly policy: LendingPolicy,
    private readonly fines: FinePolicy,
    private readonly demand: BookDemand,
    private readonly loans: LoanStore,
    private readonly copies: CopiesStore,
  ) {}

  borrow(request: BorrowRequest): BorrowDecision;
  return(loanId: LoanId, at: Date): Money;   // the fine owed
  extend(loanId: LoanId): void;
}
\`\`\`

**Three things to point out about this shape.**

**\`Lending\` orchestrates and decides nothing.** It asks the policy whether borrowing is allowed, asks the copies whether one is available, and asks the fine policy what is owed. **Every rule is somewhere else** — which is the difference between an orchestrator and a god service, and it is worth saying out loud because they look similar on a diagram.

**\`BorrowDecision\` replaces a boolean**, which the closing question returns to.

**\`BookDemand\` is an interface with no implementation yet**, and that is deliberate: **the prompt mentions "someone waiting" without describing reservations**, so the seam is named and the mechanism is deferred. Part 3(c) then becomes an implementation.

---

**Part 3 — the three changes**

**(a) A student tier with different limits — an addition.**

\`\`\`ts
class StudentLendingPolicy implements LendingPolicy { ... }
// or: TieredLendingPolicy with a table, and a new row
\`\`\`

**Nothing existing is modified.** Limits and periods both live in the policy, which is why one change covers both — and in the original design this was a modification to a switch inside \`canBorrow\` *and* another inside \`borrow\`, in two places that could disagree.

**(b) Fines waived during a grace period — an addition.**

\`\`\`ts
class GracePeriodFinePolicy implements FinePolicy {
  constructor(private inner: FinePolicy,
              private closures: ClosureCalendar) {}
  fine(overdue: Days, cap: Money): Money;   // wraps the inner one
}
\`\`\`

**A decorator over the existing policy**, so the daily-rate rule and the cap rule are not duplicated. **The interesting part is that this change needed no new seam** — \`FinePolicy\` was already the right shape, which is evidence the seam was placed correctly rather than luckily.

**(c) Reservations — an addition plus one small modification.**

**The addition:** a \`Reservations\` implementation of \`BookDemand\`, plus reservation entities of its own.

**The modification:** \`Lending.borrow()\` must now consult reservations before handing a copy to a walk-in member — **because a copy being available is no longer sufficient; it may be promised to someone.**

**And that is an honest modification rather than a hidden one.** *Why it could not be avoided:* the rule "an available copy may still be promised" is genuinely new behaviour in the borrow flow, not a variation of existing behaviour. **A seam cannot absorb a change that alters the sequence of decisions**, only one that alters a decision's outcome.

*What made it small:* the modification is one added check in the orchestrator, and **nothing inside \`Loan\`, \`BookCopies\`, \`LendingPolicy\` or \`FinePolicy\` changes at all.** In the original design, reservations would have touched \`borrow\`, \`returnBook\` and \`extendLoan\`, all of which read raw fields.

---

**Part 4 — two abstractions deliberately declined**

**1. No \`NotificationService\` interface.** The prompt never mentions notifying anyone. **Adding one would be inventing a requirement**, and interfaces for imagined requirements are exactly what makes a design read as ceremony.

*What would make me add it:* the moment overdue reminders or reservation-ready alerts are requested. **And I would want to know whether more than one channel is needed** — a single email path does not need an interface, it needs a function.

**2. No \`BookRepository\` / \`MemberRepository\` abstraction beyond the two concrete stores.** I have \`LoanStore\` and \`CopiesStore\` as collaborators because \`Lending\` must reach state somehow, **but I have not declared a persistence-agnostic repository layer** — there is one store and nothing suggests it varies.

*What would make me add it:* a stated requirement for a second backing store, or **a test that cannot be written without substituting one.** The second trigger is the more common real reason, and it is a legitimate one — but it is a testing requirement, and I would say so rather than dressing it up as flexibility.

*And a third worth naming:* **no \`Tier\` hierarchy.** Basic, premium and student are a closed set of values, not types with behaviour. **The behaviour that varies by tier lives in the policy**, so \`Tier\` stays a plain value — and that is why adding a student tier touches one table row rather than creating a class.

---

**Which object has a name appearing nowhere in the original, and why it is the interesting one**

**\`LendingPolicy\`** — and \`FinePolicy\`, \`BorrowDecision\` and \`BookDemand\` alongside it.

**None of them is a noun in the problem statement**, and that is precisely why they matter. The original design had every noun the prompt mentioned — \`Book\`, \`Member\`, \`Loan\` — and it was still the wrong design, **because the nouns were never the hard part.**

**The rules were the hard part**, and rules are not nouns. "Basic members may hold 3 loans for 14 days" is a policy statement, and **a design derived from nouns has nowhere to put it** — so it goes into a service method as a switch.

**Which gives the general observation: the objects you find by asking "what varies, and what decides?" are the design, and the objects you find by underlining nouns are the vocabulary.** You need both, and only one of them is worth interview time.

*A useful way to check your own design under pressure:* **count the objects whose names do not appear in the prompt.** Zero is a strong signal you did noun extraction. **Three or four policy-shaped objects usually means you found the seams.**

---

**What is wrong with \`canBorrow(): boolean\`**

**It discards the reason, and the reason is what the caller needs.**

\`\`\`
canBorrow() === false
  → why? limit reached? no copies? unpaid fines?
  → the caller cannot tell the member anything useful
  → so the caller re-derives it: checks the loan count
    itself, checks copies itself
  → and now the rule is in two places, which is the
    original failure mode returning by a different route
\`\`\`

**That last step is the important one.** A boolean does not merely produce a poor error message — **it pushes the caller into re-implementing the decision** in order to explain it, which duplicates exactly the logic the policy was supposed to own.

**What I would return instead:**

\`\`\`ts
type BorrowDecision =
  | { allowed: true; period: Days }
  | { allowed: false; reason: 'limit-reached' | 'no-copies'
                            | 'unpaid-fines'; detail: string };
\`\`\`

**Three properties this gets right.**

**The reason travels with the refusal**, so the caller can explain it without knowing how it was decided.

**The success case carries the period.** The same decision that established the member may borrow also knows for how long, **so returning it here avoids a second call to the policy** — and avoids the possibility of the two calls disagreeing, which is a real risk if a tier changes between them.

**And the reasons are a closed set**, so adding a new refusal reason is a visible change that the compiler shows every caller. **A boolean hides new refusal reasons entirely** — the fourth reason for refusing is indistinguishable from the first three, and nobody finds out.

*The general form worth remembering:* **a predicate that answers a question a caller will need explained should return the answer and the reason.** Booleans are right when the caller genuinely does not care why — and in a domain with rules, that is rarer than it looks.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lod-1',
      level: 'basic',
      question: 'How do you start a low-level design question?',
      guidance:
        'Look for behaviours before entities. A candidate who begins by listing nouns from the prompt will produce data holders plus a god service, and every follow-up will confirm it.',
    },
    {
      id: 'iq-lod-2',
      level: 'basic',
      question: 'What does single responsibility actually mean?',
      guidance:
        'One reason to change — one stakeholder or one kind of decision. Strong answers reject "does one thing" as unfalsifiable and give the list-the-reasons test.',
    },
    {
      id: 'iq-lod-3',
      level: 'intermediate',
      question: 'Callers keep reading a getter and computing something. What is wrong?',
      guidance:
        'Behaviour is on the wrong object; the data escaped and the rule followed it to every caller. Look for "tell, don\'t ask" and for the getter-count diagnostic.',
    },
    {
      id: 'iq-lod-4',
      level: 'intermediate',
      question: 'Would you use inheritance or composition here, and why?',
      guidance:
        'The answer must name the axes of variation. "Composition because type and capability vary independently" is an argument; "composition is preferred" is a slogan.',
    },
    {
      id: 'iq-lod-5',
      level: 'advanced',
      question: 'Where would you put interfaces in this design, and where would you not?',
      guidance:
        'At the seams the prompt names, and explicitly nowhere else. Excellent answers decline an abstraction and state the trigger that would change the decision.',
    },
    {
      id: 'iq-lod-6',
      level: 'advanced',
      question: 'I want to add a new pricing rule. What changes?',
      guidance:
        'A new implementation, with nothing existing modified. Look for the candidate checking this property on their own design before being asked.',
    },
    {
      id: 'iq-lod-7',
      level: 'followup',
      question: 'You have five one-method classes. Is that good design?',
      guidance:
        'Only if they change for different reasons. If they always change together they were one responsibility split by mechanism, which is a different mess from a god service.',
    },
    {
      id: 'iq-lod-8',
      level: 'followup',
      question: 'Your method returns a boolean. Is that the right return type?',
      guidance:
        'Usually not for a domain decision: it discards the reason, so the caller re-derives it and duplicates the rule. A result type carrying the reason keeps the decision in one place.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lod-1',
      kind: 'explain-yourself',
      prompt:
        'You have just proposed three interfaces in a 45-minute design. The interviewer asks, flatly: "Is this over-engineered?" Answer it — and be prepared for the answer to be partly yes.',
      discussion: `The question is a test of judgment rather than of conviction, and **the worst answer is a defence of all three.** An interviewer asking this has usually spotted one that is unearned, and confirming it is worth more than defending it.

**The structure of a good answer: justify by requirement, distinguish by evidence, and concede the weakest.**

**Justify by requirement, not by principle.**

\`\`\`
Weak:   "Interfaces make the design flexible and testable."
Strong: "You said pricing is configurable, so PricingPolicy is a
         seam you named. Allocation the same — you asked for new
         vehicle types. Those two I would keep."
\`\`\`

**A seam justified by a sentence in the prompt is not over-engineering, and saying which sentence is what makes the distinction visible.** The interviewer knows what they asked for; showing that your abstractions map onto it demonstrates that you were listening rather than applying a template.

**Then distinguish the third one honestly.**

\`\`\`
"The storage interface is the weakest of the three. There is one
 store and you did not say it varies. I put it there out of habit,
 and if you are asking whether it earns its place — it does not
 yet. I would inline it and add it when there is a second
 implementation or a test I cannot write without one."
\`\`\`

**Three things that answer does.**

**It concedes something real, which makes the other two justifications credible.** A candidate who defends everything sounds like they cannot tell the difference; **a candidate who drops one sounds like they can.**

**It names the trigger.** "When there is a second implementation, or a test I cannot otherwise write" is a decision rule, and **having a rule is the thing being assessed.** The interviewer is not checking whether you like interfaces; they are checking whether you have a principle for adding them.

**And it is not self-flagellating.** "I put it there out of habit" is a single clause, not an apology. **The answer moves to what you would do instead**, which is where the interview wants to be.

**What to avoid, specifically.**

**"It is only three interfaces"** — a size argument against a judgment question, and it dodges.

**"It will be needed eventually"** — which is the speculative-generality claim, and **an interviewer who asks this question has already decided that argument is weak.**

**"You are right, let me remove all of them"** — over-correction, and it discards two abstractions the prompt asked for. **Conceding more than the evidence supports is as poor a signal as conceding nothing**, because it suggests the original choices had no reasoning behind them either.

**And the version of this that is genuinely hard: when the interviewer is wrong.**

Sometimes all three are justified and the question is probing whether you will fold. **The answer is the same shape — requirement, evidence, and then a real offer:**

\`\`\`
"All three map onto something you asked for, so I would keep them.
 But if you would rather I collapse one to keep the diagram
 smaller, PricingPolicy is the one I would defend hardest and
 the notification one I would drop first — it is the least
 supported by what you told me."
\`\`\`

**Which holds the position and still gives them somewhere to go.** You have ranked your own abstractions by how well the requirements support them, **and a ranking is a stronger artefact than a defence** — it shows the reasoning is ordered rather than uniform.

**The transferable point:** when asked whether a design is over-engineered, **answer by mapping each abstraction to the requirement that produced it, then rank them and drop the weakest.** The concession buys credibility for the ones you keep, and the ranking demonstrates the judgment the question is actually asking about.`,
    },
    {
      id: 'al-lod-2',
      kind: 'what-changes-if',
      prompt:
        'Change one constraint: the implementation language has no interfaces and no classes — plain functions and records only. Does the responsibility argument survive?',
      discussion: `**Almost entirely, and what it loses is worth knowing precisely** — because the parts that survive are the parts that were about design rather than about syntax.

**What survives unchanged.**

**Behaviour-first discovery.** Listing verbs and asking what information each needs has nothing to do with classes. **The output is a set of functions with their parameters**, and the grouping question is identical: which functions need the same data?

**"One reason to change".** A module of functions edited by three stakeholders has three responsibilities exactly as a class would. **The test is about who edits, not about how code is packaged.**

**Seams.** A seam becomes a function parameter rather than an injected interface:

\`\`\`
// with classes
new Lending(pricingPolicy, finePolicy)

// without
borrow(request, { loanPeriod, fine })   // functions passed in
\`\`\`

**A higher-order function is a one-method interface**, so the seam discipline transfers directly — and the "one implementation and no requested variation" test still applies to a function parameter that only ever receives one function.

**Composition over inheritance survives trivially**, because there is no inheritance to prefer against. **The axes-of-variation argument becomes "which fields does this record carry"**, which is the same reasoning with less ceremony.

**And the seam-naming rule survives:** name the parameter for the role (\`loanPeriod\`) rather than the mechanism (\`fourteenDayPeriod\`).

**What genuinely changes.**

**Encapsulation becomes a convention rather than a guarantee.** Without private fields, **a record's internals are readable by anyone**, so "tell, don't ask" cannot be enforced by the language — only by discipline and module boundaries.

\`\`\`
// The rule still exists; nothing stops you bypassing it
function overdueBy(loan: Loan, at: Date): Days
// and a caller can still do: (at - loan.due) / DAY
\`\`\`

*What partly recovers it:* **module-level visibility.** Exporting \`overdueBy\` while keeping the record's construction internal to the module gets most of the way there — **the boundary moves from the object to the module**, which is a coarser but real unit of encapsulation.

**Polymorphic dispatch becomes explicit.** Where a class hierarchy would dispatch on type, you now pass the behaviour or switch on a tag. **Passing behaviour is usually better anyway** — it is composition — but a tagged union with a switch is the honest alternative and it concentrates the dispatch in one place, which is sometimes clearer than scattering it across implementations.

**And identity versus value blurs.** Without classes, the difference between "this loan" and "a loan with these values" is a convention about an id field. **Entities need an explicit identity discipline** that classes give you for free by reference.

**What becomes easier, which is the part people do not expect.**

**The god-service failure mode is harder to fall into.** There is no natural container to accumulate methods, **so functions tend to sit near the data they take** — the language nudges toward the right grouping rather than away from it.

**And speculative abstraction is more obviously speculative.** A function parameter that only ever receives one function is visibly pointless in a way an interface with one implementation is not. **Interfaces look like architecture; an unused parameter looks like an unused parameter.**

**The conclusion worth drawing.**

**The responsibility argument was never about classes.** It is about **which code changes for which reason, and whether behaviour sits with the data it needs** — both of which are language-independent. Classes provide enforcement (private state) and convenience (dispatch, identity); **they do not provide the design.**

**Which has a practical consequence for interviews:** a candidate who can only express these ideas as class diagrams has learned a notation. **A candidate who can say "these three functions always change together, so they are one module, and this parameter is the seam you asked for" has learned the idea** — and that answer works in any language the interviewer chooses.

*And the diagnostic that survives all of it:* **if answering an extension question means modifying existing code rather than supplying something new, the behaviour is in the wrong place.** That test needs no classes, no interfaces and no patterns — only the question.`,
    },
  ],

  revision: {
    bullets: [
      'Objects come from behaviour, not from the nouns in the prompt.',
      'Noun extraction produces data holders plus one service that owns every rule.',
      'And then every extension question lands in that one class, so every answer is "add a branch".',
      'The method: list the verbs, ask what information each needs, assign it to the owner of that information.',
      'If nobody owns the information, you have found an object — usually a policy or a strategy.',
      'The objects that matter are the ones no noun in the prompt names.',
      '"A class does one thing" is unfalsifiable; "one reason to change" is a mechanical test.',
      'List the reasons a class might be edited — different stakeholders mean different responsibilities.',
      'A class edited for four reasons is the most depended-on and least stable class in the design.',
      'If two classes always change together, they were one responsibility split by mechanism.',
      'A getter is a public field with extra steps — the data escapes and the behaviour follows it.',
      'Tell, don\'t ask: if you fetch data then decide, the decision belongs on the object.',
      'A domain class of getters with no methods means something else is doing its work.',
      'Inheritance couples you to the parent\'s implementation, not just its interface.',
      'And it commits you to one axis of variation — the second axis multiplies the class count.',
      'Inheritance is fine for "is a kind of" over a closed set with no state in the base.',
      'The prompt names the seams: "extensible to", "configurable", "support both".',
      'An interface with one implementation and no requested variation is unearned — decline it on the record.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A method for finding objects: list the behaviours a system must perform, determine what information each needs, and assign each behaviour to whoever owns that information — letting the entities fall out rather than starting from them.',
    whyItExists:
      'Because noun extraction reliably produces data holders plus a god service, and every extension question an interviewer asks then lands in the same class. Behaviour-first assignment makes those changes additions instead of modifications.',
    whenToUse: [
      'Behaviour-first discovery at the start of any low-level design question.',
      '"One reason to change" whenever arguing that a class is doing too much.',
      'Tell-don\'t-ask whenever callers fetch data and then decide.',
      'Composition whenever two or more things vary independently.',
      'An interface exactly where the prompt says variation is coming.',
    ],
    whenNotToUse: [
      'Noun extraction as the starting method.',
      '"Does one thing" as a responsibility test.',
      'Getters as evidence of encapsulation.',
      'Inheritance when a second axis of variation is foreseeable.',
      'An interface with one implementation and no requested variation.',
      'Splitting classes by mechanism rather than by reason to change.',
    ],
    alternatives: [
      'A transaction script — data plus a procedure — which is coherent when there are no extension requirements.',
      'A tagged union with one switch, when dispatch is clearer concentrated than scattered.',
      'Functions with behaviour passed as parameters, which is the same design without classes.',
      'Module-level visibility instead of private fields, when the language has no classes.',
      'A decorator over an existing policy, when a new rule wraps rather than replaces one.',
    ],
    tradeoffs: [
      'Behaviour-first discovery buys change locality and costs a few minutes of method up front.',
      '"One reason to change" buys a mechanical test and requires knowing the stakeholders.',
      'Tell-don\'t-ask buys one rule in one place and costs separating entities from wire formats.',
      'Composition buys independent axes and costs assembly code somewhere.',
      'Seams only where requested buys a defensible design and costs an occasional refactor.',
      'A result type over a boolean buys reasons that travel and costs a richer type.',
    ],
    failureModes: [
      'A god service holding every rule, depended on by everything.',
      'Anaemic data classes with getters and no behaviour.',
      'A switch on a type enum, then a nested switch when the second dimension arrives.',
      'A method signature change that ripples to every caller.',
      'A class hierarchy doubling when a second axis of variation appears.',
      'A swarm of one-method classes that all change together.',
      'An interface named after its single implementation.',
      'Speculative abstractions an interviewer asks you to justify.',
      'A boolean return that pushes the caller into re-deriving the decision.',
    ],
    followUpQuestions: [
      'What must this system do? (Verbs, not entities.)',
      'What information does this behaviour need?',
      'Who owns that information?',
      'Which objects in my design are not nouns from the prompt?',
      'Why might this class be edited, and by whom?',
      'Do these two classes always change together?',
      'Are callers fetching data and then deciding?',
      'What varies independently here?',
      'Which sentence in the prompt justifies this interface?',
      'If asked to add X, is that an addition or a modification?',
      'Does this boolean discard a reason the caller will need?',
    ],
  },
});
