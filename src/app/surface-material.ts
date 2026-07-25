import * as THREE from "three";
import type { SurfaceDE } from "../fractal/surface-de";
import type { Vec3 } from "../fractal/types";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";
import { lightDirection } from "./voxel-material";

/**
 * The surface render's GPU sphere-tracer (epic fr-7jlk): a full-screen-quad
 * ShaderMaterial that marches camera rays against an analytic distance
 * estimator for the IFS attractor — width-2 beam inverse-map descent
 * (fr-v6yg) with REFINED sibling certificates (fr-1z6p: fr-beck's measured
 * ghost-eliminator ported down from the 4D tracer, closing the smooth
 * "balloon" membranes the plain certificates rendered across attractor
 * voids), precomputed by `buildSurfaceDE` (`src/fractal/surface-de.ts`)
 * and packed into fixed-size uniform arrays here. Hits are shaded in the
 * solid raymarcher's vocabulary — DE-gradient
 * normals, Lambert diffuse + Blinn-Phong specular, a soft penumbra shadow
 * ray toward the light, DE-probed ambient occlusion — with four base-color
 * sources (by-transform, orbit-trap palette, height ramp, radius ramp; the
 * ramps sample a 256x1 LUT built CPU-side by color.ts's ONE ramp
 * definition) and exponential depth fog toward the backdrop. Rays that miss
 * paint the same dark gradient backdrop as the explorer, so the mode reads
 * as the same scene, surfaced.
 *
 * The GLSL `surfaceDE` mirrors `estimateDistanceRefined` in `surface-de.ts`
 * line for line (the `refine === true` path of its shared descent body) —
 * the tested CPU oracle, the same discipline as `flame.ts` <->
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

/** Compile-time size of the per-map uniform arrays: at ~7 vec4-equivalents
 * per slot (mat3 = 3, plus vec3 + float + vec3 + float), 24 maps stays
 * comfortably under WebGL2's guaranteed 224 fragment uniform vectors. The
 * app gates systems whose symmetry expansion exceeds it before entering the
 * mode, so {@link setSurfaceSystem} treats overflow as a bug, not a
 * degrade. */
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
  /** Penumbra shadow-ray step budget per hit. */
  const int SHADOW_STEPS = 32;

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
  /** Per-slot palette coordinate in [0, 1] for the orbit trap
   * (CPU-precomputed from each slot's base-map index). */
  uniform float uTrapIndex[MAX_MAPS];
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
  /** Base-color source: 0 = by-transform (uMapColor), 1 = orbit-trap
   * palette, 2 = height ramp, 3 = radius ramp. Sources 1-3 sample
   * uColorLUT. */
  uniform int uColorSource;
  /** 256x1 RGBA ramp for sources 1-3, built CPU-side by color.ts's ONE
   * ramp definition and uploaded by the scene — no ramp math lands here. */
  uniform sampler2D uColorLUT;
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

  /** One extra Hutchinson level on a frozen escaped candidate's own inverse
   * image (the oracle's refinedCert): the certificate becomes
   * childScale * max(r - R, min_k sigmaMin_k * (|invMap_k(img)| - R)) —
   * never below the plain childScale * (r - R). fr-beck measured this
   * exact refinement eliminating every march ghost; fr-1z6p ports it here
   * from the 4D tracer, closing the balloon membranes the plain
   * certificates painted across attractor voids. */
  float refinedCert(vec3 img, float r, float childScale) {
    float inner = 1e30;
    for (int k = 0; k < uMapCount; k++) {
      vec3 kImg = uInvM[k] * img + uInvT[k];
      inner = min(inner, uSigmaMin[k] * (length(kImg) - uBoundingRadius));
    }
    return childScale * max(r - uBoundingRadius, inner);
  }

  /**
   * Both surfaceDE overloads mirror estimateDistanceRefined in
   * src/fractal/surface-de.ts (the tested CPU oracle) — any change there
   * must land in BOTH bodies here, and vice versa. Width-2 BEAM
   * inverse-map descent (fr-v6yg; the CPU oracle's beamWidth is always 2
   * in production builds, so the tracer hardcodes it): each level expands
   * both live chains through every map, keeps the two candidates with the
   * smallest selection key chainScale * (r - R) as the next chains, and
   * folds every OTHER escaped candidate's REFINED certificate (fr-1z6p:
   * refinedCert above) into the running min — so surfaces reachable
   * through a shallower or second-nearest branch are never overshot, and
   * barely-escaped siblings no longer freeze the near-zero plain bounds
   * that false-hit as balloons — while each kept chain keeps refining down
   * to its terminal last-value bound (folded PLAIN when it escapes past
   * uEscapeRadius or the depth cap ends the loop, exactly as the oracle
   * keeps them). Every refined fold site carries the oracle's laziness
   * guard: refinement can only RAISE a certificate, so a fold whose PLAIN
   * certificate already fails to beat the running min is skipped whole —
   * bit-exact, and it caps the inner sweeps at the folds that actually
   * advance the min. See the oracle module's doc for the validity
   * argument and the measured numbers. 1e30 stands in for Infinity
   * (slot-occupancy tests use < 1e29): with sigma products <= 1 and real
   * distances O(1..10) it can never be confused for a real bound. This
   * plain overload is the workhorse (march, normals, shadow, occlusion);
   * the out-param overload below adds hit-shading extras.
   */
  float surfaceDE(vec3 p) {
    vec3 q = uFinalInvM * p + uFinalInvT;
    float startR = length(q);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    // Chain slot A starts at the (lensed) query; slot B idles until beam
    // selection fills it. Each chain carries the contraction accumulated
    // INCLUDING its own map and the radius it was selected at.
    vec3 aQ = q;
    float aScale = 1.0;
    float aR = startR;
    bool aLive = true;
    vec3 bQ = vec3(0.0);
    float bScale = 1.0;
    float bR = 0.0;
    bool bLive = false;
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (!aLive && !bLive) {
        break;
      }
      // The two smallest-key candidates this level, key-ascending. The
      // sentinel r = 0 keeps empty slots out of every escaped-candidate
      // fold below.
      float c1Key = 1e30;
      vec3 c1Q = vec3(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
      float c2Key = 1e30;
      vec3 c2Q = vec3(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
      for (int c = 0; c < 2; c++) {
        bool isA = c == 0;
        if (isA ? !aLive : !bLive) {
          continue;
        }
        vec3 pQ = isA ? aQ : bQ;
        float pScale = isA ? aScale : bScale;
        for (int j = 0; j < uMapCount; j++) {
          vec3 img = uInvM[j] * pQ + uInvT[j];
          float r = length(img);
          float key = pScale * (r - uBoundingRadius);
          float childScale = pScale * uSigmaMin[j];
          float cert = childScale * (r - uBoundingRadius);
          if (key < c1Key) {
            // New best: the old best shifts to runner-up, whose previous
            // occupant folds its REFINED certificate (fr-1z6p: one extra
            // Hutchinson level closes the barely-escaped-sibling balloon)
            // — skipped whole when its plain certificate cannot beat the
            // running min anyway (the oracle's laziness guard, bit-exact).
            if (c2R > uBoundingRadius && c2Cert < best) {
              best = min(best, refinedCert(c2Q, c2R, c2Scale));
            }
            c2Key = c1Key;
            c2Q = c1Q;
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c1Key = key;
            c1Q = img;
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
          } else if (key < c2Key) {
            if (c2R > uBoundingRadius && c2Cert < best) {
              best = min(best, refinedCert(c2Q, c2R, c2Scale));
            }
            c2Key = key;
            c2Q = img;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          } else if (r > uBoundingRadius && cert < best) {
            best = min(best, refinedCert(img, r, childScale));
          }
        }
      }
      // Promote: the best candidate continues as chain A, the runner-up
      // as chain B; past the escape radius a candidate folds its terminal
      // and dies instead (deeper refinement cannot improve the min).
      aLive = false;
      bLive = false;
      if (c1Key < 1e29) {
        if (c1R > uEscapeRadius) {
          best = min(best, c1Cert);
        } else {
          aQ = c1Q;
          aScale = c1Scale;
          aR = c1R;
          aLive = true;
        }
      }
      if (c2Key < 1e29) {
        if (c2R > uEscapeRadius) {
          best = min(best, c2Cert);
        } else {
          bQ = c2Q;
          bScale = c2Scale;
          bR = c2R;
          bLive = true;
        }
      }
    }
    // Terminal bound of chains alive at the depth cap (the KIFS last-value
    // formula): non-positive when the chain tracked the attractor all the
    // way down.
    if (aLive) {
      best = min(best, aScale * (aR - uBoundingRadius));
    }
    if (bLive) {
      best = min(best, bScale * (bR - uBoundingRadius));
    }
    float d = max(best, sphereBound);
    return d * uFinalSigmaMin;
  }

  /**
   * Hit-shading variant: the SAME refined beam descent as the plain
   * overload — keep the two bodies in lockstep, both mirror
   * estimateDistanceRefined — plus two tracer-side extras that are NOT
   * part of the CPU oracle's distance contract (surface-de.ts mirrors
   * distance only). firstChoice is the depth-0 winning candidate's map,
   * keying by-transform color (identical to the old greedy pick: level 0
   * has one chain at scale 1, so the selection key ranks by radius
   * alone). trap is a flame-style structural blend of the winning
   * candidates' palette coordinates, accumulated TOP-DOWN with
   * geometrically decaying weight (level d weighs 2^-d, normalized at the
   * end): the depth-0 choice — WHICH top-level copy of the attractor the
   * hit sits in — carries half the final coordinate, matching flam3's
   * convention where the LAST-applied transform dominates a plotted
   * point's color (descent order is application order reversed, so
   * descent level 0 is the most significant digit). The previous blend
   * ran the recurrence deepest-first — address digits that vary
   * sub-pixel, which rendered as per-pixel palette noise with no
   * distinguishable color regions (fr-gt9i). It follows the per-level
   * best candidate and stops when every chain has escaped. Called ONCE
   * per hit; the march itself uses the plain overload.
   */
  float surfaceDE(vec3 p, out int firstChoice, out float trap) {
    vec3 q = uFinalInvM * p + uFinalInvT;
    float startR = length(q);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    vec3 aQ = q;
    float aScale = 1.0;
    float aR = startR;
    bool aLive = true;
    vec3 bQ = vec3(0.0);
    float bScale = 1.0;
    float bR = 0.0;
    bool bLive = false;
    firstChoice = 0;
    trap = 0.0;
    float trapAcc = 0.0;
    float trapNorm = 0.0;
    float trapW = 1.0;
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (!aLive && !bLive) {
        break;
      }
      float c1Key = 1e30;
      vec3 c1Q = vec3(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
      int c1Map = 0;
      float c2Key = 1e30;
      vec3 c2Q = vec3(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
      for (int c = 0; c < 2; c++) {
        bool isA = c == 0;
        if (isA ? !aLive : !bLive) {
          continue;
        }
        vec3 pQ = isA ? aQ : bQ;
        float pScale = isA ? aScale : bScale;
        for (int j = 0; j < uMapCount; j++) {
          vec3 img = uInvM[j] * pQ + uInvT[j];
          float r = length(img);
          float key = pScale * (r - uBoundingRadius);
          float childScale = pScale * uSigmaMin[j];
          float cert = childScale * (r - uBoundingRadius);
          if (key < c1Key) {
            if (c2R > uBoundingRadius && c2Cert < best) {
              best = min(best, refinedCert(c2Q, c2R, c2Scale));
            }
            c2Key = c1Key;
            c2Q = c1Q;
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c1Key = key;
            c1Q = img;
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
            c1Map = j;
          } else if (key < c2Key) {
            if (c2R > uBoundingRadius && c2Cert < best) {
              best = min(best, refinedCert(c2Q, c2R, c2Scale));
            }
            c2Key = key;
            c2Q = img;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          } else if (r > uBoundingRadius && cert < best) {
            best = min(best, refinedCert(img, r, childScale));
          }
        }
      }
      if (depth == 0) {
        firstChoice = c1Map;
      }
      trapAcc += trapW * uTrapIndex[c1Map];
      trapNorm += trapW;
      trapW *= 0.5;
      aLive = false;
      bLive = false;
      if (c1Key < 1e29) {
        if (c1R > uEscapeRadius) {
          best = min(best, c1Cert);
        } else {
          aQ = c1Q;
          aScale = c1Scale;
          aR = c1R;
          aLive = true;
        }
      }
      if (c2Key < 1e29) {
        if (c2R > uEscapeRadius) {
          best = min(best, c2Cert);
        } else {
          bQ = c2Q;
          bScale = c2Scale;
          bR = c2R;
          bLive = true;
        }
      }
    }
    if (aLive) {
      best = min(best, aScale * (aR - uBoundingRadius));
    }
    if (bLive) {
      best = min(best, bScale * (bR - uBoundingRadius));
    }
    // Normalize the top-down blend. Every call that can reach a hit runs
    // depth 0 (uMapCount >= 1, chains start live), so trapNorm >= 1; the
    // guard just keeps a zero-map placeholder call from dividing by zero.
    trap = trapNorm > 0.0 ? trapAcc / trapNorm : 0.0;
    float d = max(best, sphereBound);
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
    // Where the ray enters the bounding sphere — the depth-fog origin.
    float tEnter = t;

    // Tiny dithered start: just breaks banding on grazing rays.
    t += hash(gl_FragCoord.xy) * uPixelEps * max(t, 1.0);

    // --- sphere trace -------------------------------------------------------
    // Cone-style hit test: accept once the bound drops below the pixel's
    // angular footprint at that depth (uPixelEps * t — resolution scales
    // with distance), floored so the test can't degenerate at t ~ 0. The
    // march runs the plain DE overload; the hit's coloring extras are
    // fetched once below.
    bool hit = false;
    for (int i = 0; i < MARCH_STEPS; i++) {
      if (t > tFar) {
        break;
      }
      float d = surfaceDE(ro + rd * t);
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

    // One hit-info evaluation for the coloring extras: the hit point's
    // depth-0 greedy map + orbit-trap coordinate (the distance itself is
    // discarded — the march already accepted this point).
    int firstChoice;
    float trap;
    surfaceDE(pos, firstChoice, trap);

    // --- shade --------------------------------------------------------------
    // Normal from the DE gradient (tetrahedron offsets: four samples instead
    // of six), probed at the hit's own resolution scale. A hit with a
    // vanishing gradient still needs SOME normal; face the camera rather
    // than dividing by ~zero.
    float h = max(uPixelEps * t, uBoundingRadius * 2.0e-4);
    vec2 e = vec2(1.0, -1.0) * 0.5773;
    vec3 grad = e.xyy * surfaceDE(pos + e.xyy * h) +
      e.yyx * surfaceDE(pos + e.yyx * h) +
      e.yxy * surfaceDE(pos + e.yxy * h) +
      e.xxx * surfaceDE(pos + e.xxx * h);
    vec3 n = dot(grad, grad) > 1e-12 ? normalize(grad) : -rd;

    // Base color by source. Sources 1-3 sample the LUT built CPU-side by
    // color.ts's ONE ramp definition — no ramp math lands here; height and
    // radius normalize against the visible bounding sphere, the world-space
    // frame the tracer already lives in.
    vec3 base;
    if (uColorSource == 0) {
      base = uMapColor[clamp(firstChoice, 0, uMapCount - 1)];
    } else {
      float u = uColorSource == 1
        ? trap
        : uColorSource == 2
          ? clamp(pos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0)
          : clamp(length(pos) / uVisibleRadius, 0.0, 1.0);
      base = texture(uColorLUT, vec2(u, 0.5)).rgb;
    }

    // Soft shadow: classic DE penumbra toward the light — the shadow ray's
    // closest approach to a surface, sharpened by 8/ts, starting just off
    // the surface to dodge self-shadowing. Leaving the bounding sphere
    // means fully lit from there on, and near-black penumbras end early.
    float shadow = 1.0;
    float ts = h * 2.0;
    for (int i = 0; i < SHADOW_STEPS; i++) {
      vec3 sp = pos + n * h * 2.0 + uLightDir * ts;
      float d = surfaceDE(sp);
      shadow = min(shadow, 8.0 * d / ts);
      ts += clamp(d, uBoundingRadius * 2.0e-4, uVisibleRadius * 0.1);
      if (shadow < 0.02 || length(sp) > uVisibleRadius * 1.05) {
        break;
      }
    }
    shadow = clamp(shadow, 0.0, 1.0);

    // Ambient occlusion: five short DE probes along the normal, each
    // measuring how far the free space at height hh falls short of hh
    // (crevices leave less), geometrically down-weighted with depth.
    float occ = 0.0;
    float wgt = 1.0;
    float norm = 0.0;
    for (int i = 1; i <= 5; i++) {
      float hh = uBoundingRadius * 0.02 * float(i);
      occ += wgt * clamp((hh - surfaceDE(pos + n * hh)) / hh, 0.0, 1.0);
      norm += wgt;
      wgt *= 0.6;
    }
    float ao = clamp(1.0 - 0.85 * occ / norm, 0.0, 1.0);

    float diffuse = max(dot(n, uLightDir), 0.0);
    vec3 halfVec = normalize(uLightDir - rd);
    float specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;

    float lit = uAmbient * ao + (1.0 - uAmbient) * diffuse * shadow;
    // Light in linear space (fr-8id, as in voxel-material.ts): base is
    // sRGB-authored (color.ts), so decode with gamma 2.2, apply the
    // light/specular product there, and re-encode for the pass-through
    // canvas (ColorManagement is off). A fully lit, specular-free surface
    // round-trips to base verbatim — the authored-color invariant the rest
    // of the app keeps — while midtones and shadows are no longer crushed
    // ~2x by scaling the gamma encoding itself.
    vec3 linBase = pow(base, vec3(2.2));
    vec3 col = pow(linBase * lit + vec3(specular * shadow), vec3(1.0 / 2.2));

    // Depth fog toward the backdrop: squared-exponential in the distance
    // traveled inside the bounding sphere — ~0.38 haze at the far side (a
    // full 2R chord), a depth cue matching the explorer's fog feel
    // (constants tuned by eye).
    float fog =
      1.0 - exp(-0.12 * pow((t - tEnter) / max(uVisibleRadius, 1.0e-6), 2.0));
    col = mix(col, background, clamp(fog, 0.0, 1.0));

    outColor = vec4(col, 1.0);
  }
`;

/**
 * Preview-tier knobs (fr-5ne3): while the view is moving, the scene traces
 * into an offscreen target this fraction of the drawing buffer per side
 * (~11x fewer rays at 0.3) and upscales — deriving `uPixelEps` from the
 * SMALLER target's height, so the cone-style hit test coarsens to match the
 * preview pixels (fewer march steps) with no extra fudge factor.
 */
export const SURFACE_PREVIEW_SCALE = 0.3;

/**
 * Preview-tier descent-depth clamp on `uMaxDepth` (fr-5ne3). `buildSurfaceDE`
 * sizes the full depth so the SLOWEST contraction chain resolves features
 * below ~1e-4 — up to 48 levels, and it is exactly those slowly-contracting
 * systems whose per-level beam + certificate sweeps make interaction
 * unusable. Clamping the cap (a plain uniform write — the shader bodies and
 * the CPU oracle are untouched) leaves fast-contracting systems' 8-12 levels
 * alone and flattens only that tail. The artifact profile is safe by
 * construction: a chain still alive at the cap contributes the same valid
 * terminal lower bound, so fine detail renders slightly inflated/smoothed —
 * no balloon ghosts (those come from dropping certificate refinement, which
 * the preview deliberately keeps).
 */
export const SURFACE_PREVIEW_MAX_DEPTH = 12;

const BLIT_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uSrc;
  in vec2 vUv;
  out vec4 outColor;
  void main() {
    outColor = texture(uSrc, vUv);
  }
`;

/**
 * Verbatim upscale blit for the preview tier (fr-5ne3): stretches the
 * preview target over the canvas. Hand-rolled rather than MeshBasicMaterial
 * so no color-space chunk can ever transform the tracer's authored-sRGB
 * output (ColorManagement is off app-wide, and this module keeps all
 * surface GLSL in one place). `src` is the preview target's texture —
 * bound once here by object identity, which `WebGLRenderTarget.setSize`
 * preserves across reallocations.
 */
export function createSurfaceBlitMaterial(
  src: THREE.Texture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uSrc: { value: src } },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: BLIT_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
}

/** The sampler state every uploaded color LUT needs: linear filtering (ramp
 * lookups interpolate between the 256 stops) and edge clamping (u = 0 and
 * u = 1 must read the end stops, never wrap to the ramp's other end).
 * Mirrors configureVoxelTexture's pattern so scene.ts applies the exact
 * same state to every real LUT it uploads. */
export function configureSurfaceLUTTexture(texture: THREE.DataTexture): void {
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
}

/** Build the surface material with placeholder uniforms (zero maps, unit
 * sphere): complete and compilable before the first system arrives, painting
 * only the backdrop until {@link setSurfaceSystem} runs. The per-map arrays
 * are allocated ONCE at the compile-time cap and mutated in place — Three
 * binds uniform values by object identity, so replacing them would orphan
 * the binding. */
export function createSurfaceMaterial(): THREE.ShaderMaterial {
  // A 1x1 white placeholder LUT so the material is complete (and compiled)
  // before the scene uploads a real 256x1 ramp — the ramps themselves are
  // built CPU-side by color.ts's ONE ramp definition, never here.
  const placeholderLUT = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
  );
  configureSurfaceLUTTexture(placeholderLUT);
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
      uTrapIndex: { value: new Array<number>(SURFACE_MAX_MAPS).fill(0) },
      uMapCount: { value: 0 },
      uBoundingRadius: { value: 1 },
      uEscapeRadius: { value: 2 },
      uMaxDepth: { value: 0 },
      uStepScale: { value: 1 },
      uVisibleRadius: { value: 1 },
      uFinalInvM: { value: new THREE.Matrix3() },
      uFinalInvT: { value: new THREE.Vector3() },
      uFinalSigmaMin: { value: 1 },
      uColorSource: { value: 0 },
      uColorLUT: { value: placeholderLUT },
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

/** Pack a {@link SurfaceDE} + per-slot shading inputs into the material's
 * uniforms. `colors[j]` is the sRGB 0..1 color and `trapIndices[j]` the
 * orbit-trap palette coordinate in [0, 1] for `de.maps[j]` (both already
 * keyed by `baseIndex` on the caller's side, both `de.maps.length` long).
 * `trapIndices` is optional for callers that predate the color sources:
 * omitting it zero-fills the live slots — an explicit reset, like the final
 * lens, so a previous system's traps never leak. Slots past the live count
 * keep stale values by design — `uMapCount` guards every shader loop.
 * Throws RangeError if `de.maps.length > SURFACE_MAX_MAPS`: callers gate
 * eligibility first, so reaching it is a bug. */
export function setSurfaceSystem(
  material: THREE.ShaderMaterial,
  de: SurfaceDE,
  colors: Vec3[],
  trapIndices?: number[],
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
  const trapIndex = u.uTrapIndex.value as number[];
  de.maps.forEach((map, j) => {
    const m = map.invM;
    // SurfaceDEMap.invM is ROW-major; Matrix3.set takes row-major arguments
    // and stores column-major internally — exactly the layout the GLSL
    // `mat3 * vec3` product expects, so this is a straight pass-through.
    invM[j].set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    invT[j].set(...map.invT);
    sigmaMin[j] = map.sigmaMin;
    mapColor[j].set(...colors[j]);
    trapIndex[j] = trapIndices ? trapIndices[j] : 0;
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
