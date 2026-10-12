import {
  probeAdapterWithRetries,
  surfaceComputeReprobeDue,
  SURFACE_PROBE_ATTEMPTS,
  SURFACE_PROBE_BACKOFF_MS,
  SURFACE_REPROBE_MIN_AGE_MS,
} from "./surface-compute-reprobe";

/** A probe harness over a scripted verdict list: one entry per attempt,
 * `true`/`false` resolve, a string THROWS. `delays` collects the ladder's
 * waits so the schedule is pinned without real timers. */
function scriptedProbe(
  verdicts: Array<boolean | string>,
  delays: number[] = [],
) {
  let call = 0;
  return {
    async probe(): Promise<boolean> {
      const verdict = verdicts[call++];
      if (verdict === undefined)
        throw new Error("probe called past its script");
      if (typeof verdict === "string") throw new Error(verdict);
      return verdict;
    },
    async delay(ms: number): Promise<void> {
      delays.push(ms);
    },
    calls: () => call,
  };
}

describe("probeAdapterWithRetries (the boot probe's retry ladder)", () => {
  it("resolves true on the first success and never waits", async () => {
    const delays: number[] = [];
    const harness = scriptedProbe([true], delays);

    await expect(probeAdapterWithRetries(harness)).resolves.toBe(true);

    expect(harness.calls()).toBe(1);
    expect(delays).toEqual([]);
  });

  it("retries fresh probes on the doubling backoff and resolves on a later success", async () => {
    const delays: number[] = [];
    const harness = scriptedProbe([false, false, true], delays);

    await expect(probeAdapterWithRetries(harness)).resolves.toBe(true);

    expect(harness.calls()).toBe(3);
    expect(delays).toEqual([
      SURFACE_PROBE_BACKOFF_MS,
      SURFACE_PROBE_BACKOFF_MS * 2,
    ]);
  });

  it("resolves false only after the full ladder", async () => {
    const harness = scriptedProbe([false, false, false]);

    await expect(probeAdapterWithRetries(harness)).resolves.toBe(false);

    expect(harness.calls()).toBe(SURFACE_PROBE_ATTEMPTS);
  });

  it("counts a thrown probe as a failed attempt instead of rejecting", async () => {
    const harness = scriptedProbe(["gpu process exploded", false, true]);

    await expect(probeAdapterWithRetries(harness)).resolves.toBe(true);

    expect(harness.calls()).toBe(3);
  });

  it("honors an explicit attempts override", async () => {
    const harness = scriptedProbe([false, false]);

    await expect(
      probeAdapterWithRetries(harness, { attempts: 2 }),
    ).resolves.toBe(false);

    expect(harness.calls()).toBe(2);
  });
});

describe("surfaceComputeReprobeDue (the session door's stale-verdict gate)", () => {
  const due = (
    block: Parameters<typeof surfaceComputeReprobeDue>[0]["block"],
    age: number,
    supported = true,
  ) =>
    surfaceComputeReprobeDue({
      block,
      supported,
      unavailableAt: 0,
      now: age,
    });

  it("fires for a stale unavailable verdict on a supported context", () => {
    expect(due("unavailable", SURFACE_REPROBE_MIN_AGE_MS)).toBe(true);
    expect(due("unavailable", SURFACE_REPROBE_MIN_AGE_MS * 10)).toBe(true);
  });

  it("holds for a fresh verdict — the page just answered this question", () => {
    expect(due("unavailable", SURFACE_REPROBE_MIN_AGE_MS - 1)).toBe(false);
    expect(due("unavailable", 0)).toBe(false);
  });

  it("never fires for the one-way classes or a clear block", () => {
    expect(due("failed", SURFACE_REPROBE_MIN_AGE_MS * 100)).toBe(false);
    expect(due("flag", SURFACE_REPROBE_MIN_AGE_MS * 100)).toBe(false);
    expect(due(null, SURFACE_REPROBE_MIN_AGE_MS * 100)).toBe(false);
  });

  it("never fires when navigator.gpu is absent — a permanent verdict, not a stale one", () => {
    expect(
      surfaceComputeReprobeDue({
        block: "unavailable",
        supported: false,
        unavailableAt: 0,
        now: SURFACE_REPROBE_MIN_AGE_MS * 100,
      }),
    ).toBe(false);
  });
});
