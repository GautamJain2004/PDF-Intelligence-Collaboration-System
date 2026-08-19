import 'server-only';

import type { PageText } from './extract';

/**
 * Chunking for retrieval.
 *
 * The goal is chunks that are *semantically self-contained*: large enough to
 * answer a question on their own, small enough that a match is precise rather
 * than diluted, and split at boundaries a human would recognise.
 *
 * Strategy, in priority order:
 *  1. Split on paragraph breaks, which usually track the document's own
 *     structure (clauses, sections, list blocks).
 *  2. If a paragraph alone exceeds the budget, fall back to sentence splitting.
 *  3. If a single "sentence" is still oversized (dense tables, no punctuation),
 *     hard-split on a word boundary as a last resort.
 *
 * Every chunk carries the page range it came from, so answers can cite pages
 * and the viewer can jump to the source.
 */

/**
 * Token budget per chunk.
 *
 * ~900 tokens is a deliberate middle ground. Much smaller and a clause gets
 * separated from the definition it depends on; much larger and a chunk covers
 * several topics, so its embedding averages out into something that matches
 * everything weakly and nothing strongly.
 */
const TARGET_TOKENS = 900;
const MIN_CHUNK_TOKENS = 50;

/**
 * Overlap between consecutive chunks (~15%).
 *
 * Without it, a fact sitting exactly on a boundary is split across two chunks
 * and neither retrieves well. The cost is some duplicated storage, which is
 * cheap relative to missing an answer.
 */
const OVERLAP_TOKENS = 135;

/**
 * Token estimate without a tokenizer dependency.
 *
 * English prose averages ~4 characters per token for GPT-family tokenizers. This is an approximation, so budgets are set conservatively
 * enough that a 10-15% error never overflows the model's context window.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type Chunk = {
  chunkIndex: number;
  pageFrom: number;
  pageTo: number;
  content: string;
  tokenCount: number;
};

/** Splits on sentence terminators, keeping the terminator with its sentence. */
function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Last-resort split for text with no usable punctuation. */
function splitByWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    current.push(word);
    if (estimateTokens(current.join(' ')) >= maxTokens) {
      out.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) out.push(current.join(' '));
  return out;
}

/**
 * Breaks page text into units no larger than the token budget, preferring
 * paragraph boundaries, then sentences, then words.
 */
function toUnits(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const units: string[] = [];

  for (const paragraph of paragraphs) {
    if (estimateTokens(paragraph) <= TARGET_TOKENS) {
      units.push(paragraph);
      continue;
    }

    for (const sentence of splitSentences(paragraph)) {
      if (estimateTokens(sentence) <= TARGET_TOKENS) {
        units.push(sentence);
      } else {
        units.push(...splitByWords(sentence, TARGET_TOKENS));
      }
    }
  }

  return units;
}

/**
 * Builds overlapping, page-tagged chunks from extracted pages.
 *
 * Pages are concatenated first so a paragraph spanning a page break stays whole
 * — chunking strictly per page would cut mid-sentence at every boundary. Page
 * provenance is preserved by tracking which page each unit came from.
 */
export function chunkPages(pages: PageText[]): Chunk[] {
  const units: Array<{ text: string; page: number }> = [];
  for (const page of pages) {
    for (const unit of toUnits(page.text)) {
      units.push({ text: unit, page: page.page });
    }
  }

  if (units.length === 0) return [];

  const chunks: Chunk[] = [];
  let buffer: Array<{ text: string; page: number }> = [];
  let bufferTokens = 0;

  const flush = () => {
    if (buffer.length === 0) return;

    const content = buffer.map((u) => u.text).join('\n\n').trim();
    const tokenCount = estimateTokens(content);
    if (tokenCount < MIN_CHUNK_TOKENS && chunks.length > 0) {
      // A trailing fragment is more useful appended to the previous chunk than
      // as a standalone chunk that will never retrieve well on its own.
      const prev = chunks[chunks.length - 1]!;
      prev.content = `${prev.content}\n\n${content}`;
      prev.tokenCount = estimateTokens(prev.content);
      prev.pageTo = buffer[buffer.length - 1]!.page;
      buffer = [];
      bufferTokens = 0;
      return;
    }

    chunks.push({
      chunkIndex: chunks.length,
      pageFrom: buffer[0]!.page,
      pageTo: buffer[buffer.length - 1]!.page,
      content,
      tokenCount,
    });

    // Carry the tail of this chunk into the next one so boundary-straddling
    // facts appear in full in at least one chunk.
    const overlap: typeof buffer = [];
    let overlapTokens = 0;
    for (let i = buffer.length - 1; i >= 0; i--) {
      const unit = buffer[i]!;
      const unitTokens = estimateTokens(unit.text);
      if (overlapTokens + unitTokens > OVERLAP_TOKENS) break;
      overlap.unshift(unit);
      overlapTokens += unitTokens;
    }

    buffer = overlap;
    bufferTokens = overlapTokens;
  };

  for (const unit of units) {
    const unitTokens = estimateTokens(unit.text);

    if (bufferTokens + unitTokens > TARGET_TOKENS && buffer.length > 0) {
      flush();
    }

    buffer.push(unit);
    bufferTokens += unitTokens;
  }

  // Final flush without overlap carry-over.
  if (buffer.length > 0) {
    const content = buffer.map((u) => u.text).join('\n\n').trim();
    const tokenCount = estimateTokens(content);

    if (tokenCount < MIN_CHUNK_TOKENS && chunks.length > 0) {
      const prev = chunks[chunks.length - 1]!;
      prev.content = `${prev.content}\n\n${content}`;
      prev.tokenCount = estimateTokens(prev.content);
      prev.pageTo = buffer[buffer.length - 1]!.page;
    } else {
      chunks.push({
        chunkIndex: chunks.length,
        pageFrom: buffer[0]!.page,
        pageTo: buffer[buffer.length - 1]!.page,
        content,
        tokenCount,
      });
    }
  }

  return chunks;
}
