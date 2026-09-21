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
 * (the document's OWN maps as the cell tree, `analyzeFiniteSolidGeneral`):
 * its reference is an independent box union built here by a DIFFERENT
 * composition — the per-word Horner fold evaluated outer-inward, where the
 * production walk composes innermost first — so agreement pins the
 * arithmetic, not the rounding; the declared resolution
 * (`FINITE_SOLID_GENERAL_TIE_REL`) is part of the construction's contract
 * and the reference groups with it too. Legs cover both dimensions under
 * the identity pose (3D) and the fixture's frozen rotor rows (4D), the
 * owner's Sierpinski document as the non-construction witness, the
 * shipped Menger/hyper-Menger maps as the cross-construction equivalence,
 * event-chained anchor sweeps that must reconstruct the union event for
 * event, hand-exact dyadic controls (the shared face, the four-leaf
 * corner, the state-mismatch refusal), and a 12-map document whose
 * level-2 leaf count exceeds the device's enumeration cap — the f64
 * reference is uncapped by decision, and that leg keeps it honest.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/finite-solid.harness.ts
 */
import {
  defaultTransforms,
  mengerSponge,
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
// 7. The general word tree: the document's OWN maps as the cell tree.
//
// The grid legs above pin the shipped constructions against their two
// qualified references. The general word tree's reference is the
// independent box union below: per-word leaf boxes composed by the
// OUTER-INWARD Horner fold (root bound folded in), where the production
// walk composes innermost first — different association, same reals, so
// agreement pins the arithmetic rather than one rounding of it. The
// declared resolution `FINITE_SOLID_GENERAL_TIE_REL` is the
// construction's CONTRACT (a gap below it is unrepresentable on the f32
// wire the transport rides), so the reference groups with it too;
// disagreement in the interval structure beyond it is a production bug,
// never a tolerance question.
// ---------------------------------------------------------------------------

const REFERENCE_AGREEMENT = 1e-12;
/** Chained-anchor hops snap each restart onto canonical planes within the
 * declared envelope (`TIE_REL · the leaf's own half extent`), so the
 * accumulated event positions may drift by at most one envelope per hop.
 * The largest envelope any leg's construction declares is
 * ~1.4e-7 (the Sierpinski level-1 leaf) and no sweep walks more than 32
 * hops, so 1e-5 bounds every honest reconstruction far below the
 * construction's smallest real feature (~2e-1 at these depths). */
const CHAIN_RECONSTRUCTION = 1e-5;

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

/** One leaf's box by the outer-inward Horner fold with the root bound
 * folded in: the composed box face is
 * `t1 + s1·(t2 + s2·(…(tN + sN·root)))`, evaluated from the INNERMOST map
 * outward — the mirror image of the production walk's incremental
 * innermost-first compose. Same reals, different rounding. */
function referenceLeafBounds(
  c: FiniteSolidGeneralConstruction,
  word: readonly number[],
): Array<[number, number]> {
  const bounds: Array<[number, number]> = [];
  for (let axis = 0; axis < 4; axis++) {
    let lo = c.rootMin[axis];
    let hi = c.rootMax[axis];
    for (let depth = word.length - 1; depth >= 0; depth--) {
      const map = word[depth];
      const s = c.mapScale[map][axis];
      const t = c.mapOffset[map][axis];
      lo = t + s * lo;
      hi = t + s * hi;
    }
    bounds.push([Math.min(lo, hi), Math.max(lo, hi)]);
  }
  return bounds;
}

function referenceClip(
  c: FiniteSolidGeneralConstruction,
  bounds: Array<[number, number]>,
  q: Vec4,
  qd: Vec4,
): { enter: number; exit: number } | null {
  let enter = -Infinity;
  let exit = Infinity;
  for (let axis = 0; axis < c.dimension; axis++) {
    const [lo, hi] = bounds[axis];
    const d = qd[axis];
    if (d === 0) {
      if (q[axis] < lo || q[axis] > hi) return null;
      continue;
    }
    const ta = (lo - q[axis]) / d;
    const tb = (hi - q[axis]) / d;
    enter = Math.max(enter, Math.min(ta, tb));
    exit = Math.min(exit, Math.max(ta, tb));
  }
  return exit > enter ? { enter, exit } : null;
}

/** The independent interval union: every level-N word's leaf clipped and
 * swept with the declared-resolution tie — the same grouping rule the
 * contract states (endpoints within the tie of a group's first endpoint
 * are ONE boundary), restated here because it is semantics, not
 * implementation. */
function referenceGeneralUnion(
  c: FiniteSolidGeneralConstruction,
  q: Vec4,
  qd: Vec4,
): Array<{ enter: number; exit: number }> {
  const endpoints: Array<{ t: number; delta: number }> = [];
  const counter = new Array<number>(c.level).fill(0);
  for (;;) {
    const clip = referenceClip(c, referenceLeafBounds(c, counter), q, qd);
    if (clip) {
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
  return union;
}

/** The intrinsic ray the production itself derives (the same shared pose
 * helpers, so the reference pins the clip/union arithmetic, not the pose
 * conversion), then the independent union on it. */
function referenceUnionForRay(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  dir: Vec3,
): Array<{ enter: number; exit: number }> {
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
    expect(Math.abs(mine[i].enter - theirs[i].enter)).toBeLessThan(within);
    expect(Math.abs(mine[i].exit - theirs[i].exit)).toBeLessThan(within);
  }
}

/** Deterministic probe rays around a construction: origins on a shell,
 * directions through offset targets inside the root — a mix of hits,
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
 * enumeration), the anchor-driven hops within the declared envelope, and
 * a miss to close. A refusal anywhere is a failure with its reason. */
function chainReconstructsUnion(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  dir: Vec3,
): void {
  const union = finiteSolidGeneralIntervals(c, pose, origin, dir);
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
      CHAIN_RECONSTRUCTION,
    );
    expect(Math.abs(exitEvent.at - union[i].exit)).toBeLessThan(
      CHAIN_RECONSTRUCTION,
    );
  }
}

/** Twelve of the Menger's twenty maps: a root-invariant diagonal document
 * whose level-2 word tree (144 leaves) exceeds the device's enumeration
 * cap — the f64 reference is uncapped by decision, and this document
 * keeps that honest against a narrowing of the cap. */
const twelveMaps = mengerSponge().slice(0, 12);

describe("the general word tree agrees with the independent box union", () => {
  const sierpinski = sierpinskiTetrahedron();
  // The witness's root: the maps' fixed points (2·p), known exactly.
  const sierpinskiCenter: Vec3 = [0.375, 0.4, 0];

  for (const level of [0, 1, 2] as const) {
    it(`sweeps 24 probe rays on the Sierpinski document at level ${level}, 3D`, () => {
      const c = generalConstructionFor(sierpinski, level, 3);
      for (const { origin, dir } of probeRaysAround(
        sierpinskiCenter,
        3,
        24,
        level,
      )) {
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
        compareUnions(theirs, mine, REFERENCE_AGREEMENT);
      }
    });
  }

  it("sweeps posed 4D rays on the hyper-Menger maps at level 1", () => {
    const c = generalConstructionFor(hyperMengerSpongeTransforms(), 1, 4);
    const pose = poseFor(4);
    for (const { origin, dir } of probeRaysAround([0, 0, 0], 2.6, 20, 5)) {
      const mine = finiteSolidGeneralIntervals(c, pose, origin, dir);
      const theirs = referenceUnionForRay(c, pose, origin, dir);
      compareUnions(theirs, mine, REFERENCE_AGREEMENT);
    }
  });

  it("sweeps the 12-map document beyond the device's enumeration cap", () => {
    // The premise: 144 level-2 leaves, above the 128-leaf device cap —
    // the f64 oracle is uncapped and this sweep pins that.
    expect(12 * 12).toBeGreaterThan(FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES);
    const c = generalConstructionFor(twelveMaps, 2, 3);
    for (const { origin, dir } of probeRaysAround([0, 0, 0], 2.4, 12, 9)) {
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
      compareUnions(theirs, mine, REFERENCE_AGREEMENT);
    }
  });
});

describe("the general word tree's event chain reconstructs the union", () => {
  const sierpinski = sierpinskiTetrahedron();
  const sierpinskiCenter: Vec3 = [0.375, 0.4, 0];

  for (const level of [1, 2] as const) {
    it(`sweeps 24 chained rays on the Sierpinski document at level ${level}`, () => {
      const c = generalConstructionFor(sierpinski, level, 3);
      for (const { origin, dir } of probeRaysAround(
        sierpinskiCenter,
        3,
        24,
        level + 3,
      )) {
        chainReconstructsUnion(c, FINITE_SOLID_IDENTITY_POSE, origin, dir);
      }
    });
  }

  it("sweeps chained posed 4D rays on the hyper-Menger maps", () => {
    const c = generalConstructionFor(hyperMengerSpongeTransforms(), 1, 4);
    const pose = poseFor(4);
    for (const { origin, dir } of probeRaysAround([0, 0, 0], 2.6, 16, 11)) {
      chainReconstructsUnion(c, pose, origin, dir);
    }
  });
});

describe("the general word tree's hand-exact controls", () => {
  const sierpinski = sierpinskiTetrahedron();
  const c1 = generalConstructionFor(sierpinski, 1, 3);
  const pose = FINITE_SOLID_IDENTITY_POSE;

  it("merges the spine's shared face into one interval, bit-exactly", () => {
    // Down the spine through the +x base box and the apex box, whose
    // faces touch at y = 0.4 through both words: ONE interval.
    const spine = finiteSolidGeneralIntervals(
      c1,
      pose,
      [0.5, -2, 0],
      [0, 1, 0],
    );
    expect(spine).toHaveLength(1);
    expect(spine[0].enter).toBe(1.2);
    expect(spine[0].exit).toBe(3.6);
  });

  it("holds the four-leaf corner silent and reconstructs the chain exactly", () => {
    // The ray rides the leaf2/leaf3 shared z face exactly and passes
    // through the corner (0.375, 0.4, 0) where four leaves meet: the
    // corner's tied group nets -1 (two exits, one entry) and must stay
    // SILENT — the union reads ONE interval [0.875, 2.375], the chain
    // two events (enter at 0.875, exit at 0.875 + 1.5 = 2.375 from the
    // canonical anchor), all values dyadic and bit-exact. The direction
    // stays UNNORMALIZED on purpose: t is in the given direction's own
    // parameterization and the dyadic values stay bit-exact.
    const origin: Vec3 = [0.375 - 2, 0.4 - 2, 0];
    const dir: Vec3 = [1, 1, 0];
    const union = finiteSolidGeneralIntervals(c1, pose, origin, dir);
    expect(union).toHaveLength(1);
    expect(union[0].enter).toBe(0.875);
    expect(union[0].exit).toBe(2.375);
    const entry = finiteSolidGeneralNextBoundary(c1, pose, origin, dir, {
      inside: false,
    });
    expect(entry.kind).toBe("boundary");
    if (entry.kind !== "boundary") return;
    expect(entry.entering).toBe(true);
    expect(entry.t).toBe(0.875);
    // Both leaves entered through the same x plane; the anchor names the
    // first face's leaf and the masked axis.
    expect(entry.anchor.planeMask).toBe(1 << 0);
    expect(entry.anchor.planeIndices[0]).toBe(0);
    const exit = finiteSolidGeneralNextBoundaryFromAnchor(c1, pose, dir, {
      inside: true,
      anchor: entry.anchor,
    });
    expect(exit.kind).toBe("boundary");
    if (exit.kind !== "boundary") return;
    expect(exit.entering).toBe(false);
    expect(exit.t).toBe(1.5);
    expect(0.875 + exit.t).toBe(2.375);
    const after = finiteSolidGeneralNextBoundaryFromAnchor(c1, pose, dir, {
      inside: false,
      anchor: exit.anchor,
    });
    expect(after.kind).toBe("miss");
  });

  it("refuses a mismatched medium claim off a boundary", () => {
    // Inside the apex box, claiming the open: the coverage sweep reads
    // interior and refuses rather than trusting the claim.
    const inside = finiteSolidGeneralNextBoundary(
      c1,
      pose,
      [0.5, 1.0, 0],
      [0, 1, 0],
      { inside: false },
    );
    expect(inside.kind).toBe("refused");
    if (inside.kind !== "refused") return;
    expect(inside.reason).toBe("state-mismatch");
  });
});

describe("the general word tree's cross-construction equivalence", () => {
  // The shipped Menger maps through the WORD TREE must render the same
  // object the GRID construction renders: the document's own maps ARE the
  // grid's structure, so the two constructions agree to the canonical
  // planes' last ulp (composed affines against centred rationals).
  for (const level of [1, 2] as const) {
    it(`sweeps 24 rays, Menger maps at level ${level}, 3D`, () => {
      const grid = buildFiniteSolidConstruction("menger", 3, level);
      const tree = generalConstructionFor(mengerSponge(), level, 3);
      for (const { origin, dir } of probeRaysAround(
        [0, 0, 0],
        2.6,
        24,
        level,
      )) {
        const gridUnion = finiteSolidIntervals(
          grid,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          dir,
        );
        const treeUnion = finiteSolidGeneralIntervals(
          tree,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          dir,
        );
        compareUnions(treeUnion, gridUnion, 1e-9);
      }
    });
  }

  it("sweeps posed 4D rays, hyper-Menger maps at level 1", () => {
    const grid = buildFiniteSolidConstruction("hyperMenger", 4, 1);
    const tree = generalConstructionFor(hyperMengerSpongeTransforms(), 1, 4);
    const pose = poseFor(4);
    for (const { origin, dir } of probeRaysAround([0, 0, 0], 2.6, 20, 7)) {
      const gridUnion = finiteSolidIntervals(grid, pose, origin, dir);
      const treeUnion = finiteSolidGeneralIntervals(tree, pose, origin, dir);
      compareUnions(treeUnion, gridUnion, 1e-9);
    }
  });
});

describe("the general word tree's admission, CPU-side", () => {
  it("refuses the boot document's rotating maps and admits the witness 0..2", () => {
    // The app gate's own premise, pinned where it is decided: the viewer's
    // starting system rotates its maps, so the word-tree admission refuses
    // it with the diagonal-composition reason.
    const boot = analyzeFiniteSolidGeneral(
      defaultTransforms(),
      null,
      noSymmetry,
      1,
      3,
    );
    expect(boot.status).toBe("ineligible");
    expect(boot.reasons.join("; ")).toMatch(/rotates or shears/);
    const sierpinski = sierpinskiTetrahedron();
    for (const level of [0, 1, 2] as const) {
      expect(
        analyzeFiniteSolidGeneral(sierpinski, null, noSymmetry, level, 3)
          .status,
      ).toBe("eligible");
    }
  });

  it("admits the 12-map document at level 2 with its leaf count intact", () => {
    const analysis = analyzeFiniteSolidGeneral(
      twelveMaps,
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
    expect(analysis.construction?.level).toBe(2);
    expect(12 * 12).toBeGreaterThan(FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES);
  });
});
