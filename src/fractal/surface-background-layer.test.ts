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
  sampleTraceBackground,
  sampleTraceBackgroundImage,
  snapshotTraceBackground,
  surfaceBackgroundWeight,
  traceBackgroundsEqual,
} from "./surface-background-layer";
import type {
  SurfaceBackgroundLayerBytes,
  TraceBackgroundImage,
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

/** Top row red/green, bottom row blue/white — deliberately asymmetric so a
 * Surface-v/ImageData-y flip cannot hide. */
const cornerImage = (revision = 1): TraceBackgroundImage => ({
  width: 2,
  height: 2,
  rgba: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]),
  revision,
});

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

  it("encodes signed circle of confusion with an exact focal byte", () => {
    expect(encodeSurfaceBackgroundLayer(1, 0, 0, -1)[3]).toBe(1);
    expect(encodeSurfaceBackgroundLayer(1, 0, 0, 0)[3]).toBe(128);
    expect(encodeSurfaceBackgroundLayer(1, 0, 0, 1)[3]).toBe(255);
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
      circleOfConfusion: 1,
    });
  });

  it("decodes the focal CoC byte to zero", () => {
    expect(
      decodeSurfaceBackgroundLayer(new Uint8Array([255, 0, 0, 128]))
        .circleOfConfusion,
    ).toBe(0);
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

  it("uses immutable image content identity and revision instead of ignored fallback stops", () => {
    const image = cornerImage();
    const a: TraceBackgroundSpec = {
      ...uniformBackground([0, 0, 0]),
      image,
    };
    const sameContent: TraceBackgroundSpec = {
      ...uniformBackground([1, 1, 1]),
      image: { ...image },
    };
    expect(traceBackgroundsEqual(a, sameContent)).toBe(true);
    expect(
      traceBackgroundsEqual(a, {
        ...sameContent,
        image: { ...image, revision: image.revision + 1 },
      }),
    ).toBe(false);
    expect(
      traceBackgroundsEqual(a, {
        ...sameContent,
        image: { ...image, rgba: image.rgba.slice() },
      }),
    ).toBe(false);
    expect(traceBackgroundsEqual(a, uniformBackground([0, 0, 0]))).toBe(false);
    expect(snapshotTraceBackground(a).image).toBe(image);
  });
});

