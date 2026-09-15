import { mulberry32 } from "./rng";
import {
  SPHERE_INVERSION_ARRANGEMENTS,
  SPHERE_INVERSION_FOLD_DOMAIN,
  SPHERE_INVERSION_FOLD_EXHAUSTED,
  SPHERE_INVERSION_FOLD_POLE,
  resolveSphereInversion,
} from "./sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
} from "./sphere-inversion";
import {
  buildSphereInversionDE,
  estimateSphereInversionDistance,
  sphereInversionContains,
  sphereInversionHitInfo,
} from "./sphere-inversion-de";
import {
  enumerateSeedOrbit,
  explicitOrbitContains,
  explicitOrbitDistance,
  invertPoint,
  nearestPointOnPiece,
} from "./sphere-inversion-oracle";
import type { Vec3 } from "./types";

function construction(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return r.construction;
}

function randomUnit(rng: () => number): Vec3 {
  for (;;) {
    const v: Vec3 = [2 * rng() - 1, 2 * rng() - 1, 2 * rng() - 1];
    const l = Math.hypot(...v);
    if (l > 1e-3 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l];
  }
}

/** Off-set queries: half uniform in the bounding ball, half on rays toward
 * a random piece's nearest point at 1e-4..1 of the ray's length. */
function queries(
  c: SphereInversionConstruction,
  count: number,
  seed: number,
): Vec3[] {
  const de = buildSphereInversionDE(c);
  const pieces = enumerateSeedOrbit(c);
  const rng = mulberry32(seed);
  const out: Vec3[] = [];
  while (out.length < count) {
    const u = randomUnit(rng);
    const p0 = u.map((x) => x * de.boundingRadius * Math.cbrt(rng())) as Vec3;
    if (out.length % 2 === 0) {
      out.push(p0);
      continue;
    }
    const piece = pieces[Math.floor(rng() * pieces.length)];
    const near = nearestPointOnPiece(piece, p0);
    if (!near.point || near.distance === 0) continue;
    const q = near.point;
    const t = 10 ** (-4 + 4 * rng());
    out.push([0, 1, 2].map((a) => q[a] + t * (p0[a] - q[a])) as Vec3);
  }
  return out;
}

const ORACLE_FIXTURES: [string, SphereInversionAuthored][] = [
  [
    "oct6 r .70 ball .28, depth 3",
    { arrangement: "oct6", seed: { size: 0.28 }, depth: 3 },
  ],
  [
    "oct6 KISSING ball .28, depth 3",
    { arrangement: "oct6", radiusFraction: 1, depth: 3 },
  ],
  [
    "cube8 KISSING ball .41, depth 3",
    { arrangement: "cube8", radiusFraction: 1, seed: { size: 0.41 }, depth: 3 },
  ],
  [
    "ico12 near-kissing ball .47, depth 2",
    {
      arrangement: "ico12",
      radiusFraction: 0.99,
      seed: { size: 0.47 },
      depth: 2,
    },
  ],
  [
    "cube8 lace shell, depth 2",
    { arrangement: "cube8", seed: { kind: "shell" }, depth: 2 },
  ],
  [
    "oct6 generator-crossing ball 1.15, depth 2",
    {
      arrangement: "oct6",
      radiusFraction: 0.93,
      seed: { size: 1.15 },
      depth: 2,
    },
  ],
  [
    "ico12 cut-shell vault, depth 2",
    {
      arrangement: "ico12",
      radiusFraction: 0.95,
      seed: { kind: "cutShell" },
      depth: 2,
    },
  ],
];

describe("estimateSphereInversionDistance against the explicit orbit", () => {
  for (const [label, authored] of ORACLE_FIXTURES) {
    it(`${label}: never exceeds the true distance to the depth-matched orbit`, () => {
      const c = construction(authored);
      const de = buildSphereInversionDE(c);
      const pieces = enumerateSeedOrbit(c);
      let offSet = 0;
      for (const p of queries(c, 240, 0x5e7 + c.generators.length)) {
        const truth = explicitOrbitDistance(pieces, p);
        if (truth <= 0) continue;
        offSet++;
        const est = estimateSphereInversionDistance(de, p);
        expect(est, `at ${p.join(",")}`).toBeLessThanOrEqual(
          truth * (1 + 1e-9) + 1e-12,
        );
      }
      expect(offSet).toBeGreaterThan(100);
    });
  }

  it("is not vacuous: its median stride is most of the true distance", () => {
    const c = construction({ arrangement: "oct6", depth: 3 });
    const de = buildSphereInversionDE(c);
    const pieces = enumerateSeedOrbit(c);
    const ratios: number[] = [];
    for (const p of queries(c, 120, 0xabc)) {
      const truth = explicitOrbitDistance(pieces, p);
      if (truth > 0)
        ratios.push(estimateSphereInversionDistance(de, p) / truth);
    }
    ratios.sort((a, b) => a - b);
    expect(ratios[Math.floor(ratios.length / 2)]).toBeGreaterThan(0.5);
  });
});

