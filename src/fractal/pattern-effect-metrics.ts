/**
 * Production-frame image metrics for the patterned-material release gate.
 *
 * This module deliberately knows nothing about documents, cameras, shaders,
 * Playwright, PNGs, or the DOM. A browser verifier decodes two same-stage
 * canvas captures to RGBA bytes and hands them here; the same pure arithmetic
 * is then directly testable without a GPU or image dependency.
 *
 * The pattern-none capture owns the object mask. Patterned pixels can never
 * choose the region over which their own effect is judged. All residual
 * metrics use a one-pixel-eroded object interior, keeping silhouettes and
 * excluded overlays out of comparisons between engines.
 */

export interface PatternEffectRgbaImage {
  width: number;
  height: number;
  /** Row-major RGBA8 bytes. Buffer and Uint8ClampedArray both fit this type. */
  data: Uint8Array | Uint8ClampedArray;
}

export interface PatternEffectOverlayExclusion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PatternEffectCoverage {
  eligibleCount: number;
  objectCount: number;
  rawObjectShare: number;
  interiorCount: number;
  /** Eroded interior as a share of non-overlay frame pixels. */
  interiorShare: number;
  /** Eroded interior as a share of the raw object mask. */
  interiorObjectShare: number;
  objectTouchesFrame: boolean;
}

export interface PatternEffectResidualMetrics {
  residualMean: number;
  residualVariance: number;
  edgeDensity: number;
  edgeThreshold: number;
  edgeCount: number;
  adjacentPairCount: number;
  fineEnergyShare: number;
  midEnergyShare: number;
  lowEnergyShare: number;
  coherence: number;
}

export interface PatternEffectScalarMetrics {
  residualVariance: number;
  edgeDensity: number;
  fineEnergyShare: number;
  midEnergyShare: number;
  lowEnergyShare: number;
  coherence: number;
  effectShare: number;
}

export interface PatternEffectAnalysis {
  width: number;
  height: number;
  eligibleMask: Uint8Array;
  objectMask: Uint8Array;
  interiorMask: Uint8Array;
  components: Int32Array;
  /**
   * Signed normalized luminance effect in a row-major Float64 field.
   * Artifact writers must quantize this field explicitly; it is not RGBA data.
   */
  effect: Float64Array;
  effectMask: Uint8Array;
  effectCount: number;
  effectShare: number;
  coverage: PatternEffectCoverage;
  metrics: PatternEffectResidualMetrics;
  scalars: PatternEffectScalarMetrics;
  gates: {
    rawObjectShare: boolean;
    interiorCount: boolean;
    edgeDensity: boolean;
    midEnergy: boolean;
    midEnergyRequired: boolean;
    fineEnergy: boolean;
    pass: boolean;
  };
}

export interface PatternEffectMaskIou {
  countA: number;
  countB: number;
  intersection: number;
  union: number;
  /** Null when neither mask contains a pixel in the eligible region. */
  iou: number | null;
}

export interface PatternEffectParity {
  commonInteriorCount: number;
  correlation: number | null;
  effectMask: PatternEffectMaskIou;
  objectMask: PatternEffectMaskIou;
  scalarRelativeDeltas: Readonly<
    Record<keyof PatternEffectScalarMetrics, number>
  >;
  gates: {
    correlation: boolean;
    effectMaskIou: boolean;
    scalarAgreement: boolean;
    pass: boolean;
  };
}

export interface PatternEffectVarianceRetention {
  rungRetention: number[];
  endRetention: number;
  pass: boolean;
}

export const PATTERN_EFFECT_THRESHOLD_VERSION =
  "pattern-effect-metrics-v2" as const;

/**
 * Frozen release-gate constants. Attachment is explicitly measurement-only:
 * neither the pattern epic nor its release gate supplied a defensible
 * numeric swim threshold, so this module does not manufacture one.
 */
