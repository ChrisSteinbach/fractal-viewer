import type { ShapeSpec } from "./shapes";
import {
  POINT_TILING_ACCUMULATION_FANOUT_CAP,
  POINT_TILING_MAX_LATTICE_CURSOR_MASS_ERROR,
  POINT_TILING_MAX_LATTICE_CELLS,
  POINT_TILING_PLAN_MEMORY_CAP_BYTES,
  POINT_TILING_POINTS_ATTEMPT_FACTOR,
  POINT_TILING_POINTS_FANOUT_CAP,
  POINT_TILING_STABILIZER_REL_EPS,
  createLatticePointTilingProposal,
  createPointTilingCursorState,
  createPointTilingPointsState,
  pointTilingContains,
  pointTilingLatticeVisibility,
  pointTilingPointsAttemptLimit,
  pointTilingStatus,
  resolvePointTilingPlan,
  visitPointTilingAttemptBounded,
  visitPointTilingImagesExhaustive,
  visitPointTilingPointsAttemptBounded,
} from "./point-tiling";
import type {
  LatticePointTilingPlan,
  PointTilingCursorState,
  PointTilingPlan,
  PointTilingPointsState,
} from "./point-tiling";
import {
  FOLD_EPS,
  TILING_GROUPS,
  TILING_GROUP_INFO,
  enumerateOrbit,
  foldLattice3,
  foldLattice4,
  resolveTiling,
} from "./tiling";
import type { TilingGroup, TilingGroupInfo } from "./tiling";
import type { Vec3, Vec4 } from "./types";

type Point = number[];

interface Image {
  point: [number, number, number, number];
  weight: number;
  candidate: number;
}

const SPHERE_CLIP: ShapeSpec = {
  parts: [{ primitive: { kind: "sphere", radius: 0.5 }, combine: "union" }],
};

function root(info: TilingGroupInfo, wall: number): number[] {
  return info.roots.slice(wall * info.dim, (wall + 1) * info.dim);
}

function dot(a: readonly number[], b: readonly number[]): number {
  let value = 0;
  for (let index = 0; index < a.length; index++) value += a[index] * b[index];
  return value;
}

function norm(point: readonly number[]): number {
  return Math.hypot(...point);
}

