import * as THREE from "three";
import type { EscapeDE } from "../fractal/escape-de";
import { ESCAPE_TIME_ITERATIONS } from "../fractal/escape-de";
import type { SurfaceDE } from "../fractal/surface-de";
import {
  SPHEREFOLD_MID_MIN_R,
  SURFACE_FOLD_BEAM_WIDTH,
  SURFACE_FOLD_NONE,
} from "../fractal/surface-de";
import type { Vec3 } from "../fractal/types";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";
import { lightDirection } from "./voxel-material";

/**
 * The surface render's GPU sphere-tracer (epic fr-7jlk): a full-screen-quad
 * ShaderMaterial that marches camera rays against an analytic distance
 * estimator for the IFS attractor — width-4 beam inverse-map descent
 * (fr-v6yg) with REFINED sibling certificates (fr-1z6p: fr-beck's measured
 * ghost-eliminator ported down from the 4D tracer, closing the smooth
 * "balloon" membranes the plain certificates rendered across attractor
 * voids), precomputed by `buildSurfaceDE` (`src/fractal/surface-de.ts`)
 * and packed into fixed-size uniform arrays here — BASE maps only, with
 * kaleidoscope copies swept as sectors around them rather than expanded
 * into slots (fr-x029), so the array budget no longer caps symmetry order.
 * fr-jkpn's validity slots
 * ride along too — rank-3/4 candidate chains that stay live only while
 * in-sphere, closing the multi-branch drops width 2 alone still had. Hits
 * are shaded in the solid raymarcher's vocabulary — DE-gradient
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
 * `flame-gpu.ts`. Since fr-5rvk that is TWO compiled variants behind the
 * `SURFACE_FOLDS` define, flipped by `setSurfaceSystem` when the DE's
 * fold-ness changes (a session-set-scale program rebuild): `0` compiles the
 * affine ladder bodies above byte-for-byte as they shipped, `1` compiles
 * fold-frontier bodies mirroring the oracle's `descendFold` — the
 * `SURFACE_FOLD_BEAM_WIDTH`-slot frontier with region floors, floored
 * keys, the drop-fold rule and floor-vs-best pruning that make pure-fold
 * maps (27/3/81 inverse branches each) marchable at all. Per-map fold data
 * rides a `uFoldParams` vec4 array that REPLACES `uTrapIndex` under the
 * define (the trap coordinate moves into its `.w`), so both variants meet
 * the same uniform budget.
 *
 * The three shading taps (normal gradient, penumbra shadow, ambient
 * occlusion) ride the 1-arg value form, which fold systems route to
 * `surfaceDEProbe` — a width-1 instantiation of the SAME descent template
 * (fr-zqu8, the WGSL twin's fr-p8bc verdict ported to the fragment path;
 * one text, two names, so the bodies cannot drift). Taps light a hit the
 * full-width march already certified, never decide geometry — the march
 * and hit acceptance stay at FOLD_W. Measured (Iris Xe, real driver, cold
 * Mesa cache, `scripts/shade-width-ab.mjs`): the probe CUT the fold
 * program's ~25s Mesa link 17.9x (25.5-26.4s -> 1.42-1.53s, n=3/arm) —
 * Mesa inlines the width-12 body at every call site, and with the probe
 * only the march still does — which also dissolved fr-f21s's
 * link-watchdog session-death lottery (the A/B's only context losses were
 * baseline-arm, kernel silent throughout). Boxfold-pair settles 509-987ms
 * vs baseline 695-1296ms, settled frames identical within session noise
 * (cross-arm pixel diff == within-arm rerun diff); equal 210s
 * mandelboxKifs windows resolve ~2.3x more frame at width 1, its crease
 * pixels staying march-bound (the fragment path's residual — compute owns
 * those sessions where an adapter exists, fr-tzdg). `?surfshadewidth=N`
 * overrides the width per session; N = FOLD_W disables the probe and
 * reproduces the pre-fr-zqu8 source byte for byte.
 *
 * Kept in its own module so `scene.ts` stays the
 * wiring layer: everything GLSL lives here, everything camera/frame lives
 * there (the scene sets `uCamPos`, `uInvProjView`, and `uPixelEps` per
 * frame).
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

/** Whole-ray cap on empty-space-grid cell skips, SEPARATE from the
 * march-step budget (fr-z70m). A skip is one NEAREST texel read — orders of
 * magnitude cheaper than the beam descent `uMarchSteps` exists to bound —
 * and the floors it steps by are deliberately conservative
 * (`surface-grid.ts`: DE at the cell center minus the cell half-diagonal),
 * so a ray threading gaps or grazing a face takes MANY of them where the
 * analytic march would take one large step. fr-55r5 originally charged
 * every skip against `uMarchSteps`, which SHRANK the march's reach exactly
 * on those rays — far or occlusion-threaded geometry dissolved into
 * per-pixel dropout speckle, worst wherever a view lined grazing faces up
 * (the fr-z70m screenshots' one-sided erosion). Exhausting this cap only
 * falls through to the analytic step — never wrong, just slower.
 * 256 clears the worst whole-ray skip count measured across the fr-z70m
 * pose sweeps (189, `scripts/erosion-repro.harness.ts`); doubling it
 * changed nothing measured. */
export const SURFACE_GRID_SKIP_CAP = 256;

/** Compile-time size of the per-map uniform arrays: at ~7 vec4-equivalents
 * per slot (mat3 = 3, plus vec3 + float + vec3 + float), 24 maps stays
 * comfortably under WebGL2's guaranteed 224 fragment uniform vectors.
 *
 * Slots are BASE maps (fr-x029). Kaleidoscope copies used to be expanded
 * into slots of their own, so this budget doubled as a cap on
 * `order * baseMaps` and gated high orders out of the mode; the descent now
 * sweeps sectors around the base maps instead (three scalar uniforms, no
 * slots), so the budget is the bare active-map count at ANY order. The app
 * gates on that count before entering the mode, so {@link setSurfaceSystem}
 * treats overflow as a bug, not a degrade. */
export const SURFACE_MAX_MAPS = 24;

/** `SurfaceSymmetry.axis` as the shader's `uSymAxis` code. The GLSL sector
 * step branches on an int, so the axis crosses the boundary as one. */
const SYM_AXIS_CODE: Record<SurfaceDE["symmetry"]["axis"], number> = {
  x: 0,
  y: 1,
  z: 2,
};