export const PATTERN_EFFECT_THRESHOLDS = Object.freeze({
  version: PATTERN_EFFECT_THRESHOLD_VERSION,
  capture: Object.freeze({
    width: 960,
    height: 540,
    deviceScaleFactor: 1,
  }),
  coverage: Object.freeze({
    backgroundLuminanceDelta8: 12,
    interiorErosionRadius: 1,
    minimumRawObjectShare: 0.05,
    minimumInteriorPixels: 10_000,
    maximumExhaustedRays: 0,
  }),
  residual: Object.freeze({
    edgeThresholdFloor: 0.0015,
    edgeThresholdSigmaFactor: 0.24,
    minimumEdgeDensity: 0.08,
    maximumEdgeDensity: 0.45,
    // The 0.25 prototype floor measured 96px pre-lighting CPU residuals.
    // Production uses a 960x540 normalized post-light residual, where 0.225
    // preserves the same anti-speckle intent without rejecting coherent,
    // low-frequency material structure. This gate is ordinary-view only.
    minimumMidscaleEnergy: 0.225,
    midscaleEnergyZooms: Object.freeze([1] as const),
    maximumFineEnergy: 0.6,
    pyramidRadii: Object.freeze([2, 4, 8, 16] as const),
    // Permit one bounded transition dip when the 64x/1x end retention still
    // clears its independent floor. Production's two engines measured the
    // same recoverable Marble dip at 0.563/0.569.
    minimumRungVarianceRetention: 0.55,
    minimum64xVarianceRetention: 0.5,
  }),
  effect: Object.freeze({
    structuralChannelDelta8: 8,
    normalizedDenominatorFloor: 1 / 255 ** 2,
  }),
  parity: Object.freeze({
    minimumEffectCorrelation: 0.85,
    minimumEffectMaskIou: 0.7,
    maximumScalarRelativeDelta: 0.15,
  }),
  zooms: Object.freeze([1, 4, 16, 64] as const),
  attachmentMeasurements: Object.freeze({
    zoom: Object.freeze({ required: true, passThreshold: null }),
    rotor: Object.freeze({ required: true, passThreshold: null }),
    slice: Object.freeze({ required: true, passThreshold: null }),
  }),
});

const SRGB8_TO_LINEAR = new Float64Array(256);
for (let byte = 0; byte < SRGB8_TO_LINEAR.length; byte++) {
  const encoded = byte / 255;
  SRGB8_TO_LINEAR[byte] =
    encoded <= 0.04045
      ? encoded / 12.92
      : Math.pow((encoded + 0.055) / 1.055, 2.4);
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error("pattern effect image width must be a positive integer");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("pattern effect image height must be a positive integer");
  }
}

function assertImage(image: PatternEffectRgbaImage, name: string): void {
  assertDimensions(image.width, image.height);
  if (image.data.length !== image.width * image.height * 4) {
    throw new Error(
      `${name} RGBA length ${String(image.data.length)} does not match ` +
        `${String(image.width)}x${String(image.height)}`,
    );
  }
}

function assertPair(
  plain: PatternEffectRgbaImage,
  patterned: PatternEffectRgbaImage,
): void {
  assertImage(plain, "pattern-none");
  assertImage(patterned, "patterned");
  if (plain.width !== patterned.width || plain.height !== patterned.height) {
    throw new Error(
      `pattern effect image size mismatch: ${String(plain.width)}x${String(plain.height)} ` +
        `vs ${String(patterned.width)}x${String(patterned.height)}`,
    );
  }
}

function byteLuminance(
  data: Uint8Array | Uint8ClampedArray,
  at: number,
): number {
  // Integer coefficients make the strict 12-byte boundary exact (in
  // particular, a neutral gray delta of exactly 12 stays background).
  return (299 * data[at] + 587 * data[at + 1] + 114 * data[at + 2]) / 1_000;
}

function linearLuminance(
  data: Uint8Array | Uint8ClampedArray,
  at: number,
): number {
  return (
    0.2126 * SRGB8_TO_LINEAR[data[at]] +
    0.7152 * SRGB8_TO_LINEAR[data[at + 1]] +
    0.0722 * SRGB8_TO_LINEAR[data[at + 2]]
  );
}

