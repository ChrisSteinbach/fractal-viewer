import {
  analyzeBulbSystem,
  buildBulbDE,
  estimateBulbDistance,
  BULB_ITERATIONS,
  BULB_STEP_SCALE,
} from "./bulb-de";
import type { BulbDE } from "./bulb-de";
import { analyzeEscapeSystem } from "./escape-de";
import {
  mandelbulbClassic,
  mandelbulbOffset,
  mandelbulbRotated,
} from "./presets";
import { analyzeSurfaceSystem } from "./surface-de";
import { triplexPow8 } from "./variations";
import type { Transform, Vec3 } from "./types";

/** A single pure triplex-power map — the shape `analyzeBulbSystem` admits. */
function bulbSystem(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "bulb", weight: 1 }],
    ...overrides,
  };
}

/**
 * The White/Nylander power written the OTHER way — straight from the
 * spherical-coordinate definition, with the trigonometry the shipped form
 * rewrites away. Independent reference for the rewrite's exactness.
 */
function trigTriplexPow8(x: number, y: number, z: number): Vec3 {
  const r = Math.hypot(x, y, z);
  if (r === 0) return [0, 0, 0];
  const theta = Math.acos(Math.max(-1, Math.min(1, z / r)));
  const phi = Math.atan2(y, x);
  const zr = Math.pow(r, 8);
  const st = Math.sin(theta * 8);
  return [
    zr * st * Math.cos(phi * 8),
    zr * st * Math.sin(phi * 8),
    zr * Math.cos(theta * 8),
  ];
}

/**
 * Independent membership test: does the orbit `y <- M V(y) + (M p + t)`
 * stay bounded? Written from the map rather than from anything the module
 * under test does — but through the SAME power implementation, deliberately.
 * A forward power-8 orbit multiplies a perturbation by `8r⁷` per step, so a
 * trig-vs-polynomial oracle disagrees with the estimator about membership in
 * a thin shell around the boundary (0.22% of the ball, measured in
 * `scripts/bulb-preview.harness.ts`) — real chaos, not an estimator defect.
 */
function orbitStaysBounded(de: BulbDE, p: Vec3, budget = 400): boolean {
  const m = de.m;
  const cx = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + de.t[0];
  const cy = m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + de.t[1];
  const cz = m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + de.t[2];
  let [x, y, z] = [cx, cy, cz];
  for (let i = 0; i < budget; i++) {
    const [vx, vy, vz] = triplexPow8(x, y, z);
    x = m[0] * vx + m[1] * vy + m[2] * vz + cx;
    y = m[3] * vx + m[4] * vy + m[5] * vz + cy;
    z = m[6] * vx + m[7] * vy + m[8] * vz + cz;
    const r = Math.hypot(x, y, z);
    if (!Number.isFinite(r) || r > 64) return false;
  }
  return true;
}

