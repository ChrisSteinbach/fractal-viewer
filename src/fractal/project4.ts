import type { Mat4 } from "./flame";
import type { Vec4 } from "./types";

/**
 * The 4D view's projection pipeline as composed AFFINE MAPS, pure and
 * dependency-free — the CPU twin of `src/app/scene.ts`'s `FOUR_D_VERTEX`
 * vertex shader (scene.ts:198-236), factored so a future 4D histogram
 * accumulator (a `flame.ts`-style hand-inlined hot loop) can project a raw
 * (x, y, z, w) chaos-game point straight to camera clip space without
 * building a `THREE.Vector4` per iteration.
 *
 * The 4D view projects a point `v = (x, y, z, w)` by rotating about the
 * cloud's 4D center `c` with a row-major 4x4 SO(4) "rotor matrix" `R`, then
 * dropping the rotated `w`:
 *
 *     q = R · (v − c)
 *     p = q.xyz + c.xyz          (projected 3D position)
 *     sRaw = q.w                 (signed w signal — NO c.w add-back)
 *
 * `sRaw` skips the `+ c.w` add-back that `p` gets, matching the shader
 * exactly: `FOUR_D_VERTEX` computes `s = clamp(q.w * uInvWAmp4, -1, 1)` from
 * the bare rotated `q.w`, never `q.w + uCenter4.w`.
 *
 * {@link composeRotorProjection4} folds the whole `(x, y, z, w) -> (px, py,
 * pz, sRaw)` map into one 4x5 affine (a {@link RotorProjection4}) so a hot
 * loop evaluates it with 20 multiply-adds instead of a subtract, a
 * matrix-vector multiply, and an add-back per point. {@link
 * composeFlameProjection4} folds a frozen camera's clip-space matrix on top,
 * the same "compose once, evaluate per-iteration" shape `accumulateFlame`
 * (flame.ts:275-290) uses for its own row-major camera rows.
 */

/**
 * Rows `px`, `py`, `pz`, `sRaw` of the affine map `(x, y, z, w, 1) -> (px,
 * py, pz, sRaw)` — the whole rotor-projection step (rotate about the 4D
 * center, drop the rotated w, add back the xyz center) as ONE composed
 * affine. Row-major, 5 coefficients per row (`x, y, z, w`, then the
 * constant), length 20: row `i`'s coefficients live at `[i*5 .. i*5+3]`, its
 * constant at `[i*5+4]`. Built once per frame (the rotor and center change
 * only when the view tumbles or the cloud regenerates) and evaluated per
 * point in a hot loop.
 */
export type RotorProjection4 = Float64Array;

/** Apply a bare row-major 4x4 matrix (no translation) to a {@link Vec4} — the
 * one-off matrix-vector multiply {@link composeRotorProjection4} needs to
 * fold `R · center` into its per-row constants; not exported; a hot loop
 * never calls this; it composes {@link RotorProjection4} once instead. */
function applyRotor4(rotor: number[], v: Vec4): Vec4 {
  return [
    rotor[0] * v[0] + rotor[1] * v[1] + rotor[2] * v[2] + rotor[3] * v[3],
    rotor[4] * v[0] + rotor[5] * v[1] + rotor[6] * v[2] + rotor[7] * v[3],
    rotor[8] * v[0] + rotor[9] * v[1] + rotor[10] * v[2] + rotor[11] * v[3],
    rotor[12] * v[0] + rotor[13] * v[1] + rotor[14] * v[2] + rotor[15] * v[3],
  ];
}

/**
 * Compose the view's rotor + center + xyz-add-back + w-drop into one
 * {@link RotorProjection4} — see this module's doc for the two-step math
 * (`q = R · (v − c)`, `p = q.xyz + c.xyz`, `sRaw = q.w`) this folds into a
 * single affine. `rotor` is a row-major 4x4 SO(4) matrix (16 entries, the
 * same convention as `affine4.ts`'s `rotationMatrix4`), applied exactly as
 * `scene.ts`'s `uRot4` uniform is.
 *
 * Rows 0-2 (`px`/`py`/`pz`) carry `R`'s corresponding row as their `x, y, z,
 * w` coefficients, with a constant of `center[i] − (R · center)[i]` — the
 * `+ c.xyz` add-back applied once, at compose time, instead of per point.
 * Row 3 (`sRaw`) carries `R`'s row 3 the same way, but its constant is just
 * `−(R · center)[3]` — deliberately NOT `center[3] − (R · center)[3]`,
 * mirroring the shader's missing `+ c.w` (see the module doc).
 */
