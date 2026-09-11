import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-lld-framework',
  title: 'The LLD interview framework',
  summary:
    'Eight steps with a time budget, and one decision that determines the outcome: which fifteen percent of the code you actually write. Most machine-coding rounds are lost to scaffolding, not to the hard part.',
  phase: 'lld',
  module: 'oo-foundations',
  position: 58,
  kind: 'method',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['framework', 'scoping', 'invariants', 'time-budget'],
  prerequisites: ['l-solid'],
  resources: [
    {
      key: 'kent-beck-tdd',
      tier: 'must',
      note: 'Read it for tests as a design driver rather than a verification step. The framework\'s test step is where an invariant becomes checkable, and an invariant you cannot write a test for is one you have not stated precisely.',
    },
    {
      key: 'fowler-uml-distilled',
      tier: 'must',
      note: 'Read the first chapter on using UML as sketch rather than as blueprint. That distinction is exactly the difference between a diagram that earns its three minutes and one that consumes fifteen.',
    },
    {
      key: 'refactoring-guru-solid',
      tier: 'good',
      note: 'Use it as the checklist for the audit pass near the end. Running five questions over a finished design takes two minutes and catches the things an interviewer would otherwise find first.',
    },
    {
      key: 'refactoring-guru-patterns',
      tier: 'good',
      note: 'Read strategy and state. Between them they cover most legitimate seams in a machine-coding problem, and recognising which one a requirement is asking for saves several minutes of deliberation.',
    },
    {
      key: 'clean-architecture-blog',
      tier: 'advanced',
      note: 'Read it for dependency direction as the thing that makes a boundary worth drawing. Useful in the trade-offs step, when you need to say why a boundary exists rather than that it does.',
    },
  ],

  intuition: {
    body: `Machine-coding rounds are rarely lost on the hard part. **They are lost on the scaffolding** — twenty minutes spent on constructors, getters, a repository nobody asked for and a \`main\` that wires it together, and then the eviction policy or the seat-hold logic is described rather than written because time ran out.

**So the decision that determines the outcome is made in the first five minutes: which fifteen percent of the code you will actually write.**

\`\`\`
The 85% you can legitimately sketch or stub:
  persistence, wiring, getters, input parsing, a main(),
  anything CRUD-shaped

The 15% that IS the problem:
  the eviction path · the hold-and-expire logic
  the split calculation · the scheduling decision
  the win detection · the rate-limit accounting
\`\`\`

**Every problem has one or two methods that are the problem**, and the interviewer knows which they are. **Writing those completely, with their invariant stated and a test that proves it, is the round.**

Then the second thing the framework exists to force: **state the invariant before writing code.**

\`\`\`
"At most N entries. Get and put are O(1). On overflow the
 least recently used entry is removed."
\`\`\`

**That sentence does three jobs.** It tells the interviewer you know what the problem is. It determines the data structures — O(1) plus recency ordering is a hash map plus a linked list, and the invariant chose it. **And it gives you your tests for free**, because a test is an invariant with numbers in it.

**Skipping it is why candidates pick a structure and then discover it cannot meet a requirement** twenty minutes in.

And the third thing: **the middle of the interview is about responsibilities, not classes.**

Listing classes is fast and feels productive, and it produces the god-service design from the previous lessons. **Assigning behaviours to owners is slower and is the thing being graded** — because every extension question the interviewer asks is a test of where behaviour lives.

**The eight steps are a time budget as much as a sequence.** Requirements and responsibilities get the front half; core logic gets the largest single block; **the diagram gets three minutes and not fifteen.** A candidate still drawing boxes at minute twenty has already lost the round, whatever the boxes say.`,
    analogyLimit:
      'The high-level design framework does not transfer directly, and the difference is the deliverable. An HLD round produces a defended architecture — talking is the work. A machine-coding round produces code that runs, so time spent narrating is time not spent implementing. The other trap is treating it as eight equal steps: requirements, responsibilities and core logic are where the round is decided, and the rest exists to keep those three honest.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate is given 45 minutes to "design and implement an LRU cache". They spend 5 minutes on requirements, 10 drawing a class diagram with `Cache`, `CacheEntry`, `EvictionPolicy`, `CacheStore` and `CacheStatistics`, 15 writing constructors, getters and a `CacheFactory`, and the final 15 implementing `get` and `put` — finishing `get` and describing `put` verbally. Where did the round go wrong, and what would the same 45 minutes have looked like?',
      answer: `**The round was lost at minute five, when they started drawing instead of deciding what to implement.**

\`\`\`
Spent:  5 requirements · 10 diagram · 15 scaffolding · 15 core
Result: the ONE method that is the problem was not written
\`\`\`

**\`put\` is the problem.** It is where the capacity invariant is enforced, where eviction happens, and where the two data structures must stay consistent. **\`get\` is the easy half** — a lookup plus a recency update — and it got the time.

**Three specific misallocations.**

**Ten minutes of diagram for a five-class design.** A diagram is communication; **at minute fifteen with no code written, it is communicating that there is no code.** Three minutes would have conveyed the same structure.

**\`CacheStatistics\` and \`CacheFactory\` are inventions.** Nothing in "design and implement an LRU cache" asks for either. **Every invented class costs implementation time twice** — once to write, once because it was time not spent on \`put\`.

**Fifteen minutes of constructors and getters.** This is the scaffolding trap in its purest form: **code that is certainly correct and certainly not being assessed.**

**And the deeper failure, which caused the others: no invariant was stated.** Without "at most N entries, O(1) operations, least-recently-used evicted", **there is nothing to tell you that \`put\` is the interesting method** — so the time went where the typing was easiest.

**What the same 45 minutes should look like.**

\`\`\`
0–5    Requirements + the invariant, out loud:
       "Capacity N. get/put O(1) average. On overflow, evict
        the least recently used. Thread safety: I will note
        where a lock goes and not implement it unless you
        want it."
       And: "I will implement get, put and eviction fully.
        Statistics and persistence I will leave out."

5–8    Responsibilities — two objects, not five:
       · the map: key → node            (lookup)
       · the intrusive list: recency order (ordering)
       and the observation that they must move together,
       which is WHY they belong in one class rather than
       behind an EvictionPolicy interface

8–11   Signatures, and the eviction seam IF asked for:
       get(k): V | undefined
       put(k, v): void
       (no interface unless "different eviction policies"
        was in the prompt — and then it is one interface)

11–35  CORE LOGIC. Both methods, completely, including:
       · the doubly-linked list operations
       · eviction on overflow
       · the update-existing-key path, which is where
         most implementations break

35–42  Tests: capacity respected · LRU order under gets ·
       update does not grow size · eviction order after
       a mixed sequence

42–45  Trade-offs: the lock granularity, TTL as an
       extension, what a second eviction policy would cost
\`\`\`

**Twenty-four minutes on the two methods that are the problem, and seven on tests that prove the invariant.** Everything the original candidate spent twenty-five minutes on — the diagram, the factory, the statistics, the getters — **either shrinks to three minutes or disappears.**

**And the update-existing-key path is worth naming as the specific thing the original candidate would have got wrong anyway.** Putting a key that already exists must move it to most-recent **without increasing the size** — it is the case that distinguishes a working implementation from one that passes a trivial test, and it is unreachable in fifteen rushed minutes.

**The transferable diagnostic: at the halfway point, ask yourself whether the hard method is written.** If it is not, **stop whatever you are doing and write it** — an incomplete diagram with working core logic is a pass, and a complete diagram with described logic is not.`,
    },
  body: `## The eight steps, with a budget

For a 45–60 minute round. **The budget is the framework; the sequence is the easy part.**

\`\`\`
1  Requirements & scope        5–8 min   ← decide what you implement
2  Entities & value types      2–3 min
3  Responsibilities            6–8 min   ← the thing being graded
4  Interfaces & signatures     3–4 min
5  Relationships               2–3 min   ← a sketch, not a blueprint
6  Core logic                 15–20 min  ← the largest single block
7  Tests                       5–7 min
8  Trade-offs & audit          3–4 min
\`\`\`

**Two things to notice about the shape.** Steps 1, 3 and 6 take two-thirds of the time and decide the outcome. **And step 6 is bigger than steps 2, 4 and 5 combined** — if that is not true of your actual interview, you are drawing rather than building.

## Step 1 — Requirements, and the scope declaration

**Two outputs, and the second one is the unusual one.**

**A numbered list of what is in scope**, built by asking rather than assuming. Three or four clarifying questions, each of which changes the design:

\`\`\`
"Is capacity fixed at construction, or resizable?"
"Should expiry be supported, or only capacity eviction?"
"Single-threaded, or must it be safe under concurrency?"
"Are different eviction policies a requirement?"
\`\`\`

**Each question either adds a requirement or removes one**, and removing one is worth as much as adding one — **a "no" is permission not to build something.**

**And then the scope declaration, said out loud:**

> *"I will implement get, put and the eviction path completely, with tests. I will stub persistence and leave statistics out unless you want them."*

**This does three things.** It tells the interviewer you know which part matters. It gets agreement before you spend the time, **so a mismatch surfaces at minute five rather than minute forty.** And it makes stubbing a declared decision rather than something you ran out of time for.

*What not to do:* start coding without it and hope the priorities were obvious. **They usually are obvious — and saying them is what proves you saw them.**

## Step 2 — Entities and value types

**Short, because the previous lessons did the work.** Behaviour first, nouns after. What this step adds is one distinction worth making explicitly:

\`\`\`
Entity      has identity; two with the same fields are different
            things (a Booking, an Account, a CacheNode)
Value type  has no identity; two with the same fields are the
            same thing (Money, a Duration, a SeatId)
\`\`\`

**Getting this wrong produces bugs that look like logic errors.** Comparing entities by value, or putting a mutable entity in a set keyed by its fields, **fails in ways that are hard to see** — and the fix is a modelling decision rather than a code fix.

**Value types should be immutable and should carry their own rules** — \`Money\` that cannot be negative, a \`SeatId\` that validates its format. **Two minutes here removes a class of later mistakes.**

## Step 3 — Responsibilities: the part being graded

**For each behaviour from step 1, name its owner and say why.** Out loud, in one sentence each.

\`\`\`
"Evicting on overflow needs the capacity and the recency order,
 and both live in the cache, so the cache does it."
"Deciding WHICH entry to evict is a policy — and the prompt
 said policies vary, so that is a seam."
"Computing a fee needs the duration and the rate rules, so it
 belongs with the rates, not with the ticket."
\`\`\`

**The pattern is: behaviour, information it needs, owner of that information.** And the reason to say it out loud is that **the interviewer is grading the assignment, not the class list** — a silent diagram does not show them the reasoning.

**And this is where the two structural traps live.**

**The god service**, if you assigned nothing and let behaviour collect.

**And the opposite: splitting things that must move together.** In an LRU cache the map and the recency list must be updated in the same operation, **so an \`EvictionPolicy\` that owns the list while the cache owns the map has split one invariant across two objects** — which is worse than either object being slightly large. *The test: can this invariant be violated by calling the two objects in the wrong order?* If yes, they are one responsibility.

## Step 4 — Interfaces and signatures

**Only at the axes the prompt named.** Nothing else. One or two interfaces in a 45-minute problem; **five means step 1 was skipped.**

**And then write the signatures before the bodies**, because signatures are where two recurring decisions get made.

**Return a result, not a boolean, for any decision a caller will need explained.**

\`\`\`ts
// Loses the reason, so the caller re-derives it
canBook(seats: SeatId[]): boolean

// The reason travels with the refusal
hold(seats: SeatId[]): HoldResult
// { ok: true, holdId, expiresAt } | { ok: false,
//   reason: 'taken' | 'limit' | 'unknown-seat', detail }
\`\`\`

**Make the time and the clock explicit.** Anything with expiry, rates or ordering needs the current time as an input rather than reading a global clock:

\`\`\`ts
put(k: K, v: V, now: Instant): void
\`\`\`

**Because a clock you inject is a clock you can test**, and every expiry test otherwise needs a sleep. **This is the single highest-value signature habit in machine coding** — it converts untestable code into testable code for the price of one parameter.

## Step 5 — Relationships, as a sketch

**Three minutes. Who holds whom, what the lifetimes are, and whether anything is shared.**

\`\`\`
Cache ──owns──▶ Map<K, Node>
Cache ──owns──▶ Node list (head/tail sentinels)
Cache ──uses──▶ EvictionPolicy   (if the prompt asked)
\`\`\`

**A sketch is for communication, and the test of whether it is working is whether the interviewer is engaging with it.** If they are silent while you draw, **you are drawing for yourself** and it is time to start writing code.

*And one relationship question is worth asking explicitly:* **is anything shared mutable state?** If two objects hold a reference to the same mutable thing, that is where the concurrency conversation will go — **and noticing it before being asked is a strong signal.**

## Step 6 — Core logic, and the invariant

**The largest block, and the one thing to protect when time slips.**

**Start by writing the invariant as a comment**, then implement toward it:

\`\`\`ts
// INVARIANT: map.size === list.length <= capacity
//            list head = most recently used
//            every map value is a node in the list
\`\`\`

**Three rules for this block.**

**Write the hard path first.** \`put\` before \`get\`; eviction before the happy path; the hold-expiry before the hold. **If time runs out, it runs out on the easy part.**

**Handle the case that distinguishes implementations.** Every problem has one: **updating an existing key in an LRU cache**, a hold expiring while payment is in flight, a rate-limiter window boundary, a seat held by the same user twice. **Interviewers know these cases and check them specifically.**

**Say what you are skipping as you skip it.** "I am not locking here; I will describe the locking in trade-offs" is a declared decision. **Silent omission looks like an oversight.**

## Step 7 — Tests that prove the invariant

**Four or five tests, chosen from the invariant rather than from the methods.**

\`\`\`
Invariant: size never exceeds capacity
  → put capacity+1 items, assert size === capacity

Invariant: LRU order reflects access
  → put a,b,c; get(a); put(d); assert b was evicted

Invariant: update does not grow the collection
  → put(a,1); put(a,2); assert size === 1 and value === 2

The distinguishing edge case
  → capacity 1; the degenerate case breaks naive
    implementations

And one for the seam, if there is one
  → a second eviction policy produces different evictions
\`\`\`

**The second test is the one that demonstrates understanding**, because it requires a mixed sequence rather than a single operation — **it is the difference between testing methods and testing the invariant.**

*And the point about step 7 that matters most:* **an invariant you cannot write a test for is one you have not stated precisely enough.** So this step validates step 6's comment as much as the code.

## Step 8 — Trade-offs and a two-minute audit

**Three things, briefly.**

**What you deliberately left out, and what would trigger adding it.** "No TTL — I would add an expiry timestamp per node and check it on read, which makes eviction lazy."

**The concurrency answer, stated once with its granularity.** "A single lock around get and put, because the two structures must move together. A read-write lock would not help, since get mutates recency order" — **that last clause is the insight, and it is a common trap.**

**Then the five-question audit**, spending twenty seconds each: which class has several reasons to change; which axis did the prompt name; does any subtype surprise a caller; is anyone stubbing what they cannot support; does a rule depend on a mechanism. **Two minutes, and it catches what the interviewer would otherwise raise first.**

## What to do when time slips

It will. **The priority order, in the moment:**

\`\`\`
1  Core logic complete            ← never sacrifice this
2  One test proving the invariant
3  The scope declaration          ← already said, costs nothing
4  Trade-offs, spoken not written
5  Tests beyond the first
6  The diagram
7  Everything else
\`\`\`

**Working core logic with one test and no diagram is a pass. A complete diagram with described logic is not** — and the candidate who knows that ordering in advance is the one who makes the right call at minute thirty.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'budget',
      title: 'The eight steps as a time budget',
      caption:
        'Step through it. The three wide blocks are two-thirds of the round; if your diagram block is bigger than your core-logic block, the round is already lost.',
      nodes: [
        { id: 's1', label: '1. Requirements + scope declaration (5–8)', kind: 'note', x: 0, y: 40, detail: 'Two outputs: a numbered scope list from three or four clarifying questions, and the scope declaration said out loud — "I will implement eviction fully and stub persistence". That gets agreement before you spend the time, so a mismatch surfaces at minute five rather than minute forty.' },
        { id: 's2', label: '2. Entities & value types (2–3)', kind: 'note', x: 300, y: 40, detail: 'Short, because behaviour-first discovery did the work. What it adds: entity versus value type. Comparing entities by value, or keying a set on a mutable entity\'s fields, produces bugs that look like logic errors and are fixed by modelling.' },
        { id: 's3', label: '3. Responsibilities (6–8)', kind: 'service', x: 0, y: 170, detail: 'The part being graded, said out loud: behaviour, information it needs, owner. And the two traps — the god service, and splitting things that must move together. If two objects can violate an invariant by being called in the wrong order, they are one responsibility.' },
        { id: 's4', label: '4. Interfaces & signatures (3–4)', kind: 'note', x: 300, y: 170, detail: 'Only the axes the prompt named — five interfaces means step 1 was skipped. And two signature habits: return a result rather than a boolean, and inject the clock. An injected clock converts untestable expiry code into testable code for one parameter.' },
        { id: 's5', label: '5. Relationships (2–3)', kind: 'note', x: 600, y: 40, detail: 'A sketch for communication, not a blueprint. The test of whether it is working is whether the interviewer engages — silence while you draw means you are drawing for yourself. Ask explicitly whether anything is shared mutable state.' },
        { id: 's6', label: '6. Core logic (15–20)', kind: 'store', x: 600, y: 170, detail: 'The largest block, protected when time slips. Write the invariant as a comment first, then the hard path before the easy one: put before get, eviction before the happy path. And handle the case that distinguishes implementations — updating an existing key, a hold expiring mid-payment, a window boundary.' },
        { id: 's7', label: '7. Tests from the invariant (5–7)', kind: 'note', x: 900, y: 100, detail: 'Four or five, derived from the invariant rather than from the method list — which is why the mixed-sequence test is the one that shows understanding. And an invariant you cannot write a test for is one you have not stated precisely enough.' },
        { id: 's8', label: '8. Trade-offs + five-question audit (3–4)', kind: 'note', x: 900, y: 240, detail: 'What you left out and what would trigger adding it; the concurrency answer with its granularity stated once; then twenty seconds per SOLID question. Two minutes that catch what the interviewer would otherwise raise first.' },
        { id: 'slip', label: 'When time slips', kind: 'note', x: 600, y: 320, detail: 'Priority order: core logic complete, one invariant test, the scope declaration, spoken trade-offs, more tests, the diagram, everything else. Working core logic with one test and no diagram is a pass; a complete diagram with described logic is not.' },
      ],
      edges: [
        { id: 'b1', source: 's1', target: 's2', kind: 'control' },
        { id: 'b2', source: 's2', target: 's3', kind: 'control' },
        { id: 'b3', source: 's3', target: 's4', kind: 'control' },
        { id: 'b4', source: 's4', target: 's5', kind: 'control' },
        { id: 'b5', source: 's5', target: 's6', kind: 'control' },
        { id: 'b6', source: 's6', target: 's7', kind: 'control' },
        { id: 'b7', source: 's7', target: 's8', kind: 'control' },
        { id: 'b8', source: 's6', target: 'slip', kind: 'control' },
      ],
      steps: [
        {
          id: 'bs1',
          title: 'Decide what you will implement, and say so',
          description:
            'The outcome is determined here. Most rounds are lost to scaffolding, so declaring which fifteen percent you will write — and getting agreement — is the highest-value five minutes available.',
          nodes: ['s1', 's2'],
          edges: ['b1'],
        },
        {
          id: 'bs2',
          title: 'Assign behaviours to owners, out loud',
          description:
            'This is what is being graded, and a silent diagram does not show the reasoning. Watch for both traps: nothing assigned, or an invariant split across two objects that must move together.',
          nodes: ['s3'],
          edges: ['b2'],
        },
        {
          id: 'bs3',
          title: 'Then signatures — and inject the clock',
          description:
            'Seams only where the prompt named an axis. Result types instead of booleans, and time as a parameter: one parameter converts every expiry test from a sleep into an assertion.',
          nodes: ['s4', 's5'],
          edges: ['b3', 'b4'],
        },
        {
          id: 'bs4',
          title: 'Write the invariant, then the hard path',
          description:
            'The biggest block. Put before get, eviction before the happy case, and the distinguishing edge case handled explicitly — because interviewers check exactly those.',
          nodes: ['s6'],
          edges: ['b5'],
        },
        {
          id: 'bs5',
          title: 'Prove the invariant, then audit and concede',
          description:
            'Tests derived from the invariant rather than the methods. Then the concurrency granularity, the deliberate omissions, and five audit questions at twenty seconds each.',
          nodes: ['s7', 's8', 'slip'],
          edges: ['b6', 'b7', 'b8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'where-time-goes',
      title: 'Where the 45 minutes actually go',
      caption:
        'The same problem, two allocations. The difference is not skill — it is one decision made in the first five minutes about what will be written.',
      code: `flowchart TB
    subgraph LOST["**The round that is lost**"]
      direction LR
      L1["0–5<br/>requirements"] --> L2["5–15<br/>**class diagram**<br/>5 classes incl.<br/>Statistics, Factory"]
      L2 --> L3["15–30<br/>**scaffolding**<br/>constructors,<br/>getters, wiring"]
      L3 --> L4["30–45<br/>core logic:<br/>get done,<br/>**put described**"]
    end

    subgraph WON["**The round that is won**"]
      direction LR
      W1["0–5<br/>requirements<br/>+ **invariant**<br/>+ **scope declared**"] --> W2["5–11<br/>responsibilities<br/>+ signatures<br/>(clock injected)"]
      W2 --> W3["11–35<br/>**CORE LOGIC**<br/>put, get, eviction,<br/>update-existing-key"]
      W3 --> W4["35–45<br/>4 invariant tests<br/>+ lock granularity<br/>+ audit"]
    end

    D["**The single decision that separates them:**<br/>at minute five, which 15% will you write?<br/>Every invented class costs implementation<br/>time twice — once to write it, once as<br/>time not spent on the hard method."]

    L4 -.-> D
    W3 -.-> D

    style L2 fill:#40181c,stroke:#b4535e
    style L3 fill:#40181c,stroke:#b4535e
    style L4 fill:#40181c,stroke:#b4535e
    style W3 fill:#17272a,stroke:#35897e
    style D fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The published test-driven-development material is the most useful reference here, and not for the reason it is usually cited.

