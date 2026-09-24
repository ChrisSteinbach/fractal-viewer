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
 * The final sections re-derive the same pattern for the GENERAL word tree
 * (the document's OWN maps as the SIMPLICIAL cell tree,
 * `analyzeFiniteSolidGeneral`): its reference is an independent simplex
 * union built here by a DIFFERENT association and a DIFFERENT clip — each
 * leaf's vertices by the outer-inward point fold, each leaf clipped by
 * barycentric coordinates — so agreement pins the construction, not one
 * rounding of it; the declared resolution (`FINITE_SOLID_GENERAL_TIE_REL`)
 * is part of the construction's contract and the reference groups with it
 * too. Legs cover every root kind (the Sierpinski hull, the default
 * system's and the rotated pentatope's derived roots) across the band 0..4
 * in both dimensions under the identity pose (3D) and the fixture's frozen
 * rotor rows (4D), event-chained anchor sweeps that must reconstruct the
 * union event for event, hand controls (the gasket's axis at every level,
 * its vertex tie, a genuine gap, the state-mismatch refusal), the leaf
 * cap's measured per-document worst case, and a 12-map document whose
 * level-2 rays exceed the device's enumeration cap — the f64 reference is
 * uncapped by decision, and that leg keeps it honest.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/finite-solid.harness.ts
 */
import {
  defaultTransforms,
  mengerSponge,
  pentatope,
  sierpinskiTetrahedron,
} from "../src/fractal/presets";
import {
  FINITE_SOLID_GENERAL_TIE_REL,
  FINITE_SOLID_IDENTITY_POSE,
  analyzeFiniteSolidGeneral,
  analyzeFiniteSolidSystem,
  buildFiniteSolidConstruction,
  finiteSolidBoundaryNormal,
  finiteSolidCells,
  finiteSolidGeneralIntervals,
  finiteSolidGeneralNextBoundary,
  finiteSolidGeneralNextBoundaryFromAnchor,
  finiteSolidIntrinsicDirection,
  finiteSolidIntrinsicPoint,
  finiteSolidIntervals,
  finiteSolidNextBoundary,
  finiteSolidNextBoundaryFromAnchor,
  finiteSolidRaySideOccupancy,
  hyperMengerSpongeTransforms,
  type FiniteSolidAnchor,
  type FiniteSolidConstruction,
  type FiniteSolidGeneralConstruction,
  type FiniteSolidPose,
} from "../src/fractal/finite-solid";
import { FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES } from "../src/fractal/surface-finite-solid-gpu";
import type { Transform, Vec3, Vec4 } from "../src/fractal/types";
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

// ---------------------------------------------------------------------------
// 7. The general word tree: the document's OWN maps as the SIMPLICIAL cell
// tree.
//
// The grid legs above pin the shipped constructions against their two
// qualified references. The general word tree's reference is the
// independent SIMPLEX union below, sharing neither the production's
// association nor its clip: each leaf's vertices come from the OUTER-INWARD
// POINT fold (every root vertex pushed through the word's maps innermost
// first, `M_w1(M_w2(…M_wN(v)))`), where the production composes the word's
// matrices prefix-first and applies the product once; and each leaf clips
// by BARYCENTRIC coordinates (affine in t along the ray, solved against the
// leaf's own edge matrix), where the production clips facet half-spaces
// built from cross products. Same reals, different arithmetic, so agreement
// pins the construction rather than one rounding of it. The declared
// resolution `FINITE_SOLID_GENERAL_TIE_REL` is the construction's CONTRACT
// (a gap below it is unrepresentable on the f32 wire the transport rides),
// so the reference groups with it too; disagreement in the interval
// structure beyond it is a production bug, never a tolerance question.
//
// The leaf cap's size is MEASURED here, not assumed: the reference's
// clipped-leaf count IS the pruned walk's (the level-box prune only drops
// subtrees none of whose leaves the ray clips), and the sizing leg records
// the per-document maximum against FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES.
// ---------------------------------------------------------------------------

const REFERENCE_AGREEMENT = 1e-12;
/** Chained-anchor hops restart from the snapped anchor, whose f64 snap
 * moves the point by rounding alone (~1e-15 per hop); no sweep walks more
 * than 64 hops, so 1e-9 bounds every honest reconstruction many orders
 * below the construction's smallest real feature. */
