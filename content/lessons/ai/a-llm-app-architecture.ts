import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-llm-app-architecture',
  title: 'The LLM request lifecycle',
  summary:
    'The model is stateless and charged by the token, so the application owns context assembly — and both the latency users feel and the bill you pay are decided by choices made before the request is sent.',
  phase: 'ai',
  module: 'llm-apps',
  position: 70,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['lifecycle', 'context', 'latency', 'cost', 'streaming'],
  prerequisites: ['h-estimation'],
  resources: [
    {
      key: 'anthropic-prompt-caching',
      tier: 'must',
      note: 'Read it for what is cached and what invalidates it. Prefix caching is the single largest lever on both cost and time-to-first-token, and it constrains how you order the prompt — which is a design decision rather than a tuning one.',
    },
    {
      key: 'anthropic-context-engineering',
      tier: 'must',
      note: 'Read it for the framing that the application\'s real job is deciding what goes into the window. Everything in this lesson follows from the model being stateless and the context being the only input you control.',
    },
    {
      key: 'attention-paper',
      tier: 'good',
      note: 'Read the architecture section for why processing a prompt is parallel while generating tokens is sequential. That asymmetry is the whole latency model, and it explains why input length and output length cost completely different things.',
    },
    {
      key: 'lost-in-the-middle',
      tier: 'good',
      note: 'Read it for the position effect: material in the middle of a long context is used less reliably than material at either end. It turns context ordering from a stylistic choice into a measurable one.',
    },
    {
      key: 'latency-numbers',
      tier: 'good',
      note: 'Use it to keep the comparison honest. A retrieval step measured in milliseconds sits next to a generation step measured in seconds, and knowing the orders of magnitude stops you optimising the wrong stage.',
    },
    {
      key: 'mdn-sse',
      tier: 'advanced',
      note: 'Read it as the transport for streaming responses. Streaming is not only a user-experience choice — it changes what a failure looks like, because you may have already emitted half an answer when the request fails.',
    },
  ],

  intuition: {
    body: `Two facts about a language model determine the shape of every application built on one.

**It is stateless.** It remembers nothing between calls. **What looks like a conversation is the application resending the entire history every turn** — so "memory" is a thing you build, and its cost is not hidden.

**And it is charged and timed by the token**, with a critical asymmetry between the two halves of a request:

\`\`\`
PREFILL   the whole prompt is processed in parallel
          → time grows with input length, but sub-linearly
          → this is what you wait for before the first token

DECODE    tokens are produced one at a time, each depending
          on the last
          → time grows LINEARLY with output length
          → and it cannot be parallelised
\`\`\`

**So latency has two terms with different drivers**, and confusing them is why people optimise the wrong thing:

\`\`\`
time to first token ≈ f(input size)
total time          ≈ time to first token
                       + output tokens × time per token
\`\`\`

**A 10,000-token prompt producing 50 tokens is fast. A 500-token prompt producing 2,000 tokens is slow.** The bill often runs the other way, because output tokens are typically priced several times higher than input ones.

Then the consequence of statelessness that surprises people, and it is arithmetic rather than opinion:

\`\`\`
Turn 1: send 500 tokens
Turn 2: send 500 + reply + new message
Turn 10: send everything again
→ a 20-turn conversation sends the early turns twenty times
→ total tokens grow with the SQUARE of the turn count
\`\`\`

**A conversation is quadratic in cost unless you do something about it.** Which is why prefix caching and compaction are architectural decisions rather than optimisations.

**And the application's actual job is assembling the context**: a system prompt, tool definitions, retrieved documents, conversation history, and the user's message. **The model is a function of that window and nothing else** — so every quality problem is either a context problem or a model problem, and it is usually the first.`,
    analogyLimit:
      '"It is an API call that returns text" is the framing that makes cost and latency mysterious. An ordinary API has a response time roughly independent of the response size, and a price per call; here the time scales with how much text comes back and the price differs between what you send and what you receive. The framing also hides statelessness, which is where the quadratic conversation cost comes from — and that cost is invisible until a long chat is ten times the price of a short one.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds a chat assistant: every turn sends the full history plus a 4,000-token system prompt with company policies; retrieved documents are appended after the user\'s message; responses are returned only when complete; and they measure success by average response time, which is 6 seconds. Identify four problems and rank them.',
      answer: `**Problem 1 — the full history every turn, which makes cost quadratic in conversation length.**

\`\`\`
System prompt: 4,000 tokens, resent every turn
Turn 20 of a conversation with 300-token turns:
  4,000 + 19 × 300 ≈ 9,700 input tokens
Total across 20 turns:
  20 × 4,000 (system) + Σ history ≈ 80,000 + 57,000
  ≈ 137,000 input tokens for a conversation whose unique
  content is about 6,000
\`\`\`

**Twenty-three times the unique content**, and the system prompt alone accounts for more than half of it.

*Two fixes, and the first is nearly free:* **prefix caching**, because the system prompt is byte-identical every turn and a cached prefix is both cheaper and faster to prefill. **And compaction** — replacing old turns with a summary once the history passes a threshold, which bounds the growth.

**Problem 2 — documents appended after the user message, which breaks caching and lands in the worst position.**

**The cache is a prefix cache.** It matches from the start of the prompt until the first difference, **so anything variable placed early invalidates everything after it.** Retrieved documents change every turn, so putting them before the history would destroy the cache — **and putting them last is correct for caching and wrong for attention.**

\`\`\`
Stable → variable is the caching rule:
  system prompt · tool definitions   (stable — cached)
  conversation history               (grows at the end)
  retrieved documents                (per-turn)
  user message                       (per-turn)
\`\`\`

**And the position effect means material in the middle of a long context is used less reliably than material at either end** — so a long history sandwiching the documents is the worst arrangement available. **The tension between cache stability and attention position is real**, and the usual resolution is to keep documents near the end, just before the user's message.

**Problem 3 — no streaming, so the user waits for the whole response.**

**Time to first token is a few hundred milliseconds; the full response takes six seconds.** Without streaming the user experiences six seconds of nothing; with it they experience a few hundred milliseconds and then text arriving faster than they read.

**The perceived latency difference is roughly tenfold, for no change in total time** — which makes streaming the highest-leverage change on this list.

**Problem 4 — average response time is the wrong metric, and it hides the actual distribution.**

\`\`\`
"6 seconds average" is compatible with:
  · every response taking 6 s
  · most taking 2 s and a tail taking 30 s
→ and the two need completely different fixes
\`\`\`

**The right instrumentation splits the request:**

\`\`\`
time to first token       ← what the user feels
tokens per second         ← the decode rate
output token count        ← what actually drives total time
retrieval time            ← usually a small fraction
\`\`\`

**And total time is largely a function of output length**, so "responses are slow" is often "responses are long" — **a prompt change, not an infrastructure one.**

**Ranking. Problem 3 is the biggest user-visible win** and the cheapest to make. **Problem 1 is the biggest cost win** and grows worse as the product succeeds. Problem 2 compounds both. Problem 4 is why nobody has noticed the other three.

**The transferable diagnostic: separate input-driven costs from output-driven ones.** Latency is dominated by output length; **cost is dominated by input size in a chat application and by output size in a generation one** — and the same request can be cheap and slow, or expensive and fast.`,
    },
  body: `## The lifecycle, and where the time goes

\`\`\`
1. Assemble context          application — 1–20 ms
2. Retrieve (if RAG)         50–300 ms
3. Serialise and send        network, 10–50 ms
4. Prefill                   parallel over the prompt
                             ~100–600 ms for a few thousand tokens
5. Decode                    sequential, ~10–50 ms per token
6. Stream back               overlapped with decode
\`\`\`

**Two observations that change how you prioritise.**

**Generation dominates everything else by an order of magnitude.** A 500-token response at 20 ms per token is 10 seconds; **retrieval at 200 ms is 2% of that.** Halving retrieval time saves 1% of the request — **so a RAG application with a slow feel almost never has a retrieval problem.**

**And prefill is sub-linear while decode is linear.** Doubling the prompt might add 40% to time-to-first-token; **doubling the response doubles the total time.** Which is why a long prompt with a short answer is a good shape and the reverse is not.

## The two costs, which move independently

\`\`\`
COST      input tokens × input price
        + output tokens × output price
        (output is typically several times the input price)

LATENCY   ≈ prefill(input) + output_tokens × per_token
\`\`\`

**So four combinations, and they need different fixes:**

\`\`\`
Large input,  short output   cheap-ish, fast      ← good shape
Large input,  long output    expensive, slow
Small input,  long output    surprisingly costly, slow
Small input,  short output   trivial
\`\`\`

**A RAG answer is the first shape** — a big context, a short answer — **which is why RAG is usually affordable.** A document-generation feature is the third, **which is why it is often the most expensive thing in a product despite short prompts.**

*And the lever differs:* **input cost is attacked by caching and retrieval precision; output cost is attacked by asking for less.** "Answer in under 100 words" is a cost control, not a style preference.

## Statelessness, and the quadratic

**The model holds nothing between calls**, so a conversation is the application replaying history.

\`\`\`
Turn n sends: system + (n−1) prior turns + the new message
Total over N turns ≈ N × system + (N² / 2) × turn_size
\`\`\`

**The quadratic term is the one that surprises**, and it means a 40-turn conversation is not twice a 20-turn one — **it is roughly four times.**

**Three mitigations, and they compose.**

**Prefix caching.** The system prompt and tool definitions are identical every turn, **so a cache serves them at a fraction of the cost and prefills faster.** The constraint it imposes: **stable content must come first and must be byte-identical**, which is why a timestamp in the system prompt is an expensive mistake.

**Compaction.** Once history passes a threshold, replace the oldest turns with a summary. **Bounded context, at the cost of losing detail** — and the decision of what to keep verbatim (the user's stated constraints, the current task) versus summarise is a design choice rather than a generic algorithm.

**And retrieval instead of history.** Rather than carrying everything forward, **store the conversation and retrieve the relevant parts** — which turns a linear-growing context into a bounded one, and is the point where a chat application becomes a RAG application.

## Context assembly is the application

**The window is the only input the model has**, so assembling it is where the application's judgment lives.

\`\`\`
┌─ system prompt        stable, cached
├─ tool definitions     stable, cached
├─ conversation history grows; compacted past a threshold
├─ retrieved documents  per-turn, relevance-ordered
└─ user message         last
\`\`\`

**Three decisions in that ordering.**

**Stable before variable**, for the cache. Anything that changes invalidates everything after it, **so a per-request timestamp or a user id at the top costs the entire cache.**

**Documents near the end, before the user message.** The position effect means the middle of a long context is used least reliably; **the end is the strongest position, and the user's message must be last for the model to treat it as the instruction.**

**And a budget per section**, decided in advance: how many tokens for history, how many for documents. **Without one, a long conversation silently squeezes out retrieved context** and the answer quality drops for a reason nobody can see.

*The failure this prevents:* a request that exceeds the context window because history grew. **That is not an edge case — it is the normal end state of any long conversation without a budget.**

## Streaming

**Streaming changes the number the user experiences**, which is time-to-first-token rather than total time.

\`\`\`
Non-streaming: 6 s of nothing, then everything
Streaming:     0.4 s, then text faster than reading speed
\`\`\`

**Same total time, roughly a tenfold difference in perceived latency** — which makes it the highest-leverage change available in most LLM applications.

**And it changes failure handling in a way that is easy to miss.**

\`\`\`
A non-streamed request fails → nothing was shown → retry cleanly
A streamed request fails at token 300 → the user has read
  300 tokens of an answer that will not be completed
→ retrying produces a different answer, which contradicts
  what they already read
\`\`\`

**So a streaming application needs a partial-failure story**: finish the sentence and mark it incomplete, or replace the whole response and say so. **Silently restarting is the option that confuses people.**

*And a second consequence:* **validation cannot happen after generation if you have already emitted it.** A guardrail that checks the finished response is incompatible with streaming it — **which is why output checks in streaming systems either run on chunks or accept that they are advisory.**

## Where quality problems actually come from

**A wrong answer has three possible causes, and they need different investigations.**

\`\`\`
1. The information was not in the context
   → a retrieval problem, or a context-budget problem
2. The information was in the context and was not used
   → a position problem, a prompt problem, or a
     context-length problem
3. The information was in the context, was used, and the
   model was still wrong
   → a model problem
\`\`\`

**Most production failures are the first**, and the second is far more common than teams expect — **which is why the position effect is worth measuring rather than assuming.**

*The diagnostic:* **put the answer in the context deliberately and re-run.** If it is still wrong, the problem is downstream of retrieval; **if it becomes right, you have a retrieval problem wearing a generation costume.**

## Instrumentation that makes any of this visible

\`\`\`
Per request:
  input tokens, output tokens, cached tokens
  time to first token
  tokens per second
  retrieval time (if applicable)
  total time
  model, and prompt version
\`\`\`

**Four things to measure that most applications do not.**

**Cached versus uncached input tokens.** The cache hit rate is the number that tells you whether the prompt ordering is working, **and a change that silently breaks the cache shows up here before it shows up in the bill.**

**Output token distribution.** Total time is mostly output length, **so a latency regression is usually a length regression** — and that is a prompt change, not a capacity problem.

**Time to first token separately from total.** They have different causes and different fixes.

**And the prompt version on every request.** Prompts change, behaviour changes with them, **and without a version there is nothing to correlate a quality regression against.**

## What to say in a design discussion

**That the model is stateless, so conversation cost is quadratic without compaction or caching.**

**That prefill is parallel and decode is sequential**, so latency is driven by output length and time-to-first-token by input length.

**That context assembly is the application's real job**, with a budget per section decided in advance.

**That stable content comes first for the cache and important content comes last for attention**, and that these pull against each other.

**That streaming changes the perceived latency by roughly an order of magnitude** and creates a partial-failure case.

**And that most quality failures are context failures**, diagnosable by putting the answer in the context and re-running.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'lifecycle',
      title: 'One request, and where the time and money actually go',
      caption:
        'Step through it. Generation dominates everything else by an order of magnitude, which is why a RAG application that feels slow almost never has a retrieval problem.',
      nodes: [
        { id: 'assemble', label: 'Assemble context (1–20 ms)', kind: 'service', x: 0, y: 150, detail: 'The application\'s real job. A system prompt, tool definitions, history, retrieved documents and the user message — with a token budget per section decided in advance, or a long conversation silently squeezes out the retrieved context.' },
        { id: 'retrieve', label: 'Retrieve (50–300 ms)', kind: 'store', x: 230, y: 40, detail: 'Measured in milliseconds next to a generation step measured in seconds. Halving it saves about 1% of the request — which is why optimising retrieval for latency is almost always the wrong target.' },
        { id: 'prefill', label: 'Prefill — parallel (100–600 ms)', kind: 'service', x: 470, y: 150, detail: 'The whole prompt is processed at once, so time grows sub-linearly with input length. This is what you wait for before the first token, and it is what prefix caching makes faster as well as cheaper.' },
        { id: 'cache', label: 'Prefix cache: stable content first', kind: 'note', x: 470, y: 20, detail: 'The cache matches from the start until the first difference, so anything variable placed early invalidates everything after it. A timestamp or a user id at the top of the system prompt costs the entire cache — the single most expensive one-line mistake here.' },
        { id: 'decode', label: 'Decode — sequential (10–50 ms/token)', kind: 'service', x: 720, y: 150, detail: 'One token at a time, each depending on the last, and it cannot be parallelised. Total time is therefore roughly output length times per-token time — so "responses are slow" is usually "responses are long", which is a prompt change rather than an infrastructure one.' },
        { id: 'stream', label: 'Stream (overlapped)', kind: 'external', x: 960, y: 150, detail: 'Turns six seconds of nothing into 0.4 seconds and then text arriving faster than reading speed — roughly a tenfold difference in perceived latency for no change in total time.' },
        { id: 'partial', label: 'And a new failure case', kind: 'note', x: 960, y: 300, detail: 'A stream that fails at token 300 has already shown the user 300 tokens of an answer that will not be completed. Retrying produces a different answer that contradicts what they read, so a streaming application needs a stated partial-failure policy.' },
      ],
      edges: [
        { id: 'l1', source: 'assemble', target: 'retrieve', kind: 'read' },
        { id: 'l2', source: 'retrieve', target: 'prefill', kind: 'sync' },
        { id: 'l3', source: 'cache', target: 'prefill', kind: 'control' },
        { id: 'l4', source: 'prefill', target: 'decode', kind: 'sync' },
        { id: 'l5', source: 'decode', target: 'stream', kind: 'async' },
        { id: 'l6', source: 'stream', target: 'partial', kind: 'control' },
      ],
      steps: [
        {
          id: 'ls1',
          title: 'The application decides what the model sees',
          description:
            'The window is the only input. A budget per section — history, documents, tools — decided in advance is what stops a long conversation crowding out the retrieved context that makes the answer correct.',
          nodes: ['assemble', 'retrieve'],
          edges: ['l1'],
        },
        {
          id: 'ls2',
          title: 'Prefill is parallel, and caching makes it cheaper',
          description:
            'Input length grows time sub-linearly. Stable content first means the system prompt and tool definitions are served from the cache — which requires them to be byte-identical every turn.',
          nodes: ['prefill', 'cache'],
          edges: ['l2', 'l3'],
        },
        {
          id: 'ls3',
          title: 'Decode is sequential, and it dominates',
          description:
            'One token at a time, ten to fifty milliseconds each. Total time is output length times per-token time, which is why latency regressions are usually length regressions.',
          nodes: ['decode'],
          edges: ['l4'],
        },
        {
          id: 'ls4',
          title: 'Streaming changes the number users feel',
          description:
            'Time to first token rather than total time — about a tenfold perceived improvement for no change in the underlying work. The highest-leverage change available in most applications.',
          nodes: ['stream'],
          edges: ['l5'],
        },
        {
          id: 'ls5',
          title: 'And introduces a failure with no clean retry',
          description:
            'Half an answer has already been read. Finish and mark incomplete, or replace and say so — silently restarting is the option that confuses people.',
          nodes: ['partial'],
          edges: ['l6'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'quadratic',
      title: 'Why a conversation is quadratic, and the three things that fix it',
      caption:
        'Read the middle column as the arithmetic nobody does until the bill arrives. A forty-turn conversation is roughly four times a twenty-turn one, not twice.',
      code: `flowchart TB
    S["**The model is stateless.**<br/>It remembers nothing between calls,<br/>so a 'conversation' is the application<br/>resending the whole history."]

    S --> Q["**Turn n sends:**<br/>system + (n−1) prior turns + new message<br/><br/>Total over N turns ≈<br/>N × system + (N² / 2) × turn size"]

    Q --> E["**20 turns, 300-token turns,<br/>4,000-token system prompt:**<br/>≈ 137,000 input tokens<br/>for ~6,000 tokens of<br/>unique content<br/>**≈ 23× the content**"]

    E --> F1["**Prefix caching**<br/>system prompt and tools are<br/>byte-identical every turn →<br/>cheaper and faster to prefill.<br/>**Constraint:** stable content first,<br/>and no timestamps in it"]
    E --> F2["**Compaction**<br/>replace old turns with a summary<br/>past a threshold.<br/>**Cost:** lost detail — and what to<br/>keep verbatim is a design choice,<br/>not a generic algorithm"]
    E --> F3["**Retrieval instead of history**<br/>store the conversation and fetch<br/>the relevant parts.<br/>**Turns linear growth into a<br/>bounded context** — and is where<br/>a chat app becomes a RAG app"]

    F1 --> C["**They compose**, and without any<br/>of them a long conversation ends<br/>by exceeding the context window —<br/>which is the normal end state, not<br/>an edge case"]
    F2 --> C
    F3 --> C

    style E fill:#40181c,stroke:#b4535e
    style C fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The published prompt-caching documentation is the most useful reference here, because it turns a vague instinct about prompt structure into a hard constraint.

