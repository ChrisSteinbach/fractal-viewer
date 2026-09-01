import { describe, expect, it } from "vitest";
import {
  MAX_EMITTER_TRIANGLE_TABLE_BYTES,
  buildFlameGpuPointTilingKernel,
} from "./flame-gpu";
import {
  POINT_TILING_GPU_AUX_MAX_BYTES,
  POINT_TILING_GPU_F32_ROUNDING_REL_EPS,
  POINT_TILING_GPU_MAX_COLOR_ADD,
  POINT_TILING_GPU_MAX_WEIGHT_FIX,
  POINT_TILING_GPU_STATE_STRIDE_BYTES,
  assertGpuPointTilingCompatibility,
  packGpuPointTiling,
  pointTilingGpuStratumTarget,
  pointTilingGpuWgsl,
  quantizePointTilingCdf,
} from "./point-tiling-gpu";
import { resolvePointTilingPlan } from "./point-tiling";
import type { LatticePointTilingCdf } from "./point-tiling";
import { TILING_GROUPS, TILING_GROUP_INFO, resolveTiling } from "./tiling";

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function det3(matrix: readonly (readonly number[])[]): number {
  return (
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function wallFixture(
  group: (typeof TILING_GROUPS)[number],
  rank: number,
): number[] {
  const info = TILING_GROUP_INFO[group];
  const root = (wall: number) =>
    info.roots.slice(wall * info.dim, (wall + 1) * info.dim);
  const vertices: number[][] = [];
  for (let vertex = 0; vertex < info.dim; vertex++) {
    const others = Array.from({ length: info.dim }, (_, wall) => wall)
      .filter((wall) => wall !== vertex)
      .map(root);
    let raw: number[];
    if (info.dim === 3) {
      const [a, b] = others;
      raw = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
    } else {
      raw = [0, 1, 2, 3].map((column) => {
        const minor = [0, 1, 2, 3]
          .filter((axis) => axis !== column)
          .map((axis) => [others[0][axis], others[1][axis], others[2][axis]]);
        return (column % 2 === 0 ? 1 : -1) * det3(minor);
      });
    }
    if (dot(raw, root(vertex)) < 0) raw = raw.map((value) => -value);
    const length = Math.hypot(...raw);
    vertices.push(raw.map((value) => value / length));
  }
  const point = new Array<number>(info.dim).fill(0);
  for (let vertex = 0; vertex < rank; vertex++) {
    const weight = 0.31 + vertex * 0.17;
    for (let axis = 0; axis < info.dim; axis++) {
      point[axis] += vertices[vertex][axis] * weight;
    }
  }
  return point.map(Math.fround);
}

function finiteF32Mask(
  group: (typeof TILING_GROUPS)[number],
  point: readonly number[],
): number {
  const info = TILING_GROUP_INFO[group];
  const roots = Array.from(info.roots, Math.fround);
  let mask = 0;
  for (let wall = 0; wall < info.dim; wall++) {
    let pairing = 0;
    let magnitude = 0;
    for (let axis = 0; axis < info.dim; axis++) {
      const product = Math.fround(roots[wall * info.dim + axis] * point[axis]);
      pairing = Math.fround(pairing + product);
      magnitude += Math.abs(product);
    }
    const tolerance =
      0.5e-9 * Math.hypot(...point) +
      POINT_TILING_GPU_F32_ROUNDING_REL_EPS * magnitude;
    if (Math.abs(pairing) <= tolerance) mask |= 1 << wall;
  }
  return mask;
}

function finitePlan(group: (typeof TILING_GROUPS)[number]) {
  const plan = resolvePointTilingPlan(
    resolveTiling({
      group,
      clip: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.8 },
            combine: "union",
          },
          {
            primitive: { kind: "box", half: [0.7, 0.6, 0.5] },
            combine: "intersect",
          },
        ],
      },
    }),
    TILING_GROUP_INFO[group].dim,
  );
  if (!plan) throw new Error("expected finite plan");
  return plan;
}

