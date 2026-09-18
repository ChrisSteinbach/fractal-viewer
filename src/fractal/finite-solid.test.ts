import {
  FINITE_SOLID_HALF_EXTENT,
  FINITE_SOLID_IDENTITY_POSE,
  analyzeFiniteSolidSystem,
  buildFiniteSolidConstruction,
  finiteSolidBoundaryNormal,
  finiteSolidCellOccupiedByRule,
  finiteSolidCells,
  finiteSolidContains,
  finiteSolidDistance,
  finiteSolidGridPlane,
  finiteSolidIntervals,
  finiteSolidNextBoundary,
  finiteSolidNextBoundaryFromAnchor,
  finiteSolidRaySideOccupancy,
  hyperMengerSpongeTransforms,
} from "./finite-solid";
import { mengerSponge } from "./presets";
import type { Vec3, Vec4 } from "./types";

const noSymmetry = { order: 1, plane: "xz" as const };

describe("finite-solid construction", () => {
  it("builds the study's cell counts at every level, both dimensions", () => {
    expect(
      finiteSolidCells(buildFiniteSolidConstruction("menger", 3, 1)),
    ).toHaveLength(20);
    expect(
      finiteSolidCells(buildFiniteSolidConstruction("menger", 3, 2)),
    ).toHaveLength(400);
    expect(
      finiteSolidCells(buildFiniteSolidConstruction("hyperMenger", 4, 1)),
    ).toHaveLength(48);
    expect(
      finiteSolidCells(buildFiniteSolidConstruction("hyperMenger", 4, 2)),
    ).toHaveLength(2304);
    const root = finiteSolidCells(buildFiniteSolidConstruction("menger", 3, 0));
    expect(root).toHaveLength(1);
    expect(root[0].half).toBe(FINITE_SOLID_HALF_EXTENT);
  });

  it("matches the occupancy rule exhaustively at level 2, both dimensions", () => {
    for (const [shape, dimension] of [
      ["menger", 3],
      ["hyperMenger", 4],
    ] as const) {
      const c = buildFiniteSolidConstruction(shape, dimension, 2);
      const g = c.gridSize;
      const index = new Array<number>(dimension).fill(0);
      let occupied = 0;
      const walk = (axis: number, linear: number): void => {
        if (axis === dimension) {
          const bitmap =
            (c.occupancy[linear >>> 5] & (1 << (linear & 31))) !== 0;
          const rule = finiteSolidCellOccupiedByRule(dimension, 2, index);
          expect(bitmap).toBe(rule);
          if (bitmap) occupied++;
          return;
        }
        for (let i = 0; i < g; i++) {
          index[axis] = i;
          walk(axis + 1, linear * g + i);
        }
      };
      walk(0, 0);
      expect(occupied).toBe(dimension === 3 ? 400 : 2304);
    }
  });

  it("places grid planes at the fixture's centred rational positions", () => {
    const plane = (i: number) =>
      finiteSolidGridPlane(i, FINITE_SOLID_HALF_EXTENT, 9);
    expect(plane(0)).toBe(-FINITE_SOLID_HALF_EXTENT);
    expect(plane(9)).toBe(FINITE_SOLID_HALF_EXTENT);
    expect(plane(4)).toBe(-0.08333333333333333);
    expect(plane(6)).toBeCloseTo(0.25, 15);
  });
});

