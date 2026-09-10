/**
 * CPU reference for finite disk lights. Geometry, including a rotor-posed 4D
 * slice, arrives as ONE displayed-space DE. This does not upgrade a
 * heuristic DE to a certificate.
 *
 * Light intensity is total emitted flux. Uniform disk-area sampling cancels
 * its area PDF against radiance = flux / (PI * area), so larger emitters and
 * additional samples do not inject energy. One sampled point supplies the
 * light direction, normalized Phong highlight and visibility. The emitter
 * itself is not camera-visible geometry. Ambient surface fill is authored
 * irradiance. Prefix low-discrepancy emitter samples use full-image pixel
 * seeds, so capture bands reproduce whole-frame output exactly. Sampling is
 * an approximation; no denoiser or production GPU exists here.
 *
 * THE BOUNDED HOMOGENEOUS MEDIUM THIS REFERENCE ALSO CARRIED IS GONE. It
 * was single scattering with scalar extinction and an RGB scattering albedo,
 * and it was correct; it was removed because it could not be rendered — 95%
 * of a full-pane cathedral's GPU time, and no judgeable frame in ten
 * minutes. What it would take to bring one back is recorded in
 * docs/cinematic-surface-lighting.md, not here.
 */
import {
  type DistanceEstimator,
  type PreviewLinearHit,
  type PreviewRay,
  type Vec3,
} from "./de-preview.ts";

export interface CinematicDiskLight {
  position: Vec3;
  /** Outward emitting normal; one-sided disk, normalized on construction. */
  normal: Vec3;
  radius: number;
  /** Linear RGB. */
  color: Vec3;
  /** Total flux, independent of disk size and sample count. */
  intensity: number;
}

export interface CinematicMaterial {
  albedo?: Vec3 | ((hit: PreviewLinearHit) => Vec3);
  /** Linear ambient irradiance (already divided by PI). */
  ambient?: Vec3;
  /** Diffuse/specular mixture in [0,1]. */
  specular?: number;
  roughness?: number;
}

export interface LightVisibilityOptions {
  /** Fixed displayed-world tolerance, independent of image/sample size. */
  epsilon: number;
  maxSteps: number;
  /** Same damping as the primary DE; no minimum stride can skip a blocker. */
  stepScale: number;
}

export type LightVisibilityStatus =
  "visible" | "occluded" | "exhausted" | "invalid";

export interface LightVisibility {
  status: LightVisibilityStatus;
  steps: number;
  evaluations: number;
}

export interface VisibilityStats {
  rays: number;
  evaluations: number;
  steps: number;
  visible: number;
  occluded: number;
  exhausted: number;
  invalid: number;
}

export interface CinematicLightingStats {
  surfaceSamples: number;
  surfaceVisibility: VisibilityStats;
}

export interface CinematicLightingOptions {
  de: DistanceEstimator;
  stepScale: number;
  /** The proof's small rig: up to two authored emitters. */
  lights: readonly CinematicDiskLight[];
  material?: CinematicMaterial;
  surfaceSamples?: number;
  visibility?: { epsilon?: number; maxSteps?: number };
  seed?: number;
}

const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addScaled = (p: Vec3, d: Vec3, t: number): Vec3 => [
  p[0] + d[0] * t,
  p[1] + d[1] * t,
  p[2] + d[2] * t,
];
const normalized = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vectorFinite = (v: Vec3): boolean => v.every(Number.isFinite);
const colorValid = (v: Vec3): boolean =>
  vectorFinite(v) && v.every((x) => x >= 0);

/** Finite segment visibility, shared by surface and medium. Only a cleared
 * segment is lit. Exhaustion/nonfinite estimates refuse; they never leak
 * light. The caller lifts a surface origin; a medium origin is unmodified.
 * Tolerance makes near-geometry queries dark, never artificially clear. */
