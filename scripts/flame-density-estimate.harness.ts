// @vitest-environment jsdom
/**
 * The flame density-estimate clipping sheet — the measurement behind
 * `flame.ts`'s occupied-footprint gather clip in `adaptiveDownsampleFlame`.
 *
 * WHAT IT MEASURES, per real Electric Sheep genome (decoded through
 * `decodeFlameFile` -> the app's own scene decode -> `prepareChaosGame` ->
 * `accumulateFlame` at the app-realistic raster), for BOTH the genome's
 * imported estimator params and the app defaults:
 *   1. the radius-class histogram (how many output cells ask each quantized
 *      kernel radius) — the shape that makes the unclipped gather quadratic;
 *   2. PREDICTED taps (the full in-bounds kernel rectangle, the pre-change
 *      cost), the clipped job's own charged work (the occupied-box area the
 *      gather is budgeted against), and PAID taps (the occupied source cells
 *      the bitmap actually visits, counted independently through a 2D
 *      prefix over the occupancy bitmap) — plus plan / gather / total pass
 *      times;
 *   3. OUTPUT AGREEMENT against a frozen copy of the pre-change
 *      implementation (`preChangeAdaptiveDownsample` below): exact bucket
 *      equality, max Float64 deltas, and byte equality of the tone-mapped
 *      image.
 * Plus one dense synthetic frame, where every kernel is fully occupied, so
 * the sheet also answers "did the dense/default path regress?".
 *
 * THE PRE-CHANGE IMPLEMENTATION is a verbatim transcription of `flame.ts`'s
 * plan + gather as they stood before the clip (its constants, kernel
 * construction, occupancy table, per-cell radius mapping and flat gather,
 * one-shot instead of banded — the two are pinned byte-identical by
 * `flame-estimate-progress.harness.ts`). It is kept executable rather than
 * summarized, `escape-chain.harness.ts`'s convention for a superseded arm:
 * the agreement numbers below are a real comparison, not a claim about
 * history.
 *
 * PROVISIONING: the corpus is the Electric Sheep flam3 dump the banding
 * pass's cost probe measured; the sheet SKIPS with a note when it is absent (the
 * differential sheet's convention). Overrides:
 *   FLAME_ESTIMATE_CORPUS   default /home/christians/src/electric_sheep_genomes
 *   FLAME_ESTIMATE_OUT      WxH output size, default 960x540 (the measured
 *                           app-window class)
 *   FLAME_ESTIMATE_SS       supersample, default 3 (the app's imported clamp)
 *   FLAME_ESTIMATE_ITER     accumulation iterations, default 20,000,000
 *   FLAME_ESTIMATE_OUT_DIR  report directory, default scripts/out
 *   FLAME_ESTIMATE_PRE      "0" skips the frozen pre-change arm and reports
 *                           the residual pass alone (default "1" runs the
 *                           exactness comparison). The app-realistic full run
 *                           takes minutes per genome in the pre-change arm;
 *                           residual-only exists so the post-clip question
 *                           ("what does the pass cost now?") is cheap to
 *                           re-measure.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/flame-density-estimate.harness.ts
 *
 * MEASURED VERDICT (2026-09-13, Node 22.23.2, i7-1165G7, 960x540 output,
 * supersample 3, 20M iterations, the four genomes under the corpus path; the
 * "defaults" legs use the app's REAL default 6/0.4/0 — an earlier revision
 * of this sheet ran 6/0.4/2, which is not `state.ts`'s default, and those
 * numbers are superseded): the clip is exact and decisive. Every row is
 * bucket-for-bucket and byte-for-byte identical to the pre-change pass
 * (0 hits/sumRGB/maxHits/hitMass deltas, 0 tone-byte differences). Pass
 * times, pre-change -> clipped (imported | defaults): 11.7s -> 0.22s |
 * 1.80s -> 0.12s (242); 44.3s -> 10.0s | 13.0s -> 3.6s (243); 65.7s ->
 * 3.65s | 15.4s -> 1.21s (244); 68.9s -> 8.4s | 21.3s -> 3.3s (247) — 4.4x
 * to 53x imported, 3.6x to 15x defaults. PAID taps fall to 0.10-14.4% of the
 * full rectangle (242: 0.10%/0.20%; 243: 12.5%/14.4%; 244: 2.0%/2.4%; 247:
 * 6.3%/8.0%). Plan cost is 83-250ms against gathers of 37ms-9.8s. The dense
 * 2880x1620 fully-occupied control — every word on the fast path, no clip
 * anywhere — costs 505ms against the pre-change 426ms (+18.5%: 174ms plan +
 * 332ms gather) with identical output; under the corrected default its
 * kernels are narrower, so the plan scan reads as a larger share than the
 * ~4% the earlier min-2 revision measured.
 *
 * THE DECISION MEASUREMENT (app-realistic): FLAME_ESTIMATE_OUT=1920x950
 * (viewport x min(DPR, 2) = 1 on the dev machine's 1080p panel),
 * supersample 3, 20M iterations, all four genomes, FLAME_ESTIMATE_PRE=0 so
 * the pre-change arm — minutes per genome at this raster — is skipped;
 * exactness at this size is pinned by the one-genome prior run (244:
 * 185.5s -> 7.4s at the imported params, exact) and the 960x540 full run
 * above. Imported params, seconds:
 *   genome   accumulate   pass   plan   progressive tick
 *   242        5.68        0.55   0.34       1.20
 *   243       20.32       35.11   0.62       1.14
 *   244        5.98        6.36   0.41       0.73
 *   247        3.79       25.67   0.57       0.79
 * (progressive tick = `downsampleFlame` at the app's FLAME_FILTER_RADIUS,
 * the redisplay the user already watches). At the app defaults the same
 * rows are 0.36s / 12.13s / 2.14s / 9.09s. The post-clip pass is STILL the
 * longest phase on 243 and 247 (1.7x and 6.8x their accumulations; 31x and
 * 32x the progressive tick) and 3x over the bar on 244.
 *
 * VERDICT: the residual pass moves to the GPU compute gather at the
 * FlameAccumBackend seam. Interactive bar stated by the decision: <= ~2s at
 * this window, i.e. twice the measured progressive tick; the worst rows miss
 * it by 13-18x, so CPU-only refusal is refused. A worker pool was rejected
 * too: it caps at this machine's 4 physical / 8 logical cores (~4.4-8.8s on
 * the worst row, still over the bar) and would need the 525MB full-resolution
 * histogram shared through SAB. Shape, oracles and gates live in the
 * implementation brief; the narrative is in docs/architecture.md's flame
 * section.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WARMUP_ITERATIONS,
  plotPoint,
  prepareChaosGame,
  stepOrbit,
} from "../src/fractal/chaos-game";
import type { PreparedChaosGame } from "../src/fractal/chaos-game";
import { transformColors } from "../src/fractal/color";
import {
  DEFAULT_GAMMA_THRESHOLD,
  accumulateFlame,
  createAdaptiveDownsampleJob,
  createFlameHistogram,
  downsampleFlame,
  tonemapFlame,
} from "../src/fractal/flame";
import type {
  DensityEstimatorParams,
  FlameHistogram,
  Mat4,
} from "../src/fractal/flame";
import { mulberry32 } from "../src/fractal/rng";
import { decodeFlameFile } from "../src/app/flame-file";
import { FLAME_FILTER_RADIUS } from "../src/app/flame-worker-core";
import { decodeScene } from "../src/app/persist";

const envStr = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : fallback;
};

const CORPUS_DIR = envStr(
  "FLAME_ESTIMATE_CORPUS",
  "/home/christians/src/electric_sheep_genomes",
);
const OUT_DIR = envStr(
  "FLAME_ESTIMATE_OUT_DIR",
  join(dirname(fileURLToPath(import.meta.url)), "out"),
);
const [OUT_W, OUT_H] = (() => {
  const [w, h] = envStr("FLAME_ESTIMATE_OUT", "960x540")
    .split("x")
    .map((part) => Number.parseInt(part, 10));
  return [w > 0 ? w : 960, h > 0 ? h : 540];
})();
const SUPERSAMPLE = (() => {
  const parsed = Number.parseInt(envStr("FLAME_ESTIMATE_SS", "3"), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 3;
})();
const ITERATIONS = (() => {
  const parsed = Number.parseInt(envStr("FLAME_ESTIMATE_ITER", "20000000"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20_000_000;
})();
/**
 * Run the frozen pre-change arm (the exactness comparison) — default on. Set
 * `FLAME_ESTIMATE_PRE=0` for a residual-only measurement: the pre-change
 * pass is O(full rectangle) and its app-realistic-size cost is minutes per
 * genome, while the post-clip question ("what does the pass cost now, against
 * accumulation?") needs none of it. Exactness is still gated by the default
 * run at any size; residual-only rows report the comparison fields as null.
 */
