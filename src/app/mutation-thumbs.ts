/**
 * Pure, canvas-free pixel renderer for the mutation grid's (fr-3vly) preview
 * thumbnails: turns an IFS system into a small square RGBA scatter-plot image
 * — a mini point-cloud rendering — with no dependency on Three.js or the DOM.
 *
 * The mutation grid shows several CANDIDATE systems side by side, most of
 * which the user never loads into the live scene (only the one they pick
 * is), so `scene.ts`'s `captureThumbnail` — which reads back the rendered
 * canvas — can't serve them: there is no canvas for a system nobody has
 * shown yet. This module instead runs its own small chaos game and paints
 * straight into a plain `Uint8ClampedArray`, the pixel format `ImageData`
 * wants, so the DOM/canvas glue (elsewhere) only has to blit the result.
 *
 * Every thumbnail is projected through the SAME fixed, slightly-isometric
 * view (see {@link ROTATE_Y}/{@link ROTATE_X}) rather than whatever angle the
 * live orbit camera happens to be at. A straight-on axis projection hides
 * structure behind itself — a flat gasket viewed face-on along one of its own
 * symmetry axes can read as a plain triangle — and nine grid cells each at a
 * different angle would be impossible to compare at a glance. One fixed
 * oblique view keeps every candidate's silhouette comparable to its
 * neighbors'.
 *
 * Points accumulate ADDITIVELY (see {@link ALPHA}) rather than each pixel
 * simply taking the color of the last point plotted there: overlapping
 * landings brighten toward their transform's color, so density reads as
 * brightness — the same idea as the live cloud's additive "glow" render
 * style — which is what keeps a busy fractal legible at only
 * {@link THUMB_POINTS} points and a handful of dozen pixels across.
 */
import { systemIsFlat, toTransform4 } from "../fractal/affine4";
import { runChaosGame } from "../fractal/chaos-game";
import { runChaosGame4 } from "../fractal/chaos-game-4d";
import { transformColors } from "../fractal/color";
import type { MorphSystem } from "../fractal/morph";
import type { Rng } from "../fractal/rng";

/** Points per thumbnail chaos game — enough to read structure at ~100px. */
const THUMB_POINTS = 18000;

/**
 * The fixed oblique view's rotation angles (radians): about Y first, then
 * about X — see the module doc for why this is fixed rather than following
 * the live camera. Sin/cos are precomputed once below rather than per point,
 * since the angles never vary.
 */
const ROTATE_Y = -0.55;
const ROTATE_X = -0.35;
const COS_Y = Math.cos(ROTATE_Y);
const SIN_Y = Math.sin(ROTATE_Y);
const COS_X = Math.cos(ROTATE_X);
const SIN_X = Math.sin(ROTATE_X);

/** Fraction of the square left empty on each side when fitting the rotated
 * cloud into the raster (see {@link renderSystemThumb}'s fit pass). */
const MARGIN_FRACTION = 0.06;

/** Per-point additive contribution: how much of a transform's full-brightness
 * color one landed point contributes to its pixel. Several overlapping
 * points brighten toward that color exactly as the live cloud's additive
 * "glow" material does — including washing all the way to white in a dense
 * region, which is the intended density-as-brightness read, not a clipping
 * bug. */
const ALPHA = 0.28;

/** The thumbnail's empty-cell background: near-black rather than pure black,
 * so an empty grid cell still matches the app's dark theme. */
const BG_R = 10;
const BG_G = 10;
const BG_B = 14;

/**
 * Render `system` to an opaque square RGBA thumbnail, `size`×`size` pixels —
 * a small scatter plot of its chaos game viewed from the fixed oblique angle
 * (see the module doc). Branches on the system's flatness exactly like
 * `random-system.ts`'s `scoreSystem`: a flat system (`systemIsFlat` over
 * `system.transforms` — the final-transform lens's own flatness is not
 * consulted, mirroring that same branch) runs the 3D chaos game directly;
 * otherwise every map (and the lens, if any) is lifted through
 * {@link toTransform4} and run through the 4D chaos game, reading its xyz
 * `positions` and `transformIndices` the same way. An order-1 `symmetry` is
 * the identity, so passing `system.symmetry` unconditionally on the flat path
 * is always safe.
 *
 * Each plotted point is colored by its BASE transform (`transformColors`,
 * `color.ts`'s "by transform" palette) — `transformIndices` already records
 * the base map regardless of any kaleidoscope symmetry's expanded copies, so
 * a symmetric system's copies share their source map's color exactly like the
 * live cloud's "By Transform" mode does.
 *
 * A `count === 0` result (only possible with an empty transform list, since
 * {@link THUMB_POINTS} is always positive) falls out of the same code path as
 * every other system: the accumulator is seeded with the background and
 * nothing is added, so the returned buffer is the plain background.
 */
