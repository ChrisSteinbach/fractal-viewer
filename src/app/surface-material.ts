import * as THREE from "three";
import type { BulbDE } from "../fractal/bulb-de";
import { BULB_ITERATIONS, BULB_STEP_SCALE } from "../fractal/bulb-de";
import type { EscapeDE } from "../fractal/escape-de";
import {
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
} from "../fractal/escape-de";
import {
  SHAPE_TRAP_GEOMETRY_LEVEL_MAX,
  SHAPE_TRAP_NO_CROSSING,
  resolveShapeTrap,
  shapeTrapInvNorm,
} from "../fractal/shape-trap";
import type { ResolvedShapeTrap } from "../fractal/shape-trap";
import {
  SHAPE_MARCH_SAFETY,
  shapeMeshIds,
  shapeSdfSource,
  shapeSpecsMeshIds,
  type ShapeSpec,
} from "../fractal/shapes";
import {
  activeMeshSdfAtlas,
  meshSdfAtlasShaderIndex,
} from "../fractal/mesh-sdf-atlas-cache";
import type { MeshAssetId, MeshSdfAtlas } from "../fractal/mesh-shapes";
import type { SurfaceDE } from "../fractal/surface-de";
import {
  SPHEREFOLD_MID_MIN_R,
  SURFACE_FOLD_BEAM_WIDTH,
  SURFACE_FOLD_NONE,
  SYM_PLANE_CODE,
} from "../fractal/surface-de";
import {
  BACKGROUND_SHAPE_GLSL,
  backgroundShapeSource,
} from "../fractal/background-shape";
import {
  SURFACE_FINISH_GLSL,
  surfaceFinishShadeSource,
} from "../fractal/surface-finish";
import { surfacePatternShadeSource } from "../fractal/surface-pattern-shade";
import {
  CLASSIC_SURFACE_MATERIAL,
  surfaceMaterialLanes,
  type SurfaceMaterialSlots,
} from "../fractal/surface-material-wire";
import type { ShapeTrap, Vec3 } from "../fractal/types";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";
import { SURFACE_TRACE_EXHAUSTED_ALPHA } from "./surface-ray-census";
import { lightDirection } from "./voxel-material";

/**
 * The surface render's GPU sphere-tracer: a full-screen-quad
 * ShaderMaterial that marches camera rays against an analytic distance
 * estimator for the IFS attractor — width-4 beam inverse-map descent with
 * REFINED sibling certificates (the measured ghost-eliminator ported down
 * from the 4D tracer, closing the smooth "balloon" membranes the plain
 * certificates rendered across attractor voids), precomputed by
 * `buildSurfaceDE` (`src/fractal/surface-de.ts`) and packed into
 * fixed-size uniform arrays here — BASE maps only, with kaleidoscope
 * copies swept as sectors around them rather than expanded into slots, so
 * the array budget no longer caps symmetry order. The validity slots ride
 * along too — rank-3/4 candidate chains that stay live only while
 * in-sphere, closing the multi-branch drops width 2 alone still had. Hits
 * are shaded in the solid raymarcher's vocabulary — DE-gradient normals,
 * Lambert diffuse + Blinn-Phong specular, a soft penumbra shadow ray
 * toward the light, DE-probed ambient occlusion — with four base-color
 * sources (by-transform, orbit-trap palette, height ramp, radius ramp; the
 * ramps sample a 256x1 LUT built CPU-side by color.ts's ONE ramp
 * definition) and exponential depth fog toward the backdrop. Rays that
 * miss paint the same dark gradient backdrop as the explorer, so the mode
 * reads as the same scene, surfaced.
 *
 * The GLSL `surfaceDE` mirrors `estimateDistanceRefined` in
 * `surface-de.ts` line for line (the `refine === true` path of its shared
 * descent body) — the tested CPU oracle, the same discipline as `flame.ts`
 * <-> `flame-gpu.ts`. That is TWO compiled variants behind the
 * `SURFACE_FOLDS` define, flipped by `setSurfaceSystem` when the DE's
 * fold-ness changes (a session-set-scale program rebuild): `0` compiles
 * the affine ladder bodies above byte-for-byte as they shipped, `1`
 * compiles fold-frontier bodies mirroring the oracle's `descendFold` — the
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
 * (the WGSL twin's probe-width verdict ported to the fragment path; one
 * text, two names, so the bodies cannot drift). Taps light a hit the
 * full-width march already certified, never decide geometry — the march
 * and hit acceptance stay at FOLD_W. Measured (Iris Xe, real driver, cold
 * Mesa cache, `scripts/shade-width-ab.mjs`): the probe CUT the fold
 * program's ~25s Mesa link 17.9x (25.5-26.4s -> 1.42-1.53s, n=3/arm) —
 * Mesa inlines the width-12 body at every call site, and with the probe
 * only the march still does — which also dissolved the link-watchdog
 * session-death lottery (the A/B's only context losses were baseline-arm,
 * kernel silent throughout). Boxfold-pair settles 509-987ms vs baseline
 * 695-1296ms, settled frames identical within session noise (cross-arm
 * pixel diff == within-arm rerun diff); equal 210s mandelboxKifs windows
 * resolve ~2.3x more frame at width 1, its crease pixels staying
 * march-bound (the fragment path's residual — compute owns those sessions
 * where an adapter exists). `?surfshadewidth=N` overrides the width per
 * session; N = FOLD_W disables the probe and reproduces the pre-probe
 * source byte for byte.
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
 * march-step budget. A skip is one NEAREST texel read — orders of
 * magnitude cheaper than the beam descent `uMarchSteps` exists to bound —
 * and the floors it steps by are deliberately conservative
 * (`surface-grid.ts`: DE at the cell center minus the cell half-diagonal),
 * so a ray threading gaps or grazing a face takes MANY of them where the
 * analytic march would take one large step. The grid's first cut charged
 * every skip against `uMarchSteps`, which SHRANK the march's reach exactly
 * on those rays — far or occlusion-threaded geometry dissolved into
 * per-pixel dropout speckle, worst wherever a view lined grazing faces up
 * (the one-sided erosion the bug's screenshots showed). Exhausting this
 * cap only falls through to the analytic step — never wrong, just slower.
 * 256 clears the worst whole-ray skip count measured across the erosion
 * pose sweeps (189, `scripts/erosion-repro.harness.ts`); doubling it
 * changed nothing measured. */
export const SURFACE_GRID_SKIP_CAP = 256;

/** Compile-time size of the per-map uniform arrays: at ~7 vec4-equivalents
 * per slot (mat3 = 3, plus vec3 + float + vec3 + float), 24 maps stays
 * comfortably under WebGL2's guaranteed 224 fragment uniform vectors.
 *
 * Slots are BASE maps. Kaleidoscope copies used to be expanded into slots
 * of their own, so this budget doubled as a cap on `order * baseMaps` and
 * gated high orders out of the mode; the descent now sweeps sectors around
 * the base maps instead (three scalar uniforms, no slots), so the budget
 * is the bare active-map count at ANY order. The app gates on that count
 * before entering the mode, so {@link setSurfaceSystem}
 * treats overflow as a bug, not a degrade. */
export const SURFACE_MAX_MAPS = 24;

/** Condensation inverse records share the fixed 24-slot map wire. Ordinary
 * recursive maps occupy the prefix and symmetry-expanded C0 emitters are
 * appended; uMapCount remains the recursive count. */
export const SURFACE_MAX_RECORDS = SURFACE_MAX_MAPS;

/** The CPU schedule contract clamps a finite B prefix to five levels. The
 * root ball continues to use the classic uniforms; this is the number of
 * inner (depth 1..k) balls carried only by the resolved schedule arm. */
const SURFACE_MAX_SCHEDULE_DEPTH = 5;

/** Largest positive GLSL `int`, used as the wire sentinel for an unbounded
 * condensation depth band. JavaScript's MAX_SAFE_INTEGER would wrap through
 * WebGL's uniform1i conversion and disable the all-level default. */
export const SURFACE_CONDENSATION_GLSL_DEPTH_MAX = 0x7fffffff;

function condensationShapeKey(shapes: readonly ShapeSpec[]): string {
  return JSON.stringify(shapes);
}

function condensationShapeDispatch(
  shapes: readonly ShapeSpec[],
  fourD: boolean,
): string {
  const fnPrefix = fourD ? "condensation4Sdf" : "condensationSdf";
  const dispatchName = fourD ? "condensation4ShapeSdf" : "condensationShapeSdf";
  const unique: ShapeSpec[] = [];
  const keys = new Map<string, number>();
  for (const shape of shapes) {
    const key = JSON.stringify(shape);
    if (!keys.has(key)) {
      keys.set(key, unique.length);
      unique.push(shape);
    }
  }
  const meshIds = shapeSpecsMeshIds(unique);
  const meshIndex = (id: MeshAssetId): number =>
    meshSdfAtlasShaderIndex(meshIds, id);
  const bodies = unique
    .map((shape, i) =>
      shapeSdfSource(shape, "glsl", `${fnPrefix}${i}`, { meshIndex }),
    )
    .join("\n");
  const choices = unique
    .map(
      (_, i) =>
        `${i === 0 ? "if" : "else if"} (shape == ${i}) return ${fnPrefix}${i}(q);`,
    )
    .join("\n  ");
  const meshHelper = meshIds.length > 0 ? `${shapeMeshSdfGlsl(meshIds)}\n` : "";
  return `${meshHelper}${bodies}\nfloat ${dispatchName}(int shape, vec3 q) {\n  ${choices}\n  return 1.0e30;\n}`;
}

/** GLSL implementation of shapes.ts's external
 * `shapeMeshSdf(catalogIndex, p)` call. There is ONE sampler and ONE manual
 * eight-texel trilinear body no matter how many authored parts reuse a mesh;
 * catalog-specific bounds, spacing and z slab are baked into the dispatch. */
function shapeMeshSdfGlsl(activeIds: readonly MeshAssetId[]): string {
  const atlas = activeMeshSdfAtlas(activeIds);
  const entries = atlas.entries
    .map((entry) => {
      const lo = entry.min.map(glslFloatLit).join(", ");
      const hi = entry.max.map(glslFloatLit).join(", ");
      return `  if (mesh == ${entry.shaderIndex}) return shapeMeshSdfSample(p, vec3(${lo}), vec3(${hi}), ${glslFloatLit(entry.cellSize)}, ${entry.zOffset}, ${entry.resolution});`;
    })
    .join("\n");
  return `uniform highp sampler3D uShapeMeshSdf;
float shapeMeshSdfSample(
  vec3 p,
  vec3 lo,
  vec3 hi,
  float cellSize,
  int zOffset,
  int resolution
) {
  vec3 g = (clamp(p, lo, hi) - lo) / cellSize;
  ivec3 i0 = ivec3(floor(g));
  ivec3 i1 = min(i0 + ivec3(1), ivec3(resolution - 1));
  vec3 f = g - vec3(i0);
  float v000 = texelFetch(uShapeMeshSdf, ivec3(i0.x, i0.y, zOffset + i0.z), 0).r;
  float v100 = texelFetch(uShapeMeshSdf, ivec3(i1.x, i0.y, zOffset + i0.z), 0).r;
  float v010 = texelFetch(uShapeMeshSdf, ivec3(i0.x, i1.y, zOffset + i0.z), 0).r;
  float v110 = texelFetch(uShapeMeshSdf, ivec3(i1.x, i1.y, zOffset + i0.z), 0).r;
  float v001 = texelFetch(uShapeMeshSdf, ivec3(i0.x, i0.y, zOffset + i1.z), 0).r;
  float v101 = texelFetch(uShapeMeshSdf, ivec3(i1.x, i0.y, zOffset + i1.z), 0).r;
  float v011 = texelFetch(uShapeMeshSdf, ivec3(i0.x, i1.y, zOffset + i1.z), 0).r;
  float v111 = texelFetch(uShapeMeshSdf, ivec3(i1.x, i1.y, zOffset + i1.z), 0).r;
  float interpolated = mix(
    mix(mix(v000, v100, f.x), mix(v010, v110, f.x), f.y),
    mix(mix(v001, v101, f.x), mix(v011, v111, f.x), f.y),
    f.z
  );
  vec3 outside = max(max(lo - p, p - hi), vec3(0.0));
  float boxDistance = length(outside);
  return boxDistance > 0.0 ? max(interpolated, boxDistance) : interpolated;
}
float shapeMeshSdf(int mesh, vec3 p) {
${entries}
  return 1.0e30;
}`;
}

const SURFACE_VERTEX = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Default frontier width of the fold shading-probe descent (the WebGL port
 * of the compute twin's probe-width verdict): the value-form DE the
 * shading taps ride (normal gradient, penumbra shadow, ambient occlusion —
 * taps LIGHT a hit the full-width march already certified, never decide
 * geometry) runs a width-1 greedy descent instead of the FOLD_W frontier.
 * Width 1 is the old greedy descent the oracle keeps for tests — known to
 * overshoot, which reads as a slight lightening of deep-crease shadow/AO
 * and which the probe-width A/B measured as eyeball-identical frames at
 * 23.8x cheaper shading on the compute twin.
 */
export const SURFACE_SHADE_DE_WIDTH = 1;

/** `?surfshadewidth=N` (1..SURFACE_FOLD_BEAM_WIDTH) overrides the shipped
 * probe width for A/B runs, read once at module load like scene.ts's
 * `?surfperf`. N equal to the beam width DISABLES the probe and reproduces
 * the pre-probe fragment source byte for byte — the WGSL
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
 * The fold-frontier descent body (the pure-fold branch sweep through its
 * branch-and-bound) as ONE template instantiated twice, mirroring
 * surface-de-gpu.ts's surfaceDEProbe derivation: the public `surfaceDE` at
 * width FOLD_W, plus (when the shade width differs) a `surfaceDEProbe`
 * copy at {@link SURFACE_SHADE_DE_WIDTH}. One text, two names: the bodies
 * cannot drift. Unlike the WGSL twin's module-scope frontier, the arrays
 * here are function-local, so the instances share scratch names safely and
 * only the function name and width vary.
 */
const foldDescentGlsl = (fnName: string, width: string): string =>
  `  float ${fnName}(vec3 p, float cutoff) {
    vec3 q = uFinalInvM * p + uFinalInvT;
    float startR = length(q - uBoundCenter);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    // The oracle's bailBelow: -1e30 disables the test.
    float bailBelow =
      (cutoff > 0.0 && sphereBound * uFinalSigmaMin < cutoff) ? cutoff : -1e30;
    // The frontier (the oracle's fc* scratch): point, scale, floor and
    // selection radius per live chain.
    vec3 fcQ[${width}];
    float fcScale[${width}];
    float fcFloor[${width}];
    float fcR[${width}];
#if SURFACE_CHAOS
    int fcState[${width}];
#endif
    int chainCount = 1;
    fcQ[0] = q;
    fcScale[0] = 1.0;
    fcFloor[0] = 0.0;
    fcR[0] = startR;
#if SURFACE_CHAOS
    fcState[0] = -1;
#endif
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
#if SURFACE_CHAOS
    int fnState[${width}];
#endif
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (chainCount == 0) {
        break;
      }
#if SURFACE_SCHEDULE
      vec4 childBound = surfaceLevelBound(depth + 1);
      float childEscape = surfaceLevelEscape(depth + 1);
      int mapBegin = surfaceLevelMapBegin(depth);
      int mapEnd = surfaceLevelMapEnd(depth);
      int symOrder = surfaceLevelSymOrder(depth);
#endif
#if SURFACE_CONDENSATION
      for (int c = 0; c < chainCount; c++) {
        condensationFold(
          fcQ[c],
          fcScale[c],
          depth
#if SURFACE_CHAOS
          , fcState[c]
#endif
          , best
        );
      }
      if (best <= sphereBound || best * uFinalSigmaMin < bailBelow) {
        return max(best, sphereBound) * uFinalSigmaMin;
      }
      bool futureCondensation = condensationFutureAfterChild(depth);
#endif
      int keptCount = 0;
      float fnWorstKey = -1e30;
      int fnWorstIdx = 0;
      for (int c = 0; c < chainCount; c++) {
        float pScale = fcScale[c];
        float pFloor = fcFloor[c];
        vec3 sQ = fcQ[c];
#if SURFACE_CHAOS
        int pState = fcState[c];
#endif
#if SURFACE_SCHEDULE
        for (int k = 0; k < symOrder; k++) {
#else
        for (int k = 0; k < uSymOrder; k++) {
#endif
          if (k > 0) {
            sQ = stepSector(sQ);
          }
#if SURFACE_SCHEDULE
          for (int j = mapBegin; j < mapEnd; j++) {
#else
          for (int j = 0; j < uMapCount; j++) {
#endif
#if SURFACE_CHAOS
            int childState = surfaceChaosChildState(depth, j);
            if (!surfaceChaosAllows(pState, childState)) continue;
#endif
            vec4 fp = uFoldParams[j];
            int kind = int(fp.x);
            int branchCount =
              kind == 0 ? 1 : (kind == 1 ? 27 : (kind == 2 ? 3 : 81));
            float absW = fp.z / uSigmaMin[j];
            FoldRadii fr = foldRadiiOf(uFoldRadii[j].xyz);
            // Branch-and-bound stage 2 is deliberately CPU-ONLY. The
            // oracle's branch-and-bound skips (descendFold) are VALUE
            // no-ops, so this mirror computes identical values without them
            // — and every GLSL encoding tried (full dual-bound, dir-form
            // only, uniform-array data, in-shader-derived data) pushed this
            // variant's already-critical Mesa/Iris LINK over the browser
            // watchdog cliff: sessions died at entry with the
            // VALIDATE_STATUS-false/empty-log reset debris (stage 1 alone
            // links and runs clean — bisected commit by commit on the real
            // driver). The trade is measured: the width sweep shows this
            // kernel OCCUPANCY-bound (superlinear in frontier width; ALU
            // cuts bought ~14% at equal width), so the skip's GPU value is
            // small, while its CPU value (grid builds, oracle consumers:
            // 75x fewer transforms/call) is kept in full.
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
                pre1 = fr.wall2 - u;
                pre2 = -fr.wall2 - u;
                dUp = max(u - fr.wall, 0.0);
                dDn = max(-fr.wall - u, 0.0);
              } else {
                ru = length(u);
              }
            }
            for (int b = 0; b < branchCount; b++) {
              vec3 img;
              float branchSigma;
              // The candidate's floor is knowable BEFORE the child
              // transform (stage 1: branchRd needs only the branch
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
                    sfRd = max(fr.fixedR - ru, 0.0);
                  } else if (s == 1) {
                    v = fr.innerScale * u;
                    sfSigma = fr.innerSigma;
                    sfRd = max(ru - fr.outputR, 0.0);
                  } else {
                    if (ru < fr.midMinR) {
                      // f32 overflow guard: fold the unit-shell bound
                      // (~pScale * |w|, never a near-zero ghost term) and
                      // skip the branch + its box expansion.
                      float shellCert = pScale * absW * (fr.fixedR - ru);
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
                    float invR2 = fr.fixedR2 / (ru * ru);
                    v = u * invR2;
                    sfSigma = ru * fr.invFixedR;
                    sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
                  }
                  if (kind == 3) {
                    pre0 = v;
                    pre1 = fr.wall2 - v;
                    pre2 = -fr.wall2 - v;
                    dUp = max(v - fr.wall, 0.0);
                    dDn = max(-fr.wall - v, 0.0);
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
#if SURFACE_SCHEDULE
              float r = length(img - childBound.xyz);
#else
              float r = length(img - uBoundCenter);
#endif
              float childScale = pScale * branchSigma;
#if SURFACE_CONDENSATION
              condensationFold(
                img,
                childScale,
                depth + 1
#if SURFACE_CHAOS
                , childState
#endif
                , best
              );
#endif
#if SURFACE_SCHEDULE
              float key = pScale * (r - childBound.w);
#else
              float key = pScale * (r - uBoundingRadius);
#endif
              if (candFloor > 0.0 && candFloor > key) {
                key = candFloor;
              }
#if SURFACE_SCHEDULE
              float cert = childScale * (r - childBound.w);
#else
              float cert = childScale * (r - uBoundingRadius);
#endif
              if (candFloor > 0.0 && candFloor > cert) {
                cert = candFloor;
              }
              // Past the escape radius deeper refinement cannot improve
              // the min: fold the (floor-raised) certificate plain.
#if SURFACE_SCHEDULE
              if (r > childEscape) {
#else
              if (r > uEscapeRadius) {
#endif
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
#if SURFACE_SCHEDULE
              float evScale = 1.0;
#endif
              bool evHas = false;
              if (keptCount == ${width} && key >= fnWorstKey) {
                evR = r;
                evCert = cert;
                evFloor = candFloor;
#if SURFACE_SCHEDULE
                evScale = childScale;
#endif
                evHas = true;
              } else {
                int slot;
                if (keptCount == ${width}) {
                  slot = fnWorstIdx;
                  evR = fnR[slot];
                  evCert = fnCert[slot];
                  evFloor = fnFloor[slot];
#if SURFACE_SCHEDULE
                  evScale = fnScale[slot];
#endif
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
#if SURFACE_CHAOS
                fnState[slot] = childState;
#endif
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
#if SURFACE_SCHEDULE
                if (evR > childBound.w) {
#else
                if (evR > uBoundingRadius) {
#endif
                  if (evCert < best) {
                    best = evCert;
                    if (
                      best <= sphereBound ||
                      best * uFinalSigmaMin < bailBelow
                    ) {
                      return max(best, sphereBound) * uFinalSigmaMin;
                    }
                  }
#if SURFACE_CONDENSATION
                } else if (futureCondensation) {
                  best = min(
                    best,
#if SURFACE_SCHEDULE
                    evScale * (evR - childBound.w)
#else
                    evScale * (evR - uBoundingRadius)
#endif
                  );
                  if (
                    best <= sphereBound ||
                    best * uFinalSigmaMin < bailBelow
                  ) {
                    return max(best, sphereBound) * uFinalSigmaMin;
                  }
#endif
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
#if SURFACE_CHAOS
        fcState[i] = fnState[i];
#endif
      }
      chainCount = keptCount;
    }
    // Floor-raised KIFS terminals for every chain alive at the depth cap:
    // a floor-0 chain is a true preimage orbit (its negative terminal is
    // the hit signal), a strayed chain folds its certified positive floor.
    for (int c = 0; c < chainCount; c++) {
#if SURFACE_CONDENSATION
      condensationFold(
        fcQ[c],
        fcScale[c],
        uMaxDepth
#if SURFACE_CHAOS
        , fcState[c]
#endif
        , best
      );
#endif
#if SURFACE_SCHEDULE
      vec4 terminalBound = surfaceLevelBound(uMaxDepth);
      float terminal = fcScale[c] * (fcR[c] - terminalBound.w);
#else
      float terminal = fcScale[c] * (fcR[c] - uBoundingRadius);
#endif
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

/** Whole-source stripper: block comments first (the uniform docs), then
 * {@link stripGlslComments}'s line-comment/blank/indent pass. BORN for the
 * ground-plane variants — the plane arm's text pushed the shared
 * fold/affine source past the measured Mesa crash cliff, and raw SOURCE
 * size is what that compiler prices, comments included (see
 * resolveVariantArms) — and GENERALIZED to the size rule at
 * {@link SURFACE_GLSL_STRIP_BYTES}, which is what a reader has to know
 * before believing the rest of this comment: it runs for every DESCENT
 * variant today, floor or no floor, because every one of them resolves
 * past the threshold. Stripping emits the identical token stream, and the
 * plane variants were NEW programs with no shipped-bytes baseline to
 * preserve — the probe instance's exact precedent, one level up. The arms
 * that stay UNDER the threshold are the ones that keep their commentary
 * verbatim: escape, bulb, and the 4D tracer's plain arm.
 * Driver-side `#` directives survive (they are not comments; leading
 * whitespace before `#` was
 * legal anyway and the trim leaves them at column 0). */
