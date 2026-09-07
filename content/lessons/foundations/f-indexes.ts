import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-indexes',
  title: 'Indexes and query performance',
  summary:
    'A B-tree index is a sorted structure, and almost every rule about indexes — column order, which predicates help, why a covering index wins — follows from that one fact.',
  phase: 'foundations',
  module: 'databases',
  position: 14,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['indexes', 'query-performance', 'btree', 'selectivity', 'databases'],
  prerequisites: ['f-relational-modeling'],
  resources: [
    {
      key: 'postgres-indexes',
      tier: 'must',
      note: 'Read chapter 11 in order. The sections on multicolumn indexes and index-only scans are the two that change how you write queries rather than just how you read plans.',
    },
    {
      key: 'postgres-explain',
      tier: 'must',
      note: 'Learn to read a plan before you learn to tune one. Focus on distinguishing estimated from actual row counts — a large gap is the single most useful diagnostic signal available.',
    },
    {
      key: 'postgres-index-types',
      tier: 'good',
      note: 'What B-tree cannot do, and which structure covers each gap: GIN for containment, GiST for ranges and geometry, BRIN for naturally ordered bulk data.',
    },
    {
      key: 'dynamodb-partition-key-design',
      tier: 'good',
      note: 'The same access-pattern-first reasoning in a store with no query planner at all. Useful for seeing which parts of this lesson are about B-trees and which are about data distribution.',
    },
    {
      key: 'postgres-vacuum',
      tier: 'advanced',
      note: 'Why index bloat happens under MVCC and what maintains it. Relevant once an index that used to be fast has quietly stopped being.',
    },
  ],

  intuition: {
    body: `An index is a sorted copy of some columns, with a pointer back to the row. That is the whole mechanism, and nearly every practical rule follows from it.

Because it is sorted, three things become cheap:

- **Finding one value.** Binary search rather than reading every row.
- **Finding a range.** Seek to the start, then read forward while the condition holds.
- **Getting rows already in order.** Read the index in order; no sort step.

And one thing stays expensive: **finding rows by a column the index is not sorted by.** A phone book sorted by surname cannot help you find everyone at a given address. Not slowly — not at all. You read the whole thing.

That is the mental model to keep, and it explains the rule people most often get wrong. In a composite index on \`(a, b, c)\` the data is sorted by \`a\`, then within equal \`a\` by \`b\`, then within equal \`b\` by \`c\`. So:

- A query filtering on \`a\` uses it.
- A query filtering on \`a\` and \`b\` uses it.
- A query filtering on **\`b\` alone cannot use it** — the \`b\` values are scattered throughout, sorted only within each \`a\` group.

Column order is not a preference. It is the sort order, and it decides which queries the index can serve.

The cost side matters just as much and gets discussed far less: **every index is a second structure that every write must update.** An insert into a table with six indexes is seven writes. Indexes are not free lookups you sprinkle on; they are a read/write trade you make deliberately, one query at a time.`,
    analogyLimit:
      'The phone book is right about sortedness and wrong about cost. A phone book is printed once and read forever, whereas an index is maintained on every insert, update and delete — and under MVCC a deleted row leaves dead index entries until vacuum reclaims them. The maintenance, not the lookup, is what makes "just add an index" a decision rather than a freebie.',
  },

  deepExplanation: {
    predict: {
      question:
        'A table has an index on `(status, created_at)`. Which of these four queries can use it, and how much of it? (1) `WHERE status = \'open\'`, (2) `WHERE status = \'open\' ORDER BY created_at`, (3) `WHERE created_at > now() - interval \'1 day\'`, (4) `WHERE status IN (\'open\',\'held\') AND created_at > $1`.',
      answer: `**1. \`WHERE status = 'open'\`** — uses the index, first column only. Seeks to the \`open\` group and reads it. Fully usable, though if 80% of rows are \`open\` the planner may prefer a sequential scan anyway.

**2. \`WHERE status = 'open' ORDER BY created_at\`** — the best case. Seeks to the \`open\` group, and within it rows are already ordered by \`created_at\`. **No sort step at all**, and with a \`LIMIT\` the database stops as soon as it has enough rows. This is the shape you should design for.

**3. \`WHERE created_at > now() - interval '1 day'\`** — **cannot use the index for the filter.** The recent \`created_at\` values are scattered across every \`status\` group. Some databases will perform a full index scan if the index is much smaller than the table, but there is no seek — the work is proportional to the whole index rather than to the matching rows. Practically: this query needs its own index.

**4. \`WHERE status IN ('open','held') AND created_at > $1\`** — uses it well. \`IN\` becomes two seeks, one per status value, each reading forward through \`created_at\`. Two efficient range scans merged.

**The rule this demonstrates:** a composite index is usable **left to right, with equality on all columns before the last one you range over.** You may range on the final used column. You cannot skip a leading column.

Which yields the practical ordering rule: **equality columns first, then the column you range or sort on.** An index on \`(created_at, status)\` would serve query 3 and serve query 2 badly — same columns, different sort order, different set of usable queries.`,
    },
  body: `## Reading a plan before tuning one

Two signals matter more than everything else in a query plan.

**Scan type.** A sequential scan reads every row. An index scan seeks and reads matching entries, then fetches each row. An index-only scan answers entirely from the index without touching the table — the fastest case, available only when every column the query needs is in the index.

**Estimated versus actual rows.** This is the most useful diagnostic in the whole tool. If the planner expected 12 rows and got 40,000, it chose a plan for a query it misunderstood — nested loops instead of a hash join, an index scan where a sequential scan was right. A large gap means stale statistics, a correlation the planner cannot model, or a predicate it cannot estimate. **Fix the estimate before changing the index**, because a good index with a bad estimate still produces a bad plan.

A sequential scan is not a failure. For a table of 500 rows, or a query matching 60% of a large one, reading everything sequentially beats random access per matching row. The planner knows this; arguing with it usually means its statistics are wrong.

## Selectivity decides whether an index is worth using

Selectivity is the fraction of rows a predicate matches. An index on a column where 50% of rows share a value is nearly useless: the database would do a random fetch for every second row, which is slower than reading the table in order.

The practical consequences:

- **A boolean column is usually a poor index** on its own — two values, so roughly half the table each.
- **Unless the distribution is skewed.** If 0.1% of rows have \`is_flagged = true\`, an index on it is excellent for finding those, and a **partial index** — \`WHERE is_flagged\` — is better still, because it only contains the interesting rows and is therefore tiny.
- **Low-cardinality columns are still valuable as the leading column of a composite index**, because they narrow the range that the second column then orders. \`(status, created_at)\` is a good index even though \`status\` has five values.

## Column order, derived rather than memorised

From the sort-order model, the ordering rule falls out:

1. **Equality predicates first.** Every column you filter with \`=\` (or \`IN\`).
2. **Then the range or sort column.** The one you compare with \`>\`, \`<\`, \`BETWEEN\`, or order by.
3. **Then columns needed only for output**, if you want an index-only scan.

\`\`\`sql
-- Query
SELECT id, total FROM orders
WHERE customer_id = $1 AND status = 'open'
ORDER BY created_at DESC
LIMIT 20;

-- Index
CREATE INDEX ON orders (customer_id, status, created_at DESC) INCLUDE (total);
\`\`\`

Two equality columns, then the sort column in the matching direction, then the output column included so the table need not be touched at all. That query becomes: seek once, read twenty entries, stop.

**Sort direction matters for composite sorts.** An index on \`(a ASC, b ASC)\` serves \`ORDER BY a, b\` and also \`ORDER BY a DESC, b DESC\` — reading backwards. It does **not** cheaply serve \`ORDER BY a ASC, b DESC\`, which needs mixed directions and therefore a matching index.

## Covering indexes and index-only scans

An index scan does two things: find the entries, then fetch each row from the table for the columns the index lacks. That second step is random access — one page fetch per matching row — and it frequently dominates.

If every column the query needs is in the index, the fetch disappears. That is an **index-only scan**, and it is often the difference between 40 ms and 2 ms.

Two ways to get there:

- Add the column to the index key: \`(customer_id, status, created_at, total)\`.
- Include it as a non-key payload: \`INCLUDE (total)\`. The column is stored in the leaf pages but not used for ordering, so the index stays smaller and the ordering semantics stay clear.

Prefer \`INCLUDE\` for columns you only need to return. The trade is size: a covering index carries more data, so it is larger, uses more cache, and costs more to maintain.

## What every index costs

**Write amplification.** Every insert writes the row plus one entry per index. Every update writes new index entries for every index whose columns changed — and under MVCC an update often writes new entries in *all* indexes, because the row's physical location moves.

**Space.** Frequently 20-40% of the table size per index, sometimes more for wide covering indexes.

**Cache pressure.** Indexes compete with table data for memory. A rarely-used index still occupies pages that a hot index wanted.

**Planning time.** More indexes means more plans to consider on every query.

**Bloat.** Under MVCC, deleted and updated rows leave dead entries behind until vacuum reclaims them. An index on a heavily updated column degrades over time and needs maintenance.

The practical rule: **an unused index is pure cost.** Databases track index usage; check it. Dropping indexes nothing reads is one of the highest-value, lowest-risk changes available on a mature system.

## When B-tree is the wrong structure

B-trees handle equality, ranges and ordering on scalar values. For anything else you need a different structure, and knowing the gap is enough:

- **Containment and membership** — does this JSON document contain this key, does this array include this element, does this text match these words. Needs an inverted index (GIN in Postgres).
- **Ranges and geometry** — overlapping time ranges, spatial containment, nearest-neighbour. Needs GiST or a spatial index.
- **Very large naturally-ordered tables** — append-only time-series where physical order matches logical order. BRIN stores a summary per block range and is a fraction of the size, at the cost of only being useful when the correlation holds.
- **Similarity and vector search** — approximate nearest neighbour over embeddings. A different structure entirely, covered in the AI phase.

## The rule that prevents most mistakes

**Index for the queries you run, not for the columns you have.** Start from the slow query, read its plan, find the missing sort order, add the one index that turns it into a seek. Then check whether an existing index now covers it and drop the redundant one.

The inverse — adding an index per column "just in case" — produces a table where every write pays for lookups nobody performs.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'composite-order',
      title: 'Why column order is the sort order',
      caption:
        'Read the leaf entries in order. `status` values group together and `created_at` is sorted only within each group — which is exactly why a query filtering on `created_at` alone has nothing to seek to.',
      code: `flowchart TB
    subgraph IDX["Index on (status, created_at) — leaf entries in sorted order"]
      direction LR
      E1["held<br/>2026-01-04"] --> E2["held<br/>2026-03-11"] --> E3["open<br/>2026-02-02"] --> E4["open<br/>2026-02-09"] --> E5["open<br/>2026-03-14"] --> E6["paid<br/>2026-01-20"] --> E7["paid<br/>2026-03-02"]
    end

    Q1["WHERE status = 'open'"] --> R1["Seek to the 'open' group,<br/>read forward. ✓"]
    Q2["WHERE status = 'open'<br/>ORDER BY created_at"] --> R2["Seek, read in order,<br/>no sort step. ✓ best case"]
    Q3["WHERE created_at > '2026-03-01'"] --> R3["Matching dates sit in three<br/>separate groups. Nothing to<br/>seek to. ✗"]
    Q4["WHERE status IN ('open','held')<br/>AND created_at > $1"] --> R4["Two seeks, two range reads,<br/>merged. ✓"]

    style R1 fill:#17272a,stroke:#35897e
    style R2 fill:#17272a,stroke:#35897e
    style R4 fill:#17272a,stroke:#35897e
    style R3 fill:#2a1d1d,stroke:#b8383b`,
    },
    {
      kind: 'flow',
      id: 'index-decision',
      title: 'From a slow query to one index',
      caption:
        'Step through it in order. Notice that two of the four steps happen before any index is created — a good index chosen from a bad row estimate still produces a bad plan.',
      nodes: [
        { id: 'slow', label: 'A slow query', kind: 'client', x: 0, y: 130, detail: 'Start from a specific query with a measured cost, never from a column you feel deserves an index.' },
        { id: 'plan', label: 'Read the plan', kind: 'service', x: 180, y: 130, detail: 'Two signals: the scan type, and estimated versus actual rows. Everything else is detail until those two are understood.' },
        { id: 'stats', label: 'Estimate wrong?', kind: 'note', x: 380, y: 20, detail: 'A large gap between estimated and actual rows means the planner solved a different problem. Refresh statistics, raise the sampling target, or restate the predicate before touching indexes.' },
        { id: 'order', label: 'Derive the column order', kind: 'service', x: 380, y: 160, detail: 'Equality columns first, then the range or sort column in the matching direction, then output-only columns via INCLUDE. This is the sort order the query needs.' },
        { id: 'covering', label: 'Make it covering?', kind: 'note', x: 380, y: 300, detail: 'If the table fetch dominates, INCLUDE the returned columns for an index-only scan. Costs index size and cache; often the difference between 40 ms and 2 ms.' },
        { id: 'create', label: 'Create one index', kind: 'store', x: 610, y: 160, detail: 'One index for this query shape. Then re-read the plan to confirm it is used and the estimate improved — an index the planner declines to use is pure write cost.' },
        { id: 'prune', label: 'Drop the redundant', kind: 'service', x: 610, y: 320, detail: 'A new (a, b, c) index makes a bare (a) index redundant. Check usage statistics and drop what nothing reads: every index is paid for on every write.' },
      ],
      edges: [
        { id: 'x1', source: 'slow', target: 'plan', kind: 'sync' },
        { id: 'x2', source: 'plan', target: 'stats', label: 'first', kind: 'control' },
        { id: 'x3', source: 'plan', target: 'order', kind: 'control' },
        { id: 'x4', source: 'order', target: 'covering', kind: 'control' },
        { id: 'x5', source: 'order', target: 'create', kind: 'write' },
        { id: 'x6', source: 'covering', target: 'create', kind: 'write' },
        { id: 'x7', source: 'create', target: 'prune', kind: 'control' },
      ],
      steps: [
        {
          id: 'i1',
          title: 'Start from a query, and read the plan',
          description:
            'Scan type tells you what the database is doing; estimated versus actual rows tells you whether it understood the question. Both come before any decision about indexes.',
          nodes: ['slow', 'plan'],
          edges: ['x1'],
        },
        {
          id: 'i2',
          title: 'Fix the estimate before the index',
          description:
            'If the planner expected twelve rows and got forty thousand, it chose a plan for a different query. Stale statistics and unmodelled correlations produce bad plans regardless of how good your indexes are.',
          nodes: ['plan', 'stats'],
          edges: ['x2'],
        },
        {
          id: 'i3',
          title: 'Derive the column order from the query',
          description:
            'Equality columns first, then the range or sort column in the matching direction. This is not a heuristic — it is the sort order the query needs in order to seek once and read forward.',
          nodes: ['plan', 'order', 'covering'],
          edges: ['x3', 'x4'],
        },
        {
          id: 'i4',
          title: 'Create one index, then prune',
          description:
            'Confirm the planner uses it and the estimate improved. Then check usage statistics and drop what is now redundant — a bare (a) index is subsumed by (a, b, c), and every surviving index is paid for on every write.',
          nodes: ['create', 'prune'],
          edges: ['x5', 'x6', 'x7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The most common index-related production incident is not a missing index. It is an index that was always missing and did not matter until the table grew, and the shape of that incident is worth recognising.

The pattern: a query filters on a column with no supporting index. At a thousand rows the sequential scan takes under a millisecond and nobody notices. At a million rows it takes 400 ms. At ten million it takes four seconds, connections back up waiting for it, the connection pool saturates, and requests that have nothing to do with that query start timing out.

Three things make this class of incident distinctive:

**It has no deploy to correlate with.** The code did not change; the data did. Teams looking for a bad release find nothing, which delays diagnosis.

**It appears as a general outage rather than a slow query.** The visible symptom is pool exhaustion and widespread timeouts, because a slow query holds a connection. The actual cause is one query shape that nobody is measuring individually.

**It is often triggered by a customer rather than by aggregate growth.** One large account has 300,000 rows where the median has 50. Every query scoped to that account is slow, and the slowness looks intermittent because it depends on who is using the system.

The second most common incident is the mirror image: **an index that was added and is never used.** It costs a write on every insert and update, occupies cache, and contributes nothing. Mature systems accumulate these — added for a query that was later changed, added "just in case", added by an engineer who has since left. Databases track index usage, and dropping unused indexes is one of the highest-value, lowest-risk changes available.

Two transferable lessons:

**Per-query-shape latency is the metric that catches this.** Aggregate p99 hides one slow query shape among thousands of fast ones until it saturates the pool. Grouping by normalised query text — most databases expose this — turns an invisible problem into an obvious one.

**Test with realistic data volumes and realistic skew.** A staging database with a thousand uniformly distributed rows will not reveal either the missing index or the outlier account. The distribution matters as much as the volume, and it is the part synthetic data usually gets wrong.`,
  },

  tradeoffs: {
    intro:
      'Every row here is a read/write trade. The first is the honest default and the last is the one teams reach for too early.',
    rows: [
      {
        option: 'No index: sequential scan',
        whenItWins:
          'Small tables, queries matching a large fraction of rows, and write-heavy tables where reads are rare. Reading in physical order beats random access per matching row.',
        whenItLoses:
          'Selective queries on large tables — and the failure arrives gradually as the table grows, with no deploy to blame.',
        cost:
          'Latency proportional to table size, and a slow query holding a connection until the pool saturates.',
      },
      {
        option: 'Single-column B-tree index',
        whenItWins:
          'A selective equality or range lookup on one column, and as a foreign-key index so referential checks and cascades stay fast.',
        whenItLoses:
          'Multi-column filters, where the database must combine indexes or fall back to a scan; and low-cardinality columns on their own.',
        cost:
          'One extra write per insert, space, cache pressure, and bloat on heavily updated columns.',
      },
      {
        option: 'Composite index matching a query shape',
        whenItWins:
          'The main tool. Equality columns first, then the range or sort column, turning filter-plus-sort-plus-limit into one seek and a short read.',
        whenItLoses:
          'When query shapes are many and varied — you cannot index the product of filters and sorts.',
        cost:
          'Larger than a single-column index, serves only queries whose leading columns it matches, and column order is a commitment.',
      },
      {
        option: 'Covering index with INCLUDE',
        whenItWins:
          'When the table fetch dominates — a selective query returning a few columns becomes an index-only scan.',
        whenItLoses:
          'Wide result sets, where the index approaches table size and the maintenance cost stops being worth it.',
        cost:
          'A substantially larger index, more cache displaced, and more to update when any included column changes.',
      },
      {
        option: 'Partial index with a WHERE clause',
        whenItWins:
          'Highly skewed predicates: 0.1% flagged rows, or a status that matters only while pending. The index contains only interesting rows, so it is tiny and stays cached.',
        whenItLoses:
          'When queries do not consistently include the same predicate — the planner can only use it when the query implies the index condition.',
        cost:
          'Only usable for queries matching its condition, which makes it easy to add and then silently stop benefiting from.',
      },
      {
        option: 'Non-B-tree structures (GIN, GiST, BRIN)',
        whenItWins:
          'Containment and text search (GIN), overlapping ranges and geometry (GiST), and huge naturally ordered tables (BRIN).',
        whenItLoses:
          'Ordinary equality and range queries on scalars, where B-tree is smaller and faster.',
        cost:
          'Higher build and maintenance cost, and behaviour that is harder to predict — GIN in particular is expensive to update.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The query is slow, so I would add an index on the columns in the WHERE clause."',
      whyWeak:
        'It skips the two things that decide whether an index helps and what shape it should be: the plan, and whether the planner\'s row estimate is right. An index chosen from a bad estimate still produces a bad plan, and column order derived from the order columns happen to appear in the WHERE clause is arbitrary.',
      strongAnswer:
        '"I would read the plan first, checking the scan type and the gap between estimated and actual rows. If the estimate is badly wrong, that is the bug. If it is right, I would derive the column order from the query — equality columns first, then the range or sort column — and confirm afterwards that the planner actually uses it."',
    },
    {
      weakAnswer: '"We have an index on `(customer_id, created_at)`, so queries filtering on `created_at` are covered."',
      whyWeak:
        'A composite index is sorted by its first column, then within that by the second. Rows matching a \`created_at\` range are scattered across every \`customer_id\` group, so there is nothing to seek to. The index may be scanned in full if it is much smaller than the table, but the work is proportional to the index rather than to the matches.',
      strongAnswer:
        '"That index serves queries with an equality on `customer_id`, optionally ranging on `created_at`. A query filtering only on `created_at` cannot use it as a seek, because the leading column is missing. If that query matters it needs its own index leading with `created_at`."',
    },
    {
      weakAnswer: '"We added indexes on every column that appears in a filter anywhere."',
      whyWeak:
        'Every index is written on every insert and on every update touching its columns, occupies cache that a hot index wanted, and adds planning time. A table with a dozen single-column indexes pays on every write for lookups that mostly never happen, and multi-column filters still cannot be served well.',
      strongAnswer:
        '"I index for query shapes, not for columns. One composite index matching the actual filter-and-sort shape usually replaces several single-column ones. Then I check usage statistics and drop indexes nothing reads — an unused index is pure write cost, and pruning is the highest-value low-risk change on a mature system."',
    },
    {
      weakAnswer: '"A sequential scan means the index is missing or the planner is wrong."',
      whyWeak:
        'For a small table, or a query matching a large fraction of rows, a sequential scan is genuinely faster — reading pages in physical order beats one random fetch per matching row. The planner chose it from statistics, and forcing an index scan usually makes things worse.',
      strongAnswer:
        '"A sequential scan is often correct. The question is whether the planner\'s row estimate matches reality — if it expected 40,000 rows and got 12, the estimate is the bug, not the plan. I would fix statistics or restate the predicate before assuming an index is missing."',
    },
    {
      weakAnswer: '"The index on `is_active` will make filtering active users fast."',
      whyWeak:
        'A boolean splits the table roughly in half, so an index on it alone is barely more selective than a scan and the database will usually ignore it. It costs writes and delivers nothing.',
      strongAnswer:
        '"A boolean on its own is too unselective to help unless the distribution is skewed. If only 0.1% of rows are inactive, a partial index — `WHERE NOT is_active` — is excellent, because it contains only those rows and stays tiny. Otherwise `is_active` earns its place as the leading column of a composite index that narrows the range for the sort column."',
    },
    {
      weakAnswer: '"We tested the query against staging and it was fast, so the index is fine."',
      whyWeak:
        'Staging usually has a fraction of the rows and a uniform distribution. Both matter: volume determines when a scan becomes unacceptable, and skew determines whether one large account makes a query slow for that customer only. Neither is visible in synthetic data.',
      strongAnswer:
        '"Index behaviour depends on volume and on distribution, so I would test against production-scale data with realistic skew — including the largest account. I would also add per-query-shape latency monitoring, because aggregate p99 hides a single slow shape until it saturates the connection pool."',
    },
  ],

  flashcards: [
    {
      id: 'fc-idx-1',
      front: 'What is a B-tree index, mechanically?',
      back: 'A sorted copy of some columns with pointers back to rows. Sortedness is why equality, ranges and ordering are cheap, and why anything not matching the sort order is not.',
      topic: 'btree',
    },
    {
      id: 'fc-idx-2',
      front: 'Why can a query filtering only on the second column of a composite index not seek?',
      back: 'The index is sorted by the first column, then by the second within each group. Matching second-column values are scattered across every group, so there is no starting point to seek to.',
      topic: 'indexes',
    },
    {
      id: 'fc-idx-3',
      front: 'What is the column-ordering rule for a composite index, and where does it come from?',
      back: 'Equality columns first, then the range or sort column, then output-only columns. It comes from the index being sorted left to right — you may range on the last used column but cannot skip a leading one.',
      topic: 'indexes',
    },
    {
      id: 'fc-idx-4',
      front: 'What is the best-case index usage for a filter-plus-sort-plus-limit query?',
      back: 'Seek to the equality group, read entries already in the required order, stop at the limit. No sort step and no scan beyond the rows returned.',
      topic: 'query-performance',
    },
    {
      id: 'fc-idx-5',
      front: 'What is an index-only scan and what does it require?',
      back: 'Answering entirely from the index without fetching rows. It requires every column the query needs to be in the index, as a key column or via INCLUDE.',
      topic: 'query-performance',
    },
    {
      id: 'fc-idx-6',
      front: 'What is selectivity and why does it decide whether an index is used?',
      back: 'The fraction of rows a predicate matches. At low selectivity the database would do a random fetch for a large share of rows, which is slower than reading the table in physical order.',
      topic: 'selectivity',
    },
    {
      id: 'fc-idx-7',
      front: 'When is a boolean column worth indexing?',
      back: 'When the distribution is heavily skewed — and then a partial index on the rare value is better still, because it contains only interesting rows and stays small enough to remain cached.',
      topic: 'selectivity',
    },
    {
      id: 'fc-idx-8',
      front: 'What is the most useful diagnostic signal in a query plan?',
      back: 'The gap between estimated and actual rows. A large gap means the planner chose a plan for a query it misunderstood, so fix the estimate before changing indexes.',
      topic: 'query-performance',
    },
    {
      id: 'fc-idx-9',
      front: 'Name four costs of an index.',
      back: 'A write per insert and per update of its columns, disk space, cache pressure competing with hot data, and bloat from dead entries under MVCC until vacuum reclaims them.',
      topic: 'indexes',
    },
    {
      id: 'fc-idx-10',
      front: 'Why is a sequential scan sometimes the right plan?',
      back: 'For a small table or an unselective query, reading pages in physical order beats one random fetch per matching row. The planner chose it from statistics.',
      topic: 'query-performance',
    },
    {
      id: 'fc-idx-11',
      front: 'What does B-tree not handle, and what covers each gap?',
      back: 'Containment and text search (GIN inverted index), overlapping ranges and geometry (GiST), very large naturally ordered tables (BRIN), and vector similarity (ANN structures).',
      topic: 'databases',
    },
    {
      id: 'fc-idx-12',
      front: 'Why does an index on `(a ASC, b ASC)` not cheaply serve `ORDER BY a ASC, b DESC`?',
      back: 'It can be read forwards or backwards, giving both-ascending or both-descending. Mixed directions match neither traversal, so a sort step is needed.',
      topic: 'btree',
    },
    {
      id: 'fc-idx-13',
      front: 'Why does aggregate p99 latency hide a missing index?',
      back: 'One slow query shape among thousands of fast ones barely moves the aggregate until it saturates the connection pool — at which point it looks like a general outage. Per-query-shape latency catches it.',
      topic: 'query-performance',
    },
  ],

  quiz: [
    {
      id: 'q-idx-1',
      kind: 'scenario',
      prompt:
        'An index exists on `(customer_id, created_at)`. A new reporting query runs `WHERE created_at > $1 AND status = \'open\'` and is slow. Why does the existing index not help?',
      options: [
        { id: 'a', label: 'The leading column `customer_id` is absent, so there is no seek position — matching dates are scattered across every customer group' },
        { id: 'b', label: 'The index is on the wrong table' },
        { id: 'c', label: '`created_at` is a timestamp and cannot be range-scanned' },
        { id: 'd', label: 'The index needs to be rebuilt' },
      ],
      correct: ['a'],
      explanation:
        'A composite index is sorted by its first column, then by the second within each group. Without an equality on `customer_id` there is no starting point. Timestamps range-scan perfectly well when they lead an index — the problem is position, not type.',
      difficulty: 'core',
      topic: 'indexes',
    },
    {
      id: 'q-idx-2',
      kind: 'scenario',
      prompt:
        'A plan shows an index scan where the planner estimated 15 rows and actually got 92,000, followed by a nested loop join. What should you address first?',
      options: [
        { id: 'a', label: 'The row estimate — with the true count the planner would likely have chosen a hash join and a different scan' },
        { id: 'b', label: 'Add a covering index so the table fetch disappears' },
        { id: 'c', label: 'Force a hash join with a planner hint' },
        { id: 'd', label: 'Increase the connection pool so the query has more resources' },
      ],
      correct: ['a'],
      explanation:
        'A four-orders-of-magnitude estimate error means the planner solved a different problem. Nested loops are correct for 15 rows and catastrophic for 92,000. Refresh statistics, raise the sampling target, or restate the predicate — a better index chosen from the same bad estimate will still produce a bad plan.',
      difficulty: 'advanced',
      topic: 'query-performance',
    },
    {
      id: 'q-idx-3',
      kind: 'single',
      prompt:
        'For `SELECT id, total FROM orders WHERE customer_id = $1 AND status = \'open\' ORDER BY created_at DESC LIMIT 20`, which index is best?',
      options: [
        { id: 'a', label: '`(customer_id, status, created_at DESC) INCLUDE (total)`' },
        { id: 'b', label: '`(created_at DESC, customer_id, status)`' },
        { id: 'c', label: 'Separate indexes on `customer_id`, `status` and `created_at`' },
        { id: 'd', label: '`(customer_id, created_at DESC, status)`' },
      ],
      correct: ['a'],
      explanation:
        'Both equality columns lead, then the sort column in the matching direction, then the returned column included for an index-only scan: one seek, twenty entries, stop. Option (b) puts the sort column first so there is no seek. Option (d) puts `status` after the sort column, so it becomes a filter applied to every entry read. Separate indexes force a combine or a scan.',
      difficulty: 'core',
      topic: 'indexes',
    },
    {
      id: 'q-idx-4',
      kind: 'scenario',
      prompt:
        'A table has 40 million rows; 12,000 have `needs_review = true`. Which index best serves `WHERE needs_review AND created_at > $1`?',
      options: [
        { id: 'a', label: 'A partial index: `(created_at) WHERE needs_review`' },
        { id: 'b', label: 'A composite index on `(needs_review, created_at)`' },
        { id: 'c', label: 'A single-column index on `needs_review`' },
        { id: 'd', label: 'A single-column index on `created_at`' },
      ],
      correct: ['a'],
      explanation:
        'The partial index contains only the 12,000 interesting rows, so it is tiny, stays cached, and is cheap to maintain because writes to the other 39,988,000 rows never touch it. A composite index would work but stores all 40 million entries. A boolean alone is too unselective, and leading with `created_at` reads far more than needed.',
      difficulty: 'advanced',
      topic: 'selectivity',
    },
    {
      id: 'q-idx-5',
      kind: 'scenario',
      prompt:
        'A service degrades over months with no deploy. One endpoint\'s p99 rises from 30 ms to 3 s, then the connection pool saturates and unrelated endpoints start timing out. What is the most likely cause?',
      options: [
        { id: 'a', label: 'A query with no supporting index whose sequential scan grew with the table until it held connections long enough to exhaust the pool' },
        { id: 'b', label: 'A memory leak in the application' },
        { id: 'c', label: 'Network latency to the database increased' },
        { id: 'd', label: 'The database needs more CPU' },
      ],
      correct: ['a'],
      explanation:
        'The fingerprint is gradual degradation with no code change — the data grew, not the code. A slow query holds a connection, so pool exhaustion turns one slow query shape into a general outage. This is why per-query-shape latency matters: aggregate p99 hides it until the pool goes.',
      difficulty: 'advanced',
      topic: 'query-performance',
    },
    {
      id: 'q-idx-6',
      kind: 'multi',
      prompt: 'Which of these are genuine costs of adding an index? Select all that apply.',
      options: [
        { id: 'a', label: 'An extra write on every insert and on every update touching its columns' },
        { id: 'b', label: 'Cache pressure competing with hot table and index data' },
        { id: 'c', label: 'Bloat from dead entries under MVCC until vacuum reclaims them' },
        { id: 'd', label: 'Slower reads on queries that do not use it' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the real costs, and naming them is what makes "add an index" a decision rather than a reflex. Queries that do not use an index are not directly slowed by it — though extra planning time and displaced cache are second-order effects, which is a subtler point than the option states.',
      difficulty: 'core',
      topic: 'indexes',
    },
  ],

  exercises: [
    {
      id: 'ex-idx-1',
      kind: 'design',
      title: 'Index a real query set, then prune',
      estimatedMinutes: 25,
      prompt: `A \`shipments\` table has 80 million rows and these query shapes, with measured frequencies:

\`\`\`sql
-- A: 4,000/s  (customer dashboard)
SELECT id, status, eta FROM shipments
WHERE customer_id = $1 AND status IN ('in_transit','out_for_delivery')
ORDER BY created_at DESC LIMIT 25;

-- B: 200/s  (courier app)
SELECT id, address, eta FROM shipments
WHERE courier_id = $1 AND scheduled_for = $2 AND status <> 'delivered'
ORDER BY sequence_no;

-- C: 5/s  (ops console)
SELECT * FROM shipments
WHERE created_at BETWEEN $1 AND $2 AND status = 'exception'
ORDER BY created_at;

-- D: hourly job
SELECT customer_id, count(*) FROM shipments
WHERE created_at >= $1 GROUP BY customer_id;
\`\`\`

Existing indexes: \`(customer_id)\`, \`(status)\`, \`(created_at)\`, \`(courier_id)\`.

Facts: 0.4% of shipments have status \`exception\`; \`delivered\` is 92% of rows; the table takes 6,000 inserts/s and each row is updated 4-6 times during its life.

Produce:
1. The index set you would create, with the column order justified per query.
2. Which existing indexes you would drop and why.
3. The write-amplification consequence of your set, stated as a number.
4. Which query you would deliberately leave un-indexed, and why.`,
      rubric: [
        'Query A: leads with customer_id and status (equality/IN), then created_at DESC, and includes the returned columns for an index-only scan.',
        'Query B: leads with courier_id and scheduled_for (equality), then sequence_no for the sort; recognises status <> is not usable as a leading predicate.',
        'Query C: uses a partial index on the 0.4% exception rows rather than a full composite, and justifies it by skew plus low query rate.',
        'Query D: recognises it as an analytical aggregate over a large range and considers leaving it un-indexed or serving it elsewhere.',
        'Drops (customer_id) and (courier_id) as subsumed by the new composites, and (status) as unselective given 92% delivered.',
        'Keeps or drops (created_at) with reasoning tied to query D and the ops console.',
        'States write amplification concretely: index count times insert rate, and notes updates touch every index under MVCC.',
        'Names one query left un-indexed with a defensible reason rather than indexing everything.',
      ],
      modelAnswer: `**1. Indexes to create**

**For A (4,000/s — by far the most important):**
\`\`\`sql
CREATE INDEX shipments_cust_status_created
  ON shipments (customer_id, status, created_at DESC)
  INCLUDE (eta);
\`\`\`
\`customer_id\` and \`status\` are equality/IN, so they lead. \`created_at DESC\` matches the sort, so the top 25 come off the front with no sort step. \`INCLUDE (eta)\` plus \`id\` and \`status\` already being in the index gives an index-only scan — no table fetch for 4,000 queries a second, which is the whole point at this rate.

The \`IN\` on two status values becomes two seeks, each reading 25 entries. Practically: this query does about 50 index reads regardless of table size.

**For B (200/s):**
\`\`\`sql
CREATE INDEX shipments_courier_sched_seq
  ON shipments (courier_id, scheduled_for, sequence_no)
  INCLUDE (address, eta);
\`\`\`
Two equality columns lead, then \`sequence_no\` for the sort. \`status <> 'delivered'\` is deliberately **not** in the index: an inequality against a 92%-frequency value is not a useful leading predicate, and putting it before \`sequence_no\` would break the sort. It becomes a filter on the entries read, which is fine because a courier's daily route is tens of rows.

**For C (5/s, 0.4% selective):**
\`\`\`sql
CREATE INDEX shipments_exceptions
  ON shipments (created_at) WHERE status = 'exception';
\`\`\`
A partial index is clearly right here. It holds ~320,000 entries instead of 80 million, stays cached, and — critically at 6,000 inserts/s — **is untouched by 99.6% of writes**. \`created_at\` inside it serves both the range filter and the sort. \`SELECT *\` means a table fetch per row, which is acceptable at 5 queries/s over a few hundred rows.

**2. Existing indexes to drop**

| Index | Decision | Reason |
| --- | --- | --- |
| \`(customer_id)\` | **Drop** | Subsumed by \`(customer_id, status, created_at)\` — any query it served can use the new index's leading column. |
| \`(courier_id)\` | **Drop** | Subsumed by \`(courier_id, scheduled_for, sequence_no)\`. |
| \`(status)\` | **Drop** | 92% of rows are \`delivered\`, so it is unselective and the planner will ignore it for the common values. Exceptions are served by the partial index. |
| \`(created_at)\` | **Keep** | Serves query D's range scan and gives the ops console a fallback. It is the only index supporting a bare \`created_at\` range, and D is a scheduled job whose alternative is a full table scan. |

Before dropping anything I would check usage statistics to confirm nothing else depends on them — the query list given is unlikely to be complete for a table this central.

**3. Write amplification**

Index count goes from 4 to 4 (three new, three dropped, one kept). So on the surface, unchanged.

But the composition is much better:

- **Inserts:** 6,000/s × 4 index writes = 24,000 index writes/s. Same count as before, and the partial index only participates for the 0.4% of inserts that are exceptions — so effectively **~18,000 + 24 ≈ 18,024 index writes/s**, roughly a 25% reduction from the previous four full indexes.
- **Updates:** each row is updated 4-6 times, and under MVCC an update writes a new row version, which means **new entries in every index whose page the row moves within** — in the worst case all of them. At 6,000 inserts/s × 5 updates, that is ~30,000 row versions/s × 4 indexes ≈ 120,000 index writes/s from updates alone. **Updates dominate inserts by 5:1 here**, which is the number that actually matters and the one most people forget.

The consequence worth stating: on a table with this update rate, **every index is expensive and index count discipline matters more than usual**. The partial index is valuable precisely because it opts out of most of that traffic.

**4. Left deliberately un-indexed: query D.**

\`\`\`sql
SELECT customer_id, count(*) FROM shipments WHERE created_at >= $1 GROUP BY customer_id;
\`\`\`

Reasons:

- It is an **aggregate over a wide range** — an hourly job over, presumably, a large window. It touches a large fraction of recent rows, so it is unselective by nature and a sequential scan or a scan of \`(created_at)\` is appropriate.
- A covering index that made this an index-only scan would need \`(created_at, customer_id)\` and would be nearly as large as the table for the columns involved, paid for on every one of 30,000 row versions per second — to serve a query that runs once an hour.
- It is a **job, not a user request**. Its latency budget is minutes.

The right answer if it ever becomes a problem is not an index but moving it: a materialised aggregate updated incrementally, or a read replica, or an analytical store. Adding an index to a write-hot table for an hourly reporting query is paying continuously for something needed 24 times a day — and recognising that is the same trade-off as the denormalisation rule from the previous lesson.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-idx-1',
      level: 'basic',
      question: 'What is a B-tree index and why does it make queries fast?',
      guidance:
        'A sorted copy of columns with pointers to rows, so equality, ranges and ordering are cheap. A strong answer derives the properties from sortedness rather than listing them, and immediately notes what sortedness cannot help with.',
    },
    {
      id: 'iq-idx-2',
      level: 'basic',
      question: 'How do you choose the column order for a composite index?',
      guidance:
        'Equality columns first, then the range or sort column, then output-only columns. Look for the reasoning — the index is sorted left to right, so you may range on the last used column and cannot skip a leading one — rather than the rule recited.',
    },
    {
      id: 'iq-idx-3',
      level: 'intermediate',
      question: 'What does an index cost?',
      guidance:
        'A write per insert and per update of its columns, space, cache pressure, planning time, and MVCC bloat. A strong answer notes that on an update-heavy table update amplification dominates insert amplification, and that an unused index is pure cost.',
    },
    {
      id: 'iq-idx-4',
      level: 'intermediate',
      question: 'A query is slow. Walk me through your process.',
      guidance:
        'Read the plan; check scan type and estimated versus actual rows; fix the estimate if it is wrong; derive the index column order from the query; create one index; confirm it is used; prune what became redundant. A candidate who starts by adding an index has skipped the diagnosis.',
    },
    {
      id: 'iq-idx-5',
      level: 'advanced',
      question: 'When would you use a partial index?',
      guidance:
        'Heavily skewed predicates — a rare status or flag. Strong answers name both benefits: it is small enough to stay cached, and it is untouched by writes to non-matching rows, which matters enormously on a write-hot table. Excellent answers note it is only usable when the query implies the index condition.',
    },
    {
      id: 'iq-idx-6',
      level: 'advanced',
      question: 'A service degrades over months with no deploy, then the connection pool saturates. Diagnose it.',
      guidance:
        'A query with no supporting index whose scan cost grew with the table. Look for recognition that a slow query holds a connection, so one bad shape becomes a general outage, and that aggregate p99 hides it. Excellent answers mention per-query-shape latency and skewed accounts as the usual trigger.',
    },
    {
      id: 'iq-idx-7',
      level: 'followup',
      question: 'You said a sequential scan can be correct. When?',
      guidance:
        'Small tables and unselective queries, where sequential page reads beat one random fetch per matching row. A strong answer redirects the question to whether the row estimate is accurate, since that is what determines whether the planner\'s choice was informed.',
    },
    {
      id: 'iq-idx-8',
      level: 'followup',
      question: 'When is B-tree the wrong index type?',
      guidance:
        'Containment and text search (GIN), overlapping ranges and geometry (GiST), very large naturally ordered data (BRIN), vector similarity (ANN). A strong answer notes GIN is expensive to update, so the choice has a write cost as well as a capability.',
    },
  ],

  activeLearning: [
    {
      id: 'al-idx-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson assumed a single database where the planner chooses among indexes. Now change one thing: the store is a key-value database with a partition key and one optional sort key per index, and there is no query planner — a query either matches an index or is rejected. What survives, and what becomes a harder decision?',
      discussion: `The mechanics survive almost entirely. The decision-making changes completely, and that is the interesting part.

**What survives unchanged:**

*Sortedness is still the mechanism.* A partition key locates a group; a sort key orders within it. That is exactly \`(a, b)\` in a composite B-tree, with the leading column mandatory rather than merely preferable.

*Equality-then-range still holds.* You supply the partition key with equality and may range on the sort key. Skipping the partition key is not slow — it is refused, or it becomes a full scan you must ask for explicitly.

*Covering still matters.* Projecting only some attributes into a secondary index is the same index-only-scan trade: smaller index, cheaper reads, less to maintain.

*Selectivity still matters*, but it moves. Instead of the planner deciding an index is not worth using, an unselective partition key gives you a hot partition — all the traffic for one value on one physical node.

**What becomes harder: there is no fallback.**

In a relational database, a query you did not anticipate is slow. In a key-value store it is impossible, or it is a full scan whose cost is proportional to the table and which you must deliberately request. That single difference reshapes the work:

*Index design moves before the code.* You cannot read a plan and add an index in response, because there is no plan and the query does not exist until an index supports it. Every access pattern must be enumerated up front, which is why access-pattern-first design is a discipline in these stores rather than a preference.

*Adding an index later is a backfill, not a build.* A new secondary index must be populated over the whole dataset, and while it fills it is incomplete. Compare that with adding a B-tree index concurrently to a live table — also a real operation, but a much better understood one.

*You lose the safety net of "the planner will figure something out".* That safety net is genuinely valuable and rarely credited: a relational database will answer any query you can express, badly if necessary. Losing it is the actual cost of predictable performance.

**And one thing that becomes easier.** Performance is predictable. A relational query's cost depends on statistics, on data distribution, and on which plan the planner chose today — so a query can regress without any change to code or schema. In a key-value store, a lookup by partition and sort key costs the same tomorrow as today. That predictability is what people buy, and it is bought with flexibility.

**Transferable:** "index for your queries, not your columns" is advice in a relational store and a hard constraint in a key-value one. Systems that force you to state your access patterns are not more primitive — they have removed the option of being wrong later, and charged you the option of changing your mind.`,
    },
    {
      id: 'al-idx-2',
      kind: 'debug',
      prompt:
        'A query that ran in 8 ms for a year now takes 900 ms. No deploy, no schema change, no growth in table size, and the plan still shows the same index being used. What are your hypotheses?',
      discussion: `Same plan, same index, same table size, 100× slower. That combination rules out most of the usual suspects and points at the *physical* state of the data rather than the logical query.

**Hypothesis 1: index bloat.** Under MVCC, updates and deletes leave dead entries in indexes until vacuum reclaims the space. A heavily updated table can grow an index to several times its useful size, so the same logical seek now traverses far more pages — and far more of them miss cache. This is the leading candidate because it produces exactly this signature: identical plan, identical row counts, much more I/O.

*Check:* index size versus table size over time, and the dead-tuple count. If autovacuum has been unable to keep up — or has been repeatedly cancelled by lock conflicts — this is it. The fix is a concurrent reindex plus fixing whatever starved autovacuum.

**Hypothesis 2: the working set no longer fits in cache.** The table did not grow, but something else did. A new index, another table, or a change in traffic mix has displaced these pages from memory, so what were buffer hits are now disk reads. Same plan, 100× more latency.

*Check:* buffer hit ratio for this relation, and whether anything new was added to the same instance.

**Hypothesis 3: physical correlation lost.** If the index scan is followed by a table fetch, the cost depends on how clustered the matching rows are on disk. A table that was naturally ordered by insert time — and whose queries fetched contiguous rows — loses that clustering as rows are updated and move. Now each of 500 index entries fetches a different page.

*Check:* whether the query returns many rows (so the fetch dominates) and whether correlation statistics for the ordering column have degraded. The fix is either a covering index so no fetch happens, or physically reordering the table.

**Hypothesis 4: parameter skew rather than a general regression.** Perhaps the query is not universally slower; perhaps it is being called with a different parameter. One customer grew to 300,000 rows while the median has 50, so the same plan reading a much larger range is legitimately slow.

*Check:* is the latency distribution bimodal? Does slowness correlate with a specific parameter value? This is worth ruling out early because it is cheap to check and changes the fix entirely.

**What I would measure, in order:** index size and dead-tuple count (hypothesis 1), buffer hit ratio (2), rows returned and correlation (3), latency grouped by parameter (4). One and two are checked in a single query against system catalogues.

**The transferable lesson.** A query plan describes the *logical* strategy; latency depends on the *physical* state — bloat, cache residency, clustering. When the plan is unchanged and the timing is not, stop reading plans and look at the storage. This is the class of problem that makes people believe databases are unpredictable, and it is entirely explicable once you know the four places physical state hides.`,
    },
  ],

  revision: {
    bullets: [
      'An index is a sorted copy of columns with pointers to rows. Nearly every rule follows from sortedness.',
      'Cheap: finding one value, finding a range, getting rows already in order. Impossible: seeking by a column the index is not sorted by.',
      'A composite index on (a, b, c) is sorted by a, then b within a, then c within b.',
      'Usable left to right with equality on all columns before the last one you range over. You cannot skip a leading column.',
      'Ordering rule: equality columns first, then the range or sort column in the matching direction, then output-only columns.',
      'Best case: seek to the equality group, read entries already ordered, stop at the limit. No sort step.',
      'An index-only scan avoids the table fetch entirely, and needs every queried column in the index — key or INCLUDE.',
      'Selectivity decides whether the planner uses an index; a boolean alone is usually too unselective.',
      'A skewed predicate is the case for a partial index — small, cache-resident, and untouched by writes to non-matching rows.',
      'The most useful plan signal is estimated versus actual rows. Fix a bad estimate before changing indexes.',
      'A sequential scan is often correct: small table, or unselective query where sequential pages beat random fetches.',
      'Costs: a write per insert and per update of its columns, space, cache pressure, planning time, MVCC bloat.',
      'On an update-heavy table, update amplification dominates insert amplification — often 5:1 or worse.',
      'An unused index is pure cost. Check usage statistics and drop what nothing reads.',
      'B-tree gaps: GIN for containment and text, GiST for ranges and geometry, BRIN for huge ordered data, ANN for vectors.',
      'Index for the queries you run, not the columns you have.',
      'Same plan and much worse latency means physical state: bloat, lost cache residency, lost clustering, or parameter skew.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A sorted auxiliary structure over selected columns that turns a scan into a seek, at the cost of being maintained on every write.',
    whyItExists:
      'Finding a small number of rows by value requires either reading everything or consulting something already ordered by that value.',
    whenToUse: [
      'A selective query on a large table whose plan shows a scan you cannot afford.',
      'Filter-plus-sort-plus-limit shapes, where the right composite index removes the sort entirely.',
      'Foreign-key columns, so referential checks and cascading deletes do not scan.',
    ],
    whenNotToUse: [
      'Small tables, or queries matching a large fraction of rows.',
      'Low-cardinality columns on their own, unless the distribution is heavily skewed.',
      'Write-hot tables serving an occasional reporting query — move the query instead.',
    ],
    alternatives: [
      'A materialised aggregate or read model, when the query is analytical rather than selective.',
      'A read replica or analytical store, for reporting that would otherwise force an index onto a write-hot table.',
      'A partial index, when only a small skewed subset of rows is ever queried.',
      'Physical clustering, when the table fetch rather than the index seek is the cost.',
    ],
    tradeoffs: [
      'Every index buys read seeks and costs write amplification, space, cache and maintenance.',
      'Covering indexes buy index-only scans and cost size, cache displacement and more update work.',
      'Composite indexes buy one seek for a whole query shape and commit you to that column order.',
      'Partial indexes buy tiny size and opt-out from most writes, and only apply when the query implies their condition.',
    ],
    failureModes: [
      'A gradually growing sequential scan holding connections until the pool saturates, with no deploy to blame.',
      'A composite index unusable because a query omits its leading column.',
      'A bad row estimate producing a nested loop over tens of thousands of rows.',
      'Index bloat under MVCC degrading a plan that has not changed.',
      'Accumulated unused indexes paid for on every write.',
      'Staging tests passing because the data was small and uniformly distributed.',
      'A mixed-direction ORDER BY forcing a sort despite a matching column list.',
    ],
    followUpQuestions: [
      'What does the plan say, and does the row estimate match reality?',
      'Which column leads this index, and does the query supply it with equality?',
      'Does this query need a table fetch, and could INCLUDE remove it?',
      'How selective is that predicate, and is the distribution skewed?',
      'How many indexes does this table have, and how many writes does each row take?',
      'Which of these indexes has a non-zero usage count?',
    ],
  },
});