export function renderSystemThumb(
  system: MorphSystem,
  size: number,
  rng: Rng,
): Uint8ClampedArray<ArrayBuffer> {
  const { transforms, finalTransform, symmetry } = system;

  let positions: Float32Array;
  let transformIndices: Uint8Array;
  let count: number;

  if (systemIsFlat(transforms)) {
    const result = runChaosGame(
      transforms,
      THUMB_POINTS,
      rng,
      finalTransform,
      symmetry,
    );
    positions = result.positions;
    transformIndices = result.transformIndices;
    count = result.count;
  } else {
    const transforms4 = transforms.map(toTransform4);
    const finalTransform4 = finalTransform
      ? toTransform4(finalTransform)
      : null;
    const result = runChaosGame4(
      transforms4,
      THUMB_POINTS,
      rng,
      finalTransform4,
    );
    positions = result.positions;
    transformIndices = result.transformIndices;
    count = result.count;
  }

  const pixelCount = size * size;
  // Seed every pixel at the background — a point-free run (or `count === 0`)
  // then falls straight out to a plain background buffer with no special
  // case below.
  const accum = new Float32Array(pixelCount * 3);
  const bgR = BG_R / 255;
  const bgG = BG_G / 255;
  const bgB = BG_B / 255;
  for (let p = 0; p < pixelCount; p++) {
    const o = p * 3;
    accum[o] = bgR;
    accum[o + 1] = bgG;
    accum[o + 2] = bgB;
  }

  if (count > 0) {
    // Pass 1: rotate every point into the fixed oblique view and drop z,
    // tracking the projected 2D bounds needed to fit the square.
    const projX = new Float32Array(count);
    const projY = new Float32Array(count);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const x = positions[o];
      const y = positions[o + 1];
      const z = positions[o + 2];
      const rx = x * COS_Y + z * SIN_Y;
      const rz = -x * SIN_Y + z * COS_Y;
      const ry = y * COS_X - rz * SIN_X;
      projX[i] = rx;
      projY[i] = ry;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }

    // Fit: uniform scale over the larger of the two extents (preserving
    // aspect — the smaller extent ends up centered for free, since both
    // axes share the same scale and the same center offset below), inset by
    // MARGIN_FRACTION on each side. A degenerate (zero-extent, e.g. every
    // point converged to the same spot) cloud gets scale 0, which parks
    // every point at the square's center instead of dividing by zero.
    const span = Math.max(maxX - minX, maxY - minY);
    const margin = size * MARGIN_FRACTION;
    const drawable = size - margin * 2;
    const scale = span > 0 ? drawable / span : 0;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const colors = transformColors(transforms.length);

    // Pass 2: accumulate each point's base-transform color into its pixel.
    for (let i = 0; i < count; i++) {
      const px = (projX[i] - centerX) * scale + size / 2;
      // Flip Y: world +y points up, but image row 0 is the top.
      const py = size / 2 - (projY[i] - centerY) * scale;
      const col = Math.floor(px);
      const row = Math.floor(py);
      if (col < 0 || col >= size || row < 0 || row >= size) continue;

      const rgb = colors[transformIndices[i]] ?? [1, 1, 1];
      const ao = (row * size + col) * 3;
      accum[ao] += rgb[0] * ALPHA;
      accum[ao + 1] += rgb[1] * ALPHA;
      accum[ao + 2] += rgb[2] * ALPHA;
    }
  }

  const out = new Uint8ClampedArray(pixelCount * 4);
  for (let p = 0; p < pixelCount; p++) {
    const ao = p * 3;
    const o = p * 4;
    out[o] = Math.min(255, Math.round(accum[ao] * 255));
    out[o + 1] = Math.min(255, Math.round(accum[ao + 1] * 255));
    out[o + 2] = Math.min(255, Math.round(accum[ao + 2] * 255));
    out[o + 3] = 255;
  }
  return out;
}
