import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { env } from '@/lib/env';

/**
 * Private object storage.
 *
 * The bucket is private, so objects have no public URL at all. Reads go through
 * short-lived signed URLs minted only after an authorization check, and writes
 * go through single-use signed upload URLs.
 *
 * This module uses the service-role key, which bypasses row-level security.
 * It is server-only and must never be imported from a client component.
 */

let client: SupabaseClient | null = null;

function storageClient(): SupabaseClient {
  client ??= createClient(env().SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function bucket() {
  return storageClient().storage.from(env().SUPABASE_STORAGE_BUCKET);
}

/**
 * Builds an opaque storage key.
 *
 * The user-supplied filename is NOT used in the path. That removes path
 * traversal (`../../`), collisions, and any chance of a crafted name landing
 * somewhere unintended. The display name lives in the database instead.
 */
export function buildStoragePath(ownerId: string): string {
  return `${ownerId}/${randomUUID()}.pdf`;
}

/**
 * Mints a one-shot signed upload URL.
 *
 * Uploading direct to storage sidesteps the ~4.5 MB request body cap on Vercel
 * serverless functions, which a proxied upload would hit on real documents.
 * The URL is scoped to one object key and expires quickly.
 */
export async function createSignedUpload(path: string) {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Failed to create upload URL: ${error?.message ?? 'unknown error'}`);
  }
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

/**
 * Signed read URL, minted only after the caller's access has been verified.
 *
 * Kept deliberately short-lived: if the URL leaks (browser history, a shared
 * screenshot), the window of exposure is minutes, not forever.
 */
export async function createSignedDownloadUrl(path: string, expiresInSeconds = 300) {
  const { data, error } = await bucket().createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    throw new Error(`Failed to sign download URL: ${error?.message ?? 'unknown error'}`);
  }
  return data.signedUrl;
}

/** Downloads an object into memory for server-side validation and extraction. */
export async function downloadObject(path: string): Promise<Buffer> {
  const { data, error } = await bucket().download(path);
  if (error || !data) {
    throw new Error(`Failed to download object: ${error?.message ?? 'unknown error'}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Removes an object. Used to clean up rejected uploads and deleted documents. */
export async function removeObject(path: string): Promise<void> {
  const { error } = await bucket().remove([path]);
  if (error) {
    // Non-fatal: a leaked object is a storage-cost problem, not a correctness or
    // security one, and must not fail the user-visible operation.
    console.error(`[storage] failed to remove ${path}:`, error.message);
  }
}

/** Reads object metadata; used to confirm an upload actually landed. */
export async function statObject(
  path: string,
): Promise<{ size: number; contentType: string | null } | null> {
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : path.slice(0, lastSlash);
  const name = path.slice(lastSlash + 1);

  const { data, error } = await bucket().list(dir, { search: name, limit: 1 });
  if (error || !data || data.length === 0) return null;

  const entry = data.find((f) => f.name === name);
  if (!entry) return null;

  return {
    size: Number(entry.metadata?.size ?? 0),
    contentType: (entry.metadata?.mimetype as string | undefined) ?? null,
  };
}
