/**
 * Is the escape-chain speckle UNDERSAMPLING, or is it the OBJECT? (fr-za0n)
 *
 * `escape-chain.harness.ts` draws the shipped estimator and the sheet it
 * writes — `scripts/out/escape-chain.png` — is structurally interesting and
 * visually NOISY: a dark grainy crust with bright specks, at every chain
 * length INCLUDING the single-map control that already ships. Two very
 * different things look like that, and they have different fixes:
 *
 *   (A) MARCH UNDERSAMPLING — rays running out of step budget, or striding
 *       past thin features. Fixed by budget and damping, and therefore
 *       fixed for free by the app, whose marcher is far better than this
 *       one. A harness artifact.
 *   (B) SUB-PIXEL STRUCTURE — the set really is filamentary below one pixel
 *       at this framing. No budget fixes it; only supersampling does, and
 *       until then it reads as noise whatever palette is applied.
 *
 * A third candidate has to be ruled out before either of those can be read,
 * because it is the harness's own and would be mistaken for both:
 *
 *   (C) THE SHADING PROXY — `de-preview.ts` stands the step count in for
 *       ambient occlusion (`1 - used/150`) and cone-traces a soft shadow.
 *       On a fold DE both read the marcher's statistics rather than the
 *       object, so either could manufacture pixel-scale contrast. The app
 *       shades with a real distance-probe AO. (Measured below: they do the
 *       OPPOSITE — they flatten. Ruled out, backwards.)
 *
 * THE DISCRIMINATOR is local roughness and how much of it SURVIVES a 4x4 box
 * downsample. Independent per-pixel noise collapses under averaging (16
 * samples, so adjacent block means differ ~4x less); real structure at
 * multi-pixel scale barely changes, and a smooth ramp gets ~4x ROUGHER
 * because adjacent blocks are 4 pixels apart. {@link survival} is that
 * ratio, and the first test calibrates it on synthetic fields so the numbers
 * below have anchors rather than adjectives.
 *
 * Four arms per fixture, each answering one term of the split:
 *
 *     A  shipped     600 steps, stepScale 0.35   — escape-chain.png's own
 *     B  generous   4000 steps, stepScale 0.12   — A minus (A)
 *     C  flat-shade B with the AO/shadow proxies off — B minus (C)
 *     D  4x SS      C at 4x linear, box-downsampled — C minus (B)
 *
 * plus a SPHERE row (`|p| - 1`, same pose, same marcher) as the anchor for
 * "a solid object with no sub-pixel structure at all", and — the direct
 * measurement, needing no inference — the fraction of the object's pixels
 * whose 4x COVERAGE is strictly partial. A pixel that is 40% object is a
 * pixel no march budget can resolve.
 *
 * The second question is COLOUR. The app paints escape renders with the
 * CONTINUOUS escape count (fr-7u8t.8, `escapedAt - log(r/R)/log(growth)`,
 * counted in single-link steps since fr-s04t); `de-preview.ts` shades by
 * normal and step count and shows none of it. {@link escapeTrap} mirrors the
 * GLSL/WGSL hit-info overload term for term and the last test measures that
 * coordinate's SPATIAL COHERENCE over the same hit pixels — against the raw
 * integer count it replaced, and against the hit DEPTH, which is the
 * smoothest field the same surface can carry.
 *
 * ============================ THE VERDICT ============================
 *
 * IT IS (B), and the margin is not close. Rows are CONTROL / TWO / SIX.
 *
 * (A) IS REFUTED as the story. NOT ONE RAY exhausts its budget in ANY arm
 * of ANY row — 0.00% at the shipped 600 steps, and still 0.00% at 12000
 * steps with the step scale at 0.05. (The app agrees: it reports
 * `exhausted 0` on escape renders.) The other (A) mechanism, striding past
 * thin features, is real but small and SATURATES: damping 0.35 -> 0.05
 * finds 3.2 / 2.8 / 3.8 more percentage points of surface (~8% relative)
 * and takes isolated-pixel speckle from 1.11/0.90/0.65% to 0.47/0.53/0.26%.
 * A third of the GEOMETRIC speckle is march-fixable; two thirds is not.
 *
 * (B) IS THE OBJECT, measured three independent ways:
 *
 *   PARTIAL COVERAGE — the reading that needs no inference. At 16 samples
 *   per pixel, 13.1 / 13.3 / 8.0% of the object's pixels are covered
 *   strictly between 10% and 90%. The unit-sphere anchor, same pose, same
 *   marcher, reads 1.31% (its silhouette, and nothing else). These objects
 *   are 6-10x finer than the pixel grid.
 *
 *   THE PICTURE CHANGES, it does not merely settle. Between the 1-sample
 *   and the 16-sample render, mean luminance moves 15.6 / 15.6 / 21.9 of
 *   255 and 27.4 / 27.4 / 37.6% of pixels move by more than 24/255. The
 *   sphere moves 0.4/255 and 0.29% of pixels. A speckle that a better
 *   marcher would fix does not repaint a third of the frame.
 *
 *   THE ROUGHNESS IS NOISE-SHAPED and supersampling is what un-shapes it.
 *   Survival S (0.24 = per-pixel noise, ~4 = smooth structure; the first
 *   test measures those anchors) sits at 0.46-0.49 for the 1-sample fold
 *   renders against the sphere's 3.7, and rises to 0.57-0.65 supersampled
 *   while the impulse rate falls 67-73% and roughness more than halves.
 *
 * (C) THE SHADING PROXY EXONERATED, and backwards from the guess: turning
 * the step-count AO and the cone shadow OFF makes the 1-sample picture
 * MORE speckled, not less (impulse 39.0 -> 47.3, 39.3 -> 47.4, 28.0 ->
 * 48.7). They were FLATTENING the noise, not making it — the shadow term
 * crushes self-shadowed filigree toward one dark value. So `de-preview.ts`
 * is not what these sheets are measuring.
 *
 * WILL THE APP'S MARCHER FIX IT? No. The app's advantages over this
 * harness are budget, an empty-space grid and a tier-pinned acceptance
 * epsilon — all of them (A) machinery, and (A) is 0.00% here. The app
 * renders one sample per pixel with no antialiasing, exactly like arm A.
 *
 * WILL THE APP'S BIGGER VIEWPORT FIX IT? No, and this is the measurement
 * that closes the question rather than arguing it. Partial coverage
 * against output resolution, every size at 16 samples per pixel so only
 * the pixel size changes:
 *
 *              128px   256px   512px    exponent   4x pixels buys
 *     CONTROL  15.29%  13.14%  11.42%     -0.21    25% fewer
 *     SIX      10.25%   8.01%   6.23%     -0.36    39% fewer
 *     sphere    2.67%   1.31%   0.69%     -0.98    74% fewer
 *
 * The sphere measures the perimeter law exactly (-1: its partial pixels
 * are a curve, so they halve when the pixels do), which is the instrument
 * validating itself. The folds do not: at -0.21 the object yields new
 * structure almost as fast as pixels are added, and HALVING its partial
 * coverage would take 26x the linear resolution. The impulse rate does not
 * move at all — 12.03 / 12.54 / 12.71% across a 4x resolution range — so
 * the appearance is scale-invariant even where the coverage slowly
 * improves. This is a genuinely filamentary object at every framing, not
 * one that is merely under-resolved at this one.
 *
 * WHAT WOULD ACTUALLY FIX IT is samples per pixel, not pixels: 16 of them
 * removes 67-73% of the impulse and turns the colour coordinate from
 * noise-shaped into the most coherent field measured. That is a real,
 * bounded change (the compute renderer already traces a host-compacted ray
 * list, so N samples per pixel is N times the rays and nothing else),
 * priced against the fact that these sessions already settle in seconds.
 *
 * WOULD COLOUR MAKE IT READ AS STRUCTURE? Only after the same fix. At one
 * sample per pixel the escape-count coordinate is noise-shaped — S 0.44 /
 * 0.39 / 0.36, against the hit depth's 1.39 / 1.58 / 1.91 on the SAME
 * pixels — and 25.1 / 12.5 / 8.2% of neighbouring pixel pairs are more
 * than 0.12 of the ramp apart. Supersampled it becomes the most coherent
 * field measured: confetti falls to 7.5 / 2.1 / 0.2%, BELOW the depth's
 * own, and `chain-speckle-trap.png`'s third column shows shells, plates
 * and portholes where its first shows fizz. So the coordinate is sound and
 * the aliasing is shared: colour is worth having, and worth nothing until
 * the sampling is fixed.
 *
 * TWO THINGS FOUND ON THE WAY, both about the CHAIN specifically:
 *
 *   fr-7u8t.8's CONTINUOUS COUNT BUYS NOTHING HERE. Against the raw
 *   integer count it replaced, on the same pixels: mean|d| 0.1130 vs
 *   0.1102, confetti 25.1 vs 25.0%, S 0.44 vs 0.44 — indistinguishable.
 *   It smooths WITHIN a count band, and 54.6 / 58.6 / 72.7% of neighbour
 *   pairs here are already more than a whole count apart. (The correction
 *   still earns its place on the objects it was measured against; it just
 *   cannot reach this framing's problem.) Read the confetti threshold's
 *   own doc before comparing the two at 0.1 — that lands exactly on the
 *   raw count's lattice and manufactures an 8-point gap out of rounding.
 *
 *   A CHAIN USED ONLY THE BOTTOM OF THE RAMP, and this is where that was
 *   found. The coordinate divided by `maxDepth * n` single-link steps,
 *   but escaping orbits leave in a few steps however long the chain is,
 *   so the [p05 p50 p95] of the trap ran [0.125 0.230 0.757] at one link,
 *   [0.083 0.132 0.313] at two and [0.043 0.072 0.205] at six — a palette
 *   over that painted a six-link chain in the darkest fifth of its ramp,
 *   visible here as rows that darkened with length.
 *
 *   FIXED (fr-byxb): the denominator is the PASS budget now, and this
 *   harness's own numbers are what the fix was checked against. One link
 *   is unchanged to the bit; two and six now run [0.166 0.265 0.626] and
 *   [0.256 0.431 1.000], and the rows brighten with length instead of
 *   darkening. The cost is the clamp at the top — 1.9% of hit pixels at
 *   two links, 8.6% at six, against 3.99% for the single map, which is
 *   the number to beat for anyone trying a normalizer that does not
 *   saturate.
 *
 * IN ONE LINE: the speckle is ~30% march (fixable, already saturating) and
 * ~70% the object (not fixable by marching or by pixels). It is real
 * structure, aliased — `chain-speckle.png`'s fourth column is what it
 * looks like resolved, and it is worth looking at.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/chain-speckle.harness.ts
 * Writes: `scripts/out/chain-speckle.png` (the four arms),
 *         `scripts/out/chain-speckle-budget.png` (the sweep),
 *         `scripts/out/chain-speckle-trap.png` (the colour coordinate).
 * Takes 3-5 min; the resolution-scaling test is most of it.
 */
