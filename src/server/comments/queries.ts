import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { comments } from '@/server/db/schema';

/**
 * Comment reads and writes.
 *
 * Threads are stored flat with a `parentId` and assembled into a tree in
 * memory. For a per-document comment count this is far cheaper than a recursive
 * CTE, and it keeps ordering logic in one readable place.
 */

export type CommentNode = {
  id: string;
  parentId: string | null;
  authorName: string;
  /** True when written by the document's owner, for the "Owner" badge. */
  isOwner: boolean;
  /** True when written by the current viewer, who may delete it. */
  isMine: boolean;
  bodyHtml: string;
  pageNumber: number | null;
  createdAt: Date;
  deletedAt: Date | null;
  replies: CommentNode[];
};

type Viewer =
  | { kind: 'owner'; userId: string }
  | { kind: 'guest'; guestId: string };

/**
 * Loads a document's comment tree.
 *
 * Soft-deleted comments are returned as tombstones rather than omitted: their
 * replies must remain visible, and a thread with a hole in it reads as a bug.
 */
export async function listComments(
  documentId: string,
  viewer: Viewer,
  ownerUserId: string,
): Promise<CommentNode[]> {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.documentId, documentId))
    .orderBy(asc(comments.createdAt));

  const nodes = new Map<string, CommentNode>();

  for (const row of rows) {
    const isMine =
      viewer.kind === 'owner'
        ? row.authorUserId === viewer.userId
        : row.authorGuestId === viewer.guestId;

    nodes.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      authorName: row.authorName,
      isOwner: row.authorUserId === ownerUserId,
      isMine: Boolean(isMine) && !row.deletedAt,
      // Deleted comments must not ship their original body to the client.
      bodyHtml: row.deletedAt ? '' : row.bodyHtml,
      pageNumber: row.pageNumber,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
      replies: [],
    });
  }

  const roots: CommentNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (parent) {
        parent.replies.push(node);
        continue;
      }
      // Parent missing (hard-deleted): promote so the reply is not orphaned.
    }
    roots.push(node);
  }

  // Newest threads first, but replies oldest-first so conversations read down.
  roots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return roots;
}

/**
 * Verifies a parent comment belongs to the same document.
 *
 * Without this check, a caller could reply to a comment on a document they
 * cannot see, attaching their text to another document's thread.
 */
export async function parentBelongsToDocument(
  parentId: string,
  documentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.id, parentId), eq(comments.documentId, documentId)))
    .limit(1);

  return Boolean(row);
}

export async function createComment(values: {
  documentId: string;
  parentId: string | null;
  authorUserId: string | null;
  authorGuestId: string | null;
  authorName: string;
  bodyHtml: string;
  bodyText: string;
  pageNumber: number | null;
}) {
  const [row] = await db.insert(comments).values(values).returning();
  return row;
}

/**
 * Soft-deletes a comment the viewer authored.
 *
 * The author predicate is part of the WHERE clause, so the ownership check and
 * the write are one atomic statement — there is no window in which a concurrent
 * request could act on a stale authorisation decision.
 */
export async function deleteOwnComment(
  commentId: string,
  documentId: string,
  viewer: Viewer,
): Promise<boolean> {
  const authorPredicate =
    viewer.kind === 'owner'
      ? eq(comments.authorUserId, viewer.userId)
      : eq(comments.authorGuestId, viewer.guestId);

  const result = await db
    .update(comments)
    .set({ deletedAt: new Date(), bodyHtml: '', bodyText: '', updatedAt: new Date() })
    .where(
      and(eq(comments.id, commentId), eq(comments.documentId, documentId), authorPredicate),
    )
    .returning({ id: comments.id });

  return result.length > 0;
}
