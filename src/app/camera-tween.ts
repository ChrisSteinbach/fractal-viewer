/**
 * The auto-fit camera GLIDE (fr-0b8): a short smoothstep tween of the orbit
 * camera's target + radius that frames a freshly-generated attractor, extracted
 * from main.ts's closure so the pure interpolation is unit-tested without a
 * browser — the same way `orbit.ts` is for the rest of the camera math.
 * Since fr-cfoc it also owns the morph-tracking CHASE, the glide's sibling
 * that follows a MOVING fit, and since fr-8v41 the directed POSE GLIDE to a
 * saved camera pose — see {@link CameraTween}'s doc for how the three
 * motions relate.
 *
 * A whole-system replacement (preset load / Surprise Me) can leave the previous
 * camera pointed at empty space or buried inside the new cloud, so instead of
 * snapping we glide target/radius to frame it. theta/phi are deliberately left
 * untouched — only the distance and the point being orbited move, so the
 * fractal swaps in place and the camera glides to meet it. Never triggered by
 * Regenerate or a geometry edit (those would fight the user's own framing); the
 * call sites (main.ts's `fitCameraToAttractor`) gate that.
 *
 * The tween owns no Three.js and no DOM: it MUTATES an injected {@link
 * OrbitCamera} in place (target[0..2] + spherical.radius), reads a `fov`/`aspect`
 * {@link CameraFraming} passed per call (main.ts sources it from `scene.camera`),
 * and takes its clock (`now`) and the reduced-motion probe (`reducedMotion`) as
 * injected capabilities — so tests drive it with a fake clock and no browser,
 * mirroring `edit-session.ts`'s injected `schedule`. Under reduced motion it
 * skips the glide entirely and snaps the camera to the fit in one step.
 */
import type { Bounds, Vec3, Vec4 } from "../fractal/types";
import {
  boundsCenter,
  fitRadius,
  smoothstep,
  type CameraPose,
  type OrbitCamera,
} from "./orbit";

/** Duration of the auto-fit glide, in milliseconds. */
export const CAMERA_TWEEN_MS = 600;

/**
 * Time constant of the tracking chase (fr-cfoc), in milliseconds: each
 * {@link CameraTween.advance} closes `1 - exp(-dt/τ)` of the remaining
 * distance to the tracked fit, so the camera follows a morphing attractor
 * with ~this much lag — fast enough to keep it framed across a multi-second
 * morph, slow enough to low-pass the frame-to-frame bounds noise of a
 * re-sampled point cloud (a single stray point can kick a raw min/max box).
 */
export const CAMERA_TRACK_TAU_MS = 350;

/**
 * The perspective parameters the fit distance is solved against: a Three.js
 * `PerspectiveCamera`'s `fov` (in DEGREES, as Three.js stores it) and its
 * viewport `aspect`. Passed per call rather than injected because it changes
 * with every window resize; main.ts reads it straight off `scene.camera`.
 */
export interface CameraFraming {
  /** Vertical field of view in DEGREES (Three.js `PerspectiveCamera.fov`). */
  fov: number;
  /** Viewport aspect ratio (`PerspectiveCamera.aspect`). */
  aspect: number;
}

/**
 * Synthesize a 3D {@link Bounds} for framing a 4D projection: an axis-aligned
 * box on the cloud's xyz center whose half-DIAGONAL equals `radius`, so
 * orbit.ts's `fitRadius` (which reads the box as a bounding sphere of radius =
 * half-diagonal) frames exactly the radius-`radius` 4D ball. Half-extent per
 * axis is radius/√3 ⇒ half-diagonal √3·(radius/√3) = radius. Because `radius`
 * is a rotation-invariant max-distance-from-center, this framing holds at every
 * tumble angle and never needs to re-run. `minR`/`maxR` aren't read by
 * `fitRadius`/`boundsCenter` but are filled to `[0, radius]` for a well-formed
 * box.
 */
export function fourDFramingBounds(center: Vec4, radius: number): Bounds {
  const h = radius / Math.sqrt(3);
  return {
    minX: center[0] - h,
    maxX: center[0] + h,
    minY: center[1] - h,
    maxY: center[1] + h,
    minZ: center[2] - h,
    maxZ: center[2] + h,
    minR: 0,
    maxR: radius,
  };
}

/** In-flight glide: the smoothstep endpoints + the clock reading it started at. */
interface Tween {
  startMs: number;
  fromRadius: number;
  toRadius: number;
  fromTarget: Vec3;
  toTarget: Vec3;
}

