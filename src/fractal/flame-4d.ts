/**
 * The 4D twin of `flame.ts`'s `accumulateFlame` (fr-5b3): accumulates a 4D
 * chaos-game orbit into the SAME {@link FlameHistogram} shape, but driving
 * `chaos-game-4d.ts`'s `PreparedChaosGame4`/`stepOrbit4`/`plotPoint4` and a
 * composed {@link import("./project4").composeFlameProjection4} projection
 * (20 coefficients: clipX/clipY/clipW/sRaw rows over `(x, y, z, w, 1)`)
 * instead of the 3D path's 16-coefficient camera matrix.
 *
 * Like `accumulateFlame`, this hand-inlines `stepOrbit4`'s pick/affine/
 * variation/escape-reseed body and `plotPoint4`'s lens into one
 * allocation-free loop — the same GC-pressure argument applies at the
 * hundreds-of-millions-of-iterations scale a converged flame needs. Only the
 * warmup loop (not hot) calls the real, non-inlined `stepOrbit4`.
 *
 * The render freezes BOTH the 3D camera and the 4D tumble (rotor + center)
 * for the duration of the accumulation — unlike the live point-cloud view,
 * which recomputes its rotor every frame — so the projection is one fixed
 * {@link RotorProjection4}-then-camera composition, folded once (by the
 * caller, via `composeFlameProjection4`) into the `projection` this function
 * takes.
 *
 * **Coloring** has four flavors (see {@link import("./color").FourDRenderColor}): `"structural"` is
 * the cosine-palette path, an exact mirror of `accumulateFlame`'s `colorLUT`
 * mode — an orbit-riding coordinate blended toward the picked transform's
 * slot every step, reset on escape-reseed — except keyed on the RAW picked
 * transform index (4D has no kaleidoscope symmetry, hence no base-map
 * modulo to recover). The other three reproduce whichever `FourDColorMode`
 * the point-cloud explorer had active when the render started: `"wRamp"`
 * mirrors the diverging rotated-w ramp `scene.ts`'s `FOUR_D_VERTEX` paints
 * in-shader (`color.ts`'s `wRampColor`); `"transform"` and `"radius"` mirror
 * `color.ts`'s `buildColors4` baked-attribute modes.
 *
 * **The soft w-slice rides the SAME ghost-context floor the point-cloud view
 * uses** (0.06 — see `project4.ts`'s `sliceWeight`), not the voxel
 * (solid-render) floor of 0: the flame renders the CURRENT VIEW, ghost
 * context included, exactly like the point cloud it is a converged version
 * of — an out-of-slice point still contributes a faint trace, it isn't
 * simply absent.
 */
import { ESCAPE_LIMIT, WARMUP_ITERATIONS } from "./chaos-game";
import { pickIndex4, stepOrbit4 } from "./chaos-game-4d";
import type { PreparedChaosGame4 } from "./chaos-game-4d";
import { createFlameHistogram } from "./flame";
import type { FlameHistogram } from "./flame";
import { wRampColor } from "./color";
import type { FourDRenderColor } from "./color";
import { sliceColorRemap, sliceWeight, SLICE_GHOST_FLOOR } from "./project4";
import type { FourDView } from "./project4";
import type { Rng } from "./rng";
import type { Vec3 } from "./types";

/** Color for a transform/bucket outside `palette` — shouldn't happen; mirrors
 * `flame.ts`'s `FALLBACK_COLOR` and `color.ts`'s `buildColors4` fallback. */
const FALLBACK_COLOR: Vec3 = [1, 1, 1];

/**
 * Accumulate `iterations` more 4D chaos-game steps into a 2D histogram, seen
 * through a frozen 4D rotor + 3D camera. The 4D sibling of `flame.ts`'s
 * `accumulateFlame` — see this module's doc for the full picture (coloring
 * modes, the frozen-view contract, the shared ghost-context slice floor).
 *
 * `projection` is the 20-coefficient affine `composeFlameProjection4` builds
 * (`composeFlameProjection4(camera, composeRotorProjection4(rotor, center))`):
 * row-major, 5 coefficients per row (`x, y, z, w`, then a constant), rows in
 * order `clipX`, `clipY`, `clipW`, `sRaw` — throws `RangeError` if it isn't
 * exactly 20 entries, mirroring `accumulateFlame`'s own projection-length
 * guard. `hits`/`width`/`height` mismatch against a passed-in `histogram`
 * throws the same way `accumulateFlame` does too.
 *
 * **Fresh histogram** (`histogram` omitted): a new seed point is drawn as
 * `rng() - 0.5` for each of `x, y, z, w` (in that order) and warmed up for
 * `WARMUP_ITERATIONS` steps through the real (non-inlined — warmup isn't
 * hot) {@link stepOrbit4}, exactly like `runChaosGame4`. **Resumed**
 * (`histogram` passed back in): the orbit resumes from `histogram.orbit`
 * (`x, y, z`) and `histogram.orbitW` (`w`), and the color coordinate resumes
 * from `histogram.orbitColor` — so a chunked render (repeated calls passing
 * the same histogram and RNG *instance* back in) produces the identical
 * result as one unchunked call, exactly like `accumulateFlame`.
 *
 * Pass a seeded {@link Rng} for reproducible output (tests); the app passes
 * `Math.random`.
 */
