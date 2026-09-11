import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-splitwise',
  title: 'Design Splitwise',
  summary:
    'A ledger at interview scale: balances are derived rather than stored, money is integer minor units, and the detail that separates a real answer is who gets the extra penny when ten pounds is split three ways.',
  phase: 'lld',
  module: 'machine-coding',
  position: 66,
  kind: 'machine-coding',
  difficulty: 'core',
  estimatedMinutes: 70,
  tags: ['ledger', 'money', 'split-strategies', 'simplification'],
  prerequisites: ['l-parking-lot'],
  resources: [
    {
      key: 'martin-fowler-ledger-accounting',
      tier: 'must',
      note: 'Read it again at this scale. The zero-sum property that made a payment system auditable is the same property that makes a shared-expense app correct, and here it is small enough to hold in your head.',
    },
    {
      key: 'martin-fowler-event-sourcing',
      tier: 'must',
      note: 'Read it for derived state and snapshots as a cache. Balances are the derived value here, and the rule that the log wins over the snapshot is what makes a balance defensible when a user disputes it.',
    },
    {
      key: 'fowler-cqrs',
      tier: 'good',
      note: 'Read it for the separation between what is written and what is read. Debt simplification is a read model — it changes who pays whom without changing what happened — and treating it as anything else loses the history.',
    },
    {
      key: 'refactoring-guru-patterns',
      tier: 'good',
      note: 'Read strategy with the split types in mind. This is a genuine case: five split methods named in the requirements, one interface, and a postcondition every implementation must satisfy.',
    },
    {
      key: 'refactoring-guru-solid',
      tier: 'advanced',
      note: 'Useful for the validation question — each split strategy has its own precondition, and deciding whether that belongs in the strategy or outside it is a responsibility-assignment problem with a defensible answer either way.',
    },
  ],

  intuition: {
    body: `This is the payments lesson at a scale you can hold in your head, and it has the same spine: **balances are derived, never stored.**

\`\`\`
Stored balance:  UPDATE balances SET amount = amount - 500
                 → no record of why
                 → no way to recompute
                 → a dropped update is permanently wrong,
                   silently
Derived balance: sum the expenses and settlements
                 → every balance is explainable
                 → and the sum of all balances in a group
                   is zero, which is a continuous self-check
\`\`\`

**The zero-sum invariant is what makes this correct rather than merely plausible**, and it is checkable after every operation: **if the members of a group do not sum to zero, something is wrong and you can say so immediately.**

Then the detail that separates a real answer from a sketch: **ten pounds split three ways.**

\`\`\`
1000 minor units ÷ 3 = 333.33…
333 + 333 + 333 = 999
→ one penny is unallocated
\`\`\`

**That penny must go to someone, deterministically.** If it is dropped, the shares do not sum to the expense and **the group's balances no longer sum to zero** — the invariant is broken by arithmetic rather than by a bug. If it is allocated randomly, **recomputing the same expense gives a different answer**, which makes the ledger non-reproducible.

**So every split strategy needs a remainder rule**, and it is the first thing to state.

**Third: splitting is genuinely several algorithms**, and the prompt names them — equal, exact amounts, percentages, shares, adjustments. **One interface with a postcondition every implementation must satisfy:** the shares sum exactly to the amount.

**And fourth, the one that is a product decision disguised as an algorithm: debt simplification.**

\`\`\`
A owes B £10, B owes C £10
→ simplified: A pays C £10, and B is out of it
\`\`\`

**The net balances are identical and the human meaning is not.** B may want to be paid by A and to pay C separately; **simplification changes who pays whom.** So it is a view over the ledger, **never a rewrite of it** — and it must be optional.`,
    analogyLimit:
      '"Track who owes whom" suggests a table of pairwise debts updated as expenses arrive, which is the stored-balance model and it loses the reason for every number. It also hides the two things that actually decide correctness: the remainder when an amount does not divide evenly, which breaks the zero-sum invariant if dropped, and the fact that debt simplification changes who pays whom — a product decision that must not overwrite what happened.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate stores a `balances` table keyed by (groupId, userA, userB) holding a floating-point amount, updated on each expense by dividing the total by the participant count. Settlements set the pair\'s balance to zero. Identify four problems and rank them.',
      answer: `**Problem 1 — floating point for money, which corrupts the data permanently.**

\`\`\`
10.00 / 3 = 3.3333333333333335
Three of those sum to 10.000000000000002
→ the group's balances do not sum to zero
→ and the error accumulates with every expense
\`\`\`

**Decimal fractions are not exactly representable in binary floating point**, so the residue is not a rounding display issue — **it is stored, it compounds, and it eventually shows a user a balance of £0.0000001 owed.**

*The fix is integer minor units*, and it immediately exposes the real problem: **1000 ÷ 3 does not divide evenly either**, so the remainder needs a rule rather than a data type.

**Problem 2 — stored balances with no record of why, which is the design error.**

**A pairwise balance table can be wrong and nothing detects it.** A dropped update, a partially applied expense, a bug in the division — **all produce a number that looks like a balance and cannot be checked against anything.**

**And the product needs the history anyway.** "Why do I owe Priya £42?" is the most common question this app must answer, **and a balance table cannot answer it.**

*The fix:* **store expenses with their shares, and settlements, as an append-only list.** Balances are a sum over that list, **which makes every balance explainable and makes the zero-sum property checkable.**

**Problem 3 — settlements setting a balance to zero destroys information and is wrong for partial payments.**

\`\`\`
A owes B £50. A pays £20.
Setting the pair's balance to zero: loses £30.
And there is no record that £20 moved.
\`\`\`

**A settlement is an event — A transferred £20 to B — not an assignment.** Recording it as an entry means the balance recomputes to £30 **and the payment appears in the history**, which is what both users will look for.

**Problem 4 — the pairwise key cannot represent a multi-payer expense, and it double-counts.**

\`\`\`
A pays £30 for A, B and C.
Pairwise: A↔B += 10, A↔C += 10
Now C pays £15 for A and C.
Pairwise: C↔A += 7.5  (and the float problem again)
\`\`\`

**It works until an expense has several payers**, which is common — two people split a hotel bill on two cards. **A pairwise model has to decompose that into synthetic pairs**, and the decomposition is ambiguous.

*The fix:* **an expense records who paid what and who owes what**, both as lists. Pairwise views are derived from that, not stored.

**Ranking. Problem 2 is the design error** — everything else follows from storing balances rather than events, including the inability to check anything. **Problem 1 corrupts data permanently and silently**, which makes it the most damaging in practice. Problem 3 loses money in an obvious way. Problem 4 is a modelling limit that appears as soon as the app is used for a holiday.

**What the corrected shape is.**

\`\`\`ts
interface Expense {
  id: ExpenseId; groupId: GroupId; currency: Currency;
  amountMinor: number;                      // integers, always
  paidBy: Array<{ user: UserId; amountMinor: number }>;
  owedBy: Array<{ user: UserId; amountMinor: number }>;
  at: number; createdBy: UserId;
}
// INVARIANT: sum(paidBy) === sum(owedBy) === amountMinor
\`\`\`

**Both sides listed, both summing to the total, in integer minor units** — and that one invariant per expense is what makes the group's zero-sum property hold by construction.

**The transferable diagnostic: if a number is stored and cannot be recomputed, nothing can check it.** The question to ask of any balance is "what would I compare this against?"`,
    },
  body: `## Requirements and the invariant

**Five questions, each with a consequence.**

\`\`\`
"Can several people pay for one expense?"   → paidBy is a list
"Which split methods?"                       → the strategy set
"Multiple currencies in one group?"          → per-currency balances
"Do users see who owes whom, or only net?"   → two read models
"Is debt simplification expected?"           → a view, optional
\`\`\`

\`\`\`
INVARIANT
  per expense: sum(paidBy) = sum(owedBy) = amountMinor
  per group per currency: sum over members of balance = 0
  a balance is a pure function of the expenses and settlements
  all amounts are integers in minor units
\`\`\`

**The second clause is the continuous self-check**, and it is cheap: **sum the members' balances after any operation and assert zero.** A non-zero sum means an expense whose shares do not add up, or a lost entry — **and it is detectable the moment it happens rather than when a user complains.**

## Money, and the remainder

\`\`\`ts
type Minor = number;          // integer minor units. Never a float.

/** Largest-remainder allocation: deterministic, sums exactly. */
function allocate(total: Minor, weights: number[]): Minor[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(w => (total * w) / totalWeight);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  // Hand the spare units to the largest fractional parts,
  // breaking ties by index so the result is reproducible.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (let k = 0; k < remainder; k++) out[order[k].i] += 1;
  return out;
}
\`\`\`

**Four properties worth stating.**

**It sums exactly to the total, by construction.** The floors under-allocate by at most \`n − 1\` units, and the loop distributes exactly that many — **so the per-expense invariant holds without a correction step.**

**It is deterministic.** Ties broken by index means **recomputing the same expense gives the same shares**, which is what makes the ledger reproducible and a dispute answerable.

**It is fair in the sense that matters.** The extra penny goes to whoever was closest to deserving it, **rather than always to the first participant** — which over many expenses distributes the rounding evenly.

*And the alternative worth naming:* **give the remainder to the payer.** Simpler, defensible, and it systematically favours or penalises the person who paid. **Largest-remainder is better and either is acceptable if stated** — what is not acceptable is dropping the penny or allocating it randomly.

## Split strategies

\`\`\`ts
interface SplitStrategy {
  /** POSTCONDITION: the returned shares sum to amountMinor. */
  split(amountMinor: Minor, participants: readonly UserId[],
        params: SplitParams): Result<Map<UserId, Minor>>;
}

class EqualSplit implements SplitStrategy {
  split(amount, participants) {
    const shares = allocate(amount, participants.map(() => 1));
    return ok(new Map(participants.map((u, i) => [u, shares[i]])));
  }
}

class ExactSplit implements SplitStrategy {          // amounts given
  split(amount, participants, { exact }) {
    const sum = [...exact.values()].reduce((a, b) => a + b, 0);
    if (sum !== amount)
      return err('exact-shares-must-sum-to-total',
                 { given: sum, expected: amount });
    return ok(exact);
  }
}

class PercentageSplit implements SplitStrategy {
  split(amount, participants, { percentBps }) {       // basis points
    const total = [...percentBps.values()].reduce((a, b) => a + b, 0);
    if (total !== 10_000)
      return err('percentages-must-sum-to-100', { given: total });
    const shares = allocate(amount, participants.map(u => percentBps.get(u)!));
    return ok(new Map(participants.map((u, i) => [u, shares[i]])));
  }
}
\`\`\`

**Four decisions worth defending.**

**Every strategy returns a result, not a throw.** "Your percentages add up to 97%" is a user-facing message, **and the caller needs the numbers to render it.**

**Percentages are basis points — integers — not floats.** \`33.33%\` three times is the same problem as the money split, **so the percentages themselves are integers and \`allocate\` handles the remainder.**

**Validation lives in the strategy.** Each has a different precondition — exact amounts must sum, percentages must total 100%, shares must be positive — **and only the strategy knows its own.** Putting the checks outside means a switch on strategy type at the call site, which is the branch the interface removed.

**And every strategy routes through \`allocate\`**, so the postcondition is satisfied by one function rather than five implementations each getting rounding right. *Adjustment splits* — equal but with a fixed amount added or subtracted per person — **are the case that tempts you to bypass it**, and they must not: subtract the adjustments, allocate the remainder equally, then add them back.

## Balances, derived

\`\`\`ts
type Balances = Map<UserId, Minor>;       // positive = is owed

function balancesOf(entries: readonly Entry[], currency: Currency): Balances {
  const b: Balances = new Map();
  const add = (u: UserId, d: Minor) => b.set(u, (b.get(u) ?? 0) + d);

  for (const e of entries) {
    if (e.currency !== currency) continue;     // never net across
    if (e.kind === 'expense') {
      for (const p of e.paidBy) add(p.user, +p.amountMinor);
      for (const o of e.owedBy) add(o.user, -o.amountMinor);
    } else {                                   // settlement
      add(e.from, +e.amountMinor);             // paying reduces debt
      add(e.to,   -e.amountMinor);
    }
  }
  return b;
}
\`\`\`

**Four things this gets right.**

**A settlement is an entry, not an assignment.** A partial payment recomputes to the remaining amount, **and the payment appears in the history** — which is what both parties look for.

**Currencies never net.** Balances are computed per currency, **and combining them requires an explicit conversion entry** with a recorded rate — the FX argument from the payments lesson, at a scale where it is one \`continue\`.

**The result sums to zero by construction**, because every expense adds and subtracts the same total and every settlement is a transfer. **So the invariant check is one line**, and it is worth running in tests and in development.

*And the cost:* recomputing over all entries. **For a group with a few thousand entries that is microseconds** — and if it ever mattered, a periodic snapshot with entries since is the answer, **with the log winning over the snapshot** exactly as in the payments and document lessons.

## Two read models: pairwise and net

**Both are needed, and they answer different questions.**

\`\`\`
NET:      "Alice is owed £42 overall"
          → one number per member, sums to zero
          → the input to simplification

PAIRWISE: "Alice is owed £12 by Bob and £30 by Carol"
          → who to actually pay
          → NOT derivable from net balances
\`\`\`

**The second point matters: pairwise cannot be reconstructed from net.** Net balances of \`A +30, B −10, C −20\` are consistent with several pairwise arrangements, **so if the product shows who owes whom, the pairwise view must be derived from the entries** rather than from the net.

\`\`\`ts
function pairwise(entries: readonly Entry[]): Map<PairKey, Minor> {
  // For each expense, attribute each ower's share to the payers
  // in proportion to what they paid — using allocate() again.
}
\`\`\`

**And the attribution uses \`allocate\`.** When two people paid for an expense, **each ower's share is split between them by the same remainder rule** — otherwise the pairwise view does not sum to the net view, and a user sees two numbers that disagree.

## Debt simplification

**The goal: reduce the number of transfers while preserving every net balance.**

\`\`\`
Greedy max-debtor / max-creditor:
  while any non-zero balance remains:
    d = the member with the most negative balance
    c = the member with the most positive balance
    t = min(|d|, c)
    record a transfer d → c of t
    adjust both balances
\`\`\`

**Three properties.**

**It produces at most n − 1 transfers for n members**, because each step zeroes at least one member. **That is a good bound and it is not the minimum** — minimising the transfer count exactly is NP-hard in general, since it requires finding subsets that sum to zero.

*So the honest statement is:* **greedy is at most n − 1 and usually near-optimal, and the exact minimum is not worth computing.** Saying that is better than claiming optimality.

**Every net balance is preserved exactly**, which is the correctness condition and the thing to test.

**And it is a view, never a rewrite.** The entries are unchanged; **simplification produces a suggested set of transfers.** When someone actually pays, a settlement entry is recorded as normal.

**The product caveat, which is the interesting part.**

\`\`\`
A owes B £10, B owes C £10
Simplified: A pays C £10
→ B is no longer involved
→ but B may have wanted A to pay THEM, and to pay C
  separately — the debts had meaning
\`\`\`

**Simplification changes who pays whom, and users notice.** So it must be **optional per group**, and the original pairwise view must remain available — **because the ledger records what happened and simplification is an opinion about how to settle it.**

## Tests

\`\`\`ts
test('shares always sum to the expense amount', () => {
  fc.assert(fc.property(fc.integer({min:1,max:1e7}), fc.array(...),
    (amount, weights) =>
      allocate(amount, weights).reduce((a,b)=>a+b,0) === amount));
});

test('10.00 split three ways allocates the penny deterministically', () => {
  expect(allocate(1000, [1,1,1])).toEqual([334, 333, 333]);
  expect(allocate(1000, [1,1,1])).toEqual([334, 333, 333]);  // again
});

test('group balances sum to zero after any sequence', () => {
  // apply 200 random expenses and settlements
  expect(sum([...balancesOf(entries, 'GBP').values()])).toBe(0);
});

test('a partial settlement leaves the remainder', () => {
  // A owes B 5000; A settles 2000 → A owes 3000
});

test('simplification preserves every net balance', () => {
  const before = balancesOf(entries, 'GBP');
  const after  = applyTransfers(before, simplify(before));
  expect([...after.values()].every(v => v === 0)).toBe(true);
});

test('percentages that do not sum to 100 are rejected with the total', () => { /* ... */ });
\`\`\`

**The first is a property test and it is the right shape here**, because the postcondition is universal: **whatever the amount and weights, the shares sum to the amount.** A handful of examples cannot establish that and a property test can.

**And the third is the invariant check** — the analogue of the ledger's zero-sum, run after a random sequence rather than after one operation.

## What to say in the last three minutes

**That balances are derived, so every one is explainable and the group sums to zero.**

**Integer minor units, and the remainder rule** — largest-remainder, deterministic, ties broken by index.

**That every split strategy routes through one allocation function**, so the postcondition is satisfied in one place.

**That settlements are entries, so partial payments work and the payment is in the history.**

**That simplification is a view with an n − 1 bound**, that the exact minimum is NP-hard, **and that it changes who pays whom — so it is optional.**

**And what you left out:** currency conversion entries, recurring expenses, receipts and attachments, and notifications.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'derived-not-stored',
      title: 'Entries are the truth; everything else is derived',
      caption:
        'Step through it. Three different views come from one list, and the invariant that makes all of them trustworthy is checkable in a single line.',
      nodes: [
        { id: 'expense', label: 'Expense: paidBy[] and owedBy[]', kind: 'store', x: 0, y: 40, detail: 'Both sides are lists and both sum to the amount, which is what makes the group total zero by construction. A single payer field cannot represent two people splitting a hotel bill on two cards — common enough that the pairwise model breaks on the first holiday.' },
        { id: 'settle', label: 'Settlement: an entry, not an assignment', kind: 'store', x: 0, y: 190, detail: 'A partial payment recomputes to the remaining amount and appears in the history — which is what both parties look for. Setting a pair balance to zero loses the money and the record of it.' },
        { id: 'alloc', label: 'allocate(total, weights)', kind: 'service', x: 250, y: 110, detail: 'Largest-remainder: floor everything, then hand the spare units to the largest fractional parts, ties broken by index. Sums exactly by construction, and deterministic — so recomputing an expense gives the same shares and a dispute has an answer.' },
        { id: 'strategies', label: 'Split strategies route through it', kind: 'service', x: 500, y: 40, detail: 'Equal, exact, percentage, shares, adjustment — five algorithms, one postcondition. Each validates its own precondition and returns a result, because "your percentages add up to 97%" is a message the caller must render.' },
        { id: 'net', label: 'Net balances (sum to zero)', kind: 'service', x: 500, y: 200, detail: 'One number per member per currency. Currencies never net without an explicit conversion entry — the FX argument from the payments lesson, here a single continue.' },
        { id: 'pair', label: 'Pairwise view', kind: 'service', x: 750, y: 120, detail: 'Who to actually pay. NOT derivable from net balances — the same net totals are consistent with several pairwise arrangements — so it must be derived from the entries, attributing each ower\'s share across payers with allocate again.' },
        { id: 'simplify', label: 'Simplification: a view, never a rewrite', kind: 'note', x: 750, y: 290, detail: 'Greedy max-debtor to max-creditor gives at most n−1 transfers; the exact minimum is NP-hard and not worth computing. And it changes who pays whom, which users notice — so it is optional and the entries are untouched.' },
        { id: 'check', label: 'Sum of balances = 0', kind: 'note', x: 250, y: 290, detail: 'The continuous self-check, one line. A non-zero sum means an expense whose shares do not add up or a lost entry — detectable the moment it happens rather than when a user complains.' },
      ],
      edges: [
        { id: 's1', source: 'expense', target: 'alloc', kind: 'control' },
        { id: 's2', source: 'settle', target: 'net', kind: 'read' },
        { id: 's3', source: 'alloc', target: 'strategies', kind: 'control' },
        { id: 's4', source: 'expense', target: 'net', kind: 'read' },
        { id: 's5', source: 'net', target: 'pair', kind: 'control' },
        { id: 's6', source: 'net', target: 'simplify', kind: 'control' },
        { id: 's7', source: 'net', target: 'check', kind: 'control' },
      ],
      steps: [
        {
          id: 'ss1',
          title: 'Both sides of an expense are lists',
          description:
            'paidBy and owedBy each sum to the amount, so the group total is zero by construction. A single payer field breaks on the first shared hotel bill.',
          nodes: ['expense', 'settle'],
          edges: [],
        },
        {
          id: 'ss2',
          title: 'One allocation function owns the remainder',
          description:
            'Ten pounds split three ways leaves a penny. Dropping it breaks the invariant by arithmetic; allocating it randomly makes the ledger non-reproducible. Largest-remainder does both jobs.',
          nodes: ['alloc'],
          edges: ['s1'],
        },
        {
          id: 'ss3',
          title: 'And every strategy routes through it',
          description:
            'Five split methods, one postcondition satisfied in one place — including adjustment splits, which are the case that tempts you to bypass it.',
          nodes: ['strategies'],
          edges: ['s3'],
        },
        {
          id: 'ss4',
          title: 'Balances are summed, never stored',
          description:
            'Every balance is explainable, a partial settlement recomputes correctly, and the sum over members is zero — a self-check that runs in one line after any operation.',
          nodes: ['net', 'check'],
          edges: ['s2', 's4', 's7'],
        },
        {
          id: 'ss5',
          title: 'Two views, and one of them is an opinion',
          description:
            'Pairwise comes from the entries because net cannot reconstruct it. Simplification preserves every net balance, bounds transfers at n−1, and changes who pays whom — so it stays a view.',
          nodes: ['pair', 'simplify'],
          edges: ['s5', 's6'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'the-penny',
      title: 'Ten pounds, three ways, one penny',
      caption:
        'Read the three branches as what happens to the remainder. Only the third keeps both the invariant and reproducibility, and stating which you chose is what an interviewer is listening for.',
      code: `flowchart TB
    A["**£10.00 split three ways**<br/>1000 minor units ÷ 3<br/>= 333.33…"]

    A --> D["**Drop the remainder**<br/>333 + 333 + 333 = 999"]
    D --> D1["**The shares no longer sum<br/>to the expense**<br/>→ the group's balances stop<br/>summing to zero<br/>→ the invariant is broken by<br/>arithmetic, not by a bug"]

    A --> R["**Allocate it randomly**<br/>or to whoever the loop<br/>reaches first"]
    R --> R1["Sums correctly, and<br/>**recomputing the same<br/>expense gives a different<br/>answer**<br/>→ the ledger is not<br/>reproducible, so a dispute<br/>has no answer"]

    A --> L["**Largest remainder**<br/>floor everything, hand the<br/>spare units to the largest<br/>fractional parts, ties<br/>broken by index"]
    L --> L1["334 + 333 + 333 = 1000 ✓<br/>**deterministic** ✓<br/>and the extra unit goes to<br/>whoever was closest to<br/>deserving it"]

    L1 --> N["**And every split strategy<br/>routes through the same<br/>function** — equal, percentage,<br/>shares, adjustment — so the<br/>postcondition is satisfied in<br/>one place rather than five"]

    style D1 fill:#40181c,stroke:#b4535e
    style R1 fill:#40181c,stroke:#b4535e
    style L1 fill:#17272a,stroke:#35897e
    style N fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The published writing on ledgers and on event sourcing together describe this design, and the useful thing is how small the ideas become at this scale.