**The cache matches a prefix.** It is keyed on the content from the beginning of the prompt up to a cache breakpoint, **so the cached portion must be byte-identical between requests** — and anything that varies must come after everything that does not.

**Which makes prompt ordering a design decision with a measurable consequence.** A user identifier, a timestamp or a randomly ordered tool list placed in the system prompt **invalidates the cache on every request**, and the symptom is a bill several times higher than expected with no change in behaviour.

**And the documentation is explicit that caching improves latency as well as cost**, because a cached prefix does not need to be prefilled again. **So the same decision moves both numbers**, which is unusual and worth exploiting.

**Three transferable lessons.**

**Order the prompt from most stable to least.** System prompt, then tools, then history, then per-request material. **The rule is mechanical and it is frequently violated by putting "helpful" per-request context at the top.**

**Cache hit rate is an application metric.** It belongs on a dashboard next to latency and error rate, **because a refactor that reorders the prompt can silently multiply the cost** and nothing else will show it.

**And caching pulls against the position effect.** Stable-first is right for the cache; **most-important-last is right for attention** — and the usual resolution is that retrieved documents sit near the end, after history, just before the user's message. **Naming that tension is better than pretending one rule covers both.**

**Where the reference does not help.** It says nothing about what belongs in the window in the first place, which is the harder question — **a perfectly cached prompt full of irrelevant context is cheap and wrong.**`,
  },

  tradeoffs: {
    intro:
      'The decisions that shape an LLM application, most of which follow from statelessness and the prefill/decode asymmetry.',
    rows: [
      {
        option: 'Resending the full conversation every turn',
        whenItWins:
          'Short conversations, where the quadratic term never bites.',
        whenItLoses:
          'A 20-turn chat sends roughly 23 times its unique content, and a 40-turn one costs about four times a 20-turn one.',
        cost:
          'Cost growing with the square of the turn count.',
      },
      {
        option: 'Prefix caching with stable content first',
        whenItWins:
          'Almost always. It reduces both cost and time-to-first-token with one change.',
        whenItLoses:
          'It constrains prompt ordering, and anything variable placed early destroys it.',
        cost:
          'A rule the whole team must follow, plus a hit-rate metric to catch violations.',
      },
      {
        option: 'Compacting history past a threshold',
        whenItWins:
          'Long conversations, where it bounds the context.',
        whenItLoses:
          'Detail is lost, and what to keep verbatim is a judgment rather than an algorithm.',
        cost:
          'Occasional loss of a constraint the user stated twenty turns ago.',
      },
      {
        option: 'Retrieving from conversation history instead of carrying it',
        whenItWins:
          'Very long-running conversations — it turns linear growth into a bounded context.',
        whenItLoses:
          'It adds a retrieval step and its failure modes to every turn.',
        cost:
          'The chat application becomes a RAG application.',
      },
      {
        option: 'Optimising retrieval latency',
        whenItWins:
          'When retrieval is genuinely slow in absolute terms — seconds, not milliseconds.',
        whenItLoses:
          'At 200 ms against a 10-second generation, halving it saves about 1% of the request.',
        cost:
          'Engineering spent where the time is not.',
      },
      {
        option: 'Reducing output length',
        whenItWins:
          'The most direct lever on both latency and cost, since decode is sequential and output tokens are priced highest.',
        whenItLoses:
          'Shorter answers may be less useful, so it is a product decision.',
        cost:
          'Answer completeness, traded deliberately.',
      },
      {
        option: 'Returning the complete response',
        whenItWins:
          'When the output must be validated or transformed before the user sees any of it.',
        whenItLoses:
          'The user waits the full generation time with no feedback — about ten times the perceived latency.',
        cost:
          'The single largest user-visible regression available.',
      },
      {
        option: 'Streaming',
        whenItWins:
          'Almost always for user-facing text. Same total time, roughly a tenfold perceived improvement.',
        whenItLoses:
          'Output validation must run on chunks or be advisory, and a mid-stream failure has no clean retry.',
        cost:
          'A stated partial-failure policy.',
      },
      {
        option: 'Documents at the top of the prompt',
        whenItWins:
          'Nowhere. It feels like giving the model the material first.',
        whenItLoses:
          'It invalidates the cache for everything after it, and the middle of a long context is the weakest position.',
        cost:
          'Cache hit rate and answer reliability at once.',
      },
      {
        option: 'Documents near the end, before the user message',
        whenItWins:
          'The usual resolution of the caching-versus-position tension.',
        whenItLoses:
          'Very long histories still push documents into a weaker position.',
        cost:
          'A history budget, so documents are not crowded out.',
      },
      {
        option: 'Average response time as the metric',
        whenItWins:
          'Nowhere. It is the default dashboard.',
        whenItLoses:
          'It cannot distinguish a uniform six seconds from a two-second median with a thirty-second tail, and hides that total time is mostly output length.',
        cost:
          'Optimising a number that does not decompose.',
      },
      {
        option: 'Per-request token and timing breakdown',
        whenItWins:
          'Always. Cached tokens, output length, time-to-first-token and total, with a prompt version.',
        whenItLoses:
          'More fields to record.',
        cost:
          'Negligible, and it is what makes every other decision measurable.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Each turn we send the conversation history so the model has context."',
      whyWeak:
        'It is correct and it omits the arithmetic. Because the model is stateless, turn twenty resends the first nineteen turns, so total tokens grow with the square of the conversation length — a forty-turn chat costs about four times a twenty-turn one, and the system prompt alone may be more than half the bill.',
      strongAnswer:
        '"The model is stateless, so a conversation is the application replaying history — which makes cost quadratic in turn count. Three things fix it and they compose: prefix caching, since the system prompt and tool definitions are byte-identical every turn and a cached prefix is both cheaper and faster to prefill; compaction, replacing old turns with a summary past a threshold; and for very long sessions, retrieving from the stored conversation rather than carrying it, which turns linear growth into a bounded context."',
    },
    {
      weakAnswer: '"We put the user\'s ID and the current timestamp at the top of the system prompt for context."',
      whyWeak:
        'The cache matches a prefix from the start of the prompt, so anything variable placed early invalidates everything after it. A per-request timestamp at the top costs the entire cache on every request, and the symptom is a bill several times higher with no behavioural change.',
      strongAnswer:
        '"Prompt order runs from most stable to least: system prompt, tool definitions, history, retrieved documents, then the user message. Anything per-request goes after everything that does not change, and the system prompt must be byte-identical every turn. I would put cache hit rate on the dashboard next to latency, because a refactor that reorders the prompt can silently multiply the cost and nothing else surfaces it."',
    },
    {
      weakAnswer: '"Responses take six seconds, so we are optimising the retrieval step."',
      whyWeak:
        'Retrieval is 50–300 milliseconds against a generation step measured in seconds. Halving it saves about 1% of the request, so the engineering is being spent where the time is not.',
      strongAnswer:
        '"Total time is roughly time-to-first-token plus output tokens times per-token time, and decode is sequential — so six seconds of response is mostly output length. The fixes in order are: stream, which changes the number users feel by about tenfold for no change in total time; then reduce output length, which is a prompt change; then reduce input size, which affects time-to-first-token. Retrieval is worth optimising only when it is slow in absolute terms."',
    },
    {
      weakAnswer: '"We measure average response time, which is 6 seconds."',
      whyWeak:
        'An average is compatible with every response taking six seconds and with a two-second median plus a thirty-second tail, and those need different fixes. It also hides the fact that total time is mostly a function of output length rather than of the system.',
      strongAnswer:
        '"I would record per request: input tokens, output tokens, cached tokens, time to first token, tokens per second, retrieval time and the prompt version. Time to first token is what users feel and has a different cause from total time. Output token distribution is the one that explains latency regressions — they are usually length regressions. And cached versus uncached input tokens is the metric that catches a broken prompt ordering before the bill does."',
    },
    {
      weakAnswer: '"We validate the model\'s output before returning it, so bad responses never reach the user."',
      whyWeak:
        'That is incompatible with streaming, and streaming is the largest perceived-latency improvement available. Holding the whole response to validate it means the user waits the full generation time with no feedback.',
      strongAnswer:
        '"There is a genuine tension: output validation after generation and streaming cannot both hold. I would stream and run checks on chunks where possible, accepting that some checks become advisory — and be explicit about which. And streaming creates a failure case worth designing for: a stream that fails at token 300 has already shown the user an answer that will not be completed, so the policy is to finish and mark it incomplete, or replace it and say so. Silently restarting is what confuses people."',
    },
    {
      weakAnswer: '"The answer was wrong, so we need a better model."',
      whyWeak:
        'It skips the two more likely explanations. A wrong answer usually means the information was not in the context, or was in the context and not used — and both are application problems rather than model problems.',
      strongAnswer:
        '"Three causes, and I would separate them before changing anything. Put the correct information into the context deliberately and re-run: if the answer becomes right, it is a retrieval or context-budget problem; if it stays wrong, the information is there and not being used, which points at position — the middle of a long context is the least reliable place — or at the prompt. Only after both are excluded is it a model problem. Most production failures are the first, and the second is more common than teams expect."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lla-1',
      front: 'What two facts about the model determine the application\'s shape?',
      back: 'It is stateless — so conversation history is resent every turn — and it is charged and timed by the token, with prefill and decode behaving completely differently.',
      topic: 'lifecycle',
    },
    {
      id: 'fc-lla-2',
      front: 'How do prefill and decode differ?',
      back: 'Prefill processes the whole prompt in parallel, so time grows sub-linearly with input. Decode produces tokens one at a time, so time grows linearly with output.',
      topic: 'latency',
    },
    {
      id: 'fc-lla-3',
      front: 'What drives time-to-first-token, and what drives total time?',
      back: 'Time to first token is driven by input size; total time is dominated by output length times per-token time.',
      topic: 'latency',
    },
    {
      id: 'fc-lla-4',
      front: 'Why is a conversation quadratic in cost?',
      back: 'Turn n resends the previous n−1 turns, so total tokens grow with the square of the turn count — a 40-turn chat is about four times a 20-turn one.',
      topic: 'cost',
    },
    {
      id: 'fc-lla-5',
      front: 'What three mitigations bound conversation cost?',
      back: 'Prefix caching, compaction of old turns into a summary, and retrieving from stored history instead of carrying it. They compose.',
      topic: 'cost',
    },
    {
      id: 'fc-lla-6',
      front: 'What does prefix caching require of the prompt?',
      back: 'Stable content first and byte-identical between requests — so a timestamp or user id at the top invalidates the whole cache.',
      topic: 'context',
    },
    {
      id: 'fc-lla-7',
      front: 'What is the tension between caching and the position effect?',
      back: 'Caching wants stable content first; attention wants important content last. The usual resolution is documents near the end, just before the user message.',
      topic: 'context',
    },
    {
      id: 'fc-lla-8',
      front: 'Why does each context section need a token budget?',
      back: 'Without one, a growing conversation silently squeezes out retrieved documents, and answer quality drops for a reason nobody can see.',
      topic: 'context',
    },
    {
      id: 'fc-lla-9',
      front: 'Which request shape is cheap and which is expensive?',
      back: 'Large input with short output is the good shape — typical RAG. Small input with long output is surprisingly costly, since output tokens are priced highest.',
      topic: 'cost',
    },
    {
      id: 'fc-lla-10',
      front: 'Why is optimising retrieval latency usually the wrong target?',
      back: 'Retrieval is 50–300 ms against a generation step of seconds, so halving it saves about 1% of the request.',
      topic: 'latency',
    },
    {
      id: 'fc-lla-11',
      front: 'What does streaming change?',
      back: 'The number users feel becomes time-to-first-token rather than total time — roughly a tenfold perceived improvement with no change in total work.',
      topic: 'streaming',
    },
    {
      id: 'fc-lla-12',
      front: 'What new failure case does streaming create?',
      back: 'A failure mid-stream has already shown part of an answer that will not be completed, and retrying produces a different answer that contradicts what was read.',
      topic: 'streaming',
    },
    {
      id: 'fc-lla-13',
      front: 'What are the three causes of a wrong answer?',
      back: 'The information was not in the context; it was there and not used; or it was there, used, and the model was still wrong. Most failures are the first.',
      topic: 'context',
    },
    {
      id: 'fc-lla-14',
      front: 'How do you tell a retrieval failure from a generation failure?',
      back: 'Put the correct information into the context deliberately and re-run. Still wrong means it is downstream of retrieval; now right means retrieval was the problem.',
      topic: 'context',
    },
  ],

  quiz: [
    {
      id: 'q-lla-1',
      kind: 'scenario',
      prompt:
        'Request A sends 10,000 input tokens and produces 50 output tokens. Request B sends 500 and produces 2,000. Which is slower, and why?',
      options: [
        { id: 'a', label: 'B — decode is sequential, so total time is dominated by output length, while prefill over a large input is parallel and sub-linear' },
        { id: 'b', label: 'A, because it processes twenty times more tokens' },
        { id: 'c', label: 'They are similar, since total tokens are comparable' },
        { id: 'd', label: 'A, because time-to-first-token dominates total time' },
      ],
      correct: ['a'],
      explanation:
        'Two thousand tokens at 10–50 ms each is 20–100 seconds of decode; a 10,000-token prefill is a few hundred milliseconds. Option d has the relationship backwards: time-to-first-token is what a user feels first, and it is usually a small fraction of the total.',
      difficulty: 'core',
      topic: 'latency',
    },
    {
      id: 'q-lla-2',
      kind: 'scenario',
      prompt:
        'A team adds the current timestamp to the top of their system prompt. What happens?',
      options: [
        { id: 'a', label: 'The prefix cache is invalidated on every request, multiplying cost and increasing time-to-first-token' },
        { id: 'b', label: 'Nothing — the timestamp is a few tokens' },
        { id: 'c', label: 'Only the timestamp portion is re-processed' },
        { id: 'd', label: 'The model becomes more accurate about dates, at negligible cost' },
      ],
      correct: ['a'],
      explanation:
        'The cache matches from the start of the prompt until the first difference, so a variable value at the top means nothing after it can be cached. It is a few tokens of content and the entire prompt\'s worth of cost — which is why prompt ordering is a design rule and cache hit rate belongs on a dashboard.',
      difficulty: 'core',
      topic: 'context',
    },
    {
      id: 'q-lla-3',
      kind: 'scenario',
      prompt:
        'A 20-turn conversation with 300-token turns and a 4,000-token system prompt sends roughly how many input tokens in total?',
      options: [
        { id: 'a', label: 'Around 137,000 — because each turn resends the system prompt and all prior turns' },
        { id: 'b', label: 'Around 10,000 — the unique content' },
        { id: 'c', label: 'Around 24,000 — the system prompt plus all turns once' },
        { id: 'd', label: 'It depends on the model, not the conversation' },
      ],
      correct: ['a'],
      explanation:
        'Twenty resends of a 4,000-token system prompt is 80,000 on its own, plus the growing history — roughly 23 times the unique content. This is the arithmetic that makes prefix caching and compaction architectural decisions rather than optimisations.',
      difficulty: 'advanced',
      topic: 'cost',
    },
    {
      id: 'q-lla-4',
      kind: 'scenario',
      prompt:
        'A RAG application takes 6 seconds per response. Retrieval takes 200 ms. What should be changed first?',
      options: [
        { id: 'a', label: 'Add streaming — same total time, roughly a tenfold improvement in what the user experiences' },
        { id: 'b', label: 'Optimise retrieval, since it is on the critical path' },
        { id: 'c', label: 'Use a larger context window' },
        { id: 'd', label: 'Move to a faster network' },
      ],
      correct: ['a'],
      explanation:
        'Retrieval is about 3% of the request, so halving it saves under 2%. Streaming changes the perceived latency from six seconds of nothing to a few hundred milliseconds and then text — and after that, the real lever on total time is output length, which is a prompt change.',
      difficulty: 'core',
      topic: 'streaming',
    },
    {
      id: 'q-lla-5',
      kind: 'scenario',
      prompt:
        'An assistant gives a wrong answer. The retrieved document containing the correct answer was in the context. What does that tell you?',
      options: [
        { id: 'a', label: 'It is not a retrieval problem — look at position in a long context, the prompt, and only then the model' },
        { id: 'b', label: 'The model is not good enough and should be upgraded' },
        { id: 'c', label: 'The retrieval scoring must be wrong' },
        { id: 'd', label: 'The document must have been truncated' },
      ],
      correct: ['a'],
      explanation:
        'Information present but unused is more common than teams expect, and the position effect is the usual cause: the middle of a long context is the least reliable place. Reaching for a model upgrade first skips the two cheaper and more likely explanations.',
      difficulty: 'advanced',
      topic: 'context',
    },
    {
      id: 'q-lla-6',
      kind: 'multi',
      prompt:
        'Which of these should be recorded per request in an LLM application? Select all that apply.',
      options: [
        { id: 'a', label: 'Cached versus uncached input tokens' },
        { id: 'b', label: 'Output token count' },
        { id: 'c', label: 'Time to first token, separately from total time' },
        { id: 'd', label: 'The prompt version' },
      ],
      correct: ['a', 'b', 'c', 'd'],
      explanation:
        'All four. Cache hit rate catches a broken prompt ordering before the bill does; output length explains most latency regressions; time-to-first-token has a different cause from total time; and without a prompt version there is nothing to correlate a quality regression against.',
      difficulty: 'core',
      topic: 'lifecycle',
    },
  ],

  exercises: [
    {
      id: 'ex-lla-1',
      kind: 'estimate',
      title: 'Price and time a real assistant, then find the lever',
      estimatedMinutes: 40,
      prompt: `A support assistant handles 50,000 conversations a day. A typical conversation is 8 turns. Each turn: a 3,000-token system prompt with tool definitions, 6 retrieved documents of 400 tokens each, conversation history, a 120-token user message, and a 250-token response.