export function accumulateFlame4(
  prepared: PreparedChaosGame4,
  projection: Float64Array,
  view: FourDView,
  width: number,
  height: number,
  iterations: number,
  rng: Rng,
  color: FourDRenderColor,
  histogram?: FlameHistogram,
): FlameHistogram {
  if (projection.length !== 20) {
    throw new RangeError(
      `accumulateFlame4: projection must have 20 entries (row-major 4x5 rotor+camera), got ${projection.length}`,
    );
  }
  const hist = histogram ?? createFlameHistogram(width, height);
  if (hist.width !== width || hist.height !== height) {
    throw new RangeError(
      `accumulateFlame4: histogram is ${hist.width}x${hist.height}, but ${width}x${height} was requested`,
    );
  }

  const { affines, variations, finalAffine, finalWarp, transformCount } =
    prepared;
  const { hits, sumRGB } = hist;
  let maxHits = hist.maxHits;

  // Structural coloring (mirrors accumulateFlame's colorLUT path exactly —
  // see FourDRenderColor's doc): `structural` gates both the per-step update below
  // and the escape-reseed reset, hoisted once rather than re-checking
  // `color.kind` twice per iteration. `colorDenom` is `n - 1` (0 for a
  // single-transform system, which pins the coordinate at 0.5) — keyed on
  // the raw `transformCount` since 4D has no symmetry-expanded copies to
  // collapse back to a base index.
  const structural = color.kind === "structural";
  const colorDenom = transformCount > 1 ? transformCount - 1 : 0;
  let c = hist.orbitColor;

  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (histogram === undefined) {
    x = rng() - 0.5;
    y = rng() - 0.5;
    z = rng() - 0.5;
    w = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
    }
  } else {
    [x, y, z] = hist.orbit;
    w = hist.orbitW;
  }

  // Row-major projection rows: clipX, clipY, clipW (the perspective-divided
  // trio, exactly like accumulateFlame's rx/ry/rw rows), and sRaw (the
  // rotor's raw signed-w signal, untouched by the camera — see
  // composeFlameProjection4's doc). Row 2 (clip Z) never existed here in the
  // first place: composeFlameProjection4 never carries it either.
  const rx0 = projection[0];
  const rx1 = projection[1];
  const rx2 = projection[2];
  const rx3 = projection[3];
  const rx4 = projection[4];
  const ry0 = projection[5];
  const ry1 = projection[6];
  const ry2 = projection[7];
  const ry3 = projection[8];
  const ry4 = projection[9];
  const rw0 = projection[10];
  const rw1 = projection[11];
  const rw2 = projection[12];
  const rw3 = projection[13];
  const rw4 = projection[14];
  const rs0 = projection[15];
  const rs1 = projection[16];
  const rs2 = projection[17];
  const rs3 = projection[18];
  const rs4 = projection[19];

  const { invWAmp, sliceOn, sliceCenter, sliceWidth } = view;
  // The slice-relative w-ramp recolor (fr-nn6) — identity (0, 1) unless the
  // slice is on and the option was chosen, so the wRamp branch below applies
  // it unconditionally (see sliceColorRemap's doc).
  const { shift: colorShift, invScale: colorInvScale } = sliceColorRemap(view);

  for (let n = 0; n < iterations; n++) {
    // --- inlined stepOrbit4(prepared, x, y, z, w, rng) ---------------------
    const idx = pickIndex4(prepared, rng);
    // Blend the color coordinate halfway toward this transform's slot,
    // BEFORE applying its affine — mirrors accumulateFlame's ordering
    // exactly. No rng is consumed, so the orbit (and `hits`) is identical
    // whether or not structural coloring is in play.
    if (structural) {
      const slot = colorDenom > 0 ? idx / colorDenom : 0.5;
      c = (c + slot) * 0.5;
    }
    const aff = affines[idx];
    const m = aff.m;
    const t = aff.t;
    const ax = m[0] * x + m[1] * y + m[2] * z + m[3] * w + t[0];
    const ay = m[4] * x + m[5] * y + m[6] * z + m[7] * w + t[1];
    const az = m[8] * x + m[9] * y + m[10] * z + m[11] * w + t[2];
    const aw = m[12] * x + m[13] * y + m[14] * z + m[15] * w + t[3];

    const warp = variations[idx];
    let nx: number;
    let ny: number;
    let nz: number;
    let nw: number;
    if (warp === null) {
      nx = ax;
      ny = ay;
      nz = az;
      nw = aw;
    } else {
      const q = warp(ax, ay, az, aw, rng);
      nx = q[0];
      ny = q[1];
      nz = q[2];
      nw = q[3];
    }

    if (
      !Number.isFinite(nx) ||
      !Number.isFinite(ny) ||
      !Number.isFinite(nz) ||
      !Number.isFinite(nw) ||
      Math.abs(nx) > ESCAPE_LIMIT ||
      Math.abs(ny) > ESCAPE_LIMIT ||
      Math.abs(nz) > ESCAPE_LIMIT ||
      Math.abs(nw) > ESCAPE_LIMIT
    ) {
      nx = rng() - 0.5;
      ny = rng() - 0.5;
      nz = rng() - 0.5;
      nw = rng() - 0.5;
      // The orbit restarts, so its color coordinate does too.
      if (structural) c = 0.5;
    }
    x = nx;
    y = ny;
    z = nz;
    w = nw;

    // --- inlined plotPoint4(prepared, x, y, z, w, rng) ---------------------
    let px = x;
    let py = y;
    let pz = z;
    let pw = w;
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * x + fm[1] * y + fm[2] * z + fm[3] * w + ft[0];
      let fy = fm[4] * x + fm[5] * y + fm[6] * z + fm[7] * w + ft[1];
      let fz = fm[8] * x + fm[9] * y + fm[10] * z + fm[11] * w + ft[2];
      let fw = fm[12] * x + fm[13] * y + fm[14] * z + fm[15] * w + ft[3];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, fw, rng);
        fx = q[0];
        fy = q[1];
        fz = q[2];
        fw = q[3];
      }
      if (
        Number.isFinite(fx) &&
        Number.isFinite(fy) &&
        Number.isFinite(fz) &&
        Number.isFinite(fw)
      ) {
        px = fx;
        py = fy;
        pz = fz;
        pw = fw;
      }
    }

    // --- project through the frozen rotor+camera and bucket ----------------
    const cw = rw0 * px + rw1 * py + rw2 * pz + rw3 * pw + rw4;
    if (cw <= 0) continue; // behind (or exactly at) the camera.
    const cx = rx0 * px + rx1 * py + rx2 * pz + rx3 * pw + rx4;
    const cy = ry0 * px + ry1 * py + ry2 * pz + ry3 * pw + ry4;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    const col = Math.floor((ndcX + 1) * 0.5 * width);
    // NDC Y points up; pixel row 0 is the top of the image, so flip.
    const row = Math.floor((1 - ndcY) * 0.5 * height);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;

    // The rotor's raw signed-w signal — a pure function of (x, y, z, w) and
    // the frozen rotor/center, untouched by the camera (see
    // composeFlameProjection4's doc) — never perspective-divided.
    const sRaw = rs0 * px + rs1 * py + rs2 * pz + rs3 * pw + rs4;
    const sScaled = sRaw * invWAmp;
    const s = sScaled < -1 ? -1 : sScaled > 1 ? 1 : sScaled;
    // The flame renders the CURRENT VIEW, ghost context included — see this
    // module's doc for why the floor matches the point cloud's (0.06), not
    // the solid render's (0).
    const weight = sliceOn
      ? sliceWeight(s, sliceCenter, sliceWidth, SLICE_GHOST_FLOOR)
      : 1;

    const bucket = row * width + col;
    const hit = (hits[bucket] += weight);
    if (hit > maxHits) maxHits = hit;
    const o = bucket * 3;

    let r: number;
    let g: number;
    let b: number;
    switch (color.kind) {
      case "structural": {
        // c is in [0, 1]; the min guards the c === 1 edge (256 -> 255).
        const li = Math.min(255, (c * 256) | 0) * 3;
        r = color.lut[li];
        g = color.lut[li + 1];
        b = color.lut[li + 2];
        break;
      }
      case "wRamp": {
        // The optional slice-relative remap of s (fr-nn6) — wRampColor's own
        // clamp bounds the rescaled signal, exactly like the raw s's.
        const rgb = wRampColor((s - colorShift) * colorInvScale, color.side);
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        break;
      }
      case "transform": {
        const rgb = color.palette[idx] ?? FALLBACK_COLOR;
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        break;
      }
      case "radius": {
        const dx = px - color.center[0];
        const dy = py - color.center[1];
        const dz = pz - color.center[2];
        const dw = pw - color.center[3];
        const d4 = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
        const range = color.maxD - color.minD || 1;
        const t = (d4 - color.minD) / range;
        // Same 256-step rounding convention as voxel.ts's accumulateVoxels
        // ramp lookup (clamp then round-to-nearest, not floor).
        const li = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0) * 3;
        r = color.lut[li];
        g = color.lut[li + 1];
        b = color.lut[li + 2];
        break;
      }
    }
    sumRGB[o] += r * weight;
    sumRGB[o + 1] += g * weight;
    sumRGB[o + 2] += b * weight;
  }

  hist.orbit = [x, y, z];
  hist.orbitW = w;
  hist.orbitColor = c;
  hist.maxHits = maxHits;
  return hist;
}