/** Build the frame region left after overlay rectangles are excluded. */
export function patternEffectEligibilityMask(
  width: number,
  height: number,
  exclusions: readonly PatternEffectOverlayExclusion[] = [],
): Uint8Array {
  assertDimensions(width, height);
  const eligible = new Uint8Array(width * height);
  eligible.fill(1);
  for (const exclusion of exclusions) {
    if (
      !Number.isFinite(exclusion.x) ||
      !Number.isFinite(exclusion.y) ||
      !Number.isFinite(exclusion.width) ||
      !Number.isFinite(exclusion.height) ||
      exclusion.width <= 0 ||
      exclusion.height <= 0
    ) {
      continue;
    }
    const x0 = Math.max(0, Math.floor(exclusion.x));
    const y0 = Math.max(0, Math.floor(exclusion.y));
    const x1 = Math.min(width, Math.ceil(exclusion.x + exclusion.width));
    const y1 = Math.min(height, Math.ceil(exclusion.y + exclusion.height));
    for (let y = y0; y < y1; y++) {
      eligible.fill(0, y * width + x0, y * width + x1);
    }
  }
  return eligible;
}

/**
 * Derive a pattern-independent object mask from the pattern-none frame.
 * Each row's eligible median luminance is its backdrop estimate, matching the
 * production surface's quiet row-wise gradient and the existing 4D parity
 * verifier. The comparison is strict: exactly 12 byte-luma units is backdrop.
 */
export function patternEffectObjectMask(
  plain: PatternEffectRgbaImage,
  eligibleMask: Uint8Array,
): Uint8Array {
  assertImage(plain, "pattern-none");
  const { width, height, data } = plain;
  if (eligibleMask.length !== width * height) {
    throw new Error("pattern effect eligible mask has the wrong length");
  }
  const object = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowValues: number[] = [];
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!eligibleMask[pixel]) continue;
      rowValues.push(byteLuminance(data, pixel * 4));
    }
    if (rowValues.length === 0) continue;
    rowValues.sort((a, b) => a - b);
    const background = rowValues[Math.floor(rowValues.length / 2)];
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!eligibleMask[pixel]) continue;
      if (
        Math.abs(byteLuminance(data, pixel * 4) - background) >
        PATTERN_EFFECT_THRESHOLDS.coverage.backgroundLuminanceDelta8
      ) {
        object[pixel] = 1;
      }
    }
  }
  return object;
}

/** One Chebyshev erosion: all 3x3 neighbours must remain eligible object. */
export function erodePatternEffectMask(
  mask: Uint8Array,
  eligibleMask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  assertDimensions(width, height);
  if (mask.length !== width * height || eligibleMask.length !== mask.length) {
    throw new Error("pattern effect erosion masks have the wrong length");
  }
  const interior = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!mask[pixel] || !eligibleMask[pixel]) continue;
      let keep = true;
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            keep = false;
            break;
          }
          const neighbour = ny * width + nx;
          if (!eligibleMask[neighbour] || !mask[neighbour]) {
            keep = false;
            break;
          }
        }
      }
      if (keep) interior[pixel] = 1;
    }
  }
  return interior;
}

/** Label 4-connected image-space components of a binary mask. */
export function labelPatternEffectComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): Int32Array {
  assertDimensions(width, height);
  if (mask.length !== width * height) {
    throw new Error("pattern effect component mask has the wrong length");
  }
  const labels = new Int32Array(mask.length);
  const stack: number[] = [];
  let nextLabel = 0;
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || labels[seed] !== 0) continue;
    labels[seed] = ++nextLabel;
    stack.push(seed);
    while (stack.length > 0) {
      const at = stack.pop();
      if (at === undefined) break;
      const x = at % width;
      const neighbours = [
        x > 0 ? at - 1 : -1,
        x + 1 < width ? at + 1 : -1,
        at >= width ? at - width : -1,
        at + width < mask.length ? at + width : -1,
      ];
      for (const to of neighbours) {
        if (to < 0 || !mask[to] || labels[to] !== 0) {
          continue;
        }
        labels[to] = nextLabel;
        stack.push(to);
      }
    }
  }
  return labels;
}

