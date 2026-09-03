/**
 * The fractal-flame renderer's pure core: accumulate chaos-game iterations
 * into a 2D histogram (hit count + summed color per pixel bucket) and
 * tone-map that histogram to a displayable image. No Three.js, no DOM — the
 * app layer (`src/app/scene.ts`) supplies a frozen camera's projection
 * matrix as plain numbers and uploads the tone-mapped image to a texture.
 *
 * `accumulateFlame` drives the exact same stepping logic as the point-cloud
 * path (`stepOrbit` / `plotPoint` from `chaos-game.ts`) but hand-inlines
 * their bodies into one allocation-free loop: at the hundreds of millions of
 * iterations a converged flame needs, the objects and arrays those functions
 * allocate per call (an `OrbitStep`, `applyAffine`'s returned `Vec3`,
 * `plotPoint`'s returned `Vec3`) become real GC pressure inside a
 * `requestAnimationFrame` budget. The inlined loop is checked against the
 * real `stepOrbit`/`plotPoint` by an oracle test in `flame.test.ts` — see
 * "matches stepOrbit/plotPoint exactly" — so the two paths can never
 * silently drift apart.
 *
 * **Balloon echo.** An optional {@link FlameBalloonEcho} deposits each
 * plotted point's sphere inversion into this SAME histogram, immediately
 * after the source point. The echo is not a second image composited later:
 * its weighted hits and tint-mixed color sums participate in the one shared
 * density field and the one shared tone map. Unlike the live Points arm, a
 * histogram deliberately carries NO conformal-magnification term. Density is
 * already the measure: inversion spreads or concentrates samples by where
 * they land, so scaling a point sprite and compensating its brightness would
 * count that Jacobian twice.
 *
 * There is deliberately NO radial fade either. The flame camera/framing is
 * frozen before accumulation begins, and inverted points outside that
 * frustum are simply not deposited, so arbitrarily distant near-centre
 * images cannot drag any bounds. The executable sheet measured the Points
 * arm's fade on/off over three systems: at the 0.9x comparison radius it
 * touched no visible deposits; at the persisted 1.6x rest pose its visible
 * mass ratio was 0.987449 / 0.115876 / 1.000000, erasing 88.4% of the fern's
 * still-on-screen cave wall. With no later bounds fit to protect, that is lost
 * feature rather than safety. CPU inversion goes through
 * `balloon-de.ts`'s {@link invertBalloon}, retaining its float64
 * `BALLOON_CENTER_FLOOR` rather than restating the algebra or borrowing the
 * GPU's coarser float32 floor.
 *
 * **The tone-map anchor is the MEAN deposited density, not the hottest
 * bucket.** {@link tonemapFlame}'s density curve reads `log1p(h / mean) /
 * log1p(FLAME_DENSITY_SATURATION)`, where `mean` is {@link FlameHistogram.hitMass}
 * (the exact running sum of deposited hit weights) divided by the bucket
 * count. Anchoring on the hottest bucket instead made whole-image brightness a
 * function of that single bucket: one contractive map's tiny image region
 * drove max/mean to 21356 and crushed the frame, and a converging render never
 * settled in appearance (max/mean drifted 20.5 -> 13.6 -> 10.0 across a 16x
 * budget ladder on one system — more iterations dimmed the image even though
 * the object was the same). The ratio form is invariant under more
 * iterations, under supersample pooling (the downsamplers write weighted
 * MEANS — hits and mass stay proportional), and under tiling/echo deposit
 * weights (they raise hits and mass in lockstep), so a render's exposure no
 * longer moves while it converges. See {@link FLAME_DENSITY_SATURATION} for
 * the constant and its calibration.
 */
import {
  CHAOS_SUB_ORBIT_POINTS,
  ESCAPE_LIMIT,
  WARMUP_ITERATIONS,
  createEmitterStream,
  emitterSeed,
  pickIndex,
  pickScheduleIndex,
  stepOrbit,
} from "./chaos-game";
import type { PreparedChaosGame } from "./chaos-game";
import { balloonPaletteCoordinate, invertBalloon } from "./balloon-de";
import type { Balloon } from "./balloon-de";
import {
  POINT_TILING_ACCUMULATION_FANOUT_CAP,
  createPointTilingCursorState,
  visitPointTilingAttemptBounded,
} from "./point-tiling";
import type {
  PointTilingCursorState,
  PointTilingImageVisitor,
  PointTilingPlan,
} from "./point-tiling";
import type { Rng } from "./rng";
import type { Vec3 } from "./types";

/**
 * A 4x4 matrix, row-major and flattened: `m[0..3]` is row 0, `m[4..7]` row 1,
 * `m[8..11]` row 2, `m[12..15]` row 3 (`m[r * 4 + c]` is row `r`, column `c`).
 * Applying it to a point computes clip-space `(cx, cy, cz, cw) = m · (x, y,
 * z, 1)`. `accumulateFlame` expects the camera's combined `projection *
 * view` matrix, so `cw` is positive exactly when the point is in front of
 * the camera (standard OpenGL/Three.js clip space).
 *
 * Plain `number[]`, not Three.js's `Matrix4` (which stores column-major, the
 * transpose of this) — `src/fractal/` stays dependency-free, so the app
 * layer is responsible for extracting and transposing the camera matrix
 * (`Matrix4.clone().transpose().elements` does exactly that).
 */
export type Mat4 = number[];

/**
 * The production histogram weight of one balloon-echo splat relative to its
 * source splat. Kept independent from the live Points arm's additive-blend
 * dim constant: under the flame's logarithmic density tone map, a half-weight
 * echo remains substantially brighter than half intensity in established
 * buckets, so copying `0.5` does not buy the additive arm's highlight safety.
 * `scripts/flame-balloon.harness.ts` measured 0.25 / 0.5 / 1.0 across three
 * structurally different flames: full weight gave the closest echo/source
 * luminance balance with zero near-white pixels and essentially unchanged
 * source luminance. One plotted point therefore deposits one real echo splat.
 * The field on {@link FlameBalloonEcho} stays overridable so the executable
 * measurement and CPU/GPU agreement tests can exercise alternatives.
 */
export const DEFAULT_FLAME_BALLOON_ECHO_WEIGHT = 1;

/**
 * Optional sphere-inverted echo deposited by {@link accumulateFlame} and
 * `flame-4d.ts`'s `accumulateFlame4` into the SAME histogram as the primary
 * flame. `balloon.R` follows `buildBalloon`'s convention (`rMult` times the
 * source ball's raw radius); the caller derives that ball once from the exact
 * explorer cloud it is rendering. `tintStrength` is the authored `[0, 1]`
 * mix amount, applied to the echo color only and before `weight` is deposited.
 * Omit this whole object when the echo is off: that preserves the pre-balloon
 * accumulation path byte for byte.
 */
export interface FlameBalloonEcho {
  balloon: Balloon;
  tint: Vec3;
  tintStrength: number;
  weight: number;
}

/**
 * A 2D density accumulation: one bucket per pixel of the target image, each
 * tracking how many iterations landed there and their summed color (so the
 * average — `sumRGB / hits` — is the bucket's color). Both `hits` and
 * `sumRGB` are `Float64Array`, not `Float32Array`, because a single hot
 * bucket in a converged render can exceed 2^24 — the point past which
 * `Float32` can no longer represent every integer exactly, and, worse, where
 * its ULP exceeds 1: once `sumRGB[o]` (which accumulates an O(1) palette
 * channel per hit) passes that magnitude in `Float32`, `+=` increments
 * smaller than the local ULP round away to a complete no-op, so the sum
 * *stops growing* while `hits` (correctly `Float64`) keeps climbing —
 * `sumRGB / hits` then systematically undershoots, desaturating and
 * darkening exactly the hottest, most-converged bucket toward black. That
 * is precisely the region this renderer (and the higher iteration counts
 * progressive rendering pushes toward) is built to render brightest, so the
 * extra memory (~2x `sumRGB`'s share — roughly 66 MB total at 1920x1080)
 * buys
 * correctness where it matters most, not just cosmetic precision.
 *
 * Pass a histogram back into {@link accumulateFlame} to keep converging it —
 * see {@link createFlameHistogram} and {@link accumulateFlame}'s `orbit`
 * field for how a chunked render resumes.
 */
