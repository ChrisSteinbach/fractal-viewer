/** Scalar analytic controls for fractional layer weight, not another marcher. */
import { mkdirSync, writeFileSync } from "node:fs";
import { boxUnionIntervals } from "./transmission-proxy";
import {
  clearanceLayerSignal,
  layerOpticalIncrement,
  layerThroughput,
} from "./transmission-layer-field";

const TAU = 0.864;

function accumulate(signals: readonly number[], chunkSize = signals.length) {
  let previous = 0;
  let variation = 0;
  let throughput = 1;
  for (let start = 0; start < signals.length; start += chunkSize) {
    for (const signal of signals.slice(start, start + chunkSize)) {
      const increment = layerOpticalIncrement(previous, signal);
      variation += increment;
      throughput *= layerThroughput(TAU, increment);
      previous = signal;
    }
  }
  return { variation, throughput, previous };
}

/** This chosen central ray is parallel to the boxes' z axis and inside every
 * transverse slab, including the native fourth inequality. Its distance to
 * the interval union is therefore the exact unsigned distance to the boxes
 * along the ray. This does not infer a general DE or generic membership. */
function exactGapSignal(dimension: 3 | 4, gap: number) {
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
  return (t: number) => {
    const distance = Math.min(
      ...intervals.map(({ enter, exit }) => Math.max(enter - t, t - exit, 0)),
    );
    return clearanceLayerSignal(distance, 1);
  };
}

function sampledGap(
  dimension: 3 | 4,
  gap: number,
  delta: number,
  phase: number,
) {
  const signal = exactGapSignal(dimension, gap);
  const first = 2 + phase * delta;
  const count = Math.ceil((4 - first) / delta);
  return accumulate(
    Array.from({ length: count }, (_, i) => signal(first + i * delta)),
  );
}

describe("Smooth transmission layer field", () => {
  it("counts an approach once and adds nothing on a plateau or outward exit", () => {
    const signals = [
      0,
      clearanceLayerSignal(0.00275, 1),
      clearanceLayerSignal(0.0025, 1),
      clearanceLayerSignal(0.00225, 1),
      ...Array<number>(1000).fill(1),
      clearanceLayerSignal(0.0025, 1),
      0,
    ];
    const result = accumulate(signals);
    expect(result.variation).toBeCloseTo(1, 12);
    expect(result.throughput).toBeCloseTo(TAU, 12);
    // Repeating identical spatial samples cannot manufacture density.
    expect(accumulate(signals.flatMap((s) => [s, s, s]))).toEqual(result);
    for (const chunk of [1, 37, 1200])
      expect(accumulate(signals, chunk)).toEqual(result);
    expect(layerThroughput(0, 0)).toBe(1);
    expect(layerThroughput(0, 0.00001)).toBe(0);
  });

  it("measures gap phase error against independent exact 3D and posed 4D solids", () => {
    const rows: object[] = [];
    for (const dimension of [3, 4] as const) {
      for (const gap of [0.004, 0.006, 0.00625, 0.008]) {
        const exactVariation = 2 - clearanceLayerSignal(gap / 2, 1);
        let previousNestedVariation = 0;
        for (const delta of [0.002, 0.001, 0.0005, 0.00025, 0.000125]) {
          const phases = [0, 0.25, 0.5, 0.75].map((phase) => ({
            phase,
            ...sampledGap(dimension, gap, delta, phase),
          }));
          // Nested partitions cannot lose positive variation on this exact
          // field. Different phases are deliberately NOT claimed identical.
          expect(phases[0].variation + 1e-10).toBeGreaterThanOrEqual(
            previousNestedVariation,
          );
          previousNestedVariation = phases[0].variation;
          for (const result of phases)
            expect(result.variation).toBeLessThanOrEqual(
              exactVariation + 1e-10,
            );
          rows.push({
            dimension,
            gap,
            delta,
            exactVariation,
            exactThroughput: TAU ** exactVariation,
            phaseThroughputRange:
              Math.max(...phases.map((p) => p.throughput)) -
              Math.min(...phases.map((p) => p.throughput)),
            phases,
          });
        }
      }
    }
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-layer-field-report.json",
      JSON.stringify(rows, null, 2),
    );
    console.log(JSON.stringify({ gapRows: rows }));
  });

  it("exposes additional opacity from fixed-amplitude spatial noise", () => {
    const rows = [0, 1, 16, 64].map((cycles) => {
      const samples = 16384;
      const signals = Array.from({ length: samples + 1 }, (_, i) =>
        clearanceLayerSignal(
          0.0025 +
            (cycles
              ? 0.00005 * Math.cos((2 * Math.PI * cycles * i) / samples)
              : 0),
          1,
        ),
      );
      return { cycles, ...accumulate(signals) };
    });
    expect(rows[0].variation).toBeCloseTo(0.5, 12);
    expect(rows[3].variation).toBeGreaterThan(9);
    expect(rows[3].throughput).toBeLessThan(rows[0].throughput / 2);
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-layer-noise-report.json",
      JSON.stringify(rows, null, 2),
    );
    console.log(JSON.stringify({ noiseRows: rows }));
  });

  it("keeps the normalized field under scene scaling and rejects invalid optics", () => {
    for (const d of [-0.2, 0, 0.002, 0.0021, 0.0025, 0.0029, 0.003, 4])
      expect(clearanceLayerSignal(2 * d, 2)).toBe(clearanceLayerSignal(d, 1));
    for (const tau of [-1, 1.1, NaN, Infinity])
      expect(() => layerThroughput(tau, 1)).toThrow();
    expect(() => clearanceLayerSignal(NaN, 1)).toThrow();
    expect(() => clearanceLayerSignal(0, 0)).toThrow();
    expect(() => layerOpticalIncrement(0, NaN)).toThrow();
  });
});
