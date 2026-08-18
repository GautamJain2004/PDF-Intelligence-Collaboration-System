import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
      /*
       * `server-only` exists to make importing server modules from client code a
       * build error. Vitest is neither, and resolves to the package's throwing
       * client build, so it is stubbed out for tests. The guarantee still holds
       * where it matters: the Next.js build.
       */
      'server-only': path.resolve(root, './src/test/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
