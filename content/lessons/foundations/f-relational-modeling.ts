import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-relational-modeling',
  title: 'Relational modelling and normalisation',
  summary:
    'Normalise to find where each fact belongs, then denormalise deliberately with an owner — because the cost of a wrong model is that two rows can disagree and neither is wrong.',
  phase: 'foundations',
  module: 'databases',
  position: 13,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['data-modeling', 'normalization', 'constraints', 'relational', 'schema-design'],
  prerequisites: ['f-api-contracts'],
  resources: [
    {
      key: 'ddia-book',
      tier: 'must',
      note: 'The chapter on data models and query languages. Read it for the argument that the relational model won because it hides access paths, not because it is more expressive.',
    },
    {
      key: 'postgres-json',
      tier: 'must',
      note: 'Read this to know exactly what a JSON column costs you: no constraints on its contents, no foreign keys into it, and no help from the planner unless you index expressions explicitly.',
    },
    {
      key: 'google-api-design-guide',
      tier: 'good',
      note: 'The resource-modelling chapter, as a reminder that your API model and your storage model are separate decisions that happen to be related.',
    },
    {
      key: 'postgres-explicit-locking',
      tier: 'advanced',
      note: 'Relevant once you notice that a uniqueness rule spanning several rows cannot be expressed as a constraint and needs either a lock or a different model.',
    },
  ],

  intuition: {
    body: `A schema is a set of claims about which facts exist and where each one lives. Get it wrong and you do not get an error — you get two places that can disagree.

Consider storing a customer's address on every order:

\`\`\`
orders(id, customer_id, customer_name, customer_address, total)
\`\`\`

This works. It is also a decision with consequences that will not surface for months. A customer moves house; you update it in one place; now 400 old orders say one thing and the customer record says another. Which is right?

Here is the trap: **both are right, and that is the problem.** The address on a shipped order is a historical fact — where it actually went. The address on the customer is a current fact — where they live now. Storing them in one column conflated two different facts, and no amount of careful updating fixes a model that cannot tell them apart.

Normalisation is the discipline of asking, for every piece of data, **what does this fact depend on?** The customer's current address depends on the customer. The address an order shipped to depends on the order. Those are different dependencies, so they are different columns in different tables — and once separated, updating one cannot corrupt the other.

That is the whole value. Not disk space, which stopped mattering decades ago. **Normalisation removes the possibility of contradiction**, because a fact stored once cannot disagree with itself.

The corollary matters just as much: when you later denormalise for performance, you are deliberately reintroducing that possibility, and you must say who owns the copy and how it gets rebuilt.`,
    analogyLimit:
      'Describing normalisation as "do not repeat yourself" is close and misleading: duplication of *data* is often fine, and the thing you must not duplicate is *authority*. Two rows holding the same address is harmless if exactly one of them is allowed to change it. The rule is about ownership, not repetition.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team stores order line items as a JSON array on the orders row: `items: [{sku, name, qty, price}]`. It ships fine. Name three queries or requirements that will be painful later, and say which one is the reason to change the model rather than work around it.',
      answer: `**1. "How many units of SKU-991 did we sell last quarter?"** With items inside JSON, this is a scan over every order in the period, unnesting each array. With a line-items table it is an indexed aggregation. Painful, and workable with a JSON index or a derived table.

**2. "Prevent ordering more than stock allows."** You cannot put a foreign key from inside a JSON array to the products table, so nothing stops an order referencing a SKU that does not exist. Validation moves into application code, where it is enforced by whichever code paths remember to.

**3. "Change the quantity of one line."** You read the whole array, modify it in memory, write it back. Two concurrent edits to different lines of the same order — one adding an item, one changing a quantity — and the last write wins, silently losing the other. This requires optimistic locking to be correct, and nothing warns you if you omit it.

**Which one forces a model change: the second.** Queries can be fixed with indexes or a derived read model. Concurrency can be fixed with a version column. But **referential integrity cannot be retrofitted onto a JSON array** — the database has no way to express it, so "every line item references a real product" becomes a property you hope your code maintains rather than one the database guarantees. Once that invariant is only in application code, every new code path is a chance to violate it, and violations are silent.

The general test: **JSON is fine for data nothing else references and nothing else constrains.** A line item is referenced (by inventory, by reporting) and constrained (product must exist, quantity must be positive). Those are columns, not a document.`,
    },
  body: `## Functional dependencies: the only question that matters

Normal forms are usually taught as a numbered ladder, which makes them feel like ceremony. The underlying question is simpler and you can apply it directly:

**For each column, what does its value depend on?**

If a column depends on the whole primary key and nothing else, it belongs. If it depends on something else, it belongs in the table about that something else.

\`\`\`
-- Wrong: customer_name depends on customer_id, not on order_id
orders(id PK, customer_id, customer_name, total)

-- Right
customers(id PK, name)
orders(id PK, customer_id FK, total)
\`\`\`

That single test covers the practical content of second and third normal form. The named forms are worth knowing so you can talk about them, but the working tool is the dependency question.

## The historical-versus-current distinction

The most common real modelling error is not redundancy — it is conflating a *current* fact with a *historical* one. Both look like the same column.

\`\`\`
-- These are different facts and need different homes
customers(id, current_address)          -- where they live now
orders(id, shipped_to_address)          -- where this order actually went
order_lines(id, unit_price_at_purchase) -- what it cost then, not now
\`\`\`

The order's shipping address is not denormalised duplication of the customer's address. It is a **snapshot**, and it is correct that it does not change when the customer moves. Likewise the price on a line item: if you join to \`products.price\` at read time, last year's invoices silently change when you run a sale.

The test: **would this value be wrong if the source changed?** If yes, copy it at the time of the event. That is not denormalisation; it is recording what happened.

## Keys and identity

**Natural key** — something meaningful: an email address, an ISBN. Zero extra columns, and it commits you to that value never changing. Email addresses change. Country codes get reassigned. Any natural key you pick will eventually need to change for some row, and then every foreign key referencing it must change too.

**Surrogate key** — a meaningless generated identifier. One extra column, and identity is stable regardless of what happens to the data. Use surrogate keys for anything referenced by other tables, and enforce the natural uniqueness as a *unique constraint* rather than as the key. That gives you both properties: stable identity and a guaranteed-unique email.

**Composite keys** are correct for join tables representing a relationship: \`enrollments(student_id, course_id)\` with both columns as the primary key states the rule "a student enrols in a course at most once" as a schema fact.

## Relationships

**One-to-many** — a foreign key on the many side. Uncontroversial.

**Many-to-many** — a join table. The interesting decision is whether the relationship has its own attributes. \`enrollments(student_id, course_id, enrolled_at, grade)\` shows the relationship is an entity in its own right, which is common and worth noticing early: if you find yourself wanting to attach data to a join table, it was never a pure join table.

**One-to-one** — usually a mistake, sometimes deliberate. Legitimate reasons: separating rarely-read large columns from a hot row, or separating data with different access-control requirements. Illegitimate reason: because the object model had two classes.

## Constraints are the cheapest correctness you will ever buy

A constraint is an invariant the database enforces on every write, through every code path, including the migration script somebody runs by hand at 2am.

\`\`\`sql
CREATE TABLE order_lines (
  id          bigint PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  bigint NOT NULL REFERENCES products(id),
  quantity    int    NOT NULL CHECK (quantity > 0),
  unit_price  bigint NOT NULL CHECK (unit_price >= 0),
  UNIQUE (order_id, product_id)
);
\`\`\`

Every line there is a rule that cannot be violated by any application, script or human:

- \`NOT NULL\` — "unknown" is not a valid state for this column.
- \`REFERENCES\` — the referenced row exists, and cannot be deleted out from under this one.
- \`CHECK\` — a domain rule. Negative quantities are not a thing.
- \`UNIQUE (order_id, product_id)\` — the same product appears at most once per order.

The alternative is enforcing these in application code, where the guarantee is "every code path that a developer remembered". Constraints are enforced by the one component that sees every write.

**What constraints cannot express** is worth knowing precisely, because it tells you when you need something else: rules spanning multiple rows ("at most one primary address per customer" needs a partial unique index; "total of lines equals order total" needs a trigger or a transaction that recomputes), and rules referencing other tables' aggregate state. When you hit one of those, the honest options are a partial index, a trigger, or accepting that this invariant lives in one carefully guarded code path.

## When to denormalise

Denormalise when you have measured a read cost you cannot pay, and then only with three things written down:

1. **An owner** — exactly one code path that writes the derived value.
2. **A rebuild path** — a way to recompute it from the source of truth, because it will drift.
3. **A staleness budget** — how wrong it is allowed to be, and for how long.

Without those three, a denormalised column is not an optimisation; it is a second source of truth that nobody is responsible for. And the practical point: **you will not know what to denormalise until you have query patterns**, which means the normalised model is the right starting point even when you expect to move off it.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'dependency-test',
      title: 'The dependency question, applied',
      caption:
        'Follow each column down. Note that `shipped_to_address` and `unit_price_at_purchase` end at "keep the copy" — they are snapshots of historical fact, not redundancy, and normalising them away would be a bug.',
      code: `flowchart TD
    A["For this column, what does its value depend on?"] --> B{Depends on this row's<br/>primary key alone?}
    B -->|Yes| C[It belongs here]
    B -->|No| D{Depends on another<br/>entity's identity?}

    D -->|Yes| E{Is it a current fact<br/>or a historical one?}
    E -->|Current| F["Move it to that entity's table<br/>customers.current_address"]
    E -->|Historical| G["Keep the copy — it is a snapshot<br/>orders.shipped_to_address<br/>order_lines.unit_price_at_purchase"]

    D -->|No, it is derived| H{Measured a read cost<br/>you cannot pay?}
    H -->|No| I[Compute it on read]
    H -->|Yes| J["Denormalise, and write down:<br/>owner, rebuild path,<br/>staleness budget"]

    style C fill:#17272a,stroke:#35897e
    style F fill:#17272a,stroke:#35897e
    style G fill:#1c1814,stroke:#c99a4e
    style J fill:#2a1d1d,stroke:#b8383b`,
    },
    {
      kind: 'flow',
      id: 'orders-model',
      title: 'One model, and where each invariant is enforced',
      caption:
        'Select each node. The point to notice is that every rule shown is enforced by the database rather than by application code — which means it holds for the migration script somebody runs by hand, too.',
      nodes: [
        { id: 'cust', label: 'customers', kind: 'store', x: 0, y: 40, detail: 'id (surrogate PK), email UNIQUE, current_address. The email is unique but not the key: identity must survive a customer changing their email address.' },
        { id: 'addr', label: 'addresses', kind: 'store', x: 0, y: 200, detail: 'Separated because a customer has several and one is primary. "At most one primary" cannot be a CHECK — it needs a partial unique index on (customer_id) WHERE is_primary.' },
        { id: 'orders', label: 'orders', kind: 'store', x: 240, y: 110, detail: 'customer_id FK, plus shipped_to_address as a snapshot. That snapshot is deliberate: an order that shipped somewhere must not change when the customer moves.' },
        { id: 'lines', label: 'order_lines', kind: 'store', x: 490, y: 110, detail: 'order_id FK ON DELETE CASCADE, product_id FK, quantity CHECK > 0, unit_price snapshot, UNIQUE (order_id, product_id). Five invariants, all enforced by the database.' },
        { id: 'prod', label: 'products', kind: 'store', x: 730, y: 40, detail: 'Current price lives here. Line items do not join to it at read time — otherwise last year\'s invoices change during a sale.' },
        { id: 'json', label: 'metadata (jsonb)', kind: 'note', x: 730, y: 220, detail: 'Legitimate JSON: caller-supplied tags nothing else references and nothing else constrains. The moment something needs a foreign key into it, it stops being a document.' },
      ],
      edges: [
        { id: 'm1', source: 'cust', target: 'orders', label: 'customer_id', kind: 'read' },
        { id: 'm2', source: 'cust', target: 'addr', label: 'customer_id', kind: 'read' },
        { id: 'm3', source: 'orders', target: 'lines', label: 'order_id, cascade', kind: 'write' },
        { id: 'm4', source: 'prod', target: 'lines', label: 'product_id', kind: 'read' },
        { id: 'm5', source: 'orders', target: 'json', label: 'optional', kind: 'control' },
      ],
      steps: [
        {
          id: 'r1',
          title: 'Surrogate keys, with natural uniqueness as a constraint',
          description:
            'Customers get a generated id, and email gets a UNIQUE constraint. That buys both properties: identity survives an email change, and duplicate emails are still impossible. Making email the key would mean every referencing row changes when it does.',
          nodes: ['cust', 'orders'],
          edges: ['m1'],
        },
        {
          id: 'r2',
          title: 'Snapshots are not redundancy',
          description:
            'shipped_to_address and unit_price are copied at the time of the event on purpose. Joining to the live customer or product at read time would silently rewrite history whenever an address or a price changed.',
          nodes: ['orders', 'lines', 'prod'],
          edges: ['m4'],
        },
        {
          id: 'r3',
          title: 'Five invariants the database enforces on order_lines',
          description:
            'Foreign keys to orders and products, a cascade so lines cannot outlive their order, a check that quantity is positive, and uniqueness per product per order. None of these can be bypassed by a code path that forgot.',
          nodes: ['lines'],
          edges: ['m3'],
        },
        {
          id: 'r4',
          title: 'And the two things constraints cannot do',
          description:
            '"At most one primary address" spans rows, so it needs a partial unique index. "Order total equals the sum of its lines" spans tables, so it needs a trigger or a transaction that recomputes. Knowing which rules fall outside constraints is what tells you where to be careful.',
          nodes: ['addr', 'json'],
          edges: ['m2', 'm5'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The clearest production illustration of this lesson is the pattern every mature order or invoice system converges on, and the reason it converges is instructive.

New systems almost always start by joining to live reference data: an invoice line shows the product name and price by joining to \`products\`. It is normalised, it has no duplication, and it is correct on day one.

Then one of three things happens.

**A price change rewrites history.** A sale runs, and every historical invoice now shows the sale price. Accounting reconciliation fails against payment records that captured the original amount. The invoice was never wrong — the model was, because it treated "the price of this product" and "the price this customer paid" as one fact.

**A product is renamed or delisted.** Invoices from three years ago now reference a product name that does not describe what was bought, or a row that has been soft-deleted and is filtered out of joins.

**A tax rate changes.** Every historical total silently becomes inconsistent with the amount actually charged.

The fix is always the same: at the moment of the event, **copy the values that describe what happened** — product name as it was, unit price as charged, tax rate as applied — into the line item. Keep the foreign key to the product for reporting and navigation, and stop reading current values for historical facts.

This looks like denormalisation and is not. There is no derived-data problem here, no owner to nominate, no rebuild path, no staleness budget, because the copied values are **not supposed to track the source**. They are the record of a transaction.

Two transferable lessons:

**"Never duplicate data" is the wrong rule.** The right question is whether two locations claim authority over the same fact. A snapshot claims authority over a different fact — what was true then — and duplication is how you express that.

**Immutable records need immutable inputs.** Any row representing something that *happened* — a payment, a shipment, an audit entry, an emitted event — must contain everything needed to interpret it, because everything it points at is free to change. Systems that learn this late discover it through a reconciliation failure rather than through a design review.`,
  },

  tradeoffs: {
    intro:
      'The axis is how much the schema enforces versus how much the application does. Rows are ordered from most database-enforced to least.',
    rows: [
      {
        option: 'Fully normalised with constraints and foreign keys',
        whenItWins:
          'Almost always as a starting point. Contradiction becomes impossible, invariants hold through every code path, and you learn the real query patterns before optimising.',
        whenItLoses:
          'Read paths needing many joins at high volume, and write paths where foreign-key checks on a very hot table become measurable.',
        cost:
          'Joins on read, and referential checks on write. Both are usually smaller than assumed and both are measurable before you act.',
      },
      {
        option: 'Normalised plus deliberate snapshots of historical facts',
        whenItWins:
          'Any system recording events: orders, invoices, payments, shipments, audit logs. Correctness, not optimisation.',
        whenItLoses:
          'Nowhere. Omitting the snapshot is the bug, not the other way round.',
        cost:
          'Extra columns, and the discipline to populate them at write time rather than joining at read time.',
      },
      {
        option: 'Denormalised derived columns',
        whenItWins:
          'A measured read cost you cannot pay, where the derived value has a named owner, a rebuild path and a stated staleness budget.',
        whenItLoses:
          'When adopted pre-emptively. You then have a second source of truth for queries you have not confirmed anyone runs.',
        cost:
          'Guaranteed eventual drift, a rebuild job somebody must maintain, and every writer having to remember the copy.',
      },
      {
        option: 'JSON columns for structured data',
        whenItWins:
          'Data nothing else references and nothing else constrains: caller-supplied metadata, sparse attributes, a captured third-party payload.',
        whenItLoses:
          'As soon as something needs a foreign key into it, a uniqueness rule over it, or an aggregate across rows.',
        cost:
          'No referential integrity, no constraints on contents, read-modify-write concurrency hazards, and query plans that need explicit expression indexes.',
      },
      {
        option: 'Schema-less: one wide table or a document per aggregate',
        whenItWins:
          'A single well-known access pattern, or an exploratory prototype where the model is still moving daily.',
        whenItLoses:
          'The moment a second access pattern appears, or a second writer, or a reporting requirement.',
        cost:
          'Every invariant becomes application code, and every new code path is a chance to violate one silently.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We store the customer name and address on the order so we do not need a join."',
      whyWeak:
        'It conflates two different facts under one heading. If those columns are meant to be the customer\'s current details, they are duplication that will drift. If they are meant to be where the order shipped, they are correct but the reasoning given — avoiding a join — is not why, and the team will "fix" them later by joining.',
      strongAnswer:
        '"The order carries a snapshot of the shipping address, because an order that shipped somewhere must not change when the customer moves — that is recording what happened. The customer\'s current address stays on the customer. Those are different facts, and the join avoidance is incidental."',
    },
    {
      weakAnswer: '"We keep line items as a JSON array on the order — it is one row and one write."',
      whyWeak:
        'You have given up the ability to express that a line references a real product, that quantity is positive, and that a product appears at most once per order. Those move into application code where they hold only for the paths that remember. Concurrent edits to different lines also lose one silently unless you add optimistic locking.',
      strongAnswer:
        '"Line items need a foreign key to products, a positive-quantity check, and uniqueness per order — none of which a JSON array can express. They go in their own table. I would keep JSON for genuinely unstructured caller-supplied metadata that nothing else references or constrains."',
    },
    {
      weakAnswer: '"Email is the primary key — it is unique and meaningful."',
      whyWeak:
        'It commits every referencing row to that value never changing, and email addresses change. When one does, every foreign key must be updated in the same transaction, and any external system that stored the old value now points at nothing.',
      strongAnswer:
        '"A generated surrogate key for identity, plus a UNIQUE constraint on email. That gives stable identity and still makes duplicate emails impossible. Natural keys are a good uniqueness rule and a poor identity, because identity has to survive the data changing."',
    },
    {
      weakAnswer: '"We enforce the rules in the service layer, which keeps the database simple."',
      whyWeak:
        'It means the rules hold only for code paths a developer remembered — and not for the migration script, the data-fix job, the admin tool, or the second service that gets added later. Constraints are the only enforcement that sees every write.',
      strongAnswer:
        '"Anything the database can express belongs in the schema: not-null, foreign keys, check constraints, unique constraints. The service layer adds the rules the database cannot express, and I would name those explicitly — cross-row and cross-table invariants — because those are the ones that need care."',
    },
    {
      weakAnswer: '"We denormalised the order total onto the order for reporting performance."',
      whyWeak:
        'Possibly right, and incomplete. A derived column without a named owner, a rebuild path and a staleness budget is a second source of truth nobody is responsible for — and it will drift, because some code path will update lines without updating the total.',
      strongAnswer:
        '"If the aggregation is measurably too slow, I would denormalise — and write down that the order service is the only writer, that a nightly job recomputes and reports mismatches, and that the tolerance is zero because it is money. Without those three, the column is a bug waiting for a reconciliation to find it."',
    },
  ],

  flashcards: [
    {
      id: 'fc-rel-1',
      front: 'What does normalisation actually buy you?',
      back: 'It removes the possibility of contradiction: a fact stored once cannot disagree with itself. Disk space stopped being the reason decades ago.',
      topic: 'normalization',
    },
    {
      id: 'fc-rel-2',
      front: 'What is the one question that replaces memorising normal forms?',
      back: 'For each column, what does its value depend on? If it depends on this row\'s key alone, it belongs here; otherwise it belongs with the entity it depends on.',
      topic: 'normalization',
    },
    {
      id: 'fc-rel-3',
      front: 'Why is an order\'s shipping address not denormalisation?',
      back: 'It is a snapshot of a historical fact — where the order actually went. It is correct that it does not change when the customer moves, so there is no owner or rebuild path to define.',
      topic: 'data-modeling',
    },
    {
      id: 'fc-rel-4',
      front: 'What is the test for whether to copy a value at write time?',
      back: 'Would this value be wrong if the source changed? If yes, it is a historical fact and must be captured, not joined.',
      topic: 'data-modeling',
    },
    {
      id: 'fc-rel-5',
      front: 'Surrogate key or natural key, and how do you get both benefits?',
      back: 'Surrogate key for identity, so it survives the data changing. Enforce the natural uniqueness as a UNIQUE constraint rather than as the key.',
      topic: 'schema-design',
    },
    {
      id: 'fc-rel-6',
      front: 'Why are constraints the cheapest correctness available?',
      back: 'They are enforced by the one component that sees every write — including migration scripts, admin tools and services added later. Application rules hold only for the paths someone remembered.',
      topic: 'constraints',
    },
    {
      id: 'fc-rel-7',
      front: 'Name two kinds of invariant a constraint cannot express.',
      back: 'Rules spanning multiple rows ("at most one primary address per customer" — needs a partial unique index) and rules spanning tables ("order total equals the sum of its lines" — needs a trigger or a recomputing transaction).',
      topic: 'constraints',
    },
    {
      id: 'fc-rel-8',
      front: 'When is a JSON column the right choice?',
      back: 'When nothing else references the data and nothing else constrains it: caller-supplied metadata, sparse attributes, a captured third-party payload.',
      topic: 'schema-design',
    },
    {
      id: 'fc-rel-9',
      front: 'What can you never retrofit onto data stored inside a JSON array?',
      back: 'Referential integrity. The database cannot express a foreign key from inside a document, so "every line references a real product" becomes a property you hope your code maintains.',
      topic: 'relational',
    },
    {
      id: 'fc-rel-10',
      front: 'What three things must accompany every denormalised column?',
      back: 'An owner (exactly one writer), a rebuild path (recompute from the source of truth), and a staleness budget (how wrong, for how long).',
      topic: 'data-modeling',
    },
    {
      id: 'fc-rel-11',
      front: 'What does it mean when you want to add columns to a join table?',
      back: 'The relationship is an entity in its own right — enrolments have a grade and a date. It was never a pure join table, and modelling it as one hides a real thing.',
      topic: 'relational',
    },
    {
      id: 'fc-rel-12',
      front: 'What must any row representing something that happened contain?',
      back: 'Everything needed to interpret it, because everything it points at is free to change. Payments, shipments, audit entries and emitted events all need their inputs captured.',
      topic: 'data-modeling',
    },
  ],

  quiz: [
    {
      id: 'q-rel-1',
      kind: 'scenario',
      prompt:
        'Invoice lines join to `products` for name and price at render time. A sale reduces prices by 20%. Finance reports that historical invoices no longer match the payments received. What is the root cause?',
      options: [
        { id: 'a', label: 'The model treats "the product\'s price" and "the price this customer paid" as one fact' },
        { id: 'b', label: 'The join is using a stale read replica' },
        { id: 'c', label: 'The invoice totals were cached and the cache was not invalidated' },
        { id: 'd', label: 'The products table is missing a version column' },
      ],
      correct: ['a'],
      explanation:
        'Two different facts were conflated. The current price belongs to the product; the price charged belongs to the invoice line and must be captured at the moment of sale. This is not an optimisation — joining to live reference data for a historical record silently rewrites history whenever the reference changes.',
      difficulty: 'core',
      topic: 'data-modeling',
    },
    {
      id: 'q-rel-2',
      kind: 'scenario',
      prompt:
        'Order line items are stored as a JSON array on the order row. A reporting requirement arrives: "units sold per SKU per month". A second arrives: "reject orders referencing delisted products". Which is the reason to change the model?',
      options: [
        { id: 'a', label: 'The second — referential integrity cannot be expressed from inside a JSON array, so the rule can only live in application code' },
        { id: 'b', label: 'The first — aggregation over JSON is impossible' },
        { id: 'c', label: 'Neither; both can be solved with a JSON index' },
        { id: 'd', label: 'Both equally, since they both require unnesting' },
      ],
      correct: ['a'],
      explanation:
        'Aggregation over JSON is slow but solvable with expression indexes or a derived read model. A foreign key from inside a document is not expressible at all, so the invariant moves into whichever code paths remember it — and violations are silent. Queries can be worked around; integrity cannot.',
      difficulty: 'advanced',
      topic: 'relational',
    },
    {
      id: 'q-rel-3',
      kind: 'single',
      prompt: 'Why prefer a surrogate primary key over a natural one for a referenced entity?',
      options: [
        { id: 'a', label: 'Identity must survive the data changing; a natural key propagates every change to all referencing rows' },
        { id: 'b', label: 'Surrogate keys are smaller and index better' },
        { id: 'c', label: 'Natural keys cannot be made unique' },
        { id: 'd', label: 'Surrogate keys prevent duplicate records' },
      ],
      correct: ['a'],
      explanation:
        'Stability of identity is the reason. Index size is a minor secondary benefit, natural keys can obviously be unique — that is what a UNIQUE constraint is for — and a surrogate key does nothing to prevent duplicates on its own.',
      difficulty: 'intro',
      topic: 'schema-design',
    },
    {
      id: 'q-rel-4',
      kind: 'scenario',
      prompt:
        'A requirement states: "each customer has at most one primary address". Where does this belong?',
      options: [
        { id: 'a', label: 'A partial unique index on (customer_id) WHERE is_primary — a CHECK constraint cannot see other rows' },
        { id: 'b', label: 'A CHECK constraint on the addresses table' },
        { id: 'c', label: 'Application code in the address service' },
        { id: 'd', label: 'A NOT NULL constraint on customers.primary_address_id' },
      ],
      correct: ['a'],
      explanation:
        'A CHECK constraint evaluates one row at a time and cannot know about siblings. A partial unique index expresses exactly this rule and is enforced on every write. Option (d) is a legitimate alternative model — a pointer from the customer — but it makes "the pointed-at address belongs to this customer" the rule that now needs enforcing.',
      difficulty: 'advanced',
      topic: 'constraints',
    },
    {
      id: 'q-rel-5',
      kind: 'scenario',
      prompt:
        'A team proposes denormalising `order_total` onto `orders` because a reporting query is slow. What must be agreed before shipping it?',
      options: [
        { id: 'a', label: 'A single owning writer, a rebuild job that detects mismatches, and a stated tolerance for drift' },
        { id: 'b', label: 'An index on the new column' },
        { id: 'c', label: 'A trigger to keep it updated automatically' },
        { id: 'd', label: 'Nothing — it is derived from data already in the database' },
      ],
      correct: ['a'],
      explanation:
        'A derived column is a second source of truth, and it will drift when some code path updates lines without updating the total. Owner, rebuild path and staleness budget make it a managed copy rather than an unowned liability. A trigger is one valid implementation of the owner, not a substitute for deciding who owns it.',
      difficulty: 'core',
      topic: 'data-modeling',
    },
    {
      id: 'q-rel-6',
      kind: 'multi',
      prompt:
        'Which of these are legitimate reasons to split data into a one-to-one related table? Select all that apply.',
      options: [
        { id: 'a', label: 'Large rarely-read columns are slowing down access to a hot row' },
        { id: 'b', label: 'Part of the data has different access-control requirements' },
        { id: 'c', label: 'The object model has two classes' },
        { id: 'd', label: 'The row has more than twenty columns' },
      ],
      correct: ['a', 'b'],
      explanation:
        'Separating cold bulk columns from a hot row is a real physical-layout optimisation, and separating differently-classified data lets you grant access at table granularity. Mirroring the object model is not a storage argument, and a column count is not a problem in itself.',
      difficulty: 'core',
      topic: 'schema-design',
    },
  ],

  exercises: [
    {
      id: 'ex-rel-1',
      kind: 'design',
      title: 'Find the modelling bugs before they ship',
      estimatedMinutes: 22,
      prompt: `Review this proposed schema for a gym-membership system.

\`\`\`sql
CREATE TABLE members (
  email          text PRIMARY KEY,
  name           text,
  plan_name      text,
  plan_price      numeric,
  home_gym_name  text,
  joined_on      date
);

CREATE TABLE bookings (
  id             bigserial PRIMARY KEY,
  member_email   text,
  class_name     text,
  instructor     text,
  gym_name       text,
  booked_at      timestamptz,
  attendance     jsonb   -- {"attended": true, "checked_in_at": "..."}
);

CREATE TABLE payments (
  id             bigserial PRIMARY KEY,
  member_email   text,
  amount         numeric,
  paid_at        timestamptz
);
\`\`\`

Facts: members change email addresses; plan prices change annually; a member's home gym can change; classes are cancelled and rescheduled; finance reconciles payments against plan prices.

Produce:
1. Every modelling defect, and for each say whether it causes silent wrongness or only inconvenience.
2. The corrected schema with constraints.
3. Which values are snapshots and which are references, with the reasoning.
4. One invariant your corrected schema still cannot enforce, and what you would do about it.`,
      rubric: [
        'Identifies email as primary key as the most serious structural defect, since members change email and every referencing row must change with it.',
        'Identifies plan_price on members as conflating current plan price with the price this member pays, and links it to the finance reconciliation failure.',
        'Identifies plan_name, home_gym_name, class_name, instructor and gym_name as denormalised text where foreign keys belong, so no integrity is enforced.',
        'Identifies numeric/float money and prescribes integer minor units with a currency.',
        'Identifies attendance in JSON as data that is queried and constrained, so it belongs in columns.',
        'Corrected schema uses surrogate keys with a UNIQUE constraint on email, and real foreign keys with NOT NULL and CHECK constraints.',
        'Distinguishes snapshots (amount paid, price charged, gym at time of booking) from references (member, class, plan) with reasoning about historical versus current facts.',
        'Names a genuine unenforceable invariant — class capacity, or one active membership per member — and proposes a partial unique index, a constraint trigger or a guarded code path.',
      ],
      modelAnswer: `**1. Defects**

| Defect | Consequence |
| --- | --- |
| \`email\` as primary key | **Silent wrongness.** A member changes email; either every referencing row must be updated in the same transaction, or bookings and payments orphan. Any external system holding the old email now points at nothing. |
| \`plan_price\` on members | **Silent wrongness.** This is either the plan's current price (duplicated from a plan we do not have) or the price this member pays (which must be captured when they signed up). Conflating them is why finance reconciliation fails. |
| \`plan_name\`, \`home_gym_name\`, \`class_name\`, \`instructor\`, \`gym_name\` as text | **Silent wrongness.** Nothing enforces that these refer to anything real. A typo creates a new gym. Renaming a gym updates nothing. Reporting by gym silently splits across spellings. |
| \`numeric\` money without currency | **Silent wrongness.** No currency at all, and if the column is ever read into a float, reconciliation drifts by rounding. |
| \`attendance\` as JSON | **Inconvenience, escalating.** It is queried ("attendance rate per class") and constrained ("checked in only if attended"). Both belong in columns. |
| No NOT NULL, no foreign keys, no CHECKs anywhere | **Silent wrongness.** Every invariant is application-only, so it holds for the paths someone remembered. |
| No class *instances* | **Silent wrongness.** A booking references a class name, not a specific occurrence at a specific time. Rescheduling or cancelling one session cannot be represented, and two bookings for different weeks look identical. |

**2. Corrected schema**

\`\`\`sql
CREATE TABLE gyms (
  id    bigint PRIMARY KEY,
  name  text NOT NULL
);

CREATE TABLE plans (
  id             bigint PRIMARY KEY,
  name           text NOT NULL,
  price_minor    bigint NOT NULL CHECK (price_minor >= 0),
  currency       char(3) NOT NULL,
  effective_from date NOT NULL
);

CREATE TABLE members (
  id           bigint PRIMARY KEY,
  email        text NOT NULL UNIQUE,
  name         text NOT NULL,
  home_gym_id  bigint NOT NULL REFERENCES gyms(id),
  joined_on    date NOT NULL
);

CREATE TABLE memberships (
  id                bigint PRIMARY KEY,
  member_id         bigint NOT NULL REFERENCES members(id),
  plan_id           bigint NOT NULL REFERENCES plans(id),
  price_minor       bigint NOT NULL CHECK (price_minor >= 0),  -- snapshot
  currency          char(3) NOT NULL,                          -- snapshot
  started_on        date NOT NULL,
  ended_on          date,
  CHECK (ended_on IS NULL OR ended_on >= started_on)
);

CREATE TABLE class_sessions (
  id             bigint PRIMARY KEY,
  gym_id         bigint NOT NULL REFERENCES gyms(id),
  class_name     text NOT NULL,
  instructor_id  bigint NOT NULL REFERENCES instructors(id),
  starts_at      timestamptz NOT NULL,
  capacity       int NOT NULL CHECK (capacity > 0),
  cancelled_at   timestamptz
);

CREATE TABLE bookings (
  id               bigint PRIMARY KEY,
  member_id        bigint NOT NULL REFERENCES members(id),
  class_session_id bigint NOT NULL REFERENCES class_sessions(id),
  booked_at        timestamptz NOT NULL DEFAULT now(),
  attended         boolean,
  checked_in_at    timestamptz,
  UNIQUE (member_id, class_session_id),
  CHECK (checked_in_at IS NULL OR attended IS TRUE)
);

CREATE TABLE payments (
  id             bigint PRIMARY KEY,
  member_id      bigint NOT NULL REFERENCES members(id),
  membership_id  bigint NOT NULL REFERENCES memberships(id),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  currency       char(3) NOT NULL,
  paid_at        timestamptz NOT NULL
);
\`\`\`

The \`memberships\` table is the substantive addition. A member's plan history is a sequence, not a column — which is what makes "what were they paying in March" answerable at all.

**3. Snapshots versus references**

*Snapshots (captured at the event, must not track the source):*
- \`memberships.price_minor\` and \`currency\` — what this member agreed to pay. A plan price change must not alter existing memberships, and this is the column finance reconciles against.
- \`payments.amount_minor\` and \`currency\` — what was actually charged. Immutable by definition.

*References (current facts, correctly followed):*
- \`members.home_gym_id\` — where they train now. Should change when they move.
- \`bookings.class_session_id\` — points at a specific occurrence, whose time and cancellation status are live facts about that session.
- \`memberships.plan_id\` — which plan they are on, for reporting and navigation, kept *alongside* the price snapshot rather than instead of it.

The rule applied throughout: **would this value be wrong if the source changed?** Price paid, yes — snapshot it. Home gym, no — follow it.

**4. An invariant the schema still cannot enforce**

**"Bookings for a session must not exceed its capacity."** This spans rows in \`bookings\` and a column in \`class_sessions\`, so no constraint can express it, and a naive count-then-insert has a race: two concurrent bookings both see 19 of 20 taken and both insert.

Options, in ascending order of cost:

- **Lock the session row** with \`SELECT ... FOR UPDATE\` before counting and inserting, inside one transaction. Correct, simple, and serialises bookings for that session — fine at gym scale, where a popular class is a few dozen bookings.
- **A counter column with a CHECK**: \`booked_count int CHECK (booked_count <= capacity)\`, incremented in the same transaction as the insert. The database rejects the overbooking, and the counter is now derived data needing an owner and a rebuild path.
- **A constraint trigger** that recounts on commit. Correct and the hardest to reason about.

I would take the row lock: it is the least machinery, it needs no derived data, and the contention it introduces is bounded by how many people book one class at once. I would also note that this is exactly the seat-reservation problem, and if capacity contention ever became severe the answer would be to move to explicit holds with expiry rather than to optimise the lock.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-rel-1',
      level: 'basic',
      question: 'What is normalisation for?',
      guidance:
        'Removing the possibility of contradiction, not saving space. A strong answer offers the dependency question as the working tool rather than reciting normal forms, and immediately notes that denormalisation is a deliberate reintroduction of that possibility.',
    },
    {
      id: 'iq-rel-2',
      level: 'basic',
      question: 'Would you use a natural key or a surrogate key?',
      guidance:
        'Surrogate for identity, with natural uniqueness as a UNIQUE constraint. The reasoning must be about identity surviving data change, not index size. A candidate who picks email as a primary key has not thought about what happens when it changes.',
    },
    {
      id: 'iq-rel-3',
      level: 'intermediate',
      question: 'Should an order store the customer\'s address, or join to the customer?',
      guidance:
        'Store it, because the address an order shipped to is a different fact from where the customer lives now. Look for the historical-versus-current distinction rather than a join-cost argument — a candidate who justifies it by performance will later "fix" it by joining.',
    },
    {
      id: 'iq-rel-4',
      level: 'intermediate',
      question: 'When would you put data in a JSON column?',
      guidance:
        'When nothing references it and nothing constrains it. A strong answer names what you give up — foreign keys, checks, uniqueness, planner help without expression indexes — and notes that referential integrity is the one thing that cannot be retrofitted.',
    },
    {
      id: 'iq-rel-5',
      level: 'advanced',
      question: 'Where do you enforce invariants: the schema or the application?',
      guidance:
        'Everything the database can express goes in the schema, because constraints see every write including migrations and admin tools. Excellent answers enumerate what constraints cannot express — cross-row and cross-table rules — and name the mechanisms for those: partial unique indexes, triggers, or a locked transaction.',
    },
    {
      id: 'iq-rel-6',
      level: 'advanced',
      question: 'A read query is too slow. Walk me through deciding whether to denormalise.',
      guidance:
        'Measure first, try indexes and query shape first, then denormalise with an owner, a rebuild path and a staleness budget. Excellent answers note that the same information sometimes belongs in a separate read model rather than a column, and that pre-emptive denormalisation optimises queries nobody has confirmed.',
    },
    {
      id: 'iq-rel-7',
      level: 'followup',
      question: 'You said normalise first. When is that the wrong starting point?',
      guidance:
        'When a single access pattern is known and fixed and the store has no relational features anyway — access-pattern-first design in a key-value store. A strong answer concedes this genuinely rather than defending normalisation universally, and notes the cost: a second access pattern means a new model or a new copy.',
    },
    {
      id: 'iq-rel-8',
      level: 'followup',
      question: 'You want to add a column to a join table. What does that tell you?',
      guidance:
        'That the relationship is an entity in its own right — an enrolment has a date and a grade. Modelling it as a pure join table hid a real thing. A strong answer notes this is common and healthy to notice early, and that the composite key still expresses the "at most once" rule.',
    },
  ],

  activeLearning: [
    {
      id: 'al-rel-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson assumed a relational database with foreign keys and constraints. Now change one thing: the store is a key-value database with no joins, no foreign keys and no cross-row constraints. Which ideas survive, which become impossible, and what replaces them?',
      discussion: `Roughly half the lesson survives, and what replaces the rest is discipline rather than a feature.

**Survives, and matters more:**

*The dependency question.* Still the right tool. Asking what a value depends on tells you which item it belongs on, and getting it wrong still produces contradiction — you just find out later.

*The historical-versus-current distinction.* Unchanged and more important. Without joins you must denormalise anyway, so the snapshot decision becomes the *only* decision: everything is a copy, and the question is which copies are supposed to track their source.

*Owner, rebuild path, staleness budget.* Now applies to almost every field rather than to a handful of denormalised columns, because everything is derived from somewhere.

**Becomes impossible:**

*Foreign keys.* Nothing prevents an order item referencing a product that does not exist. The invariant moves entirely into application code.

*Cross-row uniqueness.* "At most one primary address" cannot be expressed. You need either a conditional write on a single item that holds the whole set, or a separate item whose key encodes the uniqueness (\`customer#123#primary\`) so the store's own key uniqueness enforces it.

*Multi-row consistency by default.* Updating a customer's name across 400 denormalised order copies is 400 writes, not one, and they are not atomic. Which means you need to decide whether they need to be — and usually they do not, because those copies were snapshots.

**What replaces them:**

*Key design as schema design.* The primary key and any secondary indexes are chosen for the queries you will run, and the set of queries you can serve efficiently is fixed at design time. This is the access-pattern-first inversion: relational modelling lets you decide the questions later, key-value modelling requires you to decide them first.

*Conditional writes for invariants.* Most key-value stores support "write only if this attribute has this value" or "only if this item does not exist". That is the primitive that gives you optimistic concurrency and, with care, uniqueness — and it is the only atomicity you get.

*Reconciliation as a first-class process.* With no referential integrity, orphans and drift are not hypothetical. A background job that finds items referencing missing items, and copies that disagree with their source, is part of the system rather than a nice-to-have.

**The honest summary of the trade.** A relational model lets you defer the question "what will I ask?" A key-value model requires you to answer it up front and rewards you with predictable performance at scale. Neither is more correct; they front-load the same work at different times. And the invariants do not disappear — they move from a declaration the database enforces to code you must review forever, which is a real cost and the one most often left out of the comparison.`,
    },
    {
      id: 'al-rel-2',
      kind: 'debug',
      prompt:
        'A finance team reports that the sum of `order_lines.quantity * unit_price` disagrees with `orders.total_minor` for about 0.3% of orders, spread over three years with no clustering in time. The total is written by the order service. What are your hypotheses, and what would you check first?',
      discussion: `A derived column disagreeing with its source, at a low rate, spread evenly over years, with no time clustering. That last detail is the most informative: it rules out a single bad deploy and points at a code path that has always been wrong and is rarely taken.

**Hypotheses, most to least likely:**

**1. A second writer that does not maintain the total.** An admin tool, a support script, a data-fix migration, or a refund flow that adjusts lines directly. This is the classic failure of a denormalised column without a single owner, and the even spread over years is exactly what a rarely-used admin path produces.

**2. A non-transactional update.** The lines and the total are written in separate transactions, so a crash or an error between them leaves them inconsistent. Would produce a low, evenly distributed rate — and would correlate with error logs at those timestamps if anyone kept them that long.

**3. Rounding.** If \`unit_price\` is ever a float, or if a percentage discount is applied and rounded differently when computing the total than when computing lines, you get small consistent discrepancies. Distinguishable immediately: check whether the differences are small (rounding) or whole line amounts (missing writes).

**4. Deliberate divergence.** The total might legitimately include shipping, tax or a discount not represented in the lines. Worth ruling out before treating it as a bug — and if true, the "defect" is that nobody documented what \`total_minor\` means.

**What I would check first: the magnitude and shape of the differences.**

One query, and it splits the hypotheses cleanly:

- Differences of a few minor units → rounding.
- Differences equal to exactly one line's amount → a code path that adds or removes a line without updating the total.
- Differences equal to a consistent extra amount → the total includes something the lines do not, so this is a documentation problem.

Then: **do the affected orders share anything?** A creating service, an admin user, a status transition, a refund flag. With 0.3% over three years there is enough data to find a correlation, and a correlation names the code path.

**What I would do regardless of the answer:**

**Add a reconciliation job that reports mismatches daily.** The reason this is a three-year-old bug is that nothing was watching. A derived column without a rebuild path is a column that drifts silently; the job is what converts "finance found it" into "we know within a day".

**Then decide whether the column should exist.** If the aggregation is fast enough — and over an order's own lines it usually is, since the row count is small and the index is obvious — deleting the column removes the entire class of bug. Denormalisation should survive a review asking whether the read cost is still real, and a column added years ago for a query nobody runs any more is pure liability.

**Transferable:** every denormalised value needs a job that checks it, because "we will keep it updated" is a promise about future code paths that nobody can make. If you are unwilling to write the reconciliation, that is evidence you should not add the column.`,
    },
  ],

  revision: {
    bullets: [
      'A schema is a set of claims about which facts exist and where each lives. A wrong model gives you two rows that disagree and no error.',
      'Normalisation removes the possibility of contradiction. Space stopped being the reason decades ago.',
      'The working tool, replacing normal-form recall: for each column, what does its value depend on?',
      'The commonest real error is conflating a current fact with a historical one — they look like the same column.',
      'Test for capturing a value: would it be wrong if the source changed? If yes, snapshot it at the event.',
      'A snapshot is not denormalisation. It has no owner or rebuild path because it is not supposed to track anything.',
      'Surrogate key for identity; enforce natural uniqueness as a UNIQUE constraint. Identity must survive the data changing.',
      'Composite primary keys on join tables state "at most once" as a schema fact.',
      'Wanting to add columns to a join table means the relationship was always an entity.',
      'Constraints are enforced by the one component that sees every write, including migrations and admin tools.',
      'Constraints cannot express cross-row rules (use a partial unique index) or cross-table rules (trigger, or a locked recomputing transaction).',
      'JSON is for data nothing else references and nothing else constrains. Referential integrity cannot be retrofitted onto a document.',
      'Denormalise only with an owner, a rebuild path and a staleness budget — and a job that reports mismatches.',
      'If you are unwilling to write the reconciliation job, that is evidence against adding the column.',
      'Anything recording something that happened must contain everything needed to interpret it.',
      'You cannot know what to denormalise before you have query patterns, which is why normalised is the right start.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The discipline of deciding which facts exist, what each depends on, where each is stored once, and which invariants the database itself enforces.',
    whyItExists:
      'Storing one fact in two places creates the possibility that they disagree, and a disagreement produces no error — only wrong answers discovered much later.',
    whenToUse: [
      'As the default starting point for any relational store, before query patterns are known.',
      'Snapshots specifically for anything recording an event: orders, invoices, payments, shipments, audit entries.',
      'Constraints for every invariant the database can express, without exception.',
    ],
    whenNotToUse: [
      'Access-pattern-first stores with no joins or constraints, where key design replaces normalisation.',
      'Pre-emptive denormalisation, before a read cost has been measured.',
      'JSON for anything referenced by other tables or constrained by a rule.',
    ],
    alternatives: [
      'Access-pattern-first modelling in a key-value store: fixes the queries at design time in exchange for predictable scale.',
      'A separate read model or materialised view, when the problem is a query shape rather than a missing column.',
      'Event sourcing, where the log of what happened is the source of truth and current state is a projection.',
    ],
    tradeoffs: [
      'Normalisation buys impossibility of contradiction and costs joins on read.',
      'Constraints buy enforcement through every code path and cost a little write-time checking plus migration friction.',
      'Denormalisation buys read performance and guarantees eventual drift plus a rebuild job to maintain.',
      'JSON buys schema flexibility and gives up integrity, constraints and planner help.',
    ],
    failureModes: [
      'A price or address change silently rewriting historical records.',
      'A natural key changing and orphaning every referencing row.',
      'A derived column drifting because a second code path writes the source without the copy.',
      'A JSON array holding data that needs a foreign key, so integrity is application-only.',
      'Concurrent read-modify-write on a JSON document losing one edit silently.',
      'Float money accumulating rounding error across reconciliation.',
      'A cross-row invariant enforced by count-then-insert, with a race between the two.',
    ],
    followUpQuestions: [
      'For this column, what does its value depend on?',
      'Is this a current fact or a record of what happened?',
      'Which of your invariants does the database enforce, and which only your code does?',
      'Who owns this derived value, and what job tells you when it has drifted?',
      'What happens to every referencing row when this key\'s value changes?',
      'What would you need to add to serve a query you have not been asked for yet?',
    ],
  },
});
