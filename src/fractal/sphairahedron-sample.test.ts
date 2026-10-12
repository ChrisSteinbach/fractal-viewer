import {
  resolveSphairahedron,
  type SphairahedronAuthored,
} from "./sphairahedron";
import {
  buildSphairahedronDE,
  estimateSphairahedronDistance,
} from "./sphairahedron-de";
import {
  buildSphairahedronDE4,
  estimateSphairahedronDistance4,
} from "./sphairahedron-de-4d";
import {
  sampleSphairahedronCloud,
  SPHAIRAHEDRON_POINTS_MAX,
  SPHAIRAHEDRON_POINTS_MIN_FOLDS,
  SPHAIRAHEDRON_SWEEP_BISECT_STEPS,
  SPHAIRAHEDRON_SWEEP_SCAN_STEPS,
} from "./sphairahedron-sample";
import { mulberry32 } from "./rng";
import type { Vec3, Vec4 } from "./types";

function constructionOf(block: SphairahedronAuthored) {
  const resolution = resolveSphairahedron(block);
  if (!resolution.ok) throw new Error(resolution.reasons.join("; "));
  return resolution.construction;
}

/** The study's finite points-sheet construction: cube type 1 at (0.5, 1.0)
 * under the picker's first-candidate sphere. */
const FINITE_CUBE: SphairahedronAuthored = {
  family: "cube1",
  za: 0.5,
  zb: 1.0,
  inversion: { cx: 1 / 6, cy: -1, cz: -Math.sqrt(3) / 6, r: 2 / 3 },
};

