import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';

import { AccessDeniedError } from '@/server/auth/access';

/**
 * Uniform API response and error handling.
 *
 * Goals: never leak internals to the client, never silently swallow a failure,
 * and give the frontend one predictable error shape to render.
 */

export type ApiErrorBody = {
  error: string;
  /** Field-level messages for form rendering, when the failure was validation. */
  fields?: Record<string, string>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (m: string, f?: Record<string, string>) =>
  new ApiError(400, m, f);
export const unauthorized = (m = 'You must be signed in.') => new ApiError(401, m);
export const forbidden = (m = 'You do not have permission to do that.') =>
  new ApiError(403, m);
export const notFound = (m = 'Not found.') => new ApiError(404, m);
export const tooLarge = (m = 'File is too large.') => new ApiError(413, m);
export const rateLimited = (m = 'Too many requests. Please slow down.') =>
  new ApiError(429, m);

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** Flattens a ZodError into `{ fieldName: firstMessage }`. */
function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    fields[key] ??= issue.message;
  }
  return fields;
}

/**
 * Wraps a route handler so thrown errors become well-formed responses.
 *
 * Unexpected errors are logged server-side with full detail but returned to the
 * client as a generic message — stack traces and driver errors must never reach
 * the browser.
 */
export function handleApiError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof AccessDeniedError) {
    // Deliberately 404: denial must be indistinguishable from non-existence.
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, ...(error.fields ? { fields: error.fields } : {}) },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Please check the highlighted fields.', fields: zodFields(error) },
      { status: 400 },
    );
  }

  console.error('[api] unhandled error:', error);
  return NextResponse.json(
    { error: 'Something went wrong. Please try again.' },
    { status: 500 },
  );
}

/** Parses and validates a JSON body, throwing a 400 with field errors on failure. */
export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, 'Please check the highlighted fields.', zodFields(result.error));
  }
  return result.data;
}

/** Best-effort client IP for rate limiting, honouring proxy headers on Vercel. */
export function clientIp(request: Request): string {
  const h = request.headers;
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return h.get('x-real-ip') ?? 'unknown';
}
