import type { Curriculum } from './schema';

/**
 * The machine-readable curriculum. `docs/CURRICULUM.md` is the prose version
 * and the two are kept in sync by `npm run content:validate`, which fails if a
 * slug appears in one and not the other.
 *
 * Ordering here is the global lesson order. Prerequisites live on each lesson
 * module (they form the dependency graph, which is a DAG over these slugs).
 */
export const curriculum: Curriculum = {
  targetWeeks: 14,
  phases: [
    {
      id: 'foundations',
      title: 'Foundations',
      weeks: '1–3',
      summary:
        'The network, the API contract and the data model. Everything later in the curriculum is a modification of one of these three.',
      outcome:
        'You can trace a request end to end, design an API contract that survives change, and reason about a schema and its indexes without hand-waving.',
      modules: [
        {
          id: 'networking',
          title: 'Networking',
          summary: 'What actually happens between a client and a server, and which hop each later component is inserted into.',
          lessons: [
            'f-request-lifecycle',
            'f-tcp-latency',
            'f-http-versions',
            'f-tls-https',
            'f-realtime-transports',
            'f-rpc-rest-grpc',
          ],
        },
        {
          id: 'apis',
          title: 'APIs',
          summary: 'An API is a compatibility promise made to code you do not control.',
          lessons: [
            'f-api-contracts',
            'f-pagination',
            'f-api-versioning',
            'f-api-errors',
            'f-idempotency',
            'f-auth',
          ],
        },
        {
          id: 'databases',
          title: 'Databases',
          summary: 'Modelling, indexing, transactions and the first step of scaling reads.',
          lessons: [
            'f-relational-modeling',
            'f-indexes',
            'f-transactions',
            'f-nosql-models',
            'f-denormalization',
            'f-replication-basics',
          ],
        },
      ],
    },
    {
      id: 'distributed',
      title: 'Backend & Distributed Systems',
      weeks: '4–6',
      summary:
        'The component vocabulary of system design, taught as answers to pressures rather than as a parts catalogue.',
      outcome:
        'Given a bottleneck you can name the component that relieves it, the cost it introduces, and the simpler thing you should try first.',
      modules: [
        {
          id: 'serving',
          title: 'Serving and caching',
          summary: 'Getting bytes to users cheaply, and what you give up each time you add a copy of the truth.',
          lessons: ['d-caching', 'd-redis', 'd-cdn', 'd-load-balancing', 'd-gateways-discovery'],
        },
        {
          id: 'data-at-scale',
          title: 'Data at scale',
          summary: 'Splitting data across machines, and what consistency costs once you have.',
          lessons: ['d-partitioning', 'd-consistent-hashing', 'd-cap-pacelc', 'd-consistency-models', 'd-consensus'],
        },
        {
          id: 'messaging',
          title: 'Asynchrony and messaging',
          summary: 'Decoupling producers from consumers, and the delivery guarantees you actually get.',
          lessons: ['d-queues-vs-logs', 'd-delivery-semantics', 'd-event-driven-outbox', 'd-rate-limiting'],
        },
        {
          id: 'resilience',
          title: 'Resilience and operations',
          summary: 'What happens when a dependency is slow, dead, or lying to you.',
          lessons: [
            'd-distributed-locks',
            'd-retries-timeouts',
            'd-backpressure',
            'd-failover-availability',
            'd-observability',
          ],
        },
      ],
    },
    {
      id: 'hld',
      title: 'High Level Design',
      weeks: '7–10',
      summary:
        'Deriving architectures under time pressure. Every design lesson walks the same nine-step loop until the loop is automatic.',
      outcome:
        'Given an unfamiliar system you can clarify, estimate, model, design, deep-dive, scale, fail and defend inside 45 minutes.',
      modules: [
        {
          id: 'method',
          title: 'The HLD method',
          summary: 'The loop itself, practised on systems small enough to see the whole loop at once.',
          lessons: ['h-framework', 'h-requirements', 'h-estimation'],
        },
        {
          id: 'core-designs',
          title: 'Core designs',
          summary: 'The systems whose deep dives recur everywhere else.',
          lessons: [
            'h-url-shortener',
            'h-rate-limiter',
            'h-notifications',
            'h-blob-storage',
            'h-google-drive',
            'h-whatsapp',
            'h-instagram-feed',
            'h-youtube',
          ],
        },
        {
          id: 'advanced-designs',
          title: 'Advanced designs',
          summary: 'Systems where the hard part is coordination, money, or geography.',
          lessons: [
            'h-media-streaming',
            'h-uber',
            'h-google-docs',
            'h-gmail',
            'h-ecommerce',
            'h-food-delivery',
            'h-payments',
          ],
        },
      ],
    },
    {
      id: 'lld',
      title: 'Low Level Design',
      weeks: '11–12',
      summary:
        'From a paragraph of requirements to classes, interfaces and working core logic — with patterns used only where they earn their place.',
      outcome:
        'You can turn an ambiguous machine-coding prompt into a testable object model and defend every boundary you drew.',
      modules: [
        {
          id: 'oo-foundations',
          title: 'Object-oriented foundations',
          summary: 'Finding objects from behaviour, and the principles that actually change your code.',
          lessons: ['l-object-design', 'l-solid', 'l-lld-framework', 'l-uml', 'l-patterns'],
        },
        {
          id: 'machine-coding',
          title: 'Machine coding',
          summary: 'The problems that appear again and again, each with a different hard part.',
          lessons: [
            'l-lru-cache',
            'l-rate-limiter-lld',
            'l-logger',
            'l-pubsub',
            'l-parking-lot',
            'l-splitwise',
            'l-bookmyshow',
            'l-elevator',
            'l-games',
          ],
        },
      ],
    },
    {
      id: 'ai',
      title: 'AI Agent & Workflow System Design',
      weeks: '13–14',
      summary:
        'Designing production systems around a non-deterministic, expensive, occasionally wrong component.',
      outcome:
        'You can design an LLM or agent system end to end and defend its retrieval, state, failure handling, cost ceiling and security model.',
      modules: [
        {
          id: 'llm-apps',
          title: 'LLM application architecture',
          summary: 'The request lifecycle, the cost/latency/quality triangle, and making model output safe to type.',
          lessons: ['a-llm-app-architecture', 'a-model-selection', 'a-structured-outputs'],
        },
        {
          id: 'retrieval',
          title: 'Retrieval',
          summary: 'RAG as an information-retrieval problem that happens to end in a language model.',
          lessons: ['a-embeddings', 'a-chunking-indexing', 'a-retrieval', 'a-rag-evaluation'],
        },
        {
          id: 'agents',
          title: 'Agents',
          summary: 'Loops, tools, state and the coordination costs of adding a second agent.',
          lessons: ['a-tool-calling', 'a-agent-loops', 'a-agent-memory', 'a-multi-agent'],
        },
        {
          id: 'workflows',
          title: 'Workflows, safety, evaluation',
          summary: 'Durability, approval gates, the untrusted-content attack surface, and how you know any of it works.',
          lessons: ['a-durable-execution', 'a-mcp', 'a-human-in-the-loop', 'a-ai-security', 'a-ai-evaluation'],
        },
        {
          id: 'ai-designs',
          title: 'AI system designs',
          summary: 'Four end-to-end designs that combine everything in this phase.',
          lessons: ['a-rag-assistant', 'a-support-agent', 'a-chatgpt-app', 'a-coding-agent'],
        },
      ],
    },
  ],
};

/** Global lesson order, derived from the curriculum. */
export const lessonOrder: string[] = curriculum.phases.flatMap((p) =>
  p.modules.flatMap((m) => m.lessons),
);

/** The three canonical reference lessons that define the quality bar. */
export const canonicalLessons = ['f-request-lifecycle', 'h-url-shortener', 'a-retrieval'] as const;

export function phaseOf(slug: string): string | undefined {
  for (const p of curriculum.phases) {
    for (const m of p.modules) if (m.lessons.includes(slug)) return p.id;
  }
  return undefined;
}

export function moduleOf(slug: string): string | undefined {
  for (const p of curriculum.phases) {
    for (const m of p.modules) if (m.lessons.includes(slug)) return m.id;
  }
  return undefined;
}
