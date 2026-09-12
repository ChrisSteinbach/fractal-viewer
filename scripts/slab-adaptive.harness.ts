/**
 * Can continuous subdivision recover Surface thickness through nonlinear
 * folds and reflection tiling without the old whole-slab dilation?
 *
 * This is an EXPERIMENT, not a production estimator. Every leaf covers a
 * real interval of the original query segment. If d(q) bounds distance to A,
 * max(0, d(mid) - halfLength) bounds distance from that interval to A by the
 * triangle inequality. Taking the minimum over a complete interval cover is
 * therefore safe, without assuming that the estimator itself is Lipschitz.
 *
 * A sampled distance is NOT a true-distance upper bound. It is an acceptance
 * witness from the existing point estimator. Subdivision stops only when the
 * returned lower bound is close to such a witness. Thus the allowed extra
 * dilation is tied to pixel tolerance, never to the authored slab thickness.
 * This inherits the point estimator's approximation; it does not certify its
 * hit predicate or make a finite chaos cloud a membership oracle.
 *
 * Work-limit exhaustion is a separate result and NEVER a hit or a miss. A
 * production port would need bounded continuation for primary and shading
 * queries, or evidence that an admitted domain cannot reach that limit.
 * No existing slab refusal is changed by this sheet.
 *
 * Run:
 * npx vitest run --config scripts/vitest.harness.config.ts scripts/slab-adaptive.harness.ts
 * SLAB_SIZE=64 changes only the contact-sheet raster (default 32).
 * SLAB_CASE=TILING selects fixture names by substring.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rotationMatrix4 } from "../src/fractal/affine4";
import { inversionBallScale } from "../src/fractal/inversion";
import { pentatope, sixteenCellFlake } from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  buildSurfaceDE4,
  estimateDistance4,
  estimateDistance4Refined,
  deHasFolds4,
  slabExact4,
} from "../src/fractal/surface-de-4d";
import type { SurfaceDE4 } from "../src/fractal/surface-de-4d";
import { estimateDistance4RefinedTiled } from "../src/fractal/tiling-de";
import {
  enumerateOrbit,
  foldToChamber,
  resolveTiling,
  TILING_GROUP_INFO,
  TILING_GROUPS,
} from "../src/fractal/tiling";
import type { TilingGroupInfo } from "../src/fractal/tiling";
import type { Transform, Vec3, Vec4 } from "../src/fractal/types";
import {
  PREVIEW_HIT,
  renderPreview,
  writeLabeledContactSheet,
} from "./de-preview";
import type { PanelStats } from "./de-preview";

interface SegmentResult {
  lower: number;
  witness: number;
  evaluations: number;
  complete: boolean;
}

/** Reused depth-first stack. The callback reads the ORIGINAL segment's
 * normalized coordinate, so every nonlinear map remains inside that callback.
 * Sibling intervals meet exactly at their shared endpoint. The acceptance
 * threshold w - tolerance(w) must be nondecreasing: a smaller witness must
 * never invalidate the decision to discard an earlier interval. */
function makeAdaptiveSegmentQuery() {
  const centers = new Float64Array(64);
  const widths = new Float64Array(64);
  const floors = new Float64Array(64);
  return (
    distance: (s: number) => number,
    halfLength: number,
    tolerance: (witness: number) => number,
    maxEvaluations = 65_535,
  ): SegmentResult => {
    if (halfLength === 0) {
      const d = distance(0);
      if (!Number.isFinite(d)) throw new Error("Nonfinite point certificate");
      return { lower: d, witness: d, evaluations: 1, complete: true };
    }
    let evaluations = 0;
    let witness = Infinity;
    const sample = (s: number): number => {
      evaluations++;
      const d = Math.max(0, distance(s));
      if (!Number.isFinite(d)) throw new Error("Nonfinite point certificate");
      witness = Math.min(witness, d);
      return d;
    };
    const root = sample(0);
    let count = 1;
    centers[0] = 0;
    widths[0] = 1;
    floors[0] = Math.max(0, root - halfLength);
    let discarded = Infinity;
    while (count > 0) {
      const index = --count;
      const center = centers[index];
      const width = widths[index];
      const lower = floors[index];
      if (lower >= witness - tolerance(witness)) {
        discarded = Math.min(discarded, lower);
        continue;
      }
      if (evaluations + 2 > maxEvaluations || count + 2 > centers.length) {
        let remaining = Math.min(discarded, lower, witness);
        for (let i = 0; i < count; i++)
          remaining = Math.min(remaining, floors[i]);
        return { lower: remaining, witness, evaluations, complete: false };
      }
      const half = width / 2;
      const left = center - half;
      const right = center + half;
      const leftFloor = Math.max(0, sample(left) - half * halfLength);
      const rightFloor = Math.max(0, sample(right) - half * halfLength);
      // Visit the more promising child first; the other stays on the stack.
      const leftFirst = leftFloor <= rightFloor;
      centers[count] = leftFirst ? right : left;
      centers[count + 1] = leftFirst ? left : right;
      widths[count] = widths[count + 1] = half;
      floors[count] = leftFirst ? rightFloor : leftFloor;
      floors[count + 1] = leftFirst ? leftFloor : rightFloor;
      count += 2;
    }
    return {
      lower: Math.min(discarded, witness),
      witness,
      evaluations,
      complete: true,
    };
  };
}