export function traceLightSegment(
  de: DistanceEstimator,
  from: Vec3,
  to: Vec3,
  options: LightVisibilityOptions,
): LightVisibility {
  const { epsilon, maxSteps, stepScale } = options;
  const delta = sub(to, from);
  const length = Math.hypot(...delta);
  let steps = 0;
  let evaluations = 0;
  const result = (status: LightVisibilityStatus): LightVisibility => ({
    status,
    steps,
    evaluations,
  });
  if (
    !Number.isFinite(length) ||
    !(epsilon > 0 && Number.isFinite(epsilon)) ||
    !(stepScale > 0 && stepScale <= 1) ||
    !Number.isInteger(maxSteps) ||
    maxSteps < 1
  ) {
    return result("invalid");
  }
  if (length === 0) return result("visible");
  const direction: Vec3 = [
    delta[0] / length,
    delta[1] / length,
    delta[2] / length,
  ];
  let t = 0;
  while (steps < maxSteps) {
    const d = de(addScaled(from, direction, t));
    evaluations++;
    if (!Number.isFinite(d)) return result("invalid");
    const stride = d * stepScale;
    // Test finite-segment clearance before proximity: a surface beyond the
    // emitter cannot occlude it, even when it is within the hit tolerance.
    if (stride >= length - t) return result("visible");
    if (d <= epsilon) return result("occluded");
    if (!(t + stride > t)) return result("invalid");
    t += stride;
    steps++;
  }
  return result("exhausted");
}

