import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-rag-evaluation',
  title: 'RAG failure modes and evaluation',
  summary:
    'A bad answer has four possible causes and they need four different fixes. Evaluation is the machinery that tells them apart — and building the eval set is most of the work.',
  phase: 'ai',
  module: 'retrieval',
  position: 76,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 55,
  tags: ['evaluation', 'retrieval', 'metrics', 'failure-modes', 'observability'],
  prerequisites: ['a-retrieval'],
  resources: [
    {
      key: 'ragas-docs',
      tier: 'must',
      note: 'Read the metric definitions and, more importantly, what each one is computed from. Faithfulness and answer relevance measure different failures, and knowing which inputs each uses tells you which stage it can blame.',
    },
    {
      key: 'rag-survey-paper',
      tier: 'must',
      note: 'Read the evaluation sections. It is the broadest available map of what people measure in RAG systems and where the measures disagree, which is useful precisely because it shows there is no single number.',
    },
    {
      key: 'langsmith-evaluation',
      tier: 'good',
      note: 'Read it for the offline-versus-online distinction. The two answer different questions — whether a change is safe, and whether the system is working now — and conflating them is a common and expensive mistake.',
    },
    {
      key: 'arize-phoenix-evals',
      tier: 'good',
      note: 'Read it for how per-stage traces turn a bad answer into a diagnosis. The instrumentation argument in this lesson is much more concrete once you have seen a trace that records what was retrieved alongside what was said.',
    },
    {
      key: 'lost-in-the-middle',
      tier: 'good',
      note: 'Read it as the case study in a failure that no retrieval metric can see. The right chunks were retrieved and the model still did not use them, which is the clearest possible argument for measuring the stages separately.',
    },
    {
      key: 'self-rag-paper',
      tier: 'advanced',
      note: 'Read it for the idea that the system can judge its own retrieval and output. It blurs the line between evaluation and runtime control, which is worth seeing before you decide where that line belongs in your design.',
    },
  ],

  intuition: {
    body: `**"The answer was wrong" is not a diagnosis.** It is a symptom with **four possible causes**, and each one needs a different fix in a different part of the system.

\`\`\`
1. NOTHING TO FIND    the answer is not in the corpus
                      → fix: ingest more, or say
                        "I don't know"
2. NOT RETRIEVED      it is in the corpus and the
                      search missed it
                      → fix: chunking, index, hybrid
3. RETRIEVED, UNUSED  it was in the context and the
                      model ignored it or misread it
                      → fix: prompt, ordering, model
4. INVENTED           the model answered from its
                      own weights instead
                      → fix: grounding, abstention
\`\`\`

**And a single end-to-end quality score cannot distinguish them**, which is why teams with a dashboard showing "82% good" still argue about what to change — **the number is real and it points nowhere.**

**The discipline is to measure each stage against what it alone controls.**

\`\`\`
Retrieval:  was the answering passage in the top k?
            → depends on chunking and the index
Generation: given this context, is the answer
            supported by it?
            → depends on the prompt and the model
End to end: is the user's question answered?
            → depends on everything, and on whether
              the corpus contains an answer at all
\`\`\`

**Then the fact that makes this hard: you cannot measure retrieval without knowing the right answer's location**, and nobody wrote that down. **The eval set is the expensive part** — building it is the work, and every shortcut around it produces a metric that measures the system against itself.

**And one failure deserves naming separately, because it is the one users punish hardest:**

\`\`\`
A confident answer assembled from retrieved passages
that do not actually support it
→ scores well on relevance
→ reads well
→ and is wrong
\`\`\`

**Which is why "did it answer" and "was it supported" are two measurements**, not one — **and the second is the one that catches this.**

**Finally: a system that never says "I don't know" has no way to fail safely.** **Abstention is a measurable behaviour**, and if nothing measures it, nothing preserves it.`,
    analogyLimit:
      '"Measure answer quality" collapses four distinct failures into one number that cannot say which occurred. It hides that retrieval and generation must be scored separately against what each controls; that a confident answer unsupported by the retrieved passages scores well and is the worst failure; and that the eval set — knowing where the right answer lives — is the expensive prerequisite every shortcut avoids. It also omits abstention, which nothing preserves unless something measures it.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team ships a RAG assistant. To measure quality they sample 100 conversations weekly and have a model score each answer 1-5 for helpfulness. The average is 3.8 and flat for two months, while users complain. Identify four problems with this evaluation.',
      answer: `**Problem 1 — one score cannot attribute the failure, so it cannot drive a decision.**

\`\`\`
A 2/5 answer could mean:
  the corpus lacks the answer     → ingest
  retrieval missed it             → chunking/index
  the model ignored the context   → prompt/ordering
  the model invented it           → grounding
→ four different teams, four different fixes
→ and the score names none of them
\`\`\`

**A metric that moves without telling you why is an alarm, not an instrument** — and after two months of flatness it is not even an alarm.

*The fix:* **score per stage.** Retrieval against a known answer location; generation against the retrieved context; end-to-end against the user's need. **Three numbers that each point somewhere.**

**Problem 2 — "helpfulness" rewards exactly the worst failure.**

**A fluent, confident, well-organised answer that is not supported by the retrieved passages reads as helpful.** A correct answer that says "the policy documents do not cover this case" reads as unhelpful.

\`\`\`
So the metric prefers:
  confident invention > honest abstention
→ and optimising against it makes the system worse
  in the exact way users are complaining about
\`\`\`

*The fix:* **faithfulness measured separately** — is every claim in the answer supported by something in the retrieved context? **It is computable, because both inputs are available**, and it catches the failure helpfulness rewards.

**Problem 3 — sampling production conversations is not an eval set.**

**The sample changes every week**, so a movement from 3.8 to 3.9 could be a better system or an easier week. **There is no way to tell**, which makes the number unusable for deciding whether a change helped.

\`\`\`
Fixed eval set:    same questions, comparable across
                   versions → answers "did this
                   change help?"
Production sample: different questions each time →
                   answers "how are we doing now?"
→ BOTH are needed, and they are not substitutes
\`\`\`

*The fix:* **a fixed, versioned eval set for offline comparison**, plus production sampling for drift. **The team has only the second one and is trying to make it do the first one's job.**

**Problem 4 — no ground truth, so the judge is grading an essay with no answer key.**

**Scoring an answer 1-5 without knowing what the right answer was** measures plausibility. **The judge cannot detect a confidently wrong answer** about a policy it has never seen.

*The fix:* **eval items carry the expected answer and the passage it comes from.** That is the expensive part, and it is what makes every other measurement possible — **retrieval cannot be scored at all without knowing where the answer lives.**

**What the corrected evaluation looks like.**

\`\`\`
· a fixed eval set: question + expected answer +
  the source passage, built from real questions
· retrieval metrics: is the source passage in top k
· faithfulness: every claim traceable to context
· answer correctness: against the expected answer
· abstention: does it decline when it should
· production sampling for drift, separately
· per-stage traces so any single failure is
  diagnosable without rerunning it
\`\`\`

**The transferable point: an evaluation that cannot attribute a failure cannot drive an engineering decision.** **The value is in the decomposition, not in the score.**`,
    },
  body: `## The four failures, and why they must be separated

**Every bad RAG answer is one of four things**, and the fixes do not overlap:

\`\`\`
1. THE CORPUS DOES NOT CONTAIN THE ANSWER
   → the only correct behaviour is to say so
   → measuring this requires knowing it, which
     means the eval set must include unanswerable
     questions deliberately

2. RETRIEVAL MISSED IT
   → the passage exists and did not rank
   → fix: chunking, hybrid retrieval, reranking,
     index parameters

3. IT WAS RETRIEVED AND NOT USED
   → in the context, and the answer ignores it,
     misreads it, or uses a different passage
   → fix: ordering, prompt, context size, model

4. THE MODEL ANSWERED FROM ITS WEIGHTS
   → plausible, fluent, ungrounded
   → fix: grounding instructions, citation
     requirements, abstention
\`\`\`

**A single end-to-end score is compatible with all four**, so it cannot direct work. **And they occur in very different proportions between systems** — a system over a thin corpus fails mostly at (1), a system over a large one mostly at (2) — **so the decomposition also tells you where to invest.**

*The separation is only possible because each stage has an input and an output you can inspect.* **Retrieval takes a query and produces passages; generation takes passages and produces text.** **Score each against what it alone controls**, and a failure lands in one place.

## The eval set is the product

**Everything else in this lesson depends on knowing, for a set of questions, what the right answer is and where it comes from.** **That is a dataset somebody has to build**, and no metric substitutes for it.

\`\`\`
One eval item:
  question          "Does the standard home policy
                     cover flood damage to a shed?"
  expected_answer   the substance a correct answer
                    must contain
  source_passages   the clause(s) that support it
  answerable        true | false
  category          coverage | procedure | historical
\`\`\`

**Four sources of questions, in descending order of value.**

**Real user questions.** Logs, support tickets, the queue the assistant is meant to replace — **these have the right distribution, including the awkward phrasing and the ambiguity.**

**Questions from the people who currently answer them.** They know which questions are hard and which are asked constantly, **and they can supply the source passage from memory**, which is the expensive field.

**Adversarial questions written deliberately.** Near-misses between similar documents, questions whose answer changed between versions, **questions with no answer at all.**

**And generated questions, used carefully.** A model reading a passage can produce a question it answers, **which is cheap and systematically biased**: the questions are phrased like the document, **so they overstate retrieval quality.** Useful for coverage, dangerous as the only source.

**How large.** **Enough to be stable, which is smaller than people expect and larger than they build.**

\`\`\`
~30 items   → a change of one item moves the score
              by 3 points. Too noisy for decisions.
~100-200    → workable for a gate; a 5-point move
              is probably real
~500+       → worth having per category, so a
              regression in one area is visible
\`\`\`

*And the crucial property is stratification:* **an eval set of 200 easy factual lookups reports excellent quality on a system that fails every procedural question.** **Categories must reflect the real distribution of question types**, and be scored separately.

**The unanswerable questions are the ones teams omit**, and they are the only way to measure abstention. **Roughly one in ten items should have no answer in the corpus** — and a system scoring well on the rest while confidently answering those is not a good system.

## Retrieval metrics

**Given the source passage, retrieval is directly measurable.**

\`\`\`
Recall@k      is the source passage in the top k?
              → the primary number: everything
                downstream is capped by it
Precision@k   how much of the top k is relevant?
              → matters because noise displaces
                signal in the context budget
MRR           1/rank of the first relevant result
              → sensitive to position, which matters
                when k is small
NDCG          graded relevance, position-discounted
              → when passages are partially relevant
\`\`\`

**Recall@k is the one to start with**, and the k must be the k actually used. **Recall@50 for a system that retrieves 5 is a number about a system nobody is running.**

*And a second retrieval measure that is easy to compute and rarely is:* **retrieved-set diversity** — how many distinct documents appear in the top k. **Five near-identical chunks is a retrieval success and a context failure**, invisible to recall.

## Generation metrics

**Given the retrieved context and the answer, generation is measurable independently of retrieval** — which is the point.

**Faithfulness, or groundedness.** **Is every claim in the answer supported by the retrieved context?** Computed by decomposing the answer into claims and checking each against the context. **This is the metric that catches confident invention**, and it is the most valuable one in the set.

**Answer relevance.** **Does the answer address the question asked**, as opposed to a related one? Catches the case where the model answers a question the retrieved passages happen to support.

**Answer correctness.** **Against the expected answer in the eval item.** Requires ground truth, which is why the eval set matters.

**Context utilisation.** **Did the answer use the passages that contained the answer**, or ignore them in favour of a weaker one? This is the measurement that exposes position effects — **retrieved and unused, which no retrieval metric can see.**

\`\`\`
The key property:
  faithfulness is computed from (context, answer)
    → it blames generation only
  recall is computed from (query, retrieved, truth)
    → it blames retrieval only
→ so a system with high recall and low faithfulness
  has a generation problem, and the numbers say so
\`\`\`

## Using a model as the judge

**Most of these metrics require judgment**, and a model is the only affordable judge at scale. **It works, with conditions.**

**Calibrate it against humans once.** Score 50 items by hand, score the same 50 with the judge, **and measure the agreement.** A judge that agrees 60% of the time is measuring something else. **Without this step the judge's output is unvalidated**, and it is the step most often skipped.

**Make the judge's task narrow and verifiable.** "Is this claim supported by this passage — yes or no" is a task a model does reliably. **"Rate this answer 1-5 for helpfulness" is not**, because the scale has no shared meaning between items.

**Use a strong model for judging, even if a cheap one generates.** **Judging is the measurement**, and a cheap judge makes every downstream number uncertain — the cost is bounded by the eval set's size, which is small.

**And never judge with the model that generated**, on the dimension it was optimising. **Self-assessment inherits the generator's blind spots**: a model that misread a passage will judge its own misreading as supported.

*The honest limits:* **judges are biased toward longer answers, toward their own phrasing, and toward confident tone.** **They also drift when the judge model is upgraded**, which silently shifts every historical number — **so the judge model and its prompt are versioned alongside the eval set.**

## Offline and online are different instruments

\`\`\`
OFFLINE     fixed eval set, run on demand
            Question: "did this change help?"
            Property: comparable across versions
            Use: a gate before shipping

ONLINE      production traffic, sampled
            Question: "is it working now?"
            Property: reflects real distribution
            Use: drift detection, incident signal
\`\`\`

**Neither substitutes for the other**, and the common mistake is having only the online one — **which cannot answer whether a change helped, because the questions differ every week.**

**Online signals worth capturing**, none of which require ground truth:

\`\`\`
· abstention rate — a sudden fall often means the
  grounding instruction stopped working
· retrieval score distribution — a shift means the
  corpus or the queries moved
· citation rate and citation validity
· user actions: rephrasing, escalation, thumbs
· answer length distribution — a proxy for waffle
\`\`\`

*And the strongest online signal is usually behavioural:* **a user who rephrases the same question twice did not get an answer**, which is more reliable than a thumbs-down that most users never click.

## Instrumentation: make a bad answer diagnosable

**A complaint arrives about one answer.** **You should be able to diagnose it without rerunning anything**, which means the trace recorded enough:

\`\`\`
Per request, stored:
  the query, and the rewritten query if any
  the filters applied
  the retrieved chunk ids, scores and ranks
  the assembled context, exactly as sent
  the model, prompt version and parameters
  the answer and its citations
\`\`\`

**The assembled context is the field people omit and the one that matters most** — **it is what separates "not retrieved" from "retrieved and unused"**, which is the single most useful distinction in this lesson.

*And the trace is what turns a complaint into an eval item.* **A confirmed bad answer, with its source passage identified, is exactly an eval-set row** — so the pipeline from complaint to regression test should be short.

## Regression gating

**The reason to build all this is to change the system safely.**

\`\`\`
Before shipping a change to chunking, the prompt,
the model, the retriever or the index:
  run the eval set
  compare per-category scores against the baseline
  block on a regression in faithfulness or
    abstention, which are safety properties
  require a stated improvement in the metric the
    change was supposed to move
\`\`\`

**Two things this catches that nothing else does.** **A change that improves the average and destroys one category** — visible only if categories are scored separately. **And a change that improves relevance by reducing abstention**, which is a regression disguised as an improvement.

## What to say in a design discussion

**That a bad answer has four causes and the evaluation exists to tell them apart.**

**That the eval set — question, expected answer, source passage, answerable flag — is the expensive prerequisite, built from real questions and stratified by category.**

**That retrieval is scored on recall at the k actually used, and generation on faithfulness against the retrieved context.**

**That a model judge is calibrated against humans once, given narrow verifiable tasks, and versioned.**

**That offline and online evaluation answer different questions and both are needed.**

**That traces store the assembled context**, because that is what distinguishes retrieved-and-unused from not-retrieved.

**And that abstention is measured**, because a system that never declines cannot fail safely.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'failure-attribution',
      title: 'One bad answer, four causes — and the measurement that separates them',
      caption:
        'Step through it. Each stage is scored against what it alone controls, so a failure lands in exactly one place instead of producing an argument between teams.',
      nodes: [
        { id: 'q', label: 'A question, and a bad answer', kind: 'client', x: 0, y: 170, detail: 'The symptom. A single quality score is compatible with all four causes below, which is why a dashboard showing "82% good" leaves teams arguing about what to change.' },
        { id: 'corpus', label: 'Is the answer in the corpus at all?', kind: 'service', x: 220, y: 40, detail: 'Cause 1. The only correct behaviour is to decline, so measuring it requires eval items that are deliberately unanswerable — roughly one in ten. Teams omit these, and then nothing measures abstention.' },
        { id: 'ret', label: 'Was the source passage in the top k?', kind: 'service', x: 470, y: 40, detail: 'Cause 2, measured by recall@k at the k actually used. Everything downstream is capped by this number, which is why it comes first — and why recall@50 for a system retrieving 5 describes a system nobody runs.' },
        { id: 'ctx', label: 'The assembled context, stored verbatim', kind: 'store', x: 470, y: 180, detail: 'The trace field people omit and the one that matters most. It is what separates "not retrieved" from "retrieved and unused" — the single most useful distinction available, and it cannot be recovered afterwards.' },
        { id: 'gen', label: 'Is every claim supported by that context?', kind: 'service', x: 720, y: 180, detail: 'Faithfulness, computed from context and answer only — so it blames generation and nothing else. This is the metric that catches confident invention, which is the failure a helpfulness score actively rewards.' },
        { id: 'unused', label: 'Retrieved and unused', kind: 'note', x: 720, y: 40, detail: 'Cause 3. The right passage was in the context and the answer ignored it or used a weaker one. No retrieval metric can see this, and position inside the context window is a known reason for it.' },
        { id: 'invent', label: 'Answered from weights', kind: 'note', x: 940, y: 180, detail: 'Cause 4. Fluent, confident, ungrounded — and it reads as helpful, which is why it survives every evaluation that scores helpfulness alone.' },
        { id: 'judge', label: 'Model judge, calibrated and versioned', kind: 'external', x: 720, y: 320, detail: 'Narrow verifiable questions — "is this claim supported, yes or no" — not 1-5 ratings. Calibrated against 50 human-scored items once, never the generating model judging its own dimension, and versioned because a judge upgrade silently shifts every historical number.' },
        { id: 'gate', label: 'Regression gate', kind: 'note', x: 220, y: 320, detail: 'Per-category comparison against a baseline, blocking on faithfulness or abstention regressions. It catches the change that improves the average while destroying one category, and the one that raises relevance by declining less often.' },
      ],
      edges: [
        { id: 'e1', source: 'q', target: 'corpus', kind: 'control' },
        { id: 'e2', source: 'corpus', target: 'ret', kind: 'sync' },
        { id: 'e3', source: 'ret', target: 'ctx', kind: 'write' },
        { id: 'e4', source: 'ctx', target: 'gen', kind: 'read' },
        { id: 'e5', source: 'ret', target: 'unused', kind: 'control' },
        { id: 'e6', source: 'gen', target: 'invent', kind: 'control' },
        { id: 'e7', source: 'judge', target: 'gen', kind: 'control' },
        { id: 'e8', source: 'gate', target: 'q', kind: 'control' },
      ],
      steps: [
        {
          id: 'es1',
          title: 'First ask whether an answer exists',
          description:
            'If the corpus does not contain it, the only correct behaviour is to decline — and that is measurable only if the eval set contains unanswerable questions on purpose.',
          nodes: ['q', 'corpus'],
          edges: ['e1'],
        },
        {
          id: 'es2',
          title: 'Then score retrieval against a known location',
          description:
            'Recall@k at the k actually used. This requires the eval set to record which passage answers the question, which is the expensive field and the one that makes everything else possible.',
          nodes: ['ret'],
          edges: ['e2'],
        },
        {
          id: 'es3',
          title: 'Store the assembled context, or lose the distinction',
          description:
            'Without it, "the model ignored the passage" and "the passage was never retrieved" are indistinguishable after the fact — and they need opposite fixes.',
          nodes: ['ctx', 'unused'],
          edges: ['e3', 'e5'],
        },
        {
          id: 'es4',
          title: 'Score generation against that context alone',
          description:
            'Faithfulness uses only the context and the answer, so it blames generation and nothing else. High recall with low faithfulness is a generation problem, and the numbers say so.',
          nodes: ['gen', 'invent'],
          edges: ['e4', 'e6'],
        },
        {
          id: 'es5',
          title: 'Judge narrowly, then gate on it',
          description:
            'Calibrate the judge once against humans, keep its task binary and verifiable, version it — then block changes on faithfulness and abstention regressions per category.',
          nodes: ['judge', 'gate'],
          edges: ['e7', 'e8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'eval-set',
      title: 'What an eval set is made of, and where the questions come from',
      caption:
        'Read the source ordering as a value ordering. Generated questions are cheap and biased toward the document\'s own phrasing, which makes them useful for coverage and misleading as the only source.',
      code: `flowchart TB
    subgraph ITEM["**One eval item**"]
      I1["question"]
      I2["expected_answer<br/>*the substance a correct<br/>answer must contain*"]
      I3["source_passages<br/>**the expensive field** —<br/>without it retrieval<br/>cannot be scored at all"]
      I4["answerable: true / false<br/>*~1 in 10 must be false,<br/>or nothing measures<br/>abstention*"]
      I5["category<br/>*coverage / procedure /<br/>historical / comparison*"]
    end

    S1["**Real user questions**<br/>logs, tickets, the queue this<br/>replaces → the right<br/>distribution, including the<br/>awkward phrasing"] --> ITEM
    S2["**From the people who<br/>answer them today**<br/>they know which are hard,<br/>and can supply the source<br/>passage from memory"] --> ITEM
    S3["**Adversarial, written<br/>deliberately**<br/>near-misses between similar<br/>documents, answers that<br/>changed between versions,<br/>questions with no answer"] --> ITEM
    S4["**Generated from passages**<br/>cheap, and **systematically<br/>biased** — phrased like the<br/>document, so it overstates<br/>retrieval quality.<br/>Coverage only"] -.-> ITEM

    ITEM --> SIZE["**Size and stratification**<br/>~30: one item moves the score<br/>3 points — too noisy<br/>~100-200: a workable gate<br/>~500+: per-category signal<br/><br/>**200 easy factual lookups report<br/>excellent quality on a system that<br/>fails every procedural question**"]

    style I3 fill:#1c1814,stroke:#c99a4e
    style I4 fill:#1c1814,stroke:#c99a4e
    style SIZE fill:#17272a,stroke:#35897e
    style S4 fill:#2a1a1a,stroke:#8c4a4a`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The RAGAS metric documentation is the most useful reference here, and the reason is structural rather than about any individual metric.