function stripGlslSource(glsl: string): string {
  return stripGlslComments(glsl.replace(/\/\*[\s\S]*?\*\//g, ""));
}

/** The probe instance, emitted only when the width differs from
 * the beam's and only into the NON-lens source: its taps keep full-width
 * cores through the public wrapper, and the compute probe-width verdict
 * never covered lenses (the twin renders no foldFinal systems).
 *
 * A THIRD reason this exclusion used to give has RETIRED, and is written
 * out so nobody reinstates it: that the lens source "already sits at the
 * Mesa cliff". It does not. The lens variant resolves past
 * {@link SURFACE_GLSL_STRIP_BYTES} and therefore reaches the driver
 * STRIPPED, at about a third of its resolved size — measured 86223 B
 * resolved against 28958 B emitted, where the cliff is ~80KB of EMITTED
 * source. The argument was sound when it was written, before the strip
 * became a size rule; reinstating one needs a fresh measurement of the
 * emitted source, which is the only size Mesa ever walks. Comments are
 * stripped in this body for the reason they always were — it is spliced
 * INTO another variant's source and has no shipped-bytes baseline of its
 * own, the precedent {@link stripGlslSource} later generalized. */
const foldProbeGlsl = (shadeDeWidth: number): string =>
  shadeDeWidth === SURFACE_FOLD_BEAM_WIDTH
    ? ""
    : `
#if SURFACE_FOLD_LENS
#else
${stripGlslComments(foldDescentGlsl("surfaceDEProbe", String(shadeDeWidth)))}
#endif`;

/** The value form the shading taps call, routed per the probe rule (probe
 * under SURFACE_FOLDS, full descent elsewhere) — or the pre-probe text
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
   * width-${String(shadeDeWidth)} shading-probe descent (the measured
   * probe-width verdict). The affine ladder keeps the full descent, and
   * under the fold lens the public wrapper below owns the taps with
   * full-width cores — see foldProbeGlsl for why the lens
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
 * Assemble the fragment source for one shading-probe width:
 * `SURFACE_FOLD_BEAM_WIDTH` disables the probe and reproduces the
 * pre-probe source byte for byte. Exported for tests; the module ships
 * exactly one build (SURFACE_FRAGMENT below).
 */
export function buildSurfaceFragment(shadeDeWidth: number): string {
  return /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  const int MAX_MAPS = ${SURFACE_MAX_MAPS};
  const int GRID_SKIP_CAP = ${SURFACE_GRID_SKIP_CAP};
  /** Sphere-trace step budget per ray — a per-tier uniform: the preview
   * tier trades steps for frame rate on map-heavy systems whose DE cost
   * the depth clamp can't touch. Tracer-side only, like the loop caps
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
#if SURFACE_SCHEDULE
  /** Finite B-prefix records occupy [uMapCount, uMapCount+uScheduleCount).
   * Inner level bounds occupy slots depth-1; depth >= uScheduleDepth clamps
   * to A's ordinary bound in the last live slot. The root remains the
   * classic uBoundCenter/uBoundingRadius/uEscapeRadius trio. */
  uniform int uScheduleCount;
  uniform int uScheduleDepth;
  uniform vec4 uScheduleBounds[${SURFACE_MAX_SCHEDULE_DEPTH}];
  uniform float uScheduleEscapeRadius[${SURFACE_MAX_SCHEDULE_DEPTH}];
#endif
#if SURFACE_CHAOS
  /** Reverse binary chi support. Entry current contains predecessor bit i
   * iff the forward point sampler can take i -> current. Six uvec4 lanes
   * cover the frozen 24-state cap without moving any classic uniform. */
  // Every 24-bit mask is exactly representable in fragment highp float.
  // Float arithmetic avoids a pathological dynamic-u32 shift in Mesa's
  // fragment compiler while preserving the same binary support test.
  uniform vec4 uChaosPredecessorMasks[6];
  bool surfaceChaosAllows(int currentState, int predecessorState) {
    if (currentState < 0) return true;
    vec4 group = uChaosPredecessorMasks[currentState / 4];
    float mask = currentState % 4 == 0 ? group.x :
      (currentState % 4 == 1 ? group.y :
      (currentState % 4 == 2 ? group.z : group.w));
    float bit = exp2(float(predecessorState));
    return mod(floor(mask / bit), 2.0) >= 1.0;
  }
  int surfaceChaosChildState(int depth, int mapSlot) {
#if SURFACE_SCHEDULE
    if (depth < uScheduleDepth) return -1;
#endif
    return mapSlot;
  }
#endif
#if SURFACE_CONDENSATION
  /** Condensation C0 records append after the ordinary map prefix in the
   * same fixed arrays. uMapCount remains recursive; uCondCount counts the
   * symmetry-expanded emitter records. */
  uniform int uCondCount;
  uniform int uCondMapCount;
  uniform int uShadeCount;
  uniform int uCondMinDepth;
  uniform int uCondMaxDepth;
  uniform int uCondShape[MAX_MAPS];
  uniform int uCondShade[MAX_MAPS];
#if SURFACE_CHAOS
  /** The graph state of each physical emitter record. Recursive A states
   * are exactly their map indices; emitters need this explicit selector
   * because physical symmetry copies share one compact base state. */
  uniform int uCondState[MAX_MAPS];
#endif
  // One SDF body per unique authored emitter shape, baked at program-build
  // time; uCondShape selects it for each symmetry copy.
  //__SURFACE_CONDENSATION_SDFS__
  vec2 condensationTerm(
    vec3 q,
    float scale,
    int depth
#if SURFACE_CHAOS
    , int currentState
#endif
  ) {
#if SURFACE_SCHEDULE
    if (depth < uScheduleDepth) return vec2(1.0e30, -1.0);
    depth -= uScheduleDepth;
#endif
    if (depth < uCondMinDepth || depth > uCondMaxDepth) {
      return vec2(1.0e30, -1.0);
    }
    float best = 1.0e30;
    int shade = 0;
    for (int e = 0; e < uCondCount; e++) {
#if SURFACE_CHAOS
      if (!surfaceChaosAllows(currentState, uCondState[e])) continue;
#endif
      int slot = uCondMapCount + e;
      vec3 local = uInvM[slot] * q + uInvT[slot];
      float d =
        scale * 0.9 * uSigmaMin[slot] *
        condensationShapeSdf(uCondShape[e], local);
      if (d < best) {
        best = d;
        shade = uCondShade[e];
      }
    }
    return vec2(best, float(shade));
  }
  bool condensationFutureAfterChild(int loopDepth) {
#if SURFACE_SCHEDULE
    loopDepth -= uScheduleDepth;
#endif
    return max(loopDepth + 2, uCondMinDepth) <= uCondMaxDepth;
  }
  void condensationFold(
    vec3 q,
    float scale,
    int depth
#if SURFACE_CHAOS
    , int currentState
#endif
    , inout float best
  ) {
    best = min(
      best,
      condensationTerm(
        q,
        scale,
        depth
#if SURFACE_CHAOS
        , currentState
#endif
      ).x
    );
  }
  void condensationFoldHit(
    vec3 q,
    float scale,
    int depth,
#if SURFACE_CHAOS
    int currentState,
#endif
    inout float best,
    inout int firstChoice
  ) {
    vec2 hit = condensationTerm(
      q,
      scale,
      depth
#if SURFACE_CHAOS
      , currentState
#endif
    );
    if (hit.x < best) {
      best = hit.x;
      firstChoice = int(hit.y);
    }
  }
#endif
#if SURFACE_FINISH || SURFACE_PATTERN
  /** Per-map surface material, in surface-material-wire.ts's two wire
   * lanes (the ONE lane definition the WGSL shade stride shares): A =
   * (specular, shininess, metalness, reflect), B = (transmit,
   * reflectionTint, patternConfig, scale). Keyed to base maps like uMapColor and read at the shading
   * site through the hit's depth-0 map. Declared INSIDE the arm (the
   * SURFACE_BULB precedent), so an unfinished document's program pays no
   * bytes for them — and in this SHARED section rather than any other
   * arm, so every variant, the forward-orbit escape and bulb arms
   * included, can read them. */
  uniform vec4 uMapFinishA[MAX_MAPS];
  uniform vec4 uMapFinishB[MAX_MAPS];
#endif
#if SURFACE_PATTERN
  /** One calibration quartet per built DE/session, never repeated per map:
   * (ringsLow, ringsInvSpan, sheetsLow, sheetsInvSpan). The downstream
   * pattern-shading bead consumes it. */
  uniform vec4 uPatternCalibration;
#if SURFACE_SCHEDULE
  // The hit-info descent publishes the point after the finite B prefix;
  // pattern space begins there, while final lenses remain outside it.
  vec3 patternScheduleSource;
#endif
  /** The SURFACE_PATTERN shading arm's ONE shared body — the accepted V3
   * pattern arithmetic (surface-pattern-shade.ts), spliced by both GLSL
   * tracers so the 3D and 4D formula copies cannot drift. It reads no
   * uniforms directly: the call site in main() supplies the normalized
   * source hit, the hit's B lane, the per-DE calibration and the pixel
   * footprint. */
  ${surfacePatternShadeSource()}
#endif
#if SURFACE_FOLDS
  /** Fold-branch sweep, compiled in only for systems with pure-fold maps
   * (the SURFACE_FOLDS define; affine systems keep the ladder bodies
   * verbatim). Frontier width, from the oracle's measured
   * SURFACE_FOLD_BEAM_WIDTH. */
  const int FOLD_W = ${SURFACE_FOLD_BEAM_WIDTH};
  /** Per-map fold data + the orbit-trap coordinate uTrapIndex carries in
   * the affine variant (folded in here so the swap is uniform-budget
   * neutral): (foldKind 0..3, 1/w signed, |w|*sigmaMin, trapIndex). */
  uniform vec4 uFoldParams[MAX_MAPS];
  /** Per-map AUTHORED fold lengths: (minRadius, fixedRadius, boxLimit,
   * unused) — resolveFoldRadii's own output, the three numbers a document
   * carries. foldRadiiOf below re-derives the branch algebra from them,
   * so the wire stays checkable against the document by eye. The one new
   * per-map array this variant pays for; declared INSIDE the arm, so an
   * affine program is byte-identical to the pre-authored-lengths build. */
  uniform vec4 uFoldRadii[MAX_MAPS];
#else
  /** Per-slot palette coordinate in [0, 1] for the orbit trap
   * (CPU-precomputed from each slot's base-map index). */
  uniform float uTrapIndex[MAX_MAPS];
#endif
  uniform int uMapCount;
  /** Kaleidoscope sectors swept around every base map (>= 1). 1 leaves
   * the sweep a single pass with no rotation, which is what keeps
   * non-symmetric systems bit-identical to the pre-sweep tracer. */
  uniform int uSymOrder;
  /** Symmetry plane: 0 = yz, 1 = xz, 2 = xy (surface-de.ts's SYM_PLANE_CODE
   * — the pre-4D axis codes, renamed and not renumbered). */
  uniform int uSymPlane;
  /** cos/sin of ONE forward sector step 2*PI/uSymOrder. Sectors are walked
   * incrementally off this pair, so no per-sector transcendental — and no
   * order-sized uniform table the budget could not carry. */
  uniform vec2 uSymStep;
  /** Bounding-sphere radius R of the RAW attractor (pre final transform). */
  uniform float uBoundingRadius;
  /** Center of the raw attractor's bounding ball (the probe-fit
   * near-smallest enclosing ball when it beats the origin ball, else the
   * origin). Every attractor-sphere term below reads length(x -
   * uBoundCenter) - uBoundingRadius; u-space fold geometry and the
   * uVisibleRadius gates stay origin-anchored. The escape-time variant
   * never reads it (its uBoundingRadius is that mode's own
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
#if SURFACE_SCHEDULE
  vec4 surfaceLevelBound(int depth) {
    if (depth <= 0) return vec4(uBoundCenter, uBoundingRadius);
    return uScheduleBounds[min(depth, uScheduleDepth) - 1];
  }
  float surfaceLevelEscape(int depth) {
    if (depth <= 0) return uEscapeRadius;
    return uScheduleEscapeRadius[min(depth, uScheduleDepth) - 1];
  }
  int surfaceLevelMapBegin(int depth) {
    return depth < uScheduleDepth ? uMapCount : 0;
  }
  int surfaceLevelMapEnd(int depth) {
    return depth < uScheduleDepth ? uMapCount + uScheduleCount : uMapCount;
  }
  int surfaceLevelSymOrder(int depth) {
    return depth < uScheduleDepth ? 1 : uSymOrder;
  }
#endif
  /** Pure-fold final lens: (foldKind, 1/w, |w|, sigmaMin of the lens's
   * affine part). Alive only under the SURFACE_FOLD_LENS define — the
   * wrapper past the descent bodies enumerates the fold's inverse
   * branches around the UNTOUCHED cores, and the uFinal* trio above is
   * packed IDENTITY so the cores run their no-lens arithmetic verbatim
   * (the oracle's descendLens / foldFinal split). */
  uniform vec4 uLensParams;
  uniform mat3 uLensInvM;
  uniform vec3 uLensInvT;
  /** The lens fold's AUTHORED lengths, uFoldRadii's per-map quartet for
   * the one map that is not in the array. Zero without a lens,
   * which the wrapper never reads. */
  uniform vec3 uLensRadii;
  /** Base-color source: 0 = by-transform (uMapColor), 1 = orbit-trap
   * palette, 2 = height ramp, 3 = radius ramp, 4 = orbit rings, 5 = orbit
   * sheets. Sources 1-5 sample uColorLUT. */
  uniform int uColorSource;
  /** Per-level decay of the orbit-trap blend weight (flam3's color
   * speed): 0.5 = the classic halving, 0 = pure depth-0 regions, 1 =
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
  /** xyz = camera forward; w = enclosing-ball centre depth. */
  uniform vec4 uFocusPlane;
  uniform vec3 uBgTop;
  uniform vec3 uBgBottom;
  /** The backdrop's gradient SHAPE: 0 = linear (vertical ramp, the
   * shipped shape), 1 = radial (vignette). uBgCenter/uBgScale are the
   * radial branch's normalized-image centre and per-axis scale (see
   * fractal/background-shape.ts's backgroundRadialScale); linear ignores
   * both. Read by the shared backgroundShapeT body spliced in below. */
  uniform int uBgShape;
  uniform vec2 uBgCenter;
  uniform vec2 uBgScale;
  /** Depth-fog density multiplier: scales the traveled-distance term of
   * the fog blend below (main()'s float fog computation) — 1 is the fixed
   * fog it replaced, 0 (scene-set floor) fades it away entirely.
   * Scene-set, independent of the installed system — see scene.ts's
   * setFogDensity. */
  uniform float uFogDensity;
  /** Fog tint: what the depth fog blends toward is mix(background,
   * uFogTint, uFogTintStrength) — strength 0 (the default) is a bit-exact
   * identity, the pre-tint fog toward the
   * pixel's own backdrop color. scene.setFogTint keeps both current. */
  uniform vec3 uFogTint;
  uniform float uFogTintStrength;
  /** Environment-light strength: how far the light is tinted toward the
   * backdrop sampled along the shading normal. 0 is a bit-exact identity
   * — the neutral light it replaced. The tint multiplies the WHOLE lit
   * term, not just the ambient half: ambient-only was MEASURED invisible
   * even at strength 1 on both built-in backdrops (docs/
   * surface-glsl-tracers.md carries the numbers), because ambient is a
   * quarter of the light and this app's dark/haze stops are near the same
   * hue. Specular is deliberately left OUT of the product — the untinted
   * highlight is what keeps a strongly tinted render from reading
   * monochrome. */
  uniform float uEnvLight;
  /** The backdrop as a two-stop environment, normalized to its own max
   * channel so uEnvLight moves HUE and never brightness — which is what
   * lets the knob read at all against the near-black default backdrop,
   * where
   * an honest additive environment term would contribute nothing. */
  vec3 envTint(vec3 n) {
    vec3 e = mix(uBgBottom, uBgTop, n.y * 0.5 + 0.5);
    return mix(vec3(1.0), e / max(max(e.r, max(e.g, e.b)), 1.0e-4), uEnvLight);
  }
#if SURFACE_GROUND_PLANE
  uniform float uGroundY;
  uniform float uGroundFadeStart;
  uniform float uGroundFadeEnd;
  uniform float uGroundBallR;
  uniform vec3 uGroundBallC;
  uniform vec3 uGroundAlbedo;
  uniform int uGroundPattern;
  uniform float uGroundTileScale;
  uniform float uGroundEmission;
#endif
#if SURFACE_FINISH
  /** The parametric lighting composition — fractal/surface-finish.ts's
   * ONE body template, emitted in the GLSL dialect (the WGSL shade entry
   * emits the same text in its own), so the three shader mirrors cannot
   * drift on the arithmetic. It reads uLightDir/uAmbient/uEnvLight and
   * the uBgTop/uBgBottom pair above, and at the classic lanes reproduces
   * the fixed formula in main()'s #else branch VALUE for value — never
   * byte for byte, which is why it is define-gated rather than shipped. */
  ${surfaceFinishShadeSource(SURFACE_FINISH_GLSL, true)}
#endif
  ${backgroundShapeSource(BACKGROUND_SHAPE_GLSL)}
  /** Angular pixel footprint of the ACTIVE buffer (scene-set per frame):
   * sizes the shading probes (normal offsets, ray dither) to the pixels
   * actually being rendered. NOT the hit test's epsilon — see
   * uAcceptPixelEps. */
  uniform float uPixelEps;
  /** Angular pixel footprint of the FULL-RESOLUTION frame (the settle /
   * capture buffer), scene-set per frame and tier-INDEPENDENT: the
   * march's hit acceptance, the grid's no-hit proof, and the DE's cutoff
   * all run at max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor) in
   * EVERY tier. A tier may coarsen sampling, never acceptance: scaling
   * the acceptance epsilon with a preview's smaller buffer let it cross
   * the fold DE's loose-but-valid plateau band (fold-branch region floors
   * measure DE/D as low as 0.13 near fold faces, vs 0.6+ on affine
   * systems), which rendered entire box-face shells as crisp phantom
   * geometry on coarse rungs — solid faces the settle frame then erased,
   * except fold systems settle slowest, so the phantom was what users
   * actually saw. Pinning acceptance to the full-resolution epsilon makes
   * a preview unable to accept any hit the settle frame would reject;
   * measured on the phantom-face repro (CPU march emulation, 40-step
   * preview
   * budget): phantom hits 2 -> 0, hole cost 0.4-0.9% of true hits. */
  uniform float uAcceptPixelEps;
  /** Where inside its pixel THIS pass aims (the WebGL arm's
   * supersampling, the compute arm's shape in strip vocabulary). .xy is
   * the offset in UV, .zw the SAME offset in pixels; the scene derives
   * both from surface-compute.ts's subPixelSample, so the two engines
   * walk one R2 sequence. All zero is the pixel CENTRE, which is what
   * every single-pass trace writes — a preview, a thumbnail, an offline
   * force frame, and pass 0 of a supersampled settle — so the two reads
   * below add exactly 0.0 there and the frame is the pre-supersampling
   * frame value for value.
   *
   * TWO reads, deliberately. The ray's own UV moves (that is the sample),
   * and the march-start dither's hash takes the JITTERED pixel so passes
   * do not share a t offset — an identical dither under a moved ray would
   * correlate the banding it exists to break, and averaging would not
   * cancel it. The BACKGROUND gradient below reads the unjittered vUv on
   * purpose: it is a smooth ramp with nothing to alias, and it has to
   * agree with the seed the untraced strips still show. */
  uniform vec4 uPixelJitter;

  /** Empty-space-skipping grid, the CPU-built surface-grid.ts cube
   * uploaded as a 3D texture: each texel is a conservative distance floor
   * good for EVERY point of its cell (DE at the cell center minus the
   * cell's half-diagonal, f32-floored — see that module's validity
   * chain), 0 where no positive floor could be certified. NEAREST-sampled
   * so a lookup reads exactly the cell the point is in — interpolated
   * floors of NEIGHBOR cells would not be valid here. 0 while no grid has
   * arrived (uGridEnabled 0 keeps the
   * march off the placeholder anyway). */
  uniform sampler3D uGridTex;
  /** 1 / (2 * halfExtent) of the grid cube: world point -> texture
   * coordinate is p * uGridInvSpan + 0.5 (the cube is origin-centered,
   * like the traced sphere it covers). */
  uniform float uGridInvSpan;
  /** 1 once a grid for the ACTIVE system is uploaded, else 0 — and, in
   * balloon mode, 0 whenever the shell fails to clear the grid box (the
   * balloon's per-frame validity gate, setSurfaceGridEnabled's
   * write). */
  uniform float uGridEnabled;

  in vec2 vUv;
  layout(location = 0) out vec4 outColor;
  layout(location = 1) out vec4 outTraceLayer;

  /** RGB = coverage/fog/beta; A = signed CoC (focus 128, uncovered 255). */
  vec4 traceLayer(float coverage, float fog, float cameraDepth) {
    float beta = 1.0 - coverage +
      coverage * fog * (1.0 - uFogTintStrength);
    float coc = coverage > 0.0
      ? clamp(
          (cameraDepth - uFocusPlane.w) / max(uVisibleRadius, 1.0e-6),
          -1.0,
          1.0
        )
      : 1.0;
    float cocCode = (128.0 + 127.0 * coc) / 255.0;
    return vec4(coverage, fog, beta, cocCode);
  }

  /** Per-pixel dither for the march start so grazing rays don't band. */
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  /** One sector step of the kaleidoscope sweep (the oracle's stepSector):
   * turn a point BACKWARD by 2*PI/uSymOrder in the symmetry plane. That
   * is the transpose of the rotation copy k applies AFTER its base map, so
   * descending through the copy un-rotates first; transposing a single-plane
   * rotation flips the sign of sin alone, which is why one (cos, sin) pair
   * of the FORWARD step drives every sector. */
  vec3 stepSector(vec3 p) {
    float c = uSymStep.x;
    float s = uSymStep.y;
    if (uSymPlane == 0) {
      return vec3(p.x, c * p.y + s * p.z, -s * p.y + c * p.z);
    }
    if (uSymPlane == 1) {
      return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    }
    return vec3(c * p.x + s * p.y, -s * p.x + c * p.y, p.z);
  }

  /** The fold's three AUTHORED lengths, re-expressed in the branch
   * algebra's own terms — surface-de.ts's surfaceFoldRadii field for
   * field. The wire carries the lengths and this derives the rest, once
   * per map per descent level, outside a branch loop that runs up to 81
   * times; at the classic (0.5, 1, 1) every expression is exactly the
   * literal that shipped, so an unparameterized document traces
   * bit-identically. Declared unconditionally: the fold-lens wrapper
   * reads
   * it around an AFFINE core too, where SURFACE_FOLDS is 0. */
  struct FoldRadii {
    float wall;
    float wall2;
    float fixedR;
    float invFixedR;
    float fixedR2;
    float innerScale;
    float innerSigma;
    float outputR;
    float midMinR;
  };

  FoldRadii foldRadiiOf(vec3 f) {
    float mR = f.x;
    float fR = f.y;
    float fR2 = fR * fR;
    float mR2 = mR * mR;
    return FoldRadii(
      f.z,
      2.0 * f.z,
      fR,
      1.0 / fR,
      fR2,
      mR2 / fR2,
      fR2 / mR2,
      fR2 / mR,
      ${SPHEREFOLD_MID_MIN_R} * fR
    );
  }

  /** One extra Hutchinson level on a frozen escaped candidate's own
   * inverse image (the oracle's refinedCert): the certificate becomes
   * childScale * max(r - R, min_j sigmaMin_j * (|invMap_j(img)| - R)) —
   * never below the plain childScale * (r - R). The 4D surface spike
   * measured this exact refinement eliminating every march ghost; the
   * port brings it down from the 4D tracer, closing the balloon membranes
   * the plain certificates painted across attractor voids. "Every map"
   * means every (sector, base map) pair, which the sweep spells out where
   * the expanded
   * slot list used to. */
  // The per-step cone-footprint depth cap is deliberately CPU-ONLY
  // (estimateDistance*'s optional footprint parameter). Every GLSL
  // encoding tried — a mutable global as the descent loop bound, and the
  // same global as an in-loop break under a uniform bound — regressed
  // this variant's already-critical Mesa/Iris fold LINK past the browser
  // watchdog (context lost at entry with the VALIDATE_STATUS-false reset
  // debris; bisected on the real driver). A depth-cap PARAMETER threaded
  // through the overloads (an SSA value, not a global) is the credible
  // future encoding.

#if SURFACE_FOLDS
  // The fold variant defines NO refinedCert at all: its descent folds
  // PLAIN certificates (the oracle's descendFold refine=false path). Two
  // reasons, both measured. Correctness: on fold systems the region
  // floors, not refinement, carry the ghost-killing — deep-void false
  // hits are 0 for both estimators, and refinement adds only a
  // width-bound tail the surface-beam harness discloses rather than gates
  // (refined-on-folds is harness-only; the gates pin the base row this
  // variant marches). Compile survival: refinement's inner (sector x map
  // x branch) sweep inlines into the frontier's innermost loop, and
  // Mesa's compiler already dies on this variant without it (Iris Xe:
  // linkProgram stall, empty info log, context lost). The affine variant
  // below keeps the refined discipline unchanged.
#else
#if SURFACE_CONDENSATION || SURFACE_SCHEDULE || SURFACE_CHAOS
  float refinedCert(
    vec3 img,
    float r,
    float childScale,
    int depth
#if SURFACE_CHAOS
    , int currentState
#endif
  ) {
#else
  float refinedCert(vec3 img, float r, float childScale) {
#endif
#if SURFACE_CONDENSATION
#if SURFACE_CHAOS
    float inner = condensationTerm(img, 1.0, depth, currentState).x;
#else
    float inner = condensationTerm(img, 1.0, depth).x;
#endif
#else
    float inner = 1e30;
#endif
#if SURFACE_SCHEDULE
    vec4 currentBound = surfaceLevelBound(depth);
    vec4 childBound = surfaceLevelBound(depth + 1);
    int mapBegin = surfaceLevelMapBegin(depth);
    int mapEnd = surfaceLevelMapEnd(depth);
    int symOrder = surfaceLevelSymOrder(depth);
#endif
    vec3 sImg = img;
#if SURFACE_SCHEDULE
    for (int k = 0; k < symOrder; k++) {
#else
    for (int k = 0; k < uSymOrder; k++) {
#endif
      if (k > 0) {
        sImg = stepSector(sImg);
      }
#if SURFACE_SCHEDULE
      for (int j = mapBegin; j < mapEnd; j++) {
#else
      for (int j = 0; j < uMapCount; j++) {
#endif
#if SURFACE_CHAOS
        int nextState = surfaceChaosChildState(depth, j);
        if (!surfaceChaosAllows(currentState, nextState)) continue;
#endif
        vec3 jImg = uInvM[j] * sImg + uInvT[j];
#if SURFACE_SCHEDULE
        inner = min(
          inner,
          uSigmaMin[j] * (length(jImg - childBound.xyz) - childBound.w)
        );
#else
        inner = min(
          inner,
          uSigmaMin[j] * (length(jImg - uBoundCenter) - uBoundingRadius)
        );
#endif
      }
    }
#if SURFACE_SCHEDULE
    return childScale * max(r - currentBound.w, inner);
#else
    return childScale * max(r - uBoundingRadius, inner);
#endif
  }
#endif

  /**
   * Both surfaceDE overloads mirror estimateDistanceRefined in
   * src/fractal/surface-de.ts (the tested CPU oracle) — any change there
   * must land in BOTH bodies here, and vice versa. Width-4 BEAM
   * inverse-map descent (paired A/B chains, plus the rank-3/4 validity
   * slots; the CPU oracle's beamWidth is always 4 in production builds,
   * so the tracer hardcodes it): each level expands every live chain
   * through every map — every (kaleidoscope sector, base map) pair, swept
   * rather than stored — and ranks the four smallest-key candidates by
   * chainScale * (r - R) — the best two continue as the next A/B chains,
   * and ranks 3/4 continue as extra chains ONLY while their image stays
   * in-sphere, folding the same REFINED certificate below the moment they
   * escape instead — and folds every OTHER escaped candidate's REFINED
   * certificate (refinedCert above) into the running min — so surfaces
   * reachable through a shallower or second-nearest branch are never
   * overshot, and barely-escaped siblings no longer freeze the near-zero
   * plain bounds that false-hit as balloons — while chains A/B keep
   * refining down to their terminal last-value bound (folded PLAIN when a
   * chain escapes past uEscapeRadius or the depth cap ends the loop,
   * exactly as the oracle keeps them; validity chains fold no cap
   * terminal at all — see the promote comment below). Every refined fold
   * site carries the oracle's laziness guard: refinement can only RAISE a
   * certificate, so a fold whose PLAIN certificate already fails to beat
   * the running min is skipped whole — bit-exact, and it caps the inner
   * sweeps at the folds that actually advance the min. See the oracle
   * module's doc for the validity argument and the measured numbers. 1e30
   * stands in for Infinity (slot-occupancy tests use < 1e29): with sigma
   * products <= 1 and real distances O(1..10) it can never be confused
   * for a real bound. This plain overload is the workhorse (march,
   * normals, shadow, occlusion); the out-param overload below adds
   * hit-shading extras.
   *
   * EARLY-OUT CUTOFF, mirroring the oracle's cutoff parameter. The march
   * needs a HIT DECISION, not a distance, so it passes its own acceptance
   * epsilon and the descent stops as soon as the value it would return is
   * already below it. A cutoff of 0.0 — the zero-argument overload below,
   * every tap that needs the DISTANCE — is the full descent. Above the
   * cutoff the value is the full-descent one (early exits only ever
   * return BELOW it, so step lengths never drift); below it, the full
   * descent would have landed below too, so the hit verdict is identical.
   * Both rest on best only ever FALLING, and on the exits testing it only
   * after a fold has SETTLED it — refined, here — never on the raw plain
   * certificate that gates the fold. Exiting on the latter would re-open
   * the balloon ghosts refinement exists to kill: a barely-escaped
   * sibling dips under the epsilon, the full descent lifts it back above.
   *
   * SPHERE FLOOR, mirroring the oracle's own unconditional exit. Once
   * best falls to or below sphereBound the return is already pinned at
   * sphereBound * uFinalSigmaMin — the epilogue clamps through max(best,
   * sphereBound), and best only ever falls, so no later fold can lift the
   * clamp back off sphereBound. The descent therefore exits the instant
   * best <= sphereBound, unconditionally — no cutoff involved. Unlike the
   * cutoff exit above, this one is value-exact for EVERY caller,
   * including a cutoff of 0.0 (the zero-argument overload below): it
   * returns the full-descent value bit-for-bit, always. Live on
   * anisotropic maps (certificates lose a sigmaMin/sigmaMax factor per
   * level and dip under the floor); provably dead on isotropic
   * invariant-ball maps, where certificates never dip (see the oracle's
   * paragraph).
   *
   * FOLD SYSTEMS compile the WIDE-FRONTIER variant instead — the oracle's
   * descendFold, selected by the SURFACE_FOLDS define at system-set time
   * so the affine ladder text above stays byte-for-byte what shipped: a
   * FOLD_W-slot frontier replaces the four ladder slots (fold maps spawn
   * 27/3/81 branch candidates and whole sets stay in-sphere at once),
   * every candidate carries a REGION FLOOR (the strongest scale * |w| *
   * regionDist certificate of its branch history) that its keys,
   * certificates and cap terminals are raised to, tuples dropped off the
   * frontier fold their floor (the drop-fold rule — validity at any
   * width), and candidates whose floor already reaches the running min
   * are pruned outright. Two deliberate departures from the affine
   * variant's shape, both forced by real drivers (Mesa on Iris Xe died
   * compiling the first cut — linkProgram stall, empty info log, lost
   * context): the frontier is stored UNSORTED with a tracked worst slot
   * (one indexed write + a fixed-bound read-only rescan, where the sorted
   * insert-shift's data-dependent chains killed the compiler), and the
   * variant marches the oracle's refine=false path — PLAIN certificates,
   * no refinedCert at all (see the fold refinedCert note above: on fold
   * systems the region floors carry the ghost-killing, and base is the
   * production estimator the harness gates). See descendFold's doc for
   * the measured numbers.
   */
#if SURFACE_BALLOON
// The balloon inverted-union scene. The wrapper at the bottom of this
// file composes fractal/balloon-de.ts's estimateBalloonDistance over the
// compiled variant's public DE — this rename points every variant's
// public definitions at surfaceDEFractal so the wrapper can own the
// public names, the SURFACE_FOLD_LENS idiom one level further out.
// uBalloon* are packed by setSurfaceBalloon from buildBalloon's
// convention: center + MARGINED rho (the bound's divisor), R in world
// units, uBalloonFar = BALLOON_FAR_CAP_RHO * raw ball radius.
uniform vec3 uBalloonCenter;
uniform float uBalloonR;
uniform float uBalloonRho;
uniform float uBalloonFar;
// The echo's own tint, packed by packSurfaceBalloonTint: mixed into the
// BASE COLOUR of a shell hit, before lighting, so the shell still shades
// as geometry and the specular stays untinted — the envTint precedent.
// Declared inside this arm, the SURFACE_BULB precedent: no other variant
// pays these bytes. Strength 0 is the default and mix(x, y, 0.0) == x
// exactly, so an unset tint is today's frame byte for byte.
uniform vec3 uBalloonTint;
uniform float uBalloonTintStrength;
// Independent balloon gradient. Disabled is explicit inherit: the shell
// keeps the already-resolved base colour and performs no texture lookup.
uniform sampler2D uBalloonColorLUT;
uniform float uBalloonPaletteEnabled;
#define surfaceDE surfaceDEFractal
#endif
#if SURFACE_ESCAPE
  /** Escape-time render, a LIST: the FORWARD affine (M, t) of every CHAIN
   * LINK and its (kind, w, |w|·sigma_max(M), unused) quartet, uMapCount
   * slots live — the document's own transform list IS the formula
   * sequence (escape-de.ts's THE TRANSFORM LIST IS THE SEQUENCE).
   * Declared INSIDE the arm, the SURFACE_BULB precedent: an array per
   * link is the one uniform block the descent variants would pay real
   * EMITTED bytes for (uniforms are live tokens; they survive the strip)
   * and could never read. t is the PRE-fold offset; the per-iteration offset is the
   * query point (the Mandelbrot form). kind is escape-de.ts's
   * EscapeLinkKind — the three folds, plus the two POWER maps at 4 and 5.
   * BOTH TAILS ARE STILL UNUSED (uEscParams[i].w and uEscRadii[i].w): the
   * one flag this wire has gained since rides uEscLogForm below instead,
   * because it is one number per CHAIN and not
   * one per link. */
  uniform mat3 uEscM[MAX_MAPS];
  uniform vec3 uEscT[MAX_MAPS];
  uniform vec4 uEscParams[MAX_MAPS];
  /** Each LINK's own fold lengths, SQUARED for the sphere pair:
   * (minRadius^2, fixedRadius^2, boxLimit, unused), which is the form
   * EscapeLink keeps and the form fR2/clamp(r2, mR2, fR2) wants. A chain
   * may hold a different apparatus per link, so this is per-slot like the
   * three above and not a single uniform. */
  uniform vec4 uEscRadii[MAX_MAPS];
  /** Read the terminal radius through the Boettcher/Green's form 0.5*r*ln
   * r / dr (1) or the fold family's linear r / dr (0) —
   * EscapeDE.logEstimate, which is true exactly when some link is a POWER
   * map. A chain-level flag and not a per-link one: the estimate is read
   * once, after the orbit, and making it depend on WHICH link happened to
   * terminate would put a 1.4x step across every boundary between the two
   * (the multiplier 0.5*ln r is continuous in r; a per-link switch would
   * not be). This is the flag the block above once reserved a params tail
   * for — a scalar instead, since a per-link slot is the wrong shape for
   * one number per chain (the WGSL kernel, whose params block has no
   * scalars to spare, does
   * ride that tail). */
  uniform int uEscLogForm;

#if SURFACE_SHAPE_TRAP
  /** The shape trap's LIVE pose/mode quantities (escape-de.ts's
   * resolveShapeTrap fields; the shape GEOMETRY is baked below at
   * resolve time, the WGSL core's create-time decision). uTrapPose is
   * (position.xyz, invScale); uTrapParams is (mode, threshold, fade,
   * unused) — the same value set as the WGSL trapP lane in this arm's own
   * idiom. Declared INSIDE the arm, the uBulb* precedent: no other
   * variant pays these bytes. */
  uniform mat3 uTrapInvRot;
  uniform vec4 uTrapPose;
  uniform vec4 uTrapParams;
#if SURFACE_TRAP_GEOMETRY
  /** Inclusive zero-based post-link levels whose posed SDF joins the
   * escape set. Geometry is a resolved arm so color-only traps keep their
   * shipped source and arithmetic byte for byte. */
  uniform ivec2 uTrapGeometryLevels;
#endif
//__SURFACE_TRAP_SDF__
#if SURFACE_TRAP_GEOMETRY
  /** The one pose/SDF evaluation shared by geometry and color in the
   * hit-info orbit. The similarity's value factor is restored only at the
   * geometry use site by dividing through invScale. */
  float trapLocalSdf(vec3 pOrbit) {
    vec3 tl = (uTrapInvRot * (pOrbit - uTrapPose.xyz)) * uTrapPose.w;
    return surfaceTrapSdf(tl);
  }
  float trapCandidateFromLocal(float localSdf, int stepIdx) {
    return localSdf * __SURFACE_TRAP_INV_NORM__ *
      (1.0 + uTrapParams.z * float(stepIdx));
  }
#else
  /** escape-de.ts's shapeTrapCandidate in f32 — pose inverse WITHOUT the
   * value factor (distances in the shape's own local units), normalized
   * by the baked bounding radius so the channel is scale-relative, then
   * the fade-by-index weight. */
  float trapCandidate(vec3 pOrbit, int stepIdx) {
    vec3 tl = (uTrapInvRot * (pOrbit - uTrapPose.xyz)) * uTrapPose.w;
    return surfaceTrapSdf(tl) * __SURFACE_TRAP_INV_NORM__ *
      (1.0 + uTrapParams.z * float(stepIdx));
  }
#endif
  /** escape-de.ts's shapeTrapValue: min mode clamps the closest weighted
   * approach; threshold mode sweeps the first crossing over
   * [0, threshold] and reads 1.0 when nothing crossed (the resolver
   * floors the threshold, so the division is total). */
  float trapValue(float best, float cross) {
    if (uTrapParams.x < 0.5) {
      return clamp(best, 0.0, 1.0);
    }
    if (cross <= ${SHAPE_TRAP_NO_CROSSING}) {
      return 1.0;
    }
    return clamp(cross / uTrapParams.y, 0.0, 1.0);
  }

#endif
  /** escape-de.ts's foldQueryIntoSector — the kaleidoscope as a
   * QUERY-SPACE wedge fold, applied ONCE before the orbit (never inside
   * it: the escape set of v <- F(v) + p inherits a rotation only when F
   * commutes with it, which no added rotation arranges). The fold is
   * DIHEDRAL, rotations AND mirrors, and that is forced rather than
   * chosen — the cyclic fold the chaos game uses JUMPS across sector
   * seams, and a discontinuous map has no Lipschitz bound at all, so the
   * estimate would certify empty balls straight through the seam. g is
   * 1-Lipschitz and an isometry per sector, so the orbit is seeded AND
   * offset by g(p), the rendered set is exactly g^-1(M), and neither the
   * marching ball nor dr's "+ 1" needs a new term (the oracle's module
   * doc carries the argument). uSymOrder <= 1 returns the point
   * untouched, which is what keeps an unsymmetrised document
   * bit-identical to the pre-kaleidoscope escape arm's. Plane codes are
   * surface-de.ts's SYM_PLANE_CODE (0 = yz, 1 = xz, 2 = xy), and the two
   * axes per plane are the oracle's own ia/ib. Landing exactly on a
   * sector boundary is consistent either way a round() breaks the tie
   * (the two roundings differ by a reflection the mirror then undoes), so
   * GLSL's implementation-defined
   * half-way rule costs nothing here. */
  vec3 foldQuerySector(vec3 p) {
    if (uSymOrder <= 1) {
      return p;
    }
    float a = uSymPlane == 0 ? p.y : p.x;
    float b = uSymPlane == 2 ? p.y : p.z;
    float sector = 6.283185307179586 / float(uSymOrder);
    // Rotate BACK by the nearest whole sector, then mirror across the
    // first axis: a composition of half-space reflections, hence the
    // reflection group's fundamental-domain retraction.
    float turn = round(atan(b, a) / sector) * sector;
    float c = cos(turn);
    float s = sin(turn);
    float fa = a * c + b * s;
    float fb = abs(b * c - a * s);
    if (uSymPlane == 0) {
      return vec3(p.x, fa, fb);
    }
    if (uSymPlane == 1) {
      return vec3(fa, p.y, fb);
    }
    return vec3(fa, fb, p.z);
  }

  /** The SURFACE_BULB arm's bulbPow8, duplicated CHARACTER FOR CHARACTER:
   * the two forward-orbit arms are ALTERNATIVES — each replaces the
   * descent bodies wholesale, so surfaceFragmentFor refuses the pair and
   * neither can see a definition emitted inside the other — and a chain
   * LINK of kind 4 needs this map. Both mirror variations.ts's
   * triplexPow8, which is the definition; the test that
   * diffs the two arms' bodies is what keeps this copy honest. */
  vec3 bulbPow8(vec3 y, float r2) {
    float a = y.x * y.x + y.y * y.y;
    float z2 = y.z * y.z;
    float r4 = r2 * r2;
    float vz = 128.0 * z2 * z2 * z2 * z2 - 256.0 * z2 * z2 * z2 * r2 +
      160.0 * z2 * z2 * r4 - 32.0 * z2 * r4 * r2 + r4 * r4;
    float s = 128.0 * z2 * z2 * z2 * y.z - 192.0 * z2 * z2 * y.z * r2 +
      80.0 * z2 * y.z * r4 - 8.0 * y.z * r4 * r2;
    float rho = sqrt(a);
    float inv = rho > 0.0 ? 1.0 / rho : 0.0;
    float u1 = y.x * inv;
    float v1 = y.y * inv;
    float u2 = u1 * u1 - v1 * v1;
    float v2 = 2.0 * u1 * v1;
    float u4 = u2 * u2 - v2 * v2;
    float v4 = 2.0 * u2 * v2;
    float u8 = u4 * u4 - v4 * v4;
    float v8 = 2.0 * u4 * v4;
    return vec3(rho * s * u8, rho * s * v8, vz);
  }

  /**
   * Escape-time fold DE, CYCLING through the chain, mirroring
   * escape-de.ts's estimateEscapeDistance: iterate the chain's fold maps
   * FORWARD from the query with ONE shared scalar running derivative (the
   * Buddhi/Rrrola Mandelbox form), DE = |v| / dr. This variant REPLACES
   * the inverse-descent bodies wholesale — the whole #else arm below is
   * not compiled — and it is phone-cheap: ~30 branchless folds per link
   * per evaluation, no frontier, no branches. cutoff is accepted for
   * signature parity and ignored: the loop is fixed-cost, so the full
   * value is always returned, trivially satisfying the cutoff contract
   * (every return IS the cutoff-0 result).
   *
   * CYCLING, NOT CHAINING (the oracle's measured verdict):
   * Mandelbulber2's seq->GetSequence(i) — step i applies link i mod n,
   * with "+ q" and the bailout test after EACH link, never after all n
   * (chaining lets n folds compound between derivative floors and fattens
   * the set to 37.1% of the bailout ball at six links against cycling's
   * 0.2%, which is the "object WAS its own bounding sphere" defect the
   * Mandelbrot form fixed, returning). A PASS is one full cycle, so the
   * loop runs uMaxDepth * uMapCount single- link steps and uMaxDepth
   * keeps meaning "how many times is each link applied" at any chain
   * length — the preview tier's depth clamp included.
   */
  float surfaceDE(vec3 p, float cutoff) {
    vec3 q = foldQuerySector(p);
    vec3 v = q;
    float dr = 1.0;
    float r = length(v);
    int n = uMapCount;
    int steps = uMaxDepth * n;
    int li = 0;
#if SURFACE_TRAP_GEOMETRY
    float trapDistance = 1.0e30;
#endif
    for (int i = 0; i < steps; i++) {
      if (r > uBoundingRadius) {
        break;
      }
      vec4 prm = uEscParams[li];
      int kind = int(prm.x);
      vec3 y = uEscM[li] * v + uEscT[li];
      float localL = 1.0;
      // The FOLD family, GUARDED. The two tests below are exhaustive by
      // NEGATION over {1, 2, 3} alone, so a power kind has to be kept out
      // of them rather than added beside them — kind 4 satisfies both !=
      // 2 and != 1 and would silently run both folds.
      // (surface-de-gpu.ts's module doc names exactly that hazard as the
      // reason the Mandelbulb became a sixth CORE rather than a fourth
      // kind; the guard is what makes a fourth and fifth kind safe on
      // this one.)
      if (kind < 4) {
        if (kind != 2) {
          // The box fold (boxfold + mandelbox): per-axis reflections,
          // local factor 1.
          y = clamp(y, -uEscRadii[li].z, uEscRadii[li].z) * 2.0 - y;
        }
        if (kind != 1) {
          // The sphere fold (spherefold + mandelbox): variations.ts's
          // sphereFoldFactor, which IS the local conformal factor.
          float f = uEscRadii[li].y / clamp(dot(y, y), uEscRadii[li].x, uEscRadii[li].y);
          y *= f;
          localL = f;
        }
      } else if (kind == 4) {
        // The triplex 8th power. 8*r^7 is its radial/polar stretch —
        // bulb-de.ts's HEURISTIC factor, under-reading the azimuthal
        // stretch by up to 8x at the poles, which is the same class of
        // slack the folds contribute.
        float r2y = dot(y, y);
        localL = 8.0 * (r2y * r2y * r2y * sqrt(r2y));
        y = bulbPow8(y, r2y);
      } else {
        // The quaternion square on span{1, i, j}, closed there because
        // the v x v term drops. Its 2*|y| is EXACT rather than a
        // bound (quaternion norms multiply) — qjulia-de.ts's certified
        // factor, and the one certified term in the chain's product.
        localL = 2.0 * length(y);
        y = vec3(y.x * y.x - y.y * y.y - y.z * y.z, 2.0 * y.x * y.y, 2.0 * y.x * y.z);
      }
      // The Mandelbrot form's offset — the QUERY POINT (folded before the
      // orbit), not the document's t (which stays the pre-fold offset
      // inside y above).
      v = prm.y * y + q;
      // EVERY LINK CONTRIBUTES ITS OWN FACTOR to the one shared dr, and
      // the "+ 1" — the per-link offset's own derivative — floors it once
      // per link rather than once per pass.
      dr = prm.z * localL * dr + 1.0;
      r = length(v);
#if SURFACE_TRAP_GEOMETRY
      if (i >= uTrapGeometryLevels.x && i <= uTrapGeometryLevels.y) {
        float tLocal = trapLocalSdf(v);
        trapDistance = min(
          trapDistance,
          ${SHAPE_MARCH_SAFETY} * tLocal / (uTrapPose.w * dr)
        );
      }
#endif
      li++;
      if (li == n) {
        li = 0;
      }
    }
#if SURFACE_TRAP_GEOMETRY
    float escapeDistance = uEscLogForm == 0
      ? r / dr
      : (r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr);
    return min(escapeDistance, trapDistance);
#else
    return uEscLogForm == 0
      ? r / dr
      // The Boettcher/Green's form for a chain that escapes
      // super-exponentially (escape-de.ts's ESTIMATE FORM paragraph).
      // ln r goes NEGATIVE below r = 1, which a converging orbit
      // reaches, and a negative estimate would march the tracer
      // BACKWARDS — returning 0 there is the inside signal and is safe in
      // the direction a sphere tracer needs. bulb-de.ts takes the
      // identical exit.
      : (r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr);
#endif
  }

  float surfaceDE(vec3 p) {
    return surfaceDE(p, 0.0);
  }

  /** Hit-shading overload: the same loop, with the classic escape-time
   * extras — trap is the CONTINUOUS escape fraction (the canonical Mandelbox palette
   * coordinate), rings/sheets are the orbit's closest radial / y-plane
   * approaches, the same trap vocabulary the IFS variants feed the shared
   * color sources. firstChoice is always 0 (a forward orbit chooses no
   * map — a chain applies every link in turn). */
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
#if SURFACE_SHAPE_TRAP
    out float sheets,
    out float shapeTrap
#else
    out float sheets
#endif
  ) {
    firstChoice = 0;
    rings = 1.0;
    sheets = 1.0;
    vec3 q = foldQuerySector(p);
    vec3 v = q;
    float dr = 1.0;
    float r = length(v);
    int n = uMapCount;
    int steps = uMaxDepth * n;
    int li = 0;
    int escapedAt = steps;
    // The growth factor of the link whose application produced the current
    // r — the head link's until a step has run, so a one-link document
    // reads uEscParams[0].z at every step exactly as it did before the
    // chain landed.
    float growth = uEscParams[0].z;
    // And its DEGREE, 0 until a step has run — which is also what a FOLD
    // leaves here, so a fold-only chain reads the constant-factor arm
    // below at every step exactly as it did before.
    float lastPower = 0.0;
#if SURFACE_SHAPE_TRAP
    float trapBest = 1.0e30;
    float trapCross = ${SHAPE_TRAP_NO_CROSSING};
#if SURFACE_TRAP_GEOMETRY
    float trapDistance = 1.0e30;
#endif
#endif
    for (int i = 0; i < steps; i++) {
      if (r > uBoundingRadius) {
        escapedAt = i;
        break;
      }
      vec4 prm = uEscParams[li];
      int kind = int(prm.x);
      vec3 y = uEscM[li] * v + uEscT[li];
      float localL = 1.0;
      // The FOLD family, GUARDED. The two tests below are exhaustive by
      // NEGATION over {1, 2, 3} alone, so a power kind has to be kept out
      // of them rather than added beside them — kind 4 satisfies both !=
      // 2 and != 1 and would silently run both folds.
      // (surface-de-gpu.ts's module doc names exactly that hazard as the
      // reason the Mandelbulb became a sixth CORE rather than a fourth
      // kind; the guard is what makes a fourth and fifth kind safe on
      // this one.)
      if (kind < 4) {
        if (kind != 2) {
          // The box fold (boxfold + mandelbox): per-axis reflections,
          // local factor 1.
          y = clamp(y, -uEscRadii[li].z, uEscRadii[li].z) * 2.0 - y;
        }
        if (kind != 1) {
          // The sphere fold (spherefold + mandelbox): variations.ts's
          // sphereFoldFactor, which IS the local conformal factor.
          float f = uEscRadii[li].y / clamp(dot(y, y), uEscRadii[li].x, uEscRadii[li].y);
          y *= f;
          localL = f;
        }
      } else if (kind == 4) {
        // The triplex 8th power. 8*r^7 is its radial/polar stretch —
        // bulb-de.ts's HEURISTIC factor, under-reading the azimuthal
        // stretch by up to 8x at the poles, which is the same class of
        // slack the folds contribute.
        float r2y = dot(y, y);
        localL = 8.0 * (r2y * r2y * r2y * sqrt(r2y));
        y = bulbPow8(y, r2y);
      } else {
        // The quaternion square on span{1, i, j}, closed there because
        // the v x v term drops. Its 2*|y| is EXACT rather than a
        // bound (quaternion norms multiply) — qjulia-de.ts's certified
        // factor, and the one certified term in the chain's product.
        localL = 2.0 * length(y);
        y = vec3(y.x * y.x - y.y * y.y - y.z * y.z, 2.0 * y.x * y.y, 2.0 * y.x * y.z);
      }
      v = prm.y * y + q;
      dr = prm.z * localL * dr + 1.0;
      r = length(v);
      growth = prm.z;
      // The DEGREE of the link that produced this r — 0 for a fold, which
      // is asymptotically affine and has no exponent to multiply.
      lastPower = kind == 4 ? 8.0 : (kind == 5 ? 2.0 : 0.0);
      rings = min(rings, r / uBoundingRadius);
      sheets = min(sheets, abs(v.y) / uBoundingRadius);
#if SURFACE_SHAPE_TRAP
      // The trap's two accumulators, at exactly the orbit points
      // rings/sheets read (escape-de.ts's ONE formula).
#if SURFACE_TRAP_GEOMETRY
      float tLocal = trapLocalSdf(v);
      float tCand = trapCandidateFromLocal(tLocal, i);
      trapBest = min(trapBest, tCand);
      if (trapCross <= ${SHAPE_TRAP_NO_CROSSING} && tCand < uTrapParams.y) {
        trapCross = tCand;
      }
      if (i >= uTrapGeometryLevels.x && i <= uTrapGeometryLevels.y) {
        trapDistance = min(
          trapDistance,
          ${SHAPE_MARCH_SAFETY} * tLocal / (uTrapPose.w * dr)
        );
      }
#else
      float tCand = trapCandidate(v, i);
      trapBest = min(trapBest, tCand);
      if (trapCross <= ${SHAPE_TRAP_NO_CROSSING} && tCand < uTrapParams.y) {
        trapCross = tCand;
      }
#endif
#endif
      li++;
      if (li == n) {
        li = 0;
      }
    }
    // The CONTINUOUS escape count, not the raw integer. escapedAt is a
    // step function of position, so a palette over it lands adjacent
    // pixels on unrelated colours — confetti, and the more so the finer
    // the structure. Invisible while the escape set was a blob (one
    // iteration count everywhere = one flat colour); the real Mandelbox
    // shows it at once. The orbit leaves the bailout ball by a factor of
    // about growth per step, so how far PAST the radius it landed says
    // where between two counts it really crossed: n -
    // log(r/R)/log(growth). Guarded on having escaped at all (a bounded
    // orbit has r <= R, which would add rather than subtract) and on a
    // growth rate above 1 (below it nothing escapes, and log would flip
    // the sign).
    //
    // The denominator is uMaxDepth, NOT the step budget uMaxDepth * n.
    // escapedAt counts SINGLE-LINK steps and an orbit escapes after a
    // handful of them however long the chain is, so a denominator that
    // multiplies by the link count shrank the reachable slice of the ramp
    // with every link added and a chain painted in the bottom of its
    // palette. The pass budget is chain-length-INVARIANT, which is what a
    // colour coordinate wants; at n = 1 the two are the same expression,
    // so every shipped single-map object renders unchanged, and
    // SURFACE_BULB below has always normalized this way.
    //
    // MEASURED TWICE, by two populations that disagree about the size of
    // the win — recorded together, because the difference is the honest
    // part. Trap [p05 p50 p95]:
    //
    // (a) 20k near-boundary exterior samples per system, drawn uniformly in
    //     the bailout ball and kept where |DE| < 0.02 — the whole surface,
    //     pose-free. Unmoved by the set-extent correction (it never fits
    //     a marching ball), but NOT reproducible from any harness in the
    //     repo either, so read it as a dated record rather than a
    //     re-runnable figure:
    //       mandelboxClassic  1 link  was [0.152 0.291 0.832]  0.9% clamped
    //                                 now  IDENTICAL (same expression)
    //       foldChain         2       was [0.108 0.180 0.716]
    //                                 now [0.216 0.360 1.000] 12.2% clamped
    //       foldChainBoulder  3       was [0.071 0.110 0.575]
    //                                 now [0.214 0.331 1.000] 12.2% clamped
    //       that chain twice  6       was [0.036 0.056 0.439]
    //                                 now [0.215 0.333 1.000] 15.8% clamped
    //
    // (b) chain-speckle.harness.ts's own fixtures, sampled at the PIXELS a
    //     camera actually hits from its pose. TWO READINGS, because that
    //     sheet's marching ball moved under it (the set-extent
    //     correction: fitMarchRadius used to threshold a distance estimate
    //     on a grid, read high, and therefore drew these objects smaller
    //     than they are). The pair from before that correction is what
    //     established the CLAIM:
    //       1 link  was [0.125 0.230 0.757]  now IDENTICAL, 3.99% clamped
    //       2 links was [0.083 0.132 0.313]  now [0.166 0.265 0.626], 1.9%
    //       6 links was [0.043 0.072 0.205]  now [0.256 0.431 1.000], 8.6%
    //     and this is what a run prints TODAY, at the corrected framing —
    //     the sheet computes the clamp share itself now rather than
    //     leaving it to be quoted from a run nobody can repeat:
    //       1 link  [0.149 0.259 1.000]   6.78% clamped
    //       2 links [0.228 0.430 1.000]  10.59%
    //       6 links [0.317 0.710 1.000]  31.44%
    //
    // WHAT BOTH AGREE ON, and it is the claim: n = 1 is unchanged to the
    // bit, and the SYSTEMATIC per-link collapse is gone. The old medians
    // fell by roughly half with every link or two — 0.291/0.180/0.110/0.056
    // in (a), 0.230/0.132/0.072 in (b) — which is the defect, because it
    // tracked the link count rather than the fractal.
    //
    // WHAT THEY DISAGREE ON: whether the result is FLAT in chain length.
    // In (a) two, three and six links land within 0.03 of each other; in
    // (b) six links lands at 1.9x the single map's median and pins its p95
    // at the clamp. Different systems, different populations, so "flat" is
    // not a property this normalizer has — what it has is the absence of a
    // per-link trend. Where a given chain lands is the chain's business.
    //
    // The disclosed cost is the clamp, and the correction moved it UPWARD:
    // 6.78 / 10.59 / 31.44% of the pixels a camera actually hits at one /
    // two / six links (b), up to 15.8% over the whole surface (a). This
    // comment used to read "1.9-8.6% ... at six links (a); ... whole
    // surface (b)", which was wrong three ways at once — the two
    // population labels were swapped against the lists above, 1.9% is the
    // TWO-link row rather than anything at six, and the pixel figures
    // predate the marching-ball correction, which is what moved them. A
    // smaller object inside a larger frame spends its hit pixels on the
    // SILHOUETTE, where orbits escape early; the corrected frame fills
    // with interior pixels whose orbits survive the budget, so the clamp
    // share rose with everything else in that sheet.
    //
    // The longest-surviving orbits — the deepest creases — share the
    // ramp's top with the never-escaped ones. A better trade than the
    // whole object sharing its bottom, and the number to beat if anyone
    // revisits this with a normalizer that does not clamp. Two measured
    // mitigations from the same run: the RAW integer count clamps the
    // identical pixels (6.78 / 10.61 / 31.44%), so this is the
    // coordinate's own saturation and not something the continuous
    // smoothing introduced; and box-averaged over 16 sub-samples the rows
    // read 0.16 / 0.00 / 0.00%, so the flat top-of-ramp PATCHES are a
    // one-sample artifact rather than regions of the object. Read that
    // second one as DIRECTIONAL: it averages the TRAP over 16 sub-samples
    // where the supersampled settle averages the shaded COLOUR over 8, so
    // the shipped settle lands somewhere short of it. Averaging a pinned
    // sample with an unpinned one does not recover what the clamp
    // discarded either way — but it is not a third of the object painted
    // one colour.
    //
    // A SECOND INTERPOLANT, because which one reads the terminal radius
    // depends on the link that PRODUCED it. A fold grows by a constant
    // factor, so the ratio of logs linearises it; a power map multiplies
    // the exponent, so the count is log(log r / log R) / log d — the
    // SURFACE_BULB arm's own expression, with the link's degree in place
    // of its 8. Single-form was worse than merely imprecise on a power
    // link: a pre-scaled one routinely has growth = |w|*sigma_max BELOW 1,
    // so the guard fired, escFrac fell to 0 and the trap degenerated to
    // the raw integer step function this whole comment exists to have
    // removed — the palette confetti, through the back door.
    //
    // AND IT IS PER-TERMINATING-LINK WHERE THE ESTIMATE FORM (uEscLogForm)
    // IS PER-CHAIN, which reads as a contradiction until you ask what each
    // one is a function of. The estimate's multiplier 0.5*ln r is
    // CONTINUOUS in r, so choosing it per link would put a 1.4x step
    // across every boundary between the two — hence one number for the
    // whole chain. The escape count is a COUNT, and the link that carried
    // the orbit out of the ball is the one whose growth law says how far
    // past it the orbit landed. A chain holding both kinds terminates on
    // either, so a chain-level choice here would paint half its own orbits
    // with the wrong law.
    float escFrac = 0.0;
    if (escapedAt < steps) {
      if (lastPower > 1.0) {
        escFrac = clamp(log(log(r) / log(uBoundingRadius)) / log(lastPower), 0.0, 1.0);
      } else if (growth > 1.0) {
        escFrac = clamp(log(r / uBoundingRadius) / log(growth), 0.0, 1.0);
      }
    }
    trap = clamp((float(escapedAt) - escFrac) / float(uMaxDepth), 0.0, 1.0);
    rings = clamp(rings, 0.0, 1.0);
    sheets = clamp(sheets, 0.0, 1.0);
#if SURFACE_SHAPE_TRAP
    shapeTrap = trapValue(trapBest, trapCross);
#endif
#if SURFACE_TRAP_GEOMETRY
    float escapeDistance = uEscLogForm == 0
      ? r / dr
      : (r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr);
    return min(escapeDistance, trapDistance);
#else
    return uEscLogForm == 0
      ? r / dr
      // The Boettcher/Green's form for a chain that escapes
      // super-exponentially (escape-de.ts's ESTIMATE FORM paragraph).
      // ln r goes NEGATIVE below r = 1, which a converging orbit
      // reaches, and a negative estimate would march the tracer
      // BACKWARDS — returning 0 there is the inside signal and is safe in
      // the direction a sphere tracer needs. bulb-de.ts takes the
      // identical exit.
      : (r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr);
#endif
  }
#else
#if SURFACE_BULB
  /** Mandelbulb render: the FORWARD affine (M, t) of the single
   * triplex-power map and (sigma_max(M), bailout, unused, unused).
   * Declared INSIDE the arm, unlike the escape variant's uEsc* trio: the
   * other variants would pay these EMITTED bytes (uniforms are live
   * tokens; they survive the strip) for uniforms they can never read. t is the PRE-power
   * offset, a live deformation knob with the textbook Mandelbulb at t =
   * 0; the per-iteration offset is derived from the query point (the
   * Mandelbrot form). The BAILOUT rides .y because it is the ORBIT's
   * ball, which — unlike the escape mode's — is NOT uBoundingRadius:
   * that stays the query-space marching ball. */
  uniform mat3 uBulbM;
  uniform vec3 uBulbT;
  uniform vec4 uBulbParams;

#if SURFACE_SHAPE_TRAP
  /** The shape trap's live quantities — the SURFACE_ESCAPE arm's trio
   * character for character (the two forward arms are ALTERNATIVES, so
   * neither can see a definition emitted inside the other; the test that
   * diffs the two arms' bodies keeps the copies honest). */
  uniform mat3 uTrapInvRot;
  uniform vec4 uTrapPose;
  uniform vec4 uTrapParams;
//__SURFACE_TRAP_SDF__
  /** escape-de.ts's shapeTrapCandidate in f32 — pose inverse WITHOUT the
   * value factor (distances in the shape's own local units), normalized
   * by the baked bounding radius so the channel is scale-relative, then
   * the fade-by-index weight. */
  float trapCandidate(vec3 pOrbit, int stepIdx) {
    vec3 tl = (uTrapInvRot * (pOrbit - uTrapPose.xyz)) * uTrapPose.w;
    return surfaceTrapSdf(tl) * __SURFACE_TRAP_INV_NORM__ *
      (1.0 + uTrapParams.z * float(stepIdx));
  }
  /** escape-de.ts's shapeTrapValue: min mode clamps the closest weighted
   * approach; threshold mode sweeps the first crossing over
   * [0, threshold] and reads 1.0 when nothing crossed (the resolver
   * floors the threshold, so the division is total). */
  float trapValue(float best, float cross) {
    if (uTrapParams.x < 0.5) {
      return clamp(best, 0.0, 1.0);
    }
    if (cross <= ${SHAPE_TRAP_NO_CROSSING}) {
      return 1.0;
    }
    return clamp(cross / uTrapParams.y, 0.0, 1.0);
  }

#endif
  /** variations.ts's triplexPow8 — the White/Nylander 8th power in its
   * trig-free form: Chebyshev T8/U7 for the polar angle, three complex
   * squarings (de Moivre) for the azimuth, no transcendentals at all. The
   * power is BAKED IN: triplex multiplication is not associative, so p^8
   * is not ((p^2)^2)^2 (they disagree on 48.8% of queries) and every
   * power needs its own closed form — see bulb-de.ts's BULB_POWER doc.
   * r2 is passed in because every caller already has it. */
  vec3 bulbPow8(vec3 y, float r2) {
    float a = y.x * y.x + y.y * y.y;
    float z2 = y.z * y.z;
    float r4 = r2 * r2;
    float vz = 128.0 * z2 * z2 * z2 * z2 - 256.0 * z2 * z2 * z2 * r2 +
      160.0 * z2 * z2 * r4 - 32.0 * z2 * r4 * r2 + r4 * r4;
    float s = 128.0 * z2 * z2 * z2 * y.z - 192.0 * z2 * z2 * y.z * r2 +
      80.0 * z2 * y.z * r4 - 8.0 * y.z * r4 * r2;
    float rho = sqrt(a);
    float inv = rho > 0.0 ? 1.0 / rho : 0.0;
    float u1 = y.x * inv;
    float v1 = y.y * inv;
    float u2 = u1 * u1 - v1 * v1;
    float v2 = 2.0 * u1 * v1;
    float u4 = u2 * u2 - v2 * v2;
    float v4 = 2.0 * u2 * v2;
    float u8 = u4 * u4 - v4 * v4;
    float v8 = 2.0 * u4 * v4;
    return vec3(rho * s * u8, rho * s * v8, vz);
  }

  /**
   * Mandelbulb DE, mirroring bulb-de.ts's estimateBulbDistance: iterate
   * the single triplex-power map FORWARD from y_0 = M p + t with a scalar
   * running derivative, and read the Boettcher log estimate 0.5 * |y| *
   * ln|y| / dr off |y| — the PRE-power vector, never the post-power one
   * (the oracle's WHICH VECTOR THE ESTIMATE READS paragraph; mixing the
   * two silently renders a different object). This variant REPLACES the
   * inverse-descent bodies wholesale, exactly as SURFACE_ESCAPE does, and
   * is cheaper than that one: uMaxDepth (16 full, preview-clamped)
   * branchless iterations per evaluation, no frontier, no branches.
   * cutoff is accepted for signature parity and ignored: the loop is
   * fixed-cost, so the full value is always returned, trivially
   * satisfying the cutoff contract.
   */
  float surfaceDE(vec3 p, float cutoff) {
    float sigma = uBulbParams.x;
    float bail = uBulbParams.y;
    // y_0 = M p + t — the point the power is applied to, and the
    // Mandelbrot form's per-iteration offset in y space.
    vec3 c = uBulbM * p + uBulbT;
    vec3 y = c;
    // dr bounds |d y_n / d p|, so it starts at |M| rather than 1.
    float dr = sigma;
    float r2 = dot(y, y);
    float r = sqrt(r2);
    for (int i = 0; i < uMaxDepth; i++) {
      if (r > bail) {
        break;
      }
      // 8*r^7 is the triplex power's radial/polar stretch, then M's
      // operator norm, then the offset's own derivative — the last term
      // also FLOORS dr at sigma, which is load-bearing wherever |y| < 1
      // (most of the interior: 8*r^7 SHRINKS there, and an unfloored dr
      // would return a distance vastly larger than the query's own
      // radius).
      dr = 8.0 * (r2 * r2 * r2 * r) * sigma * dr + sigma;
      vec3 v = bulbPow8(y, r2);
      y = uBulbM * v + c;
      r2 = dot(y, y);
      r = sqrt(r2);
    }
    // ln|y| goes NEGATIVE below |y| = 1, which a converging orbit reaches,
    // and a negative estimate would march the tracer BACKWARDS. Returning
    // 0 there is the inside signal and is safe in the direction a sphere
    // tracer needs.
    return r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr;
  }

  float surfaceDE(vec3 p) {
    return surfaceDE(p, 0.0);
  }

  /** Hit-shading overload: the same loop, with the escape family's
   * extras — trap is the CONTINUOUS escape count, rings/sheets the
   * orbit's closest radial / y-plane approaches, normalized by the
   * ORBIT's own ball (the bailout) rather than the query-space marching
   * radius. firstChoice is always 0 (one map). */
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
#if SURFACE_SHAPE_TRAP
    out float sheets,
    out float shapeTrap
#else
    out float sheets
#endif
  ) {
    firstChoice = 0;
    rings = 1.0;
    sheets = 1.0;
    float sigma = uBulbParams.x;
    float bail = uBulbParams.y;
    vec3 c = uBulbM * p + uBulbT;
    vec3 y = c;
    float dr = sigma;
    float r2 = dot(y, y);
    float r = sqrt(r2);
    int escapedAt = uMaxDepth;
#if SURFACE_SHAPE_TRAP
    float trapBest = 1.0e30;
    float trapCross = ${SHAPE_TRAP_NO_CROSSING};
#endif
    for (int i = 0; i < uMaxDepth; i++) {
      if (r > bail) {
        escapedAt = i;
        break;
      }
      dr = 8.0 * (r2 * r2 * r2 * r) * sigma * dr + sigma;
      vec3 v = bulbPow8(y, r2);
      y = uBulbM * v + c;
      r2 = dot(y, y);
      r = sqrt(r2);
      rings = min(rings, r / bail);
      sheets = min(sheets, abs(y.y) / bail);
#if SURFACE_SHAPE_TRAP
      // The trap's two accumulators, at exactly the orbit points
      // rings/sheets read (escape-de.ts's ONE formula).
      float tCand = trapCandidate(y, i);
      trapBest = min(trapBest, tCand);
      if (trapCross <= ${SHAPE_TRAP_NO_CROSSING} && tCand < uTrapParams.y) {
        trapCross = tCand;
      }
#endif
    }
    // The CONTINUOUS escape count, the escape arm's escFrac one map
    // family over — and NOT its formula. There the orbit leaves the
    // bailout ball by a roughly constant FACTOR per step, so how far past
    // the radius it landed is log(r/R)/log(growth); here the radius is
    // raised to the POWER n each step (r -> r^n up to the affine part),
    // so iterating once more takes log r to n*log r and the fraction is
    // the classic smooth iteration count log(log r / log R)/log n — 0
    // when the orbit lands exactly on the ball, 1 when it lands where one
    // more step from the ball would have put it. Guarded on having
    // escaped at all (a bounded orbit has r <= bail, whose log-ratio is
    // below 1 and whose log would flip the sign) and on a bailout above 1
    // (BULB_BAILOUT_FLOOR is 4, so log(bail) is comfortably positive).
    float escFrac = 0.0;
    if (escapedAt < uMaxDepth && bail > 1.0) {
      escFrac = clamp(log(log(r) / log(bail)) / log(8.0), 0.0, 1.0);
    }
    trap = clamp((float(escapedAt) - escFrac) / float(uMaxDepth), 0.0, 1.0);
    rings = clamp(rings, 0.0, 1.0);
    sheets = clamp(sheets, 0.0, 1.0);
#if SURFACE_SHAPE_TRAP
    shapeTrap = trapValue(trapBest, trapCross);
#endif
    return r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr;
  }
#else

#if SURFACE_FOLD_LENS
  // Compile every descent body below under a CORE name: the fold-lens
  // wrapper past the hit variants owns the public surfaceDE overloads and
  // calls these once per lens branch (the oracle's descendLens). With the
  // define off this block vanishes and the bodies keep their shipped
  // names, untouched.
#if SURFACE_BALLOON
  // Under balloon+lens the surfaceDEFractal rename above is still active;
  // a bare re-#define of the same token would be a redefinition error.
  #undef surfaceDE
#endif
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
    // The value below which this descent may stop (the oracle's
    // bailBelow). -1e30 disables the test: a cutoff of 0.0, and a depth-0
    // sphere floor that already holds the answer at or above the cutoff no
    // matter how far best falls, since the floor is what the return clamps
    // to. (That sphere floor case now has its own unconditional exit — the
    // sphere-floor pin below — that fires the moment best reaches it,
    // cutoff or not.)
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
    // Validity chains: they hold the level's rank-3/4 candidates ONLY
    // while their points are in-sphere, and carry no R field — unlike A/B
    // they never fold a terminal (see past the loop), and expansion
    // re-derives every child radius, so the selection radius is dead
    // weight once occupancy is decided.
    vec3 v1Q = vec3(0.0);
    float v1Scale = 1.0;
    bool v1Live = false;
    vec3 v2Q = vec3(0.0);
    float v2Scale = 1.0;
    bool v2Live = false;
#if SURFACE_CHAOS
    int aState = -1;
    int bState = -1;
    int v1State = -1;
    int v2State = -1;
#endif
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (!aLive && !bLive && !v1Live && !v2Live) {
        break;
      }
#if SURFACE_SCHEDULE
      vec4 childBound = surfaceLevelBound(depth + 1);
      float childEscape = surfaceLevelEscape(depth + 1);
      int mapBegin = surfaceLevelMapBegin(depth);
      int mapEnd = surfaceLevelMapEnd(depth);
      int symOrder = surfaceLevelSymOrder(depth);
#endif
#if SURFACE_CONDENSATION
      if (aLive) condensationFold(aQ, aScale, depth
#if SURFACE_CHAOS
        , aState
#endif
        , best);
      if (bLive) condensationFold(bQ, bScale, depth
#if SURFACE_CHAOS
        , bState
#endif
        , best);
      if (v1Live) condensationFold(v1Q, v1Scale, depth
#if SURFACE_CHAOS
        , v1State
#endif
        , best);
      if (v2Live) condensationFold(v2Q, v2Scale, depth
#if SURFACE_CHAOS
        , v2State
#endif
        , best);
      if (best <= sphereBound || best * uFinalSigmaMin < bailBelow) {
        return max(best, sphereBound) * uFinalSigmaMin;
      }
      bool futureCondensation = condensationFutureAfterChild(depth);
#endif
      // The four smallest-key candidates this level, key-ascending. The
      // sentinel r = 0 keeps empty slots out of every escaped-candidate
      // fold below.
      float c1Key = 1e30;
      vec3 c1Q = vec3(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
#if SURFACE_CHAOS
      int c1State = -1;
#endif
      float c2Key = 1e30;
      vec3 c2Q = vec3(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
#if SURFACE_CHAOS
      int c2State = -1;
#endif
      // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
      // by everything the top-2 ladder evicts, so the pair holds exactly
      // the level's third- and fourth-smallest keys.
      float c3Key = 1e30;
      vec3 c3Q = vec3(0.0);
      float c3Scale = 1.0;
      float c3R = 0.0;
      float c3Cert = 0.0;
#if SURFACE_CHAOS
      int c3State = -1;
#endif
      float c4Key = 1e30;
      vec3 c4Q = vec3(0.0);
      float c4Scale = 1.0;
      float c4R = 0.0;
      float c4Cert = 0.0;
#if SURFACE_CHAOS
      int c4State = -1;
#endif
      for (int c = 0; c < 4; c++) {
        vec3 pQ = vec3(0.0);
        float pScale = 1.0;
#if SURFACE_CHAOS
        int pState = -1;
#endif
        if (c == 0) {
          if (!aLive) {
            continue;
          }
          pQ = aQ;
          pScale = aScale;
#if SURFACE_CHAOS
          pState = aState;
#endif
        } else if (c == 1) {
          if (!bLive) {
            continue;
          }
          pQ = bQ;
          pScale = bScale;
#if SURFACE_CHAOS
          pState = bState;
#endif
        } else if (c == 2) {
          if (!v1Live) {
            continue;
          }
          pQ = v1Q;
          pScale = v1Scale;
#if SURFACE_CHAOS
          pState = v1State;
#endif
        } else {
          if (!v2Live) {
            continue;
          }
          pQ = v2Q;
          pScale = v2Scale;
#if SURFACE_CHAOS
          pState = v2State;
#endif
        }
        // Sector sweep: the chain point turns one step per kaleidoscope
        // sector and every BASE map is applied to it there, so the
        // candidates — and their SECTOR-MAJOR enumeration order, the
        // order the expanded slot list was built in — are exactly the
        // ones the expansion produced. The ladders below therefore break
        // ties the same way, and the beam, the validity slots and the
        // cutoff exits see an unchanged stream. See the oracle module's
        // symmetry section for why a single wedge FOLD would not be sound
        // here.
        vec3 sQ = pQ;
#if SURFACE_SCHEDULE
        for (int k = 0; k < symOrder; k++) {
#else
        for (int k = 0; k < uSymOrder; k++) {
#endif
          if (k > 0) {
            sQ = stepSector(sQ);
          }
#if SURFACE_SCHEDULE
          for (int j = mapBegin; j < mapEnd; j++) {
#else
          for (int j = 0; j < uMapCount; j++) {
#endif
#if SURFACE_CHAOS
            int childState = surfaceChaosChildState(depth, j);
            if (!surfaceChaosAllows(pState, childState)) continue;
#endif
            vec3 img = uInvM[j] * sQ + uInvT[j];
#if SURFACE_SCHEDULE
            float r = length(img - childBound.xyz);
            float key = pScale * (r - childBound.w);
#else
            float r = length(img - uBoundCenter);
            float key = pScale * (r - uBoundingRadius);
#endif
            float childScale = pScale * uSigmaMin[j];
#if SURFACE_CONDENSATION
            condensationFold(img, childScale, depth + 1
#if SURFACE_CHAOS
              , childState
#endif
              , best);
#endif
#if SURFACE_SCHEDULE
            float cert = childScale * (r - childBound.w);
#else
            float cert = childScale * (r - uBoundingRadius);
#endif
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
#if SURFACE_CHAOS
            int eState = childState;
#endif
            if (key < c1Key) {
              eKey = c2Key;
              eQ = c2Q;
              eScale = c2Scale;
              eR = c2R;
              eCert = c2Cert;
#if SURFACE_CHAOS
              eState = c2State;
#endif
              c2Key = c1Key;
              c2Q = c1Q;
              c2Scale = c1Scale;
              c2R = c1R;
              c2Cert = c1Cert;
#if SURFACE_CHAOS
              c2State = c1State;
#endif
              c1Key = key;
              c1Q = img;
              c1Scale = childScale;
              c1R = r;
              c1Cert = cert;
#if SURFACE_CHAOS
              c1State = childState;
#endif
            } else if (key < c2Key) {
              eKey = c2Key;
              eQ = c2Q;
              eScale = c2Scale;
              eR = c2R;
              eCert = c2Cert;
#if SURFACE_CHAOS
              eState = c2State;
#endif
              c2Key = key;
              c2Q = img;
              c2Scale = childScale;
              c2R = r;
              c2Cert = cert;
#if SURFACE_CHAOS
              c2State = childState;
#endif
            }
            // Spill into the rank-3/4 ladder (unconditional at width 4);
            // what THAT evicts (or the spilled tuple itself, when it beats
            // neither slot) falls through to the fold below.
            if (eKey < c3Key) {
#if SURFACE_CONDENSATION
              // Keep the sentinel/occupancy key paired with the evicted
              // tuple: future condensation distinguishes an actual in-ball
              // eviction from the empty r=0 slot through this lane.
              float tKey = c4Key;
#else
              // The evicted key is dead past this point — only the folded
              // fields (point, scale, radius, certificate) survive; width 4
              // is hardcoded here, so there is no tKey.
#endif
              vec3 tQ = c4Q;
              float tScale = c4Scale;
              float tR = c4R;
              float tCert = c4Cert;
#if SURFACE_CHAOS
              int tState = c4State;
#endif
              c4Key = c3Key;
              c4Q = c3Q;
              c4Scale = c3Scale;
              c4R = c3R;
              c4Cert = c3Cert;
#if SURFACE_CHAOS
              c4State = c3State;
#endif
              c3Key = eKey;
              c3Q = eQ;
              c3Scale = eScale;
              c3R = eR;
              c3Cert = eCert;
#if SURFACE_CHAOS
              c3State = eState;
#endif
#if SURFACE_CONDENSATION
              eKey = tKey;
#endif
              eQ = tQ;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
#if SURFACE_CHAOS
              eState = tState;
#endif
            } else if (eKey < c4Key) {
#if SURFACE_CONDENSATION
              float tKey = c4Key;
#endif
              vec3 tQ = c4Q;
              float tScale = c4Scale;
              float tR = c4R;
              float tCert = c4Cert;
#if SURFACE_CHAOS
              int tState = c4State;
#endif
              c4Key = eKey;
              c4Q = eQ;
              c4Scale = eScale;
              c4R = eR;
              c4Cert = eCert;
#if SURFACE_CHAOS
              c4State = eState;
#endif
#if SURFACE_CONDENSATION
              eKey = tKey;
#endif
              eQ = tQ;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
#if SURFACE_CHAOS
              eState = tState;
#endif
            }
            // The tuple leaving the beam frontier: escaped candidates fold
            // their REFINED certificate (one extra Hutchinson level closes
            // the barely-escaped-sibling balloon) — skipped whole when its
            // plain certificate cannot beat the running min anyway (the
            // oracle's laziness guard, bit-exact); an in-sphere tuple
            // carries no positive certificate — it can only get here past
            // FOUR smaller keys, the (shrunken) residual drop the validity
            // slots left.
#if SURFACE_SCHEDULE
            if (eR > childBound.w && eCert < best) {
#else
            if (eR > uBoundingRadius && eCert < best) {
#endif
#if SURFACE_CONDENSATION || SURFACE_SCHEDULE || SURFACE_CHAOS
#if SURFACE_CHAOS
              best = min(
                best,
                refinedCert(eQ, eR, eScale, depth + 1, eState)
              );
#else
              best = min(best, refinedCert(eQ, eR, eScale, depth + 1));
#endif
#else
              best = min(best, refinedCert(eQ, eR, eScale));
#endif
              // Cutoff exit plus the sphere-floor pin: the folded
              // certificate is FINALIZED (already refined), and best only
              // falls from here. Once best is at or below sphereBound the
              // return is already pinned at sphereBound * uFinalSigmaMin
              // no matter how much further best still falls, so that case
              // exits unconditionally; short of it, the settled verdict
              // against the caller's cutoff means the rest of the descent
              // cannot lift it back either.
              if (best <= sphereBound || best * uFinalSigmaMin < bailBelow) {
                return max(best, sphereBound) * uFinalSigmaMin;
              }
#if SURFACE_CONDENSATION
#if SURFACE_SCHEDULE
            } else if (eKey < 1e29 && futureCondensation && eR <= childBound.w) {
#else
            } else if (eKey < 1e29 && futureCondensation && eR <= uBoundingRadius) {
#endif
#if SURFACE_SCHEDULE
              best = min(best, eScale * (eR - childBound.w));
#else
              best = min(best, eScale * (eR - uBoundingRadius));
#endif
#endif
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
#if SURFACE_SCHEDULE
        if (c1R > childEscape) {
#else
        if (c1R > uEscapeRadius) {
#endif
          best = min(best, c1Cert);
        } else {
          aQ = c1Q;
          aScale = c1Scale;
          aR = c1R;
#if SURFACE_CHAOS
          aState = c1State;
#endif
          aLive = true;
        }
      }
      if (c2Key < 1e29) {
#if SURFACE_SCHEDULE
        if (c2R > childEscape) {
#else
        if (c2R > uEscapeRadius) {
#endif
          best = min(best, c2Cert);
        } else {
          bQ = c2Q;
          bScale = c2Scale;
          bR = c2R;
#if SURFACE_CHAOS
          bState = c2State;
#endif
          bLive = true;
        }
      }
      if (c3Key < 1e29) {
#if SURFACE_SCHEDULE
        if (c3R > childBound.w) {
#else
        if (c3R > uBoundingRadius) {
#endif
          if (c3Cert < best) {
#if SURFACE_CONDENSATION || SURFACE_SCHEDULE || SURFACE_CHAOS
#if SURFACE_CHAOS
            best = min(
              best,
              refinedCert(c3Q, c3R, c3Scale, depth + 1, c3State)
            );
#else
            best = min(best, refinedCert(c3Q, c3R, c3Scale, depth + 1));
#endif
#else
            best = min(best, refinedCert(c3Q, c3R, c3Scale));
#endif
          }
        } else {
          v1Q = c3Q;
          v1Scale = c3Scale;
#if SURFACE_CHAOS
          v1State = c3State;
#endif
          v1Live = true;
        }
      }
      if (c4Key < 1e29) {
#if SURFACE_SCHEDULE
        if (c4R > childBound.w) {
#else
        if (c4R > uBoundingRadius) {
#endif
          if (c4Cert < best) {
#if SURFACE_CONDENSATION || SURFACE_SCHEDULE || SURFACE_CHAOS
#if SURFACE_CHAOS
            best = min(
              best,
              refinedCert(c4Q, c4R, c4Scale, depth + 1, c4State)
            );
#else
            best = min(best, refinedCert(c4Q, c4R, c4Scale, depth + 1));
#endif
#else
            best = min(best, refinedCert(c4Q, c4R, c4Scale));
#endif
          }
        } else {
          v2Q = c4Q;
          v2Scale = c4Scale;
#if SURFACE_CHAOS
          v2State = c4State;
#endif
          v2Live = true;
        }
      }
      // Cutoff exit plus the sphere-floor pin, covering the four promote
      // folds above in one test: each either wrote a settled certificate
      // into best (refined at the two validity-slot sites, the
      // deliberately plain escape-radius bound at the other two) or
      // continued a chain, and best only falls from here. Once best is at
      // or below sphereBound the eventual return is already pinned at
      // sphereBound * uFinalSigmaMin, so that case exits unconditionally.
      // Deliberately NOT a break: the terminal bounds past the loop are
      // folds the FULL descent only makes at the depth cap, and folding
      // one here could drop best below a value that descent never
      // reaches.
      if (best <= sphereBound || best * uFinalSigmaMin < bailBelow) {
        return max(best, sphereBound) * uFinalSigmaMin;
      }
    }
    // Terminal bound of chains alive at the depth cap (the KIFS last-value
    // formula): non-positive when the chain tracked the attractor all the
    // way down.
#if SURFACE_CONDENSATION
    if (aLive) condensationFold(aQ, aScale, uMaxDepth
#if SURFACE_CHAOS
      , aState
#endif
      , best);
    if (bLive) condensationFold(bQ, bScale, uMaxDepth
#if SURFACE_CHAOS
      , bState
#endif
      , best);
    if (v1Live) condensationFold(v1Q, v1Scale, uMaxDepth
#if SURFACE_CHAOS
      , v1State
#endif
      , best);
    if (v2Live) condensationFold(v2Q, v2Scale, uMaxDepth
#if SURFACE_CHAOS
      , v2State
#endif
      , best);
#endif
    if (aLive) {
#if SURFACE_SCHEDULE
      vec4 terminalBound = surfaceLevelBound(uMaxDepth);
      best = min(best, aScale * (aR - terminalBound.w));
#else
      best = min(best, aScale * (aR - uBoundingRadius));
#endif
    }
    if (bLive) {
#if SURFACE_SCHEDULE
      vec4 terminalBound = surfaceLevelBound(uMaxDepth);
      best = min(best, bScale * (bR - terminalBound.w));
#else
      best = min(best, bScale * (bR - uBoundingRadius));
#endif
    }
    // Validity chains fold NO cap terminal — deliberately asymmetric with
    // A/B. In-sphere means inside the bounding SPHERE, not near the
    // attractor, so a validity chain's cap terminal is a vacuous negative
    // bound that can only ever pull the estimate toward a fabricated hit
    // (the membrane direction the validity-slot record calls the visually
    // harmful one), never fix a real one — the piece it tracks sits within
    // sigmaMax_chain * 2R of the query, sub-resolution wherever the depth
    // cap is not clamped. Measured (the beam harness, all systems, both
    // estimators, widths 3/4): folding them changes NOTHING — whenever a
    // validity chain survives to the cap, chain A holds an equal-or-deeper
    // branch whose terminal already dominates — so the fold is omitted on
    // principle, not cost. (The disclosed repro3 void-false-hit uptick, 0
    // -> 2/435 refined at width 4, comes from A's OWN terminal on wanderer
    // branches the validity slots keep alive in-sphere to the depth cap —
    // and in-sphere is not near-attractor, so the KIFS last-value bound is
    // vacuous for them at ANY cap size: re-measured unchanged after the
    // descent-depth ceiling rose from 48 to 128.)
    float d = max(best, sphereBound);
    return d * uFinalSigmaMin;
  }
#endif

${foldValueFormGlsl(shadeDeWidth)}

  /**
   * Hit-shading variant: the SAME refined beam descent as the plain
   * overload — keep the two bodies in lockstep, both mirror
   * estimateDistanceRefined — plus tracer-side extras that are NOT part
   * of the CPU oracle's distance contract (surface-de.ts mirrors distance
   * only). firstChoice is the depth-0 winning candidate's map, keying
   * by-transform color (identical to the old greedy pick: level 0 has one
   * chain at scale 1, so the selection key ranks by radius alone). trap
   * is a flame-style structural blend of the winning candidates' palette
   * coordinates, accumulated TOP-DOWN with geometrically decaying weight
   * (level d weighs uColorSpeed^d, normalized at the end; 0.5 is the
   * classic decay): the depth-0 choice — WHICH top-level copy of the
   * attractor the hit sits in — dominates the final coordinate, matching
   * flam3's convention where the LAST-applied transform dominates a
   * plotted point's color (descent order is application order reversed,
   * so descent level 0 is the most significant digit). The previous blend
   * ran the recurrence deepest-first — address digits that vary
   * sub-pixel, which rendered as per-pixel palette noise with no
   * distinguishable color regions. rings is the classic geometric orbit
   * trap: the winning chain's closest radial approach |image|/R across
   * the descent, min-tracked exactly where the trap blend samples —
   * radial shells in raw attractor space that follow the fractal's own
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
#if SURFACE_PATTERN
#if SURFACE_SCHEDULE
    patternScheduleSource = q;
#endif
#endif
    firstChoice = 0;
#if SURFACE_CONDENSATION
    float condensationBest = 1e30;
#endif
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
#if SURFACE_CHAOS
    int chState = -1;
#endif
    for (int depth = 0; depth < uMaxDepth; depth++) {
      if (!live) {
        break;
      }
#if SURFACE_SCHEDULE
      vec4 childBound = surfaceLevelBound(depth + 1);
      float childEscape = surfaceLevelEscape(depth + 1);
      int mapBegin = surfaceLevelMapBegin(depth);
      int mapEnd = surfaceLevelMapEnd(depth);
      int symOrder = surfaceLevelSymOrder(depth);
#endif
#if SURFACE_CONDENSATION
      condensationFoldHit(
        chQ,
        chScale,
        depth,
#if SURFACE_CHAOS
        chState,
#endif
        condensationBest,
        firstChoice
      );
#endif
      float lbKey = 1e30;
      int lbMap = 0;
      float lbR = 0.0;
      float lbAbsY = 0.0;
      vec3 lbQ = vec3(0.0);
      float lbScale = 1.0;
      float lbFloor = 0.0;
#if SURFACE_CHAOS
      int lbState = -1;
#endif
      float pScale = chScale;
      float pFloor = chFloor;
      vec3 sQ = chQ;
#if SURFACE_SCHEDULE
      for (int k = 0; k < symOrder; k++) {
#else
      for (int k = 0; k < uSymOrder; k++) {
#endif
        if (k > 0) {
          sQ = stepSector(sQ);
        }
#if SURFACE_SCHEDULE
        for (int j = mapBegin; j < mapEnd; j++) {
#else
        for (int j = 0; j < uMapCount; j++) {
#endif
#if SURFACE_CHAOS
          int childState = surfaceChaosChildState(depth, j);
          if (!surfaceChaosAllows(chState, childState)) continue;
#endif
          vec4 fp = uFoldParams[j];
          int kind = int(fp.x);
          int branchCount =
            kind == 0 ? 1 : (kind == 1 ? 27 : (kind == 2 ? 3 : 81));
          float absW = fp.z / uSigmaMin[j];
          FoldRadii fr = foldRadiiOf(uFoldRadii[j].xyz);
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
              pre1 = fr.wall2 - u;
              pre2 = -fr.wall2 - u;
              dUp = max(u - fr.wall, 0.0);
              dDn = max(-fr.wall - u, 0.0);
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
                  sfRd = max(fr.fixedR - ru, 0.0);
                } else if (s == 1) {
                  v = fr.innerScale * u;
                  sfSigma = fr.innerSigma;
                  sfRd = max(ru - fr.outputR, 0.0);
                } else {
                  if (ru < fr.midMinR) {
                    if (kind == 3) {
                      b += 26;
                    }
                    continue;
                  }
                  float invR2 = fr.fixedR2 / (ru * ru);
                  v = u * invR2;
                  sfSigma = ru * fr.invFixedR;
                  sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
                }
                if (kind == 3) {
                  pre0 = v;
                  pre1 = fr.wall2 - v;
                  pre2 = -fr.wall2 - v;
                  dUp = max(v - fr.wall, 0.0);
                  dDn = max(-fr.wall - v, 0.0);
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
#if SURFACE_SCHEDULE
            float r = length(img - childBound.xyz);
#else
            float r = length(img - uBoundCenter);
#endif
            float candFloor = pFloor;
            if (branchRd > 0.0) {
              candFloor = max(candFloor, pScale * absW * branchRd);
            }
#if SURFACE_SCHEDULE
            float key = pScale * (r - childBound.w);
#else
            float key = pScale * (r - uBoundingRadius);
#endif
#if SURFACE_CONDENSATION
            condensationFoldHit(
              img,
              pScale * branchSigma,
              depth + 1,
#if SURFACE_CHAOS
              childState,
#endif
              condensationBest,
              firstChoice
            );
#endif
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
#if SURFACE_CHAOS
              lbState = childState;
#endif
            }
          }
        }
      }
      if (lbKey >= 1e29) {
        break;
      }
#if SURFACE_CONDENSATION
#if SURFACE_SCHEDULE
      if (
        depth == uScheduleDepth &&
        lbScale * (lbR - childBound.w) < condensationBest
      ) {
#else
      if (depth == 0 && lbScale * (lbR - uBoundingRadius) < condensationBest) {
#endif
#else
#if SURFACE_SCHEDULE
      if (depth == uScheduleDepth) {
#else
      if (depth == 0) {
#endif
#endif
        firstChoice = lbMap;
      }
#if SURFACE_SCHEDULE
#if SURFACE_PATTERN
      if (depth + 1 == uScheduleDepth) patternScheduleSource = lbQ;
#endif
      if (depth >= uScheduleDepth) {
        trapAcc += trapW * uFoldParams[lbMap].w;
        trapNorm += trapW;
        trapW *= uColorSpeed;
      }
      rings = min(rings, lbR / childBound.w);
      sheets = min(sheets, lbAbsY / childBound.w);
      if (lbR > childEscape) {
#else
      trapAcc += trapW * uFoldParams[lbMap].w;
      trapNorm += trapW;
      trapW *= uColorSpeed;
      rings = min(rings, lbR / uBoundingRadius);
      sheets = min(sheets, lbAbsY / uBoundingRadius);
      if (lbR > uEscapeRadius) {
#endif
        live = false;
      } else {
        chQ = lbQ;
        chScale = lbScale;
        chFloor = lbFloor;
#if SURFACE_CHAOS
        chState = lbState;
#endif
      }
    }
#if SURFACE_CONDENSATION
    if (live) {
      condensationFoldHit(
        chQ,
        chScale,
        uMaxDepth,
#if SURFACE_CHAOS
        chState,
#endif
        condensationBest,
        firstChoice
      );
    }
#endif
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
#if SURFACE_PATTERN
#if SURFACE_SCHEDULE
    patternScheduleSource = q;
#endif
#endif
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
    // Validity chains: they hold the level's rank-3/4 candidates ONLY
    // while their points are in-sphere, and carry no R field — unlike A/B
    // they never fold a terminal (see past the loop), and expansion
    // re-derives every child radius, so the selection radius is dead
    // weight once occupancy is decided.
    vec3 v1Q = vec3(0.0);
    float v1Scale = 1.0;
    bool v1Live = false;
    vec3 v2Q = vec3(0.0);
    float v2Scale = 1.0;
    bool v2Live = false;
#if SURFACE_CHAOS
    int aState = -1;
    int bState = -1;
    int v1State = -1;
    int v2State = -1;
#endif
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
#if SURFACE_SCHEDULE
      vec4 childBound = surfaceLevelBound(depth + 1);
      float childEscape = surfaceLevelEscape(depth + 1);
      int mapBegin = surfaceLevelMapBegin(depth);
      int mapEnd = surfaceLevelMapEnd(depth);
      int symOrder = surfaceLevelSymOrder(depth);
#endif
#if SURFACE_CONDENSATION
      if (aLive) condensationFoldHit(aQ, aScale, depth,
#if SURFACE_CHAOS
        aState,
#endif
        best, firstChoice);
      if (bLive) condensationFoldHit(bQ, bScale, depth,
#if SURFACE_CHAOS
        bState,
#endif
        best, firstChoice);
      if (v1Live) condensationFoldHit(v1Q, v1Scale, depth,
#if SURFACE_CHAOS
        v1State,
#endif
        best, firstChoice);
      if (v2Live) condensationFoldHit(v2Q, v2Scale, depth,
#if SURFACE_CHAOS
        v2State,
#endif
        best, firstChoice);
      bool futureCondensation = condensationFutureAfterChild(depth);
#endif
      float c1Key = 1e30;
      vec3 c1Q = vec3(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
      int c1Map = 0;
#if SURFACE_CHAOS
      int c1State = -1;
#endif
      float c2Key = 1e30;
      vec3 c2Q = vec3(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
#if SURFACE_CHAOS
      int c2State = -1;
#endif
      // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
      // by everything the top-2 ladder evicts, so the pair holds exactly
      // the level's third- and fourth-smallest keys.
      float c3Key = 1e30;
      vec3 c3Q = vec3(0.0);
      float c3Scale = 1.0;
      float c3R = 0.0;
      float c3Cert = 0.0;
#if SURFACE_CHAOS
      int c3State = -1;
#endif
      float c4Key = 1e30;
      vec3 c4Q = vec3(0.0);
      float c4Scale = 1.0;
      float c4R = 0.0;
      float c4Cert = 0.0;
#if SURFACE_CHAOS
      int c4State = -1;
#endif
      for (int c = 0; c < 4; c++) {
        vec3 pQ = vec3(0.0);
        float pScale = 1.0;
#if SURFACE_CHAOS
        int pState = -1;
#endif
        if (c == 0) {
          if (!aLive) {
            continue;
          }
          pQ = aQ;
          pScale = aScale;
#if SURFACE_CHAOS
          pState = aState;
#endif
        } else if (c == 1) {
          if (!bLive) {
            continue;
          }
          pQ = bQ;
          pScale = bScale;
#if SURFACE_CHAOS
          pState = bState;
#endif
        } else if (c == 2) {
          if (!v1Live) {
            continue;
          }
          pQ = v1Q;
          pScale = v1Scale;
#if SURFACE_CHAOS
          pState = v1State;
#endif
        } else {
          if (!v2Live) {
            continue;
          }
          pQ = v2Q;
          pScale = v2Scale;
#if SURFACE_CHAOS
          pState = v2State;
#endif
        }
        // Sector sweep: the chain point turns one step per kaleidoscope
        // sector and every BASE map is applied to it there, so the
        // candidates — and their SECTOR-MAJOR enumeration order, the
        // order the expanded slot list was built in — are exactly the
        // ones the expansion produced. The ladders below therefore break
        // ties the same way, and the beam, the validity slots and the
        // cutoff exits see an unchanged stream. See the oracle module's
        // symmetry section for why a single wedge FOLD would not be sound
        // here.
        vec3 sQ = pQ;
#if SURFACE_SCHEDULE
        for (int k = 0; k < symOrder; k++) {
#else
        for (int k = 0; k < uSymOrder; k++) {
#endif
          if (k > 0) {
            sQ = stepSector(sQ);
          }
#if SURFACE_SCHEDULE
          for (int j = mapBegin; j < mapEnd; j++) {
#else
          for (int j = 0; j < uMapCount; j++) {
#endif
#if SURFACE_CHAOS
            int childState = surfaceChaosChildState(depth, j);
            if (!surfaceChaosAllows(pState, childState)) continue;
#endif
            vec3 img = uInvM[j] * sQ + uInvT[j];
#if SURFACE_SCHEDULE
            float r = length(img - childBound.xyz);
            float key = pScale * (r - childBound.w);
#else
            float r = length(img - uBoundCenter);
            float key = pScale * (r - uBoundingRadius);
#endif
            float childScale = pScale * uSigmaMin[j];
#if SURFACE_CONDENSATION
            condensationFoldHit(
              img,
              childScale,
              depth + 1,
#if SURFACE_CHAOS
              childState,
#endif
              best,
              firstChoice
            );
#endif
#if SURFACE_SCHEDULE
            float cert = childScale * (r - childBound.w);
#else
            float cert = childScale * (r - uBoundingRadius);
#endif
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
#if SURFACE_CHAOS
            int eState = childState;
#endif
            if (key < c1Key) {
              eKey = c2Key;
              eQ = c2Q;
              eScale = c2Scale;
              eR = c2R;
              eCert = c2Cert;
#if SURFACE_CHAOS
              eState = c2State;
#endif
              c2Key = c1Key;
              c2Q = c1Q;
              c2Scale = c1Scale;
              c2R = c1R;
              c2Cert = c1Cert;
#if SURFACE_CHAOS
              c2State = c1State;
#endif
              c1Key = key;
              c1Q = img;
              c1Scale = childScale;
              c1R = r;
              c1Cert = cert;
              c1Map = j;
#if SURFACE_CHAOS
              c1State = childState;
#endif
            } else if (key < c2Key) {
              eKey = c2Key;
              eQ = c2Q;
              eScale = c2Scale;
              eR = c2R;
              eCert = c2Cert;
#if SURFACE_CHAOS
              eState = c2State;
#endif
              c2Key = key;
              c2Q = img;
              c2Scale = childScale;
              c2R = r;
              c2Cert = cert;
#if SURFACE_CHAOS
              c2State = childState;
#endif
            }
            // Spill into the rank-3/4 ladder (unconditional at width 4);
            // what THAT evicts (or the spilled tuple itself, when it beats
            // neither slot) falls through to the fold below.
            if (eKey < c3Key) {
#if SURFACE_CONDENSATION
              // Keep the sentinel/occupancy key paired with the evicted
              // tuple; see the value body's identical ladder above.
              float tKey = c4Key;
#else
              // The evicted key is dead past this point — only the folded
              // fields (point, scale, radius, certificate) survive; width 4
              // is hardcoded here, so there is no tKey.
#endif
              vec3 tQ = c4Q;
              float tScale = c4Scale;
              float tR = c4R;
              float tCert = c4Cert;
#if SURFACE_CHAOS
              int tState = c4State;
#endif
              c4Key = c3Key;
              c4Q = c3Q;
              c4Scale = c3Scale;
              c4R = c3R;
              c4Cert = c3Cert;
#if SURFACE_CHAOS
              c4State = c3State;
#endif
              c3Key = eKey;
              c3Q = eQ;
              c3Scale = eScale;
              c3R = eR;
              c3Cert = eCert;
#if SURFACE_CHAOS
              c3State = eState;
#endif
#if SURFACE_CONDENSATION
              eKey = tKey;
#endif
              eQ = tQ;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
#if SURFACE_CHAOS
              eState = tState;
#endif
            } else if (eKey < c4Key) {
#if SURFACE_CONDENSATION
              float tKey = c4Key;
#endif
              vec3 tQ = c4Q;
              float tScale = c4Scale;
              float tR = c4R;
              float tCert = c4Cert;
#if SURFACE_CHAOS
              int tState = c4State;
#endif
              c4Key = eKey;
              c4Q = eQ;
              c4Scale = eScale;
              c4R = eR;
              c4Cert = eCert;
#if SURFACE_CHAOS
              c4State = eState;
#endif
#if SURFACE_CONDENSATION
              eKey = tKey;
#endif
              eQ = tQ;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
#if SURFACE_CHAOS
              eState = tState;
#endif
            }
            // The tuple leaving the beam frontier: escaped candidates fold
            // their REFINED certificate (one extra Hutchinson level closes
            // the barely-escaped-sibling balloon) — skipped whole when its
            // plain certificate cannot beat the running min anyway (the
            // oracle's laziness guard, bit-exact); an in-sphere tuple
            // carries no positive certificate — it can only get here past
            // FOUR smaller keys, the (shrunken) residual drop the validity
            // slots left.
#if SURFACE_SCHEDULE
            if (eR > childBound.w && eCert < best) {
#else
            if (eR > uBoundingRadius && eCert < best) {
#endif
#if SURFACE_CONDENSATION || SURFACE_SCHEDULE || SURFACE_CHAOS
#if SURFACE_CHAOS
              best = min(
                best,
                refinedCert(eQ, eR, eScale, depth + 1, eState)
              );
#else
              best = min(best, refinedCert(eQ, eR, eScale, depth + 1));
#endif
#else
              best = min(best, refinedCert(eQ, eR, eScale));
#endif
#if SURFACE_CONDENSATION
#if SURFACE_SCHEDULE
            } else if (eKey < 1e29 && futureCondensation && eR <= childBound.w) {
              best = min(best, eScale * (eR - childBound.w));
#else
            } else if (eKey < 1e29 && futureCondensation && eR <= uBoundingRadius) {
              best = min(best, eScale * (eR - uBoundingRadius));
#endif
#endif
            }
          }
        }
      }
#if SURFACE_CONDENSATION
#if SURFACE_SCHEDULE
      if (depth == uScheduleDepth && c1Cert < best) {
#else
      if (depth == 0 && c1Cert < best) {
#endif
#else
#if SURFACE_SCHEDULE
      if (depth == uScheduleDepth) {
#else
      if (depth == 0) {
#endif
#endif
        firstChoice = c1Map;
      }
#if SURFACE_SCHEDULE
#if SURFACE_PATTERN
      if (depth + 1 == uScheduleDepth) patternScheduleSource = c1Q;
#endif
      if (depth >= uScheduleDepth) {
        trapAcc += trapW * uTrapIndex[c1Map];
        trapNorm += trapW;
        trapW *= uColorSpeed;
      }
      rings = min(rings, c1R / childBound.w);
      sheets = min(sheets, abs(c1Q.y) / childBound.w);
#else
      trapAcc += trapW * uTrapIndex[c1Map];
      trapNorm += trapW;
      trapW *= uColorSpeed;
      rings = min(rings, c1R / uBoundingRadius);
      sheets = min(sheets, abs(c1Q.y) / uBoundingRadius);
#endif
      aLive = false;
      bLive = false;
      v1Live = false;
      v2Live = false;
      if (c1Key < 1e29) {
#if SURFACE_SCHEDULE
        if (c1R > childEscape) {
#else
        if (c1R > uEscapeRadius) {
#endif
          best = min(best, c1Cert);
        } else {
          aQ = c1Q;
          aScale = c1Scale;
          aR = c1R;
#if SURFACE_CHAOS
          aState = c1State;
#endif
          aLive = true;
        }
      }
      if (c2Key < 1e29) {
#if SURFACE_SCHEDULE
        if (c2R > childEscape) {
#else
        if (c2R > uEscapeRadius) {
#endif
          best = min(best, c2Cert);
        } else {
          bQ = c2Q;
          bScale = c2Scale;
          bR = c2R;
#if SURFACE_CHAOS
          bState = c2State;
#endif
          bLive = true;
        }
      }
      if (c3Key < 1e29) {
#if SURFACE_SCHEDULE
        if (c3R > childBound.w) {
#else
        if (c3R > uBoundingRadius) {
#endif
          if (c3Cert < best) {
#if SURFACE_CONDENSATION || SURFACE_SCHEDULE || SURFACE_CHAOS
#if SURFACE_CHAOS
            best = min(
              best,
              refinedCert(c3Q, c3R, c3Scale, depth + 1, c3State)
            );
#else
            best = min(best, refinedCert(c3Q, c3R, c3Scale, depth + 1));
#endif
#else
            best = min(best, refinedCert(c3Q, c3R, c3Scale));
#endif
          }
        } else {
          v1Q = c3Q;
          v1Scale = c3Scale;
#if SURFACE_CHAOS
          v1State = c3State;
#endif
          v1Live = true;
        }
      }
      if (c4Key < 1e29) {
#if SURFACE_SCHEDULE
        if (c4R > childBound.w) {
#else
        if (c4R > uBoundingRadius) {
#endif
          if (c4Cert < best) {
#if SURFACE_CONDENSATION || SURFACE_SCHEDULE || SURFACE_CHAOS
#if SURFACE_CHAOS
            best = min(
              best,
              refinedCert(c4Q, c4R, c4Scale, depth + 1, c4State)
            );
#else
            best = min(best, refinedCert(c4Q, c4R, c4Scale, depth + 1));
#endif
#else
            best = min(best, refinedCert(c4Q, c4R, c4Scale));
#endif
          }
        } else {
          v2Q = c4Q;
          v2Scale = c4Scale;
#if SURFACE_CHAOS
          v2State = c4State;
#endif
          v2Live = true;
        }
      }
    }
#if SURFACE_CONDENSATION
    if (aLive) condensationFoldHit(aQ, aScale, uMaxDepth,
#if SURFACE_CHAOS
      aState,
#endif
      best, firstChoice);
    if (bLive) condensationFoldHit(bQ, bScale, uMaxDepth,
#if SURFACE_CHAOS
      bState,
#endif
      best, firstChoice);
    if (v1Live) condensationFoldHit(v1Q, v1Scale, uMaxDepth,
#if SURFACE_CHAOS
      v1State,
#endif
      best, firstChoice);
    if (v2Live) condensationFoldHit(v2Q, v2Scale, uMaxDepth,
#if SURFACE_CHAOS
      v2State,
#endif
      best, firstChoice);
#endif
    if (aLive) {
#if SURFACE_SCHEDULE
      vec4 terminalBound = surfaceLevelBound(uMaxDepth);
      best = min(best, aScale * (aR - terminalBound.w));
#else
      best = min(best, aScale * (aR - uBoundingRadius));
#endif
    }
    if (bLive) {
#if SURFACE_SCHEDULE
      vec4 terminalBound = surfaceLevelBound(uMaxDepth);
      best = min(best, bScale * (bR - terminalBound.w));
#else
      best = min(best, bScale * (bR - uBoundingRadius));
#endif
    }
    // Validity chains fold NO cap terminal — deliberately asymmetric with
    // A/B. In-sphere means inside the bounding SPHERE, not near the
    // attractor, so a validity chain's cap terminal is a vacuous negative
    // bound that can only ever pull the estimate toward a fabricated hit
    // (the membrane direction the validity-slot record calls the visually
    // harmful one), never fix a real one — the piece it tracks sits within
    // sigmaMax_chain * 2R of the query, sub-resolution wherever the depth
    // cap is not clamped. Measured (the beam harness, all systems, both
    // estimators, widths 3/4): folding them changes NOTHING — whenever a
    // validity chain survives to the cap, chain A holds an equal-or-deeper
    // branch whose terminal already dominates — so the fold is omitted on
    // principle, not cost. (The disclosed repro3 void-false-hit uptick, 0
    // -> 2/435 refined at width 4, comes from A's OWN terminal on wanderer
    // branches the validity slots keep alive in-sphere to the depth cap —
    // and in-sphere is not near-attractor, so the KIFS last-value bound is
    // vacuous for them at ANY cap size: re-measured unchanged after the
    // descent-depth ceiling rose from 48 to 128.) Normalize the top-down
    // blend. Every call that can reach a hit runs depth 0 (uMapCount >= 1,
    // chains start live), so trapNorm >= 1; the guard just keeps a
    // zero-map placeholder call from dividing by zero.
    trap = trapNorm > 0.0 ? trapAcc / trapNorm : 0.0;
    rings = clamp(rings, 0.0, 1.0);
    sheets = clamp(sheets, 0.0, 1.0);
    float d = max(best, sphereBound);
    return d * uFinalSigmaMin;
  }
#endif

#if SURFACE_FOLD_LENS
  #undef surfaceDE
#if SURFACE_BALLOON
  // The lens wrapper owns the variant's PUBLIC names — which under the
  // balloon are surfaceDEFractal (the balloon wrapper past main()'s
  // prologue owns surfaceDE itself), so re-establish the rename.
  #define surfaceDE surfaceDEFractal
#endif
  /**
   * Pure-fold FINAL lens, mirroring the oracle's descendLens line for
   * line: the visible set is F(A) with F = w*V(M p + t), so each of V's
   * inverse branches seeds one root descent through the untouched cores
   * above (uFinal* is packed identity when this define is on), with the
   * fold branch vocabulary — preimage, conformal sigma, region floor —
   * lifted one level to the query. The estimate is the min over branch
   * terms, floored by the visible-set sphere bound. Prunes (region floor
   * vs best, sphere certificate vs best, visible-sphere pin) are
   * value-exact — see the oracle's doc for the argument, and the cutoff
   * contract note there for why inner descents receive min(best, cutoff)
   * / factor.
   */
  float surfaceDE(vec3 p, float cutoff) {
    float visBound = length(p) - uVisibleRadius;
    int kind = int(uLensParams.x);
    float absW = uLensParams.z;
    vec3 u = p * uLensParams.y;
    FoldRadii fr = foldRadiiOf(uLensRadii);
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
      pre1 = fr.wall2 - u;
      pre2 = -fr.wall2 - u;
      dUp = max(u - fr.wall, 0.0);
      dDn = max(-fr.wall - u, 0.0);
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
          sfRd = max(fr.fixedR - ru, 0.0);
        } else if (s == 1) {
          v = fr.innerScale * u;
          sfSigma = fr.innerSigma;
          sfRd = max(ru - fr.outputR, 0.0);
        } else {
          if (ru < fr.midMinR) {
            // Shell guard (the oracle's): fold the settled shell bound,
            // skip the branch + its box expansion.
            float shellCert = absW * (fr.fixedR - ru);
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
          float invR2 = fr.fixedR2 / (ru * ru);
          v = u * invR2;
          sfSigma = ru * fr.invFixedR;
          sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
        }
        if (kind == 3) {
          pre0 = v;
          pre1 = fr.wall2 - v;
          pre2 = -fr.wall2 - v;
          dUp = max(v - fr.wall, 0.0);
          dDn = max(-fr.wall - v, 0.0);
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
#if SURFACE_PATTERN
  // The fold-lens hit-info overload's winning core query, published for the
  // pattern arm in main() (see the assignment in that overload's epilogue).
  vec3 patternFoldLensSource;
#endif

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
    FoldRadii fr = foldRadiiOf(uLensRadii);
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
      pre1 = fr.wall2 - u;
      pre2 = -fr.wall2 - u;
      dUp = max(u - fr.wall, 0.0);
      dDn = max(-fr.wall - u, 0.0);
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
          sfRd = max(fr.fixedR - ru, 0.0);
        } else if (s == 1) {
          v = fr.innerScale * u;
          sfSigma = fr.innerSigma;
          sfRd = max(ru - fr.outputR, 0.0);
        } else {
          if (ru < fr.midMinR) {
            if (kind == 3) {
              b += 26;
            }
            continue;
          }
          float invR2 = fr.fixedR2 / (ru * ru);
          v = u * invR2;
          sfSigma = ru * fr.invFixedR;
          sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
        }
        if (kind == 3) {
          pre0 = v;
          pre1 = fr.wall2 - v;
          pre2 = -fr.wall2 - v;
          dUp = max(v - fr.wall, 0.0);
          dDn = max(-fr.wall - v, 0.0);
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
#if SURFACE_PATTERN
    // The pattern arm's source-hit handoff: a fold final is multivalued, so
    // the pattern evaluator cannot invent one matrix inverse — it must use
    // the WINNING branch's already-resolved core query (the frame oracle's
    // foldFinalSourceHit). The hit-info overload below is the only place
    // that point exists, so it publishes it here for main()'s pattern arm
    // to read (surface-pattern-frame.ts's contract, verbatim).
    patternFoldLensSource = bestQ;
#endif
    return surfaceDECore(bestQ, firstChoice, trap, rings, sheets);
  }
#endif

// Closes SURFACE_BULB's #else arm, then SURFACE_ESCAPE's: everything
// from the fold-lens rename through the lens wrapper exists only when
// NEITHER forward-orbit variant (escape, bulb) is on.
#endif
#endif

#if SURFACE_BALLOON
#undef surfaceDE
  // The balloon union: fractal/balloon-de.ts's estimateBalloonDistance
  // mirrored term for term over the variant's public DE. min(DE(p),
  // (|p-c|/rho)*DE(I(p))) is conservative at every R; the shell cutoff
  // scales by the inverse of its value factor so the cutoff early-exit
  // contract survives verbatim (the oracle's module doc carries the
  // argument).
  vec3 balloonInvert(vec3 p, out float scale) {
    vec3 d = p - uBalloonCenter;
    // f32 floor: 1e-6 * rho (the explorer echo's precedent, scene.ts) —
    // the CPU oracle's 1e-12 would drown in dot(d,d)'s f32 rounding
    // near c.
    float fl = 1.0e-6 * uBalloonRho;
    float r2 = max(dot(d, d), fl * fl);
    float r = max(length(d), fl);
    scale = r / uBalloonRho;
    return uBalloonCenter + (uBalloonR * uBalloonR / r2) * d;
  }
  // The union requires its inner estimator to be far-field SOUND — a true
  // lower bound on distance for queries outside the ball. The certified
  // IFS descents are (far queries exit through the value-exact sphere
  // floor), but the escape DE's zero-iteration far value is |q|/dr = |q|
  // — not a distance to anything — and the plain march never evaluates it
  // (the visible-sphere gate starts rays at the ball). The balloon march
  // DOES: unclamped, the very first step from the camera blew through the
  // whole scene and every ray missed (measured — a black frame). The
  // clamp below is exactly the certified far-field the IFS cores already
  // have: the set lives inside the bailout ball, so |q| - R_ball is a
  // true conservative bound out there; inside the ball the escape
  // heuristic applies unchanged (a claim-class note). NOTE the
  // app never routes an escape session here anymore — the escape solid's
  // interior reaches the ball center, so its echo swallows the camera
  // (scene.setEscapeSystem's measured-degeneracy comment) — but the
  // combination stays source-valid and the clamp records the far-field
  // requirement for any future composition.
  float balloonInnerDE(vec3 p, float cutoff) {
#if SURFACE_ESCAPE
    float rrEsc = length(p);
    if (rrEsc > uBoundingRadius) return rrEsc - uBoundingRadius;
#endif
#if SURFACE_BULB
    // The bulb DE needs the identical far-field clamp: its zero-iteration
    // far value is 0.5*|y|*ln|y|/sigma, likewise not a distance to
    // anything, and the set lives inside the same marching ball. A
    // separate #if rather than a compound condition, so both names stay
    // JS-resolved (resolveVariantArms) and no dead text ever reaches the
    // driver.
    float rrBulb = length(p);
    if (rrBulb > uBoundingRadius) return rrBulb - uBoundingRadius;
#endif
    return surfaceDEFractal(p, cutoff);
  }
  float balloonInnerDE(vec3 p) {
#if SURFACE_ESCAPE
    float rrEsc = length(p);
    if (rrEsc > uBoundingRadius) return rrEsc - uBoundingRadius;
#endif
#if SURFACE_BULB
    float rrBulb = length(p);
    if (rrBulb > uBoundingRadius) return rrBulb - uBoundingRadius;
#endif
    return surfaceDEFractal(p);
  }
  float surfaceDE(vec3 p, float cutoff) {
    float dF = balloonInnerDE(p, cutoff);
    float scale;
    vec3 q = balloonInvert(p, scale);
    float dS =
      scale * balloonInnerDE(q, cutoff > 0.0 ? cutoff / scale : 0.0);
    return min(dS, dF);
  }
  // Composes over the variant's own NO-CUTOFF form, never the cutoff form
  // above: fold systems route that form to the width-1 probe, and
  // building on the cutoff form would silently upgrade every normal/AO
  // tap back to the full-width descent — the 23.8x shading regression.
  float surfaceDE(vec3 p) {
    float dF = balloonInnerDE(p);
    float scale;
    vec3 q = balloonInvert(p, scale);
    float dS = scale * balloonInnerDE(q);
    return min(dS, dF);
  }
  // Hit-info with argmin routing (the oracle's attribution convention:
  // ties -> fractal). The descent runs at the winning term's own query
  // point; colorPos reports that point so the height/radius color sources
  // read the shell's SOURCE geometry instead of clamping at the far wall.
  // shell mirrors the same argmin as a 0/1 flag — 1.0 when the inverted
  // echo term won, 0.0 on the fractal term or a tie — so the caller can
  // restrict the tint mix to shell hits alone.
  float surfaceDEBalloonHitInfo(
    vec3 p,
    out vec3 colorPos,
    out float shell,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets
  ) {
    float dF = balloonInnerDE(p);
    float scale;
    vec3 q = balloonInvert(p, scale);
    float dS = scale * balloonInnerDE(q);
    if (dS < dF) {
      colorPos = q;
      shell = 1.0;
      return scale * surfaceDEFractal(q, firstChoice, trap, rings, sheets);
    }
    colorPos = p;
    shell = 0.0;
    return surfaceDEFractal(p, firstChoice, trap, rings, sheets);
  }

#endif
#if SURFACE_GROUND_PLANE
  /** Ground plane: an infinite one-sided floor at y = uGroundY, dropped
   * below the session ball (uGroundBallC/uGroundBallR — balloonBall's
   * convention for IFS, the origin bailout ball for escape; certified to
   * contain the visible set), receiving the fractal's penumbra shadow.
   * Only rays that MISS the fractal reach it: the ball sits strictly
   * above the plane, so along any downward ray every possible surface hit
   * precedes the plane crossing — the floor can never occlude geometry.
   * Uniforms live in this arm rather than the shared block so the OFF
   * variants' resolved source stays
   * byte-identical (the uBalloonCenter precedent). */
  /** The out param cov is the trace-alpha coverage flag: 1 where the
   * floor was actually lit, 0 where this function returned the caller's
   * own backdrop. The WebGPU arm counts a PLANE terminal for exactly
   * those pixels, so the two engines' blank-frame arithmetic agrees on a
   * document with a floor. */
  vec3 shadeGroundPlane(
    vec3 ro,
    vec3 rd,
    vec3 background,
    out float cov,
    out float layerCoverage,
    out float layerFog,
    out float layerDepth
  ) {
    cov = 0.0;
    layerCoverage = 0.0;
    layerFog = 0.0;
    layerDepth = 0.0;
    // One-sided: visible from above only; parallel or climbing rays miss.
    if (ro.y <= uGroundY || rd.y >= -1.0e-6) {
      return background;
    }
    float tp = (uGroundY - ro.y) / rd.y;
    vec3 hp = ro + rd * tp;
    vec2 rel = hp.xz - uGroundBallC.xz;
    // Scene-anchored radial fade to the pixel's own backdrop color, so
    // neither a disc edge nor a hard horizon ever shows; past the far
    // band the floor IS the background and the shading below is skipped.
    float fade =
      1.0 - smoothstep(uGroundFadeStart, uGroundFadeEnd, length(rel));
    if (fade <= 0.0) {
      return background;
    }
    cov = 1.0;
    layerCoverage = fade;
    layerDepth = dot(hp - ro, uFocusPlane.xyz);

    // Penumbra shadow toward the light: the hit path's DE loop, adapted
    // for a start OUTSIDE the certified ball. Two analytic gates make the
    // infinite floor affordable — cost proportional to the shadow
    // CORRIDOR, not the floor area:
    //  (a) ball behind: with the floor >= 1.02 R below the center, a
    //      shadow ray whose closest approach to the ball center lies at
    //      or behind its start keeps 8 d / ts >= 1 everywhere (d is at
    //      least |p - C| - R along it, and min_s 8 (sqrt(s^2 + D^2) - R)
    //      / s ~ 8 (0.992 D - R) >= 0 once D >= 1.008 R) — shadow is
    //      exactly 1, zero DE evals.
    //  (b) corridor: a closest approach clearing 1.05 R + 0.3 * along
    //      keeps the penumbra ratio provably >= 1 against the 8 / ts
    //      sharpening (numerically margined across the corridor's
    //      geometries) — again shadow 1 for free. The margin errs toward
    //      marching; the estimators' far field is their value-exact
    //      sphere floor, so the gated and marched answers agree at the
    //      boundary.
    // Inside the corridor the loop's exit is outside-AND-receding — the
    // hit path's |sp| > 1.05 R alone would fire immediately down here.
    float shadow = 1.0;
    vec3 toC = uGroundBallC - hp;
    float along = dot(toC, uLightDir);
    float perp2 = dot(toC, toC) - along * along;
    float corridor = uGroundBallR * 1.05 + 0.3 * along;
    if (along > 0.0 && perp2 < corridor * corridor) {
      float ts = uGroundBallR * 4.0e-4;
      for (int i = 0; i < uShadowSteps; i++) {
        vec3 sp = hp + uLightDir * ts;
        float d = surfaceDE(sp);
        shadow = min(shadow, 8.0 * d / ts);
        ts += clamp(d, uGroundBallR * 2.0e-4, uVisibleRadius * 0.1);
        if (shadow < 0.02 ||
            (dot(sp - uGroundBallC, uLightDir) > 0.0 &&
              length(sp - uGroundBallC) > uGroundBallR * 1.05)) {
          break;
        }
      }
      shadow = clamp(shadow, 0.0, 1.0);
    }

    // Contact occlusion: the hit path's AO taps straight up from the
    // floor, skipped once the floor point is provably beyond every tap's
    // reach of the ball (each tap needs DE < tap height, and DE is at
    // least |hp - C| - hh - R — so |hp - C| >= R + 2 hh_max certifies
    // occlusion 0; 0.02 R of margin on top).
    float ao = 1.0;
    float reach = uGroundBallR * (1.02 + 0.04 * float(uAoTaps));
    vec3 relC = hp - uGroundBallC;
    if (dot(relC, relC) < reach * reach) {
      float occ = 0.0;
      float wgt = 1.0;
      float norm = 0.0;
      for (int i = 1; i <= uAoTaps; i++) {
        float hh = uGroundBallR * 0.02 * float(i);
        occ += wgt *
          clamp((hh - surfaceDE(hp + vec3(0.0, hh, 0.0))) / hh, 0.0, 1.0);
        norm += wgt;
        wgt *= 0.6;
      }
      ao = clamp(1.0 - 0.85 * occ / norm, 0.0, 1.0);
    }

    // The hit path's lighting minus specular (a matte floor), in the same
    // linear space: n is +y, so diffuse is just uLightDir.y.
    float diffuse = max(uLightDir.y, 0.0);
    vec3 lit = (uAmbient * ao + (1.0 - uAmbient) * diffuse * shadow) *
      envTint(vec3(0.0, 1.0, 0.0));
    vec3 floorAlbedo = uGroundAlbedo;
    if (uGroundPattern == 1) {
      float cell = max(uGroundBallR * uGroundTileScale, 1.0e-4);
      vec2 tile = floor((hp.xz - uGroundBallC.xz) / cell);
      float checker = mod(tile.x + tile.y, 2.0);
      floorAlbedo *= mix(0.035, 1.0, checker);
    }
    vec3 floorLinear = pow(floorAlbedo, vec3(2.2));
    vec3 col = pow(
      floorLinear * (lit + vec3(uGroundEmission)),
      vec3(1.0 / 2.2)
    );

    // Depth fog, the hit path's formula at the plane distance: the fog
    // origin is the ray's closest approach to the ball center (clamped to
    // the segment), so the floor under the fractal stays as crisp as the
    // fractal and the fade band fogs like the far wall it is.
    float dist = tp - clamp(dot(uGroundBallC - ro, rd), 0.0, tp);
    float fog =
      1.0 - exp(-0.12 * pow(dist * uFogDensity / max(uVisibleRadius, 1.0e-6), 2.0));
    col = mix(col, mix(background, uFogTint, uFogTintStrength), clamp(fog, 0.0, 1.0));
    layerFog = clamp(fog, 0.0, 1.0);

    return mix(background, col, fade);
  }

#endif
  void main() {
    // The shared background shape at FULL-IMAGE coordinates. This arm
    // always traces the whole image (capture scissors strips out of a
    // full-size target), so vUv IS imageUv — the compute arm, which traces
    // capture BANDS, carries a bgOffset/bgExtent pair instead.
    vec3 background = mix(uBgBottom, uBgTop, backgroundShapeT(vUv));

    // Reconstruct the camera ray by unprojecting this pixel on the near
    // and far clip planes — at the supersampling pass's own point inside
    // the pixel (the pixel centre on every single-pass trace).
    vec2 ndc = (vUv + uPixelJitter.xy) * 2.0 - 1.0;
    vec4 nearP = uInvProjView * vec4(ndc, -1.0, 1.0);
    vec4 farP = uInvProjView * vec4(ndc, 1.0, 1.0);
    vec3 rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
    vec3 ro = uCamPos;

#if SURFACE_BALLOON
    // Balloon mode drops the visible-sphere skip (the oracle module's
    // march-entry semantics): every ray can hit the enclosing shell, so
    // every ray marches from the camera, capped at uBalloonFar past the
    // balloon center — capped rays fall through to the existing background
    // below (the balloon is a HIT, not a background). The sphere entry
    // still seeds the fog origin, so the FRACTAL's own depth fog is
    // unchanged — and for rays that MISS the sphere the origin is the
    // closest-approach depth max(-b, 0), NOT 0: both forms meet at the
    // silhouette (disc -> 0 collapses the entry to -b), so the fog origin
    // is CONTINUOUS across the whole frame. Seeding misses from the camera
    // instead painted the sphere's silhouette as a visibly lighter disc
    // over the shell — same wall, ~|cam| less fog distance inside the disc
    // than one pixel outside it (user-reported on the R=0.99 mid-flip from
    // a far camera). Shell hits nearer than the origin clamp fog at zero
    // (the min just before the fog term).
    float radius = uVisibleRadius * 1.02;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float disc = b * b - c;
    float tFar = length(uCamPos - uBalloonCenter) + uBalloonFar;
    float t = 0.0;
    float tEnter = max(-b - (disc >= 0.0 ? sqrt(disc) : 0.0), 0.0);
#else
    // Entry/exit against the origin-centered sphere bounding the VISIBLE
    // set (small margin so silhouettes right at the bound aren't clipped):
    // solve |ro + t rd|^2 = radius^2. No intersection, or an exit behind
    // the camera, is a miss.
    float radius = uVisibleRadius * 1.02;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) {
#if SURFACE_GROUND_PLANE
      float planeCov;
      float planeLayerCoverage;
      float planeLayerFog;
      float planeLayerDepth;
      outColor = vec4(
        shadeGroundPlane(
          ro,
          rd,
          background,
          planeCov,
          planeLayerCoverage,
          planeLayerFog,
          planeLayerDepth
        ),
        planeCov
      );
      outTraceLayer = traceLayer(
        planeLayerCoverage,
        planeLayerFog,
        planeLayerDepth
      );
#else
      outColor = vec4(background, 0.0);
      outTraceLayer = traceLayer(0.0, 0.0, 0.0);
#endif
      return;
    }
    float sq = sqrt(disc);
    float tFar = -b + sq;
    if (tFar <= 0.0) {
#if SURFACE_GROUND_PLANE
      float planeCovExit;
      float planeLayerCoverageExit;
      float planeLayerFogExit;
      float planeLayerDepthExit;
      outColor = vec4(
        shadeGroundPlane(
          ro,
          rd,
          background,
          planeCovExit,
          planeLayerCoverageExit,
          planeLayerFogExit,
          planeLayerDepthExit
        ),
        planeCovExit
      );
      outTraceLayer = traceLayer(
        planeLayerCoverageExit,
        planeLayerFogExit,
        planeLayerDepthExit
      );
#else
      outColor = vec4(background, 0.0);
      outTraceLayer = traceLayer(0.0, 0.0, 0.0);
#endif
      return;
    }
    float t = max(-b - sq, 0.0);
    // Where the ray enters the bounding sphere — the depth-fog origin.
    float tEnter = t;
#endif

    // Tiny dithered start: just breaks banding on grazing rays. Hashed on
    // the JITTERED pixel so supersampling passes get independent start
    // offsets instead of averaging one banding pattern N times.
    t += hash(gl_FragCoord.xy + uPixelJitter.zw) * uPixelEps * max(t, 1.0);

    // --- sphere trace
    // ------------------------------------------------------- Cone-style
    // hit test: accept once the bound drops below the pixel's angular
    // footprint at that depth (uPixelEps * t — resolution scales with
    // distance), floored so the test can't degenerate at t ~ 0. That same
    // epsilon is handed to the DE as its early-out cutoff: this test is
    // all the step asks of the descent, so the descent may stop as soon as
    // its bound is provably under it. A returned value at or above the
    // epsilon is the full-descent distance bit for bit, so the step length
    // below never drifts. The march runs the plain DE overload; the hit's
    // coloring extras are fetched once below.
    bool hit = false;
    // Whole-ray budget for grid cell skips, SEPARATE from uMarchSteps: a
    // skip is one texel read, orders of magnitude cheaper than the descent
    // uMarchSteps exists to bound, and its conservative floor advances far
    // less than the analytic step it stands in for — charging skips
    // against the march budget shrank the ray's REACH, dissolving
    // far/threaded geometry into dropout speckle. Running dry here only
    // falls through to the analytic step: slower, never wrong.
    int gridSkips = GRID_SKIP_CAP;
    for (int i = 0; i < uMarchSteps; i++) {
      if (t > tFar) {
        break;
      }
      // Acceptance epsilon: tier-independent by design — see
      // uAcceptPixelEps.
      float eps = max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor);
      // Empty-space skip: texture reads against the precomputed grid
      // before paying a descent. The stored floor bounds the distance
      // from ANYWHERE in the sample's cell (surface-grid.ts's validity
      // chain), so a step of g cannot cross the surface — and a floor
      // above eps also proves this sample is no hit, so the analytic DE
      // has nothing to add. Cells outside the grid's certified sphere
      // store 0 and fall through; uStepScale damps the step exactly as
      // the analytic path damps its own, since the floors inherit the
      // same probed-bounding-radius margins the damping exists for.
      // Consecutive skips drain in this inner walk — the same
      // read/compare/step sequence the outer \`continue\` used to
      // produce, bit for bit — so they spend gridSkips, not analytic
      // march steps.
      if (uGridEnabled > 0.5) {
        for (; gridSkips > 0; gridSkips--) {
#if SURFACE_BALLOON
          // A balloon ray marches from the CAMERA out to the far cap
          // rather than across the visible sphere, so most of its samples
          // land OUTSIDE the grid cube — where the sampler's edge clamp
          // hands back a BORDER cell's floor. That floor still bounds the
          // FRACTAL from here (the cube is convex and holds the
          // attractor, so clamping is a projection onto it and can only
          // shorten the distance), but it bounds NOTHING about the SHELL,
          // which at any radius the enable admits lies entirely outside
          // the cube. So an out-of-box sample takes no skip at all — the
          // same in-box restriction the balloon's coverage measurement
          // modelled, whose 18.6-33.2% of steps skipped is the rate AFTER
          // it. Inside the box the stored floor is a valid union bound by
          // that measurement's own per-cell check (surface-grid.ts's
          // balloon section).
          vec3 gridUv = (ro + rd * t) * uGridInvSpan + 0.5;
          if (any(lessThan(gridUv, vec3(0.0))) ||
              any(greaterThan(gridUv, vec3(1.0)))) {
            break;
          }
#endif
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
      // The per-step cone-footprint depth cap runs CPU-side only — see
      // the note above the descent bodies for the measured Mesa link
      // cliff that keeps it out of this shader.
      float d = surfaceDE(ro + rd * t, eps);
      if (d < eps) {
        hit = true;
        break;
      }
      t += d * uStepScale;
    }
    if (!hit) {
      if (t > tFar) {
#if SURFACE_GROUND_PLANE
        // Sphere-exit misses land on the floor. A floor pixel is COVERED
        // when shadeGroundPlane sets planeCovMiss, otherwise it is a MISS.
        float planeCovMiss;
        float planeLayerCoverageMiss;
        float planeLayerFogMiss;
        float planeLayerDepthMiss;
        outColor = vec4(
          shadeGroundPlane(
            ro,
            rd,
            background,
            planeCovMiss,
            planeLayerCoverageMiss,
            planeLayerFogMiss,
            planeLayerDepthMiss
          ),
          planeCovMiss
        );
        outTraceLayer = traceLayer(
          planeLayerCoverageMiss,
          planeLayerFogMiss,
          planeLayerDepthMiss
        );
#else
        outColor = vec4(background, 0.0);
        outTraceLayer = traceLayer(0.0, 0.0, 0.0);
#endif
        return;
      }
      // The trace target's alpha is an invisible status byte: RGBA8 UNORM
      // encodes 0.5 as 128 for EXHAUSTED, distinct from MISS 0 and COVERED
      // 255. RGB remains the same backdrop, and BLIT_FRAGMENT strips the
      // status to presented alpha 1.
      outColor = vec4(background, ${SURFACE_TRACE_EXHAUSTED_ALPHA.toFixed(1)});
      outTraceLayer = traceLayer(0.0, 0.0, 0.0);
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
#if SURFACE_BALLOON
    // Argmin routing: a shell hit's extras come from the descent at its
    // INVERTED query point, and cpos carries that point to the
    // height/radius color sources below.
    vec3 cpos;
    float shell;
    surfaceDEBalloonHitInfo(pos, cpos, shell, firstChoice, trap, rings, sheets);
#else
#if SURFACE_SHAPE_TRAP
    // The trap-carrying forward overload's sixth out — only the
    // escape/bulb arms compile it (surfaceFragmentResolvedFor refuses
    // every other pairing), so this call site can name it plainly.
    float shapeTrap;
    surfaceDE(pos, firstChoice, trap, rings, sheets, shapeTrap);
#else
    surfaceDE(pos, firstChoice, trap, rings, sheets);
#endif
#endif

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
#if SURFACE_CONDENSATION
      base = uMapColor[clamp(firstChoice, 0, uShadeCount - 1)];
#else
      base = uMapColor[clamp(firstChoice, 0, uMapCount - 1)];
#endif
    } else {
      float u;
      if (uColorSource == 1) {
        u = trap;
#if SURFACE_BALLOON
      // The winning term's SOURCE point: a shell hit reads its
      // pre-inversion geometry, so the ramps sweep the same range as the
      // fractal's own instead of clamping at the far wall.
      } else if (uColorSource == 2) {
        u = clamp(cpos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0);
      } else if (uColorSource == 3) {
        u = clamp(length(cpos) / uVisibleRadius, 0.0, 1.0);
#else
      } else if (uColorSource == 2) {
        u = clamp(pos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0);
      } else if (uColorSource == 3) {
        u = clamp(length(pos) / uVisibleRadius, 0.0, 1.0);
#endif
      } else if (uColorSource == 4) {
        u = rings;
#if SURFACE_SHAPE_TRAP
      } else if (uColorSource == 5) {
        u = sheets;
      } else {
        // Source 6, the shape trap — reachable only in trap-carrying
        // sessions (scene.ts resolves the select's value to "transform"
        // for every other one).
        u = shapeTrap;
      }
#else
      } else {
        u = sheets;
      }
#endif
      base = texture(uColorLUT, vec2(u, 0.5)).rgb;
    }
#if SURFACE_BALLOON
    // Renderer-neutral balloon coordinate (balloon-de.ts): the normalized
    // radius of the exact pre-inversion source query whose shell image won.
    // Palette first, then the orthogonal tint mix below. Fractal-term hits
    // and explicit inherit retain the existing base path exactly.
    if (uBalloonPaletteEnabled > 0.5 && shell > 0.5) {
      float balloonU = clamp(
        length(cpos - uBalloonCenter) / uBalloonRho,
        0.0,
        1.0
      );
      float balloonIndex = min(floor(balloonU * 256.0), 255.0);
      base = texture(
        uBalloonColorLUT,
        vec2((balloonIndex + 0.5) / 256.0, 0.5)
      ).rgb;
    }
    // The echo's own tint, on the BASE ALBEDO before lighting — shell
    // restricts it to the inverted term (the oracle's own attribution;
    // ties go to the fractal), so a fractal-term hit is untouched at any
    // strength. strength 0 (the default) makes this mix(base,
    // uBalloonTint, 0.0) == base — today's frame byte for byte.
    base = mix(base, uBalloonTint, uBalloonTintStrength * shell);
#endif
#if SURFACE_PATTERN
    // Patterned albedo, BEFORE lighting and fog — the document's order:
    // color source -> balloon palette -> tint -> pattern -> lighting -> fog.
    // The pattern is object-attached, so the albedo reads the RAW attractor
    // point, reconstructed by reversing the render's remaps in the
    // surface-pattern-frame.ts order (visible hit -> balloon source query
    // -> final inverse; a fold final is multivalued and uses the winning
    // branch's already-resolved core query instead of an invented matrix
    // inverse). The hit's own slot picks its material from the shared B
    // lane; the footprint is the tier-INDEPENDENT acceptance epsilon at the
    // hit depth, normalized by the raw bounding radius, so preview and
    // settle tiers cannot change the material detail.
    vec3 patternSource;
#if SURFACE_SCHEDULE
    patternSource = patternScheduleSource;
    vec4 patternBound = surfaceLevelBound(uScheduleDepth);
    vec3 objectP = (patternSource - patternBound.xyz) / patternBound.w;
    float patternFootprint = uAcceptPixelEps * t / patternBound.w;
#else
#if SURFACE_FOLD_LENS
    patternSource = patternFoldLensSource;
#else
    patternSource = pos;
#if SURFACE_BALLOON
    if (shell > 0.5) {
      patternSource = cpos;
    }
#endif
    patternSource = uFinalInvM * patternSource + uFinalInvT;
#endif
    vec3 objectP = (patternSource - uBoundCenter) / uBoundingRadius;
    float patternFootprint = uAcceptPixelEps * t / uBoundingRadius;
#endif
#if SURFACE_CONDENSATION
    int patternSlot = clamp(firstChoice, 0, uShadeCount - 1);
#else
    int patternSlot = clamp(firstChoice, 0, uMapCount - 1);
#endif
    base = patternShade(
      base,
      objectP,
      uMapFinishB[patternSlot],
      uPatternCalibration,
      sheets,
      patternFootprint
    );
#endif

    // Soft shadow: classic DE penumbra toward the light — the shadow ray's
    // closest approach to a surface, sharpened by 8/ts, starting just off
    // the surface to dodge self-shadowing. Leaving the bounding sphere
    // means fully lit from there on, and near-black penumbras end early.
    float shadow = 1.0;
    float ts = h * 2.0;
    for (int i = 0; i < uShadowSteps; i++) {
      vec3 sp = pos + n * h * 2.0 + uLightDir * ts;
#if SURFACE_BALLOON
      // The balloon receives shadows, never casts them: shadow rays test
      // the FRACTAL alone, so the enclosing shell cannot black out the
      // scene it wraps. Tetra normal and AO stay on the public union
      // forms. balloonInnerDE, not surfaceDEFractal: a shell hit launches
      // this ray from far OUTSIDE the ball, where the escape core's raw
      // far value is unsound (its doc above) — the clamped form both
      // keeps it sound and walks the ray to the ball in a few steps, so
      // the fractal's occlusion is actually tested.
      float d = balloonInnerDE(sp);
#else
      float d = surfaceDE(sp);
#endif
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
    float ao = norm > 0.0
      ? clamp(1.0 - 0.85 * occ / norm, 0.0, 1.0)
      : 1.0;

#if SURFACE_FINISH
    // The hit's depth-0 map picks its AUTHORED finish — surface-finish.ts's
    // finishShade, the fixed formula of the #else branch made parametric,
    // handed this pixel's own backdrop for its reflection and transmission
    // terms. The forward arms (escape, bulb) set firstChoice 0, so there
    // the HEAD transform's finish is the scene's; the caller packs it as
    // the one live slot.
#if SURFACE_CONDENSATION
    int fSlot = clamp(firstChoice, 0, uShadeCount - 1);
#else
    int fSlot = clamp(firstChoice, 0, uMapCount - 1);
#endif
    vec3 col = finishShade(base, pos, n, rd, shadow, ao, background, uMapFinishA[fSlot], uMapFinishB[fSlot]);
#else
    float diffuse = max(dot(n, uLightDir), 0.0);
    vec3 halfVec = normalize(uLightDir - rd);
    float specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;

    vec3 lit = (uAmbient * ao + (1.0 - uAmbient) * diffuse * shadow) *
      envTint(n);
    // Light in linear space (as in voxel-material.ts): base is
    // sRGB-authored (color.ts), so decode with gamma 2.2, apply the
    // light/specular product there, and re-encode for the pass-through
    // canvas (ColorManagement is off). A fully lit, specular-free surface
    // round-trips to base verbatim — the authored-color invariant the rest
    // of the app keeps — while midtones and shadows are no longer crushed
    // ~2x by scaling the gamma encoding itself.
    vec3 linBase = pow(base, vec3(2.2));
    vec3 col = pow(linBase * lit + vec3(specular * shadow), vec3(1.0 / 2.2));
#endif

#if SURFACE_BALLOON
    // A shell hit can land NEARER than the sphere entry seeding the fog
    // origin; clamp so the fog term's pow never sees a negative base
    // (undefined in GLSL) and such hits read fog-free — the march-entry
    // semantics above. tEnter is dead past the fog term.
    tEnter = min(tEnter, t);
#endif
    // Depth fog toward the backdrop: squared-exponential in the distance
    // traveled inside the bounding sphere — ~0.38 haze at the far side (a
    // full 2R chord), a depth cue matching the explorer's fog feel
    // (constants tuned by eye).
    float fog =
      1.0 - exp(-0.12 * pow((t - tEnter) * uFogDensity / max(uVisibleRadius, 1.0e-6), 2.0));
    col = mix(col, mix(background, uFogTint, uFogTintStrength), clamp(fog, 0.0, 1.0));

    // Alpha 1: a HIT. The alpha channel of this tracer's output is a
    // terminal-status flag — 1 where the frame drew something, 0 for a
    // miss, and 0.5 for an exhausted ray — and never an opacity. It is invisible to the
    // user because BLIT_FRAGMENT strips it to 1 at every present (three
    // r163+ creates the canvas alpha:true regardless of the renderer's
    // alpha param, so a coverage-0 pixel reaching the canvas composites
    // the page's own background ADDITIVELY over the pane — measured
    // +#0f1018 on every miss pixel); the one reader is scene.ts's settle
    // fold, which counts it off the TRACE target so the WebGL arm can
    // answer the blank-frame question the WebGPU arm answers from its own
    // per-ray status tally.
    outColor = vec4(col, 1.0);
    outTraceLayer = traceLayer(
      1.0,
      clamp(fog, 0.0, 1.0),
      dot(pos - ro, uFocusPlane.xyz)
    );
  }
`;
}

/** The one shipped fragment source, at the module-load-resolved probe
 * width. */
const SURFACE_FRAGMENT = buildSurfaceFragment(resolveShadeDeWidth());

/**
 * Per-tier march/shading budgets: map-heavy systems (Menger's 20 flat
 * maps, high-order kaleidoscopes — whose sectors cost no slots but still
 * cost inverse applications) pay per DE CALL, which the preview depth
 * clamp can't reduce — so the preview also trims how many DE calls a pixel
 * can spend. All tracer-side (march loop, shadow loop, AO taps, hit-test
 * floor): none of these appear in the CPU oracle's distance contract, so
 * the oracle-mirrored DE bodies are untouched.
 *
 * The full-tier march budget was born at 96 and moved to 160 by the
 * one-sided erosion bug: rays that thread gaps in near geometry or graze a
 * face at a shallow angle legitimately need well over 96 analytic steps at
 * close-up eps, and exhaustion painted background through whole regions of
 * standing geometry (view-dependent dropout speckle — the measured tail:
 * 0.80% of one worst pose's true hits lost at 96, 0.00% at 160 on
 * sierpinski; menger 0.27% -> 0.02%). Cost is bounded where it matters:
 * every full-tier submission is already sliced to measured GPU time by the
 * strip planner, and ordinary rays exit on hit or sphere-exit long before
 * either cap.
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
  uniform sampler2D uLayer;
  uniform int uHasSource;
  uniform int uHasLayer;
  uniform int uComposite;
  /** Final-presentation-only depth of field. The expensive tracers always
   * retain CoC; this runtime branch decides whether a blit filters it. */
  uniform int uDepthOfField;
  /** Tiled compute capture flattens RGB+background on the CPU and carries
   * the sidecar's CoC byte in source alpha. Ordinary live/GLSL paths keep
   * it in uLayer.a. Both modes still force final output alpha to one. */
  uniform int uDofMetadataInSourceAlpha;
  uniform sampler2D uTraceBgImage;
  uniform int uTraceBgKind;
  uniform vec3 uTraceBgTop;
  uniform vec3 uTraceBgBottom;
  uniform int uTraceBgShape;
  uniform vec2 uTraceBgCenter;
  uniform vec2 uTraceBgScale;
  uniform sampler2D uLiveBgImage;
  uniform int uLiveBgKind;
  uniform vec3 uLiveBgTop;
  uniform vec3 uLiveBgBottom;
  uniform int uLiveBgShape;
  uniform vec2 uLiveBgCenter;
  uniform vec2 uLiveBgScale;
  in vec2 vUv;
  layout(location = 0) out vec4 outColor;
  layout(location = 1) out vec4 outLayer;

  float blitBackgroundShapeT(
    vec2 p,
    int shape,
    vec2 center,
    vec2 scale
  ) {
    if (shape == 1) {
      float r = clamp(length((p - center) * scale), 0.0, 1.0);
      return r * r * (3.0 - 2.0 * r);
    }
    return clamp(p.y, 0.0, 1.0);
  }

  vec3 blitBackground(
    sampler2D image,
    int kind,
    vec3 bottom,
    vec3 top,
    int shape,
    vec2 center,
    vec2 scale,
    vec2 p
  ) {
    if (kind == 1) {
      return texture(image, p).rgb;
    }
    return mix(bottom, top, blitBackgroundShapeT(p, shape, center, scale));
  }

  /** Fetch one sample and apply the live-background delta BEFORE it enters
   * the optical gather. This order is load-bearing for background-only
   * edits: every color participating in the blur sees the same live
   * backdrop, so a recolor never needs a retrace and cannot leave a halo
   * baked against the reference backdrop. */
  vec3 blitCompositeSample(vec2 p, out vec4 source, out vec4 layer) {
    source = texture(uSrc, p);
    layer = uHasLayer == 1
      ? texture(uLayer, p)
      : vec4(0.0, 0.0, 1.0, 1.0);
    if (uDepthOfField == 1) {
      // Color and beta retain the targets' linear filtering, especially when
      // a low-resolution preview is stretched. Coverage and signed depth are
      // classifications: fetch their nearest stored texel so interpolation
      // cannot invent a false focal layer between foreground and backdrop.
      ivec2 sourceSize = textureSize(uSrc, 0);
      ivec2 sourcePixel = clamp(
        ivec2(p * vec2(sourceSize)),
        ivec2(0),
        sourceSize - ivec2(1)
      );
      if (uDofMetadataInSourceAlpha == 1) {
        source.a = texelFetch(uSrc, sourcePixel, 0).a;
      } else if (uHasLayer == 1) {
        ivec2 layerSize = textureSize(uLayer, 0);
        ivec2 layerPixel = clamp(
          ivec2(p * vec2(layerSize)),
          ivec2(0),
          layerSize - ivec2(1)
        );
        vec4 nearestLayer = texelFetch(uLayer, layerPixel, 0);
        layer.r = nearestLayer.r;
        layer.a = nearestLayer.a;
      }
    }
    vec3 rgb = source.rgb;
    if (uComposite == 1) {
      vec3 liveBg = blitBackground(
        uLiveBgImage,
        uLiveBgKind,
        uLiveBgBottom,
        uLiveBgTop,
        uLiveBgShape,
        uLiveBgCenter,
        uLiveBgScale,
        p
      );
      vec3 traceBg = blitBackground(
        uTraceBgImage,
        uTraceBgKind,
        uTraceBgBottom,
        uTraceBgTop,
        uTraceBgShape,
        uTraceBgCenter,
        uTraceBgScale,
        p
      );
      rgb += layer.b * (liveBg - traceBg);
    }
    return rgb;
  }

  /** Decode the tracer's exact byte-domain map. Source-alpha capture reserves
   * byte 255 for uncovered and caps covered far geometry at 254, retaining a
   * one-byte coverage distinction without another full-image attachment. */
  float blitSignedCoc(vec4 source, vec4 layer, out float coverage) {
    float encoded;
    if (uDofMetadataInSourceAlpha == 1) {
      encoded = source.a;
      coverage = encoded < (254.5 / 255.0) ? 1.0 : 0.0;
    } else {
      encoded = layer.a;
      coverage = layer.r;
    }
    return clamp((encoded * 255.0 - 128.0) / 127.0, -1.0, 1.0);
  }

  /** Eight deterministic Poisson-ish offsets plus the separately sampled
   * center below: fixed work, no resolution- or blur-dependent loop count. */
  const vec2 DOF_TAPS[8] = vec2[8](
    vec2( 0.314,  0.125),
    vec2(-0.236,  0.352),
    vec2(-0.421, -0.146),
    vec2( 0.181, -0.487),
    vec2( 0.658,  0.326),
    vec2(-0.611,  0.513),
    vec2(-0.704, -0.458),
    vec2( 0.529, -0.733)
  );

  vec3 blitDecodeLight(vec3 rgb) {
    return pow(max(rgb, vec3(0.0)), vec3(2.2));
  }

  vec3 blitEncodeLight(vec3 rgb) {
    return pow(max(rgb, vec3(0.0)), vec3(1.0 / 2.2));
  }

  void main() {
    // ALPHA IS FORCED TO 1 HERE, and this is load-bearing: the tracers'
    // alpha channel is a terminal-status flag (1 = covered, 0.5 =
    // exhausted, 0 = miss), a private side-channel of the render targets — and three
    // r163+ creates the canvas WebGL context with alpha:true
    // unconditionally (the WebGLRenderer \`alpha\` param only picks the
    // default CLEAR alpha), so a verbatim copy handed the compositor
    // coverage-0 pixels over a nonzero RGB, which premultiplied
    // compositing reads as "add the page background". Measured: every miss
    // pixel of a WebGL surface settle gained exactly the page's own --bg
    // #0f1018 — +(15, 16, 24)/255 — which is what drove the two 4D arms'
    // object-mask IoU to 0.24/0.35. The canvas present (and the capture
    // path's present-then-toBlob) is where the coverage channel must stop;
    // the settle-target readbacks that COUNT it read the trace target,
    // never a blit destination.
    if (uHasSource == 0) {
      // Composite-layer prefill: unresolved pixels are uncovered live
      // backdrop, not stale target memory.
      vec3 liveBg = blitBackground(
        uLiveBgImage,
        uLiveBgKind,
        uLiveBgBottom,
        uLiveBgTop,
        uLiveBgShape,
        uLiveBgCenter,
        uLiveBgScale,
        vUv
      );
      outColor = vec4(liveBg, 1.0);
      outLayer = vec4(0.0, 0.0, 1.0, 1.0);
      return;
    }
    vec4 centerSource;
    vec4 centerLayer;
    vec3 centerRgb = blitCompositeSample(
      vUv,
      centerSource,
      centerLayer
    );
    // Exact legacy presentation when disabled: one source/layer read, the
    // same optional beta delta, and forced opaque alpha. No CoC decode or
    // neighboring sample can perturb this branch.
    if (uDepthOfField == 0) {
      outColor = vec4(centerRgb, 1.0);
      outLayer = centerLayer;
      return;
    }

    float centerCoverage;
    float centerCoc = blitSignedCoc(
      centerSource,
      centerLayer,
      centerCoverage
    );
    // The quantized focal byte and its immediate neighbor stay perfectly
    // crisp on covered geometry. Uncovered backdrop carries +1, so it never
    // takes this shortcut and can receive the splat of defocused geometry.
    if (centerCoverage > 0.5 && abs(centerCoc) <= (1.5 / 127.0)) {
      outColor = vec4(centerRgb, 1.0);
      outLayer = centerLayer;
      return;
    }

    vec2 sourceSize = vec2(textureSize(uSrc, 0));
    float maxRadiusPx = max(
      1.0,
      min(sourceSize.x, sourceSize.y) * 0.012
    );
    vec2 maxRadiusUv = vec2(maxRadiusPx) / max(sourceSize, vec2(1.0));
    float centerRadius = max(abs(centerCoc), 1.0 / 127.0);
    vec3 sum = blitDecodeLight(centerRgb) * 1.5;
    float sumWeight = 1.5;
    for (int i = 0; i < 8; i++) {
      vec2 tap = DOF_TAPS[i];
      float tapDistance = length(tap) * centerRadius;
      vec2 tapUv = clamp(
        vUv + tap * maxRadiusUv * centerRadius,
        vec2(0.0),
        vec2(1.0)
      );
      vec4 tapSource;
      vec4 tapLayer;
      vec3 tapRgb = blitCompositeSample(tapUv, tapSource, tapLayer);
      float tapCoverage;
      float tapCoc = blitSignedCoc(tapSource, tapLayer, tapCoverage);

      // A source contributes only where its own blur disc reaches this
      // destination. The small feather hides the nine-tap boundary without
      // widening the bounded radius.
      float reach = smoothstep(
        tapDistance - 0.06,
        tapDistance + 0.06,
        abs(tapCoc)
      );
      // Covered near geometry rejects materially farther samples (especially
      // uncovered +1 backdrop), preventing the classic bright/dark halo.
      // The reverse is allowed: a nearer defocused source may reach a farther
      // or uncovered center, approximating foreground scatter in one gather.
      float coveredCenter = smoothstep(0.01, 0.25, centerCoverage);
      float farther = smoothstep(
        2.0 / 127.0,
        8.0 / 127.0,
        tapCoc - centerCoc
      );
      float depthWeight = 1.0 - coveredCenter * farther;
      // Fractional edge coverage tempers a foreground splat into uncovered
      // backdrop while full-coverage geometry retains its full authority.
      float nearer = step(tapCoc, centerCoc - 2.0 / 127.0);
      float edgeWeight = mix(
        1.0,
        max(tapCoverage, 0.08),
        nearer * (1.0 - coveredCenter)
      );
      float kernel = 1.0 - 0.35 * dot(tap, tap);
      float weight = max(kernel, 0.0) * reach * depthWeight * edgeWeight;
      sum += blitDecodeLight(tapRgb) * weight;
      sumWeight += weight;
    }
    outColor = vec4(
      blitEncodeLight(sum / max(sumWeight, 1.0e-6)),
      1.0
    );
    outLayer = centerLayer;
  }
`;

/**
 * Upscale blit for every surface present: stretches a traced target (or
 * the compute frame's DataTexture) over the canvas. Hand-rolled rather
 * than MeshBasicMaterial so no color-space chunk can ever transform the
 * tracer's authored-sRGB output (ColorManagement is off app-wide, and this
 * module keeps all surface GLSL in one place). RGB is copied verbatim;
 * ALPHA IS FORCED TO 1 (see BLIT_FRAGMENT's comment: the tracers' alpha is
 * the terminal-status flag, and letting it reach the always-alpha:true canvas
 * composited the page background into every miss pixel). `src` is the
 * preview target's texture — bound once here by object identity, which
 * `WebGLRenderTarget.setSize` preserves across reallocations.
 */
export function createSurfaceBlitMaterial(
  src: THREE.Texture,
  layer: THREE.Texture = src,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uSrc: { value: src },
      uLayer: { value: layer },
      uHasSource: { value: 1 },
      uHasLayer: { value: 0 },
      uComposite: { value: 0 },
      // Runtime final-presentation switches. Scene wiring enables the first
      // only for a canvas/capture present, never for an offscreen seed; the
      // second selects tiled compute capture's packed source alpha.
      uDepthOfField: { value: 0 },
      uDofMetadataInSourceAlpha: { value: 0 },
      // Both image samplers always have a complete fallback texture bound;
      // kind 0 keeps the shipping analytic-gradient path active.
      uTraceBgImage: { value: src },
      uTraceBgKind: { value: 0 },
      uTraceBgTop: { value: new THREE.Vector3() },
      uTraceBgBottom: { value: new THREE.Vector3() },
      uTraceBgShape: { value: 0 },
      uTraceBgCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uTraceBgScale: { value: new THREE.Vector2(1, 1) },
      uLiveBgImage: { value: src },
      uLiveBgKind: { value: 0 },
      uLiveBgTop: { value: new THREE.Vector3() },
      uLiveBgBottom: { value: new THREE.Vector3() },
      uLiveBgShape: { value: 0 },
      uLiveBgCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uLiveBgScale: { value: new THREE.Vector2(1, 1) },
    },
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

/** The mesh-shape SDF atlas is a node lattice, not an image: each shader
 * lookup performs the same explicit eight-node interpolation as the CPU
 * oracle, so hardware filtering must stay disabled. */
function configureShapeMeshSdfTexture(texture: THREE.Data3DTexture): void {
  texture.format = THREE.RedFormat;
  texture.type = THREE.FloatType;
  texture.internalFormat = "R32F";
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

/** A complete, inert sampler binding for analytic-only programs. A fresh
 * placeholder per material avoids sharing disposal ownership; the expensive
 * active-set textures below are the ones deliberately cached. */
function emptyShapeMeshSdfTexture(): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(new Float32Array(1), 1, 1, 1);
  configureShapeMeshSdfTexture(texture);
  return texture;
}

const cachedShapeMeshTextures = new WeakMap<
  MeshSdfAtlas,
  THREE.Data3DTexture
>();

function shapeMeshSdfTexture(
  activeIds: readonly MeshAssetId[],
): THREE.Data3DTexture {
  const atlas = activeMeshSdfAtlas(activeIds);
  const cached = cachedShapeMeshTextures.get(atlas);
  if (cached) return cached;
  const texture = new THREE.Data3DTexture(
    atlas.values,
    atlas.width,
    atlas.height,
    atlas.depth,
  );
  configureShapeMeshSdfTexture(texture);
  cachedShapeMeshTextures.set(atlas, texture);
  return texture;
}

/** Unconditional sampler uniform shared by the 3D/4D material constructors.
 * Three ignores it in analytic programs, while keeping every material
 * complete before any mesh-bearing system is installed. */
export function surfaceShapeMeshSdfUniform(): THREE.IUniform {
  const placeholder = emptyShapeMeshSdfTexture();
  const uniform: THREE.IUniform & { placeholder: THREE.Data3DTexture } = {
    value: placeholder,
    placeholder,
  };
  return uniform;
}

/** Select the cached atlas for exactly the installed specs' active assets,
 * otherwise restore this material's cheap 1^3 placeholder. */
export function setSurfaceShapeMeshSdf(
  material: THREE.ShaderMaterial,
  specs: readonly ShapeSpec[],
): void {
  const uniform = material.uniforms.uShapeMeshSdf as THREE.IUniform & {
    placeholder?: THREE.Data3DTexture;
  };
  // Constructors seed this private companion value. Keep the fallback for
  // foreign/test materials that install only `{ value }` before calling us.
  uniform.placeholder ??= emptyShapeMeshSdfTexture();
  const activeIds = shapeSpecsMeshIds(specs);
  uniform.value =
    activeIds.length > 0 ? shapeMeshSdfTexture(activeIds) : uniform.placeholder;
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
 * Point the march at a freshly uploaded empty-space grid — or back at
 * nothing (`null`, the {@link setSurfaceSystem} reset: a new system's DE
 * invalidates every floor of the old one's grid, so the march must run
 * gridless until the new build lands). `halfExtent` is the grid cube's
 * half side (surface-grid.ts's `SurfaceGridSpec`); the caller owns the
 * texture's lifecycle, this only wires uniforms.
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

/**
 * Flip the march's grid reads on or off WITHOUT touching the texture: the
 * balloon's validity gate, `surface-grid.ts`'s
 * {@link balloonClearsGridBox}, is a per-frame answer about a grid the
 * session already built. `R` is the only live term in it, so a radius
 * sweep may cross the threshold in either direction many times over a
 * session — re-uploading (or re-requesting) a grid for that would cost
 * seconds where a uniform write costs nothing, which is why the REQUEST
 * and the ENABLE are two decisions.
 *
 * Enabling here is only meaningful while {@link setSurfaceGrid} has a
 * real texture installed; the caller (scene.ts) owns that invariant, and
 * the placeholder's zero floor never skips anyway.
 */
export function setSurfaceGridEnabled(
  material: THREE.ShaderMaterial,
  enabled: boolean,
): void {
  material.uniforms.uGridEnabled.value = enabled ? 1 : 0;
}

/** The classic+none material's two wire lanes — `(0.4, 32, 0, 0)` /
 * `(0, 1, 0, 0)`, derived through `surfaceMaterialLanes` rather than retyped
 * so the slot default and the packer can never disagree about lane order.
 * The value every `uMapFinishA`/`uMapFinishB` slot holds until
 * {@link setSurfaceMaterials} writes it, and the value unreached slots are
 * reset to. */
const CLASSIC_MATERIAL_LANES = surfaceMaterialLanes(CLASSIC_SURFACE_MATERIAL);

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
      uShapeMeshSdf: surfaceShapeMeshSdfUniform(),
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
      // Per-map unified material wire, alive under either independent
      // SURFACE_FINISH/SURFACE_PATTERN gate (setSurfaceMaterials). Unconditional
      // entries like the balloon's — Three.js ignores entries the compiled
      // program does not use — and DEFAULTED TO THE CLASSIC LANES rather
      // than zero, so a stray enabled read renders the fixed formula's own
      // highlight instead of a matte black surface.
      uMapFinishA: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector4(...CLASSIC_MATERIAL_LANES.a),
        ),
      },
      uMapFinishB: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector4(...CLASSIC_MATERIAL_LANES.b),
        ),
      },
      uPatternCalibration: { value: new THREE.Vector4() },
      uTrapIndex: { value: new Array<number>(SURFACE_MAX_MAPS).fill(0) },
      // Condensation records reuse the inverse/sigma arrays after the
      // ordinary-map prefix. These selectors are indexed by emitter-record
      // ordinal, not by the shared record slot.
      uCondCount: { value: 0 },
      uCondMapCount: { value: 0 },
      uShadeCount: { value: 0 },
      uCondMinDepth: { value: 0 },
      uCondMaxDepth: { value: 0 },
      uCondShape: { value: new Array<number>(SURFACE_MAX_MAPS).fill(0) },
      uCondShade: { value: new Array<number>(SURFACE_MAX_MAPS).fill(0) },
      uCondState: { value: new Array<number>(SURFACE_MAX_MAPS).fill(0) },
      uChaosPredecessorMasks: {
        value: Array.from({ length: 6 }, () => new THREE.Vector4()),
      },
      // Fold-variant per-map data: (foldKind, 1/w, |w|*sigmaMin,
      // trapIndex). Only the variant selected by the SURFACE_FOLDS define
      // has this uniform active — Three.js ignores entries the compiled
      // program does not use, so both arrays stay packed unconditionally.
      uFoldParams: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector4(0, 1, 1, 0),
        ),
      },
      // Per-map AUTHORED fold lengths: (minRadius, fixedRadius, boxLimit,
      // unused). The default IS the classic Mandelbox set, so a slot
      // setSurfaceSystem has not reached reads as an unparameterized fold
      // rather than as a divide by zero.
      uFoldRadii: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector4(0.5, 1, 1, 0),
        ),
      },
      uMapCount: { value: 0 },
      uScheduleCount: { value: 0 },
      uScheduleDepth: { value: 0 },
      uScheduleBounds: {
        value: Array.from(
          { length: SURFACE_MAX_SCHEDULE_DEPTH },
          () => new THREE.Vector4(0, 0, 0, 1),
        ),
      },
      uScheduleEscapeRadius: {
        value: new Array<number>(SURFACE_MAX_SCHEDULE_DEPTH).fill(2),
      },
      uSymOrder: { value: 1 },
      uSymPlane: { value: 1 },
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
      // Fold final lens: inert defaults; alive only under the
      // SURFACE_FOLD_LENS define.
      uLensParams: { value: new THREE.Vector4(0, 1, 1, 1) },
      uLensInvM: { value: new THREE.Matrix3() },
      uLensInvT: { value: new THREE.Vector3() },
      // The lens fold's lengths, classic by default for uFoldRadii's reason.
      uLensRadii: { value: new THREE.Vector3(0.5, 1, 1) },
      // Escape-time render: inert defaults; alive only under the
      // SURFACE_ESCAPE define. One slot per CHAIN LINK (the document's
      // transform list IS the formula sequence), sized like the descent's
      // per-map arrays — slots past uMapCount are never read.
      uEscM: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Matrix3(),
        ),
      },
      uEscT: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector3(),
        ),
      },
      uEscParams: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector4(0, 1, 1, 0),
        ),
      },
      // Per-LINK fold lengths, SQUARED for the sphere pair — EscapeLink's
      // own form. The classic Mandelbox set by default, so an unreached
      // slot could never divide by zero.
      uEscRadii: {
        value: Array.from(
          { length: SURFACE_MAX_MAPS },
          () => new THREE.Vector4(0.25, 1, 1, 0),
        ),
      },
      // Which estimate form the escape orbit's terminal radius is read
      // through: inert unless SURFACE_ESCAPE, and 0 is the linear form
      // the fold-only chain always read, so a stale read is the old
      // behaviour.
      uEscLogForm: { value: 0 },
      // Mandelbulb render: inert defaults; alive only under the
      // SURFACE_BULB define (sigmaMax 1 and a bailout of 1 so a stray
      // enabled read could never divide by zero or take log of zero).
      uBulbM: { value: new THREE.Matrix3() },
      uBulbT: { value: new THREE.Vector3() },
      uBulbParams: { value: new THREE.Vector4(1, 1, 0, 0) },
      // The shape trap's live pose/mode quantities — read only under the
      // SURFACE_SHAPE_TRAP arms (uTrapPose is position.xyz + invScale;
      // uTrapParams is mode/threshold/fade). Identity/off defaults so a
      // stray read before the first push is inert.
      uTrapInvRot: { value: new THREE.Matrix3() },
      uTrapPose: { value: new THREE.Vector4(0, 0, 0, 1) },
      uTrapParams: { value: new THREE.Vector4(0, 0.25, 0, 0) },
      // Inclusive post-link geometry band. This is an integer uniform in
      // its resolved arm; Vector2 is supported by Three's ivec2 uploader.
      uTrapGeometryLevels: { value: new THREE.Vector2(0, 0) },
      // Balloon inverted-union: inert defaults; alive only under the
      // SURFACE_BALLOON define (rho 1 so a stray enabled read could never
      // divide by zero). Three.js ignores entries the compiled program
      // does not use, so these stay unconditional.
      uBalloonCenter: { value: new THREE.Vector3() },
      uBalloonR: { value: 0 },
      uBalloonRho: { value: 1 },
      uBalloonFar: { value: 0 },
      // The echo's independent tint: inert default (strength 0,
      // packSurfaceBalloonTint's own default) is a bit-exact identity —
      // see the uBalloonTint declaration above. Unconditional like the
      // rest of this block.
      uBalloonTint: { value: new THREE.Vector3() },
      uBalloonTintStrength: { value: 0 },
      // Inherit aliases the already-valid primary placeholder and disables
      // the branch; scene.ts installs a separate 256x1 texture only for a
      // non-inherit balloon palette.
      uBalloonColorLUT: { value: placeholderLUT },
      uBalloonPaletteEnabled: { value: 0 },
      // Ground plane: inert defaults; alive only under the
      // SURFACE_GROUND_PLANE define (ball radius 1 so a stray enabled
      // read could never divide by zero). Three.js ignores entries the
      // compiled program does not use, so these stay unconditional.
      uGroundY: { value: 0 },
      uGroundFadeStart: { value: 0 },
      uGroundFadeEnd: { value: 0 },
      uGroundBallR: { value: 1 },
      uGroundBallC: { value: new THREE.Vector3() },
      uGroundAlbedo: { value: new THREE.Vector3(1, 1, 1) },
      uGroundPattern: { value: 0 },
      uGroundTileScale: { value: 0.64 },
      uGroundEmission: { value: 0 },
      uColorSource: { value: 0 },
      uColorSpeed: { value: 0.5 },
      uColorLUT: { value: placeholderLUT },
      uLightDir: { value: lightDirection(135, 50) },
      uAmbient: { value: 0.25 },
      uCamPos: { value: new THREE.Vector3() },
      uInvProjView: { value: new THREE.Matrix4() },
      // Automatic Surface focal plane. Scene wiring replaces this at every
      // frame arm; this finite forward/depth pair keeps the placeholder
      // material total before the first camera push.
      uFocusPlane: { value: new THREE.Vector4(0, 0, -1, 1) },
      uBgTop: { value: BG_TOP.clone() },
      uBgBottom: { value: BG_BOTTOM.clone() },
      // Background shape: linear defaults — 0 is inert, center/scale
      // unread by "linear" — so a stray enabled read could never divide
      // by zero.
      uBgShape: { value: 0 },
      uBgCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uBgScale: { value: new THREE.Vector2(1, 1) },
      uFogDensity: { value: 1 },
      uFogTint: { value: new THREE.Vector3(1, 1, 1) },
      uFogTintStrength: { value: 0 },
      // Environment light: matches state.ts's DEFAULT_SURFACE_ENV_LIGHT,
      // the way uAmbient above mirrors its own default.
      uEnvLight: { value: 0.35 },
      // Placeholder; the scene overwrites it per frame with the camera's
      // true angular pixel size.
      uPixelEps: { value: 0.002 },
      uAcceptPixelEps: { value: 0.002 },
      // The pixel CENTRE: zero here is what makes a single-pass trace
      // value-identical to the pre-supersampling one. The scene rewrites
      // it per ARMED JOB — setSurfaceFrameUniforms resets it to zero, and
      // only a supersampling pass past the first sets it otherwise — so
      // no abandoned settle can leak a jitter into the preview or the
      // export that follows it. Spelled out, all four: THREE.Vector4's
      // own default is (0, 0, 0, 1), and that 1 is the dither's y offset
      // in PIXELS — it would move the march-start hash a whole pixel on
      // every trace this app makes.
      uPixelJitter: { value: new THREE.Vector4(0, 0, 0, 0) },
      // Full-tier defaults; the scene overwrites all four per tier.
      uMarchSteps: { value: SURFACE_FULL_MARCH_STEPS },
      uShadowSteps: { value: SURFACE_FULL_SHADOW_STEPS },
      uAoTaps: { value: SURFACE_FULL_AO_TAPS },
      uHitFloor: { value: SURFACE_FULL_HIT_FLOOR },
    },
    // Which descent bodies are compiled in: SURFACE_FOLDS 0 = the affine
    // ladder pair (byte-for-byte the shader that predates the fold
    // frontier), 1 = the fold-frontier pair. SURFACE_FOLD_LENS 1
    // additionally renames the bodies to surfaceDECore and compiles the
    // fold-lens wrapper as the public surfaceDE. SURFACE_ESCAPE 1 replaces
    // the descent bodies wholesale with the escape-time loop.
    // SURFACE_BALLOON 1 wraps whichever variant compiled in the balloon
    // inverted-union (setSurfaceBalloon) — like the lens and escape names
    // it is resolved JS-side, so the entry here is change detection (and a
    // program-cache key), never driver-parsed text. SURFACE_FINISH 1
    // (setSurfaceMaterials) swaps the shading site's fixed lighting formula
    // for the per-map parametric one; it composes with EVERY variant and
    // is resolved the same JS-side way.
    // setSurfaceSystem/setEscapeSystem flip these when the system's shape
    // changes — rare, session-enter-scale recompiles.
    defines: {
      SURFACE_FOLDS: 0,
      SURFACE_FOLD_LENS: 0,
      SURFACE_ESCAPE: 0,
      SURFACE_BULB: 0,
      SURFACE_BALLOON: 0,
      SURFACE_GROUND_PLANE: 0,
      SURFACE_FINISH: 0,
      // The escape family's shape-trap color channel — JS-resolved like
      // the arms around it (the entry is change detection and a
      // program-cache key). The trap's SHAPE also keys the rebuild, via
      // userData.surfaceTrapShapeKey: two trap sessions with different
      // specs share this define but not a program.
      SURFACE_SHAPE_TRAP: 0,
      SURFACE_CONDENSATION: 0,
    },
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
 * uniforms. `colors[j]` is the sRGB 0..1 color for shade slot j: recursive
 * maps first, then one slot per unique condensation emitter. `trapIndices`
 * remains map-keyed because its structural blend follows recursive choices.
 * `trapIndices` is optional for callers that predate the color sources:
 * omitting it zero-fills the live slots — an explicit reset, like the
 * final lens, so a previous system's traps never leak. Slots past the live
 * count keep stale values by design. `de.maps` is BASE maps, while
 * symmetry-expanded emitter inverse records append after them; uMapCount
 * guards recursive loops and uCondCount guards that suffix. Throws when
 * either the total record wire or unique shade wire exceeds 24. */
export function setSurfaceSystem(
  material: THREE.ShaderMaterial,
  de: SurfaceDE,
  colors: Vec3[],
  trapIndices?: number[],
): void {
  const schedule = de.schedule && de.schedule.depth > 0 ? de.schedule : null;
  const scheduleMaps = schedule?.maps ?? [];
  const emitters = de.condensation?.emitters ?? [];
  const recordCount = de.maps.length + scheduleMaps.length + emitters.length;
  const shadeCount = emitters.reduce(
    (count, emitter) => Math.max(count, emitter.shadeIndex + 1),
    de.maps.length,
  );
  if (recordCount > SURFACE_MAX_RECORDS) {
    throw new RangeError(
      `surface DE has ${de.maps.length} maps + ${scheduleMaps.length} schedule maps + ${emitters.length} condensation records, but the material carries at most ${SURFACE_MAX_RECORDS}`,
    );
  }
  if (shadeCount > SURFACE_MAX_MAPS) {
    throw new RangeError(
      `surface DE needs ${shadeCount} unique shade slots, but the material carries at most ${SURFACE_MAX_MAPS}`,
    );
  }
  if (colors.length < shadeCount) {
    throw new RangeError(
      `surface DE needs ${shadeCount} map/emitter colors, but received ${colors.length}`,
    );
  }
  // A new system invalidates every floor of the old system's grid — march
  // gridless until the fresh build lands. The caller owns the old
  // texture's disposal.
  setSurfaceGrid(material, null);
  const u = material.uniforms;
  const invM = u.uInvM.value as THREE.Matrix3[];
  const invT = u.uInvT.value as THREE.Vector3[];
  const sigmaMin = u.uSigmaMin.value as number[];
  const mapColor = u.uMapColor.value as THREE.Vector3[];
  const trapIndex = u.uTrapIndex.value as number[];
  const foldParams = u.uFoldParams.value as THREE.Vector4[];
  const foldRadii = u.uFoldRadii.value as THREE.Vector4[];
  const condShape = u.uCondShape.value as number[];
  const condShade = u.uCondShade.value as number[];
  const condState = u.uCondState.value as number[];
  const chaosMasks = u.uChaosPredecessorMasks.value as THREE.Vector4[];
  const chaos = de.chaos ?? null;
  if (chaos) {
    if (
      chaos.activeStateCount !== shadeCount ||
      chaos.activeStateCount > SURFACE_MAX_MAPS ||
      chaos.predecessorMasks.length < chaos.activeStateCount ||
      chaos.emitterStateIndices.length !== emitters.length ||
      de.maps.some((map, j) => map.stateIndex !== j)
    ) {
      throw new RangeError("surface DE carries an invalid graph-state wire");
    }
  }
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
    // The map's three AUTHORED lengths; the shader's foldRadiiOf
    // re-derives the branch algebra from them, so this ships
    // resolveFoldRadii's output rather than surfaceFoldRadii's eight
    // combinations.
    foldRadii[j].set(
      map.foldRadii.minR,
      map.foldRadii.fixedR,
      map.foldRadii.wall,
      0,
    );
    if (map.foldKind !== SURFACE_FOLD_NONE) hasFolds = true;
  });
  scheduleMaps.forEach((map, b) => {
    const slot = de.maps.length + b;
    const m = map.invM;
    invM[slot].set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    invT[slot].set(...map.invT);
    sigmaMin[slot] = map.sigmaMin;
    trapIndex[slot] = 0;
    // B is a finite affine plot-stage word: it never inherits A's fold,
    // material, color or trap attribution even in a fold-capable program.
    foldParams[slot].set(SURFACE_FOLD_NONE, 1, map.sigmaMin, 0);
    foldRadii[slot].set(0.5, 1, 1, 0);
  });
  const shapeSlots = new Map<string, number>();
  emitters.forEach((emitter, e) => {
    const slot = de.maps.length + scheduleMaps.length + e;
    const m = emitter.invM;
    invM[slot].set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    invT[slot].set(...emitter.invT);
    sigmaMin[slot] = emitter.sigmaMin;
    const key = JSON.stringify(emitter.shape);
    let shape = shapeSlots.get(key);
    if (shape === undefined) {
      shape = shapeSlots.size;
      shapeSlots.set(key, shape);
    }
    condShape[e] = shape;
    condShade[e] = emitter.shadeIndex;
    condState[e] = chaos?.emitterStateIndices[e] ?? 0;
    mapColor[emitter.shadeIndex].set(...colors[emitter.shadeIndex]);
  });
  for (let group = 0; group < chaosMasks.length; group++) {
    const at = group * 4;
    chaosMasks[group].set(
      chaos?.predecessorMasks[at] ?? 0,
      chaos?.predecessorMasks[at + 1] ?? 0,
      chaos?.predecessorMasks[at + 2] ?? 0,
      chaos?.predecessorMasks[at + 3] ?? 0,
    );
  }
  // Select the compiled descent pair (fold frontier vs affine ladders)
  // and whether the fold-lens wrapper wraps them. A define change forces
  // a program rebuild — rare (system-set time, and only when fold-ness
  // actually flips).
  const wantFolds = hasFolds ? 1 : 0;
  const wantLens = de.foldFinal ? 1 : 0;
  const wantSchedule = schedule ? 1 : 0;
  const wantCondensation = emitters.length > 0 ? 1 : 0;
  const wantChaos = chaos ? 1 : 0;
  const condensationShapes = wantCondensation
    ? emitters.map((emitter) => emitter.shape)
    : null;
  setSurfaceShapeMeshSdf(material, condensationShapes ?? []);
  const condensationKey = condensationShapes
    ? condensationShapeKey(condensationShapes)
    : null;
  const oldCondensationKey = (
    material.userData as { surfaceCondensationShapeKey?: string | null }
  ).surfaceCondensationShapeKey;
  // The balloon flag is orthogonal session state owned by
  // setSurfaceBalloon — a system swap preserves whatever it last set.
  const balloon = material.defines.SURFACE_BALLOON === 1 ? 1 : 0;
  // The ground plane is likewise orthogonal session state owned by
  // setSurfaceGroundPlane — a system swap preserves it (every variant
  // carries the plane arm: its programs resolve through stripGlslSource,
  // far under the Mesa cliff).
  const plane = material.defines.SURFACE_GROUND_PLANE === 1 ? 1 : 0;
  // Finish and pattern are orthogonal session state owned together by
  // setSurfaceMaterials — a system swap preserves both, so a rebuild here
  // cannot silently drop either independent gate.
  const finish = material.defines.SURFACE_FINISH === 1 ? 1 : 0;
  const pattern = material.defines.SURFACE_PATTERN === 1 ? 1 : 0;
  if (
    material.defines.SURFACE_FOLDS !== wantFolds ||
    material.defines.SURFACE_FOLD_LENS !== wantLens ||
    material.defines.SURFACE_ESCAPE !== 0 ||
    material.defines.SURFACE_BULB !== 0 ||
    material.defines.SURFACE_GROUND_PLANE !== plane ||
    (material.defines.SURFACE_SCHEDULE === 1 ? 1 : 0) !== wantSchedule ||
    (material.defines.SURFACE_CHAOS === 1 ? 1 : 0) !== wantChaos ||
    material.defines.SURFACE_CONDENSATION !== wantCondensation ||
    oldCondensationKey !== condensationKey
  ) {
    material.defines.SURFACE_FOLDS = wantFolds;
    material.defines.SURFACE_FOLD_LENS = wantLens;
    // A previous escape-time or Mandelbulb session must hand the descent
    // bodies back — its shape trap with them (only the forward arms carry
    // one, so the ESCAPE/BULB flip above always accompanies this).
    material.defines.SURFACE_ESCAPE = 0;
    material.defines.SURFACE_BULB = 0;
    material.defines.SURFACE_SHAPE_TRAP = 0;
    delete material.defines.SURFACE_TRAP_GEOMETRY;
    material.defines.SURFACE_CONDENSATION = wantCondensation;
    if (wantChaos) material.defines.SURFACE_CHAOS = 1;
    else delete material.defines.SURFACE_CHAOS;
    if (wantSchedule) material.defines.SURFACE_SCHEDULE = 1;
    else delete material.defines.SURFACE_SCHEDULE;
    (
      material.userData as { surfaceTrapShapeKey?: string | null }
    ).surfaceTrapShapeKey = null;
    (
      material.userData as {
        surfaceCondensationShapeKey?: string | null;
        surfaceCondensationShapes?: ShapeSpec[] | null;
      }
    ).surfaceCondensationShapeKey = condensationKey;
    (
      material.userData as { surfaceCondensationShapes?: ShapeSpec[] | null }
    ).surfaceCondensationShapes = condensationShapes;
    material.defines.SURFACE_GROUND_PLANE = plane;
    material.fragmentShader = surfaceFragmentFor(
      0,
      wantLens,
      balloon,
      plane,
      0,
      finish,
      pattern,
      SURFACE_FRAGMENT,
      null,
      condensationShapes,
      false,
      0,
      wantSchedule,
      wantChaos,
    );
    material.needsUpdate = true;
  }
  u.uMapCount.value = de.maps.length;
  u.uScheduleCount.value = scheduleMaps.length;
  u.uScheduleDepth.value = schedule?.depth ?? 0;
  if (schedule) {
    const scheduleBounds = u.uScheduleBounds.value as THREE.Vector4[];
    const scheduleEscape = u.uScheduleEscapeRadius.value as number[];
    for (let depth = 1; depth <= schedule.depth; depth++) {
      const bound = schedule.bounds[depth];
      scheduleBounds[depth - 1].set(...bound.center, bound.radius);
      scheduleEscape[depth - 1] = bound.escapeRadius;
    }
  }
  u.uCondCount.value = emitters.length;
  u.uCondMapCount.value = de.maps.length + scheduleMaps.length;
  u.uShadeCount.value = shadeCount;
  u.uCondMinDepth.value = Math.min(
    SURFACE_CONDENSATION_GLSL_DEPTH_MAX,
    de.condensation?.depthBand.minDepth ?? 0,
  );
  u.uCondMaxDepth.value = Math.min(
    SURFACE_CONDENSATION_GLSL_DEPTH_MAX,
    de.condensation?.depthBand.maxDepth ?? 0,
  );
  // The kaleidoscope the descent sweeps instead of expanding: three
  // scalars where every extra order used to cost `maps.length` slots.
  u.uSymOrder.value = de.symmetry.order;
  u.uSymPlane.value = SYM_PLANE_CODE[de.symmetry.plane];
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
  // The final lens must be RESET when absent — the previous system may
  // have had one, and identity / zero / 1 is the shader's "no lens"
  // encoding. With a FOLD lens the identity encoding is deliberate and
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
    (u.uLensRadii.value as THREE.Vector3).set(
      lens.foldRadii.minR,
      lens.foldRadii.fixedR,
      lens.foldRadii.wall,
    );
  } else {
    (u.uLensParams.value as THREE.Vector4).set(0, 1, 1, 1);
    lensM.identity();
    lensT.set(0, 0, 0);
    // Reset to the CLASSIC set, not to zero: the no-lens encoding has to be
    // a fold this arithmetic could actually run, and 0 would divide by it.
    (u.uLensRadii.value as THREE.Vector3).set(0.5, 1, 1);
  }
}

