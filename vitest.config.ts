import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 10000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // Run chopsticks tests one at a time
      },
    },
    // Retry flaky tests
    retry: 1,
  },
});