export function composeRotorProjection4(
  rotor: number[],
  center: Vec4,
): RotorProjection4 {
  const rc = applyRotor4(rotor, center);
  const out = new Float64Array(20);
  for (let i = 0; i < 3; i++) {
    out[i * 5] = rotor[i * 4];
    out[i * 5 + 1] = rotor[i * 4 + 1];
    out[i * 5 + 2] = rotor[i * 4 + 2];
    out[i * 5 + 3] = rotor[i * 4 + 3];
    out[i * 5 + 4] = center[i] - rc[i];
  }
  out[15] = rotor[12];
  out[16] = rotor[13];
  out[17] = rotor[14];
  out[18] = rotor[15];
  out[19] = -rc[3];
  return out;
}

/**
 * Compose a frozen camera's clip-space matrix (`projection * view`, row-major
 * 4x4, the same {@link Mat4} convention `flame.ts`'s `accumulateFlame` takes)
 * on top of a {@link RotorProjection4}, giving one affine `(x, y, z, w, 1) ->
 * (clipX, clipY, clipW, sRaw)` — 20 coefficients, same row-major 4-coeffs-
 * plus-constant layout as {@link RotorProjection4}.
 *
 * Camera row 2 (clip Z) is never read, for the same reason `accumulateFlame`
 * only reads rows 0/1/3 of its own projection matrix (flame.ts:275-290): a
 * density accumulator doesn't depth-sort, so clip Z carries no information
 * the histogram needs. Row `S` is copied VERBATIM from the rotor
 * projection's row 3 — the camera never touches the signed-w signal, which
 * stays a pure function of the 4D rotor and center regardless of where the
 * 3D camera sits.
 *
 * For camera row `k` (`k = 0` for X, `1` for Y, `3` for clip W) with
 * coefficients `(k0, k1, k2, k3)`: `out` coefficient `j` (`j = 0..3`, over
 * `x, y, z, w`) is `Σ_{i=0..2} k_i · rotorProj[i*5+j]`, and `out`'s constant
 * is `Σ_{i=0..2} k_i · rotorProj[i*5+4] + k3` — the camera row applied to the
 * rotor projection's `(px, py, pz, 1)` output, chained algebraically into one
 * affine over the ORIGINAL `(x, y, z, w)` rather than evaluated in two passes
 * per point.
 */
export function composeFlameProjection4(
  camera: Mat4,
  rotorProj: RotorProjection4,
): Float64Array {
  const out = new Float64Array(20);
  const cameraRows = [0, 1, 3]; // X, Y, clip-W — row 2 (Z) is never needed.
  for (let r = 0; r < 3; r++) {
    const k = cameraRows[r];
    const k0 = camera[k * 4];
    const k1 = camera[k * 4 + 1];
    const k2 = camera[k * 4 + 2];
    const k3 = camera[k * 4 + 3];
    for (let j = 0; j < 4; j++) {
      out[r * 5 + j] =
        k0 * rotorProj[j] + k1 * rotorProj[5 + j] + k2 * rotorProj[10 + j];
    }
    out[r * 5 + 4] =
      k0 * rotorProj[4] + k1 * rotorProj[9] + k2 * rotorProj[14] + k3;
  }
  // Row S: the rotor projection's row 3, untouched by the camera.
  out[15] = rotorProj[15];
  out[16] = rotorProj[16];
  out[17] = rotorProj[17];
  out[18] = rotorProj[18];
  out[19] = rotorProj[19];
  return out;
}

/**
 * The soft w-slice window (fr-6x2): a Gaussian opacity centered on `center`
 * with standard-deviation-like `width`, floored at `floor` so the rest of the
 * cloud stays visible as ghost context outside the slice. CPU twin of the
 * GLSL slice in `scene.ts`'s `FOUR_D_VERTEX` (`slice = floor + (1 − floor) *
 * exp(-0.5 * d * d)` where `d = (s − uSliceCenter) / uSliceWidth`) — keep the
 * two in sync. The flame render passes `floor = 0.06` to match the point-
 * cloud view's ghost-context floor exactly; the solid (voxel) render passes
 * `floor = 0` (an outside-the-slice voxel contributes nothing at all, since
 * voxel accumulation has no translucency to fall back on).
 */
export function sliceWeight(
  s: number,
  center: number,
  width: number,
  floor: number,
): number {
  const d = (s - center) / width;
  return floor + (1 - floor) * Math.exp(-0.5 * d * d);
}

