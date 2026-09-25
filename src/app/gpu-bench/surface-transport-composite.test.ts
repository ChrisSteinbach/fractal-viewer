import {
  analyzeFiniteSolidGeneral,
  FINITE_SOLID_IDENTITY_POSE,
  finiteSolidGeneralBoundingRadius,
  finiteSolidGeneralNextBoundary,
  type FiniteSolidGeneralConstruction,
} from "../../fractal/finite-solid";
import {
  buildFiniteSolidOpaqueContent,
  finiteSolidOpaqueDistance,
  type FiniteSolidOpaqueContent,
} from "../../fractal/finite-solid-composite";
import {
  defaultTransforms,
  mengerSponge,
  pentatope,
} from "../../fractal/presets";
import { mulberry32 } from "../../fractal/rng";
import {
  DIELECTRIC_ABSORPTION,
  DIELECTRIC_CROSSING_EPS_REL,
  DIELECTRIC_INITIAL_BRANCH_THETA,
  DIELECTRIC_IOR,
  dielectricBeerThroughput,
  dielectricFresnel,
} from "../../fractal/surface-dielectric";
import { buildSurfaceDE } from "../../fractal/surface-de";
import { buildSurfaceDE4 } from "../../fractal/surface-de-4d";
import type { Transform, Vec3 } from "../../fractal/types";
import {
  transportBoundaryQueryCPU,
  transportCompositeOpaqueMarch,
  transportFiniteGeneralBoundaryQueryCPU,
  transportOpaqueControlRadiance,
  transportTraceCPU,
  type TransportFixtureMedia,
} from "./surface-transport-fixture";

const NO_SYMMETRY = { order: 1, plane: "xz" as const };
const BG: Vec3 = [0.05, 0.08, 0.12];

function construction(
  maps: Transform[],
  level: number,
  dimension: 3 | 4,
): FiniteSolidGeneralConstruction {
  const analysis = analyzeFiniteSolidGeneral(
    maps,
    null,
    NO_SYMMETRY,
    level,
    dimension,
  );
  if (analysis.status !== "eligible" || !analysis.construction) {
    throw new Error(`fixture refused: ${analysis.reasons.join("; ")}`);
  }
  return analysis.construction;
}

/** One trace under per-map media — the cell media (`composite` false:
 * opaque subtrees are cells) or the composite (glass-only walk plus the
 * opaque attractor's march). */
function trace(
  c: FiniteSolidGeneralConstruction,
  media: number[],
  content: FiniteSolidOpaqueContent | null,
  origin: Vec3,
  dir: Vec3,
  onOpaque?: (branch: number) => void,
) {
  const radius = finiteSolidGeneralBoundingRadius(c);
  const fixtureMedia: TransportFixtureMedia = {
    material: () => ({
      ior: DIELECTRIC_IOR,
      absorption: [...DIELECTRIC_ABSORPTION] as Vec3,
      radius,
    }),
    opaque: (pos, d, n, branch) => {
      onOpaque?.(branch);
      return transportOpaqueControlRadiance(pos, d, n, branch);
    },
    ...(content
      ? {
          opaqueMarch: transportCompositeOpaqueMarch(
            content,
            FINITE_SOLID_IDENTITY_POSE,
            radius,
          ),
        }
      : {}),
  };
  return transportTraceCPU(
    { estimate: () => 1, stepScale: 1, visibleRadius: radius },
    origin,
    dir,
    DIELECTRIC_INITIAL_BRANCH_THETA,
    {
      ior: DIELECTRIC_IOR,
      absorption: [...DIELECTRIC_ABSORPTION] as Vec3,
      radius,
    },
    BG,
    { maxProcessedPaths: 256, maxInterfaces: 128 },
    undefined,
    (o, d, anchor, claim) =>
      transportFiniteGeneralBoundaryQueryCPU(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        media,
        content !== null,
        o,
        d,
        anchor,
        claim,
      ),
    fixtureMedia,
  );
}

/** The Menger maps with Glass on the two opposite corner sub-cubes: map 0
 * spans [-0.75, -0.25]³, map 19 [0.25, 0.75]³. */
function mengerComposite() {
  const maps = mengerSponge();
  const c = construction(maps, 2, 3);
  const media = maps.map((_, i) => (i === 0 || i === maps.length - 1 ? 1 : 0));
  const content = buildFiniteSolidOpaqueContent(c, media, buildSurfaceDE(maps));
  return { maps, c, media, content };
}

