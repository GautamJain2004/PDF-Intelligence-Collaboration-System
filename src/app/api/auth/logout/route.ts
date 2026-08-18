import { destroyCurrentSession } from '@/server/auth/session';
import { handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * POST-only by design: a GET logout could be triggered by any third-party page
 * embedding an image pointing at this URL.
 */
export async function POST() {
  try {
    await destroyCurrentSession();
    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
