/**
 * Reopens Space tiling + kaleidoscope with the existing nearest-copy theorem.
 *
 * Let A_K be the attractor of the ordinary symmetry-expanded IFS. Whenever
 * its public DE_K bounds distance to A_K, including the inverse descent's
 * entire sector sweep, the existing theorem gives
 *
 *   DE_K(F_T(q)) <= d(F_T(q), A_K)
 *                <= d(F_T(q), A_K intersect C) = d(q, T).
 *
 * This does not certify the finite-width core anew: its measured erosion is
 * reported beside the wrapper's added error below. A_K need not be in C,
 * and F_T need not commute with any kaleidoscope
 * rotation. The chamber restriction belongs to the content S, exactly as in
 * tiling.harness.ts, never to the core's constituent maps. The lattice adds
 * its existing enclosing-ball max, so the same inclusion chain applies.
 *
 * Instruments: independently materialized finite/lattice images pin the
 * nearest-copy identity; ordinary symmetry-expanded clouds pin the public
 * tiled estimator, origin bound and wall behavior; the actual bounded Points
 * recorders retain source points from that SAME ordinary orbit and emit true
 * images. Noncommuting rotations are an explicit negative control. The two
 * dimensions are measured together; 4D uses a genuine xw rotation and twist.
 * No engine, resolver or rendering gate is bypassed in application code.
 *
 * A cloud approximates a subset oracle, subject to finite warmup and f32
 * coordinate storage. A counted overshoot needs those errors checked before
 * being called a geometric violation. Absence is evidence, not proof. Wall
 * candidates use the shared renderer's epsilon and are reported separately
 * from verified walls; each candidate is rechecked against eight times the
 * ordinary sample. The preview is the shared renderer, never a new marcher.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/tiling-symmetry.harness.ts
 * Optional: CLOUD=200000 SIZE=200 PROBES=400 (defaults). SIZE changes the
 * marcher's real acceptance, so coarse sizes can expose the known wall
 * hazard; do not enlarge the geometric-distance threshold to hide it.
 *
 * Lattice previews intentionally show the unchanged central cell; explicit
 * remote-image probes own that arm's negative control.
 *
 * MEASURED 2026-09-08, Node 22.22.0, defaults, 32.8s: all four rows pass.
 * Zero 1,600 sampled off-set oversteps; nearest explicit-image identity error
 * <= 3.6e-15; noncommuting rotation controls differ by 2.9--7.4R. Three wall
 * candidates clear against 1.6M source samples. Both bounded Points twins
 * emit 512/512 images from the unchanged ordinary orbit, max image error
 * < 9e-7. A3/A4 previews change 20.46%/16.77% of pixels; all eight panels
 * exhaust zero rays. The core's existing on-source erosion is 0.28--0.90%R,
 * with zero added error at canonical sources and remote explicit-image
 * transport error <= 5.8e-16 over 48 probes per row. This qualifies the
 * composition's measured preservation, not a new proof of the core's DE.
 */
import {
  runChaosGame,
  runChaosGameTiledPoints,
  symmetryRotation,
} from "../src/fractal/chaos-game";
import {
  runChaosGame4,
  runChaosGame4TiledPoints,
} from "../src/fractal/chaos-game-4d";
import { symmetryRotation4, toTransform4 } from "../src/fractal/affine4";
import { pentatope, sierpinskiTetrahedron } from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
  surfaceOriginVisibleRadius,
} from "../src/fractal/surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4Refined,
} from "../src/fractal/surface-de-4d";
import {
  estimateDistance4RefinedTiled,
  estimateDistanceRefinedTiled,
} from "../src/fractal/tiling-de";
import {
  enumerateOrbit,
  foldLattice3,
  foldLattice4,
  foldToChamber,
  isInChamber,
  isResolvedLatticeTiling,
  resolveTiling,
} from "../src/fractal/tiling";
import type { ResolvedTiling, TilingSpec } from "../src/fractal/tiling";
import { resolvePointTilingPlan } from "../src/fractal/point-tiling";
import type {
  SymmetryParams,
  Transform,
  Vec3,
  Vec4,
} from "../src/fractal/types";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats } from "./de-preview";

