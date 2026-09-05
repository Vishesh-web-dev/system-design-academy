import type { Mode } from './rubric';

/**
 * The interview problem bank.
 *
 * Boss Mode problems are deliberately absent from the curriculum: the point is
 * transfer, and a learner who can pass Boss Mode by recalling a lesson has not
 * been tested (docs/PRODUCT.md → Core surfaces).
 */

export interface Problem {
  key: string;
  mode: Mode;
  title: string;
  /** What the interviewer opens with. Deliberately underspecified. */
  prompt: string;
  /** Topic slugs this problem exercises, used to seed review items. */
  topics: string[];
  minutes: number;
  /** Only for Boss Mode: why this problem resists pattern-matching. */
  transferNote?: string;
}

export const PROBLEMS: Problem[] = [
  // ── HLD ───────────────────────────────────────────────────────────────────
  {
    key: 'hld-url-shortener',
    mode: 'hld',
    title: 'URL shortener',
    prompt: 'Design a URL shortening service.',
    topics: ['id-generation', 'caching', 'partitioning', 'estimation'],
    minutes: 45,
  },
  {
    key: 'hld-notifications',
    mode: 'hld',
    title: 'Notification system',
    prompt:
      'Design a notification system that delivers to push, email and SMS for a product with 50 million users.',
    topics: ['messaging', 'delivery-semantics', 'idempotency', 'rate-limiting'],
    minutes: 45,
  },
  {
    key: 'hld-newsfeed',
    mode: 'hld',
    title: 'Social feed',
    prompt: 'Design the home feed for a social product with 200 million daily active users.',
    topics: ['fanout', 'caching', 'partitioning', 'consistency'],
    minutes: 45,
  },
  {
    key: 'hld-ride-hailing',
    mode: 'hld',
    title: 'Ride matching',
    prompt: 'Design the driver-matching system for a ride-hailing product in one large city.',
    topics: ['geospatial', 'consistency', 'distributed-locks', 'state-machines'],
    minutes: 50,
  },
  {
    key: 'hld-payments',
    mode: 'hld',
    title: 'Payment processing',
    prompt:
      'Design a payment service that charges a card and credits a merchant ledger, integrating a third-party processor.',
    topics: ['idempotency', 'transactions', 'ledger', 'failure-modes'],
    minutes: 50,
  },

  // ── LLD ───────────────────────────────────────────────────────────────────
  {
    key: 'lld-parking-lot',
    mode: 'lld',
    title: 'Parking lot',
    prompt: 'Design the classes for a multi-floor parking lot with several vehicle and spot types.',
    topics: ['object-design', 'design-patterns', 'extensibility'],
    minutes: 45,
  },
  {
    key: 'lld-booking',
    mode: 'lld',
    title: 'Seat booking',
    prompt:
      'Design the classes for booking seats at a cinema, where two users may try to book the same seat.',
    topics: ['concurrency', 'state-machines', 'transactions', 'object-design'],
    minutes: 45,
  },
  {
    key: 'lld-rate-limiter',
    mode: 'lld',
    title: 'Rate limiter library',
    prompt:
      'Design a reusable rate limiter library that supports multiple algorithms and is unit-testable without waiting for real time to pass.',
    topics: ['rate-limiting', 'interfaces', 'testability'],
    minutes: 40,
  },

  // ── Backend ───────────────────────────────────────────────────────────────
  {
    key: 'backend-inventory',
    mode: 'backend',
    title: 'Inventory service',
    prompt:
      'Design the backend for inventory reservation during a flash sale: 100,000 buyers, 5,000 units, no overselling.',
    topics: ['transactions', 'isolation', 'caching', 'backpressure'],
    minutes: 45,
  },
  {
    key: 'backend-search-api',
    mode: 'backend',
    title: 'Search API',
    prompt:
      'Design a product search API with filtering, sorting and pagination over 20 million products.',
    topics: ['pagination', 'indexes', 'query-performance', 'caching'],
    minutes: 45,
  },

  // ── Distributed ───────────────────────────────────────────────────────────
  {
    key: 'dist-job-queue',
    mode: 'distributed',
    title: 'Distributed job queue',
    prompt:
      'Design a job queue that must not lose jobs, must not run one twice in a way that matters, and must survive worker crashes mid-job.',
    topics: ['delivery-semantics', 'idempotency', 'distributed-locks', 'failure-modes'],
    minutes: 45,
  },
  {
    key: 'dist-counter',
    mode: 'distributed',
    title: 'Global counter',
    prompt:
      'Design a view counter for a video platform: 500,000 increments per second, and the number shown must be roughly right within seconds.',
    topics: ['consistency', 'partitioning', 'aggregation', 'backpressure'],
    minutes: 40,
  },

  // ── AI systems ────────────────────────────────────────────────────────────
  {
    key: 'ai-support-agent',
    mode: 'ai',
    title: 'AI support agent',
    prompt:
      'Design an AI agent that answers customer support questions and can issue refunds under a policy.',
    topics: ['tool-calling', 'ai-security', 'human-in-the-loop', 'evaluation'],
    minutes: 50,
  },
  {
    key: 'ai-rag-assistant',
    mode: 'ai',
    title: 'Internal knowledge assistant',
    prompt:
      'Design a retrieval assistant over 2 million internal documents where access permissions differ per user.',
    topics: ['retrieval', 'chunking', 'ai-security', 'evaluation'],
    minutes: 50,
  },
  {
    key: 'ai-coding-agent',
    mode: 'ai',
    title: 'Coding agent',
    prompt:
      'Design an agent that fixes bugs in a large repository and opens a pull request.',
    topics: ['agent-loops', 'agent-memory', 'sandboxing', 'evaluation'],
    minutes: 50,
  },

  // ── Boss Mode — none of these appear in the curriculum ─────────────────────
  {
    key: 'boss-warehouse-robots',
    mode: 'boss',
    title: 'Warehouse robot coordination',
    prompt:
      'Design the system that coordinates 4,000 autonomous robots moving shelves inside a warehouse. Robots must not collide, orders must be fulfilled within a deadline, and the network inside the building is unreliable.',
    topics: ['coordination', 'consistency', 'failure-modes', 'backpressure', 'estimation'],
    minutes: 50,
    transferNote:
      'Physical safety constraints and an unreliable local network invert the usual defaults: the correct answer often pushes decisions to the edge rather than centralising them.',
  },
  {
    key: 'boss-clinical-trial',
    mode: 'boss',
    title: 'Clinical trial data platform',
    prompt:
      'Design a platform that collects patient measurements from 300 hospitals, where records must be auditable, corrections are common, and no reader may ever see data they are not authorised for.',
    topics: ['consistency', 'audit', 'authorization', 'data-modeling', 'transactions'],
    minutes: 50,
    transferNote:
      'Immutability plus corrections plus per-row authorisation is a combination none of the curriculum designs use; caching and denormalisation become liabilities rather than tools.',
  },
  {
    key: 'boss-power-grid',
    mode: 'boss',
    title: 'Grid telemetry and control',
    prompt:
      'Design the system that ingests telemetry from 10 million electricity meters every 15 seconds and lets operators issue control commands to substations.',
    topics: ['ingestion', 'time-series', 'backpressure', 'failure-modes', 'estimation'],
    minutes: 50,
    transferNote:
      'A firehose of small writes plus a tiny volume of extremely high-stakes writes in the same system: the read path and the control path need opposite designs.',
  },
  {
    key: 'boss-airline-scheduling',
    mode: 'boss',
    title: 'Airline crew rescheduling',
    prompt:
      'Design the system that reassigns crews when flights are disrupted, respecting legal duty limits, across 900 daily flights.',
    topics: ['constraints', 'workflows', 'state-machines', 'consistency', 'failure-modes'],
    minutes: 50,
    transferNote:
      'The hard part is a constrained optimisation with a hard legal boundary, run as a long-lived workflow — not throughput.',
  },
];

