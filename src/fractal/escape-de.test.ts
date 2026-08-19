import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_LINK_BOXFOLD,
  ESCAPE_LINK_BULB,
  ESCAPE_LINK_MANDELBOX,
  ESCAPE_LINK_QSQUARE,
  ESCAPE_PROBE_POINTS,
  ESCAPE_PROBE_SEED,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  escapeLinkPower,
  escapeLinkStiffnessLimit,
  escapeSetContains,
  estimateEscapeDistance,
  foldQueryIntoSector,
  probeEscapeFill,
} from "./escape-de";
import type { EscapeDE } from "./escape-de";
import { composeAffine } from "./affine";
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
  transformSigmas,
} from "./surface-de";
import { mulberry32 } from "./rng";
import { composeVariations, resolveFoldRadii, triplexPow8 } from "./variations";
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
 * The mode's originally shipped estimator body, FROZEN — the single-map
 * escape orbit exactly as it ran before the transform list became a chain.
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
    if (de.kind === SURFACE_FOLD_BOXFOLD) {
      fx = foldAxis(yx);
      fy = foldAxis(yy);
      fz = foldAxis(yz);
      localL = 1;
    } else if (de.kind === SURFACE_FOLD_SPHEREFOLD) {
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

/**
 * The FOLD-ONLY chain estimator as it stood before the power links widened
 * the link vocabulary, frozen beside {@link frKltjReference} and for the
 * same reason: the cycled orbit, the authored fold lengths, the
 * query-space wedge fold inlined, and the linear `r / dr` estimate
 * returned unconditionally — because there was no other form to choose. A
 * fold-only document must reproduce this to the bit however many link kinds
 * the chain learns, so this must never be refactored to share code with the
 * estimator it checks.
 *
 * The one thing that widening moved here is a NAME: the link's map used to
 * be `foldKind` and is now `kind`.
 */
function frZa0nChainReference(
  de: EscapeDE,
  p: Vec3,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): number {
  const foldAxis = (t: number, wall: number): number =>
    2 * Math.max(-wall, Math.min(wall, t)) - t;
  let qx = p[0];
  let qy = p[1];
  let qz = p[2];
  if (de.symmetryOrder > 1) {
    const ia = de.symmetryPlane === "yz" ? 1 : 0;
    const ib = de.symmetryPlane === "xy" ? 1 : 2;
    const folded = [p[0], p[1], p[2]];
    const sector = (2 * Math.PI) / de.symmetryOrder;
    const a = folded[ia];
    const b = folded[ib];
    const turn = Math.round(Math.atan2(b, a) / sector) * sector;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    folded[ia] = a * c + b * s;
    folded[ib] = Math.abs(b * c - a * s);
    [qx, qy, qz] = folded;
  }
  const links = de.links;
  const n = links.length;
  let vx = qx;
  let vy = qy;
  let vz = qz;
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  for (
    let step = 0;
    step < maxIterations * n && r <= ESCAPE_TIME_RADIUS;
    step++
  ) {
    const link = links[step % n];
    const m = link.m;
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
    const yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
    const yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
    let fx: number;
    let fy: number;
    let fz: number;
    let localL: number;
    const wall = link.boxLimit;
    const mR2 = link.minRadius2;
    const fR2 = link.fixedRadius2;
    if (link.kind === SURFACE_FOLD_BOXFOLD) {
      fx = foldAxis(yx, wall);
      fy = foldAxis(yy, wall);
      fz = foldAxis(yz, wall);
      localL = 1;
    } else if (link.kind === SURFACE_FOLD_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      localL = f;
    } else {
      const bx = foldAxis(yx, wall);
      const by = foldAxis(yy, wall);
      const bz = foldAxis(yz, wall);
      const r2 = bx * bx + by * by + bz * bz;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      localL = f;
    }
    vx = link.w * fx + qx;
    vy = link.w * fy + qy;
    vz = link.w * fz + qz;
    dr = link.derivGrowth * localL * dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  return r / dr;
}

/** One POWER-map link — {@link foldMap}'s twin for the two
 * cross-family maps, so a chain fixture reads as what it holds. */
function powerMap(
  id: number,
  type: "bulb" | "qsquare",
  weight = 1,
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
 * An INDEPENDENT chain orbit, built from the DOCUMENT rather than
 * from a built {@link EscapeDE}, and reaching for `variations.ts`'s own
 * forward maps rather than restating them: `composeVariations` supplies every
 * warp — `triplexPow8` for a bulb link, the `qsquare` table entry for a
 * quaternion one, `foldVariationFn` at its authored lengths for a fold — and
 * each link's local Lipschitz factor is written out from the module doc's
 * own table (`1`, `fR²/clamp(|y|², mR², fR²)`, `8·|y|⁷`, `2·|y|`).
 *
 * It returns the orbit's terminal radius and derivative bound rather than a
 * distance, so the two estimate FORMS can be checked separately from the
 * orbit that feeds them.
 *
 * This is the discipline `scripts/spherefold-radius-sweep.harness.ts` set for
 * `runEscapeOrbit`, and the strongest assurance available before six shader
 * mirrors are written against this code: a reference that merely restated the
 * estimator would pin nothing. Unsymmetrised on purpose — the query-space
 * wedge fold has its own suite above, and {@link frZa0nChainReference}
 * carries it.
 */
function referenceOrbit(
  transforms: Transform[],
  p: Vec3,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): { r: number; dr: number } {
  const noRng = () => 0;
  const links = transforms
    .filter((t) => (t.weight ?? 1) > 0)
    .map((t) => {
      const v = (t.variations ?? []).filter((e) => e.weight !== 0)[0];
      const affine = composeAffine(t);
      const radii = resolveFoldRadii(v);
      return {
        m: affine.m,
        t: affine.t,
        type: v.type,
        w: v.weight,
        growth: Math.abs(v.weight) * transformSigmas(t).max,
        mR2: radii.minRadius * radii.minRadius,
        fR2: radii.fixedRadius * radii.fixedRadius,
        /** This link's forward warp, from `variations.ts` itself. */
        warp: composeVariations([{ ...v, weight: 1 }])!,
        /** ...and its box fold alone, which is where a mandelbox link's
         * sphere factor is evaluated. */
        boxOnly: composeVariations([
          { type: "boxfold", weight: 1, boxLimit: radii.boxLimit },
        ])!,
      };
    });
  const n = links.length;
  let vx = p[0];
  let vy = p[1];
  let vz = p[2];
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  for (
    let step = 0;
    step < maxIterations * n && r <= ESCAPE_TIME_RADIUS;
    step++
  ) {
    const link = links[step % n];
    const m = link.m;
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
    const yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
    const yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
    const f = link.warp(yx, yy, yz, noRng);
    let localL: number;
    if (link.type === "boxfold") {
      localL = 1;
    } else if (link.type === "spherefold") {
      const r2 = yx * yx + yy * yy + yz * yz;
      localL = link.fR2 / Math.max(link.mR2, Math.min(link.fR2, r2));
    } else if (link.type === "mandelbox") {
      const b = link.boxOnly(yx, yy, yz, noRng);
      const r2 = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
      localL = link.fR2 / Math.max(link.mR2, Math.min(link.fR2, r2));
    } else if (link.type === "bulb") {
      const r2 = yx * yx + yy * yy + yz * yz;
      localL = 8 * (r2 * r2 * r2 * Math.sqrt(r2));
    } else {
      localL = 2 * Math.sqrt(yx * yx + yy * yy + yz * yz);
    }
    vx = link.w * f[0] + p[0];
    vy = link.w * f[1] + p[1];
    vz = link.w * f[2] + p[2];
    dr = link.growth * localL * dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  return { r, dr };
}

describe("analyzeEscapeSystem eligibility, widened to chains", () => {
  it("admits the canonical non-contracting single-map mandelbox", () => {
    const analysis = analyzeEscapeSystem([canonicalMandelbox()]);
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("admits a CHAIN of non-contracting fold maps", () => {
    // The shape the chain exists for: refused by the IFS gate for expanding,
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
    // An earlier version of this test swept SINGLE-map systems only,
    // and passed for that reason alone: with one map, "more than one active
    // map" never fired and the two gates really did partition. Two maps and
    // the claim was false — a pair of non-contracting folds was refused by
    // BOTH gates, and nothing rendered it. That hole is what the chain filled,
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
    expect(analysis.reasons).toEqual(["map 3 is not a pure fold or power map"]);
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
    ).toEqual(["map 1 is not a pure fold or power map"]);

    expect(
      analyzeEscapeSystem([
        canonicalMandelbox({ variations: [{ type: "swirl", weight: 2 }] }),
      ]).reasons,
    ).toEqual(["map 1 is not a pure fold or power map"]);

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
    // The kaleidoscope became a query-space wedge fold, which is an
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

describe("buildEscapeDE, widened to chains", () => {
  it("carries the forward affine, the signed weight, and the derivative growth", () => {
    const de = buildEscapeDE([
      canonicalMandelbox({
        scale: [1.5, 1.5, 1.5],
        variations: [{ type: "mandelbox", weight: -2 }],
      }),
    ]);
    expect(de.kind).toBe(SURFACE_FOLD_MANDELBOX);
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
    expect(de.links.map((l) => l.kind)).toEqual([
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
    expect(de.kind).toBe(head.kind);
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

describe("estimateEscapeDistance", () => {
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
});

describe("the chain", () => {
  it("is BIT-IDENTICAL to the original single-map loop at chain length 1", () => {
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

describe("escapeSetContains and the emptiness probe", () => {
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
    // The chain's UX landmine, and the reporting that answers it. Both of
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
    // The default seed is a CONSTANT, so the default sample has ONE answer
    // — written down, because comparing the call to itself would hold just
    // as well for a Math.random() seed. An exact k/ESCAPE_PROBE_POINTS
    // fraction, so `toBe` is the right strength.
    const fill = probeEscapeFill(de);
    expect(fill).toBe(0.019775390625);
    // The same number as a count, so the pin reads as what it is: 81 of the
    // 4096 default samples were members.
    expect(fill * ESCAPE_PROBE_POINTS).toBe(81);
    // A different seed is a different sample of the same set: it must land
    // on a different count (the seed is read, not decorative) while
    // agreeing in magnitude (it is the same set).
    const other = probeEscapeFill(de, undefined, 0xdead);
    expect(other).toBeGreaterThan(0);
    expect(other).not.toBe(fill);
    expect(Math.abs(other - fill)).toBeLessThan(0.02);
    expect(probeEscapeFill(de, 0)).toBe(0);
    // `points` is the denominator AND the loop count, so a fill from N
    // samples is a whole number of them. Powers of two keep that exact.
    for (const n of [64, 512]) {
      const fill = probeEscapeFill(de, n);
      expect(Number.isInteger(fill * n), `${n} samples`).toBe(true);
    }
  });
});

describe("the kaleidoscope fold", () => {
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

describe("the escape-time presets", () => {
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
    const fill = (transforms: Transform[]): number =>
      probeEscapeFill(buildEscapeDE(transforms));
    const [ball, rings, cube] = [
      fill(mandelboxClassic()),
      fill(mandelboxRings()),
      fill(mandelboxCube()),
    ];
    // mandelboxRings is the module doc's own example of a THIN fractal:
    // ball fill (a volume sample) reads exactly 0 while the marcher still
    // draws ~38k surface hits — probeEscapeFill answers "how much volume",
    // never "will it render" (its own doc comment). So the non-empty floor
    // below applies to ball/cube only; rings' exact zero is the expected,
    // documented reading, not a broken preset. Measured: ball 3.540%,
    // rings 0.000%, cube 11.621%.
    expect(rings).toBe(0);
    for (const f of [ball, cube]) {
      expect(f).toBeGreaterThan(0.01);
      expect(f).toBeLessThan(0.3);
    }
    expect(rings).toBeLessThan(ball);
    expect(ball).toBeLessThan(cube);
  });
});

describe("the escape-time CHAIN presets", () => {
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
      JSON.stringify([l.kind, l.w, l.m, l.t]),
    );
    expect(new Set(fingerprints).size).toBe(links.length);
  });

  it("renders three DIFFERENT objects", () => {
    // Fill of the bailout ball, the figure the single-map trio is documented
    // with. Two presets landing on the same number would mean a parameter —
    // the third link, or the kaleidoscope — never reached the estimator.
    //
    // boulder and chain read only ~0.05 percentage points apart, so the
    // module's default probe size (ESCAPE_PROBE_POINTS, 4096) is too coarse
    // to separate them honestly — at 4096 samples this exact seed reads
    // boulder BELOW chain, the wrong order. 262144 samples resolves it: the
    // order held at every one of ten independently-seeded checks made while
    // developing this fix (minimum observed margin ~0.033 points), so it is
    // a converged reading rather than a lucky draw.
    const CHAIN_TRIO_PROBE_POINTS = 262_144;
    const fill = (transforms: Transform[], symmetry: SymmetryParams): number =>
      probeEscapeFill(
        buildEscapeDE(transforms, null, symmetry),
        CHAIN_TRIO_PROBE_POINTS,
      );
    const chain = fill(foldChain(), symmetryFor("foldChain"));
    const boulder = fill(foldChainBoulder(), symmetryFor("foldChainBoulder"));
    const flower = fill(foldChainFlower(), symmetryFor("foldChainFlower"));
    // Each is non-empty: an empty chain IS reachable inside this gate (a big
    // enough pre-scale escapes everywhere on the first pass and the mode
    // renders a blank frame), so "it rendered something" is a real claim.
    // Measured: chain 1.134%, boulder 1.180%, flower 1.081%.
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
    // — so ball fill is deliberately NOT what separates those two (chain and
    // flower read ~0.05 percentage points apart at this sample size, the
    // same order of magnitude as the boulder/chain gap above). The next
    // test is.
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

describe("the Mandelbrot form", () => {
  it("adds the QUERY POINT as the per-iteration offset, not the document's t", () => {
    // One iteration of a box fold at weight 2, t = 0, hand-computed:
    //   fold  = 2·clamp(1.2, -1, 1) - 1.2 = 0.8   (local factor 1)
    //   v     = w·fold + p = 2(0.8) + 1.2 = 2.8   <- the +p under test
    //   dr    = |w|·sigma_max(M)·1·dr + 1 = 2(1)(1) + 1 = 3
    // Drop the offset and this reads 1.6/3 — the Julia form's value.
    const de = buildEscapeDE([
      canonicalMandelbox({
        position: [0, 0, 0],
        variations: [{ type: "boxfold", weight: 2 }],
      }),
    ]);
    expect(estimateEscapeDistance(de, [1.2, 0, 0], 1)).toBeCloseTo(2.8 / 3, 12);
  });

  it("leaves most of the bounding ball OUTSIDE the object — the Julia-form bug", () => {
    // The defect this form fixes: the Julia-form set at an authored constant
    // filled 96% of its own marching ball, so the escape mode rendered its
    // bounding sphere. Probe the same fixture with the seeded membership
    // sampler (escape-de.ts's own instrument rule — never a grid, never a
    // distance threshold) and ask how much of the ball the shipped
    // Mandelbrot form actually fills. Measured here: ~3.5%. Restore the
    // fixed offset and it reads 96%.
    const de = buildEscapeDE([canonicalMandelbox()]);
    expect(probeEscapeFill(de)).toBeLessThan(0.3);
  });
});

describe("the cross-family gate", () => {
  it("refuses a LONE triplex power and names the render that owns it", () => {
    // Not a scoping accident: a single triplex power already has an object,
    // a better estimator (`bulb-de.ts`'s, in y space with the Böttcher form)
    // and its own presets and kernel core. Refusing it here is what keeps
    // this gate DISJOINT from analyzeBulbSystem rather than merely ordered
    // before it.
    const analysis = analyzeEscapeSystem([powerMap(0, "bulb")]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual([
      "map 1 is a lone triplex power (the Mandelbulb render owns it)",
    ]);
  });

  it("refuses a LONE quaternion square and says to chain it", () => {
    // `qjulia-de.ts`'s object is the measured-dull one whose own renderer
    // was refused after twenty smooth panels — so the refusal names the way
    // forward rather than a render that would take it.
    const analysis = analyzeEscapeSystem([powerMap(0, "qsquare")]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual([
      "map 1 is a lone quaternion square (chain it with another map)",
    ]);
  });

  it("admits a bulb link chained behind a fold", () => {
    expect(
      analyzeEscapeSystem([foldMap(0, "mandelbox", 2), powerMap(1, "bulb")]),
    ).toEqual({ status: "eligible", reasons: [] });
  });

  it("admits a quaternion-square link chained behind a fold", () => {
    expect(
      analyzeEscapeSystem([foldMap(0, "mandelbox", 2), powerMap(1, "qsquare")]),
    ).toEqual({ status: "eligible", reasons: [] });
  });

  it("admits TWO power links — it is composition the gate widened for", () => {
    // `bulb -> bulb` at a rotation is a genuinely new set, so neither
    // refusal above costs the family any range.
    expect(
      analyzeEscapeSystem([
        powerMap(0, "bulb"),
        powerMap(1, "bulb", 1, { rotation: [0.3, 0.2, -0.4] }),
      ]),
    ).toEqual({ status: "eligible", reasons: [] });
  });

  it("admits a power link at a weight analyzeBulbSystem refuses", () => {
    // A deliberate difference, not an oversight. A lone bulb map at a weight
    // other than 1 renders a set `estimateBulbDistance` was not derived for,
    // so that gate refuses it; in a CHAIN the weight is just another link
    // parameter, and `dr` accounts for it exactly through derivGrowth.
    expect(
      analyzeEscapeSystem([
        foldMap(0, "mandelbox", 2),
        powerMap(1, "bulb", 0.7),
      ]),
    ).toEqual({ status: "eligible", reasons: [] });
    expect(analyzeBulbSystem([powerMap(0, "bulb", 0.7)]).reasons).toEqual([
      "the triplex power's weight must be 1 (scale the map instead)",
    ]);
  });

  it("refuses a power link on a map that extends into 4D", () => {
    const analysis = analyzeEscapeSystem([
      foldMap(0, "mandelbox", 2),
      powerMap(1, "bulb", 1, { w: { position: 0.4 } }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 2 extends into 4D"]);
  });

  it("stays DISJOINT from analyzeBulbSystem on a lone triplex power", () => {
    // Exactly one of the two gates admits it, and it is the bulb one —
    // which is what lets main.ts's forward arm read them in sequence.
    const lone = [powerMap(0, "bulb")];
    expect(analyzeBulbSystem(lone).status).toBe("eligible");
    expect(analyzeEscapeSystem(lone).status).toBe("ineligible");
    expect(analyzeBulbSystem(mandelbulbClassic()).status).toBe("eligible");
    expect(analyzeEscapeSystem(mandelbulbClassic()).status).toBe("ineligible");
  });

  it("still names a variation that is neither fold nor power", () => {
    // The message widened with the link vocabulary, and it has to keep
    // naming the map: this is the only thing the panel gets told when a
    // system drops out of the render mode.
    const analysis = analyzeEscapeSystem([
      foldMap(0, "mandelbox", 2),
      foldMap(1, "sinusoidal", 1),
      powerMap(2, "bulb"),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 2 is not a pure fold or power map"]);
  });

  it("takes the side the IFS gate leaves — a cross-family chain is this mode's", () => {
    // The complement is firmer here than for folds: analyzeSurfaceSystem
    // refuses any map carrying a non-fold variation outright, so a chain
    // holding a power link is never IFS-eligible whatever its weights.
    const chain = [foldMap(0, "mandelbox", 2), powerMap(1, "bulb")];
    expect(analyzeSurfaceSystem(chain).status).toBe("ineligible");
    expect(analyzeEscapeSystem(chain)).toEqual({
      status: "eligible",
      reasons: [],
    });
  });
});

describe("buildEscapeDE with power links", () => {
  it("gives each link its own kind, powers included", () => {
    const de = buildEscapeDE([
      foldMap(0, "mandelbox", 2),
      powerMap(1, "bulb"),
      powerMap(2, "qsquare"),
      foldMap(3, "boxfold", 1.6),
    ]);
    expect(de.links.map((l) => l.kind)).toEqual([
      ESCAPE_LINK_MANDELBOX,
      ESCAPE_LINK_BULB,
      ESCAPE_LINK_QSQUARE,
      ESCAPE_LINK_BOXFOLD,
    ]);
    // The two power codes sit ABOVE the folds, which is what lets every
    // mirror keep dispatching its fold pair behind a `kind < 4` guard.
    expect(ESCAPE_LINK_BULB).toBeGreaterThan(ESCAPE_LINK_MANDELBOX);
    expect(ESCAPE_LINK_QSQUARE).toBeGreaterThan(ESCAPE_LINK_MANDELBOX);
  });

  it("prices a power link's derivGrowth as |w|·sigma_max(M), exactly as a fold's", () => {
    // No new per-step term: a power link's `d·|y|^(d-1)` rides the LOCAL
    // factor the orbit computes per step, precisely like the sphere fold's.
    const de = buildEscapeDE([
      foldMap(0, "mandelbox", 2, { scale: [1.5, 1.5, 1.5] }),
      powerMap(1, "bulb", -0.75, { scale: [2, 0.5, 1] }),
      powerMap(2, "qsquare", 1.25, { scale: [0.4, 0.4, 0.4] }),
    ]);
    expect(de.links.map((l) => l.derivGrowth)).toEqual([3, 1.5, 0.5]);
    // The signed weight survives — it is a free multiplier on a power link.
    expect(de.links.map((l) => l.w)).toEqual([2, -0.75, 1.25]);
  });

  it("sets logEstimate exactly when some link is a POWER map", () => {
    const flag = (transforms: Transform[]): boolean =>
      buildEscapeDE(transforms).logEstimate;
    expect(flag([canonicalMandelbox()])).toBe(false);
    expect(flag([canonicalMandelbox(), foldMap(1, "boxfold", 1.6)])).toBe(
      false,
    );
    expect(flag([foldMap(0, "mandelbox", 2), powerMap(1, "bulb")])).toBe(true);
    expect(flag([foldMap(0, "mandelbox", 2), powerMap(1, "qsquare")])).toBe(
      true,
    );
    // Resolved ONCE per chain, so six mirrors cannot each decide it
    // differently — a power link anywhere in the list sets it.
    expect(
      flag([
        foldMap(0, "mandelbox", 2),
        foldMap(1, "boxfold", 1.6),
        powerMap(2, "qsquare"),
      ]),
    ).toBe(true);
  });
});

describe("the power links' arithmetic", () => {
  it("applies a bulb link as variations.ts's triplexPow8, with an 8·|y|⁷ factor", () => {
    // ONE orbit step, hand-composed. The query escapes on step 0 (the
    // triplex power sends |y| = 1.3 well past the bailout), so the second
    // link never runs and the whole estimate is this step's:
    //   y  = M p + t = p            (identity affine)
    //   v  = 1·triplexPow8(y) + p   <- the forward map under test
    //   dr = |w|·sigma_max(M)·8|y|⁷·1 + 1
    //   DE = 0.5·r·ln r / dr        (the chain carries a power link)
    const p: Vec3 = [1.2, 0.4, 0.3];
    const de = buildEscapeDE([powerMap(0, "bulb"), foldMap(1, "boxfold", 1.6)]);
    const f = triplexPow8(p[0], p[1], p[2]);
    const r = Math.hypot(f[0] + p[0], f[1] + p[1], f[2] + p[2]);
    const dr = 8 * Math.pow(Math.hypot(p[0], p[1], p[2]), 7) + 1;
    expect(r).toBeGreaterThan(ESCAPE_TIME_RADIUS); // one step, as claimed
    expect(estimateEscapeDistance(de, p)).toBeCloseTo(
      (0.5 * r * Math.log(r)) / dr,
      12,
    );
  });

  it("applies a qsquare link as variations.ts's own entry, with the EXACT 2·|y| factor", () => {
    // The same one-step shape, one map over. `|d(q²)| = 2|q|·|dq|` holds
    // identically (quaternion norms multiply), so this factor is the one
    // certified term in the chain's product rather than a heuristic.
    const p: Vec3 = [1.8, 0.9, 0.6];
    const de = buildEscapeDE([
      powerMap(0, "qsquare"),
      foldMap(1, "boxfold", 1.6),
    ]);
    const square = composeVariations([{ type: "qsquare", weight: 1 }])!;
    const f = square(p[0], p[1], p[2], () => 0);
    const r = Math.hypot(f[0] + p[0], f[1] + p[1], f[2] + p[2]);
    const dr = 2 * Math.hypot(p[0], p[1], p[2]) + 1;
    expect(r).toBeGreaterThan(ESCAPE_TIME_RADIUS);
    expect(estimateEscapeDistance(de, p)).toBeCloseTo(
      (0.5 * r * Math.log(r)) / dr,
      12,
    );
  });

  it("agrees to the BIT with an independent chain orbit, on every cross-family shape", () => {
    // The real pin, and the one six shader mirrors will be written against:
    // the orbit rebuilt from the DOCUMENT, taking its forward maps from
    // `variations.ts` rather than restating them (see referenceOrbit).
    const chains: [string, Transform[]][] = [
      ["mandelbox -> bulb", [foldMap(0, "mandelbox", 2), powerMap(1, "bulb")]],
      [
        "boxfold -> qsquare, rotated",
        [
          foldMap(0, "boxfold", 1.6, { rotation: [0.2, -0.5, 0.1] }),
          powerMap(1, "qsquare", 1, { scale: [0.8, 0.8, 0.8] }),
        ],
      ],
      [
        "bulb -> bulb, pre-scaled",
        [
          powerMap(0, "bulb", 1, { scale: [0.5, 0.5, 0.5] }),
          powerMap(1, "bulb", 1, {
            scale: [0.5, 0.5, 0.5],
            rotation: [0.3, 0.2, -0.4],
          }),
        ],
      ],
      [
        "mandelbox -> qsquare -> spherefold, authored radii and a weight",
        [
          foldMap(0, "mandelbox", 2, {
            variations: [
              {
                type: "mandelbox",
                weight: 2,
                minRadius: 0.3,
                fixedRadius: 1.4,
                boxLimit: 0.8,
              },
            ],
          }),
          powerMap(1, "qsquare", -0.6, { position: [0.2, -0.1, 0.05] }),
          foldMap(2, "spherefold", 1.2, { scale: [1.3, 1.3, 1.3] }),
        ],
      ],
    ];
    for (const [label, transforms] of chains) {
      const de = buildEscapeDE(transforms);
      const rng = mulberry32(0xc305_5f);
      let worst = 0;
      for (let i = 0; i < 3000; i++) {
        const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
        const { r, dr } = referenceOrbit(transforms, p);
        const want = r <= 1 ? 0 : (0.5 * r * Math.log(r)) / dr;
        worst = Math.max(worst, Math.abs(estimateEscapeDistance(de, p) - want));
      }
      expect(worst, label).toBe(0);
    }
  });
});

describe("the estimate form", () => {
  /** `mandelbox w=2 -> bulb` at pre-scale 1 — the module doc's own stiffness
   * fixture, and the exact chain predicted to render a blank frame. */
  const CROSS: Transform[] = [foldMap(0, "mandelbox", 2), powerMap(1, "bulb")];

  it("reads a power chain through the Böttcher form 0.5·r·ln r / dr", () => {
    // A power orbit escapes SUPER-exponentially (`r -> r^d`), so its
    // potential is log log r and the linear `r / dr` under-reads it by
    // exactly this factor. Same terminal quantities, two readings — so the
    // claim is about the FORM, and the linear one is measurably different.
    const de = buildEscapeDE(CROSS);
    expect(de.logEstimate).toBe(true);
    const rng = mulberry32(0xb07);
    let worstLog = 0;
    let worstLinearGap = 0;
    for (let i = 0; i < 1000; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      const { r, dr } = referenceOrbit(CROSS, p);
      const got = estimateEscapeDistance(de, p);
      worstLog = Math.max(
        worstLog,
        Math.abs(got - (r <= 1 ? 0 : (0.5 * r * Math.log(r)) / dr)),
      );
      worstLinearGap = Math.max(worstLinearGap, Math.abs(got - r / dr));
    }
    expect(worstLog).toBe(0);
    expect(worstLinearGap).toBeGreaterThan(0.1);
  });

  it("returns exactly 0 below r = 1 — a negative estimate marches backwards", () => {
    // `ln r` goes negative there, and a converging orbit reaches it: this
    // chain's links are pre-scaled by 0.5, so the power damps the orbit to a
    // sub-unit radius instead of escaping. The unclamped Böttcher value at
    // each of these queries is a real negative number, which a sphere tracer
    // would step BACKWARDS on.
    const damped: Transform[] = [
      powerMap(0, "bulb", 1, { scale: [0.5, 0.5, 0.5] }),
      powerMap(1, "bulb", 1, {
        scale: [0.5, 0.5, 0.5],
        rotation: [0.3, 0.2, -0.4],
      }),
    ];
    const de = buildEscapeDE(damped);
    for (const p of [
      [0.3, -0.2, 0.15],
      [0.1, 0.05, -0.02],
      [0.6, 0.4, -0.3],
    ] as Vec3[]) {
      const { r, dr } = referenceOrbit(damped, p);
      expect(r, `${p.join(", ")} terminal radius`).toBeLessThan(1);
      expect(r).toBeGreaterThan(0);
      expect((0.5 * r * Math.log(r)) / dr).toBeLessThan(0);
      expect(estimateEscapeDistance(de, p)).toBe(0);
    }
  });
});

describe("escapeLinkPower and escapeLinkStiffnessLimit", () => {
  it("reports each link's degree, and 0 for a fold", () => {
    expect(escapeLinkPower(ESCAPE_LINK_BULB)).toBe(8);
    expect(escapeLinkPower(ESCAPE_LINK_QSQUARE)).toBe(2);
    // A fold is asymptotically affine: it has no degree, and the shaders'
    // continuous escape count reads its constant-factor arm instead.
    expect(escapeLinkPower(ESCAPE_LINK_BOXFOLD)).toBe(0);
    expect(escapeLinkPower(ESCAPE_LINK_MANDELBOX)).toBe(0);
  });

  it("bounds a power link's stiffness at (R/|w|)^(1/d) / R", () => {
    // The module doc's predicted hazard, kept executable because
    // `scripts/hybrid-chain.harness.ts` measures the shipped orbit against
    // it — cycling renders across the whole range this declares hopeless.
    expect(escapeLinkStiffnessLimit(8, 1)).toBe(Math.pow(4, 1 / 8) / 4);
    expect(escapeLinkStiffnessLimit(8, 1)).toBeCloseTo(0.2973, 4);
    expect(escapeLinkStiffnessLimit(2, 1)).toBe(0.5);
    // A heavier weight is stiffer, and the bailout radius is a parameter.
    expect(escapeLinkStiffnessLimit(2, 4)).toBeLessThan(
      escapeLinkStiffnessLimit(2, 1),
    );
    expect(escapeLinkStiffnessLimit(2, 1, 9)).toBeCloseTo(1 / 3, 12);
  });

  it("declares a fold unbounded — it has no such trip out of the ball", () => {
    expect(
      escapeLinkStiffnessLimit(escapeLinkPower(ESCAPE_LINK_BOXFOLD), 2),
    ).toBe(Infinity);
    expect(escapeLinkStiffnessLimit(8, 0)).toBe(Infinity);
  });
});

describe("membership on a cross-family chain", () => {
  /** The prediction's own worst case: a mandelbox step leaves |v| near 7
   * and a triplex 8th power sends 7 to 5.8e5 in one link, so this chain
   * was predicted to escape everywhere and render a blank frame. */
  const CROSS: Transform[] = [foldMap(0, "mandelbox", 2), powerMap(1, "bulb")];

  it("finds MEMBERS at pre-scale 1 — the blank-frame prediction, refuted", () => {
    // Cycling is the whole difference: `+ p` re-enters after EVERY link, so
    // the power sees a point the query has just tethered and its output is
    // tested before any fold can compound it. The module doc measures 0.56%
    // of the bailout ball for this chain against the prototype's chaining
    // arm at 0.01%, and 11.6% of rays hit at the framing pose; this seeded
    // 4096-point probe reads the same few tenths of a percent.
    const fill = probeEscapeFill(buildEscapeDE(CROSS));
    expect(fill).toBeGreaterThan(0);
    // ...and it is a thin fractal rather than a fattened ball, which is the
    // other half of what makes the chain worth rendering.
    expect(fill).toBeLessThan(0.1);
  });

  it("reads membership from the SAME orbit the estimate does", () => {
    // escapeSetContains and estimateEscapeDistance are two readers of one
    // loop, and the independent reference is where that can be checked from
    // outside: a point is a member exactly when the reference's terminal
    // radius is still inside the bailout ball. Walk the probe's own seeded
    // sample of that ball, which is where this chain's members actually are.
    const de = buildEscapeDE(CROSS);
    const rng = mulberry32(ESCAPE_PROBE_SEED);
    let members = 0;
    for (let i = 0; i < ESCAPE_PROBE_POINTS; i++) {
      const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
      const ct = 2 * rng() - 1;
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const ph = 2 * Math.PI * rng();
      const p: Vec3 = [u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct];
      const inside = referenceOrbit(CROSS, p).r <= ESCAPE_TIME_RADIUS;
      expect(escapeSetContains(de, p), `${p.join(", ")}`).toBe(inside);
      if (inside) members++;
    }
    // The sweep really found some, or the agreement above is vacuous...
    expect(members).toBeGreaterThan(0);
    // ...and the emptiness probe is exactly that count over that sample.
    expect(probeEscapeFill(de)).toBe(members / ESCAPE_PROBE_POINTS);
  });
});

describe("a fold-only chain is unmoved by the power links", () => {
  /** Every fold-only shape the widening could plausibly have disturbed. */
  const SYSTEMS: [string, Transform[], SymmetryParams][] = [
    ["lone mandelbox w=2", [canonicalMandelbox()], { order: 1, plane: "xz" }],
    [
      "mandelbox -> boxfold",
      [canonicalMandelbox(), foldMap(1, "boxfold", 1.6)],
      { order: 1, plane: "xz" },
    ],
    [
      "mandelbox -> boxfold -> spherefold",
      [
        canonicalMandelbox(),
        foldMap(1, "boxfold", 1.6, { rotation: [0.3, 0.7, -0.2] }),
        foldMap(2, "spherefold", 1.2, { scale: [1.4, 1.4, 1.4] }),
      ],
      { order: 1, plane: "xz" },
    ],
    [
      "authored fold radii",
      [
        foldMap(0, "mandelbox", 2, {
          variations: [
            {
              type: "mandelbox",
              weight: 2,
              minRadius: 0.3,
              fixedRadius: 1.4,
              boxLimit: 0.8,
            },
          ],
        }),
        foldMap(1, "boxfold", 1.6, {
          variations: [{ type: "boxfold", weight: 1.6, boxLimit: 0.65 }],
        }),
      ],
      { order: 1, plane: "xz" },
    ],
    [
      "under a kaleidoscope",
      [canonicalMandelbox(), foldMap(1, "spherefold", 1.2)],
      { order: 5, plane: "xz" },
    ],
  ];

  it.each(SYSTEMS)("%s keeps the LINEAR estimate form", (_l, t, symmetry) => {
    expect(buildEscapeDE(t, null, symmetry).logEstimate).toBe(false);
  });

  it("is BIT-IDENTICAL to the pre-power-link chain loop", () => {
    // The regression net for the whole widening: every fold-only document in
    // the wild, and the mirrors that render them, must be exactly where they
    // were. A `logEstimate` that leaked true, a local factor that changed
    // grouping, or a `kind` code that moved would all land here.
    for (const [label, transforms, symmetry] of SYSTEMS) {
      const de = buildEscapeDE(transforms, null, symmetry);
      const rng = mulberry32(0xfe1d_ed);
      let worst = 0;
      for (let i = 0; i < 3000; i++) {
        const p: Vec3 = [10 * rng() - 5, 10 * rng() - 5, 10 * rng() - 5];
        worst = Math.max(
          worst,
          Math.abs(estimateEscapeDistance(de, p) - frZa0nChainReference(de, p)),
        );
      }
      expect(worst, label).toBe(0);
      // The preview tier's clamp too — a shallower budget settles the orbit
      // somewhere else entirely, and must land on the same value there.
      const p: Vec3 = [0.31, -0.12, 0.44];
      expect(estimateEscapeDistance(de, p, 5), label).toBe(
        frZa0nChainReference(de, p, 5),
      );
    }
  });

  it("keeps the three shipped fold presets bit-identical too", () => {
    // The single-map trio is what a fold-only document in the wild most
    // likely IS, and these reach the marcher through the same estimator.
    for (const [label, transforms] of [
      ["mandelboxClassic", mandelboxClassic()],
      ["mandelboxRings", mandelboxRings()],
      ["mandelboxCube", mandelboxCube()],
      ["foldChain", foldChain()],
      ["foldChainBoulder", foldChainBoulder()],
    ] as [string, Transform[]][]) {
      const de = buildEscapeDE(transforms);
      expect(de.logEstimate, label).toBe(false);
      const rng = mulberry32(0xd0c5);
      let worst = 0;
      for (let i = 0; i < 1000; i++) {
        const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
        worst = Math.max(
          worst,
          Math.abs(estimateEscapeDistance(de, p) - frZa0nChainReference(de, p)),
        );
      }
      expect(worst, label).toBe(0);
    }
  });
});
