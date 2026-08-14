/**
 * fr-qi9c: does the Mandelbox sphere fold's ball radius earn a DOCUMENT
 * parameter?
 *
 * `variations.ts`'s `sphereFoldFactor` pins the classic `mR² = 0.25`,
 * `fR² = 1`, and `foldAxis` pins the box wall at 1. Un-freezing them would
 * put the FIRST per-variation parameter into `Variation` (`{type, weight}`
 * today, and every producer — the editor, `random-system`, `mutate-system`,
 * `flame-file`, `morph`'s union-by-type, `persist`'s validator, the GPU
 * flame kernels' weight-only lanes — treats a variation list as a
 * type -> weight MAP), plus the ten oracle-pinned fold mirrors. This sheet
 * exists to say whether that buys a new SHAPE before anyone pays for it.
 *
 * THE TRAP THIS SHEET IS BUILT AROUND. The fold has three lengths — `mR`,
 * `fR`, the box wall — but only two DIMENSIONLESS RATIOS can be new,
 * because uniform pre-scale is equivariant through both folds:
 *
 *     B_1(k·q)          =  k · B_{1/k}(q)
 *     S_{0.5,1}(k·q)    =  k · S_{0.5/k,1/k}(q)
 *     MB_{0.5,1,1}(k·q) =  k · MB_{0.5/k,1/k,1/k}(q)
 *
 * so `w·V(M p + t)` with `M = k·A` ALREADY renders the whole family whose
 * three lengths scale together — that is just the affine part scaling the
 * object, which every author has today. Carried through the escape orbit
 * (`v <- w·V(Mv + t) + p`, `v_0 = p`) with `v = k·u`, `p = k·q`, `t = k·τ`,
 * the same substitution gives the SAME system at apparatus `1/k` and
 * bailout `B/k` — so the whole non-escaping SET scales by `k` and nothing
 * about its shape moves. Verified before this sheet was written: the map
 * identity holds to 1.6e-15 relative over 200k random `(q, k)`, and the
 * ORBIT carries it — 0 escape-count disagreements in 105k samples at
 * `s = 1/2` and `s = 2` (exact in binary f64), 1-4 at `s = 0.7, 1.4`, which
 * are the boundary-straddling rounding flips a chaotic orbit always
 * carries.
 *
 * A panel that merely LOOKS different is therefore not evidence. Every arm
 * here is framed on its OWN measured object radius ({@link objectRadius},
 * a 256-direction inward sphere trace — fine-resolution where the escape
 * family's usual 35³ grid probe would quantize the normalizer by ~3%) at a
 * fixed zoom, so a pure rescale produces the same picture, and the verdict
 * number is {@link maskIoU} against the shipped arm — the object-mask IoU
 * the project already uses as its same-object criterion (fr-dlxh's 4D
 * compute verdict read 0.996). High IoU after normalization = a zoom you
 * already have = do not pay the schema.
 *
 * GUARD THE GUARD. `it("conjugation control")` sweeps all three lengths
 * TOGETHER (plus the bailout and `t`, which the substitution also scales).
 * Its IoU must read ~1: if it does not, the normalization is broken and
 * every other number on this sheet is meaningless. It is held to
 * `s ∈ [0.5, 2]` for a reason — `de-preview.ts`'s hit test is
 * `d < eps·max(t, 1)`, whose `max(·, 1)` kink is the one part of the
 * marcher that is NOT scale-covariant, and these scales keep every marched
 * `t` above 1.
 *
 * THE ESTIMATOR. {@link paramEscapeDE} is `escape-de.ts`'s `runEscapeOrbit`
 * with the three lengths and the bailout lifted out of the constants — the
 * `juliaFormDE` idiom `escape-form-sweep.harness.ts` used for the form it
 * had not paid six mirrors for. It is not TRUSTED to be that estimator:
 * `it("pins the parameterized fold")` asserts it returns
 * `estimateEscapeDistance`'s value TO THE BIT at shipped parameters over
 * 24k queries, so a reconstruction error cannot pass as a measurement.
 * Single-link, unsymmetrised systems only (it throws otherwise): fr-s04t's
 * chain cycle is the identity at one link, and the question here is the
 * fold's own parameters, not the chain's.
 *
 * FOUR SHEETS, because the parameter would land in two very different
 * roles and they can disagree:
 *   1. `spherefold-magnification.png` — `fR²/mR²` (the ×4 inner
 *      inflation), the ratio no conjugation reaches. `mR = fR` is the
 *      identity end: the mid shell closes, the factor is `fR²/fR²`
 *      everywhere and the sphere fold vanishes, leaving the box fold
 *      alone — so arm 0 is a principled end of the axis, not an arbitrary
 *      extreme.
 *   2. `spherefold-ball-vs-box.png` — `fR/wall`, the second ratio: how
 *      much of the folding is mirrors and how much is lens. Magnification
 *      is held at the shipped 4× so this axis moves one ratio only.
 *   3. `spherefold-conjugation.png` — the control above.
 *   4. `spherefold-lens.png` — the ONE-SHOT case, which is the shape a
 *      `mandelbox` FINAL transform has (`chaos-game.ts`'s `plotPoint`
 *      bends each plotted point once and never feeds it back), measured
 *      on a hand-authored affine attractor as an occupancy IoU over the
 *      scale-normalized cloud. An iterated fold compounds its parameters;
 *      a lens applied once may not, and the document parameter would be
 *      the same field for both. No preset carries a pure-fold FINAL, so
 *      the base system is authored here rather than loaded.
 *
 * A BLANK ARM IS A FINDING, not a failure: a parameter value that empties
 * the set is exactly what this sheet is looking for. Only the SHIPPED
 * reference panel of each row is asserted non-blank, because the IoU
 * column is meaningless without it.
 *
 * THE VERDICT (measured, this sheet's own numbers):
 *
 * The control is exact — IoU 1.000 and relief 0.0000 at every scale across
 * a 4x span of apparatus size, five visually identical panels, with
 * `radius/s` reading 3.941 to three decimals at all five. A pure rescale
 * is INVISIBLE to this instrument, so every number below is a shape
 * difference and not a zoom.
 *
 * BOTH RATIOS ARE REAL PARAMETERS. The `fR/wall` axis is the stronger of
 * the two: growing the ball past the box takes the w=2 object from a
 * solid pitted Mandelbox to a sparse gasket of separated clusters —
 * IoU 0.215 at `fR = 2`, with hits collapsing 30.4% -> 11.5%. The
 * magnification axis moves the same object over IoU 0.69-0.87.
 *
 * SILHOUETTE IS NOT THE WHOLE STORY, and this is why {@link relief}
 * exists. The `w = -1.5` cube rows sit at IoU 0.93-0.98 THROUGHOUT — the
 * silhouette is a cube whatever the parameters — while their faces go
 * from nearly featureless to deep concentric rosettes: 35.6% of shared
 * pixels off by >2% of the radius on the magnification axis, 63.6% at
 * `fR = 2`. Read the two columns together; IoU alone under-reports.
 *
 * THE ONE-SHOT LENS IS THE MOST SENSITIVE ROLE OF ALL, which is the
 * result this sheet did not expect: a lens applied once cannot compound
 * its parameters the way 30 iterations can, and it moves FURTHER anyway.
 * Across the same `mR` range the cloud's occupancy IoU against the
 * shipped arm runs 0.16-0.31 — six essentially distinct objects. The
 * bracket that makes the scale of that concrete, all within the one
 * metric: at `mR = fR` the lens is exactly the identity on this attractor
 * (IoU-vs-unlensed 1.000, since the attractor lies inside the box and the
 * sphere fold has closed), and moving the ratio from the shipped 4x to
 * 16x moves the cloud ALMOST AS FAR as deleting the lens altogether
 * (0.214 against 0.164).
 *
 * So the parameter earns its schema cost, and it earns it MOST in the
 * FINAL-transform role — the one place a reader would have guessed a
 * once-applied map would be bland. What it would cost is unchanged and
 * lives on fr-qi9c: the first per-variation parameter in the document,
 * ten oracle-pinned fold mirrors, `SPHEREFOLD_LIPSCHITZ` becoming
 * `fR²/mR²` (which moves the surface DE's eligibility gate with the
 * knob), and `SPHEREFOLD_MID_MIN_R` scaling with `fR²`. The GPU wire
 * needs nothing: `GpuMap`'s `p1` lane and `GpuMap4`'s carry two free f32
 * each, so a packed `(mR², fR²)` pair fits inside the frozen strides.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/spherefold-radius-sweep.harness.ts
 * Writes: `scripts/out/spherefold-*.png`
 */
