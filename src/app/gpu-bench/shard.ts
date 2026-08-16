/**
 * fr-hzlm: splitting the GPU-agreement scenario sweep across CI jobs.
 *
 * The agreement gate is ~18 min against 1m50s for the next-slowest CI job,
 * so it is the whole critical path; four shards cut that to roughly setup
 * plus a quarter of the sweep, for about 1.3x the runner-minutes (setup is
 * what gets duplicated, and the workflow caches the browser download).
 *
 * THIS PARTITIONS THE SCENARIO LIST ITSELF, which is the whole reason it
 * lives here rather than as a matrix of `?scenarios=` name lists in the
 * workflow. A hand-written matrix fails OPEN: add a fifteenth scenario,
 * forget to add it to a shard, and it is silently never verified again —
 * the same failure mode `.github/workflows/gpu-agreement.yml`'s fail-safe
 * `paths-ignore` filter exists to avoid, and the one `gpu-flame-bench.mjs`
 * refuses when it exits non-zero on a "skipped" verdict rather than letting
 * a runner that lost its WebGPU adapter keep passing while pinning nothing.
 * Partitioning by INDEX makes the union of the shards the full list BY
 * CONSTRUCTION, so a new entry is picked up by whichever shard its index
 * lands in without anyone touching CI.
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