const PRE = envStr("FLAME_ESTIMATE_PRE", "1") !== "0";

const PROBE_POINTS = 4096;
const PROBE_TRIM = 0.02;
const PROBE_SEED = 0x5eed;
const FRAME_FILL = 0.8;
const DENSE_SEED = 2654435761;

/** The app's own defaults (`state.ts`'s `DEFAULT_ESTIMATOR_*`): 6/0.4/0.
 * The minimum is DELIBERATELY 0, not the 2 an earlier revision of this sheet
 * (and the docs quoting it) said — "pin-sharp at full density" is the
 * shipped default and a lower floor makes cells with many hits cheaper, so
 * the correction moves this leg's numbers down, never up. */
const DEFAULT_PARAMS: DensityEstimatorParams = {
  estimatorRadius: 6,
  estimatorMinimumRadius: 0,
  estimatorCurve: 0.4,
};

/** flame-differential.harness.ts's copy of flame-file.ts's probeFraming
 * recipe (4096 points, 2% trim, ~80% fill), so this sheet frames a genome
 * exactly as the app's auto-fit does. */
function probePlanarProjection(
  prepared: PreparedChaosGame,
  width: number,
  height: number,
): Mat4 {
  const rng = mulberry32(PROBE_SEED);
  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
  }
  const xs = new Float64Array(PROBE_POINTS);
  const ys = new Float64Array(PROBE_POINTS);
  for (let i = 0; i < PROBE_POINTS; i++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
    const p = plotPoint(prepared, x, y, z, rng);
    xs[i] = p[0];
    ys[i] = p[1];
  }
  xs.sort();
  ys.sort();
  const lo = Math.floor(PROBE_POINTS * PROBE_TRIM);
  const hi = Math.min(
    PROBE_POINTS - 1,
    Math.ceil(PROBE_POINTS * (1 - PROBE_TRIM)),
  );
  const spanX = xs[hi] - xs[lo];
  const spanY = ys[hi] - ys[lo];
  const centerX = (xs[lo] + xs[hi]) / 2;
  const centerY = (ys[lo] + ys[hi]) / 2;
  const pixelsPerUnit =
    Number.isFinite(spanX) &&
    spanX > 1e-9 &&
    Number.isFinite(spanY) &&
    spanY > 1e-9
      ? FRAME_FILL * Math.min(width / spanX, height / spanY)
      : 240;
  const sx = (2 * pixelsPerUnit) / width;
  const sy = (2 * pixelsPerUnit) / height;
  return [
    sx,
    0,
    0,
    -sx * centerX,
    0,
    sy,
    0,
    -sy * centerY,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
  ];
}

