import { describe, expect, it } from 'vitest';

import { fuse, type CandidateRow } from './retrieve';
import { normalize } from './embed';

function row(id: string, rank: number): CandidateRow {
  return {
    id,
    chunk_index: Number(id.replace(/\D/g, '')) || 0,
    page_from: 1,
    page_to: 1,
    content: `content ${id}`,
    rank,
  };
}

/**
 * Reciprocal Rank Fusion is the piece that decides which excerpts the model
 * actually sees, so its ranking behaviour is pinned here.
 */
describe('fuse (reciprocal rank fusion)', () => {
  it('ranks a chunk found by both retrievers above one found by only one', () => {
    const dense = [row('a', 1), row('b', 2)];
    const keyword = [row('b', 1), row('c', 2)];

    const ranked = [...fuse([dense, keyword]).values()].sort(
      (x, y) => y.score - x.score,
    );

    // 'b' appears in both lists, so it should outrank the top hit of either.
    expect(ranked[0]!.row.id).toBe('b');
  });

  it('preserves order within a single retriever', () => {
    const ranked = [...fuse([[row('a', 1), row('b', 2), row('c', 3)]]).values()].sort(
      (x, y) => y.score - x.score,
    );

    expect(ranked.map((r) => r.row.id)).toEqual(['a', 'b', 'c']);
  });

  it('deduplicates chunks returned by both retrievers', () => {
    const fused = fuse([[row('a', 1)], [row('a', 1)]]);
    expect(fused.size).toBe(1);
  });

  it('gives a doubly-found chunk strictly more score than a singly-found one', () => {
    const fused = fuse([
      [row('shared', 5), row('solo', 1)],
      [row('shared', 5)],
    ]);

    expect(fused.get('shared')!.score).toBeGreaterThan(fused.get('solo')!.score);
  });

  it('handles empty retriever output', () => {
    expect(fuse([[], []]).size).toBe(0);
    expect(fuse([[row('a', 1)], []]).size).toBe(1);
  });

  it('treats rank as a number even when the driver returns a string', () => {
    // postgres.js returns bigint-ish columns as strings; the fusion must cope.
    const stringRank = { ...row('a', 1), rank: '1' as unknown as number };
    const fused = fuse([[stringRank]]);
    expect(Number.isFinite(fused.get('a')!.score)).toBe(true);
    expect(fused.get('a')!.score).toBeGreaterThan(0);
  });
});

describe('normalize', () => {
  it('scales a vector to unit length', () => {
    const result = normalize([3, 4]);
    const magnitude = Math.hypot(...result);
    expect(magnitude).toBeCloseTo(1, 10);
  });

  it('preserves direction', () => {
    const result = normalize([3, 4]);
    expect(result[0]! / result[1]!).toBeCloseTo(3 / 4, 10);
  });

  it('leaves an all-zero vector alone rather than dividing by zero', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('makes cosine similarity equal the dot product', () => {
    const a = normalize([1, 2, 3]);
    const b = normalize([2, 4, 6]); // same direction
    const dot = a.reduce((sum, value, i) => sum + value * b[i]!, 0);
    expect(dot).toBeCloseTo(1, 10);
  });
});
