/**
 * The escape-time CHAIN, rendered by the code that ships (fr-za0n).
 *
 * `hybrid-chain.harness.ts` asked whether the escape-time family composes,
 * from a local prototype. It does, and `escape-de.ts` now carries it: the
 * transform LIST is the formula chain. This harness is the other half of
 * that pair — the sheet drawn by `estimateEscapeDistance` ITSELF, the way
 * `escape-form-sweep.harness.ts` draws the shipped fold estimator, so the
 * pictures below cannot drift from the renderer.
 *
 * WHAT IT SETTLES, in order:
 *
 *  1. THE WIDENED GATE. Which shapes compose now, and which are still
 *     refused, printed as both gates' verbatim reasons.
 *  2. THE SEQUENCE FORK — cycling (shipped) against chaining (rejected),
 *     kept executable here as {@link estimateChained} exactly as
 *     `escape-form-sweep.harness.ts` keeps the Julia form. The ball-fill
 *     column is the verdict: chaining's set fattens with every link added
 *     while cycling's draws IN, which is the defect fr-7u8t.8 existed to
 *     fix, reappearing as soon as the list grows.
 *
 *  3. THE STEP SCALE — the sweep that KEPT `ESCAPE_STEP_SCALE` at 0.35 for
 *     chains as well as single maps, with the single map as the control
 *     that anchors the reading.
 *  4. WHAT A CHAIN LOOKS LIKE — the contact sheet.
 *  5. THE KALEIDOSCOPE — exactly symmetric, and measured to cost nothing
 *     per orbit step.
 *  6. WHAT IT COSTS — us/eval against the single map it generalises, over
 *     the BAILOUT ball both engines march against, with each row's fitted
 *     ball priced beside it because the two disagree by up to 8x.
 *
 * FR-AZJK RE-MEASURED EVERY FILL AND REACH FIGURE THIS SHEET PRINTS, and
 * two things were wrong at once. The INSTRUMENT was a grid thresholding the
 * distance estimate — see {@link sampleSetExtent} for both defects and the
 * measurements behind them — and the BALL was each row's own FITTED radius
 * while the verdict it fed was written as "x% of a radius-4 ball", so a
 * compact arm was scored against a small ball and an inflated one against a
 * large one. Fill is now a seeded uniform sample against a membership
 * oracle over the shared bailout ball, for every row and both arms:
 *
 *     fill % of the radius-4 bailout ball    cycling (ships)   chaining
 *       CONTROL single mbox2 (1 link)              3.6            3.6
 *       mbox2 -> boxfold1.6                        1.1           12.7
 *       mbox2 -> mbox2 rot20y                      1.5            1.3
 *       mbox2 -> mbox-1.5                          1.5           11.6
 *       box1 rot25y -> sph2                        0.2            3.2
 *       mbox2 -> box1.6 -> sph1.2                  0.5            6.4
 *       FOUR links                                 0.6           13.8
 *       SIX links                                  0.2           37.1
 *
 * The record this replaces read 32 / 13 / 43% at two links, 47% at four and
 * 72.8% at six for chaining, against 6.0 / 7.0 / 7.4%, 3.8% and 3.6% for
 * cycling. Every figure moved and the VERDICT did not: chaining still
 * fattens monotonically with length and cycling still draws in, and the gap
 * at six links is now 186x rather than 20x. The one-link control is its own
 * check — the two arms are the same orbit there and print identically.
 *
 * Every panel runs through `de-preview.ts`'s identical shading, so a sheet
 * compares OBJECTS and not lighting, and the sibling harnesses' caveat
 * applies: no empty-space grid, no tier-pinned acceptance epsilon, a
 * 600-step budget — fold surfaces speckle here where the shipped tracer
 * resolves them.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/escape-chain.harness.ts
 * Writes: `scripts/out/escape-chain.png` (the sheet), plus
 *         `escape-chain-sequence.png`, `escape-chain-march.png`,
 *         `escape-chain-kaleido.png`
 */
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  escapeSetContains,
  estimateEscapeDistance,
  probeEscapeFill,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import { mulberry32 } from "../src/fractal/rng";
