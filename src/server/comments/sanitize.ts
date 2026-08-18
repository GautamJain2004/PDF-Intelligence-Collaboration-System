import 'server-only';

import DOMPurify from 'isomorphic-dompurify';

/**
 * Comment HTML sanitisation.
 *
 * Comments are the one place where one user's input is rendered inside another
 * user's page, which makes them the app's primary stored-XSS surface. The
 * rich-text editor produces HTML, so it must be sanitised — and crucially, on
 * the **server**, because a client bypassing the editor can POST anything.
 *
 * The allowlist is deliberately tiny: exactly the formatting the assignment
 * asks for (bold, italic, bullet points) plus paragraphs and a couple of
 * near-free extras. Everything else — scripts, styles, iframes, event handlers,
 * `javascript:` URLs, even links — is stripped. No allowed tag can execute
 * script or load a remote resource, so this holds up even if DOMPurify were
 * bypassed on some exotic parser quirk.
 */

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'code',
  'blockquote',
];

export function sanitizeCommentHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    // No attributes at all. Nothing in the allowlist needs one, and permitting
    // none removes every attribute-based injection vector in a single stroke.
    ALLOWED_ATTR: [],
    // Defence in depth: these stay banned even if the tag list is widened later.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    // Keep the text inside a removed tag, so stripping `<a>` does not silently
    // delete the words the user typed.
    KEEP_CONTENT: true,
    /*
     * NOTE: do not add `USE_PROFILES` here. It *replaces* ALLOWED_TAGS with the
     * profile's much broader tag set rather than intersecting with it, which
     * silently let `<img>` and `<a>` through. Caught by the tests in this
     * module's spec — keep them.
     */
  });
}

/**
 * Plaintext projection of comment HTML.
 *
 * Stored alongside the HTML for search and email previews, and used to decide
 * whether a comment is empty — a body of `<p></p><p><br></p>` renders as
 * nothing and should be rejected rather than saved as a blank comment.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type SanitizedComment = { bodyHtml: string; bodyText: string };

/** Sanitises and validates a submitted comment body. */
export function prepareCommentBody(dirty: string): SanitizedComment | null {
  const bodyHtml = sanitizeCommentHtml(dirty);
  const bodyText = htmlToText(bodyHtml);

  // Empty after sanitisation means the payload was markup with no real content.
  if (bodyText.length === 0) return null;

  return { bodyHtml, bodyText };
}
