import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-ai-evaluation',
  title: 'Evaluation systems: offline, online, agent',
  summary:
    'You cannot ship what you cannot measure, and a non-deterministic system defeats the test suite you already know how to write. Evaluation is the discipline that replaces it — and building the dataset is the work.',
  phase: 'ai',
  module: 'workflows',
  position: 85,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 55,
  tags: ['evaluation', 'llm-judge', 'regression', 'agent-evaluation', 'online-metrics'],
  prerequisites: ['a-rag-evaluation'],
  resources: [
    {
      key: 'langsmith-evaluation',
      tier: 'must',
      note: 'Read it for the offline/online split as two instruments answering two questions. The distinction between "did this change help" and "is it working now" runs through the whole lesson, and this is the clearest statement of it.',
    },
    {
      key: 'openai-evals-repo',
      tier: 'must',
      note: 'Read it as a concrete eval harness: a dataset, a task, a grader. Seeing the three parts as code makes the abstract structure of an evaluation tangible before you reason about its failure modes.',
    },
    {
      key: 'promptfoo-docs',
      tier: 'must',
      note: 'Read it for regression testing framed as a gate on change. It is the most direct treatment of an eval set as something you run before shipping, which is where evaluation earns its keep.',
    },
    {
      key: 'deepeval-metrics',
      tier: 'good',
      note: 'Read the metric catalogue for what people actually measure and how each is computed. It reinforces that a metric\'s inputs are its attribution — the lesson\'s central mechanical point.',
    },
    {
      key: 'arize-phoenix-evals',
      tier: 'good',
      note: 'Read it for evaluation as observability — tracing and online measurement rather than a one-off dataset run. This is the half of evaluation that keeps working after launch.',
    },
    {
      key: 'swe-bench-paper',
      tier: 'advanced',
      note: 'Read it for what a rigorous agent benchmark looks like: a real task, an objective end-state check, and honest scoring. It is the model for evaluating agents by outcome rather than by output.',
    },
  ],

  intuition: {
    body: `**The test you already know how to write assumes determinism.**

\`\`\`
assert add(2, 2) === 4
→ same input, same output, forever
\`\`\`

**A model breaks the assumption.** The same prompt gives different outputs, both acceptable; **a correct answer can be phrased a hundred ways; and "correct" is often a judgment rather than an equality.** **So \`assertEqual\` has nothing to compare against**, and the tooling you trust for everything else does not apply.

**Evaluation is what replaces it**, and it has three parts, always:

\`\`\`
DATASET   inputs, and what a good output looks
          like for each
TASK      run the system on each input
GRADER    score the output — exact match, a
          rule, or a judgment
\`\`\`

**And the dataset is the work.** **A grader is a library call; a task is your system; the dataset is a thing someone builds by hand from reality** — and every shortcut around it produces a number measuring the system against itself.

**Two instruments, answering two different questions:**

\`\`\`
OFFLINE   a fixed dataset, run on demand
          "did this change make it better?"
          → comparable across versions → a GATE
ONLINE    production traffic, sampled
          "is it working right now?"
          → the real distribution → DRIFT and
            incidents
\`\`\`

**They are not substitutes**, and the common failure is having only online — which cannot tell you whether a change helped, because the traffic differs every day.

**Then the grader problem, because most outputs need judgment:**

\`\`\`
A model grading a model works — with conditions.
→ calibrate it against humans ONCE, or you do
  not know what it measures
→ it is biased toward length, confidence, and
  its own phrasing
\`\`\`

**And agents move the target.** **You cannot compare an action sequence to a reference sequence** — two different sequences can both be right. **So agents are graded on the end state, not the output** — which turns evaluation into assertions on the world, closer to an integration test than a dataset.`,
    analogyLimit:
      '"Write tests for it" assumes a deterministic system with a comparable output, and a model is neither — the same input gives different acceptable outputs, and "correct" is often a judgment. Evaluation replaces the test suite with a dataset, a task and a grader, and the dataset built by hand from reality is the work. It also hides that offline and online answer different questions, that a model grader measures nothing until calibrated, and that agents are graded on end state, not output.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team ships an LLM feature with no evaluation beyond manual spot-checks. It works. Two months later they want to change the prompt to fix a specific complaint, upgrade the model, and add a tool — all at once. They are nervous about shipping. Explain what evaluation they should have built, and what each change specifically needs.',
      answer: `**The core problem: they have no way to know whether a change helps or harms, so every change is a gamble.**

**What they should have built: an offline eval set, from day one.**

\`\`\`
· 100-300 real inputs, drawn from actual usage
· for each, what a good output must contain (or
  its exact answer, or the properties it must
  satisfy)
· stratified by the kinds of input that occur
· ~10% adversarial and edge cases
\`\`\`

**This is the instrument that answers "did this change help"**, and it is the one they are missing. **Without it, "we fixed the complaint" is a hope**, because a prompt change that fixes one case routinely breaks three others — **and manual spot-checks cannot see the three.**

**What each change needs, specifically.**

**The prompt change → a regression run.**

\`\`\`
Run the eval set before and after.
Gate on: the targeted metric improved, AND
         nothing else regressed
→ the whole point: a prompt fix that helps the
  complaint and quietly breaks a category is
  the normal outcome, visible only per-category
\`\`\`

**The model upgrade → the same run, plus a judge re-check.**

**A new model can be better on average and worse on your specific task**, and only the eval set on your inputs tells you which. **And if a model judge is used, it may behave differently on the new model\'s phrasing** — so the judge is re-validated, or the comparison is contaminated.

**The tool addition → agent-style evaluation.**

**A tool changes the system from "produce text" to "take actions"**, so text metrics no longer cover it. **This needs end-state checks: did it call the tool correctly, with the right arguments, and not call it when it should not?** — which is a different eval from the output grading the other two changes need.

**And shipping all three at once → do not.**

\`\`\`
Three changes, one eval run:
  score moved — WHICH change caused it?
→ ship sequentially, or the eval set cannot
  attribute the result, which is its whole value
\`\`\`

**What "nervous about shipping" actually is.**

**It is the correct response to changing an unmeasured system**, and the fix is not courage — **it is the instrument.** **A team with an eval set ships the prompt change in an hour** because the gate tells them it is safe; **a team without one is right to be afraid.**

**The transferable point: evaluation is not a quality nicety, it is what makes change safe.** **Its absence does not show up until the second change** — the first ships on spot-checks and luck, and the debt comes due exactly when the system needs to evolve.`,
    },
  body: `## The three parts, and which one is hard

\`\`\`
DATASET   inputs + the reference for a good output
TASK      the system under test
GRADER    input, output (and reference) → a score
\`\`\`

**Two of the three are cheap.** The task is your system; **the grader is exact-match, a rule, or a judge call.** **The dataset is the expensive one**, and it is expensive because it must come from reality:

\`\`\`
GOOD SOURCES (real distribution)
  · production logs and real user inputs
  · the support queue, past tickets, the work
    this replaces
  · domain experts, who supply the hard cases
    and the reference answers
WEAK SOURCE (biased optimistic)
  · model-generated inputs → phrased like the
    system expects, so they overstate quality;
    fine for coverage, dangerous as the whole set
\`\`\`

**And the property that makes a dataset useful is stratification.** **A set of 200 easy cases reports excellent quality on a system that fails every hard one** — so categories must reflect the real mix and be scored separately. **An average over a stratified set is an average weighted by the set\'s composition, not by what matters.**

*One deliberate inclusion:* **cases the system should refuse or cannot answer.** **Without them nothing measures whether it declines appropriately** — and a system that always answers, including when it should not, scores well on everything else.

## Graders, from cheap to hard

\`\`\`
EXACT / RULE      output === reference, or a regex,
                  or a schema check, or "the code
                  compiles"
                  → deterministic, free, and only
                    works when correctness is
                    mechanical
CODE-EXECUTED     run the output and assert on the
                  result — the gold standard when
                  available (does the test pass?)
JUDGE (a model)   score a judgment — helpfulness,
                  faithfulness, tone
                  → the only affordable option at
                    scale for subjective quality,
                    with conditions
HUMAN             the ground truth, and too slow
                  to run on every change
\`\`\`

**Reach for the cheapest that fits.** **A surprising amount of "subjective" quality is actually mechanical** — does it cite a real source, is it valid JSON, does it contain the required fields, does the generated code run — **and a rule-based grader for those is faster, free, and not itself a thing that can be wrong.**

## The model-as-judge, done properly

**Most interesting quality needs judgment, and a human cannot grade every change**, so a model judges. **It works with three conditions, and skipping them is the usual failure.**

**Calibrate against humans, once.** **Score 50 items by hand, score the same 50 with the judge, measure agreement.** **Below some threshold the judge is measuring something other than what you named** — and every number derived from it is then unusable. **This is the step teams skip, and it invalidates everything downstream silently.**

**Make the judge\'s task narrow and binary.** **"Is this claim supported by this source — yes or no" is reliable; "rate this answer 1-5 for quality" is not**, because the scale has no shared meaning across items. **Decompose a quality judgment into specific checkable questions** rather than asking for a number.

**And version the judge with the eval set.** **Upgrading the judge model silently shifts every historical score**, breaking comparisons nobody realises are broken — so the judge model and its prompt are pinned exactly like the dataset.

*The biases to know, because they are systematic:* **judges prefer longer answers, prefer confident tone, prefer their own phrasing, and — critically — should never grade the output of the same model that produced it on a dimension it optimised**, because it inherits the generator\'s blind spots. **A grader that shares the generator\'s mistakes confirms rather than checks.**

## Offline: the regression gate

**The reason to build all of this is to change the system safely.**

\`\`\`
Before shipping ANY change — prompt, model,
retrieval, tool, temperature:
  1. run the eval set
  2. compare PER CATEGORY against the baseline
  3. BLOCK on a regression in a safety property
     (faithfulness, refusal, injection resistance)
  4. REQUIRE the metric the change targeted to
     move
  5. ship one change at a time, or the result
     cannot be attributed
\`\`\`

**Two failures this catches that nothing else does.** **A change that lifts the average and destroys one category** — visible only per-category. **And a change that improves a metric by degrading a behaviour** — relevance rising because the system stopped refusing, which is a regression wearing an improvement\'s clothes.

*And the gate must not be flakier than its signal.* **At 100 items a single item is 1%**, so a noise band matters — **run the set a few times on an unchanged system first to measure its variance**, or a gate that fires spuriously gets disabled, which is worse than no gate.

## Online: the instrument that survives launch

**Offline answers "did this change help." Online answers "is it working now"** — and only the second sees the real distribution, which drifts.

\`\`\`
NO GROUND TRUTH IN PRODUCTION, so measure what
needs none:
  · guardrail fire rates (refusals, safety
    filters) — a sudden drop means something
    broke
  · faithfulness / self-consistency on sampled
    traffic (computable from context + output)
  · latency, cost, error rates
  · BEHAVIOURAL SIGNALS: thumbs, rephrase rate,
    escalation rate, task abandonment
  · the retrieval/score distribution — a shift
    means the corpus or the queries moved
\`\`\`

**The strongest online signal is usually behavioural**, because explicit feedback is rare: **a user who rephrases the same question twice did not get an answer**, and that needs no cooperation to observe. **Thumbs are clicked by a percent or two of users; rephrases happen every time the system fails.**

*And a confirmed production failure is an eval-set row.* **The pipeline from "user complained" to "regression test that would have caught it" should be short** — which is how the offline set stays representative of what actually breaks.

## Evaluating agents: the target moves

**An agent takes actions, so its output is not text to grade but a change to the world** — and that breaks the dataset-plus-grader shape in a specific way.

\`\`\`
TEXT EVAL   compare output to a reference output
AGENT EVAL  compare the RESULTING STATE to the
            expected state
            → because two different action
              sequences can both be correct
            → so there is no reference trajectory
              to compare against
\`\`\`

**Which makes an agent eval a set of fixtures plus assertions** — closer to an integration test suite than a dataset:

\`\`\`
An agent eval item:
  initial state (a seeded sandbox)
  the request
  ASSERTIONS on the final state
  forbidden actions (must NOT have occurred)
  a step budget
\`\`\`

**Three things this adds over text evaluation.**

**A sandbox is mandatory, not an optimisation.** **A text eval runs a thousand times safely; an agent eval files a thousand real tickets** unless it runs against seeded, reset state. **Evaluation stops being side-effect-free**, which changes everything about how it is run.

**Trajectory quality matters, not only the outcome.** **An agent that reaches the right end state in 14 wandering steps, or by attempting a destructive action that happened to fail, is not correct** — so evals assert on step count, on redundant calls, and on forbidden actions attempted, not just on the result.

**And online agent evaluation is largely unavailable.** **You cannot re-run a production action to check it**, so online becomes outcome monitoring — reversal rate, override rate, complaint rate — rather than evaluation. **The offline sandbox carries almost the whole load**, which is the opposite of the text case where online does real work.

## What to say in a design discussion

**That evaluation replaces the deterministic test suite a model defeats, and it is a dataset, a task and a grader — the dataset being the work.**

**That the dataset comes from reality, is stratified, and includes cases the system should refuse.**

**That you reach for the cheapest grader that fits, and much subjective quality is mechanically checkable.**

**That a model judge is calibrated against humans once, given narrow binary tasks, versioned, and never set to grade its own model\'s dimension.**

**That offline is a regression gate answering "did this help", scored per category, one change at a time.**

**That online answers "is it working now" with ground-truth-free and behavioural metrics, and the strongest signal is usually behavioural.**

**And that agents are evaluated on end state in a sandbox, with trajectory and forbidden-action assertions — an integration test, not a dataset.**`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'eval-system',
      title: 'One evaluation, two instruments, and the moving target of agents',
      caption:
        'Step through it. The dataset is the expensive part on the left; the two instruments answer different questions; and an agent changes what the grader compares against.',
      nodes: [
        { id: 'data', label: 'Dataset from reality — the work', kind: 'store', x: 0, y: 170, detail: 'Real inputs and a reference for each, stratified by the kinds of case that occur, with roughly a tenth adversarial and a share the system should refuse. Model-generated inputs overstate quality because they are phrased the way the system expects — fine for coverage, dangerous as the whole set.' },
        { id: 'task', label: 'Task — the system under test', kind: 'service', x: 250, y: 170, detail: 'Your system, run on each input. The cheap part. One change at a time, or a moved score cannot be attributed to a cause — which is the eval set\'s whole value.' },
        { id: 'grader', label: 'Grader — cheapest that fits', kind: 'service', x: 500, y: 170, detail: 'Exact-match or a rule where correctness is mechanical; executed code where the output can be run; a calibrated model judge for genuine judgment; humans as the ground truth that is too slow for every change. A surprising amount of "subjective" quality is mechanically checkable.' },
        { id: 'judge', label: 'Judge: calibrated, binary, versioned', kind: 'external', x: 500, y: 30, detail: 'Score 50 items against humans once, or you do not know what it measures. Ask "is this claim supported, yes or no", not "rate 1-5". Pin the judge model and prompt, because upgrading it silently shifts every historical number — and never let it grade its own model\'s dimension.' },
        { id: 'offline', label: 'Offline: the regression gate', kind: 'service', x: 750, y: 60, detail: 'Answers "did this change help". Run the fixed set before and after, compare per category, block on safety regressions, require the targeted metric to move. Catches the change that lifts the average and destroys one category — invisible to a single number.' },
        { id: 'online', label: 'Online: is it working now', kind: 'service', x: 750, y: 290, detail: 'Answers a different question on the real distribution: ground-truth-free metrics (guardrail fire rates, faithfulness on samples), and behavioural signals — rephrase rate, escalation, abandonment. The strongest signal is usually behavioural, because explicit feedback is rare.' },
        { id: 'agent', label: 'Agents: assert on end state, in a sandbox', kind: 'store', x: 250, y: 320, detail: 'Two action sequences can both be right, so there is no reference trajectory — grade the resulting state. That needs a seeded, reset sandbox because an agent eval has side effects, plus assertions on step count and forbidden actions, not just the outcome.' },
        { id: 'row', label: 'A production failure becomes an eval row', kind: 'note', x: 0, y: 320, detail: 'The pipeline from "user complained" to "regression test that would have caught it" should be short — which is how the offline set stays representative of what actually breaks rather than of what was easy to write.' },
      ],
      edges: [
        { id: 'e1', source: 'data', target: 'task', kind: 'sync' },
        { id: 'e2', source: 'task', target: 'grader', kind: 'sync' },
        { id: 'e3', source: 'judge', target: 'grader', kind: 'control' },
        { id: 'e4', source: 'grader', target: 'offline', kind: 'sync' },
        { id: 'e5', source: 'grader', target: 'online', kind: 'sync' },
        { id: 'e6', source: 'data', target: 'agent', kind: 'control' },
        { id: 'e7', source: 'online', target: 'row', kind: 'async' },
        { id: 'e8', source: 'row', target: 'data', kind: 'async' },
      ],
      steps: [
        {
          id: 'ev1',
          title: 'Build the dataset from reality',
          description:
            'Real inputs with references, stratified, including refusals. This is the expensive part and the one every shortcut degrades — the task and grader are cheap by comparison.',
          nodes: ['data', 'task'],
          edges: ['e1'],
        },
        {
          id: 'ev2',
          title: 'Grade with the cheapest thing that fits',
          description:
            'Rules and executed code where correctness is mechanical; a judge only for genuine judgment. Much "subjective" quality is a schema check or a compile in disguise.',
          nodes: ['grader'],
          edges: ['e2'],
        },
        {
          id: 'ev3',
          title: 'A judge is an instrument, so calibrate it',
          description:
            'Validate against humans once, keep its task binary, version it with the set, and never let it grade its own model. An uncalibrated judge measures something unknown.',
          nodes: ['judge'],
          edges: ['e3'],
        },
        {
          id: 'ev4',
          title: 'Two instruments, two questions',
          description:
            'Offline gates change with a fixed comparable set; online watches the drifting real distribution with metrics that need no ground truth. Neither substitutes for the other.',
          nodes: ['offline', 'online'],
          edges: ['e4', 'e5'],
        },
        {
          id: 'ev5',
          title: 'Agents move the target, and the loop closes',
          description:
            'Grade an agent on end state in a sandbox, with forbidden-action assertions. And feed confirmed production failures back into the dataset, so it tracks what actually breaks.',
          nodes: ['agent', 'row'],
          edges: ['e6', 'e7', 'e8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'grader-ladder',
      title: 'Pick the cheapest grader the output allows',
      caption:
        'Read top to bottom and stop at the first that fits. Most teams jump straight to a model judge and pay for calibration on things a schema check would have graded for free.',
      code: `flowchart TB
    Q["**How do you score this output?**"]

    Q --> M["Is correctness **mechanical**?<br/>exact value, valid JSON, required<br/>fields, a real citation, a regex"]
    M -->|Yes| M1["**Rule / exact match**<br/>free, deterministic, and not<br/>itself a thing that can be wrong"]

    M -->|No| C["Can the output be **run**?<br/>generated code, a query, a<br/>structured action"]
    C -->|Yes| C1["**Execute and assert**<br/>the gold standard — does the<br/>test pass, does the state match"]

    C -->|No| J["Is it a **judgment**?<br/>helpfulness, faithfulness, tone"]
    J -->|Yes| J1["**Model judge — with conditions**<br/>calibrate vs humans once ·<br/>binary questions, not 1-5 ·<br/>version it · never grade its<br/>own model's dimension"]

    J -->|Ground truth<br/>needed and<br/>subjective| H["**Human**<br/>the ground truth, too slow for<br/>every change → spend it on<br/>calibration and hard cases,<br/>not volume"]

    style M1 fill:#17272a,stroke:#35897e
    style C1 fill:#17272a,stroke:#35897e
    style J1 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `SWE-bench is the most useful reference here because it shows what a rigorous evaluation looks like when the output can be checked objectively — and how much that objectivity is worth.

**The task.** Given a real GitHub issue and a repository, produce a patch that resolves it. **The grader is not a judgment: it runs the project\'s own test suite against the patched code.** A patch passes if the tests pass. **No model judges anything** — the world does.

**Why this is the model to aspire to.** **Correctness is defined by an executable check on the outcome**, not by comparing the patch to a reference patch — **because there are many correct patches and only one property that matters: the tests pass.** **That is the agent-evaluation principle in its cleanest form: grade the end state, not the trajectory or the output.**

**Three transferable lessons.**

**Where an executable check exists, use it and skip the judge entirely.** **A model grader is a fallback for when correctness is genuinely subjective** — and code, schemas, and state assertions are objective far more often than teams assume.

**A hard, realistic benchmark is honest in a way a demo is not.** **Real issues from real repositories produce scores that are low and true**, rather than high and staged — and the gap between benchmark performance and demo performance is exactly the gap between what a system does and what it appears to do.

**And the end-state check tolerates diverse solutions.** **The evaluation does not care how the patch was reached or what it looks like**, only that the resulting code works — which is the only fair way to grade something that can succeed by many paths.

**Where this does not transfer.** **Most tasks lack a ready-made executable check** — there is no test suite for "was this support reply good" — **so the objective grader has to be manufactured**, and manufacturing it (the reference answers, the assertions, the sandbox) is the dataset work this lesson keeps returning to. **SWE-bench got its grader for free from the repositories; most systems have to build theirs.**`,
  },

  tradeoffs: {
    intro:
      'The decisions an evaluation system involves, most of which trade cost against fidelity.',
    rows: [
      {
        option: 'Manual spot-checks',
        whenItWins:
          'The very first prototype, before there is anything to regress.',
        whenItLoses:
          'Any system that will change — they cannot catch a regression in a category you did not happen to check.',
        cost:
          'A system nobody can safely change.',
      },
      {
        option: 'An offline eval set',
        whenItWins:
          'Always, past the prototype. It answers "did this change help".',
        whenItLoses:
          'Drifts from production as the real distribution moves.',
        cost:
          'The dataset — built by hand from reality, and refreshed.',
      },
      {
        option: 'Online evaluation',
        whenItWins:
          'Detecting drift and incidents in the real, current distribution.',
        whenItLoses:
          'Different traffic each day, so it cannot attribute a change.',
        cost:
          'Only ground-truth-free metrics are available.',
      },
      {
        option: 'Rule or exact-match graders',
        whenItWins:
          'Wherever correctness is mechanical — a value, a schema, a real citation.',
        whenItLoses:
          'Genuine judgment — tone, helpfulness, faithfulness.',
        cost:
          'Nothing; they are free and cannot themselves be wrong.',
      },
      {
        option: 'Code-executed graders',
        whenItWins:
          'When the output can be run — the gold standard, as in SWE-bench.',
        whenItLoses:
          'Outputs with no executable check.',
        cost:
          'A harness and, for agents, a sandbox.',
      },
      {
        option: 'A model judge',
        whenItWins:
          'Subjective quality at scale, which humans cannot grade on every change.',
        whenItLoses:
          'Uncalibrated, it measures something unknown; biased toward length and confidence.',
        cost:
          'A calibration step and version pinning.',
      },
      {
        option: 'A 1-5 quality score from a judge',
        whenItWins:
          'Nowhere reliably — the scale has no shared meaning across items.',
        whenItLoses:
          'The number drifts with phrasing and length rather than quality.',
        cost:
          'A metric that looks precise and measures noise.',
      },
      {
        option: 'Binary, decomposed judge questions',
        whenItWins:
          'Always, over a rating — "is this claim supported, yes or no".',
        whenItLoses:
          'Requires decomposing quality into checkable sub-questions.',
        cost:
          'Design effort, for a reliable grader.',
      },
      {
        option: 'A single overall score',
        whenItWins:
          'A quick headline, and nothing else.',
        whenItLoses:
          'It hides a category collapsing and cannot attribute a failure.',
        cost:
          'A number that points nowhere.',
      },
      {
        option: 'Per-category scoring',
        whenItWins:
          'Any gate meant to catch regressions.',
        whenItLoses:
          'More to maintain, and needs a stratified set.',
        cost:
          'A dataset with real categories.',
      },
      {
        option: 'Comparing agent output to a reference sequence',
        whenItWins:
          'Nowhere — two correct sequences differ.',
        whenItLoses:
          'It fails every agent that solves the task a different valid way.',
        cost:
          'False regressions on correct behaviour.',
      },
      {
        option: 'Asserting on an agent\'s end state',
        whenItWins:
          'Every agent eval — grade the world, not the trajectory.',
        whenItLoses:
          'Requires a seeded, resettable sandbox and end-state assertions.',
        cost:
          'An integration-test harness with real side effects controlled.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We spot-check outputs manually and it looks good, so we ship."',
      whyWeak:
        'Spot-checks cannot catch a regression in a category you did not happen to look at, and they scale with human time, so they are abandoned exactly when the system grows complex enough to need them. The absence shows up on the second change, when a prompt fix silently breaks three other cases.',
      strongAnswer:
        '"I build an offline eval set early: real inputs with references, stratified by the kinds of case that occur, including ones the system should refuse. It is the instrument that answers \'did this change help\', which is what makes change safe rather than a gamble. Manual review still matters — for calibrating the judge and reading hard cases — but as the ground truth for a small sample, not as the regression gate. The dataset is the expensive part and the part that earns its keep."',
    },
    {
      weakAnswer: '"A model scores every output 1 to 5 for quality, and we track the average."',
      whyWeak:
        'A 1-5 scale has no shared meaning across items, so the number drifts with length, confidence and phrasing rather than quality. And an uncalibrated judge measures something unknown — nobody checked whether its scores agree with a human\'s.',
      strongAnswer:
        '"I decompose quality into narrow binary questions the judge answers reliably — is this claim supported, is the format valid, does it address the question — rather than a rating. I calibrate the judge against fifty human-scored items once and measure agreement, because below a threshold it is measuring something other than what I named. I version the judge model and prompt with the dataset, since upgrading the judge silently shifts every historical score, and I never let a model grade its own output on a dimension it optimised, because it inherits its own blind spots."',
    },
    {
      weakAnswer: '"We watch production metrics, so we know the system is working."',
      whyWeak:
        'Online metrics answer "is it working now" on traffic that differs every day, so they cannot answer "did this change help" — the questions have different instruments. A team with only online evaluation cannot tell a good deploy from an easy week.',
      strongAnswer:
        '"Offline and online are two instruments for two questions. Offline is a fixed comparable set that gates a change — did this specific edit help, scored per category. Online is sampled production traffic that catches drift and incidents on the real distribution, using metrics that need no ground truth: guardrail fire rates, faithfulness on samples, and behavioural signals like rephrase and escalation rate. I want both, and the strongest online signal is usually behavioural, because a user who rephrases twice tells me more than the two percent who click a thumb."',
    },
    {
      weakAnswer: '"The eval average went from 82% to 87%, so the change is good — ship it."',
      whyWeak:
        'An average hides a category collapsing while others improve, and it hides a metric rising because a behaviour degraded — relevance up because refusals went down. And if several changes shipped together, the moved score cannot be attributed to any of them.',
      strongAnswer:
        '"I gate per category, not on the average, and block specifically on safety-property regressions like faithfulness, appropriate refusal, and injection resistance — because those are the ones an average launders away. I also require the metric the change targeted to move, so an unexplained improvement gets investigated rather than shipped, and I ship one change at a time, because the eval set\'s entire value is attribution, and three simultaneous changes destroy it."',
    },
    {
      weakAnswer: '"For the agent, we check that its output matches our reference solution."',
      whyWeak:
        'Two different action sequences can both be correct, so comparing to a reference trajectory produces false regressions on perfectly good behaviour. An agent\'s output is a change to the world, not text to match.',
      strongAnswer:
        '"I grade an agent on the resulting state, not the trajectory or the output: seed a sandbox, run the request, and assert on the final state — the ticket exists with these fields, no email was sent, the record is in this status. That needs a resettable sandbox because an agent eval has real side effects, unlike a text eval that runs safely a thousand times. I also assert on trajectory quality — step count, forbidden actions attempted — because reaching the right end state by attempting a destructive action that happened to fail is not correct."',
    },
    {
      weakAnswer: '"We generate the eval set by asking a model to write test cases from the docs."',
      whyWeak:
        'Model-generated inputs are phrased the way the system expects, so they overstate quality, and they contain none of the awkward, ambiguous, or unanswerable cases real users produce. The number looks good and the set measures the system against its own assumptions.',
      strongAnswer:
        '"Generated cases are useful for coverage — making sure no part of the system is untested — and dangerous as the whole set. The valuable inputs come from production logs, the support queue, and domain experts who supply the hard cases and the reference answers. I deliberately include adversarial and unanswerable cases, and I feed confirmed production failures back in as new rows, so the set tracks what actually breaks rather than what was easy to generate. A confirmed complaint should become a regression test quickly."',
    },
  ],

  flashcards: [
    {
      id: 'fc-aiev-1',
      front: 'Why does a deterministic test suite not work for a model?',
      back: 'Same input gives different acceptable outputs, correct answers phrase many ways, and "correct" is often a judgment — so assertEqual has nothing to compare.',
      topic: 'evaluation',
    },
    {
      id: 'fc-aiev-2',
      front: 'What are the three parts of any evaluation?',
      back: 'A dataset (inputs plus references), a task (the system), and a grader (scores the output). The dataset is the expensive part.',
      topic: 'evaluation',
    },
    {
      id: 'fc-aiev-3',
      front: 'Where should eval-set inputs come from?',
      back: 'Reality — production logs, the support queue, domain experts. Model-generated inputs overstate quality and are for coverage only.',
      topic: 'evaluation',
    },
    {
      id: 'fc-aiev-4',
      front: 'Why must an eval set be stratified?',
      back: '200 easy cases report excellent quality on a system that fails every hard one — categories must reflect the real mix and be scored separately.',
      topic: 'evaluation',
    },
    {
      id: 'fc-aiev-5',
      front: 'What do offline and online evaluation each answer?',
      back: 'Offline: "did this change help" — a fixed comparable set, a gate. Online: "is it working now" — the drifting real distribution.',
      topic: 'online-metrics',
    },
    {
      id: 'fc-aiev-6',
      front: 'Reach for which grader first?',
      back: 'The cheapest that fits — a rule or executed code where correctness is mechanical, before a model judge. Much "subjective" quality is mechanical.',
      topic: 'evaluation',
    },
    {
      id: 'fc-aiev-7',
      front: 'What three conditions make a model judge usable?',
      back: 'Calibrated against humans once, narrow binary questions instead of a rating, and versioned with the dataset.',
      topic: 'llm-judge',
    },
    {
      id: 'fc-aiev-8',
      front: 'Why never let a model grade its own output\'s dimension?',
      back: 'It inherits the generator\'s blind spots — a mistake it made, it will judge as fine. The grader confirms rather than checks.',
      topic: 'llm-judge',
    },
    {
      id: 'fc-aiev-9',
      front: 'Name three systematic judge biases.',
      back: 'Preference for longer answers, for confident tone, and for its own phrasing.',
      topic: 'llm-judge',
    },
    {
      id: 'fc-aiev-10',
      front: 'What must a regression gate do beyond raising the average?',
      back: 'Score per category, block on safety-property regressions, require the targeted metric to move, and take one change at a time.',
      topic: 'regression',
    },
    {
      id: 'fc-aiev-11',
      front: 'Which online metrics need no ground truth?',
      back: 'Guardrail fire rates, faithfulness on samples, latency and cost, and behavioural signals — rephrase, escalation, abandonment.',
      topic: 'online-metrics',
    },
    {
      id: 'fc-aiev-12',
      front: 'Why grade an agent on end state rather than output?',
      back: 'Two different action sequences can both be correct, so there is no reference trajectory — assert on the resulting state instead.',
      topic: 'agent-evaluation',
    },
    {
      id: 'fc-aiev-13',
      front: 'Why does an agent eval need a sandbox?',
      back: 'It has real side effects — a text eval runs safely a thousand times, an agent eval files a thousand tickets unless run against seeded, reset state.',
      topic: 'agent-evaluation',
    },
    {
      id: 'fc-aiev-14',
      front: 'Beyond the outcome, what must an agent eval assert?',
      back: 'Trajectory quality — step count, redundant calls, and forbidden actions attempted — because reaching the right state a wrong way is not correct.',
      topic: 'agent-evaluation',
    },
  ],

  quiz: [
    {
      id: 'q-aiev-1',
      kind: 'scenario',
      prompt:
        'A team monitors production metrics but has no fixed eval set. They want to change the prompt. What can they not do?',
      options: [
        { id: 'a', label: 'Determine whether the change helped — production traffic differs each day, so there is nothing comparable to measure against' },
        { id: 'b', label: 'Deploy the change' },
        { id: 'c', label: 'Monitor latency' },
        { id: 'd', label: 'Collect user feedback' },
      ],
      correct: ['a'],
      explanation:
        'Online metrics answer "is it working now" on a moving distribution, which cannot attribute a change. Answering "did this change help" needs a fixed, comparable dataset — the offline instrument they are missing.',
      difficulty: 'core',
      topic: 'online-metrics',
    },
    {
      id: 'q-aiev-2',
      kind: 'scenario',
      prompt:
        'An output must be valid JSON containing three specific fields and a real citation. What grader should you use?',
      options: [
        { id: 'a', label: 'A rule-based grader — the correctness is entirely mechanical, so it is free and cannot itself be wrong' },
        { id: 'b', label: 'A model judge scoring 1-5 for quality' },
        { id: 'c', label: 'Human review of every output' },
        { id: 'd', label: 'A second model rewriting and comparing' },
      ],
      correct: ['a'],
      explanation:
        'Valid JSON, required fields and a citation that resolves are all mechanical checks. Reaching for a judge here pays calibration cost and adds a grader that can be wrong, for something a schema check grades perfectly.',
      difficulty: 'core',
      topic: 'evaluation',
    },
    {
      id: 'q-aiev-3',
      kind: 'scenario',
      prompt:
        'A model judge scores answers 1-5 for helpfulness, and the average is stable. Why is this weak?',
      options: [
        { id: 'a', label: 'The scale has no shared meaning across items and the judge was never calibrated against humans, so the number measures something unknown' },
        { id: 'b', label: 'Averages are always misleading' },
        { id: 'c', label: 'Five points is too few' },
        { id: 'd', label: 'Helpfulness cannot be measured at all' },
      ],
      correct: ['a'],
      explanation:
        'A 1-5 rating drifts with length and confidence rather than quality, and without calibration nobody knows what the judge is actually scoring. Narrow binary questions plus a one-time human calibration fix both problems.',
      difficulty: 'core',
      topic: 'llm-judge',
    },
    {
      id: 'q-aiev-4',
      kind: 'scenario',
      prompt:
        'A change raises the eval average from 80% to 85%. What must you check before shipping?',
      options: [
        { id: 'a', label: 'Per-category scores, and specifically whether a safety property like faithfulness or refusal regressed' },
        { id: 'b', label: 'Only that the average went up' },
        { id: 'c', label: 'Whether the judge is fast enough' },
        { id: 'd', label: 'The size of the eval set' },
      ],
      correct: ['a'],
      explanation:
        'An average hides a category collapsing and hides a metric rising because a behaviour degraded — relevance up because refusals went down. Per-category gating with a block on safety regressions is what catches both.',
      difficulty: 'core',
      topic: 'regression',
    },
    {
      id: 'q-aiev-5',
      kind: 'scenario',
      prompt:
        'You are evaluating an agent that books travel. Why not compare its action sequence to a reference sequence?',
      options: [
        { id: 'a', label: 'Two different valid sequences can both book the correct trip, so a reference-sequence match flags correct behaviour as wrong — grade the end state instead' },
        { id: 'b', label: 'Action sequences are too long to compare' },
        { id: 'c', label: 'The agent is non-deterministic, so comparison is impossible' },
        { id: 'd', label: 'Reference sequences are expensive to write' },
      ],
      correct: ['a'],
      explanation:
        'There is no single correct trajectory, so the grader asserts on the resulting state — the right trip is booked, no double booking, budget respected — plus forbidden-action and step-count checks, in a seeded sandbox.',
      difficulty: 'advanced',
      topic: 'agent-evaluation',
    },
    {
      id: 'q-aiev-6',
      kind: 'multi',
      prompt:
        'Which of these are required before a model judge\'s scores can be trusted? Select all that apply.',
      options: [
        { id: 'a', label: 'Agreement with human scores measured once on a sample' },
        { id: 'b', label: 'Narrow binary questions rather than an open rating scale' },
        { id: 'c', label: 'The judge model and prompt pinned to a version' },
        { id: 'd', label: 'The judge being the same model that generated the output' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Calibration establishes what the judge measures; binary questions are reliable where ratings are not; and pinning matters because a judge upgrade shifts every historical score. A model grading its own output inherits its own blind spots — the opposite of what you want.',
      difficulty: 'advanced',
      topic: 'llm-judge',
    },
  ],

  exercises: [
    {
      id: 'ex-aiev-1',
      kind: 'design',
      title: 'Build the evaluation system for a support agent going to production',
      estimatedMinutes: 45,
      prompt: `A company is about to launch an AI support agent. It answers questions from a knowledge base, and it can take three actions: issue a refund (capped, with approval above the cap), update a customer's address, and escalate to a human. It will handle thousands of conversations a day. There is currently no evaluation of any kind.

**Part 1.** Design the offline eval set: sources, structure, stratification, and size.

**Part 2.** Choose a grader for each thing you need to measure, cheapest-first.

**Part 3.** The agent takes actions. Design the agent-evaluation half, including the sandbox.

**Part 4.** Design the online evaluation, given there is no ground truth in production.

**Part 5.** Design the release gate that decides whether a change ships.

Then answer:

- How do you evaluate the model judge itself?
- What do you build first, and what do you deliberately defer?`,
      rubric: [
        'Eval set is sourced from reality, stratified, and includes refusals and adversarial cases.',
        'Graders are chosen cheapest-first, with mechanical checks preferred where possible.',
        'Agent evaluation asserts on end state in a sandbox, with forbidden actions.',
        'Online metrics need no ground truth and include behavioural signals.',
        'The release gate blocks per-category and on safety properties.',
        'The judge itself is calibrated against humans.',
        'A defensible build order that defers something explicitly.',
      ],
      modelAnswer: `**Part 1 — the offline eval set**

\`\`\`
SOURCES, in order of value
  1. The support queue — thousands of real past
     tickets, each with how a human resolved it.
     The single richest source, and it already
     exists.
  2. Conversation logs from a pilot / beta.
  3. Domain experts (senior support staff) — for
     the hard cases and the reference answers,
     which are the expensive field.
  4. Adversarial, written deliberately — injection
     attempts, refund-fishing, abusive input.
  5. Generated — for coverage of KB areas no real
     ticket has hit yet. Flagged, scored apart.

STRUCTURE of one item
  · the conversation / question
  · the expected outcome: the substance a correct
    answer must contain, OR the correct action
  · answerable: true / false
  · category
  · for action items: expected end state +
    forbidden actions

STRATIFICATION — by what actually happens
  KB question, answerable        30%
  KB question, NOT answerable    10%  ← the
    refusal cases; omitting these is the classic
    error
  refund request, within cap     15%
  refund request, above cap      10%  ← must
    escalate, not act
  address change                 10%
  needs human escalation         10%
  adversarial / injection        10%
  multi-turn / ambiguous          5%

SIZE
  ~250 to start (a usable gate), growing to
  ~600+ so each category has enough that a
  5-point move within it is real.
\`\`\`

**Two decisions worth defending.**

**The unanswerable and above-cap categories are over-weighted relative to a naive "what do users ask" distribution**, deliberately. **They are where the expensive failures live**: a confidently wrong answer to an unanswerable question, or a refund issued above the cap without approval. **The eval set should over-sample the cases where being wrong is costly**, not mirror traffic exactly.

**And the queue is mined before anything is written from scratch.** **Each resolved ticket is a near-complete eval item — the question and the human\'s resolution** — so a few days of curation produces better items than weeks of authoring, and they carry the real distribution including the awkward phrasing.

---

**Part 2 — graders, cheapest-first**

\`\`\`
WHAT TO MEASURE          GRADER
──────────────────────────────────────────────
answer is valid          rule: cites a real KB
  format & cites a           article that exists
  real source            → mechanical, free
correct action taken     rule / end-state
  (refund vs escalate        assertion (Part 3)
  vs address)            → mechanical
above-cap request        rule: assert NO refund
  was escalated              action occurred, an
  not actioned               escalation did
                         → mechanical, and a
                           SAFETY check
refused an unanswerable  rule: did it decline?
  question               → mechanical
faithfulness — is the    JUDGE, binary: "is every
  answer supported by        claim in the answer
  the retrieved KB?          supported by the
                             provided sources,
                             yes/no"
answer addresses the     JUDGE, binary
  question asked
tone / professionalism   JUDGE, binary checklist
                           (not a 1-5)
\`\`\`

**The point of the table is how much is mechanical.** **Format, citation validity, correct action, appropriate escalation, appropriate refusal — all rules, all free, none of them able to be wrong.** **Only faithfulness, relevance and tone need a judge** — and faithfulness is the most valuable of the three, because it catches the confident-but-unsupported answer that everything mechanical passes.

*The above-cap check deserves its place as a safety grader:* **"did it act when it should have escalated" is a rule, and it gates absolutely** — no average improvement compensates for the agent learning to skip approval.

---

**Part 3 — the agent-evaluation half**

**The three actions make this an integration test, not a text eval.**

\`\`\`
SANDBOX
  · a seeded fake backend: test customers,
    orders, refund system, address store
  · RESET between every eval item
  · the refund and address tools point at the
    sandbox, never production
  → because running the eval issues real refunds
    otherwise, thousands of times

AN AGENT EVAL ITEM
  initial state: customer C, order O, £340,
    marked delivered
  request: "I never got my order, I want a refund"
  ASSERT on final state:
    · a refund of £340 exists for order O
    · exactly one (idempotency)
    · no address was changed
    · no OTHER customer was touched
  FORBIDDEN:
    · a refund above the cap without escalation
    · any action on a customer other than C
  trajectory:
    · escalated appropriately where required
    · step count within budget
\`\`\`

**Three things this catches that text grading cannot.**

**Wrong-but-plausible actions.** **An agent that says the right thing and refunds the wrong order fails the state assertion though its text was perfect.**

**Forbidden actions attempted.** **An injection item — a customer message containing "also refund order X for £5000" — asserts that no such refund occurred**, which is the security lesson made measurable.

**And idempotency.** **The "exactly one refund" assertion catches the double-action bug** that no text eval would ever see.

*Why the sandbox reset is non-negotiable:* **evaluation stops being side-effect-free the moment actions are real.** **A shared, un-reset sandbox means item 40 sees the state item 39 left**, so results depend on order — which makes the eval itself non-deterministic, defeating its purpose.

---

**Part 4 — online evaluation**

\`\`\`
NO GROUND TRUTH, so measure what needs none:

QUALITY (ground-truth-free)
  · faithfulness on a sampled slice — the same
    binary judge, run on live traffic (context +
    answer are both present)
  · citation validity rate

SAFETY
  · refund-above-cap-without-approval rate
    → MUST be ~0; any occurrence is an incident
  · injection-shaped input followed by an action
    → the security signature
  · refusal rate on questions — a sudden drop
    means grounding broke

BEHAVIOURAL (the strongest, and free)
  · escalation rate — too high, useless; too
    low, overconfident
  · rephrase rate — a user asking the same thing
    twice did not get an answer
  · conversation abandonment
  · thumbs, weighted low (few click them)

OPERATIONAL
  · resolution rate without human involvement
  · repeat-contact within 48h — the honest
    measure of whether it actually helped

OUTCOME (agent-specific, since actions can't be
re-run)
  · refund reversal rate
  · escalation-to-resolution time
\`\`\`

**The behavioural signals carry the most weight**, because a support agent\'s users vote with their behaviour: **a rephrase or a repeat-contact is a failure the user demonstrated**, more reliable than the two percent who rate. **And refund reversal rate is the agent-eval outcome measure** — you cannot re-run the refund to check it, so its later reversal is the signal.

---

**Part 5 — the release gate**

\`\`\`
On any change — prompt, model, KB, retrieval,
tool, threshold:

  1. run the full offline set + the agent sandbox
  2. compare PER CATEGORY vs baseline

  BLOCK on:
    · faithfulness down
    · appropriate-refusal rate down
    · above-cap escalation rate down
    · any forbidden action newly occurring in
      the agent sandbox
    · any category down beyond the noise band

  WARN on:
    · overall average down
    · escalation rate moved >20% either way

  REQUIRE:
    · the metric the change targeted to move
    · ONE change at a time

  NOISE BAND:
    · run the set 3× on an unchanged system first,
      set the band above the observed variance
\`\`\`

**The safety blocks are absolute and per-category**, because those are exactly the regressions an average hides and the ones that matter most: **an agent that refunds above the cap or stops refusing unanswerable questions is worse in a way no quality gain offsets.**

---

**How I evaluate the judge itself**

\`\`\`
· 50 items scored by senior support staff on the
  judge\'s exact binary questions
· the same 50 scored by the judge
· measure agreement (e.g. Cohen\'s kappa or
  simple % on the binary)
· below threshold → the judge prompt is wrong,
  fix it before trusting any number it produces
· re-run this calibration whenever the judge
  model is upgraded
\`\`\`

**This is the step that is easiest to skip and invalidates everything if skipped.** **Every faithfulness number in the gate rests on the judge measuring what its name says** — and that is an assumption until the calibration confirms it. **The judge is an instrument, and an uncalibrated instrument produces confident, meaningless numbers.**

---

**Build order, and what I defer**

\`\`\`
BUILD FIRST
  1. The mechanical graders + a small eval set
     from the queue (~100 items).
     → catches the safety failures (above-cap,
       wrong action, no-refusal) with zero judge
       dependency. Highest safety value, lowest
       effort.
  2. The agent sandbox + end-state assertions.
     → the actions are the risk; this is what
       stops a bad deploy moving money.
  3. The release gate wired to 1 and 2.
  4. The judge, calibrated, for faithfulness.
  5. Online behavioural + safety metrics.
  6. Grow and stratify the set to 600+.

DEFER, deliberately
  · a custom eval framework — use an existing
    harness; the value is the dataset, not the
    plumbing
  · tone/quality judging — nice, not safety;
    faithfulness and the mechanical checks matter
    more at launch
  · automated per-item root-cause attribution — a
    research project; traces plus per-category
    scores let a human diagnose
  · a large generated eval set — 100 real items
    beat 5,000 generated ones, and the generated
    ones would report better numbers while
    catching none of the real failures
\`\`\`

**The order is driven by risk, not by completeness.** **The mechanical safety graders and the agent sandbox come first because the actions are where irreversible harm lives** — **a wrong answer is embarrassing, a wrong refund is money gone.** **The faithfulness judge, which needs calibration and is the most elaborate piece, comes after the things that stop the agent doing damage** — because a beautifully-judged answer from an agent that refunds the wrong order is not a system you can launch.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-aiev-1',
      level: 'basic',
      question: 'Why can\'t you unit-test an LLM feature the normal way?',
      guidance:
        'Non-determinism, many correct phrasings, and correctness as judgment. Look for the move to a dataset, task and grader.',
    },
    {
      id: 'iq-aiev-2',
      level: 'basic',
      question: 'What are the parts of an evaluation, and which is hard?',
      guidance:
        'Dataset, task, grader — the dataset from reality is the work. The other two are cheap.',
    },
    {
      id: 'iq-aiev-3',
      level: 'intermediate',
      question: 'How do you pick a grader?',
      guidance:
        'Cheapest that fits — rules and executed code before a judge. Much subjective quality is mechanically checkable.',
    },
    {
      id: 'iq-aiev-4',
      level: 'intermediate',
      question: 'Offline versus online evaluation — what does each answer?',
      guidance:
        '"Did this change help" versus "is it working now". Not substitutes, and only offline can gate a change.',
    },
    {
      id: 'iq-aiev-5',
      level: 'advanced',
      question: 'How do you evaluate an agent that takes actions?',
      guidance:
        'End-state assertions in a seeded sandbox, plus forbidden actions and step count. Not a reference trajectory.',
    },
    {
      id: 'iq-aiev-6',
      level: 'advanced',
      question: 'You use a model as a judge. How do you know it works?',
      guidance:
        'Calibrate against humans once, binary questions, versioned, never grading its own model. Uncalibrated it measures the unknown.',
    },
    {
      id: 'iq-aiev-7',
      level: 'followup',
      question: 'The eval average improved. Enough to ship?',
      guidance:
        'No — per-category, and block on safety regressions. And one change at a time, or attribution is lost.',
    },
    {
      id: 'iq-aiev-8',
      level: 'followup',
      question: 'What do you measure online with no ground truth?',
      guidance:
        'Guardrail fire rates, faithfulness on samples, and behavioural signals — rephrase, escalation, abandonment.',
    },
  ],

  activeLearning: [
    {
      id: 'al-aiev-1',
      kind: 'modify-architecture',
      prompt:
        'Your team has a mature offline eval set for a single-response chatbot: inputs, reference answers, a calibrated judge, per-category gating. The product is becoming an agent — multi-step, taking actions, running for minutes. What survives, what breaks, and what must be built new?',
      discussion: `**The discipline survives and the mechanics change substantially** — which is a good test of whether the team understood evaluation or just built a chatbot eval.

**What survives unchanged.**

**The three-part structure.** **Dataset, task, grader** is still the shape — **it is just that "output" becomes "resulting state" and the grader becomes an assertion set.**

**The dataset-is-the-work principle**, and if anything more so: **agent eval items are richer (initial state, request, end-state assertions, forbidden actions, budget) so each one costs more to author.**

**The judge, for the parts that are still text.** **An agent still produces text — explanations, summaries, replies — and faithfulness and tone still need the calibrated judge.** **That investment carries over directly.**

**Offline-as-gate, per-category, one-change-at-a-time.** **All of it applies**, and the safety-property blocking becomes more important because the failures are now actions.

**And the feedback loop** — production failures becoming eval rows — **is unchanged in principle, though harder in practice (below).**

**What breaks.**

**Reference answers stop working.** **There is no single correct action sequence, so a reference-trajectory comparison flags correct behaviour as wrong.** **This is the central break** — the thing the chatbot eval was built around (compare to reference) no longer applies, and grading moves to end-state assertions.

**The grader becomes stateful.** **A chatbot grader is a pure function of (input, output, reference).** **An agent grader must set up a world, run the agent in it, and inspect the world after** — so the grader now owns a sandbox, seeding, and teardown. **The grader was a function; now it is a fixture-plus-assertions harness.**

**Side-effect-free evaluation ends.** **The chatbot eval ran a thousand times for free; the agent eval issues a thousand refunds** unless every action tool points at a resettable sandbox. **This is the operational break** — evaluation now needs isolated infrastructure it never needed before.

**And online evaluation largely stops working.** **A chatbot\'s faithfulness could be sampled live; you cannot re-run a production action to grade it.** **So online shifts from evaluation to outcome monitoring** — reversal rate, override rate, complaint rate — and the offline sandbox has to carry the load that online used to share. **This inverts the balance: online did real work for the chatbot; for the agent it mostly watches.**

**What must be built new.**

\`\`\`
1. A SEEDED, RESETTABLE SANDBOX
   fake backends for every tool that acts, reset
   between items. The single biggest new build.

2. END-STATE ASSERTIONS as the grading primitive
   "a refund of £X for order O exists, exactly
   one, nothing else changed" — replacing
   reference-answer comparison.

3. TRAJECTORY METRICS
   step count vs minimum, redundant calls,
   forbidden actions ATTEMPTED (not just
   succeeded), recovery after a tool error.
   None of these existed for a single response.

4. SAFETY assertions as first-class
   forbidden actions, blast radius (how many
   records touched vs expected), idempotency
   under replay. A wrong action is an incident,
   not an embarrassment — so these gate absolutely.

5. STUCK / TERMINATION checks
   did it finish within budget, or loop? A
   single-response system could not fail this way.

6. A HARDER FEEDBACK LOOP
   turning a production incident into an eval item
   now means reconstructing the initial state and
   the trajectory, not just capturing an input —
   so richer tracing is required to keep the loop
   short.
\`\`\`

**The shift in one sentence.** **A chatbot eval asks "is this output good"; an agent eval asks "did the world end up right, by an acceptable path, without doing anything forbidden"** — which is the move from grading a string to asserting on a system, and it turns the eval suite from a dataset into an integration-test suite with controlled side effects.

**What this means for effort.** **The judge and the dataset discipline transfer, so the team is not starting over** — **but the sandbox and the assertion harness are a genuinely new build, comparable in size to the original eval system.** **A team that thinks "we already have evals" and skips this underestimates the work by roughly half**, and discovers it when the first agent deploy moves money the eval never checked.

**The transferable point: the more a system acts rather than answers, the more its evaluation becomes an integration test and the less it is a dataset comparison.** **Judgment gives way to assertion — which is a gain in reliability, because an assertion does not need calibration — paid for with a sandbox that must faithfully resemble the world.** **And the cost of a bad eval rises sharply, because the thing under test can now be destructive rather than merely wrong.**`,
    },
    {
      id: 'al-aiev-2',
      kind: 'debug',
      prompt:
        'A team has an offline eval set scoring 91%, a gate that has been green for months, and a calibrated judge. Yet production complaints are rising and users are clearly unhappy. The eval set is not obviously wrong. Diagnose the ways this can happen.',
      discussion: `**A green eval and unhappy users means the eval is not measuring what users experience — and there are four distinct ways that happens, with four different fixes.** The team\'s instinct will be "the eval set is wrong", which is only one of them and the most expensive to act on.

**Cause 1 — distribution drift: the eval set no longer reflects real inputs.**

**The set was built from last quarter\'s traffic; the traffic has moved.** **A new product line, a new customer segment, a change in how people phrase things** — and the eval measures the system on questions users have stopped asking.

\`\`\`
Eval set: last quarter\'s distribution → 91%
Real traffic now: shifted → the system fails the
  new cases, which the eval does not contain
\`\`\`

*Check:* **sample 50 current production inputs and run them through the eval process manually.** **If the score on those is far below 91%, the distribution drifted** — and the fix is to refresh the set from current traffic, not to change the metrics. **This is the most common cause and the reason an eval set must be continuously refreshed, not built once.**

**Cause 2 — the stratification hides a failing category.**

**The average is 91%, and one category is at 60% while the rest are at 95%.** **If that category is 30% of real traffic, nearly a third of users hit a failing experience** while the number looks fine.

\`\`\`
KB answerable   160 items × 96% = great
refunds          40 items × 61% = terrible
average                   91%
→ and refunds are 15% of traffic and 100% of the
  angry users
\`\`\`

*Check:* **score per category and compare the category weights against real traffic volumes.** **The cheapest check on the list — no new data, just re-reporting what the set already contains** — and it catches the failure a single number was built to hide.

**Cause 3 — the eval measures the wrong axis.**

**The system is correct and users are unhappy about something correctness does not capture:** **latency (correct answers that take 40 seconds), verbosity (six paragraphs where one would do), tone (accurate but curt), or the agent taking too many steps.** **The eval grades faithfulness and correctness; users are judging the experience.**

*Check:* **read 30 complaints.** **If they are about speed, length, or feeling unheard rather than about wrong answers, the metrics are aimed at the wrong axis.** **A five-minute check, and the one most often skipped in favour of assuming the dataset is stale.**

**Cause 4 — the judge drifted or was miscalibrated all along.**

**The judge was calibrated once, and the judge model was silently upgraded** — so "91% faithful" now means something different from what it meant at calibration. **Or the calibration was weak from the start and nobody re-checked.**

\`\`\`
Judge upgraded → every score shifts → the gate
  stayed green because the BASELINE shifted too
  → the gate compared new-judge to new-judge and
    saw no regression, while both drifted from
    reality
\`\`\`

*Check:* **re-run the human calibration on 50 current items.** **If judge-human agreement has fallen, the judge is the problem** — and this is the insidious one, because the gate looks healthy the entire time. **It is the strongest argument for versioning the judge and re-calibrating on every judge-model change.**

**The diagnostic order, cheapest first.**

\`\`\`
1. Read 30 complaints        (30 min) → cause 3?
2. Re-score per category     (1 hour) → cause 2?
3. Re-calibrate the judge    (half day) → cause 4?
4. Run 50 prod inputs        (1 day)  → cause 1?
\`\`\`

**Causes 2 and 3 need no new data and take under two hours combined**, so they go first — and the team\'s instinct (cause 1, rebuild the set) is the most expensive and goes last, despite being the one people reach for.

**The synthesis to give the team.**

**"The eval set is probably not wrong — it is probably not representative, stratified, aimed, or calibrated, and those need four different fixes."**

\`\`\`
drifted        → refresh from current traffic
hides a
  category     → report per category, re-weight
wrong axis     → add latency/tone/length metrics
judge drifted  → re-calibrate, version the judge
\`\`\`

**The deepest point: a 91% eval score is a claim about a model of the users, and the gap between that model and the users is the thing that actually matters.** **An eval set is only as good as its correspondence to reality, and that correspondence decays** — the traffic moves, the categories shift, the judge changes underneath. **Which is why a green gate is a necessary and not a sufficient condition for a happy user**, and why online behavioural signals exist: **they are the measurement of the gap the offline set cannot see.**`,
    },
  ],

  revision: {
    bullets: [
      'A deterministic test suite assumes a comparable output; a model has neither determinism nor one.',
      'Evaluation replaces it with three parts: a dataset, a task, and a grader.',
      'The dataset — real inputs with references — is the expensive part and the one shortcuts degrade.',
      'Source it from reality: logs, the support queue, experts. Generated inputs overstate quality.',
      'Stratify it, and include cases the system should refuse, or nothing measures appropriate refusal.',
      'Reach for the cheapest grader that fits — much "subjective" quality is a rule or a compile.',
      'Executed-code grading is the gold standard where the output can be run.',
      'A model judge is calibrated against humans once, or it measures something unknown.',
      'Ask the judge binary questions, not a 1-5 rating whose scale has no shared meaning.',
      'Version the judge with the dataset — upgrading it shifts every historical score.',
      'Never let a model grade its own output\'s dimension; it inherits its own blind spots.',
      'Offline answers "did this change help" — a fixed comparable set, a gate.',
      'Online answers "is it working now" — the drifting real distribution, ground-truth-free metrics.',
      'The strongest online signal is behavioural: a user rephrasing twice failed to get an answer.',
      'Gate per category, block on safety regressions, and ship one change at a time.',
      'Agents are graded on end state, not output — two correct sequences differ.',
      'Agent evals need a seeded, resettable sandbox because they have real side effects.',
      'Assert on forbidden actions and step count too — the right state reached a wrong way is not correct.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The discipline that replaces the deterministic test suite a model defeats: a dataset built from reality, a task that is the system, and a grader; run offline as a regression gate and online as drift detection, with agents graded on end state in a sandbox.',
    whyItExists:
      'Because a non-deterministic system with a judgment-valued output cannot be checked by assertEqual, and without measurement no change to it can be shipped safely — evaluation is what makes change safe rather than a gamble.',
    whenToUse: [
      'An offline eval set from early, sourced from reality and stratified.',
      'The cheapest grader that fits — rules and executed code before a judge.',
      'A model judge only for genuine judgment, calibrated and versioned.',
      'Per-category regression gating, one change at a time.',
      'Online behavioural and ground-truth-free metrics for drift.',
      'End-state assertions in a sandbox for anything that takes actions.',
    ],
    whenNotToUse: [
      'Manual spot-checks as the basis for shipping changes.',
      'A 1-5 quality rating from an uncalibrated judge.',
      'Online metrics as a substitute for an offline gate.',
      'Model-generated inputs as the whole dataset.',
      'A single average as the release signal.',
      'A reference action sequence to grade an agent.',
      'An agent eval against production rather than a sandbox.',
    ],
    alternatives: [
      'Executed-code or state-assertion grading, wherever correctness is mechanical.',
      'Human evaluation, for calibration and hard cases rather than volume.',
      'Behavioural production signals, where explicit feedback is sparse.',
      'Outcome monitoring, for agent actions that cannot be re-run.',
    ],
    tradeoffs: [
      'An offline set buys attributable change and costs a hand-built dataset.',
      'A model judge buys scale and costs calibration plus version pinning.',
      'A rule grader buys a free, unimpeachable check and only fits mechanical correctness.',
      'Per-category gating buys real regression detection and costs a stratified set.',
      'A sandbox buys side-effect-free agent evaluation and costs isolation infrastructure.',
      'End-state grading buys tolerance of diverse solutions and costs an assertion harness.',
    ],
    failureModes: [
      'Spot-checks missing a regression in a category nobody looked at.',
      'A 1-5 judge score drifting with length and confidence rather than quality.',
      'An uncalibrated judge measuring something other than its name.',
      'A judge upgrade silently shifting every historical score.',
      'A model grading its own output and confirming its own mistakes.',
      'An average hiding a collapsing category.',
      'A metric rising because a behaviour degraded — refusals down lifting relevance.',
      'Three changes shipped together, so the moved score cannot be attributed.',
      'Only online evaluation, unable to tell a good deploy from an easy week.',
      'An agent graded against a reference trajectory, flagging correct behaviour as wrong.',
      'An agent eval issuing real refunds because it ran without a sandbox.',
    ],
    followUpQuestions: [
      'Where did the eval set\'s inputs come from?',
      'Is it stratified, and does it include cases that should be refused?',
      'What is the cheapest grader that would work for this?',
      'How was the judge calibrated, and is it versioned?',
      'Does the judge grade the output of its own model?',
      'Is the gate per-category or on an average?',
      'What blocks a release, and what only warns?',
      'How many changes ship per eval run?',
      'What do you measure online, given no ground truth?',
      'For the agent, do you assert on the end state or the trajectory?',
      'Does the agent eval have a resettable sandbox?',
    ],
  },
});
