import 'server-only';

import { MAX_UPLOAD_BYTES } from '@/lib/validation';

/**
 * Server-side PDF validation.
 *
 * The client declares a filename, size, and MIME type when requesting an upload
 * URL — all three are hints, none are trusted. This module inspects the actual
 * bytes after upload. A file named `.pdf` with `Content-Type: application/pdf`
 * containing an HTML payload fails here.
 */

/** Every PDF begins with `%PDF-` followed by a version, e.g. `%PDF-1.7`. */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/**
 * Some producers prepend junk before the header, so spec-tolerant readers scan
 * a short window rather than requiring offset 0. We match that behaviour.
 */
const MAGIC_SEARCH_WINDOW = 1024;

export type ValidationFailure = {
  ok: false;
  /** Safe to show the user — never contains internals. */
  reason: string;
};

export type ValidationSuccess = { ok: true };

export function validatePdfBytes(buffer: Buffer): ValidationSuccess | ValidationFailure {
  if (buffer.byteLength === 0) {
    return { ok: false, reason: 'The uploaded file is empty.' };
  }

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `The file is larger than the ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`,
    };
  }

  const header = buffer.subarray(0, MAGIC_SEARCH_WINDOW);
  if (header.indexOf(PDF_MAGIC) === -1) {
    return {
      ok: false,
      reason: 'This file is not a valid PDF. Please upload a real PDF document.',
    };
  }

  /*
   * A well-formed PDF ends with an `%%EOF` marker. Truncated uploads (a dropped
   * connection mid-transfer) still carry a valid header, so checking the tail
   * catches them before we spend an LLM call on a broken document.
   */
  const tail = buffer.subarray(Math.max(0, buffer.byteLength - 2048)).toString('latin1');
  if (!tail.includes('%%EOF')) {
    return {
      ok: false,
      reason: 'The PDF appears to be incomplete or corrupted. Try uploading it again.',
    };
  }

  return { ok: true };
}

/** ASCII control ranges: C0 (0-31) and DEL (127). */
function isControlChar(codePoint: number): boolean {
  return codePoint < 32 || codePoint === 127;
}

/** Illegal or awkward in filenames across Windows and POSIX. */
const UNSAFE_FILENAME_CHARS = new Set(['"', '<', '>', '|', ':', '*', '?']);

/**
 * Strips path separators, control characters, and reserved punctuation from a
 * user-supplied filename.
 *
 * The result is only ever used for display and download headers — the storage
 * key is generated independently — but a name containing CR/LF could forge
 * headers in a Content-Disposition, so it is cleaned regardless.
 *
 * Implemented as a code-point filter rather than a regex so no literal control
 * characters appear in this source file.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'document.pdf';

  const cleaned = Array.from(base)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return !isControlChar(code) && !UNSAFE_FILENAME_CHARS.has(char);
    })
    .join('')
    .trim();

  const safe = cleaned.length > 0 ? cleaned : 'document.pdf';
  return safe.length > 255 ? `${safe.slice(0, 240)}.pdf` : safe;
}
