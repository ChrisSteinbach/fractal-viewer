/**
 * fr-7u8t.7: the Mandelbulb's picture, its price, and the two decisions the
 * bead left open.
 *
 * `bulb-de.ts`'s unit tests pin the estimator's ARITHMETIC (the hand-computed
 * iteration, the scaled-map derivative seed, the `ln r` clamp). They cannot
 * answer whether the thing renders the object everyone means by "Mandelbulb",
 * and they cannot answer the two questions this bead had to decide with
 * numbers rather than argument. This sheet does all three, through
 * `de-preview.ts`'s shared CPU sphere-tracer, so panels compare OBJECTS and
 * not lighting:
 *
 *   1. Does the SHIPPED `estimateBulbDistance` resolve the iconic object, and
 *      is `t` still a live knob once the offset comes from the query point?
 *      (Row 1: yes, and yes — `t` bites into the bulb rather than sliding it.)
 *   2. TRIG OR TRIG-FREE, the decision that gets expensive to revisit once six
 *      shader mirrors exist. Measured below, and it is not close: the
 *      Chebyshev/de-Moivre rewrite is an EXACT identity, ~11x cheaper per
 *      eval, and it makes the bulb cheaper to evaluate than the fold mode
 *      that already ships, rather than the expensive one the bead expected. (The
 *      trig form survives here as `trigTriplexPow`, which the power sweep in
 *      row 3 also needs — powers other than 8 have no closed form in the
 *      shipped code, deliberately.) The OTHER trig-free candidate — three
 *      triplex squarings — is a DIFFERENT MAP, not an optimisation, and the
 *      number below says how different.
 *   3. Does the JULIABULB earn a persisted form flag, where the Juliabox
 *      failed to (`escape-de.ts`'s "WHY NOT BOTH FORMS")? Row 2 renders it
 *      from a local prototype and the constant sweep prices it the same way
 *      `escape-form-sweep.harness.ts` priced the Juliabox: ball fill against
 *      |c|. Verdict in that table's own commentary.
 *
 * The Mandelbulb panels run the REAL estimator. Everything else is a
 * deliberate throwaway local — the same idiom the sibling harnesses use for
 * options the codebase has not paid mirrors for.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/bulb-preview.harness.ts
 * Writes: `scripts/out/bulb-preview.png`
 */
import {
  buildBulbDE,
  estimateBulbDistance,
  BULB_ITERATIONS,
  BULB_POWER,
  BULB_STEP_SCALE,
} from "../src/fractal/bulb-de";
import type { BulbDE } from "../src/fractal/bulb-de";
import {
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  estimateEscapeDistance,
} from "../src/fractal/escape-de";
import {
  buildQJuliaDE,
  estimateQJuliaDistance,
} from "../src/fractal/qjulia-de";
import { triplexPow8 } from "../src/fractal/variations";
import type { Transform, Vec3 as CoreVec3 } from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

const SIZE = 420;

/** A single pure triplex-power map, the shape `analyzeBulbSystem` admits. */
function bulbSystem(
  t: CoreVec3 = [0, 0, 0],
  extra: Partial<Transform> = {},
): Transform {
  return {
    id: 1,
    position: t,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "bulb", weight: 1 }],
    ...extra,
  };
}

/**
 * The White/Nylander power in its TRIGONOMETRIC form, at any power — the
 * reference `variations.ts`'s `triplexPow8` is an exact algebraic rewrite of,
 * and the only form that generalises: `triplexPow8`'s Chebyshev coefficients
 * are specific to 8, which is exactly why the power is not a document field.
 */
function trigTriplexPow(x: number, y: number, z: number, power: number): Vec3 {
  const r = Math.hypot(x, y, z);
  if (r === 0) return [0, 0, 0];
  const theta = Math.acos(Math.max(-1, Math.min(1, z / r)));
  const phi = Math.atan2(y, x);
  const zr = Math.pow(r, power);
  const st = Math.sin(theta * power);
  return [
    zr * st * Math.cos(phi * power),
    zr * st * Math.sin(phi * power),
    zr * Math.cos(theta * power),
  ];
}

