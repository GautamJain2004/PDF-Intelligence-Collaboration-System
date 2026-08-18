import 'server-only';

import type { RetrievedChunk } from './retrieve';

/**
 * Prompt library.
 *
 * Kept in one file so prompt changes are reviewable as a unit rather than
 * scattered through route handlers, and so the reasoning behind each
 * instruction is written down next to it.
 */

// ---------------------------------------------------------------------------
// Summarisation
// ---------------------------------------------------------------------------

/**
 * Summary system prompt.
 *
 * The brief explicitly warns against "a generic restatement", which is the
 * default failure mode: models open with "This document discusses..." and then
 * describe the document's *shape* instead of its *content*. Countermeasures:
 *
 * - Ban the meta-framing phrasing outright, with examples.
 * - Demand specifics (parties, amounts, dates, obligations) so the summary
 *   carries information a reader could act on.
 * - Require it to work as a standalone answer to "what is this and what does it
 *   say?", since it is read on a dashboard card without the document present.
 * - Forbid outside knowledge, so a familiar-looking contract is not summarised
 *   from the model's training data instead of the actual text.
 */
export const SUMMARY_SYSTEM_PROMPT = `You write dense, factual summaries of documents for a professional audience.

Write 3-5 sentences. Optimise for information per word.

REQUIRED:
- Open by naming what the document actually is (e.g. "A mutual NDA between Acme Corp and a contractor", "A 2023 clinical study of statin adherence in 1,200 patients").
- State the substance: the specific parties, amounts, dates, deadlines, obligations, findings, or conclusions that appear in the text.
- Prefer concrete detail over abstraction. "Payment is due within 30 days of invoice" beats "the document covers payment terms".
- End with what matters most to someone deciding whether to read the full document.

FORBIDDEN:
- Do NOT begin with "This document", "This PDF", "The text", "This report", or any similar meta-framing.
- Do NOT describe the document's structure ("It is divided into five sections", "The document begins by...").
- Do NOT add information that is not in the provided text, even if you recognise the document type.
- Do NOT hedge with "appears to", "seems to", or "likely" when the text states something plainly.
- Do NOT use bullet points, headings, or markdown. Plain prose only.

If the provided text is too fragmentary to summarise meaningfully, say so in one sentence rather than inventing content.`;

export function summaryUserPrompt(filename: string, text: string): string {
  return `Filename: ${filename}

Document text:
"""
${text}
"""

Write the summary now.`;
}

/**
 * Map step for documents too long to summarise in one pass.
 *
 * Asks for compressed *notes*, not prose: the output is machine input for the
 * reduce step, so fluent sentences would only waste tokens.
 */
export const SUMMARY_MAP_SYSTEM_PROMPT = `You extract the key factual content from one section of a longer document.

Produce a compact set of notes (under 150 words) capturing:
- concrete facts: names, parties, figures, dates, defined terms
- obligations, conditions, findings, or decisions stated in this section
- anything a summary of the whole document would be wrong to omit

Write terse note fragments, not polished prose. No preamble, no meta-commentary about the section. If the section is boilerplate (signature blocks, page furniture, tables of contents), reply with exactly: NO SUBSTANTIVE CONTENT`;

export function summaryReducePrompt(filename: string, notes: string[]): string {
  return `Filename: ${filename}

Below are ordered notes extracted from consecutive sections of a single document.

${notes.map((note, i) => `--- Section ${i + 1} ---\n${note}`).join('\n\n')}

Using only these notes, write the 3-5 sentence summary of the document as a whole. Follow every rule in your instructions.`;
}

// ---------------------------------------------------------------------------
// Query rewriting
// ---------------------------------------------------------------------------

/**
 * Condenses a follow-up into a standalone question before retrieval.
 *
 * This is the single highest-leverage piece of the RAG pipeline. Embedding
 * "what about clause 4?" retrieves essentially noise, because the pronoun and
 * the elided subject carry the actual meaning. Rewriting it to "What does
 * clause 4 of the Acme services agreement say about termination?" makes the
 * vector search work. Without this step, follow-up questions fail in a way that
 * looks like the retrieval is broken.
 *
 * Guardrails matter here: the model must not *answer*, must not invent
 * specifics, and must pass standalone questions through untouched.
 */