/**
 * The frozen 4D view parameters a render (flame or solid, fr-5b3/fr-4wd) was
 * entered with — moved here from `flame-4d.ts` since it describes projection
 * state, not anything specific to the flame accumulator: everything
 * `accumulateFlame4`/`accumulateVoxels4` need to reproduce `scene.ts`'s
 * `FOUR_D_VERTEX` shader's signed-w normalization and soft w-slice, held
 * constant for the whole accumulation (unlike the live point-cloud view,
 * whose rotor/support amplitude are recomputed every frame as the tumble
 * advances).
 */
export interface FourDView {
  /**
   * `1 / wSupport(rotor, halfExtents)` at render-entry — see
   * `src/app/rotor4.ts`'s `wSupport` and `scene.ts`'s `uInvWAmp4` uniform.
   * The per-point signed-w signal is `s = clamp(sRaw * invWAmp, -1, 1)`,
   * exactly the shader's `s = clamp(q.w * uInvWAmp4, -1.0, 1.0)`.
   */
  invWAmp: number;
  /** Whether the soft w-slice window is active — mirrors `scene.ts`'s
   * `uSliceOn` uniform. `false` skips {@link sliceWeight} entirely, so every
   * point contributes at full weight. */
  sliceOn: boolean;
  /** Slice center in the normalized signed-w signal `s` — `scene.ts`'s
   * `uSliceCenter`. */
  sliceCenter: number;
  /** Slice width (Gaussian falloff) — `scene.ts`'s `uSliceWidth`, sent as a
   * plain number (the main thread reads `FOUR_D_SLICE_WIDTH`). */
  sliceWidth: number;
  /** Whether the w-ramp color modes recenter their ramp on the slice window
   * (fr-nn6) — see {@link sliceColorRemap}. Meaningless (and ignored, via
   * that function's `sliceOn` gate) while the slice is off. */
  sliceRelativeColor: boolean;
}

/**
 * How far out into the slice's Gaussian falloff the slice-relative w-ramp
 * (fr-nn6) reaches before saturating: the ramp's full `[-1, 1]` spans
 * `±SLICE_COLOR_SPAN` slice-widths around the slice center. 2 puts the
 * palette's saturated ends at the faint outer edge of the visible
 * cross-section (pure Gaussian weight `exp(-2) ≈ 0.135`), so essentially the
 * whole visible slice traverses the whole diverging palette; anything
 * further out — ghost context — clamps to the full side color, which still
 * reads as "beyond the slice, on this side".
 */
export const SLICE_COLOR_SPAN = 2;

/**
 * The slice-relative w-ramp recolor (fr-nn6) as an affine remap of the
 * normalized signed-w signal `s`: the "wRamp" color paths evaluate their
 * diverging palette at `clamp((s - shift) * invScale, -1, 1)` instead of at
 * `s` itself. With the w-slice on, everything visible sits near `s =
 * sliceCenter`, so a slice at 0 renders almost entirely the ramp's dim-gray
 * notch; recentering on `sliceCenter` and rescaling by {@link
 * SLICE_COLOR_SPAN} slice-widths keeps the full diverging palette in play
 * within the visible cross-section. The slice WEIGHT ({@link sliceWeight})
 * is deliberately untouched — this remaps color only.
 *
 * Returns the identity remap (`shift = 0`, `invScale = 1`) unless the slice
 * is on AND the option is chosen, so every consumer can apply the remap
 * unconditionally (branchless in the hot loops/kernels) and still be
 * bit-identical to the raw `s` when it's off (`s` is already clamped).
 *
 * The ONE definition of both the gate and the mapping: the CPU accumulators
 * (`flame-4d.ts`, `voxel-4d.ts`), the GPU params packer (`flame-gpu-4d.ts`),
 * and the live point-cloud shader's uniforms (`scene.ts`'s `setFourDSlice`)
 * all call this, so the four coloring paths can never drift on when or how
 * the remap applies — only the trivial `clamp((s - shift) * invScale)`
 * evaluation is mirrored in GLSL/WGSL.
 */
export function sliceColorRemap(
  view: Pick<
    FourDView,
    "sliceOn" | "sliceRelativeColor" | "sliceCenter" | "sliceWidth"
  >,
): { shift: number; invScale: number } {
  if (!view.sliceOn || !view.sliceRelativeColor) {
    return { shift: 0, invScale: 1 };
  }
  return {
    shift: view.sliceCenter,
    invScale: 1 / (SLICE_COLOR_SPAN * view.sliceWidth),
  };
}