Assume input at $3 per million tokens, output at $15 per million, cached input at $0.30 per million, prefill ~300 ms for 5,000 tokens, decode at 25 ms per token.

**Part 1.** Compute input and output tokens for one conversation, and the daily cost. Show the split between system prompt, documents, history and output.

**Part 2.** Compute per-turn latency and identify what dominates it.

**Part 3.** Apply three changes and quantify each: prefix caching of the system prompt and tools; compacting history after turn 4; reducing the response to 150 tokens.

**Part 4.** Rank the three by cost saving and by latency saving, and say which you would do first and why they differ.

Then answer:

- Which single number in the input would you most want to verify before trusting this?
- What would change if conversations averaged 30 turns rather than 8?`,
      rubric: [
        'Per-turn input computed including the growing history.',
        'Conversation totals summed correctly across 8 turns.',
        'Daily cost computed with input and output priced separately.',
        'Split by component identified, with the dominant one named.',
        'Latency decomposed into prefill and decode with decode dominant.',
        'Each of the three changes quantified separately.',
        'Rankings differ between cost and latency, with the reason stated.',
        'Names a specific input to verify and says what it decides.',
        'Correctly identifies the quadratic effect at 30 turns.',
      ],
      modelAnswer: `**Part 1 — tokens and cost per conversation**

