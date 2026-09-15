import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-durable-execution',
  title: 'Durable execution and workflow orchestration',
  summary:
    'A process that must survive its own crash cannot keep state in memory. Durable execution moves the program counter into a database — and everything follows from that one move, including the constraint that makes it work.',
  phase: 'ai',
  module: 'workflows',
  position: 81,
  kind: 'concept',
  difficulty: 'advanced',
  estimatedMinutes: 60,
  tags: ['durable-execution', 'workflows', 'idempotency', 'checkpointing', 'compensation'],
  prerequisites: ['d-event-driven-outbox', 'a-agent-loops'],
  resources: [
    {
      key: 'temporal-durable-execution',
      tier: 'must',
      note: 'Read it for the core idea: the workflow is code, its history is the truth, and recovery is replay. The determinism constraint only makes sense once you see that recovery re-executes your function from the top.',
    },
    {
      key: 'temporal-workflows',
      tier: 'must',
      note: 'Read the determinism and replay sections specifically. The list of things you may not do inside workflow code is the clearest possible statement of what durability actually costs the programmer.',
    },
    {
      key: 'aws-step-functions',
      tier: 'must',
      note: 'Read it as the other shape of the same idea — an explicit state machine rather than replayed code. Comparing the two makes clear which properties come from durability and which from a particular expression of it.',
    },
    {
      key: 'stripe-idempotent-requests',
      tier: 'good',
      note: 'Read it for the contract a retryable side effect needs. Durable execution retries aggressively by design, so every external call must behave like this or the durability guarantee turns into duplicate work.',
    },
    {
      key: 'microservices-saga',
      tier: 'good',
      note: 'Read it for what happens when a long workflow fails halfway and the steps cannot be rolled back. Compensation is the answer durable execution needs and does not provide for you.',
    },
    {
      key: 'langgraph-graph-api',
      tier: 'advanced',
      note: 'Read it for durable execution applied to agent loops, where the next step is chosen by a model rather than by code. It is the bridge between this lesson and the rest of the module.',
    },
  ],

  intuition: {
    body: `**A normal program keeps its state in memory: the call stack, local variables, the program counter.** **Kill the process and all of it is gone** — which is fine for something that runs in 50 milliseconds and unacceptable for something that runs for three days.

\`\`\`
Step 1  charge the card          ✓ done
Step 2  reserve the inventory    ✓ done
Step 3  wait 24h for the courier
        ← the process is redeployed here
Step 4  ...
→ what was charged? what was reserved?
  who resumes it?
\`\`\`

**Durable execution's move is to put the program counter in a database.** **Every completed step is recorded before the next one starts**, so a new process can read the history and continue.

\`\`\`
Memory:   the stack is the truth, and it dies
Durable:  the RECORDED HISTORY is the truth,
          and the process is disposable
\`\`\`

**Which yields the property everything else serves: the process becomes unimportant.** **Crash it, redeploy it, move it to another machine** — the work continues, **because none of the work's state was ever in it.**

**And the cost is a constraint that surprises everyone the first time.**

\`\`\`
Recovery means RE-RUNNING your function from the
top, skipping steps already in the history.
→ so the code must produce the same decisions
  given the same history
→ no Date.now(), no random(), no reading a
  config that might have changed
\`\`\`

**Non-determinism in workflow code makes replay diverge from history**, and a divergent replay is a corrupted workflow. **So the durability is bought with a restriction on what the program may do** — which is the trade, stated plainly.

**Then the second constraint, which is about the outside world:**

\`\`\`
crash AFTER charging the card, BEFORE recording it
→ replay charges again
\`\`\`

**Durability guarantees the step runs at least once, never exactly once** — **so every side effect must be idempotent**, and that requirement is not optional.`,
    analogyLimit:
      '"It saves progress so it can resume" hides both constraints. Recovery re-executes the function from the top against the recorded history, so workflow code must be deterministic — no clocks, no randomness, no mutable config — a real restriction on what you may write. And the history is written after the side effect, so a step runs at least once rather than exactly once, making idempotency mandatory. It also hides that failing halfway needs compensation, which durability does not provide.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team writes an order-fulfilment workflow: charge the card, reserve inventory, book the courier, wait for a delivery confirmation webhook, then email the customer. They run it as an async function on a server, keeping state in local variables. Identify four problems.',
      answer: `**Problem 1 — a deploy loses every in-flight order.**

\`\`\`
Deploys happen weekly. Orders take 2-5 days.
→ every deploy kills hundreds of workflows
  mid-flight
→ cards charged, inventory reserved, nobody
  emailed, no record of where each one stopped
\`\`\`

**And there is no recovery path**, because the only record of progress was a stack frame. **The customer's money is gone and the system does not know.**

*The fix:* **persist each step's completion before starting the next**, so a new process reads the history and continues. **The process becomes disposable, which is the entire point.**

**Problem 2 — waiting 24 hours for a webhook holds a process open.**

**An async function awaiting a webhook is a live process with memory**, multiplied by every in-flight order. **Thousands of orders means thousands of held processes** — and any one of them dying loses that order.

*The fix:* **a wait is a durable state, not a blocked call.** The workflow records "waiting for delivery confirmation on order X" **and stops running entirely.** **The webhook's arrival is a signal that wakes it** — so ten thousand waiting orders cost ten thousand database rows and zero processes.

**Problem 3 — retries duplicate side effects.**

**When the courier API times out, the natural response is a retry.** **The timeout is ambiguous** — the booking may have succeeded — **so a retry books twice.**

\`\`\`
Durable execution RETRIES AGGRESSIVELY by design
→ so "at least once" is the guarantee
→ and every external call must be idempotent or
  the durability makes duplicates MORE likely,
  not less
\`\`\`

*The fix:* **an idempotency key derived from the workflow and step**, so a retry is recognised as the same call. **This is not defensive engineering; it is the precondition for durable execution to be safe at all.**

**Problem 4 — a failure at step three leaves steps one and two done.**

**The card is charged and the inventory reserved, and the courier cannot be booked.** **There is no transaction spanning three external systems**, so rollback is not available.

*The fix:* **compensation.** Each step declares how to undo itself — **refund the charge, release the reservation** — and the workflow runs them in reverse on failure. **Compensations must themselves be idempotent and may themselves fail**, which is why this is the hardest part.

**What the corrected design looks like.**

\`\`\`
· each step's result written to durable history
  before the next begins
· waits are states, not blocked processes
· every external call carries an idempotency key
  derived from (workflow id, step)
· every step declares a compensation
· workflow code is deterministic — no clocks, no
  randomness, no mutable config reads
\`\`\`

**The transferable point: durability moves the state out of the process, and everything difficult follows from where it now lives.** **Replay requires determinism; at-least-once requires idempotency; partial failure requires compensation** — three costs for one property.`,
    },
  body: `## Where the state lives

**The whole idea in one contrast.**

\`\`\`
IN-MEMORY EXECUTION
  truth    the call stack
  lifetime the process
  recovery none — start over, if you can tell
           where you were

DURABLE EXECUTION
  truth    an append-only history in a database
  lifetime independent of any process
  recovery read the history, continue from there
\`\`\`

**The history is a log of completed steps and their results**, written before the next step begins:

\`\`\`
wf-8812  step:charge_card       ok  {txn: "ch_44"}
wf-8812  step:reserve_inventory ok  {res: "r_91"}
wf-8812  step:book_courier      started
         ← the process dies here
\`\`\`

**A new worker picks up wf-8812, sees two completed steps, and re-attempts the third.** **It does not re-charge the card**, because that step's result is in the history and is returned from it rather than recomputed.

*This is the move that makes everything else necessary*, so it is worth being precise: **the results of completed steps are replayed from the history, not recalculated.** **That is why the code must be deterministic** — the replay must reach the same step-three call it reached before, or the history no longer describes the program.

## Two ways to express it

**Both exist and the difference matters more than it looks.**

\`\`\`
CODE + REPLAY (Temporal-style)
  You write ordinary-looking code. The runtime
  intercepts step calls, records results, and on
  recovery re-executes the function feeding
  recorded results back.
  + natural control flow: loops, conditionals,
    ordinary composition
  − the determinism constraint applies to YOUR
    code, and violations are subtle

STATE MACHINE (Step Functions-style)
  You declare states and transitions. The runtime
  executes the machine.
  + determinism by construction — the machine
    cannot be non-deterministic
  + the workflow is inspectable as data
  − control flow is verbose, and complex logic
    is awkward
\`\`\`

**The properties that matter come from durability, not from either expression** — **persistence of progress, resumability, retries, visibility.** **The expression decides who bears the determinism burden**: the programmer, or the language.

*And the practical read:* **a state machine for workflows with few states and high stakes; replayed code where the logic is genuinely complex.** **A workflow with three states expressed as replayed code is harder to verify than a diagram.**

## The determinism constraint

**Replay re-executes the workflow function against the recorded history.** **If the second execution takes a different path, the history no longer matches the program** — so the runtime forbids anything that could differ between runs.

\`\`\`
NOT ALLOWED in workflow code
  Date.now(), new Date()      → time moves
  Math.random(), uuid()       → differs per run
  reading env or config       → may have changed
  direct network or file I/O  → results differ
  iterating a map with
    unstable ordering         → differs per run
  spawning threads            → scheduling differs

ALLOWED — because results are recorded
  step(charge_card, ...)      → replayed from
                                history
  workflow.now()              → the recorded time
  workflow.random()           → the recorded value
  workflow.sleep(24h)         → a durable timer
\`\`\`

**The pattern: anything non-deterministic must go through the runtime so its result is recorded.** **The first execution computes it; every replay reads it back.**

*Which produces the most useful mental model:* **workflow code is the orchestration, and it must be pure with respect to the history.** **All the impurity lives in steps** — the units whose results get recorded.

**And the failure mode is worth naming**, because it is subtle: **changing workflow code while workflows are in flight can break replay.** A version that inserts a step **replays an old history against new code and finds the step order wrong.** **So deployments need versioning**: in-flight workflows continue on the old logic, new ones start on the new. **This is the operational cost people discover late.**

## Steps, retries and idempotency

**A step is the unit of recording**, and the unit of retry.

\`\`\`
For each step:
  · a retry policy — attempts, backoff, timeout
  · a result recorded on success
  · an error recorded on terminal failure
\`\`\`

**Because retries are automatic and aggressive**, the guarantee is **at-least-once execution of side effects**. **Exactly-once is not available**, for the same reason it is not available anywhere: **the crash can land between the side effect and the record of it.**

\`\`\`
charge the card    ← succeeded
crash
record the result  ← never happened
replay → charges again
\`\`\`

**So the only defence is at the side effect.** **Every external call carries a key derived from the workflow and step** — \`wf-8812:charge_card\` — **and the receiving system recognises a repeat.** **A key generated fresh per attempt defeats the entire mechanism**, which is the most common implementation error.

*And retry policy should distinguish error classes*, exactly as tool errors did:

\`\`\`
TRANSIENT   network, 5xx, timeout → retry with
            backoff
TERMINAL    4xx, validation, "card declined"
            → do not retry; fail the step
AMBIGUOUS   timeout on a mutating call
            → retry ONLY if idempotent; otherwise
              query before retrying
\`\`\`

**The ambiguous class is the one that needs design.** **A timeout on a payment is not a failure — it is an unknown** — and treating it as a failure is how double charges happen.

## Waits are states

**The property that makes long workflows cheap.**

\`\`\`
BLOCKED CALL     a process holds memory for 24h
                 → 10,000 waits = 10,000 processes
                 → and each is a crash away from
                   losing its order
DURABLE WAIT     the workflow records "waiting for
                 X" and STOPS
                 → 10,000 waits = 10,000 rows
                 → and a crash costs nothing
\`\`\`

**Three kinds of wait, all the same shape.**

**A timer** — resume in 24 hours. **A signal** — an external event arrives and names the workflow. **A condition** — resume when some state becomes true, which is usually a signal in disguise.

**And every wait needs a timeout**, which is the part teams omit. **A workflow waiting for a webhook that never arrives waits forever**, so the wait is really "the signal, or two hours, whichever comes first" — **and the timeout branch is a real path that needs designing.**

*Signals also need idempotency:* **a webhook delivered twice must not advance the workflow twice**, which means the signal carries an id and duplicate ids are dropped.

## Compensation

**Durable execution guarantees the workflow finishes or fails visibly.** **It does not undo what already happened** — and for a workflow spanning several external systems, there is no transaction to roll back.

\`\`\`
charge card       → compensate: refund
reserve stock     → compensate: release
book courier      → FAILS
→ run compensations in REVERSE order
\`\`\`

**Three properties compensations need**, and each is a source of bugs.

**They must be idempotent**, because they are steps too and will be retried.

**They may fail**, and a failed compensation is the genuinely hard case — **it needs escalation to a human, because the system cannot reach a consistent state on its own.** **This is the path that must exist and is usually missing.**

**And some steps cannot be compensated.** **An email is sent; a notification is delivered.** **The design response is ordering: put irreversible steps last**, so the reversible work has already succeeded before anything permanent happens.

*And compensation is not rollback:* **a refund is not the absence of a charge.** The customer sees both, the accounting records both, **and the business consequence differs** — so "we can compensate" is a weaker claim than "we can roll back", and it should be made honestly.

## Durable execution for agent loops

**The agent loop from module 5.3 is a workflow whose next step is chosen by a model** — **so it inherits all of this, with one difference that matters.**

\`\`\`
Ordinary workflow: the code decides the next step
                   → replay is deterministic
Agent workflow:    the MODEL decides
                   → replay would call the model
                     again and might get a
                     different answer
\`\`\`

**So the model call is a step**, and its output is recorded like any other. **Replay reads the recorded decision rather than re-asking** — **which is exactly the same treatment as \`random()\`.**

**What that buys is substantial:**

\`\`\`
· an agent that survives a deploy mid-task
· a loop that pauses for human approval for hours
  without holding a process
· every tool call retried with a policy
· the full trajectory in durable history, which
  is the debugging artefact the previous lessons
  kept asking for
· resume from a checkpoint rather than restart
\`\`\`

*And one thing to be careful about:* **the durable history and the agent's context are different things.** **The history is the complete record; the context is the assembled subset the model sees.** **Compaction discards from the context, never from the history** — which is what makes post-hoc diagnosis possible.

## What to say in a design discussion

**That durability means the state lives in a database rather than a process, and the process becomes disposable.**

**That recovery is replay, which forces determinism in workflow code and pushes all impurity into recorded steps.**

**That the guarantee is at-least-once, so every side effect needs an idempotency key derived from the workflow and step — never generated per attempt.**

**That a timeout on a mutating call is an unknown rather than a failure.**

**That waits are durable states with timeouts, not blocked processes.**

**That compensation is the answer to partial failure, that it is not rollback, and that a failed compensation escalates to a human.**

**That in-flight workflows need versioning across deploys.**

**And that an agent loop is a workflow whose model calls are recorded steps** — which is what makes it survivable.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'durable-shape',
      title: 'Where the state lives, and the three costs of moving it',
      caption:
        'Step through it. One property — the process becomes disposable — is bought with three constraints, and every operational difficulty in durable execution is one of them.',
      nodes: [
        { id: 'wf', label: 'Workflow code — deterministic orchestration', kind: 'service', x: 0, y: 170, detail: 'No clocks, no randomness, no config reads, no direct I/O. Replay re-executes this function from the top against the recorded history, so a different path on the second run means the history no longer describes the program.' },
        { id: 'hist', label: 'Durable history — the truth', kind: 'store', x: 250, y: 170, detail: 'An append-only log of completed steps and their results, written before the next step begins. Completed steps are replayed from here rather than recalculated, which is precisely why the code above it must be deterministic.' },
        { id: 'step', label: 'Steps — where all the impurity lives', kind: 'service', x: 500, y: 60, detail: 'The unit of recording and the unit of retry. Anything non-deterministic goes through the runtime so its result is recorded: the first execution computes it, every replay reads it back — including Date.now(), random values, and a model\'s choice of next action.' },
        { id: 'idem', label: 'Idempotency key: (workflow, step)', kind: 'note', x: 750, y: 60, detail: 'The guarantee is at-least-once, because a crash can land between the side effect and the record of it. A key generated fresh per attempt defeats the whole mechanism, which is the most common implementation error.' },
        { id: 'wait', label: 'Waits are states, not blocked calls', kind: 'store', x: 500, y: 290, detail: '10,000 orders waiting on a webhook are 10,000 rows and zero processes. Every wait needs a timeout — "the signal, or two hours, whichever comes first" — and the timeout branch is a real path that needs designing.' },
        { id: 'comp', label: 'Compensation, in reverse order', kind: 'service', x: 750, y: 290, detail: 'Durability finishes or fails visibly; it does not undo. Compensations are steps too, so they retry and must be idempotent — and a failed compensation escalates to a human, because the system cannot reach consistency alone.' },
        { id: 'proc', label: 'The process — disposable', kind: 'client', x: 250, y: 20, detail: 'Crash it, redeploy it, move it. The work continues because none of the work\'s state was ever in it. This is the single property everything else is paying for.' },
        { id: 'ver', label: 'In-flight workflows need versioning', kind: 'note', x: 0, y: 320, detail: 'Inserting a step and deploying replays an old history against new code and finds the order wrong. Old workflows continue on old logic; new ones start on new — the operational cost discovered late.' },
      ],
      edges: [
        { id: 'd1', source: 'wf', target: 'hist', kind: 'write' },
        { id: 'd2', source: 'hist', target: 'wf', kind: 'read' },
        { id: 'd3', source: 'wf', target: 'step', kind: 'sync' },
        { id: 'd4', source: 'step', target: 'idem', kind: 'control' },
        { id: 'd5', source: 'wf', target: 'wait', kind: 'async' },
        { id: 'd6', source: 'step', target: 'comp', kind: 'control' },
        { id: 'd7', source: 'proc', target: 'hist', kind: 'read' },
        { id: 'd8', source: 'ver', target: 'wf', kind: 'control' },
      ],
      steps: [
        {
          id: 'ds1',
          title: 'Move the program counter into a database',
          description:
            'Every completed step is recorded before the next begins, so a new worker reads the history and continues. The process stops being where the work lives.',
          nodes: ['wf', 'hist', 'proc'],
          edges: ['d1', 'd2', 'd7'],
        },
        {
          id: 'ds2',
          title: 'Cost one: replay forces determinism',
          description:
            'Recovery re-executes your function, so anything that could differ between runs must go through the runtime and be recorded — clocks, randomness, and a model\'s decisions alike.',
          nodes: ['step'],
          edges: ['d3'],
        },
        {
          id: 'ds3',
          title: 'Cost two: at-least-once forces idempotency',
          description:
            'The crash can land between charging the card and recording it. The key must be derived from the workflow and step so a retry is recognised as the same call.',
          nodes: ['idem'],
          edges: ['d4'],
        },
        {
          id: 'ds4',
          title: 'And waits become free',
          description:
            'A workflow that records "waiting for X" and stops costs a row rather than a process — which is what makes multi-day workflows affordable at all.',
          nodes: ['wait'],
          edges: ['d5'],
        },
        {
          id: 'ds5',
          title: 'Cost three: partial failure needs compensation',
          description:
            'There is no transaction across three external systems. Compensations run in reverse, must be idempotent, and when one fails a human has to be involved.',
          nodes: ['comp', 'ver'],
          edges: ['d6', 'd8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'crash-points',
      title: 'Where a crash can land, and what each position costs',
      caption:
        'Read the middle case carefully. It is the one that makes exactly-once impossible and idempotency mandatory — and no amount of durability machinery removes it.',
      code: `flowchart TB
    S["**Step: charge the card**"]

    S --> A["**Crash BEFORE the call**<br/>nothing happened"]
    A --> A1["replay re-attempts<br/>→ **correct**, and free"]

    S --> B["**Crash AFTER the call,<br/>BEFORE the record**"]
    B --> B1["the card IS charged<br/>the history says nothing<br/>→ replay charges **again**"]
    B1 --> B2["**This window cannot be closed.**<br/>The side effect and the record<br/>are in different systems, so no<br/>transaction spans them.<br/><br/>**The only defence is at the<br/>receiver:** an idempotency key<br/>derived from *(workflow, step)* —<br/>the same on every attempt"]

    S --> C["**Crash AFTER the record**"]
    C --> C1["replay reads the recorded<br/>result and moves on<br/>→ **correct**"]

    S --> D["**The call TIMES OUT**<br/>*(no crash at all)*"]
    D --> D1["**Not a failure — an unknown.**<br/>Treating it as failure is how<br/>double charges happen.<br/>Retry only if idempotent;<br/>otherwise **query before<br/>retrying**"]

    style B2 fill:#2a1a1a,stroke:#8c4a4a
    style D1 fill:#1c1814,stroke:#c99a4e
    style A1 fill:#17272a,stroke:#35897e
    style C1 fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `Temporal's documentation is the most useful reference here because it states the bargain plainly: **you write what looks like ordinary code, and in exchange you accept a restriction on what "ordinary" means.**

**The mechanism.** The workflow function runs; every step call is intercepted, dispatched, and its result appended to a history. **On recovery the function is executed again from the top** — but each step call, instead of executing, **returns the result already in the history.** Execution "fast-forwards" to where it stopped and continues live from there.

**Which makes the determinism requirement obvious rather than arbitrary.** **If the replayed function takes a different branch, it will request a different step than the history recorded** — and the runtime cannot reconcile that. **The error is a non-determinism error**, and it is reported as one.

**Three transferable lessons.**

**The constraint is the price of the abstraction.** **You get resumable multi-day functions, and you give up clocks, randomness and ambient I/O inside the orchestration.** **That is an unusually honest trade** — and it is worth recognising when a system offers you one.

**Separate orchestration from effects.** **The workflow decides what happens; steps do things.** This is good design independent of durability — **it makes the orchestration testable in isolation** — and here it is enforced rather than encouraged.

**And versioning is a first-class concern, not an afterthought.** **The documentation treats changing workflow code as a versioned operation** precisely because in-flight histories must keep replaying correctly. **Any system with long-lived state has this problem**; most discover it in production.

**Where this does not help.** It gives you durability and **not consistency across the systems you touch.** **Compensation is your design**, the failed-compensation path is your design, **and the question of whether a refund is an acceptable substitute for not having charged is a business question** the runtime has no opinion about.`,
  },

  tradeoffs: {
    intro:
      'The decisions durable execution involves, most of which trade programming freedom for survivability.',
    rows: [
      {
        option: 'In-memory async orchestration',
        whenItWins:
          'Short work — seconds — where a crash means an acceptable retry from the start.',
        whenItLoses:
          'Anything spanning a deploy, or holding external side effects between steps.',
        cost:
          'Every in-flight task lost on restart, with no record of where it stopped.',
      },
      {
        option: 'A job queue with a status column',
        whenItWins:
          'Simple pipelines with a handful of steps and no branching.',
        whenItLoses:
          'Complex control flow — the status column becomes an ad-hoc state machine nobody designed.',
        cost:
          'Reimplementing durable execution badly, one column at a time.',
      },
      {
        option: 'Durable execution as replayed code',
        whenItWins:
          'Genuinely complex control flow — loops, branches, dynamic composition.',
        whenItLoses:
          'The determinism constraint applies to code you write, and violations are subtle.',
        cost:
          'A restriction on the language, plus workflow versioning.',
      },
      {
        option: 'Durable execution as a declared state machine',
        whenItWins:
          'Few states, high stakes, and a need to inspect the workflow as data.',
        whenItLoses:
          'Verbose for complex logic, and awkward for dynamic step counts.',
        cost:
          'Expressiveness, in exchange for determinism by construction.',
      },
      {
        option: 'Blocking on an external event',
        whenItWins:
          'Waits of seconds, where holding the process is cheap.',
        whenItLoses:
          '10,000 concurrent waits are 10,000 processes, each one crash away from losing its work.',
        cost:
          'Memory proportional to concurrency, and no crash tolerance.',
      },
      {
        option: 'A durable wait — timer, signal or condition',
        whenItWins:
          'Any wait beyond seconds. 10,000 waits become 10,000 rows.',
        whenItLoses:
          'Needs a timeout and a designed timeout branch, which is easy to omit.',
        cost:
          'One more path to design, for unbounded cheap concurrency.',
      },
      {
        option: 'Per-attempt idempotency keys',
        whenItWins:
          'Nowhere. It looks correct and defeats the mechanism.',
        whenItLoses:
          'Every retry is a new key, so every retry duplicates the side effect.',
        cost:
          'The most common implementation error in this area.',
      },
      {
        option: 'Keys derived from (workflow, step)',
        whenItWins:
          'Every external side effect, without exception.',
        whenItLoses:
          'The receiving system must honour the key, which not all do.',
        cost:
          'A contract with every downstream service.',
      },
      {
        option: 'Treating a timeout as a failure',
        whenItWins:
          'Read-only calls, where it genuinely is one.',
        whenItLoses:
          'Mutating calls — a timeout is an unknown, and retrying it double-charges.',
        cost:
          'Duplicate side effects on exactly the calls where they matter most.',
      },
      {
        option: 'Query-before-retry on ambiguous failures',
        whenItWins:
          'Mutating calls to systems without idempotency support.',
        whenItLoses:
          'Adds a round trip and requires a queryable state on the far side.',
        cost:
          'Latency, for correctness on the worst case.',
      },
      {
        option: 'Compensation',
        whenItWins:
          'Multi-system workflows where partial completion must be undone.',
        whenItLoses:
          'It is not rollback — the customer and the ledger see both the charge and the refund.',
        cost:
          'A reverse path per step, and a human escalation when one fails.',
      },
      {
        option: 'Ordering irreversible steps last',
        whenItWins:
          'Always, where the ordering is free.',
        whenItLoses:
          'Sometimes the business requires the notification first.',
        cost:
          'Nothing, when available — which is why it is the first thing to try.',
      },
      {
        option: 'Recording the model\'s decision as a step',
        whenItWins:
          'Every durable agent loop — replay reads the decision rather than re-asking.',
        whenItLoses:
          'The replayed agent cannot reconsider, which is correct and occasionally surprising.',
        cost:
          'History size proportional to the trajectory.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The workflow is an async function that awaits each step in turn."',
      whyWeak:
        'All the state is in the call stack, so a deploy or a crash loses every in-flight workflow with no record of where it stopped — cards charged, inventory reserved, nobody notified. And a long wait holds a live process per workflow.',
      strongAnswer:
        '"Each step\'s result is written to a durable history before the next one starts, so a new worker reads the history and continues — which makes the process disposable, and that is the whole property. Waits become durable states rather than blocked calls: the workflow records \'waiting for delivery confirmation on order X\' and stops running, so ten thousand waiting orders are ten thousand rows and zero processes. A crash then costs nothing, because none of the work\'s state was ever in the process."',
    },
    {
      weakAnswer: '"We generate a fresh idempotency key for each attempt so each call is tracked."',
      whyWeak:
        'That inverts the mechanism. A key is how the receiver recognises a repeat, so a new key on retry means every retry is a new call — and durable execution retries aggressively, which makes duplicates more likely rather than less.',
      strongAnswer:
        '"The key is derived from the workflow id and the step, so every attempt of that step carries the same key and the receiver deduplicates. That matters because the guarantee is at-least-once: the crash can land between charging the card and recording it, and no transaction spans those two systems, so the window cannot be closed on my side. The only defence is at the receiver, which means idempotency is a precondition for durable execution to be safe rather than a defensive extra."',
    },
    {
      weakAnswer: '"The payment call timed out, so we marked it failed and retried."',
      whyWeak:
        'A timeout on a mutating call is not a failure, it is an unknown — the charge may have succeeded. Treating an unknown as a failure and retrying is precisely how double charges happen.',
      strongAnswer:
        '"I classify errors into three kinds. Transient — network, 5xx — retry with backoff. Terminal — validation, card declined — fail the step and do not retry. And ambiguous, which is a timeout on a mutating call: retry only if the call is idempotent, and otherwise query the far side for the state before retrying. The ambiguous class is the one that needs design, and it is the one people collapse into \'failure\' by default."',
    },
    {
      weakAnswer: '"We use Date.now() inside the workflow to decide whether the SLA has expired."',
      whyWeak:
        'Recovery re-executes the workflow function against the recorded history, so a clock read returns a different value on replay, the branch differs, and the replayed program requests a step the history does not contain — a non-determinism error that corrupts the workflow.',
      strongAnswer:
        '"Anything that could differ between runs goes through the runtime so its result is recorded: the workflow-provided clock, the workflow-provided random, and any I/O expressed as a step. The first execution computes it and every replay reads it back. The mental model is that workflow code is orchestration and must be pure with respect to the history, while all the impurity lives in steps — which is good separation independent of durability, and here it is enforced."',
    },
    {
      weakAnswer: '"If a later step fails we roll back the earlier ones."',
      whyWeak:
        'There is no transaction spanning a payment processor, an inventory service and a courier API, so rollback is not available. What exists is compensation, and calling it rollback hides that the charge and the refund are both real events with business consequences.',
      strongAnswer:
        '"Each step declares a compensation and they run in reverse on failure. Three things follow. Compensations are steps too, so they retry and must be idempotent. A compensation can itself fail, and that path needs a human escalation, because the system cannot reach a consistent state alone — that is the path usually missing. And some steps cannot be compensated at all: an email is sent. So the first design move is ordering — put the irreversible steps last, after the reversible work has already succeeded."',
    },
    {
      weakAnswer: '"We deploy the new workflow code and everything picks it up."',
      whyWeak:
        'In-flight workflows replay their old histories against the new code. Insert a step and the replay reaches a point where the recorded order no longer matches the program, which is a non-determinism failure on workflows that were running fine.',
      strongAnswer:
        '"Changing workflow code is a versioned operation. In-flight workflows continue on the logic they started with, and new ones start on the new version — which means the old code has to stay deployed until the longest-running workflow drains, and that is a real operational cost on a multi-day workflow. It is the same class of problem any system with long-lived state has, and durable execution just makes it explicit rather than letting it corrupt state silently."',
    },
  ],

  flashcards: [
    {
      id: 'fc-de-1',
      front: 'What does durable execution actually move?',
      back: 'The program counter and state, out of the process and into a database — which makes the process disposable.',
      topic: 'durable-execution',
    },
    {
      id: 'fc-de-2',
      front: 'What is the truth in a durable workflow?',
      back: 'The append-only history of completed steps and their results, written before the next step begins. Not the call stack.',
      topic: 'durable-execution',
    },
    {
      id: 'fc-de-3',
      front: 'How does recovery work?',
      back: 'The workflow function is re-executed from the top; completed steps return their recorded results rather than running again.',
      topic: 'checkpointing',
    },
    {
      id: 'fc-de-4',
      front: 'Why must workflow code be deterministic?',
      back: 'Replay must reach the same steps in the same order, or the recorded history no longer describes the program.',
      topic: 'workflows',
    },
    {
      id: 'fc-de-5',
      front: 'What is forbidden inside workflow code?',
      back: 'Clocks, randomness, config reads, direct I/O, unstable iteration order — anything that could differ between runs.',
      topic: 'workflows',
    },
    {
      id: 'fc-de-6',
      front: 'How do you use a clock or a random value in a workflow?',
      back: 'Through the runtime, so the first execution records the value and every replay reads it back.',
      topic: 'workflows',
    },
    {
      id: 'fc-de-7',
      front: 'Why is exactly-once impossible?',
      back: 'The crash can land between the side effect and the record of it, and no transaction spans those two systems.',
      topic: 'idempotency',
    },
    {
      id: 'fc-de-8',
      front: 'Where must the idempotency key come from?',
      back: '(workflow id, step) — the same on every attempt. A key generated per attempt defeats the mechanism entirely.',
      topic: 'idempotency',
    },
    {
      id: 'fc-de-9',
      front: 'What are the three error classes for a step?',
      back: 'Transient (retry with backoff), terminal (do not retry), ambiguous (a timeout on a mutating call — an unknown, not a failure).',
      topic: 'idempotency',
    },
    {
      id: 'fc-de-10',
      front: 'Why are durable waits cheap?',
      back: 'The workflow records "waiting for X" and stops running, so 10,000 waits are 10,000 rows and zero processes.',
      topic: 'checkpointing',
    },
    {
      id: 'fc-de-11',
      front: 'What does every wait need?',
      back: 'A timeout, and a designed timeout branch — a workflow waiting for a webhook that never arrives waits forever.',
      topic: 'checkpointing',
    },
    {
      id: 'fc-de-12',
      front: 'Why is compensation not rollback?',
      back: 'A refund is not the absence of a charge — the customer and the ledger see both, with different business consequences.',
      topic: 'compensation',
    },
    {
      id: 'fc-de-13',
      front: 'What are the three hard properties of compensations?',
      back: 'They must be idempotent, they can themselves fail (needing human escalation), and some steps cannot be compensated at all.',
      topic: 'compensation',
    },
    {
      id: 'fc-de-14',
      front: 'How does a durable agent loop handle the model\'s choice?',
      back: 'The model call is a step and its output is recorded, so replay reads the decision rather than re-asking — the same treatment as random().',
      topic: 'durable-execution',
    },
  ],

  quiz: [
    {
      id: 'q-de-1',
      kind: 'scenario',
      prompt:
        'A workflow charges a card, then the process crashes before the result is recorded. What happens on replay, and what is the fix?',
      options: [
        { id: 'a', label: 'It charges again — the only defence is an idempotency key derived from (workflow, step) that the receiver deduplicates' },
        { id: 'b', label: 'The runtime detects the charge and skips it' },
        { id: 'c', label: 'Nothing — the transaction rolls back' },
        { id: 'd', label: 'The workflow fails permanently' },
      ],
      correct: ['a'],
      explanation:
        'The side effect and its record are in different systems, so no transaction spans them and the window cannot be closed. This is exactly why the guarantee is at-least-once and why idempotency is a precondition rather than a defensive extra.',
      difficulty: 'core',
      topic: 'idempotency',
    },
    {
      id: 'q-de-2',
      kind: 'scenario',
      prompt:
        'Workflow code calls Date.now() to check whether an SLA has expired. What breaks?',
      options: [
        { id: 'a', label: 'Replay reads a different time, takes a different branch, and requests a step the history does not contain' },
        { id: 'b', label: 'Nothing — time is read-only' },
        { id: 'c', label: 'The workflow becomes slower' },
        { id: 'd', label: 'The history grows unboundedly' },
      ],
      correct: ['a'],
      explanation:
        'Recovery re-executes the function against the recorded history, so any value that differs between runs can change the path. The fix is the runtime-provided clock, whose value is recorded on the first execution and replayed thereafter.',
      difficulty: 'core',
      topic: 'workflows',
    },
    {
      id: 'q-de-3',
      kind: 'scenario',
      prompt:
        'Ten thousand orders are each waiting up to 48 hours for a delivery webhook. What does this cost in a durable design?',
      options: [
        { id: 'a', label: 'Ten thousand rows and zero running processes — the workflow records the wait and stops' },
        { id: 'b', label: 'Ten thousand processes holding memory' },
        { id: 'c', label: 'Ten thousand open connections to the webhook source' },
        { id: 'd', label: 'One process polling all ten thousand' },
      ],
      correct: ['a'],
      explanation:
        'A wait is a durable state rather than a blocked call, which is what makes multi-day workflows affordable. It also means a crash during the wait costs nothing — and it still needs a timeout, because a webhook that never arrives would otherwise wait forever.',
      difficulty: 'core',
      topic: 'checkpointing',
    },
    {
      id: 'q-de-4',
      kind: 'scenario',
      prompt:
        'A payment call times out. What is the correct interpretation?',
      options: [
        { id: 'a', label: 'An unknown, not a failure — retry only if idempotent, otherwise query the far side for the state first' },
        { id: 'b', label: 'A failure — retry immediately' },
        { id: 'c', label: 'A success — the request was sent' },
        { id: 'd', label: 'A terminal error — fail the workflow' },
      ],
      correct: ['a'],
      explanation:
        'The charge may have succeeded, so treating the timeout as failure and retrying is precisely how double charges happen. The ambiguous class is the one needing design, and it is routinely collapsed into "failure" by default.',
      difficulty: 'core',
      topic: 'idempotency',
    },
    {
      id: 'q-de-5',
      kind: 'scenario',
      prompt:
        'A team adds a validation step in the middle of a workflow and deploys. Multi-day workflows that were running start failing. Why?',
      options: [
        { id: 'a', label: 'In-flight workflows replay old histories against new code, and the recorded step order no longer matches the program' },
        { id: 'b', label: 'The new step is slow' },
        { id: 'c', label: 'The database schema changed' },
        { id: 'd', label: 'The idempotency keys collided' },
      ],
      correct: ['a'],
      explanation:
        'This is why changing workflow code is a versioned operation: in-flight workflows continue on the logic they started with, which means the old code stays deployed until the longest-running workflow drains.',
      difficulty: 'advanced',
      topic: 'workflows',
    },
    {
      id: 'q-de-6',
      kind: 'multi',
      prompt:
        'Which of these are true of compensation? Select all that apply.',
      options: [
        { id: 'a', label: 'Compensations are steps and therefore must be idempotent' },
        { id: 'b', label: 'A compensation can itself fail, which needs a human escalation path' },
        { id: 'c', label: 'Some steps cannot be compensated, so irreversible steps should go last' },
        { id: 'd', label: 'It restores the system to the state before the workflow started' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Compensation is not rollback: a refund is not the absence of a charge, and the customer, the ledger and the business consequences all record both. Claiming otherwise hides the difference at exactly the moment it matters.',
      difficulty: 'advanced',
      topic: 'compensation',
    },
  ],

  exercises: [
    {
      id: 'ex-de-1',
      kind: 'design',
      title: 'Make an agentic onboarding workflow durable',
      estimatedMinutes: 50,
      prompt: `A B2B product onboards new customer accounts. The flow today is a Python script run by hand:

1. Validate the signed contract PDF (an agent reads it and extracts terms).
2. Create the account in the billing system and take the first payment.
3. Provision infrastructure across three regions (each takes 5-20 minutes, occasionally fails).
4. An agent generates a tailored configuration from the contract terms.
5. Email the customer's admin an invite, and wait for them to accept — typically hours, sometimes a week.
6. Once accepted, run a verification suite and notify the account manager.

Failures today are handled by someone re-running the script and hoping.

**Part 1.** Identify every step's failure characteristics: is it idempotent, is it compensatable, is it ambiguous on timeout?

**Part 2.** Design the durable workflow. Say what is a step, what is a wait, and what is orchestration.

**Part 3.** Two steps involve an agent. Say how those are handled under replay.

**Part 4.** Design the compensation strategy, including the failure that cannot be compensated.

**Part 5.** Onboarding takes up to a week and the team deploys twice a week. Resolve that.

Then answer:

- What would you monitor?
- Where would a human be involved, and how?`,
      rubric: [
        'Every step classified on idempotency, compensatability and timeout ambiguity.',
        'Steps and waits distinguished correctly, with orchestration kept deterministic.',
        'Idempotency keys derived from workflow and step.',
        'Agent steps recorded so replay does not re-invoke the model.',
        'Compensation ordering is reverse, and irreversible steps are placed deliberately.',
        'Identifies the compensation that can fail and gives it an escalation path.',
        'Versioning strategy handles week-long workflows across deploys.',
        'Monitoring covers stuck workflows, not just failures.',
        'Human involvement is a durable state rather than an interrupt.',
      ],
      modelAnswer: `**Part 1 — failure characteristics per step**

\`\`\`
1. VALIDATE CONTRACT (agent reads PDF)
   idempotent?     YES — read-only, no external
                   effect
   compensatable?  N/A — nothing to undo
   ambiguous?      NO — a timeout means no result
   note            the MODEL OUTPUT is
                   non-deterministic, which is a
                   replay problem rather than a
                   failure problem (Part 3)

2. CREATE ACCOUNT + TAKE PAYMENT
   idempotent?     ONLY with a key. The billing
                   system supports idempotency
                   keys; the account creation must
                   too, or a retry creates two
                   accounts
   compensatable?  PARTIALLY — refund the payment,
                   and "deleting" an account is
                   usually a soft-delete that
                   leaves a record
   ambiguous?      YES, and this is the dangerous
                   one. A timeout on payment is an
                   unknown.
   → split it. Account creation and payment are
     two steps, because their failure and
     compensation characteristics differ.

3. PROVISION INFRA × 3 REGIONS
   idempotent?     Should be, via a deterministic
                   resource name derived from the
                   account id — "create if absent"
   compensatable?  YES — tear down. And teardown
                   is itself idempotent
   ambiguous?      YES — a provisioning call that
                   times out may have started
                   → query by the deterministic
                     name before retrying
   note            three INDEPENDENT steps, run in
                   parallel

4. GENERATE CONFIG (agent)
   idempotent?     Writing the config is, with a
                   key. The generation is not
                   deterministic (Part 3)
   compensatable?  YES — delete the config
   ambiguous?      NO

5. SEND INVITE + WAIT FOR ACCEPTANCE
   SEND: idempotent? only with a key — otherwise
         a retry sends a second email
         compensatable? NO. **An email cannot be
         unsent.** This is the irreversible step.
   WAIT: not a step at all — a durable state
         with a timeout

6. VERIFICATION SUITE + NOTIFY AM
   verification: idempotent YES (read-only)
   notify: idempotent with a key; NOT
           compensatable (another message sent)
\`\`\`

**Two observations that shape the whole design.**

**Step 2 must be split.** **Account creation and payment have different compensations, different ambiguity and different retry policies** — bundling them means a payment failure forces re-running account creation, **and a step is the unit of both recording and retry, so the bundling is a real cost.**

**And the irreversible steps are 5 and 6 — both emails.** **That is convenient, because they are already late in the flow.** **If they were not, the first design move would be to move them.**

---

**Part 2 — the durable workflow**

\`\`\`
ORCHESTRATION (deterministic — no clocks, no
random, no I/O)
  the sequencing, the branching on step results,
  the parallel fan-out, the compensation ordering

STEPS (recorded, retried)
  s1  extract_contract_terms(pdf_ref)   [agent]
  s2  create_account(account_id, terms)
  s3  charge_first_payment(account_id, amount)
  s4a provision_region(account_id, "eu-west")
  s4b provision_region(account_id, "us-east")   ← parallel
  s4c provision_region(account_id, "ap-south")
  s5  generate_config(terms, regions)   [agent]
  s6  apply_config(account_id, config)
  s7  send_admin_invite(account_id, email)
  s8  run_verification(account_id)
  s9  notify_account_manager(account_id, result)

WAITS (durable states, zero processes)
  w1  after s7: await signal "admin_accepted"
      timeout 7 days → escalation branch

IDEMPOTENCY KEYS
  every step: "{workflow_id}:{step_name}"
  → identical across every attempt of that step
  → provisioning additionally uses a deterministic
    resource name: "acct-{account_id}-{region}"
    so "create if absent" works even where the
    provider ignores keys
\`\`\`

**Three decisions worth defending.**

**The three provisioning calls are three steps, not one.** **Each retries independently** — a transient failure in ap-south should not re-attempt the two that succeeded — **and each records its own result, so a resumed workflow knows exactly which regions exist.** **A single step wrapping all three would retry all three, which is both wasteful and, without per-region idempotency, dangerous.**

**The wait has a seven-day timeout and the timeout is a real branch**, not an error. **"The admin never accepted" is a normal business outcome** — it escalates to the account manager, **and the workflow ends in a state that says so** rather than failing.

**And retry policies differ by step.**

\`\`\`
s3 charge_payment    3 attempts, exponential,
                     AMBIGUOUS handling: query the
                     payment processor by
                     idempotency key before each
                     retry
s4x provision        10 attempts, 60s backoff
                     (20-minute operations fail
                      transiently often)
s7 send_invite       3 attempts — but a duplicate
                     email is worse than a missing
                     one, so the key must be
                     honoured by the mail provider
                     or the step queries first
\`\`\`

*The s7 note is the kind of detail that decides whether this works:* **if the mail provider does not support idempotency keys, a retry sends a second invite.** **That must be established before the retry policy is written**, not discovered from a customer complaint.

---

**Part 3 — the two agent steps under replay**

**The model's output is non-deterministic, which would break replay** — the same problem as \`random()\`, **and it gets the same treatment.**

\`\`\`
The agent call is a STEP.
  first execution:  call the model, record the
                    OUTPUT in the history
  replay:           read the recorded output;
                    the model is NOT called again
\`\`\`

**So the extracted contract terms and the generated config are fixed once.** **A replay six hours later after a crash produces the same terms**, which is correct — **the workflow's decisions downstream were made on those terms, and re-deriving them could contradict work already done.**

**Two subtleties worth stating.**

**If the agent step is itself a loop, the loop is a child workflow.** **Step 1 is not one model call; it is read the PDF, extract, check for missing fields, maybe re-read.** **Each model call and each tool call is its own recorded step**, so a crash at turn nine of the extraction resumes at turn nine rather than restarting the extraction. **This is the durable-agent-loop pattern**, and it is where module 5.3's loop meets this lesson.

**And the model's output must be validated before it is recorded as a step result.** **A schema-invalid extraction recorded into history is permanent** — replay will faithfully reproduce the bad value forever. **So validation happens inside the step, and a validation failure is a step failure that retries**, which is the one place where re-invoking the model is correct.

*One thing I would deliberately not do:* **let the agent decide the workflow's control flow.** **Step 1 extracts terms; the orchestration decides what to do with them.** **If the model chose the next step, the orchestration would be non-deterministic and every branch would need recording** — which is possible, and much harder to reason about than keeping the model in leaf positions.

---

**Part 4 — compensation**

\`\`\`
Compensations, in reverse order:

  s6 apply_config      → delete_config
  s5 generate_config   → (nothing — no external
                          effect)
  s4x provision_region → teardown_region   × 3
  s3 charge_payment    → refund_payment
  s2 create_account    → deactivate_account
                          (soft — a record remains)
  s1 extract_terms     → (nothing)

  s7 send_invite       → **CANNOT BE COMPENSATED**
  s9 notify AM         → cannot be compensated
\`\`\`

**The irreversible step drives the design, and the answer is ordering.**

\`\`\`
Everything reversible happens BEFORE s7.
→ by the time an email leaves, the account
  exists, the payment is taken, the infra is
  provisioned and the config is applied
→ so a failure after s7 does not need to unsend
  anything; it needs to handle a customer who
  received an invite to something being unwound
\`\`\`

**And that case needs a human.** **If verification (s8) fails after the invite has gone out**, the compensation is not automatic: **the account manager is told, with the specifics**, and decides whether to fix forward or unwind with an explanatory email. **The workflow's job is to reach that state cleanly and stop**, not to improvise.

**The compensation that can fail: \`refund_payment\`.**

\`\`\`
Provisioning fails in ap-south after payment.
  → teardown eu-west ✓
  → teardown us-east ✓
  → refund_payment → the processor returns
    "refund window closed" or is down
  → THE SYSTEM CANNOT REACH CONSISTENCY
\`\`\`

**The escalation path, which is the thing usually missing:**

\`\`\`
1. Compensation retries with its own policy
   (it is a step)
2. On terminal failure, the workflow enters
   COMPENSATION_FAILED — a real terminal state,
   not an exception
3. A ticket is created with: the account, the
   amount, what was undone, what was not, and
   the error
4. Finance is paged for anything above a
   threshold
5. The workflow stays in that state until a
   human closes it — it does NOT retry forever
   and does NOT silently give up
\`\`\`

**\`COMPENSATION_FAILED\` as an explicit terminal state is the design point.** **A workflow that fails to compensate and then reports "failed" is indistinguishable from one that cleanly rolled back** — and the difference is money that left the company.

*And every compensation is idempotent under the same keying scheme*, because compensations are steps and steps retry.

---

**Part 5 — week-long workflows, twice-weekly deploys**

**Up to four code versions can be in flight simultaneously.** **The naive approach — deploy and hope — replays old histories against new code and produces non-determinism errors on workflows that were fine.**

\`\`\`
STRATEGY

1. Versioned workflow definitions.
   A workflow records its version at start and
   continues on that version to completion.
   → old code stays deployed until the longest
     workflow drains (7 days + the wait timeout)

2. Steps are NOT versioned the same way.
   Step implementations can be fixed in place —
   a bug in provision_region should be fixed for
   everyone, including in-flight workflows.
   → this is the key distinction: ORCHESTRATION
     is versioned, EFFECTS are not
   → and it means the orchestration must stay
     thin, which it should anyway

3. A deprecation window.
   A version may be retired once no workflow is
   running it. That is a query, and it should
   be on a dashboard.
   → in practice: ~10 days of support per
     version, so roughly 3 versions live
\`\`\`

**Point 2 is the one worth defending.** **Separating "the shape of the process" from "how a step does its work" means most changes — a bug fix, a new API endpoint, a retry tweak — need no versioning at all.** **Only changing the sequence does**, and that is rare compared to fixing effects.

**What I would not do: migrate in-flight workflows to new logic.** **It is technically possible and it means reasoning about a workflow whose history was produced by one program and whose future is another's** — **the class of bug that is found in production and never reproduced.** **Letting them drain is slower and comprehensible.**

*The operational consequence to state plainly:* **a change to the workflow's step sequence takes ten days to fully roll out.** **That is a real constraint on the team's velocity**, and it is worth knowing before choosing a week-long workflow shape — **it is an argument for keeping the orchestration stable and pushing variability into steps.**

---

**What I would monitor**

\`\`\`
STUCK, WHICH IS THE CATEGORY PEOPLE MISS
  · workflows in a state longer than its p99
      → a provisioning step at 3× its normal
        duration is stuck, not slow
  · workflows waiting on a signal past 80% of
    the timeout
      → the invite is about to expire; a human
        could still save it
  · the oldest in-flight workflow per version
      → drives the deprecation window

FAILURE
  · step failure rate by step and by error class
      → transient vs terminal separately, because
        a rise in terminal means a contract
        change upstream
  · retry counts per step — a step that always
    needs 3 attempts has a problem the retry is
    hiding
  · COMPENSATION_FAILED count — this is a PAGE,
    not a dashboard. It means money or state is
    inconsistent.
  · non-determinism errors — should be zero;
    any occurrence means a bad deploy

THROUGHPUT AND COST
  · end-to-end duration, p50/p95, split by
    "time working" vs "time waiting"
      → they have completely different meanings
        and averaging them hides both
  · agent step cost and token spend per
    onboarding

BUSINESS
  · invite acceptance rate and time-to-accept
  · onboardings requiring human intervention
\`\`\`

**The two I would watch hardest.**

**\`COMPENSATION_FAILED\`**, because it is the only state where the system has definitively left something inconsistent and **cannot fix it itself.** Everything else eventually resolves or retries.

**And "time working versus time waiting".** **A week-long onboarding that is six days of waiting for an admin is a product problem, not an engineering one** — **and reporting one duration makes that invisible.** Splitting them tells you whether to optimise the pipeline or chase the customer.

---

**Where a human is involved**

**Three places, all as durable states rather than as interrupts.**

\`\`\`
1. THE ADMIN ACCEPTING THE INVITE (w1)
   Not an approval — a required external event.
   Durable wait, 7-day timeout, escalation branch
   to the account manager.

2. COMPENSATION_FAILED
   A ticket, a page above a threshold, and the
   workflow parked until a human closes it.

3. VERIFICATION FAILURE AFTER THE INVITE
   The irreversible step has happened. The
   account manager decides fix-forward or unwind,
   because the right answer depends on the
   customer relationship.
\`\`\`

**The design principle: a human in a durable workflow is a state the workflow waits in, not a callback it blocks on.** **That is what makes "waiting three days for finance" cost a row rather than a process** — and it means the human's decision arrives as a signal, carrying an id so a double-click does not advance the workflow twice.

*And each human state needs the same three things as any wait:* **a timeout, an escalation for the timeout, and a record of who acted.** **The third matters here in a way it does not for a timer** — **"who approved this refund" is a question that gets asked**, and the history is where the answer lives.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-de-1',
      level: 'basic',
      question: 'What problem does durable execution solve?',
      guidance:
        'State in a process dies with the process. Look for "the history is the truth and the process is disposable" rather than a description of checkpointing.',
    },
    {
      id: 'iq-de-2',
      level: 'basic',
      question: 'What happens when the worker crashes mid-workflow?',
      guidance:
        'A new worker reads the history and replays, with completed steps returning recorded results rather than executing again.',
    },
    {
      id: 'iq-de-3',
      level: 'intermediate',
      question: 'Why can you not call Date.now() inside workflow code?',
      guidance:
        'Replay would read a different value and take a different path. Strong answers note that all impurity belongs in recorded steps.',
    },
    {
      id: 'iq-de-4',
      level: 'intermediate',
      question: 'Is this exactly-once? Why not?',
      guidance:
        'The crash lands between the side effect and its record, and no transaction spans them. At-least-once plus idempotency at the receiver.',
    },
    {
      id: 'iq-de-5',
      level: 'advanced',
      question: 'A step fails after three others succeeded. What now?',
      guidance:
        'Compensation in reverse, idempotent, with an explicit failure state when a compensation itself fails. And it is not rollback.',
    },
    {
      id: 'iq-de-6',
      level: 'advanced',
      question: 'How do you deploy new workflow code while workflows are running?',
      guidance:
        'Version the orchestration and let in-flight workflows drain; step implementations can be fixed in place. Look for that distinction.',
    },
    {
      id: 'iq-de-7',
      level: 'followup',
      question: 'How would you make an agent loop durable?',
      guidance:
        'Model calls become recorded steps, so replay reads the decision instead of re-asking — and each tool call is its own step.',
    },
    {
      id: 'iq-de-8',
      level: 'followup',
      question: 'The workflow waits a week for a human. What does that cost?',
      guidance:
        'A row, not a process — if the wait is a durable state. And it needs a timeout with a designed escalation branch.',
    },
  ],

  activeLearning: [
    {
      id: 'al-de-1',
      kind: 'debug',
      prompt:
        'A durable workflow has been running fine for months. After a release, some workflows fail with non-determinism errors, some customers are charged twice, and a few workflows appear stuck in a state nobody recognises. The release changed three things: a new validation step was added, a step was converted to run in parallel with its neighbour, and a retry policy was loosened. Diagnose it.',
      discussion: `**Three symptoms, three changes, and the mapping is not one-to-one** — which is what makes this worth working through rather than guessing.

**Symptom 1 — non-determinism errors.**

**The new validation step is the obvious cause**, and it is correct. **In-flight workflows replay their recorded history against the new code**, reach the point where the new step is inserted, **and find the program requesting a step the history does not contain.**

\`\`\`
History:  s1 ✓  s2 ✓  s3 ✓
New code: s1, s2, s2b(validate), s3
Replay:   s1 ✓  s2 ✓  → requests s2b
          → history says s3
          → NON-DETERMINISM ERROR
\`\`\`

*But the parallelisation change causes the same error for a different reason*, and this is the part that would be missed. **Converting two sequential steps to parallel changes the order in which they are recorded** — **an old history has s4 then s5; the new code may request them in either order.** **So two of the three changes produce the same symptom**, and fixing only the obvious one leaves half the workflows failing.

*Check:* **which step each failing workflow errored at.** **If failures cluster at two different points, both changes are implicated** — and that is a two-minute query against the history.

**Symptom 2 — double charges.**

**The loosened retry policy is the proximate cause and not the root cause.**

\`\`\`
Before: 2 attempts → the idempotency gap was
        rarely hit
After:  6 attempts → the same latent bug now
        fires often
\`\`\`

**So the retry change did not create the bug; it exposed one that was always there.** **And the likely bug is the classic one: the idempotency key is generated per attempt rather than derived from (workflow, step)** — which means every extra retry is a new charge.

*The other candidate is worse and worth checking:* **a timeout on the payment call being classified as terminal-then-retried**, or as transient without a query-before-retry. **More attempts means more timeouts means more double charges**, with a correct key doing nothing because the far side never saw the first request as the same call.

*Check:* **take a double-charged workflow, pull its step history, and compare the idempotency keys across attempts.** **Identical keys means the receiver is not honouring them — a vendor problem. Different keys means the derivation is wrong — our problem.** **That single comparison decides which.**

**Symptom 3 — workflows stuck in an unrecognised state.**

**This is the interesting one, because none of the three changes obviously causes it.**

**Hypothesis: they are workflows that hit a non-determinism error while in a compensation path, or between a step's side effect and its record, and the runtime parked them.** **A workflow that cannot replay cannot proceed and cannot compensate** — it has no valid program to run — **so it sits in whatever state the runtime uses for "cannot continue".**

**Which makes symptom 3 a consequence of symptom 1**, and it is the dangerous consequence: **those workflows may have live side effects — charged cards, provisioned resources — with no path to completion or unwinding.**

*Check:* **cross-reference the stuck workflows against the non-determinism errors by workflow id.** **If they match, this is confirmed**, and the priority changes completely — **these are not "stuck", they are abandoned mid-flight with real-world effects outstanding.**

**What I would do, in order.**

**Stop the bleeding: roll back the release.** **New workflows then start on the old code**, which halts the creation of new failures. **It does not fix the workflows already broken**, because those recorded their version at start — **which is exactly the versioning discussion, arriving as a production incident.**

**Triage the stuck workflows manually.** **For each: what side effects are recorded as complete?** Charged, provisioned, emailed. **Decide per workflow whether to compensate by hand or complete by hand.** **There is no automated path, which is the cost of having deployed a breaking change.**

**Reconcile the double charges against the payment processor**, and refund. **The processor's record is the truth here, not the workflow history** — **because the whole failure is that the history is missing charges that happened.**

**Then fix the underlying issues.**

\`\`\`
1. Workflow versioning, properly:
   record the version at start, run to completion
   on it, and keep old versions deployed until
   they drain
2. Idempotency keys derived from
   (workflow_id, step_name), asserted in a test
3. Timeout classification on mutating calls:
   ambiguous, with query-before-retry
4. A release check that fails the build if the
   step sequence changed without a version bump
\`\`\`

**Item 4 is the one that prevents recurrence**, and it is mechanical: **the step sequence is inspectable from the code, so a diff against the previous version can require an explicit version increment.** **Relying on people to remember is what produced this.**

**The instrumentation this demands.**

**Non-determinism error count, alerting at any non-zero value.** **It should be structurally impossible in a correctly versioned system**, so one occurrence is a bad deploy and deserves an immediate alert rather than a dashboard.

**Workflows in a non-progressing state for longer than their p99** — **the stuck category, which no failure metric catches** because nothing failed.

**Idempotency key reuse rate**: how often a step's retry presents a key the receiver has seen. **It should be non-zero — that means retries are happening and being deduplicated correctly** — and zero is suspicious, because it means either no retries or no deduplication.

**And in-flight workflow count by version**, which makes the deprecation window visible and would have shown, before the release, that hundreds of week-long workflows were about to have their program changed underneath them.

**Transferable:** **a loosened retry policy is a load test for your idempotency.** **The bug was always there, and the change only altered how often it fired** — which is the general shape of "we changed X and Y broke": **X frequently exposes a latent defect rather than introducing one**, and fixing X alone leaves the defect waiting for the next change.`,
    },
    {
      id: 'al-de-2',
      kind: 'what-changes-if',
      prompt:
        'Change the requirement: the workflow must now support cancellation at any point, initiated by a customer, including while a step is mid-execution. What does that add?',
      discussion: `**Cancellation is not a feature you add to a workflow; it is a second control flow running alongside the first** — and almost every hard part of durable execution reappears in it.

**What is easy.**

**Cancelling between steps.** **The workflow checks a cancellation flag at each step boundary and runs compensations** — which is barely more than what compensation already does. **If cancellation only had to work between steps, this would be a small change.**

**What is hard, and it is most of it.**

**Cancelling mid-step.** **A provisioning step is twenty minutes long.** The cancel arrives at minute eight. **Three options and none is free:**

\`\`\`
WAIT for the step to finish, then compensate
  + simple; the step's result is known
  − up to 20 minutes of "cancelling..."
  − and the step may have just taken a payment

INTERRUPT the step
  − the step is running in another process
    against an external system
  − you can stop waiting for it; you cannot
    stop it
  − so its effect is UNKNOWN, which is the
    ambiguous-timeout problem again

MARK cancelled, let the step complete, compensate
after
  + honest about what is actually possible
  + the step records its result, so compensation
    knows what to undo
  → the right default
\`\`\`

**The third is correct because of a property already established: you cannot un-send a request.** **"Interrupting" a step only stops you from hearing the answer** — **and not hearing the answer is strictly worse than hearing it**, because then compensation does not know what happened.

*Which gives the rule:* **cancellation is asynchronous by nature.** **A cancel request enters a state, and the workflow reaches a cancellable point before acting on it** — exactly like a signal.

**Cancellation must itself be durable.** **The cancel request is a signal with an id**, recorded in the history. **Otherwise a crash between "customer cancelled" and "workflow noticed" loses the cancellation**, and the workflow cheerfully completes something the customer stopped.

**And the cancellation path can fail**, which is the compensation problem inherited whole. **A cancel that cannot refund needs the same \`COMPENSATION_FAILED\` state and the same human escalation.**

**What genuinely new problems appear.**

**Races between cancellation and completion.**

\`\`\`
t=0   customer clicks cancel
t=0.1 the final step completes; the workflow
      finishes
t=0.2 the cancel signal is recorded
→ was it cancelled or completed?
\`\`\`

**The history's ordering is the answer, and it must be the ordering that decides** — **not the wall clock, and not which request the UI saw first.** **A workflow in a terminal state rejects the cancel and tells the customer it already completed**, which is honest and occasionally unwelcome.

**Cancellation during compensation.** **A customer cancels; compensation begins; the customer changes their mind.** **The correct answer is that compensation is not cancellable** — **it runs to completion or to \`COMPENSATION_FAILED\`** — because a half-compensated workflow is the worst state available, and allowing it doubles the state space for a case nobody needs.

**And the irreversible-step boundary becomes customer-visible.** **Before the invite email, cancellation is clean.** **After it, cancellation means the customer's admin received an invite to an account being deleted** — **so the product needs to say so**, and "cancel" means something different on each side of that line. **That is a product decision the workflow design has just forced into the open**, which is usually a good thing.

**What I would add.**

\`\`\`
· a cancellation signal, durable, id-deduplicated
· a cancellation check at every step boundary,
  and explicitly NOT mid-step
· steps declare whether they are interruptible
  (read-only ones can be abandoned; mutating
  ones cannot)
· CANCELLING as a real state, distinct from
  CANCELLED — the customer sees progress
· compensation is non-cancellable, by rule
· terminal states reject cancellation and say why
· a cancellation point-of-no-return, surfaced in
  the product before the customer commits
\`\`\`

**\`CANCELLING\` as a distinct state is the small thing that matters most operationally.** **A cancellation taking twenty minutes is fine if the customer can see it happening**, and alarming if the UI says nothing — **and it is the same argument as a partial result on budget exhaustion: the system knows something useful, so it should say it.**

**The transferable point: adding cancellation adds a second control flow, and the two interact at every point where the first one has state.** **Most of its difficulty is not new — it is the same ambiguity, the same compensation, the same signal-durability problem seen from a different direction** — **which is a good sign that the original model was the right one.** **If cancellation had required a fundamentally new mechanism, the durability design would have been wrong.**`,
    },
  ],

  revision: {
    bullets: [
      'Durable execution moves the program counter and state out of the process and into a database.',
      'The append-only history of completed steps is the truth; the process is disposable.',
      'Recovery is replay: the function re-executes and completed steps return recorded results.',
      'So workflow code must be deterministic — no clocks, randomness, config reads or direct I/O.',
      'Anything non-deterministic goes through the runtime so its value is recorded once and replayed.',
      'Orchestration is pure with respect to the history; all impurity lives in steps.',
      'The guarantee is at-least-once, because the crash lands between the side effect and its record.',
      'So every external call needs an idempotency key derived from (workflow, step).',
      'A key generated per attempt defeats the mechanism — the most common implementation error.',
      'A timeout on a mutating call is an unknown, not a failure; query before retrying.',
      'Waits are durable states: 10,000 waits are 10,000 rows and zero processes.',
      'Every wait needs a timeout, and the timeout branch is a real path to design.',
      'Compensation runs in reverse, is itself a step, and must be idempotent.',
      'Compensation is not rollback — a refund is not the absence of a charge.',
      'A failed compensation needs an explicit terminal state and a human escalation.',
      'Order irreversible steps last, so the reversible work succeeds before anything permanent.',
      'Changing the step sequence is a versioned operation; step implementations are not versioned.',
      'An agent loop becomes durable by recording each model call as a step.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'An execution model where a workflow\'s progress lives in an append-only history rather than in a process: steps are recorded before the next begins, recovery replays the function against that history, waits are states rather than blocked calls, and partial failure is handled by compensation.',
    whyItExists:
      'Because work that spans deploys, external systems and human timescales cannot keep its state in memory — and once the state moves out, the process becomes disposable, which is the property everything else pays for.',
    whenToUse: [
      'Work spanning more than a single request, especially across a deploy.',
      'Workflows touching several external systems with side effects.',
      'Any wait longer than seconds — human approval, webhooks, timers.',
      'Agent loops that must survive restarts, with model calls as recorded steps.',
      'Idempotency keys derived from workflow and step, on every external call.',
      'Compensation declared per step, with irreversible steps ordered last.',
    ],
    whenNotToUse: [
      'Short synchronous work where a retry from the start is acceptable.',
      'A status column on a job row standing in for a state machine nobody designed.',
      'Clocks, randomness or config reads inside orchestration code.',
      'Idempotency keys generated per attempt.',
      'Treating a timeout on a mutating call as a failure.',
      'Blocking a process on a long external wait.',
      'Deploying a changed step sequence without versioning in-flight workflows.',
    ],
    alternatives: [
      'A declared state machine, where determinism by construction matters more than expressiveness.',
      'A simple job queue, for short pipelines with no branching.',
      'An event-driven choreography with an outbox, where central orchestration is unwanted.',
      'Manual re-runs, which is what "we handle failures by re-running the script" actually means.',
    ],
    tradeoffs: [
      'Durability buys a disposable process and costs determinism in workflow code.',
      'Replayed code buys natural control flow and costs a subtle constraint on what you may write.',
      'A state machine buys inspectability and determinism and costs expressiveness.',
      'Aggressive retries buy resilience and cost duplicate side effects without idempotency.',
      'Durable waits buy unbounded cheap concurrency and cost a timeout branch per wait.',
      'Versioned orchestration buys safe deploys and costs a drain window before retirement.',
    ],
    failureModes: [
      'A deploy losing every in-flight workflow with no record of where each stopped.',
      'A crash between the side effect and its record, charging twice on replay.',
      'A fresh idempotency key per attempt, making every retry a new call.',
      'A timeout on a payment classified as failure and retried.',
      'Date.now() in workflow code causing a non-determinism error on replay.',
      'A new step inserted mid-sequence breaking every in-flight history.',
      'Ten thousand blocked processes waiting on webhooks.',
      'A wait with no timeout, waiting forever for an event that never arrives.',
      'A compensation that fails, leaving state inconsistent with no escalation path.',
      'An irreversible step ordered early, so failure cannot be unwound.',
      'A loosened retry policy exposing a latent idempotency bug as duplicate charges.',
    ],
    followUpQuestions: [
      'Where does this workflow\'s state live?',
      'What happens if the worker dies at this exact point?',
      'Is this step idempotent, and what is the key derived from?',
      'What does a timeout on this call mean?',
      'Is this wait a state or a blocked process, and what is its timeout?',
      'What is the compensation for this step, and can it fail?',
      'Which steps are irreversible, and are they last?',
      'What happens when you deploy while workflows are running?',
      'Can you replay this workflow and get the same decisions?',
      'How would you find workflows that are stuck rather than failed?',
      'Where does a human enter this, and what state are they waiting in?',
    ],
  },
});
