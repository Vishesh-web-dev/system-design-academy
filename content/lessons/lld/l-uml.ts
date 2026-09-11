import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-uml',
  title: 'UML that actually helps in an interview',
  summary:
    'A diagram is a message to one person in the room, so its only measure is whether they respond to it. Three diagram types earn their place, each answers a different question, and the notation you need is about six symbols.',
  phase: 'lld',
  module: 'oo-foundations',
  position: 59,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 35,
  tags: ['diagrams', 'communication', 'notation', 'state-machines'],
  prerequisites: ['l-lld-framework'],
  resources: [
    {
      key: 'fowler-uml-distilled',
      tier: 'must',
      note: 'Read the opening chapter on UML as sketch, blueprint or programming language. The sketch mode is the only one that applies in an interview, and naming the distinction is what licenses you to leave most of the notation out.',
    },
    {
      key: 'xstate-statecharts',
      tier: 'must',
      note: 'Read it for states, guarded transitions and parallel regions. A state diagram is the one diagram that catches a whole class of bug — an illegal state nobody enumerated — which is why it earns its place for any stateful problem.',
    },
    {
      key: 'refactoring-guru-patterns',
      tier: 'good',
      note: 'Read the diagrams rather than the prose. They are the shared vocabulary: drawing a strategy in its conventional shape lets an interviewer recognise the idea before you have finished explaining it.',
    },
    {
      key: 'gof-patterns-ref',
      tier: 'good',
      note: 'Read it for the conventional structure diagrams. Their value here is as a reference for what a minimal, legible structure sketch looks like — a few boxes and the relationships that matter.',
    },
    {
      key: 'clean-architecture-blog',
      tier: 'advanced',
      note: 'Read it for dependency direction as the thing a structure diagram exists to show. If your diagram\'s arrows do not tell the reader which way dependencies point, it is drawing shapes rather than communicating a decision.',
    },
  ],

  intuition: {
    body: `A diagram in an interview is **a message to one person sitting three feet away**, and the only measure of it is whether they respond. That single reframing settles almost every question about how to draw one.

**It means the notation you need is tiny.** About six symbols carry every structural decision worth making in a 45-minute problem: a box, a line, a filled diamond for ownership, a hollow triangle for "implements", a multiplicity marker, and a label on the line. **Visibility markers, stereotypes, package boundaries and full method signatures carry nothing the reader needs** — they are ceremony, and each one costs seconds you do not have.

**It means you draw only what is non-obvious.** Nobody needs to see that a class has getters. **Everyone needs to see which class owns the recency list**, because that is a decision and it is contestable.

**And it means there is a test for whether the diagram is working: is the interviewer interrupting?**

\`\`\`
They point at a box and ask a question    → the diagram is
                                            working
They are silent while you draw            → you are drawing
                                            for yourself
\`\`\`

**Silence is not approval; it is the absence of communication.** And at minute fifteen, a beautiful diagram with no code is communicating that there is no code.

Then the part most candidates get wrong by omission: **three diagram types answer three different questions, and picking the wrong one wastes the time entirely.**

\`\`\`
"What owns what?"            → a class sketch
"In what order, and who
 calls whom?"                → a sequence diagram
"What states exist, and
 which transitions are
 legal?"                     → a state diagram
\`\`\`

**A class diagram cannot show ordering and a sequence diagram cannot show ownership**, so drawing a class diagram for a question about timing is drawing the wrong thing carefully.

**And the state diagram is the one that earns its place most reliably**, because it is the only one that catches a class of bug: **an illegal state nobody enumerated.** For any problem with a booking, a hold, a lifecycle or an expiry, **it is worth three minutes**, and it usually produces a question you had not considered.

**The last thing: knowing the words matters more than drawing them correctly.** Nobody grades your diamonds. **But saying "this is composition — the cache owns the nodes and they do not outlive it" is a defensible sentence**, and the vocabulary is what makes it sayable.`,
    analogyLimit:
      'Treating UML as a specification language is the trap, and it comes from documentation contexts where completeness is the point. In an interview the diagram is a sketch whose audience is in the room and whose lifetime is ten minutes, so completeness is pure cost. The subtler error is drawing the right diagram type badly — a class diagram cannot express ordering, so a question about who calls whom and when needs a sequence diagram, and no amount of care on the wrong diagram answers it.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate asked to design a cinema seat-booking system spends 12 of 60 minutes drawing a class diagram with nine boxes: `Cinema`, `Screen`, `Show`, `Seat`, `Booking`, `Customer`, `Payment`, `Ticket`, `BookingService`. Every box lists all fields with visibility markers and full method signatures. The interviewer asks two questions during those 12 minutes, both about what happens when two people select the same seat. What went wrong?',
      answer: `**The interviewer asked the same question twice, and the diagram cannot answer it.**

"What happens when two people select the same seat" is a question about **ordering and timing** — who acquires the hold, what the loser sees, when the hold expires. **A class diagram has no vocabulary for any of that.** It shows that \`Booking\` references \`Seat\`; it cannot show that one request wins and another is refused.

**So twelve minutes produced a drawing that is orthogonal to the thing being asked**, and the repeat question is the interviewer saying so as clearly as they politely can.

**Three specific failures.**

**The wrong diagram type.** The right answer to that question is a sequence diagram — two clients, the seat-hold service, and the ordering of the four messages — **or a state diagram for a seat: available, held, booked, with the expiry transition.** Either takes three minutes and answers the question directly.

**Nine boxes when three carry the decision.** \`Cinema\`, \`Screen\`, \`Customer\`, \`Ticket\` and \`Payment\` are context, not design. **The contested decisions are: who owns seat state, where the hold lives, and what expires it** — three boxes and two relationships.

**Full signatures and visibility markers.** Each is seconds of drawing that communicate nothing contestable. **A reader does not dispute that a field is private**; they dispute who owns the hold.

**And the meta-failure: the interviewer's questions were not treated as input.** They asked twice. **The second asking is a signal to stop drawing and answer**, and continuing is the strongest available evidence that the candidate is following a script rather than having a conversation.

**What the twelve minutes should have contained.**

\`\`\`
Minute 1–2   A seat state diagram:
             available → held (holder, expiresAt)
             held → booked        (payment confirmed)
             held → available     (expiry OR release)
             booked → available   (cancellation, if in scope)
             ← and the question "can a held seat be held by
               someone else?" is answered by the absence of
               that transition

Minute 3–5   A sequence for the contested case:
             A: hold(seat) ──▶ Show: conditional claim ──▶ ok
             B: hold(seat) ──▶ Show: conditional claim ──▶ 409
             ← the ordering IS the answer, and it is visible

Minute 6–8   A three-box structure sketch:
             Show ──owns──▶ SeatState (per seat)
             Hold { seatIds, holderId, expiresAt }
             ← plus the note that the hold expiry is stored,
               not a timer

Minute 9–12  Start writing the hold logic.
\`\`\`

**Three diagrams, eight minutes, and each one answers a question that was actually asked.** The state diagram in particular does something the class diagram cannot: **the missing held-to-held transition is a design decision made visible**, and drawing it is how you discover you had not decided it.

**The transferable rule: pick the diagram type from the question, not from habit.** And when the same question is asked twice, **the answer is not more of the current diagram.**`,
    },
  body: `## Three diagrams, three questions

**Each diagram type answers exactly one kind of question, and using the wrong one is the most expensive mistake available** — because the time is spent and the question is still open.

\`\`\`
CLASS SKETCH        "What owns what? Which way do
                     dependencies point?"
                    → structure, ownership, direction

SEQUENCE DIAGRAM    "In what order? Who calls whom?
                     What does the loser see?"
                    → ordering, contention, failure paths

STATE DIAGRAM       "What states exist? Which transitions
                     are legal? What is missing?"
                    → lifecycles, holds, expiry, illegal states
\`\`\`

**And there is a fourth answer: no diagram.** A three-class design with obvious ownership is faster to say than to draw — **"the cache owns a map and a linked list, and they must move together" is complete** and cost eight seconds.

## The class sketch: six symbols

**Everything you need:**

\`\`\`
┌──────────────┐
│ ClassName    │      a box with a name
│ keyField     │      ONE or TWO fields, only if contested
│ keyMethod()  │      the methods that ARE the design
└──────────────┘

A ──────▶ B           A uses B (label the line if the
                      relationship is not obvious)
A ──◆───▶ B           A owns B; B does not outlive A
A ──────▷ I           A implements interface I
A ──1───* B           one A to many B
\`\`\`

**And the list of things to leave out, which is longer:**

\`\`\`
✗  visibility markers (+ − #)
✗  full method signatures with parameter types
✗  getters, setters, constructors
✗  every field
✗  package or namespace boxes
✗  stereotypes and notes-as-boxes
✗  aggregation's hollow diamond — say "holds a reference to"
\`\`\`

**The rule that generates that list: draw what is contestable.** A reader will not argue that a field is private. **They will argue about who owns the recency list, whether the policy should be an interface, and whether the ticket or the rate table computes the fee** — so those are what the diagram must show.

**Which means method names are often more valuable than field names.** \`Spot.accepts(vehicle)\` on a box tells the reader where a decision lives. **\`Spot { id, size, occupied }\` tells them nothing they could not guess.**

*And one arrow convention worth being deliberate about:* **draw the arrow in the direction of the dependency**, so the diagram shows which way change propagates. If every arrow points at your policy objects, **the reader can see that policies are stable and callers depend on them** — which is the dependency-direction argument made visually in two seconds.

## The sequence diagram: for ordering and contention

**Use it when the question involves time, order, or two parties competing.** Those are exactly the questions a class diagram cannot express.

\`\`\`
   Client A        Client B         Show
      │               │              │
      │─hold(s12)────────────────────▶│  conditional claim
      │◀────────────ok(hold_1)────────│
      │               │─hold(s12)────▶│  same claim
      │               │◀──409 taken───│  ← THE ANSWER
      │               │              │
      │  (15 min pass, no payment)   │
      │               │              │──┐ expiry: stored
      │               │              │◀─┘ deadline, not a timer
      │               │─hold(s12)────▶│
      │               │◀───ok(hold_2)─│
\`\`\`

**Four things that make a sequence diagram earn its time.**

**Two clients, not one.** A single-client sequence usually shows nothing a sentence could not — **the contention is the interesting part**, so draw the competitor.

**Label arrows with the message, not the signature.** \`hold(s12)\` and \`409 taken\` communicate; \`public HoldResult hold(SeatId seatId, UserId userId)\` does not.

**Include the failure path.** The loser's arrow is the whole point in a contention question, and **most candidates draw only the happy path** — which is drawing the uninteresting half.

**And show what advances time.** The expiry above is annotated as a stored deadline rather than a timer, **which pre-empts the "what if the process dies" question** by answering it inside the diagram.

*What to leave out:* activation boxes, elaborate \`alt\`/\`loop\` frames, return arrows for every call. **Add a frame only when a loop or an alternative is the thing being discussed.**

## The state diagram: the one that finds bugs

**This is the diagram with the highest return, because it is the only one that catches an illegal state nobody enumerated.**

\`\`\`
      ┌────────────┐  hold   ┌────────┐  pay   ┌────────┐
 ────▶│ available  │────────▶│  held  │───────▶│ booked │
      └────────────┘         └────────┘        └────────┘
            ▲                     │                 │
            │   expiry / release  │                 │
            └─────────────────────┘                 │
            ▲            cancel (if in scope)       │
            └───────────────────────────────────────┘
\`\`\`

**And the value is in the transitions that are absent.**

\`\`\`
held ──hold──▶ held      NOT DRAWN → a held seat cannot be
                          re-held by someone else. That is a
                          decision, and drawing the diagram
                          is how you notice you made it.
booked ──hold──▶ ?        NOT DRAWN → booked seats are not
                          holdable. Obvious, and worth having
                          on the page so nobody asks.
\`\`\`

**Draw one for any problem with a hold, a booking, a lifecycle or an expiry.** Three minutes, and it routinely surfaces a case the candidate had not considered — **which is better found by you than by the interviewer.**

**Two refinements worth knowing.**

**Put the guard on the transition.** \`held → booked [payment confirmed]\` says what must be true, and **a transition without its guard is half a decision.**

**And use parallel regions when several lifecycles run at once.** An order whose kitchen state, courier state and customer state advance independently **cannot be one machine** — three regions side by side is the honest picture, and flattening them produces the state explosion the food-delivery design warned about.

## When not to draw at all

**Three situations where narrating beats drawing.**

**The structure is three classes with obvious ownership.** Say it.

**The interviewer has asked a behavioural question.** "What happens if the payment times out?" wants an answer, not a picture — **and if a picture helps, it is a sequence diagram, not the class diagram you have open.**

**You are behind on time.** The diagram is first on the cut list from the framework's priority order, **because working core logic with no diagram passes and a complete diagram with described logic does not.**

*And the inverse case, which is rarer and real:* **draw when you are about to make a contested decision** and want agreement before spending twenty minutes on it. Two boxes and an arrow, ten seconds, **and the interviewer either nods or redirects you** — which is the cheapest possible way to avoid implementing the wrong thing.

## Mechanics that make a sketch legible

**Small things, and they determine whether the drawing communicates at all.**

**Left to right, or top to bottom, consistently.** A diagram whose arrows go in four directions takes the reader longer than your explanation would have.

**Leave space.** You will add a box. A tightly packed diagram cannot be extended, **and extending it is the normal case** — the interviewer will ask for something.

**Keep it visible while you code.** On a whiteboard, use one section for the sketch and another for code. **On a shared editor, put the structure in a comment block at the top** — three or four lines of ASCII is enough, and it stays on screen as the reader scrolls your implementation.

**Write legibly enough to be read upside down**, because in person the interviewer is often on the other side.

**And say what you are drawing as you draw it.** Silence plus drawing is the failure mode; **narration turns the same three minutes into a conversation**, which is what makes the interruption test pass.

## The vocabulary, which matters more than the symbols

**Nobody grades your diamonds. But the words let you defend a choice in one sentence**, and that is what the diagram is for.

\`\`\`
"composition"    the owner controls the lifetime; the part
                 does not outlive it
                 → "the cache owns the nodes"

"association"    a reference, with independent lifetimes
                 → "the booking references a customer who
                    exists either way"

"multiplicity"   one-to-many, optional, exactly one
                 → "a show has many seats; a seat has at
                    most one active hold"

"dependency
 direction"      who must change when the other does
                 → "pricing does not know about storage"
\`\`\`

**"A seat has at most one active hold" is a sentence that comes from a multiplicity marker and does more work than the marker** — it states an invariant, which is where the framework's core-logic step begins.

**So learn the four words. Draw six symbols. And measure the diagram by whether the interviewer speaks.**`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'pick-the-diagram',
      title: 'Pick the diagram from the question',
      caption:
        'Read it as a routing decision. The expensive mistake is not drawing badly — it is drawing the wrong type carefully, so the time is spent and the question is still open.',
      code: `flowchart TB
    Q["**What has the interviewer<br/>just asked about?**"]

    Q -->|"who owns what;<br/>which way do<br/>dependencies point"| C["**Class sketch**<br/>~6 symbols<br/>3 minutes"]
    Q -->|"in what order;<br/>what does the<br/>loser see"| S["**Sequence diagram**<br/>two clients,<br/>the failure path<br/>3 minutes"]
    Q -->|"what states exist;<br/>which transitions<br/>are legal"| T["**State diagram**<br/>guards on transitions<br/>3 minutes"]
    Q -->|"three classes,<br/>obvious ownership"| N["**No diagram.**<br/>Say it in a sentence —<br/>8 seconds"]

    C --> C1["Draw only what is<br/>**contestable**: method names<br/>over field names, ownership<br/>over attributes"]
    S --> S1["The **loser's arrow** is the<br/>point. Most candidates draw<br/>only the happy path."]
    T --> T1["The **absent transitions** are<br/>the decisions. held→held not<br/>drawn = a held seat cannot be<br/>re-held, and drawing it is how<br/>you notice you decided that."]

    C1 --> M["**The only measure:<br/>is the interviewer<br/>interrupting?**<br/>Silence is not approval —<br/>it is the absence of<br/>communication."]
    S1 --> M
    T1 --> M
    N --> M

    style T1 fill:#17272a,stroke:#35897e
    style M fill:#1c1814,stroke:#c99a4e
    style N fill:#17272a,stroke:#35897e`,
    },
    {
      kind: 'flow',
      id: 'what-to-leave-out',
      title: 'What a sketch shows, and what it costs to show more',
      caption:
        'Step through it. Each item in the second group is seconds of drawing that communicate nothing a reader would dispute.',
      nodes: [
        { id: 'contest', label: 'Draw what is contestable', kind: 'note', x: 0, y: 120, detail: 'A reader will not argue that a field is private. They will argue about who owns the recency list, whether the policy is an interface, and whether the ticket or the rate table computes the fee. Those are the diagram\'s content.' },
        { id: 'methods', label: 'Method names over field names', kind: 'service', x: 260, y: 40, detail: '"Spot.accepts(vehicle)" tells the reader where a decision lives. "Spot { id, size, occupied }" tells them nothing they could not guess — so the method name earns the space and the field list does not.' },
        { id: 'arrows', label: 'Arrows in the direction of dependency', kind: 'service', x: 260, y: 170, detail: 'If every arrow points at your policy objects, the reader can see that policies are stable and callers depend on them. That is the dependency-direction argument made visually, in two seconds.' },
        { id: 'omit', label: 'The omission list', kind: 'note', x: 530, y: 40, detail: 'Visibility markers, full signatures, getters and constructors, every field, package boxes, stereotypes, and aggregation\'s hollow diamond — say "holds a reference to" instead. Each one costs seconds and carries nothing contestable.' },
        { id: 'words', label: 'Four words that do the real work', kind: 'note', x: 530, y: 180, detail: 'Composition (the owner controls the lifetime), association (independent lifetimes), multiplicity (at most one active hold), dependency direction (who must change when the other does). Nobody grades your diamonds; the vocabulary is what makes a choice defensible in one sentence.' },
        { id: 'test', label: 'The interruption test', kind: 'note', x: 800, y: 110, detail: 'They point at a box and ask something: the diagram is working. They are silent while you draw: you are drawing for yourself. And narrate as you draw — silence plus drawing is the failure mode, while narration turns the same three minutes into a conversation.' },
      ],
      edges: [
        { id: 'u1', source: 'contest', target: 'methods', kind: 'control' },
        { id: 'u2', source: 'contest', target: 'arrows', kind: 'control' },
        { id: 'u3', source: 'methods', target: 'omit', kind: 'control' },
        { id: 'u4', source: 'arrows', target: 'words', kind: 'control' },
        { id: 'u5', source: 'omit', target: 'test', kind: 'control' },
        { id: 'u6', source: 'words', target: 'test', kind: 'control' },
      ],
      steps: [
        {
          id: 'us1',
          title: 'One rule generates the whole notation list',
          description:
            'Draw what is contestable. Everything a reader would accept without argument is cost — and in a 45-minute round the cost is measured against implementation time.',
          nodes: ['contest'],
          edges: [],
        },
        {
          id: 'us2',
          title: 'Which makes methods and arrows the content',
          description:
            'A method name says where a decision lives; an arrow direction says which way change propagates. Field lists say what anyone could guess.',
          nodes: ['methods', 'arrows'],
          edges: ['u1', 'u2'],
        },
        {
          id: 'us3',
          title: 'And makes the omission list long',
          description:
            'Visibility markers, signatures, getters, packages, stereotypes. Each is seconds spent on something no reader disputes.',
          nodes: ['omit'],
          edges: ['u3'],
        },
        {
          id: 'us4',
          title: 'Learn the words, not the symbols',
          description:
            '"A seat has at most one active hold" comes from a multiplicity marker and does more work than the marker — because it states an invariant, which is where implementation begins.',
          nodes: ['words'],
          edges: ['u4'],
        },
        {
          id: 'us5',
          title: 'Then measure it by whether they speak',
          description:
            'Narrate while drawing. A diagram is a message to one person three feet away, and the only evidence it arrived is that they respond to it.',
          nodes: ['test'],
          edges: ['u5', 'u6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The most useful idea in the published UML material is a distinction drawn in its first chapter, and it is not about notation at all.

**UML is used in three modes: as a sketch, as a blueprint, and as a programming language.** A sketch is selective and informal, drawn to communicate one idea to people who are present. **A blueprint aims at completeness so that code can be generated or derived from it.** The third mode is executable models.

**An interview diagram is unambiguously a sketch**, and naming that is what licenses every omission in this lesson. **Completeness is a property blueprints need and sketches are actively harmed by** — a sketch showing everything shows nothing, because the reader cannot tell what you consider important.

**And the material makes a second point that matters more in practice: selectivity is the skill.** Choosing which three of nine classes to draw is the work; drawing all nine is avoidance of that work.

**Three things to take from it.**

**Declare the mode, if only to yourself.** "This is a sketch to agree on ownership" produces a different drawing from "this is the design" — **and the second framing is what makes candidates draw nine boxes.**

**Selectivity signals judgment.** A diagram with three boxes and two relationships, where the three are the contested ones, **demonstrates that you know which decisions matter.** Nine boxes demonstrate that you can enumerate nouns.

**And a sketch is disposable.** You should expect to redraw part of it when the interviewer pushes, **so leave space and do not invest in neatness** — investment in a sketch is a category error.

**Where the published material does not help.** It is written for teams documenting systems over months, so it says little about the time pressure that makes selectivity mandatory rather than merely good. **And it predates the shared-editor interview**, where the practical answer — a four-line ASCII structure comment at the top of the file — is not a UML question at all, but it is the form the sketch usually takes now.`,
  },

  tradeoffs: {
    intro:
      'The choices a diagram involves, and what each direction costs in a timed round.',
    rows: [
      {
        option: 'A complete class diagram with all fields and signatures',
        whenItWins:
          'Documentation intended to outlive the conversation, or a blueprint from which code will be derived.',
        whenItLoses:
          'In a sketch, showing everything shows nothing — the reader cannot tell what you consider important.',
        cost:
          'Ten to twelve minutes that had to come from implementation.',
      },
      {
        option: 'A three-box sketch of the contested relationships',
        whenItWins:
          'Always in an interview. Selectivity is the signal — it shows you know which decisions matter.',
        whenItLoses:
          'A reader wanting full context has to ask, which is a conversation rather than a problem.',
        cost:
          'Three minutes, and some redrawing when pushed.',
      },
      {
        option: 'A class diagram for a question about ordering',
        whenItWins:
          'Nowhere. The notation has no vocabulary for time.',
        whenItLoses:
          'The time is spent and the question remains open — and a repeated question is the interviewer saying so.',
        cost:
          'The worst available outcome: careful work on the wrong artefact.',
      },
      {
        option: 'A sequence diagram with two clients and the failure path',
        whenItWins:
          'Any contention, ordering or timeout question.',
        whenItLoses:
          'It cannot show ownership or dependency direction.',
        cost:
          'Three minutes, and it needs the class sketch alongside for structure.',
      },
      {
        option: 'A happy-path-only sequence diagram',
        whenItWins:
          'Explaining a flow with no contention and no failure modes.',
        whenItLoses:
          'In a contention question the loser\'s arrow is the entire point.',
        cost:
          'Drawing the uninteresting half.',
      },
      {
        option: 'Skipping the state diagram',
        whenItWins:
          'Stateless problems — a cache, a rate limiter, a formatter.',
        whenItLoses:
          'Anything with a hold, a booking, a lifecycle or an expiry, where the absent transitions are the decisions.',
        cost:
          'An illegal state discovered by the interviewer rather than by you.',
      },
      {
        option: 'A state diagram with guards on transitions',
        whenItWins:
          'Any stateful problem. Three minutes, and it routinely surfaces an unconsidered case.',
        whenItLoses:
          'It says nothing about structure or ownership.',
        cost:
          'Three minutes, and a decision about every transition you draw or omit.',
      },
      {
        option: 'One flat state machine for several concurrent lifecycles',
        whenItWins:
          'A single sequential lifecycle.',
        whenItLoses:
          'Three independent lifecycles produce a state explosion, and most combinations go unenumerated.',
        cost:
          'States nobody defined, found in production or by the interviewer.',
      },
      {
        option: 'Parallel regions for concurrent lifecycles',
        whenItWins:
          'Whenever several parties advance independently — an order with kitchen, courier and customer states.',
        whenItLoses:
          'Interactions between regions must be enumerated deliberately.',
        cost:
          'An interaction list alongside the regions.',
      },
      {
        option: 'No diagram at all',
        whenItWins:
          'Three classes with obvious ownership, a behavioural question, or being behind on time.',
        whenItLoses:
          'When a decision is contested and you want agreement before implementing.',
        cost:
          'Occasionally a misunderstanding that a ten-second sketch would have prevented.',
      },
      {
        option: 'Drawing silently',
        whenItWins:
          'Nowhere. It is the default under pressure.',
        whenItLoses:
          'It removes the only feedback channel — a silent room means the drawing is not communicating.',
        cost:
          'Three minutes of monologue that could have been a conversation.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Let me draw the full class diagram first — all the entities with their fields and methods."',
      whyWeak:
        'It optimises for completeness, which is what a blueprint needs and a sketch is harmed by. Nine boxes with full signatures leave the reader unable to tell which three decisions are contested, and it costs ten minutes that had to come from implementation.',
      strongAnswer:
        '"Let me sketch the three relationships that are actually contested — who owns seat state, where the hold lives, and what expires it. That is three boxes and two arrows, and I will leave the context classes out since nobody is going to argue about them. If you want the wider entity list I will add it, but I would rather spend the time on the hold logic."',
    },
    {
      weakAnswer: '"Here is the class diagram showing how Booking relates to Seat." (Asked: what happens when two people select the same seat?)',
      whyWeak:
        'The question is about ordering and contention, and a class diagram has no vocabulary for time. The structure can be perfect and the question remains unanswered — which is why a repeated question is the interviewer signalling that the wrong artefact is being produced.',
      strongAnswer:
        '"That is an ordering question, so let me draw a sequence instead: two clients, the show, and the four messages. A holds seat 12 with a conditional claim and gets an ok; B makes the same claim and gets a 409 with the reason. Then I will add the expiry as a stored deadline rather than a timer, so a dead process does not hold the seat forever."',
    },
    {
      weakAnswer: '"The sequence diagram shows the successful booking flow end to end."',
      whyWeak:
        'The happy path is the half nobody needs drawn. In a contention or timeout question the interesting arrow is the one the loser receives, and the interesting annotation is what advances time.',
      strongAnswer:
        '"I will draw two clients rather than one, because the contention is the point, and I will include the refusal arrow with its reason. And I will annotate what advances time — the hold expiring after fifteen minutes — because that pre-empts the question of what happens if the process holding it dies."',
    },
    {
      weakAnswer: '"Seats have a boolean isBooked flag, so a state diagram would be overkill."',
      whyWeak:
        'A boolean cannot represent held-but-not-paid, which is the state the whole problem is about. And skipping the state diagram skips the only artefact that catches an illegal state nobody enumerated.',
      strongAnswer:
        '"I would spend three minutes on a seat state diagram: available, held with a holder and an expiry, booked. The valuable part is the transitions I do not draw — there is no held-to-held transition, which says a held seat cannot be claimed by someone else, and drawing it is how I notice I made that decision. I would also put the guard on the transition: held to booked requires payment confirmed."',
    },
    {
      weakAnswer: '"One state machine covers the whole order: placed, accepted, cooking, out for delivery, delivered."',
      whyWeak:
        'Several lifecycles are running at once — the kitchen, the courier and the customer all act independently — so a flat machine either omits legal combinations or explodes into their product. The combinations it omits are the states that show up as stuck orders.',
      strongAnswer:
        '"Three parallel regions rather than one machine, because the kitchen, courier and customer states advance independently and cancel-while-cooking-while-assigned is three simultaneous truths. Then the interactions between regions get enumerated deliberately, which is where the interesting cases live — a ready-before-courier-assigned, or a cancel during cooking where somebody has to pay for the food."',
    },
    {
      weakAnswer: '"I need to check whether this relationship is aggregation or composition before I draw it."',
      whyWeak:
        'It spends interview time on notation correctness that nobody is grading, while the substantive question — does the part outlive the owner — goes unstated.',
      strongAnswer:
        '"I will draw a filled diamond and say what I mean: the cache owns the nodes and they do not outlive it, whereas a booking references a customer who exists either way. The vocabulary matters because it lets me defend the choice in a sentence — but the diamond itself is not what is being assessed, so I am not going to deliberate over which one is technically correct."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lu-1',
      front: 'What is the only measure of an interview diagram?',
      back: 'Whether the interviewer responds to it. Silence while you draw is not approval — it is the absence of communication.',
      topic: 'communication',
    },
    {
      id: 'fc-lu-2',
      front: 'Which three diagram types earn their place, and what does each answer?',
      back: 'Class sketch — what owns what and which way dependencies point. Sequence — order, contention, what the loser sees. State — which transitions are legal.',
      topic: 'diagrams',
    },
    {
      id: 'fc-lu-3',
      front: 'What is the most expensive diagramming mistake?',
      back: 'Drawing the wrong type carefully — a class diagram cannot express ordering, so the time is spent and the question stays open.',
      topic: 'diagrams',
    },
    {
      id: 'fc-lu-4',
      front: 'What rule generates the notation list?',
      back: 'Draw what is contestable. A reader will not argue that a field is private; they will argue about who owns the recency list.',
      topic: 'notation',
    },
    {
      id: 'fc-lu-5',
      front: 'Which six symbols do you need?',
      back: 'A named box, a use arrow, a filled diamond for ownership, a hollow triangle for implements, a multiplicity marker, and a label on the line.',
      topic: 'notation',
    },
    {
      id: 'fc-lu-6',
      front: 'Why are method names more valuable than field names on a box?',
      back: 'A method name says where a decision lives; a field list says what anyone could guess.',
      topic: 'notation',
    },
    {
      id: 'fc-lu-7',
      front: 'Why draw two clients in a sequence diagram?',
      back: 'Because the contention is the interesting part, and the loser\'s arrow is usually the whole answer.',
      topic: 'diagrams',
    },
    {
      id: 'fc-lu-8',
      front: 'What should a sequence diagram annotate besides messages?',
      back: 'What advances time — a stored expiry deadline rather than a timer — which pre-empts the "what if the process dies" question.',
      topic: 'diagrams',
    },
    {
      id: 'fc-lu-9',
      front: 'Why is the state diagram the highest-return one?',
      back: 'It is the only diagram that catches an illegal state nobody enumerated, and the transitions you do not draw are the decisions you made.',
      topic: 'state-machines',
    },
    {
      id: 'fc-lu-10',
      front: 'What does an absent held-to-held transition express?',
      back: 'That a held seat cannot be claimed by someone else — a decision made visible, and drawing the diagram is how you notice you made it.',
      topic: 'state-machines',
    },
    {
      id: 'fc-lu-11',
      front: 'When do parallel regions replace one state machine?',
      back: 'When several lifecycles advance independently. A flat machine either omits legal combinations or explodes into their product.',
      topic: 'state-machines',
    },
    {
      id: 'fc-lu-12',
      front: 'When should you not draw at all?',
      back: 'Three obvious classes, a behavioural question, or being behind — the diagram is first on the cut list.',
      topic: 'communication',
    },
    {
      id: 'fc-lu-13',
      front: 'Which mode of UML applies in an interview, and why does it matter?',
      back: 'Sketch, not blueprint. Completeness is what blueprints need and sketches are harmed by — showing everything shows nothing.',
      topic: 'communication',
    },
    {
      id: 'fc-lu-14',
      front: 'Which four words do more work than the symbols?',
      back: 'Composition, association, multiplicity, dependency direction — they let you defend a choice in one sentence.',
      topic: 'notation',
    },
  ],

  quiz: [
    {
      id: 'q-lu-1',
      kind: 'scenario',
      prompt:
        'The interviewer asks what happens when two users select the same seat simultaneously. Which diagram answers it?',
      options: [
        { id: 'a', label: 'A sequence diagram with both clients and the refusal arrow — or a seat state diagram with the hold transition' },
        { id: 'b', label: 'A class diagram showing Booking, Seat and Show' },
        { id: 'c', label: 'A class diagram with multiplicity markers between Seat and Hold' },
        { id: 'd', label: 'No diagram — describe the database lock' },
      ],
      correct: ['a'],
      explanation:
        'The question is about ordering and contention, which a class diagram has no vocabulary for. Option c gets closer — "a seat has at most one active hold" is a useful invariant from a multiplicity marker — but it still cannot show who wins and what the loser receives, which is what was asked.',
      difficulty: 'core',
      topic: 'diagrams',
    },
    {
      id: 'q-lu-2',
      kind: 'scenario',
      prompt:
        'You have drawn a state diagram for a seat: available, held, booked. What is the most valuable part of it?',
      options: [
        { id: 'a', label: 'The transitions you did not draw — no held-to-held means a held seat cannot be claimed by someone else' },
        { id: 'b', label: 'The three state names, which document the lifecycle' },
        { id: 'c', label: 'The initial-state marker' },
        { id: 'd', label: 'That it can be generated into code' },
      ],
      correct: ['a'],
      explanation:
        'The absent transitions are the decisions, and drawing the diagram is how you discover which ones you had not consciously made. The state names are the cheap part — any candidate produces those — and code generation is the blueprint mode, which does not apply to a sketch.',
      difficulty: 'advanced',
      topic: 'state-machines',
    },
    {
      id: 'q-lu-3',
      kind: 'scenario',
      prompt:
        'Twelve minutes into a 60-minute round you have a nine-box class diagram with full method signatures, and the interviewer has been silent throughout. What does the silence mean?',
      options: [
        { id: 'a', label: 'The diagram is not communicating — silence is the absence of feedback, not approval' },
        { id: 'b', label: 'They are satisfied with the design so far' },
        { id: 'c', label: 'They are waiting for you to finish before commenting' },
        { id: 'd', label: 'Nothing — interviewers are often quiet' },
      ],
      correct: ['a'],
      explanation:
        'A diagram is a message to one person three feet away, and the only evidence it arrived is that they engage. Silence plus drawing is the characteristic failure mode, and the remedy is to narrate while drawing so the same three minutes become a conversation.',
      difficulty: 'core',
      topic: 'communication',
    },
    {
      id: 'q-lu-4',
      kind: 'scenario',
      prompt:
        'Which of these should appear on a box in a 45-minute round?',
      options: [
        { id: 'a', label: '`Spot.accepts(vehicle)` — the method where a contested decision lives' },
        { id: 'b', label: 'All fields with visibility markers' },
        { id: 'c', label: 'Full method signatures with parameter and return types' },
        { id: 'd', label: 'Constructors and getters' },
      ],
      correct: ['a'],
      explanation:
        'Draw what is contestable. A method name tells the reader where a decision lives; the other three tell them things no reader would dispute, at a cost of seconds each that come out of implementation time.',
      difficulty: 'core',
      topic: 'notation',
    },
    {
      id: 'q-lu-5',
      kind: 'scenario',
      prompt:
        'An order has kitchen, courier and customer lifecycles that advance independently. How should it be drawn?',
      options: [
        { id: 'a', label: 'Three parallel regions, with the interactions between them enumerated deliberately' },
        { id: 'b', label: 'One state machine covering the full order lifecycle' },
        { id: 'c', label: 'One state machine plus boolean flags for the other two' },
        { id: 'd', label: 'A class diagram, since state machines do not handle concurrency' },
      ],
      correct: ['a'],
      explanation:
        'Cancel-while-cooking-while-courier-assigned is three simultaneous truths, so a flat machine either omits legal combinations or becomes their product — and the omitted combinations are what appear later as stuck orders. Option c is the boolean-columns mistake, which permits states that cannot exist.',
      difficulty: 'advanced',
      topic: 'state-machines',
    },
    {
      id: 'q-lu-6',
      kind: 'multi',
      prompt:
        'Which of these belong on the omission list for an interview sketch? Select all that apply.',
      options: [
        { id: 'a', label: 'Visibility markers on fields and methods' },
        { id: 'b', label: 'Package and namespace boxes' },
        { id: 'c', label: 'Getters, setters and constructors' },
        { id: 'd', label: 'Arrow direction showing which way dependencies point' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three cost seconds each and carry nothing a reader would dispute. Arrow direction is the opposite — it is how a sketch shows dependency direction, which is one of the two or three things the diagram exists to communicate.',
      difficulty: 'core',
      topic: 'notation',
    },
  ],

  exercises: [
    {
      id: 'ex-lu-1',
      kind: 'design',
      title: 'Three diagrams in nine minutes',
      estimatedMinutes: 30,
      prompt: `You are 8 minutes into a 60-minute round on: *"Design a library book-lending system with reservations. A member may reserve a book that is out; when it is returned, the reserving member gets first claim for 48 hours."*

**Part 1.** Draw the class sketch. State how many boxes you drew and which context classes you deliberately omitted.

**Part 2.** Draw the state diagram for a single copy of a book. List at least three transitions you deliberately did not draw, and say what each absence decides.

**Part 3.** Draw the sequence for the contested case: a copy is returned, one member holds a reservation, and a walk-in member tries to borrow it.

**Part 4.** The interviewer asks: "What if the reserving member never comes?" Which diagram already answers it, and what would you add?

Then answer:

- Which of the three diagrams was most valuable, and why?
- You have 3 minutes rather than 9. Which one do you draw?`,
      rubric: [
        'Class sketch has five or fewer boxes with omissions named.',
        'Shows ownership and at least one multiplicity that states an invariant.',
        'State diagram covers available, on-loan, reserved-hold and their transitions.',
        'Names at least three absent transitions and what each decides.',
        'Sequence diagram includes both members and the refusal arrow.',
        'Annotates what advances time — the 48-hour claim expiry.',
        'Identifies the state diagram as already answering the never-comes question.',
        'Ranks the diagrams with reasoning.',
        'Chooses one diagram for the 3-minute case and defends it.',
      ],
      modelAnswer: `**Part 1 — the class sketch: four boxes**

\`\`\`
┌────────────────────┐        ┌──────────────────────┐
│ Title              │──1──*─▶│ Copy                 │
│ isbn, name         │        │ state                │
└────────────────────┘        │ mayBorrow(member,now)│
         │                    └──────────────────────┘
         │ 1                             ▲
         ▼ 0..*                          │ 0..1 active
┌────────────────────┐                   │
│ ReservationQueue   │──────claim────────┘
│ enqueue(member)    │
│ nextClaimant()     │
└────────────────────┘

┌────────────────────┐
│ Claim              │   held by the queue when a copy
│ member, expiresAt  │   returns; expiresAt is STORED
└────────────────────┘
\`\`\`

**Omitted deliberately: \`Member\`, \`Librarian\`, \`Loan\` history, \`Fine\`, \`Branch\`.**

*Why each:* **\`Member\` is context** — nothing about it is contested, and a box saying \`Member { id, name }\` would communicate nothing. **\`Loan\` I would add if asked about history**, but the contested decisions here are about claims rather than loans. **\`Fine\` and \`Branch\` are not in the prompt at all.**

**Three things this sketch shows that are contestable.**

**The reservation queue is per title, not per copy.** You reserve *a book*, and any returned copy satisfies the reservation — **that is a real design decision and the multiplicity makes it visible.**

**\`Copy.mayBorrow(member, now)\` takes the member and the time.** Both parameters are the design: **the answer depends on who is asking** (are you the claimant?) **and on when** (has the claim expired?).

**And \`Claim.expiresAt\` is annotated as stored.** One word, and it pre-empts the "what if nobody runs the job" question.

---

**Part 2 — the state diagram for a copy**

\`\`\`
                    borrow
     ┌───────────┐ ─────────▶ ┌──────────┐
 ───▶│ available │             │ on_loan  │
     └───────────┘ ◀───────── └──────────┘
           ▲         return       │
           │        (no queue)    │ return (queue non-empty)
           │                      ▼
           │            ┌──────────────────┐
           └────────────│ claim_held       │
             claim       │ claimant,        │
             expires     │ expiresAt (48 h) │
             (48 h)      └──────────────────┘
                                  │ claimant borrows
                                  ▼
                            ┌──────────┐
                            │ on_loan  │
                            └──────────┘
\`\`\`

**Transitions deliberately not drawn — four of them, and each is a decision.**

**\`claim_held → claim_held\`** (a second member's claim). **Absence decides: a claim cannot be superseded.** The first claimant holds it for the full 48 hours even if a higher-priority member reserves meanwhile — **which is a fairness choice, and drawing the diagram is how I notice I made it.**

**\`claim_held → on_loan\` by a non-claimant.** Absence decides: **a walk-in cannot take a held copy**, which is the entire point of the reservation feature. *And this is the transition the Part 3 sequence shows being refused.*

**\`on_loan → available\` with a non-empty queue.** Absence decides: **a return never goes straight to available when someone is waiting** — it must pass through \`claim_held\`. **Drawing this absence is what caught the bug**, because "return sets available" is the obvious implementation and it silently drops the reservation.

**\`available → claim_held\`** (reserving an available copy). Absence decides: **you cannot reserve something you could simply borrow.** Worth having on the page because it is the kind of thing an interviewer asks about.

*And one transition I would ask about rather than decide:* **\`claim_held → claim_held\` passing to the next claimant when the first expires.** Does an expiring claim go to the next person in the queue, or does the copy become available to everyone? **The prompt does not say, and the two produce noticeably different products** — so it is a clarifying question rather than an assumption.

---

**Part 3 — the sequence for the contested case**

\`\`\`
 Member A          Member B        Copy/Queue
 (reserved)        (walk-in)
     │                 │                │
     │  ┌── earlier: A reserved the title ──┐
     │                 │                │
     │                 │   return(copy) │  queue non-empty
     │                 │                │──┐ → claim_held
     │                 │                │◀─┘   claimant = A
     │                 │                │      expiresAt = +48h
     │◀── notify(claim available) ──────│
     │                 │                │
     │                 │── borrow ─────▶│
     │                 │◀── 409 ────────│  reason:
     │                 │                │  'reserved-for-other'
     │                 │                │  detail: 'until <t>'
     │                 │                │
     │  (36 hours pass)                 │
     │── borrow ──────────────────────▶ │  claimant matches
     │◀── ok(loan) ─────────────────────│  → on_loan
\`\`\`

**Four things this diagram does.**

**Both members are present**, so the contention is visible rather than described.

**The refusal carries a reason and a detail.** \`409 reserved-for-other, until <t>\` — **so member B learns when they might succeed**, which is the result-type-over-boolean habit showing up in a diagram.

**The 48-hour expiry is annotated as a stored deadline** at the moment it is set, not as a timer.

**And the elapsed time is drawn explicitly** — the "(36 hours pass)" line — because **the whole feature is about a window**, and a sequence diagram is the only one of the three that can show elapsed time at all.

---

**Part 4 — "What if the reserving member never comes?"**

**The state diagram already answers it**, and I would point at it rather than draw anything new:

\`\`\`
claim_held ──claim expires (48 h)──▶ available
\`\`\`

**And the sentence that goes with it:** *"The claim has a stored expiry, so after 48 hours the copy returns to available. Nothing needs to stay running for that to happen — any read that finds an expired claim treats the copy as available, and a sweeper only makes it happen sooner."*

**What I would add: one annotation, not a diagram.** On that transition, the guard:

\`\`\`
claim_held ──[now > expiresAt]──▶ available
\`\`\`

**A guard is half a decision when it is missing**, and writing it makes the check's location explicit — **on read, rather than in a job.**

*And the follow-up I would raise before being asked:* **does the expiring claim pass to the next person in the queue?** This is the clarifying question from Part 2, and **the "never comes" question is the natural moment to raise it** — which is an example of a diagram producing the conversation rather than just recording a decision.

---

**Which diagram was most valuable?**

**The state diagram, by a clear margin — and for a reason specific to this problem.**

**It found a bug.** The absent \`on_loan → available\` transition when the queue is non-empty is the one an implementation gets wrong by default: **"return sets the copy available" is the obvious line of code, and it silently discards the reservation** — which is the entire feature. **Nothing in the class sketch or the sequence would have surfaced that**, because both describe what happens rather than enumerating what must not.

**It also answered a later question for free** (Part 4), which is unusual — **most diagrams answer the question they were drawn for and nothing else.**

**And it forced three decisions I had not consciously made:** superseding claims, walk-in access, and reserving an available copy. **The class sketch forced none, and the sequence forced one** (what the loser sees).

*Ranking the other two:* **the sequence is second**, because it made the refusal reason concrete and it is the only diagram that can show a 48-hour window. **The class sketch is third** — useful, and most of what it shows I could have said in two sentences: "the queue is per title, and a copy's borrowability depends on who is asking and when."

**The general lesson: the state diagram has the highest return whenever the problem has a hold, a window or a lifecycle**, because it is the only one whose *absences* carry information.

---

**With 3 minutes rather than 9**

**The state diagram, without hesitation.**

**The reasoning is about what each one would cost me if omitted.**

\`\`\`
No class sketch     → I say two sentences instead. Cheap.
No sequence         → I describe the refusal in one sentence.
                      Slightly worse, recoverable.
No state diagram    → I probably ship the return-sets-
                      available bug, and I have not decided
                      whether claims can be superseded.
\`\`\`

**Only one of the three has a cost I cannot talk my way out of.** The structural facts are sayable in sentences; **the enumeration of legal transitions is not** — it is exactly the kind of thing that needs to be laid out to be complete, which is why the diagram earns the space.

**And in three minutes I would draw it with guards and stop.** Four states, six transitions, the guard on the expiry, **and then say out loud the three transitions I deliberately omitted** — because the absences are the content, and saying them converts the drawing into the decisions it encodes.

*One refinement if I had four minutes rather than three:* **add the reservation queue's relationship to the copy in two boxes beside it.** Not a full class sketch — **just enough to show that the queue is per title**, since that is the one structural decision the state diagram cannot express and that a reader would otherwise get wrong.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lu-1',
      level: 'basic',
      question: 'Walk me through your class design.',
      guidance:
        'Look for selectivity — three or four contested boxes, with the omissions named. Nine boxes with full signatures is the noun-extraction habit reappearing as a drawing.',
    },
    {
      id: 'iq-lu-2',
      level: 'basic',
      question: 'Can you show me how this works?',
      guidance:
        'The right diagram depends on what "this" is. Look for the candidate choosing a sequence diagram for a flow question rather than pointing at the class diagram they already have.',
    },
    {
      id: 'iq-lu-3',
      level: 'intermediate',
      question: 'What happens when two users act on the same resource at once?',
      guidance:
        'A sequence with two clients and the refusal arrow. Strong answers annotate what advances time and give the refusal a reason rather than a boolean.',
    },
    {
      id: 'iq-lu-4',
      level: 'intermediate',
      question: 'What states can this be in?',
      guidance:
        'A state diagram with guards. Excellent answers volunteer the transitions they deliberately did not draw and what each absence decides.',
    },
    {
      id: 'iq-lu-5',
      level: 'advanced',
      question: 'This entity has three things happening to it independently. How do you model that?',
      guidance:
        'Parallel regions plus an explicit interaction list. Look for rejection of both a flat machine and boolean flags.',
    },
    {
      id: 'iq-lu-6',
      level: 'advanced',
      question: 'Is that composition or aggregation?',
      guidance:
        'The substantive answer is about lifetime — does the part outlive the owner. Deliberating over which diamond is technically correct is spending time on what nobody grades.',
    },
    {
      id: 'iq-lu-7',
      level: 'followup',
      question: 'You have three minutes. What would you draw?',
      guidance:
        'For a stateful problem, the state diagram — because structural facts are sayable in sentences and an enumeration of legal transitions is not.',
    },
    {
      id: 'iq-lu-8',
      level: 'followup',
      question: 'Why did you not draw the rest of the entities?',
      guidance:
        'Because they are context rather than contested. Look for the sketch-versus-blueprint distinction and for an offer to add them if the interviewer wants them.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lu-1',
      kind: 'what-changes-if',
      prompt:
        'Change the medium: the interview is remote, in a shared code editor, with no drawing surface. What survives, what has to change, and what turns out to be better?',
      discussion: `This is now the common case, and **the honest finding is that two of the three diagrams survive well and one becomes genuinely awkward** — while the medium forces a discipline that improves the sketch.

**What survives, in a better form: the class sketch.**

A four-line ASCII comment at the top of the file:

\`\`\`
// Title ──1─*─▶ Copy { state, mayBorrow(member, now) }
//   └──1─0..*─▶ ReservationQueue { enqueue, nextClaimant }
//                  └── holds ──▶ Claim { member, expiresAt }
// INVARIANT: a copy has at most one active claim
\`\`\`

**And it is better than a whiteboard version in two specific ways.**

**It stays visible while you write code**, scrolling with the file or pinned at the top — whereas a whiteboard sketch ends up behind you or off-screen. **The framework's advice to keep the sketch visible becomes free.**

**And the medium enforces selectivity.** Typing boxes is slower than drawing them, **so nine boxes is physically unaffordable** — which removes the temptation that produces the twelve-minute diagram. The constraint does the editing for you.

*What is lost:* two-dimensional layout. **You cannot show a cluster or a layering visually**, so relationships must be read line by line. For four boxes that is fine; **for eight it becomes unreadable** — which is another reason the constraint helps.

**What survives well: the state diagram.**

\`\`\`
// available ──borrow──▶ on_loan
// on_loan ──return [queue empty]──▶ available
// on_loan ──return [queue non-empty]──▶ claim_held
// claim_held ──[now > expiresAt]──▶ available
// claim_held ──borrow [member == claimant]──▶ on_loan
//
// NOT drawn: claim_held → claim_held  (claims are not superseded)
//            claim_held → on_loan by non-claimant (walk-ins refused)
//            on_loan → available with non-empty queue
\`\`\`

**A transition list is arguably better than a picture**, because guards are text anyway and **the deliberate omissions can be written down rather than only spoken.** On a whiteboard the absences are invisible — you have to say them and hope they land. **Here they are on the page.**

*And there is a second benefit:* **this comment block is directly adjacent to the code implementing it**, so a reviewer can check the implementation against the enumeration. That is closer to how the artefact is actually useful.

**What becomes genuinely awkward: the sequence diagram.**

Ordering and elapsed time are what it exists to show, and **ASCII lifelines are painful to type and fragile to edit.** A reasonable substitute:

\`\`\`
// CONTENDED RETURN:
//  1. B returns copy          → queue non-empty → claim_held(A, +48h)
//  2. A notified
//  3. C borrows               → 409 reserved-for-other until <t>
//  4. ...36h...
//  5. A borrows               → ok, on_loan
\`\`\`

**A numbered list keeps the ordering, which is the essential property**, and loses the visual parallelism of two lifelines side by side. **For two participants that is an acceptable trade; for four it stops working** — and at that point the honest move is to narrate it aloud rather than fight the medium.

*The thing genuinely lost:* **showing that two things happen concurrently.** A numbered list implies sequence, so **"A and B both request at the same instant" needs a sentence** rather than a picture.

**What the medium changes about the interaction, which matters more than the notation.**

**The interruption test gets harder to read.** A remote interviewer may be muted, looking away, or on a laggy connection — **so silence is much weaker evidence** than it is in a room.

*The adaptation:* **ask directly.** "Does that structure match what you had in mind before I start on the claim logic?" **A question forces the feedback that a whiteboard would have got from body language**, and it costs five seconds.

**And typing while talking is harder than drawing while talking.** Most people cannot narrate fluently while typing code. **So separate them explicitly:** say what you are about to write, then write it, then say what it does. **Trying to do both at once produces either silent typing or incoherent narration**, and silent typing is the remote version of drawing silently.

**The transferable point:** the sketch's purpose — communicating contested decisions to one reader — is medium-independent, so **re-derive the form from the medium rather than transplanting the whiteboard habit.** In a shared editor the answer is a short comment block that stays beside the code, and **the absences and invariants that a picture can only imply get written down**, which is a real improvement rather than a compromise.`,
    },
    {
      id: 'al-lu-2',
      kind: 'debug',
      prompt:
        'A candidate produces a clear, well-selected five-box class diagram in four minutes. The interviewer engages with it, asks two good questions, and then says: "Let us move on to the implementation." Twenty minutes later the implementation has a bug the diagram should have prevented: a booking can be confirmed for a seat that was released. What went wrong, and what would have caught it?',
      discussion: `The diagramming was done well by every measure in this lesson — **selective, narrated, engaged with, and four minutes** — which makes this a useful case, because **the failure is not a diagramming failure. It is a diagram-type failure.**

**What the class diagram could show, and did.**

\`\`\`
Show ──1─*─▶ Seat
Booking ──*─1─▶ Seat
Hold { seatIds, holderId, expiresAt }
\`\`\`

**Ownership, references, multiplicities, and where the hold lives.** All correct, all useful, and **none of it constrains the order in which operations may occur.**

**What the bug actually is.**

\`\`\`
1. hold(seat12) by user A        → Hold created
2. release(seat12) by user A     → Hold removed
3. confirmBooking(hold_1)         → ???
   → the hold is gone, but confirm reads the seat and
     books it anyway
\`\`\`

**The bug is a missing guard on a transition**, and transitions are exactly what a class diagram has no vocabulary for. **The diagram was not wrong; it was silent** — and silence on a question is indistinguishable from an answer if nobody asks the question.

**What would have caught it, in order of cost.**

**A seat state diagram. Three minutes, and it catches this directly.**

\`\`\`
available ──hold──▶ held ──[payment confirmed]──▶ booked
   ▲                  │
   └── release/expiry ┘

Absent: held → booked without a valid hold
Absent: available → booked at all
\`\`\`

**The second absence is the bug.** \`available → booked\` is not a legal transition, so **confirming a booking must check that the seat is still held, and by this holder.** Drawing the machine makes that check a visible requirement rather than something an implementer might remember.

**And it would have prompted the interviewer's question.** A drawn state machine invites "what if the hold expired between step 1 and step 3?" — **which is precisely the case that broke.**

**A sequence diagram would also have caught it, from a different angle.**

Drawing the release path — not just the happy path — puts \`release\` and \`confirm\` on the same timeline, **and the question "what if these arrive in this order?" becomes visible.** This is the happy-path-only failure from the lesson: **the interesting arrow was the one not drawn.**

**And the framework's invariant step would have caught it in one sentence.**

\`\`\`
"A booking exists only for a seat whose active hold belongs
 to the booking's holder."
\`\`\`

**That sentence yields a test immediately** — hold, release, confirm, assert refusal — **and it is the test nobody wrote because nobody stated the invariant.**

**So three separate mechanisms would each have caught it, and all three were skipped for the same reason:** the class diagram was good, it was engaged with, and **that created the impression that the design work was done.**

**Which is the diagnosis worth naming.** A well-received diagram is a trap when it is the *only* diagram, because **positive feedback on a structural sketch reads as validation of the whole design** — and structure was never the risky part. **The risky part was ordering, and nothing had examined it.**

**The specific lesson: engagement is evidence that the diagram communicated, not that it was sufficient.**

\`\`\`
The interruption test tells you:   this drawing landed
It does NOT tell you:              this drawing covered
                                   the risky question
\`\`\`

**What I would do differently at minute four**, having produced a well-received class sketch: **ask myself which question it did not answer.** For anything with a hold, a booking, an expiry or a lifecycle, **the unanswered question is always ordering** — so spend three more minutes on the state machine before implementing.

*And a cheap heuristic:* **if the problem's nouns include a word like "hold", "reserve", "claim", "pending" or "expire", the class diagram is the wrong risk.** Those words name states, and states need the diagram whose absences carry information.

**Transferable:** when a design artefact is well received, check what it is structurally incapable of expressing. **A class diagram cannot be wrong about ordering — it can only be silent about it** — and a silent artefact that everyone approved of is more dangerous than a contested one, because approval feels like coverage.`,
    },
  ],

  revision: {
    bullets: [
      'A diagram is a message to one person three feet away; the only measure is whether they respond.',
      'Silence while you draw is not approval — it is the absence of communication.',
      'Three diagram types answer three questions: ownership, ordering, legal transitions.',
      'The most expensive mistake is drawing the wrong type carefully.',
      'A class diagram cannot express time; a sequence diagram cannot express ownership.',
      'Draw what is contestable — nobody argues that a field is private.',
      'Six symbols: box, use arrow, filled diamond, implements triangle, multiplicity, line label.',
      'Omit visibility markers, full signatures, getters, every field, packages and stereotypes.',
      'Method names on a box are worth more than field names, because they say where a decision lives.',
      'Point arrows in the direction of dependency, so the diagram shows which way change propagates.',
      'Draw two clients in a sequence diagram — the contention is the point, and the loser\'s arrow is the answer.',
      'Annotate what advances time, and prefer a stored deadline to a timer.',
      'The state diagram has the highest return: it is the only one that catches an unenumerated illegal state.',
      'Its absent transitions are the decisions — and drawing it is how you notice you made them.',
      'Put guards on transitions; a transition without its guard is half a decision.',
      'Use parallel regions when several lifecycles advance independently.',
      'An interview diagram is a sketch, not a blueprint — completeness harms it.',
      'Learn four words: composition, association, multiplicity, dependency direction.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Three diagram types, each answering one question — a class sketch for ownership and dependency direction, a sequence diagram for ordering and contention, a state diagram for legal transitions — drawn with about six symbols and narrated as they are drawn.',
    whyItExists:
      'Because a diagram in an interview is a message to one reader with a ten-minute lifetime, so completeness is pure cost and selectivity is the signal. And because the wrong diagram type answers the question no matter how carefully it is drawn.',
    whenToUse: [
      'A class sketch when ownership or dependency direction is contested.',
      'A sequence diagram whenever the question involves order, timing or two parties competing.',
      'A state diagram for any problem with a hold, a booking, a lifecycle or an expiry.',
      'Parallel regions when several lifecycles advance independently.',
      'No diagram when three classes have obvious ownership, or when behind on time.',
    ],
    whenNotToUse: [
      'A class diagram for a question about ordering.',
      'Full fields, signatures, visibility markers, getters or package boxes.',
      'A happy-path-only sequence diagram in a contention question.',
      'One flat state machine for several concurrent lifecycles.',
      'Drawing silently.',
      'Deliberating over aggregation versus composition notation.',
    ],
    alternatives: [
      'A four-line ASCII comment block at the top of the file, in a shared-editor interview.',
      'A written transition list instead of a state picture — guards are text anyway, and the omissions can be recorded.',
      'A numbered step list instead of lifelines, for a two-participant flow.',
      'Two sentences instead of a class sketch, when ownership is obvious.',
      'Asking directly for feedback, when the medium makes the interruption test unreadable.',
    ],
    tradeoffs: [
      'A complete diagram buys documentation value and costs ten minutes of implementation time.',
      'A three-box sketch buys selectivity as a signal and costs some redrawing when pushed.',
      'A sequence diagram buys ordering and contention and cannot show ownership.',
      'A state diagram buys the absences as decisions and says nothing about structure.',
      'Parallel regions buy representable concurrency and cost an explicit interaction list.',
      'No diagram buys implementation time and risks a misunderstanding a ten-second sketch would prevent.',
    ],
    failureModes: [
      'Twelve minutes of class diagram while the interviewer asks about ordering twice.',
      'Nine boxes when three carry the decision.',
      'Full signatures and visibility markers nobody disputes.',
      'A happy-path sequence in a contention question.',
      'A boolean flag where a held-but-unpaid state belongs.',
      'A flat state machine that omits legal combinations.',
      'Drawing silently and reading the silence as approval.',
      'A well-received class sketch treated as covering the ordering risk.',
      'Eight boxes in an ASCII comment, which becomes unreadable.',
      'Silent typing in a remote round — the equivalent of drawing silently.',
    ],
    followUpQuestions: [
      'What question has the interviewer just asked — ownership, ordering, or states?',
      'Is the interviewer interrupting, or am I drawing for myself?',
      'Which of these boxes is contestable?',
      'Does this diagram show which way dependencies point?',
      'Have I drawn the loser\'s arrow?',
      'What advances time in this flow, and is it a stored deadline?',
      'Which transitions am I deliberately not drawing, and what does each absence decide?',
      'Does every transition have its guard?',
      'Are several lifecycles running at once here?',
      'What is this diagram structurally incapable of expressing?',
      'With three minutes, which one do I draw?',
    ],
  },
});
