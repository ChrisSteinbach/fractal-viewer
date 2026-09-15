import type { Bounds4 } from "../fractal/types";
import { MIN_RADIUS, sphericalToCartesian } from "./orbit";
import {
  presetCameraPose,
  presetFourDPose,
  presetRotorPair,
} from "./preset-view";
import {
  identityRotorPair,
  rotateInPlane,
  rotorMatrix,
  wSupport,
} from "./rotor4";

describe("presetCameraPose", () => {
  it("places the camera exactly at the authored eye when it is far enough from the target", () => {
    const pose = presetCameraPose({
      camera: { eye: [0.4, 1.6, 0.5], target: [0, 0, 0], fov: 62 },
    });
    const offset = sphericalToCartesian(pose);
    expect(pose.target).toEqual([0, 0, 0]);
    expect(pose.target[0] + offset[0]).toBeCloseTo(0.4, 12);
    expect(pose.target[1] + offset[1]).toBeCloseTo(1.6, 12);
    expect(pose.target[2] + offset[2]).toBeCloseTo(0.5, 12);
    expect(pose.fov).toBe(62);
  });

  it("pushes the pivot out along the line of sight for an interior eye closer than the orbit minimum, keeping eye and direction", () => {
    const eye = [0.15, 0.3, 0.1] as const;
    const target = [-0.2, -0.3, 0.1] as const;
    const pose = presetCameraPose({
      camera: { eye: [...eye], target: [...target], fov: 81 },
    });
    expect(pose.radius).toBe(MIN_RADIUS);
    const offset = sphericalToCartesian(pose);
    const cam = pose.target.map((t, i) => t + offset[i]);
    for (let i = 0; i < 3; i++) expect(cam[i]).toBeCloseTo(eye[i], 12);
    const authored = target.map((t, i) => t - eye[i]);
    const len = Math.hypot(...authored);
    for (let i = 0; i < 3; i++) {
      expect(-offset[i] / pose.radius).toBeCloseTo(authored[i] / len, 12);
    }
  });
});

describe("presetFourDPose", () => {
  const bounds: Bounds4 = {
    minX: -1.2,
    maxX: 1.2,
    minY: -1.1,
    maxY: 1.3,
    minZ: -1,
    maxZ: 1,
    minW: -0.8,
    maxW: 0.8,
  };

  it("composes the plane rotations in the order listed", () => {
    const pair = presetRotorPair({
      rotation: [
        ["xw", 0.4],
        ["yw", 0.3],
      ],
      w0: 0,
    });
    const expected = rotateInPlane(
      rotateInPlane(identityRotorPair(), "xw", 0.4),
      "yw",
      0.3,
    );
    expect(pair).toEqual(expected);
  });

  it("normalizes a world w0 so the tracer's own conversion lands back on it", () => {
    const fourD = {
      rotation: [
        ["xw", 0.4],
        ["zw", 0.2],
      ] as const,
      w0: 0.1545,
    };
    const pose = presetFourDPose(fourD, bounds);
    // scene.ts's setSurface4View: w0 = sliceCenter · wSupport(rotor, half).
    const half = [1.2, 1.2, 1, 0.8] as [number, number, number, number];
    const world = pose.sliceCenter * wSupport(rotorMatrix(pose.pair), half);
    expect(world).toBeCloseTo(0.1545, 12);
  });

  it("turns the slice window on at zero thickness", () => {
    const pose = presetFourDPose({ rotation: [], w0: 0.2 }, bounds);
    expect(pose.sliceOn).toBe(true);
    expect(pose.sliceThickness).toBe(0);
    expect(pose.sliceCenter).toBeCloseTo(0.25, 12);
  });

  it("clamps a slice past the cloud's support to the slider's domain", () => {
    const pose = presetFourDPose({ rotation: [], w0: -2 }, bounds);
    expect(pose.sliceCenter).toBe(-1);
  });
});
