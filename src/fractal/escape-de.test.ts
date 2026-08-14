import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_PROBE_POINTS,
  ESCAPE_PROBE_SEED,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  escapeSetContains,
  estimateEscapeDistance,
  foldQueryIntoSector,
  probeEscapeFill,
} from "./escape-de";
import type { EscapeDE } from "./escape-de";
import { analyzeBulbSystem } from "./bulb-de";
import {
  foldChain,
  foldChainFlower,
  foldChainBoulder,
  mandelboxClassic,
  mandelboxCube,
  mandelboxRings,
  mandelbulbClassic,
  PRESET_SYMMETRIES,
} from "./presets";
import {
  analyzeSurfaceSystem,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_SPHEREFOLD,
} from "./surface-de";
import { mulberry32 } from "./rng";
import type { SymmetryParams, Transform, VariationType, Vec3 } from "./types";

/** The canonical single-map Mandelbox shape: identity-scale affine with an
 * offset, mandelbox variation at the classic weight 2 — exactly the
 * parameterization the IFS surface gate refuses as non-contracting. */
function canonicalMandelbox(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0.4, 0.3, 0.2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
    ...overrides,
  };
}

/** One pure-fold link, at the origin with no rotation unless asked — the
 * shape a chain fixture is built from. */
function foldMap(
  id: number,
  type: VariationType,
  weight: number,
  overrides: Partial<Transform> = {},
): Transform {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type, weight }],
    ...overrides,
  };
}

/**
 * fr-kltj's shipped estimator body, FROZEN — the single-map escape orbit
 * exactly as it ran before fr-za0n turned the transform list into a chain.
 * A one-link chain has to reproduce this to the bit; that is the regression
 * net the whole widening rests on, and it is only worth anything as a
 * verbatim copy, so this must never be refactored to share code with the
 * estimator it is checking.
 */
