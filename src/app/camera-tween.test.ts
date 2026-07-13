import { OrbitCamera, boundsCenter, fitRadius } from "./orbit";
import type { Bounds } from "../fractal/types";
import {
  CameraTween,
  CAMERA_TRACK_TAU_MS,
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

describe("CameraTween.finish", () => {
  it("jumps to the glide's end target/radius and clears it, even mid-flight", () => {
    let clock = 0;
    const orbit = new OrbitCamera([5, 4, 5]);
    const tween = new CameraTween(
      orbit,
      () => clock,
      () => false,
    );
    tween.fitToBounds(SAMPLE_BOUNDS, FRAMING);

    // Advance only partway (t < 1) so the orbit is still mid-glide when
    // finish() is called.
    clock = CAMERA_TWEEN_MS / 3;
    tween.advance();
    expect(tween.active).toBe(true);

    tween.finish();

    const fit = expectedFit(SAMPLE_BOUNDS);
    expect(orbit.target[0]).toBeCloseTo(fit.target[0]);
    expect(orbit.target[1]).toBeCloseTo(fit.target[1]);
    expect(orbit.target[2]).toBeCloseTo(fit.target[2]);
    expect(orbit.spherical.radius).toBeCloseTo(fit.radius);
    expect(tween.active).toBe(false);
  });

  it("is a no-op when no glide is in flight", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    const startRadius = orbit.spherical.radius;
    const tween = new CameraTween(
      orbit,
      () => 0,
      () => false,
    );

    expect(() => tween.finish()).not.toThrow();

    expect(orbit.spherical.radius).toBe(startRadius);
    expect(orbit.target).toEqual([0, 0, 0]);
    expect(tween.active).toBe(false);
  });
});