describe("sphereInversionContains", () => {
  const fixtures: [string, SphereInversionAuthored][] = [
    [
      "cube8 kissing pearls",
      {
        arrangement: "cube8",
        radiusFraction: 1,
        seed: { size: 0.41 },
        depth: 3,
      },
    ],
    [
      "oct6 generator-crossing ball 1.15",
      {
        arrangement: "oct6",
        radiusFraction: 0.93,
        seed: { size: 1.15 },
        depth: 2,
      },
    ],
    [
      "cube8 cut shell",
      { arrangement: "cube8", seed: { kind: "cutShell" }, depth: 3 },
    ],
  ];
  for (const [label, authored] of fixtures) {
    it(`${label}: agrees with explicit membership away from boundaries`, () => {
      const c = construction(authored);
      const de = buildSphereInversionDE(c);
      const pieces = enumerateSeedOrbit(c);
      const rng = mulberry32(0x3e3);
      let members = 0;
      for (let i = 0; i < 1500; i++) {
        const p = randomUnit(rng).map(
          (x) => x * de.boundingRadius * Math.cbrt(rng()),
        ) as Vec3;
        if (Math.abs(estimateSphereInversionDistance(de, p)) < 1e-9) continue;
        const inside = explicitOrbitContains(pieces, p);
        if (inside) members++;
        expect(sphereInversionContains(de, p)).toBe(inside);
      }
      expect(members).toBeGreaterThan(5);
    });
  }
});

describe("sphere-inversion defined outcomes (3D)", () => {
  it("returns 0 at a generator centre, reports a pole, and is not a member", () => {
    const de = buildSphereInversionDE(construction({ arrangement: "oct6" }));
    const hit = sphereInversionHitInfo(de, [1, 0, 0]);
    expect(hit.d).toBe(0);
    expect(hit.status).toBe(SPHERE_INVERSION_FOLD_POLE);
    expect(sphereInversionContains(de, [1, 0, 0])).toBe(false);
  });

  it("stays positive and below the true distance just off a generator centre", () => {
    const c = construction({ arrangement: "oct6", depth: 3 });
    const de = buildSphereInversionDE(c);
    const pieces = enumerateSeedOrbit(c);
    for (const delta of [1e-3, 1e-6, 1e-9]) {
      const p: Vec3 = [1 + delta * 0.6, delta * 0.8, 0];
      const est = estimateSphereInversionDistance(de, p);
      expect(est).toBeGreaterThan(0);
      expect(est).toBeLessThanOrEqual(explicitOrbitDistance(pieces, p));
    }
  });

  it("marks a query still inside a ball when the budget runs out as EXHAUSTED, a non-member with a positive bound", () => {
    const c = construction({ arrangement: "oct6", depth: 1 });
    const de = buildSphereInversionDE(c);
    // A seed point pushed through two inversions lies in O_2, not O_1.
    const p = invertPoint(
      c.generators[0],
      invertPoint(c.generators[2], [0.05, 0.02, -0.03]),
    ) as Vec3;
    const hit = sphereInversionHitInfo(de, p);
    expect(hit.status).toBe(SPHERE_INVERSION_FOLD_EXHAUSTED);
    expect(hit.d).toBeGreaterThan(0);
    expect(sphereInversionContains(de, p)).toBe(false);
    expect(hit.d).toBeLessThanOrEqual(
      explicitOrbitDistance(enumerateSeedOrbit(c), p),
    );
  });

  it("stalls at a kissing tangency point (a cusp): estimate 0, no membership, true distance positive", () => {
    const c = construction({
      arrangement: "oct6",
      radiusFraction: 1,
      depth: 3,
    });
    const de = buildSphereInversionDE(c);
    const cusp: Vec3 = [0.5, 0.5, 0];
    expect(estimateSphereInversionDistance(de, cusp)).toBeLessThanOrEqual(
      1e-12,
    );
    expect(sphereInversionContains(de, cusp)).toBe(false);
    expect(explicitOrbitDistance(enumerateSeedOrbit(c), cusp)).toBeGreaterThan(
      0,
    );
  });

  it("refuses at build a seed sphere through a generator centre", () => {
    const c = construction({ arrangement: "oct6" });
    expect(() =>
      buildSphereInversionDE({
        ...c,
        seed: [{ center: [0, 0, 0], radius: 1, complement: false }],
      }),
    ).toThrow(/plane/);
  });

  it("refuses at build overlapping generators", () => {
    const c = construction({ arrangement: "oct6" });
    expect(() =>
      buildSphereInversionDE({
        ...c,
        generators: SPHERE_INVERSION_ARRANGEMENTS.oct6.centers.map(
          (center) => ({
            center,
            radius: 0.75,
          }),
        ),
      }),
    ).toThrow(/overlap/);
  });

  it("refuses at build a 4D construction", () => {
    expect(() =>
      buildSphereInversionDE(construction({ arrangement: "tess16" })),
    ).toThrow(/4D, estimator is 3D/);
  });

  it("stays finite for a far-field query, between the seed term and the enclosing ball's reach", () => {
    const de = buildSphereInversionDE(construction({ arrangement: "cube8" }));
    const d = estimateSphereInversionDistance(de, [1e12, 0, 0]);
    expect(d).toBeLessThanOrEqual(1e12 - 0.28);
    expect(d).toBeGreaterThanOrEqual(1e12 - de.boundingRadius);
  });

  it("returns a non-positive member signal for a seed point", () => {
    const de = buildSphereInversionDE(construction({ arrangement: "cube8" }));
    expect(
      estimateSphereInversionDistance(de, [0.1, 0, 0]),
    ).toBeLessThanOrEqual(0);
  });
});

