/**
 * Does the escape-time family COMPOSE? — a prototype and a contact sheet for
 * the question `escape-de.ts` and `bulb-de.ts` currently answer with "no".
 *
 * THE HOLE. Both shipped escape-time gates admitted EXACTLY ONE active map
 * with EXACTLY ONE variation when this harness was written.
 * `analyzeEscapeSystem` called itself "the deliberate COMPLEMENT of
 * `analyzeSurfaceSystem`", but the complement claim only held on single-map
 * systems: put two non-contracting fold maps in a document and the IFS gate
 * said "map N does not contract" while the escape gate said "more than one
 * active map". Nothing rendered it.
 *
 * fr-za0n has since widened the escape gate to a CHAIN of pure folds, closing
 * the fold-only half of that hole — this harness's own recommendation,
 * landing while its sheets were rendering. What remains open is the
 * CROSS-FAMILY shape: a fold chained with a power map (`bulb`, `qsquare`) is
 * still refused by all three gates, and it is the half these sheets argue is
 * worth the shader. The first `it()` prints every gate's verbatim reasons and
 * asserts only on the rows still refused everywhere, so it tracks the hole
 * rather than re-litigating the closed part.
 *
 * THE PROTOTYPE. {@link runChain} iterates an ARRAY of maps per orbit step,
 * accumulating the scalar running derivative through each link:
 *
 *     v = p;  dr = 1
 *     repeat until |v| > bailout or the budget runs out:
 *       for each link i:
 *         y  = M_i v + t_i
 *         v  = w_i · V_i(y)
 *         dr = |w_i| · L_i(y) · sigma_max(M_i) · dr
 *       v = v + p                                  // Mandelbrot offset
 *       dr = dr + 1
 *     DE = |v| / dr            (linear)
 *        = 0.5·|v|·ln|v| / dr  (log / Böttcher)
 *
 * A Lipschitz bound composes MULTIPLICATIVELY through a chain, which is all
 * the inner loop is. Every link's `L_i` is the local factor the shipped
 * estimator for that map already uses — 1 for the boxfold's reflections,
 * `1/clamp(|y|², 0.25, 1)` for the spherefold family, `8|y|⁷` for the triplex
 * power, `2|y|` for the quaternion square — so a ONE-LINK chain is not merely
 * similar to the shipped estimator, it IS it. The second `it()` pins that:
 * a single mandelbox link reproduces `estimateEscapeDistance` and a single
 * bulb link reproduces `estimateBulbDistance` BIT-EXACTLY over 4000 queries.
 * That is the soundness argument in the only form worth having — the
 * generalisation degenerates to both shipped oracles, so it inherits their
 * heuristic status rather than adding a new one.
 *
 * WHICH SPACE THE ORBIT LIVES IN. `escape-de.ts` reads `|v|` with `dr`
 * tracking `dv/dp`; `bulb-de.ts` reads `|y|` with `dr` tracking `dy/dp` and
 * therefore seeds `dr = sigma_max(M)` and adds `+ sigma_max(M)`. Those are
 * the SAME recurrence in two coordinates (bulb-de.ts's own doc says so:
 * "factoring sigma_max out of the whole recurrence gives back
 * dr̂ = 8|y|⁷·sigma_max·dr̂ + 1 with a final /sigma_max"), and a chain has no
 * single `M` to push through — so the prototype is `v`-space throughout, with
 * the literal `+ 1`. Mixing the two conventions is the trap bulb-de.ts warns
 * about; staying in `v` space is how a chain avoids having to choose.
 *
 * THREE DESIGN FORKS the sheets measure rather than assert:
 *   - HOW THE LIST IS CONSUMED: CHAINING applies every link inside one pass;
 *     CYCLING applies slot `i mod n` at pass `i`, which is Mandelbulber2's
 *     own `seq->GetSequence(i)` and what fr-za0n shipped.
 *     `hybrid-chain-sequence.png` (+ `-close`) is the verdict: cycling wins,
 *     and the gap WIDENS with sequence length — at six links chaining fills
 *     60.7% of its own ball (a featureless crust) where cycling fills 23.9%
 *     and stays articulated. `hybrid-chain-cross-sequence.png` runs the same
 *     fork across the family boundary.
 *   - WHERE THE OFFSET GOES: `+ p` once per PASS, or once per LINK
 *     (Mandelbulber2 offers both; its per-slot "add C constant" is the
 *     per-link form). `hybrid-chain-offset.png`. Moot under cycling, where a
 *     pass IS one link.
 *   - WHICH ESTIMATE FORM a mixed chain reads: the fold family's linear
 *     `r/dr` or the power family's Böttcher `0.5·r·ln r/dr`. Numbers in the
 *     estimate-form `it()`.
 *
 * Every panel runs through `de-preview.ts`'s identical shading, so the sheet
 * compares OBJECTS and not lighting, and the sibling harnesses' caveat
 * applies: no empty-space grid, no tier-pinned acceptance epsilon, a 600-step
 * budget — fold surfaces speckle where the shipped tracer resolves them.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/hybrid-chain.harness.ts
 * Writes, all under `scripts/out/`: `hybrid-chain.png` (the 12-panel sheet)
 *         and `hybrid-chain-close.png`; `hybrid-chain-sequence.png` and
 *         `hybrid-chain-sequence-close.png` (chaining vs cycling, the fork
 *         that decided fr-za0n); `hybrid-chain-cross-sequence.png` (the same
 *         fork on cross-family chains); `hybrid-chain-offset.png`;
 *         `hybrid-chain-march.png` and `hybrid-chain-march2.png`
 */
import {
  analyzeBulbSystem,
  BULB_ITERATIONS,
  BULB_POWER,
  buildBulbDE,
  estimateBulbDistance,
} from "../src/fractal/bulb-de";
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  estimateEscapeDistance,
} from "../src/fractal/escape-de";
import { composeAffine } from "../src/fractal/affine";
import { mulberry32 } from "../src/fractal/rng";
import {
  analyzeSurfaceSystem,
  transformSigmas,
} from "../src/fractal/surface-de";
import type { Transform, VariationType } from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

const SIZE = 420;
/** Panel size for the secondary sheets — the same objects, cheaper. */
const SMALL = 340;

/**
 * `de-preview.ts`'s default eye direction pulled in to 2.2 marching radii
 * (from 2.53), with the frustum widened to keep the whole silhouette in
 * frame. Its shading fogs on absolute ray distance, so the default stand-off
 * buries a fitted object under ~60% fog — fine when every panel on a sheet
 * shares one bounding radius, misleading when each fits its own. Still
 * outside the marching ball, which is the module's one constraint.
 */
const EYE: Vec3 = [1.348, 0.957, 1.565];
const ZOOM = 0.52;

/** The close pose: `de-preview.ts`'s direction at 2.0 radii with a narrow
 * frustum, so roughly a third of the object fills the frame. Backing the eye
 * out rather than narrowing further keeps the marching ball uncropped —
 * `boundingRadius` is both the camera stand-off and the march bound, so a
 * close-up has to be a telephoto, never a dolly-in. */
const CLOSE_EYE: Vec3 = [1.225, 0.87, 1.423];
const CLOSE_ZOOM = 0.28;

// --------------------------------------------------------------- the chain