**The ledger argument is that a balance should be derived from immutable entries rather than stored as a mutable number**, because a stored balance has no explanation and nothing to check it against. **In a payment system that argument justifies an entire subsystem; here it justifies not writing an \`UPDATE\` statement** — and the benefit is identical: every balance is explainable, and the sum is a continuous self-check.

**The event-sourcing material adds the snapshot relationship**: a derived value may be cached, and **if the cache disagrees with the log, the log wins.** Which is the rule that makes a disputed balance answerable — **you recompute, rather than arguing about a number nobody can trace.**

**And the read-model separation is what licenses debt simplification.** A simplified set of transfers is a projection over the entries, **shaped for a purpose, and it does not claim to be what happened.** Treating it as a rewrite would destroy the history that makes the app trustworthy.

**Three transferable lessons.**

**"What would I compare this number against?" is the test for any stored value.** A stored balance has no answer; a derived one compares against its own recomputation, **and the group's total compares against zero.**

**A projection may reorganise, but it must preserve the quantity it projects.** Simplification changes who pays whom and preserves every net balance exactly — **and the preservation is the property to test**, not the transfer count.

**And derived state is cheap at small scale.** A few thousand entries recomputed per view is microseconds, **so the snapshot is an optimisation you can defer** — which is worth saying, because candidates often add caching before there is anything to cache.

**Where these references do not help.** They say nothing about the remainder problem, which is the detail that decides whether the invariant holds at all — **and nothing about simplification being a product decision rather than an algorithm.** Both are specific to splitting money between people, and both are what an interviewer probes.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, most of which follow from deriving balances rather than storing them.',
    rows: [
      {
        option: 'Floating-point amounts',
        whenItWins:
          'Nowhere for money.',
        whenItLoses:
          'Decimal fractions are not exactly representable, so the residue is stored and compounds until a user sees a balance of a fraction of a penny.',
        cost:
          'Permanently corrupted data that no rounding on display can repair.',
      },
      {
        option: 'Integer minor units',
        whenItWins:
          'Always. Exact arithmetic, and the invariant stays meaningful.',
        whenItLoses:
          'Division still leaves a remainder, so a rule is required.',
        cost:
          'An allocation function, which you needed anyway.',
      },
      {
        option: 'Dropping the division remainder',
        whenItWins:
          'Nowhere.',
        whenItLoses:
          'The shares no longer sum to the expense, so group balances stop summing to zero — the invariant broken by arithmetic.',
        cost:
          'A self-check that fires constantly, or worse, one that was never written.',
      },
      {
        option: 'Giving the remainder to the payer',
        whenItWins:
          'Simplicity, and it is defensible if stated.',
        whenItLoses:
          'It systematically favours or penalises the same person across many expenses.',
        cost:
          'A small persistent unfairness.',
      },
      {
        option: 'Largest-remainder allocation',
        whenItWins:
          'The right default: sums exactly, deterministic, and distributes the rounding evenly over time.',
        whenItLoses:
          'Slightly more code than a floor-and-adjust.',
        cost:
          'A sort per split, which is nothing at these sizes.',
      },
      {
        option: 'Stored pairwise balances',
        whenItWins:
          'Nowhere. It is the intuitive model.',
        whenItLoses:
          'No record of why, nothing to check against, and it cannot represent an expense with several payers.',
        cost:
          'Unanswerable disputes, and silent divergence.',
      },
      {
        option: 'Derived balances over an entry list',
        whenItWins:
          'Always. Every balance is explainable and the group sums to zero as a check.',
        whenItLoses:
          'Recomputation cost, which is microseconds at this scale.',
        cost:
          'A snapshot later, if a group ever grows large enough to need one.',
      },
      {
        option: 'Settlements as assignments to zero',
        whenItWins:
          'Nowhere. It is what "settle up" suggests.',
        whenItLoses:
          'A partial payment loses the remainder, and the payment itself is not recorded.',
        cost:
          'Money disappearing from the history.',
      },
      {
        option: 'Settlements as entries',
        whenItWins:
          'Always. Partial payments recompute correctly and appear in the history.',
        whenItLoses:
          'Nothing.',
        cost:
          'One more entry kind.',
      },
      {
        option: 'Validation outside the split strategies',
        whenItWins:
          'When validation is genuinely shared across all of them.',
        whenItLoses:
          'Each strategy has a different precondition, so external validation needs a switch on strategy type — the branch the interface removed.',
        cost:
          'The abstraction leaking back to the call site.',
      },
      {
        option: 'Validation inside each strategy, returning a result',
        whenItWins:
          'Always here. Only the strategy knows its own precondition, and the caller gets the numbers to render a message.',
        whenItLoses:
          'Each implementation carries a little validation code.',
        cost:
          'Slight duplication of shape, not of logic.',
      },
      {
        option: 'Net balances only',
        whenItWins:
          'When the product only ever shows an overall figure.',
        whenItLoses:
          'Pairwise cannot be reconstructed from net — the same totals are consistent with several arrangements.',
        cost:
          'The "who do I actually pay" question becomes unanswerable.',
      },
      {
        option: 'Simplification as a rewrite of the entries',
        whenItWins:
          'Nowhere. It appears to tidy the data.',
        whenItLoses:
          'It destroys the history that makes a balance defensible, and it changes who owes whom without a record.',
        cost:
          'The ledger, which was the design.',
      },
      {
        option: 'Simplification as an optional view',
        whenItWins:
          'Always. Preserves every net balance, bounded at n − 1 transfers, and reversible because nothing was written.',
        whenItLoses:
          'Users may dislike being removed from a debt they cared about.',
        cost:
          'A per-group setting, and the pairwise view remaining available.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"A balances table keyed by the pair of users, updated when an expense is added."',
      whyWeak:
        'A stored balance has no record of why it is what it is, so the app cannot answer "why do I owe Priya £42?" — which is the question it exists to answer. And nothing can check the number: a dropped update or a bad division produces a value that looks like a balance and diverges silently.',
      strongAnswer:
        '"Expenses and settlements are an append-only list and balances are summed from them. Every balance is then explainable, a partial settlement recomputes correctly, and the sum of all members\' balances in a currency is zero — which is a continuous self-check I can run in one line after any operation. The recomputation is microseconds for a few thousand entries, so a snapshot is an optimisation I would defer until a group needed one, with the log winning if they ever disagree."',
    },
    {
      weakAnswer: '"Amounts are stored as decimals — dividing 10.00 by 3 gives 3.33 each."',
      whyWeak:
        'Two problems. Floating point cannot represent decimal fractions exactly, so the residue is stored and compounds. And 3.33 three times is 9.99: a penny is unallocated, so the shares no longer sum to the expense and the group\'s balances stop summing to zero.',
      strongAnswer:
        '"Integer minor units throughout, and a single allocation function that handles the remainder by largest-remainder: floor every share, then hand the spare units to the largest fractional parts with ties broken by index. It sums exactly by construction and it is deterministic, so recomputing an expense gives the same shares and a dispute has an answer. Giving the penny to the payer is also defensible — what is not is dropping it or allocating it randomly."',
    },
    {
      weakAnswer: '"Each split type is its own method on the expense service: splitEqually, splitByPercentage, splitExactly."',
      whyWeak:
        'It puts a branch at every call site and duplicates the rounding logic across methods, so each one has to get the remainder right independently — and one of them will not.',
      strongAnswer:
        '"One strategy interface with a postcondition that the shares sum to the amount, and every implementation routes through the same allocation function so the rounding is right in one place. Each strategy validates its own precondition and returns a result rather than throwing — exact amounts must sum to the total, percentages must total 100% — because only the strategy knows its own rule, and the caller needs the numbers to tell the user what is wrong."',
    },
    {
      weakAnswer: '"Settling up sets the balance between the two users to zero."',
      whyWeak:
        'It cannot represent a partial payment — someone paying £20 of a £50 debt loses the remaining £30 — and it records no evidence that money moved, which is exactly what both parties will look for.',
      strongAnswer:
        '"A settlement is an entry like any other: A transferred £20 to B, recorded with a timestamp. The balance recomputes to £30 automatically and the payment appears in the history. It is the same argument as the payments lesson — money is never un-taken, the ledger only grows — and it is what makes a partial settlement work without any special case."',
    },
    {
      weakAnswer: '"Debt simplification finds the minimum number of transactions that settle the group."',
      whyWeak:
        'Minimising the transfer count exactly is NP-hard, since it requires finding subsets that sum to zero — so claiming the minimum is claiming something the implementation will not deliver.',
      strongAnswer:
        '"Greedy matching of the largest debtor to the largest creditor gives at most n−1 transfers for n members, because each step zeroes at least one person. That is a good bound and it is not the minimum — the exact minimum is NP-hard and not worth computing. The property I would test is that every net balance is preserved exactly, which is the correctness condition; the transfer count is a quality measure rather than a guarantee."',
    },
    {
      weakAnswer: '"After simplification, update the balances so the group is settled through the simplified transfers."',
      whyWeak:
        'It rewrites the ledger with an opinion. The entries record what happened; simplification is a suggestion about how to settle, and overwriting the history destroys the thing that makes any balance defensible.',
      strongAnswer:
        '"Simplification is a view over the entries and never a rewrite. When someone actually pays, that is a settlement entry recorded normally. And it is optional per group, because it changes who pays whom: if A owes B and B owes C, simplifying to A pays C removes B from a debt they may have cared about — the net balances are identical and the human meaning is not, which makes it a product decision rather than an algorithm."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lsp-1',
      front: 'Why derive balances rather than store them?',
      back: 'A stored balance has no explanation and nothing to check it against; a derived one is explainable, recomputable, and its group total is a continuous self-check.',
      topic: 'ledger',
    },
    {
      id: 'fc-lsp-2',
      front: 'What is the group invariant, and how is it checked?',
      back: 'The sum of all members\' balances per currency is zero. Checked in one line after any operation — a non-zero sum means a bad split or a lost entry.',
      topic: 'ledger',
    },
    {
      id: 'fc-lsp-3',
      front: 'Why must an expense record both paidBy and owedBy as lists?',
      back: 'Several people can pay for one expense, and both sides must sum to the amount — which is what makes the group total zero by construction.',
      topic: 'ledger',
    },
    {
      id: 'fc-lsp-4',
      front: 'Why are floats wrong for money here?',
      back: 'Decimal fractions are not exactly representable, so the residue is stored and compounds until a user sees a fraction of a penny.',
      topic: 'money',
    },
    {
      id: 'fc-lsp-5',
      front: 'What happens if the division remainder is dropped?',
      back: 'The shares stop summing to the expense, so group balances stop summing to zero — the invariant broken by arithmetic rather than by a bug.',
      topic: 'money',
    },
    {
      id: 'fc-lsp-6',
      front: 'What happens if the remainder is allocated randomly?',
      back: 'The total is right and recomputing the same expense gives different shares, so the ledger is not reproducible and a dispute has no answer.',
      topic: 'money',
    },
    {
      id: 'fc-lsp-7',
      front: 'How does largest-remainder allocation work?',
      back: 'Floor every share, then hand the spare units to the largest fractional parts, with ties broken by index for determinism.',
      topic: 'money',
    },
    {
      id: 'fc-lsp-8',
      front: 'Why must every split strategy route through one allocation function?',
      back: 'So the sums-to-total postcondition is satisfied in one place rather than in five implementations that each have to get rounding right.',
      topic: 'split-strategies',
    },
    {
      id: 'fc-lsp-9',
      front: 'Why does validation live inside each split strategy?',
      back: 'Each has a different precondition, so validating outside needs a switch on strategy type — the branch the interface removed.',
      topic: 'split-strategies',
    },
    {
      id: 'fc-lsp-10',
      front: 'Why is a settlement an entry rather than an assignment?',
      back: 'A partial payment recomputes to the remainder automatically, and the payment appears in the history — which is what both parties look for.',
      topic: 'ledger',
    },
    {
      id: 'fc-lsp-11',
      front: 'Why can the pairwise view not be derived from net balances?',
      back: 'The same net totals are consistent with several pairwise arrangements, so pairwise must be computed from the entries.',
      topic: 'simplification',
    },
    {
      id: 'fc-lsp-12',
      front: 'What bound does greedy debt simplification give, and is it optimal?',
      back: 'At most n−1 transfers, because each step zeroes someone. Not optimal — the exact minimum is NP-hard and not worth computing.',
      topic: 'simplification',
    },
    {
      id: 'fc-lsp-13',
      front: 'What property must simplification preserve, and what is it not?',
      back: 'Every net balance exactly. It is not a rewrite of the entries — it is an optional view, because it changes who pays whom.',
      topic: 'simplification',
    },
    {
      id: 'fc-lsp-14',
      front: 'Why are balances computed per currency?',
      back: 'Netting across currencies without an explicit conversion entry and a recorded rate destroys the value — the FX argument from the payments lesson, here one continue.',
      topic: 'money',
    },
  ],

  quiz: [
    {
      id: 'q-lsp-1',
      kind: 'scenario',
      prompt:
        '£10.00 is split equally three ways in integer minor units. What must happen to the remaining penny?',
      options: [
        { id: 'a', label: 'It is allocated deterministically — largest remainder, or to the payer — so the shares sum exactly and recomputation is reproducible' },
        { id: 'b', label: 'It is dropped; a penny does not matter' },
        { id: 'c', label: 'It is allocated to a random participant so nobody is systematically favoured' },
        { id: 'd', label: 'The amount is stored as a decimal so the division is exact' },
      ],
      correct: ['a'],
      explanation:
        'Dropping it breaks the zero-sum invariant by arithmetic, and random allocation makes the ledger non-reproducible so a dispute has no answer. Option d does not help — decimals cannot represent a third either, and floats add a second problem on top.',
      difficulty: 'core',
      topic: 'money',
    },
    {
      id: 'q-lsp-2',
      kind: 'scenario',
      prompt:
        'A user asks why they owe £42. What does a stored pairwise balance table give them?',
      options: [
        { id: 'a', label: 'The number and nothing else — a stored balance has no record of why, and nothing to check it against' },
        { id: 'b', label: 'A full breakdown, since the balance was computed from expenses' },
        { id: 'c', label: 'The most recent expense that changed it' },
        { id: 'd', label: 'Nothing, but the number is guaranteed correct' },
      ],
      correct: ['a'],
      explanation:
        'The explanation was discarded when the balance was written, which also means a dropped update or a bad split produces a value that looks like a balance and diverges silently. Option d states the opposite of the truth: a number with nothing to compare against is precisely the one that cannot be guaranteed.',
      difficulty: 'core',
      topic: 'ledger',
    },
    {
      id: 'q-lsp-3',
      kind: 'scenario',
      prompt:
        'A owes B £50 and pays £20. What should the system record?',
      options: [
        { id: 'a', label: 'A settlement entry of £20 from A to B; the balance recomputes to £30 and the payment is in the history' },
        { id: 'b', label: 'Set the A–B balance to zero, since they settled' },
        { id: 'c', label: 'Reduce the stored balance by 20' },
        { id: 'd', label: 'Delete the original expense and re-add it at £30' },
      ],
      correct: ['a'],
      explanation:
        'A settlement is an event, not an assignment. Option b loses £30 and the record of the payment; option c works arithmetically and still leaves no evidence money moved; option d rewrites history to express a payment, which destroys what actually happened.',
      difficulty: 'core',
      topic: 'ledger',
    },
    {
      id: 'q-lsp-4',
      kind: 'scenario',
      prompt:
        'Net balances are A +30, B −10, C −20. Can the pairwise view be reconstructed from these?',
      options: [
        { id: 'a', label: 'No — several pairwise arrangements produce the same net totals, so it must be derived from the entries' },
        { id: 'b', label: 'Yes, by matching each debtor to each creditor proportionally' },
        { id: 'c', label: 'Yes, since the totals uniquely determine the pairs' },
        { id: 'd', label: 'Only if there are exactly three members' },
      ],
      correct: ['a'],
      explanation:
        'B and C might each owe A directly, or B might owe C who owes A — both give these totals. Option b produces a valid settlement plan, which is what simplification does, but it is not a reconstruction of what actually happened.',
      difficulty: 'advanced',
      topic: 'simplification',
    },
    {
      id: 'q-lsp-5',
      kind: 'scenario',
      prompt:
        'A owes B £10 and B owes C £10. Simplification suggests A pays C £10. What is the concern?',
      options: [
        { id: 'a', label: 'The net balances are identical and the human meaning is not — B is removed from debts they may have cared about, so it must be optional' },
        { id: 'b', label: 'The net balances no longer match' },
        { id: 'c', label: 'It increases the number of transfers' },
        { id: 'd', label: 'None — fewer transfers is strictly better' },
      ],
      correct: ['a'],
      explanation:
        'Simplification is correct arithmetically and is a product decision: it changes who pays whom. Which is also why it must be a view rather than a rewrite — the entries record what happened, and the suggestion is an opinion about how to settle it.',
      difficulty: 'advanced',
      topic: 'simplification',
    },
    {
      id: 'q-lsp-6',
      kind: 'multi',
      prompt:
        'Which of these are genuine reasons to derive balances rather than store them? Select all that apply.',
      options: [
        { id: 'a', label: 'Every balance becomes explainable, which is the app\'s most common question' },
        { id: 'b', label: 'The sum over members is zero, giving a continuous self-check' },
        { id: 'c', label: 'A partial settlement recomputes correctly with no special case' },
        { id: 'd', label: 'It is faster than reading a stored number' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the substance, and they are the same three reasons as in the payments lesson at a smaller scale. Derivation is slower than a lookup — microseconds for a few thousand entries, which is why a snapshot is an optimisation you can defer rather than a requirement.',
      difficulty: 'core',
      topic: 'ledger',
    },
  ],

  exercises: [
    {
      id: 'ex-lsp-1',
      kind: 'implement',
      title: 'Edit an expense, then add a currency, then find what breaks',
      estimatedMinutes: 45,
      prompt: `Extend the design with three capabilities. For each, write the signatures and say what changes in the invariant.

