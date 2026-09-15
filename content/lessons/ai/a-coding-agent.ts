import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-coding-agent',
  title: 'Design an AI coding agent',
  summary:
    'A coding agent is the rare place where the feedback loop is objective — code compiles or not, tests pass or not — which is both its superpower and the axis the design turns on. The rest is sandbox isolation for code you did not write, retrieving context from a repo too large to fit, and a review gate that never moves.',
  phase: 'ai',
  module: 'ai-designs',
  position: 89,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 95,
  tags: ['coding-agent', 'sandbox', 'repo-context', 'edit-verify', 'review-gate'],
  prerequisites: ['a-multi-agent'],
  resources: [
    {
      key: 'swe-bench-paper',
      tier: 'must',
      note: 'Read it for what a real coding task and an honest objective grade look like — resolve a GitHub issue, and the test suite decides. It is the benchmark this whole design optimises against, and its scoring is the edit-verify loop made into an evaluation.',
    },
    {
      key: 'anthropic-claude-code-agents',
      tier: 'must',
      note: 'Read it for how a production coding agent handles repo context, long sessions, and the edit-run-observe loop in practice. It is this design applied to a domain you can inspect.',
    },
    {
      key: 'sandboxing-gvisor',
      tier: 'must',
      note: 'Read it for isolating code you did not write and are about to execute. A coding agent runs generated code and untrusted repository code, so the sandbox is not optional infrastructure — it is the boundary.',
    },
    {
      key: 'anthropic-building-effective-agents',
      tier: 'good',
      note: 'Read it for keeping the loop as simple as the task allows. A coding agent is a genuine agent loop, but the discipline of the minimal harness around it still applies.',
    },
    {
      key: 'firecracker-paper',
      tier: 'good',
      note: 'Read it for isolation at the strongest practical level, which is what running arbitrary repository build and test steps eventually needs. It bounds what you can safely promise about execution.',
    },
    {
      key: 'anthropic-context-engineering',
      tier: 'advanced',
      note: 'Read it for assembling the right slice of a large codebase into the context. Repo retrieval is a context-engineering problem, and this is the framing for what to include and what to leave out.',
    },
  ],

  intuition: {
    body: `**The one property that makes a coding agent different from every other agent: the feedback loop is objective.**

\`\`\`
Support agent:  "was that answer good?" → judgment
Coding agent:   "does it compile? does the test
                 pass?" → a fact, checkable by a
                 machine
\`\`\`

**This is the superpower.** **The agent can verify its own work** — write code, run the tests, read the failures, fix, repeat — **without a human or a judge in the loop.** **The whole design turns on this axis: a strong, fast, trustworthy verification signal.**

**And it is also the constraint**, because the agent inherits everything about that signal:

\`\`\`
· if the tests are weak, "passing" means little
· if the tests are slow, the loop is slow and
  expensive
· if the tests are flaky, the signal is noise and
  the agent draws confident wrong conclusions
\`\`\`

**So "the edit-verify loop" is the core mechanism**, and its quality is bounded by the quality of the verification.

**Two hard problems sit around the loop.**

**Isolation.** **The agent executes code — code it generated, and the repository\'s own build and test steps — none of which you fully trust.** **Running that on your infrastructure is the security lesson\'s "generated code needs a real sandbox," made concrete:** no network, a scratch filesystem, resource limits, killed on timeout.

**Repo context.** **A real codebase is far too large to fit in the context**, so the agent must retrieve the relevant slice — the files the task touches, their callers, the types they use — **which is a retrieval problem over a corpus with unusually good structure** (imports and call graphs are explicit, unlike prose).

**And the gate that never moves: human review.**

\`\`\`
The agent produces a diff.
A human reviews it before it merges.
→ the agent works in a scratch branch, opens a PR,
  and a person approves — ALWAYS, for consequential
  code
\`\`\`

**The agent\'s job is to arrive at review with working, verified, reviewable code** — not to merge. **The review gate is the human-in-the-loop lesson at the one point that matters: the irreversible act of changing the codebase.**`,
    analogyLimit:
      '"An AI that writes code for you" hides that the design turns on one rare property — an objective feedback loop, so the agent verifies its own work by compiling and running tests, and is only as good as the tests are strong, fast and non-flaky. It hides that the agent executes untrusted generated and repo code, so a sandbox is the boundary; that a repo is too large to fit, so context is retrieval over explicit structure; and that review before merge is the gate that never moves.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds a coding agent that takes a task, loads the whole repo into context, generates a patch, and commits it directly to the main branch. Name four things that break, and the one property they should have designed around.',
      answer: `**Break 1 — the whole repo does not fit in the context.**

**A real codebase is millions of tokens; the context is a fraction of that.** **"Load the whole repo" fails immediately on anything but a toy** — and even where it fits, filling the context with the entire repo buries the relevant code among irrelevant files, degrading the model.

*The fix:* **retrieve the relevant slice.** The files the task names, their callers and callees (the call graph is explicit in code), the types involved — assembled into a focused context. **Repo context is a retrieval problem, and code has better structure to retrieve over than prose does.**

**Break 2 — generating a patch without running it is generating a guess.**

**The agent\'s superpower is the objective feedback loop, and this design skips it.** **A patch that was never compiled or tested is unverified** — and models produce plausible code that does not compile or does not pass surprisingly often.

*The fix:* **the edit-verify loop.** Apply the edit, run the build and the tests, read the failures, fix, repeat — **the agent verifies its own work before anyone sees it.** This is the whole point of the domain.

**Break 3 — executing that code with no sandbox is a security hole.**

**Running generated code and the repo\'s build/test steps on your infrastructure with no isolation** means one hostile or buggy generation — or a malicious dependency in the repo — **can reach your network, your filesystem, your secrets.**

*The fix:* **a real sandbox** — no network (or a tight egress allow-list), a scratch filesystem scoped to the checkout, resource limits, killed on timeout. **The security lesson\'s isolation, non-negotiable here because execution is the core loop.**

**Break 4 — committing to main directly removes the review gate.**

**The irreversible act — changing the shared codebase — is done with no human approval.** **A wrong change is now in main**, breaking the build for everyone, with no reviewer having seen it.

*The fix:* **the agent works in a scratch branch and opens a PR for human review.** **It never merges; a person does.** The review gate is the one control that never moves for consequential code.

**The property they should have designed around: the objective feedback loop.**

\`\`\`
Everything good about a coding agent flows from
the fact that verification is a machine-checkable
fact:
  · the agent can self-correct (edit-verify)
  · the eval is objective (does the test pass)
  · "done" is verifiable, not claimed
→ so the design maximises the strength, speed and
  trustworthiness of that signal, and everything
  else (sandbox, retrieval, review) serves it
\`\`\`

**The transferable point: the naive design throws away the one thing that makes coding agents work — the objective loop — and keeps the risks (unsandboxed execution, unreviewed merges). The right design inverts that: lean entirely on the loop, and contain the risks around it.**`,
    },
  body: `## Framing and requirements

\`\`\`
· What is the verification signal? tests, build,
  types, lint → its strength/speed/flakiness
  bounds everything
· How large is the repo? → context is retrieval,
  not loading
· What is the trust boundary? the agent runs
  code → a sandbox
· Does it merge, or propose? → review gate
  (propose, for consequential code)
· Cost and time budget per task? → loop bounds
\`\`\`

**The dominant asset is the objective feedback loop, and the dominant risk is executing untrusted code** — so the design is "lean on the loop, contain the execution." **State that the verification signal is the thing the whole design serves; a candidate who leads with the model has, again, missed it.**

## The edit-verify loop — the core

\`\`\`
loop (bounded by turns / cost / wall-clock):
  1. decide the next edit (with retrieved context)
  2. apply it
  3. VERIFY — run build, tests, types, lint
  4. read the result:
       pass → done (subject to review)
       fail → the failure output is the next
              turn\'s input
  5. stuck? escalate / stop with partial work
\`\`\`

**The verification step is what makes this an agent and not a code generator.** **The failure output is the feedback that drives the next edit** — a compiler error naming a file and line, a failing test naming an assertion — **which is a far richer, more objective signal than any judge.** **This is the agent-loops lesson, with an unusually good observation.**

**Three properties of the verification signal shape the loop.**

**Strength.** **"Tests pass" is only as meaningful as the tests.** **Weak coverage means the agent can pass while breaking untested behaviour** — so the design cares about what the tests actually verify, and a good agent runs the *relevant* tests, and may write tests as part of the task.

**Speed.** **The loop runs verification every iteration**, so a slow test suite makes the loop slow and expensive. **Running the targeted subset (the tests touching the changed code) rather than the whole suite is the key latency lever** — with a full run before the PR.

**Trustworthiness.** **A flaky test is worse than a slow one**, because the agent draws confident wrong conclusions from a non-deterministic signal — "I fixed it" when it got lucky. **Flakiness has to be detected and quarantined**, or the loop is reasoning from noise.

## Sandbox isolation

**The agent executes code, so isolation is the boundary — not an optimisation.**

\`\`\`
The sandbox runs:
  · code the agent GENERATED (may be wrong or,
    via injection, hostile)
  · the repository\'s OWN build and test steps
    (which run arbitrary code, including
    dependencies you did not audit)

So it needs:
  · NO network, or a tight egress allow-list
    (build/test can exfiltrate otherwise)
  · a scratch filesystem scoped to the checkout,
    no host access
  · resource limits (CPU, memory, disk) and a
    timeout kill
  · NO credentials/secrets in the sandbox
    environment
\`\`\`

**The repository\'s own code is the underrated threat.** **Running \`npm install\` or the test suite executes third-party code and build scripts** — a malicious dependency or a poisoned build step runs with whatever the sandbox allows, entirely independent of the agent. **So the sandbox protects against the repo as much as against the agent**, which is why "it\'s our own repo, it\'s fine" is wrong.

*And the strength of isolation scales with trust:* **a container for a trusted internal repo; a microVM or syscall-filtering sandbox for arbitrary or untrusted repositories** — the security lesson\'s blast-radius principle, sized to how much the code is trusted.

## Repo context retrieval

**The codebase is too large to fit, so the agent retrieves the relevant slice** — and code is a better corpus to retrieve over than prose, because its structure is explicit.

\`\`\`
· the files the task names (start here)
· their CALLERS and CALLEES — the call graph is
  EXPLICIT (imports, references), so retrieve by
  traversal, not by guessing at similarity
· the TYPES and interfaces involved
· relevant tests, and project conventions (a
  persistent instructions file)
\`\`\`

**Traversing explicit structure beats semantic search for code.** **"Who calls this function" has an exact answer from the call graph** — retrieving it by embedding similarity is a worse method for a question with a precise answer. **So repo retrieval is primarily graph traversal (definitions, references, types) with semantic search as a fallback for "where is the code that does X."**

*And the context is managed as it works* (the agent-memory lesson): **the cumulative diff is the compact representation of the work so far**, stale file reads are superseded, and the task and conventions are pinned — so a long task\'s context stays proportional to the change, not the transcript.

## Cost, budgets, and stuck detection

\`\`\`
COST is dominated by:
  · loop iterations × growing context (the
    quadratic curve)
  · verification runs (compute, especially slow
    suites)
BUDGETS: turns, tokens, wall-clock, and
  test-suite runs (a wall-clock budget in
  disguise) — whichever trips first, with a
  partial-result branch
STUCK: the objective signal makes stuck detection
  strong — "test failure count not decreasing over
  N iterations" is a precise, free signal that no
  other agent domain has
\`\`\`

**The verification signal doubles as the best stuck detector available.** **A support agent guesses whether it is making progress; a coding agent knows — failures are going down, or they are not.** **"Same failure count for three iterations" is an objective stuck signal**, and the response is to change approach or escalate, not to keep editing.

## The review gate

\`\`\`
The agent NEVER merges consequential code. It:
  · works in a scratch branch
  · arrives at review with VERIFIED, working code
    (tests pass, build green) and a clear PR
    description of what and why
  · opens a PR; a HUMAN reviews and merges

SAFETY at the gate:
  · the agent cannot approve its own PR
  · it cannot disable/delete tests to make them
    pass (assert the test inventory did not shrink)
  · it cannot weaken assertions
  · the CI that runs on the PR is the independent
    check the agent cannot fake
\`\`\`

**The "did not delete tests" check is specific and load-bearing.** **The cheapest way to make a test suite pass is to remove the failing test**, and an agent under budget pressure will find it — **so the review gate (and CI) asserts the test inventory did not shrink and assertions were not weakened.** **The independent CI run is what the agent cannot game**, which is why it, not the agent\'s own loop, is the source of truth at merge.

## What to say in a design discussion

**That a coding agent\'s defining property is an objective feedback loop, and the whole design serves the strength, speed and trustworthiness of that verification signal.**

**That the edit-verify loop is the core, using compiler and test failures as the feedback that drives the next edit.**

**That the agent executes untrusted generated and repository code, so a real sandbox — no network, scratch filesystem, limits, no secrets — is the boundary, protecting against the repo as much as the agent.**

**That repo context is a retrieval problem solved primarily by traversing explicit structure — call graphs, types — not semantic search.**

**That budgets bound the loop and the objective signal gives an unusually strong stuck detector.**

**And that human review before merge is the gate that never moves, with checks that the agent did not delete tests or weaken assertions to pass.**`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'coding-loop',
      title: 'The edit-verify loop inside a sandbox, arriving at a review gate',
      caption:
        'Step through it. The objective verification signal is the axis — it drives the loop, detects stuck, and is what the design maximises.',
      nodes: [
        { id: 'task', label: 'Task + retrieved repo context', kind: 'client', x: 0, y: 170, detail: 'The relevant slice — the files named, their callers and callees from the explicit call graph, the types, the conventions — not the whole repo, which does not fit and would bury the relevant code among irrelevant files.' },
        { id: 'edit', label: 'Decide + apply an edit', kind: 'service', x: 250, y: 170, detail: 'The one genuinely agentic decision. Context managed as it works: the cumulative diff is the compact state, stale reads superseded, task and conventions pinned — so a long task\'s context stays proportional to the change.' },
        { id: 'sandbox', label: 'Sandbox: no network, scratch FS, no secrets', kind: 'store', x: 500, y: 170, detail: 'Runs generated code AND the repo\'s own build and test steps — both untrusted, the latter executing third-party dependencies. The boundary against the repo as much as the agent, because npm install runs arbitrary code. Container for trusted repos, microVM for untrusted.' },
        { id: 'verify', label: 'VERIFY: build, tests, types, lint', kind: 'service', x: 750, y: 170, detail: 'The objective feedback loop — the rare property the whole design turns on. Run the targeted subset for speed each iteration, the full suite before the PR. Strength (weak tests mean little), speed (slow loop), and trustworthiness (flaky = noise) all bound the design.' },
        { id: 'feedback', label: 'Fail → failure output drives the next edit', kind: 'note', x: 750, y: 30, detail: 'A compiler error naming a file and line, a failing test naming an assertion — a far richer, more objective signal than any judge. This is what makes it an agent rather than a code generator.' },
        { id: 'stuck', label: 'Stuck signal: failures not decreasing', kind: 'note', x: 500, y: 30, detail: 'The objective signal doubles as the best stuck detector any agent domain has: same failure count for N iterations is a precise, free "not making progress" — change approach or escalate, do not keep editing.' },
        { id: 'gate', label: 'Review gate: PR, human approves, CI checks', kind: 'external', x: 250, y: 320, detail: 'The agent arrives with verified working code and never merges. CI is the independent check it cannot fake, and the gate asserts the test inventory did not shrink and assertions were not weakened — because the cheapest way to pass is to delete the failing test.' },
      ],
      edges: [
        { id: 'cl1', source: 'task', target: 'edit', kind: 'sync' },
        { id: 'cl2', source: 'edit', target: 'sandbox', kind: 'sync' },
        { id: 'cl3', source: 'sandbox', target: 'verify', kind: 'sync' },
        { id: 'cl4', source: 'verify', target: 'feedback', kind: 'control' },
        { id: 'cl5', source: 'feedback', target: 'edit', kind: 'async' },
        { id: 'cl6', source: 'verify', target: 'stuck', kind: 'control' },
        { id: 'cl7', source: 'verify', target: 'gate', kind: 'sync' },
      ],
      steps: [
        {
          id: 'clg1',
          title: 'Retrieve the slice, do not load the repo',
          description:
            'The relevant files by call-graph traversal, not the whole codebase. Code has explicit structure, so retrieval is mostly traversal, not similarity.',
          nodes: ['task', 'edit'],
          edges: ['cl1'],
        },
        {
          id: 'clg2',
          title: 'Execute inside a real sandbox',
          description:
            'Generated code and the repo\'s own build and test steps both run untrusted. No network, scratch filesystem, no secrets — the boundary against the repo as much as the agent.',
          nodes: ['sandbox'],
          edges: ['cl2'],
        },
        {
          id: 'clg3',
          title: 'Verify — the objective loop that defines the domain',
          description:
            'Build, tests, types, lint. The targeted subset each iteration for speed, the full suite before the PR. Strength, speed and trustworthiness of this signal bound everything.',
          nodes: ['verify', 'feedback'],
          edges: ['cl3', 'cl4', 'cl5'],
        },
        {
          id: 'clg4',
          title: 'And the signal detects stuck for free',
          description:
            'Failures not decreasing over N iterations is a precise progress signal no other agent domain has — change approach or escalate rather than editing on.',
          nodes: ['stuck'],
          edges: ['cl6'],
        },
        {
          id: 'clg5',
          title: 'Arrive at review with verified code; never merge',
          description:
            'A PR for human approval, with CI as the independent check, and a gate that the agent did not delete tests or weaken assertions to pass.',
          nodes: ['gate'],
          edges: ['cl7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'objective-loop',
      title: 'Why the objective feedback loop changes everything',
      caption:
        'Read the two columns as the same agent architecture over two feedback signals. The objective one is what makes coding agents uniquely capable — and uniquely dependent on test quality.',
      code: `flowchart TB
    Q["**What is the feedback signal?**"]

    Q --> S["**Subjective** *(support, chat)*<br/>'was that good?'<br/>→ a judgment"]
    S --> S1["· self-correction is unreliable —<br/>the agent can't objectively<br/>check itself<br/>· evaluation needs a calibrated<br/>judge<br/>· 'done' is a claim<br/>· stuck detection is a guess"]

    Q --> O["**Objective** *(coding)*<br/>'does it compile?<br/>does the test pass?'<br/>→ a machine-checkable fact"]
    O --> O1["· **self-correction works** —<br/>edit, run, read failure, fix<br/>· evaluation is objective<br/>(SWE-bench: the tests decide)<br/>· 'done' is **verifiable**<br/>· stuck = 'failures not<br/>decreasing' — precise, free"]

    O1 --> D["**The superpower AND the constraint**<br/><br/>Everything good flows from the<br/>objective signal — so the design<br/>maximises its **strength** (weak<br/>tests → passing means little),<br/>**speed** (slow suite → slow loop),<br/>and **trustworthiness** (flaky →<br/>the agent reasons from noise).<br/><br/>*The agent is only as good as its<br/>verification.*"]
    O1 --> D
    S1 -.contrast.-> D

    style O1 fill:#17272a,stroke:#35897e
    style S1 fill:#2a1a1a,stroke:#8c4a4a
    style D fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `SWE-bench is the definitive reference for this design, because it is the edit-verify loop turned into an evaluation, and it demonstrates why the objective signal is the whole game.

**The task.** Given a real GitHub issue and its repository, produce a patch that resolves it. **The grade is not a judgment and not a comparison to a reference patch: the project\'s own test suite runs against the patched code, and it passes or it does not.**

**Why this validates the design.** **The benchmark works precisely because verification is objective** — there is no judge to calibrate, no reference solution to match, just the tests. **A patch is correct if the tests pass, however it was written** — which is the agent\'s edit-verify loop and the evaluation being the same mechanism. **The design and its own measurement are unified by the objective signal.**

**Three lessons for the build.**

**The tests are the definition of done, so their quality is the ceiling.** **SWE-bench relies on the repositories\' existing test suites** — and where those are weak, "resolved" is a weaker claim. **A coding agent inherits exactly this: it is as good as the tests it verifies against**, which is why a strong verification signal is the first requirement, not an afterthought.

**Realistic tasks give honest, low, true scores.** **Real issues on real repositories are hard**, and the scores reflect it — which is the corrective to demos where an agent solves toy problems flawlessly. **The gap between benchmark and demo is the gap between the loop working on real code and appearing to work.**

**And the end-state grade tolerates diverse solutions.** **The benchmark does not care how the patch was reached or what it looks like, only that the tests pass** — which is the right way to grade something with many correct answers, and the reason the agent eval is end-state assertions, not trajectory matching.

**Where the benchmark understates the real design.** **It measures whether the loop can solve the task; it says nothing about sandboxing the execution, retrieving context from a repo too large to fit, or the human review gate** — all of which a production agent needs. **SWE-bench is the loop\'s capability in isolation; the system around it is what this lesson adds.**`,
  },

  tradeoffs: {
    intro:
      'The decisions a coding agent forces, most of which trade loop quality or safety against cost and speed.',
    rows: [
      {
        option: 'Generate a patch without running it',
        whenItWins:
          'Nowhere — it discards the domain\'s defining advantage.',
        whenItLoses:
          'The patch is an unverified guess; plausible code that does not compile is common.',
        cost:
          'Throwing away the objective feedback loop.',
      },
      {
        option: 'The edit-verify loop',
        whenItWins:
          'Always — the agent self-corrects against an objective signal.',
        whenItLoses:
          'Bounded by test strength, speed, and flakiness.',
        cost:
          'Verification runs every iteration.',
      },
      {
        option: 'Running the full test suite each iteration',
        whenItWins:
          'Small suites, or the final pre-PR check.',
        whenItLoses:
          'A large suite makes every loop iteration slow and expensive.',
        cost:
          'Loop latency and compute.',
      },
      {
        option: 'Running the targeted test subset',
        whenItWins:
          'Each loop iteration — the tests touching the changed code.',
        whenItLoses:
          'Can miss a regression outside the subset.',
        cost:
          'A full run before the PR to catch what the subset missed.',
      },
      {
        option: 'Executing code with no sandbox',
        whenItWins:
          'Nowhere — the agent runs untrusted generated and repo code.',
        whenItLoses:
          'A hostile generation or a malicious dependency reaches your infrastructure.',
        cost:
          'A full compromise on one bad execution.',
      },
      {
        option: 'A real sandbox (no network, scratch FS, no secrets)',
        whenItWins:
          'Always — the execution boundary.',
        whenItLoses:
          'Setup and operational cost, and some tasks need controlled access.',
        cost:
          'Isolation infrastructure, sized to the repo\'s trust level.',
      },
      {
        option: 'Loading the whole repo into context',
        whenItWins:
          'A toy repo that genuinely fits.',
        whenItLoses:
          'A real codebase does not fit, and irrelevant files bury the relevant ones.',
        cost:
          'Failure at scale, and degraded focus where it fits.',
      },
      {
        option: 'Retrieving the relevant slice by call-graph traversal',
        whenItWins:
          'Any real repo — code structure is explicit, so traversal is exact.',
        whenItLoses:
          'Needs code-aware indexing (definitions, references, types).',
        cost:
          'A structural index to build.',
      },
      {
        option: 'Semantic search over code',
        whenItWins:
          'The fallback — "where is the code that does X".',
        whenItLoses:
          'Exact questions like "who calls this" have a precise graph answer it approximates.',
        cost:
          'Worse than traversal for structural questions.',
      },
      {
        option: 'Merging directly',
        whenItWins:
          'Nowhere for consequential code.',
        whenItLoses:
          'An unreviewed change breaks the shared codebase.',
        cost:
          'The review gate, removed.',
      },
      {
        option: 'A human review gate before merge',
        whenItWins:
          'Always for consequential code — the agent proposes, a human approves.',
        whenItLoses:
          'Adds a human to the path.',
        cost:
          'Review time, for the irreversible act done safely.',
      },
      {
        option: 'Trusting the agent\'s own "tests pass"',
        whenItWins:
          'Nowhere at the gate — the agent can delete tests to pass.',
        whenItLoses:
          'A green loop that shrank the test inventory or weakened assertions.',
        cost:
          'A silently weakened suite.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The agent generates the patch and we commit it."',
      whyWeak:
        'It discards the one property that makes coding agents work — the objective feedback loop. A patch that was never compiled or tested is an unverified guess, and models produce plausible code that does not compile or does not pass surprisingly often.',
      strongAnswer:
        '"The core is the edit-verify loop: apply the edit, run the build and the relevant tests, read the failures, fix, repeat. The failure output — a compiler error with a file and line, a failing assertion — is the feedback that drives the next edit, which is a far richer and more objective signal than any judge, and it\'s what makes this an agent rather than a code generator. The whole design serves the strength, speed and trustworthiness of that verification signal, because the agent is only as good as what it verifies against."',
    },
    {
      weakAnswer: '"We load the whole repository into the context so the agent has everything."',
      whyWeak:
        'A real codebase is far too large to fit, so this fails on anything but a toy — and even where it fits, filling the context with the entire repo buries the relevant code among thousands of irrelevant files, degrading the model.',
      strongAnswer:
        '"Repo context is a retrieval problem, and code is a better corpus than prose because its structure is explicit. I retrieve the relevant slice: the files the task names, their callers and callees by traversing the call graph — \'who calls this function\' has an exact answer from imports and references, so traversal beats semantic similarity — plus the types involved and the project conventions. Semantic search is the fallback for \'where is the code that does X.\' And I manage the context as it works: the cumulative diff is the compact state, so a long task stays proportional to the change, not the transcript."',
    },
    {
      weakAnswer: '"It runs the code on our build servers to test it — it\'s our own repo, so it\'s fine."',
      whyWeak:
        'The agent executes generated code that may be wrong or, via injection, hostile — and running the repo\'s own build and test steps executes arbitrary third-party dependency code and build scripts. "Our own repo" does not make npm install safe, and no isolation means one bad execution reaches your network and secrets.',
      strongAnswer:
        '"Execution runs in a real sandbox, because it\'s the boundary, not an optimisation. No network or a tight egress allow-list, a scratch filesystem scoped to the checkout, resource limits, a timeout kill, and no secrets in the environment. It protects against the repository as much as the agent — running the test suite executes dependency code I didn\'t audit — which is why \'it\'s our repo\' is the wrong instinct. A container for a trusted internal repo, and a microVM or syscall-filtering sandbox for arbitrary repositories, sized to how much the code is trusted."',
    },
    {
      weakAnswer: '"It runs the full test suite after each change to make sure everything works."',
      whyWeak:
        'The loop runs verification every iteration, so a large suite makes every iteration slow and expensive — a coding loop can run verification dozens of times, and a ten-minute suite makes that hours and a fortune.',
      strongAnswer:
        '"Each iteration runs the targeted subset — the tests touching the changed code — which is the key latency lever, and I run the full suite once before opening the PR to catch anything the subset missed. Test-suite speed directly bounds the loop\'s speed and cost, so it\'s a first-class concern. And flakiness matters even more than speed: a flaky test is worse than a slow one because the agent draws confident wrong conclusions from a non-deterministic signal — \'I fixed it\' when it got lucky — so flaky tests are detected and quarantined, or the loop reasons from noise."',
    },
    {
      weakAnswer: '"When the tests pass, the agent merges the change to main."',
      whyWeak:
        'Merging removes the review gate at the one irreversible act — changing the shared codebase. And "tests pass" from the agent\'s own loop is game-able: the cheapest way to make a suite pass is to delete the failing test, which an agent under budget pressure will find.',
      strongAnswer:
        '"The agent never merges consequential code. It works in a scratch branch, arrives at review with verified working code and a clear PR description, and opens a PR for a human to review and merge. The independent CI run on the PR is the check the agent can\'t fake — not its own loop. And the gate asserts the test inventory didn\'t shrink and assertions weren\'t weakened, because deleting the failing test is the obvious way to go green, and it must be structurally impossible to pass that way. The agent\'s job is to arrive at review with reviewable, working code, not to merge."',
    },
    {
      weakAnswer: '"We\'ll detect when it\'s stuck the same way as any agent — a turn limit."',
      whyWeak:
        'A turn limit converts a recoverable stuck state into a total loss at maximum cost, and it ignores that a coding agent has a far better stuck signal than any other domain.',
      strongAnswer:
        '"The objective signal gives the strongest stuck detector any agent domain has: \'test failure count not decreasing over N iterations\' is a precise, free progress measure — a support agent guesses whether it\'s making progress, a coding agent knows. When failures plateau, the response is to change approach or escalate, not to keep editing, and I also watch for oscillation — an edit reverted then reapplied — which the hashable file content makes unambiguous. The turn and cost budgets are the backstop, with a partial-result branch that opens a draft PR with the reasoning, not a silent failure."',
    },
  ],

  flashcards: [
    {
      id: 'fc-code-1',
      front: 'What is a coding agent\'s defining property?',
      back: 'An objective feedback loop — the code compiles or not, the test passes or not — so the agent can verify its own work, unlike any judgment-based agent.',
      topic: 'edit-verify',
    },
    {
      id: 'fc-code-2',
      front: 'Why is the objective loop both a superpower and a constraint?',
      back: 'The agent self-corrects against a machine-checkable signal, but is only as good as that signal is strong, fast and non-flaky.',
      topic: 'edit-verify',
    },
    {
      id: 'fc-code-3',
      front: 'What is the edit-verify loop?',
      back: 'Apply an edit, run build/tests, read the failures, fix, repeat — the failure output drives the next edit. The core mechanism.',
      topic: 'edit-verify',
    },
    {
      id: 'fc-code-4',
      front: 'Why is a flaky test worse than a slow one?',
      back: 'The agent draws confident wrong conclusions from a non-deterministic signal — "I fixed it" when it got lucky. Flakiness is noise the loop reasons from.',
      topic: 'edit-verify',
    },
    {
      id: 'fc-code-5',
      front: 'What is the key loop-latency lever?',
      back: 'Run the targeted test subset (tests touching the changed code) each iteration, and the full suite once before the PR.',
      topic: 'edit-verify',
    },
    {
      id: 'fc-code-6',
      front: 'What does the sandbox protect against, beyond the agent\'s code?',
      back: 'The repository\'s own build and test steps, which run arbitrary third-party dependency code — so "it\'s our repo" is not safe.',
      topic: 'sandbox',
    },
    {
      id: 'fc-code-7',
      front: 'What does a coding-agent sandbox need?',
      back: 'No network (or tight egress), a scratch filesystem, resource limits, a timeout kill, and no secrets in the environment.',
      topic: 'sandbox',
    },
    {
      id: 'fc-code-8',
      front: 'Why is repo context a retrieval problem?',
      back: 'A real codebase is too large to fit, so the agent retrieves the relevant slice rather than loading everything.',
      topic: 'repo-context',
    },
    {
      id: 'fc-code-9',
      front: 'Why is traversal better than semantic search for code?',
      back: 'Code structure is explicit — "who calls this" has an exact call-graph answer, which embedding similarity only approximates.',
      topic: 'repo-context',
    },
    {
      id: 'fc-code-10',
      front: 'What is the compact representation of the work so far?',
      back: 'The cumulative diff — so a long task\'s context stays proportional to the change, not the transcript.',
      topic: 'repo-context',
    },
    {
      id: 'fc-code-11',
      front: 'What is the strongest stuck signal a coding agent has?',
      back: '"Test failure count not decreasing over N iterations" — a precise, free progress measure no other agent domain has.',
      topic: 'edit-verify',
    },
    {
      id: 'fc-code-12',
      front: 'What does the agent do at the review gate?',
      back: 'It arrives with verified working code, opens a PR, and a human reviews and merges. It never merges consequential code itself.',
      topic: 'review-gate',
    },
    {
      id: 'fc-code-13',
      front: 'What check must the review gate enforce?',
      back: 'That the test inventory did not shrink and assertions were not weakened — because deleting the failing test is the cheapest way to go green.',
      topic: 'review-gate',
    },
    {
      id: 'fc-code-14',
      front: 'Why is CI, not the agent\'s loop, the source of truth at merge?',
      back: 'CI is the independent check the agent cannot fake — its own loop can be gamed by deleting tests.',
      topic: 'review-gate',
    },
  ],

  quiz: [
    {
      id: 'q-code-1',
      kind: 'scenario',
      prompt:
        'What makes a coding agent fundamentally different from a customer-support agent?',
      options: [
        { id: 'a', label: 'Its feedback loop is objective — the code compiles or not, the test passes or not — so it can verify its own work without a judge' },
        { id: 'b', label: 'It uses a larger model' },
        { id: 'c', label: 'It runs faster' },
        { id: 'd', label: 'It needs no human involvement' },
      ],
      correct: ['a'],
      explanation:
        'The objective, machine-checkable signal is the defining property: it enables self-correction, objective evaluation, verifiable "done," and precise stuck detection. Everything in the design serves the strength, speed and trustworthiness of that signal.',
      difficulty: 'core',
      topic: 'edit-verify',
    },
    {
      id: 'q-code-2',
      kind: 'scenario',
      prompt:
        'A team runs the agent\'s generated code and the repo\'s test suite directly on their build server with no isolation, reasoning "it\'s our own code." What is the flaw?',
      options: [
        { id: 'a', label: 'The test suite runs arbitrary third-party dependency code, and the generated code may be wrong or hostile — a sandbox protects against the repo as much as the agent' },
        { id: 'b', label: 'Nothing — internal code is safe' },
        { id: 'c', label: 'The build server is too slow' },
        { id: 'd', label: 'The tests will be flaky' },
      ],
      correct: ['a'],
      explanation:
        'Running npm install or the test suite executes third-party code and build scripts that were never audited, entirely apart from the agent. A malicious dependency or a hostile generation reaches the network and secrets — which is why isolation is the boundary, not an optimisation.',
      difficulty: 'core',
      topic: 'sandbox',
    },
    {
      id: 'q-code-3',
      kind: 'scenario',
      prompt:
        'The agent needs to know what calls a function it is about to change. What is the best retrieval method?',
      options: [
        { id: 'a', label: 'Traverse the call graph — "who calls this" has an exact answer from imports and references' },
        { id: 'b', label: 'Semantic search over embeddings of the codebase' },
        { id: 'c', label: 'Load the whole repo into context' },
        { id: 'd', label: 'Ask the model to guess from the function name' },
      ],
      correct: ['a'],
      explanation:
        'Code structure is explicit, so a structural question has a precise answer from the call graph — retrieving it by embedding similarity is a worse method for an exact question. Semantic search is the fallback for "where is the code that does X."',
      difficulty: 'core',
      topic: 'repo-context',
    },
    {
      id: 'q-code-4',
      kind: 'scenario',
      prompt:
        'The agent\'s loop reports all tests passing, but a reviewer notices the failing test was deleted. What must the gate enforce?',
      options: [
        { id: 'a', label: 'That the test inventory did not shrink and assertions were not weakened — with independent CI as the check the agent cannot fake' },
        { id: 'b', label: 'A longer turn budget' },
        { id: 'c', label: 'A more capable model' },
        { id: 'd', label: 'Running the tests twice' },
      ],
      correct: ['a'],
      explanation:
        'Deleting the failing test is the cheapest way to go green, and an agent under budget pressure finds it. The gate must make passing-by-deletion structurally impossible, and CI — not the agent\'s own loop — is the source of truth at merge.',
      difficulty: 'core',
      topic: 'review-gate',
    },
    {
      id: 'q-code-5',
      kind: 'scenario',
      prompt:
        'A coding agent has run 40 iterations with the same 3 test failures. What does this tell you, and what should happen?',
      options: [
        { id: 'a', label: 'It is stuck — "failures not decreasing" is an objective progress signal, so change approach or escalate rather than keep editing' },
        { id: 'b', label: 'It is making progress, so continue' },
        { id: 'c', label: 'The tests are wrong' },
        { id: 'd', label: 'The context is too small' },
      ],
      correct: ['a'],
      explanation:
        'The objective signal is the strongest stuck detector any agent domain has — a flat failure count over many iterations is precise, free evidence of no progress. The response is to change approach or escalate, not to burn more budget editing.',
      difficulty: 'advanced',
      topic: 'edit-verify',
    },
    {
      id: 'q-code-6',
      kind: 'multi',
      prompt:
        'Which properties of the verification signal bound the coding agent\'s quality? Select all that apply.',
      options: [
        { id: 'a', label: 'Strength — weak test coverage means "passing" verifies little' },
        { id: 'b', label: 'Speed — a slow suite makes every loop iteration slow and expensive' },
        { id: 'c', label: 'Trustworthiness — a flaky test makes the agent reason from noise' },
        { id: 'd', label: 'The color scheme of the test output' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Strength, speed and trustworthiness of the verification signal each directly bound the loop, which is why the design treats the test suite as a first-class concern. The formatting of the output is irrelevant.',
      difficulty: 'advanced',
      topic: 'edit-verify',
    },
  ],

  exercises: [
    {
      id: 'ex-code-1',
      kind: 'design',
      title: 'Design a coding agent for automated bug fixes',
      estimatedMinutes: 45,
      prompt: `Design a coding agent that a team runs on their issue tracker: given a bug report, it attempts a fix and opens a PR. The repos are large, in several languages, with test suites of varying quality (some excellent, some almost none). It runs on the company\'s CI infrastructure. Fixes must be reviewed before merge.

**Part 1.** Frame the requirements and name the property the design turns on.

**Part 2.** Design the edit-verify loop, handling the varying test quality.

**Part 3.** Design the sandbox, given multi-language repos on shared CI.

**Part 4.** Design repo context retrieval across large, multi-language codebases.

**Part 5.** Design the review gate and its anti-gaming checks.

Then answer:

- How would you handle a repo with almost no tests?
- What would you measure to know it is working?`,
      rubric: [
        'The objective feedback loop is named as the property the design turns on.',
        'The loop handles weak/strong/flaky test suites explicitly.',
        'The sandbox isolates untrusted repo code on shared CI, no secrets.',
        'Retrieval uses call-graph traversal, adapted across languages.',
        'The review gate has anti-gaming checks (no deleted tests, no weakened assertions).',
        'The no-tests case is addressed (write tests, or lower confidence / require more review).',
        'Metrics cover merge-without-edit rate and cost per merged PR.',
      ],
      modelAnswer: `**Part 1 — requirements, and the property it turns on**

\`\`\`
FUNCTIONAL
  bug report → attempted fix → PR for review,
  across large multi-language repos

NON-FUNCTIONAL, in priority order
  1. THE VERIFICATION SIGNAL — but it VARIES by
     repo (excellent tests to almost none), so
     the loop\'s reliability varies with it
  2. SAFE EXECUTION on shared CI — untrusted repo
     code, other teams\' secrets nearby
  3. REVIEW before merge — always
  4. COST per attempt within budget

The design turns on THE OBJECTIVE FEEDBACK LOOP —
but the twist here is that its strength is
NON-UNIFORM across repos.
\`\`\`

**The property is the objective loop, and the interesting complication is that its quality is a per-repo variable.** **A repo with excellent tests gives the agent a strong, trustworthy signal and it can work with high autonomy; a repo with almost no tests gives it almost no signal, and the loop\'s core advantage evaporates.** **So the design must ASSESS the verification signal per repo and adjust its behaviour** — which is the honest reading of "test suites of varying quality," and the thing a naive uniform design misses.

---

**Part 2 — the edit-verify loop, adapted to test quality**

\`\`\`
FIRST: ASSESS THE SIGNAL for this repo/task
  · do relevant tests exist for the area being
    changed?
  · are they fast enough to run in the loop?
  · are they flaky? (run the baseline a few times)

THEN branch on it:

STRONG SIGNAL (good, fast, stable tests)
  · standard edit-verify loop, targeted subset
    each iteration, full suite before PR
  · high confidence; the loop self-corrects well

WEAK/NO SIGNAL (little or no coverage for the area)
  · the agent WRITES A TEST that reproduces the
    bug FIRST — a failing test that captures the
    report
  · then fixes until that test passes
  · → this MANUFACTURES a verification signal
    where none existed, which is the key move
  · lower autonomy: flag for heavier review

FLAKY SIGNAL
  · quarantine the flaky tests (detected in the
    baseline run), don\'t reason from them
  · if the area\'s only tests are flaky, treat as
    weak signal
\`\`\`

**The bug-reproducing test is the design\'s answer to weak coverage, and it is the strongest move here.** **A bug report describes a failure; turning it into a failing test both creates the verification signal the loop needs AND leaves the codebase better than before** — the fix now has a regression test. **So "write a test that reproduces the bug, then fix until it passes" is not just verification, it is the right engineering practice, and it converts a no-signal repo into a has-signal one for this task.**

*And running the baseline first to detect flakiness is what keeps the loop honest:* **a flaky test in the changed area would make the agent think it fixed or broke something at random** — so flakiness detection is a precondition, not an afterthought.

---

**Part 3 — the sandbox on shared CI**

\`\`\`
THE THREAT on shared CI is acute:
  · the agent runs untrusted repo code (build,
    test, dependencies) for MANY repos
  · other teams\' pipelines and secrets share the
    infrastructure
  · a malicious dependency in ONE repo must not
    reach ANOTHER team\'s secrets

SO:
  · each agent run in an ISOLATED sandbox — a
    fresh container or microVM per task, torn down
    after
  · NO network, or a tight egress allow-list
    (dependency fetch through a controlled proxy,
    not open internet)
  · a scratch filesystem scoped to that checkout
    only
  · NO secrets in the sandbox — the agent has a
    scoped token for the ONE repo and the PR, and
    nothing else
  · resource limits + timeout kill (a repo\'s test
    suite could hang or fork-bomb)
  · multi-language means the sandbox must provide
    each language\'s toolchain, so per-language
    base images
\`\`\`

**The shared-CI setting makes isolation between runs as important as isolation from the host.** **The agent processes many repos, some of which will contain hostile or compromised code, so one run must not be able to reach another run\'s repo, another team\'s secrets, or the CI control plane** — which means per-run ephemeral sandboxes with no shared writable state and scoped, single-repo credentials. **A malicious dependency in a bug-fix run for repo A must be contained to that run, and it is, because the sandbox holds nothing else.**

*The controlled dependency proxy is the detail worth naming:* **builds need to fetch dependencies, which is a network need, so I don\'t forbid network entirely — I route dependency fetches through a proxy that only reaches package registries**, closing the open-internet exfiltration path while allowing the build to work.

---

**Part 4 — repo context across large multi-language codebases**

\`\`\`
PER LANGUAGE, build a structural index:
  · definitions, references, call graph, types
    (via each language\'s tooling — LSP-style
    indexers exist per language)
  · so "who calls this", "where is this defined",
    "what type is this" are EXACT lookups

RETRIEVAL for a bug fix:
  1. START from the bug report — the error, stack
     trace, or file it names
  2. TRAVERSE from there: the failing function,
     its callers, its callees, the types involved
  3. the relevant tests (existing, or where a new
     one goes)
  4. project conventions (a per-repo instructions
     file)
  5. SEMANTIC SEARCH as fallback for vague reports
     ("the checkout is slow") with no obvious
     entry point

MANAGE the context as it works:
  · the cumulative diff is the state
  · superseded file reads dropped
  · task + conventions pinned
\`\`\`

**The stack trace is the gift a bug report usually gives, and the retrieval starts there.** **A bug report often names a file, an error, or includes a stack trace — an exact entry point into the call graph** — so retrieval is "start at the failure and traverse the explicit structure outward," which is far more precise than semantic search over the whole repo. **Multi-language means a per-language structural indexer, but the retrieval strategy — traverse from the failure — is the same across all of them.**

*Semantic search earns its keep only for the vague reports:* **"the export feature feels broken" with no stack trace has no structural entry point**, so a semantic search over the code and docs finds the starting file, and traversal takes over from there. **Traversal is primary, similarity is the fallback for finding the entry point.**

---

**Part 5 — the review gate and anti-gaming**

\`\`\`
THE AGENT NEVER MERGES. It opens a PR with:
  · the fix, as a reviewable diff
  · the bug-reproducing test (weak-signal case)
  · a description: the bug, the root cause, what
    changed, and how it was verified

ANTI-GAMING CHECKS (in CI, which the agent can\'t
fake):
  · TEST INVENTORY DID NOT SHRINK — no test
    deleted or skipped to go green (diff the test
    list before/after)
  · ASSERTIONS NOT WEAKENED — flag removed or
    loosened assertions in existing tests
  · the NEW test actually FAILS against the
    pre-fix code — proving it tests the bug (run
    it against the parent commit)
  · full suite green on independent CI, not the
    agent\'s loop
  · the diff is scoped to files plausibly related
    to the bug (a 40-file diff for a one-line bug
    is flagged)

CONFIDENCE-BASED ROUTING:
  · strong-signal fix with a passing repro test →
    normal review
  · weak-signal fix → heavier review, flagged as
    lower confidence
\`\`\`

**The "new test fails against the pre-fix code" check is the one that makes a bug fix trustworthy.** **A regression test that passes both before and after the fix proves nothing — it doesn\'t test the bug** — so running it against the parent commit and asserting it fails there converts "the agent wrote a test" into "the agent wrote a test that captures this specific bug." **It\'s one extra test run and it\'s the difference between a real regression test and a decorative one.**

**And confidence-based routing is how the varying test quality flows through to review.** **A fix verified by a strong existing suite plus a passing repro test needs normal review; a fix in a repo with almost no coverage is inherently less verified and gets flagged for heavier human scrutiny** — so the human review effort is spent where the objective signal was weakest, which is exactly where it\'s most needed.

---

**The repo with almost no tests**

**The design already handles it: the agent writes a bug-reproducing test first, manufacturing the signal.** But there are limits, and I\'d be honest about them:

\`\`\`
· if the agent CAN write a reproducing test → it
  does, fixes against it, and the repo is left
  BETTER (a new regression test)
· if the bug is hard to reproduce in a test
  (environment-specific, UI, timing) → the agent
  has a WEAK signal it cannot strengthen, so:
    - lower its autonomy: it proposes a fix with
      an explicit "I could not verify this with a
      test" note
    - route to HEAVY human review
    - do NOT let it claim confidence it doesn\'t
      have
\`\`\`

**The honest position: a coding agent\'s value is proportional to the verification signal, so a repo with no tests and unreproducible bugs is where the agent is weakest, and the design should say so rather than paper over it.** **The worst outcome is an agent confidently "fixing" untestable bugs and merging plausible-but-unverified changes** — so the design makes low confidence visible and routes it to humans, rather than hiding it. **And the durable fix is cultural: the agent writing repro tests gradually improves the coverage, so the repo becomes more agent-amenable over time.**

---

**What I\'d measure**

\`\`\`
OUTCOME
  · PR merge-without-human-edit rate — did the fix
    actually work as-is
  · human edit size on merged PRs — rising means
    quality falling before merge rate does
  · reverted/reopened within 7 days — the fix that
    passed tests but was wrong
  · bugs fixed per repo, split by TEST QUALITY —
    exposes the signal-dependence directly

LOOP HEALTH
  · iterations per fix, p50/p95
  · verification runs per fix (the cost driver)
  · stuck-escalation rate and recovery-after-
    escalation
  · signal-assessment outcomes (how many repos/
    tasks fell into weak-signal)

SAFETY (page, not dashboard)
  · tests deleted/skipped in a PR — must be zero
  · sandbox escape attempts / policy violations
  · cross-run isolation breaches — zero

COST
  · cost per MERGED PR — the number that decides
    if it\'s worth running
\`\`\`

**The metric I\'d watch hardest is merge-without-edit rate split by test quality**, because it directly measures the design\'s central thesis: **the agent should do well where the verification signal is strong and worse where it\'s weak, and if that correlation doesn\'t appear, the loop isn\'t actually leaning on the signal the way the design assumes.** **And cost per merged PR is the bottom line** — a high success rate at an absurd cost, or a cheap agent that merges nothing, are both failures, and only the combined number tells the truth. **The safety metrics are pages: a deleted test or a cross-run isolation breach is the kind of silent failure that must never wait for a weekly review.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-code-1',
      level: 'basic',
      question: 'What makes a coding agent different from other agents?',
      guidance:
        'The objective, machine-checkable feedback loop. Look for the candidate building the whole design around the verification signal.',
    },
    {
      id: 'iq-code-2',
      level: 'basic',
      question: 'Walk me through the core loop.',
      guidance:
        'Edit, run build/tests, read failures, fix, repeat — the failure output drives the next edit. Not generate-and-commit.',
    },
    {
      id: 'iq-code-3',
      level: 'intermediate',
      question: 'The agent runs code. What isolation does it need, and against what?',
      guidance:
        'A real sandbox against generated code and the repo\'s own build/test steps (dependency code). No network, scratch FS, no secrets.',
    },
    {
      id: 'iq-code-4',
      level: 'intermediate',
      question: 'The repo is too big for the context. How do you retrieve?',
      guidance:
        'Call-graph traversal from the task\'s entry point — code structure is explicit. Semantic search only as a fallback.',
    },
    {
      id: 'iq-code-5',
      level: 'advanced',
      question: 'The test suite is weak or missing. What does the agent do?',
      guidance:
        'Write a bug-reproducing test first to manufacture a signal; lower confidence and require heavier review where it can\'t.',
    },
    {
      id: 'iq-code-6',
      level: 'advanced',
      question: 'How do you stop the agent from gaming the tests to pass?',
      guidance:
        'Assert the test inventory did not shrink and assertions were not weakened; independent CI as the check it cannot fake.',
    },
    {
      id: 'iq-code-7',
      level: 'followup',
      question: 'How do you know it\'s stuck?',
      guidance:
        'Failures not decreasing over N iterations — the objective, precise, free stuck signal no other agent domain has.',
    },
    {
      id: 'iq-code-8',
      level: 'followup',
      question: 'What would you measure to know it works?',
      guidance:
        'Merge-without-edit rate split by test quality, cost per merged PR, and revert rate — plus zero-tolerance safety pages.',
    },
  ],

  activeLearning: [
    {
      id: 'al-code-1',
      kind: 'explain-yourself',
      prompt:
        'A skeptic says: "Coding agents are just autocomplete with extra steps — the model writes code either way, so the loop and sandbox and retrieval are overhead that doesn\'t change what it can do." Make their case as strongly as you can, then say precisely where it fails.',
      discussion: `**The skeptic is pointing at a real thing — the model does generate the code — and drawing a wrong conclusion from it, which is the instructive gap.**

**The case for.**

**The model is the source of the code, unavoidably.** **The loop, the sandbox, the retrieval — none of them write a line; the model does** — so in a sense the intelligence is all in the model and the rest is plumbing. **A better model writes better code with or without the harness**, which is true.

**And autocomplete already works without any of it.** **Inline code completion — no loop, no sandbox, no retrieval — is genuinely useful and ships to millions.** **So the skeptic can point to a working product that skips everything this lesson describes**, which makes the "it\'s overhead" claim concrete rather than abstract.

**The trend argument, too.** **As models improve, they write correct code more often on the first try** — so the loop\'s value (catching and fixing mistakes) shrinks as first-try correctness rises. **Investing in elaborate harness machinery could be investing in a workaround for a problem being solved elsewhere.**

**Where it fails, and the failures are of different kinds.**

**Failure 1 — the loop changes what the system can COMPLETE, not just how it writes.**

\`\`\`
Autocomplete: suggests code; a HUMAN verifies,
  runs it, fixes it → the human closes the loop
Agent:        closes the loop ITSELF → it can
  complete a task end to end, not just suggest
\`\`\`

**This is the core error.** **Autocomplete is a suggestion a human verifies; an agent is a completion the system verifies** — and the difference is exactly the loop. **Remove the loop and you have autocomplete, which cannot take a bug report and produce a tested fix** — it can only suggest, leaving the verifying to a person. **The loop is not overhead on top of autocomplete; it is the thing that makes it an agent rather than autocomplete.**

**Failure 2 — first-try correctness does not remove the need to verify.**

**Even a model that writes correct code 90% of the time is wrong 10% of the time**, and without verification you don\'t know which. **The loop\'s value is not that the model is bad — it\'s that you cannot tell a correct generation from an incorrect one without running it** — so as long as correctness is below 100%, verification is what converts "probably right" into "checked right." **The trend argument shrinks the number of loop iterations; it does not remove the need for the loop, because the last iteration is the verification that it worked.**

**Failure 3 — the sandbox is a security requirement, not a capability one.**

**The skeptic frames everything as "does it change what the model can do," which is the wrong axis for the sandbox.** **The sandbox doesn\'t make the agent write better code — it stops the agent (or the repo\'s dependencies) from compromising your infrastructure when the code runs.** **A better model does not make untrusted dependency code safe to execute** — so the sandbox is orthogonal to model quality, and no amount of model improvement removes it. **It\'s overhead the way a seatbelt is overhead.**

**Failure 4 — retrieval is what lets it work on real repos at all.**

**Autocomplete works on the file you\'re in; an agent fixing a bug needs code it isn\'t looking at** — the caller three files away, the type defined elsewhere. **A model with no retrieval, however good, cannot reason about a codebase it can\'t see, and a real codebase doesn\'t fit in the context.** **So retrieval isn\'t overhead — it\'s what scales the agent from a single file to a repository**, which is precisely the gap between autocomplete and an agent.

**The synthesis.**

**"The model writes the code, yes — and the loop, sandbox, and retrieval are what turn code generation into task completion on real, large, untrusted codebases safely."**

\`\`\`
Without the loop:      autocomplete (human
                       verifies)
Without retrieval:     single-file only
Without the sandbox:   an infrastructure
                       compromise waiting to happen
With all three:        an agent that takes a task
                       and returns a verified,
                       reviewable fix
\`\`\`

**The deeper point: the skeptic conflates "where does the intelligence come from" with "what makes it a usable system."** **The intelligence is in the model; the SYSTEM is in the harness** — and a better model makes the intelligence better while leaving the system\'s job unchanged. **Verification, isolation, and context assembly are not steps between the model and better code; they are what a code generator needs to become an agent that completes tasks on real repositories without a human holding its hand or a breach waiting to happen.** **The trend improves the model; it does not make the harness redundant, because the harness solves problems the model was never solving.**`,
    },
    {
      id: 'al-code-2',
      kind: 'modify-architecture',
      prompt:
        'Take the single coding agent and change the scope: instead of fixing one bug at a time, it must perform a large migration across a repo — e.g. upgrading a framework version that touches 300 files, with interdependent changes. What breaks, and how do you restructure it?',
      discussion: `**A 300-file migration breaks the single-loop assumption that a task fits in one context and one verification pass — and the fix is to decompose it, which is where the multi-agent and durable-execution lessons come in.**

**What breaks.**

**The task does not fit in one context.** **A bug fix touches a handful of files; a migration touches 300 with interdependencies** — so the whole change cannot be held in the working context at once, and the agent-memory limits bite hard. **The single-loop "retrieve the slice, edit, verify" assumes a bounded slice, and a migration has no small slice.**

**The verification signal is all-or-nothing and late.** **Halfway through a framework upgrade, the code does not compile — the old and new APIs are mixed** — so "run the tests" fails not because the work is wrong but because it is incomplete. **The objective signal, which was the agent\'s superpower, is unavailable until the migration is nearly done**, which removes the incremental self-correction the whole design relied on.

**And the cost/time explodes.** **300 files of interdependent change in one loop is an enormous, long-running task** that will blow any single-loop budget and, if it crashes, loses everything.

**How I\'d restructure it.**

**1. Decompose into independently-verifiable units.**

\`\`\`
The migration is not ONE task; it\'s a plan of
smaller ones:
  · identify the files and group them by
    dependency (leaves first — files nothing else
    depends on)
  · each group is a unit that can be changed and
    VERIFIED to compile/pass on its own, or
    against a compatibility shim
→ so the objective signal is restored PER UNIT,
  incrementally, instead of only at the end
\`\`\`

**Restoring incremental verification is the key move.** **The migration must be sequenced so that after each step the code still compiles and tests pass** — which is exactly how a careful human does a large migration: not all at once, but in verifiable increments, often behind a compatibility layer. **The agent\'s design must produce that sequence, because the objective loop only works on units small enough to verify.**

**2. A planning phase, then bounded execution per unit.**

\`\`\`
· PLAN (an agentic or analytical step): map the
  dependency graph, produce the ordered list of
  units, identify shared changes (a shim, a
  codemod)
· EXECUTE per unit: the single-agent edit-verify
  loop, scoped to that unit, verified incrementally
· this is the workflow-with-agentic-branches
  shape: deterministic sequencing, agentic
  per-unit editing
\`\`\`

**Much of a migration is mechanical and should be a codemod, not an agent.** **A framework upgrade often has large mechanical portions — a rename, an API signature change — that a deterministic codemod does perfectly and cheaply**, and the agent handles only the units where the change requires judgment (a non-mechanical API migration, a behavioural difference). **So the restructure pushes the mechanical bulk into deterministic transforms and reserves the agent for the genuinely ambiguous units** — which is the "if you can draw the flow chart, write the flow chart" discipline applied to migration.

**3. Durability, because it\'s long-running.**

\`\`\`
· the migration is a DURABLE WORKFLOW: each
  completed unit is a checkpoint (a commit)
· a crash resumes from the last verified unit,
  not the start
· the state — which units are done, which remain,
  the plan — is persisted
→ the durable-execution lesson: a multi-hour task
  cannot keep its progress in memory
\`\`\`

**4. Parallelism where units are independent.**

\`\`\`
· independent units (no dependency between them)
  can be migrated in PARALLEL — subagents, each
  with a fresh context scoped to its unit
· dependent units are sequenced
→ the multi-agent lesson: parallelism for
  wall-clock, justified by genuine independence,
  with the parent orchestrating and the units
  verified independently
\`\`\`

**5. The review gate scales up too.**

\`\`\`
· 300 files is not one reviewable PR
· split into a STACK of PRs by unit, each small,
  each independently verified and reviewable
· the human reviews increments, not a 300-file
  wall
→ and the anti-gaming checks (no deleted tests)
  apply per PR
\`\`\`

**A 300-file PR is unreviewable, so the migration must produce reviewable increments.** **The same decomposition that restores the verification signal also produces human-sized review units** — which is not a coincidence: **a change small enough to verify is usually small enough to review**, so the decomposition serves both the loop and the gate.

**What stays the same.**

**The edit-verify loop, per unit** — unchanged, just scoped smaller. **The sandbox** — identical, still executing untrusted code. **Retrieval** — per unit, still call-graph traversal. **The review gate\'s checks** — per PR. **The objective signal is still the axis; it\'s just applied per unit rather than to the whole migration**, which is the entire restructure in one sentence.

**The transferable point: scaling a coding task from one bug to a repo-wide migration is not a bigger loop — it\'s a decomposition into independently-verifiable units, sequenced by dependency, with mechanical bulk pushed to codemods, durability for the long run, parallelism where independent, and a stack of reviewable PRs.** **The single-agent loop is the primitive; a migration is an orchestration of that primitive over a plan** — which is why this lesson\'s prerequisite is the multi-agent lesson, and why the answer to "make the agent do more" is almost never "make the loop bigger" but "decompose into units the loop already handles."`,
    },
  ],

  revision: {
    bullets: [
      'A coding agent\'s defining property is an objective feedback loop — compile-or-not, pass-or-not.',
      'The agent verifies its own work, which is the superpower no judgment-based agent has.',
      'It is also the constraint: the agent is only as good as the tests are strong, fast and non-flaky.',
      'The edit-verify loop is the core: edit, run build/tests, read failures, fix, repeat.',
      'The failure output — a compiler error, a failing assertion — is the feedback driving the next edit.',
      'Weak tests mean "passing" verifies little; strength of the signal bounds the agent.',
      'Run the targeted subset each iteration and the full suite before the PR — speed bounds the loop.',
      'A flaky test is worse than a slow one: the agent reasons from noise and concludes it got lucky.',
      'The agent executes untrusted generated code AND the repo\'s own build/test steps.',
      'The sandbox protects against the repo as much as the agent — npm install runs unaudited code.',
      'Sandbox needs: no network, scratch filesystem, resource limits, timeout kill, no secrets.',
      'A real repo is too large to fit, so context is a retrieval problem.',
      'Traverse explicit structure — call graphs, types — because "who calls this" has an exact answer.',
      'Semantic search is the fallback for finding an entry point in a vague task.',
      '"Failures not decreasing over N iterations" is the strongest stuck signal any agent domain has.',
      'The agent never merges consequential code — it opens a PR and a human reviews and merges.',
      'The gate asserts the test inventory did not shrink and assertions were not weakened.',
      'Independent CI, not the agent\'s own loop, is the source of truth at merge.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'An agent built around an objective feedback loop: edit code, run build and tests in a sandbox, and let the failures drive the next edit — with repo context retrieved by structural traversal, execution isolated, and every consequential change gated by human review it cannot bypass.',
    whyItExists:
      'Because code has something almost no other domain gives an agent — a machine-checkable definition of correct — so the agent can verify and self-correct, and the whole design is about maximising and protecting that signal.',
    whenToUse: [
      'The edit-verify loop as the core mechanism.',
      'Targeted test subsets each iteration, the full suite before the PR.',
      'A real sandbox for all execution, sized to the repo\'s trust level.',
      'Call-graph traversal for context, semantic search as a fallback.',
      'The objective failure-count signal for stuck detection.',
      'A human review gate with anti-gaming checks and independent CI.',
    ],
    whenNotToUse: [
      'Generate-and-commit without running the code.',
      'Loading the whole repo into context.',
      'Executing generated or repo code with no isolation.',
      'Trusting the agent\'s own loop as the source of truth at merge.',
      'Merging consequential code without human review.',
      'Reasoning from a flaky verification signal.',
      'A single loop for a task too large to verify incrementally.',
    ],
    alternatives: [
      'Autocomplete, where a human verifies each suggestion instead of the system.',
      'Deterministic codemods, for the mechanical bulk of a large change.',
      'A decomposed workflow of small verified units, for a repo-wide migration.',
      'Writing a reproducing test first, to manufacture a signal in an untested repo.',
    ],
    tradeoffs: [
      'The edit-verify loop buys self-correction and costs a verification run per iteration.',
      'Targeted tests buy loop speed and cost a full run before the PR to catch regressions.',
      'A sandbox buys a bounded blast radius and costs isolation infrastructure.',
      'Structural retrieval buys exact context and costs a code-aware index.',
      'A review gate buys a safe irreversible step and costs review time.',
      'Manufacturing a test buys a signal in an untested repo and costs the effort to reproduce the bug.',
    ],
    failureModes: [
      'An unverified patch that does not compile, from generate-and-commit.',
      'A context filled with the whole repo, burying the relevant code.',
      'A malicious dependency reaching secrets because execution was unsandboxed.',
      'The agent reasoning from a flaky test and concluding it got lucky.',
      'A slow full-suite run making every loop iteration expensive.',
      'Passing by deleting the failing test.',
      'Weakened assertions slipping through review.',
      'A regression test that passes before and after, testing nothing.',
      'The agent merging an unreviewed change into a shared branch.',
      'A turn limit converting a stuck loop into a total loss instead of escalating.',
      'A single loop attempting a 300-file migration it cannot verify incrementally.',
    ],
    followUpQuestions: [
      'What is the verification signal, and how strong, fast and stable is it?',
      'Does the agent run its code, and where is it isolated?',
      'What does the sandbox protect against besides the agent\'s own code?',
      'How does it get context from a repo too large to fit?',
      'Why traversal over semantic search for code?',
      'How do you know it is making progress or stuck?',
      'Does it merge, or propose?',
      'What stops it from deleting a test to pass?',
      'What is the source of truth at merge — its loop or CI?',
      'What does it do in a repo with almost no tests?',
      'How would this scale to a repo-wide migration?',
    ],
  },
});
