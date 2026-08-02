import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/**/src/**/*.test.ts',
      'packages/**/test/**/*.test.ts',
      'tools/**/test/**/*.test.ts',
    ],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
