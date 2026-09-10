/** Complete editable compositions. These are ordinary scene documents: no
 * preset-only renderer overrides.
 *
 * BOTH LOST THEIR MIST when the participating medium was removed on its
 * measured cost (see surface-lighting.ts), so what the CPU reference review
 * accepted is NOT what these render today — the cathedral's god-rays were
 * most of what that review looked at. Their lights, camera, palette and
 * backdrop are unchanged and unretuned; treat the compositions as owing a
 * fresh aesthetic judgement, not as accepted. */
import { mengerSponge } from "../fractal/presets";
import type { SurfaceDiskLight } from "../fractal/surface-lighting";
import type { Vec3 } from "../fractal/types";
import { sphericalFromCartesian, type CameraPose } from "./orbit";
import { toSnapshot, type SceneSnapshot } from "./persist";
import { initialState } from "./state";

export const SURFACE_LIGHTING_STARTERS = [
  { id: "cathedral", label: "Menger cathedral" },
  { id: "balloon-cavern", label: "Balloon cavern" },
] as const;

export type SurfaceLightingStarterId =
  (typeof SURFACE_LIGHTING_STARTERS)[number]["id"];

/** These entries share the preset menu's one "Replace with preset" door, but
 * they are NOT `Preset` keys: a preset resolves to a transform system plus its
 * side tables and auto-fits the camera, while a starter is a whole
 * `SceneSnapshot` whose authored camera, backdrop, palette and rig ARE the
 * composition. The value prefix is what keeps the two apart inside one
 * `<select>` — the composition pickers' `preset:`/`saved:` sources already
 * read that way — so the menu stays one door and the load paths stay two. */
export const SURFACE_LIGHTING_STARTER_PREFIX = "starter:";

export function surfaceLightingStarterValue(
  id: SurfaceLightingStarterId,
): string {
  return `${SURFACE_LIGHTING_STARTER_PREFIX}${id}`;
}

/** The menu value back to a starter id, or `undefined` for anything else —
 * an unprefixed preset key included, so a caller can branch on one call. */
export function surfaceLightingStarterFromValue(
  value: string,
): SurfaceLightingStarterId | undefined {
  return SURFACE_LIGHTING_STARTERS.find(
    (entry) => surfaceLightingStarterValue(entry.id) === value,
  )?.id;
}

function light(
  position: Vec3,
  target: Vec3,
  radius: number,
  color: Vec3,
  intensity: number,
): SurfaceDiskLight {
  const offset: Vec3 = [
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ];
  const length = Math.hypot(...offset);
  return {
    position,
    normal: [offset[0] / length, offset[1] / length, offset[2] / length],
    radius,
    color,
    intensity,
  };
}

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

/** Every call owns its transforms, colors, camera and nested rig. Callers load
 * the snapshot through the normal scene-replacement path, then enter Surface;
 * render mode is session state and deliberately absent from SceneSnapshot. */
export function createSurfaceLightingStarter(
  id: SurfaceLightingStarterId,
): SceneSnapshot {
  const state = initialState(true);
  state.transforms = mengerSponge();
  state.showGuides = false;
  state.fogDensity = 0;
  state.background = {
    mode: "custom",
    shape: "linear",
    custom: {
      top: encoded([0.011, 0.017, 0.028]),
      bottom: encoded([0.003, 0.004, 0.008]),
    },
  };
  state.surface = {
    ...state.surface,
    antialiasSamples: 8,
    colorSource: "palette",
    paletteId: "custom",
  };
  const base: Vec3 =
    id === "cathedral" ? [0.76, 0.69, 0.56] : [0.61, 0.68, 0.7];
  state.customPalette = { stops: [[...base], [...base]] };
  let pose: CameraPose;
  if (id === "cathedral") {
    pose = camera([0.065, -0.17, 0.72], [-0.035, 0.13, -0.5], 0.6);
    state.surface.lighting = {
      lights: [
        light([0, 0.2, -1.05], [0.08, -0.1, 0.7], 0.07, [1, 0.56, 0.22], 7),
        light([-0.95, 0, 0], [0, 0, 0], 0.14, [0.16, 0.46, 1], 4),
      ],
      ambient: [0.065, 0.055, 0.05],
      specular: 0.12,
      roughness: 0.52,
    };
  } else {
    pose = camera([1.05, -0.2, 0.95], [1.4, 0.4, -1.55], 0.65);
    state.balloonEcho = true;
    state.balloonRadius = 1.65;
    state.surface.lighting = {
      lights: [
        light([1, 1.3, -1.6], [1, -0.15, 0.2], 0.17, [0.18, 0.58, 1], 40),
        light([1.35, 0.65, 0.4], [-0.3, 0.1, -1.2], 0.22, [1, 0.34, 0.1], 10),
      ],
      ambient: [0.03, 0.07, 0.1],
      specular: 0.22,
      roughness: 0.42,
    };
  }
  return { ...toSnapshot(state), camera: pose };
}
