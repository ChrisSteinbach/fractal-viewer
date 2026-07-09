/**
 * The auto-fit camera GLIDE (fr-0b8): a short smoothstep tween of the orbit
 * camera's target + radius that frames a freshly-generated attractor, extracted
 * from main.ts's closure so the pure interpolation is unit-tested without a
 * browser — the same way `orbit.ts` is for the rest of the camera math.
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
import { boundsCenter, fitRadius, smoothstep, type OrbitCamera } from "./orbit";

/** Duration of the auto-fit glide, in milliseconds. */
export const CAMERA_TWEEN_MS = 600;

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

/**
 * The auto-fit camera glide state machine over an {@link OrbitCamera}. main.ts
 * calls {@link fitToBounds} to start a glide (from `fitCameraToAttractor`),
 * {@link advance} once per frame from the animate loop before `applyCamera`,
 * and {@link cancel} on the next user gesture so grabbing the camera mid-glide
 * feels like a normal orbit rather than a fight with the animation.
 */
export class CameraTween {
  private tween: Tween | null = null;

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

  /** Whether a glide is currently in flight. */
  get active(): boolean {
    return this.tween !== null;
  }

  /**
   * Frame `bounds` by gliding the orbit target to its center and the radius to
   * the fit distance for `framing`. Under reduced motion, snaps there instantly
   * (and clears any in-flight glide) instead of tweening.
   */
  fitToBounds(bounds: Bounds, framing: CameraFraming): void {
    const toTarget = boundsCenter(bounds);
    const toRadius = fitRadius(
      bounds,
      (framing.fov * Math.PI) / 180,
      framing.aspect,
    );
    if (this.reducedMotion()) {
      this.orbit.target[0] = toTarget[0];
      this.orbit.target[1] = toTarget[1];
      this.orbit.target[2] = toTarget[2];
      this.orbit.spherical.radius = toRadius;
      this.tween = null;
      return;
    }
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
   * Advance the in-flight glide (a no-op when idle): interpolate the orbit
   * target + radius by the smoothstep of elapsed/{@link CAMERA_TWEEN_MS} and
   * clear the glide once it reaches the target (t ≥ 1). Called from animate()
   * before `applyCamera` so the frame it takes effect on is the one drawn.
   */
  advance(): void {
    if (!this.tween) return;
    const { startMs, fromRadius, toRadius, fromTarget, toTarget } = this.tween;
    const t = smoothstep((this.now() - startMs) / CAMERA_TWEEN_MS);
    this.orbit.spherical.radius = fromRadius + (toRadius - fromRadius) * t;
    this.orbit.target[0] = fromTarget[0] + (toTarget[0] - fromTarget[0]) * t;
    this.orbit.target[1] = fromTarget[1] + (toTarget[1] - fromTarget[1]) * t;
    this.orbit.target[2] = fromTarget[2] + (toTarget[2] - fromTarget[2]) * t;
    if (t >= 1) this.tween = null;
  }

  /** Cancel any in-flight glide outright — the next user gesture calls this. */
  cancel(): void {
    this.tween = null;
  }
}