/** Pull the single `<flame>` element out of a corpus file (the dump wraps
 * each genome in a `<pick>`); the importer is fed one genome per call. */
function firstFlameElement(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const el = doc.getElementsByTagName("flame")[0];
  if (!el) return null;
  return new XMLSerializer().serializeToString(el);
}

function pickFiles(perDir: number): string[] {
  const picked: string[] = [];
  for (const d of readdirSync(CORPUS_DIR)
    .filter((x) => x.startsWith("ES_gen_"))
    .sort()) {
    const files = readdirSync(join(CORPUS_DIR, d))
      .filter((f) => f.endsWith(".flam3"))
      .sort();
    for (let i = 0; i < perDir && i < files.length; i++) {
      picked.push(
        join(CORPUS_DIR, d, files[Math.floor((i * files.length) / perDir)]),
      );
    }
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Pre-change implementation (frozen copy — see the header)
// ---------------------------------------------------------------------------

const PRE_RADIUS_QUANTUM = 0.5;
const PRE_OCCUPANCY_TILE = 16;
const PRE_MIN_ADAPTIVE_FILTER_SIGMA = 0.3;

interface PreKernel {
  kernelX: Float64Array;
  kernelY: Float64Array;
  radiusX: number;
  radiusY: number;
}

/** 2D prefix over the occupancy bitmap (`hits > 0`), so one O(1) query
 * answers "how many occupied source cells does this footprint hold" — the
 * exact number of bits the clipped gather visits, measured independently of
 * the gather itself. Built outside the timed regions. */
function occupiedPrefix(hist: FlameHistogram): {
  sat: Int32Array;
  stride: number;
} {
  const { width, height, hits } = hist;
  const stride = width + 1;
  const sat = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    const rowBase = y * width;
    const cur = (y + 1) * stride;
    const prev = y * stride;
    for (let x = 0; x < width; x++) {
      if (hits[rowBase + x] > 0) row++;
      sat[cur + x + 1] = sat[prev + x + 1] + row;
    }
  }
  return { sat, stride };
}

function preChangeAdaptiveDownsample(
  oversized: FlameHistogram,
  outWidth: number,
  outHeight: number,
  params: DensityEstimatorParams,
  /** Optional instrument: a prefix over the occupancy bitmap. Its per-cell
   * queries add the cell's exact occupied-source-cell count to
   * `occupiedTaps` — the bits the clipped gather visits — without changing
   * any of the pre-change arithmetic. */
  prefix?: { sat: Int32Array; stride: number },
): {
  target: FlameHistogram;
  predictedTaps: number;
  occupiedTaps: number;
  radiusCounts: Map<number, number>;
} {
  const {
    width: srcWidth,
    height: srcHeight,
    hits: srcHits,
    sumRGB: srcRGB,
  } = oversized;
  const scaleX = srcWidth / outWidth;
  const scaleY = srcHeight / outHeight;
  const phaseX = 0.5 * (scaleX - 1);
  const phaseY = 0.5 * (scaleY - 1);
  const estimatorRadius = Math.max(0, params.estimatorRadius);
  const estimatorMinimumRadius = Math.min(
    estimatorRadius,
    Math.max(0, params.estimatorMinimumRadius),
  );

  const kernels: PreKernel[] = [];
  const kernelIndices = new Map<number, number>();
  function kernelIndexFor(radius: number): number {
    const quantized =
      Math.round(radius / PRE_RADIUS_QUANTUM) * PRE_RADIUS_QUANTUM;
    const cached = kernelIndices.get(quantized);
    if (cached !== undefined) return cached;
    const sigmaX = Math.max(quantized, PRE_MIN_ADAPTIVE_FILTER_SIGMA) * scaleX;
    const sigmaY = Math.max(quantized, PRE_MIN_ADAPTIVE_FILTER_SIGMA) * scaleY;
    const radiusX = Math.max(1, Math.ceil(sigmaX * 3));
    const radiusY = Math.max(1, Math.ceil(sigmaY * 3));
    const kernelX = new Float64Array(2 * radiusX + 1);
    for (let k = -radiusX; k <= radiusX; k++) {
      const d = k - phaseX;
      kernelX[k + radiusX] = Math.exp(-(d * d) / (2 * sigmaX * sigmaX));
    }
    const kernelY = new Float64Array(2 * radiusY + 1);
    for (let k = -radiusY; k <= radiusY; k++) {
      const d = k - phaseY;
      kernelY[k + radiusY] = Math.exp(-(d * d) / (2 * sigmaY * sigmaY));
    }
    const index = kernels.length;
    kernels.push({ kernelX, kernelY, radiusX, radiusY });
    kernelIndices.set(quantized, index);
    return index;
  }

  const tilesX = Math.ceil(srcWidth / PRE_OCCUPANCY_TILE);
  const tilesY = Math.ceil(srcHeight / PRE_OCCUPANCY_TILE);
  const satStride = tilesX + 1;
  const occupancy = new Int32Array(satStride * (tilesY + 1));
  for (let sy = 0; sy < srcHeight; sy++) {
    const rowBase = sy * srcWidth;
    const tileRow = (((sy / PRE_OCCUPANCY_TILE) | 0) + 1) * satStride;
    for (let sx = 0; sx < srcWidth; sx++) {
      if (srcHits[rowBase + sx] > 0) {
        occupancy[tileRow + ((sx / PRE_OCCUPANCY_TILE) | 0) + 1] = 1;
      }
    }
  }
  for (let ty = 1; ty <= tilesY; ty++) {
    for (let tx = 1; tx <= tilesX; tx++) {
      const i = ty * satStride + tx;
      occupancy[i] +=
        occupancy[i - 1] +
        occupancy[i - satStride] -
        occupancy[i - satStride - 1];
    }
  }

  const target = createFlameHistogram(outWidth, outHeight);
  const { hits: dstHits, sumRGB: dstRGB } = target;
  const radiusCounts = new Map<number, number>();
  let predictedTaps = 0;
  let occupiedTaps = 0;
  let maxHits = 0;
  let hitMass = 0;
  for (let oy = 0; oy < outHeight; oy++) {
    const baseY = oy * scaleY;
    for (let ox = 0; ox < outWidth; ox++) {
      const baseX = ox * scaleX;
      let localCount = 0;
      for (let j = 0; j < scaleY; j++) {
        const rowBase = (baseY + j) * srcWidth;
        for (let i = 0; i < scaleX; i++) {
          localCount += srcHits[rowBase + baseX + i];
        }
      }
      const radius = Math.min(
        estimatorRadius,
        Math.max(
          estimatorMinimumRadius,
          estimatorRadius / Math.max(1, localCount) ** params.estimatorCurve,
        ),
      );
      const quantized =
        Math.round(radius / PRE_RADIUS_QUANTUM) * PRE_RADIUS_QUANTUM;
      radiusCounts.set(quantized, (radiusCounts.get(quantized) ?? 0) + 1);
      const kernelIndex = kernelIndexFor(radius);
      const { kernelX, kernelY, radiusX, radiusY } = kernels[kernelIndex];
      const cell = oy * outWidth + ox;
      const dOff = cell * 3;

      let emptyFootprint = false;
      if (localCount <= 0) {
        const txLo = (Math.max(0, baseX - radiusX) / PRE_OCCUPANCY_TILE) | 0;
        const tyLo = (Math.max(0, baseY - radiusY) / PRE_OCCUPANCY_TILE) | 0;
        const txHi =
          ((Math.min(srcWidth - 1, baseX + radiusX) / PRE_OCCUPANCY_TILE) | 0) +
          1;
        const tyHi =
          ((Math.min(srcHeight - 1, baseY + radiusY) / PRE_OCCUPANCY_TILE) |
            0) +
          1;
        const occupied =
          occupancy[tyHi * satStride + txHi] -
          occupancy[tyLo * satStride + txHi] -
          occupancy[tyHi * satStride + txLo] +
          occupancy[tyLo * satStride + txLo];
        emptyFootprint = occupied === 0;
      }
      if (emptyFootprint) {
        dstHits[cell] = 0;
        dstRGB[dOff] = 0;
        dstRGB[dOff + 1] = 0;
        dstRGB[dOff + 2] = 0;
        continue;
      }
      const x0 = Math.max(0, baseX - radiusX);
      const x1 = Math.min(srcWidth - 1, baseX + radiusX);
      const y0 = Math.max(0, baseY - radiusY);
      const y1 = Math.min(srcHeight - 1, baseY + radiusY);
      predictedTaps += (x1 - x0 + 1) * (y1 - y0 + 1);
      if (prefix !== undefined) {
        const { sat, stride } = prefix;
        occupiedTaps +=
          sat[(y1 + 1) * stride + x1 + 1] -
          sat[y0 * stride + x1 + 1] -
          sat[(y1 + 1) * stride + x0] +
          sat[y0 * stride + x0];
      }

      let weightSum = 0;
      let hitSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let j = -radiusY; j <= radiusY; j++) {
        const sy = baseY + j;
        if (sy < 0 || sy >= srcHeight) continue;
        const wy = kernelY[j + radiusY];
        const rowBase = sy * srcWidth;
        for (let i = -radiusX; i <= radiusX; i++) {
          const sx = baseX + i;
          if (sx < 0 || sx >= srcWidth) continue;
          const weight = wy * kernelX[i + radiusX];
          const bucket = rowBase + sx;
          weightSum += weight;
          hitSum += weight * srcHits[bucket];
          const so = bucket * 3;
          rSum += weight * srcRGB[so];
          gSum += weight * srcRGB[so + 1];
          bSum += weight * srcRGB[so + 2];
        }
      }
      if (weightSum > 0) {
        const norm = 1 / weightSum;
        const hVal = hitSum * norm;
        dstHits[cell] = hVal;
        dstRGB[dOff] = rSum * norm;
        dstRGB[dOff + 1] = gSum * norm;
        dstRGB[dOff + 2] = bSum * norm;
        if (hVal > maxHits) maxHits = hVal;
        hitMass += hVal;
      } else {
        dstHits[cell] = 0;
        dstRGB[dOff] = 0;
        dstRGB[dOff + 1] = 0;
        dstRGB[dOff + 2] = 0;
      }
    }
  }
  target.maxHits = maxHits;
  target.hitMass = hitMass;
  return { target, predictedTaps, occupiedTaps, radiusCounts };
}