const CLOUD = Number(process.env.CLOUD ?? 200_000);
const SIZE = Number(process.env.SIZE ?? 200);
const PROBES = Number(process.env.PROBES ?? 400);
const SEED = 0x71e5_2026;

type Point = Vec3 | Vec4;
interface Fixture {
  name: string;
  dimension: 3 | 4;
  transforms: Transform[];
  symmetry: SymmetryParams;
  tiling: TilingSpec;
}
const fixtures: Fixture[] = [
  {
    name: "a3-xy3",
    dimension: 3,
    transforms: sierpinskiTetrahedron(),
    symmetry: { order: 3, plane: "xy" },
    tiling: { group: "a3" },
  },
  {
    name: "lattice3-xy3",
    dimension: 3,
    transforms: sierpinskiTetrahedron(),
    symmetry: { order: 3, plane: "xy" },
    tiling: { kind: "lattice", cellScale: 1.5 },
  },
  {
    name: "a4-xw3-twist",
    dimension: 4,
    transforms: pentatope(),
    symmetry: { order: 3, plane: "xw", twist: 1 },
    tiling: { group: "a4" },
  },
  {
    name: "lattice4-xw3-twist",
    dimension: 4,
    transforms: pentatope(),
    symmetry: { order: 3, plane: "xw", twist: 1 },
    tiling: { kind: "lattice", cellScale: 1.5 },
  },
];

