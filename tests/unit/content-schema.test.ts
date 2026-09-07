import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { Lesson, ResourceFile, type LessonInput } from '@/content/schema';
import lesson from '@/content/lessons/foundations/f-request-lifecycle';

/**
 * The content gate has to reject bad content, not just accept good content.
 * Every rule in docs/CONTENT_STYLE.md that the schema enforces gets a failing
 * fixture here — otherwise the gate is decoration.
 */

const valid = lesson as LessonInput;

function mutate(fn: (l: LessonInput) => void): LessonInput {
  const copy = structuredClone(valid);
  fn(copy);
  return copy;
}

function errorsOf(input: LessonInput): string[] {
  const result = Lesson.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('lesson schema', () => {
  it('accepts the canonical lesson', () => {
    expect(Lesson.safeParse(valid).success).toBe(true);
  });

  it('rejects a raw external URL in the prose', () => {
    const bad = mutate((l) => {
      l.deepExplanation.body += '\n\nSee https://some-blog.example-not-reserved.io/post for more.';
    });
    expect(errorsOf(bad).join(' ')).toMatch(/raw external URLs/);
  });

  it('allows RFC 2606 documentation domains inside examples', () => {
    const ok = mutate((l) => {
      l.deepExplanation.body +=
        '\n\n`GET https://api.example.com/v1/things`, `http://localhost:3000`, ' +
        '`"iss": "https://auth.example.com"` and `https://svc.internal.test/path`.';
    });
    expect(Lesson.safeParse(ok).success).toBe(true);
  });

  it('still rejects a real domain that merely starts with a reserved one', () => {
    const bad = mutate((l) => {
      l.deepExplanation.body += '\n\nSee https://example.com.attacker-controlled.io/page.';
    });
    expect(errorsOf(bad).join(' ')).toMatch(/raw external URLs/);
  });

  it('rejects placeholder markers', () => {
    for (const marker of ['TODO: finish this', 'coming soon', 'lorem ipsum dolor']) {
      const bad = mutate((l) => {
        l.revision.bullets[0] = `Something ${marker} here`;
      });
      expect(errorsOf(bad).join(' '), marker).toMatch(/placeholder marker/);
    }
  });

  it('rejects a quiz whose correct answer is not one of its options', () => {
    const bad = mutate((l) => {
      l.quiz[0].correct = ['not-an-option'];
    });
    expect(errorsOf(bad).join(' ')).toMatch(/is not an option/);
  });

  it('rejects a single-answer question with two correct answers', () => {
    const bad = mutate((l) => {
      l.quiz[2].correct = ['a', 'b'];
    });
    expect(errorsOf(bad).join(' ')).toMatch(/needs exactly one answer/);
  });

  it('requires at least half of quiz questions to be scenarios', () => {
    const bad = mutate((l) => {
      for (const q of l.quiz) q.kind = 'single';
    });
    expect(errorsOf(bad).join(' ')).toMatch(/kind "scenario"/);
  });

  it('requires an interview question at every level', () => {
    const bad = mutate((l) => {
      l.interviewQuestions = l.interviewQuestions.filter((q) => q.level !== 'followup');
    });
    expect(errorsOf(bad).join(' ')).toMatch(/missing a "followup" interview question/);
  });

  it('requires at least two active-learning elements', () => {
    const bad = mutate((l) => {
      l.activeLearning = [];
      delete l.deepExplanation.predict;
    });
    expect(errorsOf(bad).join(' ')).toMatch(/at least 2 active-learning elements/);
  });

  it('requires at least three trade-off rows, including the simplest option', () => {
    const bad = mutate((l) => {
      l.tradeoffs.rows = l.tradeoffs.rows.slice(0, 2);
    });
    expect(errorsOf(bad).join(' ')).toMatch(/at least 3 options/);
  });

  it('caps must-read resources at three', () => {
    const bad = mutate((l) => {
      l.resources = [
        { key: 'ddia-book', tier: 'must', note: 'A note long enough to satisfy the minimum length rule.' },
        { key: 'mdn-http-overview', tier: 'must', note: 'A note long enough to satisfy the minimum length rule.' },
        { key: 'rfc-9110-http-semantics', tier: 'must', note: 'A note long enough to satisfy the minimum length rule.' },
        { key: 'latency-numbers', tier: 'must', note: 'A note long enough to satisfy the minimum length rule.' },
      ];
    });
    expect(errorsOf(bad).join(' ')).toMatch(/at most 3 "must" resources/);
  });

  it('rejects a flashcard whose topic is not a declared tag', () => {
    const bad = mutate((l) => {
      l.flashcards[0].topic = 'not-a-declared-tag';
    });
    expect(errorsOf(bad).join(' ')).toMatch(/is not in tags/);
  });

  it('rejects duplicate ids inside a lesson', () => {
    const bad = mutate((l) => {
      l.flashcards[1].id = l.flashcards[0].id;
    });
    expect(errorsOf(bad).join(' ')).toMatch(/duplicate flashcards id/);
  });

  it('rejects a deep explanation that is too short to be rigorous', () => {
    const bad = mutate((l) => {
      l.deepExplanation.body = 'Too short.';
    });
    expect(errorsOf(bad).join(' ')).toMatch(/deepExplanation.body must be 650-3000 words/);
  });

  it('rejects a flow diagram whose edge points at a missing node', () => {
    const bad = mutate((l) => {
      const flow = l.visuals.find((v) => v.kind === 'flow');
      if (flow && flow.kind === 'flow') flow.edges[0].target = 'nope';
    });
    expect(errorsOf(bad).join(' ')).toMatch(/references a node that does not exist/);
  });

  it('rejects a diagram caption too short to say what to notice', () => {
    const bad = mutate((l) => {
      l.visuals[0].caption = 'A diagram.';
    });
    expect(errorsOf(bad).join(' ')).toMatch(/caption/);
  });
});

describe('resource allowlist', () => {
  const file = ResourceFile.parse(
    parse(readFileSync(join(process.cwd(), 'docs', 'resources.yaml'), 'utf8')),
  );

  it('parses and has no duplicate keys', () => {
    const keys = file.resources.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('marks every entry verified with a date', () => {
    for (const r of file.resources) {
      expect(r.verified, r.key).toBe(true);
      expect(r.verifiedAt, r.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never records a page number or a video timestamp in section', () => {
    for (const r of file.resources) {
      if (!r.section) continue;
      expect(r.section, r.key).not.toMatch(/\bp{1,2}\.?\s*\d|\bpage\s*\d|\b\d{1,2}:\d{2}\b/i);
    }
  });

  it('resolves every key the canonical lesson cites', () => {
    const keys = new Set(file.resources.map((r) => r.key));
    for (const r of valid.resources ?? []) {
      expect(keys.has(r.key), r.key).toBe(true);
    }
  });
});
