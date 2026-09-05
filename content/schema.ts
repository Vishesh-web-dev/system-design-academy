import { z } from 'zod';

/**
 * The content model. This file is the contract between the content track and
 * the application track (docs/ARCHITECTURE.md → Content pipeline).
 *
 * Every rule in docs/CONTENT_STYLE.md that can be checked mechanically is
 * checked here, so that `npm run typecheck` and `npm run content:validate`
 * both refuse malformed content. A lesson that does not satisfy this schema
 * can never be marked Complete.
 */

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const wordRange = (min: number, max: number, label: string) =>
  z.string().refine(
    (s) => {
      const n = words(s);
      return n >= min && n <= max;
    },
    (s) => ({ message: `${label} must be ${min}-${max} words, got ${words(s)}` }),
  );

/**
 * Content may never contain a raw external URL — docs/CONTENT_STYLE.md.
 *
 * The single exception is the documentation domains reserved by RFC 2606
 * (example.com/.net/.org, .example, .invalid, .test) plus localhost. Those are
 * illustrative strings inside a code example, not references to anything, so
 * they carry none of the risk the rule exists to prevent: they cannot rot and
 * they cannot be an invented citation.
 */
const RAW_URL = /https?:\/\/(?!(?:[\w-]+\.)*(?:example\.(?:com|net|org)|localhost|127\.0\.0\.1)(?:[:/]|$))/i;
const noRawUrl = z
  .string()
  .refine((s) => !RAW_URL.test(s), 'raw external URLs are not allowed in content; use a resource key');

/** Unfinished-content markers that block V1 completion. */
const PLACEHOLDER =
  /\b(TODO|FIXME|XXX|TBD|lorem ipsum|coming soon|placeholder|to be written|WIP)\b/i;
const noPlaceholder = z
  .string()
  .refine((s) => !PLACEHOLDER.test(s), 'placeholder marker found');

/** Markdown body: no raw URLs, no placeholders. */
export const markdown = z.string().pipe(noRawUrl).pipe(noPlaceholder);
/** A single content line with an explicit upper bound. */
const line = (max: number) => z.string().min(1).max(max).pipe(noRawUrl).pipe(noPlaceholder);

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case');

// ── Taxonomy ────────────────────────────────────────────────────────────────

export const phaseIds = [
  'foundations',
  'distributed',
  'hld',
  'lld',
  'ai',
] as const;
export const PhaseId = z.enum(phaseIds);
export type PhaseId = z.infer<typeof PhaseId>;

export const LessonKind = z.enum(['method', 'concept', 'system-design', 'machine-coding']);
export const Difficulty = z.enum(['intro', 'core', 'advanced']);

// ── References ──────────────────────────────────────────────────────────────

export const ResourceTier = z.enum(['must', 'good', 'advanced']);
export type ResourceTier = z.infer<typeof ResourceTier>;

export const LessonResource = z.object({
  /** Key that must exist in docs/resources.yaml with verified: true. */
  key: slug,
  tier: ResourceTier,
  /** Why this resource, for this lesson. Not a description of the resource. */
  note: z.string().min(15).max(260).pipe(noRawUrl),
});
export type LessonResource = z.infer<typeof LessonResource>;

// ── Visuals ─────────────────────────────────────────────────────────────────

export const FlowNodeKind = z.enum([
  'client',
  'edge',
  'service',
  'store',
  'cache',
  'queue',
  'external',
  'note',
  'actor',
]);

export const FlowNode = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: FlowNodeKind,
  x: z.number(),
  y: z.number(),
  /** Shown when the node is selected. */
  detail: z.string().min(10).max(400).pipe(noRawUrl).optional(),
});

export const FlowEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().max(60).optional(),
  kind: z.enum(['sync', 'async', 'replication', 'read', 'write', 'control']).default('sync'),
});

/** An ordered walkthrough of the diagram — the HLD "critical flow" stepper. */
export const FlowStep = z.object({
  id: z.string().min(1),
  title: z.string().min(3).max(80),
  description: z.string().min(20).max(600).pipe(noRawUrl).pipe(noPlaceholder),
  nodes: z.array(z.string()).default([]),
  edges: z.array(z.string()).default([]),
});

