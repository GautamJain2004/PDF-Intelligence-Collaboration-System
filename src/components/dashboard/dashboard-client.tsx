'use client';

import * as React from 'react';
import useSWR from 'swr';
import { FileText, Search, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { DashboardSidebar, type StatusFilter } from './dashboard-sidebar';
import { DocumentCard } from './document-card';
import { Pagination } from './pagination';
import { swrFetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';
import type { DocumentListItem } from '@/server/documents/queries';

type LibraryStats = {
  all: number;
  ready: number;
  processing: number;
  failed: number;
  pages: number;
  bytes: number;
};

type ListResponse = {
  documents: Array<Omit<DocumentListItem, 'createdAt'> & { createdAt: string }>;
  /** Matches across every page, not just the rows returned. */
  total: number;
  page: number;
  pageSize: number;
  /** Library-wide, so the rail is unaffected by paging or filtering. */
  stats: LibraryStats;
  mode?: 'filename' | 'semantic';
  notice?: string;
};

type SearchMode = 'filename' | 'semantic';

/** Debounce so typing does not fire a request (and an embedding call) per keystroke. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function DashboardClient({ initial }: { initial: ListResponse }) {
  const [query, setQuery] = React.useState('');
  const [mode, setMode] = React.useState<SearchMode>('filename');
  const [filter, setFilter] = React.useState<StatusFilter>('all');
  const [page, setPage] = React.useState(1);

  // Semantic search costs an API call, so it waits longer before firing.
  const debouncedQuery = useDebounced(query, mode === 'semantic' ? 500 : 220);

  /*
   * Any change to what is being asked for invalidates the current position —
   * landing on page 5 of a two-page result set would show an empty grid with no
   * explanation.
   */
  React.useEffect(() => {
    setPage(1);
  }, [debouncedQuery, mode, filter]);

  const params = new URLSearchParams();
  if (debouncedQuery) {
    params.set('q', debouncedQuery);
    params.set('mode', mode);
  }
  if (filter !== 'all') params.set('status', filter);
  if (page > 1) params.set('page', String(page));
  const key = `/api/documents${params.toString() ? `?${params}` : ''}`;

  const { data, isLoading, isValidating, mutate } = useSWR<ListResponse>(key, swrFetcher, {
    // Only the first unfiltered page matches what the server rendered.
    fallbackData:
      !debouncedQuery && filter === 'all' && page === 1 ? initial : undefined,
    keepPreviousData: true,
  });

  // The server has already filtered and paged; the client just renders.
  const documents = React.useMemo(() => data?.documents ?? [], [data]);
  const stats = data?.stats ?? initial.stats;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? initial.pageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  /*
   * `keepPreviousData` leaves the old rows on screen while the next page loads,
   * which avoids a flash of empty grid but briefly disagrees with the range
   * above it. The response says which page it describes, so a mismatch is an
   * exact signal that what is rendered is not what was asked for.
   */
  const changingPage = isValidating && data !== undefined && data.page !== page;

  /*
   * Poll while anything is still processing so cards flip to "ready" on their
   * own. Polling stops as soon as nothing is pending, so an idle dashboard
   * makes no background requests.
   */
  // Library-wide, so a document processing on page 3 still drives the poll.
  const hasPending = stats.processing > 0;

  React.useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => void mutate(), 2500);
    return () => clearInterval(timer);
  }, [hasPending, mutate]);

  const counts = React.useMemo(
    () => ({
      all: stats.all,
      ready: stats.ready,
      processing: stats.processing,
      failed: stats.failed,
    }),
    [stats],
  );

  /*
   * A filter whose documents have all moved on — the last failure retried, the
   * last upload finished — would otherwise strand the user on a permanently
   * empty list with no clue why.
   */
  React.useEffect(() => {
    if (filter !== 'all' && counts[filter] === 0) setFilter('all');
  }, [filter, counts]);

  const refresh = React.useCallback(() => void mutate(), [mutate]);
  const searching = Boolean(debouncedQuery);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start lg:gap-8 lg:px-6 lg:py-8">
      {/* Sticks below the 3.5rem header once the two-column layout kicks in. */}
      <DashboardSidebar
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        totalPages={stats.pages}
        totalBytes={stats.bytes}
        onUploaded={refresh}
        className="lg:sticky lg:top-[4.5rem] lg:w-64 lg:shrink-0 xl:w-72"
      />

      <main className="min-w-0 flex-1 space-y-5">
        <header className="space-y-1">
          <h1 className="text-[1.375rem] font-semibold leading-tight tracking-tight">
            Your documents
          </h1>
          <p className="text-sm text-muted-foreground">
            Every PDF you upload is summarised and indexed, so you can ask it questions
            and share it for comment.
          </p>
        </header>

        {/* Search */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === 'semantic'
                  ? 'Describe what the document is about…'
                  : 'Search by filename…'
              }
              className="pl-9 pr-9"
              aria-label={mode === 'semantic' ? 'Semantic search' : 'Filename search'}
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          {/* Mode switch */}
          <div
            role="radiogroup"
            aria-label="Search mode"
            className="flex shrink-0 rounded-md border border-border bg-card p-0.5"
          >
            {(
              [
                { value: 'filename', label: 'Filename', icon: FileText },
                { value: 'semantic', label: 'Meaning', icon: Sparkles },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  mode === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === 'semantic' && !query ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            Semantic search matches on what a document is about — try “employment terms”
            or “refund policy” rather than a filename.
          </p>
        ) : null}

        {data?.notice ? (
          <p className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-foreground">
            {data.notice}
          </p>
        ) : null}

        {/* Results */}
        {isLoading && documents.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="space-y-3 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <div className="space-y-2 pt-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-10/12" />
                </div>
              </Card>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <Card>
            {searching ? (
              <EmptyState
                icon={Search}
                title="No documents match that search"
                description={
                  mode === 'filename'
                    ? 'Try a different filename, or switch to “Meaning” to search by what the documents are about.'
                    : 'Try describing the content differently. Only processed documents can be searched by meaning.'
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="No documents yet"
                description="Upload your first PDF from the panel on the left. It will be summarised and indexed automatically, usually within a minute."
              />
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            <p
              className="text-xs text-muted-foreground"
              aria-live="polite"
              role="status"
            >
              {/*
                * Range, not just a count: on page 3 "12 documents" is a lie.
                * Derived from `total`, never from the rows currently rendered —
                * SWR keeps the previous page on screen while the next loads, and
                * counting those produced "13–24 of 17" mid-transition.
                */}
              {pageCount > 1
                ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
                : `${total} document${total === 1 ? '' : 's'}`}
              {filter !== 'all' ? ' · filtered' : null}
              {searching && data?.mode === 'semantic' ? ' · matched by meaning' : null}
            </p>

            <div
              aria-busy={changingPage}
              className={cn(
                'grid gap-4 transition-opacity sm:grid-cols-2 2xl:grid-cols-3',
                changingPage && 'pointer-events-none opacity-50',
              )}
            >
              {documents.map((document) => (
                <DocumentCard key={document.id} document={document} onChanged={refresh} />
              ))}
            </div>

            <Pagination
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              className="pt-2"
            />
          </div>
        )}
      </main>
    </div>
  );
}
