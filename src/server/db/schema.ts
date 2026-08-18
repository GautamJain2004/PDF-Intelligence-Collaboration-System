import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  index,
  uniqueIndex,
  vector,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * Embedding width.
 *
 * gemini-embedding-001 emits 3072 dimensions by default, but pgvector's HNSW
 * index rejects anything above 2000. We request 768 via `outputDimensionality`,
 * which keeps the index available and the table small. Vectors are L2-normalised
 * before insert (Google does not normalise truncated outputs), so cosine
 * distance behaves correctly.
 */
export const EMBEDDING_DIMENSIONS = 768;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const documentStatusEnum = pgEnum('document_status', [
  'uploading',
  'processing',
  'ready',
  'failed',
]);

/** viewer = read-only; commenter = may also post comments. */
export const shareRoleEnum = pgEnum('share_role', ['viewer', 'commenter']);

export const chatRoleEnum = pgEnum('chat_role', ['user', 'assistant']);

// ---------------------------------------------------------------------------
// Users & authentication
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Stored lowercased; uniqueness is therefore case-insensitive. */
    email: text('email').notNull(),
    /** Argon2id hash. Plaintext passwords are never persisted or logged. */
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

/**
 * Opaque server-side sessions.
 *
 * Only the SHA-256 hash of the session token is stored, so a database leak does
 * not hand an attacker usable cookies. Server-side storage (rather than a
 * stateless JWT) buys immediate revocation on logout and password reset.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_reset_tokens_hash_unique').on(t.tokenHash),
    index('password_reset_tokens_user_id_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Original filename, sanitised. Display only — never used as a storage path. */
    filename: text('filename').notNull(),
    /** Opaque object key inside the private Supabase Storage bucket. */
    storagePath: text('storage_path').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
    pageCount: integer('page_count'),

    status: documentStatusEnum('status').notNull().default('uploading'),
    /** Operator-facing failure reason; surfaced to the owner in a friendly form. */
    error: text('error'),

    /** 3-5 sentence AI summary, shown on the dashboard card and viewer header. */
    summary: text('summary'),
    /** Embedding of (filename + summary); powers semantic dashboard search. */
    docEmbedding: vector('doc_embedding', { dimensions: EMBEDDING_DIMENSIONS }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_owner_created_idx').on(t.ownerId, t.createdAt.desc()),
    index('documents_status_idx').on(t.status),
    // Semantic dashboard search: nearest-neighbour over per-document embeddings.
    index('documents_doc_embedding_hnsw')
      .using('hnsw', t.docEmbedding.op('vector_cosine_ops')),
    // Trigram index backing fast case-insensitive filename substring search.
    index('documents_filename_trgm')
      .using('gin', sql`lower(${t.filename}) gin_trgm_ops`),
  ],
);

/**
 * Retrieval units for RAG. One row per chunk, with page provenance so answers
 * can cite `[p.N]` and the viewer can jump straight to the source page.
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    pageFrom: integer('page_from').notNull(),
    pageTo: integer('page_to').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('document_chunks_doc_index_unique').on(t.documentId, t.chunkIndex),
    index('document_chunks_document_id_idx').on(t.documentId),
    // Approximate nearest-neighbour index for RAG retrieval. Cosine ops match
    // the normalised embeddings we store.
    index('document_chunks_embedding_hnsw')
      .using('hnsw', t.embedding.op('vector_cosine_ops')),
    // Lexical half of hybrid retrieval: catches exact terms (names, clause
    // numbers, figures) that dense vectors routinely miss.
    index('document_chunks_content_fts')
      .using('gin', sql`to_tsvector('english', ${t.content})`),
  ],
);

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/**
 * A share grant.
 *
 * `invitedEmail IS NULL` -> open link, anyone holding the token may open it.
 * `invitedEmail IS NOT NULL` -> emailed invitation (the token still authorises;
 * the email is recorded for attribution and notification).
 *
 * Only the token hash is stored: the plaintext token exists exactly once, in the
 * link handed to the sharer.
 */
