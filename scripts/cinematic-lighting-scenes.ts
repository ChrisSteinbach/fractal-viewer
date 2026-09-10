/**
 * Saved reference compositions for direct lights. (They were composed around
 * a participating medium as well; it was removed on its measured cost, so
 * these rigs light bare geometry now — see cinematic-lighting.ts.)
 *
 * These are ordinary application geometries, queried through their public
 * estimators. The 4D adapter applies the inverse of the saved WORLD rotor to
 * every displayed-space query; primary, normal and surface visibility all
 * receive this same closure. No source-space shortcut exists.
 *
 * Coordinates, palettes and rigs are explicit so the owner sheet can be
 * reproduced without a live editor or a remembered camera gesture.
 */
import {
  BALLOON_FAR_CAP_RHO,
  buildBalloon,
  estimateBalloonDistance,
} from "../src/fractal/balloon-de";
import { systemIsFlat } from "../src/fractal/affine4";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import {
  buildEscapeDE4,
  estimateEscapeDistance4,
} from "../src/fractal/escape-de-4d";
import { ESCAPE_STEP_SCALE } from "../src/fractal/escape-de";
import { hybridChainShells, mengerSponge } from "../src/fractal/presets";
import {
  identityRotorPair,
  rotateInPlane,
  rotorMatrix,
} from "../src/app/rotor4";
import type { RotorPair } from "../src/app/rotor4";
import type { Transform, Vec4 } from "../src/fractal/types";
import type { CinematicDiskLight } from "./cinematic-lighting";
import type { DistanceEstimator, PreviewScene, Vec3 } from "./de-preview";

export interface CinematicSceneMetadata {
  id: string;
  title: string;
  description: string;
  dimension: 3 | 4;
  geometry: {
    preset: string;
    estimator: string;
    transforms: Transform[];
    nonFlat: boolean;
    stepScale: number;
    boundingCenter: Vec3;
    boundingRadius: number;
    visibleRadius: number;
    balloon?: {
      radiusMultiplier: number;
      center: Vec3;
      radius: number;
      rho: number;
      rawRadius: number;
      farCapRawRadii: number;
    };
    pose4?: { rotor: RotorPair; matrix: number[]; w: number; halfW: 0 };
  };
  camera: { eye: Vec3; target: Vec3; zoom: number };
  palette: { name: string; baseSrgb: Vec3; baseLinear: Vec3 };
  background: { top: Vec3; bottom: Vec3 };
  lights: CinematicDiskLight[];
  material: { ambient: Vec3; specular: number; roughness: number };
}

export interface CinematicScene {
  metadata: CinematicSceneMetadata;
  de: DistanceEstimator;
  /** The legacy Balloon shadow path deliberately queries only the original
   * attractor; the new local lights query the actual union for both terms. */
  legacyShadowDe: DistanceEstimator;
  preview: PreviewScene;
  shellAt?: (p: Vec3) => boolean;
}

export const CINEMATIC_BACKGROUND = {
  top: [0.011, 0.017, 0.028] as Vec3,
  bottom: [0.003, 0.004, 0.008] as Vec3,
};

const linear = (c: Vec3): Vec3 => c.map((v) => Math.pow(v, 2.2)) as Vec3;
const normal = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return v.map((x) => x / length) as Vec3;
};

function light(
  position: Vec3,
  target: Vec3,
  radius: number,
  color: Vec3,
  intensity: number,
): CinematicDiskLight {
  return {
    position,
    normal: normal(target.map((v, i) => v - position[i]) as Vec3),
    radius,
    color,
    intensity,
  };
}

function finishScene(
  metadata: CinematicSceneMetadata,
  de: DistanceEstimator,
  legacyShadowDe = de,
  shellAt?: (p: Vec3) => boolean,
): CinematicScene {
  const { geometry, camera } = metadata;
  const balloon = geometry.balloon;
  const far = balloon
    ? Math.hypot(...camera.eye.map((v, i) => v - balloon.center[i])) +
      balloon.farCapRawRadii * balloon.rawRadius
    : undefined;
  return {
    metadata,
    de,
    legacyShadowDe,
    shellAt,
    preview: {
      de,
      boundingRadius: geometry.boundingRadius,
      boundingCenter: geometry.boundingCenter,
      eye: camera.eye,
      target: camera.target,
      zoom: camera.zoom,
      stepScale: geometry.stepScale,
      background: metadata.background,
      marchInterval: far === undefined ? undefined : () => [0, far],
      maxSteps: 700,
      ao: false,
      shadow: false,
      fog: false,
      collect: true,
    },
  };
}

