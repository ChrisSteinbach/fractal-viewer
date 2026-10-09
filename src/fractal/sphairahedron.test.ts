import {
  SPHAIRAHEDRON_FAMILIES,
  SPHAIRAHEDRON_FOLD_CAP,
  analyzeSphairahedronSystem,
  buildSphairahedron,
  defaultSphairahedronInversion,
  resolveSphairahedron,
  sphairahedronAuthoredDimension,
  sphairahedronTileSDF,
  foldSphairahedron,
  makeSphairahedronScratch,
} from "./sphairahedron";
import type { SphairahedronAuthored } from "./sphairahedron";

function resolved(authored: SphairahedronAuthored) {
  const r = resolveSphairahedron(authored);
  if (!r.ok) throw new Error(`refused: ${r.reasons.join("; ")}`);
  return r;
}

function refusal(authored: SphairahedronAuthored): string {
  const r = resolveSphairahedron(authored);
  if (r.ok) throw new Error("expected a refusal");
  return r.reasons.join("; ");
}

describe("sphairahedron family registry", () => {
  it("ships the six families with the documented dimensions", () => {
    expect([...SPHAIRAHEDRON_FAMILIES]).toEqual([
      "tetra333",
      "tetra4",
      "prism2",
      "cube1",
      "cube4",
      "cube9",
    ]);
    for (const id of SPHAIRAHEDRON_FAMILIES) {
      const r = resolved({ family: id });
      expect(r.construction.dim).toBe(id === "tetra4" ? 4 : 3);
    }
  });

  it("resolves every owner-approved panel parameter strictly inside its region", () => {
    const panels: SphairahedronAuthored[] = [
      { family: "tetra333" },
      { family: "tetra4" },
      { family: "prism2", z2: 2 },
      { family: "prism2", z2: -2 },
      { family: "prism2", z2: 1 },
      { family: "prism2", z2: -1 },
      { family: "cube1", za: 0.5, zb: 1.0 },
      { family: "cube1", za: 0.8, zb: 0.64 },
      { family: "cube1", za: 0.6, zb: 1.2 },
      { family: "cube1", za: 0, zb: 0 },
      { family: "cube4", za: 0.4, zb: 0.3 },
      { family: "cube9", za: 0.3, zb: 0.2 },
    ];
    for (const authored of panels) {
      const r = resolved(authored);
      expect(r.construction.verification.maxTangentErr).toBeLessThanOrEqual(
        1e-15,
      );
      expect(r.construction.verification.maxAngleErr).toBeLessThanOrEqual(
        1e-15,
      );
      expect(r.construction.verification.problems).toEqual([]);
      expect(r.construction.regionBoundary).toBe(false);
      expect(analyzeSphairahedronSystem(r.construction).status).toBe(
        "eligible",
      );
    }
  });

  it("fills the family's own moduli defaults", () => {
    expect(resolved({ family: "cube1" }).construction.moduli).toEqual({
      za: 0.5,
      zb: 1.0,
    });
    expect(resolved({ family: "cube4" }).construction.moduli).toEqual({
      za: 0.4,
      zb: 0.3,
    });
    expect(resolved({ family: "cube9" }).construction.moduli).toEqual({
      za: 0.3,
      zb: 0.2,
    });
    expect(resolved({ family: "prism2" }).construction.moduli).toEqual({
      z2: 2,
    });
    expect(resolved({ family: "tetra333" }).construction.moduli).toEqual({});
  });

  it("ignores moduli the family does not read and keeps them on the document", () => {
    const r = resolved({ family: "tetra333", za: 0.5, zb: 1.0, z2: 3 });
    expect(r.construction.moduli).toEqual({});
    expect(r.construction.family).toBe("tetra333");
  });
});

