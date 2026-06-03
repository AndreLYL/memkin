import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    hookTimeout: 20_000,
    testTimeout: 15_000,
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