describe("the composite trace (opaque maps as the attractor, glass maps as cells)", () => {
  it("is the cell trace byte for byte when every map is glass", () => {
    const maps = defaultTransforms();
    const c = construction(maps, 2, 3);
    const media = [1, 2, 1, 1];
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE(maps),
    );
    expect(content.branches).toHaveLength(0);
    const rng = mulberry32(8);
    for (let i = 0; i < 24; i++) {
      const origin: Vec3 = [rng() * 6 - 3, rng() * 2 + 2, rng() * 6 - 3];
      const target: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const d = target.map((x, a) => x - origin[a]);
      const len = Math.hypot(...d);
      const dir = d.map((x) => x / len) as Vec3;
      expect(trace(c, media, content, origin, dir)).toEqual(
        trace(c, media, null, origin, dir),
      );
    }
  });

  it("ends an unobstructed opaque ray on the attractor, never nearer than its cells", () => {
    const { c, media, content } = mengerComposite();
    // Straight down z into the level-1 edge cube centred (0, 0.5, 0.5) —
    // opaque, no glass in front — at local coordinates (1/4, 1/4): 1/4 is
    // in the Cantor set, so that column is solid attractor at every level
    // (the cube's centre column is its hole at every level).
    const origin: Vec3 = [-0.125, 0.375, 3];
    const dir: Vec3 = [0, 0, -1];
    const branches: number[] = [];
    const composite = trace(c, media, content, origin, dir, (b) =>
      branches.push(b),
    );
    expect(["complete", "residual"]).toContain(composite.status);
    expect(branches).toHaveLength(1);
    const march = transportCompositeOpaqueMarch(
      content,
      FINITE_SOLID_IDENTITY_POSE,
      finiteSolidGeneralBoundingRadius(c),
    )(
      origin,
      dir,
      DIELECTRIC_CROSSING_EPS_REL * finiteSolidGeneralBoundingRadius(c),
      Infinity,
    );
    expect(march.kind).toBe("hit");
    if (march.kind !== "hit") return;
    // The cells contain the attractor, so its surface is never in front of
    // the level-2 cube face the cell walk reports.
    const cell = finiteSolidGeneralNextBoundary(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      origin,
      dir,
      { inside: false, media: media.map(() => 0), medium: 0 },
    );
    expect(cell.kind).toBe("boundary");
    if (cell.kind !== "boundary") return;
    // Up to the march's own hit epsilon: it accepts within eps of the
    // surface (the estimator backend's contract).
    expect(march.t).toBeGreaterThanOrEqual(
      cell.t -
        DIELECTRIC_CROSSING_EPS_REL * finiteSolidGeneralBoundingRadius(c),
    );
    expect(composite.radiance).toEqual(
      transportOpaqueControlRadiance(
        [origin[0], origin[1], origin[2] - march.t],
        dir,
        march.normal,
        march.branch,
      ),
    );
  });

  it("sees the opaque cube behind a glass corner through the glass, attenuated", () => {
    const { c, media, content } = mengerComposite();
    // Down z at (0.375, 0.375) — local (1/4, 1/4), a Cantor column: through
    // the glass corner cube's solid corner-edge-corner cell column (z 0.75
    // → 0.25), onto the opaque edge cube centred (0.5, 0.5, 0), whose
    // attractor fills that column up to its top face at z = 0.25.
    const origin: Vec3 = [0.375, 0.375, 3];
    const dir: Vec3 = [0, 0, -1];
    const branches: number[] = [];
    const r = trace(c, media, content, origin, dir, (b) => branches.push(b));
    expect(["complete", "residual"]).toContain(r.status);
    expect(branches.length).toBeGreaterThan(0);
    // Normal incidence: the entry reflects f to the backdrop, and the
    // transmitted (1 - f) crosses 0.5 of glass to the opaque face (the
    // march stops within its epsilon of it). The face is shaded with the
    // march's own normal — the estimator backend's tetrahedral taps, which
    // on a lower-bound field near the cube's edges tilt a little off +z —
    // so the Lambert term is read from it. Higher-order bounces carry less
    // than f² of the energy.
    const radius = finiteSolidGeneralBoundingRadius(c);
    const f = dielectricFresnel(1, 1, DIELECTRIC_IOR);
    const inside = transportCompositeOpaqueMarch(
      content,
      FINITE_SOLID_IDENTITY_POSE,
      radius,
    )(
      [0.375, 0.375, 0.75],
      dir,
      DIELECTRIC_CROSSING_EPS_REL * radius,
      Infinity,
    );
    expect(inside.kind).toBe("hit");
    if (inside.kind !== "hit") return;
    console.log(
      "DIAG inside",
      JSON.stringify(inside),
      "branches",
      branches,
      "radiance",
      r.radiance,
      "status",
      r.status,
    );
    expect(inside.t).toBeCloseTo(0.5, 3);
    expect(inside.normal[2]).toBeGreaterThan(0.95);
    expect(inside.branch).toBe(branches[0]);
    const opaque = transportOpaqueControlRadiance(
      [0.375, 0.375, 0.25],
      dir,
      inside.normal,
      branches[0],
    );
    console.log(
      "DIAG f",
      f,
      "radius",
      radius,
      "opaque",
      opaque,
      "eps",
      DIELECTRIC_CROSSING_EPS_REL * radius,
    );
    for (let axis = 0; axis < 3; axis++) {
      const expected =
        BG[axis] * f +
        (1 - f) *
          dielectricBeerThroughput(DIELECTRIC_ABSORPTION[axis], 0.5, radius) *
          opaque[axis];
      console.log(
        "DIAG axis",
        axis,
        "got",
        r.radiance[axis],
        "exp",
        expected,
        "diff",
        Math.abs(r.radiance[axis] - expected),
        "beer",
        dielectricBeerThroughput(DIELECTRIC_ABSORPTION[axis], 0.5, radius),
        "abs",
        DIELECTRIC_ABSORPTION[axis],
      );
      expect(Math.abs(r.radiance[axis] - expected)).toBeLessThan(f * f + 1e-4);
    }
  });

  it("never lands nearer than the opaque cells on random rays (the default system)", () => {
    const maps = defaultTransforms();
    const c = construction(maps, 3, 3);
    const media = [0, 0, 0, 0];
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE(maps),
    );
    const radius = finiteSolidGeneralBoundingRadius(c);
    const eps = DIELECTRIC_CROSSING_EPS_REL * radius;
    const march = transportCompositeOpaqueMarch(
      content,
      FINITE_SOLID_IDENTITY_POSE,
      radius,
    );
    const rng = mulberry32(12);
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      const origin: Vec3 = [rng() * 6 - 3, rng() * 2 + 2.5, rng() * 6 - 3];
      const target: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const d = target.map((x, a) => x - origin[a]);
      const len = Math.hypot(...d);
      const dir = d.map((x) => x / len) as Vec3;
      const m = march(origin, dir, eps, Infinity);
      expect(m.kind).not.toBe("refused");
      if (m.kind !== "hit") continue;
      hits++;
      const cell = finiteSolidGeneralNextBoundary(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        origin,
        dir,
        { inside: false, media, medium: 0 },
      );
      expect(cell.kind).toBe("boundary");
      if (cell.kind === "boundary") {
        expect(m.t).toBeGreaterThanOrEqual(cell.t - eps);
      }
    }
    expect(hits).toBeGreaterThan(20);
  });

  it("chains 4D rays through glass onto the opaque attractor (the pentatope)", () => {
    const maps = pentatope();
    const c = construction(maps, 1, 4);
    const media = [1, 0, 0, 0, 0];
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE4(maps),
    );
    // Aim at the opaque branches' own attractor points near the w = 0
    // slice (the identity pose's hyperplane): the sliced gasket is thin, so
    // random directions mostly miss it.
    const rng = mulberry32(14);
    let p = [0, 0, 0, 0];
    const targets: Vec3[] = [];
    for (let i = 0; i < 200000 && targets.length < 40; i++) {
      const a = Math.floor(rng() * c.mapCount);
      const m = c.mapMatrix[a];
      p = [0, 1, 2, 3].map(
        (row) =>
          m[row * 4] * p[0] +
          m[row * 4 + 1] * p[1] +
          m[row * 4 + 2] * p[2] +
          m[row * 4 + 3] * p[3] +
          c.mapOffset[a][row],
      );
      if (i > 64 && media[a] === 0 && Math.abs(p[3]) < 1e-3) {
        targets.push([p[0], p[1], p[2]]);
      }
    }
    expect(targets.length).toBe(40);
    let opaqueTerminals = 0;
    for (const target of targets) {
      const origin: Vec3 = [rng() * 4 - 2, rng() * 2 + 2, rng() * 4 - 2];
      const d = target.map((x, a) => x - origin[a]);
      const len = Math.hypot(...d);
      const dir = d.map((x) => x / len) as Vec3;
      const r = trace(c, media, content, origin, dir, () => opaqueTerminals++);
      expect(r.status).not.toBe("invalid");
      expect(r.status).not.toBe("unresolved");
    }
    expect(opaqueTerminals).toBeGreaterThan(20);
  });
});

