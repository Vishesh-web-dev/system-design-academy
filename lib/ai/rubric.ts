import { z } from 'zod';

/**
 * Scoring criteria per interview mode.
 *
 * Criterion keys are curriculum topic slugs wherever they overlap, so an
 * interview score feeds the same mastery model as a quiz answer
 * (db/repo/interview.ts → interviewSignals).
 */

export type Mode = 'hld' | 'lld' | 'backend' | 'distributed' | 'ai' | 'boss';

export interface Criterion {
  key: string;
  label: string;
  max: number;
  /** What separates a strong answer from an adequate one on this axis. */
  description: string;
}

const HLD: Criterion[] = [
  {
    key: 'requirements',
    label: 'Requirements gathering',
    max: 10,
    description:
      'Separated functional from non-functional, asked the questions that change the architecture, and stated the scope they were designing to.',
  },
  {
    key: 'estimation',
    label: 'Capacity estimation',
    max: 10,
    description:
      'Derived QPS, storage and bandwidth from stated assumptions, out loud, and used the numbers to justify later decisions rather than abandoning them.',
  },
  {
    key: 'api-design',
    label: 'API design',
    max: 10,
    description:
      'Defined the small number of endpoints that matter, their shapes, and the failure and idempotency semantics of the write path.',
  },
  {
    key: 'data-modeling',
    label: 'Data modelling',
    max: 15,
    description:
      'Chose entities and a storage engine driven by access patterns, named the partition key and what it does to hot spots and cross-partition queries.',
  },
  {
    key: 'architecture',
    label: 'High-level architecture',
    max: 15,
    description:
      'Every component justified by a pressure in the requirements. No component present because it is fashionable. Critical request flows walked end to end.',
  },
  {
    key: 'scaling',
    label: 'Scaling and bottlenecks',
    max: 10,
    description:
      'Identified where the design breaks first at 10×, and changed the design rather than adding servers.',
  },
  {
    key: 'reliability',
    label: 'Failure handling and reliability',
    max: 10,
    description:
      'Named concrete failure modes, how each is detected, and how it is contained. Not "we add retries".',
  },
  {
    key: 'consistency',
    label: 'Consistency reasoning',
    max: 10,
    description:
      'Stated which operations need which guarantee and why, rather than applying one model to the whole system.',
  },
  {
    key: 'tradeoffs',
    label: 'Trade-off reasoning',
    max: 10,
    description:
      'Named alternatives, said what each costs, and defended the choice when pushed — including the option of doing the simpler thing.',
  },
];

const LLD: Criterion[] = [
  { key: 'requirements', label: 'Requirements clarification', max: 10, description: 'Pinned down behaviour and scope before naming a single class.' },
  { key: 'entities', label: 'Entity identification', max: 15, description: 'Found objects from behaviour rather than from nouns in the prompt; responsibilities are single and named.' },
  { key: 'interfaces', label: 'Interfaces and boundaries', max: 15, description: 'Abstractions sit where variation actually exists, not everywhere.' },
  { key: 'extensibility', label: 'Extensibility', max: 15, description: 'A named future change can be made without editing existing classes — demonstrated, not asserted.' },
  { key: 'concurrency', label: 'Concurrency and state', max: 10, description: 'Identified shared mutable state and how it is protected, including what happens under contention.' },
  { key: 'implementation', label: 'Core logic', max: 15, description: 'Wrote the hard part correctly, including the edge cases they identified themselves.' },
  { key: 'testability', label: 'Testability', max: 10, description: 'Dependencies such as the clock and randomness are injectable; the design can be tested without sleeping.' },
  { key: 'design-patterns', label: 'Pattern judgement', max: 10, description: 'Used a pattern only where it removed real duplication or variation, and said so when none was needed.' },
];

const BACKEND: Criterion[] = [
  { key: 'api-design', label: 'API and contract design', max: 15, description: 'Contracts that survive change: versioning, pagination, error semantics, idempotency.' },
  { key: 'data-modeling', label: 'Data modelling and indexing', max: 20, description: 'Schema and indexes derived from the query patterns, with the write cost of each index acknowledged.' },
  { key: 'transactions', label: 'Transactions and correctness', max: 15, description: 'Chose an isolation level deliberately and named the anomaly it permits.' },
  { key: 'caching', label: 'Caching', max: 15, description: 'Placement and invalidation reasoned about; named what becomes stale and for how long.' },
  { key: 'reliability', label: 'Failure handling', max: 15, description: 'Timeouts, retries with budgets, and what happens when a dependency is slow rather than dead.' },
  { key: 'observability', label: 'Observability', max: 10, description: 'Said what they would measure, at which percentile, and what alert it would drive.' },
  { key: 'tradeoffs', label: 'Trade-off reasoning', max: 10, description: 'Compared against the simpler design and justified the extra complexity.' },
];