/** In-flight tracking chase (fr-cfoc): the fit currently being chased + the
 * clock reading of the last advance (for the dt-aware step). Retargeted in
 * place by every {@link CameraTween.track} call; never self-terminating —
 * a fit glide, a cancel, or a finish ends it. */
interface Chase {
  toRadius: number;
  toTarget: Vec3;
  lastMs: number;
}

/** In-flight pose glide (fr-8v41): a directed smoothstep to a SAVED camera
 * pose — unlike Tween/Chase it moves theta/phi too, and it times itself
 * (durationMs is the timeline leg's own morph length, not CAMERA_TWEEN_MS). */
interface PoseTween {
  startMs: number;
  durationMs: number;
  fromRadius: number;
  toRadius: number;
  fromTarget: Vec3;
  toTarget: Vec3;
  fromTheta: number;
  toTheta: number;
  fromPhi: number;
  toPhi: number;
}

/**
 * The auto-fit camera glide state machine over an {@link OrbitCamera}. main.ts
 * calls {@link fitToBounds} to start a glide (from `fitCameraToAttractor`),
 * {@link advance} once per frame from the animate loop before `applyCamera`,
 * and {@link cancel} on the next user gesture so grabbing the camera mid-glide
 * feels like a normal orbit rather than a fight with the animation.
 *
 * Three mutually exclusive motions (fr-cfoc, fr-8v41):
 *
 * - The **glide** ({@link fitToBounds}): a one-shot {@link CAMERA_TWEEN_MS}
 *   smoothstep to a fixed fit — a whole-system load's landing.
 * - The **chase** ({@link track}): a dt-aware exponential approach toward a
 *   fit that is retargeted every time a morph intermediate lands, so the
 *   camera FOLLOWS the morphing attractor instead of letting it wander
 *   off-frame for the whole tween and then yanking into place at the end —
 *   the abrupt recentering a drift leg would otherwise finish with. The morph's
 *   terminal sample still carries the real `fit`, whose glide takes over
 *   from the chase for the settle: from an already-tracking pose that final
 *   glide is a short touch-down rather than a leap.
 * - The **pose glide** ({@link glideToPose}): a directed, self-timed
 *   smoothstep to a SAVED {@link CameraPose} — a timeline leg's camera move
 *   (fr-8v41). The one motion that moves theta/phi: the fit glide and chase
 *   deliberately leave the orbit ANGLES to the user (see the module header),
 *   but a timeline keyframe's saved pose IS the author's framing, angles
 *   included.
 *
 * Starting any one motion clears the other two — whichever was requested
 * last is the live intent.
 */
export class CameraTween {
  private tween: Tween | null = null;
  private chase: Chase | null = null;
  private poseTween: PoseTween | null = null;

  /**
   * @param orbit The camera this glide mutates in place (target + radius).
   * @param now Monotonic clock in ms (`() => performance.now()` in the app);
   *   both endpoints and the per-frame progress read the SAME clock.
   * @param reducedMotion True when the user asked to minimize motion — the
   *   glide is skipped and the fit is applied in a single snap.
   */
  constructor(
    private readonly orbit: OrbitCamera,
    private readonly now: () => number,
    private readonly reducedMotion: () => boolean,
  ) {}

  /** Whether a glide, a tracking chase, or a pose glide is currently in flight. */
  get active(): boolean {
    return (
      this.tween !== null || this.chase !== null || this.poseTween !== null
    );
  }

  /** Whether the in-flight motion is a pose glide (fr-8v41). main.ts reads
   * this to suppress the auto-orbit's per-frame theta advance while a glide
   * owns theta — the fit glide/chase never touch theta, so they compose with
   * the auto-orbit and deliberately do NOT set this. */
  get poseGliding(): boolean {
    return this.poseTween !== null;
  }

  /** The fit for `bounds` under `framing` — the shared target both motions
   * steer toward. */
  private fitFor(
    bounds: Bounds,
    framing: CameraFraming,
  ): { toTarget: Vec3; toRadius: number } {
    return {
      toTarget: boundsCenter(bounds),
      toRadius: fitRadius(
        bounds,
        (framing.fov * Math.PI) / 180,
        framing.aspect,
      ),
    };
  }

  /** Jump the camera straight to a fit — the reduced-motion path of both
   * fit motions, clearing whichever motion (including a pose glide) was in
   * flight. */
  private snapTo(toTarget: Vec3, toRadius: number): void {
    this.orbit.target[0] = toTarget[0];
    this.orbit.target[1] = toTarget[1];
    this.orbit.target[2] = toTarget[2];
    this.orbit.spherical.radius = toRadius;
    this.tween = null;
    this.chase = null;
    this.poseTween = null;
  }

