import 'server-only';

import { cookies } from 'next/headers';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { documents, documentShares, guestSessions } from '@/server/db/schema';
import type { Document, ShareRole } from '@/server/db/schema';
import { hashToken } from './tokens';
import { getCurrentUser } from './session';
import { GUEST_COOKIE_PREFIX } from '@/lib/cookies';

/**
 * Centralised authorization.
 *
 * Every route that touches a document resolves access through this module —
 * there are no ad-hoc ownership checks scattered across handlers. Adding a new
 * document-scoped endpoint means calling `requireDocumentAccess` and nothing
 * else, which is what keeps the authorization surface auditable.
 *
 * Note that middleware is deliberately NOT trusted for authorization (see
 * CVE-2025-29927, where a crafted header could bypass Next.js middleware).
 * Middleware only handles redirect UX; the real checks all happen here, in the
 * data layer.
 */

export type OwnerAccess = {
  kind: 'owner';
  userId: string;
  userName: string;
  document: Document;
};

export type GuestAccess = {
  kind: 'guest';
  guestId: string;
  shareId: string;
  displayName: string;
  shareRole: ShareRole;
  document: Document;
};

export type DocumentAccess = OwnerAccess | GuestAccess;

/**
 * Finds a valid guest identity for a document from any guest cookie present.
 *
 * A visitor may hold cookies for several shares; rather than requiring the
 * client to declare which one applies, every guest cookie is checked against
 * this document in one query. Revocation and expiry are re-validated here, so
 * an already-issued cookie stops working the moment a link is revoked.
 */
async function resolveGuestAccess(documentId: string): Promise<Omit<GuestAccess, 'document'> | null> {
  const store = await cookies();
  const tokenHashes = store
    .getAll()
    .filter((c) => c.name.startsWith(GUEST_COOKIE_PREFIX) && c.value)
    .map((c) => hashToken(c.value));

  if (tokenHashes.length === 0) return null;

  const rows = await db
    .select({
      guestId: guestSessions.id,
      shareId: documentShares.id,
      displayName: guestSessions.displayName,
      shareRole: documentShares.role,
    })
    .from(guestSessions)
    .innerJoin(documentShares, eq(documentShares.id, guestSessions.shareId))
    .where(
      and(
        inArray(guestSessions.tokenHash, tokenHashes),
        gt(guestSessions.expiresAt, new Date()),
        eq(documentShares.documentId, documentId),
        isNull(documentShares.revokedAt),
        or(isNull(documentShares.expiresAt), gt(documentShares.expiresAt, new Date())),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    kind: 'guest',
    guestId: row.guestId,
    shareId: row.shareId,
    displayName: row.displayName,
    shareRole: row.shareRole,
  };
}

/**
 * Resolves what the caller may do with a document, or null if they may do
 * nothing (including when the document does not exist — callers must not
 * distinguish the two).
 */
export async function getDocumentAccess(
  documentId: string,
): Promise<DocumentAccess | null> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return null;

  const user = await getCurrentUser();
  if (user && doc.ownerId === user.id) {
    return { kind: 'owner', userId: user.id, userName: user.name, document: doc };
  }

  const guest = await resolveGuestAccess(documentId);
  if (guest) return { ...guest, document: doc };

  return null;
}

/** Thrown when access is denied; mapped to a 404 by the API error handler. */
export class AccessDeniedError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

/**
 * Access or throw.
 *
 * Denial surfaces as 404 rather than 403 so an unauthorised caller cannot use
 * status codes to enumerate which document ids exist.
 */
export async function requireDocumentAccess(
  documentId: string,
): Promise<DocumentAccess> {
  const access = await getDocumentAccess(documentId);
  if (!access) throw new AccessDeniedError();
  return access;
}

/** Owner-only operations: sharing, revoking, deleting, re-ingesting. */
export async function requireDocumentOwner(documentId: string): Promise<OwnerAccess> {
  const access = await requireDocumentAccess(documentId);
  if (access.kind !== 'owner') throw new AccessDeniedError();
  return access;
}

/** Owners always may; guests only on shares granted the `commenter` role. */
export function canComment(access: DocumentAccess): boolean {
  return access.kind === 'owner' || access.shareRole === 'commenter';
}

/** Stable display name and author columns for a comment or chat message. */
export function actorIdentity(access: DocumentAccess): {
  authorName: string;
  authorUserId: string | null;
  authorGuestId: string | null;
} {
  return access.kind === 'owner'
    ? { authorName: access.userName, authorUserId: access.userId, authorGuestId: null }
    : {
        authorName: access.displayName,
        authorUserId: null,
        authorGuestId: access.guestId,
      };
}
