/**
 * Pins crop-local bend panels to the untiled full-image reference. Tiling is
 * scheduling only: renderPreview still derives every ray from fullSize and
 * renderBentTransmission retains its global sphere-entry sample lattice.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *   scripts/transmission-bend-tiles.harness.ts --disableConsoleIntercept
 */
import type { PreviewRegion, Vec3 } from "./de-preview";
import { renderBentTransmission } from "./transmission-bend-study";
import type {
  BendFixture,
  BendOptions,
  BendPanel,
} from "./transmission-bend-study";
import {
  BEND_REFERENCE_OPTIONS,
  createBendVisualFixture,
  proceduralFloor,
} from "./transmission-bend-fixtures";

const fixture: BendFixture = {
  name: "TILE EQUALITY UNSIGNED SPHERE",
  scene: {
    de: (p) =>
      Math.abs(Math.hypot(p[0] + 0.09, p[1] - 0.04, p[2] - 0.23) - 0.51),
    boundingRadius: 1.25,
    stepScale: 1,
    eye: [0.15, 0.08, 3.1],
    target: [0, 0, 0],
    zoom: 0.37,
  },
  material: () => ({ label: "front", color: [0.1, 0.78, 0.96] }),
};

const options: BendOptions = {
  transmit: 0.9,
  ior: 1.45,
  slabFraction: 0.08,
  maxOffsetFraction: 0.08,
  opticalNormalFraction: 0.04,
  bendOnset: "weighted",
  maxLayers: 128,
  chunkSteps: 37,
  maxSamples: 4096,
  residualTolerance: 0,
  terminalRadiance: (origin, _rd, py, size): Vec3 => [
    0.03 + 0.02 * origin[0],
    0.04 + 0.08 * ((py + 0.5) / size),
    0.09,
  ],
};

function regions(size: number): PreviewRegion[] {
  const splitX = Math.floor(size / 3);
  const splitY = Math.floor((size * 2) / 5);
  return [
    { x: 0, y: 0, width: splitX, height: splitY },
    { x: splitX, y: 0, width: size - splitX, height: splitY },
    { x: 0, y: splitY, width: splitX, height: size - splitY },
    {
      x: splitX,
      y: splitY,
      width: size - splitX,
      height: size - splitY,
    },
  ];
}

function stitch<
  T extends Uint8Array | Uint16Array | Uint32Array | Float64Array,
>(
  size: number,
  tiles: readonly { region: PreviewRegion; panel: BendPanel }[],
  select: (panel: BendPanel) => T,
  channels = 1,
): T {
  const first = select(tiles[0].panel);
  const TypedArray = first.constructor as new (length: number) => T;
  const output = new TypedArray(size * size * channels);
  for (const { region, panel } of tiles) {
    const source = select(panel);
    for (let row = 0; row < region.height; row++) {
      const sourceStart = row * region.width * channels;
      const targetStart = ((region.y + row) * size + region.x) * channels;
      output.set(
        source.subarray(sourceStart, sourceStart + region.width * channels),
        targetStart,
      );
    }
  }
  return output;
}

function sumRecord(records: readonly Record<string, number>[]) {
  const result: Record<string, number> = {};
  for (const record of records)
    for (const [key, value] of Object.entries(record))
      result[key] = (result[key] ?? 0) + value;
  return result;
}