const DISTRIBUTED: Criterion[] = [
  { key: 'partitioning', label: 'Partitioning', max: 15, description: 'Partition key chosen for the access pattern; hot spots and rebalancing addressed.' },
  { key: 'replication', label: 'Replication', max: 15, description: 'Topology, lag, and what reads from a replica can legally observe.' },
  { key: 'consistency', label: 'Consistency model', max: 15, description: 'Per-operation guarantees, not a single global label. Quorum arithmetic where relevant.' },
  { key: 'messaging', label: 'Asynchrony and delivery', max: 15, description: 'Delivery semantics, ordering guarantees, and idempotent consumption.' },
  { key: 'failure-modes', label: 'Failure modes', max: 15, description: 'Partitions, slow nodes, and the difference between "dead" and "slow" as detected by the system.' },
  { key: 'backpressure', label: 'Overload behaviour', max: 15, description: 'What the system does when it cannot keep up — sheds, queues, or collapses.' },
  { key: 'tradeoffs', label: 'Trade-off reasoning', max: 10, description: 'Every guarantee priced in latency, availability or operational burden.' },
];

const AI: Criterion[] = [
  { key: 'llm-architecture', label: 'LLM system architecture', max: 15, description: 'Request lifecycle, context assembly, and where latency and cost actually accumulate.' },
  { key: 'retrieval', label: 'Retrieval design', max: 15, description: 'Chunking, hybrid retrieval, reranking and context budget treated as an information-retrieval problem.' },
  { key: 'agent-design', label: 'Agent loop and tools', max: 15, description: 'Loop control, termination, budgets, and tool surfaces designed for a non-deterministic caller.' },
  { key: 'state-memory', label: 'State, memory and durability', max: 15, description: 'Working context versus durable state; resume after failure; checkpointing.' },
  { key: 'evaluation', label: 'Evaluation', max: 15, description: 'How they would know it works: golden sets, retrieval-versus-generation attribution, online guardrails.' },
  { key: 'ai-security', label: 'Security and guardrails', max: 15, description: 'Untrusted content as the attack surface; authorisation outside the prompt; approval gates.' },
  { key: 'cost-latency', label: 'Cost and latency control', max: 10, description: 'Named a per-request cost ceiling and the routing, caching or model choice that holds it.' },
];

export const RUBRICS: Record<Mode, Criterion[]> = {
  hld: HLD,
  lld: LLD,
  backend: BACKEND,
  distributed: DISTRIBUTED,
  ai: AI,
  // Boss Mode is graded on HLD criteria plus transfer: an unfamiliar system is
  // still a system-design problem, and the extra axis is whether the reasoning
  // generalised rather than being recalled.
  boss: [
    ...HLD,
    {
      key: 'transfer',
      label: 'Transfer to an unfamiliar problem',
      max: 15,
      description:
        'Derived the design from first principles rather than pattern-matching a memorised architecture; recognised where the familiar template did not apply.',
    },
  ],
};

export function maxScore(mode: Mode): number {
  return RUBRICS[mode].reduce((a, c) => a + c.max, 0);
}

/** The shape the model must return. Validated before anything is persisted. */
export const EvaluationSchema = z.object({
  overallSummary: z
    .string()
    .min(80)
    .max(1400)
    .describe('Two to four sentences. Direct, specific, no praise sandwich.'),
  criteria: z
    .array(
      z.object({
        key: z.string(),
        score: z.number().min(0),
        evidence: z
          .string()
          .min(20)
          .max(700)
          .describe('Quote or paraphrase what the candidate actually said that earned this score.'),
        improvement: z
          .string()
          .min(20)
          .max(700)
          .describe('One concrete thing that would have raised this score, phrased as an action.'),
      }),
    )
    .min(1),
  strengths: z.array(z.string().min(10).max(300)).min(1).max(6),
  weaknesses: z.array(z.string().min(10).max(300)).min(1).max(6),
  missedConcepts: z
    .array(z.string().min(3).max(120))
    .max(10)
    .describe('Concept names the candidate never raised but that the problem required.'),
  recommendedTopics: z
    .array(z.string().min(3).max(80))
    .max(8)
    .describe('Topic slugs from the curriculum to revise, weakest first.'),
});

export type EvaluationOutput = z.infer<typeof EvaluationSchema>;
