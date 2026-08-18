'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Root error boundary.
 *
 * Shows a recoverable message rather than a stack trace — the underlying error
 * is already logged server-side. `reset()` re-renders the segment, which is
 * enough to recover from a transient failure without a full reload.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[app] render error:', error);
  }, [error]);

  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <Card className="max-w-md p-8 text-center">
        <div className="mx-auto w-fit rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="size-6 text-destructive" />
        </div>

        <h1 className="mt-4 text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          An unexpected error interrupted this page. Trying again usually fixes it.
        </p>

        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.assign('/dashboard')}>
            Back to dashboard
          </Button>
        </div>
      </Card>
    </div>
  );
}
