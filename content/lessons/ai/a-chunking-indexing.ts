import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'a-chunking-indexing',
  title: 'Chunking and indexing strategy',
  summary:
    'Chunking looks like preprocessing and is actually the retrieval system\'s unit of truth. It sets what can be found, what survives being found, and what the model is able to say.',
  phase: 'ai',
  module: 'retrieval',
  position: 74,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['chunking', 'retrieval', 'context-assembly', 'indexing', 'metadata'],
  prerequisites: ['a-embeddings'],
  resources: [
    {
      key: 'anthropic-contextual-retrieval',
      tier: 'must',
      note: 'Read it for the argument that a chunk stripped of its document context retrieves badly, and for the fix. It is the clearest statement of why chunk boundaries destroy information that no amount of index tuning recovers.',
    },
    {
      key: 'lost-in-the-middle',
      tier: 'must',
      note: 'Read it for what happens after retrieval. It is the evidence that ordering inside the context window changes what the model uses, which makes assembly a design decision rather than concatenation.',
    },
    {
      key: 'raptor-paper',
      tier: 'good',
      note: 'Read it as the answer to questions no single chunk can support. Hierarchical summarisation is the structural response to "what does this whole document say", and seeing it makes the limits of flat chunking concrete.',
    },
    {
      key: 'openai-embeddings-guide',
      tier: 'good',
      note: 'Read it for the relationship between input length and the resulting vector. The dilution argument behind chunk sizing depends on it, and the guide is where the mechanics are stated plainly.',
    },
    {
      key: 'elastic-bm25',
      tier: 'good',
      note: 'Read the length-normalisation section. Chunk length changes lexical scoring as well as embedding quality, which is a second reason sizing is a retrieval decision rather than a formatting one.',
    },
    {
      key: 'dpr-paper',
      tier: 'advanced',
      note: 'Read it for what a passage is assumed to be in retrieval research. The assumption that a passage is self-contained is exactly what naive chunking violates, and naming that makes the failure predictable.',
    },
  ],

  intuition: {
    body: `**The chunk is the unit of retrieval, so it is also the unit of truth.** Nothing smaller can be found and nothing larger can be returned — **every downstream limit is set here**, before a vector is computed or an index is chosen.

**Which makes the first sentence worth stating plainly: chunking is not preprocessing.** It looks like a formatting step — split text, store pieces — **and it decides what questions the system can answer at all.**

**Three failures, all created at the split.**

\`\`\`
TOO SMALL   "It must be renewed within 30 days."
            → retrieved perfectly, and useless:
              what must be renewed?
              The pronoun's referent was in the
              previous chunk.

TOO LARGE   A 4,000-word chapter → one vector
            → the answer to one narrow question is
              averaged with forty other topics
              → diluted, and it loses to a chunk
                that is merely on-topic

SPLIT WRONG A table's header row in chunk 7,
            its data rows in chunk 8
            → both retrieved, neither interpretable
\`\`\`

**And the property that ties them together: retrieval finds chunks, but the model answers from what it can read.** A chunk that scores well and cannot be understood alone **is a retrieval success and a product failure** — which is why recall alone never tells you the chunking is right.

**Then the part people discover late: context is lost at the boundary and cannot be recovered by the index.**

\`\`\`
A chunk reading "revenue grew 14% year over year"
  · from which company's filing?
  · which year?
  · which segment?
→ all three were in the document title and section
  heading, which the splitter discarded
→ so the chunk is unfindable by a query naming the
  company, and unusable if found by luck
\`\`\`

**No embedding model, index parameter or reranker fixes that**, because the information is not in the index. **It has to be put back at write time.**

**And the last decision belongs after retrieval, not before it.** Ten chunks retrieved are not ten chunks delivered: **order matters, duplicates matter, and the budget is finite** — so assembly is part of the same design.`,
    analogyLimit:
      '"Split the documents into pieces that fit" treats a retrieval decision as a formatting one. It hides that the chunk is the smallest findable unit, so anything spanning a boundary becomes unfindable; that a chunk must be understandable alone, because the model reads it without the document around it; and that the context stripped at the split cannot be recovered by any index. It also stops before assembly, where ordering and deduplication decide what the model actually uses.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team ingests 200-page product manuals for a support assistant. They split every document into 512-token chunks at fixed boundaries, embed each, store them, retrieve the top 5 and concatenate them into the prompt. Quality is poor and they are told to try a better embedding model. Identify four problems that a better model would not fix.',
      answer: `**Problem 1 — fixed-size splitting cuts through structure, and the cut is permanent.**

\`\`\`
512 tokens counted blindly lands mid-table, mid-list,
mid-procedure:
  chunk 41 ends: "3. Disconnect the power supply and"
  chunk 42 starts: "wait 30 seconds before"
→ both chunks are retrievable
→ neither is a usable instruction
\`\`\`

**A better embedding model embeds the fragment more accurately**, which changes nothing: **the fragment is still a fragment.** The information was destroyed at write time.

*The fix:* **split on structure first, size second.** Headings, sections, list boundaries, table units — **then pack those units up to a size budget**, splitting further only when a single unit exceeds it.

**Problem 2 — chunks carry no document context, so they are both unfindable and uninterpretable.**

\`\`\`
A chunk from the middle of a manual:
  "Set the threshold to 40°C and confirm."
Missing: which product, which model number,
         which section, which procedure
\`\`\`

**Unfindable**, because a query naming the product has nothing to match. **Uninterpretable**, because the model reading it cannot tell which device it configures — **and a support assistant answering confidently about the wrong product is worse than one that finds nothing.**

*The fix:* **prepend a context header to every chunk before embedding** — document title, section path, and a short description of where this sits. **The embedding then encodes both the local content and its place**, and the model reads the same header when it answers.

**Problem 3 — top-5 concatenation ignores both ordering and redundancy.**

\`\`\`
200-page manuals updated quarterly:
  the same safety warning appears in four sections
  → top 5 becomes 4 near-identical warnings + 1 other
  → an effective context of 2 distinct facts
\`\`\`

**And ordering matters independently:** material in the middle of a long context is used less reliably than material at the edges, **so the ranking that retrieval produced is not the ordering the model should receive.**

*The fix:* **deduplicate near-identical chunks, then order deliberately** — strongest evidence at the start and end rather than in rank order down the middle.

**Problem 4 — a fixed k ignores that queries differ in how much they need.**

\`\`\`
"What is the maximum operating temperature?"
  → one chunk answers it; four more add noise
"How do I commission a new unit end to end?"
  → the procedure spans six sections; five chunks
    truncate it mid-way
\`\`\`

**A constant k is wrong in both directions at once**, and it is invisible because both cases return something.

*The fix:* **a similarity threshold with a cap**, or an expansion step that pulls neighbouring chunks when a retrieved chunk is part of a sequence.

**What the corrected pipeline looks like.**

\`\`\`
· split on structure, pack to a token budget
· overlap only where structure cannot guide the split
· prepend document + section context before embedding
· keep metadata (product, version, section, date) as
  filterable fields, not prose
· retrieve by threshold with a cap, expand sequences
· deduplicate, then order for position
\`\`\`

**The transferable point: every one of these failures is created at write time and cannot be repaired at read time.** **Model choice, index tuning and reranking all operate on what chunking already decided** — which is why "try a better embedding model" is the wrong first move.`,
    },
  body: `## Why the chunk is the unit of truth

**Retrieval returns chunks.** So the chunk sets three separate limits at once, **and they are easy to conflate:**

\`\`\`
FINDABILITY   nothing smaller than a chunk can be
              retrieved; an answer spanning two
              chunks is found only if both are
USABILITY     the model reads the chunk without the
              document around it, so it must stand alone
BUDGET        chunks are what fills the context window,
              so their size sets how many facts fit
\`\`\`

**A design can satisfy one and fail another.** Small chunks are findable and often unusable; large chunks are usable and dilute; **and the sizing argument is really a negotiation between those two**, with the budget as the constraint.

*Which yields the framing worth carrying:* **chunking is not "how do I split text", it is "what is the smallest thing that answers a question on its own".** That question has a different answer for a legal contract, a support manual and a chat log — **so a universal chunk size is a sign nobody asked it.**

## The dilution argument, precisely

**An embedding is a fixed-size vector regardless of input length.** So a chunk covering ten topics spends the same representational budget as one covering a single topic — **and the single topic is represented more sharply.**

\`\`\`
Query: "what is the warranty period?"

Chunk A (120 words, warranty only)
  → the vector is mostly "warranty"
  → strong match
Chunk B (1,200 words, warranty + shipping + returns
         + support hours + regional variations)
  → "warranty" is one-sixth of the signal
  → weaker match, despite containing the SAME answer
\`\`\`

**So a large chunk can lose to a smaller chunk that is merely on-topic** — a ranking inversion that is invisible from the outside because something plausible was returned.

**And the same length effect appears in lexical scoring**, where term frequency is normalised by document length: **a long chunk's terms are discounted.** Both retrievers penalise length, for different reasons, **which is why chunk size is a retrieval parameter rather than a formatting preference.**

*The counter-pressure:* **small chunks fragment answers.** A procedure split into eight chunks needs all eight retrieved, **and retrieving eight related chunks is much less likely than retrieving one that contains them.**

\`\`\`
Coherent answer in 1 chunk  → found if that chunk ranks
Split across 8 chunks       → found if enough of 8 rank
                              → and k is usually 5
\`\`\`

**That is the whole trade**, and it explains why the practical answer sits in a band rather than at an extreme: **large enough to be self-contained, small enough to be about one thing.**

## Split on structure, then pack

**Fixed-size splitting is the default and it is the wrong default**, because it uses a measure — token count — that has nothing to do with meaning.

\`\`\`
STRUCTURAL SPLITTING
1. Parse the document into units:
   headings, sections, paragraphs, list items,
   table rows with their header, code blocks
2. Pack units into chunks up to a token budget
3. Never split a unit unless it alone exceeds the
   budget
4. Record the section path on every chunk
\`\`\`

**Three things this gets right that fixed-size splitting cannot.**

**Chunks end where meaning ends**, so a procedure, a clause or a table stays whole — and the "3. Disconnect the power supply and" failure becomes impossible rather than unlikely.

**The section path comes free.** Structural parsing already knows that this paragraph sits under *Installation → Electrical → Safety*, **which is exactly the context the chunk needs.**

**And oversized units become visible.** A 4,000-word section that cannot be packed is a signal to split *within* it, **deliberately and by sub-structure**, rather than at an arbitrary offset.

*Where overlap belongs:* **overlap is a patch for splits that structure could not guide**, not a general policy. Fifty to a hundred tokens of overlap between adjacent chunks inside a long prose section reduces the chance of an answer straddling the boundary; **applying overlap everywhere just inflates the index and duplicates results.**

## Context is added at write time or not at all

**The most consequential fix in this lesson is also the cheapest.** Before embedding, **prepend a short header describing where the chunk comes from:**

\`\`\`
Document: ACME-5000 Installation Manual, rev 4.2
Section:  Installation → Electrical → Safety
---
Set the threshold to 40°C and confirm.
\`\`\`

**Two effects, and they are different.**

**Findability.** The embedding now encodes the product name and the section, **so a query naming either has something to match** — where previously the chunk was invisible to exactly the queries that most needed it.

**Interpretability.** The model reads the header too, **so it can say which product the answer applies to** rather than answering confidently about an unspecified device.

*A stronger variant:* **generate a one-sentence situating description per chunk at ingestion**, using a cheap model given the chunk and the surrounding document. It costs one inference per chunk at write time — **paid once, amortised over every query** — and it recovers context that no header template can express, such as what a pronoun refers to.

**The generalisable rule: information destroyed at write time cannot be recovered at read time.** **Ingestion is the cheap place to spend effort**, because it is paid once and every query benefits, **whereas read-time repair is paid per query and starts from less.**

## Metadata is structure, not prose

**Some of what a chunk needs is not text.**

\`\`\`
As FILTERABLE FIELDS:     product, version, effective
                          date, document type,
                          permission scope, language
As TEXT in the chunk:     the section path, the
                          situating description
\`\`\`

**The split matters because filters and embeddings answer different questions.** "Invoices after March", "the current policy version", "documents this user may see" — **these are exact predicates, and embeddings do not compare magnitudes or dates.**

*And the versioning case is the one that bites:* **a corpus containing four revisions of the same manual retrieves the obsolete one as readily as the current one**, because they are textually near-identical. **Only a metadata filter distinguishes them** — and a support assistant quoting a superseded procedure is a real failure with no retrieval symptom.

## What no flat chunking can do

**Some questions have no answering chunk**, and recognising the class is more useful than any tuning.

\`\`\`
"What are the main themes of this report?"
"How many incidents were there last quarter?"
"How does section 4 differ from section 9?"
\`\`\`

**The first needs the whole document**, the second **an aggregation**, the third **a comparison across chunks** — **and no single chunk contains any of them**, so retrieval returns whatever is topically nearest and the model answers from a fragment.

**Two structural responses.**

**Hierarchical summarisation**: build summary nodes above the chunks — section summaries, document summaries — **and index those too**, so a whole-document question retrieves a whole-document artefact.

**And routing**: recognise that the question is an aggregation or a comparison **and answer it with a query over structured data rather than with retrieval.** Counting incidents is a database question that was mistakenly handed to a search system.

*The honest framing:* **RAG answers questions whose answer is written down somewhere.** For anything requiring synthesis across the corpus, **the retrieval design has to provide the synthesis at write time or route around it.**

## Assembly: what happens after retrieval

**Ten retrieved chunks are not ten delivered chunks**, and three decisions sit between.

**Deduplicate.** Corpora repeat themselves — versions, boilerplate, warnings copied into several sections. **Near-identical chunks filling the top-k reduce the effective context to one or two distinct facts**, and recall measurement cannot see it because the retrieval was correct.

**Order for position, not for rank.** Material in the middle of a long context is used less reliably than material at the start or end, **so placing the strongest evidence first and second-strongest last beats a straight ranked list.**

**Expand sequences.** If a retrieved chunk is part of a numbered procedure, **its neighbours are probably needed too** — pulling adjacent chunks by document position is cheap and repairs the fragmentation that splitting caused.

*And choose k by the query, not by convention.* **A threshold with a cap adapts**: a narrow factual question takes one or two chunks above threshold, **a procedural question takes as many as clear the bar**, up to the budget.

## What to say in a design discussion

**That chunking is a retrieval decision**, and that the sizing band comes from dilution on one side and fragmentation on the other.

**That splitting follows structure and packs to a budget**, with overlap only where structure cannot guide it.

**That context is prepended before embedding**, because information lost at write time is unrecoverable at read time.

**That metadata is filterable fields**, especially version and permission, because embeddings cannot express exact predicates.

**That some questions have no answering chunk**, and need summary nodes or routing rather than better retrieval.

**And that assembly — deduplication, ordering, sequence expansion, adaptive k — is part of the design**, not a concatenation step.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'chunk-pipeline',
      title: 'Every decision made at write time, and what each one costs later',
      caption:
        'Step through it. The left half is paid once and sets the ceiling; the right half is paid per query and can only work with what the left half preserved.',
      nodes: [
        { id: 'doc', label: 'Source document', kind: 'client', x: 0, y: 160, detail: 'The truth. The index is derived from it, so a chunking change is a re-ingest — which makes chunking strategy expensive to revisit and worth getting deliberately rather than by default.' },
        { id: 'parse', label: 'Parse into structural units', kind: 'service', x: 220, y: 160, detail: 'Headings, sections, paragraphs, list items, tables with their headers. Using structure rather than token offsets is what stops a chunk ending mid-procedure, and it produces the section path for free.' },
        { id: 'pack', label: 'Pack units to a token budget', kind: 'service', x: 450, y: 160, detail: 'Large enough to be self-contained, small enough to be about one thing. Too large and the answer is diluted against forty other topics; too small and a procedure fragments across eight chunks when k is five.' },
        { id: 'context', label: 'Prepend document + section context', kind: 'service', x: 680, y: 160, detail: 'The cheapest high-impact step. It makes the chunk findable by queries naming the product or section, and interpretable by a model that reads it without the document around it. Information lost here cannot be recovered at read time.' },
        { id: 'meta', label: 'Metadata as filterable fields', kind: 'store', x: 680, y: 20, detail: 'Product, version, date, permission scope. Embeddings cannot express exact predicates, so the superseded revision of a manual retrieves as readily as the current one — a real failure with no retrieval symptom.' },
        { id: 'index', label: 'Embed and index', kind: 'store', x: 900, y: 160, detail: 'Everything from here operates on what chunking already decided. A better embedding model embeds a fragment more accurately and it is still a fragment.' },
        { id: 'retrieve', label: 'Retrieve: threshold with a cap', kind: 'service', x: 900, y: 300, detail: 'A fixed k is wrong in both directions at once — noise for a narrow factual question, truncation for a procedure spanning six sections. Both return something, which is why it goes unnoticed.' },
        { id: 'assemble', label: 'Deduplicate, expand, order', kind: 'service', x: 660, y: 300, detail: 'Near-identical chunks collapse the effective context to one or two facts, and recall cannot see it because retrieval was correct. Then order for position rather than rank, and pull neighbours when a chunk is part of a sequence.' },
        { id: 'gap', label: 'Questions no chunk answers', kind: 'note', x: 430, y: 300, detail: '"What are the themes of this report", "how many incidents last quarter", "how does section 4 differ from section 9". Whole-document, aggregation and comparison questions need summary nodes or routing to structured data — not better retrieval.' },
      ],
      edges: [
        { id: 'c1', source: 'doc', target: 'parse', kind: 'sync' },
        { id: 'c2', source: 'parse', target: 'pack', kind: 'sync' },
        { id: 'c3', source: 'pack', target: 'context', kind: 'sync' },
        { id: 'c4', source: 'context', target: 'meta', kind: 'write' },
        { id: 'c5', source: 'context', target: 'index', kind: 'write' },
        { id: 'c6', source: 'index', target: 'retrieve', kind: 'read' },
        { id: 'c7', source: 'retrieve', target: 'assemble', kind: 'sync' },
        { id: 'c8', source: 'assemble', target: 'gap', kind: 'control' },
      ],
      steps: [
        {
          id: 'cs1',
          title: 'Structure before size',
          description:
            'Parse into units that mean something, then pack them to a budget. Splitting by token count uses a measure with no relationship to meaning, and the cut is permanent.',
          nodes: ['doc', 'parse', 'pack'],
          edges: ['c1', 'c2'],
        },
        {
          id: 'cs2',
          title: 'Put the context back before embedding',
          description:
            'A chunk reading "set the threshold to 40°C" names no product and no section. The header makes it both findable and interpretable, and costs almost nothing.',
          nodes: ['context'],
          edges: ['c3'],
        },
        {
          id: 'cs3',
          title: 'And keep the exact predicates as fields',
          description:
            'Version, date, permission. Four revisions of one manual are textually near-identical, so only a filter tells the current one from the superseded one.',
          nodes: ['meta', 'index'],
          edges: ['c4', 'c5'],
        },
        {
          id: 'cs4',
          title: 'Retrieve adaptively, then assemble deliberately',
          description:
            'A threshold with a cap rather than a constant k. Then deduplicate, expand sequences, and order for position rather than rank.',
          nodes: ['retrieve', 'assemble'],
          edges: ['c6', 'c7'],
        },
        {
          id: 'cs5',
          title: 'And know which questions this cannot answer',
          description:
            'Whole-document, aggregation and comparison questions have no answering chunk. They need summary nodes built at write time, or routing to structured data.',
          nodes: ['gap'],
          edges: ['c8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'size-trade',
      title: 'The sizing band, and what pushes from each side',
      caption:
        'Read it as two opposing failures rather than a search for one number. The right size is whatever makes a chunk self-contained for this corpus — which differs between a contract, a manual and a chat log.',
      code: `flowchart TB
    Q["**How large should a chunk be?**"]

    Q --> S["**Smaller**"]
    Q --> L["**Larger**"]

    S --> S1["+ sharper embedding:<br/>the vector is mostly<br/>about one thing"]
    S --> S2["+ less dilution against<br/>BM25 length normalisation"]
    S --> S3["− answers fragment:<br/>a procedure across 8 chunks<br/>needs 8 retrieved, **and k is 5**"]
    S --> S4["− pronouns and references<br/>lose their referent<br/>'It must be renewed<br/>within 30 days' — what must?"]

    L --> L1["+ self-contained:<br/>the model can read it<br/>without the document"]
    L --> L2["+ fewer boundary<br/>casualties"]
    L --> L3["− dilution: warranty is<br/>one-sixth of the signal,<br/>**so it loses to a smaller<br/>chunk that is merely on-topic**"]
    L --> L4["− context budget:<br/>fewer distinct facts fit"]

    S3 --> B["**The band, not the number**<br/>Large enough to stand alone,<br/>small enough to be about<br/>one thing — and the answer<br/>differs per corpus.<br/><br/>**Structure decides where;<br/>the budget decides how many.**"]
    L3 --> B

    style B fill:#1c1814,stroke:#c99a4e
    style S3 fill:#2a1a1a,stroke:#8c4a4a
    style L3 fill:#2a1a1a,stroke:#8c4a4a`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The contextual-retrieval write-up is the most useful reference here because it isolates one variable and measures it.