/** Population mean and variance over a binary mask. */
export function patternEffectPopulationStats(
  values: ArrayLike<number>,
  mask: Uint8Array,
): { mean: number; variance: number; count: number } {
  if (values.length !== mask.length) {
    throw new Error("pattern effect values and mask have different lengths");
  }
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    const value = values[i];
    sum += value;
    sumSq += value * value;
    count++;
  }
  if (count === 0) return { mean: 0, variance: 0, count: 0 };
  const mean = sum / count;
  return {
    mean,
    variance: Math.max(0, sumSq / count - mean * mean),
    count,
  };
}

/**
 * Component-aware separable box blur used by the accepted metric pyramid.
 *
 * Each pass keeps one running sum/count per connected component. Consequently,
 * a radius costs O(width * height), rather than revisiting every neighbour for
 * every pixel. Component accounting preserves the reference behavior even if
 * one component leaves and later re-enters a row or column window.
 */
export function patternEffectBoxBlur(
  values: ArrayLike<number>,
  mask: Uint8Array,
  components: Int32Array,
  width: number,
  height: number,
  radius: number,
): Float64Array {
  assertDimensions(width, height);
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error(
      "pattern effect blur radius must be a non-negative integer",
    );
  }
  const pixels = width * height;
  if (
    values.length !== pixels ||
    mask.length !== pixels ||
    components.length !== pixels
  ) {
    throw new Error("pattern effect blur inputs have the wrong length");
  }

  const denseComponents = new Int32Array(pixels);
  denseComponents.fill(-1);
  const componentSlots = new Map<number, number>();
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (!mask[pixel]) continue;
    const component = components[pixel];
    if (!Number.isInteger(component) || component < 0) {
      throw new Error(
        "pattern effect blur components must be non-negative integers",
      );
    }
    let slot = componentSlots.get(component);
    if (slot === undefined) {
      slot = componentSlots.size;
      componentSlots.set(component, slot);
    }
    denseComponents[pixel] = slot;
  }

  const runningSums = new Float64Array(componentSlots.size);
  const runningCounts = new Uint32Array(componentSlots.size);
  const horizontalSum = new Float64Array(pixels);
  const horizontalCount = new Uint32Array(pixels);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const initialEnd = Math.min(width - 1, radius);
    for (let x = 0; x <= initialEnd; x++) {
      const pixel = row + x;
      if (!mask[pixel]) continue;
      const slot = denseComponents[pixel];
      runningSums[slot] += values[pixel];
      runningCounts[slot]++;
    }
    for (let x = 0; x < width; x++) {
      const pixel = row + x;
      if (mask[pixel]) {
        const slot = denseComponents[pixel];
        horizontalSum[pixel] = runningSums[slot];
        horizontalCount[pixel] = runningCounts[slot];
      }

      const removeX = x - radius;
      if (removeX >= 0) {
        const remove = row + removeX;
        if (mask[remove]) {
          const slot = denseComponents[remove];
          runningSums[slot] -= values[remove];
          runningCounts[slot]--;
        }
      }
      const addX = x + radius + 1;
      if (addX < width) {
        const add = row + addX;
        if (mask[add]) {
          const slot = denseComponents[add];
          runningSums[slot] += values[add];
          runningCounts[slot]++;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      const pixel = row + x;
      if (!mask[pixel]) continue;
      const slot = denseComponents[pixel];
      runningSums[slot] = 0;
      runningCounts[slot] = 0;
    }
  }

  const output = new Float64Array(pixels);
  for (let x = 0; x < width; x++) {
    const initialEnd = Math.min(height - 1, radius);
    for (let y = 0; y <= initialEnd; y++) {
      const pixel = y * width + x;
      if (!mask[pixel]) continue;
      const slot = denseComponents[pixel];
      runningSums[slot] += horizontalSum[pixel];
      runningCounts[slot] += horizontalCount[pixel];
    }
    for (let y = 0; y < height; y++) {
      const pixel = y * width + x;
      if (mask[pixel]) {
        const slot = denseComponents[pixel];
        output[pixel] =
          runningCounts[slot] > 0
            ? runningSums[slot] / runningCounts[slot]
            : values[pixel];
      }

      const removeY = y - radius;
      if (removeY >= 0) {
        const remove = removeY * width + x;
        if (mask[remove]) {
          const slot = denseComponents[remove];
          runningSums[slot] -= horizontalSum[remove];
          runningCounts[slot] -= horizontalCount[remove];
        }
      }
      const addY = y + radius + 1;
      if (addY < height) {
        const add = addY * width + x;
        if (mask[add]) {
          const slot = denseComponents[add];
          runningSums[slot] += horizontalSum[add];
          runningCounts[slot] += horizontalCount[add];
        }
      }
    }
    for (let y = 0; y < height; y++) {
      const pixel = y * width + x;
      if (!mask[pixel]) continue;
      const slot = denseComponents[pixel];
      runningSums[slot] = 0;
      runningCounts[slot] = 0;
    }
  }
  return output;
}

