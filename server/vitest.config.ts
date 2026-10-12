import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', '../scripts/test/**/*.test.ts'],
    // Quieten the request log so test output shows assertions, not JSON.
    env: { NODE_ENV: 'test' },
  },
});