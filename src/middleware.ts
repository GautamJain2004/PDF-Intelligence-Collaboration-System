import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/cookies';

/**
 * Redirect UX only — NOT authorization.
 *
 * This middleware checks whether a session cookie is *present*, not whether it
 * is *valid*: validation needs a database round-trip, which the Edge runtime
 * cannot do cheaply. Anyone can forge a cookie value and get past this.
 *
 * That is fine, because nothing is protected here. Every route and page
 * re-resolves identity server-side via `getCurrentUser()` / `requireDocumentAccess()`
 * before returning data. Treating middleware as a security boundary is exactly
 * the mistake behind CVE-2025-29927, so the boundary lives in the data layer
 * instead — middleware just saves signed-out users a pointless page render.
 */

const PROTECTED_PREFIXES = ['/dashboard', '/documents'];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const needsSession = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!needsSession) return NextResponse.next();

  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  // Preserve the destination so sign-in lands where the user was headed.
  const target = `${pathname}${search}`;
  if (target !== '/dashboard') loginUrl.searchParams.set('next', target);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Skip Next internals, the API (which returns JSON errors rather than
     * redirects), and static assets.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
