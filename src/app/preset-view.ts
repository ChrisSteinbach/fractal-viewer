/**
 * A preset's authored VIEW turned into the app's live framing: the orbit
 * camera pose and, for a 4D scene, the rotor/slice pose. `presets.ts`
 * authors the view as plain data in the terms a reader can check against
 * a render — an eye, a look-at point, a vertical field of view, an ordered
 * list of plane rotations and a WORLD `w0` — because the app's own pose
 * vocabularies are the wrong units to author in:
 *
 * - `CameraPose` is a pivot plus a spherical offset whose radius the orbit
 *   camera clamps to at least {@link MIN_RADIUS}. An interior view (a vault
 *   seen from inside) sits closer to its subject than that, so the pivot is
 *   pushed out ALONG the line of sight until the offset reaches the minimum:
 *   the eye and the view direction are exactly the authored ones, and only
 *   the point the orbit gesture pivots around moves.
 * - `FourDPose.sliceCenter` is NORMALIZED rotated-w: `scene.ts`'s
 *   `setSurface4View` multiplies it by `wSupport(rotor, cloud half-extents)`.
 *   The half-extents are the landed Points cloud's, known only when the
 *   preset's cloud arrives, so the conversion runs there, against that
 *   cloud's own bounds — the same numbers the tracer will multiply by.
 *
 * Pure and DOM-free, so both conversions are unit-tested.
 */
import type { PresetFourDView, PresetView } from "../fractal/presets";
import type { Bounds4, Vec3, Vec4 } from "../fractal/types";
import { normalizedSliceCenter, type FourDPose } from "./four-d-view";
import { MIN_RADIUS, sphericalFromCartesian, type CameraPose } from "./orbit";
import {
  identityRotorPair,
  rotateInPlane,
  rotorMatrix,
  type RotorPair,
  wSupport,
} from "./rotor4";

/** The orbit pose that puts the camera at the view's eye, looking at its
 * target, with the pivot pushed out along the line of sight when the eye is
 * closer to the target than the orbit camera's minimum radius. */
export function presetCameraPose(view: PresetView): CameraPose {
  const { eye, target } = view.camera;
  const d: Vec3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(len > 0)) {
    throw new Error("a preset view's eye and target must differ");
  }
  const radius = Math.max(len, MIN_RADIUS);
  const pivot: Vec3 =
    len >= MIN_RADIUS
      ? [target[0], target[1], target[2]]
      : [
          eye[0] + (d[0] / len) * radius,
          eye[1] + (d[1] / len) * radius,
          eye[2] + (d[2] / len) * radius,
        ];
  const s = sphericalFromCartesian(
    eye[0] - pivot[0],
    eye[1] - pivot[1],
    eye[2] - pivot[2],
  );
  return {
    target: pivot,
    radius,
    theta: s.theta,
    phi: s.phi,
    fov: view.camera.fov,
  };
}

/** The rotor the view's plane rotations compose to, in the order listed,
 * each applied on top of the previous (`rotateInPlane`'s convention). */
export function presetRotorPair(fourD: PresetFourDView): RotorPair {
  let pair = identityRotorPair();
  for (const [plane, angle] of fourD.rotation) {
    pair = rotateInPlane(pair, plane, angle);
  }
  return pair;
}

/** The 4D pose whose slice lands at the view's WORLD `w0` for a cloud with
 * these bounds, clamped to the slice slider's normalized domain. The slice
 * window is on, so the Points cloud the preset lands in already shows the
 * slice its Surface session traces. */
export function presetFourDPose(
  fourD: PresetFourDView,
  bounds: Bounds4,
): FourDPose {
  const pair = presetRotorPair(fourD);
  const halfExtents: Vec4 = [
    (bounds.maxX - bounds.minX) / 2,
    (bounds.maxY - bounds.minY) / 2,
    (bounds.maxZ - bounds.minZ) / 2,
    (bounds.maxW - bounds.minW) / 2,
  ];
  const support = Math.max(wSupport(rotorMatrix(pair), halfExtents), 1e-6);
  return {
    pair,
    sliceOn: true,
    sliceCenter: normalizedSliceCenter(fourD.w0, support),
    // The authored `w0` IS the world hyperplane, so the preset carries it
    // through untouched rather than being re-derived from anything: a preset
    // lands on the same plane in every session, however its cloud fell. The
    // normalized value beside it is this cloud's reading of that same plane.
    sliceW: fourD.w0,
    sliceThickness: 0,
    sliceRelColor: false,
  };
}
