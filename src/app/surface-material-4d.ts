import * as THREE from "three";
import type { SurfaceDE4 } from "../fractal/surface-de-4d";
import type { Vec3 } from "../fractal/types";
import {
  configureSurfaceLUTTexture,
  SURFACE_FULL_AO_TAPS,
  SURFACE_FULL_HIT_FLOOR,
  SURFACE_FULL_MARCH_STEPS,
  SURFACE_FULL_SHADOW_STEPS,
} from "./surface-material";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";
import { lightDirection } from "./voxel-material";

/**
 * The 4D surface render's GPU sphere-tracer — the 4D twin of
 * `surface-material.ts` (fr-vxoj): a full-screen-quad ShaderMaterial that
 * marches camera rays against an analytic distance estimator for the
 * `w = w0` SLICE of a 4D IFS attractor — width-4 beam inverse-map descent
 * with REFINED sibling certificates, precomputed by `buildSurfaceDE4`
 * (`src/fractal/surface-de-4d.ts`) and packed into fixed-size uniform
 * arrays here. The refined certificate — one extra Hutchinson level applied
 * to every escaped, non-descended sibling before it freezes into the
 * running min — was the fr-beck spike's measured ghost-eliminator (0.0%
 * ghost-of-hits on every slice measured, down from a 4.7-84.6% range
 * unrefined); beam width 4 is hardcoded here exactly as in the 3D shader.
 * fr-jkpn's rank-3/4 validity slots ride along too — extra chains that
 * stay live only while their image is in-sphere.
 *
 * The rotor and w-slice arrive as VIEW uniforms rather than baked into the
 * packed maps: every query lifts `q = uInvRotor * vec4(p, uW0)` into the
 * attractor frame before the DE runs, which is valid because a rotation is
 * an isometry — distances, march steps, and gradients all survive the lift
 * unchanged.
 *
 * Hits are shaded in the same vocabulary as the 3D surface tracer and the
 * solid raymarcher — DE-gradient normals, Lambert diffuse + Blinn-Phong
 * specular, a soft penumbra shadow ray toward the light, DE-probed ambient
 * occlusion — with the same four base-color sources (by-transform,
 * orbit-trap palette, height ramp, radius ramp; the ramps sample a 256x1
 * LUT built CPU-side by color.ts's ONE ramp definition) and exponential
 * depth fog toward the backdrop. Rays that miss paint the same dark
 * gradient backdrop as the explorer, so the mode reads as the same scene,
 * surfaced.
 *
 * The GLSL `surfaceDE` mirrors `estimateDistance4Refined` in
 * `surface-de-4d.ts` line for line — the tested CPU oracle, the same
 * discipline `surface-material.ts` keeps with `surface-de.ts`. Kept in its
 * own module so `scene.ts` stays the wiring layer: everything GLSL lives
 * here, everything camera/frame/rotor lives there (the scene sets
 * `uCamPos`, `uInvProjView`, and `uPixelEps` per frame, plus the view
 * uniforms `uInvRotor`/`uW0` whenever the 4D view changes). GLSL3 for the
 * same reason as the 3D shader: the DE needs dynamic loop bounds and
 * non-constant uniform-array indexing.
 */

/** Screen-space gradient the tracer paints on a miss — the same authored
 * sRGB stops as `scene.ts`'s `darkBackground` (both read `DARK_BACKDROP`), so
 * entering the mode doesn't visibly swap backdrops. Parsed with the pure
 * helper, not `new THREE.Color(hex)`: this module evaluates before scene.ts
 * disables ColorManagement, and the string constructor would linearize. */
const BG_TOP = new THREE.Vector3(...hexToRgb01(DARK_BACKDROP.top));
const BG_BOTTOM = new THREE.Vector3(...hexToRgb01(DARK_BACKDROP.bottom));

/** Compile-time size of the per-map uniform arrays: ~8 vec4-equivalents per
 * slot (mat4 = 4, plus vec4 + float + vec3 + float), so 16 maps cost 128
 * vec4s for the map arrays alone; add the ~25 misc uniforms below (three
 * more mat4s among them: uFinalInvM, uInvRotor, uInvProjView) and the total
 * stays comfortably under WebGL2's guaranteed 224 fragment uniform
 * vectors. 24 slots — 3D's cap — would land around 217, too close to a
 * link failure on minimum-spec devices to risk. With no kaleidoscope
 * symmetry in 4D (see surface-de-4d.ts's module doc), 16 slots means 16
 * transforms, no expansion. The app gates systems whose map count exceeds
 * it before entering the mode, so {@link setSurfaceSystem4} treats
 * overflow as a bug, not a degrade. */
export const SURFACE4_MAX_MAPS = 16;