/**
 * Resolve the SURFACE_ESCAPE / SURFACE_FOLD_LENS preprocessor arms (and,
 * since, the bulb, balloon, ground-plane and finish arms — every key
 * surfaceFragmentResolvedFor passes) JS-SIDE, so the source each variant
 * hands the driver contains ONLY its own bodies. Measured necessity, not tidiness: Mesa's compiler sits on a
 * knife's edge with the fold-frontier variant — the shipped ~68KB source
 * links (in ~25s), but the SAME compiled tokens preceded by the
 * lens/escape variants' preprocessor-dead text pushed the source past 80KB
 * and the compile crashed outright, twice per session (empty info log,
 * lost context — the exact failure signature the fold branch sweep first
 * produced, resurrected by nothing but source growth). SURFACE_FOLDS stays
 * a driver-side define, exactly as shipped and measured. Handles the two
 * names' `#if` / `#else` / `#endif` with proper nesting bookkeeping for
 * every OTHER `#if`-family directive encountered inside their arms (those
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

/**
 * Resolved-source size past which {@link surfaceFragmentFor} strips
 * comments and indentation before handing the driver a program.
 *
 * TWO SIZES, AND EVERY FIGURE IN THIS FILE MUST SAY WHICH IT IS. The
 * RESOLVED source — {@link surfaceFragmentResolvedFor} — is what this
 * threshold is compared against. The EMITTED source —
 * {@link surfaceFragmentFor} — is what the driver walks, and the ONLY
 * size the Mesa cliff applies to. For the descent variants they differ by
 * about 3x, so quoting one against the other's threshold is how a reader
 * concludes there is 1KB of room where there are 50. That mistake was
 * shipped in this file's own comments for weeks: the fold-lens variant
 * was described as "~79KB" against an "~80KB" cliff when it resolves at
 * 86223 B and reaches the driver at 28958 B.
 *
 * The three measurements this file has paid for, all on Mesa/Iris and all
 * of EMITTED source: ~68KB linked (in ~25s), ~80KB was called the cliff,
 * and 82.2KB crashed the compiler outright — empty info log, lost
 * context. All three predate the strip, so for them the two sizes WERE
 * the same number, which is how the distinction got lost. Stripping emits
 * the identical token stream, so the choice is only ever about how many
 * bytes the compiler has to walk.
 *
 * 64KB sits below the first of those, which is what makes the cliff
 * structurally unreachable rather than merely distant: a resolved source
 * under the threshold is emitted whole and so is under 64KB by
 * definition, and one over it is stripped to roughly a third, so reaching
 * 82.2KB emitted would take ~190KB resolved — where the whole UNRESOLVED
 * template, every arm live at once, is 142130 B. The largest emitted
 * source of any variant today is escape+balloon's 64681 B — a
 * measurement-only pairing, since balloon is IFS-only and escape is
 * forward — and it is unstripped precisely because it is under the
 * threshold. With the FINISH arm on that same pairing is the one whose
 * strip status flips (66714 B resolved, emitted stripped at 13180 B),
 * which is the benign event the threshold exists to make benign.
 *
 * So the threshold decides READABILITY, not safety. Every DESCENT variant
 * resolves past it and strips; the two forward-orbit arms stay under it
 * and keep their comments — escape 55845 B (9691 B of headroom), bulb
 * 39357 B (26179 B); with the finish arm on, escape 57878 B (7658 B) and
 * bulb 41390 B (24146 B) — which is where a reader most often wants to
 * see the shipped source. A test gates those two, finish on and off — not
 * the figures, which any edit moves, but the property they buy: "keeps
 * the two shipped forward arms under the strip threshold". It has to read
 * the RESOLVED length to do it, because crossing the threshold turns
 * stripping ON and drops the emitted length to a third, so an
 * emitted-length assertion passes MORE comfortably at exactly the moment
 * the property breaks. Every other
 * current size lives in `docs/surface-glsl-tracers.md`, measured per
 * change — the split that kept the 4D tracer's table right while this
 * file's prose rotted.
 */