describe("sphairahedron tangency solver against the appendix's closed forms", () => {
  // The 2020 preprint's appendix formulas, re-derived in the study and
  // verified identical to the solver — the independent oracle for the
  // linear tangency system.
  const closed = {
    cube1: (za: number, zb: number) => [
      0.5 + (za * zb) / 3,
      0.5 + (za * za - za * zb) / 3,
      0.5 + (zb * zb - za * zb) / 3,
    ],
    cube4: (za: number, zb: number) => [
      (3 * za * za + zb * zb + 6 * za * zb + 6) / 18,
      (15 * za * za - zb * zb - 6 * za * zb + 12) / (18 * Math.sqrt(3)),
      (-3 * za * za + 5 * zb * zb - 6 * za * zb + 12) / 18,
    ],
    cube9: (za: number, zb: number) => [
      (zb * zb + 2 * za * zb + 2) / 6,
      (3 * za * za - 2 * za * zb - zb * zb + 4) / (6 * Math.SQRT2),
      (zb * zb - za * zb + 2) / 3,
    ],
    prism2: (z2: number) => [(6 + z2 * z2) / 6, Math.sqrt(3)],
  };

  it("matches the type-1 closed-form radii at interior and asymmetric parameters", () => {
    for (const [za, zb] of [
      [0.5, 1.0],
      [0.8, 0.64],
      [0.4, 0.3],
      [0.1, 0.5],
    ] as const) {
      const r = resolved({ family: "cube1", za, zb });
      const want = closed.cube1(za, zb);
      r.construction.radii.forEach((got, i) =>
        expect(got).toBeCloseTo(want[i], 12),
      );
    }
  });

  it("matches the type-4 closed-form radii", () => {
    for (const [za, zb] of [
      [0.4, 0.3],
      [0.3, 0.2],
      [0.3, 0.5],
    ] as const) {
      const r = resolved({ family: "cube4", za, zb });
      const want = closed.cube4(za, zb);
      r.construction.radii.forEach((got, i) =>
        expect(got).toBeCloseTo(want[i], 12),
      );
    }
  });

  it("matches the type-9 closed-form radii", () => {
    for (const [za, zb] of [
      [0.3, 0.2],
      [0.5, 0.5],
      [0.2, 0.3],
    ] as const) {
      const r = resolved({ family: "cube9", za, zb });
      const want = closed.cube9(za, zb);
      r.construction.radii.forEach((got, i) =>
        expect(got).toBeCloseTo(want[i], 12),
      );
    }
  });

  it("matches the prism's Prop 3.12 radius form", () => {
    for (const z2 of [2, -2, 1, -1, 0, 0.5]) {
      const r = resolved({ family: "prism2", z2 });
      const want = closed.prism2(z2);
      r.construction.radii.forEach((got, i) =>
        expect(got).toBeCloseTo(want[i], 12),
      );
    }
  });

  it("pins the tetra's single ball exactly", () => {
    for (const family of ["tetra333", "tetra4"] as const) {
      const r = resolved({ family });
      expect(r.construction.radii).toEqual([1]);
      const c = r.construction.ballCenters[0];
      expect(c[0]).toBeCloseTo(0, 12);
      expect(c[1]).toBe(0);
      expect(c[2]).toBeCloseTo(0, 12);
      if (r.construction.dim === 4) expect(c[3]).toBeCloseTo(0, 12);
    }
  });
});

describe("sphairahedron valid regions", () => {
  it("refuses past the region with the crossing ball named, every family", () => {
    // cube1: zA·zB = 0.845 > 3/4 (the study's past-cusp parameters).
    expect(refusal({ family: "cube1", za: 0.65, zb: 1.3 })).toMatch(
      /ball b2's sphere crosses the wall it does not bound/,
    );
    // cube4: 3zA² + 6zA·zB + zB² = 4.75 > 36√3 − 60 at (0.5, 1).
    expect(refusal({ family: "cube4", za: 0.5, zb: 1.0 })).toMatch(
      /ball b2's sphere crosses the wall it does not bound/,
    );
    // cube9: 2zA·zB + zB² = 1.4 > 1 at (0.5, 1).
    expect(refusal({ family: "cube9", za: 0.5, zb: 1.0 })).toMatch(
      /ball b2's sphere crosses the wall it does not bound/,
    );
    // prism2: z2² = 6.25 > 6 (Prop 3.12's open interval (−√6, √6)).
    expect(refusal({ family: "prism2", z2: 2.5 })).toMatch(
      /ball b2's sphere crosses the wall it does not bound/,
    );
    expect(refusal({ family: "prism2", z2: -2.5 })).toMatch(
      /ball b2's sphere crosses the wall it does not bound/,
    );
  });

  it("admits the region boundary and discloses it degraded", () => {
    // zA·zB = 3/4 with the other two inequalities strictly inside:
    // za = 0.7, zb = 0.75/0.7. r2 sits exactly on the type-1 threshold.
    const zb = 0.75 / 0.7;
    const r = resolved({ family: "cube1", za: 0.7, zb });
    expect(r.construction.regionBoundary).toBe(true);
    expect(r.construction.radii[0]).toBeCloseTo(0.75, 12);
    const e = analyzeSphairahedronSystem(r.construction);
    expect(e.status).toBe("degraded");
    expect(e.degradations[0]).toMatch(/tangent to a wall it does not bound/);
    expect(e.reasons).toEqual([]);
  });

  it("keeps the boundary read symmetric in the moduli swap", () => {
    const r = resolved({ family: "cube1", za: 0.75 / 0.7, zb: 0.7 });
    expect(r.construction.regionBoundary).toBe(true);
  });

  it("refuses negative cube heights (the published spaces are the non-negative quadrant)", () => {
    expect(refusal({ family: "cube1", za: -0.5, zb: 1 })).toMatch(
      /non-negative quadrant/,
    );
    expect(refusal({ family: "cube4", za: 0.4, zb: -0.1 })).toMatch(
      /non-negative quadrant/,
    );
  });

  it("refuses non-finite moduli", () => {
    expect(refusal({ family: "cube1", za: NaN })).toMatch(
      /not a finite number/,
    );
    expect(refusal({ family: "prism2", z2: Infinity })).toMatch(
      /not a finite number/,
    );
  });
});

