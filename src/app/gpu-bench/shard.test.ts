import { applyScenarioShard } from "./shard";

/**
 * A FIXTURE, deliberately not the bench's own roster and deliberately not the
 * same length as it (the real sweep was sixteen when this landed). What is
 * under test is the partition, and a test that mirrored `SCENARIOS` would
 * need editing every time a scenario is added — which is precisely the
 * coupling `applyScenarioShard` exists to remove. Real-looking names only so
 * a failure reads clearly.
 */
const SCENARIOS = [
  "sierpinski",
  "fern",
  "xform-color",
  "swirl",
  "kaleido",
  "variation-zoo",
  "fold-zoo",
  "fold-zoo-parameterized",
  "hyperfern-structural",
  "doublerot-wramp-slice",
  "hyperfern-transform",
  "doublerot-radius",
  "variation-zoo-4d",
  "fold-zoo-4d",
];

describe("applyScenarioShard", () => {
  it("runs every scenario when no shard is requested", () => {
    expect(applyScenarioShard(SCENARIOS, null)).toEqual(SCENARIOS);
  });

  // The property the whole design exists for: a matrix of hand-written name
  // lists would silently stop covering a newly added scenario, so the union
  // of the shards must be the full list by construction, at any shard count.
  it.each([1, 2, 3, 4, 5, 7, 14])(
    "covers every scenario across %i shards",
    (n) => {
      const union = Array.from({ length: n }, (_, i) =>
        applyScenarioShard(SCENARIOS, `${i + 1}/${n}`),
      ).flat();

      expect([...union].sort()).toEqual([...SCENARIOS].sort());
    },
  );

  it("gives no scenario to two shards", () => {
    const union = Array.from({ length: 4 }, (_, i) =>
      applyScenarioShard(SCENARIOS, `${i + 1}/4`),
    ).flat();

    expect(new Set(union).size).toBe(union.length);
  });

  // Round-robin rather than contiguous blocks, so neighbouring scenarios of
  // similar cost land in different shards.
  it("deals scenarios round-robin so shard sizes differ by at most one", () => {
    const sizes = Array.from(
      { length: 4 },
      (_, i) => applyScenarioShard(SCENARIOS, `${i + 1}/4`).length,
    );

    expect(sizes).toEqual([4, 4, 3, 3]);
  });

  it("puts adjacent scenarios in different shards", () => {
    expect(applyScenarioShard(SCENARIOS, "1/4")).toEqual([
      "sierpinski",
      "kaleido",
      "hyperfern-structural",
      "variation-zoo-4d",
    ]);
  });

  it("selects nothing when the shard count exceeds the scenario count", () => {
    // Not a silent pass downstream: computeAgreement reports "skipped" when
    // no comparison ran, and the headless runner exits 2 on that.
    expect(applyScenarioShard(SCENARIOS, "20/20")).toEqual([]);
  });

  it.each(["0/4", "5/4", "4", "a/b", "", "1/0", "-1/4", "1/4/2"])(
    "throws on the malformed spec %o rather than falling back to the full list",
    (spec) => {
      expect(() => applyScenarioShard(SCENARIOS, spec)).toThrow();
    },
  );
});
