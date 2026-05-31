import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    testTimeout: 30_000,
    fileParallelism: false,
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
