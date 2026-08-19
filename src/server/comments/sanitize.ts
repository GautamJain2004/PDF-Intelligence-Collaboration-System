import 'server-only';

import sanitizeHtml from 'sanitize-html';

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
 * script or load a remote resource, so this holds up even if the parser were
 * confused by some exotic markup quirk.
 *
 * **Why `sanitize-html` and not `isomorphic-dompurify`.** DOMPurify needs a DOM,
 * which on the server means jsdom. jsdom pulls in `html-encoding-sniffer`, a
 * CommonJS package that `require()`s the ESM-only `@exodus/bytes`. Node 22.12+
 * permits `require(esm)` so this worked locally, but Next.js externalises jsdom
 * rather than bundling it, and the serverless module loader rejects the same
 * call — every POST and GET on this route returned a 500 in production while
 * passing every test and local check. `sanitize-html` parses with htmlparser2
 * instead: no DOM, no jsdom, and roughly ten megabytes less to cold-start.
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

/**
 * Tags whose *contents* are dropped along with the tag.
 *
 * Everything else disallowed is unwrapped instead, keeping the text inside, so
 * stripping `<a>` does not silently delete the words the user typed. These are
 * the cases where the inner text is payload rather than prose — script bodies,
 * stylesheet rules, and the fallback content of embedded frames.
 */
const STRIP_WITH_CONTENT = [
  'script',
  'style',
  'textarea',
  'option',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
];

export function sanitizeCommentHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: ALLOWED_TAGS,
    // No attributes at all. Nothing in the allowlist needs one, and permitting
    // none removes every attribute-based injection vector in a single stroke —
    // event handlers, inline styles and `javascript:` URLs all included.
    allowedAttributes: {},
    // With no attributes surviving there is no URL left to carry a scheme, so
    // this is belt-and-braces rather than the primary defence.
    allowedSchemes: [],
    // Unwrap unknown tags, keeping their text.
    disallowedTagsMode: 'discard',
    nonTextTags: STRIP_WITH_CONTENT,
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