/**
 * The rejected trig-free candidate: the triplex SQUARE applied three times.
 * Cheap and tempting, and not the same map — triplex multiplication is not
 * associative, and squaring re-canonicalises the polar angle into `[0, π]`
 * whenever it leaves, flipping the azimuth by π as it does. Kept as the
 * refutation's executable record (the disagreement rate is measured below).
 */
function triplexSquare(x: number, y: number, z: number): Vec3 {
  const a = x * x + y * y;
  const rho = Math.sqrt(a);
  const inv = rho > 0 ? 1 / rho : 0;
  const u = x * inv;
  const v = y * inv;
  return [2 * z * rho * (u * u - v * v), 2 * z * rho * (2 * u * v), z * z - a];
}

/**
 * A general-power bulb estimator — the SHIPPED loop with the trig power
 * substituted and the form switchable. `julia: false` is `estimateBulbDistance`
 * at `M = I` (power 8 aside); `julia: true` is the fixed-constant form this
 * harness is here to price.
 */
function prototypeDE(
  power: number,
  julia: boolean,
  c: Vec3,
  bailout = 4,
  iterations = BULB_ITERATIONS,
): DistanceEstimator {
  return (p) => {
    let [x, y, z] = p;
    let dr = 1;
    let r = Math.hypot(x, y, z);
    for (let i = 0; i < iterations && r <= bailout; i++) {
      dr = power * Math.pow(r, power - 1) * dr + (julia ? 0 : 1);
      const [vx, vy, vz] = trigTriplexPow(x, y, z, power);
      x = vx + (julia ? c[0] : p[0]);
      y = vy + (julia ? c[1] : p[1]);
      z = vz + (julia ? c[2] : p[2]);
      r = Math.hypot(x, y, z);
    }
    return r <= 1 ? 0 : (0.5 * r * Math.log(r)) / dr;
  };
}

/**
 * How much of the marching ball the object fills, and how far it reaches —
 * `escape-form-sweep.harness.ts`'s `extent`, with the radius passed in
 * because the bulb family's marching ball is per-system (~1.1) rather than a
 * shared constant. "Interior" is the marcher's own view of inside: a DE
 * collapsed to nothing because `dr` ran away.
 */
function extent(
  de: DistanceEstimator,
  radius: number,
): { fillPct: number; reach: number } {
  const N = 41;
  const R = 2 * radius;
  let inBall = 0;
  let interiorInBall = 0;
  let maxR = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        const p: Vec3 = [
          -R + (2 * R * i) / (N - 1),
          -R + (2 * R * j) / (N - 1),
          -R + (2 * R * k) / (N - 1),
        ];
        const r = Math.hypot(p[0], p[1], p[2]);
        const interior = de(p) < 1e-3;
        if (r <= radius) {
          inBall++;
          if (interior) interiorInBall++;
        }
        if (interior) maxR = Math.max(maxR, r);
      }
    }
  }
  return { fillPct: (100 * interiorInBall) / inBall, reach: maxR / radius };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function ballQueries(n: number, radius: number, seed: number): Vec3[] {
  const rng = seeded(seed);
  const out: Vec3[] = [];
  while (out.length < n) {
    const p: Vec3 = [
      (rng() * 2 - 1) * radius,
      (rng() * 2 - 1) * radius,
      (rng() * 2 - 1) * radius,
    ];
    if (Math.hypot(...p) <= radius) out.push(p);
  }
  return out;
}

/**
 * Independent membership oracle: does the orbit `y <- M V(y) + y_0` stay
 * bounded for a budget far past the estimator's own? Written from the map,
 * not from anything `bulb-de.ts` does — but through the SAME power
 * implementation, deliberately. A forward power-8 orbit multiplies any
 * perturbation by `8r⁷` per step, so a trig-vs-polynomial oracle disagrees
 * with the estimator about membership in a thin shell around the boundary
 * (measured at 0.22% of the ball) — real chaos, not an estimator defect, and
 * it swamps the overshoot signal this oracle exists to measure. Same lesson
 * fr-dlxh learned for the escape kernels' agreement legs.
 */
function inSet(de: BulbDE, p: Vec3, budget = 400, bail = 64): boolean {
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
    if (!Number.isFinite(r) || r > bail) return false;
  }
  return true;
}

interface Entry {
  label: string;
  de: DistanceEstimator;
  radius: number;
}