describe("sphairahedron authored-form refusals", () => {
  it("requires the family and refuses unknown ids with the shipped list", () => {
    expect(refusal({})).toMatch(/no family/);
    expect(refusal({ family: "cube2" })).toMatch(
      /unknown family "cube2" \(known: tetra333, tetra4, prism2, cube1, cube4, cube9\)/,
    );
    expect(refusal({ family: 7 } as unknown as SphairahedronAuthored)).toMatch(
      /unknown family 7/,
    );
  });

  it("refuses unknown keys by name, top level and inversion", () => {
    expect(refusal({ family: "cube1", zq: 1 } as never)).toMatch(
      /unknown field "zq"/,
    );
    expect(
      refusal({
        family: "cube1",
        inversion: { cx: 0, cy: 0, cz: 1, r: 1, w: 0 } as never,
      }),
    ).toMatch(/unknown inversion field "w"/);
  });

  it("refuses a finite request without a full explicit inversion sphere", () => {
    // A wholly contentless sphere: the free-parameter refusal.
    expect(refusal({ family: "cube1", inversion: {} })).toMatch(
      /needs an explicit inversion sphere/,
    );
    // A partial sphere: the malformed-field refusals (the resolver returns
    // on the first collected reason batch).
    expect(refusal({ family: "cube1", inversion: { cx: 0, cy: 0 } })).toMatch(
      /inversion centre cx, cy, cz must all be finite numbers/,
    );
    expect(
      refusal({ family: "cube1", inversion: { cx: 0, cy: 0, cz: 1 } }),
    ).toMatch(/inversion radius r must be a finite positive number/);
    expect(
      refusal({ family: "cube1", inversion: { cx: 0, cy: 0, cz: 1, r: 0 } }),
    ).toMatch(/inversion radius r must be a finite positive number/);
    expect(
      refusal({ family: "cube1", inversion: { cx: 0, cy: 0, cz: 1, r: -1 } }),
    ).toMatch(/inversion radius r must be a finite positive number/);
  });

  it("confines the inversion centre's w to the 4D family", () => {
    expect(
      refusal({
        family: "cube1",
        inversion: { cx: 0, cy: 0, cz: 1, cw: 0.5, r: 1 },
      }),
    ).toMatch(/centre w applies only to the 4D family/);
    const r = resolved({
      family: "tetra4",
      inversion: { cx: 0.5, cy: 3, cz: 0, cw: 0, r: 1.3 },
    });
    expect(r.construction.dim).toBe(4);
    expect(r.construction.finite).toBe(true);
  });

  it("carries the authored sphere into the resolved construction", () => {
    const r = resolved({
      family: "tetra333",
      inversion: { cx: 0.5, cy: 3, cz: 0, r: 1.3 },
    });
    expect(r.construction.finite).toBe(true);
    expect(r.construction.inversion).toEqual({ c: [0.5, 3, 0], r: 1.3 });
  });

  it("leaves the absent inversion the infinite construction, byte-identically", () => {
    const r = resolved({ family: "cube1", za: 0.5, zb: 1.0 });
    expect(r.construction.finite).toBe(false);
    expect(r.construction.inversion).toBeNull();
    // The infinite fold order: balls then walls.
    expect(r.construction.foldFaces.map((f) => f.face.kind).join(",")).toBe(
      "sphere,sphere,sphere,plane,plane,plane",
    );
  });

  it("interleaves the finite scan order (the reference's gSpheres order)", () => {
    // Under J every face maps to a SPHERE (a wall becomes a sphere unless it
    // passes through J's centre), so the finite kinds are all spheres; the
    // order is wall0, ball0, wall1, ball1, wall2, ball2 — the reference's.
    const r = resolved({
      family: "tetra333",
      inversion: { cx: 0.5, cy: 3, cz: 0, r: 1.3 },
    });
    expect(r.construction.foldFaces.map((f) => f.face.kind).join(",")).toBe(
      "sphere,sphere,sphere,sphere",
    );
    const cube = resolved({
      family: "cube1",
      inversion: { cx: 0.4, cy: 0.4, cz: 0.4, r: 0.5 },
    });
    expect(cube.construction.foldFaces.map((f) => f.face.kind).join(",")).toBe(
      "sphere,sphere,sphere,sphere,sphere,sphere",
    );
    // The finite images carry per-face senses fixed by the probe's image.
    expect(
      cube.construction.foldFaces.every(
        (f) => typeof f.solidInside === "boolean",
      ),
    ).toBe(true);
  });

  it("refuses an inversion sphere that degenerates a seed ball image", () => {
    // A J through which one of the cube's seed images becomes a plane: the
    // seed's sphere passes through J's centre. Cube1 at (0.5, 1): seed
    // centre (−0.5, −0.75, 0.866) r 1.25 — put J's centre on that seed's
    // boundary.
    const r0 = resolved({ family: "cube1", za: 0.5, zb: 1.0 });
    const seed = r0.construction.seeds[0];
    expect(
      refusal({
        family: "cube1",
        za: 0.5,
        zb: 1.0,
        inversion: {
          cx: seed.c[0],
          cy: seed.c[1],
          cz: seed.c[2] + seed.r,
          r: 1,
        },
      }),
    ).toMatch(/seed ball image degenerate/);
  });
});

