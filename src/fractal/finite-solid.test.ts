import {
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
} from "./finite-solid";
import { mengerSponge, sierpinskiTetrahedron } from "./presets";
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
      value: { shape: "menger", level: 2 },
    });
    expect(resolveFiniteSolid({ shape: "hyperMenger", level: 0 })).toEqual({
      ok: true,
      value: { shape: "hyperMenger", level: 0 },
    });
    // Missing fields, out-of-band levels, and unknown keys all refuse with
    // reasons — a refusal is the block's persisted state, never a clamp.
    for (const block of [
      {},
      { shape: "menger" },
      { level: 2 },
      { shape: "sponge", level: 2 },
      { shape: "menger", level: 3 },
      { shape: "menger", level: -1 },
      { shape: "menger", level: 1.5 },
      { shape: "menger", level: 2, warp: true },
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
// The general construction: the document's OWN maps as the cell tree.
// ---------------------------------------------------------------------------

describe("finite-solid general construction", () => {
  // The owner's own witness: the shipped Sierpinski tetrahedron document.
  // Four diagonal 1/2 contractions; every face position is dyadic, so the
  // expected intervals and ties are hand-exact.
  const maps = sierpinskiTetrahedron();
  const analyze = (level: number, ms: Transform[] = maps) =>
    analyzeFiniteSolidGeneral(ms, null, noSymmetry, level, 3);

  it("admits the Sierpinski document and derives its root from the maps' fixed points", () => {
    const result = analyze(1);
    expect(result.status).toBe("eligible");
    expect(result.construction?.mapCount).toBe(4);
    // The fixed points are 2·p: the root box spans them exactly.
    const c = result.construction;
    expect(c?.rootMin[0]).toBeCloseTo(-0.75, 12);
    expect(c?.rootMax[0]).toBeCloseTo(1.5, 12);
    expect(c?.rootMin[1]).toBeCloseTo(-0.8, 12);
    expect(c?.rootMax[1]).toBeCloseTo(1.6, 12);
    expect(c?.rootMin[2]).toBeCloseTo(-1.3, 12);
    expect(c?.rootMax[2]).toBeCloseTo(1.3, 12);
  });

  it("refuses variations, rotations, non-contracting maps, and out-of-band levels with reasons", () => {
    // The owner's mandelbox test: a non-linear variation refuses.
    const withVariation = maps.map((t, i) =>
      i === 0
        ? {
            ...t,
            variations: [{ type: "mandelbox" as const, weight: 0.2 }],
          }
        : t,
    );
    const variationResult = analyze(1, withVariation);
    expect(variationResult.status).toBe("ineligible");
    expect(variationResult.reasons.join("; ")).toMatch(/variations/);

    // A rotated map composes an oriented cell frame — refused until the
    // oriented-frame lift.
    const withRotation = maps.map((t, i) =>
      i === 0 ? { ...t, rotation: [0.1, 0, 0] as Vec3 } : t,
    );
    const rotationResult = analyze(1, withRotation);
    expect(rotationResult.status).toBe("ineligible");
    expect(rotationResult.reasons.join("; ")).toMatch(/rotates or shears/);

    // A map that grows instead of shrinking has no glass solid.
    const withGrowth = maps.map((t, i) =>
      i === 0 ? { ...t, scale: [1.2, 0.5, 0.5] as Vec3 } : t,
    );
    const growthResult = analyze(1, withGrowth);
    expect(growthResult.status).toBe("ineligible");
    expect(growthResult.reasons.join("; ")).toMatch(/does not contract/);

    expect(analyze(3).status).toBe("ineligible");
    expect(analyze(-1).status).toBe("ineligible");
  });

  it("unions the level-1 boxes with shared faces merged and genuine gaps kept", () => {
    const c = analyze(1).construction;
    if (!c) throw new Error("construction missing");
    // Down the spine through the apex box and the +x base box: they touch
    // at y = 0.4 (dyadic-exact through both words), so ONE interval.
    const spine = finiteSolidGeneralIntervals(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      [0.5, -2, 0],
      [0, 1, 0],
    );
    expect(spine).toHaveLength(1);
    expect(spine[0].enter).toBeCloseTo(1.2, 12);
    expect(spine[0].exit).toBeCloseTo(3.6, 12);
    // Off the apex box's x range only the +x base box is crossed; the ray
    // exits into air at y = 0.4 and never re-enters.
    const offApex = finiteSolidGeneralIntervals(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      [0.9, -2, 0],
      [0, 1, 0],
    );
    expect(offApex).toHaveLength(1);
    expect(offApex[0].enter).toBeCloseTo(1.2, 12);
    expect(offApex[0].exit).toBeCloseTo(2.4, 12);
    // A ray missing everything returns no intervals.
    expect(
      finiteSolidGeneralIntervals(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        [5, -2, 0],
        [0, 1, 0],
      ),
    ).toHaveLength(0);
  });

  it("walks the boundary query through a shared face silently and fires honest exits", () => {
    const c = analyze(1).construction;
    if (!c) throw new Error("construction missing");
    const pose = FINITE_SOLID_IDENTITY_POSE;
    // Primary entry into the +x base box.
    const entry = finiteSolidGeneralNextBoundary(
      c,
      pose,
      [0.5, -2, 0],
      [0, 1, 0],
      { inside: false },
    );
    expect(entry.kind).toBe("boundary");
    if (entry.kind !== "boundary") return;
    expect(entry.entering).toBe(true);
    expect(entry.t).toBeCloseTo(1.2, 12);
    expect(entry.outwardNormal[1]).toBeCloseTo(-1, 12);
    // The anchored continuation from the canonical entry: the shared face
    // at y = 0.4 is INTERIOR — the next event is the exit at y = 1.6,
    // t = 2.4 from the anchor, not the shared face.
    const through = finiteSolidGeneralNextBoundaryFromAnchor(
      c,
      pose,
      [0, 1, 0],
      { inside: true, anchor: entry.anchor },
    );
    expect(through.kind).toBe("boundary");
    if (through.kind !== "boundary") return;
    expect(through.entering).toBe(false);
    expect(through.t).toBeCloseTo(2.4, 12);
    expect(through.outwardNormal[1]).toBeCloseTo(1, 12);
    // The exit's anchor restarts from the canonical boundary in the open:
    // the coverage sweep reads the open side ahead and finds no further
    // boundary along this ray.
    const after = finiteSolidGeneralNextBoundaryFromAnchor(c, pose, [0, 1, 0], {
      inside: false,
      anchor: through.anchor,
    });
    expect(after.kind).toBe("miss");
    // A fresh unanchored query from the exit point finds no further
    // boundary along the ray.
    const fresh = finiteSolidGeneralNextBoundary(
      c,
      pose,
      [0.5, 1.6, 0],
      [0, 1, 0],
      {
        inside: false,
      },
    );
    expect(fresh.kind).toBe("miss");
  });

  it("keeps the display hybrid a certified bound against the exact interval union", () => {
    const c = analyze(2).construction;
    if (!c) throw new Error("construction missing");
    const pose = FINITE_SOLID_IDENTITY_POSE;
    const march = (origin: Vec3, rawDir: Vec3): number | null => {
      // The shipped display march's discipline: step the hybrid estimate
      // (already SAFETY-scaled) with a one-sided hit test.
      const len = Math.hypot(rawDir[0], rawDir[1], rawDir[2]);
      const dir: Vec3 = [rawDir[0] / len, rawDir[1] / len, rawDir[2] / len];
      let t = 0;
      for (let i = 0; i < 4096; i++) {
        const d = finiteSolidGeneralDisplayDistance(c, pose, [
          origin[0] + dir[0] * t,
          origin[1] + dir[1] * t,
          origin[2] + dir[2] * t,
        ]);
        if (d < 1e-5) return t;
        t += d * 0.9;
        if (t > 12) return null;
      }
      return null;
    };
    for (const [origin, dir] of [
      [
        [0.5, -2, 0],
        [0, 1, 0],
      ] as [Vec3, Vec3],
      [
        [-2, -0.5, 0],
        [1, 0, 0],
      ] as [Vec3, Vec3],
      [
        [0.3, -2, 0.4],
        [0.05, 1, 0.1],
      ] as [Vec3, Vec3],
    ]) {
      const hit = march(origin, dir);
      const exact = finiteSolidGeneralIntervals(c, pose, origin, dir);
      if (exact.length === 0) {
        expect(hit).toBeNull();
        continue;
      }
      expect(hit).not.toBeNull();
      if (hit === null) continue;
      // The marched hit must land within the union's first interval at
      // the march's own acceptance scale (the estimate never overshoots
      // the surface; it stops within its 1e-5 hit band).
      expect(hit).toBeGreaterThanOrEqual(exact[0].enter - 2e-5);
      expect(hit).toBeLessThanOrEqual(exact[0].exit + 2e-5);
    }
  });

  it("agrees with the shipped grid construction on the shipped Menger maps", () => {
    // The word tree with the grid's own maps must reproduce the grid's
    // cell structure: the two constructions' unions agree on sampled rays
    // (endpoint arithmetic differs only in the last ulp of the composed
    // matrices against the canonical grid planes).
    const shipped = analyzeFiniteSolidSystem(
      mengerSponge(),
      null,
      noSymmetry,
      "menger",
      2,
    );
    const general = analyzeFiniteSolidGeneral(
      mengerSponge(),
      null,
      noSymmetry,
      2,
      3,
    );
    expect(shipped.status).toBe("eligible");
    expect(general.status).toBe("eligible");
    if (!shipped.construction || !general.construction) {
      throw new Error("constructions missing");
    }
    const rays: Array<[Vec3, Vec3]> = [
      [
        [0.1, -2, 0.05],
        [0, 1, 0],
      ],
      [
        [-2, 0.2, -0.3],
        [1, 0.1, 0.05],
      ],
      [
        [0.4, 0.4, -2],
        [0, 0, 1],
      ],
      [
        [-2, -1, -1],
        [1, 1, 1],
      ],
      [
        [0.9, -2, 0.4],
        [0.02, 1, 0.03],
      ],
    ];
    for (const [origin, dir] of rays) {
      const grid = finiteSolidIntervals(
        shipped.construction,
        FINITE_SOLID_IDENTITY_POSE,
        origin,
        dir,
      );
      const tree = finiteSolidGeneralIntervals(
        general.construction,
        FINITE_SOLID_IDENTITY_POSE,
        origin,
        dir,
      );
      expect(tree.length).toBe(grid.length);
      for (let i = 0; i < Math.min(grid.length, tree.length); i++) {
        expect(Math.abs(tree[i].enter - grid[i].enter)).toBeLessThan(1e-9);
        expect(Math.abs(tree[i].exit - grid[i].exit)).toBeLessThan(1e-9);
      }
    }
  });
});

describe("finite-solid general construction, 4D", () => {
  it("agrees with the shipped grid construction on the hyper-Menger maps", () => {
    // The word tree one dimension up: the shipped 48-map construction's
    // maps through the general admission must reproduce the grid's union
    // on the identity pose (the slice discipline is the pose's, verbatim).
    const shipped = analyzeFiniteSolidSystem(
      hyperMengerSpongeTransforms(),
      null,
      noSymmetry,
      "hyperMenger",
      1,
    );
    const general = analyzeFiniteSolidGeneral(
      hyperMengerSpongeTransforms(),
      null,
      noSymmetry,
      1,
      4,
    );
    expect(shipped.status).toBe("eligible");
    expect(general.status).toBe("eligible");
    if (!shipped.construction || !general.construction) {
      throw new Error("constructions missing");
    }
    expect(general.construction.mapCount).toBe(48);
    const rays: Array<[Vec3, Vec3]> = [
      [
        [0.1, -2, 0.05],
        [0, 1, 0],
      ],
      [
        [-2, 0.2, -0.3],
        [1, 0.1, 0.05],
      ],
      [
        [0.4, 0.4, -2],
        [0, 0, 1],
      ],
      [
        [0.9, -2, 0.4],
        [0.02, 1, 0.03],
      ],
    ];
    for (const [origin, dir] of rays) {
      const grid = finiteSolidIntervals(
        shipped.construction,
        FINITE_SOLID_IDENTITY_POSE,
        origin,
        dir,
      );
      const tree = finiteSolidGeneralIntervals(
        general.construction,
        FINITE_SOLID_IDENTITY_POSE,
        origin,
        dir,
      );
      expect(tree.length).toBe(grid.length);
      for (let i = 0; i < Math.min(grid.length, tree.length); i++) {
        expect(Math.abs(tree[i].enter - grid[i].enter)).toBeLessThan(1e-9);
        expect(Math.abs(tree[i].exit - grid[i].exit)).toBeLessThan(1e-9);
      }
    }
  });
});