  /** Jump the camera straight to a full pose (target/radius/theta/phi) — the
   * reduced-motion/zero-duration path of {@link glideToPose} and its {@link
   * finish} completion, clearing all three motion records. */
  private snapToPose(pose: CameraPose): void {
    this.orbit.target[0] = pose.target[0];
    this.orbit.target[1] = pose.target[1];
    this.orbit.target[2] = pose.target[2];
    this.orbit.spherical.radius = pose.radius;
    this.orbit.spherical.theta = pose.theta;
    this.orbit.spherical.phi = pose.phi;
    this.tween = null;
    this.chase = null;
    this.poseTween = null;
  }

  /**
   * Frame `bounds` by gliding the orbit target to its center and the radius to
   * the fit distance for `framing`. Under reduced motion, snaps there instantly
   * (and clears any in-flight motion) instead of tweening. Replaces a running
   * {@link track} chase: the glide is the landing's settle.
   */
  fitToBounds(bounds: Bounds, framing: CameraFraming): void {
    const { toTarget, toRadius } = this.fitFor(bounds, framing);
    if (this.reducedMotion()) {
      this.snapTo(toTarget, toRadius);
      return;
    }
    this.chase = null;
    this.poseTween = null;
    this.tween = {
      startMs: this.now(),
      fromRadius: this.orbit.spherical.radius,
      toRadius,
      fromTarget: [
        this.orbit.target[0],
        this.orbit.target[1],
        this.orbit.target[2],
      ],
      toTarget,
    };
  }

  /**
   * Chase the fit for `bounds` (fr-cfoc): start — or retarget in place — the
   * exponential follow {@link advance} steps toward every frame. Call once
   * per morph-intermediate arrival with that result's live bounds; the chase
   * keeps its own pace ({@link CAMERA_TRACK_TAU_MS}), so however irregular
   * the arrivals, the camera's motion stays smooth. Replaces an in-flight
   * glide (the chase is the fresher intent). Under reduced motion, snaps to
   * the fit instantly — morphs don't run there, so this is belt-and-braces.
   */
  track(bounds: Bounds, framing: CameraFraming): void {
    const { toTarget, toRadius } = this.fitFor(bounds, framing);
    if (this.reducedMotion()) {
      this.snapTo(toTarget, toRadius);
      return;
    }
    this.tween = null;
    this.poseTween = null;
    if (this.chase) {
      // Retarget without touching lastMs — the next advance() still
      // measures its dt from the last step, not from this arrival.
      this.chase.toTarget = toTarget;
      this.chase.toRadius = toRadius;
      return;
    }
    this.chase = { toTarget, toRadius, lastMs: this.now() };
  }

  /**
   * Glide the orbit camera to a SAVED {@link CameraPose} (fr-8v41): a
   * timeline leg's directed camera move from wherever the camera currently
   * is to the arriving step's authored framing, over `durationMs` — the
   * leg's own morph length, NOT {@link CAMERA_TWEEN_MS}. Unlike {@link
   * fitToBounds}/{@link track}, this moves theta/phi too: a saved pose IS
   * the author's framing, angles included.
   *
   * `theta` is unbounded (see orbit.ts), so lerping straight from the
   * camera's current theta to the pose's recorded theta could swing the
   * long way round if the two happen to sit in different windings — instead
   * this steers by the NEAREST TURN, the shortest signed angular delta.
   *
   * Under reduced motion, or a non-positive `durationMs` (a zero-length
   * glide's first {@link advance} would otherwise divide by zero), snaps
   * straight to the pose instead of animating. Replaces an in-flight {@link
   * fitToBounds} glide or {@link track} chase — the pose glide is the
   * fresher intent.
   */
  glideToPose(pose: CameraPose, durationMs: number): void {
    const fromTheta = this.orbit.spherical.theta;
    // Nearest turn: the shortest signed delta (in (-π, π]) from fromTheta to
    // pose.theta, so the glide never swings the long way round a pose that's
    // a small angle away but recorded in a different winding.
    const delta = Math.atan2(
      Math.sin(pose.theta - fromTheta),
      Math.cos(pose.theta - fromTheta),
    );
    const toTheta = fromTheta + delta;

    if (this.reducedMotion() || durationMs <= 0) {
      this.snapToPose(pose);
      return;
    }

    this.tween = null;
    this.chase = null;
    this.poseTween = {
      startMs: this.now(),
      durationMs,
      fromRadius: this.orbit.spherical.radius,
      toRadius: pose.radius,
      fromTarget: [
        this.orbit.target[0],
        this.orbit.target[1],
        this.orbit.target[2],
      ],
      toTarget: [pose.target[0], pose.target[1], pose.target[2]],
      fromTheta,
      toTheta,
      fromPhi: this.orbit.spherical.phi,
      toPhi: pose.phi,
    };
  }

