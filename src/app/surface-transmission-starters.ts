import { identityRotorPair, rotateInPlane } from "./rotor4";
import type { RotorPair } from "./rotor4";
import type { FourDPose } from "./four-d-view";
import { toSnapshot, type SceneSnapshot } from "./persist";
import { initialState } from "./state";
import type { Transform, Vec3 } from "../fractal/types";
import type { CameraPose } from "./orbit";
import { sphericalFromCartesian } from "./orbit";

/**
 * The transmission material's starter compositions — the glass bundle's
 * "Load a preset…" discovery path, built the Lit interiors way: whole
 * editable `SceneSnapshot`s (ordinary scene documents, no preset-only
 * renderer overrides) that share the preset menu's one door.
 *
 * WHAT QUALIFIES THESE COMPOSITIONS. The dielectric transport resolves on
 * the closed-solid backend, whose signed field is the condensation union —
 * so both starters are EMITTER-ONLY C0 systems (every transform carries an
 * analytic shape emitter, no recursive maps), the exact shape the
 * qualification and the bench's emitter-only union legs pin. Both author
 * `optics: {model: "dielectric", distortion: 0.08}` on every transform —
 * the Glass bundle's model at the distortion study's working value — and
 * both run the ground plane: the checker floor is the bright rear
 * structure the transmission and its restrained distortion are FOR (the
 * bead's "actual rear structure" — bent checker lines read through the
 * glass where a uniform backdrop would show nothing).
 *
 * THE 4D POSE IS THE QUALIFIED ONE. The 4D starter's members sit at one
 * common world w with the slice ON that hyperplane and the rotor's planes
 * both avoiding w — the canonical composition the closed-solid field's
 * penalty form needs to vanish identically (`surface-optics-backend.ts`).
 * It is a genuinely non-flat system (the members' w translation lifts them
 * out of the w = 0 hyperplane; the routing admission's flat-in-slice check
 * passes because the slice is exactly there), and scrubbing the slice off
 * the members' plane is real 4D navigation — with the disclosed cost that
 * the transmission degrades to honest refusals off the carried flat.
 *
 * A starter supports discovery; it cannot be the only scene on which the
 * material is correct. The capability matrix
 * (`docs/surface-dielectric-transport.md`) owns the broader envelope: the
 * estimator backend's vacuous state on IFS geometry, the fold core's
 * measured refusal, the forward families' non-admission.
 */

export const SURFACE_TRANSMISSION_STARTERS = [
  { id: "glass-garden", label: "Glass garden (3D)" },
  { id: "glass-cells", label: "Glass cells (4D)" },
] as const;

export type SurfaceTransmissionStarterId =
  (typeof SURFACE_TRANSMISSION_STARTERS)[number]["id"];

/** These entries share the preset menu's one "Replace with preset" door,
 * but they are NOT `Preset` keys — the Lit interiors split, one door and
 * two load paths. The value prefix is what keeps the two apart inside one
 * `<select>`. */
export const SURFACE_TRANSMISSION_STARTER_PREFIX = "glass:";

export function surfaceTransmissionStarterValue(
  id: SurfaceTransmissionStarterId,
): string {
  return `${SURFACE_TRANSMISSION_STARTER_PREFIX}${id}`;
}

export function surfaceTransmissionStarterFromValue(
  value: string,
): SurfaceTransmissionStarterId | undefined {
  return SURFACE_TRANSMISSION_STARTERS.find(
    (entry) => surfaceTransmissionStarterValue(entry.id) === value,
  )?.id;
}

/** The optics every starter transform authors: the Glass bundle's model at
 * the distortion study's working value. One definition for both
 * compositions, so a retune is one edit. */
const STARTER_OPTICS = { model: "dielectric", distortion: 0.08 } as const;

function camera(eye: Vec3, target: Vec3, zoom: number): CameraPose {
  const offset: Vec3 = [
    eye[0] - target[0],
    eye[1] - target[1],
    eye[2] - target[2],
  ];
  return {
    target,
    ...sphericalFromCartesian(...offset),
    // The reference's zoom is tan(vertical FOV / 2), not a dolly multiplier.
    fov: (360 * Math.atan(zoom)) / Math.PI,
  };
}

const encoded = (linear: Vec3): Vec3 => [
  Math.pow(linear[0], 1 / 2.2),
  Math.pow(linear[1], 1 / 2.2),
  Math.pow(linear[2], 1 / 2.2),
];

/** The shared backdrop: a bright studio gradient — the Fresnel rims and
 * the refracted interior read against it, and a dark stop would render
 * every grazing reflection black. The checker floor provides the
 * high-contrast rear structure; the gradient keeps the upper half of a
 * transmission path from reading empty. */
const BACKDROP = {
  mode: "custom",
  shape: "linear",
  custom: {
    top: encoded([0.62, 0.68, 0.76]),
    bottom: encoded([0.3, 0.33, 0.4]),
  },
} as const;

