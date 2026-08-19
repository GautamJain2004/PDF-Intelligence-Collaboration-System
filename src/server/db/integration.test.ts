import { beforeAll, afterAll, describe, expect, it } from 'vitest';

/**
 * Database integration tests.
 *
 * These run against a real Postgres with pgvector — the unit tests cover pure
 * logic, but the parts most likely to break in production are the SQL itself,
 * the CHECK constraints, and the cascade behaviour. Those cannot be verified
 * with mocks.
 *
 * Skipped automatically unless TEST_DATABASE_URL is set, so `npm test` stays
 * green on a machine with no database. See README for the one-line Docker
 * command that provides one.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;

// Env must be populated before any module reads it.
if (TEST_DB) {
  process.env.DATABASE_URL = TEST_DB;
  process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';
  process.env.OPENAI_API_KEY ??= 'test-openai-key';
  process.env.APP_URL ??= 'http://localhost:3000';
}

type Modules = {
  db: typeof import('./client')['db'];
  schema: typeof import('./schema');
  shares: typeof import('../documents/shares');
  comments: typeof import('../comments/queries');
  documents: typeof import('../documents/queries');
  password: typeof import('../auth/password');
  sql: typeof import('drizzle-orm')['sql'];
  eq: typeof import('drizzle-orm')['eq'];
};

let m: Modules;

/** Random suffix so repeated runs never collide on the unique email index. */
const run = Math.random().toString(36).slice(2, 10);

const ids = {
  owner: '',
  otherUser: '',
  document: '',
  otherDocument: '',
};