import {
  buildEscapeDE,
  estimateEscapeDistance,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import {
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import { runChaosGame } from "../src/fractal/chaos-game";
import { mulberry32 } from "../src/fractal/rng";
import type { Transform } from "../src/fractal/types";
import { renderPreview, writeContactSheet, PREVIEW_HIT } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

const SIZE = 320;
/** The escape family's pose (`escape-chain.harness.ts`, `chain-speckle`),
 * so these panels read beside those sheets. Fixed across every arm — the
 * framing must not move when the object does. */
const EYE: Vec3 = [1.348, 0.957, 1.565];
const ZOOM = 0.52;

/**
 * The three lengths the shipped fold bakes in, plus the bailout the orbit
 * tests against. `wall` is `foldAxis`'s reflection plane; `mR`/`fR` are
 * `sphereFoldFactor`'s minimum and fixed radii.
 */
interface FoldParams {
  mR: number;
  fR: number;
  wall: number;
  bailout: number;
}

const SHIPPED: FoldParams = {
  mR: 0.5,
  fR: 1,
  wall: 1,
  bailout: ESCAPE_TIME_RADIUS,
};

/** The two ratios that survive conjugation — the only things a parameter
 * could actually buy. Printed on every row so the sheet reads as a sweep
 * of THEM rather than of three correlated numbers. */
const magnification = (fp: FoldParams) => (fp.fR * fp.fR) / (fp.mR * fp.mR);
const ballOverBox = (fp: FoldParams) => fp.fR / fp.wall;

/** A single pure-fold map — the shape `analyzeEscapeSystem` admits, and
 * `presets.ts`'s `escapeMandelbox` recipe verbatim. */
function foldSystem(weight: number, position: Vec3): Transform {
  return {
    id: 1,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight }],
  };
}