function hash(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function radicalInverse(index: number, base: number): number {
  let value = 0;
  let scale = 1 / base;
  for (let n = index; n > 0; n = Math.floor(n / base)) {
    value += (n % base) * scale;
    scale /= base;
  }
  return value;
}

function sample01(index: number, seed: number, base: number): number {
  return (radicalInverse(index + 1, base) + hash(seed) / 0x1_0000_0000) % 1;
}

interface PreparedLight extends CinematicDiskLight {
  tangent: Vec3;
  bitangent: Vec3;
}

function sampleDisk(light: PreparedLight, index: number, seed: number): Vec3 {
  const radius = light.radius * Math.sqrt(sample01(index, seed, 2));
  const angle = Math.PI * 2 * sample01(index, seed ^ 0x63d83595, 3);
  const x = radius * Math.cos(angle);
  const y = radius * Math.sin(angle);
  return [
    light.position[0] + light.tangent[0] * x + light.bitangent[0] * y,
    light.position[1] + light.tangent[1] * x + light.bitangent[1] * y,
    light.position[2] + light.tangent[2] * x + light.bitangent[2] * y,
  ];
}

function visibilityStats(): VisibilityStats {
  return {
    rays: 0,
    evaluations: 0,
    steps: 0,
    visible: 0,
    occluded: 0,
    exhausted: 0,
    invalid: 0,
  };
}

function count(value: number, name: string, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer in [1, ${max}]`);
  }
  return value;
}

/** Spread the two hooks into a PreviewScene with fog/shadow/AO off. Stats
 * accumulate across calls/regions; create a new rig for a fresh measurement. */
export function createCinematicLighting(options: CinematicLightingOptions): {
  shadeLinear: (hit: PreviewLinearHit) => Vec3;
  rayLinear: (ray: PreviewRay) => Vec3;
  stats: CinematicLightingStats;
} {
  const surfaceSamples = count(
    options.surfaceSamples ?? 4,
    "surfaceSamples",
    512,
  );
  const visibility: LightVisibilityOptions = {
    epsilon: options.visibility?.epsilon ?? 0.0002,
    maxSteps: count(options.visibility?.maxSteps ?? 96, "shadow steps", 4096),
    stepScale: options.stepScale,
  };
  if (
    !(visibility.epsilon > 0 && Number.isFinite(visibility.epsilon)) ||
    !(options.stepScale > 0 && options.stepScale <= 1) ||
    options.lights.length > 2
  ) {
    throw new Error("Invalid visibility tolerance, damping, or light count");
  }
  const lights: PreparedLight[] = options.lights.map((light) => {
    if (
      !vectorFinite(light.position) ||
      !vectorFinite(light.normal) ||
      !(Math.hypot(...light.normal) > 0) ||
      !(light.radius > 0 && Number.isFinite(light.radius)) ||
      !(light.intensity >= 0 && Number.isFinite(light.intensity)) ||
      !colorValid(light.color)
    ) {
      throw new Error("Invalid finite disk light");
    }
    const normal = normalized(light.normal);
    const tangent = normalized(
      cross(normal, Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]),
    );
    return { ...light, normal, tangent, bitangent: cross(normal, tangent) };
  });
  const material = options.material ?? {};
  const albedo = material.albedo ?? [0.62, 0.57, 0.49];
  const ambient = material.ambient ?? [0.025, 0.03, 0.045];
  const specular = material.specular ?? 0.18;
  const roughness = material.roughness ?? 0.32;
  if (
    !(specular >= 0 && specular <= 1) ||
    !(roughness > 0 && roughness <= 1) ||
    !colorValid(ambient) ||
    (typeof albedo !== "function" && !colorValid(albedo))
  ) {
    throw new Error("Invalid cinematic material");
  }
  const exponent = 2 / (roughness * roughness) - 2;
  const seed = options.seed ?? 0;
  const stats: CinematicLightingStats = {
    surfaceSamples: 0,
    surfaceVisibility: visibilityStats(),
  };
  const pixelSeed = (pixel: { px: number; py: number }): number =>
    hash(
      seed ^ Math.imul(pixel.px, 0x9e3779b1) ^ Math.imul(pixel.py, 0x85ebca6b),
    );
  const visible = (from: Vec3, to: Vec3, counter: VisibilityStats): boolean => {
    const result = traceLightSegment(options.de, from, to, visibility);
    counter.rays++;
    counter.evaluations += result.evaluations;
    counter.steps += result.steps;
    counter[result.status]++;
    return result.status === "visible";
  };
  const shadeLinear = (hit: PreviewLinearHit): Vec3 => {
    const base = typeof albedo === "function" ? albedo(hit) : albedo;
    const color: Vec3 = [
      base[0] * ambient[0],
      base[1] * ambient[1],
      base[2] * ambient[2],
    ];
    // Fixed world bias, independent of the primary pixel tolerance.
    const origin = addScaled(hit.p, hit.n, visibility.epsilon * 4);
    const salt = pixelSeed(hit);
    for (let l = 0; l < lights.length; l++) {
      const light = lights[l];
      if (light.intensity === 0) continue;
      for (let sample = 0; sample < surfaceSamples; sample++) {
        stats.surfaceSamples++;
        const source = sampleDisk(light, sample, salt ^ hash(l + 1));
        const delta = sub(source, hit.p);
        const distance2 = dot(delta, delta);
        if (!(distance2 > 0)) continue;
        const wi = normalized(delta);
        const cosine = Math.max(0, dot(hit.n, wi));
        const emitterCosine = Math.max(0, -dot(light.normal, wi));
        if (cosine === 0 || emitterCosine === 0) continue;
        if (!visible(origin, source, stats.surfaceVisibility)) continue;
        const reflected = sub(addScaled([0, 0, 0], hit.n, 2 * cosine), wi);
        const highlight =
          (specular *
            (exponent + 2) *
            Math.pow(Math.max(0, -dot(reflected, hit.rd)), exponent)) /
          (2 * Math.PI);
        const weight =
          (light.intensity * emitterCosine * cosine) /
          (Math.PI * distance2 * surfaceSamples);
        for (let channel = 0; channel < 3; channel++) {
          color[channel] +=
            light.color[channel] *
            weight *
            ((base[channel] * (1 - specular)) / Math.PI + highlight);
        }
      }
    }
    return color;
  };

  // Nothing lights the air between the camera and its terminal, so an
  // unshaded ray is its own linear value. The hook is kept so the two
  // PreviewScene spread sites do not have to know that.
  const rayLinear = (ray: PreviewRay): Vec3 => ray.linear;

  return { shadeLinear, rayLinear, stats };
}
