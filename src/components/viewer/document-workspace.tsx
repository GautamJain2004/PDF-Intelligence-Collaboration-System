'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Loader2,
  MessageSquareText,
  Share2,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { ChatPanel } from './chat-panel';
import { CommentsPanel } from './comments-panel';
import { ShareDialog } from '@/components/share/share-dialog';
import type { PdfViewerHandle } from './pdf-viewer';
import { swrFetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';

/**
 * react-pdf is client-only (it touches DOM APIs at import) and pulls in a large
 * pdf.js bundle, so it is loaded dynamically and kept out of the initial JS.
 */
const PdfViewer = dynamic(() => import('./pdf-viewer').then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Loading viewer…
    </div>
  ),
});

type DocumentResponse = {
  document: {
    id: string;
    filename: string;
    status: 'uploading' | 'processing' | 'ready' | 'failed';
    summary: string | null;
    error: string | null;
    pageCount: number | null;
  };
};

/** Below `lg`, exactly one of the PDF or the side panels is on screen. */
type MobilePane = 'document' | 'panels';

/** The side panel shows one of these at a time, at every breakpoint. */
type SidePanel = 'chat' | 'comments';

/**
 * The document workspace: PDF, summary, chat, and comments.
 *
 * Layout:
 *  - `lg` and up: PDF beside a fixed-width sidebar, tabbed between chat and
 *    comments so each gets the full column height.
 *  - Below `lg`: one pane at a time via a bottom tab bar, since three panes in
 *    a phone viewport are unusable.
 *
 * Chat and comments were originally stacked together at `xl`. On a typical
 * laptop (~850px tall) that left roughly 100px for the comment list once the
 * panel header and composer were subtracted, so comment bodies were scrolled
 * out of view and the chat's empty state was clipped. Tabbing gives each panel
 * the whole column instead of splitting a height neither could use.
 *
 * Shared by the owner route and the guest share route; `isOwner` only controls
 * the share button and the back link.
 */