/**
 * `escape-de.ts`'s `runEscapeOrbit` with {@link FoldParams} lifted out of
 * the constants: `v <- w·V(Mv + t) + p` seeded at `v_0 = p`, one shared
 * scalar Buddhi/Rrrola derivative floored by `+ 1` per link, bailout tested
 * once per step. `derivGrowth` is deliberately reused unchanged — it is
 * `|w|·sigma_max(M)`, which no fold length enters; the sphere fold's
 * contribution rides the per-step `localL`, and that picks up the new
 * parameters on its own.
 *
 * Pinned bit-exact against the shipped estimator at {@link SHIPPED} by the
 * first `it` below, so nothing here rests on the copy being faithful by
 * inspection.
 */
function paramEscapeDE(de: EscapeDE, fp: FoldParams): DistanceEstimator {
  if (de.links.length !== 1) {
    throw new Error("paramEscapeDE: single-link systems only (see module doc)");
  }
  if (de.symmetryOrder > 1) {
    // The shipped orbit seeds AND offsets from the wedge-folded query; this
    // copy does neither, so a kaleidoscope would silently render a
    // different object than the pin certifies.
    throw new Error("paramEscapeDE: unsymmetrised systems only");
  }
  const m = de.m;
  const { mR, fR, wall, bailout } = fp;
  const mR2 = mR * mR;
  const fR2 = fR * fR;
  const foldAxis = (t: number) => 2 * Math.max(-wall, Math.min(wall, t)) - t;
  return (p) => {
    const [qx, qy, qz] = p;
    let vx = qx;
    let vy = qy;
    let vz = qz;
    let dr = 1;
    let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    for (let step = 0; step < ESCAPE_TIME_ITERATIONS && r <= bailout; step++) {
      let yx = m[0] * vx + m[1] * vy + m[2] * vz + de.t[0];
      let yy = m[3] * vx + m[4] * vy + m[5] * vz + de.t[1];
      let yz = m[6] * vx + m[7] * vy + m[8] * vz + de.t[2];
      let localL = 1;
      if (de.foldKind !== SURFACE_FOLD_SPHEREFOLD) {
        yx = foldAxis(yx);
        yy = foldAxis(yy);
        yz = foldAxis(yz);
      }
      if (de.foldKind !== SURFACE_FOLD_BOXFOLD) {
        const f =
          fR2 / Math.max(mR2, Math.min(fR2, yx * yx + yy * yy + yz * yz));
        yx *= f;
        yy *= f;
        yz *= f;
        localL = f;
      }
      vx = de.w * yx + qx;
      vy = de.w * yy + qy;
      vz = de.w * yz + qz;
      dr = de.derivGrowth * localL * dr + 1;
      r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    return r / dr;
  };
}

/** The same fold applied ONCE — a `mandelbox` FINAL transform's plot-time
 * lens `w·V(M p + t)`, which is what `chaos-game.ts`'s `plotPoint` does to
 * every plotted point. The `EscapeDE` is used purely as a carrier for the
 * `composeAffine` the app itself would build. */
function paramFoldOnce(de: EscapeDE, fp: FoldParams, p: Vec3, out: Vec3): void {
  const m = de.m;
  const mR2 = fp.mR * fp.mR;
  const fR2 = fp.fR * fp.fR;
  const wall = fp.wall;
  const fold = (t: number) => 2 * Math.max(-wall, Math.min(wall, t)) - t;
  let x = fold(m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + de.t[0]);
  let y = fold(m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + de.t[1]);
  let z = fold(m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + de.t[2]);
  const f = fR2 / Math.max(mR2, Math.min(fR2, x * x + y * y + z * z));
  x *= f;
  y *= f;
  z *= f;
  out[0] = de.w * x;
  out[1] = de.w * y;
  out[2] = de.w * z;
}

/** 256 near-uniform directions (Fibonacci sphere) — deterministic, and the
 * same set for every arm, so a radius difference is the object's and not
 * the sampling's. */
const DIRECTIONS: Vec3[] = (() => {
  const n = 256;
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i): Vec3 => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    return [Math.cos(th) * rad, y, Math.sin(th) * rad];
  });
})();

