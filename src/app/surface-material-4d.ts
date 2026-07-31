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
 * (`src/fractal/surface-de-4d.ts`) and packed here into the fixed-size
 * arrays of a std140 uniform BLOCK (fr-dqlq — that block is what lets the
 * cap match 3D's 24 maps). The refined certificate — one extra Hutchinson
 * level applied to every escaped, non-descended sibling before it freezes
 * into the running min — was the fr-beck spike's measured ghost-eliminator
 * (0.0% ghost-of-hits on every slice measured, down from a 4.7-84.6% range
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
 * The slice has a THICKNESS since fr-wa6o. With `uSliceHalfW > 0` the query
 * stops being the point `(p, uW0)` and becomes the SEGMENT spanning
 * `|w - uW0| <= uSliceHalfW` over `p`, so what the tracer marches is a
 * SLAB's projected shadow rather than a single cross-section — thin
 * structure that a zero-thickness plane can only ever catch edge-on reads
 * as solid. Affine maps take segments to segments, which is why the whole
 * descent generalizes term for term: one extra `vec4` beside every chain's
 * and candidate's point (moved by each inverse map's LINEAR part alone —
 * translations slide a segment's centre, never its extent),
 * {@link segmentRadius} wherever the point path took `length`, and a
 * visible-ball gate widened to the slab's most generous `|w|`. The bound
 * only loosens, by at most `uSliceHalfW`, and its zero set is exactly the
 * shadow being marched; the validity argument in full is the SLAB QUERIES
 * section of `surface-de-4d.ts`'s module doc, whose `halfExtent` parameter
 * this mirrors. `uSliceHalfW == 0` — the shipped default — renders today's
 * frame value for value: `segmentRadius` degenerates to `length`, and a
 * zero extent stays zero through any linear map. Cost, honestly: the
 * `segment` flag each body hoists is dynamically uniform across a draw, so
 * the propagation branches are free when the slab is off, but the extra
 * `vec4` per slot is live register pressure either way.
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

/** Compile-time size of the per-map arrays — 24, matching the 3D tracer's
 * `SURFACE_MAX_MAPS`, so the 24-map presets (`twentyFourCell`, i.e.
 * `twentyFourCellFlake`) can be surfaced (fr-dqlq).
 *
 * The cap sat at 16 while the arrays lived in the DEFAULT uniform block,
 * where they cost ~8 of WebGL2's guaranteed 224 fragment uniform VECTORS per
 * slot (a mat4 array element takes 4 rows; a float or vec3 element takes a
 * whole row each — 4 + 1 + 1 + 1 + 1) — 24 slots would have been 192 rows,
 * plus the ~33 misc uniforms below, close enough to a link failure on
 * minimum-spec devices to be worth avoiding. fr-dqlq moved them into the
 * std140 uniform BLOCK declared in the fragment shader below, which is
 * budgeted separately: 24 slots of mat4 + 3 vec4 = 24 * (64 + 16 + 16 + 16)
 * = 2688 bytes of the 16 KB block size (and 1 of the 12 fragment blocks)
 * every WebGL2 device guarantees. Raising the cap further is now a matter of
 * how much per-ray DESCENT cost the tracer can afford, not of uniform space.
 *
 * With no kaleidoscope symmetry in 4D (see surface-de-4d.ts's module doc),
 * 24 slots means 24 transforms, no expansion. The app gates systems whose
 * map count exceeds it before entering the mode, so {@link setSurfaceSystem4}
 * treats overflow as a bug, not a degrade. */
export const SURFACE4_MAX_MAPS = 24;

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

  /** Everything per-map, in a std140 uniform BLOCK rather than the default
   * block (fr-dqlq): 24 slots cost 2688 bytes of the 16 KB every WebGL2
   * device guarantees per block, where the same arrays as default-block
   * uniforms would have eaten 192 of the guaranteed 224 fragment uniform
   * vectors. Only the first uMapCount slots are meaningful; the rest are
   * stale/identity and never read. No symmetry expansion in 4D (see
   * surface-de-4d.ts's module doc) — one slot per INPUT transform.
   *
   * This member list IS the layout contract with the THREE.UniformsGroup in
   * createSurfaceMaterial4 below: the renderer uploads that group's backing
   * Float32Arrays at std140 offsets it derives from their ORDER and byte
   * lengths, so a member added, reordered, or resized here must move there
   * too. Scalars are folded into vec4 lanes rather than declared as
   * float[MAX_MAPS] because std140 strides a scalar array element a full
   * 16 bytes: two half-used lanes are cheaper than four rows of padding, and
   * far harder to get subtly wrong. Integers stay OUT of the block entirely
   * (three's UBO writer is float-only) — hence uMapCount below. */
  layout(std140) uniform SurfaceMaps4 {
    /** Inverse linear part per map, column-major as std140 stores a mat4. */
    mat4 uInvM[MAX_MAPS];
    /** Inverse translation per map: -inv(M_i) . t_i. */
    vec4 uInvT[MAX_MAPS];
    /** xyz = sRGB 0..1 base color per map slot (keyed to base maps
     * caller-side); w = smallest singular value of the FORWARD map, the
     * certified contraction factor multiplied into the running scale
     * product. */
    vec4 uMapColorSigma[MAX_MAPS];
    /** x = per-slot palette coordinate in [0, 1] for the orbit trap
     * (CPU-precomputed from each slot's base-map index); yzw unused. */
    vec4 uMapTrap[MAX_MAPS];
  };
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
  /** The marched w-slice, as a WORLD w in the view frame — the same
   * hyperplane the cloud/flame/voxel renderers slice at, but not the same
   * NUMBER: their slice window is written in normalized rotated-w
   * (q.w * uInvWAmp4), and scene.ts's setSurface4View converts the shared
   * slider through wSupport on the way here (fr-33yb). Backticks would end
   * this template literal, so this whole GLSL source names code plainly. */
  uniform float uW0;
  /** HALF-THICKNESS of the marched SLAB, a literal world w in the view
   * frame — the same units and the same frame as uW0 (fr-wa6o). 0 is the
   * zero-thickness hyperplane this tracer shipped with, and every term
   * below collapses to that path's arithmetic bit for bit (see
   * segmentRadius); above 0 each query becomes the SEGMENT the slab
   * |w - uW0| less than or equal to uSliceHalfW cuts over the queried 3D
   * point, so the render shows the slab's whole shadow rather than one
   * cross-section. The validity argument — affine maps take segments to
   * segments, so every chain carries one extra vec4 and every ball
   * certificate reads a segment radius — is the SLAB QUERIES section of
   * surface-de-4d.ts's module doc, which this shader mirrors. */
  uniform float uSliceHalfW;
  /** Base-color source: 0 = by-transform (uMapColorSigma.xyz), 1 = orbit-trap
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
  /** Angular pixel footprint of the ACTIVE buffer (scene-set per frame):
   * sizes the shading probes (normal offsets, ray dither) to the pixels
   * actually being rendered — not the hit test; see uAcceptPixelEps. */
  uniform float uPixelEps;
  /** Angular pixel footprint of the FULL-RESOLUTION frame, tier-INDEPENDENT
   * (fr-7xgi, mirrored from the 3D tracer): hit acceptance and the DE
   * cutoff run at max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor) in
   * every tier — a tier may coarsen sampling, never acceptance, so a
   * preview can never accept a hit the settle frame would reject. The 3D
   * declaration's doc carries the measured fold-phantom mechanism that
   * forced this; the 4D tracer takes the same contract for lockstep. */
  uniform float uAcceptPixelEps;

  in vec2 vUv;
  out vec4 outColor;

  /** Per-pixel dither for the march start so grazing rays don't band. */
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  /** Distance from the ORIGIN to the segment q + s*e, s in [-1, 1] — the
   * slab query's stand-in for length(q) at every radius, escape test and
   * ball certificate the descent computes (fr-wa6o; the oracle's own
   * segmentRadius, and the SLAB QUERIES section of surface-de-4d.ts's
   * module doc). s is the segment's own parameter at closest approach: the
   * unconstrained minimizer of the squared length is -dot(q, e) / dot(e, e),
   * and clamping it to the segment's ends turns the infinite LINE's distance
   * (which undershoots, and by more than the slab justifies) into the
   * segment's exact one.
   *
   * At e = 0 this returns length(q) bit for bit — ee = 0 takes the guarded
   * s = 0 branch and q + 0*e is q exactly — which is what lets the whole
   * thickness feature ship defaulting to uSliceHalfW = 0 with the
   * zero-thickness path unchanged value for value.
   *
   * OVERFLOW TAIL — this body's, and the one the oracle's f64 note is
   * about. chainScale * length(e) stays at or under uSliceHalfW at every
   * level (the module doc's bound), so ee only overflows highp float once
   * length(e) passes its square-root ceiling of ~1.8e19 — which takes a
   * chainScale below uSliceHalfW / 1.8e19, sixteen orders of magnitude
   * under the feature resolution uMaxDepth is sized from, where
   * certificates are numerically dead. There ee saturates to infinity, s
   * divides to 0, and this degrades to length(q): an overshoot of a term
   * already indistinguishable from zero. */
  float segmentRadius(vec4 q, vec4 e) {
    float ee = dot(e, e);
    float s = ee > 0.0 ? clamp(-dot(q, e) / ee, -1.0, 1.0) : 0.0;
    return length(q + s * e);
  }

  /** One extra Hutchinson level on a frozen escaped candidate's own inverse
   * image (the oracle's refinedCert): the certificate becomes
   * childScale * max(r - R, min_k sigmaMin_k * (|invMap_k(img)| - R)) —
   * never below the base childScale * (r - R). fr-beck measured this exact
   * refinement eliminating every march ghost.
   *
   * imgExt is the candidate's segment half-extent (fr-wa6o), carried
   * through each inner map by its LINEAR part alone and turning that
   * |invMap_k(img)| into a segment radius; zero — the point query — leaves
   * every term above unchanged. The segment flag is recomputed from
   * uSliceHalfW here rather than passed, because a free function sees no
   * caller scope; it is the same dynamically-uniform test the descent
   * bodies hoist, so both branches cost nothing across a draw. */
  float refinedCert4(vec4 img, vec4 imgExt, float r, float childScale) {
    bool segment = uSliceHalfW > 0.0;
    float inner = 1e30;
    for (int k = 0; k < uMapCount; k++) {
      vec4 kImg = uInvM[k] * img + uInvT[k];
      vec4 kExt = segment ? uInvM[k] * imgExt : vec4(0.0);
      float rk = segmentRadius(kImg, kExt);
      inner = min(inner, uMapColorSigma[k].w * (rk - uBoundingRadius));
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
   * would re-open the ghost class refinement exists to kill: a
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
   * SLAB QUERIES (fr-wa6o), mirroring the oracle's halfExtent parameter.
   * The query is no longer the single point (p, uW0) but the SEGMENT it
   * spans through the slab of half-thickness uSliceHalfW — the part of
   * |w - uW0| less than or equal to uSliceHalfW sitting over p — so the
   * marched object is the slab's shadow rather than one cross-section.
   * Affine maps take segments to segments, so the whole descent carries
   * one extra vec4 beside each chain's and candidate's point, pushed
   * through the inverse map's LINEAR part alone (a translation slides a
   * segment's centre and leaves its extent alone), and every |q| - R ball
   * certificate becomes segmentRadius(q, ext) - R. Beam, validity slots,
   * refined certificates, terminal KIFS bound, depth-0 sphere floor, final
   * lens and both early exits are structurally untouched; the bound only
   * loosens, by at most uSliceHalfW (see the oracle's HOW MUCH THE BOUND
   * CAN LOSE), and the zero set is exactly the shadow being marched, so
   * nothing new can go unsound. Cost: uSliceHalfW greater than 0 is the
   * segment flag each body hoists, DYNAMICALLY UNIFORM across a draw, so
   * the propagation branches cost nothing when the slab is off — but the
   * extra vec4 per chain, candidate, eviction and image slot is live
   * register pressure either way, the one price this pays unconditionally.
   * At uSliceHalfW == 0 every value here is today's, bit for bit:
   * segmentRadius degenerates to length, and a zero extent stays zero
   * through any linear map.
   */
  float surfaceDE(vec3 p, float cutoff) {
    // View -> attractor frame: a rotation is an isometry, so the DE's
    // distances and gradients survive the lift untouched; then the final
    // lens, exactly as the oracle's prologue.
    vec4 q = uInvRotor * vec4(p, uW0);
    // The query's half-extent, carried alongside the point down every
    // chain (fr-wa6o). Zero — the shipped slider position — is the point
    // query this tracer shipped with, and every term below collapses to it
    // exactly (see segmentRadius). The slab's half-extent in the ATTRACTOR
    // frame: a w displacement of uSliceHalfW in the view frame is
    // uSliceHalfW times the inverse rotor's w column.
    bool segment = uSliceHalfW > 0.0;
    vec4 ext = segment ? uInvRotor[3] * uSliceHalfW : vec4(0.0);
    q = uFinalInvM * q + uFinalInvT;
    // The lens carries the extent by its LINEAR part alone — uFinalInvT
    // slides the segment's centre and leaves its extent untouched.
    if (segment) {
      ext = uFinalInvM * ext;
    }
    float startR = segmentRadius(q, ext);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    // The value below which this descent may stop (the oracle bailBelow).
    // -1e30 disables the test: a cutoff of 0.0, and a depth-0 sphere floor
    // that already holds the answer at or above the cutoff no matter how
    // far best falls, since the floor is what the return clamps to. (That
    // sphere floor case now has its own unconditional exit — fr-zkt2,
    // below — that fires the moment best reaches it, cutoff or not.)
    float bailBelow =
      (cutoff > 0.0 && sphereBound * uFinalSigmaMin < cutoff) ? cutoff : -1e30;
    // Chain slot A starts at the (lensed) query; slot B idles until beam
    // selection fills it. Each chain carries the contraction accumulated
    // INCLUDING its own map and the radius it was selected at, plus (since
    // fr-wa6o) its own segment half-extent — one vec4 where the oracle
    // unrolls a 4-element buffer.
    vec4 aQ = q;
    vec4 aExt = ext;
    float aScale = 1.0;
    float aR = startR;
    bool aLive = true;
    vec4 bQ = vec4(0.0);
    vec4 bExt = vec4(0.0);
    float bScale = 1.0;
    float bR = 0.0;
    bool bLive = false;
    // Validity chains (fr-jkpn): they hold the level's rank-3/4
    // candidates ONLY while their points are in-sphere, and carry no R
    // field — unlike A/B they never fold a terminal (see past the loop),
    // and expansion re-derives every child radius, so the selection
    // radius is dead weight once occupancy is decided.
    vec4 v1Q = vec4(0.0);
    vec4 v1Ext = vec4(0.0);
    float v1Scale = 1.0;
    bool v1Live = false;
    vec4 v2Q = vec4(0.0);
    vec4 v2Ext = vec4(0.0);
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
      vec4 c1Ext = vec4(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
      float c2Key = 1e30;
      vec4 c2Q = vec4(0.0);
      vec4 c2Ext = vec4(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
      // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
      // by everything the top-2 ladder evicts, so the pair holds exactly
      // the level's third- and fourth-smallest keys.
      float c3Key = 1e30;
      vec4 c3Q = vec4(0.0);
      vec4 c3Ext = vec4(0.0);
      float c3Scale = 1.0;
      float c3R = 0.0;
      float c3Cert = 0.0;
      float c4Key = 1e30;
      vec4 c4Q = vec4(0.0);
      vec4 c4Ext = vec4(0.0);
      float c4Scale = 1.0;
      float c4R = 0.0;
      float c4Cert = 0.0;
      for (int c = 0; c < 4; c++) {
        vec4 pQ = vec4(0.0);
        vec4 pExt = vec4(0.0);
        float pScale = 1.0;
        if (c == 0) {
          if (!aLive) {
            continue;
          }
          pQ = aQ;
          pExt = aExt;
          pScale = aScale;
        } else if (c == 1) {
          if (!bLive) {
            continue;
          }
          pQ = bQ;
          pExt = bExt;
          pScale = bScale;
        } else if (c == 2) {
          if (!v1Live) {
            continue;
          }
          pQ = v1Q;
          pExt = v1Ext;
          pScale = v1Scale;
        } else {
          if (!v2Live) {
            continue;
          }
          pQ = v2Q;
          pExt = v2Ext;
          pScale = v2Scale;
        }
        for (int j = 0; j < uMapCount; j++) {
          vec4 img = uInvM[j] * pQ + uInvT[j];
          // uInvM[j] carries no translation — uInvT[j] is a separate
          // member — so this IS the inverse map's linear part, all a
          // segment's half-extent ever sees (fr-wa6o).
          vec4 imgExt = segment ? uInvM[j] * pExt : vec4(0.0);
          float r = segmentRadius(img, imgExt);
          float key = pScale * (r - uBoundingRadius);
          float childScale = pScale * uMapColorSigma[j].w;
          float cert = childScale * (r - uBoundingRadius);
          // Exactly one tuple leaves the top-2 ladder per candidate — the
          // displaced runner-up, or the candidate itself. It spills into
          // the rank-3/4 ladder or folds below; empty-slot sentinels flow
          // through both harmlessly (key 1e30 never inserts, r = 0 never
          // folds).
          float eKey = key;
          vec4 eQ = img;
          vec4 eExt = imgExt;
          float eScale = childScale;
          float eR = r;
          float eCert = cert;
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
            eExt = c2Ext;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = c1Key;
            c2Q = c1Q;
            c2Ext = c1Ext;
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c1Key = key;
            c1Q = img;
            c1Ext = imgExt;
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
          } else if (key < c2Key) {
            eKey = c2Key;
            eQ = c2Q;
            eExt = c2Ext;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = key;
            c2Q = img;
            c2Ext = imgExt;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          }
          // Spill into the rank-3/4 ladder (unconditional at width 4);
          // what THAT evicts (or the spilled tuple itself, when it beats
          // neither slot) falls through to the fold below.
          if (eKey < c3Key) {
            // The evicted key is dead past this point — only the folded
            // fields (point, extent, scale, radius, certificate) survive;
            // width 4 is hardcoded here, so there is no tKey — and the
            // oracle's width-3/4 'extra' conditionals collapse with it (its
            // ternary here always takes the c4 arm).
            vec4 tQ = c4Q;
            vec4 tExt = c4Ext;
            float tScale = c4Scale;
            float tR = c4R;
            float tCert = c4Cert;
            c4Key = c3Key;
            c4Q = c3Q;
            c4Ext = c3Ext;
            c4Scale = c3Scale;
            c4R = c3R;
            c4Cert = c3Cert;
            c3Key = eKey;
            c3Q = eQ;
            c3Ext = eExt;
            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
            eQ = tQ;
            eExt = tExt;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          } else if (eKey < c4Key) {
            vec4 tQ = c4Q;
            vec4 tExt = c4Ext;
            float tScale = c4Scale;
            float tR = c4R;
            float tCert = c4Cert;
            c4Key = eKey;
            c4Q = eQ;
            c4Ext = eExt;
            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
            eQ = tQ;
            eExt = tExt;
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
            best = min(best, refinedCert4(eQ, eExt, eR, eScale));
            // Cutoff exit (fr-55r5) plus the sphere-floor pin (fr-zkt2):
            // the folded certificate is FINALIZED (already refined), and
            // best only falls from here. Once best is at or below
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
          aExt = c1Ext;
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
          bExt = c2Ext;
          bScale = c2Scale;
          bR = c2R;
          bLive = true;
        }
      }
      if (c3Key < 1e29) {
        if (c3R > uBoundingRadius) {
          if (c3Cert < best) {
            best = min(best, refinedCert4(c3Q, c3Ext, c3R, c3Scale));
          }
        } else {
          v1Q = c3Q;
          v1Ext = c3Ext;
          v1Scale = c3Scale;
          v1Live = true;
        }
      }
      if (c4Key < 1e29) {
        if (c4R > uBoundingRadius) {
          if (c4Cert < best) {
            best = min(best, refinedCert4(c4Q, c4Ext, c4R, c4Scale));
          }
        } else {
          v2Q = c4Q;
          v2Ext = c4Ext;
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

  /** Value form: the full descent, no early-out — every caller that needs
   * the DISTANCE rather than a hit decision (normal taps, shadow rays,
   * occlusion probes) goes through here, exactly as they pass the oracle
   * its default cutoff of 0. */
  float surfaceDE(vec3 p) {
    return surfaceDE(p, 0.0);
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
   *
   * The fr-wa6o slab query rides here identically — same extent prologue,
   * same vec4 per chain, candidate and eviction slot, same segmentRadius
   * at every ball certificate — because lockstep with the plain overload
   * IS the contract; only the extras above are extra. Of those, rings
   * inherits the segment radius (it reads c1R, which is one), while sheets
   * keeps reading the chain centre's y: shading, not distance.
   */
  float surfaceDE(
    vec3 p,
    out int firstChoice,
    out float trap,
    out float rings,
    out float sheets
  ) {
    vec4 q = uInvRotor * vec4(p, uW0);
    // The slab query's half-extent (fr-wa6o), exactly as the plain
    // overload's prologue derives it — see that body's doc comment.
    bool segment = uSliceHalfW > 0.0;
    vec4 ext = segment ? uInvRotor[3] * uSliceHalfW : vec4(0.0);
    q = uFinalInvM * q + uFinalInvT;
    // The lens carries the extent by its LINEAR part alone — uFinalInvT
    // slides the segment's centre and leaves its extent untouched.
    if (segment) {
      ext = uFinalInvM * ext;
    }
    float startR = segmentRadius(q, ext);
    float sphereBound = startR - uBoundingRadius;
    float best = 1e30;
    vec4 aQ = q;
    vec4 aExt = ext;
    float aScale = 1.0;
    float aR = startR;
    bool aLive = true;
    vec4 bQ = vec4(0.0);
    vec4 bExt = vec4(0.0);
    float bScale = 1.0;
    float bR = 0.0;
    bool bLive = false;
    // Validity chains (fr-jkpn): they hold the level's rank-3/4
    // candidates ONLY while their points are in-sphere, and carry no R
    // field — unlike A/B they never fold a terminal (see past the loop),
    // and expansion re-derives every child radius, so the selection
    // radius is dead weight once occupancy is decided.
    vec4 v1Q = vec4(0.0);
    vec4 v1Ext = vec4(0.0);
    float v1Scale = 1.0;
    bool v1Live = false;
    vec4 v2Q = vec4(0.0);
    vec4 v2Ext = vec4(0.0);
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
      vec4 c1Ext = vec4(0.0);
      float c1Scale = 1.0;
      float c1R = 0.0;
      float c1Cert = 0.0;
      int c1Map = 0;
      float c2Key = 1e30;
      vec4 c2Q = vec4(0.0);
      vec4 c2Ext = vec4(0.0);
      float c2Scale = 1.0;
      float c2R = 0.0;
      float c2Cert = 0.0;
      // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
      // by everything the top-2 ladder evicts, so the pair holds exactly
      // the level's third- and fourth-smallest keys.
      float c3Key = 1e30;
      vec4 c3Q = vec4(0.0);
      vec4 c3Ext = vec4(0.0);
      float c3Scale = 1.0;
      float c3R = 0.0;
      float c3Cert = 0.0;
      float c4Key = 1e30;
      vec4 c4Q = vec4(0.0);
      vec4 c4Ext = vec4(0.0);
      float c4Scale = 1.0;
      float c4R = 0.0;
      float c4Cert = 0.0;
      for (int c = 0; c < 4; c++) {
        vec4 pQ = vec4(0.0);
        vec4 pExt = vec4(0.0);
        float pScale = 1.0;
        if (c == 0) {
          if (!aLive) {
            continue;
          }
          pQ = aQ;
          pExt = aExt;
          pScale = aScale;
        } else if (c == 1) {
          if (!bLive) {
            continue;
          }
          pQ = bQ;
          pExt = bExt;
          pScale = bScale;
        } else if (c == 2) {
          if (!v1Live) {
            continue;
          }
          pQ = v1Q;
          pExt = v1Ext;
          pScale = v1Scale;
        } else {
          if (!v2Live) {
            continue;
          }
          pQ = v2Q;
          pExt = v2Ext;
          pScale = v2Scale;
        }
        for (int j = 0; j < uMapCount; j++) {
          vec4 img = uInvM[j] * pQ + uInvT[j];
          // uInvM[j] carries no translation — uInvT[j] is a separate
          // member — so this IS the inverse map's linear part, all a
          // segment's half-extent ever sees (fr-wa6o).
          vec4 imgExt = segment ? uInvM[j] * pExt : vec4(0.0);
          float r = segmentRadius(img, imgExt);
          float key = pScale * (r - uBoundingRadius);
          float childScale = pScale * uMapColorSigma[j].w;
          float cert = childScale * (r - uBoundingRadius);
          // Exactly one tuple leaves the top-2 ladder per candidate — the
          // displaced runner-up, or the candidate itself. It spills into
          // the rank-3/4 ladder or folds below; empty-slot sentinels flow
          // through both harmlessly (key 1e30 never inserts, r = 0 never
          // folds).
          float eKey = key;
          vec4 eQ = img;
          vec4 eExt = imgExt;
          float eScale = childScale;
          float eR = r;
          float eCert = cert;
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
            eExt = c2Ext;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = c1Key;
            c2Q = c1Q;
            c2Ext = c1Ext;
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c1Key = key;
            c1Q = img;
            c1Ext = imgExt;
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
            c1Map = j;
          } else if (key < c2Key) {
            eKey = c2Key;
            eQ = c2Q;
            eExt = c2Ext;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = key;
            c2Q = img;
            c2Ext = imgExt;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          }
          // Spill into the rank-3/4 ladder (unconditional at width 4);
          // what THAT evicts (or the spilled tuple itself, when it beats
          // neither slot) falls through to the fold below.
          if (eKey < c3Key) {
            // The evicted key is dead past this point — only the folded
            // fields (point, extent, scale, radius, certificate) survive;
            // width 4 is hardcoded here, so there is no tKey — and the
            // oracle's width-3/4 'extra' conditionals collapse with it (its
            // ternary here always takes the c4 arm).
            vec4 tQ = c4Q;
            vec4 tExt = c4Ext;
            float tScale = c4Scale;
            float tR = c4R;
            float tCert = c4Cert;
            c4Key = c3Key;
            c4Q = c3Q;
            c4Ext = c3Ext;
            c4Scale = c3Scale;
            c4R = c3R;
            c4Cert = c3Cert;
            c3Key = eKey;
            c3Q = eQ;
            c3Ext = eExt;
            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
            eQ = tQ;
            eExt = tExt;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          } else if (eKey < c4Key) {
            vec4 tQ = c4Q;
            vec4 tExt = c4Ext;
            float tScale = c4Scale;
            float tR = c4R;
            float tCert = c4Cert;
            c4Key = eKey;
            c4Q = eQ;
            c4Ext = eExt;
            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
            eQ = tQ;
            eExt = tExt;
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
            best = min(best, refinedCert4(eQ, eExt, eR, eScale));
          }
        }
      }
      if (depth == 0) {
        firstChoice = c1Map;
      }
      trapAcc += trapW * uMapTrap[c1Map].x;
      trapNorm += trapW;
      trapW *= uColorSpeed;
      rings = min(rings, c1R / uBoundingRadius);
      // Under a slab query (fr-wa6o) rings rides the SEGMENT radius, since
      // c1R is one; sheets keeps reading the segment's CENTRE y by design —
      // a shading extra, not part of the distance contract, and a coordinate
      // is what the plane trap wants.
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
          aExt = c1Ext;
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
          bExt = c2Ext;
          bScale = c2Scale;
          bR = c2R;
          bLive = true;
        }
      }
      if (c3Key < 1e29) {
        if (c3R > uBoundingRadius) {
          if (c3Cert < best) {
            best = min(best, refinedCert4(c3Q, c3Ext, c3R, c3Scale));
          }
        } else {
          v1Q = c3Q;
          v1Ext = c3Ext;
          v1Scale = c3Scale;
          v1Live = true;
        }
      }
      if (c4Key < 1e29) {
        if (c4R > uBoundingRadius) {
          if (c4Cert < best) {
            best = min(best, refinedCert4(c4Q, c4Ext, c4R, c4Scale));
          }
        } else {
          v2Q = c4Q;
          v2Ext = c4Ext;
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

    // The 3D ball the marched w-SLAB of the visible 4D set can occupy:
    // |(p, w)| <= uVisibleRadius implies |p| <= this (rotation preserves
    // the 4D norm), taken at the slab's most generous w — the |w| in
    // [|uW0| - uSliceHalfW, |uW0| + uSliceHalfW] closest to 0, since a
    // smaller |w| leaves a wider 3D ball (fr-wa6o). Empty when the whole
    // slab sits past the visible radius. At uSliceHalfW == 0 this is
    // abs(uW0) squared, the zero-thickness value bit for bit.
    float sliceMinW = max(abs(uW0) - uSliceHalfW, 0.0);
    float sliceVisR =
      sqrt(max(uVisibleRadius * uVisibleRadius - sliceMinW * sliceMinW, 0.0));

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
    // with distance), floored so the test can't degenerate at t ~ 0. That
    // same epsilon is handed to the DE as its early-out cutoff (fr-55r5):
    // this test is all the step asks of the descent, so the descent may
    // stop as soon as its bound is provably under it. A returned value at
    // or above the epsilon is the full-descent distance bit for bit, so the
    // step length below never drifts. The march runs the plain DE overload;
    // the hit's coloring extras are fetched once below.
    bool hit = false;
    for (int i = 0; i < uMarchSteps; i++) {
      if (t > tFar) {
        break;
      }
      // Tier-independent acceptance — see uAcceptPixelEps (fr-7xgi).
      float eps = max(uAcceptPixelEps * t, uBoundingRadius * uHitFloor);
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
    // color.ts's ONE ramp definition — no ramp math lands here; rings and
    // sheets arrive pre-normalized from the descent.
    vec3 base;
    if (uColorSource == 0) {
      base = uMapColorSigma[clamp(firstChoice, 0, uMapCount - 1)].xyz;
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
        //
        // With a slab (uSliceHalfW > 0, fr-wa6o) this lifts through the
        // slab's CENTRE plane, not the hit's own w — which the descent
        // knows (its segment parameter at closest approach) but does not
        // report back. So the ramp reads one shell across the slab's
        // depth. Same class as the sheets trap above: a shading extra, not
        // part of the distance contract, and exact at uSliceHalfW = 0.
        // Tracked as its own follow-up rather than fixed here, since
        // threading a w out of the descent needs a decision about WHICH
        // level's is the honest one.
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

/** CPU mirror of the `SurfaceMaps4` std140 block (fr-dqlq) — the four
 * Float32Arrays the renderer uploads verbatim, in the SAME ORDER as the
 * block's members in `SURFACE4_FRAGMENT`. Held per material rather than
 * module-wide so a second tracer would get its own buffer. */
interface Surface4MapBuffers {
  /** MAX_MAPS * 16 floats: `inv(M_i)` COLUMN-major, std140's mat4 layout. */
  readonly invM: Float32Array;
  /** MAX_MAPS * 4 floats: `-inv(M_i) . t_i`. */
  readonly invT: Float32Array;
  /** MAX_MAPS * 4 floats: (r, g, b, sigmaMin). */
  readonly colorSigma: Float32Array;
  /** MAX_MAPS * 4 floats: (trapIndex, unused, unused, unused). */
  readonly trap: Float32Array;
}

/** Which buffers back which material's map block. A WeakMap rather than
 * `material.uniforms` entries because block members must NOT appear as
 * default-block uniforms, and rather than `userData` because nothing outside
 * this module has any business reaching them: {@link setSurfaceSystem4} is
 * the only writer, and it only ever sees materials this module built. */
const mapBuffers = new WeakMap<THREE.ShaderMaterial, Surface4MapBuffers>();

/** Build the surface material with placeholder uniforms (zero maps, unit
 * hypersphere): complete and compilable before the first system arrives,
 * painting only the backdrop until {@link setSurfaceSystem4} and
 * {@link setSurfaceView4} run. The per-map block and the remaining uniform
 * values are allocated ONCE at the compile-time cap and mutated in place —
 * Three binds uniform values by object identity, so replacing them would
 * orphan the binding. */
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
  const buffers: Surface4MapBuffers = {
    invM: new Float32Array(SURFACE4_MAX_MAPS * 16),
    invT: new Float32Array(SURFACE4_MAX_MAPS * 4),
    colorSigma: new Float32Array(SURFACE4_MAX_MAPS * 4),
    trap: new Float32Array(SURFACE4_MAX_MAPS * 4),
  };
  // Placeholder slots: identity inverse, unit contraction — the same "no
  // system yet" values the pre-block uniform arrays held. Nothing reads them
  // (uMapCount is 0), but a stray zero matrix / zero sigma is the kind of
  // thing that turns a wiring bug into a silent black frame.
  for (let j = 0; j < SURFACE4_MAX_MAPS; j++) {
    for (let d = 0; d < 4; d++) buffers.invM[j * 16 + d * 4 + d] = 1;
    buffers.colorSigma[j * 4 + 3] = 1;
  }
  const maps = new THREE.UniformsGroup();
  // The name is how the renderer finds the block in the linked program
  // (gl.getUniformBlockIndex), so it must match the GLSL block name exactly.
  maps.setName("SurfaceMaps4");
  // Rewritten whole on every system change, and three re-uploads typed-array
  // uniforms every frame it draws with them (it cannot diff them cheaply).
  maps.setUsage(THREE.DynamicDrawUsage);
  // ORDER IS THE LAYOUT: three walks this list to compute std140 offsets, so
  // it must match the block's member order in SURFACE4_FRAGMENT exactly.
  maps.add(new THREE.Uniform(buffers.invM));
  maps.add(new THREE.Uniform(buffers.invT));
  maps.add(new THREE.Uniform(buffers.colorSigma));
  maps.add(new THREE.Uniform(buffers.trap));
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
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
      uSliceHalfW: { value: 0 },
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
  material.uniformsGroups = [maps];
  // The group owns a GL buffer of its own, which the renderer frees only when
  // the group is disposed — so freeing the material has to free the block too.
  material.addEventListener("dispose", () => maps.dispose());
  mapBuffers.set(material, buffers);
  return material;
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
  const maps = mapBuffers.get(material);
  if (!maps) {
    throw new TypeError(
      "surface material 4D has no map block — build it with createSurfaceMaterial4",
    );
  }
  const u = material.uniforms;
  de.maps.forEach((map, j) => {
    const m = map.invM;
    // SurfaceDE4Map.invM is ROW-major (m[row * 4 + col]); a std140 mat4 is
    // four COLUMN vec4s, which is also what the GLSL `mat4 * vec4` product
    // expects — so the write transposes: column c, row r lands at
    // c * 4 + r. These are the same 16 numbers in the same order the old
    // THREE.Matrix4 path uploaded (Matrix4.set takes row-major arguments and
    // stores column-major internally).
    const base = j * 16;
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        maps.invM[base + c * 4 + r] = m[r * 4 + c];
      }
    }
    maps.invT.set(map.invT, j * 4);
    // Lane w of the color slot, not an array of its own: see the std140
    // block's member list in SURFACE4_FRAGMENT.
    maps.colorSigma.set(colors[j], j * 4);
    maps.colorSigma[j * 4 + 3] = map.sigmaMin;
    maps.trap[j * 4] = trapIndices ? trapIndices[j] : 0;
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
 * w-coordinate, uploaded verbatim, and `sliceHalfW` its HALF-THICKNESS in
 * the same units and the same frame (fr-wa6o): 0 marches the zero-thickness
 * hyperplane this tracer shipped with, value for value, and anything above
 * turns every descent query into the segment the slab cuts over its point
 * (see `uSliceHalfW`'s declaration). Both ride the same call because they
 * describe one hyperslab and `scene.ts` derives them from one slider
 * position. No dirty-check here: like {@link setSurfaceSystem4}, this is a
 * pure packer — `scene.ts` owns render-needed bookkeeping. */
export function setSurfaceView4(
  material: THREE.ShaderMaterial,
  rotor: number[],
  w0: number,
  sliceHalfW: number,
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
  u.uSliceHalfW.value = sliceHalfW;
}
