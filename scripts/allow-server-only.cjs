/**
 * Lets standalone Node scripts import server modules.
 *
 * The `server-only` package throws unless it is resolved inside a React Server
 * Component. That is exactly what makes it a useful guard in the Next.js build,
 * and exactly what stops a plain `tsx` script from importing the same modules
 * the app uses.
 *
 * Rather than duplicating pipeline logic in the script (which would verify a
 * copy instead of the real thing), this resolves `server-only` to a no-op.
 * Preloaded via NODE_OPTIONS=--require, so it is active before any import runs.
 * Scripts only — never referenced by application code, so the build-time
 * guarantee is untouched.
 */
const Module = require('node:module');
const path = require('node:path');

const NOOP = path.join(__dirname, 'noop.cjs');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return NOOP;
  return originalResolve.call(this, request, ...rest);
};
