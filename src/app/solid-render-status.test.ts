import { describe, expect, it } from "vitest";
import {
  beginSampledSolidStatus,
  endSampledSolidStatus,
  progressSampledSolidStatus,
  resolveSampledSolidResolution,
  restartSampledSolidStatus,
  sampledSolidFileTag,
  sampledSolidSnapshotText,
  sampledSolidStatusText,
  sanitizeSampledSolidStatus,
} from "./solid-render-status";

describe("sampled Solid render-session status", () => {
  it("discloses sampled identity, requested resolution, and active convergence", () => {
    const status = progressSampledSolidStatus(
      beginSampledSolidStatus(192, 20_000_000),
      12_345_000,
      20_000_000,
    );
    expect(sampledSolidStatusText(status)).toBe(
      "Sampled Solid · requested 192³ voxels · effective resolution pending · converging 61%",
    );
    expect(sampledSolidSnapshotText(status)).toBe(
      "Sampled Solid · requested 192³ voxels · effective resolution pending · incomplete at 61%",
    );
  });

  it("reports effective and requested resolution when memory reduced the grid", () => {
    const status = resolveSampledSolidResolution(
      beginSampledSolidStatus(256, 10),
      128,
      256,
    );
    expect(sampledSolidStatusText(status)).toContain(
      "128³ voxels (requested 256³)",
    );
  });

  it("marks a budget-met render complete and names it as converged", () => {
    const status = progressSampledSolidStatus(
      resolveSampledSolidResolution(beginSampledSolidStatus(192, 10), null),
      10,
      10,
    );
    expect(status.phase).toBe("complete");
    expect(sampledSolidStatusText(status)).toBe(
      "Sampled Solid · 192³ voxels · converged",
    );
    expect(sampledSolidFileTag(status)).toBe(
      "sampled-solid-192cubed-converged",
    );
  });

  it.each(["cancelled", "failed"] as const)(
    "preserves honest incomplete progress when %s",
    (phase) => {
      const status = endSampledSolidStatus(
        progressSampledSolidStatus(
          resolveSampledSolidResolution(
            beginSampledSolidStatus(192, 100),
            160,
            192,
          ),
          42,
          100,
        ),
        phase,
      );
      expect(sampledSolidStatusText(status)).toContain(
        `${phase} · incomplete at 42%`,
      );
      expect(sampledSolidFileTag(status)).toBe(
        "sampled-solid-160cubed-requested-192cubed-incomplete-42pct",
      );
    },
  );

  it("resets resolution and convergence when accumulation restarts", () => {
    const complete = progressSampledSolidStatus(
      resolveSampledSolidResolution(beginSampledSolidStatus(192, 10), 128),
      10,
      10,
    );
    expect(restartSampledSolidStatus(complete, 20)).toEqual(
      beginSampledSolidStatus(192, 20),
    );
  });

  it("keeps requested fallback resolution in the saved filename tag", () => {
    const status = resolveSampledSolidResolution(
      beginSampledSolidStatus(192, 10),
      128,
    );
    expect(sampledSolidFileTag(status)).toBe(
      "sampled-solid-128cubed-requested-192cubed-incomplete-0pct",
    );
  });

  it("sanitizes persisted snapshots without trusting a false completion", () => {
    const raw = {
      kind: "sampled-solid",
      phase: "complete",
      requestedResolution: 192,
      effectiveResolution: 128,
      iterationsDone: 4,
      iterationsBudget: 10,
    };
    expect(sanitizeSampledSolidStatus(raw)?.phase).toBe("active");
    expect(sanitizeSampledSolidStatus({ ...raw, kind: "surface" })).toBe(
      undefined,
    );
  });
});
