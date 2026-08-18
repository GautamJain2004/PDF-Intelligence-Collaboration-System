/**
 * Test-time stand-in for the `server-only` package.
 *
 * The real package throws when resolved outside a React Server Component, which
 * is exactly what makes it a useful guard in the Next.js build — and exactly
 * what breaks unit tests of server modules. Aliased in vitest.config.ts.
 */
export {};
