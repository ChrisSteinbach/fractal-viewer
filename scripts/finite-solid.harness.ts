/**
 * The finite-solid oracle's cross-pin: the production module
 * (`src/fractal/finite-solid.ts`) against the two qualified references the
 * owner-selected appearance came from —
 *
 * 1. `scripts/transmission-proxy.ts`'s explicit cell union (the box list
 *    and the exact ray intervals, 3D — the proxy's 4D arm is the
 *    tesseract-dust variant, a different construction, not the subject), and
 * 2. `scripts/transmission-dielectric-solid.ts`'s exact DDA boundary
 *    query (the qualified fixture: same ternary grid, same anchor
 *    contract, same corner convention, both dimensions).
 *
 * Agreement is exact — bit-identical t values, interval endpoints within
 * 1e-12 — wherever the two sides are the same grid, because both evaluate
 * the same centred rational plane form and the same integer occupancy
 * rule. Any drift here is a production bug, not a tolerance question.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/finite-solid.harness.ts
 */
import { mengerSponge } from "../src/fractal/presets";
import {
  FINITE_SOLID_IDENTITY_POSE,
  analyzeFiniteSolidSystem,
  buildFiniteSolidConstruction,
  finiteSolidBoundaryNormal,
  finiteSolidCells,
  finiteSolidIntervals,
  finiteSolidNextBoundary,
  finiteSolidNextBoundaryFromAnchor,
  finiteSolidRaySideOccupancy,
  hyperMengerSpongeTransforms,
  type FiniteSolidAnchor,
  type FiniteSolidConstruction,
  type FiniteSolidPose,
} from "../src/fractal/finite-solid";
import type { Vec3, Vec4 } from "../src/fractal/types";
import { finiteOpticalSolid } from "./transmission-proxy";
import {
  DIELECTRIC_CORNER_CONTROL_CASES,
  DIELECTRIC_GEOMETRY_CONTROL_RAYS,
  DIELECTRIC_HYPER_ROTOR_ROWS,
  DIELECTRIC_SOLID_FIXTURES,
  dielectricCellOccupied,
  dielectricNextBoundary,
  dielectricNextBoundaryFromAnchor,
  dielectricRaySideOccupancy,
  type DielectricBoundaryAnchor,
  type DielectricSolidFixture,
} from "./transmission-dielectric-solid";

const noSymmetry = { order: 1, plane: "xz" as const };

function constructionFor(dimension: 3 | 4, level = 2): FiniteSolidConstruction {
  return buildFiniteSolidConstruction(
    dimension === 3 ? "menger" : "hyperMenger",
    dimension,
    level,
  );
}

function poseFor(dimension: 3 | 4): FiniteSolidPose {
  if (dimension === 3) return FINITE_SOLID_IDENTITY_POSE;
  // The fixture's FROZEN f32 rows — the qualified pose contract, verbatim;
  // re-deriving them from f64 rotation arithmetic drifts by ULPs.
  return {
    rows: DIELECTRIC_HYPER_ROTOR_ROWS.map((row) => [...row]) as [
      Vec4,
      Vec4,
      Vec4,
      Vec4,
    ],
    slice: DIELECTRIC_SOLID_FIXTURES.hyperMengerD2.slice,
  };
}

// ---------------------------------------------------------------------------
// 1. Same grid.
// ---------------------------------------------------------------------------

