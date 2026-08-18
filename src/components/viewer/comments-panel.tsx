'use client';

import * as React from 'react';
import useSWR from 'swr';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, MessageSquareText, Reply, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, Badge, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { CommentEditor } from './comment-editor';
import { apiFetch, swrFetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';

type CommentNode = {
  id: string;
  parentId: string | null;
  authorName: string;
  isOwner: boolean;
  isMine: boolean;
  bodyHtml: string;
  pageNumber: number | null;
  createdAt: string;
  deletedAt: string | null;
  replies: CommentNode[];
};

type CommentsResponse = { comments: CommentNode[]; canComment: boolean };

function countAll(nodes: CommentNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.deletedAt ? 0 : 1) + countAll(node.replies),
    0,
  );
}

function CommentItem({
  comment,
  canComment,
  depth,
  onReply,
  onDelete,
  replyingTo,
  setReplyingTo,
}: {
  comment: CommentNode;
  canComment: boolean;
  depth: number;
  onReply: (parentId: string, html: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
}) {
  const [deleting, setDeleting] = React.useState(false);
  const isReplying = replyingTo === comment.id;

  // Replies are visually nested one level only; deeper threads stay readable in
  // a narrow sidebar by flattening rather than indenting indefinitely.
  const indent = Math.min(depth, 1);

  return (
    <div className={cn(indent > 0 && 'ml-4 border-l border-border pl-3')}>
      <div className="group py-2">
        {comment.deletedAt ? (
          <p className="text-xs italic text-muted-foreground">
            This comment was deleted.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Avatar name={comment.authorName} size="sm" />
              <span className="truncate text-xs font-medium">{comment.authorName}</span>
              {comment.isOwner ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  Owner
                </Badge>
              ) : null}
              <time
                dateTime={comment.createdAt}
                className="ml-auto shrink-0 text-[10px] text-muted-foreground"
              >
                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
              </time>
            </div>

            {/*
              Safe: this HTML was sanitised server-side against a tiny allowlist
              (see server/comments/sanitize.ts) before it was ever stored.
            */}
            <div
              className="comment-body mt-1.5 pl-8 text-foreground"
              dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
            />

            <div className="mt-1 flex items-center gap-1 pl-8 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {canComment ? (
                <button
                  onClick={() => setReplyingTo(isReplying ? null : comment.id)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Reply className="size-3" />
                  Reply
                </button>
              ) : null}

              {comment.isMine ? (
                <button
                  onClick={async () => {
                    setDeleting(true);
                    await onDelete(comment.id);
                    setDeleting(false);
                  }}
                  disabled={deleting}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3" />
                  Delete
                </button>
              ) : null}
            </div>
          </>
        )}

        {isReplying ? (
          <div className="mt-2 pl-8">
            <CommentEditor
              compact
              autoFocus
              placeholder={`Reply to ${comment.authorName}…`}
              submitLabel="Reply"
              onCancel={() => setReplyingTo(null)}
              onSubmit={async (html) => {
                await onReply(comment.id, html);
                setReplyingTo(null);
              }}
            />
          </div>
        ) : null}
      </div>

      {comment.replies.length > 0 ? (
        <div>
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              canComment={canComment}
              depth={depth + 1}
              onReply={onReply}
              onDelete={onDelete}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Threaded comment sidebar.
 *
 * Shared by owners and invited guests — the only difference is `canComment`,
 * which the server decides from the share's role. Polls periodically so
 * collaborators see each other's comments without a manual refresh.
 */
export function CommentsPanel({
  documentId,
  currentPage,
}: {
  documentId: string;
  /** Attached to new comments so they can be traced back to a page. */
  currentPage?: number;
}) {
  const [replyingTo, setReplyingTo] = React.useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR<CommentsResponse>(
    `/api/documents/${documentId}/comments`,
    swrFetcher,
    { refreshInterval: 15_000, revalidateOnFocus: true },
  );

  const comments = data?.comments ?? [];
  const canComment = data?.canComment ?? false;
  const total = countAll(comments);

  async function post(html: string, parentId: string | null) {
    try {
      await apiFetch(`/api/documents/${documentId}/comments`, {
        method: 'POST',
        json: { bodyHtml: html, parentId, pageNumber: currentPage ?? null },
      });
      await mutate();
    } catch (error) {
      toast.error('Could not post comment', {
        description: error instanceof Error ? error.message : undefined,
      });
      throw error;
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/documents/${documentId}/comments/${id}`, { method: 'DELETE' });
      await mutate();
    } catch (error) {
      toast.error('Could not delete comment', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <MessageSquareText className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Comments</h2>
        {total > 0 ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {total}
          </span>
        ) : null}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-2">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No comments yet"
            description={
              canComment
                ? 'Start the discussion below.'
                : 'This share link is read-only, so you can follow the discussion but not add to it.'
            }
            className="py-8"
          />
        ) : (
          <div className="divide-y divide-border">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                canComment={canComment}
                depth={0}
                onReply={(parentId, html) => post(html, parentId)}
                onDelete={remove}
                replyingTo={replyingTo}
                setReplyingTo={setReplyingTo}
              />
            ))}
          </div>
        )}
      </div>

      {canComment ? (
        <div className="shrink-0 border-t border-border p-3">
          <CommentEditor
            compact
            placeholder="Add a comment…"
            onSubmit={(html) => post(html, null)}
          />
        </div>
      ) : (
        <p className="shrink-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          This link grants read-only access.
        </p>
      )}
    </div>
  );
}