describe("Surface image background sampling", () => {
  it("maps bottom-origin Surface UV to top-origin ImageData rows", () => {
    const image = cornerImage();
    expect(sampleTraceBackgroundImage(image, 0.25, 0.75)).toEqual([1, 0, 0]);
    expect(sampleTraceBackgroundImage(image, 0.75, 0.75)).toEqual([0, 1, 0]);
    expect(sampleTraceBackgroundImage(image, 0.25, 0.25)).toEqual([0, 0, 1]);
    expect(sampleTraceBackgroundImage(image, 0.75, 0.25)).toEqual([1, 1, 1]);
  });

  it("matches clamp-to-edge bilinear texture filtering", () => {
    const image = cornerImage();
    expect(sampleTraceBackgroundImage(image, 0.5, 0.5)).toEqual([
      0.5, 0.5, 0.5,
    ]);
    expect(sampleTraceBackgroundImage(image, -4, 0.75)).toEqual([1, 0, 0]);
    expect(sampleTraceBackgroundImage(image, 4, 0.25)).toEqual([1, 1, 1]);
  });

  it("dispatches the unified sampler between image and gradient sources", () => {
    const gradient = uniformBackground([0.2, 0.3, 0.4]);
    expect(sampleTraceBackground(gradient, 0.1, 0.9)).toEqual([0.2, 0.3, 0.4]);
    expect(
      sampleTraceBackground({ ...gradient, image: cornerImage() }, 0.25, 0.75),
    ).toEqual([1, 0, 0]);
  });

  it("rejects malformed immutable image records", () => {
    expect(() =>
      sampleTraceBackgroundImage(
        { width: 2, height: 2, rgba: new Uint8Array(4), revision: 1 },
        0.5,
        0.5,
      ),
    ).toThrow(/RGBA length/);
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

  it("can pack the CoC byte into capture alpha without changing RGB", () => {
    const background = uniformBackground([0.2, 0.3, 0.4]);
    const out = compositeSurfaceBackgroundLayer({
      width: 2,
      height: 1,
      legacyRgba: new Uint8Array([13, 72, 201, 0, 255, 4, 99, 0]),
      layerRgba: new Uint8Array([
        ...encodeSurfaceBackgroundLayer(1, 0, 0, -0.5),
        ...encodeSurfaceBackgroundLayer(1, 0, 0, 0.25),
      ]),
      referenceBackground: snapshotTraceBackground(background),
      liveBackground: background,
      outputAlpha: "circle-of-confusion",
    });
    expect(Array.from(out)).toEqual([13, 72, 201, 65, 255, 4, 99, 160]);
  });

  it("reserves capture alpha 255 for uncovered pixels", () => {
    const background = uniformBackground([0, 0, 0]);
    const out = compositeSurfaceBackgroundLayer({
      width: 2,
      height: 1,
      legacyRgba: new Uint8Array(8),
      layerRgba: new Uint8Array([
        ...encodeSurfaceBackgroundLayer(1, 0, 0, 1),
        ...encodeSurfaceBackgroundLayer(0, 0, 0),
      ]),
      referenceBackground: snapshotTraceBackground(background),
      liveBackground: background,
      outputAlpha: "circle-of-confusion",
    });
    expect(out[3]).toBe(254);
    expect(out[7]).toBe(255);
  });

  it("direct-copies when immutable image identity and revision are unchanged", () => {
    const image = cornerImage(7);
    const reference: TraceBackgroundSpec = {
      ...uniformBackground([0, 0, 0]),
      image,
    };
    const legacy = new Uint8Array([13, 72, 201, 0]);
    const out = compositeSurfaceBackgroundLayer({
      width: 1,
      height: 1,
      legacyRgba: legacy,
      layerRgba: repeatLayer(encodeSurfaceBackgroundLayer(0, 0, 0), 1),
      referenceBackground: reference,
      liveBackground: {
        ...uniformBackground([1, 1, 1]),
        image: { ...image },
      },
    });
    expect(Array.from(out)).toEqual([13, 72, 201, 255]);
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

  it("replaces gradient misses with a bottom-origin view of a top-origin image", () => {
    const reference = uniformBackground([0, 0, 0]);
    const out = compositeSurfaceBackgroundLayer({
      width: 2,
      height: 2,
      legacyRgba: new Uint8Array(16),
      layerRgba: repeatLayer(encodeSurfaceBackgroundLayer(0, 0, 0), 4),
      referenceBackground: reference,
      liveBackground: { ...reference, image: cornerImage() },
    });
    // Surface row zero is bottom: blue/white, followed by top-row red/green.
    expect(Array.from(out)).toEqual([
      0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255,
    ]);
  });

  it("samples an image reference as well as an image live source", () => {
    const reference: TraceBackgroundSpec = {
      ...uniformBackground([0, 0, 0]),
      image: cornerImage(),
    };
    const out = compositeSurfaceBackgroundLayer({
      width: 2,
      height: 2,
      // The reference image in Surface's bottom-origin row order.
      legacyRgba: new Uint8Array([
        0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255,
      ]),
      layerRgba: repeatLayer(encodeSurfaceBackgroundLayer(0, 0, 0), 4),
      referenceBackground: reference,
      liveBackground: uniformBackground([1, 1, 1]),
    });
    expect(Array.from(out)).toEqual(new Array(16).fill(255));
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

  it("documents the changed-background byte rounding boundary", () => {
    const reference = uniformBackground([0.1, 0.1, 0.1]);
    const live = uniformBackground([0.2, 0.2, 0.2]);
    const changed = compositeSurfaceBackgroundLayer({
      width: 1,
      height: 1,
      legacyRgba: new Uint8Array([26, 26, 26, 255]),
      layerRgba: repeatLayer(encodeSurfaceBackgroundLayer(0, 0, 0), 1),
      referenceBackground: reference,
      liveBackground: live,
    });

    // beta's direct-background algebra is exact before storage, but legacy
    // RGB and beta have already crossed independent RGBA8 roundings. A fresh
    // trace quantizes the live stop once and therefore lands one byte lower.
    expect(Array.from(changed)).toEqual([52, 52, 52, 255]);
    expect(quantize(0.2)).toBe(51);
  });

  it("documents that averaged beta cannot reproduce the linear-light supersample fold", () => {
    const reference = uniformBackground([0.2, 0.2, 0.2]);
    const live = uniformBackground([0.4, 0.4, 0.4]);
    const compositeSample = (
      legacyByte: number,
      layer: SurfaceBackgroundLayerBytes,
    ): number =>
      compositeSurfaceBackgroundLayer({
        width: 1,
        height: 1,
        legacyRgba: new Uint8Array([legacyByte, legacyByte, legacyByte, 255]),
        layerRgba: new Uint8Array(layer),
        referenceBackground: reference,
        liveBackground: live,
      })[0];
    const linearMeanByte = (bytes: readonly number[]): number =>
      quantize(
        Math.pow(
          bytes.reduce((sum, byte) => sum + Math.pow(byte / 255, 2.2), 0) /
            bytes.length,
          1 / 2.2,
        ),
      );

    // Two sub-pixel samples: uncovered dark backdrop and an opaque bright hit.
    // Exact changed-background semantics composite each sample before the
    // existing gamma-decode/linear-mean/gamma-encode fold.
    const exactMean = linearMeanByte([
      compositeSample(51, encodeSurfaceBackgroundLayer(0, 0, 0)),
      compositeSample(204, encodeSurfaceBackgroundLayer(1, 0, 0)),
    ]);

    // The shipped retained frame instead has the already-folded RGB and only
    // the arithmetic mean of beta. Run that representation through the real
    // compositor: this is the documented approximation, not a replacement
    // algorithm hidden in the test.
    const foldedLegacy = linearMeanByte([51, 204]);
    const averagedBeta = compositeSample(
      foldedLegacy,
      encodeSurfaceBackgroundLayer(0.5, 0, 0),
    );

    expect(exactMean).toBe(163);
    expect(averagedBeta).toBe(178);
    expect(averagedBeta).not.toBe(exactMean);
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

  it("samples one image across capture bands instead of repeating it per band", () => {
    const width = 4;
    const height = 7;
    const bandBottom = 3;
    const bandHeight = 2;
    const reference = uniformBackground([0, 0, 0]);
    const live: TraceBackgroundSpec = { ...reference, image: cornerImage() };
    const legacy = new Uint8Array(width * height * 4);
    const layers = repeatLayer(
      encodeSurfaceBackgroundLayer(0, 0, 0),
      width * height,
    );
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
