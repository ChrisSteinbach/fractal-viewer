import type { Bounds, Vec3 } from "../fractal/types";
import { clamp } from "../fractal/vec";

export const MIN_RADIUS = 1;
export const MAX_RADIUS = 100;
/** Ordinary perspective used by every fitted/reset view. Deep zoom narrows
 * the lens only after the physical orbit reaches {@link MIN_RADIUS}. */
export const DEFAULT_CAMERA_FOV = 60;
/** Numerical floor for continuous zoom. At this field of view the target-plane
 * footprint is ~3,300x smaller than the ordinary 60 degree lens while the
 * camera itself remains a safe unit away from the focus. Going narrower would
 * make adjacent ~1000px rays approach f32 angular resolution in the current
 * WebGL/WGSL pipelines; the UI surfaces this as the numeric limit. */
export const MIN_DEEP_ZOOM_FOV = 0.02;
/** Hard performance ceiling for adaptive analytic-surface depth. The renderer's
 * bounded strip pump still protects responsiveness; this cap bounds the work
 * of each individual distance query and gives the UI a concrete limit. */
export const MAX_DEEP_ZOOM_SURFACE_DEPTH = 256;
export const MIN_PHI = 0.01;
export const MAX_PHI = Math.PI - 0.01;
/** Radians of orbit per pixel of drag. */
export const ROTATE_SPEED = 0.01;

/**
 * Camera position at boot (see `main.ts`'s `new OrbitCamera(BOOT_CAMERA_POSITION)`).
 * Exported so {@link fitRadius} can fall back to its radius when a system's
 * bounds are degenerate — there is no box to measure a fit distance from —
 * without the two files drifting out of sync.
 */
export const BOOT_CAMERA_POSITION: Vec3 = [5, 4, 5];
const BOOT_RADIUS = Math.hypot(...BOOT_CAMERA_POSITION);

/** Spherical coordinates in Three.js's convention (phi measured from +Y). */
export interface Spherical {
  radius: number;
  theta: number;
  phi: number;
}

/**
 * A complete orbit-camera pose: the target point plus the flattened
 * {@link Spherical} offset of the camera from it — everything needed to restore
 * an exact framing (see {@link OrbitCamera}). Lives here, with the camera math,
 * rather than in `persist.ts`: it is a plain-data view of {@link OrbitCamera}'s
 * own fields, and both `persist.ts` (the save/share/collection codec's `camera`
 * document field) and `history.ts` (the out-of-band undo/redo pose) carry
 * it without either depending on the other.
 *
 * `radius`/`phi` are clamped to [{@link MIN_RADIUS}, {@link MAX_RADIUS}] /
 * [{@link MIN_PHI}, {@link MAX_PHI}] wherever a pose is applied or decoded;
 * `theta` (azimuth) is unbounded, matching {@link Spherical}.
 */
export interface CameraPose {
  target: Vec3;
  radius: number;
  theta: number;
  phi: number;
  /** Vertical field of view in degrees. Absent in documents written before
   * continuous zoom and therefore interpreted as {@link DEFAULT_CAMERA_FOV}. */
  fov?: number;
  /** Whether dolly input may continue through the lens after MIN_RADIUS.
   * Optional so legacy saved views keep their original camera contract. */
  infiniteZoom?: boolean;
}

export function clampCameraFov(fov: number): number {
  return Math.max(MIN_DEEP_ZOOM_FOV, Math.min(DEFAULT_CAMERA_FOV, fov));
}

/** Extra magnification contributed by the deep-zoom lens (1 at the ordinary
 * 60 degree view). Tangents make this an exact target-plane scale ratio. */
export function deepZoomMagnification(fov: number): number {
  return (
    Math.tan((DEFAULT_CAMERA_FOV * Math.PI) / 360) /
    Math.tan((clampCameraFov(fov) * Math.PI) / 360)
  );
}

export interface AdaptiveSurfaceDetail {
  depth: number;
  capped: boolean;
}

/** Extend an analytic surface's iteration/descent budget as the lens narrows.
 * IFS surfaces pass their slowest certified contraction so each added level
 * resolves the requested scale. Forward escape/bulb surfaces pass null and
 * receive one extra orbit step per doubled magnification. */
export function adaptiveSurfaceDetail(
  baseDepth: number,
  magnification: number,
  slowestSigma: number | null,
): AdaptiveSurfaceDetail {
  const mag = Math.max(1, magnification);
  const extra =
    slowestSigma !== null && slowestSigma > 0 && slowestSigma < 1
      ? Math.ceil(Math.log(1 / mag) / Math.log(slowestSigma))
      : Math.ceil(Math.log2(mag));
  const desired = baseDepth + Math.max(0, extra);
  return {
    depth: Math.min(MAX_DEEP_ZOOM_SURFACE_DEPTH, desired),
    capped: desired >= MAX_DEEP_ZOOM_SURFACE_DEPTH,
  };
}

export function clampPhi(phi: number): number {
  return Math.max(MIN_PHI, Math.min(MAX_PHI, phi));
}

export function clampRadius(radius: number): number {
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius));
}

/** Spherical → Cartesian offset, matching `THREE.Vector3.setFromSpherical`. */
export function sphericalToCartesian(s: Spherical): Vec3 {
  const sinPhiRadius = s.radius * Math.sin(s.phi);
  return [
    sinPhiRadius * Math.sin(s.theta),
    s.radius * Math.cos(s.phi),
    sinPhiRadius * Math.cos(s.theta),
  ];
}

