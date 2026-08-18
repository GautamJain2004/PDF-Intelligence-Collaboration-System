/**
 * Copies the pdf.js worker into `public/` so it can be served as a static file.
 *
 * Runs automatically via the `predev` and `prebuild` npm hooks.
 *
 * WHY NOT bundle it: the idiomatic
 *
 *   new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)
 *
 * relies on webpack's asset-module handling, which in this setup hands back a
 * non-string and fails at runtime with "url.replace is not a function". Copying
 * the file and referencing it by absolute path removes the bundler from the
 * equation entirely and behaves identically in dev and production.
 *
 * The worker's version must match the installed pdfjs-dist exactly, so it is
 * copied from node_modules at build time rather than committed — a stale
 * committed copy after a dependency bump fails with a confusing version error.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DEST_DIR = path.resolve('public');
const DEST = path.join(DEST_DIR, 'pdf.worker.min.mjs');

function resolveWorker() {
  const pkgPath = require.resolve('pdfjs-dist/package.json');
  const root = path.dirname(pkgPath);
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

  // Prefer the minified build; fall back to unminified, then the legacy build.
  const candidates = [
    path.join(root, 'build', 'pdf.worker.min.mjs'),
    path.join(root, 'build', 'pdf.worker.mjs'),
    path.join(root, 'legacy', 'build', 'pdf.worker.min.mjs'),
  ];

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Could not find the pdf.js worker in ${root}. Looked for:\n` +
        candidates.map((c) => `  - ${c}`).join('\n'),
    );
  }
  return { source: found, version };
}

const { source, version } = resolveWorker();
mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(source, DEST);

console.log(
  `[pdf-worker] copied pdfjs-dist@${version} worker -> public/${path.basename(DEST)}`,
);