function cathedral(transforms = mengerSponge()): CinematicScene {
  const built = buildSurfaceDE(transforms);
  const base: Vec3 = [0.76, 0.69, 0.56];
  return finishScene(
    {
      id: "cathedral",
      title: "Menger cathedral",
      description:
        "A low camera inside the central nave looks through recursive stone openings. Warm key crosses the nave; a cool rim separates the far walls.",
      dimension: 3,
      geometry: {
        preset: "menger",
        estimator: "estimateDistanceRefined",
        transforms,
        nonFlat: false,
        stepScale: built.stepScale,
        boundingCenter: built.boundCenter,
        boundingRadius: built.boundingRadius,
        visibleRadius: built.visibleBoundingRadius,
      },
      camera: {
        eye: [0.065, -0.17, 0.72],
        target: [-0.035, 0.13, -0.5],
        zoom: 0.6,
      },
      palette: {
        name: "warm limestone",
        baseSrgb: base,
        baseLinear: linear(base),
      },
      background: CINEMATIC_BACKGROUND,
      lights: [
        light([0, 0.2, -1.05], [0.08, -0.1, 0.7], 0.07, [1, 0.56, 0.22], 7),
        light([-0.95, 0, 0], [0, 0, 0], 0.14, [0.16, 0.46, 1], 4),
      ],
      material: {
        ambient: [0.065, 0.055, 0.05],
        specular: 0.12,
        roughness: 0.52,
      },
    },
    (p) => estimateDistanceRefined(built, p),
  );
}

function cavern(): CinematicScene {
  const transforms = mengerSponge();
  const built = buildSurfaceDE(transforms);
  const radiusMultiplier = 1.65;
  const balloon = buildBalloon(built, radiusMultiplier);
  const union = (p: Vec3) =>
    estimateBalloonDistance(estimateDistanceRefined, built, balloon, p);
  const base: Vec3 = [0.61, 0.68, 0.7];
  return finishScene(
    {
      id: "balloon-cavern",
      title: "Balloon cavern",
      description:
        "The camera stands between a real Menger attractor and its inverted-union echo. The inverted walls and the original fractal both occlude the local lights.",
      dimension: 3,
      geometry: {
        preset: "menger",
        estimator: "estimateBalloonDistance(estimateDistanceRefined)",
        transforms,
        nonFlat: false,
        stepScale: built.stepScale,
        boundingCenter: built.boundCenter,
        boundingRadius: built.boundingRadius,
        visibleRadius: built.visibleBoundingRadius,
        balloon: {
          radiusMultiplier,
          center: balloon.center,
          radius: balloon.R,
          rho: balloon.rho,
          rawRadius: balloon.R / radiusMultiplier,
          farCapRawRadii: BALLOON_FAR_CAP_RHO,
        },
      },
      camera: {
        eye: [1.05, -0.2, 0.95],
        target: [1.4, 0.4, -1.55],
        zoom: 0.65,
      },
      palette: {
        name: "blue limestone",
        baseSrgb: base,
        baseLinear: linear(base),
      },
      background: CINEMATIC_BACKGROUND,
      lights: [
        light([1.0, 1.3, -1.6], [1, -0.15, 0.2], 0.17, [0.18, 0.58, 1], 40),
        light([1.35, 0.65, 0.4], [-0.3, 0.1, -1.2], 0.22, [1, 0.34, 0.1], 10),
      ],
      material: {
        ambient: [0.03, 0.07, 0.1],
        specular: 0.22,
        roughness: 0.42,
      },
    },
    (p) => union(p).d,
    (p) => estimateDistanceRefined(built, p),
    (p) => union(p).shell,
  );
}