**Per-turn fixed input:**

\`\`\`
system prompt + tools:        3,000
6 documents × 400:            2,400
user message:                   120
                            = 5,520 before history
\`\`\`

**History grows by (previous user message + previous response) each turn:**

\`\`\`
per prior turn ≈ 120 + 250 = 370 tokens

Turn 1:  5,520 +   0      =  5,520
Turn 2:  5,520 +   370    =  5,890
Turn 3:  5,520 +   740    =  6,260
Turn 4:  5,520 + 1,110    =  6,630
Turn 5:  5,520 + 1,480    =  7,000
Turn 6:  5,520 + 1,850    =  7,370
Turn 7:  5,520 + 2,220    =  7,740
Turn 8:  5,520 + 2,590    =  8,110
                          ─────────
Input total:                54,520 tokens
Output total: 8 × 250     =  2,000 tokens
\`\`\`

**Cost per conversation:**

\`\`\`
input:  54,520 / 1e6 × $3   = $0.1636
output:  2,000 / 1e6 × $15  = $0.0300
                            ─────────
                              $0.1936  ≈ 19.4 cents
\`\`\`

**Daily: 50,000 × $0.1936 ≈ $9,680.** About **$3.5 million a year**, which is the number that makes this worth an hour of arithmetic.

**The split, which is the interesting part:**

\`\`\`
System prompt + tools:  8 × 3,000 = 24,000  (44% of input)
Retrieved documents:    8 × 2,400 = 19,200  (35%)
History:                            10,360  (19%)
User messages:                         960   (2%)
                                   ───────
                                    54,520

By COST:
  system prompt:   $0.072   37%
  documents:       $0.058   30%
  history:         $0.031   16%
  output:          $0.030   15%
\`\`\`

**The system prompt is the single largest line**, and it is the same 3,000 tokens eight times — **which is the first thing to notice and the cheapest to fix.**

---

**Part 2 — latency per turn**

\`\`\`
Prefill:  ~300 ms per 5,000 tokens, sub-linear
          turn 1 (5,520):  ~320 ms
          turn 8 (8,110):  ~430 ms
Decode:   250 tokens × 25 ms = 6,250 ms
Retrieval:                     ~200 ms (assumed)
Network:                        ~50 ms
                              ────────
Total (turn 8): 430 + 6,250 + 200 + 50 ≈ 6.9 s
\`\`\`

**Decode is 90% of the request.** Prefill is 6%, retrieval 3%, network under 1%.

**And the user-facing number is different again:**

\`\`\`
Time to first token = network + retrieval + prefill
                    ≈ 50 + 200 + 430 = 680 ms
\`\`\`

**So with streaming the user waits 0.7 seconds and then reads at about 40 tokens per second** — faster than reading speed. **Without streaming they wait 6.9 seconds.**

*The conclusion before any change:* **output length is the latency story and the system prompt is the cost story**, and they are different levers.

---

**Part 3 — three changes, quantified**

**(a) Prefix caching of the system prompt and tools (3,000 tokens).**

The system prompt and tool definitions are identical every turn, **so turns 2–8 read them from cache** (turn 1 writes it).

\`\`\`
Before: 24,000 tokens at $3/M          = $0.0720
After:   3,000 at $3/M (turn 1 write)  = $0.0090
       + 21,000 at $0.30/M (cached)    = $0.0063
                                       ─────────
                                         $0.0153
Saving: $0.057 per conversation — 29% of total cost
Daily:  ≈ $2,850
\`\`\`

**And a latency saving too:** cached tokens are not re-prefilled, so **prefill drops by roughly the 3,000-token share** — perhaps 120 ms off time-to-first-token. **About 18% of TTFT and under 2% of total time.**

*Note this assumes documents come after the system prompt.* **If documents were placed first, the cache would never hit** — which is the ordering rule earning its keep.

**(b) Compacting history after turn 4.**

Replace turns 1–3 with a ~150-token summary from turn 5 onward.

\`\`\`
Before (history totals):           10,360 tokens
After:  turns 5–8 carry 150 + recent turns instead of
        1,480 / 1,850 / 2,220 / 2,590
        ≈ 150+370, 150+740, 150+1,110, 150+1,480
        = 520 + 890 + 1,260 + 1,630 = 4,300
        plus turns 1–4 unchanged: 0+370+740+1,110 = 2,220
                                                  ───────
                                                    6,520
Saving: 3,840 tokens × $3/M = $0.0115 per conversation — 6%
Daily:  ≈ $575
\`\`\`

**Small at 8 turns**, and Part 4's closing question shows why that changes.

**(c) Reducing the response from 250 to 150 tokens.**

\`\`\`
Output cost: 2,000 → 1,200 tokens
  $0.0300 → $0.0180        saving $0.012 — 6% of cost
History shrinks too: prior responses are 100 tokens smaller
  history 10,360 → ~7,560  saving $0.0084 — 4%
                           ─────────────────
Total cost saving ≈ $0.020 — 10%

Latency: decode 6,250 ms → 3,750 ms
         total 6.9 s → 4.4 s        — 36% faster
\`\`\`

---

**Part 4 — two different rankings**

\`\`\`
BY COST SAVING                  BY LATENCY SAVING
1. caching      29%   $2,850/d  1. shorter output  36%
2. shorter out  10%   $1,000/d  2. caching          2%
3. compaction    6%     $575/d  3. compaction      ~1%
\`\`\`

**The rankings differ because cost is driven by input and latency by output**, which is the lesson's central asymmetry showing up as two different top answers.

**What I would do first: caching.**

**Three reasons.**

**It is the largest saving and it is free of product consequences.** Shortening responses is a product decision — **someone must agree that 150 tokens is enough** — whereas caching changes nothing a user sees.

**It is a one-time change with a permanent effect**, and it also improves TTFT slightly.

**And it is the change most likely to be silently undone.** A later refactor that inserts a per-request value into the system prompt destroys it, **so doing it early and putting cache hit rate on the dashboard protects it.**

*What I would do second depends on the goal:* **shorter output if users complain about speed** — 36% is a change they will feel — **and compaction if conversations are getting longer**, which is the next question.

---

**Which input would I most want to verify?**

**The average turn count, because everything scales non-linearly with it and it is the number most likely to be wrong.**

\`\`\`
Stated: 8 turns
If actually 12:  input per conversation ≈ 88,000 (+61%)
If actually 5:   input per conversation ≈ 30,000 (−45%)
\`\`\`

**Input tokens grow quadratically with turn count**, so a 50% error in this one number is a 60–100% error in the cost estimate — **far more sensitive than any of the token sizes**, which scale linearly.

**And it is likely to be wrong in a specific way: reported as a mean over a skewed distribution.** Most support conversations are 2–3 turns; **a minority run to 30**, and those dominate the cost while barely moving the mean. **So the right thing to verify is the distribution, not the average** — the same argument as every other tail in this course.

*The second number I would check:* **whether the six retrieved documents are actually used.** At 2,400 tokens per turn they are 30% of the cost, **and if four of six are never cited, retrieving three would save 15% of the bill** — which is the retrieval-precision lever rather than a caching one.

---

**What changes at 30 turns instead of 8?**

**The quadratic term takes over, and the rankings invert.**

\`\`\`
Per-turn fixed input:     5,520
History at turn n:        370 × (n−1)

Turn 30 input: 5,520 + 370 × 29 = 16,250 tokens
Conversation total input:
  30 × 5,520 + 370 × (29×30/2)
  = 165,600 + 160,950 = 326,550 tokens
  (vs 54,520 at 8 turns — six times as many for
   3.75× the turns)
\`\`\`

**History goes from 19% of input to 49%**, and it is now the largest component after the system prompt.

**Three consequences.**

**Compaction moves from third place to first.** Compacting after turn 4 would cut roughly 120,000 of those 161,000 history tokens — **a saving of around 37% of the conversation's cost**, against 6% at eight turns. **The same change, six times the value.**

**Caching stays valuable but its share falls.** 30 × 3,000 = 90,000 system-prompt tokens is 28% of input rather than 44%, **so the saving is larger in absolute terms and smaller as a proportion.**

**And the context window becomes a real constraint.** At 16,250 tokens on turn 30 and growing by 370 per turn, **a 30-turn conversation is approaching limits that a 60-turn one would exceed** — so compaction stops being a cost optimisation and becomes a correctness requirement.

*Which is the general point:* **the right optimisation depends on the conversation-length distribution, and that distribution is the input most worth measuring.** A product whose conversations are short should cache; **one whose conversations are long must compact** — and a product with both needs a threshold, which is exactly what "compact after turn N" is.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lla-1',
      level: 'basic',
      question: 'Walk me through what happens when your application calls a language model.',
      guidance:
        'Look for context assembly, prefill and decode as distinct phases, and streaming. A candidate who treats it as an opaque API call cannot reason about latency or cost.',
    },
    {
      id: 'iq-lla-2',
      level: 'basic',
      question: 'Where does the latency in an LLM application come from?',
      guidance:
        'Output length times per-token time, dominating everything else. Strong answers separate time-to-first-token from total time and note that retrieval is a small fraction.',
    },
    {
      id: 'iq-lla-3',
      level: 'intermediate',
      question: 'How does conversation cost scale with length?',
      guidance:
        'Quadratically, because the model is stateless and history is resent. Look for caching, compaction and retrieval-from-history as the three mitigations.',
    },
    {
      id: 'iq-lla-4',
      level: 'intermediate',
      question: 'How would you order the sections of a prompt?',
      guidance:
        'Stable to variable for the cache, with important material near the end for attention. Excellent answers name the tension between the two rules explicitly.',
    },
    {
      id: 'iq-lla-5',
      level: 'advanced',
      question: 'Your assistant gives a wrong answer. How do you investigate?',
      guidance:
        'Separate not-in-context from in-context-and-unused from model error, by putting the answer in the context deliberately and re-running.',
    },
    {
      id: 'iq-lla-6',
      level: 'advanced',
      question: 'What would you instrument on every request?',
      guidance:
        'Token counts including cached, time-to-first-token, total, output length, and the prompt version. Look for cache hit rate being treated as a first-class metric.',
    },
    {
      id: 'iq-lla-7',
      level: 'followup',
      question: 'Your bill tripled after a refactor with no behaviour change. What happened?',
      guidance:
        'Almost certainly a prompt reordering that broke the prefix cache — a per-request value moved above the stable content.',
    },
    {
      id: 'iq-lla-8',
      level: 'followup',
      question: 'What breaks when you add streaming?',
      guidance:
        'Post-generation validation, and the clean retry. A mid-stream failure has already shown part of an answer, so the partial-failure policy has to be stated.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lla-1',
      kind: 'what-changes-if',
      prompt:
        'Change the workload: instead of a chat assistant, this is a batch pipeline classifying ten million documents overnight, with no user waiting. What changes, and what stops mattering?',
      discussion: `**Almost every conclusion inverts, and tracing why is the point — because the chat design was shaped by a user waiting, and there is none.**