/** Continuous threshold: fixed accuracy through 4 pixel epsilons, growing
 * toward a 25% relative gap farther away. A discontinuous switch to w/4 at
 * 4 epsilon would invalidate earlier pruning when the witness decreases. */
function slabTolerance(witness: number, epsilon: number): number {
  return epsilon / 16 + Math.max(0, witness - 4 * epsilon) / 4;
}

function segmentToBall(
  center: number[],
  extent: number[],
  radius: number,
): number {
  const ee = extent.reduce((sum, n) => sum + n * n, 0);
  const dot = center.reduce((sum, n, i) => sum + n * extent[i], 0);
  const s = ee === 0 ? 0 : Math.max(-1, Math.min(1, -dot / ee));
  return Math.max(
    0,
    Math.hypot(...center.map((n, i) => n + s * extent[i])) - radius,
  );
}

/** Every mirror normal is an image of a simple root. Antipodal roots define
 * the same hyperplane. A straight segment meets each such hyperplane at most
 * once, so at most maxWordLength + 1 pieces are needed (25 for F4).
 * This is build-time work, not a per-query group enumeration. */
function reflectionWalls(info: TilingGroupInfo): number[][] {
  const walls: number[][] = [];
  const orbit: number[][] = [];
  for (let i = 0; i < info.dim; i++) {
    const root = info.roots.slice(i * info.dim, (i + 1) * info.dim) as
      Vec3 | Vec4;
    enumerateOrbit(info, root, orbit);
    for (const image of orbit) {
      const sign = image.find((n) => Math.abs(n) > 1e-10)! < 0 ? -1 : 1;
      const normal = image.map((n) => sign * n);
      if (
        !walls.some((wall) =>
          wall.every((n, j) => Math.abs(n - normal[j]) < 1e-9),
        )
      )
        walls.push(normal);
    }
  }
  return walls;
}

/** Exact finite-fold polyline, apart from the existing fold's FOLD_EPS
 * arithmetic. This prototype deliberately accepts NO clip: separately
 * minimizing a clip SDF and a DE can choose different points on a segment.
 * It also cannot transport a segment through a nonlinear final or base map. */
function foldedSegments(
  info: TilingGroupInfo,
  walls: number[][],
  center: Vec3 | Vec4,
  extent: Vec3 | Vec4,
): { center: number[]; extent: number[]; start: number; end: number }[] {
  const cuts = [-1, 1];
  for (const normal of walls) {
    const denominator = normal.reduce((sum, n, i) => sum + n * extent[i], 0);
    if (denominator === 0) continue;
    const numerator = normal.reduce((sum, n, i) => sum + n * center[i], 0);
    const cut = -numerator / denominator;
    if (cut > -1 && cut < 1) cuts.push(cut);
  }
  cuts.sort((a, b) => a - b);
  const segments = [];
  let start = cuts[0];
  const endpoint = (s: number): number[] => {
    const p = center.map((n, i) => n + s * extent[i]) as Vec3 | Vec4;
    const folded = foldToChamber(info, p, [...p] as Vec3 | Vec4);
    if (folded === null) throw new Error("Finite fold failed");
    return folded;
  };
  let previous = endpoint(start);
  for (const end of cuts.slice(1)) {
    if (end === start) continue;
    const next = endpoint(end);
    segments.push({
      center: previous.map((n, i) => (n + next[i]) / 2),
      extent: previous.map((n, i) => (next[i] - n) / 2),
      start,
      end,
    });
    previous = next;
    start = end;
  }
  return segments;
}

function pointDistance(de: SurfaceDE4, p: Vec4): number {
  return deHasFolds4(de)
    ? estimateDistance4(de, p)
    : estimateDistance4Refined(de, p);
}

