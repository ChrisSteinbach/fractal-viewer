import { mulberry32 } from "./rng";
import {
  SPHERE_INVERSION_ARRANGEMENTS,
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
  sphereInversionSignedDistance,
} from "./sphere-inversion-de";
import {
  buildSphereInversionDE4,
  estimateSphereInversionDistance4,
  sphereInversionContains4,
  sphereInversionHitInfo4,
  sphereInversionSignedDistance4,
  sphereInversionSignedNormal4,
} from "./sphere-inversion-de-4d";
import {
  enumerateSeedOrbit,
  explicitOrbitClearance,
  explicitOrbitDistance,
  invertPoint,
  nearestPointOnPiece,
} from "./sphere-inversion-oracle";
import type { Vec3, Vec4 } from "./types";

function construction(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return r.construction;
}

function randomUnit4(rng: () => number): Vec4 {
  for (;;) {
    const v: Vec4 = [0, 0, 0, 0].map(() => 2 * rng() - 1) as Vec4;
    const l = Math.hypot(...v);
    if (l > 1e-3 && l <= 1) return v.map((x) => x / l) as Vec4;
  }
}

/** The app's rotor/slice lift for a single xw-plane rotation. */
function liftXW(p: Vec3, angle: number, w0: number): Vec4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * p[0] - s * w0, p[1], p[2], s * p[0] + c * w0];
}

/** Off-set 4D queries: half uniform in the bounding ball, half on rays
 * toward a random piece's nearest point. */
function queries4(
  c: SphereInversionConstruction,
  count: number,
  seed: number,
): Vec4[] {
  const de = buildSphereInversionDE4(c);
  const pieces = enumerateSeedOrbit(c);
  const rng = mulberry32(seed);
  const out: Vec4[] = [];
  while (out.length < count) {
    const p0 = randomUnit4(rng).map(
      (x) => x * de.boundingRadius * Math.sqrt(Math.sqrt(rng())),
    ) as Vec4;
    if (out.length % 2 === 0) {
      out.push(p0);
      continue;
    }
    const near = nearestPointOnPiece(
      pieces[Math.floor(rng() * pieces.length)],
      p0,
    );
    if (!near.point || near.distance === 0) continue;
    const q = near.point;
    const t = 10 ** (-4 + 4 * rng());
    out.push([0, 1, 2, 3].map((a) => q[a] + t * (p0[a] - q[a])) as Vec4);
  }
  return out;
}

function expectNeverAboveTruth(c: SphereInversionConstruction, qs: Vec4[]) {
  const de = buildSphereInversionDE4(c);
  const pieces = enumerateSeedOrbit(c);
  let offSet = 0;
  for (const p of qs) {
    const truth = explicitOrbitDistance(pieces, p);
    if (truth <= 0) continue;
    offSet++;
    expect(
      estimateSphereInversionDistance4(de, p),
      `at ${p.join(",")}`,
    ).toBeLessThanOrEqual(truth * (1 + 1e-9) + 1e-12);
  }
  return offSet;
}

