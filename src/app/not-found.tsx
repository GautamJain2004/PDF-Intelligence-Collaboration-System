import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * 404 page.
 *
 * Also what an unauthorised user sees for a document they cannot access —
 * denial is deliberately indistinguishable from non-existence, so the copy
 * covers both without hinting which applies.
 */
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <Card className="max-w-md p-8 text-center">
        <div className="mx-auto w-fit rounded-full bg-muted p-3">
          <FileQuestion className="size-6 text-muted-foreground" />
        </div>

        <h1 className="mt-4 text-lg font-semibold">Not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This page doesn&apos;t exist, or you don&apos;t have access to it.
        </p>

        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </Card>
    </div>
  );
}
