/**
 * Scalar qualification controls for prominence-conditioned positive
 * variation. This is not a renderer, a membership oracle for fractal DEs, or
 * evidence of image quality. The mixed-material counterexample is retained as
 * a qualification refusal.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { boxUnionIntervals, type OpticalInterval } from "./transmission-proxy";
import {
  clearanceLayerSignal,
  layerOpticalIncrement,
  layerThroughput,
} from "./transmission-layer-field";
import {
  initialProminenceFieldState,
  PROMINENCE_FIELD_DEFAULTS,
  prominenceFieldStep,
  type ProminenceFieldState,
} from "./transmission-prominence-field";

const TAU = 0.864;
const P = PROMINENCE_FIELD_DEFAULTS.prominence;

interface Sample {
  signal: number;
  opaque?: boolean;
  owner?: string;
}

function accumulate(
  samples: readonly Sample[],
  chunkSize = samples.length,
  serializeChunks = false,
) {
  let state = initialProminenceFieldState();
  let variation = 0;
  let throughput = 1;
  let stoppedAt: number | null = null;
  let opaqueSamplesWithoutWeight = 0;
  const increments: number[] = [];
  for (let start = 0; start < samples.length; start += chunkSize) {
    for (
      let index = start;
      index < Math.min(samples.length, start + chunkSize);
      index++
    ) {
      const sample = samples[index];
      const step = prominenceFieldStep(state, sample.signal);
      state = step.state;
      increments.push(step.increment);
      if (sample.opaque && step.increment === 0) opaqueSamplesWithoutWeight++;
      if (step.increment === 0) continue;
      variation += step.increment;
      if (sample.opaque) {
        throughput = 0;
        stoppedAt = index;
        break;
      }
      throughput *= layerThroughput(TAU, step.increment);
    }
    if (stoppedAt !== null) break;
    if (serializeChunks)
      state = JSON.parse(JSON.stringify(state)) as ProminenceFieldState;
  }
  return {
    variation,
    throughput,
    state,
    stoppedAt,
    stoppedOwner:
      stoppedAt === null ? null : (samples[stoppedAt].owner ?? null),
    opaqueSamplesWithoutWeight,
    increments,
  };
}

function summarize(result: ReturnType<typeof accumulate>) {
  const { increments: _increments, ...summary } = result;
  return summary;
}

function accumulateUnconditioned(samples: readonly Sample[]) {
  let previousSignal = 0;
  let variation = 0;
  let throughput = 1;
  let stoppedAt: number | null = null;
  let opaqueSamplesWithoutWeight = 0;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const increment = layerOpticalIncrement(previousSignal, sample.signal);
    previousSignal = sample.signal;
    if (sample.opaque && increment === 0) opaqueSamplesWithoutWeight++;
    if (increment === 0) continue;
    variation += increment;
    if (sample.opaque) {
      throughput = 0;
      stoppedAt = index;
      break;
    }
    throughput *= layerThroughput(TAU, increment);
  }
  return {
    variation,
    throughput,
    previousSignal,
    stoppedAt,
    stoppedOwner:
      stoppedAt === null ? null : (samples[stoppedAt].owner ?? null),
    opaqueSamplesWithoutWeight,
  };
}

function exactGapSamples(
  dimension: 3 | 4,
  gap: number,
  delta: number,
  phase: number,
  opaque: "none" | "front" | "rear" = "none",
  materialSupport: "nearest-distance" | "membership" = "nearest-distance",
) {
  const centers = [0.3, 0.2 - gap];
  const boxes = centers.map((z) => ({
    center: dimension === 3 ? [0, 0, z] : [0, 0, z, 0.02],
    half: 0.05,
  }));
  const angle = 0.35;
  const origin =
    dimension === 3
      ? [0, 0, 3]
      : [-Math.sin(angle) * 0.02, 0, 3, Math.cos(angle) * 0.02];
  const direction = dimension === 3 ? [0, 0, -1] : [0, 0, -1, 0];
  const intervals = boxUnionIntervals(boxes, origin, direction);
  expect(intervals).toHaveLength(2);
  expect(intervals[1].enter - intervals[0].exit).toBeCloseTo(gap, 12);
  const first = 2 + phase * delta;
  const count = Math.ceil((4 - first) / delta);
  const contains = (interval: OpticalInterval, t: number) =>
    t >= interval.enter && t <= interval.exit;
  const samples = Array.from({ length: count }, (_, index) => {
    const t = first + index * delta;
    const distances = intervals.map(({ enter, exit }) =>
      Math.max(enter - t, t - exit, 0),
    );
    let nearestIndex = 0;
    for (let candidate = 1; candidate < distances.length; candidate++)
      // Match fromSurfaces: a strict improvement replaces the current owner,
      // so an exact tie remains attributed to the first/front surface.
      if (distances[candidate] < distances[nearestIndex])
        nearestIndex = candidate;
    const distance = distances[nearestIndex];
    const front = contains(intervals[0], t);
    const rear = contains(intervals[1], t);
    const nearestOwner = nearestIndex === 0 ? "front" : "rear";
    const membershipOwner = front ? "front" : rear ? "rear" : "clearance";
    const owner =
      materialSupport === "nearest-distance" ? nearestOwner : membershipOwner;
    return {
      signal: clearanceLayerSignal(distance, 1),
      opaque: opaque !== "none" && owner === opaque,
      owner,
    };
  });
  const gapSignals = samples
    .map((sample, index) => ({ sample, t: first + index * delta }))
    .filter(({ t }) => t >= intervals[0].exit && t <= intervals[1].enter)
    .map(({ sample }) => sample.signal);
  return { intervals, samples, minimumGapSignal: Math.min(...gapSignals) };
}

function monotoneSignals() {
  return [
    0,
    clearanceLayerSignal(0.00275, 1),
    clearanceLayerSignal(0.0025, 1),
    clearanceLayerSignal(0.00225, 1),
    ...Array<number>(1000).fill(1),
    clearanceLayerSignal(0.0025, 1),
    0,
  ].map((signal) => ({ signal }));
}

describe("Prominence-conditioned positive variation", () => {
  it("runs bounded scalar controls and records the ownership refusal", () => {
    const monotone = accumulate(monotoneSignals());
    expect(monotone.variation).toBeCloseTo(1, 12);
    expect(monotone.throughput).toBeCloseTo(TAU, 12);
    const repeated = accumulate(
      monotoneSignals().flatMap((sample) => [sample, sample, sample]),
    );
    expect(repeated.variation).toBe(monotone.variation);
    expect(repeated.throughput).toBe(monotone.throughput);
    const chunkRows = [1, 37, 1200].map((chunkSize) => ({
      chunkSize,
      ...accumulate(monotoneSignals(), chunkSize, true),
    }));
    for (const row of chunkRows)
      expect(row).toEqual({ chunkSize: row.chunkSize, ...monotone });

    const gapRows: object[] = [];
    const continuousBoundary = (() => {
      let low = 0;
      let high = 1;
      for (let iteration = 0; iteration < 80; iteration++) {
        const s = (low + high) / 2;
        if (s * s * (3 - 2 * s) < 1 - P) low = s;
        else high = s;
      }
      return 2 * (0.003 - 0.001 * ((low + high) / 2));
    })();
    const gaps = [
      0.004,
      continuousBoundary - 0.00005,
      continuousBoundary + 0.00005,
      0.006,
      0.00625,
      0.008,
    ];
    for (const dimension of [3, 4] as const)
      for (const gap of gaps)
        for (const delta of [0.002, 0.001, 0.0005, 0.00025, 0.000125]) {
          const phases = [0, 0.25, 0.5, 0.75].map((phase) => {
            const sampled = exactGapSamples(dimension, gap, delta, phase);
            const result = accumulate(sampled.samples);
            const drop = 1 - sampled.minimumGapSignal;
            const expectedVariation =
              drop >= P ? 2 - sampled.minimumGapSignal : 1;
            expect(result.variation).toBeCloseTo(expectedVariation, 10);
            return {
              phase,
              minimumGapSignal: sampled.minimumGapSignal,
              observedDrop: drop,
              classifiedLayers: drop >= P ? 2 : 1,
              variation: result.variation,
              throughput: result.throughput,
            };
          });
          gapRows.push({ dimension, gap, delta, phases });
        }

    const noiseRows = [0, 1, 16, 64].map((cycles) => {
      const sampleCount = 16384;
      const samples = Array.from({ length: sampleCount + 1 }, (_, index) => ({
        signal: clearanceLayerSignal(
          0.0025 +
            (cycles
              ? 0.00005 * Math.cos((2 * Math.PI * cycles * index) / sampleCount)
              : 0),
          1,
        ),
      }));
      return { cycles, ...accumulate(samples) };
    });
    expect(noiseRows[0].variation).toBeCloseTo(0.5, 12);
    for (const row of noiseRows.slice(1)) {
      expect(row.variation).toBeCloseTo(0.57475, 12);
      expect(row.throughput).toBeCloseTo(noiseRows[1].throughput, 12);
    }

    const oscillation = (low: number, high: number, cycles: number) =>
      accumulate(
        Array.from({ length: cycles }, () => [
          { signal: high },
          { signal: low },
        ])
          .flatMap((pair) => pair)
          .concat({ signal: high }),
      );
    const belowProminence = oscillation(0.4, 0.59, 64);
    // Subtracting zero gives the stored P exactly and pins the >= tie rule.
    const atProminence = oscillation(0, P, 4);
    const aboveProminence = oscillation(0.38, 0.59, 4);
    expect(belowProminence.variation).toBeCloseTo(0.59, 12);
    expect(atProminence.variation).toBeCloseTo(P + 4 * P, 12);
    expect(aboveProminence.variation).toBeCloseTo(0.59 + 4 * 0.21, 12);

    const scaleSignals = [-0.2, 0, 0.002, 0.0021, 0.0025, 0.0029, 0.003, 4];
    const scaleReference = accumulate(
      scaleSignals.map((distance) => ({
        signal: clearanceLayerSignal(distance, 1),
      })),
    );
    for (const scale of [0.25, 0.5, 2, 8])
      expect(
        accumulate(
          scaleSignals.map((distance) => ({
            signal: clearanceLayerSignal(distance * scale, scale),
          })),
        ),
      ).toEqual(scaleReference);

    const ownership = [3, 4].map((dimension) => {
      const d = dimension as 3 | 4;
      const frontOpaqueSamples = exactGapSamples(
        d,
        0.008,
        0.001,
        0,
        "front",
        "nearest-distance",
      );
      const clearRearSamples = exactGapSamples(
        d,
        0.008,
        0.001,
        0,
        "rear",
        "nearest-distance",
      );
      const shallowRearSamples = exactGapSamples(
        d,
        0.0044,
        0.0001,
        0,
        "rear",
        "nearest-distance",
      );
      const row = {
        dimension: d,
        frontOpaque: accumulate(frontOpaqueSamples.samples),
        clearGapOpaqueRear: accumulate(clearRearSamples.samples),
        shallowGapOpaqueRear: accumulate(shallowRearSamples.samples),
        unconditionedShallowGapOpaqueRear: accumulateUnconditioned(
          shallowRearSamples.samples,
        ),
        shallowGapMinimumSignal: shallowRearSamples.minimumGapSignal,
      };
      expect(row.frontOpaque.stoppedOwner).toBe("front");
      expect(row.clearGapOpaqueRear.stoppedOwner).toBe("rear");
      // A real second closed box is opaque, but its sub-P approach never emits
      // weight after the first box's higher crest, even when the rear owns the
      // approach by the same nearest-distance rule as fromSurfaces.
      expect(1 - row.shallowGapMinimumSignal).toBeLessThan(P);
      expect(row.shallowGapOpaqueRear.stoppedAt).toBeNull();
      expect(
        row.shallowGapOpaqueRear.opaqueSamplesWithoutWeight,
      ).toBeGreaterThan(0);
      expect(row.unconditionedShallowGapOpaqueRear.stoppedOwner).toBe("rear");
      return row;
    });

    const membershipOnlyMismatch = [3, 4].map((dimension) => {
      const d = dimension as 3 | 4;
      const front = exactGapSamples(d, 0.008, 0.001, 0, "front", "membership");
      const rear = exactGapSamples(d, 0.008, 0.001, 0, "rear", "membership");
      const row = {
        dimension: d,
        prominenceFront: accumulate(front.samples),
        prominenceRear: accumulate(rear.samples),
        unconditionedFront: accumulateUnconditioned(front.samples),
        unconditionedRear: accumulateUnconditioned(rear.samples),
      };
      for (const result of [
        row.prominenceFront,
        row.prominenceRear,
        row.unconditionedFront,
        row.unconditionedRear,
      ]) {
        expect(result.stoppedAt).toBeNull();
        expect(result.opaqueSamplesWithoutWeight).toBeGreaterThan(0);
      }
      return row;
    });

    expect(() =>
      prominenceFieldStep(initialProminenceFieldState(), NaN),
    ).toThrow();
    expect(() =>
      prominenceFieldStep(initialProminenceFieldState(), 0, { prominence: 0 }),
    ).toThrow();

    const report = {
      rule: {
        name: "prominence-conditioned positive variation",
        prominence: P,
        domain: "sampled smooth clearance signal; not membership",
      },
      verdict: {
        status: "REFUSED",
        reason:
          "Under the fromSurfaces nearest-distance material contract, a sub-prominence shallow gap suppresses all weight on the rear approach, so a real opaque rear surface loses ownership.",
      },
      monotone: summarize(monotone),
      chunkRows: chunkRows.map(({ chunkSize, ...row }) => ({
        chunkSize,
        ...summarize(row),
      })),
      continuousGapBoundary: continuousBoundary,
      gapRows,
      noiseRows: noiseRows.map(({ cycles, ...row }) => ({
        cycles,
        ...summarize(row),
      })),
      prominenceControls: {
        below: summarize(belowProminence),
        at: summarize(atProminence),
        above: summarize(aboveProminence),
      },
      scaleReference: summarize(scaleReference),
      ownership: ownership.map((row) => ({
        materialSupport: "nearest interval distance; deterministic ties front",
        dimension: row.dimension,
        frontOpaque: summarize(row.frontOpaque),
        clearGapOpaqueRear: summarize(row.clearGapOpaqueRear),
        shallowGapOpaqueRear: summarize(row.shallowGapOpaqueRear),
        unconditionedShallowGapOpaqueRear:
          row.unconditionedShallowGapOpaqueRear,
        shallowGapMinimumSignal: row.shallowGapMinimumSignal,
      })),
      membershipOnlyContractMismatch: membershipOnlyMismatch.map((row) => ({
        materialSupport:
          "closed-solid membership only; unlike fromSurfaces clearance attribution",
        ...row,
        prominenceFront: summarize(row.prominenceFront),
        prominenceRear: summarize(row.prominenceRear),
      })),
      limitations: [
        "No true membership or safe sample skipping follows from this rule.",
        "Sub-prominence real layers can merge; estimator oscillations at or above the prominence can still accumulate.",
        "Gap minima and the prominence comparison remain lattice-phase and f32-boundary sensitive.",
        "Membership-only material support misses outside-band optical weight under both prominence and the unconditioned baseline; it is not evidence specific to prominence or the fromSurfaces contract.",
      ],
    };
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-prominence-field-report.json",
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify({ transmissionProminenceField: report }));
  });
});