function latticePlan(dimension: 3 | 4, cellScale = 1) {
  const plan = resolvePointTilingPlan(
    resolveTiling({ kind: "lattice", cellScale }, 1),
    dimension,
  );
  if (!plan || plan.kind !== "lattice")
    throw new Error("expected lattice plan");
  return plan;
}

describe("point tiling GPU packing", () => {
  it("packs every finite group and both minimum-scale lattice dimensions inside the shared cap", () => {
    for (const group of TILING_GROUPS) {
      const packed = packGpuPointTiling(finitePlan(group), null, 128);
      expect(packed.dimension).toBe(TILING_GROUP_INFO[group].dim);
      expect(packed.kind).toBe(1);
      expect(packed.baseFloat % 4).toBe(0);
      expect(packed.auxTable.byteLength).toBeLessThanOrEqual(
        POINT_TILING_GPU_AUX_MAX_BYTES,
      );
      expect(packed.stateBytes).toBe(128 * POINT_TILING_GPU_STATE_STRIDE_BYTES);
    }
    for (const dimension of [3, 4] as const) {
      for (const cellScale of [1, 4]) {
        const packed = packGpuPointTiling(
          latticePlan(dimension, cellScale),
          null,
          128,
        );
        expect(packed.kind).toBe(2);
        expect(packed.dimension).toBe(dimension);
        expect(packed.maxLatticeWeight).toBeGreaterThan(0);
        expect(packed.maxLatticeWeight).toBeLessThan(740);
      }
    }
  });

  it("keeps an emitter prefix byte-exact and aligns the appended plan", () => {
    const prefix = new Float32Array([1.25, -2.5, 7, 11, 13]).buffer;
    const packed = packGpuPointTiling(finitePlan("a3"), prefix, 1);
    expect(packed.baseFloat).toBe(8);
    expect(
      Array.from(new Uint8Array(packed.auxTable, 0, prefix.byteLength)),
    ).toEqual(Array.from(new Uint8Array(prefix)));
    expect(Array.from(new Float32Array(packed.auxTable, 5 * 4, 3))).toEqual([
      0, 0, 0,
    ]);
  });

  it("packs the maximum emitter prefix and rejects a non-finite f32 lattice wire", () => {
    const prefix = new ArrayBuffer(MAX_EMITTER_TRIANGLE_TABLE_BYTES);
    const packed = packGpuPointTiling(finitePlan("f4"), prefix, 1);
    expect(packed.baseFloat).toBe(
      MAX_EMITTER_TRIANGLE_TABLE_BYTES / Float32Array.BYTES_PER_ELEMENT,
    );
    expect(packed.auxTable.byteLength).toBeLessThanOrEqual(
      POINT_TILING_GPU_AUX_MAX_BYTES,
    );

    const plan = latticePlan(3);
    const broken = {
      ...plan,
      tiling: {
        ...plan.tiling,
        presentation: {
          ...plan.tiling.presentation,
          outerRadius: Number.MAX_VALUE,
        },
      },
    };
    expect(() => packGpuPointTiling(broken, null, 1)).toThrow(/finite f32/);
  });

  it("quantizes every positive interval and terminates at exactly 2^32", () => {
    const cdf: LatticePointTilingCdf = {
      cellOrdinals: Uint16Array.from([0, 1, 2, 3]),
      cumulative: Float64Array.from([1e-20, 0.25, 0.999999999999, 1]),
      upperTotal: 4,
    };
    const packed = quantizePointTilingCdf(cdf);
    let previous = 0;
    for (let index = 0; index < cdf.cumulative.length; index++) {
      const endpoint =
        packed.endpointsHi[index] * 0x1_0000 + packed.endpointsLo[index];
      const mass = packed.massesHi[index] * 0x1_0000 + packed.massesLo[index];
      expect(endpoint).toBeGreaterThan(previous);
      expect(mass).toBe(endpoint - previous);
      previous = endpoint;
    }
    expect(previous).toBe(0x1_0000_0000);
  });

  it("retains generic, wall, edge, and vertex stabilizers in packed-f32 arithmetic", () => {
    for (const group of TILING_GROUPS) {
      const info = TILING_GROUP_INFO[group];
      for (let rank = info.dim; rank >= 0; rank--) {
        const point = wallFixture(group, rank);
        const mask = finiteF32Mask(group, point);
        const expected = ((1 << info.dim) - 1) & ~((1 << rank) - 1);
        expect(mask, `${group} rank ${rank}`).toBe(expected);
      }
    }
  });

  it("retains lattice simple-wall masks at both authored scale boundaries", () => {
    for (const dimension of [3, 4] as const) {
      for (const cellScale of [1, 4]) {
        const plan = latticePlan(dimension, cellScale);
        const h = Math.fround(plan.tiling.h);
        const coordinates = [h, -h, h];
        let mask = 0;
        for (let axis = 0; axis < (dimension === 3 ? 2 : 3); axis++) {
          const coordinate = coordinates[axis];
          const tolerance =
            0.5e-9 * Math.abs(h) +
            POINT_TILING_GPU_F32_ROUNDING_REL_EPS *
              Math.max(Math.abs(coordinate), Math.abs(h));
          if (Math.abs(Math.abs(coordinate) - h) <= tolerance)
            mask |= 1 << axis;
        }
        expect(mask).toBe((1 << (dimension === 3 ? 2 : 3)) - 1);
      }
    }
  });

  it("matches the exact 64-bit stratified target for every legal fanout", () => {
    const phases = [0, 1, 0x7fff_ffff, 0xffff_fffe, 0xffff_ffff];
    for (let selected = 1; selected <= 32; selected++) {
      for (const phase of phases) {
        for (let sample = 0; sample < selected; sample++) {
          const want = Number(
            (BigInt(sample) * (1n << 32n) + BigInt(phase)) / BigInt(selected),
          );
          expect(pointTilingGpuStratumTarget(phase, sample, selected)).toBe(
            want,
          );
        }
      }
    }
  });

  it("keeps each fixed-point atomic add inside u32", () => {
    expect(POINT_TILING_GPU_MAX_WEIGHT_FIX).toBe(294_912);
    expect(POINT_TILING_GPU_MAX_COLOR_ADD).toBe(75_497_472);
    expect(POINT_TILING_GPU_MAX_COLOR_ADD).toBeLessThanOrEqual(0xffff_ffff);
  });

  it("keeps the maximum export accumulation inside emulated u64", () => {
    const maxAuthoredIterations = 2_000_000_000;
    const maxExportAreaScale = 4 ** 2;
    const dispatchOvershootCeiling = 2;
    const maxOneBucketColor =
      BigInt(maxAuthoredIterations) *
      BigInt(maxExportAreaScale) *
      BigInt(dispatchOvershootCeiling) *
      BigInt(POINT_TILING_GPU_MAX_COLOR_ADD);
    expect(maxOneBucketColor).toBe(4_831_838_208_000_000_000n);
    expect(maxOneBucketColor).toBeLessThan(1n << 64n);
  });

  it("refuses dimension, kaleidoscope, and balloon mismatches at the GPU seam", () => {
    const plan = finitePlan("a3");
    expect(() =>
      assertGpuPointTilingCompatibility(plan, 3, 1, false),
    ).not.toThrow();
    expect(() => assertGpuPointTilingCompatibility(plan, 4, 1, false)).toThrow(
      /dimension/,
    );
    expect(() => assertGpuPointTilingCompatibility(plan, 3, 2, false)).toThrow(
      /kaleidoscope/,
    );
    expect(() => assertGpuPointTilingCompatibility(plan, 3, 1, true)).toThrow(
      /balloon/,
    );
  });

  it("generates binding-8 state only for the active kernel source", () => {
    const packed = packGpuPointTiling(finitePlan("a3"), null, 1);
    const source = buildFlameGpuPointTilingKernel(pointTilingGpuWgsl(packed));
    expect(source).toContain("@group(0) @binding(8)");
    expect(source).toContain("vec4f(pp, 0.0), pointTilingState, chainIdx");
    expect(source).toContain("pointTilingAuxU(record + 3u)");
    expect(source).not.toContain("visibility / upper");
    expect(source).not.toContain("depositPoint(pp, rgb, 256u)");
  });
});
