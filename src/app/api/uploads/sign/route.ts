import { db } from '@/server/db/client';
import { documents } from '@/server/db/schema';
import { getCurrentUser } from '@/server/auth/session';
import { buildStoragePath, createSignedUpload } from '@/server/storage/supabase';
import { sanitizeFilename } from '@/server/pdf/validate';
import { signUploadSchema } from '@/lib/validation';
import { handleApiError, json, parseJson, rateLimited, unauthorized } from '@/lib/api';
import { LIMITS, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Issues a scoped, single-use upload URL and reserves the document row.
 *
 * Uploading direct to storage rather than proxying bytes through this function
 * avoids Vercel's ~4.5 MB request body limit, which real PDFs routinely exceed.
 *
 * The checks here are cheap pre-filters on client-declared metadata. They are
 * NOT the security boundary — the bytes themselves are validated after upload
 * in the ingest pipeline, which is the only place the file's true nature is
 * knowable.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthorized();

    const limit = rateLimit(`upload:${user.id}`, LIMITS.upload);
    if (!limit.ok) throw rateLimited('Upload limit reached. Please try again later.');

    const { filename, size, contentType } = await parseJson(request, signUploadSchema);

    const safeName = sanitizeFilename(filename);
    // Storage key is generated server-side and never derived from user input,
    // which removes path traversal and collisions by construction.
    const storagePath = buildStoragePath(user.id);

    const [document] = await db
      .insert(documents)
      .values({
        ownerId: user.id,
        filename: safeName,
        storagePath,
        byteSize: size,
        status: 'uploading',
      })
      .returning({ id: documents.id });

    const upload = await createSignedUpload(storagePath);

    return json(
      {
        documentId: document.id,
        uploadUrl: upload.signedUrl,
        filename: safeName,
        contentType,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
