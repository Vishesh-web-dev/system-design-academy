import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-agent-loops',
  title: 'Agent loops, planning, termination',
  summary:
    'An agent is a while-loop whose condition a language model evaluates. Everything hard about agents is a consequence of that — and most tasks called agentic are a workflow wearing a costume.',
  phase: 'ai',
  module: 'agents',
  position: 78,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 55,
  tags: ['agent-loops', 'termination', 'budgets', 'planning', 'workflows'],
  prerequisites: ['a-tool-calling'],
  resources: [
    {
      key: 'react-agent-paper',
      tier: 'must',
      note: 'Read it for the interleaving of reasoning and acting that every agent loop still uses. Seeing the pattern in its original, minimal form makes it obvious how little structure an agent actually is.',
    },
    {
      key: 'anthropic-building-effective-agents',
      tier: 'must',
      note: 'Read it for the workflow-versus-agent distinction, which is the most valuable idea in this lesson. Most systems described as agents have a fixed control flow and should be written as one.',
    },
    {
      key: 'llm-agent-survey',
      tier: 'good',
      note: 'Read it for the breadth of loop architectures people have tried and what each one was reaching for. It is useful mainly as a map of the design space rather than as a recommendation.',
    },
    {
      key: 'anthropic-agent-sdk-docs',
      tier: 'good',
      note: 'Read it for what a production harness actually provides around the loop — budgets, permissions, subagents, hooks. The gap between the paper and the harness is where the engineering lives.',
    },
    {
      key: 'swe-bench-paper',
      tier: 'good',
      note: 'Read it for what a hard agentic benchmark looks like and how progress is measured. It is a useful corrective to demos, because the tasks are real and the scores are honest.',
    },
    {
      key: 'tree-of-thoughts',
      tier: 'advanced',
      note: 'Read it for search over reasoning states rather than a single trajectory. It is the clearest statement of what you buy by exploring alternatives and what it costs, which is the same trade a retry budget makes implicitly.',
    },
  ],

  intuition: {
    body: `**An agent is a loop:**

\`\`\`
while (not done):
    ask the model what to do next
    execute the tool it asked for
    put the result back in the context
\`\`\`

**That is genuinely all of it.** The architecture is trivial, **and every difficulty comes from one property: the loop condition is evaluated by a language model.**

\`\`\`
A normal while-loop terminates because a
deterministic condition becomes false.
An agent loop terminates because the model
decides it is finished — or because you stopped it.
\`\`\`

**So termination is not guaranteed, it is imposed.** **Every production agent needs an external budget**, and a system relying on the model's own sense of completion **will occasionally run until something else breaks.**

**Then the second property: the context grows every iteration.**

\`\`\`
turn 1:  prompt + 1 tool result
turn 10: prompt + 10 tool results, some large
turn 30: mostly transcript
→ cost per turn RISES as the task progresses
→ so the later turns — the expensive ones — are
  also the ones with the most distraction
\`\`\`

**Which means a loop that is going badly gets more expensive per turn as it goes**, and a failing agent costs more than a successful one.

**Third: the loop has failure modes a straight-line program does not.**

\`\`\`
STUCK      the same failing call, over and over
OSCILLATE  A, then B, then A again
DRIFT      solving a different problem by turn 12
DECLARE    announcing success without doing it
\`\`\`

**All four look like progress from inside**, which is why the harness rather than the model has to detect them.

**And the most useful question in this lesson is whether you need a loop at all.**

\`\`\`
Fixed steps, known order  → a workflow. Testable,
                            cheap, debuggable.
Steps depend on findings  → an agent. Flexible,
                            expensive, hard to test.
\`\`\`

**Most tasks described as agentic are the first one**, and writing them as a loop **buys nothing and pays for everything.**`,
    analogyLimit:
      '"The model decides what to do next" skips that the loop condition is also the model\'s, so termination is imposed rather than achieved. It hides that context grows every turn, making a failing agent cost more per turn the longer it fails; that stuck, oscillating and drifting loops all look like progress from inside, so the harness must detect them; and that most tasks called agentic have a fixed control flow and belong in a workflow, which is cheaper and testable.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds a research agent: given a question, it searches, reads pages, and writes a report. The loop runs until the model outputs a final answer. In testing it works. In production, 8% of requests run for twenty minutes and produce nothing, and costs are four times the estimate. Identify four causes.',
      answer: `**Cause 1 — no budget, so the only termination is the model agreeing to stop.**

\`\`\`
while not done:  ← "done" is the model's opinion
\`\`\`

**On an easy question the model finishes in four turns.** On an ambiguous one **it keeps searching, because there is always another query to try** — and nothing in the loop says otherwise.

*The fix:* **three independent budgets**, because they bound different things:

\`\`\`
turns       e.g. 15  → bounds loop iterations
tokens      e.g. 200k → bounds context growth
wall clock  e.g. 3 min → bounds user-visible latency
→ whichever trips first ends the loop
\`\`\`

**And hitting a budget must produce a partial result**, not an error. **Twenty minutes of work discarded is the worst possible outcome** — worse than stopping at three minutes with what was found.

**Cause 2 — cost is superlinear in turns, so the 8% dominates the bill.**

**Each turn resends the whole context.** So the cost of an N-turn task is not N times a turn — **it is roughly the sum of a growing context.**

\`\`\`
4-turn task:    ~10 units
20-turn task:   ~210 units    (not 50)
→ a task taking 5× the turns costs ~20×
→ so the failing 8% can easily be most of the spend
\`\`\`

**Which reframes the budget as a cost control rather than a safety net**, and explains why the estimate was four times out despite most requests being fine.

**Cause 3 — no stuck detection, so a failing loop keeps failing productively-looking.**

\`\`\`
search("quantum error correction 2026")  → nothing
search("quantum error correction 2026")  → nothing
search("quantum error correction 2026")  → nothing
\`\`\`

**Each turn is a valid action.** **The model has no reliable memory of having just done this**, and from inside, a search returning nothing is a reason to search again.

*The fix:* **the harness tracks repeated calls and near-identical arguments**, and **intervenes** — injecting "this search has returned nothing three times; try a different approach or report what you have."

**Cause 4 — declared success is not checked.**

**A model that has run out of ideas frequently writes a plausible report anyway**, and the loop ends because a final answer was emitted. **Nothing verified that the report is grounded in what was retrieved.**

*The fix:* **a completion check the harness performs**, not the model — did it cite sources, are the sources real, does the output satisfy the stated requirements. **A failed check is another turn, with the specific gap named.**

**What the corrected loop looks like.**

\`\`\`
· turn, token and wall-clock budgets, whichever
  trips first
· partial results on budget exhaustion, always
· repetition and oscillation detection in the
  harness, with intervention
· a completion check separate from the model's
  claim of completion
· cost logged per request, alerting on the tail
\`\`\`

**The transferable point: every one of these controls lives outside the model.** **The model is the thing being controlled**, and a loop that asks it to control itself has no controller.`,
    },
  body: `## The loop, and where each problem attaches

\`\`\`
context = [system, task]
for turn in range(MAX_TURNS):
    response = model(context, tools)
    if response.is_final:
        if completion_check(response): return response
        context.append("incomplete: <what is missing>")
        continue
    for call in response.tool_calls:
        result = execute(call)        ← authorization
        context.append(result)        ← growth
    if stuck(context): intervene()    ← detection
    if over_budget(): return partial()← termination
\`\`\`

**Five attachment points, and they are the whole engineering:**

\`\`\`
execute()          → tool calling (previous lesson)
context.append()   → growth, cost, and memory
stuck()            → the harness sees what the
                     model cannot
over_budget()      → imposed termination
completion_check() → "done" is a claim, not a fact
\`\`\`

**The model is one line.** **Everything else is the harness**, which is why agent quality is mostly harness quality.

## Termination is imposed, not achieved

**Three budgets, bounding three different things**, and a system needs all three:

\`\`\`
TURNS       bounds iterations. Simple, and blind
            to how expensive each turn is.
TOKENS      bounds total spend and context growth.
            The one that actually tracks cost.
WALL CLOCK  bounds what the user experiences.
            Independent of both — one slow tool
            call can exhaust it in three turns.
\`\`\`

**Any one alone leaves a hole.** A turn budget permits twenty enormous turns; **a token budget permits a five-minute wait**; a clock budget permits unbounded spend if tools are fast.

**And what happens at the boundary is the design decision.**

\`\`\`
BAD   raise TimeoutError
      → all work discarded, user gets nothing,
        and the cost was still incurred
GOOD  ask the model for its best answer from what
      it has, with one final turn reserved for it
      → the budget must therefore be set slightly
        below the hard limit
\`\`\`

*Reserving the final turn is the part people miss.* **A budget that ends the loop the instant it trips has no turn left in which to summarise** — so the effective budget is N-1 and the last turn is spent producing something useful.

**Budgets should also be task-scoped rather than global.** "Look up this order" deserves three turns; **"investigate why this customer is unhappy" deserves fifteen** — and one global number is wrong for both. **Setting the budget at dispatch, from the task type, is cheap and effective.**

## The cost curve

**The property that makes agent economics unintuitive: every turn resends the context.**

\`\`\`
turn 1:  1 unit of context
turn 2:  2 units
...
turn n:  n units
Total ≈ n²/2
\`\`\`

**So doubling the turns roughly quadruples the cost**, and a task that takes four times as long costs sixteen times as much. **This is why a small tail of long-running requests dominates the bill** — and why a budget is a cost control first and a safety mechanism second.

**Three mitigations, in increasing order of effort.**

**Prompt caching**, where the stable prefix is not reprocessed. **It changes the constant substantially and not the shape** — the context still grows and the cost still rises with it.

**Result truncation.** A tool returning 40KB of JSON **puts 40KB into every subsequent turn.** Returning a summary with a handle to fetch detail **keeps the growth linear in useful information rather than in raw output** — and it is usually the single largest saving available.

**And compaction**: summarising older turns once the context passes a threshold, **keeping the task, the decisions and the current state while discarding the transcript.** This is the subject of the next lesson, and **it is what makes long-running agents possible at all.**

## Planning: upfront, incremental, or none

\`\`\`
NO PLAN       decide the next action each turn
              + adapts immediately to findings
              − drifts; no sense of overall progress

UPFRONT PLAN  produce a step list, then execute it
              + progress is measurable; steps are
                checkable
              − the plan was written before anything
                was known, so it is often wrong

INCREMENTAL   a rough plan, revised as facts arrive
              + adapts and retains direction
              − revision can become procrastination
\`\`\`

**The strongest argument for an explicit plan is not that the model executes it better** — **it is that the plan is inspectable.** A human can read it before work starts, **and the harness can measure progress against it**, which is otherwise impossible.

*And that enables the most valuable pattern here:* **plan, approve, execute.** For anything expensive or irreversible, **the plan is where a human intervenes cheaply** — much cheaper than reviewing fifteen tool calls after the fact.

**The failure to watch for is plan-following as a substitute for thinking.** **An agent that produced a wrong plan in turn one and follows it to turn fifteen** is worse than one with no plan at all, **because the plan gives its drift the appearance of method.** So a plan needs a revision trigger: **when a step fails twice, or a finding contradicts an assumption, the plan is re-derived rather than continued.**

## Detecting a loop that is going wrong

**The harness sees things the model structurally cannot**, because the model has no reliable memory of its own recent behaviour and the harness has the full history.

\`\`\`
REPETITION    the same tool with the same or
              near-identical arguments, 3×
              → the cheapest and most valuable check

OSCILLATION   A → B → A → B
              → two tools each undoing the other's
                premise; the model is not converging

NO PROGRESS   N turns with no new information,
              no state change, no new entity
              → harder to define and worth defining
                per task type

DRIFT         current actions unrelated to the
              original task
              → detectable by comparing recent calls
                against the task statement

BUDGET BURN   40% of the budget spent, and the plan
              shows 10% done
              → an early signal, when intervention
                is still cheap
\`\`\`

**And the intervention matters as much as the detection.**

\`\`\`
WEAK      stop the loop
          → the user gets nothing
BETTER    inject an observation into the context:
          "You have searched for X three times with
           no results. Either try a different
           approach or report what you have."
          → the model usually recovers
STRONGEST escalate to a human with the state
          attached, when the agent can act
\`\`\`

**Injection is remarkably effective** because the model's failure is usually not incapacity — **it is that nothing in its context told it the pattern was happening.** **Naming the pattern supplies exactly the missing information.**

## "Done" is a claim

**A model emitting a final answer has claimed completion**, and the claim is unverified. **Three checks, in increasing strength.**

**Structural.** Does the output have the required shape — the sections, the citations, the fields? **Cheap, deterministic, and catches the most common shortfall.**

**Grounding.** Are the cited sources real, and do they contain what is attributed to them? **This is the check that catches a plausible report written from nothing**, which is the characteristic failure of an agent that ran out of ideas.

**Task-specific.** Did it actually do the thing — is the file changed, does the test pass, was the ticket created? **The strongest check and the most work**, and it turns an agent's output into something assertable.

*And a failed check is not a failure:* **it is another turn, with the gap named specifically.** "The report cites three sources; two of them were not in your search results" **is actionable in a way that "incomplete" is not.**

## When a workflow beats an agent

**The most consequential question in this lesson, and it is usually asked too late.**

\`\`\`
A WORKFLOW when:
  · the steps are known and their order is fixed
  · the same input should produce the same path
  · you need to test it, debug it, and page on it
  · latency and cost must be predictable
  → write it as code. It is faster, cheaper,
    testable, and it cannot drift.

AN AGENT when:
  · the next step genuinely depends on what the
    last one found
  · the space of tasks is open-ended
  · a human would also need to explore
  → and accept the cost, the variance and the
    harness you now have to build
\`\`\`

**The tell is the diagram.** **If you can draw the flow chart, write the flow chart.** An agent whose control flow can be drawn **is an expensive, non-deterministic implementation of that drawing** — and it will follow it incorrectly some fraction of the time.

**And the hybrid is usually right.** **A deterministic pipeline with one agentic step**, or an agent whose tools are themselves workflows:

\`\`\`
classify (deterministic)
  → route (deterministic)
    → for the "investigate" branch only:
        agent loop with a 10-turn budget
    → every other branch: a fixed sequence
\`\`\`

**Most of the value with a small fraction of the variance**, and the agentic part is small enough to reason about.

## What to say in a design discussion

**That the loop condition is the model's, so termination is imposed by turn, token and clock budgets — whichever trips first, with a turn reserved for a partial answer.**

**That cost is roughly quadratic in turns**, which makes the budget a cost control and truncation the largest available saving.

**That the harness detects repetition, oscillation and drift**, and intervenes by naming the pattern rather than by stopping.

**That a plan's value is inspectability**, and that plan-approve-execute is where a human intervenes cheaply.

**That completion is checked structurally and by grounding**, not accepted as claimed.

**And that if the control flow can be drawn, it should be written** — with the agent reserved for the branch that genuinely needs to explore.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'loop-controls',
      title: 'The loop is three lines; the controls around it are the system',
      caption:
        'Step through it. Every control sits outside the model, because a loop that asks the model to police itself has no controller.',
      nodes: [
        { id: 'task', label: 'Task, with a budget set at dispatch', kind: 'client', x: 0, y: 160, detail: 'Budgets are task-scoped, not global: "look up this order" deserves three turns and "investigate why this customer is unhappy" deserves fifteen. One global number is wrong for both, and setting it from the task type is cheap.' },
        { id: 'model', label: 'Model: what next?', kind: 'external', x: 230, y: 160, detail: 'The only line the model owns. It proposes an action or claims completion — and both are claims, neither is a fact.' },
        { id: 'exec', label: 'Execute the tool', kind: 'service', x: 460, y: 160, detail: 'Where the previous lesson\'s controls live: identity bound by the executor, idempotency, blast radius. The loop makes retries certain rather than likely, which raises the stakes on all of it.' },
        { id: 'grow', label: 'Result appended — context grows', kind: 'store', x: 690, y: 160, detail: 'Every turn resends everything, so total cost is roughly n²/2 in turns. Doubling the turns quadruples the cost, which is why a small tail of long requests dominates the bill. Truncating large tool results is usually the single biggest saving.' },
        { id: 'stuck', label: 'Stuck detection: repetition, oscillation, drift', kind: 'service', x: 690, y: 20, detail: 'The harness sees what the model cannot, because the model has no reliable memory of its own recent behaviour. Three identical calls is the cheapest and most valuable check there is.' },
        { id: 'inject', label: 'Intervene by naming the pattern', kind: 'note', x: 460, y: 20, detail: '"You have searched for X three times with no results — try a different approach or report what you have." The failure is usually not incapacity; it is that nothing in the context said the pattern was happening.' },
        { id: 'budget', label: 'Budget trips — reserve a turn', kind: 'service', x: 230, y: 320, detail: 'Turns, tokens and wall clock bound different things, and any one alone leaves a hole. The effective budget is N-1: the last turn produces a partial answer, because twenty minutes of discarded work is worse than stopping early with something.' },
        { id: 'check', label: 'Completion check, not the model\'s claim', kind: 'service', x: 690, y: 320, detail: 'Structural (has the required shape), grounding (the cited sources are real and say that), task-specific (the file changed, the test passes). A failed check is another turn with the gap named, not a failure.' },
      ],
      edges: [
        { id: 'l1', source: 'task', target: 'model', kind: 'sync' },
        { id: 'l2', source: 'model', target: 'exec', kind: 'sync' },
        { id: 'l3', source: 'exec', target: 'grow', kind: 'write' },
        { id: 'l4', source: 'grow', target: 'stuck', kind: 'read' },
        { id: 'l5', source: 'stuck', target: 'inject', kind: 'control' },
        { id: 'l6', source: 'inject', target: 'model', kind: 'async' },
        { id: 'l7', source: 'budget', target: 'model', kind: 'control' },
        { id: 'l8', source: 'model', target: 'check', kind: 'sync' },
        { id: 'l9', source: 'check', target: 'model', kind: 'async' },
      ],
      steps: [
        {
          id: 'ls1',
          title: 'The loop itself is trivial',
          description:
            'Ask the model, execute what it asked for, append the result, repeat. The architecture is three lines and the engineering is everything attached to them.',
          nodes: ['task', 'model', 'exec'],
          edges: ['l1', 'l2'],
        },
        {
          id: 'ls2',
          title: 'And it gets more expensive as it goes',
          description:
            'Context grows every turn and every turn resends it, so a failing agent costs more per turn the longer it fails. Truncating large tool results is the first thing to do.',
          nodes: ['grow'],
          edges: ['l3'],
        },
        {
          id: 'ls3',
          title: 'The harness watches for patterns the model cannot see',
          description:
            'Three identical calls, A-B-A oscillation, actions drifting from the task. All of them look like progress from inside the loop.',
          nodes: ['stuck'],
          edges: ['l4'],
        },
        {
          id: 'ls4',
          title: 'Intervene by supplying the missing information',
          description:
            'Naming the pattern usually recovers the loop, because the model was not incapable — it simply had nothing telling it the pattern was occurring.',
          nodes: ['inject'],
          edges: ['l5', 'l6'],
        },
        {
          id: 'ls5',
          title: 'Then impose termination, and verify completion',
          description:
            'Whichever budget trips first ends the loop with a turn reserved for a partial answer. And a claim of being done is checked structurally and for grounding before it is believed.',
          nodes: ['budget', 'check'],
          edges: ['l7', 'l8', 'l9'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'workflow-or-agent',
      title: 'The question to ask before building a loop at all',
      caption:
        'Read the left branch as the default. An agent whose control flow can be drawn is an expensive, non-deterministic implementation of that drawing.',
      code: `flowchart TB
    Q["**Can you draw the flow chart?**"]

    Q -->|Yes| W["**Write the flow chart.**<br/>It is a workflow."]
    W --> W1["+ deterministic: same input,<br/>same path"]
    W --> W2["+ testable, debuggable,<br/>pageable"]
    W --> W3["+ predictable latency<br/>and cost"]
    W --> W4["+ **cannot drift**"]

    Q -->|No| A["**An agent loop**"]
    A --> A1["the next step genuinely<br/>depends on what the<br/>last one found"]
    A --> A2["the task space is<br/>open-ended"]
    A --> A3["− cost ≈ n²/2 in turns"]
    A --> A4["− variance, and a harness<br/>you must now build:<br/>budgets, stuck detection,<br/>completion checks"]

    W4 --> H["**Usually the answer is a hybrid**<br/><br/>classify → route *(deterministic)*<br/>→ the 'investigate' branch only:<br/>an agent loop, 10-turn budget<br/>→ every other branch: a fixed sequence<br/><br/>**Most of the value, a small fraction<br/>of the variance — and the agentic part<br/>is small enough to reason about**"]
    A4 --> H

    style W fill:#17272a,stroke:#35897e
    style A3 fill:#2a1a1a,stroke:#8c4a4a
    style A4 fill:#2a1a1a,stroke:#8c4a4a
    style H fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The ReAct paper is the most useful reference here because it shows the loop in its minimal form, **before any harness existed to obscure it.**