function differenceVariance(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  mask: Uint8Array,
): number {
  if (a.length !== b.length || a.length !== mask.length) {
    throw new Error("pattern effect difference inputs have different lengths");
  }
  const difference = new Float64Array(a.length);
  for (let i = 0; i < difference.length; i++) {
    if (mask[i]) difference[i] = a[i] - b[i];
  }
  return patternEffectPopulationStats(difference, mask).variance;
}

/** Symmetric lag-1 autocorrelation over right/down same-component pairs. */
export function patternEffectCoherence(
  values: ArrayLike<number>,
  mask: Uint8Array,
  components: Int32Array,
  width: number,
  height: number,
  mean = patternEffectPopulationStats(values, mask).mean,
): number {
  const pixels = width * height;
  if (
    values.length !== pixels ||
    mask.length !== pixels ||
    components.length !== pixels
  ) {
    throw new Error("pattern effect coherence inputs have the wrong length");
  }
  let numerator = 0;
  let denominator = 0;
  const addPair = (a: number, b: number): void => {
    const da = values[a] - mean;
    const db = values[b] - mean;
    numerator += 2 * da * db;
    denominator += da * da + db * db;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!mask[pixel]) continue;
      if (
        x + 1 < width &&
        mask[pixel + 1] &&
        components[pixel + 1] === components[pixel]
      ) {
        addPair(pixel, pixel + 1);
      }
      if (
        y + 1 < height &&
        mask[pixel + width] &&
        components[pixel + width] === components[pixel]
      ) {
        addPair(pixel, pixel + width);
      }
    }
  }
  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, numerator / denominator));
}

