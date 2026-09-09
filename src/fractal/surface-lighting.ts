/** Authored displayed-space disk lights and bounded single scattering.
 * Colors are linear; intensity is total emitted flux, independent of disk
 * radius or sample count. A posed 4D slice uses this same 3D vocabulary.
 * Absent lighting selects the legacy shader rather than a resolved rig. */
import type { Vec3 } from "./types";

export interface SurfaceDiskLight {
  position: Vec3;
  normal: Vec3;
  radius: number;
  color: Vec3;
  intensity: number;
}

export interface SurfaceLightingMedium {
  center: Vec3;
  radius: number;
  /** Scalar extinction per displayed-world unit. */
  density: number;
  /** RGB scattering albedo, each component in [0,1]. */
  tint: Vec3;
  /** Positive HG directionality scatters forward. */
  anisotropy: number;
}

export interface SurfaceLighting {
  lights: SurfaceDiskLight[];
  ambient: Vec3;
  /** Defaults for classic finish slots; authored finishes retain their lobe. */
  specular: number;
  roughness: number;
  medium?: SurfaceLightingMedium;
}

export const SURFACE_LIGHTING_MAX_LIGHTS = 2;
export const SURFACE_LIGHTING_MAX_SURFACE_SAMPLES = 8;
export const SURFACE_LIGHTING_MAX_MEDIUM_SAMPLES = 32;
export const SURFACE_LIGHTING_MAX_SHADOW_STEPS = 256;
export const SURFACE_LIGHTING_LANE_COUNT = 12;
export const SURFACE_LIGHTING_RUNTIME_LANE = 10;
export const SURFACE_LIGHTING_PHASE_LANE = 11;

export const DEFAULT_SURFACE_LIGHTING: SurfaceLighting = {
  lights: [
    {
      position: [-2, 3, 2],
      normal: [2, -3, -2],
      radius: 0.25,
      color: [1, 0.56, 0.22],
      intensity: 30,
    },
    {
      position: [2, 1, -2],
      normal: [-2, -1, 2],
      radius: 0.35,
      color: [0.16, 0.46, 1],
      intensity: 18,
    },
  ],
  ambient: [0.025, 0.03, 0.045],
  specular: 0.18,
  roughness: 0.32,
};

const finite = (x: number, fallback: number): number =>
  Number.isFinite(x) ? x : fallback;
const bounded = (x: number, lo: number, hi: number, fallback: number): number =>
  Math.min(hi, Math.max(lo, finite(x, fallback)));
const vector = (v: Vec3, fallback: Vec3, lo: number, hi: number): Vec3 =>
  v.map((x, i) => bounded(x, lo, hi, fallback[i])) as Vec3;

/** Clone authored values without resolving: persistence retains finite input. */
export function cloneSurfaceLighting(value: SurfaceLighting): SurfaceLighting {
  return {
    ...value,
    ambient: [...value.ambient],
    lights: value.lights.map((light) => ({
      ...light,
      position: [...light.position],
      normal: [...light.normal],
      color: [...light.color],
    })),
    ...(value.medium
      ? {
          medium: {
            ...value.medium,
            center: [...value.medium.center],
            tint: [...value.medium.tint],
          },
        }
      : {}),
  };
}

/** The renderer alone owns domains; scene/link codecs preserve finite values.
 * Finite bounds also keep squared distances and HDR products inside f32. */
export function resolveSurfaceLighting(
  value: SurfaceLighting,
): SurfaceLighting {
  const lights = value.lights
    .slice(0, SURFACE_LIGHTING_MAX_LIGHTS)
    .map((light) => {
      const raw = vector(light.normal, [0, -1, 0], -1e6, 1e6);
      const length = Math.hypot(...raw);
      const normal: Vec3 =
        length > 1e-10
          ? [raw[0] / length, raw[1] / length, raw[2] / length]
          : [0, -1, 0];
      return {
        position: vector(light.position, [0, 0, 0], -1e6, 1e6),
        normal,
        radius: bounded(light.radius, 1e-5, 1e6, 0.1),
        color: vector(light.color, [1, 1, 1], 0, 1e4),
        intensity: bounded(light.intensity, 0, 1e8, 0),
      };
    });
  const medium = value.medium;
  return {
    lights,
    ambient: vector(value.ambient, [0.025, 0.03, 0.045], 0, 1e4),
    specular: bounded(value.specular, 0, 1, 0.18),
    roughness: bounded(value.roughness, 0.03, 1, 0.32),
    ...(medium
      ? {
          medium: {
            center: vector(medium.center, [0, 0, 0], -1e6, 1e6),
            radius: bounded(medium.radius, 1e-5, 1e6, 1),
            density: bounded(medium.density, 0, 1e6, 0),
            tint: vector(medium.tint, [1, 1, 1], 0, 1),
            anisotropy: bounded(medium.anisotropy, -0.95, 0.95, 0),
          },
        }
      : {}),
  };
}

