# PDF Intelligence & Collaboration System

Upload a PDF, get an AI summary worth reading, ask questions answered from the
document's actual text with page citations, and share it with people who never
have to create an account.

**Live demo:** _pending deployment — see [Deployment](#deployment)_

---

## Contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Database setup and migrations](#database-setup-and-migrations)
- [Local development](#local-development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [The AI pipeline](#the-ai-pipeline)
  - [Summaries](#summaries)
  - [Chunking](#chunking)
  - [Retrieval](#retrieval)
  - [Chat](#chat)
  - [Prompt design](#prompt-design)
- [Access control model](#access-control-model)
- [Security](#security)
- [Known limitations and trade-offs](#known-limitations-and-trade-offs)

---

## What it does

**Must-have features — all implemented**

| # | Feature | Where |
|---|---------|-------|
| 1 | Signup / login, Argon2id-hashed passwords | `src/server/auth/`, `src/app/api/auth/` |
| 2 | PDF upload with server-side format validation | `src/app/api/uploads/`, `src/server/pdf/validate.ts` |
| 3 | Dashboard: list, search, summary on each card | `src/app/(app)/dashboard/` |
| 4 | Share links with unguessable tokens | `src/server/documents/shares.ts` |
| 5 | Invited users read + comment without an account | `src/app/s/[token]/` |
| 6 | Automatic AI summary on upload | `src/server/ai/summarize.ts` |
| 7 | RAG chat with conversation memory | `src/server/ai/retrieve.ts`, `src/app/api/documents/[id]/chat/` |
| 8 | Authorization on every resource, hashed secrets | `src/server/auth/access.ts` |
| 9 | Responsive three-pane UI | `src/components/viewer/` |

**Good-to-have features — all five implemented**

- **Streaming AI responses** — answers stream token-by-token; citations arrive
  in a preamble so page chips render before the text finishes.
- **Semantic PDF search** — dashboard search by meaning. Searching
  "employment terms" finds `Agreement_v3.pdf` from its summary embedding.
- **Threaded comments** — replies, with bold / italic / bullet / numbered lists.
- **Email notification on share** — Resend, degrading gracefully when unset.
- **Password reset** — single-use expiring tokens; resetting kills all sessions.

---

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router), TypeScript | One deployable; Route Handlers keep API keys server-side by construction |
| Styling | Tailwind CSS, Radix primitives | Responsive without a component-library detour |
| Database | Postgres + `pgvector` (Supabase) | Relational data and the vector index in one place |
| ORM | Drizzle + drizzle-kit | Native `vector` column support; SQL-shaped; tiny cold start |
| Storage | Supabase Storage (private bucket) | Signed upload/read URLs; objects never publicly addressable |
| Auth | Custom: Argon2id + opaque DB sessions | Revocable server-side; no JWT-in-localStorage |
| PDF text | `unpdf` | Serverless-native pdf.js; `pdf-parse` breaks on Vercel |
| PDF viewer | `react-pdf` | Page navigation, so citations can deep-link |
| LLM | Google Gemini via Vercel AI SDK | Only major provider with a free tier for **both** chat and embeddings |
| Editor | Tiptap | Constrained to exactly the allowed formatting |
| Email | Resend | Free tier; optional |

---

## Quick start

```bash
git clone <repo-url>
cd spotdraft
npm install

cp .env.example .env.local     # then fill in the values

npm run db:migrate             # create tables, indexes, extensions
npm run dev                    # http://localhost:3000
```

You need three things, all free:

1. **Supabase project** — [supabase.com](https://supabase.com) → New project.
   Copy the pooler connection strings and the service-role key. Create a
   **private** bucket named `pdfs` (Storage → New bucket → Public **off**).
2. **Gemini API key** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
3. **An `AUTH_SECRET`** — `openssl rand -base64 48`.

---

## Environment variables

Every variable is server-side only; none is `NEXT_PUBLIC_`, so no secret can
reach the browser. See [`.env.example`](./.env.example) for the annotated
template.

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `DATABASE_URL` | ✅ | Postgres via **transaction pooler** (port 6543) |
| `DIRECT_URL` | ✅ | Direct connection (port 5432) for migrations |
| `AUTH_SECRET` | ✅ | Pepper for token hashes + share-token encryption key (≥32 chars) |
| `SUPABASE_URL` | ✅ | Storage endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-side storage access |
| `SUPABASE_STORAGE_BUCKET` | — | Defaults to `pdfs` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | ✅ | Summaries, chat, embeddings |
| `GEMINI_CHAT_MODEL` | — | Default `gemini-2.5-flash` |
| `GEMINI_FAST_MODEL` | — | Default `gemini-2.5-flash-lite` |
| `GEMINI_EMBEDDING_MODEL` | — | Default `gemini-embedding-001` |
| `APP_URL` | ✅ | Absolute origin for share and reset links |
| `RESEND_API_KEY` | — | Enables share-notification email |
| `EMAIL_FROM` | — | Sender identity |
| `TEST_DATABASE_URL` | — | Enables DB integration tests |

Validation is centralised in [`src/lib/env.ts`](./src/lib/env.ts) with Zod, and
fails on first use listing **everything** missing at once — not one variable per
restart.

---

## Database setup and migrations

Migrations live in [`drizzle/`](./drizzle) and are generated from
[`src/server/db/schema.ts`](./src/server/db/schema.ts).

```bash
npm run db:generate   # schema.ts changed → new SQL migration
npm run db:migrate    # apply pending migrations (uses DIRECT_URL)
npm run db:studio     # browse data
```

`0000_init.sql` begins with `CREATE EXTENSION` for `vector` and `pg_trgm`.
drizzle-kit does not emit extension DDL, so those two lines are a **deliberate
manual addition** — preserve them if you regenerate.

**Tables:** `users`, `sessions`, `password_reset_tokens`, `documents`,
`document_chunks`, `document_shares`, `guest_sessions`, `comments`,
`chat_messages`.

Indexes worth noting:

- `HNSW (embedding vector_cosine_ops)` on `document_chunks` — ANN retrieval.
- `HNSW (doc_embedding vector_cosine_ops)` on `documents` — semantic search.
- `GIN to_tsvector('english', content)` — lexical half of hybrid retrieval.
- `GIN lower(filename) gin_trgm_ops` — fast filename substring search.

Two `CHECK` constraints enforce that a comment and a chat message each have
**exactly one** author (registered user XOR guest) — an invariant no code path
can violate.

---

## Local development

```bash
npm run dev         # dev server
npm run build       # production build (fails on type or lint errors)
npm run typecheck   # tsc --noEmit
npm run lint
```

### Running without Supabase

The database layer works against any Postgres with `pgvector`:

```bash
docker run -d --name pdfiq-db \
  -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=pdfiq \
  -p 55432:5432 pgvector/pgvector:pg17

# .env.local
DATABASE_URL=postgresql://postgres:testpass@localhost:55432/pdfiq
DIRECT_URL=postgresql://postgres:testpass@localhost:55432/pdfiq
```

Auth, sharing, comments, and access control all work this way. Upload and the
AI features still need Supabase Storage and a Gemini key.

---

## Testing

```bash
npm test                                   # unit tests
TEST_DATABASE_URL=postgresql://... npm test   # + DB integration tests
```

**68 tests.** The DB suite is skipped, not failed, when `TEST_DATABASE_URL` is
unset.

| Suite | Covers |
|-------|--------|
| `pdf/chunk.test.ts` | Token budgets, page provenance, overlap, no content loss, text cleaning |
| `comments/sanitize.test.ts` | XSS: scripts, `onerror`, `javascript:` URLs, SVG namespace confusion |
| `ai/retrieve.test.ts` | RRF ranking, deduplication, vector normalisation |
| `auth/crypto.test.ts` | Token entropy, hash stability, AES-GCM round-trip, tamper detection |
| `db/integration.test.ts` | Argon2 verification, ownership scoping, share lifecycle, `CHECK` constraints, threading, pgvector cosine + FTS queries, cascade deletes |

The sanitiser tests earned their keep: they caught that DOMPurify's
`USE_PROFILES` **replaces** `ALLOWED_TAGS` rather than intersecting with it,
which was silently letting `<img>` and `<a>` through the allowlist.

### Verified end-to-end against a running server

Cross-user authorization was exercised over real HTTP: a second account
attempting to read, comment on, share, delete, download, or chat with another
user's document receives `404` on every endpoint, and the document survives.
Read-only shares get `403` on comment. Revoking a link cuts off a guest who
already holds a cookie on their **next request**.

---

## Deployment

### Vercel + Supabase

1. **Supabase:** create a project; run `npm run db:migrate` against `DIRECT_URL`;
   create a **private** bucket named `pdfs`.
2. **Vercel:** import the repo. Framework preset Next.js; defaults are correct.
3. **Environment variables:** add every required variable from the table above
   to Production (and Preview, if you use it). Set `APP_URL` to your real
   deployment origin, with no trailing slash — share and reset links are built
   from it.
4. **Deploy.**

Notes:

- `maxDuration = 60` is set on the ingest and chat routes. That is the Vercel
  Hobby ceiling; the 200-page extraction cap is sized to stay inside it.
- `@node-rs/argon2` and `unpdf` are listed in `serverExternalPackages` so
  webpack does not bundle their native/worker assets.
- After deploying, set `APP_URL` and redeploy if you first deployed without it —
  otherwise share links point at `localhost`.

---

## Architecture

```
Browser ──► Next.js (Vercel)
            ├── Server Components   → data reads, authorization enforced here
            ├── Route Handlers      → mutations, streaming chat, ingest
            └── middleware          → redirect UX only, NOT authorization
                     │
        ┌────────────┼─────────────────────────┐
        ▼            ▼                         ▼
  Supabase       Supabase Storage         Google Gemini
  Postgres       (private bucket)         (server-only key)
  + pgvector     signed URLs only         chat / embed / summarise
```

### Upload path

Vercel caps request bodies at ~4.5 MB, so proxying PDFs through a route handler
breaks on real documents. Instead:

1. `POST /api/uploads/sign` — validates declared metadata, creates the row,
   returns a **scoped signed upload URL**.
2. Client `PUT`s bytes **directly to storage**.
3. `POST /api/documents/:id/ingest` — the server downloads the object and
   validates the **actual bytes**: `%PDF-` magic, real size, `%%EOF` present,
   and that pdf.js can parse it. Failures delete the object and mark the row
   `failed` with a human explanation.

The client's declared filename, size, and MIME type are treated as hints
throughout. The storage key is generated server-side (`ownerId/uuid.pdf`) and
never derived from user input, which removes path traversal by construction.

### Ingest pipeline

```
download → validate bytes → extract per-page text → clean → chunk
   → embed chunks → summarise → embed descriptor → status: ready
```

Status is persisted at each step; the UI polls and offers **Retry** on failure.
Ingest is idempotent — it deletes prior chunks before inserting — so retrying
cannot produce duplicates.

---

## The AI pipeline

**Model:** Google Gemini. `gemini-2.5-flash` for summaries and answers,
`gemini-2.5-flash-lite` for the mechanical sub-tasks that sit in the latency
path, `gemini-embedding-001` for vectors. Chosen because it is the only major
provider whose free tier covers **both** chat and embeddings, so the whole app
runs on one no-cost key.

### Summaries

Two strategies, picked by document length:

- **≤ ~24k tokens → single pass.** Whole document, one call, best quality.
- **Longer → map-reduce.** Sections are compressed to terse notes in parallel
  (fast model), then one synthesis pass (main model) writes the final summary
  from those notes. Beyond 12 sections we **sample evenly across the document**
  rather than taking the first 12, so the summary stays representative.

Truncating to the first N pages was rejected: it silently produces a summary of
the introduction that reads as though it covers the whole document.

Summaries are generated from **page text, not retrieval chunks** — chunks carry
~15% overlap, which would feed the summariser the same sentences twice.

### Chunking

`src/server/pdf/chunk.ts`. Target **~900 tokens**, **~135 token overlap (15%)**.

Splitting is boundary-aware, in priority order:

1. **Paragraph breaks** — these usually track the document's own structure.
2. **Sentence boundaries** — if a paragraph alone exceeds budget.
3. **Word boundaries** — last resort for dense tables with no punctuation.

Why ~900: much smaller and a clause gets separated from the definition it
depends on; much larger and a chunk spans several topics, so its embedding
averages into something that matches everything weakly and nothing strongly.

Why overlap: a fact sitting exactly on a boundary would otherwise be split
across two chunks and retrieve well from neither.

Text is cleaned first: Unicode normalised, zero-width characters stripped,
hyphenated line-breaks rejoined (`agree-\nment` → `agreement`), hard-wrapped
prose unwrapped while list and paragraph structure is preserved.

Every chunk keeps its **page range**, which is what makes `[p.12]` citations and
click-to-jump possible.

### Retrieval

**The full PDF is never sent to the LLM.** Each question retrieves a handful of
passages, so cost and latency stay flat regardless of document length.

Retrieval is **hybrid**, because the two methods fail in opposite directions:

- **Dense vectors** (pgvector HNSW, cosine) capture meaning — "who pays for
  shipping?" matches a *"delivery costs shall be borne by…"* clause — but are
  weak on rare exact tokens: names, clause numbers, figures.
- **Postgres full-text** (`websearch_to_tsquery`) nails those exact tokens but
  misses paraphrase entirely.

20 candidates from each are fused with **Reciprocal Rank Fusion**
(`score = Σ 1/(60 + rank)`). Rank-based fusion avoids having to reconcile cosine
distance against `ts_rank`, which are not comparable scales.

Top **8** chunks survive, hard-capped at **~6000 context tokens**, then
**re-sorted into document order** before being sent — relevance order scrambles
the narrative and makes cross-references between excerpts harder to follow.

Two embedding details that materially affect quality:

- **Asymmetric task types.** Passages are embedded with `RETRIEVAL_DOCUMENT`,
  queries with `RETRIEVAL_QUERY`. A question and the passage answering it are
  not the same kind of text.
- **Manual L2 normalisation.** `gemini-embedding-001` only returns unit-length
  vectors at its native 3072 dims. We request **768** (pgvector's HNSW index
  rejects >2000) and truncated outputs are *not* normalised — so cosine distance
  would be subtly wrong without normalising ourselves.

### Chat

Per question:

1. **Load history** — last 5 turns, private to that actor.
2. **Rewrite the query** — this is the highest-leverage step. "What about
   clause 4?" embeds to near-noise; resolved against history it becomes a query
   that actually retrieves. Without this, follow-ups fail in a way that looks
   like broken retrieval. Failure falls back to the raw question.
3. **Hybrid retrieve.**
4. **Stream** a grounded answer.
5. **Persist** the turn with citations. The user's question is saved *before*
   streaming so it survives a disconnect.

Wire format is one JSON line of citations, then raw text tokens — simpler than
the SDK's full UI-message protocol and lets page chips render immediately.

### Prompt design

All prompts live in [`src/server/ai/prompts.ts`](./src/server/ai/prompts.ts).

**Summary prompt** — the brief warns against "a generic restatement", which is
exactly the default failure mode. Countermeasures:

- Bans meta-framing openings ("This document discusses…") explicitly, with
  examples.
- Demands specifics: parties, amounts, dates, obligations, findings.
- Bans structural description ("It is divided into five sections").
- Forbids outside knowledge, so a familiar-looking contract is not summarised
  from training data instead of the actual text.

**Chat prompt** — grounding is framed as absolute:

- The excerpts are the *only* permissible source.
- Page citations are **mandatory**, placed immediately after each claim.
- "Not in the document" gets an explicit script — without one, models improvise
  something plausible.
- Partial answers are handled separately from total misses, because "the
  document covers X but not Y" is more useful than a flat refusal.
- The model is told excerpts are a **subset**, so it says *"the excerpts don't
  cover that"* rather than falsely asserting the document lacks the information.

**Rewrite prompt** — must resolve references, must preserve the user's exact
terminology (strongest retrieval signal), must never answer, must pass
already-standalone questions through unchanged.

---

## Access control model

One resolver, [`src/server/auth/access.ts`](./src/server/auth/access.ts), which
every document-scoped route funnels through:

```ts
requireDocumentAccess(documentId) →
  | { kind: 'owner', userId, document }
  | { kind: 'guest', shareId, guestId, shareRole, document }
  | throws AccessDeniedError   // → 404
```

| Action | Owner | Guest (commenter) | Guest (viewer) | Nobody |
|--------|:-----:|:-----------------:|:--------------:|:------:|
| View PDF / summary | ✅ | ✅ | ✅ | ❌ |
| Chat | ✅ | ✅ | ✅ | ❌ |
| Read comments | ✅ | ✅ | ✅ | ❌ |
| Post / reply | ✅ | ✅ | ❌ | ❌ |
| Delete own comment | ✅ | ✅ | — | ❌ |
| Share / revoke / delete | ✅ | ❌ | ❌ | ❌ |

**Denial returns 404, not 403**, so status codes cannot be used to enumerate
which document IDs exist.

**Guests need no account.** `/s/<token>` → the server verifies the token hash →
the visitor supplies a display name → an httpOnly cookie **scoped to that one
share** is issued. It grants access to exactly one document and is not an
application session. A visitor holding several links keeps a separate identity
for each.

**Revocation is immediate.** Every access check re-reads `revoked_at` and
`expires_at`, so revoking a link cuts off guests who already hold a cookie on
their very next request.

---

## Security

**Passwords** — Argon2id (OWASP defaults: 19 MiB, 2 iterations), per-hash salt
embedded in the PHC string. Plaintext is never stored or logged.

**Login** — identical response for unknown email and wrong password. Because an
unknown email would otherwise skip Argon2 and return measurably faster, the
unknown path verifies against a **decoy hash**, closing the timing oracle.

**Tokens** — sessions, share links, guest cookies, and reset links are all 256
bits of CSPRNG entropy, stored as **peppered SHA-256** (pepper = `AUTH_SECRET`,
which lives in the environment, not the database). A database leak yields no
usable credentials.

Share tokens additionally store an **AES-256-GCM ciphertext** so owners can
re-copy an existing link. Plaintext-in-a-column would mean one leaked backup
hands over working links to every shared document; hash-only would make
re-copying impossible. Authenticated encryption with an env-held key gets both.

**Sessions** — opaque and server-side, so logout and password reset revoke
instantly. A password reset kills **every** session, since that is the remedy for
a compromised account.

**Cookies** — `httpOnly` (XSS cannot exfiltrate), `sameSite=lax` (blocks CSRF on
state-changing POSTs while letting an emailed share link work), `secure` in
production.

**Middleware is not a security boundary.** It only checks whether a session
cookie is *present* — it cannot validate one without a database round-trip.
Every page and route re-resolves identity server-side. Treating middleware as
authorization is precisely the mistake behind CVE-2025-29927.

**Upload validation is byte-level and server-side.** Declared MIME type and
extension are hints; magic bytes, size, EOF marker, and parseability are checked
after upload.

**Stored XSS** — comment HTML is sanitised **server-side** against a 13-tag
allowlist with **zero permitted attributes**. No allowed tag can execute script
or load a remote resource.

**LLM keys never reach the browser.** No `NEXT_PUBLIC_` variable exists in this
project. `src/lib/env.ts` and every server module import `server-only`, making a
client import a **build error** rather than a silent leak.

**Rate limiting** on auth, signup, password reset, upload, chat, comments, and
semantic search — tuned per endpoint, since the cost and abuse profile of
logging in differs from streaming an LLM answer.

**Dependencies** — `npm audit` reports **0 vulnerabilities**. The scaffolded
Next.js version shipped with 3 (including the middleware auth-bypass CVE) and
was patched; `sharp`, `postcss`, and `esbuild` are pinned forward via overrides.

**Security headers** — `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
`Referrer-Policy: strict-origin-when-cross-origin` (so share tokens in URLs
don't leak to third parties), `Permissions-Policy`, HSTS.

---

## Known limitations and trade-offs

Stated plainly, as the brief invites.

1. **No OCR — scanned PDFs are rejected, not silently mangled.** A PDF that is
   images with no text layer is detected and the user is told exactly that.
   Adding Tesseract would blow the serverless time budget. Detecting and
   explaining beats producing a confident summary of nothing.

2. **200-page extraction cap.** Ingest runs inline in a request with a 60s
   ceiling. Longer documents are processed up to the cap and the user is told
   how many pages were covered. A job queue (Inngest/QStash) is the production
   answer; at this scale it is an extra service to deploy and monitor for the
   same user-visible behaviour.

3. **Rate limiting is per-instance, in-memory.** On a horizontally scaled
   deployment the effective limit is (limit × instances). It stops credential
   stuffing from one source and a user hammering the LLM endpoints; it is not a
   defence against a distributed attacker. Swapping in Upstash Redis is a
   drop-in change to one module.

4. **Email needs a verified domain.** Without one, Resend delivers only to the
   account owner's address. Sharing is unaffected — links are always shown for
   copying, and the UI says honestly when a message could not be sent.

5. **No Content-Security-Policy.** Next.js inlines hydration data, so a correct
   nonce-based CSP means threading a nonce through middleware into every inline
   script. Shipping `unsafe-inline` would be security theatre. The other headers
   are set; a strict CSP is the clearest next hardening step.

6. **Token estimation is `chars / 4`, not a real tokenizer.** Avoids a
   tokenizer dependency; budgets are set conservatively enough that a 10–15%
   error never overflows the context window.

7. **Chat history is per-actor, not shared.** An owner and a guest on the same
   document have separate conversations. This is a privacy decision, not an
   oversight — one collaborator's questions can be revealing.

8. **Signup reveals whether an email is registered.** Login and password reset
   are both enumeration-safe; signup cannot be without making the form unusable.
   A deliberate, bounded exception.

9. **Comment editing is not implemented.** Delete and re-post covers the need;
   edit history done properly (who changed what, when) was not worth the scope.

10. **Semantic search only covers processed documents.** It matches on the
    summary embedding, so a document that failed ingest is findable by filename
    only.

---

## Project layout

```
src/
├── app/
│   ├── (auth)/          login, signup, forgot-password, reset-password
│   ├── (app)/           dashboard, documents/[id]   (authenticated)
│   ├── s/[token]/       guest share entry point
│   └── api/             auth, uploads, documents, shares
├── components/
│   ├── ui/              button, input, card, dialog, primitives
│   ├── auth/            shared credential form
│   ├── dashboard/       upload dropzone, document card, search
│   ├── viewer/          PDF viewer, chat panel, comments panel, workspace
│   └── share/           share dialog, guest join
├── server/              ← all server-only code
│   ├── auth/            password, tokens, crypto, session, access
│   ├── db/              schema, client
│   ├── ai/              provider, embed, retrieve, summarize, chat, prompts
│   ├── pdf/             validate, extract, chunk
│   ├── comments/        queries, sanitize
│   ├── documents/       ingest, queries, shares
│   ├── storage/         supabase
│   └── email/           send, templates
├── lib/                 env, api, validation, rate-limit, cookies, utils
└── middleware.ts        redirect UX only
```