export const SURFACE_GLSL_STRIP_BYTES = 64 * 1024;

/**
 * Resolve the variant arms and return the raw composed source, before the
 * strip decision — the quantity {@link SURFACE_GLSL_STRIP_BYTES} is
 * compared against, and therefore the number the "measure before adding
 * the next paragraph" rule is about.
 *
 * Exported so that rule is executable rather than requiring a throwaway
 * copy of this module with `export` added to its privates, which is what
 * every previous measurement of these sizes actually did.
 * {@link buildSurfaceFragment} is the precedent for exporting a build for
 * tests.
 *
 * Both refusals — plane+balloon (no horizon inside the shell) and
 * escape+bulb (both would define surfaceDE twice) — live here rather than
 * in {@link surfaceFragmentFor}, so the two entry points cannot disagree
 * about which variant pairs are legal. `finish` refuses NOTHING: the
 * per-map finish arm replaces only the shading site's lighting lines and
 * composes with every variant, the two forward-orbit arms, the lens, the
 * balloon and the floor alike.
 */
export function surfaceFragmentResolvedFor(
  escape: number,
  lens: number,
  balloon = 0,
  plane = 0,
  bulb = 0,
  finish = 0,
  pattern = 0,
  // `trap` sits AFTER `source`, unlike every earlier arm flag: the 4D
  // wrapper (surface-material-4d.ts) passes its own source positionally
  // at this slot, and the trap can never reach that dimension anyway
  // (escape4 has no fragment mirror).
  source: string = SURFACE_FRAGMENT,
  trap: ShapeSpec | null = null,
  condensation: readonly ShapeSpec[] | null = null,
  condensation4 = false,
  trapGeometry = 0,
  schedule = 0,
  chaos = 0,
): string {
  if (plane !== 0 && balloon !== 0) {
    throw new RangeError(
      "SURFACE_GROUND_PLANE cannot compile into the balloon variant",
    );
  }
  if (escape !== 0 && bulb !== 0) {
    // The two forward-orbit variants are alternatives, not a composition:
    // each replaces the descent bodies wholesale, so both on would define
    // surfaceDE twice. Callers gate on the system's shape (a system is
    // either fold-shaped or bulb-shaped), so reaching this is a bug.
    throw new RangeError("SURFACE_BULB and SURFACE_ESCAPE are exclusive");
  }
  if (trap !== null && escape === 0 && bulb === 0) {
    // The shape trap is the escape FAMILY's color channel: only the two
    // forward arms carry the accumulator and the six-out overload the
    // shared call site names under the define. The WGSL codegen refuses
    // the same shapes (its descent cores throw).
    throw new RangeError(
      "SURFACE_SHAPE_TRAP compiles only into the escape/bulb arms",
    );
  }
  if (trap !== null && balloon !== 0) {
    // Structurally unreachable in production — no forward session ever
    // balloons — and refused rather than left source-valid: the balloon
    // hit-info wrapper's out-list does not carry the trap channel.
    throw new RangeError(
      "SURFACE_SHAPE_TRAP cannot compile into the balloon variant",
    );
  }
  if (condensation !== null && (escape !== 0 || bulb !== 0)) {
    throw new RangeError(
      "SURFACE_CONDENSATION compiles only into inverse-map descent arms",
    );
  }
  if (schedule !== 0 && (escape !== 0 || bulb !== 0)) {
    throw new RangeError(
      "SURFACE_SCHEDULE compiles only into inverse-map descent arms",
    );
  }
  if (chaos !== 0 && (escape !== 0 || bulb !== 0)) {
    throw new RangeError(
      "SURFACE_CHAOS compiles only into inverse-map descent arms",
    );
  }
  // Geometry belongs only to the fold-chain escape estimator. A direct
  // bulb call may still carry a document trap (the app normally refuses
  // that combination); keeping this arm off guarantees it remains color
  // only rather than silently changing the bulb distance.
  const resolvedTrapGeometry =
    trap !== null && escape !== 0 && trapGeometry !== 0 ? 1 : 0;
  const resolved = resolveVariantArms(source, {
    SURFACE_ESCAPE: escape,
    SURFACE_BULB: bulb,
    SURFACE_FOLD_LENS: lens,
    SURFACE_BALLOON: balloon,
    SURFACE_GROUND_PLANE: plane,
    "SURFACE_FINISH || SURFACE_PATTERN": finish || pattern,
    SURFACE_FINISH: finish,
    SURFACE_PATTERN: pattern,
    SURFACE_SHAPE_TRAP: trap !== null ? 1 : 0,
    SURFACE_TRAP_GEOMETRY: resolvedTrapGeometry,
    SURFACE_CONDENSATION: condensation !== null ? 1 : 0,
    SURFACE_SCHEDULE: schedule,
    SURFACE_CHAOS: chaos,
    "SURFACE_CONDENSATION || SURFACE_SCHEDULE":
      condensation !== null || schedule !== 0 ? 1 : 0,
    "SURFACE_CONDENSATION || SURFACE_SCHEDULE || SURFACE_CHAOS":
      condensation !== null || schedule !== 0 || chaos !== 0 ? 1 : 0,
  });
  let baked = resolved;
  // The trap arm's two BAKED splices: the per-spec shape SDF
  // (`shapeSdfSource` — create-time geometry, the WGSL core's decision on
  // this engine) and the normalizer literal (`shapeTrapInvNorm`, the ONE
  // shared definition). Both placeholders live inside the
  // SURFACE_SHAPE_TRAP arms, so a trap-free resolve carries neither and
  // this replacement never runs — byte-identity by construction.
  if (trap !== null) {
    const meshIds = shapeMeshIds(trap);
    const meshHelper =
      meshIds.length > 0 ? `${shapeMeshSdfGlsl(meshIds)}\n` : "";
    baked = baked
      .replace(
        "//__SURFACE_TRAP_SDF__",
        meshHelper +
          shapeSdfSource(trap, "glsl", "surfaceTrapSdf", {
            meshIndex: (id) => meshSdfAtlasShaderIndex(meshIds, id),
          }),
      )
      .replace(
        "__SURFACE_TRAP_INV_NORM__",
        glslFloatLit(shapeTrapInvNorm(trap)),
      );
  }
  if (condensation !== null) {
    baked = baked.replace(
      "//__SURFACE_CONDENSATION_SDFS__",
      condensationShapeDispatch(condensation, condensation4),
    );
  }
  return baked;
}

