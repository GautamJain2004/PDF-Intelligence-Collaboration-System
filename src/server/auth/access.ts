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
  /** Used as the Reply-To on invitations, so replies reach the sharer. */
  userEmail: string;
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

/**
 * A signed-in user who is not the owner but holds a valid share link.
 *
 * Without this the access model had only two states — owner or cookie-bearing
 * guest — so signing in on a share page could never open the document. Their
 * contributions attribute to their real account rather than a guest identity,
 * which is the whole point of signing in.
 */
export type SharedUserAccess = {
  kind: 'shared-user';
  userId: string;
  userName: string;
  shareId: string;
  shareRole: ShareRole;
  document: Document;
};

export type DocumentAccess = OwnerAccess | GuestAccess | SharedUserAccess;

/**
 * Finds a valid guest identity for a document from any guest cookie present.
 *
 * A visitor may hold cookies for several shares; rather than requiring the
 * client to declare which one applies, every guest cookie is checked against
 * this document in one query. Revocation and expiry are re-validated here, so
 * an already-issued cookie stops working the moment a link is revoked.
 */
async function resolveGuestAccess(
  documentId: string,
): Promise<(Omit<GuestAccess, 'document'> & { identityId: string | null }) | null> {
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
      /**
       * Records which identity the visitor chose at the entry screen: a guest
       * identity when they continued as a guest, null when they came in through
       * their account. Without it a signed-in visitor who deliberately chose
       * "continue as guest" would be silently upgraded back to their account.
       */
      identityId: guestSessions.identityId,
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
    identityId: row.identityId,
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
    return {
      kind: 'owner',
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      document: doc,
    };
  }

  const guest = await resolveGuestAccess(documentId);
  if (!guest) return null;

  /*
   * The share cookie proves this browser holds a valid link; it says nothing
   * about who is holding it. When a session is present the grant is kept but
   * identity comes from the account — unless the visitor explicitly entered as
   * a guest, which `identityId` records. Ignoring that would override a choice
   * they just made, dropping the name they typed and the "(guest)" tag with it.
   */
  if (user && !guest.identityId) {
    return {
      kind: 'shared-user',
      userId: user.id,
      userName: user.name,
      shareId: guest.shareId,
      shareRole: guest.shareRole,
      document: doc,
    };
  }

  // `identityId` is internal bookkeeping and not part of the access shape.
  const guestAccess: GuestAccess = {
    kind: 'guest',
    guestId: guest.guestId,
    shareId: guest.shareId,
    displayName: guest.displayName,
    shareRole: guest.shareRole,
    document: doc,
  };
  return guestAccess;
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

/** Owners always may; everyone else only on a `commenter` share. */
export function canComment(access: DocumentAccess): boolean {
  return access.kind === 'owner' || access.shareRole === 'commenter';
}

/**
 * Collapses access into "which account or guest is this".
 *
 * Comment ownership and chat transcripts both key off the actor rather than the
 * role, and an owner and a shared-in user are the same kind of thing here: a
 * registered account. Centralised so a new access kind cannot be silently
 * mishandled at one of several call sites.
 */
export function viewerIdentity(
  access: DocumentAccess,
): { kind: 'user'; userId: string } | { kind: 'guest'; guestId: string } {
  return access.kind === 'guest'
    ? { kind: 'guest', guestId: access.guestId }
    : { kind: 'user', userId: access.userId };
}

/** How the viewer is labelled in the UI. */
export function viewerName(access: DocumentAccess): string {
  return access.kind === 'guest' ? access.displayName : access.userName;
}

/** Stable display name and author columns for a comment or chat message. */
export function actorIdentity(access: DocumentAccess): {
  authorName: string;
  authorUserId: string | null;
  authorGuestId: string | null;
} {
  // Both signed-in kinds attribute to the account; only a true guest gets a
  // guest id, which is what drives the "(guest)" tag in the sidebar.
  if (access.kind === 'owner' || access.kind === 'shared-user') {
    return {
      authorName: access.userName,
      authorUserId: access.userId,
      authorGuestId: null,
    };
  }

  return {
    authorName: access.displayName,
    authorUserId: null,
    authorGuestId: access.guestId,
  };
}
