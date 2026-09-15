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
} from "./sphere-inversion-de";
import {
  buildSphereInversionDE4,
  estimateSphereInversionDistance4,
  sphereInversionContains4,
  sphereInversionHitInfo4,
} from "./sphere-inversion-de-4d";
import {
  enumerateSeedOrbit,
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
