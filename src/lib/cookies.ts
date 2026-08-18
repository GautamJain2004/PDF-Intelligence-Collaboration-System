/**
 * Cookie names, isolated from any runtime-specific code.
 *
 * Middleware runs on the Edge runtime, which cannot bundle `node:crypto`.
 * Importing these constants from the session module would drag the whole
 * Node-only auth stack into the Edge bundle and fail the build, so the names
 * live here where both runtimes can safely reach them.
 */

export const SESSION_COOKIE = 'pdfiq_session';

/** Guest cookies are per-share, so one visitor can hold several independently. */
export const GUEST_COOKIE_PREFIX = 'pdfiq_guest_';

export function guestCookieName(shareId: string): string {
  return `${GUEST_COOKIE_PREFIX}${shareId.replace(/-/g, '')}`;
}
