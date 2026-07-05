import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Integration tests share one Postgres instance and TRUNCATE the same
    // tables; running test files in parallel causes cross-file interference
    // (a TRUNCATE from one file wiping rows another file just wrote).
    fileParallelism: false,
  },
});