describe("bend transmission regions", () => {
  for (const [size, chunkSteps] of [
    [33, 1],
    [33, 37],
    [48, 1200],
  ] as const) {
    it(`is exact for irregular tiles at full size ${size}, chunk ${chunkSteps}`, () => {
      const runOptions = { ...options, chunkSteps, maxChunks: 5000 };
      const full = renderBentTransmission(fixture, size, runOptions);
      const tiles = regions(size).map((region) => ({
        region,
        panel: renderBentTransmission(fixture, size, runOptions, region),
      }));
      expect(stitch(size, tiles, (panel) => panel.stats.rgb, 3)).toEqual(
        full.stats.rgb,
      );
      expect(stitch(size, tiles, (panel) => panel.rearMask)).toEqual(
        full.rearMask,
      );
      expect(stitch(size, tiles, (panel) => panel.frontThenGuardMask)).toEqual(
        full.frontThenGuardMask,
      );
      expect(stitch(size, tiles, (panel) => panel.bendMask)).toEqual(
        full.bendMask,
      );
      expect(stitch(size, tiles, (panel) => panel.variation)).toEqual(
        full.variation,
      );
      expect(stitch(size, tiles, (panel) => panel.bendStrength)).toEqual(
        full.bendStrength,
      );
      expect(stitch(size, tiles, (panel) => panel.throughput)).toEqual(
        full.throughput,
      );
      expect(stitch(size, tiles, (panel) => panel.eventCounts)).toEqual(
        full.eventCounts,
      );
      expect(stitch(size, tiles, (panel) => panel.sampleCounts)).toEqual(
        full.sampleCounts,
      );

      for (const key of ["hits", "evals", "steps", "exhausted"] as const)
        expect(
          tiles.reduce((sum, tile) => sum + tile.panel.stats[key], 0),
        ).toBe(full.stats[key]);
      expect(tiles.reduce((sum, tile) => sum + tile.panel.calls, 0)).toBe(
        full.calls,
      );
      expect(
        sumRecord(tiles.map((tile) => tile.panel.attributionCounts)),
      ).toEqual(full.attributionCounts);
      expect(sumRecord(tiles.map((tile) => tile.panel.termination))).toEqual(
        full.termination,
      );
      for (const key of [
        "field",
        "outsideDomainGrid",
        "opticalNormal",
        "shade",
        "attribution",
        "opaqueControl",
        "terminal",
      ] as const)
        expect(tiles.reduce((sum, tile) => sum + tile.panel.work[key], 0)).toBe(
          full.work[key],
        );
      expect(Math.max(...tiles.map((tile) => tile.panel.work.chunks))).toBe(
        full.work.chunks,
      );
      expect(Math.max(...tiles.map((tile) => tile.panel.work.worstRay))).toBe(
        full.work.worstRay,
      );
      for (const key of [
        "bentPixels",
        "reversalStops",
        "offsetLimitedPixels",
      ] as const)
        expect(
          tiles.reduce((sum, tile) => sum + tile.panel.bending[key], 0),
        ).toBe(full.bending[key]);
      expect(
        Math.max(
          ...tiles.map((tile) => tile.panel.bending.maximumLateralFraction),
        ),
      ).toBe(full.bending.maximumLateralFraction);
      const tiledMean =
        tiles.reduce(
          (sum, tile) =>
            sum +
            tile.panel.bending.meanStrength *
              tile.region.width *
              tile.region.height,
          0,
        ) /
        (size * size);
      expect(tiledMean).toBeCloseTo(full.bending.meanStrength, 15);
    });
  }

  it("is exact for the posed native 4D fixture with straight and weighted rays", () => {
    const size = 17;
    const native4 = createBendVisualFixture("native4");
    for (const bendOnset of ["none", "weighted"] as const) {
      const runOptions: BendOptions = {
        ...BEND_REFERENCE_OPTIONS,
        bendOnset,
        chunkSteps: 37,
        maxChunks: 5000,
        terminalRadiance: proceduralFloor(native4.scene.boundingRadius),
      };
      const full = renderBentTransmission(native4, size, runOptions);
      const tiles = regions(size).map((region) => ({
        region,
        panel: renderBentTransmission(native4, size, runOptions, region),
      }));
      expect(full.unresolved).toBe(0);
      expect(tiles.every((tile) => tile.panel.unresolved === 0)).toBe(true);
      expect(stitch(size, tiles, (panel) => panel.stats.rgb, 3)).toEqual(
        full.stats.rgb,
      );
      expect(stitch(size, tiles, (panel) => panel.bendMask)).toEqual(
        full.bendMask,
      );
      expect(stitch(size, tiles, (panel) => panel.variation)).toEqual(
        full.variation,
      );
      expect(stitch(size, tiles, (panel) => panel.bendStrength)).toEqual(
        full.bendStrength,
      );
      expect(stitch(size, tiles, (panel) => panel.throughput)).toEqual(
        full.throughput,
      );
      expect(stitch(size, tiles, (panel) => panel.eventCounts)).toEqual(
        full.eventCounts,
      );
      expect(stitch(size, tiles, (panel) => panel.sampleCounts)).toEqual(
        full.sampleCounts,
      );
    }
  });
});