**The observation.** A chunk extracted from a document loses the context that made it meaningful — **the company, the period, the section, the subject of a pronoun** — and that loss shows up as retrieval failure, not as a formatting problem.

**The intervention.** Before embedding, **prepend a short generated description situating the chunk in its document.** Not a template, but a sentence produced by a cheap model given the chunk and enough surrounding document to know what it is about.

**And the result is a substantial reduction in retrieval failures**, achieved without touching the embedding model, the index or the reranker — **which is the part worth internalising.** The team's instinct in that situation is usually to tune the read path; **the fix was at write time.**

**Three transferable lessons.**

**Write-time work is amortised.** One inference per chunk at ingestion is paid once and benefits every query afterwards — **an excellent trade against anything paid per query**, and a general principle beyond retrieval.

**The cheapest fix is often not where the symptom appears.** Poor answers look like a generation or ranking problem, **and here they were an ingestion problem** — so "what did we throw away at write time" belongs early in the diagnostic list.

**And it composes with lexical retrieval rather than replacing it.** The write-up pairs contextual embeddings with contextual BM25, **because the added context helps exact matching too** — the same header that makes a chunk findable by vector makes it findable by term.

**Where this does not help.** It adds context; **it does not make a fragment whole.** A chunk that ends mid-procedure gains a useful header and remains mid-procedure — **that failure has to be prevented by structural splitting**, and no amount of situating description substitutes for not cutting there.`,
  },

  tradeoffs: {
    intro:
      'The decisions chunking involves, most of which trade findability against usability.',
    rows: [
      {
        option: 'Fixed-size splitting at token boundaries',
        whenItWins:
          'Homogeneous unstructured text where no structure exists to follow.',
        whenItLoses:
          'Any document with procedures, tables or sections — it cuts through meaning using a measure unrelated to it.',
        cost:
          'Fragments that retrieve well and cannot be used.',
      },
      {
        option: 'Structural splitting, packed to a budget',
        whenItWins:
          'Almost always — chunks end where meaning ends and the section path comes free.',
        whenItLoses:
          'Requires a parser per document type, and formats that parse poorly degrade it.',
        cost:
          'Ingestion complexity, paid once.',
      },
      {
        option: 'Smaller chunks',
        whenItWins:
          'Fact lookup, FAQs, anything where an answer is one or two sentences.',
        whenItLoses:
          'Procedures and arguments fragment across more chunks than k retrieves.',
        cost:
          'Lost referents and answers split across boundaries.',
      },
      {
        option: 'Larger chunks',
        whenItWins:
          'Narrative and procedural content that must be read as a whole.',
        whenItLoses:
          'Dilution — the answer is one-sixth of the signal and loses to a smaller on-topic chunk.',
        cost:
          'Weaker ranking and fewer distinct facts in the budget.',
      },
      {
        option: 'Overlap between chunks',
        whenItWins:
          'Long prose sections where structure gives no split point.',
        whenItLoses:
          'Applied everywhere, it inflates the index and returns duplicates.',
        cost:
          'Index size and redundancy in the top-k.',
      },
      {
        option: 'Templated context header',
        whenItWins:
          'Structured documents where title and section path carry most of the context.',
        whenItLoses:
          'Cannot express what a pronoun refers to or what a table column means.',
        cost:
          'Nearly nothing — this is the default, not an upgrade.',
      },
      {
        option: 'Generated situating description per chunk',
        whenItWins:
          'When chunks are meaningless alone and the corpus is large enough to matter.',
        whenItLoses:
          'One inference per chunk at ingestion, and a re-run whenever chunking changes.',
        cost:
          'Ingestion cost and time, amortised across every query.',
      },
      {
        option: 'Metadata as filterable fields',
        whenItWins:
          'Version, date, permission, product — every exact predicate.',
        whenItLoses:
          'Requires extraction at ingestion and a schema to maintain.',
        cost:
          'Ingestion work, for predicates embeddings cannot express.',
      },
      {
        option: 'Metadata written into the chunk text',
        whenItWins:
          'Section paths and titles, which genuinely help the embedding.',
        whenItLoses:
          'Dates and versions — the model cannot compare them and neither can the index.',
        cost:
          'A filter that silently does not filter.',
      },
      {
        option: 'Fixed k',
        whenItWins:
          'Uniform query types and a predictable budget.',
        whenItLoses:
          'Wrong in both directions at once — noise for narrow questions, truncation for broad ones.',
        cost:
          'Quality loss that is invisible because something is always returned.',
      },
      {
        option: 'Threshold with a cap',
        whenItWins:
          'Mixed query types, which is most real systems.',
        whenItLoses:
          'The threshold must be calibrated per corpus and drifts.',
        cost:
          'A tuning parameter that needs measurement.',
      },
      {
        option: 'Hierarchical summary nodes',
        whenItWins:
          'Whole-document and thematic questions no leaf chunk can answer.',
        whenItLoses:
          'Summaries must be regenerated when documents change, and they can be wrong.',
        cost:
          'A second index and a staleness problem.',
      },
      {
        option: 'Re-chunking an existing corpus',
        whenItWins:
          'When the strategy is demonstrably wrong, measured against an eval set.',
        whenItLoses:
          'It is a full re-ingest and re-embed, like a model change.',
        cost:
          'A migration, which is why the initial choice deserves thought.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We split documents into 512-token chunks with 50 tokens of overlap."',
      whyWeak:
        'It answers "how" without answering "what should a chunk be". Fixed-size splitting cuts through procedures, tables and clauses using a measure unrelated to meaning, and overlap applied uniformly is a patch for a problem structure would have prevented.',
      strongAnswer:
        '"I split on structure and pack to a size budget: headings, sections, list items, tables with their headers — never splitting a unit unless it alone exceeds the budget. That makes chunks end where meaning ends, and it gives me the section path for free. Overlap goes only where structure offers no split point, inside long prose sections, because applied everywhere it just inflates the index and fills the top-k with duplicates. The size band itself comes from two opposing failures: dilution if chunks are too large, fragmented answers if they are too small."',
    },
    {
      weakAnswer: '"The answers are poor, so we are trying a better embedding model."',
      whyWeak:
        'It assumes the failure is in the read path. If chunks are fragments, or stripped of the document context that made them meaningful, a better model embeds a fragment more accurately and nothing improves.',
      strongAnswer:
        '"First I would ask what was thrown away at write time, because information lost at ingestion cannot be recovered at retrieval. I would look at whether chunks are self-contained, whether they carry document and section context, and whether the failing queries even have an answering chunk. Write-time work is paid once and benefits every query, so it is both the likelier cause and the cheaper fix. The model is the last thing I would change, because swapping it is a full re-embed."',
    },
    {
      weakAnswer: '"Each chunk is just the text — the metadata is in a separate table."',
      whyWeak:
        'The chunk that gets embedded and read is then context-free. A chunk saying "set the threshold to 40°C" names no product and no section, so it is invisible to a query naming the product and dangerous if found by accident.',
      strongAnswer:
        '"I prepend a context header before embedding — document title and section path at minimum, and for corpora where chunks are meaningless alone, a generated one-sentence description situating the chunk. That does two different jobs: it makes the chunk findable by queries naming the product, and it lets the model say which product the answer applies to. Separately, exact predicates like version, date and permission stay as filterable fields, because an embedding cannot compare dates or enforce access."',
    },
    {
      weakAnswer: '"We retrieve the top 5 chunks and put them in the prompt."',
      whyWeak:
        'A constant k is wrong in both directions simultaneously, and concatenation ignores redundancy and ordering. A corpus with repeated boilerplate can fill all five slots with near-identical text, reducing the effective context to one fact while recall measurement reports success.',
      strongAnswer:
        '"I would use a similarity threshold with a cap rather than a constant k, so a narrow factual question takes one chunk and a procedural question takes as many as clear the bar. Then assembly is its own step: deduplicate near-identical chunks, expand sequences by pulling neighbours when a retrieved chunk is part of a numbered procedure, and order for position rather than rank — strongest evidence first and last, because material in the middle of a long context is used less reliably."',
    },
    {
      weakAnswer: '"RAG can answer any question about the documents."',
      whyWeak:
        'Whole-document, aggregation and comparison questions have no answering chunk. Retrieval returns whatever is topically nearest and the model answers confidently from a fragment, which is the failure mode with the least visible symptom.',
      strongAnswer:
        '"RAG answers questions whose answer is written down somewhere. Three classes are not: what a whole document says, aggregations like counting incidents last quarter, and comparisons across sections. The first needs hierarchical summary nodes built at ingestion and indexed alongside the leaves. The second is a database question that was handed to a search system by mistake, and should be routed. The third needs either a summary node or multiple targeted retrievals. Recognising the class is more useful than tuning, because no amount of tuning produces a chunk that does not exist."',
    },
    {
      weakAnswer: '"We can change the chunking strategy later if it is not working."',
      whyWeak:
        'Re-chunking is a full re-ingest and re-embed of the corpus, on the same order as an embedding-model migration. It is not a configuration change, and the cost scales with the corpus.',
      strongAnswer:
        '"Re-chunking is a migration, so the initial choice deserves thought and an eval set deserves to exist before ingestion rather than after. I would establish a small set of representative questions with known-relevant documents, try two or three chunking strategies on a sample of the corpus, and measure retrieval quality against that set before committing. That is a day of work that decides a decision costing a re-ingest to reverse."',
    },
  ],

  flashcards: [
    {
      id: 'fc-chk-1',
      front: 'Why is the chunk the unit of truth?',
      back: 'Nothing smaller can be retrieved and nothing larger can be returned, so chunking sets findability, usability and budget at once.',
      topic: 'chunking',
    },
    {
      id: 'fc-chk-2',
      front: 'What is the dilution argument against large chunks?',
      back: 'The vector is fixed-size regardless of length, so a chunk covering ten topics represents each one-tenth as sharply — and can lose to a smaller chunk that is merely on-topic.',
      topic: 'chunking',
    },
    {
      id: 'fc-chk-3',
      front: 'What is the argument against small chunks?',
      back: 'Answers fragment. A procedure split across eight chunks needs eight retrieved, and k is usually five.',
      topic: 'chunking',
    },
    {
      id: 'fc-chk-4',
      front: 'Why split on structure rather than token count?',
      back: 'Token count has no relationship to meaning, so it cuts through procedures and tables. Structure ends chunks where meaning ends and yields the section path free.',
      topic: 'chunking',
    },
    {
      id: 'fc-chk-5',
      front: 'Where does overlap actually belong?',
      back: 'Only where structure offers no split point — inside long prose sections. Applied everywhere it inflates the index and duplicates results.',
      topic: 'chunking',
    },
    {
      id: 'fc-chk-6',
      front: 'What two jobs does a prepended context header do?',
      back: 'Findability — the embedding encodes the product and section. Interpretability — the model reading the chunk knows what it applies to.',
      topic: 'retrieval',
    },
    {
      id: 'fc-chk-7',
      front: 'Why is write-time work a good trade?',
      back: 'It is paid once and benefits every query, whereas read-time repair is paid per query and starts from less information.',
      topic: 'indexing',
    },
    {
      id: 'fc-chk-8',
      front: 'What belongs in metadata rather than chunk text?',
      back: 'Exact predicates: version, date, permission, product. Embeddings cannot compare magnitudes or enforce access.',
      topic: 'metadata',
    },
    {
      id: 'fc-chk-9',
      front: 'Why does document versioning break naive RAG?',
      back: 'Four revisions of one manual are textually near-identical, so the superseded one retrieves as readily as the current one — with no retrieval symptom.',
      topic: 'metadata',
    },
    {
      id: 'fc-chk-10',
      front: 'Name three question classes no flat chunking can answer.',
      back: 'Whole-document ("what are the themes"), aggregation ("how many last quarter"), and comparison ("how does section 4 differ from 9").',
      topic: 'retrieval',
    },
    {
      id: 'fc-chk-11',
      front: 'What are the two structural responses to those questions?',
      back: 'Hierarchical summary nodes indexed alongside the leaves, and routing aggregations to structured data instead of retrieval.',
      topic: 'indexing',
    },
    {
      id: 'fc-chk-12',
      front: 'Why is a fixed k wrong?',
      back: 'It is wrong in both directions at once — noise for a narrow question, truncation for a procedure — and both return something, so nobody notices.',
      topic: 'context-assembly',
    },
    {
      id: 'fc-chk-13',
      front: 'What are the three assembly steps after retrieval?',
      back: 'Deduplicate near-identical chunks, expand sequences by pulling neighbours, and order for position rather than rank.',
      topic: 'context-assembly',
    },
    {
      id: 'fc-chk-14',
      front: 'Why is re-chunking expensive?',
      back: 'It is a full re-ingest and re-embed of the corpus, on the same order as an embedding-model migration — not a config change.',
      topic: 'indexing',
    },
  ],

  quiz: [
    {
      id: 'q-chk-1',
      kind: 'scenario',
      prompt:
        'A chunk reads "Set the threshold to 40°C and confirm." It is retrieved for a query about the ACME-5000. What is wrong?',
      options: [
        { id: 'a', label: 'It carries no document or section context, so it is both hard to find by a query naming the product and unusable if found — the model cannot tell which device it configures' },
        { id: 'b', label: 'It is too short for the embedding model' },
        { id: 'c', label: 'It should have been split further' },
        { id: 'd', label: 'The similarity threshold is too low' },
      ],
      correct: ['a'],
      explanation:
        'The context was in the document title and section heading, and the splitter discarded it. Neither a lower threshold nor a better model recovers information that is not in the index — the fix is a prepended header at write time.',
      difficulty: 'core',
      topic: 'retrieval',
    },
    {
      id: 'q-chk-2',
      kind: 'scenario',
      prompt:
        'A 1,200-word chunk contains the warranty answer alongside shipping, returns and support hours. A 120-word chunk elsewhere merely mentions warranty. Which ranks higher for "what is the warranty period?"',
      options: [
        { id: 'a', label: 'Often the 120-word chunk — the larger chunk\'s warranty signal is diluted across six topics in a fixed-size vector' },
        { id: 'b', label: 'The 1,200-word chunk, because it contains the answer' },
        { id: 'c', label: 'They rank equally, since both mention warranty' },
        { id: 'd', label: 'Neither — the query is too short' },
      ],
      correct: ['a'],
      explanation:
        'This is the dilution argument and the ranking inversion it causes. The chunk containing the answer loses to one that is merely on-topic, and nothing in the output indicates it — lexical scoring penalises length too, for a different reason.',
      difficulty: 'core',
      topic: 'chunking',
    },
    {
      id: 'q-chk-3',
      kind: 'scenario',
      prompt:
        'A support corpus holds four revisions of the same manual. A user asks about a procedure that changed in the latest revision. What happens, and what fixes it?',
      options: [
        { id: 'a', label: 'The superseded revision can be retrieved as readily as the current one, because they are textually near-identical — only a version filter distinguishes them' },
        { id: 'b', label: 'The newest chunk always wins, since it was indexed most recently' },
        { id: 'c', label: 'Reranking resolves it' },
        { id: 'd', label: 'Larger chunks would resolve it' },
      ],
      correct: ['a'],
      explanation:
        'Embeddings encode text, and the four revisions differ in a sentence or two. Recency of indexing has no bearing on similarity, and a reranker is working from the same text — the distinction is an exact predicate and belongs in a filterable field.',
      difficulty: 'core',
      topic: 'metadata',
    },
    {
      id: 'q-chk-4',
      kind: 'scenario',
      prompt:
        'Which question will flat chunking fail on regardless of chunk size or retrieval tuning?',
      options: [
        { id: 'a', label: '"How many incidents were there last quarter?"' },
        { id: 'b', label: '"What is the maximum operating temperature of the ACME-5000?"' },
        { id: 'c', label: '"How do I replace the filter?"' },
        { id: 'd', label: '"What does the warranty cover?"' },
      ],
      correct: ['a'],
      explanation:
        'Aggregation has no answering chunk — no passage states the count, so retrieval returns whatever is topically nearest and the model answers from a fragment. It is a database question handed to a search system, and it should be routed rather than tuned.',
      difficulty: 'core',
      topic: 'retrieval',
    },
    {
      id: 'q-chk-5',
      kind: 'scenario',
      prompt:
        'Retrieval recall measures at 98%, and answers are still poor. Five near-identical safety warnings fill the top 5. Why does recall not see this?',
      options: [
        { id: 'a', label: 'Recall measures whether the true nearest neighbours were found, and they were — redundancy is a property of the corpus, not a retrieval error' },
        { id: 'b', label: 'Recall was measured incorrectly' },
        { id: 'c', label: 'The embedding model is wrong' },
        { id: 'd', label: 'The index needs rebuilding' },
      ],
      correct: ['a'],
      explanation:
        'The retrieval was correct and the effective context is one distinct fact. This is why deduplication is an assembly step with its own metric — retrieved-set diversity — rather than something recall covers.',
      difficulty: 'advanced',
      topic: 'context-assembly',
    },
    {
      id: 'q-chk-6',
      kind: 'multi',
      prompt:
        'Which of these are genuinely fixed at write time and unrecoverable at read time? Select all that apply.',
      options: [
        { id: 'a', label: 'Whether a chunk is self-contained' },
        { id: 'b', label: 'Whether document context is encoded in the vector' },
        { id: 'c', label: 'Whether version metadata exists as a filterable field' },
        { id: 'd', label: 'How many chunks are placed in the prompt' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are properties of what was written to the index and require a re-ingest to change. The number of chunks placed in the prompt is a read-time decision and can be changed per query, which is why it should adapt rather than being fixed.',
      difficulty: 'advanced',
      topic: 'indexing',
    },
  ],

  exercises: [
    {
      id: 'ex-chk-1',
      kind: 'design',
      title: 'Design the ingestion pipeline for a mixed corpus',
      estimatedMinutes: 40,
      prompt: `An insurance company wants an internal assistant over four document types:

