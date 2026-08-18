import 'server-only';

import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { documentShares, documents, users } from '@/server/db/schema';
import { hashToken, issueToken } from '@/server/auth/tokens';
import { encryptToken, decryptToken } from '@/server/auth/crypto';
import { env } from '@/lib/env';
import type { ShareRole } from '@/server/db/schema';

/**
 * Share link lifecycle.
 *
 * A share is a capability: whoever holds the token may open the document within
 * the role granted. Tokens carry 256 bits of entropy, so enumeration is not a
 * realistic attack, and the plaintext is never stored — only a keyed hash for
 * lookup and an authenticated ciphertext for redisplay.
 */

export function shareUrl(token: string): string {
  return `${env().APP_URL}/s/${token}`;
}

export type ShareSummary = {
  id: string;
  url: string | null;
  invitedEmail: string | null;
  role: ShareRole;
  createdAt: Date;
  expiresAt: Date | null;
  lastAccessedAt: Date | null;
  isExpired: boolean;
};

/** Creates a share and returns the one-time plaintext link. */
export async function createShare(params: {
  documentId: string;
  createdBy: string;
  invitedEmail?: string | null;
  role: ShareRole;
  expiresInDays?: number | null;
}): Promise<{ id: string; url: string; token: string }> {
  const { token, tokenHash } = issueToken();

  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [row] = await db
    .insert(documentShares)
    .values({
      documentId: params.documentId,
      createdBy: params.createdBy,
      tokenHash,
      tokenEncrypted: encryptToken(token),
      invitedEmail: params.invitedEmail ?? null,
      role: params.role,
      expiresAt,
    })
    .returning({ id: documentShares.id });

  return { id: row.id, url: shareUrl(token), token };
}

/** Lists a document's shares for its owner, with links recovered for display. */
export async function listShares(documentId: string): Promise<ShareSummary[]> {
  const rows = await db
    .select()
    .from(documentShares)
    .where(
      and(eq(documentShares.documentId, documentId), isNull(documentShares.revokedAt)),
    )
    .orderBy(desc(documentShares.createdAt));

  const now = Date.now();

  return rows.map((row) => {
    const token = decryptToken(row.tokenEncrypted);
    return {
      id: row.id,
      // Null when AUTH_SECRET has been rotated; the UI offers a new link instead.
      url: token ? shareUrl(token) : null,
      invitedEmail: row.invitedEmail,
      role: row.role,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastAccessedAt: row.lastAccessedAt,
      isExpired: row.expiresAt ? row.expiresAt.getTime() < now : false,
    };
  });
}

/**
 * Revokes a share.
 *
 * Soft-revoked rather than deleted so guest comments keep their author
 * attribution. Access checks re-read `revokedAt` on every request, so guests
 * holding a cookie lose access immediately.
 */
export async function revokeShare(shareId: string, documentId: string): Promise<boolean> {
  const result = await db
    .update(documentShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(documentShares.id, shareId),
        // Scoped to the document so an owner cannot revoke someone else's share
        // by guessing an id.
        eq(documentShares.documentId, documentId),
        isNull(documentShares.revokedAt),
      ),
    )
    .returning({ id: documentShares.id });

  return result.length > 0;
}

export type ResolvedShare = {
  shareId: string;
  documentId: string;
  role: ShareRole;
  filename: string;
  summary: string | null;
  status: string;
  ownerName: string;
};

/**
 * Resolves a plaintext share token to its document.
 *
 * Lookup is by hash, so the query is a single indexed equality check and the
 * plaintext token is never compared against stored data directly. Revocation
 * and expiry are enforced in SQL.
 */
export async function resolveShareToken(token: string): Promise<ResolvedShare | null> {
  const rows = await db
    .select({
      shareId: documentShares.id,
      documentId: documentShares.documentId,
      role: documentShares.role,
      filename: documents.filename,
      summary: documents.summary,
      status: documents.status,
      ownerName: users.name,
    })
    .from(documentShares)
    .innerJoin(documents, eq(documents.id, documentShares.documentId))
    .innerJoin(users, eq(users.id, documents.ownerId))
    .where(
      and(
        eq(documentShares.tokenHash, hashToken(token)),
        isNull(documentShares.revokedAt),
        or(isNull(documentShares.expiresAt), gt(documentShares.expiresAt, new Date())),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Records link usage so owners can see whether an invite was ever opened. */
export async function touchShare(shareId: string): Promise<void> {
  await db
    .update(documentShares)
    .set({ lastAccessedAt: new Date() })
    .where(eq(documentShares.id, shareId));
}