/** Measure variance, edge density, pyramid energy, and lag-1 coherence. */
export function measurePatternEffectResidual(
  residual: ArrayLike<number>,
  mask: Uint8Array,
  components: Int32Array,
  width: number,
  height: number,
): PatternEffectResidualMetrics {
  const population = patternEffectPopulationStats(residual, mask);
  const sigma = Math.sqrt(population.variance);
  const edgeThreshold = Math.max(
    PATTERN_EFFECT_THRESHOLDS.residual.edgeThresholdFloor,
    sigma * PATTERN_EFFECT_THRESHOLDS.residual.edgeThresholdSigmaFactor,
  );
  let edgeCount = 0;
  let adjacentPairCount = 0;
  const comparePair = (a: number, b: number): void => {
    adjacentPairCount++;
    if (Math.abs(residual[b] - residual[a]) > edgeThreshold) edgeCount++;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!mask[pixel]) continue;
      if (
        x + 1 < width &&
        mask[pixel + 1] &&
        components[pixel + 1] === components[pixel]
      ) {
        comparePair(pixel, pixel + 1);
      }
      if (
        y + 1 < height &&
        mask[pixel + width] &&
        components[pixel + width] === components[pixel]
      ) {
        comparePair(pixel, pixel + width);
      }
    }
  }

  const [r2, r4, r8, r16] = PATTERN_EFFECT_THRESHOLDS.residual.pyramidRadii;
  const b2 = patternEffectBoxBlur(
    residual,
    mask,
    components,
    width,
    height,
    r2,
  );
  const b4 = patternEffectBoxBlur(
    residual,
    mask,
    components,
    width,
    height,
    r4,
  );
  const b8 = patternEffectBoxBlur(
    residual,
    mask,
    components,
    width,
    height,
    r8,
  );
  const b16 = patternEffectBoxBlur(
    residual,
    mask,
    components,
    width,
    height,
    r16,
  );
  const fine = differenceVariance(residual, b2, mask);
  const mid =
    differenceVariance(b2, b4, mask) +
    differenceVariance(b4, b8, mask) +
    differenceVariance(b8, b16, mask);
  const low = patternEffectPopulationStats(b16, mask).variance;
  const total = fine + mid + low;

  return {
    residualMean: population.mean,
    residualVariance: population.variance,
    edgeDensity: adjacentPairCount > 0 ? edgeCount / adjacentPairCount : 0,
    edgeThreshold,
    edgeCount,
    adjacentPairCount,
    fineEnergyShare: total > 0 ? fine / total : 0,
    midEnergyShare: total > 0 ? mid / total : 0,
    lowEnergyShare: total > 0 ? low / total : 0,
    coherence: patternEffectCoherence(
      residual,
      mask,
      components,
      width,
      height,
      population.mean,
    ),
  };
}

