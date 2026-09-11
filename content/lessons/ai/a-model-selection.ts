import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-model-selection',
  title: 'Model selection and the cost/latency/quality triangle',
  summary:
    'A single model is one point on the triangle; a system can sit somewhere else by routing. The arithmetic of when a cascade pays is one line — and it turns on having a cheap, reliable way to know the cheap answer was good.',
  phase: 'ai',
  module: 'llm-apps',
  position: 71,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['routing', 'cascades', 'caching', 'evaluation', 'cost'],
  prerequisites: ['a-llm-app-architecture'],
  resources: [
    {
      key: 'anthropic-building-effective-agents',
      tier: 'must',
      note: 'Read the routing section and the general argument for using the simplest thing that works. It is the clearest published statement that a system of small components often beats one large call, which is the whole premise here.',
    },
    {
      key: 'anthropic-prompt-caching',
      tier: 'must',
      note: 'Read it alongside model choice, because caching and model selection are alternative levers on the same number. A cached request on a strong model can cost less than an uncached one on a weak model, which changes the comparison.',
    },
    {
      key: 'promptfoo-docs',
      tier: 'good',
      note: 'Read it for comparing models on your own cases rather than on public benchmarks. The decision in this lesson cannot be made from a leaderboard, and this is the shape of the tooling that makes it measurable.',
    },
    {
      key: 'chain-of-thought-paper',
      tier: 'good',
      note: 'Read it as a cost mechanism as much as a quality one. Reasoning improves answers by producing more output tokens, and output tokens are the most expensive and slowest thing in the request — so quality bought this way has a visible price.',
    },
    {
      key: 'swe-bench-paper',
      tier: 'advanced',
      note: 'Read it for what a benchmark measures and what it does not. A model that scores well on curated tasks may do worse on your traffic, which is the argument for building an evaluation set from your own requests.',
    },
  ],

  intuition: {
    body: `The triangle is usually drawn as a choice: **cheap, fast, good — pick two.** That is true of a single model and false of a system.

\`\`\`
One model     = one point on the triangle
A system      = a weighted average of several points
\`\`\`

**And the weights are yours to choose**, which is what routing is: **send each request to the smallest model that can handle it.**

The reason this works is a property of real traffic rather than a clever trick: **the difficulty distribution is skewed.** Most requests in most products are easy — a greeting, a status lookup, a reformat — **and a minority are hard.** Paying the strong model's price for the easy majority is the default, and it is the thing to fix.

Then the arithmetic, which is one line and worth memorising.

\`\`\`
Cascade: try the cheap model; if it fails, retry on the
         expensive one — so a failure pays BOTH.

blended cost = c_cheap + (1 − p) × c_expensive
where p = the cheap model's success rate

This beats c_expensive when:   c_cheap < p × c_expensive
                       i.e.:   p > c_cheap / c_expensive
\`\`\`

**A cascade wins when the cheap model succeeds more often than the cost ratio.** With a model a tenth of the price, **you need it to work more than 10% of the time** — which is a low bar, and it explains why cascades are usually worth trying.

**But the formula hides the thing that actually decides it: you must know whether the cheap answer was good.**

\`\`\`
Deterministic check    does the code compile? does the SQL
                       parse and return rows? does the JSON
                       match the schema?
                       → cheap, reliable, and the cascade works
A judge model          costs money and is itself fallible
                       → the saving shrinks and the ceiling drops
Self-reported
  confidence           poorly correlated with correctness
                       → the cascade escalates the wrong cases
\`\`\`

**So cascades work brilliantly for tasks with a deterministic verifier and poorly for open-ended prose** — which is a sharper rule than "use a cheaper model where you can".

**And the last thing: none of this can be decided from a benchmark.** Public scores are measured on curated tasks; **your traffic is not that distribution**, so the decision needs an evaluation set built from your own requests.`,
    analogyLimit:
      '"Pick the best model you can afford" treats selection as a one-time procurement decision, which makes the cost fixed and the quality a constant. Both are variables you control per request: the same product can route trivial requests to a small model and hard ones to a large one, and the blended position is nowhere on any single model\'s curve. The framing also hides that quality bought through longer reasoning is paid for in output tokens — the most expensive and slowest part of a request.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team ships an assistant on the strongest available model because "quality matters most". Costs are four times the forecast. They propose switching everything to a model a tenth of the price, and in testing on twenty hand-written examples it looks "about as good". Identify four problems with both the original decision and the proposed fix.',
      answer: `**Problem 1 — one model for all traffic ignores the difficulty distribution, which is where the money is.**

\`\`\`
Typical support traffic:
  ~60%  trivial — greetings, status, simple lookups
  ~30%  moderate — a policy question with retrieved context
  ~10%  hard — multi-step reasoning, ambiguity, escalation
\`\`\`

**The strong model is being paid for on 90% of requests that do not need it**, and that is the actual finding: **not that the model is too expensive, but that it is applied uniformly.**

**Problem 2 — switching everything to the cheap model trades the tail for the mean.**

**The 10% of hard requests are the ones that matter most** — they are where the product either works or visibly fails — **so degrading them to save money on the easy 90% optimises the wrong thing.** And the failures will be concentrated in exactly the cases users escalate about.

*The alternative is routing rather than replacing:* **cheap for the easy majority, strong for the hard minority**, with an explicit decision about which is which.

**Problem 3 — twenty hand-written examples cannot support either decision.**

\`\`\`
20 examples, and the interesting cases are ~10% of traffic
→ perhaps 2 hard cases in the set
→ a model that fails half of them scores 95% overall
→ "about as good" is compatible with a 50% regression on
   the cases that matter
\`\`\`

**And hand-written examples are not the traffic distribution.** They are what someone imagined, **which systematically over-represents the clear cases** — because clear cases are easier to write down.

*What is needed:* **a set sampled from real requests, stratified by difficulty**, with the hard stratum deliberately over-sampled so a regression there is visible.

**Problem 4 — no measurement of what the cost is actually composed of.**

**"Four times the forecast" has several possible causes**, and the model is only one of them:

\`\`\`
· the prefix cache is not being hit
· conversations are longer than forecast (quadratic)
· retrieval returns more context than planned
· reasoning output is longer than expected
\`\`\`

**Changing the model is the most disruptive available response to a cost problem whose cause has not been identified** — and if the cause is an uncached prompt, the cheaper model will be four times over its own forecast too.

**What a considered answer looks like.**

\`\`\`
1. Break the cost down per component before changing anything
2. Build an eval set from real traffic, stratified by difficulty
3. Measure each candidate model on it, per stratum
4. Route: cheap where quality holds, strong where it does not
5. Consider a cascade where a deterministic verifier exists
6. Re-measure the blended cost and the per-stratum quality
\`\`\`

**The transferable diagnostic: a uniform model choice is a bet that all your requests are equally hard.** They are not, and the distribution is measurable — **so the first question is not "which model" but "what does my difficulty distribution look like".**`,
    },
  body: `## The three quantities, and what actually moves them

\`\`\`
COST      input tokens × input price + output tokens × output price
          levers: model, caching, context size, output length
LATENCY   ≈ prefill(input) + output_tokens × per_token_time
          levers: model (per-token speed), output length, streaming
QUALITY   task-specific, and only measurable on your own cases
          levers: model, context, prompt, verification
\`\`\`

**Two observations that reorganise the problem.**

**Output length moves all three at once.** A longer answer costs more, takes longer and — up to a point — is often better. **So "think step by step" is a purchase**, and its price is visible in the token count.

**And model choice is not the only lever on any of them.** A cached request on a strong model can cost less than an uncached one on a weak model; **a strong model producing 100 tokens can be faster than a weak one producing 800.** Comparing models without holding the rest constant produces answers that do not survive contact with production.

## Routing: the same product at several points

\`\`\`
request → classify → { small model | large model | tool | template }
\`\`\`

**Three ways to classify, in increasing cost and accuracy.**

**Heuristics.** Message length, presence of a tool-triggering keyword, whether retrieval returned anything, the user's tier, the conversation turn number. **Free, and surprisingly effective** — a large share of traffic in most products is identifiable as trivial without a model.

**A small classifier model.** One cheap call producing a label. **Costs perhaps 1% of the expensive call**, which is affordable if it routes even a modest fraction away from it.

**And no classification at all — a cascade**, which is the next section: **attempt cheaply and escalate on failure**, letting the outcome do the classifying.

**The rule that keeps routing honest: the classification must cost much less than the saving.**

\`\`\`
If classification costs 20% of the expensive call and routes
40% of traffic to a model costing 10%:
  blended = 0.20 + 0.40×0.10 + 0.60×1.00 = 0.84
  → a 16% saving for a whole extra component
\`\`\`

**Worth checking before building it**, because an expensive router can eat most of what it saves.

*And the failure direction matters:* **a router that misroutes a hard request to the small model produces a bad answer**, while one that misroutes an easy request to the large model produces a slightly expensive good answer. **So the router should be biased toward escalation**, and the bias should be stated.

## Cascades, and the line that decides them

\`\`\`
blended = c_cheap + (1 − p) × c_expensive
wins when  p > c_cheap / c_expensive
\`\`\`

**Worked, with a model a tenth of the price and a 70% success rate:**

\`\`\`
blended = 0.10 + 0.30 × 1.00 = 0.40
→ 60% cheaper than always using the expensive model
Break-even: p > 0.10, so anything above a 10% success rate saves
\`\`\`

**Three things this formula hides, and each can invalidate it.**

**Verification cost.** The formula assumes checking is free. **If a judge model costs 0.15, the blended cost becomes 0.55** — still a saving, and a much smaller one. **Add the verifier's cost explicitly or the analysis is optimistic.**

**Verification accuracy.** If the check wrongly passes bad answers, **quality falls invisibly**; if it wrongly fails good ones, **the escalation rate rises and the saving shrinks.** The cascade's quality ceiling is the verifier's accuracy, not the strong model's.

**And latency.** An escalated request pays both models sequentially, **so the p99 gets worse even as the mean improves.** A cascade trades tail latency for cost — **which is acceptable in a batch pipeline and may not be in a chat.**

*Which yields the rule:* **cascade where verification is deterministic and the tail matters less.** Code that must compile, SQL that must parse, JSON that must match a schema, an extraction that must contain a known identifier — **all cheap to check and unambiguous.** Open-ended prose is the opposite case, and cascading it usually means paying for a judge to guess.

## Caching, which competes with model choice

**Two kinds, with very different risk profiles.**

**Exact-match caching.** Identical request, stored response. **Zero quality risk**, and it works only where requests repeat verbatim — which is more common than it sounds for templated or tool-driven flows.

**Semantic caching.** Embed the request and return a stored answer if a previous one is similar enough.

\`\`\`
"What is the refund window?"       → cached answer
"What is the refund window for
 enterprise customers?"            → similar, DIFFERENT answer
→ a threshold too loose returns a confidently wrong response
\`\`\`

**So semantic caching is a quality trade rather than a free saving**, and its threshold is a parameter with a wrong-answer rate attached. **It needs the same evaluation as a model change.**

**And prefix caching, from the previous lesson**, which is neither of these: **it reduces the price of tokens you are sending anyway**, with no quality effect at all. **That is the one to do first**, because it is the only lever here with no trade.

## Quality: measurable only on your own traffic

**Public benchmarks answer a different question than yours.**

\`\`\`
A benchmark:  curated tasks, balanced difficulty, a fixed
              scoring rubric
Your traffic: a skewed difficulty distribution, your domain,
              your context, your prompt
\`\`\`

**A model that ranks higher on a leaderboard can perform worse on your requests** — because your requests are not that distribution, and because your prompt and retrieved context are part of the system being measured. **The benchmark scored the model; you need to score the system.**

**What to build instead:**

\`\`\`
· 100–300 cases sampled from real traffic
· stratified by difficulty, with hard cases OVER-sampled
· a scoring method: deterministic where possible, a rubric
  where not
· run per candidate model, per stratum
\`\`\`

**The stratification is the part that matters.** An aggregate score hides a regression in the 10% of cases that decide whether users trust the product — **which is the same tail argument as elevator wait times and cache hit rates.**

## Reasoning as a purchase

**A model that reasons before answering produces more output tokens**, and output tokens are the most expensive and slowest part of a request.

\`\`\`
Direct answer:      120 output tokens
With reasoning:     800 output tokens
→ ~6.7× the output cost, ~6.7× the decode time
\`\`\`

**So the question is not "does reasoning help" but "does it help enough here".** For a classification it usually does not; **for a multi-step calculation it often does** — and the difference is measurable on the eval set rather than assumable.

*And it interacts with routing:* **reasoning on a cheap model is sometimes better and cheaper than a direct answer from an expensive one** — which is a route worth testing explicitly, because it is not the arrangement anyone reaches for first.

## Making the decision defensible

\`\`\`
1. Fix the free levers first: prefix caching, context size,
   output length. They change nothing about quality.
2. Measure the difficulty distribution of real traffic.
3. Build a stratified eval set from it.
4. Score each candidate per stratum, with cost and latency
   recorded alongside.
5. Choose a routing policy, and state the failure direction.
6. Re-measure blended cost, blended latency (including the
   tail), and per-stratum quality.
\`\`\`

**And the sentence that makes it defensible in an interview:** *"On our own evaluation set, the small model matches on 70% of traffic within a point of the large one, and loses six points on the hard stratum — so I route those to the large model, which blends to 40% of the cost with no measurable loss where it matters."*

**Numbers, per stratum, on your own set.** Anything less is a preference.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'cascade-maths',
      title: 'When a cascade pays, in one line',
      caption:
        'Read the break-even first — the bar is lower than people expect. Then read the three things the formula hides, each of which can turn a saving into a loss.',
      code: `flowchart TB
    F["**blended = c_cheap + (1 − p) × c_expensive**<br/>p = the cheap model's success rate<br/><br/>**Wins when p > c_cheap / c_expensive**"]

    F --> E["**Worked example**<br/>cheap = 0.1 × expensive, p = 0.70<br/>blended = 0.10 + 0.30 = **0.40**<br/>→ 60% cheaper<br/><br/>Break-even at p > 0.10 —<br/>**a very low bar**"]

    E --> H1["**Hidden 1: verification cost**<br/>the formula assumes checking is free.<br/>A judge at 0.15 makes it 0.55 —<br/>still a saving, much smaller.<br/>**Add the verifier explicitly.**"]
    E --> H2["**Hidden 2: verification accuracy**<br/>false passes lower quality invisibly;<br/>false fails raise the escalation rate.<br/>**The cascade's ceiling is the<br/>verifier's accuracy**, not the<br/>strong model's."]
    E --> H3["**Hidden 3: latency**<br/>an escalated request pays both<br/>models sequentially.<br/>**The mean improves and the p99<br/>gets worse** — fine in a batch,<br/>often not in a chat."]

    H1 --> R["**So: cascade where verification is<br/>DETERMINISTIC and the tail matters less.**<br/><br/>Compiles · parses · matches a schema ·<br/>contains a known identifier → yes<br/>Open-ended prose → you are paying a<br/>judge to guess"]
    H2 --> R
    H3 --> R

    style E fill:#17272a,stroke:#35897e
    style R fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'routing',
      title: 'One product, several points on the triangle',
      caption:
        'Step through it. The order matters: the free levers come first, because they change cost without touching quality — and a model change should never be the first response to a cost problem.',
      nodes: [
        { id: 'free', label: '1. Fix the free levers first', kind: 'note', x: 0, y: 150, detail: 'Prefix caching, context size, output length. All reduce cost with no quality effect, and a cost problem whose cause has not been identified may not be a model problem at all — an uncached prompt makes a cheaper model four times over its forecast too.' },
        { id: 'dist', label: '2. Measure the difficulty distribution', kind: 'service', x: 240, y: 150, detail: 'Most traffic in most products is easy. A uniform model choice is a bet that all requests are equally hard, and that bet is measurable rather than assumable — so the first question is not "which model" but "what does my distribution look like".' },
        { id: 'evalset', label: '3. Build a stratified eval set', kind: 'store', x: 480, y: 40, detail: '100–300 cases sampled from real traffic, stratified by difficulty with the hard stratum over-sampled. Hand-written examples systematically over-represent the clear cases, because clear cases are the easy ones to write down.' },
        { id: 'route', label: '4. Route, biased toward escalation', kind: 'service', x: 480, y: 250, detail: 'Heuristics are free and surprisingly effective; a small classifier costs about 1% of the expensive call. And the classification must cost far less than it saves — an expensive router eats most of the saving.' },
        { id: 'cascade', label: 'Or cascade, where a deterministic verifier exists', kind: 'service', x: 740, y: 250, detail: 'Let the outcome do the classifying: attempt cheaply, verify, escalate on failure. Wins when the cheap model succeeds more often than the cost ratio — but the verifier\'s cost and accuracy belong in the arithmetic.' },
        { id: 'measure', label: '5. Re-measure blended cost, tail latency, per-stratum quality', kind: 'note', x: 740, y: 60, detail: 'An aggregate score hides a regression in the 10% of cases that decide whether users trust the product. And the tail latency must be reported, because a cascade improves the mean while making the p99 worse.' },
      ],
      edges: [
        { id: 'r1', source: 'free', target: 'dist', kind: 'control' },
        { id: 'r2', source: 'dist', target: 'evalset', kind: 'control' },
        { id: 'r3', source: 'dist', target: 'route', kind: 'control' },
        { id: 'r4', source: 'route', target: 'cascade', kind: 'control' },
        { id: 'r5', source: 'evalset', target: 'measure', kind: 'control' },
        { id: 'r6', source: 'cascade', target: 'measure', kind: 'control' },
      ],
      steps: [
        {
          id: 'rs1',
          title: 'The levers with no quality trade come first',
          description:
            'Caching, context size, output length. They are free in the sense that matters — and a cost problem may not be a model problem, which changing the model would obscure rather than fix.',
          nodes: ['free'],
          edges: [],
        },
        {
          id: 'rs2',
          title: 'Then measure how hard your traffic actually is',
          description:
            'A single model is a bet that every request is equally difficult. The distribution is skewed in most products, and that skew is the entire opportunity.',
          nodes: ['dist'],
          edges: ['r1'],
        },
        {
          id: 'rs3',
          title: 'Score on your own cases, stratified',
          description:
            'Benchmarks measure the model on curated tasks; you need to measure the system on your distribution. Over-sample the hard stratum, or a regression there is invisible in the aggregate.',
          nodes: ['evalset'],
          edges: ['r2'],
        },
        {
          id: 'rs4',
          title: 'Route explicitly, or let failure route for you',
          description:
            'A classifier where you can predict difficulty; a cascade where you can verify the answer. And bias the router toward escalation, because a misrouted hard request is a bad answer.',
          nodes: ['route', 'cascade'],
          edges: ['r3', 'r4'],
        },
        {
          id: 'rs5',
          title: 'Then re-measure all three, including the tail',
          description:
            'Blended cost, blended latency with its p99, and quality per stratum. The claim to be able to make is a number on your own set, not a preference.',
          nodes: ['measure'],
          edges: ['r5', 'r6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The published guidance on building effective agents makes an argument that applies directly here, and it is stated more plainly than most: **start with the simplest thing that works, and add components only when a measurement says to.**

**Its routing pattern is the one this lesson formalises**: classify an input and direct it to a specialised path, **so that each request is handled by something sized for it.** The material is explicit that this is worth doing when the categories are genuinely distinguishable — **and that a router which cannot classify reliably makes the system worse, not cheaper.**

**And it draws the same line between orchestration and a single call**: more components mean more failure modes, so the saving has to be real. **An expensive router that captures a 16% saving is a component added for very little.**

**Three transferable lessons.**

**Simplest first, and measure before adding.** The order in this lesson — free levers, then distribution, then routing — is that principle applied to cost specifically. **A model change is the most disruptive response available and it is frequently the first one proposed.**

**A router is only as good as its classification.** Misrouting a hard request to a small model produces a confident bad answer, **which is worse than the cost it saved** — so the bias should be toward escalation and should be stated as a design decision.

**And the categories must be real.** If you cannot describe what makes a request hard, **you cannot route on it** — and that inability is itself the finding, because it means the difficulty distribution has not been examined.

**Where the guidance does not help.** It does not give you the break-even arithmetic for a cascade, and it does not tell you that the deciding factor is whether verification is deterministic. **Those are the two things that turn "consider routing" into a decision you can defend with a number**, and both have to come from your own measurements.`,
  },

  tradeoffs: {
    intro:
      'The levers available on cost, latency and quality, and what each one actually trades.',
    rows: [
      {
        option: 'One strong model for all traffic',
        whenItWins:
          'Early, when traffic is small and engineering time is the scarce resource.',
        whenItLoses:
          'It pays the strong model\'s price on the 90% of requests that do not need it.',
        cost:
          'A bill several times larger than necessary, growing with success.',
      },
      {
        option: 'One cheap model for all traffic',
        whenItWins:
          'Tasks that are genuinely uniform and easy.',
        whenItLoses:
          'It degrades exactly the hard minority that decides whether users trust the product.',
        cost:
          'The tail, traded for the mean — usually the wrong direction.',
      },
      {
        option: 'Prefix caching and context trimming',
        whenItWins:
          'Always first. They reduce cost with no quality effect at all.',
        whenItLoses:
          'Nothing, beyond the prompt-ordering constraint.',
        cost:
          'A rule about prompt structure, and a hit-rate metric.',
      },
      {
        option: 'Heuristic routing',
        whenItWins:
          'When a meaningful share of traffic is identifiable as trivial from length, keywords or context.',
        whenItLoses:
          'When difficulty is not predictable from the surface of the request.',
        cost:
          'Rules that drift as the product changes.',
      },
      {
        option: 'A small classifier model as a router',
        whenItWins:
          'When difficulty is predictable but not by simple rules, and the classifier costs a small fraction of the expensive call.',
        whenItLoses:
          'When classification cost approaches the saving — an expensive router eats most of it.',
        cost:
          'An extra call on every request, plus its own failure mode.',
      },
      {
        option: 'A cascade with a deterministic verifier',
        whenItWins:
          'Code, SQL, schema-conforming output, extraction with a known identifier — anything cheaply checkable.',
        whenItLoses:
          'Open-ended prose, where verification means paying a judge to guess.',
        cost:
          'Worse tail latency, since escalated requests pay both models.',
      },
      {
        option: 'A cascade verified by a judge model',
        whenItWins:
          'When no deterministic check exists and the cost gap is large enough to absorb the judge.',
        whenItLoses:
          'The judge costs money and is fallible, so the saving shrinks and the quality ceiling drops to the judge\'s accuracy.',
        cost:
          'A third model whose errors are invisible.',
      },
      {
        option: 'Self-reported confidence as the escalation signal',
        whenItWins:
          'Nowhere reliably.',
        whenItLoses:
          'Confidence correlates poorly with correctness, so the cascade escalates the wrong cases in both directions.',
        cost:
          'A verifier that looks free and does not work.',
      },
      {
        option: 'Exact-match response caching',
        whenItWins:
          'Templated or tool-driven flows where requests repeat verbatim. Zero quality risk.',
        whenItLoses:
          'Free-form conversation, where nothing repeats exactly.',
        cost:
          'Storage, and a staleness policy.',
      },
      {
        option: 'Semantic response caching',
        whenItWins:
          'High-volume repetitive question spaces, when the threshold has been evaluated.',
        whenItLoses:
          'A near-miss returns a confidently wrong answer — "refund window" versus "refund window for enterprise".',
        cost:
          'A wrong-answer rate attached to a threshold parameter.',
      },
      {
        option: 'Reasoning before answering',
        whenItWins:
          'Multi-step problems where the eval set shows it helps.',
        whenItLoses:
          'Classification and extraction, where it multiplies output tokens for nothing.',
        cost:
          'Several times the output cost and decode time.',
      },
      {
        option: 'Choosing a model from public benchmarks',
        whenItWins:
          'As a shortlist of candidates to evaluate.',
        whenItLoses:
          'As the decision — your traffic is a different distribution, and your prompt and context are part of what is being measured.',
        cost:
          'A decision that does not survive contact with production.',
      },
      {
        option: 'A stratified eval set from real traffic',
        whenItWins:
          'Always, as the basis for any of these decisions.',
        whenItLoses:
          'It takes effort to build and must be maintained as traffic shifts.',
        cost:
          '100–300 cases and a scoring method, which is the price of a defensible answer.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We use the strongest model because quality is the priority."',
      whyWeak:
        'It is a bet that every request is equally hard, and in most products the difficulty distribution is heavily skewed — so the strong model is being paid for on the large majority of requests that do not need it. The finding is not that the model is expensive but that it is applied uniformly.',
      strongAnswer:
        '"I would measure the difficulty distribution first, because a uniform model choice assumes it is flat. In most products a majority of requests are trivial, so the design is a router: heuristics or a small classifier send easy traffic to a small model and hard traffic to the strong one. And the router is biased toward escalation, because misrouting a hard request produces a confidently wrong answer while misrouting an easy one produces a slightly expensive right one."',
    },
    {
      weakAnswer: '"Costs are too high, so we will switch to the cheaper model."',
      whyWeak:
        'It changes the most disruptive variable in response to a cost problem whose cause has not been identified. If the cause is an uncached prompt, over-retrieval or long reasoning output, the cheaper model will also be several times over its forecast.',
      strongAnswer:
        '"Break the cost down by component before changing the model. Prefix caching, context size and output length are all levers with no quality effect at all, so they come first. Only once those are fixed does the remaining cost tell you whether the model choice is the problem — and at that point the answer is usually routing rather than replacing, because replacing trades the hard tail for the easy majority."',
    },
    {
      weakAnswer: '"We tested the cheaper model on twenty examples and it looked about as good."',
      whyWeak:
        'Twenty hand-written examples contain perhaps two hard cases, so a model that fails half of them still scores 95%. And hand-written examples over-represent the clear cases, because clear cases are the ones that are easy to invent.',
      strongAnswer:
        '"A set of 100–300 cases sampled from real traffic, stratified by difficulty with the hard stratum deliberately over-sampled, and scored per stratum. The aggregate number is the one that hides a regression in the 10% of cases that decide whether the product is trusted — so the claim I want to be able to make is per stratum: matches within a point on easy and moderate, loses six points on hard."',
    },
    {
      weakAnswer: '"We cascade: try the cheap model, and if it is not confident we escalate."',
      whyWeak:
        'Self-reported confidence correlates poorly with correctness, so the cascade escalates the wrong cases in both directions — passing bad answers through and re-running good ones. The verifier looks free and does not work.',
      strongAnswer:
        '"A cascade is only as good as its verifier, so I would cascade where verification is deterministic: the code compiles, the SQL parses and returns rows, the output matches the schema, the extraction contains a known identifier. Those are cheap and unambiguous. Where no deterministic check exists, a judge model is the option — and its cost belongs in the arithmetic, and the cascade\'s quality ceiling becomes the judge\'s accuracy rather than the strong model\'s."',
    },
    {
      weakAnswer: '"Cascading cuts cost by 60%, so it is strictly better."',
      whyWeak:
        'The formula assumes verification is free and ignores latency. An escalated request runs both models sequentially, so the mean improves while the p99 gets worse — which may be unacceptable in an interactive product even when the saving is real.',
      strongAnswer:
        '"The break-even is that the cheap model must succeed more often than the cost ratio — with a model a tenth of the price, above 10%, which is a low bar. But three things sit outside that formula: the verifier\'s cost, which I would add explicitly; the verifier\'s accuracy, which becomes the quality ceiling; and tail latency, because an escalated request pays both models. So a cascade trades p99 for cost, which is right for a batch pipeline and a real question for a chat."',
    },
    {
      weakAnswer: '"We added a semantic cache, so repeated questions are free."',
      whyWeak:
        'Semantic caching returns a stored answer for a similar question, and similar is not the same. "What is the refund window?" and "What is the refund window for enterprise customers?" are close in embedding space with different correct answers, so a loose threshold returns a confidently wrong response.',
      strongAnswer:
        '"Exact-match caching is free of quality risk and works wherever requests repeat verbatim — templated and tool-driven flows more often than people expect. Semantic caching is a quality trade with a threshold parameter that has a wrong-answer rate attached, so it needs the same evaluation as a model change. And prefix caching is neither: it reduces the price of tokens you are sending anyway with no quality effect, which is why it is the one to do first."',
    },
  ],

  flashcards: [
    {
      id: 'fc-ms-1',
      front: 'Why is "pick two of cheap, fast, good" wrong for a system?',
      back: 'A single model is one point on the triangle; a system routing across several models sits at a weighted average, and the weights are yours to choose.',
      topic: 'routing',
    },
    {
      id: 'fc-ms-2',
      front: 'What property of real traffic makes routing worthwhile?',
      back: 'The difficulty distribution is skewed — most requests are easy — so a uniform model choice pays the strong model\'s price on the majority that do not need it.',
      topic: 'routing',
    },
    {
      id: 'fc-ms-3',
      front: 'When does a cascade beat always using the expensive model?',
      back: 'When the cheap model\'s success rate exceeds the cost ratio: p > c_cheap / c_expensive. At a tenth of the price, above 10%.',
      topic: 'cascades',
    },
    {
      id: 'fc-ms-4',
      front: 'What three things does the cascade formula hide?',
      back: 'The verifier\'s cost, the verifier\'s accuracy (which becomes the quality ceiling), and tail latency — an escalated request pays both models.',
      topic: 'cascades',
    },
    {
      id: 'fc-ms-5',
      front: 'Which tasks cascade well, and which do not?',
      back: 'Those with a deterministic verifier — compiles, parses, matches a schema, contains a known identifier. Open-ended prose does not, because verification means paying a judge to guess.',
      topic: 'cascades',
    },
    {
      id: 'fc-ms-6',
      front: 'Why is self-reported confidence a poor escalation signal?',
      back: 'It correlates poorly with correctness, so the cascade escalates the wrong cases in both directions — passing bad answers and re-running good ones.',
      topic: 'cascades',
    },
    {
      id: 'fc-ms-7',
      front: 'What keeps a router honest?',
      back: 'The classification must cost far less than it saves — an expensive router eats most of the saving and adds a component.',
      topic: 'routing',
    },
    {
      id: 'fc-ms-8',
      front: 'Which way should a router be biased, and why?',
      back: 'Toward escalation. A misrouted hard request is a confidently wrong answer; a misrouted easy one is a slightly expensive right answer.',
      topic: 'routing',
    },
    {
      id: 'fc-ms-9',
      front: 'Which cost lever has no quality trade at all?',
      back: 'Prefix caching — it reduces the price of tokens you are sending anyway. Do it before any model change.',
      topic: 'caching',
    },
    {
      id: 'fc-ms-10',
      front: 'How do exact-match and semantic caching differ in risk?',
      back: 'Exact-match has zero quality risk. Semantic caching returns an answer for a similar question, so its threshold has a wrong-answer rate attached.',
      topic: 'caching',
    },
    {
      id: 'fc-ms-11',
      front: 'Why can a model not be chosen from public benchmarks?',
      back: 'They measure a model on curated tasks; you need to measure your system — prompt, context and traffic distribution included — on your own cases.',
      topic: 'evaluation',
    },
    {
      id: 'fc-ms-12',
      front: 'Why must an eval set be stratified by difficulty?',
      back: 'An aggregate score hides a regression in the small hard stratum that decides whether users trust the product.',
      topic: 'evaluation',
    },
    {
      id: 'fc-ms-13',
      front: 'Why are hand-written eval examples systematically biased?',
      back: 'They over-represent clear cases, because clear cases are the ones easy to invent — so the hard stratum is under-sampled exactly where it matters.',
      topic: 'evaluation',
    },
    {
      id: 'fc-ms-14',
      front: 'Why is reasoning a purchase rather than a free improvement?',
      back: 'It produces many more output tokens, which are the most expensive and slowest part of a request — so whether it helps enough is measurable per task.',
      topic: 'cost',
    },
  ],

  quiz: [
    {
      id: 'q-ms-1',
      kind: 'scenario',
      prompt:
        'A cheap model costs 10% of the expensive one and succeeds on 70% of requests. What is the blended cost of a cascade, and where is the break-even?',
      options: [
        { id: 'a', label: '0.40 of the expensive model, with break-even at a 10% success rate' },
        { id: 'b', label: '0.70, since 70% of requests use the cheap model' },
        { id: 'c', label: '0.10, since most requests are handled cheaply' },
        { id: 'd', label: '1.10, since every request pays both' },
      ],
      correct: ['a'],
      explanation:
        '0.10 + 0.30 × 1.00 = 0.40. The key point is that a failure pays both models, so the formula is c_cheap + (1−p)·c_expensive — and it beats the expensive model whenever p exceeds the cost ratio, which is a surprisingly low bar.',
      difficulty: 'core',
      topic: 'cascades',
    },
    {
      id: 'q-ms-2',
      kind: 'scenario',
      prompt:
        'Which task is a good candidate for a cascade?',
      options: [
        { id: 'a', label: 'Generating SQL that must parse and return rows against a real schema' },
        { id: 'b', label: 'Writing a customer-facing apology email' },
        { id: 'c', label: 'Summarising a long document in prose' },
        { id: 'd', label: 'Answering an open-ended policy question' },
      ],
      correct: ['a'],
      explanation:
        'A deterministic verifier decides the cascade: the SQL either parses and runs or it does not, cheaply and unambiguously. The other three need a judge model, which costs money, is fallible, and caps the cascade\'s quality at the judge\'s accuracy rather than the strong model\'s.',
      difficulty: 'core',
      topic: 'cascades',
    },
    {
      id: 'q-ms-3',
      kind: 'scenario',
      prompt:
        'Costs are four times forecast. What should be investigated before changing the model?',
      options: [
        { id: 'a', label: 'Cache hit rate, conversation length, retrieved context size and output length — all levers with no quality effect' },
        { id: 'b', label: 'Which model the competitor uses' },
        { id: 'c', label: 'Whether the provider raised prices' },
        { id: 'd', label: 'Nothing — the model is the dominant cost' },
      ],
      correct: ['a'],
      explanation:
        'Each of those can multiply cost with no change in behaviour, and each is fixable without touching quality. Changing the model is the most disruptive available response, and if the cause is an uncached prompt the cheaper model will be four times over its forecast too.',
      difficulty: 'core',
      topic: 'cost',
    },
    {
      id: 'q-ms-4',
      kind: 'scenario',
      prompt:
        'A cheaper model scores 95% on a 20-example test set versus 97% for the expensive one. What does that tell you?',
      options: [
        { id: 'a', label: 'Very little — with two hard cases in the set, a 50% regression on hard requests is within that gap' },
        { id: 'b', label: 'The cheap model is nearly as good and should be adopted' },
        { id: 'c', label: 'The expensive model is worth its price for the 2% difference' },
        { id: 'd', label: 'The models are statistically indistinguishable' },
      ],
      correct: ['a'],
      explanation:
        'With hard cases at roughly 10% of traffic, a 20-example set contains about two, so failing one is a five-point aggregate swing. Hand-written examples also over-represent clear cases — so the set is both too small and drawn from the wrong distribution.',
      difficulty: 'advanced',
      topic: 'evaluation',
    },
    {
      id: 'q-ms-5',
      kind: 'scenario',
      prompt:
        'A semantic cache returns the stored answer to "What is the refund window?" for the query "What is the refund window for enterprise customers?". What went wrong?',
      options: [
        { id: 'a', label: 'The similarity threshold is too loose — semantically close questions can have different correct answers, so the threshold carries a wrong-answer rate' },
        { id: 'b', label: 'The embedding model is too weak' },
        { id: 'c', label: 'The cache should have expired' },
        { id: 'd', label: 'Nothing — the answers are close enough' },
      ],
      correct: ['a'],
      explanation:
        'Semantic caching is a quality trade rather than a free saving, and its threshold needs the same evaluation as a model change. Exact-match caching has no such risk, and prefix caching is different again — it reduces the price of tokens you are sending anyway with no quality effect at all.',
      difficulty: 'advanced',
      topic: 'caching',
    },
    {
      id: 'q-ms-6',
      kind: 'multi',
      prompt:
        'Which claims can be defended in a design discussion? Select all that apply.',
      options: [
        { id: 'a', label: '"The small model matches within a point on 70% of our traffic and loses six points on the hard stratum"' },
        { id: 'b', label: '"Routing blends to 40% of the cost with no measurable loss where it matters"' },
        { id: 'c', label: '"A cascade improves mean latency and worsens the p99, which we accept for this batch path"' },
        { id: 'd', label: '"This model ranks higher on the leaderboard, so it is the better choice"' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are measurements on your own traffic with the trade stated. A benchmark ranking is a shortlist input rather than a decision — it scored the model on curated tasks, while you need to score the system, prompt and context included, on your distribution.',
      difficulty: 'core',
      topic: 'evaluation',
    },
  ],

  exercises: [
    {
      id: 'ex-ms-1',
      kind: 'estimate',
      title: 'Design a routing policy from a difficulty distribution',
      estimatedMinutes: 40,
      prompt: `A document-processing product handles 2 million requests a day, in three categories measured from real traffic:

\`\`\`
Extraction  (55%): pull 6 fields from an invoice into JSON
Classification (30%): assign one of 12 categories
Summarisation (15%): a 200-word summary of a contract
\`\`\`

Measured on a stratified eval set of 300 cases:

\`\`\`
                  small model      large model
extraction        94% correct      99% correct
classification    97% correct      98% correct
summarisation     71% acceptable   92% acceptable
\`\`\`

Costs: small = $0.20 per 1,000 requests; large = $2.00 per 1,000. A JSON-schema validator is free. An LLM judge for summaries costs $0.30 per 1,000.

**Part 1.** Compute the daily cost of using the large model for everything, and of the small model for everything.

**Part 2.** Design a routing policy per category. Justify each choice and compute the blended daily cost.

**Part 3.** For extraction, evaluate a cascade. Show the arithmetic including verification, and say whether it beats routing.

**Part 4.** State the quality outcome of your policy per category, and the failure direction of each routing decision.

Then answer:

- Which category\'s numbers would you most want to re-measure, and why?
- What would change if summarisation were 60% of traffic instead of 15%?`,
      rubric: [
        'Both uniform costs computed correctly.',
        'A per-category routing decision with a stated reason.',
        'Recognises that classification barely differs, so the small model wins.',
        'Recognises that summarisation has no cheap verifier and a large quality gap.',
        'Cascade arithmetic for extraction includes the validator and is correct.',
        'Compares cascade against routing rather than against the uniform baseline only.',
        'States quality per category and the failure direction of each decision.',
        'Identifies the category whose numbers are least trustworthy, with reasoning.',
        'Correctly reasons about the mix shift.',
      ],
      modelAnswer: `**Part 1 — the two uniform baselines**

\`\`\`
2,000,000 requests/day

All large:  2,000 × $2.00 = $4,000/day   ($1.46 M/year)
All small:  2,000 × $0.20 =   $400/day   ($146 K/year)
\`\`\`

**A tenfold gap, which is the size that makes routing worth designing** — and the question is how much quality the $3,600 a day is buying, per category.

---

**Part 2 — a routing policy per category**

**Classification (30%, 600,000/day): small model, unconditionally.**

\`\`\`
97% vs 98% — a one-point gap
Cost of using large: 600 × ($2.00 − $0.20) = $1,080/day
Cost per additional correct answer:
  600,000 × 0.01 = 6,000 extra correct
  $1,080 / 6,000 = $0.18 per additional correct classification
\`\`\`

**Whether that is worth paying is a product question**, and I would put the number in front of whoever owns it rather than deciding silently. **My default is the small model**: for a twelve-way classification, a one-point difference is within the range where the labelling of the eval set itself is uncertain.

*And classification has a partial verifier:* **the output must be one of twelve known labels.** That catches format failures, not wrong-but-valid labels — **so it is not enough for a cascade**, which is why this is a routing decision rather than a cascade.

**Summarisation (15%, 300,000/day): large model.**

\`\`\`
71% vs 92% — a twenty-one point gap
\`\`\`

**The gap is large, the output is customer-facing, and there is no cheap verifier** — the judge costs $0.30 per thousand, which is 150% of the small model's own price. **This is the category the strong model exists for.**

\`\`\`
300 × $2.00 = $600/day
\`\`\`

**Extraction (55%, 1,100,000/day): cascade — see Part 3.**

**Blended cost with routing only** (extraction on the large model for now):

\`\`\`
extraction     1,100 × $2.00 = $2,200
classification   600 × $0.20 =   $120
summarisation    300 × $2.00 =   $600
                               ───────
                                $2,920/day   — 27% below uniform large
\`\`\`

---

**Part 3 — a cascade for extraction**

**Extraction is the ideal cascade candidate: a JSON-schema validator is free and deterministic.**

*But the validator only checks shape, not correctness* — **a plausible wrong value passes.** So the honest question is what fraction of the small model's 6% failures the validator catches.

\`\`\`
Assume the split (and Part 4 returns to this):
  6% failures = 4% malformed/missing fields → caught
                2% well-formed but wrong    → NOT caught
\`\`\`

**Cascade arithmetic, in dollars per 1,000:**

\`\`\`
small attempt on all:                      $0.20
validator:                                  $0.00
escalate the 4% the validator catches:
  0.04 × $2.00                            = $0.08
                                           ──────
                                             $0.28 per 1,000

Daily: 1,100 × $0.28 = $308/day
\`\`\`

**Against $2,200 for the large model — an 86% saving on the largest category.**

**Break-even check:** \`p > c_cheap / c_expensive\` = 0.20/2.00 = **10%**, and the validator-detectable success rate is 96% — **far above it.**

**And the quality outcome, which is the part that must be stated:**

\`\`\`
Large model only:        99% correct
Cascade:                 96% pass the validator directly
                       + 4% escalated → 99% of those correct
                       = 96% × (correctness of passing ones)
                         + 4% × 0.99
\`\`\`

**Of the 96% that pass, 2 points are well-formed but wrong** — so **cascade accuracy ≈ 94% + 4% × 0.99 ≈ 97.9%**, against 99% for the large model alone. **A 1.1-point regression for an 86% cost saving on 55% of traffic.**

**Cascade versus routing:**

\`\`\`
Extraction on large:    $2,200/day, 99.0% correct
Extraction cascaded:      $308/day, 97.9% correct
→ $1,892/day saved, 1.1 points of accuracy lost
→ $1,892 / (1,100,000 × 0.011) ≈ $0.16 per additional
  correct extraction
\`\`\`

**The same number as the classification trade-off, arrived at independently** — which is a good sign that the framing is right: **every routing decision is "what does an additional correct answer cost here".**

**Final blended cost:**

\`\`\`
extraction (cascade)  $308
classification         $120
summarisation          $600
                      ─────
                      $1,028/day   — 74% below uniform large
                                     ($375 K/year vs $1.46 M)
\`\`\`

---

**Part 4 — quality and failure direction per category**

\`\`\`
CATEGORY         QUALITY        FAILURE DIRECTION
extraction       97.9%          A well-formed wrong value passes
                 (−1.1 pts)     the validator and is returned
                                silently. Worst direction: the
                                error is invisible downstream.

classification   97%            A wrong-but-valid label is
                 (−1 pt)        returned. Also silent, but the
                                consequence is usually a
                                misfiled document rather than
                                a wrong number.

summarisation    92%            No change from the large-model
                 (unchanged)    baseline.
\`\`\`

**Two things to say about the failure directions.**

**Extraction's silent-wrong-value case is the one to mitigate**, and the cheap mitigation is not a better model: **field-level plausibility checks.** A date in the future on an invoice, a total that does not equal the sum of line items, a VAT number failing a checksum — **each is a deterministic check that catches a class of well-formed wrong values** and pushes more failures into the escalation path, where they are fixed.

*That is the important insight:* **strengthening the verifier improves both quality and the cascade's economics**, because it converts invisible errors into escalations. **The verifier is the lever, not the model.**

**And classification's failure is tolerable precisely because a wrong label is usually recoverable** — a human re-files it — **whereas a wrong extracted total propagates into a payment.** Same one-point gap, different consequence, **which is why per-category decisions beat a global one.**

---

**Which category's numbers would I most want to re-measure?**

**Extraction — specifically the split between malformed failures and well-formed-but-wrong ones, because the entire cascade economics rests on an assumed number.**

\`\`\`
If the split is 5% malformed / 1% wrong:
  escalation 5% → cost $0.30/1,000, quality ≈ 98.9%
  → better on both axes than assumed

If the split is 1% malformed / 5% wrong:
  escalation 1% → cost $0.22/1,000
  quality ≈ 94% + 1% × 0.99 ≈ 95%
  → a 4-point regression, which changes the decision
\`\`\`

**Same 6% failure rate, and the cascade goes from clearly right to questionable** — because **what the validator can see is the quantity that matters, not the raw accuracy.**

**And it is measurable directly:** run the small model over the eval set, apply the validator, **and label the passing failures by hand.** A few hundred cases gives the split.

*The second number I would check:* **the summarisation "acceptable" rate**, because it is a rubric judgment rather than a deterministic check. **71% versus 92% is a large gap, and a rubric applied by one person on 45 summarisation cases** — 15% of 300 — **has wide error bars.** If the true gap were 85% versus 92%, the decision to pay ten times as much becomes arguable.

*Which suggests a general rule:* **re-measure whichever number your largest cost decision depends on most sensitively.** Here that is the validator-visible fraction, and it is also the cheapest to establish.

---

**What if summarisation were 60% of traffic rather than 15%?**

**The economics invert, and the answer stops being a routing policy.**

\`\`\`
New mix: extraction 20%, classification 20%, summarisation 60%

Blended with the same policy:
  extraction (cascade)  400 × $0.28 = $112
  classification        400 × $0.20 =  $80
  summarisation       1,200 × $2.00 = $2,400
                                     ──────
                                      $2,592/day
→ summarisation is now 93% of the bill
\`\`\`

**And it is the category with no verifier and the largest quality gap** — **so the cheap levers are exhausted and the expensive question becomes unavoidable.**

**Three things I would do that were not worth doing at 15%.**

**Invest in a verifier for summaries.** At $2,400 a day, **building a usable check is worth real effort** — and it need not be a judge model. Deterministic proxies exist: **does the summary contain the contract's parties, dates and value? does every named entity appear in the source?** Those are cheap, catch a real class of failure, and would make a cascade viable.

*This is the same insight as extraction's plausibility checks*, arrived at by cost pressure rather than by quality concern.

**Reconsider the task shape.** A 200-word summary is 260 output tokens; **the cost is dominated by output.** Whether 120 words serves the purpose is a product question **worth asking when it halves 93% of the bill** — and it was not worth asking at 15%.

**And re-evaluate the gap itself.** At this volume, **a fine-tuned small model or a better prompt for the small model could be worth weeks of work** — an option that is uneconomic at 300,000 requests a day and obvious at 1.2 million.

*The general lesson:* **the mix decides which optimisation is worth its engineering cost.** The same policy is correct at one mix and negligent at another, **which is why the difficulty distribution is the first thing to measure and the thing to re-measure when the product changes.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-ms-1',
      level: 'basic',
      question: 'How would you choose a model for this feature?',
      guidance:
        'Look for measurement on the candidate\'s own traffic rather than a benchmark ranking, and for the recognition that it is a per-request decision rather than a single choice.',
    },
    {
      id: 'iq-ms-2',
      level: 'basic',
      question: 'Your costs are four times forecast. What do you do?',
      guidance:
        'Break the cost down first — caching, context size, conversation length, output length — before changing the model. Strong answers note that a model change would obscure the real cause.',
    },
    {
      id: 'iq-ms-3',
      level: 'intermediate',
      question: 'When is a cascade worth building?',
      guidance:
        'When the cheap model succeeds more often than the cost ratio, and crucially when verification is deterministic. Look for the verifier being named as the deciding factor.',
    },
    {
      id: 'iq-ms-4',
      level: 'intermediate',
      question: 'How would you route requests between models?',
      guidance:
        'Heuristics or a small classifier, with the classification cost far below the saving, and the bias toward escalation stated.',
    },
    {
      id: 'iq-ms-5',
      level: 'advanced',
      question: 'How do you know the cheaper model is good enough?',
      guidance:
        'A stratified eval set from real traffic, scored per stratum. Excellent answers explain why an aggregate score and hand-written examples both hide the hard cases.',
    },
    {
      id: 'iq-ms-6',
      level: 'advanced',
      question: 'What are the downsides of a cascade?',
      guidance:
        'Verifier cost, verifier accuracy as the quality ceiling, and worse tail latency because escalated requests pay both models.',
    },
    {
      id: 'iq-ms-7',
      level: 'followup',
      question: 'Would you add a semantic cache?',
      guidance:
        'Only with an evaluated threshold, because near-miss questions have different correct answers. Exact-match and prefix caching carry no such risk.',
    },
    {
      id: 'iq-ms-8',
      level: 'followup',
      question: 'How would you improve a cascade\'s economics without changing models?',
      guidance:
        'Strengthen the verifier. Better checks convert invisible errors into escalations, improving both quality and cost — the verifier is the lever, not the model.',
    },
  ],

  activeLearning: [
    {
      id: 'al-ms-1',
      kind: 'what-changes-if',
      prompt:
        'Change the constraint: the product must run entirely on self-hosted models on your own GPUs, with no per-token pricing. What survives from this lesson, and what is replaced?',
      discussion: `**The triangle survives and its units change entirely**, which turns several conclusions upside down.

**What is replaced: cost stops being per-token and becomes capacity.**

\`\`\`
Hosted:      cost = tokens × price, perfectly variable
Self-hosted: cost = GPUs × time, entirely fixed in the
             short run
\`\`\`

**So a request costs nothing marginal and everything at the margin of capacity.** Below saturation, an extra request is free; **above it, the next request needs another GPU** — which is a step function rather than a slope.

**Three consequences follow immediately.**

**Utilisation becomes the cost metric.** A fleet at 30% utilisation is paying three times per useful request, **so batching and scheduling matter more than token counts** — the opposite emphasis from the hosted case.

**Prompt caching changes meaning.** It still reduces prefill compute, **so it increases throughput per GPU rather than reducing a bill** — the same action with a different accounting. **And it becomes a capacity lever**, which is arguably more valuable.

**And output length matters even more.** Decode occupies a GPU for its duration, **so a long response holds capacity that could serve several short ones** — meaning output length limits are now a throughput control rather than a cost control.

**What survives, and survives strongly.**

**Routing.** Running a small model for easy traffic **frees the large model's GPUs for the hard traffic** — so the saving is capacity rather than money, and it is often larger in relative terms because model sizes differ by more than prices do.

**Cascades**, with the same break-even logic in units of GPU-seconds rather than dollars. **And the verifier argument is unchanged**, because it was never about price.

**The stratified eval set**, unchanged and more important: **you now own the quality ceiling entirely**, with no option to buy a better model on demand.

**And the free levers come first for the same reason** — context size and output length reduce compute regardless of who is billing.

**What becomes genuinely new.**

**Queueing, which the hosted case hid.** A provider absorbs burst traffic behind its own capacity; **self-hosted you see it directly** — so the design gains an admission queue, a concurrency limit per model, and the load-shedding question from the resilience lessons. **A request that cannot be served must wait or be refused**, and that decision did not previously exist.

**Model loading time.** Switching a GPU between models costs seconds to minutes, **so a routing policy that alternates rapidly between three models on one device is unworkable.** Either each model gets dedicated capacity — **which lowers utilisation** — or routing is batched so a device handles many requests for one model before switching. **Routing and scheduling become coupled**, which they were not before.

**And the tail behaves differently.** Hosted, the p99 was mostly the model's speed; **self-hosted it is queueing delay under load**, which is a capacity problem with a completely different fix.

**What I would build.**

\`\`\`
Keep:     routing, cascades, the eval set, context and
          output discipline, prefix caching (as a
          throughput lever)
Replace:  cost-per-token accounting → GPU-seconds and
          utilisation
Add:      an admission queue with a concurrency limit per
          model, batching to amortise model loading,
          load shedding with a stated refusal policy,
          and utilisation as the headline metric
Reconsider: whether three models are affordable at all —
          dedicated capacity per model may be worse than
          one mid-sized model at high utilisation
\`\`\`

**That last line is the genuinely different conclusion.** Hosted, adding a third model to the routing policy costs nothing until it is used. **Self-hosted it costs a GPU whether or not it is used** — so **the number of distinct models becomes a cost in itself**, and a policy that was obviously right hosted may not survive.

**The transferable point:** the triangle is invariant and its units are not. **When cost moves from marginal to fixed, optimisations that reduced per-request spend become optimisations that increase throughput** — usually the same actions, occasionally the opposite conclusion, and always with a new constraint (queueing) that the provider was hiding.`,
    },
    {
      id: 'al-ms-2',
      kind: 'debug',
      prompt:
        'A team ships a router: easy requests to a small model, hard ones to a large one. Aggregate quality on their eval set is unchanged and costs fall 55%. Two weeks later, support escalations have risen 30% and users describe the assistant as "confidently wrong sometimes". Diagnose it.',
      discussion: `**Unchanged aggregate quality alongside a 30% rise in escalations** is the contradiction, and it has a small number of explanations — **all of which are about the eval set failing to represent what changed.**

**Hypothesis 1 — the router misroutes hard requests, and the eval set does not test routing.**

**The eval set measures models; the router is a new component that was not evaluated.**

\`\`\`
Eval: run each model on each case → both models unchanged
      → aggregate quality unchanged ✓
Production: the ROUTER decides which model sees each case
      → a hard request routed to the small model produces
        a confident wrong answer
      → and that path was never measured
\`\`\`

*Why it fits perfectly:* **"confidently wrong sometimes" is precisely a hard request answered by a small model.** And the eval set cannot detect it, because **it never exercised the routing decision.** **This is my leading hypothesis.**

*Check:* sample escalated conversations and record which model served them. **If escalations are concentrated on small-model responses, the router is the problem** — and the fix is to bias it toward escalation and re-measure.

**Hypothesis 2 — the difficulty distribution in production differs from the eval set.**

If the eval set was stratified at 60/30/10 and real traffic is 50/30/20, **twice as many hard requests are arriving** — and if the router's threshold was tuned on the eval distribution, **it under-escalates.**

*Why it fits:* the models are unchanged, **the mix is not.** *Check:* the router's escalation rate against the expected hard-stratum share. **A router sending 10% to the large model when 20% of traffic is hard is the whole finding.**

**Hypothesis 3 — the hard stratum was under-sampled, so the regression was always invisible.**

The previous lesson's arithmetic: **if hard cases are 10% of an eval set, a 30% regression on them is a 3-point aggregate change** — and with a small set that is inside the noise.

*Why "unchanged" is compatible with a real regression:* **the aggregate cannot resolve it.** *Check:* re-score the eval set per stratum rather than in aggregate. **If nobody has the per-stratum numbers, that is itself the finding** — and it is the most common version of this failure.

**Hypothesis 4 — difficulty is not predictable from the request surface.**

Routing heuristics use length, keywords, whether retrieval returned anything. **Some genuinely hard requests look trivial**: a short question with a subtle premise, an ambiguous pronoun, a request whose difficulty lies in what it does not say.

*Why it fits the "sometimes":* **it is not random, it is a systematic blind spot** — and it would produce a consistent class of bad answers rather than scattered ones. *Check:* cluster the escalated requests. **A recognisable pattern means the router's features are wrong**, which is a different fix from a threshold change.

**Hypothesis 5 — the escalation rise is not caused by quality at all.**

Two weeks is enough for a marketing push, a seasonal shift, or a change in what users ask. **Escalations could be up because traffic changed.**

*Check:* escalation rate as a proportion of conversations rather than absolute count, **and segmented by model served.** **If the rate is flat on large-model responses and up on small-model ones, hypothesis 5 is excluded** — which makes this a cheap discriminator to run first.

**What I would check first: escalation rate segmented by which model served the conversation.** One query, **and it separates "the router is misrouting" from "traffic changed" immediately** — the two hypotheses that explain the data most economically.

**Then: re-score the eval set per stratum.** Hypothesis 3 is the one where the regression was always present and unmeasured, **and it is the most common** — because the aggregate number is the one everybody reports.

**Why "aggregate quality unchanged" is the misleading fact.**

**It measured the wrong thing twice over.** It measured models rather than the system — **so the router, which is the only thing that changed, was not evaluated at all** — and it aggregated across strata, **so even a per-model regression on hard cases would have been hidden.**

**Which is the general failure: an evaluation that does not include the component you added.** Adding a router and re-running a model evaluation is like adding a cache and re-running a correctness test — **it will pass, and it tests nothing about the change.**

**The instrumentation this demands.**

**Which model served each request, recorded and joinable to outcomes.** The single most valuable field, **and without it none of the hypotheses above can be separated.**

**Escalation and thumbs-down rates segmented by model and by router decision.** This is the production equivalent of per-stratum scoring, **and it is the metric that would have caught this in days rather than weeks.**

**The router's escalation rate as a monitored number**, compared against the expected hard-stratum share. **A drift between them means the traffic mix has moved**, which is actionable before it becomes an escalation trend.

**An eval set that includes the router.** Cases run end to end through routing, **scored on the final answer** — not on each model separately. **That is the only evaluation that would have shown the regression before shipping.**

**And a periodic re-sampling of the eval set from current traffic.** A set built once drifts as the product changes, **and its stratification is a snapshot of a distribution that moves.**

**Transferable:** when a change improves a metric and users get worse outcomes, **check whether the metric was measured on the system as changed.** Adding a routing layer and re-running a model benchmark is a category error — **the new component is the untested part, and the aggregate hides the stratum where it fails.**`,
    },
  ],

  revision: {
    bullets: [
      'A single model is one point on the triangle; a routed system sits at a weighted average you choose.',
      'Real traffic has a skewed difficulty distribution, so a uniform model choice pays for the majority that do not need it.',
      'A cascade beats the expensive model when p > c_cheap / c_expensive.',
      'At a tenth of the price that is a 10% success rate — a low bar, which is why cascades usually merit a test.',
      'The formula hides three things: verifier cost, verifier accuracy, and tail latency.',
      'A cascade\'s quality ceiling is the verifier\'s accuracy, not the strong model\'s.',
      'Cascade where verification is deterministic — compiles, parses, matches a schema, contains a known identifier.',
      'Self-reported confidence is a poor escalation signal; it correlates weakly with correctness.',
      'A router\'s classification must cost far less than it saves, or it eats the saving.',
      'Bias the router toward escalation: a misrouted hard request is a confidently wrong answer.',
      'Prefix caching is the only lever here with no quality trade — do it first.',
      'Exact-match caching is safe; semantic caching has a wrong-answer rate attached to its threshold.',
      'Reasoning is a purchase paid in output tokens, which are the most expensive and slowest part.',
      'Public benchmarks score a model; you need to score your system on your traffic.',
      'An eval set must be stratified, with hard cases over-sampled, or a regression there is invisible.',
      'Hand-written examples over-represent clear cases, because clear cases are easy to invent.',
      'Strengthening the verifier improves both quality and cascade economics — it is the real lever.',
      'Evaluate the system as changed: adding a router and re-running a model benchmark tests nothing.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A method for placing a system on the cost/latency/quality triangle: fix the free levers, measure the difficulty distribution, build a stratified evaluation set, then route or cascade so each request is handled by the smallest model that can handle it.',
    whyItExists:
      'Because a single model applies one price and one quality level to a traffic distribution that is heavily skewed — and because the decision cannot be made from a benchmark, since your prompt, context and traffic are part of what is being measured.',
    whenToUse: [
      'Prefix caching and context trimming before any model change.',
      'Routing whenever difficulty is predictable from the request or its context.',
      'A cascade whenever a cheap deterministic verifier exists.',
      'Exact-match caching wherever requests repeat verbatim.',
      'A stratified eval set as the basis for any of these decisions.',
    ],
    whenNotToUse: [
      'One model for all traffic, in either direction.',
      'A model change as the first response to a cost problem.',
      'A cascade on open-ended prose with no deterministic check.',
      'Self-reported confidence as the escalation signal.',
      'A router whose classification cost approaches the saving.',
      'Semantic caching without an evaluated threshold.',
      'Benchmark rankings as the decision rather than the shortlist.',
      'Hand-written examples as the evaluation set.',
    ],
    alternatives: [
      'A cheap heuristic filter before the model, when many requests need no model at all.',
      'Reasoning on a small model instead of a direct answer from a large one — worth testing explicitly.',
      'Field-level plausibility checks to strengthen a verifier rather than upgrading the model.',
      'Shorter outputs as a throughput and cost control.',
      'Dedicated capacity per model, when self-hosting makes each additional model a fixed cost.',
    ],
    tradeoffs: [
      'Routing buys a blended position and costs a component that can misroute.',
      'A cascade buys a large cost saving and costs tail latency plus the verifier\'s ceiling.',
      'A cheap model buys cost on the easy majority and risks the hard minority that matters.',
      'Semantic caching buys repeat savings and costs a wrong-answer rate.',
      'Reasoning buys quality on multi-step tasks and costs several times the output.',
      'A stratified eval set buys a defensible decision and costs the effort to build and maintain it.',
    ],
    failureModes: [
      'Paying the strong model\'s price on trivial traffic.',
      'Switching everything to a cheap model and degrading the hard tail.',
      'A router that misroutes hard requests, producing confident wrong answers.',
      'An eval set that never exercises the router that was just added.',
      'An aggregate score hiding a regression in the hard stratum.',
      'Twenty hand-written examples supporting a model decision.',
      'A cascade whose verifier passes well-formed wrong answers silently.',
      'A judge model that costs more than the saving it protects.',
      'A semantic cache returning a near-miss answer confidently.',
      'A cost problem attributed to the model when it was an uncached prompt.',
    ],
    followUpQuestions: [
      'What does the difficulty distribution of this traffic look like?',
      'Have the free levers been fixed first?',
      'Is there a deterministic way to check the cheap model\'s answer?',
      'What is the cheap model\'s success rate against the cost ratio?',
      'What does the verifier cost, and how accurate is it?',
      'What happens to the p99 when a request escalates?',
      'Which way is the router biased, and what happens when it is wrong?',
      'Was the eval set sampled from real traffic, and is it stratified?',
      'What is the score per stratum, not in aggregate?',
      'Does the evaluation include the router?',
      'Which model served this request, and is that recorded?',
    ],
  },
});
