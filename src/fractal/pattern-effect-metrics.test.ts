import {
  PATTERN_EFFECT_THRESHOLDS,
  PATTERN_EFFECT_THRESHOLD_VERSION,
  analyzePatternEffect,
  comparePatternEffectEngines,
  erodePatternEffectMask,
  labelPatternEffectComponents,
  measurePatternEffectResidual,
  measurePatternEffectVarianceRetention,
  patternEffectBoxBlur,
  patternEffectCoherence,
  patternEffectEligibilityMask,
  patternEffectMaskIou,
  patternEffectObjectMask,
  patternEffectPearson,
  patternEffectPopulationStats,
  patternEffectScalarRelativeDelta,
} from "./pattern-effect-metrics";
import type { PatternEffectRgbaImage } from "./pattern-effect-metrics";

function grayImage(
  width: number,
  height: number,
  value: number,
): PatternEffectRgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    data[pixel * 4] = value;
    data[pixel * 4 + 1] = value;
    data[pixel * 4 + 2] = value;
    data[pixel * 4 + 3] = 255;
  }
  return { width, height, data };
}

function setGray(
  image: PatternEffectRgbaImage,
  x: number,
  y: number,
  value: number,
): void {
  const at = (y * image.width + x) * 4;
  image.data[at] = value;
  image.data[at + 1] = value;
  image.data[at + 2] = value;
}

function cloneImage(image: PatternEffectRgbaImage): PatternEffectRgbaImage {
  return {
    width: image.width,
    height: image.height,
    data: Uint8ClampedArray.from(image.data),
  };
}

function naiveComponentBlur(
  values: ArrayLike<number>,
  mask: Uint8Array,
  components: Int32Array,
  width: number,
  height: number,
  radius: number,
): Float64Array {
  const sums = new Float64Array(width * height);
  const counts = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!mask[pixel]) continue;
      for (
        let xx = Math.max(0, x - radius);
        xx <= Math.min(width - 1, x + radius);
        xx++
      ) {
        const neighbour = y * width + xx;
        if (!mask[neighbour]) continue;
        if (components[neighbour] !== components[pixel]) continue;
        sums[pixel] += values[neighbour];
        counts[pixel]++;
      }
    }
  }
  const output = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!mask[pixel]) continue;
      let sum = 0;
      let count = 0;
      for (
        let yy = Math.max(0, y - radius);
        yy <= Math.min(height - 1, y + radius);
        yy++
      ) {
        const neighbour = yy * width + x;
        if (!mask[neighbour]) continue;
        if (components[neighbour] !== components[pixel]) continue;
        sum += sums[neighbour];
        count += counts[neighbour];
      }
      output[pixel] = count > 0 ? sum / count : values[pixel];
    }
  }
  return output;
}

