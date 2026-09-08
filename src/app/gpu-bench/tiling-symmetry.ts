/**
 * The newly admitted tiling + kaleidoscope composition through every
 * symmetry-capable Surface kernel: affine/fold/escape in both dimensions,
 * each under finite and lattice tiling. There is deliberately no clip: a
 * dominant clip max would let a dropped kaleidoscope pass agreement.
 *
 * Every query must distinguish the real estimator from the SAME estimator
 * with symmetry disabled, keeping its maps and support ball unchanged. The
 * margin uses the standing surfaceEvalTol formula, supplied by the owning
 * runner so this module cannot grow a second tolerance policy. Queries are
 * also perturbed in each coordinate to keep chaotic boundary flips out of
 * this compact ABI/composition leg; the full orbit agreement legs own those.
 */
import { rotationMatrix4 } from "../../fractal/affine4";
import { buildEscapeDE } from "../../fractal/escape-de";
import { buildEscapeDE4 } from "../../fractal/escape-de-4d";
import { mulberry32 } from "../../fractal/rng";
import { buildSurfaceDE } from "../../fractal/surface-de";
import { buildSurfaceDE4 } from "../../fractal/surface-de-4d";
import {
  packEscape4GpuMaps,
  packEscape4GpuParams,
  packEscapeGpuMaps,
  packEscapeGpuParams,
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
} from "../../fractal/surface-de-gpu";
import type { SurfaceGpu4View } from "../../fractal/surface-de-gpu";
import {
  estimateDistance4RefinedTiled,
  estimateDistance4Tiled,
  estimateDistanceRefinedTiled,
  estimateDistanceTiled,
  estimateEscapeDistance4Tiled,
  estimateEscapeDistanceTiled,
} from "../../fractal/tiling-de";
import {
  isInChamber,
  isResolvedLatticeTiling,
  resolveTiling,
} from "../../fractal/tiling";
import type { ResolvedTiling } from "../../fractal/tiling";
import type {
  SymmetryParams,
  Transform,
  Vec3,
  Vec4,
} from "../../fractal/types";

type Core = "affine" | "fold" | "escape" | "affine4" | "fold4" | "escape4";
type SurfaceEvalTolerance = (cpu: number, radius: number) => number;

/** Structurally compatible with main.ts's compact SurfaceTilingAbiSpec. */
export interface SurfaceTilingSymmetryAbiSpec {
  name: string;
  core: Core;
  tiling: ResolvedTiling;
  params: ArrayBuffer;
  maps: Float32Array;
  queries: Vec3[];
  cpu: number[];
  toleranceRadius: number;
  /** Executable anti-vacuity evidence, additional to the GPU leg's fields. */
  cpuWithoutSymmetry: number[];
  minimumSymmetryDeltaTolerances: number;
}

const QUERY_COUNT = 6;
const MIN_CONTROL_MARGIN = 8;

function transformsFor(
  family: "affine" | "fold" | "escape",
  fourD: boolean,
): Transform[] {
  const maps: Transform[] =
    family === "escape"
      ? [
          {
            id: 0,
            position: [0.19, -0.27, 0.11],
            rotation: [0.13, -0.17, 0.09],
            scale: [1.25, 1.25, 1.25],
            variations: [{ type: "boxfold", weight: 1, boxLimit: 0.8 }],
          },
        ]
      : [
          {
            id: 0,
            position: [0.43, -0.19, 0.28],
            rotation: [0.11, -0.09, 0.17],
            scale: [0.28, 0.28, 0.28],
          },
          {
            id: 1,
            position: [-0.21, 0.37, -0.12],
            rotation: [-0.07, 0.15, -0.13],
            scale: [0.31, 0.31, 0.31],
          },
        ];
  return maps.map((map, i) => ({
    ...map,
    ...(family === "fold"
      ? { variations: [{ type: "boxfold" as const, weight: 1, boxLimit: 0.3 }] }
      : {}),
    ...(fourD
      ? {
          w: {
            position: i === 0 ? 0.23 : -0.16,
            rotation: { yw: 0.21, zw: -0.12 },
          },
        }
      : {}),
  }));
}