function frKltjReference(
  de: EscapeDE,
  p: Vec3,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): number {
  const foldAxis = (t: number): number => 2 * Math.max(-1, Math.min(1, t)) - t;
  const m = de.m;
  let vx = p[0];
  let vy = p[1];
  let vz = p[2];
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  for (let i = 0; i < maxIterations && r <= ESCAPE_TIME_RADIUS; i++) {
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + de.t[0];
    const yy = m[3] * vx + m[4] * vy + m[5] * vz + de.t[1];
    const yz = m[6] * vx + m[7] * vy + m[8] * vz + de.t[2];
    let fx: number;
    let fy: number;
    let fz: number;
    let localL: number;
    if (de.foldKind === SURFACE_FOLD_BOXFOLD) {
      fx = foldAxis(yx);
      fy = foldAxis(yy);
      fz = foldAxis(yz);
      localL = 1;
    } else if (de.foldKind === SURFACE_FOLD_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz;
      const f = 1 / Math.max(0.25, Math.min(1, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      localL = f;
    } else {
      const bx = foldAxis(yx);
      const by = foldAxis(yy);
      const bz = foldAxis(yz);
      const r2 = bx * bx + by * by + bz * bz;
      const f = 1 / Math.max(0.25, Math.min(1, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      localL = f;
    }
    vx = de.w * fx + p[0];
    vy = de.w * fy + p[1];
    vz = de.w * fz + p[2];
    dr = de.derivGrowth * localL * dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  return r / dr;
}

describe("analyzeEscapeSystem eligibility (fr-kltj, widened by fr-za0n)", () => {
  it("admits the canonical non-contracting single-map mandelbox", () => {
    const analysis = analyzeEscapeSystem([canonicalMandelbox()]);
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("admits a CHAIN of non-contracting fold maps", () => {
    // The shape fr-za0n exists for: refused by the IFS gate for expanding,
    // and — before this — refused here for being more than one map.
    const chain = [
      canonicalMandelbox(),
      foldMap(1, "boxfold", 1.6),
      foldMap(2, "spherefold", 1.2),
    ];
    expect(analyzeSurfaceSystem(chain).status).toBe("ineligible");
    expect(analyzeEscapeSystem(chain)).toEqual({
      status: "eligible",
      reasons: [],
    });
  });

  it("admits a chain in which only ONE link expands", () => {
    // The gate is the IFS gate's complement, and that gate refuses a system
    // as soon as ANY map fails to contract — so one expanding link is
    // enough to make the whole system this mode's.
    const mixed = [
      canonicalMandelbox(),
      foldMap(1, "boxfold", 0.2, { scale: [0.5, 0.5, 0.5] }),
    ];
    expect(analyzeSurfaceSystem(mixed).status).toBe("ineligible");
    expect(analyzeEscapeSystem(mixed).status).toBe("eligible");
  });

  it("refuses a system whose maps ALL contract — the attractor render owns it", () => {
    const analysis = analyzeEscapeSystem([
      canonicalMandelbox({
        scale: [0.1, 0.1, 0.1],
        variations: [{ type: "mandelbox", weight: 1 }],
      }),
      foldMap(1, "boxfold", 0.5, { scale: [0.2, 0.2, 0.2] }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual([
      "every map contracts (the attractor surface render owns it)",
    ]);
  });

  it("partitions the pure-fold plane with the IFS gate — MULTI-map systems included", () => {
    // The pre-fr-za0n version of this test swept SINGLE-map systems only,
    // and passed for that reason alone: with one map, "more than one active
    // map" never fired and the two gates really did partition. Two maps and
    // the claim was false — a pair of non-contracting folds was refused by
    // BOTH gates, and nothing rendered it. That hole is what fr-za0n filled,
    // so the claim is now swept over PAIRS, mixed sides of the line
    // included.
    //
    // At scale 0.5 a mandelbox map's composite Lipschitz bound is 2·|w|, so
    // the crossing sits at |w| = 0.5 and these seven weights straddle it.
    const weights = [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2];
    const map = (id: number, weight: number): Transform =>
      canonicalMandelbox({
        id,
        scale: [0.5, 0.5, 0.5],
        variations: [{ type: "mandelbox", weight }],
      });
    for (const a of weights) {
      for (const b of weights) {
        const system = [map(0, a), map(1, b)];
        const ifs = analyzeSurfaceSystem(system);
        const escape = analyzeEscapeSystem(system);
        const label = `weights ${a} + ${b}`;
        // Never both...
        expect(
          ifs.status === "ineligible" || escape.status === "ineligible",
          `${label}: both gates admit`,
        ).toBe(true);
        // ...and never neither.
        expect(
          ifs.status !== "ineligible" || escape.status === "eligible",
          `${label}: neither gate admits`,
        ).toBe(true);
        // And the side each takes is exactly "does every map contract".
        expect(escape.status === "eligible", `${label}: wrong side`).toBe(
          a >= 0.5 || b >= 0.5,
        );
      }
    }
  });

  it("treats extra weight-0 maps as inert", () => {
    const analysis = analyzeEscapeSystem([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, weight: 0 }),
    ]);
    expect(analysis.status).toBe("eligible");
  });

  it("refuses an empty chain, and buildEscapeDE never reaches its head link", () => {
    // The chain's head is spread into the DE, so an empty links array would
    // throw somewhere unhelpful. The gate is what stands in front of it.
    expect(analyzeEscapeSystem([]).reasons).toEqual(["no active maps"]);
    expect(
      analyzeEscapeSystem([canonicalMandelbox({ weight: 0 })]).reasons,
    ).toEqual(["no active maps"]);
    expect(() => buildEscapeDE([])).toThrow(/no active maps/);
  });

  it("names the offending link by its DOCUMENT index", () => {
    // An inactive map still occupies a row in the panel, so the label has to
    // count document positions rather than chain slots or the reason points
    // at the wrong row.
    const analysis = analyzeEscapeSystem([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, weight: 0 }),
      foldMap(2, "swirl", 2),
    ]);
    expect(analysis.reasons).toEqual(["map 3 is not a pure fold"]);
  });

  it("refuses blends, non-fold variations and finals", () => {
    expect(
      analyzeEscapeSystem([
        canonicalMandelbox({
          variations: [
            { type: "mandelbox", weight: 2 },
            { type: "linear", weight: 0.2 },
          ],
        }),
      ]).reasons,
    ).toEqual(["map 1 is not a pure fold"]);

    expect(
      analyzeEscapeSystem([
        canonicalMandelbox({ variations: [{ type: "swirl", weight: 2 }] }),
      ]).reasons,
    ).toEqual(["map 1 is not a pure fold"]);

    expect(
      analyzeEscapeSystem(
        [canonicalMandelbox()],
        canonicalMandelbox({ id: 9, variations: undefined }),
      ).reasons,
    ).toEqual(["final transform (unsupported in escape-time mode)"]);
  });

  it("refuses a 4D map", () => {
    const analysis = analyzeEscapeSystem([
      canonicalMandelbox({ w: { position: 0.4 } }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 extends into 4D"]);
  });

  it("ADMITS a w-free kaleidoscope and refuses one that rotates into 4D", () => {
    // fr-za0n: the kaleidoscope became a query-space wedge fold, which is an
    // isometry of the plane it turns in — so a 3D one is free, and a
    // w-plane or a twist has no 3x3 to fold with.
    expect(
      analyzeEscapeSystem([canonicalMandelbox()], null, {
        order: 6,
        plane: "xz",
      }),
    ).toEqual({ status: "eligible", reasons: [] });

    expect(
      analyzeEscapeSystem([canonicalMandelbox()], null, {
        order: 4,
        plane: "zw",
      }).reasons,
    ).toEqual(["the kaleidoscope rotates into 4D"]);

    expect(
      analyzeEscapeSystem([canonicalMandelbox()], null, {
        order: 4,
        plane: "xz",
        twist: 1,
      }).reasons,
    ).toEqual(["the kaleidoscope rotates into 4D"]);
  });
});

describe("buildEscapeDE (fr-kltj, widened by fr-za0n)", () => {
  it("carries the forward affine, the signed weight, and the derivative growth", () => {
    const de = buildEscapeDE([
      canonicalMandelbox({
        scale: [1.5, 1.5, 1.5],
        variations: [{ type: "mandelbox", weight: -2 }],
      }),
    ]);
    expect(de.foldKind).toBe(SURFACE_FOLD_MANDELBOX);
    expect(de.w).toBe(-2);
    expect(de.derivGrowth).toBeCloseTo(2 * 1.5, 12);
    expect(de.t).toEqual([0.4, 0.3, 0.2]);
    expect(de.boundingRadius).toBe(ESCAPE_TIME_RADIUS);
    expect(de.links).toHaveLength(1);
  });

  it("builds one link per ACTIVE map, in document order", () => {
    const de = buildEscapeDE([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, weight: 0 }),
      foldMap(2, "boxfold", 1.6),
      foldMap(3, "spherefold", 1.2, { scale: [2, 2, 2] }),
    ]);
    expect(de.links.map((l) => l.foldKind)).toEqual([
      SURFACE_FOLD_MANDELBOX,
      SURFACE_FOLD_BOXFOLD,
      SURFACE_FOLD_SPHEREFOLD,
    ]);
    expect(de.links.map((l) => l.w)).toEqual([2, 1.6, 1.2]);
    // Each link carries its OWN |w|·sigma_max, not the head's.
    expect(de.links.map((l) => l.derivGrowth)).toEqual([2, 1.6, 2.4]);
  });

  it("exposes the HEAD link's fields flat — the wire the mirrors read", () => {
    // EscapeDE extends EscapeLink so the GLSL/WGSL escape packers keep
    // compiling and keep rendering link 0 until they gain the inner step.
    const de = buildEscapeDE([
      foldMap(0, "boxfold", 1.6, { position: [0.1, 0.2, 0.3] }),
      canonicalMandelbox({ id: 1 }),
    ]);
    const head = de.links[0];
    expect(de.m).toBe(head.m);
    expect(de.t).toBe(head.t);
    expect(de.foldKind).toBe(head.foldKind);
    expect(de.w).toBe(head.w);
    expect(de.derivGrowth).toBe(head.derivGrowth);
  });

  it("carries the EFFECTIVE symmetry order and its plane", () => {
    const de = buildEscapeDE([canonicalMandelbox()], null, {
      order: 6,
      plane: "xy",
    });
    expect(de.symmetryOrder).toBe(6);
    expect(de.symmetryPlane).toBe("xy");
    // Order 1 is off, whatever plane the document remembers.
    expect(buildEscapeDE([canonicalMandelbox()]).symmetryOrder).toBe(1);
  });

  it("throws on an ineligible system", () => {
    expect(() =>
      buildEscapeDE([
        canonicalMandelbox({
          scale: [0.1, 0.1, 0.1],
          variations: [{ type: "mandelbox", weight: 1 }],
        }),
      ]),
    ).toThrow(/no escape-time estimator/);
  });
});

describe("estimateEscapeDistance (fr-kltj)", () => {
  it("reads 0 at a fixed point of the iteration — the inside signal", () => {
    // With t = 0 the origin maps to itself forever; dr grows but |v| = 0.
    const de = buildEscapeDE([canonicalMandelbox({ position: [0, 0, 0] })]);
    expect(estimateEscapeDistance(de, [0, 0, 0])).toBe(0);
  });

  it("returns the plain radius for a query already past the bailout", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const p: Vec3 = [ESCAPE_TIME_RADIUS + 2, 0, 0];
    // The loop never runs (r > bailout at entry), so DE = |p| / 1.
    expect(estimateEscapeDistance(de, p)).toBe(ESCAPE_TIME_RADIUS + 2);
  });

  it("returns positive finite estimates across a probe grid", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    for (let i = 0; i < 50; i++) {
      const p: Vec3 = [
        Math.sin(i * 1.7) * 2,
        Math.cos(i * 2.3) * 2,
        Math.sin(i * 0.9 + 1) * 2,
      ];
      const d = estimateEscapeDistance(de, p);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it("honors the iteration clamp the preview tier passes", () => {
    const de = buildEscapeDE([canonicalMandelbox({ position: [0, 0, 0] })]);
    // Near the origin the orbit needs many iterations to escape (if ever):
    // a shallower clamp must settle the estimate with a SMALLER dr, so the
    // clamped estimate is at least the full one.
    const p: Vec3 = [0.01, 0.005, -0.02];
    const shallow = estimateEscapeDistance(de, p, 4);
    const full = estimateEscapeDistance(de, p, ESCAPE_TIME_ITERATIONS);
    expect(shallow).toBeGreaterThanOrEqual(full);
  });

  it("is deterministic", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const p: Vec3 = [0.3, -0.7, 0.4];
    expect(estimateEscapeDistance(de, p)).toBe(estimateEscapeDistance(de, p));
  });
});

describe("the chain (fr-za0n)", () => {
  it("is BIT-IDENTICAL to the fr-kltj single-map loop at chain length 1", () => {
    // The regression net. If this ever goes red, every single-map document
    // in the wild — and the six shader mirrors that still read the head
    // link — has moved.
    const systems: [string, Transform[]][] = [
      ["classic mandelbox", [canonicalMandelbox()]],
      [
        "mandelbox at the origin",
        [canonicalMandelbox({ position: [0, 0, 0] })],
      ],
      [
        "negative weight, scaled",
        [
          canonicalMandelbox({
            scale: [1.5, 1.5, 1.5],
            variations: [{ type: "mandelbox", weight: -1.5 }],
          }),
        ],
      ],
      [
        "boxfold, rotated",
        [foldMap(0, "boxfold", 1.6, { rotation: [0.3, 0.7, -0.2] })],
      ],
      [
        "spherefold",
        [foldMap(0, "spherefold", 2, { position: [0.2, -0.1, 0] })],
      ],
    ];
    const rng = mulberry32(0xc0ffee);
    for (const [label, transforms] of systems) {
      const de = buildEscapeDE(transforms);
      for (let i = 0; i < 2000; i++) {
        const p: Vec3 = [10 * rng() - 5, 10 * rng() - 5, 10 * rng() - 5];
        expect(
          estimateEscapeDistance(de, p),
          `${label} at ${p.join(", ")}`,
        ).toBe(frKltjReference(de, p));
      }
      // The preview tier's clamp too — it now multiplies by the chain
      // length, which is 1 here and must stay invisible.
      const p: Vec3 = [0.31, -0.12, 0.44];
      expect(estimateEscapeDistance(de, p, 7)).toBe(frKltjReference(de, p, 7));
    }
  });

  it("applies link i mod n, hand-computed over two boxfold links", () => {
    // Two boxfolds, identity affines, t = 0, at p = (1.2, 0, 0), ONE pass —
    // which is TWO orbit steps, one per link:
    //   step 0 (w = 2):  fold(1.2) = 2·clamp(1.2) − 1.2 = 0.8
    //                    v  = 2(0.8) + 1.2 = 2.8
    //                    dr = 2·1·1 + 1 = 3
    //   step 1 (w = −1): fold(2.8) = 2 − 2.8 = −0.8
    //                    v  = −1(−0.8) + 1.2 = 2.0
    //                    dr = 1·1·3 + 1 = 4
    //   DE = 2.0 / 4 = 0.5
    // Reuse link 0 for step 1 and this reads 0.4/7; run one step instead of
    // two and it reads 2.8/3; drop either offset and it moves too.
    const de = buildEscapeDE([
      foldMap(0, "boxfold", 2),
      foldMap(1, "boxfold", -1),
    ]);
    expect(estimateEscapeDistance(de, [1.2, 0, 0], 1)).toBeCloseTo(0.5, 12);
  });

  it("is ORDER-SENSITIVE — the same links reversed are a different object", () => {
    // Same two links, swapped:
    //   step 0 (w = −1): fold(1.2) = 0.8;  v = −0.8 + 1.2 = 0.4;  dr = 2
    //   step 1 (w = 2):  fold(0.4) = 0.4;  v = 0.8 + 1.2 = 2.0;   dr = 5
    //   DE = 2.0 / 5 = 0.4
    const forward = buildEscapeDE([
      foldMap(0, "boxfold", 2),
      foldMap(1, "boxfold", -1),
    ]);
    const reversed = buildEscapeDE([
      foldMap(0, "boxfold", -1),
      foldMap(1, "boxfold", 2),
    ]);
    expect(estimateEscapeDistance(reversed, [1.2, 0, 0], 1)).toBeCloseTo(
      0.4,
      12,
    );
    expect(estimateEscapeDistance(forward, [1.2, 0, 0], 1)).not.toBeCloseTo(
      estimateEscapeDistance(reversed, [1.2, 0, 0], 1),
      6,
    );
  });

  it("multiplies EACH link's own local Lipschitz factor into the shared dr", () => {
    // A spherefold link (local factor 4 inside the inner radius) followed by
    // a boxfold (factor 1), at p = (0.5, 0, 0), one pass:
    //   step 0 (spherefold w = 1): |y|² = 0.25 → f = 4
    //                              v  = 1(0.5·4) + 0.5 = 2.5
    //                              dr = 1·4·1 + 1 = 5     <- the 4 is local
    //   step 1 (boxfold w = 2):    fold(2.5) = −0.5
    //                              v  = 2(−0.5) + 0.5 = −0.5
    //                              dr = 2·1·5 + 1 = 11
    //   DE = 0.5 / 11
    // Price the spherefold's factor at 1 and dr reads 2 then 5, DE = 0.1.
    const de = buildEscapeDE([
      foldMap(0, "spherefold", 1),
      foldMap(1, "boxfold", 2),
    ]);
    expect(estimateEscapeDistance(de, [0.5, 0, 0], 1)).toBeCloseTo(
      0.5 / 11,
      12,
    );
  });

  it("counts maxIterations in PASSES — one full cycle of the chain", () => {
    // The clamp has to mean the same thing at every chain length, or the
    // preview tier and the GPU's maxDepth go n times shallower on an n-link
    // document. Two links, so one pass is two orbit steps: the hand-computed
    // value above at maxIterations = 1, and a value that keeps moving as the
    // budget grows.
    const de = buildEscapeDE([
      foldMap(0, "boxfold", 2),
      foldMap(1, "boxfold", -1),
    ]);
    expect(estimateEscapeDistance(de, [1.2, 0, 0], 1)).toBeCloseTo(0.5, 12);
    // Step 2 is link 0 again: fold(2.0) = 0 → v = 0 + 1.2 = 1.2, dr = 9.
    // Step 3 is link 1: fold(1.2) = 0.8 → v = −0.8 + 1.2 = 0.4, dr = 10.
    expect(estimateEscapeDistance(de, [1.2, 0, 0], 2)).toBeCloseTo(
      0.4 / 10,
      12,
    );
  });

  it("leaves the marching ball where it was — a chain still lives in the bailout ball", () => {
    const de = buildEscapeDE([
      canonicalMandelbox(),
      foldMap(1, "boxfold", 1.6),
      foldMap(2, "spherefold", 1.2),
    ]);
    expect(de.boundingRadius).toBe(ESCAPE_TIME_RADIUS);
    // Nothing outside it can be inside the set: the orbit is seeded at p, so
    // a query past the bailout never enters the loop.
    const outside: Vec3 = [ESCAPE_TIME_RADIUS + 0.5, 0, 0];
    expect(estimateEscapeDistance(de, outside)).toBe(ESCAPE_TIME_RADIUS + 0.5);
  });
});

describe("escapeSetContains and the emptiness probe (fr-za0n)", () => {
  const CHAIN: Transform[] = [canonicalMandelbox(), foldMap(1, "boxfold", 1.6)];

  it("answers membership from the SAME orbit the estimate reads", () => {
    const de = buildEscapeDE([canonicalMandelbox({ position: [0, 0, 0] })]);
    // The origin is a fixed point of a t = 0 fold, so it never escapes and
    // the estimate collapses to 0 — the two readers agree at the one point
    // where the answer is certain by construction.
    expect(escapeSetContains(de, [0, 0, 0])).toBe(true);
    expect(estimateEscapeDistance(de, [0, 0, 0])).toBe(0);
    // Past the bailout the loop never runs, so the point is outside.
    const far: Vec3 = [ESCAPE_TIME_RADIUS + 0.5, 0, 0];
    expect(escapeSetContains(de, far)).toBe(false);
  });

  it("is MONOTONE in the budget — a shorter orbit can only find more members", () => {
    // The rendered set is the finite-budget one, so membership has to be
    // read at the budget being rendered. Fewer passes means fewer chances
    // to prove escape, so the set can only grow.
    const de = buildEscapeDE(CHAIN);
    const rng = mulberry32(0xb0d1e5);
    let shallowOnly = 0;
    for (let i = 0; i < 2000; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      const full = escapeSetContains(de, p);
      const shallow = escapeSetContains(de, p, 2);
      expect(!full || shallow, `deep member lost at a shallow budget`).toBe(
        true,
      );
      if (shallow && !full) shallowOnly++;
    }
    // And the two budgets really do differ, or the check above is vacuous.
    expect(shallowOnly).toBeGreaterThan(0);
  });

  it("cannot be replaced by a threshold on the estimate", () => {
    // Why this reader exists at all: |v|/dr goes small for a near-boundary
    // ESCAPER too, whose dr has run away just as far as a member's. Sweep a
    // grid and find the counterexamples.
    const de = buildEscapeDE(CHAIN);
    let smallButOutside = 0;
    const N = 30;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < N; k++) {
          const p: Vec3 = [
            -4 + (8 * i) / (N - 1),
            -4 + (8 * j) / (N - 1),
            -4 + (8 * k) / (N - 1),
          ];
          if (estimateEscapeDistance(de, p) < 1e-3 && !escapeSetContains(de, p))
            smallButOutside++;
        }
      }
    }
    expect(smallButOutside).toBeGreaterThan(0);
  });

  it("probes a fill for a chain that renders, and ZERO for one that does not", () => {
    // The fr-za0n UX landmine, and the reporting that answers it. Both of
    // these pass the gate; only one of them draws anything.
    const renders = probeEscapeFill(buildEscapeDE(CHAIN));
    expect(renders).toBeGreaterThan(0);
    expect(renders).toBeLessThan(1);

    // A pre-scale of 4 throws |y| far past the fold's range every step, so
    // every orbit escapes on its first pass and the mode draws nothing.
    const empty = buildEscapeDE([
      canonicalMandelbox({ position: [0, 0, 0] }),
      foldMap(1, "mandelbox", 2, { scale: [4, 4, 4] }),
    ]);
    expect(analyzeEscapeSystem([]).status).toBe("ineligible"); // sanity
    expect(probeEscapeFill(empty)).toBe(0);
  });

  it("counts MEMBERSHIP, not a threshold on the estimate", () => {
    // The two criteria do not agree, which is the whole reason the probe
    // asks the orbit. Sample the same seeded points both ways: a distance
    // threshold also catches near-boundary ESCAPERS, whose dr has run away
    // as far as any member's, so it reports a strictly fatter set.
    const de = buildEscapeDE(CHAIN);
    const rng = mulberry32(ESCAPE_PROBE_SEED);
    let byThreshold = 0;
    for (let i = 0; i < ESCAPE_PROBE_POINTS; i++) {
      const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
      const ct = 2 * rng() - 1;
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const ph = 2 * Math.PI * rng();
      const p: Vec3 = [u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct];
      if (estimateEscapeDistance(de, p) < 1e-3) byThreshold++;
    }
    expect(byThreshold).toBeGreaterThan(0);
    expect(probeEscapeFill(de)).toBeLessThan(byThreshold / ESCAPE_PROBE_POINTS);
  });

  it("is deterministic, and honours its sample size", () => {
    const de = buildEscapeDE(CHAIN);
    expect(probeEscapeFill(de)).toBe(probeEscapeFill(de));
    // A different seed is a different sample of the same set: it must land
    // on a different count (the seed is read, not decorative) while
    // agreeing in magnitude (it is the same set).
    const other = probeEscapeFill(de, undefined, 0xdead);
    expect(other).toBeGreaterThan(0);
    expect(other).not.toBe(probeEscapeFill(de));
    expect(Math.abs(other - probeEscapeFill(de))).toBeLessThan(0.02);
    expect(probeEscapeFill(de, 0)).toBe(0);
    // `points` is the denominator AND the loop count, so a fill from N
    // samples is a whole number of them. Powers of two keep that exact.
    for (const n of [64, 512]) {
      const fill = probeEscapeFill(de, n);
      expect(Number.isInteger(fill * n), `${n} samples`).toBe(true);
    }
  });
});

describe("the kaleidoscope fold (fr-za0n)", () => {
  const CHAIN: Transform[] = [canonicalMandelbox(), foldMap(1, "boxfold", 1.6)];

  it("is the identity at order 1, component for component", () => {
    const out: Vec3 = [0, 0, 0];
    const p: Vec3 = [-0.3, 1.7, 0.02];
    expect(foldQueryIntoSector(p, 1, "xz", out)).toEqual(p);
    expect(foldQueryIntoSector(p, 0, "xz", out)).toEqual(p);
  });

  it("renders the plain estimate AT THE FOLDED POINT — offset and seed both", () => {
    // The whole construction in one line: DE_sym(p) = DE_plain(g(p)). If the
    // fold reached only the orbit's seed and not the Mandelbrot offset, this
    // would not hold, and the set would not be symmetric.
    const plain = buildEscapeDE(CHAIN);
    const sym = buildEscapeDE(CHAIN, null, { order: 5, plane: "xz" });
    const rng = mulberry32(0x5ec7);
    const folded: Vec3 = [0, 0, 0];
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      foldQueryIntoSector(p, 5, "xz", folded);
      expect(estimateEscapeDistance(sym, p)).toBe(
        estimateEscapeDistance(plain, [folded[0], folded[1], folded[2]]),
      );
    }
  });

  it("is bit-exactly invariant under the plane's MIRROR", () => {
    // Reflection is what makes the fold continuous, so it is the one
    // symmetry that survives to the last bit.
    const out: Vec3 = [0, 0, 0];
    const mirrored: Vec3 = [0, 0, 0];
    const rng = mulberry32(0x5171e);
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [6 * rng() - 3, 6 * rng() - 3, 6 * rng() - 3];
      foldQueryIntoSector(p, 5, "xz", out);
      foldQueryIntoSector([p[0], p[1], -p[2]], 5, "xz", mirrored);
      expect(mirrored).toEqual(out);
    }
  });

  it("is invariant under a sector ROTATION", () => {
    const out: Vec3 = [0, 0, 0];
    const turned: Vec3 = [0, 0, 0];
    for (const order of [2, 3, 5, 8]) {
      const sector = (2 * Math.PI) / order;
      const c = Math.cos(sector);
      const s = Math.sin(sector);
      const rng = mulberry32(0x70b1e);
      for (let i = 0; i < 300; i++) {
        const p: Vec3 = [6 * rng() - 3, 6 * rng() - 3, 6 * rng() - 3];
        const q: Vec3 = [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
        foldQueryIntoSector(p, order, "xz", out);
        foldQueryIntoSector(q, order, "xz", turned);
        for (let k = 0; k < 3; k++) {
          expect(turned[k]).toBeCloseTo(out[k], 12);
        }
      }
    }
  });

  it("is an ISOMETRY on each sector, so the marching ball never moves", () => {
    const out: Vec3 = [0, 0, 0];
    const rng = mulberry32(0x1507);
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      foldQueryIntoSector(p, 7, "xy", out);
      expect(Math.hypot(...out)).toBeCloseTo(Math.hypot(...p), 12);
    }
  });

  it("is 1-LIPSCHITZ, which the cyclic fold would not be", () => {
    // This is the whole soundness argument for folding the query: a
    // discontinuous fold would certify empty balls straight across a sector
    // seam. Close pairs are where a seam shows — a rotate-only ("cyclic")
    // fold would map two neighbours a whole sector apart.
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [0, 0, 0];
    const rng = mulberry32(0x11b5);
    for (const [order, plane] of [
      [3, "xz"],
      [5, "xy"],
      [8, "yz"],
    ] as const) {
      let worstRatio = 0;
      for (let i = 0; i < 4000; i++) {
        const p: Vec3 = [6 * rng() - 3, 6 * rng() - 3, 6 * rng() - 3];
        const q: Vec3 = [
          p[0] + 2e-3 * (rng() - 0.5),
          p[1] + 2e-3 * (rng() - 0.5),
          p[2] + 2e-3 * (rng() - 0.5),
        ];
        foldQueryIntoSector(p, order, plane, a);
        foldQueryIntoSector(q, order, plane, b);
        const before = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const after = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        worstRatio = Math.max(worstRatio, after / before);
      }
      expect(worstRatio, `order ${order} in ${plane}`).toBeLessThanOrEqual(
        1 + 1e-9,
      );
    }
  });

  it("is idempotent — the wedge is already folded", () => {
    const once: Vec3 = [0, 0, 0];
    const twice: Vec3 = [0, 0, 0];
    const rng = mulberry32(0x1d3a);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [6 * rng() - 3, 6 * rng() - 3, 6 * rng() - 3];
      foldQueryIntoSector(p, 6, "xz", once);
      foldQueryIntoSector([once[0], once[1], once[2]], 6, "xz", twice);
      for (let k = 0; k < 3; k++) expect(twice[k]).toBeCloseTo(once[k], 12);
    }
  });

  it("throws on a 4D plane rather than folding something meaningless", () => {
    const out: Vec3 = [0, 0, 0];
    expect(() => foldQueryIntoSector([1, 2, 3], 4, "zw", out)).toThrow(
      /mixes w/,
    );
  });

  it("leaves an unsymmetrised system bit-identical", () => {
    const plain = buildEscapeDE(CHAIN);
    const off = buildEscapeDE(CHAIN, null, { order: 1, plane: "xy" });
    const rng = mulberry32(0x0ff);
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      expect(estimateEscapeDistance(off, p)).toBe(
        estimateEscapeDistance(plain, p),
      );
    }
  });
});

