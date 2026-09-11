import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-patterns',
  title: 'The five patterns that actually appear',
  summary:
    'A pattern is a name for a shape you would have reached anyway, so its value is communication rather than structure. What is worth memorising is the trigger phrase in a prompt, the minimal implementation, the pattern it gets confused with, and when the answer is "none".',
  phase: 'lld',
  module: 'oo-foundations',
  position: 60,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 55,
  tags: ['strategy', 'state', 'observer', 'command', 'no-pattern'],
  prerequisites: ['l-uml'],
  resources: [
    {
      key: 'refactoring-guru-patterns',
      tier: 'must',
      note: 'Read strategy, state, observer, factory method and command, and skip the rest for now. Read the "problem" section of each rather than the structure diagram — the problem is what tells you when to reach for it.',
    },
    {
      key: 'gof-patterns-ref',
      tier: 'must',
      note: 'Read the introduction and the strategy and state entries. The introduction\'s framing — patterns as names for recurring solutions — is what licenses saying "no pattern needed here" without sounding evasive.',
    },
    {
      key: 'xstate-statecharts',
      tier: 'good',
      note: 'Read it for guarded transitions. It is the strongest argument for the enum-plus-transition-table form of state over one class per state: the legal transitions become a single readable artefact.',
    },
    {
      key: 'refactoring-guru-solid',
      tier: 'good',
      note: 'Re-read the open-closed section alongside strategy. Almost every legitimate use of strategy in an interview is a seam the requirement named, which is why the two topics answer each other.',
    },
    {
      key: 'martin-fowler-event-sourcing',
      tier: 'advanced',
      note: 'Read it for commands as persisted, replayable events. It is the connection between the command pattern in a machine-coding round and the log-is-the-truth designs from the HLD phase — the same idea at two scales.',
    },
  ],

  intuition: {
    body: `A pattern is **a name for a shape you would have arrived at anyway** if you assigned responsibilities carefully. That is not a criticism — **the name is the value.** Saying "this is a strategy" transmits a structure, its trade-offs and its extension points in three words, and the interviewer recognises all of it before you finish the sentence.

**Which means the wrong way to use patterns is to start from the catalogue.** "Which pattern applies here?" produces a design built around a shape rather than around the problem, and **the tell is an interface with one implementation** — the shape is present and the property is absent.

**The right way is to recognise the trigger.** A prompt names its patterns, usually in one phrase:

\`\`\`
"different pricing rules"          → strategy
"configurable eviction policy"     → strategy
"behaviour depends on its state"   → state
"notify when the score changes"    → observer
"support undo"                     → command
"a queue of operations"            → command
"create the right type from input" → a map, not a factory class
\`\`\`

**Five patterns cover almost every machine-coding round**, and the most useful thing to memorise is not their structure but **the phrase that summons each one, and the pattern each is confused with.**

**Strategy and state are the confusable pair**, and the distinction is one question: **who changes it?** A strategy is chosen by the caller and does not change itself. **A state changes itself in response to events** — which is why a state has a transition table and a strategy does not.

Then the answer that scores highest and is offered least: **"no pattern needed here."**

\`\`\`
"Which pattern for selecting the exporter by format?"
  → a map from string to exporter. Three lines.
  → A factory class is the same three lines behind
    an interface nobody will implement twice.
\`\`\`

**Saying that, with the condition under which you would change your mind, demonstrates judgment more clearly than naming a pattern does.** Because everyone can name patterns, and **the scarce signal is declining one.**

**And two patterns are worth knowing in order to avoid.** Singleton is a global variable with extra steps, and it makes tests share state. **Abstract factory is machinery for a problem that does not appear in a 45-minute round.**

**The framing to carry: patterns are vocabulary, not architecture.** Design from behaviour, then name what you built — **and if it has no name, that is not a problem to fix.**`,
    analogyLimit:
      'Treating the catalogue as a menu is the trap: it turns "how should this behave?" into "which of these 23 shapes fits?", and a shape chosen before the problem is understood is a commitment with no evidence behind it. The subtler error is believing the structure is the pattern. What a pattern actually gives you is a shared name, so a design you would have reached anyway becomes communicable in three words — and a design that has no name is not worse for lacking one.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate designing a vending machine says: "I will use the state pattern with classes for Idle, HasMoney, Dispensing and OutOfStock; a factory to create them; a singleton for the inventory; and the observer pattern so the display updates." Which of these four is right, which are wrong, and what would you build instead?',
      answer: `**One is right in spirit and wrong in form, one is right, and two are wrong.**

**State — right to reach for, probably wrong as four classes.**

The trigger is genuine: **behaviour does depend on which state the machine is in** — inserting a coin means different things in \`Idle\` and \`Dispensing\`. So state is the correct diagnosis.

**But four state classes is usually the wrong form in a 45-minute round**, for a specific reason:

\`\`\`
Four classes, each implementing insertCoin, selectItem,
dispense, refund
  → 16 methods, most of which are "illegal in this state"
  → and the LEGAL TRANSITIONS are scattered across four
    files, so no single place answers "what can happen
    from HasMoney?"
\`\`\`

**An enum plus a transition table puts the legal transitions in one readable artefact:**

\`\`\`ts
type State = 'idle' | 'has_money' | 'dispensing' | 'out_of_stock';

const LEGAL: Record<State, Partial<Record<Event, State>>> = {
  idle:         { insert_coin: 'has_money' },
  has_money:    { select_item: 'dispensing', refund: 'idle' },
  dispensing:   { complete: 'idle', jam: 'out_of_stock' },
  out_of_stock: { restock: 'idle', refund: 'idle' },
};
\`\`\`

**Every illegal transition is expressed by absence**, which is the property the state-diagram lesson identified as the valuable one. **Four classes cannot show absence** — they show it as a method that throws, scattered sixteen ways.

*When state classes do earn their place:* **when per-state behaviour is substantial** — many lines of distinct logic per state rather than a transition plus a guard. **Then the classes carry real code and the table would be a switch over it.**

**Observer — right, and it is the one worth keeping.**

"The display updates when the machine's state changes" is the trigger, and **a list of callbacks is the whole implementation.** Worth naming three traps, because that is what distinguishes a strong answer:

\`\`\`
· synchronous notification makes the operation cost the
  sum of its listeners
· an exception in one listener must not abort the others
  or the state change
· unsubscription — a listener that outlives its subject
  is a leak
\`\`\`

**Factory — wrong, and it is the most common unearned pattern.**

Creating state objects by name is a map from a string to a constructor. **A factory class puts an interface in front of three lines** — and with the transition table above, **there is nothing to create at all.**

**Singleton — wrong, and this is the one to reject firmly.**

\`\`\`
A singleton inventory means:
  · every test shares one inventory, so tests interfere
    and order matters
  · the dependency is invisible in every signature that
    uses it
  · two machines in one process cannot have separate stock
\`\`\`

**The last point is the substantive one:** singleton encodes "there is exactly one of these in the universe", which is **a claim about deployment, not about the domain** — and it is false as soon as anyone writes a second test.

*The fix is trivial:* pass the inventory in. **Constructor injection gives you the same single instance in production and independent instances in tests**, which is strictly better with no cost.

**What I would build.**

\`\`\`
VendingMachine
  · state: State                     (an enum)
  · transition(event): Result        (consults LEGAL, guards)
  · inventory: Inventory             (injected, not global)
  · listeners: Listener[]            (observer, with the
                                      three traps handled)
\`\`\`

**One class, one table, one injected collaborator, one callback list.** And the sentence to go with it: **"this is a state machine and an observer; I am not using a factory because creation is a lookup, and not a singleton because a shared global would make the tests interfere."**

**The scoring difference is in that last clause.** Naming two patterns is common; **declining two, with reasons, is the part that demonstrates judgment.**`,
    },
  body: `## The trigger table

**The highest-value thing on this page.** Prompts name their patterns, and learning the phrase is faster than learning the structure.

| Phrase in the prompt | Pattern | Minimal form |
| --- | --- | --- |
| "different pricing rules", "configurable policy", "pluggable algorithm" | Strategy | An interface passed in |
| "behaviour depends on its state", "once booked it cannot…" | State | An enum plus a transition table |
| "notify", "subscribe", "the display should update" | Observer | A list of callbacks |
| "support undo", "a queue of operations", "replay", "audit trail" | Command | An object with \`execute\` and \`undo\` |
| "create the right type from a string" | **None** | A map from key to constructor |
| "there is only one" | **None** | Pass it in |
| "add behaviour without changing the original" | Decorator | A wrapper implementing the same interface |

**Two rows say "none", and those are the rows that distinguish candidates.**

## Strategy: the one the requirement names

**Trigger:** the prompt says an algorithm or policy varies.

\`\`\`ts
interface PricingPolicy { fee(t: Ticket): Money }

class HourlyPricing  implements PricingPolicy { /* ... */ }
class WeekendPricing implements PricingPolicy { /* ... */ }

class ParkingLot {
  constructor(private readonly pricing: PricingPolicy) {}
}
\`\`\`

**Three things to say when you use it.**

**Which sentence in the prompt justifies it.** "You said pricing is configurable" — **that is what separates strategy from a speculative interface.**

**What the second implementation is.** If you cannot name it, the seam is unearned.

**And that the strategy is stateless, or that its state is per-call.** A strategy holding mutable state across calls is a shared-mutable-state problem wearing a pattern's name.

*The over-application:* one interface per collaborator. **Five strategies in a 45-minute problem means the prompt named one axis and you invented four.**

## State: the pattern with two legitimate forms

**Trigger:** which operations are legal depends on what has already happened.

**And the form is a real decision, not a stylistic one.**

\`\`\`
Enum + transition table
  · all legal transitions in ONE artefact
  · illegal transitions expressed by absence
  · guards read as data
  → prefer this when transitions are the logic

One class per state
  · each state's behaviour is a real block of code
  · transitions scattered across the classes
  → prefer this when per-state BEHAVIOUR is substantial
\`\`\`

**For most interview problems the table wins**, because the interesting content is *which transitions exist* rather than what happens during each. **A booking, a hold, a vending machine and a document lifecycle are all transition-heavy and behaviour-light.**

\`\`\`ts
transition(event: Event, now: Instant): Result {
  const next = LEGAL[this.state]?.[event];
  if (!next) return { ok: false, reason: 'illegal-transition',
                      from: this.state, event };
  if (!this.guardPasses(event, now))
    return { ok: false, reason: 'guard-failed', ... };
  this.state = next;
  this.log.push({ from, event, to: next, at: now });
  return { ok: true, state: next };
}
\`\`\`

**Three properties worth pointing at.** The illegal case returns a result with a reason rather than throwing. **The transition log makes the history auditable** — the same idea as the document-editing lesson at a smaller scale. And guards are separate from legality, **because "not allowed from this state" and "not allowed yet" are different answers.**

## Strategy versus state: one question

**They have the same shape and opposite semantics**, which is why the confusion is universal.

\`\`\`
                 STRATEGY                STATE
Who sets it?     the caller, at          the object itself,
                 construction            in response to events
Does it change?  rarely, and from        constantly, and from
                 outside                 inside
Transitions?     none — there is no      the central artefact
                 notion of "next"
Example          PricingPolicy           SeatState
\`\`\`

**The question to ask: does the object change this itself?** If yes, it is state. **If the caller chooses it and it stays chosen, it is strategy.**

**And a design can have both.** A booking has a state machine *and* a pluggable pricing policy — **they are orthogonal, and noticing that is a better answer than picking one.**

## Observer: easy to draw, easy to get wrong

**Trigger:** something must react when something else changes.

\`\`\`ts
type Listener = (e: StateChanged) => void;

private listeners: Listener[] = [];
subscribe(l: Listener): () => void {
  this.listeners.push(l);
  return () => { /* unsubscribe */ };   // ← return the remover
}
\`\`\`

**Four traps, and naming them is what makes an answer interview-grade.**

**Synchronous notification makes the operation cost the sum of its listeners.** A state change with five slow listeners is five times slower, and **the caller is paying for work it did not request.** *Fix:* dispatch asynchronously, or bound what a listener may do.

**An exception in one listener must not abort the others or the state change.** *Fix:* wrap each dispatch; a broken listener is not a failed transition.

**Ordering dependence is a bug that hides.** If listener B only works because A ran first, **the design has an undeclared dependency** — and it breaks when subscription order changes.

**And unsubscription is the leak.** A listener holding a reference to a subject that outlives it keeps it alive. *Fix:* **return the unsubscribe function from \`subscribe\`**, which makes removal impossible to forget.

*The returning-a-remover detail is worth volunteering unprompted*, because it is a small thing that shows you have used the pattern rather than read about it.

## Command: the one people forget

**Trigger:** undo, replay, a queue of operations, an audit trail, or scheduling work for later.

\`\`\`ts
interface Command {
  execute(): void;
  undo(): void;
}

class AddItem implements Command {
  constructor(private cart: Cart, private sku: Sku) {}
  execute() { this.cart.add(this.sku); }
  undo()    { this.cart.remove(this.sku); }
}
\`\`\`

**And the reason it is worth knowing: it makes undo almost free**, which is a requirement that otherwise looks expensive.

\`\`\`
A stack of executed commands
  → undo = pop and call undo()
  → redo = a second stack
  → audit = the same stack, persisted
  → replay = execute the list from the start
\`\`\`

**Four requirements served by one structure**, which is unusually good value — **and it is the same idea as the append-only log from the collaborative-editing design**, where the commands are text operations and the stack is the document's history.

**Two things to get right.**

**\`undo\` must be the inverse, including the case where the command partly failed.** A command that added three items and failed on the fourth must undo three — **so a command holding compound work needs to record what it actually did.**

**And a command should capture its arguments at construction**, not read them at execution. Otherwise **undo operates on different data than execute did**, which is the subtle bug in this pattern.

## Factory: usually a map

**Trigger:** the concrete type depends on an input value.

**And the honest answer is almost always three lines:**

\`\`\`ts
const exporters: Record<string, Exporter> = {
  pdf: new PdfExporter(),
  csv: new CsvExporter(),
};
const exporter = exporters[format] ?? throwUnknown(format);
\`\`\`

**A factory class is those three lines behind an interface nobody will implement twice.** *When a factory earns its place:* when creation itself is non-trivial — **several parameters to assemble, validation, or a dependency the caller should not have to know about.** Then a function or a static method named for the intent (\`Loan.open(...)\`) is the form, not a class hierarchy.

**And abstract factory — a factory of factories — does not appear in a 45-minute round.** Saying so if asked is correct.

## The two to avoid, and one honourable mention

**Singleton: do not.** It is a global variable with extra steps.

\`\`\`
· tests share one instance, so they interfere and order matters
· the dependency is invisible in every signature
· "exactly one in the universe" is a deployment claim, and it
  is false the moment a second test exists
\`\`\`

**Pass it in.** Constructor injection gives one instance in production and independent instances in tests, **at no cost** — which makes this the easiest pattern refusal to defend.

**Template method: prefer strategy.** It achieves variation through inheritance, so it couples you to the base class's implementation and commits you to one axis. **Strategy does the same job with composition.**

**Decorator: worth knowing, genuinely useful.** A wrapper implementing the same interface, adding behaviour around it:

\`\`\`ts
class GracePeriodFinePolicy implements FinePolicy {
  constructor(private inner: FinePolicy, private cal: Calendar) {}
  fine(overdue: Days, cap: Money): Money { /* wraps inner */ }
}
\`\`\`

**It is the right answer when a new rule *wraps* an existing one rather than replacing it** — waiving fines during a closure, adding logging, adding a cache. **And it composes**, so three wrappers are three independent additions.

## How to say "no pattern needed"

**The strongest form has three parts: what you are doing instead, why, and what would change your mind.**

> *"For selecting the exporter I would use a map from format to exporter rather than a factory — it is three lines, and a factory class would put an interface in front of them that nobody will implement twice. If creation needed several parameters assembled or validated, I would add a named constructor for it."*

**Three reasons this scores well.**

**It answers the question.** Declining a pattern is an answer, not an evasion, and **the alternative being concrete is what makes it one.**

**It shows you know the pattern**, since you named what it would have cost.

**And the trigger condition proves the decision was reasoned** rather than reflexive — which is the same structure as declining an abstraction in the SOLID lesson, because it is the same judgment.

*The reverse mistake is over-correcting:* refusing patterns on principle. **When the prompt says "configurable pricing", strategy is correct and naming it is efficient** — the point is that the requirement chose it, not that patterns are suspect.

## What to say out loud

**Name what you built, after you built it.** "This ended up as a strategy" is confident; "let me apply the strategy pattern" is starting from the catalogue.

**Name the confusable neighbour.** "This is state rather than strategy, because the object changes it in response to events" — **which pre-empts the question and shows the distinction is understood.**

**Volunteer the traps.** For observer, the unsubscribe function and the exception isolation. For command, capturing arguments at construction. **These are the details that separate having used a pattern from having read about it.**

**And decline at least one, with a condition.** In a design of this size there is almost always a pattern you could add and should not — **saying which, and what would make you add it, is the clearest available signal of judgment.**`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'trigger-routing',
      title: 'From the phrase in the prompt to the shape',
      caption:
        'Read it as routing, not as a menu. Two branches end in "none", and those are the two that distinguish a candidate — because everyone can name a pattern and few decline one.',
      code: `flowchart TB
    P["**What does the prompt<br/>actually say?**"]

    P -->|"'different pricing rules'<br/>'configurable policy'"| S["**Strategy**<br/>an interface passed in"]
    P -->|"'behaviour depends on<br/>its state'"| ST["**State**<br/>enum + transition table"]
    P -->|"'notify when…'<br/>'the display updates'"| O["**Observer**<br/>a list of callbacks"]
    P -->|"'support undo'<br/>'replay' · 'audit'"| C["**Command**<br/>execute + undo"]
    P -->|"'create the right type<br/>from a string'"| N1["**None.**<br/>A map from key<br/>to constructor"]
    P -->|"'there is only one'"| N2["**None.**<br/>Pass it in —<br/>a singleton makes<br/>tests interfere"]

    S --> Q["**Strategy or state?<br/>One question:<br/>does the object change<br/>it itself?**<br/>Caller sets it → strategy<br/>Object sets it → state"]
    ST --> Q

    O --> OT["**Traps to volunteer:**<br/>listener cost is summed ·<br/>isolate exceptions ·<br/>ordering dependence ·<br/>return the unsubscribe fn"]
    C --> CT["**Traps to volunteer:**<br/>capture args at construction ·<br/>undo what you actually did ·<br/>the stack gives undo, redo,<br/>audit and replay at once"]

    style N1 fill:#17272a,stroke:#35897e
    style N2 fill:#17272a,stroke:#35897e
    style Q fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'state-forms',
      title: 'State: two legitimate forms, and how to choose',
      caption:
        'Step through it. The choice is not stylistic — it depends on whether the interesting content is which transitions exist or what happens during each.',
      nodes: [
        { id: 'trigger', label: 'Trigger: legal operations depend on history', kind: 'note', x: 0, y: 130, detail: '"Once booked it cannot be held", "a refund is only possible before dispatch". The tell is a sentence in the prompt constraining what may happen when — which is a transition, not a value.' },
        { id: 'table', label: 'Enum + transition table', kind: 'store', x: 250, y: 40, detail: 'All legal transitions in one readable artefact, and illegal ones expressed by absence — the property the state-diagram lesson identified as the valuable one. Guards read as data, and the transition log makes history auditable.' },
        { id: 'classes', label: 'One class per state', kind: 'store', x: 250, y: 220, detail: 'Each state gets a class implementing every operation, so transitions scatter across the classes and illegal ones become methods that throw. Sixteen methods for four states, most of them refusals.' },
        { id: 'choose', label: 'Choose on where the content is', kind: 'note', x: 520, y: 130, detail: 'Transition-heavy and behaviour-light — bookings, holds, vending machines, document lifecycles — favours the table. Substantial distinct logic per state favours classes, because then the classes carry real code and a table would just be a switch over it.' },
        { id: 'result', label: 'Return a result, not a throw', kind: 'service', x: 780, y: 40, detail: 'An illegal transition returns { ok: false, reason: "illegal-transition", from, event } so the caller can explain it. And keep "not allowed from this state" separate from "not allowed yet" — legality and guards are different answers.' },
        { id: 'both', label: 'And a design can have both patterns', kind: 'note', x: 780, y: 210, detail: 'A booking has a state machine and a pluggable pricing policy. They are orthogonal, and noticing that is a better answer than choosing between strategy and state.' },
      ],
      edges: [
        { id: 'p1', source: 'trigger', target: 'table', kind: 'control' },
        { id: 'p2', source: 'trigger', target: 'classes', kind: 'control' },
        { id: 'p3', source: 'table', target: 'choose', kind: 'control' },
        { id: 'p4', source: 'classes', target: 'choose', kind: 'control' },
        { id: 'p5', source: 'choose', target: 'result', kind: 'control' },
        { id: 'p6', source: 'choose', target: 'both', kind: 'control' },
      ],
      steps: [
        {
          id: 'pt1',
          title: 'The trigger is a sentence about when, not what',
          description:
            '"Once booked it cannot be held" constrains which operations are legal given history. That is a transition, and it is what distinguishes state from a value or a strategy.',
          nodes: ['trigger'],
          edges: [],
        },
        {
          id: 'pt2',
          title: 'Two forms, and absence is the difference',
          description:
            'A table shows illegal transitions by omitting them — one artefact answering "what can happen from here". Four classes show the same thing as sixteen methods, most of them refusals scattered across files.',
          nodes: ['table', 'classes'],
          edges: ['p1', 'p2'],
        },
        {
          id: 'pt3',
          title: 'Choose by where the content lives',
          description:
            'Most interview problems are transition-heavy and behaviour-light, so the table wins. When each state carries a real block of logic, the classes earn their place.',
          nodes: ['choose'],
          edges: ['p3', 'p4'],
        },
        {
          id: 'pt4',
          title: 'Refuse with a reason, and separate guards from legality',
          description:
            '"Illegal from this state" and "not allowed yet" are different answers, and a caller needs to know which. Returning a result rather than throwing keeps the rule in one place.',
          nodes: ['result'],
          edges: ['p5'],
        },
        {
          id: 'pt5',
          title: 'Then notice the patterns are orthogonal',
          description:
            'A state machine plus a pluggable policy is one design with two patterns in it. Treating strategy and state as alternatives is the confusion the whole section exists to remove.',
          nodes: ['both'],
          edges: ['p6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The most useful thing in the original patterns catalogue is a claim in its introduction rather than anything in the entries.

**Patterns are presented as names for recurring solutions, with the explicit purpose of giving designers a shared vocabulary.** Communication is stated as the benefit — **not that the structures are optimal, and not that a design should be assembled from them.**

**Which is precisely what licenses "no pattern needed here."** If the value of a pattern is that it names something, **a shape with no name in the catalogue is not thereby worse** — it is just something you have to describe in a sentence instead of in a word.

**And the catalogue's own structure supports the trigger-first approach.** Each entry begins with intent and a problem statement before its structure diagram, **so the intended reading order is problem then shape** — the opposite of picking a shape and looking for somewhere to apply it.

**Three things to take from it.**

**Read the problem sections, not the diagrams.** The problem is what lets you recognise a situation; **the diagram is what lets you draw it once you have.** Candidates who memorise diagrams can name patterns and cannot place them.

**The vocabulary is the deliverable.** "This is a decorator" transmits structure, extension points and composability in three words — **and saving forty seconds of explanation several times in a round is real.**

**And two patterns in the catalogue are artefacts of their era.** Singleton codifies a global, and the factory hierarchies exist partly because the languages of the time lacked first-class functions. **In a language with closures and records, several catalogue entries reduce to a function** — which is worth saying out loud when asked about them.

**Where the reference does not help.** It says almost nothing about *when not to* apply a pattern, and nothing about the cost of a speculative one. **The modern judgment — an interface with one implementation is unearned — has to come from elsewhere**, which is why this lesson sits after the SOLID one rather than before it.`,
  },

  tradeoffs: {
    intro:
      'Each pattern, the situation that earns it, and what it costs when reached for too early.',
    rows: [
      {
        option: 'Starting from the catalogue — "which pattern applies?"',
        whenItWins:
          'Nowhere. It feels like expertise.',
        whenItLoses:
          'A shape chosen before the problem is understood is a commitment with no evidence, and the tell is an interface with one implementation.',
        cost:
          'A design built around a shape rather than the problem.',
      },
      {
        option: 'Recognising the trigger phrase, then naming what you built',
        whenItWins:
          'Always. Prompts name their patterns, and the phrase is faster to learn than the structure.',
        whenItLoses:
          'A problem whose shape has no catalogue name, which must then be described in a sentence.',
        cost:
          'Nothing; describing it is fine.',
      },
      {
        option: 'Strategy',
        whenItWins:
          'When the requirement says an algorithm or policy varies, and you can name the second implementation.',
        whenItLoses:
          'With one implementation and no stated variation, it is a copy of a signature.',
        cost:
          'An interface and a wiring step per seam.',
      },
      {
        option: 'State as one class per state',
        whenItWins:
          'When per-state behaviour is a substantial block of distinct logic.',
        whenItLoses:
          'Transition-heavy problems: sixteen methods for four states, most of them refusals, with legal transitions scattered across files.',
        cost:
          'No single artefact answers "what can happen from here".',
      },
      {
        option: 'State as an enum plus a transition table',
        whenItWins:
          'Most interview problems — bookings, holds, machines, lifecycles are transition-heavy and behaviour-light.',
        whenItLoses:
          'When each state\'s behaviour is large, the table degenerates into a switch over real logic.',
        cost:
          'A table to maintain, and guards kept separate from legality.',
      },
      {
        option: 'Observer, synchronous',
        whenItWins:
          'Few fast listeners where the caller can absorb their cost.',
        whenItLoses:
          'The operation costs the sum of its listeners, and the caller pays for work it did not request.',
        cost:
          'Latency proportional to subscriber count.',
      },
      {
        option: 'Observer with isolation and an unsubscribe function',
        whenItWins:
          'Always. A broken listener is not a failed transition, and returning the remover makes removal hard to forget.',
        whenItLoses:
          'Asynchronous dispatch introduces ordering questions of its own.',
        cost:
          'A little machinery per dispatch.',
      },
      {
        option: 'Command',
        whenItWins:
          'Undo, redo, replay, audit or scheduling — one structure serves all four, which is unusually good value.',
        whenItLoses:
          'When nothing needs reversing; then it is an object wrapping a method call.',
        cost:
          'A class per operation, and the discipline of capturing arguments at construction.',
      },
      {
        option: 'A factory class',
        whenItWins:
          'Rarely. When creation itself is non-trivial — assembly, validation, a hidden dependency — and then a named constructor is usually the form.',
        whenItLoses:
          'Selecting by key is three lines; a factory puts an interface in front of them.',
        cost:
          'Indirection with no second implementation to justify it.',
      },
      {
        option: 'A map from key to instance',
        whenItWins:
          'Almost always, for type-from-input selection.',
        whenItLoses:
          'When construction needs per-call arguments, which a prebuilt map cannot supply.',
        cost:
          'Three lines.',
      },
      {
        option: 'Singleton',
        whenItWins:
          'Nowhere in a testable design.',
        whenItLoses:
          'Tests share one instance and interfere, the dependency is invisible in every signature, and "exactly one in the universe" is false as soon as a second test exists.',
        cost:
          'Test isolation, which is the thing you most need in a machine-coding round.',
      },
      {
        option: 'Constructor injection instead',
        whenItWins:
          'Always. One instance in production, independent instances in tests.',
        whenItLoses:
          'One extra parameter.',
        cost:
          'Nothing meaningful.',
      },
      {
        option: 'Template method',
        whenItWins:
          'Rarely — a fixed algorithm with one varying step and a closed set of variants.',
        whenItLoses:
          'It varies behaviour through inheritance, so it couples to the base implementation and commits to one axis.',
        cost:
          'A hierarchy where composition would have done.',
      },
      {
        option: 'Decorator',
        whenItWins:
          'When a new rule wraps an existing one rather than replacing it — waiving fines in a grace period, adding caching or logging.',
        whenItLoses:
          'Deep stacks of wrappers become hard to reason about and to debug.',
        cost:
          'An extra layer per behaviour, and a composition order that matters.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Let me think about which design patterns apply to this problem."',
      whyWeak:
        'It starts from the catalogue, so the design is assembled around shapes rather than derived from behaviour. The reliable symptom is an interface with one implementation — the structure is present and the property it exists for is absent.',
      strongAnswer:
        '"Let me work out the responsibilities first, then name what I end up with. The prompt says pricing is configurable, so that will come out as a strategy, and it says a seat cannot be held once booked, so there is a state machine. I will name them as I build them rather than choosing them first — and there are two places here where I think the answer is no pattern at all."',
    },
    {
      weakAnswer: '"I will use the state pattern with a class for each state — Idle, HasMoney, Dispensing, OutOfStock."',
      whyWeak:
        'For a transition-heavy problem it produces sixteen methods across four classes, most of which exist only to refuse, and no single place answers "what can happen from HasMoney?". The legal transitions — the actual content — end up scattered.',
      strongAnswer:
        '"State is the right diagnosis, but I would use an enum plus a transition table rather than four classes, because the interesting content here is which transitions exist rather than what happens during each. The table puts every legal transition in one artefact and expresses illegal ones by absence. I would switch to state classes if per-state behaviour were substantial — many lines of distinct logic per state rather than a transition plus a guard."',
    },
    {
      weakAnswer: '"The inventory is a singleton so every part of the system sees the same stock."',
      whyWeak:
        'It is a global variable with extra steps. Every test shares one instance so tests interfere and order matters, the dependency is invisible in every signature that uses it, and "exactly one in the universe" is a claim about deployment that is false the moment a second test exists.',
      strongAnswer:
        '"I would pass the inventory in through the constructor. That gives one shared instance in production — the wiring site creates it once — and independent instances in tests, which is strictly better at the cost of one parameter. The dependency also becomes visible in the signature, so a reader can see what this class touches."',
    },
    {
      weakAnswer: '"Observers are notified when the state changes." (No further detail.)',
      whyWeak:
        'The pattern is easy to name and easy to get wrong, and the answer omits everything that distinguishes having used it from having read about it — cost, failure isolation, ordering and unsubscription.',
      strongAnswer:
        '"A list of callbacks, with four things handled. Notification is dispatched so the state change does not cost the sum of its listeners. Each listener is wrapped, because an exception in one must not abort the others or roll back the transition. I do not let behaviour depend on subscription order, since that is an undeclared dependency. And subscribe returns an unsubscribe function, so removal is hard to forget — a listener outliving its subject is a leak."',
    },
    {
      weakAnswer: '"I will add an ExporterFactory with a create method that returns the right exporter for the format."',
      whyWeak:
        'Selecting an implementation by key is a three-line map. A factory class puts an interface in front of those three lines that nobody will implement a second time, and hides a lookup behind two indirections.',
      strongAnswer:
        '"A map from format to exporter — three lines, and an unknown format returns a result rather than throwing. A factory would earn its place if creation were non-trivial: several parameters to assemble, validation, or a dependency the caller should not know about. Then I would use a named constructor for the intent rather than a factory class. And abstract factory does not appear in a problem this size."',
    },
    {
      weakAnswer: '"Undo would be quite involved — I would need to snapshot the state before each operation."',
      whyWeak:
        'Snapshotting is expensive and grows with the state size, and it misses that one structure serves undo, redo, audit and replay simultaneously.',
      strongAnswer:
        '"A command object with execute and undo, and a stack of executed commands. Undo is pop-and-call; redo is a second stack; persisting the stack gives an audit trail; and replaying it from the start reconstructs the state — four requirements from one structure. Two details: a command captures its arguments at construction rather than reading them at execution, otherwise undo operates on different data than execute did. And a command that did compound work must record what it actually did, so a partial failure undoes exactly the part that succeeded."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lp-1',
      front: 'What is a pattern actually for?',
      back: 'Communication. It is a name for a shape you would have reached anyway, so a design becomes transmissible in three words.',
      topic: 'no-pattern',
    },
    {
      id: 'fc-lp-2',
      front: 'Why is starting from the catalogue wrong?',
      back: 'A shape chosen before the problem is understood is a commitment with no evidence, and the tell is an interface with one implementation.',
      topic: 'no-pattern',
    },
    {
      id: 'fc-lp-3',
      front: 'Which phrases summon strategy?',
      back: '"Different pricing rules", "configurable policy", "pluggable algorithm" — an axis of variation named in the prompt.',
      topic: 'strategy',
    },
    {
      id: 'fc-lp-4',
      front: 'What single question separates strategy from state?',
      back: 'Does the object change it itself? Caller-chosen and stable is strategy; self-changing in response to events is state.',
      topic: 'state',
    },
    {
      id: 'fc-lp-5',
      front: 'Can a design have both strategy and state?',
      back: 'Yes, and noticing they are orthogonal is a better answer than choosing — a booking has a state machine and a pluggable pricing policy.',
      topic: 'state',
    },
    {
      id: 'fc-lp-6',
      front: 'When does the enum-plus-table form of state beat state classes?',
      back: 'When the problem is transition-heavy and behaviour-light — most interview problems. The table shows illegal transitions by absence.',
      topic: 'state',
    },
    {
      id: 'fc-lp-7',
      front: 'When do state classes earn their place?',
      back: 'When per-state behaviour is a substantial block of distinct logic, so the classes carry real code rather than refusals.',
      topic: 'state',
    },
    {
      id: 'fc-lp-8',
      front: 'Name the four observer traps.',
      back: 'Synchronous cost summing across listeners; an exception aborting the others; ordering dependence; and leaks from missing unsubscription.',
      topic: 'observer',
    },
    {
      id: 'fc-lp-9',
      front: 'What small observer detail shows you have used the pattern?',
      back: 'Returning the unsubscribe function from subscribe, so removal is hard to forget.',
      topic: 'observer',
    },
    {
      id: 'fc-lp-10',
      front: 'What four requirements does a command stack serve at once?',
      back: 'Undo (pop and call), redo (a second stack), audit (persist it) and replay (execute from the start).',
      topic: 'command',
    },
    {
      id: 'fc-lp-11',
      front: 'What is the subtle command bug?',
      back: 'Reading arguments at execution rather than capturing them at construction, so undo operates on different data than execute did.',
      topic: 'command',
    },
    {
      id: 'fc-lp-12',
      front: 'What is a factory usually, honestly?',
      back: 'A map from key to instance — three lines. A factory class earns its place only when creation itself is non-trivial, and then a named constructor is the form.',
      topic: 'no-pattern',
    },
    {
      id: 'fc-lp-13',
      front: 'Why refuse singleton specifically?',
      back: 'Tests share one instance and interfere, the dependency is invisible in signatures, and "exactly one in the universe" is a deployment claim. Constructor injection costs one parameter.',
      topic: 'no-pattern',
    },
    {
      id: 'fc-lp-14',
      front: 'What are the three parts of a good "no pattern needed" answer?',
      back: 'What you are doing instead, why, and what would change your mind.',
      topic: 'no-pattern',
    },
  ],

  quiz: [
    {
      id: 'q-lp-1',
      kind: 'scenario',
      prompt:
        'A vending machine\'s legal operations depend on whether money has been inserted. Which form of the state pattern fits best?',
      options: [
        { id: 'a', label: 'An enum plus a transition table, because the content is which transitions exist rather than what happens during each' },
        { id: 'b', label: 'One class per state, each implementing every operation' },
        { id: 'c', label: 'A boolean hasMoney flag with conditionals at each call site' },
        { id: 'd', label: 'A strategy interface chosen by the caller' },
      ],
      correct: ['a'],
      explanation:
        'Transition-heavy and behaviour-light favours the table, and illegal transitions are then expressed by absence in one readable artefact. Option b scatters the legal transitions across four files as sixteen methods, most of them refusals. Option d is the strategy-versus-state confusion: nothing here is chosen by the caller.',
      difficulty: 'core',
      topic: 'state',
    },
    {
      id: 'q-lp-2',
      kind: 'scenario',
      prompt:
        'Which question distinguishes strategy from state?',
      options: [
        { id: 'a', label: 'Does the object change it itself in response to events, or does the caller choose it?' },
        { id: 'b', label: 'Is there more than one implementation?' },
        { id: 'c', label: 'Is the interface method called more than once?' },
        { id: 'd', label: 'Is the behaviour stateful?' },
      ],
      correct: ['a'],
      explanation:
        'The two have the same shape and opposite semantics, which is why they are universally confused. Ownership of the change is the discriminator — a strategy has no notion of "next", whereas transitions are a state machine\'s central artefact. Implementation count is the earned-seam test, which is a different question.',
      difficulty: 'core',
      topic: 'strategy',
    },
    {
      id: 'q-lp-3',
      kind: 'scenario',
      prompt:
        'You add observers so a display updates when a machine\'s state changes. What must you handle?',
      options: [
        { id: 'a', label: 'Listener cost summing into the operation, exception isolation, ordering independence, and unsubscription' },
        { id: 'b', label: 'Only that listeners are called in subscription order' },
        { id: 'c', label: 'Only thread safety of the listener list' },
        { id: 'd', label: 'Nothing — a list of callbacks is complete' },
      ],
      correct: ['a'],
      explanation:
        'All four, and they are what separate having used the pattern from having read about it. Option b is the opposite of correct: depending on subscription order is an undeclared dependency that breaks when order changes. And returning the unsubscribe function from subscribe is the detail worth volunteering.',
      difficulty: 'advanced',
      topic: 'observer',
    },
    {
      id: 'q-lp-4',
      kind: 'scenario',
      prompt:
        'The requirement is "support undo". What does a command stack give you beyond undo?',
      options: [
        { id: 'a', label: 'Redo via a second stack, an audit trail by persisting it, and replay by executing from the start' },
        { id: 'b', label: 'Thread safety for the operations' },
        { id: 'c', label: 'Validation of each operation before execution' },
        { id: 'd', label: 'Nothing else — undo is its only use' },
      ],
      correct: ['a'],
      explanation:
        'Four requirements from one structure, which is why command is worth knowing even though it is the pattern people forget — and it is the same idea as the append-only operation log in the collaborative-editing design, at a smaller scale.',
      difficulty: 'core',
      topic: 'command',
    },
    {
      id: 'q-lp-5',
      kind: 'scenario',
      prompt:
        'An interviewer asks which pattern you would use to select an exporter from a format string. What is the strongest answer?',
      options: [
        { id: 'a', label: '"None — a map from format to exporter. A factory would add an interface nobody implements twice. I would use a named constructor if creation needed assembly or validation."' },
        { id: 'b', label: '"A factory, since the concrete type depends on input"' },
        { id: 'c', label: '"An abstract factory, so families of exporters can be swapped"' },
        { id: 'd', label: '"A strategy, since exporters vary"' },
      ],
      correct: ['a'],
      explanation:
        'Declining a pattern with a concrete alternative and a trigger condition is an answer rather than an evasion, and it is the scarcer signal — everyone can name a pattern. Note the exporters themselves genuinely are a strategy; the question was about selecting one, which is a lookup.',
      difficulty: 'advanced',
      topic: 'no-pattern',
    },
    {
      id: 'q-lp-6',
      kind: 'multi',
      prompt:
        'Why refuse a singleton for a vending machine\'s inventory? Select all that apply.',
      options: [
        { id: 'a', label: 'Tests share one instance, so they interfere and order matters' },
        { id: 'b', label: 'The dependency is invisible in every signature that uses it' },
        { id: 'c', label: '"Exactly one in the universe" is a deployment claim, false as soon as a second test exists' },
        { id: 'd', label: 'Singletons cannot be made thread-safe' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the case against it, and the fix — constructor injection — costs one parameter while giving one instance in production and independent ones in tests. Option d is false: they can be made thread-safe, which is beside the point.',
      difficulty: 'core',
      topic: 'no-pattern',
    },
  ],

  exercises: [
    {
      id: 'ex-lp-1',
      kind: 'design',
      title: 'Route five requirements, and refuse two patterns',
      estimatedMinutes: 40,
      prompt: `A prompt for a 60-minute round:

*"Design a task scheduler. Tasks have priorities. The scheduling policy should be configurable — priority order now, fair round-robin later. A task moves through queued, running, completed or failed; a failed task may be retried up to three times. Other components need to react when a task completes. Support cancelling a queued task, and show a history of what ran. Tasks are created from a JSON description with a type field."*

**Part 1.** For each of the five requirement clusters, name the pattern (or "none") and the minimal form. Quote the phrase that triggered it.

**Part 2.** Two of your answers should be "none". Write the sentence you would say for each, in the three-part form.

**Part 3.** One requirement is a strategy-versus-state trap. Identify it and resolve it.

**Part 4.** Sketch the class structure. Count the interfaces and justify each.

Then answer:

- Which requirement is the one candidates will over-engineer, and what will they reach for?
- The retry limit interacts with the state machine. Where does the count live, and why not on the state?`,
      rubric: [
        'All five clusters routed with the triggering phrase quoted.',
        'Scheduling policy correctly identified as strategy with a named second implementation.',
        'Task lifecycle correctly identified as state, with the transition-table form preferred.',
        'Completion notification identified as observer, with at least two traps named.',
        'History identified as command or an event log, with the reasoning.',
        'Two "none" answers given in the three-part form.',
        'The strategy-versus-state trap identified and resolved with the ownership question.',
        'Interface count is three or fewer, each justified by a quoted phrase.',
        'Explains where the retry count lives and why not in the state value.',
      ],
      modelAnswer: `**Part 1 — routing the five clusters**

**1. Scheduling policy → strategy.**

*Trigger:* **"the scheduling policy should be configurable — priority order now, fair round-robin later"** — the axis is named and the second implementation is named with it, which is as earned as a seam gets.

\`\`\`ts
interface SchedulingPolicy {
  next(queued: readonly Task[]): Task | undefined;
}
class PriorityPolicy   implements SchedulingPolicy { }
class RoundRobinPolicy implements SchedulingPolicy { }
\`\`\`

*Note the signature:* **the policy selects from a collection rather than maintaining its own queue.** If it held the queue, two policies would need two queue implementations and swapping them would lose queued tasks — **so the scheduler owns the queue and the policy only chooses.**

**2. Task lifecycle → state, as an enum plus a transition table.**

*Trigger:* **"a task moves through queued, running, completed or failed"** plus the retry rule.

\`\`\`ts
type TaskState = 'queued' | 'running' | 'completed' | 'failed'
               | 'cancelled';

const LEGAL: Record<TaskState, Partial<Record<Event, TaskState>>> = {
  queued:    { start: 'running', cancel: 'cancelled' },
  running:   { succeed: 'completed', fail: 'failed' },
  failed:    { retry: 'queued' },          // guarded by attempts
  completed: {},
  cancelled: {},
};
\`\`\`

**Transition-heavy, behaviour-light**, so the table rather than five classes. **And the absences carry the rules:** no \`running → cancelled\` (you cannot cancel a running task — the prompt says *queued*), no \`completed → anything\`, no \`cancelled → queued\`.

**3. Reacting to completion → observer.**

*Trigger:* **"other components need to react when a task completes."**

\`\`\`ts
subscribe(l: (e: TaskCompleted) => void): () => void
\`\`\`

*Two traps to name:* **dispatch must not make task completion cost the sum of its listeners** — a scheduler's throughput would then depend on unrelated subscribers — **and an exception in a listener must not mark the task failed.** That second one is specific and severe here: **a broken listener causing a retry would be a genuinely confusing bug.**

**4. History of what ran → a command or event log, and there is a choice to make.**

*Trigger:* **"show a history of what ran."**

\`\`\`
Option A — the transition log the state machine already keeps:
  { taskId, from, event, to, at }
  → history for free, since the machine records transitions

Option B — command objects with execute/undo
  → only worth it if we need undo or replay
\`\`\`

**The prompt asks for history, not undo**, so **option A** — and I would say so explicitly: *"the transition log gives me history at no extra cost; I would introduce command objects if you wanted to replay or undo a schedule."* **Command is the right pattern for undo and replay; it is over-machinery for a read-only history.**

**5. Creating tasks from JSON with a type field → none. A map.**

*Trigger:* **"tasks are created from a JSON description with a type field."** Part 2 covers the sentence.

---

**Part 2 — the two refusals**

**Refusal 1: no factory for task creation.**

> *"For creating tasks from the type field I would use a map from type string to a construction function, and return a result for an unknown type rather than throwing. It is a few lines, and a factory class would put an interface in front of them that nobody is going to implement a second time. If construction became non-trivial — validating the JSON shape per type, or injecting dependencies a caller should not know about — I would add a named constructor per type, \`EmailTask.fromJson\`, rather than a factory hierarchy."*

**The three parts: the map instead, the reason, and the trigger.**

**Refusal 2: no singleton for the scheduler.**

> *"I would not make the scheduler a singleton even though there is one in production. The wiring site constructs it once, which gives the same result, and it means tests can have independent schedulers — with a singleton every test shares queue state, so they interfere and order starts mattering. It also keeps the dependency visible in the signatures of anything that uses it."*

*And a third refusal I would volunteer if there is time:* **no command pattern for cancellation.** Cancel is a transition in the state machine — **\`queued → cancelled\`** — and wrapping it in a command object adds a class for a table entry. **Command earns its place when you need to undo; cancelling is not undoing.**

---

**Part 3 — the strategy-versus-state trap**

**The trap is the retry behaviour**, and it is genuinely ambiguous on first reading.

\`\`\`
Reading A (state):     retry is a transition, failed → queued,
                       guarded by attempts < 3
Reading B (strategy):  "retry policy" is configurable —
                       exponential backoff, immediate,
                       fixed delay
\`\`\`

**Applying the ownership question resolves it: does the object change this itself?**

**The *transition* is state.** The task moves from failed back to queued in response to an event — **nobody outside chooses that**, so it belongs in the table with a guard.

**The *delay before retrying* would be strategy** — if the prompt asked for it. **It does not.** The prompt says "may be retried up to three times", which is a count and a rule, **not a configurable policy.**

**So: state now, and a strategy seam only if asked.**

> *"Retry is a guarded transition rather than a policy — the task moves itself. If you wanted configurable backoff, that would be a second strategy alongside the scheduling one, and I would add it then."*

**And the general form of the resolution is worth stating:** the same word — "retry", "pricing", "routing" — **can name a transition or a policy, and the ownership question is what tells you which.** A candidate who hears "retry" and reaches for a \`RetryPolicy\` interface has answered a question nobody asked, **while leaving the transition and its guard unspecified.**

---

**Part 4 — the structure, and the interface count**

\`\`\`
┌────────────────────────────────────────────┐
│ Scheduler                                  │
│  queued: Task[]                             │
│  policy: SchedulingPolicy        ← 1 seam   │
│  listeners: Listener[]                      │
│  tick(now): void                            │
│  submit(task): Result                       │
│  cancel(taskId): Result                     │
│  subscribe(l): () => void                   │
└──────────────┬─────────────────────────────┘
               │ owns
┌──────────────▼─────────────────────────────┐
│ Task                                       │
│  id, type, priority, attempts               │
│  state: TaskState                           │
│  transitions: Transition[]   ← history      │
│  apply(event, now): Result                  │
└────────────────────────────────────────────┘

interface SchedulingPolicy { next(queued): Task | undefined }
                                              ← the ONLY interface

const TASK_BUILDERS: Record<string, (json) => Result<Task>> = { }
                                              ← a map, not a factory
type Listener = (e: TaskCompleted) => void
                                              ← a function type,
                                                not an interface
\`\`\`

**One interface. Justified by one quoted phrase: "the scheduling policy should be configurable — priority order now, fair round-robin later."**

**And three things deliberately not interfaces.**

**\`Listener\` is a function type.** A one-method interface is a function with extra ceremony, **and a function composes better** — a listener can be a closure over whatever it needs.

**Task construction is a record of functions**, per refusal 1.

**And there is no \`TaskStore\` or \`Queue\` interface.** One in-memory queue, no stated variation. *Trigger for adding one:* **persistence across restarts**, which the prompt does not mention.

*One structural decision worth defending:* **\`Task.apply(event, now)\` puts the transition on the task rather than in the scheduler.** The task owns its state, its attempts and its transition log — **all three are needed to decide a transition, so the decision belongs with them.** A scheduler that reached in and set \`task.state\` would be the behaviour-on-the-wrong-object smell.

---

**Which requirement will candidates over-engineer?**

**The task lifecycle — and they will reach for one class per state.**

\`\`\`
QueuedTask · RunningTask · CompletedTask · FailedTask
  · each implementing start(), cancel(), succeed(), fail(),
    retry()
  · 5 states × 5 operations = 25 methods
  · ~19 of them exist only to refuse
  · and "what can happen from failed?" requires reading
    five files
\`\`\`

**And there is a second cost specific to this problem: the state objects would need the attempt count**, which lives on the task — **so either the count is passed into every state object, or the state objects hold a back-reference to the task.** Both are worse than a field on the task and a guard in the table.

*Why candidates reach for it:* **"state pattern" is the catalogue entry with that name**, and the prompt says "moves through states". **The catalogue-first habit maps the word to the entry**, and the entry shows classes — so classes it is.

*The diagnostic that avoids it:* **ask whether each state has substantial distinct behaviour or just different legal transitions.** Here it is transitions, so the table wins. **The word "state" in a prompt names the problem, not the implementation.**

*Runner-up for over-engineering:* **an \`IRetryPolicy\`** from the Part 3 trap, and a factory hierarchy for task creation.

---

**Where does the retry count live, and why not in the state?**

**It lives as a field on the task — \`attempts: number\` — and the transition consults it as a guard.**

\`\`\`ts
failed: { retry: 'queued' }        // legality
guard:  attempts < MAX_ATTEMPTS    // eligibility
\`\`\`

**Why not encode it in the state value**, which is the tempting alternative:

\`\`\`
failed_1 · failed_2 · failed_3     ← states multiply with the limit
\`\`\`

**Three reasons that is wrong.**

**The state space multiplies with a number.** A three-retry limit gives three failed states; **a ten-retry limit gives ten**, and the transition table grows with a configuration value rather than with the domain. **The set of states should be a property of the domain, not of a parameter.**

**It conflates legality with eligibility**, which the lesson's state section separates deliberately. *"You cannot retry a completed task"* is illegality — **a missing transition.** *"You cannot retry this failed task again"* is a guard failure — **the transition exists and a condition blocks it.** And the caller needs to know which:

\`\`\`
{ ok: false, reason: 'illegal-transition' }  → a bug in the caller
{ ok: false, reason: 'retry-limit-reached' } → expected, report it
\`\`\`

**And the count is data the history needs anyway.** The transition log already records each failure, **so the count is derivable from it** — meaning the field is a cached derivation of the log rather than independent state. *Which suggests a refinement:* **compute attempts from the transition log** rather than maintaining a counter, so **the two cannot disagree.** For a small log that is the cleaner design, and it is the same "derive rather than duplicate" move as summing ledger entries for a balance.

**The general principle: a counter that bounds a transition is a guard, not a state.** States name qualitatively different situations; **guards carry the quantities** — and pushing a quantity into the state name is how a five-state machine becomes a fifteen-state one for no gain.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lp-1',
      level: 'basic',
      question: 'Which design patterns would you use here?',
      guidance:
        'Look for triggers quoted from the prompt rather than a catalogue tour — and for at least one "none" with an alternative. Starting from the catalogue is the weaker move.',
    },
    {
      id: 'iq-lp-2',
      level: 'basic',
      question: 'How would you model the lifecycle?',
      guidance:
        'State, and for most problems an enum plus a transition table rather than one class per state. Strong answers say which form and why.',
    },
    {
      id: 'iq-lp-3',
      level: 'intermediate',
      question: 'Is that strategy or state?',
      guidance:
        'The ownership question: does the object change it itself? Excellent answers note the two can coexist orthogonally in one design.',
    },
    {
      id: 'iq-lp-4',
      level: 'intermediate',
      question: 'Add notifications when a task completes.',
      guidance:
        'A callback list, with cost, exception isolation, ordering and unsubscription addressed. Returning the remover from subscribe is the detail to volunteer.',
    },
    {
      id: 'iq-lp-5',
      level: 'advanced',
      question: 'Now support undo.',
      guidance:
        'Command objects plus a stack, giving redo, audit and replay as well. Look for capturing arguments at construction and for undoing exactly what partially succeeded.',
    },
    {
      id: 'iq-lp-6',
      level: 'advanced',
      question: 'Would you make this a singleton?',
      guidance:
        'No, with the test-isolation and invisible-dependency arguments, and constructor injection as the alternative at a cost of one parameter.',
    },
    {
      id: 'iq-lp-7',
      level: 'followup',
      question: 'Why not use a factory for creating these?',
      guidance:
        'Because selecting by key is a map. Look for the trigger that would change it — non-trivial construction — and for a named constructor rather than a factory class.',
    },
    {
      id: 'iq-lp-8',
      level: 'followup',
      question: 'The retry limit is three. Should there be three failed states?',
      guidance:
        'No — a counter that bounds a transition is a guard, not a state. Otherwise the state space grows with a configuration value, and legality gets conflated with eligibility.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lp-1',
      kind: 'what-changes-if',
      prompt:
        'Change the language: the implementation is in a language with first-class functions, closures, records and pattern matching, and no requirement to use classes. Which of the five patterns survive as patterns, and which dissolve into language features?',
      discussion: `**Three dissolve almost entirely, two survive with their substance intact** — and the split tells you something about what a pattern is.

**Strategy dissolves into a function parameter.**

\`\`\`
Classes:   interface SchedulingPolicy { next(queued): Task }
           class PriorityPolicy implements SchedulingPolicy
Functions: type SchedulingPolicy = (queued: Task[]) => Task | undefined
           const priority: SchedulingPolicy = queued => ...
\`\`\`

**The pattern was a workaround for not being able to pass behaviour**, and with closures the interface, the class and the instantiation all disappear. **What survives is the design decision** — that scheduling is a pluggable axis — which was never the pattern's contribution.

*And the earned-seam test survives unchanged:* **a function parameter that only ever receives one function is as speculative as an interface with one implementation**, and more visibly so.

**Factory dissolves completely**, which it half-did already — it was a map, and now it is a record of functions.

**Command mostly dissolves**, and the part that survives is interesting.

\`\`\`
Classes:   class AddItem implements Command { execute(); undo() }
Records:   type Command = { execute: () => void; undo: () => void }
           const addItem = (cart, sku): Command => ({
             execute: () => cart.add(sku),
             undo:    () => cart.remove(sku),
           })
\`\`\`

**The closure captures the arguments at construction**, which is exactly the discipline the pattern required and the language now enforces — **the subtle bug becomes hard to write.** That is a genuine improvement rather than a translation.

*What survives:* **the idea that an operation is a value you can store, stack, persist and replay.** That is the substance, and it is language-independent — **the class was only ever the container.**

**Observer survives, because its difficulty was never structural.**

\`\`\`
type Listener = (e: Event) => void
const listeners: Listener[] = []
\`\`\`

**Three lines, and then all four traps remain**: the cost summing across listeners, exception isolation, ordering independence, and unsubscription. **None of them is about classes** — they are about what happens when one thing notifies many, and **that is a concurrency and lifetime problem** no language feature removes.

*Which is a useful signal:* **patterns whose difficulty survives a language change were describing a real problem.** Observer is one.

**State survives, and gets better.**

Pattern matching on a discriminated union makes the transition table a language construct:

\`\`\`
type TaskState =
  | { tag: 'queued' }
  | { tag: 'running'; startedAt: Instant }
  | { tag: 'failed'; attempts: number; lastError: string }
  | { tag: 'completed'; at: Instant }
\`\`\`

**And this is strictly better than either classical form**, for a reason neither the enum nor the state classes could achieve: **each state carries exactly the data that state has.**

\`\`\`
An enum + fields:  attempts and lastError exist in every
                   state, meaningless in most of them
State classes:     each class can hold its own data, but
                   transitions scatter
Tagged union:      state-specific data AND one transition
                   function with exhaustive matching
\`\`\`

**The compiler then checks that every state is handled**, which is the property the enum-plus-table form approximates by convention. **So the pattern's intent survives and its implementation improves.**

**What this says about patterns generally.**

**A pattern is partly a description of a problem and partly a workaround for a language's limits**, and the two separate cleanly under this test:

\`\`\`
Dissolves entirely   → it was mostly a workaround
                       (strategy, factory, command's container)
Survives intact      → it was describing a real problem
                       (observer, state)
\`\`\`

**Which is why the original catalogue contains entries that read as dated.** Singleton codifies a global; several factory entries exist because behaviour could not be passed as a value. **In a language with closures they are not patterns, they are syntax** — and saying that when asked is correct rather than dismissive.

**And the practical consequence for an interview: describe the design, not the pattern.** *"Scheduling is a function passed in, and I would call it a strategy if you like the name"* **is language-appropriate and pattern-literate at once** — whereas insisting on an interface and a class in a functional language is applying a workaround to a problem that is not there.

*The transferable test:* **ask what the pattern would look like with first-class functions.** If it becomes a parameter, the substance was the decision to make that thing vary. **If it keeps its difficulty, the substance is the problem it names** — and that is worth studying rather than translating.`,
    },
    {
      id: 'al-lp-2',
      kind: 'debug',
      prompt:
        'A task scheduler using the observer pattern has a bug: occasionally a task that completed successfully is retried. Retries are supposed to happen only after a failure. The state machine is correct in isolation and its unit tests pass. Diagnose it.',
      discussion: `**The state machine being correct in isolation and the bug appearing only sometimes points at the interaction between the machine and the notification**, which is exactly where the observer pattern's second trap lives.

**The leading hypothesis: a listener throws, and the exception aborts the completion path.**

\`\`\`
task.apply('succeed')          → state = completed  ✓
notifyListeners(TaskCompleted) → listener 3 throws
                               → exception propagates up
                               → the scheduler's completion
                                 handler catches it and treats
                                 the task as FAILED
                               → apply('fail') → retry
\`\`\`

**And this explains every stated fact.** The machine is correct — it faithfully applied a \`fail\` event it was given. **Its unit tests pass because they never involve a listener.** And it is intermittent **because it depends on a particular listener throwing**, which depends on that listener's own inputs.

*The specific damage:* **a broken listener — possibly owned by another team, doing something unrelated like updating a dashboard — causes work to be re-executed.** For an idempotent task that is waste; **for a non-idempotent one it is a duplicate side effect**, which could mean a second email or a second charge.

*The fix is the trap's fix:* **wrap each dispatch individually.**

\`\`\`ts
for (const l of this.listeners) {
  try { l(event); }
  catch (e) { this.log.warn('listener failed', e); }
}
\`\`\`

**A broken listener is not a failed transition**, and the log line is what turns a silent swallow into a diagnosable one.

**Hypothesis 2 — a listener re-enters the scheduler and mutates the task.** A listener that, on completion, submits a follow-up task or inspects the queue **might touch the completed task itself** — and if anything calls \`apply('fail')\` or re-queues it, the same symptom appears without any exception.

*Why it fits the intermittency:* it depends on the listener's logic and possibly on ordering. *Check:* **whether any listener holds a reference to the task or the scheduler**, and whether notification happens while the scheduler holds internal locks or is mid-iteration over its queue.

*And the design point:* **notifying synchronously from inside a state transition invites re-entrancy.** Dispatching after the transition completes — or asynchronously — removes the whole class of problem, which is the trap's first fix serving a second purpose.

**Hypothesis 3 — the event carries the task, and a listener mutates it.** If \`TaskCompleted\` includes the task object rather than its id and a snapshot, **a listener can change its state field directly.**

*Check:* the event's shape. **An event carrying mutable domain objects is an invitation**, and the fix is to carry ids and immutable snapshots — **which also makes asynchronous dispatch safe**, since a snapshot cannot go stale in a harmful way.

**Hypothesis 4 — the retry guard is checked against a stale attempt count.** If \`attempts\` is cached on the task and something recomputes or resets it, a completed-then-failed task might pass a guard it should not.

*Why it is lower probability:* it would not produce retries of *successful* tasks, only extra retries of failed ones. **The stated symptom is specifically a successful task being retried**, which points at a spurious \`fail\` event rather than at a guard. *Still worth checking* because it is cheap, and because **deriving attempts from the transition log rather than caching it removes the possibility entirely.**

**Hypothesis 5 — two schedulers share task objects.** If a singleton or a shared store means two scheduler instances see the same tasks, **one could mark completed while the other retries.** *Why it fits "occasionally":* it would depend on timing and on whether a second instance exists — a test harness, a warm standby.

*Check:* whether tasks are reachable from more than one scheduler. **This is the singleton argument arriving as a production bug** rather than as a testing inconvenience.

**What I would check first: whether any listener throws, and whether the completion path catches broadly.** Two code reads, and hypothesis 1 explains the full symptom set more economically than anything else — **"the machine is correct and its tests pass" is precisely what you would expect if the machine is being fed a legitimate event by mistake.**

**Then: the notification's position relative to the transition**, and the event's shape. Those cover hypotheses 2 and 3, and both fixes are things you would want anyway.

**Why "the state machine is correct in isolation" is the most useful fact.**

It rules out the component that looks most suspicious. **A machine that applies \`fail\` when told to is behaving correctly** — so the question is not "why did the machine transition wrongly" but **"who sent it a fail event".**

**And that reframing is the whole diagnosis.** The state machine is a mechanism for enforcing legal transitions; **it cannot protect against a legal transition triggered for the wrong reason.** Which is a general limit worth knowing: **a state machine validates the shape of a history, not the truth of the events in it.**

**The instrumentation this demands.**

**Every transition logged with its cause.** Not just from-state, event and to-state, but **what triggered it** — a scheduler decision, a worker report, a retry sweep. **A \`fail\` transition whose cause is "exception during notification" is self-diagnosing**, and this bug would have been a five-minute investigation instead of a puzzle.

**A listener-failure counter, per listener.** It should always be zero, **and a non-zero value is both a bug in that listener and a signal that something downstream may have been affected.**

**And an assertion that no transition occurs during notification.** A re-entrancy guard — a flag set while dispatching — that throws or logs if the machine is asked to transition while notifying. **It converts hypothesis 2 from intermittent to immediate.**

**Transferable:** when a state machine produces an impossible-looking history and the machine itself is correct, **look for who is generating the events** — and look first at anything that runs inside the transition, because notification hooks are the most common place where an unrelated failure is silently converted into a domain event.`,
    },
  ],

  revision: {
    bullets: [
      'A pattern is a name for a shape you would have reached anyway; the name is the value.',
      'Starting from the catalogue produces designs built around shapes, and the tell is one implementation.',
      'Prompts name their patterns — learn the trigger phrase, not the structure.',
      'Strategy: "configurable policy", "pluggable algorithm". An interface passed in.',
      'State: "behaviour depends on its state". An enum plus a transition table.',
      'Observer: "notify", "the display updates". A list of callbacks.',
      'Command: "undo", "replay", "audit". An object with execute and undo.',
      'Strategy versus state: does the object change it itself? Caller-chosen is strategy.',
      'A design can have both, orthogonally — a state machine plus a pluggable policy.',
      'Prefer the enum-plus-table state form when transitions are the content, which is most problems.',
      'State classes earn their place only when per-state behaviour is substantial.',
      'A counter that bounds a transition is a guard, not a state — otherwise states multiply with a config value.',
      'Keep legality separate from eligibility: "illegal from here" and "not allowed yet" are different answers.',
      'Observer traps: summed cost, exception isolation, ordering independence, unsubscription.',
      'Return the unsubscribe function from subscribe — the detail that shows you have used it.',
      'A command stack gives undo, redo, audit and replay from one structure.',
      'A factory is usually a map; a named constructor when creation is non-trivial.',
      'Refuse singleton: tests interfere, dependencies go invisible, and injection costs one parameter.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Five patterns that cover almost every machine-coding round — strategy, state, observer, command, and the map that replaces a factory — organised by the phrase in the prompt that summons each, with the two patterns worth refusing.',
    whyItExists:
      'Because a pattern\'s value is a shared name rather than a structure, so the useful knowledge is recognition and the ability to decline one. Starting from the catalogue produces a design assembled from shapes rather than derived from behaviour.',
    whenToUse: [
      'Strategy when the requirement names a varying policy and you can name the second implementation.',
      'State when legal operations depend on history — as a transition table unless per-state behaviour is large.',
      'Observer when something must react to a change, with all four traps handled.',
      'Command when undo, redo, replay or audit is required.',
      'Decorator when a rule wraps an existing one rather than replacing it.',
      'A map when the concrete type depends on an input key.',
    ],
    whenNotToUse: [
      'Choosing a pattern before understanding the problem.',
      'One class per state for a transition-heavy lifecycle.',
      'A factory class for key-based selection.',
      'Abstract factory in a 45-minute round.',
      'Singleton, in any testable design.',
      'Template method where strategy would do.',
      'Command for an operation nothing will reverse.',
    ],
    alternatives: [
      'A function type instead of a one-method listener interface.',
      'A tagged union with pattern matching instead of either state form, where the language allows.',
      'The state machine\'s transition log instead of command objects, when only history is needed.',
      'Deriving a counter from the transition log instead of caching it.',
      'Constructor injection instead of a singleton.',
      'A named constructor instead of a factory class.',
    ],
    tradeoffs: [
      'Strategy buys extension without modification and costs an interface plus wiring per seam.',
      'A transition table buys one readable artefact and degenerates when per-state logic is large.',
      'State classes buy per-state code and scatter the transitions.',
      'Observer buys decoupling and costs latency, isolation machinery and lifetime management.',
      'Command buys undo, redo, audit and replay and costs a class per operation.',
      'A map buys three lines instead of a hierarchy and cannot supply per-call construction arguments.',
      'Declining a pattern buys credibility and requires a concrete alternative and a trigger.',
    ],
    failureModes: [
      'An interface with one implementation, created because a pattern needed one.',
      'Sixteen methods across four state classes, most of them refusals.',
      'A retry limit encoded as three failed states.',
      'A listener exception aborting a state transition and causing a spurious retry.',
      'A listener holding a reference to a subject that outlives it.',
      'Behaviour depending on subscription order.',
      'A command reading its arguments at execution rather than at construction.',
      'A command that did compound work undoing more or less than it did.',
      'A factory class wrapping a three-line lookup.',
      'A singleton making tests share state and order matter.',
      'A strategy holding mutable state across calls.',
    ],
    followUpQuestions: [
      'Which phrase in the prompt summons this pattern?',
      'What is the second implementation?',
      'Does the object change this itself, or does the caller choose it?',
      'Is the content here which transitions exist, or what happens in each state?',
      'Which transitions am I deliberately omitting?',
      'Is this a guard or a state?',
      'Who pays for the listeners, and what happens when one throws?',
      'Can a subscriber be removed, and does subscribe return the remover?',
      'Does anything need undo, replay or audit?',
      'Is this factory doing anything a map would not?',
      'Which pattern am I declining, and what would make me add it?',
    ],
  },
});
