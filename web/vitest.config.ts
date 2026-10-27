import { defineConfig } from 'vitest/config';

/**
 * Server tests live in `test/`, client tests next to their sources. A dedicated config keeps
 * Vitest from inheriting `vite.config.ts`, whose root is `client/` and would hide the server suite.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'client/src/**/*.test.ts'],
  },
});
