import * as THREE from "three";
import type { SurfaceDE } from "../fractal/surface-de";
import type { Vec3 } from "../fractal/types";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";
import { lightDirection } from "./voxel-material";

/**
 * The surface render's GPU sphere-tracer (epic fr-7jlk): a full-screen-quad
 * ShaderMaterial that marches camera rays against an analytic distance
 * estimator for the IFS attractor — greedy inverse-map descent with
 * sibling-certificate bounds, precomputed by `buildSurfaceDE`
 * (`src/fractal/surface-de.ts`) and packed into fixed-size uniform arrays
 * here. Hits are shaded in the solid raymarcher's vocabulary — DE-gradient
 * normals, Lambert diffuse + Blinn-Phong specular, per-map base color —
 * minus the shadow ray and ambient occlusion (a follow-up bead adds them).
 * Rays that miss paint the same dark gradient backdrop as the explorer, so
 * the mode reads as the same scene, surfaced.
 *
 * The GLSL `surfaceDE` mirrors `estimateDistance` in `surface-de.ts` line
 * for line — the tested CPU oracle, the same discipline as `flame.ts` <->
 * `flame-gpu.ts`. Kept in its own module so `scene.ts` stays the wiring
 * layer: everything GLSL lives here, everything camera/frame lives there
 * (the scene sets `uCamPos`, `uInvProjView`, and `uPixelEps` per frame).
 * GLSL3 because the DE needs dynamic loop bounds and non-constant
 * uniform-array indexing (ES 1.00 fragment shaders allow neither); Three
 * injects the built-in vertex attributes and matrix uniforms for GLSL3
 * ShaderMaterials automatically.
 */

/** Screen-space gradient the tracer paints on a miss — the same authored
 * sRGB stops as `scene.ts`'s `darkBackground` (both read `DARK_BACKDROP`), so
 * entering the mode doesn't visibly swap backdrops. Parsed with the pure
 * helper, not `new THREE.Color(hex)`: this module evaluates before scene.ts
 * disables ColorManagement, and the string constructor would linearize. */
const BG_TOP = new THREE.Vector3(...hexToRgb01(DARK_BACKDROP.top));
const BG_BOTTOM = new THREE.Vector3(...hexToRgb01(DARK_BACKDROP.bottom));

/** Compile-time size of the per-map uniform arrays: at ~6 vec4-equivalents
 * per slot (mat3 = 3, plus vec3 + float + vec3), 24 maps stays comfortably
 * under WebGL2's guaranteed 224 fragment uniform vectors. The app gates
 * systems whose symmetry expansion exceeds it before entering the mode, so
 * {@link setSurfaceSystem} treats overflow as a bug, not a degrade. */
export const SURFACE_MAX_MAPS = 24;

