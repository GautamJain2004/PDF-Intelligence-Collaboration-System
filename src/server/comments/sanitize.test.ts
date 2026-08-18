import { describe, expect, it } from 'vitest';

import { sanitizeCommentHtml, htmlToText, prepareCommentBody } from './sanitize';

/**
 * Comments are the app's main stored-XSS surface, so these tests assert the
 * dangerous cases are neutralised rather than merely that the happy path works.
 */
describe('sanitizeCommentHtml', () => {
  it('keeps the formatting the editor is allowed to produce', () => {
    const input =
      '<p>Hello <strong>bold</strong> and <em>italic</em></p><ul><li>one</li><li>two</li></ul>';
    expect(sanitizeCommentHtml(input)).toBe(input);
  });

  it('strips script tags', () => {
    const out = sanitizeCommentHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips event handler attributes', () => {
    const out = sanitizeCommentHtml('<p onclick="steal()">click me</p>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('click me');
  });

  it('removes img tags used for onerror payloads', () => {
    const out = sanitizeCommentHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
  });

  it('strips iframes', () => {
    const out = sanitizeCommentHtml('<iframe src="https://evil.test"></iframe>');
    expect(out).not.toContain('iframe');
  });

  it('removes javascript: URLs by dropping anchors entirely', () => {
    const out = sanitizeCommentHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<a');
    // Text content survives, so nothing the user typed silently disappears.
    expect(out).toContain('x');
  });

  it('strips style attributes and tags', () => {
    const out = sanitizeCommentHtml(
      '<p style="position:fixed;top:0">x</p><style>body{display:none}</style>',
    );
    expect(out).not.toContain('style');
    expect(out).not.toContain('display:none');
  });

  it('neutralises svg namespace confusion', () => {
    const out = sanitizeCommentHtml('<svg><script>alert(1)</script></svg>');
    expect(out).not.toContain('alert(1)');
  });

  it('handles nested and malformed markup without leaking script', () => {
    const out = sanitizeCommentHtml('<p><b>bold<script>alert(1)</b></p>');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('bold');
  });
});

describe('htmlToText', () => {
  it('converts list items to bullets', () => {
    expect(htmlToText('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two');
  });

  it('decodes entities', () => {
    expect(htmlToText('<p>a &amp; b &lt;tag&gt;</p>')).toBe('a & b <tag>');
  });

  it('collapses blank output to an empty string', () => {
    expect(htmlToText('<p></p><p><br></p>')).toBe('');
  });
});

describe('prepareCommentBody', () => {
  it('rejects markup that renders as nothing', () => {
    expect(prepareCommentBody('<p></p><p><br></p>')).toBeNull();
    expect(prepareCommentBody('<script>alert(1)</script>')).toBeNull();
  });

  it('returns both representations for real content', () => {
    const result = prepareCommentBody('<p>Looks <strong>good</strong></p>');
    expect(result).not.toBeNull();
    expect(result!.bodyHtml).toContain('<strong>');
    expect(result!.bodyText).toBe('Looks good');
  });
});
