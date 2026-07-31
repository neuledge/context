import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Several tests build multi-megabyte fixtures to get over the parser's split
    // threshold, and ran within ~4x of the 5s default under CPU contention. The one
    // test that is actually timing a regression sets its own, tighter budget.
    testTimeout: 20000,
  },
});
