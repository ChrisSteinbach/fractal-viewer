/**
 * Pure host mirror for the Surface tracer's separately stored background
 * layer. The tracer keeps its legacy, already-quantized RGB alongside one
 * RGBA8 sidecar texel:
 *
 *   R = fractional surface coverage
 *   G = clamped fog amount
 *   B = surviving background weight (beta)
 *   A = signed circle of confusion, encoded from -1..1 with 128 = focus
 *
 * A background-only edit can then preserve the expensive trace and replace
 * just the background contribution:
 *
 *   changed = legacy + beta * (liveBackground - traceBackground)
 *
 * When the two background specs are exactly equal, RGB takes a byte-copy
 * path. That path is load-bearing for byte-identical default renders: it
 * avoids decoding and re-encoding an image whose background did not change.
 * The returned host image is always opaque; sidecar coverage must never
 * become canvas alpha.
 *
 * The exact/approximate boundary and the rejected retained re-shading
 * alternatives are recorded in `docs/surface-background-layer.md`.
 *
 * Pure: no Three.js, DOM, or app-layer imports.
 */
import {
  DEFAULT_BACKGROUND_SHAPE_CENTER,
  backgroundColorAt,
  backgroundImageUv,
} from "./background-shape";
import type { BackgroundShapeSpec, BackgroundStops } from "./background-shape";
import { clamp } from "./vec";

/**
 * One immutable image background. `rgba` uses the ImageData convention: row
 * zero is the TOP row. `revision` is part of the rendered-content identity, so
 * replacing pixels in a long-lived owner means publishing a new object and a
 * new revision rather than mutating this one in place.
 */
export interface TraceBackgroundImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
  readonly revision: number;
}

/**
 * A background as captured when a trace starts, or as resolved live later.
 * Stops/shape remain the trace fallback and the gradient source when `image`
 * is absent. When `image` is present it is the per-pixel color source instead.
 */
export interface TraceBackgroundSpec {
  readonly stops: BackgroundStops;
  readonly shape: BackgroundShapeSpec;
  readonly image?: TraceBackgroundImage;
}

/** An owned snapshot: later mutations of an app-layer value cannot alter it. */
export type TraceBackgroundReference = TraceBackgroundSpec;

/** Normalized values represented by one Surface layer sidecar texel. */
export interface SurfaceBackgroundLayerWeights {
  readonly coverage: number;
  readonly fog: number;
  readonly backgroundWeight: number;
  /** Signed camera-depth distance from the automatic focal plane. */
  readonly circleOfConfusion: number;
}

/** The fixed RGBA8 encoding of {@link SurfaceBackgroundLayerWeights}. */
export type SurfaceBackgroundLayerBytes = readonly [
  coverage: number,
  fog: number,
  backgroundWeight: number,
  circleOfConfusion: number,
];

export const SURFACE_LAYER_COVERAGE_BYTE = 0;
export const SURFACE_LAYER_FOG_BYTE = 1;
export const SURFACE_LAYER_BACKGROUND_WEIGHT_BYTE = 2;
export const SURFACE_LAYER_ALPHA_BYTE = 3;
export const SURFACE_LAYER_COC_BYTE = SURFACE_LAYER_ALPHA_BYTE;

type RgbaBytes = Uint8Array | Uint8ClampedArray;

/** Inputs for {@link compositeSurfaceBackgroundLayer}.
 *
 * `legacyRgba` and `layerRgba` are row-major RGBA8 buffers. Coordinates use
 * the tracer convention, not an implicit DOM convention: local buffer row
 * `y` samples trace pixel `y + traceOffset[1]`. Thus a compute buffer whose
 * row zero is the bottom row passes through directly; a top-origin canvas
 * readback must be flipped by its caller. `traceExtent` is always the full
 * image extent, including when this buffer is only a capture band.
 */