describe("estimateSphereInversionDistance4 against the explicit orbit", () => {
  it("tess16 KISSING ball .5, depth 2: never exceeds the true distance", () => {
    const c = construction({
      arrangement: "tess16",
      radiusFraction: 1,
      seed: { size: 0.5 },
      depth: 2,
    });
    expect(expectNeverAboveTruth(c, queries4(c, 160, 0x7e5))).toBeGreaterThan(
      60,
    );
  });

  it("cross8 KISSING ball .28, depth 3: never exceeds the true distance", () => {
    const c = construction({
      arrangement: "cross8",
      radiusFraction: 1,
      seed: { size: 0.28 },
      depth: 3,
    });
    expect(expectNeverAboveTruth(c, queries4(c, 160, 0xc58))).toBeGreaterThan(
      60,
    );
  });

  it("cell24 perforated shell, depth 2: never exceeds the true distance", () => {
    const c = construction({
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 2,
    });
    expect(expectNeverAboveTruth(c, queries4(c, 80, 0xc24))).toBeGreaterThan(
      30,
    );
  });

  it("cell24 shell on the xw .3, w0 .15 slice: never exceeds the true distance at lifted view points", () => {
    const c = construction({
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 2,
    });
    const rng = mulberry32(0x511c);
    const qs: Vec4[] = [];
    for (let i = 0; i < 80; i++) {
      const p: Vec3 = [0, 1, 2].map(() => 2.4 * rng() - 1.2) as Vec3;
      qs.push(liftXW(p, 0.3, 0.15));
    }
    expect(expectNeverAboveTruth(c, qs)).toBeGreaterThan(30);
  });

  // The 600-cell's 120 generators make the depth-2 oracle cost ~170 ms per
  // query (14,401 pieces), so the unit tests pin depth 1 (121 pieces) with
  // the usual half-targeted queries; the increased-depth sheet carries D2.
  it("600-cell pearl-window vault, depth 1: never exceeds the true distance", () => {
    const c = construction({
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 1,
    });
    expect(expectNeverAboveTruth(c, queries4(c, 120, 0x600a))).toBeGreaterThan(
      40,
    );
  });

  it("600-cell medallion sphere, depth 1: never exceeds the true distance, including just off the medallions' rims", () => {
    const c = construction({
      arrangement: "cell600",
      seed: { kind: "shell", size: 1.1, thickness: 0.03 },
      depth: 1,
    });
    // Targeted: on the outer shell sphere beside a generator whose ball the
    // shell crosses, where a depth-1 copy (the medallion) meets the wall.
    const rng = mulberry32(0x600b);
    const targeted: Vec4[] = [];
    for (let i = 0; i < 60; i++) {
      const g = c.generators[Math.floor(rng() * c.generators.length)];
      const u = randomUnit4(rng);
      const p = g.center.map((x, a) => x + g.radius * 1.02 * u[a]);
      const l = Math.hypot(...p);
      targeted.push(p.map((x) => (x / l) * (1.13 + 1e-3 * rng())) as Vec4);
    }
    expect(
      expectNeverAboveTruth(c, [...queries4(c, 80, 0x600c), ...targeted]),
    ).toBeGreaterThan(60);
  });

  it("tess16 cut shell with a w-tilted cut, depth 1: never exceeds the true distance", () => {
    const c = construction({
      arrangement: "tess16",
      radiusFraction: 0.95,
      seed: {
        kind: "cutShell",
        cutDirection: [0.2, 1, 0],
        cutDirectionW: 0.7,
      },
      depth: 1,
    });
    expect(expectNeverAboveTruth(c, queries4(c, 160, 0x7c7))).toBeGreaterThan(
      60,
    );
  });
});