import {
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  buildEscapeDE,
  estimateEscapeDistance,
  foldQueryIntoSector,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import { mulberry32 } from "../src/fractal/rng";
import {
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import type { Transform, VariationType } from "../src/fractal/types";
import {
  DEFAULT_MAX_STEPS,
  PREVIEW_HIT,
  renderPreview,
  writeContactSheet,
} from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

/** Panel size for the four-arm sheet. The 4x arm marches this squared times
 * sixteen rays at a quarter of the acceptance epsilon, so it is the term
 * that prices the whole file. */
const SIZE = 256;
/** Linear supersample factor — 16 samples per pixel, the box the survival
 * statistic is defined over. */
const SS = 4;

/** `escape-chain.harness.ts`'s pose, verbatim, so these panels are the ones
 * the question was asked about rather than a second framing. */
const EYE: Vec3 = [1.348, 0.957, 1.565];
const ZOOM = 0.52;

/** The generous march: enough budget that exhaustion cannot be the story,
 * and damping well past the knee `escape-de.ts`'s step-scale sweep found. */
const GENEROUS_STEPS = 4000;
const GENEROUS_SCALE = 0.12;

/** Luminance step (0..255) a pixel must differ from its neighbours' median
 * by before it counts as an impulse. ~10% of range — visible as a speck,
 * not as shading. */
const IMPULSE_THRESHOLD = 24;

/**
 * Palette-space jump between neighbouring pixels that counts as CONFETTI.
 *
 * 0.12 rather than the round 0.1 to keep it OFF the raw integer count's own
 * lattice: that coordinate takes values `k / (30n)`, so at 0.1 the six-link
 * row's differences land exactly ON the threshold (18 counts) and the
 * one-link row's on 3 — and `>` then reports a quantization accident as a
 * quality difference between the raw count and the continuous one.
 */
const CONFETTI_THRESHOLD = 0.12;

/** Coverage band counted as PARTIAL: a pixel this far from both empty and
 * full is one the object only fills part of, which is the definition of
 * structure below the pixel grid. */
const PARTIAL_LO = 0.1;
const PARTIAL_HI = 0.9;

// ------------------------------------------------------------- fixtures

/** `escape-chain.harness.ts`'s `foldMap`, duplicated rather than imported:
 * importing a `*.harness.ts` file would register its whole suite here. */
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

/** The three lengths the question is about: the single map that already
 * ships (so every reading has the accepted baseline beside it), a two-link
 * chain, and the six-link one. `escape-chain.harness.ts`'s fixtures 1, 2
 * and 8, unchanged. */
const FIXTURES: [string, Transform[]][] = [
  ["CONTROL single mbox2", [foldMap(1, "mandelbox", 2)]],
  [
    "TWO mbox2 -> boxfold1.6",
    [foldMap(1, "mandelbox", 2), foldMap(2, "boxfold", 1.6)],
  ],
  [
    "SIX mbox2 -> mbox2r20 -> box1.6 -> sph1.2 -> mbox-1.5 -> box1r25",
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

/** The anchor row: a unit sphere through the identical marcher, shading and
 * pose. Whatever speckle a SMOOTH solid measures here is the floor every
 * fold reading has to be read against — it is what the instrument itself
 * contributes. */
const SPHERE: DistanceEstimator = (p) => Math.hypot(p[0], p[1], p[2]) - 1;
const SPHERE_R = 1.12;
const SPHERE_LABEL = "ANCHOR unit sphere (a smooth solid)";

// -------------------------------------------------------- field statistics

/** Grid scan of the marching box (`escape-chain.harness.ts`'s `scan`, cut
 * down to the reach it is used for here). */
function reachOf(de: DistanceEstimator, scanR: number, n: number): number {
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const p: Vec3 = [
          -scanR + (2 * scanR * i) / (n - 1),
          -scanR + (2 * scanR * j) / (n - 1),
          -scanR + (2 * scanR * k) / (n - 1),
        ];
        if (de(p) < 1e-3) maxR = Math.max(maxR, Math.hypot(p[0], p[1], p[2]));
      }
    }
  }
  return maxR;
}

/** `escape-chain.harness.ts`'s `fitMarchRadius`, verbatim in effect, so a
 * panel here frames what the sheet in question framed. */
function fitMarchRadius(de: DistanceEstimator): number {
  const reach = reachOf(de, ESCAPE_TIME_RADIUS, 35);
  if (reach <= 0) return ESCAPE_TIME_RADIUS;
  return Math.min(ESCAPE_TIME_RADIUS, Math.max(1.15, reach * 1.06));
}

/** Rec.709 luminance of a rendered panel, 0..255. Post-gamma on purpose:
 * the question is what the picture LOOKS like. */
function luminance(panel: PanelStats): Float64Array {
  const out = new Float64Array(panel.width * panel.height);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      0.2126 * panel.rgb[i * 3] +
      0.7152 * panel.rgb[i * 3 + 1] +
      0.0722 * panel.rgb[i * 3 + 2];
  }
  return out;
}