export const documentShares = pgTable(
  'document_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    invitedEmail: text('invited_email'),
    role: shareRoleEnum('role').notNull().default('commenter'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('document_shares_token_hash_unique').on(t.tokenHash),
    index('document_shares_document_id_idx').on(t.documentId),
  ],
);

/**
 * Identity for an account-less visitor who opened a share link and supplied a
 * display name. Scoped to a single share, so the resulting cookie grants access
 * to exactly one document and is not an application session.
 */
export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareId: uuid('share_id')
      .notNull()
      .references(() => documentShares.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('guest_sessions_token_hash_unique').on(t.tokenHash),
    index('guest_sessions_share_id_idx').on(t.shareId),
  ],
);

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * Threaded comments. `parentId` gives one level of replies in the UI; the schema
 * itself permits arbitrary depth.
 *
 * An author is either a registered user or a guest, never both and never
 * neither — enforced by a CHECK constraint so the invariant cannot be violated
 * by any code path.
 */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // Self-reference needs an explicit return type to break the circularity.
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),

    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    authorGuestId: uuid('author_guest_id').references(() => guestSessions.id, {
      onDelete: 'cascade',
    }),
    /** Denormalised for display so deleted guest sessions keep attribution. */
    authorName: text('author_name').notNull(),

    /** Sanitised HTML (bold/italic/lists only). Sanitisation happens server-side. */
    bodyHtml: text('body_html').notNull(),
    /** Plaintext projection, used for search and notification previews. */
    bodyText: text('body_text').notNull(),

    pageNumber: integer('page_number'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete keeps thread structure intact when a parent is removed. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('comments_document_created_idx').on(t.documentId, t.createdAt),
    index('comments_parent_id_idx').on(t.parentId),
    check(
      'comments_single_author',
      sql`(${t.authorUserId} IS NOT NULL AND ${t.authorGuestId} IS NULL)
       OR (${t.authorUserId} IS NULL AND ${t.authorGuestId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/**
 * Per-actor chat transcript for a document.
 *
 * Conversations are private to the actor who created them: an owner never sees a
 * guest's questions and vice versa. The last few turns are replayed to the model
 * so follow-up questions resolve.
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    actorGuestId: uuid('actor_guest_id').references(() => guestSessions.id, {
      onDelete: 'cascade',
    }),
    role: chatRoleEnum('role').notNull(),
    content: text('content').notNull(),
    /** `[{ chunkId, pageFrom, pageTo }]` backing an assistant answer. */
    citations: text('citations'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chat_messages_doc_user_idx').on(t.documentId, t.actorUserId, t.createdAt),
    index('chat_messages_doc_guest_idx').on(t.documentId, t.actorGuestId, t.createdAt),
    check(
      'chat_messages_single_actor',
      sql`(${t.actorUserId} IS NOT NULL AND ${t.actorGuestId} IS NULL)
       OR (${t.actorUserId} IS NULL AND ${t.actorGuestId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  documents: many(documents),
  sessions: many(sessions),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  owner: one(users, { fields: [documents.ownerId], references: [users.id] }),
  chunks: many(documentChunks),
  shares: many(documentShares),
  comments: many(comments),
  chatMessages: many(chatMessages),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

export const documentSharesRelations = relations(documentShares, ({ one, many }) => ({
  document: one(documents, {
    fields: [documentShares.documentId],
    references: [documents.id],
  }),
  guestSessions: many(guestSessions),
}));

export const guestSessionsRelations = relations(guestSessions, ({ one }) => ({
  share: one(documentShares, {
    fields: [guestSessions.shareId],
    references: [documentShares.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  document: one(documents, {
    fields: [comments.documentId],
    references: [documents.id],
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: 'comment_thread',
  }),
  replies: many(comments, { relationName: 'comment_thread' }),
  authorUser: one(users, {
    fields: [comments.authorUserId],
    references: [users.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type DocumentShare = typeof documentShares.$inferSelect;
export type GuestSession = typeof guestSessions.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type DocumentStatus = (typeof documentStatusEnum.enumValues)[number];
export type ShareRole = (typeof shareRoleEnum.enumValues)[number];
