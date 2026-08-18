'use client';

import * as React from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn, formatBytes } from '@/lib/utils';
import { apiFetch, RequestError } from '@/lib/fetcher';
import { MAX_UPLOAD_BYTES } from '@/lib/validation';

type UploadStage = 'idle' | 'signing' | 'uploading' | 'processing';

type SignResponse = {
  documentId: string;
  uploadUrl: string;
  filename: string;
  contentType: string;
};

/**
 * Upload control.
 *
 * Three-step flow: ask the server for a signed URL, PUT the bytes straight to
 * storage, then ask the server to process the file. Going direct to storage
 * keeps large PDFs out of the serverless request body limit.
 *
 * Client-side checks here are purely for fast feedback — the server
 * independently validates the real bytes, so a user bypassing this UI gains
 * nothing.
 */
export function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [stage, setStage] = React.useState<UploadStage>('idle');
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [current, setCurrent] = React.useState<{ name: string; size: number } | null>(null);

  const busy = stage !== 'idle';

  function validate(file: File): string | null {
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) return 'Only PDF files can be uploaded.';
    if (file.size === 0) return 'That file is empty.';
    if (file.size > MAX_UPLOAD_BYTES) {
      return `PDFs must be ${formatBytes(MAX_UPLOAD_BYTES)} or smaller. This one is ${formatBytes(file.size)}.`;
    }
    return null;
  }

  /**
   * XHR rather than fetch: upload progress requires `upload.onprogress`, which
   * the fetch API still cannot report.
   */
  function putWithProgress(url: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('content-type', 'application/pdf');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.onabort = () => reject(new Error('Upload cancelled.'));

      xhr.send(file);
    });
  }

  async function handleFile(file: File) {
    const problem = validate(file);
    if (problem) {
      toast.error(problem);
      return;
    }

    setCurrent({ name: file.name, size: file.size });
    setProgress(0);

    try {
      setStage('signing');
      const signed = await apiFetch<SignResponse>('/api/uploads/sign', {
        method: 'POST',
        json: {
          filename: file.name,
          size: file.size,
          contentType: 'application/pdf',
        },
      });

      setStage('uploading');
      await putWithProgress(signed.uploadUrl, file);

      // Show the card immediately in its processing state.
      setStage('processing');
      onUploaded();

      const result = await apiFetch<{ notice?: string | null }>(
        `/api/documents/${signed.documentId}/ingest`,
        { method: 'POST' },
      );

      toast.success('Document ready', {
        description: result?.notice ?? 'Summary and chat are available now.',
      });
    } catch (error) {
      if (error instanceof RequestError) {
        // 422 means ingest rejected the file with an explanation worth showing.
        toast.error(
          error.status === 422 ? 'Could not process this PDF' : 'Upload failed',
          { description: error.message },
        );
      } else {
        toast.error('Upload failed', {
          description: error instanceof Error ? error.message : 'Please try again.',
        });
      }
    } finally {
      setStage('idle');
      setCurrent(null);
      setProgress(0);
      onUploaded();
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;

    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  const stageLabel: Record<Exclude<UploadStage, 'idle'>, string> = {
    signing: 'Preparing upload…',
    uploading: `Uploading… ${progress}%`,
    processing: 'Reading, summarising, and indexing…',
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'rounded-lg border-2 border-dashed bg-card p-6 transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-border',
        busy && 'pointer-events-none opacity-90',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
        disabled={busy}
      />

      {busy && current ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{current.name}</p>
              <p className="text-xs text-muted-foreground">
                {stageLabel[stage as Exclude<UploadStage, 'idle'>]}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatBytes(current.size)}
            </span>
          </div>

          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={stage === 'uploading' ? progress : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
          >
            <div
              className={cn(
                'h-full rounded-full bg-primary transition-all duration-300',
                stage === 'processing' && 'animate-pulse',
              )}
              style={{ width: stage === 'uploading' ? `${progress}%` : '100%' }}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <div className="rounded-full bg-primary/10 p-2.5">
            <Upload className="size-5 text-primary" />
          </div>

          <div className="flex-1 space-y-0.5">
            <p className="text-sm font-medium">Upload a PDF</p>
            <p className="text-xs text-muted-foreground">
              Drag and drop, or browse. Up to {formatBytes(MAX_UPLOAD_BYTES)}.
            </p>
          </div>

          <Button onClick={() => inputRef.current?.click()} className="w-full sm:w-auto">
            Choose file
          </Button>
        </div>
      )}
    </div>
  );
}