**Each metric is defined by what it is computed from**, and that determines what it can blame.

\`\`\`
faithfulness      (context, answer)
                  → generation only: retrieval is not
                    an input, so it cannot be at fault
answer relevance  (question, answer)
                  → whether the question was addressed,
                    independent of whether the answer
                    is right
context recall    (context, ground truth)
                  → retrieval only
context precision (question, context)
                  → how much of what was retrieved
                    was useful
\`\`\`

**So the input list is the attribution.** A metric that does not take the retrieved context as an input cannot tell you anything about retrieval — **which sounds obvious and is exactly what a single end-to-end score violates.**

**Three transferable lessons.**

**Design metrics by their inputs.** Before adopting one, ask what it is computed from; **that tells you which stage it can implicate**, and whether you already have a metric covering that stage.

**Faithfulness and relevance are orthogonal and both are needed.** An answer can be fully supported by the context and not address the question; **it can address the question perfectly and be unsupported.** One number cannot express both, **and the second case is the dangerous one.**

**And ground truth is required for exactly one family.** Context recall and answer correctness need it; **faithfulness and relevance do not** — which means a subset of the evaluation can run on production traffic where no ground truth exists. **That is what makes online evaluation possible at all.**

**Where this does not help.** The metrics assume the eval set exists, and **say nothing about how to build one or how to stratify it** — which is most of the work. **They also assume a judge whose agreement with humans has been established**, and that calibration is the step teams skip before trusting the numbers.`,
  },

  tradeoffs: {
    intro:
      'The decisions RAG evaluation involves, most of which trade cost against attribution.',
    rows: [
      {
        option: 'A single end-to-end quality score',
        whenItWins:
          'A quick sanity signal, and nothing else.',
        whenItLoses:
          'It is compatible with all four failure causes, so it cannot direct any work.',
        cost:
          'Two months of a flat number while users complain.',
      },
      {
        option: 'Per-stage metrics',
        whenItWins:
          'Whenever the evaluation is meant to drive engineering decisions.',
        whenItLoses:
          'More to build and more to maintain, and requires a real eval set.',
        cost:
          'The eval set, which is the expensive prerequisite.',
      },
      {
        option: 'Questions from real users and domain experts',
        whenItWins:
          'Always — the right distribution, the real phrasing, and the hard cases.',
        whenItLoses:
          'Slow to collect, and expensive in expert time for the source passages.',
        cost:
          'Human effort, which is why it gets skipped.',
      },
      {
        option: 'Model-generated questions from passages',
        whenItWins:
          'Coverage: making sure every part of the corpus has some test.',
        whenItLoses:
          'Questions are phrased like the document, which overstates retrieval quality.',
        cost:
          'A systematically optimistic number if used alone.',
      },
      {
        option: 'Including unanswerable questions',
        whenItWins:
          'Always — it is the only way to measure abstention.',
        whenItLoses:
          'Requires knowing the corpus well enough to be sure there is no answer.',
        cost:
          'Curation effort, for the safety property nothing else protects.',
      },
      {
        option: 'Human judging',
        whenItWins:
          'Calibration, adversarial cases, and anything where the judge itself is in doubt.',
        whenItLoses:
          'Cannot run on every change, and is slow.',
        cost:
          'Time, which is why it should be spent on calibration rather than volume.',
      },
      {
        option: 'Model-as-judge',
        whenItWins:
          'Scale — running the full eval set on every change.',
        whenItLoses:
          'Uncalibrated, it measures something unknown; biased toward length and confidence.',
        cost:
          'A calibration step, and version pinning.',
      },
      {
        option: 'The generating model judging its own output',
        whenItWins:
          'Nowhere, on the dimension it was optimising.',
        whenItLoses:
          'It inherits the generator\'s blind spots — a misread passage is judged as supported.',
        cost:
          'A number that confirms rather than checks.',
      },
      {
        option: 'Offline evaluation on a fixed set',
        whenItWins:
          'Deciding whether a change helped — the questions are comparable across versions.',
        whenItLoses:
          'It drifts from production as the real question distribution moves.',
        cost:
          'Periodic refresh of the set.',
      },
      {
        option: 'Online evaluation on sampled traffic',
        whenItWins:
          'Detecting drift and incidents in the real distribution.',
        whenItLoses:
          'Different questions each period, so it cannot attribute a change.',
        cost:
          'Only the ground-truth-free metrics are available.',
      },
      {
        option: 'Storing the assembled context in traces',
        whenItWins:
          'Always — it separates "not retrieved" from "retrieved and unused".',
        whenItLoses:
          'Storage volume, and it contains whatever the documents contain.',
        cost:
          'Retention and access controls on potentially sensitive text.',
      },
      {
        option: 'Blocking releases on eval regressions',
        whenItWins:
          'Faithfulness and abstention, which are safety properties.',
        whenItLoses:
          'A noisy or too-small eval set makes the gate flaky and it gets disabled.',
        cost:
          'An eval set large enough that a move is real.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We score every answer 1-5 for helpfulness and track the average."',
      whyWeak:
        'One score cannot say which of four causes produced a bad answer, so it cannot direct work. Worse, helpfulness rewards a fluent confident answer unsupported by the retrieved passages and penalises a correct refusal — so optimising against it makes the system worse in exactly the way users complain about.',
      strongAnswer:
        '"I score per stage against what each stage controls. Retrieval on recall at the k actually used, which requires the eval set to record where the answer lives. Generation on faithfulness — is every claim supported by the retrieved context — computed from context and answer only, so it blames generation and nothing else. Then answer correctness against the expected answer, and abstention on deliberately unanswerable items. Three numbers that each point somewhere, rather than one that points nowhere."',
    },
    {
      weakAnswer: '"We sample 100 production conversations a week and score them."',
      whyWeak:
        'The questions differ every week, so a movement could be a better system or an easier sample. It cannot answer whether a change helped, which is the question a team actually needs answered before shipping.',
      strongAnswer:
        '"Those are two different instruments and I want both. A fixed versioned eval set answers \'did this change help\', because the questions are comparable across versions, and it gates releases. Sampled production traffic answers \'is it working now\' and catches drift — and only the ground-truth-free metrics like faithfulness and relevance can run there, which is fine because those are the ones that matter for an incident signal."',
    },
    {
      weakAnswer: '"We generate the eval set by having a model write questions from each document."',
      whyWeak:
        'Generated questions are phrased like the passage they came from, so retrieval finds them easily and the measured quality is systematically optimistic. The real distribution includes awkward phrasing, ambiguity, and questions the corpus cannot answer.',
      strongAnswer:
        '"Generated questions are useful for coverage — making sure no part of the corpus is untested — and dangerous as the only source, because they overstate retrieval quality. The valuable questions come from real logs and from the people who answer them today, who also know which passage supports each answer. I would add adversarial items deliberately: near-misses between similar documents, answers that changed between versions, and about one in ten with no answer at all, because that is the only way to measure abstention."',
    },
    {
      weakAnswer: '"A model judges the answers, which scales to every change."',
      whyWeak:
        'An uncalibrated judge measures something unknown. Judges are also biased toward longer answers and confident tone, and a judge-model upgrade silently shifts every historical number, breaking comparisons nobody realises are broken.',
      strongAnswer:
        '"A model judge is the only affordable option at scale, with three conditions. I calibrate it once against fifty human-scored items and measure the agreement — below some threshold it is measuring something else. I keep its task narrow and verifiable, like \'is this claim supported by this passage, yes or no\', rather than a 1-5 rating whose scale has no shared meaning between items. And I version the judge model and its prompt alongside the eval set, because upgrading the judge changes every number retroactively."',
    },
    {
      weakAnswer: '"When a user reports a bad answer we re-run the query to see what happened."',
      whyWeak:
        'Re-running produces a different retrieval if the corpus or index has changed, and it cannot recover what the model was actually shown. The distinction between "not retrieved" and "retrieved and ignored" is lost, and those need opposite fixes.',
      strongAnswer:
        '"The trace has to store the assembled context exactly as it was sent, alongside the query, the filters, the retrieved chunk ids with scores and ranks, the prompt version and the answer. The assembled context is the field teams omit and the one that matters most, because it is what separates a retrieval failure from a generation failure after the fact. And a confirmed bad answer with its source passage identified is exactly an eval-set row, so the path from complaint to regression test should be short."',
    },
    {
      weakAnswer: '"The eval average improved from 72% to 78%, so we shipped the change."',
      whyWeak:
        'An average hides a category collapsing while others improve, and it hides the specific regression where relevance rises because the system stopped declining to answer — an improvement in the metric that is a degradation in behaviour.',
      strongAnswer:
        '"I gate per category rather than on the average, because a change that improves factual lookups and destroys procedural answers shows as a net gain. And I block specifically on faithfulness and abstention regressions, because those are safety properties rather than quality ones — a system that answers more questions by declining less often will score better on relevance while getting worse. I also require the change to move the metric it was supposed to move, so an unexplained improvement gets investigated rather than shipped."',
    },
  ],

  flashcards: [
    {
      id: 'fc-rev-1',
      front: 'What are the four causes of a bad RAG answer?',
      back: 'The corpus lacks it; retrieval missed it; it was retrieved and unused; the model invented it. Four different fixes.',
      topic: 'failure-modes',
    },
    {
      id: 'fc-rev-2',
      front: 'Why can a single quality score not drive engineering work?',
      back: 'It is compatible with all four causes, so it says something is wrong and nothing about where.',
      topic: 'evaluation',
    },
    {
      id: 'fc-rev-3',
      front: 'What does an eval item contain?',
      back: 'Question, expected answer, the source passages supporting it, an answerable flag, and a category.',
      topic: 'evaluation',
    },
    {
      id: 'fc-rev-4',
      front: 'Why must some eval items be unanswerable?',
      back: 'They are the only way to measure abstention, and a system that never declines cannot fail safely.',
      topic: 'evaluation',
    },
    {
      id: 'fc-rev-5',
      front: 'What is wrong with a "helpfulness" score?',
      back: 'It rewards fluent confident invention and penalises a correct refusal, so optimising it makes the system worse.',
      topic: 'metrics',
    },
    {
      id: 'fc-rev-6',
      front: 'Why are model-generated eval questions biased?',
      back: 'They are phrased like the passage they came from, so retrieval finds them easily and quality is overstated.',
      topic: 'evaluation',
    },
    {
      id: 'fc-rev-7',
      front: 'What does faithfulness measure, and what can it blame?',
      back: 'Whether every claim is supported by the retrieved context. Computed from context and answer only, so it blames generation alone.',
      topic: 'metrics',
    },
    {
      id: 'fc-rev-8',
      front: 'Why does a metric\'s input list matter?',
      back: 'It determines which stage the metric can implicate. A metric that does not take retrieved context cannot say anything about retrieval.',
      topic: 'metrics',
    },
    {
      id: 'fc-rev-9',
      front: 'Which metrics need ground truth and which do not?',
      back: 'Context recall and answer correctness need it; faithfulness and answer relevance do not — which is what makes online evaluation possible.',
      topic: 'metrics',
    },
    {
      id: 'fc-rev-10',
      front: 'What distinguishes offline from online evaluation?',
      back: 'Offline uses a fixed set and answers "did this change help". Online samples traffic and answers "is it working now". Not substitutes.',
      topic: 'evaluation',
    },
    {
      id: 'fc-rev-11',
      front: 'Three conditions for using a model as judge.',
      back: 'Calibrate against human scores once; give it narrow verifiable binary tasks; version the judge model and prompt.',
      topic: 'evaluation',
    },
    {
      id: 'fc-rev-12',
      front: 'Why never have the generating model judge its own dimension?',
      back: 'It inherits the generator\'s blind spots — a misread passage is judged as supported, so the check confirms rather than checks.',
      topic: 'evaluation',
    },
    {
      id: 'fc-rev-13',
      front: 'Which trace field matters most, and why?',
      back: 'The assembled context, stored verbatim. It is what separates "not retrieved" from "retrieved and unused" after the fact.',
      topic: 'observability',
    },
    {
      id: 'fc-rev-14',
      front: 'Why gate per category rather than on the average?',
      back: 'An average hides one category collapsing while others improve — and hides relevance rising because the system declined less often.',
      topic: 'evaluation',
    },
  ],

  quiz: [
    {
      id: 'q-rev-1',
      kind: 'scenario',
      prompt:
        'Recall@5 is 94% and users report answers that miss information clearly present in the documents. What is the most likely cause?',
      options: [
        { id: 'a', label: 'Retrieved and unused — the passage was in the context and the answer ignored it or used a weaker one' },
        { id: 'b', label: 'The index needs rebuilding' },
        { id: 'c', label: 'Recall was measured incorrectly' },
        { id: 'd', label: 'The corpus is incomplete' },
      ],
      correct: ['a'],
      explanation:
        'High recall means retrieval put the passage in front of the model, so the failure is downstream — ordering, prompt, or context size. This is the distinction that requires the assembled context to be stored, because otherwise it is indistinguishable from a retrieval miss.',
      difficulty: 'core',
      topic: 'failure-modes',
    },
    {
      id: 'q-rev-2',
      kind: 'scenario',
      prompt:
        'A team scores answers 1-5 for helpfulness. Which behaviour does this metric reward that it should not?',
      options: [
        { id: 'a', label: 'A fluent, confident answer unsupported by the retrieved passages — and it penalises a correct refusal' },
        { id: 'b', label: 'Answers that are too short' },
        { id: 'c', label: 'Answers that cite sources' },
        { id: 'd', label: 'Answers that ask clarifying questions' },
      ],
      correct: ['a'],
      explanation:
        'Helpfulness measures how an answer reads, and confident invention reads well while "the documents do not cover this" reads badly. Optimising against it degrades the system in exactly the direction users complain about, which is why faithfulness has to be measured separately.',
      difficulty: 'core',
      topic: 'metrics',
    },
    {
      id: 'q-rev-3',
      kind: 'scenario',
      prompt:
        'Which metric can run on production traffic where no ground truth exists?',
      options: [
        { id: 'a', label: 'Faithfulness — it is computed from the retrieved context and the answer only' },
        { id: 'b', label: 'Context recall' },
        { id: 'c', label: 'Answer correctness' },
        { id: 'd', label: 'Recall@k' },
      ],
      correct: ['a'],
      explanation:
        'A metric can only run where all its inputs exist. Faithfulness and answer relevance need no ground truth, which is what makes online evaluation possible at all; the others require knowing what the right answer was and where it lives.',
      difficulty: 'core',
      topic: 'metrics',
    },
    {
      id: 'q-rev-4',
      kind: 'scenario',
      prompt:
        'An eval set is built entirely by having a model write a question for each passage. What is systematically wrong with the resulting numbers?',
      options: [
        { id: 'a', label: 'Retrieval quality is overstated, because the questions are phrased like the passages they came from' },
        { id: 'b', label: 'The questions are too difficult' },
        { id: 'c', label: 'There are too few of them' },
        { id: 'd', label: 'Nothing — it is the standard approach' },
      ],
      correct: ['a'],
      explanation:
        'Lexical and semantic overlap between the generated question and its source passage makes retrieval easy in a way real questions are not, and the set contains no unanswerable questions. It is useful for coverage and misleading as the only source.',
      difficulty: 'core',
      topic: 'evaluation',
    },
    {
      id: 'q-rev-5',
      kind: 'scenario',
      prompt:
        'A change raises the eval average from 72% to 78%. What must be checked before shipping?',
      options: [
        { id: 'a', label: 'Per-category scores, and specifically whether abstention or faithfulness regressed' },
        { id: 'b', label: 'Whether latency improved too' },
        { id: 'c', label: 'Whether the eval set is large enough' },
        { id: 'd', label: 'Nothing — a six-point gain is decisive' },
      ],
      correct: ['a'],
      explanation:
        'An average hides one category collapsing while others improve, and it hides the specific regression where relevance rises because the system stopped declining to answer — an improvement in the number that is a degradation in behaviour.',
      difficulty: 'advanced',
      topic: 'evaluation',
    },
    {
      id: 'q-rev-6',
      kind: 'multi',
      prompt:
        'Which of these are required before trusting a model judge\'s numbers? Select all that apply.',
      options: [
        { id: 'a', label: 'Agreement with human scores measured once on a sample' },
        { id: 'b', label: 'A narrow, verifiable task rather than an open rating scale' },
        { id: 'c', label: 'The judge model and prompt pinned to a version' },
        { id: 'd', label: 'The judge being the same model that generated the answer' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Calibration establishes that the judge measures what you think; a binary supported/unsupported question is one a model does reliably where a 1-5 scale is not; and pinning matters because a judge upgrade silently shifts every historical number. Self-judging inherits the generator\'s blind spots.',
      difficulty: 'advanced',
      topic: 'evaluation',
    },
  ],

  exercises: [
    {
      id: 'ex-rev-1',
      kind: 'design',
      title: 'Build the evaluation for a system that is already failing',
      estimatedMinutes: 45,
      prompt: `A RAG assistant has been live for four months over an internal knowledge base of 40,000 documents. It has no evaluation beyond a thumbs up/down that 3% of users click. Complaints from the last month, verbatim from the ticket queue:

1. "It told me the wrong retention period for customer data — it quoted a policy we replaced last year."
2. "Asked how to onboard a contractor, got steps 1-3 of the employee process."
3. "It said our office in Manchester closes at 6pm. We do not have a Manchester office."
4. "It keeps saying it cannot find anything when I know the answer is in the handbook."
5. "The answer was right but it took 40 seconds."

You have two engineers for three weeks.

**Part 1.** Attribute each complaint to a failure cause and say what evidence would confirm it.

**Part 2.** Design the eval set: sources, size, stratification, and who does the work.

**Part 3.** Specify the metrics and where each runs — offline, online, or both.

**Part 4.** Specify the instrumentation, and say what you would have to ship before you can diagnose complaint 4.

**Part 5.** Define the release gate.

Then answer:

- What would you do in week one, and why that order?
- What would you deliberately not build?`,
      rubric: [
        'Each complaint attributed to a specific cause with the evidence that would confirm it.',
        'Recognises that at least one complaint cannot be attributed with current instrumentation.',
        'Eval set sources prioritise real questions over generated ones.',
        'Stratification reflects the complaint categories.',
        'Unanswerable items included with a stated purpose.',
        'Metrics separated by stage and by whether they need ground truth.',
        'Instrumentation includes the assembled context and explains why.',
        'Release gate blocks on safety properties, not just the average.',
        'A defensible week-one ordering.',
        'Names something deliberately not built.',
      ],
      modelAnswer: `**Part 1 — attributing the complaints**

\`\`\`
1. Wrong retention period, quoted a replaced policy
   → CAUSE: retrieval, specifically a missing
     version filter. The superseded document is
     textually near-identical to the current one,
     so similarity cannot distinguish them.
   → EVIDENCE: retrieve for that query and check
     whether both versions appear and how they rank.
     Confirmed if the superseded one outranks or
     accompanies the current one.

2. Contractor onboarding, got employee steps 1-3
   → CAUSE: two failures compounding.
     (a) fragmentation — steps 1-3 is one chunk of
         a procedure, so the answer truncated
     (b) confusion between two similar procedures —
         mid-procedure chunks lack the title that
         identifies which process they belong to
   → EVIDENCE: check the source_id of the retrieved
     chunks. Different documents confirms (b);
     same document with only the first chunk
     confirms (a). Both are likely.

3. A Manchester office that does not exist
   → CAUSE: invention. The model answered from its
     weights, and the specific shape — a plausible
     UK city, a plausible closing time — is
     characteristic.
   → EVIDENCE: check whether "Manchester" appears
     anywhere in the retrieved context. If not,
     this is unambiguous and it is the most
     serious complaint in the list.

4. "It cannot find anything when I know it is in
    the handbook"
   → CAUSE: UNKNOWN, and that is the important
     answer. Could be:
       retrieval missing it (chunking, embedding)
       a filter excluding it (permissions, version)
       an abstention threshold set too high
       the user being wrong about the handbook
   → EVIDENCE: NONE AVAILABLE. There is no trace,
     so the query, the filters and the retrieved
     set are all gone.

5. Right answer, 40 seconds
   → CAUSE: not a quality failure at all. A latency
     problem — probably reranking a large candidate
     set, or a slow model.
   → EVIDENCE: per-stage timings, which also do
     not exist.
\`\`\`

**Two observations worth stating.**

**Complaint 4 is the one that shapes the plan.** It cannot be attributed at all, **and it is the most common complaint shape** — "it should have found this". **Until traces exist, every instance of it is an unanswerable question**, which means instrumentation comes before evaluation.

**And complaint 3 is the most serious**, because it is the failure users lose trust over permanently. **It also has the cleanest test** — is the claimed fact present in the context — **so it is the first metric worth having.**

---

**Part 2 — the eval set**

**Sources, in the order I would spend effort.**

\`\`\`
1. THE TICKET QUEUE (highest value, already exists)
   Four months of complaints, each one a confirmed
   failure with a user-stated expectation.
   → every complaint becomes an eval item once
     someone identifies the source passage
   → this is the cheapest high-quality source
     available and it is sitting there

2. THUMBS-DOWN CONVERSATIONS
   3% click-through is low, but over four months
   that is a usable pool of negative signal.

3. THE PEOPLE WHO ANSWER THESE QUESTIONS TODAY
   HR, IT, compliance — whoever fielded these
   questions before the assistant. They can supply
   both the question and the source passage, which
   is the expensive field.
   → I would ask for 20 questions each from 5
     people: 100 items, a day of their time total

4. ADVERSARIAL, WRITTEN BY US
   · superseded-versus-current pairs (complaint 1)
   · similar procedures (complaint 2)
   · questions with no answer in the corpus
     (complaint 3's category)

5. GENERATED, FOR COVERAGE ONLY
   To check that no part of the corpus is untested.
   Explicitly flagged as generated and scored
   separately, because they overstate quality.
\`\`\`

**Size and stratification.**

\`\`\`
Target: 200 items for the gate, growing

Stratified by the complaint categories, because
those are the failure modes we know exist:

  policy / versioned content     40   (complaint 1)
  procedures, multi-step         40   (complaint 2)
  factual lookup                 40
  unanswerable                   25   (complaint 3)
  comparison / cross-document    25
  historical / as-at             15
  generated coverage             15   (scored apart)
\`\`\`

**Three decisions worth defending.**

**The categories come from the complaints, not from a taxonomy.** **These are the failures this system actually has**, so a per-category score tells us whether a fix worked — **and an eval set stratified by some generic scheme would report an average that hides all four.**

**25 unanswerable items — more than one in ten.** **Complaint 3 is invention**, and the only direct measurement of it is whether the system declines when there is nothing to find. **Over-weighting it is deliberate** given what the queue shows.

**And the ticket queue is mined first**, because those items are confirmed failures with known user expectations. **200 items built from scratch is weeks; 60 items extracted from tickets is days**, and they are better items.

*Who does the work:* **one engineer for roughly a week on extraction and curation**, plus a day of domain-expert time for the source passages. **The source passage is the field that cannot be delegated to a model** — it is what makes retrieval measurable.

---

**Part 3 — metrics and where they run**

\`\`\`
RETRIEVAL (needs ground truth → offline only)
  recall@k at the k actually used
    → per category. The primary number.
  correct-version rate
    → of retrieved chunks, what fraction are the
      current version? Directly targets complaint 1
  procedure completeness
    → for procedural items, were all chunks of the
      procedure retrieved? Targets complaint 2
  retrieved-set coherence
    → how many distinct source_ids? A procedural
      query pulling from four documents is the
      merging risk from complaint 2

GENERATION (no ground truth needed → both)
  faithfulness
    → every claim traceable to the context.
      THE metric for complaint 3, and it runs
      on production traffic
  answer relevance
    → does it address the question asked

END TO END (needs ground truth → offline)
  answer correctness against expected_answer
  abstention correctness
    → declined when answerable=false (should)
    → declined when answerable=true (should not —
      this is complaint 4's signature)

ONLINE ONLY (no ground truth anywhere)
  abstention rate over time
  retrieval score distribution
  citation validity — does the cited chunk exist
    and contain the claim
  rephrase rate — the same user asking a near-
    identical question within two minutes
  per-stage latency (complaint 5)
\`\`\`

**Two notes on the split.**

**Faithfulness runs in both places**, and that is its great advantage: **it needs only the context and the answer**, both of which exist in production. **So complaint 3's failure mode becomes continuously monitored**, not just tested offline.

**And abstention correctness is two-sided.** Declining when an answer exists is complaint 4; **answering when none exists is complaint 3.** **One metric, two directions, and a system can be tuned from one failure straight into the other** — which is exactly why both directions are scored.

*The rephrase rate deserves emphasis:* **3% thumbs click-through means explicit feedback is nearly absent**, but **a user asking the same thing twice is a strong, free, unbiased signal** and it needs no user cooperation.

---

**Part 4 — instrumentation, and what complaint 4 needs**

\`\`\`
Per request, stored:
  request id, timestamp, user's team/role
  the raw query
  the rewritten/expanded query, if any
  THE FILTERS APPLIED (version, permission, type)
  retrieved chunk ids, with scores and ranks
  THE ASSEMBLED CONTEXT, verbatim as sent
  model, prompt version, parameters
  the answer, and its citations
  per-stage timings
  whether the system abstained, and why
\`\`\`

**To diagnose complaint 4 specifically, three of these are essential and one is usually missing.**

**The filters applied.** **"It cannot find anything" is very often a filter**, not a retrieval failure — a permission scope, or a version predicate excluding the handbook. **Without logging filters, this is invisible**, and it is the single most likely cause given complaint 1 shows version filtering is in play.

**The retrieved chunk ids with scores.** If the right chunk was retrieved at rank 7 with a score below the abstention threshold, **the diagnosis is a threshold, not retrieval** — a completely different fix.

**And the abstention reason.** **Did it decline because nothing scored above threshold, because the context was empty, or because the model chose to?** Three causes, one symptom.

*So the honest answer to "what must ship before complaint 4 is diagnosable" is: the whole trace, and the filters and abstention reason in particular.* **This is why instrumentation is week one.**

**The privacy note:** **the assembled context contains whatever the documents contain** — HR content, personal data. **So traces need a retention period, access controls, and to be excluded from general log search.** That is a real cost and it is not a reason to skip them.

---

**Part 5 — the release gate**

\`\`\`
On any change to chunking, prompts, model, retriever,
index parameters or filters:

  1. Run the full eval set
  2. Compare PER CATEGORY against the baseline

  BLOCK on:
    · faithfulness down at all
        → safety property; complaint 3
    · false-answer rate on unanswerable items up
        → same failure, measured directly
    · any category down by more than the set's
      noise band
    · correct-version rate down
        → complaint 1 is a compliance issue

  WARN on:
    · overall average down
    · abstention rate moved more than 20% in
      either direction
        → both directions are failures

  REQUIRE:
    · the change moved the metric it was meant to
      move, stated in advance
\`\`\`

**Three decisions worth defending.**

**Faithfulness and unanswerable-item behaviour block absolutely.** **These are safety properties**, and a system that invents an office is worse than one that is unhelpful. **No average improvement compensates.**

**Per-category blocking rather than the average.** **A chunking change that fixes procedures and breaks version handling nets out positive** — and ships complaint 1 straight back. **The categories exist precisely to make that visible.**

**And "state what the change should move, in advance."** It is a process rule and it is cheap: **an improvement nobody predicted is usually noise or a metric artefact**, and requiring the prediction makes people think about the mechanism.

*The gate must not be flakier than the signal.* **At 200 items, a single item is 0.5%**, so a noise band of a few points per category is honest. **A gate that fires spuriously gets disabled**, which is worse than no gate — so I would run the set three times on an unchanged system first **to measure the actual variance** before setting thresholds.

---

**Week one, and why that order**

\`\`\`
Week 1  INSTRUMENTATION + the ticket-queue eval set
        · engineer A: full tracing, deployed
        · engineer B: mine 4 months of tickets and
          thumbs-down into eval items, chase domain
          experts for source passages
Week 2  METRICS
        · retrieval metrics against the eval set
        · faithfulness with a calibrated judge
        · the 50-item human calibration — half a day,
          and everything downstream depends on it
Week 3  GATE + the obvious fixes the data reveals
        · wire the gate into CI
        · fix whatever the numbers say is worst,
          which by then is evidence rather than guess
\`\`\`

**Why instrumentation first.** **Complaint 4 is undiagnosable without it**, and more importantly **every future complaint is** — so each week without tracing produces more unanswerable reports. **It also feeds the eval set**: a traced bad answer with an identified source passage is a finished eval item.

**Why the eval set runs in parallel rather than after.** It is human-bound work — **chasing domain experts has latency the engineer cannot compress** — so it should start on day one and proceed while tracing is built.

**Why fixes come last.** **Three of the five complaints have plausible fixes that are guesses**, and the team has three weeks. **Spending week one on a guessed fix produces an unmeasurable change**; spending it on measurement means week three's fix is directed and its effect is provable. **The complaints have existed for four months — two more weeks is cheap against shipping the wrong fix.**

*The one exception I would make:* **if the trace confirms complaint 3 is invention, add a grounding instruction and a citation requirement immediately.** It is a prompt change, it is reversible, **and inventing an office is a trust failure that compounds.**

---

**What I would deliberately not build**

**A custom evaluation framework.** The metrics here are standard and libraries implement them. **Two engineers in three weeks have no business writing a framework**, and the value is entirely in the eval set and the traces — **which are ours and which nothing off the shelf provides.**

**Per-query automated root-cause attribution.** Tempting, and it is a research project. **The traces plus per-stage metrics let a human diagnose in minutes**, which is sufficient at this volume.

**A/B testing infrastructure.** **The offline gate answers "did this change help" well enough at this stage**, and online experimentation needs traffic volumes and a duration this team does not have.

**Fine-tuning anything.** **Every complaint here is a retrieval, filtering or prompting failure**, and none of them is a model-capability failure. **Fine-tuning is the expensive answer to a question nobody has asked yet.**

**And a comprehensive eval set covering every document.** **200 stratified items built from real failures beat 5,000 generated ones**, and the generated set would report better numbers while catching none of the five complaints. *The temptation is real, because generating 5,000 items takes an afternoon and the number looks impressive* — **which is precisely the trap.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-rev-1',
      level: 'basic',
      question: 'How would you know if this RAG system is working?',
      guidance:
        'Look for the failure decomposition rather than a single score, and for the recognition that an eval set with known answer locations is the prerequisite.',
    },
    {
      id: 'iq-rev-2',
      level: 'basic',
      question: 'What goes into one eval item?',
      guidance:
        'Question, expected answer, source passages, answerable flag, category. The source passage is the expensive field and the one that makes retrieval measurable.',
    },
    {
      id: 'iq-rev-3',
      level: 'intermediate',
      question: 'Recall is 94% and users still complain. What now?',
      guidance:
        'Retrieved and unused, or invention. Strong answers reach for faithfulness and for the stored assembled context that makes the distinction possible.',
    },
    {
      id: 'iq-rev-4',
      level: 'intermediate',
      question: 'How do you build the eval set without spending months on it?',
      guidance:
        'Mine the ticket queue and thumbs-down conversations first, then domain experts. Generated questions for coverage only, because they overstate quality.',
    },
    {
      id: 'iq-rev-5',
      level: 'advanced',
      question: 'You are using a model to judge the answers. What could go wrong?',
      guidance:
        'Uncalibrated, biased toward length and confidence, drifting on upgrade, and self-judging inheriting blind spots. Look for a calibration step and version pinning.',
    },
    {
      id: 'iq-rev-6',
      level: 'advanced',
      question: 'Which parts of your evaluation can run in production?',
      guidance:
        'Anything not requiring ground truth — faithfulness, relevance, abstention rate, citation validity. The input list of a metric determines where it can run.',
    },
    {
      id: 'iq-rev-7',
      level: 'followup',
      question: 'The eval average went up. Is that enough to ship?',
      guidance:
        'No — per-category scores, and specifically whether abstention or faithfulness regressed. Relevance rising because the system declined less often is a regression.',
    },
    {
      id: 'iq-rev-8',
      level: 'followup',
      question: 'A user says the answer was wrong. What do you look at?',
      guidance:
        'The trace: filters applied, retrieved chunks with scores, and the assembled context verbatim. Then the complaint becomes an eval-set row.',
    },
  ],

  activeLearning: [
    {
      id: 'al-rev-1',
      kind: 'explain-yourself',
      prompt:
        'A colleague says: "We have a 200-item eval set scoring 91%, and users are still unhappy. The eval set must be wrong." Explain the four distinct ways an eval set can score well on a system users dislike, and how you would tell which is happening.',
      discussion: `**The colleague's inference is half right — the eval set is not measuring what users experience — but "wrong" hides four different problems with four different fixes.** Working through them is more useful than rebuilding the set.

**Way 1 — the distribution is wrong: the eval set asks easier questions than users do.**

\`\`\`
Eval set:  built from documentation, phrased clearly,
           one fact per question
Users:     ambiguous, multi-part, context-dependent
           "why did my thing not work" rather than
           "what is the retention period for X"
\`\`\`

**This is the default failure when questions were generated or written by the team**, because people writing test questions write questions they know are answerable. **The set measures the system on the questions it was built to pass.**

*How to tell:* **sample 50 real production queries and run them through the eval process manually.** If the score on those is dramatically lower than 91%, **the distribution is the problem** — and the fix is to build eval items from production traffic, not to change the metrics.

**Way 2 — the stratification is wrong: one category is failing and the average hides it.**

\`\`\`
Factual lookup  160 items × 97% = excellent
Procedures       40 items × 67% = terrible
Average                     91%
→ and if 40% of real traffic is procedural,
  users experience 67%
\`\`\`

**The set is not wrong; the reporting is.** **A single number over a stratified set is an average weighted by the set's composition rather than by traffic.**

*How to tell:* **score per category and compare the category weights against real traffic volumes.** This is the cheapest check on the list — **it requires no new data**, only reporting what the set already contains.

*And the fix has two halves:* **re-weight the set toward the real distribution**, and **report per category permanently**, because the average will hide the next one too.

**Way 3 — the metrics are wrong: the system passes what is measured and fails what matters.**

\`\`\`
Measured:    is the answer factually correct?
Experienced: it is correct, takes 40 seconds, gives
             six paragraphs when one would do, and
             cites nothing so nobody can verify it
\`\`\`

**Correctness is necessary and not sufficient.** **Users judge latency, length, citation, tone and whether they can act on it** — and a correctness-only evaluation is blind to all of it.

*How to tell:* **read the complaints.** If they are about the answer being wrong, the metrics are aimed right; **if they are about speed, verbosity or trust, the metrics are measuring the wrong axis entirely.** **This is a five-minute check and it is often skipped in favour of rebuilding the eval set.**

**Way 4 — the judge is wrong: the score is not measuring what its name says.**

\`\`\`
An uncalibrated judge scoring "correctness"
may be scoring plausibility, or length, or
confidence of tone
→ 91% means 91% of answers LOOKED right to a
  model that was never checked against a human
\`\`\`

**This is the one with no external symptom**, which makes it the easiest to leave in place for months.

*How to tell:* **score 50 eval items by hand and compare with the judge.** **Below roughly 80% agreement the judge is measuring something else**, and every number derived from it is unusable. **This should have happened before the judge was trusted**, and doing it late is still doing it.

**How I would sequence the diagnosis**, cheapest first:

\`\`\`
1. Read 30 complaints        (30 min) → way 3?
2. Score the set per category (1 hour) → way 2?
3. Calibrate the judge on 50  (half day) → way 4?
4. Run 50 production queries  (1 day)  → way 1?
\`\`\`

**And the ordering matters because ways 2 and 3 need no new data.** **The colleague's instinct — rebuild the set — is the most expensive option and is only correct for way 1**, which is the last thing to check rather than the first.

**What I would say to the colleague.**

**"The eval set is probably not wrong; it is probably not representative, and those need different fixes."** **A set that measures the wrong distribution is repaired by adding production questions; a set whose average hides a category is repaired by reporting differently; a set measuring the wrong axis is repaired by adding metrics; and a set with an uncalibrated judge is not measuring anything until that is fixed.**

*The deeper point:* **an eval set is a model of the users, and 91% on a model of users is a claim about the model, not about the users.** **The gap between them is the thing to measure** — which is why production sampling and a fixed eval set are both needed, **and why the fixed set has to be refreshed from production periodically rather than built once.**`,
    },
    {
      id: 'al-rev-2',
      kind: 'modify-architecture',
      prompt:
        'Take the evaluation you would build for a document-QA assistant and adapt it for an agent that takes actions — filing tickets, updating records, sending emails. What survives, what breaks, and what has to be invented?',
      discussion: `**The stage decomposition survives and almost every metric breaks**, because the output is no longer text to be judged but a change to the world.

**What survives.**

**The four-cause decomposition generalises**, with the stages renamed:

\`\`\`
QA:     corpus → retrieval → generation → answer
Agent:  tools available → tool selection →
        argument construction → execution → outcome
\`\`\`

**And the same discipline applies: score each stage against what it alone controls.** **Did it pick the right tool? Given that tool, were the arguments right? Given correct arguments, did execution succeed?** **Three failures needing three different fixes**, exactly as before.

**The eval set as the expensive prerequisite survives**, and gets more expensive. **Traces survive and matter more.** **Offline-versus-online survives.** **And calibrating a judge survives**, where judging still applies.

**What breaks, and this is most of it.**

**Faithfulness has no meaning.** There is no retrieved context and no claim to check against it. **The nearest equivalent is "was the action justified by the state the agent observed"** — which is a different and harder question, because **the agent's observations are partly the result of its own earlier actions.**

**Correctness is no longer comparable to a reference.** Two different action sequences can both be correct — **filing the ticket then notifying, or notifying then filing** — so an eval item cannot hold "the expected trajectory". **It has to hold the expected end state**, which means the evaluation checks the world rather than the output.

\`\`\`
QA eval:    compare answer text to expected answer
Agent eval: run in a sandbox, then ASSERT on the
            resulting state
              · a ticket exists, with these fields
              · no email was sent to the customer
              · the record's status is 'pending'
\`\`\`

**Which makes the eval set a set of fixtures plus assertions** — **much closer to an integration test suite than to a QA dataset.**

**And evaluation stops being free of side effects.** **This is the break that changes everything:** a QA eval can run a thousand times against production data safely. **An agent eval files a thousand tickets** unless there is a sandbox — **so a sandbox with seeded state and real-looking tool implementations is a prerequisite, not an optimisation.**

*Which also means online evaluation is largely unavailable.* **Faithfulness could run on production QA traffic; nothing equivalent can run on production actions**, because you cannot re-run an action to check it. **Online becomes outcome monitoring — reversal rate, complaint rate, human-override rate — rather than evaluation.**

**What has to be invented.**

**Trajectory metrics**, because the path matters and not only the destination:

\`\`\`
· steps taken versus minimum necessary
    → a loop that takes 14 steps to do 3 things
      is a failure even if the end state is right
· redundant or repeated tool calls
· destructive actions attempted
    → the count that must be zero
· recovery: after a tool error, did it adapt or
  retry identically?
\`\`\`

**Safety metrics as a separate first-class family.** **In QA the worst outcome is a wrong answer; here it is an irreversible wrong action.**

\`\`\`
· unauthorised action rate — attempted an action
  outside its permitted set
· confirmation compliance — did it seek approval
  where required
· blast radius — how many records touched versus
  expected
\`\`\`

**These block absolutely**, the way faithfulness did — **and more strictly, because a wrong answer is embarrassing and a wrong action is an incident.**

**Abstention becomes escalation**, and it is richer. **The QA system's "I don't know" becomes "I am not confident enough to do this, here is what I would do — approve?"** — **and the quality of the escalation is itself measurable**: escalating too often makes the agent useless, too rarely makes it dangerous, **and escalating with a bad summary makes the human's approval meaningless.**

**And an idempotency check.** **Agent evals must verify that re-running after a partial failure does not double-execute** — a property QA systems simply do not have, and the one most likely to be discovered in production.

**What I would build, concretely.**

\`\`\`
Sandbox with seeded fixtures, reset per eval item
Eval item:
  scenario + initial state
  the user's request
  assertions on the FINAL STATE
  forbidden actions (must not have occurred)
  expected escalations
  a step budget
Metrics:
  end-state correctness      (assertions pass)
  forbidden-action rate      (must be 0 — blocks)
  escalation precision/recall
  step efficiency
  idempotency under replay
Online:
  reversal rate, override rate, complaint rate
  — monitoring, not evaluation
\`\`\`

**The transferable point: the more a system acts rather than answers, the more its evaluation becomes an integration test suite and the less it is a dataset.** **Judgment gives way to assertion**, which is a gain in reliability — assertions do not need calibration — **paid for with a sandbox that must faithfully resemble the world.** **And the cost of a bad eval rises sharply**, because the thing being tested can no longer be simply wrong; it can be destructive.`,
    },
  ],

  revision: {
    bullets: [
      'A bad answer has four causes: not in the corpus, not retrieved, retrieved and unused, invented.',
      'Each needs a different fix, so a single quality score cannot direct any work.',
      'Score each stage against what it alone controls — the metric\'s inputs are its attribution.',
      'Faithfulness takes only context and answer, so it blames generation alone.',
      'Recall takes query, retrieved set and ground truth, so it blames retrieval alone.',
      'The eval set is the expensive prerequisite: question, expected answer, source passage, answerable, category.',
      'Build it from real questions and the ticket queue before anything generated.',
      'Generated questions are phrased like their source passage, so they overstate retrieval quality.',
      'About one item in ten must be unanswerable, or nothing measures abstention.',
      'Stratify by category, because 200 easy lookups hide a system that fails every procedure.',
      '"Helpfulness" rewards confident invention and penalises correct refusal.',
      'Calibrate a model judge against humans once, keep its task binary, and version it.',
      'Never let the generating model judge its own dimension — it inherits the blind spots.',
      'Offline answers "did this change help"; online answers "is it working now". Both are needed.',
      'Only ground-truth-free metrics can run online, which is what makes faithfulness so valuable.',
      'Traces must store the assembled context, or retrieval and generation failures are indistinguishable.',
      'Gate per category and block on faithfulness and abstention, which are safety properties.',
      'Relevance rising because the system declined less often is a regression disguised as an improvement.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The machinery that turns "the answer was wrong" into an attributable failure: per-stage metrics scored against a fixed eval set of questions with known answer locations, a calibrated judge for the parts requiring judgment, traces that record what the model was actually shown, and a release gate that blocks on safety properties.',
    whyItExists:
      'Because four different failures produce the same symptom and need four different fixes, and no single score can tell them apart — so the value of an evaluation is in its decomposition, not in its number.',
    whenToUse: [
      'Per-stage metrics whenever the evaluation is meant to drive engineering decisions.',
      'A fixed eval set for deciding whether a change helped.',
      'Production sampling for drift and incident detection.',
      'Faithfulness wherever answers are generated from retrieved context.',
      'Unanswerable eval items wherever abstention matters, which is everywhere.',
      'Full traces including the assembled context, from the first day.',
    ],
    whenNotToUse: [
      'A single helpfulness or quality score as the only measurement.',
      'Production sampling as a substitute for a fixed eval set.',
      'Model-generated questions as the only source of eval items.',
      'An uncalibrated judge whose agreement with humans was never measured.',
      'The generating model judging its own dimension.',
      'The eval average as the release gate.',
      'Recall at a k the system does not actually use.',
    ],
    alternatives: [
      'Human evaluation, for calibration and adversarial cases rather than volume.',
      'Behavioural signals — rephrase rate, escalation — where explicit feedback is sparse.',
      'End-state assertions rather than text judgment, once the system takes actions.',
      'Self-critique at runtime, which blurs evaluation into control and needs its own limits.',
    ],
    tradeoffs: [
      'Per-stage metrics buy attribution and cost an eval set.',
      'A model judge buys scale and costs a calibration step and version pinning.',
      'Generated eval questions buy coverage and cost accuracy of the number.',
      'A larger eval set buys a usable gate and costs curation time.',
      'Storing assembled contexts buys diagnosability and costs retention and access control.',
      'Blocking on regressions buys safety and costs release velocity when the set is noisy.',
    ],
    failureModes: [
      'A flat quality score while users complain, with no way to say why.',
      'Helpfulness rewarding confident invention over correct abstention.',
      'An eval set of generated questions reporting quality the system does not have.',
      'An average hiding one category collapsing.',
      'An uncalibrated judge measuring plausibility and being reported as correctness.',
      'A judge upgrade silently shifting every historical number.',
      'No stored context, so retrieval and generation failures are indistinguishable.',
      'No unanswerable items, so abstention degrades unnoticed.',
      'Recall measured at a k nobody uses.',
      'A gate flakier than its signal, and therefore disabled.',
      'Relevance improving because the system stopped declining.',
    ],
    followUpQuestions: [
      'How do you know whether this was a retrieval or a generation failure?',
      'What is in one eval item, and who produced it?',
      'Where did the questions come from?',
      'How many items are unanswerable, and what does that measure?',
      'Is the score reported per category or as an average?',
      'What is the judge, and how was it calibrated?',
      'Which metrics can run in production, and why those?',
      'What does the trace store, and could you diagnose yesterday\'s complaint from it?',
      'What blocks a release, and what only warns?',
      'How does a complaint become a regression test?',
      'How often is the eval set refreshed from production?',
    ],
  },
});
