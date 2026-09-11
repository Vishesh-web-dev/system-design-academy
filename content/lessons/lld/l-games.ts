import { defineLesson } from '../../schema';

export default defineLesson({
  slug: 'l-games',
  title: 'Design Tic-Tac-Toe and Snake',
  summary:
    'Two grid games that look alike and are structurally opposite: one is turn-based with a terminal check, the other is a fixed-timestep loop with continuous state — and forcing them through one abstraction is the mistake the pairing exists to expose.',
  phase: 'lld',
  module: 'machine-coding',
  position: 69,
  kind: 'machine-coding',
  difficulty: 'core',
  estimatedMinutes: 65,
  tags: ['board', 'win-detection', 'game-loop', 'extensibility'],
  prerequisites: ['l-elevator'],
  resources: [
    {
      key: 'refactoring-guru-patterns',
      tier: 'must',
      note: 'Read strategy once more, for the win rule specifically. It is the seam the extensibility requirement names, and the interesting part is that a good win rule is incremental rather than a scan — which constrains what the interface can look like.',
    },
    {
      key: 'kent-beck-tdd',
      tier: 'must',
      note: 'Read it for deterministic feedback. A game with random food placement is untestable until the randomness is injected, and that single change turns "run it and see" into an assertable sequence.',
    },
    {
      key: 'xstate-statecharts',
      tier: 'good',
      note: 'Read it for the game lifecycle — waiting, running, paused, over — and for guards. A move accepted while the game is over is a class of bug that a state machine removes rather than detects.',
    },
    {
      key: 'refactoring-guru-solid',
      tier: 'good',
      note: 'Read open-closed with this problem in mind: "extensible to N×N and new rules" names two extensions that need different mechanisms — a parameter for one and an implementation for the other.',
    },
    {
      key: 'gof-patterns-ref',
      tier: 'advanced',
      note: 'Read the strategy entry\'s applicability section. Useful for defending why the win rule is a strategy and the board is not — the board varies by size, which is data, and the win rule varies by algorithm.',
    },
  ],

  intuition: {
    body: `Two grid games in one question is a setup, and the trap is the obvious abstraction.

\`\`\`
Both have:  a grid, a loop, a terminal condition
So:         Game { board; move(); isOver() }
            with TicTacToe and Snake implementing it
\`\`\`

**They are structurally opposite, and the interface hides it.**

\`\`\`
TIC-TAC-TOE   turn-based. Nothing happens between moves.
              A move is a cell. State changes only on input.
              Terminal condition checked after each move.

SNAKE         real-time. Everything happens between inputs.
              A move is a DIRECTION, and the snake advances
              on a clock whether or not you press anything.
              Terminal condition checked every tick.
\`\`\`

**A shared \`move()\` forces one of them to lie.** Either Snake gets a move method that does not describe how it works, **or tic-tac-toe gets a tick that does nothing** — and the second is closer to honest, which is a hint about the real relationship.

**What genuinely generalises is the board: a bounded grid of cells with coordinates.** What does not is the loop, and **saying so is the point of the pairing.**

Then the detail that separates a good tic-tac-toe from a working one: **win detection should not be a scan.**

\`\`\`
Naive:        after each move, check every row, column
              and both diagonals — O(n²) for an n×n board
Better:       check only the lines through the last move
              — O(n)
Best:         keep a counter per line per player; a move
              updates at most four counters, and a win is
              a counter reaching n — O(1)
\`\`\`

**And the counter version is the one that generalises**, because Connect-4 and Gomoku are the same idea with a different line definition.

**And for Snake, the bug everyone writes: two direction changes inside one tick.**

\`\`\`
moving right → press up → press left → tick
→ the snake is now moving left, into its own neck
→ instant death, and the player pressed nothing illegal
\`\`\`

**Inputs must be queued and applied at most one per tick**, with a reversal rejected against the direction the snake is actually moving — **not the last one pressed.**`,
    analogyLimit:
      '"They are both grid games" is true and produces the wrong design, because the grid is the least interesting thing they share. One changes state only on input and the other changes state on a clock, which means their loops, their input handling and their terminal checks have nothing in common — so a shared move() method forces one of them to describe itself dishonestly. The board generalises; nothing above it does.',
  },

  deepExplanation: {
    predict: {
      question:
        'A candidate proposes `interface Game { makeMove(move: Move): void; isOver(): boolean; getWinner(): Player | null }` with `TicTacToe` and `Snake` implementing it; tic-tac-toe checks all rows, columns and diagonals after each move; Snake reads the keyboard inside its loop and places food with `Math.random()` until it finds an empty cell. Identify four problems.',
      answer: `**Problem 1 — the shared interface misrepresents Snake.**

\`\`\`
makeMove(move) for tic-tac-toe: place a mark, evaluate, done.
makeMove(move) for Snake:       ...what?
  · a direction change does not advance the game
  · the game advances with no move at all
  · and the terminal condition arises between moves
\`\`\`

**So Snake either implements \`makeMove\` as "buffer a direction and return", which does not mean what the interface says, or it implements it as "buffer and advance one tick", which couples the frame rate to the player's typing.**

**The interface was derived from a surface similarity**, and the test that would have caught it is the one from the object-design lesson: **ask what each behaviour needs.** Tic-tac-toe's needs a cell; **Snake's needs a direction and elapsed time** — two different things wearing one name.

*What a correct split looks like:* **share the board and nothing above it.** If a common lifecycle is wanted, \`state(): 'running' | 'over'\` is honest; **\`makeMove\` is not.**

**Problem 2 — scanning the whole board after every move.**

For 3×3 it is irrelevant. **The requirement says extensible to N×N**, and for Gomoku on 19×19 a scan after every move is 19 rows plus 19 columns plus 2 diagonals of 19 cells — **around 760 cell reads per move, for a move that can only have created a line through itself.**

**Only lines through the last move can have changed**, so checking those four is O(n); **and counters per line make it O(1).** The scan is not wrong, it is the answer that does not survive the stated extension.

**Problem 3 — reading the keyboard inside the game loop.**

\`\`\`
loop() {
  const key = readKey();          // ← blocking, or coupled to I/O
  advance();
}
→ the game cannot be tested without simulating a keyboard
→ the tick rate is coupled to input
→ and two keys pressed between ticks are lost or misapplied
\`\`\`

**The loop should take elapsed time and a queue of inputs**, both supplied by the caller — **which makes the whole game a pure function of (state, inputs, now)** and therefore testable in the way the elevator was.

**Problem 4 — random food placement by rejection sampling, and untestable randomness.**

\`\`\`
do { pos = randomCell() } while (occupied(pos))
Empty board:      one attempt
Nearly full board: the snake occupies 95% of cells
                   → expected attempts ≈ 20
                   → worst case unbounded
\`\`\`

**It degenerates exactly when the game gets interesting**, and the last food may take thousands of attempts or hang.

*The fix:* **maintain the set of free cells** and pick an index — O(1), bounded, and it makes "no free cells" a detectable win rather than an infinite loop.

**And \`Math.random()\` directly makes the game untestable.** The seed must be injectable, **for the same reason the clock was in the previous three lessons.**

**Ranking. Problem 1 is the design error**, because it is the thing the pairing is testing. **Problem 3 makes the game untestable**, which blocks verifying everything else. Problem 2 fails the stated extensibility requirement. Problem 4 is a correctness-and-termination bug that appears only near the end of a game.

**The transferable diagnostic: when two things share an interface, check that each method means the same thing for both.** A method that has to be explained differently per implementation is a shared name, not a shared abstraction.`,
    },
  body: `## What generalises, and what does not

\`\`\`
SHARED:      a bounded grid with coordinates and cell access
             injected randomness and injected time
             a lifecycle: waiting → running → over

NOT SHARED:  the loop (turn-based vs fixed timestep)
             the input model (a cell vs a direction)
             the terminal check (after a move vs every tick)
\`\`\`

\`\`\`ts
class Board<T> {
  private readonly cells: (T | null)[];
  constructor(readonly rows: number, readonly cols: number) {
    this.cells = new Array(rows * cols).fill(null);
  }
  inBounds(r: number, c: number): boolean {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }
  get(r: number, c: number): T | null { /* bounds-checked */ }
  set(r: number, c: number, v: T | null): void { /* ... */ }
}
\`\`\`

**Three decisions.**

**A flat array with computed indices**, because a grid of arrays allocates a row object per row for no benefit and makes bounds checking two comparisons in two places.

**\`inBounds\` is public**, because Snake needs it for wall collision and tic-tac-toe for move validation — **the one piece of logic both genuinely share.**

**And the board is generic over the cell type.** Tic-tac-toe stores a player; **Snake stores what occupies the cell** — and making it generic costs nothing while making the reuse real rather than nominal.

## Tic-tac-toe: win detection that survives N×N

**The counter version, which is the answer worth writing.**

\`\`\`ts
class TicTacToe {
  private readonly n: number;
  // counts[player][line] — rows, then cols, then 2 diagonals
  private readonly rowCount: Map<Player, number[]>;
  private readonly colCount: Map<Player, number[]>;
  private readonly diag = new Map<Player, number>();
  private readonly anti = new Map<Player, number>();
  private movesPlayed = 0;

  place(r: number, c: number, p: Player): MoveResult {
    if (this.state !== 'running') return err('game-over');
    if (!this.board.inBounds(r, c)) return err('out-of-bounds', { r, c });
    if (this.board.get(r, c) !== null) return err('cell-taken', { r, c });

    this.board.set(r, c, p);
    this.movesPlayed++;

    const rc = ++this.rowCount.get(p)![r];
    const cc = ++this.colCount.get(p)![c];
    const dc = r === c ? this.bump(this.diag, p) : 0;
    const ac = r + c === this.n - 1 ? this.bump(this.anti, p) : 0;

    if (rc === this.n || cc === this.n || dc === this.n || ac === this.n)
      return ok({ result: 'win', player: p });
    if (this.movesPlayed === this.n * this.n)
      return ok({ result: 'draw' });
    return ok({ result: 'continue' });
  }
}
\`\`\`

**Four things this gets right.**

**A move updates between two and four counters**, so detection is O(1) regardless of board size — **and the stated extension to N×N costs nothing rather than degrading.**

**The draw is detected by a move count**, not by scanning for empty cells. **Another scan removed**, and it is exact.

**Errors are results with the offending coordinates**, so the caller can say "that cell is taken" rather than "invalid move" — **the result-over-boolean habit, in the smallest possible domain.**

**And the game-over check comes first.** A move accepted after the game ends is a whole class of bug, **and the guard is one line.**

*What this structure costs:* **it is specific to straight lines of length n through the whole board.** Which is fine for tic-tac-toe and is exactly what the next section has to change.

## Extending the win rule

**"New rules" is the second extension the prompt names, and it needs an interface rather than a parameter.**

\`\`\`ts
interface WinRule {
  /** Called after a move at (r, c). Incremental where possible. */
  evaluate(board: Board<Player>, r: number, c: number,
           p: Player): 'win' | 'continue';
}

class LineOfN implements WinRule {          // tic-tac-toe, Gomoku
  constructor(private readonly n: number) {}
  evaluate(board, r, c, p) {
    // Count outward in each of 4 axes from the last move:
    // horizontal, vertical, and both diagonals.
    for (const [dr, dc] of AXES) {
      const run = 1 + this.countRun(board, r, c, dr, dc, p)
                    + this.countRun(board, r, c, -dr, -dc, p);
      if (run >= this.n) return 'win';
    }
    return 'continue';
  }
}
\`\`\`

**Three decisions worth defending.**

**The rule evaluates from the last move outward**, which is O(n) in the win length rather than in the board — **so Gomoku's rule (five in a row on a 19×19 board) checks at most 4 × 9 cells**, regardless of how large the board is.

**This replaces the counter optimisation rather than composing with it**, and that is an honest trade: **counters are O(1) but assume a line spans the whole board.** Gomoku needs five in a row anywhere, which counters cannot express — **so the general rule is O(win length) and the specialised one is O(1), and you pick by which extension you were asked for.**

*If asked for both:* **keep counters for the full-board case and fall back to the outward scan for a shorter win length**, which is two implementations of one interface — exactly what the seam is for.

**And the rule takes the board rather than owning state**, so it is stateless and swappable mid-game if a variant demands it.

**The other extension — N×N — is a constructor parameter**, not a subclass. **Two extensions named in one sentence, needing different mechanisms**, which is the parking lot's lesson repeated deliberately.

*And placement is a third seam if Connect-4 is asked for:* a move names a **column**, and the row is derived by gravity — **so \`PlacementRule\` converts an input into a cell**, and the win rule is unchanged.

## Snake: the loop

\`\`\`ts
class SnakeGame {
  private body: Point[] = [];            // head first
  private direction: Direction = 'right';
  private pendingInputs: Direction[] = [];
  private growBy = 0;
  private lastStepAt = 0;

  /** Queue an input. Does NOT advance the game. */
  input(d: Direction): void {
    if (this.pendingInputs.length < MAX_QUEUED) this.pendingInputs.push(d);
  }

  tick(now: number): TickResult {
    if (this.state !== 'running') return { state: this.state };
    if (now - this.lastStepAt < this.stepMs) return { state: 'running' };
    this.lastStepAt += this.stepMs;                   // fixed timestep

    // Apply AT MOST ONE input, validated against the CURRENT direction
    while (this.pendingInputs.length > 0) {
      const d = this.pendingInputs.shift()!;
      if (d !== opposite(this.direction)) { this.direction = d; break; }
      // a reversal is dropped, and we try the next queued input
    }

    const head = step(this.body[0], this.direction);
    if (!this.board.inBounds(head.r, head.c)) return this.die('wall');
    if (this.occupiesBody(head, { ignoreTail: this.growBy === 0 }))
      return this.die('self');

    this.body.unshift(head);
    if (head.equals(this.food)) { this.growBy += GROW; this.placeFood(); }
    if (this.growBy > 0) this.growBy--; else this.body.pop();

    return { state: 'running' };
  }
}
\`\`\`

**Five things worth pointing at, and the first two are the bugs everyone writes.**

**At most one input is applied per tick, and it is validated against the current direction.** Two changes in one tick — right, then up, then left — **would otherwise reverse the snake into its own neck**, and the player pressed nothing illegal. **Validating against the last *pressed* direction rather than the last *moved* direction is the same bug with an extra step.**

**The tail is ignored during the self-collision check when the snake is not growing.** The tail cell is about to be vacated, **so moving into it is legal** — and forgetting this makes a snake following its own tail die for no visible reason.

**The timestep is fixed and accumulates.** \`lastStepAt += stepMs\` rather than \`= now\`, **so the game does not lose time on a slow frame** and the simulation stays deterministic under variable call rates.

**Growth is deferred with a counter.** Eating sets \`growBy\`, and the tail is retained for that many ticks — **which is simpler and more correct than inserting segments, because the snake grows from the head end as it moves.**

**And \`input\` does not advance anything.** The separation between input and time is what makes the game a pure function of (state, inputs, now) — **and it is what the shared \`makeMove\` interface would have destroyed.**

## Food placement

\`\`\`ts
private readonly free = new Set<CellIndex>();   // maintained on move

private placeFood(): void {
  if (this.free.size === 0) { this.win(); return; }
  const idx = this.rng.int(this.free.size);     // INJECTED rng
  this.food = nth(this.free, idx);
  this.free.delete(this.food);
}
\`\`\`

**Three decisions.**

**A free-cell set rather than rejection sampling.** Retrying random cells degenerates as the board fills — **twenty attempts at 95% occupancy, and unbounded in the worst case** — which is precisely when the game matters most.

**"No free cells" is a win**, not a hang. **The degenerate case becomes a terminal state rather than an infinite loop**, which is the kind of thing that only shows up when someone actually finishes the game.

**And the generator is injected**, so a seeded run is reproducible. **The third injected dependency in this module after the clock and the time source**, and for the same reason: **a test that cannot control randomness cannot assert a sequence.**

*The cost:* the free set must be maintained on every move — **one delete for the new head, one insert for the vacated tail** — which is two operations per tick and keeps placement O(1).

## Testing both

\`\`\`ts
test('a win is detected on the move that completes the line', () => {
  const g = new TicTacToe(3);
  g.place(0,0,'X'); g.place(1,0,'O');
  g.place(0,1,'X'); g.place(1,1,'O');
  expect(g.place(0,2,'X')).toEqual(ok({ result: 'win', player: 'X' }));
});

test('a full board with no line is a draw', () => { /* ... */ });

test('two inputs in one tick cannot reverse the snake', () => {
  const g = snakeAt([[5,5],[5,4],[5,3]], 'right', rng(1));
  g.input('up'); g.input('left');
  g.tick(STEP);
  expect(g.direction).toBe('up');            // left was dropped
  expect(g.state).toBe('running');
});

test('the snake may move into the cell its tail is vacating', () => {
  // a tight loop that would otherwise self-collide
});

test('food placement is deterministic under a seed', () => {
  expect(run(seed(42)).foodSequence)
    .toEqual(run(seed(42)).foodSequence);
});

test('a full board ends the game rather than hanging', () => {
  // fill every cell but one; the next food placement wins
});
\`\`\`

**The third and fourth tests are the ones that distinguish a working Snake**, because both bugs are invisible until a player does something ordinary — **turning twice quickly, or following their own tail.**

**And the sixth is the termination test**, which nobody writes until the rejection-sampling loop hangs in front of an interviewer.

## What to say in the last three minutes

**That the board generalises and the loop does not**, and that a shared \`makeMove\` would force Snake to describe itself dishonestly.

**That win detection is incremental** — counters for the full-board case, an outward scan from the last move for a win length — **and which one you chose for which extension.**

**That N×N is a parameter and a new rule is an implementation**, two extensions with two mechanisms.

**That at most one input is applied per tick, validated against the current direction**, and that the tail is ignored while not growing.

**That the timestep accumulates rather than resetting**, so the simulation is deterministic.

**And that randomness and time are both injected**, which is what makes any of this assertable.

**What you left out:** rendering, an opponent AI, multiplayer, and high scores.`,
  },

  visuals: [
    {
      kind: 'mermaid',
      id: 'shared-or-not',
      title: 'What the two games actually share',
      caption:
        'Read the middle column as the test: does this concept mean the same thing in both? The board does; the loop, the input and the terminal check do not — and a shared interface over them forces one game to misdescribe itself.',
      code: `flowchart TB
    subgraph T["**Tic-tac-toe**"]
      direction TB
      T1["**Turn-based**<br/>nothing happens between moves"]
      T2["A move is a **cell**"]
      T3["Terminal check **after each move**"]
      T4["Win: a line through the<br/>last move — O(1) with<br/>counters"]
    end

    subgraph S["**Shared**"]
      direction TB
      S1["**Board&lt;T&gt;**<br/>bounded grid, coordinates,<br/>inBounds()"]
      S2["**Injected randomness**<br/>and injected time"]
      S3["**Lifecycle**<br/>waiting → running → over"]
    end

    subgraph N["**Snake**"]
      direction TB
      N1["**Fixed timestep**<br/>everything happens<br/>between inputs"]
      N2["A move is a **direction**;<br/>the snake advances on<br/>a clock regardless"]
      N3["Terminal check **every tick**"]
      N4["Death: wall or self —<br/>and the tail cell is legal<br/>while not growing"]
    end

    T1 -.- S1
    N1 -.- S1

    X["**A shared makeMove() forces a lie:**<br/>either Snake's move does not advance<br/>the game (so it does not mean what the<br/>interface says), or it advances one tick<br/>(so the frame rate is coupled to typing).<br/><br/>**Test: does each method mean the same<br/>thing for both?** If it must be explained<br/>differently per implementation, it is a<br/>shared name, not a shared abstraction."]

    T2 -.-> X
    N2 -.-> X

    style S1 fill:#17272a,stroke:#35897e
    style S2 fill:#17272a,stroke:#35897e
    style S3 fill:#17272a,stroke:#35897e
    style X fill:#1c1814,stroke:#c99a4e`,
    },
    {
      kind: 'flow',
      id: 'snake-tick',
      title: 'One Snake tick, and the two bugs everyone writes',
      caption:
        'Step through it. Both bugs are invisible until a player does something ordinary — turning twice quickly, or following their own tail — which is why both need an explicit test.',
      nodes: [
        { id: 'input', label: 'input(direction) — queues only', kind: 'client', x: 0, y: 150, detail: 'Does not advance the game. Separating input from time is what makes the whole game a pure function of (state, inputs, now) — and it is exactly what a shared makeMove() interface would have destroyed.' },
        { id: 'timestep', label: 'Fixed timestep, accumulated', kind: 'service', x: 230, y: 40, detail: 'lastStepAt += stepMs rather than = now, so the game does not lose time on a slow frame and the simulation stays deterministic under a variable call rate. The same stored-deadline discipline as every other timed system in this module.' },
        { id: 'apply', label: 'Apply AT MOST ONE input', kind: 'note', x: 230, y: 200, detail: 'Right, then up, then left within one tick would reverse the snake into its own neck — and the player pressed nothing illegal. The reversal is validated against the direction the snake is actually moving, not the last one pressed, which is the same bug with an extra step.' },
        { id: 'head', label: 'Compute the new head', kind: 'service', x: 490, y: 120, detail: 'One cell in the current direction. Wall collision is Board.inBounds — the one piece of logic both games genuinely share.' },
        { id: 'self', label: 'Self-collision: ignore the tail while not growing', kind: 'note', x: 490, y: 280, detail: 'The tail cell is about to be vacated, so moving into it is legal. Forgetting this makes a snake following its own tail die for no visible reason — and it only happens in a tight loop, so it survives casual testing.' },
        { id: 'grow', label: 'Growth deferred by a counter', kind: 'service', x: 740, y: 120, detail: 'Eating sets growBy; the tail is retained for that many ticks. Simpler and more correct than inserting segments, because a snake grows from the head end as it moves.' },
        { id: 'food', label: 'Food from a free-cell set, seeded RNG', kind: 'store', x: 740, y: 280, detail: 'Rejection sampling degenerates as the board fills — twenty attempts at 95% occupancy and unbounded at worst, exactly when the game matters most. A free set makes it O(1), makes "no free cells" a win rather than a hang, and an injected generator makes the run reproducible.' },
      ],
      edges: [
        { id: 'g1', source: 'input', target: 'apply', kind: 'write' },
        { id: 'g2', source: 'timestep', target: 'apply', kind: 'control' },
        { id: 'g3', source: 'apply', target: 'head', kind: 'control' },
        { id: 'g4', source: 'head', target: 'self', kind: 'control' },
        { id: 'g5', source: 'head', target: 'grow', kind: 'control' },
        { id: 'g6', source: 'grow', target: 'food', kind: 'control' },
      ],
      steps: [
        {
          id: 'gs1',
          title: 'Input and time are separate inputs',
          description:
            'Queueing a direction does not advance anything. The game is a function of state, queued inputs and the current time — which is what makes every assertion a sequence of ticks.',
          nodes: ['input', 'timestep'],
          edges: [],
        },
        {
          id: 'gs2',
          title: 'One input per tick, validated against actual motion',
          description:
            'The first bug: two changes inside a tick reverse the snake into itself. Validating against the last pressed direction rather than the last moved one reproduces it exactly.',
          nodes: ['apply'],
          edges: ['g1', 'g2'],
        },
        {
          id: 'gs3',
          title: 'Then the head moves, and the tail is a special case',
          description:
            'The second bug: the cell the tail is vacating is legal to enter while not growing. A snake following its own tail dies for no visible reason without this.',
          nodes: ['head', 'self'],
          edges: ['g3', 'g4'],
        },
        {
          id: 'gs4',
          title: 'Growth is a counter, not an insertion',
          description:
            'Eating defers tail removal for a few ticks. Simpler than splicing segments and it matches how the snake actually grows.',
          nodes: ['grow'],
          edges: ['g5'],
        },
        {
          id: 'gs5',
          title: 'And placement must be bounded and seeded',
          description:
            'A free-cell set makes placement O(1) and turns a full board into a win rather than an infinite loop — and an injected generator is what makes the whole run reproducible.',
          nodes: ['food'],
          edges: ['g6'],
        },
      ],
    },
  ],

  productionExample: {
    systems: [],
    body: `There is no published system to cite for a pair of toy games, and the reference that matters is the open-closed reading from the parking-lot lesson — because this prompt names two extensions in one sentence and they need different mechanisms.

**"Extensible to N×N and to new rules" contains a size and an algorithm.**

\`\`\`
N×N:        a constructor parameter. The board is generic
            over its dimensions and nothing about the code
            changes.
New rules:  an implementation. A win condition is an
            algorithm over the board, and Gomoku's differs
            from tic-tac-toe's in kind rather than in size.
\`\`\`

**A candidate who gives both the same treatment gets one wrong**, and both directions are common: **subclassing for board size, or a configuration flag for the win rule.**

**The second idea worth taking is that the best implementation constrains the interface.** The O(1) counter approach for tic-tac-toe assumes a line spans the whole board, **so it cannot express "five in a row anywhere"** — which means the win-rule interface has to be shaped around the outward scan if both variants are required.

**That is an unusual and useful observation: an optimisation can be incompatible with a seam.** The counters are faster and less general; **the scan is slower and abstractable.** Choosing between them is choosing what you are being asked to extend.

**Three transferable lessons.**

**Read an extensibility requirement for what it contains**, not for the word "extensible". Sizes are parameters, algorithms are implementations.

**Check whether your fastest implementation fits behind the seam you are about to draw.** If it does not, you are choosing between speed and extension, **and the prompt usually says which it wants.**

**And a shared interface must mean the same thing to every implementer.** A method that has to be explained differently per class is a shared name — **which is the whole content of pairing these two games in one question.**

**Where this reading does not help.** It says nothing about the fixed timestep, the input queue or the collision special case, **and those are where a Snake implementation is actually wrong.** No principle catches them; only a test does.`,
  },

  tradeoffs: {
    intro:
      'The decisions the pair turns on, including the one about whether they share anything at all.',
    rows: [
      {
        option: 'A shared Game interface with makeMove',
        whenItWins:
          'Nowhere here. It is the obvious response to two grid games.',
        whenItLoses:
          'Snake advances on a clock, so makeMove either does not advance the game or couples the tick rate to typing.',
        cost:
          'One game describing itself dishonestly, and the coupling that follows.',
      },
      {
        option: 'Sharing only Board, randomness and the lifecycle',
        whenItWins:
          'Always. Each shared concept means the same thing in both games.',
        whenItLoses:
          'Less apparent reuse, which can read as under-abstraction.',
        cost:
          'Explaining why the loop is not shared, which is the point of the question.',
      },
      {
        option: 'Scanning rows, columns and diagonals after each move',
        whenItWins:
          '3×3, where it is irrelevant and obviously correct.',
        whenItLoses:
          'The stated N×N extension: roughly 760 cell reads per move on a 19×19 board, for a move that can only have made a line through itself.',
        cost:
          'Work proportional to the board rather than to the move.',
      },
      {
        option: 'Counters per line, per player',
        whenItWins:
          'Full-board lines at any N — O(1) per move, two to four counter updates.',
        whenItLoses:
          'It assumes a winning line spans the board, so it cannot express five-in-a-row anywhere.',
        cost:
          'Speed bought at the price of the extension the prompt may want.',
      },
      {
        option: 'An outward scan from the last move',
        whenItWins:
          'Any win length on any board size — O(win length), independent of the board.',
        whenItLoses:
          'Slower than counters for the full-board case.',
        cost:
          'A constant factor, in exchange for fitting behind an interface.',
      },
      {
        option: 'Subclassing for board size',
        whenItWins:
          'Nowhere. Size carries no behaviour.',
        whenItLoses:
          'A class per dimension, none of which differs in anything but a number.',
        cost:
          'The mechanism mismatch the parking-lot lesson named.',
      },
      {
        option: 'Reading input inside the loop',
        whenItWins:
          'A throwaway script with a terminal.',
        whenItLoses:
          'The game cannot be tested without simulating a keyboard, and inputs between ticks are lost or misapplied.',
        cost:
          'Testability of everything else.',
      },
      {
        option: 'Queued inputs applied one per tick',
        whenItWins:
          'Always. Deterministic, testable, and it prevents the reversal bug.',
        whenItLoses:
          'A fast player may feel one input was dropped.',
        cost:
          'A queue bound, and dropping inputs beyond it.',
      },
      {
        option: 'Validating a reversal against the last pressed direction',
        whenItWins:
          'Nowhere. It looks equivalent.',
        whenItLoses:
          'Right, up, left inside one tick still reverses the snake, because the check compared against "up" rather than "right".',
        cost:
          'The same bug with an extra step.',
      },
      {
        option: 'Resetting lastStepAt to now',
        whenItWins:
          'Nowhere. It is the intuitive line.',
        whenItLoses:
          'Time is lost on every slow frame, so the game runs slower under load and is not deterministic.',
        cost:
          'Reproducibility, which the tests depend on.',
      },
      {
        option: 'Rejection sampling for food placement',
        whenItWins:
          'An empty board.',
        whenItLoses:
          'At 95% occupancy the expected attempt count is around twenty and the worst case is unbounded — and a full board hangs.',
        cost:
          'Degradation exactly when the game matters most.',
      },
      {
        option: 'A maintained free-cell set',
        whenItWins:
          'Always. O(1) placement, and a full board becomes a win rather than a hang.',
        whenItLoses:
          'Two set operations per tick to maintain.',
        cost:
          'Nothing meaningful.',
      },
      {
        option: 'Math.random() directly',
        whenItWins:
          'Nowhere in a design being tested.',
        whenItLoses:
          'No run is reproducible, so no sequence can be asserted.',
        cost:
          'Every interesting test.',
      },
      {
        option: 'An injected seeded generator',
        whenItWins:
          'Always — the third injected dependency in this module, after time and the clock.',
        whenItLoses:
          'One more constructor parameter.',
        cost:
          'Nothing.',
      },
    ],
  },

  commonMistakes: [
    {
      weakAnswer: '"Both are games, so I will define a Game interface with makeMove, isOver and getWinner, and implement it twice."',
      whyWeak:
        'The interface was derived from a surface similarity. Snake advances on a clock whether or not the player does anything, so makeMove either buffers a direction and returns — which does not mean what the interface says — or advances one tick, which couples the frame rate to typing.',
      strongAnswer:
        '"They share a bounded board, injected randomness and a lifecycle, and nothing above that. Tic-tac-toe changes state only on input and checks its terminal condition after a move; Snake changes state on a clock and checks every tick. So Snake exposes input(direction) and tick(now) as separate things, and tic-tac-toe exposes place(r, c). The test I apply is whether each method means the same thing for both implementers — if it has to be explained differently per class, it is a shared name rather than a shared abstraction."',
    },
    {
      weakAnswer: '"After each move, check all rows, columns and both diagonals for a win."',
      whyWeak:
        'For 3×3 it is fine, and the requirement says extensible to N×N. On a 19×19 board that is around 760 cell reads per move — for a move that can only have completed a line passing through itself.',
      strongAnswer:
        '"Only lines through the last move can have changed. For full-board lines I would keep a counter per row, per column and for each diagonal, per player: a move updates two to four counters and a win is a counter reaching n, so detection is O(1) at any board size. If the extension is a win length rather than a board size — five in a row on a large board — counters cannot express it, so I would scan outward from the last move along four axes, which is O(win length) and independent of the board. Those are two implementations of one interface, and which I pick depends on which extension you asked for."',
    },
    {
      weakAnswer: '"The Snake loop reads the current key press and advances the snake one cell."',
      whyWeak:
        'It couples the game to input and to real time, so it cannot be tested without simulating a keyboard, and two keys pressed between ticks are lost or misapplied. It also makes the tick rate depend on how fast the player types.',
      strongAnswer:
        '"input(direction) queues and returns; tick(now) advances. The game is then a pure function of state, queued inputs and the current time, so a test runs a thousand ticks in milliseconds and asserts a sequence. And the timestep accumulates — lastStepAt plus stepMs rather than equals now — so a slow frame does not lose time and the simulation stays deterministic under a variable call rate."',
    },
    {
      weakAnswer: '"On each tick, apply every queued direction change, rejecting one that reverses the last input."',
      whyWeak:
        'Two changes inside a tick reverse the snake into its own neck: moving right, pressing up then left, the left is compared against up and accepted. The player pressed nothing illegal and the snake dies.',
      strongAnswer:
        '"At most one input is applied per tick, and the reversal check is against the direction the snake is actually moving rather than the last one pressed. Validating against the last press is the same bug with an extra step — it accepts left after up, and up was never applied. Any remaining inputs stay queued for the next tick, with a bound on the queue so a fast player cannot build up a backlog of turns."',
    },
    {
      weakAnswer: '"The snake dies if the new head position is any cell its body occupies."',
      whyWeak:
        'The tail cell is about to be vacated, so moving into it is legal when the snake is not growing. A snake following its own tail in a tight loop dies for no visible reason, and it survives casual testing because the situation only arises in a loop.',
      strongAnswer:
        '"Self-collision ignores the tail cell whenever the snake is not growing this tick, because that cell will be empty by the time the head occupies it. It is one of the two bugs that only appear when a player does something ordinary — the other being the double turn — so both get an explicit test rather than relying on play-testing."',
    },
    {
      weakAnswer: '"Place food by picking random cells until one is empty."',
      whyWeak:
        'It degenerates as the board fills: at 95% occupancy the expected number of attempts is about twenty, the worst case is unbounded, and a full board loops forever — which is exactly the moment a good player reaches.',
      strongAnswer:
        '"Maintain the set of free cells and pick an index into it, which is O(1) and bounded — one delete for the new head and one insert for the vacated tail per tick. It also turns the degenerate case into a terminal state: no free cells means the player has won, rather than an infinite loop. And the generator is injected and seeded, so a run is reproducible and the food sequence can be asserted — the same argument as injecting the clock."',
    },
  ],

  flashcards: [
    {
      id: 'fc-lgm-1',
      front: 'What do these two games actually share?',
      back: 'A bounded board with coordinates, injected randomness and time, and a lifecycle. Not the loop, the input model or the terminal check.',
      topic: 'board',
    },
    {
      id: 'fc-lgm-2',
      front: 'What is wrong with a shared makeMove()?',
      back: 'Snake advances on a clock, so makeMove either does not advance the game or couples the tick rate to typing — one implementation has to misdescribe itself.',
      topic: 'board',
    },
    {
      id: 'fc-lgm-3',
      front: 'What is the test for a shared interface?',
      back: 'Does each method mean the same thing for every implementer? If it must be explained differently per class, it is a shared name rather than a shared abstraction.',
      topic: 'board',
    },
    {
      id: 'fc-lgm-4',
      front: 'Why is scanning the board after each move the wrong default?',
      back: 'Only lines through the last move can have changed, so the work should be proportional to the move rather than to the board.',
      topic: 'win-detection',
    },
    {
      id: 'fc-lgm-5',
      front: 'How do counters make win detection O(1)?',
      back: 'One counter per row, column and diagonal per player: a move updates two to four of them, and a win is a counter reaching n.',
      topic: 'win-detection',
    },
    {
      id: 'fc-lgm-6',
      front: 'What can counters not express, and what replaces them?',
      back: 'A win length shorter than the board — five in a row anywhere. An outward scan from the last move along four axes, O(win length).',
      topic: 'win-detection',
    },
    {
      id: 'fc-lgm-7',
      front: 'What does an optimisation being incompatible with a seam tell you?',
      back: 'That you are choosing between speed and extension — and the prompt usually says which it wants.',
      topic: 'extensibility',
    },
    {
      id: 'fc-lgm-8',
      front: 'Which mechanism does each stated extension need?',
      back: 'N×N is a constructor parameter; a new win rule is an implementation. A size carries no behaviour and an algorithm does.',
      topic: 'extensibility',
    },
    {
      id: 'fc-lgm-9',
      front: 'Why does input() not advance the game?',
      back: 'Separating input from time makes the game a pure function of state, queued inputs and now — which is what makes every assertion a sequence of ticks.',
      topic: 'game-loop',
    },
    {
      id: 'fc-lgm-10',
      front: 'What is the double-turn bug, and its exact fix?',
      back: 'Two direction changes in one tick reverse the snake. Apply at most one input per tick, validated against the direction the snake is actually moving.',
      topic: 'game-loop',
    },
    {
      id: 'fc-lgm-11',
      front: 'Why is validating against the last pressed direction still wrong?',
      back: 'Right, up, left: left is compared against up and accepted, but up was never applied — the same bug with an extra step.',
      topic: 'game-loop',
    },
    {
      id: 'fc-lgm-12',
      front: 'Why ignore the tail in self-collision?',
      back: 'The tail cell is vacated in the same tick when the snake is not growing, so entering it is legal — otherwise a snake following its tail dies for no visible reason.',
      topic: 'game-loop',
    },
    {
      id: 'fc-lgm-13',
      front: 'Why accumulate the timestep rather than resetting it to now?',
      back: 'Resetting loses time on every slow frame, so the game runs slower under load and stops being deterministic.',
      topic: 'game-loop',
    },
    {
      id: 'fc-lgm-14',
      front: 'What is wrong with rejection sampling for food placement?',
      back: 'It degenerates as the board fills — about twenty attempts at 95% occupancy, unbounded at worst, and a full board hangs instead of being a win.',
      topic: 'game-loop',
    },
  ],

  quiz: [
    {
      id: 'q-lgm-1',
      kind: 'scenario',
      prompt:
        'A candidate defines `interface Game { makeMove(m): void }` for both games. What breaks?',
      options: [
        { id: 'a', label: 'Snake advances on a clock, so makeMove either does not advance the game or couples the tick rate to the player\'s typing' },
        { id: 'b', label: 'Tic-tac-toe cannot represent a move as a single value' },
        { id: 'c', label: 'Nothing — both games take moves' },
        { id: 'd', label: 'The board types differ, so the interface needs generics' },
      ],
      correct: ['a'],
      explanation:
        'The interface was derived from a surface similarity. A direction change does not advance Snake, and the game advances with no input at all — so the method means something different in each implementation, which is the definition of a shared name rather than a shared abstraction.',
      difficulty: 'core',
      topic: 'board',
    },
    {
      id: 'q-lgm-2',
      kind: 'scenario',
      prompt:
        'Tic-tac-toe must be extensible to N×N. What does scanning all rows, columns and diagonals after each move cost on a 19×19 board?',
      options: [
        { id: 'a', label: 'Around 760 cell reads per move, for a move that can only have completed a line through itself' },
        { id: 'b', label: 'Nothing measurable — boards are small' },
        { id: 'c', label: 'It fails to detect diagonal wins' },
        { id: 'd', label: 'It is O(1), since the board size is fixed at construction' },
      ],
      correct: ['a'],
      explanation:
        '19 rows plus 19 columns plus two diagonals, each 19 cells. The work is proportional to the board when it should be proportional to the move — which is the specific way this answer fails the stated extension rather than being wrong in itself.',
      difficulty: 'core',
      topic: 'win-detection',
    },
    {
      id: 'q-lgm-3',
      kind: 'scenario',
      prompt:
        'The snake is moving right. Within one tick the player presses up, then left. What must happen?',
      options: [
        { id: 'a', label: 'Up is applied and left is dropped — at most one input per tick, with the reversal checked against the direction actually being moved' },
        { id: 'b', label: 'Both are applied; left is legal because it does not reverse up' },
        { id: 'c', label: 'Both are dropped, since two inputs in one tick are ambiguous' },
        { id: 'd', label: 'Left is applied, since it is the most recent intent' },
      ],
      correct: ['a'],
      explanation:
        'Option b is the bug: left was compared against up, which was never applied, so the snake reverses into its own neck. Validating against the last pressed direction rather than the last moved one reproduces it exactly — which is why the check must use the direction the snake is actually moving.',
      difficulty: 'advanced',
      topic: 'game-loop',
    },
    {
      id: 'q-lgm-4',
      kind: 'scenario',
      prompt:
        'A snake following its own tail in a tight loop dies unexpectedly. Why?',
      options: [
        { id: 'a', label: 'Self-collision includes the tail cell, which is vacated in the same tick when the snake is not growing' },
        { id: 'b', label: 'The body array is being mutated while iterated' },
        { id: 'c', label: 'The timestep is too small for tight turns' },
        { id: 'd', label: 'The head is added before the collision check' },
      ],
      correct: ['a'],
      explanation:
        'The tail moves out of that cell in the same step the head moves into it, so the collision is not real. It survives casual testing because the situation only arises in a loop, which is why it needs an explicit test rather than play-testing.',
      difficulty: 'advanced',
      topic: 'game-loop',
    },
    {
      id: 'q-lgm-5',
      kind: 'scenario',
      prompt:
        'Food is placed by picking random cells until an empty one is found. What happens as the snake grows to fill 95% of the board?',
      options: [
        { id: 'a', label: 'Around twenty attempts on average, unbounded at worst — and a full board loops forever instead of being a win' },
        { id: 'b', label: 'Nothing — the expected number of attempts stays constant' },
        { id: 'c', label: 'Food may be placed on the snake' },
        { id: 'd', label: 'The generator exhausts its period' },
      ],
      correct: ['a'],
      explanation:
        'It degenerates exactly when a good player reaches the interesting part of the game. A maintained free-cell set makes placement O(1) and turns the degenerate case into a terminal win state rather than a hang.',
      difficulty: 'core',
      topic: 'game-loop',
    },
    {
      id: 'q-lgm-6',
      kind: 'multi',
      prompt:
        'The prompt says "extensible to N×N and to new win rules". Which mechanisms are correct? Select all that apply.',
      options: [
        { id: 'a', label: 'Board size as a constructor parameter' },
        { id: 'b', label: 'A WinRule interface with an implementation per variant' },
        { id: 'c', label: 'An outward scan from the last move, so the rule fits behind the interface' },
        { id: 'd', label: 'A subclass per board size' },
      ],
      correct: ['a', 'b', 'c'],
      explanation:
        'A size carries no behaviour and an algorithm does, so they need different mechanisms — and the third point is the subtle one: the O(1) counter approach cannot express a win length shorter than the board, so it does not fit behind the seam. An optimisation that is incompatible with the required extension is a choice, not a free win.',
      difficulty: 'core',
      topic: 'extensibility',
    },
  ],

  exercises: [
    {
      id: 'ex-lgm-1',
      kind: 'implement',
      title: 'Extend both games, and find the shared abstraction that finally earns its place',
      estimatedMinutes: 45,
      prompt: `Extend the pair with three capabilities. For each, write the signatures and say what changes.

**Part 1 — Connect-4 from the tic-tac-toe code.** A move names a column; the piece falls to the lowest empty row; a win is four in a row in any direction.

**Part 2 — undo, for the turn-based game only.** A player can take back the last move, repeatedly, to the start.

**Part 3 — two-player Snake on one board.** Two snakes, each with its own direction queue, dying on walls, themselves, or each other.

**Part 4.** One of these three makes a genuinely shared abstraction worth introducing between the two games. Identify it, say what the abstraction is, and give the options.

Then answer:

- In Part 1, does the win rule change, and does the counter optimisation survive?
- In Part 3, what happens when both snakes move into the same empty cell on the same tick?`,
      rubric: [
        'Connect-4 modelled as a placement rule converting a column to a cell.',
        'States that the win rule changes to a run length rather than a full line.',
        'Correctly says the counter optimisation does not survive, with the reason.',
        'Undo implemented as a move history with replay or inverse, with a stated choice.',
        'Explains why undo is straightforward for turn-based and not for Snake.',
        'Two-player Snake handles simultaneous resolution explicitly.',
        'Identifies undo/replay as the capability motivating a shared abstraction.',
        'Names the abstraction as a command or event log with at least two options.',
        'Answers the head-on collision question with a defensible rule.',
      ],
      modelAnswer: `**Part 1 — Connect-4**

\`\`\`ts
interface PlacementRule {
  /** Convert an input into a cell, or explain why it cannot. */
  resolve(board: Board<Player>, input: MoveInput): Result<Cell>;
}

class DirectPlacement implements PlacementRule {     // tic-tac-toe
  resolve(board, { r, c }) {
    if (!board.inBounds(r, c)) return err('out-of-bounds');
    if (board.get(r, c) !== null) return err('cell-taken');
    return ok({ r, c });
  }
}

class GravityPlacement implements PlacementRule {    // Connect-4
  resolve(board, { c }) {
    if (c < 0 || c >= board.cols) return err('bad-column', { c });
    for (let r = board.rows - 1; r >= 0; r--)         // from the bottom
      if (board.get(r, c) === null) return ok({ r, c });
    return err('column-full', { c });
  }
}
\`\`\`

**Three decisions.**

**Placement becomes a seam.** The prompt's difference is entirely in how an input becomes a cell, **so that is the only thing that varies** — and the rest of the game engine is unchanged.

**The error names the column.** "Column 3 is full" lets the client disable that column, **which a generic invalid-move cannot.**

**And the search runs from the bottom up**, which is the gravity rule expressed directly rather than as a computed height per column. *A height array would be O(1) instead of O(rows)*, and for a 6-row board it is not worth the second structure to maintain — **worth saying, because it shows the trade was considered rather than missed.**

**And the win rule changes**, which is the closing question below.

---

**Part 2 — undo, turn-based only**

\`\`\`ts
interface Move { r: number; c: number; player: Player; seq: number }

class TicTacToe {
  private readonly history: Move[] = [];

  place(...): MoveResult { /* ... */ this.history.push(move); }

  undo(): Result<Move> {
    const last = this.history.pop();
    if (!last) return err('nothing-to-undo');
    this.board.set(last.r, last.c, null);
    this.decrementCounters(last);        // ← the inverse
    this.movesPlayed--;
    this.state = 'running';              // a win may be undone
    return ok(last);
  }
}
\`\`\`

**Two implementations, and the choice is worth stating.**

\`\`\`
(a) Inverse operation: undo the effect directly
    + O(1), no replay
    − every piece of derived state needs an inverse, and a
      missed one drifts silently (the counters, movesPlayed,
      the terminal state)

(b) Replay: truncate the history and rebuild from scratch
    + no inverses to write, and the rebuilt state is
      correct by construction
    − O(moves) per undo — irrelevant here, since a board
      has at most n² moves
\`\`\`

**I would choose replay for this game.** With at most 361 moves on a 19×19 board, **rebuilding is microseconds**, and it removes an entire class of bug — **the drifting derived state that the ledger and cache lessons both warned about.** The inverse version is faster and has more places to be wrong.

*And one detail easy to miss:* **undoing a winning move must return the game to running.** The terminal state is derived, so replay handles it automatically **and the inverse version has to remember it.** Which is itself an argument for replay.

**Why this does not transfer to Snake:** **Snake has no discrete moves to undo.** Its state advances on a clock, so "undo" would mean rewinding time — **which is a snapshot problem rather than a history problem**, and that is Part 4.

---

**Part 3 — two-player Snake**

\`\`\`ts
class TwoPlayerSnake {
  private readonly snakes: Snake[];      // each with its own queue

  tick(now: number): TickResult {
    if (now - this.lastStepAt < this.stepMs) return running();
    this.lastStepAt += this.stepMs;

    // 1. Apply at most one input per snake
    for (const s of this.snakes) s.applyOneInput();

    // 2. Compute ALL new heads before resolving anything
    const heads = this.snakes.map(s => step(s.head, s.direction));

    // 3. Resolve collisions against the PRE-MOVE board
    const deaths = new Set<SnakeId>();
    for (const [i, h] of heads.entries()) {
      if (!this.board.inBounds(h.r, h.c)) deaths.add(i);
      else if (this.occupiedByAnyBody(h, { ignoringVacatedTails: true }))
        deaths.add(i);
    }
    // head-to-head: two snakes into the same cell
    for (const [i, j] of pairs(heads))
      if (heads[i].equals(heads[j])) { deaths.add(i); deaths.add(j); }

    // 4. Apply movement only for survivors
    // ...
  }
}
\`\`\`

**Three decisions.**

**All heads are computed before any is applied.** Applying snake A's move and then evaluating snake B against the new board **makes the outcome depend on array order** — so snake 0 would systematically win contested cells, which is an unfair game caused by an implementation detail.

**Collisions resolve against the pre-move board**, with vacated tails excluded for both snakes. **The tail rule from the single-player case now applies across snakes**, which is easy to miss.

**And simultaneous death is possible and correct.** Two snakes entering the same cell both die — **the answer to the closing question** — rather than one being arbitrarily favoured.

*The invariant gains a clause:* **the outcome of a tick does not depend on the order the snakes are stored in.** Which is directly testable: **run the same scenario with the snake list reversed and assert the same result.**

---

**Part 4 — which capability motivates a shared abstraction**

**Undo does — and extended to Snake it becomes replay, which is the abstraction both games can genuinely share: a recorded sequence of inputs plus a deterministic engine.**

\`\`\`
Tic-tac-toe:  history of moves → replay to any point
Snake:        history of (tick, inputs) → replay to any tick
              ← only possible because the engine is a pure
                function of (state, inputs, now) and the
                randomness is seeded
\`\`\`

**Both games are already deterministic functions of their inputs**, which is the property the earlier decisions bought: **injected time, injected randomness, queued inputs.** So a recorded input sequence reproduces a game exactly — **and that makes replay, undo, save/load, spectating and bug reports all the same feature.**

\`\`\`ts
interface Replayable<I> {
  readonly seed: number;
  apply(input: I): void;              // or tick(now)
  snapshot(): State;                  // optional, for speed
}

interface Recording<I> {
  seed: number;
  inputs: Array<{ at: number; input: I }>;
}
\`\`\`

**Three options for what the abstraction is.**

**(a) A command log with replay from the start.** Record every input with its timestamp; **rebuild by replaying.**

\`\`\`
+ simplest, and correct by construction
+ one mechanism serves undo, save, spectate and bug reports
− rebuild cost grows with game length — negligible for
  tic-tac-toe, and a long Snake game is thousands of ticks
\`\`\`

**(b) Command log plus periodic snapshots.** Replay from the nearest snapshot.

\`\`\`
+ bounded rebuild cost
− snapshots must be complete, and an incomplete one is a
  bug that appears only on restore — the cache-versus-log
  relationship from the document and ledger lessons
\`\`\`

**(c) Inverse operations per game.** Each game implements its own undo.

\`\`\`
+ O(1) for tic-tac-toe
− Snake has no meaningful inverse for a tick, so this
  abstraction does not exist for it
− and it is the drifting-derived-state risk
\`\`\`

**I would build (a), with (b) available if a game gets long.** And the reason it is the right shared abstraction while \`Game.makeMove\` was not: **it describes a property both games genuinely have** — determinism given inputs and a seed — **rather than a surface similarity.**

*Which is the retrospective point:* **the shared abstraction that earns its place was not visible at the start.** It appeared once a capability needed it, **which is the open-closed argument about waiting for the second case** — and the first attempted abstraction failed precisely because it was invented before anything required it.

---

**Does the win rule change for Connect-4, and does the counter optimisation survive?**

**The rule changes, and the counters do not survive.**

\`\`\`
Tic-tac-toe:  a line spanning the whole board (n in a row
              on an n×n board)
              → a counter per row/column/diagonal works,
                because a line is a fixed set of cells
Connect-4:    four in a row ANYWHERE on a 6×7 board
              → a "row" counter reaching 4 says nothing
                about whether they are adjacent
\`\`\`

**Counters count membership, not adjacency**, and Connect-4's rule is about adjacency. **Four pieces scattered across a row is not a win**, so the counter answer is not merely slower here — **it is wrong.**

**The outward scan handles it directly:**

\`\`\`ts
class RunOfN implements WinRule {
  constructor(private readonly n: number) {}      // 4 for Connect-4
  evaluate(board, r, c, p) {
    for (const [dr, dc] of AXES) {                // 4 axes
      const run = 1
        + countRun(board, r, c, dr, dc, p)
        + countRun(board, r, c, -dr, -dc, p);
      if (run >= this.n) return 'win';
    }
    return 'continue';
  }
}
\`\`\`

**And this is the same class as Gomoku with a different \`n\`** — which is the payoff of having chosen the abstractable implementation: **tic-tac-toe with \`RunOfN(3)\`, Connect-4 with \`RunOfN(4)\`, Gomoku with \`RunOfN(5)\`, all one implementation parameterised.**

*So the honest summary of the trade:* **counters are faster and serve exactly one game.** The outward scan is a constant factor slower and serves the whole family — **and the prompt asked for extensibility, so the scan is the correct choice.** Keeping the counters as a specialised \`FullLine\` implementation is possible and only worth it if the tic-tac-toe path is hot, which it is not.

---

**Both snakes move into the same empty cell on the same tick**

**Both die — and the reasoning is about fairness rather than realism.**

\`\`\`
Alternatives:
(a) Both die                    symmetric, no hidden rule
(b) Lower snake id wins         the outcome depends on an
                                implementation detail the
                                players cannot see
(c) Longer snake wins           a visible rule, and it
                                compounds an existing lead
(d) Neither moves               they are blocked, which no
                                other collision does
\`\`\`

**Option (b) is what a naive implementation does accidentally**, by applying snake 0's move before evaluating snake 1 — **and it is the worst of the four**, because the game has a rule nobody stated and only one player benefits.

**Option (a) is symmetric and unsurprising**: a head-on collision kills both, **which matches what players expect from every other game with this shape**, and requires no explanation.

*Option (c) is defensible as a deliberate design choice* — some games reward the leader — **but it should be a stated rule rather than an emergent one**, and it makes a leading player harder to catch.

**And the implementation requirement is the same whichever is chosen: compute all heads before applying any.**

\`\`\`ts
// WRONG: order-dependent
for (const s of snakes) { s.move(); checkCollisions(s); }

// RIGHT: order-independent
const heads = snakes.map(s => nextHead(s));
const deaths = resolveAll(heads, preMoveBoard);
applySurvivors(heads, deaths);
\`\`\`

**The test that proves it: run the same scenario with the snake list reversed and assert an identical outcome.** That single assertion catches every order-dependent resolution bug, **and it is the multiplayer equivalent of the elevator's per-tick invariant check** — a property about the simulation itself rather than about the game rules.`,
    },
  ],

  interviewQuestions: [
    {
      id: 'iq-lgm-1',
      level: 'basic',
      question: 'Design tic-tac-toe and Snake.',
      guidance:
        'Look for what is shared being limited to the board, randomness and lifecycle. A common Game interface with makeMove is the trap the pairing exists to set.',
    },
    {
      id: 'iq-lgm-2',
      level: 'basic',
      question: 'How do you detect a win?',
      guidance:
        'Only lines through the last move can have changed. Counters for O(1) on full-board lines, an outward scan for a win length — and knowing which the prompt requires.',
    },
    {
      id: 'iq-lgm-3',
      level: 'intermediate',
      question: 'Make the board N×N and support a different win rule.',
      guidance:
        'A constructor parameter for the size and an implementation for the rule. Two extensions in one sentence needing two mechanisms.',
    },
    {
      id: 'iq-lgm-4',
      level: 'intermediate',
      question: 'How does the Snake loop handle input?',
      guidance:
        'input() queues and tick(now) advances, with at most one input applied per tick. Reading the keyboard inside the loop makes the game untestable.',
    },
    {
      id: 'iq-lgm-5',
      level: 'advanced',
      question: 'The player presses up then left while moving right, within one tick.',
      guidance:
        'Up applies, left is dropped — validated against the direction actually being moved. Checking against the last press is the same bug with an extra step.',
    },
    {
      id: 'iq-lgm-6',
      level: 'advanced',
      question: 'How is food placed, and what happens as the board fills?',
      guidance:
        'A maintained free-cell set with an injected seeded generator. Rejection sampling degenerates at high occupancy and hangs on a full board.',
    },
    {
      id: 'iq-lgm-7',
      level: 'followup',
      question: 'Now add Connect-4 to this design.',
      guidance:
        'A placement rule converting a column to a cell, and a run-of-n win rule — which is why the counter optimisation had to be given up for the abstractable scan.',
    },
    {
      id: 'iq-lgm-8',
      level: 'followup',
      question: 'Add undo, and then replay for both games.',
      guidance:
        'Replay from a recorded input sequence plus a seed, which is the shared abstraction both games genuinely have — and it appeared only when a capability required it.',
    },
  ],

  activeLearning: [
    {
      id: 'al-lgm-1',
      kind: 'what-changes-if',
      prompt:
        'Change the deployment: both games now run on a server with the browser as a thin client, and players are on unreliable connections. What changes, and which game suffers more?',
      discussion: `**Snake suffers far more, and the reason is the property that made it interesting in the first place: it advances on a clock.**

**Tic-tac-toe transfers almost unchanged.**

\`\`\`
Client sends: place(r, c)
Server:       validates, applies, returns the new state
Latency:      a move takes a round trip, which is fine —
              the game was waiting for the player anyway
\`\`\`

**The turn-based model is naturally tolerant of latency**, because **nothing happens while the request is in flight.** A 300 ms round trip is invisible when the next event is a human thinking.

*What it does need:* **idempotency on the move**, because a client that retries a timed-out move must not place two marks. **The same client-generated key as everywhere else in this module** — and the move's cell makes a natural natural key, so a repeat of the same cell by the same player is recognisable.

**Snake does not transfer, and the reason is structural.**

\`\`\`
The snake advances every 150 ms whether or not input arrives.
With 200 ms of latency:
  · the player sees the state as it was 200 ms ago
  · their input arrives 200 ms after they pressed it
  · so they are steering a snake that has already moved
    two or three cells past where they think it is
\`\`\`

**And at a tight turn that is fatal.** The game is unplayable at latencies that tic-tac-toe does not notice.

**Three options, in increasing sophistication.**

**(a) Run the simulation on the client and report the score.**

\`\`\`
+ perfect responsiveness
− the client is authoritative, so scores are trivially
  forged — which matters if there is a leaderboard
\`\`\`

**(b) Run it on the server and stream state.** Correct and unplayable at any real latency, for the reasons above.

**(c) Client-side prediction with server reconciliation.** The client simulates locally and the server simulates authoritatively; **when they disagree, the server wins and the client corrects.**

\`\`\`
+ responsive AND authoritative
− the client must be able to re-simulate from a server
  state plus its own unacknowledged inputs
\`\`\`

**And (c) is available here almost for free**, which is the interesting part: **the design already made the game a deterministic pure function of (state, inputs, now) with a seeded generator.** That is precisely the property prediction and reconciliation require.

\`\`\`
Client: simulate locally, keep unacknowledged inputs
Server: authoritative simulation, same seed, same engine
On state update: rewind to the server state, re-apply
                 unacknowledged inputs, continue
\`\`\`

**The decision that made the game testable turns out to be the decision that makes it networkable**, which is worth noticing: **determinism is the same property in both cases.**

**What gets harder regardless of the option.**

**The seed must come from the server**, or a client can predict the food sequence and play a different game from everyone else.

**Input timing becomes part of the protocol.** An input pressed at tick 40 must be applied at tick 40 on the server, **not at the tick it happens to arrive** — otherwise a laggy player's turns land late and the simulations diverge.

**And divergence needs detection.** The client and server can drift through a bug, **so a periodic state hash comparison is the same mechanism as the collaborative-editing lesson's** — and the fix is the same: the authoritative side wins and the other resynchronises.

**The transferable point:** latency tolerance is determined by whether a system advances on input or on a clock. **A turn-based system waits for the player anyway, so a round trip is free; a real-time one is already moving, so the round trip is a divergence.** And the property that makes a real-time system networkable — deterministic simulation from inputs and a seed — **is the same property that made it testable**, which means the earlier decision paid twice.`,
    },
    {
      id: 'al-lgm-2',
      kind: 'debug',
      prompt:
        'Players report that Snake "sometimes dies for no reason". It is rare, happens more to good players, and cannot be reproduced by the developers. The collision code is correct in isolation and the unit tests pass. Diagnose it.',
      discussion: `**"More to good players" and "cannot be reproduced"** are the two facts that matter, and together they point somewhere specific: **the bug depends on a situation only skilled play produces.**

Which, for Snake, is a short list: **a long snake, tight turns, high speed, and a nearly-full board.**

**Hypothesis 1 — the tail is being counted in self-collision.**

The single-player case: **the tail cell is vacated in the same tick the head enters it**, so entering it is legal while not growing. **If the collision check includes the whole body, a snake following its own tail dies.**

*Why it fits every fact:* **it requires a tight loop**, which only a long snake in a confined space produces — **so good players hit it and developers testing a short snake never do.** And the collision code is "correct in isolation" because in isolation the tail really is occupied. **This is my leading hypothesis.**

*Check:* whether the self-collision check excludes the last body segment when \`growBy === 0\`. **One line, and the test is a scripted tight loop.**

**Hypothesis 2 — two direction changes inside one tick.**

Moving right, pressing up then left within 150 ms: **if both are applied, or if the reversal is validated against the last press rather than the last applied direction**, the snake reverses into its own neck.

*Why it fits:* **fast players press faster**, so the interval between two inputs is more often shorter than a tick. **Developers testing deliberately press one key at a time.**

*Check:* whether more than one input is applied per tick, and what the reversal comparison uses. **The queue-and-compare-against-current fix covers both variants.**

**Hypothesis 3 — the head is added before the collision check.**

\`\`\`
body.unshift(head);
if (occupiesBody(head)) die();     // the head is now in the body
→ every move is a self-collision, unless the check skips
  index 0 — and a check that skips index 0 fails to detect
  a real collision with the second segment
\`\`\`

*Why it might be rare rather than constant:* **if the check skips the first two segments as a workaround**, it then misses a genuine collision with segment two — **which happens only on the tightest possible turn.** *Check:* the order of mutation and check, and how many leading segments the check skips.

**Hypothesis 4 — the timestep resets rather than accumulating.**

\`lastStepAt = now\` loses time on every slow frame, **so the effective speed varies** — and inputs queued against an expected tick boundary land in a different tick than the player expected.

*Why it fits "good players":* they play at higher speeds where the step interval is shorter, **so a dropped frame is proportionally larger.** *Check:* whether the accumulator is \`+= stepMs\`. **It also explains "cannot reproduce" if developers run on faster machines.**

**Hypothesis 5 — food placed on the snake.**

If placement uses a free-cell set that is not maintained correctly — **a vacated tail not returned, or a new head not removed** — food can appear under the snake, **and eating it while the body is there produces a collision on the next tick.**

*Why it fits the rarity:* it needs the free set to have drifted, **which accumulates with the number of moves** — so a long game is more likely. *Check:* an invariant assertion that the free set equals the complement of the body. **The same derived-structure-drift check as the parking lot's index and the ledger's sum.**

**What I would check first: the tail exclusion and the input-per-tick rule.** Two code reads, **and together they are hypotheses 1 and 2 — the two failures that specifically require skilled play**, which is the strongest signal in the report.

**Then: run a scripted tight loop and a scripted double-turn as tests.** Both are deterministic given the seeded engine, **so if either bug exists it reproduces on the first run** — which is the payoff of having made the game deterministic.

**Why "cannot be reproduced by the developers" is the most useful fact.**

It says the bug is **input-pattern dependent rather than random.** A genuinely random failure would reproduce eventually under repeated play; **one that never reproduces under developer play is a pattern developers do not produce** — and that is a much smaller space than "something is wrong somewhere".

**And "more to good players" localises it further:** the distinguishing features of skilled play are **length, speed and tightness**, each of which maps to a specific mechanism. **The report is more diagnostic than it looks.**

**The instrumentation this demands.**

**A death reason recorded on every game over** — wall, self, or collided-with-segment-index. **The single most valuable addition**, because "died to segment 1" and "died to segment 12" are completely different bugs, and the current report cannot distinguish them.

**A short replay buffer attached to each death.** With a seeded deterministic engine, **the last five seconds of inputs plus the starting state reproduces the death exactly** — which turns an unreproducible report into a failing test. **This is the property the design already has and is not using.**

**An invariant assertion in development builds**, run every tick: the free-cell set is the complement of the body; the body has no duplicate cells; the body length matches the expected length. **Cheap, and it catches drift the moment it starts.**

**And a property test over random input sequences**, asserting that no death occurs with a reason of "self" when the head entered a vacated tail cell. **Random play generates the tight loops developers do not** — which is exactly the gap the report describes.

**Transferable:** when a bug correlates with skill, **enumerate what skilled play does differently** rather than searching the code. And when a system is already deterministic, **attach a replay to every failure** — the mechanism that makes it testable also makes every user report reproducible, and not using it is leaving the main benefit on the table.`,
    },
  ],

  revision: {
    bullets: [
      'The two games share a board, injected randomness and a lifecycle — and nothing above that.',
      'A shared makeMove forces Snake to misdescribe itself, because it advances on a clock.',
      'The test for a shared interface: does each method mean the same thing for every implementer?',
      'Only lines through the last move can have changed, so win detection should be incremental.',
      'Counters per row, column and diagonal give O(1) detection for full-board lines.',
      'Counters count membership, not adjacency — so they cannot express a run of n anywhere.',
      'An outward scan from the last move is O(win length) and fits behind a WinRule interface.',
      'An optimisation incompatible with the required seam is a choice between speed and extension.',
      'N×N is a constructor parameter; a new win rule is an implementation.',
      'input() queues and tick(now) advances — the game is a pure function of state, inputs and time.',
      'Apply at most one input per tick, validated against the direction actually being moved.',
      'Validating against the last pressed direction is the same reversal bug with an extra step.',
      'Ignore the tail cell in self-collision while the snake is not growing.',
      'Accumulate the timestep rather than resetting it, or a slow frame loses time.',
      'Growth is a deferred counter, not a segment insertion.',
      'Maintain a free-cell set: rejection sampling degenerates as the board fills and hangs when full.',
      'A full board is a win, not an infinite loop.',
      'Inject the random generator, as the clock was injected — determinism is what makes assertions possible.',
    ],
  },

  cheatSheet: {
    whatItIs:
      'Two grid games sharing only a bounded board, injected randomness and a lifecycle: one turn-based with incremental win detection behind a rule interface, the other a fixed-timestep loop with queued inputs and a maintained free-cell set.',
    whyItExists:
      'Because the pairing tests whether you abstract from surface similarity or from behaviour — and because both games have a specific bug class that only appears under ordinary play, which is what the determinism buys you the ability to test.',
    whenToUse: [
      'Incremental evaluation whenever only the last change can have altered a result.',
      'A rule interface whenever the prompt names an algorithmic variation.',
      'A parameter whenever the prompt names a size.',
      'Queued inputs plus a tick whenever a system advances on a clock.',
      'A maintained free set whenever random selection from a shrinking space is needed.',
    ],
    whenNotToUse: [
      'A shared interface derived from surface similarity.',
      'A board scan after every move, when the extension is board size.',
      'Counters, when the win condition is adjacency rather than membership.',
      'A subclass per board dimension.',
      'Reading input inside the loop.',
      'Applying every queued input in one tick.',
      'Resetting the timestep to the current time.',
      'Rejection sampling for placement on a filling board.',
      'An uninjected random generator.',
    ],
    alternatives: [
      'Counters as a specialised full-line rule, kept alongside the general scan if the path is hot.',
      'A height array per column for Connect-4 placement, if O(rows) ever mattered.',
      'Replay from a move history instead of inverse operations, to avoid drifting derived state.',
      'Client prediction with server reconciliation, which the determinism already enables.',
      'A command log plus periodic snapshots, when replay from the start grows too long.',
    ],
    tradeoffs: [
      'Counters buy O(1) detection and cost the ability to express a shorter win length.',
      'An outward scan buys generality and costs a constant factor.',
      'Queued inputs buy determinism and cost a dropped input for a very fast player.',
      'A free-cell set buys bounded placement and costs two set operations per tick.',
      'Replay-based undo buys correctness by construction and costs O(moves) per undo.',
      'Sharing only the board buys honest interfaces and costs apparent reuse.',
    ],
    failureModes: [
      'A shared move() that means different things per implementation.',
      'Win detection scanning the whole board at N×N.',
      'Counters used for an adjacency-based win rule.',
      'Two direction changes in one tick reversing the snake.',
      'A reversal validated against the last press rather than the last applied direction.',
      'Self-collision counting the tail cell that is being vacated.',
      'The head added to the body before the collision check.',
      'A timestep that resets, losing time on slow frames.',
      'Food placed on the snake from a drifted free-cell set.',
      'Rejection sampling hanging on a full board instead of declaring a win.',
      'An unseeded generator making every failure unreproducible.',
    ],
    followUpQuestions: [
      'Does each shared method mean the same thing for both games?',
      'What can the last move possibly have changed?',
      'Is the win condition about membership or adjacency?',
      'Which extension did the prompt ask for — size or rule?',
      'Does the fastest implementation fit behind the seam?',
      'Does input() advance anything?',
      'How many inputs are applied per tick, and what is the reversal compared against?',
      'Is the tail cell excluded from self-collision?',
      'Does the timestep accumulate or reset?',
      'What happens to placement when the board is nearly full?',
      'Can a reported death be replayed?',
    ],
  },
});
