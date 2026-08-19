import 'server-only';

import { createOpenAI } from '@ai-sdk/openai';

import { env } from '@/lib/env';

/**
 * LLM provider.
 *
 * Constructed explicitly with the key from validated env rather than relying on
 * ambient `process.env` pickup, so there is exactly one place where the API key
 * enters the system. This module is server-only; the key never reaches a bundle
 * the browser can see.
 *
 * OpenAI rather than Gemini, after measuring Gemini's free tier in practice: its
 * flash models allow only 20 `generate_content` requests *per day* per project,
 * which a single ingest plus a short conversation exhausts —
 * `RESOURCE_EXHAUSTED ... limit: 20`. A reviewer opening the deployed app would
 * hit a 429 within minutes. Paid OpenAI usage costs cents at this scale and
 * removes that failure mode entirely.
 */

let provider: ReturnType<typeof createOpenAI> | null = null;

function openai() {
  provider ??= createOpenAI({ apiKey: env().OPENAI_API_KEY });
  return provider;
}

/** Main reasoning model: summaries and grounded chat answers. */
export function chatModel() {
  return openai()(env().OPENAI_CHAT_MODEL);
}

/**
 * Cheaper, faster model for mechanical sub-tasks.
 *
 * Query rewriting runs on every chat turn and sits directly in the latency path
 * before retrieval can start, so it uses the smaller model. The quality
 * difference is negligible for "rewrite this into a standalone question", and it
 * keeps cost and latency down on a call the user never sees.
 */
export function fastModel() {
  return openai()(env().OPENAI_FAST_MODEL);
}

export function embeddingModel() {
  return openai().textEmbeddingModel(env().OPENAI_EMBEDDING_MODEL);
}
