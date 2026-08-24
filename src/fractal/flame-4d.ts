/**
 * The 4D twin of `flame.ts`'s `accumulateFlame`: accumulates a 4D
 * chaos-game orbit into the SAME {@link FlameHistogram} shape, but driving
 * `chaos-game-4d.ts`'s `PreparedChaosGame4`/`stepOrbit4`/`plotPoint4` and a
 * composed {@link import("./project4").composeFlameProjection4} projection
 * (20 coefficients: clipX/clipY/clipW/sRaw rows over `(x, y, z, w, 1)`)
 * instead of the 3D path's 16-coefficient camera matrix.
 *
 * Like `accumulateFlame`, this hand-inlines `stepOrbit4`'s pick/affine/
 * variation/symmetry-post-rotation/escape-reseed body and `plotPoint4`'s lens
 * into one allocation-free loop — the same GC-pressure argument applies at the
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
 * **Balloon echo means PROJECT THEN INVERT.** When a
 * {@link FlameBalloonEcho} is present, the plotted 4D point first goes through
 * the same frozen {@link RotorProjection4} the explorer uses to produce its
 * visible 3D point; only that 3D point is sphere-inverted, then the frozen
 * camera projects the result into the histogram. Inverting in 4D before the
 * rotor/drop would produce a different object. The primary splat keeps the
 * already-composed fast projection above; the separate tail matrices exist
 * only because nonlinear inversion prevents folding the echo into it.
 *
 * The echo inherits the source point's 4D color and soft-slice weight, mixes
 * tint only into its own color, and follows `flame.ts`'s deliberate histogram
 * semantics: no conformal-magnification term and no radial fade. Density
 * itself accounts for inversion's spreading, while the frozen camera simply
 * discards unbounded images outside its frustum.
 *
 * An optional echo-only LUT replaces that inherited base color. Its
 * coordinate is the radius of the visible rotor-projected 3D source about
 * the balloon center, normalized by `rho` and clamped before inversion; LUT
 * lookup therefore happens after the 4D-to-visible-3D projection, then tint,
 * then soft-slice/echo weight accumulation. The primary splat is unchanged.
 *
 * **Coloring** has four flavors (see {@link import("./color").FourDRenderColor}): `"structural"` is
 * the cosine-palette path, an exact mirror of `accumulateFlame`'s `colorLUT`
 * mode — an orbit-riding coordinate blended toward the picked transform's
 * palette slot at that transform's color speed every step (both resolved by
 * `prepareChaosGame4`), reset on escape-reseed, and keyed on the
 * BASE map index (`idx % baseTransformCount`) so a kaleidoscope copy colors as
 * the map it copies. The other three reproduce whichever `FourDColorMode`
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
import {
  CHAOS_SUB_ORBIT_POINTS,
  ESCAPE_LIMIT,
  WARMUP_ITERATIONS,
  pickScheduleIndex,
} from "./chaos-game";
import { pickIndex4, stepOrbit4 } from "./chaos-game-4d";
import type { PreparedChaosGame4 } from "./chaos-game-4d";
import { balloonPaletteCoordinate, invertBalloon } from "./balloon-de";
import { createFlameHistogram } from "./flame";
import type { FlameBalloonEcho, FlameHistogram, Mat4 } from "./flame";
import { wRampColor } from "./color";
import type { FourDRenderColor } from "./color";
import { sliceColorRemap, sliceWeight, SLICE_GHOST_FLOOR } from "./project4";
import type { FourDView, RotorProjection4 } from "./project4";
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
 * When `echo` is present, `rotorProjection` and `cameraProjection` are both
 * required and validated at 20 and 16 coefficients respectively. They are
 * tail parameters so every existing no-echo caller keeps its original call
 * shape; see the module doc for why the nonlinear echo needs the two maps
 * separately. `echoColorLUT` is also a tail parameter; omit it for exact
 * inherited primary color.
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
  echo?: FlameBalloonEcho,
  rotorProjection?: RotorProjection4,
  cameraProjection?: Mat4,
  echoColorLUT?: Float32Array,
): FlameHistogram {
  if (projection.length !== 20) {
    throw new RangeError(
      `accumulateFlame4: projection must have 20 entries (row-major 4x5 rotor+camera), got ${projection.length}`,
    );
  }
  if (echo !== undefined && rotorProjection?.length !== 20) {
    throw new RangeError(
      `accumulateFlame4: balloon echo requires a 20-entry rotorProjection, got ${rotorProjection?.length ?? 0}`,
    );
  }
  if (echo !== undefined && cameraProjection?.length !== 16) {
    throw new RangeError(
      `accumulateFlame4: balloon echo requires a 16-entry cameraProjection, got ${cameraProjection?.length ?? 0}`,
    );
  }
  const hist = histogram ?? createFlameHistogram(width, height);
  if (hist.width !== width || hist.height !== height) {
    throw new RangeError(
      `accumulateFlame4: histogram is ${hist.width}x${hist.height}, but ${width}x${height} was requested`,
    );
  }

  const { affines, variations, postRotations, finalAffine, finalWarp } =
    prepared;
  const { baseTransformCount, schedule } = prepared;
  const { hits, sumRGB } = hist;
  let maxHits = hist.maxHits;

  // Structural coloring (mirrors accumulateFlame's colorLUT path exactly —
  // see FourDRenderColor's doc): `structural` gates both the per-step update below
  // and the escape-reseed reset, hoisted once rather than re-checking
  // `color.kind` twice per iteration. The per-map slot and blend speed were
  // resolved once by `prepareChaosGame4`, keyed on
  // `baseTransformCount` exactly like accumulateFlame's: with
  // symmetry, every rotated copy of a base map shares that map's slot, so the
  // gradient repeats around the kaleidoscope instead of smearing continuously
  // across copies that are geometrically the same map.
  const structural = color.kind === "structural";
  const colorSlots = prepared.colorIndex;
  const colorSpeeds = prepared.colorSpeed;
  let c = hist.orbitColor;
  // Reused on the echo path: project into one 3D tuple, invert into the
  // other. The optional output on invertBalloon preserves this hot loop's
  // allocation-free contract even when every iteration gains an echo splat.
  const echoSource: Vec3 = [0, 0, 0];
  const echoInverted: Vec3 = [0, 0, 0];

  // Graph-directed selection state, resumed from the histogram — see
  // accumulateFlame's identical threading (chunk-boundary independence via
  // FlameHistogram.orbitPrevBase/orbitChaosLeft; inert without chi rows).
  const chaosOn = prepared.chaosRows !== null;
  let prevBase = hist.orbitPrevBase;
  let chaosLeft = hist.orbitChaosLeft;

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
      const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      prevBase = step.escaped ? -1 : step.index;
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
  // The slice-relative w-ramp recolor — identity (0, 1) unless the
  // slice is on and the option was chosen, so the wRamp branch below applies
  // it unconditionally (see sliceColorRemap's doc).
  const { shift: colorShift, invScale: colorInvScale } = sliceColorRemap(view);

  for (let n = 0; n < iterations; n++) {
    // Sub-orbit re-fuse — accumulateFlame's chi block, four coordinates (see
    // chaos-game.ts's CHAOS_SUB_ORBIT_POINTS): reseed from `rng` (the one
    // stream here), reset to the entry pick, warm up unrecorded through the
    // real stepOrbit4, reset the structural color walk like an
    // escape-reseed's.
    if (chaosOn) {
      if (chaosLeft <= 0) {
        x = rng() - 0.5;
        y = rng() - 0.5;
        z = rng() - 0.5;
        w = rng() - 0.5;
        prevBase = -1;
        for (let k = 0; k < WARMUP_ITERATIONS; k++) {
          const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
          x = step.x;
          y = step.y;
          z = step.z;
          w = step.w;
          prevBase = step.escaped ? -1 : step.index;
        }
        if (structural) c = 0.5;
        chaosLeft = CHAOS_SUB_ORBIT_POINTS;
      }
      chaosLeft--;
    }
    // --- inlined stepOrbit4(prepared, x, y, z, w, rng) ---------------------
    const idx = pickIndex4(prepared, rng, prevBase);
    // The BASE map this slot is a (possibly rotated) copy of — see
    // PreparedChaosGame4.baseTransformCount. Equal to `idx` at symmetry order
    // 1. Anything keyed to "which logical map" (the color slot below, and the
    // `palette` lookup at the bottom of the loop) uses this, never the raw
    // expanded `idx`.
    const baseIdx = idx % baseTransformCount;
    // Blend the color coordinate toward this transform's slot at this
    // transform's speed, BEFORE applying its affine — mirrors
    // accumulateFlame's formula and ordering exactly, including its
    // bit-for-bit reproduction of the older halfway blend at the default
    // speed 0.5 (see the argument there). No rng is consumed, so the orbit
    // (and `hits`) is identical whether or not structural coloring is in play.
    if (structural) {
      const speed = colorSpeeds[baseIdx];
      c = c * (1 - speed) + colorSlots[baseIdx] * speed;
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

    // Symmetry: rotate this slot's FULL affine + variation output —
    // see `chaos-game-4d.ts`'s `stepOrbit4`, which this mirrors exactly.
    // `null` (order 1, and every unrotated copy-0 slot at any order) skips
    // this, so the orbit stays byte-identical to the pre-symmetry loop
    // exactly where there is nothing to rotate.
    const post = postRotations[idx];
    if (post !== null) {
      const rx = post[0] * nx + post[1] * ny + post[2] * nz + post[3] * nw;
      const ry = post[4] * nx + post[5] * ny + post[6] * nz + post[7] * nw;
      const rz = post[8] * nx + post[9] * ny + post[10] * nz + post[11] * nw;
      const rw = post[12] * nx + post[13] * ny + post[14] * nz + post[15] * nw;
      nx = rx;
      ny = ry;
      nz = rz;
      nw = rw;
    }

    let escaped = false;
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
      escaped = true;
    }
    x = nx;
    y = ny;
    z = nz;
    w = nw;
    // Selection state for the next pick — stepOrbit4's escaped/index
    // contract exactly. Inert without chi rows.
    prevBase = escaped ? -1 : baseIdx;

    // --- inlined plotPoint4(prepared, x, y, z, w, rng) ---------------------
    // Post-word first, then the lens — chaos-game-4d.ts's plotPoint4 stage
    // for stage (single-stream consumer, so the B-picks draw from `rng`).
    let px = x;
    let py = y;
    let pz = z;
    let pw = w;
    if (schedule !== null) {
      let sx = px;
      let sy = py;
      let sz = pz;
      let sw = pw;
      for (let d = 0; d < schedule.depth; d++) {
        const bAff = schedule.affines[pickScheduleIndex(schedule, rng)];
        const bm = bAff.m;
        const bt = bAff.t;
        const nx = bm[0] * sx + bm[1] * sy + bm[2] * sz + bm[3] * sw + bt[0];
        const ny = bm[4] * sx + bm[5] * sy + bm[6] * sz + bm[7] * sw + bt[1];
        const nz = bm[8] * sx + bm[9] * sy + bm[10] * sz + bm[11] * sw + bt[2];
        const nw =
          bm[12] * sx + bm[13] * sy + bm[14] * sz + bm[15] * sw + bt[3];
        sx = nx;
        sy = ny;
        sz = nz;
        sw = nw;
      }
      if (
        Number.isFinite(sx) &&
        Number.isFinite(sy) &&
        Number.isFinite(sz) &&
        Number.isFinite(sw)
      ) {
        px = sx;
        py = sy;
        pz = sz;
        pw = sw;
      }
    }
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * px + fm[1] * py + fm[2] * pz + fm[3] * pw + ft[0];
      let fy = fm[4] * px + fm[5] * py + fm[6] * pz + fm[7] * pw + ft[1];
      let fz = fm[8] * px + fm[9] * py + fm[10] * pz + fm[11] * pw + ft[2];
      let fw = fm[12] * px + fm[13] * py + fm[14] * pz + fm[15] * pw + ft[3];
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

    // Keep the original no-echo projection/deposit path textually intact.
    // Its early continues remain both the cheapest and the most auditable
    // byte-identical route for an absent/off balloon.
    if (echo === undefined) {
      // --- project through the frozen rotor+camera and bucket --------------
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
          // The optional slice-relative remap of s — wRampColor's own
          // clamp bounds the rescaled signal, exactly like the raw s's.
          const rgb = wRampColor((s - colorShift) * colorInvScale, color.side);
          r = rgb[0];
          g = rgb[1];
          b = rgb[2];
          break;
        }
        case "transform": {
          const rgb = color.palette[baseIdx] ?? FALLBACK_COLOR;
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
      continue;
    }

    // Source color and soft-slice density are shared by primary and echo.
    // They are evaluated even when the primary is off-screen because its
    // sphere inversion may still land inside the frozen camera's frame.
    const sRaw = rs0 * px + rs1 * py + rs2 * pz + rs3 * pw + rs4;
    const sScaled = sRaw * invWAmp;
    const s = sScaled < -1 ? -1 : sScaled > 1 ? 1 : sScaled;
    const sourceWeight = sliceOn
      ? sliceWeight(s, sliceCenter, sliceWidth, SLICE_GHOST_FLOOR)
      : 1;

    let r: number;
    let g: number;
    let b: number;
    switch (color.kind) {
      case "structural": {
        const li = Math.min(255, (c * 256) | 0) * 3;
        r = color.lut[li];
        g = color.lut[li + 1];
        b = color.lut[li + 2];
        break;
      }
      case "wRamp": {
        const rgb = wRampColor((s - colorShift) * colorInvScale, color.side);
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        break;
      }
      case "transform": {
        const rgb = color.palette[baseIdx] ?? FALLBACK_COLOR;
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
        const li = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0) * 3;
        r = color.lut[li];
        g = color.lut[li + 1];
        b = color.lut[li + 2];
        break;
      }
    }

    // Primary splat via the precomposed fast projection.
    const cw = rw0 * px + rw1 * py + rw2 * pz + rw3 * pw + rw4;
    if (cw > 0) {
      const cx = rx0 * px + rx1 * py + rx2 * pz + rx3 * pw + rx4;
      const cy = ry0 * px + ry1 * py + ry2 * pz + ry3 * pw + ry4;
      const col = Math.floor((cx / cw + 1) * 0.5 * width);
      const row = Math.floor((1 - cy / cw) * 0.5 * height);
      if (col >= 0 && col < width && row >= 0 && row < height) {
        const bucket = row * width + col;
        const hit = (hits[bucket] += sourceWeight);
        if (hit > maxHits) maxHits = hit;
        const o = bucket * 3;
        sumRGB[o] += r * sourceWeight;
        sumRGB[o + 1] += g * sourceWeight;
        sumRGB[o + 2] += b * sourceWeight;
      }
    }

    // Echo splat: raw plotted 4D point -> visible rotor-projected 3D point ->
    // shared f64 balloon inversion -> camera. This is project-then-invert,
    // matching the Points arm; no 4D inversion appears anywhere in the path.
    const rp = rotorProjection!;
    echoSource[0] = rp[0] * px + rp[1] * py + rp[2] * pz + rp[3] * pw + rp[4];
    echoSource[1] = rp[5] * px + rp[6] * py + rp[7] * pz + rp[8] * pw + rp[9];
    echoSource[2] =
      rp[10] * px + rp[11] * py + rp[12] * pz + rp[13] * pw + rp[14];
    let er = r;
    let eg = g;
    let eb = b;
    if (echoColorLUT !== undefined) {
      const u = balloonPaletteCoordinate(echo.balloon, echoSource);
      const li = Math.min(255, (u * 256) | 0) * 3;
      er = echoColorLUT[li];
      eg = echoColorLUT[li + 1];
      eb = echoColorLUT[li + 2];
    }
    const inv = invertBalloon(echo.balloon, echoSource, echoInverted);
    const camera = cameraProjection!;
    const ecw =
      camera[12] * inv[0] +
      camera[13] * inv[1] +
      camera[14] * inv[2] +
      camera[15];
    if (ecw > 0) {
      const ecx =
        camera[0] * inv[0] +
        camera[1] * inv[1] +
        camera[2] * inv[2] +
        camera[3];
      const ecy =
        camera[4] * inv[0] +
        camera[5] * inv[1] +
        camera[6] * inv[2] +
        camera[7];
      const col = Math.floor((ecx / ecw + 1) * 0.5 * width);
      const row = Math.floor((1 - ecy / ecw) * 0.5 * height);
      if (col >= 0 && col < width && row >= 0 && row < height) {
        const bucket = row * width + col;
        const echoWeight = sourceWeight * echo.weight;
        const hit = (hits[bucket] += echoWeight);
        if (hit > maxHits) maxHits = hit;
        const o = bucket * 3;
        const t = echo.tintStrength;
        sumRGB[o] += (er + (echo.tint[0] - er) * t) * echoWeight;
        sumRGB[o + 1] += (eg + (echo.tint[1] - eg) * t) * echoWeight;
        sumRGB[o + 2] += (eb + (echo.tint[2] - eb) * t) * echoWeight;
      }
    }
  }

  hist.orbit = [x, y, z];
  hist.orbitW = w;
  hist.orbitColor = c;
  hist.orbitPrevBase = prevBase;
  hist.orbitChaosLeft = chaosLeft;
  hist.maxHits = maxHits;
  return hist;
}