/** Deterministic LCG so every query set in this file is reproducible. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe("analyzeBulbSystem", () => {
  it("admits a lone pure triplex power", () => {
    const analysis = analyzeBulbSystem([bulbSystem()]);

    expect(analysis).toEqual({ status: "eligible", reasons: [] });
  });

  it("refuses a fold map, leaving it to the escape-time renderer", () => {
    const analysis = analyzeBulbSystem([
      bulbSystem({ variations: [{ type: "mandelbox", weight: 2 }] }),
    ]);

    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toContain("the map is not a pure triplex power");
  });

  it("refuses a blend, because a weighted sum is a different map", () => {
    const analysis = analyzeBulbSystem([
      bulbSystem({
        variations: [
          { type: "bulb", weight: 1 },
          { type: "linear", weight: 0.2 },
        ],
      }),
    ]);

    expect(analysis.reasons).toContain("the map is not a pure triplex power");
  });

  it("refuses a second active map", () => {
    const analysis = analyzeBulbSystem([bulbSystem(), bulbSystem({ id: 2 })]);

    expect(analysis.reasons).toContain(
      "more than one active map (Mandelbulb sets are single-map)",
    );
  });

  it("treats a weight-0 map as inert", () => {
    const analysis = analyzeBulbSystem([
      bulbSystem(),
      bulbSystem({ id: 2, weight: 0 }),
    ]);

    expect(analysis.status).toBe("eligible");
  });

  it("refuses a variation weight other than 1, which would render a different set", () => {
    const analysis = analyzeBulbSystem([
      bulbSystem({ variations: [{ type: "bulb", weight: 0.5 }] }),
    ]);

    expect(analysis.reasons).toContain(
      "the triplex power's weight must be 1 (scale the map instead)",
    );
  });

  it("refuses a 4D map — triplex numbers have no fourth component", () => {
    const analysis = analyzeBulbSystem([bulbSystem({ w: { position: 0.4 } })]);

    expect(analysis.reasons).toContain(
      "the map extends into 4D (the Mandelbulb is a 3D object)",
    );
  });

  it("refuses a singular map, which has no escape radius", () => {
    const analysis = analyzeBulbSystem([bulbSystem({ scale: [1, 0, 1] })]);

    expect(analysis.reasons).toContain(
      "the map is singular (zero scale on some axis)",
    );
  });

  it("refuses a final transform and a kaleidoscope", () => {
    expect(
      analyzeBulbSystem([bulbSystem()], bulbSystem({ id: 9 })).reasons,
    ).toContain("final transform (unsupported in Mandelbulb mode)");

    expect(
      analyzeBulbSystem([bulbSystem()], null, { order: 3, plane: "xz" })
        .reasons,
    ).toContain("kaleidoscope symmetry (unsupported in Mandelbulb mode)");
  });

  it("is the complement of the IFS gate, which refuses the map for its own reasons", () => {
    // The module doc's claim that no contraction clause is needed: the
    // attractor tracer has no inverse branch for a triplex power at any
    // parameter, so the two modes cannot both claim a system.
    const analysis = analyzeSurfaceSystem([bulbSystem()]);

    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toContain("map 1 uses variations");
  });
});

describe("buildBulbDE", () => {
  it("carries the forward affine and the derivative growth", () => {
    const de = buildBulbDE([
      bulbSystem({ position: [0.2, -0.1, 0.3], scale: [1.5, 1.5, 1.5] }),
    ]);

    expect(de.t).toEqual([0.2, -0.1, 0.3]);
    expect(de.sigmaMax).toBeCloseTo(1.5, 12);
    [1.5, 0, 0, 0, 1.5, 0, 0, 0, 1.5].forEach((entry, i) => {
      expect(de.m[i]).toBeCloseTo(entry, 12);
    });
  });

  it("bounds the classic set inside the textbook 2^(1/7) radius", () => {
    // The escape radius derivation (module doc): at M = I the non-escaping
    // set lives inside |p| = 2^(1/(n-1)), which is why published Mandelbulb
    // renders fit in a radius-1.2 ball.
    expect(buildBulbDE([bulbSystem()]).boundingRadius).toBeCloseTo(
      Math.pow(2, 1 / 7),
      12,
    );
  });

  it("contains the set inside the bounding radius it advertises", () => {
    const de = buildBulbDE([bulbSystem({ position: [0.2, -0.1, 0.3] })]);
    const rng = seeded(31);

    let outsideBall = 0;
    for (let i = 0; i < 6000; i++) {
      const p: Vec3 = [rng() * 6 - 3, rng() * 6 - 3, rng() * 6 - 3];
      if (
        Math.hypot(...p) > de.boundingRadius &&
        orbitStaysBounded(de, p, 200)
      ) {
        outsideBall++;
      }
    }

    expect(outsideBall).toBe(0);
  });

  it("throws on an ineligible system", () => {
    expect(() => buildBulbDE([bulbSystem(), bulbSystem({ id: 2 })])).toThrow(
      /no Mandelbulb estimator/,
    );
  });
});

describe("estimateBulbDistance", () => {
  it("takes its per-iteration offset from the QUERY POINT, not from t", () => {
    // One iteration on the polar axis, where the triplex power is just
    // `z -> z⁸` (sin 8θ = 0), hand-computed at p = (0, 0, 1.2), t = 0:
    //   y1 = V(p) + p = 1.2⁸ + 1.2 = 5.4998...   <- the + p under test
    //   dr = 8·1.2⁷·1·1 + 1 = 29.665...          <- growth, then d(+p)/dp
    //   DE = 0.5·y1·ln(y1) / dr
    // Drop the offset (the Julia form) and y1 reads 1.2⁸ = 4.2998 instead.
    const de = buildBulbDE([bulbSystem()]);
    const y1 = Math.pow(1.2, 8) + 1.2;
    const dr = 8 * Math.pow(1.2, 7) + 1;

    expect(estimateBulbDistance(de, [0, 0, 1.2], 1)).toBeCloseTo(
      (0.5 * y1 * Math.log(y1)) / dr,
      12,
    );
  });

  it("reads the estimate off the mapped point, with dr seeded at sigma_max", () => {
    // The same hand computation through a uniformly SCALED map, which is the
    // only fixture that can see either sigma_max term (both are 1 at every
    // identity-or-rotation map). M = 1.25·I, t = 0, p = (0, 0, 1):
    //   y0 = 1.25            dr = sigma_max = 1.25       <- the seed
    //   y1 = 1.25·y0⁸ + y0 = 1.25⁹ + 1.25 = 8.70...      <- |y|, not |v|
    //   dr = 8·y0⁷·1.25·1.25 + 1.25 = 47.68...           <- growth + offset
    // Seed dr at 1 instead and this reads 1.25x larger; read |v| = 1.25⁸ + 1
    // instead of |y| and it moves further still.
    const s = 1.25;
    const de = buildBulbDE([bulbSystem({ scale: [s, s, s] })]);
    const y0 = s;
    const y1 = s * Math.pow(y0, 8) + y0;
    const dr = 8 * Math.pow(y0, 7) * s * s + s;

    expect(de.sigmaMax).toBeCloseTo(s, 12);
    expect(estimateBulbDistance(de, [0, 0, 1], 1)).toBeCloseTo(
      (0.5 * y1 * Math.log(y1)) / dr,
      12,
    );
  });

  it("iterates variations.ts's triplexPow8 BIT-exactly, not a near copy", () => {
    // The estimator inlines the power (module doc). One iteration from an
    // off-axis query, where every term of the polynomial is live, must equal
    // the exported function's own output to the last bit.
    const de = buildBulbDE([bulbSystem()]);
    const p: Vec3 = [0.37, -0.62, 0.81];
    const [vx, vy, vz] = triplexPow8(...p);
    const y1 = Math.hypot(vx + p[0], vy + p[1], vz + p[2]);
    const r = Math.hypot(...p);
    const dr = 8 * Math.pow(r, 7) + 1;

    expect(estimateBulbDistance(de, p, 1)).toBe((0.5 * y1 * Math.log(y1)) / dr);
  });

  it("returns zero, never a negative distance, when the orbit converges", () => {
    // ln|y| goes negative below |y| = 1, which most of the interior reaches.
    const de = buildBulbDE([bulbSystem()]);
    const rng = seeded(4242);

    let min = Infinity;
    let zeros = 0;
    for (let i = 0; i < 20000; i++) {
      const p: Vec3 = [rng() * 3 - 1.5, rng() * 3 - 1.5, rng() * 3 - 1.5];
      const d = estimateBulbDistance(de, p);
      if (d === 0) zeros++;
      min = Math.min(min, d);
    }

    expect(min).toBe(0);
    expect(zeros).toBeGreaterThan(1000);
  });

  it("returns the settled estimate for a query already past the bailout", () => {
    const de = buildBulbDE([bulbSystem()]);
    const r = de.bailout + 2;

    // The loop never runs, so dr is still sigma_max = 1.
    expect(estimateBulbDistance(de, [r, 0, 0])).toBeCloseTo(
      0.5 * r * Math.log(r),
      12,
    );
  });

  it("never overshoots enough to matter at the full step scale", () => {
    // The module doc's headline: unlike the fold family, this marcher needs
    // no damping. The estimate is a HEURISTIC (the triplex power's azimuthal
    // stretch exceeds 8r⁷ near the poles), so a handful of queries do
    // overshoot — measured 0.06-0.66% across four systems, and damping to
    // 0.5 does not clear them. This pins the order of magnitude, not zero:
    // its measured sensitivity is a 2x inflation of the estimate (which
    // trips it), where 1.5x does not.
    const de = buildBulbDE([bulbSystem()]);
    const rng = seeded(99);
    let probed = 0;
    let overshoots = 0;
    let excluded = 0;

    for (let i = 0; i < 3000; i++) {
      const p: Vec3 = [rng() * 2.4 - 1.2, rng() * 2.4 - 1.2, rng() * 2.4 - 1.2];
      const d = estimateBulbDistance(de, p);
      if (!(d > 1e-4 && d < 0.6)) continue;
      // The estimator says "outside by d"; if the deep oracle says this very
      // point is inside, the two disagree about membership in the chaotic
      // boundary shell and no step length is under test.
      if (orbitStaysBounded(de, p)) {
        excluded++;
        continue;
      }
      probed++;
      for (let k = 0; k < 16; k++) {
        const a = rng() * 2 - 1;
        const b = rng() * 2 - 1;
        const c = rng() * 2 - 1;
        const n = Math.hypot(a, b, c) || 1;
        const step = (BULB_STEP_SCALE * d) / n;
        if (
          orbitStaysBounded(de, [
            p[0] + a * step,
            p[1] + b * step,
            p[2] + c * step,
          ])
        ) {
          overshoots++;
          break;
        }
      }
    }

    // Guard the guard: a vacuous probe set would make the rate meaningless.
    expect(probed).toBeGreaterThan(500);
    expect(excluded).toBeLessThan(probed * 0.05);
    expect(overshoots / probed).toBeLessThan(0.01);
  });

  it("honours the preview tier's depth clamp", () => {
    const de = buildBulbDE([bulbSystem()]);
    const p: Vec3 = [0.9, 0.4, 0.1];

    // A shallower budget can only stop the orbit earlier, so the estimate is
    // larger (less converged), never smaller — the same monotonicity the
    // fold descents' maxDepth clamp has.
    expect(estimateBulbDistance(de, p, 4)).toBeGreaterThanOrEqual(
      estimateBulbDistance(de, p, BULB_ITERATIONS),
    );
  });

  it("is deterministic", () => {
    const de = buildBulbDE([bulbSystem({ position: [0.2, -0.1, 0.3] })]);
    const p: Vec3 = [0.3, -0.7, 0.4];

    expect(estimateBulbDistance(de, p)).toBe(estimateBulbDistance(de, p));
  });
});

describe("triplexPow8", () => {
  it("is the trigonometric White/Nylander power, rewritten exactly", () => {
    // The module doc's claim that the Chebyshev/de-Moivre form is an
    // identity and not an approximation — the whole basis for shipping it
    // instead of the acos/atan2/sin/cos/pow version.
    const rng = seeded(11);
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const p: Vec3 = [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2];
      const fast = triplexPow8(...p);
      const slow = trigTriplexPow8(...p);
      const scale = Math.max(1e-30, Math.hypot(...slow));
      worst = Math.max(
        worst,
        Math.hypot(fast[0] - slow[0], fast[1] - slow[1], fast[2] - slow[2]) /
          scale,
      );
    }

    expect(worst).toBeLessThan(1e-12);
  });

  it("sends (r, theta, phi) to (r⁸, 8·theta, 8·phi) — the defining property", () => {
    // Built FROM spherical coordinates, so the claim is checked against the
    // definition rather than against another implementation of it. Note the
    // output is not simply "azimuth 8phi": sin(8·theta) is negative here, so
    // the point lands on the opposite side of the axis — which is what the
    // signed formula below says and a naive angle comparison would not.
    const r = 1.1;
    const theta = 0.7;
    const phi = -1.2;
    const p: Vec3 = [
      r * Math.sin(theta) * Math.cos(phi),
      r * Math.sin(theta) * Math.sin(phi),
      r * Math.cos(theta),
    ];
    const r8 = Math.pow(r, 8);

    const out = triplexPow8(...p);

    expect(out[0]).toBeCloseTo(
      r8 * Math.sin(8 * theta) * Math.cos(8 * phi),
      12,
    );
    expect(out[1]).toBeCloseTo(
      r8 * Math.sin(8 * theta) * Math.sin(8 * phi),
      12,
    );
    expect(out[2]).toBeCloseTo(r8 * Math.cos(8 * theta), 12);
    expect(Math.hypot(...out)).toBeCloseTo(r8, 12);
  });

  it("is total on the polar axis, where the azimuth is undefined", () => {
    // ρ = 0 divides by zero in the de-Moivre step; the x/y outputs are the
    // limit (sin θ = 0), not an EPS-floored approximation of it.
    for (const z of [1.5, -1.5]) {
      const [x, y, out] = triplexPow8(0, 0, z);
      // Both poles map to +r⁸ on the axis: cos(8·0) = cos(8·pi) = 1.
      expect(Math.abs(x)).toBe(0);
      expect(Math.abs(y)).toBe(0);
      expect(out).toBe(Math.pow(1.5, 8));
    }
    const origin = triplexPow8(0, 0, 0);
    expect(origin.every((c) => c === 0)).toBe(true);
  });
});

describe("the Mandelbulb presets (fr-tdin)", () => {
  // These three exist to make the mode reachable, and they reach it only by
  // being refused by BOTH other surface gates: the IFS descent (which has no
  // inverse branch for a triplex power) and the escape-time fold gate (which
  // takes only the fold family). A preset that drifted into either — an extra
  // map, a stray fold, a weight other than 1 — would silently land in a
  // different renderer, or in none at all with a reason that names neither
  // this map nor the marcher that exists for it.
  it.each([
    ["mandelbulbClassic", mandelbulbClassic()],
    ["mandelbulbOffset", mandelbulbOffset()],
    ["mandelbulbRotated", mandelbulbRotated()],
  ])("%s is admitted by the bulb gate alone", (_name, transforms) => {
    expect(analyzeBulbSystem(transforms)).toEqual({
      status: "eligible",
      reasons: [],
    });
    expect(analyzeSurfaceSystem(transforms).status).toBe("ineligible");
    expect(analyzeEscapeSystem(transforms).status).toBe("ineligible");
  });

  it("renders three NON-EMPTY sets", () => {
    // A preset that renders nothing is worse than no preset (fr-7u8t.8's
    // lesson). Fill measured in each system's own marching ball, which is
    // per-system here rather than a shared constant.
    for (const transforms of [
      mandelbulbClassic(),
      mandelbulbOffset(),
      mandelbulbRotated(),
    ]) {
      const de = buildBulbDE(transforms);
      const N = 17;
      let inBall = 0;
      let interior = 0;
      const step = (2 * de.boundingRadius) / (N - 1);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          for (let k = 0; k < N; k++) {
            const p: Vec3 = [
              -de.boundingRadius + step * i,
              -de.boundingRadius + step * j,
              -de.boundingRadius + step * k,
            ];
            if (Math.hypot(...p) > de.boundingRadius) continue;
            inBall++;
            if (estimateBulbDistance(de, p) < 1e-3) interior++;
          }
        }
      }
      expect(interior / inBall).toBeGreaterThan(0.02);
      expect(interior / inBall).toBeLessThan(0.6);
    }
  });

  // The rotated preset's whole justification (see its doc, and the module
  // doc's azimuthal factor): `M` does not commute with the triplex power, so
  // the rotated system is a DIFFERENT object rather than a different view of
  // the classic one. If it were merely a re-posing, this identity would hold
  // everywhere and the preset would be a camera move wearing a menu entry.
  it("mandelbulbRotated is not the classic bulb seen from another angle", () => {
    const classic = buildBulbDE(mandelbulbClassic());
    const rotated = buildBulbDE(mandelbulbRotated());
    // The rotated system's own forward linear part, applied to the query:
    // if rotation were a conjugation, DE_rotated(p) would equal
    // DE_classic(M p).
    const m = rotated.m;
    let disagreements = 0;
    let probed = 0;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const p: Vec3 = [
          0.9 * Math.cos(i) * Math.cos(j),
          0.9 * Math.sin(i) * Math.cos(j),
          0.9 * Math.sin(j),
        ];
        const mp: Vec3 = [
          m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
          m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
          m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
        ];
        const a = estimateBulbDistance(rotated, p);
        const b = estimateBulbDistance(classic, mp);
        probed++;
        if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b))) {
          disagreements++;
        }
      }
    }
    expect(probed).toBeGreaterThan(0);
    expect(disagreements / probed).toBeGreaterThan(0.5);
  });
});
