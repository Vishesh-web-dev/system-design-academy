import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ResourceFile, type Resource } from '@/content/schema';

/**
 * docs/resources.yaml is the only external-reference allowlist. Lesson content
 * refers to resources by key; a key that is not here, or is not verified, is a
 * validation failure — never a silently rendered dead link.
 */

let cache: Map<string, Resource> | undefined;

export function loadResources(): Map<string, Resource> {
  if (cache) return cache;
  const raw = readFileSync(join(process.cwd(), 'docs', 'resources.yaml'), 'utf8');
  const parsed = ResourceFile.parse(parse(raw));
  cache = new Map(parsed.resources.map((r) => [r.key, r]));
  return cache;
}

export function getResource(key: string): Resource | undefined {
  return loadResources().get(key);
}

export function resolveResources(keys: string[]): Resource[] {
  const all = loadResources();
  return keys.flatMap((k) => {
    const r = all.get(k);
    return r ? [r] : [];
  });
}
