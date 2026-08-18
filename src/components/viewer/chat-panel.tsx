'use client';

import * as React from 'react';
import { Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { MAX_QUESTION_LENGTH } from '@/lib/validation';

type Citation = { chunkId: string; pageFrom: number; pageTo: number };

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  /** True while tokens are still arriving. */
  streaming?: boolean;
};

const SUGGESTIONS = [
  'What is this document about?',
  'What are the key dates or deadlines?',
  'Summarise the main obligations.',
  'Is there anything unusual or risky here?',
];

/**
 * Renders assistant text.
 *
 * A deliberately small markdown subset — bold, inline code, bullets, and the
 * `[p.N]` citation chips the prompt asks the model to emit. Pulling in a full
 * markdown renderer plus a sanitiser for four constructs is not a trade worth
 * making, and hand-rendering guarantees no raw HTML is ever interpreted.
 */
function AssistantText({
  content,
  onCite,
}: {
  content: string;
  onCite?: (page: number) => void;
}) {
  const blocks = content.split(/\n{2,}/);

  const renderInline = (text: string, keyPrefix: string) => {
    /*
     * Matches both citation shapes the model produces: `[p.4]` for a chunk on a
     * single page, and `[pp.2-8]` for one spanning a range — the context is
     * labelled with the range, so the model mirrors it. Both are clickable and
     * jump to the first page of the range.
     */
    const parts = text.split(/(\[pp?\.\s*\d+\s*(?:[-–]\s*\d+)?\]|\*\*[^*]+\*\*|`[^`]+`)/g);

    return parts.map((part, i) => {
      const key = `${keyPrefix}-${i}`;

      const citation = part.match(/^\[pp?\.\s*(\d+)\s*(?:[-–]\s*(\d+))?\]$/);
      if (citation) {
        const page = Number(citation[1]);
        const end = citation[2] ? Number(citation[2]) : null;
        const label = end && end !== page ? `pp.${page}-${end}` : `p.${page}`;
        return (
          <button
            key={key}
            onClick={() => onCite?.(page)}
            className="mx-0.5 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 align-baseline text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/20 transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`Jump to page ${page}`}
          >
            {label}
          </button>
        );
      }

      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }

      if (/^`[^`]+`$/.test(part)) {
        return (
          <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        );
      }

      return <React.Fragment key={key}>{part}</React.Fragment>;
    });
  };

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n');
        const isList = lines.every((line) => /^\s*[-*•]\s+/.test(line));

        if (isList) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>
                  {renderInline(line.replace(/^\s*[-*•]\s+/, ''), `${blockIndex}-${i}`)}
                </li>
              ))}
            </ul>
          );
        }

        return <p key={blockIndex}>{renderInline(block, String(blockIndex))}</p>;
      })}
    </div>
  );
}

/**
 * Document chat panel.
 *
 * Streams answers token-by-token by reading the response body directly. The
 * server sends one JSON line of citations first, then raw text — so page chips
 * appear immediately rather than after the answer completes.
 */
export function ChatPanel({
  documentId,
  ready,
  onCite,
}: {
  documentId: string;
  ready: boolean;
  onCite?: (page: number) => void;
}) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [loadingHistory, setLoadingHistory] = React.useState(true);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  // Restore the transcript so a reload does not lose the conversation.
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/chat`);
        if (!response.ok) return;
        const data = (await response.json()) as { messages: Message[] };
        if (!cancelled) setMessages(data.messages ?? []);
      } catch {
        // Non-fatal: an empty panel is a fine starting state.
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Keep the newest content in view as tokens stream in.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  // Cancel any in-flight stream when the panel unmounts.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy || !ready) return;

    const userMessage: Message = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      citations: [],
    };
    const assistantId = `local-assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', citations: [], streaming: true },
    ]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/documents/${documentId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(problem?.error ?? 'The assistant could not answer right now.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let headerParsed = false;
      let answer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // First line is the citations payload; everything after is answer text.
        if (!headerParsed) {
          const newline = buffer.indexOf('\n');
          if (newline === -1) continue;

          const header = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          headerParsed = true;

          try {
            const parsed = JSON.parse(header) as { citations?: Citation[] };
            const citations = parsed.citations ?? [];
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, citations } : m)),
            );
          } catch {
            // Malformed header: continue without citation chips.
          }
        }

        if (buffer) {
          answer += buffer;
          buffer = '';
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: answer } : m)),
          );
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      );
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;

      // Drop the empty assistant bubble rather than leaving a blank message.
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      toast.error('Could not get an answer', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }

  async function clearChat() {
    try {
      await fetch(`/api/documents/${documentId}/chat`, { method: 'DELETE' });
      setMessages([]);
    } catch {
      toast.error('Could not clear the conversation.');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Grounded in this PDF
        </h2>
        {messages.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={clearChat}
            className="ml-auto"
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="space-y-4">
            <EmptyState
              icon={Sparkles}
              title="Ask anything about this PDF"
              description="Answers come only from the document's text, with page citations you can click."
              className="py-4"
            />
            <div className="space-y-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => ask(suggestion)}
                  disabled={!ready || busy}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={message.id} className="space-y-2">
                <div className="rounded-lg rounded-bl-sm bg-muted px-3 py-2">
                  {message.content ? (
                    <AssistantText content={message.content} onCite={onCite} />
                  ) : (
                    <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      Searching the document…
                    </div>
                  )}
                </div>

                {message.citations.length > 0 && !message.streaming ? (
                  <div className="flex flex-wrap items-center gap-1 px-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Sources
                    </span>
                    {[...new Set(message.citations.map((c) => c.pageFrom))]
                      .sort((a, b) => a - b)
                      .map((page) => (
                        <button
                          key={page}
                          onClick={() => onCite?.(page)}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          p.{page}
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
            ),
          )
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="shrink-0 border-t border-border p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_QUESTION_LENGTH))}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter adds a newline.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder={ready ? 'Ask a question…' : 'Available once processing finishes'}
            disabled={!ready || busy}
            rows={1}
            aria-label="Ask a question about this document"
            className={cn(
              'max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!ready || busy || input.trim().length === 0}
            aria-label="Send question"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