const SURFACE_VERTEX = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SURFACE_FRAGMENT = /* glsl */ `
  precision highp float;

  const int MAX_MAPS = ${SURFACE_MAX_MAPS};
  /** Sphere-trace step budget per ray. */
  const int MARCH_STEPS = 96;

  /** Inverse linear part per symmetry-expanded map (uMapCount live slots;
   * the rest are stale/identity and never read). */
  uniform mat3 uInvM[MAX_MAPS];
  /** Inverse translation per map: -inv(M_i) . t_i. */
  uniform vec3 uInvT[MAX_MAPS];
  /** Smallest singular value of each FORWARD map — the certified
   * contraction factor multiplied into the running scale product. */
  uniform float uSigmaMin[MAX_MAPS];
  /** sRGB 0..1 base color per map slot (keyed to base maps caller-side). */
  uniform vec3 uMapColor[MAX_MAPS];
  uniform int uMapCount;
  /** Bounding-sphere radius R of the RAW attractor (pre final transform). */
  uniform float uBoundingRadius;
  /** Descent stops once the greedy image escapes this (2R): deeper
   * certificates cannot improve the min. */
  uniform float uEscapeRadius;
  /** Descent depth cap, sized CPU-side so the slowest contraction chain
   * resolves features below resolution. */
  uniform int uMaxDepth;
  /** March step multiplier in (0, 1]: 1 for conformal systems, smaller as
   * anisotropy grows (SurfaceEligibility.stepScale). */
  uniform float uStepScale;
  /** Radius bounding the VISIBLE set F(attractor) — the ray/sphere gate. */
  uniform float uVisibleRadius;
  /** Pre-inverted final-transform lens; identity / zero / 1 when absent. */
  uniform mat3 uFinalInvM;
  uniform vec3 uFinalInvT;
  uniform float uFinalSigmaMin;
  /** Unit vector pointing from surfaces TOWARD the light. */
  uniform vec3 uLightDir;
  uniform float uAmbient;
  uniform vec3 uCamPos;
  uniform mat4 uInvProjView;
  uniform vec3 uBgTop;
  uniform vec3 uBgBottom;
  /** Angular pixel footprint (scene-set per frame): the cone-style hit test
   * accepts once the DE drops below uPixelEps * t, so surface resolution
   * scales with distance. */
  uniform float uPixelEps;

  in vec2 vUv;
  out vec4 outColor;

  /** Per-pixel dither for the march start so grazing rays don't band. */
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  /**
   * Mirrors estimateDistance in src/fractal/surface-de.ts (the tested CPU
   * oracle) — any change there must land here too, and vice versa. Greedy
   * inverse-map descent: each level folds in the min over the escaped
   * NON-descended siblings' certified bounds sigma_min_j * (|image_j| - R)
   * — so surfaces reachable through a shallower branch are never overshot —
   * while the descended branch keeps refining down to its terminal
   * last-value bound; see that module's doc for the validity argument.
   * 1e30 stands in for Infinity: with sigma products <= 1 and real
   * distances O(1..10) it can never be confused for a real bound.
   * firstChoice (the depth-0 greedy pick) is a tracer-side extra for
   * per-map coloring, not part of the oracle's contract.
   */
  float surfaceDE(vec3 p, out int firstChoice) {
    vec3 q = uFinalInvM * p + uFinalInvT;
    float sphereBound = length(q) - uBoundingRadius;
    float best = 1e30;
    float scale = 1.0;
    float lastR = length(q);
    firstChoice = 0;
    for (int depth = 0; depth < uMaxDepth; depth++) {
      float greedyR = 1e30;
      vec3 g = vec3(0.0);
      float gSigma = 1.0;
      // Two smallest certificates this level + which map owns the smallest,
      // so the descended (greedy) branch's own certificate can be dropped
      // in favor of its deeper refinement without a second scan.
      int greedyIndex = -1;
      float cert1 = 1e30;
      float cert2 = 1e30;
      int cert1Index = -1;
      for (int j = 0; j < uMapCount; j++) {
        vec3 img = uInvM[j] * q + uInvT[j];
        float r = length(img);
        if (r < greedyR) {
          greedyR = r;
          g = img;
          gSigma = uSigmaMin[j];
          greedyIndex = j;
        }
        if (r > uBoundingRadius) {
          float bound = uSigmaMin[j] * (r - uBoundingRadius);
          if (bound < cert1) {
            cert2 = cert1;
            cert1 = bound;
            cert1Index = j;
          } else if (bound < cert2) {
            cert2 = bound;
          }
        }
      }
      float siblingCert = (cert1Index == greedyIndex) ? cert2 : cert1;
      best = min(best, scale * siblingCert);
      if (depth == 0) {
        firstChoice = greedyIndex;
      }
      q = g;
      lastR = greedyR;
      scale *= gSigma;
      if (greedyR > uEscapeRadius) {
        break;
      }
    }
    // Terminal bound of the descended branch (the KIFS last-value formula):
    // non-positive when the point tracked the attractor to the depth cap.
    float d = min(best, scale * (lastR - uBoundingRadius));
    d = max(d, sphereBound);
    return d * uFinalSigmaMin;
  }

  void main() {
    vec3 background = mix(uBgBottom, uBgTop, clamp(vUv.y, 0.0, 1.0));

    // Reconstruct the camera ray by unprojecting this pixel on the near and
    // far clip planes.
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 nearP = uInvProjView * vec4(ndc, -1.0, 1.0);
    vec4 farP = uInvProjView * vec4(ndc, 1.0, 1.0);
    vec3 rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
    vec3 ro = uCamPos;

    // Entry/exit against the origin-centered sphere bounding the VISIBLE
    // set (small margin so silhouettes right at the bound aren't clipped):
    // solve |ro + t rd|^2 = radius^2. No intersection, or an exit behind
    // the camera, is a miss.
    float radius = uVisibleRadius * 1.02;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) {
      outColor = vec4(background, 1.0);
      return;
    }
    float sq = sqrt(disc);
    float tFar = -b + sq;
    if (tFar <= 0.0) {
      outColor = vec4(background, 1.0);
      return;
    }
    float t = max(-b - sq, 0.0);

    // Tiny dithered start: just breaks banding on grazing rays.
    t += hash(gl_FragCoord.xy) * uPixelEps * max(t, 1.0);

    // --- sphere trace -------------------------------------------------------
    // Cone-style hit test: accept once the bound drops below the pixel's
    // angular footprint at that depth (uPixelEps * t — resolution scales
    // with distance), floored so the test can't degenerate at t ~ 0.
    // choice keeps the LAST evaluation's depth-0 greedy map: the hit
    // point's first-chosen inverse map, which keys its color.
    bool hit = false;
    int choice = 0;
    for (int i = 0; i < MARCH_STEPS; i++) {
      if (t > tFar) {
        break;
      }
      float d = surfaceDE(ro + rd * t, choice);
      if (d < max(uPixelEps * t, uBoundingRadius * 1.0e-5)) {
        hit = true;
        break;
      }
      t += d * uStepScale;
    }
    if (!hit) {
      outColor = vec4(background, 1.0);
      return;
    }
    vec3 pos = ro + rd * t;

    // --- shade --------------------------------------------------------------
    // Normal from the DE gradient (tetrahedron offsets: four samples instead
    // of six), probed at the hit's own resolution scale. A hit with a
    // vanishing gradient still needs SOME normal; face the camera rather
    // than dividing by ~zero.
    float h = max(uPixelEps * t, uBoundingRadius * 2.0e-4);
    vec2 e = vec2(1.0, -1.0) * 0.5773;
    int dummy;
    vec3 grad = e.xyy * surfaceDE(pos + e.xyy * h, dummy) +
      e.yyx * surfaceDE(pos + e.yyx * h, dummy) +
      e.yxy * surfaceDE(pos + e.yxy * h, dummy) +
      e.xxx * surfaceDE(pos + e.xxx * h, dummy);
    vec3 n = dot(grad, grad) > 1e-12 ? normalize(grad) : -rd;

    vec3 base = uMapColor[clamp(choice, 0, uMapCount - 1)];

    float diffuse = max(dot(n, uLightDir), 0.0);
    vec3 halfVec = normalize(uLightDir - rd);
    float specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;

    // No shadow ray or ambient occlusion in v1 (a follow-up bead adds
    // them), so the light term is the plain Lambert mix.
    float lit = uAmbient + (1.0 - uAmbient) * diffuse;
    // Light in linear space (fr-8id, as in voxel-material.ts): base is
    // sRGB-authored (color.ts), so decode with gamma 2.2, apply the
    // light/specular product there, and re-encode for the pass-through
    // canvas (ColorManagement is off). A fully lit, specular-free surface
    // round-trips to base verbatim — the authored-color invariant the rest
    // of the app keeps — while midtones and shadows are no longer crushed
    // ~2x by scaling the gamma encoding itself.
    vec3 linBase = pow(base, vec3(2.2));
    vec3 col = pow(linBase * lit + vec3(specular), vec3(1.0 / 2.2));

    outColor = vec4(col, 1.0);
  }
`;