export interface FlameHistogram {
  width: number;
  height: number;
  /** Hit count per bucket, row-major (`row * width + col`), length `width * height`. */
  hits: Float64Array;
  /** Summed color per bucket, interleaved RGB, length `width * height * 3`. */
  sumRGB: Float64Array;
  /**
   * The running sum of DEPOSITED hit weights — the exact sum of the `hits`
   * array at any moment the same sites write both (tiling mirror deposits and
   * the balloon echo's second splat included), so the mean
   * `hitMass / (width * height)` is the actual mean of the `hits` array and
   * `h / mean` in {@link tonemapFlame} is a pure ratio. "Samples per pixel"
   * is deliberately NOT the definition: weighted deposits (density
   * estimation, tiling, the echo) make a plot count ambiguous and would fork
   * CPU/GPU definitions, while mass is derivable from the histogram itself
   * on both engines. Maintained at every deposit site, recomputed exactly by
   * both downsamplers and all four GPU converters (each already walks every
   * output bucket for `maxHits`), and pinned by an invariant test —
   * `sum(hist.hits) === hist.hitMass` within fp tolerance — so a missed site
   * fails loudly.
   */
  hitMass: number;
  /**
   * Highest hit count seen in any bucket so far. INSTRUMENT ONLY — it no
   * longer anchors {@link tonemapFlame} (the log-density curve now
   * normalizes on the mean deposited density, see {@link hitMass}); it stays
   * because diagnostics read it (gpu-bench's agreement legs report
   * maxHits CPU/GPU, the tiling sheets report it per pose) and its
   * maintenance sites are the cheapest per-bucket scan the converters and
   * downsamplers already perform.
   */
  maxHits: number;
  /**
   * Orbit continuation point: where the chaos-game iterator left off. Not
   * part of the image — internal iterator state that lets a chunked,
   * progressive render (repeated {@link accumulateFlame} calls passing the
   * same histogram back in) resume the exact same orbit instead of
   * restarting — and rewarming — it every chunk.
   */
  orbit: Vec3;
  /**
   * The orbit's color coordinate (flam3 semantics): a value in `[0, 1]` that
   * blends toward the picked transform's slot each step, indexing a smooth
   * gradient palette when {@link accumulateFlame} is given a `colorLUT`. Kept
   * on the histogram — alongside {@link orbit} — so a chunked render resumes
   * the exact same color walk; only read/written on the `colorLUT` path (it
   * stays at its `0.5` default in the per-transform `"legacy"` mode). NOT
   * folded into `orbit` because it is not a spatial coordinate.
   */
  orbitColor: number;
  /**
   * The 4D orbit's fourth-coordinate continuation — `flame-4d.ts`'s
   * `accumulateFlame4` twin of {@link orbit}'s `x`/`y`/`z`, kept here (rather
   * than a fourth slot on `orbit` itself) so `orbit` stays exactly the `Vec3`
   * every 3D caller already expects. Used ONLY by `accumulateFlame4`; stays at
   * its `0` default on the 3D path (`accumulateFlame` never reads or writes
   * it), so nothing here changes for any existing caller.
   */
  orbitW: number;
  /**
   * Graph-directed selection continuation: the BASE index of the last
   * applied map (`-1` = entry pick — the fresh-histogram default, and what
   * an escape-reseed resets to). Only meaningful when the prepared system
   * carries chi rows; a chi-free accumulation never reads it. Kept on the
   * histogram — like {@link orbit}/{@link orbitColor} — so a chunked render
   * resumes the exact same selection walk.
   */
  orbitPrevBase: number;
  /**
   * Plotted points remaining in the current chaos SUB-ORBIT before the next
   * re-fuse (`chaos-game.ts`'s {@link CHAOS_SUB_ORBIT_POINTS}, the
   * fresh-histogram default — the opening warm-up IS sub-orbit 0's fuse).
   * Persisted here — NOT worker-local — so the re-fuse cadence is a pure
   * function of accumulated iterations, independent of worker CHUNK
   * boundaries (chunk sizes vary per frame budget; the rendered object must
   * not). Only meaningful on the chi path, like {@link orbitPrevBase}.
   */
  orbitChaosLeft: number;
  /**
   * Plot-time tiling continuation. Lazily attached only when an active
   * {@link PointTilingPlan} is supplied, so every untiled histogram retains
   * its historical runtime shape. Credit and cursor live beside the orbit so
   * progressive chunk boundaries cannot change the weighted image sequence.
   */
  pointTiling?: PointTilingCursorState;
}

/** A fresh, empty histogram: every bucket at zero hits, ready to accumulate into. */
export function createFlameHistogram(
  width: number,
  height: number,
): FlameHistogram {
  return {
    width,
    height,
    hits: new Float64Array(width * height),
    sumRGB: new Float64Array(width * height * 3),
    maxHits: 0,
    hitMass: 0,
    orbit: [0, 0, 0],
    orbitColor: 0.5,
    orbitW: 0,
    orbitPrevBase: -1,
    orbitChaosLeft: CHAOS_SUB_ORBIT_POINTS,
  };
}

/**
 * Wrap externally-owned bucket arrays as a {@link FlameHistogram} — the
 * shared-memory counterpart to {@link createFlameHistogram}. Exists for the
 * flame worker's SharedArrayBuffer transport, where `hits`/`sumRGB`
 * are views over memory shared between the worker (which downsamples into
 * them) and the main thread (which tone-maps straight out of them): both
 * sides need the same wrapper, and neither should have to know that `orbit`/
 * `orbitColor` are meaningless filler on a display-only histogram (see
 * `downsampleFlame`'s closing comment for why).
 *
 * `maxHits`/`hitMass` are parameters (not recomputed) because the caller —
 * the shared-frame notification, or a GPU readback converter — already knows
 * both scalars for the array it is handing over; `hitMass` is the tone-map's
 * normalizer and MUST be the sum of the wrapped `hits` (the worker's
 * downsamplers and GPU converters maintain it exactly like `maxHits`), or
 * every bucket's density — and with it the whole image's brightness —
 * shifts.
 */
export function viewFlameHistogram(
  width: number,
  height: number,
  hits: Float64Array,
  sumRGB: Float64Array,
  maxHits: number,
  hitMass: number,
): FlameHistogram {
  return {
    width,
    height,
    hits,
    sumRGB,
    maxHits,
    hitMass,
    orbit: [0, 0, 0],
    orbitColor: 0.5,
    orbitW: 0,
    orbitPrevBase: -1,
    orbitChaosLeft: CHAOS_SUB_ORBIT_POINTS,
  };
}

/**
 * Largest integer supersample factor `<= requested` (and always `>= 1`)
 * whose accumulation buckets — `(width * ss) * (height * ss)` — fit within
 * `maxBuckets`. `width`/`height` are the DISPLAY resolution (already
 * whatever the device's pixel ratio made it — see the app layer's
 * `flameRenderSize`), so supersample multiplies an already-device-scaled
 * size; on a hi-DPI display this can demand a single, huge `Float64Array`
 * allocation before the user-chosen supersample factor even applies. This
 * caps that proactively — a fixed byte budget divided among what
 * `createFlameHistogram` actually allocates (`hits` + `sumRGB`, both
 * `Float64`) turns into a bucket-count ceiling the caller passes in.
 *
 * A tiny loop, not a closed-form `sqrt`, because `requested` is always a
 * small integer (a handful at most) in practice — clearer to read as "try
 * each size down from what was asked" than to reason about rounding at a
 * `Math.sqrt` boundary.
 */
export function clampSupersampleToBudget(
  width: number,
  height: number,
  requested: number,
  maxBuckets: number,
): number {
  const start = Math.max(1, Math.floor(requested));
  if (width <= 0 || height <= 0) return start;
  for (let ss = start; ss > 1; ss--) {
    if (width * ss * (height * ss) <= maxBuckets) return ss;
  }
  return 1;
}

/** Color for a transform index outside `palette` — shouldn't happen; mirrors `buildColors`' fallback. */
const FALLBACK_COLOR: Vec3 = [1, 1, 1];

/**
 * Accumulate `iterations` more chaos-game steps into a 2D histogram, seen
 * through a frozen camera. Each plotted point (`stepOrbit` + `plotPoint`,
 * exactly as the point-cloud path computes them) is projected by `projection`
 * (clip space, perspective-divided to NDC) and, if it lands in front of the
 * camera and inside the `width` x `height` frame, increments that pixel's
 * hit count and adds a color to its color sum.
 *
 * **Coloring** has two modes. By default the added color is
 * `palette[transformIndex]` — the flat per-transform hue ("legacy"). Pass a
 * `colorLUT` (a `256 * 3` interleaved RGB table from `palette.ts`'s
 * `buildPaletteLUT`) to switch to flam3-style structural coloring instead: a
 * color coordinate `c` in `[0, 1]` rides along the orbit — initialised to
 * `0.5` and, each step, blended toward the picked transform's palette slot
 * (`c ← c·(1 - speed) + slot·speed`, both resolved per base map by
 * `prepareChaosGame` from the transform's optional `colorIndex`/`colorSpeed`
 * — absent ⇒ the even spread `i / (n - 1)` and speed `0.5`, i.e. the halfway
 * blend this had hard-coded before those fields existed) — and the LUT
 * color at `c` is accumulated, so color flows continuously along the
 * structure. Updating `c` consumes NO `rng`, so a given seed produces the
 * byte-identical *orbit* (and thus identical `hits`) whether or not a
 * `colorLUT` is supplied; only the color sums differ. An escape-reseed resets
 * `c` to `0.5` alongside the point. `palette` is still required (and used when
 * `colorLUT` is omitted).
 *
 * **Balloon coloring** is independent. With `echo` present, omit
 * `echoColorLUT` to inherit the primary splat's color exactly. Supplying a
 * 256-entry RGB LUT samples it at the pre-inversion source coordinate
 * `clamp(length(source - echo.balloon.center) / echo.balloon.rho, 0, 1)`;
 * that sampled color is tinted and then multiplied by `echo.weight` during
 * accumulation. The primary splat never reads this LUT.
 *
 * **Progressive**: pass the histogram returned by a previous call back in as
 * `histogram` to keep converging the same image — the orbit (and its color
 * coordinate) resumes from exactly where it left off (see
 * {@link FlameHistogram.orbit} / {@link FlameHistogram.orbitColor}), so
 * splitting a run into chunks (e.g. one per animation frame) produces the
 * identical result as running all the iterations at once, given the same `rng`
 * *instance* threaded through every call. Omit `histogram` to start a fresh
 * one: a new random seed point is drawn from `rng` and warmed up for
 * {@link WARMUP_ITERATIONS} steps first (unrecorded), exactly like
 * `runChaosGame`, so the orbit is already on the attractor before anything
 * is plotted.
 *
 * **Symmetry**: when `prepared` was built with rotated copies (see
 * `chaos-game.ts`'s `prepareChaosGame`), this hand-inlined loop mirrors
 * `stepOrbit`'s handling exactly — the picked slot's rotation bends the
 * orbit-feedback point, and `palette`/the colorLUT slot both key on the
 * BASE map a slot is a copy of, never the expanded slot — so a converged
 * flame render shows the same kaleidoscope as the live point cloud.
 *
 * Pass a seeded {@link Rng} for reproducible output (tests); the app passes
 * `Math.random`.
 *
 * Pass `tilingPlan` to filter each already-plotted canonical point and
 * deposit its bounded weighted finite/lattice images. Images never feed back
 * into the orbit and consume no chaos RNG. The plan is deliberately the last
 * optional argument, and its state is attached lazily to the histogram, so
 * omitting it preserves the original accumulation path and histogram shape.
 */
