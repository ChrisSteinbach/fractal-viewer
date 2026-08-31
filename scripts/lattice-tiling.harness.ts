/**
 * Phase-2 lattice-tiling decision sheet.
 *
 * QUESTION. Which infinite repetition can one scalar distance-estimator
 * contract carry through the existing primary march, normal taps, shadow
 * probes and AO probes without a special seam state: an affine A1 mirror
 * fold, classic translational opRep, wall-clamped translation, or exact
 * translational neighbour enumeration?
 *
 * FIXTURE. An asymmetric sphere is deliberately wholly inside the canonical
 * x/z cell. Its exact mirrored and translated infinite orbits are elementary,
 * so the candidate estimator cannot share code with its truth oracle. The 4D
 * row repeats x/z/w, leaves y vertical, applies a genuine xw rotor and takes
 * an off-centre w slice. All random rows use fixed seeds.
 *
 * INSTRUMENTS. Soundness compares 50,000 queries with the explicit orbit
 * distance. Seam probes sit exactly on seven translated walls. Pictures use
 * de-preview.ts's shared marcher; its radius-10 ball is a DIAGNOSTIC
 * observation window in cell-half-width units, not a claim that the infinite
 * set is bounded and not the proposed production range. Occupancy uses
 * set-extent.ts against exact membership over a finite radius-4 observation
 * ball; its reach column is likewise local because both infinite sets have
 * globally infinite reach.
 *
 * MEASURED VERDICT (Node 22.23.2, i7-1165G7): SHIP THE MIRROR. It had 0
 * overshoots in 50,000 3D queries and 0 in 20,000 genuinely 4D slice queries,
 * with maximum 4D equality error 8.88e-16. Classic half-open opRep overshot
 * 12,753/50,000 queries by as much as 0.760348. The wall clamp and the 3x3
 * exact-neighbour oracle both had 0 overshoots, but the clamp manufactured
 * 1,407/1,407 false-zero seam samples while true geometry stayed at least
 * 0.504497 away. The shared 160px/160-step preview read hits/exhausted/evals
 * 5,528/0/354,799 mirror, 25,600/0/25,600 clamped translation, and
 * 4,101/0/354,822 exact translation, and 1,672/0/306,218 for the rotated 4D
 * mirror slice: the clamp shades every pixel as a wall.
 * Exact translation is sound but deferred: this deliberately simple oracle
 * spends nine core calls per 3D query, while the directional exact form still
 * needs 2^2 = 4 calls in 3D and 2^3 = 8 in 4D. The mirror spends one core call
 * after two/three fixed scalar folds and has no zero seam to special-case.
 *
 * The finite observation-ball occupancy rows were mirror 0.534058% fill /
 * 3.99910 reach and translation 0.524902% / 3.99449 at 32,768 points. They
 * say the two candidates have comparable local presence; they do NOT assign
 * an extent to an unbounded set. Writes `scripts/out/lattice-tiling.png`.
 */
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { Vec3 } from "./de-preview";
import { sampleSetExtent } from "./set-extent";
import { mulberry32 } from "../src/fractal/rng";
import { mirrorLatticeCoordinate } from "../src/fractal/tiling";

const HALF = 1;
const CELL_WIDTH = 2 * HALF;
const SPHERE_RADIUS = 0.3;
const CENTER3: Vec3 = [0.34, 0.06, 0.21];
const CENTER4 = [0.34, 0.06, 0.21, 0.28] as const;
const SOUNDNESS_POINTS = 50_000;

/** Mathematical modulo retained for the independent translation candidates. */
function mod(x: number, y: number): number {
  return x - y * Math.floor(x / y);
}

/** The landed CPU authority; the explicit-orbit truth below stays independent. */
function mirror1(x: number, h = HALF): number {
  return mirrorLatticeCoordinate(x, h);
}

/** Classic discontinuous opRep into the half-open cell [-h, h). */
function translate1(x: number, h = HALF): number {
  return mod(x + h, 2 * h) - h;
}

function sphere3(p: Vec3): number {
  return (
    Math.hypot(p[0] - CENTER3[0], p[1] - CENTER3[1], p[2] - CENTER3[2]) -
    SPHERE_RADIUS
  );
}

function mirrorDe3(p: Vec3): number {
  return sphere3([mirror1(p[0]), p[1], mirror1(p[2])]);
}

function opRepDe3(p: Vec3): number {
  return sphere3([translate1(p[0]), p[1], translate1(p[2])]);
}

/** Conservative translation repair: sound, but zero on every cell wall. */
function wallDistance3(p: Vec3): number {
  const x = translate1(p[0]);
  const z = translate1(p[2]);
  return Math.max(0, Math.min(HALF - Math.abs(x), HALF - Math.abs(z)));
}

function clampedTranslationDe3(p: Vec3): number {
  return Math.min(opRepDe3(p), wallDistance3(p));
}

