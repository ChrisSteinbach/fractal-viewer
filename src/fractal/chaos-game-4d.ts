import { applyAffine4, composeAffine4 } from "./affine4";
import type { Affine4 } from "./affine4";
import { ESCAPE_LIMIT, MAX_TRANSFORMS, WARMUP_ITERATIONS } from "./chaos-game";
import { composeVariations4 } from "./variations4";
import type { VariationBlend4 } from "./variations4";
import type { Rng } from "./rng";
import type { Bounds4, Transform4, Vec4 } from "./types";

/**
 * # 4D chaos game (fr-cbg spike; variations + lens in fr-hy8)
 *
 * A dedicated, self-contained 4D path that mirrors the SHAPE of
 * `chaos-game.ts`'s {@link import("./chaos-game").runChaosGame} but does not try
 * to share its code. The house style deliberately prefers a hand-unrolled path
 * per dimension over an `n`-generic abstraction: the inner loop is the hottest
 * code in the app, and an unrolled 4-coordinate step (no arrays, no dimension
 * loop) stays branch-predictable and lets V8 keep the orbit in registers — the
 * same reason `chaos-game.ts` unrolls its 3-coordinate step. So this file
 * intentionally duplicates the escape/reseed and weighted-pick logic rather than
 * generalising `chaos-game.ts`. The few genuinely-shared *constants*
 * (`WARMUP_ITERATIONS`, `ESCAPE_LIMIT`, `MAX_TRANSFORMS`) ARE imported from
 * there, so the two paths can never drift on those.
 *
 * The path carries the same nonlinear apparatus the 3D path has: per-transform
 * {@link composeVariations4} blends (applied after each map's affine, before the
 * escape check) and an optional plot-time final-transform lens — so an embedded
 * 3D system reproduces its warps and lens faithfully. A system with no
 * variations and no lens takes the exact same code path, and consumes the RNG
 * identically, as before those were added (the blend/lens are `null`). Symmetry
 * is still 3D-only.
 */

/**
 * Result of running the 4D chaos game: the cloud split into a shader-ready
 * interleaved `xyz` buffer and a separate `w` buffer, plus bounds and a framing
 * sphere.
 */
export interface ChaosGame4Result {
  /** Interleaved xyz positions, length `count * 3` (shader-ready as-is). */
  positions: Float32Array;
  /**
   * The fourth coordinate per point, length `count`. Kept SEPARATE from
   * `positions` so the scene can upload it as its own vertex attribute with
   * zero repacking — the renderer colours by `w` while positioning by `xyz`.
   */
  w: Float32Array;
  /** Index of the transform that produced each point, length `count`. */
  transformIndices: Uint8Array;
  /** Number of points generated. */
  count: number;
  /**
   * Axis-aligned extent of the cloud (all four coordinates). The box's
   * half-extents also drive the shader's rotation-covariant w-colour
   * amplitude (fr-9bk).
   */
  bounds: Bounds4;
  /** Center of the bounds box. */
  center: Vec4;
  /**
   * EXACT maximum Euclidean 4D distance from {@link center} over every emitted
   * point (not the box half-diagonal bound). Rotation-invariant under any 4D
   * view rotation about `center`, so a bounding sphere of this radius stays
   * valid — and the camera can frame it once — at every tumble angle without
   * re-running as the view turns (frustum culling in `setPoints4`, framing in
   * `main.ts`'s `fourDFramingBounds`).
   */
  radius: number;
}

function emptyBounds4(): Bounds4 {
  return {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: 0,
    minW: 0,
    maxW: 0,
  };
}

function emptyResult(): ChaosGame4Result {
  return {
    positions: new Float32Array(0),
    w: new Float32Array(0),
    transformIndices: new Uint8Array(0),
    count: 0,
    bounds: emptyBounds4(),
    center: [0, 0, 0, 0],
    radius: 0,
  };
}

/**
 * Run a 4D iterated function system with the chaos game — the 4D sibling of
 * {@link import("./chaos-game").runChaosGame}. Starting from a random seed
 * point, repeatedly pick a random transform (weighted by
 * {@link Transform4.weight}), apply its composed affine and then its nonlinear
 * {@link composeVariations4} blend, and record each landing spot; the cloud
 * converges on the system's 4D attractor.
 *
 * An optional `finalTransform` is applied to every point *as it is plotted*
 * (fractal-flame terminology) — a lens over the whole cloud that never feeds
 * back into the orbit, exactly like the 3D path's final transform. Omit it (or
 * pass `null`) and the recording loop takes the same path, and consumes the RNG
 * identically, as without it.
 *
 * Pass a seeded {@link Rng} for reproducible output (tests); the app passes
 * `Math.random`. Returns an empty result (zero-length arrays, zero bounds,
 * origin center, radius 0) when there are no transforms or no points requested,
 * mirroring the 3D path. Throws `RangeError` past {@link MAX_TRANSFORMS} (the
 * Uint8 transform-index cap), like `prepareChaosGame`.
 */
