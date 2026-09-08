import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'd-failover-availability',
  title: 'Failover, topologies, availability arithmetic',
  summary:
    'Availability multiplies down a serial dependency chain, so ten 99.9% dependencies give you 99%. Every additional nine costs roughly an order of magnitude, and most claimed nines are arithmetic nobody checked.',
  phase: 'distributed',
  module: 'resilience',
  position: 36,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['availability', 'failover', 'slo', 'redundancy', 'correlated-failure'],
  prerequisites: ['d-consistency-models'],
  resources: [
    {
      key: 'google-sre-slo',
      tier: 'must',
      note: 'Read it for the distinction between an SLI, an SLO and an SLA, and for why the objective should be chosen from what users need rather than from what sounds impressive.',
    },
    {
      key: 'google-cloud-sre-error-budget',
      tier: 'must',
      note: 'The error-budget idea, which converts an availability target from an aspiration into a quantity you spend. Read it for how the budget governs the pace of change.',
    },
    {
      key: 'aws-well-architected-reliability',
      tier: 'must',
      note: 'Read the sections on failure isolation boundaries and on planning for failure. Its treatment of what a zone and a region actually isolate is the concrete grounding for the arithmetic here.',
    },
    {
      key: 'aws-workload-isolation-shuffle',
      tier: 'good',
      note: 'Read it for the blast-radius framing: availability is not only "is it up" but "how many customers does one failure reach".',
    },
    {
      key: 'google-sre-workbook-slo',
      tier: 'good',
      note: 'The practical follow-up: choosing SLIs that reflect user experience, and the arithmetic of measuring them. Read it when you need to actually define one.',
    },
    {
      key: 'postgres-replication',
      tier: 'advanced',
      note: 'Read the failover and synchronous-commit material. It grounds the abstract discussion of RPO and RTO in what a specific system actually does and loses.',
    },
  ],

  intuition: {
    body: `Availability arithmetic is the fastest way to discover that a design cannot meet its target, and it takes two minutes.

**Serial dependencies multiply.** If your request needs services A, B and C, and each is available 99.9% of the time, then:

\`\`\`
0.999 × 0.999 × 0.999 = 0.997  →  99.7%
\`\`\`

You did not build a 99.9% system out of 99.9% parts. Ten such dependencies give **99%** — which is 7.2 hours of downtime per month. **This is the single most useful calculation in system design**, because it converts "we depend on a lot of things" into a number.

**Parallel redundancy multiplies the *failure* probability**, which is why it helps so much:

\`\`\`
Two independent 99% instances:
  both down = 0.01 × 0.01 = 0.0001  →  99.99% available
\`\`\`

Two mediocre components in parallel beat one excellent component. That is the whole case for redundancy, and it rests entirely on the word **independent**.

Which is where it breaks. **Real failures are correlated**, and correlation destroys the arithmetic:

- Both instances run the same code, so the same bug crashes both.
- Both are in the same rack, so one power supply takes both.
- Both share a configuration source, so one bad config breaks both.
- Both depend on the same database, so it is a serial dependency wearing a parallel costume.

**So the honest question is never "how many replicas" but "what do they share".** Two instances sharing a failure domain are one instance with extra cost.

The third idea is that **every nine costs roughly an order of magnitude**:

| Availability | Downtime/year | Downtime/month |
| --- | --- | --- |
| 99% | 3.65 days | 7.2 hours |
| 99.9% | 8.8 hours | 43 minutes |
| 99.99% | 53 minutes | 4.3 minutes |
| 99.999% | 5.3 minutes | 26 seconds |

Look at 99.99%: **4.3 minutes of downtime per month.** A single deploy that goes wrong and takes ten minutes to roll back has spent two months of budget. At 99.999%, 26 seconds a month means **no human can be in the recovery path** — detection and remediation must be automatic, because a person cannot be paged, wake up, and diagnose in 26 seconds.

That is what makes each nine an order-of-magnitude cost: it is not more redundancy, it is removing humans from recovery, then removing deploys as a source of risk, then removing correlated failure modes you have not yet discovered.

The framing to carry: **compute the arithmetic before promising a number, ask what your redundancy shares, and notice which nine requires humans to leave the recovery path.**`,
    analogyLimit:
      '"Add a replica for high availability" is the instinct this lesson exists to correct. It treats availability as a property you add rather than a number you compute, and it ignores the two things that decide the outcome: what the replicas share, and how long failover takes. Two replicas behind one load balancer, in one zone, running one build, sharing one database, deliver almost exactly the availability of one — at twice the cost and with the appearance of safety.',
  },

  deepExplanation: {
    predict: {
      question:
        'A team promises 99.99% availability. Their request path is: CDN (99.99%) → load balancer (99.99%) → API service, 3 instances (99.5% each) → auth service (99.95%) → PostgreSQL primary with automatic failover taking 45 seconds. Deploys happen twice daily. Compute the actual availability and say what the binding constraint is.',
      answer: `**Compute it, component by component.**

**The API tier.** Three instances at 99.5% each, behind a load balancer. If failures were independent, all three down simultaneously is \`0.005³ = 1.25 × 10⁻⁷\`, giving **99.99999%** — effectively perfect. So the tier looks free.

**It is not, and that is the first finding.** Those three instances run the same build, read the same configuration, and are deployed together. A bad deploy takes all three. So the API tier's real availability is not governed by instance failure at all — it is governed by **deploy failure**, which is fully correlated.

**Serial multiplication of the rest:**

\`\`\`
CDN             0.9999
Load balancer   0.9999
API tier        ~0.9999   (deploy-limited, see below)
Auth service    0.9995
──────────────────────────
Product         0.9992    →  99.92%
\`\`\`

**Now the database, which is the binding constraint.** Automatic failover takes 45 seconds. How often does a primary fail? Assume a generous once per quarter — hardware, a kernel panic, a zone event, or a maintenance-triggered failover.

\`\`\`
4 failovers/year × 45 s = 180 s/year of downtime
180 s / 31,536,000 s = 0.0000057   →  99.9994%
\`\`\`

That looks fine. **But the monthly budget is what matters**, because SLOs are usually measured monthly:

\`\`\`
99.99% monthly budget = 4.3 minutes = 258 s
One 45-second failover = 17% of the month's entire budget
\`\`\`

**One routine database failover consumes a sixth of the monthly budget.** Two in a month is a third. That is survivable and it is not comfortable.

**And the deploys are the real problem.**

\`\`\`
2 deploys/day × 30 days = 60 deploys/month
\`\`\`

If **one in twenty** deploys causes a user-visible problem lasting **5 minutes** before rollback:

\`\`\`
3 bad deploys/month × 5 min = 15 minutes
Monthly budget at 99.99%    = 4.3 minutes
\`\`\`

**Deploys alone consume three and a half times the entire budget.** The team is not at 99.99%; they are at roughly **99.965%**, and the dominant term is their own release process.

**The actual availability:**

\`\`\`
Serial chain          99.92%
Database failovers    −0.003%
Bad deploys           −0.035%
──────────────────────────────
Realistic             ~99.88%
\`\`\`

**99.88%, against a promise of 99.99%** — off by two orders of magnitude in the error rate. About 52 minutes of downtime per month against a promised 4.3.

**What the binding constraint is: the deploy process, then the auth service, then failover time.** In that order, and none of them is what the team would have guessed.

**What each nine would actually require.**

**To reach 99.9%** (43 min/month): they are nearly there. Fix the auth service's 99.95% — it is a serial dependency costing 22 minutes a month on its own — or make it non-blocking by caching validated tokens.

**To reach 99.99%** (4.3 min/month): deploys must stop causing incidents. That means canary releases with automatic rollback on error-rate regression, so a bad deploy affects 1% of traffic for 60 seconds rather than 100% for 5 minutes. **This is a release-engineering problem, not an infrastructure one**, and no amount of added redundancy addresses it.

**To reach 99.999%** (26 s/month): the 45-second database failover alone exceeds the entire monthly budget. **They would need a database that fails over in under 10 seconds, or a multi-primary architecture, or an application that tolerates a read-only period without counting it as downtime.** And no human can be in the loop for anything.

**The general lesson.** The team promised a number without computing it. The arithmetic takes two minutes and would have shown that their deploy cadence, not their infrastructure, was the binding constraint — and that the three-instance API tier they were proud of contributed nothing, because the instances share everything that actually fails.`,
    },
  body: `## The arithmetic

**Serial (all must work):** multiply availabilities.

\`\`\`
A_total = A₁ × A₂ × ... × Aₙ
\`\`\`

Every dependency you add makes the system less available. This is why "just call another service" has a cost that is invisible in a design review — a 99.9% dependency costs you 43 minutes a month.

**Parallel (any one suffices):** multiply *unavailabilities*.

\`\`\`
A_total = 1 − (1 − A₁) × (1 − A₂) × ... × (1 − Aₙ)
\`\`\`

**N of M:** for M components where N must work, the binomial gives the answer. Practically: 2 of 3 tolerates one failure; 3 of 5 tolerates two.

Two derived rules worth having ready:

**A serial chain is worse than its worst member.** So the cheapest availability improvement is usually removing a dependency, not adding redundancy to one.

**Parallel redundancy is worth a lot and only when independent.** Two 99% components in parallel give 99.99%; two 99% components sharing a power supply give roughly 99%.

## Correlated failure: where the arithmetic breaks

Independence is an assumption, and it is almost always partly false. The correlations that matter, roughly in order of how often they bite:

**Shared code.** All instances run the same build, so the same bug affects all of them. **This makes deploys the dominant availability risk in most well-run systems**, because it is the one failure mode redundancy cannot address.

**Shared configuration.** One bad config push reaches every instance in seconds. Config changes are usually less carefully gated than code changes and are therefore more dangerous.

**Shared infrastructure.** Same host, rack, power, network, availability zone, region. Each is a boundary, and knowing which boundary your redundancy actually crosses is the question.

**Shared dependency.** Two API instances both calling one database means the database's availability appears once in the serial chain, and the instance redundancy does nothing for it.

**Shared saturation.** Both instances are fine until traffic doubles, and then both are overloaded simultaneously. Redundancy for *failure* is not redundancy for *load*.

**Shared control plane.** Both instances depend on service discovery, a certificate authority, a secrets store, or a container scheduler. These are the correlations people forget, and they are the ones that produce multi-hour incidents.

**The practical exercise:** for each redundant pair, list what they share. Anything on the list is a single point of failure wearing a redundant costume.

## Failover: RTO, RPO, and what actually takes the time

Two quantities define a failover:

**RTO — recovery time objective.** How long until service resumes. This is what your availability arithmetic consumes.

**RPO — recovery point objective.** How much data you can lose. Zero requires synchronous replication, which costs latency on every write.

**Where the RTO actually goes**, and the detection term usually dominates:

\`\`\`
detect the failure          5–30 s   ← usually the largest term
decide to fail over          1–10 s
promote the replica          1–5 s
redirect traffic            1–60 s   ← DNS TTL, connection pools, client caches
warm the new primary       10–300 s  ← cold cache, cold connection pools
─────────────────────────────────────
Total                      18–405 s
\`\`\`

Three observations that change designs:

**Detection dominates.** A conservative health check — three failures at ten-second intervals — is 30 seconds before anything begins. Tightening it risks failing over on a blip, which is the trade from the load-balancing lesson.

**Traffic redirection is often the largest hidden term.** DNS with a 60-second TTL means clients keep resolving the old address for up to a minute — longer, because many runtimes cache DNS indefinitely regardless of TTL. **This is why a "5-second failover" frequently takes two minutes in practice**, and the fix is a stable address with the redirection happening below it: an anycast address, a load balancer, or a proxy.

**The new primary is cold.** Empty caches, empty connection pools, an unwarmed query planner. It may be slow enough to be effectively unavailable for a while after it is technically serving — which counts against your SLO even though the failover "succeeded".

**Synchronous versus asynchronous, stated as the trade it is:**

*Asynchronous:* no latency cost on writes, and a failover loses whatever had not replicated — typically milliseconds to seconds of writes. **RPO greater than zero.**
*Synchronous:* RPO of zero, and every write pays a round trip to the replica. Same-zone is 1–2 ms; cross-region is 50–150 ms.
*Semi-synchronous:* wait for one replica of several. Most of the durability for less of the tail latency, and it is the usual production choice.

The decision is a business one and should be stated as such: **"we accept losing up to N seconds of writes in a failover" is a sentence someone must own.**

## Topologies

**Single region, multi-zone.** Instances across two or three zones in one region; the database has a synchronous replica in another zone.

*Survives:* an instance, a rack, a whole zone.
*Does not survive:* a region failure, or a control-plane failure affecting the region.
*Cost:* cross-zone latency on synchronous writes (1–2 ms) and cross-zone data transfer.
*Availability:* 99.9% to 99.99% is achievable. **This is the right answer for most systems**, and reaching for more is usually premature.

**Multi-region, active-passive.** One region serves; another is warm and idle.

*Survives:* a region failure.
*Cost:* a duplicate fleet earning nothing, and — the real cost — **an untested failover.** A passive region that has never taken production traffic will fail in ways nobody predicted, because it has never been exercised.
*RTO:* minutes to hours, dominated by the decision to fail over and by DNS or client redirection.
*The honest caution:* many active-passive setups have a *worse* effective availability than single-region, because the failover is a large, rehearsed-only-in-theory operation performed under stress. **A failover you have not exercised in production is a plan, not a capability.**

**Multi-region, active-active.** Both regions serve traffic continuously.

*Survives:* a region failure, with the traffic shift being a routine operation rather than an emergency.
*Cost:* the hard one — **data.** Either accept eventual consistency between regions with conflict resolution, or pay cross-region latency on writes, or partition data so each region owns a subset. All three are significant design commitments.
*Availability:* 99.99%+ genuinely achievable, because the failover path is continuously exercised.
*The key advantage over active-passive:* the standby is not a standby. It is serving traffic, so you know it works.

**Cell-based / shuffle-sharded.** Many independent copies of the whole stack, each serving a subset of customers.

*Survives:* a failure in one cell affects only that cell's customers.
*What it optimises:* **blast radius rather than uptime.** A cell being down is a total outage for its customers and invisible to everyone else. The relevant metric changes from "was it up" to "what fraction of customers were affected".
*Cost:* operational complexity, lower utilisation, and a routing layer that must itself be highly available.

## SLIs, SLOs, error budgets

**SLI** — the measurement. "The fraction of requests returning a non-5xx status within 500 ms."
**SLO** — the target. "99.9% of requests, measured over 28 days."
**SLA** — the contract, with consequences. Always looser than the SLO, so you have margin before owing anyone money.

Two things that make an SLI useful rather than decorative:

**Measure it where the user is.** Server-side success rates miss DNS failures, TLS failures, timeouts before the request arrived, and everything the CDN handled. A server-side SLI can read 99.99% while users experience 99.5%.

**Include latency in the definition of success.** A response after 30 seconds is a failure to the user and a success to a status-code-only SLI. **This is the most common way an SLI overstates availability**, and it is exactly the goodput point from the backpressure lesson.

**The error budget** is the useful part. At 99.9% over 28 days you have 40 minutes of allowed unavailability. That is a quantity you *spend*:

- Budget remaining → ship features, take risks, deploy often.
- Budget exhausted → stop feature work, spend on reliability.

Its value is that it converts an argument about how careful to be into arithmetic. **And it makes the deploy-risk connection explicit**: if bad deploys consume 15 minutes a month against a 4.3-minute budget, the budget says the release process must change before anything else does.

**Choosing the target.** From what users need, not from what sounds impressive. Three questions:

**What do users actually notice?** If your consumers retry transparently, brief unavailability may be invisible.
**What do your dependencies allow?** You cannot promise 99.99% while serially depending on something at 99.9%.
**What does the next nine cost?** Usually an order of magnitude, and often in engineering process rather than infrastructure.

## Where this framing misleads

**Availability is not one number.** A system can be 100% available for reads and entirely unavailable for writes. Publish it per operation class, and per customer if you are cell-based.

**Partial failure is the normal case.** A binary up/down model does not describe a system serving 97% of requests, or one where checkout works and search does not. Measure per-operation success rates, not uptime.

**Vendor nines do not compose the way you want.** A cloud service's 99.99% is typically measured per-region, monthly, with specific exclusions, and it may not count elevated latency as downtime. Read the definition before putting the number in your arithmetic.

**More nines can reduce real availability.** A complex multi-region setup with an untested failover, more moving parts and more configuration is often less available than a well-run single-region deployment. **Complexity is itself a failure mode**, and it does not appear in the arithmetic.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'arithmetic',
      title: 'Serial multiplies availability; parallel multiplies failure',
      caption:
        'The two formulas and their consequence. Note the bottom row: the arithmetic that makes redundancy powerful assumes independence, and independence is the assumption that is usually false.',
      code: `flowchart TB
    S["**Serial** — all must work<br/>A = A₁ × A₂ × ... × Aₙ"]
    S --> S1["3 × 99.9% = 99.7%<br/>(2.2 h/month)"]
    S --> S2["10 × 99.9% = 99%<br/>(7.2 h/month)"]
    S --> S3["**Every dependency added<br/>makes you less available.**<br/>Cheapest improvement is<br/>usually removing one"]

    P["**Parallel** — any one suffices<br/>A = 1 − (1−A₁)(1−A₂)...(1−Aₙ)"]
    P --> P1["2 × 99% = 99.99%<br/>(4.3 min/month)"]
    P --> P2["3 × 99.5% = 99.99987%"]
    P --> P3["**Two mediocre parts beat<br/>one excellent part** —<br/>if they are independent"]

    P3 --> C["**But what do they share?**<br/>Same build · same config<br/>Same zone · same database<br/>Same control plane"]
    C --> C2["Anything shared is a single<br/>point of failure in a<br/>redundant costume"]

    style S3 fill:#1c1814,stroke:#c99a4e
    style P3 fill:#17272a,stroke:#35897e
    style C2 fill:#2a1a1a,stroke:#a04848`,
    },
    {
      kind: 'flow',
      id: 'rto-breakdown',
      title: 'Where a "5-second failover" spends two minutes',
      caption:
        'Step through it. Detection and traffic redirection dominate, and the cold new primary counts against your SLO even though the failover technically succeeded.',
      nodes: [
        { id: 'fail', label: 'Primary fails', kind: 'store', x: 0, y: 190, detail: 'The clock starts here. Everything downstream is the RTO, and the RTO is what your monthly error budget pays for.' },
        { id: 'detect', label: 'Detect: 5–30 s', kind: 'service', x: 170, y: 190, detail: 'Usually the largest term. Three failed checks at ten-second intervals is 30 seconds before anything begins — and tightening it risks failing over on a blip.' },
        { id: 'decide', label: 'Decide: 1–10 s', kind: 'service', x: 340, y: 90, detail: 'Automatic is seconds; a human in the loop is minutes at best. At 99.999% — 26 seconds a month — no human can be in this step.' },
        { id: 'promote', label: 'Promote: 1–5 s', kind: 'service', x: 340, y: 290, detail: 'The fast part, and the one people quote as "the failover time". It is a small fraction of the real total.' },
        { id: 'redirect', label: 'Redirect: 1–60 s', kind: 'service', x: 520, y: 190, detail: 'DNS TTLs, connection pools, and runtimes that cache resolutions indefinitely. This is why a "5-second failover" takes two minutes — the fix is a stable address with redirection below it.' },
        { id: 'warm', label: 'Warm: 10–300 s', kind: 'store', x: 700, y: 190, detail: 'Cold caches, cold connection pools, an unwarmed planner. The new primary may be too slow to be useful — which counts as downtime even though it is technically serving.' },
        { id: 'rpo', label: 'RPO: what was lost', kind: 'note', x: 520, y: 330, detail: 'Asynchronous replication loses whatever had not shipped — milliseconds to seconds of writes. "We accept losing up to N seconds" is a sentence someone must own.' },
        { id: 'budget', label: 'Monthly budget', kind: 'note', x: 700, y: 60, detail: 'At 99.99% you have 4.3 minutes per month. One 45-second failover is 17% of it. At 99.999% — 26 seconds — one failover exceeds the whole budget.' },
      ],
      edges: [
        { id: 'r1', source: 'fail', target: 'detect', kind: 'control' },
        { id: 'r2', source: 'detect', target: 'decide', kind: 'control' },
        { id: 'r3', source: 'decide', target: 'promote', kind: 'control' },
        { id: 'r4', source: 'promote', target: 'redirect', kind: 'control' },
        { id: 'r5', source: 'redirect', target: 'warm', kind: 'control' },
        { id: 'r6', source: 'promote', target: 'rpo', kind: 'async' },
        { id: 'r7', source: 'warm', target: 'budget', kind: 'control' },
      ],
      steps: [
        {
          id: 'rt1',
          title: 'Detection is usually the biggest term',
          description:
            'Nothing happens until the failure is noticed. A conservative check is 30 seconds; a tight one risks failing over on a transient blip — the asymmetric-threshold trade from load balancing.',
          nodes: ['fail', 'detect'],
          edges: ['r1'],
        },
        {
          id: 'rt2',
          title: 'Deciding and promoting are the fast parts',
          description:
            'Automatic promotion is seconds. This is the number people quote as "the failover time", and it is a small fraction of the total — while a human in the decision step makes it minutes.',
          nodes: ['decide', 'promote'],
          edges: ['r2', 'r3'],
        },
        {
          id: 'rt3',
          title: 'Redirecting traffic is the hidden term',
          description:
            'DNS TTLs, pooled connections to the old primary, and runtimes that cache resolutions regardless of TTL. A stable address — anycast or a proxy — with redirection underneath removes it.',
          nodes: ['redirect'],
          edges: ['r4'],
        },
        {
          id: 'rt4',
          title: 'And the new primary is cold',
          description:
            'Empty caches and pools mean it may be too slow to be useful for minutes after promotion. That is downtime your SLO counts even though the failover reported success.',
          nodes: ['warm'],
          edges: ['r5'],
        },
        {
          id: 'rt5',
          title: 'Then compare the total against the monthly budget',
          description:
            'One 45-second failover is 17% of a 99.99% month and more than a whole 99.999% month. The budget is what tells you whether your failover time is compatible with your promise.',
          nodes: ['rpo', 'budget'],
          edges: ['r6', 'r7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['google', 'amazon'],
    body: `The error-budget practice is the most transferable idea in this area, because it resolves an argument that otherwise has no resolution.

**The problem it solves.** Product teams want to ship; reliability teams want stability. Without a shared quantity, this is a negotiation decided by whoever is more senior or more recently burned.

**The mechanism.** Set an SLO — say 99.9% over 28 days. That defines an **error budget** of 40 minutes of allowed unavailability. Then:

- **Budget remaining:** ship, deploy often, take risks. Unused budget is wasted opportunity.
- **Budget exhausted:** feature work stops, engineering effort moves to reliability, until the window rolls forward.

**Four consequences worth extracting.**

**100% is explicitly not the target.** A target of 100% means never changing anything, and the published reasoning is that users cannot tell the difference between 99.99% and 100% anyway — because their own network, device and ISP contribute more unavailability than that. **Choosing a target below what is technically achievable is a deliberate decision to spend the difference on velocity.**

**Unused budget is a signal too.** A team consistently far inside its budget is being too cautious and could ship faster. This is the direction people forget: the budget is a target to spend, not a limit to avoid.

**It makes the deploy-risk connection unavoidable.** If bad deploys consume 15 minutes a month against a 4.3-minute budget, the arithmetic states plainly that the release process is the binding constraint. No debate required.

**The SLI definition does most of the work.** An SLI measured server-side on status codes alone will report far better availability than users experience, because it misses DNS failures, TLS failures, and slow-but-successful responses. **Including a latency threshold in the definition of success is what makes the number honest**, and it is the change that most often reveals a team is not meeting the target it thought it was.

**The complementary idea from AWS's reliability guidance: failure isolation boundaries.** Availability is not only "is it up" but "what fraction of customers does one failure reach". Cell-based architectures — many independent copies of the stack, each serving a subset of customers — optimise blast radius rather than uptime. A cell being down is a total outage for its customers and invisible to everyone else, which changes both the metric and the incident response.

**The transferable questions.** What is your SLI, and is it measured where the user is with latency included? What is your monthly budget in minutes, and what is currently spending it? And if your answer to the second is "deploys", that is where the next nine has to come from.`,
  },

  tradeoffs: {
    intro:
      'Two bundled decisions: the topology, and how much data loss and recovery time you accept. Rows are ordered by increasing cost and increasing availability ceiling.',
    rows: [
      {
        option: 'Single instance, no redundancy',
        whenItWins:
          'Internal tools, development environments, anything where hours of downtime are acceptable. Cheapest and simplest, and simplicity is itself reliability.',
        whenItLoses:
          'Any user-facing service. A single instance is roughly 99% to 99.5% at best, and every deploy is an outage.',
        cost:
          'Days of downtime per year, and no failover path to have got wrong.',
      },
      {
        option: 'Multiple instances, single zone',
        whenItWins:
          'Protecting against instance and host failure cheaply, with no cross-zone latency or data-transfer cost.',
        whenItLoses:
          'A zone failure takes everything. And it does nothing about the dominant risk, which is a bad deploy reaching all instances.',
        cost:
          'A zone remains a single point of failure, and the redundancy addresses the least likely failure mode.',
      },
      {
        option: 'Multi-zone, single region, synchronous replica',
        whenItWins:
          'The right answer for most systems. Survives a zone failure, RPO of zero, 99.9%–99.99% genuinely achievable.',
        whenItLoses:
          'A region failure, or a regional control-plane failure that redundancy inside the region cannot address.',
        cost:
          '1–2 ms on every write, cross-zone data transfer, and a failover whose RTO you must measure rather than assume.',
      },
      {
        option: 'Multi-region active-passive',
        whenItWins:
          'When a region failure must be survivable and active-active data consistency is not affordable.',
        whenItLoses:
          'Very often, in practice. An untested failover performed under stress can make effective availability *worse* than single-region.',
        cost:
          'A duplicate fleet earning nothing, a large manual-ish operation with an RTO in minutes to hours, and a standby nobody has proven works.',
      },
      {
        option: 'Multi-region active-active',
        whenItWins:
          'When 99.99%+ is genuinely required. The failover path is continuously exercised because both regions serve, so it is a capability rather than a plan.',
        whenItLoses:
          'When the data problem is unaffordable — eventual consistency with conflict resolution, cross-region write latency, or partitioned ownership.',
        cost:
          'The hardest data-architecture commitment in this list, plus double the infrastructure.',
      },
      {
        option: 'Cell-based / shuffle-sharded',
        whenItWins:
          'Multi-tenant systems where blast radius matters more than uptime. One cell\'s failure is invisible to every other customer.',
        whenItLoses:
          'Single-tenant systems, and when utilisation is the binding constraint.',
        cost:
          'Operational complexity, lower utilisation, and a routing layer that must itself be more available than any cell.',
      },
      {
        option: 'Asynchronous replication',
        whenItWins:
          'When write latency matters and a small data-loss window is acceptable. No cost on the write path.',
        whenItLoses:
          'When losing acknowledged writes is unacceptable — a payment, a legal record.',
        cost:
          'RPO greater than zero: milliseconds to seconds of writes lost in a failover.',
      },
      {
        option: 'Synchronous or semi-synchronous replication',
        whenItWins:
          'When RPO must be zero. Semi-synchronous — wait for one of several replicas — gets most of the durability for less of the tail latency.',
        whenItLoses:
          'Cross-region, where the round trip is 50–150 ms on every write.',
        cost:
          'Latency on every write, and reduced availability if a replica must acknowledge before a commit can complete.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We run three instances, so we have high availability."',
      whyWeak:
        'Three instances protect against instance failure, which is rarely the dominant risk. They share the same build, the same configuration, often the same zone, and the same database — so a bad deploy, a bad config push, a zone failure or a database failure takes all three.',
      strongAnswer:
        '"Three instances give me instance-level redundancy, which is the least likely failure. I would ask what they share: the same build, so a bad deploy takes all three; the same config source; possibly the same zone; and certainly the same database, which appears once in the serial chain regardless of instance count. **Anything shared is a single point of failure in a redundant costume**, and in most well-run systems the dominant risk is the deploy."',
    },
    {
      weakAnswer: '"Our target is 99.99% availability."',
      whyWeak:
        'A target without arithmetic. 99.99% is 4.3 minutes per month. If any serial dependency is at 99.9% you have already spent ten times the budget on that dependency alone, and a single five-minute bad deploy exceeds the month.',
      strongAnswer:
        '"99.99% is 4.3 minutes a month, so before promising it I would multiply the serial chain — a single 99.9% dependency costs 43 minutes and makes the target impossible. Then I would count what deploys cost: sixty deploys a month with one in twenty causing a five-minute incident is 15 minutes, three and a half times the budget. **At that point the binding constraint is the release process, not the infrastructure**, and no redundancy fixes it."',
    },
    {
      weakAnswer: '"We have a passive region for disaster recovery."',
      whyWeak:
        'A failover path that has never carried production traffic is a plan, not a capability. It will fail in unpredicted ways — stale configuration, missing capacity, an expired certificate, a dependency that was never provisioned there — and it will fail while everyone is already under stress.',
      strongAnswer:
        '"A passive region is only as good as the last time it served real traffic. I would either exercise the failover regularly — shifting production traffic to it on a schedule, not just running a drill — or go active-active so the path is exercised continuously. Otherwise the effective availability can be *worse* than single-region, because a large untested operation performed under stress is itself a failure mode."',
    },
    {
      weakAnswer: '"Failover takes 5 seconds, so downtime is negligible."',
      whyWeak:
        'Five seconds is usually the promotion step alone. Detection is 5–30 seconds, traffic redirection can be 60 seconds because of DNS TTLs and pooled connections, and the newly-promoted primary is cold — possibly too slow to be useful for minutes.',
      strongAnswer:
        '"Five seconds is the promotion. The RTO is detection plus decision plus promotion plus traffic redirection plus warm-up, which is realistically 30 seconds to several minutes. Redirection is often the largest hidden term because runtimes cache DNS regardless of TTL — so I would front the database with a stable address and move the redirection below it. And I would measure the RTO by actually failing over, not by adding up the parts."',
    },
    {
      weakAnswer: '"Our monitoring shows 99.99% availability, so we are meeting our SLO."',
      whyWeak:
        'A server-side SLI on status codes alone misses everything before the request arrived — DNS failures, TLS failures, connections that timed out — and counts a 30-second response as a success. It can read 99.99% while users experience 99.5%.',
      strongAnswer:
        '"That depends on how the SLI is defined. Measured server-side on status codes, it misses DNS and TLS failures and requests that never arrived, and it counts a 30-second response as available. I would measure at the client or the edge, and include a latency threshold in the definition of success — a slow response is a failure to a user. **That single change most often reveals a team is not meeting the target it believed it was.**"',
      },
    {
      weakAnswer: '"We went multi-region to improve availability."',
      whyWeak:
        'It can reduce it. A multi-region deployment has more moving parts, more configuration, cross-region data consistency to manage, and a failover path that is complex and rarely exercised. Complexity is a failure mode that does not appear in the availability arithmetic.',
      strongAnswer:
        '"Multi-region raises the ceiling and can lower the actual number, because it adds configuration, a data-consistency problem, and a complex failover. I would first confirm that single-region multi-zone genuinely cannot meet the target — it reaches 99.99% for many systems — and that the binding constraint is not deploys. If multi-region is required, I would prefer active-active so the path is continuously exercised rather than active-passive where it is not."',
    },
  ],

  flashcards: [
    {
      id: 'fc-av-1',
      front: 'How do serial dependencies affect availability?',
      back: 'They multiply. Three 99.9% dependencies give 99.7%; ten give 99%. Every dependency added makes you less available.',
      topic: 'availability',
    },
    {
      id: 'fc-av-2',
      front: 'How does parallel redundancy affect availability?',
      back: 'It multiplies the *failure* probabilities. Two independent 99% components give 99.99% — two mediocre parts beat one excellent one.',
      topic: 'redundancy',
    },
    {
      id: 'fc-av-3',
      front: 'What is the availability arithmetic\'s critical assumption?',
      back: 'Independence. Two components sharing a build, a config source, a zone or a database are one component with extra cost.',
      topic: 'correlated-failure',
    },
    {
      id: 'fc-av-4',
      front: 'What is the monthly downtime budget at each nine?',
      back: '99% is 7.2 hours; 99.9% is 43 minutes; 99.99% is 4.3 minutes; 99.999% is 26 seconds.',
      topic: 'availability',
    },
    {
      id: 'fc-av-5',
      front: 'Why is 99.999% qualitatively different?',
      back: '26 seconds a month means no human can be in the recovery path — detection and remediation must be automatic, because nobody can be paged and diagnose that fast.',
      topic: 'availability',
    },
    {
      id: 'fc-av-6',
      front: 'What is the dominant availability risk in most well-run systems?',
      back: 'Deploys. All instances share the same build, so a bad deploy is fully correlated — the one failure mode redundancy cannot address.',
      topic: 'correlated-failure',
    },
    {
      id: 'fc-av-7',
      front: 'Name six correlations that break redundancy.',
      back: 'Shared code, shared configuration, shared infrastructure (host/rack/zone/region), a shared dependency, shared saturation, and a shared control plane.',
      topic: 'correlated-failure',
    },
    {
      id: 'fc-av-8',
      front: 'What are RTO and RPO?',
      back: 'RTO: how long until service resumes — what your error budget pays for. RPO: how much data you can lose. Zero RPO requires synchronous replication.',
      topic: 'failover',
    },
    {
      id: 'fc-av-9',
      front: 'Where does a failover\'s time actually go?',
      back: 'Detection (5–30 s, usually largest), decision, promotion (the fast part), traffic redirection (up to 60 s via DNS and pools), and warming a cold primary.',
      topic: 'failover',
    },
    {
      id: 'fc-av-10',
      front: 'Why does a "5-second failover" take two minutes?',
      back: 'Five seconds is the promotion. Detection, DNS TTLs, pooled connections to the old primary, and a cold cache on the new one dominate the real total.',
      topic: 'failover',
    },
    {
      id: 'fc-av-11',
      front: 'Why can active-passive multi-region be worse than single-region?',
      back: 'A failover path that has never carried production traffic is a plan, not a capability. It fails unpredictably, while everyone is already under stress.',
      topic: 'redundancy',
    },
    {
      id: 'fc-av-12',
      front: 'What makes an SLI honest?',
      back: 'Measuring where the user is — so DNS and TLS failures count — and including a latency threshold, so a slow response is not counted as available.',
      topic: 'slo',
    },
    {
      id: 'fc-av-13',
      front: 'What does an error budget convert?',
      back: 'An argument about how careful to be into arithmetic. Budget remaining means ship; budget exhausted means stop feature work. Unused budget is wasted velocity.',
      topic: 'slo',
    },
    {
      id: 'fc-av-14',
      front: 'What does a cell-based architecture optimise?',
      back: 'Blast radius rather than uptime. A cell being down is total for its customers and invisible to everyone else, so the metric becomes "what fraction of customers were affected".',
      topic: 'redundancy',
    },
  ],

  quiz: [
    {
      id: 'q-av-1',
      kind: 'scenario',
      prompt:
        'A request requires four services in series, each 99.9% available. What is the resulting availability, and what does it mean per month?',
      options: [
        { id: 'a', label: 'About 99.6% — roughly 2.9 hours of downtime per month' },
        { id: 'b', label: '99.9%, since each service meets the target' },
        { id: 'c', label: 'About 99.99%, since the failures are independent and unlikely to coincide' },
        { id: 'd', label: 'It depends on which service is slowest' },
      ],
      correct: ['a'],
      explanation:
        '0.999⁴ ≈ 0.996. Serial dependencies multiply availability, so a chain is always worse than its worst member — which is why the cheapest availability improvement is usually removing a dependency rather than adding redundancy to one.',
      difficulty: 'core',
      topic: 'availability',
    },
    {
      id: 'q-av-2',
      kind: 'scenario',
      prompt:
        'A team runs three API instances at 99.5% each and computes the tier\'s availability as 99.99999%. What is wrong with the calculation?',
      options: [
        { id: 'a', label: 'It assumes independence — the instances share a build, a config source, possibly a zone, and certainly a database, so those failures are fully correlated' },
        { id: 'b', label: 'The formula should multiply availabilities rather than unavailabilities' },
        { id: 'c', label: 'Nothing; three instances genuinely give seven nines' },
        { id: 'd', label: 'It should use the binomial for 2-of-3 rather than 1-of-3' },
      ],
      correct: ['a'],
      explanation:
        'The parallel formula is correct and its assumption is not. A bad deploy reaches all three instances, as does a bad config push; a zone failure takes all three if they share a zone; and the shared database appears once in the serial chain regardless. The real availability of the tier is dominated by whatever the instances share.',
      difficulty: 'core',
      topic: 'correlated-failure',
    },
    {
      id: 'q-av-3',
      kind: 'scenario',
      prompt:
        'A team targets 99.99% and deploys twice daily. One deploy in twenty causes a 5-minute user-visible incident. What does that cost against the budget?',
      options: [
        { id: 'a', label: '15 minutes per month against a 4.3-minute budget — deploys alone exceed it three and a half times over' },
        { id: 'b', label: 'About 1 minute per month, which fits comfortably' },
        { id: 'c', label: 'Nothing, since deploys are planned rather than unplanned' },
        { id: 'd', label: 'It depends on whether the incidents happen during business hours' },
      ],
      correct: ['a'],
      explanation:
        '60 deploys × 1/20 × 5 minutes = 15 minutes. The 99.99% monthly budget is 4.3 minutes. This is why the next nine usually has to come from release engineering — canary deploys with automatic rollback — rather than from infrastructure. Planned or not, user-visible unavailability spends the budget.',
      difficulty: 'advanced',
      topic: 'slo',
    },
    {
      id: 'q-av-4',
      kind: 'scenario',
      prompt:
        'A database advertises a 5-second automatic failover. In production, users report roughly 2 minutes of errors. Where did the time go?',
      options: [
        { id: 'a', label: 'Detection before promotion, DNS TTLs and pooled connections to the old primary during redirection, and a cold cache on the new primary afterwards' },
        { id: 'b', label: 'The failover actually failed and had to be retried' },
        { id: 'c', label: 'Replication lag delayed the promotion' },
        { id: 'd', label: 'The advertised figure assumes synchronous replication and they use asynchronous' },
      ],
      correct: ['a'],
      explanation:
        'Five seconds is the promotion step. The RTO is detection (5–30 s) plus decision plus promotion plus redirection — where DNS caching, often indefinite regardless of TTL, and existing pooled connections dominate — plus warming a primary with empty caches and pools. The remedy for the largest term is a stable address with redirection happening below it.',
      difficulty: 'core',
      topic: 'failover',
    },
    {
      id: 'q-av-5',
      kind: 'scenario',
      prompt:
        'A server-side SLI reports 99.99% success. Users report frequent problems. What is the likely gap?',
      options: [
        { id: 'a', label: 'The SLI misses failures before the request arrived — DNS, TLS, timeouts — and counts slow-but-successful responses as available' },
        { id: 'b', label: 'The users are experiencing problems with their own devices' },
        { id: 'c', label: 'The SLI window is too long to show recent incidents' },
        { id: 'd', label: 'The SLI is measuring the wrong service' },
      ],
      correct: ['a'],
      explanation:
        'These are the two standard ways a server-side status-code SLI overstates availability: it cannot count requests that never arrived, and a 30-second response is a success to it and a failure to the user. Measuring at the client or edge and including a latency threshold in the success definition is the fix, and it frequently reveals a target is not being met.',
      difficulty: 'core',
      topic: 'slo',
    },
    {
      id: 'q-av-6',
      kind: 'multi',
      prompt:
        'Which statements about multi-region active-passive are correct? Select all that apply.',
      options: [
        { id: 'a', label: 'The failover path is exercised only during drills or incidents, so it may not work when needed' },
        { id: 'b', label: 'Effective availability can be worse than a well-run single-region deployment' },
        { id: 'c', label: 'The passive fleet costs money while producing no value' },
        { id: 'd', label: 'It removes the data-consistency problem that active-active has' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the honest costs. The fourth is only partly true: active-passive avoids serving from two regions simultaneously, and it still needs the passive region\'s data to be current enough to serve, which is the same replication-lag and RPO problem in a different guise — and the lag is what determines how much you lose when you do fail over.',
      difficulty: 'advanced',
      topic: 'redundancy',
    },
  ],

  exercises: [
    {
      id: 'ex-av-1',
      kind: 'design',
      title: 'Compute it, then find the binding constraint',
      estimatedMinutes: 30,
      prompt: `A payments platform wants to promise 99.99% availability. Current architecture:

- CDN: 99.99% (vendor SLA)
- Application load balancer: 99.99% (vendor SLA)
- API service: 6 instances across 2 availability zones
- Auth service: 3 instances, single zone, 99.9% measured
- PostgreSQL: primary + synchronous replica in a second zone, automatic failover measured at 40 seconds, roughly 5 failovers per year
- Payment processor (third party): 99.95% contractual
- Redis cache: single instance, single zone, used for session lookup on every request
- Deploys: 3 per day, historically 1 in 15 causing a user-visible incident averaging 8 minutes

Compute the realistic availability. Identify the top three constraints in order. Then answer:

- What is the cheapest change that buys the most availability?
- What would 99.999% require, and is it achievable here?
- The payment processor is 99.95%. Can you do better than your dependency?
- What would you measure to know whether you are actually meeting the target?`,
      rubric: [
        'Computes the serial product, including Redis and the auth service.',
        'Identifies Redis single-instance as a serial dependency with poor availability.',
        'Quantifies deploy cost in minutes per month and compares to the budget.',
        'Quantifies failover cost against the monthly budget.',
        'Correctly ranks the top three constraints with numbers.',
        'Cheapest change is justified numerically, not by intuition.',
        '99.999% answer identifies which terms individually exceed a 26-second budget.',
        'Payment-processor answer proposes decoupling rather than accepting the ceiling.',
        'Measurement answer specifies a client-side SLI with a latency threshold.',
      ],
      modelAnswer: `**Compute the serial chain first.**

Every one of these is required for a request to succeed, so they multiply.

\`\`\`
CDN                       0.9999
Load balancer             0.9999
API tier (2 AZ, 6 inst.)  0.9999    (deploy-limited — see below)
Auth service              0.999
Redis (single instance)   0.995     ← estimated; single instance, single zone
Payment processor         0.9995
Database                  0.99999   (failover-limited, computed below)
─────────────────────────────────────
Product                   ≈ 0.9932  →  99.32%
\`\`\`

**99.32% is 4.9 hours of downtime per month**, against a promise of 4.3 minutes. Off by a factor of 68.

**Now the two terms I estimated, computed properly.**

**Redis: single instance, single zone, on every request.** A single instance with no replica is realistically 99.5% at best — it covers process crashes, host failures, the zone, and every restart for a version upgrade or configuration change. **On every request means it is a serial dependency**, so it contributes its full unavailability: roughly 3.6 hours per month.

**Database failover cost:**

\`\`\`
5 failovers/year × 40 s = 200 s/year
200 / 31,536,000 = 0.0000063  →  99.9994%
Per month: ~17 seconds
\`\`\`

Small in the annual figure. **Against a 4.3-minute monthly budget, one 40-second failover is 15% of the month** — and failovers cluster, so a month with two is 31%.

**Deploy cost:**

\`\`\`
3/day × 30 = 90 deploys/month
90 × (1/15) = 6 incidents/month
6 × 8 min = 48 minutes/month
\`\`\`

**48 minutes per month from deploys alone.** That is 11× the entire 99.99% budget, and larger than every infrastructure term combined.

**Total realistic availability:**

\`\`\`
Serial chain (excl. deploys)   99.32%   →  ~294 min/month
Deploys                                  →  ~48 min/month
──────────────────────────────────────────────────────────
Total unavailability            ~342 min/month  →  ~99.21%
\`\`\`

**~99.21%.** The promise of 99.99% is not close.

**The top three constraints, in order**

**1. Redis as a single-instance serial dependency — ~216 minutes/month.**

The largest single term by a wide margin, and the least defensible. Every request needs a session lookup, so a single Redis instance's availability is a hard ceiling on the whole system. It cannot be better than Redis.

**2. Deploys — ~48 minutes/month.**

The second largest, and larger than all remaining infrastructure combined. Also entirely within the team's control, which makes it the most tractable.

**3. Auth service, single zone, 99.9% — ~43 minutes/month.**

Single-zone means a zone failure takes it out entirely, and at 99.9% it alone makes 99.99% arithmetically impossible.

*Everything else combined* — CDN, load balancer, payment processor, database failovers — is roughly 22 + 22 + 13 minutes of vendor terms plus 17 seconds of failover, so about 57 minutes. Notable, and third-tier.

**The cheapest change that buys the most availability**

**Make Redis multi-instance and multi-zone: a replicated cluster with automatic failover across two zones.**

\`\`\`
Before: 0.995      → ~216 min/month of unavailability
After:  0.9999     → ~4.3 min/month
Saving: ~212 minutes/month
\`\`\`

*Why it is the cheapest:* it is a configuration and provisioning change on an existing component. No application redesign, no data-model change, no new failure semantics. A managed Redis with a replica in a second zone is a one-line infrastructure change and perhaps a small cost increase.

*But the actually-cheapest change might be better still: make the session lookup non-blocking.*

If a Redis miss or error falls back to validating the session token cryptographically — a signed token the API can verify locally — then **Redis stops being a serial dependency entirely.** It becomes an optimisation: present and fast, absent and slightly slower.

\`\`\`
Redis as serial dependency:  contributes its full unavailability
Redis as optional cache:     contributes ZERO to the serial chain
\`\`\`

**That removes 216 minutes per month for the cost of a code change**, and it is strictly better than making Redis more reliable — because a dependency that cannot fail the request has no availability at all from the system's point of view.

**This is the most valuable move in the whole exercise, and it generalises: the cheapest availability improvement is usually removing a dependency from the serial chain, not making it more reliable.** I would do both — remove the hard dependency *and* add the replica — but the code change is where the arithmetic moves.

**Second-cheapest: canary deploys with automatic rollback.**

\`\`\`
Before: 6 incidents × 8 min × 100% of traffic = 48 min/month
After:  6 incidents × 1.5 min × 5% of traffic ≈ 0.45 min/month
Saving: ~47 minutes/month
\`\`\`

Deploy to 5% of instances, watch the error rate for 90 seconds, roll back automatically on regression. The incident still happens; it affects a twentieth of traffic for a fifth of the time.

*Combined, those two changes take unavailability from ~342 minutes to ~83 minutes per month — 99.81%.* Neither requires a new region or a new topology.

**What 99.999% would require, and is it achievable here?**

**26 seconds per month.** Examine each term against that:

| Term | Current cost/month | Fits in 26 s? |
| --- | --- | --- |
| Database failover | 17 s (one event) | **Barely — one event is 65% of the budget** |
| CDN (vendor 99.99%) | 4.3 min | **No — 10× the budget** |
| Load balancer (vendor 99.99%) | 4.3 min | **No** |
| Payment processor (99.95%) | 21.6 min | **No — 50× the budget** |
| Deploys, even with canary | ~27 s | **No** |

**Not achievable, and the reason is decisive: the vendor SLAs alone exceed the budget by an order of magnitude.** A 99.99% CDN and a 99.99% load balancer contribute 8.6 minutes a month between them. No amount of engineering inside the system changes that.

**To even approach 99.999% would require:**

- **Two CDNs** with automatic failover between them, so their unavailabilities multiply rather than add: \`0.0001² = 10⁻⁸\`. Genuinely done by some organisations, and expensive and complex.
- **Multiple load-balancing tiers**, similarly.
- **The payment processor removed from the synchronous path** — see below.
- **Sub-10-second database failover**, or an architecture that tolerates a read-only window without counting it as downtime.
- **No human in any recovery path**, since 26 seconds excludes being paged.

**My recommendation would be to target 99.95%** (21.6 min/month) and state honestly why: the vendor dependencies make 99.99% require dual-CDN and dual-load-balancer architectures, and 99.999% is not reachable with any third-party dependency in the synchronous path. **Promising a number the arithmetic forbids is worse than promising a lower one**, because the SLA is a contract with consequences.

**The payment processor is 99.95%. Can I do better than my dependency?**

**Yes — by removing it from the synchronous path.** This is the most interesting question here because the intuitive answer is no.

*The reframe:* a payment does not have to complete synchronously for the user's request to succeed. Instead:

\`\`\`
1. Accept the order, write it durably with status = payment_pending
2. Return success to the user
3. Charge asynchronously from a durable queue, with an idempotency key
4. Notify the user of the outcome
\`\`\`

Now the processor's availability affects **payment completion latency**, not **request availability**. If it is down for 20 minutes, orders continue to be accepted and the charges complete when it recovers. The system's availability for "place an order" is unaffected.

**The processor has left the serial chain**, exactly as Redis did.

*What this costs, honestly:*

- **The user learns the outcome later**, so the interface must show a pending state and handle a later decline. That is a product change, not a technical one, and it is the real cost.
- **A declined card is discovered after the order is accepted**, so there must be a cancellation flow.
- **It requires the durable queue and idempotency machinery** from the delivery-semantics lesson — which this platform needs anyway.

*Where it does not work:* if the business requires payment authorisation before fulfilment — a digital good delivered immediately — then the processor genuinely is synchronous and 99.95% is a hard ceiling for that operation. **Then I would use a second processor as a fallback**, so their unavailabilities multiply: \`0.0005 × 0.0005 = 2.5 × 10⁻⁷\`. Real work — two integrations, two reconciliations, routing logic — and it is the only way to exceed a single vendor's availability.

*And the general principle:* **you can only exceed a dependency's availability by removing it from the critical path or by having two of it.** There is no third option, and recognising which one applies is the design decision.

**What I would measure to know whether the target is met**

**The SLI, defined precisely:**

\`\`\`
Good request  = HTTP 2xx or 4xx (client errors are not our unavailability)
                AND total time < 1,000 ms
Measured      = at the client, via real-user monitoring, plus synthetic
                probes from several regions
Window        = 28 days, rolling
SLO           = 99.95% of good requests
\`\`\`

**Four decisions in that definition, each load-bearing.**

**Measured at the client, not the server.** A server-side SLI cannot count requests that never arrived — DNS failures, TLS failures, connections that timed out at the load balancer. Those are real user-visible failures and a server-side measurement is structurally blind to them.

**A latency threshold in the success definition.** A 30-second response is a failure to a user. Without this, the SLI counts the backpressure lesson's zero-goodput state as fully available — which is the most common way an SLI overstates availability.

**4xx excluded.** A client sending a malformed request is not our unavailability. Including them makes the SLI track client behaviour rather than our reliability. **The exception is 429**, which *is* our unavailability — we rejected work we could not serve — and I would count it as a failure.

**Synthetic probes alongside real-user monitoring.** Real-user monitoring goes quiet during a total outage, because there are no users to report. Synthetic probes from outside keep measuring precisely when it matters most.

**Per-operation SLIs, not one number.** "Place an order" and "view order history" have different criticality and should have different objectives. A single number hides that checkout is broken while browsing works — and the availability that matters commercially is the checkout one.

**And the error budget as the operational artefact:**

\`\`\`
99.95% over 28 days = 20.2 minutes of budget
Weekly review: budget consumed, and by what
  → deploys, database failovers, dependency incidents, capacity
Budget exhausted → feature work stops until the window rolls
\`\`\`

**The attribution is the useful part.** Knowing that 48 of 20 minutes went to deploys tells the team exactly what to fix, and it settles the argument about whether to invest in release engineering without anyone needing to win a debate.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-av-1',
      level: 'basic',
      question: 'How does adding a dependency affect availability?',
      guidance:
        'Serial dependencies multiply, so every dependency makes you less available. Look for a concrete number — four 99.9% dependencies give 99.6% — and for the conclusion that removing a dependency is often the cheapest improvement.',
    },
    {
      id: 'iq-av-2',
      level: 'basic',
      question: 'What does 99.99% availability mean in practical terms?',
      guidance:
        '4.3 minutes per month. A strong answer immediately connects that to something concrete — one bad deploy taking five minutes to roll back has spent more than the month.',
    },
    {
      id: 'iq-av-3',
      level: 'intermediate',
      question: 'You have three replicas. What is your actual availability?',
      guidance:
        'Unanswerable without knowing what they share: build, config, zone, database, control plane. Look for the question being turned into "what do they share" rather than computed from the parallel formula.',
    },
    {
      id: 'iq-av-4',
      level: 'intermediate',
      question: 'Walk me through what happens during a database failover.',
      guidance:
        'Detection, decision, promotion, traffic redirection, warm-up — with detection and redirection dominating. Strong answers name DNS caching and pooled connections, and distinguish RTO from RPO.',
    },
    {
      id: 'iq-av-5',
      level: 'advanced',
      question: 'A team promises 99.99% and deploys three times a day. Is that consistent?',
      guidance:
        'Usually not: compute deploy-caused unavailability against a 4.3-minute budget. Excellent answers conclude the next nine must come from release engineering — canary with automatic rollback — rather than infrastructure.',
    },
    {
      id: 'iq-av-6',
      level: 'advanced',
      question: 'Can you be more available than your least available dependency?',
      guidance:
        'Only by removing it from the critical path or having two of it. Excellent answers give a concrete removal — make a payment asynchronous, make a cache optional — and note there is no third option.',
    },
    {
      id: 'iq-av-7',
      level: 'followup',
      question: 'You have a passive region for disaster recovery. What worries you?',
      guidance:
        'That the failover path has never carried production traffic, so it is a plan rather than a capability — and it will be exercised for the first time under stress. A strong answer proposes scheduled traffic shifts or active-active.',
    },
    {
      id: 'iq-av-8',
      level: 'followup',
      question: 'Your dashboard says 99.99% and users complain. Where is the gap?',
      guidance:
        'A server-side status-code SLI misses DNS, TLS and pre-arrival timeouts, and counts slow responses as successes. Measure at the client with a latency threshold, keep synthetic probes for total outages, and report per operation.',
    },
  ],

  activeLearning: [
    {
      id: 'al-av-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above treated availability as a single number for the whole system. Now change one thing: you are multi-tenant with 5,000 customers, and one customer\'s traffic can affect others. What does availability mean now, and what do you measure?',
      discussion: `The single-number model breaks in a specific and important way, and the fix changes both the metric and the architecture.

**Why one number is now wrong.** Suppose one customer out of 5,000 experiences a total outage for an hour. Aggregate availability is:

\`\`\`
(4,999 × 1.0 + 1 × 0.0) / 5,000 = 99.98%
\`\`\`

Your dashboard shows 99.98% — comfortably inside a 99.9% target. **That customer experienced 0%**, and they are the one filing a complaint and considering leaving. Aggregate availability structurally hides per-customer outages, and the larger your customer count, the better it hides them.

**What to measure instead.**

**Per-customer availability, and then report the distribution.** Not the mean:

\`\`\`
p50 customer availability:   100%
p99 customer availability:   99.7%
p99.9 customer availability: 94%      ← the customers who are leaving
Worst customer:              81%
\`\`\`

**The objective should be on the *worst* customers**, not the average. "99.9% for 99% of customers" is a meaningful statement; "99.98% aggregate" is not.

**Fraction of customers affected, per incident.** This is the blast-radius metric, and it is what an incident review should record. An incident affecting 3% of customers is categorically different from one affecting 100%, and an aggregate availability number treats a brief total outage and a long single-customer outage as similar.

**Weighted by importance, honestly.** If one customer is 30% of revenue, their availability matters more commercially. Uncomfortable to state and true, and better stated explicitly than implied by which pages get answered.

**What changes architecturally.**

**Blast radius becomes a first-class design goal**, sometimes above uptime. Cell-based architecture — many independent copies of the whole stack, each serving a subset of customers — means a failure affects one cell's customers and nobody else. Aggregate availability may not improve at all; **the worst-case customer experience improves enormously**, and that is the thing that was actually broken.

**Shuffle sharding sharpens it.** Assign each customer a random subset of cells rather than one. With two of ten cells there are 45 distinct pairs, so a customer sharing *both* cells with a problematic tenant is rare. The load-balancing lesson's mechanism, applied to availability.

**Per-tenant isolation becomes an availability mechanism, not just a fairness one.** Per-tenant concurrency limits and quotas stop one customer's traffic degrading others — so the rate-limiting lesson's blast-radius argument is really an availability argument.

**The routing layer becomes the new correlated failure.** Something must map customers to cells, and that thing is shared by everyone. **It must be more available than any cell**, which usually means it is simple, static, and rarely changed — a mapping in DNS or a small config file rather than a service with a database.

**And the correlations that survive cells.** Cells help with capacity, bad data, and a single tenant's traffic. They do not help with: a bad deploy rolled out to all cells (deploy cell-by-cell with a pause), a bad config pushed globally, or a shared control plane. **The deploy correlation is the important one** — cells only bound the blast radius if the change itself is deployed cell by cell, and that is a release-process decision rather than an architectural one.

**What I would actually do.** Measure per-customer availability and set the objective on the p99 customer, not the mean. Add per-tenant concurrency limits, which is cheap. Consider cells when the worst-customer number is bad and the aggregate looks fine — that gap is the signal. And deploy cell by cell, since otherwise the cells provide isolation against everything except the most likely failure.

**The transferable point.** An aggregate availability number answers "how much did we fail" and not "who did we fail". In a multi-tenant system the second question is the commercially important one, and it is invisible in the first — **which is why a team can hit its SLO every month and steadily lose the customers who are experiencing the failures.**`,
    },
    {
      id: 'al-av-2',
      kind: 'debug',
      prompt:
        'A service has met its 99.9% monthly SLO for six months. Customer complaints about reliability have been steadily rising over the same period. Both facts are verified. Hypotheses?',
      discussion: `The SLO is met and users are increasingly unhappy, so the SLI is measuring something other than what users experience. The steady rise over six months suggests something growing rather than a discrete change.

**Hypothesis 1 — the SLI has no latency threshold, and latency has been degrading.** If success is defined by status code alone, a response taking 25 seconds counts as available. Six months of gradual latency growth — more data, more features, a slowly-saturating dependency — would produce exactly this: a stable SLI and steadily worse experience.

*Why it fits best:* it explains the *gradual* rise better than anything else, and it is the most common SLI defect. A latency regression does not move a status-code SLI at all.

*Check:* the p95 and p99 latency trend over six months, and whether the SLI definition includes a latency bound. **If p99 has doubled while the SLI is flat, this is the answer.**

**Hypothesis 2 — the SLI is measured server-side and misses pre-arrival failures.** DNS failures, TLS handshake failures, connections that timed out at the load balancer, requests rejected before reaching the application. None appear in a server-side measurement, and all are total failures to the user.

*Why the rise:* growing traffic means more connection churn, and a load balancer or connection pool nearing saturation rejects a growing fraction before the application sees it.

*Check:* compare load-balancer-level request counts against application-level counts. A widening gap is the finding, and it is a comparison almost nobody makes.

**Hypothesis 3 — aggregate availability hides a growing set of badly-affected users.** As customer count grows, a fixed number of badly-affected customers is a shrinking fraction of the aggregate. Or a subset — one region, one client version, one tenant — is experiencing much worse availability while the mean stays fine.

*Why the rise:* the affected population is growing in absolute terms while shrinking as a fraction.

*Check:* availability by percentile across customers, and broken down by region, client version and tenant. **Look for a p99-customer number far worse than the mean** — that gap is precisely the multi-tenant blind spot.

**Hypothesis 4 — the failures are concentrated in one operation that the SLI averages away.** If checkout is 3% of requests and is failing 20% of the time, the aggregate SLI moves by 0.6% and stays inside the target. But 20% of checkouts failing is a commercially serious problem and every affected user complains.

*Why it fits:* it explains a large complaint volume with a small SLI impact, which is exactly the reported pattern.

*Check:* success rate per endpoint or per operation class, weighted by importance rather than by volume. **A high-value, low-volume operation is invisible in an aggregate SLI**, and this is the case for per-operation SLOs.

**Hypothesis 5 — the complaints are about something the SLI does not cover at all.** Correctness rather than availability: stale data, wrong results, a slow background job, missing notifications. Every request returns 200 quickly and the answers are wrong.

*Why it fits the rise:* replication lag growing with data volume, or a projection falling behind — the consistency-model anomalies, which no availability metric detects.

*Check:* read the complaints. **This should genuinely be step one**, and it is skipped because it is not a metric.

**What I would check first: read a sample of the complaints.** Twenty tickets, categorised. It is the cheapest possible action and it discriminates between "slow", "error", "wrong data" and "missing notification" — four different investigations. Choosing an investigation without reading the reports is how a team spends a week on the wrong hypothesis.

**Then: the p99 latency trend against the SLI definition** (hypothesis 1), and **per-operation success rates** (hypothesis 4). Those two cover the most likely metric defects.

**Why this is a serious finding rather than a measurement quibble.** An SLO met while users are unhappy means **the error budget is providing false assurance.** The team is shipping features on the strength of a green budget, and the budget is measuring the wrong thing. Every decision that budget informs is being made on bad data — which is worse than having no budget, because a wrong number is trusted and an absent one prompts a question.

**The fixes.**

**Add a latency threshold to the SLI.** Most valuable single change: success means 2xx *and* under the latency target. This immediately converts a latency regression into budget consumption.

**Measure at the client, with synthetic probes.** Real-user monitoring catches pre-arrival failures; synthetic probes keep measuring during a total outage when there are no users left to report.

**Report per-operation and per-customer-percentile**, not one aggregate. A single number is the wrong shape for a system with operations of differing importance and customers of differing size.

**Close the loop between complaints and the SLI.** If complaints rise while the budget is healthy, **that is a defect in the SLI** and it should trigger a review of the definition. Treating the SLI as fixed and the complaints as noise is the failure that let this run for six months.

**Transferable:** an SLO is only as good as its SLI, and the standard defects are always the same — no latency threshold, measured server-side, aggregated across operations of unequal importance, and averaged across customers of unequal size. **A green SLO alongside rising complaints is not a contradiction to explain away; it is a measurement bug to fix**, and complaints are the ground truth against which the metric is validated rather than the other way round.`,
    },
  ],

  revision: {
    bullets: [
      'Serial dependencies multiply availability: three 99.9% dependencies give 99.7%, ten give 99%.',
      'Parallel redundancy multiplies failure probabilities — two independent 99% parts give 99.99%.',
      'The parallel arithmetic assumes independence, and independence is almost always partly false.',
      'Anything two replicas share — build, config, zone, database, control plane — is a single point of failure.',
      'Monthly budgets: 99% is 7.2 h, 99.9% is 43 min, 99.99% is 4.3 min, 99.999% is 26 s.',
      'At 99.999% no human can be in the recovery path — 26 seconds excludes being paged.',
      'Deploys are the dominant availability risk in most well-run systems, because all instances share a build.',
      'RTO is what your error budget pays for; RPO is how much data you accept losing.',
      'Failover time is dominated by detection and by traffic redirection, not by promotion.',
      'DNS caching and pooled connections are why a "5-second failover" takes two minutes.',
      'A newly-promoted primary is cold, and may be too slow to be useful for minutes.',
      'An untested active-passive failover is a plan, not a capability, and can lower effective availability.',
      'Active-active is more available largely because the failover path is continuously exercised.',
      'Cell-based architecture optimises blast radius, not uptime — and only if deploys go cell by cell.',
      'An SLI must be measured where the user is and must include a latency threshold.',
      'The cheapest availability improvement is usually removing a dependency from the serial chain.',
      'You can only beat a dependency\'s availability by removing it from the critical path or having two of it.',
      'Aggregate availability hides per-customer outages; set the objective on the worst customers.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The arithmetic and mechanisms governing how often a system is usable: serial dependencies multiplying availability, parallel redundancy multiplying failure, and failover converting a component failure into a bounded period of unavailability.',
    whyItExists:
      'Because availability is a computed property of a topology rather than a feature you add, and because most claimed targets are arithmetically impossible given the dependencies and release cadence behind them.',
    whenToUse: [
      'Before promising any availability number, to check the arithmetic.',
      'When choosing a topology, to see which nine each option can reach.',
      'When defining an SLO and error budget, to know what will spend it.',
      'When reviewing redundancy, to establish what the replicas share.',
    ],
    whenNotToUse: [
      'As a single number for a system with operations of differing importance.',
      'As a single number for a multi-tenant system, where blast radius is the real metric.',
      'To justify multi-region before confirming deploys are not the binding constraint.',
      'With vendor nines taken at face value, without reading their measurement definition.',
    ],
    alternatives: [
      'Per-operation SLOs, so a broken checkout is not averaged away by working browsing.',
      'Per-customer availability percentiles, so the worst-affected customers are visible.',
      'Blast-radius metrics — fraction of customers affected per incident.',
      'Removing a dependency from the critical path, instead of making it more reliable.',
      'Graceful degradation, so a dependency failure reduces service rather than ending it.',
    ],
    tradeoffs: [
      'Each additional nine costs roughly an order of magnitude, increasingly in process rather than infrastructure.',
      'Synchronous replication buys RPO of zero and costs latency on every write.',
      'Multi-zone buys zone-failure survival and costs cross-zone latency and transfer.',
      'Active-passive buys region-failure survival on paper and costs an idle fleet plus an untested path.',
      'Active-active buys an exercised failover path and costs a hard data-consistency commitment.',
      'Cells buy a bounded blast radius and cost utilisation plus a highly-available routing layer.',
    ],
    failureModes: [
      'Promising a target the serial arithmetic forbids.',
      'Counting redundant instances that share a build, a config source, or a zone.',
      'A shared dependency appearing once in the chain regardless of instance count.',
      'Deploys consuming several times the entire monthly error budget.',
      'A quoted failover time that omits detection, redirection and warm-up.',
      'DNS caching keeping clients pointed at a failed primary long past the TTL.',
      'A cold promoted primary too slow to be useful, counted as a successful failover.',
      'A passive region failing on its first real use, under stress.',
      'A server-side status-code SLI reporting far better availability than users experience.',
      'Aggregate availability hiding a growing set of badly-affected customers.',
      'A high-value low-volume operation failing without moving the aggregate SLI.',
      'Multi-region complexity reducing actual availability while raising the theoretical ceiling.',
    ],
    followUpQuestions: [
      'Have you multiplied the serial chain? What is the product?',
      'For each redundant pair, what do they share?',
      'What is your monthly error budget in minutes, and what currently spends it?',
      'How much of the budget do deploys consume?',
      'What is your measured RTO — measured by failing over, not by adding up parts?',
      'What is your RPO, and who owns the sentence accepting it?',
      'Where is your SLI measured, and does it include a latency threshold?',
      'Is your objective per operation, or one aggregate number?',
      'What is the availability of your worst-affected customer?',
      'When did the failover path last carry production traffic?',
      'Which dependency could you remove from the critical path entirely?',
    ],
  },
});