// ---------------------------------------------------------------------------
// Comparison instruments
// ---------------------------------------------------------------------------

interface HistogramAgreement {
  hitsMismatch: number;
  rgbMismatch: number;
  maxAbsHitsDelta: number;
  maxAbsRgbDelta: number;
  maxHitsDelta: number;
  hitMassDelta: number;
  toneByteMismatch: number;
}

function compareHistograms(
  a: FlameHistogram,
  b: FlameHistogram,
): Omit<HistogramAgreement, "toneByteMismatch"> {
  let hitsMismatch = 0;
  let rgbMismatch = 0;
  let maxAbsHitsDelta = 0;
  let maxAbsRgbDelta = 0;
  for (let i = 0; i < a.hits.length; i++) {
    if (a.hits[i] !== b.hits[i]) hitsMismatch++;
    const dh = Math.abs(a.hits[i] - b.hits[i]);
    if (dh > maxAbsHitsDelta) maxAbsHitsDelta = dh;
  }
  for (let i = 0; i < a.sumRGB.length; i++) {
    if (a.sumRGB[i] !== b.sumRGB[i]) rgbMismatch++;
    const dr = Math.abs(a.sumRGB[i] - b.sumRGB[i]);
    if (dr > maxAbsRgbDelta) maxAbsRgbDelta = dr;
  }
  return {
    hitsMismatch,
    rgbMismatch,
    maxAbsHitsDelta,
    maxAbsRgbDelta,
    maxHitsDelta: Math.abs(a.maxHits - b.maxHits),
    hitMassDelta: Math.abs(a.hitMass - b.hitMass),
  };
}

