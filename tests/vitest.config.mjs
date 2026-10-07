import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['**/*.test.mjs'],
    // все тесты правил работают с одним эмулятором — по очереди
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