/** Cartesian → spherical, matching `THREE.Spherical.setFromCartesianCoords`. */
export function sphericalFromCartesian(
  x: number,
  y: number,
  z: number,
): Spherical {
  const radius = Math.sqrt(x * x + y * y + z * z);
  if (radius === 0) return { radius: 0, theta: 0, phi: 0 };
  return {
    radius,
    theta: Math.atan2(x, z),
    phi: Math.acos(Math.max(-1, Math.min(1, y / radius))),
  };
}

/**
 * Orbit camera state: a target point and the spherical offset of the camera
 * from it. Pure (no Three.js) so the rotate/dolly/pan math is unit-tested;
 * `scene.ts` reads {@link OrbitCamera.position} each frame to place the camera.
 */
export class OrbitCamera {
  readonly spherical: Spherical;
  readonly target: Vec3;
  /** Vertical perspective field of view in degrees. Owned beside the orbit so
   * input, persistence, timelines and the Three.js projection share one pose. */
  fov = DEFAULT_CAMERA_FOV;
  infiniteZoom = false;

  constructor(position: Vec3, target: Vec3 = [0, 0, 0]) {
    this.target = [...target];
    this.spherical = sphericalFromCartesian(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    );
  }

  /** Orbit by a screen-space drag delta in pixels. */
  rotate(dx: number, dy: number): void {
    this.spherical.theta -= dx * ROTATE_SPEED;
    this.spherical.phi = clampPhi(this.spherical.phi - dy * ROTATE_SPEED);
  }

  /** Zoom by a multiplicative factor (> 1 moves the camera away). */
  dolly(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (!this.infiniteZoom) {
      this.spherical.radius = clampRadius(this.spherical.radius * factor);
      return;
    }

    // Preserve one continuous target-plane footprint across the handoff:
    // ordinary dolly changes radius under the 60 degree lens; once radius 1
    // is reached, narrowing the lens changes the same footprint instead. On
    // zoom-out the order reverses automatically. The camera never crosses its
    // focus and never approaches the near plane.
    const baseTan = Math.tan((DEFAULT_CAMERA_FOV * Math.PI) / 360);
    const currentTan = Math.tan((this.fov * Math.PI) / 360);
    const desiredFootprint = this.spherical.radius * currentTan * factor;
    const radiusAtOrdinaryLens = desiredFootprint / baseTan;
    if (radiusAtOrdinaryLens >= MIN_RADIUS) {
      this.spherical.radius = clampRadius(radiusAtOrdinaryLens);
      this.fov = DEFAULT_CAMERA_FOV;
      return;
    }

    this.spherical.radius = MIN_RADIUS;
    this.fov = clampCameraFov(
      (2 * Math.atan(desiredFootprint / MIN_RADIUS) * 180) / Math.PI,
    );
  }

  /** Enable/exit continuous zoom. Exiting restores the ordinary lens; the
   * radius and focus remain, so the user can resume normal navigation. */
  setInfiniteZoom(enabled: boolean): void {
    this.infiniteZoom = enabled;
    if (!enabled) this.fov = DEFAULT_CAMERA_FOV;
  }

  /** Return to the ordinary lens without changing whether the mode is armed. */
  resetLens(): void {
    this.fov = DEFAULT_CAMERA_FOV;
  }

  get deepMagnification(): number {
    return deepZoomMagnification(this.fov);
  }

  get deepZoomLimitReached(): boolean {
    return this.fov <= MIN_DEEP_ZOOM_FOV;
  }

  /** Shift the orbit target by a world-space delta. */
  panBy(dx: number, dy: number, dz: number): void {
    this.target[0] += dx;
    this.target[1] += dy;
    this.target[2] += dz;
  }

  /** Current world-space camera position. */
  position(): Vec3 {
    const offset = sphericalToCartesian(this.spherical);
    return [
      this.target[0] + offset[0],
      this.target[1] + offset[1],
      this.target[2] + offset[2],
    ];
  }
}

// --- Auto-fit: frame a freshly-generated attractor in view ----------------
//
// Triggered only on whole-system replacement (a preset load or "Surprise Me"),
// never on a geometry edit or Regenerate — see the call sites in main.ts.

/** Midpoint of a point cloud's axis-aligned bounding box. */
export function boundsCenter(bounds: Bounds): Vec3 {
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
}

/**
 * Camera distance that frames `bounds` entirely within a `fovYRadians` x
 * `aspect` perspective frustum, with `margin` breathing room (1.25 = a 25%
 * pad beyond a snug fit).
 *
 * Treats the box as a bounding sphere of radius `r` (half its diagonal) and
 * solves `r * margin = distance * tan(halfAngle)` for distance, using
 * whichever of the vertical/horizontal half-angles is narrower — the wider
 * one always has room to spare, so the narrower one is what actually
 * constrains the fit in a viewport that isn't square.
 *
 * A near-zero `r` (an empty or collapsed cloud has nothing to measure a fit
 * distance from) falls back to the boot camera's own radius instead of
 * producing a degenerate (zero or NaN) distance.
 */
export function fitRadius(
  bounds: Bounds,
  fovYRadians: number,
  aspect: number,
  margin = 1.25,
): number {
  const dx = bounds.maxX - bounds.minX;
  const dy = bounds.maxY - bounds.minY;
  const dz = bounds.maxZ - bounds.minZ;
  const r = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (r < 1e-6) return clampRadius(BOOT_RADIUS);

  const halfFovY = fovYRadians / 2;
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  const halfAngle = Math.min(halfFovY, halfFovX);
  return clampRadius((r * margin) / Math.tan(halfAngle));
}

/**
 * Cubic ease with a clamped input: 0 at `x <= 0`, 1 at `x >= 1`, smooth
 * (zero slope at both ends) in between. Used to animate the camera tween's
 * progress ratio (`elapsed / CAMERA_TWEEN_MS`) in `camera-tween.ts`'s
 * `CameraTween.advance`.
 */
export function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
