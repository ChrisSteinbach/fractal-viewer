import {
  FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES,
  FINITE_SOLID_HALF_EXTENT,
  FINITE_SOLID_IDENTITY_POSE,
  analyzeFiniteSolidGeneral,
  analyzeFiniteSolidSystem,
  buildFiniteSolidConstruction,
  finiteSolidBoundaryNormal,
  finiteSolidBoundingRadius,
  finiteSolidCellOccupiedByRule,
  finiteSolidCells,
  finiteSolidContains,
  finiteSolidDisplayDistance,
  finiteSolidDistance,
  finiteSolidGeneralBoundingRadius,
  finiteSolidGeneralContains,
  finiteSolidGeneralDisplayDistance,
  finiteSolidGeneralIntervals,
  finiteSolidGeneralNextBoundary,
  finiteSolidGeneralNextBoundaryFromAnchor,
  finiteSolidGridPlane,
  finiteSolidIntervals,
  finiteSolidNextBoundary,
  finiteSolidNextBoundaryFromAnchor,
  finiteSolidRaySideOccupancy,
  hyperMengerSpongeTransforms,
  resolveFiniteSolid,
  type FiniteSolidAnchor,
  type FiniteSolidGeneralConstruction,
} from "./finite-solid";
import {
  defaultTransforms,
  mengerSponge,
  pentatope,
  sierpinskiTetrahedron,
} from "./presets";
import { mulberry32 } from "./rng";
import type { Transform, Vec3, Vec4 } from "./types";

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
  it("resolves an authored block and refuses bad ones without clamping", () => {
    expect(resolveFiniteSolid({ shape: "menger", level: 2 })).toEqual({
      ok: true,
      value: { kind: "shaped", shape: "menger", level: 2 },
    });
    expect(resolveFiniteSolid({ shape: "hyperMenger", level: 0 })).toEqual({
      ok: true,
      value: { kind: "shaped", shape: "hyperMenger", level: 0 },
    });
    // The SHAPE-LESS block: `{level}` alone resolves the general word tree
    // built from the document's own maps.
    expect(resolveFiniteSolid({ level: 2 })).toEqual({
      ok: true,
      value: { kind: "general", level: 2 },
    });
    // Missing levels, out-of-band levels, and unknown keys all refuse with
    // reasons — a refusal is the block's persisted state, never a clamp.
    for (const block of [
      {},
      { shape: "menger" },
      { level: 2.5 },
      { shape: "sponge", level: 2 },
      { shape: "menger", level: 3 },
      { shape: "menger", level: -1 },
      { shape: "menger", level: 1.5 },
      { shape: "menger", level: 2, warp: true },
      { level: 1, warp: true },
      { shape: "", level: 1 },
    ]) {
      const r = resolveFiniteSolid(block);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("derives the construction's circumscribed bound in both dimensions", () => {
    expect(finiteSolidBoundingRadius(3)).toBeCloseTo(
      FINITE_SOLID_HALF_EXTENT * Math.sqrt(3),
      15,
    );
    expect(finiteSolidBoundingRadius(4)).toBeCloseTo(
      FINITE_SOLID_HALF_EXTENT * 2,
      15,
    );
  });

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

describe("finite-solid display distance (the certified hybrid)", () => {
  const marchDisplay = (
    c: ReturnType<typeof buildFiniteSolidConstruction>,
    pose: { rows: [Vec4, Vec4, Vec4, Vec4]; slice: number },
    origin: Vec3,
    rawDir: Vec3,
    tMax: number,
  ): number | null => {
    const len = Math.hypot(rawDir[0], rawDir[1], rawDir[2]);
    const dir: Vec3 = [rawDir[0] / len, rawDir[1] / len, rawDir[2] / len];
    let t = 0;
    for (let i = 0; i < 4096; i++) {
      const d = finiteSolidDisplayDistance(c, pose, [
        origin[0] + dir[0] * t,
        origin[1] + dir[1] * t,
        origin[2] + dir[2] * t,
      ]);
      if (d < 1e-5) return t;
      t += d * 0.9;
      if (t > tMax) return null;
    }
    return null;
  };

  it("level 1 equals the flat field's certified bound", () => {
    const c = buildFiniteSolidConstruction("menger", 3, 1);
    const pose = FINITE_SOLID_IDENTITY_POSE;
    for (const p of [
      [2, 0.1, 0.1],
      [0.6, 0.6, 0.6],
      [0.4, 0.1, 0.1],
      [1.5, -0.7, 0],
    ] as Vec3[]) {
      expect(finiteSolidDisplayDistance(c, pose, p)).toBeCloseTo(
        finiteSolidDistance(c, pose, p),
        12,
      );
    }
  });

  it("level 0 is the root box", () => {
    const c = buildFiniteSolidConstruction("menger", 3, 0);
    expect(
      finiteSolidDisplayDistance(c, FINITE_SOLID_IDENTITY_POSE, [5, 0, 0]),
    ).toBeCloseTo((5 - 0.75) * 0.9, 12);
  });

  it("reads zero on the union's boundary, both dimensions, both levels", () => {
    for (const [shape, dimension, level] of [
      ["menger", 3, 1],
      ["menger", 3, 2],
      ["hyperMenger", 4, 1],
      ["hyperMenger", 4, 2],
    ] as const) {
      const c = buildFiniteSolidConstruction(shape, dimension, level);
      const pose = FINITE_SOLID_IDENTITY_POSE;
      for (const cell of finiteSolidCells(c)) {
        // Step to each box face along its first axis and back off by an
        // exact face offset: the point sits ON the union's surface only
        // if no other cell contains it, which the flat field confirms.
        const onFace: Vec3 =
          dimension === 3
            ? [
                cell.center[0] + cell.half + 1e-9,
                cell.center[1],
                cell.center[2],
              ]
            : [
                cell.center[0] + cell.half + 1e-9,
                cell.center[1],
                cell.center[2],
              ];
        const flat = finiteSolidDistance(c, pose, onFace);
        if (Math.abs(flat) < 1e-6) {
          expect(
            Math.abs(finiteSolidDisplayDistance(c, pose, onFace)),
          ).toBeLessThan(1e-5);
        }
      }
    }
  });

  it("never overstates the flat field's certified bound by more than the refine margin", () => {
    // Both are lower bounds of the true distance; the hybrid may exceed
    // the flat one only inside the refine band's honest recesses. The
    // march-safety scaling keeps both comparable; pin the hybrid within
    // one level-1 cell width of the flat value at sampled outside points.
    const c = buildFiniteSolidConstruction("menger", 3, 2);
    const pose = FINITE_SOLID_IDENTITY_POSE;
    for (const p of [
      [2, 0.1, 0.1],
      [1.2, 0.55, -0.3],
      [0.26, 0.55, 0.55],
      [0.55, 0.55, 0.55],
    ] as Vec3[]) {
      const flat = finiteSolidDistance(c, pose, p);
      const hybrid = finiteSolidDisplayDistance(c, pose, p);
      expect(hybrid).toBeLessThanOrEqual(flat / 0.9 + 1e-9);
    }
  });

  it("marches tunnel-axis rays through the level-2 construction without sealing the mouths", () => {
    // The axis tunnel through the middle thirds is EMPTY: the exact
    // interval union has no crossing for a ray down its axis, and the
    // display march must agree. The naive level-1 min reads 0 at the
    // tunnel mouth and fails exactly here.
    for (const [shape, dimension] of [
      ["menger", 3],
      ["hyperMenger", 4],
    ] as const) {
      const c = buildFiniteSolidConstruction(shape, dimension, 2);
      const pose = FINITE_SOLID_IDENTITY_POSE;
      expect(finiteSolidIntervals(c, pose, [2, 0, 0], [-1, 0, 0])).toHaveLength(
        0,
      );
      expect(marchDisplay(c, pose, [2, 0, 0], [-1, 0, 0], 6)).toBeNull();
    }
  });

  it("marched hits agree with the exact interval union on sampled rays, both dimensions", () => {
    for (const [shape, dimension] of [
      ["menger", 3],
      ["hyperMenger", 4],
    ] as const) {
      const c = buildFiniteSolidConstruction(shape, dimension, 2);
      const pose = FINITE_SOLID_IDENTITY_POSE;
      const rays: Array<[Vec3, Vec3]> = [
        [
          [2, 0.6, 0.6],
          [-1, 0, 0],
        ],
        [
          [2, 0.1, 0.1],
          [-1, 0, 0],
        ],
        [
          [0, 2, 0.55],
          [0, -1, 0],
        ],
        [
          [1.5, 1.5, 1.5],
          [-1, -1, -1],
        ],
        [
          [1.2, 0.26, 0.62],
          [-1, -0.3, 0.2],
        ],
      ];
      for (const [origin, dir] of rays) {
        const intervals = finiteSolidIntervals(c, pose, origin, dir);
        const hit = marchDisplay(c, pose, origin, dir, 8);
        if (intervals.length === 0) {
          expect(hit).toBeNull();
        } else {
          expect(hit).not.toBeNull();
          const len = Math.hypot(dir[0], dir[1], dir[2]);
          expect(hit as number).toBeGreaterThan(
            intervals[0].enter * len - 2e-3,
          );
          expect(hit as number).toBeLessThan(intervals[0].enter * len + 2e-3);
        }
      }
    }
  });

  it("keeps the certified bound under a posed 4D slice", () => {
    // An exact xw/yw double rotation (unit rows), the slice at w = 0.
    const s = Math.sqrt(0.5);
    const pose = {
      rows: [
        [1, 0, 0, 0],
        [0, s, 0, -s],
        [0, 0, 1, 0],
        [0, s, 0, s],
      ] as [Vec4, Vec4, Vec4, Vec4],
      slice: 0,
    };
    const c = buildFiniteSolidConstruction("hyperMenger", 4, 2);
    // The intrinsic +x axis maps to the world direction (0, s, 0): a ray
    // down the rotated tunnel axis must stay a miss, exactly as in the
    // identity pose.
    expect(finiteSolidIntervals(c, pose, [2, 0, 0], [0, 1, 0])).toHaveLength(0);
    expect(marchDisplay(c, pose, [2, 0, 0], [0, 1, 0], 8)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The general construction: the document's OWN maps as the SIMPLICIAL cell
// tree.
// ---------------------------------------------------------------------------

/** The rotated pentatope: three of five maps turn, one of them out of 3D
 * through xw — no invariant simplex exists, so the derived root rides the
 * level boxes. The 4D half of the default system's witness. */
function rotatedPentatope(): Transform[] {
  const maps = pentatope();
  maps[1].rotation = [0, Math.PI / 4, 0];
  maps[2].w = { ...maps[2].w, rotation: { xw: Math.PI / 5 } };
  maps[3].rotation = [Math.PI / 4, 0, 0];
  return maps;
}

/** A seeded ray from a few bounding radii out, aimed near the centre. */
function sampledRay(rng: () => number, radius: number): [Vec3, Vec3] {
  const u = (): number => rng() * 2 - 1;
  const origin: Vec3 = [u() * 3 * radius, u() * 3 * radius, u() * 3 * radius];
  const target: Vec3 = [
    u() * 0.4 * radius,
    u() * 0.4 * radius,
    u() * 0.4 * radius,
  ];
  const d: Vec3 = [
    target[0] - origin[0],
    target[1] - origin[1],
    target[2] - origin[2],
  ];
  const length = Math.hypot(d[0], d[1], d[2]);
  return [origin, [d[0] / length, d[1] / length, d[2] / length]];
}

/** The boundary query chained along one ray: a fresh query from the
 * origin, then anchored continuations, accumulating each hop's t. */
function chainGeneralEvents(
  c: FiniteSolidGeneralConstruction,
  origin: Vec3,
  dir: Vec3,
): { events: Array<{ t: number; entering: boolean }>; end: string } {
  const pose = FINITE_SOLID_IDENTITY_POSE;
  const events: Array<{ t: number; entering: boolean }> = [];
  let result = finiteSolidGeneralNextBoundary(c, pose, origin, dir, {
    inside: finiteSolidGeneralContains(c, pose, origin),
  });
  let t = 0;
  for (let hop = 0; hop < 256; hop++) {
    if (result.kind !== "boundary") {
      return {
        events,
        end: result.kind === "refused" ? result.reason : "miss",
      };
    }
    t += result.t;
    events.push({ t, entering: result.entering });
    result = finiteSolidGeneralNextBoundaryFromAnchor(c, pose, dir, {
      inside: result.entering,
      anchor: result.anchor,
    });
  }
  return { events, end: "runaway" };
}

describe("finite-solid general admission", () => {
  it("admits the Sierpinski document with its fixed points' own hull as the root", () => {
    const result = analyzeFiniteSolidGeneral(
      sierpinskiTetrahedron(),
      null,
      noSymmetry,
      1,
      3,
    );
    expect(result.status).toBe("eligible");
    const c = result.construction;
    expect(c?.rootKind).toBe("hull");
    // Each map is x/2 + p, so its fixed point is 2p.
    const expected: Vec3[] = [
      [0, 1.6, 0],
      [1.5, -0.8, 0],
      [-0.75, -0.8, 1.3],
      [-0.75, -0.8, -1.3],
    ];
    expected.forEach((vertex, i) => {
      for (let axis = 0; axis < 3; axis++) {
        expect(c?.rootVertices[i][axis]).toBeCloseTo(vertex[axis], 12);
      }
      expect(c?.rootVertices[i][3]).toBe(0);
    });
  });

  it("admits the viewer's rotating default system through the derived root", () => {
    const result = analyzeFiniteSolidGeneral(
      defaultTransforms(),
      null,
      noSymmetry,
      2,
      3,
    );
    expect(result.status).toBe("eligible");
    expect(result.construction?.rootKind).toBe("derived");
    expect(result.construction?.mapCount).toBe(4);
  });

  it("admits a rotated 4D document through the derived root", () => {
    const result = analyzeFiniteSolidGeneral(
      rotatedPentatope(),
      null,
      noSymmetry,
      2,
      4,
    );
    expect(result.status).toBe("eligible");
    expect(result.construction?.rootKind).toBe("derived");
    expect(result.construction?.rootVertices).toHaveLength(5);
  });

  it("refuses a map carrying variations", () => {
    const maps = sierpinskiTetrahedron().map((t, i) =>
      i === 0
        ? { ...t, variations: [{ type: "mandelbox" as const, weight: 0.2 }] }
        : t,
    );
    const result = analyzeFiniteSolidGeneral(maps, null, noSymmetry, 1, 3);
    expect(result.status).toBe("ineligible");
    expect(result.reasons.join("; ")).toMatch(/carries variations/);
  });

  it("refuses a map that does not contract", () => {
    const maps = sierpinskiTetrahedron().map((t, i) =>
      i === 0 ? { ...t, scale: [1.2, 0.5, 0.5] as Vec3 } : t,
    );
    const result = analyzeFiniteSolidGeneral(maps, null, noSymmetry, 1, 3);
    expect(result.status).toBe("ineligible");
    expect(result.reasons.join("; ")).toMatch(/does not contract/);
  });

  it("refuses a map that collapses a direction", () => {
    const maps = sierpinskiTetrahedron().map((t, i) =>
      i === 0 ? { ...t, scale: [0.5, 0.5, 0] as Vec3 } : t,
    );
    const result = analyzeFiniteSolidGeneral(maps, null, noSymmetry, 1, 3);
    expect(result.status).toBe("ineligible");
    expect(result.reasons.join("; ")).toMatch(/collapses a direction/);
  });

  it("refuses maps whose fixed points span less than the dimension", () => {
    const result = analyzeFiniteSolidGeneral(
      sierpinskiTetrahedron().slice(0, 2),
      null,
      noSymmetry,
      1,
      3,
    );
    expect(result.status).toBe("ineligible");
    expect(result.reasons.join("; ")).toMatch(/span only 1 of 3/);
  });

  it("refuses levels outside the certified band 0..4", () => {
    for (const level of [-1, 1.5, 5]) {
      const result = analyzeFiniteSolidGeneral(
        sierpinskiTetrahedron(),
        null,
        noSymmetry,
        level,
        3,
      );
      expect(result.status).toBe("ineligible");
      expect(result.reasons.join("; ")).toMatch(/certified band 0\.\.4/);
    }
  });

  it("bounds every level-N cell by the level box and the marching ball", () => {
    // A derived root is not invariant, so a level-N cell can reach outside
    // it: the level box — one Hutchinson step per level — is the bound.
    for (const [maps, level, dimension] of [
      [defaultTransforms(), 3, 3],
      [rotatedPentatope(), 2, 4],
    ] as const) {
      const c = analyzeFiniteSolidGeneral(
        maps,
        null,
        noSymmetry,
        level,
        dimension,
      ).construction;
      if (!c) throw new Error("construction missing");
      const box = c.levelBoxes[level];
      const radius = finiteSolidGeneralBoundingRadius(c);
      const rng = mulberry32(3);
      for (let sample = 0; sample < 200; sample++) {
        // A random point of a random level-N cell: a random root barycentric
        // point pushed through a random word, innermost map first.
        const weights = c.rootVertices.map(() => rng());
        const total = weights.reduce((a, b) => a + b, 0);
        let p: Vec4 = [0, 0, 0, 0];
        c.rootVertices.forEach((v, i) => {
          for (let axis = 0; axis < 4; axis++) {
            p[axis] += (weights[i] / total) * v[axis];
          }
        });
        for (let depth = 0; depth < level; depth++) {
          const a = Math.floor(rng() * c.mapCount);
          const m = c.mapMatrix[a];
          const t = c.mapOffset[a];
          p = [0, 1, 2, 3].map(
            (r) =>
              m[r * 4] * p[0] +
              m[r * 4 + 1] * p[1] +
              m[r * 4 + 2] * p[2] +
              m[r * 4 + 3] * p[3] +
              t[r],
          ) as Vec4;
        }
        for (let axis = 0; axis < dimension; axis++) {
          expect(p[axis]).toBeGreaterThanOrEqual(box.min[axis] - 1e-12);
          expect(p[axis]).toBeLessThanOrEqual(box.max[axis] + 1e-12);
        }
        expect(Math.hypot(p[0], p[1], p[2], p[3])).toBeLessThanOrEqual(
          radius + 1e-12,
        );
      }
    }
  });
});

describe("finite-solid general walk", () => {
  it("crosses the gasket's axis in one hand-exact interval at every level", () => {
    // The vertical axis through the base centroid (0, −0.8, 0) and the apex
    // (0, 1.6, 0) threads the central holes and meets only the apex chain's
    // cell: y from 1.6 − 2.4·2^−L to the apex, t = y + 2 from the origin.
    for (let level = 0; level <= 4; level++) {
      const c = analyzeFiniteSolidGeneral(
        sierpinskiTetrahedron(),
        null,
        noSymmetry,
        level,
        3,
      ).construction;
      if (!c) throw new Error("construction missing");
      const union = finiteSolidGeneralIntervals(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        [0, -2, 0],
        [0, 1, 0],
      );
      expect(union).toHaveLength(1);
      expect(union[0].enter).toBeCloseTo(3.6 - 2.4 / 2 ** level, 12);
      expect(union[0].exit).toBeCloseTo(3.6, 12);
    }
  });

  it("enters the gasket's axis cell through its horizontal base with the −y normal", () => {
    const c = analyzeFiniteSolidGeneral(
      sierpinskiTetrahedron(),
      null,
      noSymmetry,
      2,
      3,
    ).construction;
    if (!c) throw new Error("construction missing");
    const entry = finiteSolidGeneralNextBoundary(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      [0, -2, 0],
      [0, 1, 0],
      { inside: false },
    );
    expect(entry.kind).toBe("boundary");
    if (entry.kind !== "boundary") return;
    expect(entry.entering).toBe(true);
    expect(entry.t).toBeCloseTo(3, 12);
    expect(entry.outwardNormal[0]).toBeCloseTo(0, 12);
    expect(entry.outwardNormal[1]).toBeCloseTo(-1, 12);
    expect(entry.outwardNormal[2]).toBeCloseTo(0, 12);
    // The anchor names the apex chain's cell by its word and one facet.
    expect(entry.anchor.cellIndices).toEqual([0, 0, -1, -1]);
    expect(entry.anchor.planeIndices).toEqual([-1, -1, -1, -1]);
    expect(entry.anchor.intrinsicPoint[1]).toBeCloseTo(1, 12);
  });

  it("chains its boundary events to exactly the uncapped interval union, both dimensions", () => {
    // The pruned walk (level-box node prune, capped) against the reference
    // enumeration of EVERY leaf: the level boxes make the prune exact for
    // every contracting family, so the chained medium flips are the union's
    // endpoints — overlapping cells' interior faces silent, genuine gaps
    // honest exit/entry pairs.
    for (const [maps, level, dimension] of [
      [defaultTransforms(), 3, 3],
      [sierpinskiTetrahedron(), 4, 3],
      [rotatedPentatope(), 2, 4],
      [hyperMengerSpongeTransforms(), 1, 4],
    ] as const) {
      const c = analyzeFiniteSolidGeneral(
        maps,
        null,
        noSymmetry,
        level,
        dimension,
      ).construction;
      if (!c) throw new Error("construction missing");
      const rng = mulberry32(11);
      const radius = finiteSolidGeneralBoundingRadius(c);
      for (let i = 0; i < 24; i++) {
        const [origin, dir] = sampledRay(rng, radius);
        const expected = finiteSolidGeneralIntervals(
          c,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          dir,
        ).flatMap((interval) => [
          { t: interval.enter, entering: true },
          { t: interval.exit, entering: false },
        ]);
        const chain = chainGeneralEvents(c, origin, dir);
        expect(chain.end).toBe("miss");
        expect(chain.events).toHaveLength(expected.length);
        chain.events.forEach((event, k) => {
          expect(event.entering).toBe(expected[k].entering);
          expect(Math.abs(event.t - expected[k].t)).toBeLessThan(
            1e-9 * Math.max(1, expected[k].t),
          );
        });
      }
    }
  });

  it("keeps point membership in agreement with the interval union", () => {
    for (const [maps, level, dimension] of [
      [defaultTransforms(), 3, 3],
      [rotatedPentatope(), 2, 4],
    ] as const) {
      const c = analyzeFiniteSolidGeneral(
        maps,
        null,
        noSymmetry,
        level,
        dimension,
      ).construction;
      if (!c) throw new Error("construction missing");
      const rng = mulberry32(17);
      const radius = finiteSolidGeneralBoundingRadius(c);
      for (let i = 0; i < 24; i++) {
        const [origin, dir] = sampledRay(rng, radius);
        const union = finiteSolidGeneralIntervals(
          c,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          dir,
        );
        for (let s = 0; s < 32; s++) {
          const t = (s / 32) * 6 * radius;
          const onBoundary = union.some(
            (x) => Math.abs(x.enter - t) < 1e-9 || Math.abs(x.exit - t) < 1e-9,
          );
          if (onBoundary) continue;
          const inside = union.some((x) => x.enter < t && t < x.exit);
          expect(
            finiteSolidGeneralContains(c, FINITE_SOLID_IDENTITY_POSE, [
              origin[0] + t * dir[0],
              origin[1] + t * dir[1],
              origin[2] + t * dir[2],
            ]),
          ).toBe(inside);
        }
      }
    }
  });

  it("keeps the display hybrid a certified bound: no step reaches past the next union entry", () => {
    for (const [maps, level, dimension] of [
      [defaultTransforms(), 3, 3],
      [sierpinskiTetrahedron(), 3, 3],
      [rotatedPentatope(), 2, 4],
    ] as const) {
      const c = analyzeFiniteSolidGeneral(
        maps,
        null,
        noSymmetry,
        level,
        dimension,
      ).construction;
      if (!c) throw new Error("construction missing");
      const rng = mulberry32(23);
      const radius = finiteSolidGeneralBoundingRadius(c);
      for (let i = 0; i < 24; i++) {
        const [origin, dir] = sampledRay(rng, radius);
        const union = finiteSolidGeneralIntervals(
          c,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          dir,
        );
        for (let s = 0; s < 32; s++) {
          const t = (s / 32) * 6 * radius;
          if (union.some((x) => x.enter <= t && t <= x.exit)) continue;
          const next = union.find((x) => x.enter > t);
          if (!next) continue;
          const estimate = finiteSolidGeneralDisplayDistance(
            c,
            FINITE_SOLID_IDENTITY_POSE,
            [
              origin[0] + t * dir[0],
              origin[1] + t * dir[1],
              origin[2] + t * dir[2],
            ],
          );
          expect(estimate).toBeLessThanOrEqual(next.enter - t + 1e-12);
        }
      }
    }
  });

  it("replaces a near branch box by its children, reading positive where the plain box min seals", () => {
    // (0.6, 1.5, 0.5) sits inside the gasket's level-2 apex branch box
    // M_0(levelBoxes[1]) — x ≤ 0.75, 0.4 ≤ y ≤ 1.6, |z| ≤ 0.65 — so the
    // plain branch min reads it at or below zero, yet outside all four of
    // that branch's children boxes (the apex child stops at x = 0.375, the
    // base children at y = 1.0) and outside the solid. The REPLACED term
    // is positive; a min over the parent and its children would not be.
    const c = analyzeFiniteSolidGeneral(
      sierpinskiTetrahedron(),
      null,
      noSymmetry,
      2,
      3,
    ).construction;
    if (!c) throw new Error("construction missing");
    const p: Vec3 = [0.6, 1.5, 0.5];
    expect(finiteSolidGeneralContains(c, FINITE_SOLID_IDENTITY_POSE, p)).toBe(
      false,
    );
    expect(
      finiteSolidGeneralDisplayDistance(c, FINITE_SOLID_IDENTITY_POSE, p),
    ).toBeGreaterThan(0);
  });

  it("refuses an anchored continuation that claims the wrong medium", () => {
    const c = analyzeFiniteSolidGeneral(
      sierpinskiTetrahedron(),
      null,
      noSymmetry,
      2,
      3,
    ).construction;
    if (!c) throw new Error("construction missing");
    const entry = finiteSolidGeneralNextBoundary(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      [0, -2, 0],
      [0, 1, 0],
      { inside: false },
    );
    if (entry.kind !== "boundary") throw new Error("entry missing");
    const wrong = finiteSolidGeneralNextBoundaryFromAnchor(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      [0, 1, 0],
      { inside: false, anchor: entry.anchor },
    );
    expect(wrong).toMatchObject({ kind: "refused", reason: "state-mismatch" });
  });

  it("refuses an anchor that fills a plane slot or names the wrong depth", () => {
    const c = analyzeFiniteSolidGeneral(
      sierpinskiTetrahedron(),
      null,
      noSymmetry,
      2,
      3,
    ).construction;
    if (!c) throw new Error("construction missing");
    const entry = finiteSolidGeneralNextBoundary(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      [0, -2, 0],
      [0, 1, 0],
      { inside: false },
    );
    if (entry.kind !== "boundary") throw new Error("entry missing");
    for (const anchor of [
      { ...entry.anchor, planeIndices: [0, -1, -1, -1] },
      { ...entry.anchor, cellIndices: [0, -1, -1, -1] },
      { ...entry.anchor, cellIndices: [0, 0, 0, -1] },
      { ...entry.anchor, planeMask: 1 << 4 },
    ] as FiniteSolidAnchor[]) {
      expect(
        finiteSolidGeneralNextBoundaryFromAnchor(
          c,
          FINITE_SOLID_IDENTITY_POSE,
          [0, 1, 0],
          { inside: true, anchor },
        ),
      ).toMatchObject({ kind: "refused", reason: "invalid-input" });
    }
  });

  it("refuses a ray that clips more pruned leaves than the cap, never truncating", () => {
    // Twelve heavily overlapping half-scale maps whose fixed points sit on
    // a small shell: a ray through the centre clips nearly every one of the
    // 144 level-2 cells, past the 128-leaf cap.
    const directions: Vec3[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0.6, 0.8, 0],
      [-0.6, 0.8, 0],
      [0, 0.6, 0.8],
      [0, -0.6, 0.8],
      [0.8, 0, 0.6],
      [0.8, 0, -0.6],
    ];
    const maps: Transform[] = directions.map((d, id) => ({
      id,
      position: [d[0] * 0.05, d[1] * 0.05, d[2] * 0.05],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    }));
    const c = analyzeFiniteSolidGeneral(
      maps,
      null,
      noSymmetry,
      2,
      3,
    ).construction;
    if (!c) throw new Error("construction missing");
    expect(c.mapCount ** 2).toBeGreaterThan(
      FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES,
    );
    const result = finiteSolidGeneralNextBoundary(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      [0.01, -5, 0.02],
      [0, 1, 0],
      { inside: false },
    );
    expect(result).toMatchObject({ kind: "refused", reason: "visit-cap" });
    // The uncapped reference still sees the solid on that ray.
    expect(
      finiteSolidGeneralIntervals(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        [0.01, -5, 0.02],
        [0, 1, 0],
      ),
    ).toHaveLength(1);
  });
});
