import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'h-framework',
  title: 'The HLD interview framework',
  summary:
    'Nine steps in a fixed order, practised on a system small enough to see the whole loop: the order is the skill, because it is what stops you designing before you know what you are designing.',
  phase: 'hld',
  module: 'method',
  position: 38,
  kind: 'method',
  difficulty: 'core',
  estimatedMinutes: 45,
  tags: ['framework', 'method', 'interview-process', 'scoping', 'trade-offs'],
  prerequisites: ['d-observability'],
  resources: [
    {
      key: 'system-design-primer',
      tier: 'must',
      note: 'Read its "how to approach a system design interview question" section and compare its steps with the nine below. Where they differ, ask which order forces you to establish facts before committing to a design.',
    },
    {
      key: 'latency-numbers',
      tier: 'must',
      note: 'Memorise the order of magnitude of each line. Step 3 of the loop is impossible without these, and looking them up mid-interview is not available to you.',
    },
    {
      key: 'ddia-book',
      tier: 'must',
      note: 'The knowledge the loop draws on. The framework is how you retrieve what you know under time pressure; this is where the knowledge comes from.',
    },
    {
      key: 'google-sre-slo',
      tier: 'good',
      note: 'Read it for how to state a non-functional requirement precisely. "Highly available" is not a requirement; "99.9% of reads under 200 ms" is, and step 2 needs the second kind.',
    },
    {
      key: 'google-api-design-guide',
      tier: 'good',
      note: 'Useful for step 4, where you write the API. A well-shaped API is the fastest way to demonstrate that you understood the requirements.',
    },
    {
      key: 'aws-well-architected-reliability',
      tier: 'advanced',
      note: 'Read the failure-management sections as a checklist for step 8. Having a standard list of things that fail turns that step from improvisation into recall.',
    },
  ],

  intuition: {
    body: `A 45-minute design interview fails in one of three ways, and all three are process failures rather than knowledge failures.

**Designing before scoping.** The candidate hears "design Twitter" and starts drawing boxes. Twenty minutes later the interviewer asks about the follower graph and the design has no answer, because the candidate never established whether follows were part of the problem. **Everything drawn before scoping is drawn at random.**

**Estimating nothing.** The candidate proposes a design with no numbers, so every decision is unfalsifiable. "We'll shard the database" — into how many shards? "We'll cache it" — how much data, and does it fit? Without numbers there is no way to tell a good decision from a plausible-sounding one, and the interviewer cannot follow the reasoning because there is none.

**Running out of time in the middle.** The candidate spends 25 minutes on the data model, and the interview ends before scaling or failure. **A design that is 60% complete across all areas scores far better than one that is 100% complete on a third of them**, because the interviewer is assessing breadth of judgement.

The framework exists to prevent all three. Nine steps, in this order:

\`\`\`
1. Understand    — restate the problem, name the core entities
2. Clarify       — ask the questions that change the architecture
3. Estimate      — QPS, storage, bandwidth, out loud
4. Model         — API and data model
5. Design        — the boxes, derived from steps 2–4
6. Deep dive     — one or two components, in real detail
7. Scale         — what breaks first, and what you do
8. Fail          — what happens when each part dies
9. Defend        — name the trade-offs you chose and why
\`\`\`

**The order is the entire point.** Each step's output is the next step's input:

- You cannot ask useful clarifying questions without having restated the problem.
- You cannot estimate without knowing scope.
- You cannot choose a data model without numbers — 10 GB and 10 PB are different designs.
- You cannot draw boxes without an API, because the boxes are what serve the API.
- You cannot deep dive without a design to dive into.

**And the timing is a constraint, not a suggestion.** In 45 minutes: about 10 minutes for steps 1–3, 10 for steps 4–5, 15 for step 6, 8 for steps 7–8, and 2 for step 9. **Steps 1–3 are the ones people over-run**, and over-running them costs the deep dive, which is where the signal is.

The framing to carry: **the framework is not a script to recite, it is an order that stops you from making decisions you have no basis for.** Practise it on something trivial until the order is automatic, so that under pressure you follow it without spending attention on it.`,
    analogyLimit:
      'Treating the framework as a checklist to complete is the failure mode. A candidate who announces each step by name and marches through it produces a mechanical answer with no judgement in it — and the interviewer is assessing judgement. The order matters because each step supplies the next one\'s inputs; the value is in actually using step 3\'s numbers to make step 4\'s decision, not in having visibly performed step 3.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate is asked to design a "like" button for a social platform. They immediately begin: "I\'ll use a relational database with a likes table, add Redis for caching, and put it behind a load balancer." What have they got wrong, and what should the first four minutes have contained instead?',
      answer: `**What is wrong: every decision so far is unfalsifiable, because no fact has been established.**

Take each claim in turn.

**"A likes table."** Storing one row per (user, post) is correct if you need to know *who* liked something — for the "Alice and 3 others liked this" line, or for preventing double-likes. It is enormously wasteful if you only ever display a count. At 100 million likes a day, one row each is 36 billion rows a year; a counter is one row per post. **The candidate has committed to a 1000× storage difference without knowing which is needed.**

**"Add Redis for caching."** Caching what? If the requirement is a count, the count *is* the cached value and there is no separate cache — the design question is whether the counter lives in Redis or in the database. If the requirement is "has the viewer liked this", that is a per-viewer membership check and a completely different structure. **"Add a cache" is not a decision; it is the name of a decision not yet made.**

**"Behind a load balancer."** True of every system, so it carries no information. Saying it uses interview time and demonstrates nothing.

**And the largest omission: no numbers.** Is this 1,000 likes a day or 10 million a second? The first is a single database table; the second has a hot-key problem that dominates the entire design. The candidate cannot know which system they are designing.

**What the first four minutes should have contained.**

**Step 1 — Understand (30 seconds).** Restate it and name the entities:

> "So: users can like a post, and can un-like it. The core entities are User, Post, and Like. The main operations are: like a post, un-like a post, read the like count for a post, and probably show whether the viewing user has liked it. Is that the right shape?"

That restatement does three things: it confirms the scope, it surfaces the un-like operation (which many candidates forget and which changes the data model), and it names "has the viewer liked this" as a distinct operation.

**Step 2 — Clarify (2 minutes).** Ask only the questions that change the architecture:

> **"Do we need to show *who* liked a post, or only the count?"**
> This is the biggest question. Count-only permits a counter; showing who requires a row per like. It is a 1000× storage difference.

> **"Does the count need to be exact, or is approximate acceptable for large numbers?"**
> "1.2M likes" versus "1,203,847". Approximate permits eventual consistency and cheap aggregation; exact forces coordination on a hot key.

> **"Must a user see their own like immediately?"**
> Almost certainly yes — read-your-writes. And nobody else needs to see it instantly, which is a much weaker requirement than global consistency.

> **"What is the read-to-write ratio, and what is the scale?"**
> A like is read every time the post is displayed and written once. This is a read-heavy system by a large factor, which shapes everything.

> **"Are there posts with extreme like counts?"**
> The celebrity problem. If one post can get a million likes in an hour, that is a hot key and it is the deep dive.

**Questions that would waste the time:** "What programming language?" "Which cloud provider?" "Should we use microservices?" **None of those change the design**, and asking them signals that the candidate cannot distinguish an architectural question from a preference.

**Step 3 — Estimate (90 seconds), out loud.** Suppose the interviewer says 500 million daily active users and each sees 100 posts a day.

\`\`\`
Reads:  500M × 100 = 50 billion post views/day
        50e9 / 86,400 ≈ 580,000 reads/s average
        Peak ≈ 3× average ≈ 1.7M reads/s

Writes: assume 2% of views produce a like
        50e9 × 0.02 = 1 billion likes/day
        ≈ 11,600 writes/s average, ~35,000 peak

Ratio:  roughly 50:1 reads to writes
\`\`\`

**Now the design decisions are forced rather than chosen.** 1.7 million reads per second means the count cannot come from a relational database on the read path — it must be a value served from memory. 11,600 writes per second is comfortable for a distributed counter and impossible for a single row. And if "who liked this" is required, 1 billion rows a day is 365 billion a year, which forces partitioning and a retention decision.

**The general lesson.** The candidate's three sentences were not wrong so much as **premature**: they were answers to questions nobody had asked. Four minutes of understanding, clarifying and estimating turns "I'll use a database and a cache" into "the count must be served from memory because 1.7 million reads per second forbids anything else, and the write path can be a distributed counter because 35,000 writes per second is small" — which is the same architecture with a reason attached, and the reason is what is being assessed.`,
    },
  body: `## The nine steps, with what each produces

**1. Understand (30–60 s).** Restate the problem in your own words and name the core entities and operations. Confirm with the interviewer.

*Produces:* a shared understanding of scope, and the vocabulary for the rest of the interview.
*Why it matters:* it catches a misunderstanding in the first minute rather than the twentieth. And listing the operations surfaces the ones candidates forget — un-like, delete, edit, cancel.

**2. Clarify (2–4 min).** Ask the questions whose answers change the architecture.

*Produces:* functional scope, non-functional requirements, and the scale figures for step 3.
*The discipline:* **ask only questions that change the design.** Before asking, complete the sentence "if the answer is X I would do A, and if it is Y I would do B." If you cannot, the question is not worth the time.

The questions that usually change the architecture:

| Question | What it changes |
| --- | --- |
| Read-to-write ratio and absolute scale | Everything |
| Exact or approximate | Whether coordination is needed |
| Who must see it, and how fast | Consistency model, caching strategy |
| Is there a hot entity? | Whether partitioning works |
| What must never be lost? | Durability and replication |
| Is the operation reversible? | Whether idempotency or compensation is needed |
| What is the latency budget? | Whether calls can be synchronous |

**3. Estimate (2–3 min), out loud.** QPS, storage, bandwidth. Round aggressively.

*Produces:* the numbers that force the design decisions.
*Why out loud:* the interviewer is assessing whether you can reason with magnitudes. A silent calculation demonstrates nothing.

Rounding rules that make this fast: 100,000 seconds per day, 1 million seconds per fortnight, 30 million per year. Peak is 2–3× average. Assume 1 KB per small record unless told otherwise.

**4. Model (3–5 min).** The API and the data model.

*Produces:* the interface the design must serve, and the storage decision.
*Order matters within this step:* **API first, then data model.** The API states what the system must do; the data model is how you store what the API needs. Doing it the other way produces a data model that does not serve the operations.

For the API, name the endpoints, their parameters and their responses. For the data model, name the tables or collections, the primary keys, and — critically — the **partition key**, since that decision is the least reversible one in the design.

**5. Design (5–7 min).** Draw the boxes. Clients, gateway, services, stores, queues, caches.

*Produces:* the structure everything else refers to.
*The discipline:* **every box must be justified by a requirement from step 2 or a number from step 3.** A box with no justification is a box you will be asked about and cannot defend. If you cannot say why the queue is there, do not draw the queue.

Trace one read and one write through the diagram out loud. That catches missing components faster than staring at it.

**6. Deep dive (12–15 min).** One or two components in real detail.

*Produces:* the actual signal of the interview.
*This is the most important step and the one most often compressed.* The interviewer usually chooses; if they do not, choose the hardest part — the one where the numbers from step 3 create a genuine problem. For a like button that is the hot post; for a feed it is fan-out; for a URL shortener it is id generation.

**7. Scale (4–5 min).** What breaks first as traffic grows 10×, and what you do about it.

*Produces:* evidence that you understand where the limits are.
*The structure:* identify the bottleneck, say why it is the bottleneck, propose the fix, and name what the fix costs. "The counter row becomes a hot key at 10×; I would shard it into 100 sub-counters, which makes the read a sum of 100 values and gives up exactness."

**8. Fail (3–4 min).** For each component: what happens when it dies?

*Produces:* evidence that you think about operations rather than only the happy path.
*Have a standard list:* a service instance, a whole zone, the primary database, the cache, a downstream dependency, the network between two components. And for each, state the user-visible effect and the recovery.

**9. Defend (1–2 min).** State the two or three trade-offs you chose and what you gave up.

*Produces:* the closing impression, and it is disproportionately valuable.
*Format:* "I chose X over Y because of Z, and the cost is W. If the requirement changed to R, I would revisit it." **Naming what you gave up is the single strongest signal available** — it demonstrates that you knew there was a choice.

## Time allocation, and what to sacrifice

For a 45-minute interview:

\`\`\`
1. Understand        1 min
2. Clarify           3 min
3. Estimate          3 min
4. Model             4 min
5. Design            6 min
6. Deep dive        15 min   ← the signal
7. Scale             5 min
8. Fail              4 min
9. Defend            2 min
                    ─────────
                    43 min + slack
\`\`\`

**What over-runs:** clarifying (candidates ask too many questions) and design (candidates over-draw). Both steal from the deep dive.

**What to sacrifice if you are behind:** the breadth of step 5, not the depth of step 6. A design with three boxes explained well beats seven boxes gestured at. And **never sacrifice step 9** — two sentences of trade-off at the end are worth more than two more minutes of diagram.

**If the interviewer redirects you, follow them.** They are steering toward what they want to assess. A candidate who insists on finishing their estimation while the interviewer asks about the data model is failing a different test.

## What the interviewer is actually assessing

Worth being explicit, because it changes what you emphasise:

**Can you scope an ambiguous problem?** Steps 1–2. Most real work is ambiguous, and the ability to turn a vague request into a bounded one is the most transferable skill being tested.

**Can you reason with magnitudes?** Step 3. Not arithmetic precision — the ability to know that 500 million users implies roughly 600,000 reads per second and that this rules out certain designs.

**Do you know the components and their costs?** Steps 4–5. Everything from Phases 1 and 2.

**Can you go deep?** Step 6. Breadth without depth reads as having memorised architectures rather than understood them.

**Do you think about failure and operations?** Steps 7–8. This is what distinguishes senior from mid-level answers more than anything else.

**Do you know that you made choices?** Step 9. A candidate who presents their design as the only possible one has not understood that design is choosing.

**And one thing that is assessed continuously: do you communicate?** Thinking silently for two minutes and then presenting a conclusion scores badly even if the conclusion is right, because the interviewer cannot evaluate reasoning they did not see.

## Common process failures

**Designing before scoping.** Covered above. Everything drawn before step 2 is drawn at random.

**Asking questions with no consequence.** "What language?" "Which cloud?" These consume the clarification budget and signal that you cannot tell an architectural question from a preference.

**Estimating and then ignoring the numbers.** Computing 1.7 million reads per second and then proposing a design that cannot serve it is worse than not estimating, because it demonstrates that the numbers were performed rather than used.

**Drawing boxes you cannot justify.** Every box invites a question. A queue you added because diagrams have queues is a liability.

**Refusing to commit.** "We could use SQL or NoSQL, both have trade-offs" is not an answer. **Choose, and say why.** The interviewer wants a decision with a reason; they do not want a survey.

**Never mentioning failure.** A design presented only in its working state reads as inexperienced, because the majority of real engineering is the other states.

**Running the clock out mid-step.** Track time. If you are 20 minutes in and have not started the deep dive, move immediately.

## Where the framework needs adapting

**A machine-coding or LLD interview** uses a different loop — this framework is for high-level design. The LLD phase covers that one.

**A 60-minute interview** gets more deep dive, not proportionally more of everything. Two deep dives instead of one.

**A "design X" question where you know X well** still needs steps 1–3. Skipping them because you recognise the problem is how you design the wrong system — the interviewer's version of X may not be the one you have memorised.

**An open-ended prompt** — "design something to solve this business problem" — inverts the emphasis: steps 1–2 become most of the interview, because the scoping *is* the problem.`,
  },

  visuals: [
    {
      kind: 'flow',
      id: 'loop',
      title: 'The nine steps, and what each one hands to the next',
      caption:
        'Step through it. Each box\'s output is the next box\'s input — which is why the order is not stylistic. Skipping a step means the following steps have no basis.',
      nodes: [
        { id: 's1', label: '1. Understand', kind: 'client', x: 0, y: 40, detail: 'Restate the problem; name entities and operations. 30–60 s. Catches a misunderstanding in minute one rather than minute twenty, and surfaces the operations candidates forget — un-like, delete, cancel.' },
        { id: 's2', label: '2. Clarify', kind: 'service', x: 0, y: 140, detail: 'Ask only questions that change the architecture. 3 min. Test before asking: "if X I would do A, if Y I would do B." If you cannot complete that sentence, skip the question.' },
        { id: 's3', label: '3. Estimate', kind: 'service', x: 0, y: 240, detail: 'QPS, storage, bandwidth — out loud, aggressively rounded. 3 min. This is what turns design choices into forced conclusions.' },
        { id: 's4', label: '4. Model', kind: 'service', x: 230, y: 40, detail: 'API first, then data model. 4 min. The API says what the system must do; the data model stores what the API needs. The partition key is the least reversible decision here.' },
        { id: 's5', label: '5. Design', kind: 'service', x: 230, y: 140, detail: 'Draw the boxes. 6 min. Every box must be justified by a step-2 requirement or a step-3 number — an unjustified box is a question you cannot answer.' },
        { id: 's6', label: '6. Deep dive', kind: 'store', x: 230, y: 250, detail: '12–15 min, and this is the signal. Pick the component where the step-3 numbers create a genuine problem. Compressing this to protect breadth is the commonest scoring mistake.' },
        { id: 's7', label: '7. Scale', kind: 'service', x: 470, y: 40, detail: 'What breaks first at 10×, why, the fix, and the cost of the fix. 5 min. Naming the cost is what separates this from a list of remedies.' },
        { id: 's8', label: '8. Fail', kind: 'service', x: 470, y: 140, detail: 'For each component: user-visible effect and recovery. 4 min. Work a standard list — instance, zone, primary, cache, dependency, network — so this is recall rather than improvisation.' },
        { id: 's9', label: '9. Defend', kind: 'note', x: 470, y: 250, detail: '2 min, disproportionately valuable. "I chose X over Y because Z; the cost is W; if the requirement were R I would revisit." Naming what you gave up is the strongest available signal.' },
      ],
      edges: [
        { id: 'f1', source: 's1', target: 's2', kind: 'control' },
        { id: 'f2', source: 's2', target: 's3', kind: 'control' },
        { id: 'f3', source: 's3', target: 's4', kind: 'control' },
        { id: 'f4', source: 's4', target: 's5', kind: 'control' },
        { id: 'f5', source: 's5', target: 's6', kind: 'control' },
        { id: 'f6', source: 's6', target: 's7', kind: 'control' },
        { id: 'f7', source: 's7', target: 's8', kind: 'control' },
        { id: 'f8', source: 's8', target: 's9', kind: 'control' },
      ],
      steps: [
        {
          id: 'l1',
          title: 'Scope before anything else',
          description:
            'Restate, then ask only the questions that change the design. Everything drawn before this is drawn at random, and this is the step whose absence produces a twenty-minute answer to the wrong problem.',
          nodes: ['s1', 's2'],
          edges: ['f1'],
        },
        {
          id: 'l2',
          title: 'Estimate, and then actually use the numbers',
          description:
            '600,000 reads per second rules out designs. Computing the figure and then proposing something that cannot serve it is worse than not estimating, because it shows the numbers were performed rather than used.',
          nodes: ['s3'],
          edges: ['f2'],
        },
        {
          id: 'l3',
          title: 'API, then data model, then boxes',
          description:
            'The API constrains the data model; the data model and the numbers constrain the boxes. Reversing this produces storage that does not serve the operations and components nobody can justify.',
          nodes: ['s4', 's5'],
          edges: ['f3', 'f4'],
        },
        {
          id: 'l4',
          title: 'The deep dive is the interview',
          description:
            'Fifteen minutes on the component where the numbers create a real problem. Breadth without depth reads as having memorised architectures rather than understood them.',
          nodes: ['s6'],
          edges: ['f5'],
        },
        {
          id: 'l5',
          title: 'Then scale, fail, and name your trade-offs',
          description:
            'What breaks at 10× and what the fix costs; what each component\'s death does to users; and two sentences naming what you chose and gave up. The last two minutes carry more weight than any two minutes of diagram.',
          nodes: ['s7', 's8', 's9'],
          edges: ['f6', 'f7', 'f8'],
        },
      ],
    },
    {
      kind: 'mermaid',
      id: 'time-budget',
      title: 'Where 45 minutes goes, and what steals it',
      caption:
        'The two red boxes are what over-run in practice, and both steal from the deep dive — which is where the assessment actually happens.',
      code: `flowchart LR
    A["**Scope: 7 min**<br/>Understand 1<br/>Clarify 3<br/>Estimate 3"]
    B["**Structure: 10 min**<br/>Model 4<br/>Design 6"]
    C["**Deep dive: 15 min**<br/>One or two components<br/>in real detail"]
    D["**Operate: 9 min**<br/>Scale 5<br/>Fail 4"]
    E["**Defend: 2 min**<br/>Trade-offs named"]

    A --> B --> C --> D --> E

    A --> A2["✗ Over-runs when you ask<br/>questions with no consequence"]
    B --> B2["✗ Over-runs when you draw<br/>boxes you cannot justify"]
    A2 --> C2["Both steal from the deep dive"]
    B2 --> C2
    C2 --> C3["Sacrifice breadth in step 5,<br/>never depth in step 6.<br/>And never sacrifice step 9"]

    style C fill:#17272a,stroke:#35897e
    style A2 fill:#2a1a1a,stroke:#a04848
    style B2 fill:#2a1a1a,stroke:#a04848
    style C3 fill:#1c1814,stroke:#c99a4e`,
    },
  ],

  productionExample: {
    systems: [],
    body: `The most useful "production example" for a method lesson is a worked pass through the loop on a system small enough to see all nine steps. Here is the like button, compressed to the shape of a real answer.

**1. Understand.** "Users like and un-like posts. Entities: User, Post, Like. Operations: like, un-like, read a post's count, and show whether the viewer has liked it."

**2. Clarify.** Count only, or who liked it? *Count, plus whether the viewer liked it.* Exact or approximate? *Approximate above 1,000 is fine.* Must the user see their own like immediately? *Yes.* Scale? *500M DAU, 100 posts viewed each.* Hot posts? *Yes, a celebrity post can get a million likes in an hour.*

**3. Estimate.** 50 billion post views/day → ~580,000 reads/s average, ~1.7M peak. 2% like rate → 1 billion likes/day → ~11,600 writes/s, ~35,000 peak. **50:1 read-heavy.**

**4. Model.**

\`\`\`
POST   /posts/{id}/like       → 204
DELETE /posts/{id}/like       → 204
GET    /posts/{id}            → { likeCount, viewerHasLiked }

post_likes(post_id PK, count)                  -- the counter
user_likes(user_id, post_id) PK (user_id, post_id)  -- membership, for viewerHasLiked
\`\`\`

Two structures because there are two questions. The counter answers "how many"; the membership table answers "did *this* user". Trying to serve both from one structure is the mistake the estimation prevents.

**5. Design.** Client → gateway → like service → { Redis for counters and membership, PostgreSQL as durable source of truth, a stream for the durable write }. The counter is read from Redis because 1.7M reads/s forbids anything else.

**6. Deep dive: the hot post.** A million likes an hour on one post is ~280 writes/s to a single counter key, and the reads are far worse — that post is being viewed constantly. **Shard the counter:** \`likes:{post}:{0..99}\`, increment a random shard, and read the sum of 100. Writes spread; reads become 100 keys, cached for a second at the edge because the requirement said approximate. The membership check stays keyed by user, so it is never hot.

**7. Scale at 10×.** 17M reads/s. The counter sum becomes the bottleneck — 100 keys per post view. Fix: maintain a materialised total per post, updated every second by a job that sums the shards, and serve that. Cost: the count is up to a second stale, which the requirement permits.

**8. Fail.** Redis down: counts unavailable or served stale from the last known value; likes still accepted and written durably. PostgreSQL down: likes rejected, counts still readable from Redis. A zone lost: capacity halves, service continues. The stream backing up: counts drift from the durable record until it drains, and a reconciliation job corrects them.

**9. Defend.** "I chose approximate counts over exact, which is what allowed sharded counters and edge caching — exactness would have forced coordination on the hottest key in the system. I chose two structures over one because the count and the membership question have different access patterns. The cost is that a count can be a second stale and that the two structures can drift, which the reconciliation job bounds."

**The whole thing is about eight minutes of speech.** The value of practising it on something this small is that the loop becomes visible — and once the order is automatic, the attention it used to consume goes into the deep dive instead.`,
  },

  tradeoffs: {
    intro:
      'The decisions are about process rather than architecture, and each has a real cost. Rows are the choices candidates actually face under time pressure.',
    rows: [
      {
        option: 'Follow the nine steps in order',
        whenItWins:
          'Almost always. Each step supplies the next one\'s inputs, so the order prevents decisions that have no basis.',
        whenItLoses:
          'When the interviewer redirects you — then follow them, since they are steering toward what they want to assess.',
        cost:
          'Roughly 10 minutes before any architecture appears, which feels slow and is not.',
      },
      {
        option: 'Start designing immediately',
        whenItWins:
          'Never in an interview. Occasionally in real work when the problem is genuinely well understood by everyone present.',
        whenItLoses:
          'Immediately: every decision is unfalsifiable, and the design may answer a different question than the one asked.',
        cost:
          'Twenty minutes of work that may be discarded when the actual scope emerges.',
      },
      {
        option: 'Ask many clarifying questions',
        whenItWins:
          'When the problem is genuinely ambiguous and the answers change the architecture materially.',
        whenItLoses:
          'When the questions have no consequence. It consumes the budget and signals an inability to distinguish architectural questions from preferences.',
        cost:
          'Time taken from the deep dive, which is where the assessment happens.',
      },
      {
        option: 'Estimate in detail',
        whenItWins:
          'Never — aggressive rounding is correct. The skill is magnitudes, not arithmetic.',
        whenItLoses:
          'When precision consumes time. 580,000 reads per second and "roughly half a million" lead to the same design decisions.',
        cost:
          'Minutes spent on precision that changes nothing.',
      },
      {
        option: 'Broad design, shallow everywhere',
        whenItWins:
          'When the interviewer explicitly asks for a survey of components.',
        whenItLoses:
          'Usually. It reads as having memorised architectures rather than understood them, and depth is the differentiating signal.',
        cost:
          'No evidence of the reasoning the interview exists to assess.',
      },
      {
        option: 'Three boxes, deeply justified',
        whenItWins:
          'Almost always. Every component defended by a requirement or a number, with one hard part explored properly.',
        whenItLoses:
          'If genuinely necessary components are missing, which the read/write trace-through catches.',
        cost:
          'A less complete-looking diagram.',
      },
      {
        option: 'Present the design as the obvious answer',
        whenItWins:
          'Nowhere. It reads as not having understood that design is choosing.',
        whenItLoses:
          'Always, and most visibly in step 9 where the trade-offs should be named.',
        cost:
          'The strongest available signal, discarded.',
      },
      {
        option: 'Name two or three trade-offs explicitly at the end',
        whenItWins:
          'Always. Two minutes, disproportionate value, and it demonstrates that you knew alternatives existed.',
        whenItLoses:
          'Only if the trade-offs are invented rather than real — which the interviewer will probe.',
        cost:
          'Two minutes, and the honesty of stating what your design is bad at.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Design Twitter." — "OK, so we\'ll have a tweet service, a user service, a timeline service, and Kafka between them."',
      whyWeak:
        'Every box is drawn before any fact is established. Is the follower graph in scope? What scale? Is the timeline ranked or chronological? Twenty minutes later a question about fan-out has no answer, because nothing in the design was derived from a requirement.',
      strongAnswer:
        '"Let me restate first: users post tweets, follow others, and read a timeline of tweets from people they follow. Before I design anything — is the follower graph in scope, or given? Is the timeline chronological or ranked? What scale are we at, and what is the read-to-write ratio? Those three answers change the architecture more than anything else I could draw."',
    },
    {
      weakAnswer: '"What programming language should I use? Which cloud provider? Should this be microservices?"',
      whyWeak:
        'None of these change the design, and they consume the clarification budget. Worse, they signal that the candidate cannot distinguish an architectural question from a preference — which is precisely the judgement being assessed.',
      strongAnswer:
        '"I would ask questions whose answers change the architecture: the read-to-write ratio and absolute scale, whether the result must be exact or can be approximate, who must see a change and how quickly, and whether there is a hot entity. Before asking anything I check whether I can complete the sentence \'if the answer is X I would do A, if Y then B\' — if I cannot, the question is not worth the time."',
    },
    {
      weakAnswer: '"So that\'s 1.7 million reads per second at peak. Now, I\'ll put the counts in PostgreSQL with an index."',
      whyWeak:
        'The number was computed and then ignored. 1.7 million reads per second is far beyond a relational database on the read path, so the estimation demonstrated arithmetic and not judgement — which is worse than not estimating, because it shows the numbers were performed rather than used.',
      strongAnswer:
        '"1.7 million reads per second at peak. That immediately rules out serving this from a relational database — it has to come from memory, so the count lives in Redis with PostgreSQL as the durable source of truth behind it. The write path is only 35,000 per second, which is comfortable, so the asymmetry tells me to optimise the read path and keep the write path simple."',
    },
    {
      weakAnswer: '"We could use SQL or NoSQL here — both have trade-offs, it depends on the requirements."',
      whyWeak:
        'A refusal to commit presented as balance. The requirements were established in step 2, so "it depends" means the candidate has not applied them. The interviewer wants a decision with a reason, not a survey.',
      strongAnswer:
        '"Given the access pattern — always by post id, no ad-hoc queries, 50:1 read-heavy — I would use a key-value store for the serving path and PostgreSQL for the durable record, because I want transactional guarantees on the write and memory-speed reads. If we needed ad-hoc analytical queries over likes I would revisit that, but the requirements as stated do not."',
    },
    {
      weakAnswer: 'Spends 25 minutes on the data model and the interview ends before scaling or failure.',
      whyWeak:
        'A design 100% complete on a third of the areas scores worse than one 60% complete across all of them, because the interview assesses breadth of judgement. Scaling and failure are where senior answers distinguish themselves, and they were never reached.',
      strongAnswer:
        '"I would track the clock and move: about 10 minutes for scope and estimation, 10 for the model and diagram, 15 for the deep dive, 9 for scaling and failure, and 2 to name my trade-offs. If I am 20 minutes in and have not started the deep dive I move immediately, because that is where the signal is — and I would sacrifice breadth in the diagram before depth in the dive."',
    },
    {
      weakAnswer: 'Presents a complete design and never mentions what happens when a component fails.',
      whyWeak:
        'A design described only in its working state reads as inexperienced, because most real engineering concerns the other states. It also leaves the interviewer to raise failure, which turns a strength into a gap they found.',
      strongAnswer:
        '"Let me walk the failure modes. Redis down: counts served stale from the last known value, likes still accepted and written durably. PostgreSQL down: likes rejected, counts still readable. A zone lost: capacity halves and the service continues. The stream backing up: counts drift from the durable record until it drains, bounded by a reconciliation job. I have a standard list I work through — instance, zone, primary store, cache, dependency, network — so this is recall rather than improvisation."',
    },
  ],

  flashcards: [
    {
      id: 'fc-hf-1',
      front: 'What are the nine steps, in order?',
      back: 'Understand, Clarify, Estimate, Model, Design, Deep dive, Scale, Fail, Defend. Each step\'s output is the next step\'s input.',
      topic: 'framework',
    },
    {
      id: 'fc-hf-2',
      front: 'Why does the order matter rather than just the content?',
      back: 'You cannot estimate without scope, choose a data model without numbers, or draw boxes without an API. Anything decided out of order has no basis.',
      topic: 'method',
    },
    {
      id: 'fc-hf-3',
      front: 'What is the test before asking a clarifying question?',
      back: 'Complete the sentence "if the answer is X I would do A, and if Y then B." If you cannot, the question does not change the design and is not worth the time.',
      topic: 'scoping',
    },
    {
      id: 'fc-hf-4',
      front: 'Name four clarifying questions that usually change the architecture.',
      back: 'Read-to-write ratio and scale; exact or approximate; who must see it and how fast; is there a hot entity.',
      topic: 'scoping',
    },
    {
      id: 'fc-hf-5',
      front: 'Why estimate out loud, and with what precision?',
      back: 'The interviewer is assessing reasoning with magnitudes, which a silent calculation does not demonstrate. Round aggressively — precision changes nothing.',
      topic: 'method',
    },
    {
      id: 'fc-hf-6',
      front: 'Within step 4, which comes first — API or data model?',
      back: 'API first. It states what the system must do; the data model stores what the API needs. Reversing it produces storage that does not serve the operations.',
      topic: 'method',
    },
    {
      id: 'fc-hf-7',
      front: 'What is the rule for drawing boxes?',
      back: 'Every box must be justified by a step-2 requirement or a step-3 number. An unjustified box is a question you will be asked and cannot answer.',
      topic: 'method',
    },
    {
      id: 'fc-hf-8',
      front: 'Which step carries most of the signal, and how long should it get?',
      back: 'The deep dive — 12 to 15 minutes of a 45-minute interview. Breadth without depth reads as memorised architectures.',
      topic: 'interview-process',
    },
    {
      id: 'fc-hf-9',
      front: 'How should a scaling answer be structured?',
      back: 'Identify the bottleneck, say why it is the bottleneck, propose the fix, and name what the fix costs. The cost is what separates it from a list of remedies.',
      topic: 'interview-process',
    },
    {
      id: 'fc-hf-10',
      front: 'What standard list should you work for the failure step?',
      back: 'A service instance, a whole zone, the primary store, the cache, a downstream dependency, and the network between two components — with the user-visible effect and recovery for each.',
      topic: 'interview-process',
    },
    {
      id: 'fc-hf-11',
      front: 'What is the strongest single signal available in a design interview?',
      back: 'Naming what you gave up. "I chose X over Y because Z; the cost is W; if the requirement were R I would revisit it."',
      topic: 'trade-offs',
    },
    {
      id: 'fc-hf-12',
      front: 'Which steps over-run in practice, and what do they steal?',
      back: 'Clarifying and design. Both steal from the deep dive, which is where the assessment happens.',
      topic: 'interview-process',
    },
    {
      id: 'fc-hf-13',
      front: 'If you are behind on time, what do you sacrifice?',
      back: 'Breadth in step 5, never depth in step 6 — and never step 9. Three boxes explained well beats seven gestured at.',
      topic: 'interview-process',
    },
    {
      id: 'fc-hf-14',
      front: 'Why is "we could use SQL or NoSQL, it depends" a poor answer?',
      back: 'The requirements were established in step 2, so "it depends" means they were not applied. Choose and say why; the interviewer wants a decision with a reason.',
      topic: 'trade-offs',
    },
  ],

  quiz: [
    {
      id: 'q-hf-1',
      kind: 'scenario',
      prompt:
        'A candidate is asked to design a like button and immediately proposes "a likes table, Redis for caching, behind a load balancer". What is the primary problem?',
      options: [
        { id: 'a', label: 'Every decision is unfalsifiable — no scope or scale has been established, so a row-per-like versus a counter is a 1000× storage difference chosen at random' },
        { id: 'b', label: 'Redis is the wrong cache for this workload' },
        { id: 'c', label: 'A relational database cannot store likes at scale' },
        { id: 'd', label: 'The load balancer should be a CDN' },
      ],
      correct: ['a'],
      explanation:
        'The components may turn out to be right; the problem is that nothing supports them. Whether you need a row per like depends on whether "who liked this" is in scope, and whether the count can be served from a database depends on the read rate — neither of which has been established. The load balancer mention carries no information at all.',
      difficulty: 'core',
      topic: 'method',
    },
    {
      id: 'q-hf-2',
      kind: 'single',
      prompt: 'Which clarifying question is most likely to change the architecture?',
      options: [
        { id: 'a', label: '"Does the count need to be exact, or is approximate acceptable?"' },
        { id: 'b', label: '"Which cloud provider are we on?"' },
        { id: 'c', label: '"Should this be a microservice or part of the monolith?"' },
        { id: 'd', label: '"What programming language should I assume?"' },
      ],
      correct: ['a'],
      explanation:
        'Exactness determines whether coordination is required, which decides whether sharded counters and edge caching are available — a first-order architectural consequence. The other three change no design decision, and asking them signals an inability to distinguish an architectural question from a preference.',
      difficulty: 'core',
      topic: 'scoping',
    },
    {
      id: 'q-hf-3',
      kind: 'scenario',
      prompt:
        'A candidate correctly computes 1.7 million reads/second, then proposes serving the data from an indexed PostgreSQL table. What does this demonstrate?',
      options: [
        { id: 'a', label: 'That the estimate was performed rather than used — which is worse than not estimating, because it shows the numbers did not inform the design' },
        { id: 'b', label: 'Good instincts, since PostgreSQL scales well with indexes' },
        { id: 'c', label: 'A reasonable choice if read replicas are added' },
        { id: 'd', label: 'That the estimate was probably wrong' },
      ],
      correct: ['a'],
      explanation:
        'The purpose of step 3 is to force step 4 and 5 decisions. A figure that rules out a design, followed by that design, demonstrates arithmetic without judgement. Replicas do not close a three-order-of-magnitude gap — 1.7 million reads/second must be served from memory.',
      difficulty: 'core',
      topic: 'method',
    },
    {
      id: 'q-hf-4',
      kind: 'scenario',
      prompt:
        'Twenty minutes into a 45-minute interview, a candidate is still refining the data model. What should they do?',
      options: [
        { id: 'a', label: 'Move immediately to the deep dive, sacrificing model and diagram completeness — the deep dive is where the signal is' },
        { id: 'b', label: 'Finish the data model properly, since everything depends on it' },
        { id: 'c', label: 'Skip to failure modes, which are the most senior-signalling part' },
        { id: 'd', label: 'Ask the interviewer for more time' },
      ],
      correct: ['a'],
      explanation:
        'A design 60% complete across all areas scores better than one 100% complete on a third of them. Skipping straight to failure would leave no design to fail, and refining the model consumes the remaining budget. Sacrifice breadth in the diagram, never depth in the dive — and reserve the last two minutes for trade-offs.',
      difficulty: 'core',
      topic: 'interview-process',
    },
    {
      id: 'q-hf-5',
      kind: 'scenario',
      prompt:
        'A candidate finishes their design and the interviewer says nothing. What are the highest-value two minutes remaining?',
      options: [
        { id: 'a', label: 'Naming two or three trade-offs they chose and what each cost, plus what would make them revisit it' },
        { id: 'b', label: 'Adding more components to the diagram for completeness' },
        { id: 'c', label: 'Recomputing the estimates more precisely' },
        { id: 'd', label: 'Summarising the design from the beginning' },
      ],
      correct: ['a'],
      explanation:
        'Naming what you gave up is the strongest available signal: it demonstrates that you knew alternatives existed and chose deliberately. A candidate who presents their design as the only possible one has not shown that design is choosing. More boxes invite questions; recomputing changes nothing.',
      difficulty: 'core',
      topic: 'trade-offs',
    },
    {
      id: 'q-hf-6',
      kind: 'multi',
      prompt:
        'Which are true about the framework? Select all that apply.',
      options: [
        { id: 'a', label: 'Each step\'s output is the next step\'s input, which is why the order is not stylistic' },
        { id: 'b', label: 'If the interviewer redirects you, follow them rather than completing your current step' },
        { id: 'c', label: 'Recognising the problem does not let you skip steps 1–3, because their version may differ from the one you memorised' },
        { id: 'd', label: 'Announcing each step by name demonstrates command of the process' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the substance. The fourth is the failure mode: a candidate who narrates the checklist produces a mechanical answer, and judgement is what is being assessed. The value lies in using step 3\'s numbers to make step 4\'s decision, not in having visibly performed step 3.',
      difficulty: 'core',
      topic: 'framework',
    },
  ],

  exercises: [
    {
      id: 'ex-hf-1',
      kind: 'design',
      title: 'Run the loop on something trivial, out loud, against a timer',
      estimatedMinutes: 45,
      prompt: `Run all nine steps on **"design a service that shortens internal wiki page titles into 6-character codes for use in chat"** — deliberately trivial, so the loop is what you are practising rather than the problem.

Set a 20-minute timer and speak your answer aloud, writing only what you would draw. Then compare against the model answer below.

Constraints to make it concrete: 5,000 employees, roughly 200 codes created per day, codes never expire, and a code must never resolve to the wrong page.

Then answer:

- Which of your clarifying questions had no consequence?
- Did any of your estimates change a design decision? If not, why did you compute them?
- What did you choose for the deep dive, and was it the hardest part?
- Name the trade-offs you made. If you cannot name two, what does that tell you?`,
      rubric: [
        'All nine steps attempted, in order, within the time budget.',
        'Clarifying questions each have a stated consequence.',
        'Estimates are rounded and are used to make at least one decision.',
        'API written before the data model.',
        'Every component in the diagram justified by a requirement or a number.',
        'Deep dive chosen deliberately, with a reason for the choice.',
        'Scaling answer names a bottleneck, a fix, and the fix\'s cost.',
        'Failure answer works a standard list with user-visible effects.',
        'Two or more real trade-offs named with what each cost.',
        'Self-critique identifies at least one consequence-free question or unused estimate.',
      ],
      modelAnswer: `**1. Understand (20 s)**

"A service that maps a wiki page — identified by its URL or id — to a short 6-character code, and resolves that code back to the page. Entities: WikiPage, Code. Operations: create a code for a page, resolve a code to a page. I assume creating a code for a page that already has one should return the existing code rather than a second one — is that right?"

*Why that last question is in step 1 rather than step 2:* it is about the *operation set*, not about scale or non-functional requirements. Getting it wrong means designing the wrong operation entirely.

**2. Clarify (90 s) — four questions, each with a consequence**

> **"If someone requests a code for a page that already has one, do they get the existing code or a new one?"**
> *Consequence:* idempotent creation requires a uniqueness constraint on the page id and a lookup before insert. Non-idempotent means several codes per page, which makes the mapping many-to-one and slightly complicates nothing else. **Idempotent is the better product behaviour and is one unique index.**

> **"Can a code be deleted or reassigned?"**
> *Consequence:* if never, the design is append-only and there is no invalidation problem anywhere. If yes, every cache needs invalidation and a resolved code can be stale. **This is the single biggest simplification available**, and confirming "never" removes a whole category of work.

> **"Must codes be unguessable, or is sequential acceptable?"**
> *Consequence:* if the wiki has public and private pages and a code leaks the existence of a private page, codes must be random. If everything is internal and readable by all employees, sequential is fine and much simpler. **This changes the id-generation strategy entirely.**

> **"Is 6 characters a hard requirement, or a preference?"**
> *Consequence:* it determines the key space, which the estimate then checks against demand. If 6 turns out to be too few, that is much better discovered now than after launch.

*What I would deliberately not ask:* what language, what database vendor, whether to use microservices, what the UI looks like. **None changes the design**, and at 5,000 employees and 200 codes a day, questions about caching strategy or sharding are also premature — the estimate will show why.

**3. Estimate (60 s), out loud**

\`\`\`
Key space:  6 chars from [a-z0-9] = 36⁶ ≈ 2.2 billion codes
Demand:     200/day × 365 × 20 years ≈ 1.5 million codes
Occupancy:  1.5M / 2.2e9 ≈ 0.07% of the key space

Writes:     200/day ≈ 0.002/s.  Negligible.
Reads:      assume each code is clicked 20 times
            200 × 20 = 4,000 reads/day ≈ 0.05/s.  Negligible.
Storage:    1.5M rows × ~200 bytes ≈ 300 MB.  Negligible.
\`\`\`

**And now I say the conclusion the numbers force, which is the point of the step:**

"Every dimension here is negligible. 0.002 writes per second, 0.05 reads per second, 300 MB over twenty years. **So this is a single PostgreSQL table with two indexes and no cache, no sharding, no queue, and no separate service if there is already a monolith to put it in.** The interesting content of this design is not scale — it is correctness of the code generation and the fact that codes must never collide or be reassigned."

*That paragraph is what the estimate is for.* It rules out an entire class of design and redirects the effort to where the actual difficulty is. **A candidate who computes these numbers and then proposes Redis and a sharded key-value store has wasted the step.**

*And the key-space conclusion:* 0.07% occupancy means random 6-character codes will essentially never collide — a birthday-problem calculation confirms collisions become likely only around the square root of the key space, roughly 47,000 codes, and even then a single retry on a unique-constraint violation handles it. **6 characters is comfortably sufficient**, which answers the fourth clarifying question with arithmetic rather than opinion.

**4. Model (2 min) — API first**

\`\`\`
POST /codes
  body:    { "pageId": "wiki-4471" }
  201:     { "code": "k3mf9x", "pageId": "wiki-4471" }
  200:     same body, if the page already has a code (idempotent)

GET /c/{code}
  302:     Location: <wiki base>/pages/wiki-4471
  404:     unknown code
\`\`\`

*Two API decisions worth defending:* \`POST\` returning 200 with the existing code rather than 409, because idempotent creation is friendlier and the caller does not care whether it was new. And \`GET /c/{code}\` returning a **302** rather than a **301** — a 301 is cached permanently by browsers, and while codes are immutable *today*, a 302 keeps the option of ever changing one and lets me count clicks. **I would name this as a deliberate choice**, since a 301 is defensible too and the trade is caching versus flexibility.

\`\`\`sql
CREATE TABLE codes (
  code        char(6)     PRIMARY KEY,
  page_id     text        NOT NULL UNIQUE,
  created_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
\`\`\`

*Two indexes doing two jobs:* the primary key on \`code\` serves resolution; the unique index on \`page_id\` serves idempotent creation **and enforces one-code-per-page in the schema** so no code path can violate it.

*Storage note:* \`char(6)\` as the primary key rather than a surrogate integer. There is no reason for a second identifier when the code is already unique, immutable and short.

**5. Design (90 s) — and it is deliberately small**

\`\`\`
Browser / chat client
        │
        ▼
  Existing web app  ──►  PostgreSQL (codes table)
   (two endpoints)
\`\`\`

**That is the whole diagram, and the justification for its size is the estimate.** Two endpoints in an existing application and one table.

*What I explicitly do not draw, with reasons:*

- **No cache.** 0.05 reads/second. A cache would add an invalidation concern to a system that currently has none.
- **No queue.** Nothing is asynchronous; both operations are single-digit-millisecond database calls.
- **No separate service.** 5,000 internal users and two endpoints does not justify a deployment unit, a pipeline, and an on-call rotation.
- **No load balancer or CDN drawn**, because they are properties of the existing application rather than decisions I am making here.

**Saying what I am not building, and why, is stronger than drawing it.** A candidate who draws a cache, a queue and a dedicated service here has demonstrated that they cannot size a solution to a problem — which is a more damaging signal than any missing component.

*Trace a read:* \`GET /c/k3mf9x\` → primary-key lookup → 302 with the page URL. One index seek, sub-millisecond.
*Trace a write:* \`POST /codes\` → \`INSERT ... ON CONFLICT (page_id) DO NOTHING RETURNING\`; if no row returned, \`SELECT\` the existing one. One or two statements, atomic, idempotent.

**6. Deep dive (6 min): code generation, because it is the only hard part**

The estimate established that scale is not the difficulty. The difficulty is generating a code that is unique, unguessable if required, and never wrong.

**Option A — random generation with retry on conflict.**

\`\`\`
loop:
  code = random 6 chars from [a-z0-9]
  INSERT INTO codes (code, page_id, ...) VALUES (code, ...)
    ON CONFLICT (code) DO NOTHING
  if inserted: return code
  else: retry (bounded, say 5 attempts)
\`\`\`

*Collision probability:* with 1.5 million codes in a 2.2-billion space, the chance any single random code collides is about 0.07%. So retries are essentially never needed, and the bounded loop handles the case anyway.

*Why the \`ON CONFLICT\` matters:* it makes the uniqueness check and the insert **one atomic statement**. A \`SELECT\` to check availability followed by an \`INSERT\` is a race — two concurrent requests could both find the code free. The database constraint is the arbiter, which is the consistency-models lesson's conclusion applied here.

*Unguessability:* random from a cryptographically-secure generator, so codes carry no information about creation order or volume.

**Option B — a sequence encoded to base-36.**

\`\`\`
id = nextval('codes_seq')       →  encode to base36, pad to 6
\`\`\`

*Advantages:* no collisions by construction, no retries, and the code is shorter for early entries.
*Disadvantages:* **codes are guessable and enumerable.** Code \`000001\` through \`00007a\` are all valid, so anyone can walk the space and discover every shortened page — including any whose existence should not be known. And the code leaks how many codes have been created.

**Which I choose: Option A, random, and the reason is the clarifying question.** If the answer to "must codes be unguessable" was yes, sequential is disqualified. If it was no, sequential is simpler — but random costs almost nothing here (essentially zero retries at 0.07% occupancy) and keeps the option open. **When two options are near-equal in cost and one preserves a future requirement, take that one.**

*One refinement I would mention:* exclude visually ambiguous characters — \`0\`/\`o\`, \`1\`/\`l\` — since codes get read aloud and retyped in chat. That reduces the alphabet to 32 and the key space to 32⁶ ≈ 1.07 billion, which is still 700× the twenty-year demand. **A usability improvement that the arithmetic shows is free.**

*And the failure I would guard:* a bounded retry loop, not an unbounded one. If five attempts fail, return an error rather than looping — because an unbounded loop on a full key space is an infinite loop, and the bound is what makes the failure legible.

**7. Scale (2 min)**

"At 10× — 2,000 codes a day — nothing changes. At 1,000× — 200,000 a day — still nothing: 73 million codes over a year is a small table and the read rate is 12 per second.

**The first thing that would actually break is the key space, not the infrastructure.** At 200,000 codes a day, 32⁶ ≈ 1.07 billion is exhausted in about 15 years, and collisions become frequent well before that — the retry rate rises as occupancy grows. The fix is a seventh character, which multiplies the space by 32.

**The cost of that fix is that existing codes stay 6 characters**, so the system must accept both lengths — which is fine, since the primary key is a variable-length string and resolution is unaffected. **Worth designing for now**: use \`varchar(8)\` rather than \`char(6)\` so the schema does not need changing, which costs nothing today.

The second thing would be read volume, at perhaps 10,000 reads per second — and then a read cache with no invalidation logic, because codes are immutable. **Immutability is what makes that future cache trivial**, and it traces directly back to the clarifying question in step 2."

**8. Fail (90 s) — the standard list**

- **PostgreSQL primary down:** both operations fail. Resolution returns 503. **Given this is an internal convenience tool, that is acceptable** — I would not build a read replica for it, and I would say so rather than adding one reflexively.
- **The application instance down:** the existing load balancer routes elsewhere; no impact.
- **A zone lost:** whatever the existing application does. This feature inherits it and adds no new exposure.
- **Duplicate \`POST\` (retry after a timeout):** idempotent by construction — the unique index on \`page_id\` means the second attempt returns the existing code. **The client cannot create a duplicate even if it tries.**
- **A code that resolves to a deleted wiki page:** the code resolves, the wiki returns 404. Acceptable, and worth naming as a deliberate decision rather than an oversight: the code service does not track wiki page lifecycle, and coupling them would be more complexity than the problem warrants.
- **Key-space exhaustion:** the bounded retry returns an error and an alert fires. Better than an infinite loop, and the alert is what makes the seventh character a planned change rather than an incident.

**9. Defend (45 s)**

"Three trade-offs.

**Random codes over sequential.** Sequential is simpler and has no collision handling, and it is enumerable — anyone can walk the space and discover every shortened page. At 0.07% key-space occupancy random costs essentially nothing, so I took the option that preserves the privacy requirement.

**No cache, no queue, no separate service.** Justified by the estimate: 0.05 reads per second. The cost is that if this grew a thousandfold I would need to add a cache — and because codes are immutable, that cache needs no invalidation, so the future cost is small. **I would rather add a component when a number demands it than carry one that no number justifies.**

**302 over 301.** A 301 would be cached permanently by browsers and would remove all future flexibility and any ability to count clicks. The cost is a request to my service on every click, which at this scale is free.

**And what would make me revisit all of it:** if codes became mutable or deletable, the immutability assumption that simplifies caching, failure handling and the whole design disappears — and that is the one clarifying answer I would want to be very sure of."

---

**Self-critique — the four questions**

**Which clarifying questions had no consequence?** In my four, none — each was tied to a design decision. **The one I was tempted to ask and did not: "should the code be case-sensitive?"** It is a real question and its answer changes the alphabet size, which the estimate already showed is not binding. So it is a detail to mention in the deep dive rather than a clarification worth interview time. **Recognising which real questions are nonetheless not worth asking is part of the skill.**

**Did the estimates change a decision?** Yes, and decisively — they eliminated the cache, the queue, the separate service and the sharding, and they answered the "is 6 characters enough" question with arithmetic. **This is the whole purpose of the step**, and on a trivial problem it is the most visible: the estimate's job here was to argue for a *smaller* design, which is a use of estimation candidates rarely practise.

**Was the deep dive the hardest part?** Yes, because the estimate proved nothing else was hard. **Choosing it required the estimate first**, which is the order-dependency the framework exists to enforce. A candidate who deep-dived on caching here would have spent six minutes on a component the numbers had already ruled out.

**Could I name two trade-offs?** Three. **If I could not name two, it would mean I had not made any choices** — which on a real problem means I took the first thing that came to mind at every decision point, and the interviewer will find the alternatives I did not consider. **The inability to name trade-offs is diagnostic**, and noticing it during practice is more useful than being told about it afterwards.

**One more thing this exercise teaches that a large problem cannot.** On a trivial system, the correct answer is *small*, and producing a small answer confidently is harder than producing a large one. A candidate whose instinct is to add Redis, Kafka and a dedicated service to a 200-writes-per-day problem has a habit that will produce over-engineered designs on real problems too — and the loop, followed honestly, is what catches it.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-hf-1',
      level: 'basic',
      question: 'How do you approach a system design question?',
      guidance:
        'The nine steps, briefly, with the reason the order matters. A strong answer emphasises scoping and estimation before design, and names the deep dive as where the time goes.',
    },
    {
      id: 'iq-hf-2',
      level: 'basic',
      question: 'What clarifying questions would you ask about any system?',
      guidance:
        'Scale and read-to-write ratio, exact versus approximate, who must see changes and how fast, hot entities, what must never be lost. Look for the test: can you complete "if X then A, if Y then B"?',
    },
    {
      id: 'iq-hf-3',
      level: 'intermediate',
      question: 'You have 45 minutes. How do you allocate them?',
      guidance:
        'Roughly 7 for scope and estimation, 10 for model and diagram, 15 for the deep dive, 9 for scaling and failure, 2 for trade-offs. A strong answer names clarifying and design as the steps that over-run.',
    },
    {
      id: 'iq-hf-4',
      level: 'intermediate',
      question: 'How do you decide what to deep dive on?',
      guidance:
        'The component where the estimates create a genuine problem — which requires having estimated first. Look for the recognition that the interviewer usually chooses, and that following their redirection is correct.',
    },
    {
      id: 'iq-hf-5',
      level: 'advanced',
      question: 'How do you avoid over-engineering a design?',
      guidance:
        'Let the numbers justify each component, and be willing to say what you are deliberately not building. A strong answer notes that producing a small answer confidently is harder than producing a large one.',
    },
    {
      id: 'iq-hf-6',
      level: 'advanced',
      question: 'What separates a senior design answer from a mid-level one?',
      guidance:
        'Failure modes, operational thinking, and named trade-offs. Excellent answers add that a senior answer sizes the solution to the problem rather than demonstrating knowledge of components.',
    },
    {
      id: 'iq-hf-7',
      level: 'followup',
      question: 'You could not name two trade-offs in your design. What does that mean?',
      guidance:
        'That no real choices were made — the first idea was taken at every decision point. A strong answer treats the inability to name trade-offs as diagnostic rather than as a presentation gap.',
    },
    {
      id: 'iq-hf-8',
      level: 'followup',
      question: 'You recognise this problem and have designed it before. Do you still scope it?',
      guidance:
        'Yes — the interviewer\'s version may differ from the memorised one, and skipping scoping is how you design the wrong system confidently. A strong answer still runs steps 1–3, faster.',
    },
  ],

  activeLearning: [
    {
      id: 'al-hf-1',
      kind: 'what-changes-if',
      prompt:
        'Everything above assumed a 45-minute interview with an interviewer who asks "design X". Now change one thing: the prompt is open-ended — "our support team is drowning in tickets, design something to help". What changes in the loop, and what becomes the whole interview?',
      discussion: `An open-ended prompt inverts the weight of the steps, and candidates trained on "design X" often handle it badly because they wait for a specification that is not coming.

**What becomes the whole interview: steps 1 and 2.**

With "design X", the problem is given and the design is the work. Here, **the problem is the work.** "Drowning in tickets" is a symptom with at least five distinct causes, each implying a completely different system:

- Too many tickets arriving → deflection: better documentation, a self-service flow, fixing the thing generating tickets.
- Tickets taking too long to resolve → tooling: better context surfacing, canned responses, an internal knowledge search.
- Tickets going to the wrong person → routing and classification.
- No visibility into what is happening → analytics and reporting.
- The same questions repeatedly → automation or an assistant.

**Choosing among these is the interview.** A candidate who picks one silently and designs it has answered a question nobody asked, and they will not find out until the end.

**How to do steps 1–2 here.**

**Do not ask "what should I build".** That returns the question, and part of what is being assessed is whether you can drive an ambiguous problem.

**Instead, propose a structure and confirm it.** "Let me establish what 'drowning' means before designing anything. I can think of a few distinct problems this could be — volume, resolution time, routing, or repeated questions — and each implies a different system. Do we know which one it is? If not, I would start by asking what the support team's time actually goes to."

**Then narrow with consequential questions.** How many tickets a day? What is the current resolution time and where does it go? What fraction are duplicates or near-duplicates? Is the volume growing with users or faster than users? **Each answer eliminates one of the candidate problems**, and eliminating is what turns an open prompt into a designable one.

**And state your choice explicitly.** "Given that 60% of tickets are the same twenty questions, I am going to design a deflection system rather than a routing system, because routing would make the wrong problem faster. Does that match your intent?" **Making the scoping decision visible and checkable is the single most important move**, because it lets the interviewer correct you at minute five rather than minute forty.

**What compresses.**

**Estimation stays, and its role shifts.** Rather than sizing infrastructure, it sizes the *opportunity*: 500 tickets a day, 60% deflectable, 15 minutes each is 75 hours of support time a week. **That number justifies the project**, and it is a different use of estimation than QPS.

**The deep dive gets less time**, because scoping got more. That is correct — the interviewer is assessing product judgement here, not only technical depth.

**Scale and failure still matter and matter less.** A support tool serving fifty agents has no interesting scale story, and saying so is better than inventing one.

**What is being assessed differently.**

**Can you decompose a business problem?** The primary signal, and it does not appear in "design X" questions at all.

**Do you propose the cheapest thing that works?** An open prompt is an invitation to over-engineer. "Before building a classifier, I would check whether a searchable FAQ with better placement deflects most of it" is a strong answer, and candidates trained to demonstrate technical range often skip it.

**Do you know what you would measure?** "This works if deflection rate rises and time-to-resolution falls" — naming the success metric shows you are solving a problem rather than shipping a system.

**Can you say no?** "I would not build a full ticketing platform; one exists and the problem is not the platform." **Declining scope is a senior signal** and it is uncomfortable to do in an interview.

**The transferable point.** The loop is the same nine steps, and their weights are set by how ambiguous the prompt is. **A fully specified prompt makes the design the work; an open prompt makes the scoping the work** — and the framework accommodates both precisely because steps 1 and 2 come first. A candidate who treats every prompt as "design X" will produce a technically competent answer to a question that was never asked, which is the most common way a strong engineer fails an open-ended interview.`,
    },
    {
      id: 'al-hf-2',
      kind: 'debug',
      prompt:
        'A candidate consistently gets positive feedback on their technical knowledge and consistently fails design interviews. Their answers are accurate and their components are appropriate. Diagnose the likely causes.',
      discussion: `Accurate knowledge with failed outcomes means the failure is in process or communication rather than in content. Five causes account for most cases, and they are distinguishable by what the feedback says.

**Hypothesis 1 — designing before scoping, so the accurate answer solves the wrong problem.** The components are appropriate *to some problem*, just not the interviewer's. Feedback like "did not address the core challenge" or "missed the key requirement" points here.

*Why it fits the profile perfectly:* knowledge is intact and unused. The candidate demonstrates everything they know about the system they chose to design.

*The tell:* asking fewer than three clarifying questions before drawing.

*The fix:* the first four minutes are non-negotiable. Restate, ask four consequential questions, estimate. **And state the scope choice out loud** so it can be corrected early.

**Hypothesis 2 — no depth anywhere.** A broad, correct, shallow survey. Feedback like "breadth without depth" or "did not go deep enough" is diagnostic.

*Why it fits:* wide accurate knowledge naturally produces a wide answer, and the deep dive is where the assessment concentrates. Breadth reads as recall; depth reads as understanding.

*The tell:* the diagram has eight boxes and no component received more than two minutes.

*The fix:* deliberately cut the diagram to protect fifteen minutes for one component. **Three boxes explained well beats eight gestured at**, and that is counter-intuitive for someone whose strength is knowing many components.

**Hypothesis 3 — thinking silently.** The candidate reasons internally and presents conclusions. The reasoning is sound and invisible, so the interviewer cannot assess it.

*Why it fits:* strong technical people often think before speaking, and this interview format penalises it specifically.

*The tell:* long pauses followed by confident statements, and estimates that appear as results rather than as calculations.

*The fix:* narrate. "I am weighing two options here — let me think aloud." **An interviewer can only evaluate reasoning they hear**, and a wrong turn corrected out loud scores better than a right answer arrived at silently.

**Hypothesis 4 — no trade-offs named.** The design is presented as the obvious answer. Feedback like "did not consider alternatives" or "seemed rigid".

*Why it fits:* someone who knows the right answer states it, and stating it as the only answer reads as not knowing that alternatives exist.

*The tell:* the phrase "we would use X" without "rather than Y, because Z".

*The fix:* two sentences of trade-off at every significant decision, plus a deliberate step 9. **Naming what you gave up is the strongest available signal** and it costs almost no time.

**Hypothesis 5 — over-engineering.** Every problem gets a cache, a queue, a message bus and a dedicated service. Feedback like "over-complicated" or "did not size the solution to the problem".

*Why it fits:* an interview feels like an invitation to demonstrate range, and someone with broad knowledge has a lot of range to demonstrate.

*The tell:* the estimate showed a small number and the design did not shrink accordingly. **The estimate arguing for a smaller design is the case candidates never practise.**

*The fix:* justify every component with a number, and practise saying what you are deliberately not building.

**What I would do to diagnose it: read the feedback verbatim and match the phrasing.** The five hypotheses produce distinctly different feedback, and interviewers usually say something close to the actual cause. "Missed the core challenge" is hypothesis 1; "not deep enough" is 2; "hard to follow" is 3; "seemed rigid" is 4; "over-complicated" is 5.

**Then: record a practice attempt and watch it.** Specifically measure four things — how many clarifying questions before the first box, how many minutes on the deepest component, the proportion of silence, and how many times the phrase "rather than, because" occurs. **All four are countable**, and counting them turns a vague "I keep failing" into a specific behaviour to change.

**The most likely answer for this profile, if I had to pick one: hypothesis 1 compounded by hypothesis 2.** Strong knowledge creates confidence, confidence shortens scoping, and shortened scoping produces a broad answer to an approximately-right problem. The two failures reinforce each other, and both are fixed by the same discipline: **spend the first four minutes and protect the last fifteen.**

**The transferable point.** A design interview assesses a process applied to knowledge, not knowledge alone. A candidate whose knowledge is not the constraint should stop studying components and start practising the loop against a timer, out loud — because the gap is in the thing they are not practising.`,
    },
  ],

  revision: {
    bullets: [
      'Nine steps: Understand, Clarify, Estimate, Model, Design, Deep dive, Scale, Fail, Defend.',
      'The order matters because each step\'s output is the next step\'s input.',
      'Everything drawn before scoping is drawn at random.',
      'Before asking a clarifying question, complete "if X I would do A, if Y then B". If you cannot, skip it.',
      'The questions that change architecture: scale and read/write ratio, exact vs approximate, who sees it how fast, hot entities.',
      'Estimate out loud and round aggressively — the skill is magnitudes, not arithmetic.',
      'Computing a number and then ignoring it is worse than not estimating.',
      'Within Model: API first, then data model. The API says what the system must do.',
      'Every box must be justified by a requirement or a number; an unjustified box is a question you cannot answer.',
      'The deep dive is 12–15 minutes of 45 and carries most of the signal.',
      'Pick the deep dive where the estimates create a genuine problem — which requires estimating first.',
      'Scaling answers need a bottleneck, a fix, and the fix\'s cost.',
      'Work a standard failure list: instance, zone, primary store, cache, dependency, network.',
      'Naming what you gave up is the strongest available signal, and it takes two minutes.',
      'Clarifying and design are the steps that over-run, and both steal from the deep dive.',
      'Sacrifice breadth in the diagram, never depth in the dive — and never sacrifice the trade-off summary.',
      'Sometimes the estimate argues for a smaller design; saying what you are not building is strong.',
      'If the interviewer redirects you, follow them — they are steering toward what they assess.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A fixed nine-step order for a high-level design interview: Understand, Clarify, Estimate, Model, Design, Deep dive, Scale, Fail, Defend — where each step produces the inputs the next one needs.',
    whyItExists:
      'Because design interviews fail on process rather than knowledge: designing before scoping, estimating without using the numbers, and running out of time before the deep dive.',
    whenToUse: [
      'Any high-level design interview, in this order.',
      'On problems you recognise — faster, and not skipped.',
      'On open-ended prompts, where steps 1–2 become most of the interview.',
    ],
    whenNotToUse: [
      'As a checklist to narrate step by step, which produces a mechanical answer.',
      'For low-level design or machine coding, which use a different loop.',
      'Rigidly, when the interviewer redirects you — follow them instead.',
    ],
    alternatives: [
      'For LLD: requirements, entities, class model, interfaces, patterns, extension.',
      'For an open-ended prompt: decompose the business problem, choose a sub-problem explicitly, then run this loop on it.',
      'For a 60-minute slot: the same loop with two deep dives rather than proportionally more of everything.',
    ],
    tradeoffs: [
      'Ten minutes of scoping and estimation buys forced design decisions and costs early progress.',
      'A deep dive buys the interview\'s main signal and costs diagram breadth.',
      'Aggressive rounding buys speed and costs precision that changes nothing.',
      'Committing to a choice buys credibility and costs the safety of "it depends".',
      'Naming trade-offs buys the strongest signal and costs admitting what your design is bad at.',
    ],
    failureModes: [
      'Drawing boxes before establishing scope, producing an accurate answer to the wrong problem.',
      'Asking clarifying questions with no design consequence.',
      'Computing estimates and then proposing a design the estimates rule out.',
      'Choosing a data model before knowing the scale.',
      'Drawing components you cannot justify when asked.',
      'Spending 25 minutes on one step and never reaching scaling or failure.',
      'A broad shallow survey with no component explored in depth.',
      'Thinking silently, so the reasoning being assessed is invisible.',
      'Refusing to commit — "both have trade-offs, it depends".',
      'Presenting the design as the only possibility, so no trade-off is named.',
      'Over-engineering a small problem because the interview feels like a knowledge exam.',
    ],
    followUpQuestions: [
      'What is the read-to-write ratio, and what is the absolute scale?',
      'Does this need to be exact, or is approximate acceptable?',
      'Who must see a change, and how quickly?',
      'Is there a hot entity that breaks partitioning?',
      'What must never be lost?',
      'Which number forces this design decision?',
      'Why is this box here, and what requirement justifies it?',
      'What breaks first at 10×, and what does the fix cost?',
      'What happens when each component dies, from the user\'s point of view?',
      'What did you choose against, and what would make you revisit it?',
    ],
  },
});