import {
  analyzeSurfaceSystem,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import type {
  SymmetryParams,
  Transform,
  VariationType,
} from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";
import { sampleSetExtent, SET_SAMPLE_POINTS } from "./set-extent";

const SIZE = 420;
/** Panel size for the sweep sheets — the same objects, cheaper. */
const SMALL = 340;

/** `de-preview.ts`'s default eye direction pulled in to 2.2 marching radii,
 * frustum widened to keep the whole silhouette in frame. Its shading fogs on
 * absolute ray distance, so the default stand-off buries a fitted object
 * under heavy fog — fine when every panel shares one bounding radius,
 * misleading when each fits its own. Still outside the marching ball, which
 * is the module's one constraint. */
const EYE: Vec3 = [1.348, 0.957, 1.565];
const ZOOM = 0.52;

// ------------------------------------------------------------- fixtures

/** A single pure-fold map in the DOCUMENT vocabulary — the shape both gates
 * read, so a fixture here is a scene a user could author. */
function foldMap(
  id: number,
  type: VariationType,
  weight: number,
  opts: { position?: Vec3; rotation?: Vec3; scale?: Vec3 } = {},
): Transform {
  return {
    id,
    position: opts.position ?? [0, 0, 0],
    rotation: opts.rotation ?? [0, 0, 0],
    scale: opts.scale ?? [1, 1, 1],
    variations: [{ type, weight }],
  };
}

const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];

/** The chains every sheet below is drawn from — fold-only, non-contracting,
 * exactly what the widened gate admits. The single map leads as the control
 * fr-7u8t.8 measured, so every sweep can be read against it. */
const FIXTURES: [string, Transform[]][] = [
  ["CONTROL single mbox2", [foldMap(1, "mandelbox", 2)]],
  [
    "mbox2 -> boxfold1.6",
    [foldMap(1, "mandelbox", 2), foldMap(2, "boxfold", 1.6)],
  ],
  [
    "mbox2 -> mbox2 rot20y",
    [
      foldMap(1, "mandelbox", 2),
      foldMap(2, "mandelbox", 2, { rotation: rot(20) }),
    ],
  ],
  [
    "mbox2 -> box1.6 -> sph1.2",
    [
      foldMap(1, "mandelbox", 2),
      foldMap(2, "boxfold", 1.6),
      foldMap(3, "spherefold", 1.2),
    ],
  ],
  [
    "mbox2 -> mbox-1.5",
    [foldMap(1, "mandelbox", 2), foldMap(2, "mandelbox", -1.5)],
  ],
  [
    "box1 rot25y -> sph2",
    [
      foldMap(1, "boxfold", 1, { rotation: rot(25) }),
      foldMap(2, "spherefold", 2),
    ],
  ],
  [
    "FOUR: mbox2 -> box1.6 -> sph1.2 -> mbox-1.5",
    [
      foldMap(1, "mandelbox", 2),
      foldMap(2, "boxfold", 1.6),
      foldMap(3, "spherefold", 1.2),
      foldMap(4, "mandelbox", -1.5),
    ],
  ],
  [
    "SIX: mbox2 -> mbox2 rot20y -> box1.6 -> sph1.2 -> mbox-1.5 -> box1 rot25y",
    [
      foldMap(1, "mandelbox", 2),
      foldMap(2, "mandelbox", 2, { rotation: rot(20) }),
      foldMap(3, "boxfold", 1.6),
      foldMap(4, "spherefold", 1.2),
      foldMap(5, "mandelbox", -1.5),
      foldMap(6, "boxfold", 1, { rotation: rot(25) }),
    ],
  ],
];

// -------------------------------------------------- the rejected sequencing

/** The rejected orbit's terminal radius and derivative bound, left in module
 * scratch by {@link runChainedOrbit} — `escape-de.ts`'s own split, for its
 * reason: {@link estimateChained} and {@link chainedMember} are two readers
 * of ONE loop, so they cannot disagree about what the orbit is, and the
 * rejected arm can be asked for MEMBERSHIP rather than for a threshold on a
 * distance (fr-azjk; see {@link sampleSetExtent}). */
let chainedR = 0;
let chainedDr = 1;