export interface SurfaceBackgroundCompositeSpec {
  readonly width: number;
  readonly height: number;
  readonly legacyRgba: RgbaBytes;
  readonly layerRgba: RgbaBytes;
  readonly referenceBackground: TraceBackgroundReference;
  readonly liveBackground: TraceBackgroundSpec;
  readonly traceOffset?: readonly [x: number, y: number];
  readonly traceExtent?: readonly [width: number, height: number];
  /**
   * Capture-only packing mode. The ordinary compositor always emits opaque
   * alpha; tiled depth-of-field captures can instead carry the sidecar CoC
   * byte in alpha while bands are assembled (255 remains reserved for
   * uncovered), avoiding a second full-image RGBA allocation before the one
   * seam-free presentation pass.
   */
  readonly outputAlpha?: "opaque" | "circle-of-confusion";
}

function validateImage(image: TraceBackgroundImage): void {
  if (!Number.isInteger(image.width) || image.width <= 0) {
    throw new Error(
      `Surface background image width must be a positive integer`,
    );
  }
  if (!Number.isInteger(image.height) || image.height <= 0) {
    throw new Error(
      `Surface background image height must be a positive integer`,
    );
  }
  const byteLength = image.width * image.height * 4;
  if (image.rgba.length !== byteLength) {
    throw new Error(
      `Surface background image RGBA length ${String(image.rgba.length)} does not match ${String(byteLength)}`,
    );
  }
}

function sampleImageUnchecked(
  image: TraceBackgroundImage,
  u: number,
  v: number,
): [number, number, number] {
  // Match a clamp-to-edge, linearly filtered normalized texture lookup. The
  // half texel converts normalized coordinates to texel-index space. ImageData
  // rows run top-down while Surface's v=0 is the bottom, hence `1 - v` here.
  const x = u * image.width - 0.5;
  const topY = (1 - v) * image.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(topY);
  const tx = x - x0;
  const ty = topY - y0;
  const left = Math.max(0, Math.min(image.width - 1, x0));
  const right = Math.max(0, Math.min(image.width - 1, x0 + 1));
  const top = Math.max(0, Math.min(image.height - 1, y0));
  const bottom = Math.max(0, Math.min(image.height - 1, y0 + 1));
  const rgba = image.rgba;
  const topLeft = (top * image.width + left) * 4;
  const topRight = (top * image.width + right) * 4;
  const bottomLeft = (bottom * image.width + left) * 4;
  const bottomRight = (bottom * image.width + right) * 4;
  const out: [number, number, number] = [0, 0, 0];
  for (let lane = 0; lane < 3; lane++) {
    const topMix =
      (rgba[topLeft + lane] * (1 - tx) + rgba[topRight + lane] * tx) / 255;
    const bottomMix =
      (rgba[bottomLeft + lane] * (1 - tx) + rgba[bottomRight + lane] * tx) /
      255;
    out[lane] = topMix * (1 - ty) + bottomMix * ty;
  }
  return out;
}

/**
 * Sample top-origin RGBA bytes through Surface's bottom-origin normalized UV.
 * Filtering matches a WebGL clamp-to-edge `LinearFilter` texture lookup.
 */
export function sampleTraceBackgroundImage(
  image: TraceBackgroundImage,
  u: number,
  v: number,
): [number, number, number] {
  validateImage(image);
  return sampleImageUnchecked(image, u, v);
}

/** Sample either an image source or the existing analytic gradient source. */
export function sampleTraceBackground(
  background: TraceBackgroundSpec,
  u: number,
  v: number,
): [number, number, number] {
  return background.image === undefined
    ? backgroundColorAt(u, v, background.stops, background.shape)
    : sampleTraceBackgroundImage(background.image, u, v);
}

function copyPair(value: readonly [number, number]): [number, number] {
  return [value[0], value[1]];
}

function copyTriple(
  value: readonly [number, number, number],
): [number, number, number] {
  return [value[0], value[1], value[2]];
}