function viewFor(radius: number): SurfaceGpu4View {
  return {
    rotor: rotationMatrix4({ xy: 0.19, xw: 0.41, yw: -0.27 }).map(Math.fround),
    w0: Math.fround(0.17 * radius),
    sliceHalfW: 0,
  };
}

/** Packer stores the transpose; evaluate the same inverse-rotor lift. */
function lift(view: SurfaceGpu4View, q: Vec3): Vec4 {
  const rot = view.rotor;
  return [0, 1, 2, 3].map(
    (i) =>
      rot[i] * q[0] +
      rot[4 + i] * q[1] +
      rot[8 + i] * q[2] +
      rot[12 + i] * view.w0,
  ) as Vec4;
}

function selectQueries(
  name: string,
  radius: number,
  evalCpu: (q: Vec3) => number,
  evalControl: (q: Vec3) => number,
  crossesFold: (q: Vec3) => boolean,
  tolerance: SurfaceEvalTolerance,
): Pick<
  SurfaceTilingSymmetryAbiSpec,
  "queries" | "cpu" | "cpuWithoutSymmetry" | "minimumSymmetryDeltaTolerances"
> {
  const rng = mulberry32(0x71e5_0908);
  const queries: Vec3[] = [];
  const cpu: number[] = [];
  const cpuWithoutSymmetry: number[] = [];
  let minimumSymmetryDeltaTolerances = Infinity;
  const perturbation = radius * 2e-5;
  for (
    let attempt = 0;
    attempt < 4096 && queries.length < QUERY_COUNT;
    attempt++
  ) {
    const q: Vec3 = [
      Math.fround((rng() * 6.4 - 3.2) * radius),
      Math.fround((rng() * 2.2 - 1.1) * radius),
      Math.fround((rng() * 6.4 - 3.2) * radius),
    ];
    if (!crossesFold(q)) continue;
    const value = evalCpu(q);
    const control = evalControl(q);
    const margin =
      Math.abs(value - control) /
      Math.max(tolerance(value, radius), tolerance(control, radius));
    // Well outside tiny DE values, so f32 chaotic-boundary flips cannot be
    // mistaken for this row's intended query-fold composition question.
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(control) ||
      value < 0.015 * radius ||
      margin < MIN_CONTROL_MARGIN
    )
      continue;
    let stable = true;
    for (let axis = 0; axis < 3 && stable; axis++) {
      for (const sign of [-1, 1]) {
        const nearby = [...q] as Vec3;
        nearby[axis] = Math.fround(q[axis] + sign * perturbation);
        if (Math.abs(evalCpu(nearby) - value) > tolerance(value, radius) / 4) {
          stable = false;
          break;
        }
      }
    }
    if (!stable) continue;
    queries.push(q);
    cpu.push(value);
    cpuWithoutSymmetry.push(control);
    minimumSymmetryDeltaTolerances = Math.min(
      minimumSymmetryDeltaTolerances,
      margin,
    );
  }
  if (queries.length !== QUERY_COUNT)
    throw new Error(
      `${name}: only ${queries.length} stable queries distinguish symmetry by ${MIN_CONTROL_MARGIN} eval tolerances`,
    );
  return { queries, cpu, cpuWithoutSymmetry, minimumSymmetryDeltaTolerances };
}