const SURFACE_VERTEX = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Default frontier width of the fold shading-probe descent (fr-zqu8, the
 * WebGL port of fr-p8bc's compute-twin verdict): the value-form DE the
 * shading taps ride (normal gradient, penumbra shadow, ambient occlusion
 * — taps LIGHT a hit the full-width march already certified, never
 * decide geometry) runs a width-1 greedy descent instead of the FOLD_W
 * frontier. Width 1 is the old greedy descent the oracle keeps for tests
 * — known to overshoot, which reads as a slight lightening of
 * deep-crease shadow/AO and which fr-p8bc measured as eyeball-identical
 * frames at 23.8x cheaper shading on the compute twin.
 */
export const SURFACE_SHADE_DE_WIDTH = 1;

/** `?surfshadewidth=N` (1..SURFACE_FOLD_BEAM_WIDTH) overrides the shipped
 * probe width for A/B runs, read once at module load like scene.ts's
 * `?surfperf`. N equal to the beam width DISABLES the probe and
 * reproduces the pre-fr-zqu8 fragment source byte for byte — the WGSL
 * twin's A/A discipline (equal widths emit identical source). */
function resolveShadeDeWidth(): number {
  if (typeof window === "undefined") return SURFACE_SHADE_DE_WIDTH;
  const raw = new URLSearchParams(window.location.search).get("surfshadewidth");
  if (raw === null) return SURFACE_SHADE_DE_WIDTH;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= SURFACE_FOLD_BEAM_WIDTH
    ? n
    : SURFACE_SHADE_DE_WIDTH;
}

/**
 * The fold-frontier descent body (fr-5rvk through fr-kidj) as ONE template
 * instantiated twice — fr-zqu8, mirroring surface-de-gpu.ts's
 * surfaceDEProbe derivation: the public `surfaceDE` at width FOLD_W, plus
 * (when the shade width differs) a `surfaceDEProbe` copy at
 * {@link SURFACE_SHADE_DE_WIDTH}. One text, two names: the bodies cannot
 * drift. Unlike the WGSL twin's module-scope frontier, the arrays here
 * are function-local, so the instances share scratch names safely and
 * only the function name and width vary.
 */
const foldDescentGlsl = (fnName: string, width: string): string =>
  `  float ${fnName}(vec3 p, float cutoff) {
    vec3 q = uFinalInvM * p + uFinalInvT;
    float startR = length(q - uBoundCenter);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    // The oracle's bailBelow (fr-55r5): -1e30 disables the test.
    float bailBelow =
      (cutoff > 0.0 && sphereBound * uFinalSigmaMin < cutoff) ? cutoff : -1e30;
    // The frontier (the oracle's fc* scratch): point, scale, floor and
    // selection radius per live chain.
    vec3 fcQ[${width}];
    float fcScale[${width}];
    float fcFloor[${width}];
    float fcR[${width}];
    int chainCount = 1;
    fcQ[0] = q;
    fcScale[0] = 1.0;
    fcFloor[0] = 0.0;
    fcR[0] = startR;
    // Next-level kept tuples — UNSORTED, worst slot tracked by rescan
    // (the oracle's fn* scratch; see its insertion comment — Mesa dies on
    // the sorted insert-shift chains, one indexed write + a fixed-bound
    // read-only scan compiles).
    float fnKey[${width}];
    vec3 fnQ[${width}];
    float fnScale[${width}];
    float fnFloor[${width}];
    float fnR[${width}];
    float fnCert[${width}];
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (chainCount == 0) {
        break;
      }
      int keptCount = 0;
      float fnWorstKey = -1e30;
      int fnWorstIdx = 0;
      for (int c = 0; c < chainCount; c++) {
        float pScale = fcScale[c];
        float pFloor = fcFloor[c];
        vec3 sQ = fcQ[c];
        for (int k = 0; k < uSymOrder; k++) {
          if (k > 0) {
            sQ = stepSector(sQ);
          }
          for (int j = 0; j < uMapCount; j++) {
            vec4 fp = uFoldParams[j];
            int kind = int(fp.x);
            int branchCount =
              kind == 0 ? 1 : (kind == 1 ? 27 : (kind == 2 ? 3 : 81));
            float absW = fp.z / uSigmaMin[j];
            // fr-kidj stage 2 is deliberately CPU-ONLY. The oracle's
            // branch-and-bound skips (descendFold) are VALUE no-ops, so
            // this mirror computes identical values without them — and
            // every GLSL encoding tried (full dual-bound, dir-form only,
            // uniform-array data, in-shader-derived data) pushed this
            // variant's already-critical Mesa/Iris LINK over the browser
            // watchdog cliff: sessions died at entry with the
            // VALIDATE_STATUS-false/empty-log reset debris (fr-096u;
            // stage 1 alone links and runs clean — bisected commit by
            // commit on the real driver). The trade is measured: the
            // width sweep shows this kernel OCCUPANCY-bound (superlinear
            // in frontier width; ALU cuts bought ~14% at equal width), so
            // the skip's GPU value is small, while its CPU value (grid
            // builds, oracle consumers: 75x fewer transforms/call) is
            // kept in full.
            vec3 u = vec3(0.0);
            float ru = 0.0;
            vec3 pre0 = vec3(0.0);
            vec3 pre1 = vec3(0.0);
            vec3 pre2 = vec3(0.0);
            vec3 dUp = vec3(0.0);
            vec3 dDn = vec3(0.0);
            vec3 v = vec3(0.0);
            float sfSigma = 1.0;
            float sfRd = 0.0;
            if (kind != 0) {
              u = sQ * fp.y;
              if (kind == 1) {
                pre0 = u;
                pre1 = 2.0 - u;
                pre2 = -2.0 - u;
                dUp = max(u - 1.0, 0.0);
                dDn = max(-1.0 - u, 0.0);
              } else {
                ru = length(u);
              }
            }
            for (int b = 0; b < branchCount; b++) {
              vec3 img;
              float branchSigma;
              // The candidate's floor is knowable BEFORE the child
              // transform (fr-kidj stage 1: branchRd needs only the branch
              // decode), so the floor-vs-best prune runs first and only
              // surviving branches pay the inverse application — the
              // oracle's exact order.
              float candFloor = pFloor;
              if (kind == 0) {
                if (candFloor > 0.0 && candFloor >= best) {
                  continue;
                }
                img = uInvM[j] * sQ + uInvT[j];
                branchSigma = uSigmaMin[j];
              } else {
                float branchRd;
                if (kind == 2 || (kind == 3 && b % 27 == 0)) {
                  // (Re)compute the spherefold branch this b enters, with
                  // its distance to the branch's OUTPUT region.
                  int s = kind == 2 ? b : b / 27;
                  if (s == 0) {
                    v = u;
                    sfSigma = 1.0;
                    sfRd = max(1.0 - ru, 0.0);
                  } else if (s == 1) {
                    v = 0.25 * u;
                    sfSigma = 4.0;
                    sfRd = max(ru - 2.0, 0.0);
                  } else {
                    if (ru < ${SPHEREFOLD_MID_MIN_R}) {
                      // f32 overflow guard: fold the unit-shell bound
                      // (~pScale * |w|, never a near-zero ghost term) and
                      // skip the branch + its box expansion.
                      float shellCert = pScale * absW * (1.0 - ru);
                      shellCert = max(shellCert, pFloor);
                      if (shellCert < best) {
                        best = shellCert;
                        if (
                          best <= sphereBound ||
                          best * uFinalSigmaMin < bailBelow
                        ) {
                          return max(best, sphereBound) * uFinalSigmaMin;
                        }
                      }
                      if (kind == 3) {
                        b += 26;
                      }
                      continue;
                    }
                    float invR2 = 1.0 / (ru * ru);
                    v = u * invR2;
                    sfSigma = ru;
                    sfRd = max(max(1.0 - ru, ru - 2.0), 0.0);
                  }
                  if (kind == 3) {
                    pre0 = v;
                    pre1 = 2.0 - v;
                    pre2 = -2.0 - v;
                    dUp = max(v - 1.0, 0.0);
                    dDn = max(-1.0 - v, 0.0);
                  }
                }
                vec3 pre;
                if (kind == 2) {
                  pre = v;
                  branchRd = sfRd;
                } else {
                  // Box branch decode: per-axis preimage selectors, x
                  // fastest (b = selX + 3*selY + 9*selZ).
                  int bb = kind == 1 ? b : b % 27;
                  int selX = bb % 3;
                  int selY = (bb / 3) % 3;
                  int selZ = bb / 9;
                  pre = vec3(
                    selX == 0 ? pre0.x : (selX == 1 ? pre1.x : pre2.x),
                    selY == 0 ? pre0.y : (selY == 1 ? pre1.y : pre2.y),
                    selZ == 0 ? pre0.z : (selZ == 1 ? pre1.z : pre2.z)
                  );
                  vec3 dd = vec3(
                    selX == 0 ? max(dUp.x, dDn.x) : (selX == 1 ? dUp.x : dDn.x),
                    selY == 0 ? max(dUp.y, dDn.y) : (selY == 1 ? dUp.y : dDn.y),
                    selZ == 0 ? max(dUp.z, dDn.z) : (selZ == 1 ? dUp.z : dDn.z)
                  );
                  float boxRd = length(dd);
                  branchRd = kind == 1 ? boxRd : max(sfRd, sfSigma * boxRd);
                }
                if (branchRd > 0.0) {
                  candFloor = max(candFloor, pScale * absW * branchRd);
                }
                // Floor-vs-best prune: the subtree's every fold is >= its
                // floor, which already cannot advance the min. Pruned
                // branches never reach the inverse application below.
                if (candFloor > 0.0 && candFloor >= best) {
                  continue;
                }
                img = uInvM[j] * pre + uInvT[j];
                branchSigma = fp.z * sfSigma;
              }
              float r = length(img - uBoundCenter);
              float childScale = pScale * branchSigma;
              float key = pScale * (r - uBoundingRadius);
              if (candFloor > 0.0 && candFloor > key) {
                key = candFloor;
              }
              float cert = childScale * (r - uBoundingRadius);
              if (candFloor > 0.0 && candFloor > cert) {
                cert = candFloor;
              }
              // Past the escape radius deeper refinement cannot improve
              // the min: fold the (floor-raised) certificate plain.
              if (r > uEscapeRadius) {
                if (cert < best) {
                  best = cert;
                  if (
                    best <= sphereBound ||
                    best * uFinalSigmaMin < bailBelow
                  ) {
                    return max(best, sphereBound) * uFinalSigmaMin;
                  }
                }
                continue;
              }
              // Frontier insertion: unsorted storage, worst-slot replace
              // (the oracle's structure, term for term). Whatever leaves
              // the kept set folds plain: escaped tuples their
              // (floor-raised) certificate, in-sphere tuples their floor
              // — the drop-fold rule.
              float evR = 0.0;
              float evCert = 0.0;
              float evFloor = 0.0;
              bool evHas = false;
              if (keptCount == ${width} && key >= fnWorstKey) {
                evR = r;
                evCert = cert;
                evFloor = candFloor;
                evHas = true;
              } else {
                int slot;
                if (keptCount == ${width}) {
                  slot = fnWorstIdx;
                  evR = fnR[slot];
                  evCert = fnCert[slot];
                  evFloor = fnFloor[slot];
                  evHas = true;
                } else {
                  slot = keptCount;
                  keptCount++;
                }
                fnKey[slot] = key;
                fnQ[slot] = img;
                fnScale[slot] = childScale;
                fnFloor[slot] = candFloor;
                fnR[slot] = r;
                fnCert[slot] = cert;
                // Recompute the worst kept key once the frontier is full
                // — a fixed-bound scan of reads, first max wins.
                if (keptCount == ${width}) {
                  fnWorstKey = -1e30;
                  fnWorstIdx = 0;
                  for (int s2 = 0; s2 < ${width}; s2++) {
                    if (fnKey[s2] > fnWorstKey) {
                      fnWorstKey = fnKey[s2];
                      fnWorstIdx = s2;
                    }
                  }
                }
              }
              if (evHas) {
                if (evR > uBoundingRadius) {
                  if (evCert < best) {
                    best = evCert;
                    if (
                      best <= sphereBound ||
                      best * uFinalSigmaMin < bailBelow
                    ) {
                      return max(best, sphereBound) * uFinalSigmaMin;
                    }
                  }
                } else if (evFloor > 0.0 && evFloor < best) {
                  best = evFloor;
                  if (
                    best <= sphereBound ||
                    best * uFinalSigmaMin < bailBelow
                  ) {
                    return max(best, sphereBound) * uFinalSigmaMin;
                  }
                }
              }
            }
          }
        }
      }
      // The kept tuples become the next frontier.
      for (int i = 0; i < keptCount; i++) {
        fcQ[i] = fnQ[i];
        fcScale[i] = fnScale[i];
        fcFloor[i] = fnFloor[i];
        fcR[i] = fnR[i];
      }
      chainCount = keptCount;
    }
    // Floor-raised KIFS terminals for every chain alive at the depth cap:
    // a floor-0 chain is a true preimage orbit (its negative terminal is
    // the hit signal), a strayed chain folds its certified positive floor.
    for (int c = 0; c < chainCount; c++) {
      float terminal = fcScale[c] * (fcR[c] - uBoundingRadius);
      if (fcFloor[c] > 0.0 && fcFloor[c] > terminal) {
        terminal = fcFloor[c];
      }
      best = min(best, terminal);
    }
    return max(best, sphereBound) * uFinalSigmaMin;
  }`;

/** Strip `//` comments, blank lines and indentation (GLSL has no string
 * literals to confuse this, and the probe body carries no preprocessor
 * directives that would need column 0 to themselves). The probe instance
 * ships stripped because fragment SOURCE SIZE is what Mesa's fold link
 * prices (see resolveVariantArms: ~68KB links in ~25s, ~80KB crashed) —
 * the public instance keeps its commentary and its exact shipped bytes. */
const stripGlslComments = (glsl: string): string =>
  glsl
    .split("\n")
    .map((line) => {
      const ix = line.indexOf("//");
      return (ix === -1 ? line : line.slice(0, ix)).trim();
    })
    .filter((line) => line.length > 0)
    .join("\n");

/** The probe instance (fr-zqu8), emitted only when the width differs from
 * the beam's and only into the NON-lens source: the lens variant's source
 * already sits at the Mesa cliff (~79KB where ~80KB crashed — see
 * resolveVariantArms), its taps keep full-width cores through the public
 * wrapper, and fr-p8bc's compute verdict never covered lenses (the twin
 * renders no foldFinal systems). Comments are stripped for the same
 * reason the lens arm is excluded: source size. */
const foldProbeGlsl = (shadeDeWidth: number): string =>
  shadeDeWidth === SURFACE_FOLD_BEAM_WIDTH
    ? ""
    : `
#if SURFACE_FOLD_LENS
#else
${stripGlslComments(foldDescentGlsl("surfaceDEProbe", String(shadeDeWidth)))}
#endif`;

/** The value form the shading taps call, routed per fr-zqu8 (probe under
 * SURFACE_FOLDS, full descent elsewhere) — or the pre-fr-zqu8 text
 * verbatim when the probe is disabled. */
const foldValueFormGlsl = (shadeDeWidth: number): string =>
  shadeDeWidth === SURFACE_FOLD_BEAM_WIDTH
    ? `  /** Value form: the full descent, no early-out — every caller that needs
   * the DISTANCE rather than a hit decision (normal taps, shadow rays,
   * occlusion probes) goes through here, exactly as they pass the oracle
   * its default cutoff of 0. */
  float surfaceDE(vec3 p) {
    return surfaceDE(p, 0.0);
  }`
    : `  /** Value form: what the shading taps call — normal gradient, penumbra
   * shadow and occlusion probes; the march and hit acceptance use the
   * cutoff overload and stay full-width. Fold systems route it to the
   * width-${String(shadeDeWidth)} shading-probe descent (fr-zqu8;
   * fr-p8bc's measured verdict). The affine ladder keeps the full
   * descent, and under the fold lens the public wrapper below owns the
   * taps with full-width cores — see foldProbeGlsl for why the lens
   * variant carries no probe. */
  float surfaceDE(vec3 p) {
#if SURFACE_FOLD_LENS
    return surfaceDE(p, 0.0);
#else
#if SURFACE_FOLDS
    return surfaceDEProbe(p, 0.0);
#else
    return surfaceDE(p, 0.0);
#endif
#endif
  }`;

/**
 * Assemble the fragment source for one shading-probe width (fr-zqu8):
 * `SURFACE_FOLD_BEAM_WIDTH` disables the probe and reproduces the
 * pre-fr-zqu8 source byte for byte. Exported for tests; the module ships
 * exactly one build (SURFACE_FRAGMENT below).
 */
export function buildSurfaceFragment(shadeDeWidth: number): string {
  return /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  const int MAX_MAPS = ${SURFACE_MAX_MAPS};
  const int GRID_SKIP_CAP = ${SURFACE_GRID_SKIP_CAP};
  /** Sphere-trace step budget per ray — a per-tier uniform (fr-sjff): the
   * preview tier trades steps for frame rate on map-heavy systems whose DE
   * cost the depth clamp can't touch. Tracer-side only, like the loop caps
   * below — the DE bodies stay oracle-mirrored. */
  uniform int uMarchSteps;
  /** Penumbra shadow-ray step budget per hit (per-tier). */
  uniform int uShadowSteps;
  /** Ambient-occlusion probe count along the normal (per-tier). */
  uniform int uAoTaps;
  /** Absolute floor of the cone hit test, as a fraction of the bounding
   * radius (per-tier): the preview accepts coarser hits near the camera,
   * where uPixelEps * t degenerates. */
  uniform float uHitFloor;

  /** Inverse linear part per BASE map (uMapCount live slots; the rest are
   * stale/identity and never read). Kaleidoscope copies are swept, not
   * stored — see uSymOrder. */
  uniform mat3 uInvM[MAX_MAPS];
  /** Inverse translation per map: -inv(M_i) . t_i. */
  uniform vec3 uInvT[MAX_MAPS];
  /** Smallest singular value of each FORWARD map — the certified
   * contraction factor multiplied into the running scale product. */
  uniform float uSigmaMin[MAX_MAPS];
  /** sRGB 0..1 base color per map slot (keyed to base maps caller-side). */
  uniform vec3 uMapColor[MAX_MAPS];
#if SURFACE_FOLDS
  /** Fold-branch sweep (fr-5rvk), compiled in only for systems with
   * pure-fold maps (the SURFACE_FOLDS define; affine systems keep the
   * ladder bodies verbatim). Frontier width, from the oracle's measured
   * SURFACE_FOLD_BEAM_WIDTH. */
  const int FOLD_W = ${SURFACE_FOLD_BEAM_WIDTH};
  /** Per-map fold data + the orbit-trap coordinate uTrapIndex carries in
   * the affine variant (folded in here so the swap is uniform-budget
   * neutral): (foldKind 0..3, 1/w signed, |w|*sigmaMin, trapIndex). */
  uniform vec4 uFoldParams[MAX_MAPS];
#else
  /** Per-slot palette coordinate in [0, 1] for the orbit trap
   * (CPU-precomputed from each slot's base-map index). */
  uniform float uTrapIndex[MAX_MAPS];
#endif
  uniform int uMapCount;
  /** Kaleidoscope sectors swept around every base map (fr-x029; >= 1).
   * 1 leaves the sweep a single pass with no rotation, which is what keeps
   * non-symmetric systems bit-identical to the pre-sweep tracer. */
  uniform int uSymOrder;
  /** Symmetry axis: 0 = x, 1 = y, 2 = z. */
  uniform int uSymAxis;
  /** cos/sin of ONE forward sector step 2*PI/uSymOrder. Sectors are walked
   * incrementally off this pair, so no per-sector transcendental — and no
   * order-sized uniform table the budget could not carry. */
  uniform vec2 uSymStep;
  /** Bounding-sphere radius R of the RAW attractor (pre final transform). */
  uniform float uBoundingRadius;
  /** Center of the raw attractor's bounding ball (fr-pjqw: the probe-fit
   * near-smallest enclosing ball when it beats the origin ball, else the
   * origin). Every attractor-sphere term below reads
   * length(x - uBoundCenter) - uBoundingRadius; u-space fold geometry and
   * the uVisibleRadius gates stay origin-anchored. The escape-time
   * variant never reads it (its uBoundingRadius is that mode's own
   * bailout radius). */
  uniform vec3 uBoundCenter;
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
  /** Pure-fold final lens (fr-g58b): (foldKind, 1/w, |w|, sigmaMin of the
   * lens's affine part). Alive only under the SURFACE_FOLD_LENS define —
   * the wrapper past the descent bodies enumerates the fold's inverse
   * branches around the UNTOUCHED cores, and the uFinal* trio above is
   * packed IDENTITY so the cores run their no-lens arithmetic verbatim
   * (the oracle's descendLens / foldFinal split). */
  uniform vec4 uLensParams;
  uniform mat3 uLensInvM;
  uniform vec3 uLensInvT;
  /** Escape-time fold render (fr-kltj), alive only under SURFACE_ESCAPE:
   * the FORWARD affine (M, t) of the single fold map and
   * (foldKind, w, |w|·sigma_max(M), unused). The variant replaces the
   * inverse-descent bodies wholesale — see escape-de.ts, the CPU oracle
   * its loop mirrors. */
  uniform mat3 uEscM;
  uniform vec3 uEscT;
  uniform vec4 uEscParams;
  /** Base-color source: 0 = by-transform (uMapColor), 1 = orbit-trap
   * palette, 2 = height ramp, 3 = radius ramp, 4 = orbit rings, 5 = orbit
   * sheets. Sources 1-5 sample uColorLUT. */
  uniform int uColorSource;
  /** Per-level decay of the orbit-trap blend weight (flam3's color speed,
   * fr-rl4b): 0.5 = the classic halving, 0 = pure depth-0 regions, 1 =
   * every level weighs the same. Read by the "palette" source only. */
  uniform float uColorSpeed;
  /** 256x1 RGBA ramp for sources 1-5, built CPU-side by color.ts's ONE
   * ramp definition and uploaded by the scene — no ramp math lands here. */
  uniform sampler2D uColorLUT;
  /** Unit vector pointing from surfaces TOWARD the light. */
  uniform vec3 uLightDir;
  uniform float uAmbient;
  uniform vec3 uCamPos;
  uniform mat4 uInvProjView;
  uniform vec3 uBgTop;
  uniform vec3 uBgBottom;
  /** Angular pixel footprint of the ACTIVE buffer (scene-set per frame):
   * sizes the shading probes (normal offsets, ray dither) to the pixels
   * actually being rendered. NOT the hit test's epsilon — see
   * uAcceptPixelEps. */
  uniform float uPixelEps;
  /** Angular pixel footprint of the FULL-RESOLUTION frame (the settle /
   * capture buffer), scene-set per frame and tier-INDEPENDENT: the march's
   * hit acceptance, the grid's no-hit proof, and the DE's cutoff all run
   * at max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor) in EVERY
   * tier. A tier may coarsen sampling, never acceptance (fr-7xgi): scaling
   * the acceptance epsilon with a preview's smaller buffer let it cross
   * the fold DE's loose-but-valid plateau band (fold-branch region floors
   * measure DE/D as low as 0.13 near fold faces, vs 0.6+ on affine
   * systems), which rendered entire box-face shells as crisp phantom
   * geometry on coarse rungs — solid faces the settle frame then erased,
   * except fold systems settle slowest, so the phantom was what users
   * actually saw. Pinning acceptance to the full-resolution epsilon makes
   * a preview unable to accept any hit the settle frame would reject;
   * measured on the fr-7xgi repro (CPU march emulation, 40-step preview
   * budget): phantom hits 2 -> 0, hole cost 0.4-0.9% of true hits. */
  uniform float uAcceptPixelEps;

  /** Empty-space-skipping grid (fr-55r5 part 2), the CPU-built
   * surface-grid.ts cube uploaded as a 3D texture: each texel is a
   * conservative distance floor good for EVERY point of its cell (DE at
   * the cell center minus the cell's half-diagonal, f32-floored — see
   * that module's validity chain), 0 where no positive floor could be
   * certified. NEAREST-sampled so a lookup reads exactly the cell the
   * point is in — interpolated floors of NEIGHBOR cells would not be
   * valid here. 0 while no grid has arrived (uGridEnabled 0 keeps the
   * march off the placeholder anyway). */
  uniform sampler3D uGridTex;
  /** 1 / (2 * halfExtent) of the grid cube: world point -> texture
   * coordinate is p * uGridInvSpan + 0.5 (the cube is origin-centered,
   * like the traced sphere it covers). */
  uniform float uGridInvSpan;
  /** 1 once a grid for the ACTIVE system is uploaded, else 0. */
  uniform float uGridEnabled;

  in vec2 vUv;
  out vec4 outColor;

  /** Per-pixel dither for the march start so grazing rays don't band. */
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  /** One sector step of the kaleidoscope sweep (the oracle's stepSector):
   * turn a point BACKWARD by 2*PI/uSymOrder about the symmetry axis. That
   * is the transpose of the rotation copy k applies AFTER its base map, so
   * descending through the copy un-rotates first; transposing a single-axis
   * rotation flips the sign of sin alone, which is why one (cos, sin) pair
   * of the FORWARD step drives every sector. */
  vec3 stepSector(vec3 p) {
    float c = uSymStep.x;
    float s = uSymStep.y;
    if (uSymAxis == 0) {
      return vec3(p.x, c * p.y + s * p.z, -s * p.y + c * p.z);
    }
    if (uSymAxis == 1) {
      return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    }
    return vec3(c * p.x + s * p.y, -s * p.x + c * p.y, p.z);
  }

  /** One extra Hutchinson level on a frozen escaped candidate's own inverse
   * image (the oracle's refinedCert): the certificate becomes
   * childScale * max(r - R, min_j sigmaMin_j * (|invMap_j(img)| - R)) —
   * never below the plain childScale * (r - R). fr-beck measured this
   * exact refinement eliminating every march ghost; fr-1z6p ports it here
   * from the 4D tracer, closing the balloon membranes the plain
   * certificates painted across attractor voids. "Every map" means every
   * (sector, base map) pair, which the sweep spells out where the expanded
   * slot list used to (fr-x029). */
  // fr-3c0k's per-step footprint depth cap is deliberately CPU-ONLY
  // (estimateDistance*'s optional footprint parameter). Every GLSL
  // encoding tried — a mutable global as the descent loop bound, and the
  // same global as an in-loop break under a uniform bound — regressed
  // this variant's already-critical Mesa/Iris fold LINK past the browser
  // watchdog (context lost at entry with the VALIDATE_STATUS-false reset
  // debris; bisected on the real driver, fr-096u). A depth-cap PARAMETER
  // threaded through the overloads (an SSA value, not a global) is the
  // credible future encoding.

#if SURFACE_FOLDS
  // The fold variant defines NO refinedCert at all: its descent folds
  // PLAIN certificates (the oracle's descendFold refine=false path). Two
  // reasons, both measured. Correctness: on fold systems the region
  // floors, not refinement, carry the ghost-killing — the harness's
  // base and refined rows are indistinguishable (identical DE/D
  // percentiles, deep-void false hits 0 in both). Compile survival:
  // refinement's inner (sector x map x branch) sweep inlines into the
  // frontier's innermost loop, and Mesa's compiler already dies on this
  // variant without it (Iris Xe: linkProgram stall, empty info log,
  // context lost). The affine variant below keeps the refined discipline
  // unchanged.
#else
  float refinedCert(vec3 img, float r, float childScale) {
    float inner = 1e30;
    vec3 sImg = img;
    for (int k = 0; k < uSymOrder; k++) {
      if (k > 0) {
        sImg = stepSector(sImg);
      }
      for (int j = 0; j < uMapCount; j++) {
        vec3 jImg = uInvM[j] * sImg + uInvT[j];
        inner = min(
          inner,
          uSigmaMin[j] * (length(jImg - uBoundCenter) - uBoundingRadius)
        );
      }
    }
    return childScale * max(r - uBoundingRadius, inner);
  }
#endif

  /**
   * Both surfaceDE overloads mirror estimateDistanceRefined in
   * src/fractal/surface-de.ts (the tested CPU oracle) — any change there
   * must land in BOTH bodies here, and vice versa. Width-4 BEAM
   * inverse-map descent (fr-v6yg's paired A/B chains, plus fr-jkpn's
   * rank-3/4 validity slots; the CPU oracle's beamWidth is always 4 in
   * production builds, so the tracer hardcodes it): each level expands
   * every live chain through every map — every (kaleidoscope sector, base
   * map) pair, swept rather than stored since fr-x029 — and ranks the four
   * smallest-key candidates by chainScale * (r - R) — the best two continue as the
   * next A/B chains, and ranks 3/4 continue as extra chains ONLY while
   * their image stays in-sphere, folding the same REFINED certificate
   * below the moment they escape instead — and folds every OTHER escaped
   * candidate's REFINED certificate (fr-1z6p: refinedCert above) into the
   * running min — so surfaces reachable through a shallower or
   * second-nearest branch are never overshot, and barely-escaped siblings
   * no longer freeze the near-zero plain bounds that false-hit as
   * balloons — while chains A/B keep refining down to their terminal
   * last-value bound (folded PLAIN when a chain escapes past
   * uEscapeRadius or the depth cap ends the loop, exactly as the oracle
   * keeps them; validity chains fold no cap terminal at all — see the
   * promote comment below). Every refined fold site carries the oracle's
   * laziness guard: refinement can only RAISE a certificate, so a fold
   * whose PLAIN certificate already fails to beat the running min is
   * skipped whole — bit-exact, and it caps the inner sweeps at the folds
   * that actually advance the min. See the oracle module's doc for the
   * validity argument and the measured numbers. 1e30 stands in for
   * Infinity (slot-occupancy tests use < 1e29): with sigma products <= 1
   * and real distances O(1..10) it can never be confused for a real
   * bound. This plain overload is the workhorse (march, normals, shadow,
   * occlusion); the out-param overload below adds hit-shading extras.
   *
   * EARLY-OUT CUTOFF (fr-55r5), mirroring the oracle's cutoff parameter.
   * The march needs a HIT DECISION, not a distance, so it passes its own
   * acceptance epsilon and the descent stops as soon as the value it would
   * return is already below it. A cutoff of 0.0 — the zero-argument
   * overload below, every tap that needs the DISTANCE — is the full
   * descent. Above the cutoff the value is the full-descent one (early
   * exits only ever return BELOW it, so step lengths never drift); below
   * it, the full descent would have landed below too, so the hit verdict
   * is identical. Both rest on best only ever FALLING, and on the exits
   * testing it only after a fold has SETTLED it — refined, here — never on
   * the raw plain certificate that gates the fold. Exiting on the latter
   * would re-open the balloon ghosts refinement exists to kill: a
   * barely-escaped sibling dips under the epsilon, the full descent lifts
   * it back above.
   *
   * SPHERE FLOOR (fr-zkt2), mirroring the oracle's own unconditional exit.
   * Once best falls to or below sphereBound the return is already pinned
   * at sphereBound * uFinalSigmaMin — the epilogue clamps through
   * max(best, sphereBound), and best only ever falls, so no later fold
   * can lift the clamp back off sphereBound. The descent therefore exits
   * the instant best <= sphereBound, unconditionally — no cutoff
   * involved. Unlike the fr-55r5 exit above, this one is value-exact for
   * EVERY caller, including a cutoff of 0.0 (the zero-argument overload
   * below): it returns the full-descent value bit-for-bit, always.
   * Live on anisotropic maps (certificates lose a sigmaMin/sigmaMax
   * factor per level and dip under the floor); provably dead on
   * isotropic invariant-ball maps, where certificates never dip (see
   * the oracle's paragraph).
   *
   * FOLD SYSTEMS (fr-5rvk) compile the WIDE-FRONTIER variant instead —
   * the oracle's descendFold, selected by the SURFACE_FOLDS define at
   * system-set time so the affine ladder text above stays byte-for-byte
   * what shipped: a FOLD_W-slot frontier replaces the four ladder slots
   * (fold maps spawn 27/3/81 branch candidates and whole sets stay
   * in-sphere at once), every candidate carries a REGION FLOOR (the
   * strongest scale * |w| * regionDist certificate of its branch
   * history) that its keys, certificates and cap terminals are raised
   * to, tuples dropped off the frontier fold their floor (the drop-fold
   * rule — validity at any width), and candidates whose floor already
   * reaches the running min are pruned outright. Two deliberate
   * departures from the affine variant's shape, both forced by real
   * drivers (Mesa on Iris Xe died compiling the first cut — linkProgram
   * stall, empty info log, lost context): the frontier is stored
   * UNSORTED with a tracked worst slot (one indexed write + a
   * fixed-bound read-only rescan, where the sorted insert-shift's
   * data-dependent chains killed the compiler), and the variant marches
   * the oracle's refine=false path — PLAIN certificates, no refinedCert
   * at all (see the fold refinedCert note above: on fold systems the
   * region floors carry the ghost-killing, base and refined measure
   * indistinguishable). See descendFold's doc for the measured numbers.
   */
#if SURFACE_ESCAPE
  /**
   * Escape-time fold DE (fr-kltj), mirroring escape-de.ts's
   * estimateEscapeDistance: iterate the single fold map FORWARD from the
   * query with a scalar running derivative (the Buddhi/Rrrola Mandelbox
   * form), DE = |v| / dr. This variant REPLACES the inverse-descent
   * bodies wholesale — the whole #else arm below is not compiled — and
   * it is phone-cheap: uMaxDepth (30 full, preview-clamped) iterations of
   * branchless folds per evaluation, no frontier, no branches. cutoff
   * is accepted for signature parity and ignored: the loop is fixed-cost,
   * so the full value is always returned, trivially satisfying the
   * fr-55r5 contract (every return IS the cutoff-0 result).
   */
  float surfaceDE(vec3 p, float cutoff) {
    vec3 v = p;
    float dr = 1.0;
    float r = length(v);
    int kind = int(uEscParams.x);
    for (int i = 0; i < uMaxDepth; i++) {
      if (r > uBoundingRadius) {
        break;
      }
      vec3 y = uEscM * v + uEscT;
      float localL = 1.0;
      if (kind != 2) {
        // The box fold (boxfold + mandelbox): per-axis reflections,
        // local factor 1.
        y = clamp(y, -1.0, 1.0) * 2.0 - y;
      }
      if (kind != 1) {
        // The sphere fold (spherefold + mandelbox): variations.ts's
        // sphereFoldFactor, which IS the local conformal factor.
        float f = 1.0 / clamp(dot(y, y), 0.25, 1.0);
        y *= f;
        localL = f;
      }
      v = uEscParams.y * y;
      dr = uEscParams.z * localL * dr + 1.0;
      r = length(v);
    }
    return r / dr;
  }

  float surfaceDE(vec3 p) {
    return surfaceDE(p, 0.0);
  }

  /** Hit-shading overload: the same loop, with the classic escape-time
   * extras — trap is the escape fraction (the canonical Mandelbox palette
   * coordinate), rings/sheets are the orbit's closest radial / y-plane
   * approaches, the same trap vocabulary the IFS variants feed the shared
   * color sources. firstChoice is always 0 (one map). */
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets
  ) {
    firstChoice = 0;
    rings = 1.0;
    sheets = 1.0;
    vec3 v = p;
    float dr = 1.0;
    float r = length(v);
    int kind = int(uEscParams.x);
    int escapedAt = uMaxDepth;
    for (int i = 0; i < uMaxDepth; i++) {
      if (r > uBoundingRadius) {
        escapedAt = i;
        break;
      }
      vec3 y = uEscM * v + uEscT;
      float localL = 1.0;
      if (kind != 2) {
        y = clamp(y, -1.0, 1.0) * 2.0 - y;
      }
      if (kind != 1) {
        float f = 1.0 / clamp(dot(y, y), 0.25, 1.0);
        y *= f;
        localL = f;
      }
      v = uEscParams.y * y;
      dr = uEscParams.z * localL * dr + 1.0;
      r = length(v);
      rings = min(rings, r / uBoundingRadius);
      sheets = min(sheets, abs(v.y) / uBoundingRadius);
    }
    trap = float(escapedAt) / float(uMaxDepth);
    rings = clamp(rings, 0.0, 1.0);
    sheets = clamp(sheets, 0.0, 1.0);
    return r / dr;
  }
#else

#if SURFACE_FOLD_LENS
  // Compile every descent body below under a CORE name: the fold-lens
  // wrapper past the hit variants owns the public surfaceDE overloads and
  // calls these once per lens branch (fr-g58b; the oracle's descendLens).
  // With the define off this block vanishes and the bodies keep their
  // shipped names, untouched.
  #define surfaceDE surfaceDECore
#endif

#if SURFACE_FOLDS
${foldDescentGlsl("surfaceDE", "FOLD_W")}${foldProbeGlsl(shadeDeWidth)}
#else
  float surfaceDE(vec3 p, float cutoff) {
    vec3 q = uFinalInvM * p + uFinalInvT;
    float startR = length(q - uBoundCenter);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    // The value below which this descent may stop (the oracle's bailBelow).
    // -1e30 disables the test: a cutoff of 0.0, and a depth-0 sphere floor
    // that already holds the answer at or above the cutoff no matter how
    // far best falls, since the floor is what the return clamps to. (That
    // sphere floor case now has its own unconditional exit — fr-zkt2,
    // below — that fires the moment best reaches it, cutoff or not.)
    float bailBelow =
      (cutoff > 0.0 && sphereBound * uFinalSigmaMin < cutoff) ? cutoff : -1e30;
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
    // Validity chains (fr-jkpn): they hold the level's rank-3/4
    // candidates ONLY while their points are in-sphere, and carry no R
    // field — unlike A/B they never fold a terminal (see past the loop),
    // and expansion re-derives every child radius, so the selection
    // radius is dead weight once occupancy is decided.
    vec3 v1Q = vec3(0.0);
    float v1Scale = 1.0;
    bool v1Live = false;
    vec3 v2Q = vec3(0.0);
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
      vec3 c1Q = vec3(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
      float c2Key = 1e30;
      vec3 c2Q = vec3(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
      // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
      // by everything the top-2 ladder evicts, so the pair holds exactly
      // the level's third- and fourth-smallest keys.
      float c3Key = 1e30;
      vec3 c3Q = vec3(0.0);
      float c3Scale = 1.0;
      float c3R = 0.0;
      float c3Cert = 0.0;
      float c4Key = 1e30;
      vec3 c4Q = vec3(0.0);
      float c4Scale = 1.0;
      float c4R = 0.0;
      float c4Cert = 0.0;
      for (int c = 0; c < 4; c++) {
        vec3 pQ = vec3(0.0);
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
        // Sector sweep (fr-x029): the chain point turns one step per
        // kaleidoscope sector and every BASE map is applied to it there, so
        // the candidates — and their SECTOR-MAJOR enumeration order, the
        // order the expanded slot list was built in — are exactly the ones
        // the expansion produced. The ladders below therefore break ties
        // the same way, and the beam, the validity slots and the cutoff
        // exits see an unchanged stream. See the oracle module's symmetry
        // section for why a single wedge FOLD would not be sound here.
        vec3 sQ = pQ;
        for (int k = 0; k < uSymOrder; k++) {
          if (k > 0) {
            sQ = stepSector(sQ);
          }
          for (int j = 0; j < uMapCount; j++) {
            vec3 img = uInvM[j] * sQ + uInvT[j];
            float r = length(img - uBoundCenter);
            float key = pScale * (r - uBoundingRadius);
            float childScale = pScale * uSigmaMin[j];
            float cert = childScale * (r - uBoundingRadius);
            // Exactly one tuple leaves the top-2 ladder per candidate — the
            // displaced runner-up, or the candidate itself. It spills into
            // the rank-3/4 ladder or folds below; empty-slot sentinels flow
            // through both harmlessly (key 1e30 never inserts, r = 0 never
            // folds).
            float eKey = key;
            vec3 eQ = img;
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
              vec3 tQ = c4Q;
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
              vec3 tQ = c4Q;
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
            // their REFINED certificate (fr-1z6p: one extra Hutchinson
            // level closes the barely-escaped-sibling balloon) — skipped
            // whole when its plain certificate cannot beat the running min
            // anyway (the oracle's laziness guard, bit-exact); an in-sphere
            // tuple carries no positive certificate — it can only get here
            // past FOUR smaller keys, the (shrunken) fr-jkpn residual drop.
            if (eR > uBoundingRadius && eCert < best) {
              best = min(best, refinedCert(eQ, eR, eScale));
              // Cutoff exit (fr-55r5) plus the sphere-floor pin (fr-zkt2):
              // the folded certificate is FINALIZED (already refined),
              // and best only falls from here. Once best is at or below
              // sphereBound the return is already pinned at sphereBound *
              // uFinalSigmaMin no matter how much further best still
              // falls, so that case exits unconditionally; short of it,
              // the settled verdict against the caller's cutoff means the
              // rest of the descent cannot lift it back either.
              if (best <= sphereBound || best * uFinalSigmaMin < bailBelow) {
                return max(best, sphereBound) * uFinalSigmaMin;
              }
            }
          }
        }
      }
      // Promote: the best candidate continues as chain A, the runner-up
      // as chain B; past the escape radius a candidate folds its terminal
      // and dies instead (deeper refinement cannot improve the min).
      // Ranks 3/4 continue as validity chains ONLY while in-sphere;
      // escaped, they fold the same refined certificate they would have
      // folded without the slots.
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
            best = min(best, refinedCert(c3Q, c3R, c3Scale));
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
            best = min(best, refinedCert(c4Q, c4R, c4Scale));
          }
        } else {
          v2Q = c4Q;
          v2Scale = c4Scale;
          v2Live = true;
        }
      }
      // Cutoff exit (fr-55r5) plus the sphere-floor pin (fr-zkt2), covering
      // the four promote folds above in one test: each either wrote a
      // settled certificate into best (refined at the two validity-slot
      // sites, the deliberately plain escape-radius bound at the other
      // two) or continued a chain, and best only falls from here. Once
      // best is at or below sphereBound the eventual return is already
      // pinned at sphereBound * uFinalSigmaMin, so that case exits
      // unconditionally. Deliberately NOT a break: the terminal bounds
      // past the loop are folds the FULL descent only makes at the depth
      // cap, and folding one here could drop best below a value that
      // descent never reaches.
      if (best <= sphereBound || best * uFinalSigmaMin < bailBelow) {
        return max(best, sphereBound) * uFinalSigmaMin;
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
#endif

${foldValueFormGlsl(shadeDeWidth)}

  /**
   * Hit-shading variant: the SAME refined beam descent as the plain
   * overload — keep the two bodies in lockstep, both mirror
   * estimateDistanceRefined — plus tracer-side extras that are NOT part
   * of the CPU oracle's distance contract (surface-de.ts mirrors
   * distance only). firstChoice is the depth-0 winning candidate's map,
   * keying by-transform color (identical to the old greedy pick: level 0
   * has one chain at scale 1, so the selection key ranks by radius
   * alone). trap is a flame-style structural blend of the winning
   * candidates' palette coordinates, accumulated TOP-DOWN with
   * geometrically decaying weight (level d weighs uColorSpeed^d,
   * normalized at the end; 0.5 is the classic decay): the depth-0 choice
   * — WHICH top-level copy of the attractor the hit sits in — dominates
   * the final coordinate, matching flam3's convention where the
   * LAST-applied transform dominates a plotted point's color (descent
   * order is application order reversed, so descent level 0 is the most
   * significant digit). The previous blend ran the recurrence
   * deepest-first — address digits that vary sub-pixel, which rendered
   * as per-pixel palette noise with no distinguishable color regions
   * (fr-gt9i). rings is the classic geometric orbit trap (fr-rl4b): the
   * winning chain's closest radial approach |image|/R across the
   * descent, min-tracked exactly where the trap blend samples — radial
   * shells in raw attractor space that follow the fractal's own
   * structure. sheets is rings' plane-trap sibling: the winning chain's
   * closest approach |image.y|/R to the attractor frame's y = 0 plane,
   * min-tracked the same way — nested laminar bands cutting across the
   * structure. (An escape-depth extra was tried in this slot first and
   * swapped out pre-release: on uniform-contraction systems the escape
   * level is pinned by the hit epsilon, not local structure, and it
   * rendered one flat hue.) It follows the per-level best candidate and
   * stops when every chain has escaped. Called ONCE per hit; the march
   * itself uses the plain overload.
   *
   * The SURFACE_FOLDS variant runs the same wide frontier as the plain
   * overload (no cutoff — full descent, mirroring the affine pair) and
   * reads its shading extras off a per-level BEST-CANDIDATE tracker:
   * the smallest floored key among every enumerated candidate, exactly
   * the tuple the affine ladders surface as c1 — including candidates
   * the frontier then prunes or escape-folds, which the affine c1 also
   * admits (its escape check happens at promote time).
   */
#if SURFACE_FOLDS
  /** Fold-variant hit shading: a GREEDY single-chain fold descent — at
   * each level the smallest floored-key candidate over every (sector,
   * base map, fold branch) triple is the tuple the affine body surfaces
   * as c1, and the chain follows it. No frontier arrays on purpose: this
   * overload only feeds colors (main() discards its return value — the
   * march already owns the hit), a second full frontier body is what
   * pushed Mesa's compiler over the edge, and a width-1 color pick
   * diverging from the width-12 march near beam ties is a shading
   * nuance, not a validity concern. The return value is the depth-0
   * sphere bound, kept only for signature parity with the affine
   * overload. */
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets
  ) {
    vec3 q = uFinalInvM * p + uFinalInvT;
    firstChoice = 0;
    trap = 0.0;
    rings = 1.0;
    sheets = 1.0;
    float trapAcc = 0.0;
    float trapNorm = 0.0;
    float trapW = 1.0;
    vec3 chQ = q;
    float chScale = 1.0;
    float chFloor = 0.0;
    bool live = true;
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (!live) {
        break;
      }
      float lbKey = 1e30;
      int lbMap = 0;
      float lbR = 0.0;
      float lbAbsY = 0.0;
      vec3 lbQ = vec3(0.0);
      float lbScale = 1.0;
      float lbFloor = 0.0;
      float pScale = chScale;
      float pFloor = chFloor;
      vec3 sQ = chQ;
      for (int k = 0; k < uSymOrder; k++) {
        if (k > 0) {
          sQ = stepSector(sQ);
        }
        for (int j = 0; j < uMapCount; j++) {
          vec4 fp = uFoldParams[j];
          int kind = int(fp.x);
          int branchCount =
            kind == 0 ? 1 : (kind == 1 ? 27 : (kind == 2 ? 3 : 81));
          float absW = fp.z / uSigmaMin[j];
          vec3 u = vec3(0.0);
          float ru = 0.0;
          vec3 pre0 = vec3(0.0);
          vec3 pre1 = vec3(0.0);
          vec3 pre2 = vec3(0.0);
          vec3 dUp = vec3(0.0);
          vec3 dDn = vec3(0.0);
          vec3 v = vec3(0.0);
          float sfSigma = 1.0;
          float sfRd = 0.0;
          if (kind != 0) {
            u = sQ * fp.y;
            if (kind == 1) {
              pre0 = u;
              pre1 = 2.0 - u;
              pre2 = -2.0 - u;
              dUp = max(u - 1.0, 0.0);
              dDn = max(-1.0 - u, 0.0);
            } else {
              ru = length(u);
            }
          }
          for (int b = 0; b < branchCount; b++) {
            vec3 img;
            float branchSigma;
            float branchRd = 0.0;
            if (kind == 0) {
              img = uInvM[j] * sQ + uInvT[j];
              branchSigma = uSigmaMin[j];
            } else {
              if (kind == 2 || (kind == 3 && b % 27 == 0)) {
                int s = kind == 2 ? b : b / 27;
                if (s == 0) {
                  v = u;
                  sfSigma = 1.0;
                  sfRd = max(1.0 - ru, 0.0);
                } else if (s == 1) {
                  v = 0.25 * u;
                  sfSigma = 4.0;
                  sfRd = max(ru - 2.0, 0.0);
                } else {
                  if (ru < ${SPHEREFOLD_MID_MIN_R}) {
                    if (kind == 3) {
                      b += 26;
                    }
                    continue;
                  }
                  float invR2 = 1.0 / (ru * ru);
                  v = u * invR2;
                  sfSigma = ru;
                  sfRd = max(max(1.0 - ru, ru - 2.0), 0.0);
                }
                if (kind == 3) {
                  pre0 = v;
                  pre1 = 2.0 - v;
                  pre2 = -2.0 - v;
                  dUp = max(v - 1.0, 0.0);
                  dDn = max(-1.0 - v, 0.0);
                }
              }
              vec3 pre;
              if (kind == 2) {
                pre = v;
                branchRd = sfRd;
              } else {
                int bb = kind == 1 ? b : b % 27;
                int selX = bb % 3;
                int selY = (bb / 3) % 3;
                int selZ = bb / 9;
                pre = vec3(
                  selX == 0 ? pre0.x : (selX == 1 ? pre1.x : pre2.x),
                  selY == 0 ? pre0.y : (selY == 1 ? pre1.y : pre2.y),
                  selZ == 0 ? pre0.z : (selZ == 1 ? pre1.z : pre2.z)
                );
                vec3 dd = vec3(
                  selX == 0 ? max(dUp.x, dDn.x) : (selX == 1 ? dUp.x : dDn.x),
                  selY == 0 ? max(dUp.y, dDn.y) : (selY == 1 ? dUp.y : dDn.y),
                  selZ == 0 ? max(dUp.z, dDn.z) : (selZ == 1 ? dUp.z : dDn.z)
                );
                float boxRd = length(dd);
                branchRd = kind == 1 ? boxRd : max(sfRd, sfSigma * boxRd);
              }
              img = uInvM[j] * pre + uInvT[j];
              branchSigma = fp.z * sfSigma;
            }
            float r = length(img - uBoundCenter);
            float candFloor = pFloor;
            if (branchRd > 0.0) {
              candFloor = max(candFloor, pScale * absW * branchRd);
            }
            float key = pScale * (r - uBoundingRadius);
            if (candFloor > 0.0 && candFloor > key) {
              key = candFloor;
            }
            if (key < lbKey) {
              lbKey = key;
              lbMap = j;
              lbR = r;
              lbAbsY = abs(img.y);
              lbQ = img;
              lbScale = pScale * branchSigma;
              lbFloor = candFloor;
            }
          }
        }
      }
      if (lbKey >= 1e29) {
        break;
      }
      if (depth == 0) {
        firstChoice = lbMap;
      }
      trapAcc += trapW * uFoldParams[lbMap].w;
      trapNorm += trapW;
      trapW *= uColorSpeed;
      rings = min(rings, lbR / uBoundingRadius);
      sheets = min(sheets, lbAbsY / uBoundingRadius);
      if (lbR > uEscapeRadius) {
        live = false;
      } else {
        chQ = lbQ;
        chScale = lbScale;
        chFloor = lbFloor;
      }
    }
    trap = trapNorm > 0.0 ? trapAcc / trapNorm : 0.0;
    rings = clamp(rings, 0.0, 1.0);
    sheets = clamp(sheets, 0.0, 1.0);
    return (length(q - uBoundCenter) - uBoundingRadius) * uFinalSigmaMin;
  }
