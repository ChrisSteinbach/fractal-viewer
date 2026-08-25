import { applyAffine, composeAffine } from "./affine";
import { applyAffine4, composeAffine4, toTransform4 } from "./affine4";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistance,
} from "./surface-de";
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  estimateDistance4,
} from "./surface-de-4d";
import type { HybridSchedule, Transform, Vec3 } from "./types";

/**
 * Exact finite-word oracle for Surface's scheduled prefix. This deliberately
 * does not call either distance estimator: it fixes the construction they
 * must invert before the CPU, GLSL and WGSL mirrors grow their level switch.
 */
function applyWord3(
  point: Vec3,
  transforms: readonly Transform[],
  word: readonly number[],
): Vec3 {
  let p = point;
  for (const index of word) {
    const affine = composeAffine(transforms[index]);
    p = applyAffine(affine, p[0], p[1], p[2]);
  }
  return p;
}

/** Invert the diagonal fixtures below in the only sound order: last B first. */
function undoWord3(
  point: Vec3,
  transforms: readonly Transform[],
  word: readonly number[],
): Vec3 {
  let p = point;
  for (let at = word.length - 1; at >= 0; at--) {
    const transform = transforms[word[at]];
    p = [
      (p[0] - transform.position[0]) / transform.scale[0],
      (p[1] - transform.position[1]) / transform.scale[1],
      (p[2] - transform.position[2]) / transform.scale[2],
    ];
  }
  return p;
}

function map(id: number, position: Vec3, scale: Vec3): Transform {
  return { id, position, rotation: [0, 0, 0], scale };
}

const B: Transform[] = [
  map(0, [1, -0.25, 0.5], [0.5, 0.25, 0.75]),
  map(1, [-0.5, 2, -1], [0.25, 0.5, 0.5]),
];
const A_POINT: Vec3 = [0.25, -0.5, 0.75];

describe("scheduled Surface finite-word oracle", () => {
  it("pins the k=1 and k=2 alphabets without merging or cycling A and B", () => {
    const k1 = [applyWord3(A_POINT, B, [0]), applyWord3(A_POINT, B, [1])];
    const k2 = [
      applyWord3(A_POINT, B, [0, 0]),
      applyWord3(A_POINT, B, [0, 1]),
      applyWord3(A_POINT, B, [1, 0]),
      applyWord3(A_POINT, B, [1, 1]),
    ];

    expect(k1).toEqual([
      [1.125, -0.375, 1.0625],
      [-0.4375, 1.75, -0.625],
    ]);
    expect(k2).toEqual([
      [1.5625, -0.34375, 1.296875],
      [-0.21875, 1.8125, -0.46875],
      [0.78125, 0.1875, 0.03125],
      [-0.609375, 2.875, -1.3125],
    ]);
  });

  it("undoes a depth-two word last-B-first and catches the opposite order", () => {
    const visible = applyWord3(A_POINT, B, [0, 1]);
    expect(undoWord3(visible, B, [0, 1])).toEqual(A_POINT);
    expect(undoWord3(visible, B, [1, 0])).not.toEqual(A_POINT);
  });

  it("places the final lens outside the complete B word", () => {
    const finalTransform = map(2, [3, -1, 0.25], [2, 0.5, 1.5]);
    const afterWordThenLens = applyWord3(
      applyWord3(A_POINT, B, [0, 1]),
      [finalTransform],
      [0],
    );
    const afterLensThenWord = applyWord3(
      applyWord3(A_POINT, [finalTransform], [0]),
      B,
      [0, 1],
    );

    expect(afterWordThenLens).toEqual([2.5625, -0.09375, -0.453125]);
    expect(afterLensThenWord).not.toEqual(afterWordThenLens);
    const wordSpace = undoWord3(afterWordThenLens, [finalTransform], [0]);
    expect(undoWord3(wordSpace, B, [0, 1])).toEqual(A_POINT);
  });

  it("lifts the same finite word flat into 4D", () => {
    const expected = applyWord3(A_POINT, B, [1, 0]);
    let p4: [number, number, number, number] = [...A_POINT, 0];
    for (const index of [1, 0]) {
      const affine = composeAffine4(toTransform4(B[index]));
      p4 = applyAffine4(affine, p4[0], p4[1], p4[2], p4[3]);
    }

    expect(p4).toEqual([...expected, 0]);
  });
});