describe("the flat embedding reduces to the 3D estimator", () => {
  const flat: SphereInversionConstruction = {
    dim: 4,
    generators: SPHERE_INVERSION_ARRANGEMENTS.oct6.centers.map((c) => ({
      center: [...c, 0],
      radius: 0.7,
    })),
    seed: [{ center: [0, 0, 0, 0], radius: 0.28, complement: false }],
    depth: 8,
  };
  const threeD: SphereInversionConstruction = {
    dim: 3,
    generators: SPHERE_INVERSION_ARRANGEMENTS.oct6.centers.map((c) => ({
      center: [...c],
      radius: 0.7,
    })),
    seed: [{ center: [0, 0, 0], radius: 0.28, complement: false }],
    depth: 8,
  };

  /** Uniform points plus a lattice through walls and centres. */
  function points(): Vec3[] {
    const rng = mulberry32(0xf1a7);
    const out: Vec3[] = [];
    for (let i = 0; i < 6000; i++) {
      out.push([0, 1, 2].map(() => 3.4 * rng() - 1.7) as Vec3);
    }
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 16; j++) {
        for (let k = 0; k <= 16; k++) {
          out.push([i / 8 - 1, j / 8 - 1, k / 8 - 1]);
        }
      }
    }
    return out;
  }

  it("matches the 3D estimate BIT FOR BIT at w = 0", () => {
    const de3 = buildSphereInversionDE(threeD);
    const de4 = buildSphereInversionDE4(flat);
    for (const p of points()) {
      expect(estimateSphereInversionDistance4(de4, [...p, 0] as Vec4)).toBe(
        estimateSphereInversionDistance(de3, p),
      );
    }
  });

  it("matches the 3D SIGNED field bit for bit at w = 0", () => {
    // The interior half has to carry the flat reduction too, or a 4D scene
    // that is a lift of a 3D one would render a different optical solid.
    const de3 = buildSphereInversionDE(threeD);
    const de4 = buildSphereInversionDE4(flat);
    let interior = 0;
    for (const p of points()) {
      const f3 = sphereInversionSignedDistance(de3, p);
      if (f3 < 0) interior++;
      expect(sphereInversionSignedDistance4(de4, [...p, 0] as Vec4)).toBe(f3);
    }
    expect(interior).toBeGreaterThan(50);
  });

  it("matches 3D membership and attribution at w = 0", () => {
    const de3 = buildSphereInversionDE(threeD);
    const de4 = buildSphereInversionDE4(flat);
    for (const p of points().slice(0, 3000)) {
      const q = [...p, 0] as Vec4;
      expect(sphereInversionContains4(de4, q)).toBe(
        sphereInversionContains(de3, p),
      );
      expect({ ...sphereInversionHitInfo4(de4, q, 0.01) }).toEqual({
        ...sphereInversionHitInfo(de3, p, 0.01),
      });
    }
  });
});

describe("a genuinely non-flat 4D fixture", () => {
  it("tess16 at w0 .3 holds depth >= 1 copies although no generator centre lies in that hyperplane, so no in-slice 3D sub-arrangement exists and the only 3D reduction is the bare seed slice", () => {
    const c = construction({
      arrangement: "tess16",
      radiusFraction: 1,
      seed: { size: 0.5 },
      depth: 7,
    });
    expect(c.generators.every((g) => g.center[3] !== 0.3)).toBe(true);
    const de = buildSphereInversionDE4(c);
    const seedSliceRadius = Math.sqrt(0.25 - 0.09);
    const rng = mulberry32(0x7e55);
    let newCopies = 0;
    for (let i = 0; i < 20000; i++) {
      const p: Vec3 = [0, 1, 2].map(() => 2 * rng() - 1) as Vec3;
      const q: Vec4 = [...p, 0.3];
      const hit = sphereInversionHitInfo4(de, q);
      if (hit.d <= 0 && hit.foldDepth >= 1) {
        newCopies++;
        expect(Math.hypot(...p)).toBeGreaterThan(seedSliceRadius);
      }
    }
    expect(newCopies).toBeGreaterThan(50);
  });

  it("cell24 shell membership changes under an xw rotation, and the rotated slice is not its in-hyperplane 3D sub-arrangement", () => {
    const c = construction({
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 5,
    });
    const de = buildSphereInversionDE4(c);
    // Centres inside the xw-rotated hyperplane at w0 = 0 have x = w = 0.
    const inPlane = c.generators.filter(
      (g) => g.center[0] === 0 && g.center[3] === 0,
    );
    expect(inPlane).toHaveLength(4);
    const de3 = buildSphereInversionDE({
      dim: 3,
      generators: inPlane.map((g) => ({
        center: [g.center[0], g.center[1], g.center[2]],
        radius: g.radius,
      })),
      seed: [
        { center: [0, 0, 0], radius: 1.03, complement: false },
        { center: [0, 0, 0], radius: 0.97, complement: true },
      ],
      depth: 5,
    });
    const rng = mulberry32(0xce11);
    let rotorChanges = 0;
    let notReduction = 0;
    for (let i = 0; i < 20000; i++) {
      const p: Vec3 = [0, 1, 2].map(() => 2.2 * rng() - 1.1) as Vec3;
      const posed = sphereInversionContains4(de, liftXW(p, 0.3, 0));
      if (posed !== sphereInversionContains4(de, [...p, 0])) rotorChanges++;
      if (posed !== sphereInversionContains(de3, p)) notReduction++;
    }
    expect(rotorChanges).toBeGreaterThan(200);
    expect(notReduction).toBeGreaterThan(200);
  });

  it("cell24 shell estimates change under an offset slice at fixed view points", () => {
    const c = construction({
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 5,
    });
    const de = buildSphereInversionDE4(c);
    const rng = mulberry32(0x0ff5);
    let changed = 0;
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [0, 1, 2].map(() => 2 * rng() - 1) as Vec3;
      const at0 = estimateSphereInversionDistance4(de, [...p, 0]);
      const at3 = estimateSphereInversionDistance4(de, [...p, 0.3]);
      if (Math.abs(at0 - at3) > 1e-6) changed++;
    }
    expect(changed).toBeGreaterThan(400);
  });
});