**Its central claim is that a test is a design act rather than a verification step.** Writing the test first forces you to state what the code must guarantee, in executable form — **which is exactly what the invariant step is doing**, with the test as the thing that proves you stated it precisely.

**And the practical consequence for this framework is specific: if you cannot write the test, the invariant is still vague.**

\`\`\`
Vague:      "the cache evicts old entries"
            → no test follows from this
Precise:    "after put(a) put(b) put(c) get(a) put(d),
             b is absent and a is present"
            → the test IS the statement
\`\`\`

**The second useful idea is the discipline about what to test.** Testing every method produces a suite that verifies the implementation you happen to have written. **Testing the invariant produces a suite that would catch a wrong implementation** — including one you write later.

**Three things to take from it.**

**Derive tests from the guarantee, not from the method list.** The mixed-sequence test is more valuable than five single-operation tests because **it is the one a broken implementation fails.**

**An injected clock is a testability decision, not a purity one.** The material's emphasis on fast feedback is the argument: **a test that sleeps is a test nobody runs**, so injecting time is what makes expiry testable at all.

**And writing the hard path first is the same idea as testing it first.** Both put the uncertain part where you still have time to be wrong about it.

**Where the reference does not help.** It assumes you have as much time as the work needs. **A machine-coding round does not**, so the strict test-first cycle is usually too slow — the adaptation that works is to state the invariant as a comment, implement toward it, and write the tests immediately after. **Same design benefit, and it fits the budget.**`,
  },

  tradeoffs: {
    intro:
      'The allocation decisions this framework makes, and what each direction costs.',
    rows: [
      {
        option: 'Start coding immediately',
        whenItWins:
          'A problem so familiar that the invariant and the structures are already decided.',
        whenItLoses:
          'You discover at minute twenty that the chosen structure cannot meet a requirement nobody stated.',
        cost:
          'A rewrite with no time to do it.',
      },
      {
        option: 'Requirements plus a spoken scope declaration',
        whenItWins:
          'Always. It surfaces a priority mismatch at minute five and makes stubbing a decision rather than a failure.',
        whenItLoses:
          'Five to eight minutes not spent typing.',
        cost:
          'A fifth of the round, for the decision that determines the other four-fifths.',
      },
      {
        option: 'A detailed class diagram',
        whenItWins:
          'When the interviewer is actively engaging with it and the structure is genuinely non-obvious.',
        whenItLoses:
          'At minute fifteen with no code, it communicates that there is no code.',
        cost:
          'Ten minutes that had to come from core logic.',
      },
      {
        option: 'A three-minute sketch',
        whenItWins:
          'Always. Enough to communicate ownership and lifetimes.',
        whenItLoses:
          'A complex relationship may need a second pass later.',
        cost:
          'Occasionally re-drawing one part.',
      },
      {
        option: 'Implementing breadth — every class, shallowly',
        whenItWins:
          'Nowhere. It looks complete and demonstrates nothing.',
        whenItLoses:
          'The one or two methods that are the problem end up described rather than written.',
        cost:
          'The round.',
      },
      {
        option: 'Implementing the hard fifteen percent completely',
        whenItWins:
          'Always. Working core logic with one test is a pass.',
        whenItLoses:
          'The design looks partial, and stubs must be declared rather than silent.',
        cost:
          'Saying "I am stubbing this" several times, which reads as deliberate.',
      },
      {
        option: 'Reading a global clock',
        whenItWins:
          'Code with no time-dependent behaviour at all.',
        whenItLoses:
          'Every expiry test needs a sleep, so the tests are slow and are not written.',
        cost:
          'Untestable expiry logic, which is usually the interesting logic.',
      },
      {
        option: 'Injecting time as a parameter',
        whenItWins:
          'Always, for anything with expiry, rates or ordering.',
        whenItLoses:
          'One extra parameter on several signatures.',
        cost:
          'Slight API noise, for testability of the hard part.',
      },
      {
        option: 'Returning booleans from decisions',
        whenItWins:
          'When the caller genuinely does not need to know why.',
        whenItLoses:
          'It discards the reason, so the caller re-derives it and the rule ends up in two places.',
        cost:
          'Duplicated decision logic.',
      },
      {
        option: 'Result types carrying the reason',
        whenItWins:
          'Any decision a caller must explain to a user.',
        whenItLoses:
          'A richer type to define and destructure.',
        cost:
          'A few lines, for the rule staying in one place.',
      },
      {
        option: 'Tests per method',
        whenItWins:
          'Coverage metrics.',
        whenItLoses:
          'They verify the implementation you wrote rather than the guarantee it must meet.',
        cost:
          'A suite that a wrong implementation can pass.',
      },
      {
        option: 'Tests derived from the invariant',
        whenItWins:
          'Always. The mixed-sequence test is the one a broken implementation fails.',
        whenItLoses:
          'Fewer tests, and they require the invariant to be stated precisely.',
        cost:
          'Thinking, which is the point.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Let me start by identifying the classes and drawing the class diagram."',
      whyWeak:
        'It skips the decision that determines the outcome — which part of the code will actually be written — and it spends the front of the round on the deliverable that matters least. At minute fifteen with a complete diagram and no code, the diagram is communicating that there is no code.',
      strongAnswer:
        '"Let me clarify a few requirements first, then state the invariant and tell you what I plan to implement. Capacity is fixed, eviction is least-recently-used, operations should be O(1). I will implement get, put and the eviction path completely with tests, and stub persistence. Then I will sketch the structure in a couple of minutes and spend the bulk of the time on put, because that is where the capacity invariant and the two data structures have to stay consistent."',
    },
    {
      weakAnswer: '"I have the structure laid out — now let me write the constructors and getters, then the main method to wire it up."',
      whyWeak:
        'This is scaffolding: code that is certainly correct and certainly not being assessed. Fifteen minutes of it is fifteen minutes taken from the one or two methods the interviewer is actually evaluating.',
      strongAnswer:
        '"I am going to skip constructors and wiring and go straight to put, because that is the method that is the problem. If you want to see the wiring at the end I will add it, but I would rather spend the time on eviction and the update-existing-key path — that second one is where most implementations break, since putting an existing key must move it to most-recent without growing the size."',
    },
    {
      weakAnswer: '"The cache uses an EvictionPolicy interface so the policy can be swapped out."',
      whyWeak:
        'If the prompt did not ask for multiple policies it is a speculative seam. Worse, it may split an invariant: the recency list and the key map must be updated in the same operation, so an eviction policy owning the list while the cache owns the map allows the two to be called in the wrong order.',
      strongAnswer:
        '"I am keeping the map and the recency list in one class, because they have to move together — if they were in separate objects an incorrect call order could violate the invariant, and that is worse than one slightly larger class. If you tell me eviction policies must vary I will add one interface for choosing the victim, keeping the list operations inside the cache."',
    },
    {
      weakAnswer: '"For expiry I will check the current system time when reading an entry."',
      whyWeak:
        'Reading a global clock makes every expiry test need a sleep, so the tests are slow and usually do not get written — which means the expiry logic ships untested, and expiry logic is typically the interesting part.',
      strongAnswer:
        '"I will pass the current time in as a parameter — put(key, value, now) and get(key, now). One extra parameter, and it means every expiry test is an assertion rather than a sleep. It is the single highest-value signature habit in these problems, because it converts the hardest-to-verify logic into the easiest."',
    },
    {
      weakAnswer: '"I will write a test for get and a test for put."',
      whyWeak:
        'Tests derived from the method list verify the implementation you happen to have written. They do not test the guarantee, so a wrong implementation can pass them.',
      strongAnswer:
        '"I derive the tests from the invariant. Size never exceeds capacity: put capacity plus one and assert the size. Recency reflects access: put a, b, c; get a; put d; assert b was evicted and a survives — that mixed sequence is the one a broken implementation fails. Update does not grow the collection: put a twice and assert size one. And capacity one, because the degenerate case breaks naive implementations."',
    },
    {
      weakAnswer: '"I ran out of time before the last part, but the design is complete."',
      whyWeak:
        'It reads as an oversight rather than a decision, and "the design is complete" describes the artefact that matters least. The interviewer wanted to see the hard method work.',
      strongAnswer:
        '"I said at the start I would prioritise put and eviction, and those are done with tests. What I deliberately left out is TTL — I would add an expiry timestamp per node and check it on read, which makes eviction lazy — and locking, where I would use a single lock around both operations rather than a read-write lock, because get mutates the recency order and so is not a read. Given another ten minutes I would write the lock and one concurrency test."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lf-1',
      front: 'What decision determines the outcome of a machine-coding round?',
      back: 'Which fifteen percent of the code you will actually write — decided and declared in the first five minutes.',
      topic: 'scoping',
    },
    {
      id: 'fc-lf-2',
      front: 'What is the eighty-five percent you may legitimately stub?',
      back: 'Persistence, wiring, getters, input parsing, a main method — anything CRUD-shaped.',
      topic: 'scoping',
    },
    {
      id: 'fc-lf-3',
      front: 'What three jobs does stating the invariant do?',
      back: 'Shows you know what the problem is, determines the data structures, and gives you your tests for free.',
      topic: 'invariants',
    },
    {
      id: 'fc-lf-4',
      front: 'What is the time budget shape for a 45-minute round?',
      back: 'Requirements 5–8, entities 2–3, responsibilities 6–8, interfaces 3–4, relationships 2–3, core logic 15–20, tests 5–7, trade-offs 3–4.',
      topic: 'time-budget',
    },
    {
      id: 'fc-lf-5',
      front: 'What does the scope declaration achieve?',
      back: 'Surfaces a priority mismatch at minute five rather than minute forty, and makes stubbing a declared decision rather than a failure.',
      topic: 'scoping',
    },
    {
      id: 'fc-lf-6',
      front: 'What distinguishes an entity from a value type?',
      back: 'Identity. Two entities with the same fields are different things; two value types with the same fields are the same thing.',
      topic: 'framework',
    },
    {
      id: 'fc-lf-7',
      front: 'What is the test for whether two objects are really one responsibility?',
      back: 'Can the invariant be violated by calling them in the wrong order? If yes, they must move together and belong in one class.',
      topic: 'framework',
    },
    {
      id: 'fc-lf-8',
      front: 'Why inject the clock?',
      back: 'Because a test that sleeps is a test nobody runs. One parameter converts the hardest-to-verify logic into the easiest.',
      topic: 'framework',
    },
    {
      id: 'fc-lf-9',
      front: 'When is a class diagram working?',
      back: 'When the interviewer is engaging with it. Silence while you draw means you are drawing for yourself — start writing code.',
      topic: 'time-budget',
    },
    {
      id: 'fc-lf-10',
      front: 'In which order should core logic be written?',
      back: 'Hard path first: put before get, eviction before the happy path. If time runs out, it runs out on the easy part.',
      topic: 'time-budget',
    },
    {
      id: 'fc-lf-11',
      front: 'Why derive tests from the invariant rather than the methods?',
      back: 'Per-method tests verify the implementation you wrote; invariant tests would catch a wrong implementation. The mixed-sequence test is the discriminating one.',
      topic: 'invariants',
    },
    {
      id: 'fc-lf-12',
      front: 'What does an untestable invariant tell you?',
      back: 'That you have not stated it precisely enough. "Evicts old entries" yields no test; a concrete sequence with an assertion is the statement.',
      topic: 'invariants',
    },
    {
      id: 'fc-lf-13',
      front: 'Why is a read-write lock usually wrong for an LRU cache?',
      back: 'Because get mutates the recency order, so it is not a read. That clause is the insight the concurrency question is testing.',
      topic: 'framework',
    },
    {
      id: 'fc-lf-14',
      front: 'What is the priority order when time slips?',
      back: 'Core logic complete, one invariant test, the scope declaration, spoken trade-offs, more tests, the diagram, everything else.',
      topic: 'time-budget',
    },
  ],

  quiz: [
    {
      id: 'q-lf-1',
      kind: 'scenario',
      prompt:
        'You are 22 minutes into a 45-minute LRU cache round. You have a five-class diagram, constructors and getters written, and neither get nor put implemented. What do you do?',
      options: [
        { id: 'a', label: 'Stop everything and implement put, including eviction and the update-existing-key path' },
        { id: 'b', label: 'Finish the remaining boilerplate quickly so the structure is complete, then implement' },
        { id: 'c', label: 'Implement get first, since it is simpler and guarantees something works' },
        { id: 'd', label: 'Explain the design verbally and ask for more time' },
      ],
      correct: ['a'],
      explanation:
        'Working core logic with no diagram passes; a complete diagram with described logic does not. Option c spends the remaining time on the easy half and leaves the interesting method unwritten — the hard path is written first precisely so that time runs out on the easy part.',
      difficulty: 'core',
      topic: 'time-budget',
    },
    {
      id: 'q-lf-2',
      kind: 'scenario',
      prompt:
        'Which statement of an LRU cache invariant is usable?',
      options: [
        { id: 'a', label: '"map.size equals list length, at most capacity; head is most recently used; every map value is a node in the list"' },
        { id: 'b', label: '"The cache evicts old entries when it gets full"' },
        { id: 'c', label: '"The cache is an LRU cache with capacity N"' },
        { id: 'd', label: '"get and put are both O(1)"' },
      ],
      correct: ['a'],
      explanation:
        'Only the first yields tests, and that is the test of whether an invariant is precise. Option d is a performance requirement rather than a state invariant — useful, and it constrains the structures instead of describing the guarantee. Options b and c restate the problem.',
      difficulty: 'core',
      topic: 'invariants',
    },
    {
      id: 'q-lf-3',
      kind: 'scenario',
      prompt:
        'A candidate proposes an `EvictionPolicy` interface that owns the recency list while the cache owns the key map. What is wrong?',
      options: [
        { id: 'a', label: 'It splits one invariant across two objects, so an incorrect call order can leave the map and list inconsistent' },
        { id: 'b', label: 'Nothing — it correctly applies the strategy pattern' },
        { id: 'c', label: 'Interfaces are always speculative in a 45-minute round' },
        { id: 'd', label: 'The policy should own both structures instead' },
      ],
      correct: ['a'],
      explanation:
        'The structures must be updated in the same operation, and the test is whether calling the two objects in the wrong order can violate the invariant. If policies genuinely vary, the seam should choose the victim while the list operations stay inside the cache. Option c overstates: a seam on an axis the prompt names is earned.',
      difficulty: 'advanced',
      topic: 'framework',
    },
    {
      id: 'q-lf-4',
      kind: 'scenario',
      prompt:
        'Why pass the current time as a parameter rather than reading a system clock?',
      options: [
        { id: 'a', label: 'Every expiry test becomes an assertion instead of a sleep, so the tests are fast enough to actually be written' },
        { id: 'b', label: 'It avoids timezone bugs' },
        { id: 'c', label: 'It is required for thread safety' },
        { id: 'd', label: 'System clocks are not monotonic' },
      ],
      correct: ['a'],
      explanation:
        'Testability, and the practical consequence is that the expiry logic gets tested at all — a test that sleeps is a test nobody runs. The other options mention real concerns that are not why the parameter earns its place in an interview.',
      difficulty: 'core',
      topic: 'framework',
    },
    {
      id: 'q-lf-5',
      kind: 'scenario',
      prompt:
        'Which test best demonstrates that an LRU implementation is correct?',
      options: [
        { id: 'a', label: 'put a, b, c; get(a); put(d) — then assert b was evicted and a survives' },
        { id: 'b', label: 'put one item, then get it and assert the value' },
        { id: 'c', label: 'put capacity items and assert the size equals capacity' },
        { id: 'd', label: 'Assert that get returns undefined for a missing key' },
      ],
      correct: ['a'],
      explanation:
        'It requires a mixed sequence, so it fails for an implementation that evicts by insertion order rather than by access — which is the most common wrong implementation. The others are worth having and pass for a first-in-first-out cache too, so they do not discriminate.',
      difficulty: 'advanced',
      topic: 'invariants',
    },
    {
      id: 'q-lf-6',
      kind: 'multi',
      prompt:
        'Which of these belong in the scope declaration at minute five? Select all that apply.',
      options: [
        { id: 'a', label: 'Which methods you will implement completely' },
        { id: 'b', label: 'What you will stub or leave out' },
        { id: 'c', label: 'The invariant the implementation must maintain' },
        { id: 'd', label: 'The full class list with fields and methods' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three get agreement on priorities and pin down what correct means before any code exists — so a mismatch surfaces early and stubbing reads as deliberate. The class list is step two and comes from responsibilities; committing to it at minute five is the noun-extraction habit returning.',
      difficulty: 'core',
      topic: 'scoping',
    },
  ],

  exercises: [
    {
      id: 'ex-lf-1',
      kind: 'design',
      title: 'Budget a round you have not seen before',
      estimatedMinutes: 30,
      prompt: `You are given 60 minutes: *"Design and implement a system that tracks votes in a live poll. Multiple polls, each with options. Show current standings. A user may vote once per poll and may change their vote. Support a 'top K options' query."*

**Part 1.** Write the scope declaration you would say out loud at minute five, including the invariant.

**Part 2.** Identify the fifteen percent that is the problem, and say why each candidate for "hard part" is or is not it.

**Part 3.** Produce the minute-by-minute budget for the 60 minutes.

**Part 4.** Write the four tests you would produce, derived from the invariant.

Then answer:

- Which requirement in the prompt is the one most candidates will underestimate?
- What would you say if the interviewer asked for persistence at minute 50?`,
      rubric: [
        'Scope declaration names what will be implemented and what will be stubbed.',
        'States a precise invariant, including the one-vote-per-user constraint.',
        'Correctly identifies vote-change and top-K as the candidate hard parts.',
        'Reasons about which is genuinely hard rather than asserting.',
        'Budget allocates the largest block to core logic.',
        'Tests derive from the invariant, including a vote-change sequence.',
        'Identifies vote changing as the underestimated requirement, with reasoning.',
        'Handles the late persistence request without abandoning the core work.',
      ],
      modelAnswer: `**Part 1 — the scope declaration**

> *"Let me confirm a few things. Polls are independent — a vote in one does not affect another? Is 'top K' a live query or a snapshot? Roughly how many options per poll, and how many voters? And do I need to show who voted for what, or only the counts?"*
>
> *Assuming: independent polls, live top-K, tens of options per poll, counts only.*
>
> *"Then the invariant is: for each poll, the sum of the option counts equals the number of distinct users who have voted in it; each user appears in at most one option per poll; and the top-K query returns the K options with the highest counts, breaking ties consistently.*
>
> *I will implement voting, vote-changing, and the top-K query completely, with tests. I will stub storage — an in-memory map — and skip authentication, poll creation lifecycle and any HTTP layer. If you want persistence or the API surface instead, tell me now and I will re-prioritise."*

**Three things that declaration does.** It names the clarifying answers it assumed, so a wrong assumption surfaces immediately. **It states the invariant in a form that yields tests** — particularly the sum-equals-distinct-voters clause, which is what vote-changing can break. And it offers the re-prioritisation explicitly, **which is how you avoid the minute-50 surprise.**

---

**Part 2 — finding the fifteen percent**

**Three candidates. Two are the problem and one is not.**

**Candidate 1: recording a vote. Not the hard part.** Increment a count, record the user. **Two lines, no interesting states.**

**Candidate 2: changing a vote. This IS the hard part, and it is the one the prompt hides.**

\`\`\`
A user votes for option X, then changes to option Y:
  · decrement X
  · increment Y
  · update the user's recorded choice
  → three mutations that must be atomic with respect to
    the invariant, and if the user "changes" to X again
    the naive path decrements and increments the same
    option — which must be a no-op, not a double move
\`\`\`

**And it interacts with top-K**, because a change alters two counts at once — so any incrementally-maintained ordering must handle two moves per operation rather than one.

**Candidate 3: the top-K query. This is the second hard part, and the interesting question is which implementation to choose.**

\`\`\`
(a) Sort all options per query:      O(n log n) per query
(b) A heap of size K per query:      O(n log K) per query
(c) Maintain a sorted structure:     O(log n) per vote,
                                     O(K) per query
\`\`\`

**With tens of options, (a) is genuinely fine** — and saying so is better than implementing (c) to look sophisticated. **The right answer depends on the ratio of votes to queries**, which is a clarifying question I should have asked:

\`\`\`
Many votes, few queries  → sort per query (a)
Many queries, few votes  → maintain ordering (c)
Both high, large n       → (c), and the bucket structure
                           becomes worth its complexity
\`\`\`

**I would implement (a), state the alternative, and say what would change my mind.** That is a stronger answer than an unrequested incremental structure — **and it leaves time to get vote-changing right, which is the part that can be wrong rather than merely slow.**

*The judgment to state out loud:* **one of these candidates can be incorrect and the other can only be slow.** Spend the time on the one that can be wrong.

---

**Part 3 — the 60-minute budget**

\`\`\`
0–7     Requirements. Four clarifying questions, the invariant,
        the scope declaration. Note the votes-to-queries ratio
        question explicitly, since it decides the top-K design.

7–10    Entities and value types:
          Poll      — entity (identity matters)
          OptionId  — value type
          UserId    — value type
          A vote is NOT an entity: it is an entry in a
          per-poll map from UserId to OptionId

10–17   Responsibilities:
          "Recording and changing a vote needs the user's
           current choice and the counts — both per poll,
           so the Poll owns both."
          "Top-K needs the counts, so it is also the Poll's."
          "Nothing needs a VoteService."
        → one entity with two internal structures, and the
          reason they are together: a vote change mutates
          both, and splitting them would let them diverge.

17–22   Signatures, with results rather than booleans:
          vote(user, option): VoteResult
            { ok: true, changedFrom?: OptionId }
            | { ok: false, reason: 'unknown-option' }
          topK(k: number): Standing[]
          counts(): ReadonlyMap<OptionId, number>
        No interfaces: the prompt names no varying axis.
        (If asked for pluggable tie-breaking, that is one.)

22–45   CORE LOGIC — the big block.
          · the per-poll user→option map and count map
          · vote() including the change path
          · the same-option re-vote as an explicit no-op
          · topK with a stated tie-break
          · unknown option handled as a result, not a throw

45–53   Tests, four of them (Part 4).

53–57   Trade-offs: the top-K alternatives and the ratio that
        selects them; concurrency — one lock per poll, because
        polls are independent, which is the useful granularity
        observation here; tie-breaking as a possible seam.

57–60   Five-question audit, and name what I left out.
\`\`\`

**Twenty-three minutes on core logic and eight on tests** — a little over half the round on the two things being assessed. **And the per-poll lock granularity is the concurrency answer worth having ready**, because polls being independent is a property of the problem rather than a general claim.

---

**Part 4 — the four tests, from the invariant**

\`\`\`
1. Sum equals distinct voters
     3 users vote for different options
     → assert sum of counts === 3

2. Changing a vote does not change the total
     user votes A, then votes B
     → assert count(A) === 0, count(B) === 1,
       and sum === 1
     ← THE discriminating test: a naive implementation
       that only increments leaves sum === 2

3. Re-voting for the same option is a no-op
     user votes A, then votes A again
     → assert count(A) === 1 and sum === 1
     ← breaks implementations that decrement-then-
       increment without checking

4. Top-K respects counts and breaks ties consistently
     A:3 B:3 C:1, k=2
     → assert the same two options in the same order
       across repeated calls
     ← an unstable tie-break shows up here and nowhere else
\`\`\`

**Test 2 is the one that earns its place.** It is derived from the sum clause of the invariant, and **it fails for the most natural wrong implementation** — the one that treats a change as a new vote.

**Test 4 is the one most candidates omit**, and tie-breaking is exactly what an interviewer probes after top-K works: *"what if two options have the same count?"* **Having the test means the answer is already decided.**

---

**Which requirement will most candidates underestimate?**

**"A user may change their vote" — and it is underestimated because it reads as a feature rather than as a constraint on the data model.**

**A vote-once system needs only counts.** Increment a number per option; that is the whole design.

**A vote-changing system needs to know each user's current choice**, which means a per-poll map from user to option — **and that map is the reason the invariant has a sum clause at all.**

\`\`\`
Counts only:              vote() is one increment
Counts + user→choice:     vote() is a three-step state
                          transition with a no-op case
\`\`\`

**And it cascades into three other places.**

**Memory**, which becomes proportional to voters rather than to options — a genuine scaling difference nobody mentions when the requirement is skimmed.

**Top-K maintenance**, because a change moves two counts rather than one, so any incremental ordering structure needs two updates per operation.

**And concurrency**, since a change is a multi-step mutation — **two concurrent changes by the same user could interleave and break the sum clause**, which the single-vote design could never do.

*Which is why I put it in the invariant at minute five.* **Stating "the sum of counts equals the number of distinct voters" forces the data model that supports changing**, before any code depends on the simpler one.

---

**What if the interviewer asks for persistence at minute 50?**

**Answer the design, do not start the implementation — and say why.**

> *"I can describe it in a minute rather than writing it, if that works. The vote map and count map per poll are the state, so a store interface would be load(pollId) and save(poll). The interesting part is that a vote change is three mutations, so a save must be atomic with respect to them — I would persist the whole poll aggregate rather than individual counts, which avoids the partial-write problem entirely.*
>
> *If you would rather see it written, I will — but I would be trading it against the tie-break test and the concurrency discussion, and I think those show more."*

**Three things that response does.**

**It demonstrates the design without spending the time**, and the aggregate-write observation is the substantive part — **it shows why persistence interacts with the invariant** rather than treating storage as plumbing.

**It names the trade explicitly and hands the choice back.** The interviewer may want persistence more than the tie-break test, **and they are the one who knows** — offering the trade is better than silently choosing.

**And it references the scope declaration from minute five.** Persistence was named as out of scope then, **so this is a consistent position rather than a refusal** — which is precisely what the declaration was for.

*What I would not do:* start writing a repository at minute 50. **Ten minutes of storage code would leave the core work untested and the concurrency question unanswered**, which is trading the two things being assessed for the one that was already agreed to be out of scope.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lf-1',
      level: 'basic',
      question: 'How do you structure a machine-coding round?',
      guidance:
        'Look for a time budget with core logic as the largest block, and for the scope declaration. A candidate who lists eight steps without weights has memorised the sequence rather than the allocation.',
    },
    {
      id: 'iq-lf-2',
      level: 'basic',
      question: 'What would you implement first, and why?',
      guidance:
        'The hard path — the method where the invariant is enforced. Strong answers name the specific distinguishing edge case in it.',
    },
    {
      id: 'iq-lf-3',
      level: 'intermediate',
      question: 'State the invariant for this problem.',
      guidance:
        'Must be precise enough to yield a test. "Evicts old entries" is not; a concrete sequence with an assertion is.',
    },
    {
      id: 'iq-lf-4',
      level: 'intermediate',
      question: 'Which tests would you write?',
      guidance:
        'Derived from the invariant, with one mixed-sequence test that a wrong implementation fails. Per-method tests are the weaker answer.',
    },
    {
      id: 'iq-lf-5',
      level: 'advanced',
      question: 'You are halfway through and behind. What do you drop?',
      guidance:
        'The diagram and the extra tests, never the core logic. Excellent answers reference the scope declaration made at the start.',
    },
    {
      id: 'iq-lf-6',
      level: 'advanced',
      question: 'How would you make this thread-safe?',
      guidance:
        'One lock at a stated granularity, with the reason. Look for noticing that a read-like operation mutates state — the LRU get case — and for per-unit locking when units are independent.',
    },
    {
      id: 'iq-lf-7',
      level: 'followup',
      question: 'Can you add feature X? We have ten minutes left.',
      guidance:
        'Describe the design, name the trade against what is already written, and hand the choice back. Starting to implement it silently is the weaker move.',
    },
    {
      id: 'iq-lf-8',
      level: 'followup',
      question: 'Why did you not abstract the storage layer?',
      guidance:
        'Because no axis was named, with the trigger stated — a second store, or a test that needs substitution. Look for consistency with the scope declaration.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lf-1',
      kind: 'explain-yourself',
      prompt:
        'At minute 40 of 45, your core logic works and passes three tests, but you have no class diagram and two of your classes are doing more than one thing. The interviewer says: "This is quite monolithic — would you not split this up?" Answer it.',
      discussion: `The question has two readings, and **which one it is determines the answer — so the first move is to check.**

**Reading one: a genuine design critique.** They think the class is a god object and want to see you recognise it.

**Reading two: a test of whether you will abandon a working design under pressure.** They know the class is cohesive and are checking whether you can defend it.

**And the clue is which class they mean**, so ask: *"Which part in particular — the cache itself, or the poll?"* **A clarifying question here is not stalling; it is the difference between conceding something you should not and defending something you should not.**

**If the class is genuinely doing several things — concede, and price it.**

> *"You are right about the poll class — it owns the vote map, the counts and the top-K query, and the top-K part changes for a different reason from the voting rules. If I were continuing I would extract a Standings object holding the counts and the ordering, leaving the poll with the voting state. I did not do it in the time because the three-mutation vote path was the part that could be incorrect, and I wanted it tested before restructuring."*

**That answer does the three things this situation needs.** It agrees with a specific criticism rather than generally. **It names the split and the reason to change that justifies it**, so the concession is reasoned rather than compliant. And it explains the sequencing decision — **correctness before structure** — which is a defensible engineering priority rather than an excuse.

**If the class is cohesive — defend it, with the invariant.**

> *"I would keep the cache as one class deliberately. The key map and the recency list have to be updated in the same operation, so if they lived in separate objects an incorrect call order could leave them inconsistent — the invariant would be enforceable only by convention. I would rather have one slightly larger class that cannot be used wrongly than two smaller ones that can.*
>
> *If the eviction policy needs to vary, I would add a seam for choosing the victim while keeping the list operations inside — that gets the flexibility without splitting the invariant."*

**The invariant argument is what makes this a defence rather than a refusal.** "It is cohesive" is an assertion; **"these two structures can be left inconsistent by an incorrect call order" is a mechanism**, and a mechanism is arguable.

**And the second paragraph matters as much as the first**, because it shows you are not defending monolithic design in general — **you have a specific place where you would accept a split, on a specific condition.** That converts a disagreement into a shared position.

**What to avoid, both directions.**

**Immediately splitting the class.** At minute 40 with working code, a restructure risks breaking what passes and leaves nothing finished. **And if the class was cohesive, you have made the design worse to please the room.**

**"There was not time."** Even when true, it frames a design decision as a resource failure. **The decision to keep it together was either right or wrong on the merits**, and the time argument only applies to the sequencing.

**And an unqualified defence.** "No, this is fine" with no mechanism and no condition under which you would change reads as inflexibility — **which is the trait the question is most likely probing for.**

**The general shape worth internalising:** when challenged on structure, **ask which part, then answer with a mechanism.** Concede where you can name a distinct reason to change; defend where you can name an invariant that a split would put at risk. **Both answers are strong, and the weak answers are the ones that do neither** — the reflexive split and the reflexive defence.`,
    },
    {
      id: 'al-lf-2',
      kind: 'what-changes-if',
      prompt:
        'Change the format: instead of 45 minutes live, this is a take-home with 4 hours and a repository to submit. Which parts of the framework survive, which invert, and what new failure mode appears?',
      discussion: `**The framework's shape is driven by scarcity, so relaxing the constraint changes the allocation substantially — and creates a new way to fail that the live format cannot produce.**

**What survives, and survives more strongly.**

**The invariant step.** Still the thing that determines the data structures and yields the tests. **With four hours the invariant should be written down in the repository**, as a comment or a paragraph in the readme — it becomes a deliverable rather than a spoken framing.

**Behaviour-first responsibility assignment.** Unchanged. **The reader of a repository judges it the same way an interviewer does: by asking where a new requirement would land.**

**And the audit pass**, which gets better rather than worse — **four hours is enough to act on what the five questions find**, whereas live you can only acknowledge it.

**What inverts.**

**The 85% you were allowed to stub is now expected.** A repository with stubbed persistence and no wiring reads as incomplete, because **the format's implicit contract is a working program.** So the CRUD-shaped code must now be included — and it is still not what distinguishes the submission, which is the trap.

**The diagram becomes worth more, not less.** Live, a diagram competes with implementation time. **In a repository a short structural note in the readme is the cheapest way to make the design legible** — and the reviewer may spend five minutes on your code, so orienting them is high-leverage.

**Tests go from four to a real suite.** Live, four invariant tests are a strong showing. **In a take-home, four tests read as thin** — the expectation is coverage of edge cases, error paths and at least one concurrency test if the problem has any.

**And the scope declaration moves into the readme as a "what I did not do" section** — which is the same device serving the same purpose: **making omissions read as decisions.** This is the single highest-value paragraph in a take-home submission, and most candidates omit it.

**The new failure mode: unbounded scope.**

Live, the clock stops you. **A take-home has no forcing function, so the characteristic failure is not running out of time — it is spending four hours building something larger than was asked for.**

\`\`\`
The prompt:     "a rate limiter with a pluggable algorithm"
The submission: three algorithms, a Redis backend, a
                metrics layer, a CLI, a Docker file,
                and 48 files
→ the reviewer cannot find the rate limiter
\`\`\`

**And it is judged worse than a small correct submission**, for two reasons. **A reviewer spending fifteen minutes will not read 48 files**, so the good parts go unseen. And **speculative breadth is the over-application failure from the SOLID lesson**, now with four hours of evidence for it.

*The defence is to re-impose a budget artificially:* **decide at the start what the submission contains, write it in the readme, and stop.** Four hours of available time does not mean four hours of scope — **and a submission that says "I stopped here deliberately, and here is what I would do next" demonstrates judgment that a sprawling one cannot.**

**A second new failure mode: polish substituting for substance.** Formatting, linting, a CI configuration and a thorough readme are cheap to produce and easy to mistake for quality. **They are worth having and none of them is what is being assessed** — the core logic and the responsibility assignment still are.

**The revised allocation for four hours.**

\`\`\`
0:00–0:20   Requirements, invariant, and a written scope
            decision. Commit the readme skeleton first.
0:20–0:40   Responsibilities and signatures.
0:40–2:20   Core logic AND the scaffolding that makes it
            runnable. The hard path still first.
2:20–3:10   Tests: invariant tests, then edge cases,
            then one concurrency test if applicable.
3:10–3:30   The audit pass, and act on what it finds.
3:30–4:00   Readme: the invariant, the structure in five
            lines, what was left out and why, and what
            the next step would be.
\`\`\`

**Core logic plus its scaffolding is still the largest block**, and the readme gets a real slot rather than being written in the last five minutes.

**The transferable point:** the framework is a response to scarcity, so **when the scarce resource changes, re-derive the allocation rather than transplanting it.** Live, time is scarce and the deliverable is a demonstration. **In a take-home, the reviewer's attention is scarce and the deliverable is an artefact** — which is why the readme's "what I did not do" section matters more there than the spoken version does live, and why unbounded scope is the failure that replaces running out of time.`,
    },
  ],

  revision: {
    bullets: [
      'Machine-coding rounds are lost to scaffolding, not to the hard part.',
      'The determining decision is made at minute five: which fifteen percent of the code you will write.',
      'Persistence, wiring, getters, parsing and main are the eighty-five percent you may stub.',
      'State the invariant before coding — it shows you know the problem, picks the structures, and yields the tests.',
      'Say the scope declaration out loud so a priority mismatch surfaces at minute five, not minute forty.',
      'Budget: requirements 5–8, responsibilities 6–8, core logic 15–20, tests 5–7, trade-offs 3–4.',
      'Core logic must be the largest single block; if the diagram is bigger, the round is lost.',
      'Distinguish entities from value types — comparing entities by value produces bugs that look like logic errors.',
      'Assign behaviours to owners out loud, because the assignment is what is graded.',
      'If two objects can violate an invariant by being called in the wrong order, they are one responsibility.',
      'Interfaces only at named axes; five in a 45-minute problem means requirements were skipped.',
      'Return a result carrying the reason, not a boolean, for any decision a caller must explain.',
      'Inject the clock: a test that sleeps is a test nobody runs.',
      'Write the hard path first, so time runs out on the easy part.',
      'Handle the distinguishing edge case — updating an existing key, a hold expiring mid-payment.',
      'Derive tests from the invariant; the mixed-sequence test is the one a wrong implementation fails.',
      'An invariant you cannot write a test for is one you have not stated precisely.',
      'When time slips: core logic, one test, the declaration, spoken trade-offs, more tests, the diagram.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'An eight-step framework for machine-coding rounds, weighted as a time budget: requirements and a scope declaration, entities, responsibilities, signatures, a quick sketch, the core logic, invariant-derived tests, and trade-offs with a short audit.',
    whyItExists:
      'Because these rounds are decided by which code gets written, not by how much design gets described — and the default behaviour is to spend the front of the round on diagrams and scaffolding and then describe the hard method instead of implementing it.',
    whenToUse: [
      'Any timed implementation round, live or take-home.',
      'The scope declaration whenever you will stub anything.',
      'An explicit invariant whenever the problem has a capacity, an ordering or an expiry.',
      'An injected clock whenever behaviour depends on time.',
      'The five-question audit in the last three minutes.',
    ],
    whenNotToUse: [
      'Starting with a class diagram.',
      'Implementing breadth — every class, shallowly.',
      'Writing constructors, getters and wiring before the hard method.',
      'Interfaces on axes the prompt never named.',
      'Reading a global clock in expiry logic.',
      'Tests derived from the method list.',
      'Transplanting the live budget into a take-home unchanged.',
    ],
    alternatives: [
      'Strict test-first, when there is enough time — invariant-as-comment then tests immediately after is the budget-fitting adaptation.',
      'A written scope decision in a readme, for take-home formats.',
      'Sorting per query instead of maintaining an ordering, when the query-to-write ratio favours it.',
      'Per-unit locking instead of one global lock, when the units are genuinely independent.',
      'A seam that chooses a victim while list operations stay inside, when a policy must vary without splitting an invariant.',
    ],
    tradeoffs: [
      'Requirements time buys the right target and costs a fifth of the round.',
      'A spoken scope declaration buys agreement on priorities and costs a minute.',
      'A three-minute sketch buys legibility and costs a possible second pass later.',
      'Implementing the hard fifteen percent buys a pass and costs an apparently partial design.',
      'An injected clock buys testable expiry and costs one parameter.',
      'Result types buy the rule staying in one place and cost a few lines.',
      'Invariant-derived tests buy discrimination and require a precise invariant.',
    ],
    failureModes: [
      'A complete class diagram and no code at minute twenty.',
      'Fifteen minutes of constructors and getters.',
      'Invented classes — statistics, factories — nobody asked for.',
      'The hard method described rather than written.',
      'A data structure chosen before the invariant, then found inadequate.',
      'An invariant split across two objects that must move together.',
      'A global clock making expiry logic untestable.',
      'Booleans that force the caller to re-derive a decision.',
      'Per-method tests that a wrong implementation passes.',
      'A read-write lock on a cache whose get mutates recency order.',
      'Unbounded scope in a take-home, so the reviewer cannot find the core.',
    ],
    followUpQuestions: [
      'Which fifteen percent am I going to write?',
      'What exactly is the invariant, and does a test follow from it?',
      'Have I said out loud what I am stubbing?',
      'Which method is the problem, and am I writing it first?',
      'What is the distinguishing edge case here?',
      'Can these two objects be called in an order that breaks the invariant?',
      'Which sentence in the prompt justifies this interface?',
      'Does this signature need the clock passed in?',
      'Does this boolean discard a reason the caller needs?',
      'Is the hard method written yet? (At the halfway point.)',
      'What am I deliberately leaving out, and what would trigger adding it?',
    ],
  },
});