describe.skipIf(!TEST_DB)('database integration', () => {
  beforeAll(async () => {
    const drizzle = await import('drizzle-orm');
    m = {
      db: (await import('./client')).db,
      schema: await import('./schema'),
      shares: await import('../documents/shares'),
      comments: await import('../comments/queries'),
      documents: await import('../documents/queries'),
      password: await import('../auth/password'),
      sql: drizzle.sql,
      eq: drizzle.eq,
    };

    const [owner] = await m.db
      .insert(m.schema.users)
      .values({
        name: 'Owner User',
        email: `owner-${run}@example.test`,
        passwordHash: await m.password.hashPassword('correct-horse-battery'),
      })
      .returning({ id: m.schema.users.id });
    ids.owner = owner.id;

    const [other] = await m.db
      .insert(m.schema.users)
      .values({
        name: 'Other User',
        email: `other-${run}@example.test`,
        passwordHash: await m.password.hashPassword('another-password-here'),
      })
      .returning({ id: m.schema.users.id });
    ids.otherUser = other.id;

    const [doc] = await m.db
      .insert(m.schema.documents)
      .values({
        ownerId: ids.owner,
        filename: 'Employment_Agreement_v3.pdf',
        storagePath: `${ids.owner}/test.pdf`,
        status: 'ready',
        summary: 'An employment agreement between Acme Corp and a senior engineer.',
        pageCount: 12,
        byteSize: 123456,
      })
      .returning({ id: m.schema.documents.id });
    ids.document = doc.id;

    const [otherDoc] = await m.db
      .insert(m.schema.documents)
      .values({
        ownerId: ids.otherUser,
        filename: 'Someone_Elses_File.pdf',
        storagePath: `${ids.otherUser}/test.pdf`,
        status: 'ready',
      })
      .returning({ id: m.schema.documents.id });
    ids.otherDocument = otherDoc.id;
  });

  afterAll(async () => {
    if (!m?.db) return;
    // Cascades clean up everything else.
    await m.db
      .delete(m.schema.users)
      .where(m.sql`${m.schema.users.id} IN (${ids.owner}::uuid, ${ids.otherUser}::uuid)`);
  });

  // -------------------------------------------------------------------------
  describe('password hashing', () => {
    it('verifies a correct password and rejects a wrong one', async () => {
      const hash = await m.password.hashPassword('my-secret-password');

      expect(hash).not.toContain('my-secret-password');
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(await m.password.verifyPassword(hash, 'my-secret-password')).toBe(true);
      expect(await m.password.verifyPassword(hash, 'wrong-password')).toBe(false);
    });

    it('salts each hash so identical passwords differ', async () => {
      const a = await m.password.hashPassword('same-password');
      const b = await m.password.hashPassword('same-password');
      expect(a).not.toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  describe('document listing scopes to the owner', () => {
    it('returns only the caller documents', async () => {
      const owned = await m.documents.listDocuments(ids.owner);
      expect(owned.documents.map((d) => d.id)).toContain(ids.document);
      expect(owned.documents.map((d) => d.id)).not.toContain(ids.otherDocument);
      // The total counts every match, not just the rows on this page.
      expect(owned.total).toBeGreaterThanOrEqual(owned.documents.length);
    });

    it('pages without losing or repeating rows', async () => {
      const first = await m.documents.listDocuments(ids.owner, { limit: 1, offset: 0 });
      const second = await m.documents.listDocuments(ids.owner, { limit: 1, offset: 1 });

      expect(first.documents).toHaveLength(1);
      // Both pages report the same total; only the window moves.
      expect(second.total).toBe(first.total);
      if (second.documents.length > 0) {
        expect(second.documents[0]!.id).not.toBe(first.documents[0]!.id);
      }
    });

    it('filters by filename case-insensitively', async () => {
      const hits = await m.documents.searchByFilename(ids.owner, 'employment');
      expect(hits.documents.map((d) => d.id)).toContain(ids.document);

      const misses = await m.documents.searchByFilename(ids.owner, 'nonexistent-xyz');
      expect(misses.documents).toHaveLength(0);
      expect(misses.total).toBe(0);
    });

    it('does not leak another users document through search', async () => {
      const hits = await m.documents.searchByFilename(ids.owner, 'Someone_Elses');
      expect(hits).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('share links', () => {
    it('creates a resolvable share and hides the raw token', async () => {
      const share = await m.shares.createShare({
        documentId: ids.document,
        createdBy: ids.owner,
        role: 'commenter',
      });

      expect(share.url).toContain('/s/');

      const token = share.url.split('/s/')[1]!;
      const resolved = await m.shares.resolveShareToken(token);

      expect(resolved).not.toBeNull();
      expect(resolved!.documentId).toBe(ids.document);
      expect(resolved!.role).toBe('commenter');

      // Neither the plaintext token nor a reversible copy is stored in the clear.
      const [stored] = await m.db
        .select()
        .from(m.schema.documentShares)
        .where(m.eq(m.schema.documentShares.id, share.id));

      expect(stored.tokenHash).not.toBe(token);
      expect(stored.tokenEncrypted).not.toContain(token);
    });

    it('recovers the link for redisplay via decryption', async () => {
      const created = await m.shares.createShare({
        documentId: ids.document,
        createdBy: ids.owner,
        role: 'viewer',
      });

      const listed = await m.shares.listShares(ids.document);
      const found = listed.find((s) => s.id === created.id);

      expect(found?.url).toBe(created.url);
    });

    it('rejects an unknown token', async () => {
      expect(await m.shares.resolveShareToken('not-a-real-token')).toBeNull();
    });

    it('stops resolving once revoked', async () => {
      const share = await m.shares.createShare({
        documentId: ids.document,
        createdBy: ids.owner,
        role: 'commenter',
      });
      const token = share.url.split('/s/')[1]!;

      expect(await m.shares.resolveShareToken(token)).not.toBeNull();

      await m.shares.revokeShare(share.id, ids.document);

      expect(await m.shares.resolveShareToken(token)).toBeNull();
    });

    it('refuses to revoke a share belonging to a different document', async () => {
      const share = await m.shares.createShare({
        documentId: ids.document,
        createdBy: ids.owner,
        role: 'commenter',
      });

      const revoked = await m.shares.revokeShare(share.id, ids.otherDocument);
      expect(revoked).toBe(false);

      // Still works, because the mismatched revoke was refused.
      const token = share.url.split('/s/')[1]!;
      expect(await m.shares.resolveShareToken(token)).not.toBeNull();
    });

    it('stops resolving an expired share', async () => {
      const share = await m.shares.createShare({
        documentId: ids.document,
        createdBy: ids.owner,
        role: 'commenter',
      });
      const token = share.url.split('/s/')[1]!;

      await m.db
        .update(m.schema.documentShares)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(m.eq(m.schema.documentShares.id, share.id));

      expect(await m.shares.resolveShareToken(token)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('comments', () => {
    it('enforces the single-author CHECK constraint', async () => {
      // Both author columns set — must be rejected by the database itself.
      await expect(
        m.db.insert(m.schema.comments).values({
          documentId: ids.document,
          authorUserId: ids.owner,
          authorGuestId: ids.owner, // nonsense on purpose
          authorName: 'Bad',
          bodyHtml: '<p>x</p>',
          bodyText: 'x',
        }),
      ).rejects.toThrow();

      // Neither column set — also rejected.
      await expect(
        m.db.insert(m.schema.comments).values({
          documentId: ids.document,
          authorName: 'Bad',
          bodyHtml: '<p>x</p>',
          bodyText: 'x',
        }),
      ).rejects.toThrow();
    });

    it('builds a nested thread', async () => {
      const parent = await m.comments.createComment({
        documentId: ids.document,
        parentId: null,
        authorUserId: ids.owner,
        authorGuestId: null,
        authorName: 'Owner User',
        bodyHtml: '<p>Top level</p>',
        bodyText: 'Top level',
        pageNumber: 3,
      });

      await m.comments.createComment({
        documentId: ids.document,
        parentId: parent.id,
        authorUserId: ids.owner,
        authorGuestId: null,
        authorName: 'Owner User',
        bodyHtml: '<p>A reply</p>',
        bodyText: 'A reply',
        pageNumber: null,
      });

      const tree = await m.comments.listComments(
        ids.document,
        { kind: 'user', userId: ids.owner },
        ids.owner,
      );

      const node = tree.find((c) => c.id === parent.id);
      expect(node).toBeDefined();
      expect(node!.replies).toHaveLength(1);
      expect(node!.replies[0]!.bodyHtml).toContain('A reply');
      expect(node!.isOwner).toBe(true);
      expect(node!.isMine).toBe(true);
    });

    it('marks another user comment as not mine', async () => {
      const tree = await m.comments.listComments(
        ids.document,
        { kind: 'user', userId: ids.otherUser },
        ids.owner,
      );
      expect(tree.every((c) => c.isMine === false)).toBe(true);
    });

    it('refuses to delete a comment the caller did not write', async () => {
      const comment = await m.comments.createComment({
        documentId: ids.document,
        parentId: null,
        authorUserId: ids.owner,
        authorGuestId: null,
        authorName: 'Owner User',
        bodyHtml: '<p>Mine</p>',
        bodyText: 'Mine',
        pageNumber: null,
      });

      const wrongUser = await m.comments.deleteOwnComment(comment.id, ids.document, {
        kind: 'user',
        userId: ids.otherUser,
      });
      expect(wrongUser).toBe(false);

      const rightUser = await m.comments.deleteOwnComment(comment.id, ids.document, {
        kind: 'user',
        userId: ids.owner,
      });
      expect(rightUser).toBe(true);
    });

    it('scrubs the body when soft-deleting', async () => {
      const comment = await m.comments.createComment({
        documentId: ids.document,
        parentId: null,
        authorUserId: ids.owner,
        authorGuestId: null,
        authorName: 'Owner User',
        bodyHtml: '<p>secret content</p>',
        bodyText: 'secret content',
        pageNumber: null,
      });

      await m.comments.deleteOwnComment(comment.id, ids.document, {
        kind: 'user',
        userId: ids.owner,
      });

      const [row] = await m.db
        .select()
        .from(m.schema.comments)
        .where(m.eq(m.schema.comments.id, comment.id));

      expect(row.deletedAt).not.toBeNull();
      expect(row.bodyHtml).toBe('');
      expect(row.bodyText).toBe('');
    });

    it('rejects a reply targeting a different document', async () => {
      const foreign = await m.comments.createComment({
        documentId: ids.otherDocument,
        parentId: null,
        authorUserId: ids.otherUser,
        authorGuestId: null,
        authorName: 'Other User',
        bodyHtml: '<p>elsewhere</p>',
        bodyText: 'elsewhere',
        pageNumber: null,
      });

      expect(await m.comments.parentBelongsToDocument(foreign.id, ids.document)).toBe(false);
      expect(await m.comments.parentBelongsToDocument(foreign.id, ids.otherDocument)).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('pgvector retrieval SQL', () => {
    const dim = 768;

    /** Deterministic unit vector, mimicking a normalised embedding. */
    function vector(seed: number): number[] {
      const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1)));
      const magnitude = Math.hypot(...raw);
      return raw.map((v) => v / magnitude);
    }

    beforeAll(async () => {
      await m.db.insert(m.schema.documentChunks).values([
        {
          documentId: ids.document,
          chunkIndex: 0,
          pageFrom: 1,
          pageTo: 1,
          content:
            'The Employee shall receive an annual salary of 120,000 USD payable monthly.',
          tokenCount: 20,
          embedding: vector(1),
        },
        {
          documentId: ids.document,
          chunkIndex: 1,
          pageFrom: 2,
          pageTo: 2,
          content:
            'Either party may terminate this agreement with thirty days written notice.',
          tokenCount: 18,
          embedding: vector(2),
        },
        {
          documentId: ids.document,
          chunkIndex: 2,
          pageFrom: 3,
          pageTo: 4,
          content: 'Confidential information must not be disclosed to third parties.',
          tokenCount: 15,
          embedding: vector(3),
        },
      ]);
    });

    it('runs cosine nearest-neighbour search and ranks the closest chunk first', async () => {
      const probe = `[${vector(2).join(',')}]`;

      const rows = (await m.db.execute(m.sql`
        SELECT chunk_index, 1 - (embedding <=> ${probe}::vector) AS similarity
        FROM document_chunks
        WHERE document_id = ${ids.document}::uuid AND embedding IS NOT NULL
        ORDER BY embedding <=> ${probe}::vector
        LIMIT 3
      `)) as unknown as Array<{ chunk_index: number; similarity: number }>;

      expect(rows).toHaveLength(3);
      // Probing with chunk 1's own vector must return chunk 1 first.
      expect(Number(rows[0]!.chunk_index)).toBe(1);
      expect(Number(rows[0]!.similarity)).toBeCloseTo(1, 5);
    });

    it('runs websearch full-text search', async () => {
      const rows = (await m.db.execute(m.sql`
        WITH q AS (SELECT websearch_to_tsquery('english', ${'terminate notice'}) AS tsq)
        SELECT chunk_index
        FROM document_chunks, q
        WHERE document_id = ${ids.document}::uuid
          AND to_tsvector('english', content) @@ q.tsq
        ORDER BY ts_rank_cd(to_tsvector('english', content), q.tsq) DESC
      `)) as unknown as Array<{ chunk_index: number }>;

      expect(rows.length).toBeGreaterThan(0);
      expect(Number(rows[0]!.chunk_index)).toBe(1);
    });

    it('survives punctuation that would break plainto_tsquery', async () => {
      const rows = (await m.db.execute(m.sql`
        WITH q AS (SELECT websearch_to_tsquery('english', ${'what about "salary"? & termination!'}) AS tsq)
        SELECT chunk_index
        FROM document_chunks, q
        WHERE document_id = ${ids.document}::uuid
          AND to_tsvector('english', content) @@ q.tsq
      `)) as unknown as Array<{ chunk_index: number }>;

      expect(Array.isArray(rows)).toBe(true);
    });

    it('scopes retrieval to a single document', async () => {
      const probe = `[${vector(1).join(',')}]`;

      // The WHERE clause is what enforces scoping; a nearest-neighbour search
      // against the other document must return nothing at all.
      const rows = (await m.db.execute(m.sql`
        SELECT id
        FROM document_chunks
        WHERE document_id = ${ids.otherDocument}::uuid AND embedding IS NOT NULL
        ORDER BY embedding <=> ${probe}::vector
        LIMIT 10
      `)) as unknown as Array<{ id: string }>;

      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('cascade deletes', () => {
    it('removes chunks, shares, and comments when a document is deleted', async () => {
      const [doc] = await m.db
        .insert(m.schema.documents)
        .values({
          ownerId: ids.owner,
          filename: 'Disposable.pdf',
          storagePath: `${ids.owner}/disposable.pdf`,
          status: 'ready',
        })
        .returning({ id: m.schema.documents.id });

      await m.db.insert(m.schema.documentChunks).values({
        documentId: doc.id,
        chunkIndex: 0,
        pageFrom: 1,
        pageTo: 1,
        content: 'temp',
        tokenCount: 1,
      });

      await m.shares.createShare({
        documentId: doc.id,
        createdBy: ids.owner,
        role: 'commenter',
      });

      await m.comments.createComment({
        documentId: doc.id,
        parentId: null,
        authorUserId: ids.owner,
        authorGuestId: null,
        authorName: 'Owner User',
        bodyHtml: '<p>temp</p>',
        bodyText: 'temp',
        pageNumber: null,
      });

      await m.db
        .delete(m.schema.documents)
        .where(m.eq(m.schema.documents.id, doc.id));

      const counts = (await m.db.execute(m.sql`
        SELECT
          (SELECT count(*) FROM document_chunks WHERE document_id = ${doc.id}::uuid) AS chunks,
          (SELECT count(*) FROM document_shares WHERE document_id = ${doc.id}::uuid) AS shares,
          (SELECT count(*) FROM comments WHERE document_id = ${doc.id}::uuid) AS comments
      `)) as unknown as Array<{ chunks: string; shares: string; comments: string }>;

      expect(Number(counts[0]!.chunks)).toBe(0);
      expect(Number(counts[0]!.shares)).toBe(0);
      expect(Number(counts[0]!.comments)).toBe(0);
    });
  });
});