interface Down {
  v: Float64Array;
  /** Samples that contributed to each block, 0..k*k. */
  n: Float64Array;
  w: number;
  h: number;
}

/** Box-downsample by `k`, averaging only where `weight` is set (null = every
 * sample counts). Blocks with no contributing sample come back as 0 with
 * `n = 0`, which is what the masks below test. */
function boxDown(
  v: Float64Array,
  w: number,
  h: number,
  k: number,
  weight: Uint8Array | null,
): Down {
  const dw = Math.floor(w / k);
  const dh = Math.floor(h / k);
  const out = new Float64Array(dw * dh);
  const cnt = new Float64Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const src = (y * k + dy) * w + (x * k + dx);
          if (weight && !weight[src]) continue;
          sum += v[src];
          n++;
        }
      }
      out[y * dw + x] = n > 0 ? sum / n : 0;
      cnt[y * dw + x] = n;
    }
  }
  return { v: out, n: cnt, w: dw, h: dh };
}

/** Dilate a 0/1 mask by `r` in the Chebyshev metric. */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
          out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

/** Mean |difference| between 4-connected neighbours, counting a pair only
 * when BOTH members are in `mask`. */
function roughness(
  v: Float64Array,
  w: number,
  h: number,
  mask: Uint8Array,
): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (x + 1 < w && mask[i + 1]) {
        sum += Math.abs(v[i + 1] - v[i]);
        n++;
      }
      if (y + 1 < h && mask[i + w]) {
        sum += Math.abs(v[i + w] - v[i]);
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * How much of a field's local roughness SURVIVES a 4x4 box downsample.
 *
 *   ~0.25  independent per-pixel noise (16 samples average it away, and
 *          adjacent block means stay independent)
 *   ~1     structure at the scale of a few pixels
 *   ~4     a smooth ramp (adjacent blocks are 4 pixels apart, so the
 *          difference grows by exactly the stride)
 *
 * The first test measures those three anchors instead of asserting them.
 */
function survival(
  v: Float64Array,
  w: number,
  h: number,
  mask: Uint8Array,
  weight: Uint8Array | null = null,
): number {
  const fine = roughness(v, w, h, mask);
  if (fine <= 0) return 0;
  const d = boxDown(v, w, h, SS, weight);
  const cover = boxDown(Float64Array.from(mask), w, h, SS, null);
  const coarse = new Uint8Array(d.w * d.h);
  for (let i = 0; i < coarse.length; i++) {
    // Majority of the block masked, and something actually contributed to
    // the average (the two differ only for a weighted field).
    coarse[i] = cover.v[i] >= 0.5 && d.n[i] > 0 ? 1 : 0;
  }
  return roughness(d.v, d.w, d.h, coarse) / fine;
}

/** Isolated hits + isolated holes, as a percentage of the object region —
 * salt and pepper, counted directly and with no shading in it at all. */
function maskSpeckle(
  hit: Uint8Array,
  w: number,
  h: number,
  region: Uint8Array,
): number {
  let iso = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!region[i]) continue;
      n++;
      const nb =
        (hit[i - 1] ? 1 : 0) +
        (hit[i + 1] ? 1 : 0) +
        (hit[i - w] ? 1 : 0) +
        (hit[i + w] ? 1 : 0);
      if (hit[i] && nb === 0) iso++;
      if (!hit[i] && nb === 4) iso++;
    }
  }
  return n > 0 ? (100 * iso) / n : 0;
}