describe("the composite's over-relaxed march", () => {
  /** A counted march twin of {@link transportCompositeOpaqueMarch}: the
   * same unanchored query over the masked opaque distance, optionally
   * relaxed, reporting its estimate evaluations. */
  function countedMarch(
    content: FiniteSolidOpaqueContent,
    radius: number,
    relax?: number,
  ) {
    let steps = 0;
    const system = {
      estimate: (p: Vec3) => {
        steps++;
        return finiteSolidOpaqueDistance(content, [p[0], p[1], p[2], 0]).d;
      },
      stepScale: 1,
      visibleRadius: radius,
      ...(relax !== undefined ? { relax } : {}),
    };
    return {
      run: (origin: Vec3, dir: Vec3, eps: number, tLimit: number) => {
        steps = 0;
        return {
          r: transportBoundaryQueryCPU(
            system,
            origin,
            dir,
            false,
            origin,
            eps,
            tLimit,
          ),
          steps: () => steps,
        };
      },
    };
  }

  /** Rays from above at the construction: random targets inside the
   * attractor's bounding cube, the corpus the cell-invariant pins use. */
  function corpus(
    count: number,
    seed: number,
  ): Array<{ origin: Vec3; dir: Vec3 }> {
    const rng = mulberry32(seed);
    const out: Array<{ origin: Vec3; dir: Vec3 }> = [];
    for (let i = 0; i < count; i++) {
      const origin: Vec3 = [rng() * 6 - 3, rng() * 2 + 2.5, rng() * 6 - 3];
      const target: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const d = target.map((x, a) => x - origin[a]);
      const len = Math.hypot(...d);
      out.push({ origin, dir: d.map((x) => x / len) as Vec3 });
    }
    return out;
  }

  it("agrees with the classic march: the same kind, within two epsilons on hits", () => {
    const { maps } = mengerComposite();
    const c = construction(maps, 2, 3);
    const media = maps.map((_, i) =>
      i === 0 || i === maps.length - 1 ? 1 : 0,
    );
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE(maps),
    );
    const radius = finiteSolidGeneralBoundingRadius(c);
    const eps = DIELECTRIC_CROSSING_EPS_REL * radius;
    const classic = countedMarch(content, radius);
    const relaxed = countedMarch(content, radius, 1.5);
    let hits = 0;
    let classicMax = 0;
    let relaxedMax = 0;
    for (const { origin, dir } of corpus(80, 9)) {
      const a = classic.run(origin, dir, eps, Infinity);
      const b = relaxed.run(origin, dir, eps, Infinity);
      expect(a.r.kind).toBe(b.r.kind);
      if (a.r.kind === "boundary" && b.r.kind === "boundary") {
        hits++;
        expect(Math.abs(b.r.t - a.r.t)).toBeLessThanOrEqual(2 * eps + 1e-9);
      }
      classicMax = Math.max(classicMax, a.steps());
      relaxedMax = Math.max(relaxedMax, b.steps());
    }
    expect(hits).toBeGreaterThan(20);
    // The lever's claim is the WAVE-SETTER, not the corpus total: the
    // longest march in a lockstep group sets its cost, and the relaxation
    // shortens the long crawls even where rollback churn costs medium
    // marches (the trace-level totals are the scratch stats' record).
    expect(relaxedMax).toBeLessThan(classicMax);
  });

  it("never lands nearer than the opaque cells on random rays", () => {
    const maps = defaultTransforms();
    const c = construction(maps, 3, 3);
    const media = [0, 0, 0, 0];
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE(maps),
    );
    const radius = finiteSolidGeneralBoundingRadius(c);
    const eps = DIELECTRIC_CROSSING_EPS_REL * radius;
    const march = transportCompositeOpaqueMarch(
      content,
      FINITE_SOLID_IDENTITY_POSE,
      radius,
    );
    const rng = mulberry32(21);
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      const origin: Vec3 = [rng() * 6 - 3, rng() * 2 + 2.5, rng() * 6 - 3];
      const target: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const d = target.map((x, a) => x - origin[a]);
      const len = Math.hypot(...d);
      const dir = d.map((x) => x / len) as Vec3;
      const m = march(origin, dir, eps, Infinity);
      expect(m.kind).not.toBe("refused");
      if (m.kind !== "hit") continue;
      hits++;
      const cell = finiteSolidGeneralNextBoundary(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        origin,
        dir,
        { inside: false, media, medium: 0 },
      );
      expect(cell.kind).toBe("boundary");
      if (cell.kind === "boundary") {
        expect(m.t).toBeGreaterThanOrEqual(cell.t - eps);
      }
    }
    expect(hits).toBeGreaterThan(20);
  });
});