  /**
   * Advance the in-flight motion (a no-op when idle). A glide interpolates
   * the orbit target + radius by the smoothstep of elapsed/{@link
   * CAMERA_TWEEN_MS} and clears itself once it reaches the target (t ≥ 1); a
   * pose glide ({@link glideToPose}) does the same but over its own
   * `durationMs` and additionally interpolates theta/phi; a chase closes
   * `1 - exp(-dt/τ)` of its remaining distance and never self-terminates
   * (see {@link track}). Called from animate() before `applyCamera` so the
   * frame it takes effect on is the one drawn.
   */
  advance(): void {
    if (this.poseTween) {
      const {
        startMs,
        durationMs,
        fromRadius,
        toRadius,
        fromTarget,
        toTarget,
        fromTheta,
        toTheta,
        fromPhi,
        toPhi,
      } = this.poseTween;
      const t = smoothstep((this.now() - startMs) / durationMs);
      this.orbit.spherical.radius = fromRadius + (toRadius - fromRadius) * t;
      this.orbit.target[0] = fromTarget[0] + (toTarget[0] - fromTarget[0]) * t;
      this.orbit.target[1] = fromTarget[1] + (toTarget[1] - fromTarget[1]) * t;
      this.orbit.target[2] = fromTarget[2] + (toTarget[2] - fromTarget[2]) * t;
      this.orbit.spherical.theta = fromTheta + (toTheta - fromTheta) * t;
      this.orbit.spherical.phi = fromPhi + (toPhi - fromPhi) * t;
      if (t >= 1) this.poseTween = null;
      return;
    }
    if (this.tween) {
      const { startMs, fromRadius, toRadius, fromTarget, toTarget } =
        this.tween;
      const t = smoothstep((this.now() - startMs) / CAMERA_TWEEN_MS);
      this.orbit.spherical.radius = fromRadius + (toRadius - fromRadius) * t;
      this.orbit.target[0] = fromTarget[0] + (toTarget[0] - fromTarget[0]) * t;
      this.orbit.target[1] = fromTarget[1] + (toTarget[1] - fromTarget[1]) * t;
      this.orbit.target[2] = fromTarget[2] + (toTarget[2] - fromTarget[2]) * t;
      if (t >= 1) this.tween = null;
      return;
    }
    if (!this.chase) return;
    const now = this.now();
    const dt = Math.max(0, now - this.chase.lastMs);
    this.chase.lastMs = now;
    const alpha = 1 - Math.exp(-dt / CAMERA_TRACK_TAU_MS);
    const { toTarget, toRadius } = this.chase;
    this.orbit.spherical.radius +=
      (toRadius - this.orbit.spherical.radius) * alpha;
    this.orbit.target[0] += (toTarget[0] - this.orbit.target[0]) * alpha;
    this.orbit.target[1] += (toTarget[1] - this.orbit.target[1]) * alpha;
    this.orbit.target[2] += (toTarget[2] - this.orbit.target[2]) * alpha;
  }

  /** Cancel any in-flight motion outright — the next user gesture calls this. */
  cancel(): void {
    this.tween = null;
    this.chase = null;
    this.poseTween = null;
  }

  /**
   * Complete any in-flight motion instantly: jump the camera to its end
   * pose (or target/radius) and clear it. A no-op when idle. Used when a
   * preset's render-mode hint (fr-39y) enters the flame render right as the
   * fresh cloud lands — the flame freezes the camera into its projection
   * snapshot at enter time, so the fit (or pose glide) must have LANDED by
   * then, not still be gliding toward frame.
   */
  finish(): void {
    if (this.poseTween) {
      const { toTarget, toRadius, toTheta, toPhi } = this.poseTween;
      this.snapToPose({
        target: toTarget,
        radius: toRadius,
        theta: toTheta,
        phi: toPhi,
      });
      return;
    }
    const end = this.tween ?? this.chase;
    if (!end) return;
    this.snapTo(end.toTarget, end.toRadius);
  }
}
