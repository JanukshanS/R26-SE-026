import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    // One process: the tests share one embedded Postgres. Each test still gets
    // its own garage (a fresh provider id), so they never see each other's data.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: { NODE_ENV: 'test' },
  },
});
