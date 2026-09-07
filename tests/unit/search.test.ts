import { describe, expect, it } from 'vitest';
import { scoreDoc, search, tokenize, type SearchDoc } from '@/lib/content/search';

const doc = (over: Partial<SearchDoc>): SearchDoc => ({
  id: 'x',
  lessonSlug: 'f-request-lifecycle',
  lessonTitle: 'How a request actually travels',
  kind: 'lesson',
  title: '',
  body: '',
  tags: [],
  weight: 1,
  ...over,
});

describe('tokenizer', () => {
  it('drops stop words and single characters', () => {
    expect(tokenize('What is the cost of a cache miss?')).toEqual(['cost', 'cache', 'miss']);
  });

  it('keeps version-ish tokens intact', () => {
    expect(tokenize('HTTP/2 vs HTTP/3')).toEqual(['http', '2', 'vs', 'http', '3']);
  });
});

describe('scoring', () => {
  it('ranks a title match above a body match', () => {
    const title = scoreDoc(doc({ title: 'Distributed locks' }), ['locks'], 'locks');
    const body = scoreDoc(doc({ body: 'something about locks here' }), ['locks'], 'locks');
    expect(title).toBeGreaterThan(body);
  });

  it('rewards covering every term over repeating one', () => {
    const both = scoreDoc(
      doc({ title: 'Cache invalidation', body: 'invalidation strategies' }),
      ['cache', 'invalidation'],
      'cache invalidation',
    );
    const one = scoreDoc(
      doc({ title: 'Cache cache cache', body: 'cache cache' }),
      ['cache', 'invalidation'],
      'cache invalidation',
    );
    expect(both).toBeGreaterThan(one);
  });

  it('returns zero when nothing matches', () => {
    expect(scoreDoc(doc({ title: 'Indexes' }), ['kubernetes'], 'kubernetes')).toBe(0);
  });

  it('rejects a document matching fewer than half the query terms', () => {
    // One incidental word in a long body is noise, not a result.
    const incidental = doc({ body: 'an operator may hold the private key' });
    expect(scoreDoc(incidental, ['kubernetes', 'operator', 'crd'], 'kubernetes operator crd')).toBe(0);
    // Two of three clears the floor.
    expect(
      scoreDoc(doc({ title: 'Kubernetes operator' }), ['kubernetes', 'operator', 'crd'], 'kubernetes operator crd'),
    ).toBeGreaterThan(0);
  });

  it('gives a bonus for an exact phrase', () => {
    const phrase = scoreDoc(doc({ body: 'the idempotency key must be stored' }), ['idempotency', 'key'], 'idempotency key');
    const scattered = scoreDoc(doc({ body: 'idempotency matters; a key is needed' }), ['idempotency', 'key'], 'idempotency key');
    expect(phrase).toBeGreaterThan(scattered);
  });
});

describe('search over the real corpus', () => {
  it('finds the request-lifecycle lesson for its own concepts', async () => {
    for (const query of ['dns ttl failover', 'round trips latency', 'tls handshake', 'connection reuse']) {
      const hits = await search(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits.some((h) => h.lessonSlug === 'f-request-lifecycle'), query).toBe(true);
    }
  });

  it('returns nothing for a query outside the curriculum', async () => {
    expect(await search('kubernetes operator crd', 5)).toEqual([]);
  });

  it('returns nothing for an empty query', async () => {
    expect(await search('   ', 5)).toEqual([]);
  });

  it('is stable: identical queries return identical rankings', async () => {
    const a = await search('cache', 10);
    const b = await search('cache', 10);
    expect(a.map((h) => h.id)).toEqual(b.map((h) => h.id));
  });

  it('respects the limit', async () => {
    expect((await search('the design of a system', 3)).length).toBeLessThanOrEqual(3);
  });
});
