import {
  analyzeFiniteSolidGeneral,
  FINITE_SOLID_IDENTITY_POSE,
  FINITE_SOLID_MEDIUM_OPAQUE,
  finiteSolidGeneralDisplayDistance,
  finiteSolidGeneralIntervals,
  finiteSolidGeneralMediumAt,
  finiteSolidGeneralNextBoundary,
  finiteSolidGeneralNextBoundaryFromAnchor,
  type FiniteSolidGeneralConstruction,
} from "./finite-solid";
import {
  buildFiniteSolidOpaqueContent,
  finiteSolidOpaqueDistance,
} from "./finite-solid-composite";
import { defaultTransforms, mengerSponge, pentatope } from "./presets";
import { mulberry32 } from "./rng";
import { buildSurfaceDE } from "./surface-de";
import { buildSurfaceDE4 } from "./surface-de-4d";
import type { Transform, Vec3, Vec4 } from "./types";

const NO_SYMMETRY = { order: 1, plane: "xz" as const };

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

function applyMap(c: FiniteSolidGeneralConstruction, a: number, p: Vec4): Vec4 {
  const m = c.mapMatrix[a];
  const out: Vec4 = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    out[row] =
      m[row * 4] * p[0] +
      m[row * 4 + 1] * p[1] +
      m[row * 4 + 2] * p[2] +
      m[row * 4 + 3] * p[3] +
      c.mapOffset[a][row];
  }
  return out;
}

/** Attractor points by the chaos game on the construction's own maps,
 * tagged with their first-level branch (the LAST map applied). */
function attractorSamples(
  c: FiniteSolidGeneralConstruction,
  count: number,
): Array<{ p: Vec4; branch: number }> {
  const rng = mulberry32(11);
  let p: Vec4 = [0, 0, 0, 0];
  const out: Array<{ p: Vec4; branch: number }> = [];
  for (let i = 0; i < count + 64; i++) {
    const a = Math.floor(rng() * c.mapCount);
    p = applyMap(c, a, p);
    if (i >= 64) out.push({ p, branch: a });
  }
  return out;
}

