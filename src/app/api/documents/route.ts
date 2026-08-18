import { getCurrentUser } from '@/server/auth/session';
import {
  listDocuments,
  searchByFilename,
  searchSemantic,
} from '@/server/documents/queries';
import { searchSchema } from '@/lib/validation';
import { handleApiError, json, rateLimited, unauthorized } from '@/lib/api';
import { LIMITS, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Lists the caller's documents, optionally filtered.
 *
 * `mode=semantic` costs an embedding call per request, so it is rate limited
 * and falls back to filename search if the AI call fails — a degraded search is
 * better than a broken dashboard.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthorized();

    const url = new URL(request.url);
    const parsed = searchSchema.safeParse({
      q: url.searchParams.get('q') ?? '',
      mode: url.searchParams.get('mode') ?? 'filename',
    });

    if (!parsed.success) {
      return json({ documents: await listDocuments(user.id) });
    }

    const { q, mode } = parsed.data;

    if (!q) {
      return json({ documents: await listDocuments(user.id) });
    }

    if (mode === 'semantic') {
      const limit = rateLimit(`search:${user.id}`, LIMITS.search);
      if (!limit.ok) throw rateLimited('Search limit reached. Please wait a moment.');

      try {
        return json({ documents: await searchSemantic(user.id, q), mode: 'semantic' });
      } catch (error) {
        console.error('[search] semantic search failed, falling back:', error);
        return json({
          documents: await searchByFilename(user.id, q),
          mode: 'filename',
          notice: 'Semantic search is unavailable right now — showing filename matches.',
        });
      }
    }

    return json({ documents: await searchByFilename(user.id, q), mode: 'filename' });
  } catch (error) {
    return handleApiError(error);
  }
}
