'use client';

import * as React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MAX_COMMENT_LENGTH } from '@/lib/validation';

/**
 * Rich-text comment editor.
 *
 * Restricted to bold, italic, and lists — exactly the formatting the brief asks
 * for. The extension list is trimmed to match, so the editor cannot produce
 * markup the server-side sanitiser would strip; what the user sees is what gets
 * stored.
 */
export function CommentEditor({
  onSubmit,
  onCancel,
  placeholder = 'Add a comment…',
  submitLabel = 'Comment',
  autoFocus = false,
  compact = false,
}: {
  onSubmit: (html: string) => Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [submitting, setSubmitting] = React.useState(false);

  const editor = useEditor({
    // Tiptap renders differently on the server; disabling SSR avoids a
    // hydration mismatch warning in Next.js.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        codeBlock: false,
        blockquote: false,
        strike: false,
        link: false,
      }),
    ],
    editorProps: {
      attributes: {
        class: cn(
          'tiptap prose-sm max-w-none focus:outline-none comment-body',
          compact ? 'min-h-[3rem]' : 'min-h-[4.5rem]',
        ),
        'data-placeholder': placeholder,
        'aria-label': placeholder,
      },
    },
    autofocus: autoFocus,
  });

  const isEmpty = editor?.isEmpty ?? true;
  const characterCount = editor?.getText().length ?? 0;
  const overLimit = characterCount > MAX_COMMENT_LENGTH;

  async function submit() {
    if (!editor || isEmpty || submitting || overLimit) return;

    setSubmitting(true);
    try {
      await onSubmit(editor.getHTML());
      editor.commands.clearContent();
    } finally {
      setSubmitting(false);
    }
  }

  if (!editor) {
    return <div className="h-24 rounded-md border border-input bg-card" />;
  }

  const toolbarButtons = [
    {
      icon: Bold,
      label: 'Bold',
      isActive: editor.isActive('bold'),
      action: () => editor.chain().focus().toggleBold().run(),
    },
    {
      icon: Italic,
      label: 'Italic',
      isActive: editor.isActive('italic'),
      action: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      icon: List,
      label: 'Bullet list',
      isActive: editor.isActive('bulletList'),
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      label: 'Numbered list',
      isActive: editor.isActive('orderedList'),
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ];

  return (
    <div className="rounded-md border border-input bg-card focus-within:ring-2 focus-within:ring-ring">
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        {toolbarButtons.map(({ icon: Icon, label, isActive, action }) => (
          <button
            key={label}
            type="button"
            onClick={action}
            aria-label={label}
            aria-pressed={isActive}
            title={label}
            className={cn(
              'grid size-7 place-items-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        ))}

        {characterCount > MAX_COMMENT_LENGTH * 0.8 ? (
          <span
            className={cn(
              'ml-auto pr-1 text-[10px] tabular-nums',
              overLimit ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {characterCount}/{MAX_COMMENT_LENGTH}
          </span>
        ) : null}
      </div>

      <div
        className="px-3 py-2"
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter submits, matching most comment UIs.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-2 py-1.5">
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={submit}
          disabled={isEmpty || overLimit}
          loading={submitting}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
