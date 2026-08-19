'use client';

import * as React from 'react';
import { CircleCheck, Files, HardDrive, Layers, Loader2, TriangleAlert } from 'lucide-react';

import { UploadDropzone } from './upload-dropzone';
import { cn, formatBytes } from '@/lib/utils';

export type StatusFilter = 'all' | 'ready' | 'processing' | 'failed';

export type SidebarCounts = Record<StatusFilter, number>;

/** Small caps section label. Repeated enough to be worth naming. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
      {children}
    </p>
  );
}

const STATUS_ROWS = [
  { value: 'ready', label: 'Ready', icon: CircleCheck },
  { value: 'processing', label: 'Processing', icon: Loader2 },
  { value: 'failed', label: 'Needs attention', icon: TriangleAlert },
] as const;

/**
 * Dashboard rail.
 *
 * Holds the two things that were previously competing with the document list
 * for space at the top of the page: the upload control, which is a persistent
 * tool rather than a one-time banner, and the library filters. Moving them here
 * leaves the main column to do one job — show documents.
 *
 * On narrow screens this stacks above the list instead of collapsing behind a
 * toggle. Upload and filters are the primary actions on this page; hiding them
 * behind a tap would be worse than the vertical space it costs.
 */
export function DashboardSidebar({
  filter,
  onFilterChange,
  counts,
  totalPages,
  totalBytes,
  onUploaded,
  className,
}: {
  filter: StatusFilter;
  onFilterChange: (next: StatusFilter) => void;
  counts: SidebarCounts;
  totalPages: number;
  totalBytes: number;
  onUploaded: () => void;
  className?: string;
}) {
  /*
   * Only statuses that actually occur are listed, and the group is dropped
   * entirely when everything shares one status — a column of zeroes reads as
   * filler, and "Ready 1 / All 1" tells the user nothing they cannot see.
   */
  const activeRows = STATUS_ROWS.filter((row) => counts[row.value] > 0);
  const showStatusRows = activeRows.length > 1;

  const rows = [
    { value: 'all' as const, label: 'All documents', icon: Files },
    ...(showStatusRows ? activeRows : []),
  ];

  return (
    <aside className={cn('space-y-5', className)}>
      <UploadDropzone onUploaded={onUploaded} />

      <nav className="space-y-1.5" aria-label="Filter documents by status">
        <Eyebrow>Library</Eyebrow>

        <ul className="space-y-0.5">
          {rows.map(({ value, label, icon: Icon }) => {
            const selected = filter === value;
            return (
              <li key={value}>
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onFilterChange(value)}
                  className={cn(
                    'group relative flex w-full items-center gap-2.5 rounded-md py-2 pl-3 pr-2.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {/* Accent rule marks the selection without shouting. */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                      selected ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      selected ? 'text-primary' : 'text-muted-foreground',
                      value === 'processing' && 'animate-spin',
                    )}
                  />
                  <span className="flex-1 truncate">{label}</span>
                  <span
                    className={cn(
                      'shrink-0 text-xs tabular-nums',
                      selected ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {counts[value]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {counts.all > 0 ? (
        <div className="space-y-1.5">
          <Eyebrow>At a glance</Eyebrow>
          <dl className="rounded-lg border border-border bg-card">
            {[
              {
                icon: Layers,
                label: totalPages === 1 ? 'Page indexed' : 'Pages indexed',
                value: totalPages.toLocaleString(),
              },
              { icon: HardDrive, label: 'Stored', value: formatBytes(totalBytes) },
            ].map(({ icon: Icon, label, value }) => (
              <div
                key={label}
                className="flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <dt className="flex-1 truncate text-xs text-muted-foreground">{label}</dt>
                <dd className="shrink-0 text-xs font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </aside>
  );
}