/** The maps a link can carry: `variations.ts`'s fold family plus the two
 * escape-time powers. Exactly the set whose forward Lipschitz factor is known
 * in closed form, which is the whole requirement for a link. */
type LinkKind = "boxfold" | "spherefold" | "mandelbox" | "bulb" | "qsquare";

interface ChainLink {
  kind: LinkKind;
  /** Row-major 3x3 FORWARD linear part `M_i` (`composeAffine`'s). */
  m: number[];
  /** Forward translation `t_i` — the PRE-fold/power offset, exactly the role
   * `t` plays in both shipped estimators. */
  t: Vec3;
  /** Signed variation weight `w_i`. */
  w: number;
  /** `|w_i| · sigma_max(M_i)` — `EscapeDE.derivGrowth`, per link. Precomputed
   * in this association order so a one-link chain is BIT-exact against
   * `estimateEscapeDistance`. */
  growth: number;
}

interface Chain {
  label: string;
  links: ChainLink[];
  /**
   * How the orbit consumes the list. `"chain"` applies EVERY link, in order,
   * inside one pass; `"cycle"` applies link `i mod n` at pass `i` — the
   * literal `seq->GetSequence(i)` of Mandelbulber2's `compute_fractal.cpp`.
   */
  sequence?: "chain" | "cycle";
  /** Orbit radius past which escape is called. `ESCAPE_TIME_RADIUS` (4) is
   * both shipped estimators' value; the bailout `it()` sweeps it. */
  bailout: number;
  iterations: number;
  /** Where the Mandelbrot `+ p` goes (module doc). */
  offset: "pass" | "link";
  /** Which distance form the terminal radius is read through (module doc). */
  estimate: "linear" | "log";
  /** Marching-ball radius for the preview; fitted by {@link fitMarchRadius}
   * unless pinned. */
  marchR?: number;
}

/**
 * Per-link magnitude past which the pass is abandoned. Pure overflow
 * insurance, NOT a second bailout: with `|v| <= 4` entering a link the
 * largest output any link can produce is `4⁸ = 65536` (the triplex power),
 * three orders below this, so it never fires on anything the sheets render —
 * which is what keeps the one-link chains bit-exact against the shipped
 * estimators. It exists because two power links in one pass would reach
 * `(4⁸)⁸ = 1e38` and a third would leave f64 entirely.
 */
const LINK_OVERFLOW_GUARD = 1e6;

// The orbit's terminal state, returned through module scratch rather than an
// object: `runChain` is called ~1e8 times across a sheet and an allocation per
// call is the difference between a two-minute run and a twenty-minute one.
let chainR = 0;
let chainDr = 1;
let chainIters = 0;

/** `variations.ts`'s `foldAxis`, duplicated for the reason `escape-de.ts`
 * duplicates it: the prototype must stay allocation-free and term-for-term. */
function foldAxis(t: number): number {
  return 2 * Math.max(-1, Math.min(1, t)) - t;
}

/**
 * Run the chain's forward orbit from `p`, leaving the terminal radius,
 * derivative bound and iteration count in the module scratch. The distance
 * estimate ({@link chainDE}) and the membership oracle ({@link chainMember})
 * are both thin readers of this one loop, so they cannot disagree about what
 * the orbit is.
 */