describe("the construction's grid is the qualified fixture's", () => {
  for (const dimension of [3, 4] as const) {
    it(`agrees exhaustively with dielectricCellOccupied at level 2, ${dimension}D`, () => {
      const construction = constructionFor(dimension);
      const fixture = fixtureFor(dimension);
      const g = construction.gridSize;
      const index = new Array<number>(dimension).fill(0);
      const walk = (axis: number, linear: number): void => {
        if (axis === dimension) {
          const bitmap =
            (construction.occupancy[linear >>> 5] & (1 << (linear & 31))) !== 0;
          expect(bitmap).toBe(dielectricCellOccupied(fixture, [...index, -1]));
          return;
        }
        for (let i = 0; i < g; i++) {
          index[axis] = i;
          walk(axis + 1, linear * g + i);
        }
      };
      walk(0, 0);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. The interval union matches the proxy's box arithmetic (3D).
// ---------------------------------------------------------------------------

describe("the interval union matches the proxy's box union (3D)", () => {
  const construction = constructionFor(3);
  const proxy = finiteOpticalSolid(3, 2);

  it("reproduces the proxy's cell union", () => {
    const mine = finiteSolidCells(construction);
    expect(mine).toHaveLength(proxy.boxes.length);
    const byCenter = (a: number[], b: number[]): number => {
      for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
      }
      return 0;
    };
    const proxyBoxes = proxy.boxes
      .map((b) => b.center.slice(0, 3))
      .sort(byCenter);
    const myBoxes = mine.map((b) => b.center.slice()).sort(byCenter);
    for (let i = 0; i < proxyBoxes.length; i++) {
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(myBoxes[i][axis] - proxyBoxes[i][axis])).toBeLessThan(
          1e-12,
        );
      }
    }
  });

  it("reproduces the proxy's ray-union coverage on probe rays", () => {
    // Compared by COVERAGE with an ulp-scale merge: the proxy's box list
    // is built from its own recursion's rounded centers, so at exact
    // shared planes its per-box intervals split into ulp-adjacent pieces
    // that the production plane-derived union merges — the no-epsilon
    // rule applied to a 1-ulp artifact, not a real gap. Coverage (the
    // union of each list under a 1e-9 merge) must agree exactly; the
    // plane-exact events themselves are pinned bit-for-bit by the DDA
    // sweeps below, which is the qualified reference for this module.
    const probes: Array<{ origin: Vec3; dir: Vec3 }> = [
      { origin: [2, 0, 0.6], dir: [-1, 0.04, 0.02] },
      { origin: [2, 0.3, 0], dir: [-1, 0, 0] },
      { origin: [2, 0.61, 0.59], dir: [-1, 0.05, 0.03] },
      { origin: [0.2, 0.2, 2], dir: [0, 0, -1] },
      { origin: [1.4, 1.4, 1.4], dir: [-1, -1, -1] },
      { origin: [0.1, 0.35, 2], dir: [0.02, -0.03, -1] },
    ];
    for (const probe of probes) {
      const mine = finiteSolidIntervals(
        construction,
        FINITE_SOLID_IDENTITY_POSE,
        probe.origin,
        probe.dir,
      );
      const proxyIntervals = mergeTolerant(
        proxy.intervals(probe.origin, probe.dir),
      );
      const myMerged = mergeTolerant(mine);
      expect(myMerged).toHaveLength(proxyIntervals.length);
      for (let i = 0; i < myMerged.length; i++) {
        expect(
          Math.abs(myMerged[i].enter - proxyIntervals[i].enter),
        ).toBeLessThan(1e-12);
        expect(
          Math.abs(myMerged[i].exit - proxyIntervals[i].exit),
        ).toBeLessThan(1e-12);
      }
    }
  });
});

/** Merge intervals whose gap is at the ulp scale of the grid — the
 * comparison-side absorption of the proxy's box-center rounding, never a
 * production behavior (the production union uses exact plane endpoints). */
function mergeTolerant(
  intervals: Array<{ enter: number; exit: number }>,
): Array<{ enter: number; exit: number }> {
  const merged: Array<{ enter: number; exit: number }> = [];
  for (const interval of [...intervals].sort((a, b) => a.enter - b.enter)) {
    const last = merged[merged.length - 1];
    if (last && interval.enter <= last.exit + 1e-9) {
      last.exit = Math.max(last.exit, interval.exit);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// 4. The corner convention against the fixture's recorded controls.
// ---------------------------------------------------------------------------

const FIXTURE_GEOMETRY: Record<string, [3 | 4, number]> = {
  mengerD0: [3, 0],
  mengerD2: [3, 2],
  hyperMengerD2: [4, 2],
};

function fixtureGeometry(fixtureKey: string): [3 | 4, number] {
  const geometry = FIXTURE_GEOMETRY[fixtureKey];
  if (!geometry) throw new Error(`unknown fixture key ${fixtureKey}`);
  return geometry;
}

function fixtureFor(dimension: 3 | 4, level = 2): DielectricSolidFixture {
  if (dimension === 3 && level === 0) {
    return DIELECTRIC_SOLID_FIXTURES.mengerD0;
  }
  if (dimension === 3) return DIELECTRIC_SOLID_FIXTURES.mengerD2;
  return DIELECTRIC_SOLID_FIXTURES.hyperMengerD2;
}

function normalize3(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
}

function compareBoundary(
  mine: ReturnType<typeof finiteSolidNextBoundary>,
  theirs: ReturnType<typeof dielectricNextBoundary>,
): void {
  expect(mine.kind).toBe(theirs.kind);
  if (mine.kind === "refused" && theirs.kind === "refused") {
    expect(mine.reason).toBe(theirs.reason);
    return;
  }
  if (mine.kind !== "boundary" || theirs.kind !== "boundary") return;
  expect(mine.t).toBe(theirs.t);
  expect(mine.entering).toBe(theirs.entering);
  for (let axis = 0; axis < 3; axis++) {
    expect(
      Math.abs(mine.outwardNormal[axis] - theirs.outwardNormal[axis]),
    ).toBeLessThan(1e-12);
  }
  expect(mine.anchor.planeMask).toBe(theirs.anchor.planeMask);
  for (let axis = 0; axis < 4; axis++) {
    expect(mine.anchor.planeIndices[axis]).toBe(
      theirs.anchor.planeIndices[axis],
    );
    expect(mine.anchor.cellIndices[axis]).toBe(theirs.anchor.cellIndices[axis]);
  }
  for (let axis = 0; axis < 4; axis++) {
    expect(
      Math.abs(
        mine.anchor.intrinsicPoint[axis] - theirs.anchor.intrinsicPoint[axis],
      ),
    ).toBeLessThan(1e-12);
  }
}

describe("the DDA replays the fixture's control rays exactly", () => {
  for (const control of DIELECTRIC_GEOMETRY_CONTROL_RAYS) {
    const [dimension, level] = fixtureGeometry(control.fixture);
    it(`replays ${control.name}`, () => {
      const construction = constructionFor(dimension, level);
      const pose = poseFor(dimension);
      const fixture = fixtureFor(dimension, level);
      const mine = finiteSolidNextBoundary(
        construction,
        pose,
        control.origin,
        control.direction,
        { inside: control.inside },
      );
      const theirs = dielectricNextBoundary(
        fixture,
        control.origin,
        control.direction,
        { inside: control.inside },
      );
      compareBoundary(mine, theirs);
    });
  }
});

/**
 * Chained continuation: enter from outside, then walk event-to-event
 * through the interior with the anchor each side produced, exactly as the
 * transport's work list does. Both implementations must agree on every
 * event's kind, t (exactly), entering, normal, plane mask, plane and cell
 * indices — the anchor contract's own comparison.
 */
describe("the DDA matches the fixture event-for-event through the interior", () => {
  for (const dimension of [3, 4] as const) {
    it(`sweeps 24 entry rays through 32 events, ${dimension}D`, () => {
      const construction = constructionFor(dimension);
      const pose = poseFor(dimension);
      const fixture = fixtureFor(dimension);
      for (let probe = 0; probe < 24; probe++) {
        const angle = (probe / 24) * 2 * Math.PI;
        const origin: Vec3 = [
          1.6 * Math.cos(angle),
          0.31 * Math.sin(2 * angle),
          0.9 * Math.sin(angle) + 0.2,
        ];
        const dir: Vec3 = normalize3([-1.1, 0.17, 0.5 - 0.4 * Math.sin(angle)]);
        let inside = false;
        let anchor: FiniteSolidAnchor | undefined;
        let theirsAnchor: DielectricBoundaryAnchor | undefined;
        for (let step = 0; step < 32; step++) {
          const mine: ReturnType<typeof finiteSolidNextBoundary> = anchor
            ? finiteSolidNextBoundaryFromAnchor(construction, pose, dir, {
                inside,
                anchor,
              })
            : finiteSolidNextBoundary(construction, pose, origin, dir, {
                inside,
              });
          const theirs = theirsAnchor
            ? dielectricNextBoundaryFromAnchor(fixture, dir, {
                inside,
                anchor: theirsAnchor,
              })
            : dielectricNextBoundary(fixture, origin, dir, { inside });
          compareBoundary(mine, theirs);
          if (mine.kind !== "boundary") break;
          if (theirs.kind !== "boundary") break;
          inside = mine.entering;
          anchor = mine.anchor;
          theirsAnchor = theirs.anchor;
        }
      }
    });

    it("classifies ray-side probe points identically with the fixture", () => {
      const construction = constructionFor(dimension);
      const pose = poseFor(dimension);
      const fixture = fixtureFor(dimension);
      const dir: Vec3 = [0.31, -0.44, 0.84];
      for (let probe = 0; probe < 64; probe++) {
        const x = -0.9 + (probe % 8) * 0.26;
        const y = -0.9 + Math.floor(probe / 8) * 0.26;
        const point: Vec3 = [x, y, 0.11];
        expect(
          finiteSolidRaySideOccupancy(construction, pose, point, dir),
        ).toBe(dielectricRaySideOccupancy(fixture, point, dir));
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 4. The corner convention against the fixture's recorded controls.
// ---------------------------------------------------------------------------

describe("the corner convention matches the fixture's recorded controls", () => {
  for (const control of DIELECTRIC_CORNER_CONTROL_CASES) {
    it(`reproduces ${control.name}'s expected normal`, () => {
      const dimension = control.fixtureKey === "mengerD2" ? 3 : 4;
      const pose = poseFor(dimension);
      const mine = finiteSolidBoundaryNormal(
        pose,
        dimension,
        control.incident,
        control.anchor.planeMask,
        control.entering,
      );
      expect(mine).not.toBeNull();
      for (let axis = 0; axis < 3; axis++) {
        expect(
          Math.abs(mine![axis] - control.expectedNormal[axis]),
        ).toBeLessThan(1e-12);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 5. The admission, and 6. membership agreement.
// ---------------------------------------------------------------------------

describe("the admission and membership", () => {
  it("admits the shipped map sets and refuses edits", () => {
    expect(
      analyzeFiniteSolidSystem(mengerSponge(), null, noSymmetry, "menger", 2)
        .status,
    ).toBe("eligible");
    expect(
      analyzeFiniteSolidSystem(
        hyperMengerSpongeTransforms(),
        null,
        noSymmetry,
        "hyperMenger",
        2,
      ).status,
    ).toBe("eligible");
    const maps = mengerSponge();
    const nudged = maps.map((t, i) =>
      i === 0
        ? {
            ...t,
            position: [
              t.position[0] + 0.01,
              t.position[1],
              t.position[2],
            ] as Vec3,
          }
        : t,
    );
    expect(
      analyzeFiniteSolidSystem(nudged, null, noSymmetry, "menger", 2).status,
    ).toBe("ineligible");
    expect(
      analyzeFiniteSolidSystem(maps.slice(0, 19), null, noSymmetry, "menger", 2)
        .status,
    ).toBe("ineligible");
  });

  it("agrees with the fixture's closed membership on probe points", () => {
    for (const dimension of [3, 4] as const) {
      const construction = constructionFor(dimension);
      const pose = poseFor(dimension);
      const fixture = fixtureFor(dimension);
      for (let probe = 0; probe < 64; probe++) {
        const x = -0.85 + (probe % 8) * 0.24;
        const y = -0.85 + Math.floor(probe / 8) * 0.24;
        const point: Vec3 = [x, y, 0.11];
        // The fixture's contains() is not exported; ray-side occupancy at
        // three directions is the observable both share.
        for (const dir of [
          [0.31, -0.44, 0.84],
          [-0.6, 0.2, 0.77],
          [1, 0, 0],
        ] as const) {
          expect(
            finiteSolidRaySideOccupancy(construction, pose, point, dir as Vec3),
          ).toBe(dielectricRaySideOccupancy(fixture, point, dir as Vec3));
        }
      }
    }
  });
});