function det3(matrix: readonly (readonly number[])[]): number {
  return (
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function cross3(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function cross4(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
): number[] {
  const result: number[] = [];
  for (let column = 0; column < 4; column++) {
    const minor = [0, 1, 2, 3]
      .filter((index) => index !== column)
      .map((index) => [a[index], b[index], c[index]]);
    result.push((column % 2 === 0 ? 1 : -1) * det3(minor));
  }
  return result;
}

function chamberVertices(info: TilingGroupInfo): number[][] {
  const vertices: number[][] = [];
  for (let vertex = 0; vertex < info.dim; vertex++) {
    const others = Array.from({ length: info.dim }, (_, wall) => wall)
      .filter((wall) => wall !== vertex)
      .map((wall) => root(info, wall));
    const raw =
      info.dim === 3
        ? cross3(others[0], others[1])
        : cross4(others[0], others[1], others[2]);
    if (dot(raw, root(info, vertex)) < 0) {
      for (let axis = 0; axis < info.dim; axis++) raw[axis] = -raw[axis];
    }
    const length = norm(raw);
    vertices.push(raw.map((coordinate) => coordinate / length));
  }
  return vertices;
}

function chamberPoint(info: TilingGroupInfo, rank: number = info.dim): Point {
  const vertices = chamberVertices(info);
  const point = new Array<number>(info.dim).fill(0);
  for (let vertex = 0; vertex < rank; vertex++) {
    const weight = 0.31 + vertex * 0.17;
    for (let axis = 0; axis < info.dim; axis++) {
      point[axis] += vertices[vertex][axis] * weight;
    }
  }
  const scale = 0.72 / Math.max(0.72, norm(point));
  return point.map((coordinate) => coordinate * scale);
}

function planForGroup(group: TilingGroup): PointTilingPlan {
  const resolved = resolveTiling({ group });
  const plan = resolvePointTilingPlan(resolved, TILING_GROUP_INFO[group].dim);
  if (!plan) throw new Error("expected finite plan");
  return plan;
}

function latticePlan(
  dimension: 3 | 4,
  scale = 1,
  radius = 1,
  clip?: ShapeSpec,
): LatticePointTilingPlan {
  const resolved = resolveTiling(
    { kind: "lattice", cellScale: scale, clip },
    radius,
  );
  const plan = resolvePointTilingPlan(resolved, dimension);
  if (!plan || plan.kind !== "lattice")
    throw new Error("expected lattice plan");
  return plan;
}

function visitAll(plan: PointTilingPlan, point: readonly number[]): Image[] {
  const images: Image[] = [];
  visitPointTilingImagesExhaustive(
    plan,
    point[0],
    point[1],
    point[2],
    point[3] ?? 0,
    (x, y, z, w, weight, candidate) => {
      images.push({ point: [x, y, z, w], weight, candidate });
    },
  );
  return images;
}

function expectSamePointSet(
  actual: readonly Image[],
  expected: readonly Point[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (const image of actual) {
    expect(
      expected.some((point) => {
        let distanceSquared = 0;
        for (let axis = 0; axis < point.length; axis++) {
          const difference = image.point[axis] - point[axis];
          distanceSquared += difference * difference;
        }
        return distanceSquared <= 4e-18 * Math.max(1, norm(point) ** 2);
      }),
    ).toBe(true);
  }
  for (const point of expected) {
    expect(
      actual.some((image) => {
        let distanceSquared = 0;
        for (let axis = 0; axis < point.length; axis++) {
          const difference = image.point[axis] - point[axis];
          distanceSquared += difference * difference;
        }
        return distanceSquared <= 4e-18 * Math.max(1, norm(point) ** 2);
      }),
    ).toBe(true);
  }
}

function cellIndices(plan: LatticePointTilingPlan, cell: number): number[] {
  return Array.from(
    { length: plan.repeatedAxes },
    (_, axis) => plan.cells[cell * plan.repeatedAxes + axis],
  );
}

describe("point tiling finite plans", () => {
  it("matches enumerateOrbit for every cached deterministic group closure", () => {
    for (const group of TILING_GROUPS) {
      const info = TILING_GROUP_INFO[group];
      const point = chamberPoint(info);
      const first = planForGroup(group);
      const second = planForGroup(group);
      expect(first.kind).toBe("finite");
      expect(second.kind).toBe("finite");
      if (first.kind !== "finite" || second.kind !== "finite") continue;
      expect(first.matrices).toBe(second.matrices);
      expect(first.representativesByWallMask).toBe(
        second.representativesByWallMask,
      );
      expect(first.matrices).toHaveLength(info.order);
      expect(first.memoryBytes).toBeLessThanOrEqual(
        POINT_TILING_PLAN_MEMORY_CAP_BYTES,
      );
      const oracle: number[][] = [];
      enumerateOrbit(info, point as Vec3 | Vec4, oracle);
      expectSamePointSet(visitAll(first, point), oracle);
      expect(
        visitAll(
          first,
          point.map((coordinate) => coordinate * 1e-20),
        ),
      ).toHaveLength(info.order);
    }
  });

  it("applies F4's genuinely w-mixing matrices before any view reduction", () => {
    const plan = planForGroup("f4");
    if (plan.kind !== "finite") throw new Error("expected finite plan");
    const source = chamberPoint(TILING_GROUP_INFO.f4);
    const candidate = plan.matrices.findIndex(
      (matrix) =>
        Math.abs(matrix[3]) +
          Math.abs(matrix[7]) +
          Math.abs(matrix[11]) +
          Math.abs(matrix[12]) +
          Math.abs(matrix[13]) +
          Math.abs(matrix[14]) >
        0.5,
    );
    expect(candidate).toBeGreaterThan(0);
    const matrix = plan.matrices[candidate];
    const full = Array.from({ length: 4 }, (_, row) =>
      source.reduce(
        (sum, coordinate, column) =>
          sum + matrix[row * 4 + column] * coordinate,
        0,
      ),
    );
    const droppedW = Array.from({ length: 4 }, (_, row) =>
      source
        .slice(0, 3)
        .reduce(
          (sum, coordinate, column) =>
            sum + matrix[row * 4 + column] * coordinate,
          0,
        ),
    );
    const emitted = visitAll(plan, source).find(
      (image) => image.candidate === candidate,
    );
    expect(emitted).toBeDefined();
    for (let axis = 0; axis < 4; axis++) {
      expect(emitted?.point[axis]).toBeCloseTo(full[axis], 13);
    }
    expect(
      full.some(
        (coordinate, axis) => Math.abs(coordinate - droppedW[axis]) > 1e-4,
      ),
    ).toBe(true);
  });

  it("deduplicates faces, edges, vertices, and the origin without widening the tolerance", () => {
    for (const group of TILING_GROUPS) {
      const info = TILING_GROUP_INFO[group];
      const plan = planForGroup(group);
      for (const rank of [info.dim - 1, Math.max(1, info.dim - 2), 1, 0]) {
        const point =
          rank === 0
            ? new Array<number>(info.dim).fill(0)
            : chamberPoint(info, rank);
        const oracle: number[][] = [];
        enumerateOrbit(info, point as Vec3 | Vec4, oracle);
        expectSamePointSet(visitAll(plan, point), oracle);
      }

      const wall = info.dim - 1;
      const onWall = chamberPoint(info, info.dim - 1);
      const normal = root(info, wall);
      for (const signedDistance of [FOLD_EPS / 2, -FOLD_EPS / 2]) {
        const near = onWall.map(
          (coordinate, axis) => coordinate + signedDistance * normal[axis],
        );
        expect(visitAll(plan, near)).toHaveLength(info.order);
      }
      const justDistinct = onWall.map(
        (coordinate, axis) =>
          coordinate + POINT_TILING_STABILIZER_REL_EPS * 1.01 * normal[axis],
      );
      expect(visitAll(plan, justDistinct)).toHaveLength(info.order);
    }
  });

  it("uses closed chamber and xyz analytic-clip membership in both dimensions", () => {
    for (const group of ["a3", "a4"] as const) {
      const info = TILING_GROUP_INFO[group];
      const point = chamberPoint(info);
      const normal = root(info, 0);
      const dot0 = dot(point, normal);
      const onWall = point.map(
        (coordinate, axis) => coordinate - dot0 * normal[axis],
      );
      const barelyOutside = onWall.map(
        (coordinate, axis) => coordinate - (FOLD_EPS / 2) * normal[axis],
      );
      const rejected = onWall.map(
        (coordinate, axis) => coordinate - FOLD_EPS * 1.01 * normal[axis],
      );
      const resolved = resolveTiling({ group, clip: SPHERE_CLIP });
      const plan = resolvePointTilingPlan(resolved, info.dim);
      const unclipped = resolvePointTilingPlan(
        resolveTiling({ group }),
        info.dim,
      );
      if (!plan) throw new Error("expected clipped plan");
      if (!unclipped) throw new Error("expected unclipped plan");
      const scaleToBoundary = 0.5 / norm(point.slice(0, 3));
      const clipBoundary = point.map(
        (coordinate) => coordinate * scaleToBoundary,
      );
      expect(
        pointTilingContains(unclipped, ...scalarPoint(barelyOutside)),
      ).toBe(true);
      expect(pointTilingContains(unclipped, ...scalarPoint(rejected))).toBe(
        false,
      );
      expect(pointTilingContains(plan, ...scalarPoint(clipBoundary))).toBe(
        true,
      );
      const clipOutside = clipBoundary.map((coordinate) => coordinate * 1.01);
      expect(pointTilingContains(plan, ...scalarPoint(clipOutside))).toBe(
        false,
      );
    }
  });
});

function scalarPoint(
  point: readonly number[],
): [number, number, number, number] {
  return [point[0], point[1], point[2], point[3] ?? 0];
}

function radicalInverseForTest(value: number, base: 2 | 3): number {
  let remaining = value >>> 0;
  let place = 1 / base;
  let result = 0;
  while (remaining > 0) {
    result += (remaining % base) * place;
    remaining = Math.floor(remaining / base);
    place /= base;
  }
  return result;
}

describe("point tiling lattice plans", () => {
  it("pins tight 3D/raw-4D cell counts, memory, and 8R -> 10R visibility", () => {
    const expected = {
      3: [97, 61, 5],
      4: [739, 365, 7],
    } as const;
    for (const dimension of [3, 4] as const) {
      for (const [index, scale] of [1, 1.25, 4].entries()) {
        const plan = latticePlan(dimension, scale);
        expect(plan.upper).toHaveLength(expected[dimension][index]);
        expect(plan.upper.length).toBeLessThanOrEqual(
          POINT_TILING_MAX_LATTICE_CELLS,
        );
        expect(plan.memoryBytes).toBeLessThanOrEqual(
          POINT_TILING_PLAN_MEMORY_CAP_BYTES,
        );
      }
    }
    const plan = latticePlan(4);
    expect(pointTilingLatticeVisibility(plan, 8)).toBe(1);
    expect(pointTilingLatticeVisibility(plan, 9)).toBeCloseTo(0.5, 14);
    expect(pointTilingLatticeVisibility(plan, 10)).toBe(0);
  });

  it("emits exact negative-cell images and folds every image to its source", () => {
    for (const [dimension, source] of [
      [3, [0.2, 0.1, 0.3]],
      [4, [0.2, 0.1, 0.3, 0.4]],
    ] as const) {
      const plan = latticePlan(dimension);
      const images = visitAll(plan, source);
      expect(
        images.some((image) =>
          cellIndices(plan, image.candidate).some((k) => k < 0),
        ),
      ).toBe(true);
      for (const image of images) {
        const indices = cellIndices(plan, image.candidate);
        const axes = dimension === 3 ? [0, 2] : [0, 2, 3];
        for (let repeated = 0; repeated < axes.length; repeated++) {
          const axis = axes[repeated];
          const k = indices[repeated];
          const expected =
            2 * plan.tiling.h * k +
            (Math.abs(k) % 2 === 0 ? source[axis] : -source[axis]);
          expect(image.point[axis]).toBeCloseTo(expected, 13);
        }
        if (dimension === 3) {
          const folded: Vec3 = [0, 0, 0];
          foldLattice3(image.point.slice(0, 3) as Vec3, plan.tiling.h, folded);
          for (let axis = 0; axis < 3; axis++) {
            expect(folded[axis]).toBeCloseTo(source[axis], 13);
          }
        } else {
          const folded: Vec4 = [0, 0, 0, 0];
          foldLattice4(image.point, plan.tiling.h, folded);
          for (let axis = 0; axis < 4; axis++) {
            expect(folded[axis]).toBeCloseTo(source[axis], 13);
          }
        }
      }
    }
  });

  it("uses origin-ball and xyz-only clip membership, including a true w term", () => {
    const plan3 = latticePlan(3, 1, 2, SPHERE_CLIP);
    expect(pointTilingContains(plan3, 0.5, 0, 0, 0)).toBe(true);
    expect(pointTilingContains(plan3, 0.500001, 0, 0, 0)).toBe(false);
    const plan4 = latticePlan(4);
    expect(pointTilingContains(plan4, 0, 0, 0, 1)).toBe(true);
    expect(pointTilingContains(plan4, 0, 0, 0, 1.000001)).toBe(false);
    const clipped4 = latticePlan(4, 1, 2, SPHERE_CLIP);
    expect(pointTilingContains(clipped4, 0.4, 0, 0, 1.5)).toBe(true);
    expect(pointTilingContains(clipped4, 0.500001, 0, 0, 1.5)).toBe(false);
    const images = visitAll(plan4, [0.1, 0.2, 0.3, 0.4]);
    expect(images.some((image) => Math.abs(image.point[3] - 0.4) > 1)).toBe(
      true,
    );
  });

  it("deduplicates exact x/z/w seams but preserves near-seam images", () => {
    const wall3 = latticePlan(3);
    expect(visitAll(wall3, [1, 0, 0])).toHaveLength(39);
    const near3 = visitAll(wall3, [1 - FOLD_EPS / 2, 0, 0]);
    expect(
      near3.some(
        (image) => Math.abs(image.point[0] - (1 + FOLD_EPS / 2)) < 1e-12,
      ),
    ).toBe(true);
    for (const w of [-1, 1]) {
      const plan4 = latticePlan(4);
      expect(plan4.cdfByWallMask).toHaveLength(8);
      expect(
        Array.from(plan4.cdfByWallMask[4].cellOrdinals).every(
          (cell) => Math.abs(cellIndices(plan4, cell)[2]) % 2 === 0,
        ),
      ).toBe(true);
      const exact = visitAll(plan4, [0, 0, 0, w]);
      const keys = new Set(exact.map((image) => image.point.join(",")));
      expect(keys.size).toBe(exact.length);
      const near = visitAll(plan4, [
        0,
        0,
        0,
        Math.sign(w) * (1 - FOLD_EPS / 2),
      ]);
      expect(near.length).toBeGreaterThan(exact.length);
    }
  });

  it("keeps very small and large world coordinates scale invariant", () => {
    const small = latticePlan(4, 1, 1);
    const tiny = latticePlan(4, 1, 1e-20);
    const large = latticePlan(4, 1, 1e20);
    const source = [0.11, -0.07, 0.13, 0.17];
    const smallImages = visitAll(small, source);
    const largeImages = visitAll(
      large,
      source.map((coordinate) => coordinate * 1e20),
    );
    const tinyImages = visitAll(
      tiny,
      source.map((coordinate) => coordinate * 1e-20),
    );
    expect(largeImages).toHaveLength(smallImages.length);
    expect(tinyImages).toHaveLength(smallImages.length);
    for (let index = 0; index < smallImages.length; index++) {
      expect(Number.isFinite(norm(largeImages[index].point))).toBe(true);
      expect(largeImages[index].weight).toBeCloseTo(
        smallImages[index].weight,
        12,
      );
      expect(tinyImages[index].weight).toBeCloseTo(
        smallImages[index].weight,
        12,
      );
    }
  });

  it("keeps each analytic visibility ceiling at or above its aligned witness", () => {
    const plan = latticePlan(4, 1.333333333);
    for (let cell = 0; cell < plan.upper.length; cell++) {
      const indices = cellIndices(plan, cell);
      const center = indices.map((index) => 2 * plan.tiling.h * index);
      const centerRadius = norm(center);
      if (centerRadius === 0) continue;
      const source = center.map((coordinate, axis) => {
        const parity = Math.abs(indices[axis]) % 2 === 0 ? 1 : -1;
        return (-parity * coordinate * plan.tiling.radius) / centerRadius;
      });
      const imageRadius = Math.hypot(
        center[0] + (Math.abs(indices[0]) % 2 === 0 ? source[0] : -source[0]),
        0,
        center[1] + (Math.abs(indices[1]) % 2 === 0 ? source[1] : -source[1]),
        center[2] + (Math.abs(indices[2]) % 2 === 0 ? source[2] : -source[2]),
      );
      expect(
        pointTilingLatticeVisibility(plan, imageRadius),
      ).toBeLessThanOrEqual(plan.upper[cell]);
    }
  });

  it("keeps raw-4D carrier norm and coverage invariant under compound xw/zw rotation", () => {
    const plan = latticePlan(4);
    const image = visitAll(plan, [0.1, 0.2, 0.3, 0.4]).find(
      (candidate) => candidate.weight > 0 && candidate.weight < 1,
    );
    expect(image).toBeDefined();
    if (!image) return;
    const [x, y, z, w] = image.point;
    const xw = 0.73;
    const zw = -0.41;
    const x1 = Math.cos(xw) * x - Math.sin(xw) * w;
    const w1 = Math.sin(xw) * x + Math.cos(xw) * w;
    const z2 = Math.cos(zw) * z - Math.sin(zw) * w1;
    const w2 = Math.sin(zw) * z + Math.cos(zw) * w1;
    const before = Math.hypot(x, y, z, w);
    const after = Math.hypot(x1, y, z2, w2);
    expect(after).toBeCloseTo(before, 13);
    expect(pointTilingLatticeVisibility(plan, after)).toBeCloseTo(
      pointTilingLatticeVisibility(plan, before),
      13,
    );
  });

  it("retains every tiny positive CPU-CDF interval at the carrier edge", () => {
    const plan = latticePlan(4, 5.5 - 1e-8);
    const cdf = plan.cdfByWallMask[0];
    expect(cdf.cellOrdinals).toHaveLength(plan.upper.length);
    let previous = 0;
    for (const value of cdf.cumulative) {
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
    expect(previous).toBe(1);
    expect(
      Array.from(cdf.cellOrdinals).some(
        (cell) => plan.upper[cell] > 0 && plan.upper[cell] < 1e-10,
      ),
    ).toBe(true);
    expect(POINT_TILING_MAX_LATTICE_CURSOR_MASS_ERROR).toBeCloseTo(
      739 / 2 ** 32,
      20,
    );
  });
});

describe("point tiling bounded runtime policy", () => {
  it("builds every stabilizer-mask variant and accepts a genuinely empty custom lattice proposal", () => {
    const plan = latticePlan(4);
    const identity = createLatticePointTilingProposal(
      plan,
      new Float64Array(plan.upper.length).fill(1),
    );
    expect(identity.cdfByWallMask).toHaveLength(8);
    for (let mask = 0; mask < 8; mask++) {
      expect(identity.cdfByWallMask[mask].cellOrdinals).toEqual(
        plan.cdfByWallMask[mask].cellOrdinals,
      );
      expect(identity.cdfByWallMask[mask].cumulative).toEqual(
        plan.cdfByWallMask[mask].cumulative,
      );
    }

    const empty = createLatticePointTilingProposal(
      plan,
      new Float64Array(plan.upper.length),
      1e-3,
    );
    const state = createPointTilingCursorState();
    const emitted = visitPointTilingAttemptBounded(
      plan,
      0.1,
      0.2,
      0.3,
      0.4,
      32,
      state,
      () => {
        throw new Error("empty proposal emitted an image");
      },
      empty,
    );
    expect(emitted).toBe(0);
    expect(state).toMatchObject({ attempts: 1, accepted: 1, selected: 0 });
  });

  it("uses a custom lattice proposal probability without changing coverage", () => {
    const plan = latticePlan(4);
    const source = [0.1, 0.2, 0.3, 0.4] as const;
    const target = Math.floor(plan.upper.length / 2);
    const multipliers = new Float64Array(plan.upper.length);
    multipliers[target] = 0.25;
    const proposal = createLatticePointTilingProposal(plan, multipliers);
    const expected = visitAll(plan, source).find(
      (image) => image.candidate === target,
    );
    expect(expected).toBeDefined();
    if (!expected) return;
    const state = createPointTilingCursorState();
    let actual: Image | undefined;
    visitPointTilingAttemptBounded(
      plan,
      ...source,
      32,
      state,
      (x, y, z, w, weight, candidate) => {
        actual = { point: [x, y, z, w], weight, candidate };
      },
      proposal,
    );
    expect(actual?.candidate).toBe(target);
    expect(actual?.point).toEqual(expected.point);
    // One live proposal cell has probability 1 and K=1.
    expect(actual?.weight).toBeCloseTo(expected.weight, 14);
  });

  it("selects custom lattice proposals at the post-spend cursor phase, including u32 wrap", () => {
    const plan = latticePlan(4);
    const identity = createLatticePointTilingProposal(
      plan,
      new Float64Array(plan.upper.length).fill(1),
    );
    const source = [-0.9, 0, 0.3, -0.2] as const;
    const goldenUnit = 0x9e3779b1 / 2 ** 32;
    const wrappedUnit = (2 ** 32 - 0x9e3779b1) / 2 ** 32;
    const firstInterval = (cumulative: Float64Array, unit: number): number =>
      cumulative.findIndex((value) => unit < value);

    const run = (cursor: number) => {
      const state = createPointTilingCursorState();
      state.cursor = cursor;
      const images: Image[] = [];
      visitPointTilingAttemptBounded(
        plan,
        ...source,
        32,
        state,
        (x, y, z, w, weight, candidate) => {
          images.push({ point: [x, y, z, w], weight, candidate });
        },
        identity,
      );
      return { state, images };
    };

    // With a proposal the visit sees the POST-spend cursor 1, whose golden
    // phase must reproduce the emitted image through exactly one mask CDF —
    // the pre-spend arm's phase-0 unit would select interval 0 instead.
    const fresh = run(0);
    expect(fresh.images).toHaveLength(1);
    const freshCdfs = plan.cdfByWallMask.filter(
      (cdf) =>
        cdf.cellOrdinals[firstInterval(cdf.cumulative, goldenUnit)] ===
        fresh.images[0].candidate,
    );
    expect(freshCdfs).toHaveLength(1);
    const cdf = freshCdfs[0];
    const freshInterval = firstInterval(cdf.cumulative, goldenUnit);
    expect(freshInterval).toBeGreaterThan(0);
    expect(fresh.images[0].candidate).toBe(cdf.cellOrdinals[freshInterval]);
    expect(fresh.state.cursor).toBe(1);
    expect(fresh.state.selected).toBe(1);

    // The post-spend cursor (0xffffffff + 1) >>> 0 wraps to 0, so the
    // phase-0 unit selects interval 0 — while the pre-spend arm's phase
    // (1 - goldenUnit) selects a strictly later interval.
    const wrap = run(0xffff_ffff);
    expect(wrap.state.cursor).toBe(0);
    expect(wrap.state.selected).toBe(1);
    expect(wrap.images).toHaveLength(1);
    expect(wrap.images[0].candidate).toBe(cdf.cellOrdinals[0]);
    const a0Interval = firstInterval(cdf.cumulative, wrappedUnit);
    expect(a0Interval).toBeGreaterThan(0);
    expect(cdf.cellOrdinals[a0Interval]).not.toBe(wrap.images[0].candidate);
  });

  it("banks rejection credit, spends capped bursts, normalizes finite weight, and wraps u32", () => {
    const plan = planForGroup("b4");
    const accepted = chamberPoint(TILING_GROUP_INFO.b4);
    const state = createPointTilingCursorState();
    for (let attempt = 0; attempt < 100; attempt++) {
      visitPointTilingAttemptBounded(plan, -10, 0, 0, 0, 32, state, () => {});
    }
    expect(state.credit).toBe(100);
    for (const remaining of [69, 38]) {
      let weight = 0;
      visitPointTilingAttemptBounded(
        plan,
        ...scalarPoint(accepted),
        32,
        state,
        (_x, _y, _z, _w, imageWeight) => {
          weight += imageWeight;
        },
      );
      expect(weight).toBeCloseTo(TILING_GROUP_INFO.b4.order, 13);
      expect(state.credit).toBe(remaining);
    }
    const wrap = createPointTilingCursorState();
    wrap.credit = 4;
    wrap.cursor = 0xffff_fffe;
    visitPointTilingAttemptBounded(
      plan,
      ...scalarPoint(accepted),
      8,
      wrap,
      () => {},
    );
    expect(wrap.selected).toBe(5);
    expect(wrap.cursor).toBe(3);
  });

  it("uses actual lattice proposal intervals for positive importance weights", () => {
    const plan = latticePlan(4);
    const state = createPointTilingCursorState();
    state.credit = 31;
    const source = [0.1, 0.2, 0.3, 0.4] as const;
    const weights: number[] = [];
    const emitted = visitPointTilingAttemptBounded(
      plan,
      ...source,
      32,
      state,
      (_x, _y, _z, _w, weight) => weights.push(weight),
    );
    expect(state.selected).toBe(32);
    expect(emitted).toBe(weights.length);
    expect(
      weights.every((weight) => Number.isFinite(weight) && weight > 0),
    ).toBe(true);
  });

  it("matches an adversarial 4D aligned ceiling and its actual-interval weight", () => {
    const plan = latticePlan(4, 1.333333333);
    const cell = Array.from(
      { length: plan.upper.length },
      (_, index) => index,
    ).find(
      (index) =>
        cellIndices(plan, index).reduce(
          (sum, value) => sum + value * value,
          0,
        ) === 14,
    );
    expect(cell).toBeDefined();
    if (cell === undefined) return;
    const indices = cellIndices(plan, cell);
    const center = indices.map((index) => 2 * plan.tiling.h * index);
    const centerRadius = norm(center);
    const repeatedSource = center.map((coordinate, axis) => {
      const parity = Math.abs(indices[axis]) % 2 === 0 ? 1 : -1;
      return (-parity * coordinate * plan.tiling.radius) / centerRadius;
    });
    const source = [repeatedSource[0], 0, repeatedSource[1], repeatedSource[2]];
    const exactVisibility = pointTilingLatticeVisibility(
      plan,
      centerRadius - plan.tiling.radius,
    );
    const exhaustive = visitAll(plan, source).find(
      (image) => image.candidate === cell,
    );
    expect(exhaustive?.weight).toBeCloseTo(exactVisibility, 14);
    expect(exactVisibility).toBeLessThanOrEqual(plan.upper[cell]);

    const cdf = plan.cdfByWallMask[0];
    const proposal = Array.from(cdf.cellOrdinals).indexOf(cell);
    expect(proposal).toBeGreaterThanOrEqual(0);
    const lower = proposal === 0 ? 0 : cdf.cumulative[proposal - 1];
    const upper = cdf.cumulative[proposal];
    let cursor = 0;
    while (cursor < 1_000_000) {
      const phase = (Math.imul(cursor, 0x9e3779b1) >>> 0) / 0x1_0000_0000;
      if (phase >= lower && phase < upper) break;
      cursor++;
    }
    expect(cursor).toBeLessThan(1_000_000);
    const state = createPointTilingCursorState();
    state.cursor = cursor;
    let selectedCandidate = -1;
    let selectedWeight = 0;
    visitPointTilingAttemptBounded(
      plan,
      ...scalarPoint(source),
      1,
      state,
      (_x, _y, _z, _w, weight, candidate) => {
        selectedCandidate = candidate;
        selectedWeight = weight;
      },
    );
    expect(selectedCandidate).toBe(cell);
    expect(selectedWeight).toBeCloseTo(exactVisibility / (upper - lower), 12);
  });

  it("is deterministic across serialized chunk boundaries", () => {
    const plan = planForGroup("b4");
    const accepted = chamberPoint(TILING_GROUP_INFO.b4);
    const stream = Array.from({ length: 96 }, (_, index) =>
      index % 7 === 6 ? accepted : [-10, 0, 0, 0],
    );
    const run = (
      ranges: readonly (readonly Point[])[],
    ): { images: string[]; state: PointTilingCursorState } => {
      let state = createPointTilingCursorState();
      const images: string[] = [];
      for (let range = 0; range < ranges.length; range++) {
        if (range > 0) state = { ...state };
        for (const point of ranges[range]) {
          visitPointTilingAttemptBounded(
            plan,
            ...scalarPoint(point),
            POINT_TILING_ACCUMULATION_FANOUT_CAP,
            state,
            (x, y, z, w, weight, candidate) =>
              images.push([x, y, z, w, weight, candidate].join(",")),
          );
        }
      }
      return { images, state };
    };
    const whole = run([stream]);
    const chunked = run([
      stream.slice(0, 31),
      stream.slice(31, 64),
      stream.slice(64),
    ]);
    expect(chunked).toEqual(whole);
  });

  it("freezes caps, attempt limit, statuses, and validation failures", () => {
    expect(POINT_TILING_POINTS_FANOUT_CAP).toBe(256);
    expect(POINT_TILING_ACCUMULATION_FANOUT_CAP).toBe(32);
    expect(POINT_TILING_POINTS_ATTEMPT_FACTOR).toBe(8);
    expect(pointTilingPointsAttemptLimit(123)).toBe(984);
    expect(pointTilingStatus(0, 0)).toBe("complete");
    expect(pointTilingStatus(10, 10)).toBe("complete");
    expect(pointTilingStatus(10, 4)).toBe("underfilled");
    expect(pointTilingStatus(10, 0)).toBe("empty");
    expect(resolvePointTilingPlan(null, 4)).toBeNull();
    expect(() =>
      resolvePointTilingPlan(resolveTiling({ group: "a3" }), 4),
    ).toThrow(/not 4D/);
    const meshClip = {
      parts: [
        {
          primitive: { kind: "mesh", meshId: "refused-test-mesh" },
          combine: "union",
        },
      ],
    } as unknown as ShapeSpec;
    expect(() =>
      resolvePointTilingPlan(resolveTiling({ group: "a3", clip: meshClip }), 3),
    ).toThrow(/mesh-backed clips are refused/);
    const state = createPointTilingCursorState();
    state.cursor = 0x1_0000_0000;
    expect(() =>
      visitPointTilingAttemptBounded(
        planForGroup("a3"),
        0,
        0,
        0,
        0,
        1,
        state,
        () => {},
      ),
    ).toThrow(/u32/);
  });
});

describe("point tiling Points-only equal-density policy", () => {
  it("emits unit-weight stabilizer-proportional finite quotas for every group", () => {
    for (const group of TILING_GROUPS) {
      const info = TILING_GROUP_INFO[group];
      const plan = planForGroup(group);
      for (const [fixture, point] of [
        chamberPoint(info),
        chamberPoint(info, info.dim - 1),
      ].entries()) {
        const candidates = visitAll(plan, point).length;
        const state = createPointTilingPointsState();
        const images: Image[] = [];
        const emitted = visitPointTilingPointsAttemptBounded(
          plan,
          ...scalarPoint(point),
          Number.MAX_SAFE_INTEGER,
          state,
          (x, y, z, w, weight, candidate) =>
            images.push({ point: [x, y, z, w], weight, candidate }),
        );
        const numerator = POINT_TILING_POINTS_FANOUT_CAP * candidates;
        const expected =
          info.order <= POINT_TILING_POINTS_FANOUT_CAP
            ? candidates
            : Math.floor(numerator / info.order);
        const remainder =
          info.order <= POINT_TILING_POINTS_FANOUT_CAP
            ? 0
            : numerator - expected * info.order;
        expect(emitted).toBe(expected);
        expect(images.every((image) => image.weight === 1)).toBe(true);
        expect(new Set(images.map((image) => image.candidate)).size).toBe(
          images.length,
        );
        expect(state).toEqual({
          cursor: expected,
          quotaRemainder: remainder,
          attempts: 1,
          accepted: 1,
          candidateTests: 0,
          emitted: expected,
        });
        if (info.order > POINT_TILING_POINTS_FANOUT_CAP) {
          expect(expected).toBe(
            fixture === 0
              ? POINT_TILING_POINTS_FANOUT_CAP
              : POINT_TILING_POINTS_FANOUT_CAP / 2,
          );
        }
      }
    }
  });

  it("carries the exact F4 integer remainder and obeys caller output capacity", () => {
    const plan = planForGroup("f4");
    const point = chamberPoint(TILING_GROUP_INFO.f4, 1);
    const candidates = visitAll(plan, point).length;
    const state = createPointTilingPointsState();
    let expectedRemainder = 0;
    let expectedEmitted = 0;
    for (let source = 0; source < TILING_GROUP_INFO.f4.order; source++) {
      const numerator =
        expectedRemainder + POINT_TILING_POINTS_FANOUT_CAP * candidates;
      const quota = Math.floor(numerator / TILING_GROUP_INFO.f4.order);
      expectedRemainder = numerator - quota * TILING_GROUP_INFO.f4.order;
      expectedEmitted += quota;
      expect(
        visitPointTilingPointsAttemptBounded(
          plan,
          ...scalarPoint(point),
          Number.MAX_SAFE_INTEGER,
          state,
          (_x, _y, _z, _w, weight) => expect(weight).toBe(1),
        ),
      ).toBe(quota);
    }
    expect(expectedEmitted).toBe(POINT_TILING_POINTS_FANOUT_CAP * candidates);
    expect(state.quotaRemainder).toBe(0);
    expect(state.emitted).toBe(expectedEmitted);

    const subUnit = createPointTilingPointsState();
    let zeroQuotas = 0;
    for (let source = 0; source < TILING_GROUP_INFO.f4.order; source++) {
      const emitted = visitPointTilingPointsAttemptBounded(
        plan,
        0,
        0,
        0,
        0,
        Number.MAX_SAFE_INTEGER,
        subUnit,
        () => {},
      );
      if (emitted === 0) zeroQuotas++;
    }
    expect(zeroQuotas).toBeGreaterThan(0);
    expect(subUnit.emitted).toBe(POINT_TILING_POINTS_FANOUT_CAP);
    expect(subUnit.quotaRemainder).toBe(0);

    const capped = createPointTilingPointsState();
    expect(
      visitPointTilingPointsAttemptBounded(
        plan,
        ...scalarPoint(chamberPoint(TILING_GROUP_INFO.f4)),
        7,
        capped,
        () => {},
      ),
    ).toBe(7);
    expect(capped.emitted).toBe(7);
    const snapshot = { ...capped };
    expect(
      visitPointTilingPointsAttemptBounded(
        plan,
        ...scalarPoint(chamberPoint(TILING_GROUP_INFO.f4)),
        0,
        capped,
        () => {},
      ),
    ).toBe(0);
    expect(capped).toEqual(snapshot);
  });

  it("selects and thins one lattice proposal from paired base-2/base-3 coordinates", () => {
    const plan = latticePlan(4);
    const source = [0.1, 0.2, 0.3, 0.4] as const;
    const cdf = plan.cdfByWallMask[0];
    const proposalUnit = radicalInverseForTest(1, 2);
    const proposal = Array.from(cdf.cumulative).findIndex(
      (value) => proposalUnit < value,
    );
    const cell = cdf.cellOrdinals[proposal];
    const indices = cellIndices(plan, cell);
    const expected: [number, number, number, number] = [
      2 * plan.tiling.h * indices[0] +
        (Math.abs(indices[0]) % 2 === 0 ? source[0] : -source[0]),
      source[1],
      2 * plan.tiling.h * indices[1] +
        (Math.abs(indices[1]) % 2 === 0 ? source[2] : -source[2]),
      2 * plan.tiling.h * indices[2] +
        (Math.abs(indices[2]) % 2 === 0 ? source[3] : -source[3]),
    ];
    const radial = norm(expected);
    const visibility =
      radial <= plan.tiling.presentation.outerRadius
        ? pointTilingLatticeVisibility(plan, radial)
        : 0;
    const retained =
      radicalInverseForTest(1, 3) < visibility / plan.upper[cell];
    const state = createPointTilingPointsState();
    const images: Image[] = [];
    expect(
      visitPointTilingPointsAttemptBounded(
        plan,
        ...source,
        1,
        state,
        (x, y, z, w, weight, candidate) =>
          images.push({ point: [x, y, z, w], weight, candidate }),
      ),
    ).toBe(retained ? 1 : 0);
    expect(state).toEqual({
      cursor: 1,
      quotaRemainder: 0,
      attempts: 1,
      accepted: 1,
      candidateTests: 1,
      emitted: retained ? 1 : 0,
    });
    if (retained) {
      expect(images).toEqual([{ point: expected, weight: 1, candidate: cell }]);
    } else {
      expect(images).toEqual([]);
    }

    visitPointTilingPointsAttemptBounded(plan, 2, 0, 0, 0, 1, state, () => {});
    expect(state.attempts).toBe(2);
    expect(state.accepted).toBe(1);
    expect(state.candidateTests).toBe(1);
    expect(state.cursor).toBe(1);
  });

  it("uses the exact +/-w seam CDF for lattice selection and thinning", () => {
    const plan = latticePlan(4);
    for (const sourceW of [-1, 1]) {
      const source = [0, 0, 0, sourceW] as const;
      const cdf = plan.cdfByWallMask[4];
      const proposal = Array.from(cdf.cumulative).findIndex(
        (value) => radicalInverseForTest(1, 2) < value,
      );
      const cell = cdf.cellOrdinals[proposal];
      const indices = cellIndices(plan, cell);
      expect(Math.abs(indices[2]) % 2).toBe(0);
      const expected: [number, number, number, number] = [
        2 * plan.tiling.h * indices[0],
        0,
        2 * plan.tiling.h * indices[1],
        2 * plan.tiling.h * indices[2] + sourceW,
      ];
      const radial = norm(expected);
      const visibility =
        radial <= plan.tiling.presentation.outerRadius
          ? pointTilingLatticeVisibility(plan, radial)
          : 0;
      const retained =
        radicalInverseForTest(1, 3) < visibility / plan.upper[cell];
      const state = createPointTilingPointsState();
      const images: Image[] = [];
      expect(
        visitPointTilingPointsAttemptBounded(
          plan,
          ...source,
          1,
          state,
          (x, y, z, w, weight, candidate) =>
            images.push({ point: [x, y, z, w], weight, candidate }),
        ),
      ).toBe(retained ? 1 : 0);
      expect(state.candidateTests).toBe(1);
      if (retained) {
        expect(images).toEqual([
          { point: expected, weight: 1, candidate: cell },
        ]);
      } else {
        expect(images).toEqual([]);
      }
    }
  });

  it("serializes finite and lattice sequences exactly across irregular chunks", () => {
    const cases: { plan: PointTilingPlan; accepted: Point }[] = [
      {
        plan: planForGroup("f4"),
        accepted: chamberPoint(TILING_GROUP_INFO.f4),
      },
      { plan: latticePlan(4), accepted: [0.1, 0.2, 0.3, 0.4] },
    ];
    for (const { plan, accepted } of cases) {
      const stream = Array.from({ length: 73 }, (_, index) =>
        index % 5 === 4 ? [-10, 0, 0, 0] : accepted,
      );
      const run = (
        chunks: readonly (readonly Point[])[],
      ): { images: string[]; state: PointTilingPointsState } => {
        let state = createPointTilingPointsState();
        const images: string[] = [];
        for (let chunk = 0; chunk < chunks.length; chunk++) {
          if (chunk > 0) state = { ...state };
          for (const point of chunks[chunk]) {
            visitPointTilingPointsAttemptBounded(
              plan,
              ...scalarPoint(point),
              100_000 - state.emitted,
              state,
              (x, y, z, w, weight, candidate) =>
                images.push([x, y, z, w, weight, candidate].join(",")),
            );
          }
        }
        return { images, state };
      };
      const whole = run([stream]);
      const chunked = run([
        stream.slice(0, 1),
        stream.slice(1, 18),
        stream.slice(18, 51),
        stream.slice(51),
      ]);
      expect(chunked).toEqual(whole);
      expect(whole.images.every((image) => image.split(",")[4] === "1")).toBe(
        true,
      );
    }
  });

  it("validates u32, remainders, capacities, and counter overflow", () => {
    const finite = planForGroup("f4");
    const lattice = latticePlan(4);
    const source = scalarPoint(chamberPoint(TILING_GROUP_INFO.f4));
    expect(createPointTilingPointsState()).toEqual({
      cursor: 0,
      quotaRemainder: 0,
      attempts: 0,
      accepted: 0,
      candidateTests: 0,
      emitted: 0,
    });
    const invalidCursor = createPointTilingPointsState();
    invalidCursor.cursor = 0x1_0000_0000;
    expect(() =>
      visitPointTilingPointsAttemptBounded(
        finite,
        ...source,
        1,
        invalidCursor,
        () => {},
      ),
    ).toThrow(/u32/);
    const invalidRemainder = createPointTilingPointsState();
    invalidRemainder.quotaRemainder = TILING_GROUP_INFO.f4.order;
    expect(() =>
      visitPointTilingPointsAttemptBounded(
        finite,
        ...source,
        1,
        invalidRemainder,
        () => {},
      ),
    ).toThrow(/quota remainder/);
    const overflow = createPointTilingPointsState();
    overflow.attempts = Number.MAX_SAFE_INTEGER;
    expect(() =>
      visitPointTilingPointsAttemptBounded(
        finite,
        ...source,
        1,
        overflow,
        () => {},
      ),
    ).toThrow(/counters exceed/);
    const proposalOverflow = createPointTilingPointsState();
    proposalOverflow.candidateTests = Number.MAX_SAFE_INTEGER;
    expect(() =>
      visitPointTilingPointsAttemptBounded(
        lattice,
        0,
        0,
        0,
        0,
        1,
        proposalOverflow,
        () => {},
      ),
    ).toThrow(/counters exceed/);
    expect(() =>
      visitPointTilingPointsAttemptBounded(
        finite,
        ...source,
        Number.MAX_SAFE_INTEGER + 1,
        createPointTilingPointsState(),
        () => {},
      ),
    ).toThrow(/output capacity/);
    const wrapping = createPointTilingPointsState();
    wrapping.cursor = 0xffff_ffff;
    visitPointTilingPointsAttemptBounded(
      lattice,
      0,
      0,
      0,
      0,
      1,
      wrapping,
      () => {},
    );
    expect(wrapping.cursor).toBe(0);
    expect(wrapping.candidateTests).toBe(1);
  });
});
