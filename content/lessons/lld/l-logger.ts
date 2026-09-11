import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-logger',
  title: 'Design a logger',
  summary:
    'The structure is a level check, a list of sinks and a buffer — and it is famously over-engineered as a chain of responsibility, which is the wrong pattern. The real difficulty is what happens when the buffer is full and what happens at shutdown.',
  phase: 'lld',
  module: 'machine-coding',
  position: 63,
  kind: 'machine-coding',
  difficulty: 'core',
  estimatedMinutes: 55,
  tags: ['levels', 'sinks', 'buffering', 'shutdown'],
  prerequisites: ['l-rate-limiter-lld'],
  resources: [
    {
      key: 'otel-logs',
      tier: 'must',
      note: 'Read the log-record model: severity, timestamp, body and attributes as separate fields. It is the argument for structured records over formatted strings, and the field separation is what makes a per-sink formatter possible.',
    },
    {
      key: 'opentelemetry-docs',
      tier: 'good',
      note: 'Read the context-propagation sections. A log line without a correlation identifier is nearly useless in a distributed system, and where that identifier comes from is a design question the logger has to answer.',
    },
    {
      key: 'aws-load-shedding',
      tier: 'good',
      note: 'Read it as the answer to a full buffer. Dropping work deliberately with a counter beats blocking the application, and this lesson is that argument applied to a component nobody thinks of as load-bearing.',
    },
    {
      key: 'refactoring-guru-patterns',
      tier: 'good',
      note: 'Read the chain-of-responsibility entry specifically to see why it does not fit. A chain stops at the first handler that copes; logging is a broadcast to every sink that wants the record, which is a different shape.',
    },
    {
      key: 'google-sre-handling-overload',
      tier: 'advanced',
      note: 'Read it for why a component must not amplify a problem it is only observing. A logger that blocks under load converts a logging bottleneck into an application outage, which is the failure this design is organised to avoid.',
    },
  ],

  intuition: {
    body: `A logger is the most over-engineered answer in machine coding, and the usual culprit is a pattern name: **"chain of responsibility, with a handler per level."**

**That is the wrong shape, and saying why is the fastest way to establish judgment.** A chain passes a request along until one handler copes — **exactly one wins, and the rest never see it.** Logging is the opposite: **every sink that wants the record should get it.** A warning goes to the console *and* the file *and* the aggregator.

\`\`\`
Chain of responsibility:  first handler that can → stops
Logging:                  every interested sink → broadcast
\`\`\`

**So the structure is a filter and a fan-out**, which is three lines rather than a class per level:

\`\`\`
if (record.level >= minLevel)       // one integer comparison
  for (const sink of sinks)         // broadcast
    if (record.level >= sink.level) sink.write(record);
\`\`\`

**With that out of the way, the two genuinely hard things are visible**, and neither is about structure.

**First: the level check must happen before the message is built.**

\`\`\`ts
log.debug(\`user \${expensiveSummary(user)} did \${describe(action)}\`);
\`\`\`

**Both functions run even when debug logging is off**, because the template is evaluated before the call. **In a hot path this is the dominant cost of a disabled log statement** — and it is invisible, because the output is absent so nobody looks.

**Second, and the actual difficulty: the buffer.**

Writing to a file or a network synchronously puts I/O on the application's critical path, **so logging is buffered.** Which creates the question that defines the design: **what happens when the buffer is full?**

\`\`\`
Block the caller       → a logging bottleneck becomes an
                         application outage
Drop the newest        → you lose the record of what is
                         happening right now
Drop the oldest        → you lose context, keep the crisis
\`\`\`

**And whichever you choose, you must count the drops** — because a logging system that silently loses records is worse than one that loses them loudly.

**Then the failure that hurts most: the log line you want is the last one before the crash**, and asynchronous buffering is precisely the mechanism that loses it. **So shutdown needs a bounded flush, and fatal records need a synchronous path.**`,
    analogyLimit:
      '"A logger just writes messages somewhere" is true and hides that it sits on every code path in the application, which makes it the one component whose failure or slowness contaminates everything. That is why blocking on a full buffer is the wrong answer and why a throwing sink must be isolated. The pattern framing is the other trap: chain of responsibility implies one handler wins, and logging is a broadcast — a mismatch that produces a class per level for a job an integer comparison does.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate designs a logger as: an abstract `Handler` with `setNext`, one concrete handler per level (`DebugHandler`, `InfoHandler`, `ErrorHandler`), each checking whether it handles the level and otherwise delegating; a `Logger.log(level, message: string)` that starts the chain; and each handler writing synchronously to its destination. Identify four problems.',
      answer: `**Problem 1 — chain of responsibility is the wrong pattern, and the mismatch is structural rather than stylistic.**

A chain stops at the first handler that copes. **Logging needs every interested sink to receive the record.**

\`\`\`
An error record should reach: console, file, aggregator
A chain delivers it to:       whichever handler matched first
\`\`\`

**So either the handlers deliberately do not stop — in which case it is not a chain, it is a linked list being used as a loop — or records go to one destination.** Both are worse than a list of sinks.

**And the per-level classes are the wrong axis anyway.** Level is a number and filtering is a comparison; **the thing that genuinely varies is the destination.** So the classes should be \`ConsoleSink\`, \`FileSink\`, \`HttpSink\` — **with a level threshold as a field on each** — which is one interface, several implementations, and no chain.

**Problem 2 — \`message: string\` means the message is always constructed.**

\`\`\`
log.debug(\`cart \${JSON.stringify(cart)} for \${user.email}\`)
→ the interpolation and the stringify run before log() is
  entered, whether or not debug is enabled
\`\`\`

**In a request hot path this is often the most expensive thing a disabled log statement does**, and it is invisible because the output does not appear.

*Three fixes, in ascending order of quality:*

\`\`\`ts
if (log.isEnabled('debug')) log.debug(...)   // caller guards
log.debug(() => \`...\`)                        // lazy thunk
log.debug('cart updated', { cartId, userId }) // structured
\`\`\`

**The third is best**, because it avoids formatting entirely — **the sink formats, and only if it is going to write.** And the fields are machine-queryable, which a formatted string is not.

**Problem 3 — synchronous writes put I/O on every code path.**

A file write is a system call; an HTTP post is a network round trip. **With logging on every path, the application's latency now includes its own logging I/O** — and a slow disk or a stalled log endpoint becomes application latency.

*The fix is a bounded queue and a writer*, which immediately raises the question the design exists to answer: **what happens when the queue is full?** *(Below.)*

**Problem 4 — a throwing handler breaks the caller, and there is no flush.**

**No isolation:** a sink whose disk is full throws, the exception propagates through \`log()\`, and **the application fails inside a logging statement.** That is the worst possible failure — the observability component causing the incident.

**And no flush:** with buffering added, **the records still in the buffer at shutdown are lost** — which are exactly the records describing whatever caused the shutdown.

**What the corrected design is.**

\`\`\`ts
interface Sink {
  readonly minLevel: Level;
  write(record: LogRecord): void;   // may throw; caller isolates
  flush(): Promise<void>;
}

class Logger {
  log(level: Level, msg: string, fields?: Fields): void {
    if (level < this.minLevel) return;          // cheapest check
    const record = { level, msg, fields, at: this.clock.now() };
    this.buffer.offer(record);                  // never blocks
  }
}
\`\`\`

**One interface on the axis that varies, an integer comparison for filtering, structured fields instead of formatted strings, a bounded non-blocking buffer, and per-sink isolation.** No chain, no class per level.

**The transferable diagnostic: when a pattern name produces a class per value of an enum, the axis is wrong.** Levels are data; **destinations are the thing that varies.**`,
    },
  body: `## Requirements and the invariant

**Four questions, and each has a specific consequence.**

\`\`\`
"Multiple destinations, each with its own threshold?"  → sinks
"Must logging never block the application?"            → buffered
"Must records survive a crash or shutdown?"            → flush
"Structured fields, or formatted strings?"             → records
\`\`\`

\`\`\`
INVARIANT
  a record at level >= threshold reaches every sink whose
    own threshold it also meets
  log() never blocks and never throws to the caller
  a record is either written, or counted as dropped
  at shutdown, buffered records are flushed or the flush
    times out and reports how many were lost
\`\`\`

**The third clause is the one people omit**, and it is what separates a logger you can trust from one that quietly loses data. **"Either written or counted" is the honest guarantee** — and it is achievable, whereas "never lost" is not.

## The structure, which is small

\`\`\`ts
export enum Level { Trace = 10, Debug = 20, Info = 30,
                    Warn = 40, Error = 50, Fatal = 60 }

export interface LogRecord {
  level: Level;
  msg: string;
  fields?: Record<string, unknown>;
  at: number;                 // taken at log time, not write time
  context?: { traceId?: string; spanId?: string };
}

export interface Sink {
  readonly minLevel: Level;
  write(record: LogRecord): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}
\`\`\`

**Four decisions worth defending.**

**Levels are numbers with gaps.** Comparison is one integer operation, **and the gaps allow a level to be inserted later without renumbering** — a small thing that avoids a breaking change.

**\`at\` is captured when \`log()\` is called, not when the sink writes.** With asynchronous writing these differ by the queue delay, **and a timestamp applied at write time reorders and misdates everything** — which makes the logs unusable for the thing they are most needed for.

**\`fields\` is separate from \`msg\`.** The message is a stable string; the variable parts are data. **So the same record can be rendered as a human line by one sink and as JSON by another**, and a query for all records with a given user id is possible.

**And \`context\` carries correlation identifiers.** A log line in a distributed system without a trace identifier **cannot be joined to anything**, so where it comes from is a design question rather than an afterthought — usually an ambient context the logger reads, or a child logger bound to a request.

## The level check, and where it must happen

\`\`\`ts
log(level: Level, msg: string, fields?: Fields): void {
  if (level < this.minLevel) return;     // ← FIRST, and cheap
  // ...
}
\`\`\`

**But that check is already too late for the caller's cost.**

\`\`\`ts
log.debug(\`cart \${JSON.stringify(cart)}\`)
//          ^^^^^^^^^^^^^^^^^^^^^^^^^^^ runs before log() is called
\`\`\`

**Three mechanisms, and the third is the one to present.**

\`\`\`ts
// 1. Caller guard — works, and clutters every call site
if (log.isEnabled(Level.Debug)) log.debug(\`...\`);

// 2. Lazy message — one allocation, no formatting
log.debug(() => \`cart \${JSON.stringify(cart)}\`);

// 3. Structured — no formatting at all unless a sink writes
log.debug('cart updated', { cartId: cart.id, items: cart.size });
\`\`\`

**Structured is best for three reasons.** No string work happens unless a sink formats; **the fields are queryable**; and the message stays constant, which makes grouping identical events possible. **And it composes with the lazy form** — a field whose value is expensive can itself be a thunk.

*The honest caveat:* structured logging is more verbose to write, **and a team that finds it annoying will go back to interpolation.** Worth saying, because an interface nobody uses correctly is not a good interface.

## The buffer, which is the actual design

\`\`\`ts
class BoundedBuffer<T> {
  private readonly items: T[] = [];
  private dropped = 0;

  constructor(private readonly capacity: number,
              private readonly policy: 'drop-new' | 'drop-old') {}

  offer(item: T): void {
    if (this.items.length >= this.capacity) {
      if (this.policy === 'drop-new') { this.dropped++; return; }
      this.items.shift();              // drop-old
      this.dropped++;
    }
    this.items.push(item);
  }

  drainDropCount(): number { const n = this.dropped; this.dropped = 0; return n; }
}
\`\`\`

**Three policies, and the first is almost always wrong.**

**Block the caller.** The buffer is full, so \`log()\` waits. **A logging bottleneck is now an application outage** — and it happens under exactly the load that produces the most logs, so **the failure is correlated with the incident you are trying to observe.**

**Drop the newest.** Cheapest, and it loses the record of what is happening *now* — **which is the most valuable record.**

**Drop the oldest.** Loses context, keeps the crisis. **This is the right default for a diagnostic stream**, because the recent past explains the present better than the distant past does.

*And there is a fourth option worth naming:* **sample under pressure.** Keep every record above \`Warn\` and drop a fraction of \`Debug\` and \`Info\` — **so the drop policy becomes level-aware**, which preserves the records that matter while shedding volume. This is the best answer if the interviewer pushes.

**Whatever the policy: count the drops and report them.**

\`\`\`ts
// The writer loop, periodically:
const n = buffer.drainDropCount();
if (n > 0) emit({ level: Level.Warn, msg: 'log records dropped',
                  fields: { count: n }, at: clock.now() });
\`\`\`

**A logger that silently loses records is worse than one that loses them loudly**, because the silence removes your ability to know the logs are incomplete. **The dropped-count record is the cheapest honesty available.**

## Sink isolation, and ordering

\`\`\`ts
private deliver(record: LogRecord): void {
  for (const sink of this.sinks) {
    if (record.level < sink.minLevel) continue;
    try { sink.write(record); }
    catch { this.sinkFailures++; }     // never propagate
  }
}
\`\`\`

**A failing sink must not affect the others or the caller.** This is the observer trap, and here it is more severe: **an exception escaping \`log()\` means the application fails inside a logging statement**, which is the observability component causing the incident.

*And the counter matters.* A silently swallowed exception per record means **a sink can be broken for days with no signal** — so count failures per sink and surface them.

**Ordering, which has two parts.**

**Within a sink, order is preserved** if the buffer is drained in order by a single writer.

**Across sinks, it is not.** A console sink writing synchronously and an HTTP sink batching every five seconds **produce two differently-ordered views of the same stream** — which is fine, and worth knowing when comparing them during an incident.

**And within a record, the timestamp is authoritative rather than the arrival order**, which is why \`at\` is captured at call time.

## Shutdown, and the record you actually want

**The most valuable log line is the last one before the crash, and buffering is what loses it.**

\`\`\`ts
async shutdown(timeoutMs = 2000): Promise<ShutdownReport> {
  this.accepting = false;                 // stop taking new records
  const deadline = this.clock.now() + timeoutMs;
  await this.drainUntil(deadline);        // bounded, not unbounded
  const results = await Promise.allSettled(
    this.sinks.map(s => s.flush()));
  return {
    flushed: this.flushedCount,
    dropped: this.buffer.size() + this.buffer.drainDropCount(),
    sinkErrors: results.filter(r => r.status === 'rejected').length,
  };
}
\`\`\`

**Three decisions.**

**The flush is bounded.** An unbounded flush means a stalled log endpoint **prevents the process from exiting**, turning a clean shutdown into a hang and then a kill — which loses everything anyway. **A deadline converts an unbounded hang into a bounded loss.**

**\`accepting = false\` first**, so the buffer cannot be refilled while draining.

**And the report says what was lost.** Shutdown that silently discards a thousand records is the same dishonesty as a silent drop policy.

**For \`Fatal\`, bypass the buffer entirely.**

\`\`\`ts
fatal(msg: string, fields?: Fields): void {
  const record = { level: Level.Fatal, msg, fields, at: this.clock.now() };
  for (const sink of this.sinks) {
    try { sink.write(record); sink.flushSync?.(); } catch { /* isolated */ }
  }
}
\`\`\`

**A fatal record is written synchronously because the process may not survive to drain a queue.** It costs latency on a path where latency no longer matters — **and it is the one record you cannot afford to buffer.**

## Tests

\`\`\`ts
test('below-threshold records reach no sink', () => { /* ... */ });

test('the message is not constructed when disabled', () => {
  const build = vi.fn(() => 'expensive');
  logger.setLevel(Level.Info);
  logger.debug(build);
  expect(build).not.toHaveBeenCalled();     // ← the real test
});

test('a throwing sink does not prevent the others', () => {
  const bad = { minLevel: Level.Trace, write: () => { throw new Error(); } };
  logger.addSink(bad); logger.addSink(good);
  logger.info('x');
  expect(goodWrites).toHaveLength(1);
});

test('overflow drops per policy and counts the drops', () => { /* ... */ });

test('shutdown flushes and reports what was lost', async () => { /* ... */ });
\`\`\`

**The second test is the one that matters and is almost never written.** It asserts a *negative* — that expensive work did not happen — **and it is the only way to verify the performance property that makes disabled logging cheap.**

## What to say in the last three minutes

**That chain of responsibility is the wrong shape**, because logging is a broadcast and a chain stops at the first handler.

**That levels are data and destinations are the varying axis**, so there is one interface and no class per level.

**That the level check cannot save the caller's formatting cost**, which is why the API is structured.

**The drop policy, with its counter** — and that level-aware sampling is the better version.

**That shutdown is bounded and reports losses**, and that fatal bypasses the buffer.

**And what you left out:** log rotation, sink retry with backoff, sampling configuration, and where correlation identifiers come from.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'not-a-chain',
      title: 'Why chain of responsibility is the wrong shape',
      caption:
        'Read the two columns as delivery semantics. A chain stops; logging broadcasts. And the per-level classes are on the wrong axis — level is data, destination is what varies.',
      code: `flowchart TB
    R["**An Error record**"]

    R --> C["**Chain of responsibility**"]
    C --> C1["DebugHandler<br/>handles? no → pass"]
    C1 --> C2["InfoHandler<br/>handles? no → pass"]
    C2 --> C3["ErrorHandler<br/>**handles → STOPS**"]
    C3 --> CR["**Delivered to one<br/>destination.**<br/>The console and the<br/>aggregator never see it."]

    R --> B["**Filter and fan-out**"]
    B --> B1["level >= logger.minLevel?<br/>**one integer comparison**"]
    B1 --> B2["for each sink:<br/>level >= sink.minLevel?"]
    B2 --> S1["ConsoleSink<br/>minLevel: Debug ✓"]
    B2 --> S2["FileSink<br/>minLevel: Info ✓"]
    B2 --> S3["HttpSink<br/>minLevel: Error ✓"]
    S1 --> BR["**Delivered to all three.**<br/>Each isolated in a try,<br/>so a full disk cannot<br/>fail the application."]
    S2 --> BR
    S3 --> BR

    A["**And the axis was wrong:**<br/>a class per LEVEL is a class<br/>per value of an enum.<br/>Levels are data — the thing<br/>that varies is the destination."]
    CR -.-> A

    style CR fill:#40181c,stroke:#b4535e
    style BR fill:#17272a,stroke:#35897e
    style A fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'buffer-decisions',
      title: 'The buffer is the design',
      caption:
        'Step through it. Everything to the right of the buffer is a decision about loss — and the honest guarantee is "written or counted", not "never lost".',
      nodes: [
        { id: 'call', label: 'log.debug(msg, fields)', kind: 'client', x: 0, y: 140, detail: 'Structured rather than interpolated, because the caller\'s template is evaluated before log() is entered — often the dominant cost of a disabled log statement, and invisible because no output appears.' },
        { id: 'filter', label: 'level >= minLevel', kind: 'service', x: 230, y: 140, detail: 'One integer comparison, with gapped level numbers so a level can be inserted later without renumbering. This is all the filtering a logger needs — no class per level.' },
        { id: 'stamp', label: 'Stamp at call time', kind: 'service', x: 230, y: 30, detail: 'The timestamp is captured when log() is called, not when a sink writes. With async delivery those differ by the queue delay, and a write-time timestamp misdates and reorders everything — destroying the logs for the purpose they are most needed for.' },
        { id: 'buf', label: 'Bounded buffer, never blocks', kind: 'store', x: 470, y: 140, detail: 'Blocking the caller turns a logging bottleneck into an application outage, under exactly the load that produces the most logs — so the failure is correlated with the incident you are trying to observe.' },
        { id: 'policy', label: 'Drop policy + a counter', kind: 'note', x: 470, y: 280, detail: 'Drop-oldest is the right default: lose context, keep the crisis. Level-aware sampling is better — keep everything above Warn, shed a fraction of Debug. And always emit the dropped count: a logger that loses records silently removes your ability to know the logs are incomplete.' },
        { id: 'deliver', label: 'Broadcast, each sink isolated', kind: 'service', x: 720, y: 140, detail: 'Every sink whose threshold the record meets receives it, each inside a try. An exception escaping log() means the application fails inside a logging statement — the observability component causing the incident. Count failures per sink, or a broken sink is silent for days.' },
        { id: 'shutdown', label: 'Bounded flush + report', kind: 'note', x: 720, y: 30, detail: 'Stop accepting, drain until a deadline, flush all sinks, report flushed and dropped counts. An unbounded flush lets a stalled endpoint prevent exit, turning a clean shutdown into a hang and then a kill — which loses everything.' },
        { id: 'fatal', label: 'Fatal bypasses the buffer', kind: 'note', x: 720, y: 280, detail: 'Written synchronously, because the process may not survive to drain a queue. It costs latency on a path where latency no longer matters, and it is the one record you cannot afford to buffer.' },
      ],
      edges: [
        { id: 'g1', source: 'call', target: 'filter', kind: 'sync' },
        { id: 'g2', source: 'filter', target: 'stamp', kind: 'control' },
        { id: 'g3', source: 'filter', target: 'buf', kind: 'write' },
        { id: 'g4', source: 'buf', target: 'policy', kind: 'control' },
        { id: 'g5', source: 'buf', target: 'deliver', kind: 'async' },
        { id: 'g6', source: 'deliver', target: 'shutdown', kind: 'control' },
        { id: 'g7', source: 'call', target: 'fatal', kind: 'sync' },
      ],
      steps: [
        {
          id: 'gs1',
          title: 'The API shape decides the cost of disabled logging',
          description:
            'Structured fields mean no string work happens unless a sink formats. The level check inside log() cannot help — the interpolation already ran at the call site.',
          nodes: ['call', 'filter'],
          edges: ['g1'],
        },
        {
          id: 'gs2',
          title: 'Stamp the record where it was created',
          description:
            'Async delivery separates call time from write time. A timestamp applied at write time makes the whole stream misdated and reordered, which is the one thing logs must not be.',
          nodes: ['stamp'],
          edges: ['g2'],
        },
        {
          id: 'gs3',
          title: 'Then the buffer, and the decision it forces',
          description:
            'Never block: a logging bottleneck must not become an outage, and it would happen precisely during the incident you need the logs for. Which means choosing what to lose.',
          nodes: ['buf', 'policy'],
          edges: ['g3', 'g4'],
        },
        {
          id: 'gs4',
          title: 'Broadcast, with every sink isolated',
          description:
            'Every interested sink gets the record, each in a try, with a failure counter — because a swallowed exception means a sink can be broken for days with no signal.',
          nodes: ['deliver'],
          edges: ['g5'],
        },
        {
          id: 'gs5',
          title: 'And protect the records that matter most',
          description:
            'A bounded flush that reports its losses, and a synchronous path for fatal — because the most valuable line is the last one before the crash, and buffering is exactly what loses it.',
          nodes: ['shutdown', 'fatal'],
          edges: ['g6', 'g7'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `The published log-record model in the OpenTelemetry specification is the most useful reference here, because it settles a question candidates usually argue about from taste.

**A log record has separate fields: a timestamp, a severity, a body, and attributes.** The body is the human-readable part and the attributes are structured key-value data — **and keeping them separate is what allows one record to be rendered as a text line by one exporter and as JSON by another.**

**It also treats the observed timestamp and the record timestamp as potentially different fields.** Which is the design point this lesson makes about stamping at call time: **the specification acknowledges that when a record was created and when it was observed by the pipeline are different facts**, and conflating them loses information.

**And severity is a number with a defined range**, with gaps between the named values. **Comparison is arithmetic, and a new severity can be inserted without renumbering.**

**Three transferable lessons.**

**Structured attributes are the format, and the rendering is per destination.** A logger that accepts a formatted string has already thrown away the structure, **and no downstream system can recover it reliably** — which is why the API shape matters more than the sink implementations.

**Correlation identifiers belong on the record, not in the message.** The specification carries trace and span identifiers as first-class fields, **because a log line that cannot be joined to a request is nearly useless in a distributed system** — and putting them in the text means every consumer parses them out differently.

**And separating creation time from observation time is worth the extra field.** It is the difference between "this happened at 12:00:00.123" and "the pipeline saw this at 12:00:04".

**Where the reference does not help.** It specifies a data model, not an implementation, so **the buffer, the drop policy, the shutdown behaviour and the sink isolation are all yours** — and those are where the design is actually decided. A logger with a perfect record model that blocks on a full buffer is still the component that took the application down.`,
  },

  tradeoffs: {
    intro:
      'The decisions this design turns on, most of which are about what to lose and when.',
    rows: [
      {
        option: 'Chain of responsibility with a handler per level',
        whenItWins:
          'Nowhere. It is the canonical textbook answer for this problem.',
        whenItLoses:
          'A chain stops at the first handler that copes; logging needs every interested sink to receive the record.',
        cost:
          'A class per enum value, on an axis that does not vary.',
      },
      {
        option: 'A level threshold plus a list of sinks',
        whenItWins:
          'Always. One integer comparison and a broadcast loop.',
        whenItLoses:
          'Nothing meaningful; it is smaller and more correct.',
        cost:
          'Three lines.',
      },
      {
        option: 'A formatted-string API',
        whenItWins:
          'Convenience — it is what people write naturally.',
        whenItLoses:
          'The template is evaluated before the level check, so disabled logging pays full formatting cost, and the structure is destroyed.',
        cost:
          'Invisible hot-path cost, plus unqueryable logs.',
      },
      {
        option: 'A structured API with separate fields',
        whenItWins:
          'Always. No string work unless a sink formats, and the fields are queryable.',
        whenItLoses:
          'More verbose to write, so a team may drift back to interpolation.',
        cost:
          'Call-site verbosity, which is a real adoption risk.',
      },
      {
        option: 'Synchronous writes',
        whenItWins:
          'A single console sink in a short-lived process, or a fatal record.',
        whenItLoses:
          'It puts file or network I/O on every application code path.',
        cost:
          'Application latency that includes its own logging I/O.',
      },
      {
        option: 'A bounded buffer with a writer',
        whenItWins:
          'Always for file and network sinks.',
        whenItLoses:
          'Records in the buffer are lost on a crash, and the timestamp must be captured at call time.',
        cost:
          'A drop policy, a counter, and a shutdown flush.',
      },
      {
        option: 'Blocking the caller when the buffer is full',
        whenItWins:
          'When every record is more valuable than availability — an audit log, not a diagnostic log.',
        whenItLoses:
          'A logging bottleneck becomes an application outage, under exactly the load that produces the most logs.',
        cost:
          'The failure is correlated with the incident you need the logs for.',
      },
      {
        option: 'Drop the newest record',
        whenItWins:
          'Cheapest to implement — no shifting.',
        whenItLoses:
          'It discards the record of what is happening now, which is the most valuable one.',
        cost:
          'Losing the present to preserve the past.',
      },
      {
        option: 'Drop the oldest record',
        whenItWins:
          'The right default for a diagnostic stream — lose context, keep the crisis.',
        whenItLoses:
          'The beginning of an incident may be what explains it.',
        cost:
          'A shift per overflow, and lost lead-up context.',
      },
      {
        option: 'Level-aware sampling under pressure',
        whenItWins:
          'The best answer: keep everything above Warn, shed a fraction of Debug and Info.',
        whenItLoses:
          'Sampling rates are another thing to configure and reason about.',
        cost:
          'Complexity in the drop path, plus a sampling policy.',
      },
      {
        option: 'Silent drops',
        whenItWins:
          'Nowhere.',
        whenItLoses:
          'It removes your ability to know the logs are incomplete, which is worse than the loss itself.',
        cost:
          'Trust in every conclusion drawn from the logs.',
      },
      {
        option: 'An unbounded flush at shutdown',
        whenItWins:
          'Nowhere. It looks like maximum durability.',
        whenItLoses:
          'A stalled log endpoint prevents the process exiting, so a clean shutdown becomes a hang and then a kill.',
        cost:
          'Everything, since a killed process flushes nothing.',
      },
      {
        option: 'A bounded flush with a report',
        whenItWins:
          'Always. Bounded loss instead of an unbounded hang, and the loss is stated.',
        whenItLoses:
          'Some records are dropped at the deadline.',
        cost:
          'A timeout to choose, and a report nobody may read.',
      },
      {
        option: 'Buffering fatal records',
        whenItWins:
          'Nowhere. Consistency with other levels is not worth it.',
        whenItLoses:
          'The process may not survive to drain the queue, so the most important record is the one lost.',
        cost:
          'The record that explains the crash.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"I would use chain of responsibility, with a handler for each level that either handles the record or passes it along."',
      whyWeak:
        'A chain stops at the first handler that copes, and logging needs every interested sink to receive the record — an error should reach the console and the file and the aggregator. It also puts classes on the wrong axis: level is a number and filtering is a comparison.',
      strongAnswer:
        '"Logging is a filter and a fan-out rather than a chain: a chain stops at the first handler, and here every sink whose threshold the record meets should get it. So it is one integer comparison against the logger threshold, then a loop over sinks each with its own threshold. The interface goes on the axis that actually varies — the destination — so ConsoleSink, FileSink and HttpSink implement one Sink interface, with the level as a field rather than a class."',
    },
    {
      weakAnswer: '"log(level, message) takes a formatted string, and checks the level before doing anything else."',
      whyWeak:
        'The check is too late for the caller. Interpolating a template and serialising an object happen before log() is entered, so a disabled debug statement in a hot path still pays the full formatting cost — and it is invisible because no output appears.',
      strongAnswer:
        '"The API takes a message and structured fields separately, so no string work happens unless a sink is going to format. That also makes the fields queryable and keeps the message constant, which lets identical events be grouped. A lazy thunk is the fallback when a single field is expensive. And I would test the negative explicitly — assert that the expensive builder was never called when the level is disabled — because that is the only way to verify the property."',
    },
    {
      weakAnswer: '"The logger writes to each sink synchronously when log is called."',
      whyWeak:
        'A file write is a system call and an HTTP post is a network round trip, so with logging on every code path the application\'s latency now includes its own logging I/O — and a slow disk or stalled endpoint becomes application latency.',
      strongAnswer:
        '"Records go into a bounded buffer that never blocks, and a single writer drains it to the sinks. The timestamp is captured when log is called rather than when the sink writes, because async delivery makes those differ by the queue delay and a write-time timestamp misdates and reorders the whole stream. Fatal is the exception: it writes synchronously, because the process may not survive to drain a queue."',
    },
    {
      weakAnswer: '"If the buffer fills up, log calls block until there is space."',
      whyWeak:
        'That turns a logging bottleneck into an application outage, and it happens under exactly the load that produces the most log volume — so the failure is correlated with the incident the logs exist to explain.',
      strongAnswer:
        '"It never blocks. The default is to drop the oldest — lose context, keep the crisis — and the better version is level-aware sampling: keep everything above Warn, shed a fraction of Debug and Info. Either way the drops are counted and the count is emitted as a record, because a logger that loses data silently removes your ability to know the logs are incomplete. The honest guarantee is that a record is either written or counted as dropped, not that nothing is ever lost."',
    },
    {
      weakAnswer: '"At shutdown the logger flushes all buffered records to every sink."',
      whyWeak:
        'An unbounded flush means a stalled log endpoint prevents the process from exiting, so a clean shutdown becomes a hang and then a forced kill — which loses everything rather than some of it.',
      strongAnswer:
        '"Shutdown stops accepting new records, drains until a deadline, flushes the sinks, and returns a report of how many were flushed, how many were dropped and which sinks errored. The deadline converts an unbounded hang into a bounded loss. And silently discarding the remainder would be the same dishonesty as a silent drop policy, so the report exists even if nobody reads it."',
    },
    {
      weakAnswer: '"Each sink writes the record; if one throws, the exception propagates so the caller knows."',
      whyWeak:
        'An exception escaping log() means the application fails inside a logging statement — the observability component causing the incident. And a full disk in one sink should not prevent the other two from recording what happened.',
      strongAnswer:
        '"Each sink write is wrapped individually, so a failure affects neither the other sinks nor the caller. But a swallowed exception means a sink can be broken for days with no signal, so failures are counted per sink and surfaced — the same shape as the observer pattern\'s isolation requirement, and more severe here because the logger sits on every code path."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lg-1',
      front: 'Why is chain of responsibility the wrong pattern for a logger?',
      back: 'A chain stops at the first handler that copes; logging broadcasts to every sink whose threshold the record meets.',
      topic: 'levels',
    },
    {
      id: 'fc-lg-2',
      front: 'What is the right axis for the interface, and why?',
      back: 'The destination. Level is a number and filtering is a comparison, so a class per level is a class per enum value on an axis that does not vary.',
      topic: 'sinks',
    },
    {
      id: 'fc-lg-3',
      front: 'Why can the level check inside log() not save the caller\'s cost?',
      back: 'The template interpolation and any serialisation run before log() is entered — often the dominant cost of a disabled statement, and invisible because no output appears.',
      topic: 'levels',
    },
    {
      id: 'fc-lg-4',
      front: 'Why is a structured API better than a lazy thunk?',
      back: 'No string work happens at all unless a sink formats, the fields are queryable, and the message stays constant so identical events can be grouped.',
      topic: 'levels',
    },
    {
      id: 'fc-lg-5',
      front: 'Why are level numbers gapped?',
      back: 'So a level can be inserted later without renumbering — and comparison stays a single integer operation.',
      topic: 'levels',
    },
    {
      id: 'fc-lg-6',
      front: 'Why stamp the record at call time rather than write time?',
      back: 'Async delivery separates the two by the queue delay, and a write-time timestamp misdates and reorders the whole stream.',
      topic: 'buffering',
    },
    {
      id: 'fc-lg-7',
      front: 'Why must a full buffer never block the caller?',
      back: 'A logging bottleneck would become an application outage — under exactly the load that produces the most logs, so the failure correlates with the incident.',
      topic: 'buffering',
    },
    {
      id: 'fc-lg-8',
      front: 'Drop the oldest or the newest, and why?',
      back: 'Oldest, for a diagnostic stream: lose context, keep the crisis. Dropping the newest discards the record of what is happening now.',
      topic: 'buffering',
    },
    {
      id: 'fc-lg-9',
      front: 'What is better than either drop policy?',
      back: 'Level-aware sampling — keep everything above Warn, shed a fraction of Debug and Info.',
      topic: 'buffering',
    },
    {
      id: 'fc-lg-10',
      front: 'What is a logger\'s honest guarantee?',
      back: 'A record is either written or counted as dropped. "Never lost" is not achievable; silent loss is worse than the loss itself.',
      topic: 'buffering',
    },
    {
      id: 'fc-lg-11',
      front: 'Why is an unbounded shutdown flush wrong?',
      back: 'A stalled log endpoint prevents the process exiting, so a clean shutdown becomes a hang and then a kill — which loses everything instead of some.',
      topic: 'shutdown',
    },
    {
      id: 'fc-lg-12',
      front: 'Why does Fatal bypass the buffer?',
      back: 'The process may not survive to drain a queue, and it is the one record you cannot afford to lose. The latency cost no longer matters on that path.',
      topic: 'shutdown',
    },
    {
      id: 'fc-lg-13',
      front: 'Why isolate each sink write, and why count failures?',
      back: 'An exception escaping log() makes the application fail inside a logging statement. And a swallowed exception means a broken sink is silent for days.',
      topic: 'sinks',
    },
    {
      id: 'fc-lg-14',
      front: 'Which test is almost never written, and what does it assert?',
      back: 'That the expensive message builder was NOT called when the level is disabled — a negative assertion, and the only way to verify the cost property.',
      topic: 'levels',
    },
  ],

  quiz: [
    {
      id: 'q-lg-1',
      kind: 'scenario',
      prompt:
        'An Error record should reach the console, a file and a remote aggregator. What does chain of responsibility deliver?',
      options: [
        { id: 'a', label: 'One destination — the first handler that copes stops the chain, which is the wrong delivery semantics' },
        { id: 'b', label: 'All three, since each handler passes the record along' },
        { id: 'c', label: 'All three, because the chain is traversed fully' },
        { id: 'd', label: 'None, because no handler is registered for Error' },
      ],
      correct: ['a'],
      explanation:
        'A chain stops at the first handler that handles the request — that is its defining property. Options b and c describe handlers that deliberately never stop, which is a linked list used as a loop rather than a chain, and is strictly worse than a list of sinks.',
      difficulty: 'core',
      topic: 'levels',
    },
    {
      id: 'q-lg-2',
      kind: 'scenario',
      prompt:
        'Debug logging is disabled. A hot path calls log.debug(`cart ${JSON.stringify(cart)}`). What is the cost?',
      options: [
        { id: 'a', label: 'The full serialisation and interpolation, because they run before log() is entered — and it is invisible since no output appears' },
        { id: 'b', label: 'Nothing, because the level check returns early' },
        { id: 'c', label: 'One function call' },
        { id: 'd', label: 'The cost of writing to the disabled sink' },
      ],
      correct: ['a'],
      explanation:
        'Arguments are evaluated at the call site, so the level check inside log() is too late to help. This is often the dominant cost of a disabled log statement, and the fix is an API shape — structured fields, or a lazy thunk — rather than a faster check.',
      difficulty: 'core',
      topic: 'levels',
    },
    {
      id: 'q-lg-3',
      kind: 'scenario',
      prompt:
        'The log buffer is full during a traffic spike. What should log() do?',
      options: [
        { id: 'a', label: 'Drop a record per policy, count the drop, and return immediately — preferably sampling by level' },
        { id: 'b', label: 'Block until the writer drains space' },
        { id: 'c', label: 'Grow the buffer as needed' },
        { id: 'd', label: 'Write synchronously to bypass the buffer' },
      ],
      correct: ['a'],
      explanation:
        'Blocking turns a logging bottleneck into an application outage, precisely during the load that produces the most logs — so the failure correlates with the incident. Growing the buffer defers the problem into memory exhaustion, and synchronous writes reintroduce I/O on the hot path.',
      difficulty: 'core',
      topic: 'buffering',
    },
    {
      id: 'q-lg-4',
      kind: 'scenario',
      prompt:
        'Records are stamped with a timestamp when the writer thread writes them rather than when log() is called. What breaks?',
      options: [
        { id: 'a', label: 'Every record is misdated by the queue delay, and records can appear out of order relative to when they happened' },
        { id: 'b', label: 'Nothing, since the delay is small' },
        { id: 'c', label: 'Only the ordering within a single sink' },
        { id: 'd', label: 'The level filtering becomes incorrect' },
      ],
      correct: ['a'],
      explanation:
        'The queue delay varies with load, so the misdating is largest exactly when the logs matter most. Logs whose timestamps do not reflect when events happened are unusable for the purpose they are most needed for — reconstructing a sequence during an incident.',
      difficulty: 'advanced',
      topic: 'buffering',
    },
    {
      id: 'q-lg-5',
      kind: 'scenario',
      prompt:
        'At shutdown the logger flushes until every buffered record is written. The remote sink is stalled. What happens?',
      options: [
        { id: 'a', label: 'The process cannot exit, so a clean shutdown becomes a hang and then a forced kill — losing everything rather than some' },
        { id: 'b', label: 'The flush completes once the network recovers' },
        { id: 'c', label: 'The records are written to the other sinks and the process exits' },
        { id: 'd', label: 'Nothing — flushing is fast' },
      ],
      correct: ['a'],
      explanation:
        'An unbounded flush makes exit depend on an external system. A deadline converts an unbounded hang into a bounded loss, and the shutdown should report what was flushed, what was dropped and which sinks errored — because silently discarding the remainder repeats the silent-drop dishonesty.',
      difficulty: 'advanced',
      topic: 'shutdown',
    },
    {
      id: 'q-lg-6',
      kind: 'multi',
      prompt:
        'Which of these belong in a logger design? Select all that apply.',
      options: [
        { id: 'a', label: 'A per-sink try around each write, with a failure counter per sink' },
        { id: 'b', label: 'A synchronous path for Fatal records' },
        { id: 'c', label: 'A dropped-record count emitted as a log record' },
        { id: 'd', label: 'A handler class for each severity level' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'The first three are the substance: isolation so the observability component cannot cause the incident, a synchronous fatal path because the process may not survive to drain, and honesty about loss. A class per level is the over-engineering this problem is known for.',
      difficulty: 'core',
      topic: 'sinks',
    },
  ],

  exercises: [
    {
      id: 'ex-lg-1',
      kind: 'implement',
      title: 'Add the three features that change the guarantees',
      estimatedMinutes: 45,
      prompt: `Starting from the logger in this lesson, add three features. For each, write the code and say what it does to the invariant.

**Part 1 — child loggers with bound context.** \`log.child({ requestId })\` returns a logger whose records carry that field automatically, and whose children compose.

**Part 2 — a retrying HTTP sink.** Batches records and posts them, retrying on failure with backoff. Decide what it does when retries keep failing.

**Part 3 — an audit sink with a different guarantee.** Audit records must not be dropped. Reconcile that with a logger whose contract is "written or counted".

**Part 4.** One of these three conflicts with the design's central decision. Identify it and give the honest resolution.

Then answer:

- In Part 1, should a child logger be able to lower its own level below the parent's?
- What is the worst failure mode of the retrying sink, and how do you bound it?`,
      rubric: [
        'Child logger binds fields and composes, without copying the buffer or sinks.',
        'States that child context is merged rather than replacing parent fields.',
        'HTTP sink batches, retries with backoff, and has a bounded retry buffer.',
        'Decides and defends what happens when retries are exhausted.',
        'Identifies the audit requirement as conflicting with the non-blocking contract.',
        'Resolves it without making the diagnostic path blocking.',
        'Answers the child-level question with reasoning about intent.',
        'Names the retrying sink\'s worst failure and bounds it.',
      ],
      modelAnswer: `**Part 1 — child loggers: an addition, and the invariant is unchanged**

\`\`\`ts
class Logger {
  constructor(
    private readonly core: LoggerCore,        // buffer + sinks
    private readonly bound: Fields = {},
    private readonly minLevel: Level = core.minLevel,
  ) {}

  child(fields: Fields, minLevel?: Level): Logger {
    return new Logger(
      this.core,                              // SHARED, not copied
      { ...this.bound, ...fields },           // merged
      minLevel ?? this.minLevel,
    );
  }

  log(level: Level, msg: string, fields?: Fields): void {
    if (level < this.minLevel) return;
    this.core.emit({
      level, msg,
      fields: fields ? { ...this.bound, ...fields } : this.bound,
      at: this.core.clock.now(),
    });
  }
}
\`\`\`

**Three decisions worth defending.**

**The core — buffer, sinks, clock, drop counters — is shared, not copied.** A child that copied the buffer would have its own drop accounting and its own writer, **so a request-scoped child logger per request would create a buffer per request.** The child is a façade over one core.

**Fields merge, with the call site winning.** \`{...bound, ...fields}\` means an explicit field at the call site overrides a bound one — **which is the right precedence, because the caller is more specific.**

**And the merge happens after the level check**, so a disabled record allocates nothing. **Easy to get backwards**, and the cost is an object allocation per suppressed log call in a hot path.

*The invariant is unchanged:* every record still reaches every qualifying sink, still never blocks, still written-or-counted. **A child logger is a way of constructing records, not a change to delivery** — which is why this extension is free.

---

**Part 2 — a retrying HTTP sink**

\`\`\`ts
class HttpSink implements Sink {
  private batch: LogRecord[] = [];
  private pending: LogRecord[][] = [];      // bounded retry queue
  private failures = 0;
  private circuitOpenUntil = 0;

  constructor(
    readonly minLevel: Level,
    private readonly post: (b: LogRecord[]) => Promise<void>,
    private readonly clock: Clock,
    private readonly cfg = {
      batchSize: 100, maxPendingBatches: 20,
      baseBackoffMs: 200, maxBackoffMs: 30_000,
      circuitBreakMs: 60_000, maxFailures: 5,
    },
  ) {}

  write(record: LogRecord): void {
    this.batch.push(record);
    if (this.batch.length >= this.cfg.batchSize) this.seal();
  }

  private seal(): void {
    if (this.batch.length === 0) return;
    if (this.pending.length >= this.cfg.maxPendingBatches) {
      this.pending.shift();                 // DROP the oldest batch
      this.droppedBatches++;                //   and count it
    }
    this.pending.push(this.batch);
    this.batch = [];
  }

  async tick(): Promise<void> {
    const now = this.clock.now();
    if (now < this.circuitOpenUntil) return;   // circuit open
    const batch = this.pending[0];
    if (!batch) return;
    try {
      await this.post(batch);
      this.pending.shift();
      this.failures = 0;
    } catch {
      this.failures++;
      if (this.failures >= this.cfg.maxFailures) {
        this.circuitOpenUntil = now + this.cfg.circuitBreakMs;
        this.failures = 0;
      }
    }
  }
}
\`\`\`

**Four decisions, and the second is the one that matters.**

**Batching, because one HTTP request per record is untenable** at any real log volume.

**The retry queue is bounded and drops the oldest batch.** This is the crucial choice: **an unbounded retry queue during an endpoint outage grows until the process runs out of memory** — so the logger, whose entire purpose is to observe a problem, becomes the cause of a worse one. **Bounding it means an outage costs log records rather than the application.**

**Backoff plus a circuit breaker.** Retrying a dead endpoint every 200 ms for an hour wastes connections and file descriptors, **and it is also a self-inflicted load on a system that is already unhealthy.** The breaker stops trying for a minute, which is the resilience lesson applied inside a sink.

**And \`tick\` is driven by the writer loop rather than by a timer per sink.** One scheduler for all sinks, **so a sink is passive machinery rather than an independent actor.**

*What happens when retries are exhausted:* **the batch is dropped and counted.** *And crucially:* **the dropped count is emitted through the logger itself**, so it lands in the sinks that are still working — which is how you find out the HTTP sink is broken.

*The invariant change:* **"written or counted" now has a longer tail.** A record can be counted as dropped minutes after \`log()\` returned, **so the accounting is eventually consistent** — worth stating, because it means a shutdown report may undercount.

---

**Part 3 — the audit sink, which is the conflict**

\`\`\`
Logger contract:  log() never blocks; a record is written or
                  counted as dropped
Audit requirement: an audit record must not be dropped
\`\`\`

**These cannot both hold in one path**, and pretending otherwise is the failure mode. **An audit record that must not be lost has to be acknowledged as durable before the caller proceeds** — which means blocking.

**The honest resolution: audit is not logging, and it should not go through the logger.**

\`\`\`ts
// Separate component, separate contract
interface AuditWriter {
  record(event: AuditEvent): Promise<void>;   // AWAITED
}
\`\`\`

**Three reasons this is the right answer rather than an evasion.**

**The guarantees are genuinely different, and the difference is who absorbs failure.** A diagnostic record is best-effort because losing one costs some insight. **An audit record is a business or legal obligation**, so failing to write it must fail the operation that generated it. **A caller that must not proceed without the write has to await it.**

**And the call sites are different.** Audit events are deliberate, rare and attached to specific business actions — **a payment, a permission change, a data export.** Diagnostic logs are everywhere. **Putting a blocking write behind the same API as a hot-path debug call is how a debug statement ends up blocking on a database.**

**The mechanisms are also different.** Audit needs durability, ordering, retention, and probably an append-only store with an integrity property — **which is the payments lesson's ledger, not a log sink.**

*What I would keep in common:* the record shape and the correlation context, **so an audit event and the diagnostic logs around it can be joined.** That is a shared data model, not a shared pipeline.

*And if forced to put it in the logger anyway* — a legitimate constraint in a small system — **the honest form is a distinct method with a distinct signature:**

\`\`\`ts
async audit(event: AuditEvent): Promise<void>   // returns a promise
\`\`\`

**The different return type is the point:** it makes blocking visible at every call site, **so nobody adds one to a hot path by accident.** An API whose shape hides its cost is the problem.

---

**Part 4 — which conflicts, and the resolution**

**Part 3 conflicts, and the conflict is with the design's central decision: that \`log()\` never blocks.**

**That decision is not a preference; it is what stops the logger amplifying an incident.** A blocking logger under load becomes an application outage, **and it happens during exactly the traffic that generates the most records** — so the failure is correlated with the problem you are trying to observe.

**So the resolution cannot be "make the logger blocking for some levels".**

\`\`\`
Tempting:  if (level === Audit) writeSync();
Problem:   now some log calls block, and the call sites
           cannot tell which
           → a hot path adds an audit-level record
           → and the application inherits the sink's latency
\`\`\`

**The type system is the defence.** A method returning \`void\` promises not to block; **one returning \`Promise<void>\` announces that it might.** Two methods with two return types is a stronger guarantee than a convention.

*And the general principle worth extracting:* **when a new requirement contradicts a component's central guarantee, the answer is a second component, not a mode.** A mode means every caller must know which mode they are in, **and callers do not know** — which is how a debug statement acquires a network round trip.

**Parts 1 and 2 by contrast fit cleanly.** The child logger changes record construction; the retrying sink changes what happens after the buffer. **Neither touches the non-blocking contract** — which is a useful test of whether an extension belongs inside a component: **does it preserve the guarantee the component exists to provide?**

---

**Should a child logger be able to lower its own level below the parent's?**

**Yes, and it is one of the main reasons child loggers are worth having — but the parent's level must remain a ceiling in one specific sense.**

\`\`\`
Parent at Info.
child({ requestId }, Level.Debug)
  → this request logs at Debug while everything else stays Info
  → which is exactly what you want for debugging one tenant,
    one endpoint, or one slow request
\`\`\`

**So a child lowering its threshold is a feature: per-request or per-subsystem verbosity without a global change.**

**The ceiling that must hold is the sinks'.** A child at \`Debug\` produces debug records, **and a sink whose own threshold is \`Info\` still will not write them** — because a sink's threshold is about what that destination can handle, not about what the caller wants. **Two independent filters, and both apply.**

*Which yields the rule:* **the child's level controls whether a record is created; the sink's level controls whether it is written.** Conflating them is how "I lowered the level and nothing appeared" happens.

**And one caution worth stating:** a child at \`Trace\` in a hot path **pays the full record-construction cost** even if every sink discards the records. **So a per-request debug level should be paired with a sink that accepts it**, or it is pure cost — which is a footgun the API cannot prevent and the documentation should mention.

---

**The retrying sink's worst failure, and how to bound it**

**The worst failure is an unbounded retry queue during a prolonged endpoint outage, because it converts an observability problem into an application crash.**

\`\`\`
Endpoint down for 30 minutes, 5,000 records/second
→ 9 million records queued
→ at ~500 bytes each: ~4.5 GB
→ the process is killed for memory
→ and it takes the application with it
\`\`\`

**The logger would have caused the outage while trying to report one**, which is the exact inversion this whole design exists to prevent.

**Four bounds, and they address different aspects.**

**A bounded pending queue, dropping the oldest batch.** The primary defence, and it caps memory at a known figure: \`maxPendingBatches × batchSize × recordSize\`. **With 20 batches of 100 records that is about a megabyte** — which is the number to state.

**A circuit breaker.** Without it, the sink retries a dead endpoint continuously, **consuming connections and CPU and adding load to a system that is already failing.** Sixty seconds of not trying costs nothing.

**Exponential backoff with jitter** between attempts, so a fleet of processes does not synchronise its retries into a spike the moment the endpoint recovers — **the herd problem again, and the recovery is exactly when the endpoint is most fragile.**

**And a deadline per record.** A record forty minutes old is almost certainly worthless, **so a batch older than some threshold should be discarded rather than retried** — which bounds the queue by time as well as by size, and stops a recovering endpoint being flooded with stale data.

*Plus the observability requirement:* **the sink's dropped-batch count, failure count and circuit state must be visible through the other sinks.** A broken HTTP sink that drops silently is indistinguishable from a quiet system, **and the whole point of counting drops is that you find out.**

*The transferable form:* **any component that retries on behalf of someone else needs a bound on memory, a bound on attempts, a bound on age, and a way to report what it gave up.** Three of those are easy to forget, and the memory bound is the one whose absence takes the process down.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lg-1',
      level: 'basic',
      question: 'Design and implement a logger.',
      guidance:
        'Look for a level threshold plus a list of sinks, and for explicit rejection of chain of responsibility. A class per level is the standard over-engineering here.',
    },
    {
      id: 'iq-lg-2',
      level: 'basic',
      question: 'How do levels work, and where is the check?',
      guidance:
        'Gapped integers, compared first in log(). Strong answers add that the check cannot save the caller\'s formatting cost, which is an API-shape problem.',
    },
    {
      id: 'iq-lg-3',
      level: 'intermediate',
      question: 'Multiple destinations with different thresholds — how?',
      guidance:
        'One Sink interface with a minLevel field; broadcast to every qualifying sink, each isolated in a try. Look for per-sink failure counting.',
    },
    {
      id: 'iq-lg-4',
      level: 'intermediate',
      question: 'Writing to a file on every log call is slow. Fix it.',
      guidance:
        'A bounded buffer and a writer, with the timestamp captured at call time. Strong answers immediately raise what happens when the buffer is full.',
    },
    {
      id: 'iq-lg-5',
      level: 'advanced',
      question: 'The buffer is full. What happens?',
      guidance:
        'Never block; drop the oldest by default, better still sample by level, and always count and emit the drops. "Written or counted" is the honest guarantee.',
    },
    {
      id: 'iq-lg-6',
      level: 'advanced',
      question: 'The process is shutting down. What about buffered records?',
      guidance:
        'Stop accepting, drain to a deadline, flush, and report losses. Excellent answers explain why an unbounded flush loses more than a bounded one.',
    },
    {
      id: 'iq-lg-7',
      level: 'followup',
      question: 'How would you log the last line before a crash?',
      guidance:
        'Fatal bypasses the buffer and writes synchronously, because the process may not survive to drain a queue.',
    },
    {
      id: 'iq-lg-8',
      level: 'followup',
      question: 'Some records must never be lost. Now what?',
      guidance:
        'That is a different contract, so a different component with a Promise-returning API. Look for refusal to make some log calls blocking, since callers cannot tell which.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lg-1',
      kind: 'debug',
      prompt:
        'An application\'s p99 latency degrades from 80 ms to 900 ms during traffic spikes. CPU is not saturated, the database is healthy, and no application code changed. The only correlation: the log volume rises with the spike. Profiling shows time spent inside a logging call. Diagnose it.',
      discussion: `**"Time spent inside a logging call" with healthy downstream dependencies** points at the logger itself, and there are only a few ways a logger costs a caller 800 milliseconds.

**Hypothesis 1 — the buffer blocks when full.**

If \`log()\` waits for space, **the caller's latency includes however long the writer takes to drain** — and during a spike the writer is behind by definition.

*Why it fits perfectly:* the degradation correlates with log volume, appears only at spikes, and is inside the logging call. **And it is the failure this design exists to prevent**: the logging bottleneck has become application latency, under exactly the load that produces the most records.

*Check:* the buffer's overflow policy. **If it blocks, the diagnosis is done** — and the fix is to drop with a counter instead.

**Hypothesis 2 — synchronous writes to a slow sink.**

If any sink writes synchronously from \`log()\` — a file without buffering, or worse an HTTP post — **the caller pays that I/O.** A file write to a saturated disk can take hundreds of milliseconds.

*Why it fits:* during a spike the disk is busier, **so the same write costs more.** *Check:* whether every sink goes through the buffer, **and specifically whether an "emergency" or "audit" level was given a synchronous path** — which is the mode-not-component mistake, and it means some log calls block while the call sites cannot tell which.

**Hypothesis 3 — message construction, not the logger at all.**

The profile shows time "inside a logging call", **which includes the argument evaluation at the call site.**

\`\`\`
log.debug(\`state \${JSON.stringify(bigObject)}\`)
→ serialisation runs even with debug disabled
→ and bigObject is larger during a spike (more items,
   longer collections)
\`\`\`

**So the cost grows with load for a reason unrelated to logging volume** — and the output is absent, so nobody suspects it.

*Why this is a strong candidate:* it explains CPU not being saturated overall while individual requests stall, **and it explains why no code changed** — the data got bigger, not the code. *Check:* whether the hot paths use interpolation, and whether the expensive arguments are only needed at a disabled level.

**Hypothesis 4 — lock contention on the buffer.**

If the buffer is guarded by a single mutex and every request thread logs several times, **the lock becomes a serialisation point.** At 10,000 requests per second with five log calls each, that is 50,000 lock acquisitions per second on one mutex.

*Why it fits:* contention rises super-linearly with concurrency, **so a spike produces a disproportionate latency increase** — which matches an 11× degradation better than a linear cost would.

*Check:* the buffer's synchronisation. **The fix is a lock-free ring buffer or per-thread buffers drained by the writer**, which removes the shared point entirely.

**Hypothesis 5 — the sinks are called from the caller's thread rather than the writer's.**

A "buffered" logger that drains inline — the caller that fills the buffer also flushes it — **means one unlucky caller per batch pays the entire batch's I/O.** That would show as a bimodal latency distribution: most calls fast, occasional calls very slow.

*Check:* the latency distribution shape, and whether there is a genuine separate writer. **A p99 degrading while p50 holds is the signature**, and the stated symptom — p99 at 900 ms — is consistent with it.

**What I would check first: the overflow policy and whether any sink is synchronous.** Two code reads, and between them they cover hypotheses 1, 2 and 5 — **the three where the logger genuinely holds the caller.**

**Then: whether the hot paths interpolate.** Hypothesis 3 is the one that is not the logger's fault and is the most commonly missed, **and it is fixed at the call sites rather than in the component.**

**Why "CPU is not saturated" is the most useful evidence.**

It argues against pure computation and toward **waiting** — for a lock, for a disk, or for buffer space. **A logger that burns CPU would show as saturation; one that blocks shows as latency with idle cores**, which is the reported picture.

**And it sharpens hypothesis 3 in a specific way:** if the cost were interpolation, CPU *would* rise. **So the evidence points at blocking, with message construction as the secondary candidate** — which is a useful ordering that the raw symptom list does not give you.

**The instrumentation this demands.**

**Time spent in \`log()\`, as a histogram.** The single most valuable metric here, and almost nobody has it: **a logging call should be tens of nanoseconds when disabled and a microsecond or two when buffered.** Anything with a visible p99 is a bug.

**Buffer depth and drop count, continuously.** Depth approaching capacity is the leading indicator of hypothesis 1, **and it precedes the latency symptom** — so it is the alert that would have caught this before customers did.

**A count of blocked-on-buffer events.** If the policy ever blocks, that count should exist and should be zero. **A policy that is supposed to be non-blocking needs a metric proving it.**

**Per-sink write latency.** It attributes the cost to a destination, **and it is what distinguishes a slow disk from a stalled endpoint.**

**And a disabled-level cost check in the test suite.** The negative test from the lesson — assert the expensive builder is not called — **plus a benchmark asserting that a disabled log call is under some nanosecond budget.** It is the only way hypothesis 3 gets caught before production.

**Transferable:** a component that sits on every code path must be measured on every code path. **The logger is the classic case where nobody instruments the instrument** — and the specific failure to guard against is not slowness in general but *blocking*, because blocking makes the observability layer correlated with the incident it exists to explain.`,
    },
    {
      id: 'al-lg-2',
      kind: 'what-changes-if',
      prompt:
        'Change the environment: this logger runs in a serverless function that may be frozen or terminated immediately after returning a response, with no shutdown hook. What survives, and what has to change?',
      discussion: `**The asynchronous buffer is the design's central mechanism, and it is exactly what this environment breaks** — because a buffer is a promise to write later, and there may be no later.

**What breaks, specifically.**

\`\`\`
Long-lived process:  log() → buffer → writer thread → sink
                     the writer runs continuously
Serverless:          the runtime may freeze the container
                     immediately after the response
                     → the writer never runs
                     → buffered records are lost, and the
                       loss is silent
\`\`\`

**And worse than losing them: the loss is invisible.** The drop counter is also in memory, **so the record of what was lost is lost with it.** The "written or counted" guarantee fails in both halves.

**What survives.**

**The record model** — levels, structured fields, call-time timestamps, correlation identifiers. Unchanged and more important, since **the correlation identifier is the only way to join a function invocation's logs.**

**The level filter and the broadcast.** Structural, cheap, unaffected.

**Sink isolation.** Still essential — a failing sink must not fail the invocation.

**And the cost argument about message construction** survives and intensifies: **serverless billing is per millisecond**, so an interpolation that happens for a disabled log statement is directly money.

**What has to change: flush before returning, not after.**

\`\`\`ts
// The handler wrapper owns the flush
export const handler = withLogging(async (event, log) => {
  log.info('handling', { id: event.id });
  return await work(event, log);
});

function withLogging(fn) {
  return async (event) => {
    const log = rootLogger.child({ requestId: event.requestId });
    try {
      return await fn(event, log);
    } finally {
      await rootLogger.flush(FLUSH_BUDGET_MS);   // ← before return
    }
  };
}
\`\`\`

**Three consequences, and the second is the uncomfortable one.**

**The flush moves into the request path**, so **every invocation pays it.** With a remote sink that is a network round trip added to every response — **which is precisely the coupling the buffer existed to avoid.**

**So the buffer's benefit largely disappears.** It still coalesces multiple records into one write, **which is worth a great deal** — twenty records become one batched post rather than twenty. **But it can no longer defer that write beyond the response**, so the latency saving is gone and only the batching saving remains.

**And the flush must be budgeted tightly.** A 2-second flush deadline on a 100 ms function **triples the p99 for nothing.** The budget should be small — tens of milliseconds — **with the remainder dropped and counted in the next invocation's first record.**

**Which suggests the honest alternative for this environment: write to standard output and let the platform collect it.**

\`\`\`
log() → format → process.stdout.write()
  · the platform's log collector reads the stream
  · no buffer, no flush, no lost records at freeze
  · the write is a local pipe, not a network call
\`\`\`

**This is what serverless platforms are built for**, and it inverts the earlier reasoning for a good reason: **the expensive I/O has been moved outside the process**, so the thing the buffer existed to avoid is no longer in the process at all. **The platform's collector does the batching, the retrying and the delivery.**

*What it gives up:* per-sink thresholds and formatting, **and any sink other than the platform's.** *What it gains:* the guarantee actually holds.

**So the answer depends on one question: is there a local, cheap, synchronous destination?**

\`\`\`
Yes (stdout collected by the platform)
  → write synchronously, no buffer, and the design simplifies
    dramatically
No (must post to a remote endpoint directly)
  → keep the buffer for batching, flush in the finally with
    a tight budget, and accept the latency
\`\`\`

**I would choose the first wherever it exists**, and say so — **because a design whose central guarantee cannot hold in an environment should be replaced there rather than patched.**

**Two smaller changes worth naming.**

**A frozen container may resume.** If the runtime reuses the container, **a buffer from the previous invocation may still hold records** — which are then written with the *previous* request's correlation context if the child logger was bound incorrectly. **Stamping the record with context at creation, which the design already does, is what makes this safe.**

**And the process may be terminated without any hook at all**, so there is no shutdown path to rely on. **The \`finally\` in the handler is the only reliable point** — which is an argument for the flush living in the wrapper rather than in the logger's lifecycle.

**The transferable point:** a buffer trades latency for a promise to write later, **so it is only valid where "later" is guaranteed to exist.** When the runtime can freeze or kill the process arbitrarily, that promise cannot be kept — and the right response is to move the expensive I/O out of the process entirely rather than to shorten the buffer's window. **Patching a mechanism whose precondition is gone produces a design that is both slower and still lossy.**`,
    },
  ],

  revision: {
    bullets: [
      'Chain of responsibility is the wrong shape: a chain stops at the first handler, and logging broadcasts.',
      'Level is data and the destination is what varies, so there is one Sink interface and no class per level.',
      'Filtering is one integer comparison against the logger threshold, then one per sink.',
      'Level numbers are gapped so a level can be inserted later without renumbering.',
      'The level check inside log() cannot save the caller\'s formatting cost.',
      'A structured API avoids string work entirely unless a sink formats, and makes fields queryable.',
      'Test the negative: assert the expensive message builder was not called when disabled.',
      'Stamp the record at call time — a write-time timestamp misdates and reorders the whole stream.',
      'Synchronous writes put file or network I/O on every application code path.',
      'A full buffer must never block: a logging bottleneck would become an application outage.',
      'And the failure would correlate with the incident, since load produces the most logs.',
      'Drop the oldest by default — lose context, keep the crisis.',
      'Level-aware sampling is better: keep everything above Warn, shed a fraction of Debug.',
      'Always count drops and emit the count; silent loss removes your ability to trust the logs.',
      'The honest guarantee is "written or counted as dropped", not "never lost".',
      'Isolate every sink write and count failures per sink, or a broken sink is silent for days.',
      'Shutdown: stop accepting, drain to a deadline, flush, and report what was lost.',
      'Fatal bypasses the buffer, because the process may not survive to drain a queue.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'A level threshold, a list of sinks each with its own threshold, structured records stamped at call time, and a bounded non-blocking buffer drained by a single writer — with isolation per sink and a bounded flush at shutdown.',
    whyItExists:
      'Because a logger sits on every code path, so its slowness or failure contaminates everything. Every decision here is about not amplifying a problem the logger is only meant to observe.',
    whenToUse: [
      'A level threshold plus a sink list, always — the structure is three lines.',
      'A structured API whenever disabled logging appears in a hot path.',
      'A bounded buffer for any file or network sink.',
      'Drop-oldest or level-aware sampling whenever the buffer can fill.',
      'A synchronous path for Fatal records.',
      'A bounded flush with a report at shutdown.',
    ],
    whenNotToUse: [
      'Chain of responsibility, or a class per level.',
      'A formatted-string API in a hot path.',
      'Synchronous sink writes from log().',
      'Blocking when the buffer is full.',
      'Growing the buffer instead of dropping.',
      'Silent drops, or a silent shutdown discard.',
      'An unbounded flush or an unbounded retry queue.',
      'A blocking mode on some levels, which callers cannot distinguish.',
    ],
    alternatives: [
      'Writing to standard output and letting the platform collect it, when a cheap local destination exists.',
      'A lazy message thunk, when one field is expensive but structure is unavailable.',
      'Per-thread buffers drained by one writer, when a single mutex becomes a contention point.',
      'A separate Promise-returning audit component, when records must not be dropped.',
      'A circuit breaker plus bounded pending batches inside a remote sink.',
    ],
    tradeoffs: [
      'A buffer buys latency isolation and costs records on a crash plus a drop policy.',
      'Structured fields buy cheap disabled logging and cost call-site verbosity.',
      'Drop-oldest buys the crisis and costs the lead-up.',
      'Level-aware sampling buys the important records and costs a sampling policy.',
      'A bounded flush buys a bounded loss instead of an unbounded hang.',
      'A synchronous fatal path buys the last record and costs latency where it no longer matters.',
      'A retrying sink buys delivery through transient failures and needs bounds on memory, attempts and age.',
    ],
    failureModes: [
      'A chain delivering a record to one destination instead of all.',
      'A class per level, on an axis that does not vary.',
      'Full formatting cost paid for a disabled debug statement.',
      'A write-time timestamp misdating and reordering the stream.',
      'A blocking buffer turning a spike into an outage.',
      'An unbounded buffer becoming memory exhaustion.',
      'Silent drops removing the ability to know the logs are incomplete.',
      'An exception from a sink failing the application inside log().',
      'A swallowed sink exception hiding a broken sink for days.',
      'An unbounded shutdown flush hanging the process until it is killed.',
      'A buffered fatal record lost when the process dies.',
      'An unbounded retry queue in a remote sink crashing the process during an endpoint outage.',
    ],
    followUpQuestions: [
      'Does every interested sink get the record, or just the first?',
      'Is the interface on the level axis or the destination axis?',
      'What does a disabled log call cost at the call site?',
      'When is the timestamp captured?',
      'What happens when the buffer is full, and is it counted?',
      'Is the drop policy level-aware?',
      'Is a sink failure isolated, and is it counted?',
      'Is the shutdown flush bounded, and does it report losses?',
      'Does Fatal go through the buffer?',
      'What bounds a retrying sink\'s memory?',
      'Is there a metric for time spent inside log()?',
    ],
  },
});