export function runChaosGame4(
  transforms: Transform4[],
  numPoints: number,
  rng: Rng = Math.random,
  finalTransform: Transform4 | null = null,
): ChaosGame4Result {
  if (transforms.length === 0 || numPoints <= 0) {
    return emptyResult();
  }
  if (transforms.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms.length}`,
    );
  }

  // Compose every affine once up front (never per-iteration), the same
  // amortisation `prepareChaosGame` does for the 3D path. Alongside each, its
  // nonlinear variation blend or `null` for a purely-affine map — every entry
  // is `null` for the existing presets, so those take the exact same (RNG-
  // identical) path as before variations existed.
  const affines: Affine4[] = transforms.map(composeAffine4);
  const variations: (VariationBlend4 | null)[] = transforms.map((t) =>
    composeVariations4(t.variations),
  );
  const n = affines.length;

  // The optional plot-time lens: one more affine + variation blend applied only
  // when a point is recorded, never fed back into the orbit. Both stay `null`
  // when there is no final transform, so the recording loop keeps its old path.
  const finalAffine = finalTransform ? composeAffine4(finalTransform) : null;
  const finalWarp = finalTransform
    ? composeVariations4(finalTransform.variations)
    : null;

  // Weighted-selection table, replicating `chaos-game.ts`'s `pickIndex` logic
  // locally (copied, not abstracted — see this file's header). When every
  // weight is 1 we keep the plain uniform `Math.floor(rng() * n)` draw so a
  // uniform system consumes the RNG identically to the obvious code; only a
  // genuinely weighted system pays for the cumulative table + binary search.
  const weights = transforms.map((t) => t.weight ?? 1);
  let totalWeight = 0;
  const cumulative = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    totalWeight += weights[i];
    cumulative[i] = totalWeight;
  }
  const weighted =
    weights.some((wt) => wt !== 1) &&
    totalWeight > 0 &&
    Number.isFinite(totalWeight);

  // Local `pickIndex` twin (see `chaos-game.ts`'s `pickIndex`): uniform draw
  // for the common all-unit-weight case, else lower-bound binary search over
  // the cumulative weights.
  const pick = (): number => {
    if (!weighted) return Math.floor(rng() * n);
    const r = rng() * totalWeight;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (r < cumulative[mid]) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const positions = new Float32Array(numPoints * 3);
  const wBuffer = new Float32Array(numPoints);
  const transformIndices = new Uint8Array(numPoints);

  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  let w = rng() - 0.5;

  // Warm up so the orbit settles onto the attractor before we start recording.
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const idx = pick();
    const p = applyAffine4(affines[idx], x, y, z, w);
    x = p[0];
    y = p[1];
    z = p[2];
    w = p[3];
    // Nonlinear warp after the affine (a singular warp can send a point to
    // NaN/±∞, which the escape guard below then catches). null ⇒ no warp, no
    // RNG draw — the pre-variations path exactly.
    const warp = variations[idx];
    if (warp !== null) {
      const q = warp(x, y, z, w, rng);
      x = q[0];
      y = q[1];
      z = q[2];
      w = q[3];
    }
    // stepOrbit's escape semantics, extended to w: reseed all four coords if
    // any is non-finite or escapes the bound.
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(w) ||
      Math.abs(x) > ESCAPE_LIMIT ||
      Math.abs(y) > ESCAPE_LIMIT ||
      Math.abs(z) > ESCAPE_LIMIT ||
      Math.abs(w) > ESCAPE_LIMIT
    ) {
      x = rng() - 0.5;
      y = rng() - 0.5;
      z = rng() - 0.5;
      w = rng() - 0.5;
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minW = Infinity;
  let maxW = -Infinity;

  for (let i = 0; i < numPoints; i++) {
    const idx = pick();
    const p = applyAffine4(affines[idx], x, y, z, w);
    x = p[0];
    y = p[1];
    z = p[2];
    w = p[3];
    const warp = variations[idx];
    if (warp !== null) {
      const q = warp(x, y, z, w, rng);
      x = q[0];
      y = q[1];
      z = q[2];
      w = q[3];
    }
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(w) ||
      Math.abs(x) > ESCAPE_LIMIT ||
      Math.abs(y) > ESCAPE_LIMIT ||
      Math.abs(z) > ESCAPE_LIMIT ||
      Math.abs(w) > ESCAPE_LIMIT
    ) {
      x = rng() - 0.5;
      y = rng() - 0.5;
      z = rng() - 0.5;
      w = rng() - 0.5;
    }

    // The plotted point is the orbit point, optionally bent through the lens
    // (final transform's affine + warp). The orbit state x/y/z/w is left
    // untouched, so the lens never feeds back into the iteration; the bent point
    // is adopted only while all four coordinates stay finite, otherwise the
    // orbit point is plotted so a singular lens never leaks NaN/±∞.
    let px = x;
    let py = y;
    let pz = z;
    let pw = w;
    if (finalAffine !== null) {
      const f = applyAffine4(finalAffine, x, y, z, w);
      let fx = f[0];
      let fy = f[1];
      let fz = f[2];
      let fw = f[3];
      if (finalWarp !== null) {
        const fq = finalWarp(fx, fy, fz, fw, rng);
        fx = fq[0];
        fy = fq[1];
        fz = fq[2];
        fw = fq[3];
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

    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    wBuffer[i] = pw;
    transformIndices[i] = idx;

    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
    if (pw < minW) minW = pw;
    if (pw > maxW) maxW = pw;
  }

  const center: Vec4 = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
    (minW + maxW) / 2,
  ];

  // Second pass: the EXACT max Euclidean distance from center (see `radius`
  // doc). Reads the Float32-rounded values we actually emitted, so the radius
  // genuinely bounds the stored cloud rather than the pre-rounding orbit.
  let radiusSq = 0;
  for (let i = 0; i < numPoints; i++) {
    const dx = positions[i * 3] - center[0];
    const dy = positions[i * 3 + 1] - center[1];
    const dz = positions[i * 3 + 2] - center[2];
    const dw = wBuffer[i] - center[3];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 > radiusSq) radiusSq = d2;
  }
  const radius = Math.sqrt(radiusSq);

  return {
    positions,
    w: wBuffer,
    transformIndices,
    count: numPoints,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW },
    center,
    radius,
  };
}