export function accumulateFlame(
  prepared: PreparedChaosGame,
  projection: Mat4,
  width: number,
  height: number,
  iterations: number,
  rng: Rng,
  palette: Vec3[],
  histogram?: FlameHistogram,
  colorLUT?: Float32Array,
  echo?: FlameBalloonEcho,
  echoColorLUT?: Float32Array,
  tilingPlan?: PointTilingPlan,
): FlameHistogram {
  if (projection.length !== 16) {
    throw new RangeError(
      `accumulateFlame: projection must have 16 entries (row-major 4x4), got ${projection.length}`,
    );
  }
  const hist = histogram ?? createFlameHistogram(width, height);
  if (hist.width !== width || hist.height !== height) {
    throw new RangeError(
      `accumulateFlame: histogram is ${hist.width}x${hist.height}, but ${width}x${height} was requested`,
    );
  }
  if (tilingPlan !== undefined && tilingPlan.dimension !== 3) {
    throw new RangeError("3D flame requires a 3D point-tiling plan");
  }
  if (tilingPlan !== undefined && echo !== undefined) {
    throw new RangeError("Flame point tiling is unavailable with Balloon");
  }
  if (
    tilingPlan !== undefined &&
    prepared.transformCount !== prepared.baseTransformCount
  ) {
    throw new RangeError(
      "Flame point tiling is unavailable with kaleidoscope symmetry above order 1",
    );
  }
  const pointTiling =
    tilingPlan === undefined
      ? undefined
      : (hist.pointTiling ??= createPointTilingCursorState());

  const { affines, variations, postRotations, finalAffine, finalWarp } =
    prepared;
  const { baseTransformCount, schedule, emitters } = prepared;
  const { hits, sumRGB } = hist;
  let maxHits = hist.maxHits;
  // The tone-map normalizer's input: every deposit below adds its weight
  // here, exactly alongside the maxHits update it sits beside.
  let hitMass = hist.hitMass;
  // Emitter-sample stream — runChaosGame's per-run reseedable object, one
  // primary seed draw per emitter step (chaos-game.ts's emitterSeed). Inert
  // without emitters.
  const emitterStream = createEmitterStream();
  const emitterDraw = emitterStream.draw;

  // Structural coloring: when a colorLUT is supplied, `c` rides the
  // orbit and indexes the gradient; otherwise every `colorLUT !== undefined`
  // branch below is skipped and the per-transform `palette` path runs
  // unchanged. The per-map slot and blend speed were resolved once by
  // `prepareChaosGame` — a transform's authored `colorIndex`/
  // `colorSpeed`, or the derived even spread and 0.5 halfway blend that were
  // hard-coded here before those fields existed. Both are keyed on
  // `baseTransformCount`, not `transformCount`: with symmetry, every
  // rotated copy of a base map shares that map's slot, so the gradient repeats
  // around the kaleidoscope instead of smearing continuously across copies
  // that are geometrically the same map.
  const colorSlots = prepared.colorIndex;
  const colorSpeeds = prepared.colorSpeed;
  let c = hist.orbitColor;
  // Reused only on the echo path. `invertBalloon` accepts the caller-owned
  // output specifically so enabling balloon does not reintroduce two Vec3
  // allocations per iteration into this otherwise allocation-free hot loop.
  const echoSource: Vec3 = [0, 0, 0];
  const echoInverted: Vec3 = [0, 0, 0];

  // Graph-directed selection state, resumed from the histogram so a chunked
  // render's re-fuse cadence is independent of chunk boundaries (see
  // FlameHistogram.orbitPrevBase/orbitChaosLeft). Threaded unconditionally —
  // with chaosRows null, pickIndex ignores prevBase, the countdown is never
  // consulted, and the loop below is byte-identical to before chi existed.
  const chaosOn = prepared.chaosRows !== null;
  let prevBase = hist.orbitPrevBase;
  let chaosLeft = hist.orbitChaosLeft;

  let x: number;
  let y: number;
  let z: number;
  if (histogram === undefined) {
    x = rng() - 0.5;
    y = rng() - 0.5;
    z = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit(prepared, x, y, z, rng, rng, prevBase);
      x = s.x;
      y = s.y;
      z = s.z;
      prevBase = s.escaped ? -1 : s.index;
    }
  } else {
    [x, y, z] = hist.orbit;
  }

  // Row-major projection rows: X and Y (the NDC x/y numerators) and W (the
  // clip-space homogeneous coordinate, whose sign is "in front of the
  // camera" — see the Mat4 doc comment). Row 2 (clip Z) is never read: the
  // histogram accumulates density, it doesn't depth-sort.
  const rx0 = projection[0];
  const rx1 = projection[1];
  const rx2 = projection[2];
  const rx3 = projection[3];
  const ry0 = projection[4];
  const ry1 = projection[5];
  const ry2 = projection[6];
  const ry3 = projection[7];
  const rw0 = projection[12];
  const rw1 = projection[13];
  const rw2 = projection[14];
  const rw3 = projection[15];

  // One callback per accumulation call, not per source attempt. Its mutable
  // color lanes are loaded from the canonical source immediately before the
  // visitor runs; every selected image therefore copies that source's color
  // attribution while applying only the visitor's density weight.
  let tiledR = 0;
  let tiledG = 0;
  let tiledB = 0;
  let tiledImageVisitor: PointTilingImageVisitor | undefined;
  if (tilingPlan !== undefined) {
    tiledImageVisitor = (imageX, imageY, imageZ, _w, weight) => {
      const cw = rw0 * imageX + rw1 * imageY + rw2 * imageZ + rw3;
      if (cw <= 0) return;
      const cx = rx0 * imageX + rx1 * imageY + rx2 * imageZ + rx3;
      const cy = ry0 * imageX + ry1 * imageY + ry2 * imageZ + ry3;
      const col = Math.floor((cx / cw + 1) * 0.5 * width);
      const row = Math.floor((1 - cy / cw) * 0.5 * height);
      if (col < 0 || col >= width || row < 0 || row >= height) return;

      const bucket = row * width + col;
      const hit = (hits[bucket] += weight);
      if (hit > maxHits) maxHits = hit;
      hitMass += weight;
      const o = bucket * 3;
      sumRGB[o] += tiledR * weight;
      sumRGB[o + 1] += tiledG * weight;
      sumRGB[o + 2] += tiledB * weight;
    };
  }

  for (let n = 0; n < iterations; n++) {
    // Sub-orbit re-fuse (chaos-game.ts's CHAOS_SUB_ORBIT_POINTS): every K
    // plotted points under chi, reseed, reset to the entry pick, and warm
    // the fresh orbit up unrecorded through the real (non-inlined — this
    // block isn't hot) stepOrbit. Single-stream consumer, so the seed's
    // three draws come from `rng` itself (it IS the aux stream here). The
    // color coordinate resets like an escape-reseed's: the orbit restarts,
    // so its color walk does too.
    if (chaosOn) {
      if (chaosLeft <= 0) {
        x = rng() - 0.5;
        y = rng() - 0.5;
        z = rng() - 0.5;
        prevBase = -1;
        for (let k = 0; k < WARMUP_ITERATIONS; k++) {
          const s = stepOrbit(prepared, x, y, z, rng, rng, prevBase);
          x = s.x;
          y = s.y;
          z = s.z;
          prevBase = s.escaped ? -1 : s.index;
        }
        if (colorLUT !== undefined) c = 0.5;
        chaosLeft = CHAOS_SUB_ORBIT_POINTS;
      }
      chaosLeft--;
    }
    // --- inlined stepOrbit(prepared, x, y, z, rng) ------------------------
    const idx = pickIndex(prepared, rng, prevBase);
    // The BASE map this slot is a (possibly rotated) copy of — see
    // PreparedChaosGame.baseTransformCount. Equal to `idx` at symmetry order
    // 1. Anything keyed to "which logical map" (the color slot below, and the
    // legacy `palette` lookup at the bottom of the loop) uses this, never the
    // raw expanded `idx`.
    const baseIdx = idx % baseTransformCount;
    // Blend the color coordinate toward this transform's slot, at this
    // transform's speed. At the default speed 0.5 this reproduces the
    // halfway `(c + slot) / 2` blend it replaces BIT FOR BIT for every normal
    // `c` — halving is exact in binary floating point, so `c/2 + slot/2` and
    // `(c + slot)/2` round identically (verified over 5e6 random pairs in both
    // f64 and f32, the latter being what the WGSL kernels compute in). The two
    // forms can only diverge once `c` has decayed into the SUBNORMAL range,
    // which needs ~1075 consecutive picks of a slot-0 map, and even then both
    // forms index LUT entry 0 — so the rendered image is identical regardless.
    // No rng is consumed, so the orbit (and `hits`) stays identical to the
    // legacy path.
    if (colorLUT !== undefined) {
      const speed = colorSpeeds[baseIdx];
      c = c * (1 - speed) + colorSlots[baseIdx] * speed;
    }
    const emitter = emitters !== null ? emitters[baseIdx] : null;
    let nx: number;
    let ny: number;
    let nz: number;
    if (emitter !== null) {
      // Condensation step — stepOrbit's emitter branch exactly: one primary
      // seed draw, the sampler on the derived stream, the slot's affine as
      // the shape's pose, incoming point and variations ignored.
      emitterStream.reseed(emitterSeed(rng));
      const sample = emitter(emitterDraw);
      const aff = affines[idx];
      const m = aff.m;
      const t = aff.t;
      nx = m[0] * sample[0] + m[1] * sample[1] + m[2] * sample[2] + t[0];
      ny = m[3] * sample[0] + m[4] * sample[1] + m[5] * sample[2] + t[1];
      nz = m[6] * sample[0] + m[7] * sample[1] + m[8] * sample[2] + t[2];
    } else {
      const aff = affines[idx];
      const m = aff.m;
      const t = aff.t;
      const ax = m[0] * x + m[1] * y + m[2] * z + t[0];
      const ay = m[3] * x + m[4] * y + m[5] * z + t[1];
      const az = m[6] * x + m[7] * y + m[8] * z + t[2];

      const warp = variations[idx];
      if (warp === null) {
        nx = ax;
        ny = ay;
        nz = az;
      } else {
        const q = warp(ax, ay, az, rng);
        nx = q[0];
        ny = q[1];
        nz = q[2];
      }
    }

    // Symmetry: rotate this slot's FULL affine + variation output —
    // see `chaos-game.ts`'s `stepOrbit`, which this mirrors exactly. `null`
    // (order 1, and every unrotated copy-0 slot at any order) skips this, so
    // the orbit stays byte-identical to the pre-symmetry loop exactly where
    // there is nothing to rotate.
    const post = postRotations[idx];
    if (post !== null) {
      const rx = post[0] * nx + post[1] * ny + post[2] * nz;
      const ry = post[3] * nx + post[4] * ny + post[5] * nz;
      const rz = post[6] * nx + post[7] * ny + post[8] * nz;
      nx = rx;
      ny = ry;
      nz = rz;
    }

    let escaped = false;
    if (
      !Number.isFinite(nx) ||
      !Number.isFinite(ny) ||
      !Number.isFinite(nz) ||
      Math.abs(nx) > ESCAPE_LIMIT ||
      Math.abs(ny) > ESCAPE_LIMIT ||
      Math.abs(nz) > ESCAPE_LIMIT
    ) {
      nx = rng() - 0.5;
      ny = rng() - 0.5;
      nz = rng() - 0.5;
      // The orbit restarts, so its color coordinate does too.
      if (colorLUT !== undefined) c = 0.5;
      escaped = true;
    }
    x = nx;
    y = ny;
    z = nz;
    // Selection state for the next pick — stepOrbit's escaped/index contract
    // exactly. Inert without chi rows.
    prevBase = escaped ? -1 : baseIdx;

    // --- inlined plotPoint(prepared, x, y, z, rng) -------------------------
    // Post-word first, then the lens — chaos-game.ts's plotPoint stage for
    // stage (single-stream consumer, so the B-picks draw from `rng`, which
    // IS the primary stream here).
    let px = x;
    let py = y;
    let pz = z;
    if (schedule !== null) {
      let sx = px;
      let sy = py;
      let sz = pz;
      for (let d = 0; d < schedule.depth; d++) {
        const bAff = schedule.affines[pickScheduleIndex(schedule, rng)];
        const bm = bAff.m;
        const bt = bAff.t;
        const nx = bm[0] * sx + bm[1] * sy + bm[2] * sz + bt[0];
        const ny = bm[3] * sx + bm[4] * sy + bm[5] * sz + bt[1];
        const nz = bm[6] * sx + bm[7] * sy + bm[8] * sz + bt[2];
        sx = nx;
        sy = ny;
        sz = nz;
      }
      if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz)) {
        px = sx;
        py = sy;
        pz = sz;
      }
    }
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * px + fm[1] * py + fm[2] * pz + ft[0];
      let fy = fm[3] * px + fm[4] * py + fm[5] * pz + ft[1];
      let fz = fm[6] * px + fm[7] * py + fm[8] * pz + ft[2];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, rng);
        fx = q[0];
        fy = q[1];
        fz = q[2];
      }
      if (Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)) {
        px = fx;
        py = fy;
        pz = fz;
      }
    }

    if (tilingPlan !== undefined) {
      if (colorLUT !== undefined) {
        const li = Math.min(255, (c * 256) | 0) * 3;
        tiledR = colorLUT[li];
        tiledG = colorLUT[li + 1];
        tiledB = colorLUT[li + 2];
      } else {
        const rgb = palette[baseIdx] ?? FALLBACK_COLOR;
        tiledR = rgb[0];
        tiledG = rgb[1];
        tiledB = rgb[2];
      }
      visitPointTilingAttemptBounded(
        tilingPlan,
        px,
        py,
        pz,
        0,
        POINT_TILING_ACCUMULATION_FANOUT_CAP,
        pointTiling!,
        tiledImageVisitor!,
      );
      continue;
    }

    // Keep the original no-echo projection/deposit path textually intact.
    // Besides making the absent/off byte-identity contract auditable, this
    // lets its early `continue`s stay the cheapest path when balloon is off.
    if (echo === undefined) {
      // --- project through the frozen camera and bucket ---------------------
      const cw = rw0 * px + rw1 * py + rw2 * pz + rw3;
      if (cw <= 0) continue; // behind (or exactly at) the camera.
      const cx = rx0 * px + rx1 * py + rx2 * pz + rx3;
      const cy = ry0 * px + ry1 * py + ry2 * pz + ry3;
      const ndcX = cx / cw;
      const ndcY = cy / cw;
      const col = Math.floor((ndcX + 1) * 0.5 * width);
      // NDC Y points up; pixel row 0 is the top of the image, so flip.
      const row = Math.floor((1 - ndcY) * 0.5 * height);
      if (col < 0 || col >= width || row < 0 || row >= height) continue;

      const bucket = row * width + col;
      const hit = ++hits[bucket];
      if (hit > maxHits) maxHits = hit;
      hitMass += 1;
      const o = bucket * 3;
      if (colorLUT !== undefined) {
        // c is in [0, 1]; the min guards the c === 1 edge (256 -> 255).
        const li = Math.min(255, (c * 256) | 0) * 3;
        sumRGB[o] += colorLUT[li];
        sumRGB[o + 1] += colorLUT[li + 1];
        sumRGB[o + 2] += colorLUT[li + 2];
      } else {
        const rgb = palette[baseIdx] ?? FALLBACK_COLOR;
        sumRGB[o] += rgb[0];
        sumRGB[o + 1] += rgb[1];
        sumRGB[o + 2] += rgb[2];
      }
      continue;
    }

    // Resolve the plotted point's base color once for both deposits. Tint is
    // applied ONLY to the echo below; the primary splat remains untouched.
    let r: number;
    let g: number;
    let b: number;
    if (colorLUT !== undefined) {
      const li = Math.min(255, (c * 256) | 0) * 3;
      r = colorLUT[li];
      g = colorLUT[li + 1];
      b = colorLUT[li + 2];
    } else {
      const rgb = palette[baseIdx] ?? FALLBACK_COLOR;
      r = rgb[0];
      g = rgb[1];
      b = rgb[2];
    }

    // Primary splat. It cannot early-continue in balloon mode: a source
    // outside (or behind) the camera can invert back into the visible frame.
    const cw = rw0 * px + rw1 * py + rw2 * pz + rw3;
    if (cw > 0) {
      const cx = rx0 * px + rx1 * py + rx2 * pz + rx3;
      const cy = ry0 * px + ry1 * py + ry2 * pz + ry3;
      const col = Math.floor((cx / cw + 1) * 0.5 * width);
      const row = Math.floor((1 - cy / cw) * 0.5 * height);
      if (col >= 0 && col < width && row >= 0 && row < height) {
        const bucket = row * width + col;
        const hit = ++hits[bucket];
        if (hit > maxHits) maxHits = hit;
        hitMass += 1;
        const o = bucket * 3;
        sumRGB[o] += r;
        sumRGB[o + 1] += g;
        sumRGB[o + 2] += b;
      }
    }

    // Echo splat: the shared CPU helper owns the inversion floor/algebra.
    // No fade and no conformal magnification term — see the module doc.
    echoSource[0] = px;
    echoSource[1] = py;
    echoSource[2] = pz;
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
    const ecw = rw0 * inv[0] + rw1 * inv[1] + rw2 * inv[2] + rw3;
    if (ecw > 0) {
      const ecx = rx0 * inv[0] + rx1 * inv[1] + rx2 * inv[2] + rx3;
      const ecy = ry0 * inv[0] + ry1 * inv[1] + ry2 * inv[2] + ry3;
      const col = Math.floor((ecx / ecw + 1) * 0.5 * width);
      const row = Math.floor((1 - ecy / ecw) * 0.5 * height);
      if (col >= 0 && col < width && row >= 0 && row < height) {
        const bucket = row * width + col;
        const hit = (hits[bucket] += echo.weight);
        if (hit > maxHits) maxHits = hit;
        hitMass += echo.weight;
        const o = bucket * 3;
        const t = echo.tintStrength;
        sumRGB[o] += (er + (echo.tint[0] - er) * t) * echo.weight;
        sumRGB[o + 1] += (eg + (echo.tint[1] - eg) * t) * echo.weight;
        sumRGB[o + 2] += (eb + (echo.tint[2] - eb) * t) * echo.weight;
      }
    }
  }

  hist.orbit = [x, y, z];
  hist.orbitColor = c;
  hist.orbitPrevBase = prevBase;
  hist.orbitChaosLeft = chaosLeft;
  hist.maxHits = maxHits;
  hist.hitMass = hitMass;
  return hist;
}