describe("finite-solid admission", () => {
  it("admits the shipped Menger maps at levels 0..2 and refuses deeper", () => {
    const maps = mengerSponge();
    for (const level of [0, 1, 2]) {
      expect(
        analyzeFiniteSolidSystem(maps, null, noSymmetry, "menger", level)
          .status,
      ).toBe("eligible");
    }
    expect(
      analyzeFiniteSolidSystem(maps, null, noSymmetry, "menger", 3).status,
    ).toBe("ineligible");
  });

  it("admits the hyper-Menger's 48 maps in 4D and refuses them as 3D", () => {
    const maps = hyperMengerSpongeTransforms();
    const fourD = analyzeFiniteSolidSystem(
      maps,
      null,
      noSymmetry,
      "hyperMenger",
      2,
    );
    expect(fourD.status).toBe("eligible");
    expect(fourD.construction?.dimension).toBe(4);
    expect(
      analyzeFiniteSolidSystem(maps, null, noSymmetry, "menger", 2).status,
    ).toBe("ineligible");
  });

  it("refuses a w-flattened hyper-Menger as hyperMenger", () => {
    const flat = hyperMengerSpongeTransforms().map((t) => ({
      ...t,
      w: undefined,
    }));
    expect(
      analyzeFiniteSolidSystem(flat, null, noSymmetry, "hyperMenger", 2).status,
    ).toBe("ineligible");
  });

  it("refuses edited maps, kaleidoscopes, and warping finals with reasons", () => {
    const maps = mengerSponge();
    const edited = maps.map((t) => ({
      ...t,
      scale: [0.34, 0.34, 0.34] as [number, number, number],
    }));
    expect(
      analyzeFiniteSolidSystem(edited, null, noSymmetry, "menger", 2).reasons,
    ).toContainEqual(expect.stringContaining("third-contraction"));
    expect(
      analyzeFiniteSolidSystem(maps.slice(1), null, noSymmetry, "menger", 2)
        .reasons,
    ).toContainEqual(expect.stringContaining("20 active maps"));
    expect(
      analyzeFiniteSolidSystem(
        maps,
        null,
        { order: 3, plane: "xz" as const },
        "menger",
        2,
      ).reasons,
    ).toContainEqual(expect.stringContaining("kaleidoscope"));
    const final = { ...maps[0], id: 99, position: [0.6, 0, 0] as Vec3 };
    expect(
      analyzeFiniteSolidSystem(maps, final, noSymmetry, "menger", 2).reasons,
    ).toContainEqual(expect.stringContaining("final transform"));
  });
});

describe("finite-solid membership", () => {
  const c = buildFiniteSolidConstruction("menger", 3, 2);
  const pose = FINITE_SOLID_IDENTITY_POSE;

  it("contains points inside occupied cells and on shared faces, not in holes", () => {
    expect(finiteSolidContains(c, pose, [0.6, 0.6, 0.6])).toBe(true);
    // The level-1 centre cell is carved; the origin sits in the hole.
    expect(finiteSolidContains(c, pose, [0, 0, 0])).toBe(false);
    // The root's boundary face is closed-set membership.
    expect(finiteSolidContains(c, pose, [0.75, 0.6, 0.6])).toBe(true);
    expect(finiteSolidContains(c, pose, [2, 0, 0])).toBe(false);
  });

  it("keeps ray-side occupancy consistent just inside an occupied cell", () => {
    for (const d of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
    ] as const) {
      expect(
        finiteSolidRaySideOccupancy(c, pose, [0.6, 0.6, 0.6], [...d] as Vec3),
      ).toBe(true);
    }
  });
});

