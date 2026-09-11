import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-embeddings',
  title: 'Embeddings and vector search',
  summary:
    'A vector index does not store meaning — it stores a point produced by one specific model, searched approximately. Every property of the system follows from those two facts, including the ones that surprise people.',
  phase: 'ai',
  module: 'retrieval',
  position: 73,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['vectors', 'ann', 'recall', 'filtering', 'indexing'],
  prerequisites: ['a-llm-app-architecture'],
  resources: [
    {
      key: 'hnsw-paper',
      tier: 'must',
      note: 'Read it for the graph construction and the search parameter. The whole recall-versus-latency dial is one number controlling how much of the graph is explored, and seeing why makes the tuning obvious rather than mystical.',
    },
    {
      key: 'faiss-repo',
      tier: 'must',
      note: 'Read the index-selection guidance. It is the clearest available account of the memory/recall/latency trade across index types, and it forces the question of how much RAM you are prepared to spend per vector.',
    },
    {
      key: 'openai-embeddings-guide',
      tier: 'must',
      note: 'Read it for dimensionality, normalisation and the distance metric that matches the model. Using the wrong metric degrades results silently, which is a failure mode with no error message.',
    },
    {
      key: 'pgvector-repo',
      tier: 'good',
      note: 'Read it as the case where vectors live beside relational data. It is the simplest answer to the filtering problem — because a pre-filter is just a WHERE clause — and it shows what that costs at scale.',
    },
    {
      key: 'qdrant-hybrid-queries',
      tier: 'good',
      note: 'Read the filtering sections specifically. Pre-filtering versus post-filtering is the decision that determines whether a permissions-aware search returns the right number of results, and this is where the mechanics are spelled out.',
    },
    {
      key: 'dpr-paper',
      tier: 'advanced',
      note: 'Read it for what a retrieval-trained embedding is optimising. It is the argument that general-purpose embeddings and retrieval-specific ones behave differently, which matters when you are choosing a model rather than accepting a default.',
    },
  ],

  intuition: {
    body: `Two facts about a vector index determine almost everything else, and both are easy to state and easy to forget.

**It stores a point, not a meaning.** An embedding is the output of one specific model on one specific input. **Change the model and every stored vector becomes noise** — not worse, but meaningless, because the new query vectors live in a different space. **So the model is part of the index's identity**, and swapping it is a migration rather than a configuration change.

**And the search is approximate.** Exhaustive nearest-neighbour search over ten million vectors is too slow, so every production index **trades recall for latency** — and the trade is a dial you set.

\`\`\`
Exhaustive:   100% recall, O(n) per query, unusable at scale
Approximate:  90–99% recall, sub-linear, and the exact figure
              is a parameter you chose — knowingly or not
\`\`\`

**"The index returns results in 12 ms" is not a claim about quality.** Without a recall number beside it, **it describes a system that might be missing a tenth of the right answers**, and nothing in the response says so.

Then the property that causes most production surprise: **similarity is not relevance.**

\`\`\`
"policy does not cover water damage"
"policy covers water damage"
→ nearly identical vectors. The negation is a small
  perturbation in a space built for topical similarity.

"error code E-4471"
→ a rare token averaged into a passage-level vector;
  lexical search finds it instantly and the embedding
  does not.
\`\`\`

**Embeddings are strong where words differ and meaning matches, and weak where words match and meaning differs** — which is precisely the opposite of lexical search, and why the next lessons combine them.

**And the arithmetic is worth internalising early**, because it decides the architecture:

\`\`\`
1,536 dimensions × 4 bytes = ~6 KB per vector
10 million chunks           = ~60 GB
→ graph indexes want this in memory
→ so the index size, not the corpus size, is the constraint
\`\`\`

**Finally the operational trap: filtering.** A query restricted to documents a user may see **either filters before the search, which distorts the graph, or after it, which can return fewer results than asked for** — and neither is free.`,
    analogyLimit:
      '"It finds semantically similar text" is right and stops before every decision that matters. It hides that the vectors belong to one model, so an upgrade silently invalidates the index; that the search is approximate, so recall is a number you chose; and that similarity is a proxy for relevance which fails on negation, rare identifiers and numeric comparison. It also makes filtering sound like a detail, when it decides whether a permissions-aware search returns anything at all.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team builds document search: every chunk embedded and stored in a vector index, queries embedded and matched by cosine similarity, top 10 returned, then filtered to the documents the user may see. Six months later they upgrade to a newer embedding model by changing the model name in the config. Identify four problems.',
      answer: `**Problem 1 — changing the embedding model invalidates every stored vector, and nothing errors.**

\`\`\`
Old vectors: points in model A's space
New queries: points in model B's space
→ the dimensionality may even match
→ cosine similarity still returns a number
→ the number is meaningless
\`\`\`

**Results become effectively random and the system reports success.** No exception, no validation failure — **just a gradual realisation that search stopped working**, which is the worst kind of outage.

*The fix:* **the model identity is part of the index's identity.** Store it as metadata, refuse queries whose model does not match, **and treat an upgrade as a re-embed of the entire corpus followed by an atomic switch** — which is a migration with a cost proportional to the corpus.

**Problem 2 — post-filtering returns fewer results than requested, and sometimes none.**

\`\`\`
Retrieve top 10 by similarity → filter to the user's
permitted documents
A user with access to 2% of the corpus:
  expected survivors ≈ 0.2 of 10
  → most queries return nothing
  → and the system reports "no results found"
\`\`\`

**The failure looks like an empty corpus and is actually a filtering artefact.** And it is worst for exactly the users with the narrowest access, **who are usually the ones with the most sensitive need.**

*Two fixes, with different costs:* **over-fetch and filter** — retrieve 200 to survive to 10, which works when the filter is mildly selective and fails badly when it is not — **or pre-filter**, restricting the search to the permitted subset, which is correct and interacts awkwardly with graph indexes.

**Problem 3 — no recall measurement, so the quality of the search is unknown.**

**Approximate search has a tuning parameter that trades recall for latency**, and a default value is a choice someone else made about your corpus. **Without measuring, the team does not know whether they are at 99% recall or 80%.**

*And 80% is not obviously broken from the outside:* **most queries still return something plausible**, so the missing fifth is invisible without a ground truth to compare against.

*The fix:* **exhaustive search on a sample.** Take 200 queries, run brute-force nearest neighbours, **and measure what fraction the index returns.** That number is the index's actual quality, and it should be on a dashboard.

**Problem 4 — cosine similarity assumed without checking the metric the model expects.**

**Some models produce normalised vectors where cosine and dot product are equivalent; others do not.** Using the wrong metric **degrades results without erroring** — the same silent-failure shape as problem 1.

**What the corrected design looks like.**

\`\`\`
· model id + dimensionality stored as index metadata,
  and enforced on query
· an upgrade = re-embed to a new index, verify, switch
· pre-filter on permissions where selectivity is high;
  over-fetch where it is low — chosen by measurement
· recall measured against exhaustive search on a sample,
  monitored, and reported alongside latency
· the distance metric matched to the model, asserted in a test
\`\`\`

**The transferable diagnostic: every silent failure here comes from a number that is still returned when the meaning is gone.** Cosine similarity always produces a value — **so the checks have to be structural rather than waiting for an error.**`,
    },
  body: `## What is actually stored

\`\`\`
text → embedding model → a vector of N floats
\`\`\`

**Three properties of that vector, each with a consequence.**

**It is model-specific.** The vector encodes position in a space the model defined during training. **Another model — even a newer version of the same one — defines a different space**, so vectors are not comparable across models and an upgrade is a full re-embed.

**It is fixed-dimension regardless of input length.** A sentence and a page produce the same-sized vector, **which means a long passage's distinctive details are averaged into the same budget as a short one's** — the mechanism behind the rare-identifier weakness, and the reason chunking is the next lesson.

**And it is dense.** Every dimension carries some signal, **so there is no sparse structure to exploit** the way an inverted index exploits term rarity. Search means comparing against everything, or approximating.

**The arithmetic that follows:**

\`\`\`
1,536 dims × 4 bytes (float32)  = 6.1 KB per vector
10 M chunks                     = 61 GB of vectors alone
+ graph structure (HNSW): ~M × 8 bytes per node
  at M = 16                     = ~1.3 GB
+ the payload you store alongside (ids, metadata)
\`\`\`

**Graph indexes want this resident in memory**, so **the index size rather than the corpus size determines the machine** — and a corpus of a few million chunks is a memory-sized problem rather than a disk-sized one.

*Which makes quantisation a real lever:* **storing 8-bit integers instead of 32-bit floats cuts memory four-fold** and costs some recall. **Product quantisation goes further and costs more.** Both are recall-for-memory trades, measurable in the same way as the search parameter.

## Approximate search, and the dial

**Exhaustive search is O(n) per query.** At ten million vectors and 1,536 dimensions, that is billions of floating-point operations — **hundreds of milliseconds at best**, which is why every production index is approximate.

**The two families you will meet:**

\`\`\`
GRAPH (HNSW)
  Build: each node linked to M neighbours, in layers
  Search: greedy descent, exploring ef_search candidates
  → recall rises with ef_search, and so does latency
  → excellent recall/latency, high memory, expensive updates

INVERTED FILE (IVF)
  Build: cluster vectors into nlist cells
  Search: probe the nprobe nearest cells
  → recall rises with nprobe, and so does latency
  → lower memory, cheaper updates, weaker at the same recall
\`\`\`

**In both cases one parameter is the dial**, and the shape of the trade is the same: **more exploration, more recall, more time.**

\`\`\`
ef_search = 40   → ~92% recall, ~3 ms
ef_search = 100  → ~97% recall, ~6 ms
ef_search = 400  → ~99.5% recall, ~20 ms
(illustrative — the actual curve is corpus-specific
 and must be measured)
\`\`\`

**The point is not the numbers but that the curve exists and is yours to sit on.** A default is a point someone else chose for a different corpus.

## Recall is a number you must measure

**Recall@k is the fraction of the true top-k that the approximate search returned.**

\`\`\`
1. Sample 200 real queries
2. For each, run EXHAUSTIVE search → the true top 10
3. Run the index → the approximate top 10
4. recall@10 = |intersection| / 10, averaged
\`\`\`

**Three things this gives you that nothing else does.**

**A quality number for the search itself**, separate from the quality of the answers. **When a RAG system gives a bad answer, this is the first thing to check** — and without it, retrieval and generation cannot be told apart.

**A tuning curve.** Measure at several parameter values and choose deliberately, **rather than accepting a default and discovering the consequence in user complaints.**

**And a regression signal.** Recall drifts as the corpus grows and as documents are added and deleted; **a monitored number catches that, and an unmonitored one does not.**

*The cost is small:* exhaustive search over a sample is a batch job run occasionally, **not something on the query path.**

## Similarity is not relevance

**Embeddings encode topical and semantic proximity**, which is a good proxy for relevance and not the same thing. **Four failure classes are worth knowing by name**, because they recur:

\`\`\`
NEGATION       "covers water damage" ≈ "does not cover water
               damage" — the negation is a small perturbation
               in a space organised by topic

RARE TOKENS    "error E-4471", "clause 14.2(b)", a part number
               → averaged into a passage vector; lexical
                 search finds them instantly

NUMERIC /      "invoices over £10,000", "changes since March"
TEMPORAL       → embeddings do not compare magnitudes; this is
                 a filter, not a search

DOMAIN JARGON  a term absent from the training distribution
               sits nowhere useful in the space
\`\`\`

**All four are cases where words match and meaning differs, or words differ and the model has no basis for the meaning** — **and all four are exactly where lexical search is strong**, which is the argument for hybrid retrieval two lessons from here.

*The honest framing for an interview:* **vector search is one retriever with a characteristic failure profile**, not a general-purpose search engine. **Knowing the profile is what lets you predict where it will disappoint.**

## Filtering, which is where permissions live

**Almost every real system restricts results — by tenant, by document permissions, by date, by type.** There are two ways and they behave very differently.

\`\`\`
POST-FILTER   search → get top k → discard what is not allowed
  + trivial to implement; works with any index
  − returns fewer than k, or nothing, when the filter is
    selective
  − and the shortfall is worst for the most restricted users

PRE-FILTER    restrict the candidate set, then search within it
  + always returns k results if k exist
  − a graph index cannot simply skip nodes: traversal
    depends on connectivity, so filtering can disconnect
    the graph and collapse recall
\`\`\`

**The selectivity of the filter decides which is workable.**

\`\`\`
Filter keeps 80% of the corpus → post-filter with over-fetch
                                  (fetch 2k, expect k)
Filter keeps 2%                → post-filtering fails; you
                                  would need to fetch 500 to
                                  get 10
\`\`\`

**And at high selectivity the right answer is often to partition rather than to filter**: **a separate index per tenant**, so the restriction is structural rather than a predicate. **That costs index overhead per tenant and makes the filter free.**

*The middle case is the hard one* — moderately selective filters over a shared index — **and it is where index implementations differ most**, some supporting filtered traversal that maintains connectivity and others not. **This is a question to ask of a specific system rather than to assume.**

## Choosing a model

**Three properties matter more than benchmark position.**

**Dimensionality**, because it sets the memory arithmetic. **A 3,072-dimension model doubles the index against a 1,536-dimension one**, which may decide the machine.

**The expected distance metric and normalisation.** Some models emit normalised vectors, where cosine and dot product coincide; **others do not, and using the wrong metric degrades results silently.** This belongs in a test.

**And whether it was trained for retrieval.** Retrieval-trained models optimise for query-to-passage matching, **which is an asymmetric relationship** — a short question against a long passage — whereas general-purpose embeddings optimise similarity between comparable texts. **The asymmetry matters**, and some models expect a prefix to distinguish query from document.

*And the thing that does not transfer:* **a leaderboard position.** As with model selection, **the measurement that counts is recall and end-task quality on your corpus** — and swapping models is expensive enough that it is worth measuring before committing.

## Operating the index

**Four operational facts that surprise teams.**

**Updates to a graph index are expensive.** Inserting a vector means finding neighbours and rewiring links; **at scale, incremental insertion degrades the graph's quality over time**, so periodic rebuilds are normal.

**Deletes are usually tombstones.** Removing a node from a graph would break traversal, **so deleted vectors are marked and skipped** — which means a deleted document is still occupying memory and still being traversed until a rebuild.

*And that has a security consequence worth naming:* **a tombstoned vector is skipped by filtering, not erased** — so a deletion requirement that means "this content must be gone" needs the rebuild, not just the delete.

**Freshness is a rebuild cadence, not a write latency.** "How quickly does a new document become searchable" is answered by the ingestion pipeline and the index's insert behaviour, **and for a graph index the honest answer often involves a delay.**

**And the index must be rebuildable from source.** The vectors are derived data — **the documents are the truth** — so a corrupt or lost index is a rebuild cost rather than a data loss, **provided the source and the chunking are reproducible.** That is worth ensuring deliberately.

## What to say in a design discussion

**That the model is part of the index's identity**, so an upgrade is a re-embed and an atomic switch.

**That the search is approximate and recall is a measured number**, with the tuning curve known for this corpus.

**That similarity is a proxy for relevance with four predictable failure classes**, which is why a second retriever will appear in the design.

**That filtering is pre or post**, chosen by selectivity, and that high selectivity usually means partitioning.

**That the memory arithmetic decides the machine**, and that quantisation is a recall-for-memory dial.

**And that the index is derived data**, rebuildable from documents, with deletes as tombstones until it is.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'index-lifecycle',
      title: 'What the index holds, and every decision attached to it',
      caption:
        'Step through it. Three of the five silent failures in this design come from a number still being returned after the meaning has gone — so the checks have to be structural rather than error-driven.',
      nodes: [
        { id: 'text', label: 'Chunk of text', kind: 'client', x: 0, y: 150, detail: 'A fixed-size vector regardless of length, so a long passage\'s distinctive details are averaged into the same budget as a short one\'s — which is the mechanism behind the rare-identifier weakness and the reason chunking is a retrieval decision.' },
        { id: 'model', label: 'Embedding model — part of the index identity', kind: 'service', x: 240, y: 150, detail: 'The vector is a point in a space this model defined. Another model defines a different space, so vectors are not comparable across models and cosine similarity still returns a number — meaningless, with no error. Store the model id as index metadata and enforce it on query.' },
        { id: 'index', label: 'Index: ~6 KB/vector, memory-resident', kind: 'store', x: 490, y: 150, detail: '1,536 dims × 4 bytes × 10 M chunks ≈ 61 GB before the graph. Index size rather than corpus size decides the machine, and quantisation is a recall-for-memory dial measurable the same way as the search parameter.' },
        { id: 'dial', label: 'The recall/latency dial', kind: 'note', x: 490, y: 20, detail: 'ef_search for a graph index, nprobe for an inverted file — more exploration, more recall, more time. A default is a point someone else chose for a different corpus, and "12 ms" without a recall figure describes a system that may be missing a tenth of the right answers.' },
        { id: 'filter', label: 'Filter: pre or post, by selectivity', kind: 'service', x: 740, y: 150, detail: 'Post-filtering returns fewer than k when the filter is selective — and the shortfall is worst for the most restricted users, who often have the most sensitive need. Pre-filtering is correct and can disconnect a graph. Above roughly 90% selectivity, partition instead.' },
        { id: 'recall', label: 'Recall measured against exhaustive search', kind: 'note', x: 740, y: 290, detail: '200 sampled queries, brute-force top 10, compare. It is the quality number for the search itself — the first thing to check when a RAG answer is wrong, and without it retrieval and generation failures cannot be told apart.' },
        { id: 'ops', label: 'Deletes are tombstones; the index is derived', kind: 'note', x: 240, y: 290, detail: 'A removed vector is marked and skipped, still resident and still traversed until a rebuild — so "this content must be gone" needs the rebuild, not the delete. And the documents are the truth, so a lost index is a rebuild cost rather than data loss.' },
      ],
      edges: [
        { id: 'v1', source: 'text', target: 'model', kind: 'sync' },
        { id: 'v2', source: 'model', target: 'index', kind: 'write' },
        { id: 'v3', source: 'dial', target: 'index', kind: 'control' },
        { id: 'v4', source: 'index', target: 'filter', kind: 'read' },
        { id: 'v5', source: 'filter', target: 'recall', kind: 'control' },
        { id: 'v6', source: 'index', target: 'ops', kind: 'control' },
      ],
      steps: [
        {
          id: 'vs1',
          title: 'A point, produced by one specific model',
          description:
            'Fixed dimension regardless of input length, dense, and tied to the model that made it. Change the model and every stored vector becomes noise while cosine similarity keeps returning numbers.',
          nodes: ['text', 'model'],
          edges: ['v1'],
        },
        {
          id: 'vs2',
          title: 'And the memory arithmetic decides the machine',
          description:
            'Six kilobytes per vector, and graph indexes want it resident. Ten million chunks is a sixty-gigabyte problem before any graph structure.',
          nodes: ['index'],
          edges: ['v2'],
        },
        {
          id: 'vs3',
          title: 'The search is approximate, and you set the dial',
          description:
            'One parameter trades recall for latency in both index families. A latency figure without a recall figure is not a quality claim.',
          nodes: ['dial'],
          edges: ['v3'],
        },
        {
          id: 'vs4',
          title: 'Then filtering, which is where permissions live',
          description:
            'Post-filter and a restricted user gets nothing; pre-filter and a graph may disconnect. Selectivity decides, and high selectivity usually means a separate index.',
          nodes: ['filter'],
          edges: ['v4'],
        },
        {
          id: 'vs5',
          title: 'Measure recall, and know the index is derived',
          description:
            'Exhaustive search on a sample gives the number that separates a retrieval failure from a generation one. And deletes are tombstones until a rebuild, which matters when deletion is a requirement rather than a convenience.',
          nodes: ['recall', 'ops'],
          edges: ['v5', 'v6'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'failure-profile',
      title: 'Where vector search is strong, and where it predictably is not',
      caption:
        'Read the right column as a failure profile rather than a list of bugs. Each one is a case the embedding cannot represent, and each is exactly where a lexical retriever is strong.',
      code: `flowchart LR
    Q["**A query**"]

    Q --> S["**Strong:**<br/>words differ,<br/>meaning matches"]
    S --> S1["'how do I get a refund'<br/>matches<br/>'returns and reimbursement policy'<br/><br/>**No shared terms, correct hit** —<br/>this is what embeddings are for"]

    Q --> W["**Weak:**<br/>words match,<br/>meaning differs —<br/>or the model has no<br/>basis for the meaning"]

    W --> W1["**Negation**<br/>'covers water damage' ≈<br/>'does NOT cover water damage'<br/>— a small perturbation in a<br/>space organised by topic"]
    W --> W2["**Rare tokens**<br/>'error E-4471', 'clause 14.2(b)'<br/>— averaged into a passage<br/>vector; lexical search finds<br/>them instantly"]
    W --> W3["**Numeric / temporal**<br/>'invoices over £10,000',<br/>'changes since March'<br/>— embeddings do not compare<br/>magnitudes. **This is a filter,<br/>not a search**"]
    W --> W4["**Domain jargon**<br/>absent from the training<br/>distribution → sits nowhere<br/>useful in the space"]

    W1 --> H["**All four are where a lexical<br/>retriever is strong**, which is the<br/>argument for hybrid retrieval —<br/>and the reason to describe vector<br/>search as one retriever with a<br/>known failure profile rather than<br/>as a search engine"]
    W2 --> H
    W3 --> H
    W4 --> H

    style S1 fill:#17272a,stroke:#35897e
    style H fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The HNSW paper is the most useful reference here because it makes the recall/latency relationship mechanical rather than mysterious.

