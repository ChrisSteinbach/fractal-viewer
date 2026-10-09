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

describe("sphairahedron-sample (the inverse-iteration walk)", () => {
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

  it("draws an INFINITE construction empty — the walk's acceptance never fires there (the disclosed gap)", () => {
    // Measured on the infinite tetra: the face group confines walk points
    // to greedy fold depths of 0-4 moves, so nothing reaches the 24-move
    // acceptance and the cloud is empty. The panel discloses that a finite
    // construction needs its inversion sphere authored.
    const construction = constructionOf({ family: "tetra333" });
    const cloud = sampleSphairahedronCloud(construction, 2000, mulberry32(11));
    expect(cloud.count).toBe(0);
  });

  it("keeps only deep folds (the acceptance threshold is the study's 24)", () => {
    // The threshold constant is the contract between the walk and the
    // study's measurement; pin it so a silent change cannot invalidate the
    // zero-set figures above.
    expect(SPHAIRAHEDRON_POINTS_MIN_FOLDS).toBe(24);
  });
});