/**
 * The object's circumscribed radius, by sphere-tracing INWARD from the
 * bailout ball along {@link DIRECTIONS} and taking the furthest first hit.
 * Every quantity scales with `R0`, so under the conjugation control this
 * returns exactly `s ×` the shipped arm's radius — which is what makes a
 * per-arm camera a normalization rather than one more free variable.
 */
function objectRadius(de: DistanceEstimator, R0: number): number {
  const eps = R0 * 1e-4;
  let best = 0;
  for (const d of DIRECTIONS) {
    let t = 0;
    for (let i = 0; i < 400 && t < R0; i++) {
      const s = R0 - t;
      const v = de([d[0] * s, d[1] * s, d[2] * s]);
      if (v < eps) {
        best = Math.max(best, s);
        break;
      }
      t += Math.max(v * ESCAPE_STEP_SCALE, eps);
    }
  }
  return best;
}

/** Intersection-over-union of two panels' HIT masks — the project's
 * same-object criterion. Both panels must have been rendered with
 * `collect`. */
function maskIoU(a: PanelStats, b: PanelStats): number {
  const sa = a.status;
  const sb = b.status;
  if (!sa || !sb) throw new Error("maskIoU needs collect: true");
  let inter = 0;
  let union = 0;
  for (let i = 0; i < sa.length; i++) {
    const ha = sa[i] === PREVIEW_HIT;
    const hb = sb[i] === PREVIEW_HIT;
    if (ha && hb) inter++;
    if (ha || hb) union++;
  }
  return union === 0 ? 1 : inter / union;
}

interface Arm {
  panel: PanelStats;
  /** The measured object radius this arm was framed on. */
  radius: number;
}