describe("pattern effect release constants", () => {
  it("publishes one deeply immutable versioned threshold contract", () => {
    expect(PATTERN_EFFECT_THRESHOLD_VERSION).toBe(
      "fr-cmtl.8-effect-metrics-v2",
    );
    expect(PATTERN_EFFECT_THRESHOLDS.version).toBe(
      PATTERN_EFFECT_THRESHOLD_VERSION,
    );
    expect(Object.isFrozen(PATTERN_EFFECT_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(PATTERN_EFFECT_THRESHOLDS.residual)).toBe(true);
    expect(
      Object.isFrozen(PATTERN_EFFECT_THRESHOLDS.residual.pyramidRadii),
    ).toBe(true);
    expect(
      Object.isFrozen(PATTERN_EFFECT_THRESHOLDS.residual.midscaleEnergyZooms),
    ).toBe(true);
    expect(PATTERN_EFFECT_THRESHOLDS.residual.midscaleEnergyZooms).toEqual([1]);
    expect(PATTERN_EFFECT_THRESHOLDS.attachmentMeasurements.zoom).toEqual({
      required: true,
      passThreshold: null,
    });
    expect(PATTERN_EFFECT_THRESHOLDS.attachmentMeasurements.rotor).toEqual({
      required: true,
      passThreshold: null,
    });
  });
});

describe("pattern effect masks", () => {
  it("clips fractional overlay exclusions to covered frame pixels", () => {
    expect(
      Array.from(
        patternEffectEligibilityMask(4, 3, [
          { x: 1.2, y: 0.2, width: 1, height: 1 },
        ]),
      ),
    ).toEqual([1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1]);
  });

  it("uses each eligible row median and a strict byte-luma delta above 12", () => {
    const plain = grayImage(5, 1, 100);
    setGray(plain, 3, 0, 88);
    setGray(plain, 4, 0, 87);
    expect(
      Array.from(
        patternEffectObjectMask(plain, new Uint8Array([1, 1, 1, 1, 1])),
      ),
    ).toEqual([0, 0, 0, 0, 1]);
  });

  it("performs one Chebyshev erosion and respects ineligible neighbours", () => {
    const full = new Uint8Array(25);
    full.fill(1);
    const interior = erodePatternEffectMask(full, full, 5, 5);
    expect(Array.from(interior).reduce((sum, value) => sum + value, 0)).toBe(9);
    expect(interior[2 * 5 + 2]).toBe(1);

    const eligible = Uint8Array.from(full);
    eligible[2 * 5 + 2] = 0;
    expect(
      Array.from(erodePatternEffectMask(full, eligible, 5, 5)).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(0);
  });

  it("labels only four-connected interior components", () => {
    const mask = new Uint8Array([1, 0, 0, 1]);
    const labels = labelPatternEffectComponents(mask, 2, 2);
    expect(labels[0]).not.toBe(0);
    expect(labels[3]).not.toBe(0);
    expect(labels[3]).not.toBe(labels[0]);
  });

  it("keeps vertical connectivity in a one-pixel-wide image", () => {
    expect(
      Array.from(labelPatternEffectComponents(new Uint8Array([1, 1, 1]), 1, 3)),
    ).toEqual([1, 1, 1]);
  });
});

describe("pattern effect residual oracle", () => {
  it("matches the naive component-aware blur for irregular masks and radii", () => {
    const width = 7;
    const height = 5;
    const values = Float64Array.from(
      { length: width * height },
      (_, index) => Math.sin(index * 0.7) + index / 13,
    );
    const mask = Uint8Array.from({ length: width * height }, (_, index) =>
      index % 5 === 1 || index % 7 === 4 ? 0 : 1,
    );
    const components = Int32Array.from(
      { length: width * height },
      (_, index) => (index % 4 < 2 ? 7 : 19),
    );
    for (const radius of [0, 1, 2, 4, 20]) {
      const expected = naiveComponentBlur(
        values,
        mask,
        components,
        width,
        height,
        radius,
      );
      const actual = patternEffectBoxBlur(
        values,
        mask,
        components,
        width,
        height,
        radius,
      );
      for (let pixel = 0; pixel < actual.length; pixel++) {
        expect(actual[pixel]).toBeCloseTo(expected[pixel], 13);
      }
    }
  });

  it("computes population variance and strict right/down edge density", () => {
    expect(
      patternEffectPopulationStats(
        new Float64Array([1, 2, 3, 4]),
        new Uint8Array([1, 1, 1, 1]),
      ),
    ).toEqual({ mean: 2.5, variance: 1.25, count: 4 });

    const mask = new Uint8Array([1, 1]);
    const components = new Int32Array([1, 1]);
    const atThreshold = measurePatternEffectResidual(
      new Float64Array([0, 0.0015]),
      mask,
      components,
      2,
      1,
    );
    expect(atThreshold.edgeThreshold).toBe(0.0015);
    expect(atThreshold.edgeDensity).toBe(0);

    const aboveThreshold = measurePatternEffectResidual(
      new Float64Array([0, 0.0015001]),
      mask,
      components,
      2,
      1,
    );
    expect(aboveThreshold.edgeDensity).toBe(1);
  });

  it("reports normalized fine/mid/low energy and lag-1 coherence", () => {
    const width = 7;
    const height = 7;
    const mask = new Uint8Array(width * height);
    mask.fill(1);
    const components = new Int32Array(width * height);
    components.fill(1);
    const checker = Float64Array.from(
      { length: width * height },
      (_, index) => ((index % width) + Math.floor(index / width)) % 2,
    );
    const metrics = measurePatternEffectResidual(
      checker,
      mask,
      components,
      width,
      height,
    );
    expect(
      metrics.fineEnergyShare + metrics.midEnergyShare + metrics.lowEnergyShare,
    ).toBeCloseTo(1, 14);
    expect(metrics.coherence).toBeLessThan(0);
    expect(
      patternEffectCoherence(
        new Float64Array([1, 1, 3, 3]),
        new Uint8Array([1, 1, 1, 1]),
        new Int32Array([1, 1, 1, 1]),
        4,
        1,
      ),
    ).toBeCloseTo(1 / 3, 14);
  });
});

describe("paired production-frame analysis", () => {
  function pair(): {
    plain: PatternEffectRgbaImage;
    patterned: PatternEffectRgbaImage;
  } {
    const plain = grayImage(9, 7, 100);
    for (let y = 1; y <= 5; y++) {
      for (let x = 3; x <= 5; x++) setGray(plain, x, y, 40);
    }
    const patterned = cloneImage(plain);
    setGray(patterned, 4, 2, 48);
    setGray(patterned, 4, 3, 49);
    setGray(patterned, 4, 4, 35);
    return { plain, patterned };
  }

  it("derives coverage, linear-light signed effect, and strict RGB effect mask", () => {
    const { plain, patterned } = pair();
    const analysis = analyzePatternEffect(plain, patterned);
    const zoomAnalysis = analyzePatternEffect(plain, patterned, [], {
      requireMidEnergy: false,
    });
    expect(analysis.coverage.objectCount).toBe(15);
    expect(analysis.coverage.interiorCount).toBe(3);
    expect(analysis.coverage.rawObjectShare).toBeCloseTo(15 / 63, 14);
    expect(analysis.effect).toBeInstanceOf(Float64Array);
    expect(analysis.effectCount).toBe(1);
    expect(analysis.effectShare).toBeCloseTo(1 / 3, 14);

    const encoded40 = 40 / 255;
    const encoded49 = 49 / 255;
    const linear40 = Math.pow((encoded40 + 0.055) / 1.055, 2.4);
    const linear49 = Math.pow((encoded49 + 0.055) / 1.055, 2.4);
    expect(analysis.effect[3 * 9 + 4]).toBeCloseTo(
      (linear49 - linear40) / (linear49 + linear40),
      14,
    );
    expect(analysis.effectMask[2 * 9 + 4]).toBe(0);
    expect(analysis.effectMask[3 * 9 + 4]).toBe(1);
    expect(analysis.effectMask[4 * 9 + 4]).toBe(0);
    expect(analysis.gates.midEnergyRequired).toBe(true);
    expect(zoomAnalysis.gates.midEnergyRequired).toBe(false);
  });

  it("compares engines on common interiors with correlation, IoU, and scalars", () => {
    const { plain, patterned } = pair();
    const analysis = analyzePatternEffect(plain, patterned);
    const parity = comparePatternEffectEngines(analysis, analysis);
    expect(parity.commonInteriorCount).toBe(3);
    expect(parity.correlation).toBeCloseTo(1, 14);
    expect(parity.effectMask.iou).toBe(1);
    expect(parity.objectMask.iou).toBe(1);
    expect(Object.values(parity.scalarRelativeDeltas)).toEqual(
      Array(7).fill(0),
    );
    expect(parity.gates.pass).toBe(true);
  });
});

describe("parity primitives", () => {
  it("computes masked IoU and returns null for an empty union", () => {
    expect(
      patternEffectMaskIou(
        new Uint8Array([1, 1, 0, 0]),
        new Uint8Array([0, 1, 1, 0]),
      ),
    ).toEqual({
      countA: 2,
      countB: 2,
      intersection: 1,
      union: 3,
      iou: 1 / 3,
    });
    expect(
      patternEffectMaskIou(new Uint8Array(2), new Uint8Array(2)).iou,
    ).toBeNull();
  });

  it("computes Pearson and symmetric scalar relative deltas", () => {
    expect(
      patternEffectPearson(
        new Float64Array([1, 2, 3]),
        new Float64Array([2, 4, 6]),
        new Uint8Array([1, 1, 1]),
      ),
    ).toBeCloseTo(1, 14);
    expect(
      patternEffectPearson(
        new Float64Array([1, 1]),
        new Float64Array([2, 3]),
        new Uint8Array([1, 1]),
      ),
    ).toBeNull();
    expect(patternEffectScalarRelativeDelta(80, 100)).toBe(0.2);
    expect(patternEffectScalarRelativeDelta(100, 80)).toBe(0.2);
    expect(patternEffectScalarRelativeDelta(-2, -1)).toBe(0.5);
    expect(patternEffectScalarRelativeDelta(0, 0)).toBe(0);
  });

  it("enforces every rung and the end-to-end variance retention", () => {
    expect(measurePatternEffectVarianceRetention([1, 0.55, 0.5, 0.5])).toEqual({
      rungRetention: [0.55, 10 / 11, 1],
      endRetention: 0.5,
      pass: true,
    });
    expect(
      measurePatternEffectVarianceRetention([1, 0.54, 0.5, 0.5]).pass,
    ).toBe(false);
    expect(
      measurePatternEffectVarianceRetention([1, 0.9, 0.8, 0.49]).pass,
    ).toBe(false);
  });
});