const CHAIN_RECONSTRUCTION = 1e-9;

/** The word-tree construction from a document's maps, through the
 * admission the app itself takes (an ineligibility here is the test's
 * bug, and says so with the analyzer's reasons). */
function generalConstructionFor(
  maps: readonly Transform[],
  level: number,
  dimension: 3 | 4,
): FiniteSolidGeneralConstruction {
  const analysis = analyzeFiniteSolidGeneral(
    maps,
    null,
    noSymmetry,
    level,
    dimension,
  );
  if (analysis.status !== "eligible" || !analysis.construction) {
    throw new Error(
      `the general admission refused the harness document: ${analysis.reasons.join("; ")}`,
    );
  }
  return analysis.construction;
}

/** Three of five pentatope maps turned, one through xw: no invariant
 * simplex exists, so the derived root rides the level boxes — the 4D half
 * of the default system's witness. */
function rotatedPentatope(): Transform[] {
  const maps = pentatope();
  maps[1].rotation = [0, Math.PI / 4, 0];
  maps[2].w = { ...maps[2].w, rotation: { xw: Math.PI / 5 } };
  maps[3].rotation = [Math.PI / 4, 0, 0];
  return maps;
}

/** One leaf's vertices by the outer-inward point fold. */
function referenceLeafVertices(
  c: FiniteSolidGeneralConstruction,
  word: readonly number[],
): Vec4[] {
  return c.rootVertices.map((root) => {
    let p: Vec4 = [...root];
    for (let depth = word.length - 1; depth >= 0; depth--) {
      const m = c.mapMatrix[word[depth]];
      const t = c.mapOffset[word[depth]];
      p = [0, 1, 2, 3].map(
        (r) =>
          t[r] +
          (m[r * 4] * p[0] +
            m[r * 4 + 1] * p[1] +
            m[r * 4 + 2] * p[2] +
            m[r * 4 + 3] * p[3]),
      ) as Vec4;
    }
    return p;
  });
}

/** Solve the n×n system by Cramer-free Gauss-Jordan with partial pivoting
 * (the harness's own, independent of the production's solvers). */
