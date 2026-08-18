import { describe, expect, it } from 'vitest';

import { chunkPages, estimateTokens } from './chunk';
import { cleanText } from './extract';

/**
 * These tests pin the properties the retrieval quality actually depends on:
 * chunks stay within budget, nothing is silently dropped, page provenance is
 * correct, and consecutive chunks overlap.
 */

function makeParagraph(words: number, seed: string): string {
  return Array.from({ length: words }, (_, i) => `${seed}${i}`).join(' ');
}

describe('cleanText', () => {
  it('rejoins words hyphenated across a line break', () => {
    expect(cleanText('This agree-\nment is binding.')).toBe('This agreement is binding.');
  });

  it('unwraps hard-wrapped prose but keeps sentence breaks', () => {
    const input = 'The party of\nthe first part.\nA new sentence follows.';
    expect(cleanText(input)).toBe('The party of the first part.\nA new sentence follows.');
  });

  it('preserves list structure', () => {
    const input = 'Obligations:\n- deliver goods\n- issue invoice';
    expect(cleanText(input)).toContain('- deliver goods');
    expect(cleanText(input)).toContain('- issue invoice');
  });

  it('strips zero-width characters and normalises non-breaking spaces', () => {
    const input = `weird​word here`;
    expect(cleanText(input)).toBe('weirdword here');
  });

  it('collapses excessive blank lines', () => {
    expect(cleanText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('chunkPages', () => {
  it('returns nothing for an empty document', () => {
    expect(chunkPages([])).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const chunks = chunkPages([{ page: 1, text: 'A short clause about payment terms.' }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pageFrom).toBe(1);
    expect(chunks[0]!.pageTo).toBe(1);
  });

  it('respects the token budget on long input', () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({
      page: i + 1,
      text: [
        makeParagraph(180, `alpha${i}_`),
        makeParagraph(180, `beta${i}_`),
        makeParagraph(180, `gamma${i}_`),
      ].join('\n\n'),
    }));

    const chunks = chunkPages(pages);
    expect(chunks.length).toBeGreaterThan(1);

    // Allowing headroom for the overlap carried into each chunk.
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(1200);
    }
  });

  it('assigns sequential, gapless chunk indices', () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({
      page: i + 1,
      text: makeParagraph(300, `page${i}_`),
    }));

    const chunks = chunkPages(pages);
    chunks.forEach((chunk, i) => expect(chunk.chunkIndex).toBe(i));
  });

  it('tracks page provenance in non-decreasing order', () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({
      page: i + 1,
      text: makeParagraph(250, `p${i}_`),
    }));

    const chunks = chunkPages(pages);
    for (const chunk of chunks) {
      expect(chunk.pageFrom).toBeLessThanOrEqual(chunk.pageTo);
      expect(chunk.pageFrom).toBeGreaterThanOrEqual(1);
      expect(chunk.pageTo).toBeLessThanOrEqual(10);
    }
    // Chunks advance through the document rather than jumping around.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.pageFrom).toBeGreaterThanOrEqual(chunks[i - 1]!.pageFrom);
    }
  });

  it('overlaps consecutive chunks so boundary facts are not lost', () => {
    const pages = [
      { page: 1, text: Array.from({ length: 14 }, (_, i) => makeParagraph(60, `s${i}_`)).join('\n\n') },
    ];

    const chunks = chunkPages(pages);
    expect(chunks.length).toBeGreaterThan(1);

    const first = new Set(chunks[0]!.content.split(/\s+/));
    const shared = chunks[1]!.content.split(/\s+/).filter((w) => first.has(w));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('splits a single oversized paragraph that has no sentence breaks', () => {
    const monster = makeParagraph(6000, 'x');
    const chunks = chunkPages([{ page: 1, text: monster }]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(1200);
    }
  });

  it('retains substantially all source content', () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({
      page: i + 1,
      text: makeParagraph(200, `keep${i}_`),
    }));

    const chunks = chunkPages(pages);
    const combined = chunks.map((c) => c.content).join(' ');

    // Spot-check a token from the start, middle, and end of each page.
    for (let i = 0; i < 6; i++) {
      expect(combined).toContain(`keep${i}_0`);
      expect(combined).toContain(`keep${i}_100`);
      expect(combined).toContain(`keep${i}_199`);
    }
  });

  it('folds a tiny trailing fragment into the previous chunk', () => {
    const pages = [
      { page: 1, text: makeParagraph(1200, 'big_') },
      { page: 2, text: 'Tiny.' },
    ];

    const chunks = chunkPages(pages);
    expect(chunks.at(-1)!.content).toContain('Tiny.');
    // The fragment did not become a chunk of its own.
    expect(chunks.at(-1)!.tokenCount).toBeGreaterThan(50);
  });
});

describe('estimateTokens', () => {
  it('scales with length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
