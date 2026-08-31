import type { Vec3, Vec4 } from "./types";

/**
 * Dependency-free CPU authority for a mirrored lattice's finite presentation
 * domain. The repeated set is unbounded, so the ordinary single-ball Surface
 * gate cannot supply its ray interval. Instead every ray intersects BOTH:
 *
 * - an explicit origin-centred 3D presentation sphere; and
 * - the unrepeated attractor-y slab `|q.y| <= R`.
 *
 * The sphere radius is supplied by the caller. This module deliberately owns
 * no default and no `8R`/`10R` ratio: those values remain provisional until
 * the renderer gate measures them. The content radius `R` is the estimator's
 * certified full visible/march radius. In 4D, `q = invRotor*(p,w0)`, so the
 * slab remains a linear interval at every supported rotor/slice pose.
 *
 * The same interval functions serve primary, preview, capture and shadow
 * rays. AO/normal taps use the contains predicates: a tap outside either
 * carrier is open space, so the artificial presentation boundary never
 * becomes geometry. Live shading, fog, capture scheduling and ground-plane
 * integration remain renderer responsibilities; this module supplies their
 * common exact domain arithmetic and terminal ordering only.
 */

export interface LatticePresentation {
  /** Certified origin-centred content radius. */
  contentRadius: number;
  /** Explicit finite 3D observation sphere; no default is owned here. */
  outerRadius: number;
}

export interface LatticeRayInterval {
  /** First in-domain ray parameter, clamped to zero for an inside camera. */
  tEnter: number;
  /** Last in-domain ray parameter. */
  tFar: number;
}

/** Shader dialects supported by {@link latticePresentationCarrierSource}. */
export type LatticeCarrierShaderLanguage = "glsl" | "wgsl";

/**
 * Emit the presentation carrier shared by the GLSL and WGSL Surface paths.
 * The carrier is only a ray-domain restriction: its boundary is never a
 * distance-estimator term. Normal and AO probes call the emitted contains
 * helper, where a point outside the carrier is open space.
 *
 * Both dimensions intersect the same world-3D outer sphere. The 3D arm uses
 * attractor y directly; the 4D arm receives the inverse rotor's y row and
 * evaluates it at `(ro, w0)` / `(rd, 0)`. Direction need not be unit, and an
 * inside camera starts at `t = 0`, exactly as the CPU authority above does.
 * The caller owns both radii and every fog curve; this source owns no default,
 * window ratio or fade constant.
 */