describe("fr-7u8t.7 Mandelbulb preview", () => {
  it("renders the shipped estimator, the Juliabulb prototype, and a power sweep", () => {
    const classic = buildBulbDE([bulbSystem()]);
    const offset = buildBulbDE([bulbSystem([0.2, -0.1, 0.3])]);
    const rotated = buildBulbDE([
      bulbSystem([0, 0, 0], { rotation: [0.4, -0.8, 0.3] }),
    ]);

    const entries: Entry[] = [
      // Row 1 — the SHIPPED estimator. The textbook object, then the two
      // knobs the document already has.
      {
        label: "SHIPS — Mandelbulb, t = 0 (the textbook object)",
        de: (p) => estimateBulbDistance(classic, p),
        radius: classic.boundingRadius,
      },
      {
        label: "SHIPS — t = (0.2, -0.1, 0.3): the pre-power offset deforms",
        de: (p) => estimateBulbDistance(offset, p),
        radius: offset.boundingRadius,
      },
      {
        label: "SHIPS — rotation (0.4, -0.8, 0.3): M does not commute with V",
        de: (p) => estimateBulbDistance(rotated, p),
        radius: rotated.boundingRadius,
      },
      // Row 2 — the JULIABULB, from the prototype, spread across its whole
      // usable range: the near-sphere end (`c = 0` IS the unit ball — every
      // orbit inside it converges to 0), the structured band, and the polar
      // direction just before the set collapses (see the constant sweep).
      {
        label: "PROTOTYPE — Juliabulb c = (0.2, 0, 0), |c| = 0.2",
        de: prototypeDE(8, true, [0.2, 0, 0]),
        radius: 1.35,
      },
      {
        label: "PROTOTYPE — Juliabulb c = (0.28, 0.42, 0.18), |c| = 0.53",
        de: prototypeDE(8, true, [0.28, 0.42, 0.18]),
        radius: 1.35,
      },
      {
        label:
          "PROTOTYPE — Juliabulb c = (0, 0, 0.65) — the polar direction, at the edge of collapse",
        de: prototypeDE(8, true, [0, 0, 0.65]),
        radius: 1.35,
      },
      // Row 3 — the POWER sweep, from the prototype: the evidence a later
      // "should power be a document knob" bead would start from.
      {
        label: "PROTOTYPE — Mandelbulb power 3",
        de: prototypeDE(3, false, [0, 0, 0]),
        radius: 1.45,
      },
      {
        label: "PROTOTYPE — Mandelbulb power 5",
        de: prototypeDE(5, false, [0, 0, 0]),
        radius: 1.25,
      },
      {
        label: "PROTOTYPE — Mandelbulb power 12",
        de: prototypeDE(12, false, [0, 0, 0]),
        radius: 1.15,
      },
    ];

    const panels: PanelStats[] = entries.map((entry, i) => {
      const { fillPct, reach } = extent(entry.de, entry.radius);
      const panel = renderPreview(
        {
          de: entry.de,
          boundingRadius: entry.radius,
          stepScale: BULB_STEP_SCALE,
          zoom: 0.5,
        },
        SIZE,
      );
      console.log(
        `  ${i}. ${entry.label}\n` +
          `     hits ${((panel.hits / (SIZE * SIZE)) * 100).toFixed(1)}%  ` +
          `ball fill ${fillPct.toFixed(1)}%  ` +
          `reach ${reach.toFixed(2)}xR  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}  ${panel.ms}ms`,
      );
      return panel;
    });

    console.log(`  wrote ${writeContactSheet(panels, 3, "bulb-preview.png")}`);
    // Guard the guard: a blank panel would make the sheet meaningless.
    panels.forEach((p, i) => {
      expect(p.hits, `panel ${i} rendered nothing`).toBeGreaterThan(
        0.01 * SIZE * SIZE,
      );
    });
  });

  it("prices the trig-free rewrite against the trig reference", () => {
    const de = buildBulbDE([bulbSystem()]);
    const queries = ballQueries(200000, de.boundingRadius, 5);

    /** `estimateBulbDistance` with the trig power substituted, term for term. */
    const trigEstimate = (p: Vec3): number => {
      const m = de.m;
      const cx = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + de.t[0];
      const cy = m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + de.t[1];
      const cz = m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + de.t[2];
      let [yx, yy, yz] = [cx, cy, cz];
      let dr = de.sigmaMax;
      let r = Math.sqrt(yx * yx + yy * yy + yz * yz);
      for (let i = 0; i < BULB_ITERATIONS && r <= de.bailout; i++) {
        dr =
          BULB_POWER * Math.pow(r, BULB_POWER - 1) * de.sigmaMax * dr +
          de.sigmaMax;
        const [vx, vy, vz] = trigTriplexPow(yx, yy, yz, BULB_POWER);
        yx = m[0] * vx + m[1] * vy + m[2] * vz + cx;
        yy = m[3] * vx + m[4] * vy + m[5] * vz + cy;
        yz = m[6] * vx + m[7] * vy + m[8] * vz + cz;
        r = Math.sqrt(yx * yx + yy * yy + yz * yz);
      }
      return r <= 1 ? 0 : (0.5 * r * Math.log(r)) / dr;
    };

    const time = (f: (p: Vec3) => number): number => {
      let acc = 0;
      for (const p of queries) acc += f(p);
      const started = Date.now();
      for (const p of queries) acc += f(p);
      const ms = Date.now() - started;
      expect(Number.isFinite(acc)).toBe(true);
      return (1000 * ms) / queries.length;
    };

    // The family, on one query set: the bead expected the bulb to be the
    // expensive one.
    const fold = buildEscapeDE([
      {
        id: 1,
        position: [0.4, 0.3, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
      },
    ]);
    const qj = buildQJuliaDE([
      {
        id: 1,
        position: [-0.2, 0.6, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "qsquare", weight: 1 }],
      },
    ]);

    const polyUs = time((p) => estimateBulbDistance(de, p));
    const trigUs = time(trigEstimate);
    const foldUs = time((p) => estimateEscapeDistance(fold, p));
    const qjUs = time((p) => estimateQJuliaDistance(qj, [p[0], p[1], p[2], 0]));

    // Agreement: the raw power (an exact algebraic identity) and the whole
    // estimate (the same identity through a chaotic orbit).
    let worstPow = 0;
    let worstDe = 0;
    let squaringDisagreements = 0;
    for (const p of queries) {
      const a = triplexPow8(...p);
      const b = trigTriplexPow(p[0], p[1], p[2], 8);
      const scale = Math.max(1e-30, Math.hypot(...b));
      worstPow = Math.max(
        worstPow,
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / scale,
      );
      const s = triplexSquare(...triplexSquare(...triplexSquare(...p)));
      if (
        Math.hypot(a[0] - s[0], a[1] - s[1], a[2] - s[2]) /
          Math.max(1e-12, Math.hypot(...a)) >
        1e-6
      ) {
        squaringDisagreements++;
      }
      worstDe = Math.max(
        worstDe,
        Math.abs(estimateBulbDistance(de, p) - trigEstimate(p)) /
          Math.max(1e-9, trigEstimate(p)),
      );
    }

    let iterations = 0;
    let zero = 0;
    for (const p of queries) {
      if (estimateBulbDistance(de, p) === 0) zero++;
      // Orbit length: re-run the loop's exit condition on the trig twin.
      const m = de.m;
      let [x, y, z] = [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + de.t[0],
        m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + de.t[1],
        m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + de.t[2],
      ];
      const [cx, cy, cz] = [x, y, z];
      let r = Math.hypot(x, y, z);
      for (let i = 0; i < BULB_ITERATIONS && r <= de.bailout; i++) {
        const [vx, vy, vz] = triplexPow8(x, y, z);
        x = m[0] * vx + m[1] * vy + m[2] * vz + cx;
        y = m[3] * vx + m[4] * vy + m[5] * vz + cy;
        z = m[6] * vx + m[7] * vy + m[8] * vz + cz;
        r = Math.hypot(x, y, z);
        iterations++;
      }
    }

    console.log(
      `  COST (${queries.length} uniform queries in the bulb's own marching ball)\n` +
        `    bulb, polynomial (SHIPS)  ${polyUs.toFixed(3)} us/eval\n` +
        `    bulb, trigonometric       ${trigUs.toFixed(3)} us/eval  (${(trigUs / polyUs).toFixed(1)}x)\n` +
        `    escape-de fold            ${foldUs.toFixed(3)} us/eval\n` +
        `    qjulia-de quaternion      ${qjUs.toFixed(3)} us/eval\n` +
        `    orbit iterations ${(iterations / queries.length).toFixed(2)} avg, ` +
        `${((100 * zero) / queries.length).toFixed(1)}% of queries interior\n` +
        `  AGREEMENT\n` +
        `    triplexPow8 vs trig: worst relative ${worstPow.toExponential(2)} (an exact rewrite; f64 rounding only)\n` +
        `    whole estimate:      worst relative ${worstDe.toExponential(2)} (the same rewrite through a chaotic orbit)\n` +
        `    three triplex SQUARINGS disagree with the power on ` +
        `${((100 * squaringDisagreements) / queries.length).toFixed(1)}% of queries — a different map, not an optimisation`,
    );
  });

  it("sweeps the march step scale against a membership oracle", () => {
    // The bead predicted the fold family's damping would come back, because
    // the triplex power is not conformal. It is right about the estimator
    // (see the module doc's azimuthal U7 factor) and wrong about the
    // remedy: damping does not remove the residual, and at frame level the
    // full step loses no geometry at all.
    const systems: [string, Transform][] = [
      ["classic t=0    ", bulbSystem()],
      ["t=(0.2,-0.1,0.3)", bulbSystem([0.2, -0.1, 0.3])],
      [
        "rotated        ",
        bulbSystem([0, 0, 0], { rotation: [0.4, -0.8, 0.3] }),
      ],
      ["scaled 1.25    ", bulbSystem([0, 0, 0], { scale: [1.25, 1.25, 1.25] })],
    ];
    const scales = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
    for (const [label, system] of systems) {
      const de = buildBulbDE([system]);
      const queries = ballQueries(4000, de.boundingRadius * 1.05, 99);
      const rng = seeded(1234);
      const cells: string[] = [];
      let excluded = 0;
      let probed = 0;
      for (const scale of scales) {
        excluded = 0;
        probed = 0;
        let overshoots = 0;
        for (const p of queries) {
          const d = estimateBulbDistance(de, p);
          if (!(d > 1e-4 && d < 0.6)) continue;
          // The estimator says "outside by d"; if the 400-iteration oracle
          // says this very point is INSIDE, the two disagree about
          // membership and no step length is under test (the chaotic shell —
          // see `inSet`).
          if (inSet(de, p)) {
            excluded++;
            continue;
          }
          probed++;
          for (let k = 0; k < 24; k++) {
            const a = rng() * 2 - 1;
            const b = rng() * 2 - 1;
            const c = rng() * 2 - 1;
            const n = Math.hypot(a, b, c) || 1;
            const s = (scale * d) / n;
            if (inSet(de, [p[0] + a * s, p[1] + b * s, p[2] + c * s])) {
              overshoots++;
              break;
            }
          }
        }
        cells.push(
          `${scale}:${((100 * overshoots) / Math.max(1, probed)).toFixed(2)}%`,
        );
      }
      console.log(
        `  ${label}  ${cells.join("  ")}   (probed ${probed}, ${excluded} excluded as boundary-chaotic)`,
      );
    }

    // Frame level: the same question a marcher actually asks. Compare each
    // step scale's frame against a 0.2-step reference, and put the two
    // SHIPPED estimators beside it for calibration.
    const frameRow = (
      label: string,
      de: DistanceEstimator,
      radius: number,
      shipped: number,
    ) => {
      const size = 240;
      const at = (stepScale: number) =>
        renderPreview(
          { de, boundingRadius: radius, stepScale, zoom: 0.5 },
          size,
        );
      const ref = at(0.2);
      const cells = [1, 0.7, 0.5, 0.35].map((s) => {
        const panel = at(s);
        let differing = 0;
        for (let i = 0; i < ref.rgb.length; i += 3) {
          const d =
            (Math.abs(panel.rgb[i] - ref.rgb[i]) +
              Math.abs(panel.rgb[i + 1] - ref.rgb[i + 1]) +
              Math.abs(panel.rgb[i + 2] - ref.rgb[i + 2])) /
            3;
          if (d > 12) differing++;
        }
        return (
          `${s === shipped ? "*" : " "}${s}: hits ${((100 * panel.hits) / (size * size)).toFixed(1)}% ` +
          `steps/ray ${(panel.steps / (size * size)).toFixed(1)} ` +
          `differing ${((100 * differing) / (size * size)).toFixed(2)}%`
        );
      });
      console.log(
        `  ${label}\n    ref(0.2) hits ${((100 * ref.hits) / (size * size)).toFixed(1)}%, ` +
          `steps/ray ${(ref.steps / (size * size)).toFixed(1)}\n    ` +
          cells.join("\n    "),
      );
    };

    const bulb = buildBulbDE([bulbSystem()]);
    const fold = buildEscapeDE([
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
      },
    ]);
    const qj = buildQJuliaDE([
      {
        id: 1,
        position: [-0.2, 0.6, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "qsquare", weight: 1 }],
      },
    ]);
    frameRow(
      "BULB (new, ships at 1.0)",
      (p) => estimateBulbDistance(bulb, p),
      bulb.boundingRadius,
      1,
    );
    frameRow(
      `FOLD (ships at ${String(ESCAPE_STEP_SCALE)})`,
      (p) => estimateEscapeDistance(fold, p),
      fold.boundingRadius,
      ESCAPE_STEP_SCALE,
    );
    frameRow(
      "QUATERNION JULIA (ships at 1.0)",
      (p) => estimateQJuliaDistance(qj, [p[0], p[1], p[2], 0]),
      qj.boundingRadius,
      1,
    );
  });

  it("checks BULB_STEP_SCALE against the pictures, not just the counts", () => {
    // fr-7u8t.8's lesson, applied to this module's own constant: the fold's
    // 0.7 had been tuned against a 94%-solid blob where every ray hit on its
    // first step, so the damping was never exercised — and against the real
    // object it visibly overshot (hits 62.0% at 1.0 climbing to 84.3% at
    // 0.35). The same test here, at a CLOSE pose where thin features and
    // creases are what the marcher has to resolve rather than a silhouette:
    // hits climbing as the scale falls means the full step is stepping past
    // surface; a flat count means the step length is not the limiting factor
    // and the residual is sampling. The sheet is the tie-breaker either way.
    const de = buildBulbDE([bulbSystem()]);
    const panels = [1, 0.9, 0.7, 0.5, 0.35, 0.2].map((stepScale) => {
      const panel = renderPreview(
        {
          de: (p) => estimateBulbDistance(de, p),
          boundingRadius: de.boundingRadius,
          stepScale,
          zoom: 0.34,
        },
        SIZE,
      );
      console.log(
        `  stepScale ${stepScale}  hits ${((panel.hits / (SIZE * SIZE)) * 100).toFixed(2)}%  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}  ${panel.ms}ms`,
      );
      return panel;
    });
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "bulb-step-scale.png")}`,
    );
  });

  it("scans the Juliabulb's constant space for a reason to keep it", () => {
    // `escape-form-sweep.harness.ts`'s question, one object over: is the
    // fixed-constant form worth a persisted document flag? The Juliabox
    // failed because it was a sphere at 97/93/77/60/23% fill across
    // everything a user would author. The bulb's numbers are below.
    const R = 1.35;
    for (const dir of [
      [1, 0, 0],
      [0, 0, 1],
      [0.577, 0.577, 0.577],
    ] as Vec3[]) {
      const row = [0.1, 0.2, 0.35, 0.5, 0.7, 0.9, 1.1].map((mag) => {
        const c: Vec3 = [dir[0] * mag, dir[1] * mag, dir[2] * mag];
        const fill = extent(prototypeDE(8, true, c), R).fillPct;
        return `${mag}:${fill.toFixed(1)}%`;
      });
      console.log(`  c along (${dir.join(",")}):  ${row.join("  ")}`);
    }
    const mandel = buildBulbDE([bulbSystem()]);
    const m = extent(
      (p) => estimateBulbDistance(mandel, p),
      mandel.boundingRadius,
    );
    console.log(
      `  Mandelbulb (t = 0, no constant at all): ${m.fillPct.toFixed(1)}% fill, reach ${m.reach.toFixed(2)}xR`,
    );
  });
});
