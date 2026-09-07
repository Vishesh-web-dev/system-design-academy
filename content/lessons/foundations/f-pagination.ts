import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-pagination',
  title: 'Pagination, filtering and sorting at scale',
  summary:
    'Offset pagination is a correctness bug before it is a performance problem, and the fix — cursors over a total order — is also what makes filtering and sorting affordable.',
  phase: 'foundations',
  module: 'apis',
  position: 8,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 40,
  tags: ['pagination', 'api-design', 'query-performance', 'indexes', 'cursors'],
  prerequisites: ['f-api-contracts'],
  resources: [
    {
      key: 'google-api-design-guide',
      tier: 'must',
      note: 'The list-pagination section specifies page tokens as opaque strings, which is the single most important design decision here — it lets you change the underlying mechanism without breaking consumers.',
    },
    {
      key: 'postgres-indexes',
      tier: 'must',
      note: 'Read chapter 11 with one question in mind: which index makes a keyset query a range scan rather than a sort? The answer decides whether your pagination is fast or merely correct.',
    },
    {
      key: 'graphql-best-practices',
      tier: 'good',
      note: 'The connections and pagination discussion. Useful for seeing the same cursor reasoning arrived at independently in a different protocol.',
    },
    {
      key: 'dynamodb-best-practices',
      tier: 'good',
      note: 'Pagination in a store with no global sort order at all. It shows what happens when you cannot fall back on OFFSET even if you wanted to.',
    },
  ],

  intuition: {
    body: `\`LIMIT 20 OFFSET 40\` looks like "give me page 3". It is not. It is "read 60 rows, throw away 40, return 20".

Two problems follow, and the order matters because everyone notices the second one and almost nobody notices the first.

**The performance problem.** \`OFFSET 100000\` reads a hundred thousand rows to discard them. Page 1 is instant, page 5,000 times out. The cost of a page grows linearly with how deep it is, which is exactly backwards from what a user expects.

**The correctness problem.** Offsets are positions in a result set that is still changing. Between fetching page 1 and page 2, a row is inserted near the front. Everything shifts down by one, so the row that was last on page 1 is now first on page 2 — the user sees it twice. Delete a row instead and everything shifts up, so one row is skipped and the user never sees it at all.

That is the part worth internalising: **offset pagination silently duplicates and skips records on any dataset that changes.** For a list of countries, fine. For an audit log, a transaction history, or anything a job is paginating through to process each item exactly once, it is a data-loss bug that produces no error.

The fix is to stop asking "how far in" and start asking "after which row". A cursor names a position in a *total order* rather than a count, so inserts and deletes elsewhere cannot move it. That single change fixes both problems at once — and constrains what filtering and sorting you can offer, which is the rest of the lesson.`,
    analogyLimit:
      'The bookmark analogy is close but misses the constraint that makes cursors work: a bookmark in a book is stable because pages do not reorder themselves. A cursor is only stable because you guaranteed a total order and indexed it. Change the sort and the cursor is meaningless — which is why the sort key is part of the cursor, not part of the request.',
  },

  deepExplanation: {
    predict: {
      question:
        'A nightly job pages through an `orders` table with `ORDER BY created_at DESC LIMIT 100 OFFSET n`, processing each order once. Orders are created continuously while it runs. Roughly what fraction of orders get skipped if 500 new orders arrive during a run over 100,000 rows — and does the job report any error?',
      answer: `Roughly **500 orders skipped**, and **no error at all**.

The mechanism: the job sorts newest-first. Every new order inserted during the run lands at position 0 and pushes everything down by one. When the job asks for \`OFFSET 1000\`, it lands 1000 rows into a list that has grown by however many orders arrived since it started — so it skips exactly as many rows as were inserted before that point.

Over a full run, the number of missed rows is approximately the number of inserts during the run: **500**.

Two things make this genuinely dangerous rather than merely wrong:

**It is silent.** Every query succeeds. The job completes. The row count processed looks plausible. Nothing in any log or metric indicates that 500 orders were never processed. It is discovered weeks later by a reconciliation, or by a customer.

**It gets worse as the table grows.** The skip rate depends on insert rate during the run, and the run gets longer as the table grows — because \`OFFSET 99000\` reads 99,000 rows. So the bug compounds: a slower job skips more.

If the sort were ascending instead, the failure inverts: new rows land at the *end*, so nothing is skipped, but rows deleted during the run cause skips. Either way the offset is a position in a moving list.

**The fix:** \`WHERE (created_at, id) > (:last_created_at, :last_id) ORDER BY created_at, id LIMIT 100\`. The cursor names a row, not a count. Rows inserted before or after that position cannot move it, and the query is a range scan over an index rather than a scan-and-discard.

The \`id\` in the tuple is not decoration — without it, several orders sharing a \`created_at\` timestamp would be either skipped or repeated at the page boundary.`,
    },
    body: `## Keyset pagination, properly

The mechanism is to remember the last row seen and ask for rows after it in a defined order.

\`\`\`sql
-- page 1
SELECT id, created_at, total FROM orders
WHERE customer_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- page 2, given the last row of page 1
SELECT id, created_at, total FROM orders
WHERE customer_id = $1
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 20;
\`\`\`

Three requirements, all non-negotiable:

**The sort must be a total order.** \`ORDER BY created_at\` alone is not: several rows can share a timestamp, and the database may return them in any order between queries. Rows at a page boundary then get skipped or duplicated — the exact bug you were fixing. Append a unique tiebreaker, almost always the primary key.

**The comparison must be a tuple comparison.** \`(created_at, id) < ($2, $3)\` is not the same as \`created_at <= $2 AND id < $3\`, which excludes valid rows with earlier timestamps. Row-value comparison is standard SQL and does the right thing; hand-expanding it is where the bugs live.

**There must be an index on the sort key.** \`(customer_id, created_at DESC, id DESC)\` turns the query into a range scan that seeks directly to the cursor position and reads twenty rows. Without it, the database sorts the whole filtered set on every page and you have offset performance with cursor complexity.

## What you gain and what you give up

**Gain:** constant cost per page regardless of depth, and no skips or duplicates from concurrent writes.

**Give up:**

- **Jumping to page 57.** There is no way to construct that cursor without scanning. This is usually fine — users almost never jump to arbitrary deep pages, they filter instead — but it is a genuine product constraint and it must be agreed rather than assumed.
- **A total count.** \`COUNT(*)\` over a filtered set is a full scan of the matching rows. "1–20 of 4,318" is expensive at scale.
- **Stability across sort changes.** A cursor is meaningless under a different sort, so the sort must be encoded in the cursor and a sort change must reset pagination.

## Cursors must be opaque

Return the cursor as a single opaque string:

\`\`\`json
{
  "items": [ ... ],
  "nextCursor": "eyJjIjoiMjAyNi0wOS0wNVQxODoyMjowMFoiLCJpIjoib3JkXzdmM2EifQ"
}
\`\`\`

The client's only contract is: pass this back to get the next page. Never document its structure.

Why this matters more than it looks: **an opaque cursor lets you change the pagination mechanism without a breaking change.** Move from a timestamp tuple to a sequence number, add a shard identifier, switch from keyset to a search engine's scroll token — all invisible. Publish the structure and you have published a contract, and you will be maintaining timestamp-tuple cursors long after you have moved off that store.

Two things to include inside it:

- **The sort key and direction**, so you can reject a cursor used with a different sort rather than silently returning nonsense.
- **A signature or version marker**, so a tampered or stale cursor from an old deployment fails cleanly rather than producing a strange query.

## Filtering and sorting are index commitments

Every filter and sort combination you expose is a promise that you can serve it efficiently. Exposing arbitrary filtering over arbitrary sorting means the number of query shapes is the product of both, and you cannot index all of them.

The discipline is to expose a *closed set* of supported combinations and index each one:

\`\`\`
GET /orders?status=open&sort=created_at:desc     → idx (status, created_at DESC, id DESC)
GET /orders?customerId=x&sort=created_at:desc    → idx (customer_id, created_at DESC, id DESC)
\`\`\`

Two failure patterns to recognise:

**Unbounded filter combinations.** \`?status=&customerId=&minTotal=&createdAfter=&sort=\` gives consumers a query builder. Some combination will have no usable index and will scan, and you will find out from a partner in production. If consumers genuinely need arbitrary querying, that is a signal to move the read path to a search engine designed for it — not to add indexes reactively.

**Sorting on an unindexed column.** \`sort=total:desc\` on a table with no index on \`total\` sorts the entire filtered set per page. It works in staging with 500 rows.

## Counts, honestly

Three options, and they are product decisions rather than technical ones:

- **No count.** Return \`hasMore\` instead. Cheapest and almost always sufficient — you can render "Next" without knowing how many pages exist.
- **Approximate count.** Table statistics or a maintained counter. Good for "about 4,300 results".
- **Exact count.** A separate, explicitly expensive endpoint the client calls only when it truly needs it.

The mistake is returning an exact count on every page by default, which makes every request pay for information almost nobody reads.

## When offset is fine

Say it plainly, because reflexively rejecting offset is its own kind of error:

- Small bounded datasets — a settings list, a country list, a user's own payment methods.
- Immutable or append-only snapshots where nothing shifts.
- Admin tools where deep jumping is genuinely wanted and the volume is low.

The rule: **offset is fine when the dataset is small or not changing.** Use keyset when it is large, changing, or being consumed by a job that must see every row exactly once.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'offset-drift',
      title: 'How an offset skips a row with no error',
      caption:
        'Follow row D. It was position 4 when page 1 was fetched and position 5 after the insert, so the OFFSET 4 request starts at E and D is never returned. Every query succeeded.',
      code: `sequenceDiagram
    participant C as Client
    participant D as Database

    Note over D: Rows newest-first: A B C D E F G H
    C->>D: LIMIT 4 OFFSET 0
    D-->>C: A B C D
    Note right of C: page 1 delivered

    Note over D: New row X inserted at the front
    Note over D: Rows now: X A B C D E F G H

    C->>D: LIMIT 4 OFFSET 4
    D-->>C: D E F G
    Note right of C: D returned twice, and<br/>with a delete instead,<br/>a row would vanish

    Note over C,D: No error. No warning. Silently wrong.`,
    },
    {
      kind: 'flow',
      id: 'pagination-decision',
      title: 'Which pagination, and what each one commits you to',
      caption:
        'Step through the branches. The important asymmetry: offset is a product convenience with a correctness cost, and keyset is a correctness guarantee with a product cost. Both are trades, and only one of them is silent.',
      nodes: [
        { id: 'q', label: 'Paginating a list', kind: 'client', x: 0, y: 140 },
        { id: 'small', label: 'Small and bounded?', kind: 'note', x: 190, y: 40, detail: 'A few hundred rows that a user could reasonably scroll: settings, payment methods, countries. Offset costs nothing here and buys page numbers.' },
        { id: 'offset', label: 'OFFSET / LIMIT', kind: 'service', x: 420, y: 30, detail: 'Simple, supports jumping to any page, and reads and discards every skipped row. Silently duplicates or skips records whenever the underlying data changes.' },
        { id: 'changing', label: 'Large or changing?', kind: 'note', x: 190, y: 240, detail: 'Anything append-heavy, or being consumed by a job that must process each row exactly once. This is where offset stops being a performance question.' },
        { id: 'keyset', label: 'Keyset cursor', kind: 'service', x: 420, y: 240, detail: 'Constant cost per page and immune to concurrent inserts and deletes. Requires a total order, a tuple comparison and a matching index. No page jumping.' },
        { id: 'index', label: 'Composite index', kind: 'store', x: 640, y: 300, detail: 'Filter columns first, then sort key, then the unique tiebreaker. Without it the database sorts the whole filtered set on every page and you have kept the complexity while losing the benefit.' },
        { id: 'count', label: 'Count strategy', kind: 'note', x: 640, y: 140, detail: 'hasMore is nearly always enough. Exact counts are a full scan of matching rows, so they belong on a separate endpoint the client calls deliberately.' },
        { id: 'search', label: 'Search engine', kind: 'external', x: 640, y: 20, detail: 'When consumers genuinely need arbitrary filter and sort combinations, the answer is a store built for it — not adding composite indexes reactively for every combination a partner discovers.' },
      ],
      edges: [
        { id: 'p1', source: 'q', target: 'small', kind: 'control' },
        { id: 'p2', source: 'q', target: 'changing', kind: 'control' },
        { id: 'p3', source: 'small', target: 'offset', kind: 'control' },
        { id: 'p4', source: 'changing', target: 'keyset', kind: 'control' },
        { id: 'p5', source: 'keyset', target: 'index', kind: 'read' },
        { id: 'p6', source: 'keyset', target: 'count', kind: 'control' },
        { id: 'p7', source: 'offset', target: 'search', kind: 'control' },
      ],
      steps: [
        {
          id: 'd1',
          title: 'Offset is a legitimate answer for small, stable lists',
          description:
            'A few hundred rows that do not change during browsing: offset costs nothing, gives page numbers for free, and rejecting it reflexively is its own mistake. The question is whether the dataset is small or still.',
          nodes: ['q', 'small', 'offset'],
          edges: ['p1', 'p3'],
        },
        {
          id: 'd2',
          title: 'Large or changing makes it a correctness problem',
          description:
            'Concurrent inserts shift positions, so a moving offset duplicates or skips rows with no error. For a job that must process each row exactly once, that is silent data loss rather than a slow page.',
          nodes: ['changing', 'keyset'],
          edges: ['p2', 'p4'],
        },
        {
          id: 'd3',
          title: 'The index is what makes the cursor fast, not the cursor',
          description:
            'A composite index over filter columns, sort key and tiebreaker turns the page into a range scan that seeks and reads twenty rows. Without it you have kept the extra complexity and lost the performance benefit entirely.',
          nodes: ['keyset', 'index'],
          edges: ['p5'],
        },
        {
          id: 'd4',
          title: 'Decide the count strategy and the filter surface deliberately',
          description:
            'hasMore instead of a count removes a full scan from every request. And every filter-and-sort combination you expose is a promise of an index — if consumers need arbitrary querying, that is a signal to move the read path, not to keep adding indexes.',
          nodes: ['count', 'search'],
          edges: ['p6', 'p7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Google Cloud APIs', 'DynamoDB'],
    body: `Two production conventions, arrived at independently, agree on the part that matters most.

**Google's API design guide** specifies list methods that take a \`page_size\` and a \`page_token\`, and return a \`next_page_token\`. The token is documented as **opaque**: clients pass it back and are told nothing about its contents. That single decision is the load-bearing one. It means the implementation behind a list endpoint can move from a database keyset scan to a search engine's scroll token to a distributed shard-aware cursor, and no consumer notices. Publish the structure and you have frozen your storage strategy into your public contract.

**DynamoDB** has no choice in the matter. There is no global ordering to offset into, so pagination is a \`LastEvaluatedKey\` returned by each query and passed to the next — a cursor by necessity rather than by design. Two consequences are instructive:

The store also returns a page when it hits a *size* limit rather than an item-count limit, so a caller can receive fewer items than requested with a continuation token still present. The correct loop condition is "continue while a token exists", never "continue while a full page was returned". That distinction catches people out in every cursor-based system and is worth internalising as a general rule.

And filtering is applied *after* the read, so a filtered query can consume its size budget scanning rows that are then discarded, returning an empty page with a token. A page with zero items is not the end of the results — which again means the token, not the item count, is the only reliable signal.

Two transferable lessons:

**Opacity is what buys you freedom.** Every cursor you expose the structure of is a mechanism you have committed to. The cheapest possible design decision — base64 a JSON object and document nothing — preserves the ability to change everything behind it.

**Termination is signalled by the token, not by the page.** Any client loop that decides it has finished because a page was short or empty will eventually truncate results. Make the API return an explicit \`nextCursor\` that is absent at the end, and the correct client loop becomes the obvious one.`,
  },

  tradeoffs: {
    intro:
      'Ordered from simplest to most capable. The first row is right more often than its reputation suggests, and the second is right whenever data changes.',
    rows: [
      {
        option: 'OFFSET / LIMIT',
        whenItWins:
          'Small bounded lists, immutable snapshots, and admin tools where jumping to an arbitrary page is genuinely wanted.',
        whenItLoses:
          'Large or changing datasets, and any job that must process every row exactly once.',
        cost:
          'Cost grows with depth, and concurrent inserts or deletes silently duplicate or skip rows with no error.',
      },
      {
        option: 'Keyset cursor over a total order',
        whenItWins:
          'Almost all production list endpoints: constant cost per page and immune to concurrent writes.',
        whenItLoses:
          'When the product genuinely requires jumping to page 57, or when many sort options each need their own index.',
        cost:
          'A composite index per supported sort, no page jumping, no cheap total count, and a cursor that must be invalidated when the sort changes.',
      },
      {
        option: 'Keyset plus a separate count endpoint',
        whenItWins:
          'When a total is genuinely needed but not on every request — a results header the user reads once.',
        whenItLoses:
          'Very large filtered sets where even one exact count is a full scan.',
        cost:
          'An extra round trip, and a count that can disagree with the paged results because they were computed at different moments.',
      },
      {
        option: 'Delegate to a search engine',
        whenItWins:
          'When consumers legitimately need arbitrary filter and sort combinations, faceting or relevance ranking.',
        whenItLoses:
          'Simple listing on a primary key or timestamp — you have added a second store and an ingestion pipeline for nothing.',
        cost:
          'A second copy of the data, an indexing pipeline, eventual consistency between the two, and a new failure domain.',
      },
      {
        option: 'Return everything, no pagination',
        whenItWins:
          'Genuinely bounded results — a user\'s saved addresses, a form\'s options. Simplest possible API.',
        whenItLoses:
          'The moment the bound turns out not to hold. "Users have at most a few" becomes a 40 MB response for one account.',
        cost:
          'An unbounded response size with no mechanism to discover the problem before a customer does.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We use OFFSET pagination. It is slow on deep pages but nobody goes that deep."',
      whyWeak:
        'It treats a correctness bug as a performance characteristic. On a changing dataset, offsets duplicate and skip rows on *every* page, not just deep ones, and no error is raised. If any consumer is a job iterating to process each row once, that is silent data loss.',
      strongAnswer:
        '"The depth cost is the smaller problem. Offsets are positions in a result set that keeps changing, so a concurrent insert shifts everything and a row is returned twice or skipped entirely — silently. I would use a keyset cursor over `(created_at, id)` with a matching index, and keep offset only for small stable lists."',
    },
    {
      weakAnswer: '"We paginate with `WHERE created_at < :lastSeen ORDER BY created_at DESC`."',
      whyWeak:
        '\`created_at\` is not unique. Several rows sharing a timestamp at a page boundary will be either skipped or repeated, because the database is free to order ties differently between queries. This is the same class of bug as offset drift, arrived at by a different route.',
      strongAnswer:
        '"The sort has to be a total order, so I would use `(created_at, id) < (:lastCreatedAt, :lastId)` as a row-value comparison with `ORDER BY created_at DESC, id DESC`. The primary key is the tiebreaker, and the index has to match the sort or the query sorts the whole filtered set on every page."',
    },
    {
      weakAnswer: '"The cursor is `{createdAt, id}` base64-encoded, and it is documented so clients can construct their own."',
      whyWeak:
        'Documenting the structure makes it a contract. You can no longer change the sort key, add a shard identifier, or move the read path to a different store without a breaking change — and clients constructing cursors by hand will construct invalid ones.',
      strongAnswer:
        '"The cursor is opaque: pass it back, and that is the whole contract. That is what lets me change the mechanism later — different sort key, shard-aware cursor, a search engine scroll token — without touching consumers. I would also encode the sort inside it so a cursor used with a different sort is rejected rather than silently wrong."',
    },
    {
      weakAnswer: '"Every list response includes `totalCount` so clients can render page numbers."',
      whyWeak:
        'An exact count over a filtered set is a full scan of the matching rows, paid on every request, for information most clients render once and most users ignore. It is often more expensive than fetching the page itself.',
      strongAnswer:
        '"I would return `hasMore` by default, which needs one extra row rather than a scan. If a total is genuinely required I would put it on a separate endpoint the client calls deliberately, and be explicit that it can disagree with the paged results because they were computed at different moments."',
    },
    {
      weakAnswer: '"Clients can filter and sort on any field — it gives them flexibility."',
      whyWeak:
        'Every filter and sort combination is a promise that you can serve it efficiently, and the number of combinations is the product of both. Some combination will have no usable index, will scan the table, and you will discover which one from a partner in production.',
      strongAnswer:
        '"I would expose a closed set of filter and sort combinations, each with a matching composite index, and reject anything else with a clear error. If consumers genuinely need arbitrary querying, that is a signal the read path belongs in a search engine built for it, rather than adding indexes reactively for every combination someone discovers."',
    },
    {
      weakAnswer: '"The client loops until it gets back fewer items than the page size."',
      whyWeak:
        'Many stores return a short or even empty page while more results remain — because a size budget was hit, or because filtering discarded rows after the read. A loop that terminates on a short page truncates results, silently and intermittently.',
      strongAnswer:
        '"The termination signal is the absence of a next cursor, never the page length. I would make the API omit `nextCursor` on the last page so the correct client loop is the obvious one, and I would return an empty page with a cursor when a filter discarded everything in that range."',
    },
  ],

  flashcards: [
    {
      id: 'fc-page-1',
      front: 'Why is OFFSET pagination a correctness bug, not just a performance issue?',
      back: 'An offset is a position in a result set that keeps changing. A concurrent insert shifts rows down so one is returned twice; a delete shifts them up so one is skipped. No error is raised.',
      topic: 'pagination',
    },
    {
      id: 'fc-page-2',
      front: 'What are the three requirements for correct keyset pagination?',
      back: 'A total order (unique tiebreaker in the sort), a row-value tuple comparison rather than hand-expanded conditions, and an index matching the sort so the page is a range scan.',
      topic: 'cursors',
    },
    {
      id: 'fc-page-3',
      front: 'Why is `ORDER BY created_at` alone insufficient for a cursor?',
      back: 'Timestamps are not unique, and the database may order ties differently between queries, so rows at a page boundary get skipped or repeated. Append the primary key as a tiebreaker.',
      topic: 'cursors',
    },
    {
      id: 'fc-page-4',
      front: 'Why must `(created_at, id) < ($1, $2)` be a tuple comparison?',
      back: 'Expanding it as `created_at <= $1 AND id < $2` wrongly excludes rows with earlier timestamps. Row-value comparison is standard SQL and expresses the intended ordering directly.',
      topic: 'cursors',
    },
    {
      id: 'fc-page-5',
      front: 'What does an opaque cursor buy you?',
      back: 'The freedom to change the pagination mechanism — sort key, shard awareness, a different store entirely — without a breaking change. Documenting its structure freezes your storage strategy into the public contract.',
      topic: 'api-design',
    },
    {
      id: 'fc-page-6',
      front: 'What does keyset pagination give up?',
      back: 'Jumping to an arbitrary page, a cheap total count, and cursor validity across a sort change. The first is usually acceptable; all three must be agreed rather than assumed.',
      topic: 'pagination',
    },
    {
      id: 'fc-page-7',
      front: 'Why is `totalCount` on every list response expensive?',
      back: 'An exact count over a filtered set is a full scan of matching rows, often costing more than fetching the page. `hasMore` needs one extra row instead.',
      topic: 'query-performance',
    },
    {
      id: 'fc-page-8',
      front: 'What is the correct termination condition for a paginating client loop?',
      back: 'The absence of a next cursor. A short or empty page does not mean the end — stores return partial pages when a size budget is hit or when filtering discards rows after the read.',
      topic: 'pagination',
    },
    {
      id: 'fc-page-9',
      front: 'What does each exposed filter-and-sort combination commit you to?',
      back: 'An index that serves it efficiently. The number of combinations is the product of filters and sorts, so an open surface guarantees some combination scans.',
      topic: 'indexes',
    },
    {
      id: 'fc-page-10',
      front: 'When is OFFSET the right choice?',
      back: 'Small bounded datasets, immutable or append-only snapshots, and admin tools where deep page jumping is genuinely wanted at low volume.',
      topic: 'pagination',
    },
  ],

  quiz: [
    {
      id: 'q-page-1',
      kind: 'scenario',
      prompt:
        'A reconciliation job pages through a growing `payments` table with `ORDER BY created_at DESC LIMIT 500 OFFSET n`. Finance reports that a small number of payments are missing from the reconciliation each night. What is happening?',
      options: [
        { id: 'a', label: 'Payments created during the run shift rows down, so each offset skips as many rows as were inserted before it' },
        { id: 'b', label: 'The job is timing out on deep pages and silently stopping early' },
        { id: 'c', label: 'A read replica is serving stale data' },
        { id: 'd', label: 'The LIMIT is too small for the volume' },
      ],
      correct: ['a'],
      explanation:
        'Sorting newest-first means new inserts land at position 0 and push everything down. An offset lands further into a longer list, skipping exactly the rows that shifted past it. Every query succeeds, so nothing surfaces — which is why this is discovered by finance rather than by monitoring.',
      difficulty: 'core',
      topic: 'pagination',
    },
    {
      id: 'q-page-2',
      kind: 'scenario',
      prompt:
        'A team switches to `WHERE created_at < :cursor ORDER BY created_at DESC LIMIT 50`. Bulk imports create hundreds of rows with identical timestamps, and users report occasional missing items. Why?',
      options: [
        { id: 'a', label: 'created_at is not unique, so ties at a page boundary are ordered arbitrarily and rows are skipped or repeated' },
        { id: 'b', label: 'The strict `<` should be `<=`' },
        { id: 'c', label: 'The index is missing and the query is scanning' },
        { id: 'd', label: 'The page size is too large for the import batch' },
      ],
      correct: ['a'],
      explanation:
        'A cursor requires a total order. With hundreds of rows sharing a timestamp, the database may order them differently between queries, so the boundary is ambiguous. The fix is a unique tiebreaker — `(created_at, id) < (:c, :i)` with a matching sort. Changing to `<=` would produce duplicates instead of skips.',
      difficulty: 'advanced',
      topic: 'cursors',
    },
    {
      id: 'q-page-3',
      kind: 'single',
      prompt: 'What does `LIMIT 20 OFFSET 100000` actually make the database do?',
      options: [
        { id: 'a', label: 'Read 100,020 rows in sort order and discard the first 100,000' },
        { id: 'b', label: 'Seek directly to row 100,000 using an index' },
        { id: 'c', label: 'Read only the 20 rows requested' },
        { id: 'd', label: 'Read the whole table and sort it once, cached for later pages' },
      ],
      correct: ['a'],
      explanation:
        'An offset is not a seekable position — the database must produce rows in order and count past the ones being skipped. This is why page cost grows linearly with depth, and why the first page is instant while the five-thousandth times out.',
      difficulty: 'intro',
      topic: 'query-performance',
    },
    {
      id: 'q-page-4',
      kind: 'scenario',
      prompt:
        'You want to move a list endpoint from a Postgres keyset scan to a search engine for better filtering. Cursors were documented as base64 of `{createdAt, id}`. What is the problem?',
      options: [
        { id: 'a', label: 'The cursor structure is a published contract, so changing the mechanism is a breaking change' },
        { id: 'b', label: 'Base64 is not a suitable encoding for search cursors' },
        { id: 'c', label: 'The search engine cannot sort by created_at' },
        { id: 'd', label: 'Clients would need to re-authenticate' },
      ],
      correct: ['a'],
      explanation:
        'Documenting the structure made it part of the contract, and some clients will be constructing cursors themselves. A search engine\'s continuation token has entirely different contents, so the migration cannot be transparent. An opaque cursor — pass it back, contents undocumented — is the cheapest possible decision that preserves this freedom.',
      difficulty: 'core',
      topic: 'api-design',
    },
    {
      id: 'q-page-5',
      kind: 'scenario',
      prompt:
        'A client pages a filtered query and stops when it receives fewer than the requested page size. It intermittently misses recent records. What is wrong?',
      options: [
        { id: 'a', label: 'A short page does not mean the end — the store hit a size budget or filtered rows after reading, and a cursor was still present' },
        { id: 'b', label: 'The page size is not being honoured by the server' },
        { id: 'c', label: 'The client should request larger pages' },
        { id: 'd', label: 'The filter should be applied client-side' },
      ],
      correct: ['a'],
      explanation:
        'Many stores return fewer items than requested while more results remain, because a scan-size limit was reached or post-read filtering discarded rows. The only reliable termination signal is the absence of a next cursor. This is a general property of cursor pagination, not a quirk of one database.',
      difficulty: 'advanced',
      topic: 'pagination',
    },
    {
      id: 'q-page-6',
      kind: 'multi',
      prompt:
        'Which of these are genuine costs of moving from offset to keyset pagination? Select all that apply.',
      options: [
        { id: 'a', label: 'You can no longer jump directly to an arbitrary page number' },
        { id: 'b', label: 'A total result count is no longer cheap' },
        { id: 'c', label: 'Each supported sort order needs its own composite index' },
        { id: 'd', label: 'Results become eventually consistent' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are real trade-offs worth naming when proposing the change. Consistency is unaffected — if anything keyset pagination is *more* consistent, because a cursor names a row rather than a position in a moving list.',
      difficulty: 'core',
      topic: 'pagination',
    },
  ],

  exercises: [
    {
      id: 'ex-page-1',
      kind: 'design',
      title: 'Redesign a list endpoint that is failing quietly',
      estimatedMinutes: 20,
      prompt: `An activity-feed endpoint serves a workspace collaboration product:

\`\`\`
GET /workspaces/{id}/activity?page=3&pageSize=50&sortBy=createdAt&order=desc
  → { "items": [...], "page": 3, "totalCount": 184203, "totalPages": 3685 }
\`\`\`

Facts:
- Active workspaces generate 20–200 activity rows per minute.
- The largest workspace has 40 million rows.
- Consumers: the web UI (infinite scroll), a mobile app (infinite scroll), and a partner export job that must retrieve every row exactly once.
- Product wants to add filtering by actor, by activity type, and by date range.
- Current p99 is 4 seconds and rising; support reports "duplicate items in the feed".

Produce:
1. The diagnosis for both symptoms, and which is more serious.
2. The redesigned endpoint contract.
3. The indexes required, and what they commit you to.
4. What you would tell the product team about the filtering request.
5. The migration plan given three existing consumers.`,
      rubric: [
        'Diagnoses the duplicates as offset drift from concurrent inserts, and identifies this as more serious than latency because the export job silently misses rows.',
        'Diagnoses the p99 as both deep OFFSET scans and the exact totalCount on every request.',
        'Redesigns with an opaque cursor and hasMore, dropping totalCount and totalPages from the default response.',
        'Uses a total order with a unique tiebreaker and a row-value comparison, not a bare timestamp.',
        'Specifies composite indexes with the workspace filter first, then the sort key, then the tiebreaker — and names the extra indexes each new filter requires.',
        'Tells product that each filter-and-sort combination is an index commitment, and offers a closed supported set rather than arbitrary combinations.',
        'Migration plan keeps the old parameters working while adding cursors, prioritises the export job, and uses telemetry rather than announcements to know when it is safe.',
      ],
      modelAnswer: `**1. Diagnosis**

*Duplicate items — offset drift.* With 20–200 inserts per minute and a newest-first sort, every new row pushes the list down. A user scrolling from page 3 to page 4 sees rows that moved across the boundary. This is expected behaviour for offset pagination on a changing dataset, not a bug in the code.

*p99 of 4 seconds — two causes.* Deep \`OFFSET\` scans (page 3,000 reads 150,000 rows to discard them), and \`COUNT(*)\` over 40 million filtered rows on **every single request**. The count is likely the larger term, and it is paid even on page 1.

**Which is more serious: the duplicates, decisively.** Latency is visible, measurable and annoying. The export job is silently missing rows — and because it sorts newest-first while rows are being inserted, it *skips* rather than duplicates. Nobody has reported that because there is no error and no obvious gap. It is a data-correctness failure in a partner-facing integration, discovered eventually by a partner.

**2. Redesigned contract**

\`\`\`
GET /workspaces/{id}/activity?limit=50&cursor={opaque}&type=comment&actorId=usr_x
  → {
      "items": [ ... ],
      "nextCursor": "eyJ2IjoxLCJzIjoiY3JlYXRlZF9hdDpkZXNjIiwiYyI6Ii4uLiJ9",
      "hasMore": true
    }
\`\`\`

- \`nextCursor\` **absent** on the last page, so the correct client loop is "while nextCursor exists".
- Cursor is opaque, and internally carries a version marker, the sort it was issued for, and the position tuple — so a cursor reused under a different sort is rejected with a clear error rather than silently returning wrong rows.
- \`totalCount\` and \`totalPages\` removed from the default response. Infinite scroll never needed them.
- Underlying query:

\`\`\`sql
SELECT ... FROM activity
WHERE workspace_id = $1
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT $4;
\`\`\`

**3. Indexes, and what they commit me to**

Base listing:
\`\`\`
(workspace_id, created_at DESC, id DESC)
\`\`\`

Each filter that must remain efficient needs the filter column ahead of the sort key:
\`\`\`
(workspace_id, activity_type, created_at DESC, id DESC)
(workspace_id, actor_id,      created_at DESC, id DESC)
\`\`\`

Date range needs no new index — it is a further restriction on \`created_at\`, which is already in the sort position, so it narrows the same range scan.

*What this commits me to:* four indexes on a 40-million-row table, each costing write amplification on the hottest insert path in the product. **Combining** filters (type *and* actor) would need a fifth. This is the cost that must be stated out loud, because it is paid on every insert forever.

**4. What I would tell product**

"Each filter-and-sort combination you expose is a promise that we can serve it efficiently, and each promise is an index that slows down every activity insert. Three filters that combine freely is seven index-worthy combinations, not three.

So: which combinations do users actually use? If it is 'type on its own' and 'actor on its own' with a date range narrowing either, that is two extra indexes and I can commit to it today. If you want arbitrary combinations plus text search plus faceted counts, that is a different system — the activity feed read path belongs in a search engine, and I would rather scope that deliberately than add an index every time a partner discovers a slow combination.

Also: dropping the total count removes 'Page 3,685 of 3,685' from the UI. For infinite scroll nobody misses it. If you want 'about 184,000 activities' as a header, I can serve an approximate count cheaply from table statistics — exact counts are a full scan and I would put those behind a separate call."

**5. Migration plan**

*Phase 1 — add, do not remove.* Support \`cursor\` alongside \`page\`. Both work. Return \`nextCursor\` on every response, including responses to \`page\`-based requests, so clients can adopt cursors incrementally without a coordinated switch.

*Phase 2 — fix the export job first.* It is the consumer with a correctness bug, and it is the one I control or can contact directly. One conversation, one change, and the data-loss problem is over. This is the highest-value step and it does not depend on anything else.

*Phase 3 — drop the count from the default response now.* Add \`?include=count\` for anyone who genuinely needs it. This is the fastest latency win available and it does not break clients that ignore extra fields — and if any client is *reading* \`totalCount\`, they get \`undefined\` and render nothing, which is the failure mode I would rather have than a 4-second p99.

*Phase 4 — migrate the two first-party clients.* Web and mobile both do infinite scroll, which maps onto cursors more naturally than onto page numbers, so this is a simplification for them rather than a cost.

*Phase 5 — deprecate \`page\`.* Add \`Deprecation\` and \`Sunset\` headers, watch per-consumer telemetry, and remove it when usage reaches zero. Given three known consumers, that is achievable — unlike the 40-partner case, where it would not be.

Ordering rationale: correctness before latency, the consumer I can reach before the ones I cannot, and additive changes before removals.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-page-1',
      level: 'basic',
      question: 'What is wrong with OFFSET pagination?',
      guidance:
        'A strong answer leads with the correctness problem — offsets are positions in a changing result set, so rows are duplicated or skipped silently — and treats the depth cost as secondary. A candidate who only mentions performance has missed the part that causes data loss.',
    },
    {
      id: 'iq-page-2',
      level: 'basic',
      question: 'How does keyset pagination work?',
      guidance:
        'Remember the last row, ask for rows after it in a defined order. Look for all three requirements: a unique tiebreaker for a total order, a tuple comparison, and a matching index. Missing the index means they have kept the complexity and lost the benefit.',
    },
    {
      id: 'iq-page-3',
      level: 'intermediate',
      question: 'Why should a cursor be opaque?',
      guidance:
        'Because documenting the structure makes the mechanism a contract, freezing the sort key, the storage engine and any future shard awareness. A strong answer notes it is the cheapest decision available — base64 a JSON blob, document nothing — and it preserves the ability to change everything behind it.',
    },
    {
      id: 'iq-page-4',
      level: 'intermediate',
      question: 'A client asks for a total result count on every page. What do you say?',
      guidance:
        'That an exact count over a filtered set is a full scan of matching rows, often more expensive than the page itself. Offer hasMore by default, an approximate count from statistics, or an exact count on a separate deliberate call. A strong answer notes a separately computed count can disagree with the page.',
    },
    {
      id: 'iq-page-5',
      level: 'advanced',
      question: 'Product wants filtering on five fields with sorting on three. What is your response?',
      guidance:
        'That each combination is an index commitment and the count is multiplicative, with write amplification on every insert. Look for a proposal of a closed supported set with clear rejection of the rest, and recognition that genuinely arbitrary querying is a signal to move the read path to a search engine rather than to keep adding indexes.',
    },
    {
      id: 'iq-page-6',
      level: 'advanced',
      question: 'How would you paginate across shards where no single global sort order exists?',
      guidance:
        'Query each shard with its own cursor, merge results in sort order, and carry a per-shard position inside the single opaque cursor. Strong answers note the fan-out cost and the need to over-fetch from each shard to guarantee a correct merged page — and that this is precisely the case an opaque cursor was protecting.',
    },
    {
      id: 'iq-page-7',
      level: 'followup',
      question: 'You said no page jumping. What if the product insists on page numbers?',
      guidance:
        'Options: keep offset for bounded datasets; cap the reachable depth and push users towards filtering; or precompute page boundaries for a stable snapshot. Strong answers ask what the user is actually trying to do — deep page jumping is nearly always a failed search — rather than accepting the requirement as stated.',
    },
    {
      id: 'iq-page-8',
      level: 'followup',
      question: 'A client reports missing records with your cursor API. Where do you look first?',
      guidance:
        'Whether their loop terminates on a short page rather than on the absence of a cursor — the most common client-side bug. Then whether the sort has a unique tiebreaker, and whether they changed the sort mid-pagination. A strong answer notes that making the API omit the cursor at the end is what makes the correct loop the obvious one.',
    },
  ],

  activeLearning: [
    {
      id: 'al-page-1',
      kind: 'what-changes-if',
      prompt:
        'Everything here assumed a single database with a global sort order. Now change one thing: the data is sharded across 16 nodes by `workspace_id`, and a new endpoint must list activity across *all* workspaces a user can see — potentially spanning every shard — sorted newest-first. What breaks, and what does a correct page look like?',
      discussion: `The cursor mechanism survives; the assumption that one cursor names one position does not.

**What breaks.** There is no global ordering to seek into. Each shard has its own \`(created_at, id)\` sequence, and "the 50 newest across all shards" is not a range on any single shard.

**What a correct page looks like: a scatter-gather merge.**

1. Ask each of the 16 shards for the newest 50 rows after *that shard's* cursor position.
2. Merge the 16 sorted streams, taking the 50 newest overall.
3. Return those 50, plus a cursor that carries **all 16 per-shard positions**.

The cursor is now a vector, not a scalar — and this is exactly the migration an opaque cursor was protecting. A published \`{createdAt, id}\` structure could not have absorbed it.

**The subtlety that catches people: how many to request per shard.** Asking each shard for 50 and merging is correct but wasteful — you fetch 800 rows to return 50. Asking for 50/16 ≈ 4 each is *wrong*: if all 50 newest rows happen to live on one shard, you cannot produce a correct page. The safe minimum is the full page size from every shard, because that is the worst case. Adaptive approaches track which shards have been contributing and over-fetch from those, which helps in practice and must still fall back to the safe bound.

**Second subtlety: cost scales with shard count.** A 50-row page costs 16 queries. At 256 shards it costs 256, and the page's latency becomes the *slowest* shard's latency — a tail-latency amplification problem where one slow node degrades every request. Mitigations: hedged requests, a timeout with partial results (and an explicit marker that the page is incomplete), or maintaining a separate materialised cross-workspace feed.

**The design question this really raises.** If cross-workspace listing is a core feature rather than an occasional admin view, scatter-gather on the primary store is the wrong architecture. The alternative is a **fan-out-on-write feed**: when activity is created, append a reference to each interested user's own feed, partitioned by user. Reads become a single-partition range scan; writes become N appends. That is the same read-versus-write trade-off that decides social feed design, and it is worth recognising here rather than discovering it at 256 shards.

**Transferable:** when a query crosses your partition key, you have three options — scatter-gather and pay on read, materialise a differently-partitioned copy and pay on write, or change the product so the query is not needed. Adding shards makes the first strictly worse, so the choice should be made deliberately rather than by growth.`,
    },
    {
      id: 'al-page-2',
      kind: 'debug',
      prompt:
        'A cursor-paginated API is reported to return duplicate items "sometimes, on the second page". The sort is `(created_at DESC, id DESC)` with a tuple comparison and a matching index. Reads go to a read replica. What is your leading hypothesis?',
      discussion: `The pagination logic is correct as described, so the bug is in something the logic assumes. Two candidates, and one is far more likely given the detail about replicas.

**Leading hypothesis: replica lag combined with load-balanced reads.**

Page 1 is served by replica A, which is 200 ms behind the primary. Page 2 is served by replica B, which is caught up. Rows committed in that window exist on B and not on A, so a row that was *not* returned on page 1 — because A had not seen it — now sits before the cursor position on B and appears on page 2. Or the reverse ordering of lag produces a skip.

The signature fits precisely: intermittent (depends on which replicas serve which request and how much lag exists at that moment), and concentrated at page boundaries (only rows near the cursor position are affected).

**Second hypothesis: the client is changing the sort between pages** and the cursor is not rejecting it. If the cursor does not encode the sort it was issued for, a page-2 request under a different sort produces a valid-looking query with meaningless results. Worth ruling out, and worth fixing structurally regardless.

**What to measure:**

1. **Which replica served each request**, exposed as a response header or logged with the request id. Without this, the hypothesis is untestable — and its absence is itself the finding.
2. **Replication lag at request time**, correlated with reported duplicates.
3. **Whether duplicates disappear when reads are pinned to the primary.** A decisive test, and cheap to run for one consumer.

**Fixes, in order of preference:**

*Session stickiness for a pagination sequence.* Pin all pages of one traversal to the same replica, by encoding a replica hint inside the opaque cursor. Cheap, and it makes the traversal internally consistent — which is what the user actually cares about.

*Read-your-writes via a consistency token.* Encode the primary's log position in the cursor and require the serving replica to have reached it, waiting briefly or falling back to the primary. Stronger, and adds latency.

*Snapshot the traversal.* For exports, take a consistent snapshot at the start and paginate within it. Strongest guarantee, and only viable for bounded traversals.

**The transferable lesson.** Cursor pagination guarantees a stable position *within a consistent view of the data*. Serving successive pages from different replicas breaks the "consistent view" half, and no amount of correctness in the SQL recovers it. Whenever a multi-request operation must see one coherent state, the routing of those requests is part of the correctness argument — not an infrastructure detail underneath it.`,
    },
  ],

  revision: {
    bullets: [
      'OFFSET means read-and-discard: cost grows linearly with depth, so page 1 is instant and page 5,000 times out.',
      'The worse problem is correctness: offsets are positions in a changing result set, so concurrent inserts duplicate rows and deletes skip them — silently.',
      'A job paginating by offset over a growing table skips roughly as many rows as were inserted during the run, with no error.',
      'Keyset pagination: remember the last row, ask for rows after it in a defined order.',
      'Three requirements: a total order with a unique tiebreaker, a row-value tuple comparison, and an index matching the sort.',
      '`ORDER BY created_at` alone is not a total order — ties at page boundaries get skipped or repeated.',
      '`(a, b) < ($1, $2)` is not `a <= $1 AND b < $2`; hand-expanding the tuple comparison is where the bugs are.',
      'Keyset gives up page jumping, cheap total counts, and cursor validity across a sort change.',
      'Cursors must be opaque. Publishing the structure freezes your sort key and your storage engine into the contract.',
      'Encode the sort and a version marker inside the cursor so a mismatched cursor is rejected rather than silently wrong.',
      'Return `hasMore`, not `totalCount`. An exact count over a filtered set is a full scan paid on every request.',
      'Terminate a client loop on the absence of a cursor, never on a short page — stores return partial pages while more results remain.',
      'Every filter-and-sort combination you expose is an index commitment, and the count is multiplicative.',
      'Genuinely arbitrary filtering is a signal to move the read path to a search engine, not to add indexes reactively.',
      'OFFSET is fine for small bounded lists, immutable snapshots and low-volume admin tools.',
      'Serving successive pages from different replicas breaks the consistent view a cursor depends on; pin the traversal.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The mechanism for returning a large result set in bounded chunks, plus the filtering and sorting surface that determines which chunks are even askable.',
    whyItExists:
      'Responses must be bounded and queries must be affordable, and both requirements interact with a dataset that is still changing while the client reads it.',
    whenToUse: [
      'Keyset cursors for any list that is large, changing, or consumed by a job that must see each row exactly once.',
      'OFFSET for small bounded lists, immutable snapshots and low-volume admin tools.',
      'A search engine when consumers genuinely need arbitrary filter and sort combinations.',
    ],
    whenNotToUse: [
      'Keyset when the product genuinely requires jumping to arbitrary page numbers and the dataset is small enough not to care.',
      'Exact total counts on every request — put them behind a deliberate separate call.',
      'No pagination at all, unless the bound is enforced rather than assumed.',
    ],
    alternatives: [
      'Fan-out-on-write into a per-consumer feed, turning a cross-partition read into a single-partition range scan.',
      'A search engine or a materialised read model when filtering flexibility is the actual requirement.',
      'A consistent snapshot for bounded exports, so the traversal sees one coherent state.',
    ],
    tradeoffs: [
      'OFFSET buys page jumping and costs depth-linear scans plus silent duplicates and skips.',
      'Keyset buys constant cost and correctness, and costs page jumping, cheap counts and an index per sort.',
      'Each exposed filter-and-sort combination buys consumer flexibility and costs write amplification forever.',
      'Scatter-gather across shards buys global ordering and costs fan-out plus tail-latency amplification.',
    ],
    failureModes: [
      'Offset drift duplicating or skipping rows with no error, discovered by reconciliation weeks later.',
      'A non-unique sort key producing ambiguous page boundaries.',
      'A hand-expanded tuple comparison excluding valid rows.',
      'A missing composite index making every page sort the whole filtered set.',
      'A client loop terminating on a short page and truncating results.',
      'A documented cursor structure blocking a change of storage engine.',
      'Successive pages served by replicas at different lag, breaking the consistent view.',
    ],
    followUpQuestions: [
      'Is the dataset changing while it is being paginated, and who is consuming it?',
      'Is your sort a total order, and which index serves it?',
      'What does your client loop use as its termination condition?',
      'How much does a total count cost, and who reads it?',
      'How many filter-and-sort combinations have you promised to serve?',
      'Do all pages of one traversal see the same view of the data?',
    ],
  },
});