/**
 * Recommended `gammaThreshold` (see {@link TonemapParams}) when the app
 * doesn't expose it as its own control — flam3 uses a value in this
 * neighborhood as an internal noise-suppression constant rather than
 * something users routinely tune.
 */
export const DEFAULT_GAMMA_THRESHOLD = 0.01;

/**
 * The mean-density-multiple at which {@link tonemapFlame}'s log-density curve
 * reaches 1 — the explicit ceiling that replaces the hottest bucket as the
 * curve's anchor. The density is `log1p(h / mean) / log1p(32)`, so a bucket
 * at 32x the mean deposited density lands at density 1 (full brightness) and
 * denser buckets keep rising past it only to clamp in the 8-bit output —
 * the hot core saturates to white instead of dragging every other bucket
 * darker. The curve's SHAPE is flam3's own: `rect.c` computes
 * `k1 * log(1 + c[3] * k2)` with `k2 ∝ 1/(area * sample_density)` — the log
 * argument is hits RELATIVE to mean sample density, never the hottest
 * bucket. This form is that curve with an explicit ceiling constant instead
 * of a per-render normalizer.
 *
 * 32 is calibrated against the shipped systems: the median max/mean ratio
 * over seven preset-class systems at a fixed 1M-iteration budget is ~31.5
 * (default 17.4, mengerSponge 13.6, chiralLace 31.5, spiral 65.5,
 * dodecahedronFlake 10.2, barnsleyFern 130.5, sierpinskiTetrahedron 583), so
 * a typical default render keeps its ballpark exposure — the old curve put
 * the mean bucket at `log1p(1)/log1p(max/mean)`, which for the median system
 * (max/mean ≈ 31.5) is 0.201, and the new curve puts it at
 * `log1p(1)/log1p(32)` = 0.200 — while the VARIANCE across systems and
 * budgets dies (the old anchor made whole-image brightness swing with the
 * single hottest bucket: max/mean 21356 for one contractive-map system vs
 * 17.4 for the default, and 20.5 -> 10.0 drift across a 16x budget ladder on
 * one system).
 */