describe("sphairahedron-sample (the walk and the sweep)", () => {
  it("is deterministic in (construction, count, rng)", () => {
    const construction = constructionOf(FINITE_CUBE);
    const a = sampleSphairahedronCloud(construction, 2000, mulberry32(7));
    const b = sampleSphairahedronCloud(construction, 2000, mulberry32(7));
    expect(a.count).toBe(b.count);
    expect(a.positions).toEqual(b.positions);
    expect(a.faces).toEqual(b.faces);
    // A different seed moves the sample.
    const c = sampleSphairahedronCloud(construction, 2000, mulberry32(8));
    expect(Array.from(c.positions)).not.toEqual(Array.from(a.positions));
  });

  it("scatters onto the estimator's zero set — the study's Points-stance measurement", () => {
    const construction = constructionOf(FINITE_CUBE);
    const de = buildSphairahedronDE(construction);
    const cloud = sampleSphairahedronCloud(construction, 5000, mulberry32(11));
    expect(cloud.count).toBeGreaterThan(4000);
    let sum = 0;
    for (let i = 0; i < cloud.count; i++) {
      const p: Vec3 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
      ];
      sum += Math.abs(estimateSphairahedronDistance(de, p));
    }
    // f64 sampler: the study measured mean |de| 1.2e-17 on this subject;
    // the bound here holds four orders of headroom for the f32 wire.
    expect(sum / cloud.count).toBeLessThan(1e-5);
  }, 60_000);

  it("colors by the walk's last-applied face, one slot per fold face", () => {
    const construction = constructionOf(FINITE_CUBE);
    const faceCount = construction.foldFaces.length;
    const cloud = sampleSphairahedronCloud(construction, 3000, mulberry32(3));
    expect(cloud.count).toBeGreaterThan(1000);
    const seen = new Set<number>();
    for (let i = 0; i < cloud.count; i++) {
      const face = cloud.faces[i];
      expect(face).toBeLessThan(faceCount);
      seen.add(face);
    }
    // Every face that can produce points does (the walk is uniform over
    // faces; a face that never appeared would mean a broken pick).
    expect(seen.size).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("walks the finite 4D construction the same way and keeps w", () => {
    const construction = constructionOf({
      family: "tetra4",
      inversion: { cx: 0, cy: -1.4, cz: 0, cw: 0.3, r: 1.4 },
    });
    const de = buildSphairahedronDE4(construction);
    const cloud = sampleSphairahedronCloud(construction, 2000, mulberry32(5));
    expect(cloud.count).toBeGreaterThan(1000);
    if (!("w" in cloud)) throw new Error("4D cloud must carry w");
    let sum = 0;
    for (let i = 0; i < cloud.count; i++) {
      const p: Vec4 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i],
      ];
      sum += Math.abs(estimateSphairahedronDistance4(de, p));
    }
    expect(sum / cloud.count).toBeLessThan(1e-5);
  }, 60_000);

  it("caps the draw at SPHAIRAHEDRON_POINTS_MAX", () => {
    const construction = constructionOf(FINITE_CUBE);
    // Far past the cap: the draw stops at SPHAIRAHEDRON_POINTS_MAX.
    const cloud = sampleSphairahedronCloud(
      construction,
      4_000_000,
      mulberry32(1),
    );
    expect(cloud.count).toBe(SPHAIRAHEDRON_POINTS_MAX);
  }, 120_000);

  it("sweeps the INFINITE tetra onto its divide plane — the walk's replacement arm", () => {
    // The tetra333's limit set IS the plane y = 0 (the analytic anchor:
    // every generator leaves the plane fixed, and the tiles fill the side
    // below it), and the sweep's columns bisect the estimate's sign flip
    // onto that plane. The walk kept NOTHING here (measured: greedy fold
    // depths 0-4 on either RNG stream).
    const construction = constructionOf({ family: "tetra333" });
    const de = buildSphairahedronDE(construction);
    const cloud = sampleSphairahedronCloud(construction, 2000, mulberry32(11));
    expect(cloud.count).toBe(2000);
    const abs: number[] = [];
    for (let i = 0; i < cloud.count; i++) {
      // The plane identity: the kept points' y is the bisection's fp limit.
      expect(Math.abs(cloud.positions[i * 3 + 1])).toBeLessThan(1e-6);
      const p: Vec3 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
      ];
      abs.push(Math.abs(estimateSphairahedronDistance(de, p)));
    }
    abs.sort((a, b) => a - b);
    // On the estimator's zero set (the capped-band recomputes are weak but
    // still small; the y check above is the honest one).
    expect(abs[Math.floor(abs.length * 0.95)]).toBeLessThan(1e-6);
    expect(abs[abs.length - 1]).toBeLessThan(1e-2);
  }, 60_000);

  it("sweeps the 4D tetra onto its hyperplane and keeps w", () => {
    const construction = constructionOf({ family: "tetra4" });
    const de = buildSphairahedronDE4(construction);
    const cloud = sampleSphairahedronCloud(construction, 2000, mulberry32(5));
    expect(cloud.count).toBe(2000);
    if (!("w" in cloud)) throw new Error("4D cloud must carry w");
    let sum = 0;
    for (let i = 0; i < cloud.count; i++) {
      expect(Math.abs(cloud.positions[i * 3 + 1])).toBeLessThan(1e-6);
      const p: Vec4 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i],
      ];
      sum += Math.abs(estimateSphairahedronDistance4(de, p));
    }
    expect(sum / cloud.count).toBeLessThan(1e-5);
  }, 60_000);

  it("sweeps the prism terrain with relief, not the flat divide", () => {
    // The prism's limit set is the snowball terrain: the sweep's kept
    // points undulate across the divide plane's tilt (measured |y| p50 1.6,
    // max 2.0 at the default z2 = 2) — a flat cloud would mean the sweep
    // found the divide's own neighborhood, not the set.
    const construction = constructionOf({ family: "prism2", z2: 2 });
    const de = buildSphairahedronDE(construction);
    const cloud = sampleSphairahedronCloud(construction, 2000, mulberry32(3));
    // Columns whose top fold caps or that find no flip keep nothing —
    // measured ~99.5% of columns keep on this family.
    expect(cloud.count).toBeGreaterThan(1900);
    let sum = 0;
    let maxAbs = 0;
    for (let i = 0; i < cloud.count; i++) {
      const p: Vec3 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
      ];
      const a = Math.abs(estimateSphairahedronDistance(de, p));
      sum += a;
      maxAbs = Math.max(maxAbs, a);
    }
    expect(sum / cloud.count).toBeLessThan(1e-4);
    expect(maxAbs).toBeLessThan(1e-2);
    const ys = Array.from({ length: cloud.count }, (_, i) =>
      Math.abs(cloud.positions[i * 3 + 1]),
    );
    expect(Math.max(...ys)).toBeGreaterThan(0.2);
  }, 60_000);

  it("sweeps the sphere-less cube's height field wide, where the walk drew a speck", () => {
    // Measured on the shipped walk: the sphere-less cube1 kept 97% of a
    // 40k budget with every point inside a ~0.1 box — an absorbing
    // deep-fold region (a single limit-set speck), not a sample. The sweep
    // covers the set's extent instead.
    const construction = constructionOf({ family: "cube1" });
    const de = buildSphairahedronDE(construction);
    const cloud = sampleSphairahedronCloud(construction, 2000, mulberry32(7));
    expect(cloud.count).toBeGreaterThan(1900);
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    for (let i = 0; i < cloud.count; i++) {
      lo = Math.min(lo, cloud.positions[i * 3]);
      hi = Math.max(hi, cloud.positions[i * 3]);
      const p: Vec3 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
      ];
      sum += Math.abs(estimateSphairahedronDistance(de, p));
    }
    expect(hi - lo).toBeGreaterThan(1);
    expect(sum / cloud.count).toBeLessThan(1e-4);
  }, 60_000);

  it("sweep is deterministic in (construction, count, rng), and slots name real faces", () => {
    const construction = constructionOf({ family: "prism2", z2: 1.5 });
    const a = sampleSphairahedronCloud(construction, 500, mulberry32(13));
    const b = sampleSphairahedronCloud(construction, 500, mulberry32(13));
    expect(a.count).toBe(b.count);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    const c = sampleSphairahedronCloud(construction, 500, mulberry32(14));
    const shared = Math.min(a.count, c.count);
    expect(shared).toBeGreaterThan(0);
    expect(Array.from(c.positions.slice(0, shared * 3))).not.toEqual(
      Array.from(a.positions.slice(0, shared * 3)),
    );
    const faceCount = construction.foldFaces.length;
    for (let i = 0; i < a.count; i++) {
      expect(a.faces[i]).toBeLessThan(faceCount);
    }
  }, 60_000);

  it("pins the sweep's scan and bisection constants", () => {
    // The sweep's coverage and kept-point placement figures are measured
    // at these values (the sampler module doc); a silent change would
    // invalidate them.
    expect(SPHAIRAHEDRON_SWEEP_SCAN_STEPS).toBe(24);
    expect(SPHAIRAHEDRON_SWEEP_BISECT_STEPS).toBe(30);
  });

  it("keeps only deep folds (the acceptance threshold is the study's 24)", () => {
    // The threshold constant is the contract between the walk and the
    // study's measurement; pin it so a silent change cannot invalidate the
    // zero-set figures above.
    expect(SPHAIRAHEDRON_POINTS_MIN_FOLDS).toBe(24);
  });
});