describe("finite-solid exact boundary query", () => {
  const c = buildFiniteSolidConstruction("menger", 3, 2);
  const pose = FINITE_SOLID_IDENTITY_POSE;

  it("crosses the root face exactly on an axis ray", () => {
    // y = 0 rides the y-middle slab (cell index 4, an outer middle) and
    // z = 0.6 the top third (index 8): the column (i, 4, 8) is occupied at
    // every i, so the first crossing is the root's +x face.
    const hit = finiteSolidNextBoundary(c, pose, [2, 0, 0.6], [-1, 0, 0], {
      inside: false,
    });
    expect(hit.kind).toBe("boundary");
    if (hit.kind !== "boundary") return;
    expect(hit.t).toBe(1.25);
    expect(hit.entering).toBe(true);
    expect(hit.outwardNormal).toEqual([1, 0, 0]);
    expect(hit.face).toEqual({ axis: 0, planeIndex: 9, level: 2 });
    expect(hit.anchor.cellIndices).toEqual([8, 4, 8, -1]);
  });

  it("exits at a tied corner with one atomic event and the projected normal", () => {
    // A body diagonal from [0.6, 0.6, 0.6] reaches all three planes 9 at
    // t = 0.15 exactly; the exit is ONE event carrying all three tied
    // planes, its normal the incident direction's projection onto the tied
    // faces' span (the unit diagonal here), outward sign.
    const hit = finiteSolidNextBoundary(c, pose, [0.6, 0.6, 0.6], [1, 1, 1], {
      inside: true,
    });
    expect(hit.kind).toBe("boundary");
    if (hit.kind !== "boundary") return;
    expect(hit.t).toBeCloseTo(0.15, 12);
    expect(hit.entering).toBe(false);
    expect(hit.anchor.planeMask).toBe(7);
    const s = 1 / Math.sqrt(3);
    expect(hit.outwardNormal[0]).toBeCloseTo(s, 12);
    expect(hit.outwardNormal[1]).toBeCloseTo(s, 12);
    expect(hit.outwardNormal[2]).toBeCloseTo(s, 12);
  });

  it("misses when the ray never enters the root", () => {
    expect(
      finiteSolidNextBoundary(c, pose, [2, 2, 2], [0, 1, 0], { inside: false })
        .kind,
    ).toBe("miss");
  });

  it("continues from an anchor and refuses a wrong claimed medium", () => {
    const first = finiteSolidNextBoundary(c, pose, [2, 0, 0.6], [-1, 0, 0], {
      inside: false,
    });
    if (first.kind !== "boundary") throw new Error("expected a boundary");
    const next = finiteSolidNextBoundaryFromAnchor(c, pose, [-1, 0, 0], {
      inside: true,
      anchor: first.anchor,
    });
    expect(next.kind).toBe("boundary");
    if (next.kind === "boundary") {
      expect(next.t).toBeGreaterThan(0);
      expect(next.entering).toBe(false);
    }
    const wrongMedium = finiteSolidNextBoundaryFromAnchor(c, pose, [-1, 0, 0], {
      inside: false,
      anchor: first.anchor,
    });
    expect(wrongMedium.kind).toBe("refused");
    if (wrongMedium.kind === "refused") {
      expect(wrongMedium.reason).toBe("state-mismatch");
    }
  });

  it("refuses invalid input loudly", () => {
    expect(
      finiteSolidNextBoundary(c, pose, [2, 0, 0.6], [0, 0, 0], {
        inside: false,
      }),
    ).toEqual({ kind: "refused", reason: "invalid-input", visits: 0 });
    expect(
      finiteSolidNextBoundary(c, pose, [NaN, 0, 0.6], [-1, 0, 0], {
        inside: false,
      }).kind,
    ).toBe("refused");
  });
});

describe("finite-solid corner normals", () => {
  const pose = FINITE_SOLID_IDENTITY_POSE;

  it("uses the crossed face's own normal for single-face events", () => {
    const entering = finiteSolidBoundaryNormal(pose, 3, [0, 0, -1], 1, true);
    expect(entering![0]).toBeCloseTo(1, 15);
    expect(entering![1]).toBeCloseTo(0, 15);
    expect(entering![2]).toBeCloseTo(0, 15);
    const exiting = finiteSolidBoundaryNormal(pose, 3, [0, 0, -1], 1, false);
    expect(exiting![0]).toBeCloseTo(-1, 15);
    expect(exiting![1]).toBeCloseTo(0, 15);
    expect(exiting![2]).toBeCloseTo(0, 15);
  });

  it("projects onto the tied faces' span at exact corners", () => {
    const n = finiteSolidBoundaryNormal(pose, 3, [1, 1, 0], 3, true);
    expect(n).not.toBeNull();
    expect(n![0]).toBeCloseTo(-1 / Math.SQRT2, 15);
    expect(n![1]).toBeCloseTo(-1 / Math.SQRT2, 15);
    expect(n![2]).toBeCloseTo(0, 15);
  });

  it("refuses a direction orthogonal to every tied face's span", () => {
    expect(finiteSolidBoundaryNormal(pose, 3, [0, 0, 1], 3, true)).toBeNull();
  });
});