describe("the escape-time presets (fr-7u8t.8)", () => {
  // These three exist to make the mode reachable, and they reach it only by
  // being refused by the IFS gate — a preset that quietly became contracting
  // would land in the attractor tracer and render an empty point, with
  // nothing anywhere saying why.
  it.each([
    ["mandelboxClassic", mandelboxClassic()],
    ["mandelboxRings", mandelboxRings()],
    ["mandelboxCube", mandelboxCube()],
  ])(
    "%s is refused by the IFS gate and admitted by the escape gate",
    (_name, transforms) => {
      expect(analyzeSurfaceSystem(transforms).status).toBe("ineligible");
      expect(analyzeEscapeSystem(transforms)).toEqual({
        status: "eligible",
        reasons: [],
      });
    },
  );

  it("renders three DIFFERENT objects — the fold weight is the family's knob", () => {
    // Ball fill measured by scripts/escape-form-sweep.harness.ts: 10.6% /
    // 2.8% / 17.7%. Collapse the weights onto one value and this fails.
    const fill = (transforms: Transform[]): number => {
      const de = buildEscapeDE(transforms);
      const N = 17;
      let inBall = 0;
      let interior = 0;
      const step = (2 * ESCAPE_TIME_RADIUS) / (N - 1);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          for (let k = 0; k < N; k++) {
            const p: Vec3 = [
              -ESCAPE_TIME_RADIUS + step * i,
              -ESCAPE_TIME_RADIUS + step * j,
              -ESCAPE_TIME_RADIUS + step * k,
            ];
            if (Math.hypot(p[0], p[1], p[2]) > ESCAPE_TIME_RADIUS) continue;
            inBall++;
            if (estimateEscapeDistance(de, p) < 1e-3) interior++;
          }
        }
      }
      return interior / inBall;
    };
    const [ball, rings, cube] = [
      fill(mandelboxClassic()),
      fill(mandelboxRings()),
      fill(mandelboxCube()),
    ];
    // Each is non-empty (a preset that renders nothing is worse than no
    // preset) and each is a distinctly different amount of solid.
    for (const f of [ball, rings, cube]) {
      expect(f).toBeGreaterThan(0.01);
      expect(f).toBeLessThan(0.3);
    }
    expect(rings).toBeLessThan(ball);
    expect(ball).toBeLessThan(cube);
  });
});

