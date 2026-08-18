import 'server-only';

/**
 * PDF text extraction.
 *
 * Uses `unpdf`, a serverless-targeted build of pdf.js. The alternative,
 * `pdf-parse`, reaches for the filesystem at import time and breaks on Vercel.
 *
 * Text is extracted per page so every chunk keeps page provenance, which is
 * what lets chat answers cite `[p.12]` and the viewer jump there.
 */

/**
 * Upper bound on pages processed.
 *
 * Extraction, embedding, and summarisation all run inside a single serverless
 * invocation with a 60s ceiling. Beyond roughly this many pages the job risks
 * being killed mid-way, so we truncate deliberately and tell the user, rather
 * than failing opaquely. Documented as a known limitation in the README.
 */
export const MAX_PAGES = 200;

/** Below this, a document is almost certainly scanned images with no text layer. */
const MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER = 25;

export type PageText = {
  /** 1-based, matching what the viewer displays. */
  page: number;
  text: string;
};

export type ExtractionResult = {
  pages: PageText[];
  /** Total pages in the file, even if we only processed MAX_PAGES of them. */
  totalPages: number;
  truncated: boolean;
  /** True when the PDF has no usable text layer (i.e. it is scanned images). */
  isScanned: boolean;
};

/**
 * Zero-width and formatting code points that PDF producers scatter through
 * extracted text. They carry no meaning, break word boundaries for the
 * tokenizer, and waste embedding budget.
 *
 * Listed numerically rather than as literals so this source file contains no
 * invisible characters.
 */
const INVISIBLE_CODE_POINTS = new Set([
  0x00ad, // soft hyphen
  0x200b, // zero-width space
  0x200c, // zero-width non-joiner
  0x200d, // zero-width joiner
  0x2028, // line separator
  0x2029, // paragraph separator
  0xfeff, // BOM / zero-width no-break space
]);

function stripInvisible(input: string): string {
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (INVISIBLE_CODE_POINTS.has(code)) continue;
    // Non-breaking space behaves like a space but compares unequal to one.
    out += code === 0x00a0 ? ' ' : char;
  }
  return out;
}

/**
 * Normalises raw pdf.js output into readable prose.
 *
 * Extractors emit text positionally, which produces artefacts that both waste
 * embedding budget and actively mislead the model: hyphenated line breaks split
 * words in half, hard-wrapped lines fragment sentences, and ligatures render as
 * characters the tokenizer treats as unknown.
 */
export function cleanText(raw: string): string {
  return (
    stripInvisible(raw)
      // Normalise Unicode so ligatures and accents compare and tokenize predictably.
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      // Rejoin words split across a line break: "agree-\nment" -> "agreement".
      .replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
      // Unwrap hard-wrapped prose, but keep breaks that end a sentence or
      // precede a bullet/number so list and paragraph structure survives.
      .replace(/([^\n.!?:;])\n(?![\n•\-*\d])/g, '$1 ')
      // Collapse runs of blank lines into a single paragraph break.
      .replace(/\n{3,}/g, '\n\n')
      // Collapse horizontal whitespace runs (common in table extraction).
      // Non-breaking spaces were already folded to plain spaces above.
      .replace(/[ \t]{2,}/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim()
  );
}

/**
 * Extracts per-page text from a PDF buffer.
 *
 * Throws only when the file cannot be parsed at all; a parseable PDF with no
 * text layer returns `isScanned: true` so the caller can give the user an
 * accurate explanation instead of an empty summary.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractionResult> {
  // Imported lazily: pulling pdf.js into the module graph is expensive and only
  // the ingest path needs it.
  const { extractText, getDocumentProxy } = await import('unpdf');

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const totalPages = pdf.numPages;
  const pageLimit = Math.min(totalPages, MAX_PAGES);

  const { text } = await extractText(pdf, { mergePages: false });
  const rawPages = Array.isArray(text) ? text : [text];

  const pages: PageText[] = [];
  for (let i = 0; i < pageLimit; i++) {
    const cleaned = cleanText(rawPages[i] ?? '');
    if (cleaned.length > 0) pages.push({ page: i + 1, text: cleaned });
  }

  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  const isScanned =
    pageLimit > 0 && totalChars / pageLimit < MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER;

  return {
    pages,
    totalPages,
    truncated: totalPages > pageLimit,
    isScanned,
  };
}