/** Impulse rate: pixels differing from their four neighbours' median by more
 * than `thr`. The classic salt-and-pepper detector, applied to luminance so
 * it counts what the eye calls a speck. */
function impulsePct(
  v: Float64Array,
  w: number,
  h: number,
  region: Uint8Array,
  thr: number,
): number {
  let bad = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!region[i]) continue;
      n++;
      const a = [v[i - 1], v[i + 1], v[i - w], v[i + w]].sort((p, q) => p - q);
      if (Math.abs(v[i] - (a[1] + a[2]) / 2) > thr) bad++;
    }
  }
  return n > 0 ? (100 * bad) / n : 0;
}

/** Every reading one arm produces. */
interface ArmStats {
  hitPct: number;
  exhaustedPct: number;
  stepsPerRay: number;
  speckle: number;
  impulse: number;
  rough: number;
  surv: number;
  ms: number;
}

/** Score a rendered panel at its own resolution. */
function scorePanel(panel: PanelStats): ArmStats {
  const w = panel.width;
  const h = panel.height;
  const status = panel.status!;
  const hit = new Uint8Array(w * h);
  for (let i = 0; i < hit.length; i++)
    hit[i] = status[i] === PREVIEW_HIT ? 1 : 0;
  const region = dilate(hit, w, h, 2);
  const lum = luminance(panel);
  const steps = panel.stepCount!;
  let hitSteps = 0;
  for (let i = 0; i < hit.length; i++) if (hit[i]) hitSteps += steps[i];
  return {
    hitPct: (100 * panel.hits) / (w * h),
    exhaustedPct: (100 * panel.exhausted) / (w * h),
    stepsPerRay: panel.hits > 0 ? hitSteps / panel.hits : 0,
    speckle: maskSpeckle(hit, w, h, region),
    impulse: impulsePct(lum, w, h, region, IMPULSE_THRESHOLD),
    rough: roughness(lum, w, h, region),
    surv: survival(lum, w, h, region),
    ms: panel.ms,
  };
}

/** Box-downsample a supersampled panel to the base grid, and score THAT —
 * the picture a 16x-sampled render would actually show. */
function scoreSuper(panel: PanelStats): ArmStats & {
  down: PanelStats;
  partialPct: number;
} {
  const w = panel.width;
  const h = panel.height;
  const status = panel.status!;
  const hit = new Uint8Array(w * h);
  const hitF = new Float64Array(w * h);
  for (let i = 0; i < hit.length; i++) {
    hit[i] = status[i] === PREVIEW_HIT ? 1 : 0;
    hitF[i] = hit[i];
  }
  const cover = boxDown(hitF, w, h, SS, null);
  const dw = cover.w;
  const dh = cover.h;
  // The downsampled image, one channel at a time.
  const rgb = new Uint8Array(dw * dh * 3);
  for (let c = 0; c < 3; c++) {
    const ch = new Float64Array(w * h);
    for (let i = 0; i < ch.length; i++) ch[i] = panel.rgb[i * 3 + c];
    const d = boxDown(ch, w, h, SS, null);
    for (let i = 0; i < dw * dh; i++) rgb[i * 3 + c] = Math.round(d.v[i]);
  }
  const down: PanelStats = {
    rgb,
    width: dw,
    height: dh,
    hits: panel.hits / (SS * SS),
    evals: panel.evals,
    steps: panel.steps,
    exhausted: panel.exhausted / (SS * SS),
    ms: panel.ms,
  };
  // A pixel is "hit" after downsampling when the object covers most of it.
  const dHit = new Uint8Array(dw * dh);
  for (let i = 0; i < dHit.length; i++) dHit[i] = cover.v[i] >= 0.5 ? 1 : 0;
  const region = dilate(dHit, dw, dh, 2);
  const lum = luminance(down);
  let partial = 0;
  let regionN = 0;
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue;
    regionN++;
    if (cover.v[i] > PARTIAL_LO && cover.v[i] < PARTIAL_HI) partial++;
  }
  const steps = panel.stepCount!;
  let hitSteps = 0;
  for (let i = 0; i < hit.length; i++) if (hit[i]) hitSteps += steps[i];
  return {
    hitPct: (100 * panel.hits) / (w * h),
    exhaustedPct: (100 * panel.exhausted) / (w * h),
    stepsPerRay: panel.hits > 0 ? hitSteps / panel.hits : 0,
    speckle: maskSpeckle(dHit, dw, dh, region),
    impulse: impulsePct(lum, dw, dh, region, IMPULSE_THRESHOLD),
    rough: roughness(lum, dw, dh, region),
    surv: survival(lum, dw, dh, region),
    ms: panel.ms,
    down,
    partialPct: regionN > 0 ? (100 * partial) / regionN : 0,
  };
}