/**
 * Surface RELIEF disagreement, the complement {@link maskIoU} needs: over
 * the pixels BOTH arms hit, the hit point's distance from the origin in
 * units of that arm's own object radius — so it is a camera-free,
 * scale-free statement of "how far out is the surface in this direction".
 * Returns its RMS and the fraction of shared pixels differing by more than
 * 2% of the radius.
 *
 * It exists because the sheet's first run measured the cube rows at IoU
 * 0.93-0.98 while their FACES went from nearly featureless to deep
 * concentric rosettes: a mask IoU compares silhouettes, and two objects can
 * share one exactly while sharing no surface at all. Scale-covariant like
 * everything else here, so the conjugation control pins it at ~0 too.
 */
function relief(a: Arm, b: Arm): { rms: number; frac: number } {
  const sa = a.panel.status;
  const sb = b.panel.status;
  const pa = a.panel.hitPos;
  const pb = b.panel.hitPos;
  if (!sa || !sb || !pa || !pb) throw new Error("relief needs collect: true");
  let n = 0;
  let sum = 0;
  let off = 0;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== PREVIEW_HIT || sb[i] !== PREVIEW_HIT) continue;
    const ra =
      Math.hypot(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]) / (a.radius || 1);
    const rb =
      Math.hypot(pb[i * 3], pb[i * 3 + 1], pb[i * 3 + 2]) / (b.radius || 1);
    const d = ra - rb;
    sum += d * d;
    if (Math.abs(d) > 0.02) off++;
    n++;
  }
  return n === 0
    ? { rms: 0, frac: 0 }
    : { rms: Math.sqrt(sum / n), frac: off / n };
}

const reliefCol = (a: Arm, b: Arm): string => {
  const { rms, frac } = relief(a, b);
  return `relief ${rms.toFixed(4)} (${(100 * frac).toFixed(1)}% of shared px >2%)`;
};

/** One arm, framed on its own measured radius at the shared zoom. */
function armPanel(de: DistanceEstimator, R0: number): Arm {
  const radius = objectRadius(de, R0);
  const panel = renderPreview(
    {
      de,
      boundingRadius: radius > 0 ? radius * 1.15 : R0,
      stepScale: ESCAPE_STEP_SCALE,
      eyeOffset: EYE,
      zoom: ZOOM,
      collect: true,
    },
    SIZE,
  );
  return { panel, radius };
}

const hitPct = (p: PanelStats) => ((100 * p.hits) / (SIZE * SIZE)).toFixed(2);

/* ------------------------------------------------------------------ */