#else
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets
  ) {
    vec3 q = uFinalInvM * p + uFinalInvT;
    float startR = length(q - uBoundCenter);
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
    // Validity chains (fr-jkpn): they hold the level's rank-3/4
    // candidates ONLY while their points are in-sphere, and carry no R
    // field — unlike A/B they never fold a terminal (see past the loop),
    // and expansion re-derives every child radius, so the selection
    // radius is dead weight once occupancy is decided.
    vec3 v1Q = vec3(0.0);
    float v1Scale = 1.0;
    bool v1Live = false;
    vec3 v2Q = vec3(0.0);
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
      // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
      // by everything the top-2 ladder evicts, so the pair holds exactly
      // the level's third- and fourth-smallest keys.
      float c3Key = 1e30;
      vec3 c3Q = vec3(0.0);
      float c3Scale = 1.0;
      float c3R = 0.0;
      float c3Cert = 0.0;
      float c4Key = 1e30;
      vec3 c4Q = vec3(0.0);
      float c4Scale = 1.0;
      float c4R = 0.0;
      float c4Cert = 0.0;
      for (int c = 0; c < 4; c++) {
        vec3 pQ = vec3(0.0);
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
        // Sector sweep (fr-x029): the chain point turns one step per
        // kaleidoscope sector and every BASE map is applied to it there, so
        // the candidates — and their SECTOR-MAJOR enumeration order, the
        // order the expanded slot list was built in — are exactly the ones
        // the expansion produced. The ladders below therefore break ties
        // the same way, and the beam, the validity slots and the cutoff
        // exits see an unchanged stream. See the oracle module's symmetry
        // section for why a single wedge FOLD would not be sound here.
        vec3 sQ = pQ;
        for (int k = 0; k < uSymOrder; k++) {
          if (k > 0) {
            sQ = stepSector(sQ);
          }
          for (int j = 0; j < uMapCount; j++) {
            vec3 img = uInvM[j] * sQ + uInvT[j];
            float r = length(img - uBoundCenter);
            float key = pScale * (r - uBoundingRadius);
            float childScale = pScale * uSigmaMin[j];
            float cert = childScale * (r - uBoundingRadius);
            // Exactly one tuple leaves the top-2 ladder per candidate — the
            // displaced runner-up, or the candidate itself. It spills into
            // the rank-3/4 ladder or folds below; empty-slot sentinels flow
            // through both harmlessly (key 1e30 never inserts, r = 0 never
            // folds).
            float eKey = key;
            vec3 eQ = img;
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
              vec3 tQ = c4Q;
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
              vec3 tQ = c4Q;
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
            // their REFINED certificate (fr-1z6p: one extra Hutchinson
            // level closes the barely-escaped-sibling balloon) — skipped
            // whole when its plain certificate cannot beat the running min
            // anyway (the oracle's laziness guard, bit-exact); an in-sphere
            // tuple carries no positive certificate — it can only get here
            // past FOUR smaller keys, the (shrunken) fr-jkpn residual drop.
            if (eR > uBoundingRadius && eCert < best) {
              best = min(best, refinedCert(eQ, eR, eScale));
            }
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
            best = min(best, refinedCert(c3Q, c3R, c3Scale));
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
            best = min(best, refinedCert(c4Q, c4R, c4Scale));
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
#endif

#if SURFACE_FOLD_LENS
  #undef surfaceDE
  /**
   * Pure-fold FINAL lens (fr-g58b), mirroring the oracle's descendLens
   * line for line: the visible set is F(A) with F = w*V(M p + t), so each
   * of V's inverse branches seeds one root descent through the untouched
   * cores above (uFinal* is packed identity when this define is on), with
   * the fr-5rvk branch vocabulary — preimage, conformal sigma, region
   * floor — lifted one level to the query. The estimate is the min over
   * branch terms, floored by the visible-set sphere bound. Prunes (region
   * floor vs best, sphere certificate vs best, visible-sphere pin) are
   * value-exact — see the oracle's doc for the argument, and the cutoff
   * contract note there for why inner descents receive
   * min(best, cutoff) / factor.
   */
  float surfaceDE(vec3 p, float cutoff) {
    float visBound = length(p) - uVisibleRadius;
    int kind = int(uLensParams.x);
    float absW = uLensParams.z;
    vec3 u = p * uLensParams.y;
    float best = 1e30;
    float ru = 0.0;
    vec3 pre0 = vec3(0.0);
    vec3 pre1 = vec3(0.0);
    vec3 pre2 = vec3(0.0);
    vec3 dUp = vec3(0.0);
    vec3 dDn = vec3(0.0);
    vec3 v = vec3(0.0);
    float sfSigma = 1.0;
    float sfRd = 0.0;
    if (kind == 1) {
      pre0 = u;
      pre1 = 2.0 - u;
      pre2 = -2.0 - u;
      dUp = max(u - 1.0, 0.0);
      dDn = max(-1.0 - u, 0.0);
    } else {
      ru = length(u);
    }
    int branchCount = kind == 1 ? 27 : (kind == 2 ? 3 : 81);
    for (int b = 0; b < branchCount; b++) {
      if (kind == 2 || (kind == 3 && b % 27 == 0)) {
        int s = kind == 2 ? b : b / 27;
        if (s == 0) {
          v = u;
          sfSigma = 1.0;
          sfRd = max(1.0 - ru, 0.0);
        } else if (s == 1) {
          v = 0.25 * u;
          sfSigma = 4.0;
          sfRd = max(ru - 2.0, 0.0);
        } else {
          if (ru < ${SPHEREFOLD_MID_MIN_R}) {
            // Shell guard (the oracle's): fold the settled shell bound,
            // skip the branch + its box expansion.
            float shellCert = absW * (1.0 - ru);
            if (shellCert < best) {
              best = shellCert;
              if (best <= visBound) {
                return visBound;
              }
              if (cutoff > 0.0 && best < cutoff) {
                return max(best, visBound);
              }
            }
            if (kind == 3) {
              b += 26;
            }
            continue;
          }
          float invR2 = 1.0 / (ru * ru);
          v = u * invR2;
          sfSigma = ru;
          sfRd = max(max(1.0 - ru, ru - 2.0), 0.0);
        }
        if (kind == 3) {
          pre0 = v;
          pre1 = 2.0 - v;
          pre2 = -2.0 - v;
          dUp = max(v - 1.0, 0.0);
          dDn = max(-1.0 - v, 0.0);
        }
      }
      vec3 pre;
      float branchRd;
      if (kind == 2) {
        pre = v;
        branchRd = sfRd;
      } else {
        int bb = kind == 1 ? b : b % 27;
        int selX = bb % 3;
        int selY = (bb / 3) % 3;
        int selZ = bb / 9;
        pre = vec3(
          selX == 0 ? pre0.x : (selX == 1 ? pre1.x : pre2.x),
          selY == 0 ? pre0.y : (selY == 1 ? pre1.y : pre2.y),
          selZ == 0 ? pre0.z : (selZ == 1 ? pre1.z : pre2.z)
        );
        vec3 dd = vec3(
          selX == 0 ? max(dUp.x, dDn.x) : (selX == 1 ? dUp.x : dDn.x),
          selY == 0 ? max(dUp.y, dDn.y) : (selY == 1 ? dUp.y : dDn.y),
          selZ == 0 ? max(dUp.z, dDn.z) : (selZ == 1 ? dUp.z : dDn.z)
        );
        float boxRd = length(dd);
        branchRd = kind == 1 ? boxRd : max(sfRd, sfSigma * boxRd);
      }
      float flr = absW * branchRd;
      if (flr > 0.0 && flr >= best) {
        continue;
      }
      vec3 q = uLensInvM * pre + uLensInvT;
      float factor = absW * sfSigma * uLensParams.w;
      float rq = length(q - uBoundCenter);
      // The core never undercuts its own depth-0 sphere bound, so a branch
      // whose scaled sphere certificate reaches the running min cannot
      // advance it — an exact skip.
      if (factor * (rq - uBoundingRadius) >= best) {
        continue;
      }
      float innerCutoff = cutoff > 0.0 ? min(best, cutoff) / factor : 0.0;
      float term = factor * surfaceDECore(q, innerCutoff);
      term = max(term, flr);
      if (term < best) {
        best = term;
        if (best <= visBound) {
          return visBound;
        }
        if (cutoff > 0.0 && best < cutoff) {
          return max(best, visBound);
        }
      }
    }
    return max(best, visBound);
  }

  float surfaceDE(vec3 p) {
    return surfaceDE(p, 0.0);
  }

  /** Hit-shading overload under the lens: re-run the branch loop tracking
   * the ARGMIN branch's core query, then fetch the shading extras from one
   * core hit call on that winner. Called once per accepted hit; the return
   * value keeps signature parity (main() discards it). */
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets
  ) {
    int kind = int(uLensParams.x);
    float absW = uLensParams.z;
    vec3 u = p * uLensParams.y;
    float best = 1e30;
    float ru = 0.0;
    vec3 pre0 = vec3(0.0);
    vec3 pre1 = vec3(0.0);
    vec3 pre2 = vec3(0.0);
    vec3 dUp = vec3(0.0);
    vec3 dDn = vec3(0.0);
    vec3 v = vec3(0.0);
    float sfSigma = 1.0;
    float sfRd = 0.0;
    if (kind == 1) {
      pre0 = u;
      pre1 = 2.0 - u;
      pre2 = -2.0 - u;
      dUp = max(u - 1.0, 0.0);
      dDn = max(-1.0 - u, 0.0);
    } else {
      ru = length(u);
    }
    // Fallback: the identity-branch query, so a fully pruned loop (only
    // reachable off-surface) still hands the core hit call a sane point.
    vec3 bestQ = uLensInvM * u + uLensInvT;
    int branchCount = kind == 1 ? 27 : (kind == 2 ? 3 : 81);
    for (int b = 0; b < branchCount; b++) {
      if (kind == 2 || (kind == 3 && b % 27 == 0)) {
        int s = kind == 2 ? b : b / 27;
        if (s == 0) {
          v = u;
          sfSigma = 1.0;
          sfRd = max(1.0 - ru, 0.0);
        } else if (s == 1) {
          v = 0.25 * u;
          sfSigma = 4.0;
          sfRd = max(ru - 2.0, 0.0);
        } else {
          if (ru < ${SPHEREFOLD_MID_MIN_R}) {
            if (kind == 3) {
              b += 26;
            }
            continue;
          }
          float invR2 = 1.0 / (ru * ru);
          v = u * invR2;
          sfSigma = ru;
          sfRd = max(max(1.0 - ru, ru - 2.0), 0.0);
        }
        if (kind == 3) {
          pre0 = v;
          pre1 = 2.0 - v;
          pre2 = -2.0 - v;
          dUp = max(v - 1.0, 0.0);
          dDn = max(-1.0 - v, 0.0);
        }
      }
      vec3 pre;
      float branchRd;
      if (kind == 2) {
        pre = v;
        branchRd = sfRd;
      } else {
        int bb = kind == 1 ? b : b % 27;
        int selX = bb % 3;
        int selY = (bb / 3) % 3;
        int selZ = bb / 9;
        pre = vec3(
          selX == 0 ? pre0.x : (selX == 1 ? pre1.x : pre2.x),
          selY == 0 ? pre0.y : (selY == 1 ? pre1.y : pre2.y),
          selZ == 0 ? pre0.z : (selZ == 1 ? pre1.z : pre2.z)
        );
        vec3 dd = vec3(
          selX == 0 ? max(dUp.x, dDn.x) : (selX == 1 ? dUp.x : dDn.x),
          selY == 0 ? max(dUp.y, dDn.y) : (selY == 1 ? dUp.y : dDn.y),
          selZ == 0 ? max(dUp.z, dDn.z) : (selZ == 1 ? dUp.z : dDn.z)
        );
        float boxRd = length(dd);
        branchRd = kind == 1 ? boxRd : max(sfRd, sfSigma * boxRd);
      }
      float flr = absW * branchRd;
      if (flr > 0.0 && flr >= best) {
        continue;
      }
      vec3 q = uLensInvM * pre + uLensInvT;
      float factor = absW * sfSigma * uLensParams.w;
      float rq = length(q - uBoundCenter);
      if (factor * (rq - uBoundingRadius) >= best) {
        continue;
      }
      float term = factor * surfaceDECore(q, 0.0);
      term = max(term, flr);
      if (term < best) {
        best = term;
        bestQ = q;
      }
    }
    return surfaceDECore(bestQ, firstChoice, trap, rings, sheets);
  }
#endif

// Closes SURFACE_ESCAPE's #else arm: everything from the fold-lens rename
// through the lens wrapper exists only when the escape variant is off.
#endif

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
    // with distance), floored so the test can't degenerate at t ~ 0. That
    // same epsilon is handed to the DE as its early-out cutoff (fr-55r5):
    // this test is all the step asks of the descent, so the descent may
    // stop as soon as its bound is provably under it. A returned value at
    // or above the epsilon is the full-descent distance bit for bit, so the
    // step length below never drifts. The march runs the plain DE overload;
    // the hit's coloring extras are fetched once below.
    bool hit = false;
    // Whole-ray budget for grid cell skips, SEPARATE from uMarchSteps
    // (fr-z70m): a skip is one texel read, orders of magnitude cheaper
    // than the descent uMarchSteps exists to bound, and its conservative
    // floor advances far less than the analytic step it stands in for —
    // charging skips against the march budget shrank the ray's REACH,
    // dissolving far/threaded geometry into dropout speckle. Running dry
    // here only falls through to the analytic step: slower, never wrong.
    int gridSkips = GRID_SKIP_CAP;
    for (int i = 0; i < uMarchSteps; i++) {
      if (t > tFar) {
        break;
      }
      // Acceptance epsilon: tier-independent by design — see
      // uAcceptPixelEps (fr-7xgi).
      float eps = max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor);
      // Empty-space skip (fr-55r5 part 2): texture reads against the
      // precomputed grid before paying a descent. The stored floor bounds
      // the distance from ANYWHERE in the sample's cell (surface-grid.ts's
      // validity chain), so a step of g cannot cross the surface — and a
      // floor above eps also proves this sample is no hit, so the analytic
      // DE has nothing to add. Cells outside the grid's certified sphere
      // store 0 and fall through; uStepScale damps the step exactly as the
      // analytic path damps its own, since the floors inherit the same
      // probed-bounding-radius margins the damping exists for. Consecutive
      // skips drain in this inner walk — the same read/compare/step
      // sequence the outer \`continue\` used to produce, bit for bit — so
      // they spend gridSkips, not analytic march steps (fr-z70m).
      if (uGridEnabled > 0.5) {
        for (; gridSkips > 0; gridSkips--) {
          float g =
            texture(uGridTex, (ro + rd * t) * uGridInvSpan + 0.5).r;
          if (g <= eps) {
            break;
          }
          t += g * uStepScale;
          if (t > tFar) {
            break;
          }
          eps = max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor);
        }
        if (t > tFar) {
          break;
        }
      }
      // fr-3c0k's per-step cone-footprint depth cap runs CPU-side only —
      // see the note above the descent bodies for the measured Mesa link
      // cliff that keeps it out of this shader.
      float d = surfaceDE(ro + rd * t, eps);
      if (d < eps) {
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
    // color.ts's ONE ramp definition — no ramp math lands here; height and
    // radius normalize against the visible bounding sphere, the world-space
    // frame the tracer already lives in; rings and sheets arrive
    // pre-normalized from the descent.
    vec3 base;
    if (uColorSource == 0) {
      base = uMapColor[clamp(firstChoice, 0, uMapCount - 1)];
    } else {
      float u;
      if (uColorSource == 1) {
        u = trap;
      } else if (uColorSource == 2) {
        u = clamp(pos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0);
      } else if (uColorSource == 3) {
        u = clamp(length(pos) / uVisibleRadius, 0.0, 1.0);
      } else if (uColorSource == 4) {
        u = rings;
      } else {
        u = sheets;
      }
      base = texture(uColorLUT, vec2(u, 0.5)).rgb;
    }

    // Soft shadow: classic DE penumbra toward the light — the shadow ray's
    // closest approach to a surface, sharpened by 8/ts, starting just off
    // the surface to dodge self-shadowing. Leaving the bounding sphere
    // means fully lit from there on, and near-black penumbras end early.
    float shadow = 1.0;
    float ts = h * 2.0;
    for (int i = 0; i < uShadowSteps; i++) {
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
    // traveled inside the bounding sphere — ~0.38 haze at the far side (a
    // full 2R chord), a depth cue matching the explorer's fog feel
    // (constants tuned by eye).
    float fog =
      1.0 - exp(-0.12 * pow((t - tEnter) / max(uVisibleRadius, 1.0e-6), 2.0));
    col = mix(col, background, clamp(fog, 0.0, 1.0));

    outColor = vec4(col, 1.0);
  }
`;
}

/** The one shipped fragment source, at the module-load-resolved probe
 * width. */
const SURFACE_FRAGMENT = buildSurfaceFragment(resolveShadeDeWidth());

/**
 * Per-tier march/shading budgets (fr-sjff): map-heavy systems (Menger's 20
 * flat maps, high-order kaleidoscopes — whose sectors cost no slots since
 * fr-x029 but still cost inverse applications) pay per DE CALL, which the
 * preview depth clamp can't reduce — so the preview also trims how many DE
 * calls a pixel can spend. All tracer-side (march loop, shadow loop, AO
 * taps, hit-test floor): none of these appear in the CPU oracle's distance
 * contract, so the oracle-mirrored DE bodies are untouched.
 *
 * The full-tier march budget was born at 96 and moved to 160 by fr-z70m:
 * rays that thread gaps in near geometry or graze a face at a shallow
 * angle legitimately need well over 96 analytic steps at close-up eps, and
 * exhaustion painted background through whole regions of standing geometry
 * (view-dependent dropout speckle — the measured tail: 0.80% of one worst
 * pose's true hits lost at 96, 0.00% at 160 on sierpinski; menger 0.27% ->
 * 0.02%). Cost is bounded where it matters: every full-tier submission is
 * already sliced to measured GPU time by the strip planner, and ordinary
 * rays exit on hit or sphere-exit long before either cap.
 */
export const SURFACE_FULL_MARCH_STEPS = 160;
export const SURFACE_PREVIEW_MARCH_STEPS = 40;
export const SURFACE_FULL_SHADOW_STEPS = 32;
export const SURFACE_PREVIEW_SHADOW_STEPS = 12;
export const SURFACE_FULL_AO_TAPS = 5;
export const SURFACE_PREVIEW_AO_TAPS = 3;
/** Cone hit-test floor as a fraction of the bounding radius. The preview's
 * is coarser so close-up frames (where uPixelEps * t degenerates and every
 * ray is near-surface) accept early instead of burning the whole march
 * budget per pixel. */
export const SURFACE_FULL_HIT_FLOOR = 1.0e-5;
export const SURFACE_PREVIEW_HIT_FLOOR = 2.0e-4;

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
/** The sampler state every uploaded empty-space grid needs: NEAREST both
 * ways (a texel's floor is valid only for its OWN cell — interpolating
 * neighbors' floors is not a bound, see surface-grid.ts), edge clamping
 * (the march never leaves the cube, but a clamped read of a border cell is
 * at worst that cell's own valid floor), single-channel float. */
export function configureSurfaceGridTexture(
  texture: THREE.Data3DTexture,
): void {
  texture.format = THREE.RedFormat;
  texture.type = THREE.FloatType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
}

/** A 1x1x1 zero-floor placeholder so the material compiles complete before
 * (and independently of) any real grid upload — a zero floor never skips,
 * so even a stray enabled read would fall through to the analytic DE. */
export function emptySurfaceGridTexture(): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(new Float32Array(1), 1, 1, 1);
  configureSurfaceGridTexture(texture);
  return texture;
}

/** The grid uniform trio {@link createSurfaceMaterial} seeds and
 * {@link setSurfaceGrid} / {@link setSurfaceSystem} maintain. */
function surfaceGridUniforms(): Record<string, THREE.IUniform> {
  return {
    uGridTex: { value: emptySurfaceGridTexture() },
    uGridInvSpan: { value: 1 },
    uGridEnabled: { value: 0 },
  };
}

/**
 * Point the march at a freshly uploaded empty-space grid (fr-55r5 part 2) —
 * or back at nothing (`null`, the {@link setSurfaceSystem} reset: a new
 * system's DE invalidates every floor of the old one's grid, so the march
 * must run gridless until the new build lands). `halfExtent` is the grid
 * cube's half side (surface-grid.ts's `SurfaceGridSpec`); the caller owns
 * the texture's lifecycle, this only wires uniforms.
 */
export function setSurfaceGrid(
  material: THREE.ShaderMaterial,
  texture: THREE.Data3DTexture | null,
  halfExtent = 1,
): void {
  const u = material.uniforms;
  if (texture) {
    u.uGridTex.value = texture;
    u.uGridInvSpan.value = 1 / (2 * halfExtent);
    u.uGridEnabled.value = 1;
  } else {
    // Back to a fresh zero placeholder rather than leaving the old texture
    // referenced: the sampler binds whatever the uniform holds even with
    // the enable flag down, and a disposed texture would be silently
    // re-uploaded on the next bind.
    u.uGridTex.value = emptySurfaceGridTexture();
    u.uGridInvSpan.value = 1;
    u.uGridEnabled.value = 0;
  }
}

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
      ...surfaceGridUniforms(),
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
      // Fold-variant per-map data (fr-5rvk): (foldKind, 1/w, |w|*sigmaMin,
      // trapIndex). Only the variant selected by the SURFACE_FOLDS define
      // has this uniform active — Three.js ignores entries the compiled
      // program does not use, so both arrays stay packed unconditionally.
      uFoldParams: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector4(0, 1, 1, 0),
        ),
      },
      uMapCount: { value: 0 },
      uSymOrder: { value: 1 },
      uSymAxis: { value: 1 },
      uSymStep: { value: new THREE.Vector2(1, 0) },
      uBoundingRadius: { value: 1 },
      uBoundCenter: { value: new THREE.Vector3() },
      uEscapeRadius: { value: 2 },
      uMaxDepth: { value: 0 },
      uStepScale: { value: 1 },
      uVisibleRadius: { value: 1 },
      uFinalInvM: { value: new THREE.Matrix3() },
      uFinalInvT: { value: new THREE.Vector3() },
      uFinalSigmaMin: { value: 1 },
      // Fold final lens (fr-g58b): inert defaults; alive only under the
      // SURFACE_FOLD_LENS define.
      uLensParams: { value: new THREE.Vector4(0, 1, 1, 1) },
      uLensInvM: { value: new THREE.Matrix3() },
      uLensInvT: { value: new THREE.Vector3() },
      // Escape-time render (fr-kltj): inert defaults; alive only under
      // the SURFACE_ESCAPE define.
      uEscM: { value: new THREE.Matrix3() },
      uEscT: { value: new THREE.Vector3() },
      uEscParams: { value: new THREE.Vector4(0, 1, 1, 0) },
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
      uAcceptPixelEps: { value: 0.002 },
      // Full-tier defaults; the scene overwrites all four per tier
      // (fr-sjff).
      uMarchSteps: { value: SURFACE_FULL_MARCH_STEPS },
      uShadowSteps: { value: SURFACE_FULL_SHADOW_STEPS },
      uAoTaps: { value: SURFACE_FULL_AO_TAPS },
      uHitFloor: { value: SURFACE_FULL_HIT_FLOOR },
    },
    // Which descent bodies are compiled in: SURFACE_FOLDS 0 = the affine
    // ladder pair (byte-for-byte the pre-fr-5rvk shader), 1 = the
    // fold-frontier pair. SURFACE_FOLD_LENS 1 additionally renames the
    // bodies to surfaceDECore and compiles the fold-lens wrapper as the
    // public surfaceDE (fr-g58b). SURFACE_ESCAPE 1 replaces the descent
    // bodies wholesale with the escape-time loop (fr-kltj).
    // setSurfaceSystem/setEscapeSystem flip these when the system's shape
    // changes — rare, session-enter-scale recompiles.
    defines: { SURFACE_FOLDS: 0, SURFACE_FOLD_LENS: 0, SURFACE_ESCAPE: 0 },
    vertexShader: SURFACE_VERTEX,
    // The lens/escape arms are resolved JS-side (resolveVariantArms) so
    // the driver never parses another variant's text — the fold
    // compiler's measured source-size edge. SURFACE_FOLDS stays a
    // driver-side define, exactly as shipped.
    fragmentShader: surfaceFragmentFor(0, 0),
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
 * `de.maps` is BASE maps (fr-x029), so the kaleidoscope rides the three
 * `uSym*` scalars below rather than costing slots. Throws RangeError if
 * `de.maps.length > SURFACE_MAX_MAPS`: callers gate eligibility first, so
 * reaching it is a bug. */
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
  // A new system invalidates every floor of the old system's grid — march
  // gridless until the fresh build lands (fr-55r5 part 2). The caller owns
  // the old texture's disposal.
  setSurfaceGrid(material, null);
  const u = material.uniforms;
  const invM = u.uInvM.value as THREE.Matrix3[];
  const invT = u.uInvT.value as THREE.Vector3[];
  const sigmaMin = u.uSigmaMin.value as number[];
  const mapColor = u.uMapColor.value as THREE.Vector3[];
  const trapIndex = u.uTrapIndex.value as number[];
  const foldParams = u.uFoldParams.value as THREE.Vector4[];
  let hasFolds = false;
  de.maps.forEach((map, j) => {
    const m = map.invM;
    // SurfaceDEMap.invM is ROW-major; Matrix3.set takes row-major arguments
    // and stores column-major internally — exactly the layout the GLSL
    // `mat3 * vec3` product expects, so this is a straight pass-through.
    invM[j].set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    invT[j].set(...map.invT);
    sigmaMin[j] = map.sigmaMin;
    mapColor[j].set(...colors[j]);
    const trap = trapIndices ? trapIndices[j] : 0;
    trapIndex[j] = trap;
    // The fold-variant vec4 carries the trap coordinate in .w so swapping
    // uTrapIndex out keeps the swap uniform-budget neutral.
    foldParams[j].set(map.foldKind, map.foldInvW, map.foldSigma, trap);
    if (map.foldKind !== SURFACE_FOLD_NONE) hasFolds = true;
  });
  // Select the compiled descent pair (fold frontier vs affine ladders)
  // and whether the fold-lens wrapper wraps them (fr-g58b). A define
  // change forces a program rebuild — rare (system-set time, and only
  // when fold-ness actually flips).
  const wantFolds = hasFolds ? 1 : 0;
  const wantLens = de.foldFinal ? 1 : 0;
  if (
    material.defines.SURFACE_FOLDS !== wantFolds ||
    material.defines.SURFACE_FOLD_LENS !== wantLens ||
    material.defines.SURFACE_ESCAPE !== 0
  ) {
    material.defines.SURFACE_FOLDS = wantFolds;
    material.defines.SURFACE_FOLD_LENS = wantLens;
    // A previous escape-time session must hand the descent bodies back.
    material.defines.SURFACE_ESCAPE = 0;
    material.fragmentShader = surfaceFragmentFor(0, wantLens);
    material.needsUpdate = true;
  }
  u.uMapCount.value = de.maps.length;
  // The kaleidoscope the descent sweeps instead of expanding (fr-x029):
  // three scalars where every extra order used to cost `maps.length` slots.
  u.uSymOrder.value = de.symmetry.order;
  u.uSymAxis.value = SYM_AXIS_CODE[de.symmetry.axis];
  (u.uSymStep.value as THREE.Vector2).set(
    de.symmetry.stepCos,
    de.symmetry.stepSin,
  );
  u.uBoundingRadius.value = de.boundingRadius;
  (u.uBoundCenter.value as THREE.Vector3).set(...de.boundCenter);
  u.uEscapeRadius.value = de.escapeRadius;
  u.uMaxDepth.value = de.maxDepth;
  u.uStepScale.value = de.stepScale;
  u.uVisibleRadius.value = de.visibleBoundingRadius;
  // The final lens must be RESET when absent — the previous system may have
  // had one, and identity / zero / 1 is the shader's "no lens" encoding.
  // With a FOLD lens (fr-g58b) the identity encoding is deliberate and
  // load-bearing: the descent cores must run their no-lens arithmetic
  // (the oracle keeps final null whenever foldFinal is set), and the
  // wrapper compiled by SURFACE_FOLD_LENS applies the real lens from
  // uLens* instead.
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
  const lensM = u.uLensInvM.value as THREE.Matrix3;
  const lensT = u.uLensInvT.value as THREE.Vector3;
  if (de.foldFinal) {
    const lens = de.foldFinal;
    (u.uLensParams.value as THREE.Vector4).set(
      lens.foldKind,
      lens.invW,
      lens.absW,
      lens.sigmaMin,
    );
    const m = lens.invM;
    lensM.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    lensT.set(...lens.invT);
  } else {
    (u.uLensParams.value as THREE.Vector4).set(0, 1, 1, 1);
    lensM.identity();
    lensT.set(0, 0, 0);
  }
}

/** March step fudge for the escape-time variant: the scalar-derivative
 * estimate is the field's standard heuristic, not a certified lower bound
 * — every published Mandelbox marcher damps its steps; 0.7 is the common
 * conservative pick. */
const ESCAPE_STEP_SCALE = 0.7;

/**
 * Resolve the SURFACE_ESCAPE / SURFACE_FOLD_LENS preprocessor arms
 * JS-SIDE, so the source each variant hands the driver contains ONLY its
 * own bodies. Measured necessity, not tidiness: Mesa's compiler sits on a
 * knife's edge with the fold-frontier variant — the shipped ~68KB source
 * links (in ~25s), but the SAME compiled tokens preceded by the
 * lens/escape variants' preprocessor-dead text pushed the source past
 * 80KB and the compile crashed outright, twice per session (empty info
 * log, lost context — the exact fr-5rvk failure signature, resurrected
 * by nothing but source growth). SURFACE_FOLDS stays a driver-side
 * define, exactly as shipped and measured. Handles the two names'
 * `#if` / `#else` / `#endif` with proper nesting bookkeeping for every
 * OTHER `#if`-family directive encountered inside their arms (those
 * lines pass through untouched for the driver).
 */
function resolveVariantArms(
  source: string,
  values: Record<string, number>,
): string {
  const out: string[] = [];
  // Each frame: whether this level is one of OURS, and whether lines at
  // this level are emitted (parent activity folded in).
  const stack: { mine: boolean; active: boolean }[] = [];
  const emitting = () => stack.every((f) => f.active);
  for (const line of source.split("\n")) {
    const directive = /^\s*#(if|ifdef|ifndef|else|elif|endif)\b(.*)$/.exec(
      line,
    );
    if (directive) {
      const [, kind, rest] = directive;
      if (kind === "if") {
        const name = rest.trim();
        if (name in values) {
          stack.push({ mine: true, active: emitting() && values[name] !== 0 });
          continue; // our directive lines never reach the driver
        }
        stack.push({ mine: false, active: emitting() });
        if (emitting()) out.push(line);
        continue;
      }
      if (kind === "ifdef" || kind === "ifndef") {
        stack.push({ mine: false, active: emitting() });
        if (emitting()) out.push(line);
        continue;
      }
      const top = stack[stack.length - 1];
      if (top?.mine) {
        if (kind === "else") {
          const parent = stack.slice(0, -1).every((f) => f.active);
          top.active = parent && !top.active;
        } else if (kind === "endif") {
          stack.pop();
        }
        // elif never appears in our arms.
        continue;
      }
      if (kind === "endif") stack.pop();
      if (emitting() || kind === "endif") {
        // Non-our directives pass through whenever their region emits;
        // the emitting() check above already reflects the post-pop state
        // for endif.
        if (stack.every((f) => f.active)) out.push(line);
      }
      continue;
    }
    if (emitting()) out.push(line);
  }
  return out.join("\n");
}

/** Compose the fragment source for a variant selection — the driver only
 * ever sees SURFACE_FOLDS conditionals (see resolveVariantArms). `source`
 * defaults to the module's assembled fragment; tests pass their own
 * width-parameterized builds (fr-zqu8). */
export function surfaceFragmentFor(
  escape: number,
  lens: number,
  source: string = SURFACE_FRAGMENT,
): string {
  return resolveVariantArms(source, {
    SURFACE_ESCAPE: escape,
    SURFACE_FOLD_LENS: lens,
  });
}

/**
 * Pack an {@link EscapeDE} (fr-kltj) and flip the material onto the
 * escape-time variant. The IFS-side uniforms the shared marcher still
 * reads — bounding/visible radii, uMaxDepth (the iteration budget the
 * preview tier clamps through previewMaxDepth), step scale, slot-0 color
 * for the by-transform source — are packed to the escape set's values;
 * everything descent-specific (maps, symmetry, lenses, grid) is reset to
 * inert, and no grid is ever uploaded for this mode (the empty-space
 * chain's validity argument is IFS-specific).
 */
export function setEscapeSystem(
  material: THREE.ShaderMaterial,
  de: EscapeDE,
  color: Vec3,
): void {
  setSurfaceGrid(material, null);
  const u = material.uniforms;
  const m = de.m;
  (u.uEscM.value as THREE.Matrix3).set(
    m[0],
    m[1],
    m[2],
    m[3],
    m[4],
    m[5],
    m[6],
    m[7],
    m[8],
  );
  (u.uEscT.value as THREE.Vector3).set(...de.t);
  (u.uEscParams.value as THREE.Vector4).set(
    de.foldKind,
    de.w,
    de.derivGrowth,
    0,
  );
  (u.uMapColor.value as THREE.Vector3[])[0].set(...color);
  (u.uTrapIndex.value as number[])[0] = 0;
  u.uMapCount.value = 1;
  u.uSymOrder.value = 1;
  u.uSymAxis.value = 1;
  (u.uSymStep.value as THREE.Vector2).set(1, 0);
  u.uBoundingRadius.value = de.boundingRadius;
  u.uEscapeRadius.value = de.boundingRadius * 2;
  u.uMaxDepth.value = ESCAPE_TIME_ITERATIONS;
  u.uStepScale.value = ESCAPE_STEP_SCALE;
  u.uVisibleRadius.value = de.boundingRadius;
  (u.uFinalInvM.value as THREE.Matrix3).identity();
  (u.uFinalInvT.value as THREE.Vector3).set(0, 0, 0);
  u.uFinalSigmaMin.value = 1;
  (u.uLensParams.value as THREE.Vector4).set(0, 1, 1, 1);
  (u.uLensInvM.value as THREE.Matrix3).identity();
  (u.uLensInvT.value as THREE.Vector3).set(0, 0, 0);
  if (
    material.defines.SURFACE_ESCAPE !== 1 ||
    material.defines.SURFACE_FOLDS !== 0 ||
    material.defines.SURFACE_FOLD_LENS !== 0
  ) {
    material.defines.SURFACE_ESCAPE = 1;
    material.defines.SURFACE_FOLDS = 0;
    material.defines.SURFACE_FOLD_LENS = 0;
    material.fragmentShader = surfaceFragmentFor(1, 0);
    material.needsUpdate = true;
  }
}