function runChain(chain: Chain, p: Vec3, maxIterations: number): void {
  const links = chain.links;
  const cycling = chain.sequence === "cycle";
  const perLink = chain.offset === "link";
  let vx = p[0];
  let vy = p[1];
  let vz = p[2];
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  let i = 0;
  outer: for (; i < maxIterations && r <= chain.bailout; i++) {
    // Chaining runs the whole list per pass; cycling runs slot `i mod n`
    // alone (Mandelbulber2's `seq->GetSequence(i)`).
    const first = cycling ? i % links.length : 0;
    const last = cycling ? first : links.length - 1;
    for (let j = first; j <= last; j++) {
      const link = links[j];
      const m = link.m;
      const yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
      const yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
      const yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
      let fx: number;
      let fy: number;
      let fz: number;
      // `localL` is the map's own local Lipschitz factor at `y` — the SAME
      // number the shipped estimator for that map uses, which is what makes
      // the product below a composition of the shipped bounds rather than a
      // new one.
      let localL: number;
      if (link.kind === "boxfold") {
        fx = foldAxis(yx);
        fy = foldAxis(yy);
        fz = foldAxis(yz);
        localL = 1; // reflections are isometries
      } else if (link.kind === "spherefold") {
        const r2 = yx * yx + yy * yy + yz * yz;
        const f = 1 / Math.max(0.25, Math.min(1, r2));
        fx = yx * f;
        fy = yy * f;
        fz = yz * f;
        localL = f;
      } else if (link.kind === "mandelbox") {
        const bx = foldAxis(yx);
        const by = foldAxis(yy);
        const bz = foldAxis(yz);
        const r2 = bx * bx + by * by + bz * bz;
        const f = 1 / Math.max(0.25, Math.min(1, r2));
        fx = bx * f;
        fy = by * f;
        fz = bz * f;
        localL = f;
      } else if (link.kind === "qsquare") {
        // `q²` on span{1, i, j} is norm-multiplicative, so `2|q|` is the
        // EXACT derivative norm — `qjulia-de.ts`'s certified factor.
        fx = yx * yx - yy * yy - yz * yz;
        fy = 2 * yx * yy;
        fz = 2 * yx * yz;
        localL = 2 * Math.sqrt(yx * yx + yy * yy + yz * yz);
      } else {
        // `bulb-de.ts`'s inlined `triplexPow8` + its `8·r⁷` heuristic factor.
        const a = yx * yx + yy * yy;
        const z2 = yz * yz;
        const r2 = a + z2;
        const r4 = r2 * r2;
        fz =
          128 * z2 * z2 * z2 * z2 -
          256 * z2 * z2 * z2 * r2 +
          160 * z2 * z2 * r4 -
          32 * z2 * r4 * r2 +
          r4 * r4;
        const s =
          128 * z2 * z2 * z2 * yz -
          192 * z2 * z2 * yz * r2 +
          80 * z2 * yz * r4 -
          8 * yz * r4 * r2;
        const rho = Math.sqrt(a);
        const inv = rho > 0 ? 1 / rho : 0;
        const u1 = yx * inv;
        const v1 = yy * inv;
        const u2 = u1 * u1 - v1 * v1;
        const v2 = 2 * u1 * v1;
        const u4 = u2 * u2 - v2 * v2;
        const v4 = 2 * u2 * v2;
        const u8 = u4 * u4 - v4 * v4;
        const v8 = 2 * u4 * v4;
        fx = rho * s * u8;
        fy = rho * s * v8;
        localL = BULB_POWER * (r2 * r2 * r2 * Math.sqrt(r2));
      }
      vx = link.w * fx;
      vy = link.w * fy;
      vz = link.w * fz;
      dr = link.growth * localL * dr;
      if (perLink) {
        vx += p[0];
        vy += p[1];
        vz += p[2];
        dr = dr + 1;
      }
      if (!(
        Math.abs(vx) < LINK_OVERFLOW_GUARD &&
        Math.abs(vy) < LINK_OVERFLOW_GUARD &&
        Math.abs(vz) < LINK_OVERFLOW_GUARD
      )) {
        r = Math.sqrt(vx * vx + vy * vy + vz * vz);
        i++;
        break outer;
      }
    }
    if (!perLink) {
      vx += p[0];
      vy += p[1];
      vz += p[2];
      dr = dr + 1;
    }
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  chainR = r;
  chainDr = dr;
  chainIters = i;
}

/** The chain's distance estimate, bound to a scene (module doc). */
function chainDE(chain: Chain, maxIterations = chain.iterations) {
  const log = chain.estimate === "log";
  return (p: Vec3): number => {
    runChain(chain, p, maxIterations);
    const r = chainR;
    if (!log) return r / chainDr;
    // `ln r` goes negative below 1, and a negative estimate marches the
    // tracer BACKWARDS — `bulb-de.ts`'s clamp, for its reason.
    return r <= 1 ? 0 : (0.5 * r * Math.log(r)) / chainDr;
  };
}

/**
 * Does `p` belong to the set the marcher will actually draw? Deliberately the
 * chain's OWN iteration budget rather than a long-budget truth oracle: the
 * question the overshoot probe asks is "does the estimate step past the
 * rendered object", and the rendered object is the finite-budget one.
 */
function chainMember(chain: Chain, p: Vec3): boolean {
  runChain(chain, p, chain.iterations);
  return chainR <= chain.bailout;
}

// ------------------------------------------------------------ chain authoring

interface LinkOpts {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

/** Build a link from the DOCUMENT vocabulary — a `Transform` through
 * `composeAffine`/`transformSigmas` — so a chain is exactly what a scene
 * document could hold if the gates admitted it. */
function link(kind: LinkKind, w: number, opts: LinkOpts = {}): ChainLink {
  const t: Transform = {
    id: 1,
    position: opts.position ?? [0, 0, 0],
    rotation: opts.rotation ?? [0, 0, 0],
    scale: opts.scale ?? [1, 1, 1],
    variations: [{ type: kind, weight: w }],
  };
  const affine = composeAffine(t);
  return {
    kind,
    m: affine.m,
    t: affine.t,
    w,
    growth: Math.abs(w) * transformSigmas(t).max,
  };
}

function chain(
  label: string,
  links: ChainLink[],
  opts: Partial<Omit<Chain, "label" | "links">> = {},
): Chain {
  const hasPower = links.some((l) => l.kind === "bulb" || l.kind === "qsquare");
  return {
    label,
    links,
    sequence: opts.sequence ?? "chain",
    bailout: opts.bailout ?? ESCAPE_TIME_RADIUS,
    // A power link reaches the bailout in two or three passes; a fold chain
    // needs the fold family's longer budget. Both are the shipped numbers.
    iterations:
      opts.iterations ?? (hasPower ? BULB_ITERATIONS : ESCAPE_TIME_ITERATIONS),
    offset: opts.offset ?? "pass",
    // The rule the estimate-form `it()` tests: a power map's potential grows
    // like `log log`, which is what the Böttcher form linearises.
    estimate: opts.estimate ?? (hasPower ? "log" : "linear"),
    marchR: opts.marchR,
  };
}

// -------------------------------------------------------------- measurement

/** Grid scan of the marching box: how much of the ball the object fills, and
 * how far it reaches. `escape-form-sweep.harness.ts`'s `extent()`, with the
 * ball radius decoupled from the scan box so a set that outgrew its bound
 * shows up as reach rather than clipping. */
function scan(
  de: DistanceEstimator,
  scanR: number,
  ballR: number,
  n: number,
): { fillPct: number; reachAbs: number } {
  let inBall = 0;
  let interiorInBall = 0;
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const p: Vec3 = [
          -scanR + (2 * scanR * i) / (n - 1),
          -scanR + (2 * scanR * j) / (n - 1),
          -scanR + (2 * scanR * k) / (n - 1),
        ];
        const r = Math.hypot(p[0], p[1], p[2]);
        const interior = de(p) < 1e-3;
        if (r <= ballR) {
          inBall++;
          if (interior) interiorInBall++;
        }
        if (interior) maxR = Math.max(maxR, r);
      }
    }
  }
  return { fillPct: (100 * interiorInBall) / inBall, reachAbs: maxR };
}

/** Fit the preview's marching ball to the object, so every panel frames its
 * own set the same way and the sheet compares SHAPES. Over-estimates
 * deliberately (rays entering further out cost steps, never geometry). */
function fitMarchRadius(de: DistanceEstimator, scanR: number): number {
  const { reachAbs } = scan(de, scanR, scanR, 35);
  if (reachAbs <= 0) return scanR;
  return Math.min(scanR, Math.max(1.15, reachAbs * 1.06));
}

/**
 * How often does the estimate claim an empty ball that is not empty? For each
 * exterior query the DE certifies `ball(p, d)` clear of the set; probing in
 * several directions and asking the membership oracle turns "the bound is
 * heuristic" into a number, comparable across chains because the shipped
 * single-map controls are measured the same way.
 *
 * TWO radii, because they answer different questions. `bound` probes at
 * `0.9·d` — how often the estimate itself is not a lower bound, i.e. how
 * heuristic it has become. `step` probes at `ESCAPE_STEP_SCALE·d` — how often
 * the marcher's ACTUAL step lands in the set, which is the only violation a
 * damped sphere tracer can be hurt by. A large gap between them means the
 * bound is loose but the shipped damping already absorbs it.
 */
