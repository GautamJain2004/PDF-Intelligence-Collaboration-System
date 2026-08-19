'use client';

import * as React from 'react';
import useSWR from 'swr';
import { Check, Copy, Link2, Loader2, Mail, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/misc';
import { apiFetch, swrFetcher, RequestError } from '@/lib/fetcher';
import { cn } from '@/lib/utils';

type Share = {
  id: string;
  url: string | null;
  invitedEmail: string | null;
  role: 'viewer' | 'commenter';
  createdAt: string;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  isExpired: boolean;
};

/** Copy button that confirms inline rather than via a toast. */
function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API needs a secure context; tell the user rather than failing
      // silently.
      toast.error('Copy failed — select the link and copy it manually.');
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className={cn('shrink-0', className)}
      aria-label="Copy share link"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * Share management.
 *
 * Creates links, optionally emails an invitee, lists existing links, and
 * revokes them. Existing links can be re-copied because share tokens are stored
 * encrypted rather than hashed-only — see server/auth/crypto.ts for why that
 * trade-off is safe.
 */
export function ShareDialog({
  documentId,
  filename,
  open,
  onOpenChange,
}: {
  documentId: string;
  filename: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<'viewer' | 'commenter'>('commenter');
  const [creating, setCreating] = React.useState(false);
  /** Explanation shown inline when a notification email could not be delivered. */
  const [emailNotice, setEmailNotice] = React.useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR<{ shares: Share[] }>(
    open ? `/api/documents/${documentId}/shares` : null,
    swrFetcher,
  );

  // At most one link is live at a time; the server revokes the rest.
  const active = data?.shares?.[0] ?? null;

  async function createShare(withEmail: boolean) {
    setCreating(true);
    setEmailNotice(null);

    try {
      const result = await apiFetch<{
        share: { url: string; expiresAt: string };
        replaced: number;
        emailDelivered: boolean | null;
        emailMessage: string | null;
      }>(`/api/documents/${documentId}/shares`, {
        method: 'POST',
        json: {
          ...(withEmail && email.trim() ? { email: email.trim() } : {}),
          role,
        },
      });

      setEmailNotice(result.emailMessage ?? null);
      await mutate();

      if (withEmail && email.trim()) {
        if (result.emailDelivered) {
          toast.success(`Invitation sent to ${email.trim()}`);
        } else {
          // Honest about what happened, and specific about why — the reason
          // comes from the provider and is usually fixable.
          toast.warning('Link created, but the email was not delivered', {
            description: result.emailMessage ?? 'Copy the link below and send it yourself.',
            duration: 10_000,
          });
        }
        setEmail('');
      } else {
        toast.success('Share link created', {
          description:
            result.replaced > 0
              ? 'Valid for 1 hour. The previous link has been revoked.'
              : 'Valid for 1 hour.',
        });
      }
    } catch (error) {
      toast.error('Could not create share link', {
        description: error instanceof RequestError ? error.message : undefined,
      });
    } finally {
      setCreating(false);
    }
  }

  async function revoke(shareId: string) {
    try {
      await apiFetch(`/api/documents/${documentId}/shares/${shareId}`, {
        method: 'DELETE',
      });
      await mutate();
      toast.success('Link revoked', {
        description: 'Anyone using it loses access immediately.',
      });
    } catch (error) {
      toast.error('Could not revoke link', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Share document</DialogTitle>
          <DialogDescription>
            Anyone with the link can open{' '}
            <span className="font-medium text-foreground">{filename}</span> without
            creating an account. Links are valid for{' '}
            <span className="font-medium text-foreground">1 hour</span>, and creating a
            new one revokes the previous link.
          </DialogDescription>
        </DialogHeader>

        {/* Permission */}
        <div className="space-y-1.5">
          <Label>Permission</Label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: 'commenter', label: 'Can comment', hint: 'Read, ask AI, comment' },
                { value: 'viewer', label: 'Read only', hint: 'Read and ask AI' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRole(option.value)}
                aria-pressed={role === option.value}
                className={cn(
                  'rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  role === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <p className="text-xs font-medium">{option.label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{option.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Email invite */}
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Invite by email (optional)</Label>
          <div className="flex gap-2">
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              disabled={creating}
            />
            <Button
              onClick={() => createShare(true)}
              disabled={creating || !email.trim()}
              loading={creating && Boolean(email.trim())}
              className="shrink-0"
            >
              <Mail className="size-4" />
              Send
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            or
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          variant="outline"
          onClick={() => createShare(false)}
          loading={creating && !email.trim()}
          className="w-full"
        >
          <Link2 className="size-4" />
          Create a link to copy
        </Button>

        {/*
          * Only the delivery problem gets its own block. The link itself lives
          * in "Active link" below — with one link per document, repeating the
          * URL in a second box was the same value twice.
          */}
        {emailNotice ? (
          <div className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-3">
            <p className="text-xs font-medium">Link created — email not delivered</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {emailNotice}
            </p>
          </div>
        ) : null}

        {/* The single live link. Creating another revokes this one. */}
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Active link</p>

          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : active ? (
            <div className="min-w-0 space-y-2 rounded-md border border-border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-xs font-medium">
                      {active.invitedEmail ?? 'Anyone with the link'}
                    </span>
                    <Badge
                      variant={active.role === 'commenter' ? 'default' : 'outline'}
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {active.role === 'commenter' ? 'Can comment' : 'Read only'}
                    </Badge>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    {active.expiresAt
                      ? `Expires ${formatDistanceToNow(new Date(active.expiresAt), {
                          addSuffix: true,
                        })}`
                      : 'Does not expire'}
                    {active.lastAccessedAt
                      ? ` · opened ${formatDistanceToNow(new Date(active.lastAccessedAt), {
                          addSuffix: true,
                        })}`
                      : ' · never opened'}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => revoke(active.id)}
                  aria-label="Revoke this link"
                  title="Revoke"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              {active.url ? (
                <div className="flex min-w-0 items-center gap-2">
                  {/* break-all: an unbreakable token would otherwise widen the dialog. */}
                  <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {active.url}
                  </code>
                  <CopyButton value={active.url} />
                </div>
              ) : (
                <p className="text-[10px] text-warning">
                  Link cannot be shown — create a new one.
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
              No active link. Create one above.
            </p>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