**What stops mattering entirely.**

**Time to first token.** Nobody is watching. **The metric that dominated the chat design has no meaning here.**

**Streaming.** It exists to make waiting tolerable; **a batch job does not wait.** And it would complicate the pipeline for nothing.

**And per-request latency.** What matters is throughput — **documents per hour** — which is a completely different quantity. A request that takes 10 seconds is irrelevant if a thousand run concurrently.

**What starts mattering.**

**Concurrency and rate limits become the binding constraint.** The question is no longer "how fast is one request" but **"how many can be in flight", which is a provider limit rather than a model property.** So the design gains a queue, a concurrency controller and a backoff strategy — **the rate-limiter lesson's machinery, on the client side.**

**Cost becomes nearly the only metric.** With no latency pressure, **every decision is "does this reduce tokens or reduce the number of calls".**

**And failure handling changes character.** A failed chat turn is retried by a user; **a failed document in a ten-million-document batch needs a dead-letter path, a retry budget and a reconciliation at the end** — which is the payments lesson's shape, applied to classification results.

**What changes direction, and these are the interesting ones.**

**Batching becomes available, and it is the largest lever.** Many providers price batch processing substantially below interactive rates for work that can complete within a window. **A chat application cannot use it; this one is the ideal case** — and it is a larger saving than any prompt optimisation.

