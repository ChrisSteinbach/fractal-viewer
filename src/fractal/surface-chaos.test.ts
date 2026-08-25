import { describe, expect, it } from "vitest";
import {
  buildSurfaceChaosDE,
  buildSurfaceDE,
  estimateDistance,
  estimateDistanceRefined,
  evaluateSurfaceNativeCarriers,
} from "./surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4,
  estimateDistance4Refined,
  surfaceNativeCarriers4,
} from "./surface-de-4d";
import type { HybridSchedule, Transform } from "./types";

function map(id: number, x: number, chaos?: number[], weight = 1): Transform {
  return {
    id,
    position: [x, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.25, 0.25, 0.25],
    weight,
    ...(chaos ? { chaos } : {}),
  };
}

const isolated = (): Transform[] => [map(0, -1, [1, 0]), map(1, 1, [0, 1])];

describe("Surface graph-directed CPU representation", () => {
  it("packs reverse predecessor masks in compact recursive-map order", () => {
    const de = buildSurfaceDE(isolated());
    expect(de.maps.map((m) => m.stateIndex)).toEqual([0, 1]);
    expect([...de.chaos!.predecessorMasks]).toEqual([0b01, 0b10]);

    const leaked = buildSurfaceDE([map(0, -1, [1, 1e-12]), map(1, 1, [0, 7])]);
    // Magnitudes do not move geometry: every positive entry is one edge.
    expect([...leaked.chaos!.predecessorMasks]).toEqual([0b01, 0b11]);
  });

  it("uses global support for zero and non-finite weighted row totals", () => {
    const zero = [
      // The only positive chi entry points at a zero-weight destination, so
      // the effective weighted row is still empty and must fall back.
      map(0, -1, [0, 0, 100], 2),
      map(1, 1, [0, 1, 0], 2),
      map(2, 20, [1, 1, 1], 0),
    ];
    const overflow = [map(0, -1, [1e308, 0], 2), map(1, 1, [0, 1], 2)];
    expect([
      ...buildSurfaceChaosDE(zero, [0, 1], [])!.predecessorMasks,
    ]).toEqual([0b01, 0b11]);
    expect([
      ...buildSurfaceChaosDE(overflow, [0, 1], [])!.predecessorMasks,
    ]).toEqual([0b01, 0b11]);
  });

  it("omits chi storage and preserves the classic descriptor for all-one rows", () => {
    const classic = [map(0, -1), map(1, 1)];
    const allOne = classic.map((t) => ({ ...t, chaos: [1, 1] }));
    expect(buildSurfaceDE(allOne)).toEqual(buildSurfaceDE(classic));
    expect(buildSurfaceDE4(allOne)).toEqual(buildSurfaceDE4(classic));
  });
});