export const QUERY_REWRITE_SYSTEM_PROMPT = `You rewrite a user's latest message into a single self-contained search query for a document retrieval system.

Rules:
- Resolve pronouns and references ("it", "that clause", "the second one", "what about X?") using the conversation history.
- If the latest message is already self-contained, return it unchanged.
- Preserve the user's specific terminology, names, and numbers exactly — they are the strongest retrieval signal.
- Never answer the question.
- Never invent details that appear in neither the history nor the message.
- Output only the rewritten query, as one line, with no quotes, prefix, or explanation.`;

export function queryRewritePrompt(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  question: string,
): string {
  if (history.length === 0) return question;

  const transcript = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  return `Conversation so far:
${transcript}

Latest user message: ${question}

Rewritten standalone query:`;
}

// ---------------------------------------------------------------------------
// Grounded question answering
// ---------------------------------------------------------------------------

/**
 * Chat system prompt.
 *
 * The brief requires answers grounded in the document and explicit handling of
 * questions the document does not answer. Design decisions:
 *
 * - Context is framed as the *only* permissible source, closing the most common
 *   RAG failure where the model quietly supplements from pretraining.
 * - Citations are mandatory and page-based, which makes every claim checkable
 *   and drives the clickable page chips in the UI.
 * - "Not in the document" is given an explicit, dignified script. Without one,
 *   models improvise something plausible instead of admitting the gap.
 * - Partial answers are handled separately from total misses, because "the
 *   document covers X but not Y" is genuinely more useful than a flat refusal.
 * - The retrieval caveat is stated: excerpts are a subset, so absence from
 *   context is not proof of absence from the document.
 */
export const CHAT_SYSTEM_PROMPT = `You answer questions about one specific document. The excerpts provided in each message are your ONLY source of truth.

GROUNDING (non-negotiable):
- Base every factual claim solely on the provided excerpts.
- Never use outside knowledge, even if you recognise the document or the subject matter.
- Never infer beyond what the text supports. Quoting or closely paraphrasing is better than restating loosely.

CITATIONS:
- Cite the page for every factual claim, in square brackets: [p.4]
- For a claim spanning pages, cite each: [p.4][p.5]
- Place the citation immediately after the claim it supports, not bundled at the end.

WHEN THE EXCERPTS DO NOT CONTAIN THE ANSWER:
- Say so directly: "The excerpts I can see don't cover that."
- Do not speculate, and do not pad with loosely related content.
- If the excerpts partially answer it, give the part you can support with citations, then state precisely what is missing.
- You are shown the most relevant excerpts, not the whole document — so say the excerpts don't cover it, never that the document doesn't contain it. If a rephrasing might retrieve better, suggest one.

STYLE:
- Answer directly. No preamble like "Based on the provided excerpts".
- Be concise; expand only when the question needs detail.
- Use markdown lists or short paragraphs when structure aids clarity.
- Match the document's terminology rather than substituting your own.
- If the question is ambiguous, answer the most likely reading and note the assumption in one clause.`;

/**
 * Builds the per-turn user message.
 *
 * Excerpts are numbered and page-labelled so the model has an unambiguous
 * referent for citations, and the question is repeated after the context —
 * models attend more reliably to instructions positioned near the end.
 */
export function chatUserPrompt(question: string, chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return `No excerpts from the document matched this question.

Question: ${question}

Tell the user you could not find anything relevant in the document for this question, and suggest they rephrase it or use different terms.`;
  }

  const context = chunks
    .map((chunk, i) => {
      const pages =
        chunk.pageFrom === chunk.pageTo
          ? `p.${chunk.pageFrom}`
          : `pp.${chunk.pageFrom}-${chunk.pageTo}`;
      return `[Excerpt ${i + 1} | ${pages}]\n${chunk.content}`;
    })
    .join('\n\n');

  return `Document excerpts:
"""
${context}
"""

Question: ${question}`;
}
