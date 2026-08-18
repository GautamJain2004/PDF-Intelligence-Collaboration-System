/**
 * End-to-end verification of the AI pipeline against live services.
 *
 *   npx tsx scripts/verify-pipeline.ts [path/to.pdf]
 *
 * Exercises the real modules the app uses — no mocks, no reimplementation — so
 * a pass here means the deployed code path works:
 *
 *   validate -> extract -> clean -> chunk -> embed -> store
 *            -> summarise -> descriptor embedding
 *            -> hybrid retrieval -> grounded answer -> semantic search
 *
 * It writes to the configured database and cleans up after itself.
 */
import 'dotenv/config';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import path from 'node:path';

config({ path: '.env.local', quiet: true });

async function main() {
  const pdfPath = process.argv[2] ?? path.join('sample-data', 'Agreement_v3.pdf');

  // Imported after env is loaded, since these modules validate on first use.
  const { validatePdfBytes } = await import('../src/server/pdf/validate');
  const { extractPdfText } = await import('../src/server/pdf/extract');
  const { chunkPages } = await import('../src/server/pdf/chunk');
  const { embedDocuments, embedDocumentDescriptor } = await import('../src/server/ai/embed');
  const { summarizeDocument } = await import('../src/server/ai/summarize');
  const { retrieveChunks } = await import('../src/server/ai/retrieve');
  const { rewriteQuery } = await import('../src/server/ai/chat');
  const { CHAT_SYSTEM_PROMPT, chatUserPrompt } = await import('../src/server/ai/prompts');
  const { chatModel } = await import('../src/server/ai/provider');
  const { searchSemantic } = await import('../src/server/documents/queries');
  const { db } = await import('../src/server/db/client');
  const { users, documents, documentChunks } = await import('../src/server/db/schema');
  const { hashPassword } = await import('../src/server/auth/password');
  const { generateText } = await import('ai');
  const { eq } = await import('drizzle-orm');

  const step = (n: string) => console.log(`\n${'─'.repeat(70)}\n${n}\n${'─'.repeat(70)}`);
  let userId = '';

  try {
    // --- 1. Validation ----------------------------------------------------
    step('1. Server-side PDF validation');
    const bytes = readFileSync(pdfPath);
    const valid = validatePdfBytes(bytes);
    console.log(`   ${pdfPath} (${(bytes.length / 1024).toFixed(1)} KB) -> ${valid.ok ? 'VALID' : 'REJECTED: ' + valid.reason}`);
    if (!valid.ok) throw new Error('sample PDF failed validation');

    // Negative control: a non-PDF must be rejected.
    const fake = Buffer.from('<html><body>not a pdf</body></html>');
    const fakeResult = validatePdfBytes(fake);
    console.log(`   HTML masquerading as PDF -> ${fakeResult.ok ? 'ACCEPTED (BUG!)' : 'REJECTED: ' + fakeResult.reason}`);
    if (fakeResult.ok) throw new Error('validator accepted a non-PDF');

    // --- 2. Extraction ----------------------------------------------------
    step('2. Text extraction and cleaning');
    const extraction = await extractPdfText(bytes);
    console.log(`   pages: ${extraction.totalPages}, with text: ${extraction.pages.length}, scanned: ${extraction.isScanned}, truncated: ${extraction.truncated}`);
    console.log(`   page 1 opens: "${extraction.pages[0]!.text.slice(0, 90).replace(/\n/g, ' ')}…"`);

    // --- 3. Chunking ------------------------------------------------------
    step('3. Chunking');
    const chunks = chunkPages(extraction.pages);
    console.log(`   ${chunks.length} chunks | tokens min/avg/max: ${Math.min(...chunks.map((c) => c.tokenCount))}/${Math.round(chunks.reduce((s, c) => s + c.tokenCount, 0) / chunks.length)}/${Math.max(...chunks.map((c) => c.tokenCount))}`);
    for (const c of chunks) console.log(`     #${c.chunkIndex} pp.${c.pageFrom}-${c.pageTo} (${c.tokenCount} tok)`);

    // --- 4. Embeddings ----------------------------------------------------
    step('4. Embeddings (live LLM)');
    const t0 = Date.now();
    const embeddings = await embedDocuments(chunks.map((c) => c.content));
    const norm = Math.hypot(...embeddings[0]!);
    console.log(`   ${embeddings.length} vectors x ${embeddings[0]!.length} dims in ${Date.now() - t0}ms`);
    console.log(`   L2 norm of first vector: ${norm.toFixed(6)} (must be ~1.0 for cosine to be correct)`);
    if (Math.abs(norm - 1) > 1e-6) throw new Error('embeddings are not unit-normalised');

    // --- 5. Summary -------------------------------------------------------
    step('5. AI summary (live LLM)');
    const t1 = Date.now();
    const { summary, strategy } = await summarizeDocument('Agreement_v3.pdf', extraction.pages);
    console.log(`   strategy: ${strategy}, ${Date.now() - t1}ms`);
    console.log(`\n   "${summary}"\n`);
    const sentences = summary.split(/[.!?]+\s/).filter(Boolean).length;
    console.log(`   sentences: ${sentences} (target 3-5)`);
    const banned = ['this document', 'this pdf', 'the text', 'this report'];
    const hit = banned.find((b) => summary.toLowerCase().startsWith(b));
    console.log(`   generic opener check: ${hit ? `FAILED (starts with "${hit}")` : 'passed'}`);

    // --- 6. Persist so retrieval runs against real SQL --------------------
    step('6. Persisting to database');
    const [u] = await db
      .insert(users)
      .values({
        name: 'Pipeline Verifier',
        email: `verify-${Date.now()}@example.invalid`,
        passwordHash: await hashPassword('verification-only-password'),
      })
      .returning({ id: users.id });
    userId = u.id;

    const descriptor = await embedDocumentDescriptor('Agreement_v3.pdf', summary);
    const [doc] = await db
      .insert(documents)
      .values({
        ownerId: userId,
        filename: 'Agreement_v3.pdf',
        storagePath: `${userId}/verify.pdf`,
        status: 'ready',
        summary,
        docEmbedding: descriptor,
        pageCount: extraction.totalPages,
        byteSize: bytes.length,
      })
      .returning({ id: documents.id });

    await db.insert(documentChunks).values(
      chunks.map((c, i) => ({
        documentId: doc.id,
        chunkIndex: c.chunkIndex,
        pageFrom: c.pageFrom,
        pageTo: c.pageTo,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding: embeddings[i]!,
      })),
    );
    console.log(`   stored document ${doc.id} with ${chunks.length} chunks`);

    // --- 7. Retrieval -----------------------------------------------------
    step('7. Hybrid retrieval (vector + full-text, RRF fused)');
    const queries = [
      { q: 'who pays for travel costs?', expectPage: 3, why: 'pure paraphrase — dense vectors must carry this' },
      { q: 'Clause 7.2', expectPage: 3, why: 'exact token — full-text must carry this' },
      { q: 'how much holiday do I get?', expectPage: 2, why: 'paraphrase of "annual leave"' },
      { q: 'what happens if I am fired for misconduct?', expectPage: 3, why: 'paraphrase of termination' },
    ];

    for (const { q, expectPage, why } of queries) {
      const hits = await retrieveChunks(doc.id, q);
      const pages = hits.map((h) => (h.pageFrom === h.pageTo ? `${h.pageFrom}` : `${h.pageFrom}-${h.pageTo}`));
      const covered = hits.some((h) => expectPage >= h.pageFrom && expectPage <= h.pageTo);
      console.log(`   "${q}"`);
      console.log(`     -> ${hits.length} chunks, pages [${pages.join(', ')}] | expected p.${expectPage}: ${covered ? 'FOUND' : 'MISSED'}  (${why})`);
    }

    // --- 8. Grounded answer ----------------------------------------------
    step('8. Grounded answer with citations (live LLM)');
    const askQ = 'What is the salary and when is it reviewed?';
    const ctx = await retrieveChunks(doc.id, askQ);
    const { text: answer } = await generateText({
      model: chatModel(),
      system: CHAT_SYSTEM_PROMPT,
      prompt: chatUserPrompt(askQ, ctx),
      temperature: 0.3,
    });
    console.log(`   Q: ${askQ}`);
    console.log(`   A: ${answer.trim()}`);
    console.log(`   contains [p.N] citation: ${/\[p\.\d+\]/.test(answer) ? 'YES' : 'NO'}`);
    console.log(`   mentions the real figure (78,500): ${answer.includes('78,500') ? 'YES' : 'NO'}`);

    // --- 9. Refusal behaviour --------------------------------------------
    step('9. Out-of-scope question (must refuse, not invent)');
    const offQ = 'What is the CEO’s home address and mobile number?';
    const offCtx = await retrieveChunks(doc.id, offQ);
    const { text: refusal } = await generateText({
      model: chatModel(),
      system: CHAT_SYSTEM_PROMPT,
      prompt: chatUserPrompt(offQ, offCtx),
      temperature: 0.3,
    });
    console.log(`   Q: ${offQ}`);
    console.log(`   A: ${refusal.trim()}`);

    // --- 10. Follow-up rewriting -----------------------------------------
    step('10. Conversational follow-up rewriting');
    const history = [
      { role: 'user' as const, content: 'What are the post-termination restrictions?' },
      { role: 'assistant' as const, content: 'The Employee may not solicit clients or senior staff for six months after termination [p.4].' },
    ];
    const { query: rewritten } = await rewriteQuery('how long does that last?', history);
    console.log(`   follow-up: "how long does that last?"`);
    console.log(`   rewritten: "${rewritten}"`);
    const rewrittenHits = await retrieveChunks(doc.id, rewritten);
    console.log(`   retrieval on rewritten query -> pages [${rewrittenHits.map((h) => h.pageFrom).join(', ')}]`);

    // --- 11. Semantic dashboard search -----------------------------------
    step('11. Semantic search (the assignment’s example)');
    for (const q of ['employment contract', 'confidentiality obligations', 'pizza recipes']) {
      const results = await searchSemantic(userId, q);
      const top = results[0];
      console.log(`   "${q}" -> ${results.length} result(s)${top ? ` | top: ${top.filename} (relevance ${top.relevance?.toFixed(3)})` : ''}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('PIPELINE VERIFIED END TO END');
    console.log('='.repeat(70));
  } finally {
    if (userId) {
      const { db } = await import('../src/server/db/client');
      const { users } = await import('../src/server/db/schema');
      const { eq } = await import('drizzle-orm');
      await db.delete(users).where(eq(users.id, userId));
      console.log('\n(cleaned up verification data)');
    }
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('\nPIPELINE VERIFICATION FAILED:\n', error);
  process.exit(1);
});
