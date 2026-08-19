import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Link2Off } from 'lucide-react';

import { resolveShareToken } from '@/server/documents/shares';
import { getGuestForShare } from '@/server/auth/session';
import { getCurrentUser } from '@/server/auth/session';
import { lookupGuestName } from '@/server/auth/guest-identity';
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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { token } = await params;
  const { open } = await searchParams;
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

  // A returning visitor already holds a cookie scoped to this share.
  const guest = await getGuestForShare(share.shareId);
  const user = await getCurrentUser();

  // The owner following their own link belongs in the full owner view, not a
  // guest prompt for a document they already control.
  if (user && user.id === share.ownerId) {
    redirect(`/documents/${share.documentId}`);
  }

  /*
   * The chooser is the default, every time. Only an explicit choice — which is
   * what `?open=1` records — goes straight through. Resuming whichever identity
   * the visitor last used would quietly deny them the other one: someone who
   * read a document as a guest may want to comment under their account today.
   *
   * This is not an access control. Access is the grant cookie checked below and
   * re-checked by every API route; the parameter only decides which screen
   * renders.
   */
  if (open !== '1' || !guest) {
    /*
     * Recognising the visitor saves keystrokes, not choices. Their name comes
     * from a grant this browser already holds, or from the address the link was
     * emailed to. The lookup runs server-side; exposing it as an endpoint would
     * let any link-holder test which addresses exist.
     */
    const rememberedName =
      guest?.displayName ??
      (share.invitedEmail ? await lookupGuestName(share.invitedEmail) : null);

    return (
      <div className="grid min-h-dvh place-items-center px-5 py-10">
        <GuestJoin
          token={token}
          filename={share.filename}
          ownerName={share.ownerName}
          summary={share.summary}
          canComment={share.role === 'commenter'}
          invitedEmail={share.invitedEmail}
          rememberedName={rememberedName}
          hasGuestGrant={Boolean(guest)}
          signedInName={user?.name ?? null}
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
        /*
         * Whoever actually entered. A signed-in visitor who chose to take part
         * as a guest is a guest here — labelling the header with their account
         * name would contradict the name on their own comments.
         */
        viewerName={guest.identityId ? guest.displayName : (user?.name ?? guest.displayName)}
        isOwner={false}
      />
    </div>
  );
}