const SURFACE4_VERTEX = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SURFACE4_FRAGMENT = /* glsl */ `
  precision highp float;

  const int MAX_MAPS = ${SURFACE4_MAX_MAPS};
  /** Sphere-trace step budget per ray — per-tier uniform (fr-sjff), in
   * lockstep with the 3D tracer's. Tracer-side only, like the loop caps
   * below — the DE bodies stay oracle-mirrored. */
  uniform int uMarchSteps;
  /** Penumbra shadow-ray step budget per hit (per-tier). */
  uniform int uShadowSteps;
  /** Ambient-occlusion probe count along the normal (per-tier). */
  uniform int uAoTaps;
  /** Absolute floor of the cone hit test, as a fraction of the bounding
   * radius (per-tier). */
  uniform float uHitFloor;

  /** Inverse linear part per map (uMapCount live slots; the rest are
   * stale/identity and never read). No symmetry expansion in 4D (see
   * surface-de-4d.ts's module doc) — one slot per INPUT transform. */
  uniform mat4 uInvM[MAX_MAPS];
  /** Inverse translation per map: -inv(M_i) . t_i. */
  uniform vec4 uInvT[MAX_MAPS];
  /** Smallest singular value of each FORWARD map — the certified
   * contraction factor multiplied into the running scale product. */
  uniform float uSigmaMin[MAX_MAPS];
  /** sRGB 0..1 base color per map slot (keyed to base maps caller-side). */
  uniform vec3 uMapColor[MAX_MAPS];
  /** Per-slot palette coordinate in [0, 1] for the orbit trap
   * (CPU-precomputed from each slot's base-map index). */
  uniform float uTrapIndex[MAX_MAPS];
  uniform int uMapCount;
  /** Bounding-hypersphere radius R of the RAW attractor (pre final
   * transform), in 4D. */
  uniform float uBoundingRadius;
  /** Descent stops once the greedy image escapes this (2R): deeper
   * certificates cannot improve the min. */
  uniform float uEscapeRadius;
  /** Descent depth cap, sized CPU-side so the slowest contraction chain
   * resolves features below resolution. */
  uniform int uMaxDepth;
  /** March step multiplier in (0, 1]: 1 for conformal systems, smaller as
   * anisotropy grows (SurfaceEligibility4.stepScale). */
  uniform float uStepScale;
  /** 4D radius bounding the VISIBLE set F(attractor) — feeds the slice
   * ray/sphere gate in main() below. */
  uniform float uVisibleRadius;
  /** Pre-inverted final-transform lens; identity / zero / 1 when absent. */
  uniform mat4 uFinalInvM;
  uniform vec4 uFinalInvT;
  uniform float uFinalSigmaMin;
  /** INVERSE view rotor: lifts a view-frame query into the attractor frame,
   * q = uInvRotor * vec4(p, uW0). The world rotor (uRot4 in the cloud
   * shader) rotates attractor space INTO view space; a rotation's inverse
   * is its transpose, so scene.ts uploads the transposed matrix here (see
   * setSurfaceView4 in this module). */
  uniform mat4 uInvRotor;
  /** The marched w-slice — the same w0 the cloud/flame/voxel renderers
   * slice at. */
  uniform float uW0;
  /** Base-color source: 0 = by-transform (uMapColor), 1 = orbit-trap
   * palette, 2 = height ramp, 3 = radius ramp, 4 = orbit rings, 5 = orbit
   * sheets. Sources 1-5 sample uColorLUT. */
  uniform int uColorSource;
  /** Per-level decay of the orbit-trap blend weight (flam3's color speed,
   * fr-rl4b): 0.5 = the classic halving, 0 = pure depth-0 regions, 1 =
   * every level weighs the same. Read by the "palette" source only. */
  uniform float uColorSpeed;
  /** 256x1 RGBA ramp for sources 1-5, built CPU-side by color.ts's ONE ramp
   * definition and uploaded by the scene — no ramp math lands here. */
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
   * never below the base childScale * (r - R). fr-beck measured this exact
   * refinement eliminating every march ghost. */
  float refinedCert4(vec4 img, float r, float childScale) {
    float inner = 1e30;
    for (int k = 0; k < uMapCount; k++) {
      vec4 kImg = uInvM[k] * img + uInvT[k];
      inner = min(inner, uSigmaMin[k] * (length(kImg) - uBoundingRadius));
    }
    return childScale * max(r - uBoundingRadius, inner);
  }

  /**
   * Both surfaceDE overloads mirror estimateDistance4Refined in
   * src/fractal/surface-de-4d.ts (the tested CPU oracle) — any change there
   * must land in BOTH bodies here, and vice versa. Width-4 BEAM inverse-map
   * descent (fr-v6yg's paired A/B chains, ported one dimension up by
   * fr-beck) with REFINED sibling certificates (fr-beck's measured
   * ghost-eliminator: one extra Hutchinson level applied to a candidate's
   * own inverse image before it freezes into the running min) — hardcoded
   * here exactly as 3D hardcodes its beam width, so there is no 'wide' flag
   * and no width-1 branch to port. fr-jkpn's rank-3/4 validity slots ride
   * along as extra V1/V2 chains, live only while their image stays
   * in-sphere — an escaped rank-3/4 candidate folds the same refined
   * certificate instead, exactly as it would without the slots. Refined
   * folds replace plain ones at the single per-candidate EVICTION fold
   * (whichever tuple the rank-1..4 ladders displace) and the two rank-3/4
   * PROMOTE folds (a validity candidate that escaped before it could
   * occupy V1/V2); the two ESCAPE-RADIUS folds and the two TERMINAL folds
   * at loop end (chains A/B only — validity chains fold no terminal at
   * all) stay PLAIN, exactly as estimateDistance4Refined keeps them —
   * refining those would cost another inverse-map sweep for candidates
   * already destined for the running min by a cheaper route. Every refined
   * fold site carries the oracle's fr-1z6p laziness guard: refinement can
   * only RAISE a certificate, so a fold whose PLAIN certificate already
   * fails to beat the running min is skipped whole — bit-exact, and it
   * caps the inner sweeps at the folds that actually advance the min
   * (measured on the fr-v6yg harness: tesseract 1504 -> 450 apps/call,
   * values unchanged).
   * 1e30 stands in for Infinity
   * (slot-occupancy tests use < 1e29): with sigma products <= 1 and real
   * distances O(1..10) it can never be confused for a real bound. This
   * plain overload is the workhorse (march, normals, shadow, occlusion);
   * the out-param overload below adds hit-shading extras.
   */
  float surfaceDE(vec3 p) {
    // View -> attractor frame: a rotation is an isometry, so the DE's
    // distances and gradients survive the lift untouched; then the final
    // lens, exactly as the oracle's prologue.
    vec4 q = uInvRotor * vec4(p, uW0);
    q = uFinalInvM * q + uFinalInvT;
    float startR = length(q);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    // Chain slot A starts at the (lensed) query; slot B idles until beam
    // selection fills it. Each chain carries the contraction accumulated
    // INCLUDING its own map and the radius it was selected at.
    vec4 aQ = q;
    float aScale = 1.0;
    float aR = startR;
    bool aLive = true;
    vec4 bQ = vec4(0.0);
    float bScale = 1.0;
    float bR = 0.0;
    bool bLive = false;
    // Validity chains (fr-jkpn): they hold the level's rank-3/4
    // candidates ONLY while their points are in-sphere, and carry no R
    // field — unlike A/B they never fold a terminal (see past the loop),
    // and expansion re-derives every child radius, so the selection
    // radius is dead weight once occupancy is decided.
    vec4 v1Q = vec4(0.0);
    float v1Scale = 1.0;
    bool v1Live = false;
    vec4 v2Q = vec4(0.0);
    float v2Scale = 1.0;
    bool v2Live = false;
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (!aLive && !bLive && !v1Live && !v2Live) {
        break;
      }
      // The four smallest-key candidates this level, key-ascending. The
      // sentinel r = 0 keeps empty slots out of every escaped-candidate
      // fold below.
      float c1Key = 1e30;
      vec4 c1Q = vec4(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
      float c2Key = 1e30;
      vec4 c2Q = vec4(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
      // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
      // by everything the top-2 ladder evicts, so the pair holds exactly
      // the level's third- and fourth-smallest keys.
      float c3Key = 1e30;
      vec4 c3Q = vec4(0.0);
      float c3Scale = 1.0;
      float c3R = 0.0;
      float c3Cert = 0.0;
      float c4Key = 1e30;
      vec4 c4Q = vec4(0.0);
      float c4Scale = 1.0;
      float c4R = 0.0;
      float c4Cert = 0.0;
      for (int c = 0; c < 4; c++) {
        vec4 pQ = vec4(0.0);
        float pScale = 1.0;
        if (c == 0) {
          if (!aLive) {
            continue;
          }
          pQ = aQ;
          pScale = aScale;
        } else if (c == 1) {
          if (!bLive) {
            continue;
          }
          pQ = bQ;
          pScale = bScale;
        } else if (c == 2) {
          if (!v1Live) {
            continue;
          }
          pQ = v1Q;
          pScale = v1Scale;
        } else {
          if (!v2Live) {
            continue;
          }
          pQ = v2Q;
          pScale = v2Scale;
        }
        for (int j = 0; j < uMapCount; j++) {
          vec4 img = uInvM[j] * pQ + uInvT[j];
          float r = length(img);
          float key = pScale * (r - uBoundingRadius);
          float childScale = pScale * uSigmaMin[j];
          float cert = childScale * (r - uBoundingRadius);
          // Exactly one tuple leaves the top-2 ladder per candidate — the
          // displaced runner-up, or the candidate itself. It spills into
          // the rank-3/4 ladder or folds below; empty-slot sentinels flow
          // through both harmlessly (key 1e30 never inserts, r = 0 never
          // folds).
          float eKey = key;
          vec4 eQ = img;
          float eScale = childScale;
          float eR = r;
          float eCert = cert;
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
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
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = key;
            c2Q = img;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          }
          // Spill into the rank-3/4 ladder (unconditional at width 4);
          // what THAT evicts (or the spilled tuple itself, when it beats
          // neither slot) falls through to the fold below.
          if (eKey < c3Key) {
            // The evicted key is dead past this point — only the folded
            // fields (point, scale, radius, certificate) survive; width 4
            // is hardcoded here, so there is no tKey.
            vec4 tQ = c4Q;
            float tScale = c4Scale;
            float tR = c4R;
            float tCert = c4Cert;
            c4Key = c3Key;
            c4Q = c3Q;
            c4Scale = c3Scale;
            c4R = c3R;
            c4Cert = c3Cert;
            c3Key = eKey;
            c3Q = eQ;
            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
            eQ = tQ;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          } else if (eKey < c4Key) {
            vec4 tQ = c4Q;
            float tScale = c4Scale;
            float tR = c4R;
            float tCert = c4Cert;
            c4Key = eKey;
            c4Q = eQ;
            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
            eQ = tQ;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          }
          // The tuple leaving the beam frontier: escaped candidates fold
          // their REFINED certificate (fr-beck: one extra Hutchinson level
          // closes the barely-escaped-sibling ghost) — skipped whole when
          // its plain certificate cannot beat the running min anyway (the
          // oracle's laziness guard, bit-exact); an in-sphere tuple
          // carries no positive certificate — it can only get here past
          // FOUR smaller keys, the (shrunken) fr-jkpn residual drop.
          if (eR > uBoundingRadius && eCert < best) {
            best = min(best, refinedCert4(eQ, eR, eScale));
          }
        }
      }
      // Promote: the best candidate continues as chain A, the runner-up
      // as chain B; past the escape radius a candidate folds its PLAIN
      // terminal and dies instead (deeper refinement cannot improve the
      // min, and the oracle's escape fold stays unrefined). Ranks 3/4
      // continue as validity chains ONLY while in-sphere; escaped, they
      // fold the same refined certificate they would have folded without
      // the slots.
      aLive = false;
      bLive = false;
      v1Live = false;
      v2Live = false;
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
      if (c3Key < 1e29) {
        if (c3R > uBoundingRadius) {
          if (c3Cert < best) {
            best = min(best, refinedCert4(c3Q, c3R, c3Scale));
          }
        } else {
          v1Q = c3Q;
          v1Scale = c3Scale;
          v1Live = true;
        }
      }
      if (c4Key < 1e29) {
        if (c4R > uBoundingRadius) {
          if (c4Cert < best) {
            best = min(best, refinedCert4(c4Q, c4R, c4Scale));
          }
        } else {
          v2Q = c4Q;
          v2Scale = c4Scale;
          v2Live = true;
        }
      }
    }
    // Terminal bound of chains alive at the depth cap (the KIFS last-value
    // formula, PLAIN — not refined): non-positive when the chain tracked
    // the attractor all the way down.
    if (aLive) {
      best = min(best, aScale * (aR - uBoundingRadius));
    }
    if (bLive) {
      best = min(best, bScale * (bR - uBoundingRadius));
    }
    // Validity chains fold NO cap terminal — deliberately asymmetric with
    // A/B. In-sphere means inside the bounding SPHERE, not near the
    // attractor, so a validity chain's cap terminal is a vacuous negative
    // bound that can only ever pull the estimate toward a fabricated hit
    // (the membrane direction fr-jkpn's record calls the visually harmful
    // one), never fix a real one — the piece it tracks sits within
    // sigmaMax_chain * 2R of the query, sub-resolution wherever the depth
    // cap is not clamped. Measured (fr-jkpn harness, all systems, both
    // estimators, widths 3/4): folding them changes NOTHING — whenever a
    // validity chain survives to the cap, chain A holds an equal-or-deeper
    // branch whose terminal already dominates — so the fold is omitted on
    // principle, not cost. (The disclosed repro3 void-false-hit uptick,
    // 0 -> 2/435 refined at width 4, comes from A's OWN terminal on
    // wanderer branches the validity slots keep alive in-sphere to the
    // depth cap — and in-sphere is not near-attractor, so the KIFS
    // last-value bound is vacuous for them at ANY cap size: re-measured
    // unchanged after fr-xok8 raised the ceiling from 48 to 128.)
    float d = max(best, sphereBound);
    return d * uFinalSigmaMin;
  }

  /**
   * Hit-shading variant: the SAME refined beam descent as the plain
   * overload — keep the two bodies in lockstep, both mirror
   * estimateDistance4Refined — plus tracer-side extras that are NOT part
   * of the CPU oracle's distance contract (surface-de-4d.ts mirrors
   * distance only). firstChoice is the depth-0 winning candidate's map,
   * keying by-transform color (identical to the old greedy pick: level 0
   * has one chain at scale 1, so the selection key ranks by radius
   * alone). trap is a flame-style structural blend of the winning
   * candidates' palette coordinates, accumulated TOP-DOWN with
   * geometrically decaying weight (level d weighs uColorSpeed^d,
   * normalized at the end; 0.5 is the classic decay): the depth-0 choice
   * — which top-level copy of the attractor the hit sits in — dominates
   * the final coordinate, matching flam3's convention where the
   * LAST-applied transform dominates a plotted point's color (descent
   * order is application order reversed, so descent level 0 is the most
   * significant digit; the previous deepest-first recurrence rendered as
   * per-pixel palette noise — fr-gt9i). rings is the classic geometric
   * orbit trap (fr-rl4b): the winning chain's closest radial approach
   * |image|/R across the descent, min-tracked exactly where the trap
   * blend samples — radial shells in raw attractor space that follow the
   * fractal's own structure. sheets is rings' plane-trap sibling: the
   * winning chain's closest approach |image.y|/R to the attractor
   * frame's y = 0 plane, min-tracked the same way — nested laminar bands
   * cutting across the structure. (An escape-depth extra was tried in
   * this slot first and swapped out pre-release: on uniform-contraction
   * systems the escape level is pinned by the hit epsilon, not local
   * structure, and it rendered one flat hue.) It follows the per-level
   * best candidate and stops when every chain has escaped. Called ONCE
   * per hit; the march itself uses the plain overload.
   */
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets
  ) {
    vec4 q = uInvRotor * vec4(p, uW0);
    q = uFinalInvM * q + uFinalInvT;
    float startR = length(q);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    vec4 aQ = q;
    float aScale = 1.0;
    float aR = startR;
    bool aLive = true;
    vec4 bQ = vec4(0.0);
    float bScale = 1.0;
    float bR = 0.0;
    bool bLive = false;
    // Validity chains (fr-jkpn): they hold the level's rank-3/4
    // candidates ONLY while their points are in-sphere, and carry no R
    // field — unlike A/B they never fold a terminal (see past the loop),
    // and expansion re-derives every child radius, so the selection
    // radius is dead weight once occupancy is decided.
    vec4 v1Q = vec4(0.0);
    float v1Scale = 1.0;
    bool v1Live = false;
    vec4 v2Q = vec4(0.0);
    float v2Scale = 1.0;
    bool v2Live = false;
    firstChoice = 0;
    trap = 0.0;
    rings = 1.0;
    sheets = 1.0;
    float trapAcc = 0.0;
    float trapNorm = 0.0;
    float trapW = 1.0;
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (!aLive && !bLive && !v1Live && !v2Live) {
        break;
      }
      float c1Key = 1e30;
      vec4 c1Q = vec4(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
      int c1Map = 0;
      float c2Key = 1e30;
      vec4 c2Q = vec4(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
      // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
      // by everything the top-2 ladder evicts, so the pair holds exactly
      // the level's third- and fourth-smallest keys.
      float c3Key = 1e30;
      vec4 c3Q = vec4(0.0);
      float c3Scale = 1.0;
      float c3R = 0.0;
      float c3Cert = 0.0;
      float c4Key = 1e30;
      vec4 c4Q = vec4(0.0);
      float c4Scale = 1.0;
      float c4R = 0.0;
      float c4Cert = 0.0;
      for (int c = 0; c < 4; c++) {
        vec4 pQ = vec4(0.0);
        float pScale = 1.0;
        if (c == 0) {
          if (!aLive) {
            continue;
          }
          pQ = aQ;
          pScale = aScale;
        } else if (c == 1) {
          if (!bLive) {
            continue;
          }
          pQ = bQ;
          pScale = bScale;
        } else if (c == 2) {
          if (!v1Live) {
            continue;
          }
          pQ = v1Q;
          pScale = v1Scale;
        } else {
          if (!v2Live) {
            continue;
          }
          pQ = v2Q;
          pScale = v2Scale;
        }
        for (int j = 0; j < uMapCount; j++) {
          vec4 img = uInvM[j] * pQ + uInvT[j];
          float r = length(img);
          float key = pScale * (r - uBoundingRadius);
          float childScale = pScale * uSigmaMin[j];
          float cert = childScale * (r - uBoundingRadius);
          // Exactly one tuple leaves the top-2 ladder per candidate — the
          // displaced runner-up, or the candidate itself. It spills into
          // the rank-3/4 ladder or folds below; empty-slot sentinels flow
          // through both harmlessly (key 1e30 never inserts, r = 0 never
          // folds).
          float eKey = key;
          vec4 eQ = img;
          float eScale = childScale;
          float eR = r;
          float eCert = cert;
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
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
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = key;
            c2Q = img;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          }
          // Spill into the rank-3/4 ladder (unconditional at width 4);
          // what THAT evicts (or the spilled tuple itself, when it beats
          // neither slot) falls through to the fold below.
          if (eKey < c3Key) {
            // The evicted key is dead past this point — only the folded
            // fields (point, scale, radius, certificate) survive; width 4
            // is hardcoded here, so there is no tKey.
            vec4 tQ = c4Q;
            float tScale = c4Scale;
            float tR = c4R;
            float tCert = c4Cert;
            c4Key = c3Key;
            c4Q = c3Q;
            c4Scale = c3Scale;
            c4R = c3R;
            c4Cert = c3Cert;
            c3Key = eKey;
            c3Q = eQ;
            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
            eQ = tQ;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          } else if (eKey < c4Key) {
            vec4 tQ = c4Q;
            float tScale = c4Scale;
            float tR = c4R;
            float tCert = c4Cert;
            c4Key = eKey;
            c4Q = eQ;
            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
            eQ = tQ;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          }
          // The tuple leaving the beam frontier: escaped candidates fold
          // their REFINED certificate (fr-beck: one extra Hutchinson level
          // closes the barely-escaped-sibling ghost) — skipped whole when
          // its plain certificate cannot beat the running min anyway (the
          // oracle's laziness guard, bit-exact); an in-sphere tuple
          // carries no positive certificate — it can only get here past
          // FOUR smaller keys, the (shrunken) fr-jkpn residual drop.
          if (eR > uBoundingRadius && eCert < best) {
            best = min(best, refinedCert4(eQ, eR, eScale));
          }
        }
      }
      if (depth == 0) {
        firstChoice = c1Map;
      }
      trapAcc += trapW * uTrapIndex[c1Map];
      trapNorm += trapW;
      trapW *= uColorSpeed;
      rings = min(rings, c1R / uBoundingRadius);
      sheets = min(sheets, abs(c1Q.y) / uBoundingRadius);
      aLive = false;
      bLive = false;
      v1Live = false;
      v2Live = false;
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
      if (c3Key < 1e29) {
        if (c3R > uBoundingRadius) {
          if (c3Cert < best) {
            best = min(best, refinedCert4(c3Q, c3R, c3Scale));
          }
        } else {
          v1Q = c3Q;
          v1Scale = c3Scale;
          v1Live = true;
        }
      }
      if (c4Key < 1e29) {
        if (c4R > uBoundingRadius) {
          if (c4Cert < best) {
            best = min(best, refinedCert4(c4Q, c4R, c4Scale));
          }
        } else {
          v2Q = c4Q;
          v2Scale = c4Scale;
          v2Live = true;
        }
      }
    }
    if (aLive) {
      best = min(best, aScale * (aR - uBoundingRadius));
    }
    if (bLive) {
      best = min(best, bScale * (bR - uBoundingRadius));
    }
    // Validity chains fold NO cap terminal — deliberately asymmetric with
    // A/B. In-sphere means inside the bounding SPHERE, not near the
    // attractor, so a validity chain's cap terminal is a vacuous negative
    // bound that can only ever pull the estimate toward a fabricated hit
    // (the membrane direction fr-jkpn's record calls the visually harmful
    // one), never fix a real one — the piece it tracks sits within
    // sigmaMax_chain * 2R of the query, sub-resolution wherever the depth
    // cap is not clamped. Measured (fr-jkpn harness, all systems, both
    // estimators, widths 3/4): folding them changes NOTHING — whenever a
    // validity chain survives to the cap, chain A holds an equal-or-deeper
    // branch whose terminal already dominates — so the fold is omitted on
    // principle, not cost. (The disclosed repro3 void-false-hit uptick,
    // 0 -> 2/435 refined at width 4, comes from A's OWN terminal on
    // wanderer branches the validity slots keep alive in-sphere to the
    // depth cap — and in-sphere is not near-attractor, so the KIFS
    // last-value bound is vacuous for them at ANY cap size: re-measured
    // unchanged after fr-xok8 raised the ceiling from 48 to 128.)
    // Normalize the top-down blend. Every call that can reach a hit runs
    // depth 0 (uMapCount >= 1, chains start live), so trapNorm >= 1; the
    // guard just keeps a zero-map placeholder call from dividing by zero.
    trap = trapNorm > 0.0 ? trapAcc / trapNorm : 0.0;
    rings = clamp(rings, 0.0, 1.0);
    sheets = clamp(sheets, 0.0, 1.0);
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

    // The 3D ball the w = uW0 slice of the visible 4D set can occupy:
    // |(p, uW0)| <= uVisibleRadius implies |p| <= this (rotation preserves
    // the 4D norm). Empty when the slice sits past the visible radius.
    float sliceVisR = sqrt(max(uVisibleRadius * uVisibleRadius - uW0 * uW0, 0.0));

    // Entry/exit against the origin-centered sphere bounding the slice's
    // visible set (small margin so silhouettes right at the bound aren't
    // clipped): solve |ro + t rd|^2 = radius^2. No intersection, or an exit
    // behind the camera, is a miss.
    float radius = sliceVisR * 1.02;
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
    for (int i = 0; i < uMarchSteps; i++) {
      if (t > tFar) {
        break;
      }
      float d = surfaceDE(ro + rd * t);
      if (d < max(uPixelEps * t, uBoundingRadius * uHitFloor)) {
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
    // depth-0 greedy map, orbit-trap coordinate, and rings/sheets traps
    // (the distance itself is discarded — the march already accepted this
    // point).
    int firstChoice;
    float trap;
    float rings;
    float sheets;
    surfaceDE(pos, firstChoice, trap, rings, sheets);

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

    // Base color by source. Sources 1-5 sample the LUT built CPU-side by
    // color.ts's ONE ramp definition — no ramp math lands here; rings and
    // sheets arrive pre-normalized from the descent.
    vec3 base;
    if (uColorSource == 0) {
      base = uMapColor[clamp(firstChoice, 0, uMapCount - 1)];
    } else {
      float u;
      if (uColorSource == 1) {
        u = trap;
      } else if (uColorSource == 2) {
        // Height normalizes against the visible bounding sphere. The 4D
        // radius is slice-invariant, so height (a plain 3D world-space
        // coordinate) doesn't swim as uW0 slides either.
        u = clamp(pos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0);
      } else if (uColorSource == 3) {
        // The TRUE 4D radius, matching the cloud's 4D radius color mode:
        // lift the hit back into the attractor frame and measure it there.
        // length() is rotation-invariant, so this reading is invariant
        // under BOTH rotor spins and slice moves — unlike a plain 3D
        // length(pos), which would swim under either.
        vec4 q4 = uInvRotor * vec4(pos, uW0);
        u = clamp(length(q4) / uVisibleRadius, 0.0, 1.0);
      } else if (uColorSource == 4) {
        u = rings;
      } else {
        u = sheets;
      }
      base = texture(uColorLUT, vec2(u, 0.5)).rgb;
    }

    // Soft shadow: classic DE penumbra toward the light — the shadow ray's
    // closest approach to a surface, sharpened by 8/ts, starting just off
    // the surface to dodge self-shadowing. Leaving the slice's visible
    // sphere means fully lit from there on, and near-black penumbras end
    // early.
    float shadow = 1.0;
    float ts = h * 2.0;
    for (int i = 0; i < uShadowSteps; i++) {
      vec3 sp = pos + n * h * 2.0 + uLightDir * ts;
      float d = surfaceDE(sp);
      shadow = min(shadow, 8.0 * d / ts);
      ts += clamp(d, uBoundingRadius * 2.0e-4, sliceVisR * 0.1);
      if (shadow < 0.02 || length(sp) > sliceVisR * 1.05) {
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
    for (int i = 1; i <= uAoTaps; i++) {
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
    // traveled inside the slice's visible sphere — ~0.38 haze at the far
    // side (a full 2R chord), a depth cue matching the explorer's fog feel
    // (constants tuned by eye).
    float fog =
      1.0 - exp(-0.12 * pow((t - tEnter) / max(sliceVisR, 1.0e-6), 2.0));
    col = mix(col, background, clamp(fog, 0.0, 1.0));

    outColor = vec4(col, 1.0);
  }
`;