describe("the cutoff contract", () => {
  it("returns the full value bit for bit at or above the cutoff, and a sub-cutoff value only when the full value is below it", () => {
    const c = construction({
      arrangement: "ico12",
      seed: { kind: "shell" },
      depth: 5,
    });
    const de = buildSphereInversionDE(c);
    const rng = mulberry32(0xc07);
    let exits = 0;
    for (let i = 0; i < 4000; i++) {
      const p = randomUnit(rng).map((x) => x * 1.2 * Math.cbrt(rng())) as Vec3;
      const full = estimateSphereInversionDistance(de, p);
      for (const cutoff of [1e-4, 1e-2, 0.05]) {
        const cut = estimateSphereInversionDistance(de, p, cutoff);
        if (cut >= cutoff) {
          expect(cut).toBe(full);
        } else {
          expect(full).toBeLessThan(cutoff);
          if (cut !== full) exits++;
        }
      }
    }
    expect(exits).toBeGreaterThan(0);
  });
});

describe("sphereInversionHitInfo attribution", () => {
  it("carries the plain estimate bit for bit", () => {
    const de = buildSphereInversionDE(
      construction({
        arrangement: "cube8",
        seed: { kind: "cutShell" },
        depth: 4,
      }),
    );
    const rng = mulberry32(0x417);
    for (let i = 0; i < 500; i++) {
      const p = randomUnit(rng).map((x) => x * 1.3 * rng()) as Vec3;
      expect(sphereInversionHitInfo(de, p, 0.01).d).toBe(
        estimateSphereInversionDistance(de, p, 0.01),
      );
    }
  });

  it("attributes a query beside the central pearl to seed member 0 at depth 0", () => {
    const de = buildSphereInversionDE(construction({ arrangement: "oct6" }));
    const hit = sphereInversionHitInfo(de, [0.29, 0, 0]);
    expect(hit).toMatchObject({
      status: SPHERE_INVERSION_FOLD_DOMAIN,
      depth: 0,
      foldDepth: 0,
      firstGenerator: -1,
      lastGenerator: -1,
      seedMember: 0,
    });
  });

  it("attributes a query beside a depth-2 pearl to its word's first and last generators", () => {
    const c = construction({ arrangement: "oct6", depth: 4 });
    const de = buildSphereInversionDE(c);
    const p = invertPoint(
      c.generators[4],
      invertPoint(c.generators[1], [0.285, 0, 0]),
    ) as Vec3;
    const hit = sphereInversionHitInfo(de, p);
    expect(hit).toMatchObject({
      depth: 2,
      firstGenerator: 4,
      lastGenerator: 1,
      seedMember: 0,
    });
  });

  it("attributes a generator-crossing ball's fundamental-domain wall to no seed member", () => {
    const c = construction({
      arrangement: "oct6",
      radiusFraction: 0.93,
      seed: { size: 1.15 },
      depth: 2,
    });
    const de = buildSphereInversionDE(c);
    // Just outside generator 0's sphere, on the axis, inside the crossing ball.
    const r = c.generators[0].radius;
    const hit = sphereInversionHitInfo(de, [1 - r - 1e-3, 0, 0]);
    expect(hit.d).toBeLessThanOrEqual(0);
    expect(hit.seedMember).toBe(-1);
  });

  it("attributes a query beside a shell's copy to the member it binds on", () => {
    const c = construction({
      arrangement: "cube8",
      seed: { kind: "shell" },
      depth: 3,
    });
    const de = buildSphereInversionDE(c);
    // Inside the inner sphere of the shell, near its inner wall: member 1.
    expect(sphereInversionHitInfo(de, [0.95, 0, 0]).seedMember).toBe(1);
    // Outside the outer sphere, away from generators: member 0.
    expect(sphereInversionHitInfo(de, [0, 0, 1.06]).seedMember).toBe(0);
  });
});

describe("boundingRadius", () => {
  it("encloses every explicit piece's members", () => {
    const c = construction({
      arrangement: "ico12",
      seed: { kind: "shell" },
      depth: 2,
    });
    const de = buildSphereInversionDE(c);
    const rng = mulberry32(0xb0);
    for (const piece of enumerateSeedOrbit(c)) {
      for (let i = 0; i < 4; i++) {
        const p = randomUnit(rng).map((x) => x * 2.5) as Vec3;
        const near = nearestPointOnPiece(piece, p);
        if (near.point) {
          expect(Math.hypot(...near.point)).toBeLessThanOrEqual(
            de.boundingRadius * (1 + 1e-12),
          );
        }
      }
    }
  });
});
