import { OrbitCamera, boundsCenter, fitRadius } from "./orbit";
import type { Bounds } from "../fractal/types";
import {
  CameraTween,
  CAMERA_TWEEN_MS,
  fourDFramingBounds,
} from "./camera-tween";

// Three.js PerspectiveCamera defaults are close to this; the exact values don't
// matter to the tween, only that fitToBounds/advance route them into fitRadius.
const FRAMING = { fov: 75, aspect: 1.5 };

// A generic off-origin box: center [1, 2, 4], half-extent 2 on every axis.
const SAMPLE_BOUNDS: Bounds = {
  minX: -1,
  maxX: 3,
  minY: 0,
  maxY: 4,
  minZ: 2,
  maxZ: 6,
  minR: 0,
  maxR: 8,
};

/** Where a fit to `bounds` under `FRAMING` should land the camera. */
function expectedFit(bounds: Bounds): { target: number[]; radius: number } {
  return {
    target: boundsCenter(bounds),
    radius: fitRadius(bounds, (FRAMING.fov * Math.PI) / 180, FRAMING.aspect),
  };
}

describe("fourDFramingBounds", () => {
  it("frames a box whose half-diagonal equals the radius", () => {
    // fitRadius reads the box as a bounding sphere of radius = half-diagonal,
    // so the synthesized box must have half-diagonal == radius to frame exactly
    // the radius-`radius` 4D ball at any tumble angle.
    const box = fourDFramingBounds([1, 2, 3, 4], 6);

    const halfDiagonal = Math.hypot(
      (box.maxX - box.minX) / 2,
      (box.maxY - box.minY) / 2,
      (box.maxZ - box.minZ) / 2,
    );
    expect(halfDiagonal).toBeCloseTo(6);
  });

  it("centers the box on the point's xyz and ignores its w", () => {
    const box = fourDFramingBounds([1, 2, 3, 99], 6);

    const center = boundsCenter(box);
    expect(center[0]).toBeCloseTo(1);
    expect(center[1]).toBeCloseTo(2);
    expect(center[2]).toBeCloseTo(3);
  });

  it("fills minR/maxR to [0, radius] for a well-formed box", () => {
    const box = fourDFramingBounds([0, 0, 0, 0], 6);

    expect(box.minR).toBe(0);
    expect(box.maxR).toBe(6);
  });
});

describe("CameraTween.fitToBounds", () => {
  it("snaps straight to the fit under reduced motion, leaving no glide in flight", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    const tween = new CameraTween(
      orbit,
      () => 0,
      () => true,
    );

    tween.fitToBounds(SAMPLE_BOUNDS, FRAMING);

    const fit = expectedFit(SAMPLE_BOUNDS);
    expect(orbit.target[0]).toBeCloseTo(fit.target[0]);
    expect(orbit.target[1]).toBeCloseTo(fit.target[1]);
    expect(orbit.target[2]).toBeCloseTo(fit.target[2]);
    expect(orbit.spherical.radius).toBeCloseTo(fit.radius);
    expect(tween.active).toBe(false);
  });

  it("starts a glide without moving the camera yet when motion is not reduced", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    const startRadius = orbit.spherical.radius;
    const tween = new CameraTween(
      orbit,
      () => 0,
      () => false,
    );

    tween.fitToBounds(SAMPLE_BOUNDS, FRAMING);

    // The camera only moves once advance() runs — fitToBounds just records the
    // endpoints and arms the glide.
    expect(tween.active).toBe(true);
    expect(orbit.spherical.radius).toBe(startRadius);
    expect(orbit.target).toEqual([0, 0, 0]);
  });
});

describe("CameraTween.advance", () => {
  it("reaches the fit exactly once the tween duration has elapsed, then clears", () => {
    let clock = 0;
    const orbit = new OrbitCamera([5, 4, 5]);
    const tween = new CameraTween(
      orbit,
      () => clock,
      () => false,
    );
    tween.fitToBounds(SAMPLE_BOUNDS, FRAMING);

    clock = CAMERA_TWEEN_MS;
    tween.advance();

    const fit = expectedFit(SAMPLE_BOUNDS);
    expect(orbit.target[0]).toBeCloseTo(fit.target[0]);
    expect(orbit.target[1]).toBeCloseTo(fit.target[1]);
    expect(orbit.target[2]).toBeCloseTo(fit.target[2]);
    expect(orbit.spherical.radius).toBeCloseTo(fit.radius);
    expect(tween.active).toBe(false);
  });

  it("is halfway to the fit radius at half the duration (smoothstep(0.5) = 0.5)", () => {
    let clock = 0;
    const orbit = new OrbitCamera([5, 4, 5]);
    const startRadius = orbit.spherical.radius;
    const tween = new CameraTween(
      orbit,
      () => clock,
      () => false,
    );
    tween.fitToBounds(SAMPLE_BOUNDS, FRAMING);

    clock = CAMERA_TWEEN_MS / 2;
    tween.advance();

    const fit = expectedFit(SAMPLE_BOUNDS);
    expect(orbit.spherical.radius).toBeCloseTo((startRadius + fit.radius) / 2);
    // Still in flight — a partial advance must not clear the glide.
    expect(tween.active).toBe(true);
  });

  it("is a no-op when no glide is in flight", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    const startRadius = orbit.spherical.radius;
    const tween = new CameraTween(
      orbit,
      () => 0,
      () => false,
    );

    tween.advance();

    expect(orbit.spherical.radius).toBe(startRadius);
    expect(orbit.target).toEqual([0, 0, 0]);
  });
});

describe("CameraTween.cancel", () => {
  it("drops an in-flight glide so a later advance leaves the camera put", () => {
    let clock = 0;
    const orbit = new OrbitCamera([5, 4, 5]);
    const startRadius = orbit.spherical.radius;
    const tween = new CameraTween(
      orbit,
      () => clock,
      () => false,
    );
    tween.fitToBounds(SAMPLE_BOUNDS, FRAMING);

    tween.cancel();
    clock = CAMERA_TWEEN_MS;
    tween.advance();

    expect(tween.active).toBe(false);
    expect(orbit.spherical.radius).toBe(startRadius);
    expect(orbit.target).toEqual([0, 0, 0]);
  });
});
