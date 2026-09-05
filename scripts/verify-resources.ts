import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { ResourceFile } from '../content/schema';

/**
 * Re-verifies every URL in docs/resources.yaml.
 *
 * Not part of the standard gates: it needs network access, and a transient
 * outage or a bot-challenge page must never fail a build. Run it periodically
 * and act on the report. `--mark-failures` flips `verified` to false for
 * anything that no longer resolves, which then makes `npm run content:validate`
 * fail on every lesson citing it — deliberately loud.
 */

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const path = join('docs', 'resources.yaml');
const raw = readFileSync(path, 'utf8');
const file = ResourceFile.parse(parse(raw));

const results: Array<{ key: string; status: number | string; url: string }> = [];

for (const r of file.resources) {
  try {
    const res = await fetch(r.url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/pdf,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    results.push({ key: r.key, status: res.status, url: r.url });
  } catch (e) {
    results.push({ key: r.key, status: e instanceof Error ? e.name : 'error', url: r.url });
  }
}

const failures = results.filter((r) => r.status !== 200);

console.log(`${results.length - failures.length}/${results.length} resources resolved.`);
for (const f of failures) console.log(`  ✗ ${f.status}  ${f.key}  ${f.url}`);

if (process.argv.includes('--mark-failures') && failures.length) {
  const failed = new Set(failures.map((f) => f.key));
  const next = {
    resources: file.resources.map((r) => (failed.has(r.key) ? { ...r, verified: false } : r)),
  };
  writeFileSync(path, stringify(next, { lineWidth: 0 }));
  console.log(`Marked ${failed.size} resource(s) unverified. Lessons citing them will now fail validation.`);
}