- **Policy wordings** — 40–120 page structured documents with numbered clauses, revised annually, ~2,000 documents across 12 product lines.
- **Claims correspondence** — email threads, 2–40 messages each, unstructured, ~500,000 threads.
- **Regulatory bulletins** — 2–10 page PDFs with effective dates, ~3,000 documents.
- **Internal procedure wikis** — Markdown with headings, frequently edited, ~8,000 pages.

Questions the assistant must answer include: "Does policy X cover flood damage to outbuildings?", "What did we tell the claimant about the excess on claim 4471?", "Which bulletins affect motor policies issued after April?", and "What is our current escalation procedure for a disputed total loss?"

**Part 1.** Design the chunking strategy per document type and justify each difference.

**Part 2.** Specify the metadata schema and say which fields are filters and which are chunk text.

**Part 3.** Identify which of the four questions flat chunking cannot answer, and design around them.

**Part 4.** The policy wordings are revised annually and old versions must remain queryable for historical claims. Design for that.

Then answer:

- What would you measure before ingesting all of it?
- What breaks if a document type is added later?`,
      rubric: [
        'A different chunking strategy per document type, each justified by the document\'s structure.',
        'Recognises that clause-numbered documents have natural units.',
        'Handles email threads as a distinct problem from documents.',
        'Metadata schema separates exact predicates from chunk text.',
        'Identifies the question that flat chunking cannot answer, with reasoning.',
        'Versioning design keeps history queryable without polluting current answers.',
        'Proposes an evaluation before full ingestion.',
        'States what breaks when a new document type arrives.',
      ],
      modelAnswer: `**Part 1 — chunking per document type**