describe("fr-qi9c spherefold radius sweep", () => {
  it("pins the parameterized fold to the shipped estimator", () => {
    // The whole sheet rests on paramEscapeDE being runEscapeOrbit with three
    // constants lifted out. Assert it; don't inspect it.
    const rng = mulberry32(0x5f01d);
    for (const w of [2, 3, -1.5]) {
      for (const t of [
        [0, 0, 0],
        [0.4, 0.3, 0.2],
      ] as Vec3[]) {
        const de = buildEscapeDE([foldSystem(w, t)]);
        const local = paramEscapeDE(de, SHIPPED);
        for (let i = 0; i < 4000; i++) {
          const p: Vec3 = [rng() * 12 - 6, rng() * 12 - 6, rng() * 12 - 6];
          expect(
            local(p),
            `w=${w} t=[${t.join(", ")}] p=[${p.join(", ")}]`,
          ).toBe(estimateEscapeDistance(de, p));
        }
      }
    }
  });

  it("sweeps the magnification ratio fR²/mR²", () => {
    const arms = [1.0, 0.8, 0.65, 0.5, 0.35, 0.25];
    const shippedAt = arms.indexOf(SHIPPED.mR);
    const systems: [string, number][] = [
      ["ball w=2   ", 2],
      ["cube w=-1.5", -1.5],
    ];
    const panels: PanelStats[] = [];
    for (const [label, w] of systems) {
      const de = buildEscapeDE([foldSystem(w, [0, 0, 0])]);
      const row = arms.map((mR) => {
        const fp = { ...SHIPPED, mR };
        return armPanel(paramEscapeDE(de, fp), fp.bailout);
      });
      const ref = row[shippedAt];
      row.forEach((arm, i) => {
        const fp = { ...SHIPPED, mR: arms[i] };
        console.log(
          `  ${label}  mR ${arms[i].toFixed(2)}  ` +
            `magnification ${magnification(fp).toFixed(2)}x  ` +
            `radius ${arm.radius.toFixed(3)}  hits ${hitPct(arm.panel)}%  ` +
            `IoU ${maskIoU(arm.panel, ref.panel).toFixed(3)}  ` +
            reliefCol(arm, ref) +
            (i === shippedAt ? "  <- ships" : ""),
        );
      });
      expect(
        ref.panel.hits,
        `${label}: the shipped reference panel is blank, so its IoU column means nothing`,
      ).toBeGreaterThan(0.005 * SIZE * SIZE);
      panels.push(...row.map((a) => a.panel));
    }
    console.log(
      `  wrote ${writeContactSheet(panels, arms.length, "spherefold-magnification.png")}`,
    );
  });

  it("sweeps the ball-vs-box ratio fR/wall", () => {
    const arms = [0.5, 0.7, 1.0, 1.4, 2.0];
    const shippedAt = arms.indexOf(SHIPPED.fR);
    const systems: [string, number][] = [
      ["ball w=2   ", 2],
      ["cube w=-1.5", -1.5],
    ];
    const panels: PanelStats[] = [];
    for (const [label, w] of systems) {
      const de = buildEscapeDE([foldSystem(w, [0, 0, 0])]);
      const row = arms.map((fR) => {
        const fp = { ...SHIPPED, fR, mR: fR / 2 };
        return armPanel(paramEscapeDE(de, fp), fp.bailout);
      });
      const ref = row[shippedAt];
      row.forEach((arm, i) => {
        const fp = { ...SHIPPED, fR: arms[i], mR: arms[i] / 2 };
        console.log(
          `  ${label}  fR ${arms[i].toFixed(2)}  ` +
            `ball/box ${ballOverBox(fp).toFixed(2)}  ` +
            `radius ${arm.radius.toFixed(3)}  hits ${hitPct(arm.panel)}%  ` +
            `IoU ${maskIoU(arm.panel, ref.panel).toFixed(3)}  ` +
            reliefCol(arm, ref) +
            (i === shippedAt ? "  <- ships" : ""),
        );
      });
      expect(
        ref.panel.hits,
        `${label}: the shipped reference panel is blank`,
      ).toBeGreaterThan(0.005 * SIZE * SIZE);
      panels.push(...row.map((a) => a.panel));
    }
    console.log(
      `  wrote ${writeContactSheet(panels, arms.length, "spherefold-ball-vs-box.png")}`,
    );
  });

  it("conjugation control: scaling all three lengths must change nothing", () => {
    // The guard the other sheets are read against. Both ratios are held and
    // every length — mR, fR, wall, the bailout, and t, which the
    // substitution v = k·u also scales — moves together, so the set is the
    // shipped set scaled by s and the per-arm camera must undo it exactly.
    const scales = [0.5, 0.7, 1.0, 1.4, 2.0];
    const shippedAt = scales.indexOf(1.0);
    const t: Vec3 = [0.4, 0.3, 0.2];
    const row = scales.map((s) => {
      const de = buildEscapeDE([foldSystem(2, [t[0] * s, t[1] * s, t[2] * s])]);
      const fp: FoldParams = {
        mR: SHIPPED.mR * s,
        fR: SHIPPED.fR * s,
        wall: SHIPPED.wall * s,
        bailout: SHIPPED.bailout * s,
      };
      return armPanel(paramEscapeDE(de, fp), fp.bailout);
    });
    const ref = row[shippedAt];
    row.forEach((arm, i) => {
      console.log(
        `  s ${scales[i].toFixed(2)}  radius ${arm.radius.toFixed(3)}  ` +
          `radius/s ${(arm.radius / scales[i]).toFixed(3)}  ` +
          `hits ${hitPct(arm.panel)}%  ` +
          `IoU ${maskIoU(arm.panel, ref.panel).toFixed(3)}  ` +
          reliefCol(arm, ref),
      );
    });
    console.log(
      `  wrote ${writeContactSheet(
        row.map((a) => a.panel),
        scales.length,
        "spherefold-conjugation.png",
      )}`,
    );
    // If either of these fails, the normalization is broken and no other
    // number on this sheet means anything.
    row.forEach((arm, i) => {
      expect(
        maskIoU(arm.panel, ref.panel),
        `conjugation control s=${scales[i]}: silhouette moved`,
      ).toBeGreaterThan(0.97);
      expect(
        relief(arm, ref).rms,
        `conjugation control s=${scales[i]}: surface moved`,
      ).toBeLessThan(0.01);
    });
  });

  it("sweeps the magnification ratio through a ONE-SHOT lens", () => {
    // The FINAL-transform case: the fold applied once to every plotted point
    // of an ordinary affine attractor, never fed back. Hand-authored rather
    // than loaded, because no preset ships a pure-fold final.
    const base: Transform[] = [
      {
        id: 1,
        position: [0.4, 0.35, 0.1],
        rotation: [0.2, 0.5, 0],
        scale: [0.52, 0.52, 0.52],
      },
      {
        id: 2,
        position: [-0.45, 0.2, -0.3],
        rotation: [0, -0.7, 0.3],
        scale: [0.5, 0.5, 0.5],
      },
      {
        id: 3,
        position: [0.1, -0.5, 0.35],
        rotation: [0.9, 0, -0.4],
        scale: [0.48, 0.48, 0.48],
      },
      {
        id: 4,
        position: [-0.15, -0.3, -0.45],
        rotation: [-0.3, 0.25, 0.8],
        scale: [0.5, 0.5, 0.5],
      },
    ];
    const cloud = runChaosGame(base, 150_000, mulberry32(0xc10d));
    const lens = buildEscapeDE([foldSystem(2, [0, 0, 0])]);

    const arms = [1.0, 0.8, 0.65, 0.5, 0.35, 0.25];
    const shippedAt = arms.indexOf(SHIPPED.mR);
    const bent = arms.map((mR) => {
      const fp = { ...SHIPPED, mR };
      const out = new Float32Array(cloud.count * 3);
      const q: Vec3 = [0, 0, 0];
      for (let i = 0; i < cloud.count; i++) {
        paramFoldOnce(
          lens,
          fp,
          [
            cloud.positions[i * 3],
            cloud.positions[i * 3 + 1],
            cloud.positions[i * 3 + 2],
          ],
          q,
        );
        out[i * 3] = q[0];
        out[i * 3 + 1] = q[1];
        out[i * 3 + 2] = q[2];
      }
      return normalizeCloud(out, cloud.count);
    });

    // The un-lensed attractor, normalized the same way: the "the lens did
    // nothing recognisable" baseline the arms are read against.
    const raw = normalizeCloud(
      cloud.positions.slice(0, cloud.count * 3),
      cloud.count,
    );
    const ref = bent[shippedAt];
    const panels = bent.map((c, i) => {
      const fp = { ...SHIPPED, mR: arms[i] };
      console.log(
        `  lens  mR ${arms[i].toFixed(2)}  ` +
          `magnification ${magnification(fp).toFixed(2)}x  ` +
          `rms ${c.rms.toFixed(3)}  ` +
          `IoU-vs-shipped ${occupancyIoU(c.points, ref.points).toFixed(3)}  ` +
          `IoU-vs-unlensed ${occupancyIoU(c.points, raw.points).toFixed(3)}` +
          (i === shippedAt ? "  <- ships" : ""),
      );
      return splatPanel(c.points);
    });
    console.log(
      `  wrote ${writeContactSheet(panels, arms.length, "spherefold-lens.png")}`,
    );
  });
});