describe("the escape-time CHAIN presets (fr-za0n, fr-s04t)", () => {
  /** The kaleidoscope each preset is loaded under — PRESET_SYMMETRIES' own
   * "absent means OFF" rule, which is what main.ts applies. Reading the table
   * rather than restating its values keeps this suite honest if an entry
   * moves. */
  const symmetryFor = (name: keyof typeof PRESET_SYMMETRIES): SymmetryParams =>
    PRESET_SYMMETRIES[name] ?? { order: 1, plane: "xz" };

  const CHAINS = [
    ["foldChain", foldChain()],
    ["foldChainBoulder", foldChainBoulder()],
    ["foldChainFlower", foldChainFlower()],
  ] as const;

  // Same property the single-map trio above is pinned on, and for the same
  // reason: these presets reach the escape-time marcher ONLY by the IFS gate
  // refusing them. One link quietly becoming contracting would land the
  // system in the attractor tracer with nothing anywhere saying why.
  it.each(CHAINS)(
    "%s is refused by the IFS gate and admitted by the escape gate",
    (name, transforms) => {
      expect(analyzeSurfaceSystem(transforms).status).toBe("ineligible");
      expect(analyzeEscapeSystem(transforms, null, symmetryFor(name))).toEqual({
        status: "eligible",
        reasons: [],
      });
    },
  );

  // The whole subject of these presets is that the transform LIST is the
  // formula chain. A preset that collapsed to one map — or to n copies of the
  // same map, which the orbit cannot tell from one — would still pass every
  // gate above and would silently be `mandelboxClassic` again.
  it.each(CHAINS)("%s is a chain of genuinely different links", (_n, t) => {
    const { links } = buildEscapeDE(t);
    expect(links.length).toBeGreaterThan(1);
    const fingerprints = links.map((l) =>
      JSON.stringify([l.foldKind, l.w, l.m, l.t]),
    );
    expect(new Set(fingerprints).size).toBe(links.length);
  });

  it("renders three DIFFERENT objects", () => {
    // Fill of the bailout ball, the figure the single-map trio is documented
    // with. Two presets landing on the same number would mean a parameter —
    // the third link, or the kaleidoscope — never reached the estimator.
    const fill = (
      transforms: Transform[],
      symmetry: SymmetryParams,
    ): number => {
      const de = buildEscapeDE(transforms, null, symmetry);
      const N = 21;
      let inBall = 0;
      let interior = 0;
      const step = (2 * ESCAPE_TIME_RADIUS) / (N - 1);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          for (let k = 0; k < N; k++) {
            const p: Vec3 = [
              -ESCAPE_TIME_RADIUS + step * i,
              -ESCAPE_TIME_RADIUS + step * j,
              -ESCAPE_TIME_RADIUS + step * k,
            ];
            if (Math.hypot(p[0], p[1], p[2]) > ESCAPE_TIME_RADIUS) continue;
            inBall++;
            if (estimateEscapeDistance(de, p) < 1e-3) interior++;
          }
        }
      }
      return interior / inBall;
    };
    const chain = fill(foldChain(), symmetryFor("foldChain"));
    const boulder = fill(foldChainBoulder(), symmetryFor("foldChainBoulder"));
    const flower = fill(foldChainFlower(), symmetryFor("foldChainFlower"));
    // Each is non-empty: an empty chain IS reachable inside this gate (a big
    // enough pre-scale escapes everywhere on the first pass and the mode
    // renders a blank frame), so "it rendered something" is a real claim.
    for (const f of [chain, boulder, flower]) {
      expect(f).toBeGreaterThan(0.01);
      expect(f).toBeLessThan(0.3);
    }
    // main.ts frames a new escape session on the BAILOUT ball, the same ball
    // for every system here, so ball fill is directly how much of the pane a
    // preset opens on — and foldChainBoulder's third link is the one that
    // buys presence. This is the assertion that would have caught the chain
    // originally drafted for that slot, which fills a third of this and
    // opened as a speck (see foldChainBoulder's doc).
    expect(boulder).toBeGreaterThan(chain);
    // The flower's whole difference from the chain is the wedge fold, which
    // moves structure around the axis rather than changing how much there is
    // — so ball fill is deliberately NOT what separates those two (measured
    // 7.0% against 6.7%). The next test is.
    expect(flower).toBeGreaterThan(0.01);
  });

  // The flower's links are foldChain's, byte for byte, so the kaleidoscope is
  // the ONLY thing that makes it a different object — and the sector rotation
  // is where that shows. Rendered under the table's symmetry the estimate is
  // invariant under a one-fifth turn about `y`; rendered without it (which is
  // what a dropped PRESET_SYMMETRIES lookup would give) it is not.
  it("foldChainFlower differs from foldChain by the kaleidoscope alone", () => {
    expect(buildEscapeDE(foldChainFlower()).links).toEqual(
      buildEscapeDE(foldChain()).links,
    );
    const symmetry = symmetryFor("foldChainFlower");
    const withFold = buildEscapeDE(foldChainFlower(), null, symmetry);
    const without = buildEscapeDE(foldChainFlower());
    const sector = (2 * Math.PI) / symmetry.order;
    const c = Math.cos(sector);
    const s = Math.sin(sector);
    const rng = mulberry32(0x5ec_701);
    let worstFolded = 0;
    let worstBare = 0;
    for (let i = 0; i < 600; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      const q: Vec3 = [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
      worstFolded = Math.max(
        worstFolded,
        Math.abs(
          estimateEscapeDistance(withFold, p) -
            estimateEscapeDistance(withFold, q),
        ),
      );
      worstBare = Math.max(
        worstBare,
        Math.abs(
          estimateEscapeDistance(without, p) -
            estimateEscapeDistance(without, q),
        ),
      );
    }
    expect(worstFolded).toBeLessThan(1e-9);
    expect(worstBare).toBeGreaterThan(0.1);
  });

  // Why main.ts must CLEAR the kaleidoscope on every preset load that carries
  // no PRESET_SYMMETRIES entry: the flower's order-5 fold surviving into the
  // next preset does not merely decorate it, it takes the render mode away.
  it("leaks fatally if the flower's kaleidoscope survives the next load", () => {
    const stale = symmetryFor("foldChainFlower");
    expect(stale.order).toBeGreaterThan(1);
    // The Mandelbulb gate refuses ANY order above 1 outright...
    expect(analyzeBulbSystem(mandelbulbClassic(), null, stale).status).toBe(
      "ineligible",
    );
    // ...and both are eligible again the moment symmetry is back off, which
    // is the state main.ts's `?? DEFAULT_SYMMETRY_ORDER` restores.
    const off: SymmetryParams = { order: 1, plane: "xz" };
    expect(analyzeBulbSystem(mandelbulbClassic(), null, off).status).toBe(
      "eligible",
    );
    expect(analyzeEscapeSystem(mandelboxClassic(), null, off).status).toBe(
      "eligible",
    );
  });
});

