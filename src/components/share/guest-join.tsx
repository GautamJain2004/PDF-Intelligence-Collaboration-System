'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, LogIn, MessageSquareText, Sparkles, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorText } from '@/components/ui/misc';
import { apiFetch, RequestError } from '@/lib/fetcher';

/**
 * Entry point for a visitor opening a share link.
 *
 * The link always lands here and always offers the same two routes in — guest
 * or account — even for someone who has been here before. Silently resuming
 * whichever identity they last used takes the decision away: a person who read
 * a document as a guest yesterday may want to comment under their real account
 * today, and had no way to say so.
 *
 * What being recognised buys is *fewer keystrokes*, not fewer choices. A
 * returning guest gets a one-click button with their remembered name; someone
 * with a live session gets a one-click button with their account name. Neither
 * has to retype anything, and both still choose.
 *
 * Identity is settled here rather than at first comment so comments and chat
 * have an author from the outset, and so the visitor knows they are identified
 * before they say anything.
 *
 * Note there is deliberately no "look up my name" request as the email is
 * typed. That endpoint would answer "has this address commented before?" for
 * anyone holding a link, which is a privacy leak for a field that costs nothing
 * to leave blank.
 */
export function GuestJoin({
  token,
  filename,
  ownerName,
  summary,
  canComment,
  invitedEmail,
  rememberedName,
  hasGuestGrant,
  signedInName,
}: {
  token: string;
  filename: string;
  ownerName: string;
  summary: string | null;
  canComment: boolean;
  /** Set when the link was emailed to a specific person. */
  invitedEmail?: string | null;
  /** The name this visitor used last time, if we have seen them before. */
  rememberedName?: string | null;
  /** True when this browser already holds a usable grant for this share. */
  hasGuestGrant?: boolean;
  /** Account name when a session is live, so signing in is a single click. */
  signedInName?: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState(rememberedName ?? '');
  const [pending, setPending] = React.useState<'guest' | 'account' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** Only shown on request when we already know who this is. */
  const [renaming, setRenaming] = React.useState(false);

  // The link was addressed to someone, so asking for their email again is
  // asking a question we already have the answer to.
  const knownEmail = invitedEmail ?? null;
  const recognised = Boolean(rememberedName) && (Boolean(knownEmail) || Boolean(hasGuestGrant));
  const nameFieldShown = !recognised || renaming;

  /**
   * Marks the entry as chosen.
   *
   * The bare link always shows this screen; `?open=1` is what says "they have
   * picked". It is not a security boundary — access is still the grant cookie —
   * it only stops the chooser from being skipped on the next visit.
   */
  function enter() {
    router.replace(`/s/${token}?open=1`);
    router.refresh();
  }

  async function continueAsGuest(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    setPending('guest');
    setError(null);

    try {
      // A grant already in hand needs no second one; re-posting would just pile
      // up guest sessions for the same person.
      if (!hasGuestGrant || renaming) {
        await apiFetch('/api/shares/join', {
          method: 'POST',
          json: {
            token,
            mode: 'guest',
            ...(knownEmail || email.trim() ? { email: knownEmail ?? email.trim() } : {}),
            // Omitted rather than sent empty, so a remembered name survives.
            ...(name.trim() ? { displayName: name.trim() } : {}),
          },
        });
      }
      enter();
    } catch (err) {
      setError(
        err instanceof RequestError ? err.message : 'Something went wrong. Try again.',
      );
      setPending(null);
    }
  }

  /** One click for a live session: the server reads identity from the cookie. */
  async function continueWithAccount() {
    if (pending) return;

    setPending('account');
    setError(null);

    try {
      await apiFetch('/api/shares/join', {
        method: 'POST',
        json: { token, mode: 'account' },
      });
      enter();
    } catch (err) {
      setError(
        err instanceof RequestError ? err.message : 'Could not open this document.',
      );
      setPending(null);
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
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            <Sparkles className="size-3 text-primary" />
            AI summary
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {summary}
          </p>
        </div>
      ) : null}

      <form onSubmit={continueAsGuest} className="mt-6 space-y-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Continue as guest
        </p>

        {knownEmail ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Shared with{' '}
            <span className="font-medium text-foreground">{knownEmail}</span>
          </p>
        ) : recognised ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="guestEmail">Your email</Label>
            <Input
              id="guestEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              invalid={Boolean(error)}
              aria-describedby="guestEmail-hint"
            />
            <p id="guestEmail-hint" className="text-xs text-muted-foreground">
              Used to recognise you if this document is shared with you again. No
              account or password needed.
            </p>
          </div>
        )}

        {nameFieldShown ? (
          <div className="space-y-1.5">
            <Label htmlFor="displayName">
              Your name{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="displayName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jordan Patel"
              maxLength={60}
              autoComplete="name"
              aria-describedby="displayName-hint"
            />
            <p id="displayName-hint" className="text-xs text-muted-foreground">
              {canComment
                ? 'Shown next to your comments.'
                : 'Identifies you while viewing.'}
            </p>
          </div>
        ) : null}

        <ErrorText>{error}</ErrorText>

        <Button
          type="submit"
          className="w-full"
          loading={pending === 'guest'}
          disabled={pending !== null || (!knownEmail && !recognised && email.trim().length === 0)}
        >
          <UserRound className="size-4" />
          {recognised && !renaming ? `Continue as ${rememberedName}` : 'Continue as guest'}
        </Button>

        {recognised && !renaming ? (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Use a different name
          </button>
        ) : null}
      </form>

      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          or
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {signedInName ? (
        <Button
          variant="outline"
          className="mt-5 w-full"
          onClick={continueWithAccount}
          loading={pending === 'account'}
          disabled={pending !== null}
        >
          <LogIn className="size-4" />
          Sign in as {signedInName}
        </Button>
      ) : (
        <Button asChild variant="outline" className="mt-5 w-full">
          <Link href={`/login?next=${encodeURIComponent(`/s/${token}`)}`}>
            <LogIn className="size-4" />
            Sign in to your account
          </Link>
        </Button>
      )}

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