describe("sphere-inversion defined outcomes (4D)", () => {
  it("returns 0 at a hypersphere centre, reports a pole, and is not a member", () => {
    const de = buildSphereInversionDE4(construction({ arrangement: "tess16" }));
    const centre: Vec4 = [0.5, -0.5, 0.5, -0.5];
    const hit = sphereInversionHitInfo4(de, centre);
    expect(hit.d).toBe(0);
    expect(hit.status).toBe(SPHERE_INVERSION_FOLD_POLE);
    expect(sphereInversionContains4(de, centre)).toBe(false);
  });

  it("marks a query still inside a hypersphere when the budget runs out as EXHAUSTED, a non-member with a positive bound", () => {
    const c = construction({ arrangement: "cross8", depth: 1 });
    const de = buildSphereInversionDE4(c);
    const p = invertPoint(
      c.generators[6],
      invertPoint(c.generators[1], [0.05, 0.02, -0.03, 0.04]),
    ) as Vec4;
    const hit = sphereInversionHitInfo4(de, p);
    expect(hit.status).toBe(SPHERE_INVERSION_FOLD_EXHAUSTED);
    expect(hit.d).toBeGreaterThan(0);
    expect(sphereInversionContains4(de, p)).toBe(false);
    expect(hit.d).toBeLessThanOrEqual(
      explicitOrbitDistance(enumerateSeedOrbit(c), p),
    );
  });

  it("stalls at a tess16 tangency point (a cusp): estimate 0, no membership, true distance positive", () => {
    const c = construction({
      arrangement: "tess16",
      radiusFraction: 1,
      seed: { size: 0.5 },
      depth: 2,
    });
    const de = buildSphereInversionDE4(c);
    const cusp: Vec4 = [0, 0.5, 0.5, 0.5];
    expect(estimateSphereInversionDistance4(de, cusp)).toBeLessThanOrEqual(
      1e-12,
    );
    expect(sphereInversionContains4(de, cusp)).toBe(false);
    expect(explicitOrbitDistance(enumerateSeedOrbit(c), cusp)).toBeGreaterThan(
      0,
    );
  });

  it("refuses at build a seed hypersphere through a generator centre", () => {
    const c = construction({ arrangement: "cross8" });
    expect(() =>
      buildSphereInversionDE4({
        ...c,
        seed: [{ center: [0, 0, 0, 0], radius: 1, complement: false }],
      }),
    ).toThrow(/plane/);
  });

  it("refuses at build overlapping hyperspheres", () => {
    const c = construction({ arrangement: "tess16" });
    expect(() =>
      buildSphereInversionDE4({
        ...c,
        generators: c.generators.map((g) => ({ ...g, radius: 0.52 })),
      }),
    ).toThrow(/overlap/);
  });

  it("refuses at build a 3D construction", () => {
    expect(() =>
      buildSphereInversionDE4(construction({ arrangement: "oct6" })),
    ).toThrow(/3D, estimator is 4D/);
  });
});

