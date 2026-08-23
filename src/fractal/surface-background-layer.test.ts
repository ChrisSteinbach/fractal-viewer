import {
  backgroundColorAt,
  backgroundImageUv,
  backgroundRadialScale,
} from "./background-shape";
import type { BackgroundStops } from "./background-shape";
import {
  compositeSurfaceBackgroundLayer,
  decodeSurfaceBackgroundLayer,
  encodeSurfaceBackgroundLayer,
  snapshotTraceBackground,
  surfaceBackgroundWeight,
  traceBackgroundsEqual,
} from "./surface-background-layer";
import type {
  SurfaceBackgroundLayerBytes,
  TraceBackgroundSpec,
} from "./surface-background-layer";

const uniformBackground = (
  rgb: readonly [number, number, number],
): TraceBackgroundSpec => ({
  stops: { top: rgb, bottom: rgb },
  shape: { kind: "linear" },
});

const repeatLayer = (
  pixel: SurfaceBackgroundLayerBytes,
  count: number,
): Uint8Array => {
  const bytes = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) bytes.set(pixel, i * 4);
  return bytes;
};

const quantize = (channel: number): number =>
  Math.floor(Math.max(0, Math.min(1, channel)) * 255 + 0.5);

describe("surface background layer encoding", () => {
  it("encodes a miss as full background weight", () => {
    expect(encodeSurfaceBackgroundLayer(0, 0, 0.7)).toEqual([0, 0, 255, 255]);
  });

  it("encodes an unfogged hit with no background weight", () => {
    expect(encodeSurfaceBackgroundLayer(1, 0, 0.3)).toEqual([255, 0, 0, 255]);
  });

  it("keeps the uncovered share for fractional ground coverage", () => {
    expect(surfaceBackgroundWeight(0.5, 0, 0.9)).toBe(0.5);
    expect(encodeSurfaceBackgroundLayer(0.5, 0, 0.9)).toEqual([
      128, 0, 128, 255,
    ]);
  });

  it("includes only the untinted share of fog under surface coverage", () => {
    // beta = 1 - 0.5 + 0.5 * 0.4 * (1 - 0.25) = 0.65.
    expect(surfaceBackgroundWeight(0.5, 0.4, 0.25)).toBeCloseTo(0.65, 14);
    expect(encodeSurfaceBackgroundLayer(0.5, 0.4, 0.25)).toEqual([
      128, 102, 166, 255,
    ]);
  });

  it("decodes coverage, fog, and background weight from the named bytes", () => {
    const decoded = decodeSurfaceBackgroundLayer(
      new Uint8Array([9, 8, 7, 6, 64, 128, 192, 255]),
      4,
    );
    expect(decoded).toEqual({
      coverage: 64 / 255,
      fog: 128 / 255,
      backgroundWeight: 192 / 255,
    });
  });
});

describe("trace background references", () => {
  it("snapshots stop and radial geometry arrays by value", () => {
    const top: [number, number, number] = [0.1, 0.2, 0.3];
    const center: [number, number] = [0.4, 0.6];
    const source: TraceBackgroundSpec = {
      stops: { top, bottom: [0.7, 0.8, 0.9] },
      shape: { kind: "radial", center, scale: [1.2, 0.8] },
    };
    const reference = snapshotTraceBackground(source);
    top[0] = 1;
    center[0] = 1;
    expect(reference.stops.top).toEqual([0.1, 0.2, 0.3]);
    expect(reference.shape.center).toEqual([0.4, 0.6]);
  });

  it("uses exact stop/shape equality and resolves radial defaults exactly", () => {
    const a: TraceBackgroundSpec = {
      stops: { top: [0.1, 0.2, 0.3], bottom: [0.4, 0.5, 0.6] },
      shape: { kind: "radial" },
    };
    const same: TraceBackgroundSpec = {
      stops: { top: [0.1, 0.2, 0.3], bottom: [0.4, 0.5, 0.6] },
      shape: { kind: "radial", center: [0.5, 0.5], scale: [1, 1] },
    };
    expect(traceBackgroundsEqual(a, same)).toBe(true);
    expect(
      traceBackgroundsEqual(a, {
        ...same,
        stops: { ...same.stops, top: [0.1, 0.2, 0.3000000000001] },
      }),
    ).toBe(false);
    expect(
      traceBackgroundsEqual(a, {
        ...same,
        shape: { ...same.shape, center: [0.5000000000001, 0.5] },
      }),
    ).toBe(false);
  });

  it("ignores center and scale for a linear shape that never reads them", () => {
    const stops: BackgroundStops = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.4, 0.5, 0.6],
    };
    expect(
      traceBackgroundsEqual(
        { stops, shape: { kind: "linear" } },
        {
          stops,
          shape: { kind: "linear", center: [0, 1], scale: [9, 2] },
        },
      ),
    ).toBe(true);
  });
});