/** Build the surface material with placeholder uniforms (zero maps, unit
 * hypersphere): complete and compilable before the first system arrives,
 * painting only the backdrop until {@link setSurfaceSystem4} and
 * {@link setSurfaceView4} run. The per-map arrays are allocated ONCE at the
 * compile-time cap and mutated in place — Three binds uniform values by
 * object identity, so replacing them would orphan the binding. */
export function createSurfaceMaterial4(): THREE.ShaderMaterial {
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
          { length: SURFACE4_MAX_MAPS },
          () => new THREE.Matrix4(),
        ),
      },
      uInvT: {
        value: Array.from(
          { length: SURFACE4_MAX_MAPS },
          () => new THREE.Vector4(),
        ),
      },
      uSigmaMin: { value: new Array<number>(SURFACE4_MAX_MAPS).fill(1) },
      uMapColor: {
        value: Array.from(
          { length: SURFACE4_MAX_MAPS },
          () => new THREE.Vector3(),
        ),
      },
      uTrapIndex: { value: new Array<number>(SURFACE4_MAX_MAPS).fill(0) },
      uMapCount: { value: 0 },
      uBoundingRadius: { value: 1 },
      uEscapeRadius: { value: 2 },
      uMaxDepth: { value: 0 },
      uStepScale: { value: 1 },
      uVisibleRadius: { value: 1 },
      uFinalInvM: { value: new THREE.Matrix4() },
      uFinalInvT: { value: new THREE.Vector4() },
      uFinalSigmaMin: { value: 1 },
      uInvRotor: { value: new THREE.Matrix4() },
      uW0: { value: 0 },
      uColorSource: { value: 0 },
      uColorSpeed: { value: 0.5 },
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
      // Full-tier defaults; the scene overwrites all four per tier
      // (fr-sjff), same knobs as the 3D tracer.
      uMarchSteps: { value: SURFACE_FULL_MARCH_STEPS },
      uShadowSteps: { value: SURFACE_FULL_SHADOW_STEPS },
      uAoTaps: { value: SURFACE_FULL_AO_TAPS },
      uHitFloor: { value: SURFACE_FULL_HIT_FLOOR },
    },
    vertexShader: SURFACE4_VERTEX,
    fragmentShader: SURFACE4_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
}

