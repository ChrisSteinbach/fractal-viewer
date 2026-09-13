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
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/flame-density-estimate.harness.ts
 *
 * MEASURED VERDICT (2026-09-13, Node 22.23.2, i7-1165G7, 960x540 output,
 * supersample 3, 20M iterations, the four genomes under the corpus path):
 * the clip is exact and decisive. Every row is bucket-for-bucket and
 * byte-for-byte identical to the pre-change pass (0 hits/sumRGB/maxHits/
 * hitMass deltas, 0 tone-byte differences). Pass times, pre-change ->
 * clipped (imported params | app defaults): 12.8s -> 0.23s | 2.0s -> 0.14s
 * (242); 47.2s -> 11.4s | 15.0s -> 3.7s (243); 65.2s -> 3.9s | 16.7s ->
 * 1.3s (244); 70.3s -> 8.9s | 21.7s -> 3.6s (247) — 4.0x to 55x. PAID taps
 * fall to 0.10-15% of the full rectangle (242: 0.10%/0.20%; 243: 12.5%/
 * 15.1%; 244: 2.0%/2.4%; 247: 6.3%/8.7%), which is the real gather win; the
 * pass's charged denominator (occupied-box area) falls less, because the
 * bitmap skips empty regions inside a box the planner can bound only at
 * OCCUPANCY_TILE granularity. Plan cost is 100-270ms against gathers of
 * 0.1-11s. The dense 2880x1620 fully-occupied control — every word on the
 * fast path, no clip anywhere — regresses ~4% (3.4-4.6% across runs: 3451ms
 * -> 3619ms, 3758ms -> 3888ms, all of it the added plan scan) with identical
 * output, the disclosed small overhead.
 *
 * App-realistic rerun (FLAME_ESTIMATE_OUT=1920x950, one genome, 244):
 * 185.5s -> 7.4s at the imported params (24.9x; 1.3% of the taps) and
 * 41.5s -> 2.5s at the defaults (16.7x; 1.6%); the 5760x2850 dense control
 * is at parity (15303ms -> 15210ms). Agreement stays exact at this size.
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
  tonemapFlame,
} from "../src/fractal/flame";
import type {
  DensityEstimatorParams,
  FlameHistogram,
  Mat4,
} from "../src/fractal/flame";
import { mulberry32 } from "../src/fractal/rng";
import { decodeFlameFile } from "../src/app/flame-file";
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

const PROBE_POINTS = 4096;
const PROBE_TRIM = 0.02;
const PROBE_SEED = 0x5eed;
const FRAME_FILL = 0.8;
const DENSE_SEED = 2654435761;

const DEFAULT_PARAMS: DensityEstimatorParams = {
  estimatorRadius: 6,
  estimatorMinimumRadius: 2,
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
  preChangePassMs: number;
  clippedPlanMs: number;
  clippedGatherMs: number;
  clippedPassMs: number;
  predictedTaps: number;
  chargedWork: number;
  paidTaps: number;
  radiusHistogram: [number, number][];
  agreement: HistogramAgreement;
}

/** Run the pre-change and clipped passes at one parameter set and compare
 * them; asserts the exactness claim so a silent drift fails the sheet. */
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
  const t0 = performance.now();
  const preChange = preChangeAdaptiveDownsample(
    hist,
    OUT_W,
    OUT_H,
    params,
    prefix,
  );
  const preChangePassMs = performance.now() - t0;

  const t1 = performance.now();
  const job = createAdaptiveDownsampleJob(hist, OUT_W, OUT_H, params);
  const planMs = performance.now() - t1;
  while (!job.run(30_000_000)) {
    /* banded, but unbounded budgets: same cells, same order */
  }
  const totalMs = performance.now() - t1;
  const display = job.result();

  const agreement = compareHistograms(preChange.target, display);
  const toneBytes = toneBytesMismatch(preChange.target, display, tone);
  const chargedWork = job.total - OUT_W * OUT_H;
  expect(agreement.hitsMismatch).toBe(0);
  expect(agreement.rgbMismatch).toBe(0);
  expect(toneBytes).toBe(0);
  expect(chargedWork).toBeLessThanOrEqual(preChange.predictedTaps);
  // The charged box area is an upper bound on the bits actually visited,
  // and the bitmap can only ever visit occupied cells.
  expect(preChange.occupiedTaps).toBeLessThanOrEqual(chargedWork);
  expect(preChange.occupiedTaps).toBeLessThanOrEqual(preChange.predictedTaps);

  return {
    file,
    params: paramsLabel,
    xforms,
    accumulationMs: Math.round(accumulationMs),
    preChangePassMs: Math.round(preChangePassMs),
    clippedPlanMs: Number(planMs.toFixed(1)),
    clippedGatherMs: Number((totalMs - planMs).toFixed(0)),
    clippedPassMs: Math.round(totalMs),
    predictedTaps: preChange.predictedTaps,
    chargedWork,
    paidTaps: preChange.occupiedTaps,
    radiusHistogram: [...preChange.radiusCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6),
    agreement: { ...agreement, toneByteMismatch: toneBytes },
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
            "defaults 6/0.4/2",
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
    const densePreStart = performance.now();
    const densePre = preChangeAdaptiveDownsample(
      dense,
      OUT_W,
      OUT_H,
      DEFAULT_PARAMS,
      densePrefix,
    );
    const densePreMs = performance.now() - densePreStart;
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
    const denseAgreement = compareHistograms(
      densePre.target,
      denseJob.result(),
    );
    expect(denseAgreement.hitsMismatch).toBe(0);
    expect(denseAgreement.rgbMismatch).toBe(0);
    denseRuns.push({
      frame: `${OUT_W * SUPERSAMPLE}x${OUT_H * SUPERSAMPLE} fully occupied`,
      preChangePassMs: Math.round(densePreMs),
      clippedPlanMs: Number(densePlanMs.toFixed(1)),
      clippedGatherMs: Number((denseTotalMs - densePlanMs).toFixed(0)),
      clippedPassMs: Math.round(denseTotalMs),
      predictedTaps: densePre.predictedTaps,
      chargedWork: denseJob.total - OUT_W * OUT_H,
      paidTaps: densePre.occupiedTaps,
      agreement: denseAgreement,
    });

    const report = {
      generatedAt: new Date().toISOString(),
      corpus: CORPUS_DIR,
      out: `${OUT_W}x${OUT_H}`,
      supersample: SUPERSAMPLE,
      iterations: ITERATIONS,
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
    // control.)
    if (rows.length > 0) {
      const bestPaid = Math.min(
        ...rows.map((r) => r.paidTaps / Math.max(1, r.predictedTaps)),
      );
      expect(bestPaid).toBeLessThan(0.5);
      const bestCharged = Math.min(
        ...rows.map((r) => r.chargedWork / Math.max(1, r.predictedTaps)),
      );
      expect(bestCharged).toBeLessThan(0.5);
    }
  }, 900_000);
});