/** Build lazily when the Surface gate runs; ordinary flame rows pay nothing. */
export function buildSurfaceTilingSymmetryAbiSpecs(
  tolerance: SurfaceEvalTolerance,
): {
  finite: SurfaceTilingSymmetryAbiSpec[];
  lattice: SurfaceTilingSymmetryAbiSpec[];
} {
  const finite: SurfaceTilingSymmetryAbiSpec[] = [];
  const lattice: SurfaceTilingSymmetryAbiSpec[] = [];
  for (const fourD of [false, true]) {
    for (const family of ["affine", "fold", "escape"] as const) {
      const core = `${family}${fourD ? "4" : ""}` as Core;
      const transforms = transformsFor(family, fourD);
      const symmetry: SymmetryParams = {
        order: 3,
        plane: fourD ? "xw" : "xy",
        ...(fourD && family !== "escape" ? { twist: 1 } : {}),
      };
      const noSymmetry = {
        order: 1,
        plane: symmetry.plane,
        stepCos: 1,
        stepSin: 0,
      };
      const surface3 =
        !fourD && family !== "escape"
          ? buildSurfaceDE(transforms, null, symmetry)
          : null;
      const surface4 =
        fourD && family !== "escape"
          ? buildSurfaceDE4(transforms, null, symmetry)
          : null;
      const escape3 =
        !fourD && family === "escape"
          ? buildEscapeDE(transforms, null, symmetry)
          : null;
      const escape4 =
        fourD && family === "escape"
          ? buildEscapeDE4(transforms, null, symmetry)
          : null;
      const radius =
        surface3?.visibleBoundingRadius ??
        surface4?.visibleBoundingRadius ??
        escape3?.boundingRadius ??
        escape4!.boundingRadius;
      const view = viewFor(radius);
      const control3 = surface3 ? { ...surface3, symmetry: noSymmetry } : null;
      const control4 = surface4
        ? { ...surface4, symmetry: { ...surface4.symmetry, order: 1 } }
        : null;
      const controlEscape3 = escape3 ? { ...escape3, symmetryOrder: 1 } : null;
      const controlEscape4 = escape4 ? { ...escape4, symmetryOrder: 1 } : null;
      for (const isLattice of [false, true]) {
        const tiling = isLattice
          ? resolveTiling({ kind: "lattice", cellScale: 1.25 }, radius)
          : resolveTiling({ group: fourD ? "b4" : "b3" })!;
        const name = `symmetry-${core}-${isLattice ? "lattice" : fourD ? "b4" : "b3"}`;
        const evalWith = (q: Vec3, withoutSymmetry: boolean): number => {
          if (surface3)
            return (
              family === "affine"
                ? estimateDistanceRefinedTiled
                : estimateDistanceTiled
            )(tiling, withoutSymmetry ? control3! : surface3, q);
          if (surface4)
            return (
              family === "affine"
                ? estimateDistance4RefinedTiled
                : estimateDistance4Tiled
            )(tiling, withoutSymmetry ? control4! : surface4, lift(view, q));
          if (escape3)
            return estimateEscapeDistanceTiled(
              tiling,
              withoutSymmetry ? controlEscape3! : escape3,
              q,
            );
          return estimateEscapeDistance4Tiled(
            tiling,
            withoutSymmetry ? controlEscape4! : escape4!,
            lift(view, q),
          );
        };
        const selected = selectQueries(
          name,
          radius,
          (q) => evalWith(q, false),
          (q) => evalWith(q, true),
          (q) => {
            const raw = fourD ? lift(view, q) : q;
            return isResolvedLatticeTiling(tiling)
              ? Math.max(
                  Math.abs(raw[0]),
                  Math.abs(raw[2]),
                  Math.abs(raw[3] ?? 0),
                ) >
                  tiling.h + radius * 0.01
              : !isInChamber(tiling.info, raw);
          },
          tolerance,
        );
        const run = { itemCount: selected.queries.length };
        const params = surface3
          ? packSurfaceGpuParams(surface3, run, null, null, tiling)
          : surface4
            ? packSurface4GpuParams(surface4, view, run, null, null, tiling)
            : escape3
              ? packEscapeGpuParams(escape3, run, null, null, tiling)
              : packEscape4GpuParams(escape4!, view, run, null, null, tiling);
        const maps = new Float32Array(
          surface3
            ? packSurfaceGpuMaps(surface3)
            : surface4
              ? packSurfaceGpuMaps4(surface4)
              : escape3
                ? packEscapeGpuMaps(escape3)
                : packEscape4GpuMaps(escape4!),
        );
        (isLattice ? lattice : finite).push({
          name,
          core,
          tiling,
          params,
          maps,
          ...selected,
          toleranceRadius: radius,
        });
      }
    }
  }
  return { finite, lattice };
}
