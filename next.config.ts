import type { NextConfig } from 'next';
import path from 'node:path';

/**
 * Security headers applied to every response.
 *
 * No CSP is set here deliberately: Next.js inlines hydration and style data,
 * and a nonce-based CSP in the App Router requires threading a nonce through
 * middleware into every inline script. The headers below cover the realistic
 * risks for this app; adding a correct strict CSP is noted as future work in
 * the README rather than shipped half-working with `unsafe-inline`.
 */
const securityHeaders = [
  // Stop MIME sniffing — a stored PDF must never be interpreted as HTML.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Legacy clickjacking defence; frame-ancestors would be the modern form.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Don't leak document URLs (which contain share tokens) to third parties.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  // HSTS is a no-op on http://localhost and enforced in production.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /*
   * Pin the workspace root. Without this, Next.js walks up and finds an
   * unrelated lockfile in the user's home directory, then traces output files
   * from there.
   */
  outputFileTracingRoot: path.join(__dirname),

  // Fail the production build on type or lint errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  serverExternalPackages: [
    // Native binary; must not be bundled by webpack.
    '@node-rs/argon2',
    // Ships its own worker/wasm assets that break when bundled.
    'unpdf',
  ],

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