describe("finite-solid signed field and intervals", () => {
  const c = buildFiniteSolidConstruction("menger", 3, 2);
  const pose = FINITE_SOLID_IDENTITY_POSE;

  it("is negative inside occupied cells and positive in the holes", () => {
    expect(finiteSolidDistance(c, pose, [0.6, 0.6, 0.6])).toBeLessThan(0);
    expect(finiteSolidDistance(c, pose, [0, 0, 0])).toBeGreaterThan(0);
    expect(finiteSolidDistance(c, pose, [5, 5, 5])).toBeGreaterThan(0);
  });

  it("reads zero exactly at an interior shared plane and negative just inside", () => {
    // x = plane 8 is the shared face of cells (7,8,8) and (8,8,8), both
    // occupied: the min-box field reads 0 there (the union's own interior)
    // — which is exactly why the transport's medium oracle is the DDA,
    // never this field. Just inside cell 8 the field is the local box's
    // interior depth.
    const shared = (0.75 * (2 * 8 - 9)) / 9;
    expect(finiteSolidDistance(c, pose, [shared, 0.65, 0.65])).toBeCloseTo(
      0,
      12,
    );
    expect(finiteSolidDistance(c, pose, [0.6, 0.65, 0.65])).toBeLessThan(0);
  });

  it("unions per-cell slab intervals without merging positive gaps", () => {
    // The column (i, 6, 4) is occupied at i ∈ {0, 2, 6, 8}: four disjoint
    // segments with real gaps between them.
    const intervals = finiteSolidIntervals(c, pose, [2, 0.3, 0], [-1, 0, 0]);
    expect(intervals).toHaveLength(4);
    const enters = intervals.map((s) => s.enter);
    expect(enters[0]).toBeCloseTo(1.25, 12);
    expect(enters[1]).toBeCloseTo(1.5833333333333333, 12);
    expect(enters[2]).toBeCloseTo(2.25, 12);
    expect(enters[2] - 2.25).toBeLessThan(1e-12);
    expect(enters[3]).toBeCloseTo(2.5833333333333335, 12);
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i].enter).toBeGreaterThan(intervals[i - 1].exit);
    }
    expect(intervals[intervals.length - 1].exit).toBeCloseTo(2.75, 12);
  });

  it("keeps one solid interval along the fully occupied edge column", () => {
    // y = 0.6, z = 0.6 rides the corner-edge column (i,8,8), occupied at
    // every i: one interval from the near face to the far face.
    const intervals = finiteSolidIntervals(c, pose, [2, 0.6, 0.6], [-1, 0, 0]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].enter).toBeCloseTo(1.25, 12);
    expect(intervals[0].exit).toBeCloseTo(2.75, 12);
  });
});

describe("finite-solid 4D pose", () => {
  const c = buildFiniteSolidConstruction("hyperMenger", 4, 2);
  const pose = FINITE_SOLID_IDENTITY_POSE;

  it("displays the w=0 cells under the identity pose", () => {
    // y = 0.6, z = 0.6 put the ray in the +x/+y corner column; the w = 0
    // slice keeps the cells whose w-extent covers 0 (w index 4).
    const hit = finiteSolidNextBoundary(c, pose, [2, 0.6, 0.6], [-1, 0, 0], {
      inside: false,
    });
    expect(hit.kind).toBe("boundary");
    if (hit.kind !== "boundary") return;
    expect(hit.t).toBe(1.25);
    expect(hit.anchor.cellIndices).toEqual([8, 8, 8, 4]);
  });

  it("uses the crossed row's xyz part as the displayed normal", () => {
    const posed = {
      rows: [
        [1, 0, 0, 0],
        [0, 0.6, 0, 0.8],
        [0, 0, 1, 0],
        [0, -0.8, 0, 0.6],
      ] as [Vec4, Vec4, Vec4, Vec4],
      slice: 0,
    };
    const n = finiteSolidBoundaryNormal(posed, 4, [0, 0.6, 0], 2, true);
    expect(n).not.toBeNull();
    expect(n![0]).toBeCloseTo(0, 15);
    expect(n![1]).toBeCloseTo(-1, 15);
    expect(n![2]).toBeCloseTo(0, 15);
  });
});
