import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-retrieval',
  title: 'Retrieval: hybrid search, reranking, context assembly',
  summary:
    'Why pure vector search under-performs in production, how hybrid retrieval and reranking fix it, and why the context window is a budget you spend rather than a container you fill.',
  phase: 'ai',
  module: 'retrieval',
  position: 75,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 60,
  tags: ['retrieval', 'hybrid-search', 'reranking', 'context-assembly', 'bm25', 'evaluation'],
  prerequisites: ['a-llm-app-architecture', 'a-embeddings', 'a-chunking-indexing'],
  resources: [
    {
      key: 'anthropic-contextual-retrieval',
      tier: 'must',
      note: 'The clearest published account of why chunks lose the context that made them findable, and what combining BM25 with embeddings actually buys. The measured deltas are the ones to quote in an interview.',
    },
    {
      key: 'lost-in-the-middle',
      tier: 'must',
      note: 'Evidence that where a passage sits in the context window changes whether the model uses it. Read this before you decide that "more context" is the answer to a retrieval problem.',
    },
    {
      key: 'elastic-bm25',
      tier: 'must',
      note: 'BM25 explained by its parameters rather than its formula. You need this to say why lexical search finds exact identifiers that embeddings miss.',
    },
    {
      key: 'qdrant-hybrid-queries',
      tier: 'good',
      note: 'A concrete implementation of fusing two ranked lists, including reciprocal rank fusion. Read it for the mechanics of combining scores that are not on the same scale.',
    },
    {
      key: 'pinecone-rerankers',
      tier: 'good',
      note: 'What a reranker does to a candidate list and what it costs in latency. Useful for reasoning about the retrieve-many-then-rerank-few shape.',
    },
    {
      key: 'dpr-paper',
      tier: 'good',
      note: 'The paper that established dense retrieval as competitive with lexical search. Read the evaluation section to see what "better retrieval" was actually measured as.',
    },
    {
      key: 'colbert-paper',
      tier: 'advanced',
      note: 'Late interaction: keeping per-token representations instead of collapsing to one vector. The strongest answer to "why does a single embedding lose information".',
    },
    {
      key: 'hyde-paper',
      tier: 'advanced',
      note: 'Generating a hypothetical answer and embedding that instead of the question. A neat fix for the query/document asymmetry this lesson describes.',
    },
    {
      key: 'rag-survey-paper',
      tier: 'advanced',
      note: 'A map of the whole design space once you have the fundamentals. Use it to find named alternatives, not as a reading assignment.',
    },
  ],

  intuition: {
    body: `Almost every disappointing RAG system fails in the same place, and it is not the model.

The usual story goes: embed the documents, embed the question, find the nearest neighbours, paste them into the prompt. It demos beautifully. Then someone asks about "the SLA in contract 4471-B" and the system confidently answers about a different contract, because nothing in the retrieval step ever cared about the string \`4471-B\`.

Here is the mental model that fixes this. **RAG is an information retrieval system that happens to end in a language model.** The language model is the last 10% of the pipeline and the least of your problems. If the right passage is not in the context, no model, no prompt and no temperature setting will save you — the information simply is not there.

That reframing has three consequences that run through the rest of this lesson:

1. **A single embedding is a lossy summary.** Compressing a paragraph into 1,536 numbers throws away exactly the kind of detail — identifiers, negations, rare terms — that queries often hinge on.
2. **Retrieval and ranking are different jobs.** Finding 100 plausible candidates cheaply and ordering 100 candidates precisely are different problems with different cost profiles. Trying to do both with one nearest-neighbour lookup does neither well.
3. **The context window is a budget, not a container.** Filling it is not free: it costs money, it costs latency, and — as measured research shows — burying the right passage in the middle of a long context makes the model *less* likely to use it.

The rest of this lesson is those three ideas turned into a design.`,
    analogyLimit:
      'The "search engine plus a model" framing is right but it hides one asymmetry that matters: a search engine is judged on the ranked list it returns, whereas a RAG system is judged on an answer, so a passage that ranks third and is never read is worth nothing. That is why context assembly is a first-class step here and only a presentation detail in classical search.',
  },

  deepExplanation: {
    predict: {
      question:
        'A support assistant retrieves over 200,000 help articles using embeddings only, top-5 by cosine similarity. Users complain it "makes things up". Before reading on, write down three distinct classes of query you would expect this system to fail on, and for each one say whether the failure happens in retrieval or in generation.',
      answer: `All three are **retrieval** failures. That is the point: they look like hallucination and they are not.

**1. Queries hinging on an exact string.** "Error code E_QUOTA_1042", "contract 4471-B", "the \`--no-verify\` flag". Embeddings map text into a semantic space where rare identifiers are near-noise; a document about a different error code is semantically almost identical. The passage containing the exact token may not be in the top 5 at all, or even the top 500. Lexical search finds these trivially, because a rare term is exactly what an inverted index with IDF weighting is good at.

**2. Queries whose answer is a negation or an exception.** "Which plans do *not* include priority support?" The embedding of that question sits extremely close to the embedding of "Which plans include priority support?" — the word "not" barely moves the vector. You retrieve the passage that says the opposite of what was asked, and the model, doing its job, answers from it.

**3. Queries whose answer spans multiple documents.** "How does the refund policy interact with annual billing?" Top-5 by similarity to a single query vector will usually return five passages about refunds *or* five about billing, because both clusters are dense and one dominates the neighbourhood. The intersection is what was needed and it was never retrieved.

There is a fourth worth knowing: **queries with no answer in the corpus at all.** Nearest-neighbour search always returns something — it has no concept of "nothing here is relevant". Five irrelevant passages arrive in the prompt, and a model that has been told to answer from context will do exactly that.

The generation step is behaving correctly in every one of these cases. Fixing the prompt will not help. This is why the first question to ask about a hallucinating RAG system is *was the right passage retrieved at all* — and why you cannot answer that without retrieval metrics separate from answer metrics.`,
    },
    body: `## Why a single embedding loses the thing you needed

An embedding model reads a chunk of text and emits one fixed-length vector. Everything the chunk said is compressed into that vector. Compression means loss, and the loss is not uniform — it is systematically worst for exactly the features that make a query specific.

**Rare tokens get averaged away.** A 200-word passage containing \`E_QUOTA_1042\` produces a vector dominated by the other 199 words. Two passages about quota errors with different error codes end up as near-neighbours. In lexical retrieval this is inverted: a term appearing in one document out of 200,000 has enormous inverse document frequency, so it dominates the score. The two methods fail on opposite things, which is the entire argument for using both.

**Negation barely registers.** "Plans that include priority support" and "plans that do not include priority support" differ by one high-frequency token. Cosine similarity between them is typically above 0.9. The embedding space encodes topic far more strongly than polarity.

**Query and document are different kinds of text.** A user types eight words that are a *question*. The corpus contains 200-word passages that are *answers*. They are not the same genre, and embedding both with the same model assumes a symmetry that does not hold. This asymmetry is the reason techniques like HyDE exist — generate a hypothetical answer to the question, embed *that*, and search answer-space with answer-shaped text.

None of this means embeddings are bad. They solve a problem lexical search cannot: "how do I cancel" finding a document titled "Terminating your subscription", where zero terms overlap. The conclusion is not "use BM25 instead". It is that the two methods have complementary failure modes, which is what makes combining them worth the complexity.

## Hybrid retrieval: combining two rankings that are not on the same scale

Run both retrievers, get two ranked lists, merge them. The merging is where the subtlety lives, because a BM25 score of 14.2 and a cosine similarity of 0.83 are not comparable — different ranges, different distributions, and both shift as the corpus changes.

**Score normalisation** rescales each list (min-max, or z-score) and takes a weighted sum. It preserves the *magnitude* of each retriever's confidence, which is useful. It is also fragile: normalisation depends on the score distribution of this particular result set, so the same document can score differently depending on what else was returned.

**Reciprocal rank fusion (RRF)** ignores scores entirely and uses only positions:

\`\`\`
score(d) = Σ over retrievers r of  1 / (k + rank_r(d))     with k ≈ 60
\`\`\`

A document ranked 1st by one retriever and 50th by another scores 1/61 + 1/110. A document ranked 10th by both scores 1/70 + 1/70 — slightly less. RRF rewards *agreement across retrievers* and is scale-free, which is why it is the sensible default: it has one parameter, it cannot be broken by a score distribution shift, and it works when you add a third retriever without retuning.

The constant \`k\` controls how sharply top ranks are favoured. Small \`k\` makes rank 1 dominate; large \`k\` flattens the curve so agreement matters more than any single retriever's top pick.

**A worked example.** Query: *"why is my export failing with E_QUOTA_1042"*

| Document | BM25 rank | Vector rank | RRF (k=60) |
| --- | --- | --- | --- |
| A — "Error E_QUOTA_1042 explained" | 1 | 47 | 0.0164 + 0.0093 = **0.0257** |
| B — "Troubleshooting failed exports" | 12 | 2 | 0.0139 + 0.0161 = **0.0300** |
| C — "Quota limits by plan" | 4 | 6 | 0.0156 + 0.0152 = **0.0308** |
| D — "Export formats reference" | 40 | 3 | 0.0100 + 0.0159 = 0.0259 |

Notice what happened. Document C, which neither retriever ranked first, comes out on top because both agreed it was relevant. Document A — the one containing the literal error code — is *third*, which is probably wrong for this query. RRF is a good default, not an oracle: it optimises for consensus, and consensus is the wrong objective when one retriever has decisive evidence the other cannot see.

Which is the argument for the next stage.

## Reranking: cheap recall, then expensive precision

Split the problem in two.

**Stage 1 — recall.** Retrieve 50–200 candidates as cheaply as possible. You are not trying to order them. You are trying to guarantee the right passage is *somewhere* in the set. Approximate nearest-neighbour search plus BM25 does this in tens of milliseconds.

**Stage 2 — precision.** Take those candidates and score each one against the query with a model that actually reads both together. A cross-encoder takes (query, passage) as a single input and outputs a relevance score. Because it sees both texts jointly, it can register that a passage mentions \`E_QUOTA_1042\` *and* that the query asked about it — a judgement a bi-encoder structurally cannot make, because it embedded the two separately and never compared them token to token.

The asymmetry in cost is what makes this work:

| | Bi-encoder (retrieval) | Cross-encoder (reranking) |
| --- | --- | --- |
| Document embeddings | Precomputed once | Not possible — depends on the query |
| Cost per query | One embedding + ANN lookup | One forward pass **per candidate** |
| Typical latency | 10–40 ms over millions of docs | 50–300 ms over 50–100 candidates |
| Quality | Good recall, mediocre ordering | Excellent ordering, unusable at corpus scale |

You cannot run a cross-encoder over 200,000 documents per query. You can run it over 100. So retrieve broadly and cheaply, rerank narrowly and well. **Retrieve 100, rerank, keep 5.**

The parameter that actually matters is the *candidate count*, and it has a specific meaning: it is your recall budget. If the right passage is not in the 100, the reranker cannot rescue it. So measure recall@100 (or whatever your candidate count is) separately from your final answer quality — that number tells you whether stage 1 or stage 2 is the problem, and no end-to-end metric can.

## Context assembly: the budget nobody prices

You now have 5 excellent passages. What you put in the prompt is still a decision, and it is the step most systems skip entirely.

**Order matters more than you expect.** Research on long contexts shows a pronounced U-shape: models attend most reliably to material at the very beginning and the very end of the context, and least reliably to material in the middle. If you paste your ranked passages in rank order, your best passage is at position 1 (good) and your second best is at position 2 (in the weak zone once the context is long). A common and effective arrangement is to place the strongest passage last — closest to the question — or to interleave so that ranks 1 and 2 occupy the first and last slots.

**More context is not more information.** Each additional passage adds tokens, cost and latency, and dilutes attention across more material. Beyond a handful of well-chosen passages, quality typically flattens and then declines. The right number is an empirical question for your corpus, and the way to answer it is to measure — not to fill the window because it is there.

**Deduplicate before assembling.** Overlapping chunks and near-duplicate documents mean your 5 passages may contain 2 distinct facts stated 5 ways. You have spent your budget on redundancy. Near-duplicate detection over the candidate set, before truncation, is cheap and recovers real capacity.

**Carry provenance.** Every passage should arrive with a stable identifier the model is instructed to cite. This is not a UI nicety: citations are the only mechanism that makes a wrong answer *diagnosable*. Without them you cannot tell whether a bad answer came from bad retrieval or bad generation, which is precisely the distinction the whole lesson is built on.

**Say what to do when nothing is relevant.** Retrieval always returns something. If the top reranked score is below a threshold, the correct behaviour is to say so rather than to answer from five irrelevant passages. That threshold is a product decision — it trades coverage against wrongness — and it should be set from measurement, not from a default.

## What the pipeline costs

A realistic per-query budget for a corpus of a few hundred thousand chunks:

| Stage | Latency | Notes |
| --- | --- | --- |
| Query embedding | 10–30 ms | One small model call; cacheable for repeated queries |
| ANN search | 5–20 ms | Sub-linear in corpus size; the parameters trade recall for speed |
| BM25 search | 5–20 ms | Runs in parallel with ANN, so it is usually free in wall-clock terms |
| Fusion | < 1 ms | Arithmetic |
| Rerank 100 candidates | 50–300 ms | The dominant cost, and the one that scales with candidate count |
| Generation | 500–3,000 ms | Dominates everything, which is why retrieval optimisation is usually worth it |

Two things follow. First, **run the two retrievers concurrently** — they are independent, and doing them in sequence adds latency for nothing. Second, **the reranker is your latency dial**: halving the candidate count roughly halves reranking time, and the cost is recall. That is a trade you can measure and tune, which makes it a good dial to have.

## Where this fails

- **The right passage was never indexed**, because chunking split it in half or the ingestion pipeline skipped that file type. No retrieval strategy recovers from this. It is why chunking is a retrieval decision, not preprocessing.
- **The right passage was retrieved and the model ignored it**, usually because it was buried mid-context or contradicted by another passage. Detectable only if you log what was retrieved alongside what was answered.
- **The corpus contradicts itself** — an old policy document and a new one, both retrieved. The model has no way to know which is current unless recency is part of ranking or the stale document is not indexed.
- **Permissions were applied after retrieval**, so the model saw content the user may not. Filtering must happen *inside* the retrieval query, not as a post-processing step over results the model has already read.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'retrieval-pipeline',
      title: 'Cheap recall, expensive precision, deliberate assembly',
      caption:
        'Step through it. The shape to notice is the funnel: 200,000 chunks → 100 candidates → 5 passages. Each narrowing uses a more expensive method than the one before, which is the only reason the expensive method is affordable at all.',
      nodes: [
        { id: 'query', label: 'User query', kind: 'client', x: 0, y: 160 },
        { id: 'embed', label: 'Embed query', kind: 'service', x: 170, y: 70, detail: 'One small model call, 10–30 ms. Cacheable: repeated or templated queries do not need re-embedding.' },
        { id: 'ann', label: 'Vector search', kind: 'store', x: 360, y: 40, detail: 'Approximate nearest neighbours over the whole corpus. Finds semantic matches where no words overlap; misses exact identifiers and negations.' },
        { id: 'bm25', label: 'Lexical search', kind: 'store', x: 360, y: 180, detail: 'Inverted index with IDF weighting. Finds rare tokens — error codes, contract numbers, flag names — that embeddings average away. Runs concurrently with the vector search, so it costs no extra wall-clock time.' },
        { id: 'fuse', label: 'Fuse rankings', kind: 'service', x: 550, y: 110, detail: 'Reciprocal rank fusion: score = Σ 1/(k + rank). Scale-free, one parameter, rewards agreement between retrievers. Produces ~100 candidates.' },
        { id: 'rerank', label: 'Cross-encoder rerank', kind: 'service', x: 730, y: 110, detail: 'Reads query and passage together and scores relevance jointly. 50–300 ms for 100 candidates. Impossible at corpus scale, which is exactly why stage one exists.' },
        { id: 'assemble', label: 'Assemble context', kind: 'service', x: 910, y: 110, detail: 'Deduplicate, order for the U-shaped attention curve, attach citations, and stop if the top score is below the relevance threshold.' },
        { id: 'llm', label: 'Generation', kind: 'external', x: 1080, y: 110, detail: '500–3,000 ms, and the dominant cost. If the right passage is not here, nothing this component does can recover it.' },
        { id: 'index', label: 'Indexed chunks', kind: 'store', x: 360, y: 320, detail: 'Built by the ingestion pipeline. A passage split badly here can never be retrieved well later — which is why chunking is a retrieval decision.' },
      ],
      edges: [
        { id: 'e1', source: 'query', target: 'embed', kind: 'sync' },
        { id: 'e2', source: 'query', target: 'bm25', label: 'terms', kind: 'sync' },
        { id: 'e3', source: 'embed', target: 'ann', label: 'vector', kind: 'sync' },
        { id: 'e4', source: 'ann', target: 'fuse', label: 'ranked list', kind: 'sync' },
        { id: 'e5', source: 'bm25', target: 'fuse', label: 'ranked list', kind: 'sync' },
        { id: 'e6', source: 'fuse', target: 'rerank', label: '~100 candidates', kind: 'sync' },
        { id: 'e7', source: 'rerank', target: 'assemble', label: 'top 5', kind: 'sync' },
        { id: 'e8', source: 'assemble', target: 'llm', label: 'prompt + citations', kind: 'sync' },
        { id: 'e9', source: 'index', target: 'ann', kind: 'read' },
        { id: 'e10', source: 'index', target: 'bm25', kind: 'read' },
      ],
      steps: [
        {
          id: 's1',
          title: 'Two retrievers, run concurrently, failing on opposite things',
          description:
            'The vector path finds "how do I cancel" in a document titled "Terminating your subscription" where no words overlap. The lexical path finds E_QUOTA_1042 where the embedding averaged it into noise. Running them in sequence would add latency for nothing — they are independent.',
          nodes: ['query', 'embed', 'ann', 'bm25'],
          edges: ['e1', 'e2', 'e3'],
        },
        {
          id: 's2',
          title: 'Fusion produces candidates, not answers',
          description:
            'Reciprocal rank fusion merges two lists that are not on the same scale by ignoring scores and using ranks. It rewards agreement — which is a good default and the wrong objective when one retriever holds decisive evidence the other cannot see. That is what the reranker is for.',
          nodes: ['ann', 'bm25', 'fuse'],
          edges: ['e4', 'e5'],
        },
        {
          id: 's3',
          title: 'The reranker is where precision is bought',
          description:
            'A cross-encoder reads query and passage together, so it can notice that the passage contains the exact term the query asked about — a comparison a bi-encoder structurally cannot make. Affordable over 100 candidates, impossible over 200,000. The candidate count is your recall budget and your latency dial.',
          nodes: ['fuse', 'rerank'],
          edges: ['e6'],
        },
        {
          id: 's4',
          title: 'Assembly is a decision, not a concatenation',
          description:
            'Deduplicate first, because five passages may hold two facts. Order for the U-shaped attention curve rather than by rank. Attach citations so a wrong answer stays diagnosable. And if the top score is below threshold, say nothing is relevant rather than answering from noise.',
          nodes: ['rerank', 'assemble', 'llm'],
          edges: ['e7', 'e8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'failure-attribution',
      title: 'Diagnosing a wrong answer',
      caption:
        'The point of this tree is that the first question is never about the prompt. Three of the four leaves are retrieval problems, and you cannot reach the right leaf without logging what was retrieved alongside what was answered.',
      code: `flowchart TD
    A[Answer is wrong] --> B{Is the correct passage<br/>in the index at all?}
    B -->|No| C[Ingestion or chunking problem<br/>No retrieval strategy fixes this]
    B -->|Yes| D{Is it in the<br/>candidate set?}

    D -->|No| E[Stage-1 recall problem]
    E --> E1[Add the missing retriever:<br/>lexical for identifiers,<br/>vector for paraphrase]
    E --> E2[Raise the candidate count]

    D -->|Yes| F{Did it survive<br/>reranking into the prompt?}
    F -->|No| G[Ranking problem<br/>Reranker or fusion weights]
    F -->|Yes| H{Did the model use it?}

    H -->|No| I[Assembly problem:<br/>buried mid-context,<br/>contradicted, or diluted]
    H -->|Yes| J[Generation problem<br/>— finally, a prompt question]

    style C fill:#2a1d1d,stroke:#b8383b
    style E fill:#2a1d1d,stroke:#b8383b
    style G fill:#2a1d1d,stroke:#b8383b
    style I fill:#2a1d1d,stroke:#b8383b
    style J fill:#17272a,stroke:#35897e`,
    },
  ],

  productionExample: {
    systems: ['Anthropic contextual retrieval'],
    body: `Anthropic published a study of retrieval quality on a set of document corpora, and the results are worth knowing precisely because they are measured rather than asserted.

The starting point is the failure this lesson opened with: chunking destroys context. A chunk that reads "The threshold was raised to 500 requests per minute in Q3" is unretrievable for the query "what is the rate limit for the analytics API", because the chunk never says which API or which threshold — that was established three paragraphs earlier and did not survive the split.

Their fix, *contextual retrieval*, prepends a short generated description of what each chunk is about, situated within its parent document, before embedding and indexing it. The chunk becomes self-describing, so both the embedding and the lexical index have something to match against.

The measured results follow the argument of this lesson closely:

- Embeddings alone produced a baseline retrieval failure rate.
- Adding contextual descriptions to the embedded chunks reduced failures substantially.
- **Adding BM25 alongside embeddings reduced them further**, which is the hybrid argument with numbers attached.
- **Adding a reranking stage on top reduced them further still** — the largest reported improvement came from combining all of them.

Three things to take from this, none of which require using their exact technique:

**The improvements compound because the methods fail differently.** Hybrid retrieval helps because BM25 and embeddings miss different queries. Reranking helps because it fixes ordering rather than recall. Contextual descriptions help because they fix the index rather than the query. Stacking three fixes to the *same* failure mode would not compound; stacking fixes to different ones does.

**Preprocessing cost is a legitimate design lever.** Generating a description for every chunk is a large one-off cost at ingestion. It buys permanently better retrieval on every subsequent query. Systems that read far more than they write should be biased towards paying at write time — the same reasoning that justifies an index in a database.

**The numbers are corpus-specific, and so are yours.** The right lesson is not "reranking gives you X% better". It is that they *measured retrieval failure separately from answer quality*, which is what let them attribute each improvement to a stage. Without that separation you can only observe that the system got better, and you will not know which change to keep.`,
  },

  tradeoffs: {
    intro:
      'These are the options for the retrieval stage itself, ordered by how much machinery they need. The first row is where every system should start, and a surprising number should stay there.',
    rows: [
      {
        option: 'Lexical search only (BM25)',
        whenItWins:
          'Technical corpora dominated by exact terms — error codes, API names, part numbers, legal references. Also when the corpus is small enough that users will phrase queries in the document\'s own words.',
        whenItLoses:
          'Paraphrase. "How do I cancel" will not find "Terminating your subscription" if no terms overlap.',
        cost:
          'Almost nothing: a mature inverted index, no embedding model, no GPU, no vector store to operate. Fully explainable results.',
      },
      {
        option: 'Dense vector search only',
        whenItWins:
          'Natural-language questions over prose where users and documents use different vocabulary, and where exact identifiers rarely matter.',
        whenItLoses:
          'Rare tokens, negations, and any query where a specific string is the whole point. Also fails silently — it always returns neighbours.',
        cost:
          'An embedding model on the write and read path, a vector index to size and tune, re-embedding the corpus whenever the model changes, and results you cannot explain to a user.',
      },
      {
        option: 'Hybrid: both retrievers, fused by rank',
        whenItWins:
          'Almost any production corpus, because real query mixes contain both paraphrase and exact-term queries. This is the sensible default.',
        whenItLoses:
          'When one modality is overwhelmingly dominant and the second retriever only adds operational surface for no measured gain.',
        cost:
          'Two indexes to keep in sync, a fusion parameter, and the discipline to measure whether the second retriever actually helped on your corpus.',
      },
      {
        option: 'Hybrid plus cross-encoder reranking',
        whenItWins:
          'When precision at the top matters — few passages fit in the budget, and getting the best one into position 1 is worth 100–300 ms.',
        whenItLoses:
          'Tight latency budgets, or when recall rather than ordering is the problem. A reranker cannot promote a passage that was never a candidate.',
        cost:
          'The dominant latency in the retrieval path, a second model to serve and version, and a candidate-count parameter that trades recall against speed.',
      },
      {
        option: 'No retrieval: put the whole corpus in the context window',
        whenItWins:
          'Genuinely small corpora — a few hundred thousand tokens, stable, where every query may need any part of it. With prompt caching this is cheap and has no retrieval failure modes at all.',
        whenItLoses:
          'Anything that grows. Cost and latency scale with corpus size on *every* query, and attention degrades over long contexts, so quality falls as the corpus grows.',
        cost:
          'Per-query token spend proportional to corpus size, and a hard ceiling you will hit without warning.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The model is hallucinating, so I would improve the prompt and lower the temperature."',
      whyWeak:
        'It assumes the failure is in generation without checking. In most RAG systems the majority of wrong answers are cases where the correct passage was never in the context — the model answered faithfully from what it was given. Prompt engineering cannot conjure information that is not there, and time spent there is time not spent on the actual defect.',
      strongAnswer:
        '"First I would find out whether the right passage was retrieved. I would log the retrieved chunk ids alongside each answer and check a sample of failures against a labelled set. If recall@k is the problem, prompting is irrelevant. If the passage was present and ignored, then it is an assembly or generation problem and I would look at position in the context and at contradictions between passages."',
    },
    {
      weakAnswer: '"I would use embeddings because they understand meaning, unlike keyword search."',
      whyWeak:
        'It treats the two as a hierarchy rather than as complementary. Embeddings compress a passage into one vector, which systematically discards rare tokens — the exact identifiers that queries most often hinge on. A search for a specific error code is a query where "understanding meaning" is precisely the wrong capability.',
      strongAnswer:
        '"They fail on different things, which is why I would run both. Embeddings find paraphrase where no terms overlap. BM25 finds rare identifiers that an embedding averages away, because IDF weighting makes a term appearing once in the corpus dominate the score. I would fuse the two ranked lists with reciprocal rank fusion, and I would measure whether the second retriever actually earns its place on this corpus."',
    },
    {
      weakAnswer: '"The context window is 200k tokens, so I would retrieve 50 chunks to be safe."',
      whyWeak:
        'Filling the window is not free. It costs tokens and latency on every query, it dilutes attention across more material, and measured research shows models attend least reliably to content in the middle of a long context — so the extra passages can actively reduce the chance that the good one is used. It also usually means retrieving several near-duplicates of the same fact.',
      strongAnswer:
        '"I would retrieve broadly — around 100 candidates — but only assemble the top few after reranking, deduplicated. The context window is a budget: more passages cost money, latency and attention. I would place the strongest passage adjacent to the question rather than in the middle, and I would find the right number empirically rather than by filling the window."',
    },
    {
      weakAnswer: '"I would add a reranker to improve retrieval quality."',
      whyWeak:
        'Conflates recall and precision. A reranker reorders the candidates it is given; it cannot promote a passage that stage one never returned. If the failure is that the right passage is not in the candidate set, a reranker adds latency and cost and changes nothing.',
      strongAnswer:
        '"A reranker fixes ordering, not recall. Before adding one I would measure recall at my candidate count — if the right passage is not in the top 100, that is a stage-one problem and I would fix the retrievers or raise the candidate count. Once recall is good and ordering is the weakness, a cross-encoder over the candidates is the right tool and I would budget 100 to 300 milliseconds for it."',
    },
    {
      weakAnswer: '"We filter out documents the user cannot see before showing the answer."',
      whyWeak:
        'The model has already read them. Anything in the context can leak into the answer through paraphrase, summary or inference, and no output filter reliably catches that. This is a data-access control implemented at the presentation layer, which is not an access control.',
      strongAnswer:
        '"Permissions have to be part of the retrieval query itself — a filter inside the vector and lexical searches, so unauthorised chunks are never candidates. Post-filtering means the model saw content it should not have. It also changes the ranking: filtering after retrieval means the top k shrinks unpredictably per user, so the filter has to happen before the k is taken."',
    },
  ],

  flashcards: [
    {
      id: 'fc-ret-1',
      front: 'Why does dense vector search miss queries containing an exact identifier like an error code?',
      back: 'A single embedding compresses the whole passage, so a rare token is averaged in with everything else. Lexical search does the opposite: IDF weighting makes a term appearing once in the corpus dominate the score.',
      topic: 'retrieval',
    },
    {
      id: 'fc-ret-2',
      front: 'Why do embeddings handle negation badly?',
      back: '"Plans that include X" and "plans that do not include X" differ by one high-frequency token, so their vectors sit very close. Embedding space encodes topic far more strongly than polarity.',
      topic: 'retrieval',
    },
    {
      id: 'fc-ret-3',
      front: 'What is reciprocal rank fusion and why prefer it over score normalisation?',
      back: 'score(d) = Σ 1/(k + rank) across retrievers, k ≈ 60. It uses only positions, so it is scale-free, has one parameter, cannot be broken by a score-distribution shift, and extends to a third retriever without retuning.',
      topic: 'hybrid-search',
    },
    {
      id: 'fc-ret-4',
      front: 'What is RRF\'s implicit objective, and when is that objective wrong?',
      back: 'It rewards agreement between retrievers. That is wrong when one retriever holds decisive evidence the other cannot see — an exact identifier match — because consensus then demotes the correct passage.',
      topic: 'hybrid-search',
    },
    {
      id: 'fc-ret-5',
      front: 'What can a cross-encoder do that a bi-encoder structurally cannot?',
      back: 'Read the query and the passage together in one forward pass, so it can compare them token to token. A bi-encoder embeds each separately and only ever compares two compressed summaries.',
      topic: 'reranking',
    },
    {
      id: 'fc-ret-6',
      front: 'Why can a reranker not be run over the whole corpus?',
      back: 'It costs one forward pass per candidate and its scores depend on the query, so nothing can be precomputed. 100 candidates is 50–300 ms; 200,000 is not a system.',
      topic: 'reranking',
    },
    {
      id: 'fc-ret-7',
      front: 'What does the candidate count in a retrieve-then-rerank pipeline actually control?',
      back: 'Your recall budget and your latency. A passage outside the candidate set can never be promoted, so recall@candidate-count is the ceiling on everything downstream.',
      topic: 'reranking',
    },
    {
      id: 'fc-ret-8',
      front: 'What is the "lost in the middle" effect and what does it imply for context assembly?',
      back: 'Models attend most reliably to the start and end of a long context and least reliably to the middle. Put the strongest passage adjacent to the question rather than pasting passages in rank order.',
      topic: 'context-assembly',
    },
    {
      id: 'fc-ret-9',
      front: 'Why deduplicate retrieved passages before assembling the prompt?',
      back: 'Overlapping chunks and near-duplicate documents mean five passages may carry two distinct facts. You spend the context budget on redundancy and crowd out information you needed.',
      topic: 'context-assembly',
    },
    {
      id: 'fc-ret-10',
      front: 'Why must permission filtering happen inside the retrieval query rather than after it?',
      back: 'Post-filtering means the model already read the content, and it can leak through paraphrase or inference. It also breaks ranking, because the top-k shrinks unpredictably per user.',
      topic: 'retrieval',
    },
    {
      id: 'fc-ret-11',
      front: 'What is the first metric to check when a RAG system gives a wrong answer?',
      back: 'Whether the correct passage was retrieved at all — recall at the candidate count. Three of the four common failure causes are retrieval problems, and no prompt change fixes any of them.',
      topic: 'evaluation',
    },
    {
      id: 'fc-ret-12',
      front: 'When is "put the whole corpus in the context window" the right answer?',
      back: 'Small, stable corpora of a few hundred thousand tokens where any query may need any part. With prompt caching it is cheap and has no retrieval failure modes — but cost, latency and attention all degrade as the corpus grows.',
      topic: 'context-assembly',
    },
    {
      id: 'fc-ret-13',
      front: 'What does BM25\'s IDF term do, in one sentence?',
      back: 'It weights a term by how rare it is across the corpus, so a token appearing in one document out of 200,000 contributes far more to the score than a common word.',
      topic: 'bm25',
    },
  ],

  quiz: [
    {
      id: 'q-ret-1',
      kind: 'scenario',
      prompt:
        'Your assistant answers well on "how do I export my data" but fails on "why does export fail with E_QUOTA_1042", returning passages about unrelated errors. Retrieval is embeddings-only, top-5. What is the most likely cause?',
      options: [
        { id: 'a', label: 'The embedding averaged the rare identifier into the passage vector, so no lexical signal survived to match on' },
        { id: 'b', label: 'The model temperature is too high' },
        { id: 'c', label: 'Top-5 is too few passages for the model to reason over' },
        { id: 'd', label: 'The generation prompt does not instruct the model to be accurate' },
      ],
      correct: ['a'],
      explanation:
        'A single vector compresses the whole passage, and a rare token contributes very little to that compression. Documents about other quota errors are semantically near-identical. This is exactly the query class lexical retrieval handles trivially through IDF weighting, which is the argument for hybrid retrieval. Nothing about temperature or prompting addresses a passage that was never retrieved.',
      difficulty: 'core',
      topic: 'retrieval',
    },
    {
      id: 'q-ret-2',
      kind: 'scenario',
      prompt:
        'You add a cross-encoder reranker over the top 20 candidates. Answer quality barely moves. Investigation shows the correct passage is in the top 20 only 55% of the time. What should you do next?',
      options: [
        { id: 'a', label: 'Fix stage-one recall: add the missing retriever and raise the candidate count, then re-measure' },
        { id: 'b', label: 'Use a larger reranker model' },
        { id: 'c', label: 'Increase the number of passages sent to the model from 5 to 15' },
        { id: 'd', label: 'Rewrite the generation prompt to be more precise about citations' },
      ],
      correct: ['a'],
      explanation:
        'A reranker only reorders what it is given. With recall@20 at 55%, almost half of queries have no correct passage available at any position, and no reranker — however large — can promote something that is not there. Recall is the ceiling on everything downstream, which is why it has to be measured separately.',
      difficulty: 'core',
      topic: 'reranking',
    },
    {
      id: 'q-ret-3',
      kind: 'scenario',
      prompt:
        'A team moves from sending 5 retrieved passages to sending 40, reasoning that the 200k-token context window is mostly empty. Quality drops slightly and latency and cost rise sharply. What is the best explanation?',
      options: [
        { id: 'a', label: 'Attention degrades over long contexts and the extra passages were largely redundant, diluting the good ones' },
        { id: 'b', label: 'The model cannot process more than 5 passages at a time' },
        { id: 'c', label: 'The vector index returns lower-quality results when asked for more' },
        { id: 'd', label: 'Token limits caused silent truncation of the system prompt' },
      ],
      correct: ['a'],
      explanation:
        'Measured research shows a U-shaped attention curve: material in the middle of a long context is used least reliably. Passages 6 through 40 are also mostly near-duplicates and lower-ranked material, so the additional tokens buy little information while burying the strong passages. The context window is a budget, not a container.',
      difficulty: 'core',
      topic: 'context-assembly',
    },
    {
      id: 'q-ret-4',
      kind: 'multi',
      prompt:
        'Which of these are genuine reasons to prefer reciprocal rank fusion over weighted score normalisation? Select all that apply.',
      options: [
        { id: 'a', label: 'It is scale-free, so BM25 and cosine scores need not be made comparable' },
        { id: 'b', label: 'It is unaffected by shifts in a retriever\'s score distribution' },
        { id: 'c', label: 'Adding a third retriever requires no retuning' },
        { id: 'd', label: 'It always ranks the single best passage first' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'RRF uses only positions, which gives it all three practical advantages. It does not guarantee the best passage ranks first — it optimises for agreement across retrievers, which can demote a passage that only one retriever recognised as decisive. That limitation is precisely why a reranking stage follows fusion.',
      difficulty: 'advanced',
      topic: 'hybrid-search',
    },
    {
      id: 'q-ret-5',
      kind: 'scenario',
      prompt:
        'A knowledge assistant serves an organisation where documents have per-user permissions. The team retrieves the top 20 chunks, then removes any the user may not read, then sends the rest to the model. What is wrong?',
      options: [
        { id: 'a', label: 'Filtering must happen inside the retrieval query — the model has already read the content, and the per-user top-k is now unpredictable' },
        { id: 'b', label: 'Nothing; filtering results is the standard approach' },
        { id: 'c', label: 'Twenty chunks is too many to filter efficiently' },
        { id: 'd', label: 'The permissions should be enforced by the model via the system prompt' },
      ],
      correct: ['a'],
      explanation:
        'Two distinct defects. Security: content in the context can surface through paraphrase or inference regardless of what is filtered afterwards, so post-filtering is not an access control. Quality: after filtering, one user may be left with 18 passages and another with 2, because the k was taken before the filter. Both are fixed by making permissions part of the retrieval query.',
      difficulty: 'advanced',
      topic: 'retrieval',
    },
    {
      id: 'q-ret-6',
      kind: 'scenario',
      prompt:
        'Your corpus is 180,000 tokens of stable internal policy, and every query might touch any part of it. A colleague proposes building the full hybrid-plus-rerank pipeline. What is the strongest response?',
      options: [
        { id: 'a', label: 'At that size, putting the whole corpus in context with prompt caching removes every retrieval failure mode — build the pipeline when the corpus grows' },
        { id: 'b', label: 'Agree, because retrieval is always better than long context' },
        { id: 'c', label: 'Agree, but skip the reranker to save latency' },
        { id: 'd', label: 'Disagree, and use lexical search only' },
      ],
      correct: ['a'],
      explanation:
        '180,000 tokens fits in a large context window, and with prompt caching the repeated cost is small. Every retrieval failure mode in this lesson — recall, ranking, chunking, fusion — simply does not exist when nothing is being selected. The honest caveat is that this stops being true as the corpus grows, and that attention still degrades over long contexts, so it is a starting point rather than a permanent answer.',
      difficulty: 'advanced',
      topic: 'context-assembly',
    },
    {
      id: 'q-ret-7',
      kind: 'single',
      prompt: 'What does BM25\'s inverse document frequency term contribute?',
      options: [
        { id: 'a', label: 'It weights a term by how rare it is across the corpus' },
        { id: 'b', label: 'It normalises for document length' },
        { id: 'c', label: 'It saturates the contribution of repeated terms within one document' },
        { id: 'd', label: 'It encodes the semantic similarity between query and document' },
      ],
      correct: ['a'],
      explanation:
        'IDF is the rarity weighting, and it is why a term appearing in one document out of 200,000 dominates the score. Length normalisation and term-frequency saturation are separate components of BM25 controlled by its b and k1 parameters. Semantic similarity is not something BM25 models at all — that is the gap embeddings fill.',
      difficulty: 'intro',
      topic: 'bm25',
    },
    {
      id: 'q-ret-8',
      kind: 'scenario',
      prompt:
        'You are asked to prove that adding a reranker was worth its 200 ms. What do you measure?',
      options: [
        { id: 'a', label: 'Retrieval metrics before and after reranking on a labelled set — for example whether the correct passage reaches the top 5 — alongside end-to-end answer quality' },
        { id: 'b', label: 'Average answer length before and after' },
        { id: 'c', label: 'Total tokens sent to the model before and after' },
        { id: 'd', label: 'User satisfaction ratings only' },
      ],
      correct: ['a'],
      explanation:
        'A reranker changes ordering, so the metric must be about ordering: how often the correct passage lands in the positions you actually send. Measuring only end-to-end quality tells you the system changed but not which stage improved, which is the attribution problem that makes RAG systems hard to tune. Satisfaction ratings are worth having but far too slow and noisy to attribute a single stage.',
      difficulty: 'core',
      topic: 'evaluation',
    },
  ],

  exercises: [
    {
      id: 'ex-ret-1',
      kind: 'debug',
      title: 'Attribute the failures before changing anything',
      estimatedMinutes: 22,
      prompt: `A RAG assistant over 400,000 chunks of internal engineering documentation is "wrong about 30% of the time". The current pipeline is: embed the query, ANN top-8, paste all eight into the prompt in rank order, generate.

You are given 100 failing queries. A colleague has already labelled, for each one, which chunk id contains the correct answer. You also have logs of which chunk ids were retrieved for each query.

Design the diagnosis. Specifically:

1. The exact sequence of checks you would run over those 100 failures, and what each check partitions the failures into.
2. What you would compute — name the metrics and say what value would worry you.
3. For each of the four possible buckets, the fix you would reach for first, and roughly what it costs.
4. Which single change you would ship first if you could only make one before the next review, and why.

Do not propose fixes before the diagnosis. That is the thing being assessed.`,
      rubric: [
        'Check 1: is the labelled chunk in the index at all? Partitions out ingestion and chunking failures, which no retrieval change can fix.',
        'Check 2: is the labelled chunk in the retrieved set? Computes recall@8 and separates recall failures from everything downstream.',
        'Check 3: if retrieved, at what rank? Separates ordering problems from generation problems.',
        'Check 4: if retrieved and well-ranked, did the answer contradict it? That is the only bucket where the prompt is the right thing to change.',
        'Names concrete metrics: recall@8, recall@100 (as the ceiling if candidates were widened), MRR or rank distribution of the labelled chunk, and the proportion of failures per bucket.',
        'States a worrying threshold with reasoning rather than a number pulled from nowhere — e.g. recall@8 below ~85% means stage one dominates and nothing else is worth tuning yet.',
        'Fixes are matched to buckets: ingestion → re-chunk or fix the parser; recall → add lexical retrieval and widen candidates; ranking → rerank or fusion; generation → prompt, citations, contradiction handling.',
        'Picks one change with a justification tied to the measured bucket sizes, not to what is fashionable.',
      ],
      modelAnswer: `**1. The sequence of checks**

The pipeline is a funnel, so diagnose it as one — each check answers "did the answer survive this stage", and the first "no" is the bucket.

*Check A — is the labelled chunk in the index?* Look up each labelled chunk id in the index. A miss here means ingestion never produced it, or chunking split the answer across a boundary so no single chunk contains it. **Bucket 1: ingestion.** Nothing downstream can fix these, so they must be separated first or they will contaminate every other measurement.

*Check B — was it in the retrieved set of 8?* Compare labelled chunk id against the logged retrieved ids. **Bucket 2: recall.** The correct passage was never a candidate.

*Check C — if retrieved, at what rank?* Ranks 1–3 sit in the reliably-attended region; ranks 6–8 in a rank-ordered prompt are the weak middle. **Bucket 3: ranking and assembly.** The passage was present but positioned where it was unlikely to be used.

*Check D — retrieved and well ranked, but the answer still wrong.* Read the answers. Did the model contradict the passage, or did another retrieved passage contradict it? **Bucket 4: generation.** This is the only bucket where prompting is the right lever, and in my experience it is the smallest.

**2. What to compute**

| Metric | What it tells me | Value that would worry me |
| --- | --- | --- |
| Index coverage of labelled chunks | Whether ingestion is sound | Anything below 100% — this is a correctness bug, not a tuning parameter |
| recall@8 | Whether the current top-k contains the answer | Below ~85%. At that point stage one dominates and tuning anything else is wasted effort |
| recall@100 (re-run retrieval offline with k=100) | The ceiling a reranker could reach | If recall@100 is also low, widening candidates will not help and the retrieval *method* is wrong |
| Rank distribution of the labelled chunk | Whether the problem is presence or position | A long tail at ranks 5–8 says ordering; a cluster at rank 1 with wrong answers says generation |
| Bucket proportions | Where to spend the next two weeks | Any bucket over 30% is where the work is |

The recall@8 versus recall@100 gap is the single most informative number in the whole exercise: it distinguishes "the retriever cannot find this at all" from "the retriever finds it but ranks it badly", and those have completely different fixes.

**3. Fixes per bucket**

*Bucket 1 — ingestion.* Fix the parser or the chunking strategy. If answers straddle boundaries, increase overlap or chunk on semantic boundaries rather than fixed token counts. If whole file types are missing, fix the pipeline. **Cost:** a full re-index, hours to days depending on corpus size, plus re-embedding. Expensive but non-negotiable — everything else is built on it.

*Bucket 2 — recall.* Add BM25 alongside the embeddings and fuse with RRF. Engineering documentation is dense with exact identifiers — flag names, config keys, error strings — which is the query class embeddings systematically miss, so I would expect this bucket to be large here. Simultaneously widen candidates from 8 to 100. **Cost:** a second index to build and keep in sync; roughly 10–20 ms added latency since it runs concurrently with the ANN query.

*Bucket 3 — ranking and assembly.* Add a cross-encoder reranker over the widened candidate set and send the top 4–5 rather than 8. Reorder so the top passage sits adjacent to the question. Deduplicate near-identical chunks first. **Cost:** 100–300 ms per query, a second model to serve and version.

*Bucket 4 — generation.* Require citations per claim, instruct the model to say when passages conflict rather than silently picking one, and add a relevance threshold below which it declines to answer. **Cost:** low — prompt and output-parsing work, plus some coverage lost to the threshold.

**4. The one change to ship first**

**Add BM25 and widen the candidate set from 8 to 100.**

Justification, in order:

- On an engineering-documentation corpus I would expect bucket 2 to be the largest, because the query mix is full of exact identifiers and the current pipeline has no lexical signal at all. The measurement decides this, but that is the hypothesis the corpus supports.
- It raises the ceiling for everything else. Reranking, better assembly and prompt work all operate on the candidate set; widening it and adding a complementary retriever increases what every later stage can possibly achieve.
- It is cheap in latency — the lexical query runs concurrently with the vector query — and it requires no new model to serve, unlike reranking.
- It is measurable in isolation: recall@100 before and after, on the same 100 labelled failures, with no confound from a changed prompt.

I would explicitly *not* start with the reranker, even though it is the more impressive change, because a reranker over a candidate set with poor recall improves nothing and costs 200 ms. Fix the ceiling before optimising against it.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-ret-1',
      level: 'basic',
      question: 'Walk me through what happens between a user asking a question and a RAG system answering it.',
      guidance:
        'Look for the funnel: embed, retrieve broadly, fuse, rerank, assemble, generate. A strong answer attaches a latency figure to each stage and notes that generation dominates the total. A weak answer is "embed, search, prompt" with no notion of candidate counts or ordering — which means the candidate has only built the demo version.',
    },
    {
      id: 'iq-ret-2',
      level: 'basic',
      question: 'Why would you use keyword search alongside embeddings? Is that not a step backwards?',
      guidance:
        'The answer must be about complementary failure modes, not about one being older. Embeddings lose rare tokens to compression; BM25 weights them heavily through IDF. Embeddings find paraphrase; BM25 cannot. A strong answer names a specific query class for each and says how it would decide, on a real corpus, whether the second retriever earns its operational cost.',
    },
    {
      id: 'iq-ret-3',
      level: 'intermediate',
      question: 'How do you combine two ranked lists whose scores are not comparable?',
      guidance:
        'Reciprocal rank fusion is the expected answer, with the formula and the intuition that it uses positions rather than scores. Strong answers contrast it with score normalisation and note that normalisation depends on the distribution of this particular result set. Excellent answers name RRF\'s bias towards agreement and identify when that bias is wrong.',
    },
    {
      id: 'iq-ret-4',
      level: 'intermediate',
      question: 'What does a reranker do, and why can you not simply use it as the retriever?',
      guidance:
        'A cross-encoder reads query and passage jointly, which is why it is accurate and why nothing can be precomputed — the representation depends on the query. That makes it one forward pass per candidate, fine over 100 and impossible over a corpus. A strong answer frames the whole design as cheap recall then expensive precision, and names the candidate count as the parameter connecting them.',
    },
    {
      id: 'iq-ret-5',
      level: 'advanced',
      question: 'Your RAG system hallucinates on 20% of queries. How do you find out why?',
      guidance:
        'The candidate must separate retrieval failure from generation failure before proposing anything. Look for: a labelled set, logging retrieved chunk ids alongside answers, recall at the candidate count, and rank distribution of the correct passage. Excellent answers note that the gap between recall@k and recall@candidates distinguishes "cannot find it" from "ranks it badly", and that these have entirely different fixes.',
    },
    {
      id: 'iq-ret-6',
      level: 'advanced',
      question: 'You have a 200k-token context window. Why not just retrieve 50 passages every time?',
      guidance:
        'Cost and latency scale linearly, attention degrades over long contexts with a measured U-shape, and lower-ranked passages are largely near-duplicates. A strong answer treats the window as a budget and mentions deduplication and ordering. An excellent answer inverts the question: for a genuinely small corpus, skipping retrieval and putting everything in context is the correct design, and says what corpus size flips that.',
    },
    {
      id: 'iq-ret-7',
      level: 'advanced',
      question: 'Documents have per-user permissions. Where does authorisation belong in this pipeline?',
      guidance:
        'Inside the retrieval query, as a filter on both the vector and lexical searches. Look for both reasons: security, because anything in the context can leak through paraphrase and no output filter reliably catches that; and quality, because post-filtering makes the effective top-k vary per user. Excellent answers mention that permission filters change ANN behaviour and may need pre-filtering support in the index rather than a post-hoc mask.',
    },
    {
      id: 'iq-ret-8',
      level: 'followup',
      question: 'You added contextual descriptions to every chunk at ingestion. What did that cost, and when is it not worth it?',
      guidance:
        'It costs one model call per chunk at ingestion — significant for a large corpus — plus a full re-index whenever the description prompt changes. It is worth it when reads vastly outnumber writes, which is the same reasoning that justifies a database index. It is not worth it for a corpus that changes constantly, or one small enough to fit in context, or where chunks are already self-describing.',
    },
    {
      id: 'iq-ret-9',
      level: 'followup',
      question: 'Your corpus contains an old policy document and its replacement, and both get retrieved. What now?',
      guidance:
        'The model cannot know which is current from the text alone. Options in increasing order of effort: do not index superseded documents; add recency or an explicit "current" flag to ranking; instruct the model to surface the conflict rather than resolve it silently. A strong answer notes this is a corpus-governance problem that retrieval tuning cannot solve, and that surfacing conflict is safer than picking a winner.',
    },
    {
      id: 'iq-ret-10',
      level: 'followup',
      question: 'How would you decide the number of passages to put in the prompt?',
      guidance:
        'Empirically, on a labelled set, sweeping the count and measuring answer quality against cost and latency. A strong answer expects the curve to rise, flatten, then decline, and knows the decline comes from attention dilution rather than from a hard limit. Excellent answers note the number is corpus- and model-specific and should be re-measured when either changes.',
    },
  ],

  activeLearning: [
    {
      id: 'al-ret-1',
      kind: 'what-changes-if',
      prompt:
        'Everything in this lesson assumes a corpus of static documents. Now change one thing: the corpus is a live database of support tickets, thousands of which are created and updated every hour, and answers frequently depend on the most recent ticket rather than the most relevant one. Which parts of the pipeline break, and which parts do not?',
      discussion: `Three things break, one thing quietly becomes the hard problem, and most of the pipeline is unaffected.

**What does not change.** Hybrid retrieval, fusion and reranking all still apply exactly as described. The reasons BM25 and embeddings fail differently have nothing to do with how often the corpus changes. If anything hybrid becomes *more* valuable, because ticket text is full of exact identifiers — ticket numbers, customer ids, error strings — which is the query class embeddings systematically miss.

**Break 1: indexing becomes a streaming problem.** A batch re-index is no longer viable. Every write has to reach both indexes with a latency the product can tolerate, and the two indexes will be inconsistent with each other for that window. If a chunk is in the lexical index but not yet the vector index, fusion sees it in one ranked list and not the other, and RRF will systematically down-weight it — the newest and most relevant content gets penalised precisely because it is new. That is a subtle failure worth designing against explicitly, usually by writing to both indexes in one transaction-like unit or by accepting a bounded staleness on both.

**Break 2: contextual descriptions become expensive in a new way.** In a static corpus, generating a description per chunk is a one-off cost amortised over every future query. With thousands of updates an hour it is a continuous model-call cost proportional to write volume, and an updated ticket needs its description regenerated. The economics that justified it — read-heavy, write-once — no longer hold. You would generate descriptions only for tickets that have stabilised, or drop the technique.

**Break 3: relevance is no longer the only ranking signal, and this is the real change.** "Most relevant" and "most recent" are different objectives, and the pipeline as described optimises only the first. A resolved ticket from two years ago may be a perfect semantic match and completely wrong as an answer. Options, in increasing sophistication:

- A hard recency filter in the retrieval query. Blunt, easy, and it will exclude the one genuinely relevant old ticket.
- Recency as an additional term in fusion — treat "sorted by recency" as a third ranked list and let RRF combine it. This fits the existing architecture neatly and has one parameter.
- A decay function applied to relevance scores. More expressive, more to tune, and it reintroduces the score-comparability problem RRF was chosen to avoid.

**And the quiet one: the ground truth moves.** Every evaluation technique in this lesson assumes a labelled set where the correct passage is stable. When tickets update, yesterday's correct answer becomes today's wrong one, and your golden set rots. This is the thing teams discover six months in: the retrieval metrics look fine because they are being measured against labels that no longer describe the corpus. Evaluation sets over live data need a refresh policy, and that policy is part of the system design rather than an afterthought.

**The transferable point.** When a corpus becomes live, ask three questions: what is now inconsistent between my indexes, what preprocessing did I amortise that I can no longer amortise, and what ranking signal did the change introduce that my pipeline does not model? Those three cover almost every practical difference between a static and a live retrieval system.`,
    },
    {
      id: 'al-ret-2',
      kind: 'explain-yourself',
      prompt:
        'Without looking back at the lesson, write the explanation you would give a competent engineer who says: "We already have Elasticsearch. Why would I add a vector database and a reranker rather than just tuning our BM25 queries?" Aim for six or seven sentences. Then reveal the discussion and compare — particularly on whether you conceded anything.',
      discussion: `A good answer to this question **concedes something real**, because the engineer has a strong position and pretending otherwise is how you lose the argument and the interview.

Here is one version:

> You might not need to. BM25 is excellent at exactly the queries your corpus probably sees most: exact terms, identifiers, product names — anything where the user and the document share vocabulary. Where it fails is paraphrase: "how do I cancel" will never match "Terminating your subscription", because there is no term overlap to score. Embeddings solve that specific failure and nothing else, so the question is what fraction of your query mix is paraphrase — and you can measure that from your existing search logs before building anything. If it is small, tune BM25 and stop; if it is large, add embeddings as a second retriever and fuse with reciprocal rank fusion rather than replacing what already works. The reranker is a separate decision entirely: it fixes ordering, not recall, so it only earns its 200 milliseconds once you have confirmed the right passage is reliably in your candidate set but not in the top few.

What makes that answer strong:

- **It opens with a concession** — "you might not need to" — which is true, and which signals engineering judgement rather than enthusiasm for new components.
- **It names the specific failure** each addition fixes, rather than claiming general superiority. "Embeddings understand meaning" is the weak version of this and invites a follow-up you cannot answer.
- **It proposes a measurement before a build**: the existing search logs already contain the evidence for whether paraphrase queries matter on this corpus.
- **It keeps BM25** rather than replacing it. A migration is a much larger ask than an addition, and the whole hybrid argument is that both are needed.
- **It separates the reranker from the retriever decision**, because they solve different problems and bundling them means neither can be evaluated.

Common weaknesses to check your own version against:

- Did you claim embeddings are simply better? They are not — they are better at one thing and worse at another.
- Did you propose replacing Elasticsearch? That is a much bigger and usually unnecessary change.
- Did you bundle the reranker in as though it were part of the same decision?
- Did you propose any way to find out whether you were right before building it?

That last one is the difference between an engineer who has read about RAG and one who has operated it.`,
    },
  ],

  revision: {
    bullets: [
      'RAG is an information retrieval system that ends in a language model. If the passage is not in the context, no prompt fixes it.',
      'A single embedding is a lossy summary: rare identifiers get averaged away, negation barely moves the vector, and query text is a different genre from document text.',
      'BM25 and embeddings fail on opposite things. That complementarity — not one being better — is the argument for hybrid retrieval.',
      'Fuse with reciprocal rank fusion: score = Σ 1/(k + rank), k ≈ 60. Scale-free, one parameter, extends to a third retriever without retuning.',
      'RRF optimises for agreement between retrievers, which is wrong when one retriever holds decisive evidence the other cannot see.',
      'Two stages: cheap recall over the corpus, expensive precision over the candidates. Retrieve 100, rerank, keep 5.',
      'A cross-encoder reads query and passage together, so nothing can be precomputed — one forward pass per candidate, affordable at 100 and impossible at 200,000.',
      'The candidate count is your recall budget. A reranker cannot promote a passage that stage one never returned.',
      'Measure recall at the candidate count separately from answer quality, or you cannot attribute a failure to a stage.',
      'Context is a budget: models attend most to the start and end of long contexts, so order deliberately rather than by rank.',
      'Deduplicate before assembling; five passages may carry two distinct facts.',
      'Carry citations. They are the only mechanism that makes a wrong answer diagnosable.',
      'Retrieval always returns something. Have a relevance threshold below which the system says nothing is relevant.',
      'Permission filters belong inside the retrieval query. Post-filtering means the model already read it, and the effective top-k varies per user.',
      'For a small, stable corpus, skipping retrieval and putting everything in context is a legitimate design with no retrieval failure modes.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The stage of an LLM application that selects which text the model gets to read: candidate generation over the corpus, precision ranking over the candidates, and deliberate assembly of the few passages that reach the prompt.',
    whyItExists:
      'A model can only reason over what is in its context, and a corpus never fits. Retrieval is the mechanism that decides what the model knows for this one query, which makes it the component that determines whether an answer is possible at all.',
    whenToUse: [
      'Corpora too large for the context window, or growing without bound.',
      'Content that changes faster than a model can be retrained or a prompt updated.',
      'Any system that must cite its sources or enforce per-user access to knowledge.',
    ],
    whenNotToUse: [
      'Small, stable corpora that fit in context — retrieval adds every failure mode in this lesson and removes none.',
      'Tasks that need no external knowledge: transformation, classification, formatting, extraction from text already supplied.',
    ],
    alternatives: [
      'Long context with prompt caching: no retrieval failure modes, cost and attention degrade with corpus size.',
      'Fine-tuning: encodes style and format well, encodes facts unreliably and cannot be updated per document.',
      'Structured queries against a database or API when the question is actually structured — retrieval over prose is the wrong tool for "how many open tickets does this customer have".',
      'Agentic search: let the model issue several queries and read results iteratively, trading latency and cost for recall on hard questions.',
    ],
    tradeoffs: [
      'More candidates means better recall and more reranking latency; the candidate count is the dial connecting them.',
      'More passages in the prompt means more cost, more latency and diluted attention — usually past a peak rather than up a slope.',
      'Preprocessing at ingestion (contextual descriptions, richer chunking) buys permanent retrieval quality and costs a re-index whenever it changes.',
      'Hybrid retrieval buys coverage across query classes and costs a second index to keep in sync.',
    ],
    failureModes: [
      'Correct passage never indexed, because chunking split it or ingestion skipped the file. Unrecoverable downstream.',
      'Correct passage not in the candidate set — a recall failure that no reranker can fix.',
      'Correct passage retrieved but buried mid-context, where attention is least reliable.',
      'Near-duplicate passages consuming the context budget with one fact stated five ways.',
      'No relevant passage exists, but nearest-neighbour search returns five anyway and the model answers from them.',
      'Stale and current documents both retrieved, with nothing in the ranking to distinguish them.',
      'Permissions applied after retrieval, so the model read content the user may not see.',
    ],
    followUpQuestions: [
      'Is this a retrieval failure or a generation failure, and what measurement told you?',
      'What is your recall at the candidate count, and what is the ceiling if you widened it?',
      'What happens when nothing in the corpus answers the question?',
      'How do you combine two rankings whose scores are not comparable?',
      'Where do permissions get enforced, and what does the model see before that happens?',
      'Why that many passages in the prompt, and what did the curve look like when you swept it?',
      'What breaks first when the corpus doubles?',
    ],
  },
});