/** A finite number as a GLSL float literal — `shapes.ts`'s `lit` rule
 * (String round-trips f64 exactly; a bare integer gains `.0`). Used for
 * the trap's baked normalizer. */
function glslFloatLit(x: number): string {
  if (!Number.isFinite(x)) {
    throw new Error(`surface-material: non-finite baked constant (${x})`);
  }
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** Compose the fragment source for a variant selection — the driver only
 * ever sees SURFACE_FOLDS conditionals (see resolveVariantArms). `balloon`
 * resolves the SURFACE_BALLOON wrapper arms the same JS-side way — with it
 * 0 the resolved source is byte-identical to the pre-balloon build.
 * `plane` is the ground-plane arm under the same contract — 0 resolves
 * byte-identical to the pre-plane build — except that 1 additionally
 * strips comments/indentation from the WHOLE resolved source
 * ({@link stripGlslSource}): same token stream, new program, and the size
 * Mesa prices drops to roughly a THIRD (measured: the affine/fold base
 * 83022 B resolved, 29194 B emitted), which is what lets every variant
 * carry the floor, the lens included. Only `balloon` refuses the pair (the enclosing shell has no horizon for a
 * floor to sit on; callers gate, so reaching the throw is a bug). `bulb`
 * is the SECOND forward-orbit variant under the same contract — 0 resolves
 * byte-identical to the pre-bulb build, and it refuses to compile
 * alongside `escape` (each replaces the descent bodies wholesale, so both
 * on would define surfaceDE twice). `finish` is the per-map surface
 * finish arm (setSurfaceMaterials): 0 resolves byte-identical to the
 * pre-finish build — the fixed lighting formula, which is what the
 * caller's `isClassicSurfaceFinish` gate buys an unauthored document — and
 * 1 compiles the `uMapFinishA`/`uMapFinishB` arrays and the shared
 * `finishShade` body in their place. It composes with every variant and
 * takes no strip rule of its own: its ~1.9KB of text rides the size rule
 * below like any other paragraph. `source` defaults to the module's
 * assembled fragment; tests pass their own width-parameterized builds.
 *
 * THE STRIP IS A SIZE RULE, not the plane arm's private habit: any
 * resolved source past {@link SURFACE_GLSL_STRIP_BYTES} gets the same
 * treatment. The rule was bought by a measurement — the fold's authored
 * radii cost this file ~2.2KB of uniforms, a derivation helper and longer
 * expressions, which took the BALLOON variant from 80.9KB to 83.1KB, past
 * the 82.2KB that crashed Mesa outright. A size threshold is the honest
 * predicate for a size cliff: a hand-kept list of which variants strip is
 * exactly what drifts the next time one of them grows a paragraph.
 *
 * Read the length THIS returns against the ~80KB cliff, and
 * {@link surfaceFragmentResolvedFor}'s against
 * {@link SURFACE_GLSL_STRIP_BYTES}. Reading this one against the
 * threshold proves nothing: the strip rule caps it there by construction,
 * so the comparison holds however far any arm grows. */
export function surfaceFragmentFor(
  escape: number,
  lens: number,
  balloon = 0,
  plane = 0,
  bulb = 0,
  finish = 0,
  pattern = 0,
  // After `source` for surfaceFragmentResolvedFor's stated reason.
  source: string = SURFACE_FRAGMENT,
  trap: ShapeSpec | null = null,
  condensation: readonly ShapeSpec[] | null = null,
  condensation4 = false,
  trapGeometry = 0,
  schedule = 0,
  chaos = 0,
): string {
  const resolved = surfaceFragmentResolvedFor(
    escape,
    lens,
    balloon,
    plane,
    bulb,
    finish,
    pattern,
    source,
    trap,
    condensation,
    condensation4,
    trapGeometry,
    schedule,
    chaos,
  );
  return plane !== 0 || resolved.length > SURFACE_GLSL_STRIP_BYTES
    ? stripGlslSource(resolved)
    : resolved;
}

/**
 * Pack an {@link EscapeDE} — its whole formula CHAIN — and flip the
 * material onto the escape-time variant. The IFS-side uniforms the shared
 * marcher still reads — bounding/visible radii, uMaxDepth (the iteration
 * budget the preview tier clamps through previewMaxDepth), step scale,
 * slot-0 color for the by-transform source — are packed to the escape
 * set's values; everything descent-specific (inverse maps, sector sweep,
 * lenses, grid) is reset to inert, and no grid is ever uploaded for this
 * mode (the empty-space chain's validity argument is IFS-specific).
 *
 * TWO frozen slots carry escape meanings rather than inert ones, both
 * because they mean exactly the same thing here as they do for a descent:
 * `uMapCount` is the LINK COUNT the cycle wraps at, and
 * `uSymOrder`/`uSymPlane` are the query-space wedge fold's own order and
 * plane (never the descent's sector sweep, whose `uSymStep` pair stays
 * inert). Throws past {@link SURFACE_MAX_MAPS} links — the caller gates on
 * the active-map count first (main.ts's eligibility arm), exactly as the
 * IFS packer's cap is gated, so reaching the throw is a bug.
 */
/**
 * Push the shape trap's LIVE uniforms — `resolveShapeTrap`'s pose/mode
 * fields, the half of the wire that moves without a recompile (the baked
 * half — shape + normalizer — rides the fragment source, so a SPEC change
 * goes through {@link setEscapeSystem}/{@link setBulbSystem} instead).
 * scene.ts calls this on every trap pose/threshold/fade edit.
 */
export function setSurfaceShapeTrapUniforms(
  material: THREE.ShaderMaterial,
  rt: ResolvedShapeTrap,
): void {
  const u = material.uniforms;
  const m = rt.invRot;
  (u.uTrapInvRot.value as THREE.Matrix3).set(
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
  (u.uTrapPose.value as THREE.Vector4).set(
    rt.position[0],
    rt.position[1],
    rt.position[2],
    rt.invScale,
  );
  (u.uTrapParams.value as THREE.Vector4).set(rt.mode, rt.threshold, rt.fade, 0);
  (u.uTrapGeometryLevels.value as THREE.Vector2).set(
    Math.min(SHAPE_TRAP_GEOMETRY_LEVEL_MAX, rt.geometryLevelMin),
    Math.min(SHAPE_TRAP_GEOMETRY_LEVEL_MAX, rt.geometryLevelMax),
  );
}

/** The trap SPEC a material's compiled program bakes, recovered from the
 * install key — what lets the orthogonal recompose sites (balloon, floor,
 * materials) thread the trap through a rebuild they trigger mid-session,
 * exactly as they thread every define. JSON round-trips f64 exactly, so
 * the re-baked constants are the installed ones to the bit. */
function materialTrapSpec(material: THREE.ShaderMaterial): ShapeSpec | null {
  if (material.defines.SURFACE_SHAPE_TRAP !== 1) return null;
  const key = (material.userData as { surfaceTrapShapeKey?: string | null })
    .surfaceTrapShapeKey;
  return key ? (JSON.parse(key) as ShapeSpec) : null;
}

/** The escape-only resolved geometry arm, threaded through orthogonal
 * recompiles just like the baked trap spec. */
function materialTrapGeometry(material: THREE.ShaderMaterial): number {
  return material.defines.SURFACE_TRAP_GEOMETRY === 1 ? 1 : 0;
}

function materialCondensationSpecs(
  material: THREE.ShaderMaterial,
): ShapeSpec[] | null {
  if (material.defines.SURFACE_CONDENSATION !== 1) return null;
  return (
    (material.userData as { surfaceCondensationShapes?: ShapeSpec[] | null })
      .surfaceCondensationShapes ?? null
  );
}

/** The trap half of a forward install: resolve the rebuild key (the SHAPE
 * bakes into the fragment, so its identity must key the program exactly as
 * a define does) and push the live uniforms. Shared by the two forward
 * installers so neither can drift. */
function applyShapeTrapInstall(
  material: THREE.ShaderMaterial,
  trap: ShapeTrap | null,
): {
  wantTrap: number;
  wantGeometry: number;
  spec: ShapeSpec | null;
  changed: boolean;
} {
  const spec = trap ? trap.shape : null;
  const key = spec ? JSON.stringify(spec) : null;
  const data = material.userData as { surfaceTrapShapeKey?: string | null };
  const changed = (data.surfaceTrapShapeKey ?? null) !== key;
  data.surfaceTrapShapeKey = key;
  const rt = trap ? resolveShapeTrap(trap) : null;
  if (rt) setSurfaceShapeTrapUniforms(material, rt);
  return {
    wantTrap: rt ? 1 : 0,
    wantGeometry: rt?.geometry ? 1 : 0,
    spec,
    changed,
  };
}

export function setEscapeSystem(
  material: THREE.ShaderMaterial,
  de: EscapeDE,
  color: Vec3,
  trap: ShapeTrap | null = null,
): void {
  if (de.links.length > SURFACE_MAX_MAPS) {
    throw new RangeError(
      `escape DE has ${de.links.length} links, but the material carries at most ${SURFACE_MAX_MAPS}`,
    );
  }
  setSurfaceGrid(material, null);
  const u = material.uniforms;
  const escM = u.uEscM.value as THREE.Matrix3[];
  const escT = u.uEscT.value as THREE.Vector3[];
  const escParams = u.uEscParams.value as THREE.Vector4[];
  const escRadii = u.uEscRadii.value as THREE.Vector4[];
  de.links.forEach((link, i) => {
    const m = link.m;
    escM[i].set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    escT[i].set(...link.t);
    escParams[i].set(link.kind, link.w, link.derivGrowth, 0);
    // This LINK's own fold lengths — the squares EscapeLink already keeps,
    // so the wire transfers the oracle's numbers rather than recomputing
    // them. A chain may hold a different apparatus per link, which is why
    // this is per-slot.
    escRadii[i].set(link.minRadius2, link.fixedRadius2, link.boxLimit, 0);
  });
  (u.uMapColor.value as THREE.Vector3[])[0].set(...color);
  (u.uTrapIndex.value as number[])[0] = 0;
  u.uMapCount.value = de.links.length;
  // The chain's estimate form — one number per CHAIN, resolved by the
  // oracle so the six mirrors cannot each decide it differently.
  u.uEscLogForm.value = de.logEstimate ? 1 : 0;
  u.uSymOrder.value = de.symmetryOrder;
  u.uSymPlane.value = SYM_PLANE_CODE[de.symmetryPlane];
  (u.uSymStep.value as THREE.Vector2).set(1, 0);
  u.uBoundingRadius.value = de.boundingRadius;
  // Escape's pattern frame is origin-anchored. Reset the shared IFS center
  // now so a later pattern-enabled shade variant cannot inherit the previous
  // system's fitted ball center when render families switch in place.
  (u.uBoundCenter.value as THREE.Vector3).set(0, 0, 0);
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
  // Preserve the balloon flag exactly like setSurfaceSystem:
  // balloon-over-escape is a supported wrap. The ground plane is
  // preserved the same way — the classic Mandelbox floor is exactly an
  // escape session's look — and so is the finish (the head link's, here).
  const balloon = material.defines.SURFACE_BALLOON === 1 ? 1 : 0;
  const plane = material.defines.SURFACE_GROUND_PLANE === 1 ? 1 : 0;
  const finish = material.defines.SURFACE_FINISH === 1 ? 1 : 0;
  const pattern = material.defines.SURFACE_PATTERN === 1 ? 1 : 0;
  const trapInstall = applyShapeTrapInstall(material, trap);
  setSurfaceShapeMeshSdf(material, trapInstall.spec ? [trapInstall.spec] : []);
  const currentTrapGeometry = materialTrapGeometry(material);
  if (
    material.defines.SURFACE_ESCAPE !== 1 ||
    material.defines.SURFACE_BULB !== 0 ||
    material.defines.SURFACE_FOLDS !== 0 ||
    material.defines.SURFACE_FOLD_LENS !== 0 ||
    material.defines.SURFACE_SCHEDULE === 1 ||
    material.defines.SURFACE_CHAOS === 1 ||
    material.defines.SURFACE_CONDENSATION !== 0 ||
    material.defines.SURFACE_SHAPE_TRAP !== trapInstall.wantTrap ||
    currentTrapGeometry !== trapInstall.wantGeometry ||
    // A trap SPEC swap at the same define state still bakes a different
    // shape body — the key catches what the defines cannot.
    trapInstall.changed
  ) {
    material.defines.SURFACE_ESCAPE = 1;
    // The two forward-orbit variants are exclusive: a previous Mandelbulb
    // session must hand the bodies back here too.
    material.defines.SURFACE_BULB = 0;
    material.defines.SURFACE_FOLDS = 0;
    material.defines.SURFACE_FOLD_LENS = 0;
    delete material.defines.SURFACE_SCHEDULE;
    delete material.defines.SURFACE_CHAOS;
    u.uScheduleCount.value = 0;
    u.uScheduleDepth.value = 0;
    material.defines.SURFACE_SHAPE_TRAP = trapInstall.wantTrap;
    if (trapInstall.wantGeometry) material.defines.SURFACE_TRAP_GEOMETRY = 1;
    else delete material.defines.SURFACE_TRAP_GEOMETRY;
    material.defines.SURFACE_CONDENSATION = 0;
    u.uCondCount.value = 0;
    (
      material.userData as {
        surfaceCondensationShapeKey?: string | null;
        surfaceCondensationShapes?: ShapeSpec[] | null;
      }
    ).surfaceCondensationShapeKey = null;
    (
      material.userData as { surfaceCondensationShapes?: ShapeSpec[] | null }
    ).surfaceCondensationShapes = null;
    material.fragmentShader = surfaceFragmentFor(
      1,
      0,
      balloon,
      plane,
      0,
      finish,
      pattern,
      undefined,
      trapInstall.spec,
      null,
      false,
      trapInstall.wantGeometry,
    );
    material.needsUpdate = true;
  }
}

/**
 * Pack a {@link BulbDE} and flip the material onto the Mandelbulb variant
 * — {@link setEscapeSystem}'s twin one formula over. The IFS-side uniforms
 * the shared marcher still reads — bounding/visible radii, uMaxDepth (the
 * iteration budget the preview tier clamps through previewMaxDepth), step
 * scale, slot-0 color for the by-transform source — are packed to the bulb
 * set's values; everything descent-specific (maps, symmetry, lenses, grid)
 * is reset to inert, and no grid is ever uploaded for this mode (the
 * empty-space chain's validity argument is IFS-specific). Note the ONE
 * asymmetry against the escape packer: the ORBIT's bailout ball and the
 * QUERY-space marching ball are different numbers here, so uBoundingRadius
 * takes the latter and the bailout rides uBulbParams.y.
 */
export function setBulbSystem(
  material: THREE.ShaderMaterial,
  de: BulbDE,
  color: Vec3,
  trap: ShapeTrap | null = null,
): void {
  setSurfaceGrid(material, null);
  const u = material.uniforms;
  const m = de.m;
  (u.uBulbM.value as THREE.Matrix3).set(
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
  (u.uBulbT.value as THREE.Vector3).set(...de.t);
  (u.uBulbParams.value as THREE.Vector4).set(de.sigmaMax, de.bailout, 0, 0);
  (u.uMapColor.value as THREE.Vector3[])[0].set(...color);
  (u.uTrapIndex.value as number[])[0] = 0;
  u.uMapCount.value = 1;
  u.uSymOrder.value = 1;
  u.uSymPlane.value = 1;
  (u.uSymStep.value as THREE.Vector2).set(1, 0);
  u.uBoundingRadius.value = de.boundingRadius;
  // Bulb query/object space is origin-anchored; see the escape twin above.
  (u.uBoundCenter.value as THREE.Vector3).set(0, 0, 0);
  u.uEscapeRadius.value = de.boundingRadius * 2;
  u.uMaxDepth.value = BULB_ITERATIONS;
  u.uStepScale.value = BULB_STEP_SCALE;
  u.uVisibleRadius.value = de.boundingRadius;
  (u.uFinalInvM.value as THREE.Matrix3).identity();
  (u.uFinalInvT.value as THREE.Vector3).set(0, 0, 0);
  u.uFinalSigmaMin.value = 1;
  (u.uLensParams.value as THREE.Vector4).set(0, 1, 1, 1);
  (u.uLensInvM.value as THREE.Matrix3).identity();
  (u.uLensInvT.value as THREE.Vector3).set(0, 0, 0);
  // Preserve the balloon, ground-plane and finish flags exactly like
  // setEscapeSystem — orthogonal session state their own setters own.
  const balloon = material.defines.SURFACE_BALLOON === 1 ? 1 : 0;
  const plane = material.defines.SURFACE_GROUND_PLANE === 1 ? 1 : 0;
  const finish = material.defines.SURFACE_FINISH === 1 ? 1 : 0;
  const pattern = material.defines.SURFACE_PATTERN === 1 ? 1 : 0;
  const trapInstall = applyShapeTrapInstall(material, trap);
  setSurfaceShapeMeshSdf(material, trapInstall.spec ? [trapInstall.spec] : []);
  const currentTrapGeometry = materialTrapGeometry(material);
  if (
    material.defines.SURFACE_BULB !== 1 ||
    material.defines.SURFACE_ESCAPE !== 0 ||
    material.defines.SURFACE_FOLDS !== 0 ||
    material.defines.SURFACE_FOLD_LENS !== 0 ||
    material.defines.SURFACE_SCHEDULE === 1 ||
    material.defines.SURFACE_CHAOS === 1 ||
    material.defines.SURFACE_CONDENSATION !== 0 ||
    material.defines.SURFACE_SHAPE_TRAP !== trapInstall.wantTrap ||
    currentTrapGeometry !== 0 ||
    trapInstall.changed
  ) {
    material.defines.SURFACE_BULB = 1;
    material.defines.SURFACE_ESCAPE = 0;
    material.defines.SURFACE_FOLDS = 0;
    material.defines.SURFACE_FOLD_LENS = 0;
    delete material.defines.SURFACE_SCHEDULE;
    delete material.defines.SURFACE_CHAOS;
    u.uScheduleCount.value = 0;
    u.uScheduleDepth.value = 0;
    material.defines.SURFACE_SHAPE_TRAP = trapInstall.wantTrap;
    // Shape geometry is escape-only. A direct bulb install can still carry
    // the color trap, but never compiles or preserves the geometry arm.
    delete material.defines.SURFACE_TRAP_GEOMETRY;
    material.defines.SURFACE_CONDENSATION = 0;
    u.uCondCount.value = 0;
    (
      material.userData as {
        surfaceCondensationShapeKey?: string | null;
        surfaceCondensationShapes?: ShapeSpec[] | null;
      }
    ).surfaceCondensationShapeKey = null;
    (
      material.userData as { surfaceCondensationShapes?: ShapeSpec[] | null }
    ).surfaceCondensationShapes = null;
    material.fragmentShader = surfaceFragmentFor(
      0,
      0,
      balloon,
      plane,
      1,
      finish,
      pattern,
      undefined,
      trapInstall.spec,
    );
    material.needsUpdate = true;
  }
}

/** The balloon inverted-union's uniform payload, built by scene.ts from
 * fractal/balloon-de.ts's conventions — see
 * {@link setSurfaceBalloon}. */
export interface SurfaceBalloonSpec {
  /** The DE ball's center (balloon-de.ts's balloonBall convention). */
  center: Vec3;
  /** MARGINED radius — buildBalloon's divisor
   * (`ball.radius * BALLOON_RHO_MARGIN`). */
  rho: number;
  /** Balloon radius R, in world units (`rMult * ball.radius`). */
  R: number;
  /** March far cap: `BALLOON_FAR_CAP_RHO * raw ball radius`. */
  far: number;
}

/**
 * Enable (`spec`) or disable (`null`) the balloon inverted-union wrapper:
 * the scene becomes `min(DE(p), (|p-c|/rho) * DE(I(p)))` over whichever
 * variant is compiled — affine, folds, fold lens or escape — mirroring
 * fractal/balloon-de.ts's `estimateBalloonDistance`. Flipping the flag
 * reassembles the fragment source through {@link surfaceFragmentFor} with
 * the material's CURRENT escape/lens flags (a session-set-scale program
 * rebuild, like the other variant defines); a call that changes only the
 * uniforms — the radius slider's per-drag-tick path — never touches the
 * shader.
 */
export function setSurfaceBalloon(
  material: THREE.ShaderMaterial,
  spec: SurfaceBalloonSpec | null,
): void {
  const u = material.uniforms;
  const center = u.uBalloonCenter.value as THREE.Vector3;
  if (spec) {
    center.set(...spec.center);
    u.uBalloonR.value = spec.R;
    u.uBalloonRho.value = spec.rho;
    u.uBalloonFar.value = spec.far;
  } else {
    // Zeros are fine while the define is off (the compiled program has no
    // balloon code to read them) — except rho, whose 1 keeps even a stray
    // enabled read divide-by-zero-free, matching createSurfaceMaterial's
    // inert defaults.
    center.set(0, 0, 0);
    u.uBalloonR.value = 0;
    u.uBalloonRho.value = 1;
    u.uBalloonFar.value = 0;
  }
  const want = spec ? 1 : 0;
  if (material.defines.SURFACE_BALLOON !== want) {
    // Balloon and ground plane never compile together — the enclosing
    // shell has no horizon for a floor to sit on — and the balloon is
    // senior: turning it on drops the plane define here, and the scene
    // re-asserts its stored floor intent (which its own balloon gate keeps
    // off) after every toggle.
    const plane =
      want === 1 ? 0 : material.defines.SURFACE_GROUND_PLANE === 1 ? 1 : 0;
    material.defines.SURFACE_BALLOON = want;
    material.defines.SURFACE_GROUND_PLANE = plane;
    material.fragmentShader = surfaceFragmentFor(
      material.defines.SURFACE_ESCAPE === 1 ? 1 : 0,
      material.defines.SURFACE_FOLD_LENS === 1 ? 1 : 0,
      want,
      plane,
      material.defines.SURFACE_BULB === 1 ? 1 : 0,
      material.defines.SURFACE_FINISH === 1 ? 1 : 0,
      material.defines.SURFACE_PATTERN === 1 ? 1 : 0,
      undefined,
      materialTrapSpec(material),
      materialCondensationSpecs(material),
      false,
      materialTrapGeometry(material),
      material.defines.SURFACE_SCHEDULE === 1 ? 1 : 0,
      material.defines.SURFACE_CHAOS === 1 ? 1 : 0,
    );
    material.needsUpdate = true;
  }
}

/**
 * Pack the balloon echo's independent tint: the shell-hit mix `mix(base,
 * uBalloonTint, uBalloonTintStrength * shell)` both tracers' `main()`
 * applies before lighting, gated on `surfaceDEBalloonHitInfo`'s own argmin
 * attribution. ONE helper serves BOTH dimensions — this module and
 * `surface-material-4d.ts` declare the identical `uBalloonTint`/
 * `uBalloonTintStrength` uniform names, the established direction of reuse
 * this module already carries the other way (the 4D material imports
 * {@link surfaceFragmentFor} and {@link SurfaceBalloonSpec} from here).
 * Unlike {@link setSurfaceBalloon} this never touches `defines` or
 * `fragmentShader`: the tint lives inside the existing `SURFACE_BALLOON`
 * arm, so there is no recompile to guard against — every call is the
 * radius slider's own per-drag-tick shape. Strength 0 (the default) is a
 * bit-exact identity, matching `createSurfaceMaterial`'s inert uniform.
 */
export function packSurfaceBalloonTint(
  material: THREE.ShaderMaterial,
  tint: Vec3,
  strength: number,
): void {
  const u = material.uniforms;
  (u.uBalloonTint.value as THREE.Vector3).set(...tint);
  u.uBalloonTintStrength.value = strength;
}

/**
 * Select an independent balloon gradient for either GLSL surface material.
 * `null` is explicit inherit: the shader retains its already-resolved base
 * colour and skips the lookup. This is a uniform-only live path; callers own
 * the texture's allocation/upload and render invalidation.
 */
export function packSurfaceBalloonPalette(
  material: THREE.ShaderMaterial,
  texture: THREE.DataTexture | null,
): void {
  const u = material.uniforms;
  if (texture) u.uBalloonColorLUT.value = texture;
  u.uBalloonPaletteEnabled.value = texture ? 1 : 0;
}

/** The ground plane's uniform payload, built by scene.ts from the session
 * ball (fractal/balloon-de.ts's balloonBall convention for IFS systems,
 * the origin bailout ball for escape) — see
 * {@link setSurfaceGroundPlane}. All quantities in world units. */
export interface SurfaceGroundPlaneSpec {
  /** Floor height: ball bottom with a small drop (scene.ts owns the
   * multipliers; the shadow gates' certificates assume >= 1.02 R below
   * the ball CENTER, which any drop below the ball bottom satisfies). */
  y: number;
  /** Radial fade band (from the ball center's xz): fully shaded inside
   * `fadeStart`, pure background past `fadeEnd`. */
  fadeStart: number;
  fadeEnd: number;
  /** The session ball the floor drops under — the shadow corridor and AO
   * reach gates certify against it. */
  ballCenter: Vec3;
  ballRadius: number;
  /** sRGB floor albedo (lit in linear space like every hit). */
  albedo: Vec3;
  pattern?: 0 | 1;
  tileScale?: number;
  emission?: number;
}

/**
 * Enable (`spec`) or disable (`null`) the ground plane: an infinite
 * one-sided floor below the session ball that rays MISSING the fractal
 * intersect analytically and shade with the hit path's penumbra shadow +
 * AO + fog, fading radially into the backdrop. Flipping the flag
 * reassembles the fragment source through {@link surfaceFragmentFor} with
 * the material's CURRENT escape/lens flags (a session-set-scale program
 * rebuild, exactly {@link setSurfaceBalloon}'s contract; plane programs
 * resolve through {@link stripGlslSource}, so even the lens variant stays
 * far under the Mesa cliff). Throws if asked to enable over the balloon
 * variant — callers gate eligibility first (scene.ts's
 * applySurfaceGroundPlane), so reaching the refusal is a bug.
 */
export function setSurfaceGroundPlane(
  material: THREE.ShaderMaterial,
  spec: SurfaceGroundPlaneSpec | null,
): void {
  const u = material.uniforms;
  if (spec) {
    u.uGroundY.value = spec.y;
    u.uGroundFadeStart.value = spec.fadeStart;
    u.uGroundFadeEnd.value = spec.fadeEnd;
    u.uGroundBallR.value = spec.ballRadius;
    (u.uGroundBallC.value as THREE.Vector3).set(...spec.ballCenter);
    (u.uGroundAlbedo.value as THREE.Vector3).set(...spec.albedo);
    u.uGroundPattern.value = spec.pattern ?? 0;
    u.uGroundTileScale.value = spec.tileScale ?? 0.64;
    u.uGroundEmission.value = spec.emission ?? 0;
  } else {
    // Zeros are fine while the define is off — except the ball radius,
    // whose 1 keeps even a stray enabled read divide-by-zero-free,
    // matching createSurfaceMaterial's inert defaults.
    u.uGroundY.value = 0;
    u.uGroundFadeStart.value = 0;
    u.uGroundFadeEnd.value = 0;
    u.uGroundBallR.value = 1;
    (u.uGroundBallC.value as THREE.Vector3).set(0, 0, 0);
    (u.uGroundAlbedo.value as THREE.Vector3).set(1, 1, 1);
    u.uGroundPattern.value = 0;
    u.uGroundTileScale.value = 0.64;
    u.uGroundEmission.value = 0;
  }
  const want = spec ? 1 : 0;
  if (material.defines.SURFACE_GROUND_PLANE !== want) {
    material.defines.SURFACE_GROUND_PLANE = want;
    // surfaceFragmentFor refuses plane-over-lens and plane-over-balloon;
    // passing the current defines through makes those caller bugs loud.
    material.fragmentShader = surfaceFragmentFor(
      material.defines.SURFACE_ESCAPE === 1 ? 1 : 0,
      material.defines.SURFACE_FOLD_LENS === 1 ? 1 : 0,
      material.defines.SURFACE_BALLOON === 1 ? 1 : 0,
      want,
      material.defines.SURFACE_BULB === 1 ? 1 : 0,
      material.defines.SURFACE_FINISH === 1 ? 1 : 0,
      material.defines.SURFACE_PATTERN === 1 ? 1 : 0,
      undefined,
      materialTrapSpec(material),
      materialCondensationSpecs(material),
      false,
      materialTrapGeometry(material),
      material.defines.SURFACE_SCHEDULE === 1 ? 1 : 0,
      material.defines.SURFACE_CHAOS === 1 ? 1 : 0,
    );
    material.needsUpdate = true;
  }
}

/** Install the unified per-map A/B material wire and its independent compile
 * gates. `null` is exactly classic+none: every lane resets to the historical
 * classic values and both gated sources disappear. Pattern-only sessions keep
 * SURFACE_FINISH off (the fixed lighting literal remains) while the composite
 * declaration gate exposes A/B and SURFACE_PATTERN exposes the one per-DE
 * calibration quartet. Every slot is rewritten so no previous session leaks.
 * A lane-only edit with unchanged gates never rebuilds the shader. */
export function setSurfaceMaterials(
  material: THREE.ShaderMaterial,
  materials: SurfaceMaterialSlots | null,
): void {
  if (materials && materials.slots.length > SURFACE_MAX_MAPS) {
    throw new RangeError(
      `${materials.slots.length} surface materials, but the material carries at most ${SURFACE_MAX_MAPS}`,
    );
  }
  const u = material.uniforms;
  const laneA = u.uMapFinishA.value as THREE.Vector4[];
  const laneB = u.uMapFinishB.value as THREE.Vector4[];
  for (let j = 0; j < SURFACE_MAX_MAPS; j++) {
    const lanes =
      materials && j < materials.slots.length
        ? surfaceMaterialLanes(materials.slots[j])
        : CLASSIC_MATERIAL_LANES;
    laneA[j].set(...lanes.a);
    laneB[j].set(...lanes.b);
  }
  const calibration = u.uPatternCalibration.value as THREE.Vector4;
  if (materials?.pattern) {
    const c = materials.patternCalibration;
    calibration.set(c.ringsLow, c.ringsInvSpan, c.sheetsLow, c.sheetsInvSpan);
  } else {
    calibration.set(0, 0, 0, 0);
  }
  const wantFinish = materials?.finish ? 1 : 0;
  const wantPattern = materials?.pattern ? 1 : 0;
  const currentPattern = material.defines.SURFACE_PATTERN === 1 ? 1 : 0;
  if (
    material.defines.SURFACE_FINISH !== wantFinish ||
    currentPattern !== wantPattern
  ) {
    material.defines.SURFACE_FINISH = wantFinish;
    // Keep the classic material's define set byte-identical: the new key only
    // exists while the independent pattern gate is actually on.
    if (wantPattern) material.defines.SURFACE_PATTERN = 1;
    else delete material.defines.SURFACE_PATTERN;
    material.fragmentShader = surfaceFragmentFor(
      material.defines.SURFACE_ESCAPE === 1 ? 1 : 0,
      material.defines.SURFACE_FOLD_LENS === 1 ? 1 : 0,
      material.defines.SURFACE_BALLOON === 1 ? 1 : 0,
      material.defines.SURFACE_GROUND_PLANE === 1 ? 1 : 0,
      material.defines.SURFACE_BULB === 1 ? 1 : 0,
      wantFinish,
      wantPattern,
      undefined,
      materialTrapSpec(material),
      materialCondensationSpecs(material),
      false,
      materialTrapGeometry(material),
      material.defines.SURFACE_SCHEDULE === 1 ? 1 : 0,
      material.defines.SURFACE_CHAOS === 1 ? 1 : 0,
    );
    material.needsUpdate = true;
  }
}
