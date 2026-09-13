import { clearancePilotRefusal } from "./transmission-gpu-contract";

describe("transmission pilot qualification", () => {
  it("refuses unfinished work even when the point witnesses agree", () => {
    expect(
      clearancePilotRefusal({
        rows: [
          { result: { unresolved: 1 }, cpuAgreement: { verdict: "pass" } },
        ],
        chunkInvariant: [],
      }),
    ).toBe("unfinished sampled-domain rays");
  });

  it("requires the requested chunk comparison to finish and preserve every ray", () => {
    for (const check of [
      { complete: false, samePerRayTrace: false },
      { complete: true, samePerRayTrace: false },
    ]) {
      expect(
        clearancePilotRefusal({
          rows: [
            { result: { unresolved: 0 }, cpuAgreement: { verdict: "pass" } },
          ],
          chunkInvariant: [check],
        }),
      ).toBe("work-chunk trace invariance did not pass");
    }
    expect(
      clearancePilotRefusal({
        rows: [
          { result: { unresolved: 0 }, cpuAgreement: { verdict: "pass" } },
        ],
        chunkInvariant: [{ complete: true, samePerRayTrace: true }],
      }),
    ).toBeNull();
  });
});
