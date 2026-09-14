import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-agent-memory',
  title: 'Agent state and memory',
  summary:
    'An agent has no memory — it has a context window someone assembles every turn. Treating that assembly as a design problem, with three distinct tiers, is what separates a demo from a system.',
  phase: 'ai',
  module: 'agents',
  position: 79,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['agent-memory', 'context', 'compaction', 'state', 'retrieval'],
  prerequisites: ['a-agent-loops'],
  resources: [
    {
      key: 'anthropic-context-engineering',
      tier: 'must',
      note: 'Read it for the framing that the context window is a resource you curate rather than a bucket you fill. It is the clearest statement of why assembly is a design activity, and it names most of the techniques in this lesson.',
    },
    {
      key: 'mem-gpt-paper',
      tier: 'must',
      note: 'Read it for the operating-system analogy — a small fast tier, a large slow tier, and explicit paging between them. Whether or not you build it that way, the decomposition is the useful part.',
    },
    {
      key: 'lost-in-the-middle',
      tier: 'must',
      note: 'Read it for the evidence that position inside the context changes what gets used. It converts "keep the context small" from a cost argument into a quality argument, which is a different and stronger case.',
    },
    {
      key: 'langgraph-concepts',
      tier: 'good',
      note: 'Read the state and checkpointing sections. It is the most concrete treatment of agent state as a durable, typed object separate from the conversation, which is the distinction this lesson turns on.',
    },
    {
      key: 'anthropic-claude-code-agents',
      tier: 'good',
      note: 'Read it for how a real coding agent handles project memory and long sessions. The practices there — a persistent instructions file, explicit compaction — are this lesson applied to a domain you can inspect.',
    },
    {
      key: 'raptor-paper',
      tier: 'advanced',
      note: 'Read it as the retrieval-side analogue of compaction: summaries built at a higher level so a question about the whole thing has something to retrieve. The same idea applies to an agent\'s own history.',
    },
  ],

  intuition: {
    body: `**An agent does not remember anything.** Each turn is a fresh request carrying whatever text you chose to include — **so "memory" is a name for an assembly decision your code makes, over and over.**

\`\`\`
Turn 40 of a session:
  the model receives a string YOU built
  → what you put in, it knows
  → what you left out does not exist
\`\`\`

**Which reframes the problem usefully: this is not "how does the agent remember", it is "what goes in the window this turn".**

**Three tiers, and conflating them causes most of the trouble.**

\`\`\`
WORKING CONTEXT   what is in the window right now
                  Fast, small, expensive per token.
                  Lost when the turn ends.

DURABLE STATE     the facts the task depends on —
                  the plan, decisions made, the
                  current diff, the open ticket id.
                  Structured. Survives restarts.
                  Small.

LONG-TERM MEMORY  what should persist across
                  sessions — preferences, prior
                  outcomes, learned facts.
                  Large. Retrieved, not carried.
\`\`\`

**The common failure is treating the transcript as all three at once.** **It grows without bound, it holds the important facts in prose the model has to re-derive, and it cannot survive a restart.**

**And the reason to care is not only cost.**

\`\`\`
A 100k-token context is not 100k tokens of attention
→ material in the middle is used less reliably
→ so adding a fact can make an existing fact
  less likely to be used
\`\`\`

**Context is a zero-sum resource for attention as well as for money** — which makes curation a quality decision, not a budget one.

**Then compaction, which is what makes long agents possible and is where the danger lives:**

\`\`\`
Summarise turns 1..n → keep the task, the decisions,
the current state; discard the transcript.
→ and whatever the summariser drops is GONE.
  The agent cannot know it existed.
\`\`\`

**So compaction quality is a correctness property**, not an optimisation — **and what it must never drop is exactly what a good design has already written down elsewhere.**`,
    analogyLimit:
      '"Give the agent memory" hides that there is nothing to give: every turn is a fresh request over a string your code assembles. It collapses three different things — the working window, the durable task state, and cross-session knowledge — with different sizes, lifetimes and failure modes. And it misses that context is zero-sum for attention as well as cost, so adding a fact can make an existing one less likely to be used, and that compaction silently deletes what it does not carry.',
  },

  deepExplanation: {
    predict: {
      question:
        'A support agent keeps the full conversation in the context and appends every tool result. Sessions run 30-60 turns. Users report it forgetting things they said earlier, contradicting itself, and getting slower and more expensive as the conversation goes on. Identify four causes.',
      answer: `**Cause 1 — the important facts are buried in the middle, where they are used least.**

\`\`\`
Turn 3:  "My order number is A-88213 and I am in
          France, so VAT applies."
Turn 40: that sentence sits 30,000 tokens back,
          surrounded by tool output
→ the model does not "forget" it — it is present
  and outcompeted
\`\`\`

**Position matters**, so material in the middle of a long context is used less reliably than material at the edges. **The user's experience is forgetting; the mechanism is dilution.**

*The fix:* **extract the facts into durable state and re-render them near the end of every turn.**

\`\`\`
=== Case state ===
Order: A-88213  |  Country: FR (VAT applies)
Issue: not delivered, claimed 2026-03-02
Decided: refund approved up to £75
\`\`\`

**Fifty tokens, always present, always current** — **and it cannot be diluted because it is regenerated each turn rather than scrolling away.**

**Cause 2 — contradictions come from stale content still being present.**

\`\`\`
Turn 12: tool returns "status: processing"
Turn 31: tool returns "status: delivered"
→ BOTH are in the context
→ the model may cite either, and the earlier one
  reads as established fact
\`\`\`

**An append-only transcript has no notion of supersession**, so old observations compete with new ones on equal terms.

*The fix:* **tool results for the same entity replace rather than accumulate.** Keep the latest status, not every status ever observed — **and where history genuinely matters, keep it as an explicit timeline rather than as scattered residue.**

**Cause 3 — cost is quadratic and the transcript is the driver.**

**Every turn resends everything**, so a 60-turn conversation carrying full tool output **costs dramatically more than the same conversation carrying summaries.**

*The fix, in order of impact:* **truncate tool results at the boundary** (a 40KB JSON payload becomes a 200-token summary plus a handle), **then compact older turns** once the context crosses a threshold.

**Cause 4 — nothing survives a restart, so a crash loses the case.**

**If the process dies at turn 45, the entire state was in memory in a list of messages.** **The user restarts and re-explains everything**, which is the failure that most damages trust.

*The fix:* **durable state written after every turn**, small and structured, **so a new process can rebuild a working context from it** without the transcript.

**What the corrected design looks like.**

\`\`\`
· extracted case state, structured, persisted every
  turn, rendered near the end of the context
· tool results truncated at the boundary, and
  superseding rather than accumulating
· compaction above a threshold, with the state
  block never compacted
· the last few turns kept verbatim
· long-term memory (past cases, preferences)
  RETRIEVED when relevant, not carried
\`\`\`

**The transferable point: every fix moved information out of the transcript and into a structure.** **The transcript is a log, and a log is the worst possible place to keep the facts a decision depends on.**`,
    },
  body: `## The three tiers

**They differ in size, lifetime, cost and how they are accessed** — and a design that names them separately writes itself.

\`\`\`
WORKING CONTEXT
  size      thousands to hundreds of thousands
            of tokens
  lifetime  one request
  cost      paid in full, every single turn
  access    free — it is simply present
  rule      only what this turn needs

DURABLE STATE
  size      small — hundreds of tokens
  lifetime  the task
  cost      a write per turn
  access    rendered into every context
  rule      the facts the task depends on,
            structured, always current

LONG-TERM MEMORY
  size      unbounded
  lifetime  indefinite
  cost      a retrieval when needed
  access    searched, not carried
  rule      nothing is loaded until something
            makes it relevant
\`\`\`

**The most common mistake is using the transcript as all three.** It is unbounded like long-term memory, **carried in full like working context**, and **holds the task's facts in prose** — **so it has every tier's costs and none of their properties.**

*And the second mistake is the opposite:* **building an elaborate memory system before the simple tier does its job.** **Most agents need a good durable-state block and truncated tool results**, and nothing more — **the vector store over conversation history is usually solving a problem created by not having the state block.**

## Durable state is the highest-leverage structure

**A small typed object holding what the task depends on.**

\`\`\`
{
  task: "refund for undelivered order",
  order_id: "A-88213",
  customer_country: "FR",
  constraints: ["VAT applies", "cap £75"],
  decisions: [
    "confirmed not delivered (carrier: no scan
     since 02-03)",
    "refund approved, awaiting amount"
  ],
  open_questions: ["partial or full?"],
  step: 4
}
\`\`\`

**Four properties, each doing real work.**

**It is structured, so it can be validated, diffed and logged.** A fact in a JSON field **is checkable in a way that a fact in paragraph nine is not.**

**It is small, so it is rendered into every context.** **Always present and always current**, which removes the position problem entirely for the facts that matter most.

**It is durable, so a restart resumes rather than restarting.** **The state plus the last few turns is enough to continue** — which is the property that makes long-running agents possible.

**And it is the compaction anchor.** **Whatever else is summarised away, the state block survives verbatim** — so the riskiest part of compaction is bounded by design.

*Who writes it matters.* **The harness extracting it deterministically is reliable and limited; the model maintaining it is flexible and can drift.** **The practical answer is both** — the harness writes what it can observe (which tools ran, what they returned, which step), **and the model proposes updates to the interpretive fields** (decisions, open questions), **with the update validated against a schema.**

## Managing the working context

**Four techniques, in descending order of impact.**

**Truncate tool results at the boundary.** **The single largest saving in most agents.** A tool returning 40KB **puts 40KB into every subsequent turn** — so the tool returns a summary and a handle:

\`\`\`
"142 rows matched. First 5: [...]. Columns: id,
 status, total, created_at. Use fetch_rows(handle,
 offset) for more."
\`\`\`

**Growth becomes proportional to useful information rather than to raw output**, and the detail is one call away when it is genuinely needed.

**Supersede rather than accumulate.** **The second reading of the same file, the second status check on the same order** — **keep the later one only.** Stale content is not merely wasteful: **it is actively misleading**, because the model reasons about a state that no longer holds.

**Put the important things at the edges.** **The task and the state block near the end, the system framing at the start** — **because the middle is where material is used least reliably.** This costs nothing and is frequently ignored.

**And keep the last few turns verbatim.** **Recent context is where the current sub-problem lives**, and summarising it destroys exactly the detail the next action needs.

## Compaction

**When the context crosses a threshold, replace the older portion with a summary.** **It is what makes long agents possible, and it is the most dangerous operation in the system** — because what it drops is gone without trace.

\`\`\`
TRIGGER    at ~60-70% of the window, not at 100%
           → compaction itself needs room, and a
             threshold at the limit means a failure
             rather than a compaction

KEEP VERBATIM
           · the system framing and the original task
           · the durable state block
           · the last 3-5 turns
           · anything explicitly pinned

SUMMARISE  everything between: what was tried, what
           was learned, what was decided and why

DISCARD    raw tool output already reflected in the
           state or the summary
\`\`\`

**Three rules that prevent most compaction damage.**

**Never compact the original task.** **Drift after compaction is overwhelmingly caused by the framing being summarised into something vaguer** — "help the customer with their order" is not the task, **and by turn sixty it is all that is left.**

**Summarise decisions and their reasons, not events.** "Tried X, failed; tried Y, failed" **is a list of events that invites trying X again.** **"X and Y both fail because the account is in a suspended state" is a fact that prevents it** — and it is a tenth of the tokens.

**And write the summary before it is urgent.** **A compaction performed at 98% of the window is done under pressure and does a worse job**, because there is no room to be careful.

*One more property worth stating:* **compaction is lossy and irreversible from the agent's point of view.** **Keeping the pre-compaction transcript on disk costs almost nothing and makes post-hoc diagnosis possible** — the agent cannot see it, and you can.

## Long-term memory

**Cross-session knowledge: preferences, past outcomes, learned facts about a user or a codebase.** **The rule is that it is retrieved, not carried.**

\`\`\`
Wrong:  load everything known about this user into
        every context
        → grows without bound, dilutes everything
          else, and most of it is irrelevant
Right:  retrieve what this turn's situation makes
        relevant
        → which is the retrieval problem from module
          5.2, with the same failure modes
\`\`\`

**And the hard part is not storage — it is writing.** **Deciding what is worth remembering is a judgment**, and doing it badly produces a store full of noise that makes retrieval worse.

\`\`\`
Worth writing:   stable preferences ("always wants
                 the invoice emailed")
                 outcomes ("refund refused on this
                 account in March, reason: fraud
                 review")
                 corrections ("it is Ltd, not LLC")
Not worth it:    the transcript
                 restatements of durable state
                 anything true only for this task
\`\`\`

*Two properties that are easy to get wrong.* **Memories need provenance and a timestamp**, because a preference recorded eight months ago may no longer hold **and the agent must be able to say where a claim came from.** **And they need to be correctable** — a wrong memory retrieved confidently is worse than no memory, and it persists.

*And the scope question:* **memory about a user is personal data.** **It needs a retention policy, a deletion path, and a scope boundary** — a memory learned in one tenant's session must never surface in another's.

## Multi-agent context, briefly

**When one agent delegates to another, the context does not transfer** — **and that is the point.** A subagent gets a fresh window with a specific brief, **does its work, and returns a result rather than a transcript.**

\`\`\`
Parent: 40k tokens of context
  → subagent: "find every caller of processRefund
    and summarise what each expects"
  → subagent burns 60k tokens exploring
  → returns 300 tokens of findings
→ the parent's context grew by 300, not 60,000
\`\`\`

**So delegation is a context-management technique before it is a capability one** — which is most of the honest case for multi-agent systems, **and the subject of the next lesson.**

## What to say in a design discussion

**That there is no memory — only an assembly decision made every turn.**

**That the three tiers are distinct**, and the transcript is the wrong home for any of them.

**That durable state is a small structured object, persisted per turn, rendered near the end of every context, and never compacted.**

**That tool results are truncated at the boundary and supersede rather than accumulate.**

**That compaction triggers early, keeps the task and state verbatim, and summarises decisions rather than events.**

**That long-term memory is retrieved rather than carried**, with provenance, correctability and a scope boundary.

**And that delegation is a way to spend someone else's context** — the cheapest context management available.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'memory-tiers',
      title: 'Three tiers, and what each turn actually assembles',
      caption:
        'Step through it. The transcript is a log; every fact a decision depends on should have been lifted out of it into the state block before the log gets long.',
      nodes: [
        { id: 'turn', label: 'A turn begins — assemble the window', kind: 'client', x: 0, y: 170, detail: 'There is no memory to consult. Your code builds a string, and whatever is not in it does not exist for this turn. Naming this as an assembly decision rather than a memory problem is what makes it designable.' },
        { id: 'state', label: 'Durable state: small, structured, current', kind: 'store', x: 250, y: 40, detail: 'Order id, constraints, decisions made, open questions, current step. A few hundred tokens, persisted every turn, validated against a schema — and regenerated into each context so it can never scroll into the middle and be diluted.' },
        { id: 'ltm', label: 'Long-term memory: retrieved, not carried', kind: 'store', x: 250, y: 300, detail: 'Preferences, past outcomes, corrections. Unbounded, so nothing loads until this turn makes it relevant — which is the retrieval problem from module 5.2 with the same failure modes, plus provenance, correctability and a tenant scope boundary.' },
        { id: 'recent', label: 'Last 3-5 turns, verbatim', kind: 'note', x: 500, y: 300, detail: 'Where the current sub-problem lives. Summarising these destroys exactly the detail the next action needs, which is why compaction always leaves a verbatim tail.' },
        { id: 'compact', label: 'Older turns → a summary of decisions', kind: 'service', x: 500, y: 40, detail: 'Triggered at 60-70% of the window, never at 100% — compaction needs room to be done carefully. Summarise why things failed, not that they failed: "X and Y fail because the account is suspended" prevents a retry that a list of events invites.' },
        { id: 'window', label: 'The assembled context', kind: 'service', x: 760, y: 170, detail: 'Framing and task at the start, state block and recent turns near the end — because material in the middle is used least reliably. Position is a quality lever that costs nothing and is routinely ignored.' },
        { id: 'tools', label: 'Tool results: truncated, superseding', kind: 'external', x: 760, y: 320, detail: 'The largest single saving in most agents. A 40KB payload becomes a summary plus a fetch handle, and the second reading of the same file replaces the first — stale content is not merely wasteful, it makes the model reason about state that no longer holds.' },
        { id: 'sub', label: 'Delegate: spend someone else\'s context', kind: 'note', x: 0, y: 320, detail: 'A subagent gets a fresh window, burns 60k tokens exploring, and returns 300 tokens of findings. The parent grows by 300. This is the honest core of the case for multi-agent systems.' },
      ],
      edges: [
        { id: 'm1', source: 'turn', target: 'state', kind: 'read' },
        { id: 'm2', source: 'turn', target: 'ltm', kind: 'read' },
        { id: 'm3', source: 'state', target: 'compact', kind: 'control' },
        { id: 'm4', source: 'compact', target: 'window', kind: 'sync' },
        { id: 'm5', source: 'recent', target: 'window', kind: 'sync' },
        { id: 'm6', source: 'tools', target: 'window', kind: 'write' },
        { id: 'm7', source: 'sub', target: 'window', kind: 'async' },
      ],
      steps: [
        {
          id: 'ms1',
          title: 'Nothing is remembered — everything is assembled',
          description:
            'Each turn is a fresh request over a string your code builds. What you leave out does not exist, which makes this a design problem rather than a capability one.',
          nodes: ['turn'],
          edges: [],
        },
        {
          id: 'ms2',
          title: 'Lift the facts out of the transcript',
          description:
            'A small structured state object holds what the task depends on: it is checkable, persistable, and rendered fresh every turn so it can never be diluted.',
          nodes: ['state', 'ltm'],
          edges: ['m1', 'm2'],
        },
        {
          id: 'ms3',
          title: 'Compact early, and keep the task verbatim',
          description:
            'Drift after compaction is almost always the original framing being summarised into something vaguer. The state block and the task are never compacted.',
          nodes: ['compact', 'recent'],
          edges: ['m3'],
        },
        {
          id: 'ms4',
          title: 'Truncate at the tool boundary, and supersede',
          description:
            'Keep growth proportional to useful information rather than raw output, and never let two readings of the same thing compete on equal terms.',
          nodes: ['tools'],
          edges: ['m6'],
        },
        {
          id: 'ms5',
          title: 'Then place things deliberately, and delegate',
          description:
            'Important material at the edges rather than the middle. And where exploration is expensive, spend a subagent\'s context instead of your own.',
          nodes: ['window', 'sub'],
          edges: ['m4', 'm5', 'm7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'transcript-vs-state',
      title: 'The same conversation, held two ways',
      caption:
        'Read the right column as what survives a restart, a compaction, and turn sixty. The left column is a log that happens to contain facts; the right is facts that happen to have a log.',
      code: `flowchart LR
    subgraph L["**Transcript as memory**"]
      L1["turn 3: 'my order is A-88213,<br/>I'm in France'"]
      L2["turn 12: tool → status:<br/>processing"]
      L3["turn 19: 40KB of JSON"]
      L4["turn 31: tool → status:<br/>delivered"]
      L5["turn 44: ..."]
      L1 --> L2 --> L3 --> L4 --> L5
    end

    L5 --> LP["**By turn 60**<br/>· the order id is 30k tokens back,<br/>in the least-used region<br/>· **two contradictory statuses**<br/>compete as equals<br/>· the 40KB was resent 41 times<br/>· a crash loses all of it<br/>· compaction decides what<br/>survives, and may drop the<br/>country"]

    subgraph R["**State + log**"]
      R1["**state** *(regenerated each turn,<br/>never compacted)*<br/>order: A-88213<br/>country: FR — VAT applies<br/>status: delivered *(31)*<br/>decided: refund ≤ £75<br/>open: partial or full?"]
      R2["**log** *(compactable,<br/>truncated at the boundary)*<br/>last 5 turns verbatim<br/>+ a summary of decisions<br/>and their reasons"]
      R1 --- R2
    end

    R2 --> RP["**By turn 60**<br/>· the facts are at the edge,<br/>always current<br/>· supersession is structural —<br/>there is one status field<br/>· a crash resumes from state<br/>· **compaction is bounded:**<br/>the risky part was already<br/>written down somewhere safe"]

    style LP fill:#2a1a1a,stroke:#8c4a4a
    style RP fill:#17272a,stroke:#35897e
    style R1 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The MemGPT paper is the most useful reference here because it borrows a decomposition that has already been worked out elsewhere: **virtual memory.**

**The analogy.** An operating system has a small, fast, expensive tier (physical memory) and a large, slow, cheap one (disk), **and the interesting engineering is the paging policy between them** — what is resident, what is evicted, and who decides.

\`\`\`
Physical memory  ←→  the context window
Disk             ←→  external storage
Page faults      ←→  retrieval when something
                     needed is not present
Eviction policy  ←→  compaction
\`\`\`

**The specific contribution is that the model participates in paging.** It has tools to write to and read from the external tier, **so it can decide that something is worth keeping or worth fetching** — rather than a fixed policy deciding for it.

**Three transferable lessons.**

**The decomposition is the value, whether or not you build the mechanism.** **Naming a small fast tier, a large slow tier, and an explicit movement policy** is most of the design — and a system without that vocabulary tends to have one undifferentiated pile.

**Eviction policy is where the quality is.** **This is the lesson operating systems learned expensively**: the tiers are simple and what you evict determines performance. **Compaction is an eviction policy**, and treating it as an afterthought is the same mistake.

**And self-management has a cost worth pricing.** **A model deciding what to remember spends turns on memory management rather than on the task** — which is sometimes right and frequently not. **Deterministic extraction of what the harness can observe is cheaper and more reliable**, with the model handling only the interpretive part.

**Where the analogy misleads.** **A page fault is transparent and correct — the program gets the data.** **A failed retrieval is silent and wrong: the agent proceeds as if the information did not exist.** So the tiers are not equivalent, **and any design leaning on the analogy has to add what virtual memory gets for free — knowing that something is missing.**`,
  },

  tradeoffs: {
    intro:
      'The decisions agent memory involves, most of which trade context spend against what survives.',
    rows: [
      {
        option: 'Full transcript as the context',
        whenItWins:
          'Short sessions — under roughly ten turns, where nothing has time to go wrong.',
        whenItLoses:
          'Long sessions: quadratic cost, dilution of important facts, contradictions from stale content.',
        cost:
          'Everything grows without bound and nothing survives a restart.',
      },
      {
        option: 'Extracted durable state',
        whenItWins:
          'Always. It is the highest-leverage structure in an agent.',
        whenItLoses:
          'Requires deciding what the task\'s facts are, which is design work.',
        cost:
          'A schema and a write per turn.',
      },
      {
        option: 'Harness-extracted state',
        whenItWins:
          'Anything observable — which tool ran, what it returned, the current step.',
        whenItLoses:
          'Cannot capture interpretation, like why a decision was made.',
        cost:
          'Reliable and limited.',
      },
      {
        option: 'Model-maintained state',
        whenItWins:
          'Interpretive fields: decisions, open questions, hypotheses.',
        whenItLoses:
          'It can drift, hallucinate a decision, or quietly drop a constraint.',
        cost:
          'Needs schema validation, and is worth combining with harness extraction.',
      },
      {
        option: 'Full tool output in the context',
        whenItWins:
          'Small results where the detail is genuinely load-bearing.',
        whenItLoses:
          'A 40KB payload is resent on every subsequent turn.',
        cost:
          'The largest avoidable cost in most agents.',
      },
      {
        option: 'Truncation with a fetch handle',
        whenItWins:
          'Large outputs — logs, query results, documents.',
        whenItLoses:
          'The summary can omit the detail that mattered.',
        cost:
          'One round trip when the detail is needed.',
      },
      {
        option: 'Accumulating observations',
        whenItWins:
          'Where the history genuinely matters and is explicitly a timeline.',
        whenItLoses:
          'Two readings of the same status compete as equals and produce contradictions.',
        cost:
          'The model reasoning about state that no longer holds.',
      },
      {
        option: 'Superseding observations',
        whenItWins:
          'Repeated reads of the same entity, which is most of them.',
        whenItLoses:
          'Genuine history is lost unless modelled deliberately.',
        cost:
          'Deciding what has history and what has only a current value.',
      },
      {
        option: 'Compacting at the window limit',
        whenItWins:
          'Nowhere. There is no room left to do it carefully.',
        whenItLoses:
          'Compaction under pressure drops more and summarises worse.',
        cost:
          'A worse summary exactly when it matters most.',
      },
      {
        option: 'Compacting at 60-70%',
        whenItWins:
          'Always — room to be careful, and no cliff.',
        whenItLoses:
          'Compacts sooner than strictly necessary, spending a call.',
        cost:
          'One extra summarisation.',
      },
      {
        option: 'Summarising events',
        whenItWins:
          'Nowhere useful. "Tried X, failed" invites trying X again.',
        whenItLoses:
          'It is longer and less actionable than the reason.',
        cost:
          'Repeated failures after compaction.',
      },
      {
        option: 'Summarising decisions and reasons',
        whenItWins:
          'Always — a tenth of the tokens and it prevents the retry.',
        whenItLoses:
          'Requires the summariser to identify the reason, which it may get wrong.',
        cost:
          'A summarisation prompt that must be designed.',
      },
      {
        option: 'Carrying long-term memory in every context',
        whenItWins:
          'A handful of stable, always-relevant facts.',
        whenItLoses:
          'Unbounded growth and dilution of everything else.',
        cost:
          'Paying for irrelevance on every turn.',
      },
      {
        option: 'Retrieving long-term memory on relevance',
        whenItWins:
          'Anything beyond a handful of facts.',
        whenItLoses:
          'A failed retrieval is silent — the agent proceeds as if nothing existed.',
        cost:
          'The retrieval problem, with all its failure modes.',
      },
      {
        option: 'Delegating to a subagent',
        whenItWins:
          'Expensive exploration whose findings compress well.',
        whenItLoses:
          'The parent loses the detail, and the brief must be complete.',
        cost:
          'Coordination, which the next lesson prices properly.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We keep the whole conversation so the agent remembers everything."',
      whyWeak:
        'The transcript is a log serving as working context, durable state and long-term memory at once, so it has every tier\'s costs and none of their properties. By turn forty the important facts sit in the least-used region of the window, stale observations compete with current ones, and a crash loses all of it.',
      strongAnswer:
        '"I separate three tiers. Working context is what goes in this turn\'s window and should contain only what this turn needs. Durable state is a small structured object — order id, constraints, decisions, open questions — persisted every turn and rendered near the end of every context, so the facts that matter are always present and always current. Long-term memory is retrieved rather than carried. The transcript stays as a log, and every fact a decision depends on gets lifted out of it into the state block."',
    },
    {
      weakAnswer: '"It started contradicting itself after about thirty turns."',
      whyWeak:
        'An append-only transcript has no notion of supersession, so a status read at turn twelve and a different status at turn thirty-one are both present and both read as established fact. The model is not confused; the context genuinely contains two answers.',
      strongAnswer:
        '"Tool results for the same entity should supersede rather than accumulate — one status field, updated, not every status ever observed. Stale content is not just wasteful, it makes the model reason about state that no longer holds, which is worse than the content being absent. Where history genuinely matters I model it as an explicit timeline in the state object rather than leaving it as scattered residue in the log, so it is visible as history rather than competing as current fact."',
    },
    {
      weakAnswer: '"We compact when the context is nearly full."',
      whyWeak:
        'Compaction at ninety-eight percent is done under pressure with no room to be careful, and it becomes a failure mode rather than a maintenance operation. It also arrives as a cliff rather than a gradual process.',
      strongAnswer:
        '"I trigger at sixty to seventy percent, because the compaction itself needs room. Three rules bound the damage: never compact the original task, because drift after compaction is almost always the framing being summarised into something vaguer; never compact the durable state block; and summarise decisions and their reasons rather than events, because \'X and Y both fail because the account is suspended\' prevents a retry that \'tried X, failed\' invites — and it is a tenth of the tokens. I also keep the pre-compaction transcript on disk, which costs nothing and makes post-hoc diagnosis possible."',
    },
    {
      weakAnswer: '"We put everything we know about the user into the system prompt."',
      whyWeak:
        'It grows without bound, most of it is irrelevant to any given turn, and it dilutes the material that is relevant — context is zero-sum for attention as well as for cost, so adding facts can make existing facts less likely to be used.',
      strongAnswer:
        '"Long-term memory is retrieved on relevance, not carried. That makes it the retrieval problem from the RAG module with the same failure modes, plus three extras: memories need provenance and a timestamp because a preference recorded eight months ago may no longer hold; they need to be correctable, because a wrong memory retrieved confidently is worse than no memory and it persists; and they need a scope boundary, because a memory learned in one tenant\'s session must never surface in another\'s. The hard part is not storage, it is deciding what is worth writing."',
    },
    {
      weakAnswer: '"The agent maintains its own memory — it decides what to write down."',
      whyWeak:
        'Self-management spends turns on memory administration rather than the task, and the model can drift, invent a decision it never made, or quietly drop a constraint. It is also unverifiable, because nothing checks what it chose to keep.',
      strongAnswer:
        '"I split it by what each party can actually know. The harness extracts deterministically everything observable — which tools ran, what they returned, the current step — which is reliable and limited. The model proposes updates only to the interpretive fields like decisions and open questions, and those updates are validated against a schema before they are written. That gets the flexibility where it is needed without making the whole state a matter of the model\'s judgment, and it means a drifted state object fails validation rather than silently persisting."',
    },
    {
      weakAnswer: '"We built a vector store over the conversation history so it can search its past."',
      whyWeak:
        'That is usually an elaborate solution to a problem created by not having a durable state block. If the facts the task depends on had been extracted, there would be little reason to search prose for them — and searching a transcript returns passages, not facts.',
      strongAnswer:
        '"I would build the simple tier first and see what is genuinely missing. Most agents need a good state block and truncated tool results and nothing more. A store over past sessions earns its place when there is real cross-session knowledge — outcomes, preferences, corrections — that the current task cannot derive. Even then I would store extracted facts with provenance rather than raw transcript, because retrieving a passage of conversation gives the model something to interpret when what it needed was something to know."',
    },
  ],

  flashcards: [
    {
      id: 'fc-am-1',
      front: 'What does an agent actually "remember"?',
      back: 'Nothing. Every turn is a fresh request over a string your code assembles, so memory is an assembly decision made repeatedly.',
      topic: 'agent-memory',
    },
    {
      id: 'fc-am-2',
      front: 'Name the three tiers and their lifetimes.',
      back: 'Working context (one request), durable state (the task), long-term memory (indefinite, retrieved not carried).',
      topic: 'agent-memory',
    },
    {
      id: 'fc-am-3',
      front: 'Why is the transcript the wrong home for all three?',
      back: 'It is unbounded like long-term memory, carried in full like working context, and holds facts in prose — every tier\'s costs, none of their properties.',
      topic: 'state',
    },
    {
      id: 'fc-am-4',
      front: 'Why does a long context cause apparent forgetting?',
      back: 'Material in the middle is used less reliably, so a fact stated at turn three is present and outcompeted rather than absent.',
      topic: 'context',
    },
    {
      id: 'fc-am-5',
      front: 'What four properties make durable state valuable?',
      back: 'Structured (checkable), small (always rendered), persistent (survives restart), and never compacted (the compaction anchor).',
      topic: 'state',
    },
    {
      id: 'fc-am-6',
      front: 'Who should write the state object?',
      back: 'Both — the harness extracts what is observable, and the model proposes only interpretive fields, validated against a schema.',
      topic: 'state',
    },
    {
      id: 'fc-am-7',
      front: 'What is the largest single context saving in most agents?',
      back: 'Truncating tool results at the boundary — a summary plus a fetch handle instead of a payload resent every turn.',
      topic: 'context',
    },
    {
      id: 'fc-am-8',
      front: 'Why must repeated observations supersede rather than accumulate?',
      back: 'Two readings of the same status compete as equals, so stale content makes the model reason about state that no longer holds.',
      topic: 'context',
    },
    {
      id: 'fc-am-9',
      front: 'When should compaction trigger, and why not later?',
      back: 'At 60-70% of the window. Compaction needs room to be done carefully; at the limit it becomes a failure rather than maintenance.',
      topic: 'compaction',
    },
    {
      id: 'fc-am-10',
      front: 'What must never be compacted?',
      back: 'The original task framing and the durable state block — drift after compaction is almost always the framing becoming vaguer.',
      topic: 'compaction',
    },
    {
      id: 'fc-am-11',
      front: 'Why summarise decisions rather than events?',
      back: '"Tried X, failed" invites retrying X. "X fails because the account is suspended" prevents it, and costs a tenth of the tokens.',
      topic: 'compaction',
    },
    {
      id: 'fc-am-12',
      front: 'Why keep the pre-compaction transcript on disk?',
      back: 'Compaction is irreversible from the agent\'s view. Storage is nearly free and it makes post-hoc diagnosis possible.',
      topic: 'compaction',
    },
    {
      id: 'fc-am-13',
      front: 'Three extra requirements for long-term memory beyond retrieval?',
      back: 'Provenance with a timestamp, correctability, and a scope boundary so one tenant\'s memory never surfaces in another\'s.',
      topic: 'retrieval',
    },
    {
      id: 'fc-am-14',
      front: 'Why is delegation a context-management technique?',
      back: 'A subagent burns 60k tokens exploring and returns 300 tokens of findings, so the parent\'s context grows by 300.',
      topic: 'agent-memory',
    },
  ],

  quiz: [
    {
      id: 'q-am-1',
      kind: 'scenario',
      prompt:
        'At turn 40 an agent ignores a constraint the user stated at turn 3. The sentence is still in the context. What is happening?',
      options: [
        { id: 'a', label: 'Dilution — material in the middle of a long context is used less reliably, so the fact is present and outcompeted' },
        { id: 'b', label: 'The context was silently truncated' },
        { id: 'c', label: 'The model has a short memory span' },
        { id: 'd', label: 'The constraint was phrased ambiguously' },
      ],
      correct: ['a'],
      explanation:
        'It reads as forgetting and the mechanism is position. The fix is not a bigger window — it is lifting the constraint into a durable state block regenerated near the end of every context, where it cannot scroll away.',
      difficulty: 'core',
      topic: 'context',
    },
    {
      id: 'q-am-2',
      kind: 'scenario',
      prompt:
        'A tool returns "status: processing" at turn 12 and "status: delivered" at turn 31. Both are in the context. What is the design error?',
      options: [
        { id: 'a', label: 'Observations accumulate instead of superseding, so a stale reading competes with the current one as established fact' },
        { id: 'b', label: 'The tool should not be called twice' },
        { id: 'c', label: 'The context is too large' },
        { id: 'd', label: 'The status values are ambiguous' },
      ],
      correct: ['a'],
      explanation:
        'An append-only transcript has no notion of supersession. One status field that is updated removes the contradiction structurally; where history genuinely matters it should be an explicit timeline rather than scattered residue.',
      difficulty: 'core',
      topic: 'context',
    },
    {
      id: 'q-am-3',
      kind: 'scenario',
      prompt:
        'After a compaction at turn 50 the agent starts solving a broader problem than it was asked to. What was most likely lost?',
      options: [
        { id: 'a', label: 'The original task framing, summarised into something vaguer' },
        { id: 'b', label: 'The tool definitions' },
        { id: 'c', label: 'The most recent turns' },
        { id: 'd', label: 'The system prompt' },
      ],
      correct: ['a'],
      explanation:
        'Drift after compaction is overwhelmingly the framing becoming generic — "help the customer with their order" is not the task, and by turn sixty it is all that remains. The task and the state block are kept verbatim for exactly this reason.',
      difficulty: 'core',
      topic: 'compaction',
    },
    {
      id: 'q-am-4',
      kind: 'scenario',
      prompt:
        'Which summary is more useful after compaction?',
      options: [
        { id: 'a', label: '"Approaches X and Y both fail because the account is in a suspended state."' },
        { id: 'b', label: '"Tried approach X, it failed. Tried approach Y, it failed."' },
        { id: 'c', label: '"Several approaches were attempted without success."' },
        { id: 'd', label: 'The full transcript of both attempts.' },
      ],
      correct: ['a'],
      explanation:
        'The reason prevents a retry; a list of events invites one, and a vague summary invites both. It is also the shortest of the three useful options, which is the point — summarising decisions and reasons costs a fraction of summarising what happened.',
      difficulty: 'core',
      topic: 'compaction',
    },
    {
      id: 'q-am-5',
      kind: 'scenario',
      prompt:
        'A team proposes a vector store over conversation history so the agent can search its own past. When is this the wrong first move?',
      options: [
        { id: 'a', label: 'When there is no durable state block yet — the search is solving a problem that extracting the facts would remove' },
        { id: 'b', label: 'When sessions are longer than 50 turns' },
        { id: 'c', label: 'When the corpus is small' },
        { id: 'd', label: 'It is never the wrong move' },
      ],
      correct: ['a'],
      explanation:
        'Searching a transcript returns passages when what was needed was facts. Most agents need a good state block and truncated tool results and nothing more; a store earns its place for genuine cross-session knowledge, and even then should hold extracted facts with provenance.',
      difficulty: 'advanced',
      topic: 'state',
    },
    {
      id: 'q-am-6',
      kind: 'multi',
      prompt:
        'Which of these should the harness write into state rather than the model? Select all that apply.',
      options: [
        { id: 'a', label: 'Which tools ran and what they returned' },
        { id: 'b', label: 'The current step number' },
        { id: 'c', label: 'The set of files modified so far' },
        { id: 'd', label: 'Why a particular approach was rejected' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are observable, so deterministic extraction is reliable and cheap. The reason an approach was rejected is interpretation only the model holds — it should propose that field, validated against a schema so a drifted state fails rather than silently persisting.',
      difficulty: 'advanced',
      topic: 'state',
    },
  ],

  exercises: [
    {
      id: 'ex-am-1',
      kind: 'design',
      title: 'Design the memory architecture for a long-running assistant',
      estimatedMinutes: 40,
      prompt: `Design the memory for an engineering assistant used daily by a team of 30 across a large codebase. It answers questions, makes small changes, and works alongside people over months. A typical session is 20-80 turns; some run for hours. It has tools to read and search code, edit files, run tests, and query the issue tracker.

**Part 1.** Specify each of the three tiers concretely: what lives in it, how large, how it is written, how it is read.

**Part 2.** Design the compaction policy, including exactly what survives.

**Part 3.** Design long-term memory: what gets written, by whom, and how it is corrected when wrong.

**Part 4.** Thirty people share the codebase but have different permissions and different preferences. Work out what that implies.

**Part 5.** Someone asks "why did you make that change?" about work done three weeks ago. Say what makes that answerable.

Then answer:

- What would you build first, and what would you deliberately not build?
- How would you know the memory design is working?`,
      rubric: [
        'Three tiers specified with concrete contents and sizes.',
        'Durable state is structured and its writer is identified per field.',
        'Compaction policy names what survives verbatim and why.',
        'Long-term memory distinguishes what is worth writing from what is not.',
        'Correction path for wrong memories exists.',
        'Multi-user design separates shared from personal, with a permission boundary.',
        'The three-week-old question is answered from durable artefacts, not from memory.',
        'A defensible build order with something explicitly deferred.',
        'Metrics that would reveal a failing memory design.',
      ],
      modelAnswer: `**Part 1 — the three tiers**

**WORKING CONTEXT — what goes in this turn's window.**

\`\`\`
Target: ~40% of the window in steady state,
        compacting at 65%

  system framing + tool definitions   ~3k   (start)
  project instructions file           ~2k   (start)
  ── compacted history ──             ~10k  (middle)
  ── recent turns, verbatim ──        ~15k
  ── session state block ──           ~1k   (END)
  ── the current request ──           ~0.5k (END)
\`\`\`

**The ordering is the design.** **Framing at the start, the volatile and important material at the end**, and the compacted history in the middle **precisely because that is the region used least reliably** — which is the correct place for the least critical content rather than an accident.

*The project instructions file deserves its position:* **it is stable across sessions, so it lives at the start where prefix caching makes it nearly free.** **Anything regenerated per turn must be after the cached prefix**, or it invalidates the cache — **which means position is a cost decision as well as a quality one.**

**DURABLE STATE — the session's facts.**

\`\`\`
{
  session_id, user_id, started_at,
  task: "verbatim, as the user stated it",
  branch: "assistant/fix-invoice-rounding",

  // harness-written, deterministic
  files_read:     [{path, at_turn}],
  files_modified: [{path, lines_changed}],
  tests_run:      [{cmd, at_turn, passed, failed}],
  last_test_result: {passed: 412, failed: 3,
                     failing: ["...", "...", "..."]},
  turn: 34,
  tokens_spent: 180_000,

  // model-proposed, schema-validated
  plan:      ["step", "step", ...],
  decisions: [{what, why, at_turn}],
  rejected:  [{approach, why_rejected}],
  open_questions: [...],
  blocked_on: null | "..."
}
\`\`\`

**Roughly 800-1,200 tokens rendered.** **Written after every turn**, to Postgres keyed by session. **Read at the start of every assembly and rendered at the end of the context.**

**The split by writer is the important part.** **\`files_modified\` and \`last_test_result\` are facts the harness observes** — making them the model's responsibility would be strictly worse, because it can be wrong about what it just did. **\`rejected\` is interpretation nothing else holds**, and it is the field that most prevents wasted work, **so it is worth the risk of the model writing it** under schema validation.

*The \`rejected\` list is the highest-value field in this object.* **"Tried caching the rate lookup — rejected because the rates change mid-month" survives compaction and prevents the agent re-deriving it at turn sixty.**

**LONG-TERM MEMORY — across sessions.**

\`\`\`
Three stores, deliberately separate:

1. PROJECT MEMORY (shared, curated)
   → a file in the repo, reviewed like code
   → conventions, architecture notes, "do not
     touch X without talking to Y"
   → loaded in full, every session — it is small
     BECAUSE it is curated
   → the highest-value memory here, and it is a
     file rather than a system

2. LEARNED PROJECT FACTS (shared, agent-written)
   → "the integration tests need the docker
     compose stack running"
   → "payments/ has no test coverage; changes
     there need manual verification"
   → retrieved on relevance, not carried
   → written by the agent, REVIEWED before
     promotion to store 1

3. PERSONAL MEMORY (per user)
   → preferences: "prefers small PRs", "wants the
     test command run before being told it passes"
   → scoped strictly to user_id
   → retrieved on relevance
\`\`\`

**Store 1 being a reviewed file in the repository is the choice I would defend hardest.** **It is version-controlled, diffable, human-editable, and it travels with the code** — **and a human can fix a wrong entry in ten seconds** without any correction mechanism existing. **Most of what teams try to build with a memory system is better served by a file somebody maintains.**

---

**Part 2 — compaction policy**

\`\`\`
TRIGGER  at 65% of the window
         and always before a long tool call that
         might return a large result
           → so the compaction is not forced into
             a moment when there is no room

NEVER COMPACTED (re-rendered verbatim every turn)
  · the system framing and tool definitions
  · the project instructions file
  · the original task, as the user typed it
  · the entire state block
  · the current cumulative diff
  · anything the user pinned

KEPT VERBATIM
  · the last 5 turns

SUMMARISED (turns 6..n)
  Into a fixed structure, not free prose:
    Explored:   which areas of the codebase, and
                what was found
    Decided:    what and why
    Rejected:   what and why  → merged INTO state
    Learned:    facts about the codebase
                → candidates for store 2
    Failed:     what failed and the REASON

DISCARDED
  · raw file contents already reflected in the diff
  · raw test output beyond the current failures
  · tool results superseded by later ones
\`\`\`

**Three decisions worth defending.**

**The cumulative diff is never compacted, and it replaces the edit history entirely.** **It is a complete, compact representation of all the work done** — **so the context can be proportional to the size of the change rather than to the number of turns**, which is the single most valuable domain-specific insight here.

**The summary has a fixed structure rather than being free prose.** **A structured summary can be validated, merged into state, and mined for store-2 candidates.** **Free prose can only be read** — and it drifts in quality in a way a schema does not.

**And compacting before a large tool call rather than only on a threshold** prevents the case where a single result pushes the context from 60% to 100% **and compaction has to happen with no headroom.**

*What I would keep outside the agent's view:* **the full pre-compaction transcript, written to object storage.** **The agent cannot see it; a human debugging "why did it do that" can** — and it costs almost nothing.

---

**Part 3 — long-term memory**

**What gets written, and the test I would apply.**

\`\`\`
WRITE IT if it is:
  · true beyond this session
  · not derivable from the code itself
  · going to change a future decision

  "integration tests need docker compose up"     ✓
  "payments/ has no coverage"                    ✓
  "the auth module was rewritten in March; the
   old patterns in docs/ are stale"              ✓
  "Priya prefers small PRs"                      ✓

DO NOT WRITE:
  · anything derivable by reading the code
      → "UserService is in src/services/user.ts"
        is a grep, not a memory
  · anything true only for this task
  · restatements of the state block
  · the transcript
\`\`\`

**The "not derivable from the code" test is the one that keeps the store small.** **A memory that duplicates something greppable is pure noise** — it costs retrieval quality and adds nothing, **and it is what most naive memory systems fill up with.**

**Who writes it.**

\`\`\`
The agent PROPOSES at session end:
  "I learned: X. Evidence: Y. Should I remember
   this?"
→ proposals go to a review queue, not to the store
→ a human approves, edits or rejects
→ approved facts enter store 2 with:
     provenance (session id, turn, evidence)
     timestamp
     the approver
\`\`\`

**Review before write is the choice that makes this workable at a thirty-person scale.** **An unreviewed shared store accumulates wrong facts that then influence everyone** — and a wrong shared memory is worse than no memory because it is retrieved confidently. **The review cost is a few minutes a week** and it is what keeps store 2 trustworthy enough to use.

*Personal memory is different and can be written without review*, because its blast radius is one person **and they will notice when it is wrong.**

**Correction.**

\`\`\`
Every retrieved memory is rendered WITH its id,
date and provenance:
  [mem-4471, 2026-04-02] Integration tests require
  the docker compose stack. (learned: session
  s-8812, turn 14)

So a user can say "that is out of date" and the
agent calls:
  correct_memory(id, new_content | retract, reason)
→ which supersedes rather than deletes, keeping
  the history and the reason
\`\`\`

**Rendering provenance inline is what makes correction possible at all.** **A memory presented as an anonymous assertion cannot be challenged** — the user does not know it came from a store, or which entry to blame. **Showing the id and the date turns a hidden system into one people can maintain**, and that is the difference between a memory store that improves over six months and one that rots.

*And a staleness policy:* **memories older than six months surface with a note**, and anything contradicted by a tool observation **is flagged for review automatically** — "memory says payments/ has no tests; I just ran 40 tests in payments/".

---

**Part 4 — thirty users, different permissions and preferences**

**Three implications, in increasing order of how easy they are to get wrong.**

**Personal memory is strictly scoped to a user, and this is a privacy boundary rather than a relevance one.**

\`\`\`
personal_memory: keyed by (user_id, fact)
  → retrieval filters on user_id in the query
    construction, never as a model-supplied
    parameter
  → same argument as tool authorization: the
    scope must be unrepresentable, not requested
\`\`\`

**"Priya is frustrated with the deploy process" surfacing in someone else's session is a serious failure**, and it is the kind that happens by default if memory is a single store with a relevance filter.

**Shared project memory must respect code permissions.**

\`\`\`
If a user cannot read src/billing/, then:
  · retrieval over store 2 filters by what they
    can see
  · and a fact ABOUT billing must not leak through
    a memory even though the code is inaccessible
\`\`\`

**This is the subtler one.** **A memory store built from one user's sessions becomes a side channel around file permissions** — the agent learned something while acting as someone with access, **and repeating it to someone without access defeats the permission.** **So memories carry the scope of the material they were learned from**, which must be recorded at write time because it cannot be reconstructed later.

**And a shared working session needs an owner.**

\`\`\`
If two people interact with the same session:
  · whose permissions apply?
  → the answer must be ONE identity, fixed at
    session start
  → a second person joining starts a new session
    that can READ the first's state
\`\`\`

**An agent whose effective permissions change mid-session is not analysable**, and the simplest correct answer is that a session has one identity for its lifetime.

*One thing that is genuinely shared and should be:* **the learned project facts that are not permission-sensitive** — build commands, test setup, conventions. **That is where the compounding value is**, and it is the reason the store exists at all.

---

**Part 5 — "why did you make that change?" three weeks later**

**The honest answer: this must not depend on memory at all.** **The session's context is long gone, compaction discarded most of it, and no memory store should be expected to hold reasoning about a specific change.**

**It is answerable because the reasoning was written into durable artefacts at the time.**

\`\`\`
1. THE COMMIT MESSAGE
   Written by the agent, containing the what and
   the why, and the session id.
   → the primary answer, and it is where a human
     would look first anyway

2. THE PR DESCRIPTION
   The task as stated, the plan, the decisions
   with their reasons, what was rejected and why.
   → generated from the STATE BLOCK at completion,
     which is exactly what the state block was
     accumulating

3. THE ARCHIVED SESSION
   The full pre-compaction transcript in object
   storage, keyed by session id, linked from the
   commit.
   → for the rare case where the summary is not
     enough
\`\`\`

**The design principle: the state block is not only working memory, it is the draft of the explanation.** **Accumulating decisions with their reasons throughout the session means the PR description is a render of the state rather than a reconstruction** — **and reconstruction three weeks later is the thing that cannot be done.**

*So "why did you do that" is answered by git, not by the agent* — **and if the answer requires asking the agent to remember, the design has already failed.** **The agent can be asked to read its own archived session, which is a retrieval, not a memory.**

---

**What I would build first, and what I would not**

\`\`\`
BUILD FIRST, in order
  1. Tool-result truncation at the boundary
     → biggest cost win, one day, no design risk
  2. The durable state block, harness-written
     fields only
     → makes restarts survivable and PRs
       explainable
  3. Compaction with the verbatim-survivors list
     → unlocks long sessions
  4. The project instructions FILE
     → the highest-value "memory" in this design
       and it is a text file in the repo
  5. Model-proposed state fields, schema-validated
  6. Personal preferences, per user
  7. Learned project facts with a review queue
\`\`\`

**Items 1-4 are most of the value and involve no memory system.** **Item 4 in particular: a curated file that a human maintains outperforms an automatic memory store for the first several months**, and it costs nothing to build.

**What I would deliberately not build.**

**A vector store over conversation history.** **Once state and compaction exist, there is very little a transcript search answers that is not better answered by the state block, the diff, or git.** **It is the most commonly built and least useful component here.**

**Automatic memory extraction without review.** **At thirty users a wrong shared fact propagates to everyone**, and the review queue costs minutes per week.

**A knowledge graph of the codebase.** **The codebase is the knowledge graph**, and it is always current. **Any derived structure is stale the moment someone merges.**

**And cross-session conversational continuity** — "remember what we discussed yesterday". **It sounds valuable and is mostly served by the issue tracker and the PR history**, which are durable, shared and already exist.

---

**How I would know it is working**

\`\`\`
CONTEXT HEALTH
  · tokens per turn, p50 and p95
      → p95 rising means truncation or supersession
        is failing somewhere
  · compaction frequency per session
      → more than 2-3 in a session means the
        working set is too large
  · context composition: what fraction is state,
    recent turns, compacted history, tool output
      → tool output above ~40% is the signal to
        truncate harder

MEMORY QUALITY
  · post-compaction repeat rate
      → did the agent re-try something it had
        already rejected? THE metric for whether
        compaction is preserving what matters
  · state-validation failure rate
      → the model drifting on the fields it owns
  · memory correction rate
      → high means the write criteria are wrong
  · retrieval rate of store-2 facts
      → facts never retrieved are noise; a store
        where 80% is never used should be pruned

OUTCOME
  · session length before quality degrades
      → measured by human intervention rate per
        turn, bucketed by turn number
  · restart recovery: after a crash, does the next
    session continue or restart?
  · PR description quality — can a reviewer
    understand the change without asking?
\`\`\`

**The metric I would watch hardest is post-compaction repeat rate.** **It directly measures whether compaction preserved the thing compaction most often destroys** — and it is cheap to compute, because the \`rejected\` list is already in the state block. **An agent re-proposing a rejected approach after turn fifty is the clearest possible signal that the summary is dropping reasons and keeping events.**

*And the intervention-rate-by-turn-number curve is the honest summary of the whole design:* **if quality degrades sharply after turn forty, the memory architecture is the reason**, and no amount of model improvement will hide it.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-am-1',
      level: 'basic',
      question: 'How does an agent remember what happened earlier?',
      guidance:
        'It does not — every turn is a fresh request over an assembled string. Look for the reframing from memory to assembly.',
    },
    {
      id: 'iq-am-2',
      level: 'basic',
      question: 'What goes in the context this turn?',
      guidance:
        'Framing, compacted history, recent turns, and the state block near the end. Strong answers mention position deliberately.',
    },
    {
      id: 'iq-am-3',
      level: 'intermediate',
      question: 'It ignored something the user said at turn three. Why?',
      guidance:
        'Dilution by position, not absence. The fix is extraction into durable state regenerated each turn, not a bigger window.',
    },
    {
      id: 'iq-am-4',
      level: 'intermediate',
      question: 'How do you keep a 60-turn session from becoming unaffordable?',
      guidance:
        'Truncate at the tool boundary first, supersede repeated observations, then compact. Order matters — truncation is usually the biggest win.',
    },
    {
      id: 'iq-am-5',
      level: 'advanced',
      question: 'Design the compaction policy. What survives?',
      guidance:
        'The task, the state block, the recent turns, the cumulative artefact. And summarise decisions with reasons rather than events.',
    },
    {
      id: 'iq-am-6',
      level: 'advanced',
      question: 'Thirty people share this agent. What does that change about memory?',
      guidance:
        'Personal memory scoped as a privacy boundary, shared memory respecting code permissions, and one identity per session.',
    },
    {
      id: 'iq-am-7',
      level: 'followup',
      question: 'Someone asks why the agent made a change three weeks ago. Can you answer?',
      guidance:
        'Only from durable artefacts — the commit message, the PR description rendered from state, the archived session. Not from memory.',
    },
    {
      id: 'iq-am-8',
      level: 'followup',
      question: 'Would you build a vector store over the conversation history?',
      guidance:
        'Usually not. It tends to solve a problem that extracting durable state removes, and it returns passages when facts were needed.',
    },
  ],

  activeLearning: [
    {
      id: 'al-mem-1',
      kind: 'debug',
      prompt:
        'An agent works well for the first 20 turns of a session and degrades noticeably after 40 — repeating work it already did, contradicting earlier statements, and occasionally solving a subtly different problem. Compaction is implemented and runs at 80% of the window. Diagnose it.',
      discussion: `**The turn-dependence is the whole clue: something in the assembly is degrading with length**, and compaction being implemented narrows it rather than exonerating it.

**Hypothesis 1 — the summary preserves events and drops reasons.**

**This directly explains "repeating work it already did."**

\`\`\`
Before compaction: "I tried the caching approach;
  it failed because rates change mid-month."
After:             "Tried a caching approach."
→ the constraint is gone, the attempt remains
→ and an attempt without a reason reads as
  something worth retrying with more care
\`\`\`

*Check:* **read a post-compaction context and look for the \`rejected\` reasons.** If the summary lists what was tried without why it failed, **this is confirmed** — and it is the most common compaction bug.

**Hypothesis 2 — the original task was compacted into something vaguer.**

**This explains "solving a subtly different problem."** **"Fix the rounding error in invoice totals for EU customers" becomes "fix invoice issues"** — and every subsequent action is locally reasonable against the wrong brief.

*Check:* **compare the task text in a turn-50 context against what the user typed.** **This is a one-minute check and it is diagnostic**, because the difference is usually obvious once you look.

**Hypothesis 3 — 80% is too late, so compaction runs under pressure.**

**At 80%, the summarisation call has little room**, so it produces a shorter, cruder summary than it would at 65% — **which makes hypotheses 1 and 2 more likely rather than being a separate cause.** **And a single large tool result can push 80% to over-limit**, forcing an emergency truncation that is worse than any compaction.

*Check:* **the context size distribution at compaction time.** **If some compactions trigger at 80% and others at 95%, the trigger is not controlling anything** — which points at large tool results as the real driver.

**Hypothesis 4 — no supersession, so contradictions are genuine.**

**"Contradicting earlier statements" is explained by two readings of the same thing both being present.** **Compaction may even preserve both**, since a summariser has no way to know which is current.

*Check:* **look for the same entity read at two turns with different values, both surviving into the compacted history.** **This one is independent of compaction quality** — it is an assembly bug that compaction inherits.

**Hypothesis 5 — there is no durable state block at all.**

**The unifying explanation, and the one I would bet on.** If the facts live only in the transcript, **then compaction is being asked to preserve them by summarising prose** — a job it will do imperfectly by construction.

\`\`\`
With a state block:
  compaction cannot lose the constraint, the
  rejected list, or the task — they are not in
  the compacted region
Without one:
  compaction quality IS state retention, and it
  degrades every time
\`\`\`

*Check:* **does a state block exist, and is it excluded from compaction?** **If the answer to either is no, the other four hypotheses are symptoms rather than causes.**

**What I would check first.** **Print a turn-50 context and read it.** Not a metric — **the direct artefact.** It answers hypotheses 1, 2, 4 and 5 in about five minutes, **and reading what the model actually receives is the most underused diagnostic in agent work.**

**The fixes, in order of leverage.**

**Introduce or exclude the state block** — the task, the constraints, the decisions and the rejected list live outside the compactable region entirely. **This converts the problem from "summarise well" to "summarise the unimportant part", which is a much easier problem.**

**Restructure the summarisation prompt to a fixed schema** with an explicit \`Rejected: what and why\` section. **Free-prose summaries drift; a schema does not.**

**Move the trigger to 65%, and compact before large tool calls** rather than only on a threshold.

**And add supersession at the tool boundary**, so two readings of the same entity never coexist.

**The instrumentation this demands.**

**Post-compaction repeat rate** — did the agent propose something already in the \`rejected\` list? **The single metric that measures whether compaction preserved what matters**, and it is computable for free once the rejected list exists.

**Task-text drift**: a similarity check between the task in the current context and the original. **Cheap, and it catches hypothesis 2 automatically.**

**Context composition over turns** — what fraction is state, recent, compacted, tool output. **A rising tool-output share is the early warning for all of this.**

**And intervention rate bucketed by turn number.** **It is the outcome metric** — if the curve bends sharply at turn forty, the memory design is the reason, **and it turns "it gets worse in long sessions" from a complaint into a measurement.**

**Transferable:** **when compaction is doing the work of state management, quality degrades with length no matter how good the summariser is.** **The fix is not a better summary — it is having less that must survive one.**`,
    },
    {
      id: 'al-mem-2',
      kind: 'what-changes-if',
      prompt:
        'Change the constraint: context windows become effectively unlimited and extremely cheap. Which parts of this lesson become irrelevant, and which become more important?',
      discussion: `**A useful test, because it separates the parts of this lesson that are about scarcity from the parts that are about structure** — and rather less becomes irrelevant than the premise suggests.

**What genuinely becomes irrelevant.**

**Compaction as a cost measure.** **If the window is free and unbounded, there is no reason to discard the transcript to save money** — and the most operationally painful component in this lesson disappears.

**Tool-result truncation as a cost measure.** **Keeping the whole 40KB payload costs nothing.**

**And the token-budget dimension of agent loops.** **Turn and clock budgets remain; the token budget stops binding.**

*That is a real simplification*, and it removes the components that cause most of the operational difficulty.

**What survives unchanged, and this is the larger half.**

**Position effects.** **A window being large does not make attention uniform across it** — the evidence is about how material is used, not about whether it fits. **So placing the task and the state block at the edges still matters**, and possibly more: **a larger window has more middle.**

**Supersession.** **Two contradictory statuses in the context are a correctness problem regardless of cost.** **Cheap context makes it easier to leave both in, which makes this worse rather than better.**

**Durable state as a structure.** **The state block was never primarily a cost optimisation.** It exists so facts are checkable, persistable, and always current — **and a restart still needs it, because an unlimited window is not a durable one.** **A crashed process loses an unlimited context exactly as completely as a small one.**

**And the scope boundaries on memory.** **Permissions and tenancy are correctness properties with no relationship to size.**

**What becomes more important, which is the interesting part.**

**Curation, because the constraint moves from cost to attention.**

\`\`\`
Scarce context:  "what fits?"  → a budget question
Free context:    "what helps?" → a quality question
→ and the second is harder, because nothing
  forces you to answer it
\`\`\`

**The discipline that scarcity imposed for free now has to be chosen deliberately.** **Adding irrelevant material still dilutes**, and the only thing that was stopping it was the bill.

**Retrieval precision over recall.** **With a small window, retrieval is about fitting the best few passages in.** With a large one **the temptation is to include everything plausibly relevant** — and that actively degrades quality. **So precision becomes the metric that matters**, and "just include more" becomes a failure mode rather than an option.

**Staleness, which gets much worse.** **A long-lived context accumulates observations that were true when made.** **With a small window, old content aged out naturally; with a large one it persists indefinitely** — **so explicit supersession and timestamping move from good practice to necessary**, and the contradiction failure gets worse rather than better.

**And debuggability.** **A 20,000-turn context is not something a human can read**, so the "print the context and read it" diagnostic — the most valuable one in this lesson — **stops working.** **Structure becomes the only way to inspect it**: the state block, the composition metrics, and the provenance of what was included.

**What I would build differently.**

\`\`\`
Drop:    compaction for cost; token budgets;
         aggressive truncation
Keep:    durable state (for restarts and
         checkability); supersession; position
         discipline; memory scoping
Add:     an explicit relevance gate on inclusion —
           "why is this in the context?" answered
           per item, and logged
         staleness marking on every observation
         tooling to inspect a context that is too
           large to read
Watch:   precision of retrieval, not recall
\`\`\`

**The transferable point: scarcity was enforcing a discipline that was always about quality.** **Remove the scarcity and the discipline still applies, but nothing reminds you** — **which is the general shape of what happens when a resource constraint lifts.** **Systems built during the scarce era are often better than their successors**, because the constraint was doing design work nobody was crediting it for.

*And one thing genuinely gets better:* **the "agent forgot something" class of failure largely disappears**, because nothing has to be dropped. **The failures that remain are dilution and staleness — which are harder to notice, because nothing is missing.**`,
    },
  ],

  revision: {
    bullets: [
      'An agent has no memory — every turn is a fresh request over a string your code assembles.',
      'Three tiers: working context (one request), durable state (the task), long-term memory (indefinite).',
      'The transcript is the wrong home for all three — every tier\'s costs, none of their properties.',
      'Apparent forgetting is usually dilution: material in the middle is used less reliably.',
      'So position is a quality lever, not just a cost one — important material goes at the edges.',
      'Durable state is small, structured, persisted per turn, and rendered into every context.',
      'The harness writes what it can observe; the model proposes only interpretive fields, schema-validated.',
      'Truncating tool results at the boundary is usually the largest single saving.',
      'Repeated observations supersede rather than accumulate, or stale content competes as fact.',
      'Compact at 60-70% of the window — at the limit there is no room to do it carefully.',
      'Never compact the original task or the state block; drift is the framing becoming vaguer.',
      'Summarise decisions and reasons, not events: a reason prevents the retry an event invites.',
      'Keep the pre-compaction transcript on disk — free, and it makes diagnosis possible.',
      'Long-term memory is retrieved, not carried, with provenance, correctability and a scope boundary.',
      'The hard part of memory is deciding what is worth writing, not where to store it.',
      'A curated file a human maintains often beats an automatic memory store.',
      'Delegation is context management: a subagent spends its window and returns a summary.',
      'When compaction is doing state management\'s job, quality degrades with length no matter what.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The per-turn assembly of a context window from three distinct tiers: a small structured state object holding the task\'s facts, a compacted and truncated history, and cross-session knowledge retrieved only when relevant — with position, supersession and compaction policy all treated as design decisions.',
    whyItExists:
      'Because there is no memory to configure: the model sees only what your code includes this turn, and that window is zero-sum for attention as well as for cost.',
    whenToUse: [
      'A durable state block in any agent running longer than a handful of turns.',
      'Tool-result truncation at the boundary, before any other optimisation.',
      'Supersession wherever the same entity is read more than once.',
      'Compaction at 60-70%, with the task and state block excluded.',
      'Retrieved long-term memory where genuine cross-session knowledge exists.',
      'Delegation where exploration is expensive and its findings compress.',
    ],
    whenNotToUse: [
      'The transcript as the store for the task\'s facts.',
      'Compaction at the window limit.',
      'Summaries of events rather than of decisions and reasons.',
      'Everything known about a user carried in every context.',
      'A vector store over conversation history before a state block exists.',
      'Model-maintained state for anything the harness can observe.',
      'Memory as the answer to "why did you do that three weeks ago".',
    ],
    alternatives: [
      'A curated instructions file in the repository, which often beats an automatic store.',
      'Durable artefacts — commits, PR descriptions, tickets — for anything that must be explained later.',
      'Subagents, to spend a separate context rather than growing this one.',
      'Structured extraction into a database, where the facts have a schema.',
    ],
    tradeoffs: [
      'A state block buys durability and checkability, and costs a schema plus a write per turn.',
      'Truncation buys a flat cost curve and costs a round trip for detail.',
      'Supersession buys consistency and costs deliberate modelling of what has history.',
      'Early compaction buys a careful summary and costs one extra call.',
      'Retrieved memory buys unbounded knowledge and costs a silent-failure mode.',
      'Reviewed memory writes buy trustworthiness and cost human minutes per week.',
    ],
    failureModes: [
      'A constraint stated at turn three ignored at turn forty, present but diluted.',
      'Two readings of the same status competing as established fact.',
      'A 40KB tool result resent on every subsequent turn.',
      'Compaction at 98% producing a crude summary under pressure.',
      'The original task summarised into something generic, causing drift.',
      'A rejected approach retried because the summary kept the event and dropped the reason.',
      'A crash losing the entire session because state lived only in a message list.',
      'A memory store filled with facts derivable by grepping the code.',
      'A wrong shared memory retrieved confidently and never corrected.',
      'A memory learned under one user\'s permissions surfacing to another.',
      'A vector store over transcripts returning passages when facts were needed.',
    ],
    followUpQuestions: [
      'What exactly is in the context at turn forty?',
      'Where do the facts this task depends on live?',
      'Who writes the state — the harness or the model?',
      'What happens to a 40KB tool result?',
      'When does compaction trigger, and what survives it verbatim?',
      'Does the summary keep reasons or only events?',
      'What happens if the process crashes at turn forty-five?',
      'Is long-term memory carried or retrieved?',
      'How does a wrong memory get corrected?',
      'Could a memory learned in one session leak to another user?',
      'How would you answer "why did you do that" three weeks later?',
    ],
  },
});