/** Capture an owned reference before live background state can change. */
export function snapshotTraceBackground(
  background: TraceBackgroundSpec,
): TraceBackgroundReference {
  const { shape } = background;
  return {
    stops: {
      top: copyTriple(background.stops.top),
      bottom: copyTriple(background.stops.bottom),
    },
    shape: {
      kind: shape.kind,
      ...(shape.center === undefined ? {} : { center: copyPair(shape.center) }),
      ...(shape.scale === undefined ? {} : { scale: copyPair(shape.scale) }),
    },
    // Image sources are immutable by contract. Preserve their content identity
    // instead of copying a potentially multi-megabyte buffer on every present.
    ...(background.image === undefined ? {} : { image: background.image }),
  };
}

function triplesEqual(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function pairsEqual(
  a: readonly [number, number],
  b: readonly [number, number],
): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Exact semantic equality for the values read by `backgroundColorAt`.
 * Linear backgrounds ignore radial-only center/scale fields. Radial omitted
 * fields compare as their evaluator defaults, so omitted `[0.5, 0.5]` and an
 * explicit `[0.5, 0.5]` are the same rendered background without tolerance.
 */
export function traceBackgroundsEqual(
  a: TraceBackgroundSpec,
  b: TraceBackgroundSpec,
): boolean {
  if (a.image !== undefined || b.image !== undefined) {
    if (a.image === undefined || b.image === undefined) return false;
    return (
      a.image.width === b.image.width &&
      a.image.height === b.image.height &&
      a.image.revision === b.image.revision &&
      a.image.rgba === b.image.rgba
    );
  }
  if (
    !triplesEqual(a.stops.top, b.stops.top) ||
    !triplesEqual(a.stops.bottom, b.stops.bottom) ||
    a.shape.kind !== b.shape.kind
  ) {
    return false;
  }
  if (a.shape.kind === "linear") return true;
  const aCenter = a.shape.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER;
  const bCenter = b.shape.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER;
  const aScale = a.shape.scale ?? [1, 1];
  const bScale = b.shape.scale ?? [1, 1];
  return pairsEqual(aCenter, bCenter) && pairsEqual(aScale, bScale);
}

/**
 * Background coefficient left by the tracer's exact composition order.
 * Coverage is the ground plane's outer `mix(background, shaded, coverage)`;
 * a fully covered surface retains background only through fog, reduced by
 * the fraction of the fog target supplied by its fixed tint.
 */
export function surfaceBackgroundWeight(
  coverage: number,
  fog: number,
  fogTintStrength: number,
): number {
  const cov = clamp(coverage, 0, 1);
  const fogAmount = clamp(fog, 0, 1);
  const tint = clamp(fogTintStrength, 0, 1);
  return 1 - cov + cov * fogAmount * (1 - tint);
}

/** `pack4x8unorm`'s clamp plus round-half-up behavior on valid finite input. */
function unormByte(value: number): number {
  return Math.floor(clamp(value, 0, 1) * 255 + 0.5);
}

/** Encode the GLSL/WGSL sidecar layout from its physical inputs.
 *
 * Circle of confusion is signed: negative is in front of the automatic
 * focal plane, positive is behind it. Zero deliberately maps to byte 128.
 * The default is the far/background sentinel used by existing miss callers.
 */
export function encodeSurfaceBackgroundLayer(
  coverage: number,
  fog: number,
  fogTintStrength: number,
  circleOfConfusion = 1,
): SurfaceBackgroundLayerBytes {
  return [
    unormByte(coverage),
    unormByte(fog),
    unormByte(surfaceBackgroundWeight(coverage, fog, fogTintStrength)),
    Math.round(128 + 127 * clamp(circleOfConfusion, -1, 1)),
  ];
}

/** Decode a sidecar texel (or one texel inside a larger RGBA buffer). */
export function decodeSurfaceBackgroundLayer(
  bytes: ArrayLike<number>,
  offset = 0,
): SurfaceBackgroundLayerWeights {
  return {
    coverage: bytes[offset + SURFACE_LAYER_COVERAGE_BYTE] / 255,
    fog: bytes[offset + SURFACE_LAYER_FOG_BYTE] / 255,
    backgroundWeight:
      bytes[offset + SURFACE_LAYER_BACKGROUND_WEIGHT_BYTE] / 255,
    circleOfConfusion: clamp(
      (bytes[offset + SURFACE_LAYER_COC_BYTE] - 128) / 127,
      -1,
      1,
    ),
  };
}

function adjustedByte(
  legacyByte: number,
  backgroundWeightByte: number,
  referenceChannel: number,
  liveChannel: number,
): number {
  const changed =
    legacyByte / 255 +
    (backgroundWeightByte / 255) * (liveChannel - referenceChannel);
  return unormByte(changed);
}

/**
 * Re-composite an RGBA8 trace on the host. Equal backgrounds copy legacy RGB
 * exactly. Changed backgrounds evaluate both shapes at the same full-image
 * pixel center and apply the sidecar's quantized background weight. Alpha is
 * opaque by default; the opt-in capture mode copies the sidecar CoC byte.
 */
export function compositeSurfaceBackgroundLayer(
  spec: SurfaceBackgroundCompositeSpec,
): Uint8ClampedArray {
  const { width, height, legacyRgba, layerRgba } = spec;
  if (!Number.isInteger(width) || width < 0) {
    throw new Error(`Surface layer width must be a non-negative integer`);
  }
  if (!Number.isInteger(height) || height < 0) {
    throw new Error(`Surface layer height must be a non-negative integer`);
  }
  const byteLength = width * height * 4;
  if (legacyRgba.length !== byteLength) {
    throw new Error(
      `Surface legacy RGBA length ${legacyRgba.length} does not match ${byteLength}`,
    );
  }
  if (layerRgba.length !== byteLength) {
    throw new Error(
      `Surface layer RGBA length ${layerRgba.length} does not match ${byteLength}`,
    );
  }
  if (spec.referenceBackground.image !== undefined) {
    validateImage(spec.referenceBackground.image);
  }
  if (spec.liveBackground.image !== undefined) {
    validateImage(spec.liveBackground.image);
  }

  const out = new Uint8ClampedArray(byteLength);
  const equal = traceBackgroundsEqual(
    spec.referenceBackground,
    spec.liveBackground,
  );
  const offset = spec.traceOffset ?? [0, 0];
  const extent = spec.traceExtent ?? [width, height];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (equal) {
        out[p] = legacyRgba[p];
        out[p + 1] = legacyRgba[p + 1];
        out[p + 2] = legacyRgba[p + 2];
      } else {
        const [u, v] = backgroundImageUv(x, y, offset, extent);
        const reference =
          spec.referenceBackground.image === undefined
            ? backgroundColorAt(
                u,
                v,
                spec.referenceBackground.stops,
                spec.referenceBackground.shape,
              )
            : sampleImageUnchecked(spec.referenceBackground.image, u, v);
        const live =
          spec.liveBackground.image === undefined
            ? backgroundColorAt(
                u,
                v,
                spec.liveBackground.stops,
                spec.liveBackground.shape,
              )
            : sampleImageUnchecked(spec.liveBackground.image, u, v);
        const beta = layerRgba[p + SURFACE_LAYER_BACKGROUND_WEIGHT_BYTE];
        out[p] = adjustedByte(legacyRgba[p], beta, reference[0], live[0]);
        out[p + 1] = adjustedByte(
          legacyRgba[p + 1],
          beta,
          reference[1],
          live[1],
        );
        out[p + 2] = adjustedByte(
          legacyRgba[p + 2],
          beta,
          reference[2],
          live[2],
        );
      }
      out[p + 3] =
        spec.outputAlpha === "circle-of-confusion"
          ? layerRgba[p + SURFACE_LAYER_COVERAGE_BYTE] > 0
            ? Math.min(layerRgba[p + SURFACE_LAYER_COC_BYTE], 254)
            : 255
          : 255;
    }
  }
  return out;
}
