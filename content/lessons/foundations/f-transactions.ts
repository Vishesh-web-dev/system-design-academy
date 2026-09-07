import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-transactions',
  title: 'Transactions, ACID and isolation levels',
  summary:
    'An isolation level is a list of anomalies you have agreed to tolerate, and your database almost certainly defaults to one that permits more than you think.',
  phase: 'foundations',
  module: 'databases',
  position: 15,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 50,
  tags: ['transactions', 'isolation', 'acid', 'mvcc', 'concurrency', 'locks'],
  prerequisites: ['f-indexes'],
  resources: [
    {
      key: 'postgres-transaction-iso',
      tier: 'must',
      note: 'The table of levels against permitted anomalies is the single most useful reference in this area. Note which level your database actually defaults to before reading anything else.',
    },
    {
      key: 'postgres-mvcc',
      tier: 'must',
      note: 'Why readers never block writers in an MVCC database, and why that means "repeatable read" here is implemented by snapshots rather than by read locks.',
    },
    {
      key: 'postgres-explicit-locking',
      tier: 'must',
      note: 'The tool you reach for when a rule spans rows and cannot be a constraint. Read the row-level locking modes and note what SELECT ... FOR UPDATE actually blocks.',
    },
    {
      key: 'ddia-book',
      tier: 'good',
      note: 'The chapter on transactions, particularly the treatment of write skew — the anomaly most people have never named and have definitely shipped.',
    },
    {
      key: 'jepsen-consistency',
      tier: 'advanced',
      note: 'The formal map of consistency and isolation models. Useful for seeing that "serializable" and "linearizable" are different guarantees about different things.',
    },
  ],

  intuition: {
    body: `A transaction is a promise that a group of operations behaves as one: all of them happen, or none do, and nothing halfway is ever visible.

ACID names four parts of that promise, and only one of them is genuinely difficult.

- **Atomicity** — all or nothing. Solved, by write-ahead logging.
- **Durability** — once committed, it survives a crash. Solved, by flushing the log.
- **Consistency** — your constraints hold. Solved, by enforcing constraints.
- **Isolation** — concurrent transactions do not interfere. **This is the hard one, and it is a dial rather than a property.**

Here is the thing that surprises people. Perfect isolation — every transaction behaving as though it ran completely alone, one after another — is called **serializable**, and almost no database gives it to you by default. Defaults are weaker, because weaker is faster, and weaker means specific bad things can happen.

So an isolation level is not a quality setting. **It is a list of anomalies you have agreed to tolerate**, and the practical skill is knowing which anomalies your default permits and whether any of them matter for the operation you are writing.

Two concrete examples of why this is not academic:

Two people withdraw from the same account at the same moment. Under most defaults, both can read a balance of £100, both approve a £70 withdrawal, and the account ends at −£40 with no error raised anywhere.

Two doctors are on call. A rule says at least one must remain. Both check simultaneously, both see the other on call, both go off duty. Every constraint held. Nobody violated anything. The invariant is broken.

The second one is called **write skew**, most engineers have never named it, and most have shipped it.`,
    analogyLimit:
      'Thinking of isolation as "how much transactions can see of each other" is a useful start and hides where the real problems are: the dangerous anomalies are not about reading stale data but about two transactions making decisions from a consistent snapshot and then writing conclusions that are only valid if the other one had not happened. That failure has nothing to do with visibility and everything to do with the premise a decision was based on.',
  },

  deepExplanation: {
    predict: {
      question:
        'Two transactions run concurrently under Read Committed, the default in most databases. Each does: read the account balance, check it is at least £70, then subtract £70. The balance starts at £100. What is the final balance, and does anything error?',
      answer: `**Final balance: −£40. Nothing errors.**

The interleaving:

| Time | T1 | T2 | Stored balance |
| --- | --- | --- | --- |
| t0 | \`SELECT balance\` → 100 | | 100 |
| t1 | | \`SELECT balance\` → 100 | 100 |
| t2 | check 100 ≥ 70 ✓ | | 100 |
| t3 | | check 100 ≥ 70 ✓ | 100 |
| t4 | \`UPDATE SET balance = 30\` | | 30 |
| t5 | COMMIT | | 30 |
| t6 | | \`UPDATE SET balance = 30\` | 30 |
| t7 | | COMMIT | 30 |

Wait — the final balance is **30**, not −40, and that is arguably worse. T2's update wrote an absolute value computed from a stale read, so **T1's withdrawal vanished entirely**: £140 was withdrawn and the balance dropped by £70. This is a **lost update**.

If instead both had written \`balance = balance - 70\` (a relative update), the row lock would serialise them and the result would be −£40 — the money is accounted for, but the check that was supposed to prevent an overdraft was bypassed, because each transaction validated against a value that was true when it read it and false when it wrote.

Read Committed prevents dirty reads. It does not prevent either of these.

**Three fixes, in ascending strength:**

1. **A constraint:** \`CHECK (balance >= 0)\`. The database rejects the second update. Cheapest, and only works when the rule fits in one row.
2. **An explicit lock:** \`SELECT balance FROM accounts WHERE id = $1 FOR UPDATE\`. The second transaction blocks until the first commits, then reads 30 and correctly refuses. This is the standard answer and it is what most code that looks correct is missing.
3. **Serializable isolation.** The database detects the conflict and aborts one transaction with a serialisation failure, which the application must catch and retry.

The lesson worth carrying: **read-check-write is not safe by default.** Wherever you see that pattern, something must serialise it — a constraint, a lock, or an isolation level that will abort.`,
    },
    body: `## The four anomalies, in the order they matter

**Dirty read.** Reading data another transaction has written but not committed. Prevented by every level above Read Uncommitted, and effectively a non-issue in practice — no mainstream database defaults to allowing it.

**Non-repeatable read.** Reading the same row twice in one transaction and getting different values, because another transaction committed in between. Permitted by Read Committed. Usually harmless for a single read, and a real problem for a transaction that reads the same value twice and assumes stability.

**Phantom read.** Running the same query twice and getting a different *set* of rows, because another transaction inserted or deleted matching rows. Permitted by Read Committed; prevented by Repeatable Read for the rows you read, but see below.

**Write skew.** Two transactions read overlapping data, each makes a decision that is correct given what it read, and each writes to a *different* row. Neither writes what the other read, so no write conflict is detected — and the invariant spanning both rows is violated. **Permitted by everything except Serializable.**

Write skew is the one to learn properly, because it is the anomaly that survives the level most people upgrade to when they get worried.

## The levels, and what each actually gives you

| Level | Dirty read | Non-repeatable read | Phantom | Write skew |
| --- | --- | --- | --- | --- |
| Read Uncommitted | possible | possible | possible | possible |
| **Read Committed** (usual default) | no | possible | possible | possible |
| **Repeatable Read / Snapshot** | no | no | no* | **possible** |
| **Serializable** | no | no | no | no |

\\* In an MVCC database, Repeatable Read gives each transaction a consistent snapshot taken at its start, so a repeated query returns the same rows — phantoms are prevented for reads. The standard permits phantoms at this level; snapshot implementations do not exhibit them. Which is precisely why write skew is the surprising one: you have snapshot stability and still no protection.

Two things worth knowing about what these names mean in practice:

**The names are not portable.** "Repeatable Read" in one database is snapshot isolation; in another it is lock-based and behaves differently. "Serializable" in an MVCC database is typically implemented by detecting conflicts and aborting, not by locking, so it fails differently from a lock-based implementation. Read your database's documentation, not the SQL standard.

**The default is almost always Read Committed.** Which permits non-repeatable reads, phantoms and write skew. If you have never chosen an isolation level, that is what your money-handling code is running under.

## MVCC, briefly, because it explains the behaviour

Under multi-version concurrency control, an update does not overwrite a row — it writes a new version and leaves the old one visible to transactions that started earlier. Consequences:

- **Readers never block writers, and writers never block readers.** This is the main reason MVCC databases feel fast under mixed load.
- **Writers still block writers** on the same row. Two transactions updating one row serialise on a row lock.
- **A snapshot is cheap**, which is why Repeatable Read costs almost nothing in an MVCC database and why it is often the right default for a read-heavy transaction.
- **Old versions accumulate** and must be cleaned up. That is vacuum, and it is why a long-running transaction is expensive: it holds a snapshot open, so nothing newer than it can be reclaimed.

## Serializable, and its real cost

Serializable gives you the guarantee you actually want: every transaction behaves as though it ran alone. The cost is not usually throughput — it is that **transactions can now fail for a new reason.**

Under MVCC-based serializable isolation, the database tracks read and write dependencies and aborts a transaction whose commit would create a cycle. So your application must:

- **Catch serialisation failures specifically** and distinguish them from real errors.
- **Retry the whole transaction**, from the beginning — not just the failed statement, because the transaction's premise has changed.
- **Bound the retries**, and back off, because a hot contended row under Serializable can produce a retry loop.

This is entirely tractable and it must be built deliberately. A codebase that switches to Serializable without a retry wrapper will start surfacing errors to users under load.

## Explicit locks: the middle path

Between "hope" and "Serializable everywhere" sits explicit locking, and it is the tool most read-check-write code needs.

\`\`\`sql
BEGIN;
SELECT balance FROM accounts WHERE id = $1 FOR UPDATE;  -- blocks concurrent writers
-- check, decide
UPDATE accounts SET balance = balance - 70 WHERE id = $1;
COMMIT;
\`\`\`

\`FOR UPDATE\` takes a row lock, so a second transaction attempting the same \`SELECT ... FOR UPDATE\` waits until the first commits. It then reads the *new* value and makes a correct decision.

Two things to be precise about:

**It locks the rows it read, not rows that do not exist yet.** So it fixes lost updates and read-check-write on existing rows, and it does **not** fix write skew where the conflict involves a row being inserted. For that you need Serializable or a lock on something both transactions must take — a parent row, or an advisory lock on a key.

**Lock ordering matters.** Two transactions taking locks on the same two rows in opposite orders deadlock. The database detects it and aborts one, which is safe and means your code must handle deadlock errors too. The prevention is to always acquire locks in a consistent order — sort by primary key.

## Transaction scope

Keep transactions short, and keep them free of anything you do not control.

**Never call an external service inside a transaction.** A payment provider taking 30 seconds means a 30-second-old snapshot, held locks, and blocked vacuum. The pattern is: commit the local record, then call out, then record the result — which is exactly the ordering the idempotency lesson derived, arrived at from a different direction.

**Never wait for a human inside a transaction.** "Open a transaction, show a form, commit on submit" holds locks for minutes. Use optimistic concurrency instead: read a version number, submit it with the change, and reject if it has moved.

**Do the reads you need, then decide, then write, then commit.** Every additional millisecond of transaction life is more time holding locks and blocking cleanup.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'write-skew',
      title: 'Write skew: every constraint holds and the invariant breaks',
      caption:
        'Note that the two transactions write to *different* rows, which is why no write conflict is detected and why Repeatable Read does not help. Each decision was correct given a consistent snapshot, and the conclusion was only valid if the other transaction had not happened.',
      code: `sequenceDiagram
    participant T1 as Dr A's transaction
    participant DB as Database
    participant T2 as Dr B's transaction

    Note over DB: Rule — at least one doctor on call.<br/>Both A and B are currently on call.

    T1->>DB: SELECT count(*) WHERE on_call → 2
    T2->>DB: SELECT count(*) WHERE on_call → 2
    Note over T1: 2 > 1, safe to go off call
    Note over T2: 2 > 1, safe to go off call
    T1->>DB: UPDATE doctors SET on_call = false WHERE id = 'A'
    T2->>DB: UPDATE doctors SET on_call = false WHERE id = 'B'
    T1->>DB: COMMIT
    T2->>DB: COMMIT

    Note over DB: Zero doctors on call.<br/>No write conflict — different rows.<br/>No constraint violated — the rule spans rows.<br/>Repeatable Read permits this. Serializable aborts one.`,
    },
    {
      kind: 'flow',
      id: 'isolation-choice',
      title: 'Choosing protection for a read-check-write',
      caption:
        'Step through the options in order of cost. The first two are free and cover most cases; the last two exist for invariants that span rows, which is exactly where write skew lives.',
      nodes: [
        { id: 'pattern', label: 'read → check → write', kind: 'client', x: 0, y: 140, detail: 'This pattern is never safe by default. Wherever it appears, something must serialise it — and Read Committed does not.' },
        { id: 'constraint', label: 'A CHECK constraint', kind: 'store', x: 190, y: 20, detail: 'Cheapest possible protection: the database rejects the write. Works only when the rule fits inside one row — a non-negative balance, a valid status.' },
        { id: 'relative', label: 'A relative update', kind: 'store', x: 190, y: 130, detail: 'UPDATE ... SET x = x - 70 serialises on the row lock and cannot lose an update. Fixes lost updates and not the check that preceded it.' },
        { id: 'forupdate', label: 'SELECT ... FOR UPDATE', kind: 'service', x: 420, y: 130, detail: 'Locks the rows read, so a second transaction waits and then reads the new value. The standard fix for read-check-write on existing rows — and it cannot lock rows that do not exist yet.' },
        { id: 'serial', label: 'Serializable', kind: 'service', x: 420, y: 280, detail: 'The only level that prevents write skew. Costs a new failure mode: transactions abort with serialisation errors and the application must retry the whole transaction with backoff.' },
        { id: 'retry', label: 'Retry wrapper', kind: 'service', x: 650, y: 280, detail: 'Mandatory alongside Serializable. Catch serialisation and deadlock errors specifically, re-run the whole transaction, bound the attempts, back off. Without it, load produces user-visible errors.' },
        { id: 'skew', label: 'Invariant spans rows?', kind: 'note', x: 190, y: 280, detail: 'Doctors on call, seats in a room, total across accounts. No constraint can see siblings and FOR UPDATE cannot lock absent rows — this is the write-skew case.' },
      ],
      edges: [
        { id: 't1', source: 'pattern', target: 'constraint', label: 'one-row rule', kind: 'control' },
        { id: 't2', source: 'pattern', target: 'relative', label: 'pure increment', kind: 'control' },
        { id: 't3', source: 'pattern', target: 'skew', label: 'cross-row rule', kind: 'control' },
        { id: 't4', source: 'relative', target: 'forupdate', label: 'check needed too', kind: 'control' },
        { id: 't5', source: 'skew', target: 'serial', kind: 'control' },
        { id: 't6', source: 'serial', target: 'retry', label: 'requires', kind: 'sync' },
      ],
      steps: [
        {
          id: 's1',
          title: 'If the rule fits in one row, a constraint is the whole answer',
          description:
            'A non-negative balance or a valid status enum is enforced on every write by every code path, with no locking and no retry logic. Reach for this first, always.',
          nodes: ['pattern', 'constraint'],
          edges: ['t1'],
        },
        {
          id: 's2',
          title: 'A relative update fixes lost updates and not the check',
          description:
            'SET balance = balance - 70 cannot lose the other transaction\'s work, because the row lock serialises them. It does nothing about the check that preceded it, which is why the balance can still go negative.',
          nodes: ['relative', 'forupdate'],
          edges: ['t2', 't4'],
        },
        {
          id: 's3',
          title: 'FOR UPDATE is the standard fix, with one precise limit',
          description:
            'It locks the rows you read, so a concurrent transaction waits and then decides against the current value. It cannot lock rows that do not exist yet, so it does not cover conflicts involving inserts.',
          nodes: ['forupdate'],
          edges: [],
        },
        {
          id: 's4',
          title: 'Cross-row invariants need Serializable, and Serializable needs a retry wrapper',
          description:
            'Write skew survives every weaker level. Serializable prevents it by aborting one transaction — which means the application must catch serialisation failures, re-run the whole transaction, and bound the attempts.',
          nodes: ['skew', 'serial', 'retry'],
          edges: ['t3', 't5', 't6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The clearest production illustration is the pattern that appears wherever a limited resource is allocated: seats, inventory, appointment slots, licence keys.

The naive implementation is always the same three steps: count what is taken, check against capacity, insert a reservation. It passes review, because each step is obviously correct. It passes testing, because tests run sequentially. It fails in production during the first minute of high demand, and it fails by overselling — which is the most expensive kind of failure because it has already been paid for by a customer.

What makes this instructive is that the fix chosen usually depends on how much contention there is, and the three answers have genuinely different profiles.

**A counter with a constraint.** Keep \`taken\` on the parent row with \`CHECK (taken <= capacity)\`, and increment it in the same transaction as the insert. The database rejects the overselling write. This is the cheapest correct answer, and it serialises all bookings for one event on one row — fine for a cinema, a bottleneck for a stadium.

**A row lock on the parent.** \`SELECT ... FOR UPDATE\` on the event row before counting. Equivalent serialisation, and it does not introduce derived data needing an owner. Slightly more code, no extra column to keep correct.

**Pre-created rows with unique claiming.** Insert one row per seat up front, and claim with a conditional update: \`UPDATE seats SET holder = $1 WHERE id = $2 AND holder IS NULL\`. Zero rows affected means somebody else got it. This removes the shared hot row entirely — concurrency is now per seat rather than per event — and it costs pre-creating the rows and handling the case where a user's preferred seat is gone.

The third answer is the one high-contention systems converge on, and the reason is worth extracting: **it converts a cross-row invariant into a single-row conditional write.** Capacity is no longer a rule about a count; it is a fact about how many rows exist. Once expressed that way, the database's own row-level atomicity is sufficient and no lock, counter or isolation level is needed.

Two transferable lessons:

**Read-check-write is a code smell that should trigger a specific question:** what serialises this? Every occurrence needs an answer, and "we are inside a transaction" is not one, because Read Committed permits exactly this failure.

**Reshaping the invariant often beats strengthening the isolation.** Before reaching for Serializable and a retry loop, ask whether the rule can be restated as a property of a single row. That move is available more often than it looks, and it removes the problem rather than managing it.`,
  },

  tradeoffs: {
    intro:
      'Ordered from cheapest to most expensive. The first three cover the large majority of real cases; the last exists for invariants the others cannot express.',
    rows: [
      {
        option: 'A constraint (CHECK, UNIQUE, foreign key)',
        whenItWins:
          'Whenever the rule fits within one row or is expressible as uniqueness. Enforced on every write by every code path, with no locks and no retries.',
        whenItLoses:
          'Rules spanning rows or tables — a count against a capacity, a sum matching a total, "at least one of these".',
        cost:
          'Essentially nothing. A rejected write the application must handle, which it should be doing anyway.',
      },
      {
        option: 'A relative update (`SET x = x - n`)',
        whenItWins:
          'Pure increments and decrements with no precondition. The row lock serialises writers, so no update can be lost.',
        whenItLoses:
          'Anything with a check before the write — the check still evaluates against a value that may be stale by the time you write.',
        cost:
          'Nothing, and a false sense of safety if the preceding check is assumed to be protected too.',
      },
      {
        option: '`SELECT ... FOR UPDATE` on the rows you will write',
        whenItWins:
          'The standard read-check-write fix on existing rows: a concurrent transaction waits, then decides against the current value.',
        whenItLoses:
          'Conflicts involving rows that do not exist yet, and high contention on one row where serialising every writer is the bottleneck.',
        cost:
          'Blocking, deadlock risk if lock order is inconsistent, and a hot row becomes a throughput ceiling.',
      },
      {
        option: 'Reshape the invariant into single-row facts',
        whenItWins:
          'High contention. Pre-created rows claimed with a conditional update remove the shared hot row entirely — concurrency becomes per item.',
        whenItLoses:
          'When the resource is not enumerable up front, or when pre-creation is expensive relative to the contention it removes.',
        cost:
          'Pre-created rows to manage, and handling the case where a specific item is already claimed.',
      },
      {
        option: 'Serializable isolation',
        whenItWins:
          'Cross-row invariants where write skew is possible and reshaping is not available. The only level that prevents it.',
        whenItLoses:
          'Hot contended data, where abort-and-retry rates make throughput worse than explicit locking.',
        cost:
          'A new failure mode: serialisation aborts the application must catch and retry from the beginning, with bounded attempts and backoff.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"The read and the write are both inside a transaction, so the balance cannot go negative."',
      whyWeak:
        'A transaction gives atomicity, not mutual exclusion. Under Read Committed — the default almost everywhere — two transactions can both read £100, both approve, and both write. The transaction guaranteed that each one\'s work was all-or-nothing, which was never the problem.',
      strongAnswer:
        '"Being in a transaction does not serialise the read against another transaction\'s write. I would either put a `CHECK (balance >= 0)` constraint on the row so the database rejects it, or lock the row with `SELECT ... FOR UPDATE` before checking so the second transaction reads the updated value."',
    },
    {
      weakAnswer: '"We use Repeatable Read, so concurrent transactions cannot interfere."',
      whyWeak:
        'Repeatable Read gives a stable snapshot, which prevents non-repeatable reads and phantoms. It does not prevent write skew: two transactions reading overlapping data and writing to different rows see no conflict, so both commit and a cross-row invariant breaks. Upgrading to Repeatable Read is the most common way to feel protected while remaining exposed.',
      strongAnswer:
        '"Repeatable Read stabilises what I read and does not stop write skew, because the two transactions write different rows and nothing detects a conflict. If the invariant spans rows I need Serializable with a retry wrapper, or I need to reshape the rule so it becomes a single-row fact."',
    },
    {
      weakAnswer: '"We set the isolation level to Serializable, so concurrency bugs are handled."',
      whyWeak:
        'Serializable in an MVCC database works by detecting conflicts and aborting a transaction. Without a retry wrapper, those aborts surface to users as errors precisely when load is highest. The isolation level was necessary and is not sufficient.',
      strongAnswer:
        '"Serializable gives the guarantee and introduces serialisation failures. I would wrap transactions in a retry helper that catches serialisation and deadlock errors specifically, re-runs the whole transaction rather than the failed statement, bounds the attempts and backs off. Without that, switching levels converts a silent correctness bug into a visible error rate."',
    },
    {
      weakAnswer: '"We call the payment provider inside the transaction so it rolls back if the charge fails."',
      whyWeak:
        'The external charge cannot be rolled back by your database, so the atomicity you were hoping for does not exist. Meanwhile the transaction holds locks and a snapshot for the duration of a network call you do not control — blocking writers and preventing vacuum from reclaiming old versions.',
      strongAnswer:
        '"External calls never go inside a transaction, because they cannot participate in the rollback and they hold locks for as long as a third party takes to answer. The ordering is: commit the local record with a pending state, call the provider, then record the outcome — with an idempotency key so a retry after an ambiguous failure is safe."',
    },
    {
      weakAnswer: '"Long-running transactions are fine as long as they are read-only."',
      whyWeak:
        'A read-only transaction under MVCC holds a snapshot open, which prevents vacuum from reclaiming any row version newer than its start. A transaction left open for hours on a busy table causes measurable bloat, and the symptom appears as unexplained table and index growth rather than as anything pointing at the transaction.',
      strongAnswer:
        '"A long read-only transaction still pins a snapshot, so nothing newer can be vacuumed and the tables bloat. I would keep transactions short regardless of whether they write, and for long analytical reads use a replica or an explicitly exported snapshot rather than holding one open on the primary."',
    },
    {
      weakAnswer: '"We take locks as needed and the database resolves any deadlocks."',
      whyWeak:
        'It does resolve them — by aborting one transaction, which becomes an error your application must handle. Deadlocks are also preventable rather than merely survivable: they arise from inconsistent lock ordering, so accepting them means accepting an avoidable error rate.',
      strongAnswer:
        '"Deadlocks come from acquiring locks in different orders, so I would acquire in a consistent order — sorted by primary key — which prevents most of them. And I would still handle the deadlock error, because a retry wrapper is needed for serialisation failures anyway and it covers both."',
    },
  ],

  flashcards: [
    {
      id: 'fc-tx-1',
      front: 'Which letter of ACID is genuinely hard, and why?',
      back: 'Isolation. Atomicity and durability come from write-ahead logging, consistency from constraints. Isolation is a dial with several settings, each permitting a different set of anomalies.',
      topic: 'acid',
    },
    {
      id: 'fc-tx-2',
      front: 'What is an isolation level, stated precisely?',
      back: 'A list of anomalies you have agreed to tolerate. Not a quality setting — a specification of which concurrency bugs remain possible.',
      topic: 'isolation',
    },
    {
      id: 'fc-tx-3',
      front: 'What does Read Committed permit?',
      back: 'Non-repeatable reads, phantoms and write skew. It only prevents dirty reads — and it is the default in most databases.',
      topic: 'isolation',
    },
    {
      id: 'fc-tx-4',
      front: 'What is write skew, and which levels permit it?',
      back: 'Two transactions read overlapping data, each decides correctly given what it read, and each writes a *different* row — so no conflict is detected and a cross-row invariant breaks. Permitted by everything except Serializable.',
      topic: 'isolation',
    },
    {
      id: 'fc-tx-5',
      front: 'Why does Repeatable Read not prevent write skew?',
      back: 'It stabilises what you read. The two transactions write different rows, so there is no write conflict to detect — the problem is the premise of a decision, not the visibility of data.',
      topic: 'isolation',
    },
    {
      id: 'fc-tx-6',
      front: 'What is a lost update, and what causes it?',
      back: 'One transaction\'s write is overwritten by another that computed an absolute value from a stale read. Caused by read-modify-write with absolute assignment; avoided by relative updates or a row lock.',
      topic: 'concurrency',
    },
    {
      id: 'fc-tx-7',
      front: 'Under MVCC, who blocks whom?',
      back: 'Readers never block writers and writers never block readers, because an update writes a new version. Writers still block writers on the same row.',
      topic: 'mvcc',
    },
    {
      id: 'fc-tx-8',
      front: 'Why is a long-running transaction expensive even if it is read-only?',
      back: 'It holds a snapshot open, so vacuum cannot reclaim any row version newer than its start. The symptom is unexplained table and index bloat.',
      topic: 'mvcc',
    },
    {
      id: 'fc-tx-9',
      front: 'What does `SELECT ... FOR UPDATE` fix, and what does it not?',
      back: 'It locks the rows you read, so a concurrent transaction waits and then decides against the current value — fixing read-check-write on existing rows. It cannot lock rows that do not exist yet, so it does not cover insert-based write skew.',
      topic: 'locks',
    },
    {
      id: 'fc-tx-10',
      front: 'What must accompany a switch to Serializable isolation?',
      back: 'A retry wrapper. It works by aborting conflicting transactions, so the application must catch serialisation failures, re-run the whole transaction, bound attempts and back off.',
      topic: 'transactions',
    },
    {
      id: 'fc-tx-11',
      front: 'Why must external calls stay outside transactions?',
      back: 'They cannot be rolled back, so the atomicity is illusory — and they hold locks and a snapshot for as long as a third party takes to respond, blocking writers and vacuum.',
      topic: 'transactions',
    },
    {
      id: 'fc-tx-12',
      front: 'How do you prevent deadlocks rather than merely surviving them?',
      back: 'Acquire locks in a consistent order, typically sorted by primary key. Deadlocks arise from inconsistent ordering; the database resolves them by aborting one transaction, which is an avoidable error.',
      topic: 'locks',
    },
    {
      id: 'fc-tx-13',
      front: 'What is often better than strengthening isolation?',
      back: 'Reshaping the invariant into single-row facts — pre-created rows claimed with a conditional update. That removes the shared hot row and the need for locks or Serializable entirely.',
      topic: 'concurrency',
    },
  ],

  quiz: [
    {
      id: 'q-tx-1',
      kind: 'scenario',
      prompt:
        'Two transactions each read a stock level of 5, check that 3 units are available, and update stock to 2. Isolation is Read Committed and both are inside transactions. What is the outcome?',
      options: [
        { id: 'a', label: 'Stock ends at 2 — one update is lost, 6 units were sold and stock dropped by 3' },
        { id: 'b', label: 'Stock ends at −1 and the second transaction errors' },
        { id: 'c', label: 'The second transaction blocks until the first commits, then correctly refuses' },
        { id: 'd', label: 'One transaction is aborted with a serialisation failure' },
      ],
      correct: ['a'],
      explanation:
        'Both wrote the absolute value 2, computed from a stale read, so the second overwrote the first: a lost update. Nothing blocks, because neither took a lock and Read Committed does not prevent this. Blocking would require FOR UPDATE; an abort would require Serializable.',
      difficulty: 'core',
      topic: 'concurrency',
    },
    {
      id: 'q-tx-2',
      kind: 'scenario',
      prompt:
        'A rule requires at least one administrator per organisation. Two admins simultaneously remove their own admin role. Each transaction counts admins (sees 2), decides it is safe, and updates its own row. Isolation is Repeatable Read. What happens?',
      options: [
        { id: 'a', label: 'Both commit and the organisation has zero admins — write skew, which Repeatable Read permits' },
        { id: 'b', label: 'The second transaction sees the first\'s change and refuses' },
        { id: 'c', label: 'One transaction is aborted because the counts conflict' },
        { id: 'd', label: 'A constraint violation is raised' },
      ],
      correct: ['a'],
      explanation:
        'This is textbook write skew. Each read a consistent snapshot, each decided correctly given that snapshot, and each wrote a *different* row — so there is no write conflict to detect. Repeatable Read stabilises reads and does nothing here. Serializable would abort one; no constraint can express a rule spanning rows.',
      difficulty: 'advanced',
      topic: 'isolation',
    },
    {
      id: 'q-tx-3',
      kind: 'single',
      prompt: 'What does Read Committed prevent?',
      options: [
        { id: 'a', label: 'Only dirty reads' },
        { id: 'b', label: 'Dirty reads and non-repeatable reads' },
        { id: 'c', label: 'Dirty reads, non-repeatable reads and phantoms' },
        { id: 'd', label: 'All four classic anomalies' },
      ],
      correct: ['a'],
      explanation:
        'Read Committed guarantees only that you never see uncommitted data. Non-repeatable reads, phantoms and write skew all remain possible — and this is the default in most databases, which means it is what unspecified transactions are running under.',
      difficulty: 'intro',
      topic: 'isolation',
    },
    {
      id: 'q-tx-4',
      kind: 'scenario',
      prompt:
        'A team switches a booking service to Serializable isolation. Correctness improves in testing, but under peak load users start seeing intermittent errors. What was missed?',
      options: [
        { id: 'a', label: 'A retry wrapper — Serializable prevents anomalies by aborting transactions, and those aborts must be caught and retried' },
        { id: 'b', label: 'An index on the bookings table' },
        { id: 'c', label: 'A longer statement timeout' },
        { id: 'd', label: 'Connection pool sizing for the extra locks held' },
      ],
      correct: ['a'],
      explanation:
        'MVCC-based Serializable detects read/write dependency cycles and aborts one participant with a serialisation failure. That is the mechanism, not a malfunction. Without a wrapper that catches those specifically and re-runs the whole transaction with bounded backoff, the guarantee arrives as a user-visible error rate under exactly the load that needed it.',
      difficulty: 'advanced',
      topic: 'transactions',
    },
    {
      id: 'q-tx-5',
      kind: 'scenario',
      prompt:
        'A busy table grows steadily in size and its indexes bloat, though row count is stable. An analytics tool holds a read-only transaction open for hours against the primary. Related?',
      options: [
        { id: 'a', label: 'Yes — the open snapshot prevents vacuum from reclaiming any newer row version, so dead versions accumulate' },
        { id: 'b', label: 'No — read-only transactions have no effect on storage' },
        { id: 'c', label: 'Yes, because read locks block the vacuum process directly' },
        { id: 'd', label: 'No, bloat is caused only by deletes' },
      ],
      correct: ['a'],
      explanation:
        'Under MVCC a snapshot pins visibility, so vacuum cannot reclaim any version that the oldest open transaction might still need. A long read-only transaction is one of the most common causes of unexplained bloat, and the symptom points nowhere near the cause. Long analytical reads belong on a replica.',
      difficulty: 'advanced',
      topic: 'mvcc',
    },
    {
      id: 'q-tx-6',
      kind: 'multi',
      prompt:
        'A seat-booking system must not oversell. Which of these are correct solutions? Select all that apply.',
      options: [
        { id: 'a', label: 'A counter column on the event with `CHECK (taken <= capacity)`, incremented in the same transaction as the booking' },
        { id: 'b', label: '`SELECT ... FOR UPDATE` on the event row before counting bookings' },
        { id: 'c', label: 'Pre-create one row per seat and claim with `UPDATE ... WHERE holder IS NULL`' },
        { id: 'd', label: 'Wrap the count and insert in a Read Committed transaction' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first two serialise bookings for an event — via a constraint or a lock — and the third removes the shared hot row entirely by making capacity a fact about how many rows exist. A Read Committed transaction provides atomicity, which was never the problem: two transactions can both count, both approve and both insert.',
      difficulty: 'core',
      topic: 'concurrency',
    },
  ],

  exercises: [
    {
      id: 'ex-tx-1',
      kind: 'debug',
      title: 'Find every concurrency bug before it ships',
      estimatedMinutes: 25,
      prompt: `Review these four operations from a marketplace. The database default is Read Committed. All four are wrapped in transactions.

\`\`\`
A) Redeem a voucher
   SELECT remaining_uses FROM vouchers WHERE code = $1;
   if (remaining_uses > 0) UPDATE vouchers SET remaining_uses = $2 - 1 WHERE code = $1;

B) Transfer funds between two wallets
   SELECT balance FROM wallets WHERE id = $from FOR UPDATE;
   SELECT balance FROM wallets WHERE id = $to   FOR UPDATE;
   if (from_balance >= amount) { UPDATE both wallets }

C) Enforce "a seller may have at most 3 active listings"
   SELECT count(*) FROM listings WHERE seller_id = $1 AND active;
   if (count < 3) INSERT INTO listings (...);

D) Charge a card and record the payment
   INSERT INTO payments (status = 'pending') RETURNING id;
   charge = await paymentProvider.charge(...);        -- inside the transaction
   UPDATE payments SET status = 'captured' WHERE id = $id;
\`\`\`

For each: name the anomaly (using the correct term), describe a concrete interleaving that breaks it, and give the fix you would ship. Then say which one you would fix first and why.`,
      rubric: [
        'A: identifies lost update (absolute assignment from a stale read) and prescribes a relative update plus a CHECK constraint, or FOR UPDATE.',
        'B: identifies the deadlock risk from inconsistent lock ordering between concurrent opposite-direction transfers, and prescribes ordering locks by id.',
        'C: identifies write skew — the count spans rows and the insert is a new row, so FOR UPDATE cannot help — and prescribes Serializable or a reshaped invariant.',
        'D: identifies the external call inside the transaction, and both consequences: no rollback of the charge, and locks plus snapshot held for the provider\'s latency.',
        'Gives a concrete interleaving for each rather than only naming the anomaly.',
        'Fix for D reorders to commit-then-call-then-record, with an idempotency key.',
        'Prioritises D or A with reasoning about money and blast radius rather than by listing order.',
      ],
      modelAnswer: `**A) Voucher redemption — lost update**

*Interleaving:* voucher has \`remaining_uses = 1\`. T1 reads 1. T2 reads 1. Both check \`> 0\` and pass. Both compute \`1 - 1 = 0\` in application code and write \`remaining_uses = 0\`. **The voucher was redeemed twice and the counter says it was redeemed once.**

The specific defect is that the new value is computed in the application from a stale read and written as an absolute value — so the second write silently discards the first.

*Fix:*
\`\`\`sql
ALTER TABLE vouchers ADD CHECK (remaining_uses >= 0);
UPDATE vouchers SET remaining_uses = remaining_uses - 1
  WHERE code = $1 AND remaining_uses > 0;
-- zero rows affected ⇒ exhausted, reject the redemption
\`\`\`
This is the strongest available answer because it needs no lock and no retry: the relative update serialises on the row lock, the \`WHERE\` clause does the check atomically with the write, and the constraint is a backstop against any other code path. The affected-row count is the signal.

**B) Fund transfer — deadlock from inconsistent lock ordering**

The \`FOR UPDATE\` locks are correct and prevent lost updates. The bug is ordering.

*Interleaving:* T1 transfers A→B and locks A, then waits for B. T2 transfers B→A and locks B, then waits for A. Neither can proceed; the database detects the cycle and aborts one with a deadlock error. Under load this happens continuously between any pair of frequently trading wallets.

*Fix:* acquire locks in a deterministic order.
\`\`\`sql
SELECT balance FROM wallets WHERE id IN ($from, $to) ORDER BY id FOR UPDATE;
\`\`\`
Both transactions now take locks lowest-id-first, so one waits cleanly instead of deadlocking. I would still handle the deadlock error, because a retry wrapper is needed anyway — but ordering turns a routine occurrence into an exceptional one.

I would also add \`CHECK (balance >= 0)\` as a backstop.

**C) At most 3 active listings — write skew**

*Interleaving:* seller has 2 active listings. T1 counts 2, decides an insert is fine. T2 counts 2, decides the same. Both insert. **The seller now has 4 active listings.** No constraint was violated — the rule spans rows. No write conflict occurred — both inserted *new* rows, and \`FOR UPDATE\` cannot lock a row that does not exist yet.

This is the hardest of the four, and the one where the naive fix does not work.

*Fixes, in order of preference:*

1. **Reshape it into a single-row fact.** Add \`active_listing_count\` to \`sellers\` with \`CHECK (active_listing_count <= 3)\`, incremented in the same transaction as the insert. The database rejects the fourth. Derived data, so it needs an owner and a reconciliation job — but the invariant becomes enforceable.
2. **Lock the parent row.** \`SELECT ... FROM sellers WHERE id = $1 FOR UPDATE\` before counting. Both transactions serialise on the seller row, so the second counts 3 and refuses. No derived data, and it serialises all listing operations for a seller — which is fine, since a seller creates listings by hand.
3. **Serializable isolation**, with a retry wrapper. Correct and the most machinery.

I would take option 2: no derived column to keep correct, and the contention it introduces is negligible for this access pattern.

**D) Charge and record — external call inside a transaction**

Two distinct defects.

*Defect 1 — the atomicity is illusory.* If the \`UPDATE\` fails or the transaction rolls back after a successful charge, the database forgets the payment and the money has moved. The provider does not participate in your rollback.

*Defect 2 — locks and snapshot held for a third party's latency.* A provider taking 20 seconds means a 20-second transaction: row locks held, and a snapshot pinned so vacuum cannot reclaim anything newer. Under load this alone can degrade the whole database.

*Fix — reorder, and make the retry safe:*
\`\`\`
1. BEGIN; INSERT payments (status='pending', idempotency_key=$k); COMMIT;
2. charge = await provider.charge(..., idempotencyKey: $k);
3. BEGIN; UPDATE payments SET status=..., provider_ref=... WHERE id=$id; COMMIT;
\`\`\`
The durable record exists before the money moves, so a crash leaves a recoverable \`pending\` row rather than an untracked charge. Passing the key to the provider means a reconciliation job can ask what actually happened for any row stuck pending past a lease.

**Which I would fix first: D.**

Two reasons, and they compound. It is the only one where a failure can leave **money moved with no record** — every other bug produces a wrong number in a row we own, which is recoverable from data we have. And it is the only one whose blast radius extends beyond its own operation: a 20-second transaction holds locks and pins a snapshot, degrading unrelated queries across the database.

A would be second: it is a money-adjacent lost update, and the fix is a single statement plus a constraint, so it is the cheapest correctness available on the list.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-tx-1',
      level: 'basic',
      question: 'What does ACID stand for, and which part is hardest?',
      guidance:
        'Isolation, and a strong answer explains why: the other three have standard solutions, while isolation is a dial where each setting permits a different set of anomalies. A candidate who treats all four as equally solved has not chosen an isolation level deliberately.',
    },
    {
      id: 'iq-tx-2',
      level: 'basic',
      question: 'What is your database\'s default isolation level and what does it allow?',
      guidance:
        'Read Committed almost everywhere, permitting non-repeatable reads, phantoms and write skew. A strong answer notes this is what unspecified transactions are running under, which is the practically important point.',
    },
    {
      id: 'iq-tx-3',
      level: 'intermediate',
      question: 'A read-check-write pattern needs to be safe. What are your options?',
      guidance:
        'A constraint if the rule fits one row, a relative update for pure increments, FOR UPDATE on existing rows, reshaping into single-row facts, or Serializable with retries. Look for the ordering by cost and for the observation that being inside a transaction is not itself protection.',
    },
    {
      id: 'iq-tx-4',
      level: 'intermediate',
      question: 'Explain write skew with an example.',
      guidance:
        'Two transactions read overlapping data, each decides correctly, each writes a different row, no conflict is detected. Doctors on call or a listing limit are the standard examples. A strong answer states that Repeatable Read permits it, which is the surprising and useful part.',
    },
    {
      id: 'iq-tx-5',
      level: 'advanced',
      question: 'You switch a service to Serializable. What changes in the application?',
      guidance:
        'Transactions can now abort with serialisation failures, so a retry wrapper is mandatory: catch those errors specifically, re-run the whole transaction, bound attempts, back off. Excellent answers note that a hot contended row can produce a retry loop, so explicit locking is sometimes better than Serializable.',
    },
    {
      id: 'iq-tx-6',
      level: 'advanced',
      question: 'Why should external calls never happen inside a transaction?',
      guidance:
        'They cannot be rolled back, so the atomicity is illusory, and they hold locks and pin a snapshot for a latency you do not control. Excellent answers give the correct ordering — durable pending record, then the call, then record the outcome — and connect it to idempotency keys and reconciliation.',
    },
    {
      id: 'iq-tx-7',
      level: 'followup',
      question: 'Why does a long read-only transaction cause table bloat?',
      guidance:
        'Under MVCC it pins a snapshot, so vacuum cannot reclaim any row version newer than its start. A strong answer notes the symptom points nowhere near the cause, and that long analytical reads belong on a replica.',
    },
    {
      id: 'iq-tx-8',
      level: 'followup',
      question: 'You said FOR UPDATE fixes read-check-write. When does it not?',
      guidance:
        'When the conflict involves a row that does not exist yet — you cannot lock an absent row. Counting rows and inserting a new one is exactly this case, which is why a listing-limit or capacity rule needs Serializable, a parent-row lock, or a reshaped invariant.',
    },
  ],

  activeLearning: [
    {
      id: 'al-tx-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson assumed one database instance. Now change one thing: the data is sharded, and a transaction must update rows on two different shards. What survives, what breaks, and what replaces it?',
      discussion: `Single-shard reasoning survives intact. Cross-shard is a different problem with a different vocabulary, and the honest answer usually involves giving up the transaction.

**What survives:** everything within one shard. Isolation levels, MVCC, FOR UPDATE, constraints, write skew — all unchanged, because a shard is a database.

**What breaks: atomicity across shards.** Two shards commit independently. Shard A can succeed and shard B fail, leaving exactly the halfway state the transaction existed to prevent. Nothing in a single-node database's toolkit addresses this.

**The available answers, in order of how often they are the right one:**

*1. Do not span shards.* Choose the partition key so operations that must be atomic land together. A transfer between two wallets is atomic if both wallets are on the same shard — so shard by *account holder* rather than by wallet, or co-locate related entities deliberately. This is by far the most common correct answer and it is a modelling decision made before any of the distributed machinery is needed.

*2. Two-phase commit.* A coordinator asks every shard to prepare, and commits only if all agree. It gives genuine atomicity and costs: two round trips per commit, locks held across both phases, and a blocking failure mode — if the coordinator dies after prepare, participants hold locks with no way to decide. That last property is why 2PC is rare in systems that care about availability.

*3. A saga.* Give up atomicity and get eventual consistency instead. Each step commits locally, and each has a compensating action. Debit A, then credit B; if the credit fails, issue a compensating credit to A. You now have intermediate states that are visible — the money briefly exists nowhere — and compensations that can themselves fail. Every step must be idempotent, which is the idempotency lesson becoming load-bearing.

*4. Reshape so there is one owner.* Model the transfer as an immutable event appended to a single log, with balances as projections. One atomic append on one shard, and both balances derive from it. This trades read complexity for write simplicity and is what ledger systems actually do.

**What is genuinely lost with a saga, and worth saying plainly:** isolation. With 2PC or a single shard, no one observes the halfway state. With a saga they can — a balance query between the debit and the credit sees money missing. That is not a bug to fix; it is the trade, and it must be acceptable to the product before you choose it. Some domains tolerate it easily (an order that is briefly "pending payment") and some do not.

**Transferable:** when a transaction must span a boundary, the first question is whether the boundary can move. Partition-key choice is a correctness tool, not only a performance one, and most cross-shard transaction problems are better solved by not having them.`,
    },
    {
      id: 'al-tx-2',
      kind: 'debug',
      prompt:
        'A service reports occasional duplicate rows in a table with a UNIQUE constraint on `(user_id, slug)`. The constraint exists and is valid. Inserts go through one code path that first checks for an existing row. Roughly one duplicate appears per week among millions of inserts. How is this possible?',
      discussion: `The constraint is valid and duplicates exist, so either the duplicates do not actually violate it, or they were created when it was not enforced. Four hypotheses, and the first is the most likely.

**1. The duplicates differ in a way the constraint does not see.** A trailing space, different Unicode normalisation, different case. \`'my-post'\` and \`'my-post '\` are distinct values, so no violation occurred. The application considers them duplicates and the database does not. This is by far the commonest explanation for "duplicates despite a unique constraint", and it is a modelling defect rather than a concurrency one: the constraint is on a value the application does not canonicalise.

*Check:* compare the two rows byte for byte, and look for whitespace, case and normalisation differences.

**2. The constraint was added later, with existing duplicates, and created as non-validating.** Some databases allow a constraint to be added without checking existing rows. It then enforces new writes while pre-existing violations remain. Roughly one per week would be an odd distribution for this, but it is cheap to rule out.

*Check:* the constraint's validated flag, and whether the duplicate creation timestamps predate the constraint.

**3. Insert into a partitioned table where uniqueness is per partition.** If the table is partitioned and the unique index does not include the partition key, uniqueness holds within each partition only. Two rows with the same \`(user_id, slug)\` in different partitions are both legal. This is a real and easily missed trap.

*Check:* whether the table is partitioned and what the index definition actually covers.

**4. The check-then-insert race — and note what it does *not* cause.** Two concurrent requests both check, both find nothing, both insert. But with a valid unique constraint covering the whole table, **the second insert fails**. So this race causes user-visible errors, not duplicates. If the application catches and swallows that error, the symptom is a failed operation rather than a duplicate row.

Worth stating explicitly because it is the hypothesis people reach for first, and the constraint's existence rules it out. That is exactly why the constraint is valuable: it converts a race into a loud failure instead of silent corruption.

**What I would check, in order:** byte-level comparison of a duplicate pair (hypothesis 1), the constraint's validated state (2), the table's partitioning and the index definition (3).

**The structural fix regardless:** canonicalise the value before it reaches the database — trim, lowercase, normalise Unicode — and enforce that in the database too, via a generated column or an expression index on the canonical form. Then the application's notion of "same" and the database's coincide, which is the actual invariant you wanted.

**Transferable:** a unique constraint enforces uniqueness of *the stored value*, not of the meaning. Whenever the application's idea of identity involves normalisation, the constraint must be on the normalised form or the two will disagree — quietly, and roughly once a week.`,
    },
  ],

  revision: {
    bullets: [
      'Atomicity, consistency and durability have standard solutions. Isolation is a dial, and it is the hard one.',
      'An isolation level is a list of anomalies you have agreed to tolerate.',
      'Read Committed — the usual default — prevents only dirty reads. Non-repeatable reads, phantoms and write skew all remain.',
      'Lost update: two transactions compute an absolute value from a stale read and one write silently overwrites the other.',
      'Write skew: both read overlapping data, both decide correctly, both write *different* rows, no conflict detected.',
      'Repeatable Read stabilises reads and does not prevent write skew. Only Serializable does.',
      'Being inside a transaction is not mutual exclusion. Read-check-write is never safe by default.',
      'Fixes by cost: a constraint, a relative update, FOR UPDATE, reshaping the invariant, Serializable.',
      'FOR UPDATE locks the rows you read and cannot lock rows that do not exist yet — so it misses insert-based write skew.',
      'Serializable requires a retry wrapper: catch serialisation failures, re-run the whole transaction, bound attempts, back off.',
      'Under MVCC readers never block writers; writers still block writers on the same row.',
      'A long transaction — even read-only — pins a snapshot and prevents vacuum, causing bloat that points nowhere near its cause.',
      'Never call an external service inside a transaction: no rollback, and locks held for a third party\'s latency.',
      'Correct ordering: commit a durable pending record, then call out, then record the outcome, with an idempotency key.',
      'Prevent deadlocks by acquiring locks in a consistent order, sorted by primary key.',
      'Reshaping an invariant into single-row facts often beats strengthening isolation.',
      'A unique constraint enforces uniqueness of the stored value, not of the meaning — canonicalise first.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A transaction groups operations so they take effect together, and an isolation level specifies which concurrency anomalies remain possible while they do.',
    whyItExists:
      'Concurrent access to shared data admits interleavings that break invariants, and perfect isolation is expensive enough that databases offer weaker settings by default.',
    whenToUse: [
      'A constraint for every rule that fits within one row — the cheapest correctness available.',
      'FOR UPDATE for read-check-write against existing rows.',
      'Serializable, with a retry wrapper, for invariants spanning rows where reshaping is unavailable.',
    ],
    whenNotToUse: [
      'Around an external call — it cannot roll back and it holds locks for someone else\'s latency.',
      'Around a wait for human input — use optimistic concurrency with a version number.',
      'Serializable on a hot contended row, where abort-and-retry can be worse than explicit locking.',
    ],
    alternatives: [
      'Optimistic concurrency with a version column, for long-lived user-facing edits.',
      'Pre-created rows claimed by conditional update, turning a cross-row rule into single-row atomicity.',
      'An append-only event log with derived projections, when one owner for a write is achievable.',
      'A saga with compensations, when the operation must span a boundary a transaction cannot.',
    ],
    tradeoffs: [
      'Weaker isolation buys throughput and permits specific named anomalies.',
      'Serializable buys full isolation and introduces serialisation failures the application must retry.',
      'Explicit locks buy determinism and cost blocking plus deadlock risk on inconsistent ordering.',
      'Reshaping the invariant buys lock-free correctness and costs pre-created rows or derived counters.',
    ],
    failureModes: [
      'Lost update from read-modify-write with absolute assignment.',
      'Write skew breaking a cross-row invariant with no error anywhere.',
      'Deadlock from acquiring the same locks in different orders.',
      'Serialisation failures surfacing to users because no retry wrapper exists.',
      'A long transaction pinning a snapshot and bloating tables and indexes.',
      'An external call inside a transaction holding locks for seconds and leaving money moved with no record.',
      'A unique constraint bypassed because the application and the database disagree about what "same" means.',
    ],
    followUpQuestions: [
      'What isolation level is this running at, and what does that level permit?',
      'What serialises this read-check-write?',
      'Does the invariant span rows? If so, what stops write skew?',
      'What happens when a transaction aborts with a serialisation failure?',
      'In what order does this code acquire locks?',
      'How long does this transaction stay open, and what is it waiting for?',
    ],
  },
});
