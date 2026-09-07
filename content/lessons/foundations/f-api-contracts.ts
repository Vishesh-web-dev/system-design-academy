import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'f-api-contracts',
  title: 'Resource modelling and API contracts',
  summary:
    'An API is a promise made to code you do not control, and the promise outlives every implementation behind it — which is why modelling mistakes are expensive and internal refactors are not.',
  phase: 'foundations',
  module: 'apis',
  position: 7,
  kind: 'concept',
  difficulty: 'core',
  estimatedMinutes: 40,
  tags: ['api-design', 'api-contracts', 'resource-modeling', 'coupling', 'validation'],
  prerequisites: ['f-http-versions'],
  resources: [
    {
      key: 'google-api-design-guide',
      tier: 'must',
      note: 'The resource-oriented design and standard-methods chapters. Treat it as a set of defaults you deviate from deliberately rather than a rulebook, and note that it explicitly permits custom methods.',
    },
    {
      key: 'openapi-spec',
      tier: 'must',
      note: 'Skim the structure rather than reading it through. The point is that a machine-readable contract enables generated clients, generated validation and contract tests — the mechanisms that stop drift.',
    },
    {
      key: 'json-schema-spec',
      tier: 'good',
      note: 'The vocabulary behind request and response validation. Useful once you decide that a schema, not documentation, is the thing that defines your contract.',
    },
    {
      key: 'protobuf-proto3',
      tier: 'good',
      note: 'Field numbers and optionality as a compatibility mechanism. Read it even if you never use Protobuf: it is the clearest illustration of designing a wire format for change.',
    },
  ],

  intuition: {
    body: `Here is the asymmetry that makes API design different from ordinary code design.

If you get a class wrong, you rename it. If you get a database column wrong, you migrate it. Both are work, both are finite, and both are entirely inside your control.

If you get a public field name wrong, it is wrong forever — or until every consumer you have never met agrees to change at the same time, which is not a thing that happens.

That single asymmetry produces every rule in this lesson. **An API is not an interface to your system; it is a promise about your system's vocabulary, made to code you cannot modify.** The implementation behind it will be rewritten several times. The promise will not.

Which leads to the two questions that decide whether an API model is any good:

**What are the nouns, and are they stable?** Resources should be things your *domain* has, not things your current implementation has. \`/orders\` will still make sense after you split the monolith. \`/orderServiceQueryHandler\` will not.

**What can change without breaking anyone?** A model where adding a field, adding an endpoint or adding an enum value is safe can evolve for years. A model where any of those breaks a consumer is frozen from launch.

The corollary is the useful one: **internal refactors are cheap and modelling mistakes are expensive**, which is the opposite of how most teams allocate design attention. Spend an hour on whether the resource is right. Do not spend an hour on whether the service class hierarchy is right.`,
    analogyLimit:
      'Calling an API "a promise" is right about durability and wrong about precision — a promise is prose, and prose drifts from behaviour silently. What makes a contract enforceable is that it is machine-readable and checked in CI, so the drift becomes a failing build rather than a support ticket six months later.',
  },

  deepExplanation: {
    predict: {
      question:
        'You are designing an API for a food delivery service. A colleague proposes `POST /api/v1/processOrderAndNotifyRestaurant`. Before reading on: name three separate problems with this, and say which one is expensive to fix later and which two are cheap.',
      answer: `**Problem 1 — it names an implementation, not a resource.** "Process" and "notify restaurant" are two things your code currently does in one transaction. When you later notify the restaurant asynchronously, or add a third notification, or split the notification into its own service, the endpoint name is a lie. *Cost to fix: expensive.* The name is in every consumer's code.

**Problem 2 — it does two things, so it has no clean success or failure.** What is the response when the order is created and the restaurant notification fails? Success? Failure? Both are wrong: the order exists, so returning an error means the consumer retries and creates a second order. This is a compound operation without compound semantics. *Cost to fix: expensive*, because the fix changes the response contract.

**Problem 3 — it is a POST, so it inherits nothing from HTTP.** No cacheable read path is implied, no retry safety, and it appears in every dashboard as one endpoint alongside every other \`POST /api/v1/*\`. *Cost to fix: cheap-ish*, because it is additive — you can add \`GET /orders/{id}\` later without removing anything.

Bonus, and the one candidates most often miss: **it embeds a workflow into the API surface.** The consumer now knows that ordering involves notifying a restaurant. If you later notify via a partner integration platform instead, the consumer's mental model — and your endpoint name — are both wrong.

The version that survives:

\`\`\`
POST /orders                  → 201 with the order, status "placed"
GET  /orders/{id}             → current state, including fulfilment status
\`\`\`

Notification is an internal consequence of an order existing. The consumer asked for an order to exist. **The API should express the intent, not the steps.**

The distinction that matters for the prediction: names and response contracts are expensive because they are in consumers' code. Adding endpoints and adding fields is cheap because it is additive. Design attention should follow that asymmetry.`,
    },
    body: `## Model the domain, not the implementation

The resources in your API should be the things your business talks about, because those are the things that persist across rewrites.

\`\`\`
Good:  /orders  /restaurants  /deliveries  /customers
Bad:   /orderService  /restaurantCache  /deliveryQueue  /customerAggregate
\`\`\`

The bad names leak architecture. Every one of them will be a lie after the next refactor, and each lie is permanent because consumers have hard-coded it.

A useful test: **would this resource name still make sense if you rewrote the entire backend in a different language with a different architecture?** If not, it is an implementation detail wearing a URL.

A second test: **does the resource correspond to something a domain expert would name?** A delivery driver talks about orders, deliveries and restaurants. They have never mentioned an aggregate.

## Identity: pick it early, because it is permanent

Resource identifiers are the single hardest thing to change, because consumers store them. Three decisions:

**Opaque or meaningful?** \`ORD-2026-004471\` tells a human something and commits you forever: to that format, to the year being in it, and to the number of digits. Opaque identifiers commit you to nothing. Prefer opaque for anything machine-consumed, and put the human-readable reference in a *field* where it can be reformatted.

**Sequential or random?** Sequential ids are enumerable and leak volume — a competitor learns your order rate by placing two orders an hour apart. Random ids leak nothing and cannot be range-scanned or sorted by creation without a separate timestamp.

**Global or scoped?** \`/orders/{id}\` requires ids unique across all orders. \`/restaurants/{rid}/orders/{oid}\` allows per-restaurant numbering and encodes the relationship in the path. Scoped is more explicit and worse when a resource can move between parents — which is the question to ask before choosing.

## Represent state, not transitions

A resource representation should describe what *is*, not what happened.

\`\`\`json
{
  "id": "ord_7f3a",
  "status": "out_for_delivery",
  "placedAt": "2026-09-05T18:22:00Z",
  "total": { "amount": 2450, "currency": "GBP" }
}
\`\`\`

Two things worth defending in that snippet:

**Money is an integer of minor units plus a currency.** Never a float, because 0.1 + 0.2 is not 0.3 in binary floating point and money is exactly where that matters. Never a bare number, because a currency-less amount is meaningless the moment you operate anywhere else.

**Timestamps are ISO 8601 with an explicit offset.** A timestamp without a zone is ambiguous, and epoch integers are ambiguous about seconds versus milliseconds. Both ambiguities get resolved differently by different consumers, silently.

**Enumerations are a contract.** \`status\` is a closed set today and consumers will write \`switch\` statements over it. Adding a value later breaks anyone who did not write a default branch — which is most people. Two options: document that the set is open and clients must tolerate unknown values, or version the field. Choose deliberately; discovering it when you add \`awaiting_courier\` is too late.

## Actions that are genuinely not resources

Some operations do not fit. Cancel an order, resend a receipt, recalculate pricing. Two honest patterns:

**A custom method:** \`POST /orders/{id}:cancel\`. Explicit about being an action, keeps the resource in the path so authorisation and observability still key on it, and does not require inventing a noun.

**A state sub-resource:** \`PUT /orders/{id}/status\` with \`{"status": "cancelled"}\`. Reads naturally when the operation genuinely is a state transition, and awkwardly when it takes parameters.

What to avoid is inventing a noun that models nothing — \`POST /orders/{id}/cancellations\` — purely to satisfy a rule about resources. That is ceremony without benefit.

## Errors are part of the contract

A consumer's error-handling code is written against your error format. Changing it is a breaking change, so specify it once:

\`\`\`json
{
  "type": "insufficient_stock",
  "title": "Not enough stock to fulfil this order",
  "detail": "Item sku_991 has 2 available, 5 requested",
  "instance": "req_01HXYZ",
  "errors": [{ "field": "items[1].quantity", "code": "max_exceeded" }]
}
\`\`\`

The load-bearing parts: a **stable machine-readable code** (\`type\`) that clients branch on, a human message that you are free to reword, per-field detail for validation failures, and a request identifier so a support conversation can find the exact request. Human-readable messages may change; the codes may not.

## Designing for change

Four rules that keep an API evolvable:

**Additive changes only.** Adding a field, an endpoint or an optional parameter is safe. Removing, renaming or narrowing is not. This means being conservative about what you add, because everything you add is permanent.

**Consumers must ignore unknown fields.** State it in the documentation, because a client that rejects unrecognised fields makes every future addition a breaking change. This is one of the few things you can ask consumers to do that materially expands your freedom.

**Never reuse a name for a different meaning.** Changing \`total\` from "excluding tax" to "including tax" is a breaking change with no error and no signal. Silent semantic changes are the worst category of break, because nothing fails — the numbers are just wrong.

**Expose the minimum.** Every field is a commitment. A field you expose because it happened to be in the object is a field you support forever. This is the discipline that most APIs lack, and it is the cheapest one to apply because it is a decision not to act.

## The contract must be machine-readable

Documentation drifts from behaviour, silently and always. A machine-readable schema — OpenAPI for REST, a \`.proto\` for gRPC, a typed schema for GraphQL — changes what is possible:

- **Generated clients**, so consumers do not hand-write request construction.
- **Request and response validation** at the boundary, from the same source as the documentation.
- **Contract tests** in CI, so a change that breaks the schema fails the build instead of a consumer.
- **Diffable versions**, so "is this a breaking change?" becomes a tool question rather than a judgement call.

That last one is the real prize. Once the contract is a file, breaking-change detection is automatable, and the most expensive class of mistake becomes a red build.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'change-cost',
      title: 'What is cheap to change, and what is permanent',
      caption:
        'Note where the boundary falls. Everything above it is inside your control and can be rewritten freely; everything below it lives in code you cannot modify. Design attention should be inversely proportional to how easily something can be undone.',
      code: `flowchart TB
    subgraph CHEAP["Cheap — entirely yours to change"]
      C1[Class and module structure]
      C2[Database schema, with a migration]
      C3[Which service handles a request]
      C4[Adding a field to a response]
      C5[Adding a new endpoint]
    end

    BOUNDARY["── the API contract ──"]

    subgraph EXPENSIVE["Permanent — lives in consumers' code"]
      E1[Resource names and URL structure]
      E2[Identifier format and identity scope]
      E3[Field names and their meaning]
      E4[Enumeration values clients branch on]
      E5[Error codes and error shape]
      E6[Whether a field may be absent]
    end

    CHEAP --> BOUNDARY --> EXPENSIVE

    style CHEAP fill:#17272a,stroke:#35897e
    style EXPENSIVE fill:#2a1d1d,stroke:#b8383b`,
    },
    {
      kind: 'flow',
      id: 'contract-pipeline',
      title: 'How a contract stops being prose',
      caption:
        'Step through it. The single decision that matters is making the schema the source of truth rather than a description of code — everything to the right of it is only possible once that is true.',
      nodes: [
        { id: 'schema', label: 'Schema file', kind: 'store', x: 0, y: 120, detail: 'OpenAPI, .proto or a typed GraphQL schema, committed and reviewed like code. The source of truth, not a description generated after the fact.' },
        { id: 'docs', label: 'Documentation', kind: 'note', x: 220, y: 20, detail: 'Generated from the schema, so it cannot drift. Hand-written docs describe what someone believed to be true when they wrote them.' },
        { id: 'client', label: 'Generated clients', kind: 'service', x: 220, y: 130, detail: 'Consumers stop hand-writing request construction and response parsing, which removes an entire class of integration bug.' },
        { id: 'valid', label: 'Boundary validation', kind: 'service', x: 220, y: 240, detail: 'Requests validated against the same schema that documents them. A malformed request is rejected with a per-field error before touching business logic.' },
        { id: 'diff', label: 'Breaking-change check', kind: 'service', x: 450, y: 130, detail: 'Diff the schema against the previous version in CI. Removing a field, narrowing a type or dropping an enum value fails the build instead of a consumer.' },
        { id: 'ctest', label: 'Contract tests', kind: 'service', x: 450, y: 250, detail: 'Assert that the implementation actually satisfies the schema, so the contract describes behaviour rather than intention.' },
        { id: 'consumer', label: 'Consumers', kind: 'client', x: 680, y: 190, detail: 'Code you cannot modify. Everything to the left exists to keep a change from reaching here as a surprise.' },
      ],
      edges: [
        { id: 'k1', source: 'schema', target: 'docs', kind: 'control' },
        { id: 'k2', source: 'schema', target: 'client', kind: 'control' },
        { id: 'k3', source: 'schema', target: 'valid', kind: 'control' },
        { id: 'k4', source: 'schema', target: 'diff', kind: 'control' },
        { id: 'k5', source: 'schema', target: 'ctest', kind: 'control' },
        { id: 'k6', source: 'client', target: 'consumer', kind: 'sync' },
        { id: 'k7', source: 'docs', target: 'consumer', kind: 'control' },
      ],
      steps: [
        {
          id: 'g1',
          title: 'The schema is the source of truth, not a byproduct',
          description:
            'If the schema is generated from code, it documents whatever the code currently does, including the accident you shipped last week. If the code is validated against the schema, the schema is a decision.',
          nodes: ['schema'],
          edges: [],
        },
        {
          id: 'g2',
          title: 'Three things fall out immediately',
          description:
            'Documentation that cannot drift, clients consumers do not hand-write, and validation at the boundary from the same definition. Each removes a category of integration failure rather than mitigating it.',
          nodes: ['schema', 'docs', 'client', 'valid'],
          edges: ['k1', 'k2', 'k3'],
        },
        {
          id: 'g3',
          title: 'And the one that matters most',
          description:
            'Once the contract is a file, "is this breaking?" is a diff rather than a judgement. Removing a field or narrowing a type becomes a failing build — which converts the most expensive class of mistake into the cheapest kind of feedback.',
          nodes: ['schema', 'diff', 'ctest'],
          edges: ['k4', 'k5'],
        },
        {
          id: 'g4',
          title: 'None of this reaches the consumer, and that is the point',
          description:
            'Everything upstream exists so that the only changes consumers ever see are additive. The measure of success is that they never have to do anything.',
          nodes: ['client', 'docs', 'consumer'],
          edges: ['k6', 'k7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: ['Google Cloud APIs'],
    body: `Google's API design guide is worth studying less for its specific rules than for what it reveals about designing at a scale where mistakes cannot be recalled.

Three decisions in it are load-bearing:

**Standard methods with a fixed vocabulary.** \`List\`, \`Get\`, \`Create\`, \`Update\`, \`Delete\` have defined names, defined HTTP mappings and defined semantics across every Google API. The benefit is not tidiness — it is that a developer who has integrated one API has already learned the shape of the next hundred. Consistency across a large surface is a feature that compounds, and it is only achievable by deciding the vocabulary before the APIs exist.

**Custom methods are explicitly permitted.** The guide does not pretend everything is CRUD. Genuine actions get \`POST /v1/orders/42:cancel\`, with the colon syntax marking them as deliberate rather than accidental. This is the mature position: resource orientation as a strong default, with an escape hatch that is visibly an escape hatch.

**A single error model, specified once.** A defined structure with a stable status enumeration means every client library handles failures uniformly, and a new API does not invent a new error shape. Because error format is part of the contract, specifying it centrally is the difference between one decision and a hundred inconsistent ones.

The mechanism underneath all three is that the contract is machine-readable. Service definitions carry annotations describing the HTTP mapping, from which the REST surface, the client libraries and the documentation are all generated. Consistency is enforced by tooling rather than by review, which is the only way it survives a large organisation.

Two transferable lessons:

**Decide the vocabulary before you need it.** Standard method names, error shape, pagination style, timestamp format and identifier conventions are cheap to decide once and impossible to retrofit across dozens of APIs. Most teams discover this after their fifth service has invented its fifth pagination scheme.

**Make consistency mechanical.** Anything enforced by code review drifts, because reviewers are inconsistent and busy. Anything enforced by a linter on the schema file, or by generation from a single definition, does not.`,
  },

  tradeoffs: {
    intro:
      'The core decision is how tightly the API mirrors your internal model. Rows run from most decoupled to most coupled, and the right answer depends on who your consumers are.',
    rows: [
      {
        option: 'Expose the internal model directly',
        whenItWins:
          'Internal APIs with one or two consumers you deploy, or a prototype where the model is still moving. Least translation work and no duplicate types.',
        whenItLoses:
          'The moment a consumer you cannot change depends on it — your database schema is now a public contract.',
        cost:
          'Every internal refactor becomes a breaking change, and you leak architecture into names consumers hard-code.',
      },
      {
        option: 'A deliberate resource model with an explicit translation layer',
        whenItWins:
          'Public APIs and anything long-lived. Internal refactors stay internal, and the vocabulary is domain language rather than implementation language.',
        whenItLoses:
          'Small internal services where the translation is more code than the endpoint.',
        cost:
          'Duplicate types and mapping code, plus the discipline to keep the boundary from being bypassed under deadline pressure.',
      },
      {
        option: 'Contract-first: schema written before implementation',
        whenItWins:
          'Multiple teams or organisations integrating in parallel, and any API where breaking-change detection needs to be automated.',
        whenItLoses:
          'Exploratory work where the domain is not understood yet — you will design a contract for the wrong model.',
        cost:
          'Slower to start, and a schema that is one more artefact to keep honest — which only works if the implementation is validated against it.',
      },
      {
        option: 'Code-first: generate the schema from implementation types',
        whenItWins:
          'Small teams shipping quickly, where documentation drift is the main problem and consumers are internal.',
        whenItLoses:
          'When you need the contract to be a decision. A generated schema documents whatever the code happens to do, including yesterday\'s accident.',
        cost:
          'Refactors silently change the public contract, and breaking-change detection becomes advisory rather than authoritative.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"I would expose our database entities directly as the API — it saves writing mapping code."',
      whyWeak:
        'It makes the database schema a public contract. Every future migration — renaming a column, splitting a table, changing a nullable field — becomes a breaking change for consumers you cannot redeploy. The mapping code you saved is a fraction of the cost of a frozen schema.',
      strongAnswer:
        '"I would model resources in domain language and map to storage explicitly. The mapping is a small, boring layer, and what it buys is that internal refactors stay internal. For a genuinely internal service with two callers I would skip it and say so — the cost only appears when consumers become hard to change."',
    },
    {
      weakAnswer: '"Order ids are `ORD-2026-004471` so support staff can read them."',
      whyWeak:
        'That format is now a permanent commitment: to the prefix, to the year, to the digit count, and to sequential numbering that lets anyone measure your order rate by placing two orders an hour apart. Consumers will parse it, and someone will regex it.',
      strongAnswer:
        '"The identifier is opaque — `ord_7f3a...` — and there is a separate human-readable `reference` field for support conversations. That keeps the id free of commitments while still giving staff something to read, and I can change the reference format without breaking anyone."',
    },
    {
      weakAnswer: '"We document that `status` can be `pending`, `paid` or `shipped`. Adding a value later is just a docs update."',
      whyWeak:
        'Consumers have written exhaustive switch statements over those three values, mostly without a default branch. Adding a fourth breaks them at runtime, in production, in code you cannot patch. Documentation does not make a change safe; it only makes it defensible after the fact.',
      strongAnswer:
        '"I would document the set as open and require clients to handle unknown values, ideally with a documented fallback behaviour. If that is not acceptable, then a new status is a versioned change. Either way the decision has to be made before the first release, because after it the consumers exist."',
    },
    {
      weakAnswer: '"We changed `total` to include tax and updated the documentation."',
      whyWeak:
        'This is the worst category of breaking change: nothing errors, no schema check fails, and every consumer\'s arithmetic is silently wrong. Financial reconciliation breaks weeks later with no signal pointing at the cause.',
      strongAnswer:
        '"Reusing a field name for a different meaning is a silent break, so I would add `totalIncludingTax` alongside the existing field and deprecate the old one on a published timeline. Adding is safe; redefining is not, precisely because nothing fails."',
    },
    {
      weakAnswer: '"The OpenAPI spec is generated from our controller annotations, so it is always accurate."',
      whyWeak:
        'It accurately describes whatever the code does, including the field somebody accidentally exposed and the type that changed during a refactor. A generated schema cannot tell you that a change is breaking, because it has no opinion about what the contract should be — it only reports what it currently is.',
      strongAnswer:
        '"Generation stops documentation drifting, which is worth having. But if I want breaking-change detection I need the schema to be the decision and the implementation validated against it — then removing a field or narrowing a type fails CI. With code-first, that check is advisory at best because the baseline moves with the code."',
    },
  ],

  flashcards: [
    {
      id: 'fc-contract-1',
      front: 'What makes API design different from ordinary code design?',
      back: 'The implementation is yours to rewrite; the contract lives in code you cannot modify. Modelling mistakes are permanent, internal refactors are not — so design attention should be inversely proportional to reversibility.',
      topic: 'api-contracts',
    },
    {
      id: 'fc-contract-2',
      front: 'What is the test for whether a resource name is a domain name or an implementation detail?',
      back: 'Would it still make sense after rewriting the whole backend in a different language with a different architecture? And would a domain expert use that word?',
      topic: 'resource-modeling',
    },
    {
      id: 'fc-contract-3',
      front: 'Why prefer opaque identifiers over meaningful ones?',
      back: 'A meaningful format commits you to it permanently and consumers will parse it. Sequential ids additionally leak volume. Put the human-readable reference in a separate field where it can be reformatted.',
      topic: 'resource-modeling',
    },
    {
      id: 'fc-contract-4',
      front: 'How should money be represented in an API, and why?',
      back: 'An integer of minor units plus an explicit currency. Floats cannot represent decimal fractions exactly, and a currency-less amount is meaningless outside one market.',
      topic: 'api-design',
    },
    {
      id: 'fc-contract-5',
      front: 'Why is adding an enumeration value a breaking change?',
      back: 'Consumers write exhaustive switches over the documented set, usually without a default branch. The set being open must be decided and documented before the first release.',
      topic: 'api-contracts',
    },
    {
      id: 'fc-contract-6',
      front: 'What are the load-bearing parts of an error response?',
      back: 'A stable machine-readable code clients branch on, a human message you may reword, per-field detail for validation failures, and a request identifier so support can find the exact request.',
      topic: 'api-design',
    },
    {
      id: 'fc-contract-7',
      front: 'Which category of breaking change is the most dangerous, and why?',
      back: 'A silent semantic change — reusing a field name for a different meaning. Nothing errors, no schema check fails, and every consumer is quietly wrong.',
      topic: 'api-contracts',
    },
    {
      id: 'fc-contract-8',
      front: 'What is the single most valuable consequence of a machine-readable contract?',
      back: 'Breaking-change detection becomes a diff in CI rather than a judgement call, so the most expensive class of mistake turns into a failing build.',
      topic: 'validation',
    },
    {
      id: 'fc-contract-9',
      front: 'What is the difference between contract-first and code-first schemas?',
      back: 'Contract-first makes the schema a decision the implementation is validated against, enabling authoritative breaking-change checks. Code-first documents whatever the code currently does, including accidents, so the baseline moves with the code.',
      topic: 'validation',
    },
    {
      id: 'fc-contract-10',
      front: 'How do you model a genuine action without inventing a fake noun?',
      back: 'A custom method such as `POST /orders/{id}:cancel`, or a state sub-resource when it really is a transition. Inventing `/cancellations` is ceremony that models nothing.',
      topic: 'resource-modeling',
    },
    {
      id: 'fc-contract-11',
      front: 'Why does "expose the minimum" matter more than it sounds?',
      back: 'Every field is a permanent commitment, so a field exposed because it happened to be on the object is supported forever. It is the cheapest discipline available because it is a decision not to act.',
      topic: 'coupling',
    },
  ],

  quiz: [
    {
      id: 'q-contract-1',
      kind: 'scenario',
      prompt:
        'A team exposes their ORM entities directly as JSON. Two years later they want to split a `users` table into `users` and `user_profiles`. What is the actual cost?',
      options: [
        { id: 'a', label: 'A breaking API change for every consumer, because the storage schema was the published contract' },
        { id: 'b', label: 'A database migration only — the API layer will adapt automatically' },
        { id: 'c', label: 'Nothing, provided the ORM is reconfigured correctly' },
        { id: 'd', label: 'A performance regression from the extra join' },
      ],
      correct: ['a'],
      explanation:
        'Exposing entities directly makes the storage schema public. Field names, nesting and nullability all became commitments, so a split that would have been an internal migration is now a coordinated change across every consumer. A thin explicit mapping layer is what keeps a refactor internal.',
      difficulty: 'core',
      topic: 'coupling',
    },
    {
      id: 'q-contract-2',
      kind: 'scenario',
      prompt:
        'Six months after launch you add a `refunded` value to an existing `status` enumeration. Several partner integrations start throwing errors. What went wrong, and when?',
      options: [
        { id: 'a', label: 'The enumeration was published as closed, so clients wrote exhaustive branches — the mistake was at design time, not at the addition' },
        { id: 'b', label: 'The addition should have been announced with more notice' },
        { id: 'c', label: 'The new value should have been added at the start of the list, not the end' },
        { id: 'd', label: 'The partners should have validated against the schema' },
      ],
      correct: ['a'],
      explanation:
        'The failure was baked in at design time by not deciding whether the set was open. Once clients believe it is closed, they write exhaustive handling and any addition breaks them. Notice periods help socially and do not make the change safe. Position in the list is irrelevant.',
      difficulty: 'core',
      topic: 'api-contracts',
    },
    {
      id: 'q-contract-3',
      kind: 'single',
      prompt: 'Which of these changes is safe for existing consumers?',
      options: [
        { id: 'a', label: 'Adding a new optional field to a response' },
        { id: 'b', label: 'Making a previously required request field optional and changing its default' },
        { id: 'c', label: 'Renaming a field and keeping the old name as an alias for one release' },
        { id: 'd', label: 'Changing a field from a string to an integer where all current values are numeric' },
      ],
      correct: ['a'],
      explanation:
        'Only addition is safe, and only if consumers are documented to ignore unknown fields. Changing a default changes behaviour for callers who omitted the field. A rename with a temporary alias still breaks whoever has not migrated when the alias goes. Changing a type breaks strict parsers even when the values look compatible.',
      difficulty: 'intro',
      topic: 'api-contracts',
    },
    {
      id: 'q-contract-4',
      kind: 'scenario',
      prompt:
        'A payments API returns `{"total": 24.5, "currency": "GBP"}`. A reconciliation job disagrees with the ledger by small amounts across thousands of orders. Most likely cause?',
      options: [
        { id: 'a', label: 'Binary floating point cannot represent decimal fractions exactly, so amounts accumulate rounding error' },
        { id: 'b', label: 'The currency field is being ignored by the consumer' },
        { id: 'c', label: 'Timezone differences in the reconciliation window' },
        { id: 'd', label: 'The ledger is using a different exchange rate' },
      ],
      correct: ['a'],
      explanation:
        'A JSON number is typically parsed as a double, and values like 24.5 are fine while 0.1 and 24.35 are not exactly representable. Summing thousands of them accumulates error. Money should be an integer of minor units (2450) plus a currency — which is why the representation decision belongs in the contract, not in each consumer.',
      difficulty: 'advanced',
      topic: 'api-design',
    },
    {
      id: 'q-contract-5',
      kind: 'scenario',
      prompt:
        'Your OpenAPI spec is generated from controller annotations. A refactor changes a response DTO and the spec updates automatically. CI passes. What did you lose?',
      options: [
        { id: 'a', label: 'Any authoritative breaking-change check, because the baseline moved with the code' },
        { id: 'b', label: 'Nothing — the spec is now more accurate than before' },
        { id: 'c', label: 'The ability to generate client libraries' },
        { id: 'd', label: 'Request validation at the boundary' },
      ],
      correct: ['a'],
      explanation:
        'A generated spec always agrees with the code, which is exactly why it cannot detect that the code broke the contract. Breaking-change detection requires a baseline that does not move — the schema as a reviewed decision, with the implementation validated against it. Generation still gives you accurate docs and clients; what it cannot give you is an opinion.',
      difficulty: 'advanced',
      topic: 'validation',
    },
    {
      id: 'q-contract-6',
      kind: 'multi',
      prompt:
        'Which of these belong in an error response contract as stable, machine-consumable values? Select all that apply.',
      options: [
        { id: 'a', label: 'A code identifying the error class, which clients branch on' },
        { id: 'b', label: 'A per-field list of validation failures with field paths and codes' },
        { id: 'c', label: 'A request identifier for support and log correlation' },
        { id: 'd', label: 'The human-readable message text' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'Codes, per-field details and the request identifier are all consumed programmatically and must be stable. The human message is deliberately *not* stable — you need to be free to reword and localise it, and a client branching on message text is a client you have accidentally coupled to your copywriting.',
      difficulty: 'core',
      topic: 'api-design',
    },
  ],

  exercises: [
    {
      id: 'ex-contract-1',
      kind: 'debug',
      title: 'Review an API before it ships',
      estimatedMinutes: 22,
      prompt: `You are reviewing this proposed public API for a ticketing platform. It has 300 partner integrations expected in year one.

\`\`\`
POST /api/v1/createBookingAndChargeCard
  { "eventId": 88, "seatIds": [4501, 4502], "cardToken": "tok_x",
    "totalPrice": 89.50, "userEmail": "a@example.com" }
  → 200 { "bookingRef": "BK-2026-0001234", "status": "CONFIRMED",
          "seats": [...], "chargedAmount": 89.50 }
  → 500 { "error": "Payment failed" }

GET /api/v1/getBookingsByUser?email=a@example.com
POST /api/v1/cancelBooking  { "bookingRef": "BK-2026-0001234" }
\`\`\`

Produce a review. For each problem: name it, say whether it is expensive or cheap to fix after launch, and give the corrected design. Then state the two changes you would insist on before launch even if the team pushed back, and why those two.`,
      rubric: [
        'Identifies the compound operation as the most serious problem: no clean success or failure semantics when booking succeeds and payment fails.',
        'Identifies operation-named endpoints (createBookingAndChargeCard, getBookingsByUser) as leaking implementation and being permanent.',
        'Identifies float money in both request and response, and prescribes integer minor units plus currency.',
        'Identifies the client-supplied totalPrice as a trust problem — the server must compute price, never accept it.',
        'Identifies email as an identifier in the URL: it is mutable, personally identifying, and appears in logs and referrers.',
        'Identifies the meaningful bookingRef format as a permanent commitment, and the uppercase status as a closed enum with no openness policy.',
        'Identifies 500 with an unstructured error as unusable: no machine code, no request id, and the wrong status class for a declined payment.',
        'Names two pre-launch non-negotiables with reasoning tied to permanence or security, not to style.',
      ],
      modelAnswer: `**Problem 1 — the compound operation. Expensive.**

\`createBookingAndChargeCard\` does two things with independent failure modes. What is the response when the seats are held and the card is declined? Returning 500 makes the consumer retry, which either double-books or does nothing depending on internals nobody documented.

*Corrected:* separate the intent from the payment, and make the state observable.

\`\`\`
POST /bookings        → 201 { id, status: "pending_payment", expiresAt, amount }
POST /bookings/{id}/payments  → 201 { status: "captured" }  or 402 with a code
GET  /bookings/{id}   → current state
\`\`\`

The booking becomes a resource with a lifecycle, so a failed payment is a *state*, not an ambiguous error.

**Problem 2 — operation-named endpoints. Expensive.**

\`createBookingAndChargeCard\`, \`getBookingsByUser\`, \`cancelBooking\` are function names in URLs. They describe today's implementation and are permanent.

*Corrected:* \`POST /bookings\`, \`GET /bookings?customerId=...\`, \`POST /bookings/{id}:cancel\`. The cancel case is a genuine action, so a custom method is honest — better than inventing \`/cancellations\`.

**Problem 3 — float money. Expensive.**

\`89.50\` as a JSON number is a double. Summing thousands of these across reconciliation accumulates error, and the field has no currency at all.

*Corrected:* \`{ "amount": 8950, "currency": "GBP" }\`. Expensive to fix later because the field name and type are in every consumer's code.

**Problem 4 — client-supplied price. Expensive, and a security bug.**

\`totalPrice\` in the request means the client tells you what to charge. A malicious partner sends \`0.01\`.

*Corrected:* the server computes price from event and seats and returns it. If you want the client to confirm the price it displayed, accept an \`expectedAmount\` and reject on mismatch with a specific code — that is a consistency check, not the source of truth.

**Problem 5 — email as identifier. Expensive.**

Emails change, are personally identifying, and appear in access logs, referrer headers and analytics. Once partners key their integrations on email, changing to a stable id is a coordinated migration.

*Corrected:* \`GET /bookings?customerId=cus_7f3a\`. Keep email as a field.

**Problem 6 — meaningful reference and closed-looking enum. Expensive.**

\`BK-2026-0001234\` commits you to the prefix, the year and the digit count, and is sequential so it leaks booking volume. \`CONFIRMED\` in uppercase looks like a fixed set, and no openness policy is stated.

*Corrected:* \`id: "bkg_7f3a..."\` opaque, plus a separate \`reference\` field for humans. Lowercase snake-case status values, documented as an open set with a required client fallback.

**Problem 7 — the error response. Cheap-ish to fix, if fixed early.**

\`500 { "error": "Payment failed" }\` has three defects: 500 means "we broke", but a declined card is the request failing, not the server; there is no stable code to branch on; and there is no request identifier for support.

*Corrected:*

\`\`\`
402 { "type": "card_declined",
      "title": "The card was declined",
      "detail": "Issuer declined: insufficient funds",
      "instance": "req_01HXYZ" }
\`\`\`

I call this cheap-ish because adding fields is additive — but the status code and the \`type\` values are permanent once partners branch on them, so it must be right at launch.

**The two I would insist on before launch**

**1. Remove \`totalPrice\` from the request.** This is not a design preference, it is a vulnerability. Accepting the amount to charge from the caller means any partner — or anyone who obtains a partner key — can buy tickets for a penny. It cannot be fixed later without breaking every integration, and it cannot be mitigated by validation because there is nothing to validate against except the price you should have computed anyway.

**2. Split the compound operation.** Everything else on this list is a rename or an added field, and those are survivable with a v2. The compound endpoint has no correct behaviour when the two halves disagree, which means every partner will build a different workaround around the ambiguity — and those workarounds become the real contract. Once 300 integrations have each guessed differently about what a 500 means, no amount of versioning recovers it.

Everything else I would push for and would trade if I had to. Those two I would block on: one is a security hole, and the other is unfixable rather than merely expensive.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-contract-1',
      level: 'basic',
      question: 'What makes a good resource model?',
      guidance:
        'Domain nouns rather than implementation nouns, stable identifiers, and representations that describe state. A strong answer offers a test — would the name survive a full rewrite, would a domain expert use the word — rather than a list of adjectives.',
    },
    {
      id: 'iq-contract-2',
      level: 'basic',
      question: 'Which changes to an API are safe, and which are breaking?',
      guidance:
        'Additive is safe if consumers ignore unknown fields; removing, renaming, narrowing types, changing defaults and adding enum values are breaking. A strong answer singles out silent semantic changes as the worst case because nothing fails.',
    },
    {
      id: 'iq-contract-3',
      level: 'intermediate',
      question: 'How would you represent money and timestamps in an API, and why?',
      guidance:
        'Integer minor units plus an explicit currency; ISO 8601 with an offset. The reasoning matters more than the answer: floats cannot represent decimal fractions, and both zone-less timestamps and bare epoch integers are ambiguities that different consumers resolve differently and silently.',
    },
    {
      id: 'iq-contract-4',
      level: 'intermediate',
      question: 'Should the API mirror your internal model?',
      guidance:
        'Look for the consumer relationship as the deciding factor. Public API: no, because storage becomes a contract and refactors become breaking changes. Internal service with two owned callers: probably yes, and saying so shows judgement rather than dogma.',
    },
    {
      id: 'iq-contract-5',
      level: 'advanced',
      question: 'How do you prevent a breaking change from reaching a consumer?',
      guidance:
        'A machine-readable contract as the source of truth, schema diffing in CI to classify changes, contract tests asserting the implementation satisfies it, and validation at the boundary. Excellent answers note that code-first generation cannot do this, because the baseline moves with the code.',
    },
    {
      id: 'iq-contract-6',
      level: 'advanced',
      question: 'You inherit an API with 300 integrations and a badly modelled resource. What do you do?',
      guidance:
        'Accept that the existing surface is permanent. Add a better-modelled surface alongside it, back both with the same domain layer, and deprecate on a published timeline with usage telemetry to know who is left. Strong answers refuse to propose a coordinated migration of 300 external teams, and note that the old surface may simply never be removed.',
    },
    {
      id: 'iq-contract-7',
      level: 'followup',
      question: 'You said consumers must ignore unknown fields. What if they do not?',
      guidance:
        'Then every addition is a breaking change and the API is effectively frozen. Mitigations: state it prominently, ship client libraries that behave correctly, and test against real consumers before wide release. A strong answer notes this is one of very few things you can ask of consumers that materially expands your future freedom, which is why it belongs in the first version of the docs.',
    },
    {
      id: 'iq-contract-8',
      level: 'followup',
      question: 'Is exposing an internal service\'s model ever fine?',
      guidance:
        'Yes — one or two consumers you deploy, where a shared schema breaking the build is a benefit and the mapping layer would be more code than the endpoint. A strong answer names the trigger for changing course: a consumer appears that you cannot redeploy on your schedule.',
    },
  ],

  activeLearning: [
    {
      id: 'al-contract-1',
      kind: 'what-changes-if',
      prompt:
        'This lesson optimised for consumers you cannot change. Now invert it: the API has exactly one consumer, a web app in the same repository, deployed together in the same pipeline. Which rules stop applying, which still apply, and what new mistake becomes likely?',
      discussion: `Most of the expensive/permanent framing dissolves, and a different failure mode replaces it.

**Rules that stop applying:**

*Additive-only changes.* You can rename a field, remove one, or restructure a response freely, because the only consumer changes in the same commit. Deprecation timelines are pure overhead.

*Opaque identifiers for evolvability reasons.* You can change the id format, since nothing external stores them. Security reasons for opacity may still apply if ids appear in URLs users can share.

*A translation layer between storage and API.* If the internal model changes, both sides change together. Mapping code here is often genuinely more code than it saves, and saying so is judgement rather than laziness.

*Machine-readable contracts for breaking-change detection.* The type checker already does this — a shared TypeScript type between server and client is a stronger contract than OpenAPI, checked at compile time, with zero drift.

**Rules that still apply, and why:**

*Money as integer minor units.* Floating point does not become accurate because the consumer is nearby.

*Timestamps with explicit offsets.* Ambiguity is ambiguity.

*Server computes prices and permissions.* Never trust the client, even your own client. The browser is not a trusted environment regardless of who wrote the code running in it — a user can call the endpoint directly.

*Errors with stable codes.* Not for consumer stability, but because branching on message strings is fragile in your own code too, and because support still needs a request id.

*Domain-language naming.* Not for contract reasons but for comprehension. Names that describe the current implementation are confusing to read six months later regardless of who reads them.

**The new mistake that becomes likely: the boundary quietly disappears.**

When client and server ship together, it is tempting to let the API become whatever the current screen needs — an endpoint per view, returning exactly the fields that view renders, with names taken from the UI rather than the domain. It works, and it is fast.

Then a second consumer appears. A mobile app, a partner integration, an internal reporting tool. And the API turns out to be a set of screen-shaped endpoints for screens that no longer exist, named after UI components, with no coherent resource model to build on. The refactor is now large, because there was never a model to extend — only accumulated view requirements.

**The practical position.** Skip the ceremony: no deprecation policy, no OpenAPI, no translation layer, no additive-only discipline. Keep the *modelling*: name things in domain language, keep resources coherent, and be able to answer "what are the nouns" without referring to a screen. That costs almost nothing while the coupling is cheap, and it is the entire difference between "we added a second client in a week" and "we spent a quarter untangling it".

**The transferable point.** Coupling being cheap is a licence to skip process, not a licence to skip thinking. The rules in this lesson are mechanisms protecting an underlying property — a coherent domain model — and when the mechanisms are unnecessary the property still is not.`,
    },
    {
      id: 'al-contract-2',
      kind: 'modify-architecture',
      prompt:
        'An API has shipped with `GET /users/{email}` as the canonical way to fetch a user, and 40 partners depend on it. Legal now requires that email addresses must not appear in URLs, because URLs are logged, appear in referrer headers, and are retained by intermediaries. Design the transition. You may not break the 40 partners.',
      discussion: `The constraint that makes this interesting: you must remove something from a permanent contract, and "we cannot break partners" and "email must not be in URLs" are in direct conflict. Something has to give, and the design is about *what* and *when*.

**Step 1 — add the correct surface immediately.**

\`GET /users/{id}\` with an opaque identifier, plus \`GET /users?email={email}\` — note the email is now a query parameter, which is *also* logged, so this is a stepping stone rather than the destination. Better: \`POST /users:lookup\` with the email in the body, which keeps it out of URLs, logs and referrer headers entirely. That is the honest answer to the legal requirement, even though a POST for a read is otherwise a smell — this is a case where the security requirement outranks the cacheability convention, and saying that trade-off out loud is the point.

Every response now includes the opaque \`id\`, so partners can start storing it without any prompting.

**Step 2 — reduce the exposure of the old path without removing it.**

This is the part people miss. You cannot remove the endpoint yet, but you can shrink the blast radius today:

- Stop logging the full path for that route; log a hash or a redacted form. Most of the legal exposure is in *your* logs, and that is entirely within your control.
- Strip the referrer on responses from that route with a \`Referrer-Policy\` header.
- Confirm whether intermediaries under your control (CDN, gateway, WAF) retain path data, and configure them not to.

That may satisfy a large part of the requirement in days, without touching a single partner. Distinguishing "the data must stop existing in our systems" from "the data must stop being transmitted" is worth clarifying with legal before designing anything, because the two have very different costs.

**Step 3 — measure who is actually affected.**

Instrument the old endpoint per partner. Almost certainly the distribution is skewed: a handful of partners account for most calls, and a long tail called it twice in 2024. That changes the migration from "coordinate 40 partners" to "personally help 5 and email 35".

**Step 4 — migrate with deprecation signalling, not announcements.**

Return \`Deprecation\` and \`Sunset\` headers on the old route, and a \`Link\` header pointing to the replacement. Publish a date. Then follow up individually with the partners whose traffic has not moved, using the telemetry rather than hope.

**Step 5 — accept a possible outcome: it never goes away.**

If two partners cannot migrate — a shipped embedded device, a vendor who has gone out of business — the endpoint may have to live indefinitely behind a per-partner allowlist with hardened logging. That is not a failure; it is what "permanent contract" means. Designing the transition to *tolerate* that outcome, rather than depending on complete migration, is what makes it a plan rather than a wish.

**The transferable structure.** When you must remove something from a permanent contract:

1. Add the replacement and start emitting the new identifier immediately, so migration can begin before anyone is asked.
2. Reduce the harm now, in the parts of the system you control, independently of the migration.
3. Measure who is actually affected before treating it as a coordination problem.
4. Signal deprecation in-band, where a machine can see it, not only in a blog post.
5. Design for the tail never migrating.

Step 2 is the one that separates an engineer from a project manager: most of the exposure was in your own logs, and you did not need permission from 40 partners to fix that part.`,
    },
  ],

  revision: {
    bullets: [
      'The implementation is yours to rewrite; the contract lives in code you cannot modify. Design attention should be inversely proportional to reversibility.',
      'Model domain nouns, not implementation nouns. Test: would the name survive a full rewrite, and would a domain expert use it?',
      'Identifiers are the hardest thing to change because consumers store them. Prefer opaque; keep human-readable references in a separate field.',
      'Sequential ids leak volume; meaningful formats become permanent commitments that consumers will parse.',
      'Represent state, not transitions. Money as integer minor units plus currency. Timestamps as ISO 8601 with an offset.',
      'Enumerations are a contract: decide before launch whether the set is open, because afterwards the consumers exist.',
      'Genuine actions get a custom method (`POST /orders/{id}:cancel`), not an invented noun.',
      'Errors are part of the contract: stable machine code, per-field detail, request id. The human message stays changeable.',
      'Additive changes are safe; removing, renaming, narrowing and changing defaults are not.',
      'Silent semantic changes — reusing a field name for a new meaning — are the worst break, because nothing fails.',
      'Document that consumers must ignore unknown fields. It is one of the few asks that materially expands your freedom.',
      'Expose the minimum: every field is permanent, and restraint is the cheapest discipline available.',
      'A machine-readable contract buys generated clients, boundary validation, generated docs — and above all breaking-change detection in CI.',
      'Contract-first makes the schema a decision; code-first documents whatever the code does, so its breaking-change check is advisory.',
      'Decide the shared vocabulary — pagination, errors, timestamps, ids — once, and enforce it mechanically rather than by review.',
      'With one owned consumer, skip the process and keep the modelling: coupling being cheap licenses skipping ceremony, not skipping thought.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'The published promise about a system\'s vocabulary — resources, identifiers, field names and meanings, error shapes — made to code the publisher cannot modify.',
    whyItExists:
      'Implementations are rewritten repeatedly; the interface between systems has to survive that. A contract exists so the two can change on different schedules.',
    whenToUse: [
      'Any API with consumers you cannot redeploy: public, partner, or a shipped mobile version.',
      'Any interface expected to outlive the current implementation.',
      'Wherever breaking-change detection needs to be automatic rather than a judgement call.',
    ],
    whenNotToUse: [
      'Full contract ceremony for an internal service with one or two consumers you deploy — the mapping layer can cost more than it saves.',
      'Exploratory work where the domain is not understood; you will freeze the wrong model.',
    ],
    alternatives: [
      'A shared type definition compiled into both sides, when client and server ship together — stronger than a schema and checked at build time.',
      'gRPC or Protobuf, where field numbers make evolution a wire-format property rather than a discipline.',
      'GraphQL, which moves shape selection to the client and replaces contract breakage with query-cost problems.',
    ],
    tradeoffs: [
      'Exposing the internal model saves mapping code and makes every refactor a breaking change.',
      'Contract-first buys authoritative breaking-change detection and costs speed at the start.',
      'Code-first buys accurate documentation and gives up an opinion about what the contract should be.',
      'Meaningful identifiers buy human legibility and commit you to a format permanently.',
    ],
    failureModes: [
      'Storage schema published as the API, so migrations become coordinated external changes.',
      'A new enum value breaking exhaustive client branches at runtime.',
      'Silent semantic change: same field name, different meaning, no error anywhere.',
      'Float money accumulating rounding error across reconciliation.',
      'Client-supplied prices or permissions trusted by the server.',
      'Identifiers containing personal data, appearing in logs, referrers and intermediary retention.',
      'Documentation drifted from behaviour because it was prose rather than a checked artefact.',
    ],
    followUpQuestions: [
      'Which parts of this design are permanent, and which can you change next week?',
      'Would this resource name still make sense after a full rewrite?',
      'Is that enumeration open or closed, and where is that documented?',
      'What happens to consumers when you add a field? When you remove one?',
      'How would CI tell you that a change is breaking?',
      'Where does personal data appear in a URL, a log, or a referrer header?',
    ],
  },
});