export function DocumentWorkspace({
  documentId,
  filename,
  summary: initialSummary,
  status: initialStatus,
  pageCount,
  canComment,
  viewerName,
  isOwner,
}: {
  documentId: string;
  filename: string;
  summary?: string | null;
  status?: 'uploading' | 'processing' | 'ready' | 'failed';
  pageCount?: number | null;
  canComment: boolean;
  viewerName: string;
  isOwner: boolean;
}) {
  const viewerRef = React.useRef<PdfViewerHandle>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [mobilePane, setMobilePane] = React.useState<MobilePane>('document');
  const [sidePanel, setSidePanel] = React.useState<SidePanel>('chat');
  const [shareOpen, setShareOpen] = React.useState(false);
  const [summaryExpanded, setSummaryExpanded] = React.useState(false);

  // Poll only while the document is still being processed.
  const { data } = useSWR<DocumentResponse>(
    `/api/documents/${documentId}`,
    swrFetcher,
    {
      refreshInterval: (latest) =>
        latest?.document.status === 'processing' || latest?.document.status === 'uploading'
          ? 2500
          : 0,
      fallbackData: initialStatus
        ? {
            document: {
              id: documentId,
              filename,
              status: initialStatus,
              summary: initialSummary ?? null,
              error: null,
              pageCount: pageCount ?? null,
            },
          }
        : undefined,
    },
  );

  const doc = data?.document;
  const status = doc?.status ?? initialStatus ?? 'processing';
  const summary = doc?.summary ?? initialSummary ?? null;
  const isReady = status === 'ready';

  const jumpToPage = React.useCallback((page: number) => {
    viewerRef.current?.goToPage(page);
    // Below `lg` the viewer is behind a tab; switch to it so the jump is visible.
    setMobilePane('document');
  }, []);

  const fileUrl = `/api/documents/${documentId}/file`;

  const chat = (
    <ChatPanel documentId={documentId} ready={isReady} onCite={jumpToPage} />
  );
  const comments = (
    <CommentsPanel documentId={documentId} currentPage={currentPage} />
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
          {isOwner ? (
            <Button variant="ghost" size="icon-sm" asChild aria-label="Back to dashboard">
              <Link href="/dashboard">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <FileText className="size-4" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold" title={filename}>
              {filename}
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {isOwner ? 'You own this document' : `Viewing as ${viewerName}`}
              {doc?.pageCount ? ` · ${doc.pageCount} pages` : ''}
            </p>
          </div>

          {status === 'processing' || status === 'uploading' ? (
            <Badge variant="warning">
              <Loader2 className="size-3 animate-spin" />
              <span className="hidden sm:inline">Processing</span>
            </Badge>
          ) : null}

          {isOwner ? (
            <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
              <Share2 className="size-4" />
              <span className="hidden sm:inline">Share</span>
            </Button>
          ) : null}
        </div>

        {/*
          AI summary — required at the top of the viewer.

          Clamped to two lines by default. Fully expanded it consumed ~110px of a
          ~660px body, which is space the comment and chat panels need far more.
        */}
        {summary ? (
          <div className="border-t border-border bg-muted/30 px-3 py-2.5 sm:px-4">
            {/*
              Capped at a readable measure. Left unbounded the paragraph
              stretched the full viewport — around 250 characters per line on a
              wide monitor, which the eye cannot track back from — and pushed
              the toggle so far right it read as unrelated to the text.
            */}
            <div className="flex max-w-[92ch] items-baseline gap-x-2.5 gap-y-1">
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                <Sparkles className="size-3 text-primary" />
                <span className="hidden sm:inline">AI summary</span>
              </span>

              <p
                className={cn(
                  'min-w-0 flex-1 text-[13px] leading-[1.6] text-foreground/85',
                  summaryExpanded ? '' : 'line-clamp-2',
                )}
              >
                {summary}
              </p>

              <button
                onClick={() => setSummaryExpanded((v) => !v)}
                className="shrink-0 rounded text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={summaryExpanded}
              >
                {summaryExpanded ? 'Show less' : 'Show more'}
              </button>
            </div>
          </div>
        ) : status === 'failed' ? (
          <div className="flex items-start gap-2 border-t border-border bg-destructive/10 px-3 py-2.5 text-sm text-destructive sm:px-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>{doc?.error ?? 'This document could not be processed.'}</p>
          </div>
        ) : (
          <div className="border-t border-border bg-muted/40 px-3 py-2 sm:px-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Reading the document and writing a summary…
            </p>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* PDF pane — always present from `lg` up, tab-switched below that. */}
        <div
          className={cn(
            'min-w-0 flex-1',
            mobilePane === 'document' ? 'block' : 'hidden lg:block',
          )}
        >
          <PdfViewer
            ref={viewerRef}
            fileUrl={fileUrl}
            filename={filename}
            onPageChange={setCurrentPage}
          />
        </div>

        {/*
          Side panel area. Full-width below `lg`, a fixed column above it.
          Holds the single chat and comments instances; the inactive one is
          hidden rather than unmounted so its state and scroll position survive
          tab switches.
        */}
        <aside
          className={cn(
            'min-h-0 flex-col border-border',
            'lg:flex lg:w-[360px] lg:flex-none lg:border-l xl:w-[400px]',
            mobilePane === 'panels' ? 'flex flex-1' : 'hidden',
          )}
        >
          <div
            role="tablist"
            aria-label="Document panels"
            className="flex shrink-0 border-b border-border"
          >
            {(
              [
                { id: 'chat', label: 'Ask AI', icon: Sparkles },
                { id: 'comments', label: 'Comments', icon: MessageSquareText },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={sidePanel === id}
                onClick={() => setSidePanel(id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  sidePanel === id
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className={cn('min-h-0 flex-1 flex-col', sidePanel === 'chat' ? 'flex' : 'hidden')}>
            {chat}
          </div>
          <div
            className={cn(
              'min-h-0 flex-1 flex-col',
              sidePanel === 'comments' ? 'flex' : 'hidden',
            )}
          >
            {comments}
          </div>
        </aside>
      </div>

      {/* Bottom tab bar, below `lg` only. */}
      <nav
        aria-label="Panels"
        className="grid shrink-0 grid-cols-3 border-t border-border bg-background lg:hidden"
      >
        {(
          [
            { id: 'document', label: 'Document', icon: FileText },
            { id: 'chat', label: 'Ask AI', icon: Sparkles },
            { id: 'comments', label: 'Comments', icon: MessageSquareText },
          ] as const
        ).map(({ id, label, icon: Icon }) => {
          const active =
            id === 'document' ? mobilePane === 'document' : mobilePane === 'panels' && sidePanel === id;

          return (
            <button
              key={id}
              onClick={() => {
                if (id === 'document') {
                  setMobilePane('document');
                } else {
                  setMobilePane('panels');
                  setSidePanel(id);
                }
              }}
              aria-current={active}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </nav>

      {isOwner ? (
        <ShareDialog
          documentId={documentId}
          filename={filename}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
    </div>
  );
}
