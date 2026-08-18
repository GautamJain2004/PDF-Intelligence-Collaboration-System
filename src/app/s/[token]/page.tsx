import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, Link2Off } from 'lucide-react';

import { resolveShareToken } from '@/server/documents/shares';
import { getGuestForShare } from '@/server/auth/session';
import { getCurrentUser } from '@/server/auth/session';
import { GuestJoin } from '@/components/share/guest-join';
import { DocumentWorkspace } from '@/components/viewer/document-workspace';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Shared document',
  // A share link is a capability; it must never end up in a search index.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Share link entry point.
 *
 * Resolves the token server-side, then either shows the name prompt (first
 * visit) or the full workspace (returning visitor with a valid guest cookie).
 * The token itself never reaches client-side code beyond the join form.
 */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await resolveShareToken(token);

  if (!share) {
    return (
      <div className="grid min-h-dvh place-items-center px-5">
        <Card className="max-w-md p-8 text-center">
          <div className="mx-auto w-fit rounded-full bg-destructive/10 p-3">
            <Link2Off className="size-6 text-destructive" />
          </div>
          <h1 className="mt-4 text-lg font-semibold">This link no longer works</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            It may have been revoked by its owner, expired, or been copied
            incorrectly. Ask whoever shared it with you for a new link.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/">Go to PDF Intelligence</Link>
          </Button>
        </Card>
      </div>
    );
  }

  // A returning guest already holds a cookie scoped to this share.
  const guest = await getGuestForShare(share.shareId);
  const user = await getCurrentUser();

  if (!guest) {
    return (
      <div className="grid min-h-dvh place-items-center px-5 py-10">
        <GuestJoin
          token={token}
          filename={share.filename}
          ownerName={share.ownerName}
          summary={share.summary}
          canComment={share.role === 'commenter'}
          // An owner opening their own link skips the prompt entirely.
          suggestedName={user?.name ?? ''}
        />
      </div>
    );
  }

  // No app header on the share route, so the workspace gets the full viewport.
  return (
    <div className="h-dvh">
      <DocumentWorkspace
        documentId={share.documentId}
        filename={share.filename}
        canComment={share.role === 'commenter'}
        viewerName={guest.displayName}
        isOwner={false}
      />
    </div>
  );
}
