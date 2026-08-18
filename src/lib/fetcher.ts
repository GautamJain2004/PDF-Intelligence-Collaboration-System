import type { ApiErrorBody } from '@/lib/api';

/**
 * Client-side API helper.
 *
 * Normalises the error shape so every form and panel handles failures the same
 * way, instead of each caller re-implementing `res.ok` checks and JSON parsing.
 */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export async function apiFetch<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers, ...rest } = init ?? {};

  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error (proxy timeout, HTML error page) — fall through.
    }
    throw new RequestError(
      response.status,
      body?.error ?? `Request failed (${response.status})`,
      body?.fields,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** SWR-compatible GET fetcher. */
export const swrFetcher = <T>(url: string): Promise<T> => apiFetch<T>(url);
