'use client';

import * as React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  FileText,
  Loader2,
  MoreVertical,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge, Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiFetch } from '@/lib/fetcher';
import { formatBytes } from '@/lib/utils';
import type { DocumentListItem } from '@/server/documents/queries';

type CardDocument = Omit<DocumentListItem, 'createdAt'> & { createdAt: string };

/** Status chip mirroring the document's processing state. */
function StatusBadge({ status }: { status: CardDocument['status'] }) {
  switch (status) {
    case 'ready':
      return null;
    case 'processing':
    case 'uploading':
      return (
        <Badge variant="warning">
          <Loader2 className="size-3 animate-spin" />
          {status === 'uploading' ? 'Uploading' : 'Processing'}
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive">
          <AlertTriangle className="size-3" />
          Failed
        </Badge>
      );
  }
}

export function DocumentCard({
  document,
  onChanged,
}: {
  document: CardDocument;
  onChanged: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  const isReady = document.status === 'ready';
  const isPending = document.status === 'processing' || document.status === 'uploading';

  async function remove() {
    setBusy(true);
    try {
      await apiFetch(`/api/documents/${document.id}`, { method: 'DELETE' });
      toast.success('Document deleted');
      setConfirmOpen(false);
      onChanged();
    } catch (error) {
      toast.error('Could not delete', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    setMenuOpen(false);
    toast.info('Reprocessing document…');
    try {
      await apiFetch(`/api/documents/${document.id}/ingest`, { method: 'POST' });
      toast.success('Document ready');
    } catch (error) {
      toast.error('Processing failed again', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  const body = (
    <>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 rounded-lg bg-primary/10 p-2 ring-1 ring-inset ring-primary/15">
          <FileText className="size-4 text-primary" />
        </div>

        <div className="min-w-0 flex-1">
          <h3
            className="truncate text-[15px] font-semibold leading-snug tracking-tight"
            title={document.filename}
          >
            {document.filename}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <time dateTime={document.createdAt}>
              {formatDistanceToNow(new Date(document.createdAt), { addSuffix: true })}
            </time>
            {document.pageCount ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {document.pageCount} page{document.pageCount === 1 ? '' : 's'}
                </span>
              </>
            ) : null}
            {document.byteSize ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatBytes(document.byteSize)}</span>
              </>
            ) : null}
          </p>
        </div>

        <StatusBadge status={document.status} />
      </div>

      <div className="mt-3 min-h-[3.5rem]">
        {isReady && document.summary ? (
          <div className="space-y-1 border-l-2 border-primary/30 pl-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              AI summary
            </p>
            <p className="line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
              {document.summary}
            </p>
          </div>
        ) : isPending ? (
          <div className="space-y-2 pt-1">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-7/12" />
          </div>
        ) : document.status === 'failed' ? (
          <p className="text-sm leading-relaxed text-destructive">
            {document.error ?? 'This document could not be processed.'}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <>
      <Card className="group relative flex flex-col p-4 transition-colors hover:border-primary/40 hover:shadow-md">
        {isReady ? (
          <Link
            href={`/documents/${document.id}`}
            className="flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {body}
            <span className="sr-only">Open {document.filename}</span>
          </Link>
        ) : (
          <div className="flex-1">{body}</div>
        )}

        {/* Action menu, kept outside the Link so it is independently clickable. */}
        <div className="absolute right-2 top-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMenuOpen((o) => !o)}
            onBlur={() => window.setTimeout(() => setMenuOpen(false), 150)}
            aria-label={`Actions for ${document.filename}`}
            aria-expanded={menuOpen}
            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[open=true]:opacity-100"
            data-open={menuOpen}
          >
            <MoreVertical className="size-4" />
          </Button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg"
            >
              {document.status === 'failed' ? (
                <button
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={retry}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className="size-3.5" />
                  Try again
                </button>
              ) : null}
              <button
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" />
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this document?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{document.filename}</span>{' '}
              and everything attached to it — comments, chat history, and any share
              links — will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} loading={busy}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