/** Build the surface material with placeholder uniforms (zero maps, unit
 * sphere): complete and compilable before the first system arrives, painting
 * only the backdrop until {@link setSurfaceSystem} runs. The per-map arrays
 * are allocated ONCE at the compile-time cap and mutated in place — Three
 * binds uniform values by object identity, so replacing them would orphan
 * the binding. */
export function createSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uInvM: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Matrix3(),
        ),
      },
      uInvT: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector3(),
        ),
      },
      uSigmaMin: { value: new Array<number>(SURFACE_MAX_MAPS).fill(1) },
      uMapColor: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector3(),
        ),
      },
      uMapCount: { value: 0 },
      uBoundingRadius: { value: 1 },
      uEscapeRadius: { value: 2 },
      uMaxDepth: { value: 0 },
      uStepScale: { value: 1 },
      uVisibleRadius: { value: 1 },
      uFinalInvM: { value: new THREE.Matrix3() },
      uFinalInvT: { value: new THREE.Vector3() },
      uFinalSigmaMin: { value: 1 },
      uLightDir: { value: lightDirection(135, 50) },
      uAmbient: { value: 0.25 },
      uCamPos: { value: new THREE.Vector3() },
      uInvProjView: { value: new THREE.Matrix4() },
      uBgTop: { value: BG_TOP.clone() },
      uBgBottom: { value: BG_BOTTOM.clone() },
      // Placeholder; the scene overwrites it per frame with the camera's
      // true angular pixel size.
      uPixelEps: { value: 0.002 },
    },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
}