export function latticePresentationCarrierSource(
  dimension: 3 | 4,
  language: LatticeCarrierShaderLanguage,
): string {
  const wgsl = language === "wgsl";
  const float = wgsl ? "f32" : "float";
  const vec3 = wgsl ? "vec3f" : "vec3";
  const vec4 = wgsl ? "vec4f" : "vec4";
  const immutable = (name: string, value: string): string =>
    wgsl ? `let ${name} = ${value};` : `${float} ${name} = ${value};`;
  const mutable = (name: string, value: string): string =>
    wgsl ? `var ${name} = ${value};` : `${float} ${name} = ${value};`;
  const signature = (
    name: string,
    parameters: readonly (readonly [string, string])[],
    result: string,
  ): string => {
    if (wgsl) {
      return `fn ${name}(${parameters
        .map(([parameter, type]) => `${parameter}: ${type}`)
        .join(", ")}) -> ${result}`;
    }
    return `${result} ${name}(${parameters
      .map(([parameter, type]) => `${type} ${parameter}`)
      .join(", ")})`;
  };
  const intervalParameters: readonly (readonly [string, string])[] =
    dimension === 4
      ? [
          ["ro", vec3],
          ["rd", vec3],
          ["w0", float],
          ["inverseRotorY", vec4],
          ["contentRadius", float],
          ["outerRadius", float],
        ]
      : [
          ["ro", vec3],
          ["rd", vec3],
          ["contentRadius", float],
          ["outerRadius", float],
        ];
  const containsParameters: readonly (readonly [string, string])[] =
    dimension === 4
      ? [
          ["p", vec3],
          ["w0", float],
          ["inverseRotorY", vec4],
          ["contentRadius", float],
          ["outerRadius", float],
        ]
      : [
          ["p", vec3],
          ["contentRadius", float],
          ["outerRadius", float],
        ];
  const slabOrigin =
    dimension === 4 ? `dot(inverseRotorY, ${vec4}(ro, w0))` : "ro.y";
  const slabDirection =
    dimension === 4 ? `dot(inverseRotorY, ${vec4}(rd, 0.0))` : "rd.y";
  const containsSlab =
    dimension === 4 ? `dot(inverseRotorY, ${vec4}(p, w0))` : "p.y";
  const intervalStruct = wgsl
    ? `struct LatticeCarrierInterval {
  ok: bool,
  tEnter: ${float},
  tFar: ${float},
}`
    : `struct LatticeCarrierInterval {
  bool ok;
  ${float} tEnter;
  ${float} tFar;
};`;

  return `${intervalStruct}

${signature("latticePresentationInterval", intervalParameters, "LatticeCarrierInterval")} {
  ${immutable("slabOrigin", slabOrigin)}
  ${immutable("slabDirection", slabDirection)}
  ${immutable("a", "dot(rd, rd)")}
  ${immutable("b", "dot(ro, rd)")}
  ${immutable("c", "dot(ro, ro) - outerRadius * outerRadius")}
  ${immutable("discriminant", "b * b - a * c")}
  if (discriminant < 0.0) {
    return LatticeCarrierInterval(false, 0.0, 0.0);
  }
  ${immutable("root", "sqrt(max(0.0, discriminant))")}
  ${mutable("tEnter", "(-b - root) / a")}
  ${mutable("tFar", "(-b + root) / a")}
  if (slabDirection == 0.0) {
    if (abs(slabOrigin) > contentRadius) {
      return LatticeCarrierInterval(false, 0.0, 0.0);
    }
  } else {
    ${immutable("slabA", "(-contentRadius - slabOrigin) / slabDirection")}
    ${immutable("slabB", "(contentRadius - slabOrigin) / slabDirection")}
    tEnter = max(tEnter, min(slabA, slabB));
    tFar = min(tFar, max(slabA, slabB));
  }
  tEnter = max(tEnter, 0.0);
  return LatticeCarrierInterval(tFar >= tEnter, tEnter, tFar);
}

${signature("latticePresentationContains", containsParameters, "bool")} {
  ${immutable("slabCoordinate", containsSlab)}
  return dot(p, p) <= outerRadius * outerRadius && abs(slabCoordinate) <= contentRadius;
}

${signature(
  "latticePresentationFogCoordinate",
  [
    ["t", float],
    ["interval", "LatticeCarrierInterval"],
    ["contentRadius", float],
  ],
  float,
)} {
  return max(0.0, t - interval.tEnter) / contentRadius;
}
`;
}

function validatedPresentation(
  presentation: LatticePresentation,
): LatticePresentation {
  const { contentRadius, outerRadius } = presentation;
  if (!Number.isFinite(contentRadius) || contentRadius <= 0) {
    throw new RangeError(
      "lattice presentation contentRadius must be finite and > 0",
    );
  }
  if (!Number.isFinite(outerRadius) || outerRadius < contentRadius) {
    throw new RangeError(
      "lattice presentation outerRadius must be finite and >= contentRadius",
    );
  }
  return presentation;
}

/** Intersect a 3D ray with a sphere and one arbitrary linear slab coordinate
 * `|slabOrigin + t*slabDirection| <= slabHalf`. Direction need not be unit;
 * `t` remains in the caller's parameterization. */