/** Pack a {@link SurfaceDE4} + per-slot shading inputs into the material's
 * uniforms. `colors[j]` is the sRGB 0..1 color and `trapIndices[j]` the
 * orbit-trap palette coordinate in [0, 1] for `de.maps[j]` (both already
 * keyed by `baseIndex` on the caller's side, both `de.maps.length` long).
 * `trapIndices` is optional for callers that predate the color sources:
 * omitting it zero-fills the live slots — an explicit reset, like the final
 * lens, so a previous system's traps never leak. Slots past the live count
 * keep stale values by design — `uMapCount` guards every shader loop.
 * Throws RangeError if `de.maps.length > SURFACE4_MAX_MAPS`: callers gate
 * eligibility first, so reaching it is a bug. */
export function setSurfaceSystem4(
  material: THREE.ShaderMaterial,
  de: SurfaceDE4,
  colors: Vec3[],
  trapIndices?: number[],
): void {
  if (de.maps.length > SURFACE4_MAX_MAPS) {
    throw new RangeError(
      `surface DE has ${de.maps.length} maps, but the material carries at most ${SURFACE4_MAX_MAPS}`,
    );
  }
  const u = material.uniforms;
  const invM = u.uInvM.value as THREE.Matrix4[];
  const invT = u.uInvT.value as THREE.Vector4[];
  const sigmaMin = u.uSigmaMin.value as number[];
  const mapColor = u.uMapColor.value as THREE.Vector3[];
  const trapIndex = u.uTrapIndex.value as number[];
  de.maps.forEach((map, j) => {
    const m = map.invM;
    // SurfaceDE4Map.invM is ROW-major; Matrix4.set takes row-major
    // arguments and stores column-major internally — exactly the layout
    // the GLSL `mat4 * vec4` product expects, so this is a straight
    // pass-through.
    invM[j].set(
      m[0],
      m[1],
      m[2],
      m[3],
      m[4],
      m[5],
      m[6],
      m[7],
      m[8],
      m[9],
      m[10],
      m[11],
      m[12],
      m[13],
      m[14],
      m[15],
    );
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
  const finalM = u.uFinalInvM.value as THREE.Matrix4;
  const finalT = u.uFinalInvT.value as THREE.Vector4;
  if (de.final) {
    const f = de.final.invM;
    finalM.set(
      f[0],
      f[1],
      f[2],
      f[3],
      f[4],
      f[5],
      f[6],
      f[7],
      f[8],
      f[9],
      f[10],
      f[11],
      f[12],
      f[13],
      f[14],
      f[15],
    );
    finalT.set(...de.final.invT);
    u.uFinalSigmaMin.value = de.final.sigmaMin;
  } else {
    finalM.identity();
    finalT.set(0, 0, 0, 0);
    u.uFinalSigmaMin.value = 1;
  }
}

/** Push the current 4D view — world rotor + marched w-slice — into the
 * material's uniforms. NEW: 3D has no view uniforms, because there is
 * nothing to un-rotate — its query is already in the attractor's frame.
 * `rotor` is the ROW-MAJOR world rotor matrix exactly as
 * `four-d-view.ts`'s `matrix()` produces and `scene.ts`'s `setRot4`
 * consumes — it rotates attractor space INTO view space (the cloud shader
 * computes `uRot4 * position`). The tracer needs the opposite direction,
 * view space back into the attractor frame, and a rotation matrix's
 * inverse is exactly its transpose — so `uInvRotor` is set from the SAME 16
 * numbers with rows and columns swapped (a column-reordered `Matrix4.set`,
 * since `set` itself always fills row-major). `w0` is the marched slice's
 * w-coordinate, uploaded verbatim. No dirty-check here: like
 * {@link setSurfaceSystem4}, this is a pure packer — `scene.ts` owns
 * render-needed bookkeeping. */
export function setSurfaceView4(
  material: THREE.ShaderMaterial,
  rotor: number[],
  w0: number,
): void {
  const u = material.uniforms;
  const invRotor = u.uInvRotor.value as THREE.Matrix4;
  invRotor.set(
    rotor[0],
    rotor[4],
    rotor[8],
    rotor[12],
    rotor[1],
    rotor[5],
    rotor[9],
    rotor[13],
    rotor[2],
    rotor[6],
    rotor[10],
    rotor[14],
    rotor[3],
    rotor[7],
    rotor[11],
    rotor[15],
  );
  u.uW0.value = w0;
}
