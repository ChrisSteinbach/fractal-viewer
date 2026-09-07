/**
 * Splitting the GPU-agreement scenario sweep across CI jobs.
 *
 * The workflow selector reads the page's own roster and emits this same
 * partition. Its tests compare the complete union and each shard with this
 * function, including roster growth. Impact selection is conservative across
 * both dimensions; uncertainty selects all scenarios. Policy, measured costs
 * and the partition history live in docs/gpu-agreement-ci.md.
 *
 * ROUND-ROBIN (`index % n`), not contiguous blocks: the scenarios differ
 * several-fold in cost (a parameterized fold zoo against `sierpinski`), and
 * blocks would gather the expensive neighbours into one shard and leave the
 * wall-clock roughly where it started.
 *
 * A shard that selects NOTHING is not a silent pass — `computeAgreement`
 * returns "skipped" when no comparison ran, and the headless runner exits 2
 * on that. An unparsable or out-of-range spec THROWS rather than falling
 * back to the full list: a typo that quietly ran everything would hide the
 * very drift this is built to prevent, and one that quietly ran nothing
 * would be worse.
 */
export function applyScenarioShard<T>(
  scenarios: T[],
  spec: string | null,
): T[] {
  if (spec === null) return scenarios;
  const match = /^(\d+)\/(\d+)$/.exec(spec.trim());
  if (!match) {
    throw new Error(
      `bad shard spec ${JSON.stringify(spec)} — expected "i/n", e.g. "1/4"`,
    );
  }
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (count < 1 || index < 1 || index > count) {
    throw new Error(
      `bad shard spec ${JSON.stringify(spec)} — need 1 <= i <= n and n >= 1`,
    );
  }
  return scenarios.filter((_, i) => i % count === index - 1);
}
