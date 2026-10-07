/**
 * The carve family's Points sampler — the boundary-shell rejection sample's
 * contract: every placed point sits in the shell around the surface
 * (membership-adjacent, the DE is the same oracle), the draw is
 * deterministic in its seed, the winning-level slots are in range, and the
 * per-point cost stays in the chaos game's own class (the acceptance
 * figures the family doc's Points section quotes).
 */
import { describe, expect, it } from "vitest";
import { buildMengerDE, estimateMengerDistance } from "./menger-de";
import { buildMengerDE4, estimateMengerDistance4 } from "./menger-de-4d";
import { resolveMengerTwist } from "./menger-twist";
import {
  MENGER_SAMPLE_SHELL,
  sampleMengerCloud,
  sampleMengerCloud4,
} from "./menger-sample";
import { mulberry32 } from "./rng";
import type { Vec3, Vec4 } from "./types";

function constructionOf(authored: Parameters<typeof resolveMengerTwist>[0]) {
  const resolution = resolveMengerTwist(authored);
  if (!resolution.ok) throw new Error(resolution.reasons.join("; "));
  return resolution.construction;
}

describe("sampleMengerCloud (the carve family's Points sampler)", () => {
  const de = buildMengerDE(
    constructionOf({ levels: 4, rotation: [0, -0.9272952180016122, 0] }),
  );

  it("places every point inside the boundary shell, levels in range", () => {
    const cloud = sampleMengerCloud(de, 4000, mulberry32(7));
    expect(cloud.count).toBe(4000);
    for (let i = 0; i < cloud.count; i++) {
      const p: Vec3 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
      ];
      const d = estimateMengerDistance(de, p);
      expect(Math.abs(d)).toBeLessThanOrEqual(MENGER_SAMPLE_SHELL + 1e-12);
      // In the construction's own box — the sampler draws there and the
      // twist cannot move a point out of the frame whose box bounds it.
      for (const x of p) expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-12);
      const level = cloud.levels[i];
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThan(de.levels);
    }
  });

  it("is deterministic in its seed", () => {
    const a = sampleMengerCloud(de, 500, mulberry32(9));
    const b = sampleMengerCloud(de, 500, mulberry32(9));
    expect(b.positions).toEqual(a.positions);
    expect(b.levels).toEqual(a.levels);
    const c = sampleMengerCloud(de, 500, mulberry32(10));
    expect(Array.from(c.positions)).not.toEqual(Array.from(a.positions));
  });

  it("keeps the per-point cost in the chaos game's own class (the acceptance figure)", () => {
    // 50k points must place in well under a second of worker time — the
    // sphere-inversion family's own cap discipline. Measured: ~40ms
    // (1.2M points/s) at 4 levels.
    const t0 = performance.now();
    const cloud = sampleMengerCloud(de, 50_000, mulberry32(3));
    const ms = performance.now() - t0;
    expect(cloud.count).toBe(50_000);
    expect(ms).toBeLessThan(2000);
  });
});

describe("sampleMengerCloud4 (the 4D half)", () => {
  const de = buildMengerDE4(
    constructionOf({
      levels: 4,
      rotation: [0, -0.9272952180016122, 0],
      w: { rotation: { xw: 0.3 } },
    }),
  );

  it("places every 4D point inside the shell and reports world w", () => {
    const cloud = sampleMengerCloud4(de, 3000, mulberry32(11));
    expect(cloud.count).toBe(3000);
    for (let i = 0; i < cloud.count; i++) {
      const p: Vec4 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i],
      ];
      const d = estimateMengerDistance4(de, p);
      expect(Math.abs(d)).toBeLessThanOrEqual(MENGER_SAMPLE_SHELL + 1e-12);
      for (const x of p) expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-12);
      expect(cloud.levels[i]).toBeLessThan(de.levels);
    }
  });

  it("is deterministic in its seed", () => {
    const a = sampleMengerCloud4(de, 400, mulberry32(13));
    const b = sampleMengerCloud4(de, 400, mulberry32(13));
    expect(b.positions).toEqual(a.positions);
    expect(b.w).toEqual(a.w);
    expect(b.levels).toEqual(a.levels);
  });
});
