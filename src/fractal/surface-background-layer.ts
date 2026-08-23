/**
 * Pure host mirror for the Surface tracer's separately stored background
 * layer. The tracer keeps its legacy, already-quantized RGB alongside one
 * RGBA8 sidecar texel:
 *
 *   R = fractional surface coverage
 *   G = clamped fog amount
 *   B = surviving background weight (beta)
 *   A = reserved, written as 255
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
 * Pure: no Three.js, DOM, or app-layer imports.
 */
import {
  DEFAULT_BACKGROUND_SHAPE_CENTER,
  backgroundColorAt,
  backgroundImageUv,
} from "./background-shape";
import type { BackgroundShapeSpec, BackgroundStops } from "./background-shape";
import { clamp } from "./vec";

/** A background as captured when a trace starts, or as resolved live later. */
export interface TraceBackgroundSpec {
  readonly stops: BackgroundStops;
  readonly shape: BackgroundShapeSpec;
}

/** An owned snapshot: later mutations of an app-layer value cannot alter it. */
export type TraceBackgroundReference = TraceBackgroundSpec;

/** Normalized values represented by one Surface layer sidecar texel. */
export interface SurfaceBackgroundLayerWeights {
  readonly coverage: number;
  readonly fog: number;
  readonly backgroundWeight: number;
}

/** The fixed RGBA8 encoding of {@link SurfaceBackgroundLayerWeights}. */
export type SurfaceBackgroundLayerBytes = readonly [
  coverage: number,
  fog: number,
  backgroundWeight: number,
  reservedAlpha: 255,
];

export const SURFACE_LAYER_COVERAGE_BYTE = 0;
export const SURFACE_LAYER_FOG_BYTE = 1;
export const SURFACE_LAYER_BACKGROUND_WEIGHT_BYTE = 2;
export const SURFACE_LAYER_ALPHA_BYTE = 3;

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

/** Encode the GLSL/WGSL sidecar layout from its three physical inputs. */
export function encodeSurfaceBackgroundLayer(
  coverage: number,
  fog: number,
  fogTintStrength: number,
): SurfaceBackgroundLayerBytes {
  return [
    unormByte(coverage),
    unormByte(fog),
    unormByte(surfaceBackgroundWeight(coverage, fog, fogTintStrength)),
    255,
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
 * unconditionally 255 in both paths.
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
        const reference = backgroundColorAt(
          u,
          v,
          spec.referenceBackground.stops,
          spec.referenceBackground.shape,
        );
        const live = backgroundColorAt(
          u,
          v,
          spec.liveBackground.stops,
          spec.liveBackground.shape,
        );
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
      out[p + 3] = 255;
    }
  }
  return out;
}