const NO_SYMMETRY = { order: 1, plane: "xz" as const };
const A_POINT_MAP = map(10, [0.2, -0.4, 0.6], [0.2, 0.2, 0.2]);
const A_FIXED_POINT: Vec3 = [0.25, -0.5, 0.75];

function schedule(depth: number, transforms = B): HybridSchedule {
  return { depth, transforms };
}

describe("scheduled Surface production CPU oracle", () => {
  it("keeps absent, empty and zero-depth schedules exactly classic", () => {
    const classic3 = buildSurfaceDE([A_POINT_MAP]);
    const empty3 = buildSurfaceDE([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: { depth: 2, transforms: [] },
    });
    const zero3 = buildSurfaceDE([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: schedule(0),
    });
    expect(empty3).toEqual(classic3);
    expect(zero3).toEqual(classic3);

    const classic4 = buildSurfaceDE4([A_POINT_MAP]);
    const empty4 = buildSurfaceDE4([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: { depth: 2, transforms: [] },
    });
    const zero4 = buildSurfaceDE4([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: schedule(0),
    });
    expect(empty4).toEqual(classic4);
    expect(zero4).toEqual(classic4);
  });

  it("builds k+1 global bounds and certifies every B image of its child", () => {
    const rareFar = [
      { ...B[0], weight: 1 },
      map(12, [40, -30, 20], [0.75, 0.5, 0.25]),
    ];
    rareFar[1].weight = 1e-12;
    const de = buildSurfaceDE([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: schedule(2, rareFar),
    });
    expect(de.schedule?.bounds).toHaveLength(3);
    expect(de.boundingRadius).toBe(de.schedule!.bounds[0].radius);
    expect(de.boundCenter).toBe(de.schedule!.bounds[0].center);
    for (let d = 0; d < de.schedule!.depth; d++) {
      const parent = de.schedule!.bounds[d];
      const child = de.schedule!.bounds[d + 1];
      for (const t of rareFar) {
        const affine = composeAffine(t);
        const c = applyAffine(
          affine,
          child.center[0],
          child.center[1],
          child.center[2],
        );
        const sigmaMax = Math.max(...t.scale.map(Math.abs));
        expect(
          Math.hypot(
            c[0] - parent.center[0],
            c[1] - parent.center[1],
            c[2] - parent.center[2],
          ) +
            sigmaMax * child.radius,
        ).toBeLessThanOrEqual(parent.radius + 1e-10);
      }
    }
  });

  it("uses weighted support exactly, including the all-zero uniform fallback", () => {
    const weighted = B.map((t, i) => ({ ...t, weight: i === 0 ? 0 : 2 }));
    const weightedDE = buildSurfaceDE([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: schedule(1, weighted),
    });
    expect(weightedDE.schedule?.maps).toHaveLength(1);
    expect(weightedDE.schedule?.maps[0].baseIndex).toBe(0);

    const allZero = B.map((t) => ({ ...t, weight: 0 }));
    const zeroDE = buildSurfaceDE([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: schedule(1, allZero),
    });
    expect(zeroDE.schedule?.maps).toHaveLength(B.length);
  });

  it("refuses non-invertible B without applying a contraction gate", () => {
    const flat = map(20, [0, 0, 0], [0.5, 0, 0.5]);
    expect(
      analyzeSurfaceSystem([A_POINT_MAP], null, schedule(1, [flat])).status,
    ).toBe("ineligible");
    expect(() =>
      buildSurfaceDE([A_POINT_MAP], null, NO_SYMMETRY, {
        schedule: schedule(1, [flat]),
      }),
    ).toThrow(/schedule map/);
    expect(
      analyzeSurfaceSystem4([A_POINT_MAP], null, schedule(1, [flat])).status,
    ).toBe("ineligible");
    expect(() =>
      buildSurfaceDE4([A_POINT_MAP], null, NO_SYMMETRY, {
        schedule: schedule(1, [flat]),
      }),
    ).toThrow(/schedule map/);

    const expanding = map(21, [1, 0, 0], [1.25, 0.8, 0.6]);
    expect(
      analyzeSurfaceSystem([A_POINT_MAP], null, schedule(1, [expanding]))
        .status,
    ).not.toBe("ineligible");
    expect(
      analyzeSurfaceSystem4([A_POINT_MAP], null, schedule(1, [expanding]))
        .status,
    ).not.toBe("ineligible");
  });

  it("hits finite k=1/k=2 clouds and keeps the final lens outside B", () => {
    const finalTransform = map(30, [3, -1, 0.25], [2, 0.5, 1.5]);
    for (const word of [[0], [0, 1]]) {
      const visible = applyWord3(A_FIXED_POINT, B, word);
      const de = buildSurfaceDE([A_POINT_MAP], null, NO_SYMMETRY, {
        schedule: schedule(word.length),
      });
      expect(estimateDistance(de, visible)).toBeLessThanOrEqual(1e-3);

      const lensed = applyWord3(visible, [finalTransform], [0]);
      const withLens = buildSurfaceDE(
        [A_POINT_MAP],
        finalTransform,
        NO_SYMMETRY,
        { schedule: schedule(word.length) },
      );
      expect(estimateDistance(withLens, lensed)).toBeLessThanOrEqual(2e-3);
    }
  });

  it("uses B without authored A symmetry and selects the child-level bound", () => {
    const oneB = [B[0]];
    const de = buildSurfaceDE(
      [A_POINT_MAP],
      null,
      { order: 4, plane: "xy" },
      { schedule: schedule(1, oneB) },
    );
    const oneLevel = { ...de, maxDepth: 1 as const, beamWidth: 1 as const };
    const p: Vec3 = [2.3, 0.7, -1.1];
    const b = de.schedule!.maps[0];
    const q: Vec3 = [
      b.invM[0] * p[0] + b.invM[1] * p[1] + b.invM[2] * p[2] + b.invT[0],
      b.invM[3] * p[0] + b.invM[4] * p[1] + b.invM[5] * p[2] + b.invT[1],
      b.invM[6] * p[0] + b.invM[7] * p[1] + b.invM[8] * p[2] + b.invT[2],
    ];
    const root = de.schedule!.bounds[0];
    const child = de.schedule!.bounds[1];
    const sphere =
      Math.hypot(
        p[0] - root.center[0],
        p[1] - root.center[1],
        p[2] - root.center[2],
      ) - root.radius;
    const terminal =
      b.sigmaMin *
      (Math.hypot(
        q[0] - child.center[0],
        q[1] - child.center[1],
        q[2] - child.center[2],
      ) -
        child.radius);
    expect(estimateDistance(oneLevel, p)).toBe(Math.max(sphere, terminal));
  });

  it("shifts root-only condensation to A depth zero after the B prefix", () => {
    const emitter = map(40, [1, 0, 0], [0.2, 0.2, 0.2]);
    emitter.emitter = {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.3 },
          combine: "union",
        },
      ],
    };
    const oneB = [B[0]];
    const visibleCenter = applyWord3(emitter.position, oneB, [0]);
    const options = {
      schedule: schedule(1, oneB),
      condensationDepthBand: { minDepth: 0, maxDepth: 0 },
    };
    const de3 = buildSurfaceDE(
      [A_POINT_MAP, emitter],
      null,
      NO_SYMMETRY,
      options,
    );
    const de4 = buildSurfaceDE4(
      [A_POINT_MAP, emitter],
      null,
      NO_SYMMETRY,
      options,
    );
    expect(de3.condensation?.depthBand).toEqual({ minDepth: 0, maxDepth: 0 });
    expect(estimateDistance(de3, visibleCenter)).toBeLessThanOrEqual(0);
    expect(estimateDistance4(de4, [...visibleCenter, 0])).toBeLessThanOrEqual(
      0,
    );
  });

  it("keeps flat 3D and 4D schedules geometrically aligned", () => {
    const hybrid = schedule(2);
    const de3 = buildSurfaceDE([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: hybrid,
    });
    const de4 = buildSurfaceDE4([A_POINT_MAP], null, NO_SYMMETRY, {
      schedule: hybrid,
    });
    const visible = applyWord3(A_FIXED_POINT, B, [1, 0]);
    const d3 = estimateDistance(de3, visible);
    const d4 = estimateDistance4(de4, [...visible, 0]);
    expect(d3).toBeLessThanOrEqual(1e-3);
    expect(d4).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(d3 - d4)).toBeLessThan(2e-3);
    expect(de4.schedule?.bounds).toHaveLength(3);
    expect(de4.boundingRadius).toBe(de4.schedule!.bounds[0].radius);
    expect(analyzeSurfaceSystem4([A_POINT_MAP], null, hybrid).status).not.toBe(
      "ineligible",
    );
  });
});
