'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FileText, MessageSquareText, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorText } from '@/components/ui/misc';
import { apiFetch, RequestError } from '@/lib/fetcher';

/**
 * Name prompt shown to an account-less visitor opening a share link.
 *
 * A display name is collected up front rather than at first comment so that
 * comments and chat both have an author from the outset, and so the visitor
 * understands they are identified before they say anything.
 */
export function GuestJoin({
  token,
  filename,
  ownerName,
  summary,
  canComment,
  suggestedName,
}: {
  token: string;
  filename: string;
  ownerName: string;
  summary: string | null;
  canComment: boolean;
  suggestedName?: string;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(suggestedName ?? '');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      await apiFetch('/api/shares/join', {
        method: 'POST',
        json: { token, displayName: name.trim() },
      });
      // Re-render the same route; the server now sees the guest cookie.
      router.refresh();
    } catch (err) {
      setError(
        err instanceof RequestError ? err.message : 'Something went wrong. Try again.',
      );
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md p-7">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-md bg-primary/10 p-2">
          <FileText className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{ownerName}</span> shared a
            document with you
          </p>
          <h1 className="mt-0.5 break-words text-lg font-semibold leading-snug">
            {filename}
          </h1>
        </div>
      </div>

      {summary ? (
        <div className="mt-5 rounded-md border border-border bg-muted/40 p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3" />
            AI summary
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {summary}
          </p>
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="displayName">Your name</Label>
          <Input
            id="displayName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jordan Patel"
            maxLength={60}
            autoComplete="name"
            autoFocus
            required
            invalid={Boolean(error)}
            aria-describedby="displayName-hint"
          />
          <p id="displayName-hint" className="text-xs text-muted-foreground">
            {canComment
              ? 'Shown next to your comments. No account needed.'
              : 'Used to identify you while viewing. No account needed.'}
          </p>
        </div>

        <ErrorText>{error}</ErrorText>

        <Button
          type="submit"
          className="w-full"
          loading={pending}
          disabled={name.trim().length === 0}
        >
          {pending ? 'Opening…' : 'Open document'}
        </Button>
      </form>

      <ul className="mt-5 space-y-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <FileText className="size-3.5 shrink-0" />
          Read the full PDF
        </li>
        <li className="flex items-center gap-2">
          <Sparkles className="size-3.5 shrink-0" />
          Ask the AI questions about its contents
        </li>
        {canComment ? (
          <li className="flex items-center gap-2">
            <MessageSquareText className="size-3.5 shrink-0" />
            Join the comment thread
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