describe("CameraTween.track (fr-cfoc)", () => {
  // A second box well away from SAMPLE_BOUNDS, for retargeting scenarios.
  const OTHER_BOUNDS: Bounds = {
    minX: 9,
    maxX: 13,
    minY: 10,
    maxY: 14,
    minZ: -6,
    maxZ: -2,
    minR: 0,
    maxR: 20,
  };

  it("chases the fit exponentially: one time constant closes ~63% of the distance", () => {
    let clock = 0;
    const orbit = new OrbitCamera([5, 4, 5]);
    const startRadius = orbit.spherical.radius;
    const tween = new CameraTween(
      orbit,
      () => clock,
      () => false,
    );

    tween.track(SAMPLE_BOUNDS, FRAMING);
    clock = CAMERA_TRACK_TAU_MS;
    tween.advance();

    const fit = expectedFit(SAMPLE_BOUNDS);
    const alpha = 1 - Math.exp(-1);
    expect(orbit.spherical.radius).toBeCloseTo(
      startRadius + (fit.radius - startRadius) * alpha,
    );
    expect(orbit.target[0]).toBeCloseTo(fit.target[0] * alpha);
    // Never self-terminating: still following, ready for the next retarget.
    expect(tween.active).toBe(true);
  });

  it("takes the same path however irregularly advance() is called (dt-aware)", () => {
    let clockA = 0;
    const orbitA = new OrbitCamera([5, 4, 5]);
    const tweenA = new CameraTween(
      orbitA,
      () => clockA,
      () => false,
    );
    tweenA.track(SAMPLE_BOUNDS, FRAMING);
    for (const t of [100, 200, 300, 400]) {
      clockA = t;
      tweenA.advance();
    }

    let clockB = 0;
    const orbitB = new OrbitCamera([5, 4, 5]);
    const tweenB = new CameraTween(
      orbitB,
      () => clockB,
      () => false,
    );
    tweenB.track(SAMPLE_BOUNDS, FRAMING);
    for (const t of [50, 400]) {
      clockB = t;
      tweenB.advance();
    }

    // exp(-a)·exp(-b) = exp(-(a+b)): the remaining distance depends only on
    // total elapsed time, not on how many frames it was sliced into.
    expect(orbitA.spherical.radius).toBeCloseTo(orbitB.spherical.radius);
    expect(orbitA.target[0]).toBeCloseTo(orbitB.target[0]);
  });

  it("retargets an in-flight chase without restarting or jumping the camera", () => {
    let clock = 0;
    const orbit = new OrbitCamera([5, 4, 5]);
    const tween = new CameraTween(
      orbit,
      () => clock,
      () => false,
    );
    tween.track(SAMPLE_BOUNDS, FRAMING);
    clock = 200;
    tween.advance();
    const radiusBefore = orbit.spherical.radius;
    const targetBefore = [...orbit.target];

    // A fresh intermediate landed with different bounds mid-chase.
    tween.track(OTHER_BOUNDS, FRAMING);

    // Retargeting alone moves nothing — only the next advance does, from
    // exactly where the camera already was.
    expect(orbit.spherical.radius).toBe(radiusBefore);
    expect(orbit.target).toEqual(targetBefore);

    clock = 400;
    tween.advance();
    const fit = expectedFit(OTHER_BOUNDS);
    const alpha = 1 - Math.exp(-200 / CAMERA_TRACK_TAU_MS);
    expect(orbit.spherical.radius).toBeCloseTo(
      radiusBefore + (fit.radius - radiusBefore) * alpha,
    );
  });

  it("snaps straight to the fit under reduced motion, leaving nothing in flight", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    const tween = new CameraTween(
      orbit,
      () => 0,
      () => true,
    );

    tween.track(SAMPLE_BOUNDS, FRAMING);

    const fit = expectedFit(SAMPLE_BOUNDS);
    expect(orbit.spherical.radius).toBeCloseTo(fit.radius);
    expect(orbit.target[0]).toBeCloseTo(fit.target[0]);
    expect(tween.active).toBe(false);
  });

  it("is replaced by fitToBounds — the terminal fit's settle glide takes over", () => {
    let clock = 0;
    const orbit = new OrbitCamera([5, 4, 5]);
    const tween = new CameraTween(
      orbit,
      () => clock,
      () => false,
    );
    tween.track(OTHER_BOUNDS, FRAMING);
    clock = 200;
    tween.advance();

    tween.fitToBounds(SAMPLE_BOUNDS, FRAMING);
    clock = 200 + CAMERA_TWEEN_MS;
    tween.advance();

    // The glide lands EXACTLY on its fit and clears — chase semantics (which
    // never land exactly, only approach) no longer apply.
    const fit = expectedFit(SAMPLE_BOUNDS);
    expect(orbit.spherical.radius).toBeCloseTo(fit.radius);
    expect(orbit.target[0]).toBeCloseTo(fit.target[0]);
    expect(tween.active).toBe(false);
  });

  it("cancel() drops the chase where it is — grabbing the camera mid-morph", () => {
    let clock = 0;
    const orbit = new OrbitCamera([5, 4, 5]);
    const tween = new CameraTween(
      orbit,
      () => clock,
      () => false,
    );
    tween.track(SAMPLE_BOUNDS, FRAMING);
    clock = 100;
    tween.advance();
    const radiusAtCancel = orbit.spherical.radius;

    tween.cancel();
    clock = 500;
    tween.advance();

    expect(orbit.spherical.radius).toBe(radiusAtCancel);
    expect(tween.active).toBe(false);
  });

  it("finish() completes the chase instantly at its current target", () => {
    const orbit = new OrbitCamera([5, 4, 5]);
    const tween = new CameraTween(
      orbit,
      () => 0,
      () => false,
    );
    tween.track(SAMPLE_BOUNDS, FRAMING);

    tween.finish();

    const fit = expectedFit(SAMPLE_BOUNDS);
    expect(orbit.spherical.radius).toBeCloseTo(fit.radius);
    expect(orbit.target[0]).toBeCloseTo(fit.target[0]);
    expect(tween.active).toBe(false);
  });
});