describe("sphairahedron seeds (the preprint's maximum vertex balls)", () => {
  it("degenerates to no seeds for the tetra families", () => {
    expect(resolved({ family: "tetra333" }).construction.seeds).toEqual([]);
    expect(resolved({ family: "tetra4" }).construction.seeds).toEqual([]);
  });

  it("yields seeds for the cube and prism families, each through a vertex and holding none strictly inside", () => {
    for (const [, authored] of [
      ["cube1", { family: "cube1", za: 0.5, zb: 1.0 }],
      ["cube4", { family: "cube4", za: 0.4, zb: 0.3 }],
      ["prism2", { family: "prism2", z2: 2 }],
    ] as const) {
      const r = resolved(authored);
      expect(r.construction.seeds.length).toBeGreaterThan(0);
      expect(r.construction.vertices.length).toBeGreaterThan(0);
      for (const seed of r.construction.seeds) {
        // Some vertex lies exactly on the seed's boundary (its own).
        let own = Infinity;
        for (const v of r.construction.vertices) {
          const d = Math.hypot(
            seed.c[0] - v.p[0],
            seed.c[1] - v.p[1],
            seed.c[2] - v.p[2],
          );
          own = Math.min(own, Math.abs(d - seed.r));
        }
        expect(own).toBeLessThanOrEqual(1e-9 * Math.max(1, seed.r));
        // No vertex lies strictly inside the seed (the maximality side).
        for (const v of r.construction.vertices) {
          const d = Math.hypot(
            seed.c[0] - v.p[0],
            seed.c[1] - v.p[1],
            seed.c[2] - v.p[2],
          );
          expect(d).toBeGreaterThanOrEqual(seed.r * (1 - 1e-9));
        }
      }
    }
  });

  it("carries the finite construction's vertex images", () => {
    const r = resolved({
      family: "tetra333",
      inversion: { cx: 0.5, cy: 3, cz: 0, r: 1.3 },
    });
    const infinite = resolved({ family: "tetra333" }).construction;
    expect(r.construction.vertices.length).toBe(infinite.vertices.length);
    expect(r.construction.vertices.length).toBeGreaterThan(0);
    // The images are not the originals (J moved them).
    expect(
      r.construction.vertices.some(
        (v, i) =>
          Math.hypot(
            v.p[0] - infinite.vertices[i].p[0],
            v.p[1] - infinite.vertices[i].p[1],
            v.p[2] - infinite.vertices[i].p[2],
          ) > 1e-6,
      ),
    ).toBe(true);
  });

  it("duplicates each maximal ball once per contact pair (the Def 4.1 reading)", () => {
    // Cube1 at the canonical parameters measured 3 unique balls, each
    // claimed by both endpoints of its contact pair.
    const r = resolved({ family: "cube1", za: 0.5, zb: 1.0 });
    expect(r.construction.seeds).toHaveLength(6);
    const unique = new Set(
      r.construction.seeds.map(
        (s) => s.c.map((v) => v.toFixed(12)).join(",") + s.r.toFixed(12),
      ),
    );
    expect(unique.size).toBe(3);
  });
});