describe("compositeSurfaceBackgroundLayer", () => {
  it("direct-copies legacy RGB when backgrounds are equal and forces opaque alpha", () => {
    const background = uniformBackground([0.2, 0.3, 0.4]);
    const legacy = new Uint8Array([13, 72, 201, 0, 255, 4, 99, 128]);
    const out = compositeSurfaceBackgroundLayer({
      width: 2,
      height: 1,
      legacyRgba: legacy,
      layerRgba: repeatLayer(encodeSurfaceBackgroundLayer(0.5, 0.5, 0.5), 2),
      referenceBackground: snapshotTraceBackground(background),
      liveBackground: background,
    });
    expect(Array.from(out)).toEqual([13, 72, 201, 255, 255, 4, 99, 255]);
  });

  it("replaces a miss's reference background with the live background", () => {
    const reference = uniformBackground([51 / 255, 76 / 255, 102 / 255]);
    const live = uniformBackground([102 / 255, 153 / 255, 204 / 255]);
    const out = compositeSurfaceBackgroundLayer({
      width: 1,
      height: 1,
      legacyRgba: new Uint8Array([51, 76, 102, 0]),
      layerRgba: repeatLayer(encodeSurfaceBackgroundLayer(0, 0, 0), 1),
      referenceBackground: reference,
      liveBackground: live,
    });
    expect(Array.from(out)).toEqual([102, 153, 204, 255]);
  });

  it("leaves a fully covered, unfogged hit unchanged", () => {
    const out = compositeSurfaceBackgroundLayer({
      width: 1,
      height: 1,
      legacyRgba: new Uint8Array([220, 60, 17, 128]),
      layerRgba: repeatLayer(encodeSurfaceBackgroundLayer(1, 0, 0.4), 1),
      referenceBackground: uniformBackground([0.1, 0.2, 0.3]),
      liveBackground: uniformBackground([0.8, 0.7, 0.6]),
    });
    expect(Array.from(out)).toEqual([220, 60, 17, 255]);
  });

  it("uses the encoded fractional/fog background weight", () => {
    const layer = encodeSurfaceBackgroundLayer(0.5, 0.4, 0.25);
    expect(layer[2]).toBe(166);
    const out = compositeSurfaceBackgroundLayer({
      width: 1,
      height: 1,
      legacyRgba: new Uint8Array([100, 110, 120, 255]),
      layerRgba: repeatLayer(layer, 1),
      referenceBackground: uniformBackground([0.2, 0.3, 0.4]),
      liveBackground: uniformBackground([0.6, 0.1, 0.9]),
    });
    const beta = 166 / 255;
    expect(Array.from(out)).toEqual([
      quantize(100 / 255 + beta * (0.6 - 0.2)),
      quantize(110 / 255 + beta * (0.1 - 0.3)),
      quantize(120 / 255 + beta * (0.9 - 0.4)),
      255,
    ]);
  });

  it("evaluates changed radial shapes at full-image pixel centers", () => {
    const width = 3;
    const height = 3;
    const stops: BackgroundStops = {
      top: [0.8, 0.6, 0.4],
      bottom: [0.2, 0.1, 0.05],
    };
    const reference: TraceBackgroundSpec = {
      stops,
      shape: { kind: "linear" },
    };
    const live: TraceBackgroundSpec = {
      stops,
      shape: {
        kind: "radial",
        center: [0.5, 0.5],
        scale: backgroundRadialScale(width, height),
      },
    };
    const legacy = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        const [u, v] = backgroundImageUv(x, y, [0, 0], [width, height]);
        const rgb = backgroundColorAt(u, v, stops, reference.shape);
        legacy[p] = quantize(rgb[0]);
        legacy[p + 1] = quantize(rgb[1]);
        legacy[p + 2] = quantize(rgb[2]);
      }
    }
    const out = compositeSurfaceBackgroundLayer({
      width,
      height,
      legacyRgba: legacy,
      layerRgba: repeatLayer(encodeSurfaceBackgroundLayer(0, 0, 0), 9),
      referenceBackground: reference,
      liveBackground: live,
    });
    const center = (1 * width + 1) * 4;
    const corner = 0;
    const referenceCenter = backgroundColorAt(
      0.5,
      0.5,
      stops,
      reference.shape,
    )[0];
    const liveCenter = backgroundColorAt(0.5, 0.5, stops, live.shape)[0];
    expect(out[center]).toBe(
      quantize(legacy[center] / 255 + (liveCenter - referenceCenter)),
    );
    expect(out[corner]).toBeGreaterThan(out[center]);
    expect(out[corner + 3]).toBe(255);
  });

  it("assembles capture bands byte-identically to one full-image composite", () => {
    const width = 4;
    const height = 7;
    const bandBottom = 2;
    const bandHeight = 3;
    const reference: TraceBackgroundSpec = {
      stops: { top: [0.12, 0.28, 0.5], bottom: [0.6, 0.4, 0.2] },
      shape: {
        kind: "radial",
        center: [0.5, 0.5],
        scale: backgroundRadialScale(width, height),
      },
    };
    const live: TraceBackgroundSpec = {
      stops: { top: [0.2, 0.1, 0.6], bottom: [0.7, 0.3, 0.05] },
      shape: reference.shape,
    };
    const legacy = new Uint8Array(width * height * 4);
    const layers = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        legacy.set([31 + x * 7, 57 + y * 5, 100 + x + y, y], p);
        layers.set(encodeSurfaceBackgroundLayer((x + y) / 10, y / 8, 0.3), p);
      }
    }
    const full = compositeSurfaceBackgroundLayer({
      width,
      height,
      legacyRgba: legacy,
      layerRgba: layers,
      referenceBackground: reference,
      liveBackground: live,
    });
    const start = bandBottom * width * 4;
    const end = start + bandHeight * width * 4;
    const band = compositeSurfaceBackgroundLayer({
      width,
      height: bandHeight,
      legacyRgba: legacy.slice(start, end),
      layerRgba: layers.slice(start, end),
      referenceBackground: reference,
      liveBackground: live,
      traceOffset: [0, bandBottom],
      traceExtent: [width, height],
    });
    expect(band).toEqual(full.slice(start, end));
  });
});