function toneBytesMismatch(
  a: FlameHistogram,
  b: FlameHistogram,
  tone: { exposure: number; gamma: number; vibrancy: number },
): number {
  const pa = tonemapFlame(a, {
    ...tone,
    gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
  });
  const pb = tonemapFlame(b, {
    ...tone,
    gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
  });
  let mismatch = 0;
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] !== pb[i]) mismatch++;
  }
  return mismatch;
}

/** A synthetic fully-occupied frame at the measured raster: every source
 * cell carries hits, so no footprint clips (the occupied box covers every
 * kernel) and the bitmap gather's fully-occupied-word fast path runs
 * everywhere. Counts span a deterministic spread so several radius classes
 * are in play. */
function denseFrame(width: number, height: number): FlameHistogram {
  const hist = createFlameHistogram(width, height);
  for (let i = 0; i < hist.hits.length; i++) {
    const h = 4 + (((i * DENSE_SEED) >>> 0) % 60);
    hist.hits[i] = h;
    const so = i * 3;
    hist.sumRGB[so] = h * (0.2 + ((i % 7) / 7) * 0.8);
    hist.sumRGB[so + 1] = h * (0.3 + ((i % 11) / 11) * 0.7);
    hist.sumRGB[so + 2] = h * (0.4 + ((i % 13) / 13) * 0.6);
  }
  return hist;
}

