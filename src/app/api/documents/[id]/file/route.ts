import { NextResponse } from 'next/server';

import { requireDocumentAccess } from '@/server/auth/access';
import { createSignedDownloadUrl } from '@/server/storage/supabase';
import { handleApiError } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * Serves the PDF bytes to an authorised caller.
 *
 * Authorises first, then redirects to a short-lived signed storage URL. The
 * bucket is private, so there is no route to the object that skips this check.
 *
 * Redirecting rather than proxying the bytes keeps large PDFs off the function's
 * memory and bandwidth budget, and lets the browser's PDF machinery make range
 * requests directly against storage. The cost is a URL that briefly works
 * without a cookie, which is why the TTL is minutes and `Referrer-Policy`
 * prevents it leaking to third parties.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { document } = await requireDocumentAccess(id);

    const signedUrl = await createSignedDownloadUrl(document.storagePath, 300);

    return NextResponse.redirect(signedUrl, {
      status: 307,
      headers: {
        // Never cache the redirect: the target expires and access can be revoked.
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