/** Simple exact oracle: deliberately exposes the nine-call 3D upper bound. */
function neighborTranslationDe3(p: Vec3): number {
  const x = translate1(p[0]);
  const z = translate1(p[2]);
  let best = Infinity;
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      best = Math.min(
        best,
        sphere3([x + ix * CELL_WIDTH, p[1], z + iz * CELL_WIDTH]),
      );
    }
  }
  return best;
}

/** Explicit mirrored orbit of the asymmetric, cell-contained sphere. */
function trueMirror3(p: Vec3): number {
  let best = Infinity;
  for (let ix = -8; ix <= 8; ix++) {
    for (let iz = -8; iz <= 8; iz++) {
      const cx = CELL_WIDTH * ix + (ix & 1 ? -CENTER3[0] : CENTER3[0]);
      const cz = CELL_WIDTH * iz + (iz & 1 ? -CENTER3[2] : CENTER3[2]);
      best = Math.min(
        best,
        Math.hypot(p[0] - cx, p[1] - CENTER3[1], p[2] - cz) - SPHERE_RADIUS,
      );
    }
  }
  return best;
}

/** Explicit translated orbit; independent of translate1/opRepDe3. */
function trueTranslation3(p: Vec3): number {
  let best = Infinity;
  for (let ix = -8; ix <= 8; ix++) {
    for (let iz = -8; iz <= 8; iz++) {
      best = Math.min(
        best,
        Math.hypot(
          p[0] - (CENTER3[0] + ix * CELL_WIDTH),
          p[1] - CENTER3[1],
          p[2] - (CENTER3[2] + iz * CELL_WIDTH),
        ) - SPHERE_RADIUS,
      );
    }
  }
  return best;
}

/** View p,w0 -> inverse xw rotor -> attractor-frame x/z/w mirror. */
function mirrorDe4Slice(p: Vec3, w0: number, angle: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = c * p[0] + s * w0;
  const w = -s * p[0] + c * w0;
  return (
    Math.hypot(
      mirror1(x) - CENTER4[0],
      p[1] - CENTER4[1],
      mirror1(p[2]) - CENTER4[2],
      mirror1(w) - CENTER4[3],
    ) - SPHERE_RADIUS
  );
}

/** Explicit 4D mirrored orbit in attractor space after the same view lift. */
function trueMirror4Slice(p: Vec3, w0: number, angle: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = c * p[0] + s * w0;
  const w = -s * p[0] + c * w0;
  let best = Infinity;
  for (let ix = -5; ix <= 5; ix++) {
    for (let iz = -5; iz <= 5; iz++) {
      for (let iw = -5; iw <= 5; iw++) {
        const cx = CELL_WIDTH * ix + (ix & 1 ? -CENTER4[0] : CENTER4[0]);
        const cz = CELL_WIDTH * iz + (iz & 1 ? -CENTER4[2] : CENTER4[2]);
        const cw = CELL_WIDTH * iw + (iw & 1 ? -CENTER4[3] : CENTER4[3]);
        best = Math.min(
          best,
          Math.hypot(x - cx, p[1] - CENTER4[1], p[2] - cz, w - cw) -
            SPHERE_RADIUS,
        );
      }
    }
  }
  return best;
}

function countOvershoot(
  estimate: (p: Vec3) => number,
  truth: (p: Vec3) => number,
): { count: number; max: number } {
  const rng = mulberry32(0x1a771ce);
  let count = 0;
  let max = 0;
  for (let i = 0; i < SOUNDNESS_POINTS; i++) {
    const p: Vec3 = [
      (rng() - 0.5) * 12,
      (rng() - 0.5) * 2.2,
      (rng() - 0.5) * 12,
    ];
    const excess = estimate(p) - truth(p);
    if (excess > 1e-10) {
      count++;
      max = Math.max(max, excess);
    }
  }
  return { count, max };
}

