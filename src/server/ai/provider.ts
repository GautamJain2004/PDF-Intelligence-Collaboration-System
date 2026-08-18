import 'server-only';

import { createGoogleGenerativeAI } from '@ai-sdk/google';

import { env } from '@/lib/env';

/**
 * LLM provider.
 *
 * Constructed explicitly with the key from validated env rather than relying on
 * ambient `process.env` pickup, so there is exactly one place where the API key
 * enters the system. This module is server-only; the key never reaches a bundle
 * the browser can see.
 *
 * Gemini was chosen because it is the only major provider whose free tier
 * covers both chat *and* embeddings, so a reviewer can run the whole app —
 * summaries, chat, and semantic search — on a single no-cost key.
 */

let provider: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function google() {
  provider ??= createGoogleGenerativeAI({ apiKey: env().GOOGLE_GENERATIVE_AI_API_KEY });
  return provider;
}

/** Main reasoning model: summaries and grounded chat answers. */
export function chatModel() {
  return google()(env().GEMINI_CHAT_MODEL);
}

/**
 * Cheaper, faster model for mechanical sub-tasks.
 *
 * Query rewriting runs on every chat turn and sits directly in the latency path
 * before retrieval can even start, so it uses the lite model. The quality
 * difference is negligible for "rewrite this into a standalone question", and
 * it keeps free-tier quota for the answers that matter.
 */
export function fastModel() {
  return google()(env().GEMINI_FAST_MODEL);
}

export function embeddingModel() {
  return google().textEmbeddingModel(env().GEMINI_EMBEDDING_MODEL);
}