**The four types differ in structure, in how they are queried and in how they change**, so a uniform strategy would be wrong for at least three of them.

---

**Policy wordings — clause as the unit.**

\`\`\`
Structure: numbered clauses, nested (4.2, 4.2.1, 4.2.1(a))
Queries:   "does policy X cover Y" → a specific clause
Unit:      the clause, packed with its parents' headings
\`\`\`

\`\`\`
Chunk = Section heading path
      + the clause text
      + sub-clauses if they fit in the budget
Split further only if one clause exceeds the budget
\`\`\`

**Two decisions worth defending.**

**The clause is the unit because that is what the answer is.** "Does this cover flood damage to outbuildings" is answered by a clause, **and a clause is written to be self-contained** — legal drafting already did the work that chunking usually has to guess at.

**And the heading path must be included**, because clauses are full of references that only make sense in place: **"subject to the limits in 3.1"** and **"this exclusion does not apply where 4.4 is endorsed"**. The path plus the clause number lets the model cite precisely, **which matters enormously here** — an insurance answer without a clause reference is not usable.

*One refinement:* **exclusions and exceptions must never be separated from what they modify.** A chunk containing a grant of cover without its adjacent exclusion **produces a confidently wrong answer**, which in this domain is the worst possible failure. **So the packing rule is: a clause travels with its exceptions**, even when that exceeds the nominal budget.

---

**Claims correspondence — the thread, or a window within it.**

\`\`\`
Structure: chronological messages, heavy quoting,
           signatures, disclaimers
Queries:   "what did we tell the claimant about X"
           → a specific statement, in context
Unit:      a message, plus a rolling summary of the
           thread so far
\`\`\`

**This is the hardest of the four**, and the reasons are specific:

**Quoted text duplicates everything.** A 20-message thread contains the first message 20 times, **so naive chunking produces massive redundancy** and the top-k fills with copies. **Strip quoted history at ingestion** — keep each message's new content only.

**A message alone lacks the case.** "We can offer £400 as a goodwill payment" names no claim, no claimant and no reason. **So the header carries claim number, parties, date and a rolling one-line summary of the thread to that point.**

**And the thread is chronological, so ordering is semantic.** What was said last supersedes what was said earlier, **which means retrieved messages must be presented in time order with their dates visible** — not in relevance order.

\`\`\`
Chunk = Claim 4471 | Adjuster → Claimant | 2026-03-14
        Thread so far: excess disputed, £250 vs £500
        ---
        [new content of this message only]
\`\`\`

*And for long threads, a thread-level summary chunk too*, because "what happened on claim 4471" is a whole-thread question — **which is the Part 3 problem appearing early.**

---

**Regulatory bulletins — the document, or its sections.**

\`\`\`
Structure: short, dense, with an effective date and
           an explicit scope
Queries:   "which bulletins affect motor policies
            issued after April" → a FILTER, not a search
Unit:      section, or the whole bulletin if short
\`\`\`

**These are short enough that a two-to-ten page bulletin is a handful of chunks**, and the real work here is not chunking — **it is extraction.** Effective date, affected product lines, supersession: **all of it must come out as fields**, because the queries are predicates.

---

**Procedure wikis — heading section as the unit.**

\`\`\`
Structure: Markdown headings, naturally hierarchical
Queries:   "what is our current escalation procedure"
           → a procedure, which must be complete
Unit:      the H2/H3 section, never split mid-procedure
\`\`\`

**Markdown gives the structure for free**, so this is the straightforward case. **The one rule that matters: a numbered procedure is atomic.** Splitting steps 1–4 from steps 5–8 **produces an answer that stops halfway and looks complete**, which is worse than no answer.

*And because wikis are frequently edited*, the ingestion must be incremental — **re-chunk the changed page, not the corpus** — and old chunks for that page must be removed, **or edits accumulate as contradictory duplicates.**

---

**Part 2 — metadata schema**

\`\`\`
FILTERABLE FIELDS (exact predicates)
  doc_type          policy | correspondence | bulletin | wiki
  product_line      motor | home | commercial | ...
  policy_version    e.g. "2026-01" — see Part 4
  effective_from    date
  effective_to      date | null   (null = current)
  claim_id          for correspondence
  message_date      for correspondence
  superseded_by     document id | null
  permission_scope  team / role identifiers
  source_id         document id, for sequence expansion
  position          ordinal within the document

CHUNK TEXT (helps the embedding and the reader)
  document title
  section / clause path
  for correspondence: parties, claim id, rolling summary
  the content itself
\`\`\`

**The rule dividing them: can an embedding express it?** **"Issued after April" and "the current version" are comparisons**, and embeddings do not compare — **so anything with an ordering or an exact identity is a field.** Anything that helps the vector be about the right thing is text.

**Two fields deserve particular note.**

**\`permission_scope\` is correctness-critical.** Claims correspondence contains personal data, **so this is not a relevance filter, it is an access control** — it belongs in the query construction, never in caller-supplied parameters, and it is a pre-filter rather than a post-filter regardless of selectivity.

**And \`source_id\` plus \`position\` exist to enable sequence expansion.** When a retrieved chunk is step 3 of a procedure, **the neighbours are fetched by document position** — which requires the ordinal to have been stored at ingestion.

---

**Part 3 — which questions flat chunking cannot answer**

\`\`\`
Q1 "Does policy X cover flood damage to outbuildings?"
   → a clause answers it. FINE.
Q2 "What did we tell the claimant about the excess
    on claim 4471?"
   → a message answers it, IF the claim filter works.
     Fine with metadata.
Q3 "Which bulletins affect motor policies issued
    after April?"
   → NOT a retrieval question at all. It is a filter
     over structured fields: doc_type = bulletin,
     product_line = motor, effective_from > April.
Q4 "What is our current escalation procedure for a
    disputed total loss?"
   → a wiki section answers it, IF "current" is
     enforced — otherwise a superseded page competes.
\`\`\`

**So Q3 is the one flat chunking cannot answer**, and the design response is **routing rather than retrieval**: recognise the query as a structured filter and run it as one, returning the matching bulletins directly. **Attempting it with similarity search returns bulletins that are topically about motor insurance regardless of date** — plausible, and wrong.

**And Q4 is the subtler one.** It looks like a straightforward retrieval and it depends entirely on a metadata filter working. **"Current" is not a property of the text.**

**A fourth class the brief implies: "summarise claim 4471".** Whole-thread questions need **thread-level summary chunks built at ingestion**, because no message contains the summary. **I would build these for threads over a handful of messages** and index them with \`doc_type = correspondence_summary\`, **so retrieval can find either the summary or a specific message.**

---

**Part 4 — annual revisions with queryable history**

**The requirement has two halves that pull against each other:** current queries must never see old wordings, **and historical claims must be answerable against the wording in force at the time.**

\`\`\`
Model every policy wording as a VERSIONED document:
  policy_id       "HOME-STANDARD"
  policy_version  "2026-01"
  effective_from  2026-01-01
  effective_to    null        (null = current)
\`\`\`

**Then two query modes**, and the default matters:

\`\`\`
DEFAULT (current):
  filter effective_to IS NULL
  → the overwhelming majority of queries
  → and the default must be this, because the
    failure of getting it wrong is silent

AS-AT (historical):
  filter effective_from <= :date
     AND (effective_to IS NULL OR effective_to > :date)
  → for a claim, :date is the date of loss
\`\`\`

**Three decisions worth defending.**

**The default is "current", not "all".** An assistant that quietly blends five years of wordings **gives a plausible answer from a superseded clause** with no symptom. **Making the safe case the default means a mistake produces "no results" rather than a wrong answer** — which is the right direction for the failure to fall.

**The as-at date comes from the claim, not the user.** For a claims question, **the wording in force is determined by the date of loss**, which is a fact the system knows. **Asking the user to select a version invites the wrong selection**, so the system should derive it and state which version it used.

**And the answer must always name its version.** "Clause 4.2 of HOME-STANDARD 2026-01 says…" — **because in this domain an answer without a citation cannot be relied on**, and the version is half the citation.

*The storage question:* **most clauses do not change between revisions**, so re-ingesting every wording annually duplicates perhaps 90% of the corpus. **I would accept that** — 2,000 documents is small, the duplication is a few million chunks at most, **and deduplicating identical clauses across versions adds a mapping layer whose complexity exceeds the storage it saves.** If the corpus were a hundred times larger, **content-hashing unchanged clauses and storing version ranges against a single chunk would be worth the complexity.**

---

**What I would measure before ingesting all of it**

\`\`\`
1. Build an eval set FIRST — 60-100 real questions,
   each with the clause, message or page that answers
   it, collected from the people who currently answer
   these questions by hand
2. Ingest a SAMPLE: 50 policies, 2,000 threads,
   200 bulletins, 500 wiki pages
3. Measure, per document type:
     · is the known-correct chunk in the top k?
     · is the retrieved chunk self-contained?
       (read 30 of them — this is manual and it is
        the most informative half hour available)
     · does the answer cite the right clause/version?
4. Try 2-3 chunking variants on the SAME eval set
\`\`\`

**Per-document-type measurement is the important part**, because the types will not fail equally: **policies will do well and correspondence will do badly**, and an aggregate number hides that.

**And the manual read of 30 retrieved chunks catches what no metric does** — a chunk that scores well and cannot be understood alone. **That is the failure this lesson is about**, and it is only visible by looking.

*Why before rather than after:* **re-chunking 500,000 threads is a re-ingest and re-embed.** A day spent on a sample decides a choice that costs weeks to reverse.

---

**What breaks when a document type is added later**

**Not much, if the pipeline is built as a registry of per-type handlers**, and quite a lot if it is built as one function with conditionals.

\`\`\`
Per type, the pipeline needs:
  a parser          → structural units
  a packing rule    → what is atomic
  a header template → what context to prepend
  a metadata extractor → which fields, from where
\`\`\`

**So the extension point is a handler interface**, and adding a type is implementing it — **not editing a shared splitter.** That is the one abstraction worth building here, **because a fifth type is certain** and the four existing ones already differ enough to prove the interface.

**What genuinely does break:**

**The metadata schema.** A new type may need fields the current schema lacks — **and adding a filterable field usually means re-ingesting everything, because the field must be populated on existing chunks too.** Mitigation: **keep a flexible attribute map alongside the fixed columns** for type-specific fields, accepting that filtering on it is less efficient.

**And the eval set.** It covers four types; **a fifth arrives unmeasured**, so the quality of its ingestion is unknown until someone complains. **Adding a type should require adding eval questions for it** — a process rule rather than a technical one, and the one most likely to be skipped.

*What does not break:* the index, the embedding model, the retrieval logic and the assembly step. **They are type-agnostic by construction** — **which is the payoff of putting all the type-specific work at ingestion**, where this lesson says it belongs.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-chk-1',
      level: 'basic',
      question: 'How would you chunk these documents?',
      guidance:
        'Look for structure before size, and for the question "what is the smallest thing that answers a question on its own" rather than a number.',
    },
    {
      id: 'iq-chk-2',
      level: 'basic',
      question: 'Why not just use larger chunks so nothing gets cut?',
      guidance:
        'Dilution — the vector is fixed-size, so the answer competes with every other topic in the chunk, and the context budget holds fewer distinct facts.',
    },
    {
      id: 'iq-chk-3',
      level: 'intermediate',
      question: 'The answers are poor. Where do you look first?',
      guidance:
        'Write time before read time. Strong answers ask whether chunks are self-contained and carry context, because information lost at ingestion is unrecoverable.',
    },
    {
      id: 'iq-chk-4',
      level: 'intermediate',
      question: 'The corpus contains four revisions of each document. What happens?',
      guidance:
        'Near-identical text means the superseded revision retrieves as readily as the current one. Look for a version filter and for "current" being the default.',
    },
    {
      id: 'iq-chk-5',
      level: 'advanced',
      question: 'Which questions can this system not answer, and why?',
      guidance:
        'Whole-document, aggregation and comparison. Excellent answers route aggregations to structured data rather than attempting them with retrieval.',
    },
    {
      id: 'iq-chk-6',
      level: 'advanced',
      question: 'Recall is 98% and the answers are still bad. What is happening?',
      guidance:
        'Redundancy filling the top-k, or chunks that are correct and not self-contained. Both are invisible to recall, which is why diversity and a manual read matter.',
    },
    {
      id: 'iq-chk-7',
      level: 'followup',
      question: 'How do you decide the chunking strategy before you have a working system?',
      guidance:
        'Build the eval set first, ingest a sample, try two or three variants against it. Re-chunking later is a full re-ingest.',
    },
    {
      id: 'iq-chk-8',
      level: 'followup',
      question: 'What do you do with the retrieved chunks before they reach the model?',
      guidance:
        'Deduplicate, expand sequences by document position, order for position rather than rank, and choose k by threshold rather than convention.',
    },
  ],

  activeLearning: [
    {
      id: 'al-chk-1',
      kind: 'what-changes-if',
      prompt:
        'Change the corpus: instead of documents, it is a codebase — 400,000 lines across 3,000 files, and the assistant answers developer questions. What transfers from this lesson, and what is genuinely different?',
      discussion: `**The framing transfers completely and almost every specific answer changes**, which makes this a good test of whether the lesson was about chunking or about documents.