**Part 1 — editing and deleting an expense.** A user corrects an amount entered last week, or deletes an expense added by mistake.

**Part 2 — multi-currency groups.** A trip where some expenses are in euros and some in pounds, with members settling in their own currency.

**Part 3 — a "simplify on settle" mode.** When a user taps settle up, the app suggests the simplified transfers rather than the pairwise ones.

**Part 4.** One of these three cannot preserve the design's central property without an additional decision. Identify it and give the options.

Then answer:

- In Part 1, should an edit mutate the expense or append a correction?
- In Part 2, what happens when a member's balance is positive in one currency and negative in another?`,
      rubric: [
        'Edit modelled as an appended correction rather than a mutation, with reasoning.',
        'Delete modelled as a reversal entry preserving history.',
        'Multi-currency balances kept per currency with no implicit netting.',
        'Identifies conversion as requiring an explicit entry with a recorded rate.',
        'Simplify-on-settle produces settlement entries matching what was actually paid.',
        'Identifies multi-currency as the capability needing an extra decision.',
        'Gives at least two options with costs.',
        'Answers the mutate-versus-append question with the audit argument.',
        'Handles the cross-currency balance question without netting silently.',
      ],
      modelAnswer: `**Part 1 — editing and deleting: append, never mutate**

\`\`\`ts
type Entry =
  | { kind: 'expense'; id: EntryId; /* ... */ }
  | { kind: 'settlement'; id: EntryId; /* ... */ }
  | { kind: 'reversal'; id: EntryId; reverses: EntryId;
      by: UserId; at: number; reason?: string };

function balancesOf(entries: readonly Entry[], cur: Currency): Balances {
  const reversed = new Set(
    entries.filter(e => e.kind === 'reversal').map(e => e.reverses));
  for (const e of entries) {
    if (reversed.has(e.id)) continue;      // ← skip what was undone
    // ... as before
  }
}

// Edit = reversal + a new expense, in one atomic append:
function editExpense(original: ExpenseId, corrected: ExpenseInput): void {
  append([ reversal(original), expense(corrected, { supersedes: original }) ]);
}
\`\`\`

**Three decisions worth defending.**

**A delete is a reversal entry, not a removal.** The expense stays; **a later entry says it no longer counts.** So the history shows the mistake and its correction — **which is what a group member wants when a £200 expense disappears from their balance overnight.**

**An edit is a reversal plus a replacement**, appended together. **Mutating the original would silently change everyone's balance with no record of who changed it or when**, and "my balance changed and I do not know why" is the worst outcome this app can produce.

**And the reversal set is computed once per recomputation.** Balances remain a pure function of the entry list, **so the derivation stays simple** — one extra set membership test, and nothing else changes.

*The invariant is unchanged*, which is the point: **the group still sums to zero after any sequence of edits and deletions**, because a reversal removes exactly the entry it names.

*One subtlety worth stating:* **a reversal of an already-reversed entry should be rejected**, or two reversals cancel a single entry once and the arithmetic is still right but the history reads as nonsense. **A guard, and a state that says so.**

---

**Part 2 — multi-currency groups**

\`\`\`ts
function balancesByCurrency(entries: readonly Entry[])
    : Map<Currency, Balances> {
  const out = new Map<Currency, Balances>();
  for (const cur of currenciesIn(entries))
    out.set(cur, balancesOf(entries, cur));
  return out;
}

// Conversion is an EXPLICIT entry, never implicit:
type Conversion = {
  kind: 'conversion'; id: EntryId;
  user: UserId;
  from: { currency: Currency; amountMinor: Minor };
  to:   { currency: Currency; amountMinor: Minor };
  rate: number; rateSource: string; at: number;
};
\`\`\`

**Three decisions.**

**Balances are per currency and never netted.** A member owed €50 and owing £30 has **two balances**, not one — **and each currency's total is zero independently**, which preserves the self-check exactly.

**A conversion is an entry with a recorded rate and source.** It debits one currency and credits another for one user, **so each currency's zero-sum still holds** — the same structure as the FX position accounts from the payments lesson, at a scale where it is one entry rather than an account.

**And the rate is recorded, not derived from the amounts.** Dividing one amount by the other gives a number and **says nothing about when or from where** — which is the whole content of a disputed conversion.

*The invariant gains a clause:* **each currency sums to zero independently, and a conversion is the only entry that touches two currencies** — appearing in both, balanced in neither alone but balanced within each by construction.

*Wait — that needs care, and it is the part worth getting right.* A conversion for one user is **not** balanced within a currency by itself:

\`\`\`
user A converts €50 → £43
  EUR: A −5000    ← who is the counterparty?
  GBP: A +4300
\`\`\`

**So a conversion between two members is a transfer** (A gives B €50, B gives A £43) and balances in both currencies. **A conversion against the outside world does not**, and the honest model is that the group cannot absorb it — **so a real conversion must be a settlement between two members at an agreed rate**, which is what actually happens when friends settle across currencies. **That is the additional decision Part 4 is about.**

---

**Part 3 — simplify on settle**

\`\`\`ts
interface SettlementSuggestion {
  transfers: Array<{ from: UserId; to: UserId; amountMinor: Minor }>;
  mode: 'pairwise' | 'simplified';
}

function suggest(entries: readonly Entry[], cur: Currency,
                 mode: Mode): SettlementSuggestion {
  const net = balancesOf(entries, cur);
  return mode === 'simplified'
    ? { mode, transfers: greedySimplify(net) }
    : { mode, transfers: fromPairwise(entries, cur) };
}

// When the user actually pays, record what THEY did:
function recordSettlement(from: UserId, to: UserId, amt: Minor): void {
  append([{ kind: 'settlement', from, to, amountMinor: amt, at: now() }]);
}
\`\`\`

**Two decisions.**

**The suggestion is not recorded.** Only the payment is. **If a user is shown "pay Carol £30" and instead pays Bob £30, the entry says Bob** — because the ledger records what happened, and the suggestion was advice.

**And the mode is a per-group setting surfaced in the response.** The user should know which view they are looking at, **since the two produce different instructions from the same balances** — and a user who expected to pay Bob will ask why the app said Carol.

*The invariant is unchanged*, because nothing is written until money moves. **That is the payoff of keeping simplification a view**: the feature is additive and carries no consistency risk at all.

---

**Part 4 — the capability needing an extra decision**

**Multi-currency, and the decision is what a cross-currency settlement means.**

**The design's central property is that each currency's balances sum to zero.** Within a currency that holds automatically — every expense adds and subtracts the same total. **Across currencies it cannot**, because a member settling a euro debt with pounds moves value between two independent zero-sum systems.

\`\`\`
A owes B €50. A pays B £43.
  EUR: A's debt should reduce by 5000
  GBP: nothing in the group required this
→ if recorded as a GBP settlement, EUR still shows the debt
→ if recorded as a EUR settlement, the £43 is invisible
→ either way one currency's story is wrong
\`\`\`

**Three options.**

**(a) Forbid cross-currency settlement.** Each debt is settled in its own currency; members handle conversion outside the app.

\`\`\`
Simplest, and each currency's invariant holds untouched.
Cost: it does not match what people do — they settle once,
      in one currency, and expect the app to cope.
\`\`\`

**(b) A conversion entry as an agreed two-sided transfer.** A pays B £43 *and* B forgives €50, recorded as one entry with both legs and the rate.

\`\`\`
  EUR: A +5000, B −5000      ← balanced
  GBP: A −4300, B +4300      ← balanced
  plus rate and source, recorded
Both invariants hold, and the rate is auditable.
Cost: it requires both parties to agree a rate, which is
      a product flow rather than just a data model.
\`\`\`

**This is what I would build**, because it matches the real interaction — **two people agreeing "call it forty-three pounds"** — and it keeps every currency's self-check intact.

**(c) A group base currency with conversion at expense time.** Every expense is converted to the base when recorded.

\`\`\`
One currency, one invariant, simplest balances.
Cost: the recorded amount is no longer what was paid, so a
      receipt and the app disagree — and a later rate change
      cannot be reflected without rewriting history.
\`\`\`

**Option (c) is tempting and it loses the property that made the ledger trustworthy:** the entry no longer records what happened. **I would reject it for that reason**, and say so.

*And the general observation:* **the zero-sum invariant is per closed system**, and a currency is a closed system. **Anything crossing the boundary has to be a two-sided entry or the boundary is being crossed silently** — which is the same conclusion the payments lesson reached with FX position accounts, arrived at from a much smaller starting point.

---

**Should an edit mutate the expense or append a correction?**

**Append, and there are three separate arguments — only the first is about correctness.**

**The audit argument.** A mutated expense changes everyone's balance with no record of who changed it, when, or what it was before. **"My balance changed overnight and I do not know why" is the single worst outcome** for an app whose value is being trusted about money between friends.

**The recomputation argument.** Balances are a pure function of the entries. **If an entry can change, a balance computed yesterday and one computed today can differ with no entry to explain the difference** — which breaks the property that makes any balance defensible. **Append-only is what makes "recompute and compare" a meaningful check.**

**And the social argument, which is specific to this product.** An expense is a claim about a shared event, **so silently editing it is editing someone else's record of what happened.** A visible correction — "Priya changed this from £80 to £60 on Tuesday" — **is what lets the group notice and object**, which is a feature rather than an inconvenience.

*The cost of appending:* **the entry list grows with corrections**, and balance computation must skip reversed entries. **Both are trivial at this scale**, and both are the same costs the payments ledger accepted for the same reasons.

*One pragmatic exception worth naming:* **an expense corrected within seconds of creation, by its creator, before anyone else has seen it.** Appending a reversal there produces noise for no benefit. **A short grace window during which an edit really is a mutation is defensible** — and it must be short, creator-only, and closed the moment another member has viewed the group.

---

**A member positive in one currency and negative in another**

**Both are shown, and they are never combined into one number.**

\`\`\`
Priya:  +€50   (is owed)
        −£30   (owes)
→ "You are owed €50 and you owe £30"
→ NOT "you are owed about €15"
\`\`\`

**Three reasons not to combine them.**

**Combining requires a rate, and the app does not have an authoritative one.** Any single figure implies a conversion that nobody agreed to — **and the number changes every day without any expense changing**, which is confusing and looks like a bug.

**The invariant is per currency.** A combined figure has nothing to sum to zero against, **so the self-check that makes every other number trustworthy does not apply to it.**

**And it hides the action.** The useful question is "what do I actually pay?", **and the answer is two settlements in two currencies** — or one agreed cross-currency settlement from option (b). **A blended figure answers neither.**

*What I would show:* **per-currency balances, ordered by magnitude, with a settle action per currency** — plus an optional "settle everything with Priya" flow that proposes the two-sided conversion entry at a rate both parties confirm.

*And the display detail that matters:* **if a group has one currency, show one number.** Multi-currency presentation is a cost paid only by groups that have the problem, **and imposing it on the common case to accommodate the rare one is how a simple app becomes an unpleasant one.**`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lsp-1',
      level: 'basic',
      question: 'Design Splitwise. How are balances represented?',
      guidance:
        'Derived from an append-only list of expenses and settlements, never stored. Look for the zero-sum check being named as the reason rather than as an afterthought.',
    },
    {
      id: 'iq-lsp-2',
      level: 'basic',
      question: 'How do you represent money?',
      guidance:
        'Integer minor units. Strong answers immediately raise the division remainder, since that is the problem integers expose rather than solve.',
    },
    {
      id: 'iq-lsp-3',
      level: 'intermediate',
      question: '£10 split three ways. What happens to the penny?',
      guidance:
        'Allocated deterministically — largest remainder, ties by index. Dropping it breaks the invariant; random allocation makes the ledger non-reproducible.',
    },
    {
      id: 'iq-lsp-4',
      level: 'intermediate',
      question: 'Support equal, exact, percentage and share splits.',
      guidance:
        'One strategy interface with a sums-to-total postcondition, all routing through one allocation function, each validating its own precondition and returning a result.',
    },
    {
      id: 'iq-lsp-5',
      level: 'advanced',
      question: 'Two people paid for one dinner. How does that work?',
      guidance:
        'paidBy is a list, and the pairwise view attributes each ower\'s share across payers using the same allocation function — otherwise pairwise and net disagree.',
    },
    {
      id: 'iq-lsp-6',
      level: 'advanced',
      question: 'Minimise the number of transfers to settle a group.',
      guidance:
        'Greedy largest-debtor to largest-creditor, at most n−1 transfers. Excellent answers say the exact minimum is NP-hard and that net balances are what must be preserved.',
    },
    {
      id: 'iq-lsp-7',
      level: 'followup',
      question: 'A user edits an expense from last week. What happens?',
      guidance:
        'A reversal plus a replacement, appended. Mutating changes balances with no record of who or when, which is the worst outcome for a trust-based app.',
    },
    {
      id: 'iq-lsp-8',
      level: 'followup',
      question: 'The group has expenses in euros and pounds. Now what?',
      guidance:
        'Balances per currency, never netted. A cross-currency settlement is a two-sided entry with a recorded rate, because a currency is a closed system.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lsp-1',
      kind: 'what-changes-if',
      prompt:
        'Change the scale: this is no longer an app for friends but an expense system for a 5,000-person company, with approval workflows, policy limits and reimbursement to bank accounts. What survives, and what does the ledger become?',
      discussion: `**The ledger core survives almost untouched, and everything around it grows** — which is a useful demonstration that the small design was not a toy.

**What survives exactly.**

**Derived balances over append-only entries.** Unchanged, and now legally required rather than merely wise: **a corporate expense system must show why every figure is what it is**, for audit rather than for a friend's curiosity.

**Integer minor units and the allocation function.** A 60/40 split of a team lunch has the same remainder problem, **and the determinism requirement is stronger** because an auditor may recompute.

**Reversals rather than mutations.** Already the right model, and now **an edit after approval is a compliance event** rather than a courtesy.

**And the per-currency zero-sum property**, which becomes the reconciliation check against the corporate accounting system.

**What changes: the entry set grows, and most new entries are states rather than amounts.**

\`\`\`
Friends:  expense · settlement · reversal
Company:  expense · approval · rejection · policy_exception
          · reimbursement_initiated · reimbursement_settled
          · reversal
\`\`\`

**And several of those carry no money**, which is the structural change: **an approval changes nothing about balances and everything about what may happen next.** So the design gains a state machine per expense alongside the ledger — **the two coexist, as they did in the ride-hailing and payment designs.**

**What becomes genuinely harder: reimbursement is an external payment.**

\`\`\`
Friends:      "settled" means they told the app they paid
Company:      "reimbursed" means a bank transfer happened
              → an external system, an ambiguous outcome,
                a settlement file to reconcile against
\`\`\`

**This is the payments lesson arriving in full**: an unknown state after a timeout, idempotency keys on the payout, and reconciliation against the bank's record. **The friend version could take "I paid you" on trust; the company version cannot** — and that single difference adds the whole reconciliation subsystem.

**Three more things appear.**

**Policy evaluation, which is a strategy set.** Per-category limits, per-grade limits, receipt-required thresholds, and approval routing. **These are algorithms over an expense, so they are the split-strategy shape reused** — one interface, several implementations, validation returning a result with the reason.

*And the reason matters more here:* **"rejected" is useless; "exceeds the £50 meal limit for your grade" is actionable**, which is the result-over-boolean habit with a compliance motive.

**Approval routing, which is a graph rather than a rule.** Who approves depends on amount, category and reporting line — **and the routing must be recorded on the entry**, because "who approved this" is the first audit question.

**And multi-entity accounting.** Expenses belong to cost centres and legal entities, **so the zero-sum property becomes per entity per currency** — more closed systems, and cross-entity charges become the two-sided transfer from the exercise.

**What I would not change.**

**The derived-balance model, under pressure to cache.** With 5,000 people and years of entries, **the temptation is a materialised balance table** — and the answer is the same as everywhere else in this course: **a snapshot with entries since, where the log wins.** The property that makes an audit possible is exactly the one caching threatens.

**And the remainder rule.** A company splitting a £1,000 team dinner across 7 attendees has the same penny, **and an auditor recomputing it must get the same answer.**

**The honest summary.** The ledger, the allocation function, the reversal model and the per-currency invariant scale unchanged — **they were never about the size of the group.** What grows is everything that is not the ledger: a state machine, a policy engine, an approval graph, and a reconciliation subsystem against real money movement. **Which is a good sign about the original design: the core did not need replacing, it needed surrounding.**

**The transferable point:** when a design's core is an invariant over immutable entries, **scale adds processes around it rather than replacing it** — because the invariant does not care how many entries there are. **The parts that break under scale are the ones that touched the outside world**, and here that is exactly one: settlement, which turns from a claim into a payment.`,
    },
    {
      id: 'al-lsp-2',
      kind: 'debug',
      prompt:
        'Users report that a group\'s balances "do not add up" — the amounts shown to each member do not sum to zero, by small amounts, in groups that have been active for months. Recomputing from the entries gives the same wrong result. Diagnose it.',
      discussion: `**"Recomputing gives the same wrong result"** is the critical detail, and it eliminates the most likely suspect immediately: **this is not a stale cache or a lost entry.** The derivation is faithful — **so an entry itself is internally inconsistent.**

Which narrows it to one place: **an expense whose \`owedBy\` does not sum to its amount.**

**Hypothesis 1 — a split strategy that bypasses the allocation function.**

The lesson's rule is that every strategy routes through \`allocate\`. **If one does not — most likely the adjustment split, which is the case that tempts you to do the arithmetic inline — its shares can be off by a few units.**

\`\`\`
Adjustment split: equal, but Priya pays £5 more
  naive: subtract 500 from the total, divide equally,
         add 500 back to Priya
  → the equal division of the REMAINDER has its own
     remainder, and an inline version drops it
\`\`\`

*Why it fits perfectly:* small amounts, accumulating over months, **and reproducible from the entries** because the bad shares are stored. **This is my leading hypothesis** — it is the specific case the lesson warns about, and the error size matches.

*Check:* group the discrepancies by the split type of the expenses involved. **If they cluster on one strategy, the diagnosis is done.**

**Hypothesis 2 — an exact-amount split accepted without validation.**

If \`ExactSplit\` does not verify that the given amounts sum to the total — or the validation was added later and older entries predate it — **a user typing shares that sum to £49.97 for a £50 expense stores exactly that.**

*Why it fits:* the error is small and arbitrary, **and it is genuinely in the data.** *Check:* recompute \`sum(owedBy) − amountMinor\` for every expense and look at the distribution. **A scatter of small non-zero values on exact splits is conclusive**, and the same query is the general diagnostic for all of these hypotheses.

**Hypothesis 3 — percentages stored as floats.**

If percentages are floats rather than basis points, \`33.33 + 33.33 + 33.34\` may not be exactly 100 in binary, **and a validation comparing to 100 with exact equality either rejects valid input or is written with a tolerance** — and a tolerance is what lets a slightly-off split through.

\`\`\`
tolerance of 0.01% on a £2,000 expense = 20 minor units
→ accepted, and the shares are 20 units short
\`\`\`

*Why it fits the "small amounts" symptom precisely:* the error scales with the expense size. **Check:** whether percentages are integers, and whether the validation uses a tolerance.

**Hypothesis 4 — a multi-payer expense where \`paidBy\` does not sum to the amount.**

The invariant has two halves and attention usually goes to \`owedBy\`. **If the payer amounts are entered by the user — two cards, £30 and £25, for a £56 bill — nothing may be validating that side.**

*Why it fits:* it produces exactly the same symptom from the other direction, **and it is the half a reviewer is less likely to check.** *Check:* run the same sum comparison on \`paidBy\`.

**Hypothesis 5 — reversals or currency handling.**

A reversal that is itself reversed, or two reversals of one entry, **would double-count a removal**. And an entry whose currency field is wrong is skipped for its group's currency, **removing one side of a balanced pair.**

*Why these are lower probability:* both produce larger, lumpier discrepancies rather than small ones. **Check anyway** — the currency one is a single query and it produces a very confusing symptom if present.

**What I would check first: for every expense, \`sum(owedBy) − amount\` and \`sum(paidBy) − amount\`.** One query over the entry table, and **it locates the bad entries exactly** — after which their split type, currency and age identify the cause among the hypotheses above.

**Then: group the offenders by split strategy and by creation date.** A cluster on one strategy is hypothesis 1 or 2; **a cluster before a particular date is a bug that was fixed without repairing the existing data** — which is a common and important distinction, because the fix then has two parts.

**Why "recomputing gives the same result" is the most useful fact.**

It proves the derivation is correct and **moves the entire investigation into the data.** Without it, a cache, a missed entry, a currency filter and a display bug would all be live candidates — **and each would be a different investigation.**

**And it makes the problem tractable in a specific way:** bad data is enumerable. **A single query finds every affected entry**, which a timing or caching bug never allows.

**The instrumentation this demands.**

**The per-expense invariant checked at write time, as a hard constraint.** \`sum(paidBy) = sum(owedBy) = amount\` should be impossible to violate — **rejected before the entry is stored**, not detected months later. This is the cheap local version of the check, and **its absence is the root finding** whichever hypothesis is right.

**The per-group zero-sum check, run continuously.** The lesson's one-liner, executed after every write in development and as a periodic job in production. **It should alert on any non-zero value**, because the correct value is exactly zero — no threshold.

**A count of entries failing the invariant, as a gauge.** It is the number that says whether a fix has repaired existing data or only stopped new bad data, **which is the distinction most post-fix reports get wrong.**

**And a property test over every split strategy.** Random amounts and random weights, asserting the shares sum exactly. **That single test would have caught hypotheses 1, 2 and 3 before release** — and it is the shape of test that example-based cases cannot replace, because the failures are at values nobody thinks to try.

**Transferable:** an invariant that is only checked globally will be violated locally and discovered late. **Put the cheap version at the write boundary as a constraint and the expensive version on a continuous alert at zero tolerance** — and when a recomputation reproduces a wrong answer, stop looking at the computation and enumerate the data.`,
    },
  ],

  revision: {
    bullets: [
      'Balances are derived from an append-only list of expenses and settlements, never stored.',
      'A stored balance has no explanation and nothing to check it against.',
      'The group invariant is that members\' balances sum to zero per currency — a one-line self-check.',
      'Every expense records paidBy and owedBy as lists, each summing to the amount.',
      'A single payer field cannot represent two people splitting one bill on two cards.',
      'Money is integer minor units; floats store a residue that compounds.',
      'Integers expose rather than solve the division problem: £10 three ways leaves a penny.',
      'Dropping the remainder breaks the zero-sum invariant by arithmetic.',
      'Allocating it randomly makes the ledger non-reproducible, so a dispute has no answer.',
      'Largest-remainder allocation: floor, then give spare units to the largest fractions, ties by index.',
      'Every split strategy routes through one allocation function, so the postcondition holds in one place.',
      'Each strategy validates its own precondition and returns a result with the numbers.',
      'A settlement is an entry, so partial payments recompute and the payment is in the history.',
      'Pairwise cannot be reconstructed from net balances — several arrangements give the same totals.',
      'Greedy simplification gives at most n−1 transfers; the exact minimum is NP-hard.',
      'What simplification must preserve is every net balance, not the transfer count.',
      'Simplification changes who pays whom, so it is an optional view and never a rewrite.',
      'Edits and deletions are appended reversals, because a silent balance change is the worst outcome.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A small ledger: expenses and settlements as append-only entries, balances summed from them per currency, splits computed by strategies that all route through one deterministic allocation function, and debt simplification as an optional read model.',
    whyItExists:
      'Because the app\'s value is being trusted about money between people, which requires every balance to be explainable and checkable — and because dividing money never divides evenly, so the remainder needs a rule or the invariant fails by arithmetic.',
    whenToUse: [
      'Derived balances whenever a number must be explainable or disputable.',
      'Integer minor units for any monetary amount.',
      'A single allocation function wherever an amount is divided among parties.',
      'Append-only reversals whenever a correction must be visible.',
      'A read model whenever a reorganisation is an opinion rather than a fact.',
    ],
    whenNotToUse: [
      'Floating-point amounts.',
      'Stored pairwise balances.',
      'A single payer field.',
      'Dropping or randomising a division remainder.',
      'Per-split-type methods with duplicated rounding.',
      'Settlements as assignments to zero.',
      'Simplification that rewrites the entries.',
      'Netting across currencies without an explicit two-sided entry.',
    ],
    alternatives: [
      'Remainder to the payer, when a simpler rule is preferred and stated.',
      'A periodic balance snapshot with entries since, if a group ever grows large enough.',
      'A short creator-only grace window for a genuine edit, before anyone has seen the expense.',
      'A group base currency, at the cost of entries no longer recording what was paid.',
      'An agreed two-sided conversion entry, for cross-currency settlement.',
    ],
    tradeoffs: [
      'Derived balances buy explainability and a self-check, and cost recomputation.',
      'Integer units buy exactness and require a remainder rule.',
      'Largest-remainder buys determinism and fairness for a sort per split.',
      'Strategy validation inside each implementation buys a branch-free call site and duplicates shape.',
      'Reversals buy a visible history and grow the entry list.',
      'Simplification buys fewer transfers and changes who pays whom.',
      'Per-currency balances buy an intact invariant and cost a more complex display.',
    ],
    failureModes: [
      'Floating-point residue compounding into a fraction-of-a-penny balance.',
      'A dropped remainder breaking the group zero-sum.',
      'A randomised remainder making recomputation non-reproducible.',
      'An adjustment split doing the arithmetic inline and losing units.',
      'An exact split accepted without checking that the amounts sum.',
      'Percentage validation with a tolerance, letting shares through short.',
      'paidBy unvalidated while owedBy is checked.',
      'A settlement setting a balance to zero and losing a partial payment.',
      'A mutated expense changing balances with no record of who or when.',
      'Simplification written back over the entries.',
      'Cross-currency settlement recorded in one currency only.',
    ],
    followUpQuestions: [
      'Is the balance stored or derived?',
      'What would I compare this number against?',
      'Are amounts integers in minor units?',
      'What happens to the remainder, and is it deterministic?',
      'Do all split strategies share one allocation function?',
      'Does each strategy validate its own precondition?',
      'Can an expense have several payers?',
      'Is a settlement an entry or an assignment?',
      'Can the pairwise view be derived from net balances?',
      'Does simplification write anything?',
      'Do currencies ever net without an explicit entry?',
    ],
  },
});
