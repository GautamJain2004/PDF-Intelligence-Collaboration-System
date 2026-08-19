'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Builds the page numbers to show, collapsing long runs with gaps.
 *
 * Always includes the first and last page plus a window around the current one,
 * so the pager keeps a stable width instead of growing without bound. `null`
 * marks an elided run.
 */
function pageItems(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const window = new Set([1, total, current, current - 1, current + 1]);
  // Keep the bar a constant width near the ends, where the window is clipped.
  if (current <= 3) [2, 3, 4].forEach((n) => window.add(n));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => window.add(n));

  const pages = [...window].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);

  const items: Array<number | null> = [];
  let previous = 0;
  for (const page of pages) {
    if (page - previous > 1) items.push(null);
    items.push(page);
    previous = page;
  }
  return items;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  // A single page needs no controls; rendering a dead pager is just noise.
  if (pageCount <= 1) return null;

  const go = (next: number) => onPageChange(Math.min(Math.max(next, 1), pageCount));

  return (
    <nav
      aria-label="Document pages"
      className={cn('flex items-center justify-center gap-1', className)}
    >
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page === 1}
        aria-label="Previous page"
        className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" />
      </button>

      {pageItems(page, pageCount).map((item, index) =>
        item === null ? (
          <span
            key={`gap-${index}`}
            aria-hidden
            className="grid size-8 place-items-center text-xs text-muted-foreground"
          >
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => go(item)}
            aria-label={`Page ${item}`}
            aria-current={item === page ? 'page' : undefined}
            className={cn(
              'grid size-8 place-items-center rounded-md border text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              item === page
                ? 'border-primary bg-primary text-primary-foreground font-medium'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page === pageCount}
        aria-label="Next page"
        className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}