function baseState(): ReturnType<typeof initialState> {
  const state = initialState(true);
  state.showGuides = false;
  state.fogDensity = 0;
  state.background = { ...BACKDROP };
  state.groundPlane = true;
  // The checker floor is the bright rear structure the transmission and
  // its restrained distortion are for — a solid floor gives a refraction
  // path nothing to bend.
  state.surface = { ...state.surface, floorPattern: "checker" };
  return state;
}

/** A posed glass emitter: one analytic part, the transform's TRS as the
 * pose, the model's optics, and its own palette slot for the explorer's
 * By-Transform view (the transport replaces a glass slot's shaded output,
 * so the color is the explorer's, not the surface's). */
function glassEmitter(
  id: number,
  position: Vec3,
  scale: number,
  colorIndex: number,
  parts: Transform["emitter"],
): Transform {
  return {
    id,
    position,
    rotation: [0, 0, 0],
    scale: [scale, scale, scale],
    weight: 1,
    colorIndex,
    optics: { ...STARTER_OPTICS },
    emitter: parts,
  };
}

const sphere = (radius: number) => ({
  parts: [
    {
      primitive: { kind: "sphere", radius } as const,
      combine: "union" as const,
    },
  ],
});

function glassGarden(): SceneSnapshot {
  const state = baseState();
  // A shallow depth arrangement: the tall box slab behind, the large
  // sphere in front of it, the small pair flanking — every sight line
  // through the front glass crosses another member or the floor checker.
  state.transforms = [
    glassEmitter(0, [0, -0.1, 0], 0.62, 0.55, sphere(1)),
    glassEmitter(1, [0, -0.85, -0.75], 0.5, 0.72, sphere(1)),
    glassEmitter(2, [-0.85, -0.35, 0.45], 0.3, 0.42, sphere(1)),
    glassEmitter(3, [0.9, -0.45, 0.3], 0.26, 0.12, sphere(1)),
    {
      id: 4,
      position: [0.55, -0.62, -0.5],
      rotation: [0.1, 0.45, 0.05],
      scale: [0.34, 0.72, 0.34],
      weight: 1,
      colorIndex: 0.3,
      optics: { ...STARTER_OPTICS },
      emitter: {
        parts: [
          { primitive: { kind: "box", half: [0.7, 1, 0.7] }, combine: "union" },
        ],
      },
    },
  ];
  return {
    ...toSnapshot(state),
    camera: camera([1.15, 0.35, 2.35], [0, -0.25, 0], 0.62),
  };
}

/** The 4D composition's pose: a w-preserving rotor (both planes avoid w —
 * a rigid 3D-looking turn of the sliced object) and the slice on the w = 0
 * hyperplane the members' flats sit in. Saved as a world `sliceW`, the
 * pose the document prefers on decode; w0 = 0 is the one slice position
 * whose pack is exact at ANY cloud w-support, which is why the canonical
 * composition pins it. */
function posed4DPose(): FourDPose {
  const pair: RotorPair = rotateInPlane(identityRotorPair(), "yz", 0.42);
  return {
    pair: { p: [...pair.p], q: [...pair.q] },
    sliceOn: true,
    sliceCenter: 0,
    sliceW: 0,
    sliceThickness: 0,
    sliceRelColor: false,
  };
}

function glassCells(): SceneSnapshot {
  const state = baseState();
  // A hypertetrahedron's four corners, one glass member each. Each carries
  // a `w` scale — the non-flat degree of freedom that lifts the session
  // onto the native 4D pipeline — parked at a value that keeps every
  // member's flat in the w = 0 hyperplane the slice displays: the
  // canonical composition the closed-solid field's penalty form needs
  // (the members' shapes are 3D flats, so a slice OFF their plane shows
  // nothing, and a zero-extent cloud makes every other slice position's
  // pack degenerate). Scrubbing the slice off zero is real 4D navigation
  // with the disclosed cost that the transmission degrades to honest
  // refusals off the carried flat.
  const r = 0.62;
  const corners: Array<[Vec3, number]> = [
    [[0.5, -0.15, 0.45], 0.12],
    [[-0.5, -0.15, 0.45], 0.55],
    [[0, -0.15, -0.6], 0.72],
    [[0, 0.72, 0.1], 0.35],
  ];
  state.transforms = corners.map(([position, colorIndex], id) => ({
    id,
    position,
    rotation: [0, 0, 0],
    scale: [r, r, r],
    weight: 1,
    colorIndex,
    w: { scale: 0.5 },
    optics: { ...STARTER_OPTICS },
    emitter: {
      parts: [{ primitive: { kind: "sphere", radius: 1 }, combine: "union" }],
    },
  }));
  return {
    ...toSnapshot(state),
    camera: camera([1.9, 0.85, 2.9], [0, 0.05, 0], 0.6),
    fourD: posed4DPose(),
  };
}

/** Every call owns its transforms, optics, camera, backdrop and floor.
 * Callers load the snapshot through the normal scene-replacement path; the
 * surface-mode entry is the caller's (the shared load-hint arm). */
export function createSurfaceTransmissionStarter(
  id: SurfaceTransmissionStarterId,
): SceneSnapshot {
  return id === "glass-garden" ? glassGarden() : glassCells();
}