interface EstimateRow {
  file: string;
  params: string;
  xforms: number;
  accumulationMs: number;
  /** The progressive-tick baseline: `downsampleFlame` at the app's fixed
   * `FLAME_FILTER_RADIUS`, i.e. what one cheap redisplay costs at this
   * raster. The decision threshold is stated as a multiple of it. */
  fixedFilterMs: number;
  preChangePassMs: number | null;
  clippedPlanMs: number;
  clippedGatherMs: number;
  clippedPassMs: number;
  predictedTaps: number | null;
  chargedWork: number;
  paidTaps: number | null;
  radiusHistogram: [number, number][] | null;
  agreement: HistogramAgreement | null;
}

/** Run the pre-change (when `PRE`) and clipped passes at one parameter set
 * and compare them; asserts the exactness claim so a silent drift fails the
 * sheet. In residual-only mode the clipped pass is measured on its own and
 * the comparison fields are null. */
function measureParams(
  file: string,
  xforms: number,
  hist: FlameHistogram,
  params: DensityEstimatorParams,
  paramsLabel: string,
  accumulationMs: number,
  tone: { exposure: number; gamma: number; vibrancy: number },
  prefix: { sat: Int32Array; stride: number },
): EstimateRow {
  const fixedStart = performance.now();
  downsampleFlame(hist, OUT_W, OUT_H, FLAME_FILTER_RADIUS);
  const fixedFilterMs = performance.now() - fixedStart;

  let preChangePassMs: number | null = null;
  let predictedTaps: number | null = null;
  let paidTaps: number | null = null;
  let radiusHistogram: [number, number][] | null = null;
  let agreement: HistogramAgreement | null = null;
  let preChangeTarget: FlameHistogram | null = null;
  if (PRE) {
    const t0 = performance.now();
    const preChange = preChangeAdaptiveDownsample(
      hist,
      OUT_W,
      OUT_H,
      params,
      prefix,
    );
    preChangePassMs = performance.now() - t0;
    predictedTaps = preChange.predictedTaps;
    paidTaps = preChange.occupiedTaps;
    radiusHistogram = [...preChange.radiusCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    preChangeTarget = preChange.target;
  }

  const t1 = performance.now();
  const job = createAdaptiveDownsampleJob(hist, OUT_W, OUT_H, params);
  const planMs = performance.now() - t1;
  while (!job.run(30_000_000)) {
    /* banded, but unbounded budgets: same cells, same order */
  }
  const totalMs = performance.now() - t1;
  const display = job.result();

  if (preChangeTarget !== null) {
    const comparison = compareHistograms(preChangeTarget, display);
    const toneBytes = toneBytesMismatch(preChangeTarget, display, tone);
    agreement = { ...comparison, toneByteMismatch: toneBytes };
    expect(comparison.hitsMismatch).toBe(0);
    expect(comparison.rgbMismatch).toBe(0);
    expect(toneBytes).toBe(0);
  }

  const chargedWork = job.total - OUT_W * OUT_H;
  if (predictedTaps !== null && paidTaps !== null) {
    expect(chargedWork).toBeLessThanOrEqual(predictedTaps);
    // The charged box area is an upper bound on the bits actually visited,
    // and the bitmap can only ever visit occupied cells.
    expect(paidTaps).toBeLessThanOrEqual(chargedWork);
    expect(paidTaps).toBeLessThanOrEqual(predictedTaps);
  }

  return {
    file,
    params: paramsLabel,
    xforms,
    accumulationMs: Math.round(accumulationMs),
    fixedFilterMs: Math.round(fixedFilterMs),
    preChangePassMs:
      preChangePassMs === null ? null : Math.round(preChangePassMs),
    clippedPlanMs: Number(planMs.toFixed(1)),
    clippedGatherMs: Number((totalMs - planMs).toFixed(0)),
    clippedPassMs: Math.round(totalMs),
    predictedTaps,
    chargedWork,
    paidTaps,
    radiusHistogram,
    agreement,
  };
}

describe("flame density-estimate clipping sheet", () => {
  it("measures the clip on the Electric Sheep corpus and the dense path", () => {
    const rows: EstimateRow[] = [];
    const denseRuns: Record<string, unknown>[] = [];

    if (!existsSync(CORPUS_DIR)) {
      console.log(
        `[skip] corpus absent at ${CORPUS_DIR} — set FLAME_ESTIMATE_CORPUS ` +
          "to an Electric Sheep flam3 dump to run the corpus legs",
      );
    } else {
      for (const file of pickFiles(1)) {
        const xml = firstFlameElement(readFileSync(file, "utf8"));
        if (xml === null) {
          console.log(`[skip] ${file}: no <flame> element`);
          continue;
        }
        const decoded = decodeFlameFile(xml);
        if (decoded === null || decoded.scenes.length !== 1) {
          console.log(`[skip] ${file}: decode did not yield one scene`);
          continue;
        }
        const snapshot = decodeScene(decoded.scenes[0].encoded);
        if (snapshot === null) {
          console.log(`[skip] ${file}: scene decode failed`);
          continue;
        }
        const prepared = prepareChaosGame(
          snapshot.transforms,
          snapshot.finalTransform ?? null,
          snapshot.symmetry,
        );
        const matrix = probePlanarProjection(prepared, OUT_W, OUT_H);
        const lut = transformColors(
          snapshot.transforms.length,
          snapshot.transforms.map((t) => t.colorIndex),
        );
        const t0 = performance.now();
        const hist = accumulateFlame(
          prepared,
          matrix,
          OUT_W * SUPERSAMPLE,
          OUT_H * SUPERSAMPLE,
          ITERATIONS,
          mulberry32(1),
          lut,
        );
        const accumulationMs = performance.now() - t0;

        const shortName = file.replace(CORPUS_DIR + "/", "");
        const tone = {
          exposure: snapshot.flame.exposure,
          gamma: snapshot.flame.gamma,
          vibrancy: snapshot.flame.vibrancy,
        };
        const prefix = occupiedPrefix(hist);
        rows.push(
          measureParams(
            shortName,
            snapshot.transforms.length,
            hist,
            {
              estimatorRadius: snapshot.flame.estimatorRadius,
              estimatorMinimumRadius: snapshot.flame.estimatorMinimumRadius,
              estimatorCurve: snapshot.flame.estimatorCurve,
            },
            `imported ${snapshot.flame.estimatorRadius}/${snapshot.flame.estimatorCurve}/${snapshot.flame.estimatorMinimumRadius} (ss ${SUPERSAMPLE})`,
            accumulationMs,
            tone,
            prefix,
          ),
          measureParams(
            shortName,
            snapshot.transforms.length,
            hist,
            DEFAULT_PARAMS,
            "defaults 6/0.4/0",
            accumulationMs,
            tone,
            prefix,
          ),
        );
      }
    }

    // Dense/default regression control: a fully occupied synthetic frame
    // takes the bitmap gather's full-word fast path everywhere.
    const dense = denseFrame(OUT_W * SUPERSAMPLE, OUT_H * SUPERSAMPLE);
    const densePrefix = occupiedPrefix(dense);
    let densePreMs: number | null = null;
    let densePre: ReturnType<typeof preChangeAdaptiveDownsample> | null = null;
    if (PRE) {
      const densePreStart = performance.now();
      densePre = preChangeAdaptiveDownsample(
        dense,
        OUT_W,
        OUT_H,
        DEFAULT_PARAMS,
        densePrefix,
      );
      densePreMs = performance.now() - densePreStart;
    }
    const denseJobStart = performance.now();
    const denseJob = createAdaptiveDownsampleJob(
      dense,
      OUT_W,
      OUT_H,
      DEFAULT_PARAMS,
    );
    const densePlanMs = performance.now() - denseJobStart;
    while (!denseJob.run(30_000_000)) {
      /* banded */
    }
    const denseTotalMs = performance.now() - denseJobStart;
    let denseAgreement: HistogramAgreement | null = null;
    if (densePre !== null) {
      const comparison = compareHistograms(densePre.target, denseJob.result());
      denseAgreement = { ...comparison, toneByteMismatch: 0 };
      expect(comparison.hitsMismatch).toBe(0);
      expect(comparison.rgbMismatch).toBe(0);
    }
    denseRuns.push({
      frame: `${OUT_W * SUPERSAMPLE}x${OUT_H * SUPERSAMPLE} fully occupied`,
      preChangePassMs: densePreMs === null ? null : Math.round(densePreMs),
      clippedPlanMs: Number(densePlanMs.toFixed(1)),
      clippedGatherMs: Number((denseTotalMs - densePlanMs).toFixed(0)),
      clippedPassMs: Math.round(denseTotalMs),
      predictedTaps: densePre === null ? null : densePre.predictedTaps,
      chargedWork: denseJob.total - OUT_W * OUT_H,
      paidTaps: densePre === null ? null : densePre.occupiedTaps,
      agreement: denseAgreement,
    });

    const report = {
      generatedAt: new Date().toISOString(),
      corpus: CORPUS_DIR,
      out: `${OUT_W}x${OUT_H}`,
      supersample: SUPERSAMPLE,
      iterations: ITERATIONS,
      preChangeArm: PRE,
      rows,
      dense: denseRuns,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    const reportPath = join(OUT_DIR, "flame-density-estimate.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`report: ${reportPath}`);

    // On a populated corpus the clip must be material: the best rows gather
    // a small fraction of the taps the full rectangle would, both as the
    // pass charges them (box area) and as the bitmap actually visits them.
    // (The dense frame is not required to clip — it is the regression
    // control. This gate needs the pre-change arm's tap instrument.)
    if (PRE && rows.length > 0) {
      const bestPaid = Math.min(
        ...rows.map((r) => r.paidTaps! / Math.max(1, r.predictedTaps!)),
      );
      expect(bestPaid).toBeLessThan(0.5);
      const bestCharged = Math.min(
        ...rows.map((r) => r.chargedWork / Math.max(1, r.predictedTaps!)),
      );
      expect(bestCharged).toBeLessThan(0.5);
    }
  }, 1_800_000);
});