/**
 * CHAINING, the fork the sheet rejected — every link inside ONE pass, with
 * the Mandelbrot offset and the bailout test paid once per pass instead of
 * once per link. Kept executable rather than described, exactly as
 * `escape-form-sweep.harness.ts` keeps the retired Julia form: the sequence
 * `it()` below is what makes the verdict a measurement.
 *
 * It reads the SHIPPED {@link EscapeDE} — same links, same per-link
 * derivative factors, same `dr` recurrence — so the only difference between
 * the two arms is where `+ p` and the escape test land.
 */
function runChainedOrbit(
  de: EscapeDE,
  p: Vec3,
  passes = ESCAPE_TIME_ITERATIONS,
): void {
  const links = de.links;
  let vx = p[0];
  let vy = p[1];
  let vz = p[2];
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  for (let pass = 0; pass < passes && r <= ESCAPE_TIME_RADIUS; pass++) {
    for (const link of links) {
      const m = link.m;
      const yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
      const yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
      const yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
      let fx: number;
      let fy: number;
      let fz: number;
      let localL: number;
      if (link.kind === SURFACE_FOLD_BOXFOLD) {
        fx = 2 * Math.max(-1, Math.min(1, yx)) - yx;
        fy = 2 * Math.max(-1, Math.min(1, yy)) - yy;
        fz = 2 * Math.max(-1, Math.min(1, yz)) - yz;
        localL = 1;
      } else if (link.kind === SURFACE_FOLD_SPHEREFOLD) {
        const r2 = yx * yx + yy * yy + yz * yz;
        const f = 1 / Math.max(0.25, Math.min(1, r2));
        fx = yx * f;
        fy = yy * f;
        fz = yz * f;
        localL = f;
      } else {
        const bx = 2 * Math.max(-1, Math.min(1, yx)) - yx;
        const by = 2 * Math.max(-1, Math.min(1, yy)) - yy;
        const bz = 2 * Math.max(-1, Math.min(1, yz)) - yz;
        const r2 = bx * bx + by * by + bz * bz;
        const f = 1 / Math.max(0.25, Math.min(1, r2));
        fx = bx * f;
        fy = by * f;
        fz = bz * f;
        localL = f;
      }
      vx = link.w * fx;
      vy = link.w * fy;
      vz = link.w * fz;
      dr = link.derivGrowth * localL * dr;
    }
    vx += p[0];
    vy += p[1];
    vz += p[2];
    dr = dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  chainedR = r;
  chainedDr = dr;
}

/** The rejected arm's distance estimate. */
function estimateChained(de: EscapeDE, p: Vec3): number {
  runChainedOrbit(de, p);
  return chainedR / chainedDr;
}

/** The rejected arm's MEMBERSHIP, asked of the same orbit —
 * {@link escapeSetContains} for a loop that does not ship. Without it the
 * chaining column could only be measured by thresholding its estimate, which
 * is precisely the reading fr-azjk found to be a different SHAPE rather than
 * a different number: chaining floors `dr` once per PASS, so a
 * hard-contracting chain returns O(1) distances at points whose orbits never
 * leave the ball. */
function chainedMember(de: EscapeDE, p: Vec3): boolean {
  runChainedOrbit(de, p);
  return chainedR <= ESCAPE_TIME_RADIUS;
}

// ------------------------------------------------------------ measurement

/** Points every fill and reach column below is sampled at. */
const FILL_POINTS = SET_SAMPLE_POINTS;

/**
 * Fill and reach of one arm's set, over the BAILOUT ball every row shares
 * (fr-azjk). Two things moved here at once and both were wrong in the same
 * direction:
 *
 *  - the instrument, which was a grid thresholding a distance estimate. See
 *    {@link sampleSetExtent} for the two defects and the measurements.
 *  - the BALL. Each row used to be measured over its own FITTED marching
 *    radius, while the verdict it fed was written as "x% of a radius-4 ball"
 *    — so a compact arm was scored against a small ball and an inflated one
 *    against a large one, which flatters exactly the arm this sheet rejected
 *    the other way. Fill is over `ESCAPE_TIME_RADIUS` for every row now, and
 *    the fitted radius is a FRAMING quantity that no longer touches a
 *    reported fraction.
 */
function extentOf(member: (p: Vec3) => boolean): {
  fillPct: number;
  reachAbs: number;
} {
  return sampleSetExtent(member, {
    fillRadius: ESCAPE_TIME_RADIUS,
    points: FILL_POINTS,
  });
}

/** Fit the preview's marching ball to the object, so every panel frames its
 * own set the same way and a sheet compares SHAPES. Over-estimates
 * deliberately (rays entering further out cost steps, never geometry).
 *
 * Reach comes from the same seeded sample the fill column does, and asks the
 * same membership question: a uniform draw puts ~16% of its points in the
 * outermost 6% of the radius, so the shell that decides this radius is the
 * best-sampled part of the ball. */
function fitMarchRadius(reachAbs: number): number {
  if (reachAbs <= 0) return ESCAPE_TIME_RADIUS;
  return Math.min(ESCAPE_TIME_RADIUS, Math.max(1.15, reachAbs * 1.06));
}

/**
 * How often does the estimate claim an empty ball that is not empty? For
 * each exterior query the DE certifies `ball(p, d)` clear of the set;
 * probing in several directions and asking `escapeSetContains` — the
 * shipped membership oracle, reading the same orbit the estimate does —
 * turns "the bound is heuristic" into a number, comparable across chains
 * because the single-map control is measured the same way.
 *
 * TWO radii, because they answer different questions. `bound` probes at
 * `0.9·d` — how often the estimate itself is not a lower bound, i.e. how
 * heuristic it has become. `step` probes at the marcher's ACTUAL damped
 * step, which is the only violation a damped sphere tracer can be hurt by.
 * A large gap means the bound is loose but the damping already absorbs it.
 *
 * Queries are drawn in the BAILOUT ball, not in each system's own fitted
 * one: the fitted ball shrinks around a compact chain, which would crowd
 * every query up against that chain's surface and report a worse rate for
 * a tighter object. The bailout ball is the domain the marcher actually
 * enters against, and it is the same for every row.
 */
function violationPct(
  de: EscapeDE,
  queries = 1200,
  dirs = 14,
): { bound: number; step: number } {
  const rng = mulberry32(0x5eed_1234);
  let probed = 0;
  let badBound = 0;
  let badStep = 0;
  for (let q = 0; q < queries; q++) {
    const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    const p: Vec3 = [u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct];
    const d = estimateEscapeDistance(de, p);
    if (!(d > 1e-6)) continue; // on or inside the set: nothing certified
    probed++;
    let hitBound = false;
    let hitStep = false;
    for (let k = 0; k < dirs; k++) {
      const c2 = 2 * rng() - 1;
      const s2 = Math.sqrt(Math.max(0, 1 - c2 * c2));
      const p2 = 2 * Math.PI * rng();
      const ux = s2 * Math.cos(p2);
      const uy = s2 * Math.sin(p2);
      const uz = c2;
      if (
        !hitBound &&
        escapeSetContains(de, [
          p[0] + 0.9 * d * ux,
          p[1] + 0.9 * d * uy,
          p[2] + 0.9 * d * uz,
        ])
      ) {
        hitBound = true;
      }
      if (
        !hitStep &&
        escapeSetContains(de, [
          p[0] + ESCAPE_STEP_SCALE * d * ux,
          p[1] + ESCAPE_STEP_SCALE * d * uy,
          p[2] + ESCAPE_STEP_SCALE * d * uz,
        ])
      ) {
        hitStep = true;
      }
      if (hitBound && hitStep) break;
    }
    if (hitBound) badBound++;
    if (hitStep) badStep++;
  }
  if (probed === 0) return { bound: 0, step: 0 };
  return { bound: (100 * badBound) / probed, step: (100 * badStep) / probed };
}

/** The shipped estimator bound to a system, ready for `de-preview.ts`. */
function shippedDE(de: EscapeDE): DistanceEstimator {
  return (p) => estimateEscapeDistance(de, p);
}

// ------------------------------------------------------------------ tests

describe("the escape-time chain, rendered by the shipped estimator (fr-za0n)", () => {
  it("shows what the widened gate admits — and what it still refuses", () => {
    // The hole fr-za0n closed, and its edges. The first four shapes had NO
    // renderer at all before: the IFS gate refused them for not contracting
    // and the escape gate for having more than one map.
    const admitted: [string, Transform[], SymmetryParams?][] = [
      [
        "two mandelbox w=2 maps",
        [
          foldMap(1, "mandelbox", 2),
          foldMap(2, "mandelbox", 2, { position: [0.3, 0, 0] }),
        ],
      ],
      [
        "mandelbox w=2 + boxfold w=1.6",
        [foldMap(1, "mandelbox", 2), foldMap(2, "boxfold", 1.6)],
      ],
      ["six fold maps", FIXTURES[7][1]],
      [
        "mandelbox w=2 with a 6-fold kaleidoscope",
        [foldMap(1, "mandelbox", 2)],
        { order: 6, plane: "xz" },
      ],
      [
        "ONE CONTRACTING map beside an expanding one",
        [
          foldMap(1, "mandelbox", 2),
          foldMap(2, "boxfold", 0.2, { scale: [0.5, 0.5, 0.5] }),
        ],
      ],
      // fr-j231 widened the gate again, and this row moved up from REFUSED:
      // a link need not be a fold. `scripts/hybrid-chain.harness.ts` is that
      // decision's sheet; this row is here so the gate's own edge stays
      // measured in the fold sheet too.
      [
        "mandelbox w=2 + bulb (cross-family, fr-j231)",
        [foldMap(1, "mandelbox", 2), foldMap(2, "bulb", 1)],
      ],
    ];
    for (const [what, transforms, symmetry] of admitted) {
      const ifs = analyzeSurfaceSystem(transforms);
      const esc = analyzeEscapeSystem(transforms, null, symmetry);
      console.log(
        `  ADMITTED  ${what}\n` +
          `      IFS    ${ifs.status}: ${ifs.reasons.join("; ") || "-"}\n` +
          `      escape ${esc.status}: ${esc.reasons.join("; ") || "-"}`,
      );
      expect(esc.status).toBe("eligible");
      expect(ifs.status).toBe("ineligible");
    }

    const refused: [string, Transform[], Transform | null, SymmetryParams?][] =
      [
        [
          "ONE map blending two folds (a blend, not a chain)",
          [
            {
              id: 1,
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              variations: [
                { type: "mandelbox", weight: 2 },
                { type: "boxfold", weight: 1 },
              ],
            },
          ],
          null,
        ],
        [
          "ONE map blending a fold and a POWER (still a blend, not a chain)",
          [
            {
              id: 1,
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              variations: [
                { type: "mandelbox", weight: 2 },
                { type: "bulb", weight: 1 },
              ],
            },
          ],
          null,
        ],
        [
          "two mandelbox maps + a fold FINAL",
          [foldMap(1, "mandelbox", 2), foldMap(2, "boxfold", 1.6)],
          foldMap(9, "boxfold", 1.2),
        ],
        [
          "two mandelbox maps, kaleidoscope in a w-plane",
          [foldMap(1, "mandelbox", 2), foldMap(2, "boxfold", 1.6)],
          null,
          { order: 4, plane: "zw" },
        ],
        [
          "two CONTRACTING fold maps (the IFS tracer owns them)",
          [
            foldMap(1, "mandelbox", 1, { scale: [0.1, 0.1, 0.1] }),
            foldMap(2, "boxfold", 0.5, { scale: [0.2, 0.2, 0.2] }),
          ],
          null,
        ],
      ];
    for (const [what, transforms, final, symmetry] of refused) {
      const esc = analyzeEscapeSystem(transforms, final, symmetry);
      console.log(
        `  REFUSED   ${what}\n      escape: ${esc.reasons.join("; ")}`,
      );
      expect(esc.status).toBe("ineligible");
    }
  });

  it("forks the sequence: CYCLING (shipped) vs CHAINING (rejected)", () => {
    // Both arms apply every link the same number of times, so this compares
    // orbits and not budgets. The fill column is the verdict.
    const panels: PanelStats[] = [];
    for (const [label, transforms] of FIXTURES) {
      const escDe = buildEscapeDE(transforms);
      const n = escDe.links.length;
      // Each arm brings its own ESTIMATE and its own MEMBERSHIP oracle, read
      // off one orbit apiece, so the fill column compares two SETS rather
      // than two thresholds (fr-azjk).
      const arms: [string, DistanceEstimator, (p: Vec3) => boolean][] = [
        ["cycle (ships)", shippedDE(escDe), (p) => escapeSetContains(escDe, p)],
        [
          "chain",
          (p: Vec3) => estimateChained(escDe, p),
          (p) => chainedMember(escDe, p),
        ],
      ];
      for (const [arm, de, member] of arms) {
        const { fillPct, reachAbs } = extentOf(member);
        const marchR = fitMarchRadius(reachAbs);
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: ESCAPE_STEP_SCALE,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        console.log(
          `  ${label.padEnd(34)} ${arm.padEnd(13)} links ${n} ` +
            `marchR ${marchR.toFixed(2)} fill ${fillPct.toFixed(1)}% ` +
            `reach ${reachAbs.toFixed(2)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "escape-chain-sequence.png")}`,
    );
  });

  it("sweeps the march step scale a chain needs", () => {
    // The sweep that REFUTED a chain-specific step scale (fr-za0n's
    // verdict: one ESCAPE_STEP_SCALE, 0.35, at every chain length — see
    // its doc). The single map leads as the
    // control: its row is fr-7u8t.8's 0.35 verdict re-measured at this pose,
    // so the chains' rows can be read against a scale that is known to fit.
    const panels: PanelStats[] = [];
    for (const [label, transforms] of FIXTURES) {
      const escDe = buildEscapeDE(transforms);
      const de = shippedDE(escDe);
      const marchR = fitMarchRadius(
        extentOf((p) => escapeSetContains(escDe, p)).reachAbs,
      );
      const row: string[] = [];
      for (const stepScale of [0.7, 0.35, 0.2, 0.15, 0.1, 0.05]) {
        const panel = renderPreview(
          { de, boundingRadius: marchR, stepScale, eyeOffset: EYE, zoom: ZOOM },
          SMALL,
        );
        row.push(
          `${stepScale}: hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(2)}% ` +
            `steps ${(panel.steps / (SMALL * SMALL)).toFixed(1)}`,
        );
        panels.push(panel);
      }
      console.log(`  ${label}\n      ${row.join("  |  ")}`);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 6, "escape-chain-march.png")}`,
    );
  });

  it("renders the chain contact sheet", () => {
    const panels = FIXTURES.map(([label, transforms]) => {
      const escDe = buildEscapeDE(transforms);
      const de = shippedDE(escDe);
      const { fillPct, reachAbs } = extentOf((p) =>
        escapeSetContains(escDe, p),
      );
      const marchR = fitMarchRadius(reachAbs);
      const panel = renderPreview(
        {
          de,
          boundingRadius: marchR,
          stepScale: ESCAPE_STEP_SCALE,
          eyeOffset: EYE,
          zoom: ZOOM,
        },
        SIZE,
      );
      console.log(
        `  ${label}\n` +
          `      links ${escDe.links.length}  marchR ${marchR.toFixed(2)}  ` +
          `fill ${fillPct.toFixed(1)}%  reach ${reachAbs.toFixed(2)}  ` +
          `hits ${((100 * panel.hits) / (SIZE * SIZE)).toFixed(1)}%  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}  ${panel.ms}ms`,
      );
      return panel;
    });
    console.log(`  wrote ${writeContactSheet(panels, 4, "escape-chain.png")}`);
    // Guard the guard: a blank panel makes the sheet meaningless.
    panels.forEach((p, i) => {
      expect(p.hits, `panel ${i + 1} rendered nothing`).toBeGreaterThan(
        0.005 * SIZE * SIZE,
      );
    });
  });

  it("folds the kaleidoscope in for free", () => {
    // Two claims, both measured: the rendered set is EXACTLY symmetric under
    // the sector rotation, and the fold costs nothing per orbit step (it
    // happens once per query, before the loop).
    //
    // The base is deliberately ASYMMETRIC — an offset mandelbox and a
    // rotated boxfold. Every fixture at the top of this file sits at the
    // origin unrotated, and folds are odd axis by axis, so those objects
    // already carry the cube's whole symmetry group: at orders 2 and 4 the
    // wedge fold would be a no-op on them and the sheet would print the same
    // panel twice while claiming to demonstrate something. And the panels
    // look DOWN the symmetry axis (the `xz` plane turns about y), because a
    // kaleidoscope seen obliquely is just texture.
    const base: Transform[] = [
      foldMap(1, "mandelbox", 2, { position: [0.4, 0.3, 0.2] }),
      foldMap(2, "boxfold", 1.6, { rotation: rot(20) }),
    ];
    const axisEye: Vec3 = [0.25, 2.2, 0];
    const panels: PanelStats[] = [];
    for (const order of [1, 2, 3, 5, 8]) {
      const symmetry: SymmetryParams = { order, plane: "xz" };
      const escDe = buildEscapeDE(base, null, symmetry);
      const de = shippedDE(escDe);
      const { fillPct, reachAbs } = extentOf((p) =>
        escapeSetContains(escDe, p),
      );
      const marchR = fitMarchRadius(reachAbs);

      // Symmetry residual: rotate the query by one sector in the fold plane
      // and the estimate must not move (beyond f64 rounding in the fold's
      // own atan2/cos/sin).
      const rng = mulberry32(0xa11ce);
      const sector = (2 * Math.PI) / order;
      const c = Math.cos(sector);
      const s = Math.sin(sector);
      let worst = 0;
      for (let i = 0; i < 4000; i++) {
        const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
        const q: Vec3 = [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
        worst = Math.max(worst, Math.abs(de(p) - de(q)));
      }

      // Cost, in the BAILOUT ball the pricing `it()` below uses, so one
      // order's row can be read against another's and against the chains'.
      const rng2 = mulberry32(0xbeef);
      const pts: Vec3[] = [];
      for (let i = 0; i < 40_000; i++) {
        const u = Math.cbrt(rng2()) * ESCAPE_TIME_RADIUS;
        const ct = 2 * rng2() - 1;
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = 2 * Math.PI * rng2();
        pts.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
      }
      let acc = 0;
      const t0 = Date.now();
      for (const p of pts) acc += de(p);
      const us = ((Date.now() - t0) * 1000) / pts.length;

      const panel = renderPreview(
        {
          de,
          boundingRadius: marchR,
          stepScale: ESCAPE_STEP_SCALE,
          eyeOffset: axisEye,
          zoom: ZOOM,
        },
        SMALL,
      );
      console.log(
        `  order ${order}  fill ${fillPct.toFixed(1)}%  ` +
          `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}%  ` +
          `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)}  ` +
          `${us.toFixed(2)} us/eval  ` +
          `sector-rotation residual ${worst.toExponential(2)}  ` +
          `(checksum ${acc.toFixed(3)})`,
      );
      panels.push(panel);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 5, "escape-chain-kaleido.png")}`,
    );
  });

  it("measures what composition does to the BOUND", () => {
    // The argument for widening the gate, in one column. If chaining maps
    // together made the heuristic worse, the shipped single map would be the
    // best-behaved row here. It is the worst.
    for (const [label, transforms] of FIXTURES) {
      const escDe = buildEscapeDE(transforms);
      const v = violationPct(escDe);
      console.log(
        `  ${label.padEnd(34)} ${escDe.links.length} links  ` +
          `bound ${v.bound.toFixed(1)}%  step ${v.step.toFixed(1)}%`,
      );
    }
  });

  it("reports an EMPTY chain instead of leaving a blank frame unexplained", () => {
    // fr-za0n's UX landmine. A chain whose composite expands too hard escapes
    // everywhere on the first pass and renders nothing, with no clue why.
    // `probeEscapeFill` is what a later UI pass can ask, so the answer can be
    // "this chain's set is empty" rather than an empty pane.
    //
    // The sharpest case — a mandelbox followed by a triplex power, which
    // sends |v| ~ 7 to 5.8e5 in one link — is out of this gate's reach
    // (power links are not folds), so these are the fold-only chains that
    // come closest: big pre-scales, which drive |y| past the fold's range
    // before the fold can pull it back.
    const s = (v: number): Vec3 => [v, v, v];
    const probes: [string, Transform[]][] = [
      ...FIXTURES,
      [
        "EMPTY? mbox2 -> mbox2 pre-scale 4",
        [
          foldMap(1, "mandelbox", 2),
          foldMap(2, "mandelbox", 2, { scale: s(4) }),
        ],
      ],
      [
        "EMPTY? mbox2 pre-scale 8 -> box1.6",
        [
          foldMap(1, "mandelbox", 2, { scale: s(8) }),
          foldMap(2, "boxfold", 1.6),
        ],
      ],
      [
        "EMPTY? box6 -> box6 -> box6",
        [
          foldMap(1, "boxfold", 6),
          foldMap(2, "boxfold", 6),
          foldMap(3, "boxfold", 6),
        ],
      ],
      [
        "EMPTY? sph3 pre-scale 6 -> mbox2",
        [
          foldMap(1, "spherefold", 3, { scale: s(6) }),
          foldMap(2, "mandelbox", 2),
        ],
      ],
    ];
    for (const [label, transforms] of probes) {
      const fill = probeEscapeFill(buildEscapeDE(transforms));
      console.log(
        `  ${label.padEnd(42)} probeFill ${(100 * fill).toFixed(3)}%` +
          (fill === 0 ? "   <- renders NOTHING" : ""),
      );
    }
    // Every fixture this harness draws must be non-empty, or its sheets are
    // measuring blank panels.
    for (const [label, transforms] of FIXTURES) {
      expect(
        probeEscapeFill(buildEscapeDE(transforms)),
        `${label} probes empty`,
      ).toBeGreaterThan(0);
    }

    // ONE INSTRUMENT, PINNED (fr-azjk). Every fill column in this sheet goes
    // through {@link sampleSetExtent}, and the module's own emptiness probe
    // goes through `probeEscapeFill`. They must not be two definitions of
    // "fill" that happen to agree: the shared sampler draws `probeEscapeFill`'s
    // sequence term for term from the same seed, so at the same point count
    // they are the SAME measurement, to the bit. `hybrid-chain.harness.ts`
    // pins its own two derived readers the same way, and this is what makes
    // a figure quoted from either file quotable from the other.
    for (const points of [4096, 65536]) {
      for (const [label, transforms] of FIXTURES) {
        const de = buildEscapeDE(transforms);
        expect(
          sampleSetExtent((p) => escapeSetContains(de, p), {
            fillRadius: ESCAPE_TIME_RADIUS,
            points,
          }).fillPct,
          `${label} @ ${points}`,
        ).toBe(100 * probeEscapeFill(de, points));
      }
    }
  });

  it("prices a chain against the single map it generalises", () => {
    // A pass is one full cycle (escape-de.ts), so an n-link system runs n
    // times the orbit steps: cost is expected to scale with the chain, and
    // this is the number that says by how much in practice (orbits that
    // escape early never pay the full budget).
    //
    // Queries are drawn in the BAILOUT ball, for {@link violationPct}'s
    // reason and one more of its own (fr-azjk): the escape kernels pack that
    // ball as both the bounding AND the visible sphere, so it is the domain
    // the shipped marcher enters against, it is the same for every row, and
    // a cost figure then does not move when a FRAMING radius is refitted.
    //
    // The FITTED ball is priced beside it, because the two disagree by up to
    // 8x and the disagreement is the finding: a tight ball around a compact
    // chain crowds every query up against the set, where orbits run the full
    // budget, so the same estimator reads dearest exactly where its object is
    // smallest. The record's figures were the fitted column, taken when the
    // fit itself came from the aliased instrument.
    const price = (de: DistanceEstimator, radius: number): string => {
      const rng = mulberry32(0xbeef);
      const pts: Vec3[] = [];
      for (let i = 0; i < 60_000; i++) {
        const u = Math.cbrt(rng()) * radius;
        const ct = 2 * rng() - 1;
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = 2 * Math.PI * rng();
        pts.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
      }
      let acc = 0;
      const t0 = Date.now();
      for (const p of pts) acc += de(p);
      const ms = Date.now() - t0;
      return (
        `${((ms * 1000) / pts.length).toFixed(2)} us/eval ` +
        `(ball ${radius.toFixed(2)}, checksum ${acc.toFixed(3)})`
      );
    };
    for (const [label, transforms] of FIXTURES) {
      const escDe = buildEscapeDE(transforms);
      const de = shippedDE(escDe);
      const marchR = fitMarchRadius(
        extentOf((p) => escapeSetContains(escDe, p)).reachAbs,
      );
      console.log(
        `  ${label.padEnd(34)} ${escDe.links.length} links\n` +
          `      bailout  ${price(de, ESCAPE_TIME_RADIUS)}\n` +
          `      fitted   ${price(de, marchR)}`,
      );
    }
  });
});