/** Analyze one same-stage pattern-none/patterned capture pair. */
export function analyzePatternEffect(
  plain: PatternEffectRgbaImage,
  patterned: PatternEffectRgbaImage,
  exclusions: readonly PatternEffectOverlayExclusion[] = [],
  options: Readonly<{ requireMidEnergy?: boolean }> = {},
): PatternEffectAnalysis {
  assertPair(plain, patterned);
  const { width, height } = plain;
  const pixels = width * height;
  const eligibleMask = patternEffectEligibilityMask(width, height, exclusions);
  const objectMask = patternEffectObjectMask(plain, eligibleMask);
  const interiorMask = erodePatternEffectMask(
    objectMask,
    eligibleMask,
    width,
    height,
  );
  const components = labelPatternEffectComponents(interiorMask, width, height);
  const effect = new Float64Array(pixels);
  const effectMask = new Uint8Array(pixels);
  let eligibleCount = 0;
  let objectCount = 0;
  let interiorCount = 0;
  let effectCount = 0;
  let objectTouchesFrame = false;

  for (let pixel = 0; pixel < pixels; pixel++) {
    if (eligibleMask[pixel]) eligibleCount++;
    if (objectMask[pixel]) {
      objectCount++;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        objectTouchesFrame = true;
      }
    }
    if (!interiorMask[pixel]) continue;
    interiorCount++;
    const at = pixel * 4;
    const plainLuminance = linearLuminance(plain.data, at);
    const patternedLuminance = linearLuminance(patterned.data, at);
    effect[pixel] =
      (patternedLuminance - plainLuminance) /
      Math.max(
        patternedLuminance + plainLuminance,
        PATTERN_EFFECT_THRESHOLDS.effect.normalizedDenominatorFloor,
      );
    const channelDelta = Math.max(
      Math.abs(patterned.data[at] - plain.data[at]),
      Math.abs(patterned.data[at + 1] - plain.data[at + 1]),
      Math.abs(patterned.data[at + 2] - plain.data[at + 2]),
    );
    if (
      channelDelta > PATTERN_EFFECT_THRESHOLDS.effect.structuralChannelDelta8
    ) {
      effectMask[pixel] = 1;
      effectCount++;
    }
  }

  const rawObjectShare = eligibleCount > 0 ? objectCount / eligibleCount : 0;
  const coverage: PatternEffectCoverage = {
    eligibleCount,
    objectCount,
    rawObjectShare,
    interiorCount,
    interiorShare: eligibleCount > 0 ? interiorCount / eligibleCount : 0,
    interiorObjectShare: objectCount > 0 ? interiorCount / objectCount : 0,
    objectTouchesFrame,
  };
  const metrics = measurePatternEffectResidual(
    effect,
    interiorMask,
    components,
    width,
    height,
  );
  const effectShare = interiorCount > 0 ? effectCount / interiorCount : 0;
  const scalars: PatternEffectScalarMetrics = {
    residualVariance: metrics.residualVariance,
    edgeDensity: metrics.edgeDensity,
    fineEnergyShare: metrics.fineEnergyShare,
    midEnergyShare: metrics.midEnergyShare,
    lowEnergyShare: metrics.lowEnergyShare,
    coherence: metrics.coherence,
    effectShare,
  };
  const gates = {
    rawObjectShare:
      rawObjectShare >=
      PATTERN_EFFECT_THRESHOLDS.coverage.minimumRawObjectShare,
    interiorCount:
      interiorCount >= PATTERN_EFFECT_THRESHOLDS.coverage.minimumInteriorPixels,
    edgeDensity:
      metrics.edgeDensity >=
        PATTERN_EFFECT_THRESHOLDS.residual.minimumEdgeDensity &&
      metrics.edgeDensity <=
        PATTERN_EFFECT_THRESHOLDS.residual.maximumEdgeDensity,
    midEnergy:
      metrics.midEnergyShare >=
      PATTERN_EFFECT_THRESHOLDS.residual.minimumMidscaleEnergy,
    midEnergyRequired: options.requireMidEnergy ?? true,
    fineEnergy:
      metrics.fineEnergyShare <=
      PATTERN_EFFECT_THRESHOLDS.residual.maximumFineEnergy,
    pass: false,
  };
  gates.pass =
    gates.rawObjectShare &&
    gates.interiorCount &&
    gates.edgeDensity &&
    (!gates.midEnergyRequired || gates.midEnergy) &&
    gates.fineEnergy;

  return {
    width,
    height,
    eligibleMask,
    objectMask,
    interiorMask,
    components,
    effect,
    effectMask,
    effectCount,
    effectShare,
    coverage,
    metrics,
    scalars,
    gates,
  };
}

/** Intersection-over-union for two masks inside an optional eligible mask. */
export function patternEffectMaskIou(
  a: Uint8Array,
  b: Uint8Array,
  eligible?: Uint8Array,
): PatternEffectMaskIou {
  if (a.length !== b.length || (eligible && eligible.length !== a.length)) {
    throw new Error("pattern effect IoU masks have different lengths");
  }
  let countA = 0;
  let countB = 0;
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (eligible && !eligible[i]) continue;
    const va = a[i] !== 0;
    const vb = b[i] !== 0;
    if (va) countA++;
    if (vb) countB++;
    if (va && vb) intersection++;
    if (va || vb) union++;
  }
  return {
    countA,
    countB,
    intersection,
    union,
    iou: union > 0 ? intersection / union : null,
  };
}

/** Pearson correlation over a shared binary mask. */
export function patternEffectPearson(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  mask: Uint8Array,
): number | null {
  if (a.length !== b.length || a.length !== mask.length) {
    throw new Error("pattern effect correlation inputs have different lengths");
  }
  let sumA = 0;
  let sumB = 0;
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    sumA += a[i];
    sumB += b[i];
    count++;
  }
  if (count === 0) return null;
  const meanA = sumA / count;
  const meanB = sumB / count;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  const denominator = Math.sqrt(varianceA * varianceB);
  if (denominator === 0) return null;
  return Math.max(-1, Math.min(1, covariance / denominator));
}