function solveSquare(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-300) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = m[row][col] / m[col][col];
      for (let k = col; k <= n; k++) m[row][k] -= f * m[col][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** The ray against one simplex by barycentric coordinates: with the edge
 * matrix E = [v1 − v0, …, vd − v0], the coordinates of q + t·qd are
 * `E⁻¹(q − v0) + t·E⁻¹qd` (and λ0 = 1 − Σ), each affine in t; the clipped
 * interval is where every λ ≥ 0. */
function referenceSimplexClip(
  vertices: readonly Vec4[],
  dimension: 3 | 4,
  q: Vec4,
  qd: Vec4,
): { enter: number; exit: number } | null {
  const edges: number[][] = [];
  for (let r = 0; r < dimension; r++) {
    edges.push(
      Array.from(
        { length: dimension },
        (_, k) => vertices[k + 1][r] - vertices[0][r],
      ),
    );
  }
  const base = solveSquare(
    edges,
    Array.from({ length: dimension }, (_, r) => q[r] - vertices[0][r]),
  );
  const slope = solveSquare(
    edges,
    Array.from({ length: dimension }, (_, r) => qd[r]),
  );
  if (!base || !slope) return null;
  // λ_k(t) = base_k + t·slope_k for k ≥ 1; λ_0 = 1 − Σ.
  const lines: Array<[number, number]> = base.map((b, k) => [b, slope[k]]);
  lines.push([
    1 - base.reduce((x, y) => x + y, 0),
    -slope.reduce((x, y) => x + y, 0),
  ]);
  let enter = -Infinity;
  let exit = Infinity;
  for (const [b, s] of lines) {
    if (s === 0) {
      if (b < 0) return null;
      continue;
    }
    const t = -b / s;
    if (s > 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
  }
  return exit > enter ? { enter, exit } : null;
}

/** The independent interval union (and the clipped-leaf count): every
 * level-N word's leaf clipped and swept with the declared-resolution tie —
 * the grouping rule the contract states, restated here because it is
 * semantics, not implementation. */
function referenceGeneralUnion(
  c: FiniteSolidGeneralConstruction,
  q: Vec4,
  qd: Vec4,
): { union: Array<{ enter: number; exit: number }>; clipped: number } {
  const endpoints: Array<{ t: number; delta: number }> = [];
  const counter = new Array<number>(c.level).fill(0);
  let clipped = 0;
  for (;;) {
    const clip = referenceSimplexClip(
      referenceLeafVertices(c, counter),
      c.dimension,
      q,
      qd,
    );
    if (clip) {
      clipped++;
      endpoints.push({ t: clip.enter, delta: 1 });
      endpoints.push({ t: clip.exit, delta: -1 });
    }
    let digit = c.level - 1;
    for (; digit >= 0; digit--) {
      if (++counter[digit] < c.mapCount) break;
      counter[digit] = 0;
    }
    if (digit < 0) break;
  }
  endpoints.sort((a, b) => a.t - b.t);
  const union: Array<{ enter: number; exit: number }> = [];
  let coverage = 0;
  let openEnter = 0;
  let i = 0;
  while (i < endpoints.length) {
    const groupT = endpoints[i].t;
    const tie = FINITE_SOLID_GENERAL_TIE_REL * Math.max(1, Math.abs(groupT));
    let net = 0;
    while (i < endpoints.length && endpoints[i].t - groupT <= tie) {
      net += endpoints[i].delta;
      i++;
    }
    const before = coverage;
    coverage += net;
    if (before === 0 && coverage > 0) openEnter = groupT;
    if (before > 0 && coverage === 0)
      union.push({ enter: openEnter, exit: groupT });
  }
  return { union, clipped };
}

/** The intrinsic ray the production itself derives (the same shared pose
 * helpers, so the reference pins the clip/union arithmetic, not the pose
 * conversion), then the independent union on it. */
function referenceUnionForRay(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  dir: Vec3,
): { union: Array<{ enter: number; exit: number }>; clipped: number } {
  return referenceGeneralUnion(
    c,
    finiteSolidIntrinsicPoint(pose, origin),
    finiteSolidIntrinsicDirection(pose, dir),
  );
}

function compareUnions(
  mine: Array<{ enter: number; exit: number }>,
  theirs: Array<{ enter: number; exit: number }>,
  within: number,
): void {
  expect(mine).toHaveLength(theirs.length);
  for (let i = 0; i < Math.min(mine.length, theirs.length); i++) {
    const scale = Math.max(1, Math.abs(theirs[i].enter));
    expect(Math.abs(mine[i].enter - theirs[i].enter)).toBeLessThan(
      within * scale,
    );
    expect(Math.abs(mine[i].exit - theirs[i].exit)).toBeLessThan(
      within * Math.max(1, Math.abs(theirs[i].exit)),
    );
  }
}

/** Deterministic probe rays around a construction: origins on a shell,
 * directions through offset targets inside the solid — a mix of hits,
 * gaps, grazes and misses no hand list could cover. */
function probeRaysAround(
  center: Vec3,
  radius: number,
  count: number,
  phase: number,
): Array<{ origin: Vec3; dir: Vec3 }> {
  const rays: Array<{ origin: Vec3; dir: Vec3 }> = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * 2 * Math.PI + phase * 0.017;
    const origin: Vec3 = [
      center[0] + radius * Math.cos(a),
      center[1] + radius * Math.sin(2 * a) * 0.6,
      center[2] + radius * Math.sin(a) * 0.8,
    ];
    const target: Vec3 = [
      center[0] + 0.31 * Math.sin(3 * a + phase),
      center[1] + 0.23 * Math.cos(2 * a),
      center[2] + 0.19 * Math.sin(a + phase),
    ];
    rays.push({
      origin,
      dir: normalize3([
        target[0] - origin[0],
        target[1] - origin[1],
        target[2] - origin[2],
      ]),
    });
  }
  return rays;
}

/** The transport's own resumption semantics, pinned: an event chain that
 * starts outside and walks anchor-to-anchor must reconstruct the interval
 * union event for event — enter/exit alternating, the first event's
 * parameter BIT-IDENTICAL to the union's endpoint (both walk the same
 * enumeration), the anchor-driven hops within the reconstruction bound,
 * and a miss to close. A refusal anywhere is a failure with its reason. */
function chainReconstructsUnion(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  dir: Vec3,
): void {
  const union = finiteSolidGeneralIntervals(c, pose, origin, dir).filter(
    (interval) => interval.exit > 0,
  );
  const events: Array<{ entering: boolean; at: number }> = [];
  let inside = false;
  let anchor: FiniteSolidAnchor | undefined;
  let accumulated = 0;
  for (let step = 0; step < 64; step++) {
    const result: ReturnType<typeof finiteSolidGeneralNextBoundary> = anchor
      ? finiteSolidGeneralNextBoundaryFromAnchor(c, pose, dir, {
          inside,
          anchor,
        })
      : finiteSolidGeneralNextBoundary(c, pose, origin, dir, { inside });
    if (result.kind === "refused") {
      throw new Error(
        `the event chain refused at step ${step}: ${result.reason} ` +
          `(event ${events.length}, accumulated ${accumulated})`,
      );
    }
    if (result.kind === "miss") break;
    accumulated += result.t;
    events.push({ entering: result.entering, at: accumulated });
    if (!anchor && result.entering) {
      expect(result.t).toBe(union[0]?.enter);
    }
    inside = result.entering;
    anchor = result.anchor;
  }
  expect(events).toHaveLength(union.length * 2);
  for (let i = 0; i < union.length; i++) {
    const enterEvent = events[2 * i];
    const exitEvent = events[2 * i + 1];
    expect(enterEvent.entering).toBe(true);
    expect(exitEvent.entering).toBe(false);
    expect(Math.abs(enterEvent.at - union[i].enter)).toBeLessThan(
      CHAIN_RECONSTRUCTION * Math.max(1, union[i].enter),
    );
    expect(Math.abs(exitEvent.at - union[i].exit)).toBeLessThan(
      CHAIN_RECONSTRUCTION * Math.max(1, union[i].exit),
    );
  }
}

/** Twelve heavily overlapping half-scale maps whose fixed points sit on a
 * small shell: a ray through the centre clips nearly every one of the 144
 * level-2 leaves, past the device's enumeration cap — the f64 reference is
 * uncapped by decision, and this document keeps that honest. */
function twelveOverlappingMaps(): Transform[] {
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
  return directions.map((d, id) => ({
    id,
    position: [d[0] * 0.05, d[1] * 0.05, d[2] * 0.05],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  }));
}

/** The sweep documents: every root kind, both dimensions, the band's ends. */
const GENERAL_SWEEPS: ReadonlyArray<{
  name: string;
  maps: () => Transform[];
  level: number;
  dimension: 3 | 4;
  center: Vec3;
  radius: number;
}> = [
  ...[0, 1, 2, 3, 4].map((level) => ({
    name: "Sierpinski (hull root)",
    maps: sierpinskiTetrahedron,
    level,
    dimension: 3 as const,
    center: [0, 0.4, 0] as Vec3,
    radius: 3,
  })),
  ...[1, 2, 3, 4].map((level) => ({
    name: "default system (derived root)",
    maps: defaultTransforms,
    level,
    dimension: 3 as const,
    center: [0, 0, 0] as Vec3,
    radius: 6,
  })),
  {
    name: "pentatope (hull root)",
    maps: pentatope,
    level: 3,
    dimension: 4,
    center: [0, 0, 0],
    radius: 3,
  },
  {
    name: "rotated pentatope (derived root)",
    maps: rotatedPentatope,
    level: 2,
    dimension: 4,
    center: [0, 0, 0],
    radius: 5,
  },
  {
    name: "hyper-Menger maps (derived root, 48 maps)",
    maps: hyperMengerSpongeTransforms,
    level: 1,
    dimension: 4,
    center: [0, 0, 0],
    radius: 6,
  },
];

describe("the general word tree agrees with the independent simplex union", () => {
  for (const sweep of GENERAL_SWEEPS) {
    it(`sweeps 24 probe rays: ${sweep.name}, level ${sweep.level}, ${sweep.dimension}D`, () => {
      const c = generalConstructionFor(
        sweep.maps(),
        sweep.level,
        sweep.dimension,
      );
      const pose = poseFor(sweep.dimension);
      let hits = 0;
      for (const { origin, dir } of probeRaysAround(
        sweep.center,
        sweep.radius,
        24,
        sweep.level,
      )) {
        const mine = finiteSolidGeneralIntervals(c, pose, origin, dir);
        const theirs = referenceUnionForRay(c, pose, origin, dir);
        compareUnions(mine, theirs.union, REFERENCE_AGREEMENT);
        if (theirs.union.length > 0) hits++;
      }
      // A sweep that hits nothing certifies nothing.
      expect(hits).toBeGreaterThan(0);
    });
  }

  it("sweeps the 12-map document beyond the device's enumeration cap", () => {
    const c = generalConstructionFor(twelveOverlappingMaps(), 2, 3);
    let maxClipped = 0;
    // The shell's rays aim off-centre; the centre ray is the one the cap
    // refuses (the unit test's own witness), so it rides the sweep too.
    for (const { origin, dir } of [
      ...probeRaysAround([0, 0, 0], 2.4, 12, 9),
      { origin: [0.01, -5, 0.02] as Vec3, dir: [0, 1, 0] as Vec3 },
    ]) {
      const mine = finiteSolidGeneralIntervals(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        origin,
        dir,
      );
      const theirs = referenceUnionForRay(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        origin,
        dir,
      );
      compareUnions(mine, theirs.union, REFERENCE_AGREEMENT);
      maxClipped = Math.max(maxClipped, theirs.clipped);
    }
    // The premise, measured: some ray clips more leaves than the cap.
    expect(maxClipped).toBeGreaterThan(FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES);
  });
});

describe("the general word tree's event chain reconstructs the union", () => {
  for (const sweep of GENERAL_SWEEPS.filter((s) => s.level > 0)) {
    it(`sweeps 24 chained rays: ${sweep.name}, level ${sweep.level}, ${sweep.dimension}D`, () => {
      const c = generalConstructionFor(
        sweep.maps(),
        sweep.level,
        sweep.dimension,
      );
      const pose = poseFor(sweep.dimension);
      for (const { origin, dir } of probeRaysAround(
        sweep.center,
        sweep.radius,
        24,
        sweep.level + 3,
      )) {
        chainReconstructsUnion(c, pose, origin, dir);
      }
    });
  }
});

describe("the general word tree's leaf cap, measured", () => {
  it("records each sweep document's worst clipped-leaf count against the cap", () => {
    // The reference's clipped-leaf count IS the pruned walk's. The record
    // is printed (the harness sheet's measurement) and the shipped sweep
    // documents must all fit: a document that routinely refuses visit-cap
    // would show here before it shows as unresolved pixels.
    const rows: string[] = [];
    for (const sweep of GENERAL_SWEEPS) {
      const c = generalConstructionFor(
        sweep.maps(),
        sweep.level,
        sweep.dimension,
      );
      const pose = poseFor(sweep.dimension);
      let worst = 0;
      for (const { origin, dir } of probeRaysAround(
        sweep.center,
        sweep.radius,
        48,
        sweep.level + 7,
      )) {
        worst = Math.max(
          worst,
          referenceUnionForRay(c, pose, origin, dir).clipped,
        );
      }
      rows.push(
        `${sweep.name}, level ${sweep.level}, ${sweep.dimension}D: ` +
          `worst ${worst} of ${c.mapCount ** sweep.level} leaves`,
      );
      expect(worst).toBeLessThanOrEqual(FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES);
    }
    console.log(
      `general word tree, worst clipped leaves per ray (cap ${FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES}):\n  ${rows.join("\n  ")}`,
    );
  });
});

describe("the general word tree's hand-exact controls", () => {
  const pose = FINITE_SOLID_IDENTITY_POSE;

  it("crosses the gasket's axis in one interval at every level of the band", () => {
    // The vertical axis through the base centroid (0, −0.8, 0) and the apex
    // (0, 1.6, 0) threads the central holes and meets only the apex
    // chain's cell: y from 1.6 − 2.4·2^−L to the apex.
    for (let level = 0; level <= 4; level++) {
      const c = generalConstructionFor(sierpinskiTetrahedron(), level, 3);
      const union = finiteSolidGeneralIntervals(c, pose, [0, -2, 0], [0, 1, 0]);
      expect(union).toHaveLength(1);
      expect(union[0].enter).toBeCloseTo(3.6 - 2.4 / 2 ** level, 12);
      expect(union[0].exit).toBeCloseTo(3.6, 12);
    }
  });

  it("crosses overlapping cells' interior faces silently: coverage 1 -> 2 -> 1 is one interval", () => {
    // The box tree's silent shared face has no simplicial analog on the
    // gasket — its level-1 cells meet only at vertices, and their tangent
    // cones there intersect along the root's own edge, so no transversal
    // ray threads two of them through a shared point. The simplicial
    // analog is OVERLAP: the default system's derived root makes its four
    // level-1 cells overlap heavily, so a central ray clips more leaves
    // than the union has intervals, and every interior crossing (coverage
    // rising past 1 and falling back) must stay silent in the chain.
    const c = generalConstructionFor(defaultTransforms(), 1, 3);
    const origin: Vec3 = [0.05, -8, 0.03];
    const dir: Vec3 = [0, 1, 0];
    const union = finiteSolidGeneralIntervals(c, pose, origin, dir);
    const reference = referenceUnionForRay(c, pose, origin, dir);
    compareUnions(union, reference.union, REFERENCE_AGREEMENT);
    expect(reference.clipped).toBeGreaterThan(union.length);
    chainReconstructsUnion(c, pose, origin, dir);
  });

  it("keeps a genuine gap between two base cells as an exit/entry pair", () => {
    // Just above the base plane, a ray from the −z base cell to the +x
    // base cell crosses the base's central triangle hole: two intervals.
    const c = generalConstructionFor(sierpinskiTetrahedron(), 1, 3);
    const origin: Vec3 = [-2, -0.75, -0.3];
    const dir = normalize3([1, 0, 0.1]);
    const union = finiteSolidGeneralIntervals(c, pose, origin, dir);
    compareUnions(
      union,
      referenceUnionForRay(c, pose, origin, dir).union,
      REFERENCE_AGREEMENT,
    );
    expect(union.length).toBeGreaterThanOrEqual(2);
    chainReconstructsUnion(c, pose, origin, dir);
  });

  it("refuses a mismatched medium claim off a boundary", () => {
    // Inside the apex cell, claiming the open: the coverage sweep reads
    // interior and refuses rather than trusting the claim.
    const c = generalConstructionFor(sierpinskiTetrahedron(), 1, 3);
    const inside = finiteSolidGeneralNextBoundary(
      c,
      pose,
      [0, 1.0, 0],
      [0, 1, 0],
      { inside: false },
    );
    expect(inside.kind).toBe("refused");
    if (inside.kind !== "refused") return;
    expect(inside.reason).toBe("state-mismatch");
  });
});

describe("the general word tree's admission, CPU-side", () => {
  it("admits the boot document's rotating maps through the derived root, 0..4", () => {
    // The replacement's premise, pinned where it is decided: the viewer's
    // starting system rotates three of its four maps, which the box tree
    // refused; the simplicial tree admits it at every level of the band.
    for (let level = 0; level <= 4; level++) {
      const boot = analyzeFiniteSolidGeneral(
        defaultTransforms(),
        null,
        noSymmetry,
        level,
        3,
      );
      expect(boot.status).toBe("eligible");
      expect(boot.construction?.rootKind).toBe("derived");
    }
  });

  it("keeps the witness's own hull as its root and refuses past the band", () => {
    const sierpinski = sierpinskiTetrahedron();
    for (let level = 0; level <= 4; level++) {
      expect(
        analyzeFiniteSolidGeneral(sierpinski, null, noSymmetry, level, 3)
          .construction?.rootKind,
      ).toBe("hull");
    }
    expect(
      analyzeFiniteSolidGeneral(sierpinski, null, noSymmetry, 5, 3).status,
    ).toBe("ineligible");
  });

  it("admits the 12-map document at level 2 with its leaf count intact", () => {
    const analysis = analyzeFiniteSolidGeneral(
      twelveOverlappingMaps(),
      null,
      noSymmetry,
      2,
      3,
    );
    expect(analysis.status).toBe("eligible");
    expect(analysis.construction?.mapCount).toBe(12);
    // The admission does NOT enforce the device's enumeration cap — the
    // cap refuses per ray on the device, disclosed; the f64 reference
    // (and this leg) is uncapped by decision.
    expect(12 * 12).toBeGreaterThan(FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES);
  });
});