function slice4(): CinematicScene {
  const transforms = hybridChainShells();
  const built = buildEscapeDE4(transforms);
  let rotor = rotateInPlane(identityRotorPair(), "xw", 0.38);
  rotor = rotateInPlane(rotor, "zw", -0.2);
  const matrix = rotorMatrix(rotor);
  const w = 0.18;
  const posed: DistanceEstimator = (p) => {
    const v: Vec4 = [p[0], p[1], p[2], w];
    const q: Vec4 = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      q[i] =
        matrix[i] * v[0] +
        matrix[4 + i] * v[1] +
        matrix[8 + i] * v[2] +
        matrix[12 + i] * v[3];
    }
    return estimateEscapeDistance4(built, q);
  };
  const base: Vec3 = [0.68, 0.7, 0.73];
  return finishScene(
    {
      id: "posed-4d-slice",
      title: "Rotor-posed 4D shells",
      description:
        "A genuinely non-flat 4D escape chain, cut at w = 0.18 after xw and zw view rotations. Every primary and shadow query applies the same inverse rotor and slice.",
      dimension: 4,
      geometry: {
        preset: "hybridChainShells",
        estimator: "estimateEscapeDistance4(rotorInverse * [p, w])",
        transforms,
        nonFlat: !systemIsFlat(transforms),
        stepScale: ESCAPE_STEP_SCALE,
        boundingCenter: [0, 0, 0],
        boundingRadius: built.boundingRadius,
        visibleRadius: built.boundingRadius,
        pose4: { rotor, matrix, w, halfW: 0 },
      },
      camera: { eye: [4.45, 2.7, 5.1], target: [0, 0, 0], zoom: 0.44 },
      palette: {
        name: "silver shale",
        baseSrgb: base,
        baseLinear: linear(base),
      },
      background: CINEMATIC_BACKGROUND,
      lights: [
        light([3, 4, 4.5], [0, 0, 0], 0.4, [1, 0.68, 0.42], 160),
        light([-5.5, 2, -2], [0, 0, 0], 0.45, [0.1, 0.44, 1], 480),
      ],
      material: {
        ambient: [0.1, 0.1, 0.11],
        specular: 0.22,
        roughness: 0.35,
      },
    },
    posed,
  );
}

/** Builders are lazy: a selected row does not pay the other family's probe. */
export const CINEMATIC_SCENE_BUILDERS = { cathedral, cavern, slice4 };

export function createCinematicScenes(): CinematicScene[] {
  return Object.values(CINEMATIC_SCENE_BUILDERS).map((build) => build());
}

/** One actual affine cell closes most of the rear portal. The cell is itself
 * recursive, so "closed" still retains its smaller real openings. Both
 * scenarios are ordinary application IFS documents within the 24-map cap. */
function portalClosed(): CinematicScene {
  const transforms = mengerSponge();
  transforms.push({
    id: 20,
    position: [0, 0, -0.5],
    rotation: [0, 0, 0],
    scale: [1 / 3, 1 / 3, 1 / 3],
  });
  const scene = cathedral(transforms);
  scene.metadata.id = "portal-closed";
  scene.metadata.title = "Closed portal";
  scene.metadata.geometry.preset = "authored Menger with rear affine cell";
  scene.metadata.description =
    "The Menger's rear portal contains one extra recursive affine cell at [0, 0, -0.5]. Its remaining smaller openings are real geometry. Camera, palette and lights match the open-portal case.";
  return scene;
}

function portalOpen(): CinematicScene {
  const scene = cathedral();
  scene.metadata.id = "portal-open";
  scene.metadata.title = "Open portal";
  scene.metadata.description =
    "Removing the rear affine cell restores the Menger's main portal. Camera, palette and lights match the closed-portal case, so geometry alone admits the warm light.";
  return scene;
}

function portalMoved(): CinematicScene {
  const scene = portalOpen();
  scene.metadata.id = "portal-moved-light";
  scene.metadata.title = "Moved key";
  scene.metadata.description =
    "The open-portal geometry stays fixed. Only the warm key moves sideways behind the adjacent recursive wall, from x = 0 to x = 0.5, and re-aims at the same displayed-space target.";
  scene.metadata.lights[0] = light(
    [0.5, 0.2, -1.05],
    [0.08, -0.1, 0.7],
    0.07,
    [1, 0.56, 0.22],
    7,
  );
  return scene;
}

/** Opt-in support sheet; these never expand the three owner comparison rows. */
export const CINEMATIC_INTERVENTION_BUILDERS = {
  portalClosed,
  portalOpen,
  portalMoved,
};