/** Pack a {@link SurfaceDE} + per-slot colors into the material's uniforms.
 * `colors[j]` is the sRGB 0..1 color for `de.maps[j]` (already keyed by
 * `baseIndex` on the caller's side). Slots past the live count keep stale
 * values by design — `uMapCount` guards every shader loop. Throws RangeError
 * if `de.maps.length > SURFACE_MAX_MAPS`: callers gate eligibility first, so
 * reaching it is a bug. */
export function setSurfaceSystem(
  material: THREE.ShaderMaterial,
  de: SurfaceDE,
  colors: Vec3[],
): void {
  if (de.maps.length > SURFACE_MAX_MAPS) {
    throw new RangeError(
      `surface DE has ${de.maps.length} maps, but the material carries at most ${SURFACE_MAX_MAPS}`,
    );
  }
  const u = material.uniforms;
  const invM = u.uInvM.value as THREE.Matrix3[];
  const invT = u.uInvT.value as THREE.Vector3[];
  const sigmaMin = u.uSigmaMin.value as number[];
  const mapColor = u.uMapColor.value as THREE.Vector3[];
  de.maps.forEach((map, j) => {
    const m = map.invM;
    // SurfaceDEMap.invM is ROW-major; Matrix3.set takes row-major arguments
    // and stores column-major internally — exactly the layout the GLSL
    // `mat3 * vec3` product expects, so this is a straight pass-through.
    invM[j].set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    invT[j].set(...map.invT);
    sigmaMin[j] = map.sigmaMin;
    mapColor[j].set(...colors[j]);
  });
  u.uMapCount.value = de.maps.length;
  u.uBoundingRadius.value = de.boundingRadius;
  u.uEscapeRadius.value = de.escapeRadius;
  u.uMaxDepth.value = de.maxDepth;
  u.uStepScale.value = de.stepScale;
  u.uVisibleRadius.value = de.visibleBoundingRadius;
  // The final lens must be RESET when absent — the previous system may have
  // had one, and identity / zero / 1 is the shader's "no lens" encoding.
  const finalM = u.uFinalInvM.value as THREE.Matrix3;
  const finalT = u.uFinalInvT.value as THREE.Vector3;
  if (de.final) {
    const f = de.final.invM;
    finalM.set(f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8]);
    finalT.set(...de.final.invT);
    u.uFinalSigmaMin.value = de.final.sigmaMin;
  } else {
    finalM.identity();
    finalT.set(0, 0, 0);
    u.uFinalSigmaMin.value = 1;
  }
}