// ------------------------------------------------- the colour coordinate

/**
 * The app's escape-render palette coordinate, mirrored from the
 * `SURFACE_ESCAPE` GLSL hit-info overload / the WGSL `core:"escape"`
 * `surfaceDEHitInfo` term for term (fr-7u8t.8's continuous escape count,
 * counted in fr-s04t's single-link steps).
 *
 * Returns the shipped continuous coordinate AND the raw integer count it
 * replaced, normalized identically, so the last test can measure what that
 * change actually bought on a CHAIN.
 */
function escapeTrap(
  de: EscapeDE,
  p: Vec3,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): { trap: number; raw: number } {
  const folded: Vec3 = [0, 0, 0];
  const q =
    de.symmetryOrder > 1
      ? foldQueryIntoSector(p, de.symmetryOrder, de.symmetryPlane, folded)
      : p;
  const R = de.boundingRadius;
  const links = de.links;
  const n = links.length;
  const steps = maxIterations * n;
  let vx = q[0];
  let vy = q[1];
  let vz = q[2];
  let r = Math.hypot(vx, vy, vz);
  let escapedAt = steps;
  let growth = links[0].derivGrowth;
  let li = 0;
  for (let i = 0; i < steps; i++) {
    if (r > R) {
      escapedAt = i;
      break;
    }
    const link = links[li];
    const m = link.m;
    let yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
    let yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
    let yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
    if (link.kind !== SURFACE_FOLD_SPHEREFOLD) {
      yx = 2 * Math.max(-1, Math.min(1, yx)) - yx;
      yy = 2 * Math.max(-1, Math.min(1, yy)) - yy;
      yz = 2 * Math.max(-1, Math.min(1, yz)) - yz;
    }
    if (link.kind !== SURFACE_FOLD_BOXFOLD) {
      const f = 1 / Math.max(0.25, Math.min(1, yx * yx + yy * yy + yz * yz));
      yx *= f;
      yy *= f;
      yz *= f;
    }
    vx = link.w * yx + q[0];
    vy = link.w * yy + q[1];
    vz = link.w * yz + q[2];
    r = Math.hypot(vx, vy, vz);
    growth = link.derivGrowth;
    li++;
    if (li === n) li = 0;
  }
  let escFrac = 0;
  if (escapedAt < steps && growth > 1) {
    escFrac = Math.max(0, Math.min(1, Math.log(r / R) / Math.log(growth)));
  }
  // fr-byxb: normalized by the PASS budget, not the single-link step budget
  // — the shipped mirrors' denominator (surface-material.ts carries why).
  return {
    trap: Math.max(0, Math.min(1, (escapedAt - escFrac) / maxIterations)),
    raw: Math.max(0, Math.min(1, escapedAt / maxIterations)),
  };
}

/** Coherence of a [0,1] field sampled only where `hit` is set. */
interface Coherence {
  meanAdj: number;
  p90Adj: number;
  confetti: number;
  bandJump: number;
  surv: number;
  /** Where the field actually lives: a coordinate compressed into a sliver
   * of [0,1] paints one flat colour however coherent it is. */
  p05: number;
  p50: number;
  p95: number;
}

function coherence(
  v: Float64Array,
  hit: Uint8Array,
  w: number,
  h: number,
  /** One escape count in normalized units — a neighbour pair further apart
   * than this lands in a different colour BAND, which is the palette's own
   * question rather than an absolute-threshold one. */
  quantum: number,
): Coherence {
  const diffs: number[] = [];
  const vals: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!hit[i]) continue;
      vals.push(v[i]);
      if (x + 1 < w && hit[i + 1]) diffs.push(Math.abs(v[i + 1] - v[i]));
      if (y + 1 < h && hit[i + w]) diffs.push(Math.abs(v[i + w] - v[i]));
    }
  }
  if (diffs.length === 0) {
    return {
      meanAdj: 0,
      p90Adj: 0,
      confetti: 0,
      bandJump: 0,
      surv: 0,
      p05: 0,
      p50: 0,
      p95: 0,
    };
  }
  diffs.sort((a, b) => a - b);
  vals.sort((a, b) => a - b);
  const at = (q: number, xs: number[]) => xs[Math.floor(q * (xs.length - 1))];
  return {
    meanAdj: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    p90Adj: at(0.9, diffs),
    confetti:
      (100 * diffs.filter((d) => d > CONFETTI_THRESHOLD).length) / diffs.length,
    bandJump:
      (100 * diffs.filter((d) => d > 1.5 * quantum).length) / diffs.length,
    surv: survival(v, w, h, hit, hit),
    p05: at(0.05, vals),
    p50: at(0.5, vals),
    p95: at(0.95, vals),
  };
}

/** A grayscale dump of a [0,1] field over its hit pixels — a diagnostic, not
 * a colour renderer: the coordinate IS the grey level, so a band in the
 * picture is a band a palette would paint and a fizz is confetti. */
function grayPanel(
  v: Float64Array,
  hit: Uint8Array,
  w: number,
  h: number,
): PanelStats {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const g = hit[i] ? Math.round(255 * Math.max(0, Math.min(1, v[i]))) : 18;
    rgb[i * 3] = g;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = g;
  }
  return {
    rgb,
    width: w,
    height: h,
    hits: 0,
    evals: 0,
    steps: 0,
    exhausted: 0,
    ms: 0,
  };
}

const pct = (x: number) => `${x.toFixed(2)}%`;

// ------------------------------------------------------------------ tests

