import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['packages/*/src/**/*.test.ts'] },
      },
      {
        test: { name: 'e2e', include: ['packages/*/test/**/*.test.ts'], testTimeout: 30_000 },
      },
    ],
    // Coverage gate for the calculation core (spec §11.1). Server packages are covered by e2e tests in child processes.
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**'],
      exclude: ['**/*.test.ts', '**/__fixtures__/**'],
      thresholds: { lines: 90, branches: 80 },
    },
  },
});
