import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lessonOrder, curriculum } from '@/content/curriculum';
import { lessonModules } from '@/content/index.generated';

/**
 * `npm test` must fail on malformed content, so the validator runs here rather
 * than only in a script somebody has to remember to invoke.
 */
describe('content pipeline', () => {
  it('passes npm run content:validate', () => {
    // Throws with the validator's stderr attached if it exits non-zero.
    const out = execFileSync('npx', ['tsx', 'scripts/validate-content.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out).toMatch(/Content validation passed/);
  }, 120_000);

  it('keeps the generated index in step with the files on disk', () => {
    execFileSync('npx', ['tsx', 'scripts/build-content-index.ts', '--check'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }, 60_000);

  it('has a unique, kebab-case slug for every curriculum lesson', () => {
    expect(new Set(lessonOrder).size).toBe(lessonOrder.length);
    for (const slug of lessonOrder) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('mentions every lesson slug in docs/CURRICULUM.md', () => {
    const prose = readFileSync(join(process.cwd(), 'docs', 'CURRICULUM.md'), 'utf8');
    const missing = lessonOrder.filter((s) => !prose.includes(s));
    expect(missing).toEqual([]);
  });

  it('lists every authored lesson in the generated index', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts')) files.push(entry.replace(/\.ts$/, ''));
      }
    };
    walk(join(process.cwd(), 'content', 'lessons'));
    expect(Object.keys(lessonModules).sort()).toEqual(files.sort());
  });

  it('assigns every lesson to exactly one module', () => {
    const seen = new Map<string, number>();
    for (const p of curriculum.phases) {
      for (const m of p.modules) {
        for (const l of m.lessons) seen.set(l, (seen.get(l) ?? 0) + 1);
      }
    }
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(seen.size).toBe(lessonOrder.length);
  });
});

/**
 * docs/ARCHITECTURE.md: no React component contains lesson prose. A component
 * with a long English string literal is almost always a lesson body that
 * escaped content/.
 */
describe('layering', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('keeps lesson-length prose out of components/', () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'components'))) {
      const src = readFileSync(file, 'utf8');
      // Strip comments and className strings before looking for prose.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '')
        .replace(/className=\{?["'`][\s\S]*?["'`]\}?/g, '');
      for (const match of stripped.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)) {
        const text = match[2];
        // A sentence-bearing literal over 400 characters is lesson content.
        if (text.length > 400 && /[.!?]\s+[A-Z]/.test(text)) {
          offenders.push(`${file}: ${text.slice(0, 60)}…`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never imports db/schema or db/client outside db/', () => {
    const offenders: string[] = [];
    for (const dir of ['app', 'components', 'lib']) {
      for (const file of walk(join(process.cwd(), dir))) {
        const src = readFileSync(file, 'utf8');
        if (/from\s+['"]@\/db\/(schema|client)['"]/.test(src)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps content/ a leaf with no imports from the app', () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'content'))) {
      const src = readFileSync(file, 'utf8');
      if (/from\s+['"]@\/(app|components|db|lib)\//.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
