import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-solid',
  title: 'SOLID in practice — and when it misleads',
  summary:
    'Each of the five principles names a real failure mode and has an over-application that is its own failure mode. Knowing both, and knowing that the principles conflict with each other, is what turns recitation into judgment.',
  phase: 'lld',
  module: 'oo-foundations',
  position: 57,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['solid', 'over-application', 'contracts', 'dependency-direction'],
  prerequisites: ['l-object-design'],
  resources: [
    {
      key: 'solid-uncle-bob',
      tier: 'must',
      note: 'The primary statement of the five principles. Read it for the original wording, which is more careful than the versions that circulate — the open-closed principle in particular is usually quoted in a stronger form than it was stated.',
    },
    {
      key: 'refactoring-guru-solid',
      tier: 'must',
      note: 'Read it for the worked examples of each violation. The examples are more useful than the definitions, because the smell is what you will recognise under interview pressure.',
    },
    {
      key: 'clean-architecture-blog',
      tier: 'good',
      note: 'Read it for dependency inversion as an argument about which way arrows point, rather than as a rule about injecting interfaces. That framing is what makes the principle arguable.',
    },
    {
      key: 'refactoring-guru-patterns',
      tier: 'good',
      note: 'Read the strategy and template-method entries. Open-closed is almost always achieved through one of them, and seeing the mechanism stops the principle being abstract.',
    },
    {
      key: 'kent-beck-tdd',
      tier: 'advanced',
      note: 'Read it for how tests reveal a contract. Substitutability violations show up first as a test that passes for the base type and fails for a subtype, which is the cheapest way to find them.',
    },
  ],

  intuition: {
    body: `SOLID is usually taught as five rules to follow, and taught that way it makes designs worse. **Each principle is better understood as the name of a failure mode** — a specific way that code becomes expensive to change — **and each has an over-application that is its own failure mode.**

\`\`\`
S  god class, edited by four teams  ·  a swarm of one-method
                                       classes that all change together
O  a switch edited for every case   ·  interfaces for variation
                                       nobody asked for
L  a subtype that breaks callers    ·  hierarchies avoided entirely
                                       where they were correct
I  a fat interface forcing stubs    ·  six dependencies to do one thing
D  policy depending on mechanism    ·  a container and three layers
                                       for two hundred lines
\`\`\`

**The left column is what the principle warns you about. The right column is what following it too hard produces.** Both are real, and only one of them is taught.

**And the principles conflict with each other**, which the rule-following framing hides entirely. Single responsibility and interface segregation both push you to split things up. **Cohesion and dependency inversion push you to keep related things together and to depend on few abstractions.** So "apply all five" is not a coherent instruction — **they are five pressures, and design is where they balance.**

Which gives the way to use them that actually holds up in an interview: **not as a construction method but as a diagnostic on a design you already have.**

\`\`\`
Design first, from behaviour.
Then: "which of these five smells does my design have?"
\`\`\`

**Because used as a construction method, SOLID produces exactly the design an interviewer describes as over-engineered** — an interface per class, a factory per interface, and a diagram in which the actual logic is hard to find.

**The single most useful thing to be able to say is the cost of a principle**, out loud, at the moment you apply it. "I am inverting this dependency, which costs an interface and a wiring step, and it buys me the ability to change storage without touching the pricing rules." **That sentence is judgment. "I am following dependency inversion" is recitation**, and the difference is what the question is testing.

**One more framing worth carrying:** four of the five are about **managing change** — where edits land, which direction dependencies point, how much a caller is exposed to. **Only substitutability is about correctness.** A design that violates the other four is expensive; a design that violates substitutability is wrong.`,
    analogyLimit:
      'Treating SOLID as a checklist is appealing: the principles are memorable and the violations are easy to spot in someone else\'s code. What it loses is that every principle has a price paid up front for a benefit contingent on the predicted change, and that the principles pull against each other — so a design can satisfy all five in letter and be worse than one deliberately violating two. It also flattens the real split: four are about the cost of change, one is about being correct.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate is asked to design a notification sender. They produce: `INotificationSender` with one implementation; `INotificationFormatter` with one implementation; `INotificationRepository` with one implementation; a `NotificationSenderFactory`; and a `NotificationService` that takes all three interfaces in its constructor. They say this satisfies SOLID. Which principles does it actually satisfy, which does it violate, and what has it cost?',
      answer: `**Start with what it genuinely achieves, because the answer is: less than it looks.**

**Dependency inversion — partly, and accidentally.** \`NotificationService\` depends on abstractions rather than concrete classes, so **the arrows point the right way.** That much is real.

**But dependency inversion is about depending on abstractions that are stable**, and an interface with one implementation, defined alongside that implementation, **is not an abstraction — it is a copy of a class signature.** It changes whenever the implementation changes, so the dependency was not inverted in any useful sense: **the service still effectively depends on the concrete details, now with an extra file.**

**Open-closed — no, and this is the important misdiagnosis.** The principle is about being able to add behaviour without modifying existing code. **An interface does not achieve that; a second implementation would.** With one implementation each, there is nothing to be open to — **so the structure is in place and the property is absent.**

*And the cost of getting this wrong is that the axis is often chosen incorrectly.* The candidate abstracted sending, formatting and storage. **If the change that actually arrives is "notifications must be batched", none of those three seams helps** — batching cuts across all of them, and the design must be modified anyway.

**Single responsibility — unclear, and probably violated.** \`NotificationService\` orchestrates all three collaborators, so **it is edited whenever the composition changes, whenever a new notification kind appears, and whenever the flow changes.** Splitting collaborators out does not reduce the orchestrator's reasons to change; **it relocates the mechanisms while leaving all the decisions in one place.**

**Interface segregation — vacuously satisfied.** The interfaces are small because each has one implementation with few methods. **That is not segregation; segregation is about not forcing a caller to depend on methods it does not use**, and there was never a fat interface to split.

**Substitutability — untestable.** With one implementation per interface, **there is no substitution to get wrong.** The principle is neither satisfied nor violated; it simply does not apply yet — **which is worth saying, because claiming it is satisfied is claiming something meaningless.**

**So: one principle partly and accidentally, one misdiagnosed, one probably violated, two not applicable. What did it cost?**

\`\`\`
4 extra types (3 interfaces + 1 factory)
+ a constructor with 3 parameters
+ a wiring site that must know all 4 concrete classes
+ a diagram where the logic is 1 of 8 boxes
\`\`\`

**And a harder cost: the design now resists the change it will actually get.** Every seam is a commitment about where variation will appear. **Four wrong commitments are worse than none**, because each one has to be unwound — and unwinding an abstraction is more work than adding one.

**What a better answer looks like.**

\`\`\`
Behaviour first: "send a notification to a user by some channel"
  → the channel is the only thing the prompt says varies
  → ONE seam: Channel { send(message): Result }
  → formatting belongs to the channel (an SMS formats
    differently from an email — it is not a separate axis)
  → storage: one concrete store until something says otherwise
\`\`\`

**One interface, two concrete classes, no factory.** And the sentence that goes with it: **"the channel is the axis the prompt named, so that is where the interface goes; I have not abstracted storage because nothing suggests it varies, and I would add it when there is a second store or a test I cannot otherwise write."**

**The diagnostic that would have caught this before the interviewer did:** for each interface, name the second implementation. **If you cannot name it, the seam is speculative** — and the question "what is the second implementation?" is the one an interviewer will ask.`,
    },
  body: `## Single responsibility: one reason to change

**The real failure mode is a class that four different concerns all edit.** It becomes the most depended-on class in the design and also the least stable, **so a change made for one reason risks breaking three others.** That combination is what makes a god class expensive — not its size.

**The test is to list the reasons it might be edited**, and check whether they come from different people or different concerns. Rate changes, layout rules and record formats are three reasons, however coherently you can name the class that holds all three.

**The over-application is splitting by mechanism instead of by reason.**

\`\`\`
LoanValidator · LoanPeriodCalculator · LoanLimitChecker
  → three classes, all edited whenever a membership tier
    is redefined
  → so they had ONE reason to change, split three ways
\`\`\`

**Now the reader has to assemble the rule from three files**, and the relationships between them are invisible. **A swarm of one-method classes that always change together is not better than the god class** — it is the same responsibility with worse legibility.

**The check that distinguishes them: do these classes appear together in every commit?** If yes, they are one responsibility. **That is a question about history, which is why the principle is easier to apply to existing code than to a blank page.**

## Open-closed: the retroactive principle

**The real failure mode is a switch that grows.** Every new case edits the same method, so **every addition is a modification, and the method accumulates conditions nobody can safely remove.**

**The over-application is pre-abstracting every axis that might vary** — which is speculative generality, and the cost is paid immediately while the benefit arrives only if you guessed right.

**And the resolution is a timing rule rather than a compromise: open-closed is usually achieved retroactively.**

\`\`\`
First case:   write it directly. No abstraction.
Second case:  NOW the axis is known — refactor to a seam,
              and both cases become implementations.
Third case:   an addition. The principle is now paying.
\`\`\`

**You cannot know which axis will vary until something varies**, so the honest sequence is to wait for the second case and refactor then. **The abstraction you extract from two real cases is almost always better than the one you imagine from none.**

**With one exception, and it is the one that matters in interviews: when the requirement names the axis.** "Pricing should be configurable" is the second case arriving in advance — **the variation is stated, so the seam is justified before the code exists.**

*Which gives a clean rule for an interview:* **abstract the axes the prompt names, write everything else directly, and say that you would refactor to a seam when a second case appears.** That answer is defensible in both directions — it is neither rigid nor speculative.

## Liskov substitution: the one about correctness

**The other four principles are about the cost of change. This one is about being wrong.**

**The real failure mode is a subtype that breaks a caller written against the base type**, which means the caller must know what it is holding — defeating the entire purpose of the hierarchy.

\`\`\`ts
class Rectangle { setWidth(w) ; setHeight(h) ; area() }
class Square extends Rectangle {
  setWidth(w)  { this.w = this.h = w }   // keeps the invariant
  setHeight(h) { this.w = this.h = h }   // and breaks the CALLER
}

// A caller written against Rectangle:
function grow(r: Rectangle) {
  r.setWidth(4); r.setHeight(5);
  return r.area();     // expects 20; a Square gives 25
}
\`\`\`

**The subclass is internally consistent and it violated a promise the base type made** — that width and height are independent. **A square is a rectangle in geometry and not a subtype of a mutable rectangle in code**, because subtyping is about substitutable behaviour rather than about categories.

**The three rules that make it checkable:**

\`\`\`
Preconditions  may be WEAKENED, never strengthened
               (a subtype may accept more, never less)
Postconditions may be STRENGTHENED, never weakened
               (a subtype may promise more, never less)
Invariants     of the base type must be preserved
\`\`\`

**So the common violations have names.** A subtype that throws on a method the base supports has strengthened a precondition to "never call this". **A subtype that returns null where the base promised a value has weakened a postcondition.** A read-only collection inheriting from a mutable one strengthens every mutator's precondition to false — **which is why the standard libraries that made that choice are the standard example.**

**And the practical detector is a test.** Write the test against the base type and run it for every subtype: **a substitutability violation is a test that passes for one implementation and fails for another**, with no change to the test.

*The over-application is rarer and does exist:* **avoiding inheritance entirely, including where the relationship is genuinely substitutable.** Implementing an interface is inheritance of a contract, and it is the safe case — **the principle is a constraint on hierarchies, not an argument against them.**

## Interface segregation: whose problem is it?

**The real failure mode is an interface so wide that implementers must stub methods they cannot support.**

\`\`\`ts
interface Device {
  read() ; write() ; seek() ; flush() ; close()
}
class ReadOnlyStream implements Device {
  write() { throw new Error('not supported') }   // ← the smell
  seek()  { throw new Error('not supported') }
}
\`\`\`

**And notice what those stubs are: substitutability violations.** A fat interface forces implementers to break the contract, **so interface segregation exists partly to make substitutability achievable** — which is one of the places the principles support rather than fight each other.

**The second half is usually forgotten: it is also about the caller.** A caller that depends on a five-method interface to use one method is coupled to four methods it does not care about — **so a change to any of them affects it.**

**The over-application is a one-method interface for everything**, which pushes the problem to the call site:

\`\`\`
A component needing six capabilities now takes six
constructor parameters, each an interface with one
implementation.
→ the coupling did not decrease; it got harder to see
\`\`\`

**The balance point is role interfaces.** Split by what a caller wants to do, not by method count: **\`Readable\` and \`Writable\` rather than five single-method interfaces**, because "reading" is a role a caller has and "seeking" on its own is not.

## Dependency inversion: which way do the arrows point?

**The real failure mode is policy depending on mechanism.** Put fee calculation in a class that reads rates from a database, and **a change to how rates are stored forces a change to a business rule** — the expensive direction, because business rules are what you least want to disturb for technical reasons.

**The principle is about direction: depend on things that change less often than you do.** Which is why the useful question is not "did I inject an interface" but **"if the mechanism changes, does the policy have to change?"**

**The over-application has two forms, and both are common.**

**An interface per class, defined next to its only implementation.** That is not an abstraction — **it changes whenever the implementation changes**, so nothing was inverted. The test: **can you name a second implementation?** If not, the interface is a copy of a signature.

**A dependency-injection container for a program that has one wiring path.** The container buys configurability nobody asked for and costs a layer of indirection at every construction site. **Passing constructor arguments is dependency injection**; a framework is an optimisation for a problem you may not have.

*And the honest statement of the cost:* every inversion adds a type, a wiring site, and a jump for the reader. **Worth it at a real boundary and not worth it inside a cohesive unit** — which is the judgment the principle cannot make for you.

## Using them as diagnostics

**The sequence that holds up under pressure:**

**Design from behaviour first** — verbs, information needs, owners. **SOLID is not a way to find objects.**

**Then run the five as questions on what you have:**

\`\`\`
Why might this class be edited, and by whom?          (S)
Which axis does the prompt say will vary?             (O)
Does any subtype surprise a caller?                   (L)
Is any implementer stubbing methods it cannot do?     (I)
Does a business rule depend on a technical detail?    (D)
\`\`\`

**And when you apply one, say its cost.** "This costs an interface and a wiring step, and it buys X" is the sentence that separates judgment from recitation.

**Finally, be ready to say which principle you are deliberately violating.** A 50-minute design that satisfies all five in letter is usually worse than one that violates two on purpose — **and naming the violation, with the reason, is a stronger signal than a clean checklist.**`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'both-directions',
      title: 'Each principle, and the failure on both sides of it',
      caption:
        'Read each row left to right. The left column is what the principle warns you about; the right column is what following it too hard produces — and only one of those two is usually taught.',
      code: `flowchart LR
    subgraph UNDER["**Under-applied** — the failure the principle names"]
      direction TB
      U1["**S** · one class edited<br/>by four teams: most<br/>depended on, least stable"]
      U2["**O** · a switch edited<br/>for every new case"]
      U3["**L** · a subtype that<br/>breaks callers written<br/>against the base"]
      U4["**I** · a fat interface<br/>forcing 'not supported'<br/>stubs"]
      U5["**D** · a business rule<br/>that changes when<br/>storage changes"]
    end

    subgraph OVER["**Over-applied** — its own failure mode"]
      direction TB
      O1["**S** · one-method classes<br/>that appear in every<br/>commit together"]
      O2["**O** · seams for variation<br/>nobody asked for, on<br/>the wrong axes"]
      O3["**L** · inheritance avoided<br/>where it was genuinely<br/>substitutable"]
      O4["**I** · six constructor<br/>parameters to do<br/>one thing"]
      O5["**D** · an interface per class<br/>plus a container, for<br/>one wiring path"]
    end

    U1 --- O1
    U2 --- O2
    U3 --- O3
    U4 --- O4
    U5 --- O5

    N["**And they conflict:**<br/>S and I push you to split.<br/>Cohesion and D push you<br/>to keep things together.<br/>'Apply all five' is not<br/>an instruction."]
    C["**Only L is about<br/>correctness.**<br/>The other four are about<br/>the cost of change — so<br/>violating them is expensive,<br/>violating L is wrong."]

    O3 -.-> C
    O5 -.-> N

    style U3 fill:#40181c,stroke:#b4535e
    style C fill:#40181c,stroke:#b4535e
    style N fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'diagnostic',
      title: 'SOLID as a diagnostic, not a construction method',
      caption:
        'Step through it. The principles run after the design exists — used as a construction method they produce exactly the design an interviewer calls over-engineered.',
      nodes: [
        { id: 'behaviour', label: 'Design from behaviour first', kind: 'note', x: 0, y: 140, detail: 'Verbs, information needs, owners. SOLID is not a way to find objects — it has nothing to say about where behaviour belongs, only about the shape of what you already have.' },
        { id: 'design', label: 'A design exists', kind: 'service', x: 230, y: 140, detail: 'Concrete classes, behaviour with its data, and interfaces only where the prompt named an axis of variation.' },
        { id: 'questions', label: 'Run five questions over it', kind: 'note', x: 450, y: 140, detail: 'Why might this be edited and by whom? (S) Which axis does the prompt say varies? (O) Does any subtype surprise a caller? (L) Is anyone stubbing methods they cannot support? (I) Does a business rule depend on a technical detail? (D)' },
        { id: 'cost', label: 'State the cost when you apply one', kind: 'note', x: 700, y: 50, detail: '"This costs an interface and a wiring step, and it buys the ability to change storage without touching the pricing rules." That sentence is judgment; "I am following dependency inversion" is recitation.' },
        { id: 'violate', label: 'Name what you are violating on purpose', kind: 'note', x: 700, y: 180, detail: 'A 50-minute design satisfying all five in letter is usually worse than one violating two deliberately. Naming the violation with its reason is a stronger signal than a clean checklist.' },
        { id: 'second', label: 'For each interface: name the second implementation', kind: 'note', x: 700, y: 310, detail: 'If you cannot name it, the seam is speculative — and the interviewer is going to ask. An interface with one implementation defined beside it is a copy of a signature, not an abstraction: it changes whenever the implementation changes, so nothing was inverted.' },
      ],
      edges: [
        { id: 's1', source: 'behaviour', target: 'design', kind: 'control' },
        { id: 's2', source: 'design', target: 'questions', kind: 'control' },
        { id: 's3', source: 'questions', target: 'cost', kind: 'control' },
        { id: 's4', source: 'questions', target: 'violate', kind: 'control' },
        { id: 's5', source: 'questions', target: 'second', kind: 'control' },
      ],
      steps: [
        {
          id: 'ss1',
          title: 'The principles do not find objects',
          description:
            'Behaviour does. SOLID has nothing to say about where a responsibility belongs — only about whether the arrangement you chose will be expensive to change.',
          nodes: ['behaviour', 'design'],
          edges: ['s1'],
        },
        {
          id: 'ss2',
          title: 'Then use them as questions, not rules',
          description:
            'Five diagnostics over an existing design. Used forward as a construction method they produce an interface per class and a factory per interface.',
          nodes: ['questions'],
          edges: ['s2'],
        },
        {
          id: 'ss3',
          title: 'Price every principle you apply',
          description:
            'Each one costs types, wiring and reader jumps, paid up front, for a benefit that arrives only if the predicted change happens. Saying the price out loud is the whole signal.',
          nodes: ['cost'],
          edges: ['s3'],
        },
        {
          id: 'ss4',
          title: 'And say which one you are breaking',
          description:
            'They conflict — S and I push to split, cohesion and D push to consolidate — so a design cannot maximise all five. Choosing, and saying so, is the judgment being assessed.',
          nodes: ['violate'],
          edges: ['s4'],
        },
        {
          id: 'ss5',
          title: 'The test that catches speculative seams',
          description:
            'Name the second implementation. One implementation means the interface tracks its own implementation\'s changes, which is not an inverted dependency — it is an extra file.',
          nodes: ['second'],
          edges: ['s5'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The original statements of the principles are more careful than the versions that circulate, and two differences are worth knowing because interviewers sometimes quote the original.

**Open-closed was stated as a property of a module, not as an instruction to add interfaces.** The published formulation is that a module should be open for extension and closed for modification — **a description of a desirable state, not a method for reaching it.** Which is exactly why the retroactive reading is faithful rather than a weakening: **you can reach that state by refactoring when the second case arrives**, and the original does not say otherwise.

**Dependency inversion was stated as being about the direction of source-code dependencies**, with the observation that high-level policy should not depend on low-level detail. **The phrase "depend on abstractions" is a consequence rather than the principle** — and reading it as the principle is what produces an interface per class, because an interface satisfies the letter while leaving the direction unchanged.

**Three things to take from the original wording.**

**A principle describing a state can be satisfied later.** Open-closed does not demand anticipation, so **waiting for the second case and then refactoring is a legitimate way to satisfy it** — and saying so defuses the "but you did not make it extensible" challenge.

**Dependency inversion is falsifiable when read as direction.** "If the mechanism changes, must the policy change?" has an answer. **"Did you inject an interface?" does not test anything**, which is why the second question produces bad designs that pass review.

**And the principles were written about codebases that live for years.** The benefit of an inversion accrues over many changes; **an interview design lives for fifty minutes**, so the cost-benefit is genuinely different and it is fair to say so.

**Where the published material does not help.** It argues each principle in isolation and says little about the conflicts between them. **The tension between splitting for single responsibility and consolidating for cohesion is real and unresolved in the source material**, so the balancing judgment is yours to defend — which is precisely what an interviewer is probing when they ask whether a design is over-engineered.`,
  },

  tradeoffs: {
    intro:
      'Each principle, its violation, its over-application, and what the middle position costs.',
    rows: [
      {
        option: 'One class holding several concerns',
        whenItWins:
          'Small scripts, and genuinely cohesive units where the concerns change together anyway.',
        whenItLoses:
          'When separate stakeholders edit it — it becomes the most depended-on and least stable class at once.',
        cost:
          'A change for one reason risking three unrelated breakages.',
      },
      {
        option: 'Splitting by reason to change',
        whenItWins:
          'Whenever you can name distinct stakeholders or concerns for the edits.',
        whenItLoses:
          'Applied by mechanism, it yields classes that appear together in every commit.',
        cost:
          'More files, and relationships that must be made visible.',
      },
      {
        option: 'A switch that grows with each new case',
        whenItWins:
          'The first case, and often the second — it is the clearest code until the axis is known.',
        whenItLoses:
          'Once cases keep arriving, every addition is a modification of shared code.',
        cost:
          'Accumulated conditions nobody can safely remove.',
      },
      {
        option: 'Pre-abstracting every axis that might vary',
        whenItWins:
          'Nowhere on its own. It looks like foresight.',
        whenItLoses:
          'The cost is immediate and the benefit is contingent on guessing the axis right — and four wrong seams are worse than none.',
        cost:
          'Types, wiring, and abstractions that must be unwound.',
      },
      {
        option: 'Refactor to a seam on the second case; abstract named axes up front',
        whenItWins:
          'Always. Two real cases produce a better abstraction than one imagined case, and a stated requirement is the second case arriving early.',
        whenItLoses:
          'A refactor is required when the second case appears, which costs time you may not have.',
        cost:
          'One refactor, in exchange for not guessing.',
      },
      {
        option: 'A subtype that throws on an inherited method',
        whenItWins:
          'Nowhere. It is a strengthened precondition.',
        whenItLoses:
          'Callers written against the base must know what they hold, which defeats the hierarchy.',
        cost:
          'Correctness, not just maintainability.',
      },
      {
        option: 'Avoiding inheritance entirely',
        whenItWins:
          'Most of the time, because most variation is multi-axis.',
        whenItLoses:
          'Where the relationship is genuinely substitutable and the base carries no state — which is essentially an interface.',
        cost:
          'Occasionally reimplementing something a contract would have given you.',
      },
      {
        option: 'A wide interface covering every capability',
        whenItWins:
          'When every implementer genuinely supports everything.',
        whenItLoses:
          'It forces stubs, which are substitutability violations, and couples callers to methods they do not use.',
        cost:
          'Implementers that lie about what they support.',
      },
      {
        option: 'A one-method interface per capability',
        whenItWins:
          'When a caller genuinely needs exactly one behaviour.',
        whenItLoses:
          'A component needing six capabilities takes six parameters, so coupling is relocated rather than reduced.',
        cost:
          'Call sites that are harder to read than the fat interface was.',
      },
      {
        option: 'Role interfaces, split by what a caller does',
        whenItWins:
          'The balance point. Readable and Writable rather than five single-method interfaces.',
        whenItLoses:
          'Roles must be identified, which requires knowing your callers.',
        cost:
          'A judgment call about what constitutes a role.',
      },
      {
        option: 'Policy depending on mechanism',
        whenItWins:
          'Small programs where the mechanism will not change.',
        whenItLoses:
          'A storage change forces a business-rule change — the expensive direction.',
        cost:
          'Technical churn reaching the rules you least want disturbed.',
      },
      {
        option: 'An interface per class, plus a container',
        whenItWins:
          'Nowhere at this scale. It satisfies the letter of inversion.',
        whenItLoses:
          'An interface with one implementation tracks that implementation, so the direction is unchanged — and a container configures one wiring path.',
        cost:
          'Indirection at every construction site, with no inversion achieved.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"This design follows SOLID — every dependency is an interface and each class has a single responsibility."',
      whyWeak:
        'It claims the letter of the principles without their properties. An interface with one implementation, defined beside it, changes whenever that implementation changes — so no dependency was inverted and nothing is open to extension. And "single responsibility" asserted rather than tested says nothing.',
      strongAnswer:
        '"Let me say which properties I actually have. The channel interface has two implementations, so that part is genuinely open to extension. Storage is one concrete class — I have not abstracted it, because nothing in the prompt suggests it varies and an interface with one implementation is a copy of a signature rather than an abstraction. And for single responsibility I would name the reasons this class gets edited: if they come from one concern, it is fine; if I can name three stakeholders, it is not."',
    },
    {
      weakAnswer: '"Open-closed means I should add an interface wherever behaviour might change in future."',
      whyWeak:
        'It reads a description of a desirable state as an instruction to anticipate. The cost of a seam is immediate and the benefit depends entirely on guessing the axis correctly — and a wrong seam is worse than none, because it has to be unwound.',
      strongAnswer:
        '"Open-closed is usually achieved retroactively. I write the first case directly; when the second arrives the axis is known, and I refactor both into implementations of a seam — an abstraction extracted from two real cases beats one imagined from none. The exception is when the requirement names the axis: \'pricing should be configurable\' is the second case arriving in advance, so that seam is justified before the code exists."',
    },
    {
      weakAnswer: '"Square extends Rectangle, and it overrides the setters to keep width and height equal."',
      whyWeak:
        'The subclass preserves its own invariant and breaks a promise the base type made — that width and height are independent. Any caller written against Rectangle now gets a different answer depending on what it actually holds, which defeats the purpose of the hierarchy.',
      strongAnswer:
        '"That violates substitutability, and it is the one SOLID principle about correctness rather than cost. The checkable form is: preconditions may be weakened but never strengthened, postconditions strengthened but never weakened, and base-type invariants preserved. A square is a rectangle in geometry and not a subtype of a mutable rectangle in code. I would detect this with a test written against the base type and run for every subtype — a substitutability violation is a test that passes for one implementation and fails for another with no change to the test."',
    },
    {
      weakAnswer: '"Interface segregation means interfaces should be small, so I give each one a single method."',
      whyWeak:
        'It optimises method count rather than coupling. A component needing six capabilities now takes six constructor parameters, each an interface with one implementation — the coupling did not decrease, it just became harder to see at the call site.',
      strongAnswer:
        '"It is about not forcing implementers to stub methods they cannot support, and not forcing callers to depend on methods they do not use. So I split by role: Readable and Writable rather than five single-method interfaces, because reading is a role a caller has and seeking alone is not. And the stubs matter for a second reason — a \'not supported\' throw is a strengthened precondition, so a fat interface makes substitutability violations unavoidable."',
    },
    {
      weakAnswer: '"I have added a dependency-injection container so the design is loosely coupled."',
      whyWeak:
        'A container configures wiring, and this program has one wiring path. It buys configurability nobody asked for while adding indirection at every construction site — and passing constructor arguments is already dependency injection.',
      strongAnswer:
        '"Constructor parameters are dependency injection; a container is an optimisation for having many wiring paths, which I do not have. And the principle is about direction rather than mechanism: the question is whether a change to storage forces a change to a pricing rule. That question has an answer, whereas \'did you inject an interface\' tests nothing — which is why it produces designs that pass review and are still coupled the wrong way."',
    },
    {
      weakAnswer: '"I applied all five principles throughout, so the design is sound."',
      whyWeak:
        'The principles pull against each other: single responsibility and interface segregation push toward splitting, while cohesion and dependency inversion push toward keeping related things together and depending on few abstractions. "Apply all five" is not a coherent instruction, and a design that satisfies all five in letter is often worse than one that breaks two deliberately.',
      strongAnswer:
        '"They conflict, so I balanced them rather than maximising each. I am deliberately keeping allocation and pricing in one policy object even though they are arguably two responsibilities, because they always change together — splitting them would satisfy the letter and make the rule harder to read. And I use the principles as diagnostics on a design I already have rather than as a construction method, because forward-applied they produce an interface per class and a factory per interface."',
    },
  ],

  flashcards: [
    {
      id: 'fc-sol-1',
      front: 'What is each SOLID principle better understood as?',
      back: 'The name of a failure mode — a specific way code becomes expensive to change — each with an over-application that is its own failure mode.',
      topic: 'solid',
    },
    {
      id: 'fc-sol-2',
      front: 'Which SOLID principle is about correctness rather than cost?',
      back: 'Liskov substitution. Violating the other four is expensive; violating substitutability is wrong.',
      topic: 'contracts',
    },
    {
      id: 'fc-sol-3',
      front: 'How do the principles conflict?',
      back: 'Single responsibility and interface segregation push toward splitting; cohesion and dependency inversion push toward consolidating. "Apply all five" is not an instruction.',
      topic: 'over-application',
    },
    {
      id: 'fc-sol-4',
      front: 'What is the over-application of single responsibility?',
      back: 'Splitting by mechanism rather than by reason to change — a swarm of one-method classes that appear together in every commit.',
      topic: 'solid',
    },
    {
      id: 'fc-sol-5',
      front: 'Why is open-closed usually achieved retroactively?',
      back: 'You cannot know which axis varies until something varies. An abstraction extracted from two real cases beats one imagined from none.',
      topic: 'solid',
    },
    {
      id: 'fc-sol-6',
      front: 'What is the exception to waiting for the second case?',
      back: 'When the requirement names the axis — "pricing should be configurable" is the second case arriving in advance.',
      topic: 'solid',
    },
    {
      id: 'fc-sol-7',
      front: 'State the three substitutability rules.',
      back: 'Preconditions may be weakened, never strengthened; postconditions strengthened, never weakened; base-type invariants preserved.',
      topic: 'contracts',
    },
    {
      id: 'fc-sol-8',
      front: 'Why is Square extends Rectangle the standard violation?',
      back: 'The subclass preserves its own invariant and breaks the base\'s promise that width and height are independent, so callers get different answers depending on what they hold.',
      topic: 'contracts',
    },
    {
      id: 'fc-sol-9',
      front: 'How do you detect a substitutability violation cheaply?',
      back: 'A test written against the base type and run for every subtype — the violation is a test that passes for one implementation and fails for another, unchanged.',
      topic: 'contracts',
    },
    {
      id: 'fc-sol-10',
      front: 'What does a "not supported" stub actually indicate?',
      back: 'A strengthened precondition — so a fat interface forces substitutability violations, which is why interface segregation helps substitutability.',
      topic: 'contracts',
    },
    {
      id: 'fc-sol-11',
      front: 'What is the over-application of interface segregation?',
      back: 'One-method interfaces everywhere, so a component needing six capabilities takes six parameters. Coupling was relocated, not reduced.',
      topic: 'over-application',
    },
    {
      id: 'fc-sol-12',
      front: 'What is the falsifiable form of dependency inversion?',
      back: '"If the mechanism changes, must the policy change?" — not "did I inject an interface", which tests nothing.',
      topic: 'dependency-direction',
    },
    {
      id: 'fc-sol-13',
      front: 'Why is an interface with one implementation not an abstraction?',
      back: 'It changes whenever that implementation changes, so the dependency direction is unchanged — it is a copy of a signature plus a file.',
      topic: 'dependency-direction',
    },
    {
      id: 'fc-sol-14',
      front: 'What sentence turns recitation into judgment?',
      back: 'Naming the cost as you apply a principle: "this costs an interface and a wiring step, and it buys the ability to change X without touching Y."',
      topic: 'over-application',
    },
  ],

  quiz: [
    {
      id: 'q-sol-1',
      kind: 'scenario',
      prompt:
        'A design has three interfaces, each with exactly one implementation defined beside it. Which principle does this satisfy?',
      options: [
        { id: 'a', label: 'None meaningfully — an interface that changes whenever its only implementation changes leaves the dependency direction unchanged' },
        { id: 'b', label: 'Dependency inversion, since the consumer depends on abstractions' },
        { id: 'c', label: 'Open-closed, since new implementations can be added' },
        { id: 'd', label: 'Interface segregation, since the interfaces are small' },
      ],
      correct: ['a'],
      explanation:
        'Each of the other three claims the letter without the property. Inversion is about direction, and an interface tracking its sole implementation inverts nothing. Open-closed is a property you have when a second implementation can be added without modification — the structure alone does not confer it. And small-by-accident is not segregation, which is about not forcing callers or implementers to depend on what they do not use.',
      difficulty: 'core',
      topic: 'dependency-direction',
    },
    {
      id: 'q-sol-2',
      kind: 'scenario',
      prompt:
        '`ReadOnlyStream implements Device` and throws "not supported" from `write()` and `seek()`. Which principles are involved?',
      options: [
        { id: 'a', label: 'Interface segregation (a fat interface) and substitutability (the throws are strengthened preconditions)' },
        { id: 'b', label: 'Only interface segregation' },
        { id: 'c', label: 'Only single responsibility' },
        { id: 'd', label: 'None — throwing for unsupported operations is normal' },
      ],
      correct: ['a'],
      explanation:
        'Both, and the link between them is the useful part: a wide interface forces implementers to stub, and a stub that throws strengthens a precondition to "never call this" — which breaks any caller written against the interface. Segregating by role makes substitutability achievable rather than merely tidier.',
      difficulty: 'advanced',
      topic: 'contracts',
    },
    {
      id: 'q-sol-3',
      kind: 'scenario',
      prompt:
        'You are writing the first pricing rule. Nothing in the prompt says pricing varies. What should you do?',
      options: [
        { id: 'a', label: 'Write it directly, and refactor to a seam when a second rule arrives' },
        { id: 'b', label: 'Add a PricingPolicy interface now, to satisfy open-closed' },
        { id: 'c', label: 'Add the interface and a factory, so the wiring is ready' },
        { id: 'd', label: 'Write it directly and never abstract it, since abstractions are speculative' },
      ],
      correct: ['a'],
      explanation:
        'Open-closed describes a state you can reach later, and an abstraction extracted from two real cases is better than one imagined from none. Option d overcorrects: the second case is exactly when the seam becomes justified. Had the prompt said pricing was configurable, option b would be right — a stated requirement is the second case arriving in advance.',
      difficulty: 'core',
      topic: 'solid',
    },
    {
      id: 'q-sol-4',
      kind: 'scenario',
      prompt:
        'Three classes — LoanValidator, LoanPeriodCalculator, LoanLimitChecker — all change whenever a membership tier is redefined. What does that tell you?',
      options: [
        { id: 'a', label: 'They were one responsibility split by mechanism — the split satisfies the letter of the principle and makes the rule harder to read' },
        { id: 'b', label: 'The design correctly applies single responsibility' },
        { id: 'c', label: 'They should be merged into the service that uses them' },
        { id: 'd', label: 'Nothing — classes changing together is normal' },
      ],
      correct: ['a'],
      explanation:
        'Appearing together in every commit is the practical test for one reason to change. Option c overcorrects in the other direction — merging into the orchestrator recreates the god class; the fix is one tier-policy object. Note this test is about history, which is why the principle is easier to apply to existing code than to a blank page.',
      difficulty: 'core',
      topic: 'solid',
    },
    {
      id: 'q-sol-5',
      kind: 'scenario',
      prompt:
        'An interviewer asks whether your design is over-engineered. You have three interfaces and one factory. What is the strongest response?',
      options: [
        { id: 'a', label: 'Map each abstraction to the requirement that produced it, rank them, and drop the weakest' },
        { id: 'b', label: 'Defend all four, citing the principles each one satisfies' },
        { id: 'c', label: 'Remove all of them, since the interviewer clearly thinks it is too much' },
        { id: 'd', label: 'Point out that four extra types is not many' },
      ],
      correct: ['a'],
      explanation:
        'Conceding the weakest buys credibility for the ones you keep, and a ranking demonstrates ordered reasoning rather than uniform application. Defending everything suggests you cannot tell the difference; removing everything suggests the original choices had no reasoning either; and a size argument dodges a judgment question.',
      difficulty: 'advanced',
      topic: 'over-application',
    },
    {
      id: 'q-sol-6',
      kind: 'multi',
      prompt:
        'Which statements about SOLID are accurate? Select all that apply.',
      options: [
        { id: 'a', label: 'The principles conflict with one another, so a design cannot maximise all five' },
        { id: 'b', label: 'Four of them are about the cost of change; one is about correctness' },
        { id: 'c', label: 'They are more useful as diagnostics on an existing design than as a construction method' },
        { id: 'd', label: 'A design satisfying all five is by definition better than one that violates two' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the lesson. The fourth is the checklist fallacy: satisfying the letter of all five typically produces an interface per class and a factory per interface, while a design that deliberately violates two — keeping things that always change together in one place, for instance — can be materially better.',
      difficulty: 'core',
      topic: 'over-application',
    },
  ],

  exercises: [
    {
      id: 'ex-sol-1',
      kind: 'modify',
      title: 'Audit an over-engineered design, then break a principle on purpose',
      estimatedMinutes: 35,
      prompt: `Here is a design for a document export feature. The requirement was: *"export a report as PDF or CSV; more formats may be added."*

\`\`\`ts
interface IExporter            { export(r: Report): Buffer }
interface IExporterFactory     { create(fmt: string): IExporter }
interface IReportRepository    { load(id: string): Report }
interface IFileWriter          { write(b: Buffer, path: string): void }
interface IExportLogger        { logExport(id: string, fmt: string): void }
interface IExportValidator     { validate(r: Report): boolean }

class PdfExporter implements IExporter { /* ... */ }
class CsvExporter implements IExporter { /* ... */ }
class ExporterFactory implements IExporterFactory { /* ... */ }
class FileWriter implements IFileWriter { /* ... */ }
class ExportLogger implements IExportLogger { /* ... */ }
class ExportValidator implements IExportValidator { /* ... */ }

class ExportService {
  constructor(
    private repo: IReportRepository,
    private factory: IExporterFactory,
    private writer: IFileWriter,
    private logger: IExportLogger,
    private validator: IExportValidator,
  ) {}
  exportReport(id: string, fmt: string, path: string): void { /* ... */ }
}
\`\`\`

**Part 1.** For each of the six interfaces, say whether it is earned or speculative, and why. Name the second implementation where one exists.

**Part 2.** Rewrite the design. State how many types you removed and what you kept.

**Part 3.** Identify one principle you are now deliberately violating, and defend it.

**Part 4.** The interviewer asks for three changes. Classify each as addition or modification and say where it lands:
(a) exports may go to cloud storage instead of disk; (b) large CSV exports must stream rather than buffer; (c) an XLSX format.

Then answer:

- \`IExportValidator.validate\` returns a boolean. What is wrong with it beyond the interface being speculative?
- Which change in Part 4 was hardest, and what does that tell you about seam placement?`,
      rubric: [
        'Classifies all six interfaces as earned or speculative with reasoning.',
        'Identifies IExporter as the only interface the requirement justifies.',
        'Names the second implementation for the earned seam and notes its absence for the others.',
        'Rewrite removes at least four types and states the count.',
        'Identifies a deliberately violated principle and defends it with a reason.',
        'Classifies all three changes correctly.',
        'Identifies that the streaming change is a modification and explains why a seam cannot absorb it.',
        'Explains the boolean return problem in terms of the caller re-deriving the decision.',
        'Draws a conclusion about seams absorbing outcome changes but not shape changes.',
      ],
      modelAnswer: `**Part 1 — earned or speculative**

**\`IExporter\` — earned.** The requirement says "PDF or CSV; more formats may be added", which names the axis explicitly. **Second implementations: \`PdfExporter\` and \`CsvExporter\`, both present**, with XLSX named as a future one. This is the textbook case for a seam.

**\`IExporterFactory\` — speculative, and worse than merely unnecessary.** Selecting an implementation by string is a three-line map. **An interface over it invites a second factory, which nobody will ever write** — and the real cost is that the string-keyed lookup is now hidden behind two indirections.

*What I would do instead:* a record from format name to exporter, or a function. **The selection logic is not a policy that varies; it is a lookup.**

**\`IReportRepository\` — speculative.** One store, nothing in the requirement about storage varying.

*Nuance worth stating:* **this is the one I would most readily concede to a testing argument.** If loading a report in a test requires a database, an interface earns its place — **but then the justification is testability, and I would say that rather than calling it flexibility.**

**\`IFileWriter\` — speculative at first glance, and Part 4(a) makes it earned.** Right now there is one destination. **The requirement did not name this axis, so on the evidence available it is not earned** — and I would note that I am one requirement away from changing my mind, which is a more honest position than either adding or omitting it silently.

**\`IExportLogger\` — speculative, and it is the weakest of the six.** Nothing in the requirement mentions logging at all. **An interface for a concern the requirement never raised is inventing a requirement and then abstracting it.**

**\`IExportValidator\` — speculative, and it should not exist as a collaborator at all.** Validity is a property of the report, **so \`report.isExportable()\` puts the rule where the data is** — this is the behaviour-on-the-wrong-object smell rather than an interface question. The closing question returns to its boolean.

**Summary: one of six is earned.**

---

**Part 2 — the rewrite**

\`\`\`ts
// The only seam the requirement named
interface Exporter {
  readonly format: string;
  export(report: Report): Buffer;
}

class PdfExporter implements Exporter { readonly format = 'pdf'; /* ... */ }
class CsvExporter implements Exporter { readonly format = 'csv'; /* ... */ }

// Selection is a lookup, not a policy
const exporters: Record<string, Exporter> = {
  pdf: new PdfExporter(),
  csv: new CsvExporter(),
};

// Validity belongs to the report
class Report {
  exportability(): Exportability { /* ... */ }   // see below
}

// Concrete collaborators until something says otherwise
class ReportStore  { load(id: string): Report }
class DiskWriter   { write(b: Buffer, path: string): void }

class ExportService {
  constructor(
    private readonly reports: ReportStore,
    private readonly writer: DiskWriter,
  ) {}

  export(id: string, format: string, path: string): void {
    const report = this.reports.load(id);
    const check = report.exportability();
    if (!check.ok) throw new NotExportable(check.reason);

    const exporter = exporters[format] ?? (() => {
      throw new UnknownFormat(format);
    })();

    this.writer.write(exporter.export(report), path);
    // logging: a concrete call, or nothing, until asked
  }
}
\`\`\`

**Removed: five types** — four interfaces (\`IExporterFactory\`, \`IReportRepository\`, \`IFileWriter\`, \`IExportLogger\`, \`IExportValidator\` — five interfaces) plus the factory and validator classes. **Kept: one interface with two implementations, a lookup record, and two concrete collaborators.**

\`\`\`
Before: 6 interfaces + 6 classes + a 5-parameter constructor
After:  1 interface + 2 implementations + 2 concrete
        collaborators + a 2-parameter constructor
\`\`\`

**And the constructor going from five parameters to two is the visible benefit.** Five interface parameters each with one implementation is the interface-segregation over-application: **the coupling never decreased, it moved to the call site.**

---

**Part 3 — a principle deliberately violated**

**I am violating dependency inversion for \`ReportStore\` and \`DiskWriter\`, on purpose.**

\`ExportService\` is a policy — it decides the sequence of export — and it depends directly on two mechanisms. **That is exactly the arrow direction the principle warns about.**

**My defence has three parts.**

**The predicted change has not been stated.** The requirement named formats as the varying axis and said nothing about storage or destinations. **An inversion costs a type and a wiring site now, in exchange for a benefit contingent on a change nobody has asked for.**

**The blast radius is small and known.** If a second destination appears, the change is: extract an interface, move one method, update one construction site. **That is a ten-minute refactor on a class of this size** — and I would rather do it once, when the axis is real, than guess at it now.

**And the cost of being wrong in the other direction is higher.** If I invert both and the change that arrives is streaming — Part 4(b) — **neither inversion helps, and I have paid for two abstractions that did not absorb the change.** The original design's five interfaces are exactly this mistake made five times.

**What would change my mind:** a second destination, or a test I cannot write without substituting the store. **The second one is a legitimate reason, and I would name it as a testing requirement rather than dressing it up as flexibility.**

---

**Part 4 — the three changes**

**(a) Cloud storage instead of disk — a small modification, then an addition.**

\`\`\`
Modification: extract Destination { write(bytes, location) }
              from DiskWriter, change one constructor site
Addition:     CloudDestination implements Destination
\`\`\`

**This is the seam I declined in Part 1 becoming earned**, and it cost one extraction. **The refactor is small precisely because the responsibility was already isolated in its own class** — the mistake to avoid was not "no interface", it was "no separate class". **Concrete classes with clean responsibilities are cheap to abstract later; logic smeared across a service is not.**

**(b) Large CSV exports must stream — a modification, and the hardest of the three.**

\`\`\`
interface Exporter { export(report: Report): Buffer }
                                             ^^^^^^
→ the return type assumes the whole result fits in memory
→ streaming means: export(report, sink: WritableStream): void
→ EVERY implementation and EVERY caller changes
\`\`\`

**The existing seam cannot absorb this**, and that is the interesting finding. \`Exporter\` was the earned interface, placed on the axis the requirement named — **and it still does not help, because streaming changes the *shape* of the interaction rather than the *choice* of implementation.**

*What it costs:* the interface signature changes, both implementations change, the service changes, and the destination must accept a stream rather than a buffer. **Four coordinated edits.**

*And the lesson:* **a seam absorbs changes to an outcome, not changes to a protocol.** No amount of correct seam placement would have made this an addition — the only thing that would have helped is having chosen a streaming signature from the start, **which would have been speculative at the time and would have complicated the simple case.**

**(c) An XLSX format — a pure addition.**

\`\`\`
class XlsxExporter implements Exporter { readonly format = 'xlsx' }
+ one entry in the lookup record
\`\`\`

**Nothing existing is modified**, which is the seam paying for itself — and it is the change the requirement predicted.

**Score: one pure addition, one cheap modification, one genuine modification.** Worth noting that the over-engineered original design would have scored **exactly the same**, because its five extra interfaces addressed none of these three changes — except (a), which it would have handled at the cost of four other unused abstractions.

---

**What is wrong with \`validate(r: Report): boolean\` beyond being speculative**

**It discards the reason, so the caller re-derives it.**

\`\`\`
validate(report) === false
  → why? no data rows? missing permissions? too large?
  → the caller cannot tell the user anything useful
  → so the caller inspects the report itself to explain it
  → and the validity rule now exists in two places
\`\`\`

**That last step is the real damage.** A boolean does not merely produce a poor message — **it forces the caller to duplicate the decision in order to explain it**, which is the same failure the validator was meant to prevent.

**What I would return:**

\`\`\`ts
type Exportability =
  | { ok: true }
  | { ok: false; reason: 'no-rows' | 'too-large' | 'unfinalised';
      detail: string };
\`\`\`

**Two properties this gets right.** The reason travels with the refusal, so the caller explains without knowing how it was decided. **And the reasons are a closed set**, so adding a fourth is a visible change the compiler shows every caller — **whereas a boolean hides new refusal reasons entirely.**

**And it belongs on \`Report\`**, not on a collaborator: the rule needs the report's contents, so **putting it elsewhere means exposing those contents.** The interface question was the smaller of the two problems.

---

**Which change was hardest, and what it says about seams**

**(b), streaming — and it was hardest despite the seam being correctly placed.**

**This is the most useful thing in the exercise**, because it separates two claims that usually get conflated:

\`\`\`
A seam placed on the right axis absorbs a change of
IMPLEMENTATION:      "add XLSX"            → addition ✓

A seam cannot absorb a change of INTERACTION SHAPE:
                     "stream instead of
                      returning a buffer"  → modification ✗
\`\`\`

**The exporter interface was earned, correctly placed, and irrelevant to (b).** No better placement would have helped, because the change was not about *which* exporter runs — it was about *how* results move between the exporter and its destination.

**Three conclusions.**

**Seams are about variation in outcomes, not about protocols.** So when identifying seams from a prompt, **the question is "what will be chosen differently?" rather than "what might change?"** Those sound similar and produce different designs.

**Protocol changes are inherently breaking, and it is fine to say so.** The honest interview answer to "make this stream" is: **"that changes the interface signature, so it touches both implementations and both callers — four coordinated edits. I would not have designed for it up front, because a streaming signature complicates the simple case for a possibility nobody raised."** Claiming a seam would have absorbed it would be wrong.

**And it explains why keeping responsibilities in separate concrete classes matters more than abstracting them.** Change (a) was cheap because \`DiskWriter\` already existed as its own class — **the extraction was mechanical.** The lesson is not "abstract early" but **"separate early, abstract late"**: separation makes later abstraction cheap, and abstraction without a known axis just commits you to a guess.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-sol-1',
      level: 'basic',
      question: 'What does single responsibility mean, and how do you test for it?',
      guidance:
        'One reason to change, tested by listing the reasons and their stakeholders. Look for rejection of "does one thing" and for the do-they-change-together check.',
    },
    {
      id: 'iq-sol-2',
      level: 'basic',
      question: 'Give me an example of a Liskov violation.',
      guidance:
        'Square/Rectangle or a throwing stub. Strong answers give the precondition/postcondition/invariant formulation and note this is the one principle about correctness.',
    },
    {
      id: 'iq-sol-3',
      level: 'intermediate',
      question: 'You have written the first pricing rule. Do you add an interface?',
      guidance:
        'Only if the requirement names the axis; otherwise write it directly and refactor on the second case. Look for the retroactive framing rather than either extreme.',
    },
    {
      id: 'iq-sol-4',
      level: 'intermediate',
      question: 'What is wrong with an interface that has one implementation?',
      guidance:
        'It tracks that implementation, so the dependency direction is unchanged. Strong answers use "name the second implementation" as the test.',
    },
    {
      id: 'iq-sol-5',
      level: 'advanced',
      question: 'Is this design over-engineered?',
      guidance:
        'Map each abstraction to the requirement that produced it, rank them, concede the weakest. Excellent answers name the trigger that would justify the ones they dropped.',
    },
    {
      id: 'iq-sol-6',
      level: 'advanced',
      question: 'Do the SOLID principles ever conflict?',
      guidance:
        'Yes — splitting for S and I versus consolidating for cohesion and D. Excellent answers name a principle they are violating deliberately and why.',
    },
    {
      id: 'iq-sol-7',
      level: 'followup',
      question: 'You have six one-method interfaces and a six-parameter constructor. Is that segregated?',
      guidance:
        'No — coupling was relocated to the call site. Role interfaces split by what a caller does, not by method count.',
    },
    {
      id: 'iq-sol-8',
      level: 'followup',
      question: 'Would a dependency-injection container improve this design?',
      guidance:
        'Constructor parameters are already injection; a container optimises many wiring paths. Look for the direction question — does a mechanism change force a policy change — rather than the mechanism question.',
    },
  ],

  activeLearning: [
    {
      id: 'al-sol-1',
      kind: 'debug',
      prompt:
        'A team adopted SOLID strictly two years ago. Since then: the average change touches 11 files, new engineers take three months to make their first independent change, and the team reports that "everything is an interface so you cannot find the actual logic". Every principle is satisfied on inspection. Diagnose it.',
      discussion: `**Every principle satisfied and the codebase unusable is the signature of forward-application** — using the principles as a construction method rather than as diagnostics. The specific symptoms each point at a different over-application, which makes this diagnosable rather than vague.

**Symptom 1 — the average change touches 11 files: over-applied single responsibility.**

Splitting by mechanism rather than by reason means **code that changes together lives apart.** A tier-rule change touches a validator, a period calculator, a limit checker, three interfaces, a factory and two wiring sites.

*The diagnostic:* **for the last twenty commits, list the files each touched and look for sets that always co-occur.** A set of files appearing together in fifteen of twenty commits is one responsibility split N ways — **and the fix is to merge them back**, which teams resist because the split "satisfies SRP".

*What to say:* the principle was never about file count. **Files that always change together were one reason to change**, and the split made the rule harder to see while satisfying the letter.

**Symptom 2 — "you cannot find the actual logic": over-applied dependency inversion.**

An interface per class means **every read of the code is a jump: find the interface, find the implementation, find the wiring to know which implementation.** Three hops to read one decision.

*The diagnostic:* **count interfaces with exactly one implementation.** If most of them have one, most inversions bought nothing — **an interface that tracks its own implementation does not invert a dependency.**

*The fix:* delete the interface and keep the class, wherever there is exactly one implementation and no test requiring substitution. **This is usually the single highest-value change**, and it is mechanical.

**Symptom 3 — three months to a first independent change: the two above, compounded.**

A newcomer must learn **where things are** (symptom 1) and **how to follow a call** (symptom 2) before they can read anything. **Neither is domain knowledge**, so the ramp is spent on navigation rather than on the problem — which is the clearest evidence that the structure is the obstacle.

*A sharper diagnostic:* **ask a new engineer to explain what happens when a specific business rule fires.** Time it. If tracing one rule takes an hour, the indirection is the cost.

**And a fourth thing worth checking, which the symptoms hint at: constructor width.**

Over-applied interface segregation produces components taking six or eight collaborators. **Every one is a thing a reader must understand before understanding the class** — and the wiring site that constructs them knows every concrete type, so it is the most coupled file in the codebase while looking like configuration.

*Diagnostic:* **the distribution of constructor parameter counts.** A median above four is a strong signal.

**What I would do, in order.**

**First, delete single-implementation interfaces.** Mechanical, low risk, immediately improves readability, and it **reduces the file count per change without moving any logic.** Keep the ones a test genuinely needs to substitute — and record that testability is the reason, so the next reader does not think it was flexibility.

**Second, merge files that always change together.** Driven by the commit-co-occurrence data rather than by taste, so the argument is evidence rather than opinion.

**Third, collapse one-method interfaces into role interfaces** where several are always passed together. Six parameters becoming two is a legibility win with no behaviour change.

**And fourth, leave the genuinely earned abstractions alone** — the ones with two or more implementations, or at a real boundary. **There will be some, and removing them would be the over-correction.**

**What I would not do.**

**Declare SOLID harmful.** The failure is the application method, not the principles: **a codebase with a god class and a growing switch would have different, equally real problems.** The team over-applied five heuristics; the answer is judgment, not the opposite dogma.

**And not a rewrite.** Every fix above is local and reversible. **A rewrite would replace a legible-but-verbose codebase with an unknown one**, and the team's problem is navigability rather than correctness.

**The diagnosis in one sentence:** the principles were applied forward as a construction method, so every one of them was satisfied structurally and none of their benefits materialised — **because the benefit of a seam comes from a second implementation, and the benefit of a split comes from independent reasons to change, and the team created neither.**

**Transferable:** when a codebase satisfies its stated principles and is still expensive to change, **measure what changes together.** Commit co-occurrence and single-implementation counts are two cheap numbers that tell you whether the structure matches the change patterns — and structure that does not match change patterns is cost with no benefit, however principled it looks.`,
    },
    {
      id: 'al-sol-2',
      kind: 'what-changes-if',
      prompt:
        'Change the timescale: this is not a long-lived codebase but a 50-minute interview design, and then separately a prototype that will be deleted in three weeks. Does the cost-benefit of each principle change, and which ones survive?',
      discussion: `**It changes substantially, and the reason is structural: every principle costs up front and pays off over many future changes.** Shorten the future and the arithmetic inverts — for four of the five.

**The 50-minute interview design.**

**What survives, and it is the correctness one.** **Substitutability still matters at any timescale**, because a violation is a bug rather than a maintenance cost. A subtype that surprises callers is wrong in the design as drawn, **so an interviewer can fault it immediately** — there is no "we will fix it later" for a design that does not work.

**Single responsibility survives in its diagnostic form**, because the interviewer *is* the future change. They will ask for a new pricing rule, and **your design is evaluated on where that lands** — so responsibility assignment pays off inside the fifty minutes, which is unusual.

*That is the key observation about interviews:* **the future arrives immediately.** The extension questions compress years of change into minutes, so principles about change locality pay off at once rather than eventually.

**What weakens: dependency inversion, substantially.** Its benefit accrues over many technical changes, and **an interview has none** — nothing is ever actually reimplemented. So an inversion costs a box on the diagram and buys nothing observable. *Keep it only where the prompt names the axis*, in which case it is really open-closed anyway.

**What weakens most: interface segregation.** With no implementers to burden and no callers to recompile, **it is invisible** — and applying it costs diagram clutter, which is a real cost when the diagram is the deliverable.

**Open-closed is the interesting one: it becomes more important, not less.** Because the interviewer's next question is always a change, **and "that is a new implementation, nothing existing changes" is the answer they are listening for.** But only on the axes they name — which is the retroactive rule with the exception doing all the work.

\`\`\`
Interview ranking:
  1. Substitutability   (correctness — always)
  2. Open-closed        (on named axes only — the questions come)
  3. Single responsibility (change locality pays immediately)
  4. Dependency inversion  (only at a named boundary)
  5. Interface segregation (mostly invisible; costs clarity)
\`\`\`

**The three-week prototype.**

**Almost the reverse, and more extreme.**

**Substitutability still survives** — it is correctness, and a prototype that gives wrong answers is worse than useless because it produces wrong conclusions.

**Everything else is close to pure cost.** A prototype's purpose is to answer a question, and **it will be deleted whether the answer is yes or no.** There are no future changes to make cheap.

*So the right design is the one that reaches the answer fastest:* one file if that is quickest, direct calls, a switch statement, no interfaces. **And that is a legitimate engineering choice, not sloppiness** — the principles are investments, and you do not invest in an asset you are about to discard.

**With one genuine exception, and it is the trap.** If the prototype might survive — **and prototypes survive far more often than anyone plans** — then the calculation was wrong from the start. *The honest mitigation is not to apply the principles anyway;* it is **to keep responsibilities in separate functions or classes without abstracting them**, which is the "separate early, abstract late" position. Separation is nearly free and makes later abstraction mechanical; abstraction without a known axis is a guess.

**What generalises from the two cases.**

**Every principle is an investment whose return depends on the number of future changes.** So the questions to ask are: **how many changes will this code see, and do I know which axes they will arrive on?**

\`\`\`
Many changes, known axes    → apply generously
Many changes, unknown axes  → separate, do not abstract;
                              refactor on the second case
Few changes, known axes     → apply narrowly, on those axes
Few changes                 → correctness only
\`\`\`

**And that grid explains the interview case cleanly.** An interview is "few changes, known axes" — **the prompt names the axes and there are three or four changes** — which is exactly why the right answer is narrow, deliberate abstraction on the named axes and nothing else. **Not because interviews are artificial, but because the arithmetic genuinely differs.**

**The sentence worth having ready:** *"I am abstracting this axis because you told me it varies; I am not abstracting storage, because in a design of this lifetime the cost of the abstraction exceeds its expected benefit — and I would add it the moment there is a second implementation or a test that needs one."* **That answer demonstrates that you know the principles are investments**, which is a more useful thing to demonstrate than knowing their names.`,
    },
  ],

  revision: {
    bullets: [
      'Each principle names a failure mode, and each has an over-application that is its own failure mode.',
      'Only substitutability is about correctness; the other four are about the cost of change.',
      'The principles conflict: S and I push to split, cohesion and D push to consolidate.',
      'So "apply all five" is not an instruction — they are five pressures to balance.',
      'Use them as diagnostics on a design you already have, never as a construction method.',
      'Single responsibility means one reason to change, tested by listing reasons and stakeholders.',
      'Classes that appear together in every commit were one responsibility split by mechanism.',
      'Open-closed is usually achieved retroactively: write the first case, refactor on the second.',
      'The exception is a requirement that names the axis — the second case arriving in advance.',
      'Substitutability: weaken preconditions, strengthen postconditions, preserve invariants.',
      'A subtype that throws on an inherited method has strengthened a precondition to "never call this".',
      'Detect it with a test written against the base type and run for every subtype.',
      'A fat interface forces stubs, and stubs are substitutability violations — so I helps L.',
      'One-method interfaces everywhere relocate coupling to a six-parameter constructor.',
      'Split by role — Readable, Writable — rather than by method count.',
      'Dependency inversion is about direction: if the mechanism changes, must the policy change?',
      'An interface with one implementation tracks that implementation, so nothing was inverted.',
      'Name the cost as you apply a principle — that sentence is the difference from recitation.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Five heuristics, each naming a way code becomes expensive to change, each with a characteristic over-application — best used as diagnostic questions on an existing design rather than as a method for producing one.',
    whyItExists:
      'Because the failure modes they name are real and recurring. And because applied forward as rules they produce an interface per class and a factory per interface, which is the design an interviewer describes as over-engineered.',
    whenToUse: [
      'As five questions run over a design that already exists.',
      'Substitutability always — it is correctness, at any timescale.',
      'Open-closed on axes the requirement names.',
      'Single responsibility when you can name distinct stakeholders for the edits.',
      'Dependency inversion at a real boundary where the mechanism plausibly changes.',
    ],
    whenNotToUse: [
      'As a construction method for finding objects.',
      'Pre-abstracting axes nobody has named.',
      'An interface with one implementation and no test requiring substitution.',
      'One-method interfaces as a segregation strategy.',
      'A dependency-injection container for a single wiring path.',
      'Claiming all five are satisfied, which usually means the letter without the properties.',
    ],
    alternatives: [
      'Behaviour-first object discovery for finding objects, with SOLID as the audit afterwards.',
      '"Separate early, abstract late" — separation is cheap and makes later abstraction mechanical.',
      'A lookup record instead of a factory, when selection is not a policy.',
      'Role interfaces instead of either a fat interface or one-method interfaces.',
      'Result types instead of booleans, so refusal reasons travel with the refusal.',
    ],
    tradeoffs: [
      'Every principle costs types, wiring and reader jumps up front, for a benefit contingent on the predicted change.',
      'Splitting by reason buys change locality and costs legibility if done by mechanism.',
      'Retroactive open-closed buys a better abstraction and costs one refactor.',
      'Role interfaces buy honest contracts and cost a judgment about what a role is.',
      'Inversion buys independence from a mechanism and costs indirection at every construction site.',
      'Deliberately violating a principle buys cohesion and costs a defence you must be able to give.',
    ],
    failureModes: [
      'A god class that is both the most depended-on and least stable in the design.',
      'A swarm of one-method classes appearing together in every commit.',
      'A switch edited for every new case.',
      'Four speculative seams on axes the actual change cuts across.',
      'A subtype that throws on an inherited method.',
      'A read-only type inheriting from a mutable one.',
      'A fat interface whose implementers stub what they cannot support.',
      'A six-parameter constructor of single-implementation interfaces.',
      'A business rule that changes when storage changes.',
      'A container configuring one wiring path.',
      'Three-hop navigation to read a single decision.',
    ],
    followUpQuestions: [
      'Why might this class be edited, and by whom?',
      'Do these classes appear together in every commit?',
      'Which axis does the prompt actually say will vary?',
      'What is the second implementation of this interface?',
      'Does any subtype surprise a caller written against the base?',
      'Is any implementer stubbing a method it cannot support?',
      'Does a caller depend on methods it never uses?',
      'If the mechanism changes, must the policy change?',
      'What does this abstraction cost, and what does it buy?',
      'Which principle am I violating here, and why?',
      'How many changes will this code see, and do I know their axes?',
    ],
  },
});
