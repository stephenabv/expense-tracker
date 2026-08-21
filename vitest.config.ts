import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "./") },
  },
  test: {
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
    /*
     * Several suites boot their own PGlite — a whole Postgres compiled to WASM —
     * and run the migrations before the first test. Those boots happen in
     * parallel workers on one machine, so the slowest can sit well past the
     * 10s default while it waits its turn for CPU. The generous ceiling is for
     * that startup, not for any individual test.
     */
    hookTimeout: 60_000,
  },
});