function distance(a: Point, b: Point): number {
  let d = 0;
  for (let j = 0; j < a.length; j++) d += (a[j] - b[j]) ** 2;
  return Math.sqrt(d);
}
function nearest(points: Point[], p: Point): number {
  let best = Infinity;
  for (const q of points) {
    let d = 0;
    for (let j = 0; j < p.length; j++) d += (p[j] - q[j]) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
function cloud(f: Fixture, count = CLOUD): Point[] {
  const rng = mulberry32(SEED);
  const run =
    f.dimension === 3
      ? runChaosGame(f.transforms, count, rng, null, f.symmetry)
      : runChaosGame4(
          f.transforms.map(toTransform4),
          count,
          rng,
          null,
          f.symmetry,
        );
  return Array.from({ length: run.count }, (_, i): Point => {
    const p: Vec3 = [
      run.positions[3 * i],
      run.positions[3 * i + 1],
      run.positions[3 * i + 2],
    ];
    return "w" in run ? [...p, run.w[i]] : p;
  });
}
function fold(t: ResolvedTiling, p: Point): Point {
  if (isResolvedLatticeTiling(t)) {
    return p.length === 3
      ? foldLattice3(p, t.h, [0, 0, 0])
      : foldLattice4(p, t.h, [0, 0, 0, 0]);
  }
  const result = foldToChamber(
    t.info,
    p,
    p.length === 3 ? [0, 0, 0] : [0, 0, 0, 0],
  );
  if (!result) throw new Error("A proven finite fold failed to terminate");
  return result;
}
function content(t: ResolvedTiling, points: Point[]): Point[] {
  return points.filter((p) =>
    isResolvedLatticeTiling(t)
      ? Math.hypot(...p) <= t.radius
      : isInChamber(t.info, p),
  );
}

/** Explicit group closure and independent integer-cell images, not the
 * runtime point-plan table or a folded query. Only a small source subset is
 * needed to test the identity; both sides read exactly that same subset. */
function explicitImages(t: ResolvedTiling, sources: Point[]): Point[] {
  if (!isResolvedLatticeTiling(t)) {
    return sources.flatMap((p) => {
      const images: number[][] = [];
      enumerateOrbit(t.info, p, images);
      return images as Point[];
    });
  }
  const result: Point[] = [];
  for (const p of sources) {
    for (let x = -3; x <= 3; x++)
      for (let z = -3; z <= 3; z++) {
        for (
          let w = p.length === 4 ? -3 : 0;
          w <= (p.length === 4 ? 3 : 0);
          w++
        ) {
          const q: Vec3 = [
            (-1) ** x * p[0] + 2 * t.h * x,
            p[1],
            (-1) ** z * p[2] + 2 * t.h * z,
          ];
          result.push(
            p.length === 4 ? [...q, (-1) ** w * p[3] + 2 * t.h * w] : q,
          );
        }
      }
  }
  return result;
}
function rotate(f: Fixture, p: Point): Point {
  const angle = (2 * Math.PI) / f.symmetry.order;
  const matrix =
    f.dimension === 3
      ? symmetryRotation(f.symmetry.plane, angle)
      : symmetryRotation4(f.symmetry.plane, angle, f.symmetry.twist ?? 0);
  return p.map((_, row) =>
    p.reduce(
      (sum, value, col) => sum + matrix[row * p.length + col] * value,
      0,
    ),
  ) as Point;
}

it("certifies tiling around the full kaleidoscope attractor in both dimensions", () => {
  const panels: { stats: PanelStats; lines: readonly [string, string] }[] = [];
  for (const f of fixtures) {
    const de3 =
      f.dimension === 3 ? buildSurfaceDE(f.transforms, null, f.symmetry) : null;
    const de4 =
      f.dimension === 4
        ? buildSurfaceDE4(f.transforms, null, f.symmetry)
        : null;
    const de = de3 ?? de4!;
    const radius = surfaceOriginVisibleRadius(de);
    const tiling = resolveTiling(f.tiling, radius)!;
    const plan = resolvePointTilingPlan(tiling, f.dimension)!;
    const ordinary = cloud(f);
    const canonical = content(tiling, ordinary);
    expect(canonical.length, `${f.name} canonical source`).toBeGreaterThan(100);
    const sampleRadius = ordinary.reduce(
      (largest, p) => Math.max(largest, Math.hypot(...p)),
      0,
    );
    expect(sampleRadius, `${f.name} enclosing ball`).toBeLessThanOrEqual(
      radius,
    );
    const evaluate = (p: Point): number =>
      de3
        ? estimateDistanceRefinedTiled(tiling, de3, p as Vec3)
        : estimateDistance4RefinedTiled(tiling, de4!, p as Vec4);
    const plain = (p: Point): number =>
      de3
        ? estimateDistanceRefined(de3, p as Vec3)
        : estimateDistance4Refined(de4!, p as Vec4);
    const rng = mulberry32(SEED + f.dimension);
    const randomPoint = (scale: number): Point =>
      Array.from(
        { length: f.dimension },
        () => (rng() * 2 - 1) * scale * radius,
      ) as Point;
    const subset = Array.from(
      { length: 12 },
      (_, i) => canonical[Math.floor((i * canonical.length) / 12)],
    );
    const images = explicitImages(tiling, subset);
    let identityError = 0;
    let noncommutingGap = 0;
    let remoteTransportError = 0;
    for (let i = 0; i < 64; i++) {
      const p = randomPoint(2.5);
      identityError = Math.max(
        identityError,
        Math.abs(nearest(images, p) - nearest(subset, fold(tiling, p))),
      );
      noncommutingGap = Math.max(
        noncommutingGap,
        distance(fold(tiling, rotate(f, p)), rotate(f, fold(tiling, p))),
      );
    }
    expect(
      identityError,
      `${f.name} explicit nearest-copy identity`,
    ).toBeLessThan(1e-8 * radius);
    expect(
      noncommutingGap,
      `${f.name} noncommuting negative control`,
    ).toBeGreaterThan(0.1 * radius);
    // These are remote images, not just canonical points where the wrapper
    // is identity. Enumerate independently and retain images inside the
    // shared lattice carrier; compare every moved query with its source's
    // own approximate public DE, not with an invented zero-distance oracle.
    for (const source of subset) {
      const orbit = explicitImages(tiling, [source]).filter(
        (p) => Math.hypot(...p) < 8 * radius,
      );
      const sourceEstimate = plain(source);
      for (let i = 0; i < 4; i++) {
        const image = orbit[Math.floor((i * orbit.length) / 4)];
        remoteTransportError = Math.max(
          remoteTransportError,
          Math.abs(evaluate(image) - sourceEstimate),
        );
      }
    }
    expect(
      remoteTransportError,
      `${f.name} remote error transport`,
    ).toBeLessThan(1e-9);

    let overshoots = 0;
    let erosion = 0;
    let baselineErosion = 0;
    let addedErosion = 0;
    let wrapperDelta = 0;
    const wallCandidates: Point[] = [];
    for (let i = 0; i < PROBES; i++) {
      const p =
        i % 2 === 0
          ? randomPoint(2.5)
          : (canonical[i % canonical.length].map(
              (v) => v + (rng() - 0.5) * 0.1 * radius,
            ) as Point);
      const q = fold(tiling, p);
      const trueUpper = nearest(canonical, q);
      const d = evaluate(p);
      if (d > trueUpper + 1e-9) overshoots++;
      wrapperDelta = Math.max(wrapperDelta, Math.abs(d - plain(p)));
      const source = canonical[i % canonical.length];
      const sourceTiled = evaluate(source);
      const sourcePlain = plain(source);
      erosion = Math.max(erosion, sourceTiled);
      baselineErosion = Math.max(baselineErosion, sourcePlain);
      addedErosion = Math.max(addedErosion, sourceTiled - sourcePlain);

      const wall = randomPoint(1.4);
      if (isResolvedLatticeTiling(tiling)) {
        const axis = f.dimension === 3 ? [0, 2][i % 2] : [0, 2, 3][i % 3];
        wall[axis] = (i % 2 === 0 ? 1 : -1) * tiling.h;
      } else {
        const index = i % f.dimension;
        const root = tiling.info.roots.slice(
          index * f.dimension,
          (index + 1) * f.dimension,
        );
        const dot = wall.reduce((sum, v, j) => sum + v * root[j], 0);
        for (let j = 0; j < f.dimension; j++) wall[j] -= dot * root[j];
      }
      const wallUpper = nearest(canonical, fold(tiling, wall));
      // Worst depth inside the preview's canonical-cell sphere, using the
      // exact shared marcher epsilon. This over-reports possible stops.
      const acceptance =
        (1.1 / SIZE) * 0.55 * (Math.hypot(1.55, 1.1, 1.8) + 1) * radius;
      if (evaluate(wall) < acceptance && wallUpper > 0.05 * radius)
        wallCandidates.push(wall);
    }
    let verifiedWalls = 0;
    if (wallCandidates.length > 0) {
      const dense = content(tiling, cloud(f, CLOUD * 8));
      for (const p of wallCandidates)
        if (nearest(dense, fold(tiling, p)) > 0.05 * radius) verifiedWalls++;
    }
    expect(overshoots, `${f.name} off-set overshoots`).toBe(0);
    // The finite-width kaleidoscope descent already erodes some ordinary
    // orbit samples. The new wrapper must transport that error unchanged,
    // and may not enlarge the core's existing approximation.
    expect(addedErosion, `${f.name} added on-source erosion`).toBeLessThan(
      1e-9,
    );
    expect(verifiedWalls, `${f.name} dense-verified false walls`).toBe(0);
    expect(wrapperDelta, `${f.name} tiling changes the set`).toBeGreaterThan(
      0.01 * radius,
    );

    const count = 512;
    const tiled =
      f.dimension === 3
        ? runChaosGameTiledPoints(
            f.transforms,
            count,
            plan,
            mulberry32(SEED),
            null,
            f.symmetry,
          )
        : runChaosGame4TiledPoints(
            f.transforms.map(toTransform4),
            count,
            plan,
            mulberry32(SEED),
            null,
            f.symmetry,
          );
    expect(tiled.count, `${f.name} bounded points`).toBe(count);
    const orbitKeys = new Set(
      ordinary.slice(0, count * 8).map((p) => p.join(",")),
    );
    let pointImageError = 0;
    for (let i = 0; i < tiled.count; i++) {
      const p: Vec3 = [
        tiled.positions[3 * i],
        tiled.positions[3 * i + 1],
        tiled.positions[3 * i + 2],
      ];
      const s: Vec3 = [
        tiled.canonicalPositions[3 * i],
        tiled.canonicalPositions[3 * i + 1],
        tiled.canonicalPositions[3 * i + 2],
      ];
      const image: Point = "w" in tiled ? [...p, tiled.w[i]] : p;
      const source: Point =
        "canonicalW" in tiled ? [...s, tiled.canonicalW[i]] : s;
      expect(
        orbitKeys.has(source.join(",")),
        `${f.name} original orbit provenance`,
      ).toBe(true);
      pointImageError = Math.max(
        pointImageError,
        distance(fold(tiling, image), source),
      );
    }
    expect(pointImageError, `${f.name} true image`).toBeLessThan(3e-6 * radius);

    const lift = (p: Vec3): Point => (f.dimension === 3 ? p : [...p, 0]);
    // Local canonical-cell views deliberately keep lattice presentation out
    // of this mathematical instrument. Its existing browser gate owns 10R.
    const before = renderPreview(
      {
        de: (p) => plain(lift(p)),
        boundingRadius: radius,
        stepScale: 1,
        ao: false,
        shadow: false,
        maxSteps: 400,
      },
      SIZE,
    );
    const after = renderPreview(
      {
        de: (p) => evaluate(lift(p)),
        boundingRadius: radius,
        stepScale: 1,
        ao: false,
        shadow: false,
        maxSteps: 400,
      },
      SIZE,
    );
    panels.push(
      { stats: before, lines: [f.name, "Kaleidoscope"] },
      { stats: after, lines: [f.name, "Kaleidoscope + tiling"] },
    );
    expect(before.hits).toBeGreaterThan(0);
    expect(after.hits).toBeGreaterThan(0);
    let changedPixels = 0;
    for (let i = 0; i < before.rgb.length; i += 3)
      if (
        Math.abs(before.rgb[i] - after.rgb[i]) +
          Math.abs(before.rgb[i + 1] - after.rgb[i + 1]) +
          Math.abs(before.rgb[i + 2] - after.rgb[i + 2]) >
        18
      )
        changedPixels++;
    // A lattice's canonical cell is unchanged; its remote images already
    // supplied the structural negative control above.
    if (!isResolvedLatticeTiling(tiling))
      expect(changedPixels).toBeGreaterThan(SIZE * SIZE * 0.005);
    console.log(
      JSON.stringify({
        fixture: f.name,
        cloud: ordinary.length,
        canonical: canonical.length,
        sampleRadiusOverBound: sampleRadius / radius,
        identityError,
        noncommutingGapOverR: noncommutingGap / radius,
        remoteTransportError,
        probes: PROBES,
        overshoots,
        erosionOverR: erosion / radius,
        baselineErosionOverR: baselineErosion / radius,
        addedErosion,
        wallCandidates: wallCandidates.length,
        verifiedWalls,
        pointImageError,
        points: tiled.count,
        hits: [before.hits, after.hits],
        exhausted: [before.exhausted, after.exhausted],
        changedPixels,
      }),
    );
  }
  console.log(writeLabeledContactSheet(panels, 2, "tiling-symmetry.png"));
});