export function problemsFor(mode: Mode): Problem[] {
  return PROBLEMS.filter((p) => p.mode === mode);
}

export function getProblem(key: string): Problem | undefined {
  return PROBLEMS.find((p) => p.key === key);
}

/**
 * Company emphasis profiles.
 *
 * These are *emphasis* settings for the interviewer, derived from each
 * company's public engineering writing. They are explicitly not claims about
 * any company's actual interview process (docs/PRODUCT.md → Honesty
 * constraints), and the UI labels them as such.
 */
export const COMPANY_STYLES: Array<{ key: string; label: string; emphasis: string }> = [
  {
    key: 'scale-first',
    label: 'Scale-first',
    emphasis:
      'Push hard on capacity estimation and on what breaks at ten times the load. Ask for numbers early and hold the candidate to them.',
  },
  {
    key: 'operational',
    label: 'Operational rigour',
    emphasis:
      'Push on failure modes, blast radius, rollout, monitoring and what the on-call engineer sees at 3am.',
  },
  {
    key: 'depth-first',
    label: 'Depth-first',
    emphasis:
      'Choose one component early and go three levels deep on it, rather than covering the whole system evenly.',
  },
  {
    key: 'product-tradeoffs',
    label: 'Product trade-offs',
    emphasis:
      'Push on which requirements can be relaxed, what the user actually notices, and the cost of each guarantee.',
  },
  {
    key: 'correctness',
    label: 'Correctness and money',
    emphasis:
      'Push on consistency, idempotency, reconciliation and what happens when two writes race. Assume money or safety is involved.',
  },
];