describe("Surface graph-directed reverse descent", () => {
  it("removes forbidden cross-compositions in affine and refined 3D paths", () => {
    const crossPoint: [number, number, number] = [-2 / 3, 0, 0];
    const classic = buildSurfaceDE([map(0, -1), map(1, 1)]);
    const graph = buildSurfaceDE(isolated());
    expect(estimateDistance(classic, crossPoint)).toBeLessThanOrEqual(1e-5);
    expect(estimateDistance(graph, crossPoint)).toBeGreaterThan(0.4);
    expect(estimateDistanceRefined(graph, crossPoint)).toBeGreaterThan(0.4);
    const carriers = evaluateSurfaceNativeCarriers(graph, crossPoint);
    expect(carriers.rings).toBeGreaterThanOrEqual(0);
    expect(carriers.sheets).toBeLessThanOrEqual(1);
  });

  it("keeps wildcard through B, then enforces chi after the first A map", () => {
    const schedule: HybridSchedule = {
      transforms: [map(8, 0.2)],
      depth: 1,
    };
    // B(x)=.5x+.2 uses the authored scale below; this is B of the forbidden
    // A cross-composition, so it pins wildcard-at-d=k then chi at d=k+1.
    schedule.transforms[0].scale = [0.5, 0.5, 0.5];
    const q: [number, number, number] = [0.2 + 0.5 * (-2 / 3), 0, 0];
    const classic = buildSurfaceDE(
      [map(0, -1), map(1, 1)],
      null,
      { order: 1, plane: "xz" },
      { schedule },
    );
    const graph = buildSurfaceDE(
      isolated(),
      null,
      { order: 1, plane: "xz" },
      { schedule },
    );
    expect(estimateDistance(classic, q)).toBeLessThanOrEqual(1e-5);
    expect(estimateDistance(graph, q)).toBeGreaterThan(0.2);
  });

  it("shares emitter state across symmetry copies and prunes nested C0", () => {
    const emitter = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 0.12 },
          combine: "union" as const,
        },
      ],
    };
    const classic: Transform[] = [
      { ...map(0, -1), scale: [0.3, 0.3, 0.3] },
      { ...map(1, 1), scale: [0.2, 0.2, 0.2], emitter },
    ];
    const graph: Transform[] = [
      { ...classic[0], chaos: [1, 0] },
      { ...classic[1], chaos: [0, 1] },
    ];
    const de = buildSurfaceDE(graph, null, { order: 3, plane: "xz" });
    expect([...de.chaos!.emitterStateIndices]).toEqual([1, 1, 1]);
    expect(de.condensation!.emitters.map((e) => e.shadeIndex)).toEqual([
      1, 1, 1,
    ]);
    const nestedEmitter: [number, number, number] = [-0.7, 0, 0];
    expect(
      estimateDistance(buildSurfaceDE(classic), nestedEmitter),
    ).toBeLessThan(0);
    expect(
      estimateDistance(buildSurfaceDE(graph), nestedEmitter),
    ).toBeGreaterThan(0.4);
    // Root remains wildcard: the emitter itself is still visible.
    expect(estimateDistance(buildSurfaceDE(graph), [1, 0, 0])).toBeLessThan(0);

    const schedule: HybridSchedule = {
      transforms: [
        {
          ...map(9, 0.2),
          scale: [0.5, 0.5, 0.5],
        },
      ],
      depth: 1,
    };
    const scheduledNested: [number, number, number] = [-0.15, 0, 0];
    const build3 = (transforms: Transform[]) =>
      buildSurfaceDE(transforms, null, { order: 1, plane: "xz" }, { schedule });
    expect(estimateDistance(build3(classic), scheduledNested)).toBeLessThan(0);
    expect(estimateDistance(build3(graph), scheduledNested)).toBeGreaterThan(
      0.2,
    );
    const de4 = buildSurfaceDE4(
      graph,
      null,
      { order: 1, plane: "xz" },
      { schedule },
    );
    expect(estimateDistance4(de4, [...scheduledNested, 0])).toBeGreaterThan(
      0.2,
    );
  });

  it("keeps flat 3D and 4D graph descents numerically aligned", () => {
    const de3 = buildSurfaceDE(isolated());
    const de4 = buildSurfaceDE4(isolated());
    for (const p of [
      [-0.66, 0.1, 0],
      [0, 0.1, 0],
      [2, 0.1, 0],
    ] as const) {
      expect(estimateDistance4(de4, [p[0], p[1], p[2], 0])).toBeCloseTo(
        estimateDistance(de3, [p[0], p[1], p[2]]),
        6,
      );
    }
  });

  it("threads state through fold frontiers, refinement, carriers, and a 4D slab", () => {
    const folded = isolated().map((t) => ({
      ...t,
      variations: [{ type: "boxfold" as const, weight: 0.5 }],
    }));
    const p3: [number, number, number] = [0.2, 0.1, 0];
    const de3 = buildSurfaceDE(folded);
    expect(estimateDistance(de3, p3)).toBeGreaterThan(0);
    expect(estimateDistanceRefined(de3, p3)).toBeGreaterThan(0);
    expect(evaluateSurfaceNativeCarriers(de3, p3).rings).toBeLessThanOrEqual(1);

    const p4: [number, number, number, number] = [0.2, 0.1, 0, 0];
    const de4 = buildSurfaceDE4(folded);
    expect(estimateDistance4(de4, p4)).toBeGreaterThan(0);
    expect(estimateDistance4Refined(de4, p4)).toBeGreaterThan(0);
    expect(estimateDistance4(de4, p4, [0, 0, 0, 0.01])).toBeGreaterThan(0);
    expect(surfaceNativeCarriers4(de4, p4).sheets).toBeLessThanOrEqual(1);
  });
});
