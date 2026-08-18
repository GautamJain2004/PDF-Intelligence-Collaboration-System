import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { generateText } from 'ai';

import { db } from '@/server/db/client';
import { chatMessages } from '@/server/db/schema';
import { fastModel } from './provider';
import { QUERY_REWRITE_SYSTEM_PROMPT, queryRewritePrompt } from './prompts';

/**
 * Conversation state and query preparation for document chat.
 */

/**
 * Conversation turns replayed to the model.
 *
 * The brief asks for at least 3-5 turns. Five user/assistant pairs is enough
 * for natural follow-ups without letting an old tangent dominate the context or
 * the token bill.
 */
const HISTORY_TURNS = 5;
const HISTORY_MESSAGE_LIMIT = HISTORY_TURNS * 2;

/** Guards against one enormous pasted message crowding out the excerpts. */
const MAX_HISTORY_CHARS = 6000;

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ChatActor =
  | { kind: 'user'; userId: string }
  | { kind: 'guest'; guestId: string };

function actorPredicate(documentId: string, actor: ChatActor) {
  return actor.kind === 'user'
    ? and(
        eq(chatMessages.documentId, documentId),
        eq(chatMessages.actorUserId, actor.userId),
      )
    : and(
        eq(chatMessages.documentId, documentId),
        eq(chatMessages.actorGuestId, actor.guestId),
      );
}

/**
 * Loads recent conversation history for one actor.
 *
 * Conversations are private per actor: an owner never sees a guest's questions,
 * and two guests on the same link do not share a transcript.
 */
export async function loadHistory(
  documentId: string,
  actor: ChatActor,
): Promise<ChatTurn[]> {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(actorPredicate(documentId, actor))
    .orderBy(desc(chatMessages.createdAt))
    .limit(HISTORY_MESSAGE_LIMIT);

  // Query is newest-first for the LIMIT; the model needs chronological order.
  const turns = rows.reverse().map((row) => ({
    role: row.role,
    content: row.content.slice(0, MAX_HISTORY_CHARS),
  }));

  /*
   * Drop a leading assistant message. A history that starts mid-exchange
   * confuses the rewriter, and some providers reject a leading assistant turn
   * outright.
   */
  while (turns.length > 0 && turns[0]!.role === 'assistant') turns.shift();

  return turns;
}

/**
 * Rewrites a follow-up question into a standalone retrieval query.
 *
 * This is what makes conversational follow-ups actually work. "What about
 * clause 4?" embeds to near-noise on its own; resolved against the history it
 * becomes a query that retrieves the right passages.
 *
 * Failure is non-fatal — falling back to the raw question yields worse
 * retrieval, but still an answer, which beats erroring out.
 */
export async function rewriteQuery(
  question: string,
  history: ChatTurn[],
): Promise<{ query: string; rewritten: boolean }> {
  // A first question has no context to resolve against.
  if (history.length === 0) return { query: question, rewritten: false };

  try {
    const { text } = await generateText({
      model: fastModel(),
      system: QUERY_REWRITE_SYSTEM_PROMPT,
      prompt: queryRewritePrompt(history.slice(-HISTORY_MESSAGE_LIMIT), question),
      temperature: 0,
    });

    const rewritten = text.trim().replace(/^["']|["']$/g, '');

    // Sanity-check the rewrite: an empty or runaway response means the model
    // misbehaved, so prefer the user's original wording.
    if (rewritten.length === 0 || rewritten.length > 500) {
      return { query: question, rewritten: false };
    }

    return { query: rewritten, rewritten: rewritten !== question };
  } catch (error) {
    console.error('[chat] query rewrite failed, using raw question:', error);
    return { query: question, rewritten: false };
  }
}

export type Citation = { chunkId: string; pageFrom: number; pageTo: number };

/** Persists one turn. Citations are stored as JSON for later rendering. */
export async function saveMessage(params: {
  documentId: string;
  actor: ChatActor;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}) {
  await db.insert(chatMessages).values({
    documentId: params.documentId,
    actorUserId: params.actor.kind === 'user' ? params.actor.userId : null,
    actorGuestId: params.actor.kind === 'guest' ? params.actor.guestId : null,
    role: params.role,
    content: params.content,
    citations: params.citations?.length ? JSON.stringify(params.citations) : null,
  });
}

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  createdAt: Date;
};

/** Full transcript for rehydrating the panel on page load. */
export async function loadTranscript(
  documentId: string,
  actor: ChatActor,
): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(actorPredicate(documentId, actor))
    .orderBy(desc(chatMessages.createdAt))
    .limit(100);

  return rows.reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    citations: row.citations ? (JSON.parse(row.citations) as Citation[]) : [],
    createdAt: row.createdAt,
  }));
}

/** Clears one actor's transcript without touching anyone else's. */
export async function clearTranscript(documentId: string, actor: ChatActor) {
  await db.delete(chatMessages).where(actorPredicate(documentId, actor));
}