**The contribution is the interleaving.** Rather than reasoning fully and then acting, or acting without reasoning, **the model alternates** — a thought, an action, an observation, another thought informed by it.

\`\`\`
Thought:     I need the founding date.
Action:      search("Acme founding date")
Observation: [results]
Thought:     The results mention 1994 but also
             a predecessor. I should check which.
Action:      search("Acme predecessor company")
\`\`\`

**Why it works is the part worth internalising: the observation changes the reasoning.** **A plan made before the first search cannot know what the search returns**, so reasoning that incorporates results as they arrive outperforms both alternatives — **and that is the entire argument for an agent over a workflow, stated in its original form.**

**Three transferable lessons.**

**The explicit thought is doing work.** It is not decoration: **writing the reasoning before the action improves the action**, and it also gives the harness something to inspect when diagnosing a loop that went wrong.

**The loop is minimal by design.** The paper adds no planner, no memory system, no critic — **which is a useful reference point when a design accumulates components.** Each addition should justify itself against this baseline.

**And the observation is the control signal.** **The loop is only as good as what comes back from the tool** — which connects directly to the previous lesson: **an unhelpful error is an observation that cannot improve the next thought.**

**Where the paper stops.** It says nothing about termination, budgets, cost, stuck detection or completion verification — **all of which are production concerns that appear the moment the loop runs on someone else's request.** **The paper is the algorithm; the harness is the system**, and confusing the two is why demos look easy and deployments do not.`,
  },

  tradeoffs: {
    intro:
      'The decisions an agent loop involves, most of which trade flexibility against predictability.',
    rows: [
      {
        option: 'A deterministic workflow',
        whenItWins:
          'Known steps in a known order — which covers most tasks described as agentic.',
        whenItLoses:
          'Genuinely open-ended tasks where the next step depends on findings.',
        cost:
          'Coverage: an unanticipated case has no path.',
      },
      {
        option: 'An agent loop',
        whenItWins:
          'Exploration, where a human would also have to look and then decide.',
        whenItLoses:
          'Anything needing predictable cost, latency or a testable path.',
        cost:
          'Quadratic cost in turns, variance, and a harness to build.',
      },
      {
        option: 'A hybrid — deterministic flow with one agentic branch',
        whenItWins:
          'Almost always, in practice.',
        whenItLoses:
          'Requires knowing which branch needs exploration, which needs the traffic to tell you.',
        cost:
          'Two things to maintain instead of one.',
      },
      {
        option: 'A turn budget alone',
        whenItWins:
          'Simple protection against an infinite loop.',
        whenItLoses:
          'Twenty enormous turns satisfy it while blowing the cost and the clock.',
        cost:
          'Two uncovered dimensions.',
      },
      {
        option: 'Turn, token and clock budgets together',
        whenItWins:
          'Production. Each bounds something the others do not.',
        whenItLoses:
          'More to tune, and a badly set budget truncates good work.',
        cost:
          'Tuning per task type.',
      },
      {
        option: 'Erroring on budget exhaustion',
        whenItWins:
          'Nowhere. The cost was incurred either way.',
        whenItLoses:
          'All work is discarded and the user gets nothing.',
        cost:
          'The worst outcome available.',
      },
      {
        option: 'Reserving a turn for a partial answer',
        whenItWins:
          'Always — something useful from an exhausted budget.',
        whenItLoses:
          'The effective budget is one turn smaller.',
        cost:
          'One turn, for the difference between nothing and something.',
      },
      {
        option: 'No plan, deciding each turn',
        whenItWins:
          'Short tasks where the whole thing fits in a few turns.',
        whenItLoses:
          'Long tasks drift, and progress cannot be measured.',
        cost:
          'No inspectable intent.',
      },
      {
        option: 'An explicit upfront plan',
        whenItWins:
          'When a human should approve before expensive or irreversible work.',
        whenItLoses:
          'The plan was written before anything was known, and following it becomes method-shaped drift.',
        cost:
          'A revision trigger you must design.',
      },
      {
        option: 'Full tool output in the context',
        whenItWins:
          'Small results where the detail is genuinely needed.',
        whenItLoses:
          'A 40KB result is resent on every subsequent turn.',
        cost:
          'The largest avoidable contributor to the cost curve.',
      },
      {
        option: 'Summarised results with a fetch handle',
        whenItWins:
          'Large outputs — logs, documents, query results.',
        whenItLoses:
          'A summary can omit the detail that mattered.',
        cost:
          'One more round trip when the detail is needed.',
      },
      {
        option: 'Stopping a stuck loop',
        whenItWins:
          'When the failure is genuinely unrecoverable.',
        whenItLoses:
          'The model usually recovers if told what pattern it is in.',
        cost:
          'A discarded task that could have completed.',
      },
      {
        option: 'Injecting an observation naming the pattern',
        whenItWins:
          'Most stuck loops — the missing thing was information, not capability.',
        whenItLoses:
          'A genuinely blocked task consumes a few more turns before stopping.',
        cost:
          'A small amount of budget, for a large recovery rate.',
      },
      {
        option: 'Accepting the model\'s claim of completion',
        whenItWins:
          'Nowhere in production.',
        whenItLoses:
          'An agent out of ideas writes a plausible output and the loop ends.',
        cost:
          'Confident, ungrounded results shipped as finished work.',
      },
      {
        option: 'A completion check in the harness',
        whenItWins:
          'Always — structural cheaply, grounding where output is cited, task-specific where assertable.',
        whenItLoses:
          'A strict check costs turns re-running for small gaps.',
        cost:
          'Turns, in exchange for output that is actually done.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The loop runs until the model says it is finished."',
      whyWeak:
        'The loop condition is then the model\'s opinion, and on an ambiguous task there is always another thing to try. Termination stops being a property of the system and becomes a hope.',
      strongAnswer:
        '"Termination is imposed. I run three budgets — turns, tokens and wall clock — because each bounds something the others do not: a turn budget permits twenty enormous turns, a token budget permits a five-minute wait. Whichever trips first ends the loop, and I reserve the final turn to ask for the best answer from what has been gathered, so the effective budget is N-1. Erroring out on exhaustion is the worst available outcome, because the cost was incurred either way and the user gets nothing for it."',
    },
    {
      weakAnswer: '"Each turn costs about the same, so twenty turns costs five times four turns."',
      whyWeak:
        'Every turn resends the whole context, which grows each iteration. Total cost is roughly the sum of a growing context — about n²/2 — so five times the turns is nearer twenty times the cost.',
      strongAnswer:
        '"Cost is roughly quadratic in turns, which makes a small tail of long-running requests dominate the bill and explains estimates being several times out. That reframes the budget as a cost control first. The largest single saving is usually truncating tool results — a 40KB JSON response is resent on every subsequent turn, so returning a summary with a handle to fetch detail keeps growth proportional to useful information. Prompt caching helps the constant and not the shape; compaction is what actually bounds it for long tasks."',
    },
    {
      weakAnswer: '"If it gets stuck, the turn budget will stop it eventually."',
      whyWeak:
        'That converts a recoverable situation into a total loss at maximum cost. The model repeats a failing call because nothing in its context says it already did — it has no reliable memory of its own recent behaviour.',
      strongAnswer:
        '"The harness detects the patterns the model structurally cannot see: the same tool with near-identical arguments three times, A-B-A oscillation, and actions that have drifted from the task statement. Then it intervenes by injecting an observation naming the pattern — \'you have searched for this three times with no results, try a different approach or report what you have.\' That recovers most stuck loops, because the failure is almost never incapacity; it is that nothing told the model the pattern was happening. Stopping is the fallback, not the response."',
    },
    {
      weakAnswer: '"When the model produces a final answer, the task is done."',
      whyWeak:
        'A final answer is a claim. An agent that has run out of ideas frequently writes a plausible report from nothing, and the loop ends successfully because the shape was right.',
      strongAnswer:
        '"Completion is checked by the harness. Structurally first — does the output have the required sections, fields and citations, which is cheap and deterministic. Then grounding — are the cited sources real and do they contain what is attributed to them, which is the check that catches a report written from nothing. And where it is possible, a task-specific assertion: the file changed, the test passes, the ticket exists. A failed check is not a failure, it is another turn with the specific gap named, which is actionable in a way that \'incomplete\' is not."',
    },
    {
      weakAnswer: '"We built it as an agent so it can handle anything the user asks."',
      whyWeak:
        'Most tasks described as agentic have a fixed control flow. Implementing a known sequence as a non-deterministic loop pays quadratic cost and unpredictable latency for flexibility the task does not use, and it will follow the sequence incorrectly some fraction of the time.',
      strongAnswer:
        '"The test I use is whether I can draw the flow chart. If I can, I write the flow chart — it is deterministic, testable, debuggable, cheaper and it cannot drift. An agent is right when the next step genuinely depends on what the last one found, the way a human would also have to look before deciding. In practice the answer is usually a hybrid: a deterministic pipeline that routes, with an agent loop on the one branch that needs to explore, under a tight budget. That is most of the value with a small fraction of the variance."',
    },
    {
      weakAnswer: '"We have it write a plan first, so it stays on track."',
      whyWeak:
        'A plan written before anything is known is frequently wrong, and an agent following a wrong plan to turn fifteen is worse than one with no plan — the plan gives its drift the appearance of method.',
      strongAnswer:
        '"The plan\'s real value is inspectability: a human can read it before the work starts, and the harness can measure progress against it, which is otherwise impossible. That enables plan-approve-execute, which is where a human intervenes cheaply on anything expensive or irreversible — far cheaper than reviewing fifteen tool calls afterwards. But it needs a revision trigger: when a step fails twice or a finding contradicts an assumption, the plan is re-derived rather than continued. Without that, plan-following substitutes for thinking."',
    },
  ],

  flashcards: [
    {
      id: 'fc-al-1',
      front: 'What is an agent, structurally?',
      back: 'A while-loop whose condition is evaluated by a language model. The architecture is trivial; the difficulty all comes from that one property.',
      topic: 'agent-loops',
    },
    {
      id: 'fc-al-2',
      front: 'Why is termination imposed rather than achieved?',
      back: 'The loop ends when the model decides it is finished, so without an external budget a hard task runs until something else breaks.',
      topic: 'termination',
    },
    {
      id: 'fc-al-3',
      front: 'Name the three budgets and what each bounds.',
      back: 'Turns bound iterations, tokens bound spend and context growth, wall clock bounds user-visible latency. Each leaves a hole alone.',
      topic: 'budgets',
    },
    {
      id: 'fc-al-4',
      front: 'Why reserve a turn before the budget trips?',
      back: 'So the loop can produce a partial answer. Discarding twenty minutes of work is worse than stopping early with something useful.',
      topic: 'budgets',
    },
    {
      id: 'fc-al-5',
      front: 'Why is agent cost roughly quadratic in turns?',
      back: 'Every turn resends a context that grew last turn, so total cost is the sum of a growing context — about n²/2.',
      topic: 'budgets',
    },
    {
      id: 'fc-al-6',
      front: 'What is usually the largest available cost saving?',
      back: 'Truncating large tool results. A 40KB response is resent on every subsequent turn; a summary plus a fetch handle is not.',
      topic: 'budgets',
    },
    {
      id: 'fc-al-7',
      front: 'Name four ways an agent loop goes wrong.',
      back: 'Stuck (same failing call), oscillating (A-B-A), drifting (a different problem by turn 12), and declaring success without doing it.',
      topic: 'agent-loops',
    },
    {
      id: 'fc-al-8',
      front: 'Why must the harness detect stuck loops rather than the model?',
      back: 'The model has no reliable memory of its own recent behaviour; the harness has the full history and can see the pattern.',
      topic: 'agent-loops',
    },
    {
      id: 'fc-al-9',
      front: 'What is the best intervention for a stuck loop?',
      back: 'Inject an observation naming the pattern. The failure is usually missing information, not missing capability, so naming it recovers the loop.',
      topic: 'agent-loops',
    },
    {
      id: 'fc-al-10',
      front: 'What is a plan actually for?',
      back: 'Inspectability — a human can approve it before work starts, and the harness can measure progress against it.',
      topic: 'planning',
    },
    {
      id: 'fc-al-11',
      front: 'What is the failure mode of an explicit plan?',
      back: 'Plan-following substituting for thinking: a wrong plan followed to turn fifteen gives drift the appearance of method.',
      topic: 'planning',
    },
    {
      id: 'fc-al-12',
      front: 'Why is a final answer only a claim?',
      back: 'An agent out of ideas writes a plausible output and the loop ends successfully, because the shape was right and nothing checked the substance.',
      topic: 'termination',
    },
    {
      id: 'fc-al-13',
      front: 'Name the three completion checks.',
      back: 'Structural (required shape), grounding (cited sources real and saying that), task-specific (the file changed, the test passes).',
      topic: 'termination',
    },
    {
      id: 'fc-al-14',
      front: 'What is the test for workflow versus agent?',
      back: 'If you can draw the flow chart, write the flow chart. An agent whose control flow can be drawn is a costly non-deterministic version of it.',
      topic: 'workflows',
    },
  ],

  quiz: [
    {
      id: 'q-al-1',
      kind: 'scenario',
      prompt:
        'An agent averages 4 turns. A small fraction of requests take 20. Why do those dominate the bill?',
      options: [
        { id: 'a', label: 'Cost is roughly quadratic in turns, because every turn resends a context that grew — 5× the turns is nearer 20× the cost' },
        { id: 'b', label: 'Long requests use a more expensive model' },
        { id: 'c', label: 'They make more tool calls, and tools are the expensive part' },
        { id: 'd', label: 'They are retried more often' },
      ],
      correct: ['a'],
      explanation:
        'The context is resent in full each turn and grows each iteration, so total tokens are the sum of a growing series. This is why the budget is a cost control before it is a safety net, and why truncating tool results is the first optimisation.',
      difficulty: 'core',
      topic: 'budgets',
    },
    {
      id: 'q-al-2',
      kind: 'scenario',
      prompt:
        'An agent calls the same search with the same arguments five times. Why does it not notice?',
      options: [
        { id: 'a', label: 'Nothing in its context tells it the pattern is happening — each turn, searching again is a locally reasonable action' },
        { id: 'b', label: 'The model is not capable enough' },
        { id: 'c', label: 'The search tool is broken' },
        { id: 'd', label: 'The temperature is too high' },
      ],
      correct: ['a'],
      explanation:
        'From inside the loop, a search returning nothing is a reason to search again. The harness has the full history and can see the repetition, which is why detection belongs there — and why injecting an observation naming the pattern usually recovers it.',
      difficulty: 'core',
      topic: 'agent-loops',
    },
    {
      id: 'q-al-3',
      kind: 'scenario',
      prompt:
        'A task has known steps in a known order: fetch the record, validate it, enrich it, write it back. What should it be?',
      options: [
        { id: 'a', label: 'A workflow — deterministic, testable, cheaper, and it cannot drift' },
        { id: 'b', label: 'An agent, so it can handle exceptions' },
        { id: 'c', label: 'An agent with a strict turn budget' },
        { id: 'd', label: 'A multi-agent system, one per step' },
      ],
      correct: ['a'],
      explanation:
        'If the flow chart can be drawn, the agent is an expensive, non-deterministic implementation of that drawing, and it will follow it incorrectly some of the time. Exceptions are handled by branches in the workflow, or by routing one branch to a bounded agent.',
      difficulty: 'core',
      topic: 'workflows',
    },
    {
      id: 'q-al-4',
      kind: 'scenario',
      prompt:
        'The wall-clock budget trips at three minutes. What should the loop do?',
      options: [
        { id: 'a', label: 'Use a reserved final turn to produce the best answer from what it has, flagged as partial' },
        { id: 'b', label: 'Raise a timeout error' },
        { id: 'c', label: 'Extend the budget once and continue' },
        { id: 'd', label: 'Silently return the last tool result' },
      ],
      correct: ['a'],
      explanation:
        'The cost was incurred regardless, so discarding the work is the worst outcome. Reserving the turn means the effective budget is N-1, which is the small price of returning something useful — and extending the budget just moves the same problem later.',
      difficulty: 'core',
      topic: 'budgets',
    },
    {
      id: 'q-al-5',
      kind: 'scenario',
      prompt:
        'A research agent returns a well-structured report citing four sources. Two of them never appeared in its search results. What failed?',
      options: [
        { id: 'a', label: 'The completion check — the loop accepted a claim of being done without verifying grounding' },
        { id: 'b', label: 'Retrieval recall' },
        { id: 'c', label: 'The turn budget was too low' },
        { id: 'd', label: 'The tool descriptions were unclear' },
      ],
      correct: ['a'],
      explanation:
        'This is the characteristic failure of an agent that ran out of ideas: a plausible output with the right shape, emitted as a final answer. A structural check passes it; a grounding check — are the cited sources real and do they say this — catches it.',
      difficulty: 'advanced',
      topic: 'termination',
    },
    {
      id: 'q-al-6',
      kind: 'multi',
      prompt:
        'Which of these must live in the harness rather than in the model\'s instructions? Select all that apply.',
      options: [
        { id: 'a', label: 'Ending the loop when the budget is exhausted' },
        { id: 'b', label: 'Detecting three identical tool calls' },
        { id: 'c', label: 'Verifying that cited sources appeared in the results' },
        { id: 'd', label: 'Deciding which tool to call next' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are controls, and a control the model enforces on itself is not a control — it also cannot reliably observe its own history. Choosing the next action is the model\'s job and the only part of the loop that should be.',
      difficulty: 'advanced',
      topic: 'agent-loops',
    },
  ],

  exercises: [
    {
      id: 'ex-al-1',
      kind: 'design',
      title: 'Design the loop for a codebase-maintenance agent',
      estimatedMinutes: 45,
      prompt: `Design an agent that handles small maintenance tasks on a real repository: "upgrade this dependency and fix the resulting breakages", "add a test for this function", "find and fix the cause of this flaky test".

It has tools to read files, search the codebase, edit files, run tests, and run a build. It works in a scratch branch; a human reviews the pull request.

**Part 1.** Decide which parts are a workflow and which need a loop, and justify the split.

**Part 2.** Specify the budgets, including what happens at each boundary.

**Part 3.** Design stuck detection for this specific domain, with the interventions.

**Part 4.** Specify the completion check.

**Part 5.** The three tasks differ in how well the loop will work. Rank them, with reasoning.

Then answer:

- How do you keep the context from growing unmanageably?
- What would you measure to know if this is working?`,
      rubric: [
        'Identifies deterministic scaffolding around an agentic core.',
        'Three budgets specified with task-type variation.',
        'Boundary behaviour produces something useful rather than an error.',
        'Stuck detection uses domain-specific signals, not just repetition.',
        'Interventions inject information rather than only stopping.',
        'Completion check is task-specific and assertable.',
        'Ranks the three tasks with a defensible criterion.',
        'Context management addresses tool output volume specifically.',
        'Metrics that would reveal a degrading loop.',
      ],
      modelAnswer: `**Part 1 — what is a workflow and what needs a loop**

**The deterministic scaffolding is larger than people expect**, and putting it in the loop is the most common mistake here.

\`\`\`
WORKFLOW (deterministic, no model involved)
  1. create the scratch branch
  2. install dependencies, confirm a clean baseline
     → run the tests BEFORE any change
     → if they already fail, stop: the task is
       invalid and no agent can fix that
  3. [ AGENT LOOP ]
  4. run the full test suite
  5. run the linter and the build
  6. if clean: commit, push, open a PR with the
     agent's summary and its trajectory
  7. if not clean: back to the loop with the
     failures, up to a bounded number of rounds
  8. post the diff stat and the test delta on the PR
\`\`\`

**Two decisions worth defending.**

**The clean-baseline check is step 2 and not part of the loop.** **An agent asked to fix breakages in a repository that was already broken will chase failures it did not cause**, burn its whole budget, and produce a confusing diff. **One deterministic check prevents an entire class of expensive confusion**, and it is three lines.

**And the final verification loop (steps 4-7) is bounded and outside the agent's control.** **The agent does not decide whether its work is acceptable** — the test suite does. **This is the completion check from the lesson, made concrete by a domain where verification is genuinely mechanical**, which is unusually lucky.

**What genuinely needs the loop:** **reading code to understand it, deciding what to change, and reacting to test failures.** **The next step depends entirely on what the last one found** — a failing test names a file the agent had no reason to open — **which is the actual definition of when an agent is warranted.**

*The hybrid shape is the point:* **roughly seventy percent of the wall-clock work here is deterministic**, and only the middle needs a model in a loop.

---

**Part 2 — budgets**

\`\`\`
Per task type, set at dispatch:

  add a test          turns 12   tokens 150k  clock  5 min
  upgrade a dependency turns 25  tokens 400k  clock 20 min
  fix a flaky test    turns 30   tokens 500k  clock 30 min

Plus two domain-specific budgets:
  test-suite runs     max 8   (each costs minutes)
  files edited        max 15  (a larger blast radius
                               than these tasks warrant)
\`\`\`

**Three decisions worth defending.**

**Test runs get their own budget because they are the dominant cost and it is wall-clock, not tokens.** **A suite taking four minutes means eight runs is thirty-two minutes** regardless of how few turns were used. **A budget in the wrong unit does not bind** — and this is the one most likely to be missed, because token budgets are the ones people think about.

**The files-edited budget is a blast-radius control**, borrowed from the tool-calling lesson. **A maintenance task touching fifteen files has gone wrong**, whatever the model believes, and the cap makes the review tractable. **It also fails in the right direction** — the agent stops and explains rather than producing an unreviewable diff.

**And the flaky-test budget is the largest because the task is genuinely the hardest**, which Part 5 argues. **Budget is where the difficulty assessment gets expressed** rather than in prose nobody reads.

**At each boundary:**

\`\`\`
TURN / TOKEN exhausted
  → reserved final turn: "summarise what you changed,
    what you learned, and what you would do next"
  → commit the work in progress to the branch
  → open a DRAFT PR with that summary
  → so a human inherits partial progress and the
    reasoning, rather than nothing

CLOCK exhausted
  → same, but likely mid-edit
  → run the tests once more so the PR states
    honestly whether the tree is broken

TEST-RUN budget exhausted
  → a specific signal: the agent is iterating on
    failures without converging
  → escalate with the last three failure outputs,
    which is exactly what a human needs to take over

FILES-EDITED exceeded
  → hard stop. Do not commit.
  → the scope was wrong, and a 20-file diff from a
    "add a test" task is not reviewable
\`\`\`

**The draft PR is the important design choice.** **Partial work with reasoning attached is worth considerably more than nothing**, and in this domain it is nearly free — **the branch already exists.**

---

**Part 3 — stuck detection for this domain**

**Generic repetition detection applies, and the domain-specific signals are far more useful.**

\`\`\`
1. SAME EDIT REVERTED
   file F edited, then edited back to its previous
   content
   → the classic oscillation, and unambiguous here
     because content is hashable
   → INJECT: "You changed src/x.ts and then reverted
     it. The previous approach failed for a reason
     you have not addressed — state what that reason
     is before editing again."

2. TEST FAILURE COUNT NOT DECREASING
   3 consecutive test runs with the same failure
   count, or rising
   → the strongest progress signal available, and
     it is free
   → INJECT: "Three runs, still 4 failures, and the
     same tests. Read the failure output carefully
     and state your hypothesis before the next edit."

3. SAME FILE READ REPEATEDLY
   the same file read 4+ times
   → it fell out of attention, or the agent is
     circling
   → RESPOND STRUCTURALLY: pin its content near the
     end of the context rather than injecting text.
     The problem is positional, not informational.

4. EDITING FILES UNRELATED TO THE FAILURES
   the failing tests are in module A; edits are
   in module C
   → drift, and it is cheaply detectable
   → INJECT: "The failing tests are in billing/.
     You are editing auth/. Explain the connection
     or return to the failing tests."

5. GROWING DIFF, NO IMPROVEMENT
   diff size rising across 3 runs while failures
   are flat
   → the most dangerous pattern: it looks like hard
     work and is accumulating risk
   → ESCALATE. Do not inject.
     A large, non-improving diff is not something
     the agent should be trusted to unwind.
\`\`\`

**Two observations.**

**Signal 2 is the one to build first.** **A test suite gives an objective progress metric**, which most agent domains do not have — **and "failures not decreasing" is a better stuck detector than any generic heuristic.**

**And signal 3's response is structural rather than textual**, which is worth noticing: **re-reading a file is a context-position problem**, so the fix is to move the content, not to tell the model about it. **Matching the intervention to the actual cause is what makes interventions work.**

---

**Part 4 — the completion check**

**This domain is fortunate: completion is mechanically verifiable**, so almost nothing rests on the model's claim.

\`\`\`
MECHANICAL (all must pass)
  · the full test suite passes
  · the linter passes
  · the build succeeds
  · no test was deleted or skipped
      → diff the test inventory before and after.
        THE MOST IMPORTANT CHECK HERE.
  · no assertion was weakened
      → heuristic: assertions removed from existing
        tests, flagged for review
  · the diff touches only files plausibly related
    to the task

TASK-SPECIFIC
  add a test:      a new test exists, it FAILS against
                   the pre-change code
                   → the only real proof the test
                     tests something
  upgrade a dep:   the lockfile shows the new version,
                   no other dependency changed
                   unexpectedly
  fix a flaky test: the test ran 50 times and passed
                   50 times
                   → the only honest verification of
                     flakiness

MODEL-CLAIMED (informational, never gating)
  the summary of what was changed and why
\`\`\`

**Three decisions worth defending.**

**The deleted-or-skipped-test check is non-negotiable.** **The cheapest way to make a test suite pass is to delete the failing test**, and an agent under budget pressure will find it. **This check is ten lines and it prevents the single worst outcome** — a green PR that removed coverage.

**"The new test fails against the old code" is the only real verification for a test-writing task.** **A test that passes both before and after asserts nothing**, and it is the characteristic failure of test generation. **Running it against the parent commit costs one extra test run and converts a plausible test into a proven one.**

**And fifty runs for a flaky test** is the only honest check. **A flaky test passing once proves nothing** — that was already true before the fix.

*What is deliberately not gating:* **the model's summary.** It goes in the PR description because it is genuinely useful to the reviewer, **and it has no authority.**

---

**Part 5 — ranking the three tasks**

**The criterion is not difficulty — it is whether success is mechanically verifiable and whether the feedback signal is reliable.**

\`\`\`
1. ADD A TEST FOR THIS FUNCTION          ← best fit
   · scope bounded: one function, one test file
   · verification mechanical: the test must fail
     before and pass after
   · feedback immediate and unambiguous
   · blast radius tiny: one new file
   · and a WRONG answer is cheap — a bad test is
     rejected in review, not shipped
   → a workflow with one agentic step would nearly
     do it

2. UPGRADE A DEPENDENCY AND FIX BREAKAGES
   · scope unbounded in principle: a major version
     bump can touch anything
   · verification mechanical: the suite passes
   · feedback good: compiler and test errors are
     specific and name locations
   · BUT: test-passing is necessary and not
     sufficient — a behavioural change with no test
     coverage passes silently
   → good fit, with the files-edited cap doing real
     work

3. FIND AND FIX A FLAKY TEST             ← worst fit
   · the feedback signal is NON-DETERMINISTIC,
     which breaks the loop's core assumption
   · "I ran it and it passed" is evidence of
     nothing
   · the agent cannot distinguish "fixed" from
     "got lucky" without ~50 runs per hypothesis,
     which is minutes each
   · so its natural strategy — edit, run, observe —
     produces misleading observations
   · and the most likely outcome is a change that
     appears to work: adding a sleep, increasing
     a timeout, or disabling the test
   → this is the task most likely to produce a
     confidently wrong fix
\`\`\`

**The generalisable criterion: an agent loop is only as good as the reliability of its observations.** **A noisy feedback signal is worse than a slow one**, because the agent draws confident conclusions from it — **and everything in the loop, including stuck detection, assumes the observation means what it says.**

*For the flaky test I would change the design rather than the budget:* **a deterministic harness runs the test 100 times first, collects the failure pattern and the actual error, and hands the agent that evidence.** **The agent then reasons about a stable artefact instead of a slot machine** — turning the worst-fit task into a merely hard one.

---

**How I would keep the context manageable**

**Tool output volume is the whole problem here**, and code tasks are the extreme case.

\`\`\`
1. TRUNCATE TEST OUTPUT AGGRESSIVELY
   A failing suite emits thousands of lines.
   Return: failure count, the first 3 failures with
   file, line and assertion message, and a handle
   for the rest.
   → this alone is often a 10× reduction

2. FILE READS RETURN RANGES, NOT WHOLE FILES
   A 2,000-line file read whole is resent every
   subsequent turn. Read the relevant range, with
   a handle to expand.

3. REPLACE EARLIER READS OF THE SAME FILE
   If a file is read at turn 3 and again at turn
   11, keep only the later one — and if it was
   edited between, the earlier content is actively
   WRONG and worse than absent.

4. THE DIFF IS THE STATE
   Rather than accumulating a transcript of every
   edit, maintain the cumulative diff and present
   THAT.
   → bounded by the size of the change, not by
     the number of turns
   → and it is what the agent actually needs to
     reason about

5. COMPACT AT 60% OF THE TOKEN BUDGET
   Summarise turns 1..n into: the task, what was
   tried, what was learned, the current diff, and
   the current failures. Keep the last 3 turns
   verbatim.
\`\`\`

**Item 4 is the domain-specific insight and the most valuable one.** **The cumulative diff is a compact, complete representation of the work so far** — **so the context can be made proportional to the size of the change rather than to the length of the conversation**, which is exactly what the cost curve needs.

*Item 3's second clause matters more than it looks:* **stale file content in the context is not merely wasteful, it is misleading** — the agent reasons about code that no longer exists, which produces edits that do not apply.

---

**What I would measure**

\`\`\`
OUTCOME
  · PR merge rate without human edits
      → the headline number: did it actually work
  · human edit size on merged PRs
      → a rising trend means quality is falling
        before the merge rate does
  · revert rate within 7 days
      → caught nothing that tests could not catch

LOOP HEALTH
  · turns per task type, p50 and p95
      → p95 rising is the cost signal
  · budget-exhaustion rate per task type
      → above ~10% the budget or the task
        selection is wrong
  · test runs per task
      → the wall-clock driver
  · stuck-intervention rate, and the recovery rate
    AFTER intervention
      → tells you whether interventions work, not
        just whether they fire

SAFETY
  · tests deleted or skipped — must be zero,
    and it is a page, not a dashboard
  · files-edited-cap breaches
  · diff size distribution, watching the tail

COST
  · cost per merged PR
      → the number that decides whether this is
        worth running at all
\`\`\`

**The two I would watch hardest.**

**Cost per merged PR**, because it is the only metric that combines everything — **a high success rate at an absurd cost is not a working system**, and a cheap agent that merges nothing is not either.

**And recovery rate after intervention.** **It is the metric that says whether the stuck detection is doing anything** — if interventions fire often and recovery is low, **the detection is right and the intervention text is wrong**, which is a cheap thing to fix and an easy thing to never notice.

*The safety metric is deliberately a page rather than a dashboard:* **a deleted test is the one outcome that silently removes protection**, and it should never be discovered in a weekly review.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-al-1',
      level: 'basic',
      question: 'What is an agent, structurally?',
      guidance:
        'A loop whose condition the model evaluates. Look for the recognition that the architecture is trivial and the harness is the system.',
    },
    {
      id: 'iq-al-2',
      level: 'basic',
      question: 'How does this loop terminate?',
      guidance:
        'Imposed budgets — turns, tokens, clock — with a reserved turn for a partial answer. Not the model deciding it is done.',
    },
    {
      id: 'iq-al-3',
      level: 'intermediate',
      question: 'Your agent costs four times the estimate. Where does the money go?',
      guidance:
        'The quadratic curve and the tail of long requests. Strong answers reach for tool-output truncation before anything else.',
    },
    {
      id: 'iq-al-4',
      level: 'intermediate',
      question: 'It keeps making the same failing call. What do you do?',
      guidance:
        'Harness-side repetition detection, then inject an observation naming the pattern. Stopping is the fallback, not the response.',
    },
    {
      id: 'iq-al-5',
      level: 'advanced',
      question: 'Should this be an agent at all?',
      guidance:
        'If the flow chart can be drawn, write it. Look for the hybrid — deterministic routing with one bounded agentic branch.',
    },
    {
      id: 'iq-al-6',
      level: 'advanced',
      question: 'How do you know the agent actually finished?',
      guidance:
        'Structural, grounding and task-specific checks in the harness. A final answer is a claim, and an agent out of ideas produces a plausible one.',
    },
    {
      id: 'iq-al-7',
      level: 'followup',
      question: 'What makes a task a bad fit for an agent loop?',
      guidance:
        'An unreliable feedback signal — the agent draws confident conclusions from noisy observations. A noisy signal is worse than a slow one.',
    },
    {
      id: 'iq-al-8',
      level: 'followup',
      question: 'What is the plan for, if the model may not follow it?',
      guidance:
        'Inspectability and progress measurement, which enables plan-approve-execute. And it needs a revision trigger, or it becomes method-shaped drift.',
    },
  ],

  activeLearning: [
    {
      id: 'al-loop-1',
      kind: 'what-changes-if',
      prompt:
        'Change one thing: the agent runs for hours or days rather than minutes — a research assistant given a week-long brief, resuming across sessions. What breaks, and what has to be added?',
      discussion: `**Almost everything about the loop survives and almost everything about the process around it changes**, because the assumptions that were free at minute-scale stop holding.

**What breaks first: the context cannot hold the task.**

\`\`\`
Minutes: 20 turns, context holds everything
Days:    2,000 turns, and the full transcript is
         orders of magnitude beyond any window
\`\`\`

**So compaction moves from an optimisation to the mechanism the system runs on.** **And it introduces a new failure: what gets discarded is decided by a summariser**, so a fact dropped at hour three **cannot be recovered at hour thirty** — the agent does not know it existed. **Compaction quality becomes a correctness property**, which is the subject of the next lesson and arrives here as a hard requirement.

**Second: the process must survive restart.** A minute-long loop tolerates a crash by re-running. **A thirty-hour loop cannot**, so state has to be durable:

\`\`\`
Per step, persisted:
  the action taken and its result
  the current working state (findings, decisions)
  the plan and its revision history
→ and resumption must be IDEMPOTENT: re-running
  after a crash must not repeat side effects
\`\`\`

**Which is the durable-execution problem**, and it is why that lesson follows this one. **The loop becomes a workflow with a model in it**, not a process.

**Third: budgets stop being a single number.**

\`\`\`
Minutes: one budget, trips once, task ends
Days:    a rate — spend per hour, with a total cap
         → plus checkpoints: "at 25% of budget, is
           the plan still right?"
         → plus a human-visible burn-down
\`\`\`

**And the partial-result reservation becomes continuous rather than terminal.** **The agent should be producing an inspectable artefact throughout** — a running document, a findings file — **so stopping at any moment yields something.** At minute-scale that was a nicety; **at day-scale a system that yields value only at the end is unacceptable**, because the probability of reaching the end intact is low.

**Fourth: drift becomes the dominant failure rather than an occasional one.**

\`\`\`
20 turns:    drift is visible in the transcript
2,000 turns: each turn is locally reasonable, and
             the cumulative direction can be far
             from the brief
→ and compaction ACCELERATES it, because the
  original framing gets summarised away
\`\`\`

*The mitigation is structural:* **the original brief is pinned verbatim and never compacted**, and **the harness periodically asks a separate check — "is the current work still serving this brief?"** — with the answer recorded. **Self-assessment inside the same context inherits the drift**, so the check needs its own.

**Fifth: the human relationship inverts.**

\`\`\`
Minutes: the human waits, then reviews the output
Days:    the human is a COLLABORATOR who must be
         able to look in, redirect, and answer
         questions
\`\`\`

**So the agent needs a way to ask and to be interrupted**, which a minute-scale loop does not:

\`\`\`
· pause points at natural boundaries, where a
  human can inspect and redirect
· a question queue: blocked on a decision, ask and
  continue on something else rather than guessing
· a daily digest: what was done, what was learned,
  what is next, what I would like decided
\`\`\`

**The "continue on something else" part is what makes it usable** — an agent that blocks on the first question wastes the whole window, **and an agent that guesses wastes the whole week.**

**What genuinely does not change.**

**The loop body is identical.** **Stuck detection is identical**, and more valuable — a stuck pattern costing four turns at minute-scale costs four hours here. **Completion checks are identical.** **The workflow-versus-agent question is identical**, and if anything sharper: **most of a week-long brief is still decomposable into deterministic steps**, and only some of it needs exploration.

**What I would add.**

\`\`\`
Durable state, idempotent resume
Compaction with a pinned, never-summarised brief
Budgets as a rate plus a total, with checkpoints
A continuously-updated output artefact
An external drift check with its own context
Pause points, a question queue, a daily digest
Cost-to-date visible to the human at all times
\`\`\`

**The transferable point: time-scale changes which failures dominate, not which failures exist.** **At minutes, cost and stuck loops dominate; at days, drift and state loss do** — **and the controls that were optional become the architecture.** **A day-scale agent is a durable workflow that happens to have a model choosing steps**, which is a different engineering object from a loop, wearing the same three lines of code.`,
    },
    {
      id: 'al-loop-2',
      kind: 'explain-yourself',
      prompt:
        'A colleague says: "We should make everything an agent — it is more flexible, and the model keeps getting better so the reliability problems will go away." Make the strongest case for their position, then say precisely where it fails.',
      discussion: `**The strongest version of their argument is better than it first sounds, and taking it seriously is how you find where it actually breaks.**

**The case for.**

**Flexibility has real value that a flow chart cannot express.** Every workflow encodes the cases someone anticipated. **A customer with a genuinely novel problem falls off the end of every branch**, and an agent at least tries — **which is not nothing, and the value is invisible in aggregate metrics because the alternative was "no path".**

**Maintenance cost is real and compounds.** **Twelve branches encoding twelve known cases must be updated as the domain changes**, and they rot. **An agent with good tools absorbs a thirteenth case without a deploy** — a genuine advantage that workflow advocates understate.

**And the trend argument has evidence behind it.** **Tasks that needed elaborate scaffolding two years ago now work with a plain loop.** **Building the scaffolding is investing in a workaround for a problem that is being fixed elsewhere** — and that has actually happened, repeatedly, which is why the argument is persuasive.

**Where it fails, and the failures are of different kinds.**

**Failure 1 — determinism is a requirement, not a limitation.**

**Some things must produce the same result every time**, and no amount of model improvement makes a sampled process deterministic.

\`\`\`
"Calculate the refund amount"
  → must be the same number every time
  → an agent that computes it correctly 99.9% of
    the time is WORSE than arithmetic, and the
    0.1% is a financial error nobody catches
\`\`\`

**This is not a reliability gap that closes.** **It is a category difference**, and the trend argument does not touch it.

**Failure 2 — cost does not trend the right way for this.**

**Per-token costs fall and agent cost is quadratic in turns**, so **a more capable model used more agentically can easily cost more.** **And latency is worse**: a workflow that takes 200ms cannot be replaced by a loop taking 30 seconds, **at any price** — the interaction is different.

**Failure 3 — testability is not a nice-to-have, and this is the deepest one.**

\`\`\`
Workflow: assert on the path AND the output
Agent:    assert only on the output, statistically
\`\`\`

**You cannot unit-test an agent's decision**, so verification becomes an eval set, which is expensive to build and maintain. **The lost testability is permanent and does not improve with the model** — **it is a property of non-determinism, not of capability.** And debugging follows: **"why did it do that" has no answer beyond the trajectory.**

**Failure 4 — the security boundary.**

**A workflow's capability is its code.** **An agent's capability is its tool surface, which is a much larger space**, and the previous lesson's point applies: **an agent reading untrusted content and holding tools is an attack surface a fixed pipeline simply does not have.** **A better model is not a smaller attack surface.**

**Failure 5 — the trend argument proves less than it claims.**

**Improving models make agents work on more tasks. They do not make an agent the right implementation of a task with a fixed control flow.**

\`\`\`
If the steps are fixed and known:
  a perfect model would execute them perfectly
  → and so does a for-loop, for free, instantly,
    testably
→ the agent's flexibility is spent on a task with
  nothing to be flexible about
\`\`\`

**Even at perfect reliability, the agent is a worse implementation** — slower, costlier, harder to debug — **which means the argument does not survive its own premise.**

**The synthesis, which is what I would actually say.**

**"You are right that the flexible boundary is moving, and I would build differently because of it."** **Use agents where exploration is genuinely needed, and make the deterministic parts deterministic** — not because agents are unreliable, **but because a known sequence is better expressed as a known sequence.**

\`\`\`
The decision is NOT "is the model good enough"
It is:
  Is the control flow known?      → workflow
  Must it be identical each time? → workflow
  Is the latency budget tight?    → workflow
  Must it be unit-testable?       → workflow
  Otherwise, and where a human
  would also have to explore      → agent
\`\`\`

**And the honest concession: build the agentic version first when you do not yet know the branches.** **Then harvest the deterministic paths out of it as traffic reveals them** — **which is the reverse of the usual advice and fits the trend argument properly.** **The agent is the discovery mechanism; the workflow is what you ship once you know.**`,
    },
  ],

  revision: {
    bullets: [
      'An agent is a while-loop whose condition a language model evaluates.',
      'So termination is imposed by budgets, never achieved by the model deciding it is done.',
      'Run turn, token and wall-clock budgets together — each bounds something the others do not.',
      'Reserve the final turn for a partial answer; discarding the work is the worst outcome.',
      'Cost is roughly n²/2 in turns, because every turn resends a context that grew.',
      'A small tail of long requests therefore dominates the bill.',
      'Truncating large tool results is usually the biggest available saving.',
      'Four loop failures: stuck, oscillating, drifting, and declaring success without doing it.',
      'All four look like progress from inside, so the harness detects them and the model cannot.',
      'Intervene by naming the pattern — the failure is missing information, not missing capability.',
      'A plan\'s value is inspectability: a human approves it before the expensive work starts.',
      'Plan-following can substitute for thinking, so a plan needs a revision trigger.',
      '"Done" is a claim — check structurally, check grounding, and assert task-specifically where possible.',
      'A failed completion check is another turn with the gap named, not a failure.',
      'If you can draw the flow chart, write the flow chart.',
      'The hybrid usually wins: deterministic routing with one bounded agentic branch.',
      'An agent is only as good as the reliability of its observations — a noisy signal is worse than a slow one.',
      'Build the agentic version to discover the branches, then harvest the deterministic paths out.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A loop that asks a model what to do, executes it, and appends the result — wrapped in a harness that imposes budgets, detects stuck and drifting behaviour, intervenes by naming the pattern, and verifies completion rather than accepting the claim.',
    whyItExists:
      'Because some tasks genuinely require deciding the next step from what the last one found — and because the model evaluates the loop condition, every control has to live outside it.',
    whenToUse: [
      'An agent where the next step depends on findings and a human would also have to explore.',
      'A workflow wherever the control flow can be drawn.',
      'A hybrid — deterministic routing with a bounded agentic branch — in most real systems.',
      'Three budgets together, scoped per task type, with a turn reserved for a partial answer.',
      'Harness-side repetition, oscillation and drift detection with informational interventions.',
      'Completion checks that are structural, grounding-based, and task-specific where assertable.',
    ],
    whenNotToUse: [
      'A loop for a task whose steps are known and ordered.',
      'Termination left to the model\'s sense of completion.',
      'A single budget dimension.',
      'An error on budget exhaustion, discarding all the work.',
      'Full tool output appended to a growing context.',
      'A stuck loop stopped rather than informed.',
      'A final answer accepted without verification.',
      'An agent whose feedback signal is non-deterministic.',
    ],
    alternatives: [
      'A deterministic workflow, for a known sequence.',
      'A single structured model call, where one step suffices.',
      'A workflow with one agentic branch, which is usually the right shape.',
      'A deterministic pre-processing harness that turns a noisy signal into a stable artefact.',
    ],
    tradeoffs: [
      'An agent buys adaptability and costs quadratic spend, variance and testability.',
      'A workflow buys determinism and costs coverage of unanticipated cases.',
      'A plan buys inspectability and costs the risk of method-shaped drift.',
      'Truncated tool results buy a flatter cost curve and cost a round trip for detail.',
      'A strict completion check buys real completion and costs turns.',
      'Tight budgets buy predictable cost and cost some genuinely-long successful tasks.',
    ],
    failureModes: [
      'A loop with no budget running until something else breaks.',
      'The cost tail dominating the bill through quadratic growth.',
      'A 40KB tool result resent on every subsequent turn.',
      'The same failing call repeated because nothing in the context named the pattern.',
      'A-B-A oscillation between two tools that undo each other.',
      'Drift into a different problem by turn twelve.',
      'A plausible final answer written by an agent that ran out of ideas.',
      'Cited sources that never appeared in the results.',
      'A known sequence implemented as a loop and executed incorrectly some of the time.',
      'A budget expressed in the wrong unit — tokens, where the cost is wall-clock test runs.',
      'An agent drawing confident conclusions from a non-deterministic observation.',
    ],
    followUpQuestions: [
      'How does this loop terminate, and in what units?',
      'What happens when the budget is exhausted?',
      'What does a turn cost at turn 20 versus turn 2?',
      'How would you know it is stuck, and what would you do about it?',
      'What does the harness do that the model cannot?',
      'How do you verify it actually finished?',
      'Could this be a workflow instead?',
      'Which branch genuinely needs to explore?',
      'How reliable is the feedback signal it is reasoning from?',
      'What does the context look like at turn 30?',
      'What does a human see while this is running?',
    ],
  },
});
