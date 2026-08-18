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

type MobileTab = 'document' | 'chat' | 'comments';

/**
 * The document workspace: PDF, summary, chat, and comments.
 *
 * Layout adapts rather than reflows awkwardly:
 *  - Desktop (xl+): PDF beside a fixed sidebar holding chat over comments.
 *  - Tablet (lg):   PDF beside a single sidebar, tabbed between chat/comments.
 *  - Mobile:        one pane at a time via a bottom tab bar, since three panes
 *                   in a phone viewport are unusable.
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
  const [mobileTab, setMobileTab] = React.useState<MobileTab>('document');
  const [sidebarTab, setSidebarTab] = React.useState<'chat' | 'comments'>('chat');
  const [shareOpen, setShareOpen] = React.useState(false);

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
    // On mobile the viewer is hidden behind a tab; switch to it so the jump is
    // actually visible.
    setMobileTab('document');
  }, []);

  const fileUrl = `/api/documents/${documentId}/file`;

  const chat = (
    <ChatPanel documentId={documentId} ready={isReady} onCite={jumpToPage} />
  );
  const comments = (
    <CommentsPanel documentId={documentId} currentPage={currentPage} />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
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

        {/* AI summary — required at the top of the viewer. */}
        {summary ? (
          <div className="border-t border-border bg-muted/40 px-3 py-2.5 sm:px-4">
            <details className="group" open>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="size-3 text-primary" />
                AI summary
                <span className="ml-auto text-[10px] font-normal normal-case opacity-60 group-open:hidden">
                  show
                </span>
              </summary>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {summary}
              </p>
            </details>
          </div>
        ) : status === 'failed' ? (
          <div className="flex items-start gap-2 border-t border-border bg-destructive/10 px-3 py-2.5 text-sm text-destructive sm:px-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>{doc?.error ?? 'This document could not be processed.'}</p>
          </div>
        ) : (
          <div className="border-t border-border bg-muted/40 px-3 py-2.5 sm:px-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Reading the document and writing a summary…
            </p>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* PDF pane */}
        <div
          className={cn(
            'min-w-0 flex-1',
            mobileTab === 'document' ? 'block' : 'hidden lg:block',
          )}
        >
          <PdfViewer
            ref={viewerRef}
            fileUrl={fileUrl}
            filename={filename}
            onPageChange={setCurrentPage}
          />
        </div>

        {/* Desktop sidebar: chat over comments */}
        <aside className="hidden w-[380px] shrink-0 flex-col border-l border-border xl:flex">
          <div className="flex min-h-0 flex-1 flex-col border-b border-border">{chat}</div>
          <div className="flex h-[45%] min-h-0 flex-col">{comments}</div>
        </aside>

        {/* Tablet sidebar: tabbed */}
        <aside className="hidden w-[340px] shrink-0 flex-col border-l border-border lg:flex xl:hidden">
          <div
            role="tablist"
            aria-label="Document panels"
            className="flex shrink-0 border-b border-border"
          >
            {(['chat', 'comments'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={sidebarTab === tab}
                onClick={() => setSidebarTab(tab)}
                className={cn(
                  'flex-1 px-3 py-2 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  sidebarTab === tab
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab === 'chat' ? 'Ask AI' : 'Comments'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">{sidebarTab === 'chat' ? chat : comments}</div>
        </aside>

        {/* Mobile panes */}
        <div className={cn('min-w-0 flex-1 lg:hidden', mobileTab === 'chat' ? 'block' : 'hidden')}>
          {chat}
        </div>
        <div
          className={cn(
            'min-w-0 flex-1 lg:hidden',
            mobileTab === 'comments' ? 'block' : 'hidden',
          )}
        >
          {comments}
        </div>
      </div>

      {/* Mobile tab bar */}
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
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMobileTab(id)}
            aria-current={mobileTab === id}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              mobileTab === id ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
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
