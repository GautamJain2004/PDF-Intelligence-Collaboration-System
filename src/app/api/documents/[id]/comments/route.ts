import { actorIdentity, canComment, requireDocumentAccess } from '@/server/auth/access';
import {
  createComment,
  listComments,
  parentBelongsToDocument,
} from '@/server/comments/queries';
import { prepareCommentBody } from '@/server/comments/sanitize';
import { createCommentSchema } from '@/lib/validation';
import {
  badRequest,
  forbidden,
  handleApiError,
  json,
  notFound,
  parseJson,
  rateLimited,
} from '@/lib/api';
import { LIMITS, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/** Lists the comment tree. Anyone with document access may read. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDocumentAccess(id);

    const viewer =
      access.kind === 'owner'
        ? ({ kind: 'owner', userId: access.userId } as const)
        : ({ kind: 'guest', guestId: access.guestId } as const);

    const tree = await listComments(id, viewer, access.document.ownerId);

    return json({ comments: tree, canComment: canComment(access) });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Posts a comment or reply.
 *
 * Requires the `commenter` role — a `viewer` share can read the thread but not
 * add to it. The body is sanitised server-side regardless of what the client
 * sent, since the editor's output is not trustworthy.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDocumentAccess(id);

    if (!canComment(access)) {
      throw forbidden('This share link is read-only.');
    }

    const identity = actorIdentity(access);
    const actorKey = identity.authorUserId ?? identity.authorGuestId ?? 'anon';

    const limit = rateLimit(`comment:${actorKey}`, LIMITS.comment);
    if (!limit.ok) throw rateLimited('You are commenting too quickly.');

    const input = await parseJson(request, createCommentSchema);

    const body = prepareCommentBody(input.bodyHtml);
    if (!body) throw badRequest('Comment cannot be empty.');

    // A reply must target a comment on this same document.
    if (input.parentId) {
      const valid = await parentBelongsToDocument(input.parentId, id);
      if (!valid) throw notFound('The comment you replied to no longer exists.');
    }

    const comment = await createComment({
      documentId: id,
      parentId: input.parentId ?? null,
      authorUserId: identity.authorUserId,
      authorGuestId: identity.authorGuestId,
      authorName: identity.authorName,
      bodyHtml: body.bodyHtml,
      bodyText: body.bodyText,
      pageNumber: input.pageNumber ?? null,
    });

    return json(
      {
        comment: {
          id: comment.id,
          parentId: comment.parentId,
          authorName: comment.authorName,
          isOwner: access.kind === 'owner',
          isMine: true,
          bodyHtml: comment.bodyHtml,
          pageNumber: comment.pageNumber,
          createdAt: comment.createdAt,
          deletedAt: null,
          replies: [],
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