describe("lattice tiling route decision", () => {
  it("refuses opRep and keeps both certified candidates conservative", () => {
    const mirror = countOvershoot(mirrorDe3, trueMirror3);
    const opRep = countOvershoot(opRepDe3, trueTranslation3);
    const clamp = countOvershoot(clampedTranslationDe3, trueTranslation3);
    const neighbors = countOvershoot(neighborTranslationDe3, trueTranslation3);
    console.log("3D soundness", { mirror, opRep, clamp, neighbors });

    expect(mirror).toEqual({ count: 0, max: 0 });
    expect(clamp).toEqual({ count: 0, max: 0 });
    expect(neighbors).toEqual({ count: 0, max: 0 });
    expect(opRep.count).toBe(12_753);
    expect(opRep.max).toBeCloseTo(0.7603477733, 9);
  });

  it("finds the clamp's false geometry and pins the mirror boundary", () => {
    let falseZeros = 0;
    let mirrorFalseZeros = 0;
    let minTruth = Infinity;
    for (let i = -100; i <= 100; i++) {
      const y = (i / 100) * 0.8;
      for (let k = -3; k <= 3; k++) {
        const p: Vec3 = [HALF + CELL_WIDTH * k, y, 0.67];
        const truth = trueTranslation3(p);
        minTruth = Math.min(minTruth, truth);
        if (clampedTranslationDe3(p) <= 1e-12 && truth > 0.05) {
          falseZeros++;
        }
        if (mirrorDe3(p) <= 1e-12 && trueMirror3(p) > 0.05) {
          mirrorFalseZeros++;
        }
      }
    }
    console.log("seams and cost", {
      clampFalseZeros: falseZeros,
      mirrorFalseZeros,
      minTrueTranslationDistance: minTruth,
      coreCalls3d: { mirror: 1, exactPrototype: 9, exactDirectional: 4 },
      coreCalls4d: { mirror: 1, exactDirectional: 8 },
    });

    expect(falseZeros).toBe(1_407);
    expect(mirrorFalseZeros).toBe(0);
    expect(minTruth).toBeCloseTo(0.5044973586, 9);

    // Both sides meet at the same chamber point: no zero seam and no jump.
    for (const wall of [-HALF, HALF]) {
      const left = mirror1(wall - 1e-9);
      const at = mirror1(wall);
      const right = mirror1(wall + 1e-9);
      expect(left).toBeCloseTo(at, 8);
      expect(right).toBeCloseTo(at, 8);
    }

    // The chosen presentation window never asks f32 shaders for a huge-cell
    // modulo. Pin the CPU identity through a much larger diagnostic index.
    for (const n of [-2_048, -127, 127, 2_048]) {
      expect(mirror1(0.371 + 4 * HALF * n)).toBeCloseTo(mirror1(0.371), 10);
    }
  });

  it("renders candidates with the shared marcher and measures local occupancy", () => {
    const angle = 0.63;
    const w0 = 0.37;
    const defs = [
      ["MIRROR 3D", mirrorDe3],
      ["CLAMP FALSE WALL", clampedTranslationDe3],
      ["EXACT TRANSLATE", neighborTranslationDe3],
      ["MIRROR 4D SLICE", (p: Vec3) => mirrorDe4Slice(p, w0, angle)],
    ] as const;
    const panels = defs.map(([name, de]) => {
      const stats = renderPreview(
        {
          de,
          // An observation window around a camera deliberately placed among
          // the copies. It is not a finite object bound.
          boundingRadius: 10,
          target: [0, 0, 0],
          eyeOffset: [0.26, 0.18, 0.3],
          stepScale: 0.9,
          maxSteps: 160,
          collect: true,
        },
        160,
      );
      console.log(name, {
        hits: stats.hits,
        exhausted: stats.exhausted,
        evals: stats.evals,
        ms: stats.ms,
      });
      return {
        stats,
        lines: [name, `H${stats.hits} E${stats.exhausted}`] as const,
      };
    });
    const file = writeLabeledContactSheet(panels, 2, "lattice-tiling.png");
    const mirrorExtent = sampleSetExtent((p) => trueMirror3(p) <= 0, {
      fillRadius: 4,
      points: 32_768,
    });
    const translationExtent = sampleSetExtent((p) => trueTranslation3(p) <= 0, {
      fillRadius: 4,
      points: 32_768,
    });
    console.log("preview and finite-window occupancy", {
      file,
      mirrorExtent,
      translationExtent,
    });

    expect(
      panels.map(({ stats }) => [stats.hits, stats.exhausted, stats.evals]),
    ).toEqual([
      [5_528, 0, 354_799],
      [25_600, 0, 25_600],
      [4_101, 0, 354_822],
      [1_672, 0, 306_218],
    ]);
    expect(mirrorExtent.fillPct).toBeCloseTo(0.5340576172, 9);
    expect(mirrorExtent.reachAbs).toBeCloseTo(3.999102646, 9);
    expect(translationExtent.fillPct).toBeCloseTo(0.5249023438, 9);
    expect(translationExtent.reachAbs).toBeCloseTo(3.9944922418, 9);
  });

  it("keeps x/z/w mirroring exact under a live 4D rotor and slice", () => {
    const rng = mulberry32(0x4d511ce);
    const angle = 0.63;
    const w0 = 0.37;
    let violations = 0;
    let maxError = 0;
    for (let i = 0; i < 20_000; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 10,
        (rng() - 0.5) * 2,
        (rng() - 0.5) * 10,
      ];
      const error =
        mirrorDe4Slice(p, w0, angle) - trueMirror4Slice(p, w0, angle);
      if (error > 1e-10) violations++;
      maxError = Math.max(maxError, Math.abs(error));
    }
    console.log("4D rotor/slice", { angle, w0, violations, maxError });
    expect(violations).toBe(0);
    expect(maxError).toBeLessThan(1e-14);
  });
});