describe("the refused slab", () => {
  it("shows why d(centre) − h is not a slab estimator: it accepts a point h/2 outside the slab's projected shadow", () => {
    // Depth 0: the orbit is the 4-ball seed, whose shadow over |w| <= h is
    // the 3-ball of radius ρ, so (ρ + h/2, 0, 0) lies h/2 outside it.
    const de = buildSphereInversionDE4({
      dim: 4,
      generators: SPHERE_INVERSION_ARRANGEMENTS.cross8.centers.map((c) => ({
        center: c,
        radius: 0.6,
      })),
      seed: [{ center: [0, 0, 0, 0], radius: 0.28, complement: false }],
      depth: 0,
    });
    const h = 0.02;
    const p: Vec3 = [0.28 + h / 2, 0, 0];
    for (let t = -h; t <= h; t += h / 50) {
      expect(sphereInversionContains4(de, [...p, t])).toBe(false);
    }
    expect(sphereInversionContains4(de, [0.28, 0, 0, 0])).toBe(true);
    const trivial = estimateSphereInversionDistance4(de, [...p, 0]) - h;
    expect(trivial).toBeLessThan(0);
  });
});

describe("the cutoff contract against the explicit orbit (4D)", () => {
  const CUTOFFS = [1e-3, 1e-2, 0.05, 0.2];
  const shellDepth2 = () =>
    construction({
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 2,
    });

  it("at or above the cutoff returns the full estimate, never above the true distance", () => {
    const c = shellDepth2();
    const de = buildSphereInversionDE4(c);
    const pieces = enumerateSeedOrbit(c);
    let checked = 0;
    for (const p of queries4(c, 120, 0xc4a)) {
      const truth = explicitOrbitDistance(pieces, p);
      const full = estimateSphereInversionDistance4(de, p);
      for (const cutoff of CUTOFFS) {
        const cut = estimateSphereInversionDistance4(de, p, cutoff);
        if (cut < cutoff) continue;
        checked++;
        expect(cut).toBe(full);
        expect(cut).toBeLessThanOrEqual(truth * (1 + 1e-9) + 1e-12);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("returns below the cutoff whenever the true distance is below it", () => {
    const c = shellDepth2();
    const de = buildSphereInversionDE4(c);
    const pieces = enumerateSeedOrbit(c);
    let near = 0;
    for (const p of queries4(c, 120, 0xc4b)) {
      const truth = explicitOrbitDistance(pieces, p);
      for (const cutoff of CUTOFFS) {
        if (!(truth < cutoff)) continue;
        near++;
        expect(estimateSphereInversionDistance4(de, p, cutoff)).toBeLessThan(
          cutoff,
        );
      }
    }
    expect(near).toBeGreaterThan(40);
  });

  it("takes the uncut estimator's decision even with the cutoff on the full estimate to the ulp", () => {
    const de = buildSphereInversionDE4(
      construction({
        arrangement: "cell24",
        radiusFraction: 0.98,
        seed: { kind: "shell" },
        depth: 5,
      }),
    );
    const rng = mulberry32(0xc4c);
    let positive = 0;
    for (let i = 0; i < 3000; i++) {
      const p = randomUnit4(rng).map((x) => x * 1.2 * rng()) as Vec4;
      const full = estimateSphereInversionDistance4(de, p);
      if (!(full > 0)) continue;
      positive++;
      expect(estimateSphereInversionDistance4(de, p, full)).toBe(full);
      const above = full * (1 + Number.EPSILON);
      expect(estimateSphereInversionDistance4(de, p, above)).toBeLessThan(
        above,
      );
    }
    expect(positive).toBeGreaterThan(1000);
  });
});

describe("the cutoff contract and attribution (4D)", () => {
  it("returns the full value bit for bit at or above the cutoff, and a sub-cutoff value only when the full value is below it", () => {
    const de = buildSphereInversionDE4(
      construction({
        arrangement: "cell24",
        radiusFraction: 0.98,
        seed: { kind: "shell" },
        depth: 5,
      }),
    );
    const rng = mulberry32(0xc074);
    let exits = 0;
    for (let i = 0; i < 3000; i++) {
      const p = randomUnit4(rng).map((x) => x * 1.2 * rng()) as Vec4;
      const full = estimateSphereInversionDistance4(de, p);
      for (const cutoff of [1e-3, 0.05]) {
        const cut = estimateSphereInversionDistance4(de, p, cutoff);
        if (cut >= cutoff) expect(cut).toBe(full);
        else {
          expect(full).toBeLessThan(cutoff);
          if (cut !== full) exits++;
        }
      }
    }
    expect(exits).toBeGreaterThan(0);
  });

  it("carries the plain estimate bit for bit in its hit record", () => {
    const de = buildSphereInversionDE4(
      construction({ arrangement: "tess16", seed: { size: 0.45 }, depth: 6 }),
    );
    const rng = mulberry32(0x4174);
    for (let i = 0; i < 500; i++) {
      const p = randomUnit4(rng).map((x) => x * 1.4 * rng()) as Vec4;
      expect(sphereInversionHitInfo4(de, p, 0.01).d).toBe(
        estimateSphereInversionDistance4(de, p, 0.01),
      );
    }
  });

  it("attributes a query beside a depth-2 copy to its word's first and last hyperspheres", () => {
    const c = construction({ arrangement: "cross8", depth: 4 });
    const de = buildSphereInversionDE4(c);
    const p = invertPoint(
      c.generators[7],
      invertPoint(c.generators[2], [0.285, 0, 0, 0]),
    ) as Vec4;
    expect(sphereInversionHitInfo4(de, p)).toMatchObject({
      depth: 2,
      firstGenerator: 7,
      lastGenerator: 2,
      seedMember: 0,
    });
  });
});

/** A random unit 3-vector, for the displayed-slice arm below. */
function randomUnit3(rng: () => number): Vec3 {
  for (;;) {
    const v: Vec3 = [2 * rng() - 1, 2 * rng() - 1, 2 * rng() - 1];
    const l = Math.hypot(...v);
    if (l > 1e-3 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l];
  }
}

/** 4D points INSIDE the orbit, near-boundary ones included. Uniform
 * rejection over the bounding ball is hopeless here — a 4D ball's volume
 * falls off as the fourth power and the orbit is thin — so this samples
 * inside each PIECE's own smallest bounding member and tests membership,
 * then walks most of the way to that piece's nearest wall, which is where a
 * clearance claim is worth testing at all. */
function interiorQueries4(
  c: SphereInversionConstruction,
  count: number,
  seed: number,
): Vec4[] {
  const de = buildSphereInversionDE4(c);
  const pieces = enumerateSeedOrbit(c);
  const rng = mulberry32(seed);
  const out: Vec4[] = [];
  for (let i = 0; i < 400000 && out.length < count; i++) {
    const piece = pieces[Math.floor(rng() * pieces.length)];
    let centre: number[] | null = null;
    let radius = Infinity;
    for (const b of piece.members) {
      if (!b.complement && b.radius < radius) {
        radius = b.radius;
        centre = b.center;
      }
    }
    if (!centre || !Number.isFinite(radius)) continue;
    const hull = centre;
    const u = randomUnit4(rng);
    const r = radius * Math.pow(rng(), 0.25);
    const p = [0, 1, 2, 3].map((a) => hull[a] + u[a] * r) as Vec4;
    if (!sphereInversionContains4(de, p)) continue;
    out.push(p);
    if (out.length >= count) break;
    const near = nearestPointOnPiece(piece, p);
    const wall = near.point;
    if (!wall || !(near.distance > 0)) continue;
    const t = 0.02 + 0.96 * rng();
    const q = [0, 1, 2, 3].map((a) => p[a] + t * (wall[a] - p[a])) as Vec4;
    if (sphereInversionContains4(de, q)) out.push(q);
  }
  return out.slice(0, count);
}

const SIGNED_FIXTURES_4D: [string, SphereInversionAuthored][] = [
  [
    "cross8 KISSING ball .28, depth 3",
    {
      arrangement: "cross8",
      radiusFraction: 1,
      seed: { size: 0.28 },
      depth: 3,
    },
  ],
  [
    "tess16 near-kissing ball .5, depth 2",
    {
      arrangement: "tess16",
      radiusFraction: 0.99,
      seed: { size: 0.5 },
      depth: 2,
    },
  ],
  [
    "cross8 shell, depth 2",
    { arrangement: "cross8", seed: { kind: "shell" }, depth: 2 },
  ],
];

describe("sphereInversionSignedDistance4", () => {
  for (const [label, authored] of SIGNED_FIXTURES_4D) {
    it(`${label}: is the shipped 4D estimator BIT FOR BIT outside`, () => {
      const c = construction(authored);
      const de = buildSphereInversionDE4(c);
      let outside = 0;
      for (const p of queries4(c, 400, 0x51a)) {
        const unsigned = estimateSphereInversionDistance4(de, p, 0);
        if (!(unsigned > 0)) continue;
        outside++;
        expect(Object.is(sphereInversionSignedDistance4(de, p), unsigned)).toBe(
          true,
        );
      }
      expect(outside).toBeGreaterThan(80);
    });

    it(`${label}: its sign agrees with 4D membership`, () => {
      const c = construction(authored);
      const de = buildSphereInversionDE4(c);
      const sample = [
        ...queries4(c, 400, 0x51b),
        ...interiorQueries4(c, 150, 0x51c),
      ];
      let interior = 0;
      for (const p of sample) {
        const f = sphereInversionSignedDistance4(de, p);
        const member = sphereInversionContains4(de, p);
        if (f < 0) interior++;
        if (f !== 0) expect(f < 0).toBe(member);
      }
      expect(interior).toBeGreaterThan(40);
    });

    it(`${label}: never claims more interior clearance than the explicit orbit`, () => {
      const c = construction(authored);
      const de = buildSphereInversionDE4(c);
      const pieces = enumerateSeedOrbit(c);
      let checked = 0;
      for (const p of interiorQueries4(c, 200, 0x51d)) {
        const f = sphereInversionSignedDistance4(de, p);
        if (!(f < 0)) continue;
        checked++;
        expect(-f).toBeLessThanOrEqual(
          explicitOrbitClearance(pieces, p) + 1e-12,
        );
      }
      expect(checked).toBeGreaterThan(80);
    });

    it(`${label}: its interior value is a STEPPING bound in 4D`, () => {
      const c = construction(authored);
      const de = buildSphereInversionDE4(c);
      const rng = mulberry32(0x51e);
      let stepped = 0;
      for (const p of interiorQueries4(c, 150, 0x51f)) {
        const f = sphereInversionSignedDistance4(de, p);
        if (!(f < 0)) continue;
        const d = randomUnit4(rng);
        const q = [0, 1, 2, 3].map((a) => p[a] + d[a] * -f) as Vec4;
        stepped++;
        expect(sphereInversionContains4(de, q)).toBe(true);
      }
      expect(stepped).toBeGreaterThan(40);
    });
  }

  it("the 4D field read through a POSED SLICE bounds the in-slice clearance, at zero slab thickness", () => {
    // The module's own reason: a slice's distance is at least the 4D
    // distance, and the same inequality holds for clearance — a 4D
    // clearance ball meets the slice in a clearance ball OF the slice. So a
    // host marching the displayed 3D slice reads this field directly. Tested
    // at the identity slice and at a posed one, against 3D membership of the
    // displayed point.
    const c = construction({
      arrangement: "cross8",
      radiusFraction: 0.99,
      seed: { size: 0.32 },
      depth: 3,
    });
    const de = buildSphereInversionDE4(c);
    const rng = mulberry32(0x521);
    for (const [angle, w0] of [
      [0, 0],
      [0.3, 0.1],
    ] as const) {
      let interior = 0;
      for (let i = 0; i < 200000 && interior < 60; i++) {
        const u = randomUnit3(rng);
        const p = u.map(
          (x) => x * de.boundingRadius * Math.cbrt(rng()),
        ) as Vec3;
        const q = liftXW(p, angle, w0);
        const f = sphereInversionSignedDistance4(de, q);
        if (!(f < 0)) continue;
        interior++;
        // Step |f| WITHIN THE SLICE: the displayed point stays a member, so
        // the 4D clearance is a sound in-slice clearance.
        const d = randomUnit3(rng);
        const stepped = [0, 1, 2].map((a) => p[a] + d[a] * -f) as Vec3;
        expect(sphereInversionContains4(de, liftXW(stepped, angle, w0))).toBe(
          true,
        );
      }
      expect(interior).toBeGreaterThan(40);
    }
  });
});

describe("sphereInversionSignedNormal4: the exact Möbius normal", () => {
  // A point ON a depth-1 image of the seed ball: the seed sphere's point s,
  // outside every generator ball, carried through generator j. Inversion
  // takes the seed ball B(c, r) to the ball B(c', r'), c' = C + R²(c − C)/
  // (|c − C|² − r²), r' = R²r/(|c − C|² − r²) — the ball not holding C, so
  // interior maps to interior — and the surface's outward normal at p is
  // (p − c')/r'. The exact normal must be that direction to f64 rounding,
  // where the tetrahedron taps only approximate it.
  const c = construction({
    arrangement: "cross8",
    radiusFraction: 0.99,
    seed: { kind: "ball", size: 0.42 },
    depth: 3,
  });
  const de = buildSphereInversionDE4(c);
  const seed = c.seed[0];
  const rng = mulberry32(0x5e1);
  const onSeed = (): Vec4 | null => {
    const u = Array.from({ length: 4 }, () => rng() * 2 - 1);
    const m = Math.hypot(...u);
    const s = u.map((v, a) => seed.center[a] + (seed.radius * v) / m);
    for (const g of c.generators) {
      const d = Math.hypot(...s.map((v, a) => v - g.center[a]));
      if (d <= g.radius * 1.01) return null;
    }
    return s as Vec4;
  };

  it("is the depth-1 image sphere's own normal", () => {
    let checked = 0;
    for (let trial = 0; trial < 400 && checked < 120; trial++) {
      const s = onSeed();
      if (!s) continue;
      const g = c.generators[trial % c.generators.length];
      const sc = s.map((v, a) => v - g.center[a]);
      const k = (g.radius * g.radius) / sc.reduce((t, v) => t + v * v, 0);
      const p = sc.map((v, a) => g.center[a] + k * v) as Vec4;
      const cc = seed.center.map((v, a) => v - g.center[a]);
      const den = cc.reduce((t, v) => t + v * v, 0) - seed.radius * seed.radius;
      const center = cc.map(
        (v, a) => g.center[a] + (g.radius * g.radius * v) / den,
      );
      const want = p.map((v, a) => v - center[a]);
      const wl = Math.hypot(...want);
      const n = sphereInversionSignedNormal4(de, p);
      expect(n).not.toBeNull();
      const dot = n!.reduce((t, v, a) => t + (v * want[a]) / wl, 0);
      expect(dot).toBeGreaterThan(1 - 1e-9);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("points up the field: a step along it raises the signed field", () => {
    let checked = 0;
    for (let trial = 0; trial < 400 && checked < 120; trial++) {
      const s = onSeed();
      if (!s) continue;
      const n = sphereInversionSignedNormal4(de, s);
      if (!n) continue;
      const h = 1e-6 * de.boundingRadius;
      const up = s.map((v, a) => v + h * n[a]) as Vec4;
      const down = s.map((v, a) => v - h * n[a]) as Vec4;
      expect(sphereInversionSignedDistance4(de, up)).toBeGreaterThan(
        sphereInversionSignedDistance4(de, down),
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("is null at a pole, where the caller falls back to the taps", () => {
    const g = c.generators[0];
    expect(sphereInversionSignedNormal4(de, [...g.center] as Vec4)).toBeNull();
  });
});
