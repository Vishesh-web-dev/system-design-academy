import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-rag-assistant',
  title: 'Design a RAG knowledge assistant',
  summary:
    'A RAG assistant is an information-retrieval system that happens to end in a language model — so most of the design is ingestion, permissions and freshness, and the model is the last and least of your problems. Treat retrieval, access control and citation as first-class, not the prompt.',
  phase: 'ai',
  module: 'ai-designs',
  position: 86,
  kind: 'system-design',
  difficulty: 'advanced',
  estimatedMinutes: 90,
  tags: ['rag', 'permissions', 'ingestion', 'citation', 'freshness'],
  prerequisites: ['a-retrieval', 'a-rag-evaluation'],
  resources: [
    {
      key: 'anthropic-contextual-retrieval',
      tier: 'must',
      note: 'Read it for the ingestion move that matters most — situating each chunk in its document before embedding. In a design discussion it is the concrete answer to "how do you stop retrieval returning context-free fragments".',
    },
    {
      key: 'ragas-docs',
      tier: 'must',
      note: 'Read it for the metrics that let you say the retrieval works, separately from the generation. A RAG design without an evaluation story is incomplete, and this is the vocabulary for the evaluation story.',
    },
    {
      key: 'qdrant-hybrid-queries',
      tier: 'must',
      note: 'Read the filtering sections for permissions-aware retrieval. Pre-filtering versus post-filtering is the decision that determines whether a restricted user gets the right number of results, and it is the heart of the access-control design.',
    },
    {
      key: 'lost-in-the-middle',
      tier: 'good',
      note: 'Read it for why assembling the retrieved context is a design step rather than concatenation. Ordering changes what the model uses, which is why the context builder is a component and not a string join.',
    },
    {
      key: 'pinecone-rerankers',
      tier: 'good',
      note: 'Read it for reranking as the precision layer over broad retrieval. It is the standard answer to "retrieval recall is fine but the top results are noisy", and it belongs in the design as a distinct stage.',
    },
    {
      key: 'rag-survey-paper',
      tier: 'advanced',
      note: 'Read it for the breadth of the design space — query transformation, hybrid retrieval, self-correction. Useful for knowing which elaborations exist and which your specific requirements actually justify.',
    },
  ],

  intuition: {
    body: `**The sentence that reframes the whole interview: a RAG assistant is an information-retrieval system that happens to end in a language model.** **The model is the last stage and the least of your problems** — **and a candidate who spends the session on the prompt has misread the question.**

**Where the real work is:**

\`\`\`
INGESTION    chunk, situate, embed, index — and
             re-do it when documents change
RETRIEVAL    find the right passages, filtered by
             what THIS user may see
ASSEMBLY     order and deduplicate what was found
GENERATION   answer, grounded, with citations
EVALUATION   know retrieval works, separately from
             generation
\`\`\`

**Four of the five stages are retrieval and data engineering.** **The generation stage is a well-understood call**, and the interesting failures all happen before it.

**The three requirements that shape everything, drawn out in the first two minutes:**

\`\`\`
PERMISSIONS  do users see different documents?
             → if yes, access control is the
               spine of the design, not a filter
             → and it is a CORRECTNESS property,
               not a relevance one
FRESHNESS    how fast must a new/changed document
             be answerable? minutes or a day?
             → sets the ingestion architecture
CITATION     must every answer be traceable to a
             source? almost always yes
             → the answer is only as trustworthy
               as its citation
\`\`\`

**The failure that ends the interview: a permissions leak.** **Retrieval that ignores who is asking returns a passage from a document the user cannot see** — **and the model quotes it, so the leak is in the answer.** **A relevance filter that runs after retrieval is not access control**, which is the trap the design has to avoid from the first line.

**And the cost ceiling, because it bounds the design:** **every query is a retrieval plus a generation, and generation over retrieved context is the expensive part** — so caching, reranking cheaply, and not over-fetching are cost decisions, not optimisations.`,
    analogyLimit:
      '"Retrieve documents and let the model answer" hides that four of the five stages are retrieval and data engineering, and the model is the easy part. It hides that permissions are a correctness property threaded through retrieval, not a filter bolted on — a leak ends up quoted in the answer. It hides that freshness sets the ingestion architecture, that citation is what makes the answer trustworthy, and that re-ingesting on change is most of the operational cost.',
  },

  deepExplanation: {
    predict: {
      question:
        'An interviewer asks you to design an internal knowledge assistant for a 5,000-person company over its wiki, Google Drive, Slack and ticketing system. A candidate proposes: embed everything, retrieve top-k by similarity, put it in the prompt, answer. Name the four things this misses that the interviewer is waiting for.',
      answer: `**Miss 1 — permissions, which is the whole game here.**

**In a 5,000-person company, documents have access controls**, and they differ per user: HR files, salary data, private Slack channels, restricted drives. **Embedding everything into one index and retrieving by similarity means a query returns passages the asker cannot see** — **and the model quotes them.**

\`\`\`
Retrieve top-k → filter to what the user may see
  → a user with access to 5% of the corpus gets
    almost nothing (post-filter starvation)
Retrieve WITHIN what the user may see (pre-filter)
  → correct, and harder to implement
\`\`\`

*The design:* **permissions are stored as metadata on every chunk at ingestion, and retrieval pre-filters by the user\'s access.** **Access control lives in the retrieval query, bound from the authenticated session — never a post-hoc text check**, which is the same lesson as tool authorisation.

**Miss 2 — the sources are not documents, and chunking is not uniform.**

**A wiki page, a spreadsheet, a Slack thread and a ticket are four different shapes**, and one chunking strategy serves none of them well. **A Slack thread chunked like a wiki page produces context-free fragments; a spreadsheet chunked as prose is meaningless.** **Ingestion is per-source-type**, and the situating context (which document, which channel, which ticket) must be prepended before embedding or the chunk is unfindable and uninterpretable.

**Miss 3 — freshness, and re-ingestion.**

**These sources change constantly.** **A ticket resolved an hour ago, a wiki page edited this morning** — **and a stale index answers with last week\'s policy.** **The design needs an ingestion pipeline that reacts to changes** (webhooks or polling), re-chunks and re-embeds the changed document, and removes its old chunks — **and the freshness requirement (minutes vs a day) decides how aggressive that pipeline is.**

**Miss 4 — no evaluation and no citation.**

**"Answer" with no citation is untrustworthy** — an internal user cannot act on an unsourced claim about policy. **And with no evaluation, the team cannot tell a retrieval failure from a generation failure** when the answer is wrong. **Every answer cites its sources, and an eval set measures retrieval and generation separately.**

**What the interviewer wanted to hear.**

\`\`\`
· permissions pre-filtered in retrieval, bound
  from the session, stored per chunk
· per-source-type ingestion with situating
  context
· a change-driven re-ingestion pipeline sized to
  the freshness requirement
· grounded answers with citations, and a
  separated retrieval/generation eval
· the model call last, as the easy part
\`\`\`

**The transferable point: the naive answer treats RAG as a prompt problem, and the interviewer is testing whether you know it is a retrieval, permissions and data-freshness problem.** **The model is where juniors start and where the design ends.**`,
    },
  body: `## Framing and requirements

**Spend the first two minutes on the questions that change the architecture**, not on the model.

\`\`\`
· Do users have different access? → permissions
  are the spine (assume YES for an enterprise)
· How fresh must answers be? → minutes vs a day
  sets the ingestion pipeline
· Must answers cite sources? → almost always yes
· What is the corpus size and query volume? →
  sizes the index and the cost
· One source type or many? → decides how much
  ingestion complexity you own
\`\`\`

**The dominant non-functional requirements are correctness of access control and freshness**, not latency — **a wrong-permissions answer is a breach, and a stale answer is a support incident.** **State this ordering explicitly; it signals you understand the domain.**

## Ingestion — most of the system

\`\`\`
per source type:
  1. FETCH via API; react to changes (webhook or
     poll) for freshness
  2. PARSE into structural units — a wiki section,
     a Slack thread, a ticket, a spreadsheet
     region
  3. CHUNK on structure, packed to a budget (the
     chunking lesson), never a fixed token cut
  4. SITUATE — prepend document title, section,
     source, and for hard corpora a generated
     one-line description
  5. EXTRACT METADATA — including the PERMISSIONS:
     who may see this, as filterable fields
  6. EMBED and index, with the metadata alongside
\`\`\`

**Two decisions carry the stage.**

**Permissions are captured at ingestion, per chunk, as filterable metadata** — the access-control list, the channel membership, the drive sharing. **This is the single most important field**, because retrieval will filter on it, and it must be re-synced when a document\'s sharing changes (a subtle freshness case people miss: a document\'s content is unchanged but its access changed).

**And situating context is what makes retrieval work.** **A chunk stripped of "which document, which channel" is unfindable by a query naming them and uninterpretable when found** — so the header is prepended before embedding. **This is the contextual-retrieval move, and it is cheap and high-leverage.**

*Re-ingestion is the operational heart:* **a change rechunks and re-embeds the document and removes its old chunks** — because a stale chunk that is skipped by nothing still competes in retrieval. **The freshness requirement sizes this: minutes means event-driven; a day means a batch.**

## Retrieval — permissions first

\`\`\`
1. TRANSFORM the query if useful (expand, rewrite)
2. RETRIEVE — hybrid: vector for meaning, lexical
   for exact terms (error codes, names), fused
3. PRE-FILTER by the user\'s permissions, bound
   from the authenticated session
4. RERANK the candidates for precision
5. ASSEMBLE — dedupe, order for position, cap
\`\`\`

**Step 3 is the design\'s spine.** **Pre-filtering — restricting the search to what the user may see — is correct; post-filtering — retrieving broadly then discarding — starves restricted users** and risks leaking through the model if done sloppily. **The user\'s access set is derived from their identity in code, never supplied by the client**, which is the authorisation lesson applied to retrieval.

**Hybrid retrieval earns its place** because a knowledge base has both conceptual questions (vector) and exact-term questions — error codes, ticket ids, people\'s names (lexical) — **and vector search is weak on exactly the second kind.** **Reranking then buys precision** over the broad recall: retrieve 50, rerank to the best 8, **which keeps the context small and the answer grounded.**

## Generation and citation

\`\`\`
· assemble the reranked chunks with their source
  metadata into the prompt
· instruct: answer ONLY from the provided context;
  if it is not there, say so
· require a citation per claim, keyed to the
  chunk\'s source
· stream the answer
\`\`\`

**Citation is not decoration — it is the trust mechanism.** **An internal user acts on the answer only if they can verify it**, so every claim links to the source chunk, and the UI lets them open it. **And the "answer only from context, else decline" instruction is the hallucination control** — though, being a prompt, it is a quality measure and not a guarantee, so the evaluation checks faithfulness directly.

*The permissions guarantee is upstream:* **because retrieval already filtered to what the user may see, the model cannot cite something they cannot access** — which is why access control belonging in retrieval rather than in generation is load-bearing.

## Evaluation and the cost ceiling

**A RAG design is incomplete without an evaluation story**, because when an answer is wrong you must know which stage failed.

\`\`\`
RETRIEVAL   recall@k on an eval set — was the
            answering passage retrieved (within
            the user\'s permissions)?
GENERATION  faithfulness — is every claim
            supported by the retrieved context?
END TO END  answer correctness, and appropriate
            refusal on unanswerable questions
ONLINE      thumbs, rephrase rate, citation-click
            rate, stale-answer reports
\`\`\`

**The cost ceiling bounds the design.** **Each query is a retrieval (cheap) plus a generation over retrieved context (the expensive part, since context tokens dominate).** **Levers: cache answers to repeated questions, keep the reranked context small (8 chunks, not 50), and use a cheaper model where the eval shows it holds.** **Ingestion cost is real too** — re-embedding a large, frequently-changing corpus — and it is bounded by only re-embedding changed documents.

## What to say in a design discussion

**That RAG is a retrieval system ending in a model, so four of five stages are data engineering.**

**That permissions are a correctness property, pre-filtered in retrieval, bound from the session, and stored per chunk — never a post-hoc filter.**

**That ingestion is per-source-type, situates each chunk before embedding, and re-ingests on change (content and access), sized to the freshness requirement.**

**That retrieval is hybrid then reranked, keeping the context small.**

**That every answer cites its sources, and "answer only from context" is a quality control the evaluation verifies.**

**And that evaluation separates retrieval from generation, because that is the first question when an answer is wrong.**`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'rag-pipeline',
      title: 'The two loops: ingestion writes the index, queries read it',
      caption:
        'Step through it. The top loop runs on every document change; the bottom on every query. Permissions are captured in the first and enforced in the second.',
      nodes: [
        { id: 'sources', label: 'Sources: wiki, Drive, Slack, tickets', kind: 'external', x: 0, y: 60, detail: 'Four different shapes, each needing its own parser and chunking. A Slack thread is not a wiki page; a spreadsheet is not prose. One uniform strategy serves none of them well.' },
        { id: 'ingest', label: 'Ingestion: chunk, situate, extract permissions, embed', kind: 'service', x: 300, y: 60, detail: 'Structural chunking packed to a budget; a situating header prepended before embedding so the chunk is findable and interpretable; and the access-control metadata captured per chunk — the single most important field, because retrieval filters on it.' },
        { id: 'index', label: 'Vector + metadata index', kind: 'store', x: 620, y: 60, detail: 'Vectors for meaning, a metadata store for the permissions and source fields, and a lexical index for exact terms. The index is derived data — rebuildable from the sources, which are the truth.' },
        { id: 'reingest', label: 'Re-ingest on change (content AND access)', kind: 'note', x: 300, y: 200, detail: 'A document edit rechunks and re-embeds and removes the old chunks. A sharing change re-syncs the permissions metadata with no content change — the freshness case teams forget. Event-driven for minutes, batch for a day.' },
        { id: 'query', label: 'User query + identity', kind: 'client', x: 0, y: 320, detail: 'The identity is the load-bearing input. The user\'s access set is derived from it in code, never supplied by the client — the same rule as tool authorisation.' },
        { id: 'retrieve', label: 'Hybrid retrieve, PRE-FILTER by permissions, rerank', kind: 'service', x: 300, y: 320, detail: 'Vector plus lexical, restricted to what this user may see before the search rather than after — pre-filtering is correct, post-filtering starves restricted users and risks leaking through the model. Then rerank 50 candidates to the best 8 for precision.' },
        { id: 'assemble', label: 'Assemble: dedupe, order, cap', kind: 'service', x: 620, y: 320, detail: 'Order for position rather than rank, because material in the middle of a long context is used less reliably. Keep it small — 8 chunks, not 50 — which is a cost decision as much as a quality one.' },
        { id: 'generate', label: 'Generate: grounded answer + citations', kind: 'service', x: 900, y: 320, detail: 'Answer only from the provided context, decline if it is not there, and cite each claim. Because retrieval already filtered to the user\'s access, the model cannot cite something they cannot see — the permissions guarantee is upstream of generation.' },
      ],
      edges: [
        { id: 'r1', source: 'sources', target: 'ingest', kind: 'sync' },
        { id: 'r2', source: 'ingest', target: 'index', kind: 'write' },
        { id: 'r3', source: 'reingest', target: 'ingest', kind: 'control' },
        { id: 'r4', source: 'query', target: 'retrieve', kind: 'sync' },
        { id: 'r5', source: 'index', target: 'retrieve', kind: 'read' },
        { id: 'r6', source: 'retrieve', target: 'assemble', kind: 'sync' },
        { id: 'r7', source: 'assemble', target: 'generate', kind: 'sync' },
      ],
      steps: [
        {
          id: 'rg1',
          title: 'Ingestion is most of the system',
          description:
            'Per source type, chunk on structure, situate before embedding, and capture permissions per chunk. This runs on every document change, not once.',
          nodes: ['sources', 'ingest', 'index'],
          edges: ['r1', 'r2'],
        },
        {
          id: 'rg2',
          title: 'Re-ingest on content and on access change',
          description:
            'An edit rechunks; a sharing change re-syncs permissions with no content change. The freshness requirement decides whether this is event-driven or batch.',
          nodes: ['reingest'],
          edges: ['r3'],
        },
        {
          id: 'rg3',
          title: 'Retrieval enforces permissions, before the search',
          description:
            'Pre-filter by the user\'s access derived from their identity in code. This is the spine of the design and a correctness property, not a relevance filter.',
          nodes: ['query', 'retrieve'],
          edges: ['r4', 'r5'],
        },
        {
          id: 'rg4',
          title: 'Assemble small and ordered, then answer with citations',
          description:
            'Rerank to a small, well-ordered context; answer only from it; cite every claim. The model call is the last and easiest stage.',
          nodes: ['assemble', 'generate'],
          edges: ['r6', 'r7'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'permissions-filter',
      title: 'Why permissions must pre-filter, not post-filter',
      caption:
        'Read the two paths as correctness versus a leak. Post-filtering is where permissions-aware RAG designs quietly fail.',
      code: `flowchart TB
    Q["**User with access to 5%<br/>of the corpus asks a question**"]

    Q --> POST["**POST-FILTER**<br/>retrieve top-k by similarity,<br/>THEN discard what they<br/>cannot see"]
    POST --> P1["expected survivors ≈ 0.05 × k<br/>→ usually nothing returned"]
    POST --> P2["**and worse:** if the discard is<br/>sloppy or happens after the<br/>model reads the chunk, the<br/>forbidden passage is **quoted<br/>in the answer** — a breach"]

    Q --> PRE["**PRE-FILTER**<br/>restrict the search to what<br/>the user may see, THEN<br/>retrieve within it"]
    PRE --> R1["the top-k is drawn from the<br/>permitted set → the right<br/>number of correct results"]
    PRE --> R2["the model never sees a<br/>forbidden chunk, so it<br/>cannot cite one"]

    P1 --> D["**Access set derived from the<br/>authenticated session, in code**<br/>— never a client-supplied filter,<br/>never a post-hoc text check.<br/><br/>**Permissions are correctness,<br/>not relevance.**"]
    R1 --> D
    R2 --> D

    style P2 fill:#2a1a1a,stroke:#8c4a4a
    style R2 fill:#17272a,stroke:#35897e
    style D fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The contextual-retrieval write-up is the most useful reference for this design because it isolates the single ingestion decision that most improves a real assistant, and shows it is a write-time decision.

**The problem it names.** A chunk pulled from an enterprise document loses the context that made it meaningful — which team\'s policy, which quarter, which product — and that loss shows up as retrieval failure. **In a company-wide assistant this is acute**, because the corpus is full of documents that only make sense in place: a Slack message, a ticket comment, a wiki section deep in a hierarchy.

**The intervention.** Prepend a short situating description to each chunk before embedding — generated cheaply from the chunk and its surrounding document. **A substantial reduction in retrieval failures, achieved at ingestion, with no change to the model or the retriever.**

**Three lessons for the design.**

**The highest-leverage work is at write time.** The team\'s instinct when answers are poor is to tune the prompt or swap the model; **the fix was in ingestion**, which is where this whole design puts its effort.

**It composes with hybrid retrieval.** The situating context helps both the embedding and the lexical match, which is why the design pairs them — the same header makes a chunk findable by meaning and by term.

**And it is paid once per document, not per query.** Re-run on change, amortised over every future question — the good side of the re-ingestion cost this design has to carry anyway.

**Where it does not help.** It adds context; it does not enforce permissions, keep the index fresh, or make an answer trustworthy. **Those are separate parts of the design** — which is the point: a real assistant is a collection of stages, and improving one does not substitute for the others.`,
  },

  tradeoffs: {
    intro:
      'The decisions a RAG knowledge assistant forces, most of which trade quality or freshness against cost.',
    rows: [
      {
        option: 'One uniform chunking strategy',
        whenItWins:
          'A single homogeneous source type.',
        whenItLoses:
          'Mixed sources — a Slack thread, a spreadsheet and a wiki page need different handling.',
        cost:
          'Context-free fragments from the sources it does not fit.',
      },
      {
        option: 'Per-source-type ingestion',
        whenItWins:
          'Any real enterprise corpus, which is always mixed.',
        whenItLoses:
          'More parsers to build and maintain.',
        cost:
          'Ingestion complexity, which is where the work belongs.',
      },
      {
        option: 'Post-filtering permissions',
        whenItWins:
          'Nowhere safely — it starves restricted users and risks leaks.',
        whenItLoses:
          'A user with narrow access gets nothing, or a forbidden chunk reaches the model.',
        cost:
          'A permissions breach, the interview-ending failure.',
      },
      {
        option: 'Pre-filtering permissions',
        whenItWins:
          'Always, for a multi-user corpus with access control.',
        whenItLoses:
          'Harder to implement, and interacts with the index structure.',
        cost:
          'Retrieval complexity, for correctness.',
      },
      {
        option: 'Vector retrieval only',
        whenItWins:
          'Conceptual questions where meaning matters more than exact terms.',
        whenItLoses:
          'Error codes, ticket ids, people\'s names — where lexical is strong and vectors are weak.',
        cost:
          'Missed exact-term queries.',
      },
      {
        option: 'Hybrid retrieval',
        whenItWins:
          'A knowledge base, which has both conceptual and exact-term questions.',
        whenItLoses:
          'Two retrievers to run and fuse.',
        cost:
          'More retrieval machinery, for broader coverage.',
      },
      {
        option: 'Large retrieved context',
        whenItWins:
          'Rarely — when the answer genuinely spans many passages.',
        whenItLoses:
          'Cost, dilution, and material lost in the middle of the window.',
        cost:
          'Token spend and weaker grounding.',
      },
      {
        option: 'Reranked small context',
        whenItWins:
          'Almost always — retrieve broadly, rerank to the best few.',
        whenItLoses:
          'A reranking step and its latency.',
        cost:
          'One more stage, for precision and lower cost.',
      },
      {
        option: 'Event-driven re-ingestion',
        whenItWins:
          'Tight freshness — answers must reflect changes in minutes.',
        whenItLoses:
          'More infrastructure — webhooks, a processing queue.',
        cost:
          'Operational complexity, for freshness.',
      },
      {
        option: 'Batch re-ingestion',
        whenItWins:
          'Relaxed freshness — a daily refresh is acceptable.',
        whenItLoses:
          'Answers lag reality by up to the batch interval.',
        cost:
          'Staleness, for simplicity.',
      },
      {
        option: 'Answers without citations',
        whenItWins:
          'Nowhere for an internal knowledge tool.',
        whenItLoses:
          'Users cannot verify or trust the answer, so they do not act on it.',
        cost:
          'The assistant\'s usefulness.',
      },
      {
        option: 'Cited, grounded answers',
        whenItWins:
          'Always — the citation is the trust mechanism.',
        whenItLoses:
          'Requires the generation to track source per claim.',
        cost:
          'Prompt and UI work, for trust.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Embed all the documents, retrieve the top-k by similarity, and let the model answer."',
      whyWeak:
        'It treats a retrieval, permissions and freshness problem as a prompt problem. In a real corpus it leaks documents the user cannot see, returns context-free fragments from mixed source types, and answers with stale data — none of which the model can fix.',
      strongAnswer:
        '"I\'d frame it as an information-retrieval system that ends in a model, so four of the five stages are data engineering. First the requirements that change the architecture: do users have different access, how fresh must answers be, must they cite sources. Then per-source-type ingestion that situates each chunk and captures permissions as metadata; retrieval that pre-filters by the user\'s access before searching; a small reranked context; grounded answers with citations; and an evaluation that separates retrieval from generation. The model call is the last and easiest part."',
    },
    {
      weakAnswer: '"We retrieve the most relevant chunks, then filter out any the user isn\'t allowed to see."',
      whyWeak:
        'Post-filtering is not access control. A user with access to a small fraction of the corpus gets almost nothing, and if the filter is sloppy or runs after the model reads the chunk, a forbidden passage ends up quoted in the answer — a breach.',
      strongAnswer:
        '"Permissions pre-filter the search, not post-filter the results. Each chunk carries its access metadata from ingestion, and retrieval restricts to what this user may see before it searches, with the access set derived from the authenticated session in code — never client-supplied. That guarantees the model never sees a forbidden chunk, so it cannot cite one, and it means restricted users still get the right number of results. Permissions here are a correctness property, not a relevance filter, and I\'d also re-sync them when a document\'s sharing changes even if its content did not."',
    },
    {
      weakAnswer: '"We index everything once at launch and the assistant answers from that."',
      whyWeak:
        'Enterprise sources change constantly. A one-time index answers with last week\'s policy, a resolved ticket still shows as open, and an edited wiki page is quoted in its old form — which for a knowledge tool is a support incident, not a minor staleness.',
      strongAnswer:
        '"Freshness is a first-class requirement that sizes the ingestion pipeline. I\'d react to changes — webhooks where the source supports them, polling where it doesn\'t — and re-chunk, re-embed and remove the old chunks for a changed document. The freshness target decides the cadence: minutes means event-driven, a day means batch. And I\'d treat an access change as a freshness event too, since a document\'s content can be unchanged while who may see it changes."',
    },
    {
      weakAnswer: '"We use one chunking strategy for all the sources to keep it simple."',
      whyWeak:
        'A Slack thread, a spreadsheet, a ticket and a wiki page are four different shapes. One strategy serves none well — a Slack thread chunked like prose loses who said what, a spreadsheet chunked as text is meaningless, and both retrieve as fragments.',
      strongAnswer:
        '"Ingestion is per-source-type, because the structure differs. Each source gets a parser that produces meaningful units — a thread with its participants, a spreadsheet region with its headers, a wiki section with its path — and each chunk is situated with where it came from before embedding, so it\'s findable by a query naming the source and interpretable when retrieved. The retrieval, assembly and generation stages are then uniform; only ingestion is source-specific, which is the right place to absorb the variety."',
    },
    {
      weakAnswer: '"The model answers from the context, so hallucination isn\'t a concern."',
      whyWeak:
        '"Answer from the context" is a prompt instruction, which is a quality measure and not a guarantee — the model can still confabulate, or answer from parts of the context that don\'t actually support the claim. Without evaluation, nobody knows how often.',
      strongAnswer:
        '"I\'d instruct the model to answer only from the provided context and decline otherwise, and cite each claim — but I treat that as a quality control, not a guarantee, so the evaluation measures faithfulness directly: is every claim supported by the retrieved context. The evaluation separates retrieval from generation, because when an answer is wrong the first question is which stage failed — was the answering passage not retrieved, or retrieved and ignored. And citations give the user their own check: they act on the answer because they can open the source."',
    },
    {
      weakAnswer: '"For cost, we\'ll just use a cheaper model."',
      whyWeak:
        'It reaches for the model when the cost is dominated by the retrieved context tokens sent on every query, and by re-embedding a large changing corpus. A cheaper model may also fail the faithfulness the design depends on, and only the eval would tell you.',
      strongAnswer:
        '"The cost is a retrieval, which is cheap, plus a generation over retrieved context, where the context tokens dominate — so the biggest levers are keeping the reranked context small, eight chunks not fifty, and caching answers to repeated questions, which in an enterprise are common. On ingestion, only re-embed changed documents. A cheaper generation model is on the table, but I\'d gate it on the faithfulness eval rather than assume it holds, because a cheaper model that hallucinates more defeats the whole design."',
    },
  ],

  flashcards: [
    {
      id: 'fc-raga-1',
      front: 'What is the one-sentence reframe of a RAG assistant?',
      back: 'An information-retrieval system that happens to end in a language model — so four of five stages are data engineering, and the model is the easy part.',
      topic: 'rag',
    },
    {
      id: 'fc-raga-2',
      front: 'Which three requirements shape the architecture?',
      back: 'Permissions (do users see different documents), freshness (how fast changes must be answerable), and citation (must answers be traceable).',
      topic: 'rag',
    },
    {
      id: 'fc-raga-3',
      front: 'Why is post-filtering permissions wrong?',
      back: 'It starves restricted users (few survivors) and can leak a forbidden chunk into the answer. Access control must pre-filter the search.',
      topic: 'permissions',
    },
    {
      id: 'fc-raga-4',
      front: 'Where does the user\'s access set come from?',
      back: 'Derived from the authenticated session in code, never supplied by the client — the same rule as tool authorisation.',
      topic: 'permissions',
    },
    {
      id: 'fc-raga-5',
      front: 'What makes permissions a correctness property, not a relevance one?',
      back: 'A wrong-access answer is a breach, and the model quotes what retrieval returns — so the leak ends up in the answer.',
      topic: 'permissions',
    },
    {
      id: 'fc-raga-6',
      front: 'Why is ingestion per-source-type?',
      back: 'A Slack thread, spreadsheet, ticket and wiki page are different shapes; one chunking strategy serves none well.',
      topic: 'ingestion',
    },
    {
      id: 'fc-raga-7',
      front: 'What is "situating" a chunk, and why?',
      back: 'Prepending its document, section and source before embedding — so it is findable by a query naming them and interpretable when retrieved.',
      topic: 'ingestion',
    },
    {
      id: 'fc-raga-8',
      front: 'What is the freshness case teams forget?',
      back: 'An access change with no content change — a document\'s sharing changed, so its permission metadata must be re-synced.',
      topic: 'freshness',
    },
    {
      id: 'fc-raga-9',
      front: 'What sizes the re-ingestion pipeline?',
      back: 'The freshness requirement — minutes means event-driven (webhooks); a day means batch.',
      topic: 'freshness',
    },
    {
      id: 'fc-raga-10',
      front: 'Why hybrid retrieval?',
      back: 'A knowledge base has conceptual questions (vector) and exact-term ones — error codes, ids, names (lexical) — and vectors are weak on the second.',
      topic: 'rag',
    },
    {
      id: 'fc-raga-11',
      front: 'Why rerank to a small context?',
      back: 'Retrieve broadly for recall, rerank to the best few for precision — keeping the context small grounds the answer and cuts cost.',
      topic: 'rag',
    },
    {
      id: 'fc-raga-12',
      front: 'Why is a citation the trust mechanism?',
      back: 'An internal user acts on the answer only if they can verify it, so every claim links to its source chunk.',
      topic: 'citation',
    },
    {
      id: 'fc-raga-13',
      front: 'Why must evaluation separate retrieval from generation?',
      back: 'When an answer is wrong, the first question is which stage failed — the passage not retrieved, or retrieved and ignored.',
      topic: 'citation',
    },
    {
      id: 'fc-raga-14',
      front: 'What dominates the per-query cost?',
      back: 'The generation over retrieved context — context tokens dominate — so keep the context small and cache repeated questions.',
      topic: 'rag',
    },
  ],

  quiz: [
    {
      id: 'q-raga-1',
      kind: 'scenario',
      prompt:
        'In an interview, a candidate opens with "embed everything, retrieve top-k, prompt the model." What is the interviewer most likely waiting to hear about?',
      options: [
        { id: 'a', label: 'Permissions — that different users see different documents, and access control must be pre-filtered into retrieval' },
        { id: 'b', label: 'Which embedding model is best' },
        { id: 'c', label: 'The exact prompt wording' },
        { id: 'd', label: 'The temperature setting' },
      ],
      correct: ['a'],
      explanation:
        'For an enterprise corpus, permissions are the spine of the design and the most likely place to fail. The model and prompt are the easy, last part, which is why opening there signals a misread of the question.',
      difficulty: 'core',
      topic: 'permissions',
    },
    {
      id: 'q-raga-2',
      kind: 'scenario',
      prompt:
        'A user with access to 5% of the corpus gets almost no results, and occasionally an answer quotes a document they cannot open. What is the design error?',
      options: [
        { id: 'a', label: 'Permissions are post-filtered — retrieval searches everything then discards, starving the user and risking a leak into the answer' },
        { id: 'b', label: 'The embedding model is too small' },
        { id: 'c', label: 'k is set too low' },
        { id: 'd', label: 'The corpus is too large' },
      ],
      correct: ['a'],
      explanation:
        'Post-filtering both starves restricted users and, done sloppily, lets a forbidden chunk reach the model. Pre-filtering restricts the search to the permitted set, so the top-k is correct and the model never sees what the user cannot.',
      difficulty: 'core',
      topic: 'permissions',
    },
    {
      id: 'q-raga-3',
      kind: 'scenario',
      prompt:
        'The assistant answers a policy question with last month\'s policy, though the wiki was updated two weeks ago. What is missing?',
      options: [
        { id: 'a', label: 'A re-ingestion pipeline that reacts to document changes — rechunking, re-embedding, and removing old chunks' },
        { id: 'b', label: 'A larger retrieved context' },
        { id: 'c', label: 'A better reranker' },
        { id: 'd', label: 'A more capable model' },
      ],
      correct: ['a'],
      explanation:
        'Freshness is an ingestion property. The old chunks are still in the index and still competing, so the fix is a pipeline that re-ingests changed documents and removes their stale chunks — sized to the freshness requirement.',
      difficulty: 'core',
      topic: 'freshness',
    },
    {
      id: 'q-raga-4',
      kind: 'scenario',
      prompt:
        'A user asks for the ticket with error code E-4471 and vector retrieval misses it entirely. Why, and what fixes it?',
      options: [
        { id: 'a', label: 'Vector search is weak on rare exact tokens; hybrid retrieval adds a lexical index that matches the code directly' },
        { id: 'b', label: 'The chunk was too large' },
        { id: 'c', label: 'The reranker discarded it' },
        { id: 'd', label: 'The permissions filter removed it' },
      ],
      correct: ['a'],
      explanation:
        'A rare identifier is averaged into a passage-level vector and lost, while a lexical index finds it instantly. This is exactly why a knowledge base needs hybrid retrieval — conceptual questions and exact-term questions have opposite retrieval profiles.',
      difficulty: 'core',
      topic: 'rag',
    },
    {
      id: 'q-raga-5',
      kind: 'scenario',
      prompt:
        'An answer is wrong. What does separating retrieval and generation evaluation let you determine first?',
      options: [
        { id: 'a', label: 'Whether the answering passage was retrieved at all, or retrieved and then ignored by the model' },
        { id: 'b', label: 'Whether the user liked the answer' },
        { id: 'c', label: 'Whether latency was acceptable' },
        { id: 'd', label: 'Whether the corpus is large enough' },
      ],
      correct: ['a'],
      explanation:
        'Recall@k tells you if retrieval found the passage (within permissions); faithfulness tells you if generation used it. Those are different failures needing different fixes, which a single end-to-end score cannot distinguish.',
      difficulty: 'advanced',
      topic: 'citation',
    },
    {
      id: 'q-raga-6',
      kind: 'multi',
      prompt:
        'Which of these belong in the ingestion stage rather than the query stage? Select all that apply.',
      options: [
        { id: 'a', label: 'Capturing each chunk\'s access-control metadata' },
        { id: 'b', label: 'Prepending a situating header before embedding' },
        { id: 'c', label: 'Re-chunking a document when it changes' },
        { id: 'd', label: 'Deriving the current user\'s access set' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Permissions metadata, situating, and re-ingestion on change are all write-time work. The current user\'s access set is a query-time input, derived from their session — it is what the pre-filter matches the ingested metadata against.',
      difficulty: 'advanced',
      topic: 'ingestion',
    },
  ],

  exercises: [
    {
      id: 'ex-raga-1',
      kind: 'design',
      title: 'Design a legal-firm knowledge assistant end to end',
      estimatedMinutes: 45,
      prompt: `Design a knowledge assistant for a 400-lawyer firm. The corpus: internal memos, past case files, contract templates, and a research database of statutes and precedents. Hard constraints: a lawyer may only see documents for matters they are staffed on (ethical walls between clients are mandatory and legally required); answers must cite the exact source; and the research database updates as new rulings are published.

**Part 1.** Frame the requirements and say which non-functional requirement dominates.

**Part 2.** Design the ingestion pipeline, handling the four source types and the ethical walls.

**Part 3.** Design permissions-aware retrieval. Be specific about how a wall is enforced.

**Part 4.** Design freshness for the research database versus the case files.

**Part 5.** Design the evaluation, including the one failure that would be a firing offence.

Then answer:

- Where would you spend the least effort, and why?
- What would you refuse to automate?`,
      rubric: [
        'Access control is named as the dominant NFR, above latency.',
        'Ingestion is per-source-type and captures matter-level permissions.',
        'Ethical walls are enforced by pre-filtering, bound from identity in code.',
        'Freshness differs by source, sized to how each changes.',
        'Evaluation separates retrieval from generation and names the wall-leak as the critical failure.',
        'Least effort is on the model/prompt, with justification.',
        'Identifies something that should stay human (e.g. legal advice).',
      ],
      modelAnswer: `**Part 1 — requirements, and the dominant NFR**

\`\`\`
FUNCTIONAL
  answer questions over memos, case files,
  templates, and a statute/precedent database,
  with exact citations

NON-FUNCTIONAL, in priority order
  1. ACCESS CONTROL — ethical walls between
     clients are legally mandatory. A leak is not
     a bug, it is a malpractice/ethics violation.
  2. CITATION ACCURACY — a lawyer acts on the
     answer only against a verifiable source; a
     fabricated citation is a professional
     hazard.
  3. FRESHNESS — new rulings must be answerable
     quickly; case files change slower.
  4. LATENCY — a distant fourth. A lawyer will
     wait five seconds for a correct, sourced,
     walled answer.
\`\`\`

**Access control dominates, and I would say so explicitly and first.** **This corpus has a legal requirement that a lawyer on matter A never sees matter B\'s documents** — so the entire design is organised around a filter that cannot fail, and every other decision is subordinate. **A candidate who opens with the model here has failed the question.**

*And I would name the specific stakes:* **an ethical-wall breach is worse than a wrong answer, because it is a legal and ethical failure independent of whether the answer was useful** — which reorders the whole design around containment rather than quality.

---

**Part 2 — ingestion**

\`\`\`
PER SOURCE TYPE:

MEMOS & CASE FILES (per-matter, walled)
  · parse into sections; chunk on structure
  · situate: matter id, client, document title,
    date, author
  · PERMISSIONS METADATA: the matter id and the
    staffing list — the wall is a field
  · embed + index

CONTRACT TEMPLATES (firm-wide, mostly)
  · structural chunking by clause
  · situate: template name, clause path
  · permissions: firm-wide, or practice-group
    scoped

STATUTE / PRECEDENT DATABASE (public, shared)
  · chunk by statute section / by ruling
  · situate: citation, court, date, jurisdiction
  · permissions: everyone (public law)
  · but: freshness-critical (Part 4)
\`\`\`

**The permission metadata is the design.** **Every chunk from a matter carries the matter id and the set of lawyers staffed on it** — and that set is the wall. **When staffing changes (a lawyer joins or leaves a matter), the permission metadata must re-sync** even though no document changed — the access-change freshness case, and here it is legally load-bearing: **a lawyer rotated off a matter must lose access immediately.**

*One subtlety worth raising:* **conflict checks.** **The firm already has a system of record for who is walled from what** — I would treat that as the source of truth for permissions and sync from it, rather than inventing a parallel access model in the assistant. **Re-deriving access risks disagreeing with the authoritative system, which is exactly the disagreement that causes a breach.**

---

**Part 3 — permissions-aware retrieval, and the wall**

\`\`\`
On a query from lawyer L:
  1. derive L\'s permitted matter set from the
     firm\'s conflict/staffing system (the source
     of truth), in code, from L\'s authenticated
     identity — NEVER from the request
  2. PRE-FILTER: restrict the vector + lexical
     search to chunks whose matter id is in L\'s
     set, OR are firm-wide/public
  3. retrieve, rerank, assemble
  4. generate with citations
\`\`\`

**The wall is enforced at step 2, before the search, as a hard metadata filter** — not a post-hoc discard. **This guarantees a matter-B chunk is never a candidate for a matter-A lawyer**, so it cannot be retrieved, reranked, read by the model, or cited. **The forbidden document is invisible, not filtered-out-after-the-fact.**

**Why pre-filter is non-negotiable here specifically:**

\`\`\`
Post-filter: matter-B chunk retrieved, then
  discarded → one bug in the discard, or the
  model reading it before the discard, is a
  wall breach
Pre-filter: matter-B chunk never enters the
  candidate set → no code path reaches it
\`\`\`

**The strongest form is separate indexes per wall boundary** where the walls are coarse (per practice group), so the restriction is structural — **but per-matter walls are too fine-grained for an index each**, so a hard metadata pre-filter on a shared index is the practical answer, with the filter derived from the authoritative source. **I would also test the wall adversarially**: a query crafted to elicit another matter\'s content must return nothing from it.

---

**Part 4 — freshness, differentiated by source**

\`\`\`
STATUTE / PRECEDENT DATABASE — tight
  · new rulings must be answerable within hours
    (a lawyer citing superseded law is a real
    harm)
  · event-driven or frequent-poll ingestion of
    the research feed
  · and a SUPERSESSION model: a ruling that
    overturns another must be findable AS the
    current law — precedent has versions, like
    the policy-versioning case
  · so retrieval prefers current law, and a
    citation to overturned law is flagged

CASE FILES / MEMOS — relaxed
  · a memo edited today is fine to reflect within
    the day
  · but STAFFING changes are tight — a wall
    change propagates immediately (access
    freshness, Part 2)

TEMPLATES — slow
  · change rarely; batch re-ingestion is fine
\`\`\`

**The differentiation is the point.** **One freshness policy for the whole corpus would either over-invest in slow-changing templates or under-invest in the research feed** — so freshness is per-source, sized to how each source actually changes and how much a stale answer costs. **The research database and the staffing walls are the two tight cases, for different reasons — one is content, one is access.**

*The supersession requirement is the subtle one:* **precedent is not append-only; a ruling can overturn earlier law**, so "the current state of the law on X" needs the index to know which rulings are still good — a metadata field, maintained from the research feed, that retrieval and citation both respect. **A confidently-cited overturned precedent is the freshness failure that matters most.**

---

**Part 5 — evaluation, and the firing-offence failure**

\`\`\`
RETRIEVAL
  · recall@k WITHIN permissions — was the
    answering passage retrieved for a lawyer who
    may see it?
  · WALL INTEGRITY — for a set of adversarial
    queries, assert that ZERO chunks from a
    forbidden matter are ever retrieved. This is
    the critical eval.

GENERATION
  · faithfulness — every claim supported by the
    retrieved context
  · citation validity — every citation resolves
    to a real, correct source (a fabricated
    citation is a specific legal hazard)

END TO END
  · appropriate refusal — declines when the
    answer isn\'t in the permitted corpus, rather
    than guessing

ONLINE
  · citation-click and citation-correction rate
  · any report of a wall-adjacent answer → an
    incident, reviewed
\`\`\`

**The firing-offence failure is a wall breach: an answer that cites or reveals a matter the lawyer is not staffed on.** **It is not a quality metric to trade off — it is a hard invariant, tested adversarially, and any occurrence in production is an incident with legal reporting obligations.** **So wall integrity is a gate that blocks any release absolutely**, above all quality metrics, and I would build the adversarial wall-test suite before shipping anything.

**Second is citation fabrication** — **a plausible but non-existent case citation is a documented professional hazard**, so citation validity (does the cited source exist and say this) is a mechanical check that also gates.

---

**Where I\'d spend the least effort**

**The model and the prompt.** **Generation over a small, well-retrieved, permission-filtered context is the well-understood part** — a capable model with an "answer only from context, cite each claim, decline if absent" instruction is most of it. **The differentiation and the risk are all upstream: the walls, the ingestion, the freshness, the citation accuracy.** **Spending the interview on prompt engineering would be spending it on the one stage that is nearly solved.**

*The honest caveat:* **least effort is not zero effort** — the grounding and refusal behaviour still needs the faithfulness eval to confirm it holds, and a cheaper model gets gated on that eval rather than assumed. **But relative to the wall-enforcement and freshness work, generation is a small, bounded problem.**

---

**What I\'d refuse to automate**

**Legal advice, and the final citation-to-authority.** **The assistant retrieves and summarises what the firm\'s documents and the law say; it does not tell a lawyer what to do.** **The line is: it is a research and retrieval tool, not a source of legal conclusions** — because a wrong legal conclusion, unlike a wrong summary, is malpractice, and the responsibility must sit with the lawyer.

**Concretely:** **every answer is framed as "here is what these sources say", with the sources front and centre, and the lawyer draws the conclusion.** **The system\'s job is to get them to the right, permitted, current sources quickly and verifiably** — which is enormously valuable and stops short of the judgment that must remain human. **This is the human-in-the-loop lesson applied at the level of the product\'s purpose: the irreversible, high-consequence act — giving legal advice — stays with the person accountable for it.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-raga-1',
      level: 'basic',
      question: 'What kind of system is a RAG assistant, really?',
      guidance:
        'An information-retrieval system ending in a model. Look for the candidate putting the effort into retrieval, not the prompt.',
    },
    {
      id: 'iq-raga-2',
      level: 'basic',
      question: 'What requirements would you clarify before designing?',
      guidance:
        'Permissions, freshness, citation, corpus size, source types. The first three change the architecture.',
    },
    {
      id: 'iq-raga-3',
      level: 'intermediate',
      question: 'How do you keep a user from seeing documents they lack access to?',
      guidance:
        'Pre-filter retrieval by permissions bound from the session, stored per chunk. Not a post-hoc filter.',
    },
    {
      id: 'iq-raga-4',
      level: 'intermediate',
      question: 'The corpus changes constantly. How do you stay fresh?',
      guidance:
        'A change-driven re-ingestion pipeline sized to the freshness target, including access changes, removing old chunks.',
    },
    {
      id: 'iq-raga-5',
      level: 'advanced',
      question: 'You have wiki, Slack, spreadsheets and tickets. How do you ingest them?',
      guidance:
        'Per-source-type parsing and chunking, each chunk situated before embedding; uniform retrieval downstream.',
    },
    {
      id: 'iq-raga-6',
      level: 'advanced',
      question: 'An answer is wrong. How do you find out why?',
      guidance:
        'Separate retrieval and generation evaluation — recall@k versus faithfulness — to localise the failing stage.',
    },
    {
      id: 'iq-raga-7',
      level: 'followup',
      question: 'How do you control cost?',
      guidance:
        'Small reranked context, cache repeated questions, re-embed only changed documents; a cheaper model only if the eval holds.',
    },
    {
      id: 'iq-raga-8',
      level: 'followup',
      question: 'Why cite sources, and how?',
      guidance:
        'Citation is the trust mechanism — every claim links to its source chunk, verifiable in the UI. And permissions upstream mean no forbidden citation.',
    },
  ],

  activeLearning: [
    {
      id: 'al-raga-1',
      kind: 'what-changes-if',
      prompt:
        'Change the scale: instead of a 5,000-person company, this is a public-facing assistant over a product\'s documentation, used by millions, with no per-user permissions. What gets easier, what gets harder, and what is genuinely new?',
      discussion: `**Removing permissions removes the spine of the enterprise design — and scale and abuse move into its place**, so the difficulty relocates rather than disappearing.

**What gets easier.**

**Permissions vanish.** **A public docs corpus is the same for everyone**, so pre-filtering, per-chunk access metadata, and access-change freshness all disappear. **The hardest part of the enterprise design is simply gone**, which is a large simplification — and it changes retrieval from "per-user filtered" to "one shared index."

**Freshness relaxes somewhat.** **Documentation changes on release cycles, not continuously**, so batch re-ingestion on each docs deploy is usually fine — no webhooks per document, no staffing sync.

**And the corpus is curated.** **Product docs are written to be read, structured, and consistent** — unlike an enterprise\'s sprawl of memos and Slack threads — so ingestion is cleaner and situating is easier.

**What gets harder.**

**Scale: millions of users, one index.** **The enterprise had 5,000 users and modest QPS; this has query volume orders of magnitude higher.** So:

\`\`\`
· caching becomes central, not a nice-to-have —
  the same questions recur constantly across
  millions of users, so a cache on common
  questions serves a large fraction of traffic
  cheaply
· the vector index must serve high QPS — read
  replicas, and the index sized for throughput
· cost is now a volume problem: generation over
  retrieved context × millions of queries
\`\`\`

**Cost dominates in a way it did not.** **The enterprise cared about cost; here it is existential** — a public free assistant answering millions of queries with a generation each can be ruinously expensive, so the cheap-cache-first, small-context, cheaper-model levers are load-bearing, and gated on eval.

**What is genuinely new.**

**Abuse and adversarial input.** **Public users are not trusted employees** — they will attempt prompt injection, try to extract the system prompt, use the assistant as a free general-purpose model, and probe for ways to make it say something harmful about the product or off-topic. **None of this existed with trusted internal users.**

\`\`\`
New controls:
  · rate limiting per user / IP — abuse and cost
    control at once
  · input guardrails for off-topic and adversarial
    use (speed bumps, not boundaries)
  · output guardrails for brand-safety and for
    not answering outside the docs
  · scope enforcement: "answer only from the
    product docs, decline everything else" — and
    this is now a product-safety requirement, not
    just a quality one
\`\`\`

**Reputational output risk.** **An enterprise assistant giving a slightly-off answer is a support issue; a public one giving a wrong or embarrassing answer is a brand incident**, potentially screenshotted and shared. **So the faithfulness and refusal evals matter more, and there is a new class of eval: does it stay on-topic and on-brand under adversarial prompting.**

**And the feedback signal changes.** **Millions of anonymous users give almost no explicit feedback**, so online evaluation leans entirely on behavioural signals — rephrase rate, abandonment, follow-up questions — and on sampled faithfulness, since there is no support queue of known-resolved tickets to mine.

**What I\'d build differently.**

\`\`\`
Drop:    per-user permissions, access-change
         freshness, per-source-type sprawl
Keep:    situated chunking, hybrid retrieval,
         reranking, citation, retrieval/generation
         eval split
Add:     aggressive caching as a core component,
         rate limiting, input/output guardrails,
         on-topic/brand-safety evals, high-QPS
         index serving
Elevate: cost from a concern to a primary
         constraint
\`\`\`

**The transferable point: removing permissions did not make the design easy — it moved the weight from access control to scale, cost and abuse.** **Every system has a dominant non-functional requirement, and changing the context changes which one dominates**: internal, it was correctness of access; public, it is cost and abuse resistance. **The retrieval core — situate, hybrid-retrieve, rerank, cite, evaluate — is stable across both, which is the sign it was the right core; what wraps it is entirely determined by who the users are.**`,
    },
    {
      id: 'al-raga-2',
      kind: 'debug',
      prompt:
        'A deployed RAG assistant scores well on its retrieval eval (recall@10 of 93%) and its faithfulness eval (91%), but users complain that answers are frequently "technically correct but useless" and that it "misses the obvious answer." Both evals are green. Diagnose it.',
      discussion: `**Green retrieval and green faithfulness with unhappy users means the failure is in a stage neither eval covers — and there are several, which is the point of working through it.**

**Hypothesis 1 — the eval questions are not the real questions (distribution mismatch).**

**Recall@10 of 93% is measured on the eval set\'s questions**, which may be cleaner and more answerable than what users actually ask. **"Misses the obvious answer" often means users ask broad, ambiguous, or multi-part questions the eval set does not contain.**

\`\`\`
Eval: "What is the refund window?" → clean,
  one passage, retrieved, answered → 93%
Real: "I bought this last month and it broke,
  what are my options?" → needs synthesis across
  refund, warranty, and returns; the eval has
  nothing like it
\`\`\`

*Check:* **sample 50 real queries and run them through the eval process manually.** **If the real-query recall is far below 93%, the eval set drifted from reality** — and the fix is to rebuild it from production logs, not to tune retrieval.

**Hypothesis 2 — retrieval is good and assembly is bad.**

**Recall@10 says the answering passage is in the top 10. It does not say it is used well.** **If assembly puts it in the middle of a large context, or the context is cluttered with near-duplicates, the model answers from a weaker passage** — technically supported (so faithfulness passes) but not the best answer.

\`\`\`
The right passage is at rank 8, buried in the
middle of 10 chunks → the model leans on rank 1,
which is on-topic but less complete → "technically
correct but useless"
\`\`\`

*Check:* **inspect the assembled context for failing queries.** **Reranking to a small, ordered context — best passages first and last — is the fix**, and it is exactly the stage between retrieval and generation that neither eval measures.

**Hypothesis 3 — faithfulness passes and relevance fails.**

**Faithfulness asks "is every claim supported by the context." It does not ask "does the answer address what the user wanted."** **An answer can be perfectly grounded and answer a subtly different question** — the "technically correct but useless" signature exactly.

\`\`\`
User wants: how to fix the error
Answer: a grounded, faithful explanation of what
  the error MEANS
→ faithful, and useless
\`\`\`

*Check:* **add an answer-relevance eval** — does the answer address the question asked, not just a related one. **Its absence is why the two green evals miss this**: they cover "found it" and "didn\'t make it up" but not "answered the actual question."

**Hypothesis 4 — the "obvious answer" needs synthesis no chunk contains.**

**"Misses the obvious answer" can mean the answer is obvious to a human who knows the whole product but is not stated in any single chunk** — it requires combining several, or knowing what is typical. **RAG answers questions whose answer is written down; a question whose answer is "obviously, do X" because everyone knows it may have no passage.**

*Check:* **for a few "missed the obvious" complaints, look for whether any chunk actually states the answer.** **If not, this is a corpus gap, not a retrieval failure** — the docs don\'t say the obvious thing because the authors assumed it, and the fix is content, not the pipeline.

**Hypothesis 5 — the retrieved chunks are correct but too fragmentary.**

**If chunking produced small fragments, the top 10 might each be a sliver of the answer**, all on-topic, none complete — so recall counts them as hits, faithfulness passes on the assembled slivers, and the answer is thin. **The chunking lesson\'s dilution-versus-fragmentation trade, landing on the fragmentation side.**

*Check:* **read the retrieved chunks — are they whole, usable units or fragments?** **If fragments, the fix is at ingestion: larger, structurally-coherent chunks.**

**What I\'d check first.** **Read 20 failing answers alongside their retrieved contexts.** Not a metric — **the direct artefact.** It distinguishes hypotheses 2, 3, 4 and 5 in minutes: is the good passage there but buried (2), is the answer faithful-but-off-question (3), is there no answering passage at all (4), are the chunks fragments (5). **Then the 50 real-query sample for hypothesis 1.**

**The instrumentation gap this reveals.**

**The evals cover the two ends and miss the middle and the target.** **Recall@k covers "found it," faithfulness covers "didn\'t fabricate," and nothing covers "assembled it well" or "answered the actual question."** So I would add:

\`\`\`
· answer relevance — does it address the question
  (the biggest gap here)
· an assembly check — is the best passage
  actually used, or buried
· a real-query eval set, refreshed from logs, so
  the distribution matches
· behavioural online signals — rephrase rate is
  the direct measure of "useless answer," and it
  is free
\`\`\`

**The rephrase rate is the signal that would have caught this without any of the above:** **a user who rephrases got a useless answer, and that happens every time, unlike the complaints that only some users bother to file.** **Two green evals gave false confidence precisely because they measured what was easy to measure rather than what the user experienced** — which is the general trap of an evaluation that grades the stages you thought of and not the outcome the user cares about.`,
    },
  ],

  revision: {
    bullets: [
      'A RAG assistant is an information-retrieval system that ends in a model — four of five stages are data engineering.',
      'Clarify permissions, freshness and citation first; they change the architecture, the model does not.',
      'Permissions are a correctness property, pre-filtered into retrieval, not a post-hoc filter.',
      'Post-filtering starves restricted users and can leak a forbidden chunk into the answer.',
      'The user\'s access set is derived from the session in code, never client-supplied.',
      'Ingestion is per-source-type — a Slack thread, spreadsheet and wiki page need different handling.',
      'Situate each chunk with its document and source before embedding, or it is unfindable and uninterpretable.',
      'Capture permissions as per-chunk metadata at ingestion — the single most important field.',
      'Re-ingest on change, including access changes with no content change, sized to the freshness target.',
      'Retrieval is hybrid — vector for meaning, lexical for exact terms like codes and names.',
      'Rerank broad recall down to a small precise context — quality and cost at once.',
      'Order the assembled context for position; material in the middle is used less reliably.',
      'Every answer cites its sources — the citation is the trust mechanism.',
      '"Answer only from context" is a quality control, not a guarantee; the eval verifies faithfulness.',
      'Because retrieval filtered by access, the model cannot cite a forbidden document.',
      'Evaluation separates retrieval (recall@k) from generation (faithfulness) to localise failures.',
      'Per-query cost is dominated by generation over retrieved context — keep it small, cache repeats.',
      'The interview-ending failure is a permissions leak; design against it from the first line.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'An information-retrieval system ending in a language model: per-source-type ingestion that situates chunks and captures permissions, permissions-pre-filtered hybrid retrieval, a small reranked context, grounded cited generation, and an evaluation that separates retrieval from generation.',
    whyItExists:
      'Because answering questions over a private, changing, access-controlled corpus is a retrieval, permissions and freshness problem — and the model is only the last, easiest stage.',
    whenToUse: [
      'Framing the problem as retrieval-first, with the model last.',
      'Pre-filtering permissions in retrieval, bound from the session.',
      'Per-source-type ingestion with situating context.',
      'Change-driven re-ingestion sized to the freshness requirement.',
      'Hybrid retrieval and reranking to a small context.',
      'Citations on every claim and a retrieval/generation eval split.',
    ],
    whenNotToUse: [
      'Opening the design with the prompt or the model.',
      'Post-filtering as access control.',
      'Client-supplied access filters.',
      'One uniform chunking strategy across mixed sources.',
      'A one-time index for a changing corpus.',
      'Answers without citations for a knowledge tool.',
      'A cheaper model chosen without a faithfulness eval.',
    ],
    alternatives: [
      'Fine-tuning, when the knowledge is stable and small — but it cannot cite or stay fresh.',
      'A long-context model fed whole documents, when the corpus is tiny and access-uniform.',
      'Structured queries, for aggregations and exact lookups retrieval handles poorly.',
      'Separate indexes per coarse permission boundary, where walls are coarse enough.',
    ],
    tradeoffs: [
      'Pre-filtering buys correctness and costs retrieval complexity.',
      'Per-source ingestion buys quality and costs parsers to maintain.',
      'Event-driven freshness buys minutes-fresh answers and costs infrastructure.',
      'Hybrid retrieval buys exact-term coverage and costs a second retriever.',
      'Reranking buys precision and lower cost, and costs a stage and latency.',
      'Citations buy trust and cost per-claim source tracking.',
    ],
    failureModes: [
      'A forbidden document quoted in an answer via post-filtering.',
      'A restricted user starved of results.',
      'Client-supplied access allowing a user to widen their own scope.',
      'Context-free fragments from a source chunked the wrong way.',
      'A stale answer from an index not re-ingested on change.',
      'An access change ignored because only content changes trigger re-ingestion.',
      'An exact-term query missed by vector-only retrieval.',
      'A large context diluting the answer and losing the key passage in the middle.',
      'A confident answer with no citation, or a fabricated one.',
      'A wrong answer with no way to tell whether retrieval or generation failed.',
      'Cost blowing up from oversized contexts sent on every query.',
    ],
    followUpQuestions: [
      'Do different users see different documents, and how is that enforced?',
      'Where is the access set derived from, and could a client widen it?',
      'How fresh must an answer be, and what drives re-ingestion?',
      'What happens when a document\'s sharing changes but its content does not?',
      'How are different source types chunked?',
      'How does an exact-term query like an error code get retrieved?',
      'How large is the context sent to the model, and why?',
      'How does every answer get a citation?',
      'When an answer is wrong, how do you tell which stage failed?',
      'What dominates the per-query cost, and what are the levers?',
      'What is the one failure that would end the interview, and how is it prevented?',
    ],
  },
});