/* ---- the lens sheet's own small machinery ------------------------- */

/**
 * Centre and scale a cloud to unit RMS radius. Both are free to an author
 * already — the final transform's own position and scale — so normalizing
 * them is what leaves only the fold's ratios in the comparison. Rotation is
 * free too and deliberately NOT normalized, so this test can only
 * OVER-report difference, never under-report it.
 */
function normalizeCloud(
  xyz: Float32Array,
  count: number,
): { points: Float32Array; rms: number } {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += xyz[i * 3];
    cy += xyz[i * 3 + 1];
    cz += xyz[i * 3 + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const dx = xyz[i * 3] - cx;
    const dy = xyz[i * 3 + 1] - cy;
    const dz = xyz[i * 3 + 2] - cz;
    sum += dx * dx + dy * dy + dz * dz;
  }
  const rms = Math.sqrt(sum / count) || 1;
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    points[i * 3] = (xyz[i * 3] - cx) / rms;
    points[i * 3 + 1] = (xyz[i * 3 + 1] - cy) / rms;
    points[i * 3 + 2] = (xyz[i * 3 + 2] - cz) / rms;
  }
  return { points, rms };
}

/** Occupancy IoU over a 64³ grid spanning ±3 RMS radii — the cloud twin of
 * {@link maskIoU}. */