describe("is the escape-chain speckle undersampling or the object? (fr-za0n)", () => {
  it("calibrates the 4x4-downsample survival statistic on synthetic fields", () => {
    // Anchors for every ratio printed below, measured rather than asserted
    // from theory: what does S read for pure noise, for structure at the
    // scale of a few pixels, and for a smooth ramp?
    const n = SIZE;
    const all = new Uint8Array(n * n).fill(1);
    const rng = mulberry32(0x5bec_c1e0);
    const noise = new Float64Array(n * n);
    const smooth = new Float64Array(n * n);
    const blocks = new Float64Array(n * n);
    const mixed = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        noise[i] = 255 * rng();
        smooth[i] = 128 + 100 * Math.sin((3 * Math.PI * x) / n);
        blocks[i] = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 220 : 40;
        mixed[i] = 0.5 * blocks[i] + 0.5 * noise[i];
      }
    }
    const rows: [string, Float64Array][] = [
      ["white noise (pure per-pixel)", noise],
      ["12px checker (multi-pixel structure)", blocks],
      ["half checker + half noise", mixed],
      ["smooth ramp", smooth],
    ];
    for (const [label, field] of rows) {
      console.log(
        `  ${label.padEnd(38)} D1 ${roughness(field, n, n, all).toFixed(1)}  ` +
          `S ${survival(field, n, n, all).toFixed(2)}  ` +
          `impulse ${pct(impulsePct(field, n, n, all, IMPULSE_THRESHOLD))}`,
      );
    }
    // The statistic only means anything if its two ends separate.
    expect(survival(noise, n, n, all)).toBeLessThan(0.4);
    expect(survival(smooth, n, n, all)).toBeGreaterThan(2);
    expect(survival(blocks, n, n, all)).toBeGreaterThan(
      survival(noise, n, n, all) * 2,
    );
  });

  it("splits the speckle: march budget vs shading proxy vs sub-pixel structure", () => {
    const panels: PanelStats[] = [];
    const partials = new Map<string, number>();
    const rows: [string, DistanceEstimator, number][] = [
      ...FIXTURES.map(
        ([label, transforms]): [string, DistanceEstimator, number] => {
          const de = buildEscapeDE(transforms);
          const est: DistanceEstimator = (p) => estimateEscapeDistance(de, p);
          return [label, est, fitMarchRadius(est)];
        },
      ),
      [SPHERE_LABEL, SPHERE, SPHERE_R],
    ];

    for (const [label, de, marchR] of rows) {
      const base = { de, boundingRadius: marchR, eyeOffset: EYE, zoom: ZOOM };
      const a = renderPreview(
        { ...base, stepScale: ESCAPE_STEP_SCALE, collect: true },
        SIZE,
      );
      const b = renderPreview(
        {
          ...base,
          stepScale: GENEROUS_SCALE,
          maxSteps: GENEROUS_STEPS,
          collect: true,
        },
        SIZE,
      );
      const c = renderPreview(
        {
          ...base,
          stepScale: GENEROUS_SCALE,
          maxSteps: GENEROUS_STEPS,
          ao: false,
          shadow: false,
          collect: true,
        },
        SIZE,
      );
      const d = renderPreview(
        {
          ...base,
          stepScale: GENEROUS_SCALE,
          maxSteps: GENEROUS_STEPS,
          ao: false,
          shadow: false,
          collect: true,
        },
        SIZE * SS,
      );
      const sa = scorePanel(a);
      const sb = scorePanel(b);
      const sc = scorePanel(c);
      const sd = scoreSuper(d);

      console.log(`  ${label}   (marchR ${marchR.toFixed(2)})`);
      const line = (arm: string, s: ArmStats) =>
        console.log(
          `      ${arm.padEnd(22)} hits ${s.hitPct.toFixed(1).padStart(5)}%  ` +
            `exhausted ${pct(s.exhaustedPct).padStart(7)}  ` +
            `steps/hit ${s.stepsPerRay.toFixed(0).padStart(5)}  ` +
            `maskSpeckle ${pct(s.speckle).padStart(7)}  ` +
            `impulse ${pct(s.impulse).padStart(7)}  ` +
            `D1 ${s.rough.toFixed(1).padStart(5)}  S ${s.surv.toFixed(2)}  ` +
            `${(s.ms / 1000).toFixed(1)}s`,
        );
      line("A shipped 600/0.35", sa);
      line("B generous march", sb);
      line("C + proxies off", sc);
      line("D 4x supersampled", sd);
      // GEOMETRY, with no shading in it at all. B and C march identically,
      // so the mask term splits cleanly in three.
      const share = (x: number) =>
        sa.speckle > 0 ? `${((100 * x) / sa.speckle).toFixed(0)}%` : "n/a";
      console.log(
        `      GEOMETRY  isolated-pixel speckle ${pct(sa.speckle)} -> ` +
          `${pct(sb.speckle)} damped -> ${pct(sd.speckle)} at 16 samples/px:  ` +
          `march-fixable ${share(sa.speckle - sb.speckle)}  ` +
          `supersample-fixable ${share(sb.speckle - sd.speckle)}  ` +
          `irreducible ${share(sd.speckle)}`,
      );
      // APPEARANCE. A -> C RISES: marching harder and dropping the shadow's
      // flattening REVEAL more structure, they do not cure noise. Only the
      // sampling rate cures anything, which is the whole finding.
      console.log(
        `      APPEARANCE impulse A ${pct(sa.impulse)} -> B ${pct(sb.impulse)} -> ` +
          `C ${pct(sc.impulse)} -> D ${pct(sd.impulse)}:  ` +
          `16 samples/px removes ${(100 * (1 - sd.impulse / sc.impulse)).toFixed(0)}% of C, ` +
          `roughness ${sc.rough.toFixed(1)} -> ${sd.rough.toFixed(1)}, ` +
          `survival ${sc.surv.toFixed(2)} -> ${sd.surv.toFixed(2)}`,
      );
      // The one number that needs no inference: a pixel the object only
      // partly fills is a pixel no march budget can resolve.
      const lumC = luminance(c);
      const lumD = luminance(sd.down);
      let diff = 0;
      let moved = 0;
      for (let i = 0; i < lumC.length; i++) {
        const e = Math.abs(lumC[i] - lumD[i]);
        diff += e;
        if (e > IMPULSE_THRESHOLD) moved++;
      }
      console.log(
        `      SUB-PIXEL  partial-coverage pixels ${pct(sd.partialPct)}  |  ` +
          `1x vs 16x image: mean |dL| ${(diff / lumC.length).toFixed(1)}/255, ` +
          `${pct((100 * moved) / lumC.length)} of pixels move by >${IMPULSE_THRESHOLD}`,
      );
      panels.push(a, b, c, sd.down);
      partials.set(label, sd.partialPct);
      expect(a.hits, `${label}: arm A rendered nothing`).toBeGreaterThan(
        0.005 * SIZE * SIZE,
      );
      expect(sd.down.width).toBe(SIZE);
      // (A) IS NOT THE STORY, and this is the pin: not one ray in any arm of
      // any row spends its budget, so nothing here is starved. The app
      // reports the same `exhausted 0` on escape renders.
      expect(a.exhausted, `${label}: arm A starved a ray`).toBe(0);
      expect(d.exhausted, `${label}: arm D starved a ray`).toBe(0);
    }
    console.log(`  wrote ${writeContactSheet(panels, 4, "chain-speckle.png")}`);

    // The instrument's own floor: a smooth solid through this marcher and
    // this shading measures essentially nothing, so every fold reading above
    // is the OBJECT rather than the harness.
    const sphere = partials.get(SPHERE_LABEL)!;
    expect(sphere).toBeLessThan(2);
    for (const [label, partial] of partials) {
      if (label === SPHERE_LABEL) continue;
      expect(partial, `${label} resolves like a smooth solid`).toBeGreaterThan(
        4 * sphere,
      );
    }
  });

  it("sweeps the march budget, so (A) is bounded by measurement", () => {
    // If the speckle were starvation, these columns would fall as the budget
    // rises and the steps shrink. `exhausted` is the direct fingerprint.
    const panels: PanelStats[] = [];
    for (const [label, transforms] of FIXTURES) {
      const de = buildEscapeDE(transforms);
      const est: DistanceEstimator = (p) => estimateEscapeDistance(de, p);
      const marchR = fitMarchRadius(est);
      const arms: [number, number][] = [
        [DEFAULT_MAX_STEPS, 0.7],
        [DEFAULT_MAX_STEPS, ESCAPE_STEP_SCALE],
        [1200, 0.2],
        [4000, 0.12],
        [12_000, 0.05],
      ];
      console.log(`  ${label}`);
      for (const [maxSteps, stepScale] of arms) {
        const panel = renderPreview(
          {
            de: est,
            boundingRadius: marchR,
            stepScale,
            maxSteps,
            eyeOffset: EYE,
            zoom: ZOOM,
            collect: true,
          },
          SIZE,
        );
        const s = scorePanel(panel);
        console.log(
          `      ${String(maxSteps).padStart(6)} steps / scale ${String(stepScale).padEnd(5)}  ` +
            `hits ${s.hitPct.toFixed(1).padStart(5)}%  ` +
            `exhausted ${pct(s.exhaustedPct).padStart(7)}  ` +
            `steps/hit ${s.stepsPerRay.toFixed(0).padStart(5)}  ` +
            `maskSpeckle ${pct(s.speckle).padStart(7)}  ` +
            `impulse ${pct(s.impulse).padStart(7)}  S ${s.surv.toFixed(2)}  ` +
            `${(panel.ms / 1000).toFixed(1)}s`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 5, "chain-speckle-budget.png")}`,
    );
  });

  it("measures the escape-count colour coordinate's spatial coherence", () => {
    // Would a palette paint bands, or confetti? Three fields over the SAME
    // hit pixels: the shipped continuous count, the raw integer count it
    // replaced (fr-7u8t.8), and the hit DEPTH — the smoothest quantity this
    // surface can carry, so it is the ceiling any colour source could reach.
    const panels: PanelStats[] = [];
    for (const [label, transforms] of FIXTURES) {
      const de = buildEscapeDE(transforms);
      const est: DistanceEstimator = (p) => estimateEscapeDistance(de, p);
      const marchR = fitMarchRadius(est);
      const eye: Vec3 = [EYE[0] * marchR, EYE[1] * marchR, EYE[2] * marchR];

      const sample = (size: number) => {
        const panel = renderPreview(
          {
            de: est,
            boundingRadius: marchR,
            stepScale: GENEROUS_SCALE,
            maxSteps: GENEROUS_STEPS,
            eyeOffset: EYE,
            zoom: ZOOM,
            ao: false,
            shadow: false,
            collect: true,
          },
          size,
        );
        const hit = new Uint8Array(size * size);
        const trap = new Float64Array(size * size);
        const raw = new Float64Array(size * size);
        const depth = new Float64Array(size * size);
        let dMin = Infinity;
        let dMax = -Infinity;
        for (let i = 0; i < hit.length; i++) {
          if (panel.status![i] !== PREVIEW_HIT) continue;
          hit[i] = 1;
          const p: Vec3 = [
            panel.hitPos![i * 3],
            panel.hitPos![i * 3 + 1],
            panel.hitPos![i * 3 + 2],
          ];
          const t = escapeTrap(de, p);
          trap[i] = t.trap;
          raw[i] = t.raw;
          depth[i] = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
          dMin = Math.min(dMin, depth[i]);
          dMax = Math.max(dMax, depth[i]);
        }
        const span = dMax > dMin ? dMax - dMin : 1;
        for (let i = 0; i < hit.length; i++) {
          if (hit[i]) depth[i] = (depth[i] - dMin) / span;
        }
        return { panel, hit, trap, raw, depth, size };
      };

      const one = sample(SIZE);
      const four = sample(SIZE * SS);
      // The 4x fields, box-averaged over each pixel's own hit samples: the
      // coordinate a 16x-sampled render would actually paint.
      const cover = boxDown(
        Float64Array.from(four.hit),
        four.size,
        four.size,
        SS,
        null,
      );
      const dTrap = boxDown(four.trap, four.size, four.size, SS, four.hit);
      const dHit = new Uint8Array(cover.v.length);
      for (let i = 0; i < dHit.length; i++) dHit[i] = cover.v[i] >= 0.5 ? 1 : 0;

      // One escape count, normalized: the app divides by maxDepth * n
      // single-link steps (fr-s04t), so a chain's whole coordinate is
      // finer-grained AND lives lower in [0, 1].
      const quantum = 1 / (ESCAPE_TIME_ITERATIONS * de.links.length);
      const cTrap = coherence(one.trap, one.hit, SIZE, SIZE, quantum);
      const cRaw = coherence(one.raw, one.hit, SIZE, SIZE, quantum);
      const cDepth = coherence(one.depth, one.hit, SIZE, SIZE, quantum);
      const cSuper = coherence(dTrap.v, dHit, dTrap.w, dTrap.h, quantum);

      console.log(
        `  ${label}   (one count = ${quantum.toFixed(4)} of the ramp)`,
      );
      const line = (what: string, c: Coherence) =>
        console.log(
          `      ${what.padEnd(34)} mean|d| ${c.meanAdj.toFixed(4)}  ` +
            `p90 ${c.p90Adj.toFixed(4)}  ` +
            `confetti(>${CONFETTI_THRESHOLD}) ${pct(c.confetti).padStart(7)}  ` +
            `band-jump ${pct(c.bandJump).padStart(7)}  ` +
            `S ${c.surv.toFixed(2)}  ` +
            `ramp used [${c.p05.toFixed(3)} ${c.p50.toFixed(3)} ${c.p95.toFixed(3)}]`,
        );
      line("continuous escape count (ships)", cTrap);
      line("raw integer count (pre-fr-7u8t.8)", cRaw);
      line("hit depth (smoothest possible)", cDepth);
      line("continuous count, 4x supersampled", cSuper);

      panels.push(
        grayPanel(one.trap, one.hit, SIZE, SIZE),
        grayPanel(one.raw, one.hit, SIZE, SIZE),
        grayPanel(dTrap.v, dHit, dTrap.w, dTrap.h),
      );
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "chain-speckle-trap.png")}`,
    );
  });

  it("asks whether MORE PIXELS help, or the object keeps yielding structure", () => {
    // The one thing left between "the app cannot fix this" and "look at it
    // bigger": this harness frames the whole object in ~250px, where the app
    // gives it ~700 of a 1280-wide pane. So how does the partial-coverage
    // fraction SCALE with the pixel grid?
    //
    // A smooth solid's partial pixels are its silhouette, a curve, so they
    // fall as 1/N — exponent -1, which the sphere row measures rather than
    // assumes. A set whose boundary is fractal in the image plane falls as
    // N^(D-2) for box dimension D, i.e. much slower, and an exponent near 0
    // would mean the noise is scale-invariant and no viewport fixes it.
    //
    // Every size is measured at 16 samples per pixel (rendered at 4N), so
    // the coverage estimator is identical across the row and only the pixel
    // size changes.
    const SIZES = [128, 256, 512];
    const rows: [string, DistanceEstimator, number][] = [
      ...[FIXTURES[0], FIXTURES[2]].map(
        ([label, transforms]): [string, DistanceEstimator, number] => {
          const de = buildEscapeDE(transforms);
          const est: DistanceEstimator = (p) => estimateEscapeDistance(de, p);
          return [label, est, fitMarchRadius(est)];
        },
      ),
      [SPHERE_LABEL, SPHERE, SPHERE_R],
    ];
    for (const [label, de, marchR] of rows) {
      console.log(`  ${label}`);
      const logN: number[] = [];
      const logP: number[] = [];
      for (const size of SIZES) {
        const panel = renderPreview(
          {
            de,
            boundingRadius: marchR,
            stepScale: GENEROUS_SCALE,
            maxSteps: GENEROUS_STEPS,
            eyeOffset: EYE,
            zoom: ZOOM,
            ao: false,
            shadow: false,
            collect: true,
          },
          size * SS,
        );
        const s = scoreSuper(panel);
        logN.push(Math.log(size));
        logP.push(Math.log(Math.max(1e-6, s.partialPct)));
        console.log(
          `      ${String(size).padStart(4)}px  ` +
            `partial-coverage ${pct(s.partialPct).padStart(7)}  ` +
            `impulse ${pct(s.impulse).padStart(7)}  ` +
            `D1 ${s.rough.toFixed(1).padStart(5)}  S ${s.surv.toFixed(2)}  ` +
            `${(panel.ms / 1000).toFixed(1)}s`,
        );
      }
      // Least-squares slope of log(partial) against log(N).
      const mN = logN.reduce((a, b) => a + b, 0) / logN.length;
      const mP = logP.reduce((a, b) => a + b, 0) / logP.length;
      let num = 0;
      let den = 0;
      for (let i = 0; i < logN.length; i++) {
        num += (logN[i] - mN) * (logP[i] - mP);
        den += (logN[i] - mN) ** 2;
      }
      const slope = den > 0 ? num / den : 0;
      console.log(
        `      scaling exponent ${slope.toFixed(2)}  ` +
          `(-1 = a smooth silhouette, 0 = scale-invariant noise);  ` +
          `4x the pixels buys ${(100 * (1 - Math.pow(4, slope))).toFixed(0)}% ` +
          `fewer partial pixels`,
      );
      // The sphere has to measure the perimeter law, or the instrument is
      // not measuring what this test claims.
      if (label === SPHERE_LABEL) expect(slope).toBeLessThan(-0.8);
    }
  });
});
