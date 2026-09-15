import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-human-in-the-loop',
  title: 'Human-in-the-loop and guardrails',
  summary:
    'An approval is a durable state, not a callback — and a guardrail that fires on everything is the same as no guardrail. Both failures come from treating oversight as a feature rather than as a budget.',
  phase: 'ai',
  module: 'workflows',
  position: 83,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['human-in-the-loop', 'guardrails', 'approval', 'workflows', 'safety'],
  prerequisites: ['a-durable-execution'],
  resources: [
    {
      key: 'langgraph-concepts',
      tier: 'must',
      note: 'Read the human-in-the-loop and checkpointing sections together. Seeing an interrupt implemented as a checkpoint makes the central claim of this lesson concrete: an approval is a state the graph rests in, not a blocked call.',
    },
    {
      key: 'temporal-durable-execution',
      tier: 'must',
      note: 'Read it again for the wait primitive specifically. A human approval and a webhook are the same shape to a durable workflow, which is why the previous lesson\'s machinery is most of what this one needs.',
    },
    {
      key: 'owasp-llm-top10',
      tier: 'must',
      note: 'Read the excessive-agency and insecure-output-handling entries for where guardrails belong. The output-handling entry is the argument that a check on text is not a substitute for a check at the point of action.',
    },
    {
      key: 'aws-step-functions',
      tier: 'good',
      note: 'Read the callback-token pattern. It is the cleanest illustration of how a workflow hands out a resumption handle and stops running, which is exactly the mechanism an approval needs.',
    },
    {
      key: 'anthropic-building-effective-agents',
      tier: 'good',
      note: 'Read the sections on human oversight and on keeping systems simple enough to supervise. The argument that an unsupervisable system cannot be made safe by adding supervision is the one worth carrying.',
    },
    {
      key: 'arize-phoenix-evals',
      tier: 'advanced',
      note: 'Read it for how to measure a classifier you have put in the request path. A guardrail is one, so its false-positive rate is a number you should know rather than a property you assume.',
    },
  ],

  intuition: {
    body: `**Two failures dominate human oversight of AI systems, and they look opposite.**

\`\`\`
TOO LITTLE  the agent acts, and the human finds
            out afterwards
TOO MUCH    every action needs approval, so
            approvals are granted in under two
            seconds without reading
\`\`\`

**The second is the one people build accidentally**, and it is worse than it looks: **a gate that is always clicked through provides the audit trail of oversight with none of the substance** — **and everyone now believes the system is supervised.**

**Which gives the framing: attention is a budget.**

\`\`\`
A reviewer has perhaps 30 real decisions a day
before quality collapses.
→ so "what needs approval" is a spending
  decision, not a safety preference
→ and spending it on reversible, low-value
  actions means it is not available for the
  irreversible ones
\`\`\`

**Then the structural point, which is the previous lesson applied.**

\`\`\`
BLOCKING     the process waits for a human
             → 200 pending approvals = 200 held
               processes, each a crash away from
               losing its work
DURABLE      the workflow records "awaiting
             approval on X" and STOPS
             → 200 pending = 200 rows
             → and a deploy during the weekend
               costs nothing
\`\`\`

**An approval is a wait, and waits are states.** **Everything durable execution said about timeouts, signals and idempotency applies unchanged** — which is why this lesson is mostly about *what* to gate rather than *how*.

**And guardrails have their own placement question.**

\`\`\`
A check on the model's OUTPUT TEXT
  → catches what it says
A check at the POINT OF ACTION
  → catches what it does
\`\`\`

**Only the second is a control.** **Text can be rephrased; a refund cannot be rephrased into not happening** — **so a guardrail reading output is a quality filter, and the security boundary is still at the executor.**`,
    analogyLimit:
      '"Add a human approval step" skips both hard parts. Attention is a budget — perhaps thirty real decisions a day — so gating everything spends it on reversible actions while producing an audit trail saying the system is supervised. And an approval is a durable state rather than a blocked call: two hundred pending should be two hundred rows, not two hundred held processes. It also implies a check on output text is a control, when only a check at the point of action is.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team adds oversight to a support agent: a moderation model checks every response before sending, and any action touching money requires a manager to click approve in a dashboard. The approval request is an HTTP call that blocks until answered. After a month, managers approve 98% of requests in under three seconds and several refunds were processed twice. Identify four problems.',
      answer: `**Problem 1 — a 98% approval rate at three seconds is not oversight.**

\`\`\`
98% approved → the gate almost never changes an
               outcome
3 seconds    → nobody is reading
→ the friction is real, the protection is not
\`\`\`

**And it is actively harmful**, because the organisation now believes money movements are reviewed. **The gate manufactures confidence it does not earn.**

*The fix:* **spend the attention where it changes outcomes.** **Raise the threshold until the approval rate falls to something like 70-80%** — a rate at which refusals are real — **and auto-approve below it with sampled after-the-fact review.**

**Problem 2 — the approval blocks a process.**

**A manager away for the afternoon means requests holding connections for hours**, and a deploy drops every one of them. **The customer waits, then the request fails, and nobody knows what was pending.**

*The fix:* **the workflow records "awaiting approval on X" and stops.** **The approval arrives as a signal**, and pending approvals cost rows rather than processes.

**Problem 3 — the double refunds come from the approval, not the agent.**

\`\`\`
Manager clicks approve.
Response is slow. They click again.
→ two approval signals
→ two refunds
\`\`\`

**Or the blocking call times out, the client retries, and the manager approves a second identical request.** **The approval is a mutation and was not treated as one.**

*The fix:* **the approval signal carries an id**, and a duplicate id is dropped. **The underlying action carries an idempotency key derived from the workflow and step** — so even two signals produce one refund.

**Problem 4 — the moderation check reads text and is called a safety control.**

**It sees what the agent says to the customer.** **It does not see the refund call**, which happens through a different path. **So the check that everyone points to as the safeguard is not on the path where harm occurs.**

*The fix:* **guardrails at the point of action, not on the prose.** **The output check is a quality filter and worth having as one** — it catches tone and leaked internals — **but the control is in the executor.**

**What the corrected design looks like.**

\`\`\`
· thresholds tuned so approval is a real decision,
  with an approval-rate target
· approvals as durable waits with timeouts and
  an escalation branch
· approval signals deduplicated by id; actions
  idempotent regardless
· the enforcing check at the executor, with the
  output check kept and labelled as quality
· sampled review of auto-approved actions
\`\`\`

**The transferable point: oversight fails by being too expensive to exercise, not by being absent.** **Every gate spends a scarce resource**, and one placed where it is usually unnecessary consumes the attention the important gate needed.`,
    },
  body: `## Approval is a durable state

**The mechanism is entirely inherited from the previous lesson**, which is the good news.

\`\`\`
1. the workflow reaches a gated action
2. it writes an approval request: what, why,
   the proposed arguments, who may approve
3. it records "awaiting approval:req-4471"
   and STOPS
4. a human acts; the decision arrives as a
   signal carrying the request id
5. the workflow resumes on the approve or
   reject branch
6. or the timeout fires, and that is its own
   branch
\`\`\`

**Three properties follow, and each is a failure when missing.**

**Pending approvals are free.** **Two hundred awaiting approval are two hundred rows**, so an approval can take a week without costing anything — **which is what makes "wait for a human" a viable design rather than an operational problem.**

**A crash or a deploy during the wait costs nothing**, because no state was in a process.

**And the timeout is a real branch.** **"Nobody approved within 48 hours" is a normal outcome** — it escalates, or it auto-rejects, or it notifies the requester. **A gate without a timeout produces a queue of forgotten requests**, which is how oversight decays silently.

*And the approval itself is a mutation:* **signals need ids and duplicate ids are dropped**, or a double-click approves twice. **The underlying action stays idempotent regardless**, because the signal deduplication is a convenience and the idempotency key is the guarantee.

## What to gate, which is the actual design

**Attention is the scarce resource**, so the question is where a human decision changes the outcome.

\`\`\`
GATE IT WHEN
  · irreversible — money out, email sent,
    data deleted, production changed
  · above a value threshold
  · outside the normal pattern — a first-time
    action, an unusual target, an anomalous rate
  · low confidence — the agent itself is unsure
  · legally or contractually required

DO NOT GATE
  · reversible actions with visible effects
    (a comment, a draft, a label)
  · reads
  · anything below the threshold where the
    review costs more than the mistake
\`\`\`

**And that last criterion is the one that makes the budget concrete:**

\`\`\`
Reviewing a £20 refund costs ~2 minutes of a
manager's time.
Being wrong about a £20 refund costs £20.
→ gating it is a bad trade, and it consumes
  attention the £2,000 refund needed
\`\`\`

**So the threshold is an economic calculation**, not a comfort level — **and stating it that way is what allows it to be raised when the data supports it.**

*The graduated version is usually right:*

\`\`\`
< £75          auto, logged
£75 - £500     auto, but sampled for review and
               reversible within 24h
> £500         approval before acting
> £5,000       two approvers
any amount,
unusual pattern → approval regardless
\`\`\`

**The middle tier is the one teams omit**, and it is where most of the value is: **act now, review some, keep the ability to undo.** **It buys speed and retains oversight**, at the cost of a reversal path that must actually work.

## Making an approval decidable

**A gate is only as good as what the reviewer sees**, and most approval UIs make a real decision impossible.

\`\`\`
BAD   "The agent wants to refund order A-88213
       for £340. Approve / Reject"
      → the reviewer has no basis for either

GOOD  Customer: Acme Ltd, 4 years, no prior
        refunds
      Order: A-88213, £340, placed 12 Feb,
        marked delivered 15 Feb
      Evidence: carrier shows no delivery scan
        after 13 Feb; customer contacted twice
      Policy: undelivered goods refundable
        within 30 days ✓
      Agent's reasoning: [two sentences]
      Precedent: 3 similar cases in 90 days,
        all refunded
      → Approve / Reject / Approve a different
        amount
\`\`\`

**Four things the good version provides.**

**The specific facts**, so the reviewer is not re-investigating.

**The policy check already performed**, so they are verifying rather than deriving.

**Precedent**, which is what turns a judgment into a consistent one.

**And a third option.** **Approve-with-modification is the outcome reviewers most often want** and most systems do not offer — **so they approve something slightly wrong rather than reject and restart.**

*The general principle:* **the cost of a gate is the reviewer's time, so reducing that time is the cheapest way to afford more oversight.** **A well-built approval screen is worth more than a lower threshold.**

## Guardrails: where they go

**A guardrail is a check in the path. Three positions, and they catch different things.**

\`\`\`
INPUT     before the model sees it
          → policy violations, obvious injection
            attempts, out-of-scope requests
          → cheap, and easily bypassed by
            rephrasing

OUTPUT    after the model produces text
          → tone, leaked internals, unsafe
            content, hallucinated commitments
          → a QUALITY filter; text can be
            rephrased, so it is not a boundary

ACTION    at the executor, before a side effect
          → THE control. Authorization, limits,
            idempotency, approval.
          → cannot be talked around, because it
            does not read the conversation
\`\`\`

**The distinction that matters: input and output guardrails inspect language; the action guardrail inspects an operation.** **Only the last one is a security boundary**, and it is the one that holds regardless of how convincing the text was.

*Which is not an argument against the others.* **An output check catching "I'll waive that fee for you" before it reaches a customer prevents a real commitment** — **it is genuinely valuable and it is a quality filter, not a control.** **Calling it a control is the mistake, because then the actual control is never built.**

**And guardrails are classifiers, so they have error rates.**

\`\`\`
FALSE POSITIVE  a legitimate request blocked
                → users route around the system
FALSE NEGATIVE  a harmful one passes
                → the failure you built it for
\`\`\`

**Both must be measured.** **A guardrail whose false-positive rate is unknown is an unmeasured tax on every legitimate user** — and the usual outcome is that it is loosened arbitrarily until complaints stop, **which optimises for silence rather than safety.**

## The failure modes of oversight

**Rubber-stamping**, already covered: **a high approval rate at low latency means the gate is decorative.** **Measure both, and treat them as a pair** — **97% approved is fine if each takes two minutes; it is not if each takes two seconds.**

**Automation bias.** **A reviewer shown the agent's recommendation tends to agree with it.** **Presenting the evidence before the recommendation**, or asking for a decision before revealing it, **materially changes outcomes** — and costs nothing.

**Responsibility diffusion.** **"The agent proposed it and the manager approved it" means nobody feels accountable**, so the approval must record a named person and that person must know it does. **An approval without attribution is a log entry, not a decision.**

**And unsupervisable systems.** **If an agent takes forty actions in a task, a human cannot meaningfully review them.** **Adding approval to an unsupervisable system produces the appearance of oversight** — **so the real fix is often to reduce the action count** rather than to gate it. **A system nobody can supervise is not made safe by supervision.**

## Escalation is the other direction

**Approval is the system asking a human. Escalation is the system handing over.**

\`\`\`
ESCALATE WHEN
  · the agent is stuck — repeated failures on
    the same goal
  · confidence is low on a consequential
    decision
  · the request is outside scope
  · a guardrail fired on something ambiguous
  · a compensation failed
\`\`\`

**And a good escalation is a handover, not a dump.** **The state, what was tried, what is known, what is needed** — **so the human starts where the agent stopped** rather than reading a transcript.

*Both directions need the same measurement:* **an escalation rate that is too high means the agent is not useful; too low means it is overconfident.** **Neither is visible without a target**, and the target is a product decision.

## What to say in a design discussion

**That an approval is a durable wait with a timeout, an escalation branch and a deduplicated signal — not a blocking call.**

**That attention is a budget of maybe thirty real decisions a day**, so what to gate is an economic decision measured against the cost of being wrong.

**That the middle tier — act, sample, retain reversibility — is where most of the value is.**

**That an approval screen must make the decision possible**, including approve-with-modification, because reviewer time is the cost of every gate.

**That input and output guardrails inspect language and are quality filters**, and the control is at the executor.

**That guardrails are classifiers with false-positive rates that must be measured.**

**That approval rate and time-to-decide are read together**, because a high rate at low latency is a decorative gate.

**And that a system generating forty actions per task cannot be supervised by approving them** — the fix is fewer actions.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'gate-placement',
      title: 'Three guardrail positions and one durable gate',
      caption:
        'Step through it. Only the action check is a boundary — the other two read language, and language can be rephrased.',
      nodes: [
        { id: 'in', label: 'Input guardrail — reads language', kind: 'service', x: 0, y: 170, detail: 'Catches policy violations, obvious injection attempts and out-of-scope requests. Cheap, and bypassed by rephrasing — so it reduces volume rather than providing a boundary.' },
        { id: 'model', label: 'Model', kind: 'external', x: 230, y: 170, detail: 'Everything it reads is potentially attacker-influenced — the user, retrieved documents, tool results. Which is why no check that reads the conversation can be the control.' },
        { id: 'out', label: 'Output guardrail — a quality filter', kind: 'service', x: 460, y: 60, detail: 'Catches tone, leaked internals and hallucinated commitments like "I\'ll waive that fee". Genuinely valuable and not a control: text can be rephrased, and calling it a control means the real one never gets built.' },
        { id: 'act', label: 'ACTION guardrail at the executor — the control', kind: 'service', x: 460, y: 290, detail: 'Authorization, limits, idempotency, approval. It inspects an operation rather than language, so it holds regardless of how convincing the text was — the one check that cannot be talked around.' },
        { id: 'tier', label: 'Graduated thresholds', kind: 'note', x: 690, y: 290, detail: 'Under £75 auto and logged; £75–500 auto but sampled and reversible for 24h; above £500 approval; above £5,000 two approvers; any amount with an unusual pattern gated regardless. The middle tier is where most of the value is and the one teams omit.' },
        { id: 'wait', label: 'Awaiting approval — a durable state', kind: 'store', x: 920, y: 170, detail: '200 pending approvals are 200 rows, not 200 held processes, so an approval can take a week for free and a deploy during the wait costs nothing. Everything durable execution said about timeouts, signals and idempotency applies unchanged.' },
        { id: 'screen', label: 'A decidable approval screen', kind: 'client', x: 920, y: 20, detail: 'Facts, the policy check already performed, precedent from similar cases, the agent\'s reasoning — and a third option, because approve-with-modification is what reviewers most often want and rarely get. Reviewer time is the cost of every gate, so reducing it buys more oversight than lowering the threshold.' },
        { id: 'timeout', label: 'Timeout branch — a normal outcome', kind: 'note', x: 690, y: 40, detail: '"Nobody approved within 48 hours" escalates, auto-rejects or notifies. A gate without a timeout produces a queue of forgotten requests, which is how oversight decays without anyone noticing.' },
      ],
      edges: [
        { id: 'g1', source: 'in', target: 'model', kind: 'sync' },
        { id: 'g2', source: 'model', target: 'out', kind: 'sync' },
        { id: 'g3', source: 'model', target: 'act', kind: 'sync' },
        { id: 'g4', source: 'act', target: 'tier', kind: 'control' },
        { id: 'g5', source: 'tier', target: 'wait', kind: 'async' },
        { id: 'g6', source: 'wait', target: 'screen', kind: 'sync' },
        { id: 'g7', source: 'wait', target: 'timeout', kind: 'control' },
        { id: 'g8', source: 'screen', target: 'act', kind: 'control' },
      ],
      steps: [
        {
          id: 'gs1',
          title: 'Two checks read language',
          description:
            'Input filtering reduces volume; output filtering catches tone and commitments. Both are worth having and neither is a boundary, because text can be rephrased.',
          nodes: ['in', 'model', 'out'],
          edges: ['g1', 'g2'],
        },
        {
          id: 'gs2',
          title: 'One check reads an operation',
          description:
            'At the executor, where authorization and limits live. It does not read the conversation, which is exactly why it holds regardless of what the conversation said.',
          nodes: ['act'],
          edges: ['g3'],
        },
        {
          id: 'gs3',
          title: 'Gate by what being wrong costs',
          description:
            'Reviewing a £20 refund costs two minutes to protect £20 — a bad trade that consumes the attention the £2,000 refund needed. The middle tier acts, samples, and keeps the undo.',
          nodes: ['tier'],
          edges: ['g4'],
        },
        {
          id: 'gs4',
          title: 'Then stop running',
          description:
            'The workflow records the pending approval and rests. The decision arrives as a deduplicated signal, and the underlying action stays idempotent regardless.',
          nodes: ['wait'],
          edges: ['g5'],
        },
        {
          id: 'gs5',
          title: 'And make the decision possible',
          description:
            'Evidence before recommendation, precedent, and a modify option. Plus a timeout branch, because a gate with no deadline becomes a queue nobody reads.',
          nodes: ['screen', 'timeout'],
          edges: ['g6', 'g7', 'g8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'attention-budget',
      title: 'Two ways oversight fails, and the measurement that tells them apart',
      caption:
        'Read approval rate and time-to-decide together. Either number alone is compatible with a working gate and with a decorative one.',
      code: `flowchart TB
    Q["**Is this gate doing anything?**"]

    Q --> A["**Approval rate 98%<br/>Median time 3 seconds**"]
    A --> A1["**Decorative.**<br/>The friction is real, the<br/>protection is not — and the<br/>organisation now believes<br/>money movements are reviewed.<br/><br/>*The gate manufactures<br/>confidence it has not earned*"]

    Q --> B["**Approval rate 97%<br/>Median time 2 minutes**"]
    B --> B1["**Probably fine.**<br/>A high rate with real reading<br/>means the threshold is roughly<br/>right and most proposals are<br/>good.<br/><br/>*Rate alone cannot distinguish<br/>this from the case above*"]

    Q --> C["**Approval rate 60%<br/>Median time 4 minutes**"]
    C --> C1["**The threshold is too low.**<br/>Four in ten proposals are wrong,<br/>so the agent should not be<br/>proposing them — fix upstream<br/>rather than reviewing harder"]

    Q --> D["**No gate, 40 actions per task**"]
    D --> D1["**Unsupervisable.**<br/>A human cannot meaningfully<br/>review forty actions, so adding<br/>approval produces the appearance<br/>of oversight.<br/><br/>**The fix is fewer actions,<br/>not more gates**"]

    style A1 fill:#2a1a1a,stroke:#8c4a4a
    style D1 fill:#2a1a1a,stroke:#8c4a4a
    style B1 fill:#17272a,stroke:#35897e
    style C1 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `LangGraph's treatment of human-in-the-loop is the most useful reference here because it makes the structural claim unavoidable: **an interrupt is a checkpoint.**

**The mechanism.** A graph executing a node can interrupt; **the state is persisted at that point and execution stops.** Later — seconds or days — **the graph is resumed from the checkpoint with the human's input incorporated.** Nothing is held open in between.

**Which collapses a distinction people usually maintain.** **"Waiting for a webhook" and "waiting for a manager" are the same thing to the runtime** — a durable state plus a resumption signal. **All the machinery from the previous lesson applies without modification**, and that is the main practical insight: **human-in-the-loop is not a separate subsystem to design.**

**Three transferable lessons.**

**Persisted state is what makes long waits possible.** **The reason an approval can take a week is that nothing is running** — so the difficult part of human oversight was solved by durability rather than by anything about humans.

**Resumption needs the state to be complete.** **Whatever the human's decision must be applied to has to be in the checkpoint**, which forces the design to be explicit about what an approval actually modifies. **A vague "approve" is hard to resume from; an approval that names the arguments is not.**

**And interrupting mid-graph rather than only at the end means oversight can be placed precisely.** **A gate before one node rather than before the whole task** is what keeps the attention budget spendable.

**Where this does not help.** **It gives you the mechanism and no opinion on policy** — what to gate, what threshold, how to present the decision, how to tell a real approval from a reflex. **Those are the parts that determine whether oversight works**, and they are entirely yours.`,
  },

  tradeoffs: {
    intro:
      'The decisions human oversight involves, most of which spend a fixed attention budget.',
    rows: [
      {
        option: 'No approval gates',
        whenItWins:
          'Reversible, low-value, visible actions where the mistake costs less than the review.',
        whenItLoses:
          'Irreversible or high-value actions — the human finds out afterwards.',
        cost:
          'Mistakes that cannot be undone.',
      },
      {
        option: 'Approval on everything',
        whenItWins:
          'Nowhere, past a trivial volume.',
        whenItLoses:
          'Reviewers approve reflexively, so the gate is friction without protection.',
        cost:
          'The attention the important gate needed, plus false confidence.',
      },
      {
        option: 'Graduated thresholds',
        whenItWins:
          'Almost always — auto below, sample in the middle, gate above.',
        whenItLoses:
          'Requires a reversal path that actually works for the middle tier.',
        cost:
          'A threshold to tune and a sampling process to run.',
      },
      {
        option: 'A blocking approval call',
        whenItWins:
          'Approvals answered in seconds by someone already present.',
        whenItLoses:
          '200 pending approvals are 200 held processes, lost on any deploy.',
        cost:
          'Memory proportional to pending decisions, and no crash tolerance.',
      },
      {
        option: 'Approval as a durable wait',
        whenItWins:
          'Any approval that might take minutes or days.',
        whenItLoses:
          'Needs a timeout branch and a deduplicated signal, which are easy to omit.',
        cost:
          'Two more paths to design, for approvals that cost rows.',
      },
      {
        option: 'A minimal approval prompt',
        whenItWins:
          'Nowhere — the reviewer has no basis for a decision.',
        whenItLoses:
          'Either they re-investigate, which is expensive, or they click, which is worthless.',
        cost:
          'The gate\'s entire value.',
      },
      {
        option: 'A decidable approval screen',
        whenItWins:
          'Always — facts, the policy check, precedent, reasoning, and a modify option.',
        whenItLoses:
          'Building it well is real product work.',
        cost:
          'Design effort, which buys more oversight than lowering the threshold.',
      },
      {
        option: 'Input guardrails',
        whenItWins:
          'Reducing volume of obviously out-of-scope or abusive requests.',
        whenItLoses:
          'Bypassed by rephrasing — it inspects language.',
        cost:
          'A false-positive rate that blocks legitimate users.',
      },
      {
        option: 'Output guardrails',
        whenItWins:
          'Tone, leaked internals, and commitments the business cannot honour.',
        whenItLoses:
          'As a security control — text can be rephrased and the action path is elsewhere.',
        cost:
          'Latency on every response, plus false positives.',
      },
      {
        option: 'Action guardrails at the executor',
        whenItWins:
          'Always. It inspects an operation, so the conversation cannot talk around it.',
        whenItLoses:
          'Catches nothing about what the agent says, only what it does.',
        cost:
          'Nothing that should be traded away.',
      },
      {
        option: 'Showing the recommendation first',
        whenItWins:
          'Speed, when the reviewer is a rubber stamp anyway.',
        whenItLoses:
          'Automation bias — reviewers agree with a recommendation they have already seen.',
        cost:
          'Weaker decisions, for free.',
      },
      {
        option: 'Evidence before recommendation',
        whenItWins:
          'Any gate meant to change outcomes.',
        whenItLoses:
          'Slightly slower per decision.',
        cost:
          'Seconds, for a materially better decision.',
      },
      {
        option: 'Adding gates to a 40-action agent',
        whenItWins:
          'Nowhere — a human cannot meaningfully review forty actions.',
        whenItLoses:
          'It produces the appearance of oversight over an unsupervisable system.',
        cost:
          'Confidence without review.',
      },
      {
        option: 'Reducing the action count',
        whenItWins:
          'When supervision is required — fewer, larger, reviewable steps.',
        whenItLoses:
          'Coarser steps are less adaptive.',
        cost:
          'Flexibility, in exchange for a system a human can actually oversee.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Every money-touching action requires manager approval, so the system is supervised."',
      whyWeak:
        'If the approval rate is 98% at three seconds per decision, nobody is reading. The friction is real and the protection is not — and worse, the organisation now believes money movements are reviewed, so the gate manufactures confidence it has not earned.',
      strongAnswer:
        '"I read approval rate and time-to-decide together, because either alone is compatible with a working gate and a decorative one. Ninety-seven percent approved at two minutes each is fine; ninety-eight percent at three seconds is a rubber stamp. Then I set thresholds economically: reviewing a twenty-pound refund costs two minutes to protect twenty pounds, which is a bad trade that consumes the attention the two-thousand-pound refund needed. Attention is a budget of maybe thirty real decisions a day, so what to gate is a spending decision."',
    },
    {
      weakAnswer: '"The approval is an HTTP call that blocks until the manager responds."',
      whyWeak:
        'A manager away for an afternoon means requests holding connections for hours, and any deploy drops every pending one — the customer waits, the request fails, and nothing records what was outstanding.',
      strongAnswer:
        '"An approval is a durable wait, exactly like a webhook. The workflow writes the request, records \'awaiting approval on req-4471\' and stops running, so two hundred pending approvals are two hundred rows and a deploy during the wait costs nothing. The decision arrives as a signal carrying the request id, duplicates are dropped, and the underlying action stays idempotent regardless — because signal deduplication is a convenience and the idempotency key is the guarantee. And the timeout is a real branch: nobody approving in forty-eight hours is a normal outcome that escalates."',
    },
    {
      weakAnswer: '"A moderation model checks every response before it is sent, which is our safety layer."',
      whyWeak:
        'It reads the text the agent says to the customer. It does not see the refund call, which happens on a different path — so the check everyone points to as the safeguard is not on the path where harm occurs.',
      strongAnswer:
        '"There are three positions and they catch different things. Input checks reduce volume and are bypassed by rephrasing. Output checks catch tone, leaked internals and commitments like \'I\'ll waive that fee\' — genuinely valuable, and a quality filter rather than a control, because text can be rephrased. The control is at the executor, because it inspects an operation rather than language and therefore holds regardless of how convincing the conversation was. Calling the output check a control is the mistake, because then the real one never gets built."',
    },
    {
      weakAnswer: '"The approval screen shows the proposed action and an approve or reject button."',
      whyWeak:
        'The reviewer has no basis for either decision, so they either re-investigate — which is expensive and duplicates the agent\'s work — or they click, which is worthless. And with only two options they approve something slightly wrong rather than reject and restart.',
      strongAnswer:
        '"The screen has to make the decision possible: the specific facts, the policy check already performed so they verify rather than derive, precedent from similar recent cases so the judgment is consistent, and the agent\'s reasoning in two sentences. Plus a third option — approve with a modified amount — because that is what reviewers most often want. And I show the evidence before the recommendation, because automation bias means a reviewer who sees the recommendation first tends to agree with it. Reviewer time is the cost of every gate, so making decisions faster buys more oversight than lowering a threshold does."',
    },
    {
      weakAnswer: '"The guardrail blocks unsafe requests, so we tuned it until complaints stopped."',
      whyWeak:
        'A guardrail is a classifier with two error rates, and tuning until complaints stop optimises for silence. False positives drive users to route around the system, and false negatives are the failure it was built for — neither is visible if only one is being listened to.',
      strongAnswer:
        '"I measure both error rates against a labelled set. The false-positive rate is an unmeasured tax on every legitimate user if nobody knows it, and the false-negative rate is what the guardrail exists to prevent. Then I tune deliberately against those numbers rather than against complaint volume. And I watch for users routing around the system, because a guardrail people bypass produces no logs at all — which is worse than a looser one they go through."',
    },
    {
      weakAnswer: '"The agent takes about forty actions per task, and we gate the risky ones."',
      whyWeak:
        'A human cannot meaningfully review forty actions, so whatever gating exists sits on top of a system nobody can supervise. Adding approval produces the appearance of oversight rather than the substance.',
      strongAnswer:
        '"If supervision is genuinely required, the first fix is fewer actions rather than more gates — coarser, reviewable steps, or a deterministic workflow for the parts that do not need exploration. A system that cannot be supervised is not made safe by adding supervision. Where forty actions are genuinely necessary, oversight moves to the plan rather than the steps: a human approves the intent before the expensive work starts, which is far cheaper than reviewing forty calls afterwards, and it is the one place a human decision still changes the outcome."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hitl-1',
      front: 'What are the two failure modes of human oversight?',
      back: 'Too little — the human finds out afterwards. Too much — approvals granted reflexively, producing friction without protection.',
      topic: 'human-in-the-loop',
    },
    {
      id: 'fc-hitl-2',
      front: 'Why is a rubber-stamped gate worse than no gate?',
      back: 'It produces the audit trail of oversight with none of the substance, so everyone believes the system is supervised.',
      topic: 'approval',
    },
    {
      id: 'fc-hitl-3',
      front: 'What makes "what to gate" an economic question?',
      back: 'Attention is a budget — around thirty real decisions a day — so gating a cheap reversible action spends what the expensive one needed.',
      topic: 'approval',
    },
    {
      id: 'fc-hitl-4',
      front: 'What is an approval, structurally?',
      back: 'A durable wait: the workflow records the pending request and stops, so 200 pending approvals are 200 rows.',
      topic: 'workflows',
    },
    {
      id: 'fc-hitl-5',
      front: 'What three things does an approval wait need?',
      back: 'A timeout with a real branch, a signal carrying a deduplicating id, and an idempotent underlying action.',
      topic: 'workflows',
    },
    {
      id: 'fc-hitl-6',
      front: 'What is the middle tier in a graduated threshold?',
      back: 'Act now, sample for review, retain reversibility for a window. Most of the value, and the tier teams omit.',
      topic: 'approval',
    },
    {
      id: 'fc-hitl-7',
      front: 'Name the three guardrail positions and which is a control.',
      back: 'Input and output inspect language and are filters. The action guardrail at the executor inspects an operation and is the control.',
      topic: 'guardrails',
    },
    {
      id: 'fc-hitl-8',
      front: 'Why is an output guardrail not a security boundary?',
      back: 'It reads text, and text can be rephrased — and the action path is elsewhere. It is a valuable quality filter.',
      topic: 'guardrails',
    },
    {
      id: 'fc-hitl-9',
      front: 'Why must a guardrail\'s false-positive rate be measured?',
      back: 'It is a classifier. An unknown rate is an unmeasured tax on legitimate users, and tuning by complaint volume optimises for silence.',
      topic: 'guardrails',
    },
    {
      id: 'fc-hitl-10',
      front: 'What four things make an approval decidable?',
      back: 'The specific facts, the policy check already done, precedent from similar cases, and a modify option alongside approve and reject.',
      topic: 'approval',
    },
    {
      id: 'fc-hitl-11',
      front: 'What is automation bias, and the cheap fix?',
      back: 'Reviewers agree with a recommendation they have already seen. Show the evidence before the recommendation.',
      topic: 'safety',
    },
    {
      id: 'fc-hitl-12',
      front: 'Why read approval rate and time-to-decide together?',
      back: 'Either alone is compatible with a working gate and a decorative one — 97% at two minutes is fine, 98% at three seconds is not.',
      topic: 'safety',
    },
    {
      id: 'fc-hitl-13',
      front: 'Can approval make a 40-action agent safe?',
      back: 'No — a human cannot meaningfully review forty actions. The fix is fewer actions, or oversight on the plan rather than the steps.',
      topic: 'safety',
    },
    {
      id: 'fc-hitl-14',
      front: 'What distinguishes escalation from approval?',
      back: 'Approval is the system asking; escalation is handing over — and it needs state and reasoning attached, not a transcript.',
      topic: 'human-in-the-loop',
    },
  ],

  quiz: [
    {
      id: 'q-hitl-1',
      kind: 'scenario',
      prompt:
        'Managers approve 98% of requests with a median decision time of three seconds. What does this tell you?',
      options: [
        { id: 'a', label: 'The gate is decorative — nobody is reading, so it produces friction and false confidence rather than protection' },
        { id: 'b', label: 'The agent is highly accurate' },
        { id: 'c', label: 'The dashboard is fast' },
        { id: 'd', label: 'The threshold should be lowered to catch more' },
      ],
      correct: ['a'],
      explanation:
        'Rate alone would be ambiguous — 97% at two minutes each is a working gate. The three-second median is what makes this a rubber stamp, and lowering the threshold would only spend more of an already-exhausted attention budget.',
      difficulty: 'core',
      topic: 'approval',
    },
    {
      id: 'q-hitl-2',
      kind: 'scenario',
      prompt:
        'Two hundred approvals are pending, some for days. What should that cost?',
      options: [
        { id: 'a', label: 'Two hundred database rows and no running processes — the workflow records the pending request and stops' },
        { id: 'b', label: 'Two hundred held connections' },
        { id: 'c', label: 'Two hundred background threads polling for a decision' },
        { id: 'd', label: 'One process managing all two hundred' },
      ],
      correct: ['a'],
      explanation:
        'An approval is a durable wait, exactly like a webhook — which is what makes "wait for a human" a viable design rather than an operational problem. It also means a deploy during the wait costs nothing.',
      difficulty: 'core',
      topic: 'workflows',
    },
    {
      id: 'q-hitl-3',
      kind: 'scenario',
      prompt:
        'A moderation model checks every customer-facing response. Is this a security control against an agent issuing a wrong refund?',
      options: [
        { id: 'a', label: 'No — it reads the text, not the refund call, so it is not on the path where the harm occurs' },
        { id: 'b', label: 'Yes, because it sees everything the agent produces' },
        { id: 'c', label: 'Yes, if it is trained on refund policy' },
        { id: 'd', label: 'Only if it runs before the model as well' },
      ],
      correct: ['a'],
      explanation:
        'Output checks catch tone, leaked internals and commitments, which is genuinely useful. The control is at the executor, because it inspects an operation rather than language — and calling the output check a control is how the real one ends up never being built.',
      difficulty: 'core',
      topic: 'guardrails',
    },
    {
      id: 'q-hitl-4',
      kind: 'scenario',
      prompt:
        'Which change most improves the quality of approval decisions at no cost to throughput?',
      options: [
        { id: 'a', label: 'Show the evidence before the agent\'s recommendation' },
        { id: 'b', label: 'Lower the approval threshold so more is reviewed' },
        { id: 'c', label: 'Add a second approver on every request' },
        { id: 'd', label: 'Require a written justification from the reviewer' },
      ],
      correct: ['a'],
      explanation:
        'Automation bias means a reviewer who sees the recommendation first tends to agree with it, and reordering costs nothing. The other three all spend more of the attention budget, which is the scarce resource.',
      difficulty: 'core',
      topic: 'safety',
    },
    {
      id: 'q-hitl-5',
      kind: 'scenario',
      prompt:
        'An agent takes about forty actions per task. The team proposes approval gates on the risky ones. What is the deeper problem?',
      options: [
        { id: 'a', label: 'A human cannot meaningfully review forty actions, so the fix is fewer actions or oversight on the plan rather than the steps' },
        { id: 'b', label: 'The gates will be too slow' },
        { id: 'c', label: 'Forty actions is too expensive in tokens' },
        { id: 'd', label: 'Nothing — gating the risky subset is correct' },
      ],
      correct: ['a'],
      explanation:
        'A system that cannot be supervised is not made safe by adding supervision. Where the action count is genuinely necessary, oversight moves to approving the intent before the expensive work starts — the one place a human decision still changes the outcome.',
      difficulty: 'advanced',
      topic: 'safety',
    },
    {
      id: 'q-hitl-6',
      kind: 'multi',
      prompt:
        'A manager double-clicks approve on a £340 refund. Which mechanisms prevent two refunds? Select all that apply.',
      options: [
        { id: 'a', label: 'The approval signal carries an id, and duplicate ids are dropped' },
        { id: 'b', label: 'The refund action uses an idempotency key derived from workflow and step' },
        { id: 'c', label: 'The workflow rejects signals once it has left the awaiting-approval state' },
        { id: 'd', label: 'The dashboard disables the button after the first click' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are server-side and hold regardless. Disabling the button is a usability improvement and no protection at all — a lost response, a refreshed page or a second tab defeats it, which is the same reasoning as never putting a control in the client.',
      difficulty: 'advanced',
      topic: 'workflows',
    },
  ],

  exercises: [
    {
      id: 'ex-hitl-1',
      kind: 'design',
      title: 'Design oversight for an autonomous ops assistant',
      estimatedMinutes: 40,
      prompt: `An assistant helps a platform team operate their infrastructure. It can: scale services, restart pods, roll back deploys, adjust feature flags, edit alerting rules, open and merge configuration pull requests, and run read-only diagnostics. It works from alerts, dashboards and engineer requests, and it reads logs and error reports that contain user-supplied strings.

The team is six engineers, one on call at a time. Incidents happen at all hours.

**Part 1.** Classify every action and decide what is gated, auto with sampling, or fully automatic. Justify the boundaries.

**Part 2.** Design the approval mechanism, including what happens at 3am when the on-call engineer does not respond.

**Part 3.** Design the approval screen for one action: "roll back deploy d-8812 on payments".

**Part 4.** Place the guardrails, and say which are controls.

**Part 5.** After three months, the approval rate is 96% and the median decision time is eight seconds. Diagnose and respond.

Then answer:

- What would you measure to know oversight is working?
- What would make you give the assistant more autonomy?`,
      rubric: [
        'Actions classified by reversibility and blast radius, not by apparent riskiness.',
        'A middle tier exists with sampling and a working reversal path.',
        'Approval is a durable wait with a timeout and a designed 3am branch.',
        'The approval screen provides evidence, policy check, precedent and a modify option.',
        'Guardrails placed at input, output and action, with the control identified.',
        'The 96%/8s diagnosis distinguishes a good agent from a decorative gate.',
        'Metrics cover both over- and under-gating.',
        'A concrete, evidence-based condition for granting more autonomy.',
      ],
      modelAnswer: `**Part 1 — classifying the actions**

**The axis is reversibility and blast radius, not how dangerous the verb sounds.**

\`\`\`
FULLY AUTOMATIC (logged, no review)
  · all read-only diagnostics
  · open a configuration PR (a proposal, not a
    change — and it is visible and reviewable
    by construction)
  · restart a single pod in a service with >3
    replicas
      → self-healing, routinely done by the
        platform anyway, and the blast radius is
        one pod

AUTO WITH SAMPLING + REVERSIBILITY WINDOW
  · scale a service within ±50% of current,
    inside pre-set min/max
  · adjust a feature flag that is already
    ramping, within its defined bounds
  · restart up to 25% of a service's pods
      → each auto-reverts after 30 minutes
        unless confirmed
      → 10% sampled for next-day review

GATED — APPROVAL BEFORE ACTING
  · roll back a deploy
  · scale beyond the auto bounds, or to zero
  · flip a feature flag to a new state
  · edit alerting rules
      → the one that looks harmless and is not
  · merge a configuration PR
  · restart >25% of a service, or any pod in a
    single-replica service

NEVER AUTOMATIC, EVEN GATED
  · anything touching the approval or audit
    system itself
\`\`\`

**Three decisions worth defending.**

**Editing alerting rules is gated even though it changes nothing about running services.** **It changes what the team will find out about** — **an agent that silences a noisy alert has removed the signal that would have shown its own next mistake.** **Actions that reduce observability deserve gating out of proportion to their apparent blast radius**, and this is the one teams misclassify.

**Rolling back a deploy is gated despite being the textbook safe action.** **It is not reversible in the way it sounds**: rolling back past a database migration is a data problem, **and "roll forward" is sometimes correct.** **The decision needs someone who knows what shipped**, which is precisely a human judgment.

**And restarting a single pod is fully automatic** because **the alternative — waking someone to approve a pod restart — spends the attention budget on something the platform's own controllers do unprompted.** **If it needs approval, so does Kubernetes.**

*The middle tier's auto-revert is the load-bearing detail:* **a scale-up that reverts in thirty minutes unless confirmed is safe to do unattended**, because the worst case self-corrects. **Without the revert path this tier collapses into the gated one.**

---

**Part 2 — the approval mechanism, and 3am**

\`\`\`
1. The workflow writes an approval request:
   action, arguments, evidence, the agent's
   reasoning, urgency, and who may approve.
2. It records "awaiting approval:req-N" and
   STOPS. No process is held.
3. Notification by urgency:
     routine   → Slack channel
     incident  → page the on-call
4. The decision arrives as a signal carrying the
   request id. Duplicates dropped. The action is
   idempotent regardless.
5. Timeouts — and these are the design:
\`\`\`

\`\`\`
URGENCY: INCIDENT (an alert is firing)
  t+0    page on-call
  t+5m   no response → page the secondary
  t+10m  no response → escalate to the team
         channel with @here
  t+15m  STILL nothing → the pre-authorised
         subset executes automatically, with a
         loud announcement and an auto-revert
         timer

URGENCY: ROUTINE
  t+0    Slack
  t+4h   reminder
  t+24h  auto-reject, notify the requester,
         close the request
\`\`\`

**The fifteen-minute pre-authorised fallback is the decision that needs the most defence**, and I would defend it.

\`\`\`
At 3am, during an incident, with nobody
answering, the alternatives are:
  (a) wait indefinitely → the outage continues
      while a correct mitigation sits unexecuted
  (b) act on everything → unbounded
  (c) act on a PRE-AGREED, REVERSIBLE subset,
      loudly, with an auto-revert
\`\`\`

**(c) is the honest answer**, and the key word is *pre-agreed*: **the team decides in daylight, at a whiteboard, which actions are acceptable unattended** — scale up within bounds, restart pods, **never roll back, never merge, never touch alerting.** **That decision is made once by humans and encoded**, which is a much better use of attention than a half-asleep click.

*And the auto-revert makes it survivable:* **anything executed on the fallback path reverts in thirty minutes unless a human confirms**, so the worst case is a temporary scale-up.

**What I would not do: lower the threshold at night.** **The instinct is that unattended hours need more automation; the correct reading is that they need a smaller pre-authorised set with stronger reversal** — **the unreviewed window is longer, so the bound should be tighter**, which is the same argument as the overnight support agent.

---

**Part 3 — the approval screen**

\`\`\`
╭─ APPROVAL REQUESTED · req-4471 · INCIDENT ────╮
│                                               │
│  WHAT IS HAPPENING                            │
│  payments 5xx rate: 0.1% → 4.2% since 02:14   │
│  Affected: ~340 requests/min, 3 of 12 pods    │
│  Alert: PaymentsErrorRate firing 6 min        │
│                                               │
│  WHAT CHANGED                                 │
│  deploy d-8812 to payments at 02:12:30        │
│    (2 min before onset)                       │
│  by: [engineer], PR #4402                     │
│  "bump connection pool size 10 → 40"          │
│                                               │
│  WHAT ELSE WAS CHECKED                        │
│  ✓ no upstream latency change                 │
│  ✓ no infra events in the window              │
│  ✓ no other deploys in 4h                     │
│  ✓ error signature: connection pool           │
│    exhausted — consistent with d-8812         │
│                                               │
│  ROLLBACK SAFETY                              │
│  ✓ no database migration in d-8812            │
│  ✓ previous version d-8809 ran 6 days clean   │
│  ✓ rollback ETA ~90 seconds                   │
│                                               │
│  PRECEDENT                                    │
│  2 similar in 90 days; both rolled back;      │
│  both resolved. inc-3301, inc-3407            │
│                                               │
│  ─────────────────────────────────────────    │
│  RECOMMENDATION (revealed on request)  [show] │
│  ─────────────────────────────────────────    │
│                                               │
│  [ Roll back to d-8809 ]                      │
│  [ Scale up instead ]                         │
│  [ Do something else — describe ]             │
│  [ Reject — I'll handle it ]                  │
│                                               │
│  Auto-executes the pre-authorised subset in   │
│  11:42 if nobody responds                     │
╰───────────────────────────────────────────────╯
\`\`\`

**Four design decisions.**

**The recommendation is hidden behind a click.** **Automation bias is strongest when the recommendation is the first thing read** — and at 3am an engineer will accept a recommendation they would question at 3pm. **Making them form a view first costs one click and measurably changes decisions.**

**"Rollback safety" is a section of its own**, because it is the specific thing that makes this action non-obvious. **The migration check is exactly what a tired human forgets**, and it is mechanically checkable.

**Four options, not two.** **"Scale up instead" is a common correct answer** — the pool exhaustion might be resolved by capacity — **and a two-button screen forces a reject-and-restart to reach it.**

**And the countdown is visible.** **The fallback is not a hidden behaviour**; the person deciding knows exactly what happens if they close the laptop, **which is the difference between a designed escalation and a surprise.**

---

**Part 4 — guardrail placement**

\`\`\`
INPUT (filter, not control)
  · engineer requests classified for scope
  · alert payloads scanned for obvious
    instruction-shaped content
  → reduces volume; bypassed by rephrasing

OUTPUT (quality filter, NOT a control)
  · does the message leak internal hostnames,
    credentials, customer data?
  · does it claim an action that was not taken?
  → valuable, and it inspects language

ACTION (THE CONTROLS)
  · the executor holds credentials; the
    reasoning agent does not
  · action classification by the host, never
    from the model's claim
  · hard bounds: cannot scale beyond max,
    cannot touch a namespace outside its scope,
    cannot restart >25% without approval
  · idempotency keys per (workflow, action)
  · rate limits: N actions/hour, M per service
  · an absolute kill switch that stops all
    action execution, checked on every call
\`\`\`

**Only the action guardrails are controls**, and the reason is direct: **the assistant reads logs and error reports containing user-supplied strings.**

\`\`\`
An attacker triggers an error with a crafted
payload.
The assistant reads it while investigating —
  which is its job.
→ no check that READS THE CONVERSATION can be
  trusted, because the conversation is the
  attack
→ the bounds hold regardless of what the model
  was told, because they do not read it
\`\`\`

**The rate limit deserves particular emphasis here.** **A compromised or confused assistant executing thirty pre-authorised actions in a minute is worse than one bad action** — **and the rate limit is the only control that bounds a sequence** rather than an individual call.

---

**Part 5 — 96% approval, 8-second median**

**Ambiguous, and the ambiguity is the interesting part.** **Eight seconds is not three** — it is enough to read a headline and glance at the evidence, **and it is not enough to form an independent judgment.** So there are two live hypotheses:

\`\`\`
(a) The agent is genuinely good. Engineers see a
    familiar pattern — "deploy 2 min before
    onset, no migration" — recognise it in 8
    seconds, and approve correctly.
(b) The gate is decorative. Engineers approve
    reflexively; 8 seconds is the click.
\`\`\`

**How to tell them apart, which matters more than the diagnosis.**

\`\`\`
1. THE 4% — what are the rejections?
   Scattered across action types and reasons →
     engineers are discriminating (a)
   Clustered on one action type, or all from one
     person → everyone else is rubber-stamping (b)

2. TIME BY COMPLEXITY
   Does decision time vary with how unusual the
   situation is?
   Varies → they are reading (a)
   Flat 8s regardless → clicking (b)

3. THE MODIFY OPTION
   Is "scale up instead" ever chosen?
   Never → the screen is a yes/no reflex (b)

4. A DELIBERATE TEST
   Inject a shadow request where the
   recommendation is subtly wrong — a rollback
   past a migration.
   Caught → (a). Approved → (b), decisively.
\`\`\`

**Test 4 is the only conclusive one**, and I would run it — **carefully, with the team's knowledge that such tests happen, and never executing the wrong action.** **An oversight mechanism nobody ever tests is an assumption.**

**The response differs completely.**

\`\`\`
IF (a) — the agent is good:
  → RAISE the automation boundary. Move
    rollback-with-no-migration into the
    auto-with-revert tier.
  → the 4% being caught tells you which cases
    still need eyes; gate those specifically
  → this is the good outcome and the team
    should collect the dividend

IF (b) — decorative:
  → the gate is not protecting anything, so
    stop pretending
  → either remove it and rely on bounds and
    auto-revert (honest), or invest in the
    screen and re-measure (better)
  → and reduce the gated volume so the
    remaining decisions are rare enough to
    take seriously
\`\`\`

**The response people reach for — "remind engineers to read carefully" — is the one that never works.** **Rubber-stamping is a rational response to a gate that is usually unnecessary**, and exhortation does not change the economics.

---

**What I would measure**

\`\`\`
IS OVERSIGHT REAL?
  · approval rate AND time-to-decide, together,
    per action type
  · rejection reasons, categorised
  · modify-rate — the health signal for the
    screen
  · time-to-decide variance — flat means
    reflexive
  · shadow-test catch rate, quarterly

IS IT OVER-GATED?
  · approval requests per on-call shift
      → above ~10 is unsustainable and quality
        will fall
  · time-to-action on incidents, split into
    waiting-for-approval vs acting
      → approval time as a fraction of MTTR is
        the cost of oversight, stated plainly
  · 3am fallback trigger rate
      → rising means the gate is not being
        serviced

IS IT UNDER-GATED?
  · auto-action reversal rate — how often the
    30-minute revert is allowed to fire
  · sampled-review disagreement rate
      → the direct measure of whether the
        auto tier is correctly bounded
  · incidents caused or worsened by an assistant
    action

SAFETY
  · rate-limit breaches (should be ~0)
  · out-of-bounds attempts blocked (should be
    small and NON-zero — zero means the check
    is not wired up)
  · kill-switch activations
\`\`\`

**The two I would put in front of the team weekly: sampled-review disagreement rate and approval-time-as-a-fraction-of-MTTR.** **The first says whether the automatic tier is trustworthy; the second states the price of the gates in the unit the team cares about** — **and having both numbers is what makes the autonomy conversation empirical rather than a matter of nerve.**

---

**What would make me grant more autonomy**

\`\`\`
Per action type, promote from gated to
auto-with-revert when:
  · ≥50 approvals of that action type, and
  · approval rate ≥95% with a MEDIAN DECISION
    TIME ABOVE 30 SECONDS
      → i.e. people actually considered and
        still agreed
  · no incident caused by that action
  · a working, tested auto-revert
  · sampled-review disagreement <2% on the
    tier below
\`\`\`

**The decision-time condition is the one that makes this rigorous**, and it inverts the obvious reading: **a 98% approval rate at three seconds is evidence of nothing, and a 95% rate at ninety seconds is strong evidence the agent is right.** **Promoting on rate alone would promote exactly the actions nobody was checking.**

**And promotion is reversible.** **Any incident attributable to an auto-tier action demotes it back to gated immediately**, with the case added to the review set. **Autonomy is earned per action type and can be lost the same way** — which is a much better structure than a single trust dial for the whole assistant.

*What would not move me:* **"it has been fine for a while", "the model was upgraded", or "the team is confident".** **All three are the arguments that get made, and none is a measurement.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hitl-1',
      level: 'basic',
      question: 'Which actions should require human approval?',
      guidance:
        'Irreversible, high-value, anomalous or low-confidence ones. Look for the economic framing rather than a comfort level.',
    },
    {
      id: 'iq-hitl-2',
      level: 'basic',
      question: 'How does the system wait for an approval?',
      guidance:
        'A durable state with a timeout and a deduplicated signal — not a blocking call holding a process.',
    },
    {
      id: 'iq-hitl-3',
      level: 'intermediate',
      question: 'Approvals are granted 98% of the time. Is that good?',
      guidance:
        'Only with the decision time. High rate plus low latency is a rubber stamp producing false confidence.',
    },
    {
      id: 'iq-hitl-4',
      level: 'intermediate',
      question: 'Where do you put the guardrails?',
      guidance:
        'Input and output as filters, action at the executor as the control. Strong answers say why text checks cannot be boundaries.',
    },
    {
      id: 'iq-hitl-5',
      level: 'advanced',
      question: 'Nobody responds to an approval at 3am during an incident. What happens?',
      guidance:
        'A pre-agreed reversible subset executes loudly with an auto-revert. Look for the decision being made in daylight, not at 3am.',
    },
    {
      id: 'iq-hitl-6',
      level: 'advanced',
      question: 'How would you design the approval screen?',
      guidance:
        'Evidence before recommendation, the policy check already done, precedent, and a modify option. Reviewer time is the cost of every gate.',
    },
    {
      id: 'iq-hitl-7',
      level: 'followup',
      question: 'When would you give the agent more autonomy?',
      guidance:
        'Per action type, on volume plus approval rate plus a decision time high enough to prove people were actually considering.',
    },
    {
      id: 'iq-hitl-8',
      level: 'followup',
      question: 'Your guardrail blocks some legitimate requests. How do you tune it?',
      guidance:
        'Measure both error rates against a labelled set. Tuning by complaint volume optimises for silence, and users route around it.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hitl-1',
      kind: 'explain-yourself',
      prompt:
        'A colleague proposes: "Put a human approval on every action the agent takes. It is the safest possible design — we can always loosen it later." Explain precisely why this is not the safest design, and what "loosen it later" gets wrong.',
      discussion: `**The proposal is intuitive, well-intentioned, and produces a less safe system than a carefully-chosen subset — for three reasons that are worth separating.**

**Reason 1 — approving everything means approving nothing.**

**Attention is finite in a way the proposal does not account for.**

\`\`\`
An agent taking 15 actions per task, 20 tasks
a day = 300 approvals.
One reviewer, 8 hours = 96 seconds each, with
no breaks and no other work.
→ so the real outcome is 2-second approvals
→ and the gate on the ONE action that mattered
  gets the same 2 seconds as the other 299
\`\`\`

**The proposal does not add oversight to the important action; it dilutes it.** **A design gating three actions gets three considered decisions; one gating three hundred gets none** — **and it is the same reviewer either way.**

**Reason 2 — it produces confidence that is not earned, which is an active harm.**

**An ungated system is known to be ungated.** **People are appropriately careful, monitoring is built, and the blast radius gets bounded because everyone knows nobody is checking.**

**A rubber-stamped system reports that every action was reviewed and approved by a named person.** **The audit trail is perfect and describes nothing** — so the compensating controls never get built, **because the gate is already there.**

\`\`\`
No gate:        "nobody is checking" → bounds,
                monitoring, reversal paths
Decorative gate: "a manager approved it" → none
                of those, and a record that
                looks like diligence
\`\`\`

**That is why it is not merely wasteful but worse than the honest alternative.**

**Reason 3 — it degrades the thing it is meant to protect.**

**Reviewers learn.** **After three hundred approvals of which two hundred and ninety-eight were obviously fine, the prior is "this is fine"** — **and that prior is applied to the important one too.** **The habit formed on trivial decisions is carried into consequential ones**, which is the opposite of the intended effect.

**Where "loosen it later" goes wrong.**

**First: it rarely happens.** **Removing a safety control requires someone to argue for less oversight**, which is professionally uncomfortable and has no natural advocate. **Adding a gate is a one-line change nobody questions; removing one is a meeting.** **So "start strict, loosen later" empirically means "start strict, stay strict".**

**Second, and more interesting: the data it would need is not being generated.** **Loosening responsibly requires knowing which approvals were real decisions** — and a rubber-stamped log cannot tell you.

\`\`\`
To promote an action to automatic you want:
  approval rate high, AND decision time high
  enough to show people considered
→ but 2-second approvals across the board mean
  every action type looks identical
→ the data says nothing, so the loosening
  never gets its evidence
\`\`\`

**The strict-first approach destroys the measurement it depends on**, which is the deepest problem with it.

**Third: the friction shapes usage before anyone revisits the policy.** **Engineers stop using the assistant for the workflows where approval is annoying**, so those paths never generate the evidence, **and the system's scope quietly narrows to whatever was already unattended.**

**What I would propose instead.**

\`\`\`
· Gate what is IRREVERSIBLE or HIGH-VALUE.
  Everything else is automatic with logging.
· Build the middle tier: act, auto-revert after
  a window unless confirmed, sample for review.
  → this is where "start careful" actually
    belongs, and it is reversible without a
    policy meeting
· Instrument for promotion from day one:
  approval rate AND decision time per action
  type
· Make promotion and demotion a defined
  process, with thresholds agreed in advance
\`\`\`

**The middle tier is the honest version of "start strict".** **It is careful, it does not spend attention, it self-corrects, and it produces exactly the disagreement data that justifies later autonomy** — **which is everything the colleague wanted from gating everything, without the mechanism that defeats it.**

*The line I would use:* **"Gating everything is not a strict policy, it is an unmeasured one."** **A three-action gate that people actually read is stricter in every way that matters than a three-hundred-action gate that people click through.**`,
    },
    {
      id: 'al-hitl-2',
      kind: 'debug',
      prompt:
        'A support system with approval gates on refunds has been working well. Over two months: approval latency has risen from 4 minutes to 40, the auto-approved tier has grown from 60% to 85% of volume without anyone changing the threshold, and two refunds were issued twice. Nobody changed the code. Diagnose it.',
      discussion: `**"Nobody changed the code" and three metrics moving together — so something outside the code changed, and the three symptoms may or may not share a cause.**

**Hypothesis 1 — the mix shifted, not the threshold.**

**The auto tier growing from 60% to 85% with an unchanged threshold means the distribution of refund amounts moved.**

\`\`\`
Threshold: auto under £500
Two months ago: 60% of refunds under £500
Now:            85% under £500
→ smaller refunds, or more of them
\`\`\`

**Plausible causes: a new product line with lower prices, a promotion, a change in what the agent proposes, or a policy change upstream.** **None of them is a bug**, and the metric moving without a code change is exactly what a mix shift looks like.

*Check:* **the amount distribution, then and now.** **If the median fell, this is confirmed** — and the follow-up question is whether the threshold is still right for the new distribution, **because a threshold tuned to catch the top 40% is now catching the top 15%.**

**Hypothesis 2 — reviewer capacity fell, explaining the latency.**

**Forty minutes is a tenfold rise, and the most likely cause is fewer people.** **Someone left, someone changed teams, a rota changed** — **so the same volume of gated requests now queues behind fewer reviewers.**

*But there is a compounding version worth checking:* **if the gated tier shrank from 40% to 15% of volume, gated requests are now rarer** — **and a reviewer who sees one every few hours has stopped watching the queue.** **Rarity itself increases latency**, which is a counterintuitive and real effect: **the less often a gate fires, the less attention its queue gets.**

*Check:* **reviewer headcount and gated-request volume per reviewer.** **If volume per reviewer fell while latency rose, hypothesis 2's second form is confirmed** — and the fix is notification design rather than more people.

**Hypothesis 3 — the double refunds come from the latency.**

**This is where the symptoms connect.**

\`\`\`
Approval takes 40 minutes instead of 4.
→ customers chase; agents re-open cases
→ a second workflow is started for the same
  refund
→ two approval requests, two approvals, two
  refunds
\`\`\`

**Note what this means: the idempotency key was derived from the workflow id**, and **a second workflow is a different key.** **The mechanism worked exactly as designed and protected the wrong scope** — **retries of one workflow, not duplicate workflows for the same real-world action.**

*Check:* **do the two refunds share a workflow id?** **Different ids confirm this**, and it is the most likely explanation by some distance.

*The fix is a key scoped to the business action rather than the workflow:* \`hash(order_id, "refund", amount)\` — **so two workflows refunding the same order produce the same key.** **This is a genuine design bug that only surfaced because latency rose**, which is the familiar pattern: **a change in timing exposing a latent scoping error.**

**Hypothesis 4 — a timeout branch is missing or wrong.**

**If approvals now take forty minutes, some presumably exceed the timeout.** **What happens then?** If the timeout auto-rejects, **customers are being refused for queue reasons**. If it has no timeout, **requests accumulate silently.** If it auto-approves — **which would be a serious design error — the auto tier's growth is partly timeouts rather than a mix shift**, and hypothesis 1 is wrong.

*Check:* **the timeout outcome distribution.** **This one also tests hypothesis 1**, so it is worth doing early.

**What I would check first.** **The workflow ids on the two double refunds**, which takes one query and either confirms or eliminates the most consequential hypothesis. **Then the amount distribution and the timeout outcomes together**, since both bear on the tier shift.

**The fixes.**

**Scope idempotency keys to the business action**, not the workflow. **This is the real bug and it would recur under any future latency spike.**

**Add duplicate-request detection at the approval layer**: an open approval request for the same order and action **blocks a second workflow from creating another** — defence in depth, and it also stops the reviewer being asked the same question twice.

**Re-evaluate the threshold against the new distribution.** **If 85% is now automatic, the gate is covering a smaller slice than intended** — which may be fine or may be a silent loosening. **Either way it should be a decision.**

**And fix the latency by treating queue attention as the problem**: notifications that escalate with age, a visible queue-depth signal, and a named owner per shift.

**The instrumentation this demands.**

**Duplicate-action detection as a first-class alert** — two completed actions on the same order and type within any window. **This should have paged, not been noticed in a review.**

**Tier distribution over time**, so a shift of 60% to 85% is visible as it happens rather than discovered at two months. **A threshold whose effect drifts with the input distribution is not a stable control**, and only this graph shows it.

**Approval latency percentiles with an SLO**, because forty minutes did not arrive overnight and nobody was watching the trend.

**And timeout outcomes**, which are invisible until someone asks.

**Transferable: none of these metrics moved because of a code change, and all three are consequences of the environment moving underneath a fixed configuration.** **A threshold is a control only relative to a distribution** — **so any policy expressed as a constant needs monitoring of what it is a constant against**, or it silently stops doing what it was chosen to do.`,
    },
  ],

  revision: {
    bullets: [
      'Oversight fails two ways: too little, and so much that approvals become reflexive.',
      'A rubber-stamped gate is worse than none — it produces the audit trail without the substance.',
      'Attention is a budget of roughly thirty real decisions a day.',
      'So what to gate is economic: compare the review cost against the cost of being wrong.',
      'An approval is a durable wait — 200 pending should be 200 rows, not 200 processes.',
      'Every approval needs a timeout with a real branch, or the queue silently rots.',
      'Approval signals carry ids and are deduplicated; the action stays idempotent regardless.',
      'Scope the idempotency key to the business action, not the workflow, or duplicate workflows double-act.',
      'The middle tier — act, sample, auto-revert — is where most of the value is and is usually missing.',
      'A gate is only as good as the screen: facts, the policy check, precedent, and a modify option.',
      'Show evidence before the recommendation, because automation bias is free to avoid.',
      'Input and output guardrails inspect language and are filters; they can be rephrased around.',
      'The action guardrail at the executor is the control, because it inspects an operation.',
      'Guardrails are classifiers — measure both error rates, not complaint volume.',
      'Read approval rate and decision time together; either alone is ambiguous.',
      'A forty-action agent cannot be supervised by approving actions — reduce actions or gate the plan.',
      'Escalation is a handover with state attached, not a transcript dump.',
      'Grant autonomy per action type, on approval rate plus a decision time proving people considered.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Oversight expressed as durable workflow states and executor-side checks: a graduated threshold deciding what is automatic, what is sampled, and what waits for a named human; an approval screen that makes the decision possible; and guardrails placed where they inspect operations rather than language.',
    whyItExists:
      'Because an agent taking consequential actions needs a human where a human decision changes the outcome — and human attention is a small fixed budget that a gate on everything spends without buying anything.',
    whenToUse: [
      'Gates on irreversible, high-value, anomalous or low-confidence actions.',
      'A middle tier that acts, samples, and auto-reverts within a window.',
      'Approvals as durable waits with timeouts and escalation branches.',
      'Deduplicated approval signals over idempotent actions keyed to the business action.',
      'Action guardrails at the executor, always.',
      'Evidence-before-recommendation on every approval screen.',
    ],
    whenNotToUse: [
      'Approval on reversible, low-value, visible actions.',
      'Approval on everything, which dilutes the gates that matter.',
      'A blocking call held open for a human.',
      'An approve/reject screen with no evidence and no modify option.',
      'Output moderation described as a security control.',
      'Guardrails tuned by complaint volume rather than measured error rates.',
      'Gates layered onto a system generating forty actions per task.',
    ],
    alternatives: [
      'Bounds and rate limits, which constrain without spending attention.',
      'Auto-revert windows, which make an unattended action survivable.',
      'Sampled after-the-fact review, for the middle tier.',
      'Approving the plan rather than the steps, where the action count is high.',
      'Reducing the action count, when supervision is genuinely required.',
    ],
    tradeoffs: [
      'A gate buys a human decision and costs scarce attention plus latency.',
      'A higher threshold buys throughput and costs coverage of the cases just below it.',
      'The middle tier buys speed with oversight and costs a reversal path that must work.',
      'A richer approval screen buys better decisions and costs product effort.',
      'Input guardrails buy volume reduction and cost false positives on legitimate users.',
      'A pre-authorised unattended subset buys incident response and costs an unreviewed window.',
    ],
    failureModes: [
      'A 98% approval rate at three seconds — friction without protection.',
      'A gate producing confidence that prevents real controls from being built.',
      'A blocking approval losing every pending request on deploy.',
      'A double-click approving twice, because the signal had no id.',
      'Two workflows refunding the same order, because the key was scoped to the workflow.',
      'An approval queue with no timeout, accumulating forgotten requests.',
      'A threshold silently covering less as the input distribution shifts.',
      'Automation bias from showing the recommendation first.',
      'Output moderation mistaken for a control while the action path is unguarded.',
      'A guardrail tuned until complaints stop, optimising for silence.',
      'Gates added to an unsupervisable system, producing the appearance of review.',
    ],
    followUpQuestions: [
      'Which actions are gated, and what is the cost of being wrong on each?',
      'What is the approval rate, and what is the median decision time?',
      'What does a pending approval cost while it waits?',
      'What happens when nobody responds?',
      'What does the reviewer actually see?',
      'Can they approve a modified version?',
      'Is the recommendation shown before or after the evidence?',
      'Which of your guardrails would survive a convincing injected instruction?',
      'What is the guardrail\'s false-positive rate?',
      'How many actions does a task take, and can a human review that many?',
      'What evidence would let you make this automatic?',
    ],
  },
});
