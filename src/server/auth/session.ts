import 'server-only';

import { cookies } from 'next/headers';
import { eq, and, lt, gt, isNull, or } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { sessions, users, guestSessions, documentShares } from '@/server/db/schema';
import { hashToken, issueToken } from './tokens';
import { env } from '@/lib/env';
import { SESSION_COOKIE, guestCookieName } from '@/lib/cookies';

export { SESSION_COOKIE, guestCookieName };

const SESSION_TTL_DAYS = 30;
/** Sliding window: re-issue expiry once less than this remains. */
const SESSION_REFRESH_THRESHOLD_DAYS = 15;

const GUEST_TTL_DAYS = 30;

function days(n: number) {
  return n * 24 * 60 * 60 * 1000;
}

/**
 * Cookie hardening applied uniformly.
 *
 * - httpOnly:  script cannot read the token, so XSS cannot exfiltrate sessions.
 * - sameSite lax: blocks CSRF on state-changing POSTs while still allowing a
 *   share link clicked from an email client to carry the cookie.
 * - secure in production only, so http://localhost development still works.
 */
function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Authenticated user sessions
// ---------------------------------------------------------------------------

/** Creates a session row and sets the cookie. Returns the session id. */
export async function createUserSession(
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<string> {
  const { token, tokenHash } = issueToken();
  const expiresAt = new Date(Date.now() + days(SESSION_TTL_DAYS));

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ipAddress: meta.ipAddress?.slice(0, 128) ?? null,
    })
    .returning({ id: sessions.id });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));

  return row.id;
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
};

/**
 * Resolves the current user from the session cookie.
 *
 * Returns null for missing, unknown, or expired sessions — callers treat all
 * three identically. Expiry is checked in SQL so a stale row can never
 * authenticate even if cleanup has not run.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Sliding expiry: keep active users signed in without extending idle sessions.
  const remaining = row.expiresAt.getTime() - Date.now();
  if (remaining < days(SESSION_REFRESH_THRESHOLD_DAYS)) {
    const expiresAt = new Date(Date.now() + days(SESSION_TTL_DAYS));
    await db
      .update(sessions)
      .set({ expiresAt })
      .where(eq(sessions.id, row.sessionId));
    store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  }

  return { id: row.id, name: row.name, email: row.email };
}

/** Deletes the current session server-side and clears the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Revokes every session for a user.
 *
 * Used after a password reset so a stolen session cannot outlive the credential
 * change.
 */
export async function destroyAllUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Opportunistic cleanup of expired rows. */
export async function pruneExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

// ---------------------------------------------------------------------------
// Guest (account-less) sessions, scoped to a single share
// ---------------------------------------------------------------------------

/**
 * Registers a named guest against a share and sets the scoped cookie.
 *
 * Guest cookies are named per share (see `guestCookieName`), so a visitor
 * holding several share links keeps a distinct identity for each and never has
 * one link's access silently replaced by another's.
 */
export async function createGuestSession(
  shareId: string,
  displayName: string,
  identityId?: string | null,
): Promise<{ guestId: string; displayName: string }> {
  const { token, tokenHash } = issueToken();
  const expiresAt = new Date(Date.now() + days(GUEST_TTL_DAYS));

  const [row] = await db
    .insert(guestSessions)
    .values({ shareId, displayName, tokenHash, expiresAt, identityId: identityId ?? null })
    .returning({ id: guestSessions.id, displayName: guestSessions.displayName });

  const store = await cookies();
  store.set(guestCookieName(shareId), token, cookieOptions(expiresAt));

  return { guestId: row.id, displayName: row.displayName };
}

export type GuestIdentity = {
  guestId: string;
  shareId: string;
  displayName: string;
  /** Set when the visitor entered as a guest; null when via their account. */
  identityId: string | null;
  documentId: string;
  role: 'viewer' | 'commenter';
};

/**
 * Resolves a guest identity for a specific share.
 *
 * The join back through `document_shares` re-checks revocation and expiry on
 * every request, so revoking a link instantly cuts off guests who already hold
 * a cookie.
 */
export async function getGuestForShare(shareId: string): Promise<GuestIdentity | null> {
  const store = await cookies();
  const token = store.get(guestCookieName(shareId))?.value;
  if (!token) return null;

  const rows = await db
    .select({
      guestId: guestSessions.id,
      shareId: guestSessions.shareId,
      displayName: guestSessions.displayName,
      identityId: guestSessions.identityId,
      documentId: documentShares.documentId,
      role: documentShares.role,
    })
    .from(guestSessions)
    .innerJoin(documentShares, eq(documentShares.id, guestSessions.shareId))
    .where(
      and(
        eq(guestSessions.tokenHash, hashToken(token)),
        eq(guestSessions.shareId, shareId),
        gt(guestSessions.expiresAt, new Date()),
        isNull(documentShares.revokedAt),
        or(isNull(documentShares.expiresAt), gt(documentShares.expiresAt, new Date())),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
