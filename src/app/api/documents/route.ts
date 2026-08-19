import { getCurrentUser } from '@/server/auth/session';
import {
  PAGE_SIZE,
  getLibraryStats,
  listDocuments,
  searchByFilename,
  searchSemantic,
  type StatusFilter,
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
      page: url.searchParams.get('page') ?? '1',
      status: url.searchParams.get('status') ?? 'all',
    });

    /*
     * Stats describe the whole library, never the current page or filter. The
     * rail's counts are what a filter *would* find, so deriving them from the
     * rows on screen would make them wrong as soon as a second page exists.
     */
    const stats = await getLibraryStats(user.id);

    if (!parsed.success) {
      return json({ ...(await listDocuments(user.id)), page: 1, pageSize: PAGE_SIZE, stats });
    }

    const { q, mode, page, status } = parsed.data;
    const offset = (page - 1) * PAGE_SIZE;
    const paging = { limit: PAGE_SIZE, offset };
    const envelope = { page, pageSize: PAGE_SIZE, stats };

    if (!q) {
      return json({
        ...(await listDocuments(user.id, { status: status as StatusFilter, ...paging })),
        ...envelope,
      });
    }

    if (mode === 'semantic') {
      const limit = rateLimit(`search:${user.id}`, LIMITS.search);
      if (!limit.ok) throw rateLimited('Search limit reached. Please wait a moment.');

      try {
        return json({
          ...(await searchSemantic(user.id, q, paging)),
          mode: 'semantic',
          ...envelope,
        });
      } catch (error) {
        console.error('[search] semantic search failed, falling back:', error);
        return json({
          ...(await searchByFilename(user.id, q, paging)),
          mode: 'filename',
          notice: 'Semantic search is unavailable right now — showing filename matches.',
          ...envelope,
        });
      }
    }

    return json({
      ...(await searchByFilename(user.id, q, paging)),
      mode: 'filename',
      ...envelope,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