function dist(a: Vec4, b: Vec4, dimension: number): number {
  let s = 0;
  for (let i = 0; i < dimension; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

describe("finite-solid composite opaque content", () => {
  it("lower-bounds the distance to the opaque branches' attractor points (3D, rotating default system)", () => {
    const maps = defaultTransforms();
    const c = construction(maps, 2, 3);
    const media = [1, 0, 1, 0];
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE(maps),
    );
    const opaque = attractorSamples(c, 20000).filter(
      (s) => media[s.branch] === 0,
    );
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const q: Vec4 = [rng() * 3 - 1.5, rng() * 3 - 1.5, rng() * 3 - 1.5, 0];
      const { d } = finiteSolidOpaqueDistance(content, q);
      let nearest = Infinity;
      for (const s of opaque) nearest = Math.min(nearest, dist(q, s.p, 3));
      expect(d).toBeLessThanOrEqual(nearest + 1e-9);
    }
  });

  it("lower-bounds the distance to the opaque branches' attractor points (4D pentatope)", () => {
    const maps = pentatope();
    const c = construction(maps, 2, 4);
    const media = [0, 1, 0, 1, 0];
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE4(maps),
    );
    const opaque = attractorSamples(c, 20000).filter(
      (s) => media[s.branch] === 0,
    );
    const rng = mulberry32(4);
    for (let i = 0; i < 150; i++) {
      const q: Vec4 = [
        rng() * 2 - 1,
        rng() * 2 - 1,
        rng() * 2 - 1,
        rng() * 2 - 1,
      ];
      const { d } = finiteSolidOpaqueDistance(content, q);
      let nearest = Infinity;
      for (const s of opaque) nearest = Math.min(nearest, dist(q, s.p, 4));
      expect(d).toBeLessThanOrEqual(nearest + 1e-9);
    }
  });

  it("reads the glass branches' attractor as empty space (Menger maps, glass on two opposite corners)", () => {
    const maps = mengerSponge();
    const c = construction(maps, 2, 3);
    const media = maps.map((_, i) =>
      i === 0 || i === maps.length - 1 ? 1 : 0,
    );
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE(maps),
    );
    // Maps 0 and 19 are the sponge's opposite corner sub-cubes, spanning
    // [-0.75, -0.25]³ and [0.25, 0.75]³. A glass sample with every
    // coordinate beyond 0.6 in magnitude sits at least 0.35 from every
    // opaque sub-cube (their nearest faces lie at |coordinate| = 0.25), so
    // the masked distance must read it as empty space.
    const far = attractorSamples(c, 20000).filter(
      (s) =>
        media[s.branch] !== 0 &&
        [0, 1, 2].every((axis) => Math.abs(s.p[axis]) > 0.6),
    );
    expect(far.length).toBeGreaterThan(20);
    for (const s of far) {
      expect(finiteSolidOpaqueDistance(content, s.p).d).toBeGreaterThan(0.1);
    }
  });

  it("attributes an opaque hit to the branch that owns it", () => {
    const maps = mengerSponge();
    const c = construction(maps, 2, 3);
    const media = maps.map((_, i) => (i === 0 ? 1 : 0));
    const content = buildFiniteSolidOpaqueContent(
      c,
      media,
      buildSurfaceDE(maps),
    );
    const samples = attractorSamples(c, 4000).filter(
      (s) => media[s.branch] === 0,
    );
    // The sponge spans [-0.75, 0.75]; its level-1 sub-cubes are centred on
    // multiples of 0.5 with half-extent 0.25. A sample within 0.2 of its
    // sub-cube's centre on every axis is off every shared face, so exactly
    // one branch owns it.
    let checked = 0;
    for (const s of samples.slice(0, 400)) {
      const local = [0, 1, 2].map((axis) =>
        Math.abs(s.p[axis] - Math.round(s.p[axis] * 2) / 2),
      );
      if (Math.max(...local) > 0.2) continue;
      expect(finiteSolidOpaqueDistance(content, s.p).branch).toBe(s.branch);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("keeps the estimators' cutoff contract through each branch's scale", () => {
    const maps = defaultTransforms();
    const c = construction(maps, 2, 3);
    const content = buildFiniteSolidOpaqueContent(
      c,
      [0, 1, 0, 0],
      buildSurfaceDE(maps),
    );
    const rng = mulberry32(9);
    for (let i = 0; i < 300; i++) {
      const q: Vec4 = [rng() * 3 - 1.5, rng() * 3 - 1.5, rng() * 3 - 1.5, 0];
      const full = finiteSolidOpaqueDistance(content, q).d;
      const cutoff = 0.02 + rng() * 0.2;
      const early = finiteSolidOpaqueDistance(content, q, cutoff).d;
      if (early >= cutoff) expect(early).toBe(full);
      else expect(full).toBeLessThan(cutoff);
    }
  });

  it("has no opaque content when every map is glass", () => {
    const maps = defaultTransforms();
    const c = construction(maps, 2, 3);
    const content = buildFiniteSolidOpaqueContent(
      c,
      [1, 1, 2, 1],
      buildSurfaceDE(maps),
    );
    expect(content.branches).toHaveLength(0);
    expect(finiteSolidOpaqueDistance(content, [0, 0, 0, 0])).toEqual({
      d: Infinity,
      branch: -1,
    });
  });
});

describe("finite-solid glass-only walk", () => {
  const cases: Array<[string, Transform[], number, 3 | 4, number[]]> = [
    ["the default system", defaultTransforms(), 3, 3, [1, 0, 2, 0]],
    [
      "the Menger maps",
      mengerSponge(),
      2,
      3,
      mengerSponge().map((_, i) => (i % 7 === 0 ? 1 : 0)),
    ],
    ["the pentatope", pentatope(), 2, 4, [0, 1, 0, 2, 0]],
  ];
  for (const [name, maps, level, dimension, media] of cases) {
    it(`reproduces the glass branches' uncapped union: ${name}`, () => {
      const c = construction(maps, level, dimension);
      const rng = mulberry32(21);
      for (let i = 0; i < 40; i++) {
        const origin: Vec3 = [rng() * 6 - 3, rng() * 6 - 3, rng() * 6 - 3];
        const target: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
        const d = target.map((x, a) => x - origin[a]);
        const len = Math.hypot(...d);
        const dir = d.map((x) => x / len) as Vec3;
        const expected = finiteSolidGeneralIntervals(
          c,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          dir,
          { media },
        )
          .flatMap((interval) => [interval.enter, interval.exit])
          .filter((t) => t > 0);
        // The start claim is the glass-only point medium (an origin may sit
        // inside a glass cell); each continuation restarts from the
        // event's own anchor.
        const start = finiteSolidGeneralMediumAt(
          c,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          media,
          true,
        ).medium;
        const events: number[] = [];
        let t = 0;
        let r = finiteSolidGeneralNextBoundary(
          c,
          FINITE_SOLID_IDENTITY_POSE,
          origin,
          dir,
          { inside: start !== 0, medium: start, media, glassOnly: true },
        );
        for (let k = 0; k < 256; k++) {
          if (r.kind !== "boundary") {
            expect(r.kind).toBe("miss");
            break;
          }
          expect(r.toMedium).not.toBe(FINITE_SOLID_MEDIUM_OPAQUE);
          t += r.t;
          // A crossing between two glass materials is an interface, not a
          // union endpoint.
          if (r.fromMedium === 0 || r.toMedium === 0) events.push(t);
          r = finiteSolidGeneralNextBoundaryFromAnchor(
            c,
            FINITE_SOLID_IDENTITY_POSE,
            dir,
            {
              inside: r.toMedium !== 0,
              medium: r.toMedium,
              anchor: r.anchor,
              media,
              glassOnly: true,
            },
          );
        }
        expect(events.length).toBe(expected.length);
        events.forEach((t, k) =>
          expect(Math.abs(t - expected[k])).toBeLessThan(1e-9 * Math.max(1, t)),
        );
      }
    });
  }

  it("never reads a point as opaque, and drops the opaque branches from the display", () => {
    const maps = defaultTransforms();
    const c = construction(maps, 2, 3);
    const media = [1, 0, 1, 0];
    const rng = mulberry32(5);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
      const all = finiteSolidGeneralMediumAt(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        p,
        media,
      );
      const glass = finiteSolidGeneralMediumAt(
        c,
        FINITE_SOLID_IDENTITY_POSE,
        p,
        media,
        true,
      );
      expect(glass.medium).not.toBe(FINITE_SOLID_MEDIUM_OPAQUE);
      if (all.medium !== FINITE_SOLID_MEDIUM_OPAQUE) expect(glass).toEqual(all);
      expect(
        finiteSolidGeneralDisplayDistance(c, FINITE_SOLID_IDENTITY_POSE, p, {
          media,
        }),
      ).toBeGreaterThanOrEqual(
        finiteSolidGeneralDisplayDistance(c, FINITE_SOLID_IDENTITY_POSE, p),
      );
    }
  });
});
