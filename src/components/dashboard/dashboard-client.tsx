'use client';

import * as React from 'react';
import useSWR from 'swr';
import { FileText, Search, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { UploadDropzone } from './upload-dropzone';
import { DocumentCard } from './document-card';
import { swrFetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';
import type { DocumentListItem } from '@/server/documents/queries';

type ListResponse = {
  documents: Array<Omit<DocumentListItem, 'createdAt'> & { createdAt: string }>;
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

  // Semantic search costs an API call, so it waits longer before firing.
  const debouncedQuery = useDebounced(query, mode === 'semantic' ? 500 : 220);

  const params = new URLSearchParams();
  if (debouncedQuery) {
    params.set('q', debouncedQuery);
    params.set('mode', mode);
  }
  const key = `/api/documents${params.toString() ? `?${params}` : ''}`;

  const { data, isLoading, mutate } = useSWR<ListResponse>(key, swrFetcher, {
    fallbackData: !debouncedQuery ? initial : undefined,
    keepPreviousData: true,
  });

  const documents = data?.documents ?? [];

  /*
   * Poll while anything is still processing so cards flip to "ready" on their
   * own. Polling stops as soon as nothing is pending, so an idle dashboard
   * makes no background requests.
   */
  const hasPending = documents.some(
    (d) => d.status === 'processing' || d.status === 'uploading',
  );

  React.useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => void mutate(), 2500);
    return () => clearInterval(timer);
  }, [hasPending, mutate]);

  const refresh = React.useCallback(() => void mutate(), [mutate]);
  const searching = Boolean(debouncedQuery);

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your documents</h1>
        <p className="text-sm text-muted-foreground">
          Upload a PDF to get a summary, ask questions about it, and share it for comment.
        </p>
      </div>

      <UploadDropzone onUploaded={refresh} />

      {/* Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              description="Upload your first PDF above. It will be summarised and indexed automatically, usually within a minute."
            />
          )}
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {documents.length} document{documents.length === 1 ? '' : 's'}
            {searching && data?.mode === 'semantic' ? ' matched by meaning' : null}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((document) => (
              <DocumentCard key={document.id} document={document} onChanged={refresh} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