function occupancyIoU(a: Float32Array, b: Float32Array): number {
  const N = 64;
  const SPAN = 3;
  const cells = (xyz: Float32Array) => {
    const set = new Set<number>();
    for (let i = 0; i < xyz.length; i += 3) {
      const ix = Math.floor(((xyz[i] / SPAN + 1) / 2) * N);
      const iy = Math.floor(((xyz[i + 1] / SPAN + 1) / 2) * N);
      const iz = Math.floor(((xyz[i + 2] / SPAN + 1) / 2) * N);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= N || iy >= N || iz >= N) continue;
      set.add((iz * N + iy) * N + ix);
    }
    return set;
  };
  const sa = cells(a);
  const sb = cells(b);
  let inter = 0;
  for (const k of sa) if (sb.has(k)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * Additive orthographic point splat on {@link EYE}'s view basis, with
 * `de-preview.ts`'s backdrop, so the lens sheet reads beside the marched
 * ones. A point cloud has no surface to march; this is not a ninth marcher
 * but the scatter `mutation-thumbs.ts` does for the mutation grid, minus
 * the per-transform colouring this sheet has no use for.
 */
function splatPanel(points: Float32Array): PanelStats {
  const started = Date.now();
  const len = Math.hypot(EYE[0], EYE[1], EYE[2]);
  // The eye looks at the origin, so forward is -EYE normalized; right/up
  // mirror renderPreview's basis exactly.
  const fwd: Vec3 = [-EYE[0] / len, -EYE[1] / len, -EYE[2] / len];
  const rRaw: Vec3 = [-fwd[2], 0, fwd[0]]; // cross(fwd, [0,1,0])
  const rl = Math.hypot(rRaw[0], rRaw[1], rRaw[2]) || 1;
  const right: Vec3 = [rRaw[0] / rl, rRaw[1] / rl, rRaw[2] / rl];
  const up: Vec3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const SPAN = 2.6; // RMS radii across the half-frame
  const acc = new Float32Array(SIZE * SIZE);
  let plotted = 0;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    const u = (x * right[0] + y * right[1] + z * right[2]) / SPAN;
    const v = (x * up[0] + y * up[1] + z * up[2]) / SPAN;
    const px = Math.floor(((u + 1) / 2) * SIZE);
    const py = Math.floor(((1 - v) / 2) * SIZE);
    if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
    acc[py * SIZE + px] += 1;
    plotted++;
  }
  let peak = 0;
  for (const a of acc) peak = Math.max(peak, a);
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  const tint = [1.0, 0.86, 0.62];
  let occupied = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const g = (y + 0.5) / SIZE;
      const bg = [
        0.1 + (0.04 - 0.1) * g,
        0.12 + (0.045 - 0.12) * g,
        0.16 + (0.06 - 0.16) * g,
      ];
      // Log density against the panel's OWN peak, so a lens that piles the
      // cloud into a smaller volume does not simply read brighter.
      const d = acc[i] > 0 ? Math.log1p(acc[i]) / Math.log1p(peak) : 0;
      if (acc[i] > 0) occupied++;
      for (let c = 0; c < 3; c++) {
        rgb[i * 3 + c] = Math.round(
          255 * Math.min(1, bg[c] + d * tint[c] * (1 - bg[c])),
        );
      }
    }
  }
  return {
    rgb,
    width: SIZE,
    height: SIZE,
    hits: occupied,
    evals: plotted,
    steps: 0,
    ms: Date.now() - started,
    exhausted: 0,
  };
}