**The index is a layered graph**: each vector is a node linked to a bounded number of neighbours, with sparse upper layers for long jumps and a dense bottom layer for local refinement. **A search is a greedy descent** — enter at the top, move to the closest neighbour, drop a layer, repeat.

**And the search-time parameter controls how many candidates are kept in play during that descent.** A larger value explores more of the graph, **so it finds more of the true nearest neighbours and takes longer.** That is the entire trade, and seeing it as "how much of the graph do I look at" makes it a decision rather than a setting.

**Two structural consequences the paper makes clear.**

**Connectivity is what makes the search work.** The greedy descent relies on neighbours leading toward the query, **which is why filtering during traversal is delicate** — removing nodes can disconnect regions and collapse recall in a way that looks like poor results rather than a broken index.

**And construction quality matters as much as search.** The neighbour count and construction-time exploration set an upper bound on achievable recall; **no search parameter recovers a badly built graph**, which is why an index built with default parameters on a corpus it was not tuned for has a ceiling.

**Three transferable lessons.**

**Recall is a parameter, so it should be measured and stated.** A latency number alone describes half the system.

**Filtering interacts with the index structure**, so "can this index filter efficiently?" is a question about a specific implementation rather than a general capability.

**And the index has a quality ceiling set at build time**, which means a rebuild is sometimes the fix for poor results — not a bigger search parameter.

