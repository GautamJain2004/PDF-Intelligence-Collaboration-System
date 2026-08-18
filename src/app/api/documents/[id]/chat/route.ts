import { streamText } from 'ai';

import { requireDocumentAccess } from '@/server/auth/access';
import { chatModel } from '@/server/ai/provider';
import { CHAT_SYSTEM_PROMPT, chatUserPrompt } from '@/server/ai/prompts';
import { retrieveChunks } from '@/server/ai/retrieve';
import {
  clearTranscript,
  loadHistory,
  loadTranscript,
  rewriteQuery,
  saveMessage,
  type ChatActor,
  type Citation,
} from '@/server/ai/chat';
import { chatSchema } from '@/lib/validation';
import { ApiError, handleApiError, json, parseJson, rateLimited } from '@/lib/api';
import { LIMITS, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Derives the chat actor from resolved access. */
function toActor(access: Awaited<ReturnType<typeof requireDocumentAccess>>): ChatActor {
  return access.kind === 'owner'
    ? { kind: 'user', userId: access.userId }
    : { kind: 'guest', guestId: access.guestId };
}

/** Returns the caller's transcript so the panel survives a reload. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDocumentAccess(id);

    return json({ messages: await loadTranscript(id, toActor(access)) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Clears the caller's own transcript. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDocumentAccess(id);

    await clearTranscript(id, toActor(access));
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Answers a question about the document, streaming the response.
 *
 * Pipeline per question:
 *   1. Load the last few turns for this actor.
 *   2. Rewrite the question into a standalone query (resolves "it", "that clause").
 *   3. Hybrid-retrieve the most relevant chunks — never the whole document.
 *   4. Stream a grounded answer built only from those chunks.
 *   5. Persist the completed turn with its citations.
 *
 * Citations are sent as a JSON preamble line before the token stream, so the UI
 * can render clickable page chips the moment streaming starts rather than
 * waiting for the answer to finish.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDocumentAccess(id);

    if (access.document.status !== 'ready') {
      throw new ApiError(
        409,
        'This document is still being processed. Chat becomes available once it is ready.',
      );
    }

    const actor = toActor(access);
    const actorKey = actor.kind === 'user' ? actor.userId : actor.guestId;

    // LLM calls cost real money and quota, so this is the tightest limit.
    const limit = rateLimit(`chat:${actorKey}`, LIMITS.chat);
    if (!limit.ok) {
      throw rateLimited(
        `You have reached the question limit. Please wait ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      );
    }

    const { question } = await parseJson(request, chatSchema);

    const history = await loadHistory(id, actor);
    const { query } = await rewriteQuery(question, history);
    const chunks = await retrieveChunks(id, query);

    const citations: Citation[] = chunks.map((chunk) => ({
      chunkId: chunk.id,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
    }));

    // Persist the question before streaming, so it is not lost if the client
    // disconnects mid-answer.
    await saveMessage({ documentId: id, actor, role: 'user', content: question });

    const result = streamText({
      model: chatModel(),
      system: CHAT_SYSTEM_PROMPT,
      messages: [
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user' as const, content: chatUserPrompt(question, chunks) },
      ],
      // Low but non-zero: grounded answers should be near-deterministic while
      // still reading as natural prose.
      temperature: 0.3,
      onFinish: async ({ text }) => {
        try {
          await saveMessage({
            documentId: id,
            actor,
            role: 'assistant',
            content: text,
            citations,
          });
        } catch (error) {
          // The user already has their answer; a persistence failure must not
          // surface as a broken stream.
          console.error('[chat] failed to persist assistant message:', error);
        }
      },
    });

    /*
     * Custom stream framing: one JSON metadata line, then raw text tokens.
     * Simpler than the SDK's full UI-message protocol and gives exactly what
     * this UI needs — citations up front, tokens as they arrive.
     */
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: 'citations', citations })}\n`),
        );

        try {
          for await (const delta of result.textStream) {
            controller.enqueue(encoder.encode(delta));
          }
        } catch (error) {
          console.error('[chat] stream error:', error);
          controller.enqueue(
            encoder.encode('\n\n_The response was cut short. Please try again._'),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        // Tells proxies not to buffer, which would defeat streaming.
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
