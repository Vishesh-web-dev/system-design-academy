import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-api-versioning',
  title: 'Versioning and evolution',
  summary:
    'Most versioning problems are additive-change discipline problems wearing a version number, and the cost of a version is measured in how long you must run two behaviours side by side.',
  phase: 'foundations',
  module: 'apis',
  position: 9,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 35,
  tags: ['api-versioning', 'api-contracts', 'coupling', 'deprecation', 'compatibility'],
  prerequisites: ['f-api-contracts'],
  resources: [
    {
      key: 'stripe-api-versioning',
      tier: 'must',
      note: 'A production account of per-account pinned versions with request-time transformation. Read it for the operational consequence: every version ever released is still running, forever.',
    },
    {
      key: 'protobuf-proto3',
      tier: 'must',
      note: 'Field numbers, reserved numbers and optionality. This is compatibility built into a wire format rather than maintained by discipline, and it is the cleanest illustration of designing for change.',
    },
    {
      key: 'google-api-design-guide',
      tier: 'good',
      note: 'The versioning and compatibility chapters, for what counts as a breaking change at the scale of a large public API surface.',
    },
    {
      key: 'martin-fowler-strangler',
      tier: 'good',
      note: 'The pattern for replacing a system incrementally while both run. Directly applicable to running v1 and v2 of an API side by side.',
    },
  ],

  intuition: {
    body: `Two claims that sound contradictory and are both true.

**Versioning is unavoidable.** Sooner or later you will need a shape that is incompatible with the one you published, and you cannot ask consumers you have never met to change on your schedule.

**Most versioning is a symptom.** Teams that ship v2, v3, v4 in eighteen months are usually not evolving a domain — they are correcting modelling mistakes and renaming things. Every one of those versions is a decision made too quickly the first time, and the version number is how the cost gets paid.

The useful reframing: **a version is not a release, it is a commitment to run two behaviours simultaneously for as long as anyone uses the old one.** Ask a team proposing v2 how long they expect to run v1 alongside it. If the honest answer is "indefinitely", they have just doubled the maintenance surface of the API, and the change had better be worth that.

Which leads to the actual discipline. Before versioning, ask whether the change can be additive instead:

- New field alongside the old one, both populated → not breaking.
- New endpoint alongside the old one → not breaking.
- New optional parameter with the previous behaviour as default → not breaking.
- Rename, remove, narrow a type, change a default, redefine a meaning → breaking, and the last one is the worst because nothing fails.

The overwhelming majority of "we need v2" turns out to be a rename someone wanted for tidiness. **Tidiness is not worth a version.**`,
    analogyLimit:
      'Thinking of versions as software releases is the trap: a release replaces its predecessor, and an API version does not. It sits beside it, taking traffic, needing security patches and behavioural fixes, until the last consumer stops calling it — which for a public API may be never.',
  },

  deepExplanation: {
    predict: {
      question:
        'You must change a field from `name: string` to `firstName` and `lastName`. There are 200 partner integrations. Sketch the change that requires no version bump, and say what it costs you.',
      answer: `**The additive change:**

1. **Add** \`firstName\` and \`lastName\` to responses. Keep \`name\` and keep populating it, derived as \`firstName + " " + lastName\`.
2. **Accept** all three on write. If \`firstName\`/\`lastName\` are supplied, use them; if only \`name\` is supplied, split it on the first space and record that it was split — with the raw input preserved so the guess can be revisited.
3. **Document** \`name\` as deprecated with a stated timeline, emit a \`Deprecation\` header on responses to consumers still reading it, and instrument who is using it.
4. **Wait.** Possibly forever.

No consumer breaks. No version exists. New consumers use the new fields.

**What it costs:**

*Storage and code carry both shapes.* \`name\` is now a derived field with an owner, and the derivation must stay correct as \`firstName\`/\`lastName\` change. That is exactly the denormalisation contract from the data-modelling lessons: a derived copy needs an owner, a rebuild path and a staleness budget.

*The split is lossy and permanent.* "Mary Anne van der Berg" does not split correctly on the first space. Any consumer still writing \`name\` produces wrong data, and once written it is indistinguishable from correct data — which is why recording that a value was inferred matters.

*The API surface is now bigger, not smaller.* You have three fields where you wanted two, and the ugly one is the permanent one.

*You will probably never remove it.* With 200 partners, some fraction will not migrate. The honest plan assumes \`name\` is permanent and treats removal as an optimistic possibility rather than a milestone.

**Why it is still the right answer:** the alternative is v2 — a second surface, doubled maintenance, and a migration you must coordinate across 200 organisations you do not employ. Carrying one ugly derived field is dramatically cheaper than that, and it requires nothing from anyone else.`,
    },
    body: `## What counts as breaking

The test is not "did the shape change" but **"can existing consumer code still work unchanged?"**

Safe:

- Adding a response field (if consumers ignore unknown fields — say so in the docs).
- Adding an optional request field whose default preserves current behaviour.
- Adding a new endpoint or a new enum value **if the set was documented as open**.
- Relaxing validation to accept more inputs.
- Changing anything unobservable: internals, performance, storage.

Breaking:

- Removing or renaming anything.
- Making an optional request field required, or a response field absent.
- Narrowing a type (string to integer, or a wider enum to a narrower one).
- Changing a default.
- Tightening validation to reject previously accepted inputs.
- Adding an enum value to a set clients believe is closed.
- **Redefining a meaning while keeping the name.**

That last one deserves emphasis: changing \`total\` from excluding tax to including tax breaks every consumer's arithmetic with no error, no failed schema check and no signal. It is discovered by reconciliation weeks later. Silent semantic changes are the most expensive category precisely because nothing fails.

## Where the version goes

**URL path** — \`/v1/orders\`. Obvious, greppable, cacheable, and trivially routable at a proxy. Its critics point out that the resource identity should not change when the representation does, which is philosophically right and practically irrelevant. It is the most common choice because operating it is easy.

**Header** — \`Accept: application/vnd.acme.v2+json\` or \`API-Version: 2\`. Keeps URLs stable and makes the version invisible in logs, browsers and support tickets, which is a real operational cost. Also easy to forget, so you need a default — and a default means consumers can be moved by accident.

**Query parameter** — \`?version=2\`. Easy to test by hand, easy to omit, and it pollutes cache keys.

For most systems the path is right, and the reason is operational rather than architectural: everything in your infrastructure can already route, log and rate-limit on a path.

## Versioning strategies, and what each costs to run

**No versions, additive only.** Every change is additive; nothing is removed. The API accretes fields. Cheapest to operate — one code path — and requires the most discipline, because every hasty field is permanent.

**Coarse-grained versions, few and rare.** \`/v1\`, then \`/v2\` after years. Each version is a full surface you maintain. Consumers migrate wholesale, which is a large ask, so migrations are slow and old versions linger.

**Per-consumer pinned versions with transformation.** Each account is pinned to the version it integrated against. Internally there is one current implementation, plus a chain of small transformations that convert requests and responses to and from each historical shape. Consumers never break and opt in when ready. This is the most consumer-friendly design and the most demanding: every version ever released is permanently encoded as a transformation you must keep correct.

**Field-level evolution.** No API version at all; the wire format handles compatibility. Protobuf field numbers are the canonical example — add a field with a new number, reserve numbers you retire, never reuse one. Compatibility becomes a property of the format rather than a discipline someone must remember.

## Deprecation that actually works

Announcing a deprecation in a blog post accomplishes nothing. Four mechanisms, in order of usefulness:

**Measure per consumer.** You cannot deprecate what you cannot count. Attribute every call to a consumer and a version. Nearly always the distribution is extremely skewed — a handful of consumers are most of the traffic and a long tail called it twice last year — which turns "coordinate 200 partners" into "help five, email the rest".

**Signal in-band.** \`Deprecation\` and \`Sunset\` response headers, plus a \`Link\` header pointing at the replacement. A machine can see these; a blog post cannot be seen by code.

**Warn where developers work.** Log a warning in your client libraries, and surface usage of deprecated endpoints in the developer dashboard. Developers notice their own logs long before they notice your changelog.

**Plan for the tail never migrating.** Some consumers are embedded devices, or built by vendors that no longer exist. The realistic end state is the old path surviving behind a per-consumer allowlist. Designing for complete migration and being surprised is worse than planning for a residue.

## Internal versus external

The strategies above are priced for consumers you cannot change. Internally the calculus inverts:

- If client and server deploy together, you do not need versions at all — change both in one commit.
- If services deploy independently, you need **one release of overlap**: deploy the server accepting both shapes, then the client using the new one, then remove the old. That is expand-migrate-contract, and it is a two-week discipline rather than a permanent surface.

The mistake is applying public-API ceremony internally, where it costs real velocity for a compatibility window measured in days. The opposite mistake — treating a public API like an internal one — is worse, and it is how you end up asking 200 partners to redeploy.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'change-decision',
      title: 'Deciding whether you actually need a version',
      caption:
        'Follow the branches and notice how few paths reach a version bump. The question that eliminates most of them is whether the old and new shapes can coexist — and they almost always can, at the cost of a permanently uglier surface.',
      code: `flowchart TD
    A[Proposed change] --> B{Can existing consumer<br/>code still work unchanged?}
    B -->|Yes| C[Ship it. Not a version.]
    B -->|No| D{Can the old and new<br/>shapes coexist?}

    D -->|Yes| E["Add the new alongside the old<br/>Keep populating both<br/>Deprecate with headers + telemetry"]
    E --> E1["Cost: permanently larger surface,<br/>a derived field with an owner"]

    D -->|No| F{Is the change worth running<br/>two behaviours indefinitely?}
    F -->|No| G[Do not make the change]
    F -->|Yes| H{Consumers you can<br/>redeploy?}

    H -->|Yes| I["Expand, migrate, contract<br/>One release of overlap"]
    H -->|No| J{Many consumers,<br/>long tail?}
    J -->|No| K["Coarse version: /v2<br/>Two surfaces to maintain"]
    J -->|Yes| L["Per-consumer pinning<br/>+ transformation chain"]
    L --> L1["Cost: every version ever<br/>released runs forever"]

    style C fill:#17272a,stroke:#35897e
    style E fill:#17272a,stroke:#35897e
    style G fill:#17272a,stroke:#35897e
    style E1 fill:#1c1814,stroke:#c99a4e
    style L1 fill:#2a1d1d,stroke:#b8383b`,
    },
    {
      kind: 'flow',
      id: 'transformation-chain',
      title: 'Per-consumer pinning: one implementation, many published shapes',
      caption:
        'Step through a request. The core insight is that the current implementation never learns about old versions — the transformations own that entirely, which is what keeps the business logic from accumulating version branches.',
      nodes: [
        { id: 'c1', label: 'Partner pinned to v1', kind: 'client', x: 0, y: 30, detail: 'Integrated three years ago and has never changed. Sends and expects the v1 shape, and will keep working with no action from them.' },
        { id: 'c2', label: 'Partner pinned to v3', kind: 'client', x: 0, y: 200, detail: 'Integrated last year. Opts into newer versions deliberately, when it suits their release schedule rather than yours.' },
        { id: 'gw', label: 'Version gateway', kind: 'edge', x: 200, y: 115, detail: 'Reads the consumer pin, then applies the chain of request transformations from their version up to current, and the response transformations back down.' },
        { id: 't1', label: 'v1→v2 transform', kind: 'service', x: 390, y: 30, detail: 'A small, pure, individually tested function describing exactly one shape change. It is written once and then frozen — editing it changes behaviour for consumers who have not asked for anything.' },
        { id: 't2', label: 'v2→v3 transform', kind: 'service', x: 390, y: 125, detail: 'Chained after the previous one. A v1 request passes through every transform in sequence to reach the current shape.' },
        { id: 't3', label: 'v3→current', kind: 'service', x: 390, y: 220, detail: 'The newest link. Adding a version means writing one new transform, not forking the implementation.' },
        { id: 'app', label: 'Current implementation', kind: 'service', x: 600, y: 125, detail: 'Knows only the current shape. No version branches, no legacy conditionals — which is the entire reason this design is affordable.' },
        { id: 'obs', label: 'Per-consumer usage', kind: 'store', x: 600, y: 280, detail: 'Which consumer is on which version. Without this, deprecation is guesswork; with it, it is a short list of conversations.' },
      ],
      edges: [
        { id: 'v1', source: 'c1', target: 'gw', label: 'v1 request', kind: 'sync' },
        { id: 'v2', source: 'c2', target: 'gw', label: 'v3 request', kind: 'sync' },
        { id: 'v3', source: 'gw', target: 't1', kind: 'sync' },
        { id: 'v4', source: 't1', target: 't2', kind: 'sync' },
        { id: 'v5', source: 't2', target: 't3', kind: 'sync' },
        { id: 'v6', source: 't3', target: 'app', kind: 'sync' },
        { id: 'v7', source: 'gw', target: 'obs', label: 'record', kind: 'async' },
      ],
      steps: [
        {
          id: 'z1',
          title: 'Consumers are pinned, not migrated',
          description:
            'Each account records the version it integrated against. Nothing you ship changes their behaviour, so a release is never a coordination event — which is what makes shipping frequently possible on a public API.',
          nodes: ['c1', 'c2', 'gw'],
          edges: ['v1', 'v2'],
        },
        {
          id: 'z2',
          title: 'Transformations chain from any version to current',
          description:
            'A v1 request passes through v1→v2, v2→v3, v3→current. Each transform is small, pure and independently testable, and describes exactly one shape change.',
          nodes: ['gw', 't1', 't2', 't3'],
          edges: ['v3', 'v4', 'v5'],
        },
        {
          id: 'z3',
          title: 'The implementation never learns about versions',
          description:
            'This is what keeps the approach affordable. Version branches inside business logic multiply and never get removed; a chain of frozen transformations at the boundary does not touch the logic at all.',
          nodes: ['t3', 'app'],
          edges: ['v6'],
        },
        {
          id: 'z4',
          title: 'And the cost: the chain only ever grows',
          description:
            'Every version ever released is a transformation you maintain forever, and each new change must be expressed as a transform for every historical shape. Per-consumer usage data is what tells you when a link can finally be dropped.',
          nodes: ['gw', 'obs'],
          edges: ['v7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Stripe'],
    body: `Stripe's published approach to versioning is the clearest production example of per-consumer pinning, and the interesting part is the operational consequence rather than the mechanism.

An account is pinned to the API version in effect when it first integrated. Requests and responses are transformed between that version and the current internal shape, so a consumer that integrated years ago continues to receive exactly the shape it was built against — with no action on their part — and upgrades explicitly when it suits their release schedule.

Two properties this buys:

**Shipping stops being a coordination event.** Breaking changes to the current shape do not break anyone, because nobody is on the current shape unless they asked to be. A team can improve the model without negotiating with thousands of integrators.

**Upgrades are opt-in and testable.** A consumer can move to a new version deliberately, in a test environment, on their own timeline.

And the cost, which is the part worth studying:

**Every version ever released runs forever.** Each is encoded as transformations that must remain correct as the internal model evolves. A change to the current shape may require a new transformation for *every* historical version, so the cost of a change grows with the number of versions ever published.

**Transformations become frozen behaviour.** Once a version is pinned by a live consumer, its transformation is effectively immutable — fixing a bug in it changes behaviour for someone who did not ask for a change, which is itself a breaking change.

**It only works if the transformations stay at the boundary.** The moment a version conditional leaks into business logic, the approach collapses into the version-branch mess it exists to prevent.

Transferable lessons:

**Pinning trades one large coordination problem for a permanent maintenance stream.** That is a good trade when you have thousands of consumers you cannot schedule, and a poor one for an internal service with three callers — where the same effort buys nothing that expand-migrate-contract does not give you in two weeks.

**The prerequisite is per-consumer usage data.** None of this is manageable without knowing exactly which consumer is on which version. That instrumentation is what turns deprecation from an announcement into a short list of conversations, and it is worth building before you need it.`,
  },

  tradeoffs: {
    intro:
      'The question is not which strategy is best but how long you will run two behaviours. Rows are ordered by how much permanent surface each one creates.',
    rows: [
      {
        option: 'No versions: additive changes only',
        whenItWins:
          'Almost always as a first strategy. One code path, no coordination, and every change ships immediately.',
        whenItLoses:
          'When a genuinely incompatible model change is required, or when the accreted surface becomes confusing to new consumers.',
        cost:
          'Permanent field accretion, derived fields that need owners, and the discipline never to redefine a name.',
      },
      {
        option: 'Expand, migrate, contract (internal services)',
        whenItWins:
          'Services that deploy independently but are all owned by you. Compatibility is needed for one release, not forever.',
        whenItLoses:
          'The moment a consumer exists that you cannot redeploy on your schedule.',
        cost:
          'A short window where both shapes are supported, and the discipline to actually complete the contract step.',
      },
      {
        option: 'Coarse versions in the path (/v1, /v2)',
        whenItWins:
          'Infrequent, large redesigns with a manageable number of consumers who can migrate wholesale.',
        whenItLoses:
          'When migration is a large ask, so v1 lingers indefinitely and you maintain two full surfaces.',
        cost:
          'Two complete implementations, doubled testing and security patching, and a migration you must sell.',
      },
      {
        option: 'Per-consumer pinning with a transformation chain',
        whenItWins:
          'Many consumers you cannot schedule, where breaking anyone is unacceptable and shipping often is essential.',
        whenItLoses:
          'Small consumer counts, where the machinery costs far more than a coordinated migration.',
        cost:
          'Every version ever released maintained forever, frozen transformations, and a change cost that grows with version count.',
      },
      {
        option: 'Field-level evolution in the wire format',
        whenItWins:
          'Schema-first systems where compatibility can be a property of the format — Protobuf field numbers being the canonical case.',
        whenItLoses:
          'When the change is semantic rather than structural; no field-numbering scheme saves you from redefining a meaning.',
        cost:
          'Retired field numbers reserved forever, and a surface that accretes exactly as the additive strategy does.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"We are renaming several fields for consistency, so we will ship v2."',
      whyWeak:
        'A version commits you to running two behaviours for as long as anyone uses the old one — which for a public API may be indefinitely. Paying that to make field names tidier is a very poor trade, and it will be paid by every future engineer maintaining both surfaces.',
      strongAnswer:
        '"Renaming is not worth a version. I would add the new names alongside the old ones, keep both populated, and deprecate the old ones with headers and per-consumer telemetry. The surface gets uglier and nothing breaks — and if we later have a genuinely incompatible model change, we spend the version on that instead."',
    },
    {
      weakAnswer: '"We announced the v1 sunset in the changelog six months ago, so we can remove it."',
      whyWeak:
        'A changelog is not observable by code. Unless you have per-consumer usage data showing zero calls, removal is a guess — and the consumers most likely to have missed the announcement are exactly the ones least able to react quickly.',
      strongAnswer:
        '"I would not remove it based on an announcement. I need per-consumer usage showing zero traffic, in-band Deprecation and Sunset headers so a machine can see it, and direct contact with the remaining callers. And I would plan for a residue that never migrates, kept alive behind an allowlist."',
    },
    {
      weakAnswer: '"We changed `total` to include tax and documented it in the release notes."',
      whyWeak:
        'This is a silent semantic change: nothing errors, no schema check fails, and every consumer\'s arithmetic is quietly wrong. It is discovered by financial reconciliation weeks later, with nothing pointing at the cause.',
      strongAnswer:
        '"Redefining a field\'s meaning while keeping its name is the worst class of breaking change, because there is no failure signal. I would add `totalIncludingTax` as a new field, leave `total` exactly as it was, and deprecate it on a timeline. Adding is safe; redefining is invisible."',
    },
    {
      weakAnswer: '"Every service has a /v1 prefix from day one, so we are ready to version later."',
      whyWeak:
        'For internal services with owned consumers, this is ceremony that buys nothing — the compatibility window you need is one release, not forever. Worse, having a version slot available makes shipping a v2 feel cheap, which encourages exactly the behaviour that creates two permanent surfaces.',
      strongAnswer:
        '"Internally I would use expand-migrate-contract: deploy the server accepting both shapes, move the callers, then remove the old shape. That is a two-week discipline rather than a permanent surface. Version prefixes belong where consumers cannot be redeployed on my schedule."',
    },
    {
      weakAnswer: '"We support both versions with an `if (version === 1)` branch in the service layer."',
      whyWeak:
        'Version conditionals inside business logic multiply with every version and every code path, are never removed, and make it impossible to reason about current behaviour. This is the failure mode that makes people believe versioning is inherently unmanageable.',
      strongAnswer:
        '"Version handling belongs at the boundary as a transformation, never in the business logic. The implementation should know only the current shape, and a chain of small pure transforms converts requests and responses to and from each published version. If a version conditional reaches the service layer, the approach has already failed."',
    },
  ],

  flashcards: [
    {
      id: 'fc-ver-1',
      front: 'What is a version actually a commitment to?',
      back: 'Running two behaviours simultaneously for as long as anyone uses the old one — which for a public API may be indefinitely. It is not a release that replaces its predecessor.',
      topic: 'api-versioning',
    },
    {
      id: 'fc-ver-2',
      front: 'What is the test for whether a change is breaking?',
      back: 'Not whether the shape changed, but whether existing consumer code can still work unchanged.',
      topic: 'compatibility',
    },
    {
      id: 'fc-ver-3',
      front: 'Which class of breaking change is the most expensive, and why?',
      back: 'A silent semantic change — same field name, new meaning. Nothing errors, no schema check fails, and consumers are quietly wrong until a reconciliation finds it.',
      topic: 'compatibility',
    },
    {
      id: 'fc-ver-4',
      front: 'Why is a path version the usual choice despite the philosophical objection?',
      back: 'Everything in your infrastructure can already route, log, cache and rate-limit on a path. The objection that resource identity should not change is right and operationally irrelevant.',
      topic: 'api-versioning',
    },
    {
      id: 'fc-ver-5',
      front: 'What does per-consumer version pinning buy, and what does it cost?',
      back: 'Buys: nobody ever breaks, upgrades are opt-in, shipping is not a coordination event. Costs: every version ever released runs forever as frozen transformations, and change cost grows with version count.',
      topic: 'api-versioning',
    },
    {
      id: 'fc-ver-6',
      front: 'Why must version transformations stay at the boundary?',
      back: 'Version conditionals inside business logic multiply across versions and code paths and are never removed. The implementation must know only the current shape for the approach to stay affordable.',
      topic: 'api-versioning',
    },
    {
      id: 'fc-ver-7',
      front: 'What is expand-migrate-contract, and where does it apply?',
      back: 'Deploy the server accepting both shapes, move the callers, then remove the old shape. It applies to independently deployed services you own, where the compatibility window is one release rather than forever.',
      topic: 'deprecation',
    },
    {
      id: 'fc-ver-8',
      front: 'What is the prerequisite for any real deprecation?',
      back: 'Per-consumer, per-version usage data. Without it, removal is a guess, and the distribution is almost always skewed enough to turn a coordination problem into a handful of conversations.',
      topic: 'deprecation',
    },
    {
      id: 'fc-ver-9',
      front: 'Why is a changelog announcement insufficient for deprecation?',
      back: 'Code cannot read a changelog. Deprecation must be in-band — Deprecation and Sunset headers, client-library warnings, dashboard surfacing — so a machine or a developer\'s own logs reveal it.',
      topic: 'deprecation',
    },
    {
      id: 'fc-ver-10',
      front: 'How does Protobuf make compatibility a property of the format?',
      back: 'Fields are identified by number, not name. Adding a new number is backward compatible, retiring one means reserving it forever, and a name change is invisible on the wire.',
      topic: 'compatibility',
    },
  ],

  quiz: [
    {
      id: 'q-ver-1',
      kind: 'scenario',
      prompt:
        'A team wants to rename six response fields for consistency and proposes /v2. There are 180 partner integrations. What is the strongest response?',
      options: [
        { id: 'a', label: 'Add the new names alongside the old, populate both, and deprecate — a version is not worth paying for renames' },
        { id: 'b', label: 'Ship v2 and give partners twelve months to migrate' },
        { id: 'c', label: 'Rename in place and document it in the changelog' },
        { id: 'd', label: 'Use a header-based version so URLs stay stable' },
      ],
      correct: ['a'],
      explanation:
        'A version commits you to two surfaces for as long as anyone uses the old one, which with 180 partners is effectively forever. Additive aliasing costs an uglier surface and breaks nobody. Renaming in place breaks everyone immediately, and the choice of where the version lives is irrelevant when the version itself is unjustified.',
      difficulty: 'core',
      topic: 'api-versioning',
    },
    {
      id: 'q-ver-2',
      kind: 'scenario',
      prompt:
        'Two internal services, deployed independently by the same team, need a request field renamed. What is the right approach?',
      options: [
        { id: 'a', label: 'Expand-migrate-contract: server accepts both, then the caller moves, then remove the old field' },
        { id: 'b', label: 'Introduce /v2 on the server and migrate the caller to it' },
        { id: 'c', label: 'Deploy both changes simultaneously and accept a brief window of failures' },
        { id: 'd', label: 'Add per-consumer version pinning to the internal service' },
      ],
      correct: ['a'],
      explanation:
        'The compatibility window needed is one release, not forever, because you control both sides. Expand-migrate-contract handles it in three deploys with no permanent surface. A version prefix or pinning machinery is public-API ceremony that buys nothing here, and a simultaneous deploy guarantees failures during the rollout.',
      difficulty: 'core',
      topic: 'deprecation',
    },
    {
      id: 'q-ver-3',
      kind: 'single',
      prompt: 'Which of these is a safe, non-breaking change?',
      options: [
        { id: 'a', label: 'Relaxing validation to accept inputs that were previously rejected' },
        { id: 'b', label: 'Adding a value to an enumeration documented as a fixed set' },
        { id: 'c', label: 'Changing the default of an optional request parameter' },
        { id: 'd', label: 'Making a response field absent when it has no value' },
      ],
      correct: ['a'],
      explanation:
        'Accepting more inputs cannot break a consumer that was already sending valid ones. Adding to a closed enum breaks exhaustive client branches; changing a default changes behaviour for callers who omitted the field; and making a field absent breaks anyone who reads it without a null check.',
      difficulty: 'intro',
      topic: 'compatibility',
    },
    {
      id: 'q-ver-4',
      kind: 'scenario',
      prompt:
        'A per-consumer pinning system has 14 published versions. A change to the current internal model is proposed. What is the cost that a team new to this approach usually underestimates?',
      options: [
        { id: 'a', label: 'The change may need a new transformation for every one of the 14 historical shapes' },
        { id: 'b', label: 'Consumers will need to upgrade to receive the change' },
        { id: 'c', label: 'The gateway will become a latency bottleneck' },
        { id: 'd', label: 'Older versions will stop working automatically' },
      ],
      correct: ['a'],
      explanation:
        'The cost of a change grows with the number of versions ever published, because the current shape must still be presentable as each historical shape. Consumers explicitly do not need to upgrade — that is the point of pinning — and old versions keep working, which is exactly why the transformation burden accumulates.',
      difficulty: 'advanced',
      topic: 'api-versioning',
    },
    {
      id: 'q-ver-5',
      kind: 'scenario',
      prompt:
        'You are asked to remove a v1 endpoint deprecated 12 months ago. Announcements were made. What do you do first?',
      options: [
        { id: 'a', label: 'Check per-consumer usage — the distribution will show who is left, and whether removal is even possible' },
        { id: 'b', label: 'Remove it and monitor error rates to see who complains' },
        { id: 'c', label: 'Extend the deprecation by another twelve months' },
        { id: 'd', label: 'Return 410 Gone immediately so callers get a clear signal' },
      ],
      correct: ['a'],
      explanation:
        'Usage data is the only evidence that matters, and it usually reveals a short list rather than a crowd. Removing to see who complains breaks production for consumers who may be embedded devices. Extending blindly repeats the same non-decision, and returning 410 is removal with better manners.',
      difficulty: 'core',
      topic: 'deprecation',
    },
    {
      id: 'q-ver-6',
      kind: 'multi',
      prompt: 'Which of these make a deprecation observable to the people who must act on it? Select all that apply.',
      options: [
        { id: 'a', label: 'Deprecation and Sunset response headers with a Link to the replacement' },
        { id: 'b', label: 'A warning logged by your official client libraries' },
        { id: 'c', label: 'Deprecated-endpoint usage surfaced in the developer dashboard' },
        { id: 'd', label: 'A post in the public changelog' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three reach either a machine or a developer\'s own logs and dashboards, which is where attention actually is. A changelog post is worth publishing and is not a mechanism — no code reads it, and the consumers least able to react are the least likely to see it.',
      difficulty: 'core',
      topic: 'deprecation',
    },
  ],

  exercises: [
    {
      id: 'ex-ver-1',
      kind: 'design',
      title: 'Get out of a versioning hole',
      estimatedMinutes: 20,
      prompt: `You inherit a public API with this situation:

- \`/v1\`, \`/v2\` and \`/v3\` are all live. v3 is two months old.
- v1 has 40% of traffic, v2 has 45%, v3 has 15%.
- The three versions are implemented as separate controller packages sharing a service layer that is riddled with \`if (apiVersion >= 2)\` branches.
- The differences between versions are: field renames (v1→v2), a date format change (v1→v2), pagination moving from offset to cursor (v2→v3), and one genuinely new resource in v3.
- 600 known integrations. No per-consumer version telemetry exists.
- The team wants to ship v4 to fix "some remaining naming inconsistencies".

Produce a plan. Cover: what you refuse to do and why, what you do first, how you reduce three surfaces to something maintainable, and what you tell the team about v4.`,
      rubric: [
        'Refuses v4, on the grounds that naming inconsistencies do not justify a fourth permanent surface.',
        'Identifies the absence of per-consumer version telemetry as the first thing to fix, because nothing else can be planned without it.',
        'Distinguishes the version differences by kind: renames and date formats are expressible as boundary transformations, cursor pagination is a genuine behavioural change.',
        'Proposes moving version handling out of the shared service layer into boundary transformations, so the implementation knows only the current shape.',
        'Proposes a consolidation path: one current implementation plus transformation chains, rather than three controller packages.',
        'Plans deprecation with in-band headers and usage-driven outreach rather than announcements, and prioritises by traffic concentration.',
        'Accepts that some consumers may never migrate and designs for a residual allowlist rather than assuming completion.',
      ],
      modelAnswer: `**What I refuse: v4.**

"Remaining naming inconsistencies" is not worth a fourth permanent surface. We already maintain three, the service layer is unreadable because of it, and every version we add increases the cost of every future change. If some names are wrong, we add better names alongside them in the current version — that costs an uglier response and nothing else.

I would also point out the pattern: three versions in the life of this API, and the differences are mostly renames and a date format. That is not domain evolution, it is modelling corrections being paid for with permanent maintenance. Shipping v4 for the same reason repeats the mistake with more traffic behind it.

**What I do first: per-consumer version telemetry.**

Nothing else can be planned without it. Every request gets attributed to a consumer and a version, retained long enough to see monthly and quarterly callers. This is days of work and it converts every subsequent decision from a guess into a lookup.

I expect the distribution to be heavily skewed — not 600 consumers spread evenly across v1's 40%, but a few dozen large integrators plus a long tail. That changes the shape of the whole problem, and I would not commit to a plan before seeing it.

**Then: get versions out of the service layer.**

The \`if (apiVersion >= 2)\` branches are the real problem — worse than having three versions, because they make current behaviour impossible to reason about and they will never be removed.

Classify the differences:

| Difference | Kind | Where it belongs |
| --- | --- | --- |
| v1→v2 field renames | Structural | A boundary transformation |
| v1→v2 date format | Structural | A boundary transformation |
| v2→v3 offset → cursor pagination | **Behavioural** | Cannot be a pure transformation |
| v3's new resource | Additive | Simply absent in older versions |

The first two and the last are easy: pure functions at the boundary, and the implementation stops knowing about them entirely.

Pagination is the hard one, and worth being honest about. Converting a cursor response back into an offset response requires either translating an offset into a cursor (which needs a scan, reintroducing exactly the cost cursors removed) or keeping an offset code path in the read layer. I would keep a single legacy offset read path, isolated behind an interface and clearly marked as serving pinned versions only — one contained piece of legacy rather than branches scattered through the service layer.

**Target architecture:**

\`\`\`
request → gateway (reads consumer pin)
        → transform chain (v1→v2→v3→current)
        → current implementation (no version awareness)
        → transform chain back down
\`\`\`

Three controller packages collapse into one implementation plus three frozen transformation sets. The service layer becomes readable, and adding a version later means writing one transform rather than forking a package.

**Then: deprecate v1, driven by data.**

- Emit \`Deprecation\` and \`Sunset\` headers plus a \`Link\` to the v3 equivalent on every v1 response.
- Log a warning in the official client libraries.
- Surface v1 usage in each consumer's developer dashboard, so their own engineers see it.
- Rank remaining v1 consumers by traffic and contact the top ones directly. If the skew is what I expect, that is perhaps ten conversations covering most of the 40%.

**And accept the residue.** With 600 integrations, some fraction is embedded software, abandoned vendors, or teams that no longer exist. The realistic end state is v1 surviving for a handful of consumers behind an allowlist, with its transformation frozen. Planning for that is better than planning for completion and being surprised — and it is cheap, because once versions are boundary transformations, keeping one alive for five consumers costs almost nothing.

**Ordering rationale:** telemetry first because it is a prerequisite for every other decision; refactoring versions to the boundary second because it makes the codebase workable and is entirely within our control; deprecation last because it is the only step that depends on other organisations.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-ver-1',
      level: 'basic',
      question: 'What counts as a breaking change to an API?',
      guidance:
        'The test is whether existing consumer code still works unchanged. Look for removals, renames, narrowed types, changed defaults, tightened validation, and additions to closed enums. A strong answer singles out silent semantic changes as the worst because nothing fails.',
    },
    {
      id: 'iq-ver-2',
      level: 'basic',
      question: 'Where would you put the version — path, header or query parameter?',
      guidance:
        'Path, usually, and the reason should be operational: routing, logging, caching and rate limiting already work on paths. A strong answer acknowledges the philosophical objection to versioning resource identity and explains why it loses to operability.',
    },
    {
      id: 'iq-ver-3',
      level: 'intermediate',
      question: 'A team proposes v2 to rename some fields. What do you say?',
      guidance:
        'That a version commits you to two behaviours for as long as anyone uses the old one, and renames do not justify that. Propose additive aliasing with deprecation. A strong answer reframes the version as a maintenance stream rather than a release.',
    },
    {
      id: 'iq-ver-4',
      level: 'intermediate',
      question: 'How does versioning differ for internal services versus a public API?',
      guidance:
        'Internally the compatibility window is one release: expand-migrate-contract. Publicly it may be forever. A strong answer notes that applying public ceremony internally costs velocity for nothing, and that the reverse mistake is much worse.',
    },
    {
      id: 'iq-ver-5',
      level: 'advanced',
      question: 'Explain per-consumer version pinning and when it is worth it.',
      guidance:
        'Consumers pinned to their integration version, with transformation chains to the current shape at the boundary. Worth it with many unschedulable consumers and a need to ship often. Excellent answers name the cost — every version runs forever, change cost grows with version count — and insist transformations never leak into business logic.',
    },
    {
      id: 'iq-ver-6',
      level: 'advanced',
      question: 'How do you actually retire an old version?',
      guidance:
        'Per-consumer usage data first, then in-band signalling, client-library warnings and dashboard surfacing, then targeted outreach ranked by traffic. Excellent answers plan for a residue that never migrates and design an allowlist rather than assuming completion.',
    },
    {
      id: 'iq-ver-7',
      level: 'followup',
      question: 'You said transformations must stay at the boundary. What happens if one cannot be pure?',
      guidance:
        'Behavioural changes — offset to cursor pagination is the standard example — cannot be expressed as a response transformation. The honest answer is to keep one isolated legacy code path behind an interface, clearly scoped to pinned versions, rather than branching through the service layer. Recognising which differences are structural and which are behavioural is the skill.',
    },
    {
      id: 'iq-ver-8',
      level: 'followup',
      question: 'If additive-only is so much cheaper, what stops it working forever?',
      guidance:
        'Accretion: the surface grows, derived fields need owners and rebuild paths, and new consumers face a confusing API with three ways to express the same thing. A strong answer notes the real limit is comprehension rather than mechanics, and that good documentation of the preferred path buys a lot of runway.',
    },
  ],

  activeLearning: [
    {
      id: 'al-ver-1',
      kind: 'what-changes-if',
      prompt:
        'Everything here assumed a synchronous request-response API. Now change one thing: the interface is an event stream — you publish domain events that dozens of consumers subscribe to. How does versioning change, and what new failure mode appears?',
      discussion: `Three things change, and the new failure mode is the interesting one.

**Change 1: you cannot transform per consumer.** With request-response, the gateway knows who is asking and can shape the response for them. A published event has no requester — it is written once and read by everyone. Per-consumer pinning is structurally unavailable, so additive-only becomes much closer to mandatory rather than merely preferable.

**Change 2: consumers can be arbitrarily far behind.** A subscriber that was down for a week reads events published under an older understanding of the schema. In request-response, an old client sends an old request *now*. In event streaming, a *new* consumer may read *old* events, and an old consumer may read *new* events. You need compatibility in **both** directions — forward and backward — which is a stronger requirement than either alone.

**Change 3: the schema registry becomes infrastructure, not documentation.** Because compatibility must be checked before an incompatible event is ever published — after publication it is in the log permanently — the check has to be enforced at publish time. This is where field-numbered formats earn their place: compatibility becomes a property the registry can verify mechanically rather than a discipline someone must remember.

**The new failure mode: events are immutable, so a bad schema change is permanent.**

With an HTTP API, shipping a breaking change and reverting it means a few minutes of errors. With an event log, publishing events in a broken shape means those events exist in that shape forever. Every consumer that ever replays the log — including consumers written years later, including the rebuild path for a projection — must handle the broken shape. There is no revert.

That single asymmetry justifies a level of caution that would look excessive for an HTTP API: mandatory registry checks in CI, a rule that fields are only ever added and never removed or repurposed, and explicit schema versioning inside the event payload so a reader can tell which shape it is holding.

**And a second-order consequence worth naming.** Because you cannot transform per consumer, the usual escape hatch is to publish a *new event type* alongside the old one and have both emitted during a transition. That is the event-stream equivalent of additive change, and it has the same cost: the old event type is published forever, or until you can prove nobody replays the log — which, given that replay is the point of a log, is rarely.

**Transferable:** the cost of a compatibility mistake scales with how long the artefact persists. A response lives for milliseconds. An event lives as long as the log. Design caution should scale accordingly, and mechanisms that make compatibility checkable — field numbers, registries, CI enforcement — become proportionally more valuable.`,
    },
    {
      id: 'al-ver-2',
      kind: 'explain-yourself',
      prompt:
        'In your own words and without looking back, write five or six sentences you would say to a team lead who wants to ship v2 to clean up naming across a public API with 200 partners. Concede the strongest part of their case first. Then compare with the discussion.',
      discussion: `The strongest part of their case is real and should be conceded plainly: the current names *are* confusing, and confusing names have an ongoing cost in support load and integration errors. Dismissing that makes the rest of the argument sound like inertia.

One version:

> The names genuinely are bad, and I do not want to pretend that costs nothing — every confusing field name shows up as a support ticket and an integration bug. But a version is not a release that replaces v1; it is a commitment to run both for as long as any of those 200 partners keeps calling v1, and realistically some of them never stop. So we would be buying tidier names in exchange for two permanent surfaces, doubled security patching, and every future change having to be made twice. What I would do instead is add the better names alongside the old ones, populate both, mark the old ones deprecated in the docs and in response headers, and point the SDKs and the quickstart at the new names — so every new integration gets the good names and nobody breaks. If we later hit a change that genuinely cannot be additive, we spend the version on that, when it is actually worth it.

What makes that strong:

- **It concedes specifically**, with a cost attached (support tickets, integration bugs), rather than a token acknowledgement.
- **It reframes what a version is.** "Commitment to run both indefinitely" is the sentence that changes the decision, and it is the one most teams have never articulated.
- **It quantifies the downside in maintenance terms** the lead cares about: two surfaces, doubled patching, every change made twice.
- **It offers a concrete alternative that achieves most of the goal.** New integrations get good names immediately, which is where most of the confusion cost actually lands.
- **It preserves the option.** Not "never version" but "save the version for something that needs it".

Weaknesses to check your own answer for:

- Did you argue that the names are fine? They are not, and saying so loses credibility.
- Did you say "versioning is expensive" without saying *how* — two surfaces, forever, every change twice?
- Did you offer an alternative that gets new integrations onto the better names, or only one that preserves the status quo?
- Did you leave room for a future version, or did you argue against versioning in principle?`,
    },
  ],

  revision: {
    bullets: [
      'A version is a commitment to run two behaviours for as long as anyone uses the old one — not a release that replaces its predecessor.',
      'Most "we need v2" is a rename. Tidiness is not worth a permanent second surface.',
      'The breaking test: can existing consumer code still work unchanged?',
      'Safe: adding fields, adding optional parameters with preserving defaults, adding endpoints, relaxing validation.',
      'Breaking: removals, renames, narrowed types, changed defaults, tightened validation, additions to closed enums.',
      'Silent semantic change — same name, new meaning — is the worst class, because nothing fails.',
      'Path versions win on operability: routing, logging, caching and rate limiting already work on paths.',
      'Strategies, by permanent surface created: additive-only, expand-migrate-contract, coarse versions, per-consumer pinning, field-level evolution.',
      'Per-consumer pinning means nobody breaks and every version ever released runs forever as a frozen transformation.',
      'Version handling belongs at the boundary. A version conditional in business logic means the approach has already failed.',
      'Structural differences can be pure transformations; behavioural ones (offset to cursor) cannot, and need one isolated legacy path.',
      'Internally the compatibility window is one release: expand, migrate, contract.',
      'Deprecation needs per-consumer usage data first. Without it, removal is a guess.',
      'Signal in-band: Deprecation and Sunset headers, client-library warnings, dashboard surfacing. A changelog is not a mechanism.',
      'Plan for a residue that never migrates, kept alive behind an allowlist.',
      'For event streams, compatibility must hold in both directions and a bad schema change is permanent, because the log is.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The set of mechanisms for changing a published interface without breaking consumers who cannot be redeployed on your schedule.',
    whyItExists:
      'Implementations change faster than integrations. Versioning and additive evolution are the two ways to let a system and its consumers move on different clocks.',
    whenToUse: [
      'Additive-only as the default for every change that can be expressed that way.',
      'Expand-migrate-contract for independently deployed services you own.',
      'Per-consumer pinning when you have many unschedulable consumers and need to ship often.',
    ],
    whenNotToUse: [
      'A version for renames, tidiness or field reordering — those are additive changes.',
      'Public-API versioning ceremony for internal services, where one release of overlap is sufficient.',
      'Any strategy at all, before you can measure which consumer is on which version.',
    ],
    alternatives: [
      'Field-numbered wire formats such as Protobuf, making compatibility a checkable property rather than a discipline.',
      'A schema registry enforcing compatibility at publish time, essential for event streams where a mistake is permanent.',
      'Not making the change, when the benefit is comprehension and the cost is a permanent second surface.',
    ],
    tradeoffs: [
      'Additive-only buys one code path and costs permanent field accretion.',
      'Coarse versions buy a clean redesign and cost two full surfaces you maintain and patch.',
      'Per-consumer pinning buys never breaking anyone and costs a transformation per version, forever.',
      'Boundary transformations buy a version-free implementation and cannot express behavioural changes.',
    ],
    failureModes: [
      'Version conditionals spreading through business logic and never being removed.',
      'A silent semantic change discovered by reconciliation weeks later.',
      'Deprecation based on announcements rather than usage data, so removal breaks live consumers.',
      'Change cost growing with version count until shipping anything requires touching every historical shape.',
      'Derived legacy fields drifting out of sync with the fields they are computed from.',
      'An incompatible event published to a log, where it exists in that shape permanently.',
    ],
    followUpQuestions: [
      'How long will you run both behaviours, and who decides when the old one goes?',
      'Can this change be additive, and what does the extra field cost you?',
      'Where does version handling live — the boundary or the business logic?',
      'Which consumer is on which version, and how do you know?',
      'What is your plan for the consumers who never migrate?',
      'Is this a structural change or a behavioural one?',
    ],
  },
});