**Where the paper does not help.** It says nothing about the embedding model, which is where relevance actually comes from. **A perfectly tuned index over poor embeddings retrieves the wrong things very quickly** — and the failure profile in this lesson is a property of the model, not of the graph.`,
  },

  tradeoffs: {
    intro:
      'The decisions a vector index involves, most of which are recall traded against something else.',
    rows: [
      {
        option: 'Exhaustive nearest-neighbour search',
        whenItWins:
          'Small corpora — tens of thousands of vectors — and as the ground truth for measuring recall.',
        whenItLoses:
          'O(n) per query becomes hundreds of milliseconds at millions of vectors.',
        cost:
          'Latency proportional to corpus size.',
      },
      {
        option: 'Graph index (HNSW)',
        whenItWins:
          'The best recall/latency curve available, for corpora that fit in memory.',
        whenItLoses:
          'High memory, expensive inserts, and awkward filtering because traversal depends on connectivity.',
        cost:
          'RAM, and periodic rebuilds as incremental insertion degrades the graph.',
      },
      {
        option: 'Inverted-file index (IVF)',
        whenItWins:
          'Lower memory, cheaper updates, and simpler filtering semantics.',
        whenItLoses:
          'Weaker recall at the same latency than a graph index.',
        cost:
          'Quality, traded for operational ease.',
      },
      {
        option: 'Accepting the default search parameter',
        whenItWins:
          'Nowhere deliberately. It is a point someone chose for a different corpus.',
        whenItLoses:
          'You may be at 80% recall or 99% and have no way to know which.',
        cost:
          'An unmeasured quality ceiling on everything downstream.',
      },
      {
        option: 'Measuring recall against exhaustive search on a sample',
        whenItWins:
          'Always. It is a batch job, not a query-path cost.',
        whenItLoses:
          'It needs a representative query sample, which must be maintained.',
        cost:
          'A periodic job, for the number that separates retrieval failures from generation ones.',
      },
      {
        option: 'Float32 vectors',
        whenItWins:
          'Maximum recall, when memory is not the constraint.',
        whenItLoses:
          'Six kilobytes per vector puts a ten-million-chunk index above sixty gigabytes.',
        cost:
          'The machine size.',
      },
      {
        option: 'Quantisation',
        whenItWins:
          'When memory is the binding constraint — 8-bit integers cut it fourfold.',
        whenItLoses:
          'Some recall, measurably.',
        cost:
          'A recall reduction that must be measured rather than assumed.',
      },
      {
        option: 'Post-filtering',
        whenItWins:
          'Mildly selective filters, with over-fetch — retrieve 2k to survive to k.',
        whenItLoses:
          'A user with access to 2% of the corpus gets almost nothing, and it looks like an empty corpus.',
        cost:
          'The worst results for the most restricted users.',
      },
      {
        option: 'Pre-filtering',
        whenItWins:
          'When k results must always be returned and the index supports filtered traversal.',
        whenItLoses:
          'Restricting a graph can disconnect regions and collapse recall.',
        cost:
          'An implementation-specific capability you must verify.',
      },
      {
        option: 'A separate index per tenant',
        whenItWins:
          'High-selectivity restrictions — the filter becomes structural and free.',
        whenItLoses:
          'Per-index overhead, and a long tail of tiny indexes.',
        cost:
          'Memory and operational surface per tenant.',
      },
      {
        option: 'Changing the embedding model in place',
        whenItWins:
          'Nowhere. It looks like a configuration change.',
        whenItLoses:
          'Stored vectors and query vectors live in different spaces, and similarity still returns numbers.',
        cost:
          'Silent, total degradation with no error.',
      },
      {
        option: 'Re-embed to a new index, verify, switch',
        whenItWins:
          'Always, for a model change.',
        whenItLoses:
          'A full re-embed costs time and money proportional to the corpus.',
        cost:
          'A migration, planned as one.',
      },
      {
        option: 'Vector search alone',
        whenItWins:
          'Conceptual queries where words differ and meaning matches.',
        whenItLoses:
          'Negation, rare identifiers, numeric and temporal comparison, unseen jargon.',
        cost:
          'A predictable failure profile that a second retriever covers.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We upgraded to a better embedding model by changing the model name in the config."',
      whyWeak:
        'The stored vectors are points in the old model\'s space and the new queries are points in a different one. Cosine similarity still returns a number, so nothing errors — results simply become meaningless, which is discovered gradually through user complaints rather than through an alert.',
      strongAnswer:
        '"The model is part of the index\'s identity. I store the model id and dimensionality as index metadata and reject queries whose model does not match, so the mismatch fails loudly rather than silently. An upgrade is a migration: re-embed the whole corpus into a new index, measure recall and end-task quality against the old one, then switch atomically. That costs time and money proportional to the corpus, which is worth knowing before choosing a model."',
    },
    {
      weakAnswer: '"We retrieve the top 10 and then filter to the documents the user is allowed to see."',
      whyWeak:
        'Post-filtering returns fewer than ten results whenever the filter is selective. A user with access to 2% of the corpus expects about 0.2 survivors from a top-10 fetch, so most queries return nothing — and it looks like an empty corpus rather than a filtering artefact.',
      strongAnswer:
        '"Which filtering strategy depends on selectivity, and I would measure it. A mildly selective filter can post-filter with over-fetch — retrieve two or three times k. A highly selective one cannot: you would need to fetch five hundred to survive to ten. Above roughly ninety percent selectivity the right answer is usually to partition — a separate index per tenant — so the restriction is structural and free rather than a predicate. And pre-filtering inside a graph index is implementation-specific, because restricting traversal can disconnect regions and collapse recall."',
    },
    {
      weakAnswer: '"Queries return in 12 milliseconds, so search performance is good."',
      whyWeak:
        'Latency alone describes half the system. Approximate search trades recall for speed, so 12 ms is compatible with returning 99% of the right answers and with returning 80% — and the response does not say which.',
      strongAnswer:
        '"Latency is only meaningful beside a recall figure. I measure recall@10 against exhaustive search on a sample of two hundred real queries — a batch job rather than a query-path cost — and I tune the search parameter deliberately along that curve rather than accepting a default chosen for someone else\'s corpus. That number is also the first thing I check when a RAG answer is wrong, because without it a retrieval failure and a generation failure are indistinguishable."',
    },
    {
      weakAnswer: '"Vector search handles semantic queries, so it replaces keyword search."',
      whyWeak:
        'It has a predictable failure profile, and each failure is a case where lexical search is strong: negation is a small perturbation in a topical space, rare identifiers get averaged into a passage vector, and numeric or temporal comparisons are not representable at all.',
      strongAnswer:
        '"Vector search is one retriever with a known failure profile rather than a general search engine. It is strong where words differ and meaning matches, and weak on negation, rare tokens like error codes and clause references, numeric or temporal comparison — which is a filter rather than a search — and jargon absent from training. All four are exactly where lexical retrieval is strong, which is why the design will end up combining both."',
    },
    {
      weakAnswer: '"Deleted documents are removed from the index when the user deletes them."',
      whyWeak:
        'In a graph index a delete is usually a tombstone: the node is marked and skipped, because removing it would break traversal. The vector remains resident in memory and is still traversed until a rebuild, so "deleted" means "filtered out" rather than "gone".',
      strongAnswer:
        '"Deletes are tombstones until a rebuild, which is fine for relevance and not fine for a deletion requirement. If the obligation is that content must actually be removed, that needs the rebuild rather than the delete, and the rebuild cadence becomes part of the compliance story. More generally the index is derived data — the documents are the truth — so losing it is a rebuild cost rather than data loss, provided the chunking and embedding are reproducible."',
    },
    {
      weakAnswer: '"We use cosine similarity because that is the standard metric."',
      whyWeak:
        'The correct metric depends on the model. Some emit normalised vectors where cosine and dot product coincide; others do not, and using the wrong one degrades results with no error — the same silent-failure shape as a model mismatch.',
      strongAnswer:
        '"The distance metric has to match what the model expects, and whether the vectors are normalised. I assert it in a test rather than assuming, because the failure is silent. The same applies to query-versus-document asymmetry: retrieval-trained models optimise a short question against a long passage and some expect a prefix to distinguish the two, so using them symmetrically quietly loses quality."',
    },
  ],

  flashcards: [
    {
      id: 'fc-emb-1',
      front: 'What does a vector index actually store?',
      back: 'A point produced by one specific model — not a meaning. Change the model and every stored vector becomes noise while similarity still returns numbers.',
      topic: 'vectors',
    },
    {
      id: 'fc-emb-2',
      front: 'Why is changing the embedding model a migration?',
      back: 'Stored and query vectors live in different spaces, so the index must be re-embedded, verified and switched atomically.',
      topic: 'vectors',
    },
    {
      id: 'fc-emb-3',
      front: 'What is the memory arithmetic for a vector index?',
      back: '1,536 dims × 4 bytes ≈ 6 KB per vector, so 10 million chunks is about 61 GB before graph structure — and graph indexes want it resident.',
      topic: 'indexing',
    },
    {
      id: 'fc-emb-4',
      front: 'What does the search parameter control in both index families?',
      back: 'How much of the structure is explored — more exploration means more recall and more latency. It is a dial, and a default is someone else\'s choice.',
      topic: 'ann',
    },
    {
      id: 'fc-emb-5',
      front: 'Why is a latency figure alone not a quality claim?',
      back: 'Approximate search trades recall for speed, so 12 ms is compatible with 99% recall and with 80%, and the response does not say which.',
      topic: 'recall',
    },
    {
      id: 'fc-emb-6',
      front: 'How do you measure recall?',
      back: 'Sample real queries, run exhaustive search for the true top-k, compare with the index\'s results. A batch job, not a query-path cost.',
      topic: 'recall',
    },
    {
      id: 'fc-emb-7',
      front: 'Why is recall the first thing to check when a RAG answer is wrong?',
      back: 'Without it, a retrieval failure and a generation failure are indistinguishable.',
      topic: 'recall',
    },
    {
      id: 'fc-emb-8',
      front: 'Name the four predictable weaknesses of vector search.',
      back: 'Negation, rare tokens like error codes, numeric or temporal comparison, and domain jargon absent from training.',
      topic: 'vectors',
    },
    {
      id: 'fc-emb-9',
      front: 'Why does post-filtering fail for restricted users?',
      back: 'Top-k is taken before the filter, so a user with access to 2% of the corpus keeps almost nothing — and it looks like an empty corpus.',
      topic: 'filtering',
    },
    {
      id: 'fc-emb-10',
      front: 'Why is pre-filtering hard in a graph index?',
      back: 'Greedy traversal depends on connectivity, so removing nodes can disconnect regions and collapse recall rather than simply narrowing results.',
      topic: 'filtering',
    },
    {
      id: 'fc-emb-11',
      front: 'When should you partition instead of filter?',
      back: 'At high selectivity — a separate index per tenant makes the restriction structural and free, at the cost of per-index overhead.',
      topic: 'filtering',
    },
    {
      id: 'fc-emb-12',
      front: 'What does quantisation trade?',
      back: 'Memory for recall — 8-bit integers instead of 32-bit floats cut memory fourfold at a measurable recall cost.',
      topic: 'indexing',
    },
    {
      id: 'fc-emb-13',
      front: 'What is a delete in a graph index, and why does it matter?',
      back: 'A tombstone — marked and skipped, still resident and traversed until a rebuild. So "must be gone" requires the rebuild, not the delete.',
      topic: 'indexing',
    },
    {
      id: 'fc-emb-14',
      front: 'Why must the distance metric match the model?',
      back: 'Normalisation differs by model, and the wrong metric degrades results with no error — the same silent-failure shape as a model mismatch.',
      topic: 'vectors',
    },
  ],

  quiz: [
    {
      id: 'q-emb-1',
      kind: 'scenario',
      prompt:
        'A team swaps the embedding model in config and redeploys. The index is unchanged. What happens?',
      options: [
        { id: 'a', label: 'Results become meaningless with no error — the stored and query vectors are in different spaces, and similarity still returns numbers' },
        { id: 'b', label: 'Queries fail with a dimensionality error' },
        { id: 'c', label: 'Results improve, since the new model is better' },
        { id: 'd', label: 'Only newly added documents are affected' },
      ],
      correct: ['a'],
      explanation:
        'Option b happens only if the dimensionality differs, which it may not — and relying on that is relying on an accident. The silent case is the dangerous one: similarity is always computable, so the system reports success while returning effectively random results, discovered through complaints rather than alerts.',
      difficulty: 'core',
      topic: 'vectors',
    },
    {
      id: 'q-emb-2',
      kind: 'scenario',
      prompt:
        'A user can see 2% of the corpus. The system retrieves the top 10 by similarity and then filters by permission. What do they typically get?',
      options: [
        { id: 'a', label: 'Usually nothing — about 0.2 expected survivors — and it presents as an empty corpus rather than a filtering artefact' },
        { id: 'b', label: 'The 10 most relevant documents they may see' },
        { id: 'c', label: 'About 2 results' },
        { id: 'd', label: 'The same results as an unrestricted user' },
      ],
      correct: ['a'],
      explanation:
        'Post-filtering takes the top-k before the restriction, so selectivity destroys the result set — and the shortfall is worst for the most restricted users, who often have the most sensitive need. Over-fetching helps mildly selective filters; at 2% you would need to fetch five hundred, which is where partitioning becomes the answer.',
      difficulty: 'core',
      topic: 'filtering',
    },
    {
      id: 'q-emb-3',
      kind: 'scenario',
      prompt:
        'Which query is vector search least likely to handle well?',
      options: [
        { id: 'a', label: '"Which invoices over £10,000 were issued since March?"' },
        { id: 'b', label: '"How do I get my money back?" against a document titled "Returns and reimbursement policy"' },
        { id: 'c', label: '"What is the escalation process for a stalled ticket?"' },
        { id: 'd', label: '"Summarise the parental leave policy"' },
      ],
      correct: ['a'],
      explanation:
        'Embeddings do not compare magnitudes or order dates — that is a filter, not a search, and belongs in structured metadata. Option b is the canonical strength: no shared terms and a correct match. The other two are ordinary conceptual queries.',
      difficulty: 'core',
      topic: 'vectors',
    },
    {
      id: 'q-emb-4',
      kind: 'scenario',
      prompt:
        'Queries return in 12 ms. What else must be known before calling the search good?',
      options: [
        { id: 'a', label: 'Recall at the configured search parameter, measured against exhaustive search on a sample' },
        { id: 'b', label: 'The p99 latency' },
        { id: 'c', label: 'The index build time' },
        { id: 'd', label: 'The number of vectors' },
      ],
      correct: ['a'],
      explanation:
        'Approximate search trades recall for latency, so a fast index may be missing a fifth of the right answers with nothing in the response to indicate it. The tail latency and corpus size are useful operationally and say nothing about whether the right documents are being found.',
      difficulty: 'core',
      topic: 'recall',
    },
    {
      id: 'q-emb-5',
      kind: 'scenario',
      prompt:
        'A regulated deletion request requires that a document\'s content is genuinely removed. The team deletes it from the vector index. Is that sufficient?',
      options: [
        { id: 'a', label: 'No — a graph-index delete is usually a tombstone, so the vector remains resident until a rebuild' },
        { id: 'b', label: 'Yes, the delete removes the vector immediately' },
        { id: 'c', label: 'Yes, provided the source document is also deleted' },
        { id: 'd', label: 'No, because vectors cannot be reversed into text anyway' },
      ],
      correct: ['a'],
      explanation:
        'Removing a node would break traversal, so deletes are marked and skipped — present in memory and still traversed. Option c is necessary and not sufficient, and option d misses the point: the obligation is about the data existing, not about reconstructing text from it. The rebuild cadence becomes part of the compliance story.',
      difficulty: 'advanced',
      topic: 'indexing',
    },
    {
      id: 'q-emb-6',
      kind: 'multi',
      prompt:
        'Which of these are genuine recall-versus-something trades? Select all that apply.',
      options: [
        { id: 'a', label: 'The search-time exploration parameter — recall against latency' },
        { id: 'b', label: 'Quantisation — recall against memory' },
        { id: 'c', label: 'Graph neighbour count at build time — recall ceiling against build cost and memory' },
        { id: 'd', label: 'The distance metric — recall against CPU' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are dials along a measurable curve. The distance metric is not a trade: there is a correct one for the model and using another degrades results silently, which makes it a correctness question rather than a tuning one.',
      difficulty: 'advanced',
      topic: 'ann',
    },
  ],

  exercises: [
    {
      id: 'ex-emb-1',
      kind: 'estimate',
      title: 'Size an index, then make it multi-tenant',
      estimatedMinutes: 40,
      prompt: `A knowledge base holds 4 million documents averaging 3,000 words. Chunking produces roughly 8 chunks per document. The chosen model produces 1,536-dimension float32 vectors. Queries run at 200 per second at peak, with a 50 ms budget for retrieval.