export const FLAME_DENSITY_SATURATION = 32;

/**
 * Tone-mapping controls: `exposure` alone was enough to make a converging
 * render usable; `gamma`, `gammaThreshold`, and `vibrancy` add the rest of
 * the classic flame "punchy, painterly" look on top.
 */
export interface TonemapParams {
  /**
   * Brightness multiplier applied to the final color; 1 is neutral. Above 1
   * pushes more of the image toward full brightness (and lets the hottest
   * buckets clip to white); below 1 darkens the whole image.
   */
  exposure: number;
  /**
   * Reshapes the log-density curve by `density ** (1/gamma)`; 1 leaves the
   * log-density curve exactly as the original log-density tonemap shipped
   * it (no reshaping — the collapse point every gamma-related test is pinned
   * to). Above 1 pushes faint, sparsely-visited detail brighter relative to
   * the hot buckets — the "punchy" flame look; below 1 does the reverse.
   */
  gamma: number;
  /**
   * Below this density, the gamma curve is replaced by a straight
   * line through the origin whose value matches `density ** (1/gamma)`
   * exactly at the threshold (continuous — no jump), though not its slope
   * there (a faint kink, not a discontinuity). `density ** (1/gamma)` has
   * infinite slope at density = 0 whenever gamma > 1, so without even that
   * much, a single stray hit in an otherwise-empty bucket — exactly what
   * fills a not-yet-converged progressive render — gets blown out into a
   * bright speckle. Has no effect when `gamma` is 1 (see
   * {@link DEFAULT_GAMMA_THRESHOLD}).
   */
  gammaThreshold: number;
  /**
   * How much of the final color comes from the density-scaled accumulated
   * hue (1) vs. a flat `gamma`-only curve on the raw averaged color that
   * ignores density entirely (0); fractional values blend the two. 1 is the
   * collapse point — today's color exactly, scaled purely by density.
   */
  vibrancy: number;
}

/**
 * Render a {@link FlameHistogram} to an RGBA image (row-major, top row
 * first, matching `ImageData`/canvas conventions): brightness is the
 * log-density of hits RELATIVE TO THE MEAN deposited density
 * (`log1p(h / mean) / log1p(FLAME_DENSITY_SATURATION)`, where
 * `mean = hitMass / (width * height)`), so a bucket with a single hit stays
 * faintly visible instead of vanishing while a bucket at 32x the mean
 * density anchors the top of the curve — the classic flame tone-map that
 * keeps both a blazing core and wispy, sparsely-visited tendrils legible in
 * one image, WITHOUT the old hottest-bucket anchor that let one contractive
 * map's hot spot (max/mean 21356) crush the whole frame and made a
 * converging render's brightness drift with the iteration budget. Because
 * `mean` is a property of the histogram itself (see
 * {@link FlameHistogram.hitMass}), the curve is invariant under more
 * iterations, supersample pooling, and deposit weighting — the image
 * converges in appearance, not just in detail. `gamma` reshapes that curve
 * and `vibrancy` blends the density-scaled color against a flat gamma-only
 * one (see {@link TonemapParams}). Buckets with no hits are fully
 * transparent black, so the image composites cleanly over any backdrop.
 *
 * At `gamma: 1, vibrancy: 1` every term those controls introduce provably
 * reduces to a no-op (`x ** 1 === x`, `0 * anything-finite === 0`,
 * `1 * x === x`), collapsing the formula to the plain log-density tone-map —
 * pinned byte-for-byte against an independent oracle in flame.test.ts
 * ("collapses to the neutral tonemap") with no gamma/vibrancy-aware special
 * case.
 *
 * Pure, and does one pass over `width * height` (independent of how many
 * iterations are behind the histogram) — safe to call every frame while a
 * render converges.
 */
export function tonemapFlame(
  histogram: FlameHistogram,
  params: TonemapParams,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, hits, sumRGB, hitMass } = histogram;
  const out = new Uint8ClampedArray(width * height * 4);
  // Mass is the normalizer's own input and is > 0 iff some bucket is > 0 —
  // the exact semantics the old `maxHits <= 0` empty guard had, read off the
  // quantity the formula below actually divides by.
  if (hitMass <= 0) return out; // Nothing accumulated yet — fully transparent.

  const { exposure, gamma, gammaThreshold, vibrancy } = params;
  const invGamma = 1 / gamma;
  const flatness = 1 - vibrancy;
  // Slope of the line from the origin through (gammaThreshold, gammaThreshold
  // ** invGamma) — a chord, not the power curve's own tangent slope at that
  // point, which is what leaves a faint kink there (see the doc comment
  // above). Self-division makes this exactly 1 at gamma = 1 regardless of
  // gammaThreshold, which is what keeps the linear branch below agreeing
  // with the power branch at the collapse point.
  const thresholdSlope =
    gammaThreshold > 0 ? gammaThreshold ** invGamma / gammaThreshold : 1;
  // The MEAN DEPOSITED DENSITY over every bucket (empty ones included), and
  // the curve's anchor: density is a function of h/mean ONLY, so the image's
  // brightness no longer depends on the single hottest bucket. log1p of the
  // RATIO, not of h: finite (and 0) at h = 0 or mean, so a bucket at exactly
  // the mean density lands near the bottom of the curve instead of at
  // -Infinity or needing a discontinuous special case.
  const mean = hitMass / (width * height);
  const logSaturation = Math.log1p(FLAME_DENSITY_SATURATION);

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h <= 0) continue;
    const density = Math.log1p(h / mean) / logSaturation;
    // Gamma-reshape the log-density curve; linear below gammaThreshold so a
    // lone hit's infinite-slope singularity at density = 0 never blows out
    // into a bright speckle (see TonemapParams.gammaThreshold). density is
    // always >= 0, so when gammaThreshold <= 0 this always takes the power
    // branch — the linear branch is only ever reached for a positive
    // threshold, exactly as intended.
    const alpha =
      density >= gammaThreshold
        ? density ** invGamma
        : density * thresholdSlope;
    // glow bundles exposure into the density term (`density * exposure`) —
    // precomputing it this way, rather than multiplying exposure in
    // afterward, is what makes the vivid branch below reduce to the exact
    // neutral closed form at gamma = 1 (see the doc comment above), not just
    // a numerically close one.
    const glow = alpha * exposure;
    const invHits = 1 / h;
    const o = i * 3;
    const oi = i * 4;

    // avg is always >= 0 in practice (palette colors are sRGB in [0, 1] — see
    // hslToRgb — so sumRGB only ever accumulates non-negative values); the
    // clamp is a defensive guard so a negative/garbage channel can never
    // reach `** invGamma` and produce a silently-clamped-to-black NaN instead
    // of a loud failure.
    const r = Math.max(0, sumRGB[o] * invHits);
    const g = Math.max(0, sumRGB[o + 1] * invHits);
    const b = Math.max(0, sumRGB[o + 2] * invHits);

    // vivid: the density-scaled accumulated color (today's look). flat: a
    // gamma-only curve on the raw averaged color, ignoring density — the
    // desaturated-toward-white-in-dense-areas alternative vibrancy blends
    // against. At vibrancy = 1, `flatness` is exactly 0 and `flat`'s own
    // value (always finite) is multiplied away without affecting the result.
    // Uint8ClampedArray rounds and clamps to [0, 255] on assignment, so an
    // over-exposed (>1) or negative channel never needs a manual clamp.
    out[oi] =
      (vibrancy * (r * glow) + flatness * r ** invGamma * exposure) * 255;
    out[oi + 1] =
      (vibrancy * (g * glow) + flatness * g ** invGamma * exposure) * 255;
    out[oi + 2] =
      (vibrancy * (b * glow) + flatness * b ** invGamma * exposure) * 255;
    out[oi + 3] = 255;
  }
  return out;
}

