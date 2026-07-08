/**
 * Vitest config for on-demand measurement harnesses living under
 * `scripts/*.harness.ts` (e.g. surprise-residual.harness.ts, fr-b5x). Kept
 * separate from the repo's main vitest.config.ts -- whose `include` is
 * `src/**\/*.test.ts` only -- so these sweeps are never picked up by
 * `npm test` / CI and only run on demand:
 *
 *   npx vitest run --config scripts/vitest.harness.config.ts
 *
 * `reporters` is pinned to `"default"` rather than left to Vitest's own
 * auto-detection: Vitest silently swallows a passing test's console.log
 * output when stdout isn't a TTY (piped to a file, run by CI, or driven by
 * another agent) unless a reporter is forced -- and a harness whose entire
 * output IS a printed report can't afford to lose it that way.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["scripts/**/*.harness.ts"],
    testTimeout: 900_000,
    reporters: ["default"],
  },
});
