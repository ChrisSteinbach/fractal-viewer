import type { Vec3 } from "../fractal/types";

export const MIN_RADIUS = 1;
export const MAX_RADIUS = 100;
export const MIN_PHI = 0.01;
export const MAX_PHI = Math.PI - 0.01;
/** Radians of orbit per pixel of drag. */
export const ROTATE_SPEED = 0.01;

/** Spherical coordinates in Three.js's convention (phi measured from +Y). */
export interface Spherical {
  radius: number;
  theta: number;
  phi: number;
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
    this.spherical.radius = clampRadius(this.spherical.radius * factor);
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