/** Floor for the downsample kernel's sigma, in output pixels — keeps the
 * Gaussian's denominator away from zero for a `filterRadius` of 0 (or
 * smaller), giving a narrow-but-well-defined kernel instead of a divide. */
const MIN_FILTER_SIGMA = 1e-3;

/**
 * Combine an oversampled {@link FlameHistogram} into a `outWidth x
 * outHeight` one: the linear-domain supersample downfilter that MUST run
 * before {@link tonemapFlame} — see that function's doc for why filtering
 * has to happen on raw `hits`/`sumRGB`, not on the tone-mapped image
 * (averaging Monte-Carlo sample counts is only statistically meaningful
 * before the nonlinear log/gamma compression).
 *
 * Every output cell pools the oversampled cells within `filterRadius`
 * *output* pixels of its center, weighted by a Gaussian, as independent
 * weighted SUMS — `hits` and `sumRGB` are pooled separately and each divided
 * by the same per-cell weight total once at the end. This never pre-averages
 * a source cell's color before pooling (dividing by *its own* hit count),
 * which would mis-weight a sparse-but-bright source cell against a
 * dense-but-dim one; `tonemapFlame`'s own `sumRGB / hits` divide happens
 * downstream, unchanged, on these pooled totals.
 *
 * The kernel is precomputed once per call (not per output cell — every
 * output cell uses the identical weight-by-offset shape, just recentered),
 * so the hot part of this function is plain multiply-adds over a small
 * typed-array kernel, not a `Math.exp` call per source cell. Cells beyond
 * the histogram's edge are simply skipped and the surviving weights
 * renormalized (dividing by *their own* sum, not the theoretical full-kernel
 * sum), so a bucket near the border isn't darkened for lack of neighbors.
 *
 * `filterRadius` is FIXED for every output cell — a plain reconstruction /
 * antialiasing filter, not density-adaptive. {@link adaptiveDownsampleFlame}
 * generalizes it to a per-cell radius driven by local density (flam3's
 * "density estimation") — the two functions COEXIST rather than one
 * replacing the other: this one stays cheap for progressive-preview frames
 * (no per-cell radius/kernel-cache work), while the adaptive one is reserved
 * for a finished/paused render, where its O(width * height * radius^2) cost
 * only has to be paid once. See that function's doc for the full reasoning.
 *
 * `oversized`'s dimensions must be an exact positive-integer multiple of
 * `outWidth` / `outHeight` in each axis (the app always accumulates at
 * `outWidth * supersample` x `outHeight * supersample` for exactly this
 * reason). Throws `RangeError` otherwise.
 *
 * Pass `out` (dimensions must be exactly `outWidth` x `outHeight`; throws
 * `RangeError` otherwise) to write the result into an existing histogram
 * instead of allocating a fresh one — every bucket is fully overwritten, so
 * a dirty `out` is fine. This is what lets the flame worker reuse one
 * display-resolution histogram across progressive redisplays (instead of
 * churning a multi-megabyte allocation per tick) and, in shared-memory mode
 * downsample straight into SharedArrayBuffer-backed buckets the
 * main thread tone-maps from with no copy in between.
 *
 * `maxHits` and {@link FlameHistogram.hitMass} are both RECOMPUTED from the
 * written output in the same pass that produces it — mass especially: the
 * output buckets are weighted MEANS, and per-bucket mean density survives
 * that pooling exactly (the kernel's weights are normalized per cell), but
 * border renormalization makes a scaled-copy derivation second-order, so
 * the mass is summed from the written values — exact, and it needs no
 * scaling argument about what pooling "should" do to a total.
 */
export function downsampleFlame(
  oversized: FlameHistogram,
  outWidth: number,
  outHeight: number,
  filterRadius: number,
  out?: FlameHistogram,
): FlameHistogram {
  const {
    width: srcWidth,
    height: srcHeight,
    hits: srcHits,
    sumRGB: srcRGB,
  } = oversized;
  if (
    outWidth <= 0 ||
    outHeight <= 0 ||
    srcWidth % outWidth !== 0 ||
    srcHeight % outHeight !== 0
  ) {
    throw new RangeError(
      `downsampleFlame: source ${srcWidth}x${srcHeight} is not a positive-integer multiple of target ${outWidth}x${outHeight}`,
    );
  }
  if (out && (out.width !== outWidth || out.height !== outHeight)) {
    throw new RangeError(
      `downsampleFlame: out histogram is ${out.width}x${out.height}, but ${outWidth}x${outHeight} was requested`,
    );
  }
  const scaleX = srcWidth / outWidth;
  const scaleY = srcHeight / outHeight;
  const target = out ?? createFlameHistogram(outWidth, outHeight);
  const { hits: dstHits, sumRGB: dstRGB } = target;

  // An output cell's footprint center sits at a CONSTANT fractional offset
  // from its nearest source-cell grid line, the same for every output cell
  // on that axis (e.g. exactly half a source cell for an even supersample
  // factor, exactly on a source cell for an odd one — the surrounding
  // "+0.5 ... -0.5" cancels to a whole number for every cell but the
  // leftover phase term). Baking that phase into the precomputed kernel
  // (rather than rounding each cell's center to its nearest source cell)
  // keeps every output cell exactly correctly weighted, not just
  // approximately so.
  const phaseX = 0.5 * (scaleX - 1);
  const phaseY = 0.5 * (scaleY - 1);
  const sigmaX = Math.max(filterRadius, MIN_FILTER_SIGMA) * scaleX;
  const sigmaY = Math.max(filterRadius, MIN_FILTER_SIGMA) * scaleY;
  const radiusX = Math.max(1, Math.ceil(sigmaX * 3));
  const radiusY = Math.max(1, Math.ceil(sigmaY * 3));

  const kernelX = new Float64Array(2 * radiusX + 1);
  for (let k = -radiusX; k <= radiusX; k++) {
    const d = k - phaseX;
    kernelX[k + radiusX] = Math.exp(-(d * d) / (2 * sigmaX * sigmaX));
  }
  const kernelY = new Float64Array(2 * radiusY + 1);
  for (let k = -radiusY; k <= radiusY; k++) {
    const d = k - phaseY;
    kernelY[k + radiusY] = Math.exp(-(d * d) / (2 * sigmaY * sigmaY));
  }

  let maxHits = 0;
  let hitMass = 0;
  for (let oy = 0; oy < outHeight; oy++) {
    const baseY = oy * scaleY; // exact integer: the output cell's home row.
    for (let ox = 0; ox < outWidth; ox++) {
      const baseX = ox * scaleX; // exact integer: the output cell's home column.

      let weightSum = 0;
      let hitSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let j = -radiusY; j <= radiusY; j++) {
        const sy = baseY + j;
        if (sy < 0 || sy >= srcHeight) continue;
        const wy = kernelY[j + radiusY];
        const rowBase = sy * srcWidth;
        for (let i = -radiusX; i <= radiusX; i++) {
          const sx = baseX + i;
          if (sx < 0 || sx >= srcWidth) continue;
          const weight = wy * kernelX[i + radiusX];
          const bucket = rowBase + sx;
          weightSum += weight;
          hitSum += weight * srcHits[bucket];
          const so = bucket * 3;
          rSum += weight * srcRGB[so];
          gSum += weight * srcRGB[so + 1];
          bSum += weight * srcRGB[so + 2];
        }
      }

      // weightSum is always > 0 in practice (the center tap, j = i = 0, is
      // always in-bounds since baseX/baseY are themselves in-bounds source
      // coordinates) — guarded anyway as a safety net, matching this
      // codebase's habit of guarding "essentially impossible" cases rather
      // than assuming them away.
      const dstBucket = oy * outWidth + ox;
      const dOff = dstBucket * 3;
      if (weightSum > 0) {
        const norm = 1 / weightSum;
        const hVal = hitSum * norm;
        dstHits[dstBucket] = hVal;
        dstRGB[dOff] = rSum * norm;
        dstRGB[dOff + 1] = gSum * norm;
        dstRGB[dOff + 2] = bSum * norm;
        if (hVal > maxHits) maxHits = hVal;
        hitMass += hVal;
      } else {
        // A skipped cell must still be WRITTEN now that `out` can be a reused
        // (dirty) histogram — a fresh allocation showed 0 here for free, and
        // reuse must be indistinguishable from that, not leak a stale bucket.
        dstHits[dstBucket] = 0;
        dstRGB[dOff] = 0;
        dstRGB[dOff + 1] = 0;
        dstRGB[dOff + 2] = 0;
      }
    }
  }

  target.maxHits = maxHits;
  target.hitMass = hitMass;
  // The oversized accumulator is the real progressive state (see
  // FlameHistogram.orbit) — this filtered view is a display-only derivative
  // that must never be fed back into accumulateFlame, so its own orbit is
  // meaningless; leave whatever is there (createFlameHistogram's zero default,
  // or a reused out's old filler) rather than maintaining a value nothing
  // should ever read.
  return target;
}