function overshootPct(
  c: Chain,
  de: DistanceEstimator,
  marchR: number,
  queries = 1200,
  dirs = 14,
): { bound: number; step: number } {
  const rng = mulberry32(0x5eed_1234);
  let probed = 0;
  let badBound = 0;
  let badStep = 0;
  for (let q = 0; q < queries; q++) {
    // Uniform in the marching ball.
    const u = Math.cbrt(rng()) * marchR;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    const p: Vec3 = [u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct];
    const d = de(p);
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
        chainMember(c, [
          p[0] + 0.9 * d * ux,
          p[1] + 0.9 * d * uy,
          p[2] + 0.9 * d * uz,
        ])
      ) {
        hitBound = true;
      }
      if (
        !hitStep &&
        chainMember(c, [
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

interface PanelReport {
  panel: PanelStats;
  marchR: number;
  fillPct: number;
  reachAbs: number;
  overshoot: { bound: number; step: number };
  dampGain: number;
}

/** Render one chain and measure it. `dampGain` is the fraction of hits a 4x
 * finer march recovers — `escape-de.ts`'s own step-scale evidence, reduced to
 * one number: a DE whose steps overshoot hides surface that damping reveals.
 * The shipped mandelbox control fixes the scale for reading it. */
function report(
  c: Chain,
  scanR = 6,
  stepScale = ESCAPE_STEP_SCALE,
): PanelReport {
  const de = chainDE(c);
  const marchR = c.marchR ?? fitMarchRadius(de, scanR);
  const { fillPct, reachAbs } = scan(de, marchR, marchR, 41);
  const view = { de, boundingRadius: marchR, eyeOffset: EYE, zoom: ZOOM };
  const panel = renderPreview({ ...view, stepScale }, SIZE);
  const coarse = renderPreview({ ...view, stepScale }, 150);
  const fine = renderPreview({ ...view, stepScale: 0.08 }, 150);
  return {
    panel,
    marchR,
    fillPct,
    reachAbs,
    overshoot: overshootPct(c, de, marchR),
    dampGain:
      coarse.hits > 0 ? (100 * (fine.hits - coarse.hits)) / coarse.hits : 0,
  };
}

function printReport(i: number, c: Chain, r: PanelReport): void {
  const px = SIZE * SIZE;
  console.log(
    `  ${String(i).padStart(2)}. ${c.label}\n` +
      `      links ${c.links.length}  ${c.offset}-offset  ${c.estimate}  ` +
      `iters ${c.iterations}  bailout ${c.bailout}\n` +
      `      marchR ${r.marchR.toFixed(2)}  ball fill ${r.fillPct.toFixed(1)}%  ` +
      `reach ${r.reachAbs.toFixed(2)} (${(r.reachAbs / ESCAPE_TIME_RADIUS).toFixed(2)}xR4)  ` +
      `hits ${((100 * r.panel.hits) / px).toFixed(1)}%\n` +
      `      steps/ray ${(r.panel.steps / px).toFixed(1)}  ` +
      `overshoot bound ${r.overshoot.bound.toFixed(1)}% / step ${r.overshoot.step.toFixed(1)}%  ` +
      `damp+ ${r.dampGain >= 0 ? "+" : ""}${r.dampGain.toFixed(1)}%  ` +
      `${r.panel.ms}ms`,
  );
}

// -------------------------------------------------------------------- tests

/** A single pure-fold map — `escape-form-sweep.harness.ts`'s fixture shape. */
function foldMap(
  id: number,
  type: VariationType,
  weight: number,
  position: Vec3 = [0, 0, 0],
): Transform {
  return {
    id,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type, weight }],
  };
}

describe("hybrid chains: does the escape-time family compose?", () => {
  it("confirms the hole: shapes BOTH gates refuse", () => {
    // STILL_OPEN marks the shapes no mode admits as of this run. The fold-only
    // rows were STILL_OPEN when this harness was written and are not any more:
    // fr-za0n widened `analyzeEscapeSystem` from "exactly one active map" to a
    // chain of pure folds while these sheets were being rendered, which is
    // this investigation's recommendation already landing. They stay in the
    // table as the regression record — the gates' verbatim reasons are the
    // thing worth keeping — and only the rows that are still refused
    // everywhere carry an assertion, so this test tracks the hole rather than
    // re-litigating a closed part of it.
    const cases: {
      what: string;
      stillOpen: boolean;
      transforms: Transform[];
    }[] = [
      {
        what: "two mandelbox w=2 maps",
        stillOpen: false,
        transforms: [
          foldMap(1, "mandelbox", 2),
          foldMap(2, "mandelbox", 2, [0.3, 0, 0]),
        ],
      },
      {
        what: "mandelbox w=2 + boxfold w=1.6",
        stillOpen: false,
        transforms: [foldMap(1, "mandelbox", 2), foldMap(2, "boxfold", 1.6)],
      },
      {
        // The residual hole, and the expensive half of this investigation:
        // a fold chained with a power map is what no gate represents.
        what: "mandelbox w=2 + bulb (CROSS-FAMILY)",
        stillOpen: true,
        transforms: [foldMap(1, "mandelbox", 2), foldMap(2, "bulb", 1)],
      },
      {
        what: "mandelbox w=2 + qsquare (CROSS-FAMILY)",
        stillOpen: true,
        transforms: [foldMap(1, "mandelbox", 2), foldMap(2, "qsquare", 1)],
      },
      {
        what: "ONE map carrying mandelbox w=2 AND boxfold w=1 (a blend, not a chain)",
        stillOpen: true,
        transforms: [
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
      },
    ];
    for (const { what, stillOpen, transforms } of cases) {
      const ifs = analyzeSurfaceSystem(transforms);
      const esc = analyzeEscapeSystem(transforms);
      const bulb = analyzeBulbSystem(transforms);
      const admits = [
        ifs.status === "eligible" ? "IFS" : null,
        esc.status === "eligible" ? "escape" : null,
        bulb.status === "eligible" ? "bulb" : null,
      ].filter(Boolean);
      console.log(
        `  ${what}  ${admits.length === 0 ? "[NO MODE ADMITS IT]" : `[admitted by: ${admits.join(", ")}]`}\n` +
          `      IFS    ${ifs.status}: ${ifs.reasons.join("; ")}\n` +
          `      escape ${esc.status}: ${esc.reasons.join("; ")}\n` +
          `      bulb   ${bulb.status}: ${bulb.reasons.join("; ")}`,
      );
      // The IFS gate refuses all of these for reasons no widening of an
      // escape-time gate touches (non-contraction, or a blended variation
      // list with no branch decomposition), so it is asserted throughout.
      expect(ifs.status, `${what}: IFS`).toBe("ineligible");
      if (stillOpen) {
        expect(esc.status, `${what}: escape`).toBe("ineligible");
        expect(bulb.status, `${what}: bulb`).toBe("ineligible");
      }
    }
  });

  it("degenerates to BOTH shipped estimators at chain length 1", () => {
    // The soundness argument, executed: if the one-link chain is the shipped
    // estimator to the last bit, then chaining cannot have introduced a new
    // heuristic — it composed two existing ones.
    const rng = mulberry32(0xc0ffee);
    const escSystem = [foldMap(1, "mandelbox", 2, [0.4, 0.3, 0.2])];
    const escDe = buildEscapeDE(escSystem);
    const escChain = chain("", [
      link("mandelbox", 2, { position: [0.4, 0.3, 0.2] }),
    ]);
    const escProto = chainDE(escChain);

    const bulbSystem = [foldMap(1, "bulb", 1)];
    const bulbDe = buildBulbDE(bulbSystem);
    const bulbChain = chain("", [link("bulb", 1)], {
      bailout: bulbDe.bailout,
      iterations: BULB_ITERATIONS,
      estimate: "log",
    });
    const bulbProto = chainDE(bulbChain);

    let escMax = 0;
    let bulbMax = 0;
    for (let i = 0; i < 4000; i++) {
      const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
      escMax = Math.max(
        escMax,
        Math.abs(escProto(p) - estimateEscapeDistance(escDe, p)),
      );
      const q: Vec3 = [3 * rng() - 1.5, 3 * rng() - 1.5, 3 * rng() - 1.5];
      bulbMax = Math.max(
        bulbMax,
        Math.abs(bulbProto(q) - estimateBulbDistance(bulbDe, q)),
      );
    }
    console.log(
      `  one-link chain vs shipped, worst absolute difference over 4000 queries:\n` +
        `      mandelbox ${escMax}   bulb ${bulbMax}   (0 = bit-exact)`,
    );
    expect(escMax).toBe(0);
    expect(bulbMax).toBe(0);
  });

  it("cross-validates fr-za0n's SHIPPED chain against this prototype", () => {
    // Two independent implementations of the same idea, written from the same
    // Mandelbulber2 reading but not from each other: `escape-de.ts`'s
    // multi-map `estimateEscapeDistance` (which cycles `links[step % n]` for
    // `maxIterations * n` steps) and this harness's `cycle` arm at the same
    // budget. Bit-exact agreement over random queries is the cheapest strong
    // assurance available before six shader mirrors are written against it —
    // and the two were reached by different routes, so an agreement is
    // evidence rather than a tautology.
    const rng = mulberry32(0x2b1d);
    const systems: [string, Transform[]][] = [
      [
        "2 maps: mandelbox w=2 + boxfold w=1.6",
        [foldMap(1, "mandelbox", 2), foldMap(2, "boxfold", 1.6)],
      ],
      [
        "2 maps: mandelbox w=2 + mandelbox w=-1.5 at (0.3,0,0)",
        [
          foldMap(1, "mandelbox", 2),
          foldMap(2, "mandelbox", -1.5, [0.3, 0, 0]),
        ],
      ],
      [
        "3 maps: mandelbox + boxfold + spherefold",
        [
          foldMap(1, "mandelbox", 2),
          foldMap(2, "boxfold", 1.6),
          foldMap(3, "spherefold", 1.2),
        ],
      ],
      [
        "4 maps: mandelbox + boxfold + spherefold + mandelbox w=-1.5",
        [
          foldMap(1, "mandelbox", 2),
          foldMap(2, "boxfold", 1.6),
          foldMap(3, "spherefold", 1.2),
          foldMap(4, "mandelbox", -1.5),
        ],
      ],
    ];
    for (const [label, transforms] of systems) {
      const de = buildEscapeDE(transforms);
      const links = transforms.map((t) => {
        const v = t.variations![0];
        return link(v.type as LinkKind, v.weight, {
          position: t.position,
          rotation: t.rotation,
          scale: t.scale,
        });
      });
      const c = chain(label, links, {
        sequence: "cycle",
        iterations: ESCAPE_TIME_ITERATIONS * links.length,
      });
      const proto = chainDE(c);
      let worst = 0;
      for (let i = 0; i < 4000; i++) {
        const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
        worst = Math.max(
          worst,
          Math.abs(proto(p) - estimateEscapeDistance(de, p)),
        );
      }
      console.log(
        `  ${label.padEnd(58)} worst |shipped - prototype| = ${worst}`,
      );
      expect(worst, label).toBe(0);
    }
  });

  it("searches for cross-family chains that are not EMPTY", () => {
    // The first thing the prototype found, and the sheet's whole shape
    // depends on it: `mandelbox w=2 -> bulb` renders NOTHING. A mandelbox
    // step at the classic weight leaves `|v|` as large as ~7, and a triplex
    // 8th power sends 7 to 5.8e5 in one link — every query escapes on its
    // first pass. Power-8 links are STIFF: a chain containing one is only
    // non-empty when the composite map has a fixed radius, i.e. when the
    // link's pre-scale roughly inverts whatever expansion precedes it. This
    // scan is where the sheet's cross-family parameters come from.
    const rows: [string, ChainLink[]][] = [];
    for (const w of [2, 1.5, 1]) {
      for (const s of [1, 0.5, 0.3, 0.2, 0.145, 0.1]) {
        rows.push([
          `mandelbox w=${w} -> bulb (pre-scale ${s})`,
          [link("mandelbox", w), link("bulb", 1, { scale: [s, s, s] })],
        ]);
      }
    }
    for (const s of [1, 0.5, 0.3, 0.2]) {
      rows.push([
        `bulb (pre-scale ${s}) -> mandelbox w=2`,
        [link("bulb", 1, { scale: [s, s, s] }), link("mandelbox", 2)],
      ]);
    }
    for (const w of [2, 1.5]) {
      for (const s of [1, 0.6, 0.4, 0.3, 0.2]) {
        rows.push([
          `mandelbox w=${w} -> qsquare (pre-scale ${s})`,
          [link("mandelbox", w), link("qsquare", 1, { scale: [s, s, s] })],
        ]);
      }
    }
    // Fold-only chains need no such tuning — every fold is at most linearly
    // expanding — but these are where the sheet's fold panels come from.
    const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];
    rows.push(
      [
        "mandelbox w=2 -> boxfold w=1.6",
        [link("mandelbox", 2), link("boxfold", 1.6)],
      ],
      [
        "mandelbox w=2 -> boxfold w=1.6 -> spherefold w=1.2",
        [link("mandelbox", 2), link("boxfold", 1.6), link("spherefold", 1.2)],
      ],
      [
        "mandelbox w=2 -> mandelbox w=2 rot 20y",
        [link("mandelbox", 2), link("mandelbox", 2, { rotation: rot(20) })],
      ],
      [
        "boxfold w=1 rot 25y -> spherefold w=2",
        [link("boxfold", 1, { rotation: rot(25) }), link("spherefold", 2)],
      ],
      [
        "mandelbox w=2 -> mandelbox w=-1.5",
        [link("mandelbox", 2), link("mandelbox", -1.5)],
      ],
    );
    for (const [label, links] of rows) {
      const c = chain(label, links);
      const de = chainDE(c);
      const { fillPct, reachAbs } = scan(de, 6, 6, 27);
      console.log(
        `  ${label.padEnd(50)} fill ${fillPct.toFixed(2)}%  reach ${reachAbs.toFixed(2)}`,
      );
    }
  });

  it("renders the chain contact sheet", () => {
    const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];
    const s = (v: number): Vec3 => [v, v, v];
    const chains: Chain[] = [
      // Row 1 — the two shipped single-map objects, then folds chained.
      chain("CONTROL single mandelbox w=2 (ships today)", [
        link("mandelbox", 2),
      ]),
      chain("CONTROL single bulb (ships today)", [link("bulb", 1)]),
      chain("mandelbox w=2 -> boxfold w=1.6", [
        link("mandelbox", 2),
        link("boxfold", 1.6),
      ]),
      chain("mandelbox w=2 -> boxfold w=1.6 -> spherefold w=1.2", [
        link("mandelbox", 2),
        link("boxfold", 1.6),
        link("spherefold", 1.2),
      ]),
      // Row 2 — cross-family, and the order fork on ONE pair of links.
      chain("CROSS mandelbox w=2 -> bulb (pre-scale 0.3)", [
        link("mandelbox", 2),
        link("bulb", 1, { scale: s(0.3) }),
      ]),
      chain(
        "CROSS bulb (pre-scale 0.3) -> mandelbox w=2 — SAME PAIR REVERSED",
        [link("bulb", 1, { scale: s(0.3) }), link("mandelbox", 2)],
      ),
      chain("CROSS mandelbox w=1.5 -> bulb (pre-scale 0.5)", [
        link("mandelbox", 1.5),
        link("bulb", 1, { scale: s(0.5) }),
      ]),
      chain("CROSS mandelbox w=2 -> qsquare (pre-scale 0.4)", [
        link("mandelbox", 2),
        link("qsquare", 1, { scale: s(0.4) }),
      ]),
      // Row 3 — rotation between links, and two chosen for range.
      chain("mandelbox w=2 -> mandelbox w=2 ROTATED 20deg y", [
        link("mandelbox", 2),
        link("mandelbox", 2, { rotation: rot(20) }),
      ]),
      chain("boxfold w=1 (rot 25deg y) -> spherefold w=2 — a split mandelbox", [
        link("boxfold", 1, { rotation: rot(25) }),
        link("spherefold", 2),
      ]),
      chain("mandelbox w=2 -> mandelbox w=-1.5 — the ball meets the cube", [
        link("mandelbox", 2),
        link("mandelbox", -1.5),
      ]),
      chain(
        "CROSS mandelbox w=2 -> bulb (0.3), PER-LINK offset (cf. panel 5)",
        [link("mandelbox", 2), link("bulb", 1, { scale: s(0.3) })],
        { offset: "link" },
      ),
    ];

    const reports = chains.map((c, i) => {
      const r = report(c);
      printReport(i + 1, c, r);
      return r;
    });
    console.log(
      `  wrote ${writeContactSheet(
        reports.map((r) => r.panel),
        4,
        "hybrid-chain.png",
      )}`,
    );
    // Guard the guard: a blank panel makes the sheet meaningless.
    reports.forEach((r, i) => {
      expect(r.panel.hits, `panel ${i + 1} rendered nothing`).toBeGreaterThan(
        0.005 * SIZE * SIZE,
      );
    });
  });

  it("looks CLOSE, where mush and structure separate", () => {
    // The silhouette sheet cannot settle "richer or just fatter": every
    // escape-time set reads as a crusty ball from far enough away. This is
    // `bulb-de.ts`'s own move — re-run at a pose where creases and filigree,
    // not an outline, are what the marcher must resolve. Same eye, narrow
    // frustum, so nothing is clipped by the marching ball.
    const s = (v: number): Vec3 => [v, v, v];
    const closes: Chain[] = [
      chain("CONTROL single mandelbox w=2", [link("mandelbox", 2)]),
      chain("CONTROL single bulb", [link("bulb", 1)]),
      chain("mandelbox w=2 -> mandelbox w=2 rot 20y", [
        link("mandelbox", 2),
        link("mandelbox", 2, { rotation: [0, Math.PI / 9, 0] }),
      ]),
      chain("boxfold w=1 rot 25y -> spherefold w=2", [
        link("boxfold", 1, { rotation: [0, (25 * Math.PI) / 180, 0] }),
        link("spherefold", 2),
      ]),
      chain("CROSS mandelbox w=2 -> bulb (0.3)", [
        link("mandelbox", 2),
        link("bulb", 1, { scale: s(0.3) }),
      ]),
      chain("CROSS mandelbox w=1.5 -> bulb (0.5)", [
        link("mandelbox", 1.5),
        link("bulb", 1, { scale: s(0.5) }),
      ]),
    ];
    // Aim at the object's near RIM, not its centre, so each panel carries a
    // silhouette edge as well as a surface. `de-preview.ts` centres the
    // marching ball on `target`, so the ball is inflated by the same offset —
    // a close pose must never crop the object it is inspecting.
    const dir = Math.hypot(...CLOSE_EYE);
    const panels = closes.map((c) => {
      const de = chainDE(c);
      const fit = fitMarchRadius(de, 6);
      const aim = 0.62 * fit;
      const target: Vec3 = [
        (CLOSE_EYE[0] / dir) * aim,
        (CLOSE_EYE[1] / dir) * aim,
        (CLOSE_EYE[2] / dir) * aim,
      ];
      const marchR = fit + aim;
      const panel = renderPreview(
        {
          de,
          boundingRadius: marchR,
          target,
          stepScale: ESCAPE_STEP_SCALE,
          eyeOffset: [
            (CLOSE_EYE[0] / dir) * 1.3,
            (CLOSE_EYE[1] / dir) * 1.3,
            (CLOSE_EYE[2] / dir) * 1.3,
          ],
          zoom: CLOSE_ZOOM,
        },
        SIZE,
      );
      console.log(
        `  ${c.label.padEnd(38)} marchR ${marchR.toFixed(2)}  ` +
          `hits ${((100 * panel.hits) / (SIZE * SIZE)).toFixed(1)}%  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}  ${panel.ms}ms`,
      );
      return panel;
    });
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "hybrid-chain-close.png")}`,
    );
  });

  it("forks the offset: per PASS vs per LINK", () => {
    const pairs: [string, ChainLink[]][] = [
      [
        "mandelbox w=2 -> boxfold w=1.6",
        [link("mandelbox", 2), link("boxfold", 1.6)],
      ],
      [
        "mandelbox w=2 -> bulb (pre-scale 0.3)",
        [link("mandelbox", 2), link("bulb", 1, { scale: [0.3, 0.3, 0.3] })],
      ],
      [
        "mandelbox -> boxfold -> spherefold",
        [link("mandelbox", 2), link("boxfold", 1.6), link("spherefold", 1.2)],
      ],
    ];
    const panels: PanelStats[] = [];
    for (const offset of ["pass", "link"] as const) {
      for (const [label, links] of pairs) {
        const c = chain(`${offset}-offset  ${label}`, links, { offset });
        const de = chainDE(c);
        const marchR = fitMarchRadius(de, 6);
        const { fillPct, reachAbs } = scan(de, marchR, marchR, 41);
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
        const os = overshootPct(c, de, marchR);
        console.log(
          `  ${c.label}\n` +
            `      marchR ${marchR.toFixed(2)}  fill ${fillPct.toFixed(1)}%  ` +
            `reach ${reachAbs.toFixed(2)}  ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}%  ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)}  ` +
            `overshoot ${os.bound.toFixed(1)}%/${os.step.toFixed(1)}%  ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "hybrid-chain-offset.png")}`,
    );
  });

  it("forks the estimate form: linear vs Bottcher log on a mixed chain", () => {
    // `escape-de.ts` reads `r/dr`, `bulb-de.ts` reads `0.5·r·ln r/dr`. A chain
    // holding both has to pick one, and Mandelbulber2 makes it a per-hybrid
    // setting. These are the numbers behind this harness's default rule.
    const specs: [string, ChainLink[]][] = [
      [
        "mandelbox -> bulb (pre-scale 0.3)",
        [link("mandelbox", 2), link("bulb", 1, { scale: [0.3, 0.3, 0.3] })],
      ],
      [
        "mandelbox -> qsquare (pre-scale 0.4)",
        [link("mandelbox", 2), link("qsquare", 1, { scale: [0.4, 0.4, 0.4] })],
      ],
      [
        "mandelbox -> boxfold (no power link)",
        [link("mandelbox", 2), link("boxfold", 1.6)],
      ],
    ];
    for (const [label, links] of specs) {
      for (const estimate of ["linear", "log"] as const) {
        const c = chain(label, links, { estimate });
        const de = chainDE(c);
        const marchR = fitMarchRadius(de, 6);
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: ESCAPE_STEP_SCALE,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          200,
        );
        const os = overshootPct(c, de, marchR);
        console.log(
          `  ${label.padEnd(38)} ${estimate.padEnd(6)}  ` +
            `marchR ${marchR.toFixed(2)}  ` +
            `hits ${((100 * panel.hits) / (200 * 200)).toFixed(1)}%  ` +
            `steps/ray ${(panel.steps / (200 * 200)).toFixed(1)}  ` +
            `overshoot bound ${os.bound.toFixed(1)}% / step ${os.step.toFixed(1)}%`,
        );
      }
    }
  });

  it("asks what bailout radius a chain needs", () => {
    // The single-map estimators use 4. A chain of expanding maps might not
    // settle there — if the object keeps growing as the bailout rises, 4 is
    // clipping it.
    const specs: [string, ChainLink[]][] = [
      ["CONTROL single mandelbox w=2", [link("mandelbox", 2)]],
      ["mandelbox -> boxfold", [link("mandelbox", 2), link("boxfold", 1.6)]],
      [
        "mandelbox -> boxfold -> spherefold",
        [link("mandelbox", 2), link("boxfold", 1.6), link("spherefold", 1.2)],
      ],
      [
        "mandelbox -> bulb (pre-scale 0.3)",
        [link("mandelbox", 2), link("bulb", 1, { scale: [0.3, 0.3, 0.3] })],
      ],
      [
        "mandelbox -> mandelbox rot 20",
        [
          link("mandelbox", 2),
          link("mandelbox", 2, { rotation: [0, Math.PI / 9, 0] }),
        ],
      ],
    ];
    for (const [label, links] of specs) {
      const row: string[] = [];
      for (const bailout of [4, 8, 16, 64]) {
        const c = chain(label, links, { bailout });
        const de = chainDE(c);
        const { fillPct, reachAbs } = scan(de, 6, 6, 33);
        // Average orbit length over the same grid, for the cost side.
        let iters = 0;
        let n = 0;
        for (let i = 0; i < 15; i++)
          for (let j = 0; j < 15; j++)
            for (let k = 0; k < 15; k++) {
              runChain(
                c,
                [-3 + (6 * i) / 14, -3 + (6 * j) / 14, -3 + (6 * k) / 14],
                c.iterations,
              );
              iters += chainIters;
              n++;
            }
        row.push(
          `${bailout}: fill ${fillPct.toFixed(1)}% reach ${reachAbs.toFixed(2)} iters ${(iters / n).toFixed(1)}`,
        );
      }
      console.log(`  ${label}\n      ${row.join("   |   ")}`);
    }
  });

  it("sweeps the march step scale on the cross-family chain", () => {
    // `escape-de.ts` measured 0.35 against the single mandelbox. If chaining
    // degraded the bound, the chain's hits will keep climbing below 0.35
    // where the control's flatten — that climb IS the degradation signal.
    const cases: [string, Chain][] = [
      ["CONTROL single mandelbox w=2", chain("", [link("mandelbox", 2)])],
      [
        "CROSS mandelbox -> bulb (0.3)",
        chain("", [
          link("mandelbox", 2),
          link("bulb", 1, { scale: [0.3, 0.3, 0.3] }),
        ]),
      ],
    ];
    const panels: PanelStats[] = [];
    for (const [label, c] of cases) {
      const de = chainDE(c);
      const marchR = fitMarchRadius(de, 6);
      for (const stepScale of [1, 0.5, 0.35, 0.2, 0.1, 0.05]) {
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        console.log(
          `  ${label.padEnd(30)} stepScale ${String(stepScale).padEnd(5)}  ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(2)}%  ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)}  ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 6, "hybrid-chain-march.png")}`,
    );
  });

  it("forks the sequence: CHAINING vs CYCLING", () => {
    // The fr-za0n fork. CHAINING applies every link inside one pass;
    // CYCLING applies slot `i mod n` at pass `i` — Mandelbulber2's own
    // `seq->GetSequence(i)`. Cycling at the SAME iteration budget applies
    // each map a third as often, so each fixture is rendered three ways:
    // chained, cycled at the same budget, and cycled at n x the budget
    // (equal fold applications, equal cost).
    const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];
    const fixtures: [string, ChainLink[]][] = [
      ["mbox2 -> boxfold1.6", [link("mandelbox", 2), link("boxfold", 1.6)]],
      [
        "mbox2 -> mbox2 rot20y",
        [link("mandelbox", 2), link("mandelbox", 2, { rotation: rot(20) })],
      ],
      [
        "mbox2 -> boxfold1.6 -> sphere1.2",
        [link("mandelbox", 2), link("boxfold", 1.6), link("spherefold", 1.2)],
      ],
      ["mbox2 -> mbox-1.5", [link("mandelbox", 2), link("mandelbox", -1.5)]],
      [
        "FOUR: mbox2 -> box1.6 -> sph1.2 -> mbox-1.5",
        [
          link("mandelbox", 2),
          link("boxfold", 1.6),
          link("spherefold", 1.2),
          link("mandelbox", -1.5),
        ],
      ],
      [
        "SIX: mbox2 x2 -> box1.6 -> sph1.2 -> mbox-1.5 -> box1 rot25y",
        [
          link("mandelbox", 2),
          link("mandelbox", 2, { rotation: rot(20) }),
          link("boxfold", 1.6),
          link("spherefold", 1.2),
          link("mandelbox", -1.5),
          link("boxfold", 1, { rotation: rot(25) }),
        ],
      ],
    ];
    const panels: PanelStats[] = [];
    for (const [label, links] of fixtures) {
      const n = links.length;
      const arms: [string, Chain][] = [
        ["chain", chain(label, links)],
        ["cycle", chain(label, links, { sequence: "cycle" })],
        [
          `cycle x${n}`,
          chain(label, links, {
            sequence: "cycle",
            iterations: ESCAPE_TIME_ITERATIONS * n,
          }),
        ],
      ];
      for (const [arm, c] of arms) {
        const de = chainDE(c);
        const marchR = fitMarchRadius(de, 6);
        const { fillPct, reachAbs } = scan(de, marchR, marchR, 41);
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: 0.2,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        const os = overshootPct(c, de, marchR);
        console.log(
          `  ${label.padEnd(28)} ${arm.padEnd(9)} iters ${String(c.iterations).padEnd(3)} ` +
            `marchR ${marchR.toFixed(2)} fill ${fillPct.toFixed(1)}% ` +
            `reach ${reachAbs.toFixed(2)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ` +
            `overshoot ${os.bound.toFixed(1)}%/${os.step.toFixed(1)}% ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "hybrid-chain-sequence.png")}`,
    );

    // The same fork CLOSE UP, where mush and structure separate — the sheet
    // above can only compare silhouettes, and "richer" is not a silhouette
    // property. Equal-work arms only (chain@30 and cycle@30n both apply each
    // link 30 times).
    const close: PanelStats[] = [];
    for (const [label, links] of fixtures.slice(0, 4)) {
      const n = links.length;
      for (const [arm, c] of [
        ["chain", chain(label, links)],
        [
          `cycle x${n}`,
          chain(label, links, {
            sequence: "cycle",
            iterations: ESCAPE_TIME_ITERATIONS * n,
          }),
        ],
      ] as [string, Chain][]) {
        const de = chainDE(c);
        // The RIM-aimed close pose, not a centred one: `de-preview.ts`
        // centres the marching ball on `target`, so a narrow frustum aimed at
        // the origin shows nothing but interior surface and reads as noise.
        // Aim at the near rim and inflate the ball by the same offset.
        const fit = fitMarchRadius(de, 6);
        const aim = 0.62 * fit;
        const cd = Math.hypot(...CLOSE_EYE);
        const panel = renderPreview(
          {
            de,
            boundingRadius: fit + aim,
            target: [
              (CLOSE_EYE[0] / cd) * aim,
              (CLOSE_EYE[1] / cd) * aim,
              (CLOSE_EYE[2] / cd) * aim,
            ],
            stepScale: 0.2,
            eyeOffset: [
              (CLOSE_EYE[0] / cd) * 1.3,
              (CLOSE_EYE[1] / cd) * 1.3,
              (CLOSE_EYE[2] / cd) * 1.3,
            ],
            zoom: CLOSE_ZOOM,
          },
          SMALL,
        );
        console.log(
          `  CLOSE ${label.padEnd(28)} ${arm.padEnd(9)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ${panel.ms}ms`,
        );
        close.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(close, 2, "hybrid-chain-sequence-close.png")}`,
    );
  });

  it("asks whether CYCLING dissolves the power-link stiffness", () => {
    // The prediction the fold-only fixtures above cannot test, and the one
    // that could settle the fork on its own. CHAINING feeds the power link
    // the fold's EXPANDED output — a mandelbox step leaves `|v|` up to ~7 and
    // `7⁸ = 5.8e5` — which is why `mandelbox w=2 -> bulb` is EMPTY at
    // pre-scale 1 and has to be detuned to ~0.3. CYCLING never does that: at
    // the power link's turn the orbit has just passed the bailout check, so
    // `|v| <= 4` by construction. If that alone is enough, cycling admits
    // cross-family systems with NO per-link tuning — which is the difference
    // between a knob users must discover and a mode that just works.
    const s = (v: number): Vec3 => [v, v, v];
    const specs: [string, ChainLink[]][] = [];
    for (const ps of [1, 0.5, 0.3]) {
      specs.push([
        `mandelbox w=2 -> bulb (pre-scale ${ps})`,
        [link("mandelbox", 2), link("bulb", 1, { scale: s(ps) })],
      ]);
    }
    for (const ps of [1, 0.6, 0.4]) {
      specs.push([
        `mandelbox w=2 -> qsquare (pre-scale ${ps})`,
        [link("mandelbox", 2), link("qsquare", 1, { scale: s(ps) })],
      ]);
    }
    const panels: PanelStats[] = [];
    for (const [label, links] of specs) {
      const n = links.length;
      const arms: [string, Chain][] = [
        ["chain", chain(label, links)],
        [
          `cycle x${n}`,
          chain(label, links, {
            sequence: "cycle",
            // Equal work: each link applied the same number of times as the
            // chained arm applies it.
            iterations: BULB_ITERATIONS * n,
          }),
        ],
      ];
      for (const [arm, c] of arms) {
        const de = chainDE(c);
        const marchR = fitMarchRadius(de, 6);
        const { fillPct, reachAbs } = scan(de, marchR, marchR, 41);
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: 0.2,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        const os = overshootPct(c, de, marchR);
        console.log(
          `  ${label.padEnd(38)} ${arm.padEnd(9)} ` +
            `marchR ${marchR.toFixed(2)} fill ${fillPct.toFixed(2)}% ` +
            `reach ${reachAbs.toFixed(2)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(1)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ` +
            `overshoot ${os.bound.toFixed(1)}%/${os.step.toFixed(1)}% ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 4, "hybrid-chain-cross-sequence.png")}`,
    );
  });

  it("sweeps the march step scale at a SILHOUETTE pose", () => {
    // The sweep the shipped scale has to come off. `escape-form-sweep`'s pose
    // (default eye, zoom 0.28), NOT this module's close-up: at the close pose
    // every panel reads ~100% hits and the metric is saturated, so it can
    // only compare textures. Here dropout speckle is the signal, exactly as
    // it was for fr-7u8t.8's single map.
    const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];
    const cases: [string, Chain][] = [
      ["CONTROL single mbox2", chain("", [link("mandelbox", 2)])],
      [
        "mbox2 -> boxfold1.6",
        chain("", [link("mandelbox", 2), link("boxfold", 1.6)]),
      ],
      [
        "mbox2 -> mbox2 rot20y",
        chain("", [
          link("mandelbox", 2),
          link("mandelbox", 2, { rotation: rot(20) }),
        ]),
      ],
      [
        "mbox2 -> boxfold -> sphere",
        chain("", [
          link("mandelbox", 2),
          link("boxfold", 1.6),
          link("spherefold", 1.2),
        ]),
      ],
    ];
    const panels: PanelStats[] = [];
    for (const [label, c] of cases) {
      const de = chainDE(c);
      const marchR = fitMarchRadius(de, 6);
      for (const stepScale of [0.7, 0.35, 0.2, 0.15, 0.1, 0.05]) {
        const panel = renderPreview(
          { de, boundingRadius: marchR, stepScale, zoom: 0.28 },
          SMALL,
        );
        console.log(
          `  ${label.padEnd(28)} stepScale ${String(stepScale).padEnd(5)} ` +
            `hits ${((100 * panel.hits) / (SMALL * SMALL)).toFixed(2)}% ` +
            `steps/ray ${(panel.steps / (SMALL * SMALL)).toFixed(1)} ${panel.ms}ms`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 6, "hybrid-chain-march2.png")}`,
    );
  });

  it("prices a chain against the single map it generalises", () => {
    // Cost is the other half of the verdict: a chain of n links is n times
    // the work per orbit step, but the orbit may also escape sooner.
    // Queries are drawn in each chain's OWN fitted marching ball, which is
    // `bulb-de.ts`'s convention for the same measurement: cost is dominated by
    // orbit length, and orbit length is a property of where the query sits
    // relative to the object rather than of a shared box.
    const specs: [string, Chain][] = [
      ["single mandelbox (shipped shape)", chain("", [link("mandelbox", 2)])],
      ["single bulb (shipped shape)", chain("", [link("bulb", 1)])],
      [
        "mandelbox -> boxfold",
        chain("", [link("mandelbox", 2), link("boxfold", 1.6)]),
      ],
      [
        "mandelbox -> boxfold -> spherefold",
        chain("", [
          link("mandelbox", 2),
          link("boxfold", 1.6),
          link("spherefold", 1.2),
        ]),
      ],
      [
        "mandelbox -> bulb (pre-scale 0.3)",
        chain("", [
          link("mandelbox", 2),
          link("bulb", 1, { scale: [0.3, 0.3, 0.3] }),
        ]),
      ],
    ];
    for (const [label, c] of specs) {
      const de = chainDE(c);
      const marchR = fitMarchRadius(de, 6);
      const rng = mulberry32(0xbeef);
      const pts: Vec3[] = [];
      for (let i = 0; i < 60_000; i++) {
        const u = Math.cbrt(rng()) * marchR;
        const ct = 2 * rng() - 1;
        const st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = 2 * Math.PI * rng();
        pts.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
      }
      let acc = 0;
      let iters = 0;
      const t0 = Date.now();
      for (const p of pts) {
        acc += de(p);
        iters += chainIters;
      }
      const ms = Date.now() - t0;
      console.log(
        `  ${label.padEnd(36)} ${((ms * 1000) / pts.length).toFixed(2)} us/eval  ` +
          `${(iters / pts.length).toFixed(1)} orbit iters  ` +
          `(ball ${marchR.toFixed(2)}, checksum ${acc.toFixed(3)})`,
      );
    }
  });
});