**What transfers unchanged.**

**The chunk is still the unit of truth**, and the question is still "what is the smallest thing that answers a question on its own". **For code that has an unusually clean answer: the function, the class, the module** — code has better structure than prose ever does.

**Structure before size**, and here structure is a parse tree rather than headings. **Splitting at a token offset mid-function is exactly the "3. Disconnect the power supply and" failure**, and a parser makes it impossible rather than unlikely.

**Context prepended at write time.** A function body alone lacks the file path, the imports, the class it belongs to and the module's purpose — **all of which a developer's question names.** The header writes itself:

\`\`\`
File:   src/billing/invoice.ts
Module: invoice generation and PDF rendering
Class:  InvoiceBuilder
Imports: Money, TaxRate, PdfRenderer
---
[the function]
\`\`\`

**And metadata as filters**: language, path, whether it is a test, last-modified, package. **"Show me the tests for X" is a filter, not a search.**

**What is genuinely different, and it is the interesting part: code has explicit references, and prose does not.**

\`\`\`
Prose:  "as described above" — the reference is
        implicit and resolvable only by a human
Code:   import { Money } from '../money'
        → the reference is EXACT and machine-resolvable
\`\`\`

**Which means the retrieval graph can be built rather than guessed.** A chunk for \`InvoiceBuilder.total()\` **can carry, as structured edges, what it calls, what calls it, what types it uses and where those are defined** — so retrieval is "find this function, then expand along the call graph", **not "hope the related code is semantically similar".**

**And that is a strictly better mechanism than similarity.** The callers of a function are *known*; **finding them by embedding is a worse method for a question with an exact answer** — the same argument as routing aggregations to a database, applied to structure.

**A second real difference: the queries are often not about similarity at all.**

\`\`\`
"Where is the retry logic?"          → semantic, RAG-shaped
"Who calls processRefund?"           → the call graph
"What changed in this file last week?" → version control
"Why is this written this way?"      → commit messages, PRs
                                       — a DIFFERENT CORPUS
\`\`\`

**So the corpus is larger than the code.** Commit messages, pull-request discussions and issue threads **contain the intent that the code does not state**, and "why" questions are unanswerable from source alone. **That is the aggregation-routing lesson generalised**: recognise the question class and go to the right store.

**And a third: code is far more repetitive than prose.**

\`\`\`
300 files containing:
  export async function handler(req, res) {
    try { ... } catch (e) { logger.error(e) ... }
\`\`\`

**Near-duplicate chunks are the norm rather than an edge case**, so **deduplication moves from an assembly nicety to a central concern** — and similarity search over boilerplate returns 10 chunks that differ in one identifier.

**What is harder than in the document case.**

**Chunk boundaries are clean but the useful unit varies by question.** "How does billing work" needs a module; **"why does this line throw" needs a function and its callers** — so a single granularity is wrong, **and indexing at two levels (function and file/module) is the practical answer.**

**Freshness is much tighter.** A document corpus tolerates a day of staleness; **a codebase assistant answering from last week's code is actively misleading**, because the developer is looking at the current file. **So ingestion is per-commit and incremental**, with deletion of chunks for changed regions — **which makes the "remove old chunks on edit" point from the wiki case mandatory rather than good practice.**

**What I would build.**

\`\`\`
Keep:    structure-first splitting, context headers,
         metadata filters, dedup, sequence expansion
Change:  the parser is a language parser; the unit is
         function/class; two granularities indexed
Add:     a call/import graph as structured edges,
         traversed instead of guessed
         commit and PR corpus for "why" questions
         per-commit incremental ingestion
Route:   "who calls X", "what changed", "why" — none of
         these are similarity questions
\`\`\`

**The transferable point: the more structure a corpus has, the less work similarity search should be doing.** **Prose chunking is an approximation forced by the absence of explicit references**, and where those references exist — **imports, call graphs, clause cross-references in the insurance case** — **following them beats embedding them.** The lesson's method survives; its defaults do not.`,
    },
    {
      id: 'al-chk-2',
      kind: 'debug',
      prompt:
        'A RAG assistant over a support knowledge base answers well for most questions but consistently fails on multi-step procedures — it gives the first two or three steps and stops, or gives steps from two different procedures merged together. Retrieval recall measures 96%. Diagnose it.',
      discussion: `**Two distinct symptoms — truncation and merging — and they are probably the same root cause seen from two angles.** The 96% recall is the clue that the problem is not in the index.

**Hypothesis 1 — procedures are split across chunks and only some are retrieved.**

**This is the direct explanation of truncation.** An eight-step procedure split into three chunks needs all three; **retrieval ranks them by similarity to the query, and the first chunk matches best** because it contains the procedure's title and opening context.

\`\`\`
Chunk A: "Commissioning a new unit" + steps 1-3
         → strong match: contains the title
Chunk B: steps 4-6
         → weaker: no title, just imperatives
Chunk C: steps 7-8 + troubleshooting
         → weaker still
→ top-k returns A, and two unrelated chunks
→ the model answers with steps 1-3 and stops
\`\`\`

**And the model has no way to know it is incomplete**, because chunk A looks like a complete answer — **it does not say "continued overleaf".**

*Check:* take a failing query, retrieve, and look at whether the later chunks of that procedure are in the corpus and where they ranked. **This is my leading hypothesis** and it is directly observable.

**Hypothesis 2 — the merging symptom is the same cause plus similar procedures.**

**Steps 4-6 of one procedure look textually like steps 4-6 of another.** Stripped of their title, imperative steps are generic: **"Disconnect the power supply", "Verify the indicator is green"** appear in many procedures.

\`\`\`
Query about procedure X
→ chunk with X's title + steps 1-3   (correct)
→ chunk with Y's steps 4-6           (similar text,
                                      no title,
                                      indistinguishable)
→ the model concatenates them into one procedure
\`\`\`

**So the two symptoms are one bug**: **mid-procedure chunks lack the context that identifies which procedure they belong to.** Truncation when the continuation is not retrieved, merging when the wrong continuation is.

*Check:* inspect the retrieved chunks for a merging failure and see whether they come from the same \`source_id\`. **If they do not, this is confirmed.**

**Hypothesis 3 — a fixed k truncates even when everything is found.**

**If k is 5 and a procedure is 3 chunks**, retrieval must place all three in the top 5 against every competing chunk in the corpus. **Even at high recall, ranking pushes some out.**

*Check:* compare k against the chunk count of the failing procedures. **This compounds hypothesis 1 rather than replacing it.**

**Hypothesis 4 — the chunks are fine and the context ordering loses the middle.**

**If all steps are retrieved but placed in the middle of a long context**, the model may use them less reliably — **producing an answer that skips steps rather than stopping.**

*Distinguishing symptom:* **hypothesis 1 truncates at the end; this one drops from the middle.** "Gives the first two or three steps and stops" **points at hypothesis 1**, so this is secondary — worth checking only after.

**Why 96% recall is consistent with all of this.**

**Recall asks whether the true nearest neighbours were returned**, and they were. **The true nearest neighbour to a question about a procedure IS the chunk with the procedure's title** — retrieval did its job. **The failure is that the correct answer is not one chunk**, which is a chunking property that recall is structurally unable to see.

*This is the general shape worth remembering:* **recall measures the index against itself.** It cannot tell you the unit was wrong.

**What I would check first.** **Take ten failing queries and read the retrieved chunks.** Not a metric — **the direct observation.** It will show within minutes whether procedures are fragmented, whether mid-procedure chunks carry titles, and whether merged answers come from different documents.

**Then: the chunk-count distribution for procedural content.** If procedures average four chunks and k is five, **the arithmetic alone predicts the failure.**

**The fixes, in order of leverage.**

**Make procedures atomic at ingestion.** A numbered procedure is one chunk even if it exceeds the nominal budget, **because a procedure split in half is worse than a procedure that is slightly too large.** This is the root-cause fix and it requires a re-ingest.

**Where a procedure genuinely cannot fit, put the title and step range in every chunk.**

\`\`\`
Procedure: Commissioning a new ACME-5000 (steps 4-6 of 8)
---
4. Disconnect the power supply...
\`\`\`

**This fixes merging directly** — the chunks are now distinguishable — **and it makes truncation visible to the model**, which can say "this covers steps 4 to 6".

**And expand sequences at retrieval.** When a retrieved chunk has \`source_id\` and \`position\`, **fetch its neighbours by position rather than hoping they rank.** This repairs fragmentation at read time without a re-ingest, **so it is the fix to ship first while the re-ingest is prepared.**

**The instrumentation this demands.**

**Answer completeness on a procedural eval set** — a set of procedural questions with known full answers, scored on whether all steps appear. **The metric the system lacks**, and the only one that would have caught this.

**Retrieved-set coherence**: how many distinct \`source_id\` values appear in a retrieved set. **A procedural query returning chunks from four documents is a merging risk**, and it is cheap to log.

**And chunk-count-per-logical-unit at ingestion**, alerting when a procedure fragments beyond a threshold. **Catching it at write time is far better than inferring it from bad answers.**

**Transferable:** **when recall is high and answers are wrong, the unit is wrong.** Retrieval metrics evaluate the index against the chunking; **nothing in them evaluates the chunking against the questions** — so an eval set scored on answers, not on retrieval, is the only instrument that sees this class of failure.`,
    },
  ],

  revision: {
    bullets: [
      'The chunk is the unit of retrieval, so it sets findability, usability and budget at once.',
      'Chunking is a retrieval decision, not preprocessing — and re-chunking is a full re-ingest.',
      'Ask "what is the smallest thing that answers a question on its own", not "what size".',
      'Too large dilutes: a fixed-size vector spreads across every topic in the chunk.',
      'So a large chunk containing the answer can lose to a small chunk that is merely on-topic.',
      'Too small fragments: a procedure across eight chunks needs eight retrieved, and k is five.',
      'Split on structure, pack to a budget, and never split a unit unless it alone exceeds it.',
      'Overlap belongs only where structure gives no split point.',
      'Prepend document and section context before embedding — it fixes findability and interpretability.',
      'A generated situating sentence per chunk costs one inference at write time and helps every query.',
      'Information destroyed at write time cannot be recovered at read time.',
      'Exact predicates — version, date, permission — are filterable fields, because embeddings cannot compare.',
      'Four revisions of one document are textually near-identical, so only a filter finds the current one.',
      'Whole-document, aggregation and comparison questions have no answering chunk.',
      'Answer those with hierarchical summary nodes, or route them to structured data.',
      'A fixed k is wrong in both directions at once; use a threshold with a cap.',
      'Assembly is a design step: deduplicate, expand sequences by position, order for position not rank.',
      'When recall is high and answers are wrong, the unit is wrong — recall cannot see that.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The decision about what a retrievable unit is: structural splitting packed to a budget, with document context prepended before embedding, exact predicates kept as filterable fields, and an assembly step that deduplicates, expands and orders what comes back.',
    whyItExists:
      'Because retrieval returns chunks and the model answers from what it can read, so the split decides both what can be found and what is usable once found — and nothing downstream can recover what the split destroyed.',
    whenToUse: [
      'Structural splitting whenever the documents have structure, which is almost always.',
      'A context header on every chunk, as the default rather than an optimisation.',
      'Generated situating descriptions when chunks are meaningless alone.',
      'Metadata filters for every exact predicate, especially version and permission.',
      'Summary nodes when whole-document questions matter.',
      'Sequence expansion whenever content is ordered.',
    ],
    whenNotToUse: [
      'Fixed-size splitting on structured documents.',
      'Uniform overlap as a general policy.',
      'Dates and versions written into chunk text and expected to filter.',
      'A constant k across mixed query types.',
      'Straight concatenation of the ranked list into the prompt.',
      'Retrieval for aggregations and counts.',
      'Tuning the read path before checking what was lost at write time.',
    ],
    alternatives: [
      'Hierarchical summarisation for questions no leaf chunk answers.',
      'Routing to structured queries for aggregations, dates and counts.',
      'Graph traversal over explicit references where the corpus has them.',
      'Larger context windows, which reduce but do not remove the selection problem.',
      'A reranker, which reorders what chunking already made available.',
    ],
    tradeoffs: [
      'Smaller chunks buy sharper matching and cost coherence.',
      'Larger chunks buy self-containment and cost ranking.',
      'Overlap buys boundary insurance and costs index size and duplicates.',
      'Generated context buys retrieval quality and costs an inference per chunk.',
      'Summary nodes buy whole-document answers and cost a staleness problem.',
      'Structural parsing buys correct boundaries and costs a handler per document type.',
    ],
    failureModes: [
      'A chunk ending mid-procedure that retrieves well and cannot be used.',
      'A pronoun whose referent was in the previous chunk.',
      'A table header separated from its rows.',
      'The answer diluted across a large chunk and outranked by a smaller on-topic one.',
      'A chunk with no document context, invisible to the queries that need it.',
      'A superseded document version answering as readily as the current one.',
      'Near-identical chunks filling the top-k and collapsing the effective context.',
      'A procedure truncated because only its first chunk ranked.',
      'Steps from two procedures merged because mid-procedure chunks are indistinguishable.',
      'An aggregation question answered from a topically nearest fragment.',
      'High recall alongside poor answers, because the unit rather than the index is wrong.',
    ],
    followUpQuestions: [
      'What is a chunk here, and why that unit?',
      'Can a chunk be understood without the document around it?',
      'What context is prepended before embedding?',
      'Which fields are filterable, and which are chunk text?',
      'How does a query get the current version rather than a superseded one?',
      'Which questions have no answering chunk?',
      'How is k chosen, and does it vary by query?',
      'What happens between retrieval and the prompt?',
      'How would you know if chunking were wrong?',
      'What does re-chunking cost?',
      'How does a new document type get added?',
    ],
  },
});