export function intersectSphereAndSlab(
  ro: Vec3,
  rd: Vec3,
  sphereRadius: number,
  slabOrigin: number,
  slabDirection: number,
  slabHalf: number,
): LatticeRayInterval | null {
  const a = rd[0] * rd[0] + rd[1] * rd[1] + rd[2] * rd[2];
  if (!Number.isFinite(a) || a <= 0) {
    throw new RangeError("lattice ray direction must be finite and non-zero");
  }
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c =
    ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - sphereRadius * sphereRadius;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(Math.max(0, disc));
  let tEnter = (-b - root) / a;
  let tFar = (-b + root) / a;

  if (slabDirection === 0) {
    if (Math.abs(slabOrigin) > slabHalf) return null;
  } else {
    const aSlab = (-slabHalf - slabOrigin) / slabDirection;
    const bSlab = (slabHalf - slabOrigin) / slabDirection;
    tEnter = Math.max(tEnter, Math.min(aSlab, bSlab));
    tFar = Math.min(tFar, Math.max(aSlab, bSlab));
  }

  tEnter = Math.max(tEnter, 0);
  return tFar >= tEnter ? { tEnter, tFar } : null;
}

/** 3D x/z lattice: y is already the unrepeated attractor-frame axis. */
export function intersectLatticePresentation3(
  ro: Vec3,
  rd: Vec3,
  presentation: LatticePresentation,
): LatticeRayInterval | null {
  const { contentRadius, outerRadius } = validatedPresentation(presentation);
  return intersectSphereAndSlab(
    ro,
    rd,
    outerRadius,
    ro[1],
    rd[1],
    contentRadius,
  );
}

/** Row-major `m*v`, restricted to the y row. */
function matrix4Y(m: readonly number[], v: Vec4): number {
  return m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3];
}

/** Genuine 4D x/z/w lattice. The view ray is lifted with w=w0 and inverse-
 * rotated before its attractor-y slab is intersected. The world-space
 * presentation sphere remains the same 3D carrier seen by the camera. */
export function intersectLatticePresentation4(
  ro: Vec3,
  rd: Vec3,
  w0: number,
  inverseRotor: readonly number[],
  presentation: LatticePresentation,
): LatticeRayInterval | null {
  if (inverseRotor.length !== 16) {
    throw new RangeError("lattice inverseRotor must have 16 entries");
  }
  if (!Number.isFinite(w0)) {
    throw new RangeError("lattice slice w0 must be finite");
  }
  const { contentRadius, outerRadius } = validatedPresentation(presentation);
  const slabOrigin = matrix4Y(inverseRotor, [ro[0], ro[1], ro[2], w0]);
  const slabDirection = matrix4Y(inverseRotor, [rd[0], rd[1], rd[2], 0]);
  return intersectSphereAndSlab(
    ro,
    rd,
    outerRadius,
    slabOrigin,
    slabDirection,
    contentRadius,
  );
}

/** Is a 3D normal/AO sample inside both presentation carriers? */
export function latticePresentationContains3(
  p: Vec3,
  presentation: LatticePresentation,
): boolean {
  const { contentRadius, outerRadius } = validatedPresentation(presentation);
  return (
    p[0] * p[0] + p[1] * p[1] + p[2] * p[2] <= outerRadius * outerRadius &&
    Math.abs(p[1]) <= contentRadius
  );
}

/** 4D rotor/slice twin of {@link latticePresentationContains3}. */
export function latticePresentationContains4(
  p: Vec3,
  w0: number,
  inverseRotor: readonly number[],
  presentation: LatticePresentation,
): boolean {
  if (inverseRotor.length !== 16) {
    throw new RangeError("lattice inverseRotor must have 16 entries");
  }
  if (!Number.isFinite(w0)) {
    throw new RangeError("lattice slice w0 must be finite");
  }
  const { contentRadius, outerRadius } = validatedPresentation(presentation);
  return (
    p[0] * p[0] + p[1] * p[1] + p[2] * p[2] <= outerRadius * outerRadius &&
    Math.abs(matrix4Y(inverseRotor, [p[0], p[1], p[2], w0])) <= contentRadius
  );
}

/** Clamp a primary interval for a finite shadow distance. A null result means
 * the light lies before carrier entry; after `tFar`, the ray is fully lit. */
export function clampLatticeRayInterval(
  interval: LatticeRayInterval | null,
  maxDistance: number,
): LatticeRayInterval | null {
  if (!interval) return null;
  if (!Number.isFinite(maxDistance) || maxDistance < 0) {
    throw new RangeError("lattice ray maxDistance must be finite and >= 0");
  }
  const tFar = Math.min(interval.tFar, maxDistance);
  return tFar >= interval.tEnter ? { tEnter: interval.tEnter, tFar } : null;
}