**Part 1.** Compute the index size: vectors, graph structure at 16 neighbours per node, and payload at 200 bytes per chunk. State what machine this implies.

**Part 2.** The corpus serves 500 customer tenants, and every query must be restricted to one tenant. Tenants range from 200 documents to 400,000. Design the filtering strategy and justify it.

**Part 3.** The team wants to halve memory. Evaluate quantisation and dimensionality reduction, and say what you would measure before committing.

**Part 4.** A new embedding model is released claiming better retrieval quality. Plan the migration, including how you would decide whether to do it.

Then answer:

- What recall target would you set, and how would you choose it?
- What breaks first if the corpus grows tenfold?`,
      rubric: [
        'Vector, graph and payload sizes computed and summed.',
        'States the memory implication and what machine class it needs.',
        'Recognises the tenant size distribution as the key to the filtering decision.',
        'Proposes a hybrid strategy rather than one uniform approach.',
        'Quantisation and dimensionality evaluated with a measurement plan.',
        'Migration plan includes dual indexes, comparison and atomic switch.',
        'States a decision criterion for the migration rather than assuming it.',
        'Recall target justified by downstream use rather than asserted.',
        'Identifies what breaks first at 10× with reasoning.',
      ],
      modelAnswer: `**Part 1 — index size**

\`\`\`
Chunks: 4,000,000 documents × 8 = 32,000,000 chunks

Vectors:  32e6 × 1,536 × 4 bytes   = 196.6 GB
Graph:    32e6 × 16 neighbours × 8 bytes
                                   =   4.1 GB
Payload:  32e6 × 200 bytes         =   6.4 GB
                                    ─────────
                                     207.1 GB
\`\`\`

**Two hundred gigabytes, dominated entirely by the vectors** — the graph and payload together are 5%. **Which is the first useful observation: any memory optimisation must target the vectors**, and neighbour count is not where the money is.

**What this implies.**

**It does not fit on one ordinary machine.** A single instance with 256 GB of RAM would hold it with little headroom, **and no room for the query-time working set, the operating system or a rebuild running alongside.**

\`\`\`
Realistic options:
(a) One large memory instance (384–512 GB)
    + simplest operationally
    − expensive, and a single point of failure with a
      long recovery (a full rebuild)
(b) Shard across 4–8 instances by chunk id
    + commodity machines, parallel search
    − every query fans out to all shards and merges,
      so latency is the slowest shard
(c) Shard by TENANT
    + queries touch one shard — see Part 2
\`\`\`

**Option (c) is where Part 2 leads**, and noticing that the tenancy requirement and the sharding requirement have the same answer is the point of doing Part 1 first.

**Latency check:** 200 queries per second against a 50 ms budget. **With HNSW at a few milliseconds per query, a single node handles this comfortably** — so this is a memory-bound problem rather than a compute-bound one, **which also argues against fanning out to eight shards for throughput you do not need.**

---

**Part 2 — 500 tenants, and the size distribution decides everything**

\`\`\`
Tenants: 500
Sizes:   200 documents → 400,000 documents
         a 2,000× range
Average: 8,000 documents (4 M / 500)
\`\`\`

**A uniform strategy is wrong because the tenants are not uniform.** Two regimes:

\`\`\`
LARGE TENANTS (say >50,000 documents, perhaps 20 of them)
  → a dedicated index each
  → selectivity is irrelevant: the filter IS the index
  → and a 400,000-document tenant is 3.2 M chunks,
    ~20 GB — its own machine or a large share of one

SMALL TENANTS (the remaining ~480, <50,000 documents)
  → a shared index with a tenant_id filter
  → a small tenant is 200 × 8 = 1,600 chunks in a
    shared index of perhaps 5 M chunks
  → selectivity 0.03% — post-filtering is hopeless
  → so PRE-filtering, and the index must support
    filtered traversal
\`\`\`

**Three decisions worth defending.**

**Dedicated indexes for large tenants.** At 3.2 million chunks a tenant is large enough to justify the overhead, **and it makes their queries structurally isolated** — no filter, no cross-tenant risk, and the blast radius of a rebuild is one customer.

**Shared indexes with pre-filtering for the long tail.** 480 tenants each with their own index would be 480 graphs to build, monitor and rebuild, **most of them tiny and poorly connected** — a graph over 1,600 vectors has a poor recall ceiling regardless of tuning. **Sharing gives them a well-built graph; the filter gives them isolation.**

**And the shared index must be verified to support filtered traversal.** This is the implementation-specific question from the lesson: **post-filtering at 0.03% selectivity would need a fetch of tens of thousands to survive to ten**, which is not a workaround, it is a different algorithm. **If the chosen index cannot pre-filter efficiently, the design must change** — and that is a question to answer before committing to it.

*And the boundary is a policy that must be revisited:* **a tenant crossing 50,000 documents gets promoted to a dedicated index**, which is a migration and should be automated rather than discovered.

*One correctness note:* **tenant isolation by filter is a correctness-critical predicate.** A bug that omits it leaks another customer's documents, **so it belongs in the query construction rather than in caller-supplied parameters** — the same argument as authorisation living outside the prompt.

---

**Part 3 — halving memory**

\`\`\`
Target: 207 GB → ~100 GB
Vectors are 95% of it, so both options attack the vectors.
\`\`\`

**Option A — scalar quantisation to int8.**

\`\`\`
1,536 × 1 byte = 1.5 KB per vector
32e6 × 1.5 KB  = 49 GB      (from 197 GB — a 4× reduction)
Total ≈ 60 GB, comfortably under target
Cost: a recall reduction, typically small but corpus-specific
\`\`\`

**Option B — reduce dimensionality**, if the model supports shortened embeddings.

\`\`\`
768 dimensions × 4 bytes = 3 KB per vector
32e6 × 3 KB              = 98 GB   (a 2× reduction)
Total ≈ 109 GB
Cost: quality loss at the EMBEDDING level, not just the index
\`\`\`

**These are different in kind, and the difference is the important part.**

**Quantisation degrades the index's approximation of a good embedding.** The underlying vector is unchanged; **the search is slightly coarser**, and the loss shows up as recall.

**Dimensionality reduction degrades the embedding itself.** Distinctions the model could express in 1,536 dimensions are gone — **so the loss shows up as relevance, which recall measurement cannot see.**

\`\`\`
Recall@10 measures: did the index find the true nearest
                    neighbours in THIS space?
→ a 768-dim index can have 99% recall over a space that
  itself represents the corpus less well
→ recall stays high and answers get worse
\`\`\`

**So I would quantise rather than reduce dimensions**, and it is a bigger saving besides.

**What I would measure before committing.**

\`\`\`
1. recall@10 at float32 vs int8, same search parameter
   → the direct cost of quantisation
2. recall@10 at int8 with the search parameter RAISED
   → quantisation is cheaper in memory and often allows a
     larger ef_search for the same latency, which recovers
     much of the loss
3. End-task quality on a RAG eval set, both configurations
   → because recall is a proxy and answer quality is the
     product
4. Latency at the chosen parameter
\`\`\`

**Measurement 2 is the one people skip**, and it frequently changes the conclusion: **the memory saved buys back exploration**, so the net recall change can be near zero.

---

**Part 4 — migrating to a new model**

**The decision first, because a migration at this size is not automatic.**

\`\`\`
Cost of migrating:
  re-embed 32 M chunks
  at (say) $0.02 per million tokens and ~400 tokens/chunk
  = 12.8 B tokens ≈ $256 in embedding cost
  + pipeline time, a second index resident during
    cutover (another 200 GB), and engineering
→ the money is trivial; the DUAL-RESIDENCY memory is not
\`\`\`

**So the real cost is holding two indexes at once**, which doubles the memory footprint during the migration — **and that is the constraint to plan around, not the embedding bill.**

**How I would decide whether to do it:**

\`\`\`
1. Embed a SAMPLE — say 200,000 chunks covering the
   query set's relevant documents
2. Build a small index for both models
3. Run the retrieval eval: recall@10 against known-relevant
   documents, and the end-task RAG quality
4. Migrate only if the improvement is material on the
   end task, not merely on a retrieval benchmark
\`\`\`

**The sample is what makes this affordable** — a decision made on 0.6% of the corpus, **and it is representative provided the sample includes the documents the eval queries actually need.**

**The migration plan:**

\`\`\`
1. Build the new index alongside, tenant by tenant
   (large tenants first — they are separate indexes
    already, so each is an independent, reversible step)
2. Shadow: run both, compare results, log disagreements
   → the cheapest way to find surprises before users do
3. Switch per tenant, monitoring end-task quality
4. Keep the old index until the new one has been stable
   for a defined period
5. Then delete, and reclaim the memory
\`\`\`

**Two things this gets right.**

**Per-tenant migration limits the blast radius.** The dedicated-index decision from Part 2 pays off here: **large tenants migrate independently and can be rolled back individually** — whereas the shared small-tenant index migrates as one unit, which is the riskier step and should go last.

**And the model id enforcement from the lesson makes the cutover safe.** A query carrying the wrong model id is rejected rather than silently answered, **so a partial cutover cannot produce meaningless results.**

---

**What recall target, and how chosen?**

**I would target recall@10 of about 95%, and the reasoning is about what sits downstream rather than about the index.**

\`\`\`
The retrieved chunks feed a reranker and then a generator.
So the question is: what does a missed chunk cost?

If the top 10 go straight into the context:
  → a miss is potentially a wrong answer
  → high recall matters
If the top 50 go to a reranker that selects 5:
  → over-retrieval absorbs some misses
  → a miss at rank 8 is recovered if rank 40 has a duplicate
  → recall@50 matters more than recall@10
\`\`\`

**Which yields the actual answer: measure recall at the k you actually retrieve, not at 10 by convention.** If the pipeline fetches 50 for a reranker, **recall@50 is the meaningful number** — and it is usually much higher at the same parameter, because more slots forgive more approximation.

**And the target is set by the cost of a miss.**

\`\`\`
Support assistant answering from policy documents
  → a miss means a wrong answer to a customer
  → target 97%+ at the retrieval k
Internal search with a human reading results
  → a miss means the human scrolls or rephrases
  → 90% is fine
\`\`\`

*And I would set it as a floor with an alert*, not a one-off measurement: **recall drifts as the corpus grows and as documents are added and tombstoned**, so it belongs on a dashboard with a threshold.

---

**What breaks first at ten times the corpus?**

**Memory, and by a long way — but the interesting part is what that forces.**

\`\`\`
320 M chunks
  float32:  1.97 TB
  int8:      491 GB
\`\`\`

**Even quantised it exceeds any single machine**, so the architecture changes: **sharding becomes mandatory rather than optional.**

**And the tenant-based sharding from Part 2 is what makes that tractable**, which is the payoff of the earlier decision. **Query fan-out to all shards would mean every query waits for the slowest of many; tenant sharding means each query touches one shard** — so growth is absorbed by adding shards rather than by widening every query.

**Three things break after memory, in order.**

**Rebuild time.** A graph over 320 million vectors takes hours to days to build; **at 32 million it is an afternoon.** So the rebuild cadence that supported tombstone reclamation and freshness becomes infeasible, **and per-tenant indexes help here too — rebuilding one tenant is a bounded job.**

**Recall at a fixed search parameter.** Graph search quality degrades as the corpus grows at constant exploration, **so the same ef_search gives lower recall at 320 million than at 32 million** — meaning the parameter must be re-tuned and latency rises to hold quality. **This is the drift the monitored recall number is there to catch.**

**And the long tail of small tenants stops being viable in one shared index.** 480 small tenants in one index is fine at 5 million chunks; **at 50 million the filtered traversal cost rises and the per-tenant selectivity falls further** — so the shared index itself needs splitting, probably by tenant-id range.

*What does not break:* the embedding model, the metric, the payload, and the query rate — **200 queries per second is still comfortable.** **The problem is entirely one of index size and rebuild economics**, which is worth saying because it points at where the engineering should go.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-emb-1',
      level: 'basic',
      question: 'What does a vector index store, and what does it not?',
      guidance:
        'A point produced by a specific model, not a meaning. Look for the immediate consequence that a model change invalidates the index silently.',
    },
    {
      id: 'iq-emb-2',
      level: 'basic',
      question: 'How large would this index be?',
      guidance:
        'Dimensions times four bytes times chunk count, plus graph and payload. Strong answers note that vectors dominate and that graph indexes want it resident.',
    },
    {
      id: 'iq-emb-3',
      level: 'intermediate',
      question: 'Your search returns in 12 milliseconds. Is that good?',
      guidance:
        'Not without a recall figure. Look for exhaustive search on a sample as the measurement, and for the tuning curve being deliberate rather than default.',
    },
    {
      id: 'iq-emb-4',
      level: 'intermediate',
      question: 'Where does vector search fail?',
      guidance:
        'Negation, rare identifiers, numeric and temporal comparison, unseen jargon — and all four are where lexical retrieval is strong.',
    },
    {
      id: 'iq-emb-5',
      level: 'advanced',
      question: 'Every query must be restricted to one tenant. How?',
      guidance:
        'Pre versus post filtering by selectivity, with partitioning at high selectivity. Excellent answers note that post-filtering fails worst for the most restricted users.',
    },
    {
      id: 'iq-emb-6',
      level: 'advanced',
      question: 'You need to halve the index memory. What do you do?',
      guidance:
        'Quantisation over dimensionality reduction, because the latter degrades the embedding itself and recall cannot see it. And measure whether a larger search parameter recovers the loss.',
    },
    {
      id: 'iq-emb-7',
      level: 'followup',
      question: 'A better embedding model is released. Walk me through the migration.',
      guidance:
        'Decide on a sample, build alongside, shadow-compare, switch per tenant, keep the old index. Look for model-id enforcement making the cutover safe.',
    },
    {
      id: 'iq-emb-8',
      level: 'followup',
      question: 'A document must be deleted for compliance. Is removing it from the index enough?',
      guidance:
        'No — a delete is usually a tombstone, so the vector remains resident until a rebuild, and the rebuild cadence becomes part of the compliance story.',
    },
  ],

  activeLearning: [
    {
      id: 'al-emb-1',
      kind: 'what-changes-if',
      prompt:
        'Change the data: instead of text documents, the corpus is 50 million product images with user queries in text. What transfers from this lesson, and what is genuinely different?',
      discussion: `**Almost all of the infrastructure transfers and the failure profile changes completely** — which is a useful separation, because it shows which parts of this lesson are about vectors and which are about text.