export const Diagram = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('mermaid'),
      id: z.string().min(1),
      title: z.string().min(3).max(90),
      /** What the reader should notice. A diagram without this is decoration. */
      caption: z.string().min(25).max(400).pipe(noRawUrl),
      code: z.string().min(20),
    }),
    z.object({
      kind: z.literal('flow'),
      id: z.string().min(1),
      title: z.string().min(3).max(90),
      caption: z.string().min(25).max(400).pipe(noRawUrl),
      nodes: z.array(FlowNode).min(2),
      edges: z.array(FlowEdge).min(1),
      steps: z.array(FlowStep).default([]),
    }),
  ])
  .superRefine((d, ctx) => {
    if (d.kind !== 'flow') return;
    const ids = new Set(d.nodes.map((n) => n.id));
    for (const e of d.edges) {
      if (!ids.has(e.source) || !ids.has(e.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge ${e.id} references a node that does not exist`,
        });
      }
    }
    const edgeIds = new Set(d.edges.map((e) => e.id));
    for (const s of d.steps) {
      for (const n of s.nodes) {
        if (!ids.has(n)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `step ${s.id} highlights unknown node ${n}` });
        }
      }
      for (const e of s.edges) {
        if (!edgeIds.has(e)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `step ${s.id} highlights unknown edge ${e}` });
        }
      }
    }
  });
export type Diagram = z.infer<typeof Diagram>;

// ── Active learning ─────────────────────────────────────────────────────────

/**
 * A question posed before the explanation, whose answer stays hidden until the
 * learner commits. docs/CONTENT_STYLE.md → Active learning requirements.
 */
export const Predict = z.object({
  question: z.string().min(25).max(500).pipe(noRawUrl),
  /** Revealed only after the learner has answered. */
  answer: markdown.refine((s) => words(s) >= 25, 'predict answer must be at least 25 words'),
});

export const ActiveLearningKind = z.enum([
  'predict',
  'what-changes-if',
  'modify-architecture',
  'debug',
  'explain-yourself',
]);

export const ActiveLearningItem = z.object({
  id: z.string().min(1),
  kind: ActiveLearningKind,
  prompt: z.string().min(30).max(900).pipe(noRawUrl).pipe(noPlaceholder),
  /** Hidden until the learner reveals it. */
  discussion: markdown.refine((s) => words(s) >= 40, 'discussion must be at least 40 words'),
});

// ── Sections 1..12 ──────────────────────────────────────────────────────────

export const Intuition = z.object({
  body: markdown.pipe(wordRange(120, 480, 'intuition.body')),
  /** The analogy must be explicitly retired before the deep explanation. */
  analogyLimit: z.string().min(30).max(500).pipe(noRawUrl),
});

export const DeepExplanation = z.object({
  body: markdown.pipe(wordRange(650, 3000, 'deepExplanation.body')),
  predict: Predict.optional(),
});

export const ProductionExample = z.object({
  body: markdown.pipe(wordRange(140, 800, 'productionExample.body')),
  /** Systems named in the body. Empty when the pattern is described generically. */
  systems: z.array(z.string().min(2)).default([]),
});

export const TradeoffRow = z.object({
  option: line(90),
  whenItWins: line(260),
  whenItLoses: line(260),
  cost: line(260),
});

export const Tradeoffs = z.object({
  intro: markdown.optional(),
  rows: z.array(TradeoffRow).min(3, 'need at least 3 options including the simplest one'),
});

export const CommonMistake = z.object({
  weakAnswer: z.string().min(15).max(400).pipe(noRawUrl),
  whyWeak: z.string().min(40).max(700).pipe(noRawUrl).pipe(noPlaceholder),
  strongAnswer: z.string().min(40).max(900).pipe(noRawUrl).pipe(noPlaceholder),
});

export const Flashcard = z.object({
  id: z.string().min(1),
  front: z.string().min(8).max(240).pipe(noRawUrl).pipe(noPlaceholder),
  back: z.string().min(15).max(700).pipe(noRawUrl).pipe(noPlaceholder),
  topic: slug,
});

export const QuizOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(400).pipe(noRawUrl),
});

export const QuizQuestion = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['single', 'multi', 'scenario']),
    prompt: z.string().min(20).max(1400).pipe(noRawUrl).pipe(noPlaceholder),
    options: z.array(QuizOption).min(3).max(6),
    correct: z.array(z.string().min(1)).min(1),
    explanation: z.string().min(50).max(1200).pipe(noRawUrl).pipe(noPlaceholder),
    difficulty: Difficulty,
    topic: slug,
  })
  .superRefine((q, ctx) => {
    const ids = new Set(q.options.map((o) => o.id));
    for (const c of q.correct) {
      if (!ids.has(c)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `question ${q.id}: correct id ${c} is not an option` });
      }
    }
    if (q.kind !== 'multi' && q.correct.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `question ${q.id}: ${q.kind} needs exactly one answer` });
    }
    if (q.kind === 'multi' && q.correct.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `question ${q.id}: multi needs at least two answers` });
    }
  });

export const Exercise = z.object({
  id: z.string().min(1),
  kind: z.enum(['design', 'modify', 'debug', 'estimate', 'implement', 'explain']),
  title: z.string().min(5).max(120),
  prompt: markdown.refine((s) => words(s) >= 40, 'exercise prompt must be at least 40 words'),
  /** What a good answer contains. Shown as a self-assessment checklist. */
  rubric: z.array(line(300)).min(3),
  /** Hidden until the learner submits. */
  modelAnswer: markdown.refine((s) => words(s) >= 120, 'model answer must be at least 120 words'),
  estimatedMinutes: z.number().int().min(5).max(60),
});

export const InterviewQuestion = z.object({
  id: z.string().min(1),
  level: z.enum(['basic', 'intermediate', 'advanced', 'followup']),
  question: z.string().min(15).max(500).pipe(noRawUrl).pipe(noPlaceholder),
  /** What a strong answer contains — not the answer itself. */
  guidance: z.string().min(50).max(1200).pipe(noRawUrl).pipe(noPlaceholder),
});

export const Revision = z.object({
  bullets: z.array(line(400)).min(6).max(18),
});

export const CheatSheet = z.object({
  whatItIs: line(400),
  whyItExists: line(400),
  whenToUse: z.array(line(300)).min(2),
  whenNotToUse: z.array(line(300)).min(2),
  alternatives: z.array(line(300)).min(2),
  tradeoffs: z.array(line(300)).min(2),
  failureModes: z.array(line(300)).min(2),
  followUpQuestions: z.array(line(300)).min(3),
});

// ── Lesson ──────────────────────────────────────────────────────────────────

export const Lesson = z
  .object({
    slug,
    title: z.string().min(5).max(90),
    /** One sentence. Shown in lists, search and the dependency graph. */
    summary: z.string().min(40).max(320).pipe(noRawUrl).pipe(noPlaceholder),
    phase: PhaseId,
    module: slug,
    /** Global ordering across the whole curriculum. */
    position: z.number().int().positive(),
    kind: LessonKind,
    difficulty: Difficulty,
    estimatedMinutes: z.number().int().min(20).max(120),
    /** Topic keys, used by the mastery model and the revision scheduler. */
    tags: z.array(slug).min(1).max(8),
    /** Lesson slugs that must come first. */
    prerequisites: z.array(slug).default([]),
    resources: z.array(LessonResource).default([]),

    // The twelve required sections.
    intuition: Intuition,
    deepExplanation: DeepExplanation,
    visuals: z.array(Diagram).min(1).max(4),
    productionExample: ProductionExample,
    tradeoffs: Tradeoffs,
    commonMistakes: z.array(CommonMistake).min(3).max(6),
    flashcards: z.array(Flashcard).min(5).max(14),
    quiz: z.array(QuizQuestion).min(4).max(10),
    exercises: z.array(Exercise).min(1).max(3),
    interviewQuestions: z.array(InterviewQuestion).min(6).max(14),
    revision: Revision,
    cheatSheet: CheatSheet,

    /** At least two active-learning elements per lesson. */
    activeLearning: z.array(ActiveLearningItem).default([]),
  })
  .superRefine((l, ctx) => {
    const mustRead = l.resources.filter((r) => r.tier === 'must');
    if (mustRead.length > 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${l.slug}: at most 3 "must" resources, got ${mustRead.length}` });
    }

    // Half of quiz questions must be scenario-driven, not trivia.
    const scenario = l.quiz.filter((q) => q.kind === 'scenario').length;
    if (scenario * 2 < l.quiz.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${l.slug}: at least half of quiz questions must be kind "scenario" (${scenario}/${l.quiz.length})`,
      });
    }

    // Interview questions must span the levels, including follow-ups.
    const levels = new Set(l.interviewQuestions.map((q) => q.level));
    for (const required of ['basic', 'intermediate', 'advanced', 'followup'] as const) {
      if (!levels.has(required)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${l.slug}: missing a "${required}" interview question` });
      }
    }

    // Two active-learning elements. A predict block counts as one.
    const activeCount = l.activeLearning.length + (l.deepExplanation.predict ? 1 : 0);
    if (activeCount < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${l.slug}: needs at least 2 active-learning elements, has ${activeCount}`,
      });
    }

    // Unique ids within the lesson.
    const collections: Array<[string, Array<{ id: string }>]> = [
      ['flashcards', l.flashcards],
      ['quiz', l.quiz],
      ['exercises', l.exercises],
      ['interviewQuestions', l.interviewQuestions],
      ['visuals', l.visuals],
      ['activeLearning', l.activeLearning],
    ];
    for (const [name, items] of collections) {
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${l.slug}: duplicate ${name} id "${item.id}"` });
        }
        seen.add(item.id);
      }
    }

    // Flashcard and quiz topics must be declared tags, so the mastery model
    // can attribute every signal to a topic the curriculum knows about.
    const tags = new Set(l.tags);
    for (const f of l.flashcards) {
      if (!tags.has(f.topic)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${l.slug}: flashcard ${f.id} topic "${f.topic}" is not in tags` });
      }
    }
    for (const q of l.quiz) {
      if (!tags.has(q.topic)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${l.slug}: quiz ${q.id} topic "${q.topic}" is not in tags` });
      }
    }
  });