/**
 * Controls for {@link adaptiveDownsampleFlame}'s per-cell blur radius —
 * flam3's "density estimation" parameters.
 */
export interface DensityEstimatorParams {
  /** Blur radius (output pixels) for a cell with ~zero local density — the
   * widest the kernel ever gets, filling gaps in sparse/noisy regions. */
  estimatorRadius: number;
  /** Floor for the radius a densely-sampled cell narrows to; 0 leaves
   * well-sampled regions pin-sharp. Clamped to `estimatorRadius` if given a
   * larger value, so "minimum" can never exceed "maximum". */
  estimatorMinimumRadius: number;
  /** Shapes how quickly the radius narrows as a cell's own hit count grows
   * (see {@link adaptiveDownsampleFlame}'s doc for the exact curve —
   * `estimatorRadius / count ** estimatorCurve`, flam3's own formula and
   * parameter). Below 1, the radius narrows gently with count, so even
   * moderately-sampled cells keep some smoothing; above 1, it collapses to
   * `estimatorMinimumRadius` after just a few hits. flam3-ish values sit
   * around 0.3-0.6. */
  estimatorCurve: number;
}

/** Steps (in output pixels) between distinct precomputed kernel radii in
 * {@link adaptiveDownsampleFlame} — see its doc for why radii are quantized
 * into a small cache instead of every cell building its own kernel. */
const RADIUS_QUANTUM = 0.5;

/** Side length (source cells) of one occupancy tile in
 * {@link adaptiveDownsampleFlame}'s empty-footprint skip — see the
 * summed-area-table paragraph in its doc. Small enough that a tile is a
 * fine-grained emptiness probe, large enough that the table stays tiny
 * (~1/256th of the histogram's cell count). */
const OCCUPANCY_TILE = 16;

/**
 * Floor for {@link adaptiveDownsampleFlame}'s kernel sigma — DELIBERATELY
 * much larger than `downsampleFlame`'s `MIN_FILTER_SIGMA`, and not shared
 * with it, for a real reason, not just belt-and-suspenders:
 * `estimatorMinimumRadius: 0` ("pin-sharp at full density") is an expected,
 * commonly-used setting here, unlike `downsampleFlame`'s `filterRadius`,
 * which is always a fixed non-zero constant in practice (0 only ever occurs
 * in that function's own pass-through unit test).
 *
 * A radius that rounds to (quantizes to) 0 combined with an EVEN supersample
 * factor (phase = 0.5, exactly between two source cells — see the phase
 * comment below) is exactly the failure mode this guards: at
 * `downsampleFlame`'s tiny `1e-3` floor, the Gaussian's weight at the
 * nearest actual grid offset (0.5 cells away, since nothing sits exactly on
 * the phase-shifted peak) underflows to precisely 0.0 in double precision —
 * `weightSum` for that output cell is then also exactly 0, and the
 * `weightSum > 0` guard silently skips writing it, leaving a BLACK HOLE at
 * exactly the densest, most important part of the image (a high sample count
 * is what maps to `estimatorMinimumRadius` in the first place). 0.3 keeps the
 * weight at a half-cell offset comfortably away from underflow (`exp(-0.25 /
 * (2 * (0.3 * 2) ** 2))` ~= 0.7, not ~0) while still being narrow enough
 * that "pin-sharp" reads as sharp — this only changes anything for a radius
 * that would otherwise have quantized below 0.3; any real, non-degenerate
 * radius is unaffected (`Math.max(radius, 0.3)` is a no-op once radius
 * clears that bar).
 */
const MIN_ADAPTIVE_FILTER_SIGMA = 0.3;

/**
 * Per-cell-adaptive generalization of {@link downsampleFlame}: instead of one
 * FIXED radius for every output cell, each cell's radius is driven by its
 * OWN local sample density — sparse, noisy regions blur wide (filling gaps,
 * smoothing wispy structure into something legible); dense, well-sampled
 * regions stay pin-sharp. This is flam3's "density estimation," the classic
 * fractal-flame algorithm's signature denoising step, and the reason a
 * converging render visibly sharpens as it accumulates instead of just
 * getting less grainy in place.
 *
 * Same slot in the pipeline as `downsampleFlame` (the linear accumulation
 * domain, before {@link tonemapFlame} — see that function's doc for why),
 * the same weighted-SUM pooling / edge-renormalization discipline, and the
 * same phase-correct kernel centering. The two functions do not layer (this
 * does not run `downsampleFlame` first) — for whichever frame calls it, this
 * replaces it outright, since both do the exact same "combine an oversampled
 * neighborhood into one output cell" job and differ only in how each cell's
 * radius is chosen; see `downsampleFlame`'s own doc for why they coexist as
 * two functions rather than one merging both jobs.
 *
 * ALGORITHM, per output cell:
 * 1. Estimate local density from the cell's own "home block" — the same
 *    `scaleX x scaleY` source-cell footprint `downsampleFlame` treats as one
 *    output cell's 1:1 region — not a single source cell, which on its own
 *    is far too noisy (Monte-Carlo shot noise) to drive a stable radius
 *    choice; summing a small neighborhood first is what flam3 does too.
 * 2. Map that count to a radius the way flam3 does — `estimatorRadius /
 *    max(1, count) ** estimatorCurve`, clamped to `[estimatorMinimumRadius,
 *    estimatorRadius]`. The count is the cell's own ABSOLUTE sample count,
 *    because that is what Monte-Carlo noise actually depends on (relative
 *    error falls as `1 / sqrt(count)`): a few hundred hits is a clean signal
 *    worth keeping sharp no matter how much hotter the image's hottest
 *    bucket happens to be. Normalizing against the histogram's peak instead
 *    puts nearly every cell of a log-distributed histogram far below the
 *    max, so the whole image — converged structure included — gets
 *    near-`estimatorRadius` blur, turning the finished frame into a
 *    featureless smear (and, since wide kernels run everywhere, taking
 *    minutes to do it).
 * 3. Gather a Gaussian kernel of THAT radius. Building one with `Math.exp`
 *    fresh for every one of `width * height` cells would dominate the cost,
 *    so radii are quantized to the nearest {@link RADIUS_QUANTUM} output
 *    pixels and cached — a real render needs at most a few dozen distinct
 *    radius classes regardless of image size, turning "exp per cell" into
 *    "array lookup per cell, exp per class".
 *
 * Cells whose entire kernel footprint is provably empty are skipped outright
 * (their output written as zeros — exactly what gathering would produce):
 * a summed-area table over coarse {@link OCCUPANCY_TILE}-sized occupancy
 * tiles answers "any hits within this bounding box?" in O(1), so the empty
 * background — often most of a flame's frame, and always requesting the
 * widest kernel — costs a table lookup instead of a widest-kernel gather.
 *
 * Deliberately NOT separable (two 1-D passes): a spatially-varying-width
 * Gaussian isn't exactly separable in the first place (a true two-pass
 * filter assumes the same width at every intermediate position), and the
 * usual "approximate it anyway, same per-cell radius both passes" shortcut
 * trades accuracy for a speed-up this function doesn't need — unlike
 * `downsampleFlame`, this runs once per finished/paused render, not on every
 * progressive frame, so the exact non-separable 2-D gather (reusing
 * `downsampleFlame`'s own proven loop shape) is worth its extra cost here.
 *
 * COST: still O(width * height * radius^2) in the worst case (a maximally
 * sparse image with hits scattered everywhere, every cell requesting the
 * widest kernel and no footprint empty enough to skip) — expensive enough
 * that it belongs on a finished/paused render, not every progressive frame;
 * see the worker's `runChunk` for how the two functions divide that work.
 * In practice the absolute-count radius mapping keeps converged structure on
 * small kernels and the occupancy skip makes empty background ~free, so a
 * typical finished frame costs a small multiple of a fixed-radius pass.
 *
 * `oversized`'s dimensions must be an exact positive-integer multiple of
 * `outWidth` / `outHeight`, exactly like `downsampleFlame`. Throws
 * `RangeError` otherwise.
 *
 * `out` reuses an existing `outWidth` x `outHeight` histogram instead of
 * allocating (throws `RangeError` on a size mismatch), with every bucket
 * fully overwritten — same contract, and same shared-memory/allocation-churn
 * reasoning, as `downsampleFlame`'s `out`. `maxHits` and
 * {@link FlameHistogram.hitMass} are recomputed from the written output for
 * the same reason `downsampleFlame`'s are — see its doc: the output buckets
 * are weighted means, per-bucket mean density survives the pooling exactly,
 * and border renormalization makes a scaled-copy mass second-order, so the
 * mass is summed from the written values in the same pass.
 */