describe("the Mandelbrot form (fr-7u8t.8)", () => {
  it("adds the QUERY POINT as the per-iteration offset, not the document's t", () => {
    // One iteration of a box fold at weight 2, t = 0, hand-computed:
    //   fold  = 2·clamp(1.2, -1, 1) - 1.2 = 0.8   (local factor 1)
    //   v     = w·fold + p = 2(0.8) + 1.2 = 2.8   <- the +p under test
    //   dr    = |w|·sigma_max(M)·1·dr + 1 = 2(1)(1) + 1 = 3
    // Drop the offset and this reads 1.6/3 — the shipped fr-kltj value.
    const de = buildEscapeDE([
      canonicalMandelbox({
        position: [0, 0, 0],
        variations: [{ type: "boxfold", weight: 2 }],
      }),
    ]);
    expect(estimateEscapeDistance(de, [1.2, 0, 0], 1)).toBeCloseTo(2.8 / 3, 12);
  });

  it("leaves most of the bounding ball OUTSIDE the object — the fr-7u8t.8 bug", () => {
    // The defect this form fixes: the Julia-form set at an authored constant
    // filled 96% of its own marching ball, so the escape mode rendered its
    // bounding sphere. Probe the same fixture on a deterministic grid and
    // count the marcher's own view of inside (a DE collapsed by a runaway
    // dr). Measured here: ~11%. Restore the fixed offset and it reads 96%.
    const de = buildEscapeDE([canonicalMandelbox()]);
    const N = 21;
    let inBall = 0;
    let interior = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < N; k++) {
          const step = (2 * ESCAPE_TIME_RADIUS) / (N - 1);
          const p: Vec3 = [
            -ESCAPE_TIME_RADIUS + step * i,
            -ESCAPE_TIME_RADIUS + step * j,
            -ESCAPE_TIME_RADIUS + step * k,
          ];
          if (Math.hypot(p[0], p[1], p[2]) > ESCAPE_TIME_RADIUS) continue;
          inBall++;
          if (estimateEscapeDistance(de, p) < 1e-3) interior++;
        }
      }
    }
    expect(interior / inBall).toBeLessThan(0.3);
  });
});