export type Lesson = z.infer<typeof Lesson>;
export type LessonInput = z.input<typeof Lesson>;
export type Flashcard = z.infer<typeof Flashcard>;
export type QuizQuestion = z.infer<typeof QuizQuestion>;
export type Exercise = z.infer<typeof Exercise>;
export type InterviewQuestion = z.infer<typeof InterviewQuestion>;
export type CheatSheet = z.infer<typeof CheatSheet>;
export type TradeoffRow = z.infer<typeof TradeoffRow>;
export type CommonMistake = z.infer<typeof CommonMistake>;
export type ActiveLearningItem = z.infer<typeof ActiveLearningItem>;
export type FlowStep = z.infer<typeof FlowStep>;

/**
 * Authoring helper. Keeps lesson modules free of `satisfies` noise while still
 * giving full type checking at `npm run typecheck`.
 */
export function defineLesson(lesson: LessonInput): LessonInput {
  return lesson;
}

// ── Curriculum structure ────────────────────────────────────────────────────

export const Module = z.object({
  id: slug,
  title: z.string().min(3).max(80),
  summary: z.string().min(20).max(300),
  lessons: z.array(slug).min(1),
});

export const Phase = z.object({
  id: PhaseId,
  title: z.string().min(3).max(80),
  summary: z.string().min(20).max(400),
  /** What the learner can do at the end of this phase. */
  outcome: z.string().min(20).max(400),
  weeks: z.string().min(1).max(20),
  modules: z.array(Module).min(1),
});

export const Curriculum = z.object({
  targetWeeks: z.number().int().min(8).max(24),
  phases: z.array(Phase).min(1),
});

export type Module = z.infer<typeof Module>;
export type Phase = z.infer<typeof Phase>;
export type Curriculum = z.infer<typeof Curriculum>;

// ── Resource allowlist (docs/resources.yaml) ────────────────────────────────

export const Resource = z.object({
  key: slug,
  type: z.enum(['book', 'paper', 'article', 'docs', 'github', 'talk', 'spec', 'blog']),
  title: z.string().min(3),
  /** Chapter / section / article title. Never a page number or timestamp. */
  section: z.string().min(2).optional(),
  publisher: z.string().min(2),
  url: z.string().url(),
  verified: z.boolean(),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  topics: z.array(slug).min(1),
});
export type Resource = z.infer<typeof Resource>;

export const ResourceFile = z.object({
  resources: z.array(Resource).min(1),
});
