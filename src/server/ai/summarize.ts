import 'server-only';

import { generateText } from 'ai';

import { chatModel, fastModel } from './provider';
import {
  SUMMARY_MAP_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  summaryReducePrompt,
  summaryUserPrompt,
} from './prompts';
import { estimateTokens } from '@/server/pdf/chunk';
import type { PageText } from '@/server/pdf/extract';

/**
 * Document summarisation.
 *
 * Takes extracted pages rather than retrieval chunks on purpose: chunks carry
 * ~15% overlap, which is right for retrieval but would feed the summariser the
 * same sentences twice and skew what it treats as important.
 *
 * Handles the long-document problem with a two-tier strategy:
 *
 *  - **Short documents** (the common case) go to the model in one pass. Whole
 *    context, best possible summary, one API call.
 *  - **Long documents** use map-reduce: each section is compressed to notes in
 *    parallel, then a single reduce pass writes the summary from those notes.
 *
 * The alternative — truncating to the first N pages — was rejected: it silently
 * produces a summary of the introduction that reads as though it covers the
 * whole document, which is worse than being slower.
 */

/**
 * Threshold for the single-pass path.
 *
 * Well inside the chat model's context window, chosen so the model attends
 * evenly across the whole text. Summary quality degrades on very long single
 * prompts well before the hard context limit is reached.
 */
const SINGLE_PASS_TOKEN_LIMIT = 24_000;

/** Tokens of document text per map-step section. */
const MAP_SECTION_TOKEN_LIMIT = 12_000;

/** Bounds fan-out on very large documents, capping cost and rate-limit risk. */
const MAX_MAP_SECTIONS = 12;

const NO_CONTENT_SENTINEL = 'NO SUBSTANTIVE CONTENT';

export type SummaryResult = {
  summary: string;
  strategy: 'single-pass' | 'map-reduce';
};

/** Trims model output down to the requested 3-5 sentences. */
function tidySummary(text: string): string {
  const cleaned = text
    .trim()
    // Models occasionally wrap output in quotes or lead with a label.
    .replace(/^["']|["']$/g, '')
    .replace(/^(?:summary|answer)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!sentences || sentences.length <= 5) return cleaned;

  return sentences.slice(0, 5).join('').trim();
}

/** Groups pages into sections that fit the map-step budget. */
function toSections(pages: PageText[]): string[] {
  const sections: string[] = [];
  let buffer: string[] = [];
  let tokens = 0;

  for (const page of pages) {
    const pageTokens = estimateTokens(page.text);
    if (tokens + pageTokens > MAP_SECTION_TOKEN_LIMIT && buffer.length > 0) {
      sections.push(buffer.join('\n\n'));
      buffer = [];
      tokens = 0;
    }
    buffer.push(page.text);
    tokens += pageTokens;
  }

  if (buffer.length > 0) sections.push(buffer.join('\n\n'));

  if (sections.length <= MAX_MAP_SECTIONS) return sections;

  /*
   * Too many sections: sample evenly across the document rather than taking the
   * first N, so the summary stays representative of the whole document instead
   * of over-weighting its opening.
   */
  const step = sections.length / MAX_MAP_SECTIONS;
  return Array.from(
    { length: MAX_MAP_SECTIONS },
    (_, i) => sections[Math.floor(i * step)]!,
  );
}

async function summarizeSinglePass(filename: string, text: string): Promise<string> {
  const { text: output } = await generateText({
    model: chatModel(),
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: summaryUserPrompt(filename, text),
    temperature: 0.2,
  });
  return tidySummary(output);
}

async function summarizeMapReduce(
  filename: string,
  pages: PageText[],
): Promise<string> {
  const sections = toSections(pages);

  // Map: compress each section to notes. Run concurrently — these are
  // independent, and sequential calls would dominate ingest latency.
  const notes = await Promise.all(
    sections.map(async (section) => {
      const { text } = await generateText({
        model: fastModel(),
        system: SUMMARY_MAP_SYSTEM_PROMPT,
        prompt: section,
        temperature: 0.1,
      });
      return text.trim();
    }),
  );

  const useful = notes.filter(
    (note) => note.length > 0 && !note.includes(NO_CONTENT_SENTINEL),
  );

  if (useful.length === 0) {
    throw new Error('Every section returned empty notes.');
  }

  // Reduce: one synthesis pass over the notes, on the stronger model.
  const { text: output } = await generateText({
    model: chatModel(),
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: summaryReducePrompt(filename, useful),
    temperature: 0.2,
  });

  return tidySummary(output);
}

/** Produces a 3-5 sentence summary, picking the strategy from document length. */
export async function summarizeDocument(
  filename: string,
  pages: PageText[],
): Promise<SummaryResult> {
  if (pages.length === 0) {
    throw new Error('Cannot summarise a document with no extracted text.');
  }

  const fullText = pages.map((p) => p.text).join('\n\n');

  if (estimateTokens(fullText) <= SINGLE_PASS_TOKEN_LIMIT) {
    return {
      summary: await summarizeSinglePass(filename, fullText),
      strategy: 'single-pass',
    };
  }

  return {
    summary: await summarizeMapReduce(filename, pages),
    strategy: 'map-reduce',
  };
}