/** One progressive sample's bounded work, independent of authored look. */
export interface SurfaceLightingRuntime {
  surfaceSamples: number;
  mediumSamples: number;
  shadowSteps: number;
  sampleIndex: number;
  epsilon: number;
  cellStart?: number;
  cellCount?: number;
  /** 0 initializes a terminal; 1 adds bounded medium cells to its HDR value. */
  phase?: 0 | 1;
  /** -1 visits both emitters; compute may schedule each light separately. */
  lightIndex?: number;
}

export function surfaceLightingRuntime(
  lighting: SurfaceLighting,
  options: {
    interaction: boolean;
    dimension: 3 | 4;
    boundingRadius: number;
    sampleIndex?: number;
  },
): SurfaceLightingRuntime {
  return {
    surfaceSamples: 1,
    mediumSamples:
      lighting.medium && lighting.medium.density > 0
        ? options.interaction
          ? 8
          : 32
        : 0,
    shadowSteps: options.dimension === 4 ? 256 : 128,
    sampleIndex: options.sampleIndex ?? 0,
    epsilon: Math.max(1e-7, options.boundingRadius * 2e-4),
    cellStart: 0,
    cellCount: 1,
    phase: 0,
    lightIndex: -1,
  };
}

/** Frozen vec4 lane order shared by both GLSL tracers and ShadeParams' tail.
 * 0..5: two(position/radius, normal/flux, color/unused); 6 ambient/specular;
 * 7 medium center/radius; 8 scattering albedo/extinction; 9 g/roughness/count/
 * world epsilon; 10 sample budgets/index; 11 bounded dispatch phase. */
export function surfaceLightingLanes(
  authored: SurfaceLighting,
  runtime: SurfaceLightingRuntime = surfaceLightingRuntime(authored, {
    interaction: false,
    dimension: 3,
    boundingRadius: 1,
  }),
): Float32Array {
  const lighting = resolveSurfaceLighting(authored);
  const lanes = new Float32Array(SURFACE_LIGHTING_LANE_COUNT * 4);
  lighting.lights.forEach((light, i) => {
    lanes.set([...light.position, light.radius], i * 12);
    lanes.set([...light.normal, light.intensity], i * 12 + 4);
    lanes.set([...light.color, 0], i * 12 + 8);
  });
  lanes.set([...lighting.ambient, lighting.specular], 24);
  const medium = lighting.medium;
  if (medium) {
    lanes.set([...medium.center, medium.radius], 28);
    lanes.set([...medium.tint, medium.density], 32);
  }
  lanes.set(
    [
      medium?.anisotropy ?? 0,
      lighting.roughness,
      lighting.lights.length,
      bounded(runtime.epsilon, 1e-8, 1e4, 0.0002),
    ],
    36,
  );
  lanes.set(
    [
      Math.floor(bounded(runtime.surfaceSamples, 1, 8, 1)),
      Math.floor(
        bounded(
          runtime.mediumSamples,
          0,
          SURFACE_LIGHTING_MAX_MEDIUM_SAMPLES,
          32,
        ),
      ),
      Math.floor(bounded(runtime.shadowSteps, 1, 256, 128)),
      Math.floor(bounded(runtime.sampleIndex, 0, 0xffffff, 0)),
    ],
    40,
  );
  lanes.set(
    [
      runtime.cellStart ?? 0,
      runtime.cellCount ?? 1,
      runtime.phase ?? 0,
      runtime.lightIndex ?? -1,
    ],
    44,
  );
  return lanes;
}

export function surfaceMediumTransmittance(
  density: number,
  distance: number,
): number {
  return density === 0 || distance === 0 ? 1 : Math.exp(-density * distance);
}

/** Photon propagation cosine; forward is +1 (both-outward conventions flip it). */
export function surfaceHenyeyGreenstein(cosine: number, g: number): number {
  const magnitude = Math.abs(g);
  const aligned = (g < 0 ? -1 : 1) * Math.max(-1, Math.min(1, cosine));
  const denominator = (1 - magnitude) ** 2 + 2 * magnitude * (1 - aligned);
  return (
    ((1 - magnitude) * (1 + magnitude)) /
    (4 * Math.PI * Math.pow(denominator, 1.5))
  );
}

/** The shader RNG's exact uint32 hash, shared by CPU agreement scenarios. */
export function surfaceLightingHash(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