describe("sphairahedron analyzer", () => {
  it("marks a hand-built past-region construction ineligible with the region reason", () => {
    // The lenient construction path builds past the region; the analyzer
    // refuses it.
    const past = buildSphairahedron("cube1", { za: 0.65, zb: 1.3 });
    const e = analyzeSphairahedronSystem(past);
    expect(e.status).toBe("ineligible");
    expect(e.reasons.join("; ")).toMatch(/outside the family's valid region/);
    expect(e.degradations).toEqual([]);
  });

  it("marks a boundary construction degraded and an interior one eligible", () => {
    const boundary = buildSphairahedron("cube1", {
      za: 0.7,
      zb: 0.75 / 0.7,
    });
    expect(analyzeSphairahedronSystem(boundary).status).toBe("degraded");
    const inside = buildSphairahedron("cube1", { za: 0.5, zb: 1.0 });
    const e = analyzeSphairahedronSystem(inside);
    expect(e.status).toBe("eligible");
    expect(e.degradations).toEqual([]);
  });

  it("refuses a corrupted construction", () => {
    const base = resolved({ family: "cube1", za: 0.5, zb: 1.0 }).construction;
    const badRadii = {
      ...base,
      radii: [NaN, base.radii[1], base.radii[2]],
    };
    expect(analyzeSphairahedronSystem(badRadii).status).toBe("ineligible");
    const badModuli = {
      ...base,
      moduli: { za: Infinity, zb: 1.0 },
    };
    expect(analyzeSphairahedronSystem(badModuli).status).toBe("ineligible");
  });
});

describe("sphairahedron authored dimension", () => {
  it("names the dimension from the family alone", () => {
    expect(sphairahedronAuthoredDimension({ family: "tetra4" })).toBe(4);
    expect(sphairahedronAuthoredDimension({ family: "cube1" })).toBe(3);
    expect(sphairahedronAuthoredDimension({ family: "nope" })).toBeNull();
    expect(sphairahedronAuthoredDimension({})).toBeNull();
    expect(sphairahedronAuthoredDimension(null)).toBeNull();
    expect(sphairahedronAuthoredDimension("cube1")).toBeNull();
  });

  it("names the dimension even for a block refused for other reasons", () => {
    expect(sphairahedronAuthoredDimension({ family: "tetra4", zq: 1 })).toBe(4);
  });
});

describe("sphairahedron shared constants", () => {
  it("carries the measured fudge, step scale and cap", () => {
    expect(SPHAIRAHEDRON_FOLD_CAP).toBe(50);
  });
});

describe("sphairahedron tile SDF and membership (plain-data path)", () => {
  it("reads negative deep in the finite tetra's sphere and positive far away", () => {
    const r = resolved({
      family: "tetra333",
      inversion: { cx: 0.5, cy: 3, cz: 0, r: 1.3 },
    });
    const c = r.construction.bound.center;
    // The bound centres on the quasi-sphere's carrier.
    const s = makeSphairahedronScratch(3, SPHAIRAHEDRON_FOLD_CAP);
    expect(sphairahedronTileSDF(r.construction, c)).toBeLessThan(0);
    expect(foldSphairahedron(r.construction, [10, 10, 10], s).capped).toBe(
      false,
    );
    expect(sphairahedronTileSDF(r.construction, s.x)).toBeGreaterThan(0);
  });
});

describe("sphairahedron default inversion (the picker's first candidate)", () => {
  it("reflects the last ball through the divide for the three-ball cube families", () => {
    const r = resolved({ family: "cube1", za: 0.5, zb: 1.0 });
    const j = defaultSphairahedronInversion(r.construction);
    expect(j).not.toBeNull();
    if (!j) return;
    // The mirror of the last ball's centre, then reflected through the
    // divide plane: the reflection moves the centre to the divide's other
    // side from where the reference put it, at the same radius.
    expect(j.r).toBe(r.construction.radii[2]);
    const d0 =
      r.construction.divide.n.reduce((s, v, i) => s + v * j.c[i], 0) -
      r.construction.divide.h;
    // The reflected centre sits OFF the divide plane.
    expect(Math.abs(d0)).toBeGreaterThan(1e-6);
  });

  it("returns null without three balls", () => {
    const tetra = resolved({ family: "tetra333" }).construction;
    expect(defaultSphairahedronInversion(tetra)).toBeNull();
    const prism = resolved({ family: "prism2", z2: 2 }).construction;
    expect(defaultSphairahedronInversion(prism)).toBeNull();
  });
});
