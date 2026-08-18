import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getCurrentUser } from '@/server/auth/session';
import { getDocumentAccess } from '@/server/auth/access';
import { DocumentWorkspace } from '@/components/viewer/document-workspace';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const access = await getDocumentAccess(id);

  return { title: access ? access.document.filename : 'Document' };
}

/**
 * Owner-facing document view.
 *
 * Access is re-resolved here rather than trusted from the route segment; an
 * authenticated user requesting someone else's document id gets a 404, the same
 * as a document that does not exist.
 */
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const access = await getDocumentAccess(id);
  if (!access) notFound();

  const doc = access.document;

  /*
   * The workspace fills the viewport minus the app header (h-14 + 1px border).
   * Giving it h-dvh instead made the page 57px taller than the screen, so the
   * bottom of the side panels — including the comment composer — sat below the
   * fold on short laptop screens.
   */
  return (
    <div className="h-[calc(100dvh-3.5rem-1px)]">
      <DocumentWorkspace
        documentId={doc.id}
        filename={doc.filename}
        summary={doc.summary}
        status={doc.status}
        pageCount={doc.pageCount}
        canComment
        viewerName={user.name}
        isOwner={access.kind === 'owner'}
      />
    </div>
  );
}