**Model selection reverses.** A chat assistant picks a model partly for speed; **here a slower, cheaper model that runs overnight is strictly better** if quality holds. **The cost/latency/quality triangle collapses to cost/quality.**

**Caching changes shape.** Prefix caching helped because the system prompt repeated across turns; **here it repeats across ten million documents**, so the saving is larger — **but the cache has a lifetime**, and a batch spread over hours may not keep a prefix warm. **So the ordering matters differently: batch documents together in time to keep the prefix hot.**

*That is a genuinely new consideration:* **scheduling for cache locality**, which has no analogue in the chat case.

**And output length becomes a hard constraint rather than a preference.** A classification returning a label is 5 tokens; **one returning a paragraph of reasoning is 200.** At ten million documents that is the difference between 50 million and 2 billion output tokens — **so "answer with only the label" is worth a great deal**, and any chain-of-thought reasoning has to be justified against that number.

**What the arithmetic looks like.**

\`\`\`
10 M documents, 800 input tokens each, 10 output tokens
  input:  8 B tokens
  output: 100 M tokens
At $3/M input, $15/M output: $24,000 + $1,500 = $25,500
With a 50% batch discount:                      $12,750
With prefix caching of a 500-token instruction:
  5 B of the input cached at $0.30/M            saves ~$13,500
\`\`\`

**And the striking thing is the ratio: input is 94% of the cost.** In the chat case the split was closer; **here the document itself dominates, so the levers are batch pricing, caching, and — the biggest of all — whether the document needs to be sent in full.**

*Which suggests a lever with no chat analogue:* **filter before the model.** If a cheap heuristic can exclude 60% of documents as obviously irrelevant, **that is a 60% saving no prompt engineering can match** — and it is the cascade idea the next lesson develops.

**What I would build.**

\`\`\`
Keep:     context assembly discipline, token accounting,
          prefix caching (with time-locality scheduling)
Drop:     streaming, TTFT, per-request latency targets
Add:      a concurrency controller against provider limits,
          a durable queue with retry budgets and a
          dead-letter path, batch-API submission,
          a pre-model filter, and end-of-run reconciliation
Reverse:  model selection — slower and cheaper wins
\`\`\`

**The transferable point:** the LLM request lifecycle is the same in both cases, **and which parts of it you optimise is decided entirely by whether someone is waiting.** A design that carries chat instincts into a batch pipeline optimises time-to-first-token for nobody and leaves the batch discount on the table — **and the reverse mistake, treating a chat turn as a throughput problem, produces an application that is cheap and feels broken.**`,
    },
    {
      id: 'al-lla-2',
      kind: 'debug',
      prompt:
        'An assistant\'s monthly bill rose 4× over two weeks. Traffic is flat, the model has not changed, response quality is unchanged, and response lengths are unchanged. Diagnose it.',
      discussion: `**Flat traffic, same model, same output lengths, four times the cost** points squarely at input tokens — **and specifically at something that changed how they are counted rather than how many are sent.**

That is a short list.

**Hypothesis 1 — the prefix cache stopped hitting.**

A refactor that inserts anything per-request above the stable content **invalidates the cache for the whole prompt.**

\`\`\`
Before: 3,000-token system prompt cached at $0.30/M
After:  a user id added at the top
        → 3,000 tokens at $3/M, every request
        → 10× the price on that portion
\`\`\`

**With the system prompt at 40–45% of input cost, losing the cache on it is a 3–4× increase on that share alone** — and if tool definitions were cached too, the multiple reaches the reported figure easily.

*Why it fits every stated fact:* **traffic, model, quality and output lengths are all unchanged**, because the content is identical — **only its cacheability changed.** **This is my leading hypothesis** and it explains the magnitude precisely.

*Check:* the cached-token share of input over the two weeks. **If it fell from 70% to near zero, the diagnosis is done** — and the fix is reordering the prompt.

**Hypothesis 2 — conversations got longer.**

Cost is quadratic in turn count, **so an average rising from 8 turns to 16 roughly quadruples input tokens** with no change in traffic, quality or response length.

\`\`\`
8 turns:  ≈ 54,500 input tokens
16 turns: ≈ 172,000 input tokens   ← 3.2×
\`\`\`

*Why it fits:* **"traffic is flat" usually means conversation count**, not turn count — **so a product change that makes the assistant more engaging looks like flat traffic and costs four times as much.** And nobody would report it as a regression, because it is a success.

*Check:* the distribution of turns per conversation over the period. **A shift in the tail is enough** — the mean may barely move.

**Hypothesis 3 — retrieval started returning more or larger chunks.**

A change to chunk size, to \`k\`, or to a reranker threshold **increases the document portion of every request.**

\`\`\`
6 documents × 400 tokens = 2,400  (30% of input)
→ 10 documents × 800     = 8,000  (3.3× that section)
\`\`\`

*Why quality would be unchanged:* **more context often does not improve answers**, so the symptom is cost without benefit — **which is the worst kind because nothing flags it.**

*Check:* average retrieved tokens per request, and whether the retrieval configuration changed. **This is the hypothesis most likely to be an unnoticed default change** in a library upgrade.

**Hypothesis 4 — a retry storm inflating request count.**

If a transient failure mode began and the client retries, **each logical turn becomes two or three requests.** Traffic measured as user messages looks flat; **traffic measured as provider calls is not.**

*Check:* provider call count against user turn count. **A ratio above 1.0 is the whole diagnosis**, and it is the same metric the rate-limiter lesson recommended for a different symptom.

**Hypothesis 5 — a second feature sharing the same account.**

A new background job, an evaluation run, or a batch process **billed to the same key.** Traffic on the user-facing path is genuinely flat.

*Check:* cost broken down by feature or by prompt version. **If the request logs do not carry that dimension, this is undiagnosable** — which is itself the finding.

**What I would check first: the cached-token share of input, and the provider call count versus user turn count.** Two metrics, and between them they separate a caching regression, a retry storm and everything else. **Both should already exist; if they do not, that is the first fix.**

**Then: the turns-per-conversation distribution and the average retrieved tokens.** Hypotheses 2 and 3 are both "more input per turn" and are distinguished by which section grew.

**Why "quality is unchanged" is the most useful fact.**

It rules out anything that would have altered what the model sees in a way that matters. **A prompt rewrite, a model change or a retrieval improvement would all move quality**, up or down.

**So the content is effectively the same and the cost is not** — which means the change is in how that content is billed or how often it is sent. **That is caching, repetition, or request count**, and nothing else.

**The instrumentation this demands.**

**Cached versus uncached input tokens per request.** The single metric that would have caught this on day one, **and the one most applications do not record.** Cache hit rate belongs next to latency and error rate.

**Cost attributed by prompt version and by feature.** Without it, hypothesis 5 cannot be investigated at all — **and a shared API key with no attribution is a reporting gap rather than a technical one.**

**Tokens per request broken down by section**: system, tools, history, documents, user. **It turns "input grew" into "documents grew", which is a different investigation.**

**Provider calls per user turn.** Should be 1.0 plus a small retry rate, **and any drift is either retries or a change in the request pattern.**

**And a cost-per-conversation gauge rather than a monthly total.** A monthly bill aggregates over traffic changes, product changes and efficiency changes; **cost per conversation isolates efficiency** — and it would have shown a 4× step on the day the refactor shipped rather than at the end of the month.

**Transferable:** when cost changes and behaviour does not, **the content is the same and something about how it is sent or billed has changed.** The three candidates are always caching, repetition and request count — and all three are cheap to measure and almost never measured.`,
    },
  ],

  revision: {
    bullets: [
      'The model is stateless, so a conversation is the application resending history every turn.',
      'Prefill processes the prompt in parallel; decode produces tokens one at a time.',
      'Time to first token is driven by input size; total time by output length.',
      'A large input with a short output is the good shape; a small input with a long output is costly.',
      'Conversation cost is quadratic in turn count — 40 turns is about four times 20.',
      'Three mitigations compose: prefix caching, compaction, and retrieval from stored history.',
      'The prefix cache matches from the start, so stable content must come first and be byte-identical.',
      'A timestamp or user id at the top of the system prompt destroys the whole cache.',
      'Caching wants stable-first; attention wants important-last — documents sit near the end.',
      'Each context section needs a token budget, or history silently crowds out retrieved documents.',
      'Generation dominates latency by an order of magnitude; retrieval is a few percent.',
      'So "responses are slow" is usually "responses are long" — a prompt change, not infrastructure.',
      'Streaming changes the number users feel by roughly tenfold at no change in total work.',
      'And it creates a partial-failure case: half an answer has already been read.',
      'Post-generation output validation and streaming cannot both hold.',
      'A wrong answer is not-in-context, in-context-and-unused, or a model error — usually the first.',
      'Diagnose by putting the answer in the context deliberately and re-running.',
      'Record cached tokens, output length, time-to-first-token and the prompt version on every request.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The path a request takes through an LLM application: context assembly, optional retrieval, a parallel prefill over the prompt, a sequential decode of the response, and a stream back — with cost and latency driven by different halves of that.',
    whyItExists:
      'Because the model is stateless and priced per token, so the application owns everything that determines quality, cost and latency: what goes into the window, in what order, and how much comes back.',
    whenToUse: [
      'Prefix caching whenever a stable prompt prefix repeats across requests.',
      'Compaction whenever conversations run long enough for the quadratic term to bite.',
      'Streaming for any user-facing text response.',
      'A per-section token budget whenever context comes from several sources.',
      'The context-injection test whenever an answer is wrong and the cause is unclear.',
    ],
    whenNotToUse: [
      'Resending full history without caching or compaction.',
      'Per-request values above the stable prompt prefix.',
      'Retrieved documents at the top of the prompt.',
      'Optimising retrieval latency against a generation step measured in seconds.',
      'Average response time as the only latency metric.',
      'Post-generation validation in a streaming application.',
      'Reaching for a bigger model before excluding context causes.',
    ],
    alternatives: [
      'Retrieval over stored conversation instead of carrying history, for long sessions.',
      'A batch API with a discount, when nothing is waiting.',
      'A pre-model filter, when a cheap heuristic can exclude most inputs.',
      'Chunk-level output checks, when streaming rules out post-generation validation.',
      'Scheduling work for cache locality, when a prefix must stay warm across a batch.',
    ],
    tradeoffs: [
      'Caching buys cost and time-to-first-token and constrains prompt ordering.',
      'Compaction buys a bounded context and costs detail from older turns.',
      'Streaming buys perceived latency and costs the clean retry and post-hoc validation.',
      'Shorter outputs buy both latency and cost and cost answer completeness.',
      'More retrieved context buys recall and costs input tokens plus position dilution.',
      'A batch API buys a large discount and costs interactivity entirely.',
    ],
    failureModes: [
      'Quadratic conversation cost discovered in a monthly bill.',
      'A per-request value at the top of the prompt destroying the cache.',
      'Retrieved documents placed first, breaking caching and landing in the weakest position.',
      'A long conversation crowding out retrieved context with no budget.',
      'A request exceeding the context window because history grew.',
      'Optimising retrieval while decode dominates the request.',
      'An average latency metric hiding a long tail and an output-length regression.',
      'A stream failing mid-answer with no partial-failure policy.',
      'A model upgrade bought to fix a retrieval problem.',
      'No prompt version recorded, so a quality regression has nothing to correlate against.',
    ],
    followUpQuestions: [
      'How many tokens go in, and how many come out?',
      'Which is the cost driver here — input or output?',
      'How does cost scale with conversation length?',
      'What is the prompt\'s order, and is the prefix byte-identical?',
      'What is the cache hit rate?',
      'Is there a token budget per context section?',
      'Is time-to-first-token measured separately from total time?',
      'Is the response streamed, and what happens if it fails mid-stream?',
      'Was the answer in the context when it went wrong?',
      'What is the output-length distribution?',
      'Is the prompt version recorded on every request?',
    ],
  },
});