export function adaptiveDownsampleFlame(
  oversized: FlameHistogram,
  outWidth: number,
  outHeight: number,
  params: DensityEstimatorParams,
  out?: FlameHistogram,
): FlameHistogram {
  const {
    width: srcWidth,
    height: srcHeight,
    hits: srcHits,
    sumRGB: srcRGB,
  } = oversized;
  if (
    outWidth <= 0 ||
    outHeight <= 0 ||
    srcWidth % outWidth !== 0 ||
    srcHeight % outHeight !== 0
  ) {
    throw new RangeError(
      `adaptiveDownsampleFlame: source ${srcWidth}x${srcHeight} is not a positive-integer multiple of target ${outWidth}x${outHeight}`,
    );
  }
  if (out && (out.width !== outWidth || out.height !== outHeight)) {
    throw new RangeError(
      `adaptiveDownsampleFlame: out histogram is ${out.width}x${out.height}, but ${outWidth}x${outHeight} was requested`,
    );
  }
  const scaleX = srcWidth / outWidth;
  const scaleY = srcHeight / outHeight;
  const target = out ?? createFlameHistogram(outWidth, outHeight);
  const { hits: dstHits, sumRGB: dstRGB } = target;

  const estimatorRadius = Math.max(0, params.estimatorRadius);
  // Never let "minimum" exceed "maximum", regardless of how the caller's
  // sliders happen to be set relative to each other.
  const estimatorMinimumRadius = Math.min(
    estimatorRadius,
    Math.max(0, params.estimatorMinimumRadius),
  );
  const estimatorCurve = params.estimatorCurve;

  // The same constant per-axis phase downsampleFlame relies on (see its
  // doc) — every output cell's footprint center sits at this fixed
  // fractional offset from its nearest source-cell grid line, regardless of
  // which cell, so it can be baked into every cached kernel below once.
  const phaseX = 0.5 * (scaleX - 1);
  const phaseY = 0.5 * (scaleY - 1);

  const kernelCache = new Map<
    number,
    {
      kernelX: Float64Array;
      kernelY: Float64Array;
      radiusX: number;
      radiusY: number;
    }
  >();
  function kernelFor(radius: number): {
    kernelX: Float64Array;
    kernelY: Float64Array;
    radiusX: number;
    radiusY: number;
  } {
    const quantized = Math.round(radius / RADIUS_QUANTUM) * RADIUS_QUANTUM;
    const cached = kernelCache.get(quantized);
    if (cached) return cached;
    const sigmaX = Math.max(quantized, MIN_ADAPTIVE_FILTER_SIGMA) * scaleX;
    const sigmaY = Math.max(quantized, MIN_ADAPTIVE_FILTER_SIGMA) * scaleY;
    const radiusX = Math.max(1, Math.ceil(sigmaX * 3));
    const radiusY = Math.max(1, Math.ceil(sigmaY * 3));
    const kernelX = new Float64Array(2 * radiusX + 1);
    for (let k = -radiusX; k <= radiusX; k++) {
      const d = k - phaseX;
      kernelX[k + radiusX] = Math.exp(-(d * d) / (2 * sigmaX * sigmaX));
    }
    const kernelY = new Float64Array(2 * radiusY + 1);
    for (let k = -radiusY; k <= radiusY; k++) {
      const d = k - phaseY;
      kernelY[k + radiusY] = Math.exp(-(d * d) / (2 * sigmaY * sigmaY));
    }
    const built = { kernelX, kernelY, radiusX, radiusY };
    kernelCache.set(quantized, built);
    return built;
  }

  // Occupancy summed-area table (see the doc's skip paragraph): occ[(ty + 1)
  // * satStride + (tx + 1)] holds the number of occupied (any-hits) tiles in
  // the rectangle of tiles from (0, 0) through (tx, ty) inclusive, with a
  // zero border row/column so queries never need edge special cases. Built
  // in one O(srcWidth * srcHeight) scan + one O(tiles) prefix pass — trivial
  // next to even a single widest-kernel gather row.
  const tilesX = Math.ceil(srcWidth / OCCUPANCY_TILE);
  const tilesY = Math.ceil(srcHeight / OCCUPANCY_TILE);
  const satStride = tilesX + 1;
  const occupancy = new Int32Array(satStride * (tilesY + 1));
  for (let sy = 0; sy < srcHeight; sy++) {
    const rowBase = sy * srcWidth;
    const tileRow = (((sy / OCCUPANCY_TILE) | 0) + 1) * satStride;
    for (let sx = 0; sx < srcWidth; sx++) {
      if (srcHits[rowBase + sx] > 0) {
        occupancy[tileRow + ((sx / OCCUPANCY_TILE) | 0) + 1] = 1;
      }
    }
  }
  for (let ty = 1; ty <= tilesY; ty++) {
    for (let tx = 1; tx <= tilesX; tx++) {
      const i = ty * satStride + tx;
      occupancy[i] +=
        occupancy[i - 1] +
        occupancy[i - satStride] -
        occupancy[i - satStride - 1];
    }
  }

  let maxHits = 0;
  let hitMass = 0;
  for (let oy = 0; oy < outHeight; oy++) {
    const baseY = oy * scaleY; // exact integer: the output cell's home row.
    for (let ox = 0; ox < outWidth; ox++) {
      const baseX = ox * scaleX; // exact integer: the output cell's home column.

      // Step 1: local density from this cell's home block, not a single
      // (noisy) source cell.
      let localCount = 0;
      for (let j = 0; j < scaleY; j++) {
        const rowBase = (baseY + j) * srcWidth;
        for (let i = 0; i < scaleX; i++) {
          localCount += srcHits[rowBase + baseX + i];
        }
      }
      // Step 2: map the cell's own absolute count to a radius (see the doc's
      // ALGORITHM section for why absolute, not relative-to-peak).
      // max(1, count) keeps an empty cell at exactly the widest radius
      // instead of dividing by 0 ** curve.
      const radius = Math.min(
        estimatorRadius,
        Math.max(
          estimatorMinimumRadius,
          estimatorRadius / Math.max(1, localCount) ** estimatorCurve,
        ),
      );

      // Step 3: gather the (cached-by-quantized-radius) kernel.
      const { kernelX, kernelY, radiusX, radiusY } = kernelFor(radius);

      // Empty-footprint skip: if no occupancy tile overlapping the kernel's
      // bounding box holds any hits, gathering would sum zeros — write the
      // zeros directly (a reused `out` may be dirty; see downsampleFlame).
      const dstBucket = oy * outWidth + ox;
      const dOff = dstBucket * 3;
      if (localCount <= 0) {
        const txLo = (Math.max(0, baseX - radiusX) / OCCUPANCY_TILE) | 0;
        const tyLo = (Math.max(0, baseY - radiusY) / OCCUPANCY_TILE) | 0;
        const txHi =
          ((Math.min(srcWidth - 1, baseX + radiusX) / OCCUPANCY_TILE) | 0) + 1;
        const tyHi =
          ((Math.min(srcHeight - 1, baseY + radiusY) / OCCUPANCY_TILE) | 0) + 1;
        const occupied =
          occupancy[tyHi * satStride + txHi] -
          occupancy[tyLo * satStride + txHi] -
          occupancy[tyHi * satStride + txLo] +
          occupancy[tyLo * satStride + txLo];
        if (occupied === 0) {
          dstHits[dstBucket] = 0;
          dstRGB[dOff] = 0;
          dstRGB[dOff + 1] = 0;
          dstRGB[dOff + 2] = 0;
          continue;
        }
      }

      let weightSum = 0;
      let hitSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let j = -radiusY; j <= radiusY; j++) {
        const sy = baseY + j;
        if (sy < 0 || sy >= srcHeight) continue;
        const wy = kernelY[j + radiusY];
        const rowBase = sy * srcWidth;
        for (let i = -radiusX; i <= radiusX; i++) {
          const sx = baseX + i;
          if (sx < 0 || sx >= srcWidth) continue;
          const weight = wy * kernelX[i + radiusX];
          const bucket = rowBase + sx;
          weightSum += weight;
          hitSum += weight * srcHits[bucket];
          const so = bucket * 3;
          rSum += weight * srcRGB[so];
          gSum += weight * srcRGB[so + 1];
          bSum += weight * srcRGB[so + 2];
        }
      }

      // weightSum is always > 0 in practice (the center tap, j = i = 0, is
      // always in-bounds since baseX/baseY are themselves in-bounds source
      // coordinates) — guarded anyway, matching downsampleFlame and this
      // codebase's general habit of guarding "essentially impossible" cases.
      if (weightSum > 0) {
        const norm = 1 / weightSum;
        const hVal = hitSum * norm;
        dstHits[dstBucket] = hVal;
        dstRGB[dOff] = rSum * norm;
        dstRGB[dOff + 1] = gSum * norm;
        dstRGB[dOff + 2] = bSum * norm;
        if (hVal > maxHits) maxHits = hVal;
        hitMass += hVal;
      } else {
        // Written, not skipped, for reused-out parity — see downsampleFlame.
        dstHits[dstBucket] = 0;
        dstRGB[dOff] = 0;
        dstRGB[dOff + 1] = 0;
        dstRGB[dOff + 2] = 0;
      }
    }
  }

  target.maxHits = maxHits;
  target.hitMass = hitMass;
  // Same non-answer as downsampleFlame's — see its doc — this is a
  // display-only derivative, never fed back into accumulateFlame.
  return target;
}
