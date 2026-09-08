import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The browser test builds and serves the site, so it needs longer still.
    hookTimeout: 240_000,
    // The two-phase solver builds about four megabytes of lookup tables the
    // first time it runs. That happens once per process, and a default timeout
    // would fail the first test that triggers it rather than the slow one.
    testTimeout: 120_000,
    coverage: { provider: 'v8', include: ['src/core/**', 'src/solvers/**', 'src/teach/**'] },
  },
});
