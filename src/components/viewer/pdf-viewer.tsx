'use client';

import * as React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

/*
 * react-pdf's own layer stylesheets.
 *
 * The text layer must sit invisibly over the canvas for selection and in-page
 * search to work. react-pdf detects whether these are loaded and warns on every
 * page render if they are not, so use the official files rather than
 * reimplementing them — hand-rolled equivalents drift from the library's markup.
 */
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * pdf.js worker.
 *
 * Served as a static file from `public/`, copied there from node_modules by
 * `scripts/copy-pdf-worker.mjs` (wired to the predev/prebuild npm hooks).
 *
 * Deliberately not `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`:
 * that depends on webpack's asset-module handling, which hands back a non-string
 * here and throws "url.replace is not a function" at runtime. A plain absolute
 * path removes the bundler from the equation and behaves the same in dev and
 * production.
 *
 * Self-hosted rather than CDN-loaded, so the app has no external runtime
 * dependency and stays compatible with a strict CSP.
 */
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.2;

export type PdfViewerHandle = {
  /** Scrolls to a page; used by chat citation chips. */
  goToPage: (page: number) => void;
};

/**
 * Continuous-scroll PDF viewer.
 *
 * All pages render in one scrollable column rather than one page at a time, so
 * citation jumps land in context and reading feels like a normal document.
 * Width is measured and pages scale to fit, which is what makes this usable on
 * a phone.
 */
export const PdfViewer = React.forwardRef<
  PdfViewerHandle,
  { fileUrl: string; filename: string; onPageChange?: (page: number) => void }
>(function PdfViewer({ fileUrl, filename, onPageChange }, ref) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const pageRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());

  const [numPages, setNumPages] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [scale, setScale] = React.useState(1);
  const [width, setWidth] = React.useState<number>(0);
  const [error, setError] = React.useState<string | null>(null);
  const [pageInput, setPageInput] = React.useState('1');

  // Measure the container so pages can be rendered at a fitting width.
  React.useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scrollToPage = React.useCallback((page: number) => {
    const target = pageRefs.current.get(page);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentPage(page);
    setPageInput(String(page));
  }, []);

  React.useImperativeHandle(ref, () => ({ goToPage: scrollToPage }), [scrollToPage]);

  /*
   * Track the visible page with an IntersectionObserver rather than scroll
   * maths — it stays correct regardless of zoom, variable page heights, or
   * momentum scrolling.
   */
  React.useEffect(() => {
    if (numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const page = Number((visible.target as HTMLElement).dataset.page);
          if (page) {
            setCurrentPage(page);
            setPageInput(String(page));
            onPageChange?.(page);
          }
        }
      },
      { root: containerRef.current, threshold: [0.1, 0.5] },
    );

    for (const element of pageRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [numPages, onPageChange]);

  const pageWidth = width > 0 ? Math.min(width - 32, 900) * scale : undefined;

  function commitPageInput() {
    const parsed = Number(pageInput);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= numPages) {
      scrollToPage(parsed);
    } else {
      setPageInput(String(currentPage));
    }
  }

  return (
    <div className="flex h-full flex-col bg-muted/40">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2 py-1.5 sm:gap-2 sm:px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onBlur={commitPageInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPageInput();
              }
            }}
            className="h-7 w-11 px-1 text-center text-xs"
            aria-label="Page number"
            inputMode="numeric"
          />
          <span className="whitespace-nowrap">/ {numPages || '–'}</span>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
          disabled={currentPage >= numPages}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
          >
            <ZoomOut className="size-4" />
          </Button>

          <button
            onClick={() => setScale(1)}
            className="hidden min-w-[3rem] rounded px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
            aria-label="Reset zoom to 100%"
          >
            {Math.round(scale * 100)}%
          </button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
          >
            <ZoomIn className="size-4" />
          </Button>

          <Button variant="ghost" size="icon-sm" asChild aria-label="Download PDF">
            {/* Same authorised endpoint the viewer reads from. */}
            <a href={fileUrl} download={filename}>
              <Download className="size-4" />
            </a>
          </Button>
        </div>
      </div>

      {/* Pages */}
      <div ref={containerRef} className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="mx-auto max-w-sm rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-center text-sm text-destructive">
            {error}
          </div>
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages: total }) => {
              setNumPages(total);
              setError(null);
            }}
            onLoadError={(err) => {
              console.error('[pdf] load failed:', err);
              setError(
                'This PDF could not be displayed. It may have expired — try reloading the page.',
              );
            }}
            loading={
              <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading document…
              </div>
            }
            className="flex flex-col items-center gap-4"
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
              <div
                key={page}
                data-page={page}
                ref={(element) => {
                  if (element) pageRefs.current.set(page, element);
                  else pageRefs.current.delete(page);
                }}
                className={cn(
                  'relative overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-border',
                  'scroll-mt-4',
                )}
              >
                <Page
                  pageNumber={page}
                  width={pageWidth}
                  renderAnnotationLayer={false}
                  loading={
                    <div
                      className="shimmer bg-muted"
                      style={{ width: pageWidth ?? 600, height: (pageWidth ?? 600) * 1.4 }}
                    />
                  }
                />
                <span className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {page}
                </span>
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
});
