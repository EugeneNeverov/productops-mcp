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
    coverage: { provider: 'v8', include: ['packages/*/src/**'], exclude: ['**/*.test.ts', '**/bin.ts'] },
  },
});