/** Fog coordinate shared by live and capture paths: distance since carrier
 * entry, normalized by certified R. This owns no fog curve or window ratio. */
export function latticeFogCoordinate(
  t: number,
  interval: LatticeRayInterval,
  contentRadius: number,
): number {
  if (!Number.isFinite(contentRadius) || contentRadius <= 0) {
    throw new RangeError("lattice fog contentRadius must be finite and > 0");
  }
  return Math.max(0, t - interval.tEnter) / contentRadius;
}

/** Conservative camera-fit carrier around the canonical 3D x/z cell and its
 * unrepeated y extent. */
export function latticeCameraCarrierRadius3(h: number, radius: number): number {
  return Math.hypot(h, h, radius);
}

/** 4D x/z/w twin, before taking the live slice. */
export function latticeCameraCarrierRadius4(h: number, radius: number): number {
  return Math.hypot(h, h, h, radius);
}

export interface LatticeMarchOptions {
  ro: Vec3;
  rd: Vec3;
  interval: LatticeRayInterval;
  /** The same cutoff-aware scalar wrapper used by primary/shadow/AO paths. */
  estimate: (p: Vec3, cutoff: number) => number;
  /** Acceptance epsilon at a ray parameter (pixel-footprint + hit floor). */
  epsilon: (t: number) => number;
  stepScale: number;
  maxSteps: number;
}

export interface LatticeMarchResult {
  status: "hit" | "miss" | "exhausted" | "stalled";
  t: number;
  steps: number;
  point: Vec3;
}

/** Reference scalar marcher over an already intersected lattice interval.
 * It owns no budgets or epsilon constants: callers supply the production
 * route's existing values. `stalled` exposes non-finite/non-progressing
 * positive estimates; false-zero seams still satisfy the ordinary hit test
 * and therefore belong to the independent membership/seam oracle tests. */
export function marchLatticeInterval(
  options: LatticeMarchOptions,
): LatticeMarchResult {
  const { ro, rd, interval, estimate, epsilon, stepScale, maxSteps } = options;
  if (!Number.isFinite(stepScale) || stepScale <= 0) {
    throw new RangeError("lattice march stepScale must be finite and > 0");
  }
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new RangeError("lattice march maxSteps must be a positive integer");
  }
  let t = interval.tEnter;
  let point: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
  for (let steps = 0; steps < maxSteps; steps++) {
    if (t > interval.tFar) {
      return { status: "miss", t, steps, point };
    }
    const eps = epsilon(t);
    if (!Number.isFinite(eps) || eps <= 0) {
      throw new RangeError("lattice march epsilon must be finite and > 0");
    }
    point = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const distance = estimate(point, eps);
    if (!Number.isFinite(distance)) {
      return { status: "stalled", t, steps: steps + 1, point };
    }
    if (distance < eps) {
      return { status: "hit", t, steps: steps + 1, point };
    }
    const next = t + distance * stepScale;
    if (!(next > t)) {
      return { status: "stalled", t, steps: steps + 1, point };
    }
    t = next;
  }
  point = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
  return {
    status: t > interval.tFar ? "miss" : "exhausted",
    t,
    steps: maxSteps,
    point,
  };
}

export interface LatticeTerminal {
  kind: "content" | "ground";
  t: number;
}

/** The ground plane is independent world-space geometry: choose its hit only
 * by ordinary nearest-positive-ray ordering, never fold or carrier-clip it. */
export function chooseLatticeTerminal(
  contentT: number | null,
  groundT: number | null,
): LatticeTerminal | null {
  const content = contentT !== null && contentT >= 0 ? contentT : null;
  const ground = groundT !== null && groundT >= 0 ? groundT : null;
  if (content === null && ground === null) return null;
  if (content === null) return { kind: "ground", t: ground! };
  if (ground === null || content <= ground) {
    return { kind: "content", t: content };
  }
  return { kind: "ground", t: ground };
}