**What transfers unchanged.**

**The index is still a set of points from one model**, so a model change is still a full re-embed and still fails silently. **If anything more so**: re-embedding 50 million images is a far larger job than re-embedding text, so the migration cost is a real constraint on model choice rather than a footnote.

**Approximate search, the recall/latency dial, and recall measured against exhaustive search** — all identical. **The graph does not know what the vectors mean.**

**The memory arithmetic is the same shape** and the numbers are worse: 50 million vectors at 1,024 dimensions is around 200 GB, **so quantisation moves from optional to expected.**

**And filtering is the same problem** — by category, by availability, by merchant — **with the same pre-versus-post decision driven by selectivity.**

**What is genuinely different: the query and the document are different modalities.**

\`\`\`
Text corpus:   query text → document text
               same encoder, same space, symmetric-ish
Image corpus:  query TEXT → document IMAGE
               two encoders trained jointly to share a space
\`\`\`

**So the model is a pair**, and both must match the index. **Upgrading one without the other breaks the alignment** — a failure mode that does not exist in the text case, and one that is even easier to do accidentally.

**And the failure profile inverts in an interesting way.**

\`\`\`
TEXT weaknesses:   negation, rare tokens, numeric comparison
IMAGE weaknesses:  fine-grained attributes ("red dress with
                   three-quarter sleeves" — the sleeves are
                   a small part of the image vector)
                   text IN the image (a brand name on a
                   label is not read)
                   counting ("four chairs")
                   spatial relations ("lamp to the left of
                   the sofa")
\`\`\`

**The shared property is that a fixed-size vector averages detail**, which in text loses rare tokens and in images loses small regions. **Same mechanism, different symptoms** — and recognising that makes the image failures predictable rather than surprising.

**What has no analogue: there is no lexical fallback for images.**

**The text lesson's conclusion was that a second retriever covers the weaknesses**, and that retriever is lexical search over the same text. **For images there is no inverted index over pixels** — so the equivalent is **structured metadata**: colour, category, brand, attributes, extracted text from labels.

\`\`\`
Hybrid for text:   vectors + BM25 over the same content
Hybrid for images: vectors + a structured attribute filter
                   over metadata SOMEONE HAD TO CREATE
\`\`\`

**Which is a genuinely larger investment**, because the metadata does not exist for free — **it has to be extracted, and extracting it is its own model pipeline.** So the retrieval quality ceiling depends on a data-preparation effort that the text case got from the documents themselves.

**Two more differences worth naming.**

**Deduplication becomes a first-class problem.** A product catalogue contains many near-identical images — **the same shirt in five colours, the same photo from two merchants** — and returning ten results that are all the same product is useless. **Text has this too and much less severely.**

**And the eval set is harder to build.** Relevance for "red summer dress" is subjective and multi-valued, **so a ground truth requires human judgment at a scale text queries often avoid** — where a document either contains the answer or does not.

**What I would build.**

\`\`\`
Keep:     index sizing, quantisation, recall measurement,
          the filtering decision, migration discipline
Change:   model identity is a PAIR, both enforced
Add:      a metadata extraction pipeline as the second
          retriever — the expensive part
          near-duplicate detection and diversity in results
          a human-judged eval set
Expect:   fine-grained attributes, counting, spatial
          relations and in-image text to fail
\`\`\`

**The transferable point:** everything about the index is modality-independent, **and everything about relevance is modality-specific.** The failure profile is a property of the encoder and the averaging, **so changing modality changes which queries fail while leaving the infrastructure and its trade-offs exactly where they were** — and the absence of a cheap second retriever is the one structural loss.`,
    },
    {
      id: 'al-emb-2',
      kind: 'debug',
      prompt:
        'A RAG system that worked well at launch is now giving noticeably worse answers. The corpus has grown from 500,000 to 6 million chunks over eight months. No code has changed, the embedding model is unchanged, and retrieval latency is still around 15 ms. Diagnose it.',
      discussion: `**Unchanged code, unchanged model, unchanged latency, twelve times the corpus** — and that last fact is doing all the work, because **several properties of an approximate index degrade with size at fixed parameters.**

**Hypothesis 1 — recall has fallen at a constant search parameter.**

**This is the specific mechanism the corpus growth implies.** A graph search explores a fixed number of candidates; **as the corpus grows, that fixed exploration covers proportionally less of it**, so the probability of finding the true nearest neighbours falls.

\`\`\`
ef_search = 64, 500 K chunks  → ~97% recall
ef_search = 64, 6 M chunks    → perhaps 85%
Latency unchanged, because the exploration budget is
  unchanged — WHICH IS WHY NOTHING LOOKED WRONG
\`\`\`

**And it explains the latency observation exactly.** Latency is constant *because* the parameter is constant, **and the constant parameter is the cause** — so the reassuring metric and the problem have the same root.

*Check:* measure recall@k against exhaustive search on a sample, now and ideally on a snapshot from launch. **This is my leading hypothesis** and it is directly measurable.

**Hypothesis 2 — the index has degraded through incremental insertion.**

Graph quality depends on how nodes were connected at build time. **Millions of incremental inserts produce a worse graph than a rebuild over the same data**, because each insertion links against a partial graph.

*Why it fits:* eight months of continuous ingestion with, presumably, no rebuild. *Check:* build a fresh index over the current corpus and compare recall at the same parameter. **If the rebuilt index is materially better, the fix is a rebuild cadence** rather than a parameter change.

**Hypothesis 3 — tombstones are accumulating.**

Deleted and updated documents leave tombstoned nodes that are **still traversed and still occupy the exploration budget.** With eight months of updates, a meaningful fraction of visited nodes may be skipped ones.

\`\`\`
6 M live chunks + 1.5 M tombstones
→ 20% of traversal work returns nothing
→ effective recall falls at the same latency
\`\`\`

*Check:* the tombstone ratio. **It is also the strongest argument for the rebuild in hypothesis 2** — and the two fixes are the same operation.

**Hypothesis 4 — the corpus composition changed, not just its size.**

Twelve times more documents may mean **new document types, new domains, or a lot of near-duplicates.** Near-duplicates are the interesting case:

\`\`\`
A policy document versioned monthly → 12 near-identical
chunks compete for the top-k
→ the top 10 becomes 10 versions of one passage
→ recall@10 measured against "the true nearest neighbours"
  is PERFECT, and the answer is worse
\`\`\`

**This is the case recall cannot detect**, which makes it worth checking directly: **inspect the retrieved sets for redundancy.** If eight of ten results are variants of one document, the problem is diversity rather than recall.

**Hypothesis 5 — the questions changed.**

Eight months of growth usually accompanies a broader user base asking different things. **The system may be being asked questions the corpus never answered**, and attributing that to degradation is a misreading.

*Check:* replay the original launch-era queries against the current system. **If they still work well, the corpus and index are fine and the query distribution moved** — a completely different investigation.

**What I would check first: recall@k against exhaustive search on a current sample, and the tombstone ratio.** Two measurements, **and they cover the three hypotheses that the corpus growth most directly implies.** The recall number is also the one that should have existed all along.

**Then: replay launch-era queries, and inspect retrieved sets for near-duplicates.** These separate "the index got worse" from "the corpus or the questions changed", **which are the two families and need different work.**

**Why "latency is unchanged" is the most misleading fact.**

**It reads as reassurance and it is the symptom.** A fixed exploration budget produces fixed latency and falling recall as the corpus grows — **so stable latency is exactly what a recall regression looks like from the outside.**

**And it illustrates the lesson's central point operationally:** latency without recall is not a quality signal, **and here it actively conceals the problem.** A system reporting rising latency would have prompted an investigation months earlier.

**The instrumentation this demands.**

**Recall@k on a schedule, against exhaustive search on a fixed query sample.** The single missing metric, **and it should be a monitored number with a floor** — because it drifts with corpus growth even when nothing is changed, which is a category of regression that no code-based alerting catches.

**Corpus size and tombstone ratio, graphed together with recall.** The correlation is the diagnosis, **and seeing all three on one chart makes the mechanism obvious rather than mysterious.**

**Retrieval-set diversity**: how many of the top k come from the same document or are near-duplicates. **This catches the failure recall cannot see.**

**A pinned evaluation query set from launch**, re-run periodically. **It distinguishes system degradation from distribution shift**, which is otherwise an argument rather than a measurement.

**And search parameters recorded with the index version**, so a re-tune is visible and reversible.

**Transferable:** an approximate index's quality degrades with corpus growth at fixed parameters, **so recall is a metric that regresses without anyone changing anything.** It belongs on a dashboard for the same reason a cache hit rate does — and stable latency beside falling recall is the specific pattern to recognise.`,
    },
  ],

  revision: {
    bullets: [
      'A vector index stores a point produced by one model, not a meaning.',
      'Change the model and stored vectors become noise while similarity still returns numbers.',
      'So the model id is part of the index identity, and an upgrade is a re-embed and an atomic switch.',
      'The vector is fixed-size regardless of input length, so long passages average away distinctive detail.',
      '1,536 dims × 4 bytes ≈ 6 KB per vector — index size, not corpus size, decides the machine.',
      'Search is approximate: one parameter trades recall for latency in both graph and inverted-file indexes.',
      'A latency figure without a recall figure is not a quality claim.',
      'Measure recall by exhaustive search on a query sample — a batch job, not a query-path cost.',
      'Recall is the first thing to check when a RAG answer is wrong.',
      'Similarity is a proxy for relevance, and it fails on negation, rare tokens, numeric comparison and unseen jargon.',
      'All four weaknesses are where lexical retrieval is strong.',
      'Post-filtering returns fewer than k when the filter is selective, and worst for the most restricted users.',
      'Pre-filtering is correct and can disconnect a graph, so it is implementation-specific.',
      'At high selectivity, partition rather than filter — a separate index makes the restriction free.',
      'Quantisation trades recall for memory; dimensionality reduction degrades the embedding itself.',
      'Recall cannot see a dimensionality loss, because it measures search quality within the space.',
      'Deletes are tombstones until a rebuild, which matters when deletion is an obligation.',
      'Recall degrades as the corpus grows at fixed parameters — it regresses with nothing changed.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'An approximate nearest-neighbour index over points produced by one embedding model, tuned along a recall/latency curve, filtered by pre- or post-filtering according to selectivity, and rebuildable from the documents that are the actual truth.',
    whyItExists:
      'Because exhaustive similarity search does not scale and exact matching does not generalise — so the design is a deliberate approximation whose quality is a number you choose, measure and monitor.',
    whenToUse: [
      'Vector search for conceptual queries where words differ and meaning matches.',
      'A measured recall target whenever the index feeds a generator.',
      'Pre-filtering or partitioning whenever restrictions are selective.',
      'Quantisation whenever memory rather than recall is the binding constraint.',
      'A full re-embed and atomic switch whenever the model changes.',
    ],
    whenNotToUse: [
      'Vector search alone for negation, identifiers, or numeric and temporal comparison.',
      'Post-filtering with a highly selective restriction.',
      'A default search parameter without measuring what recall it gives on your corpus.',
      'Dimensionality reduction as a memory optimisation.',
      'Changing the embedding model in place.',
      'Treating a delete as removal when the obligation is that content is gone.',
      'Latency as the quality metric.',
    ],
    alternatives: [
      'Lexical search as the second retriever covering the vector failure profile.',
      'Structured metadata filters for numeric, temporal and categorical constraints.',
      'A separate index per tenant, when restrictions are highly selective.',
      'An inverted-file index, when memory and update cost matter more than peak recall.',
      'Exhaustive search, for small corpora and as the ground truth for measuring recall.',
    ],
    tradeoffs: [
      'The search parameter buys recall and costs latency.',
      'Quantisation buys memory and costs measurable recall.',
      'A graph index buys the best recall/latency curve and costs memory, insert cost and filtering ease.',
      'Partitioning buys free filtering and costs per-index overhead.',
      'Over-fetching buys post-filter survivability and costs wasted retrieval.',
      'Re-embedding buys a better model and costs a full migration plus dual residency.',
    ],
    failureModes: [
      'A model swap silently invalidating every stored vector.',
      'The wrong distance metric degrading results with no error.',
      'Post-filtering returning nothing for restricted users.',
      'Pre-filtering disconnecting a graph and collapsing recall.',
      'A default search parameter leaving recall unmeasured.',
      'Recall falling as the corpus grows while latency stays flat.',
      'Incremental insertion degrading graph quality without a rebuild.',
      'Tombstones consuming the exploration budget.',
      'Near-duplicates filling the top-k with one document, invisible to recall.',
      'Dimensionality reduction losing relevance that recall cannot detect.',
      'A deleted document still resident until the next rebuild.',
    ],
    followUpQuestions: [
      'Which model produced these vectors, and is that enforced on query?',
      'How large is the index, and does it fit in memory?',
      'What is recall at the configured parameter, and how was it measured?',
      'What is the recall/latency curve for this corpus?',
      'Is filtering pre or post, and how selective is the filter?',
      'What happens to a user who can see 2% of the corpus?',
      'Which distance metric does this model expect?',
      'What is the rebuild cadence, and what is the tombstone ratio?',
      'How would you migrate to a new embedding model?',
      'Which queries would you expect this to fail on?',
      'Is recall monitored, or measured once?',
    ],
  },
});