describe("adaptive continuous slab experiment", () => {
  it("preserves the exact point-query value at zero thickness", () => {
    const query = makeAdaptiveSegmentQuery();
    for (const value of [-0.25, 0, 0.123456789]) {
      let calls = 0;
      const result = query(
        (s) => {
          expect(s).toBe(0);
          calls++;
          return value;
        },
        0,
        () => 1e-3,
      );
      expect(result.lower).toBe(value);
      expect(result.complete).toBe(true);
      expect(calls).toBe(1);
    }
  });

  it("bounds an independent analytic ball, including a 4D sphere inversion", () => {
    const rng = mulberry32(0x510ce);
    const query = makeAdaptiveSegmentQuery();
    const scale = inversionBallScale(Math.hypot(0.7, -0.2, 0.1, 0.3), 0.12, 1);
    for (const k of [1, scale]) {
      const ballCenter: Vec4 = [0.7 * k, -0.2 * k, 0.1 * k, 0.3 * k];
      const radius = 0.12 * k;
      for (let i = 0; i < 100; i++) {
        const p = Array.from({ length: 4 }, () => 2 * rng() - 1) as Vec4;
        const e = Array.from({ length: 4 }, () => rng() - 0.5) as Vec4;
        const relative = p.map((n, j) => n - ballCenter[j]) as Vec4;
        const truth = segmentToBall(relative, e, radius);
        // Exercise both absolute accuracy and the render's changing
        // acceptance threshold as a better witness is discovered.
        for (const tolerance of [
          () => 1e-4,
          (w: number) => slabTolerance(w, 0.1),
        ]) {
          const result = query(
            (s) => Math.hypot(...relative.map((n, j) => n + s * e[j])) - radius,
            Math.hypot(...e),
            tolerance,
          );
          expect(result.complete).toBe(true);
          expect(result.lower).toBeLessThanOrEqual(truth + 1e-12);
          expect(result.witness - result.lower).toBeLessThanOrEqual(
            tolerance(result.witness) + 1e-12,
          );
        }
      }
    }
  });

  it("separates work exhaustion from geometry on a parallel flat surface", () => {
    const query = makeAdaptiveSegmentQuery();
    const rows = [1e-3, 1e-4, 1e-5].map((tolerance) => {
      const result = query(
        () => 0.01,
        0.5,
        () => tolerance,
        262_143,
      );
      expect(result.complete).toBe(true);
      expect(result.lower).toBeLessThanOrEqual(0.01);
      expect(0.01 - result.lower).toBeLessThanOrEqual(tolerance);
      const capped = query(
        () => 0.01,
        0.5,
        () => tolerance,
        255,
      );
      expect(capped.complete).toBe(false);
      expect(capped.lower).toBeLessThanOrEqual(0.01);
      return { tolerance, ...result };
    });
    console.log("parallel-plane", JSON.stringify(rows));
  });

  it("splits all six finite reflection groups exactly against an explicit orbit", () => {
    const rng = mulberry32(0x71e51ab);
    for (const name of TILING_GROUPS) {
      const info = TILING_GROUP_INFO[name];
      const walls = reflectionWalls(info);
      expect(walls.length).toBe(info.maxWordLength);
      const seed = [0.81, -0.27, 0.43, 0.19].slice(0, info.dim) as Vec3 | Vec4;
      const canonical = foldToChamber(info, seed, [...seed] as Vec3 | Vec4)!;
      const orbit: number[][] = [];
      enumerateOrbit(info, canonical, orbit);
      let maximumPieces = 0;
      for (let i = 0; i < 60; i++) {
        const center = Array.from({ length: info.dim }, () => rng() * 2 - 1) as
          Vec3 | Vec4;
        const extent = Array.from(
          { length: info.dim },
          () => rng() * 1.5 - 0.75,
        ) as Vec3 | Vec4;
        const segments = foldedSegments(info, walls, center, extent);
        maximumPieces = Math.max(maximumPieces, segments.length);
        expect(segments.length).toBeLessThanOrEqual(info.maxWordLength + 1);
        const truth = Math.min(
          ...orbit.map((member) =>
            segmentToBall(
              center.map((n, j) => n - member[j]),
              extent,
              0,
            ),
          ),
        );
        const folded = Math.min(
          ...segments.map((part) =>
            segmentToBall(
              part.center.map((n, j) => n - canonical[j]),
              part.extent,
              0,
            ),
          ),
        );
        expect(Math.abs(folded - truth)).toBeLessThan(4e-6);
        for (const part of segments) {
          // Compare interior points too: equal endpoint folds alone cannot
          // reveal a missing chamber crossing.
          for (const t of [-0.75, -0.25, 0.25, 0.75]) {
            const s =
              (part.start + part.end) / 2 + (t * (part.end - part.start)) / 2;
            const q = center.map((n, j) => n + s * extent[j]) as Vec3 | Vec4;
            const expected = foldToChamber(info, q, [...q] as Vec3 | Vec4)!;
            const actual = part.center.map((n, j) => n + t * part.extent[j]);
            expect(
              Math.hypot(...actual.map((n, j) => n - expected[j])),
            ).toBeLessThan(4e-6);
          }
        }
      }
      console.log(
        JSON.stringify({ group: name, mirrors: walls.length, maximumPieces }),
      );
    }
  });

  it("compares real 4D folded and tiled slabs with the existing exact controls", () => {
    const size = Number(process.env.SLAB_SIZE ?? 32);
    if (!Number.isInteger(size) || size < 32)
      throw new Error("SLAB_SIZE must be an integer of at least 32");
    const final = (type: "boxfold" | "mandelbox"): Transform => ({
      id: 99,
      position: [0.15, -0.1, 0.05],
      rotation: [0.2, 0.3, 0.1],
      scale: [0.9, 0.9, 0.9],
      w: { rotation: { yw: 0.2 } },
      variations: [{ type, weight: 0.55 }],
    });
    // This pentatope is aligned with tiling.ts's A4 chamber, matching the
    // production surface-tiling gate. The standard menu pentatope has a
    // different orientation; an empty chamber would be a vacuous success.
    const tiledMaps: Transform[] = [
      [-0.6325, -0.3651, -0.2582, -0.2],
      [0.6325, -0.3651, -0.2582, -0.2],
      [0, 0.7303, -0.2582, -0.2],
      [0, 0, 0.7746, -0.2],
      [0, 0, 0, 0.8],
    ].map(([x, y, z, w], id) => ({
      id,
      position: [x, y, z],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      w: { position: w },
    }));
    const cases = [
      { name: "AFFINE", de: buildSurfaceDE4(sixteenCellFlake()), tiled: false },
      {
        name: "BOX FINAL",
        de: buildSurfaceDE4(pentatope(), final("boxfold")),
        tiled: false,
      },
      {
        name: "MANDEL FINAL",
        de: buildSurfaceDE4(pentatope(), final("mandelbox")),
        tiled: false,
      },
      { name: "A4 TILING", de: buildSurfaceDE4(tiledMaps), tiled: true },
      {
        name: "A4 MANDEL",
        de: buildSurfaceDE4(tiledMaps, final("mandelbox")),
        tiled: true,
      },
      {
        name: "SPHERE MAPS",
        de: buildSurfaceDE4([
          {
            id: 0,
            position: [0.3, 0.1, 0],
            rotation: [0.3, 0.2, 0],
            scale: [0.12, 0.12, 0.12],
            w: { rotation: { xw: 0.45 } },
            variations: [{ type: "spherefold", weight: 0.9 }],
          },
          {
            id: 1,
            position: [-0.25, -0.2, 0.2],
            rotation: [0, 0.5, 0.1],
            scale: [0.11, 0.11, 0.11],
            w: { rotation: { yw: 0.4 } },
            variations: [{ type: "spherefold", weight: 1.1 }],
          },
        ]),
        tiled: false,
      },
    ];
    const rotor = rotationMatrix4({ xw: 0.47, yw: -0.28, zw: 0.19 });
    const panels: { stats: PanelStats; lines: [string, string] }[] = [];
    const rows: object[] = [];
    for (const fixture of cases.filter(
      (item) =>
        !process.env.SLAB_CASE || item.name.includes(process.env.SLAB_CASE),
    )) {
      const { de } = fixture;
      const radius = de.visibleBoundingRadius;
      const halfW = 0.25 * radius;
      const w0 = 0.08 * radius;
      const extent = [3, 7, 11, 15].map((i) => rotor[i] * halfW) as Vec4;
      const tiling = resolveTiling({ group: "a4" })!;
      const walls = reflectionWalls(tiling.info);
      const point = (p: Vec4) =>
        fixture.tiled
          ? estimateDistance4RefinedTiled(tiling, de, p)
          : pointDistance(de, p);
      const lift = (p: Vec3, w: number): Vec4 =>
        [0, 1, 2, 3].map(
          (i) =>
            rotor[4 * i] * p[0] +
            rotor[4 * i + 1] * p[1] +
            rotor[4 * i + 2] * p[2] +
            rotor[4 * i + 3] * w,
        ) as Vec4;
      const query = makeAdaptiveSegmentQuery();
      const counts: number[] = [];
      const adaptive = (p: Vec3, eps: number) => {
        const result = query(
          (s) => point(lift(p, w0 + s * halfW)),
          halfW,
          (witness) => slabTolerance(witness, eps),
        );
        counts.push(result.evaluations);
        if (!result.complete)
          throw new Error(`${fixture.name}: incomplete slab query`);
        return result.lower;
      };
      const arms = ["POINT", "BALL", "ADAPTIVE"];
      if (slabExact4(de)) arms.push(fixture.tiled ? "SPLIT" : "SEGMENT");
      const local = new Map<string, PanelStats>();
      for (const arm of arms) {
        const started = counts.length;
        const distance = (p: Vec3) => {
          const q = lift(p, w0);
          if (arm === "SEGMENT") {
            counts.push(1);
            return estimateDistance4Refined(de, q, 0, extent);
          }
          if (arm === "SPLIT") {
            const pieces = foldedSegments(tiling.info, walls, q, extent);
            counts.push(pieces.length);
            return Math.min(
              ...pieces.map((piece) =>
                estimateDistance4Refined(
                  de,
                  piece.center as Vec4,
                  0,
                  piece.extent as Vec4,
                ),
              ),
            );
          }
          if (arm === "ADAPTIVE") return adaptive(p, radius * 0.002);
          counts.push(1);
          return Math.max(0, point(q) - (arm === "BALL" ? halfW : 0));
        };
        const panel = renderPreview(
          {
            de: distance,
            ...(arm === "ADAPTIVE"
              ? {
                  march: (p: Vec3, epsilon: number) => {
                    const d = adaptive(p, epsilon);
                    return { d, stride: d };
                  },
                }
              : {}),
            boundingRadius: radius,
            stepScale: de.stepScale,
            ao: false,
            shadow: false,
            collect: true,
            maxSteps: 256,
            minimumStepFraction: 0,
          },
          size,
        );
        local.set(arm, panel);
        expect(panel.hits, `${fixture.name} ${arm} must draw`).toBeGreaterThan(
          0,
        );
        expect(panel.exhausted, `${fixture.name} ${arm} must finish`).toBe(0);
        const samples = counts.slice(started).sort((a, b) => a - b);
        const row = {
          name: fixture.name,
          arm,
          size,
          hits: panel.hits,
          exhausted: panel.exhausted,
          ms: panel.ms,
          primaryQueries: panel.evals,
          allQueries: samples.length,
          coreCalls: samples.reduce((sum, n) => sum + n, 0),
          callsP50: samples[Math.floor(samples.length * 0.5)] ?? 0,
          callsP99: samples[Math.floor(samples.length * 0.99)] ?? 0,
          callsMax: samples.at(-1) ?? 0,
        };
        rows.push(row);
        console.log(JSON.stringify(row));
        panels.push({
          stats: panel,
          lines: [
            fixture.name
              .replace("MANDEL", "MAND")
              .replace("SPHERE MAPS", "SPH MAPS"),
            arm,
          ],
        });
      }
      expect(local.get("ADAPTIVE")!.hits).toBeGreaterThan(
        local.get("POINT")!.hits,
      );
      if (arms.length < 4) {
        const pointPanel = local.get("POINT")!;
        panels.push({
          stats: { ...pointPanel, rgb: new Uint8Array(pointPanel.rgb.length) },
          lines: [
            fixture.name
              .replace("MANDEL", "MAND")
              .replace("SPHERE MAPS", "SPH MAPS"),
            "NO EXACT",
          ],
        });
      }
      const reference = local.get("SEGMENT") ?? local.get("SPLIT");
      if (reference) {
        for (const arm of ["POINT", "BALL", "ADAPTIVE"]) {
          const comparison = local.get(arm)!;
          let intersection = 0;
          let union = 0;
          for (let i = 0; i < size * size; i++) {
            const a = reference.status![i] === PREVIEW_HIT;
            const b = comparison.status![i] === PREVIEW_HIT;
            if (a && b) intersection++;
            if (a || b) union++;
          }
          const comparisonRow = {
            name: fixture.name,
            arm,
            segmentIoU: intersection / Math.max(1, union),
          };
          rows.push(comparisonRow);
          console.log(JSON.stringify(comparisonRow));
          if (arm === "ADAPTIVE")
            expect(comparisonRow.segmentIoU).toBeGreaterThan(0.7);
        }
      }
    }
    const directory = fileURLToPath(
      new URL("./out/slab-adaptive/", import.meta.url),
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      `${directory}measurements-${size}${process.env.SLAB_CASE ? `-${process.env.SLAB_CASE}` : ""}.json`,
      JSON.stringify(rows, null, 2),
    );
    console.log(
      writeLabeledContactSheet(panels, 4, `slab-adaptive/contact-${size}.png`),
    );
  });
});