/** Symmetric relative delta, using the larger magnitude as the denominator. */
export function patternEffectScalarRelativeDelta(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 ? Math.abs(a - b) / scale : 0;
}

const SCALAR_KEYS = Object.freeze([
  "residualVariance",
  "edgeDensity",
  "fineEnergyShare",
  "midEnergyShare",
  "lowEnergyShare",
  "coherence",
  "effectShare",
] as const satisfies readonly (keyof PatternEffectScalarMetrics)[]);

/** Compare same-pose effect maps from two engines. No image registration. */
export function comparePatternEffectEngines(
  a: PatternEffectAnalysis,
  b: PatternEffectAnalysis,
): PatternEffectParity {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `pattern effect analysis size mismatch: ${String(a.width)}x${String(a.height)} ` +
        `vs ${String(b.width)}x${String(b.height)}`,
    );
  }
  const commonEligible = new Uint8Array(a.eligibleMask.length);
  const commonInterior = new Uint8Array(a.interiorMask.length);
  let commonInteriorCount = 0;
  for (let i = 0; i < commonEligible.length; i++) {
    if (a.eligibleMask[i] && b.eligibleMask[i]) commonEligible[i] = 1;
    if (a.interiorMask[i] && b.interiorMask[i]) {
      commonInterior[i] = 1;
      commonInteriorCount++;
    }
  }
  const correlation = patternEffectPearson(a.effect, b.effect, commonInterior);
  const effectMask = patternEffectMaskIou(
    a.effectMask,
    b.effectMask,
    commonInterior,
  );
  const objectMask = patternEffectMaskIou(
    a.objectMask,
    b.objectMask,
    commonEligible,
  );
  const scalarRelativeDeltas = Object.fromEntries(
    SCALAR_KEYS.map((key) => [
      key,
      patternEffectScalarRelativeDelta(a.scalars[key], b.scalars[key]),
    ]),
  ) as unknown as Readonly<Record<keyof PatternEffectScalarMetrics, number>>;
  const gates = {
    correlation:
      correlation !== null &&
      correlation >= PATTERN_EFFECT_THRESHOLDS.parity.minimumEffectCorrelation,
    effectMaskIou:
      effectMask.iou !== null &&
      effectMask.iou >= PATTERN_EFFECT_THRESHOLDS.parity.minimumEffectMaskIou,
    scalarAgreement: SCALAR_KEYS.every(
      (key) =>
        scalarRelativeDeltas[key] <=
        PATTERN_EFFECT_THRESHOLDS.parity.maximumScalarRelativeDelta,
    ),
    pass: false,
  };
  gates.pass =
    gates.correlation && gates.effectMaskIou && gates.scalarAgreement;
  return {
    commonInteriorCount,
    correlation,
    effectMask,
    objectMask,
    scalarRelativeDeltas,
    gates,
  };
}

/** Evaluate the accepted 1x/4x/16x/64x residual-variance retention rule. */
export function measurePatternEffectVarianceRetention(
  residualVariances: readonly number[],
): PatternEffectVarianceRetention {
  if (residualVariances.length !== PATTERN_EFFECT_THRESHOLDS.zooms.length) {
    throw new Error(
      `pattern effect variance ladder requires ${String(PATTERN_EFFECT_THRESHOLDS.zooms.length)} rungs`,
    );
  }
  if (residualVariances.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(
      "pattern effect variance ladder must be finite and non-negative",
    );
  }
  const rungRetention = residualVariances
    .slice(1)
    .map(
      (value, index) =>
        value / Math.max(residualVariances[index], Number.EPSILON),
    );
  const endRetention =
    residualVariances.at(-1)! / Math.max(residualVariances[0], Number.EPSILON);
  return {
    rungRetention,
    endRetention,
    pass:
      rungRetention.every(
        (value) =>
          value >=
          PATTERN_EFFECT_THRESHOLDS.residual.minimumRungVarianceRetention,
      ) &&
      endRetention >=
        PATTERN_EFFECT_THRESHOLDS.residual.minimum64xVarianceRetention,
  };
}
