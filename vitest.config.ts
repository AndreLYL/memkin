import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
